import { test, expect } from "bun:test";
import { levelToRGB, RAMP } from "../../src/contrib/ramp";

test("RAMP has 5 entries, level 0 is off", () => {
  expect(RAMP.length).toBe(5);
  expect(RAMP[0]).toEqual([0, 0, 0]);
});

test("levelToRGB maps each level", () => {
  expect(levelToRGB(0)).toEqual([0, 0, 0]);
  expect(levelToRGB(1)).toEqual([14, 68, 41]);
  expect(levelToRGB(2)).toEqual([0, 109, 50]);
  expect(levelToRGB(3)).toEqual([38, 166, 65]);
  expect(levelToRGB(4)).toEqual([57, 211, 83]);
});

test("levelToRGB clamps out-of-range", () => {
  expect(levelToRGB(-1)).toEqual([0, 0, 0]);
  expect(levelToRGB(9)).toEqual([57, 211, 83]);
});
