// A copy of shared/protocol.ts and worker/src/palette.ts's parseColor: a mod
// cannot import outside its folder. worker/test/mod-copy.test.ts keeps them equal.
export type RGB = [number, number, number]

export type LaneState = 'working' | 'done' | 'error' | 'waiting'

export type ClientEvent =
  | { kind: 'state'; terminal: string; state: LaneState }
  | { kind: 'color'; terminal: string; color: RGB }
  | { kind: 'end'; terminal: string }

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
}

export const COLOR_NAMES: readonly string[] = Object.keys(NAMED)

export function parseColor(input: string): RGB | null {
  const s = input.trim().toLowerCase()
  if (s in NAMED) return NAMED[s]!
  const m = /^#?([0-9a-f]{6})$/.exec(s)
  if (!m) return null
  const n = parseInt(m[1]!, 16)
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff]
}
