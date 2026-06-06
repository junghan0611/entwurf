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

export HOME="$TMP/home"
export CLAUDE_CONFIG_DIR="$HOME/.claude"
mkdir -p "$CLAUDE_CONFIG_DIR"
ASM="$TMP/assembled-marketplace"
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
    "allow": ["Read", "CustomUserTool"],
    "deny": ["Agent"]
  },
  "env": {
    "DISABLE_AUTOCOMPACT": "0",
    "KEEP_ME": "yes"
  },
  "promptSuggestionEnabled": true,
  "skipDangerousModePermissionPrompt": false,
  "showTurnDuration": true
}
JSON
cat > "$HOME/.claude.json" <<'JSON'
{
  "mcpServers": {
    "pi-tools-bridge": {
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

py prepare >/dev/null
STATE_FILE="$CLAUDE_CONFIG_DIR/pi-shell-acp.install-state.json"
[ -f "$STATE_FILE" ] && ok "prepare writes install-state before any merge" || bad "state file missing after prepare"
if python3 - <<'PY'
import json, os, stat
path=os.environ['CLAUDE_CONFIG_DIR'] + '/pi-shell-acp.install-state.json'
assert stat.S_IMODE(os.stat(path).st_mode) == 0o600
s=json.load(open(path))
assert s['files']['settings']['keys']['enabledPlugins.entwurf-meta-receive@meta-bridge-local']['original']['value'] is False
assert s['files']['settings']['keys']['cleanupPeriodDays']['original']['value'] == 30
assert s['files']['settings']['keys']['env.DISABLE_AUTOCOMPACT']['original']['value'] == '0'
assert s['files']['settings']['keys']['promptSuggestionEnabled']['original']['value'] is True
assert s['files']['settings']['keys']['autoCompactEnabled']['original']['existed'] is False
assert s['files']['claudeRoot']['keys']['mcpServers.pi-tools-bridge']['original']['value']['command'] == 'old'
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
for key in ['promptSuggestionEnabled','awaySummaryEnabled','autoMemoryEnabled','verbose','autoCompactEnabled','showTurnDuration','terminalProgressBarEnabled','useAutoModeDuringPlan']:
    assert settings[key] is False, key
assert settings['skipDangerousModePermissionPrompt'] is True
for item in ['Bash','Read','Write','Edit','Grep','Glob','WebFetch','WebSearch','Skill','mcp__pi-tools-bridge__*']:
    assert item in settings['permissions']['allow'], item
assert settings['permissions']['allow'].count('Read') == 1
assert 'keep-server' in root['mcpServers']
assert root['mcpServers']['pi-tools-bridge']['env']['PI_TOOLS_BRIDGE_EXTERNAL_AGENT_ID'] == 'external-mcp/claude-code'
PY
then ok "apply installs managed keyset without clobbering unrelated keys"; else bad "apply keyset check failed"; fi

# Re-run prepare/apply after install: the original snapshot must remain the
# pre-install values, not the already-managed values.
py prepare >/dev/null
py apply >/dev/null
if python3 - <<'PY'
import json, os
s=json.load(open(os.environ['CLAUDE_CONFIG_DIR'] + '/pi-shell-acp.install-state.json'))
assert s['files']['settings']['keys']['enabledPlugins.entwurf-meta-receive@meta-bridge-local']['original']['value'] is False
assert s['files']['settings']['keys']['cleanupPeriodDays']['original']['value'] == 30
assert s['files']['settings']['keys']['env.DISABLE_AUTOCOMPACT']['original']['value'] == '0'
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
assert settings['promptSuggestionEnabled'] is True
assert settings['skipDangerousModePermissionPrompt'] is False
assert settings['showTurnDuration'] is True
for key in ['awaySummaryEnabled','autoMemoryEnabled','verbose','autoCompactEnabled','terminalProgressBarEnabled','useAutoModeDuringPlan']:
    assert key not in settings, key
allow=settings['permissions']['allow']
deny=settings['permissions']['deny']
assert 'CustomUserTool' in allow and 'UserAfterInstall' in allow
assert 'Bash' not in allow and 'mcp__pi-tools-bridge__*' not in allow
assert 'Agent' in deny and 'UserDeniedAfterInstall' in deny and 'TaskCreate' not in deny
assert root['mcpServers']['pi-tools-bridge']['command'] == 'old'
assert 'keep-server' in root['mcpServers']
assert not os.path.exists(os.environ['CLAUDE_CONFIG_DIR'] + '/pi-shell-acp.install-state.json')
PY
then ok "uninstall restores scalars/maps and removes only managed array additions"; else bad "uninstall restoration check failed"; fi

if py uninstall >/dev/null 2>&1; then bad "state manager uninstall without state should not guess"; else ok "state manager uninstall without state fails instead of guessing"; fi

# The wrapper must ALSO refuse before side effects. A fake claude records whether
# plugin/MCP removals were attempted; no state means the log must stay empty.
FAKE_BIN="$TMP/fake-bin"; mkdir -p "$FAKE_BIN"
cat > "$FAKE_BIN/claude" <<'SH'
#!/usr/bin/env bash
printf '%s\n' "$*" >> "$FAKE_CLAUDE_LOG"
exit 0
SH
chmod +x "$FAKE_BIN/claude"
FAKE_CLAUDE_LOG="$TMP/fake-claude-nostate.log"
if PATH="$FAKE_BIN:$PATH" FAKE_CLAUDE_LOG="$FAKE_CLAUDE_LOG" bash "$REPO/scripts/meta-bridge-uninstall.sh" >/dev/null 2>&1; then
  bad "wrapper uninstall without state should fail"
else
  if [ ! -s "$FAKE_CLAUDE_LOG" ]; then ok "wrapper uninstall without state has zero Claude side effects"; else bad "wrapper uninstall without state touched Claude: $(cat "$FAKE_CLAUDE_LOG")"; fi
fi

# With valid state, the wrapper may remove Claude registrations and then restore
# JSON state. This proves the preflight gate is ordered before side effects.
py prepare >/dev/null
py apply >/dev/null
FAKE_CLAUDE_LOG="$TMP/fake-claude-state.log"
if PATH="$FAKE_BIN:$PATH" FAKE_CLAUDE_LOG="$FAKE_CLAUDE_LOG" bash "$REPO/scripts/meta-bridge-uninstall.sh" >/dev/null 2>&1; then
  if grep -q 'plugin uninstall entwurf-meta-receive@meta-bridge-local' "$FAKE_CLAUDE_LOG" && grep -q 'mcp remove pi-tools-bridge -s user' "$FAKE_CLAUDE_LOG" && [ ! -f "$STATE_FILE" ]; then
    ok "wrapper uninstall with valid state removes Claude registrations and restores state"
  else
    bad "wrapper uninstall with state missed expected side effects/state removal"
  fi
else
  bad "wrapper uninstall with valid state failed"
fi

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
root={'mcpServers': {'pi-tools-bridge': {'type':'stdio','command':'bash','args':[repo + '/mcp/pi-tools-bridge/start.sh'],'env': {'PI_TOOLS_BRIDGE_EXTERNAL_AGENT_ID':'external-mcp/claude-code'}}}}
json.dump(settings, open(cfg + '/settings.json','w'), indent=2); open(cfg + '/settings.json','a').write('\n')
json.dump(root, open(home + '/.claude.json','w'), indent=2); open(home + '/.claude.json','a').write('\n')
PY
py prepare >/dev/null
if python3 - <<'PY'
import json, os
s=json.load(open(os.environ['CLAUDE_CONFIG_DIR'] + '/pi-shell-acp.install-state.json'))
assert s['files']['settings']['keys']['enabledPlugins.entwurf-meta-receive@meta-bridge-local']['original']['existed'] is False
assert s['files']['settings']['keys']['extraKnownMarketplaces.meta-bridge-local']['original']['existed'] is False
assert s['files']['claudeRoot']['keys']['mcpServers.pi-tools-bridge']['original']['existed'] is False
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
assert 'pi-tools-bridge' not in root.get('mcpServers', {})
assert settings['env']['DISABLE_AUTOCOMPACT'] == '1'
PY
then ok "legacy migration uninstall removes pi-owned wiring but preserves policy scalar"; else bad "legacy migration uninstall check failed"; fi

# Store-doctor hardening: valid store passes, corrupt/duplicate/drift fail loudly.
valid_record() {
  local gid="$1" native="$2"
  cat <<JSON
{
  "schemaVersion": 1,
  "gardenId": "$gid",
  "backend": "claude-code",
  "nativeSessionId": "$native",
  "transcriptPath": "/tmp/$native.jsonl",
  "cwd": "/tmp",
  "createdAt": "2026-06-06T00:00:00.000Z",
  "lastSeen": "2026-06-06T00:00:00.000Z",
  "delivery": {
    "wakeMode": "self-fetch",
    "deliveryLevel": "D6",
    "lastEnqueuedAt": null,
    "lastDeliveredAt": null,
    "lastReadAt": null
  }
}
JSON
}
STORE="$TMP/store"; export STORE; mkdir -p "$STORE"
valid_record "20260606T000000-aaaaaa" "native-a" > "$STORE/20260606T000000-aaaaaa.meta.json"
valid_record "20260606T000001-bbbbbb" "native-b" > "$STORE/20260606T000001-bbbbbb.meta.json"
if node --experimental-strip-types "$STORE_DOCTOR" "$STORE" >/dev/null; then ok "store doctor accepts valid records"; else bad "store doctor rejected valid records"; fi
cp "$STORE/20260606T000000-aaaaaa.meta.json" "$STORE/20260606T000002-cccccc.meta.json"
if node --experimental-strip-types "$STORE_DOCTOR" "$STORE" >/dev/null 2>&1; then bad "store doctor missed body/filename drift + duplicate"; else ok "store doctor fails on body/filename drift and duplicate nativeSessionId"; fi
rm "$STORE/20260606T000002-cccccc.meta.json"
python3 - <<'PY'
import json, os
p=os.environ['STORE'] + '/20260606T000001-bbbbbb.meta.json'
d=json.load(open(p)); d['delivery']['wakeMode']='direct-inject'; json.dump(d, open(p,'w'), indent=2); open(p,'a').write('\n')
PY
if node --experimental-strip-types "$STORE_DOCTOR" "$STORE" >/dev/null 2>&1; then bad "store doctor missed backend↔wakeMode contradiction"; else ok "store doctor fails on backend↔wakeMode contradiction"; fi

echo
if [ "$fail" -eq 0 ]; then echo "smoke-meta-install-state: PASS"; else echo "smoke-meta-install-state: FAIL (see above)"; exit 1; fi
