#!/usr/bin/env bash
# smoke-copilot-statusline-state — hermetic install/doctor/inverse contract for
# the Copilot custom-footer settings adapter. No Copilot process or model turn.
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
export COPILOT_SETTINGS_CONFIG="$HOME/.copilot/settings.json"
export COPILOT_STATUSLINE_COMMAND="entwurf-copilot-statusline"
STATE="$XDG_DATA_HOME/entwurf/copilot-statusline/install-state.json"
mkdir -p "$(dirname "$COPILOT_SETTINGS_CONFIG")" "$SB/bin"
printf '#!/usr/bin/env bash\necho fake-copilot-statusline\n' > "$SB/bin/$COPILOT_STATUSLINE_COMMAND"
chmod +x "$SB/bin/$COPILOT_STATUSLINE_COMMAND"

_clean_path=""
while IFS= read -r dir; do
  [ -n "$dir" ] || continue
  [ -e "$dir/$COPILOT_STATUSLINE_COMMAND" ] || [ -L "$dir/$COPILOT_STATUSLINE_COMMAND" ] && continue
  _clean_path="${_clean_path:+$_clean_path:}$dir"
done < <(printf '%s\n' "$PATH" | tr ':' '\n')
export PATH="$SB/bin:$_clean_path"

write_settings() {
  printf '{\n  "enabledPlugins": { "other@marketplace": true },\n  "footer": { "showCustom": true, "showDirectory": true },\n  "statusLine": { "command": "manual-statusline" }\n}\n' > "$COPILOT_SETTINGS_CONFIG"
}
json() { python3 - "$COPILOT_SETTINGS_CONFIG" "$@" <<'PY'
import json, sys
settings = json.load(open(sys.argv[1]))
mode = sys.argv[2]
if mode == "installed":
    assert settings["statusLine"] == {"command": "entwurf-copilot-statusline"}
    assert settings["footer"] == {"showCustom": True, "showDirectory": True}
    assert settings["enabledPlugins"] == {"other@marketplace": True}
elif mode == "manual":
    assert settings["statusLine"] == {"command": "manual-statusline"}
    assert settings["footer"] == {"showCustom": True, "showDirectory": True}
elif mode == "created":
    assert settings == {"statusLine": {"command": "entwurf-copilot-statusline"}, "footer": {"showCustom": True}}
else:
    raise AssertionError(mode)
PY
}

# Existing matching/manual settings are adopted, not treated as a fresh file.
write_settings
"$RUN" doctor-copilot-statusline >/dev/null
want "unowned manual settings doctor is an honest note" "[ $? -eq 0 ]"
"$RUN" install-copilot-statusline >/dev/null
json installed
want "install adopts regular settings and preserves unrelated keys" "[ $? -eq 0 ]"
want "install writes state" "[ -f '$STATE' ]"
python3 - "$STATE" <<'PY'
import json, sys
state = json.load(open(sys.argv[1]))
assert state["statusLinePreimage"] == {"command": "manual-statusline"}
assert state["showCustomPreimage"] is True
PY
ok "first install captures manual statusLine preimage"
"$RUN" install-copilot-statusline >/dev/null
"$RUN" uninstall-copilot-statusline >/dev/null
json manual
want "reinstall keeps the first preimage for inverse" "[ $? -eq 0 ] && [ ! -f '$STATE' ]"

# The live-host shape is already our command with no state: adopt that exact preimage too.
write_settings
python3 -c 'import json,sys; p=sys.argv[1]; d=json.load(open(p)); d["statusLine"]={"command":"entwurf-copilot-statusline"}; json.dump(d,open(p,"w"))' "$COPILOT_SETTINGS_CONFIG"
"$RUN" install-copilot-statusline >/dev/null
python3 - "$STATE" <<'PY'
import json, sys
state = json.load(open(sys.argv[1]))
assert state["statusLinePreimage"] == {"command": "entwurf-copilot-statusline"}
assert state["showCustomPreimage"] is True
PY
"$RUN" uninstall-copilot-statusline >/dev/null
json installed
want "matching manual Copilot config is adopted and restored unchanged" "[ $? -eq 0 ] && [ ! -f '$STATE' ]"

# State turns a later setting drift into a red doctor rather than a silent pass.
write_settings
"$RUN" install-copilot-statusline >/dev/null
python3 -c 'import json,sys; p=sys.argv[1]; d=json.load(open(p)); d["footer"]["showCustom"]=False; json.dump(d,open(p,"w"))' "$COPILOT_SETTINGS_CONFIG"
if "$RUN" doctor-copilot-statusline >/dev/null 2>&1; then die "custom-disabled doctor should fail"; fi
ok "state-present custom-disabled footer is red"
"$RUN" install-copilot-statusline >/dev/null
python3 -c 'import json,sys; p=sys.argv[1]; d=json.load(open(p)); d["statusLine"]={"command":"other"}; json.dump(d,open(p,"w"))' "$COPILOT_SETTINGS_CONFIG"
if "$RUN" doctor-copilot-statusline >/dev/null 2>&1; then die "statusLine drift doctor should fail"; fi
ok "state-present statusLine drift is red"
"$RUN" install-copilot-statusline >/dev/null

# A stable-bin command that stops resolving is red without touching settings.
rm -f "$SB/bin/$COPILOT_STATUSLINE_COMMAND"
if "$RUN" doctor-copilot-statusline >/dev/null 2>&1; then die "dangling command doctor should fail"; fi
ok "dangling bare command is red"
printf '#!/usr/bin/env bash\nexit 0\n' > "$SB/bin/$COPILOT_STATUSLINE_COMMAND"
chmod +x "$SB/bin/$COPILOT_STATUSLINE_COMMAND"
"$RUN" uninstall-copilot-statusline >/dev/null
json manual
want "inverse restores manual settings after drift repairs" "[ $? -eq 0 ] && [ ! -f '$STATE' ]"

# Created-new is removed only when it still contains only the adapter's keys.
rm -f "$COPILOT_SETTINGS_CONFIG"
"$RUN" install-copilot-statusline >/dev/null
json created
"$RUN" uninstall-copilot-statusline >/dev/null
want "created-new empty settings file is removed by inverse" "[ ! -e '$COPILOT_SETTINGS_CONFIG' ] && [ ! -f '$STATE' ]"

# A foreign/corrupt settings file is never adopted or given a state record.
printf '{"footer":{}}\n' > "$SB/foreign.json"
ln -s "$SB/foreign.json" "$COPILOT_SETTINGS_CONFIG"
if "$RUN" install-copilot-statusline >/dev/null 2>&1; then die "symlink install should refuse"; fi
ok "symlink settings are refused"
want "symlink refusal leaves foreign settings and no state" "! grep -q statusLine '$SB/foreign.json' && [ ! -f '$STATE' ]"
rm -f "$COPILOT_SETTINGS_CONFIG"
printf 'not-json{{' > "$COPILOT_SETTINGS_CONFIG"
if "$RUN" install-copilot-statusline >/dev/null 2>&1; then die "corrupt install should fail"; fi
ok "corrupt settings fail loud"
want "corrupt refusal writes no state" "[ ! -f '$STATE' ]"

REPO_AFTER="$(cd "$REPO_DIR" && git status --porcelain)"
[ "$REPO_BEFORE" = "$REPO_AFTER" ] || die "smoke changed the checkout"
printf '\nsmoke-copilot-statusline-state: %d checks passed\n' "$pass"
