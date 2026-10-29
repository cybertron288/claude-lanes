import { describe, expect, test } from 'claude-code/testing'
import type { LaneState } from './protocol'
import { createTracker, isDialogAsk, type Schedule } from './tracker'

describe('isDialogAsk', () => {
  test('a real call put to a person opens a dialog', async () => {
    expect(isDialogAsk({ tool_use_id: 'u1', approver: 'person' }, { decision: 'ask' })).toBe(true)
  })
  test('a query (no tool_use_id), a host approver, no approver, or a non-ask verdict does not', async () => {
    expect(isDialogAsk({ approver: 'person' }, { decision: 'ask' })).toBe(false)
    expect(isDialogAsk({ tool_use_id: 'u1', approver: 'host' }, { decision: 'ask' })).toBe(false)
    expect(isDialogAsk({ tool_use_id: 'u1' }, { decision: 'ask' })).toBe(false)
    expect(isDialogAsk({ tool_use_id: 'u1', approver: 'person' }, { decision: 'allow' })).toBe(false)
    expect(isDialogAsk({ tool_use_id: 'u1', approver: 'person' }, { decision: 'deny' })).toBe(false)
  })
})

// A schedule that fires only when the test says so.
function manualTimers() {
  const due: { fn: () => void; isCancelled: boolean }[] = []
  const schedule: Schedule = (_ms, fn) => {
    const t = { fn, isCancelled: false }
    due.push(t)
    return () => (t.isCancelled = true)
  }
  const fireAll = () => due.splice(0).forEach(t => !t.isCancelled && t.fn())
  return { schedule, fireAll }
}

function setup() {
  const seen: LaneState[] = []
  const timers = manualTimers()
  const tracker = createTracker(s => seen.push(s), timers.schedule)
  return { seen, tracker, fireAll: timers.fireAll }
}

describe('tracker', () => {
  test('two asks hold waiting until both end', async () => {
    const { seen, tracker, fireAll } = setup()
    tracker.turnStart()
    tracker.askStart('a')
    tracker.askStart('b')
    fireAll()
    tracker.askEnd('a')
    expect(seen).toEqual(['working', 'waiting'])
    tracker.askEnd('b')
    expect(seen).toEqual(['working', 'waiting', 'working'])
  })

  test('approved ends its ask', async () => {
    const { seen, tracker, fireAll } = setup()
    tracker.turnStart()
    tracker.askStart('a')
    fireAll()
    tracker.approved('a')
    expect(seen).toEqual(['working', 'waiting', 'working'])
  })

  test('an ask settled inside the grace never shows waiting (auto mode)', async () => {
    const { seen, tracker, fireAll } = setup()
    tracker.turnStart()
    tracker.askStart('a')
    tracker.approved('a')
    fireAll()
    expect(seen).toEqual(['working'])
  })

  test('turnComplete("error") gives error, and the next turnStart gives working', async () => {
    const { seen, tracker } = setup()
    tracker.turnStart()
    tracker.turnComplete('error')
    tracker.turnStart()
    expect(seen).toEqual(['working', 'error', 'working'])
  })

  test('every other reason ends done', async () => {
    const { seen, tracker } = setup()
    for (const reason of ['answer', 'aborted', 'refusal']) {
      tracker.turnStart()
      tracker.turnComplete(reason)
    }
    expect(seen).toEqual(['working', 'done', 'working', 'done', 'working', 'done'])
  })

  test('a dialog still open when the turn completes keeps waiting', async () => {
    const { seen, tracker, fireAll } = setup()
    tracker.turnStart()
    tracker.askStart('sub')
    fireAll()
    tracker.turnComplete('answer')
    expect(seen.at(-1)).toBe('waiting')
    tracker.askEnd('sub')
    expect(seen.at(-1)).toBe('done')
  })

  test('sessionStart reports done', async () => {
    const { seen, tracker } = setup()
    tracker.sessionStart()
    expect(seen).toEqual(['done'])
  })
})
