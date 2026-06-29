#!/usr/bin/env bash
set -euo pipefail

# entwurf-bridge smoke (v2-only): tool registration + a few no-side-effect calls.
ROOT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
BRIDGE="$ROOT_DIR/mcp/entwurf-bridge/src/index.ts"

fail() { echo "FAIL: $*" >&2; exit 1; }
ok() { echo "ok: $*"; }

jsonrpc() {
  local tmp_meta_senders
  tmp_meta_senders="$(mktemp -d)"
  trap 'rm -rf "$tmp_meta_senders"' RETURN
  env \
    -u PI_SESSION_ID \
    -u PI_AGENT_ID \
    -u ENTWURF_META_SENDER_MARKER \
    -u ENTWURF_BRIDGE_REQUIRE_META_SENDER \
    ENTWURF_META_SENDERS_DIR="$tmp_meta_senders" \
    node --experimental-strip-types "$BRIDGE" <<'EOF'
{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"smoke","version":"0"}}}
{"jsonrpc":"2.0","method":"notifications/initialized","params":{}}
{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}
{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"entwurf_self","arguments":{}}}
{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"entwurf_inbox_read","arguments":{"gardenId":"20990101T000000-deadbe"}}}
EOF
}

OUT="$(jsonrpc)"
TOOLS_JSON="$(printf '%s\n' "$OUT" | grep '"id":2' | tail -1)"
[[ -n "$TOOLS_JSON" ]] || fail "missing tools/list response: $OUT"

python3 - <<'PY' <<<"$TOOLS_JSON"
import json, sys
obj=json.load(sys.stdin)
names={t['name'] for t in obj['result']['tools']}
expected={'entwurf_v2','entwurf_self','entwurf_peers','entwurf_inbox_read'}
missing=expected-names
legacy={'entwurf','entwurf_resume','entwurf_send'} & names
if missing:
    raise SystemExit(f"missing tools: {sorted(missing)}")
if legacy:
    raise SystemExit(f"legacy v1 tools still registered: {sorted(legacy)}")
PY
ok "v2-only tool surface registered"

SELF_JSON="$(printf '%s\n' "$OUT" | grep '"id":3' | tail -1)"
[[ "$SELF_JSON" == *"isError"* ]] || fail "entwurf_self without identity should be an error: $SELF_JSON"
ok "entwurf_self refuses anonymous caller"

INBOX_JSON="$(printf '%s\n' "$OUT" | grep '"id":4' | tail -1)"
[[ "$INBOX_JSON" == *"empty"* || "$INBOX_JSON" == *"error"* ]] || fail "inbox_read returned unexpected response: $INBOX_JSON"
ok "inbox_read responds"
