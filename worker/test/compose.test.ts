import { describe, expect, test } from "bun:test";
import type { LaneState, RGB } from "../../shared/protocol";
import { AMBER, compose, DIMMED, DONE_GREEN, ERROR_RED, GLOW, WORKING_BLUE } from "../src/compose";
import { FX } from "../src/effects";
import { IDLE_MS, type Hub, type Lane } from "../src/lanes";

type Seg = Record<string, unknown> & { id: number };

const lane = (terminal: string, slot: number | null, state: LaneState, color: RGB = [1, 2, 3]): Lane => ({
  terminal,
  slot,
  state,
  color,
  lastSeen: 0,
});
const segs = (hub: Hub, idle: RGB[] | null = null, now = 0) => compose(hub, idle, 128, now).seg as Seg[];
const byId = (all: Seg[], id: number) => all.find((s) => s.id === id)!;
const idle: RGB[] = Array.from({ length: 128 }, (_, i) => [i, 0, 255 - i]);

describe("compose", () => {
  test("no slotted lanes with an idle frame: segment 0 is full-panel and carries the pixels as hex", () => {
    const s = byId(segs({ lanes: [] }, idle), 0);
    expect(s).toMatchObject({ start: 0, stop: 16, startY: 0, stopY: 8 });
    expect((s.i as string[]).length).toBe(128);
    expect((s.i as string[])[1]).toBe("0100FE");
  });

  test("no lanes and no idle frame: segment 0 is full-panel black, and on stays true", () => {
    const state = compose({ lanes: [] }, null, 128, 0);
    expect(state.on).toBe(true);
    expect(byId(state.seg as Seg[], 0)).toMatchObject({ start: 0, stop: 16, startY: 0, stopY: 8, fx: FX.solid.fx, col: [[0, 0, 0]] });
  });

  test("when every lane has been done or errored for 10 minutes, the panel shows the idle graph", () => {
    const hub = { lanes: [lane("a", 0, "done"), lane("b", 1, "error")] };
    const s = byId(segs(hub, idle, IDLE_MS), 0);
    expect(s).toMatchObject({ start: 0, stop: 16, startY: 0, stopY: 8 });
    expect((s.i as string[]).length).toBe(128);
    expect(byId(segs(hub, idle, IDLE_MS), 1)).toEqual({ id: 1, stop: 0 });
  });

  test("a done lane not yet 10 minutes quiet keeps the lanes up", () => {
    const hub = { lanes: [lane("a", 0, "done")] };
    expect(byId(segs(hub, idle, IDLE_MS - 1), 0)).toMatchObject({ start: 0, stop: 1, col: [DONE_GREEN] });
  });

  test("one live lane keeps every lane up, including the idle ones", () => {
    const hub = { lanes: [lane("a", 0, "done"), lane("b", 1, "working")] };
    const all = segs(hub, idle, 3 * IDLE_MS);
    expect(byId(all, 0)).toMatchObject({ start: 0, stop: 1, col: [DONE_GREEN] });
    expect(byId(all, 2)).toMatchObject({ start: 2, stop: 3, fx: FX.sonar.fx });
  });

  test("a lane that is working or waiting never lets the graph take over", () => {
    for (const state of ["working", "waiting"] as const) {
      const all = segs({ lanes: [lane("a", 0, state)] }, idle, 5 * IDLE_MS);
      expect(byId(all, 0)).toMatchObject({ start: 0, stop: 1 });
    }
  });

  test("three lanes: each gets a 1-column state segment over rows 0–6 and a strip over rows 6–8", () => {
    const all = segs({
      lanes: [lane("a", 0, "working", [9, 9, 9]), lane("b", 1, "done"), lane("c", 2, "error")],
    });
    expect(byId(all, 0)).toMatchObject({ start: 0, stop: 1, startY: 0, stopY: 6, fx: FX.sonar.fx, m12: 1, mY: true, col: [WORKING_BLUE] });
    expect(byId(all, 1)).toMatchObject({ start: 0, stop: 1, startY: 6, stopY: 8, fx: FX.solid.fx, mY: false, col: [[9, 9, 9]] });
    expect(byId(all, 2)).toMatchObject({ start: 2, stop: 3, startY: 0, stopY: 6, fx: FX.solid.fx, col: [DONE_GREEN] });
    expect(byId(all, 4)).toMatchObject({ start: 4, stop: 5, startY: 0, stopY: 6, fx: FX.blink.fx, col: [ERROR_RED] });
    expect(byId(all, 5)).toMatchObject({ start: 4, stop: 5, startY: 6, stopY: 8 });
    expect(DONE_GREEN).toEqual([20, 90, 10]);
  });

  test("a lane that just turned done breathes green for 20 s, then holds steady", () => {
    const hub = { lanes: [{ ...lane("a", 0, "done"), doneAt: 1000 }] };
    expect(byId(segs(hub, null, 20_999), 0)).toMatchObject({ fx: FX.breathe.fx, col: [DONE_GREEN] });
    expect(byId(segs(hub, null, 21_000), 0)).toMatchObject({ fx: FX.solid.fx, col: [DONE_GREEN] });
  });

  test("a done lane with no doneAt (a new session) is steady at once", () => {
    expect(byId(segs({ lanes: [lane("a", 0, "done")] }), 0)).toMatchObject({ fx: FX.solid.fx });
  });

  test("a waiting lane gets the spotlight: solid amber lane, its own strip, and the others dimmed", () => {
    const all = segs({ lanes: [lane("a", 0, "working", [9, 9, 9]), lane("b", 1, "waiting", [5, 5, 5]), lane("c", 2, "done")] });
    expect(byId(all, 2)).toMatchObject({ start: 2, stop: 3, startY: 0, stopY: 6, fx: FX.solid.fx, col: [AMBER], bri: 255 });
    expect(AMBER).toEqual([255, 150, 0]);
    expect(byId(all, 3)).toMatchObject({ start: 2, stop: 3, startY: 6, stopY: 8, col: [[5, 5, 5]], bri: 255 });
    expect(byId(all, 0)).toMatchObject({ start: 0, stop: 1, fx: FX.sonar.fx, col: [WORKING_BLUE], bri: DIMMED });
    expect(byId(all, 1)).toMatchObject({ start: 0, stop: 1, startY: 6, col: [[9, 9, 9]], bri: DIMMED });
    expect(byId(all, 4)).toMatchObject({ start: 4, stop: 5, col: [DONE_GREEN], bri: DIMMED });
    expect(byId(all, 5)).toMatchObject({ start: 4, stop: 5, startY: 6, bri: DIMMED });
  });

  test("the gap columns either side of a waiting lane breathe amber at glow opacity", () => {
    const all = segs({ lanes: [lane("a", 0, "working"), lane("b", 1, "waiting")] });
    expect(byId(all, 18)).toMatchObject({ start: 1, stop: 2, startY: 0, stopY: 6, fx: FX.breathe.fx, col: [AMBER], bri: GLOW });
    expect(byId(all, 19)).toMatchObject({ start: 3, stop: 4, startY: 0, stopY: 6, fx: FX.breathe.fx, col: [AMBER], bri: GLOW });
  });

  test("the glow stops at the panel edge: slot 0 has no left glow, slot 7 keeps its right one", () => {
    const all = segs({ lanes: [lane("a", 0, "waiting"), lane("b", 7, "waiting")] });
    expect(byId(all, 16)).toEqual({ id: 16, stop: 0 });
    expect(byId(all, 17)).toMatchObject({ start: 1, stop: 2 });
    expect(byId(all, 30)).toMatchObject({ start: 13, stop: 14 });
    expect(byId(all, 31)).toMatchObject({ start: 15, stop: 16 });
  });

  test("two waiting lanes both get the spotlight", () => {
    const all = segs({ lanes: [lane("a", 0, "waiting"), lane("b", 3, "done"), lane("c", 7, "waiting")] });
    expect(byId(all, 0)).toMatchObject({ col: [AMBER], bri: 255 });
    expect(byId(all, 14)).toMatchObject({ start: 14, stop: 15, col: [AMBER], bri: 255 });
    expect(byId(all, 1)).toMatchObject({ start: 0, stop: 1, startY: 6, bri: 255 });
    expect(byId(all, 15)).toMatchObject({ start: 14, stop: 15, startY: 6, bri: 255 });
    expect(byId(all, 6)).toMatchObject({ col: [DONE_GREEN], bri: DIMMED });
  });

  test("with nobody waiting, every lane is at full opacity and no glow is drawn", () => {
    const all = segs({ lanes: [lane("a", 0, "working"), lane("b", 1, "done")] });
    for (const id of [0, 1, 2, 3]) expect(byId(all, id)).toMatchObject({ bri: 255 });
    for (let id = 16; id < 32; id++) expect(byId(all, id)).toEqual({ id, stop: 0 });
  });

  test("a lane with slot null never draws a lane or strip", () => {
    const all = segs({ lanes: [lane("a", 0, "done"), lane("x", null, "error")] });
    expect(all.filter((s) => s.stop !== 0).map((s) => s.id)).toEqual([0, 1]);
  });

  test("a waiting lane with slot null has no lane to light, so segment 0 breathes amber over 16×6", () => {
    const shown = [0, 1, 2, 3, 4, 5, 6, 7].map((s) => lane(`t${s}`, s, "working"));
    const all = segs({ lanes: [...shown, lane("x", null, "waiting")] });
    expect(byId(all, 0)).toMatchObject({ start: 0, stop: 16, startY: 0, stopY: 6, fx: FX.breathe.fx, col: [AMBER] });
    expect(all.filter((s) => s.stop !== 0).map((s) => s.id)).toEqual([0]);
  });

  test("in the takeover, slotted waiting lanes keep their strips and nothing else draws", () => {
    const shown = [0, 1, 2, 3, 4, 5, 6, 7].map((s) => lane(`t${s}`, s, s === 2 ? "waiting" : "working", [5, 5, 5]));
    const all = segs({ lanes: [...shown, lane("x", null, "waiting")] });
    expect(byId(all, 5)).toMatchObject({ start: 4, stop: 5, startY: 6, stopY: 8, col: [[5, 5, 5]] });
    expect(all.filter((s) => s.stop !== 0).map((s) => s.id)).toEqual([0, 5]);
  });

  test("every id 0–31 appears once, in order; undrawn ones are { id, stop: 0 }", () => {
    const all = segs({ lanes: [lane("a", 3, "done")] });
    expect(all.map((s) => s.id)).toEqual(Array.from({ length: 32 }, (_, id) => id));
    expect(byId(all, 0)).toEqual({ id: 0, stop: 0 });
    expect(byId(all, 6)).toMatchObject({ start: 6, stop: 7 });
  });
});
