#!/usr/bin/env bash
# smoke-meta-install-state — deterministic Phase-2 gate for stateful install /
# uninstall / doctor hardening. Offline: no real claude CLI, no user config.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/.." && pwd)"
export REPO
STATE="$REPO/scripts/meta-bridge-state.py"
STORE_DOCTOR="$REPO/scripts/meta-bridge-store-doctor.ts"
# shellcheck source=scripts/meta-bridge-hook-log.sh
source "$REPO/scripts/meta-bridge-hook-log.sh"

command -v python3 >/dev/null || { echo "FAIL: python3 not on PATH"; exit 1; }
command -v node >/dev/null || { echo "FAIL: node not on PATH"; exit 1; }

fail=0
ok()  { echo "  ok    $*"; }
bad() { echo "  FAIL  $*"; fail=1; }

TMP="$(mktemp -d -t psa-meta-install-state.XXXXXX)"
cleanup() { rm -rf "$TMP"; }
trap cleanup EXIT

# ⓪ 설치 경계 봉쇄 (2026-07-03 `?` 사건의 구조적 소멸): source origin(repo/npm)과
# live artifact(XDG)를 분리한다. dev clone과 installed 소비자는 같은 user-scope
# install이고, 둘 다 marketplace source를 XDG data dir에 조립한다 — 절대 checkout
# 내부가 아니다. 이 smoke의 어떤 단계도 repo 안에 live source를 만들지 않음을
# top/bottom fingerprint로 감싸 증명하고, 아래 fake-install로 "install → XDG"를 직접 건다.
# present/absent만 보면 present→present 덮어쓰기를 놓치므로 내용 해시까지 비교한다.
asm_fingerprint() {
  if [ -e "$REPO/pi/meta-bridge/.assembled" ]; then (cd "$REPO/pi/meta-bridge/.assembled" && find . -type f -exec sha256sum {} + 2>/dev/null | sort); else echo ABSENT; fi
}
REPO_ASM_FP_START="$(asm_fingerprint)"

# 실제 meta-bridge-install.sh를 격리된 HOME + XDG_DATA_HOME + fake claude로 돌려
# live marketplace source가 XDG 아래에 조립되고 `plugin marketplace add`가 그 XDG
# 경로를 받는지 직접 증명한다(오프라인: 실제 claude 없음).
INS_HOME="$TMP/ins-home"; INS_XDG="$TMP/ins-xdg"; INS_BIN="$TMP/ins-bin"
mkdir -p "$INS_HOME/.claude" "$INS_BIN"
echo '{}' > "$INS_HOME/.claude/settings.json"
echo '{}' > "$INS_HOME/.claude.json"
INS_LOG="$TMP/ins-claude.log"
cat > "$INS_BIN/claude" <<'SH'
#!/usr/bin/env bash
printf '%s\n' "$*" >> "$FAKE_CLAUDE_LOG"
case "$1${2:+ $2}" in
  "plugin list") printf '%s\n' "entwurf-meta-receive@meta-bridge-local" "  Status: enabled" ;;
  "mcp get")     printf '%s\n' "Scope: User config" "Status: Connected" ;;
  *) : ;;
esac
exit 0
SH
chmod +x "$INS_BIN/claude"
if env HOME="$INS_HOME" CLAUDE_CONFIG_DIR="$INS_HOME/.claude" XDG_DATA_HOME="$INS_XDG" \
       FAKE_CLAUDE_LOG="$INS_LOG" PATH="$INS_BIN:$PATH" \
       bash "$REPO/scripts/meta-bridge-install.sh" >/dev/null 2>&1; then
  if [ -e "$INS_XDG/entwurf/meta-bridge/.assembled/entwurf-meta-receive" ]; then ok "dev install assembles the live marketplace source under XDG (not the checkout)"; else bad "dev install did not assemble under XDG_DATA_HOME"; fi
  MKT_ADD="$(grep '^plugin marketplace add ' "$INS_LOG" | head -1 || true)"
  if printf '%s' "$MKT_ADD" | grep -Fq "$INS_XDG/entwurf/meta-bridge/.assembled"; then ok "claude plugin marketplace add received the XDG artifact path"; else bad "marketplace add did not point at XDG: $MKT_ADD"; fi
else
  bad "real install-meta-bridge failed under isolated HOME/XDG/fake-claude:"$'\n'"$(cat "$INS_LOG" 2>/dev/null)"
fi

export HOME="$TMP/home"
# The wrapper-uninstall below removes ${XDG_DATA_HOME:-$HOME/.local/share}/entwurf/
# meta-bridge. Pin XDG_DATA_HOME into the sandbox too, so a developer who runs this
# smoke with XDG_DATA_HOME set in their shell can never have their real live
# artifact removed — the boundary that keeps check/smoke off global user wiring.
export XDG_DATA_HOME="$TMP/xdg"
export CLAUDE_CONFIG_DIR="$HOME/.claude"
mkdir -p "$CLAUDE_CONFIG_DIR"
# Canonical-suffix asm: production install ALWAYS records a path ending in
# …/entwurf/meta-bridge/.assembled, and state.py check now shape-validates that
# suffix — so the survival harness must use a realistic path, not a bare stub.
ASM="$TMP/asm-xdg/entwurf/meta-bridge/.assembled"
export ASM
mkdir -p "$ASM"

cat > "$CLAUDE_CONFIG_DIR/settings.json" <<'JSON'
{
  "cleanupPeriodDays": 30,
  "enabledPlugins": {
    "entwurf-meta-receive@meta-bridge-local": false,
    "keep@user": true
  },
  "permissions": {
    "allow": ["Read", "CustomUserTool", "mcp__pi-tools-bridge__*"],
    "deny": ["Agent"]
  },
  "env": {
    "DISABLE_AUTOCOMPACT": "0",
    "KEEP_ME": "yes"
  },
  "statusLine": {
    "type": "command",
    "command": "/old/user/statusline.sh"
  },
  "promptSuggestionEnabled": true,
  "skipDangerousModePermissionPrompt": false,
  "showTurnDuration": true
}
JSON
cat > "$HOME/.claude.json" <<'JSON'
{
  "mcpServers": {
    "entwurf-bridge": {
      "type": "stdio",
      "command": "old",
      "args": ["old-start.sh"]
    },
    "keep-server": {
      "type": "stdio",
      "command": "keep"
    }
  }
}
JSON

py() { python3 "$STATE" "$@" --repo "$REPO" --asm "$ASM"; }

DEV_STATUSLINE="$(python3 "$STATE" desired-statusline --repo "$REPO" | python3 -c 'import json,sys; print(json.load(sys.stdin)["command"])')"
if [ "$DEV_STATUSLINE" = "$REPO/scripts/meta-bridge-statusline.sh" ]; then ok "dev statusLine pins the checkout script"; else bad "dev statusLine command drifted: $DEV_STATUSLINE"; fi
FAKE_INSTALLED_REPO="$TMP/npmroot/node_modules/@junghanacs/entwurf"
INSTALLED_STATUSLINE="$(python3 "$STATE" desired-statusline --repo "$FAKE_INSTALLED_REPO" | python3 -c 'import json,sys; print(json.load(sys.stdin)["command"])')"
if [ "$INSTALLED_STATUSLINE" = "entwurf-statusline" ]; then ok "installed statusLine uses the stable bin shim"; else bad "installed statusLine command drifted: $INSTALLED_STATUSLINE"; fi

py prepare >/dev/null
STATE_FILE="$CLAUDE_CONFIG_DIR/entwurf.install-state.json"
[ -f "$STATE_FILE" ] && ok "prepare writes install-state before any merge" || bad "state file missing after prepare"
if python3 - <<'PY'
import json, os, stat
path=os.environ['CLAUDE_CONFIG_DIR'] + '/entwurf.install-state.json'
assert stat.S_IMODE(os.stat(path).st_mode) == 0o600
s=json.load(open(path))
assert s['files']['settings']['keys']['enabledPlugins.entwurf-meta-receive@meta-bridge-local']['original']['value'] is False
assert s['files']['settings']['keys']['cleanupPeriodDays']['original']['value'] == 30
assert s['files']['settings']['keys']['env.DISABLE_AUTOCOMPACT']['original']['value'] == '0'
assert s['files']['settings']['keys']['statusLine']['original']['value']['command'] == '/old/user/statusline.sh'
assert s['files']['settings']['keys']['promptSuggestionEnabled']['original']['value'] is True
assert s['files']['settings']['keys']['autoCompactEnabled']['original']['existed'] is False
assert s['files']['claudeRoot']['keys']['mcpServers.entwurf-bridge']['original']['value']['command'] == 'old'
PY
then ok "state captures original scalar/map values and is mode 0600"; else bad "state did not capture original values / mode 0600"; fi

py apply >/dev/null
if python3 - <<'PY'
import json, os
cfg=os.environ['CLAUDE_CONFIG_DIR']
settings=json.load(open(cfg + '/settings.json'))
root=json.load(open(os.environ['HOME'] + '/.claude.json'))
assert settings['enabledPlugins']['entwurf-meta-receive@meta-bridge-local'] is True
assert settings['enabledPlugins']['keep@user'] is True
assert settings['extraKnownMarketplaces']['meta-bridge-local']['source']['path'] == os.environ['ASM']
assert settings['cleanupPeriodDays'] == 365
assert settings['env']['DISABLE_AUTOCOMPACT'] == '1'
assert settings['env']['KEEP_ME'] == 'yes'
assert settings['statusLine']['command'] == os.environ['REPO'] + '/scripts/meta-bridge-statusline.sh'
for key in ['promptSuggestionEnabled','awaySummaryEnabled','autoMemoryEnabled','verbose','autoCompactEnabled','showTurnDuration','terminalProgressBarEnabled','useAutoModeDuringPlan','enableWorkflows','workflowKeywordTriggerEnabled']:
    assert settings[key] is False, key
assert settings['skipDangerousModePermissionPrompt'] is True
for item in ['Bash','Read','Write','Edit','Grep','Glob','WebFetch','WebSearch','Skill','mcp__entwurf-bridge__*']:
    assert item in settings['permissions']['allow'], item
assert settings['permissions']['allow'].count('Read') == 1
# S2 rename cutover: the legacy pre-rename allow item is pruned, but an unrelated
# user-authored allow item survives (prune is targeted, not a blanket wipe).
assert 'mcp__pi-tools-bridge__*' not in settings['permissions']['allow']
assert 'CustomUserTool' in settings['permissions']['allow']
assert 'keep-server' in root['mcpServers']
assert root['mcpServers']['entwurf-bridge']['env']['ENTWURF_BRIDGE_EXTERNAL_AGENT_ID'] == 'external-mcp/claude-code'
PY
then ok "apply installs managed keyset without clobbering unrelated keys"; else bad "apply keyset check failed"; fi

# Keyset-survival guard (B1): once installed, `state.py check` is the
# effect-based survival assertion doctor consumes. If another consumer
# (agent-config merge, hand edit) overwrites a pi-owned key, check must fail loud
# AND name the drifted key so doctor can surface which one. Adversarial flips
# below; restore with apply afterward so the later cases see a clean keyset.
if py check >/dev/null 2>&1; then ok "survival check passes on a freshly applied keyset"; else bad "survival check failed right after apply"; fi
SURVIVAL_SNAP="$TMP/settings-survival-snapshot.json"
cp "$CLAUDE_CONFIG_DIR/settings.json" "$SURVIVAL_SNAP"  # exact restore point (array-replace below would drop user items)
python3 - <<'PY'
import json, os
p=os.environ['CLAUDE_CONFIG_DIR'] + '/settings.json'
d=json.load(open(p)); d['verbose']=True  # a consumer/user clobbers a pi scalar
json.dump(d, open(p,'w'), indent=2)
PY
ERR_SCALAR="$(py check 2>&1 >/dev/null || true)"
if printf '%s' "$ERR_SCALAR" | grep -q 'verbose'; then ok "survival check fails and names an overwritten pi scalar (verbose)"; else bad "survival check did not name clobbered scalar: $ERR_SCALAR"; fi
python3 - <<'PY'
import json, os
p=os.environ['CLAUDE_CONFIG_DIR'] + '/settings.json'
d=json.load(open(p)); d['verbose']=False; d['permissions']['allow']=['OnlyUserTool']  # array REPLACE drops pi items
json.dump(d, open(p,'w'), indent=2)
PY
ERR_ARRAY="$(py check 2>&1 >/dev/null || true)"
if printf '%s' "$ERR_ARRAY" | grep -qi 'allow'; then ok "survival check fails when permissions.allow is array-replaced (pi items dropped)"; else bad "survival check did not catch dropped permissions.allow items: $ERR_ARRAY"; fi
cp "$SURVIVAL_SNAP" "$CLAUDE_CONFIG_DIR/settings.json"  # back to clean keyset before the legacy-reinject case
python3 - <<'PY'
import json, os
p=os.environ['CLAUDE_CONFIG_DIR'] + '/settings.json'
d=json.load(open(p)); d['permissions']['allow'].append('mcp__pi-tools-bridge__*')  # someone re-injects the pruned legacy item
json.dump(d, open(p,'w'), indent=2)
PY
ERR_LEGACY="$(py check 2>&1 >/dev/null || true)"
if printf '%s' "$ERR_LEGACY" | grep -qi 'legacy'; then ok "survival check fails when a pruned legacy allow item is re-injected"; else bad "survival check did not catch re-injected legacy allow item: $ERR_LEGACY"; fi
cp "$SURVIVAL_SNAP" "$CLAUDE_CONFIG_DIR/settings.json"  # exact restore so later cases see the clean installed keyset
if py check >/dev/null 2>&1; then ok "survival check passes again after restoring the keyset"; else bad "keyset not restored after adversarial survival cases"; fi

# Re-run prepare/apply after install: the original snapshot must remain the
# pre-install values, not the already-managed values.
py prepare >/dev/null
py apply >/dev/null
if python3 - <<'PY'
import json, os
s=json.load(open(os.environ['CLAUDE_CONFIG_DIR'] + '/entwurf.install-state.json'))
assert s['files']['settings']['keys']['enabledPlugins.entwurf-meta-receive@meta-bridge-local']['original']['value'] is False
assert s['files']['settings']['keys']['cleanupPeriodDays']['original']['value'] == 30
assert s['files']['settings']['keys']['env.DISABLE_AUTOCOMPACT']['original']['value'] == '0'
assert s['files']['settings']['keys']['statusLine']['original']['value']['command'] == '/old/user/statusline.sh'
assert s['files']['settings']['keys']['promptSuggestionEnabled']['original']['value'] is True
PY
then ok "rerun preserves first pre-install snapshot"; else bad "rerun overwrote original snapshot"; fi

# User changes after install: array additions should survive uninstall; scalar
# managed toggles restore the original value by design.
python3 - <<'PY'
import json, os
p=os.environ['CLAUDE_CONFIG_DIR'] + '/settings.json'
d=json.load(open(p))
d['permissions']['allow'].append('UserAfterInstall')
d['permissions']['deny'].append('UserDeniedAfterInstall')
json.dump(d, open(p,'w'), indent=2); open(p,'a').write('\n')
PY
py uninstall >/dev/null
if python3 - <<'PY'
import json, os
settings=json.load(open(os.environ['CLAUDE_CONFIG_DIR'] + '/settings.json'))
root=json.load(open(os.environ['HOME'] + '/.claude.json'))
assert settings['cleanupPeriodDays'] == 30
assert settings['enabledPlugins']['entwurf-meta-receive@meta-bridge-local'] is False
assert 'meta-bridge-local' not in settings.get('extraKnownMarketplaces', {})
assert settings['env']['DISABLE_AUTOCOMPACT'] == '0'
assert settings['env']['KEEP_ME'] == 'yes'
assert settings['statusLine']['command'] == '/old/user/statusline.sh'
assert settings['promptSuggestionEnabled'] is True
assert settings['skipDangerousModePermissionPrompt'] is False
assert settings['showTurnDuration'] is True
for key in ['awaySummaryEnabled','autoMemoryEnabled','verbose','autoCompactEnabled','terminalProgressBarEnabled','useAutoModeDuringPlan','enableWorkflows','workflowKeywordTriggerEnabled']:
    assert key not in settings, key
allow=settings['permissions']['allow']
deny=settings['permissions']['deny']
assert 'CustomUserTool' in allow and 'UserAfterInstall' in allow
assert 'Bash' not in allow and 'mcp__entwurf-bridge__*' not in allow
assert 'Agent' in deny and 'UserDeniedAfterInstall' in deny and 'TaskCreate' not in deny
assert root['mcpServers']['entwurf-bridge']['command'] == 'old'
assert 'keep-server' in root['mcpServers']
assert not os.path.exists(os.environ['CLAUDE_CONFIG_DIR'] + '/entwurf.install-state.json')
PY
then ok "uninstall restores scalars/maps and removes only managed array additions"; else bad "uninstall restoration check failed"; fi

if py uninstall >/dev/null 2>&1; then bad "state manager uninstall without state should not guess"; else ok "state manager uninstall without state fails instead of guessing"; fi

# ⓪ 봉쇄: wrapper-uninstall을 실제 $REPO 스크립트로 직접 돌린다. 이제 uninstall이
# 지우는 live artifact는 ${XDG_DATA_HOME}/entwurf/meta-bridge 하나뿐이고, 위에서
# HOME + XDG_DATA_HOME를 샌드박스로 고정했으므로 실제 개발자 배선/체크아웃에는
# 닿을 수 없다(2026-07-03 `?` 사건의 구조적 소멸 — 사본 repo 우회가 더는 불필요).
FAKE_BIN="$TMP/fake-bin"; mkdir -p "$FAKE_BIN"
cat > "$FAKE_BIN/claude" <<'SH'
#!/usr/bin/env bash
printf '%s\n' "$*" >> "$FAKE_CLAUDE_LOG"
exit 0
SH
chmod +x "$FAKE_BIN/claude"

# The wrapper must refuse before side effects. A fake claude records whether
# plugin/MCP removals were attempted; no state means the log must stay empty.
FAKE_CLAUDE_LOG="$TMP/fake-claude-nostate.log"
if PATH="$FAKE_BIN:$PATH" FAKE_CLAUDE_LOG="$FAKE_CLAUDE_LOG" bash "$REPO/scripts/meta-bridge-uninstall.sh" >/dev/null 2>&1; then
  bad "wrapper uninstall without state should fail"
else
  if [ ! -s "$FAKE_CLAUDE_LOG" ]; then ok "wrapper uninstall without state has zero Claude side effects"; else bad "wrapper uninstall without state touched Claude: $(cat "$FAKE_CLAUDE_LOG")"; fi
fi

# With valid state, the wrapper removes Claude registrations, restores JSON state,
# AND removes the XDG live artifact RECORDED in state — never the checkout, never a
# path recomputed from the env. Record an XDG-structured assembled path and seed the
# sentinel artifact so we can prove uninstall drops exactly the recorded tree.
WASM="$XDG_DATA_HOME/entwurf/meta-bridge/.assembled"
python3 "$STATE" prepare --repo "$REPO" --asm "$WASM" >/dev/null
python3 "$STATE" apply   --repo "$REPO" --asm "$WASM" >/dev/null
mkdir -p "$WASM"; : > "$WASM/.sentinel"
FAKE_CLAUDE_LOG="$TMP/fake-claude-state.log"
if PATH="$FAKE_BIN:$PATH" FAKE_CLAUDE_LOG="$FAKE_CLAUDE_LOG" bash "$REPO/scripts/meta-bridge-uninstall.sh" >/dev/null 2>&1; then
  if grep -q 'plugin uninstall entwurf-meta-receive@meta-bridge-local' "$FAKE_CLAUDE_LOG" && grep -q 'mcp remove entwurf-bridge -s user' "$FAKE_CLAUDE_LOG" && [ ! -f "$STATE_FILE" ]; then
    ok "wrapper uninstall with valid state removes Claude registrations and restores state"
  else
    bad "wrapper uninstall with state missed expected side effects/state removal"
  fi
  # 봉쇄가 회피가 아니라 구조임을 증명: uninstall이 지우는 건 recorded XDG artifact뿐.
  if [ ! -e "$XDG_DATA_HOME/entwurf/meta-bridge" ]; then ok "wrapper removes the recorded XDG live artifact tree, not the checkout"; else bad "wrapper did not remove the recorded XDG live artifact"; fi
else
  bad "wrapper uninstall with valid state failed"
fi

# Honest inverse under a CHANGED XDG_DATA_HOME (GPT hardening): uninstall must remove
# the RECORDED artifact path, never one recomputed from the current env. Record A,
# run uninstall with the env pointing at B, and prove A is gone while B is untouched.
XDGA="$TMP/xdgA"; XDGB="$TMP/xdgB"
ASM_A="$XDGA/entwurf/meta-bridge/.assembled"
python3 "$STATE" prepare --repo "$REPO" --asm "$ASM_A" >/dev/null
python3 "$STATE" apply   --repo "$REPO" --asm "$ASM_A" >/dev/null
mkdir -p "$ASM_A"; : > "$ASM_A/.sentinel"
mkdir -p "$XDGB/entwurf/meta-bridge/.assembled"; : > "$XDGB/entwurf/meta-bridge/.assembled/.sentinel"
if XDG_DATA_HOME="$XDGB" PATH="$FAKE_BIN:$PATH" FAKE_CLAUDE_LOG="$TMP/fake-claude-mismatch.log" bash "$REPO/scripts/meta-bridge-uninstall.sh" >/dev/null 2>&1; then
  if [ ! -e "$XDGA/entwurf/meta-bridge" ]; then ok "uninstall removes the RECORDED artifact (XDG A) even when env XDG_DATA_HOME differs"; else bad "uninstall did not remove the recorded artifact A — recomputed from env instead"; fi
  if [ -e "$XDGB/entwurf/meta-bridge/.assembled/.sentinel" ]; then ok "uninstall leaves the current-env XDG (B) untouched (no env recompute)"; else bad "uninstall wrongly removed the current-env XDG B"; fi
else
  bad "wrapper uninstall (recorded-path mismatch case) failed"
fi

# GPT hardening: a corrupt recorded assembledMarketplacePath must fail the wrapper
# uninstall LOUD and BEFORE any side effect — no Claude removal, state file intact
# (honest inverse never guesses / never partially uninstalls / never WARN-then-DONE).
# Two corrupt shapes: a trivially-bad "/" AND the basename-corrupt case that a
# PARENT-ONLY guard would silently pass (…/entwurf/meta-bridge/not-assembled) — the
# rm targets the parent meta-bridge dir, so that shape must be refused by the FULL
# suffix guard or it nukes the real artifact + Claude registrations (2026-07-03).
for CORRUPT in "/" "$XDG_DATA_HOME/entwurf/meta-bridge/not-assembled"; do
  python3 "$STATE" prepare --repo "$REPO" --asm "$XDG_DATA_HOME/entwurf/meta-bridge/.assembled" >/dev/null
  python3 "$STATE" apply   --repo "$REPO" --asm "$XDG_DATA_HOME/entwurf/meta-bridge/.assembled" >/dev/null
  # seed the real artifact so an over-broad rm would be observable as its removal
  mkdir -p "$XDG_DATA_HOME/entwurf/meta-bridge/.assembled"; : > "$XDG_DATA_HOME/entwurf/meta-bridge/.assembled/.sentinel"
  CORRUPT="$CORRUPT" python3 - <<'PY'
import json, os
p = os.environ['CLAUDE_CONFIG_DIR'] + '/entwurf.install-state.json'
s = json.load(open(p)); s['assembledMarketplacePath'] = os.environ['CORRUPT']
json.dump(s, open(p, 'w'), indent=2)
PY
  FAKE_CLAUDE_LOG="$TMP/fake-claude-corrupt.log"; : > "$FAKE_CLAUDE_LOG"
  if PATH="$FAKE_BIN:$PATH" FAKE_CLAUDE_LOG="$FAKE_CLAUDE_LOG" bash "$REPO/scripts/meta-bridge-uninstall.sh" >/dev/null 2>&1; then
    bad "wrapper uninstall with corrupt recorded path '$CORRUPT' should fail loud"
  elif [ -s "$FAKE_CLAUDE_LOG" ] || [ ! -f "$STATE_FILE" ] || [ ! -e "$XDG_DATA_HOME/entwurf/meta-bridge/.assembled/.sentinel" ]; then
    bad "corrupt-path uninstall '$CORRUPT' leaked side effects/removed artifact: claude_log=[$(cat "$FAKE_CLAUDE_LOG")] state_exists=$([ -f "$STATE_FILE" ] && echo yes || echo no) artifact=$([ -e "$XDG_DATA_HOME/entwurf/meta-bridge/.assembled/.sentinel" ] && echo intact || echo REMOVED)"
  else
    ok "corrupt recorded path '$CORRUPT' → uninstall fails BEFORE side effects (no Claude removal, state + artifact intact)"
  fi
  rm -f "$STATE_FILE"; rm -rf "$XDG_DATA_HOME/entwurf/meta-bridge"
done

# GPT hardening: state.py check must compare the RECORDED marketplace path, not the
# --asm handed in. Install/apply with A, then check with a DIFFERENT --asm B: it must
# still PASS (Claude settings + state both hold A; only the caller's XDG differs).
CKA="$TMP/ck-xdgA/entwurf/meta-bridge/.assembled"
CKB="$TMP/ck-xdgB/entwurf/meta-bridge/.assembled"
python3 "$STATE" prepare --repo "$REPO" --asm "$CKA" >/dev/null
python3 "$STATE" apply   --repo "$REPO" --asm "$CKA" >/dev/null
if python3 "$STATE" check --repo "$REPO" --asm "$CKB" >/dev/null 2>&1; then ok "state.py check passes when --asm differs from the recorded path (compares recorded, no XDG false-fail)"; else bad "state.py check false-FAILed on a recorded≠--asm mismatch"; fi
rm -f "$STATE_FILE"

# GPT hardening: check must shape-validate the recorded path, not just compare it to
# settings. Corrupt BOTH state + settings to the same basename-bad value: a pure
# consistency compare would PASS (both agree) and greenlight a bogus marketplace
# source. The suffix guard must FAIL it instead.
python3 "$STATE" prepare --repo "$REPO" --asm "$XDG_DATA_HOME/entwurf/meta-bridge/.assembled" >/dev/null
python3 "$STATE" apply   --repo "$REPO" --asm "$XDG_DATA_HOME/entwurf/meta-bridge/.assembled" >/dev/null
python3 - <<'PY'
import json, os
xdg = os.environ['XDG_DATA_HOME']; corrupt = xdg + '/entwurf/meta-bridge/not-assembled'
sp = os.environ['CLAUDE_CONFIG_DIR'] + '/entwurf.install-state.json'
s = json.load(open(sp)); s['assembledMarketplacePath'] = corrupt; json.dump(s, open(sp, 'w'), indent=2)
cp = os.environ['CLAUDE_CONFIG_DIR'] + '/settings.json'
c = json.load(open(cp)); c['extraKnownMarketplaces']['meta-bridge-local'] = {'source': {'source': 'directory', 'path': corrupt}}; json.dump(c, open(cp, 'w'), indent=2)
PY
if python3 "$STATE" check --repo "$REPO" --asm "$XDG_DATA_HOME/entwurf/meta-bridge/.assembled" >/dev/null 2>&1; then bad "state.py check greenlit a both-corrupt (state+settings) malformed marketplace path"; else ok "state.py check fails a malformed recorded path even when settings agree (shape guard, not just consistency)"; fi
rm -f "$STATE_FILE"

# GPT hardening: a MISSING/empty recorded path is corruption too — every state our
# code writes carries the field, so check must NOT fall back to --asm and PASS.
# Delete the field with settings still valid; the shape guard must FAIL, not greenlight.
python3 "$STATE" prepare --repo "$REPO" --asm "$XDG_DATA_HOME/entwurf/meta-bridge/.assembled" >/dev/null
python3 "$STATE" apply   --repo "$REPO" --asm "$XDG_DATA_HOME/entwurf/meta-bridge/.assembled" >/dev/null
python3 - <<'PY'
import json, os
sp = os.environ['CLAUDE_CONFIG_DIR'] + '/entwurf.install-state.json'
s = json.load(open(sp)); s.pop('assembledMarketplacePath', None); json.dump(s, open(sp, 'w'), indent=2)
PY
if python3 "$STATE" check --repo "$REPO" --asm "$XDG_DATA_HOME/entwurf/meta-bridge/.assembled" >/dev/null 2>&1; then bad "state.py check PASSed with a MISSING recorded assembledMarketplacePath (fell back to --asm)"; else ok "state.py check fails a missing/empty recorded path (no --asm fallback greenlight)"; fi
rm -f "$STATE_FILE"

# Doctor hook-log recovery predicate: only a later `INFO armed watch` clears an
# ERROR. A UserPromptSubmit `INFO attach record` is degraded backfill, not wake
# recovery.
HOOK_SYN="$TMP/hook-log"
printf '2026-06-06T00:00:00.000Z ERROR arm failed\n' > "$HOOK_SYN"
if meta_bridge_hook_log_status "$HOOK_SYN" >/dev/null 2>&1; then bad "hook-log predicate: ERROR-only should fail"; else ok "hook-log predicate fails on ERROR-only"; fi
printf '2026-06-06T00:00:00.000Z ERROR arm failed\n2026-06-06T00:00:01.000Z INFO armed watch /tmp/inbox.signal\n' > "$HOOK_SYN"
if meta_bridge_hook_log_status "$HOOK_SYN" >/dev/null; then ok "hook-log predicate recovers on later INFO armed watch"; else bad "hook-log predicate did not recover on armed watch"; fi
printf '2026-06-06T00:00:00.000Z INFO armed watch /tmp/inbox.signal\n2026-06-06T00:00:01.000Z ERROR arm failed\n' > "$HOOK_SYN"
if meta_bridge_hook_log_status "$HOOK_SYN" >/dev/null 2>&1; then bad "hook-log predicate: ERROR after armed watch should fail"; else ok "hook-log predicate fails when ERROR is newer than armed watch"; fi
printf '2026-06-06T00:00:00.000Z ERROR arm failed\n2026-06-06T00:00:01.000Z INFO attach record x.meta.json (event=UserPromptSubmit, native=n)\n' > "$HOOK_SYN"
if meta_bridge_hook_log_status "$HOOK_SYN" >/dev/null 2>&1; then bad "hook-log predicate: UserPromptSubmit attach must not recover"; else ok "hook-log predicate does not treat UserPromptSubmit attach as recovery"; fi
printf '2026-06-06T00:00:00.000Z INFO attach record x.meta.json (event=UserPromptSubmit, native=n)\n' > "$HOOK_SYN"
if meta_bridge_hook_log_status "$HOOK_SYN" >/dev/null; then ok "hook-log predicate passes when no ERROR exists"; else bad "hook-log predicate failed no-ERROR log"; fi

# Migration: the Phase-0/1 installer may already have left exact pi-owned keys in
# place before a state file existed. Exact managed plugin/marketplace/MCP values
# are treated as legacy-owned-by-us (absent original), so uninstall removes them
# instead of restoring the tribal install forever.
python3 - <<'PY'
import json, os
cfg=os.environ['CLAUDE_CONFIG_DIR']; home=os.environ['HOME']; asm=os.environ['ASM']; repo=os.environ['REPO']
settings={
  'enabledPlugins': {'entwurf-meta-receive@meta-bridge-local': True},
  'extraKnownMarketplaces': {'meta-bridge-local': {'source': {'source': 'directory', 'path': asm}}},
  'permissions': {'allow': ['Read'], 'deny': ['Agent']},
  'env': {'DISABLE_AUTOCOMPACT': '1'}
}
root={'mcpServers': {'entwurf-bridge': {'type':'stdio','command':'bash','args':[repo + '/mcp/entwurf-bridge/start.sh'],'env': {'ENTWURF_BRIDGE_EXTERNAL_AGENT_ID':'external-mcp/claude-code','ENTWURF_BRIDGE_REQUIRE_META_SENDER':'1'}}}}
json.dump(settings, open(cfg + '/settings.json','w'), indent=2); open(cfg + '/settings.json','a').write('\n')
json.dump(root, open(home + '/.claude.json','w'), indent=2); open(home + '/.claude.json','a').write('\n')
PY
py prepare >/dev/null
if python3 - <<'PY'
import json, os
s=json.load(open(os.environ['CLAUDE_CONFIG_DIR'] + '/entwurf.install-state.json'))
assert s['files']['settings']['keys']['enabledPlugins.entwurf-meta-receive@meta-bridge-local']['original']['existed'] is False
assert s['files']['settings']['keys']['extraKnownMarketplaces.meta-bridge-local']['original']['existed'] is False
assert s['files']['claudeRoot']['keys']['mcpServers.entwurf-bridge']['original']['existed'] is False
assert s['files']['settings']['keys']['env.DISABLE_AUTOCOMPACT']['original']['existed'] is True
PY
then ok "legacy exact plugin/marketplace/MCP migrate as pi-owned absent, policy keys remain user-owned"; else bad "legacy migration state check failed"; fi
py uninstall >/dev/null
if python3 - <<'PY'
import json, os
settings=json.load(open(os.environ['CLAUDE_CONFIG_DIR'] + '/settings.json'))
root=json.load(open(os.environ['HOME'] + '/.claude.json'))
assert 'entwurf-meta-receive@meta-bridge-local' not in settings.get('enabledPlugins', {})
assert 'meta-bridge-local' not in settings.get('extraKnownMarketplaces', {})
assert 'entwurf-bridge' not in root.get('mcpServers', {})
assert settings['env']['DISABLE_AUTOCOMPACT'] == '1'
PY
then ok "legacy migration uninstall removes pi-owned wiring but preserves policy scalar"; else bad "legacy migration uninstall check failed"; fi

# Store-doctor hardening: valid store passes, corrupt/duplicate/drift fail loudly.
valid_record() {
  local gid="$1" native="$2"
  cat <<JSON
{
  "schemaVersion": 3,
  "gardenId": "$gid",
  "backend": "claude-code",
  "nativeSessionId": "$native",
  "cwd": "/tmp",
  "model": null,
  "transcriptPath": "/tmp/$native.jsonl",
  "createdAt": "2026-06-06T00:00:00.000Z",
  "recordUpdatedAt": "2026-06-06T00:00:00.000Z"
}
JSON
}
STORE="$TMP/store"; export STORE; mkdir -p "$STORE"
valid_record "20260606T000000-aaaaaa" "native-a" > "$STORE/20260606T000000-aaaaaa.meta.json"
valid_record "20260606T000001-bbbbbb" "native-b" > "$STORE/20260606T000001-bbbbbb.meta.json"

STATUS_INPUT_MATCH='{"session_id":"native-a","workspace":{"current_dir":"/tmp"},"model":{"id":"claude-sonnet-5"},"context_window":{"context_window_size":200000,"used_percentage":2,"current_usage":{"input_tokens":10}}}'
STATUS_INPUT_MISS='{"session_id":"native-missing","workspace":{"current_dir":"/tmp"},"model":{"id":"claude-opus-4-8"}}'
STATUS_INPUT_READY='{"workspace":{"current_dir":"/tmp"},"model":{"id":"claude-haiku-4-5"}}'
STATUS_OUT_MATCH="$(printf '%s' "$STATUS_INPUT_MATCH" | ENTWURF_META_SESSIONS_DIR="$STORE" "$REPO/scripts/meta-bridge-statusline.sh")"
if [ "$(printf '%s\n' "$STATUS_OUT_MATCH" | wc -l | tr -d ' ')" = "2" ]; then ok "statusline renders exactly two rows"; else bad "statusline should render two rows: $STATUS_OUT_MATCH"; fi
if printf '%s\n' "$STATUS_OUT_MATCH" | sed -n '1p' | grep -q 'tmp' && printf '%s\n' "$STATUS_OUT_MATCH" | sed -n '2p' | grep -q '🪛 20260606T000000-aaaaaa cc | s'; then ok "statusline keeps row-1 work context and maps native session_id to row-2 garden-id"; else bad "statusline did not show expected two-row content for native-a: $STATUS_OUT_MATCH"; fi
STATUS_OUT_MISS="$(printf '%s' "$STATUS_INPUT_MISS" | ENTWURF_META_SESSIONS_DIR="$STORE" "$REPO/scripts/meta-bridge-statusline.sh")"
if printf '%s' "$STATUS_OUT_MISS" | grep -q '🪛 ? cc'; then ok "statusline no-record fallback is ?"; else bad "statusline no-record fallback wrong: $STATUS_OUT_MISS"; fi
STATUS_OUT_READY="$(printf '%s' "$STATUS_INPUT_READY" | ENTWURF_META_SESSIONS_DIR="$STORE" "$REPO/scripts/meta-bridge-statusline.sh")"
if printf '%s' "$STATUS_OUT_READY" | grep -q '🪛 ready cc'; then ok "statusline no-session_id fallback is ready"; else bad "statusline ready fallback wrong: $STATUS_OUT_READY"; fi
cp "$STORE/20260606T000000-aaaaaa.meta.json" "$STORE/20260606T000003-dddddd.meta.json"
STATUS_OUT_DUP="$(printf '%s' "$STATUS_INPUT_MATCH" | ENTWURF_META_SESSIONS_DIR="$STORE" "$REPO/scripts/meta-bridge-statusline.sh")"
if printf '%s' "$STATUS_OUT_DUP" | grep -q '🪛 ! cc'; then ok "statusline duplicate nativeSessionId fallback is !"; else bad "statusline duplicate fallback wrong: $STATUS_OUT_DUP"; fi
rm "$STORE/20260606T000003-dddddd.meta.json"

if node --experimental-strip-types "$STORE_DOCTOR" "$STORE" >/dev/null; then ok "store doctor accepts valid records"; else bad "store doctor rejected valid records"; fi
cp "$STORE/20260606T000000-aaaaaa.meta.json" "$STORE/20260606T000002-cccccc.meta.json"
if node --experimental-strip-types "$STORE_DOCTOR" "$STORE" >/dev/null 2>&1; then bad "store doctor missed body/filename drift + duplicate"; else ok "store doctor fails on body/filename drift and duplicate nativeSessionId"; fi
rm "$STORE/20260606T000002-cccccc.meta.json"
python3 - <<'PY'
import json, os
p=os.environ['STORE'] + '/20260606T000001-bbbbbb.meta.json'
d=json.load(open(p)); d['isEntwurf']=True; json.dump(d, open(p,'w'), indent=2); open(p,'a').write('\n')
PY
if node --experimental-strip-types "$STORE_DOCTOR" "$STORE" >/dev/null 2>&1; then bad "store doctor missed a stray pre-cut field (isEntwurf)"; else ok "store doctor fails on a stray pre-cut field (isEntwurf resurrection)"; fi

# Doctor fail-loud regression (B1'): meta-bridge-doctor.sh must surface a managed-
# config drift, NOT die silently at the "[managed config state]" header. A bare
# CHECK_ERR="$(state.py check)" assignment under `set -e` exited the doctor the
# instant check returned nonzero — so the operator saw the header and nothing
# else; the very "which key drifted" detail the section exists to print was lost,
# and every later section ([plugin install], [meta-record store], the SILENT-MISS
# guard) never ran. The fix wraps the substitution as an `if` condition so its
# nonzero status is consumed instead of tripping set -e. This gate forces a real
# state drift behind a fully-faked claude toolchain (no real claude, no real
# install-meta-bridge) and proves the doctor (a) still exits 1, (b) prints
# "Drift detail:", (c) names the concrete drifted key, and (d) runs the WHOLE
# chain to its final summary line — i.e. no early set -e death anywhere.
DOC_HOME="$TMP/doctor-home"; DOC_CFG="$DOC_HOME/.claude"
DOC_AGENT="$TMP/doctor-agent"; DOC_STORE="$DOC_AGENT/meta-sessions"
DOC_BIN="$TMP/doctor-bin"; DOC_ASM="$XDG_DATA_HOME/entwurf/meta-bridge/.assembled"  # SAME asm the doctor computes (XDG), so only the MCP drifts
mkdir -p "$DOC_CFG" "$DOC_STORE" "$DOC_BIN"
echo '{}' > "$DOC_CFG/settings.json"
echo '{}' > "$DOC_HOME/.claude.json"
# A healthy claude-code meta-record so the SessionStart-evidence section is green
# and the ONLY failure of record is the deliberate MCP drift.
valid_record "20260606T120000-eeeeee" "doctor-native" > "$DOC_STORE/20260606T120000-eeeeee.meta.json"
# Fake claude: a healthy toolchain so the doctor sails past every other section.
cat > "$DOC_BIN/claude" <<'SH'
#!/usr/bin/env bash
if [ "${1:-} ${2:-} ${3:-}" = "plugin list --json" ]; then
  if [ "${FAKE_PLUGIN_CACHE_MISS:-0}" = 1 ]; then
    printf '%s\n' '[{"id":"entwurf-meta-receive@meta-bridge-local","enabled":true,"errors":["Marketplace meta-bridge-local failed to load: cache-miss"]}]'
  else
    printf '%s\n' '[{"id":"entwurf-meta-receive@meta-bridge-local","enabled":true}]'
  fi
  exit 0
fi
case "$1${2:+ $2}" in
  "--version") echo "2.1.167 (Claude Code)" ;;
  "plugin list") printf '%s\n' "entwurf-meta-receive@meta-bridge-local" "  Status: enabled" ;;
  "mcp get") printf '%s\n' "Scope: User config" "Status: ✔ Connected" ;;
  *) : ;;
esac
exit 0
SH
chmod +x "$DOC_BIN/claude"
# Build a valid install-state + managed keyset, then drift ONLY the user MCP.
env HOME="$DOC_HOME" CLAUDE_CONFIG_DIR="$DOC_CFG" python3 "$STATE" prepare --repo "$REPO" --asm "$DOC_ASM" >/dev/null
env HOME="$DOC_HOME" CLAUDE_CONFIG_DIR="$DOC_CFG" python3 "$STATE" apply   --repo "$REPO" --asm "$DOC_ASM" >/dev/null
env HOME="$DOC_HOME" python3 - <<'PY'
import json, os
p = os.path.join(os.environ['HOME'], '.claude.json')
d = json.load(open(p))
d.setdefault('mcpServers', {})['entwurf-bridge'] = {'type': 'stdio', 'command': 'CLOBBERED-BY-ANOTHER-CONSUMER'}
json.dump(d, open(p, 'w'), indent=2)
PY
# Capture without tripping THIS script's own set -e (the very trap under test).
set +e
DOC_OUT="$(env HOME="$DOC_HOME" CLAUDE_CONFIG_DIR="$DOC_CFG" PI_CODING_AGENT_DIR="$DOC_AGENT" ENTWURF_META_SESSIONS_DIR="$DOC_STORE" PATH="$DOC_BIN:$PATH" bash "$REPO/scripts/meta-bridge-doctor.sh" 2>&1)"
DOC_CODE=$?
set -e
if [ "$DOC_CODE" -eq 1 ]; then ok "doctor exits 1 on a managed-config drift"; else bad "doctor exit on drift was $DOC_CODE, want 1:"$'\n'"$DOC_OUT"; fi
if printf '%s\n' "$DOC_OUT" | grep -q 'Drift detail:'; then ok "doctor prints 'Drift detail:' instead of dying at the managed-config header"; else bad "doctor did not print Drift detail — silent early death?:"$'\n'"$DOC_OUT"; fi
if printf '%s\n' "$DOC_OUT" | grep -q 'user MCP entwurf-bridge'; then ok "doctor names the concrete drifted key (user MCP entwurf-bridge)"; else bad "doctor did not name the drifted MCP key:"$'\n'"$DOC_OUT"; fi
if printf '%s\n' "$DOC_OUT" | grep -q '\[plugin install'; then ok "doctor continues to a later section after the drift (no early set -e death)"; else bad "doctor did not reach a later section header after the drift:"$'\n'"$DOC_OUT"; fi
if printf '%s\n' "$DOC_OUT" | grep -q 'meta-bridge doctor: FAIL'; then ok "doctor runs the whole chain to its final summary line"; else bad "doctor did not reach its final summary line (mid-run death):"$'\n'"$DOC_OUT"; fi

# A plugin can be configured enabled while Claude refuses to load its missing marketplace
# source. Text-only `grep enabled` called that healthy and let `🪛 ? cc` look mysterious.
set +e
DOC_CACHE_OUT="$(env HOME="$DOC_HOME" CLAUDE_CONFIG_DIR="$DOC_CFG" PI_CODING_AGENT_DIR="$DOC_AGENT" ENTWURF_META_SESSIONS_DIR="$DOC_STORE" FAKE_PLUGIN_CACHE_MISS=1 PATH="$DOC_BIN:$PATH" bash "$REPO/scripts/meta-bridge-doctor.sh" 2>&1)"
DOC_CACHE_CODE=$?
set -e
if [ "$DOC_CACHE_CODE" -eq 1 ] && printf '%s\n' "$DOC_CACHE_OUT" | grep -q 'enabled=true but FAILED TO LOAD:.*cache-miss'; then
  ok "doctor distinguishes configured-enabled from loadable (cache-miss is a hard failure)"
else
  bad "doctor did not surface enabled-but-cache-miss as a hard load failure:"$'\n'"$DOC_CACHE_OUT"
fi

# ⓪ 경계 종료 단언: 이 smoke 전체(install 조립 + state + wrapper-uninstall + doctor)가
# 끝난 뒤에도 checkout 안에는 live marketplace source가 생기지 않았다 — source
# origin(repo)과 live artifact(XDG)가 구조적으로 분리됐다는 최종 증명. 미래 회귀가
# repo 내부 ASM을 되살리거나 덮어쓰면(내용 해시 변화 포함) 여기서 잡힌다.
if [ "$(asm_fingerprint)" = "$REPO_ASM_FP_START" ]; then ok "checkout-internal marketplace source is byte-identical before/after — no op created or mutated \$REPO/.assembled (source origin ≠ live artifact)"; else bad "a meta-bridge operation created/mutated \$REPO/pi/meta-bridge/.assembled — repo boundary breached"; fi

echo
if [ "$fail" -eq 0 ]; then echo "smoke-meta-install-state: PASS"; else echo "smoke-meta-install-state: FAIL (see above)"; exit 1; fi
