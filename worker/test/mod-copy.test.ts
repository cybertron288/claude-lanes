import { expect, test } from "bun:test";
import * as mod from "../../mod/cc-status-light/hooks/protocol";
import { COLOR_NAMES, parseColor } from "../src/palette";

// The mod keeps its own copy of parseColor (it cannot import outside its folder).
test("the mod's parseColor and color names match the Worker's", () => {
  expect([...mod.COLOR_NAMES]).toEqual([...COLOR_NAMES]);
  for (const input of [...COLOR_NAMES, " Pink ", "#FF00AA", "ff00aa", "#12345", "nope", "", "#gggggg"]) {
    expect(mod.parseColor(input)).toEqual(parseColor(input));
  }
});

test("the mod's ClientEvent copy has the same shape as shared/protocol.ts", async () => {
  const strip = (s: string) => s.replace(/\/\/.*\n/g, "").replace(/[\s;"']/g, "");
  const shared = await Bun.file(`${import.meta.dir}/../../shared/protocol.ts`).text();
  const copy = await Bun.file(`${import.meta.dir}/../../mod/cc-status-light/hooks/protocol.ts`).text();
  const types = (s: string) => strip(s).match(/exporttype.*?(?=exporttype|constNAMED|$)/g);
  expect(types(copy)).toEqual(types(shared));
});
