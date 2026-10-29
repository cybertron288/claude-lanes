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
  test("a subagent's ask in a mode that settles it silently does not", async () => {
    const sub = { tool_use_id: 'u1', approver: 'person', agentId: 'a1', tool: 'Bash' }
    for (const mode of ['auto', 'bypassPermissions', 'dontAsk']) expect(isDialogAsk(sub, { decision: 'ask' }, mode)).toBe(false)
    expect(isDialogAsk({ ...sub, tool: 'Edit' }, { decision: 'ask' }, 'acceptEdits')).toBe(false)
  })
  test("a subagent's ask in default, plan or acceptEdits (non-edit) mode, or an unknown mode, does", async () => {
    const sub = { tool_use_id: 'u1', approver: 'person', agentId: 'a1', tool: 'Bash' }
    for (const mode of ['default', 'plan', 'acceptEdits', undefined]) expect(isDialogAsk(sub, { decision: 'ask' }, mode)).toBe(true)
  })
  test("the main loop's ask counts in every mode (its false asks clear on the running render)", async () => {
    expect(isDialogAsk({ tool_use_id: 'u1', approver: 'person', tool: 'Bash' }, { decision: 'ask' }, 'auto')).toBe(true)
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
  let t = 0
  const tracker = createTracker(s => seen.push(s), timers.schedule, undefined, () => t)
  return { seen, tracker, fireAll: timers.fireAll, at: (ms: number) => (t = ms) }
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

  test('past the grace, an ask waits while the Spinner draws (a slow classifier) and is settled', async () => {
    const { seen, tracker, fireAll, at } = setup()
    tracker.turnStart()
    tracker.askStart('a')
    at(900)
    tracker.spinner()
    at(1000)
    fireAll()
    expect(seen).toEqual(['working'])
    tracker.approved('a')
    fireAll()
    expect(seen).toEqual(['working'])
  })

  test('an ask turns waiting once the Spinner has been quiet 800 ms (a dialog hides it)', async () => {
    const { seen, tracker, fireAll, at } = setup()
    tracker.turnStart()
    tracker.spinner()
    at(500)
    tracker.spinner()
    tracker.askStart('a')
    at(1000)
    fireAll()
    expect(seen).toEqual(['working'])
    at(1300)
    fireAll()
    expect(seen).toEqual(['working', 'waiting'])
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
