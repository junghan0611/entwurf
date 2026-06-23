#!/usr/bin/env bash
# session-messaging-smoke.sh — entwurf_send 4-case matrix.
#
# Verifies the Cross-Session Messaging surface described in
# AGENTS.md § Entwurf Orchestration § Cross-Session Messaging.
#
# Matrix (per GLG's 3-matrix + baseline):
#   case 1: native sender → ACP-provider target      ← user's case ①
#   case 2: MCP sender    → native target            ← user's case ②
#   case 3: MCP sender    → ACP-provider target      ← user's case ③
#   case 4: native sender → native target            ← baseline
#
# Sender surfaces:
#   native — pi's control.ts CLI bridge
#            (pi -p --session-id <garden> --entwurf-control --entwurf-session <id> --entwurf-send-message ...)
#   MCP    — entwurf-bridge stdio JSON-RPC (tools/call entwurf_send)
#
# Targets are pi sessions with --entwurf-control. "ACP" here means the target
# pi uses entwurf as its LLM provider — the control socket namespace
# (~/.pi/entwurf-control/) is unified across providers. Targets are spawned
# in disposable tmux sessions and killed on exit.
#
# Cost: ACP target bootstrap incurs a small Claude-token charge
# (~$0.01–0.05). Native target uses a mini Codex model.
#
# Usage: scripts/session-messaging-smoke.sh

set -uo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
BRIDGE="$REPO/mcp/entwurf-bridge/start.sh"
ENTWURF_DIR="$HOME/.pi/entwurf-control"
TIMESTAMP=$(date +%Y%m%d-%H%M%S)
ARTIFACT="${SMS_ARTIFACT:-/tmp/session-messaging-smoke-$TIMESTAMP.json}"
BOOT_TIMEOUT="${SMS_BOOT_TIMEOUT:-30}"

NATIVE_PROVIDER="openai-codex"
NATIVE_MODEL="gpt-5.4-mini"
ACP_PROVIDER="entwurf"
ACP_MODEL="claude-sonnet-4-6"

TMUX_N="sms-tgt-n-$$"
TMUX_A="sms-tgt-a-$$"

pass=0
fail=0
RESULTS_JSON=""
TGT_N=""
TGT_A=""

log() { printf '[sms] %s\n' "$*" >&2; }

cleanup() {
  tmux kill-session -t "$TMUX_N" 2>/dev/null || true
  tmux kill-session -t "$TMUX_A" 2>/dev/null || true
}
trap cleanup EXIT

snapshot_sockets() {
  ls "$ENTWURF_DIR"/*.sock 2>/dev/null | sort
}

# wait for a new socket to appear after starting a pi in tmux.
# echoes the new session id (basename without .sock) on success.
wait_for_new_socket() {
  local before="$1" i
  for i in $(seq 1 "$BOOT_TIMEOUT"); do
    local now new
    now=$(snapshot_sockets)
    new=$(comm -13 <(printf '%s\n' "$before") <(printf '%s\n' "$now") | head -1)
    if [ -n "$new" ]; then
      basename "$new" .sock
      return 0
    fi
    sleep 1
  done
  return 1
}

record() {
  local name="$1" status="$2" evidence="$3"
  evidence=${evidence//\"/\\\"}
  if [ -n "$RESULTS_JSON" ]; then RESULTS_JSON+=","; fi
  RESULTS_JSON+=$'\n'"    {\"case\":\"$name\",\"status\":\"$status\",\"evidence\":\"$evidence\"}"
  if [ "$status" = "PASS" ]; then
    pass=$((pass+1))
    printf '  \033[32m✓\033[0m %-24s %s\n' "$name" "$evidence"
  else
    fail=$((fail+1))
    printf '  \033[31m✗\033[0m %-24s %s\n' "$name" "$evidence"
  fi
}

new_session_id() {
  bash "$REPO/run.sh" new-session-id
}

case_native() {
  local case_name="$1" target="$2"
  local full out rc sender_sid
  # tail -1 used to be enough but pi --provider warmup now prints vLLM rate
  # banners on every spawn, which crowd out the real status line. Capture the
  # full stream and grep for the delivery marker; keep a short tail summary
  # for the FAIL evidence so the artifact stays small.
  sender_sid=$(new_session_id) || { record "$case_name" "FAIL" "new-session-id failed"; return; }
  full=$(timeout 20 pi -p --session-id "$sender_sid" --entwurf-control --entwurf-session "$target" \
        --entwurf-send-message "sms:$case_name" \
        --entwurf-send-mode follow_up \
        --entwurf-send-wait message_processed 2>&1)
  rc=$?
  out=$(printf '%s\n' "$full" | grep -E "message processed|delivered|fail|error" | tail -3 | tr '\n' ' ')
  [ -z "$out" ] && out=$(printf '%s\n' "$full" | tail -1)
  if [ "$rc" -eq 0 ] && echo "$full" | grep -qiE "message processed|delivered"; then
    record "$case_name" "PASS" "$out"
  else
    record "$case_name" "FAIL" "rc=$rc out=$out"
  fi
}

case_mcp() {
  local case_name="$1" target="$2"
  local raw parsed err evidence
  raw=$({
    printf '%s\n' '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"sms","version":"0"}}}'
    printf '%s\n' '{"jsonrpc":"2.0","method":"notifications/initialized"}'
    # 0.4.14 sessionId-only addressing: the field used to be `target` but was
    # renamed at the same time entwurf_peers + entwurf_send standardized on
    # UUID sessionIds (no name aliases). The MCP schema lives in
    # mcp/entwurf-bridge/src/index.ts:312 and is the source of truth.
    printf '%s\n' "{\"jsonrpc\":\"2.0\",\"id\":2,\"method\":\"tools/call\",\"params\":{\"name\":\"entwurf_send\",\"arguments\":{\"sessionId\":\"$target\",\"message\":\"sms:$case_name\"}}}"
    sleep 2
  } | PI_SESSION_ID="00000000-0000-4000-8000-000000000000" \
      PI_AGENT_ID="entwurf/session-messaging-smoke" \
      timeout 15 "$BRIDGE" 2>/dev/null | grep '"id":2')
  # Determine delivery success from the FULL response text, not the truncated
  # evidence: the send-side preview block ("[entwurf sent →]" + to/from/mode/
  # preview, since 0.4.14) puts the "✓ delivered" confirmation at the very end,
  # past a fixed truncation window. The window length the confirmation lands in
  # depends on the sender cwd path length (abbreviateHomeMcp shortens $HOME paths
  # but not e.g. /tmp scratch dirs), so a truncate-then-grep made the assertion
  # cwd-dependent. Emit a delivered flag computed on the full text; keep the
  # truncated slice only as small artifact evidence.
  parsed=$(printf '%s' "$raw" | python3 -c '
import json, sys
try:
  d=json.loads(sys.stdin.read())
  r=d["result"]
  err=r.get("isError")
  text=r["content"][0]["text"]
  print(f"{err}|{'"'"'delivered'"'"' in text}|{text[:200]}")
except Exception as e:
  print(f"PARSE_ERR|False|{e}")' 2>/dev/null)
  err="${parsed%%|*}"
  local rest="${parsed#*|}"
  local delivered="${rest%%|*}"
  evidence="${rest#*|}"
  if [ "$err" != "True" ] && [ "$err" != "PARSE_ERR" ] && [ "$delivered" = "True" ]; then
    record "$case_name" "PASS" "$evidence"
  else
    record "$case_name" "FAIL" "isError=$err delivered=$delivered evidence=$evidence"
  fi
}

log "artifact: $ARTIFACT"
log "bridge:   $BRIDGE"
log "control:  $ENTWURF_DIR"
echo

log "→ Target-N (native: $NATIVE_PROVIDER/$NATIVE_MODEL) in tmux $TMUX_N"
pre=$(snapshot_sockets)
TGT_N_LAUNCH=$(new_session_id) || { log "FATAL: new-session-id Target-N failed"; exit 1; }
tmux new -d -s "$TMUX_N" -c "$PWD" "pi --session-id $TGT_N_LAUNCH --entwurf-control --provider $NATIVE_PROVIDER --model $NATIVE_MODEL" \
  || { log "FATAL: tmux new Target-N failed"; exit 1; }
TGT_N=$(wait_for_new_socket "$pre") || { log "FATAL: Target-N socket did not appear in ${BOOT_TIMEOUT}s"; exit 1; }
log "  Target-N: $TGT_N"

log "→ Target-A (ACP: $ACP_PROVIDER/$ACP_MODEL) in tmux $TMUX_A"
pre=$(snapshot_sockets)
TGT_A_LAUNCH=$(new_session_id) || { log "FATAL: new-session-id Target-A failed"; exit 1; }
tmux new -d -s "$TMUX_A" -c "$PWD" "pi --session-id $TGT_A_LAUNCH --entwurf-control --provider $ACP_PROVIDER --model $ACP_MODEL" \
  || { log "FATAL: tmux new Target-A failed"; exit 1; }
TGT_A=$(wait_for_new_socket "$pre") || { log "FATAL: Target-A socket did not appear in ${BOOT_TIMEOUT}s"; exit 1; }
log "  Target-A: $TGT_A"

echo
log "running 4-case matrix:"
case_native "native→ACP"    "$TGT_A"   # user's case ①
case_mcp    "mcp→native"    "$TGT_N"   # user's case ②
case_mcp    "mcp→ACP"       "$TGT_A"   # user's case ③
case_native "native→native" "$TGT_N"   # baseline

echo
if [ "$fail" -eq 0 ]; then
  printf '\033[32m%d/%d PASS\033[0m — wire compatibility verified across both sender surfaces × both target providers\n' \
    "$pass" "$((pass+fail))"
else
  printf '\033[31m%d PASS / %d FAIL\033[0m\n' "$pass" "$fail"
fi

cat > "$ARTIFACT" <<EOF
{
  "generatedAt": "$(date -Iseconds -u | sed 's/+00:00/Z/')",
  "pass": $pass,
  "fail": $fail,
  "targets": {
    "native": { "sessionId": "$TGT_N", "provider": "$NATIVE_PROVIDER", "model": "$NATIVE_MODEL" },
    "acp":    { "sessionId": "$TGT_A", "provider": "$ACP_PROVIDER",    "model": "$ACP_MODEL"    }
  },
  "cases": [$RESULTS_JSON
  ]
}
EOF
log "wrote artifact: $ARTIFACT"

[ "$fail" -eq 0 ] || exit 1
exit 0
