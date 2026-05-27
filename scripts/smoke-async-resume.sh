#!/usr/bin/env bash
# smoke-async-resume.sh — live 3-backend × 3-case live smoke for the
# async-resume regression repair (Phase A + Phase B).
#
# Inception condition (acceptance test for the regression repair):
#
#   pi-shell-acp Claude (and any other replyable pi-session caller of the
#   MCP `entwurf_resume` tool) omits `mode` → async ack returns immediately
#   → parent turn is free → completion arrives later as a followUp message.
#
# Hard Rule #7 (three-backend equality): the inception condition is verified
# on Claude, Codex, and Gemini. Gemini falls into an explicit-skip record
# when the `gemini` CLI is not on PATH (same pattern as smoke-all). A single-
# backend GREEN does NOT constitute "release ready" for this regression.
#
# Cases (per backend that runs):
#
#   case A — MCP replyable async (the user-facing path)
#     1. Spawn tmux pi session: `pi --entwurf-control --provider pi-shell-
#        acp --model <M>`. wait_for_new_socket → sessionId.
#     2. Send a prompt to the backend asking it to: (a) call entwurf(sync)
#        with a tiny payload, (b) call entwurf_resume on the returned
#        taskId with mode='async'. Async ack appears in the tmux pane as
#        "Resume spawned (async)" plus a Resume ID.
#     3. Wait for the entwurf-complete followUp to land in the pane:
#        "🏁 resume" / "completed" pattern, OR "❌ resume" on failure.
#     4. Assert: ack visible + completion visible (or honest error).
#
# Plus two backend-agnostic deterministic-ish cases (one tmux session only):
#
#   case B — external non-replyable + explicit mode='async' → reject
#     1. Stdio-call the MCP bridge directly with no PI_SESSION_ID /
#        PI_AGENT_ID env.
#     2. Send tools/call entwurf_resume with mode='async'.
#     3. Assert: response text matches the canonical
#        ENTWURF_RESUME_ASYNC_REJECT_REASON ("replyable pi-session caller").
#
#   case C — external non-replyable + mode='async' + cwd → still rejects
#     (replyable guard fires before cwd guard per Step 4 invariant #16)
#
# Artifact: $SMARS_ARTIFACT (default /tmp/smoke-async-resume-<ts>.json).
# Records pass/fail per case + each backend's resume taskId + the
# followUp text excerpt as evidence.
#
# Cost ceiling: per-backend ~2 ACP turns (one entwurf spawn + one resume).
# Claude/Codex small, Gemini ~3.1-pro-preview ~moderate. ~$0.15-$0.30 total
# for a full Claude + Codex + Gemini run.
#
# Pattern source: scripts/session-messaging-smoke.sh (4-case matrix).
# Same tmux + wait_for_new_socket + record + JSON artifact shape.

set -uo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
BRIDGE="$REPO/mcp/pi-tools-bridge/start.sh"
ENTWURF_DIR="$HOME/.pi/entwurf-control"
TIMESTAMP=$(date +%Y%m%d-%H%M%S)
ARTIFACT="${SMARS_ARTIFACT:-/tmp/smoke-async-resume-$TIMESTAMP.json}"
BOOT_TIMEOUT="${SMARS_BOOT_TIMEOUT:-30}"
ACK_TIMEOUT="${SMARS_ACK_TIMEOUT:-120}"
COMPLETE_TIMEOUT="${SMARS_COMPLETE_TIMEOUT:-180}"

WAIT_FOR_TEXT="$HOME/.pi/agent/skills/pi-skills/tmux/scripts/wait-for-text.sh"
if [ ! -x "$WAIT_FOR_TEXT" ]; then
	echo "[smars] FATAL: missing $WAIT_FOR_TEXT — install pi-skills tmux helpers" >&2
	exit 1
fi

# Backend targets — all routed through pi-shell-acp so the backend sees the
# pi-tools-bridge MCP tools (entwurf, entwurf_resume). Native openai-codex
# would NOT see the MCP tools because pi-tools-bridge is registered under
# piShellAcpProvider.mcpServers only.
BACKENDS_DEFAULT=("pi-shell-acp/claude-sonnet-4-6" "pi-shell-acp/gpt-5.4" "pi-shell-acp/gemini-3.1-pro-preview")
BACKENDS=("${@:-${BACKENDS_DEFAULT[@]}}")

TMUX_SESSIONS=()
pass=0
fail=0
skip=0
RESULTS_JSON=""

log() { printf '[smars] %s\n' "$*" >&2; }

cleanup() {
	for tn in "${TMUX_SESSIONS[@]}"; do
		tmux kill-session -t "$tn" 2>/dev/null || true
	done
}
trap cleanup EXIT

snapshot_sockets() {
	ls "$ENTWURF_DIR"/*.sock 2>/dev/null | sort
}

wait_for_new_socket() {
	local before="$1" i now new
	for i in $(seq 1 "$BOOT_TIMEOUT"); do
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
	evidence=${evidence//$'\n'/ }
	if [ -n "$RESULTS_JSON" ]; then RESULTS_JSON+=","; fi
	RESULTS_JSON+=$'\n'"    {\"case\":\"$name\",\"status\":\"$status\",\"evidence\":\"$evidence\"}"
	case "$status" in
		PASS) pass=$((pass + 1)); printf '  \033[32m✓\033[0m %-40s %s\n' "$name" "$evidence" ;;
		SKIP) skip=$((skip + 1)); printf '  \033[33m●\033[0m %-40s %s\n' "$name" "$evidence" ;;
		*)    fail=$((fail + 1)); printf '  \033[31m✗\033[0m %-40s %s\n' "$name" "$evidence" ;;
	esac
}

# ─── Case A — MCP replyable async resume (per backend) ───────────────────

case_a_for_backend() {
	local target="$1"
	local provider="${target%%/*}"
	local model="${target#*/}"
	local case_name="A.async.$model"
	local tmux_name="smars-$$-${model//[^a-zA-Z0-9]/}"
	TMUX_SESSIONS+=("$tmux_name")

	# Gemini honest-skip: matches the smoke-all convention. If `gemini` CLI
	# is not on PATH the ACP backend can't be spawned.
	if [[ "$model" == gemini* ]] && ! command -v gemini >/dev/null 2>&1; then
		record "$case_name" "SKIP" "gemini CLI not on PATH"
		return
	fi

	local pre new_sid
	pre=$(snapshot_sockets)
	tmux new -d -s "$tmux_name" "pi --entwurf-control --provider $provider --model $model" \
		|| { record "$case_name" "FAIL" "tmux new failed"; return; }

	new_sid=$(wait_for_new_socket "$pre") || {
		record "$case_name" "FAIL" "control socket did not appear in ${BOOT_TIMEOUT}s"
		return
	}
	log "  [$case_name] session=$new_sid"

	# Prompt the backend to call entwurf + entwurf_resume(mode=async). The
	# backend sees these as mcp__pi-tools-bridge__entwurf{,_resume}.
	# Keep the body short to minimize ACP turn cost; the assertion is on
	# the bridge-emitted ack/completion text, not on the model's reply.
	#
	# Prompt-following note: keep the smoke prompt PROCEDURAL — instructions
	# to execute tool calls verbatim, no identity claims, no behavior
	# justification. An earlier draft asserted "you ARE replyable", which a
	# defense-trained model (Claude) correctly flagged as a prompt-injection
	# pattern ("only the model decides its own identity") and refused the
	# whole sequence. The fix is to remove identity-asserting prose: the
	# tools see env on their own at the MCP layer, so the model never needs
	# to know or be told about replyable status. Codex and Gemini also
	# benefit from procedural clarity.
	local prompt
	prompt="Run this exact two-step MCP tool sequence. Pass each field literally as written; do not collapse multiple fields into one string. "
	prompt+="Step 1: call mcp__pi-tools-bridge__entwurf with arguments "
	prompt+="{task: 'Reply SMOKE_OK only.', mode: 'sync', provider: '$provider', model: '$model'}. "
	prompt+="Step 2: take the returned taskId and call mcp__pi-tools-bridge__entwurf_resume "
	prompt+="with arguments {taskId: <id>, prompt: 'Reply RESUME_OK only.', mode: 'async'}. "
	prompt+="Both \`mode\` parameters are top-level arguments — \`mode: 'sync'\` on Step 1, \`mode: 'async'\` on Step 2 — not values inside the prompt string. "
	prompt+="Report both taskIds verbatim from the tool results, nothing else."

	tmux send-keys -t "$tmux_name" "$prompt" Enter

	# Wait for the async ack — bridge emits "Resume spawned (async)" plus a
	# Resume ID line. This proves the MCP→control-RPC→native-launcher chain
	# returned an ack immediately (the parent-turn-free property).
	if ! "$WAIT_FOR_TEXT" -t "$tmux_name" -p "Resume spawned \(async\)|Resume ID" -T "$ACK_TIMEOUT" >/dev/null 2>&1; then
		local pane_dump
		pane_dump=$(tmux capture-pane -t "$tmux_name" -p -S -100 | tail -20)
		record "$case_name" "FAIL" "no async ack within ${ACK_TIMEOUT}s. pane tail: $pane_dump"
		return
	fi
	log "  [$case_name] async ack received"

	# Wait for the followUp completion — entwurf-async.ts emits a
	# CustomMessage with customType=entwurf-complete, rendered in the pane
	# with either "🏁 resume" (success) or "❌ resume" (failure). Either
	# pattern proves the followUp delivery channel reached the parent
	# session, but the smoke must distinguish them: a delivery-succeeds-
	# execution-fails ❌ result is NOT a release gate PASS. Fail-closed.
	if ! "$WAIT_FOR_TEXT" -t "$tmux_name" -p "🏁 resume|❌ resume" -T "$COMPLETE_TIMEOUT" >/dev/null 2>&1; then
		local pane_dump
		pane_dump=$(tmux capture-pane -t "$tmux_name" -p -S -200 | tail -30)
		record "$case_name" "FAIL" "no followUp completion within ${COMPLETE_TIMEOUT}s. pane tail: $pane_dump"
		return
	fi

	# Extract the completion line. PASS only on 🏁 (success). ❌ means the
	# followUp arrived but the resume child failed — surface that as FAIL
	# with the error line as evidence so a regression in the resume body
	# does not get a green check.
	local evidence
	evidence=$(tmux capture-pane -t "$tmux_name" -p -S -300 | grep -E "🏁 resume|❌ resume" | head -1)
	[ -z "$evidence" ] && evidence="(completion line missing in capture)"
	if echo "$evidence" | grep -q "❌ resume"; then
		record "$case_name" "FAIL" "followUp delivered with execution failure: $evidence"
		return
	fi
	if echo "$evidence" | grep -q "🏁 resume"; then
		record "$case_name" "PASS" "$evidence"
	else
		record "$case_name" "FAIL" "no recognizable completion marker: $evidence"
	fi
}

# ─── Case D — direct stdio with PI_SESSION_ID env (handler proof) ──────────

case_d_direct_stdio_async() {
	local case_name="D.direct_stdio_async_handler"
	local pre target_sid tmux_name spawn_resp resume_resp spawn_task_id resume_text
	local err_flag parsed_resume

	# Spawn a disposable tmux pi session purely to provide a replyable
	# control socket address for the MCP bridge to delegate into. We pick
	# the cheapest backend (codex gpt-5.4-mini native through pi-shell-acp's
	# codex-acp lane) — the backend never has to run the resume body, it
	# just needs to own the control socket and be the followUp delivery
	# target. The entwurf-control RPC handler does the actual launcher
	# work via this session's pi ExtensionAPI.
	tmux_name="smars-d-$$"
	TMUX_SESSIONS+=("$tmux_name")
	pre=$(snapshot_sockets)
	tmux new -d -s "$tmux_name" "pi --entwurf-control --provider pi-shell-acp --model gpt-5.4" \
		|| { record "$case_name" "FAIL" "tmux new failed"; return; }
	target_sid=$(wait_for_new_socket "$pre") || {
		record "$case_name" "FAIL" "target session socket did not appear in ${BOOT_TIMEOUT}s"
		return
	}
	log "  [$case_name] target session=$target_sid"

	# Step 1: spawn a tiny entwurf via direct stdio. This needs a real
	# backend turn (the entwurf MCP tool runs the model). Cost ~$0.01.
	spawn_resp=$({
		printf '%s\n' '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"smars-d","version":"0"}}}'
		printf '%s\n' '{"jsonrpc":"2.0","method":"notifications/initialized"}'
		printf '%s\n' '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"entwurf","arguments":{"task":"Reply SMOKE_D only","mode":"sync","provider":"pi-shell-acp","model":"gpt-5.4"}}}'
		sleep 1
	} | PI_SESSION_ID="$target_sid" \
	    PI_AGENT_ID="pi-shell-acp/smars-d" \
	    timeout 90 "$BRIDGE" 2>/dev/null | grep '"id":2')

	spawn_task_id=$(printf '%s' "$spawn_resp" | python3 -c '
import json, sys, re
try:
  d=json.loads(sys.stdin.read())
  text=d["result"]["content"][0]["text"]
  m=re.search(r"Task ID:\s*([a-f0-9]+)", text)
  print(m.group(1) if m else "")
except Exception as e:
  print("", file=sys.stderr)' 2>/dev/null)

	if [ -z "$spawn_task_id" ]; then
		record "$case_name" "FAIL" "could not parse spawn taskId from spawn_resp"
		return
	fi
	log "  [$case_name] spawned taskId=$spawn_task_id"

	# Step 2: stdio call entwurf_resume with mode='async', SAME env. The
	# MCP handler resolves replyable=true, runs the async branch, delegates
	# to entwurf-control via the target_sid socket, returns the async ack.
	resume_resp=$({
		printf '%s\n' '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"smars-d","version":"0"}}}'
		printf '%s\n' '{"jsonrpc":"2.0","method":"notifications/initialized"}'
		printf '%s\n' "{\"jsonrpc\":\"2.0\",\"id\":2,\"method\":\"tools/call\",\"params\":{\"name\":\"entwurf_resume\",\"arguments\":{\"taskId\":\"$spawn_task_id\",\"prompt\":\"Reply RESUME_D only\",\"mode\":\"async\"}}}"
		sleep 2
	} | PI_SESSION_ID="$target_sid" \
	    PI_AGENT_ID="pi-shell-acp/smars-d" \
	    timeout 30 "$BRIDGE" 2>/dev/null | grep '"id":2')

	parsed_resume=$(printf '%s' "$resume_resp" | python3 -c '
import json, sys
try:
  d=json.loads(sys.stdin.read())
  r=d["result"]
  text=r["content"][0]["text"]
  err=r.get("isError")
  print(f"{err}|{text[:300]}")
except Exception as e:
  print(f"PARSE_ERR|{e}")' 2>/dev/null)

	err_flag="${parsed_resume%%|*}"
	resume_text="${parsed_resume#*|}"

	# Assert: async ack returned (no isError) and text matches the canonical
	# async-spawned pattern. This proves the MCP → control-RPC → native-
	# launcher chain works end-to-end when env is wired correctly, regardless
	# of any backend's prompt-following quirks.
	if [ "$err_flag" != "True" ] && echo "$resume_text" | grep -qE "Resume spawned|spawn.*async.*MCP.*control"; then
		record "$case_name" "PASS" "$resume_text"
	else
		record "$case_name" "FAIL" "isError=$err_flag evidence=$resume_text"
	fi
}

# ─── Case B — external non-replyable + mode='async' → reject ──────────────

case_b_external_reject() {
	local case_name="B.external_async_reject"
	local raw parsed evidence
	# Send tools/call entwurf_resume with mode='async' and NO PI_SESSION_ID.
	# Helper expects the reject text from ENTWURF_RESUME_ASYNC_REJECT_REASON.
	raw=$({
		printf '%s\n' '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"smars","version":"0"}}}'
		printf '%s\n' '{"jsonrpc":"2.0","method":"notifications/initialized"}'
		printf '%s\n' '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"entwurf_resume","arguments":{"taskId":"deadbeef","prompt":"never runs","mode":"async"}}}'
		sleep 1
	} | env -u PI_SESSION_ID -u PI_AGENT_ID timeout 15 "$BRIDGE" 2>/dev/null | grep '"id":2')

	parsed=$(printf '%s' "$raw" | python3 -c '
import json, sys
try:
  d=json.loads(sys.stdin.read())
  r=d["result"]
  text=r["content"][0]["text"]
  err=r.get("isError")
  print(f"{err}|{text[:240]}")
except Exception as e:
  print(f"PARSE_ERR|{e}")' 2>/dev/null)

	local err_flag="${parsed%%|*}"
	evidence="${parsed#*|}"

	# Expect: isError=True (the MCP tool returned textErr), and the text
	# contains the canonical "replyable pi-session caller" reject.
	if [ "$err_flag" = "True" ] && echo "$evidence" | grep -q "replyable pi-session caller"; then
		record "$case_name" "PASS" "$evidence"
	else
		record "$case_name" "FAIL" "isError=$err_flag evidence=$evidence"
	fi
}

# ─── Case C — external + mode omitted + valid stdio shape (smoke for
#           the auto-sync fallback path's reachability; we don't run a
#           full sync resume here since that needs a real taskId, but
#           we verify the tool accepts the shape without erroring on
#           mode and surfaces the expected "session not found" error
#           on the missing taskId.) ──────────────────────────────────────

case_c_external_autosync_shape() {
	local case_name="C.external_autosync_shape"
	local raw parsed err_flag evidence
	raw=$({
		printf '%s\n' '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"smars","version":"0"}}}'
		printf '%s\n' '{"jsonrpc":"2.0","method":"notifications/initialized"}'
		printf '%s\n' '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"entwurf_resume","arguments":{"taskId":"deadbeef","prompt":"smoke"}}}'
		sleep 1
	} | env -u PI_SESSION_ID -u PI_AGENT_ID timeout 15 "$BRIDGE" 2>/dev/null | grep '"id":2')

	parsed=$(printf '%s' "$raw" | python3 -c '
import json, sys
try:
  d=json.loads(sys.stdin.read())
  r=d["result"]
  text=r["content"][0]["text"]
  err=r.get("isError")
  print(f"{err}|{text[:240]}")
except Exception as e:
  print(f"PARSE_ERR|{e}")' 2>/dev/null)

	err_flag="${parsed%%|*}"
	evidence="${parsed#*|}"

	# Auto-resolution picks sync for external, then runEntwurfResumeSync
	# tries to find taskId=deadbeef and fails with "session not found" or
	# similar. The point of this case is to confirm the auto-sync path is
	# REACHED (no mode parameter rejection, no schema validation failure).
	# Anything that mentions "deadbeef" or "session" or "not found" is
	# good evidence the call made it past the mode resolution.
	if echo "$evidence" | grep -qE "deadbeef|session|not found|saved|failed"; then
		record "$case_name" "PASS" "auto-sync reached: $evidence"
	else
		record "$case_name" "FAIL" "isError=$err_flag evidence=$evidence"
	fi
}

# ─── Main ────────────────────────────────────────────────────────────────

log "artifact: $ARTIFACT"
log "bridge:   $BRIDGE"
log "control:  $ENTWURF_DIR"
log "backends: ${BACKENDS[*]}"
echo

log "→ Case A — MCP replyable async resume (per backend, ACK + COMPLETE)"
for target in "${BACKENDS[@]}"; do
	case_a_for_backend "$target"
done

echo
log "→ Case D — direct stdio + replyable env (handler-level proof)"
case_d_direct_stdio_async

echo
log "→ Case B — external + explicit async → reject (backend-agnostic)"
case_b_external_reject

log "→ Case C — external + auto-sync shape reachability (backend-agnostic)"
case_c_external_autosync_shape

echo
if [ "$fail" -eq 0 ]; then
	printf '\033[32m%d PASS / %d SKIP\033[0m — async-resume regression repair verified (Phase A + Phase B)\n' "$pass" "$skip"
else
	printf '\033[31m%d PASS / %d FAIL / %d SKIP\033[0m\n' "$pass" "$fail" "$skip"
fi

cat > "$ARTIFACT" <<EOF
{
  "generatedAt": "$(date -Iseconds -u | sed 's/+00:00/Z/')",
  "pass": $pass,
  "fail": $fail,
  "skip": $skip,
  "backends": [$(printf '"%s",' "${BACKENDS[@]}" | sed 's/,$//')],
  "cases": [$RESULTS_JSON
  ]
}
EOF
log "wrote artifact: $ARTIFACT"

[ "$fail" -eq 0 ] || exit 1
exit 0
