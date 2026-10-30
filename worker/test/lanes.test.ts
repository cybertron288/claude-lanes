import { describe, expect, test } from "bun:test";
import type { RGB } from "../../shared/protocol";
import { apply, expire, idleAt, IDLE_MS, isIdle, pulseEnd, slotX, type Hub, type Lane } from "../src/lanes";

const PICKED: RGB = [1, 2, 3];
const pick = () => PICKED;
const empty: Hub = { lanes: [] };
const H12 = 12 * 3600_000;

function withTerminals(n: number, now = 0): Hub {
  let hub = empty;
  for (let i = 0; i < n; i++) hub = apply(hub, { kind: "state", terminal: `t${i}`, state: "working" }, now + i, pick);
  return hub;
}

describe("apply", () => {
  test("a first state event appends a lane with the lowest free slot and a picked color", () => {
    const hub = apply(empty, { kind: "state", terminal: "a", state: "working" }, 5, pick);
    expect(hub.lanes).toEqual([{ terminal: "a", slot: 0, state: "working", color: PICKED, lastSeen: 5 }]);
  });

  test("a first color event uses its own color", () => {
    const hub = apply(empty, { kind: "color", terminal: "a", color: [9, 9, 9] }, 0, pick);
    expect(hub.lanes[0]!.color).toEqual([9, 9, 9]);
    expect(hub.lanes[0]!.slot).toBe(0);
  });

  test("a 9th terminal gets slot null", () => {
    const hub = withTerminals(9);
    expect(hub.lanes.map((l) => l.slot)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, null]);
  });

  test("end removes the lane and the first slot-null lane in arrival order takes its slot", () => {
    let hub = withTerminals(10);
    hub = apply(hub, { kind: "end", terminal: "t2" }, 100, pick);
    expect(hub.lanes.find((l) => l.terminal === "t2")).toBeUndefined();
    expect(hub.lanes.find((l) => l.terminal === "t8")!.slot).toBe(2);
    expect(hub.lanes.find((l) => l.terminal === "t9")!.slot).toBeNull();
  });

  test("promotion follows arrival order, not lastSeen", () => {
    let hub = withTerminals(10);
    hub = apply(hub, { kind: "state", terminal: "t9", state: "done" }, 50, pick);
    hub = apply(hub, { kind: "end", terminal: "t0" }, 100, pick);
    expect(hub.lanes.find((l) => l.terminal === "t8")!.slot).toBe(0);
  });

  test("end for an unknown terminal returns the hub unchanged", () => {
    const hub = withTerminals(2);
    expect(apply(hub, { kind: "end", terminal: "zz" }, 9, pick)).toBe(hub);
  });

  test("a color event changes only that lane", () => {
    const hub = apply(withTerminals(2), { kind: "color", terminal: "t1", color: [7, 7, 7] }, 9, pick);
    expect(hub.lanes[0]!.color).toEqual(PICKED);
    expect(hub.lanes[1]!.color).toEqual([7, 7, 7]);
  });

  test("a state event for a known terminal keeps slot and color and updates lastSeen", () => {
    let hub = apply(withTerminals(2), { kind: "color", terminal: "t1", color: [7, 7, 7] }, 9, pick);
    hub = apply(hub, { kind: "state", terminal: "t1", state: "waiting" }, 20, () => [0, 0, 0]);
    expect(hub.lanes[1]).toEqual({ terminal: "t1", slot: 1, state: "waiting", color: [7, 7, 7], lastSeen: 20 });
  });
});

describe("doneAt", () => {
  const state = (hub: Hub, s: "working" | "done" | "error", now: number) => apply(hub, { kind: "state", terminal: "t0", state: s }, now, pick);

  test("a new lane that starts done has none", () => {
    expect(state(empty, "done", 5).lanes[0]!.doneAt).toBeUndefined();
  });

  test("turning done from another state stamps it, a repeated done keeps it, leaving done drops it", () => {
    let hub = state(state(empty, "working", 0), "done", 10);
    expect(hub.lanes[0]!.doneAt).toBe(10);
    hub = state(hub, "done", 30);
    expect(hub.lanes[0]!.doneAt).toBe(10);
    hub = state(hub, "working", 40);
    expect(hub.lanes[0]).not.toHaveProperty("doneAt");
  });

  test("pulseEnd is the earliest running pulse's end, or null once all have ended", () => {
    const hub: Hub = {
      lanes: [
        { terminal: "a", slot: 0, state: "done", color: PICKED, lastSeen: 0, doneAt: 5000 },
        { terminal: "b", slot: 1, state: "done", color: PICKED, lastSeen: 0, doneAt: 1000 },
      ],
    };
    expect(pulseEnd(hub, 2000)).toBe(21_000);
    expect(pulseEnd(hub, 21_000)).toBe(25_000);
    expect(pulseEnd(hub, 25_000)).toBeNull();
  });
});

describe("expire", () => {
  test("removes a lane idle for 12 h + 1 ms and reassigns its slot", () => {
    let hub = withTerminals(9, 0);
    hub = apply(hub, { kind: "state", terminal: "t8", state: "done" }, H12, pick);
    for (const t of ["t1", "t2", "t3", "t4", "t5", "t6", "t7"]) hub = apply(hub, { kind: "state", terminal: t, state: "done" }, H12, pick);
    hub = expire(hub, H12 + 1);
    expect(hub.lanes.find((l) => l.terminal === "t0")).toBeUndefined();
    expect(hub.lanes.find((l) => l.terminal === "t8")!.slot).toBe(0);
  });

  test("keeps a lane idle for 12 h − 1 ms", () => {
    const hub = withTerminals(1, 0);
    expect(expire(hub, H12 - 1).lanes).toHaveLength(1);
  });
});

test("slotX spaces lanes 2 columns apart", () => {
  expect([0, 1, 2, 3, 4, 5, 6, 7].map(slotX)).toEqual([0, 2, 4, 6, 8, 10, 12, 14]);
});

describe("idle", () => {
  const mk = (state: Lane["state"], lastSeen: number): Lane => ({ terminal: state, slot: 0, state, color: PICKED, lastSeen });

  test("a done or error lane is idle once IDLE_MS has passed since it last reported", () => {
    expect(IDLE_MS).toBe(10 * 60_000);
    for (const state of ["done", "error"] as const) {
      expect(isIdle(mk(state, 1000), 1000 + IDLE_MS - 1)).toBe(false);
      expect(isIdle(mk(state, 1000), 1000 + IDLE_MS)).toBe(true);
    }
  });

  test("a working or waiting lane is never idle, however long it has been quiet", () => {
    for (const state of ["working", "waiting"] as const) expect(isIdle(mk(state, 0), 5 * IDLE_MS)).toBe(false);
  });

  test("idleAt is the earliest moment a still-live done or error lane turns idle, else null", () => {
    const hub: Hub = { lanes: [mk("working", 0), { ...mk("done", 4000), slot: 1 }, { ...mk("error", 1000), slot: 2 }] };
    expect(idleAt(hub, 2000)).toBe(1000 + IDLE_MS);
    expect(idleAt(hub, 1000 + IDLE_MS)).toBe(4000 + IDLE_MS);
    expect(idleAt(hub, 4000 + IDLE_MS)).toBeNull();
    expect(idleAt({ lanes: [mk("working", 0)] }, 0)).toBeNull();
  });
});
