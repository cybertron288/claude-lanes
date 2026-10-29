// WLED effect ids and tuning for each lane look. Ids 0–2 are WLED's own Solid,
// Blink and Breathe. Shimmer is Running (15) with the 1D effect expanded as
// bars (m12 = 1) so it moves up the lane. Provisional until checked on the
// panel (plan Task 2 Step 6).
export type Effect = { fx: number; sx: number; ix: number; m12?: number };

export const FX = {
  solid: { fx: 0, sx: 128, ix: 128 },
  blink: { fx: 1, sx: 128, ix: 128 },
  breathe: { fx: 2, sx: 128, ix: 128 },
  shimmer: { fx: 15, sx: 160, ix: 128, m12: 1 },
} as const satisfies Record<string, Effect>;
