#!/usr/bin/env bash
# smoke-copilot-mcp-state — hermetic install/doctor/inverse contract for
# the Copilot MCP-config adapter. No Copilot process or model turn.
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUN="$REPO_DIR/run.sh"
pass=0
ok() { printf '  ok    %s\n' "$1"; pass=$((pass + 1)); }
die() { printf 'FAIL: %s\n' "$1" >&2; exit 1; }
want() { eval "$2" && ok "$1" || die "$1"; }

REPO_BEFORE="$(cd "$REPO_DIR" && git status --porcelain)"
SB="$(mktemp -d)"
trap 'rm -rf "$SB"' EXIT
export HOME="$SB/home"
export XDG_DATA_HOME="$SB/xdg"
export COPILOT_MCP_CONFIG="$HOME/.copilot/mcp-config.json"
export COPILOT_MCP_COMMAND="entwurf-bridge"
STATE="$XDG_DATA_HOME/entwurf/copilot-mcp/install-state.json"
mkdir -p "$(dirname "$COPILOT_MCP_CONFIG")" "$SB/bin"

write_mcp_fake() {
  cat > "$1" <<'FAKE'
#!/usr/bin/env bash
while IFS= read -r line; do
  case "$line" in
    *'"id":1'*) printf '%s\n' '{"jsonrpc":"2.0","id":1,"result":{"protocolVersion":"2024-11-05","capabilities":{},"serverInfo":{"name":"fake-entwurf-bridge","version":"0"}}}' ;;
    *'"id":2'*) printf '%s\n' '{"jsonrpc":"2.0","id":2,"result":{"tools":[{"name":"entwurf_v2"},{"name":"entwurf_self"},{"name":"entwurf_peers"},{"name":"entwurf_inbox_read"},{"name":"entwurf_register_native"},{"name":"entwurf_fresh_call"},{"name":"entwurf_resume_call"}]}}' ;;
  esac
done
FAKE
  chmod +x "$1"
}
write_dead_fake() {
  cat > "$1" <<'FAKE'
#!/usr/bin/env bash
echo "bash: /nonexistent/entwurf-bridge: No such file or directory" >&2
exit 127
FAKE
  chmod +x "$1"
}
write_mcp_fake "$SB/bin/$COPILOT_MCP_COMMAND"

_clean_path=""
while IFS= read -r dir; do
  [ -n "$dir" ] || continue
  [ -e "$dir/$COPILOT_MCP_COMMAND" ] || [ -L "$dir/$COPILOT_MCP_COMMAND" ] && continue
  _clean_path="${_clean_path:+$_clean_path:}$dir"
done < <(printf '%s\n' "$PATH" | tr ':' '\n')
export PATH="$SB/bin:$_clean_path"

write_config() {
  printf '{\n  "mcpServers": {\n    "other": { "type": "local", "command": "keep-me" },\n    "entwurf-bridge": { "type": "local", "command": "manual-bridge", "args": [] }\n  }\n}\n' > "$COPILOT_MCP_CONFIG"
}
json() { python3 - "$COPILOT_MCP_CONFIG" "$@" <<'PY'
import json, sys
data = json.load(open(sys.argv[1]))
mode = sys.argv[2]
servers = data["mcpServers"]
ours = {"type": "local", "command": "entwurf-bridge", "args": []}
if mode == "installed":
    assert servers["entwurf-bridge"] == ours
    assert servers["other"] == {"type": "local", "command": "keep-me"}
    assert set(data.keys()) == {"mcpServers"}
elif mode == "manual":
    assert servers["entwurf-bridge"] == {"type": "local", "command": "manual-bridge", "args": []}
    assert servers["other"] == {"type": "local", "command": "keep-me"}
elif mode == "created":
    assert data == {"mcpServers": {"entwurf-bridge": ours}}
else:
    raise AssertionError(mode)
PY
}

# Existing matching/manual config is adopted, not treated as a fresh file.
write_config
"$RUN" doctor-copilot-mcp >/dev/null
want "unowned manual config doctor is an honest note" "[ $? -eq 0 ]"
"$RUN" install-copilot-mcp >/dev/null
json installed
want "install adopts regular config and preserves unrelated servers" "[ $? -eq 0 ]"
want "install writes state" "[ -f '$STATE' ]"
"$RUN" doctor-copilot-mcp >/dev/null
want "owned configured doctor is green" "[ $? -eq 0 ]"
python3 - "$STATE" <<'PY'
import json, sys
state = json.load(open(sys.argv[1]))
assert state["preimage"] == {"type": "local", "command": "manual-bridge", "args": []}
assert state["serverKey"] == "entwurf-bridge"
PY
ok "first install captures manual entwurf-bridge preimage"
"$RUN" install-copilot-mcp >/dev/null
"$RUN" uninstall-copilot-mcp >/dev/null
json manual
want "reinstall keeps the first preimage for inverse" "[ $? -eq 0 ] && [ ! -f '$STATE' ]"

# The live-host shape is already our command with no state: adopt that exact preimage too.
write_config
python3 -c 'import json,sys; p=sys.argv[1]; d=json.load(open(p)); d["mcpServers"]["entwurf-bridge"]={"type":"local","command":"entwurf-bridge","args":[]}; json.dump(d,open(p,"w"))' "$COPILOT_MCP_CONFIG"
"$RUN" install-copilot-mcp >/dev/null
python3 - "$STATE" <<'PY'
import json, sys
state = json.load(open(sys.argv[1]))
assert state["preimage"] == {"type": "local", "command": "entwurf-bridge", "args": []}
PY
"$RUN" uninstall-copilot-mcp >/dev/null
json installed
want "matching manual Copilot MCP config is adopted and restored unchanged" "[ $? -eq 0 ] && [ ! -f '$STATE' ]"

# State turns a later config drift into a red doctor rather than a silent pass.
write_config
"$RUN" install-copilot-mcp >/dev/null
python3 -c 'import json,sys; p=sys.argv[1]; d=json.load(open(p)); d["mcpServers"]["entwurf-bridge"]={"type":"stdio","command":"entwurf-bridge","args":[]}; json.dump(d,open(p,"w"))' "$COPILOT_MCP_CONFIG"
if "$RUN" doctor-copilot-mcp >/dev/null 2>&1; then die "type=stdio doctor should fail"; fi
ok "state-present type=stdio entry is red"
"$RUN" install-copilot-mcp >/dev/null
python3 -c 'import json,sys; p=sys.argv[1]; d=json.load(open(p)); d["mcpServers"]["entwurf-bridge"]={"type":"local","command":"other","args":[]}; json.dump(d,open(p,"w"))' "$COPILOT_MCP_CONFIG"
if "$RUN" doctor-copilot-mcp >/dev/null 2>&1; then die "command drift doctor should fail"; fi
ok "state-present command drift is red"
"$RUN" install-copilot-mcp >/dev/null

# A stable-bin command that boots then dies is red without touching config.
write_dead_fake "$SB/bin/$COPILOT_MCP_COMMAND"
if "$RUN" doctor-copilot-mcp >/dev/null 2>&1; then die "dead command doctor should fail"; fi
ok "state-present command that does not serve MCP is red"
write_mcp_fake "$SB/bin/$COPILOT_MCP_COMMAND"
"$RUN" uninstall-copilot-mcp >/dev/null
json manual
want "inverse restores manual config after drift repairs" "[ $? -eq 0 ] && [ ! -f '$STATE' ]"

# Created-new is removed only when it still contains only the adapter's key.
rm -f "$COPILOT_MCP_CONFIG"
"$RUN" install-copilot-mcp >/dev/null
json created
"$RUN" uninstall-copilot-mcp >/dev/null
want "created-new empty mcp-config is removed by inverse" "[ ! -e '$COPILOT_MCP_CONFIG' ] && [ ! -f '$STATE' ]"

# A foreign/corrupt config file is never adopted or given a state record.
printf '{"mcpServers":{}}\n' > "$SB/foreign.json"
ln -s "$SB/foreign.json" "$COPILOT_MCP_CONFIG"
if "$RUN" install-copilot-mcp >/dev/null 2>&1; then die "symlink install should refuse"; fi
ok "symlink config is refused"
want "symlink refusal leaves foreign config and no state" "! grep -q entwurf-bridge '$SB/foreign.json' && [ ! -f '$STATE' ]"
rm -f "$COPILOT_MCP_CONFIG"
printf 'not-json{{' > "$COPILOT_MCP_CONFIG"
if "$RUN" install-copilot-mcp >/dev/null 2>&1; then die "corrupt install should fail"; fi
ok "corrupt config fails loud"
want "corrupt refusal writes no state" "[ ! -f '$STATE' ]"

REPO_AFTER="$(cd "$REPO_DIR" && git status --porcelain)"
[ "$REPO_BEFORE" = "$REPO_AFTER" ] || die "smoke changed the checkout"
printf '\nsmoke-copilot-mcp-state: %d checks passed\n' "$pass"
