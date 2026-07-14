#!/usr/bin/env bash
# smoke-agy-hooks-state — regression gate for Antigravity PreInvocation birth imprint wiring.
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BRIDGE="$REPO_DIR/scripts/agy-hooks-bridge.sh"
IMPRINT="$REPO_DIR/scripts/agy-imprint.ts"

pass=0
ok() { printf '  ok    %s\n' "$1"; pass=$((pass + 1)); }
die() { printf 'FAIL: %s\n' "$1" >&2; exit 1; }
want() { eval "$2" && ok "$1" || die "$1"; }

REPO_BEFORE="$(cd "$REPO_DIR" && git status --porcelain)"
SB="$(mktemp -d)"
trap 'rm -rf "$SB"' EXIT
export HOME="$SB/home"
export XDG_DATA_HOME="$SB/xdg"
export XDG_STATE_HOME="$SB/state"
HOOKS="$HOME/.gemini/config/plugins/entwurf-agy-imprint/hooks.json"
LEGACY="$HOME/.gemini/antigravity-cli/hooks.json"
LEGACY_PLUGIN="$HOME/.gemini/config/plugins/entwurf-probe/hooks.json"
LEGACY_PLUGIN_JSON="$(dirname "$LEGACY_PLUGIN")/plugin.json"
PLUGIN_JSON="$(dirname "$HOOKS")/plugin.json"
STATE="$XDG_DATA_HOME/entwurf/agy-hooks/install-state.json"
mkdir -p "$(dirname "$HOOKS")" "$(dirname "$LEGACY")" "$(dirname "$LEGACY_PLUGIN")" "$SB/bin"
printf '#!/usr/bin/env bash\necho {\\"injectSteps\\":[]}\n' > "$SB/bin/entwurf-agy-imprint"
chmod +x "$SB/bin/entwurf-agy-imprint"
export PATH="$SB/bin:$PATH"

printf '{"keep-me":{"PreInvocation":[{"type":"command","command":"echo keep"}]}}\n' > "$HOOKS"
printf '{"agy-birth-probe":{"PreInvocation":[{"type":"command","command":"cat > /tmp/old"}]},"entwurf-agy-imprint":{"PreInvocation":[{"type":"command","command":"old-imprint"}]},"keep-legacy":{"PreInvocation":[{"type":"command","command":"echo legacy"}]}}\n' > "$LEGACY"
printf '{"name":"entwurf-probe","version":"1.0.0"}\n' > "$LEGACY_PLUGIN_JSON"
printf '{"agy-birth-probe":{"PreInvocation":[{"type":"command","command":"cat > /tmp/plugin-old"}]}}\n' > "$LEGACY_PLUGIN"
bash "$BRIDGE" install >/dev/null
want "install: imprint hook configured" \
  "python3 -c 'import json,sys; d=json.load(open(sys.argv[1])); sys.exit(0 if d[\"entwurf-agy-imprint\"][\"PreInvocation\"][0][\"command\"]==\"entwurf-agy-imprint\" else 1)' '$HOOKS'"
want "install: unrelated hook preserved" \
  "python3 -c 'import json,sys; sys.exit(0 if \"keep-me\" in json.load(open(sys.argv[1])) else 1)' '$HOOKS'"
want "install: state written" "[ -f '$STATE' ]"
want "install: plugin.json materialized" "[ -f '$PLUGIN_JSON' ]"
want "install: plugin.json uses non-probe name" "grep -q 'entwurf-agy-imprint' '$PLUGIN_JSON'"
want "install: stable command recorded" \
  "python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))[\"command\"])' '$STATE' | grep -qx entwurf-agy-imprint"
want "install: legacy top-level agy-birth-probe removed" \
  "python3 -c 'import json,sys; sys.exit(0 if \"agy-birth-probe\" not in json.load(open(sys.argv[1])) else 1)' '$LEGACY'"
want "install: legacy top-level duplicate imprint removed" \
  "python3 -c 'import json,sys; sys.exit(0 if \"entwurf-agy-imprint\" not in json.load(open(sys.argv[1])) else 1)' '$LEGACY'"
want "install: unrelated legacy hook preserved" \
  "python3 -c 'import json,sys; sys.exit(0 if \"keep-legacy\" in json.load(open(sys.argv[1])) else 1)' '$LEGACY'"
want "install: old entwurf-probe plugin hook file removed" "[ ! -e '$LEGACY_PLUGIN' ]"
want "install: old entwurf-probe plugin.json removed" "[ ! -e '$LEGACY_PLUGIN_JSON' ]"

DOC_OUT="$(bash "$BRIDGE" doctor)"; DOC_RC=$?
want "doctor: exits 0" "[ '$DOC_RC' -eq 0 ]"
want "doctor: command resolvable" "printf '%s' \"\$DOC_OUT\" | grep -q \"configured → 'entwurf-agy-imprint' (resolvable)\""
want "doctor: state confirms configured" "printf '%s' \"\$DOC_OUT\" | grep -q 'still configure entwurf-agy-imprint'"
want "doctor: legacy top-level guard reports clean" "printf '%s' \"\$DOC_OUT\" | grep -q 'legacy top-level: present but carries no entwurf/probe hook keys'"
want "doctor: old plugin guard reports absent" "printf '%s' \"\$DOC_OUT\" | grep -q 'legacy plugin(entwurf-probe): absent'"

python3 -c 'import json,sys; p=sys.argv[1]; d=json.load(open(p)); d["agy-birth-probe"]={"PreInvocation":[{"type":"command","command":"old"}]}; json.dump(d,open(p,"w"))' "$LEGACY"
if bash "$BRIDGE" doctor >/dev/null 2>&1; then die "legacy-drift: doctor should FAIL when top-level carries old probe key"; fi
ok "legacy-drift: doctor FAILS on top-level agy-birth-probe"
bash "$BRIDGE" install >/dev/null
want "legacy-drift: re-install cleans top-level again" \
  "python3 -c 'import json,sys; sys.exit(0 if \"agy-birth-probe\" not in json.load(open(sys.argv[1])) else 1)' '$LEGACY'"
mkdir -p "$(dirname "$LEGACY_PLUGIN")"
printf '{"agy-birth-probe":{"PreInvocation":[{"type":"command","command":"old-plugin"}]}}\n' > "$LEGACY_PLUGIN"
if bash "$BRIDGE" doctor >/dev/null 2>&1; then die "legacy-plugin-drift: doctor should FAIL when old plugin carries probe key"; fi
ok "legacy-plugin-drift: doctor FAILS on old entwurf-probe plugin key"
bash "$BRIDGE" install >/dev/null
want "legacy-plugin-drift: re-install removes old plugin hook file" "[ ! -e '$LEGACY_PLUGIN' ]"

python3 -c 'import json,sys; p=sys.argv[1]; d=json.load(open(p)); d.pop("entwurf-agy-imprint", None); json.dump(d,open(p,"w"))' "$HOOKS"
if bash "$BRIDGE" doctor >/dev/null 2>&1; then die "drift: doctor should FAIL when state hook is removed"; fi
ok "drift: doctor FAILS on state-present + hook-removed"
bash "$BRIDGE" install >/dev/null

rm -f "$HOOKS"
DOC_OUT="$(bash "$BRIDGE" doctor 2>&1)"; DOC_RC=$?
want "orphan: doctor exits 0 when hooks file is absent" "[ '$DOC_RC' -eq 0 ]"
want "orphan: doctor logs ORPHANED" "printf '%s' \"\$DOC_OUT\" | grep -q ORPHANED"
want "orphan: state removed" "[ ! -f '$STATE' ]"

printf '{"keep-me":{"PreInvocation":[{"type":"command","command":"echo keep"}]}}\n' > "$HOOKS"
bash "$BRIDGE" install >/dev/null
bash "$BRIDGE" uninstall >/dev/null
want "uninstall: imprint hook removed" \
  "python3 -c 'import json,sys; sys.exit(0 if \"entwurf-agy-imprint\" not in json.load(open(sys.argv[1])) else 1)' '$HOOKS'"
want "uninstall: unrelated hook survived" \
  "python3 -c 'import json,sys; sys.exit(0 if \"keep-me\" in json.load(open(sys.argv[1])) else 1)' '$HOOKS'"
want "uninstall: state removed" "[ ! -f '$STATE' ]"

rm -f "$HOOKS"
printf '{}\n' > "$SB/real_hooks.json"
ln -s "$SB/real_hooks.json" "$HOOKS"
if bash "$BRIDGE" install >/dev/null 2>&1; then die "symlink: install should REFUSE"; fi
ok "symlink: install refused"
want "symlink: no state written" "[ ! -f '$STATE' ]"
rm -f "$HOOKS"

# Direct imprint contract: stdout neutral, create then attach by conversationId, no duplicate.
AGENT="$SB/agent"
payload='{"conversationId":"conv-smoke","workspacePaths":["/work/smoke"],"transcriptPath":"/tmp/t.jsonl","modelName":"gemini-smoke"}'
printf '%s' "$payload" | PI_CODING_AGENT_DIR="$AGENT" node --experimental-strip-types "$IMPRINT" > "$SB/out1"
want "imprint: stdout is neutral PreInvocation response" "grep -qx '{\"injectSteps\":\[\]}' '$SB/out1'"
want "imprint: creates one antigravity record" \
  "[ \$(find '$AGENT/meta-sessions' -name '*.meta.json' | wc -l) -eq 1 ] && grep -q '\"backend\": \"antigravity\"' '$AGENT/meta-sessions'/*.meta.json"
printf '%s' "$payload" | PI_CODING_AGENT_DIR="$AGENT" node --experimental-strip-types "$IMPRINT" >/dev/null
want "imprint: second run attaches, no duplicate" "[ \$(find '$AGENT/meta-sessions' -name '*.meta.json' | wc -l) -eq 1 ]"
printf '%s' '{"workspacePaths":["/work/smoke"]}' | PI_CODING_AGENT_DIR="$SB/agent2" node --experimental-strip-types "$IMPRINT" >/dev/null
want "imprint: missing conversationId writes no record" "[ ! -d '$SB/agent2/meta-sessions' ] || [ \$(find '$SB/agent2/meta-sessions' -name '*.meta.json' | wc -l) -eq 0 ]"

# ── RE-INSTALL PROVENANCE: an installer is re-run on every upgrade ────────────
# The preimage answers "what was here before US". Re-capturing it on each install would record OUR
# OWN previous hook as the operator's, and the honest inverse would then restore us — uninstall
# leaving behind the very thing it exists to remove. Same bug class, all three agy adapters.
rm -f "$HOOKS" "$STATE"
mkdir -p "$(dirname "$HOOKS")"
printf '{"other-plugin":{"PreInvocation":[{"type":"command","command":"keepme"}]}}\n' > "$HOOKS"
bash "$BRIDGE" install >/dev/null 2>&1
bash "$BRIDGE" install >/dev/null 2>&1
bash "$BRIDGE" install >/dev/null 2>&1
want "re-install: provenance stays the FIRST install's (preimage still null, not our own hook)" \
  "python3 -c \"import json,sys;sys.exit(0 if json.load(open('$STATE'))['preimage'] is None else 1)\""
bash "$BRIDGE" uninstall >/dev/null 2>&1
want "re-install: uninstall after install×3 still removes our hook (no self-restore)" \
  "! python3 -c \"import json,sys;sys.exit(0 if 'entwurf-agy-imprint' in json.load(open('$HOOKS')) else 1)\""
want "re-install: an unrelated plugin's hook survives the whole cycle" \
  "python3 -c \"import json,sys;sys.exit(0 if 'other-plugin' in json.load(open('$HOOKS')) else 1)\""

REPO_AFTER="$(cd "$REPO_DIR" && git status --porcelain)"
want "purity: checkout unchanged (all writes stayed in sandbox HOME+XDG)" "[ \"$REPO_BEFORE\" = \"$REPO_AFTER\" ]"

# ── FOREIGN TARGET: state describes a hooks file this host does not load ──────────────
# The recorded hooks file is perfectly configured — it is just not the one agy loads here. A doctor
# that only inspects the recorded path calls that green while the LIVE PreInvocation hook is
# unowned: uninstall would leave it in place, and its provenance is unrecorded. A real host reached
# this shape via a verification run that isolated HOME but SHARED XDG_DATA_HOME. Isolation must move
# HOME and XDG_DATA_HOME together.
bash "$BRIDGE" install >/dev/null   # re-own this host (earlier cases may have torn the state down)
FOREIGN_HOOKS="$SB/foreign-hooks.json"
cp "$HOOKS" "$FOREIGN_HOOKS"
python3 -c "
import json,sys
p=sys.argv[1]; d=json.load(open(p)); d['managedHooksPath']=sys.argv[2]
json.dump(d, open(p,'w'))" "$STATE" "$FOREIGN_HOOKS"
set +e; FT_OUT="$(bash "$BRIDGE" doctor 2>&1)"; FT_RC=$?; set -e
want "foreign-target: doctor FAILS when install-state manages hooks this host does not load" "[ '$FT_RC' -ne 0 ]"
want "foreign-target: the report names both the recorded and the live hooks path" \
  "printf '%s' \"\$FT_OUT\" | grep -q 'FOREIGN TARGET' && printf '%s' \"\$FT_OUT\" | grep -qF '$FOREIGN_HOOKS' && printf '%s' \"\$FT_OUT\" | grep -qF '$HOOKS'"
want "foreign-target: it names the real damage — the live hook is unowned" \
  "printf '%s' \"\$FT_OUT\" | grep -qi 'unowned'"
want "foreign-target: neither the foreign hooks file nor the state is auto-deleted" "[ -f '$FOREIGN_HOOKS' ] && [ -f '$STATE' ]"
rm -f "$FOREIGN_HOOKS"

printf '\nsmoke-agy-hooks-state: %d checks passed\n' "$pass"
