import type { LaneState } from './protocol'

// Calls `fn` after `ms`; the returned function cancels it.
export type Schedule = (ms: number, fn: () => void) => () => void

// tool.check answers `ask` before auto mode's classifier settles the call, so an
// ask only counts as waiting once it has stayed open this long
// (spike/approval-signal/FINDINGS.md §2).
export const ASK_GRACE_MS = 1000

// The Spinner redraws every ~100 ms while a turn runs, and a dialog hides it
// (FINDINGS.md §10). A classifier settling an ask keeps it drawing, so past the
// grace an ask waits for the Spinner to have been quiet this long.
export const SPINNER_QUIET_MS = 800
const RECHECK_MS = 250

// Modes that settle an ask with no dialog, and the tools acceptEdits settles.
const SILENT_MODES = new Set(['auto', 'bypassPermissions', 'dontAsk'])
const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit'])

// A real call whose verdict puts it to a person: the case where the
// permission dialog, a question or a plan approval opens (FINDINGS.md §2).
// tool.check answers before the mode settles the ask. The main loop's false
// asks clear when the call is drawn running, but a subagent's calls are never
// drawn, so its asks are dropped when the session's mode (`mode`, as the
// latest agent.spawn reported it) settles them silently.
export function isDialogAsk(
  e: { tool_use_id?: string; approver?: string; agentId?: string; tool?: string },
  verdict: { decision: string },
  mode?: string,
): boolean {
  if (!e.tool_use_id || e.approver !== 'person' || verdict.decision !== 'ask') return false
  if (!e.agentId || mode === undefined) return true
  if (SILENT_MODES.has(mode)) return false
  return !(mode === 'acceptEdits' && EDIT_TOOLS.has(e.tool ?? ''))
}

export type Tracker = {
  sessionStart(): void
  turnStart(): void
  turnComplete(reason: string): void
  askStart(id: string): void
  askEnd(id: string): void
  approved(id: string): void
  spinner(): void
}

// The terminal's lane state: `waiting` while any ask is open past the grace
// with the Spinner quiet, otherwise the base state the main loop's turns set.
// Reports only changes.
export function createTracker(
  onState: (s: LaneState) => void,
  schedule: Schedule,
  graceMs = ASK_GRACE_MS,
  now: () => number = Date.now,
): Tracker {
  let base: LaneState | null = null
  let shown: LaneState | null = null
  // Null until the surface draws a Spinner; then the grace alone decides.
  let spunAt: number | null = null
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
      const confirm = () => {
        if (spunAt !== null && now() - spunAt < SPINNER_QUIET_MS) {
          ask.cancel = schedule(RECHECK_MS, confirm)
          return
        }
        ask.isConfirmed = true
        emit()
      }
      ask.cancel = schedule(graceMs, confirm)
    },
    askEnd: end,
    approved: end,
    spinner: () => {
      spunAt = now()
    },
  }
}
