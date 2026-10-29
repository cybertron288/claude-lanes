import type { ClientEvent, LaneState, RGB } from "../../shared/protocol";

export const MAX_LANES = 5;

export type Lane = { terminal: string; slot: number | null; state: LaneState; color: RGB; lastSeen: number };

// Lanes are kept in arrival order; that order decides who takes a freed slot.
export type Hub = { lanes: Lane[] };

export function slotX(slot: number): number {
  return slot * 3;
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

  const changed: Lane =
    ev.kind === "state" ? { ...known, state: ev.state, lastSeen: now } : { ...known, color: ev.color, lastSeen: now };
  return { lanes: hub.lanes.map((l) => (l === known ? changed : l)) };
}

export function expire(hub: Hub, now: number, ttlMs = 12 * 3600_000): Hub {
  const alive = hub.lanes.filter((l) => now - l.lastSeen <= ttlMs);
  return alive.length === hub.lanes.length ? hub : { lanes: promote(alive) };
}
