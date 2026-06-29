#!/usr/bin/env bash
#
# smoke-resident-garden-guard — LIVE gate for the 0.9.0 resident garden-native
# session enforcement on `--entwurf-control` (NEXT.md "operator session garden
# identity"). Mirrors GLG's requirement: "native이든 entwurf이든 --entwurf-
# control 켜면 내 스타일로 고정 … 비-garden id가 보이면 바로 터져야 돼."
#
#   NEGATIVE (0 tokens, the must-have): raw `pi --entwurf-control` with NO
#     --session-id → pi mints a uuidv7 → the entwurf-control guard must BLOW UP
#     at session_start BEFORE any model turn:
#       - nonzero exit
#       - NO model turn (no `agent_start`; zero tokens)
#       - NO control socket created for that uuid session
#       - the "Non-garden session id" reason on stderr
#     Why this smoke exists: verified live 2026-06-04 that `ctx.shutdown()` alone
#     does NOT stop the in-flight turn (26k tokens leaked through). The guard now
#     hard-exits via process.exit(1); this smoke locks that guarantee so a
#     regression to shutdown-only (silent token leak) fails the gate.
#
#   REPLACEMENT (0 tokens): builtin /new + /clone (RPC) must be CANCELLED — they
#     would mint a non-garden uuid in-process; the pre-switch guard cancels them.
#
#   RESUME-INTO-UUID (0 tokens): an in-process resume (RPC switch_session) into a
#     SYNTHETIC legacy-uuid session file must be pre-cancelled FRIENDLY at
#     session_before_switch reason="resume" — proving that path directly, not just
#     via the session_start hard-guard backstop. Asserts: switch_session
#     cancelled:true, the "resume is blocked … not garden-native" guidance on
#     stderr, the hard guard never fires, 0 tokens, resident stays on its garden
#     id, no socket for the uuid.
#
#   GNEW (0 tokens): /gnew is the garden-native in-process replacement for the
#     blocked /new. Driven via RPC `prompt "/gnew"` (session.prompt intercepts the
#     slash → the registered command, BEFORE any model turn). It pre-creates an
#     empty garden session file and ctx.switchSession()es into it, so the new
#     session is born on a garden id (header / control socket / PI_SESSION_ID),
#     with no torn uuid. Asserts: new garden id ≠ old, 0 tokens, messageCount 0 /
#     no conversation messages, no-rewrite-mint, socket rebound to the new id +
#     old dropped + no uuid leak.
#
#   POSITIVE (opt-in, ~1 cheap turn; set SMOKE_RGG_POSITIVE=1): garden
#     --session-id "$(./run.sh new-session-id)" → guard passes, the session file
#     header id is the garden id, and the resident name carries the `control`
#     tag (NEVER `entwurf` — that tag is the entwurf_resume marker).
#
#   GNEW T3 (opt-in, ~1 turn; under SMOKE_RGG_POSITIVE=1): after /gnew, one turn
#     calls entwurf_self; the backend MCP child must report the NEW garden id —
#     proving PI_SESSION_ID propagated through the in-process switch end to end.
#
# Cost: NEGATIVE + REPLACEMENT + RESUME-INTO-UUID + GNEW = 0 tokens. POSITIVE + GNEW T3 = ~2 cheap turns.
#
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENTWURF_DIR="$HOME/.pi/entwurf-control"
SESSIONS_BASE="$HOME/.pi/agent/sessions"
# Default target stays pi-native (openai-codex/gpt-5.4), but honor the SAME target
# knob as the other live smokes: ENTWURF_LIVE_TARGET="<provider>/<model>". On
# acp-on-v2 the ACP `entwurf` provider is back, and `./run.sh smoke-acp-rgg-live`
# drives THIS runner against it (deterministic half) — the guard logic (garden-id
# enforcement) is provider-agnostic, no assertion checks the provider name, only the
# garden sessionId. RGG-specific SMOKE_RGG_PROVIDER/MODEL still override.
if [ -n "${ENTWURF_LIVE_TARGET:-}" ]; then
	case "$ENTWURF_LIVE_TARGET" in
		*/*) _rgg_provider="${ENTWURF_LIVE_TARGET%%/*}"; _rgg_model="${ENTWURF_LIVE_TARGET#*/}" ;;
		*) echo "[smoke-resident-garden-guard] ENTWURF_LIVE_TARGET must be \"<provider>/<model>\", got: $ENTWURF_LIVE_TARGET" >&2; exit 1 ;;
	esac
else
	_rgg_provider="${ENTWURF_LIVE_PROVIDER:-openai-codex}"
	_rgg_model="${ENTWURF_LIVE_MODEL:-gpt-5.4}"
fi
PROVIDER="${SMOKE_RGG_PROVIDER:-$_rgg_provider}"
MODEL="${SMOKE_RGG_MODEL:-$_rgg_model}"
TIMEOUT="${SMOKE_RGG_TIMEOUT:-90}"
# Release-gate topology: this is a repo-under-test smoke, not a deployment smoke.
# Load ONLY this checkout's extension so results do not depend on device-local global
# packages / current branch wiring.
REPO_EXTENSION_ARGS=(--no-extensions -e "$REPO")

pass=0
fail=0
note() { printf '  %s\n' "$*"; }
ok() {
	pass=$((pass + 1))
	printf '  PASS  %s\n' "$1"
}
bad() {
	fail=$((fail + 1))
	printf '  FAIL  %s\n' "$1"
}

# ─── NEGATIVE — raw uuid session must blow up (0 tokens) ────────────────────
echo "[smoke-resident-garden-guard] NEGATIVE: raw 'pi --entwurf-control' (no --session-id)"
neg_out=""
neg_ec=0
neg_out=$(timeout "$TIMEOUT" pi "${REPO_EXTENSION_ARGS[@]}" --entwurf-control --provider "$PROVIDER" --model "$MODEL" \
	--mode json -p 'RGG_NEGATIVE_SHOULD_NOT_RUN' 2>&1) || neg_ec=$?

# The session header pi minted (uuidv7) is printed on the --mode json stream.
neg_sid=$(printf '%s\n' "$neg_out" | grep -o '"type":"session"[^}]*"id":"[^"]*"' | head -1 | grep -o '"id":"[^"]*"' | head -1 | sed 's/.*:"//;s/"$//' || true)

if [ "$neg_ec" -ne 0 ]; then
	ok "nonzero exit ($neg_ec)"
else
	bad "expected nonzero exit, got 0 (guard did not blow up)"
fi

if printf '%s\n' "$neg_out" | grep -q "Non-garden session id"; then
	ok "guard reason on stderr (Non-garden session id)"
else
	bad "guard reason 'Non-garden session id' not found in output"
fi

if printf '%s\n' "$neg_out" | grep -q '"type":"agent_start"'; then
	bad "agent_start present — the model turn RAN (token leak; shutdown-only regression?)"
else
	ok "no agent_start — model turn never started (0 tokens)"
fi

if printf '%s\n' "$neg_out" | grep -qE '"totalTokens":[1-9]'; then
	bad "nonzero token usage observed — turn leaked through the guard"
else
	ok "no token usage observed"
fi

if [ -n "$neg_sid" ] && [ -e "$ENTWURF_DIR/$neg_sid.sock" ]; then
	bad "control socket created for the uuid session ($neg_sid.sock) — server not refused"
else
	ok "no control socket created for the refused session"
fi

# The refused uuid session must not have been left on disk either (it exits
# before the first assistant turn, so _persist never writes the file).
if [ -n "$neg_sid" ] && find "$SESSIONS_BASE" -name "*_${neg_sid}.jsonl" 2>/dev/null | grep -q .; then
	bad "uuid session file written ($neg_sid) — turn progressed past session_start"
else
	ok "no uuid session file written"
fi

# ─── REPLACEMENT — in-process new/clone must be CANCELLED, not hard-exit ─────
# Under --entwurf-control, /new and /fork|/clone mint a non-garden uuid in-process
# (no --session-id reaches an in-process switch, and the pre-switch hook result
# carries only { cancel } — it cannot inject a garden id). Before 0.9.0's pre-event
# guard these reached the session_start hard guard and process.exit(1) the WHOLE
# pi process — a routine /new killed the session. Now session_before_switch /
# session_before_fork cancel the mint: the session survives on its garden id at
# zero tokens. (GPT zero-token RPC repro, 2026-06-04.)
echo "[smoke-resident-garden-guard] REPLACEMENT: in-process new/clone cancelled (RPC, 0 tokens)"
rep_sid=$(bash "$REPO/run.sh" new-session-id)
rep_err=$(mktemp)
rep_out=$(printf '%s\n' '{"type":"get_state"}' '{"type":"new_session"}' '{"type":"clone"}' '{"type":"get_state"}' |
	timeout "$TIMEOUT" pi "${REPO_EXTENSION_ARGS[@]}" --session-id "$rep_sid" --entwurf-control --provider "$PROVIDER" \
		--model "$MODEL" --mode rpc 2>"$rep_err") || true

if printf '%s\n' "$rep_out" | grep -q '"command":"new_session","success":true,"data":{"cancelled":true}'; then
	ok "/new (new_session) cancelled in-process"
else
	bad "/new was NOT cancelled — in-process uuid mint reached the hard guard"
fi

if printf '%s\n' "$rep_out" | grep -q '"command":"clone","success":true,"data":{"cancelled":true}'; then
	ok "/clone (fork) cancelled in-process"
else
	bad "/clone was NOT cancelled — fork mint reached the hard guard"
fi

# Both get_state calls must report the original garden id (process survived, the
# session was never replaced by a uuid).
rep_ids=$(printf '%s\n' "$rep_out" | grep -o '"sessionId":"[^"]*"' | sort -u)
if [ "$rep_ids" = "\"sessionId\":\"$rep_sid\"" ]; then
	ok "session stayed on the garden id ($rep_sid) — process survived, not replaced"
else
	bad "sessionId drifted from $rep_sid — got: ${rep_ids:-<none>}"
fi

# The hard guard's "Non-garden session id" must NOT appear — the pre-switch cancel
# caught it first (our friendly "blocked under --entwurf-control" guidance is fine).
if grep -q "Non-garden session id" "$rep_err"; then
	bad "hard guard fired (Non-garden session id) — pre-switch cancel missed a path"
else
	ok "hard guard never fired (pre-switch cancel caught it; no process exit)"
fi

# No control socket may exist for any uuid (the cancelled mints never booted).
if find "$ENTWURF_DIR" -name '*-*-*-*-*.sock' 2>/dev/null | grep -q .; then
	bad "a uuid-shaped control socket exists — a cancelled mint leaked a server"
else
	ok "no uuid control socket leaked"
fi
rm -f "$rep_err"

# ─── RESUME-INTO-UUID — pre-cancel a resume INTO a legacy (non-garden) session ─
# A garden resident must refuse an IN-PROCESS resume that would land on a
# non-garden (legacy uuidv7) session id. session_before_switch reason="resume"
# reads the TARGET session header id; a non-garden target is cancelled FRIENDLY
# (0 tokens, process survives) so the resume never reaches the session_start hard
# guard that would process.exit(1) the whole resident. Driven via RPC
# switch_session into a SYNTHETIC legacy-uuid session file: runtime switchSession()
# calls emitBeforeSwitch("resume", path) BEFORE SessionManager.open, so the
# fixture only needs a readable {type:"session", id:<uuid>} header line. This is
# the missing direct proof of the friendly pre-cancel path (it was previously only
# backstopped by the session_start hard guard, never exercised on its own).
echo "[smoke-resident-garden-guard] RESUME-INTO-UUID: legacy-uuid resume pre-cancelled (RPC, 0 tokens)"
res_sid=$(bash "$REPO/run.sh" new-session-id)
legacy_uuid="0192f1a0-1234-7abc-89de-0123456789ab" # uuidv7 shape; NOT garden-native
legacy_dir=$(mktemp -d)
legacy_file="$legacy_dir/legacy-resume-target.jsonl"
printf '%s\n' "{\"type\":\"session\",\"id\":\"$legacy_uuid\",\"cwd\":\"$legacy_dir\"}" >"$legacy_file"
res_err=$(mktemp)
res_out=$(printf '%s\n' '{"type":"get_state"}' "{\"type\":\"switch_session\",\"sessionPath\":\"$legacy_file\"}" '{"type":"get_state"}' |
	timeout "$TIMEOUT" pi "${REPO_EXTENSION_ARGS[@]}" --session-id "$res_sid" --entwurf-control --provider "$PROVIDER" \
		--model "$MODEL" --mode rpc 2>"$res_err") || true

if printf '%s\n' "$res_out" | grep -q '"command":"switch_session","success":true,"data":{"cancelled":true}'; then
	ok "resume-into-uuid: switch_session cancelled (friendly pre-cancel fired)"
else
	bad "resume-into-uuid: switch_session was NOT cancelled — pre-switch guard missed the resume path"
fi

# Friendly guidance is the refuse path; assert BOTH the blocked-line and the
# garden-native reason so a generic block can't pass for the resume-specific one.
if grep -q "resume is blocked under --entwurf-control" "$res_err" && grep -q "is not garden-native" "$res_err"; then
	ok "resume-into-uuid: friendly refuse message on stderr (garden-native reason)"
else
	bad "resume-into-uuid: friendly refuse message not found (resume blocked + not garden-native)"
fi

# The session_start hard guard must NOT fire — the pre-switch cancel caught it first.
if grep -q "Non-garden session id" "$res_err"; then
	bad "resume-into-uuid: hard guard fired (Non-garden session id) — pre-cancel missed; resident would exit"
else
	ok "resume-into-uuid: hard guard never fired (pre-cancel caught it; resident survives)"
fi

# 0 tokens — the cancel happens before any model turn.
if printf '%s\n' "$res_out" | grep -q '"type":"agent_start"'; then
	bad "resume-into-uuid: agent_start seen — a model turn RAN (should be a 0-token cancel)"
else
	ok "resume-into-uuid: no agent_start — 0-token cancel path"
fi

# Resident stayed on its original garden id (both get_state report it, never the uuid).
res_ids=$(printf '%s\n' "$res_out" | grep -o '"sessionId":"[^"]*"' | sort -u)
if [ "$res_ids" = "\"sessionId\":\"$res_sid\"" ]; then
	ok "resume-into-uuid: resident stayed on the garden id ($res_sid)"
else
	bad "resume-into-uuid: sessionId drifted from $res_sid — got: ${res_ids:-<none>}"
fi

# No control socket for the legacy uuid (the cancelled resume never booted a server).
if [ -e "$ENTWURF_DIR/$legacy_uuid.sock" ]; then
	bad "resume-into-uuid: control socket created for the legacy uuid — server booted"
else
	ok "resume-into-uuid: no control socket for the legacy uuid"
fi
rm -f "$res_err"
rm -rf "$legacy_dir"

# ─── GNEW — /gnew births a NEW garden session IN-PROCESS (RPC, 0 tokens) ─────
# Builtin /new stays blocked (REPLACEMENT above); /gnew is its garden-native
# replacement. /gnew pre-creates an EMPTY garden session file and ctx.switchSession()es
# into it — switchSession→SessionManager.open() reads the garden header id BEFORE
# session_start, so the identity (file header, control socket, PI_SESSION_ID) is the
# garden id from the first bind: no torn uuid (unlike ctx.newSession, which mints a
# uuid first). Driven headless via RPC prompt "/gnew" — session.prompt intercepts the
# leading slash and runs the registered command BEFORE any model turn, so 0 tokens.
echo "[smoke-resident-garden-guard] GNEW: /gnew in-process garden birth (RPC prompt, 0 tokens)"
GARDEN_RE='^[0-9]{8}T[0-9]{6}-[0-9a-f]{6}$'
gnew_sid=$(bash "$REPO/run.sh" new-session-id)
gnew_json=$(node --experimental-strip-types "$REPO/scripts/gnew-rpc-drive.ts" "$gnew_sid" "$PROVIDER" "$MODEL" "$((TIMEOUT * 1000))") || true

jstr() { printf '%s' "$gnew_json" | grep -o "\"$1\":\"[^\"]*\"" | head -1 | sed 's/.*:"//;s/"$//'; }
g_before=$(jstr before)
g_after=$(jstr after)

if [ "$g_before" = "$gnew_sid" ]; then
	ok "/gnew: session started on the launched garden id ($gnew_sid)"
else
	bad "/gnew: before id ('$g_before') != launched ($gnew_sid)"
fi

if [ -n "$g_after" ] && [ "$g_after" != "$g_before" ] && [[ "$g_after" =~ $GARDEN_RE ]]; then
	ok "/gnew: switched to a NEW garden id ($g_after)"
else
	bad "/gnew: after id ('$g_after') is not a fresh garden id"
fi

if printf '%s' "$gnew_json" | grep -q '"promptOk":true'; then
	ok "/gnew: prompt accepted (slash command intercepted, not modeled)"
else
	bad "/gnew: prompt not acknowledged — command may not be registered"
fi

if printf '%s' "$gnew_json" | grep -q '"agentStartSeen":true'; then
	bad "/gnew: agent_start seen — a model turn RAN (should be a 0-token command)"
else
	ok "/gnew: no agent_start — 0-token command path"
fi

if printf '%s' "$gnew_json" | grep -q '"afterMsgCount":0'; then
	ok "/gnew: new session is empty (messageCount 0, no turn)"
else
	bad "/gnew: new session not empty — afterMsgCount != 0"
fi

if printf '%s' "$gnew_json" | grep -q '"extensionErrors":\[\]'; then
	ok "/gnew: no extension error (handler did not throw)"
else
	bad "/gnew: extension error surfaced — handler threw (switch likely did not happen)"
fi

# New session file on disk: header id IS the garden id (no-rewrite-mint). The file
# may carry session-metadata entries (model_change / session_info) but NEVER a
# conversation message — that is asserted separately below.
gfile=$(find "$SESSIONS_BASE" -name "*_${g_after}.jsonl" 2>/dev/null | head -1)
if [ -n "$gfile" ] && head -1 "$gfile" | grep -q "\"type\":\"session\"[^}]*\"id\":\"$g_after\""; then
	ok "/gnew: new session file header id == $g_after (no uuid re-mint)"
else
	bad "/gnew: garden header id not found on disk for $g_after"
fi
# no conversation ran: the file may carry session-metadata entries
# (model_change / session_info) but NEVER a user/assistant message.
if [ -n "$gfile" ] && ! grep -qE '"type":"(message|user_message)"|"role":"assistant"' "$gfile"; then
	ok "/gnew: new session carries no conversation messages (clean birth)"
else
	bad "/gnew: new session has conversation messages — a turn leaked"
fi
# /gnew sessions are first-class residents: the control-tagged garden name is set
# at switch (the file already exists), and it must NEVER carry the entwurf tag.
if [ -n "$gfile" ] && grep -q "\"name\":\"${g_after}==[^\"]*__control\"" "$gfile"; then
	ok "/gnew: new session carries the 'control' resident name"
else
	bad "/gnew: new session missing the 'control' resident name"
fi
# Tag-position check ONLY: the `entwurf` RESUME-MARKER lives in the tag segment
# (after `__`), never the title slug. After the repo rename the cwd basename is
# `entwurf`, so the title slug legitimately IS `entwurf` — parseSessionName treats
# title:"entwurf"+tags:["control"] as NOT an Entwurf session. A bare substring
# grep false-positives on that slug; match the `__...entwurf...` tag segment only.
if [ -n "$gfile" ] && grep -qE "\"name\":\"${g_after}==[^\"]*__([a-z0-9-]+_)*entwurf(_[a-z0-9-]+)*\"" "$gfile"; then
	bad "/gnew: new session name carries the 'entwurf' tag — would be resumable as a child"
else
	ok "/gnew: new session name does NOT carry the 'entwurf' tag"
fi

# Control socket rebound to the new garden id; old one dropped; no uuid leak.
# (socketsAfterSwitch is snapshotted by the driver while pi is still alive.)
if printf '%s' "$gnew_json" | grep -q "\"${g_after}.sock\""; then
	ok "/gnew: control socket rebound to the new garden id"
else
	bad "/gnew: no control socket for the new garden id after switch"
fi
if printf '%s' "$gnew_json" | grep -q "\"${g_before}.sock\""; then
	bad "/gnew: old garden socket still present — switch did not drop it"
else
	ok "/gnew: old garden socket dropped after switch"
fi
if printf '%s' "$gnew_json" | grep -qE '"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.sock"'; then
	bad "/gnew: a uuid-shaped control socket exists — torn identity"
else
	ok "/gnew: no uuid-shaped control socket (garden identity intact)"
fi
# clean up the empty garden session file /gnew created (litter hygiene)
[ -n "$gfile" ] && rm -f "$gfile"

# ─── GNEW T3 — backend identity after /gnew (entwurf_self, opt-in ~1 turn) ───
if [ "${SMOKE_RGG_POSITIVE:-0}" = "1" ]; then
	echo "[smoke-resident-garden-guard] GNEW T3: backend identity after /gnew (entwurf_self, 1 turn)"
	gself_sid=$(bash "$REPO/run.sh" new-session-id)
	self_prompt='Call the entwurf_self tool now, then reply with only the sessionId it returned.'
	gself_json=$(node --experimental-strip-types "$REPO/scripts/gnew-rpc-drive.ts" "$gself_sid" "$PROVIDER" "$MODEL" "$((TIMEOUT * 1000))" "$self_prompt") || true
	gs_after=$(printf '%s' "$gself_json" | grep -o '"after":"[^"]*"' | head -1 | sed 's/.*:"//;s/"$//')
	gs_ids=$(printf '%s' "$gself_json" | grep -o '"selfEnvelopeSessionIds":\[[^]]*\]' | head -1)

	if printf '%s' "$gself_json" | grep -q '"selfTurnEnded":true'; then
		ok "/gnew T3: entwurf_self turn completed"
	else
		bad "/gnew T3: entwurf_self turn did not complete (timeout?)"
	fi
	# The envelope sessionId the backend MCP child reports MUST be the NEW garden
	# id — proves PI_SESSION_ID propagated through streamShellAcp after the switch.
	if [ -n "$gs_after" ] && printf '%s' "$gs_ids" | grep -q "\"$gs_after\""; then
		ok "/gnew T3: backend entwurf_self sessionId == new garden id ($gs_after)"
	else
		bad "/gnew T3: backend identity mismatch — envelope did not report $gs_after (got $gs_ids)"
	fi
	# ...and NOT the pre-switch launched id (that would mean a torn/stale identity).
	if printf '%s' "$gs_ids" | grep -q "\"$gself_sid\""; then
		bad "/gnew T3: backend reported the PRE-switch id ($gself_sid) — torn identity"
	else
		ok "/gnew T3: backend did not report the pre-switch id (no torn identity)"
	fi
	[ -n "$gs_after" ] && find "$SESSIONS_BASE" -name "*_${gs_after}.jsonl" -delete 2>/dev/null || true
fi

# ─── POSITIVE — garden session passes + control name (opt-in, costs a turn) ──
if [ "${SMOKE_RGG_POSITIVE:-0}" = "1" ]; then
	echo "[smoke-resident-garden-guard] POSITIVE: garden --session-id (SMOKE_RGG_POSITIVE=1)"
	pos_sid=$(bash "$REPO/run.sh" new-session-id)
	pos_ec=0
	pos_out=$(timeout "$TIMEOUT" pi "${REPO_EXTENSION_ARGS[@]}" --session-id "$pos_sid" --entwurf-control --provider "$PROVIDER" \
		--model "$MODEL" --mode json -p 'reply OK only' 2>&1) || pos_ec=$?

	if [ "$pos_ec" -eq 0 ] && ! printf '%s\n' "$pos_out" | grep -q "Non-garden session id"; then
		ok "garden session not refused (exit 0, no guard)"
	else
		bad "garden session was refused (exit=$pos_ec) — false positive in the guard"
	fi

	pos_file=$(find "$SESSIONS_BASE" -name "*_${pos_sid}.jsonl" 2>/dev/null | head -1)
	if [ -n "$pos_file" ] && grep -q "\"type\":\"session\"[^}]*\"id\":\"$pos_sid\"" "$pos_file"; then
		ok "garden header id on disk ($pos_sid)"
	else
		bad "garden header id not found on disk for $pos_sid"
	fi

	if [ -n "$pos_file" ] && grep -q "\"name\":\"${pos_sid}==[^\"]*__control\"" "$pos_file"; then
		ok "resident name carries the 'control' tag"
	else
		bad "resident name with 'control' tag not found"
	fi
	# Tag-position check only (see /gnew block above): match the `__...entwurf...`
	# tag segment, not the title slug (which is legitimately `entwurf` post-rename).
	if [ -n "$pos_file" ] && grep -qE "\"name\":\"${pos_sid}==[^\"]*__([a-z0-9-]+_)*entwurf(_[a-z0-9-]+)*\"" "$pos_file"; then
		bad "resident name carries the 'entwurf' tag — would be resumable as a child"
	else
		ok "resident name does NOT carry the 'entwurf' tag"
	fi
else
	note "POSITIVE skipped (set SMOKE_RGG_POSITIVE=1 to run; costs ~1 cheap turn)"
fi

echo "[smoke-resident-garden-guard] PASS=$pass FAIL=$fail"
[ "$fail" -eq 0 ]
