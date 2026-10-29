import { describe, expect, test } from 'claude-code/testing'
import type { ClientEvent } from './protocol'
import { createReporter } from './reporter'
import type { Schedule } from './tracker'

// Lets pending promise chains run (the environment has no setTimeout types).
const settle = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve()
}

// Timers on a hand-moved clock.
function fakeClock() {
  let now = 0
  let timers: { at: number; fn: () => void }[] = []
  const schedule: Schedule = (ms, fn) => {
    const t = { at: now + ms, fn }
    timers.push(t)
    return () => (timers = timers.filter(x => x !== t))
  }
  const advance = async (ms: number) => {
    const end = now + ms
    for (;;) {
      await settle()
      const next = timers.filter(t => t.at <= end).sort((a, b) => a.at - b.at)[0]
      if (!next) break
      now = next.at
      timers = timers.filter(t => t !== next)
      next.fn()
    }
    now = end
    await settle()
  }
  return { schedule, advance }
}

const state = (s: 'working' | 'done' | 'waiting'): ClientEvent => ({ kind: 'state', terminal: 't', state: s })

describe('reporter', () => {
  test('three states inside one window send once, with the last', async () => {
    const sent: ClientEvent[] = []
    const clock = fakeClock()
    const r = createReporter(async ev => void sent.push(ev), clock.schedule)
    r.report(state('working'))
    r.report(state('waiting'))
    r.report(state('done'))
    await clock.advance(250)
    expect(sent).toEqual([state('done')])
  })

  test('report() returns before anything is sent', async () => {
    let calls = 0
    const clock = fakeClock()
    const r = createReporter(async () => void calls++, clock.schedule)
    r.report(state('working'))
    expect(calls).toBe(0)
  })

  test('after one failed send, the queued color then the latest state go out', async () => {
    const sent: ClientEvent[] = []
    let fails = 1
    const clock = fakeClock()
    const r = createReporter(async ev => {
      if (fails-- > 0) throw new Error('down')
      sent.push(ev)
    }, clock.schedule)
    const color: ClientEvent = { kind: 'color', terminal: 't', color: [1, 2, 3] }
    r.report(color)
    await clock.advance(250)
    expect(sent).toEqual([])
    r.report(state('working'))
    r.report(state('waiting'))
    await clock.advance(250)
    expect(sent).toEqual([color, state('waiting')])
  })

  test('a failed send retries on its own', async () => {
    const sent: ClientEvent[] = []
    let fails = 1
    const clock = fakeClock()
    const r = createReporter(async ev => {
      if (fails-- > 0) throw new Error('down')
      sent.push(ev)
    }, clock.schedule)
    r.report(state('waiting'))
    await clock.advance(250)
    await clock.advance(5000)
    expect(sent).toEqual([state('waiting')])
  })

  test('a send that never answers is given up after timeoutMs, and the queue moves on', async () => {
    const sent: ClientEvent[] = []
    let hang = true
    const clock = fakeClock()
    const r = createReporter(ev => {
      if (hang) return new Promise(() => {})
      sent.push(ev)
      return Promise.resolve()
    }, clock.schedule)
    r.report(state('working'))
    await clock.advance(250 + 6000)
    hang = false
    r.report({ kind: 'end', terminal: 't' })
    await clock.advance(250)
    expect(sent).toEqual([state('working'), { kind: 'end', terminal: 't' }])
  })

  test('color and end are never coalesced away', async () => {
    const sent: ClientEvent[] = []
    const clock = fakeClock()
    const r = createReporter(async ev => void sent.push(ev), clock.schedule)
    r.report(state('working'))
    r.report({ kind: 'color', terminal: 't', color: [9, 9, 9] })
    r.report(state('done'))
    r.report({ kind: 'end', terminal: 't' })
    await clock.advance(250)
    expect(sent.map(e => e.kind)).toEqual(['state', 'color', 'state', 'end'])
  })

  test('a report during a send, then a drain that ends before the debounce, never wedges later reports', async () => {
    const sent: ClientEvent[] = []
    const clock = fakeClock()
    const r = createReporter(ev => new Promise<void>(done => void clock.schedule(100, () => (sent.push(ev), done()))), clock.schedule)
    r.report(state('working'))
    await clock.advance(300) // working is in flight until 350
    r.report(state('waiting')) // arms the debounce for 550; the drain sends it by 450
    await clock.advance(300) // the debounce fires on an empty queue at 550
    r.report(state('done'))
    await clock.advance(1000)
    expect(sent).toEqual([state('working'), state('waiting'), state('done')])
  })

  test('flush() on an empty queue resolves and leaves the reporter working', async () => {
    const sent: ClientEvent[] = []
    const clock = fakeClock()
    const r = createReporter(async ev => void sent.push(ev), clock.schedule)
    await r.flush()
    r.report({ kind: 'end', terminal: 't' })
    await r.flush()
    expect(sent).toEqual([{ kind: 'end', terminal: 't' }])
  })

  test('flush() sends now and resolves after the send', async () => {
    const sent: ClientEvent[] = []
    const clock = fakeClock()
    const r = createReporter(async ev => void sent.push(ev), clock.schedule)
    r.report({ kind: 'end', terminal: 't' })
    await r.flush()
    expect(sent).toEqual([{ kind: 'end', terminal: 't' }])
  })
})
