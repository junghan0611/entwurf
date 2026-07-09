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
mkdir -p "$(dirname "$GLOBAL")" "$(dirname "$LEGACY")" "$SB/bin"

# fake stable bin (on PATH) + fake ss (unused by the deterministic path) — fake agy toggled per case.
printf '#!/usr/bin/env bash\necho fake-entwurf-bridge\n' > "$SB/bin/entwurf-bridge"
printf '#!/usr/bin/env bash\nexit 0\n' > "$SB/bin/ss"
chmod +x "$SB/bin/entwurf-bridge" "$SB/bin/ss"
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

# ── ⓪ checkout purity: the working tree is byte-identical (nothing under $REPO) ─
REPO_AFTER="$(cd "$REPO_DIR" && git status --porcelain)"
want "purity: checkout unchanged (0 impurity — all writes stayed in the sandbox HOME+XDG)" \
  "[ \"\$REPO_BEFORE\" = \"\$REPO_AFTER\" ]"

printf '\nsmoke-agy-install-state: %d checks passed\n' "$pass"
