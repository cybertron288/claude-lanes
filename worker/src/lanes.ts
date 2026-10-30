import type { ClientEvent, LaneState, RGB } from "../../shared/protocol";

export const MAX_LANES = 8;

export const DONE_PULSE_MS = 20_000;

// A done or error lane that has been quiet this long counts as idle. When every
// lane is idle the panel shows the contribution graph. A working lane may run
// a long step without reporting and a waiting lane needs you, so neither idles.
export const IDLE_MS = 10 * 60_000;

// doneAt: when the lane last turned done from another state, so a finished
// task pulses for DONE_PULSE_MS. A lane that starts as done has none.
export type Lane = {
  terminal: string;
  slot: number | null;
  state: LaneState;
  color: RGB;
  lastSeen: number;
  doneAt?: number;
};

// Lanes are kept in arrival order; that order decides who takes a freed slot.
export type Hub = { lanes: Lane[] };

// Lanes are 1 column wide with a 1-column gap: x = 0, 2, 4 … 14.
export function slotX(slot: number): number {
  return slot * 2;
}

// Hand free slots to unslotted lanes, oldest arrival first.
function promote(lanes: Lane[]): Lane[] {
  const taken = new Set(lanes.map((l) => l.slot).filter((s) => s !== null));
  const free = Array.from({ length: MAX_LANES }, (_, s) => s).filter((s) => !taken.has(s));
  return lanes.map((l) => (l.slot === null && free.length > 0 ? { ...l, slot: free.shift()! } : l));
}

export function apply(hub: Hub, ev: ClientEvent, now: number, pick: (inUse: RGB[]) => RGB): Hub {
  const known = hub.lanes.find((l) => l.terminal === ev.terminal);

  if (ev.kind === "end") {
    if (!known) return hub;
    return { lanes: promote(hub.lanes.filter((l) => l !== known)) };
  }

  if (!known) {
    const lane: Lane = {
      terminal: ev.terminal,
      slot: null,
      state: ev.kind === "state" ? ev.state : "done",
      color: ev.kind === "color" ? ev.color : pick(hub.lanes.map((l) => l.color)),
      lastSeen: now,
    };
    return { lanes: promote([...hub.lanes, lane]) };
  }

  const changed: Lane = ev.kind === "color" ? { ...known, color: ev.color, lastSeen: now } : withState(known, ev.state, now);
  return { lanes: hub.lanes.map((l) => (l === known ? changed : l)) };
}

function withState(lane: Lane, state: LaneState, now: number): Lane {
  const { doneAt, ...rest } = lane;
  if (state !== "done") return { ...rest, state, lastSeen: now };
  return { ...rest, state, lastSeen: now, doneAt: lane.state === "done" ? doneAt : now };
}

// When the next done pulse ends, if any is still running at `now`.
export function pulseEnd(hub: Hub, now: number): number | null {
  const ends = hub.lanes.flatMap((l) => (l.doneAt !== undefined && now < l.doneAt + DONE_PULSE_MS ? [l.doneAt + DONE_PULSE_MS] : []));
  return ends.length > 0 ? Math.min(...ends) : null;
}

export function isIdle(lane: Lane, now: number): boolean {
  return (lane.state === "done" || lane.state === "error") && now - lane.lastSeen >= IDLE_MS;
}

// When the next live done or error lane turns idle, if any is still live at `now`.
export function idleAt(hub: Hub, now: number): number | null {
  const times = hub.lanes.flatMap((l) => (!isIdle(l, now) && (l.state === "done" || l.state === "error") ? [l.lastSeen + IDLE_MS] : []));
  return times.length > 0 ? Math.min(...times) : null;
}

export function expire(hub: Hub, now: number, ttlMs = 12 * 3600_000): Hub {
  const alive = hub.lanes.filter((l) => now - l.lastSeen <= ttlMs);
  return alive.length === hub.lanes.length ? hub : { lanes: promote(alive) };
}
