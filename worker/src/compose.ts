import type { LaneState, RGB } from "../../shared/protocol";
import { FX, type Effect } from "./effects";
import { DONE_PULSE_MS, isIdle, MAX_LANES, slotX, type Hub, type Lane } from "./lanes";

export const WORKING_BLUE: RGB = [40, 110, 255];
export const DONE_GREEN: RGB = [20, 90, 10];
export const ERROR_RED: RGB = [220, 30, 30];
export const AMBER: RGB = [255, 150, 0];

// Segment opacity (WLED `bri` per segment) while a lane waits: the other lanes
// dim, and the gap columns either side of the waiting lane breathe amber.
const FULL = 255;
export const DIMMED = 77;
export const GLOW = 150;

// Stable segment ids: lane slot s → state 2s, strip 2s + 1. The takeover and
// the idle or black frame reuse id 0, as neither draws lane 0's state. A
// waiting lane's glow takes 16 + 2s (left) and 17 + 2s (right): ids 0–15 fit
// an ESP8266's WLED segment limit, and WLED ignores ids past its limit, so an
// ESP8266 drops only the glow.
const FULL_ID = 0;
const GLOW_BASE = 2 * MAX_LANES;
const SEGMENT_IDS = 4 * MAX_LANES;
const LANE_WIDTH = 1;

// WLED wants `on: true` in every frame: one request that turns it on and sets
// pixels drops the pixels, so a dark panel is a black segment.
export type WledState = { on: true; bri: number; seg: object[] };

const LOOK: Record<Exclude<LaneState, "waiting">, { effect: Effect; color: RGB }> = {
  working: { effect: FX.sonar, color: WORKING_BLUE },
  done: { effect: FX.solid, color: DONE_GREEN },
  error: { effect: FX.blink, color: ERROR_RED },
};

// A task that just finished breathes green, then holds steady.
function look(lane: Lane, now: number): { effect: Effect; color: RGB } {
  const isFresh = lane.state === "done" && lane.doneAt !== undefined && now < lane.doneAt + DONE_PULSE_MS;
  return isFresh ? { effect: FX.breathe, color: DONE_GREEN } : LOOK[lane.state as Exclude<LaneState, "waiting">];
}

// WLED freezes a segment that is given pixels (the idle graph on id 0) and keeps
// it frozen until told otherwise, so every segment carries frz: false.
function segment(id: number, x: [number, number], y: [number, number], effect: Effect, color: RGB, bri = FULL) {
  return { id, start: x[0], stop: x[1], startY: y[0], stopY: y[1], fx: effect.fx, sx: effect.sx, ix: effect.ix, m12: effect.m12 ?? 0, mY: effect.mY ?? false, bri, frz: false, col: [color] };
}

const hex = (c: RGB) => c.map((v) => v.toString(16).padStart(2, "0")).join("").toUpperCase();

export function compose(hub: Hub, idle: RGB[] | null, bri: number, now: number): WledState {
  const drawn = new Map<number, object>();
  const slotted = hub.lanes.filter((l): l is typeof l & { slot: number } => l.slot !== null);
  const columns = (slot: number): [number, number] => [slotX(slot), slotX(slot) + LANE_WIDTH];
  const strip = (slot: number, color: RGB, bri = FULL) =>
    drawn.set(2 * slot + 1, segment(2 * slot + 1, columns(slot), [6, 8], FX.solid, color, bri));

  if (hub.lanes.every((l) => isIdle(l, now))) {
    const { col, ...full } = segment(FULL_ID, [0, 16], [0, 8], FX.solid, [0, 0, 0]);
    drawn.set(FULL_ID, idle ? { ...full, i: idle.map(hex) } : { ...full, col });
  } else if (hub.lanes.some((l) => l.state === "waiting" && l.slot === null)) {
    // A 9th terminal waiting has no lane to light, so the whole panel asks.
    drawn.set(FULL_ID, segment(FULL_ID, [0, 16], [0, 6], FX.breathe, AMBER));
    for (const l of slotted) if (l.state === "waiting") strip(l.slot, l.color);
  } else {
    // Spotlight: a waiting lane turns solid amber between two breathing gap
    // columns, and every other lane keeps its look at DIMMED opacity.
    const others = slotted.some((l) => l.state === "waiting") ? DIMMED : FULL;
    for (const l of slotted) {
      if (l.state === "waiting") {
        const x = slotX(l.slot);
        drawn.set(2 * l.slot, segment(2 * l.slot, columns(l.slot), [0, 6], FX.solid, AMBER));
        if (x > 0) drawn.set(GLOW_BASE + 2 * l.slot, segment(GLOW_BASE + 2 * l.slot, [x - 1, x], [0, 6], FX.breathe, AMBER, GLOW));
        drawn.set(GLOW_BASE + 2 * l.slot + 1, segment(GLOW_BASE + 2 * l.slot + 1, [x + 1, x + 2], [0, 6], FX.breathe, AMBER, GLOW));
        strip(l.slot, l.color);
        continue;
      }
      const { effect, color } = look(l, now);
      drawn.set(2 * l.slot, segment(2 * l.slot, columns(l.slot), [0, 6], effect, color, others));
      strip(l.slot, l.color, others);
    }
  }

  const seg = Array.from({ length: SEGMENT_IDS }, (_, id) => drawn.get(id) ?? { id, stop: 0 });
  return { on: true, bri, seg };
}
