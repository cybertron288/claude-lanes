import type { RGB } from "../../shared/protocol";

// Hue bands the state colors own: red (error), amber (takeover), green (done),
// blue (working). A random strip color never lands in one.
const RESERVED: readonly [number, number][] = [
  [345, 15],
  [25, 55],
  [90, 150],
  [200, 250],
];

const NAMED: Record<string, RGB> = {
  cyan: [0, 220, 220],
  violet: [140, 80, 255],
  pink: [255, 90, 160],
  magenta: [255, 0, 200],
  teal: [0, 160, 140],
  white: [255, 255, 255],
  purple: [150, 40, 220],
  lime: [140, 255, 0],
  orange: [255, 110, 0],
  red: [255, 0, 0],
  blue: [0, 60, 255],
  green: [0, 200, 40],
  yellow: [255, 220, 0],
};

export const COLOR_NAMES: readonly string[] = Object.keys(NAMED);

export function isReserved(hue: number): boolean {
  return RESERVED.some(([a, b]) => (a <= b ? hue >= a && hue <= b : hue >= a || hue <= b));
}

export function hueDistance(a: number, b: number): number {
  const d = Math.abs(a - b) % 360;
  return Math.min(d, 360 - d);
}

// Hue in degrees, or null for a color too grey to have one (white).
export function hueOf([r, g, b]: RGB): number | null {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max === 0 || (max - min) / max < 0.15) return null;
  const d = max - min;
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return (h * 60 + 360) % 360;
}

function fromHue(hue: number): RGB {
  // Full value, 85% saturation: bright enough for a 2×2 strip.
  const s = 0.85;
  const f = (n: number) => {
    const k = (n + hue / 60) % 6;
    return Math.round(255 * (1 - s * Math.max(0, Math.min(k, 4 - k, 1))));
  };
  return [f(5), f(3), f(1)];
}

const ALLOWED: number[] = Array.from({ length: 360 }, (_, h) => h).filter((h) => !isReserved(h));

// The allowed hue farthest from every hue in use; ties broken by `rand`.
export function pickDistinctColor(inUse: RGB[], rand: () => number): RGB {
  const used = inUse.map(hueOf).filter((h): h is number => h !== null);
  if (used.length === 0) return fromHue(ALLOWED[Math.floor(rand() * ALLOWED.length)]!);
  let best = -1;
  let ties: number[] = [];
  for (const h of ALLOWED) {
    const gap = Math.min(...used.map((u) => hueDistance(h, u)));
    if (gap > best) {
      best = gap;
      ties = [h];
    } else if (gap === best) ties.push(h);
  }
  return fromHue(ties[Math.floor(rand() * ties.length)]!);
}

export function parseColor(input: string): RGB | null {
  const s = input.trim().toLowerCase();
  if (s in NAMED) return NAMED[s]!;
  const m = /^#?([0-9a-f]{6})$/.exec(s);
  if (!m) return null;
  const n = parseInt(m[1]!, 16);
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}
