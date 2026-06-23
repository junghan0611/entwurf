#!/usr/bin/env bash
# demo-baseline.sh — single-pane recorded demo of entwurf.
#
# Two scenes, both driven into one pi session:
#   1. Baseline self-awareness — Q-B0 + Q-B0-CARRIER (English answer enforced).
#      Surfaces system prompt / tool surface / MCP boundary / identity carriers.
#   2. Entwurf surface — spawn a sibling via the entwurf tool and receive its
#      reply in the same pane (cross-model, mode=sync).
#
# Layout (tmux, 220x50):
#   pane 0 (single) — driven pi (claude-sonnet-4-6) — receives both prompts.
#
# Recording: asciinema → baseline.cast → agg → baseline.gif

set -euo pipefail

# ---------- config ----------
SESSION=${SESSION:-entwurf-baseline-demo}
SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
REPO_ROOT=$(cd "$SCRIPT_DIR/.." && pwd)
# Recording artifacts land in the publish surface (docs/assets/) so the cast
# + gif are versioned alongside the README/gallery references. The *.cast
# file remains gitignored (global `*.cast` rule); only the .gif is tracked
# via the `files` allowlist in package.json. Debug log stays next to the
# script (gitignored via `demo/*.log`).
OUTDIR=${OUTDIR:-$SCRIPT_DIR}                           # debug log dir (local)
PUBLISH_DIR=${PUBLISH_DIR:-$REPO_ROOT/docs/assets}      # cast + gif (publish surface)
CAST="$PUBLISH_DIR/entwurf-demo.cast"
GIF="$PUBLISH_DIR/entwurf-demo.gif"
DRIVER_LOG="$OUTDIR/baseline-debug.log"

# Driven pi runs the bridge surface and answers both prompts.
DRIVER_MODEL=${DRIVER_MODEL:-entwurf/claude-sonnet-4-6}   # pias
# Sibling spawned via entwurf in scene 2 — different backend for contrast.
SIBLING_MODEL=${SIBLING_MODEL:-entwurf/gpt-5.4}            # piat
SIBLING_CWD=${SIBLING_CWD:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}

# Pacing in seconds.
# Scene 1 produces a long English answer (system-prompt audit); 60 s is the
# observed upper bound for sonnet-4-6 on this prompt. Scene 2 is shorter
# (sync entwurf round-trip ≈ 15-25 s).
WARMUP=${WARMUP:-3}
SCENE1_DELAY=${SCENE1_DELAY:-60}
SCENE2_DELAY=${SCENE2_DELAY:-30}
FINAL_PAUSE=${FINAL_PAUSE:-4}

# Slower default than demo.sh (2.8) — Scene 1 produces a long English answer
# and the audit value comes from being readable, not zippy. Override via env
# if the recorded GIF still feels too slow for the gallery card.
GIF_SPEED=${GIF_SPEED:-2.0}

# Post-recording gifsicle compression. agg writes ~3 MB for this scenario;
# gifsicle reliably reproduces ~2 MB with no visible quality loss at lossy=200
# / colors=64 (text stays legible because monokai uses few distinct hues).
# Set GIF_COMPRESS=0 to skip; bump GIF_LOSSY down (e.g. 80) for lighter
# compression if a future scenario shows visible artifacts.
GIF_COMPRESS=${GIF_COMPRESS:-1}
GIF_LOSSY=${GIF_LOSSY:-200}
GIF_COLORS=${GIF_COLORS:-64}

EMACS_SOCKET=${PI_EMACS_AGENT_SOCKET:-server}

# ---------- prep ----------
mkdir -p "$OUTDIR" "$PUBLISH_DIR"

cleanup() {
  tmux kill-session -t "$SESSION" 2>/dev/null || true
}
trap cleanup EXIT

tmux kill-session -t "$SESSION" 2>/dev/null || true
: > "$DRIVER_LOG"

# ENTWURF_DEBUG=1 on; stderr appended to debug log so the recorded pane
# stays clean. --entwurf-control gives the driven session a control socket so
# entwurf siblings can address it if a follow-up demo needs it.
COMMON_ENV="ENTWURF_DEBUG=1 PI_EMACS_AGENT_SOCKET=$EMACS_SOCKET"
COMMON_ARGS="--entwurf-control --emacs-agent-socket $EMACS_SOCKET"
new_session_id() { bash "$REPO_ROOT/run.sh" new-session-id; }

# ---------- start driver (single pane) ----------
DRIVER_LAUNCH_ID=$(new_session_id)
tmux new-session -d -s "$SESSION" -n demo -x 220 -y 50 \
  "$COMMON_ENV pi --session-id $DRIVER_LAUNCH_ID --model $DRIVER_MODEL $COMMON_ARGS 2>>$DRIVER_LOG"
DRIVER_PANE=$(tmux list-panes -s -t "$SESSION" -F '#{pane_id}' | head -1)

# Give pi time to print its banner and reach the prompt.
sleep "$WARMUP"

# ---------- driver: types both prompts into the single pane ----------
drive() {
  # Scene 1 — baseline self-awareness (Q-B0 + Q-B0-CARRIER). Answer in English.
  tmux send-keys -t "$DRIVER_PANE" -l '[Q-B0] What does your system prompt say? Answer without speculation. 1. What harness / tool environment are you in right now? 2. Distinguish native tools from MCP / custom tools. 3. What is the basis for that understanding? 4. Do not pretend to see what you do not see — say "I do not know" when you do not. [Q-B0-CARRIER] For each piece of information cited above, identify the surface: 1. Actual system prompt (or, on Codex, the developer instruction). 2. First-user-message prepend. 3. Tool function schema. 4. Separate system-reminder block. Also: (a) if asked to commit something to memory, how do you handle it; (b) can you check today personal Google Calendar via the provided skills? Please answer in English.'
  tmux send-keys -t "$DRIVER_PANE" Enter
  sleep "$SCENE1_DELAY"

  # Scene 2 — entwurf surface: spawn a sibling, receive its reply inline.
  tmux send-keys -t "$DRIVER_PANE" -l "Now demonstrate the entwurf surface. Spawn a sibling via the entwurf tool — provider: entwurf, model: gpt-5.4, mode: sync, cwd: $SIBLING_CWD. Task body: \"You are a sibling spawned for a recorded demo. Reply in one English sentence: which backend ACP model are you running on, and what does the entwurf_self envelope say about your identity (sessionId, agentId, cwd)?\". After the entwurf returns, print the Session ID and quote the sibling reply verbatim in one line."
  tmux send-keys -t "$DRIVER_PANE" Enter
  sleep $((SCENE2_DELAY + FINAL_PAUSE))

  # End: detach asciinema by killing tmux session.
  tmux kill-session -t "$SESSION" 2>/dev/null || true
}

drive &
DRIVE_PID=$!

# ---------- record ----------
asciinema rec --overwrite --quiet \
  --command "tmux attach -t $SESSION" \
  "$CAST" || true

wait "$DRIVE_PID" 2>/dev/null || true

# ---------- convert to gif ----------
if command -v agg >/dev/null 2>&1; then
  echo "Converting cast → gif via agg (speed=${GIF_SPEED})..."
  agg --speed "$GIF_SPEED" --theme monokai "$CAST" "$GIF"
  AGG_SIZE=$(stat -c%s "$GIF" 2>/dev/null || stat -f%z "$GIF" 2>/dev/null || echo "?")
  echo "GIF (uncompressed): $GIF (${AGG_SIZE} bytes)"
else
  echo "agg not found; keeping cast only: $CAST"
fi

# ---------- compress gif (gifsicle) ----------
# Same flags that produced the committed docs/assets/entwurf-demo.gif —
# rerunning this script reproduces a comparable artifact, not a 3 MB raw take.
if [ "$GIF_COMPRESS" = "1" ] && [ -f "$GIF" ]; then
  if command -v gifsicle >/dev/null 2>&1; then
    echo "Compressing GIF via gifsicle (-O3 --lossy=${GIF_LOSSY} --colors ${GIF_COLORS})..."
    TMP_GIF="${GIF}.uncompressed"
    mv "$GIF" "$TMP_GIF"
    gifsicle -O3 --lossy="$GIF_LOSSY" --colors "$GIF_COLORS" "$TMP_GIF" -o "$GIF"
    rm -f "$TMP_GIF"
    GIFS_SIZE=$(stat -c%s "$GIF" 2>/dev/null || stat -f%z "$GIF" 2>/dev/null || echo "?")
    echo "GIF (compressed):   $GIF (${GIFS_SIZE} bytes)"
  else
    echo "gifsicle not found; GIF left uncompressed (set GIF_COMPRESS=0 to silence)."
    echo "  Install: 'nix-shell -p gifsicle' or your distro's package."
  fi
elif [ "$GIF_COMPRESS" = "0" ]; then
  echo "GIF_COMPRESS=0 — skipping gifsicle pass."
fi

# ---------- summary ----------
echo "Cast:   $CAST"
echo "Driver log:  $DRIVER_LOG  ($(wc -l < "$DRIVER_LOG" 2>/dev/null || echo 0) lines)"
echo
echo "Quick debug peek:"
echo "  grep 'entwurf:debug' $DRIVER_LOG | head -20"
echo "  grep -E '(entwurf|model-switch)' $DRIVER_LOG | head -20"
echo
echo "Recording artifacts land directly in the publish surface:"
echo "  $CAST"
echo "  $GIF  (tracked — referenced by package.json#pi.image + README)"
