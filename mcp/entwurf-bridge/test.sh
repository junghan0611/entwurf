#!/usr/bin/env bash
set -euo pipefail

# entwurf-bridge smoke (v2-only): tool registration + a few no-side-effect calls.
SOURCE="${BASH_SOURCE[0]}"
while [ -L "$SOURCE" ]; do
  DIR="$(cd -P "$(dirname "$SOURCE")" && pwd)"
  TARGET="$(readlink "$SOURCE")"
  case "$TARGET" in
    /*) SOURCE="$TARGET" ;;
    *) SOURCE="$DIR/$TARGET" ;;
  esac
done
ROOT_DIR="$(cd -P "$(dirname "$SOURCE")/../.." && pwd)"
BRIDGE_LAUNCHER="$ROOT_DIR/mcp/entwurf-bridge/start.sh"

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
    -u ENTWURF_BRIDGE_ALLOW_ANONYMOUS_SENDER \
    ENTWURF_META_SENDERS_DIR="$tmp_meta_senders" \
    bash "$BRIDGE_LAUNCHER" <<'EOF'
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

# The payload rides an ENV VAR, not stdin. It used to be `python3 - <<'PY' <<<"$TOOLS_JSON"`,
# which is TWO redirections onto fd 0: the here-string wins, so python read the tools/list JSON
# as its PROGRAM (a bare dict literal — valid Python that does nothing) and the here-doc below
# never ran at all. Every assertion in this block was dead from the day it was written, and the
# `ok:` line beneath printed unconditionally. Keep exactly one stdin here.
TOOLS_JSON="$TOOLS_JSON" python3 - <<'PY'
import json, os
obj=json.loads(os.environ["TOOLS_JSON"])
raw=[t['name'] for t in obj['result']['tools']]
names=set(raw)
# EXACT set, not a floor. This suite ships inside the tarball and is what an installed
# `entwurf check-bridge` runs against the dist branch of start.sh, so a subset check here
# was an artifact-surface hole: a bundle missing entwurf_fresh_call / entwurf_resume_call
# answered tools/list and passed. Equality also refuses an undecided extra verb; the
# duplicate arm catches a name registered twice, which set membership cannot see.
expected={'entwurf_v2','entwurf_self','entwurf_peers','entwurf_inbox_read','entwurf_register_native','entwurf_fresh_call','entwurf_resume_call'}
legacy={'entwurf','entwurf_resume','entwurf_send'} & names
if len(raw)!=len(names):
    raise SystemExit(f"duplicate tool registrations: {sorted(raw)}")
# Named negative first, so a resurrected v1 verb keeps its own diagnosis instead of
# arriving as a nameless "unexpected" entry in the equality message below.
if legacy:
    raise SystemExit(f"legacy v1 tools still registered: {sorted(legacy)}")
if names!=expected:
    raise SystemExit(f"tool set MISMATCH — missing {sorted(expected-names)}, unexpected {sorted(names-expected)}")
PY
ok "public tool surface is EXACTLY the seven garden verbs (no v1 verb, no undecided extra, no duplicate)"

SELF_JSON="$(printf '%s\n' "$OUT" | grep '"id":3' | tail -1)"
[[ "$SELF_JSON" == *"isError"* ]] || fail "entwurf_self without identity should be an error: $SELF_JSON"
ok "entwurf_self refuses anonymous caller"

INBOX_JSON="$(printf '%s\n' "$OUT" | grep '"id":4' | tail -1)"
[[ "$INBOX_JSON" == *"empty"* || "$INBOX_JSON" == *"error"* ]] || fail "inbox_read returned unexpected response: $INBOX_JSON"
ok "inbox_read responds"
