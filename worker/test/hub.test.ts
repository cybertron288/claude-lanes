import { describe, expect, test } from "bun:test";
import type { RGB } from "../../shared/protocol";
import { StatusHubCore, type Store } from "../src/hub";

const H12 = 12 * 3600_000;

function memoryStore(): Store {
  const m = new Map<string, unknown>();
  return {
    get: async <T>(k: string) => m.get(k) as T | undefined,
    put: async <T>(k: string, v: T) => void m.set(k, structuredClone(v)),
  };
}

function setup() {
  const sent: string[] = [];
  let fail = false;
  let now = 1000;
  const core = new StatusHubCore(
    memoryStore(),
    async (p) => {
      if (fail) throw new Error("broker down");
      sent.push(p);
    },
    () => now,
    128,
  );
  return {
    core,
    sent,
    setFail: (v: boolean) => (fail = v),
    tick: (ms: number) => (now += ms),
  };
}

const grid: RGB[] = Array.from({ length: 128 }, () => [0, 109, 50]);

describe("StatusHubCore", () => {
  test("an event that changes the composed output publishes once", async () => {
    const { core, sent } = setup();
    await core.event({ kind: "state", terminal: "a", state: "working" });
    expect(sent).toHaveLength(1);
    expect(JSON.parse(sent[0]!).seg[0]).toMatchObject({ id: 0, start: 0, stop: 1 });
  });

  test("an identical repeat publishes nothing", async () => {
    const { core, sent, tick } = setup();
    await core.event({ kind: "state", terminal: "a", state: "working" });
    tick(5000);
    await core.event({ kind: "state", terminal: "a", state: "working" });
    expect(sent).toHaveLength(1);
  });

  test("alarm() republishes unchanged state and removes a lane idle for 12 h + 1 ms", async () => {
    const { core, sent, tick } = setup();
    await core.event({ kind: "state", terminal: "a", state: "done" });
    await core.alarm();
    expect(sent).toHaveLength(2);
    expect(sent[1]).toBe(sent[0]!);
    tick(H12 + 1);
    await core.alarm();
    expect((await core.snapshot()).hub.lanes).toHaveLength(0);
    expect(JSON.parse(sent[2]!).seg[0]).toMatchObject({ id: 0, stop: 16, col: [[0, 0, 0]] });
  });

  test("a finished task pulses, wakeAt names the pulse end, and alarm() then publishes it steady", async () => {
    const { core, sent, tick } = setup();
    await core.event({ kind: "state", terminal: "a", state: "working" });
    tick(5000);
    await core.event({ kind: "state", terminal: "a", state: "done" });
    expect(JSON.parse(sent.at(-1)!).seg[0]).toMatchObject({ id: 0, fx: 2 });
    expect(await core.wakeAt()).toBe(6000 + 20_000);
    tick(20_000);
    await core.alarm();
    expect(JSON.parse(sent.at(-1)!).seg[0]).toMatchObject({ id: 0, fx: 0 });
    expect(await core.wakeAt()).toBeNull();
  });

  test("refreshIdle with a failing fetch keeps the previous idle frame and publishes nothing", async () => {
    const { core, sent } = setup();
    await core.refreshIdle(async () => grid);
    expect(sent).toHaveLength(1);
    await core.refreshIdle(async () => {
      throw new Error("GitHub HTTP 502");
    });
    expect(sent).toHaveLength(1);
    expect((await core.snapshot()).wled.seg[0]).toMatchObject({ id: 0, i: expect.any(Array) });
  });

  test("refreshIdle success with no lanes publishes the new idle frame", async () => {
    const { core, sent } = setup();
    await core.refreshIdle(async () => grid);
    expect(JSON.parse(sent[0]!).seg[0].i[0]).toBe("006D32");
  });

  test("a failing publisher never throws out of event(), and the next alarm() publishes", async () => {
    const { core, sent, setFail } = setup();
    setFail(true);
    expect(await core.event({ kind: "state", terminal: "a", state: "waiting" })).toBe(false);
    expect(sent).toHaveLength(0);
    setFail(false);
    await core.alarm();
    expect(JSON.parse(sent[0]!).seg[0]).toMatchObject({ id: 0, stop: 16, fx: 2 });
  });

  test("event() resolves true once published, and true again for a no-op repeat", async () => {
    const { core } = setup();
    expect(await core.event({ kind: "state", terminal: "a", state: "done" })).toBe(true);
    expect(await core.event({ kind: "state", terminal: "a", state: "done" })).toBe(true);
  });

  test("one storage error fails only its own event; the next one lands", async () => {
    const store = memoryStore();
    let failPut = true;
    const flaky: Store = {
      get: store.get,
      put: async (k, v) => {
        if (failPut) {
          failPut = false;
          throw new Error("storage hiccup");
        }
        return store.put(k, v);
      },
    };
    const sent: string[] = [];
    const core = new StatusHubCore(flaky, async (p) => void sent.push(p), () => 0, 128);
    await expect(core.event({ kind: "state", terminal: "a", state: "working" })).rejects.toThrow("storage hiccup");
    expect(await core.event({ kind: "state", terminal: "b", state: "done" })).toBe(true);
    expect((await core.snapshot()).hub.lanes.map((l) => l.terminal)).toEqual(["b"]);
  });

  test("concurrent events from two terminals both land", async () => {
    const { core } = setup();
    await Promise.all([
      core.event({ kind: "state", terminal: "a", state: "working" }),
      core.event({ kind: "state", terminal: "b", state: "done" }),
    ]);
    expect((await core.snapshot()).hub.lanes.map((l) => [l.terminal, l.slot])).toEqual([
      ["a", 0],
      ["b", 1],
    ]);
  });

  test("overlapping events publish in order, and the last publish is the latest state", async () => {
    const sent: string[] = [];
    const releases: (() => void)[] = [];
    const core = new StatusHubCore(
      memoryStore(),
      (p) => new Promise<void>((r) => releases.push(() => (sent.push(p), r()))),
      () => 0,
      128,
    );
    const first = core.event({ kind: "state", terminal: "a", state: "working" });
    const second = core.event({ kind: "state", terminal: "a", state: "waiting" });
    while (releases.length === 0) await Bun.sleep(1);
    releases.shift()!();
    while (releases.length === 0) await Bun.sleep(1);
    releases.shift()!();
    await Promise.all([first, second]);
    expect(JSON.parse(sent.at(-1)!).seg[0]).toMatchObject({ id: 0, stop: 16, fx: 2 });
  });
});
