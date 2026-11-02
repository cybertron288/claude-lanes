import { test, expect } from "bun:test";
import { levelToRGB, RAMP } from "../../src/contrib/ramp";

test("RAMP has 5 entries, level 0 is off", () => {
  expect(RAMP.length).toBe(5);
  expect(RAMP[0]).toEqual([0, 0, 0]);
});

test("levelToRGB maps each level", () => {
  expect(levelToRGB(0)).toEqual([0, 0, 0]);
  expect(levelToRGB(1)).toEqual([0, 68, 0]);
  expect(levelToRGB(2)).toEqual([0, 109, 0]);
  expect(levelToRGB(3)).toEqual([0, 166, 0]);
  expect(levelToRGB(4)).toEqual([0, 211, 0]);
});

test("the ramp is green only: any red or blue stays under 10% of the green, and green rises with level", () => {
  for (const [r, g, b] of RAMP.slice(1)) {
    expect(r).toBeLessThanOrEqual(g * 0.1);
    expect(b).toBeLessThanOrEqual(g * 0.1);
  }
  const greens = RAMP.map(([, g]) => g);
  expect(greens).toEqual([...greens].sort((a, b) => a - b));
  expect(new Set(greens).size).toBe(5);
});

test("levelToRGB clamps out-of-range", () => {
  expect(levelToRGB(-1)).toEqual([0, 0, 0]);
  expect(levelToRGB(9)).toEqual([0, 211, 0]);
});
