import type { RGB } from "../../../shared/protocol";

export type { RGB };

export const RAMP: readonly RGB[] = [
  [0, 0, 0],
  [14, 68, 41],
  [0, 109, 50],
  [38, 166, 65],
  [57, 211, 83],
];

export function levelToRGB(level: number): RGB {
  const i = Math.max(0, Math.min(RAMP.length - 1, Math.trunc(level)));
  return RAMP[i]!;
}
