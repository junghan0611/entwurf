#!/usr/bin/env bash
# smoke-omp-mcp-state — hermetic install/doctor/inverse contract for the OMP-native MCP
# adapter (#87 step 5). No omp process, no model turn, no writes outside the sandbox.
#
# The cell this file exists for, above the usual four install properties, is SHADOWING:
# the entry is only worth writing if it suppresses the Claude import, and it only does
# that while its key is byte-identical to the import's. So the key is asserted as a
# literal here, and the denylist that would kill both entries is asserted to be refused.
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
# HARD RULE 12, in full — see the same block in smoke-omp-bridge-state.sh. PI is poisoned
# on purpose and asserted empty at the end: after #87 B1 no OMP surface derives a garden
# root from it. The MCP TARGET is no longer configurable (#87 D1), so the only sandbox seam
# left is the vendor agent dir — which is the correct one, since the target is
# `<agent dir>/mcp.json` by construction.
export HOME="$SB/home"
export XDG_DATA_HOME="$SB/xdg"
export XDG_CONFIG_HOME="$SB/xdg-config"
export XDG_STATE_HOME="$SB/xdg-state"
export XDG_CACHE_HOME="$SB/xdg-cache"
export XDG_RUNTIME_DIR="$SB/xdg-runtime"
PI_POISON="$SB/pi-poison-agent"
export PI_CODING_AGENT_DIR="$PI_POISON"
export ENTWURF_OMP_AGENT_DIR="$SB/home/.omp/agent"
export ENTWURF_OMP_MCP_COMMAND="entwurf-bridge"
export ENTWURF_OMP_MCP_ARGS='[]'
CONFIG="$ENTWURF_OMP_AGENT_DIR/mcp.json"
STATE="$XDG_DATA_HOME/entwurf/omp-mcp/install-state.json"
mkdir -p "$ENTWURF_OMP_AGENT_DIR" "$SB/bin" "$XDG_CONFIG_HOME" "$XDG_STATE_HOME" "$XDG_CACHE_HOME" "$XDG_RUNTIME_DIR"
# Sandbox-only operator setting. The MCP-install cells expect doctor green; the
# default (file/key absent → tools.xdev true) is a RUNTIME red once the native
# hand is configured, and is exercised as its own cell below. Never the host's
# real ~/.omp/agent/config.yml — HOME and ENTWURF_OMP_AGENT_DIR are sandboxed.
cat > "$ENTWURF_OMP_AGENT_DIR/config.yml" <<'CFG'
tools:
  xdev: false
CFG

# A fake bridge that answers initialize + tools/list, so the doctor's boot probe has a
# real command to drive without spawning the actual bridge.
cat > "$SB/bin/entwurf-bridge" <<'FAKE'
#!/usr/bin/env bash
while IFS= read -r line; do
  case "$line" in
    *'"id":1'*) printf '%s\n' '{"jsonrpc":"2.0","id":1,"result":{"protocolVersion":"2024-11-05","capabilities":{},"serverInfo":{"name":"fake-entwurf-bridge","version":"0"}}}' ;;
    *'"id":2'*) printf '%s\n' '{"jsonrpc":"2.0","id":2,"result":{"tools":[{"name":"entwurf_v2"},{"name":"entwurf_self"},{"name":"entwurf_peers"},{"name":"entwurf_inbox_read"},{"name":"entwurf_register_native"},{"name":"entwurf_fresh_call"},{"name":"entwurf_resume_call"}]}}' ;;
  esac
done
FAKE
chmod +x "$SB/bin/entwurf-bridge"
_clean_path=""
while IFS= read -r dir; do
	[ -n "$dir" ] || continue
	{ [ -e "$dir/entwurf-bridge" ] || [ -L "$dir/entwurf-bridge" ]; } && continue
	_clean_path="${_clean_path:+$_clean_path:}$dir"
done < <(printf '%s\n' "$PATH" | tr ':' '\n')
export PATH="$SB/bin:$_clean_path"

json() { python3 - "$CONFIG" "$@" <<'PY'
import json, sys
data = json.load(open(sys.argv[1]))
mode = sys.argv[2]
servers = data.get("mcpServers", {})
if mode == "keys":
    print(" ".join(sorted(servers)))
elif mode == "entry":
    print(json.dumps(servers.get("entwurf-bridge"), sort_keys=True))
elif mode == "top":
    print(" ".join(sorted(data)))
PY
}

# ── 1. create-new install ───────────────────────────────────────────────────
"$RUN" install-omp-mcp >/dev/null || die "install-omp-mcp failed on a clean host"
want "the omp-native user MCP file was created where the vendor reads it" "[ -f '$CONFIG' ]"
want "it carries the PINNED literal server key (byte-identical to the Claude import's)" "[ \"\$(json keys)\" = 'entwurf-bridge' ]"
want "the entry carries the omp provenance label, not Claude's" "json entry | grep -q 'external-mcp/omp'"
want "it does NOT carry Claude Code's label" "! json entry | grep -q 'external-mcp/claude-code'"
want "the file names omp's own schema so the operator's editor can validate it" "json top | grep -q '\\\$schema'"
want "no disabledServers denylist was written — that would kill the import AND this entry" "! grep -q disabledServers '$CONFIG'"
# CAPTURE, then match — never `cmd | grep -q`. grep exits at the first match and closes the
# pipe, the still-writing doctor dies of SIGPIPE, and `pipefail` reports that as a failed
# check: a FALSE red on a correctly configured host (the same race meta-bridge-install.sh
# documents at its `claude mcp get` probe).
OUT="$("$RUN" doctor-omp-mcp 2>&1)" || die "doctor red right after a clean install"
ok "doctor is green right after install"
printf '%s\n' "$OUT" | grep -q "native-wins" || die "doctor did not report the native entry as the effective source"
ok "doctor reports the EFFECTIVE source as the native entry"
printf '%s\n' "$OUT" | grep -q "tools.xdev is false" || die "doctor did not report tools.xdev false on the runtime axis"
ok "xdev false is ok on the runtime axis (MCP tools stay top-level)"

# ── 2. shadowing: a Claude import of the same name is suppressed, not removed ───
mkdir -p "$HOME"
cat > "$HOME/.claude.json" <<'IMPORT'
{ "mcpServers": { "entwurf-bridge": { "command": "bash", "args": ["/somewhere/start.sh"], "env": { "ENTWURF_BRIDGE_EXTERNAL_AGENT_ID": "external-mcp/claude-code" } } } }
IMPORT
OUT="$("$RUN" doctor-omp-mcp 2>&1)" || die "doctor red with a Claude import present"
printf '%s\n' "$OUT" | grep -q "key-present" || die "doctor did not see the Claude import's key"
printf '%s\n' "$OUT" | grep -q "native-wins" || die "doctor did not report native precedence over the import"
ok "with BOTH sources present the doctor reports native-wins — the import is shadowed by the shared key"
want "the Claude config was never touched (the vendor never writes another tool's config, and neither do we)" "grep -q 'external-mcp/claude-code' '$HOME/.claude.json'"

# ── 3. a denylist on our key is refused, and named for what it does ─────────
python3 - "$CONFIG" <<'PY'
import json, sys
data = json.load(open(sys.argv[1]))
data["disabledServers"] = ["entwurf-bridge"]
json.dump(data, open(sys.argv[1], "w"), indent=2)
PY
if OUT="$("$RUN" doctor-omp-mcp 2>&1)"; then
	die "doctor stayed green with entwurf-bridge denylisted"
fi
printf '%s\n' "$OUT" | grep -q "kills the native entry AND the Claude import" || die "doctor went red without naming what the denylist actually does"
ok "a disabledServers denylist on our key is RED, and the doctor names that it kills both entries"
if OUT="$("$RUN" install-omp-mcp 2>&1)"; then
	die "install wrote an entry into a config that denylists it"
fi
printf '%s\n' "$OUT" | grep -q "never the way to hide an import" || die "install refused without naming the reason"
ok "install REFUSES rather than writing a server the denylist would suppress"
python3 - "$CONFIG" <<'PY'
import json, sys
data = json.load(open(sys.argv[1]))
data.pop("disabledServers")
json.dump(data, open(sys.argv[1], "w"), indent=2)
PY

# ── 4. foreign provenance is red even with no ownership state ───────────────
cp "$STATE" "$SB/state.bak"
rm -f "$STATE"
python3 - "$CONFIG" <<'PY'
import json, sys
data = json.load(open(sys.argv[1]))
data["mcpServers"]["entwurf-bridge"]["env"]["ENTWURF_BRIDGE_EXTERNAL_AGENT_ID"] = "external-mcp/claude-code"
json.dump(data, open(sys.argv[1], "w"), indent=2)
PY
if "$RUN" doctor-omp-mcp >/dev/null 2>&1; then
	die "doctor stayed green with a native entry carrying another harness's provenance"
fi
ok "an entry under our key that speaks as another harness is RED even with no install-state"
cp "$SB/state.bak" "$STATE"
"$RUN" install-omp-mcp >/dev/null || die "reinstall over the drifted entry failed"
"$RUN" doctor-omp-mcp >/dev/null || die "reinstall did not repair the provenance"
ok "reinstall repairs it"

# ── 5. the inverse ─────────────────────────────────────────────────────────
"$RUN" uninstall-omp-mcp >/dev/null || die "uninstall failed"
want "a file we CREATED is removed entirely, not left as an empty stub" "[ ! -e '$CONFIG' ]"
want "the ownership state is gone" "[ ! -e '$STATE' ]"
OUT="$("$RUN" doctor-omp-mcp 2>&1)" || die "doctor red on a clean uninstalled host"
printf '%s\n' "$OUT" | grep -q "CLAUDE IMPORT is currently the only source" || die "doctor did not name the import as the effective source after the inverse"
ok "after the inverse the Claude import is named as the effective source again — the honest state, not silence"

# ── 6. adopt an EXISTING operator file, and hand it back untouched ──────────
cat > "$CONFIG" <<'PRE'
{
  "mcpServers": {
    "someone-elses": { "command": "keep-me", "args": [] },
    "entwurf-bridge": { "command": "operator-wired", "args": ["--by-hand"] }
  }
}
PRE
"$RUN" install-omp-mcp >/dev/null || die "install failed to adopt an existing regular file"
want "our entry replaced the operator's under the same key" "json entry | grep -q 'external-mcp/omp'"
want "the operator's OTHER server is untouched" "json keys | grep -q 'someone-elses'"
want "the preimage was recorded even though a value already existed there" "grep -q 'operator-wired' '$STATE'"
"$RUN" uninstall-omp-mcp >/dev/null || die "uninstall failed on an adopted file"
want "the inverse restored the operator's ORIGINAL entry byte-for-byte" "json entry | grep -q 'operator-wired'"
want "and left their other server alone" "json keys | grep -q 'someone-elses'"
want "the adopted file itself survives — we never created it" "[ -f '$CONFIG' ]"
ok "adopt/restore is an honest inverse on a pre-existing operator file"

# ── 7. a symlinked config is refused, never written through ────────────────
rm -f "$CONFIG"
echo '{ "mcpServers": {} }' > "$SB/elsewhere.json"
ln -s "$SB/elsewhere.json" "$CONFIG"
if "$RUN" install-omp-mcp >/dev/null 2>&1; then
	die "install wrote through a symlinked config"
fi
want "the symlink target is unchanged" "! grep -q entwurf-bridge '$SB/elsewhere.json'"
ok "a SYMLINKED config is refused (someone else's SSOT)"
rm -f "$CONFIG"

# ── 8. an ambiguous agent dir refuses instead of guessing (ledger M6) ──────
if env -u ENTWURF_OMP_AGENT_DIR PI_CODING_AGENT_DIR="$SB/ambiguous" "$RUN" install-omp-mcp >/dev/null 2>&1; then
	die "install guessed an agent dir while PI_CODING_AGENT_DIR was set"
fi
ok "an inherited PI_CODING_AGENT_DIR REFUSES rather than writing a config omp may never read"

# ── 8b. the target is CONFINED to the resolved agent dir (#87 D1) ──────────
# There is no path override any more. The writer's target is `<agent dir>/mcp.json` and
# nothing else, so an operator file elsewhere cannot be aimed at: the retired
# `ENTWURF_OMP_MCP_CONFIG` accepted an arbitrary path with no descendant check, which made
# the "omp-only" writer able to rewrite ~/.claude.json or ~/.pi/... An explicit env seam
# lowers the odds of an accident; it grants no ownership.
env ENTWURF_OMP_MCP_CONFIG="$SB/hijack.json" "$RUN" install-omp-mcp >/dev/null 2>&1 || true
want "the retired override wrote NOTHING at its arbitrary path" "[ ! -e '$SB/hijack.json' ]"
want "the entry went to the agent-dir target instead" "[ -f '$CONFIG' ]"
ok "the target follows the resolved agent dir; no env seam can aim the writer elsewhere"
"$RUN" uninstall-omp-mcp >/dev/null || die "uninstall failed after the confinement cell"

# ── 8c. one state owns ONE target: a retarget REFUSES (#87 D1) ────────────
# Changing OMP_PROFILE / the agent dir used to capture a new preimage and overwrite the one
# state file, stranding the first profile's managed entry with no inverse.
"$RUN" install-omp-mcp >/dev/null || die "install failed before the retarget cell"
STATE_BEFORE="$(cat "$STATE")"
mkdir -p "$SB/home/.omp/profiles/other/agent"
if env ENTWURF_OMP_AGENT_DIR="$SB/home/.omp/profiles/other/agent" "$RUN" install-omp-mcp >/dev/null 2>&1; then
	die "install retargeted to a second config while state named the first"
fi
want "the first target's state is byte-identical after the refusal" "[ \"\$(cat '$STATE')\" = \"\$STATE_BEFORE\" ]"
want "no config was written at the second target" "[ ! -e '$SB/home/.omp/profiles/other/agent/mcp.json' ]"
ok "a retarget REFUSES instead of orphaning the first managed entry"
"$RUN" uninstall-omp-mcp >/dev/null || die "uninstall failed after the retarget cell"

# ── 8d. an INVALID entry is runtime-red with NO ownership state (#87 B4) ───
# Runtime truth and ownership truth are separate axes (Hard Rule 13). A malformed value
# under our key still claims the dedupe slot — so the Claude import is suppressed AND
# nothing loads — and the doctor used to print `native-wins` + exit 0 for exactly that,
# because redness had been coupled to the presence of install-state.
python3 - "$CONFIG" <<'PY2'
import json, sys
json.dump({"mcpServers": {"entwurf-bridge": None}}, open(sys.argv[1], "w"), indent=2)
PY2
if OUT="$("$RUN" doctor-omp-mcp 2>&1)"; then
	die "doctor exited 0 for a malformed native entry with no ownership state"
fi
printf '%s\n' "$OUT" | grep -q "native-invalid" || die "doctor did not name the entry as native-invalid"
if printf '%s\n' "$OUT" | grep -q "native-wins"; then
	die "doctor still called a malformed entry native-wins"
fi
ok "a malformed entry under our key is RED on the runtime axis with zero install-state, and is never native-wins"
rm -f "$CONFIG"

# ── 8e. tools.xdev tool-surface — RUNTIME axis, never ownership (Hard Rule 13)
# The native hand is re-installed so redness is about the tool surface, not a
# missing mcp.json. Every write is inside the sandbox agent dir.
"$RUN" install-omp-mcp >/dev/null || die "reinstall failed before the tool-surface cells"
cat > "$ENTWURF_OMP_AGENT_DIR/config.yml" <<'CFG'
tools:
  xdev: false
CFG
OUT="$("$RUN" doctor-omp-mcp 2>&1)" || die "doctor red with tools.xdev false"
printf '%s\n' "$OUT" | grep -q "tools.xdev is false" || die "doctor did not name tools.xdev false"
ok "xdev false is ok (required operator setting)"

cat > "$ENTWURF_OMP_AGENT_DIR/config.yml" <<'CFG'
tools:
  xdev: true
  xdevInlineDevices:
    - mcp__entwurf_bridge_*
CFG
OUT="$("$RUN" doctor-omp-mcp 2>&1)" || die "doctor red with a covering xdevInlineDevices glob"
printf '%s\n' "$OUT" | grep -q "xdevInlineDevices glob covering mcp__entwurf_bridge_" || die "doctor did not note the covering glob"
if printf '%s\n' "$OUT" | grep -q "doctor found a broken OMP MCP configuration"; then
	die "covering glob should be ok-with-note, not red"
fi
ok "xdev on with a covering glob is ok-with-note"

cat > "$ENTWURF_OMP_AGENT_DIR/config.yml" <<'CFG'
tools:
  xdev: true
CFG
if OUT="$("$RUN" doctor-omp-mcp 2>&1)"; then
	die "doctor stayed green with tools.xdev true and no covering glob"
fi
printf '%s\n' "$OUT" | grep -q "no xdevInlineDevices glob covering" || die "doctor went red without naming the uncovered xdev surface"
printf '%s\n' "$OUT" | grep -q "runtime axis" || die "uncovered xdev was not reported on the runtime axis"
ok "xdev on with no covering glob is RED on the runtime axis"

cat > "$ENTWURF_OMP_AGENT_DIR/config.yml" <<'CFG'
tools:
  xdev: true
  xdevInlineDevices:
    - mcp__context_mode_*
CFG
if OUT="$("$RUN" doctor-omp-mcp 2>&1)"; then
	die "doctor stayed green with a glob that does not cover our server"
fi
printf '%s\n' "$OUT" | grep -q "no xdevInlineDevices glob covering" || die "a non-covering glob was not treated as uncovered"
ok "a glob that does not cover mcp__entwurf_bridge_* is RED"

cat > "$ENTWURF_OMP_AGENT_DIR/config.yml" <<'CFG'
modelRoles:
  default: sandbox-only
CFG
if OUT="$("$RUN" doctor-omp-mcp 2>&1)"; then
	die "doctor stayed green when tools.xdev was unset"
fi
printf '%s\n' "$OUT" | grep -q "tools.xdev is UNSET" || die "doctor did not name the absent key"
printf '%s\n' "$OUT" | grep -q "vendor default applies" || die "absent key was not reported as the vendor default"
ok "absent key applies the vendor default and is RED; the file is named, not invented"

rm -f "$ENTWURF_OMP_AGENT_DIR/config.yml"
if OUT="$("$RUN" doctor-omp-mcp 2>&1)"; then
	die "doctor stayed green when config.yml was absent (vendor default)"
fi
printf '%s\n' "$OUT" | grep -q "FILE ABSENT" || die "doctor did not say the file is absent"
printf '%s\n' "$OUT" | grep -q "vendor default applies" || die "absent file was not reported as the vendor default"
want "doctor did not write config.yml while reporting the absent default" "[ ! -e '$ENTWURF_OMP_AGENT_DIR/config.yml' ]"
ok "absent file applies the vendor default and is RED; doctor writes nothing"

# restore the required setting so later cells (none) and uninstall stay honest
cat > "$ENTWURF_OMP_AGENT_DIR/config.yml" <<'CFG'
tools:
  xdev: false
CFG
"$RUN" uninstall-omp-mcp >/dev/null || die "uninstall failed after the tool-surface cells"

# ── 9. nothing resolved through the double-duty PI knob ───────────────────
want "the poisoned PI_CODING_AGENT_DIR tree was never created" "[ ! -e '$PI_POISON' ]"

# ── 10. the repo itself was never written ─────────────────────────────────
REPO_AFTER="$(cd "$REPO_DIR" && git status --porcelain)"
[ "$REPO_BEFORE" = "$REPO_AFTER" ] || die "the smoke mutated the repo working tree"
ok "the checkout is byte-identical to before the smoke"

printf '[smoke-omp-mcp-state] %d assertions ok\n' "$pass"
