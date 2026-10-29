import type { LaneState } from './protocol'

// Calls `fn` after `ms`; the returned function cancels it.
export type Schedule = (ms: number, fn: () => void) => () => void

// tool.check answers `ask` before auto mode's classifier settles the call, so an
// ask only counts as waiting once it has stayed open this long
// (spike/approval-signal/FINDINGS.md §2).
export const ASK_GRACE_MS = 1000

// A real call whose verdict puts it to a person: the case where the
// permission dialog, a question or a plan approval opens (FINDINGS.md §2).
export function isDialogAsk(e: { tool_use_id?: string; approver?: string }, verdict: { decision: string }): boolean {
  return Boolean(e.tool_use_id) && e.approver === 'person' && verdict.decision === 'ask'
}

export type Tracker = {
  sessionStart(): void
  turnStart(): void
  turnComplete(reason: string): void
  askStart(id: string): void
  askEnd(id: string): void
  approved(id: string): void
}

// The terminal's lane state: `waiting` while any ask is open past the grace,
// otherwise the base state the main loop's turns set. Reports only changes.
export function createTracker(onState: (s: LaneState) => void, schedule: Schedule, graceMs = ASK_GRACE_MS): Tracker {
  let base: LaneState | null = null
  let shown: LaneState | null = null
  const asks = new Map<string, { isConfirmed: boolean; cancel: () => void }>()

  const emit = () => {
    const next = [...asks.values()].some(a => a.isConfirmed) ? 'waiting' : base
    if (next === null || next === shown) return
    shown = next
    onState(next)
  }
  const setBase = (s: LaneState) => {
    base = s
    emit()
  }
  const end = (id: string) => {
    const ask = asks.get(id)
    if (!ask) return
    ask.cancel()
    asks.delete(id)
    emit()
  }

  return {
    sessionStart: () => setBase('done'),
    turnStart: () => setBase('working'),
    turnComplete: reason => setBase(reason === 'error' ? 'error' : 'done'),
    askStart(id) {
      if (asks.has(id)) return
      const ask = { isConfirmed: false, cancel: () => {} }
      asks.set(id, ask)
      ask.cancel = schedule(graceMs, () => {
        ask.isConfirmed = true
        emit()
      })
    },
    askEnd: end,
    approved: end,
  }
}
