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
- Never commit or push to `main`. Work on `feat/status-light`, branched from
  `docs/design` (which holds the spec and this plan). Push that branch and open
  PRs with `gh pr create`. Ravi merges.
- **Tests and type-check run only immediately before a push** (Ravi's rule). Each
  task writes its tests first, implements, then runs them once in its pre-push step.
  A failure there is fixed before pushing.
- Visual verification happens **in the browser** (simulator) via Claude in Chrome.
  Anything about how the physical panel *looks* goes back to Ravi to confirm.
  Never claim a look is right.
- Don't kill or start dev servers that someone else owns. Use ports other than 3000.
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
- Nothing but `{terminal, state | color}` leaves a Mac. No paths, prompts or repo
  names. MQTT payloads carry only WLED state.
- The mod must never delay or fail a tool call. Network calls are never awaited
  inside a `tool.call` / `tool.check` chain.

## Review focus

1. **Worker unreachable or slow.** Claude Code behaves exactly as without the mod.
   The next successful send catches the panel up. Test in Task 7.
2. **Two permission dialogs open at once** (parallel subagents). The takeover holds
   until *both* resolve. Test in Task 7 (tracker) and Task 4 (two waiting lanes
   both keep strips).
3. **WLED reboots or reconnects.** The retained message restores the current
   frame without any new event. Verified in Task 2 on hardware, and pinned by a
   `retain` flag test in Task 2.
4. **`/led-color` with garbage input.** It answers with an error listing valid
   forms and leaves the color unchanged. Test in Task 4 (`parseColor`) and Task 7
   (command).
5. **GitHub fetch fails during the hourly cron.** The idle frame keeps the last
   good graph and never blanks. Test in Task 6.

## File structure

```
package.json                 bun workspace root: scripts test, typecheck
tsconfig.json
shared/protocol.ts           ClientEvent, LaneState, RGB: the mod ↔ Worker contract
worker/
  wrangler.toml              DO binding HUB, cron "0 * * * *", vars BROKER_URL, MQTT_TOPIC
  src/index.ts               fetch router (POST /event, GET /state), scheduled() cron
  src/hub.ts                 StatusHub Durable Object: storage, alarm, publish on change
  src/lanes.ts               pure reducer: apply(), expire()
  src/palette.ts             pure: pickDistinctColor(), parseColor()
  src/compose.ts             pure: compose() → WledState
  src/effects.ts             WLED fx ids/speeds chosen in Task 2
  src/mqtt.ts                MQTT 3.1.1 encoders + publish() over WebSocket
  src/contrib/{github,grid,ramp}.ts   ported from cybertron288/contrib-matrix
  test/*.test.ts
mod/cc-status-light/
  .claude-plugin/plugin.json userConfig: workerUrl, token (sensitive)
  hooks/hooks.json
  hooks/register.ts          event wiring, /led-color command
  hooks/tracker.ts           pure: terminal state from turn + ask events
  hooks/reporter.ts          debounced fire-and-forget sender
  hooks/register.test.ts     claude plugin test
sim/sim.ts                   subscribes to the topic, renders WLED JSON in a browser
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
  `turn.step`, `turn.complete`, `session.start`, `session.end`.
- [ ] **Step 2: Write a logging mod.** For each event below, log
  `{event, tool, tool_use_id, decision, approver, ms}` via `$.ui.toast` or the
  debug log:
  - `tool.check`, logging `await next(e)`'s verdict
  - `tool.call`, logging before and after `await next(e)`, with `deny` / `isError`
    / rejection
  - every `ui.render` of `ToolProgress` and `ToolUse`
  - `turn.step` tool chunks
  - `turn.complete` `reason`
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
  8. Run `/clear`, then check whether module-level variables and `$.state`
     survive.
  9. Run `claude -p "say hi"` and record `session.start`'s `isInteractive` and
     `surface`.
- [ ] **Step 4: Write FINDINGS.md.** Cover:
  - the event that fires within ~1 s of approval for a long tool, if one exists
  - the exact `tool.check` predicate that means "a dialog opens for a person"
  - how to tell reject from Esc from answered in the `tool.call` result
  - how to keep a stable terminal key across `/clear` and a mod reload
  - the interactive predicate
- [ ] **Step 5: Gate.** If no approval signal exists, **stop and report to Ravi**.
  The fallback is "amber until the tool finishes" and needs his OK. Otherwise
  commit and push:

```bash
git add spike/ && git commit -m "spike: map permission-dialog signals for the mod" && git push -u origin feat/status-light
```

### Task 2: MQTT path to the real panel (Risks 1 and 3)

**Files:**
- Create: `package.json`, `tsconfig.json`, `shared/protocol.ts`, `worker/src/mqtt.ts`, `worker/src/effects.ts`, `scripts/publish.ts`, `scripts/fixtures/*.json`
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
  - `effects.ts`: `FX = { solid, blink, breathe, shimmer }`, each `{ fx: number; sx: number; ix: number }`

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
- [ ] **Step 4: Write hardware fixtures** in `scripts/fixtures/`:
  - `lanes.json`: 3 lanes, one per state, plus strips, as 2D segments with
    `start/stop/startY/stopY`, `fx`, `col`
  - `takeover.json`
  - `idle.json`: 128-pixel `i` array in compact hex form `["0E4429", ...]`
- [ ] **Step 5: Ravi configures WLED.** Sync Interfaces → MQTT: enable, broker
  `broker.hivemq.com:1883`, device topic = `MQTT_TOPIC` (a fresh 24-char random
  string, kept in `.env` which is gitignored). Ask Ravi to do this and confirm.
- [ ] **Step 6: Publish each fixture** and **ask Ravi to confirm on the panel**:
  - the segments land in the right cells
  - the effects animate
  - the 128-pixel idle frame applies whole
  - after power-cycling WLED, the last retained frame comes back

  Tune `effects.ts` until the shimmer, blink and breathe match the approved
  mockups. If the idle payload is too large, record the fallback that works (hex
  `i`, split publishes, or preset) in `effects.ts` comments, and use it in Task 5.
- [ ] **Step 7: Pre-push.** Run `bun test worker/test/mqtt.test.ts && bunx tsc --noEmit`.
  Expected: all pass, no type errors.
- [ ] **Step 8: Commit and push.**

```bash
git add package.json tsconfig.json shared worker/src/mqtt.ts worker/src/effects.ts worker/test/mqtt.test.ts scripts .gitignore
git commit -m "feat: publish WLED state to the panel over public MQTT" && git push
```

### Task 3: Simulator

**Files:**
- Create: `sim/sim.ts`

**Interfaces:**
- Consumes: `FX` from `worker/src/effects.ts`; WLED JSON shape from Task 2 fixtures.
- Produces: `bun sim/sim.ts` serves `http://localhost:8091`. It subscribes to
  `${MQTT_TOPIC}/api` (MQTT over WSS, a SUBSCRIBE encoder added to `mqtt.ts` with
  a test) and renders the latest state.

- [ ] **Step 1: Add `encodeSubscribe(topic: string, packetId: number): Uint8Array`**
  with a test: byte 0 is `0x82`, and it requests QoS 0.
- [ ] **Step 2: Write `sim/sim.ts`.** Render 2D segments and the `i` pixel arrays.
  Approximate `solid`, `blink`, `breathe` and `shimmer` client-side, matching the
  mockup timing. The approved mockup code in the brainstorm session is the visual
  reference.
- [ ] **Step 3: Verify in Chrome.** Publish each Task 2 fixture. The sim shows the
  same layout Ravi saw on the panel.
- [ ] **Step 4: Pre-push, then commit and push.**
  - Run `bun test && bunx tsc --noEmit`.
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
    blue, green, yellow`. Overrides may use reserved hues.
  - `type Lane = { terminal: string; slot: number | null; state: LaneState; color: RGB; lastSeen: number }`
  - `type Hub = { lanes: Lane[] }`
  - `apply(hub: Hub, ev: ClientEvent, now: number, pick: (inUse: RGB[]) => RGB): Hub`
  - `expire(hub: Hub, now: number, ttlMs = 12 * 3600_000): Hub`
  - `slotX(slot: number): number` returns `slot * 3`

- [ ] **Step 1: Write failing tests.**
  - `pickDistinctColor`: over 1000 seeded draws the hue is never in a reserved
    band. Reserved bands: red 345–15°, amber 25–55°, green 90–150°, blue
    200–250°. The pick's hue distance from every `inUse` color is ≥ 40° while
    5 or fewer are in use.
  - `parseColor`: `'#FF00AA'` → `[255,0,170]`; `'pink'` → a value; `'nope'` →
    `null`; `'#12345'` → `null`.
  - `apply`:
    - the first event for an unknown terminal takes the lowest free slot and a
      picked color
    - a 6th terminal gets `slot: null`
    - `end` frees the slot and the next `slot: null` lane takes it (oldest
      `lastSeen` first)
    - a `color` event changes only that lane
    - a `state` event for a known terminal keeps its slot and color (this is the
      `/clear` continuity)
  - `expire`: a lane with `lastSeen` 12 h + 1 ms ago is removed, its slot
    reassigned; 12 h − 1 ms is kept.
- [ ] **Step 2: Implement `palette.ts` and `lanes.ts`.**
- [ ] **Step 3: Pre-push, then commit and push.**
  - Run `bun test && bunx tsc --noEmit`.
  - `git commit -m "feat: lane reducer and distinct strip colors"`, then push.

### Task 5: Composer and contribution frame (pure)

**Files:**
- Create: `worker/src/compose.ts`, `worker/src/contrib/{github,grid,ramp}.ts` (port from `~/contrib-matrix/src`)
- Test: `worker/test/compose.test.ts`, `worker/test/contrib/*.test.ts` (port the existing contrib-matrix tests)

**Interfaces:**
- Consumes: `Hub`, `slotX` (Task 4); `FX` (Task 2); `RGB`.
- Produces:
  - `type WledState = { on: true; bri: number; seg: object[] }`
  - `compose(hub: Hub, idle: RGB[] | null, bri: number): WledState`
  - `fetchContribution(token, username, fetchImpl?)` and `buildGrid(weeks): RGB[]`,
    unchanged from contrib-matrix

- [ ] **Step 1: Write failing tests.**
  - No slotted lanes and `idle` set: one full-panel segment carrying `idle`
    pixels in the encoding Task 2 proved.
  - No lanes and `idle` null: an all-off state.
  - Three lanes (working, done, error) with no waiting: for each lane, a state
    segment at `x..x+2, y 0..6` with `FX.shimmer` / solid `[20,90,40]` /
    `FX.blink` red, and a strip segment at `y 6..8` in the lane color.
  - Any waiting lane: one segment `0..16 × 0..6` with `FX.breathe` and amber
    `[255,150,0]`. Strip segments appear only for waiting lanes. Two waiting lanes
    give two strips.
  - Lanes with `slot: null` never render.
  - Segment ids are stable, and ids unused this frame are sent as `{ id, stop: 0 }`
    so stale segments clear.
- [ ] **Step 2: Implement `compose.ts`. Port contrib.**
- [ ] **Step 3: Verify.** Publish `compose()` output for the three test scenarios
  via `scripts/publish.ts` and check them in the sim (Chrome).
- [ ] **Step 4: Pre-push, then commit and push.**
  - Run `bun test && bunx tsc --noEmit`.
  - `git commit -m "feat: compose WLED state from lanes and contribution graph"`, then push.

### Task 6: Worker and Durable Object (Risk 2)

**Files:**
- Create: `worker/wrangler.toml`, `worker/src/index.ts`, `worker/src/hub.ts`
- Test: `worker/test/hub.test.ts`

**Interfaces:**
- Consumes: `apply`, `expire` (Task 4); `compose`, `fetchContribution`, `buildGrid` (Task 5); `publish` (Task 2).
- Produces the HTTP API the mod calls:
  - `POST /event`, header `Authorization: Bearer <INGEST_TOKEN>`, body `ClientEvent`.
    Answers `204`; `401` on a bad token; `400` on a malformed body.
  - `GET /state`, same auth. Returns `{ hub, wled }` for debugging.
- Secrets: `INGEST_TOKEN`, `GITHUB_TOKEN`, `GITHUB_USERNAME`. Vars: `BROKER_URL`,
  `MQTT_TOPIC`, `BRIGHTNESS` (default 128).

- [ ] **Step 1: Write failing tests** for `hub.ts` logic factored as
  `class StatusHubCore { constructor(store, publisher, clock) }`:
  - an event that changes composed output publishes once
  - an identical repeat publishes nothing
  - the alarm handler runs `expire` and republishes every 15 min (**builder's call**
    on the value, pinned here)
  - a cron with a GitHub error keeps the previous idle frame and still republishes
    nothing new
  - a cron success with no lanes publishes the new idle frame
  - a publish failure is retried on the next alarm and never throws out of
    `fetch`
- [ ] **Step 2: Implement `hub.ts`** (DO wrapper over `StatusHubCore`, storage via
  `ctx.storage`) and `index.ts` (auth, routing, `scheduled` → hub `refreshIdle`).
- [ ] **Step 3: Deploy.** Run `bunx wrangler deploy` from `worker/` and set the
  secrets with `bunx wrangler secret put`. Ask Ravi before the first deploy: it
  creates resources on his Cloudflare account.
- [ ] **Step 4: Verify end to end.**
  - `curl` a sequence of events to `POST /event`, then watch the sim (Chrome) and
    ask Ravi to glance at the panel.
  - Pass: lanes appear, takeover pulses, `end` clears, and with no lanes the
    contribution graph shows.
- [ ] **Step 5: Pre-push, then commit and push.**
  - Run `bun test && bunx tsc --noEmit`.
  - `git commit -m "feat: Worker hub composes and publishes panel state"`, then push.

### Task 7: The mod

**Files:**
- Create: `mod/cc-status-light/.claude-plugin/plugin.json`, `hooks/hooks.json`, `hooks/register.ts`, `hooks/tracker.ts`, `hooks/reporter.ts`
- Test: `mod/cc-status-light/hooks/register.test.ts`

**Interfaces:**
- Consumes: `ClientEvent` (copied into the mod, which can't import outside its
  folder; keep it identical); the Worker API (Task 6); the predicates from
  `spike/approval-signal/FINDINGS.md`.
- Produces:
  - `createTracker(onState: (s: LaneState) => void)` with:
    - `turnStart()`
    - `turnComplete(reason: 'answer' | 'aborted' | 'refusal' | 'error')`
    - `askStart(id: string)`
    - `askEnd(id: string)`
    - `approved(id: string)`

    State is `waiting` while any ask is open. Otherwise it is the base state
    (`working` after `turnStart`, `done` after `answer`/`aborted`/`refusal`,
    `error` after `error`). `onState` fires only on change.
  - `createReporter(send: (ev: ClientEvent) => Promise<unknown>, debounceMs = 250)`
    with `report(ev)`, which coalesces to the last state per window and swallows
    errors.
  - `userConfig`: `workerUrl` (string), `token` (string, sensitive).
  - Command `/led-color <color>`: `parseColor` (copied from Task 4) → `color`
    event. On `null` it answers `Unknown color "<x>". Use #rrggbb or one of: <names>.`

- [ ] **Step 1: Write failing tests.** Use `claude plugin test` and the
  `claude-code/testing` kit; see the skill's `reference.md`.
  - Tracker:
    - `askStart('a')`, then `askStart('b')`, then `askEnd('a')` stays `waiting`;
      a following `askEnd('b')` gives the base state
    - `approved('a')` ends ask `a`
    - `turnComplete('error')` gives `error`, and the next `turnStart` gives `working`
  - Wiring (register): a `tool.check` resolving to the Task 1 "dialog opens"
    predicate reports `waiting`. The matching `tool.call` resolving with `deny`
    reports the base state.
  - A non-interactive `session.start` (per the Task 1 predicate) reports nothing,
    ever.
  - The reporter's `send` rejecting or hanging never delays `tool.call`'s
    resolution. Assert `tool.call` resolves while `send` is still pending.
  - `/led-color pink` sends a `color` event. `/led-color nope` sends nothing and
    answers the error text.
  - `session.end` with no new session following sends `end`.
- [ ] **Step 2: Implement `tracker.ts`, `reporter.ts` and `register.ts`.** Keep the
  terminal key the way FINDINGS.md proved stable.
- [ ] **Step 3: Validate.** Run `claude plugin validate mod/cc-status-light`.
  Expected: no refusals.
- [ ] **Step 4: Verify live on MacBook 1.**
  - Load with `claude --plugin-dir mod/cc-status-light` in two terminals.
  - Walk through Task 1's scenarios 1–6 and watch the sim in Chrome. Pass: amber
    starts within ~1 s of each dialog and clears within ~1 s of each answer.
  - Ask Ravi to confirm on the panel.
- [ ] **Step 5: Pre-push, then commit and push.**
  - Run `bun test && claude plugin test mod/cc-status-light && bunx tsc --noEmit`.
  - `git commit -m "feat: status light mod reports terminal state"`, then push.

### Task 8: Install on both Macs, retire the Windows job, docs

**Files:**
- Create: `.claude-plugin/marketplace.json` (repo-as-marketplace), `README.md` (replace stub)

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
  - WLED MQTT setup
  - Worker deploy and secrets
  - mod install
  - `/led-color`
  - the simulator
  - the public-topic caveat
- [ ] **Step 5: Pre-push, then push, then open the PR.**
  - Run `bun test && claude plugin test mod/cc-status-light && bunx tsc --noEmit`.
  - Commit, push, `gh pr create --base main`, and give Ravi the link.
