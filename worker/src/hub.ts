import type { ClientEvent, RGB } from "../../shared/protocol";
import { compose, type WledState } from "./compose";
import { apply, expire, type Hub } from "./lanes";
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
  private queue: Promise<void> = Promise.resolve();

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

  private flush(force: boolean): Promise<void> {
    this.queue = this.queue.then(async () => {
      const payload = JSON.stringify(compose(await this.hub(), await this.idle(), this.bri));
      if (!force && payload === (await this.store.get<string>("last"))) return;
      try {
        await this.publisher(payload);
        await this.store.put("last", payload);
      } catch {
        // The next alarm republishes.
      }
    });
    return this.queue;
  }

  // Read-modify-write of the hub, one at a time, so concurrent events never
  // overwrite each other.
  private writes: Promise<void> = Promise.resolve();
  private mutate(fn: (hub: Hub) => Hub): Promise<void> {
    this.writes = this.writes.then(async () => this.store.put("hub", fn(await this.hub())));
    return this.writes;
  }

  async event(ev: ClientEvent): Promise<void> {
    await this.mutate((hub) => apply(hub, ev, this.clock(), (inUse) => pickDistinctColor(inUse, this.rand)));
    await this.flush(false);
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

  async hasIdle(): Promise<boolean> {
    return (await this.idle()) !== null;
  }

  async snapshot(): Promise<{ hub: Hub; wled: WledState }> {
    const hub = await this.hub();
    return { hub, wled: compose(hub, await this.idle(), this.bri) };
  }
}
