import type { EngineInterface, Register } from 'claude-code'
import { COLOR_NAMES, parseColor, type ClientEvent } from './protocol'
import { createReporter, type Reporter } from './reporter'
import { createTracker, isDialogAsk, type Schedule, type Tracker } from './tracker'

// Signals and predicates come from spike/approval-signal/FINDINGS.md.
const TERMINAL = { plugin: 'cc-status-light', key: 'terminal' } as const
const END_WAIT_MS = 800
const COMMAND = {
  name: 'led-color',
  description: "Set this session's strip color on the status light (#rrggbb or a name)",
}

// Module variables survive /clear and /resume but not a reload; $.state is the
// reverse. The terminal key lives in both (FINDINGS.md §5).
let terminal: string | null = null
let tracker: Tracker | null = null
let reporter: Reporter | null = null

function timers($: EngineInterface): Schedule {
  return (ms, fn) => {
    const timer = $.clock.after(ms, fn)
    return () => timer.cancel()
  }
}

function sender($: EngineInterface, workerUrl: string, token: string) {
  const url = `${workerUrl.replace(/\/+$/, '')}/event`
  return async (ev: ClientEvent) => {
    const res = await $.http.fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(ev),
    })
    // 5xx may pass; a 4xx will not, so it is dropped rather than retried.
    if (res.status >= 500) throw new Error(`worker answered ${res.status}`)
  }
}

// The key, and whether this session.start is a reload of an earlier copy.
async function claimTerminal($: EngineInterface): Promise<{ key: string; isReload: boolean }> {
  const held = await $.state.get(TERMINAL)
  if (terminal === null && held.value !== undefined) {
    terminal = held.value
    return { key: terminal, isReload: true }
  }
  terminal ??= crypto.randomUUID()
  if (held.value === undefined) await $.state.set(TERMINAL, terminal)
  return { key: terminal, isReload: false }
}

async function keepTerminal($: EngineInterface): Promise<void> {
  if (terminal !== null && (await $.state.get(TERMINAL)).value === undefined) await $.state.set(TERMINAL, terminal)
}

function setColor(args: string): string {
  const color = parseColor(args)
  if (!color) return `Unknown color "${args.trim()}". Use #rrggbb or one of: ${COLOR_NAMES.join(', ')}.`
  if (!reporter || !terminal) return 'The status light only follows interactive sessions.'
  reporter.report({ kind: 'color', terminal, color })
  return `Strip color set to ${args.trim()}.`
}

export const register: Register = (on, options) => {
  const workerUrl = String(options.workerUrl ?? '')
  const token = String(options.token ?? '')
  // Unconfigured, the mod only answers /led-color; with no tracker every other
  // hook passes straight through.
  const isConfigured = workerUrl !== '' && token !== ''

  on('session.start', async ($, e, next) => {
    await $.command.register(COMMAND)
    if (!isConfigured || e.isInteractive !== true) return next(e)
    const { key, isReload } = await claimTerminal($)
    reporter ??= createReporter(sender($, workerUrl, token), timers($))
    tracker ??= createTracker(state => reporter!.report({ kind: 'state', terminal: key, state }), timers($))
    if (!isReload) tracker.sessionStart()
    return next(e)
  })

  on('command.run', { command: 'led-color' }, async ($, e) => ({
    text: isConfigured
      ? setColor(e.args)
      : 'cc-status-light is not set up: set workerUrl and token in /plugin → cc-status-light → configure.',
  }))

  on('turn.start', async ($, e, next) => {
    if (tracker && !e.agentId) {
      tracker.turnStart()
      void keepTerminal($)
    }
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    if (tracker && !e.agentId) tracker.turnComplete(e.reason)
    return next(e)
  })

  on('tool.check', async ($, e, next) => {
    const verdict = await next(e)
    if (tracker && isDialogAsk(e, verdict)) tracker.askStart(e.tool_use_id!)
    return verdict
  }).catch(($, e, next) => next(e))

  // Every way out of a dialog (approve, reject, Esc, answer) ends here at the
  // latest; the tracker call is synchronous and never delays the result.
  on('tool.call', async ($, e, next) => {
    const id = e.tool_use_id
    if (!tracker || !id) return next(e)
    try {
      return await next(e)
    } finally {
      tracker.askEnd(id)
    }
  }).catch(($, e, next) => next(e))

  // An approved call is drawn running ~0.1–2 s after the press, long before it
  // finishes (FINDINGS.md §1). Subagent calls are not drawn: tool.call ends those.
  on('ui.render', { component: 'ToolGroup' }, async ($, e, next) => {
    if (tracker) for (const call of e.props.calls) if (call.isRunning && call.tool_use_id) tracker.approved(call.tool_use_id)
    return next(e)
  })

  on('ui.render', { component: 'ToolUse' }, async ($, e, next) => {
    if (tracker && e.props.isRunning) tracker.approved(e.props.tool_use_id)
    return next(e)
  })

  on('session.end', async ($, e, next) => {
    if (!reporter || !terminal || e.reason === 'clear' || e.reason === 'resume') return next(e)
    reporter.report({ kind: 'end', terminal })
    await Promise.race([reporter.flush(), $.clock.sleep(END_WAIT_MS)])
    return next(e)
  })
}
