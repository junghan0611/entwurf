#!/usr/bin/env bash
# smoke-agy-install-state — regression gate for the agy MCP install adapter (봉인 8). Runs the
# install → doctor → uninstall lifecycle in an ISOLATED HOME + XDG_DATA_HOME with a fake stable
# bin + fake `pgrep`/`ss` (no real ~/.gemini, no real agy). Asserts:
#   - adopt a regular file: entwurf-bridge registered, UNRELATED servers preserved, state written
#     with the STABLE command (never a repo/git path).
#   - doctor STATIC clean + LIVE SKIP with no agy; LIVE PASS with a fake agy present.
#   - uninstall honest-inverse: unrelated servers survive, entwurf-bridge + state removed.
#   - SYMLINK target → install REFUSES + writes NO state (someone else's SSOT).
#   - DANGLING command → doctor FAILS (the oracle lesson, structurally reproduced).
#   - CREATE-NEW → uninstall removes the file it created.
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
GEM_DOC="$HOME/.gemini/antigravity-cli/mcp_config.json"
GEM_OBS="$HOME/.gemini/config/mcp_config.json"
STATE="$XDG_DATA_HOME/entwurf/agy-bridge/install-state.json"
mkdir -p "$(dirname "$GEM_DOC")" "$(dirname "$GEM_OBS")" "$SB/bin"

# fake stable bin (on PATH) + fake ss (unused by the deterministic path) — fake agy toggled per case.
printf '#!/usr/bin/env bash\necho fake-entwurf-bridge\n' > "$SB/bin/entwurf-bridge"
printf '#!/usr/bin/env bash\nexit 0\n' > "$SB/bin/ss"
chmod +x "$SB/bin/entwurf-bridge" "$SB/bin/ss"
export PATH="$SB/bin:$PATH"
export AGY_MCP_CONFIG="$GEM_DOC"
export AGY_MCP_CONFIG_ALT="$GEM_OBS"

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
printf '{\n  "mcpServers": { "other": { "command": "keepme" } }\n}\n' > "$GEM_DOC"
bash "$BRIDGE" install >/dev/null
want "install: entwurf-bridge registered" "grep -q '\"entwurf-bridge\"' '$GEM_DOC'"
want "install: unrelated server preserved" "grep -q '\"other\"' '$GEM_DOC'"
want "install: state file written under XDG" "[ -f '$STATE' ]"
want "install: state records the STABLE command (not a repo/git path)" \
  "python3 -c 'import json,sys; d=json.load(open(sys.argv[1])); print(d[\"command\"])' '$STATE' | grep -qx entwurf-bridge"
want "install: state preimage null (key was absent)" \
  "python3 -c 'import json,sys; d=json.load(open(sys.argv[1])); sys.exit(0 if d[\"preimage\"] is None else 1)' '$STATE'"
want "install: managed config command is the stable bin, NOT a repo path" \
  "! grep -q '$REPO_DIR' '$GEM_DOC'"

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
python3 -c 'import json,sys; p=sys.argv[1]; d=json.load(open(p)); d["mcpServers"].pop("entwurf-bridge",None); json.dump(d,open(p,"w"))' "$GEM_DOC"
if bash "$BRIDGE" doctor >/dev/null 2>&1; then die "drift: doctor should FAIL (state present, key removed)"; fi
ok "drift: doctor FAILS on state-present + key-removed (installed-then-loosened ≠ never installed)"
bash "$BRIDGE" install >/dev/null   # restore so the honest-inverse uninstall below has a key to remove
want "drift: re-install restores the key" "grep -q '\"entwurf-bridge\"' '$GEM_DOC'"

# ── D: uninstall — honest inverse ─────────────────────────────────────────────
bash "$BRIDGE" uninstall >/dev/null
want "uninstall: entwurf-bridge removed" "! grep -q '\"entwurf-bridge\"' '$GEM_DOC'"
want "uninstall: unrelated server survived" "grep -q '\"other\"' '$GEM_DOC'"
want "uninstall: state file removed" "[ ! -f '$STATE' ]"

# ── E: SYMLINK target → install REFUSES + writes NO state ──────────────────────
rm -f "$GEM_DOC"
printf '{"mcpServers":{}}\n' > "$SB/real_config.json"
ln -s "$SB/real_config.json" "$GEM_DOC"
if bash "$BRIDGE" install >/dev/null 2>&1; then die "symlink: install should have REFUSED"; fi
ok "symlink: install refused (nonzero exit)"
want "symlink: NO state written on refusal" "[ ! -f '$STATE' ]"
want "symlink: the linked SSOT was NOT clobbered" "python3 -c 'import json,sys; d=json.load(open(sys.argv[1])); sys.exit(0 if d[\"mcpServers\"]=={} else 1)' '$SB/real_config.json'"
rm -f "$GEM_DOC"

# ── F: DANGLING command → doctor FAILS ────────────────────────────────────────
printf '{"mcpServers":{"entwurf-bridge":{"command":"/nonexistent/dangling/start.sh"}}}\n' > "$GEM_OBS"
if bash "$BRIDGE" doctor >/dev/null 2>&1; then die "dangling: doctor should have FAILED"; fi
ok "dangling: doctor failed (nonzero exit) on a dangling command"
rm -f "$GEM_OBS"

# ── G: CREATE-NEW → uninstall removes the created file ────────────────────────
bash "$BRIDGE" install >/dev/null
want "create-new: file created" "[ -f '$GEM_DOC' ]"
want "create-new: state detectMode is created-new" \
  "python3 -c 'import json,sys; d=json.load(open(sys.argv[1])); print(d[\"detectMode\"])' '$STATE' | grep -qx created-new"
bash "$BRIDGE" uninstall >/dev/null
want "create-new: uninstall removed the file it created (empty)" "[ ! -f '$GEM_DOC' ]"
want "create-new: state removed" "[ ! -f '$STATE' ]"

# ── H: uninstall with no state is idempotent (a note, not a failure) ──────────
bash "$BRIDGE" uninstall >/dev/null 2>&1
ok "idempotent: uninstall with no state exits 0 (nothing to undo)"

# ── ⓪ checkout purity: the working tree is byte-identical (nothing under $REPO) ─
REPO_AFTER="$(cd "$REPO_DIR" && git status --porcelain)"
want "purity: checkout unchanged (0 impurity — all writes stayed in the sandbox HOME+XDG)" \
  "[ \"\$REPO_BEFORE\" = \"\$REPO_AFTER\" ]"

printf '\nsmoke-agy-install-state: %d checks passed\n' "$pass"
