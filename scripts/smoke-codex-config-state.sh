#!/usr/bin/env bash
# smoke-codex-config-state — hermetic install/doctor/inverse contract for the
# two Codex config atoms (codex-mcp-config.py + codex-statusline-config.py).
# No Codex process, no model turn: the vendor's config.toml surface only.
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MCP="$REPO_DIR/scripts/codex-mcp-config.py"
SL="$REPO_DIR/scripts/codex-statusline-config.py"
pass=0
ok() { printf '  ok    %s\n' "$1"; pass=$((pass + 1)); }
die() { printf 'FAIL: %s\n' "$1" >&2; exit 1; }
want() { eval "$2" && ok "$1" || die "$1"; }
refuses() { # <label> <expected-substring-on-stderr> <cmd...>
  local label="$1" needle="$2"; shift 2
  local err rc=0
  err="$("$@" 2>&1 >/dev/null)" || rc=$?
  [ "$rc" -ne 0 ] && printf '%s' "$err" | grep -q "$needle" || die "$label (rc=$rc, stderr: $err)"
  ok "$label"
}

REPO_BEFORE="$(cd "$REPO_DIR" && git status --porcelain)"
SB="$(mktemp -d)"
trap 'rm -rf "$SB"' EXIT
export HOME="$SB/home"
export XDG_DATA_HOME="$SB/xdg"
export CODEX_HOME="$HOME/.codex"          # the only surface both atoms touch
export ENTWURF_TEST_IGNORED="$SB"         # prove nothing else leaks in
export ENTWURF_DIR="$SB/custom-entwurf"
export PI_CODING_AGENT_DIR="$SB/custom-pi"
export ENTWURF_META_SESSIONS_DIR="$SB/custom-meta/sessions"
export ENTWURF_META_MAILBOX_DIR="$SB/custom-meta/mailbox"
export ENTWURF_META_SENDERS_DIR="$SB/custom-meta/senders"
export ENTWURF_META_RECEIVERS_DIR="$SB/custom-meta/receivers"
export TMUX="$SB/custom-tmux/default,123,0"
export TMUX_PANE="%77"
export PYTHONDONTWRITEBYTECODE=1        # imported parser helpers must not write into the checkout
mkdir -p "$CODEX_HOME" "$(dirname "$XDG_DATA_HOME")"
CFG="$CODEX_HOME/config.toml"
MCP_STATE="$XDG_DATA_HOME/entwurf/codex-mcp/install-state.json"
SL_STATE="$XDG_DATA_HOME/entwurf/codex-statusline/install-state.json"

seed_config() { # the operator's hand-edited file: quoted header keys, nested
  # tables, an unrelated MCP server, and NO entwurf atom content.
  cat > "$CFG" <<'EOF'
model = "gpt-5.6-sol"
approval_policy = "never"
[notice]
hide_full_access_warning = true
[projects."/home/op/work"]
trust_level = "trusted"
[hooks.state."~/c.toml:session_start:0:0"]
trusted_hash = "sha256:abc"
[tui]
status_line = ["model-with-reasoning", "current-dir"]
theme = "zenburn"
[tui.model_availability_nux]
"gpt-5.5" = 4
[mcp_servers.other]
command = "keep-me"
[plugins."github@openai-curated"]
enabled = false
EOF
}
operator_bridge() { # a manual entwurf-bridge entry the operator owns already
  cat >> "$CFG" <<'EOF'
[mcp_servers.entwurf-bridge]
command = "/opt/agent-config/bridge-start.sh"
startup_timeout_sec = 30
[mcp_servers.entwurf-bridge.env]
EXTRA = "operator"
EOF
}
json_field() { python3 -c 'import json,sys; d=json.load(open(sys.argv[1])); print(d[sys.argv[2]])' "$1" "$2"; }
toml_ok() { python3 -c 'import tomllib,sys; tomllib.load(open(sys.argv[1],"rb"))' "$1"; }
context_values_absent() {
  python3 -c 'import os,sys; t=open(sys.argv[1]).read(); names=("CODEX_HOME","ENTWURF_DIR","PI_CODING_AGENT_DIR","ENTWURF_META_SESSIONS_DIR","ENTWURF_META_MAILBOX_DIR","ENTWURF_META_SENDERS_DIR","ENTWURF_META_RECEIVERS_DIR","TMUX","TMUX_PANE"); assert all(os.environ[n] not in t for n in names)' "$1"
}

###############################################################################
# Atom 1 — [mcp_servers.entwurf-bridge]
###############################################################################

# unowned manual config is an honest note, not a failure (this host's shape)
seed_config
operator_bridge
python3 "$MCP" doctor-static "$CFG" entwurf-bridge "$MCP_STATE" >"$SB/out" 2>&1
want "unowned manual entry doctor is an honest note" "grep -q '^configured /opt/agent-config/bridge-start.sh unowned$' '$SB/out'"

# adoption captures the operator's exact bytes as the FIRST preimage, once
cp "$CFG" "$SB/with-bridge.toml"
python3 "$MCP" install "$CFG" entwurf-bridge "$MCP_STATE" >"$SB/out"
want "install adopts the regular file" "grep -q '^adopt-regular-file ' '$SB/out'"
toml_ok "$CFG"; ok "installed config still parses as TOML"
want "first preimage captured" "[ \"\$(json_field '$MCP_STATE' entryExistedBefore)\" = True ] && json_field '$MCP_STATE' preimage | grep -q 'bridge-start.sh'"
want "our stdio shape is live" "grep -q '^command = \"entwurf-bridge\"$' '$CFG' && grep -q '^ENTWURF_BRIDGE_NATIVE_HOST = \"codex\"$' '$CFG'"
want "vendor env_vars forwards the exact operator context names in order" \
  "grep -Fxq 'env_vars = [\"CODEX_HOME\", \"ENTWURF_DIR\", \"PI_CODING_AGENT_DIR\", \"ENTWURF_META_SESSIONS_DIR\", \"ENTWURF_META_MAILBOX_DIR\", \"ENTWURF_META_SENDERS_DIR\", \"ENTWURF_META_RECEIVERS_DIR\", \"TMUX\", \"TMUX_PANE\"]' '$CFG'"
want "no install-time context value is baked into config" "context_values_absent '$CFG'"
python3 "$MCP" doctor-static "$CFG" entwurf-bridge "$MCP_STATE" >"$SB/out"
want "owned+configured doctor is green" "grep -q '^configured entwurf-bridge owned$' '$SB/out'"
python3 "$MCP" doctor-invocation "$CFG" >"$SB/out"
want "doctor-invocation emits only the literal boot-probe environment" "grep -x '{\"command\":\"entwurf-bridge\",\"args\":\[\],\"env\":{\"ENTWURF_BRIDGE_NATIVE_HOST\":\"codex\"}}' '$SB/out'"

# idempotence is an untouched file, and the FIRST preimage survives re-runs
MT1="$(stat -c %Y "$CFG")"; sleep 1.1
python3 "$MCP" install "$CFG" entwurf-bridge "$MCP_STATE" >/dev/null
MT2="$(stat -c %Y "$CFG")"
want "reinstall does not rewrite the config" "[ '$MT1' = '$MT2' ]"
python3 "$MCP" install "$CFG" a-different-command "$MCP_STATE" >/dev/null
want "reinstall with a new command keeps the FIRST preimage" "json_field '$MCP_STATE' preimage | grep -q 'bridge-start.sh'"
python3 "$MCP" install "$CFG" entwurf-bridge "$MCP_STATE" >/dev/null

# drift the operator introduces turns the doctor red by name, not green
sed -i 's/^command = "entwurf-bridge"$/command = "evil-bridge"/' "$CFG"
python3 "$MCP" doctor-static "$CFG" entwurf-bridge "$MCP_STATE" >"$SB/out" 2>&1 && die "command drift doctor should be red"
want "command drift is red" "grep -q '^configured evil-bridge drift command-mismatch' '$SB/out'"
sed -i 's/^command = "evil-bridge"$/command = "entwurf-bridge"/' "$CFG"
sed -i '/^ENTWURF_BRIDGE_NATIVE_HOST = /d' "$CFG"
python3 "$MCP" doctor-static "$CFG" entwurf-bridge "$MCP_STATE" >"$SB/out" 2>&1 && die "env-label drift doctor should be red"
want "removed provenance label is red" "grep -q 'drift env-label-missing' '$SB/out'"
sed -i 's/^\[mcp_servers.entwurf-bridge.env\]$/[mcp_servers.entwurf-bridge.env]\nENTWURF_BRIDGE_NATIVE_HOST = "not-codex"/' "$CFG"
python3 "$MCP" doctor-static "$CFG" entwurf-bridge "$MCP_STATE" >"$SB/out" 2>&1 && die "foreign label value doctor should be red"
want "foreign provenance value is red" "grep -q 'drift env-label-foreign' '$SB/out'"
python3 "$MCP" install "$CFG" entwurf-bridge "$MCP_STATE" >/dev/null

sed -i 's/, "ENTWURF_DIR"//' "$CFG"
python3 "$MCP" doctor-static "$CFG" entwurf-bridge "$MCP_STATE" >"$SB/out" 2>&1 && die "missing context env_vars name doctor should be red"
want "missing context env_vars name is red by name" "grep -q 'drift context-env-vars-missing (ENTWURF_DIR)' '$SB/out'"
python3 "$MCP" install "$CFG" entwurf-bridge "$MCP_STATE" >/dev/null
sed -i 's/"TMUX_PANE"]/"TMUX_PANE", "FOREIGN_CONTEXT"]/' "$CFG"
python3 "$MCP" doctor-static "$CFG" entwurf-bridge "$MCP_STATE" >"$SB/out" 2>&1 && die "foreign context env_vars name doctor should be red"
want "foreign context env_vars name is red by name" "grep -q 'drift context-env-vars-foreign (FOREIGN_CONTEXT)' '$SB/out'"
python3 "$MCP" install "$CFG" entwurf-bridge "$MCP_STATE" >/dev/null
sed -i 's/"CODEX_HOME", "ENTWURF_DIR"/"ENTWURF_DIR", "CODEX_HOME"/' "$CFG"
python3 "$MCP" doctor-static "$CFG" entwurf-bridge "$MCP_STATE" >"$SB/out" 2>&1 && die "reordered context env_vars doctor should be red"
want "reordered context env_vars is red" "grep -q 'drift context-env-vars-reordered-or-duplicated' '$SB/out'"
cp "$CFG" "$SB/drifted-mcp.toml"
python3 "$MCP" uninstall "$MCP_STATE" >"$SB/out" 2>&1 &&
  die "[QK:CODEX-MCP-UNINSTALL-REFUSES-DRIFT] uninstall accepted a drifted owned MCP table"
want "uninstall refusal names exact post-install table drift" "grep -q 'drifted from the exact post-install table' '$SB/out'"
cmp -s "$SB/drifted-mcp.toml" "$CFG" && ok "drifted MCP table is byte-identical after refused inverse" || die "drifted MCP table changed"

# the inverse restores the operator's exact bytes after drift repairs
python3 "$MCP" install "$CFG" entwurf-bridge "$MCP_STATE" >/dev/null
python3 "$MCP" uninstall "$MCP_STATE" >"$SB/out"
want "uninstall reports the managed path" "grep -q '^uninstalled ' '$SB/out'"
cmp -s "$SB/with-bridge.toml" "$CFG" && ok "inverse restores the operator entry byte-exact" || die "inverse byte mismatch"
want "state is gone" "[ ! -e '$MCP_STATE' ]"
python3 "$MCP" doctor-static "$CFG" entwurf-bridge "$MCP_STATE" >"$SB/out"
want "post-uninstall doctor is an unowned note again" "grep -q 'unowned' '$SB/out'"

# A NEIGHBOUR APPENDED AFTER OUR BLOCK — the shape this host actually grew into.
# Our managed table is written at the end of the file, so for a long time nothing
# ever followed it and no gate could see where the family stopped. Then the Codex
# vendor appended its own `[hooks.state]` (the operator's hook-trust decision) right
# after ours, separated by one blank line, and a plain idempotent reinstall deleted
# that blank line: semantically nothing, but a byte outside our atom, and the one
# thing this writer promises never to touch. The separator belongs to the boundary,
# not to the family.
seed_config
cp "$CFG" "$SB/neighbour-seed.toml"          # the operator bytes the inverse owes back
cat > "$SB/neighbour-block.toml" <<'EOF'

[hooks.state]

[hooks.state."/sandbox/.codex/hooks.json:session_start:0:0"]
trusted_hash = "sha256:4647c53b6948cd38f2283a3fdf63e40e83b7ff29ecf14650b7e61eec9315e1cc"
EOF
python3 "$MCP" install "$CFG" entwurf-bridge "$MCP_STATE" >/dev/null
cat "$SB/neighbour-block.toml" >> "$CFG"
cp "$CFG" "$SB/neighbour-expected.toml"
# What the inverse owes: the operator's seed bytes, then the neighbour EXACTLY as it was
# appended — its leading blank separator included. Built by concatenation, never by
# describing the result, so the assertion cannot be satisfied by a file that merely ends
# the right way.
cat "$SB/neighbour-seed.toml" "$SB/neighbour-block.toml" > "$SB/neighbour-after-inverse-expected.toml"
toml_ok "$CFG"; ok "our block plus an appended vendor neighbour parses"
python3 "$MCP" install "$CFG" entwurf-bridge "$MCP_STATE" >/dev/null
cmp -s "$SB/neighbour-expected.toml" "$CFG" \
  || die "[QK:CODEX-TOML-FAMILY-EXCLUDES-SEPARATOR] reinstall changed bytes outside the managed table: $(diff -u "$SB/neighbour-expected.toml" "$CFG" | sed -n '3,12p')"
ok "reinstall beside a vendor neighbour is byte-exact, separator included"
want "the vendor's trust record survives verbatim" "grep -Fxq 'trusted_hash = \"sha256:4647c53b6948cd38f2283a3fdf63e40e83b7ff29ecf14650b7e61eec9315e1cc\"' '$CFG'"
# ...and the inverse gives back exactly what it found: the operator's seed bytes plus the
# neighbour verbatim. Asserted with `cmp` against bytes built by concatenation — an
# "ends with the neighbour" shape test would pass on a file whose separator was eaten,
# which is the very byte this cell exists to protect.
python3 "$MCP" uninstall "$MCP_STATE" >/dev/null
cmp -s "$SB/neighbour-after-inverse-expected.toml" "$CFG" \
  || die "the inverse did not restore seed+neighbour byte-exact: $(diff -u "$SB/neighbour-after-inverse-expected.toml" "$CFG" | sed -n '3,12p')"
ok "the inverse restores the operator seed plus the neighbour byte-exact, separator included"
toml_ok "$CFG"; ok "config after the neighbour-aware inverse still parses"
rm -f "$MCP_STATE"

# created-new: the file we made is removed by the inverse
rm -f "$CFG"
python3 "$MCP" install "$CFG" entwurf-bridge "$MCP_STATE" >/dev/null
toml_ok "$CFG"; ok "created-new config parses"
python3 "$MCP" uninstall "$MCP_STATE" >/dev/null
want "created-new file removed by inverse" "[ ! -e '$CFG' ] && [ ! -e '$MCP_STATE' ]"

# refusals — symlink, malformed, foreign state, retargeted state, contrary values
seed_config
printf '[mcp_servers.other]\ncommand = "foreign"\n' > "$SB/foreign.toml"
ln -sf "$SB/foreign.toml" "$CFG"
refuses "symlink config is refused" "symlink" python3 "$MCP" install "$CFG" entwurf-bridge "$MCP_STATE"
want "symlink refusal leaves the foreign file and no state" "grep -q foreign '$SB/foreign.toml' && [ ! -e '$MCP_STATE' ]"
rm -f "$CFG"
printf 'not = toml {{{\n[mcp_servers\n' > "$CFG"
refuses "malformed TOML is refused" "not valid TOML" python3 "$MCP" install "$CFG" entwurf-bridge "$MCP_STATE"
want "malformed refusal writes no state" "[ ! -e '$MCP_STATE' ]"
seed_config
python3 "$SL" install "$CFG" "$SL_STATE" >/dev/null   # a FOREIGN atom's receipt
cp "$SL_STATE" "$MCP_STATE"                            # …parked on OUR path
refuses "foreign-atom state is refused" "belongs to atom" python3 "$MCP" install "$CFG" entwurf-bridge "$MCP_STATE"
python3 "$SL" uninstall "$SL_STATE" >/dev/null
rm -f "$MCP_STATE"   # the parked foreign receipt must not poison the next case
seed_config
python3 "$MCP" install "$CFG" entwurf-bridge "$MCP_STATE" >/dev/null
sed -i "s|$(json_field "$MCP_STATE" managedConfigPath)|$SB/elsewhere.toml|" "$MCP_STATE"
refuses "retargeted state is refused" "refusing to retarget" python3 "$MCP" install "$CFG" entwurf-bridge "$MCP_STATE"
rm -f "$MCP_STATE"
seed_config; operator_bridge_with_url() {
  cat >> "$CFG" <<'EOF'
[mcp_servers.entwurf-bridge]
url = "https://bridge.example/mcp"
EOF
}
operator_bridge_with_url
refuses "streamable_http entry refused BY NAME (url)" "\`url\`" python3 "$MCP" install "$CFG" entwurf-bridge "$MCP_STATE"
sed -i 's|^url = .*|command = "x"\nenabled = false|' "$CFG"
refuses "explicitly disabled entry refused BY NAME (enabled)" "\`enabled\`" python3 "$MCP" install "$CFG" entwurf-bridge "$MCP_STATE"
want "contrary refusals wrote no state" "[ ! -e '$MCP_STATE' ]"

# a receipt whose config vanished is red, not silently green
seed_config
python3 "$MCP" install "$CFG" entwurf-bridge "$MCP_STATE" >/dev/null
rm -f "$CFG"
python3 "$MCP" doctor-static "$CFG" entwurf-bridge "$MCP_STATE" >"$SB/out" 2>&1 && die "file-absent drift doctor should be red"
want "file-absent with a receipt is red" "grep -q '^file-absent drift entry-gone$' '$SB/out'"
python3 "$MCP" uninstall "$MCP_STATE" >/dev/null
want "uninstall clears the orphaned receipt" "[ ! -e '$MCP_STATE' ]"

###############################################################################
# Fault injection — the state receipt is durable BEFORE the operator's config
# is ever touched, at each of atomic_write's three fault points
###############################################################################
for stage in mkdir write replace; do
  seed_config
  cp "$CFG" "$SB/state-fault-pre.toml"
  ENTWURF_TEST_CODEX_TOML_FAULT="$stage:.codex-state-" python3 "$MCP" install "$CFG" entwurf-bridge "$MCP_STATE" >"$SB/out" 2>&1 \
    && die "injected $stage state fault did not stop install"
  grep -q "injected $stage fault (.codex-state-)" "$SB/out" || die "state $stage fault refusal is unnamed: $(cat "$SB/out")"
  ok "state $stage fault refuses by name"
  cmp -s "$SB/state-fault-pre.toml" "$CFG" && ok "state $stage fault leaves operator config untouched" \
    || die "[QK:CODEX-TOML-STATE-BEFORE-CONFIG] state $stage fault mutated operator config"
  want "state $stage fault leaves no state file" "[ ! -e '$MCP_STATE' ]"
  if [ "$stage" = replace ]; then
    find "$(dirname "$MCP_STATE")" -maxdepth 1 -name '.codex-state-*' | grep -q . \
      && die "a failed state replace left a stray temp file" \
      || ok "failed state replace leaves no stray temp file"
  fi
done

###############################################################################
# Config replace fault — atomic_write's own rollback leaves the operator's
# bytes byte-exact, and a fault-free retry + inverse still recovers them
###############################################################################
seed_config
operator_bridge
cp "$CFG" "$SB/replace-fault-pre.toml"
ENTWURF_TEST_CODEX_TOML_FAULT="replace:.codex-mcp-" python3 "$MCP" install "$CFG" entwurf-bridge "$MCP_STATE" >"$SB/out" 2>&1 \
  && die "[QK:CODEX-TOML-CONFIG-REPLACE-ROLLBACK] injected config replace fault did not stop install"
grep -q "injected replace fault (.codex-mcp-)" "$SB/out" || die "config replace fault refusal is unnamed: $(cat "$SB/out")"
ok "config replace fault refuses by name"
cmp -s "$SB/replace-fault-pre.toml" "$CFG" && ok "config replace fault leaves operator bytes untouched" \
  || die "config replace fault mutated operator config"
find "$CODEX_HOME" -maxdepth 1 -name '.codex-mcp-*' | grep -q . \
  && die "a failed config replace left a stray temp file" \
  || ok "failed config replace leaves no stray temp file"
want "the durable state still carries the operator's first preimage" \
  "[ -e '$MCP_STATE' ] && json_field '$MCP_STATE' preimage | grep -q 'bridge-start.sh'"

# a fault-free retry recovers cleanly, and the inverse restores the SAME
# preimage the interrupted install already made durable
python3 "$MCP" install "$CFG" entwurf-bridge "$MCP_STATE" >"$SB/out"
want "retry after the replace fault adopts" "grep -q '^adopt-regular-file ' '$SB/out'"
toml_ok "$CFG"; ok "retried config still parses as TOML"
python3 "$MCP" uninstall "$MCP_STATE" >"$SB/out"
want "uninstall reports the managed path" "grep -q '^uninstalled ' '$SB/out'"
cmp -s "$SB/replace-fault-pre.toml" "$CFG" && ok "inverse after fault-then-retry restores the operator's exact original bytes" \
  || die "inverse after retry did not restore the durable preimage"
want "state cleared after inverse" "[ ! -e '$MCP_STATE' ]"

###############################################################################
# Reshaped-owned entry — our table survives as a value but not as a literal
# header block; the inverse must refuse and keep the receipt, never resurrect
# or silently drop it
###############################################################################
seed_config
python3 "$MCP" install "$CFG" entwurf-bridge "$MCP_STATE" >/dev/null
sed -i '/^\[mcp_servers\.entwurf-bridge\]$/,/^ENTWURF_BRIDGE_NATIVE_HOST = "codex"$/d' "$CFG"
sed -i '1i mcp_servers.entwurf-bridge = { command = "entwurf-bridge" }' "$CFG"
toml_ok "$CFG"; ok "reshaped config still parses as TOML"
cp "$CFG" "$SB/reshaped-mcp.toml"
python3 "$MCP" uninstall "$MCP_STATE" >"$SB/out" 2>&1 \
  && die "[QK:CODEX-MCP-RESHAPED-REFUSES-KEEPS-STATE] uninstall accepted a reshaped owned entry"
grep -q "not as a literal table block" "$SB/out" || die "reshaped refusal is unnamed: $(cat "$SB/out")"
ok "reshaped entry refuses to uninstall, by name"
cmp -s "$SB/reshaped-mcp.toml" "$CFG" && ok "reshaped config untouched by the refused inverse" \
  || die "reshaped config mutated by refused inverse"
want "reshaped refusal retains the receipt" "[ -e '$MCP_STATE' ]"
rm -f "$MCP_STATE"   # hand-cleared: the reshaped entry has no normal inverse path

###############################################################################
# Atom 2 — [tui].status_line includes thread-title
###############################################################################

seed_config
cp "$CFG" "$SB/sl-seed.toml"
python3 "$SL" install "$CFG" "$SL_STATE" >"$SB/out"
want "existing operator list is merged" "grep -q '^merged-item ' '$SB/out'"
want "thread-title prepended, operator items keep their order" "grep -q '^status_line = \[\"thread-title\", \"model-with-reasoning\", \"current-dir\"\]$' '$CFG'"
toml_ok "$CFG"; ok "merged config still parses"
python3 "$SL" doctor-static "$CFG" "$SL_STATE" >"$SB/out"
want "owned status doctor is green" "grep -q '^thread-title-present owned$' '$SB/out'"
MT1="$(stat -c %Y "$CFG")"; sleep 1.1
python3 "$SL" install "$CFG" "$SL_STATE" >/dev/null
MT2="$(stat -c %Y "$CFG")"
want "status reinstall writes nothing" "[ '$MT1' = '$MT2' ]"

# the state receipt never changes the effective verdict
rm -f "$SL_STATE"
python3 "$SL" doctor-static "$CFG" "$SL_STATE" >"$SB/out"
want "unowned thread-title is green (state-independent)" "grep -q '^thread-title-present unowned$' '$SB/out'"

# ...and being unowned never rescues a MISSING required axis. The doctor's
# subject is visible identity, not our bookkeeping: `thread-title-present` is
# the only green, so every other effective token is red even with no receipt.
# Without this, a host whose config the operator keeps elsewhere reports exit 0
# while no Codex thread can ever show its garden id.
cp "$CFG" "$SB/sl-required-axis.toml"
sed -i 's/"thread-title", //' "$CFG"
python3 "$SL" doctor-static "$CFG" "$SL_STATE" >"$SB/out" 2>&1 \
  && die "[QK:CODEX-SL-DOCTOR-REQUIRES-VISIBLE-IDENTITY] unowned config WITHOUT thread-title reported green: $(cat "$SB/out")"
want "unowned thread-title-absent is red, both axes preserved" "grep -q '^thread-title-absent unowned$' '$SB/out'"
sed -i '/^status_line = /d' "$CFG"
python3 "$SL" doctor-static "$CFG" "$SL_STATE" >"$SB/out" 2>&1 \
  && die "unowned config with NO status_line key reported green: $(cat "$SB/out")"
want "unowned status-line-absent is red, both axes preserved" "grep -q '^status-line-absent unowned$' '$SB/out'"
ln -s "$SB/sl-required-axis.toml" "$SB/sl-symlinked.toml"
python3 "$SL" doctor-static "$SB/sl-symlinked.toml" "$SL_STATE" >"$SB/out" 2>&1 \
  && die "a symlinked config the doctor cannot read through reported green: $(cat "$SB/out")"
want "unowned symlink is red, both axes preserved" "grep -q '^symlink unowned$' '$SB/out'"
rm -f "$SB/sl-symlinked.toml"
cp "$SB/sl-required-axis.toml" "$CFG"

# drift: our item removed under a receipt is red; reinstall repairs. The seed
# is rebuilt first: the file still carries OUR merged item from the checks
# above, and adopting it back as "already-present" would make the inverse a
# (honest, but here unproven) no-op.
seed_config
python3 "$SL" install "$CFG" "$SL_STATE" >/dev/null
sed -i 's/"thread-title", //' "$CFG"
python3 "$SL" doctor-static "$CFG" "$SL_STATE" >"$SB/out" 2>&1 && die "removed thread-title doctor should be red"
want "removed thread-title under receipt is red and still names ownership" "grep -q '^thread-title-absent owned drift$' '$SB/out'"
python3 "$SL" install "$CFG" "$SL_STATE" >/dev/null
python3 "$SL" uninstall "$SL_STATE" >/dev/null
cmp -s "$SB/sl-seed.toml" "$CFG" && ok "status inverse restores operator bytes" || die "status inverse byte mismatch"
want "status state gone" "[ ! -e '$SL_STATE' ]"

###############################################################################
# Genuinely absent — the operator removes the whole status_line key we own;
# the inverse clears state cleanly instead of refusing or resurrecting it
###############################################################################
seed_config
python3 "$SL" install "$CFG" "$SL_STATE" >/dev/null
sed -i '/^status_line = /d' "$CFG"
toml_ok "$CFG"; ok "config with status_line key removed still parses"
python3 "$SL" uninstall "$SL_STATE" >"$SB/out" 2>&1 \
  || die "[QK:CODEX-SL-GENUINELY-ABSENT-CLEARS-STATE] genuinely-absent inverse refused instead of clearing state: $(cat "$SB/out")"
want "genuinely-absent inverse reports absence, not a restore" "grep -q 'status_line already absent' '$SB/out'"
want "genuinely-absent inverse clears state" "[ ! -e '$SL_STATE' ]"

# [tui] absent → the whole block is appended, and taken back whole
seed_config
sed -i '/^\[tui\]/,/^\[mcp_servers.other\]$/d' "$CFG"   # drop the [tui] family
cp "$CFG" "$SB/no-tui.toml"
python3 "$SL" install "$CFG" "$SL_STATE" >"$SB/out"
want "[tui] appended when absent" "grep -q '^appended-table ' '$SB/out' && grep -q '^\[tui\]$' '$CFG'"
python3 "$SL" uninstall "$SL_STATE" >/dev/null
cmp -s "$SB/no-tui.toml" "$CFG" && ok "appended [tui] block taken back byte-exact" || die "appended-block inverse mismatch"

# status_line absent inside [tui] → the key is inserted; unrelated keys stay
seed_config
sed -i '/^status_line = /d' "$CFG"
cp "$CFG" "$SB/no-key.toml"
python3 "$SL" install "$CFG" "$SL_STATE" >"$SB/out"
want "key inserted into existing [tui]" "grep -q '^inserted-key ' '$SB/out' && grep -q '^status_line = \[\"thread-title\"\]$' '$CFG'"
python3 "$SL" uninstall "$SL_STATE" >/dev/null
cmp -s "$SB/no-key.toml" "$CFG" && ok "inserted key taken back, theme survived" || die "inserted-key inverse mismatch"

# already-present: adoption without a single byte written
seed_config
sed -i 's/^status_line = .*/status_line = ["thread-title", "model-with-reasoning"]/' "$CFG"
cp "$CFG" "$SB/already.toml"
MT1="$(stat -c %Y "$CFG")"; sleep 1.1
python3 "$SL" install "$CFG" "$SL_STATE" >"$SB/out"
MT2="$(stat -c %Y "$CFG")"
want "already-present adopt writes nothing" "grep -q '^already-present ' '$SB/out' && [ '$MT1' = '$MT2' ]"
python3 "$SL" uninstall "$SL_STATE" >"$SB/out"
want "already-present uninstall takes back nothing" "grep -q 'nothing to take back' '$SB/out' && [ '$(stat -c %Y "$CFG")' = '$MT1' ]"

# multi-line operator array and the empty array are both merged byte-honestly
seed_config
python3 - "$CFG" <<'PY'
import sys
p = sys.argv[1]
t = open(p).read()
t = t.replace('status_line = ["model-with-reasoning", "current-dir"]',
              'status_line = [\n  "model-with-reasoning", # operator note\n  "current-dir",\n]')
open(p, 'w').write(t)
PY
cp "$CFG" "$SB/multiline.toml"
python3 "$SL" install "$CFG" "$SL_STATE" >/dev/null
toml_ok "$CFG"; ok "multi-line array merged and parseable"
python3 "$SL" uninstall "$SL_STATE" >/dev/null
cmp -s "$SB/multiline.toml" "$CFG" && ok "multi-line array restored byte-exact" || die "multiline inverse mismatch"
seed_config   # the multiline value above spans lines; build the empty list fresh
sed -i 's/^status_line = .*/status_line = []/' "$CFG"
cp "$CFG" "$SB/empty.toml"
python3 "$SL" install "$CFG" "$SL_STATE" >/dev/null
want "empty list becomes exactly [\"thread-title\"]" "grep -q '^status_line = \[\"thread-title\"\]$' '$CFG'"
python3 "$SL" uninstall "$SL_STATE" >/dev/null
cmp -s "$SB/empty.toml" "$CFG" && ok "empty list restored byte-exact" || die "empty-list inverse mismatch"

# refusals — symlink, malformed, contrary value by name, foreign/retargeted state
seed_config
ln -sf "$SB/foreign.toml" "$CFG"
refuses "symlink config refused (statusline)" "symlink" python3 "$SL" install "$CFG" "$SL_STATE"
rm -f "$CFG"
printf 'garbage [[[\n' > "$CFG"
refuses "malformed TOML refused (statusline)" "not valid TOML" python3 "$SL" install "$CFG" "$SL_STATE"
seed_config
sed -i 's/^status_line = .*/status_line = "thread-title"/' "$CFG"
refuses "non-array status_line refused BY NAME" "status_line.*explicitly" python3 "$SL" install "$CFG" "$SL_STATE"
want "statusline refusals wrote no state" "[ ! -e '$SL_STATE' ]"
seed_config
python3 "$MCP" install "$CFG" entwurf-bridge "$MCP_STATE" >/dev/null
cp "$MCP_STATE" "$SL_STATE"                              # the foreign receipt, on our path
refuses "foreign-atom state refused (statusline)" "belongs to atom" python3 "$SL" install "$CFG" "$SL_STATE"
python3 "$MCP" uninstall "$MCP_STATE" >/dev/null
rm -f "$SL_STATE"     # the parked foreign receipt must not poison the next case
seed_config
python3 "$SL" install "$CFG" "$SL_STATE" >/dev/null
sed -i "s|$(json_field "$SL_STATE" managedConfigPath)|$SB/elsewhere.toml|" "$SL_STATE"
refuses "retargeted state refused (statusline)" "refusing to retarget" python3 "$SL" install "$CFG" "$SL_STATE"
rm -f "$SL_STATE"

# operator restructures the list after install: the take-back refuses, by name
seed_config
python3 "$SL" install "$CFG" "$SL_STATE" >/dev/null
sed -i 's/^status_line = .*/status_line = [\n  "weather",\n  "thread-title",\n]/' "$CFG"
refuses "restructured list refuses blind take-back" "changed since install" python3 "$SL" uninstall "$SL_STATE"
rm -f "$SL_STATE"

###############################################################################
# Unrelated operator config survives the whole cycle, byte for byte
###############################################################################
seed_config
cp "$CFG" "$SB/final-seed.toml"
python3 "$MCP" install "$CFG" entwurf-bridge "$MCP_STATE" >/dev/null
python3 "$SL" install "$CFG" "$SL_STATE" >/dev/null
toml_ok "$CFG"; ok "fully installed config parses as TOML"
python3 - "$CFG" <<'PY'
import tomllib, sys
d = tomllib.load(open(sys.argv[1], "rb"))
assert d["hooks"]["state"]["~/c.toml:session_start:0:0"] == {"trusted_hash": "sha256:abc"}, d
assert d["projects"]["/home/op/work"] == {"trust_level": "trusted"}, d
assert d["mcp_servers"]["other"] == {"command": "keep-me"}, d
assert d["mcp_servers"]["entwurf-bridge"] == {
    "command": "entwurf-bridge",
    "env_vars": [
        "CODEX_HOME",
        "ENTWURF_DIR",
        "PI_CODING_AGENT_DIR",
        "ENTWURF_META_SESSIONS_DIR",
        "ENTWURF_META_MAILBOX_DIR",
        "ENTWURF_META_SENDERS_DIR",
        "ENTWURF_META_RECEIVERS_DIR",
        "TMUX",
        "TMUX_PANE",
    ],
    "env": {"ENTWURF_BRIDGE_NATIVE_HOST": "codex"},
}, d
assert d["tui"]["status_line"] == ["thread-title", "model-with-reasoning", "current-dir"], d
assert d["tui"]["theme"] == "zenburn" and d["tui"]["model_availability_nux"] == {"gpt-5.5": 4}, d
assert d["plugins"]["github@openai-curated"] == {"enabled": False}, d
PY
ok "unrelated tables intact and both atoms semantically live"
# the vendor writes trust state back between install and uninstall (M1)
printf '[hooks.state."~/c.toml:stop:0:0"]\ntrusted_hash = "sha256:def"\n' >> "$CFG"
python3 "$MCP" uninstall "$MCP_STATE" >/dev/null
python3 "$SL" uninstall "$SL_STATE" >/dev/null
printf '[hooks.state."~/c.toml:stop:0:0"]\ntrusted_hash = "sha256:def"\n' >> "$SB/final-seed.toml"
cmp -s "$SB/final-seed.toml" "$CFG" && ok "full cycle leaves only vendor-added bytes (unrelated config survives)" || die "final byte mismatch"
want "both states cleared" "[ ! -e '$MCP_STATE' ] && [ ! -e '$SL_STATE' ]"

REPO_AFTER="$(cd "$REPO_DIR" && git status --porcelain)"
[ "$REPO_BEFORE" = "$REPO_AFTER" ] || die "smoke changed the checkout"
printf '\nsmoke-codex-config-state: %d checks passed\n' "$pass"
