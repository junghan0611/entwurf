#!/usr/bin/env bash
# smoke-meta-keyset-guard — deterministic regression for the PREVENTIVE keyset
# guard (check-keyset-overlap) + the managed-keys SSOT it reads. Proves a
# disjoint consumer fragment passes, and that exact / array / parent-child key
# collisions fail loud, while unrelated sibling keys (permissions.defaultMode,
# language) stay clean. Offline / hermetic (synthetic fragments). Deps: bash +
# python3. The effect-based survival half (doctor's state.py check catching an
# overwritten pi key) is regression-tested in smoke-meta-install-state.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/.." && pwd)"
STATE="$REPO/scripts/meta-bridge-state.py"
OVERLAP="$REPO/scripts/check-keyset-overlap.py"

command -v python3 >/dev/null || { echo "FAIL: python3 not on PATH"; exit 1; }

fail=0
ok()  { echo "  ok    $*"; }
bad() { echo "  FAIL  $*"; fail=1; }

TMP="$(mktemp -d -t psa-meta-keyset.XXXXXX)"
cleanup() { rm -rf "$TMP"; }
trap cleanup EXIT

# --- managed-keys SSOT sanity ------------------------------------------------
KEYS_JSON="$(python3 "$STATE" managed-keys)"
echo "$KEYS_JSON" | python3 -c "
import json,sys
d=json.load(sys.stdin)
s=d['settings']
assert 'statusLine' in s['map-entry'], 'statusLine missing from SSOT map-entry'
assert 'permissions.allow' in s['array-items'] and 'permissions.deny' in s['array-items'], 'permissions missing'
assert 'verbose' in s['scalar'] and 'autoCompactEnabled' in s['scalar'], 'scalar policy missing'
assert any(k.startswith('enabledPlugins.') for k in s['map-entry']), 'plugin ref missing'
assert d['claudeRoot']['map-entry'] == ['mcpServers.entwurf-bridge'], 'MCP key missing'
" && ok "managed-keys SSOT is valid JSON with the expected owned keys" \
  || bad "managed-keys SSOT malformed or missing expected keys"

# --- DISJOINT consumer fragment passes ---------------------------------------
# Mirrors a clean agent-config fragment: its OWN concerns only. permissions.defaultMode
# and language must NOT trip the guard (pi owns permissions.allow/deny + scalars, not these).
cat > "$TMP/disjoint.json" <<'JSON'
{
  "permissions": { "defaultMode": "acceptEdits" },
  "hooks": { "SessionStart": [] },
  "enabledPlugins": { "github@claude-plugins-official": true },
  "language": "ko",
  "editorMode": "normal",
  "preferredNotifChannel": "notifications_disabled"
}
JSON
if python3 "$OVERLAP" "$TMP/disjoint.json" >/dev/null 2>&1; then
  ok "disjoint fragment passes (exit 0)"
else
  bad "disjoint fragment wrongly flagged"
fi

# --- COLLISIONS fail loud -----------------------------------------------------
assert_collision() {
  local label="$1" file="$2" expect_key="$3"
  local out code
  set +e
  out="$(python3 "$OVERLAP" "$file" 2>&1)"; code=$?
  set -e
  if [ "$code" = "1" ] && printf '%s' "$out" | grep -q "$expect_key"; then
    ok "$label collides (exit 1, names '$expect_key')"
  else
    bad "$label not detected (code=$code): $out"
  fi
}

# exact scalar collision
echo '{ "verbose": true }' > "$TMP/scalar.json"
assert_collision "scalar (verbose)" "$TMP/scalar.json" "verbose"

# array collision (permissions.allow — the array agent-config's merge would replace)
echo '{ "permissions": { "allow": ["Read"] } }' > "$TMP/array.json"
assert_collision "array (permissions.allow)" "$TMP/array.json" "permissions.allow"

# parent/child collision: consumer sets statusLine.command, pi owns whole statusLine
echo '{ "statusLine": { "command": "/evil.sh" } }' > "$TMP/child.json"
assert_collision "parent/child (statusLine.command)" "$TMP/child.json" "statusLine"

# exact plugin-ref collision
python3 "$STATE" managed-keys | python3 -c "
import json,sys
d=json.load(sys.stdin)
ref=[k for k in d['settings']['map-entry'] if k.startswith('enabledPlugins.')][0].split('.',1)[1]
print(json.dumps({'enabledPlugins': {ref: True}}))
" > "$TMP/plugin.json"
assert_collision "exact plugin ref" "$TMP/plugin.json" "enabledPlugins"

# --- multi-fragment: one clean + one dirty -> overall fail --------------------
set +e
python3 "$OVERLAP" "$TMP/disjoint.json" "$TMP/scalar.json" >/dev/null 2>&1; multi=$?
set -e
[ "$multi" = "1" ] && ok "multi-fragment fails if ANY collides" || bad "multi-fragment did not fail on a dirty member"

# --- missing fragment is a usage error, not a false pass ----------------------
set +e
python3 "$OVERLAP" "$TMP/nope.json" >/dev/null 2>&1; miss=$?
set -e
[ "$miss" = "2" ] && ok "missing fragment -> usage exit 2" || bad "missing fragment did not exit 2 (got $miss)"

if [ "$fail" = "0" ]; then
  echo "smoke-meta-keyset-guard PASS"
else
  echo "smoke-meta-keyset-guard FAIL"
  exit 1
fi
