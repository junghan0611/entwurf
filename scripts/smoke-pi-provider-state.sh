#!/usr/bin/env bash
# smoke-pi-provider-state — regression gate for the pi provider install adapter (#46 Task 2):
# register-pi-provider.py (ownership-classified install/remove, user+project scopes) + the
# read-only doctor-pi-provider.ts (effective shadow view). Runs in an ISOLATED HOME + XDG with a
# fake stable bin and isolated settings files (no real ~/.pi). Asserts:
#   - user install ownership matrix: absent→create+state; managed-legacy(repo start.sh)→bare bin +
#     state(preimage audit, NOT restored) + siblings preserved; managed-current→idempotent;
#     user-override→NOT overwritten, NO state (unowned).
#   - user remove: state-based honest inverse (managed-* → remove OUR key, a legacy repo path is
#     NOT restored; siblings kept; parent tidied); user-override → no state → nothing to undo.
#   - legacy bundle prune (session-bridge/pi-tools-bridge repo path) alongside, user my-own kept.
#   - project scope: NO state; install normalizes the bare bin, remove strips our-managed shapes
#     (bare bin AND legacy repo path), a user override left in place.
#   - doctor: effective = project shadows user; user-only/both-bare → ok green; project-STALE
#     (user bare, project legacy) → effective legacy note (the "doctor green runtime red" guard);
#     state-owned DRIFT → FAIL; bare-but-dangling → FAIL; malformed settings → FAIL; symlink refuse.
#   - checkout stays byte-identical (nothing under $REPO).
# Offline + deterministic (deps: bash + python3 + node --experimental-strip-types).
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REG="$REPO_DIR/scripts/register-pi-provider.py"
DOCTOR="$REPO_DIR/scripts/doctor-pi-provider.ts"

pass=0
ok()   { printf '  ok    %s\n' "$1"; pass=$((pass + 1)); }
die()  { printf 'FAIL: %s\n' "$1" >&2; exit 1; }
want() { eval "$2" && ok "$1" || die "$1"; }

REPO_BEFORE="$(cd "$REPO_DIR" && git status --porcelain)"

SB="$(mktemp -d)"
trap 'rm -rf "$SB"' EXIT
export HOME="$SB/home"
export XDG_DATA_HOME="$SB/xdg"
GLOBAL="$SB/global.json"
PROJECT="$SB/proj/.pi/settings.json"
STATE="$XDG_DATA_HOME/entwurf/pi-provider/install-state.json"
mkdir -p "$SB/proj/.pi" "$SB/bin" "$SB/home"

# A fake repo anchor for the managed-legacy predicate (endswith /entwurf/mcp/entwurf-bridge/start.sh).
FAKE_REPO="$SB/checkout/entwurf"
LEGACY_CMD="$FAKE_REPO/mcp/entwurf-bridge/start.sh"

# fake stable bin on PATH so the bare command RESOLVES in the doctor. Keep THIS fake
# authoritative: drop the dir that holds a REAL entwurf-bridge (this dev host exposes one at
# ~/.local/bin) so the dangling test is not masked by it.
printf '#!/usr/bin/env bash\necho fake-bridge\n' > "$SB/bin/entwurf-bridge"
chmod +x "$SB/bin/entwurf-bridge"
_real_bridge="$(command -v entwurf-bridge 2>/dev/null || true)"
_real_dir="${_real_bridge%/*}"
if [ -n "$_real_dir" ]; then
  PATH="$(printf '%s' "$PATH" | tr ':' '\n' | grep -vFx "$_real_dir" | paste -sd: -)"
fi
export PATH="$SB/bin:$PATH"

reg()    { python3 "$REG" "$@"; }
doctor() { PI_PROVIDER_GLOBAL_SETTINGS="$GLOBAL" PI_PROVIDER_PROJECT_SETTINGS="$PROJECT" PI_PROVIDER_STATE="$STATE" \
             node --experimental-strip-types "$DOCTOR"; }
cmd_of() { python3 -c 'import json,sys
try:
  d=json.load(open(sys.argv[1])); print(d["entwurfProvider"]["mcpServers"]["entwurf-bridge"]["command"])
except Exception: print("<none>")' "$1"; }

# ── A: user install — absent → create + state(ownership=absent) ───────────────
printf '{"defaultProvider":"x"}\n' > "$GLOBAL"
reg install "$GLOBAL" "$FAKE_REPO" --scope user --state "$STATE" >/dev/null
want "user/absent: command is bare stable bin" "[ \"\$(cmd_of '$GLOBAL')\" = entwurf-bridge ]"
want "user/absent: state ownership=absent" \
  "python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))[\"ownership\"])' '$STATE' | grep -qx absent"

# ── B: user install — managed-legacy(repo start.sh) → bare bin + preimage + siblings kept ──
rm -f "$STATE"
python3 -c 'import json,sys; json.dump({"entwurfProvider":{"appendSystemPrompt":False,"skillPlugins":["/p"],"mcpServers":{"entwurf-bridge":{"command":sys.argv[2]}}},"packages":["y"]}, open(sys.argv[1],"w"))' "$GLOBAL" "$LEGACY_CMD"
OUT="$(reg install "$GLOBAL" "$FAKE_REPO" --scope user --state "$STATE")"
want "user/managed-legacy: reported as managed-legacy" "printf '%s' \"\$OUT\" | grep -q 'managed-legacy'"
want "user/managed-legacy: normalized to bare bin" "[ \"\$(cmd_of '$GLOBAL')\" = entwurf-bridge ]"
want "user/managed-legacy: siblings preserved (skillPlugins/appendSystemPrompt)" \
  "python3 -c 'import json,sys; ep=json.load(open(sys.argv[1]))[\"entwurfProvider\"]; sys.exit(0 if ep.get(\"skillPlugins\")==[\"/p\"] and ep.get(\"appendSystemPrompt\") is False else 1)' '$GLOBAL'"
want "user/managed-legacy: state ownership=managed-legacy" \
  "python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))[\"ownership\"])' '$STATE' | grep -qx managed-legacy"
want "user/managed-legacy: preimage records the repo path (audit, not restored)" \
  "python3 -c 'import json,sys; p=json.load(open(sys.argv[1]))[\"preimage\"]; sys.exit(0 if p and p.get(\"command\")==sys.argv[2] else 1)' '$STATE' '$LEGACY_CMD'"
want "user/managed-legacy: timing honesty label emitted" \
  "printf '%s' \"\$OUT\" | grep -q 'existing pi sessions unaffected until restart'"

# ── C: user install — managed-current(bare) → idempotent ──────────────────────
OUT="$(reg install "$GLOBAL" "$FAKE_REPO" --scope user --state "$STATE")"
want "user/managed-current: idempotent (stays bare)" "[ \"\$(cmd_of '$GLOBAL')\" = entwurf-bridge ]"
want "user/managed-current: reported managed-current" "printf '%s' \"\$OUT\" | grep -q 'managed-current'"

# ── D: user install — user-override → NOT overwritten, NO state ───────────────
rm -f "$STATE"
printf '{"entwurfProvider":{"mcpServers":{"entwurf-bridge":{"command":"/my/own/thing"}}}}\n' > "$GLOBAL"
OUT="$(reg install "$GLOBAL" "$FAKE_REPO" --scope user --state "$STATE")"
want "user/override: command left untouched" "[ \"\$(cmd_of '$GLOBAL')\" = /my/own/thing ]"
want "user/override: NO state written (unowned)" "[ ! -f '$STATE' ]"
want "user/override: reported preserved user override" "printf '%s' \"\$OUT\" | grep -qi 'user override'"

# ── E: user remove — state-based honest inverse (key removed, siblings kept) ──
python3 -c 'import json,sys; json.dump({"entwurfProvider":{"skillPlugins":["/p"],"mcpServers":{"entwurf-bridge":{"command":sys.argv[2]}}}}, open(sys.argv[1],"w"))' "$GLOBAL" "$LEGACY_CMD"
reg install "$GLOBAL" "$FAKE_REPO" --scope user --state "$STATE" >/dev/null
reg remove "$GLOBAL" "$FAKE_REPO" --scope user --state "$STATE" >/dev/null
want "user/remove: our key removed (NOT restored to repo path)" "[ \"\$(cmd_of '$GLOBAL')\" = '<none>' ]"
want "user/remove: sibling skillPlugins preserved" \
  "python3 -c 'import json,sys; sys.exit(0 if json.load(open(sys.argv[1]))[\"entwurfProvider\"].get(\"skillPlugins\")==[\"/p\"] else 1)' '$GLOBAL'"
want "user/remove: state removed" "[ ! -f '$STATE' ]"
reg remove "$GLOBAL" "$FAKE_REPO" --scope user --state "$STATE" >/dev/null 2>&1
ok "user/remove: no-state is idempotent (nothing to undo)"

# ── F: legacy bundle prune alongside, user-authored server kept ───────────────
python3 -c 'import json,sys; json.dump({"entwurfProvider":{"mcpServers":{"entwurf-bridge":{"command":sys.argv[2]},"session-bridge":{"command":sys.argv[3]},"my-own":{"command":"/custom"}}}}, open(sys.argv[1],"w"))' "$GLOBAL" "$LEGACY_CMD" "$FAKE_REPO/mcp/session-bridge/start.sh"
reg install "$GLOBAL" "$FAKE_REPO" --scope user --state "$STATE" >/dev/null
want "legacy-prune: session-bridge removed" \
  "python3 -c 'import json,sys; sys.exit(0 if \"session-bridge\" not in json.load(open(sys.argv[1]))[\"entwurfProvider\"][\"mcpServers\"] else 1)' '$GLOBAL'"
want "legacy-prune: user-authored my-own kept" \
  "python3 -c 'import json,sys; sys.exit(0 if \"my-own\" in json.load(open(sys.argv[1]))[\"entwurfProvider\"][\"mcpServers\"] else 1)' '$GLOBAL'"
reg remove "$GLOBAL" "$FAKE_REPO" --scope user --state "$STATE" >/dev/null; rm -f "$STATE"

# ── G: project scope — NO state; install normalizes, remove strips managed shapes ──
python3 -c 'import json,sys; json.dump({"entwurfProvider":{"mcpServers":{"entwurf-bridge":{"command":sys.argv[2]}}}}, open(sys.argv[1],"w"))' "$PROJECT" "$LEGACY_CMD"
reg install "$PROJECT" "$FAKE_REPO" --scope project >/dev/null
want "project/install: normalized to bare bin" "[ \"\$(cmd_of '$PROJECT')\" = entwurf-bridge ]"
want "project/install: NO user-scope state created" "[ ! -f '$STATE' ]"
reg remove "$PROJECT" "$FAKE_REPO" --scope project >/dev/null
want "project/remove: strips the bare bin (our-managed)" "[ \"\$(cmd_of '$PROJECT')\" = '<none>' ]"

# ── H: doctor — effective shadow view + verdicts ──────────────────────────────
# H-1: user-only bare → effective user, ok green
printf '{"entwurfProvider":{"mcpServers":{"entwurf-bridge":{"command":"entwurf-bridge"}}}}\n' > "$GLOBAL"
printf '{}\n' > "$PROJECT"; rm -f "$STATE"
OUT="$(doctor)"; RC=$?
want "doctor(user-only bare): exits 0" "[ '$RC' -eq 0 ]"
want "doctor(user-only bare): ok — bare bin resolves" "printf '%s' \"\$OUT\" | grep -q 'bare stable bin'"

# H-2: project STALE (user bare, project legacy) → effective=project=legacy note (green-runtime-red guard)
printf '{"entwurfProvider":{"mcpServers":{"entwurf-bridge":{"command":"entwurf-bridge"}}}}\n' > "$GLOBAL"
python3 -c 'import json,sys; json.dump({"entwurfProvider":{"mcpServers":{"entwurf-bridge":{"command":sys.argv[2]}}}}, open(sys.argv[1],"w"))' "$PROJECT" "$LEGACY_CMD"
OUT="$(doctor)"; RC=$?
want "doctor(project-stale): exits 0 (honest note, not a crash)" "[ '$RC' -eq 0 ]"
want "doctor(project-stale): EFFECTIVE is project (shadows user)" "printf '%s' \"\$OUT\" | grep -q 'EFFECTIVE (project)'"
want "doctor(project-stale): flags legacy managed path (not adopted)" "printf '%s' \"\$OUT\" | grep -q 'LEGACY managed repo path'"

# H-3: state-owned DRIFT → FAIL (state says managed but effective is foreign)
printf '{"entwurfProvider":{"mcpServers":{"entwurf-bridge":{"command":"/foreign/thing"}}}}\n' > "$GLOBAL"
printf '{}\n' > "$PROJECT"
python3 -c 'import json,sys; json.dump({"schemaVersion":1,"managedSettingsPath":sys.argv[1],"scope":"user","ownership":"managed-legacy","command":"entwurf-bridge","preimage":None}, open(sys.argv[2],"w"))' "$GLOBAL" "$STATE"
if doctor >/dev/null 2>&1; then die "doctor(drift): should FAIL (state owns but effective drifted)"; fi
ok "doctor(drift): FAILS on state-owned + effective-drifted"
rm -f "$STATE"

# H-4: bare-but-dangling (bin not on PATH) → FAIL
printf '{"entwurfProvider":{"mcpServers":{"entwurf-bridge":{"command":"entwurf-bridge"}}}}\n' > "$GLOBAL"
printf '{}\n' > "$PROJECT"
mv "$SB/bin/entwurf-bridge" "$SB/bin/entwurf-bridge.hidden"
if doctor >/dev/null 2>&1; then die "doctor(dangling): should FAIL (bare bin not resolvable)"; fi
ok "doctor(dangling): FAILS when the bare bin does not resolve"
mv "$SB/bin/entwurf-bridge.hidden" "$SB/bin/entwurf-bridge"

# H-5: malformed settings → FAIL (SSOT read throws)
printf 'not json{{{' > "$GLOBAL"; printf '{}\n' > "$PROJECT"
if doctor >/dev/null 2>&1; then die "doctor(malformed): should FAIL"; fi
ok "doctor(malformed): FAILS on malformed settings (SSOT read throws)"

# H-6: none configured → honest '?' note, exits 0
printf '{}\n' > "$GLOBAL"; printf '{}\n' > "$PROJECT"
OUT="$(doctor)"; RC=$?
want "doctor(none): exits 0" "[ '$RC' -eq 0 ]"
want "doctor(none): honest never-installed '?' note" "printf '%s' \"\$OUT\" | grep -q 'never installed'"

# ── I: symlink target → install REFUSES ───────────────────────────────────────
printf '{}\n' > "$SB/real.json"; rm -f "$GLOBAL"; ln -s "$SB/real.json" "$GLOBAL"
if reg install "$GLOBAL" "$FAKE_REPO" --scope user --state "$STATE" >/dev/null 2>&1; then die "symlink: install should REFUSE"; fi
ok "symlink: install refused (someone else's SSOT)"
rm -f "$GLOBAL"

# ── checkout purity ───────────────────────────────────────────────────────────
REPO_AFTER="$(cd "$REPO_DIR" && git status --porcelain)"
want "purity: checkout unchanged (all writes stayed in the sandbox HOME+XDG)" \
  "[ \"\$REPO_BEFORE\" = \"\$REPO_AFTER\" ]"

printf '\nsmoke-pi-provider-state: %d checks passed\n' "$pass"
