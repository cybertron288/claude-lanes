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

  private async armAlarm(): Promise<void> {
    if ((await this.ctx.storage.getAlarm()) === null) await this.ctx.storage.setAlarm(Date.now() + REPUBLISH_MS);
  }

  async fetch(req: Request): Promise<Response> {
    const path = new URL(req.url).pathname;
    await this.armAlarm();
    if (path === "/event") {
      await this.core.event((await req.json()) as ClientEvent);
      return new Response(null, { status: 204 });
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
    await this.ctx.storage.setAlarm(Date.now() + REPUBLISH_MS);
  }
}
