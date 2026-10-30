import type { RGB } from "../../../shared/protocol";

export type { RGB };

// GitHub's green steps (68, 109, 166, 211) with the red and blue taken out: on
// WS2812B the original mixes read as teal. Level 0 is off.
export const RAMP: readonly RGB[] = [
  [0, 0, 0],
  [0, 68, 0],
  [0, 109, 0],
  [0, 166, 0],
  [0, 211, 0],
];

export function levelToRGB(level: number): RGB {
  const i = Math.max(0, Math.min(RAMP.length - 1, Math.trunc(level)));
  return RAMP[i]!;
}
