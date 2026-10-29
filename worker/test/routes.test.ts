import { describe, expect, test } from "bun:test";
import { handleRequest, type Env } from "../src/routes";

function fakeEnv(token: string | undefined = "s3cret", hubStatus = 204) {
  const calls: { path: string; body: string }[] = [];
  const stub = {
    fetch: async (url: string, init?: RequestInit) => {
      calls.push({ path: new URL(url).pathname, body: String(init?.body ?? "") });
      return new Response(null, { status: hubStatus });
    },
  };
  const env = {
    INGEST_TOKEN: token,
    HUB: { idFromName: (n: string) => n, get: () => stub },
  } as unknown as Env;
  return { env, calls };
}

const post = (body: string, auth?: string) =>
  new Request("https://w/event", {
    method: "POST",
    body,
    headers: auth ? { Authorization: auth } : {},
  });
const valid = JSON.stringify({ kind: "state", terminal: "t1", state: "working" });

describe("handleRequest", () => {
  test("no Authorization header → 401", async () => {
    expect((await handleRequest(post(valid), fakeEnv().env)).status).toBe(401);
  });

  test("wrong token → 401", async () => {
    expect((await handleRequest(post(valid, "Bearer nope"), fakeEnv().env)).status).toBe(401);
  });

  test("an unset INGEST_TOKEN refuses everyone, including `Bearer undefined`", async () => {
    const { env } = fakeEnv(undefined);
    expect((await handleRequest(post(valid, "Bearer undefined"), env)).status).toBe(401);
    expect((await handleRequest(post(valid, "Bearer "), env)).status).toBe(401);
  });

  test('{"kind":"state"} without terminal or state → 400', async () => {
    expect((await handleRequest(post('{"kind":"state"}', "Bearer s3cret"), fakeEnv().env)).status).toBe(400);
  });

  test("non-JSON body → 400", async () => {
    expect((await handleRequest(post("not json", "Bearer s3cret"), fakeEnv().env)).status).toBe(400);
  });

  test("a color outside 0–255 → 400", async () => {
    const bad = JSON.stringify({ kind: "color", terminal: "t1", color: [300, 0, 0] });
    expect((await handleRequest(post(bad, "Bearer s3cret"), fakeEnv().env)).status).toBe(400);
  });

  test("a valid state event → 204, forwarded to the hub once", async () => {
    const { env, calls } = fakeEnv();
    expect((await handleRequest(post(valid, "Bearer s3cret"), env)).status).toBe(204);
    expect(calls).toEqual([{ path: "/event", body: valid }]);
  });

  test("a valid event the hub could not publish → 503, so the mod retries", async () => {
    const { env } = fakeEnv("s3cret", 503);
    expect((await handleRequest(post(valid, "Bearer s3cret"), env)).status).toBe(503);
  });

  test("GET /state with the token is forwarded to the hub", async () => {
    const { env, calls } = fakeEnv();
    const res = await handleRequest(new Request("https://w/state", { headers: { Authorization: "Bearer s3cret" } }), env);
    expect(res.status).toBe(204);
    expect(calls[0]!.path).toBe("/state");
  });
});
