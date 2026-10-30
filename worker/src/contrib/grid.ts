import { levelToRGB, type RGB } from "./ramp";

export const WIDTH = 16;
export const HEIGHT = 8;
export const WEEKDAYS = 7;

export function buildGrid(weeks: number[][]): RGB[] {
  // Initialize all pixels off.
  const grid: RGB[] = Array.from({ length: WIDTH * HEIGHT }, () => [0, 0, 0] as RGB);

  // Keep only the last WIDTH weeks; right-align so newest is x=WIDTH-1.
  const recent = weeks.slice(-WIDTH);
  const offset = WIDTH - recent.length; // left-pad amount

  for (let i = 0; i < recent.length; i++) {
    const x = offset + i;
    const week = recent[i]!;
    for (let y = 0; y < WEEKDAYS; y++) {
      const level = week[y];
      if (level === undefined) continue; // missing day -> stays off
      grid[y * WIDTH + x] = levelToRGB(level);
    }
    // y=7 intentionally left off.
  }

  return grid;
}
