import { describe, expect, test } from "bun:test";
import type { LaneState, RGB } from "../../shared/protocol";
import { AMBER, compose, DONE_GREEN, ERROR_RED, WORKING_BLUE } from "../src/compose";
import { FX } from "../src/effects";
import type { Hub, Lane } from "../src/lanes";

type Seg = Record<string, unknown> & { id: number };

const lane = (terminal: string, slot: number | null, state: LaneState, color: RGB = [1, 2, 3]): Lane => ({
  terminal,
  slot,
  state,
  color,
  lastSeen: 0,
});
const segs = (hub: Hub, idle: RGB[] | null = null) => compose(hub, idle, 128).seg as Seg[];
const byId = (all: Seg[], id: number) => all.find((s) => s.id === id)!;
const idle: RGB[] = Array.from({ length: 128 }, (_, i) => [i, 0, 255 - i]);

describe("compose", () => {
  test("no slotted lanes with an idle frame: segment 11 is full-panel and carries the pixels as hex", () => {
    const s = byId(segs({ lanes: [] }, idle), 11);
    expect(s).toMatchObject({ start: 0, stop: 16, startY: 0, stopY: 8 });
    expect((s.i as string[]).length).toBe(128);
    expect((s.i as string[])[1]).toBe("0100FE");
  });

  test("no lanes and no idle frame: segment 11 is full-panel black, and on stays true", () => {
    const state = compose({ lanes: [] }, null, 128);
    expect(state.on).toBe(true);
    expect(byId(state.seg as Seg[], 11)).toMatchObject({ start: 0, stop: 16, startY: 0, stopY: 8, fx: FX.solid.fx, col: [[0, 0, 0]] });
  });

  test("three lanes: each gets a state segment over rows 0–6 and a strip over rows 6–8", () => {
    const all = segs({
      lanes: [lane("a", 0, "working", [9, 9, 9]), lane("b", 1, "done"), lane("c", 2, "error")],
    });
    expect(byId(all, 0)).toMatchObject({ start: 0, stop: 2, startY: 0, stopY: 6, fx: FX.shimmer.fx, m12: 1, col: [WORKING_BLUE] });
    expect(byId(all, 1)).toMatchObject({ start: 0, stop: 2, startY: 6, stopY: 8, fx: FX.solid.fx, col: [[9, 9, 9]] });
    expect(byId(all, 2)).toMatchObject({ start: 3, stop: 5, startY: 0, stopY: 6, fx: FX.solid.fx, col: [DONE_GREEN] });
    expect(byId(all, 4)).toMatchObject({ start: 6, stop: 8, startY: 0, stopY: 6, fx: FX.blink.fx, col: [ERROR_RED] });
    expect(byId(all, 5)).toMatchObject({ start: 6, stop: 8, startY: 6, stopY: 8 });
    expect(DONE_GREEN).toEqual([20, 90, 40]);
  });

  test("any waiting lane: segment 10 breathes amber over 16×6 and only waiting strips stay", () => {
    const all = segs({ lanes: [lane("a", 0, "working"), lane("b", 1, "waiting", [5, 5, 5]), lane("c", 2, "done")] });
    expect(byId(all, 10)).toMatchObject({ start: 0, stop: 16, startY: 0, stopY: 6, fx: FX.breathe.fx, col: [AMBER] });
    expect(AMBER).toEqual([255, 150, 0]);
    expect(byId(all, 3)).toMatchObject({ start: 3, stop: 5, startY: 6, stopY: 8, col: [[5, 5, 5]] });
    for (const id of [0, 1, 2, 4, 5, 11]) expect(byId(all, id)).toEqual({ id, stop: 0 });
  });

  test("two waiting lanes give two strips", () => {
    const all = segs({ lanes: [lane("a", 0, "waiting"), lane("b", 4, "waiting")] });
    expect(byId(all, 1)).toMatchObject({ start: 0, stop: 2, startY: 6 });
    expect(byId(all, 9)).toMatchObject({ start: 12, stop: 14, startY: 6 });
  });

  test("a lane with slot null never renders", () => {
    const all = segs({ lanes: [lane("a", 0, "done"), lane("x", null, "waiting")] });
    expect(byId(all, 10)).toEqual({ id: 10, stop: 0 });
    expect(all.filter((s) => s.stop !== 0).map((s) => s.id)).toEqual([0, 1]);
  });

  test("every id 0–11 appears once, in order; undrawn ones are { id, stop: 0 }", () => {
    const all = segs({ lanes: [lane("a", 3, "done")] });
    expect(all.map((s) => s.id)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    expect(byId(all, 0)).toEqual({ id: 0, stop: 0 });
    expect(byId(all, 6)).toMatchObject({ start: 9, stop: 11 });
  });
});
