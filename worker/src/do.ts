import { DurableObject } from "cloudflare:workers";
import type { ClientEvent } from "../../shared/protocol";
import { buildGrid } from "./contrib/grid";
import { fetchContribution } from "./contrib/github";
import { REPUBLISH_MS, StatusHubCore } from "./hub";
import { publish } from "./mqtt";

export type HubEnv = {
  BROKER_URL: string;
  MQTT_TOPIC: string;
  BRIGHTNESS?: string;
  GITHUB_TOKEN?: string;
  GITHUB_USERNAME?: string;
};

// The Durable Object: one instance holds every lane.
export class StatusHub extends DurableObject<HubEnv> {
  private core: StatusHubCore;

  constructor(ctx: DurableObjectState, env: HubEnv) {
    super(ctx, env);
    const bri = Number(env.BRIGHTNESS ?? 128);
    this.core = new StatusHubCore(
      ctx.storage,
      (payload) => publish(env.BROKER_URL, `${env.MQTT_TOPIC}/api`, payload),
      () => Date.now(),
      Number.isFinite(bri) ? bri : 128,
    );
  }

  private refresh(): Promise<void> {
    const { GITHUB_TOKEN, GITHUB_USERNAME } = this.env;
    return this.core.refreshIdle(async () => {
      if (!GITHUB_TOKEN || !GITHUB_USERNAME) throw new Error("GitHub secrets not set");
      return buildGrid(await fetchContribution(GITHUB_TOKEN, GITHUB_USERNAME));
    });
  }

  // Wakes for the next republish, or sooner when a done pulse ends first.
  private async armAlarm(): Promise<void> {
    const set = await this.ctx.storage.getAlarm();
    const wake = Math.min(set ?? Date.now() + REPUBLISH_MS, (await this.core.wakeAt()) ?? Infinity);
    if (wake !== set) await this.ctx.storage.setAlarm(wake);
  }

  async fetch(req: Request): Promise<Response> {
    const path = new URL(req.url).pathname;
    await this.armAlarm();
    if (path === "/event") {
      // 503 when the broker did not take the frame, so the mod retries.
      const isShown = await this.core.event((await req.json()) as ClientEvent);
      await this.armAlarm();
      return new Response(null, { status: isShown ? 204 : 503 });
    }
    if (path === "/refresh") {
      await this.refresh();
      return new Response(null, { status: 204 });
    }
    return Response.json(await this.core.snapshot());
  }

  async alarm(): Promise<void> {
    if (!(await this.core.hasIdle())) await this.refresh();
    await this.core.alarm();
    await this.ctx.storage.setAlarm(Math.min(Date.now() + REPUBLISH_MS, (await this.core.wakeAt()) ?? Infinity));
  }
}
