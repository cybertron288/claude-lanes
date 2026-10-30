// WLED effect ids and tuning for each lane look. Ids 0–2 are WLED's own Solid,
// Blink and Breathe. Sonar is Lighthouse (41, a comet with a fading tail),
// expanded as a bar (m12 = 1) down the 6-row lane and mirrored (mY) so each
// pulse leaves the lane's center for both ends, like sonar_wled.py's ring.
// Provisional until checked on the panel (plan Task 2 Step 6): if the pulse
// runs inward, add rY.
export type Effect = { fx: number; sx: number; ix: number; m12?: number; mY?: boolean };

export const FX = {
  solid: { fx: 0, sx: 128, ix: 128 },
  blink: { fx: 1, sx: 128, ix: 128 },
  breathe: { fx: 2, sx: 128, ix: 128 },
  sonar: { fx: 41, sx: 200, ix: 160, m12: 1, mY: true },
} as const satisfies Record<string, Effect>;
