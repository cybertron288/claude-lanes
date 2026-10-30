// WLED effect ids and tuning for each lane look. Ids 0–2 are WLED's own Solid,
// Blink and Breathe. Sonar is Lighthouse (41, a comet with a fading tail),
// expanded as a bar (m12 = 1) down the 6-row lane and mirrored (mY) so each
// pulse leaves the lane's center for both ends, like sonar_wled.py's ring.
// Provisional until checked on the panel (plan Task 2 Step 6): if the pulse
// runs inward, add rY.
export type Effect = { fx: number; sx: number; ix: number; m12?: number; mY?: boolean; pal?: number };

export const FX = {
  solid: { fx: 0, sx: 128, ix: 128 },
  blink: { fx: 1, sx: 128, ix: 128 },
  breathe: { fx: 2, sx: 128, ix: 128 },
  sonar: { fx: 41, sx: 200, ix: 160, m12: 1, mY: true },
  // Sunrise (104) with speed above 120 loops rise and set, one cycle every
  // 131 s / (((sx - 120) >> 1) + 1): sx 124 is about 44 s. Speed 1–60 rises
  // once and then holds, so it would not breathe. Palette 3 fades from the
  // segment's first color to its second, so the glow takes its colors from
  // the segment and stays one hue.
  sunrise: { fx: 104, sx: 124, ix: 128, pal: 3 },
} as const satisfies Record<string, Effect>;
