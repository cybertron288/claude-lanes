# Claude Code status light: design

Date: 2026-10-29
Repo: `cybertron288/cc-status-light` (new; private by default, **builder's call**)

## Intent

Ravi runs 2–4 Claude Code sessions at once, across two MacBooks. Sessions stall on
permission prompts while he is in another window or away from the desk, and nothing
moves until he notices. A 16×8 WS2812B LED matrix on his desk (WLED controller,
Gledopto GL-C-618WL, already set up as a 16×8 2D matrix for the
`cybertron288/contrib-matrix` project) should make a blocked session impossible to
miss and show the state of each running session at a glance.

Success: a session waiting for approval is noticed from across the room within
seconds. Glancing at the panel shows which sessions are working, done, or broken.

## Goals

- Show up to 5 concurrent sessions, each with its own lane and color strip.
- Full-panel amber pulse when any session waits for approval or input.
- Work for sessions on both MacBooks. MacBook 1 is on the matrix's Wi-Fi. MacBook 2
  is on a different network.
- When no sessions are alive, show the GitHub contribution graph (as contrib-matrix
  does today).
- `/led-color <color>` inside a session sets that session's strip color.

## Non-goals

- Phone push. Claude Code's built-in push ("Push when actions required" in
  `/config`) plus Remote Control already covers this; approvals happen in the Claude
  app. Nothing is built for push. An ntfy-style escalation push was considered and
  rejected for now.
- Sessions running on claude.ai/code cloud VMs. All sessions are local sessions with
  Remote Control on (`remoteControlAtStartup: true` is already set).
- Approving or controlling sessions from the matrix.

## Anti-goals (failure even if it "works")

- Slowing down or blocking Claude Code. Hooks must be fire-and-forget with a short
  timeout and must never fail a tool call or turn.
- Leaking code, prompts, file paths, or repo names. Nothing beyond session state
  leaves the machine. The public MQTT hop carries only LED colors and effects.
- Requiring an extra always-on device at home, or a paid service.
- A noisy panel. Red should mean something is actually wrong.

## Constraints and facts established

- Matrix: 16 columns × 8 rows, WLED with 2D matrix mapping already configured.
- WLED cannot be reached from the internet. Its MQTT client can subscribe outward
  but supports **no TLS** ("Secure connections are not currently supported",
  kno.wled.ge/interfaces/mqtt). MQTT `[deviceTopic]/api` accepts API calls in HTTP
  or JSON API syntax. Whether it accepts a full JSON state with 2D segments, and the
  maximum payload size, are **not confirmed**. The builder must verify this on the
  real device first (see Risks).
- WLED has built-in effects (solid, blink, breathe, etc.) and 2D segments, so
  animation runs on the controller itself. Nothing streams frames.
- Claude Code hooks (current docs, code.claude.com/docs/en/hooks.md):
  - `SessionStart`, `SessionEnd`, `UserPromptSubmit`, `Stop`, `StopFailure`,
    `PermissionRequest`, `PermissionDenied`, `PostToolUse`, `PostToolUseFailure`,
    `Notification` (matchers `permission_prompt`, `elicitation_dialog`,
    `agent_needs_input`, `idle_prompt`).
  - Common payload: `session_id`, `cwd`, `hook_event_name`, `transcript_path`.
  - An `http` hook type exists (`url`, `headers`, `allowedEnvVars`, `timeout`,
    `onFailure`).
  - No event says "the user answered the prompt". Leaving the waiting state must be
    inferred (see State machine).
- Skills get `${CLAUDE_SESSION_ID}` substituted and can run a script with `$0`/`$ARGUMENTS`.
- Runtime and tooling: Bun + TypeScript, matching contrib-matrix. The Worker is
  TypeScript on Cloudflare Workers (free tier).

## Architecture (decided)

```
MacBook 1 mod ─┐                                   ┌─ (retained) ─▶ WLED (MQTT subscribe, plaintext)
               ├─ HTTPS + bearer ─▶ Cloudflare Worker ─▶ public MQTT broker
MacBook 2 mod ─┘                  (Durable Object:      (e.g. broker.hivemq.com)
                                   sessions + composer;
                                   hourly cron: GitHub
                                   contribution graph)
```

- **Client = one Claude Code mod** (decided by Ravi), installed on both Macs. It
  replaces classic settings.json hooks. A mod is the plugin kind built with the
  `plugin-authoring` skill: `register(on, options)` hooks on engine events, network
  via `$.http.fetch`, and slash commands via `$.command.register`. The API is in
  that skill's `types/claude-code.d.ts`. The mod:
  - reports state transitions (not every tool call) to the Worker as
    `{terminal_key, session_id, state}`, fire-and-forget. A Worker failure never
    delays or fails a tool call. It debounces and coalesces.
  - owns `/led-color <name|#hex>` as a mod command. No separate skill.
  - holds a **terminal key**: generated once per Claude Code process, stable across
    `/clear` and resume. The Worker keys lanes and colors by terminal key, so a
    terminal **keeps its lane and color (including a `/led-color` choice) across
    `/clear` and resume** (decided by Ravi). The lane frees when the process exits
    (`session.end` with no new session following), or on the stale timeout.
  - reports only **interactive** sessions: a person can be asked (`approver:
    'person'`) and the surface is interactive. Never `claude -p`, SDK scripts,
    scheduled runs, or background helper processes. This keeps phantom sessions out
    of the 5 lanes (**my call**).
- **Worker + one Durable Object** is the single source of truth. It holds session
  lanes, states, and colors. On every change it composes the full WLED state
  (segments + effects, or contribution pixels when idle) and publishes it to the
  MQTT topic with **retain** set, so a rebooted WLED gets the current frame as soon
  as it reconnects. It publishes only on change, plus a periodic republish
  (**builder's call** on the interval).
- **Ingest auth:** a shared bearer token, stored as a Worker secret and in an env var
  on each Mac.
- **Public MQTT:** a free public broker. The topic is a long random string, and the
  topic name is the only secret. This is accepted: payload is only colors/effects.
  The Worker connects over TLS/WebSocket. WLED connects plaintext on 1883.
- **Contribution graph:** the Worker's hourly cron fetches it with the same GraphQL
  query and 16-week grid logic as contrib-matrix (port `github.ts`, `grid.ts`,
  `ramp.ts`). The Worker shows it when no sessions are alive. The Windows Task
  Scheduler job from contrib-matrix gets retired. Otherwise the two would overwrite
  each other.

## Display (decided with Ravi, mockups approved)

Layout "A" with takeover "T1".

- **Lanes:** each session gets 2 columns. Lanes sit at x = 0, 3, 6, 9, 12, with a
  1-column gap between them. Max 5 sessions. Lanes are assigned first-come, and a
  lane frees when its session ends.
- **Bottom 2 rows (y=6,7):** the session's color strip, 2×2.
- **Top 6 rows (y=0–5) of a lane:** session state.
  - working: blue upward shimmer (a WLED effect that approximates it is fine)
  - done: dim steady green
  - error: red blink
- **Approval takeover (T1):** when any session is waiting, all 16×6 top rows pulse
  amber (breathe). Only the waiting session(s)' strips stay lit; other strips go
  dark. No session number. When nothing is waiting, the panel returns to the
  normal view.
- **Session color:** random on session start, chosen to be visually distinct from
  the colors in use. Amber, red, blue, and green hues are excluded so they never
  clash with state colors. `/led-color <name|#hex>` overrides the color for **this
  session only**. It is not remembered per repo.
- **Idle (no live sessions):** contribution graph, full panel.

## State machine per terminal

Ravi asked for **accurate** waiting detection. A stuck amber panel after Esc, or
amber lasting through a long approved build, is not acceptable. No timeout cap.
Signals come from mod events (names per this build's `claude-code.d.ts`):

| State change | Mod signal |
|---|---|
| appear, lane assigned | `session.start` (first time for this terminal key) |
| → working | `prompt.submit`, `turn.start` |
| → **waiting** | `tool.check`: `await next(e)` resolves `decision: 'ask'` with `approver: 'person'`, on a real call (`tool_use_id` set). This is exactly the case where the permission dialog opens. Also `tool.call` for `AskUserQuestion` / plan approval while its `next` is pending. |
| waiting → working (**rejected / Esc**) | the matching `tool.call` (same `tool_use_id`) resolves with `deny` or rejects as aborted |
| waiting → working (**question answered**) | `AskUserQuestion` `tool.call` resolves |
| waiting → working (**approved, tool now running**) | **open: see Risk 0.** Fallback: the matching `tool.call` resolves |
| → done | `turn.complete` |
| → error | `turn.complete` that ended on an API error (the mod's equivalent of `StopFailure`). Tool failures alone do **not** turn the lane red: failed greps and non-zero exits are routine (**my call**). |
| error → working | `prompt.submit` |
| gone, lane freed | `session.end` not followed by a new session in the same process |

Several dialogs can be open at once (subagents). Waiting holds while any
`tool_use_id` for that terminal is unresolved.

- **Stale sessions:** a session can die without `SessionEnd`. Remote Control
  sessions can also legitimately sit idle for hours. **My call:** free a lane after
  12 h with no events from that session. The builder may tune this.
- **Overflow:** a 6th concurrent session is tracked but not shown until a lane frees
  (**my call**).

## Risks to retire first

0. **Spike first: detect "approved, tool now running".** The permission dialog is
   drawn by the engine alone. No mod event fires when it is answered, and
   `tool.call`'s `next` covers the dialog *and* the tool run together. Candidate
   signals to test in a throwaway mod:
   - a `ui.render` for `ToolProgress` (or a changed `ToolUse` render) for that
     `tool_use_id`, which should only draw once the tool runs
   - `turn.step` chunks
   - a classic `PreToolUse`/`PostToolUse` ordering trick

   Verify `approver`/`decision` on `tool.check` across modes too (default,
   acceptEdits, auto). If no reliable signal exists, come back to Ravi before
   building: the fallback is "amber until the approved tool finishes".
1. Confirm on the real WLED (or a faithful sim) that `[topic]/api` accepts a JSON
   state with 2D segments (`startY`/`stopY`) and per-segment effects. Also confirm
   the max MQTT payload size, since the idle contribution frame is 128 pixels.
   Fallbacks: compact hex pixel format, splitting across messages, or WLED presets.
2. Confirm a Cloudflare Worker / Durable Object can publish to the chosen public
   broker (MQTT over WSS) on the free plan.
3. Confirm the mod's network calls never add latency to tool calls when the Worker
   is slow or unreachable. Don't `await` the fetch inside the `tool.call` chain.

WLED's single MQTT slot is unused (confirmed by Ravi), so it can point at the
public broker.

## Left to the builder

- Exact WLED effect IDs, speeds, and intensities that best match the approved
  mockups (shimmer, breathe, blink).
- Broker choice, topic format, republish interval.
- Repo layout (Worker + mod + simulator), and how the mod gets onto MacBook 2
  (plugin marketplace from the repo, or the org library).
- A local simulator that subscribes to the topic and renders the 16×8 frame in a
  browser, for development without hardware. The `wled-sim.ts` from this session is
  a starting point.
- Test strategy. Keep the composer and state machine pure and unit-tested, like
  contrib-matrix.
