# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What it is

Claude Code session status on a 16×8 WLED LED matrix. Each interactive session
gets a lane. A waiting session's lane turns solid amber between two breathing
amber columns while the other lanes dim (Spotlight). With no
live sessions, or when every lane has been `done`/`error` for `IDLE_MS` (10 min),
the panel shows the GitHub contribution graph. `README.md` has setup.

## Architecture

```
Claude Code mod (each machine) ─HTTPS+bearer─▶ Cloudflare Worker + Durable Object
                                                  │ composes WLED JSON state
                                                  ▼
                         public MQTT broker (WSS, retained) ─▶ WLED (plaintext 1883)
```

- **Mod** (`mod/cc-status-light/hooks/`): `register.ts` wires engine events into
  `tracker.ts` (pure lane state machine) and `reporter.ts` (debounced, serial,
  retrying sender). Built with the `plugin-authoring` skill; the engine lays its
  API types in `.claude-plugin/types/` (self-gitignored). Which events mean
  "dialog open" and "answered" is in `spike/approval-signal/FINDINGS.md`: read it
  before touching the wiring.
  - Dialog open: `tool.check` with `tool_use_id`, `approver: 'person'` and verdict
    `ask` (`isDialogAsk`), counted only after a 1 s grace and once the
    `Spinner` has been quiet 800 ms (a classifier answers `ask`, keeps the
    Spinner drawing, then approves silently; a dialog hides it).
  - Answered: a `ToolGroup`/`ToolUse` render with `isRunning: true` for that id,
    or the `tool.call` result at the latest. Subagent calls never render.
  - `turn.*` events with `agentId` are subagent loops: they never set the base
    state, but while any runs a `done` main loop shows `working` (a background
    agent outlives the turn that started it).
  - Never use `classic.*` events: `cc-plugin-sec-default` swallows them on
    Ravi's machines.
  - `protocol.ts` copies `shared/protocol.ts` and `parseColor` (a mod cannot
    import outside its folder); `worker/test/mod-copy.test.ts` keeps them equal.
- **Worker** (`worker/src/`): `index.ts` is the entry; `routes.ts` does auth and
  validation; `do.ts` is the `StatusHub` Durable Object, a thin wrapper over
  `StatusHubCore` in `hub.ts`. The core serializes hub writes and publishes, and
  each publish composes the latest state. Pure logic: `lanes.ts` (reducer),
  `palette.ts`, `compose.ts`. `do.ts` imports `cloudflare:workers`, so tests
  never import it; `cloudflare.d.ts` types that module for `tsc`.
- **Done pulse:** a lane that turns `done` from another state gets `doneAt`;
  `compose` breathes it for `DONE_PULSE_MS` (20 s), and the Durable Object
  sets its alarm to the pulse end (`wakeAt`) to republish it steady.
- **Segment ids** are stable: lane slot s → state `2s`, strip `2s+1`, and a
  waiting lane's glow `16+2s` (left) and `17+2s` (right). The takeover and the
  idle or black frame reuse `0` (neither draws lane 0). Ids 0–15 fit an
  ESP8266's segment limit and WLED ignores ids past its limit, so an ESP8266
  loses only the glow. Every frame sends all 32, unused ones as
  `{ id, stop: 0 }`, every drawn segment carries `bri` (segment opacity: 255,
  or `DIMMED` for the other lanes while one waits), and always `on: true`
  (WLED drops pixels when one request turns it on and sets them).
- **Idle:** `isIdle` (`lanes.ts`) is a `done`/`error` lane quiet for 10 min;
  `working` and `waiting` never idle. `compose` shows the graph when every lane
  is idle (graph pixels on segment 0, rows 0–6; a looping warm Sunrise (Fire palette), fx 104 with
  speed > 120, on segment 1, row 7), and `wakeAt` includes `idleAt` so the alarm republishes at the switch.
  Lanes stay in the hub until the 12 h `expire`.
- **Waiting (Spotlight):** the full-panel amber takeover is only for a waiting
  lane with `slot: null` (a 9th terminal has no column to light).
- **MQTT** (`worker/src/mqtt.ts`): hand-written MQTT 3.1.1 over WebSocket. Broker
  is `broker.emqx.io` (HiveMQ's public broker stalled CONNACK in testing).
- **Contribution graph** (`worker/src/contrib/`): ported from
  `cybertron288/contrib-matrix` with its tests.
- **Simulator** (`sim/sim.ts`): fake WLED. Subscribes to `${MQTT_TOPIC}/api` like
  the panel, also takes `POST /json/state`, and draws at `/`. Effect looks are
  mapped from `FX` in `worker/src/effects.ts`.

## Invariants

- The mod must never delay or fail a tool call: no network `await` inside a
  `tool.call` / `tool.check` hook, and those hooks carry a pass-through `.catch`.
- Report only interactive sessions (`session.start` `isInteractive === true`).
- Lanes key on a terminal key, held in a module variable (survives `/clear`,
  `/resume`) mirrored into `$.state` (survives a reload).
- Nothing leaves a machine except `{terminal, state | color}`. MQTT payloads carry
  only WLED state. The topic is a secret: never commit or print it.
- Layout: lanes 1 column wide at x = 0, 2, 4 … 14 (max 8; a 9th is tracked
  with `slot: null`). Rows 0–5 show state, rows 6–7 the color strip.

## Commands

Bun only.

```bash
bun test                                  # Worker tests (bunfig.toml roots them in worker/)
bun test worker/test/lanes.test.ts        # one file
claude plugin test mod/cc-status-light    # mod tests
bunx tsc --noEmit                         # type-check shared/, worker/, scripts/, sim/
bunx tsc -p mod/cc-status-light           # type-check the mod (after the engine laid its types)
claude plugin validate mod/cc-status-light
claude --plugin-dir mod/cc-status-light   # load the mod live
bun sim/sim.ts                            # simulator on :8091 (PORT overrides)
bun scripts/publish.ts sim/fixtures/lanes.json   # publish a frame to the topic
cd worker && bunx wrangler dev            # local Worker; secrets in worker/.dev.vars
cd worker && bunx wrangler deploy         # ask Ravi first: it touches his Cloudflare account
```

`scripts/publish.ts` and the sim read `MQTT_TOPIC` and `BROKER_URL` from `.env`
(gitignored).

Anything about how the physical panel looks goes back to Ravi to confirm.
