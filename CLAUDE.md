# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Status

Design stage. The only code is `sim/sim.ts`, a starting-point simulator. Two
documents define the project:

- Spec: `docs/superpowers/specs/2026-10-29-cc-status-light-design.md`. Decisions
  there are settled. Do not re-argue them.
- Plan: `docs/superpowers/plans/2026-10-29-cc-status-light.md`. Eight tasks,
  executed in order with `superpowers:subagent-driven-development` or
  `superpowers:executing-plans`. Work goes on `feat/status-light`, branched from
  `docs/design`.

Task 1 is a spike that gates everything else. If it finds no "approved, tool now
running" signal, stop and ask Ravi before building.

## What it is

Claude Code session status on a 16×8 WLED LED matrix. Each interactive session
gets a lane. A full-panel amber pulse means a session waits for approval. With no
live sessions, the panel shows the GitHub contribution graph.

## Architecture

```
Claude Code mod (each Mac) ─HTTPS+bearer─▶ Cloudflare Worker + Durable Object
                                              │ composes WLED JSON state
                                              ▼
                          public MQTT broker (WSS, retained) ─▶ WLED (plaintext 1883)
```

- **Mod** (`mod/cc-status-light/`): derives terminal state from engine events
  (`tool.check`, `tool.call`, `turn.*`, `session.*`) and POSTs state changes only.
  Owns `/led-color`. Built with the `plugin-authoring` skill; its
  `types/claude-code.d.ts` is the API reference. The mod cannot import outside its
  folder, so `ClientEvent` and `parseColor` are copied in and must stay identical
  to `shared/protocol.ts` and `worker/src/palette.ts`.
- **Worker** (`worker/`): one `StatusHub` Durable Object is the single source of
  truth for lanes, states and colors. Pure modules (`lanes.ts` reducer,
  `palette.ts`, `compose.ts`) do the logic; `hub.ts` wraps a testable
  `StatusHubCore(store, publisher, clock)`. Publishes on change, plus an alarm
  republish every 15 min. Hourly cron refreshes the contribution graph.
- **MQTT** (`worker/src/mqtt.ts`): hand-written MQTT 3.1.1 encoders over
  WebSocket. No client library.
- **Contribution graph** (`worker/src/contrib/`): ported from
  `cybertron288/contrib-matrix` (`github.ts`, `grid.ts`, `ramp.ts`) with its tests.
- **Simulator** (`sim/sim.ts`): a fake WLED on `http://localhost:8091` (`PORT`
  overrides). The browser page at `/` polls `/frame` and draws the 16×8 grid.
  - Today it takes `POST /json/state` over HTTP. It merges segments by `id`, and
    `stop: 0` deletes a segment. It reads `start/stop/startY/stopY`, `fx`, `col`
    and `i` (RGB or hex pixels).
  - Its `fx` ids are its own (0 solid, 1 blink, 2 breathe, 3 upward wave), not
    real WLED ids. Task 2 chooses the real ids in `worker/src/effects.ts`, and the
    sim must then map them.
  - Plan Task 3 makes it subscribe to `${MQTT_TOPIC}/api` over WSS instead.
  - Sample frames live in `sim/fixtures/`: `lanes.json` and `takeover.json`.

## Invariants

- The mod must never delay or fail a tool call. Never `await` a network call
  inside a `tool.call` / `tool.check` chain. Reporter is debounced and swallows
  errors.
- Report only interactive sessions (a person can approve). Never `claude -p`, SDK
  or background runs.
- Lanes key on a terminal key stable across `/clear` and resume, not on
  `session_id`. Waiting holds while any `tool_use_id` for that terminal is open.
- Nothing leaves a Mac except `{terminal, state | color}`. No paths, prompts or
  repo names. MQTT payloads carry only WLED state.
- Layout: lanes 2 columns wide at x = 0, 3, 6, 9, 12 (max 5; a 6th is tracked
  with `slot: null`). Rows 0–5 show state, rows 6–7 the color strip.
- Random strip colors exclude red, amber, green and blue hue bands. Tool failures
  alone never turn a lane red.

## Commands

Bun only. These two work now:

```bash
bun sim/sim.ts                                           # simulator on :8091
curl -X POST localhost:8091/json/state -d @sim/fixtures/lanes.json   # push a frame
```

The rest come from the plan and don't exist yet:

```bash
bun test                                  # all unit tests
bun test worker/test/lanes.test.ts        # one test file
bunx tsc --noEmit                         # type-check
claude plugin test mod/cc-status-light    # mod tests
claude plugin validate mod/cc-status-light
claude --plugin-dir mod/cc-status-light   # load mod live
bun scripts/publish.ts sim/fixtures/lanes.json   # push a frame to the panel
cd worker && bunx wrangler deploy         # ask Ravi before first deploy
```

`scripts/publish.ts` and the sim read `BROKER_URL` (default
`wss://broker.hivemq.com:8884/mqtt`) and `MQTT_TOPIC` from `.env` (gitignored).
The topic name is the only secret.

Anything about how the physical panel looks goes back to Ravi to confirm.
