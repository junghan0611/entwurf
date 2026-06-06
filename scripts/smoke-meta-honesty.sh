#!/usr/bin/env bash
#
# smoke-meta-honesty — 1.0.0 meta-bridge: the HONESTY regression gate (#30 bbot
# "release blockers" review). Two surfaces whose whole value is telling the truth:
#
#   PART A — doorbell count (blocker #1). doorbell.sh must count EVERY queued
#     *.msg, deliver them ALL to *.msg.delivered, and announce the real N with an
#     honest singular/plural. The old bug saw `ls | head -1`, mv'd one, and
#     hard-coded "1 unread" — a lying count, which for a project whose core value
#     is honesty is a release blocker.
#
#   PART B — hook level logging (blocker #2) + sender-marker evidence. A silent
#     registration miss is the dangerous case: the session opens fine but never
#     becomes a garden citizen. The runtime hook must STAY best-effort (no terminal
#     scream), but it must log a failure as ` ERROR ` so the doctor — the fail-loud
#     surface — can grep it. A normal create/attach must NOT emit ERROR (no false
#     alarm), and must log sender-marker evidence so send-side replyable identity
#     is not silently lost.
#
# Deterministic + offline (no `claude -p`, no network). Safe for pnpm check /
# pre-commit. Isolates its store via PI_CODING_AGENT_DIR in a temp dir.
#
# RUNTIME DEPS: bash + node (the hook runs under `node --experimental-strip-types`)
# + python3 (doorbell.sh parses the FileChanged stdin JSON with python3). NOT pure
# "node+bash" — the doctor (Phase 2) must verify python3 too.
#
# USAGE: ./run.sh smoke-meta-honesty
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/.." && pwd)"
DOORBELL="$REPO/pi/meta-bridge/entwurf-meta-receive/scripts/doorbell.sh"
HOOK="$REPO/pi-extensions/meta-bridge-hook.ts"

NODE_BIN="$(command -v node || true)"
[ -n "$NODE_BIN" ] || { echo "FAIL: node not on PATH (the hook needs strip-types)"; exit 1; }
command -v python3 >/dev/null || { echo "FAIL: python3 not on PATH (doorbell.sh parses the FileChanged JSON with it)"; exit 1; }

fail=0
ok()  { echo "  ok    $*"; }
bad() { echo "  FAIL  $*"; fail=1; }

TMP="$(mktemp -d -t psa-meta-honesty.XXXXXX)"
cleanup() { rm -rf "$TMP"; }
trap cleanup EXIT

echo "smoke-meta-honesty (store=$TMP/agent)"

# ---------------------------------------------------------------------------
# PART A — doorbell count honesty
# ---------------------------------------------------------------------------
echo "[A] doorbell count (blocker #1)"

# Run the doorbell against a mailbox holding $1 .msg files; capture the stderr
# notice + exit code. The poked signal's dirname IS the garden mailbox.
doorbell_run() {
  local n="$1" gid="$2"
  local mb="$TMP/mb/$gid"
  rm -rf "$mb"; mkdir -p "$mb"
  local i
  for ((i = 1; i <= n; i++)); do printf 'body %d\n' "$i" > "$mb/msg-$i.msg"; done
  DOORBELL_OUT="$(echo "{\"file_path\":\"$mb/inbox.signal\"}" | bash "$DOORBELL" 2>&1)" && DOORBELL_RC=0 || DOORBELL_RC=$?
  # Count via find (pipefail-safe: no `ls` exit-2 on an empty glob killing the run).
  DOORBELL_DELIVERED="$(find "$mb" -maxdepth 1 -name '*.msg.delivered' | wc -l | tr -d ' ')"
  DOORBELL_LEFT="$(find "$mb" -maxdepth 1 -name '*.msg' | wc -l | tr -d ' ')"
}

# 2 messages -> "2 unread mailbox messages", both delivered, exit 2 (wake)
doorbell_run 2 "20260606T101759-aaaaaa"
if echo "$DOORBELL_OUT" | grep -q "2 unread mailbox messages"; then ok "2 msgs announced as '2 ... messages'"; else bad "2 msgs NOT announced honestly: $DOORBELL_OUT"; fi
[ "$DOORBELL_DELIVERED" = "2" ] && ok "2 msgs ALL delivered (.delivered=$DOORBELL_DELIVERED)" || bad "2 msgs: expected 2 delivered, got $DOORBELL_DELIVERED"
[ "$DOORBELL_LEFT" = "0" ] && ok "no undelivered .msg left behind" || bad "$DOORBELL_LEFT .msg left undelivered (count under-reach)"
[ "$DOORBELL_RC" = "2" ] && ok "exit 2 (wake)" || bad "expected exit 2 (wake), got $DOORBELL_RC"

# 1 message -> honest SINGULAR. Match the full phrase (not a `\b` word boundary,
# which is a GNU-grep extension unreliable on BSD/macOS grep — this repo is
# Linux+macOS), and assert the plural form is absent.
doorbell_run 1 "20260606T101759-bbbbbb"
if echo "$DOORBELL_OUT" | grep -q "1 unread mailbox message available" && ! echo "$DOORBELL_OUT" | grep -q "1 unread mailbox messages"; then
  ok "1 msg announced as singular '1 ... message'"
else
  bad "1 msg singular/plural wrong: $DOORBELL_OUT"
fi

# 0 messages -> no wake (exit 0), nothing delivered
doorbell_run 0 "20260606T101759-cccccc"
[ "$DOORBELL_RC" = "0" ] && ok "empty mailbox: exit 0 (no false wake)" || bad "empty mailbox should exit 0, got $DOORBELL_RC"

# BACKLOG: an earlier doorbell rang for a message the model never read (still a
# *.msg.delivered, which entwurf_inbox_read WILL drain) + a fresh *.msg arrives.
# True unread = 2. Counting only the fresh one would be "1 unread" — the same lie
# one layer deeper. The notice must match what the read tool returns.
BL="$TMP/mb/20260606T101759-dddddd"; rm -rf "$BL"; mkdir -p "$BL"
printf 'old unread (rung, never read)\n' > "$BL/old.msg.delivered"
printf 'fresh arrival\n' > "$BL/new.msg"
BL_OUT="$(echo "{\"file_path\":\"$BL/inbox.signal\"}" | bash "$DOORBELL" 2>&1)" && BL_RC=0 || BL_RC=$?
BL_DELIV="$(find "$BL" -maxdepth 1 -name '*.msg.delivered' | wc -l | tr -d ' ')"
if echo "$BL_OUT" | grep -q "2 unread mailbox messages"; then ok "backlog .delivered + fresh .msg counted as 2 (not 1)"; else bad "backlog count lied: $BL_OUT"; fi
[ "$BL_DELIV" = "2" ] && ok "backlog: both end as .msg.delivered (read tool drains 2)" || bad "backlog: expected 2 .delivered, got $BL_DELIV"
[ "$BL_RC" = "2" ] && ok "backlog: fresh arrival triggers wake (exit 2)" || bad "backlog: expected exit 2, got $BL_RC"

# ---------------------------------------------------------------------------
# PART B — hook level logging
# ---------------------------------------------------------------------------
echo "[B] hook ERROR logging (blocker #2)"

export PI_CODING_AGENT_DIR="$TMP/agent"
HOOK_LOG="$TMP/agent/meta-bridge-hook.log"
run_hook() { echo "$1" | "$NODE_BIN" --experimental-strip-types "$HOOK" >/dev/null 2>&1 || true; }

# Normal SessionStart create -> INFO, NO ERROR (no false alarm).
rm -f "$HOOK_LOG"
run_hook "{\"hook_event_name\":\"SessionStart\",\"session_id\":\"native-ok-1\",\"transcript_path\":\"$TMP/t.jsonl\",\"cwd\":\"$TMP\"}"
if grep -q ' INFO .*create record' "$HOOK_LOG" 2>/dev/null; then ok "normal create logs INFO"; else bad "normal create did not log INFO ($HOOK_LOG)"; fi
if grep -q ' INFO sender marker ' "$HOOK_LOG" 2>/dev/null; then ok "normal create writes sender marker evidence (send-side replyable meta-session)"; else bad "normal create did not log sender marker evidence ($HOOK_LOG)"; fi
if grep -q ' ERROR ' "$HOOK_LOG" 2>/dev/null; then bad "normal create emitted a FALSE ERROR: $(grep ' ERROR ' "$HOOK_LOG")"; else ok "normal create emits no ERROR (no false alarm)"; fi

# Silent-miss path: duplicate nativeSessionId in the store makes scanByNativeId
# throw -> upsert fails -> the session is NOT a garden citizen. Must log ` ERROR `
# so the doctor can catch it, but must NOT scream (hook still exits 0).
STORE="$TMP/agent/meta-sessions"
REC="$(ls "$STORE"/*.meta.json | head -1)"
cp "$REC" "$STORE/decoy-dup.meta.json"   # same nativeSessionId body, different filename -> ambiguity
rm -f "$HOOK_LOG"
echo "{\"hook_event_name\":\"SessionStart\",\"session_id\":\"native-ok-1\",\"transcript_path\":\"$TMP/t.jsonl\",\"cwd\":\"$TMP\"}" \
  | "$NODE_BIN" --experimental-strip-types "$HOOK" >/dev/null 2>&1; HOOK_RC=$?
if grep -q ' ERROR .*upsert failed' "$HOOK_LOG" 2>/dev/null; then ok "duplicate nativeId logs ERROR (doctor-catchable silent miss)"; else bad "duplicate nativeId did NOT log ERROR: $(cat "$HOOK_LOG" 2>/dev/null)"; fi
[ "$HOOK_RC" = "0" ] && ok "hook stays best-effort (exit 0, no terminal scream) on failure" || bad "hook should exit 0 on best-effort failure, got $HOOK_RC"

# Degraded SessionStart (missing transcript_path) = the session FAILED to become a
# garden citizen = silent registration miss -> ERROR (not WARN), still best-effort.
rm -f "$HOOK_LOG"
echo "{\"hook_event_name\":\"SessionStart\",\"session_id\":\"native-degraded\",\"cwd\":\"$TMP\"}" \
  | "$NODE_BIN" --experimental-strip-types "$HOOK" >/dev/null 2>&1; DEG_RC=$?
if grep -q ' ERROR .*degraded envelope' "$HOOK_LOG" 2>/dev/null; then ok "degraded SessionStart logs ERROR (silent miss)"; else bad "degraded SessionStart did NOT log ERROR: $(cat "$HOOK_LOG" 2>/dev/null)"; fi
[ "$DEG_RC" = "0" ] && ok "degraded SessionStart stays best-effort (exit 0)" || bad "degraded SessionStart should exit 0, got $DEG_RC"

# Degraded UserPromptSubmit is only a best-effort backfill, never a citizenship
# event -> WARN, and must NOT raise a false ERROR.
rm -f "$HOOK_LOG"
echo "{\"hook_event_name\":\"UserPromptSubmit\",\"session_id\":\"native-degraded\",\"cwd\":\"$TMP\"}" \
  | "$NODE_BIN" --experimental-strip-types "$HOOK" >/dev/null 2>&1 || true
if grep -q ' WARN .*degraded envelope' "$HOOK_LOG" 2>/dev/null; then ok "degraded UserPromptSubmit logs WARN"; else bad "degraded UserPromptSubmit did NOT log WARN: $(cat "$HOOK_LOG" 2>/dev/null)"; fi
if grep -q ' ERROR ' "$HOOK_LOG" 2>/dev/null; then bad "degraded UserPromptSubmit raised a FALSE ERROR: $(grep ' ERROR ' "$HOOK_LOG")"; else ok "degraded UserPromptSubmit raises no false ERROR"; fi

echo
if [ "$fail" -eq 0 ]; then echo "smoke-meta-honesty: PASS"; else echo "smoke-meta-honesty: FAIL (see above)"; exit 1; fi
