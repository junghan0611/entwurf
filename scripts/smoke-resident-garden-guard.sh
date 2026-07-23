#!/usr/bin/env bash
#
# smoke-resident-garden-guard — LIVE gate for resident garden identity, INVERTED by
# the #50 C2 cut.
#
# The guard's reason for existing is unchanged: **a resident `--entwurf-control`
# session that is not addressable must not survive quietly.** What changed is the
# failing condition. It used to be a GRAMMAR check — pi's session id had to be a
# garden id, injected by the launcher, and a uuidv7 hard-exited the process before
# any model turn ("비-garden id가 보이면 바로 터져야 돼"). The meta-record now mints
# the address, so pi's uuid is NORMAL and there is no id to police. Survival means
# something stronger and more honest:
#
#     alive  ⟺  a V3 meta-record (backend:"pi") exists for this session
#               AND the control socket is keyed on that record's gardenId.
#
# The negative that survives is the one that still bites: NO socket may ever carry
# pi's session id. That is the pre-cut address, and its reappearance would mean the
# id authority came back — the exact split ② was chosen to prevent.
#
#   BIRTH (0 tokens, the must-have): raw `pi --entwurf-control` with NO --session-id
#     — the shape that used to blow up — must now come up as a citizen:
#       - a record with backend:"pi", schemaVersion 3, nativeSessionId == pi's id
#       - a control socket named <gardenId>.sock
#       - NO <nativeSessionId>.sock and no uuid-shaped socket at all
#       - no "Non-garden session id" refusal anywhere (the guard text is gone)
#       - no model turn (no agent_start; zero tokens)
#
#   ATTACH (0 tokens): relaunching the SAME pi session by FILE (`--session <path>`,
#     the argv the v2 spawn path now builds) must re-attach to the SAME gardenId, on
#     the same socket, with no second record. A re-open that minted a new address
#     would move a live citizen out from under every peer holding it.
#
#   REPLACEMENT (0 tokens): in-process `/new` is ALLOWED now — it used to be
#     cancelled because the uuid it mints would hard-exit the process. The
#     replacement session becomes its own citizen and the socket rebinds to its
#     address; no uuid socket appears.
#
#   POSITIVE (opt-in, ~1 cheap turn; SMOKE_RGG_POSITIVE=1): after one real turn the
#     record carries the transcriptPath and model that were unknown at birth — the
#     turn_end attach, which is what makes the citizen resumable (C3 reads exactly
#     these fields).
#
# Cost: BIRTH + ATTACH + REPLACEMENT = 0 tokens. POSITIVE = ~1 cheap turn.
#
# ISOLATION. This is a LIVE gate and drives the real `pi` binary, but it points
# PI_CODING_AGENT_DIR at a temp dir so its records and sessions never land in the
# operator's store. That is not decoration during the #50 window: the live store is
# still v2 and V3-only production would mint fresh V3 records beside pre-cut ones,
# manufacturing exactly the mixed store M1 exists to prevent. Control sockets stay in
# the real ENTWURF_DIR (ephemeral runtime files, removed at shutdown) so the socket
# assertions observe the same directory a real resident uses.
#
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# Records + pi sessions go to a throwaway agent dir (see ISOLATION above).
RGG_AGENT_DIR="$(mktemp -d)"
export PI_CODING_AGENT_DIR="$RGG_AGENT_DIR"
SESSIONS_BASE="$RGG_AGENT_DIR/sessions"
cleanup() { rm -rf "$RGG_AGENT_DIR"; }
trap cleanup EXIT
# Default target stays pi-native (openai-codex/gpt-5.4), but honor the SAME target
# knob as the other live smokes: ENTWURF_LIVE_TARGET="<provider>/<model>". On
# acp-on-v2 the ACP `entwurf` provider is back, and `./run.sh smoke-acp-rgg-live`
# drives THIS runner against it (deterministic half) — the citizen logic (record +
# record-keyed socket) is provider-agnostic, no assertion checks the provider name.
# RGG-specific SMOKE_RGG_PROVIDER/MODEL still override.
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

GARDEN_RE='[0-9]{8}T[0-9]{6}-[0-9a-f]{6}'
UUID_SOCK_RE='"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.sock"'

drive() { node --experimental-strip-types "$REPO/scripts/resident-rpc-drive.ts" "$PROVIDER" "$MODEL" "$((TIMEOUT * 1000))" "$@"; }
jstr() { printf '%s' "$1" | grep -o "\"$2\":\"[^\"]*\"" | head -1 | sed 's/.*:"//;s/"$//'; }

# ─── BIRTH — no --session-id: pi mints a uuid, the RECORD mints the address ──
echo "[smoke-resident-garden-guard] BIRTH: raw 'pi --entwurf-control' (no --session-id) becomes a citizen"
birth_json=$(drive) || true
birth_native=$(jstr "$birth_json" nativeSessionId)
birth_garden=$(jstr "$birth_json" selfGardenId)

if [ -n "$birth_native" ]; then
	ok "resident came up and reported a session id ($birth_native)"
else
	bad "no session id reported — pi did not come up (driver: ${birth_json:-<empty>})"
fi

if printf '%s' "$birth_json" | grep -q "Non-garden session id"; then
	bad "the pre-cut garden-id refusal fired — the deleted guard is still in the tree"
else
	ok "no 'Non-garden session id' refusal (the id grammar no longer gates a resident)"
fi

# The record: V3, backend pi, joined to pi's OWN id.
if printf '%s' "$birth_json" | grep -q '"backend":"pi"' &&
	printf '%s' "$birth_json" | grep -q '"schemaVersion":3' &&
	printf '%s' "$birth_json" | grep -q "\"nativeSessionId\":\"$birth_native\""; then
	ok "V3 meta-record written with backend:\"pi\" and nativeSessionId == pi's session id"
else
	bad "no V3 pi record joined to $birth_native — the session is not a citizen"
fi

if [ -n "$birth_garden" ] && printf '%s' "$birth_garden" | grep -qE "^$GARDEN_RE$"; then
	ok "the record minted a garden address ($birth_garden)"
else
	bad "no garden address minted (got '${birth_garden:-<none>}')"
fi

if [ -n "$birth_garden" ] && [ "$birth_garden" != "$birth_native" ]; then
	ok "the address is the RECORD's, not pi's session id"
else
	bad "gardenId == nativeSessionId — the two authorities are still fused"
fi

# The socket: keyed on the record gardenId, and NEVER on pi's id.
birth_sockets=$(printf '%s' "$birth_json" | grep -o '"socketsWhileAlive":\[[^]]*\]' | head -1)
if [ -n "$birth_garden" ] && printf '%s' "$birth_sockets" | grep -q "\"$birth_garden.sock\""; then
	ok "control socket keyed on the record gardenId ($birth_garden.sock)"
else
	bad "no control socket for the record gardenId — got: ${birth_sockets:-<none>}"
fi

if [ -n "$birth_native" ] && printf '%s' "$birth_sockets" | grep -q "\"$birth_native.sock\""; then
	bad "a socket carries pi's session id ($birth_native.sock) — the pre-cut address is back"
else
	ok "no socket carries pi's session id (the pre-cut address is gone)"
fi

if printf '%s' "$birth_sockets" | grep -qE "$UUID_SOCK_RE"; then
	bad "a uuid-shaped control socket exists — an unaddressable resident stood a server up"
else
	ok "no uuid-shaped control socket"
fi

if printf '%s' "$birth_json" | grep -q '"agentStartSeen":true'; then
	bad "agent_start present — a model turn RAN (this cell must cost 0 tokens)"
else
	ok "no agent_start — model turn never started (0 tokens)"
fi

if printf '%s' "$birth_json" | grep -q '"extensionErrors":\[\]'; then
	ok "no extension error (the control extension loaded and bound cleanly)"
else
	bad "extension error surfaced — session_start threw: $(printf '%s' "$birth_json" | grep -o '"extensionErrors":\[[^]]*\]')"
fi

# ─── ATTACH — re-open the SAME session BY FILE: the address must hold ────────
echo "[smoke-resident-garden-guard] ATTACH: re-open by --session <file> keeps the same address"
birth_file=$(jstr "$birth_json" sessionFile)
if [ -z "$birth_file" ] || [ ! -f "$birth_file" ]; then
	# pi defers the session file until the first assistant turn, so a 0-token birth
	# may leave nothing to re-open. Synthesize the same-native-id re-open instead of
	# skipping: the invariant under test is the record join, not pi's persistence.
	birth_file="$SESSIONS_BASE/rgg-attach/$(date +%Y-%m-%dT%H-%M-%S-000Z)_${birth_native}.jsonl"
	mkdir -p "$(dirname "$birth_file")"
	printf '%s\n' "{\"type\":\"session\",\"version\":3,\"id\":\"$birth_native\",\"cwd\":\"$PWD\"}" >"$birth_file"
	note "birth left no session file (0-token run); re-opening a header-only file with the same id"
fi

attach_json=$(drive "$birth_file") || true
attach_native=$(jstr "$attach_json" nativeSessionId)
attach_garden=$(jstr "$attach_json" selfGardenId)

if [ "$attach_native" = "$birth_native" ]; then
	ok "re-open landed on the same pi session ($attach_native)"
else
	bad "re-open opened a DIFFERENT pi session (${attach_native:-<none>} != $birth_native)"
fi

if [ -n "$attach_garden" ] && [ "$attach_garden" = "$birth_garden" ]; then
	ok "the garden address is unchanged across the re-open ($attach_garden)"
else
	bad "the address MOVED on re-open ($birth_garden → ${attach_garden:-<none>}) — peers would be stranded"
fi

# Counted by the driver against the exact native id (a text sweep here also matched
# the driver's own top-level nativeSessionId field and reported a false duplicate).
attach_record_count=$(printf '%s' "$attach_json" | grep -o '"selfRecordCount":[0-9]*' | head -1 | sed 's/.*://')
if [ "$attach_record_count" = "1" ]; then
	ok "exactly ONE record still holds this native session (attach, not a second mint)"
else
	bad "$attach_record_count records claim $birth_native — the re-open minted a duplicate"
fi

attach_sockets=$(printf '%s' "$attach_json" | grep -o '"socketsWhileAlive":\[[^]]*\]' | head -1)
if [ -n "$attach_garden" ] && printf '%s' "$attach_sockets" | grep -q "\"$attach_garden.sock\""; then
	ok "the socket came back up on the same address"
else
	bad "no socket on the re-opened address — got: ${attach_sockets:-<none>}"
fi

# ─── REPLACEMENT — in-process /new is ALLOWED and rebinds the address ────────
echo "[smoke-resident-garden-guard] REPLACEMENT: in-process new_session is allowed (RPC, 0 tokens)"
rep_json=$(drive "" 1) || true
rep_before=$(jstr "$rep_json" nativeSessionId)
rep_after=$(jstr "$rep_json" replacedNativeSessionId)

if printf '%s' "$rep_json" | grep -q '"replaceCancelled":true'; then
	bad "new_session was CANCELLED — the deleted in-process mint refusal is still in the tree"
else
	ok "new_session was not cancelled (/new is pi's again)"
fi

if [ -n "$rep_after" ] && [ "$rep_after" != "$rep_before" ]; then
	ok "the process survived the replacement and moved to a new pi session ($rep_after)"
else
	bad "no replacement session observed (before=$rep_before after=${rep_after:-<none>})"
fi

rep_sockets=$(printf '%s' "$rep_json" | grep -o '"socketsAfterReplace":\[[^]]*\]' | head -1)
rep_after_garden=$(jstr "$rep_json" replacedGardenId)
rep_after_count=$(printf '%s' "$rep_json" | grep -o '"replacedRecordCount":[0-9]*' | head -1 | sed 's/.*://')
if [ -n "$rep_after_garden" ] && [ "$rep_after_count" = "1" ]; then
	ok "the replacement session became its own citizen (record $rep_after_garden joined to $rep_after)"
else
	bad "the replacement session has no record — an unaddressable resident survived"
fi

if printf '%s' "$rep_sockets" | grep -qE "$UUID_SOCK_RE"; then
	bad "a uuid-shaped socket appeared after the replacement — the pre-cut address is back"
else
	ok "no uuid-shaped socket after the replacement"
fi

if printf '%s' "$rep_json" | grep -q '"agentStartSeen":true'; then
	bad "agent_start present in the replacement cell — a model turn RAN"
else
	ok "replacement ran at 0 tokens"
fi

# ─── POSITIVE — one real turn fills transcriptPath + model (opt-in) ──────────
if [ "${SMOKE_RGG_POSITIVE:-0}" = "1" ]; then
	echo "[smoke-resident-garden-guard] POSITIVE: one turn completes the record (SMOKE_RGG_POSITIVE=1)"
	pos_ec=0
	pos_out=$(timeout "$TIMEOUT" pi "${REPO_EXTENSION_ARGS[@]}" --entwurf-control --provider "$PROVIDER" \
		--model "$MODEL" --mode json -p 'reply OK only' 2>&1) || pos_ec=$?

	if [ "$pos_ec" -eq 0 ]; then
		ok "a plain (no --session-id) resident ran a turn and exited cleanly"
	else
		bad "resident turn failed (exit=$pos_ec)"
	fi

	pos_native=$(printf '%s\n' "$pos_out" | grep -o '"type":"session"[^}]*"id":"[^"]*"' | head -1 | grep -o '"id":"[^"]*"' | head -1 | sed 's/.*:"//;s/"$//' || true)
	pos_record=$(grep -l "\"nativeSessionId\": \"$pos_native\"" "$RGG_AGENT_DIR"/meta-sessions/*.meta.json 2>/dev/null | head -1 || true)
	if [ -n "$pos_record" ]; then
		ok "the turn's session has a record ($(basename "$pos_record"))"
	else
		bad "no record for the session that ran a turn ($pos_native)"
	fi

	# turn_end attaches the fields that were unknown at birth. These two ARE the
	# resume target C3 reads; a record stuck at null is a citizen nobody can wake.
	if [ -n "$pos_record" ] && grep -q '"transcriptPath": "/' "$pos_record"; then
		ok "turn_end recorded the transcriptPath (the resume target)"
	else
		bad "transcriptPath still null after a completed turn — turn_end attach did not run"
	fi
	if [ -n "$pos_record" ] && grep -qE '"model": "[^"]+/' "$pos_record"; then
		ok "turn_end recorded the resolved <provider>/<model>"
	else
		bad "model still null after a completed turn"
	fi
else
	note "POSITIVE skipped (set SMOKE_RGG_POSITIVE=1 to run; costs ~1 cheap turn)"
fi

echo "[smoke-resident-garden-guard] PASS=$pass FAIL=$fail"
[ "$fail" -eq 0 ]
