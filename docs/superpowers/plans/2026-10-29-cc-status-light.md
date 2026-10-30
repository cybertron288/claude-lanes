# Claude Code status light: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show every interactive Claude Code session from two Macs on a 16×8 WLED
matrix. Each session gets a lane. A full-panel amber pulse means a session is
waiting for approval. The contribution graph shows when nothing runs.

**Architecture:**
- A Claude Code **mod** on each Mac derives each terminal's state from engine
  events and POSTs state changes to a **Cloudflare Worker**.
- One **Durable Object** in the Worker holds the lanes and composes a WLED JSON
  state. It publishes that state, retained, to a **public MQTT broker** over WSS.
- WLED subscribes over plaintext MQTT and animates with its built-in effects.

**Tech stack:**
- Bun + TypeScript for tooling, tests, the simulator and scripts.
- Cloudflare Workers + Durable Objects (free plan) via `wrangler`.
- A Claude Code mod (plugin-authoring API, `claude plugin test`).
- WLED JSON API over MQTT.

**Spec:** `docs/superpowers/specs/2026-10-29-cc-status-light-design.md`. Read it
first. Decisions there are not re-argued here.

## Global constraints

- Runtime and package manager: **bun** only (`bun install`, `bun test`, `bunx`).
  Never npm or yarn.
- Git identity: `user.name cybertron288`, `user.email ravi60353@gmail.com`.
  Commit messages end at the last line of prose: **no trailers or attribution**.
- Never commit or push to `main`. Work on `feat/status-light` (already exists,
  branched from `docs/design`). Push that branch and open PRs with
  `gh pr create`. Ravi merges.
- **Tests and type-check run only immediately before a push** (Ravi's rule). It
  replaces the usual "run it to see it fail / pass" steps. Each task writes its
  tests first, implements, then runs them once in its pre-push step. A failure
  there is fixed before pushing.
- Visual verification happens **in the browser** (simulator) via Claude in Chrome.
  Anything about how the physical panel *looks* goes back to Ravi to confirm.
  Never claim a look is right.
- Don't kill or start dev servers that someone else owns. Use ports other than 3000.
- Ask Ravi before anything that touches his Cloudflare account (`wrangler dev
  --remote`, `wrangler deploy`, `wrangler secret put`).
- Matrix: 16 columns × 8 rows. Lanes are 2 columns wide at x = 0, 3, 6, 9, 12.
  Max 5 lanes.
- Top 6 rows (y 0–5) show state. Bottom 2 rows (y 6–7) are the color strip.
- Colors:
  - working: blue upward shimmer
  - done: dim steady green `[20,90,40]`
  - error: red blink
  - takeover: amber `[255,150,0]` breathe over all 16×6 top rows, with only the
    waiting lanes' strips lit
- Random strip colors exclude amber, red, blue and green hues. `/led-color`
  overrides for the life of the terminal.
- Stale lane timeout: **12 h** without events.
- Nothing but `{terminal, state | color}` leaves a Mac. `ClientEvent` carries no
  `session_id`: the Worker keys only on the terminal, and the mod itself decides
  `end`. No paths, prompts or repo names. MQTT payloads carry only WLED state.
- The mod must never delay or fail a tool call. Network calls are never awaited
  inside a `tool.call` / `tool.check` chain.
- Composed WLED state always sends `on: true`. contrib-matrix found that WLED
  silently drops pixel data when one request turns it on *and* sets pixels. A
  dark panel is drawn as a black segment, never as `on: false`.

## Review focus

1. **Worker unreachable or slow.** Claude Code behaves exactly as without the mod.
   The next successful send catches the panel up. Test in Task 7.
2. **Mod installed but not configured** (`workerUrl` or `token` empty, as on
   MacBook 2 before setup). It sends nothing, shows no errors, and changes no
   tool call. Test in Task 7.
3. **Two permission dialogs open at once** (parallel subagents). The takeover holds
   until *both* resolve. Test in Task 7 (tracker) and Task 5 (two waiting lanes
   both keep strips).
4. **WLED reboots or reconnects.** The retained message restores the current
   frame without any new event. A `retain` flag test in Task 2 pins it, and
   Task 2 checks it on hardware.
5. **GitHub fetch fails during the hourly cron.** The idle frame keeps the last
   good graph and never blanks. Test in Task 6.

## File structure

```
package.json                 bun workspace root: scripts test, typecheck
tsconfig.json
.gitignore                   .env, node_modules, .wrangler
shared/protocol.ts           ClientEvent, LaneState, RGB: the mod ↔ Worker contract
worker/
  wrangler.toml              DO binding HUB, cron "0 * * * *", vars BROKER_URL, MQTT_TOPIC, BRIGHTNESS
  src/index.ts               handleRequest(): POST /event, GET /state; scheduled() cron
  src/hub.ts                 StatusHubCore (pure-ish) + StatusHub DO wrapper
  src/lanes.ts               pure reducer: apply(), expire(), slotX()
  src/palette.ts             pure: pickDistinctColor(), parseColor()
  src/compose.ts             pure: compose() → WledState
  src/effects.ts             real WLED fx ids/speeds, chosen in Task 2
  src/mqtt.ts                MQTT 3.1.1 encoders + publish() over WebSocket
  src/contrib/{github,grid,ramp}.ts   ported from ~/contrib-matrix/src
  test/*.test.ts, test/contrib/*.test.ts, test/fixtures/github-response.json
mod/cc-status-light/
  .claude-plugin/plugin.json userConfig: workerUrl, token (sensitive)
  hooks/hooks.json
  hooks/register.ts          event wiring, /led-color command
  hooks/tracker.ts           pure: terminal state from turn + ask events
  hooks/reporter.ts          serial, coalescing, fire-and-forget sender
  hooks/register.test.ts     claude plugin test
sim/sim.ts                   EXISTS (untracked): fake WLED, HTTP ingest; Task 3 adds MQTT
sim/fixtures/*.json          EXISTS: lanes.json, takeover.json; Task 2 adds idle.json
scripts/publish.ts           CLI: publish a JSON file to the topic (hardware checks)
spike/approval-signal/       throwaway mod (Task 1); FINDINGS.md kept
```

---

### Task 1: Spike: the "approved, tool now running" signal (Risk 0)

Throwaway. No tests and no polish. The deliverable is `spike/approval-signal/FINDINGS.md`.

**Files:**
- Create: `spike/approval-signal/` (mod: `.claude-plugin/plugin.json`, `hooks/hooks.json`, `hooks/register.ts`)
- Create: `spike/approval-signal/FINDINGS.md`

- [ ] **Step 1: Load the `plugin-authoring` skill** and read its `types/claude-code.d.ts`
  for `tool.check`, `tool.call`, `ui.render` (`ToolProgress`, `ToolUse`),
  `turn.step`, `turn.start`, `turn.complete`, `prompt.submit`, `session.start`,
  `session.end`. Also read `$.http.fetch` (does it take an `AbortSignal` or a
  timeout?), `$.command.register`, and how `userConfig` values marked sensitive
  reach the hooks.
- [ ] **Step 2: Write a logging mod.** For each event below, log
  `{event, tool, tool_use_id, decision, approver, reason, ms}` via `$.ui.toast`
  or the debug log:
  - `tool.check`, logging `await next(e)`'s verdict
  - `tool.call`, logging before and after `await next(e)`, with `deny` / `isError`
    / rejection
  - every `ui.render` of `ToolProgress` and `ToolUse`
  - `turn.step` tool chunks
  - `turn.complete` `reason`
  - `session.start` / `session.end` with every field
- [ ] **Step 3: Run the scenarios** in a session with the spike loaded
  (`claude --plugin-dir spike/approval-signal --debug`) and record the event order
  for each:
  1. Approve a `sleep 20 && echo hi` Bash call.
  2. Reject a Bash call.
  3. Press Esc at a dialog.
  4. Answer an `AskUserQuestion`.
  5. Approve a plan in plan mode.
  6. A subagent's tool asks.
  7. Repeat 1 in `acceptEdits` and `auto` modes.
  8. Run `/clear`, then `/resume` into an older session. Check whether
     module-level variables and `$.state` survive each, and what `session.end`
     carries for each versus quitting the process.
  9. Run `claude -p "say hi"` and record `session.start`'s `isInteractive` and
     `surface`.
  10. A Bash call that exits non-zero, with no dialog.
- [ ] **Step 4: Write FINDINGS.md.** Cover:
  - the event that fires within ~1 s of approval for a long tool, if one exists
  - the exact `tool.check` predicate that means "a dialog opens for a person"
  - how to tell reject from Esc from answered in the `tool.call` result
  - the exact `turn.complete` reason values, and which one means an API error
  - how to keep a stable terminal key across `/clear`, `/resume` and a mod reload
  - how to tell `/clear` / `/resume` from process exit on `session.end`
  - the interactive predicate
  - whether `$.http.fetch` can be aborted
- [ ] **Step 5: Gate.** If no approval signal exists, **stop and report to Ravi**.
  The fallback is "amber until the tool finishes" and needs his OK. Otherwise
  commit and push:

```bash
git add spike/ && git commit -m "spike: map permission-dialog signals for the mod" && git push -u origin feat/status-light
```

### Task 2: MQTT path to the real panel (Risks 1 and 2)

**Files:**
- Create: `package.json`, `tsconfig.json`, `.gitignore`, `shared/protocol.ts`, `worker/src/mqtt.ts`, `worker/src/effects.ts`, `scripts/publish.ts`, `sim/fixtures/idle.json`
- Modify: `sim/fixtures/lanes.json`, `sim/fixtures/takeover.json` (shimmer fx id)
- Create, then delete before commit: `worker/src/probe.ts`, `worker/wrangler.toml` (probe-only)
- Test: `worker/test/mqtt.test.ts`

**Interfaces:**
- Produces:
  - `encodeConnect(clientId: string, keepAliveSec?: number): Uint8Array`
  - `encodePublish(topic: string, payload: string, opts: { retain: boolean }): Uint8Array`
  - `encodeDisconnect(): Uint8Array`
  - `publish(brokerWssUrl: string, topic: string, payload: string): Promise<void>`,
    which connects with WebSocket subprotocol `mqtt`, waits for CONNACK return
    code 0, publishes QoS 0 retained, then disconnects. It rejects on timeout
    (5 s) or a non-zero CONNACK.
  - `shared/protocol.ts`:
    - `type RGB = [number, number, number]`
    - `type LaneState = 'working' | 'done' | 'error' | 'waiting'`
    - `type ClientEvent = { kind: 'state'; terminal: string; state: LaneState } | { kind: 'color'; terminal: string; color: RGB } | { kind: 'end'; terminal: string }`
  - `effects.ts`: `FX = { solid, blink, breathe, shimmer }`, each
    `{ fx: number; sx: number; ix: number }`. WLED's own ids are 0 Solid,
    1 Blink, 2 Breathe, which match the sim. Shimmer is the one to choose.

- [ ] **Step 1: Write failing tests** in `worker/test/mqtt.test.ts`:
  - `encodePublish('t', 'x', { retain: true })[0] === 0x31`
  - with `retain: false`, byte 0 is `0x30`
  - remaining-length uses varint: topic `'t'` with a 200-byte payload is
    2 + 1 + 200 = 203, so bytes 1–2 are `[0xCB, 0x01]`
  - `encodeConnect('c')` starts `0x10` and contains protocol name `MQTT`, level
    `4`, and the clean-session flag `0x02`
- [ ] **Step 2: Implement `worker/src/mqtt.ts`.** Pure encoders. `publish` uses
  the standard `WebSocket` (Bun and Workers both have it) with binary frames.
- [ ] **Step 3: Write `scripts/publish.ts`.** Usage: `bun scripts/publish.ts <file.json>`.
  It reads `BROKER_URL` (default `wss://broker.hivemq.com:8884/mqtt`) and
  `MQTT_TOPIC` from env, and publishes to `${MQTT_TOPIC}/api`.
- [ ] **Step 4: Fixtures.** `sim/fixtures/lanes.json` and `takeover.json` exist
  and use sim fx ids. Set their shimmer segments to `FX.shimmer.fx`. Add
  `sim/fixtures/idle.json`: one full-panel segment, id `11`, with a 128-pixel
  `i` array in compact hex form `["0E4429", ...]`.
- [ ] **Step 5: Ravi configures WLED.**
  - Sync Interfaces → MQTT: enable, broker `broker.hivemq.com:1883`, device
    topic = `MQTT_TOPIC`. That is a fresh 24-char random string; WLED caps the
    field at 32. Keep it in `.env`, which is gitignored.
  - LED Preferences: "Turn LEDs on after power up/reset" is on.
  - Ask Ravi to do both and confirm.
- [ ] **Step 6: Publish each fixture** and **ask Ravi to confirm on the panel**:
  - the segments land in the right cells
  - the effects animate
  - the 128-pixel idle frame applies whole
  - after power-cycling WLED, the last retained frame comes back, for both
    `lanes.json` and `idle.json`

  Tune `effects.ts` until the shimmer, blink and breathe match the approved
  mockups. If the idle payload is too large, record the fallback that works (hex
  `i`, split publishes, or preset) in `effects.ts` comments, and use it in Task 5.
- [ ] **Step 7: Worker-runtime probe (Risk 2).** Ask Ravi first. Write a probe
  `worker/src/probe.ts` whose `fetch` calls `publish()` with `takeover.json`, and
  a minimal `wrangler.toml`. Run `bunx wrangler dev --remote` and hit it once.
  Pass: the panel shows the takeover. If the Worker can't reach port 8884, try
  the broker's other WSS endpoints and record the working `BROKER_URL`. Delete
  the probe files afterwards; Task 6 writes the real `wrangler.toml`.
- [ ] **Step 8: Pre-push.** Run `bun test worker/test/mqtt.test.ts && bunx tsc --noEmit`.
  Expected: all pass, no type errors.
- [ ] **Step 9: Commit and push.**

```bash
git add package.json tsconfig.json .gitignore shared worker/src/mqtt.ts worker/src/effects.ts worker/test/mqtt.test.ts scripts sim/fixtures
git commit -m "feat: publish WLED state to the panel over public MQTT" && git push
```

### Task 3: Simulator subscribes to the topic

`sim/sim.ts` already exists, untracked. It is a fake WLED on `:8091` (`PORT`
overrides). It takes `POST /json/state`, merges segments by `id`, treats
`stop: 0` as delete, and draws `start/stop/startY/stopY`, `fx`, `col`, and `i`
in a browser page that polls `/frame`. Keep all of that.

**Files:**
- Modify: `sim/sim.ts`, `worker/src/mqtt.ts`
- Test: `worker/test/mqtt.test.ts`

**Interfaces:**
- Consumes: `FX` from `worker/src/effects.ts`; `encodeConnect` from Task 2.
- Produces:
  - `encodeSubscribe(topic: string, packetId: number): Uint8Array`
  - `decodePublish(packet: Uint8Array): { topic: string; payload: string } | null`
  - `bun sim/sim.ts`: when `MQTT_TOPIC` is set, it also subscribes to
    `${MQTT_TOPIC}/api` at `BROKER_URL` and feeds each payload into `apply()`.

- [ ] **Step 1: Write failing tests** in `worker/test/mqtt.test.ts`:
  - `encodeSubscribe('t', 1)[0] === 0x82`, and the last byte (requested QoS) is `0`
  - `decodePublish(encodePublish('a/api', '{"on":true}', { retain: true }))`
    returns `{ topic: 'a/api', payload: '{"on":true}' }`
  - `decodePublish` of a CONNACK (`[0x20, 0x02, 0, 0]`) returns `null`
- [ ] **Step 2: Implement `encodeSubscribe` and `decodePublish`.**
- [ ] **Step 3: Modify `sim/sim.ts`.** Add the MQTT subscription (reconnect
  every 5 s on close). Replace the page's hard-coded fx numbers with a map built
  from `FX`, so `FX.shimmer.fx` draws the existing upward wave.
- [ ] **Step 4: Verify in Chrome.** Run `bun sim/sim.ts` with `MQTT_TOPIC` set.
  Publish each fixture with `scripts/publish.ts`. The sim shows the same layout
  Ravi saw on the panel. Also `curl -X POST localhost:8091/json/state -d
  @sim/fixtures/lanes.json` still works.
- [ ] **Step 5: Pre-push, then commit and push.**
  - Run `bun test && bunx tsc --noEmit`.
  - `git add sim worker/src/mqtt.ts worker/test/mqtt.test.ts`
  - `git commit -m "feat: browser simulator subscribed to the panel topic"`, then push.

### Task 4: Palette and lane reducer (pure)

**Files:**
- Create: `worker/src/palette.ts`, `worker/src/lanes.ts`
- Test: `worker/test/palette.test.ts`, `worker/test/lanes.test.ts`

**Interfaces:**
- Consumes: `RGB`, `LaneState`, `ClientEvent` from `shared/protocol.ts`.
- Produces:
  - `pickDistinctColor(inUse: RGB[], rand: () => number): RGB`
  - `parseColor(input: string): RGB | null`. Accepts `#rrggbb`, `rrggbb`, and the
    names `cyan, violet, pink, magenta, teal, white, purple, lime, orange, red,
    blue, green, yellow`, case-insensitive, trimmed. Overrides may use reserved hues.
  - `COLOR_NAMES: readonly string[]` (for the `/led-color` error text)
  - `type Lane = { terminal: string; slot: number | null; state: LaneState; color: RGB; lastSeen: number }`
  - `type Hub = { lanes: Lane[] }`. Array order is arrival order.
  - `apply(hub: Hub, ev: ClientEvent, now: number, pick: (inUse: RGB[]) => RGB): Hub`
  - `expire(hub: Hub, now: number, ttlMs = 12 * 3600_000): Hub`
  - `slotX(slot: number): number` returns `slot * 3`

- [ ] **Step 1: Write failing tests.**
  - `pickDistinctColor`: over 1000 seeded draws the hue is never in a reserved
    band. Reserved bands: red 345–15°, amber 25–55°, green 90–150°, blue
    200–250°. The pick's hue distance from every `inUse` color is ≥ 40° while
    5 or fewer are in use.
  - `parseColor`: `'#FF00AA'` → `[255,0,170]`; `'ff00aa'` → `[255,0,170]`;
    `' Pink '` → a value; `'nope'` → `null`; `'#12345'` → `null`; `''` → `null`.
  - `apply`:
    - the first `state` or `color` event for an unknown terminal appends a lane
      with the lowest free slot and a picked color (a `color` event uses its own
      color instead)
    - a 6th terminal gets `slot: null`
    - `end` removes the lane, and the first `slot: null` lane in arrival order
      takes the freed slot
    - `end` for an unknown terminal returns the hub unchanged
    - a `color` event changes only that lane
    - a `state` event for a known terminal keeps its slot and color (this is the
      `/clear` continuity) and updates `lastSeen`
  - `expire`: a lane with `lastSeen` 12 h + 1 ms ago is removed, its slot
    reassigned; 12 h − 1 ms is kept.
- [ ] **Step 2: Implement `palette.ts` and `lanes.ts`.**
- [ ] **Step 3: Pre-push, then commit and push.**
  - Run `bun test && bunx tsc --noEmit`.
  - `git commit -m "feat: lane reducer and distinct strip colors"`, then push.

### Task 5: Composer and contribution frame (pure)

**Files:**
- Create: `worker/src/compose.ts`, `worker/src/contrib/{github,grid,ramp}.ts` (port from `~/contrib-matrix/src`)
- Test: `worker/test/compose.test.ts`, `worker/test/contrib/{github,grid,ramp}.test.ts` and `worker/test/fixtures/github-response.json` (port from `~/contrib-matrix/test`)

**Interfaces:**
- Consumes: `Hub`, `slotX` (Task 4); `FX` (Task 2); `RGB`.
- Produces:
  - `type WledState = { on: true; bri: number; seg: object[] }`
  - `compose(hub: Hub, idle: RGB[] | null, bri: number): WledState`
  - Segment id map, stable across frames: lane slot `s` → state segment `2s`,
    strip segment `2s + 1` (ids 0–9); takeover `10`; idle or black `11`.
  - Ported unchanged (swap their local `RGB` for `shared/protocol.ts`'s):
    `fetchContribution(token: string, username: string, fetchImpl?: typeof fetch): Promise<number[][]>`,
    `parseContribution(json: unknown): number[][]`, `buildGrid(weeks: number[][]): RGB[]`,
    `levelToRGB(level: number): RGB`.

- [ ] **Step 1: Write failing tests.**
  - No slotted lanes and `idle` set: segment `11` is full-panel and carries
    `idle` in the encoding Task 2 proved.
  - No lanes and `idle` null: segment `11` is full-panel solid `[0,0,0]`, and
    `on` is still `true`.
  - Three lanes (working, done, error) with no waiting: for each lane, a state
    segment at `x..x+2, y 0..6` with `FX.shimmer` / solid `[20,90,40]` /
    `FX.blink` red, and a strip segment at `y 6..8` in the lane color.
  - Any waiting lane: segment `10` is `0..16 × 0..6` with `FX.breathe` and amber
    `[255,150,0]`. Strip segments appear only for waiting lanes. Two waiting lanes
    give two strips.
  - Lanes with `slot: null` never render.
  - Every id 0–11 not drawn this frame is sent as `{ id, stop: 0 }`, so stale
    segments clear.
- [ ] **Step 2: Implement `compose.ts`. Port contrib** (code and tests).
- [ ] **Step 3: Verify.** Publish `compose()` output for the three test scenarios
  via `scripts/publish.ts` and check them in the sim (Chrome).
- [ ] **Step 4: Pre-push, then commit and push.**
  - Run `bun test && bunx tsc --noEmit`.
  - `git commit -m "feat: compose WLED state from lanes and contribution graph"`, then push.

### Task 6: Worker and Durable Object

**Files:**
- Create: `worker/wrangler.toml`, `worker/src/index.ts`, `worker/src/hub.ts`
- Test: `worker/test/hub.test.ts`, `worker/test/index.test.ts`

**Interfaces:**
- Consumes: `apply`, `expire`, `pickDistinctColor` (Task 4); `compose`,
  `fetchContribution`, `buildGrid` (Task 5); `publish` (Task 2).
- Produces:
  - `type Store = { get<T>(key: string): Promise<T | undefined>; put<T>(key: string, value: T): Promise<void> }`
  - `class StatusHubCore`:
    - `constructor(store: Store, publisher: (payload: string) => Promise<void>, clock: () => number, bri: number)`
    - `event(ev: ClientEvent): Promise<void>`
    - `alarm(): Promise<void>`: runs `expire`, then republishes
    - `refreshIdle(fetchGrid: () => Promise<RGB[]>): Promise<void>`
    - `snapshot(): Promise<{ hub: Hub; wled: WledState }>`
  - `REPUBLISH_MS = 15 * 60_000` (**builder's call**, pinned here)
  - `handleRequest(req: Request, env: Env): Promise<Response>` in `index.ts`:
    - `POST /event`, header `Authorization: Bearer <INGEST_TOKEN>`, body
      `ClientEvent`. Answers `204`; `401` on a bad or missing token; `400` on a
      malformed body.
    - `GET /state`, same auth. Returns `snapshot()` as JSON.
  - Secrets: `INGEST_TOKEN`, `GITHUB_TOKEN`, `GITHUB_USERNAME`. Vars: `BROKER_URL`
    (from Task 2 Step 7), `MQTT_TOPIC`, `BRIGHTNESS` (default 128).

- [ ] **Step 1: Write failing tests.**
  - `hub.test.ts`, with an in-memory `Store`, a recording publisher and a fake clock:
    - an event that changes composed output publishes once
    - an identical repeat publishes nothing
    - `alarm()` publishes the current state even when unchanged, and removes a
      lane idle for 12 h + 1 ms
    - `refreshIdle` with a rejecting `fetchGrid` keeps the previous idle frame
      and publishes nothing
    - `refreshIdle` success with no lanes publishes the new idle frame
    - a publisher that rejects does not throw out of `event()`, and the next
      `alarm()` publishes again
  - `index.test.ts`, with a fake `env.HUB` namespace:
    - no `Authorization` → `401`; wrong token → `401`
    - body `{"kind":"state"}` or non-JSON → `400`
    - a valid `state` event → `204`, forwarded to the hub once
- [ ] **Step 2: Implement `hub.ts`** (`StatusHub` DO wraps `StatusHubCore`, with
  storage via `ctx.storage` and the alarm re-armed every `REPUBLISH_MS`) and
  `index.ts` (auth, routing, `scheduled` → `refreshIdle`).
- [ ] **Step 3: Deploy.** Ask Ravi first: it creates resources on his Cloudflare
  account. Run `bunx wrangler deploy` from `worker/` and set the secrets with
  `bunx wrangler secret put`.
- [ ] **Step 4: Verify end to end.**
  - `curl` a sequence of events to `POST /event`, then watch the sim (Chrome) and
    ask Ravi to glance at the panel.
  - Pass: lanes appear, takeover pulses, `end` clears, and with no lanes the
    contribution graph shows.
- [ ] **Step 5: Pre-push, then commit and push.**
  - Run `bun test && bunx tsc --noEmit`.
  - `git commit -m "feat: Worker hub composes and publishes panel state"`, then push.

### Task 7: The mod (Risk 3)

**Files:**
- Create: `mod/cc-status-light/.claude-plugin/plugin.json`, `hooks/hooks.json`, `hooks/register.ts`, `hooks/tracker.ts`, `hooks/reporter.ts`
- Test: `mod/cc-status-light/hooks/register.test.ts`

**Interfaces:**
- Consumes: `ClientEvent`, `RGB`, `LaneState` and `parseColor`/`COLOR_NAMES`
  (copied into the mod, which can't import outside its folder; keep them
  identical to Tasks 2 and 4); the Worker API (Task 6); the predicates from
  `spike/approval-signal/FINDINGS.md`.
- Produces:
  - `createTracker(onState: (s: LaneState) => void)` with:
    - `sessionStart()`: base state `done`
    - `turnStart()`
    - `turnComplete(reason: string)`: `error` for the API-error reason named
      in FINDINGS.md, `done` for every other reason
    - `askStart(id: string)`
    - `askEnd(id: string)`
    - `approved(id: string)`

    State is `waiting` while any ask is open. Otherwise it is the base state.
    `onState` fires only on change.
  - `createReporter(send: (ev: ClientEvent, signal: AbortSignal) => Promise<unknown>, opts?: { debounceMs?: number; timeoutMs?: number })`,
    defaults `debounceMs = 250`, `timeoutMs = 3000`, with `report(ev): void`:
    - one request in flight at a time, aborted after `timeoutMs`
    - consecutive `state` events coalesce to the last one; `color` and `end`
      are never dropped and keep their order
    - errors are swallowed; unsent events stay queued and go with the next flush
  - `userConfig`: `workerUrl` (string), `token` (string, sensitive). If either
    is empty, the mod registers its hooks as no-ops and sends nothing.
  - Command `/led-color <color>`: `parseColor` → `color` event. On `null` it
    answers `Unknown color "<x>". Use #rrggbb or one of: <COLOR_NAMES joined by ", ">.`
  - Terminal key and `end` detection follow FINDINGS.md: `session.end` from
    `/clear` or `/resume` sends nothing; process exit sends `end`.

- [ ] **Step 1: Write failing tests.** Use `claude plugin test` and the
  `claude-code/testing` kit; see the skill's `reference.md`.
  - Tracker:
    - `askStart('a')`, then `askStart('b')`, then `askEnd('a')` stays `waiting`;
      a following `askEnd('b')` gives the base state
    - `approved('a')` ends ask `a`
    - `turnComplete(<API-error reason>)` gives `error`, and the next `turnStart`
      gives `working`
  - Reporter:
    - three `state` reports inside one window send once, with the last state
    - `send` rejects once: the next `report` sends the queued `color` and then
      the latest `state`
    - a `send` that never resolves is aborted after `timeoutMs`, and the queue
      moves on
  - Wiring (register):
    - an interactive `session.start` reports `done`
    - a `tool.check` resolving to the Task 1 "dialog opens" predicate reports
      `waiting`; the matching `tool.call` resolving with `deny` reports the
      base state
    - an `AskUserQuestion` `tool.call` reports `waiting` while its `next` is
      pending and the base state once it resolves
    - a `tool.call` resolving with `isError` and no dialog leaves the state
      `working`
    - a non-interactive `session.start` (per the Task 1 predicate) reports
      nothing, ever
    - with `send` rejecting or hanging, `tool.call` resolves while `send` is
      still pending
    - with `token` empty, a full turn with a dialog sends nothing and every
      `tool.call` resolves unchanged
    - `/led-color pink` sends a `color` event; `/led-color nope` sends nothing
      and answers the error text
    - `session.end` for process exit sends `end`; for `/clear` it sends nothing
- [ ] **Step 2: Implement `tracker.ts`, `reporter.ts` and `register.ts`.** `send`
  is `$.http.fetch` POST to `${workerUrl}/event` with the bearer token, passing
  the abort signal if FINDINGS.md says it takes one.
- [ ] **Step 3: Validate.** Run `claude plugin validate mod/cc-status-light`.
  Expected: no refusals.
- [ ] **Step 4: Verify live on MacBook 1.**
  - Load with `claude --plugin-dir mod/cc-status-light` in two terminals.
  - Walk through Task 1's scenarios 1–6 and 10, and watch the sim in Chrome.
    Pass: amber starts within ~1 s of each dialog and clears within ~1 s of each
    answer; scenario 10 never turns red.
  - Ask Ravi to confirm on the panel.
- [ ] **Step 5: Pre-push, then commit and push.**
  - Run `bun test && claude plugin test mod/cc-status-light && bunx tsc --noEmit`.
  - `git commit -m "feat: status light mod reports terminal state"`, then push.

### Task 8: Install on both Macs, retire the Windows job, docs

**Files:**
- Create: `.claude-plugin/marketplace.json` (repo-as-marketplace)
- Modify: `README.md` (replace stub), `CLAUDE.md` (drop "planned" from commands that now exist)

- [ ] **Step 1: Make the repo a marketplace** for `mod/cc-status-light` (format
  in `reference.md` → "Sharing a mod"). Install on MacBook 1 with
  `/plugin install cc-status-light --marketplace cybertron288/cc-status-light`
  and set `workerUrl` / `token`.
- [ ] **Step 2: Ravi installs the same on MacBook 2** (off-LAN). Verify a session
  there shows a lane in the sim and on the panel.
- [ ] **Step 3: Ravi deletes the `github-led` Windows scheduled task** (contrib-matrix).
  The Worker cron now owns the idle graph. Confirm the panel still shows it after
  an hour with no sessions.
- [ ] **Step 4: Write README.md** covering:
  - what it is
  - WLED MQTT setup (including "turn LEDs on after power up")
  - Worker deploy and secrets
  - mod install
  - `/led-color`
  - the simulator
  - the public-topic caveat
- [ ] **Step 5: Pre-push, then push, then open the PR.**
  - Run `bun test && claude plugin test mod/cc-status-light && bunx tsc --noEmit`.
  - Commit, push, `gh pr create --base main`, and give Ravi the link.
