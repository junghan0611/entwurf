#!/usr/bin/env bash
# entwurf-demo.sh — one-shot recorded demo of pi-shell-acp entwurf flow.
#
# Layout (tmux, 220x50):
#   pane 0 (top)    — peer pi (codex, gpt-5.4)       — idle, waits for greeting
#   pane 1 (bottom) — sender pi (claude-sonnet-4-6)  — driven by send-keys
#
# Scenes (driven into sender pane):
#   1. Spawn a sonnet sibling, store one fact.
#   2. Resume that sibling, recall the fact.
#   3. entwurf_peers → pick a peer → entwurf_send greeting (wants_reply).
#
# Recording: asciinema → demo.cast → agg → demo.gif

set -euo pipefail

# ---------- config ----------
SESSION=${SESSION:-entwurf-demo}
# Default output dir = this script's directory, so demo.cast / demo.gif /
# *-debug.log land next to the script. Ignored by .gitignore (demo/*.gif,
# demo/*.log, plus the global *.cast rule).
OUTDIR=${OUTDIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)}
CAST="$OUTDIR/demo.cast"
GIF="$OUTDIR/demo.gif"
PEER_LOG="$OUTDIR/peer-debug.log"
SENDER_LOG="$OUTDIR/sender-debug.log"

# Models match the user's piat / pias aliases.
PEER_MODEL=${PEER_MODEL:-pi-shell-acp/gpt-5.4}        # piat
SENDER_MODEL=${SENDER_MODEL:-pi-shell-acp/claude-sonnet-4-6}  # pias

# Pacing in seconds. Tuned from real runs: each scene's actual agent work
# completes in ~5–15 s (Scene 1 sibling cold-spawn is the slowest; resume +
# entwurf_send are faster). 25 s gives a small safety margin without long
# idle stretches in the GIF.
WARMUP=${WARMUP:-3}
SCENE_DELAY=${SCENE_DELAY:-25}
FINAL_PAUSE=${FINAL_PAUSE:-5}

# GIF playback speed multiplier applied at agg conversion time.
GIF_SPEED=${GIF_SPEED:-2.8}

EMACS_SOCKET=${PI_EMACS_AGENT_SOCKET:-server}

# Debug output: PI_SHELL_ACP_DEBUG=1 is always on inside the panes. Each pane's
# stderr is appended to its own log file so the GIF stays clean. To watch live,
# open a separate terminal:
#   tail -f ~/tmp/entwurf-demo/sender-debug.log
#   tail -f ~/tmp/entwurf-demo/peer-debug.log

# ---------- prep ----------
mkdir -p "$OUTDIR"

cleanup() {
  tmux kill-session -t "$SESSION" 2>/dev/null || true
}
trap cleanup EXIT

tmux kill-session -t "$SESSION" 2>/dev/null || true

# Reset debug log files for this run.
: > "$PEER_LOG"
: > "$SENDER_LOG"

# Each pane runs with PI_SHELL_ACP_DEBUG=1; stderr appended to its own log file.
# Plain `2>>` is POSIX sh — works under tmux's default /bin/sh.
COMMON_ENV="PI_SHELL_ACP_DEBUG=1 PI_EMACS_AGENT_SOCKET=$EMACS_SOCKET"
COMMON_ARGS="--entwurf-control --emacs-agent-socket $EMACS_SOCKET"

# Snapshot pre-existing control sockets so we can detect which one this demo's
# peer pane creates. Without this, Scene 3 could greet an unrelated live pi
# session on the operator's machine.
SOCK_DIR="$HOME/.pi/entwurf-control"
PRE_SOCKETS=$(ls "$SOCK_DIR"/*.sock 2>/dev/null | sort || true)

wait_for_new_socket() {
  # Args: <baseline-list>  → echoes the first sessionId not in baseline. Times
  # out after 30 s.
  local baseline="$1"
  for _ in $(seq 1 30); do
    local current
    current=$(ls "$SOCK_DIR"/*.sock 2>/dev/null | sort || true)
    local fresh
    fresh=$(comm -23 <(printf "%s\n" "$current") <(printf "%s\n" "$baseline") | head -1)
    if [ -n "$fresh" ]; then
      basename "$fresh" .sock
      return 0
    fi
    sleep 1
  done
  return 1
}

# Pane targeting uses absolute pane IDs (%N) so this script is independent of
# the operator's tmux `base-index` / `pane-base-index` settings.

# ---------- start peer (top pane)  — equivalent to: piat / piag / piat5 ----------
tmux new-session -d -s "$SESSION" -n demo -x 220 -y 50 \
  "$COMMON_ENV pi --model $PEER_MODEL $COMMON_ARGS 2>>$PEER_LOG"
PEER_PANE=$(tmux list-panes -s -t "$SESSION" -F '#{pane_id}' | head -1)

PEER_ID=$(wait_for_new_socket "$PRE_SOCKETS") || {
  echo "ERROR: peer session never registered a control socket. Check $PEER_LOG." >&2
  exit 1
}
echo "Peer  sessionId: $PEER_ID  pane=$PEER_PANE"

# Update baseline before launching sender so we can isolate the sender's id too.
POST_PEER_SOCKETS=$(ls "$SOCK_DIR"/*.sock 2>/dev/null | sort || true)

# ---------- start sender (bottom pane, split below)  — equivalent to: pias / piao ----------
SENDER_PANE=$(tmux split-window -t "$PEER_PANE" -v -P -F '#{pane_id}' \
  "$COMMON_ENV pi --model $SENDER_MODEL $COMMON_ARGS 2>>$SENDER_LOG")

SENDER_ID=$(wait_for_new_socket "$POST_PEER_SOCKETS") || {
  echo "ERROR: sender session never registered a control socket. Check $SENDER_LOG." >&2
  exit 1
}
echo "Sender sessionId: $SENDER_ID  pane=$SENDER_PANE"

# Give both processes time to finish printing their banners and reach the prompt.
sleep "$WARMUP"

# ---------- driver (background): types prompts into sender pane ----------
# SENDER_PANE was captured above as a tmux pane id (%N), which is stable across
# window/pane base-index configs.
drive() {
  # Scene 1 — spawn + memory write
  tmux send-keys -t "$SENDER_PANE" -l 'Demo scene 1. Spawn a claude-sonnet-4-6 sibling via the entwurf tool. provider: pi-shell-acp, model: claude-sonnet-4-6, cwd: /home/junghan/repos/gh/pi-shell-acp, mode: sync. Task body: "You are a sibling for a recorded demo. Remember one fact only — my favorite forge color is tempered indigo. Reply with one short sentence acknowledging. No tool calls, no repo exploration." After it returns, print only the Task ID line so I can see it.'
  tmux send-keys -t "$SENDER_PANE" Enter
  sleep "$SCENE_DELAY"

  # Scene 2 — resume + memory recall
  tmux send-keys -t "$SENDER_PANE" -l 'Demo scene 2. Resume the sibling you just spawned using entwurf_resume with the Task ID from scene 1. Prompt body: "Recall test. No tool calls. One short sentence only. What is my favorite forge color? Answer with just the color phrase."'
  tmux send-keys -t "$SENDER_PANE" Enter
  sleep "$SCENE_DELAY"

  # Scene 3 — cross-session greeting via entwurf_send (sessionId hardcoded to
  # the demo's peer pane so we never accidentally greet an unrelated live pi
  # session on the operator's machine).
  tmux send-keys -t "$SENDER_PANE" -l "Demo scene 3. Call entwurf_send with sessionId=\"$PEER_ID\", wants_reply=true, mode=follow_up, message body: \"Hi peer — sonnet sibling speaking from the pi-shell-acp recorded demo. One-line reply only please: what model are you running on?\". Print the delivery confirmation."
  tmux send-keys -t "$SENDER_PANE" Enter
  sleep $((SCENE_DELAY + FINAL_PAUSE))

  # End: detach asciinema by killing tmux session
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
  echo "GIF:    $GIF"
else
  echo "agg not found; keeping cast only: $CAST"
fi

# ---------- summary ----------
echo "Cast:   $CAST"
echo "Peer log:    $PEER_LOG  ($(wc -l < "$PEER_LOG" 2>/dev/null || echo 0) lines)"
echo "Sender log:  $SENDER_LOG  ($(wc -l < "$SENDER_LOG" 2>/dev/null || echo 0) lines)"
echo
echo "Quick debug peek:"
echo "  grep 'pi-shell-acp:debug' $SENDER_LOG | head -20"
echo "  grep -E '(entwurf|model-switch)' $SENDER_LOG | head -20"
