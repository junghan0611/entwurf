#!/usr/bin/env bash
# smoke-agy-statusline-state — regression gate for the agy statusLine install adapter (#46 Task
# 1). Runs install → doctor → uninstall in an ISOLATED HOME + XDG_DATA_HOME with a fake stable
# bin (entwurf-agy-statusline) + fake `pgrep` (no real ~/.gemini, no real agy). Asserts:
#   - adopt a regular file: statusLine subtree OWNED WHOLE ({type:custom, command:bare bin,
#     enabled:true}), UNRELATED settings keys (model/permissions/…) preserved, state written with
#     the STABLE command (never a repo/checkout path), prior subtree captured as preimage.
#   - doctor STATIC clean + LIVE SKIP with no agy; LIVE consistent (not overclaimed) with a fake agy.
#   - state-drift (state present, statusLine changed away OR removed from existing settings) → doctor FAILS.
#   - uninstall honest-inverse: statusLine preimage restored, unrelated keys survive, state removed.
#   - SYMLINK target → install REFUSES + writes NO state (someone else's SSOT).
#   - DANGLING SYMLINK (departed owner) → install REFUSES the same, NO state, link left intact.
#   - DANGLING command (bin not on PATH) → doctor FAILS (the stable-bin resolvability gate).
#   - NOT-OURS (statusLine still the prior/agent-config command, no state) → doctor is an honest
#     "never installed" note, NOT a pass-in-disguise and NOT a hard fail.
#   - CREATE-NEW → uninstall removes the file it created.
#   - SETUP INTEGRATION: the wire-agy-statusline wrapper — agy absent → honest skip + NO state;
#     agy present + regular → idempotent install + state; agy present + symlink/corrupt →
#     NON-FATAL WARN + continue (exit 0, reason-specific, no clobber, no state).
#   - checkout stays byte-identical (nothing written under $REPO).
# Offline + deterministic (deps: bash + python3).
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BRIDGE="$REPO_DIR/scripts/agy-statusline-bridge.sh"

pass=0
ok()   { printf '  ok    %s\n' "$1"; pass=$((pass + 1)); }
die()  { printf 'FAIL: %s\n' "$1" >&2; exit 1; }
want() { eval "$2" && ok "$1" || die "$1"; }

REPO_BEFORE="$(cd "$REPO_DIR" && git status --porcelain)"

SB="$(mktemp -d)"
trap 'rm -rf "$SB"' EXIT
export HOME="$SB/home"
export XDG_DATA_HOME="$SB/xdg"
SET="$HOME/.gemini/antigravity-cli/settings.json"
STATE="$XDG_DATA_HOME/entwurf/agy-statusline/install-state.json"
mkdir -p "$(dirname "$SET")" "$SB/bin"

# fake stable bin (on PATH) — the renderer the statusLine command resolves to.
printf '#!/usr/bin/env bash\necho fake-agy-statusline\n' > "$SB/bin/entwurf-agy-statusline"
chmod +x "$SB/bin/entwurf-agy-statusline"
# Keep THIS fake authoritative: drop the dir holding a REAL entwurf-agy-statusline (a dev host
# that ran setup exposes one at ~/.local/bin) so the dangling-command test is not masked by it.
_real_sl="$(command -v entwurf-agy-statusline 2>/dev/null || true)"
_real_sl_dir="${_real_sl%/*}"
if [ -n "$_real_sl_dir" ]; then
  PATH="$(printf '%s' "$PATH" | tr ':' '\n' | grep -vFx "$_real_sl_dir" | paste -sd: -)"
fi
export PATH="$SB/bin:$PATH"
export AGY_SETTINGS_CONFIG="$SET"

fake_agy() { # install/remove a fake `pgrep` that reports (or not) a live agy
  if [ "$1" = "on" ]; then
    printf '#!/usr/bin/env bash\n[ "$2" = agy ] && { echo 4242; exit 0; }\nexit 1\n' > "$SB/bin/pgrep"
  else
    printf '#!/usr/bin/env bash\nexit 1\n' > "$SB/bin/pgrep"
  fi
  chmod +x "$SB/bin/pgrep"
}
fake_agy off

# The prior (agent-config) statusLine we must capture + restore, alongside unrelated keys.
PRIOR='"/home/junghan/repos/gh/agent-config/antigravity/statusline.sh"'
write_settings() { # $1 = statusLine command (or "" to omit statusLine)
  if [ -z "$1" ]; then
    printf '{\n  "model": "Gemini 3.1 Pro (Low)",\n  "permissions": { "allow": ["mcp(*)"] }\n}\n' > "$SET"
  else
    printf '{\n  "model": "Gemini 3.1 Pro (Low)",\n  "permissions": { "allow": ["mcp(*)"] },\n  "statusLine": { "type": "custom", "command": %s, "enabled": true }\n}\n' "$1" > "$SET"
  fi
}

# ── NOT-OURS: statusLine still the prior command, no state → doctor note, not a fail ──
write_settings "$PRIOR"
DOC_OUT="$(bash "$BRIDGE" doctor)"; DOC_RC=$?
want "not-ours: doctor exits 0 (statusLine present but not ours is not a hard fail)" "[ '$DOC_RC' -eq 0 ]"
want "not-ours: doctor says NOT entwurf-owned (honest, not a pass)" "printf '%s' \"\$DOC_OUT\" | grep -q 'NOT entwurf-owned'"
want "not-ours: doctor names the '?' never-installed case" "printf '%s' \"\$DOC_OUT\" | grep -q 'never installed'"

# ── A: adopt a regular file — own the subtree WHOLE + preserve unrelated + capture preimage ──
bash "$BRIDGE" install >/dev/null
want "install: statusLine command is our stable bin" \
  "python3 -c 'import json,sys; d=json.load(open(sys.argv[1])); sys.exit(0 if d[\"statusLine\"][\"command\"]==\"entwurf-agy-statusline\" else 1)' '$SET'"
want "install: statusLine subtree owned whole (type=custom, enabled=true)" \
  "python3 -c 'import json,sys; s=json.load(open(sys.argv[1]))[\"statusLine\"]; sys.exit(0 if s[\"type\"]==\"custom\" and s[\"enabled\"] is True else 1)' '$SET'"
want "install: unrelated keys preserved (model + permissions)" \
  "python3 -c 'import json,sys; d=json.load(open(sys.argv[1])); sys.exit(0 if d.get(\"model\") and d.get(\"permissions\") else 1)' '$SET'"
want "install: state written under XDG" "[ -f '$STATE' ]"
want "install: state records the STABLE command (not a repo/checkout path)" \
  "python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))[\"command\"])' '$STATE' | grep -qx entwurf-agy-statusline"
want "install: settings has NO repo path in statusLine" "! grep -q '$REPO_DIR' '$SET'"
want "install: preimage captured the prior (agent-config) subtree" \
  "python3 -c 'import json,sys; p=json.load(open(sys.argv[1]))[\"preimage\"]; sys.exit(0 if p and p.get(\"command\")==\"/home/junghan/repos/gh/agent-config/antigravity/statusline.sh\" else 1)' '$STATE'"

# ── B: doctor — static clean, live SKIP (no agy), state-evidence confirms ──
DOC_OUT="$(bash "$BRIDGE" doctor)"; DOC_RC=$?
want "doctor(no-agy): exits 0 (static clean)" "[ '$DOC_RC' -eq 0 ]"
want "doctor(no-agy): configured → resolvable" "printf '%s' \"\$DOC_OUT\" | grep -q \"configured → 'entwurf-agy-statusline' (resolvable)\""
want "doctor(no-agy): live tier is an honest SKIP" "printf '%s' \"\$DOC_OUT\" | grep -q 'live: SKIP'"
want "doctor(no-agy): SKIP is not disguised as a pass" "! printf '%s' \"\$DOC_OUT\" | grep -q 'consistent with runtime wiring'"
want "doctor(installed): state-evidence confirms still configured" \
  "printf '%s' \"\$DOC_OUT\" | grep -q 'still configure entwurf-agy-statusline'"

# ── C: doctor with a fake agy present → live is CONSISTENT (honest, not overclaimed) ──
fake_agy on
DOC_OUT="$(bash "$BRIDGE" doctor)"; DOC_RC=$?
want "doctor(agy-live): exits 0" "[ '$DOC_RC' -eq 0 ]"
want "doctor(agy-live): live says consistent-with-wiring (not SKIP)" \
  "printf '%s' \"\$DOC_OUT\" | grep -q 'consistent with runtime wiring'"
want "doctor(agy-live): does NOT overclaim statusline-read as proven" \
  "printf '%s' \"\$DOC_OUT\" | grep -q 'statusline read NOT proven'"
fake_agy off

# ── C2 (drift): install-state present but statusLine changed away → doctor FAILS ──
python3 -c 'import json,sys; p=sys.argv[1]; d=json.load(open(p)); d["statusLine"]={"type":"custom","command":"someone-elses","enabled":True}; json.dump(d,open(p,"w"))' "$SET"
if bash "$BRIDGE" doctor >/dev/null 2>&1; then die "drift: doctor should FAIL (state present, statusLine changed)"; fi
ok "drift: doctor FAILS on state-present + statusLine-changed (installed-then-loosened)"
bash "$BRIDGE" install >/dev/null   # restore our command
want "drift: re-install restores our command" \
  "python3 -c 'import json,sys; sys.exit(0 if json.load(open(sys.argv[1]))[\"statusLine\"][\"command\"]==\"entwurf-agy-statusline\" else 1)' '$SET'"

# ── C2b (drift): settings file exists but statusLine was removed → FAIL, NOT orphan auto-clean ──
python3 -c 'import json,sys; p=sys.argv[1]; d=json.load(open(p)); d.pop("statusLine", None); json.dump(d,open(p,"w"))' "$SET"
if bash "$BRIDGE" doctor >/dev/null 2>&1; then die "drift-absent-key: doctor should FAIL (state present, settings exists, statusLine removed)"; fi
ok "drift-absent-key: doctor FAILS on state-present + settings-exists + statusLine-removed"
want "drift-absent-key: state is NOT auto-cleaned" "[ -f '$STATE' ]"
bash "$BRIDGE" install >/dev/null   # restore our command/state for the orphan case
want "drift-absent-key: re-install restores our command" \
  "python3 -c 'import json,sys; sys.exit(0 if json.load(open(sys.argv[1]))[\"statusLine\"][\"command\"]==\"entwurf-agy-statusline\" else 1)' '$SET'"

# ── C3 (ORPHANED): install-state present but managed config is completely ABSENT → Auto-clean ──
rm -f "$SET"
DOC_OUT="$(bash "$BRIDGE" doctor 2>&1)"; DOC_RC=$?
want "orphan: doctor exits 0 when config is completely absent (HOME wiped)" "[ '$DOC_RC' -eq 0 ]"
want "orphan: doctor logs ORPHANED and auto-cleans" "printf '%s' \"\$DOC_OUT\" | grep -q 'ORPHANED'"
want "orphan: state file is removed automatically" "[ ! -f '$STATE' ]"
bash "$BRIDGE" uninstall >/dev/null  # clear the drift-polluted preimage before the honest-inverse check


# ── D: uninstall — honest inverse (FRESH install so preimage is the true prior, not C2's drift) ──
write_settings "$PRIOR"
bash "$BRIDGE" install >/dev/null
bash "$BRIDGE" uninstall >/dev/null
want "uninstall: statusLine restored to the prior (agent-config) command" \
  "python3 -c 'import json,sys; sys.exit(0 if json.load(open(sys.argv[1]))[\"statusLine\"][\"command\"]==\"/home/junghan/repos/gh/agent-config/antigravity/statusline.sh\" else 1)' '$SET'"
want "uninstall: unrelated keys survived (model)" \
  "python3 -c 'import json,sys; sys.exit(0 if json.load(open(sys.argv[1])).get(\"model\") else 1)' '$SET'"
want "uninstall: state file removed" "[ ! -f '$STATE' ]"

# ── E: SYMLINK target → install REFUSES + writes NO state ──
rm -f "$SET"
printf '{"model":"x"}\n' > "$SB/real_settings.json"
ln -s "$SB/real_settings.json" "$SET"
if bash "$BRIDGE" install >/dev/null 2>&1; then die "symlink: install should have REFUSED"; fi
ok "symlink: install refused (nonzero exit)"
want "symlink: NO state written on refusal" "[ ! -f '$STATE' ]"
want "symlink: the linked SSOT was NOT clobbered (no statusLine written into it)" \
  "python3 -c 'import json,sys; d=json.load(open(sys.argv[1])); sys.exit(0 if \"statusLine\" not in d else 1)' '$SB/real_settings.json'"
rm -f "$SET"

# ── E2: DANGLING SYMLINK (departed owner) → install REFUSES + NO state, link intact ──
DEPARTED="$SB/departed-owner/settings.json"   # target does NOT exist (departed owner)
ln -s "$DEPARTED" "$SET"
want "dangling-symlink: precondition — link is dangling (target absent)" "[ -L '$SET' ] && [ ! -e '$SET' ]"
set +e; OUT="$(bash "$BRIDGE" install 2>&1)"; RC=$?; set -e
want "dangling-symlink: install exits nonzero (refused)" "[ '$RC' -ne 0 ]"
want "dangling-symlink: refusal is the SYMLINK reason (not invalid-json / other)" \
  "printf '%s' \"\$OUT\" | grep -qi 'refused (symlink)'"
want "dangling-symlink: NO state written" "[ ! -f '$STATE' ]"
want "dangling-symlink: link NOT followed — departed target still absent" "[ ! -e '$DEPARTED' ]"
want "dangling-symlink: the dangling link left intact (specimen, not silently removed)" "[ -L '$SET' ]"
rm -f "$SET"

# ── F: DANGLING command (bin not on PATH) → doctor FAILS ──
write_settings ""      # start clean
bash "$BRIDGE" install >/dev/null
mv "$SB/bin/entwurf-agy-statusline" "$SB/bin/entwurf-agy-statusline.hidden"   # bin no longer resolvable
if bash "$BRIDGE" doctor >/dev/null 2>&1; then die "dangling-cmd: doctor should FAIL (our command not resolvable)"; fi
ok "dangling-cmd: doctor FAILS when our stable bin is not on PATH (resolvability gate)"
mv "$SB/bin/entwurf-agy-statusline.hidden" "$SB/bin/entwurf-agy-statusline"
bash "$BRIDGE" uninstall >/dev/null

# ── G: CREATE-NEW → uninstall removes the file it created ──
rm -f "$SET" "$STATE"
bash "$BRIDGE" install >/dev/null
want "create-new: file created" "[ -f '$SET' ]"
want "create-new: state detectMode is created-new" \
  "python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))[\"detectMode\"])' '$STATE' | grep -qx created-new"
bash "$BRIDGE" uninstall >/dev/null
want "create-new: uninstall removed the file it created (nothing else remained)" "[ ! -f '$SET' ]"
want "create-new: state removed" "[ ! -f '$STATE' ]"

# ── H: uninstall with no state is idempotent (a note, not a failure) ──
bash "$BRIDGE" uninstall >/dev/null 2>&1
ok "idempotent: uninstall with no state exits 0 (nothing to undo)"

# ── I: setup integration — wire-agy-statusline (detection-gated, NON-FATAL) ──
rm -f "$SET" "$STATE"
printf '#!/usr/bin/env bash\necho fake-agy\n' > "$SB/bin/agy"; chmod +x "$SB/bin/agy"

# I-1: agy ABSENT → honest skip, no state, exit 0
set +e; OUT="$(AGY_BIN="$SB/no-such-agy" bash "$REPO_DIR/run.sh" wire-agy-statusline 2>&1)"; RC=$?; set -e
want "wire(no-agy): exits 0 (non-fatal skip)" "[ '$RC' -eq 0 ]"
want "wire(no-agy): honest skip message" "printf '%s' \"\$OUT\" | grep -q 'skipping agy statusLine wiring'"
want "wire(no-agy): NO state written" "[ ! -f '$STATE' ]"

# I-2: agy PRESENT + regular settings → idempotent install + state, exit 0
write_settings "$PRIOR"
set +e; OUT="$(AGY_BIN="$SB/bin/agy" bash "$REPO_DIR/run.sh" wire-agy-statusline 2>&1)"; RC=$?; set -e
want "wire(agy+regular): exits 0" "[ '$RC' -eq 0 ]"
want "wire(agy+regular): statusLine now our command" \
  "python3 -c 'import json,sys; sys.exit(0 if json.load(open(sys.argv[1]))[\"statusLine\"][\"command\"]==\"entwurf-agy-statusline\" else 1)' '$SET'"
want "wire(agy+regular): state written" "[ -f '$STATE' ]"
set +e; OUT="$(AGY_BIN="$SB/bin/agy" bash "$REPO_DIR/run.sh" wire-agy-statusline 2>&1)"; RC=$?; set -e
want "wire(agy+regular, re-run): idempotent exit 0" "[ '$RC' -eq 0 ]"
bash "$BRIDGE" uninstall >/dev/null; rm -f "$SET"

# I-3: agy PRESENT + SYMLINK settings → NON-FATAL WARN + continue (exit 0), no clobber, no state
printf '{"model":"x"}\n' > "$SB/real_wire_set.json"
ln -s "$SB/real_wire_set.json" "$SET"
set +e; OUT="$(AGY_BIN="$SB/bin/agy" bash "$REPO_DIR/run.sh" wire-agy-statusline 2>&1)"; RC=$?; set -e
want "wire(agy+symlink): exits 0 (NON-FATAL — setup not bricked)" "[ '$RC' -eq 0 ]"
want "wire(agy+symlink): reason-specific WARN names the symlink" "printf '%s' \"\$OUT\" | grep -qi 'symlink'"
want "wire(agy+symlink): linked SSOT NOT clobbered" \
  "python3 -c 'import json,sys; d=json.load(open(sys.argv[1])); sys.exit(0 if \"statusLine\" not in d else 1)' '$SB/real_wire_set.json'"
want "wire(agy+symlink): NO state written" "[ ! -f '$STATE' ]"
rm -f "$SET"

# I-4: agy PRESENT + CORRUPT settings (invalid JSON) → NON-FATAL WARN + continue
printf 'not json{{{' > "$SET"
set +e; OUT="$(AGY_BIN="$SB/bin/agy" bash "$REPO_DIR/run.sh" wire-agy-statusline 2>&1)"; RC=$?; set -e
want "wire(agy+corrupt): exits 0 (NON-FATAL)" "[ '$RC' -eq 0 ]"
want "wire(agy+corrupt): reason-specific WARN flags invalid JSON" "printf '%s' \"\$OUT\" | grep -qi 'invalid JSON'"
want "wire(agy+corrupt): NO state written" "[ ! -f '$STATE' ]"
rm -f "$SET" "$SB/bin/agy"

# ── checkout purity: the working tree is byte-identical (nothing under $REPO) ──
# ── RE-INSTALL PROVENANCE: an installer is re-run on every upgrade ────────────
# The preimage answers "what was here before US" — a fact about a moment that has already passed.
# Re-capturing it on each install would record OUR OWN previous subtree as the operator's, and the
# honest inverse would then faithfully restore us: uninstall leaves behind the very thing it exists
# to remove. Measured before the fix: install×2 → uninstall left statusLine in the file.
rm -f "$SET" "$STATE"
printf '{"model":"x"}\n' > "$SET"
bash "$BRIDGE" install >/dev/null 2>&1
bash "$BRIDGE" install >/dev/null 2>&1
bash "$BRIDGE" install >/dev/null 2>&1
want "re-install: provenance stays the FIRST install's (preimage still null, not our own subtree)" \
  "python3 -c \"import json,sys;sys.exit(0 if json.load(open('$STATE'))['preimage'] is None else 1)\""
bash "$BRIDGE" uninstall >/dev/null 2>&1
want "re-install: uninstall after install×3 still removes our statusLine (no self-restore)" \
  "! python3 -c \"import json,sys;sys.exit(0 if 'statusLine' in json.load(open('$SET')) else 1)\""
want "re-install: the operator's unrelated keys survive the whole cycle" \
  "[ \"\$(python3 -c \"import json;print(json.load(open('$SET')).get('model'))\")\" = x ]"

REPO_AFTER="$(cd "$REPO_DIR" && git status --porcelain)"
want "purity: checkout unchanged (all writes stayed in the sandbox HOME+XDG)" \
  "[ \"\$REPO_BEFORE\" = \"\$REPO_AFTER\" ]"

# ── FOREIGN TARGET: state describes a settings file this host does not read ───────────
# The recorded file is perfectly configured — it is just not OURS. A doctor that only inspects the
# recorded path blesses a host it owns nothing on, and the damage here is specific: the LIVE
# statusLine has no recorded preimage, so uninstall would DROP the key instead of restoring the
# operator's own command. This exact shape was produced on a real host by a verification run that
# isolated HOME but SHARED XDG_DATA_HOME — sandbox settings, real state. Isolation must move HOME
# and XDG_DATA_HOME together.
bash "$BRIDGE" install >/dev/null   # the uninstall cases above left no state; re-own this host first
FOREIGN_SET="$SB/foreign-settings.json"
cp "$SET" "$FOREIGN_SET"
python3 -c "
import json,sys
p=sys.argv[1]; d=json.load(open(p)); d['managedSettingsPath']=sys.argv[2]
json.dump(d, open(p,'w'))" "$STATE" "$FOREIGN_SET"
set +e; FT_OUT="$(bash "$BRIDGE" doctor 2>&1)"; FT_RC=$?; set -e
want "foreign-target: doctor FAILS when install-state manages settings this host does not read" "[ '$FT_RC' -ne 0 ]"
want "foreign-target: the report names both the recorded and the live settings path" \
  "printf '%s' \"\$FT_OUT\" | grep -q 'FOREIGN TARGET' && printf '%s' \"\$FT_OUT\" | grep -qF '$FOREIGN_SET' && printf '%s' \"\$FT_OUT\" | grep -qF '$SET'"
want "foreign-target: it names the real damage — the live statusLine has no recorded preimage" \
  "printf '%s' \"\$FT_OUT\" | grep -qi 'preimage'"
want "foreign-target: neither the foreign settings nor the state is auto-deleted" "[ -f '$FOREIGN_SET' ] && [ -f '$STATE' ]"
rm -f "$FOREIGN_SET"

# A present state with invalid JSON or no managed target is corrupt evidence, not "no evidence".
# The doctor must fail loud instead of parsing to an empty string and skipping the ownership check.
printf 'not-json{{{' > "$STATE"
set +e; FT_OUT="$(bash "$BRIDGE" doctor 2>&1)"; FT_RC=$?; set -e
want "corrupt-state: doctor FAILS on unreadable install-state" "[ '$FT_RC' -ne 0 ]"
want "corrupt-state: report names CORRUPT instead of silently skipping ownership" \
  "printf '%s' \"\$FT_OUT\" | grep -q 'state: CORRUPT'"

# A RELATIVE managed path is corrupt too — install records absolute paths only, and resolving a
# relative one against the doctor's cwd could bless whatever directory it happens to run from.
printf '{"managedSettingsPath":".gemini/antigravity-cli/settings.json"}' > "$STATE"
set +e; FT_OUT="$(bash "$BRIDGE" doctor 2>&1)"; FT_RC=$?; set -e
want "corrupt-state: a relative managedSettingsPath is CORRUPT, never resolved against the doctor's cwd" \
  "[ '$FT_RC' -ne 0 ] && printf '%s' \"\$FT_OUT\" | grep -q 'state: CORRUPT'"

printf '\nsmoke-agy-statusline-state: %d checks passed\n' "$pass"
