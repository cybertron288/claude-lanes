import type { ClientEvent } from "../../shared/protocol";
import type { HubEnv } from "./do";

type HubStub = { fetch(url: string, init?: RequestInit): Promise<Response> };

export type Env = HubEnv & {
  INGEST_TOKEN?: string;
  HUB: { idFromName(name: string): unknown; get(id: unknown): HubStub };
};

const STATES = new Set(["working", "done", "error", "waiting"]);
const byte = (v: unknown) => Number.isInteger(v) && (v as number) >= 0 && (v as number) <= 255;

export function isClientEvent(v: unknown): v is ClientEvent {
  if (typeof v !== "object" || v === null) return false;
  const e = v as Record<string, unknown>;
  if (typeof e.terminal !== "string" || e.terminal.length === 0 || e.terminal.length > 64) return false;
  if (e.kind === "state") return typeof e.state === "string" && STATES.has(e.state);
  if (e.kind === "color") return Array.isArray(e.color) && e.color.length === 3 && e.color.every(byte);
  return e.kind === "end";
}

export const hub = (env: Env) => env.HUB.get(env.HUB.idFromName("hub"));

export async function handleRequest(req: Request, env: Env): Promise<Response> {
  if (!env.INGEST_TOKEN || req.headers.get("Authorization") !== `Bearer ${env.INGEST_TOKEN}`) {
    return new Response("unauthorized", { status: 401 });
  }
  const path = new URL(req.url).pathname;

  if (path === "/event" && req.method === "POST") {
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return new Response("body is not JSON", { status: 400 });
    }
    if (!isClientEvent(body)) return new Response("not a ClientEvent", { status: 400 });
    await hub(env).fetch("https://hub/event", { method: "POST", body: JSON.stringify(body) });
    return new Response(null, { status: 204 });
  }

  if (path === "/state" && req.method === "GET") return hub(env).fetch("https://hub/state");

  return new Response("not found", { status: 404 });
}
