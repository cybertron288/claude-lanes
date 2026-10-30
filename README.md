# claude-lanes

Claude Code session status on a 16×8 WLED LED matrix. The mod inside is
`cc-status-light`.

Each interactive Claude Code session gets a 1-column lane. The top 6 rows show
its state, and the bottom 2 rows are its color strip:

| State | Look |
|---|---|
| working | blue sonar: pulses leave the lane center up and down |
| done | green pulse for 20 s after a task finishes, then dim steady green |
| error | red blink (an API error ended the turn; failed tool calls do not count) |

When a session waits for you (a permission dialog, a question, a plan to
approve), its lane turns solid amber and the columns either side of it breathe
amber. The other lanes keep running, dimmed. A waiting session past the 8th
lane has no column to light, so then the top 6 rows pulse amber across the
whole panel instead. With no sessions alive, or when every session has been done or in error for
10 minutes, the panel shows your GitHub contribution graph. A working or waiting
session never counts as idle.

It works for sessions on any machine. Nothing but the lane state and color
leaves a Mac: no prompts, paths or repo names.

```
Claude Code mod (each Mac) ─HTTPS + bearer─▶ Cloudflare Worker + Durable Object
                                                 │ composes the WLED state
                                                 ▼
                    public MQTT broker (WSS, retained) ─▶ WLED (plaintext 1883)
```

## 1. Set up WLED

1. In WLED, open **Config → Sync Interfaces → MQTT**.
2. Turn MQTT on. Set the broker to `broker.emqx.io`, port `1883`.
3. Set **Device Topic** to a random string of 24 characters. That string is the
   only thing that keeps your panel's topic private. Keep it; the Worker needs it.
4. Open **Config → LED Preferences** and turn on **Turn LEDs on after power up/reset**.
5. Save, and let WLED reboot.

The matrix must already be set up as a 16×8 2D matrix.

## 2. Deploy the Worker

The Worker runs on the Cloudflare free plan.

```sh
bun install
cd worker
bunx wrangler deploy
bunx wrangler secret put MQTT_TOPIC        # the WLED device topic
bunx wrangler secret put INGEST_TOKEN      # a long random string; the mods send it
bunx wrangler secret put GITHUB_TOKEN      # a GitHub token that can read your contributions
bunx wrangler secret put GITHUB_USERNAME
```

`wrangler.toml` holds the broker URL and the brightness (`BRIGHTNESS`, 0–255,
default 128). The Worker republishes the panel every 15 minutes and refreshes
the contribution graph every hour.

## 3. Install the mod

At the prompt of a terminal Claude Code session:

```
/plugin install cc-status-light --marketplace cybertron288/claude-lanes
```

Answer `y` to add the marketplace, then pick a scope. On the options screen, set:

- **Worker URL**: the URL `wrangler deploy` printed
- **Ingest token**: the `INGEST_TOKEN` you set

From a shell, the same install is
`claude plugin install cc-status-light --marketplace cybertron288/claude-lanes`.
The repository is private, so the machine needs a git credential for github.com
(`gh auth login`, then `gh auth setup-git`).

Only interactive sessions get a lane. `claude -p`, SDK runs and scheduled runs
never show.

## Set a session's strip color

```
/led-color pink
/led-color #33ccff
```

Names: cyan, violet, pink, magenta, teal, white, purple, lime, orange, red,
blue, green, yellow. The color holds for that terminal, through `/clear` and
`/resume`. A new session gets a random color, chosen away from the colors in
use and from the red, amber, green and blue that the states use.

## Develop without the panel

The simulator subscribes to the topic like the panel does and draws the frame
in a browser:

```sh
bun sim/sim.ts                                    # http://localhost:8091 (PORT overrides)
bun scripts/publish.ts sim/fixtures/lanes.json    # publish a frame to the topic
```

Both read `MQTT_TOPIC` and `BROKER_URL` from `.env`, which git ignores. The sim
also takes frames directly with `curl -X POST localhost:8091/json/state -d @<file>`.

To run the Worker locally, put `INGEST_TOKEN` and `MQTT_TOPIC` in
`worker/.dev.vars` and run `bunx wrangler dev` in `worker/`. To load the mod
from this folder, run `claude --plugin-dir mod/cc-status-light`.

Tests:

```sh
bun test                                  # Worker
claude plugin test mod/cc-status-light    # mod
bunx tsc --noEmit && bunx tsc -p mod/cc-status-light
```

## The public-topic caveat

The broker is public. Anyone who knows the topic can read the panel's frames
or publish to it. The frames hold only LED colors and effects, so reading them
shows nothing about your work. If the topic leaks, pick a new one in WLED and
update the `MQTT_TOPIC` secret.

`spike/approval-signal/FINDINGS.md` records how the mod tells when a dialog
opens and when it is answered.
