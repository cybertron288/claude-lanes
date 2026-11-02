import type { ClientEvent, RGB } from "../../shared/protocol";
import { compose, type WledState } from "./compose";
import { apply, expire, idleAt, pulseEnd, type Hub } from "./lanes";
import { pickDistinctColor } from "./palette";

export type Store = {
  get<T>(key: string): Promise<T | undefined>;
  put<T>(key: string, value: T): Promise<void>;
};

export const REPUBLISH_MS = 15 * 60_000;

// The hub's logic, free of the Durable Object runtime so it can be tested.
export class StatusHubCore {
  // Publishes run one at a time, each composed from the latest stored state,
  // so a slow publish can never land after a newer one.
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    private store: Store,
    private publisher: (payload: string) => Promise<void>,
    private clock: () => number,
    private bri: number,
    private rand: () => number = Math.random,
  ) {}

  private async hub(): Promise<Hub> {
    return (await this.store.get<Hub>("hub")) ?? { lanes: [] };
  }

  private async idle(): Promise<RGB[] | null> {
    return (await this.store.get<RGB[]>("idle")) ?? null;
  }

  // Resolves true when the panel now shows the latest state (published, or
  // already current), false when the publish failed.
  private flush(force: boolean): Promise<boolean> {
    return this.serial("queue", async () => {
      const payload = JSON.stringify(compose(await this.hub(), await this.idle(), this.bri, this.clock()));
      if (!force && payload === (await this.store.get<string>("last"))) return true;
      try {
        await this.publisher(payload);
      } catch {
        return false; // the caller's retry or the next alarm republishes
      }
      await this.store.put("last", payload);
      return true;
    });
  }

  // Read-modify-write of the hub, one at a time, so concurrent events never
  // overwrite each other.
  private writes: Promise<unknown> = Promise.resolve();
  private mutate(fn: (hub: Hub) => Hub): Promise<void> {
    return this.serial("writes", async () => this.store.put("hub", fn(await this.hub())));
  }

  // Runs `step` after the chain's previous step. A step that fails rejects its
  // own caller only; the chain goes on for the next one.
  private serial<T>(chain: "queue" | "writes", step: () => Promise<T>): Promise<T> {
    const run = this[chain].then(step);
    this[chain] = run.catch(() => {});
    return run;
  }

  // Resolves false when the change is stored but the panel did not get it.
  async event(ev: ClientEvent): Promise<boolean> {
    await this.mutate((hub) => apply(hub, ev, this.clock(), (inUse) => pickDistinctColor(inUse, this.rand)));
    return this.flush(false);
  }

  async alarm(): Promise<void> {
    await this.mutate((hub) => expire(hub, this.clock()));
    await this.flush(true);
  }

  async refreshIdle(fetchGrid: () => Promise<RGB[]>): Promise<void> {
    let grid: RGB[];
    try {
      grid = await fetchGrid();
    } catch {
      return; // keep the last good graph
    }
    await this.store.put("idle", grid);
    await this.flush(false);
  }

  // When the panel next needs a republish: a done pulse ending or a lane turning
  // idle, whichever is first, else null.
  async wakeAt(): Promise<number | null> {
    const hub = await this.hub(), now = this.clock();
    const times = [pulseEnd(hub, now), idleAt(hub, now)].filter((t): t is number => t !== null);
    return times.length > 0 ? Math.min(...times) : null;
  }

  async hasIdle(): Promise<boolean> {
    return (await this.idle()) !== null;
  }

  async snapshot(): Promise<{ hub: Hub; wled: WledState }> {
    const hub = await this.hub();
    return { hub, wled: compose(hub, await this.idle(), this.bri, this.clock()) };
  }
}
