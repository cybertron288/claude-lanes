import { describe, expect, test } from "bun:test";
import type { RGB } from "../../shared/protocol";
import { hueDistance, hueOf, isReserved, parseColor, pickDistinctColor } from "../src/palette";

function seeded(seed: number) {
  let s = seed;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}

describe("pickDistinctColor", () => {
  test("never lands in a reserved hue band over 1000 seeded draws", () => {
    const rand = seeded(42);
    for (let i = 0; i < 1000; i++) {
      const hue = hueOf(pickDistinctColor([], rand))!;
      expect(isReserved(Math.round(hue))).toBe(false);
    }
  });

  test("reserved bands are red 345–15, amber 25–55, green 90–150, blue 200–250", () => {
    for (const h of [345, 0, 15, 25, 40, 55, 90, 120, 150, 200, 225, 250]) expect(isReserved(h)).toBe(true);
    for (const h of [20, 70, 175, 300]) expect(isReserved(h)).toBe(false);
  });

  test("stays ≥ 40° from every hue in use while a visible lane picks (≤ 4 in use)", () => {
    const rand = seeded(7);
    for (let run = 0; run < 1000; run++) {
      const inUse: RGB[] = [];
      for (let k = 0; k < 5; k++) {
        const pick = pickDistinctColor(inUse, rand);
        for (const u of inUse) expect(hueDistance(hueOf(pick)!, hueOf(u)!)).toBeGreaterThanOrEqual(40);
        inUse.push(pick);
      }
    }
  });
});

describe("parseColor", () => {
  test("reads #rrggbb", () => expect(parseColor("#FF00AA")).toEqual([255, 0, 170]));
  test("reads rrggbb without the hash", () => expect(parseColor("ff00aa")).toEqual([255, 0, 170]));
  test("reads a name, trimmed and case-insensitive", () => expect(parseColor(" Pink ")).not.toBeNull());
  test("rejects an unknown name", () => expect(parseColor("nope")).toBeNull());
  test("rejects a 5-digit hex", () => expect(parseColor("#12345")).toBeNull());
  test("rejects empty input", () => expect(parseColor("")).toBeNull());
});
