# Spike findings: permission-dialog signals (Claude Code 2.1.312)

Method: `register.ts` here logged every event below to `events.log`. A real
interactive session ran under tmux with `--plugin-dir spike/approval-signal
--permission-mode default`, and keypresses were sent and timestamped. All times
are from those runs on MacBook 1.

## 1. Approved, tool now running: a signal exists (main loop)

`ui.render` of `ToolGroup` (collapsed rows, the default) or `ToolUse` (expanded
rows, and tools drawn on their own, like `AskUserQuestion` and `ExitPlanMode`)
redraws when the call's `isRunning` turns `true`. For a call held at a dialog,
`isRunning` stays `false` until the person answers.

| Scenario | Keypress → `isRunning: true` | Keypress → `tool.call` resolves |
|---|---|---|
| Approve Bash (20 s tool) | 138 ms (`ToolGroup`) | 20.8 s |
| Approve Bash, `acceptEdits` | 1.4 s (`ToolGroup`) | 9.4 s |
| Answer `AskUserQuestion` | 171 ms (`ToolUse`) | 261 ms |
| Approve plan (`ExitPlanMode`) | 1.8 s (`ToolUse`) | 3.7 s |

Predicate: in a `ui.render` hook for `ToolGroup`, any `calls[i]` with
`isRunning` and an open ask's `tool_use_id`; for `ToolUse`, `props.isRunning`
with an open `props.tool_use_id`. The hook must stay cheap and always return
`next(e)`. The `Spinner` renders every ~100 ms while a turn runs and stops while
a dialog is up, so `ToolGroup`/`ToolUse` are the only components worth hooking.

`ToolProgress` (`background_hint`) is not usable: Bash only, and it draws ~3 s
after the tool starts.

**Not covered: subagent asks.** A subagent's tool calls are not drawn in the main
transcript, so no render fires for them. For those, the only exit is the
`tool.call` result: amber holds until the approved subagent tool finishes. This
is the spec's fallback, needed for this case only.

## 2. "A dialog opens for a person"

`tool.check` with `e.tool_use_id` set, `e.approver === 'person'`, and
`(await next(e)).decision === 'ask'`. This holds for Bash, `AskUserQuestion`
(reason `Answer questions?`), `ExitPlanMode` (reason `Exit plan mode?`), and a
subagent's call (`e.agentId` set).

**Caveat: auto mode.** `tool.check` answers `ask` *before* the mode settles it,
so in auto mode the classifier can approve with no dialog. Observed: `ask`, then
`isRunning: true` 266 ms later, no dialog. The mod cannot read the main loop's
mode (only subagent spawns carry `permissionMode`). So the tracker counts an ask
as waiting only after a 1 s grace with no run and no result.

## 3. Reject vs Esc vs answered

All come through `tool.call`'s `await next(e)`:

- Rejected ("No"): resolves `{ isError: true }`, never `isRunning`. Took 0.5 s.
- Esc at the dialog: resolves `{ isError: true }` too, and the turn ends
  `reason: 'answer'` (not `aborted`). Took 1.3 s and 4.2 s in two runs.
- Answered `AskUserQuestion`: resolves with a result, no error.
- No case rejected the promise and none returned `deny`.

The mod needs no distinction: any resolution ends that ask.

## 4. `turn.complete` reasons

The type is `'answer' | 'aborted' | 'refusal' | 'error'`. `'error'` is the API
error (the `StopFailure` equivalent). A tool that exits non-zero with no dialog
(`ls ./definitely-not-here`) gave `tool.call` `isError: true` and
`turn.complete` `answer`, so tool failures never reach `error`.

**Subagent loops** fire `turn.start` and `turn.complete` with `e.agentId` set.
Only events without `agentId` move the lane's base state. The main turn can
complete while a subagent's dialog is still open, so the ask set must outlive
the turn.

`prompt.submit` also fires mid-turn after tool results, not only for typed
prompts. Use `turn.start` (no `agentId`) for "→ working".

## 5. Terminal key across `/clear`, `/resume` and reloads

| Event | Module variables | `$.state` | `session.start` fires |
|---|---|---|---|
| `/clear` | kept | **reset** | no |
| `/resume` | kept | not probed | no |
| hot reload of the mod | **reset** | kept | **yes** |

So: hold the key in a module variable and mirror it into `$.state`. On each
event, if the module variable is empty, read `$.state` (a reload); if that is
empty too, mint a new key. Write it back to `$.state` whenever `$.state` is
empty (after `/clear`). A `session.start` that finds a key in `$.state` is a
reload: report nothing for it.

## 6. `session.end` reasons

- `/clear` → `clear`
- `/resume` → `resume`
- `/exit` → `prompt_input_exit`
- per the types: `logout`, and `other` for SIGINT/SIGTERM/SIGHUP or a `-p` run's end

Send `end` for everything except `clear` and `resume`.

## 7. Interactive predicate

`session.start`: interactive REPL gave `isInteractive: true, surface: 'terminal'`;
`claude -p` gave `isInteractive: false, surface: null`. Report only when
`isInteractive === true`.

## 8. `$.http.fetch`

`HttpInit` is `{ method, headers, body, auth, socketPath }`: no `AbortSignal`
and no timeout. The reporter cannot abort a hung request. It stops waiting after
`timeoutMs` and moves on; the abandoned request settles on its own.

## 9. Environment note: classic hooks don't arrive here

On this machine a plugin named `cc-plugin-sec-default` runs first on every
`classic.*` event and sends it on past the hooks beneath it. The spike's
`classic.PermissionRequest`, `classic.Notification` and `classic.PostToolUse`
hooks were all skipped ("sent the event on past it"). The mod must use only
engine events (`tool.*`, `turn.*`, `session.*`, `ui.render`), never `classic.*`.

## 10. A slow classifier vs a dialog: the Spinner tells them apart

Found live: a session whose asks go to a server-side classifier (its
transcript carries `serverClassifierRequest`, though its footer says bypass)
showed amber for 2–10 s with no dialog. Its classifier can take longer than
the 1 s grace.

Probes, same logger, Spinner gaps over 400 ms listed:

| Mode | `tool.check` | `ask` → `isRunning` | Longest Spinner gap during the ask |
|---|---|---|---|
| `bypassPermissions` (Bash, Write, two MCP tools) | `allow` | n/a | none |
| `auto` (Bash ×2, an MCP tool) | `ask` | 403 ms, 451 ms, 981 ms | 569 ms |
| `default`, dialog up 16.6 s, then approved | `ask` | 16.6 s | 16,651 ms |

The Spinner stopped 21 ms before `tool.check` answered `ask` and came back on
approval. So an ask counts as waiting once it is past the grace *and* no
Spinner has drawn for 800 ms. A surface that never draws a Spinner falls back
to the grace alone.
