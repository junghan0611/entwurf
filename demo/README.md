# entwurf-demo

One-shot recorded GIF of the pi-shell-acp entwurf flow:

1. **Spawn** a sonnet sibling (memory write).
2. **Resume** that same sibling (memory recall — identity preservation).
3. **Cross-session greeting** via `entwurf_send` (sent box ↔ received box).

> ⚠️ **Scene 2 currently fails** — see [#9](https://github.com/junghan0611/pi-shell-acp/issues/9).
> The resumed sibling answers *"모르겠습니다 — 현재 컨텍스트에 해당 정보가 없습니다"*
> instead of `tempered indigo`. The session JSONL preserves the prior turn
> correctly; the backend just never sees it on resume. This demo is now also
> the regression reproducer and one of the green-path acceptance gates for the
> fix. Do not "fix" the prompts to pass — fix the resume RPC path.

Two pi sessions run side-by-side in a single tmux window. A background
driver types the scene prompts into the sender pane with `tmux send-keys`.
asciinema records the whole tmux window; `agg` turns the cast into a GIF.

## Run

```bash
# from the repo root
bash demo/demo.sh

# or from inside demo/
bash demo.sh
```

Output (lands next to the script — all gitignored):

- `demo/demo.cast` — raw asciinema recording (`*.cast` global rule)
- `demo/demo.gif` — when `agg` is on PATH (`demo/*.gif`)
- `demo/peer-debug.log` — `PI_SHELL_ACP_DEBUG=1` stderr from the top pane (peer)
- `demo/sender-debug.log` — same from the bottom pane (sender) — both via `demo/*.log`

Watch debug live (separate terminal, before `bash demo.sh`):

```bash
tail -F demo/sender-debug.log demo/peer-debug.log
```

Quick post-run greps:

```bash
grep 'pi-shell-acp:debug'        demo/sender-debug.log
grep -E '(entwurf|model-switch)' demo/sender-debug.log
```

## Tunables (env vars)

| Var | Default | Meaning |
|---|---|---|
| `PEER_MODEL` | `pi-shell-acp/gpt-5.4` (≡ `piat`) | top pane backend (receives greeting) |
| `SENDER_MODEL` | `pi-shell-acp/claude-sonnet-4-6` (≡ `pias`) | bottom pane backend (drives scenes) |
| `SCENE_DELAY` | `25` | seconds to wait for each scene's agent work |
| `WARMUP` | `3` | seconds to wait for both pi banners |
| `FINAL_PAUSE` | `5` | extra wait after scene 3 (peer reply lag) |
| `GIF_SPEED` | `2.8` | agg playback multiplier (cast time → GIF time) |
| `SESSION` | `entwurf-demo` | tmux session name |
| `OUTDIR` | `demo/` (script's own dir) | output directory |

### Model ↔ alias map

The demo launch lines correspond to your shell aliases:

| Alias | Model id | Use as |
|---|---|---|
| `piao` | `pi-shell-acp/claude-opus-4-7` | `SENDER_MODEL` (precision scenes) |
| `pias` | `pi-shell-acp/claude-sonnet-4-6` | `SENDER_MODEL` (default) |
| `piat` | `pi-shell-acp/gpt-5.4` | `PEER_MODEL` (default) |
| `piat5` | `pi-shell-acp/gpt-5.5` | either |
| `piag` | `pi-shell-acp/gemini-3.1-pro-preview` | either |

Each pane runs with `PI_SHELL_ACP_DEBUG=1` baked in — same shape as
the aliases — so every spawn/model-switch/entwurf trace lands in the
debug log files (see below).

Examples:

```bash
# Swap peer to gemini
PEER_MODEL=pi-shell-acp/gemini-3.1-pro-preview bash demo.sh

# Faster pacing for short retake
SCENE_DELAY=30 FINAL_PAUSE=10 bash demo.sh

# All three backends in one demo would need a 3-pane variant — out of scope here.
```

## Prerequisites

- `pi` on PATH (currently 0.74.0)
- `pi-shell-acp` provider configured + auth ready for both backends
- `asciinema` installed
- `agg` installed (optional — only for GIF conversion)
- `tmux` installed

If you watch the demo live: open another terminal and run
`tmux attach -t entwurf-demo -r` (read-only attach) **before** the script
starts recording. Do not attach writable — keystrokes from your terminal
would collide with the driver.

## Why pre-baked prompts

Each scene's prompt asks the inner agent to discover state itself
(`entwurf_peers`, prior Task ID from this conversation). So the driver
script types static strings only — no sessionId injection, no
output parsing. That's what makes it reproducible.

## Editing scenes

Open `demo.sh`, edit the three `tmux send-keys -t "$SENDER_PANE" -l '...'`
blocks under the `drive()` function. The `-l` flag tells tmux to send the
argument literally (no key-name interpretation), so quotes inside the prompt
are safe as long as you don't use single quotes inside the single-quoted
argument.

## Tracked vs. ignored

Tracked (committed):

- `demo/demo.sh`
- `demo/README.md`

Ignored (regenerable recording artifacts):

- `demo/*.cast` (global `*.cast` rule)
- `demo/*.gif`
- `demo/*.log`

Once a recording is satisfactory, upload `demo.gif` as a GitHub release
asset and reference it from the top-level `README.md` via the release URL —
do not check the binary into the tree.
