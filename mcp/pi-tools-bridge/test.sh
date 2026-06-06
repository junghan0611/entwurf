#!/usr/bin/env bash
# pi-tools-bridge smoke tests.
#
# Exercises the six tools the bridge is allowed to expose (narrow scope —
# anything the MCP bridge doesn't strictly need to bridge pi lives as a skill
# instead):
#   - entwurf_send
#   - entwurf_peers
#   - entwurf
#   - entwurf_resume
#   - entwurf_self        (0.4.14 — own session identity envelope)
#   - entwurf_inbox_read  (0.10.0 meta-bridge — receiver half of the mailbox path)
#
# Layers:
#   1. tools/list parity
#   2. unknown-tool error surface
#   3. entwurf_send envelope contract (env-missing wiring break vs valid-env missing-socket)
#   3b. entwurf_peers empty environment
#   4. entwurf bogus SSH host
#   4b. entwurf_resume unknown sessionId
#   4c-4e. Schema + registry gates
#   5. entwurf_self positive (with env) and negative (env wiring break)
#
# Runs straight against start.sh (no build step — src/*.ts is loaded by
# --experimental-strip-types).

set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
EXPECTED_TOOLS=("entwurf_send" "entwurf_peers" "entwurf" "entwurf_resume" "entwurf_self" "entwurf_inbox_read")
PASS=0
FAIL=0

# Synthetic envelope env values used by the positive paths. UUID-shaped sessionId
# so any later code path that validates UUID format keeps working; agentId in the
# bridge's canonical "<provider>/<model>" shape. These are intentionally NOT real
# session ids — the negative paths exercise the "valid envelope, missing socket"
# branch, which is the post-0.4.14 distinction between schema rejection and
# wiring rejection.
SYNTHETIC_SESSION_ID="00000000-0000-4000-8000-000000000000"
SYNTHETIC_AGENT_ID="pi-shell-acp/__test_model__"

red()   { printf '\033[31m%s\033[0m\n' "$1"; }
green() { printf '\033[32m%s\033[0m\n' "$1"; }

ok()   { green "  ✓ $1"; PASS=$((PASS+1)); }
fail() { red   "  ✗ $1"; FAIL=$((FAIL+1)); }

rpc() {
  # stdin: newline-delimited JSON-RPC requests
  # stdout: server responses, trimmed to 5s
  timeout 10 "$HERE/start.sh"
}

# ----------------------------------------------------------------------------
# 1. Protocol — tools/list returns expected names
# ----------------------------------------------------------------------------

echo "[1] tools/list parity"

TOOLS_JSON=$(
  {
    printf '%s\n' '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"0"}}}'
    printf '%s\n' '{"jsonrpc":"2.0","method":"notifications/initialized"}'
    printf '%s\n' '{"jsonrpc":"2.0","id":2,"method":"tools/list"}'
    sleep 0.5
  } | rpc 2>/dev/null | grep '"id":2' || true
)

if [ -z "$TOOLS_JSON" ]; then
  fail "no tools/list response"
else
  for tool in "${EXPECTED_TOOLS[@]}"; do
    if echo "$TOOLS_JSON" | grep -q "\"name\":\"$tool\""; then
      ok "exposes $tool"
    else
      fail "missing $tool"
    fi
  done
fi

# ----------------------------------------------------------------------------
# 2. Error paths — unknown tool + missing required arg
# ----------------------------------------------------------------------------

echo "[2] error surfaces"

UNKNOWN=$(
  {
    printf '%s\n' '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"0"}}}'
    printf '%s\n' '{"jsonrpc":"2.0","method":"notifications/initialized"}'
    printf '%s\n' '{"jsonrpc":"2.0","id":9,"method":"tools/call","params":{"name":"nonexistent_tool","arguments":{}}}'
    sleep 0.5
  } | rpc 2>/dev/null | grep '"id":9' || true
)
if echo "$UNKNOWN" | grep -qE '"(error|isError)"'; then
  ok "unknown tool rejected"
else
  fail "unknown tool did not surface error: $UNKNOWN"
fi

# ----------------------------------------------------------------------------
# 3a. entwurf_send external MCP path — missing PI_AGENT_ID / PI_SESSION_ID.
#     entwurf_send is identity-enhanced, not identity-required: external MCP
#     hosts may deliver to live pi sessions without a replyable pi sender
#     envelope. With a synthetic missing target, the correct negative surface is
#     therefore socket resolution, not envelope wiring. entwurf_self remains the
#     strict identity-required tool below.
# ----------------------------------------------------------------------------

echo "[3a] entwurf_send external MCP path (no PI_AGENT_ID / PI_SESSION_ID)"

SEND_WIRING=$(
  # unset both env keys for this subshell, then call
  env -u PI_AGENT_ID -u PI_SESSION_ID bash -c '
    {
      printf "%s\n" "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"initialize\",\"params\":{\"protocolVersion\":\"2024-11-05\",\"capabilities\":{},\"clientInfo\":{\"name\":\"test\",\"version\":\"0\"}}}"
      printf "%s\n" "{\"jsonrpc\":\"2.0\",\"method\":\"notifications/initialized\"}"
      printf "%s\n" "{\"jsonrpc\":\"2.0\",\"id\":10,\"method\":\"tools/call\",\"params\":{\"name\":\"entwurf_send\",\"arguments\":{\"sessionId\":\"'$SYNTHETIC_SESSION_ID'\",\"message\":\"hi\"}}}"
      sleep 0.5
    } | timeout 10 "'$HERE'/start.sh" 2>/dev/null | grep "\"id\":10" || true
  '
)
if echo "$SEND_WIRING" | grep -q '"isError":true' \
   && echo "$SEND_WIRING" | grep -qE '(No pi control socket|control dir not found)'; then
  ok "external MCP send reaches socket resolution without pi sender env"
else
  fail "external MCP send did not reach socket resolution: ${SEND_WIRING:0:300}"
fi

echo "[3a.1] entwurf_send external MCP rejects wants_reply=true"

SEND_EXTERNAL_REPLY=$(
  env -u PI_AGENT_ID -u PI_SESSION_ID bash -c '
    {
      printf "%s\n" "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"initialize\",\"params\":{\"protocolVersion\":\"2024-11-05\",\"capabilities\":{},\"clientInfo\":{\"name\":\"test\",\"version\":\"0\"}}}"
      printf "%s\n" "{\"jsonrpc\":\"2.0\",\"method\":\"notifications/initialized\"}"
      printf "%s\n" "{\"jsonrpc\":\"2.0\",\"id\":11,\"method\":\"tools/call\",\"params\":{\"name\":\"entwurf_send\",\"arguments\":{\"sessionId\":\"'$SYNTHETIC_SESSION_ID'\",\"message\":\"hi\",\"wants_reply\":true}}}"
      sleep 0.5
    } | timeout 10 "'$HERE'/start.sh" 2>/dev/null | grep "\"id\":11" || true
  '
)
if echo "$SEND_EXTERNAL_REPLY" | grep -q '"isError":true' \
   && echo "$SEND_EXTERNAL_REPLY" | grep -q 'wants_reply=true requires a replyable sender envelope'; then
  ok "external MCP send without pi/meta identity cannot request reply path"
else
  fail "external MCP wants_reply guard did not surface: ${SEND_EXTERNAL_REPLY:0:300}"
fi

# ----------------------------------------------------------------------------
# 3. entwurf_send missing-socket path — valid envelope, no socket on disk.
#    This is the negative path the pre-0.4.14 test thought it was running.
# ----------------------------------------------------------------------------

echo "[3] entwurf_send missing-socket path (valid envelope, no peer)"

SEND=$(
  PI_AGENT_ID="$SYNTHETIC_AGENT_ID" PI_SESSION_ID="$SYNTHETIC_SESSION_ID" bash -c '
    {
      printf "%s\n" "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"initialize\",\"params\":{\"protocolVersion\":\"2024-11-05\",\"capabilities\":{},\"clientInfo\":{\"name\":\"test\",\"version\":\"0\"}}}"
      printf "%s\n" "{\"jsonrpc\":\"2.0\",\"method\":\"notifications/initialized\"}"
      printf "%s\n" "{\"jsonrpc\":\"2.0\",\"id\":10,\"method\":\"tools/call\",\"params\":{\"name\":\"entwurf_send\",\"arguments\":{\"sessionId\":\"00000000-0000-4000-8000-deadbeefdead\",\"message\":\"hi\"}}}"
      sleep 0.5
    } | timeout 10 "'$HERE'/start.sh" 2>/dev/null | grep "\"id\":10" || true
  '
)
if echo "$SEND" | grep -q '"isError":true' && echo "$SEND" | grep -qE '(No pi control socket|control dir not found)'; then
  ok "missing socket returns isError + socket-resolution error"
else
  fail "missing socket did not surface socket error: ${SEND:0:300}"
fi

# ----------------------------------------------------------------------------
# 3b. entwurf_peers — must succeed (not isError) even when no live sessions exist
# ----------------------------------------------------------------------------

echo "[3b] entwurf_peers empty environment"

LIST=$(
  {
    printf '%s\n' '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"0"}}}'
    printf '%s\n' '{"jsonrpc":"2.0","method":"notifications/initialized"}'
    printf '%s\n' '{"jsonrpc":"2.0","id":15,"method":"tools/call","params":{"name":"entwurf_peers","arguments":{}}}'
    sleep 1
  } | rpc 2>/dev/null | grep '"id":15' || true
)
if echo "$LIST" | grep -q '"isError":true'; then
  fail "entwurf_peers reported isError on empty env: ${LIST:0:200}"
elif echo "$LIST" | grep -qE 'controlDir'; then
  ok "entwurf_peers returns controlDir + sessions payload"
else
  fail "entwurf_peers produced no payload: ${LIST:0:200}"
fi

# ----------------------------------------------------------------------------
# 4. entwurf negative path — bogus SSH host should surface isError
# ----------------------------------------------------------------------------

echo "[4] entwurf bogus-ssh negative path"

ENTWURF_NEG=$(
  {
    printf '%s\n' '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"0"}}}'
    printf '%s\n' '{"jsonrpc":"2.0","method":"notifications/initialized"}'
    printf '%s\n' '{"jsonrpc":"2.0","id":20,"method":"tools/call","params":{"name":"entwurf","arguments":{"task":"noop","host":"__pi_tools_bridge_bogus_host__"}}}'
    sleep 3
  } | timeout 15 "$HERE/start.sh" 2>/dev/null | grep '"id":20' || true
)
if echo "$ENTWURF_NEG" | grep -q '"isError":true'; then
  ok "bogus SSH host returns isError"
else
  fail "bogus SSH host did not surface isError: ${ENTWURF_NEG:0:200}"
fi

# ----------------------------------------------------------------------------
# 4b. entwurf_resume negative path — unknown sessionId must surface isError
# ----------------------------------------------------------------------------

echo "[4b] entwurf_resume unknown sessionId"

RESUME_NEG=$(
  # Hermetic env: this case asserts the external-MCP-host SYNC path
  # (isError + session_not_found). A replyable pi-session caller (PI_SESSION_ID
  # + PI_AGENT_ID present) would instead default to the async resume path, whose
  # error text is "entwurf_resume async error: ... session not found ...", NOT
  # the `session_not_found` token. Unset both so the gate is deterministic
  # regardless of who launches it — running release-gate from inside a live pi
  # session (which exports PI_SESSION_ID/PI_AGENT_ID) must not flip this result.
  unset PI_AGENT_ID PI_SESSION_ID
  {
    printf '%s\n' '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"0"}}}'
    printf '%s\n' '{"jsonrpc":"2.0","method":"notifications/initialized"}'
    printf '%s\n' '{"jsonrpc":"2.0","id":21,"method":"tools/call","params":{"name":"entwurf_resume","arguments":{"sessionId":"20990101T000000-deadbe","prompt":"noop"}}}'
    sleep 1
  } | rpc 2>/dev/null | grep '"id":21' || true
)
if echo "$RESUME_NEG" | grep -q '"isError":true' && echo "$RESUME_NEG" | grep -q 'session_not_found'; then
  ok "unknown sessionId returns isError + session_not_found"
else
  fail "unknown sessionId did not surface session_not_found: ${RESUME_NEG:0:200}"
fi

# ----------------------------------------------------------------------------
# 4c-4e. Schema + registry gates — fetch tools/list once, then assert against it.
# ----------------------------------------------------------------------------

SCHEMA_JSON=$(
  {
    printf '%s\n' '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"0"}}}'
    printf '%s\n' '{"jsonrpc":"2.0","method":"notifications/initialized"}'
    printf '%s\n' '{"jsonrpc":"2.0","id":22,"method":"tools/list"}'
    sleep 0.5
  } | rpc 2>/dev/null | grep '"id":22' || true
)

# 4c. Identity Preservation Rule — entwurf_resume schema must NOT expose `model`.
echo "[4c] entwurf_resume schema lockdown (no model param)"
RESUME_SCHEMA=$(echo "$SCHEMA_JSON" | python3 -c "
import json, sys
try:
  o = json.loads(sys.stdin.read())
  t = next((x for x in o['result']['tools'] if x['name'] == 'entwurf_resume'), None)
  if t is None: print('NOT_FOUND'); sys.exit(0)
  props = list(t['inputSchema'].get('properties', {}).keys())
  print(','.join(sorted(props)))
except Exception as e:
  print('PARSE_ERROR:', e)
")
if [ "$RESUME_SCHEMA" = "NOT_FOUND" ]; then
  fail "entwurf_resume tool not in tools/list: ${SCHEMA_JSON:0:200}"
elif echo "$RESUME_SCHEMA" | grep -qw model; then
  fail "entwurf_resume schema exposes 'model' (Identity Preservation Rule violation): $RESUME_SCHEMA"
elif ! echo "$RESUME_SCHEMA" | grep -qw sessionId; then
  fail "entwurf_resume schema unexpectedly missing 'sessionId': $RESUME_SCHEMA"
else
  ok "entwurf_resume schema has no 'model' (locked): $RESUME_SCHEMA"
fi

# 4d. entwurf schema must expose the new `provider` field for registry-aware calls.
echo "[4d] entwurf schema exposes provider field"
ENTWURF_SCHEMA=$(echo "$SCHEMA_JSON" | python3 -c "
import json, sys
try:
  o = json.loads(sys.stdin.read())
  t = next((x for x in o['result']['tools'] if x['name'] == 'entwurf'), None)
  if t is None: print('NOT_FOUND'); sys.exit(0)
  print(','.join(sorted(t['inputSchema'].get('properties', {}).keys())))
except Exception as e:
  print('PARSE_ERROR:', e)
")
if [ "$ENTWURF_SCHEMA" = "NOT_FOUND" ]; then
  fail "entwurf tool not in tools/list"
elif ! echo "$ENTWURF_SCHEMA" | grep -qw provider; then
  fail "entwurf schema missing 'provider' field: $ENTWURF_SCHEMA"
elif ! echo "$ENTWURF_SCHEMA" | grep -qw model; then
  fail "entwurf schema missing 'model' field: $ENTWURF_SCHEMA"
else
  ok "entwurf schema exposes provider + model: $ENTWURF_SCHEMA"
fi

# 4f. Static guard against the PM-flagged blocker class: runEntwurfAsync in
#     pi-extensions/entwurf.ts must reference the local `routing` variable, not
#     the legacy `explicitExtensions` (which was renamed). This file is now
#     covered by the root tsconfig, but the guard remains useful as a focused
#     regression assertion with a clearer failure than a broad typecheck error.
echo "[4d2] static guard: runEntwurfAsync uses 'routing' (no stale name)"
NATIVE_FILE="$HERE/../../pi-extensions/entwurf.ts"
if [ ! -f "$NATIVE_FILE" ]; then
  fail "static guard: native entwurf.ts not found at $NATIVE_FILE"
else
  STALE_REFS=$(awk '/^async function runEntwurfAsync/,/^\}$/' "$NATIVE_FILE" \
    | grep -nE '\bexplicitExtensions\.' \
    | grep -v 'info\.explicitExtensions' \
    | grep -v 'resumeInfo\.explicitExtensions' \
    || true)
  if [ -z "$STALE_REFS" ]; then
    ok "runEntwurfAsync clean (no stale 'explicitExtensions.X' references)"
  else
    fail "runEntwurfAsync still references stale 'explicitExtensions': $STALE_REFS"
  fi
fi

# 4e. Registry runtime gate — unregistered (provider, model) must be rejected.
echo "[4e] entwurf registry — unregistered (provider, model) rejected"
REGISTRY_NEG=$(
  {
    printf '%s\n' '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"0"}}}'
    printf '%s\n' '{"jsonrpc":"2.0","method":"notifications/initialized"}'
    printf '%s\n' '{"jsonrpc":"2.0","id":23,"method":"tools/call","params":{"name":"entwurf","arguments":{"task":"noop","host":"__bogus__","provider":"__not_a_provider__","model":"__not_a_model__"}}}'
    sleep 1
  } | rpc 2>/dev/null | grep '"id":23' || true
)
if echo "$REGISTRY_NEG" | grep -q '"isError":true' \
   && echo "$REGISTRY_NEG" | grep -q 'not in the entwurf target registry' \
   && echo "$REGISTRY_NEG" | grep -q 'Allowed:'; then
  ok "unregistered (provider, model) rejected with allowed-list hint"
else
  fail "unregistered tuple did not surface registry rejection: ${REGISTRY_NEG:0:300}"
fi

# ----------------------------------------------------------------------------
# 5. entwurf_self envelope contract.
#    Positive: env present → response carries sessionId / agentId / cwd /
#    timestamp / socketPath.
#    Negative: env missing → EntwurfEnvelopeWiringError surfaced as isError.
#    This strictness now belongs to entwurf_self only; entwurf_send permits an
#    external non-replyable sender path.
# ----------------------------------------------------------------------------

echo "[5a] entwurf_self positive (envelope present)"

SELF_OK=$(
  PI_AGENT_ID="$SYNTHETIC_AGENT_ID" PI_SESSION_ID="$SYNTHETIC_SESSION_ID" bash -c '
    {
      printf "%s\n" "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"initialize\",\"params\":{\"protocolVersion\":\"2024-11-05\",\"capabilities\":{},\"clientInfo\":{\"name\":\"test\",\"version\":\"0\"}}}"
      printf "%s\n" "{\"jsonrpc\":\"2.0\",\"method\":\"notifications/initialized\"}"
      printf "%s\n" "{\"jsonrpc\":\"2.0\",\"id\":30,\"method\":\"tools/call\",\"params\":{\"name\":\"entwurf_self\",\"arguments\":{}}}"
      sleep 0.5
    } | timeout 10 "'$HERE'/start.sh" 2>/dev/null | grep "\"id\":30" || true
  '
)
# entwurf_self emits two payload shapes inside the same content-text block — a
# human-readable label table ("sessionId:  …") and a trailing JSON one-liner.
# Either is enough to confirm the field is present; we check for the label form
# because it's stable across whitespace normalization in MCP transports.
if echo "$SELF_OK" | grep -q '"isError":true'; then
  fail "entwurf_self with envelope reported isError: ${SELF_OK:0:300}"
elif echo "$SELF_OK" | grep -q "$SYNTHETIC_SESSION_ID" \
     && echo "$SELF_OK" | grep -q "$SYNTHETIC_AGENT_ID" \
     && echo "$SELF_OK" | grep -q 'sessionId:' \
     && echo "$SELF_OK" | grep -q 'agentId:' \
     && echo "$SELF_OK" | grep -q 'cwd:' \
     && echo "$SELF_OK" | grep -q 'timestamp:' \
     && echo "$SELF_OK" | grep -q 'socketPath:'; then
  ok "entwurf_self echoes sessionId/agentId/cwd/timestamp/socketPath"
else
  fail "entwurf_self payload incomplete: ${SELF_OK:0:300}"
fi

echo "[5b] entwurf_self negative (envelope wiring break)"

SELF_BAD=$(
  env -u PI_AGENT_ID -u PI_SESSION_ID bash -c '
    {
      printf "%s\n" "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"initialize\",\"params\":{\"protocolVersion\":\"2024-11-05\",\"capabilities\":{},\"clientInfo\":{\"name\":\"test\",\"version\":\"0\"}}}"
      printf "%s\n" "{\"jsonrpc\":\"2.0\",\"method\":\"notifications/initialized\"}"
      printf "%s\n" "{\"jsonrpc\":\"2.0\",\"id\":31,\"method\":\"tools/call\",\"params\":{\"name\":\"entwurf_self\",\"arguments\":{}}}"
      sleep 0.5
    } | timeout 10 "'$HERE'/start.sh" 2>/dev/null | grep "\"id\":31" || true
  '
)
if echo "$SELF_BAD" | grep -q '"isError":true' \
   && echo "$SELF_BAD" | grep -q 'envelope wiring incomplete' \
   && echo "$SELF_BAD" | grep -q 'PI_AGENT_ID'; then
  ok "entwurf_self surfaces wiring break (no PI_AGENT_ID / PI_SESSION_ID)"
else
  fail "entwurf_self wiring break did not surface: ${SELF_BAD:0:300}"
fi

# ----------------------------------------------------------------------------

echo
if [ "$FAIL" -eq 0 ]; then
  green "$PASS/$((PASS+FAIL)) passed"
  exit 0
else
  red "$FAIL failed, $PASS passed"
  exit 1
fi
