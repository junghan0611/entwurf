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
# This smoke drives register-pi-provider.py, which imports the sibling pi_settings_io module — and
# CPython writes scripts/__pycache__/*.pyc for that import, INSIDE the checkout. The purity cell
# below never caught it because those bytes are gitignored, so `git status --porcelain` stays clean
# while the working tree is not. That difference is invisible here and load-bearing under gate
# qualification, whose snapshot judges tree cleanliness rather than porcelain output. Write no
# bytecode instead of cleaning it up afterwards: a smoke that leaves artifacts and then sweeps them
# is one early `exit` away from leaving them for real.
export PYTHONDONTWRITEBYTECODE=1
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
# authoritative: drop EVERY original PATH dir that carries a real entwurf-bridge. A maintainer
# can have both the managed dev link and the registry package shim; filtering only command -v's
# first hit lets the second one mask the dangling-command cell.
#
# #81: the doctor no longer stops at resolvability — it BOOTS the effective command and requires
# the entwurf MCP tool surface back. So the healthy fake must actually speak MCP: answer the
# `tools/list` frame (id 2) with a tools array carrying entwurf_v2. A fake that only echoed a word
# would now (correctly) read as "resolves but does not serve MCP", which is the NEGATIVE cell
# below — keeping the two fakes distinct is what makes this an A/B rather than a rename.
write_mcp_fake() {   # $1 = path
  cat > "$1" <<'FAKE'
#!/usr/bin/env bash
# minimal MCP stdio server: enough frames for the boot probe, nothing else.
while IFS= read -r line; do
  case "$line" in
    *'"id":1'*) printf '%s\n' '{"jsonrpc":"2.0","id":1,"result":{"protocolVersion":"2024-11-05","capabilities":{},"serverInfo":{"name":"fake-entwurf-bridge","version":"0"}}}' ;;
    *'"id":2'*) printf '%s\n' '{"jsonrpc":"2.0","id":2,"result":{"tools":[{"name":"entwurf_v2"},{"name":"entwurf_self"},{"name":"entwurf_peers"},{"name":"entwurf_inbox_read"},{"name":"entwurf_register_native"},{"name":"entwurf_fresh_call"},{"name":"entwurf_resume_call"}]}}' ;;
  esac
done
FAKE
  chmod +x "$1"
}
# A launcher that RESOLVES and dies on exec — the shape of a relocated package-manager shim whose
# $0-derived target is gone (observed: exit 127 with a "No such file or directory" on stderr).
write_dead_fake() {  # $1 = path
  cat > "$1" <<'FAKE'
#!/usr/bin/env bash
echo "bash: /nonexistent/../global/v11/deadbeef/node_modules/@junghanacs/entwurf/mcp/entwurf-bridge/start.sh: No such file or directory" >&2
exit 127
FAKE
  chmod +x "$1"
}
# A launcher that boots and speaks MCP but is NOT this bridge: it serves entwurf_v2 while missing
# entwurf_self. This is the shape of the observed #81 session (its schema had no entwurf_self) and
# of a stale build or a foreign binary that happens to own the name — a probe keyed on one tool
# would call it healthy, which is why identity is the exact verb SET.
write_stale_fake() {  # $1 = path
  cat > "$1" <<'FAKE'
#!/usr/bin/env bash
while IFS= read -r line; do
  case "$line" in
    *'"id":1'*) printf '%s\n' '{"jsonrpc":"2.0","id":1,"result":{"protocolVersion":"2024-11-05","capabilities":{},"serverInfo":{"name":"stale-bridge","version":"0"}}}' ;;
    *'"id":2'*) printf '%s\n' '{"jsonrpc":"2.0","id":2,"result":{"tools":[{"name":"entwurf_v2"},{"name":"entwurf_peers"},{"name":"entwurf_inbox_read"},{"name":"entwurf_register_native"},{"name":"entwurf_fresh_call"},{"name":"entwurf_resume_call"}]}}' ;;
  esac
done
FAKE
  chmod +x "$1"
}
write_mcp_fake "$SB/bin/entwurf-bridge"
_clean_path=""
while IFS= read -r _dir; do
  [ -n "$_dir" ] || continue
  if [ -e "$_dir/entwurf-bridge" ] || [ -L "$_dir/entwurf-bridge" ]; then
    continue
  fi
  _clean_path="${_clean_path:+$_clean_path:}$_dir"
done < <(printf '%s\n' "$PATH" | tr ':' '\n')
export PATH="$SB/bin:$_clean_path"

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
# The green must be about BOOTING, not about resolving — anchored on the verdict word so a doctor
# that regressed to the resolvability-only ok cannot keep this cell green.
want "doctor(user-only bare): green says the bin BOOTS (#81), not merely resolves" "printf '%s' \"\$OUT\" | grep -q 'and it BOOTS'"

# ── H-merge: the doctor normalizes what PRODUCTION normalizes, not what each FILE holds ──
# resolveProviderConfig merges the two mcpServers maps per-name and normalizes the RESULT once. A
# doctor that normalized each file separately would validate entries production never sees: a
# malformed global entry the project map shadows is gone before pi ever looks, yet the per-file
# doctor throws and calls a healthy session red. Both directions are pinned here.
python3 -c 'import json,sys; json.dump({"entwurfProvider":{"mcpServers":{"entwurf-bridge":{"command":123}}}}, open(sys.argv[1],"w"))' "$GLOBAL"
printf '{"entwurfProvider":{"mcpServers":{"entwurf-bridge":{"command":"entwurf-bridge"}}}}\n' > "$PROJECT"
set +e
OUT="$(doctor 2>&1)"; RC=$?
set -e
want "doctor(invalid global SHADOWED by valid project): green — production never sees the bad entry" "[ '$RC' -eq 0 ]"
want "doctor(invalid global shadowed): EFFECTIVE scope is project" "printf '%s' \"\$OUT\" | grep -q 'EFFECTIVE (project)'"
# An unrelated malformed server in the global map is likewise production's problem only if it
# survives the merge — here the project map does not shadow it, so it MUST stay red.
python3 -c 'import json,sys; json.dump({"entwurfProvider":{"mcpServers":{"entwurf-bridge":{"command":"entwurf-bridge"},"other":{"command":[]}}}}, open(sys.argv[1],"w"))' "$GLOBAL"
printf '{}\n' > "$PROJECT"
if doctor >/dev/null 2>&1; then die "doctor(unshadowed malformed sibling): should FAIL — the merged map is what production normalizes"; fi
ok "doctor(unshadowed malformed sibling): FAILS — an invalid entry that SURVIVES the merge is red"
# The effective entry itself malformed → red regardless of which scope wrote it.
printf '{"entwurfProvider":{"mcpServers":{"entwurf-bridge":{"command":"entwurf-bridge"}}}}\n' > "$GLOBAL"
python3 -c 'import json,sys; json.dump({"entwurfProvider":{"mcpServers":{"entwurf-bridge":{"command":123}}}}, open(sys.argv[1],"w"))' "$PROJECT"
if doctor >/dev/null 2>&1; then die "doctor(effective malformed): should FAIL"; fi
ok "doctor(effective malformed in project): FAILS — shadowing cannot rescue the EFFECTIVE entry"
# restore the H-1 baseline for the cells below
printf '{"entwurfProvider":{"mcpServers":{"entwurf-bridge":{"command":"entwurf-bridge"}}}}\n' > "$GLOBAL"
printf '{}\n' > "$PROJECT"

# ── H-boot: #81 A/B — a bare bin that RESOLVES but does not serve MCP ─────────
# This is the whole defect in one cell: before #81 the doctor printed ok here, and a host in this
# exact state ran Pi ACP turns with NO mcp__entwurf-bridge__* tool at all. PATH/HOME/XDG are the
# sandbox's, so the operator's real launcher is never touched by this A/B.
write_dead_fake "$SB/bin/entwurf-bridge"
# `set -e` is on: a doctor that (correctly) exits non-zero here would kill the smoke before it could
# judge the failure. Fence just the drive, never the assertions — a silently swallowed rc is how a
# negative cell turns into decoration.
set +e
OUT="$(doctor 2>&1)"; RC=$?
set -e
want "[QK:PI-DOCTOR-BOOT-NEGATIVE] doctor(bare resolves, does not boot): FAILS instead of printing ok" "[ '$RC' -ne 0 ]"
want "doctor(bare resolves, does not boot): names the boot failure reason" "printf '%s' \"\$OUT\" | grep -q 'does NOT serve MCP \[exited-before-tools-list\]'"
want "doctor(bare resolves, does not boot): carries the launcher's own stderr" "printf '%s' \"\$OUT\" | grep -q 'No such file or directory'"
# Remediation must NOT be a fix-all: entwurf may not clobber a launcher it does not own, so the
# foreign case has to be named as the operator's repair.
want "doctor(bare resolves, does not boot): refuses to clobber a foreign launcher" "printf '%s' \"\$OUT\" | grep -q 'will not overwrite'"
want "doctor(bare resolves, does not boot): still distinguishes 'resolves' from 'boots'" "printf '%s' \"\$OUT\" | grep -q 'RESOLVES — probing'"
# A bridge that BOOTS and speaks MCP but is not this one — the #81 symptom exactly.
write_stale_fake "$SB/bin/entwurf-bridge"
set +e
OUT="$(doctor 2>&1)"; RC=$?
set -e
want "doctor(boots, wrong verb set): FAILS — booting an MCP server is not being THIS bridge" "[ '$RC' -ne 0 ]"
want "doctor(boots, wrong verb set): names the missing verb (#81 symptom was entwurf_self)" "printf '%s' \"\$OUT\" | grep -q 'missing entwurf_self'"
want "doctor(boots, wrong verb set): reason is the tool-set mismatch, not a boot failure" "printf '%s' \"\$OUT\" | grep -q 'tool-set-mismatch'"

write_mcp_fake "$SB/bin/entwurf-bridge"
OUT="$(doctor)"; RC=$?
want "doctor(after repair): the SAME unchanged doctor goes green once the launcher boots" "[ '$RC' -eq 0 ]"
want "doctor(after repair): green names the exact verb set as the evidence" "printf '%s' \"\$OUT\" | grep -q 'exact entwurf verb set'"

# The review A/B: an unowned/non-bare override shadows the healthy user bridge in production.
# Ownership remains the operator's, but runtime truth cannot become a green note merely because
# entwurf will not overwrite it. Keep this QK cell before the healthy legacy override: a mutant
# that skips all non-bare runtime probes must be attributed to THIS failure, not the later positive.
write_dead_fake "$SB/bin/dead-override"
printf '{"entwurfProvider":{"mcpServers":{"entwurf-bridge":{"command":"entwurf-bridge"}}}}\n' > "$GLOBAL"
python3 -c 'import json,sys; json.dump({"entwurfProvider":{"mcpServers":{"entwurf-bridge":{"command":sys.argv[2],"args":[]}}}}, open(sys.argv[1],"w"))' "$PROJECT" "$SB/bin/dead-override"
set +e
OUT="$(doctor 2>&1)"; RC=$?
set -e
want "[QK:PI-DOCTOR-PROBES-OVERRIDE] doctor(dead unowned override): FAILS runtime independently of ownership" "[ '$RC' -ne 0 ]"
want "doctor(dead unowned override): names the exact invocation failure" "printf '%s' \"\$OUT\" | grep -q 'effective invocation does NOT serve MCP'"

# H-2: project legacy override still gets an independent runtime verdict before its ownership note.
mkdir -p "$(dirname "$LEGACY_CMD")"
write_mcp_fake "$LEGACY_CMD"
python3 -c 'import json,sys; json.dump({"entwurfProvider":{"mcpServers":{"entwurf-bridge":{"command":sys.argv[2]}}}}, open(sys.argv[1],"w"))' "$PROJECT" "$LEGACY_CMD"
OUT="$(doctor)"; RC=$?
want "doctor(project-legacy): exits 0 when the exact override boots" "[ '$RC' -eq 0 ]"
want "doctor(project-legacy): EFFECTIVE is project (shadows user)" "printf '%s' \"\$OUT\" | grep -q 'EFFECTIVE (project)'"
want "doctor(project-legacy): runtime BOOTS before the ownership note" "printf '%s' \"\$OUT\" | grep -q 'configured override BOOTS'"
want "doctor(project-legacy): flags legacy managed path (not adopted)" "printf '%s' \"\$OUT\" | grep -q 'LEGACY managed repo path'"

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
