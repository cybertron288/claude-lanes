import type { On } from 'claude-code'
import { describe, expect, mock, test } from 'claude-code/testing'

const CONFIG = { options: { workerUrl: 'https://worker.test', token: 'tok' } }
const INTERACTIVE = { cwd: '/', surface: 'terminal', isInteractive: true } as const

// The engine beneath the mod: a session, a command registry, an HTTP client
// that records what the mod sends, and a clock the test moves.
function world(on: On, opts: { hangFetch?: boolean; refuseCommand?: boolean } = {}) {
  const sent: any[] = []
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.end', (_, e) => ({ sessionId: e.sessionId }))
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  on('command.register', () => {
    if (opts.refuseCommand) throw new Error('led-color is already registered')
    return { value: { command: 'led-color' } }
  })
  on('http.fetch', (_, e) => {
    if (opts.hangFetch) return new Promise(() => {})
    sent.push(JSON.parse(e.init?.body ?? '{}'))
    return { value: { status: 204, ok: true, headers: {}, text: '' } }
  })
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>row</Text>
  })
  const clock = mock.clock(on)
  const states = () => sent.filter(ev => ev.kind === 'state').map(ev => ev.state)
  return { sent, clock, states }
}


const askVerdict = (on: On) => on('tool.check', () => ({ decision: 'ask' }))
const check = (id: string, tool = 'Bash') => ({ tool, input: {}, tool_use_id: id, approver: 'person' }) as const

describe('cc-status-light wiring', () => {
  test('an interactive session.start reports done', CONFIG, async ($, on) => {
    const w = world(on)
    await $.session.start(INTERACTIVE)
    await w.clock.advance(300)
    expect(w.sent).toEqual([{ kind: 'state', terminal: expect.any(String), state: 'done' }])
  })

  // The kit plays no person (an ask runs as a background subagent's would), so
  // dialogs are covered by isDialogAsk and the tracker tests, and live in the
  // spike's scenarios. What the kit can show: an ask nobody can answer is no dialog.
  test('a refused command registration (a reload duplicate) still reports the lane', CONFIG, async ($, on) => {
    const w = world(on, { refuseCommand: true })
    await $.session.start(INTERACTIVE)
    await w.clock.advance(300)
    expect(w.states()).toEqual(['done'])
  })

  test('an ask with no person to answer it never reports waiting', CONFIG, async ($, on) => {
    const w = world(on)
    askVerdict(on)
    on('tool.call', () => ({ result: {} }))
    await $.session.start(INTERACTIVE)
    await $.turn.start({ text: 'go', turnId: 't1' })
    await $.tool.call({ tool: 'Bash', command: 'x', tool_use_id: 'u3' })
    await w.clock.advance(3000)
    expect(w.states()).not.toContain('waiting')
  })

  test('a tool that errors with no dialog leaves the lane working', CONFIG, async ($, on) => {
    const w = world(on)
    on('tool.check', () => ({ decision: 'allow' }))
    on('tool.call', () => ({ result: 'exit 2', isError: true }))
    await $.session.start(INTERACTIVE)
    await $.turn.start({ text: 'go', turnId: 't1' })
    await $.tool.check(check('u4'))
    await $.tool.call({ tool: 'Bash', command: 'ls nope', tool_use_id: 'u4' })
    await w.clock.advance(2000)
    expect(w.states().at(-1)).toBe('working')
  })

  test('a non-interactive session reports nothing, ever', CONFIG, async ($, on) => {
    const w = world(on)
    askVerdict(on)
    on('tool.call', () => ({ result: {} }))
    await $.session.start({ cwd: '/', surface: null, isInteractive: false })
    await $.turn.start({ text: 'go', turnId: 't1' })
    await $.tool.check(check('u5'))
    await $.tool.call({ tool: 'Bash', command: 'x', tool_use_id: 'u5' })
    await w.clock.advance(5000)
    expect(w.sent).toEqual([])
  })

  test('a hanging Worker never delays a tool call', CONFIG, async ($, on) => {
    const w = world(on, { hangFetch: true })
    on('tool.check', () => ({ decision: 'allow' }))
    on('tool.call', () => ({ result: { stdout: 'ok' } }))
    await $.session.start(INTERACTIVE)
    await w.clock.advance(300)
    await $.tool.check(check('u6'))
    const result = await $.tool.call({ tool: 'Bash', command: 'x', tool_use_id: 'u6' })
    expect(result.result).toEqual({ stdout: 'ok' })
  })

  test('unconfigured, a full turn sends nothing and changes no result', { options: { workerUrl: '', token: '' } }, async ($, on) => {
    const w = world(on)
    on('tool.check', () => ({ decision: 'allow' }))
    on('tool.call', () => ({ result: { stdout: 'same' } }))
    await $.session.start(INTERACTIVE)
    await $.turn.start({ text: 'go', turnId: 't1' })
    await $.tool.check(check('u7'))
    const result = await $.tool.call({ tool: 'Bash', command: 'x', tool_use_id: 'u7' })
    await w.clock.advance(5000)
    expect(result.result).toEqual({ stdout: 'same' })
    expect(w.sent).toEqual([])
  })

  test('a background subagent still running after the main turn keeps the lane working until it ends', CONFIG, async ($, on) => {
    const w = world(on)
    await $.session.start(INTERACTIVE)
    await w.clock.advance(300)
    await $.turn.start({ text: 'go', turnId: 't1' })
    await $.turn.start({ text: '', turnId: 'sub', agentId: 'a1' })
    await $.turn.complete({ turnId: 't1', reason: 'answer' } as any)
    await w.clock.advance(300)
    expect(w.states()).toEqual(['done', 'working'])
    await $.turn.complete({ turnId: 'sub', agentId: 'a1', reason: 'answer' } as any)
    await w.clock.advance(300)
    expect(w.states()).toEqual(['done', 'working', 'done'])
  })

  test('/led-color pink sends a color; /led-color nope answers the error and sends nothing', CONFIG, async ($, on) => {
    const w = world(on)
    await $.session.start(INTERACTIVE)
    await w.clock.advance(300)
    const ok = await $.command.run({ command: 'led-color', args: 'pink', origin: 'user' } as any)
    await w.clock.advance(300)
    expect(w.sent.at(-1)).toEqual({ kind: 'color', terminal: expect.any(String), color: [255, 90, 160] })
    expect(ok.text).toContain('pink')
    const before = w.sent.length
    const bad = await $.command.run({ command: 'led-color', args: 'nope', origin: 'user' } as any)
    await w.clock.advance(300)
    expect(bad.text).toMatch(/^Unknown color "nope"\. Use #rrggbb or one of: cyan, /)
    expect(w.sent.length).toBe(before)
  })

  test('session.end on exit sends end; on /clear it sends nothing', CONFIG, async ($, on) => {
    const w = world(on)
    await $.session.start(INTERACTIVE)
    await w.clock.advance(300)
    await $.session.end({ reason: 'clear', sessionId: 's1' } as any)
    await w.clock.advance(300)
    expect(w.sent.some(ev => ev.kind === 'end')).toBe(false)
    await $.session.end({ reason: 'prompt_input_exit', sessionId: 's2' } as any)
    await w.clock.advance(1000)
    expect(w.sent.at(-1)).toEqual({ kind: 'end', terminal: w.sent[0].terminal })
  })
})
