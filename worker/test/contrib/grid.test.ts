import { test, expect } from "bun:test";
import { buildGrid, WIDTH, HEIGHT } from "../../src/contrib/grid";

function fullWeek(level: number): number[] {
  return Array(7).fill(level);
}

test("grid is 128 pixels", () => {
  const grid = buildGrid([]);
  expect(grid.length).toBe(WIDTH * HEIGHT);
});

test("empty input is all off", () => {
  const grid = buildGrid([]);
  expect(grid.every((p) => p[0] === 0 && p[1] === 0 && p[2] === 0)).toBe(true);
});

test("bottom row (y=7) always off even with full data", () => {
  const weeks = Array(16).fill(fullWeek(4));
  const grid = buildGrid(weeks);
  for (let x = 0; x < WIDTH; x++) {
    expect(grid[7 * WIDTH + x]).toEqual([0, 0, 0]);
  }
});

test("newest week lands in rightmost column x=15", () => {
  const weeks = [...Array(15).fill(fullWeek(0)), fullWeek(4)];
  const grid = buildGrid(weeks);
  // Sunday (y=0) of newest week
  expect(grid[0 * WIDTH + 15]).toEqual([0, 211, 0]);
  // a level-0 older column is off
  expect(grid[0 * WIDTH + 0]).toEqual([0, 0, 0]);
});

test("only last 16 weeks kept; older dropped", () => {
  const weeks = [fullWeek(4), ...Array(16).fill(fullWeek(1))];
  const grid = buildGrid(weeks);
  // 17 weeks in → leftmost visible column should be a level-1 week, not the level-4 one
  expect(grid[0 * WIDTH + 0]).toEqual([0, 68, 0]);
});

test("fewer than 16 weeks left-pads with off columns", () => {
  const weeks = [fullWeek(4)]; // 1 week only
  const grid = buildGrid(weeks);
  expect(grid[0 * WIDTH + 0]).toEqual([0, 0, 0]);   // padded left
  expect(grid[0 * WIDTH + 15]).toEqual([0, 211, 0]); // the one real week, rightmost
});

test("partial current week: missing days are off", () => {
  const partial = [4, 4, 4]; // only Sun,Mon,Tue present
  const weeks = [...Array(15).fill(fullWeek(0)), partial];
  const grid = buildGrid(weeks);
  expect(grid[2 * WIDTH + 15]).toEqual([0, 211, 0]); // Tue present
  expect(grid[3 * WIDTH + 15]).toEqual([0, 0, 0]);     // Wed missing -> off
});
