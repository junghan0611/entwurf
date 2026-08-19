#!/usr/bin/env bash
# smoke-agy-install-state — regression gate for the agy MCP install adapter (봉인 8). Runs the
# install → doctor → uninstall lifecycle in an ISOLATED HOME + XDG_DATA_HOME with a fake stable
# bin + fake `pgrep`/`ss` (no real ~/.gemini, no real agy). Asserts:
#   - adopt a regular file: entwurf-bridge registered, UNRELATED servers preserved, state written
#     with the STABLE command (never a repo/git path).
#   - doctor STATIC clean + LIVE SKIP with no agy; LIVE PASS with a fake agy present.
#   - uninstall honest-inverse: unrelated servers survive, entwurf-bridge + state removed.
#   - SYMLINK target → install REFUSES + writes NO state (someone else's SSOT).
#   - DANGLING SYMLINK (departed owner) → install REFUSES the same (islink() is true even when
#     the target is gone), writes NO state, NEVER follows the link to re-materialize the departed
#     file, and leaves the link itself intact (it is a specimen, not ours to silently remove).
#     Structurally reproduces the thinkpad ~/.gemini/*/mcp_config.json → removed agent-config path.
#   - DANGLING command → doctor FAILS (the oracle lesson, structurally reproduced).
#   - LEGACY MIGRATION: install targets the GLOBAL config (~/.gemini/config) and drops the stale
#     entwurf-bridge entry from the LEGACY antigravity-cli root (preserve unrelated / remove-if-ours
#     / never clobber a symlinked SSOT) — the "뭐가 글로벌인지" fix.
#   - LEGACY CACHE PRUNE: install removes the orphaned agy MCP tool-schema cache for cut-over-FROM
#     keys (pi-tools-bridge) — exact-name whitelist, live + unrelated caches preserved, symlink-safe.
#   - CREATE-NEW → uninstall removes the file it created.
#   - SETUP INTEGRATION (막힘 ①): the `wire_agy_bridge` wrapper folded into `./run.sh setup` —
#     agy absent → honest skip + NO state; agy present + regular → idempotent install + state;
#     agy present + symlink/corrupt → NON-FATAL WARN + continue (exit 0, reason-specific, no
#     clobber, no state). Driven via the hidden `wire-agy-bridge` subcommand with AGY_BIN pinned.
#   - DEV BIN (막힘 ②): the managed `entwurf-bridge` symlink dev-bin.sh exposes so the agy
#     config's BARE command resolves in a dev checkout — ownership-checked link (REFUSE a
#     foreign bin, never a blind ln -sf), state + honest inverse (remove only OUR link), and
#     the NON-FATAL setup wrapper (foreign → WARN + continue). Isolated bin dir + fake target.
#   - ⓪ discipline day-one: the checkout stays byte-identical (nothing written under $REPO).
# Offline + deterministic (deps: bash + python3).
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BRIDGE="$REPO_DIR/scripts/agy-bridge.sh"

pass=0
ok()   { printf '  ok    %s\n' "$1"; pass=$((pass + 1)); }
die()  { printf 'FAIL: %s\n' "$1" >&2; exit 1; }
want() { eval "$2" && ok "$1" || die "$1"; }

# ── checkout purity baseline: the repo working tree must be identical afterward ──
REPO_BEFORE="$(cd "$REPO_DIR" && git status --porcelain)"

SB="$(mktemp -d)"
trap 'rm -rf "$SB"' EXIT
export HOME="$SB/home"
export XDG_DATA_HOME="$SB/xdg"
# GLOBAL = the install target (the file live agy actually reads: ~/.gemini/config/mcp_config.json).
# LEGACY = the stale antigravity-cli root install now CLEANS (agy does not read it as global).
GLOBAL="$HOME/.gemini/config/mcp_config.json"
LEGACY="$HOME/.gemini/antigravity-cli/mcp_config.json"
STATE="$XDG_DATA_HOME/entwurf/agy-bridge/install-state.json"
PSTATE="$XDG_DATA_HOME/entwurf/agy-bridge/permission-state.json"
mkdir -p "$(dirname "$GLOBAL")" "$(dirname "$LEGACY")" "$SB/bin"

# fake stable bin (on PATH) + fake ss (unused by the deterministic path) — fake agy toggled per case.
#
# #81: the doctor now BOOTS the configured command and requires the entwurf MCP tool surface back,
# because `command -v` succeeding is not evidence agy gets a bridge — a relocated launcher resolves
# and still exits 127. So the healthy fake speaks the two frames the probe sends; the dead fake
# below reproduces the observed relocated-shim failure for the negative cell.
write_mcp_fake() {   # $1 = path
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
write_dead_fake() {  # $1 = path — resolves, then dies on exec (the relocated-shim shape)
  cat > "$1" <<'FAKE'
#!/usr/bin/env bash
echo "bash: /nonexistent/../global/v11/deadbeef/node_modules/@junghanacs/entwurf/mcp/entwurf-bridge/start.sh: No such file or directory" >&2
exit 127
FAKE
  chmod +x "$1"
}
write_mcp_fake "$SB/bin/entwurf-bridge"
printf '#!/usr/bin/env bash\nexit 0\n' > "$SB/bin/ss"
chmod +x "$SB/bin/ss"
export PATH="$SB/bin:$PATH"
export AGY_MCP_CONFIG="$GLOBAL"
export AGY_MCP_CONFIG_ALT="$LEGACY"
# agy MCP tool-schema cache root (sandbox-isolated — HOME is already the sandbox, set explicitly so
# the legacy-cache prune can NEVER reach a real ~/.gemini during the smoke).
CACHE="$HOME/.gemini/antigravity-cli/mcp"
export AGY_MCP_CACHE_DIR="$CACHE"

fake_agy() { # install/remove a fake `pgrep` that reports (or not) a live agy
  if [ "$1" = "on" ]; then
    printf '#!/usr/bin/env bash\n[ "$2" = agy ] && { echo 4242; exit 0; }\nexit 1\n' > "$SB/bin/pgrep"
  else
    printf '#!/usr/bin/env bash\nexit 1\n' > "$SB/bin/pgrep"
  fi
  chmod +x "$SB/bin/pgrep"
}
fake_agy off

# ── A: adopt a regular file — merge + preserve unrelated + record state ───────
printf '{\n  "mcpServers": { "other": { "command": "keepme" } }\n}\n' > "$GLOBAL"
bash "$BRIDGE" install >/dev/null
want "install: entwurf-bridge registered" "grep -q '\"entwurf-bridge\"' '$GLOBAL'"
want "install: unrelated server preserved" "grep -q '\"other\"' '$GLOBAL'"
want "install: state file written under XDG" "[ -f '$STATE' ]"
want "install: state records the STABLE command (not a repo/git path)" \
  "python3 -c 'import json,sys; d=json.load(open(sys.argv[1])); print(d[\"command\"])' '$STATE' | grep -qx entwurf-bridge"
want "install: state preimage null (key was absent)" \
  "python3 -c 'import json,sys; d=json.load(open(sys.argv[1])); sys.exit(0 if d[\"preimage\"] is None else 1)' '$STATE'"
want "install: managed config command is the stable bin, NOT a repo path" \
  "! grep -q '$REPO_DIR' '$GLOBAL'"

# ── B: doctor — static clean, live SKIP (no agy) ──────────────────────────────
DOC_OUT="$(bash "$BRIDGE" doctor)"; DOC_RC=$?
want "doctor(no-agy): exits 0 (static clean)" "[ '$DOC_RC' -eq 0 ]"
want "doctor(no-agy): live tier is an honest SKIP" "printf '%s' \"\$DOC_OUT\" | grep -q 'live: SKIP'"
want "doctor(no-agy): SKIP is not disguised as a pass" "! printf '%s' \"\$DOC_OUT\" | grep -q 'consistent with runtime wiring'"
want "doctor(installed): state-evidence confirms the managed config still configured" \
  "printf '%s' \"\$DOC_OUT\" | grep -q 'still configures entwurf-bridge'"

# ── B-boot: #81 A/B — a configured command that RESOLVES but does not serve MCP ──
# The static tier used to print "(resolvable)" and stay green here, which is exactly the state in
# which agy would have had no entwurf tool at all. Sandbox PATH only — the operator's launcher is
# never touched. `set -e` is fenced around the drive alone so the assertions still run.
write_dead_fake "$SB/bin/entwurf-bridge"
set +e; DOC_OUT="$(bash "$BRIDGE" doctor 2>&1)"; DOC_RC=$?; set -e
want "[QK:AGY-DOCTOR-BOOT-NEGATIVE] doctor(cmd resolves, does not boot): FAILS instead of blessing a resolvable name" "[ '$DOC_RC' -ne 0 ]"
want "doctor(cmd resolves, does not boot): says it does NOT serve MCP" \
  "printf '%s' \"\$DOC_OUT\" | grep -q 'resolves but does NOT serve MCP'"
want "doctor(cmd resolves, does not boot): carries the launcher's own stderr" \
  "printf '%s' \"\$DOC_OUT\" | grep -q 'No such file or directory'"
want "doctor(cmd resolves, does not boot): does not offer to clobber a foreign launcher" \
  "printf '%s' \"\$DOC_OUT\" | grep -q 'repair/remove it yourself'"
write_mcp_fake "$SB/bin/entwurf-bridge"
DOC_OUT="$(bash "$BRIDGE" doctor)"; DOC_RC=$?
want "doctor(after repair): the SAME unchanged doctor goes green once the command boots" "[ '$DOC_RC' -eq 0 ]"
want "doctor(after repair): green names the BOOT evidence, not resolvability" \
  "printf '%s' \"\$DOC_OUT\" | grep -q 'resolves AND boots the entwurf MCP surface'"

# ── C: doctor with a fake agy present → live is CONSISTENT (honest, not overclaimed) ──
fake_agy on
DOC_OUT="$(bash "$BRIDGE" doctor)"; DOC_RC=$?
want "doctor(agy-live): exits 0" "[ '$DOC_RC' -eq 0 ]"
want "doctor(agy-live): live tier says consistent-with-wiring (not SKIP)" \
  "printf '%s' \"\$DOC_OUT\" | grep -q 'consistent with runtime wiring'"
want "doctor(agy-live): live tier does NOT overclaim config-read as proven (honest label)" \
  "printf '%s' \"\$DOC_OUT\" | grep -q 'config-read NOT proven'"
fake_agy off

# ── C2 (N1 drift): install-state present but the managed config LOST our key → FAIL ──
# The real "wiring came loose / '?'" case — distinct from "never installed" (which is a note).
python3 -c 'import json,sys; p=sys.argv[1]; d=json.load(open(p)); d["mcpServers"].pop("entwurf-bridge",None); json.dump(d,open(p,"w"))' "$GLOBAL"
if bash "$BRIDGE" doctor >/dev/null 2>&1; then die "drift: doctor should FAIL (state present, key removed)"; fi
ok "drift: doctor FAILS on state-present + key-removed (installed-then-loosened ≠ never installed)"
bash "$BRIDGE" install >/dev/null   # restore so the honest-inverse uninstall below has a key to remove
want "drift: re-install restores the key" "grep -q '\"entwurf-bridge\"' '$GLOBAL'"

# ── C3 (ORPHANED): install-state present but managed config is completely ABSENT → Auto-clean ──
rm -f "$GLOBAL"
DOC_OUT="$(bash "$BRIDGE" doctor 2>&1)"; DOC_RC=$?
want "orphan: doctor exits 0 when config is completely absent (HOME wiped)" "[ '$DOC_RC' -eq 0 ]"
want "orphan: doctor logs ORPHANED and auto-cleans" "printf '%s' \"\$DOC_OUT\" | grep -q 'ORPHANED'"
want "orphan: state file is removed automatically" "[ ! -f '$STATE' ]"
printf '{\n  "mcpServers": { "other": { "command": "keepme" } }\n}\n' > "$GLOBAL"
bash "$BRIDGE" install >/dev/null   # restore for the honest-inverse uninstall below

# ── C3b (FOREIGN TARGET): state describes a file this host does not read ──────────────
# The state is INTACT and the file it names is perfectly configured — it is just not OUR file.
# A doctor that only inspects the recorded path calls that green while owning nothing here:
# uninstall would not touch the live config, and the live config has no recorded provenance.
# This is not hypothetical. A verification run that isolated HOME but SHARED XDG_DATA_HOME wrote
# sandbox settings and REAL state, and every agy doctor reported green on a host it no longer
# owned. Isolation must move HOME and XDG_DATA_HOME together; this gate is what says so out loud.
FOREIGN_DIR="$SB/foreign"; mkdir -p "$FOREIGN_DIR"
FOREIGN_CFG="$FOREIGN_DIR/mcp_config.json"
cp "$GLOBAL" "$FOREIGN_CFG"   # a VALID, fully-configured config — just not the one agy reads here
cp "$STATE" "$SB/state-before-foreign.json"   # restored verbatim below: see the note at the end
python3 -c "
import json,sys
p=sys.argv[1]; d=json.load(open(p)); d['managedConfigPath']=sys.argv[2]
json.dump(d, open(p,'w'))" "$STATE" "$FOREIGN_CFG"
set +e; DOC_OUT="$(bash "$BRIDGE" doctor 2>&1)"; DOC_RC=$?; set -e
want "foreign-target: doctor FAILS when install-state manages a config this host does not read" "[ '$DOC_RC' -ne 0 ]"
want "foreign-target: the report names both paths (recorded vs live), not a generic drift" \
  "printf '%s' \"\$DOC_OUT\" | grep -q 'FOREIGN TARGET' && printf '%s' \"\$DOC_OUT\" | grep -qF '$FOREIGN_CFG' && printf '%s' \"\$DOC_OUT\" | grep -qF '$GLOBAL'"
want "foreign-target: the foreign file is NOT auto-cleaned (it is someone else's, not ours to delete)" "[ -f '$FOREIGN_CFG' ]"
want "foreign-target: the state file is NOT auto-cleaned (a wrong target is a verdict, not stale state)" "[ -f '$STATE' ]"
# Restore the state VERBATIM rather than re-installing. A second install over an already-configured
# config would recapture OUR OWN entry as the preimage — the self-referential provenance trap this
# suite pins elsewhere — and the honest-inverse uninstall below would then have nothing to remove.
cp "$SB/state-before-foreign.json" "$STATE"
rm -f "$FOREIGN_CFG"

# State presence is not validity. A malformed body or missing target field must fail loud rather
# than becoming an empty string that silently skips the ownership check.
cp "$STATE" "$SB/state-before-corrupt.json"
printf 'not-json{{{' > "$STATE"
set +e; DOC_OUT="$(bash "$BRIDGE" doctor 2>&1)"; DOC_RC=$?; set -e
want "corrupt-state: doctor FAILS on unreadable install-state" "[ '$DOC_RC' -ne 0 ]"
want "corrupt-state: report names CORRUPT instead of silently skipping ownership" \
  "printf '%s' \"\$DOC_OUT\" | grep -q 'state: CORRUPT'"

# A RELATIVE managed path is corrupt too: install only ever records an absolute path, and
# normalizing a relative one against the doctor's own cwd could bless whatever directory the
# doctor happens to run from.
python3 -c "
import json,sys
p=sys.argv[1]; d={'managedConfigPath':'.gemini/config/mcp_config.json'}
json.dump(d, open(p,'w'))" "$STATE"
set +e; DOC_OUT="$(bash "$BRIDGE" doctor 2>&1)"; DOC_RC=$?; set -e
want "corrupt-state: a relative managedConfigPath is CORRUPT, never resolved against the doctor's cwd" \
  "[ '$DOC_RC' -ne 0 ] && printf '%s' \"\$DOC_OUT\" | grep -q 'state: CORRUPT'"
cp "$SB/state-before-corrupt.json" "$STATE"

# Permission state is an independent ownership rail. It must be checked even when the MCP config
# state is absent; nesting it under STATE_FILE would let a foreign permission target pass green.
cp "$PSTATE" "$SB/pstate-before-independent.json"
rm -f "$STATE"
python3 -c "
import json,sys
p=sys.argv[1]; d=json.load(open(p)); d['managedSettingsPath']=sys.argv[2]
json.dump(d, open(p,'w'))" "$PSTATE" "$SB/foreign-settings.json"
set +e; DOC_OUT="$(bash "$BRIDGE" doctor 2>&1)"; DOC_RC=$?; set -e
want "permission-foreign-target: doctor FAILS even when config install-state is absent" "[ '$DOC_RC' -ne 0 ]"
want "permission-foreign-target: report names the independent permission target" \
  "printf '%s' \"\$DOC_OUT\" | grep -q 'FOREIGN TARGET (permission)'"
cp "$SB/state-before-corrupt.json" "$STATE"
cp "$SB/pstate-before-independent.json" "$PSTATE"

printf 'not-json{{{' > "$PSTATE"
set +e; DOC_OUT="$(bash "$BRIDGE" doctor 2>&1)"; DOC_RC=$?; set -e
want "permission-corrupt-state: doctor FAILS on unreadable permission-state" "[ '$DOC_RC' -ne 0 ]"
want "permission-corrupt-state: report names CORRUPT instead of silently skipping permission ownership" \
  "printf '%s' \"\$DOC_OUT\" | grep -q 'CORRUPT (permission)'"
cp "$SB/pstate-before-independent.json" "$PSTATE"

# ── D: uninstall — honest inverse ─────────────────────────────────────────────
bash "$BRIDGE" uninstall >/dev/null
want "uninstall: entwurf-bridge removed" "! grep -q '\"entwurf-bridge\"' '$GLOBAL'"
want "uninstall: unrelated server survived" "grep -q '\"other\"' '$GLOBAL'"
want "uninstall: state file removed" "[ ! -f '$STATE' ]"

# ── E: SYMLINK target → install REFUSES + writes NO state ──────────────────────
rm -f "$GLOBAL"
printf '{"mcpServers":{}}\n' > "$SB/real_config.json"
ln -s "$SB/real_config.json" "$GLOBAL"
if bash "$BRIDGE" install >/dev/null 2>&1; then die "symlink: install should have REFUSED"; fi
ok "symlink: install refused (nonzero exit)"
want "symlink: NO state written on refusal" "[ ! -f '$STATE' ]"
want "symlink: the linked SSOT was NOT clobbered" "python3 -c 'import json,sys; d=json.load(open(sys.argv[1])); sys.exit(0 if d[\"mcpServers\"]=={} else 1)' '$SB/real_config.json'"
rm -f "$GLOBAL"

# ── E2: DANGLING SYMLINK (departed owner) → install REFUSES + NO state ─────────
# The thinkpad specimen: ~/.gemini/*/mcp_config.json is a symlink to a DEPARTED owner's path
# (agent-config removed the target), so the link dangles. os.path.islink() is true even with an
# absent target, so install must refuse it the SAME as a live symlink — write NO state, and (the
# real point) NEVER follow the link to re-materialize the departed owner's file. The link itself
# is left intact: it is a specimen the device-adoption step removes by hand, not ours to clobber.
rm -f "$GLOBAL"
DEPARTED="$SB/departed-owner/mcp_config.json"   # target dir/file does NOT exist (departed owner)
ln -s "$DEPARTED" "$GLOBAL"
want "dangling-symlink: precondition — link is dangling (target absent)" \
  "[ -L '$GLOBAL' ] && [ ! -e '$GLOBAL' ]"
set +e; OUT="$(bash "$BRIDGE" install 2>&1)"; RC=$?; set -e
want "dangling-symlink: install exits nonzero (refused)" "[ '$RC' -ne 0 ]"
want "dangling-symlink: refusal is the SYMLINK reason (not invalid-json / other)" \
  "printf '%s' \"\$OUT\" | grep -qi 'refused (symlink)'"
want "dangling-symlink: NO state written on refusal" "[ ! -f '$STATE' ]"
want "dangling-symlink: link NOT followed — departed target still absent (no re-materialize)" \
  "[ ! -e '$DEPARTED' ]"
want "dangling-symlink: the dangling link left intact (a specimen, not silently removed)" \
  "[ -L '$GLOBAL' ]"
rm -f "$GLOBAL"

# ── F: DANGLING command → doctor FAILS ────────────────────────────────────────
printf '{"mcpServers":{"entwurf-bridge":{"command":"/nonexistent/dangling/start.sh"}}}\n' > "$LEGACY"
if bash "$BRIDGE" doctor >/dev/null 2>&1; then die "dangling: doctor should have FAILED"; fi
ok "dangling: doctor failed (nonzero exit) on a dangling command"
rm -f "$LEGACY"

# ── G: CREATE-NEW → uninstall removes the created file ────────────────────────
bash "$BRIDGE" install >/dev/null
want "create-new: file created" "[ -f '$GLOBAL' ]"
want "create-new: state detectMode is created-new" \
  "python3 -c 'import json,sys; d=json.load(open(sys.argv[1])); print(d[\"detectMode\"])' '$STATE' | grep -qx created-new"
bash "$BRIDGE" uninstall >/dev/null
want "create-new: uninstall removed the file it created (empty)" "[ ! -f '$GLOBAL' ]"
want "create-new: state removed" "[ ! -f '$STATE' ]"

# ── H: uninstall with no state is idempotent (a note, not a failure) ──────────
bash "$BRIDGE" uninstall >/dev/null 2>&1
ok "idempotent: uninstall with no state exits 0 (nothing to undo)"

# ── H2: legacy migration — install targets GLOBAL and CLEANS the LEGACY root ──────────
# The "뭐가 글로벌인지" fix: install writes to the GLOBAL config (~/.gemini/config) and, as a
# one-way migration, drops the stale entwurf-bridge entry from the LEGACY root (~/.gemini/
# antigravity-cli) which live agy does NOT read as global MCP config. Preserves unrelated servers.
rm -f "$GLOBAL" "$LEGACY" "$STATE"
printf '{"mcpServers":{"entwurf-bridge":{"command":"old-wrong-bin"},"other":{"command":"keepme"}}}\n' > "$LEGACY"
bash "$BRIDGE" install >/dev/null
want "legacy-migrate: entwurf-bridge registered in the GLOBAL config" "grep -q '\"entwurf-bridge\"' '$GLOBAL'"
want "legacy-migrate: stale entwurf-bridge removed from the LEGACY root" \
  "! python3 -c 'import json,sys; d=json.load(open(sys.argv[1])); sys.exit(0 if \"entwurf-bridge\" in d[\"mcpServers\"] else 1)' '$LEGACY'"
want "legacy-migrate: unrelated LEGACY server preserved" "grep -q '\"other\"' '$LEGACY'"
want "legacy-migrate: state managedConfigPath is the GLOBAL config" \
  "python3 -c 'import json,sys; sys.exit(0 if json.load(open(sys.argv[1]))[\"managedConfigPath\"]==sys.argv[2] else 1)' '$STATE' '$GLOBAL'"
bash "$BRIDGE" uninstall >/dev/null; rm -f "$GLOBAL" "$LEGACY" "$STATE"

# H2b: a LEGACY root holding ONLY entwurf-bridge → install removes the whole file (cleaned-removed)
printf '{"mcpServers":{"entwurf-bridge":{"command":"old-wrong-bin"}}}\n' > "$LEGACY"
bash "$BRIDGE" install >/dev/null
want "legacy-migrate(only-ours): LEGACY file removed when it held only entwurf-bridge" "[ ! -e '$LEGACY' ]"
bash "$BRIDGE" uninstall >/dev/null; rm -f "$GLOBAL" "$STATE"

# H2c: a SYMLINK LEGACY (someone else's SSOT) → install still succeeds, link left intact (not clobbered)
printf '{"mcpServers":{"entwurf-bridge":{"command":"x"}}}\n' > "$SB/legacy_ssot.json"
ln -s "$SB/legacy_ssot.json" "$LEGACY"
bash "$BRIDGE" install >/dev/null
want "legacy-migrate(symlink): install still registered entwurf-bridge in GLOBAL" "grep -q '\"entwurf-bridge\"' '$GLOBAL'"
want "legacy-migrate(symlink): symlinked LEGACY SSOT left intact (not clobbered)" \
  "python3 -c 'import json,sys; d=json.load(open(sys.argv[1])); sys.exit(0 if \"entwurf-bridge\" in d[\"mcpServers\"] else 1)' '$SB/legacy_ssot.json'"
bash "$BRIDGE" uninstall >/dev/null; rm -f "$GLOBAL" "$LEGACY" "$STATE"

# ── H3: legacy CACHE prune — install removes ONLY the known-legacy MCP cache, never others ─────
# The pi-tools-bridge → entwurf-bridge cutover leaves an orphaned agy tool-schema cache dir agy
# never prunes. install removes it (exact-name whitelist), preserves the live entwurf-bridge cache
# AND any unrelated server's cache, and never follows a symlink.
rm -f "$GLOBAL" "$LEGACY" "$STATE"
mkdir -p "$CACHE/pi-tools-bridge" "$CACHE/entwurf-bridge" "$CACHE/some-other-mcp"
printf '{}' > "$CACHE/pi-tools-bridge/entwurf.json"
printf '{}' > "$CACHE/some-other-mcp/tool.json"
bash "$BRIDGE" install >/dev/null
want "cache-prune: stale pi-tools-bridge cache removed" "[ ! -e '$CACHE/pi-tools-bridge' ]"
want "cache-prune: live entwurf-bridge cache preserved" "[ -d '$CACHE/entwurf-bridge' ]"
want "cache-prune: unrelated MCP server cache preserved (whitelist, not scan-delete)" "[ -d '$CACHE/some-other-mcp' ]"
bash "$BRIDGE" uninstall >/dev/null; rm -f "$GLOBAL" "$STATE"; rm -rf "$CACHE/entwurf-bridge" "$CACHE/some-other-mcp"

# H3b: a SYMLINK legacy cache dir → install leaves it intact (not ours to remove)
rm -f "$GLOBAL" "$STATE"
mkdir -p "$SB/foreign-cache"
ln -s "$SB/foreign-cache" "$CACHE/pi-tools-bridge"
bash "$BRIDGE" install >/dev/null
want "cache-prune(symlink): symlinked legacy cache left intact (not clobbered)" \
  "[ -L '$CACHE/pi-tools-bridge' ] && [ -d '$SB/foreign-cache' ]"
bash "$BRIDGE" uninstall >/dev/null; rm -f "$CACHE/pi-tools-bridge" "$GLOBAL" "$STATE"

# ── I: setup integration — wire_agy_bridge (막힘 ①: detection-gated, NON-FATAL) ─────
# The setup wrapper folded into `./run.sh setup`. Driven here via the hidden `wire-agy-bridge`
# subcommand with AGY_BIN pinned (a fake agy / a nonexistent path) so detection is hermetic
# regardless of the CI/dev host's real agy. Locks: agy absent → honest skip + NO state; agy
# present + regular → idempotent install + state; agy present + symlink/corrupt → NON-FATAL
# WARN + continue (exit 0 — an optional harness must never brick a pi/Claude setup), reason-
# specific, no clobber, no state. Clean slate here (H left no config/state).
rm -f "$GLOBAL" "$LEGACY" "$STATE"
printf '#!/usr/bin/env bash\necho fake-agy\n' > "$SB/bin/agy"; chmod +x "$SB/bin/agy"

# I-1: agy ABSENT → honest skip, no state, exit 0 (AGY_BIN → a nonexistent path)
set +e; OUT="$(AGY_BIN="$SB/no-such-agy" bash "$REPO_DIR/run.sh" wire-agy-bridge 2>&1)"; RC=$?; set -e
want "wire(no-agy): exits 0 (non-fatal skip)" "[ '$RC' -eq 0 ]"
want "wire(no-agy): honest skip message" "printf '%s' \"\$OUT\" | grep -q 'skipping agy bridge wiring'"
want "wire(no-agy): NO state written" "[ ! -f '$STATE' ]"
want "wire(no-agy): NO config created" "[ ! -e '$GLOBAL' ]"

# I-2: agy PRESENT + regular config → idempotent install + state, exit 0
printf '{\n  "mcpServers": { "other": { "command": "keepme" } }\n}\n' > "$GLOBAL"
set +e; OUT="$(AGY_BIN="$SB/bin/agy" bash "$REPO_DIR/run.sh" wire-agy-bridge 2>&1)"; RC=$?; set -e
want "wire(agy+regular): exits 0" "[ '$RC' -eq 0 ]"
want "wire(agy+regular): entwurf-bridge registered" "grep -q '\"entwurf-bridge\"' '$GLOBAL'"
want "wire(agy+regular): unrelated server preserved" "grep -q '\"other\"' '$GLOBAL'"
want "wire(agy+regular): state written" "[ -f '$STATE' ]"
set +e; OUT="$(AGY_BIN="$SB/bin/agy" bash "$REPO_DIR/run.sh" wire-agy-bridge 2>&1)"; RC=$?; set -e
want "wire(agy+regular, re-run): idempotent exit 0" "[ '$RC' -eq 0 ]"
want "wire(agy+regular, re-run): config still valid + entwurf-bridge present" \
  "python3 -c 'import json,sys; d=json.load(open(sys.argv[1])); sys.exit(0 if \"entwurf-bridge\" in d[\"mcpServers\"] else 1)' '$GLOBAL'"
want "wire(agy+regular, re-run): unrelated server still preserved" "grep -q '\"other\"' '$GLOBAL'"
bash "$BRIDGE" uninstall >/dev/null; rm -f "$GLOBAL"

# I-3: agy PRESENT + SYMLINK config → NON-FATAL WARN + continue (exit 0), no clobber, no state
printf '{"mcpServers":{}}\n' > "$SB/real_wire_cfg.json"
ln -s "$SB/real_wire_cfg.json" "$GLOBAL"
set +e; OUT="$(AGY_BIN="$SB/bin/agy" bash "$REPO_DIR/run.sh" wire-agy-bridge 2>&1)"; RC=$?; set -e
want "wire(agy+symlink): exits 0 (NON-FATAL — setup not bricked)" "[ '$RC' -eq 0 ]"
want "wire(agy+symlink): reason-specific WARN names the symlink/SSOT" \
  "printf '%s' \"\$OUT\" | grep -qi 'symlink'"
want "wire(agy+symlink): linked SSOT NOT clobbered" \
  "python3 -c 'import json,sys; d=json.load(open(sys.argv[1])); sys.exit(0 if d[\"mcpServers\"]=={} else 1)' '$SB/real_wire_cfg.json'"
want "wire(agy+symlink): NO state written" "[ ! -f '$STATE' ]"
rm -f "$GLOBAL"

# I-4: agy PRESENT + CORRUPT config (invalid JSON) → NON-FATAL WARN + continue, corrupt-specific
printf 'this is not json{{{' > "$GLOBAL"
set +e; OUT="$(AGY_BIN="$SB/bin/agy" bash "$REPO_DIR/run.sh" wire-agy-bridge 2>&1)"; RC=$?; set -e
want "wire(agy+corrupt): exits 0 (NON-FATAL)" "[ '$RC' -eq 0 ]"
want "wire(agy+corrupt): reason-specific WARN flags invalid JSON (not a silent skip)" \
  "printf '%s' \"\$OUT\" | grep -qi 'invalid JSON'"
want "wire(agy+corrupt): NO state written" "[ ! -f '$STATE' ]"
rm -f "$GLOBAL" "$SB/bin/agy"

# ── J: dev bin exposure — dev-bin.sh (막힘 ②: managed stable-bin symlinks) ─────────
# dev-bin.sh now manages MULTIPLE bins (entwurf-bridge + entwurf-agy-statusline), each with its
# OWN <name>.install-state.json. J drives the entwurf-bridge bin by NAME so these locks stay
# byte-for-byte the pre-multi-bin regression (무회귀 판정): ownership-checked link (REFUSE
# foreign, never a blind ln -sf), state + honest inverse, remove only OUR link, NON-FATAL setup
# wrapper on a foreign bin. J-5 adds the new legacy-state migration. Isolated: a sandbox bin dir
# + fake executable targets + the sandbox XDG state.
DEVBIN="$REPO_DIR/scripts/dev-bin.sh"
DBIN_DIR="$SB/devbin"
DLINK="$DBIN_DIR/entwurf-bridge"
DSTATE="$XDG_DATA_HOME/entwurf/dev-bin/entwurf-bridge.install-state.json"   # bin-scoped state
printf '#!/usr/bin/env bash\necho fake-bridge\n' > "$SB/fake-start.sh"; chmod +x "$SB/fake-start.sh"
printf '#!/usr/bin/env bash\necho fake-status\n' > "$SB/fake-status.sh"; chmod +x "$SB/fake-status.sh"
export ENTWURF_DEV_BIN_DIR="$DBIN_DIR"
export ENTWURF_BRIDGE_TARGET="$SB/fake-start.sh"
export ENTWURF_AGY_STATUSLINE_TARGET="$SB/fake-status.sh"   # for the no-arg setup wrapper (two bins)

# J-1: expose the entwurf-bridge bin BY NAME → creates the managed symlink + state (created-new)
bash "$DEVBIN" expose entwurf-bridge >/dev/null 2>&1
want "dev-bin expose: symlink created" "[ -L '$DLINK' ]"
want "dev-bin expose: symlink points at our target" "[ \"\$(readlink '$DLINK')\" = '$SB/fake-start.sh' ]"
want "dev-bin expose: bin-scoped state written under XDG" "[ -f '$DSTATE' ]"
want "dev-bin expose: state records our linkPath" \
  "python3 -c 'import json,sys; d=json.load(open(sys.argv[1])); sys.exit(0 if d[\"linkPath\"]==sys.argv[2] else 1)' '$DSTATE' '$DLINK'"
want "dev-bin expose: detectMode created-new" \
  "python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))[\"detectMode\"])' '$DSTATE' | grep -qx created-new"

# J-2: re-expose → idempotent refresh (still our link, detectMode refresh-ours)
bash "$DEVBIN" expose entwurf-bridge >/dev/null 2>&1
want "dev-bin re-expose: idempotent — still our symlink" "[ \"\$(readlink '$DLINK')\" = '$SB/fake-start.sh' ]"
want "dev-bin re-expose: detectMode now refresh-ours" \
  "python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))[\"detectMode\"])' '$DSTATE' | grep -qx refresh-ours"

# J-2b (GPT R): state present but our link REPLACED by a foreign symlink → expose must REFUSE.
# linkPath-match alone must NOT authorize a clobber — the swapped-in symlink points elsewhere
# (readlink != state.target), so it is someone else's, not a moved-checkout relink of ours.
rm -f "$DLINK"; ln -s "$SB/foreign-target" "$DLINK"   # foreign symlink at our recorded path (dangling ok)
if bash "$DEVBIN" expose entwurf-bridge >/dev/null 2>&1; then die "dev-bin: expose should REFUSE a foreign symlink swapped in at our recorded path"; fi
ok "dev-bin expose: refused a foreign symlink at our recorded path (readlink != state.target)"
want "dev-bin expose: foreign symlink NOT clobbered" "[ \"\$(readlink '$DLINK')\" = '$SB/foreign-target' ]"
rm -f "$DLINK"
bash "$DEVBIN" expose entwurf-bridge >/dev/null 2>&1   # restore our link + state for the sub-cases below

# J-3: FOREIGN bin already at the link path → REFUSE (exit 3), no clobber, no state
bash "$DEVBIN" remove entwurf-bridge >/dev/null 2>&1        # clear our link + state first
printf 'FOREIGN NPM BIN\n' > "$DLINK"        # someone else's regular-file bin
if bash "$DEVBIN" expose entwurf-bridge >/dev/null 2>&1; then die "dev-bin: expose should REFUSE a foreign bin"; fi
ok "dev-bin expose: refused a foreign bin (nonzero exit)"
want "dev-bin expose: foreign bin NOT clobbered" "[ \"\$(cat '$DLINK')\" = 'FOREIGN NPM BIN' ]"
want "dev-bin expose: no state written on foreign refuse" "[ ! -f '$DSTATE' ]"
# the NON-FATAL setup wrapper (no-arg → all bins) turns that refuse into a WARN + continue. The
# foreign entwurf-bridge is the FIRST managed bin, so the wrapper stops there (statusline unreached).
set +e; OUT="$(bash "$REPO_DIR/run.sh" expose-dev-bin 2>&1)"; RC=$?; set -e
want "dev-bin wrapper(foreign): setup wrapper exits 0 (NON-FATAL)" "[ '$RC' -eq 0 ]"
want "dev-bin wrapper(foreign): WARNs about a foreign bin (not ours)" "printf '%s' \"\$OUT\" | grep -qi 'not ours'"
rm -f "$DLINK"

# J-4: remove is honest-inverse — removes ONLY our link, refuses a link that became foreign
bash "$DEVBIN" expose entwurf-bridge >/dev/null 2>&1
bash "$DEVBIN" remove entwurf-bridge >/dev/null 2>&1
want "dev-bin remove: our link removed" "[ ! -e '$DLINK' ]"
want "dev-bin remove: state removed" "[ ! -f '$DSTATE' ]"
bash "$DEVBIN" remove entwurf-bridge >/dev/null 2>&1
ok "dev-bin remove: idempotent with no state (exit 0)"
bash "$DEVBIN" expose entwurf-bridge >/dev/null 2>&1
rm -f "$DLINK"; printf 'FOREIGN\n' > "$DLINK"   # our link replaced by a foreign regular file
if bash "$DEVBIN" remove entwurf-bridge >/dev/null 2>&1; then die "dev-bin: remove should REFUSE a now-foreign link"; fi
ok "dev-bin remove: refused removing a now-foreign link"
want "dev-bin remove: foreign file left intact" "[ \"\$(cat '$DLINK')\" = 'FOREIGN' ]"
rm -f "$DLINK" "$DSTATE"

# J-5 (multi-bin migration, 페블 A): a pre-multi-bin single `install-state.json` is ADOPTED as
# `entwurf-bridge.install-state.json` (content-checked: linkPath basename == entwurf-bridge), old
# name dropped (new first, then old — atomic rename); corrupt/foreign legacy → refuse (never guess).
bash "$DEVBIN" remove entwurf-bridge >/dev/null 2>&1        # clean slate
LEGACY="$XDG_DATA_HOME/entwurf/dev-bin/install-state.json"
mkdir -p "$(dirname "$LEGACY")"
printf '{"schemaVersion":1,"linkPath":"%s","target":"%s","detectMode":"created-new","stampedAt":"x"}\n' "$DLINK" "$SB/fake-start.sh" > "$LEGACY"
bash "$DEVBIN" expose entwurf-bridge >/dev/null 2>&1
want "dev-bin migrate: legacy install-state.json adopted as entwurf-bridge.install-state.json" "[ -f '$DSTATE' ]"
want "dev-bin migrate: legacy name gone (new first, old dropped)" "[ ! -f '$LEGACY' ]"
want "dev-bin migrate: adopted state preserves linkPath" \
  "python3 -c 'import json,sys; sys.exit(0 if json.load(open(sys.argv[1]))[\"linkPath\"]==sys.argv[2] else 1)' '$DSTATE' '$DLINK'"
bash "$DEVBIN" remove entwurf-bridge >/dev/null 2>&1
mkdir -p "$(dirname "$LEGACY")"       # remove may have rmdir'd the empty state dir
printf 'not json{{{' > "$LEGACY"      # corrupt legacy → refuse
if bash "$DEVBIN" expose entwurf-bridge >/dev/null 2>&1; then die "dev-bin migrate: corrupt legacy should REFUSE"; fi
ok "dev-bin migrate: corrupt legacy refused (nonzero, no guess)"
rm -f "$LEGACY" "$DLINK" "$DSTATE"
mkdir -p "$(dirname "$LEGACY")"
printf '{"linkPath":"%s/something-else","target":"x"}\n' "$DBIN_DIR" > "$LEGACY"   # foreign basename → refuse
if bash "$DEVBIN" expose entwurf-bridge >/dev/null 2>&1; then die "dev-bin migrate: foreign legacy should REFUSE"; fi
ok "dev-bin migrate: foreign legacy refused (linkPath basename != entwurf-bridge)"
rm -f "$LEGACY" "$DLINK" "$DSTATE"
unset ENTWURF_DEV_BIN_DIR ENTWURF_BRIDGE_TARGET ENTWURF_AGY_STATUSLINE_TARGET

# ── K: permission grant — the OTHER half of a usable bridge ───────────────────
# Registering the server only makes the tools REACHABLE. agy defaults every `mcp` action to Ask, so
# without an allow rule every call stops for a y/n — a registered-but-ungranted bridge is
# half-installed. We grant ONE NARROW STRING PER NORMAL-PATH TOOL in `permissions.allow` (every
# tool the server exposes is visible to the model; auto-granting is the smaller, deliberate set).
# The operator's own rules are preserved, never managed (granting ourselves command(*) would be their
# trust decision, not ours). The rule list comes from the config engine, never retyped here — a
# second copy is how a newly shipped tool silently stops being granted.
SETTINGS="$HOME/.gemini/antigravity-cli/settings.json"
SLSTATE="$XDG_DATA_HOME/entwurf/agy-statusline/install-state.json"
STATUSLINE="$REPO_DIR/scripts/agy-statusline-bridge.sh"
RULES="$(python3 "$REPO_DIR/scripts/agy-bridge-config.py" permission-rules)"
RULE="${RULES%% *}"   # first rule, for the single-string cases below

# ── INDEPENDENT CONTRACT ─────────────────────────────────────────────────────
# Everything below drives the SUT with $RULES, which the SUT itself printed. That is the right way
# to keep operator messages and assertions from drifting — but as an ORACLE it is circular: adding
# entwurf_inbox_read to ALLOW_RULES, or swapping entwurf_peers for something else, would sail
# through every rule-set assertion because the expectation moved with the code. So the SET ITSELF is
# pinned here, literally, once. Over-granting is the failure this catches: a permission we take and
# do not need is not a smaller bug than one we forget.
EXPECT_RULES='mcp(entwurf-bridge/entwurf_v2) mcp(entwurf-bridge/entwurf_peers) mcp(entwurf-bridge/entwurf_self)'
want "contract: the auto-granted rule set is EXACTLY the three normal-path tools, in order [QK:AGY-EXACT-RULE-SET]" \
  "[ \"$RULES\" = \"$EXPECT_RULES\" ]"
# Named negatives, not just an equality: these two are the tools a future edit is most likely to add
# by reflex ("grant everything the server exposes"), and each would be a grant we never justified —
# inbox_read names a rail native-push does not have, register_native is a manual fallback the normal
# birth path never calls.
for forbidden in entwurf_inbox_read entwurf_register_native; do
  want "contract: '$forbidden' is NOT auto-granted (we do not take permissions the normal path never uses)" \
    "! printf '%s' \"$RULES\" | grep -qF 'mcp(entwurf-bridge/$forbidden)'"
done
has_rule() { python3 -c "
import json,sys
d=json.load(open('$1'))
allow=(d.get('permissions') or {}).get('allow', [])
sys.exit(0 if all(r in allow for r in '''$RULES'''.split()) else 1)"; }

rm -f "$SETTINGS" "$PSTATE" "$STATE" "$GLOBAL"
bash "$BRIDGE" install >/dev/null 2>&1
want "permission: install grants EVERY normal-path rule into permissions.allow" "has_rule '$SETTINGS'"

# TWO state files, TWO schemas, versioned APART. The permission state moved to 2 when its shape
# changed to a rule set; the MCP install-state's layout never moved and must stay 1. Sharing one
# constant makes the version a lie in whichever file did not change — a later reader branching on it
# would be branching on noise, and "the schema bumped" would stop meaning "the shape changed".
want "state schemas are independent: MCP install-state stays at its own version (1) [QK:AGY-SCHEMA-VERSIONS-APART]" \
  "[ \"\$(python3 -c \"import json;print(json.load(open('$STATE'))['schemaVersion'])\")\" = 1 ]"
want "state schemas are independent: permission-state carries the rule-set version (2)" \
  "[ \"\$(python3 -c \"import json;print(json.load(open('$PSTATE'))['schemaVersion'])\")\" = 2 ]"
# The defect this pins (measured 2026-07-27 on a live agy citizen): install granted entwurf_v2 only,
# so entwurf_peers and entwurf_self prompted for a y/n on every call while the doctor reported green.
# A grant for the tool we happen to check first must never stand in for the whole surface.
want "permission: a PARTIAL grant is not reported as configured (agy still prompts on the rest)" \
  "printf '{\"permissions\":{\"allow\":[\"%s\"]}}\n' '$RULE' > '$SETTINGS'; \
   [ \"\$(python3 '$REPO_DIR/scripts/agy-bridge-config.py' permission-doctor '$SETTINGS' | cut -d' ' -f1)\" = partially-configured ]"
bash "$BRIDGE" install >/dev/null 2>&1

# IDEMPOTENCY, and not only of the file: a re-install must not rewrite PROVENANCE either. Re-reading
# the rule we ourselves wrote as "the operator already had it" would strand it forever (the inverse
# would decline to remove it). Installers are re-run on every upgrade, so this path is the norm.
bash "$BRIDGE" install >/dev/null 2>&1
bash "$BRIDGE" install >/dev/null 2>&1
want "permission: re-install is idempotent (every rule appears exactly once)" \
  "[ \"\$(python3 -c \"import json;a=json.load(open('$SETTINGS'))['permissions']['allow'];print(max(a.count(r) for r in '''$RULES'''.split()))\")\" = 1 ]"
want "permission: re-install does NOT re-attribute OUR rules to the operator (provenance is sticky)" \
  "[ \"\$(python3 -c \"import json;e=json.load(open('$PSTATE'))['rulesExistedBefore'];print(any(e.values()))\")\" = False ]"

# Honest inverse after those re-installs: WE created the file and both containers, so nothing of
# ours may survive. (Before the provenance fix, install×2 → uninstall left the rule behind.)
bash "$BRIDGE" uninstall >/dev/null 2>&1
want "permission: uninstall after re-installs still removes everything we created" "[ ! -e '$SETTINGS' ]"
want "permission: uninstall clears the permission state" "[ ! -e '$PSTATE' ]"

# The operator's file: unrelated keys and their OWN rules survive us, coming and going.
printf '{"model":"x","permissions":{"allow":["command(*)"],"deny":["read_file(/etc)"]}}\n' > "$SETTINGS"
bash "$BRIDGE" install >/dev/null 2>&1
want "permission: install preserves the operator's own allow/deny rules" \
  "python3 -c \"import json,sys;p=json.load(open('$SETTINGS'))['permissions'];sys.exit(0 if 'command(*)' in p['allow'] and p['deny']==['read_file(/etc)'] else 1)\""
want "permission: install preserves unrelated settings keys" \
  "[ \"\$(python3 -c \"import json;print(json.load(open('$SETTINGS')).get('model'))\")\" = x ]"
bash "$BRIDGE" uninstall >/dev/null 2>&1
want "permission: uninstall takes back ONLY our rule, leaving the operator's structure intact" \
  "python3 -c \"import json,sys;p=json.load(open('$SETTINGS'))['permissions'];sys.exit(0 if p['allow']==['command(*)'] and p['deny']==['read_file(/etc)'] else 1)\""

# The rules were ALREADY the operator's before we ever installed → never ours to take away. Written
# as the FULL set so that nothing here is ours: provenance is per rule, so a host where the operator
# granted some and we added the rest is the MIXED case, pinned separately below.
python3 -c "import json;json.dump({'permissions':{'allow':'''$RULES'''.split()}},open('$SETTINGS','w'))"
bash "$BRIDGE" install >/dev/null 2>&1
want "permission: an operator's pre-existing rules are recorded as theirs (rulesExistedBefore)" \
  "[ \"\$(python3 -c \"import json;e=json.load(open('$PSTATE'))['rulesExistedBefore'];print(all(e.values()))\")\" = True ]"
bash "$BRIDGE" uninstall >/dev/null 2>&1
want "permission: uninstall does NOT revoke rules the operator already had" "has_rule '$SETTINGS'"

# ── v1 → v2 permission-state migration, from a REAL v1 fixture ───────────────
# A shipped host is mid-migration right now: its permission-state was written by an entwurf that
# granted one rule and recorded `rule`/`ruleExistedBefore`. The release contract is that upgrading
# carries that answer instead of re-capturing it — a re-capture would read the rule WE wrote as the
# operator's and strand it, or read THEIRS as ours and delete it. Prose claimed this; now the gate
# owns it, including a direct uninstall from an unmigrated v1 state.
V1_RULE="$RULE"                      # what a v1 install granted
V1_OTHER="${RULES#* }"; V1_OTHER="${V1_OTHER%% *}"   # second rule: operator-owned in this fixture
V1_NEW="${RULES##* }"                # third rule: nobody has it yet → ours on migration
rm -f "$STATE" "$PSTATE"
python3 -c "import json;json.dump({'permissions':{'allow':['$V1_RULE','$V1_OTHER']}},open('$SETTINGS','w'))"
python3 -c "
import json,os
json.dump({'schemaVersion':1,'managedSettingsPath':os.path.abspath('$SETTINGS'),
           'rule':'$V1_RULE','detectMode':'adopt-regular-file','settingsExistedBefore':True,
           'permissionsExistedBefore':True,'allowExistedBefore':True,'ruleExistedBefore':False,
           'installedAt':'2026-07-26T00:00:18Z'}, open('$PSTATE','w'))"
want "v1→v2: a v1 permission-state uninstalls on its own shape (removes ours, keeps theirs)" \
  "bash '$BRIDGE' uninstall >/dev/null 2>&1 && python3 -c \"import json,sys;a=json.load(open('$SETTINGS'))['permissions']['allow'];sys.exit(0 if a==['$V1_OTHER'] else 1)\""

# Now the migration proper: same v1 fixture, but install (upgrade) runs first.
rm -f "$STATE" "$PSTATE"
python3 -c "import json;json.dump({'permissions':{'allow':['$V1_RULE','$V1_OTHER']}},open('$SETTINGS','w'))"
python3 -c "
import json,os
json.dump({'schemaVersion':1,'managedSettingsPath':os.path.abspath('$SETTINGS'),
           'rule':'$V1_RULE','detectMode':'adopt-regular-file','settingsExistedBefore':True,
           'permissionsExistedBefore':True,'allowExistedBefore':True,'ruleExistedBefore':False,
           'installedAt':'2026-07-26T00:00:18Z'}, open('$PSTATE','w'))"
bash "$BRIDGE" install >/dev/null 2>&1
want "v1→v2: install migrates the state in place (schemaVersion 2, per-rule provenance)" \
  "[ \"\$(python3 -c \"import json;s=json.load(open('$PSTATE'));print(s['schemaVersion']==2 and isinstance(s.get('rulesExistedBefore'),dict))\")\" = True ]"
# The three-way answer, which is the whole point of per-rule provenance:
#   the v1 rule stays OURS (carried, not re-read)  ·  the operator's rule stays THEIRS
#   the newly granted tool becomes OURS
want "v1→v2: provenance is carried per rule (v1 rule ours, operator's rule theirs, new rule ours)" \
  "[ \"\$(python3 -c \"import json;e=json.load(open('$PSTATE'))['rulesExistedBefore'];print(e['$V1_RULE'] is False and e['$V1_OTHER'] is True and e['$V1_NEW'] is False)\")\" = True ]"
bash "$BRIDGE" uninstall >/dev/null 2>&1
want "v1→v2: the migrated inverse takes back only ours and leaves the operator's rule" \
  "python3 -c \"import json,sys;a=json.load(open('$SETTINGS'))['permissions']['allow'];sys.exit(0 if a==['$V1_OTHER'] else 1)\""

# A state shape we cannot read must REFUSE, never fall through to "nothing was theirs" and revoke.
rm -f "$STATE" "$PSTATE"
python3 -c "import json;json.dump({'permissions':{'allow':'''$RULES'''.split()}},open('$SETTINGS','w'))"
python3 -c "
import json,os
json.dump({'schemaVersion':99,'managedSettingsPath':os.path.abspath('$SETTINGS')}, open('$PSTATE','w'))"
want "malformed state: an unknown schemaVersion FAILS the uninstall instead of guessing" \
  "! bash '$BRIDGE' uninstall >/dev/null 2>&1"
want "malformed state: and the operator's rules are still there afterwards (no blind revoke)" \
  "has_rule '$SETTINGS'"
# The specific deletion hazard: a v2 state whose provenance map is EMPTY. Read permissively, every
# rule reads as "not theirs" and the inverse revokes the operator's whole set.
python3 -c "
import json,os
json.dump({'schemaVersion':2,'managedSettingsPath':os.path.abspath('$SETTINGS'),
           'rules':'''$RULES'''.split(),'rulesExistedBefore':{}}, open('$PSTATE','w'))"
want "malformed state: an INCOMPLETE provenance map fails loud (it must not promote their rules to ours)" \
  "! bash '$BRIDGE' uninstall >/dev/null 2>&1"
want "malformed state: the operator's rules survive the incomplete-provenance refusal" \
  "has_rule '$SETTINGS'"

# INSTALL must refuse the same unreadable prior, not silently re-capture over it. A shallow shape
# check (dict? values bool?) passes an EMPTY map — all() of nothing is true — and the reinstall then
# rewrote provenance from disk, which is exactly the re-capture this state file exists to prevent:
# every rule would be recorded as the operator's and the inverse would decline to remove any of it.
python3 -c "
import json,os
json.dump({'schemaVersion':2,'managedSettingsPath':os.path.abspath('$SETTINGS'),
           'rules':'''$RULES'''.split(),'rulesExistedBefore':{}}, open('$PSTATE','w'))"
PRE_S="$(python3 -c "import hashlib;print(hashlib.sha256(open('$SETTINGS','rb').read()).hexdigest())")"
PRE_P="$(python3 -c "import hashlib;print(hashlib.sha256(open('$PSTATE','rb').read()).hexdigest())")"
want "malformed state: INSTALL refuses an unreadable prior instead of re-capturing provenance [QK:AGY-INSTALL-MALFORMED-PRIOR]" \
  "! bash '$BRIDGE' install >/dev/null 2>&1"
want "malformed state: the refused install left settings AND state byte-identical" \
  "[ \"\$(python3 -c \"import hashlib;print(hashlib.sha256(open('$SETTINGS','rb').read()).hexdigest())\")\" = '$PRE_S' ] && \
   [ \"\$(python3 -c \"import hashlib;print(hashlib.sha256(open('$PSTATE','rb').read()).hexdigest())\")\" = '$PRE_P' ]"

# A refusal must leave the world untouched even when the settings file is GONE. The validation used
# to run inside the settings-exists branch, so on this host it was first reached in the closing
# message — AFTER os.remove(state_path). The safety check destroyed the only record of what we owed.
rm -f "$SETTINGS"
want "malformed state: uninstall refuses when the settings file is absent (nothing to guess from) [QK:AGY-UNINSTALL-VALIDATE-FIRST]" \
  "! bash '$BRIDGE' uninstall >/dev/null 2>&1"
want "malformed state: the refused uninstall did NOT delete the permission-state" \
  "[ -f '$PSTATE' ]"

# DOCTOR must not round a corrupt ownership record up to green. Runtime here is perfect — all three
# rules present, agy prompts on nothing — while the record that tells our grants from theirs is
# unreadable. Hard rule 13: runtime truth and ownership truth are separate axes.
python3 -c "import json;json.dump({'permissions':{'allow':'''$RULES'''.split()}},open('$SETTINGS','w'))"
if bash "$BRIDGE" doctor >/dev/null 2>&1; then
  die "corrupt-ownership: doctor must FAIL on an unreadable permission-state even when runtime is fine [QK:AGY-DOCTOR-OWNERSHIP-AXIS]"
fi
ok "permission: doctor FAILS on a path-correct but UNREADABLE permission-state (ownership axis)"
DOC_OUT="$(bash "$BRIDGE" doctor 2>&1 || true)"
want "permission: the corrupt-ownership report names the axis and does not blame runtime" \
  "printf '%s' \"\$DOC_OUT\" | grep -q 'CORRUPT (permission)'"
rm -f "$STATE" "$PSTATE"

# CROSS-LIST scope: broad-most-covering is a statement about the whole file, not about one list.
# A deny of ONE exact tool next to an ask of the server-wide rule is a host where EVERYTHING is
# shadowed; naming the exact hit because `deny` is scanned first would tell the operator their other
# grants still work while agy prompts on all of them.
python3 -c "
import json
json.dump({'permissions':{'allow':'''$RULES'''.split(),
                          'deny':['${RULES##* }'],
                          'ask':['mcp(entwurf-bridge)']}}, open('$SETTINGS','w'))"
want "cross-list shadow: a broad rule in ANY list outranks an exact hit in a higher-precedence list" \
  "[ \"\$(python3 '$REPO_DIR/scripts/agy-bridge-config.py' permission-doctor '$SETTINGS' | cut -d' ' -f2)\" = broad ]"
DOC_OUT="$(bash "$BRIDGE" doctor 2>&1 || true)"
want "cross-list shadow: the report says EVERY call is blocked, not 'other grants still work'" \
  "printf '%s' \"\$DOC_OUT\" | grep -q 'EVERY entwurf tool call'"
rm -f "$STATE" "$PSTATE"

# MIXED provenance — the shape agy's own "always allow" prompt creates, one rule at a time. The
# operator owns one; we add the rest; the inverse must split them exactly, taking back only ours.
rm -f "$STATE" "$PSTATE"
printf '{"permissions":{"allow":["%s"]}}\n' "$RULE" > "$SETTINGS"
bash "$BRIDGE" install >/dev/null 2>&1
want "permission: mixed provenance is recorded per rule (theirs stays theirs, ours stays ours)" \
  "[ \"\$(python3 -c \"import json;e=json.load(open('$PSTATE'))['rulesExistedBefore'];print(e['$RULE'] is True and sum(1 for v in e.values() if v is False)==len(e)-1)\")\" = True ]"
bash "$BRIDGE" uninstall >/dev/null 2>&1
want "permission: uninstall keeps THEIR rule and removes only the ones WE added" \
  "python3 -c \"import json,sys;a=json.load(open('$SETTINGS'))['permissions']['allow'];sys.exit(0 if a==['$RULE'] else 1)\""

# ── K2: TWO adapters, ONE file — element ownership is what keeps them apart ────
# The statusline adapter owns the `statusLine` subtree of this same settings.json; we own our rules
# in `permissions.allow`. Neither may restore a whole-file preimage, or uninstalling one would
# silently revert the other. Both orders, both inverses.
rm -f "$SETTINGS" "$PSTATE" "$SLSTATE"
bash "$STATUSLINE" install >/dev/null 2>&1
bash "$BRIDGE" install >/dev/null 2>&1
want "two-adapters: bridge's grant does not disturb the statusline subtree" \
  "python3 -c \"import json,sys;d=json.load(open('$SETTINGS'));sys.exit(0 if d['statusLine']['command']=='entwurf-agy-statusline' else 1)\""
want "two-adapters: statusline install did not block the grant" "has_rule '$SETTINGS'"
bash "$BRIDGE" uninstall >/dev/null 2>&1
want "two-adapters: uninstalling the bridge leaves the statusline intact (no whole-file preimage)" \
  "python3 -c \"import json,sys;d=json.load(open('$SETTINGS'));sys.exit(0 if d['statusLine']['command']=='entwurf-agy-statusline' else 1)\""
want "two-adapters: uninstalling the bridge removed OUR rule" "! has_rule '$SETTINGS'"

# Reverse order: bridge first, statusline second, uninstall the statusline.
rm -f "$SETTINGS" "$PSTATE" "$SLSTATE"
bash "$BRIDGE" install >/dev/null 2>&1
bash "$STATUSLINE" install >/dev/null 2>&1
bash "$STATUSLINE" uninstall >/dev/null 2>&1
want "two-adapters(reverse): uninstalling the statusline leaves OUR grant intact" "has_rule '$SETTINGS'"
want "two-adapters(reverse): the statusline key is gone" \
  "! python3 -c \"import json,sys;sys.exit(0 if 'statusLine' in json.load(open('$SETTINGS')) else 1)\""

# ── K3: doctor evidence — "why does agy ask me every time?" is never a mystery ──
# A registered server with no grant is a HALF-installed bridge: it works, but stops for a y/n on
# every call. Naming that in a message while exiting 0 would be the same lie in a friendlier voice,
# so the doctor must FAIL on it — for an INSTALLED host. On a host that never installed the bridge
# there is nothing to grant, and that stays a note.
rm -f "$SETTINGS" "$PSTATE" "$SLSTATE"
bash "$BRIDGE" install >/dev/null 2>&1
python3 -c "import json;d=json.load(open('$SETTINGS'));d['permissions'].pop('allow',None);json.dump(d,open('$SETTINGS','w'))"
DOC_OUT="$(bash "$BRIDGE" doctor 2>&1 || true)"
want "permission: doctor names the missing grant (not a silent pass)" \
  "printf '%s' \"\$DOC_OUT\" | grep -q 'DRIFT'"
if bash "$BRIDGE" doctor >/dev/null 2>&1; then die "grant-drift: doctor should FAIL (installed bridge, grant gone)"; fi
ok "permission: doctor EXITS NONZERO on an installed-but-ungranted bridge (a half-install is not green)"

# THE SUBTLE ONE: agy evaluates Deny > Ask > Allow, so an operator rule like mcp(*) in their ask
# list silently OVERRIDES our allow — agy prompts again while our install-state still looks green.
printf '{"permissions":{"allow":["%s"],"ask":["mcp(*)"]}}\n' "$RULE" > "$SETTINGS"
if bash "$BRIDGE" doctor >/dev/null 2>&1; then die "shadow: doctor should FAIL when ask/deny overrides our allow"; fi
ok "permission: doctor FAILS when a higher-precedence ask/deny rule shadows our allow"
DOC_OUT="$(bash "$BRIDGE" doctor 2>&1 || true)"
want "permission: the shadow report names the offending list and rule" \
  "printf '%s' \"\$DOC_OUT\" | grep -q 'SHADOWED'"
want "permission: a BROAD shadow is described as covering EVERY entwurf tool call" \
  "printf '%s' \"\$DOC_OUT\" | grep -q 'EVERY entwurf tool call'"

# SCOPE HONESTY: an EXACT shadow takes one tool, not the surface. Saying "every entwurf tool call is
# blocked" when only entwurf_self is sends the operator hunting a wildcard that is not there. The
# verdict stays red — a granted tool that agy still stops on is not green — but the diagnosis must
# match what agy will actually do.
EXACT_SHADOW="${RULES##* }"   # last rule in the set, shadowed alone
python3 -c "
import json
json.dump({'permissions':{'allow':'''$RULES'''.split(),'ask':['$EXACT_SHADOW']}}, open('$SETTINGS','w'))"
if bash "$BRIDGE" doctor >/dev/null 2>&1; then die "exact-shadow: doctor should FAIL when one of our tools is shadowed"; fi
ok "permission: doctor FAILS when an EXACT rule shadows one granted tool (still not green)"
DOC_OUT="$(bash "$BRIDGE" doctor 2>&1 || true)"
want "permission: an EXACT shadow names that ONE tool and does NOT claim every call is blocked" \
  "printf '%s' \"\$DOC_OUT\" | grep -qF '$EXACT_SHADOW' && printf '%s' \"\$DOC_OUT\" | grep -q 'that ONE tool' && ! printf '%s' \"\$DOC_OUT\" | grep -q 'EVERY entwurf tool call'"

# THE MIRROR OF IT: the same rules that shadow our allow from ask/deny COVER it from allow. An
# operator who granted a broad mcp(*) has already made entwurf_v2 callable — reporting that host as
# "NOT granted, agy prompts on EVERY call" is a false red about a surface that works. It is still
# THEIR rule, not ours, so it is a NOTE (exit 0 + named owner), never a silent pass and never DRIFT.
# The never-installed shape: no permission-state claims ownership here (the owned-drift mirror of
# THIS case — state says we added the rule, rule gone, wildcard covering — is pinned red below).
rm -f "$STATE" "$PSTATE"
for broad in 'mcp(*)' 'mcp(entwurf-bridge)'; do
  printf '{"permissions":{"allow":["%s"]}}\n' "$broad" > "$SETTINGS"
  DOC_OUT="$(bash "$BRIDGE" doctor 2>&1 || true)"
  if ! bash "$BRIDGE" doctor >/dev/null 2>&1; then
    die "covered: doctor should NOT fail when the operator's '$broad' already grants our tool"
  fi
  ok "permission: an operator's broad '$broad' in allow is not reported as drift (no false red)"
  want "permission: the note names '$broad' as the covering rule, and it is NOT called granted-by-us" \
    "printf '%s' \"\$DOC_OUT\" | grep -q 'NOTE' && printf '%s' \"\$DOC_OUT\" | grep -qF '$broad' && ! printf '%s' \"\$DOC_OUT\" | grep -q 'DRIFT'"
  # …and precedence still wins: the same broad rule in deny must override its own allow.
  printf '{"permissions":{"allow":["%s"],"deny":["%s"]}}\n' "$broad" "$broad" > "$SETTINGS"
  if bash "$BRIDGE" doctor >/dev/null 2>&1; then
    die "covered: a deny of '$broad' must still shadow, even though the same rule sits in allow"
  fi
  ok "permission: '$broad' in deny still shadows its own allow (Deny > Allow, not order-of-lists)"
done

# OWNERSHIP BEATS COVERAGE (hard rule 12): our state says WE added the exact rule, the rule is
# gone, and an operator wildcard keeps calls working. Runtime works — but the grant entwurf owns
# (and repairs) vanished, so the verdict stays red with both axes named. This is the exact shape a
# whole-file settings relink (agent-config ensure_link) produces: statusline drifts loudly, and the
# permission half must not be the silent one.
printf '{"permissions":{"allow":[]}}\n' > "$SETTINGS"
bash "$BRIDGE" install >/dev/null 2>&1   # state records ruleExistedBefore=false — the rule is OURS
python3 -c "import json;d=json.load(open('$SETTINGS'));d['permissions']['allow']=['mcp(*)'];json.dump(d,open('$SETTINGS','w'))"
set +e; DOC_OUT="$(bash "$BRIDGE" doctor 2>&1)"; DOC_RC=$?; set -e
want "permission: an operator wildcard does NOT mask drift of the rule WE installed (doctor fails)" "[ '$DOC_RC' -ne 0 ]"
want "permission: the owned-drift report names both axes (our grant gone, their rule covering)" \
  "printf '%s' \"\$DOC_OUT\" | grep -q 'DRIFT' && printf '%s' \"\$DOC_OUT\" | grep -qF 'mcp(*)'"

# …but an operator's OWN pre-existing rules vanishing is not our drift: rulesExistedBefore all true
# means nothing here was ours to lose. Their file, their edit; the wildcard covering it stays a NOTE.
rm -f "$STATE" "$PSTATE"
python3 -c "import json;json.dump({'permissions':{'allow':'''$RULES'''.split()}},open('$SETTINGS','w'))"
bash "$BRIDGE" install >/dev/null 2>&1   # rules pre-existed → recorded as theirs
python3 -c "import json;d=json.load(open('$SETTINGS'));d['permissions']['allow']=['mcp(*)'];json.dump(d,open('$SETTINGS','w'))"
if ! bash "$BRIDGE" doctor >/dev/null 2>&1; then
  die "covered: losing the OPERATOR's own pre-existing rule must not be reported as OUR drift"
fi
ok "permission: an operator's own vanished rule under a covering wildcard stays green (not our element)"

# ── K4: a grant we cannot write FAILS the explicit install (setup degrades it, not us) ──
# A symlinked settings.json is someone else's SSOT (an agent-config link) — never clobber it. But
# refusing to write is not the same as succeeding: the explicit installer must exit nonzero, because
# it registered a server it could not make callable. Tolerance belongs one level up, in setup, where
# agy is optional and must not brick a pi/Claude host.
rm -f "$SETTINGS" "$PSTATE" "$STATE" "$GLOBAL"
printf '{"permissions":{"allow":[]}}\n' > "$SB/foreign-settings.json"
ln -s "$SB/foreign-settings.json" "$SETTINGS"
if bash "$BRIDGE" install >/dev/null 2>&1; then die "grant-symlink: explicit install should FAIL when it cannot grant"; fi
ok "permission: explicit install EXITS NONZERO when the grant cannot be written (no half-install reported as success)"
want "permission: a symlinked settings.json is left untouched (someone else's SSOT)" \
  "! has_rule '$SB/foreign-settings.json'"
want "permission: no permission state is written for a refused symlink" "[ ! -e '$PSTATE' ]"

# …and the SAME failure, seen from setup: NON-FATAL, reason-specific, never silent.
# Detection must be hermetic here exactly as it is in section I: re-mint the fake agy (I tore it
# down at its end) and pin AGY_BIN at it. Unpinned, the wrapper falls back to the host's PATH —
# it finds a real agy on a dev box and degrades honestly, but on a CI runner with no agy it takes
# the skip branch and exits 0 with no WARN. The exit-0 assertion below passes either way; only the
# NOT-GRANTED one can tell a degrade from a skip, which is the whole point of this pair.
printf '#!/usr/bin/env bash\necho fake-agy\n' > "$SB/bin/agy"; chmod +x "$SB/bin/agy"
set +e; OUT="$(AGY_BIN="$SB/bin/agy" bash "$REPO_DIR/run.sh" wire-agy-bridge 2>&1)"; RC=$?; set -e
want "permission(setup): the wrapper keeps setup alive (exit 0) despite the failed grant" "[ '$RC' -eq 0 ]"
want "permission(setup): the wrapper says the bridge is REGISTERED but NOT GRANTED (no silent pass)" \
  "printf '%s' \"\$OUT\" | grep -q 'NOT GRANTED'"
rm -f "$SETTINGS" "$PSTATE" "$STATE" "$GLOBAL" "$SB/bin/agy"

# Corrupt settings.json: same contract — the explicit install fails loud, and says what to repair.
printf 'not json\n' > "$SETTINGS"
if bash "$BRIDGE" install >/dev/null 2>&1; then die "grant-corrupt: explicit install should FAIL on an unparseable settings.json"; fi
ok "permission: explicit install EXITS NONZERO on a corrupt settings.json (repair it, do not guess)"
rm -f "$SETTINGS" "$PSTATE" "$STATE" "$GLOBAL"

# ── K5: a revoke we cannot perform is a FAILED inverse, not a footnote ────────
# Install cleanly, then have the settings file become someone else's SSOT (a symlink) before the
# uninstall. We refuse to write through it — correct — but "uninstalled" over a rule still sitting
# in the operator's settings would be a lie in the one direction that must never lie. It fails, the
# foreign file is untouched, and the permission-state SURVIVES so a retry (or a hand-repair) still
# knows what we owe.
rm -f "$SETTINGS" "$PSTATE" "$STATE" "$GLOBAL"
bash "$BRIDGE" install >/dev/null 2>&1
want "inverse-symlink: precondition — the grant is in place before we break the path" "has_rule '$SETTINGS'"
printf '{"permissions":{"allow":["command(*)"]}}\n' > "$SB/foreign-uninstall.json"
rm -f "$SETTINGS"
ln -s "$SB/foreign-uninstall.json" "$SETTINGS"
if bash "$BRIDGE" uninstall >/dev/null 2>&1; then die "inverse-symlink: uninstall should FAIL when it cannot revoke the grant"; fi
ok "permission: uninstall EXITS NONZERO when the grant cannot be revoked (honest inverse, not a WARN)"
want "inverse-symlink: the foreign settings file is untouched (never written through a symlink)" \
  "python3 -c \"import json,sys;p=json.load(open('$SB/foreign-uninstall.json'))['permissions'];sys.exit(0 if p['allow']==['command(*)'] else 1)\""
want "inverse-symlink: the permission state SURVIVES the failure (a retry still knows what we owe)" \
  "[ -e '$PSTATE' ]"
rm -f "$SETTINGS" "$PSTATE" "$STATE" "$GLOBAL"

# ── ⓪ checkout purity: the working tree is byte-identical (nothing under $REPO) ─
REPO_AFTER="$(cd "$REPO_DIR" && git status --porcelain)"
want "purity: checkout unchanged (0 impurity — all writes stayed in the sandbox HOME+XDG)" \
  "[ \"\$REPO_BEFORE\" = \"\$REPO_AFTER\" ]"

printf '\nsmoke-agy-install-state: %d checks passed\n' "$pass"
