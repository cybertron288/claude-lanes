import { handleRequest, hub, type Env } from "./routes";

export { StatusHub } from "./do";

export default {
  fetch: handleRequest,
  scheduled(_controller: unknown, env: Env, ctx: { waitUntil(p: Promise<unknown>): void }) {
    ctx.waitUntil(hub(env).fetch("https://hub/refresh", { method: "POST" }));
  },
};
