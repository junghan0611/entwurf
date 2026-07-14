#!/usr/bin/env bash
# smoke-user-scope-citizen — deterministic gate for pi packages[] citizen
# registration/removal (register-pi-package.py). Offline/hermetic: a fake
# settings file + a fake REPO_DIR under $TMP, no pi, no network, no ~/.pi touched.
#
# Guards the wiring that dropped when `pi install` was removed from setup
# (2026-07-03: `--entwurf-control` / `--emacs-agent-socket` unknown in a foreign
# cwd because entwurf was absent from ~/.pi/agent/settings.json packages[]).
# statusline `?` had a tripwire; THIS omission had none and hid until GLG hit it
# in another repo. This gate is that missing tripwire: if the registration ever
# regresses, `pnpm check` goes red.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/.." && pwd)"
REG="$REPO/scripts/register-pi-package.py"

fail=0
ok()  { echo "  ok    $*"; }
bad() { echo "  FAIL  $*"; fail=1; }

command -v python3 >/dev/null || { echo "FAIL: python3 not on PATH"; exit 1; }

TMP="$(mktemp -d -t psa-user-citizen.XXXXXX)"
trap 'rm -rf "$TMP"' EXIT

# Isolation is a property of every root run.sh writes through, not of the one this gate happens
# to override. `remove-user-scope` today reads PI_CODING_AGENT_DIR (settings) and XDG_DATA_HOME
# (ownership state) — passing the operator's real XDG_DATA_HOME is what let this gate delete the
# live MCP key during `pnpm check` (2026-07-14). It does not touch HOME *today*; sandbox HOME and
# the whole XDG trio anyway, so the next root run.sh reaches for is already fenced (AGENTS rule 11).
export HOME="$TMP/home"
export XDG_DATA_HOME="$TMP/xdg"
export XDG_STATE_HOME="$TMP/state"
export XDG_CACHE_HOME="$TMP/cache"
mkdir -p "$HOME" "$XDG_DATA_HOME" "$XDG_STATE_HOME" "$XDG_CACHE_HOME"

S="$TMP/settings.json"
FAKE_REPO="$TMP/fake/entwurf"; mkdir -p "$FAKE_REPO"
RESOLVED="$(cd "$FAKE_REPO" && pwd)"

has_pkg() { python3 -c "import json,sys;p=json.load(open('$S'))['packages'];sys.exit(0 if '$1' in p else 1)"; }
count_entwurf() { python3 -c "import json;p=json.load(open('$S'))['packages'];print(sum(1 for x in p if isinstance((x if isinstance(x,str) else x.get('source')),str) and (x if isinstance(x,str) else x.get('source')).rstrip('/').split('/')[-1]=='entwurf' or (x if isinstance(x,str) else x.get('source'))=='$RESOLVED'))"; }

# 1. absent settings file → created with entwurf registered
python3 "$REG" "$S" "$FAKE_REPO" >/dev/null
if [ -f "$S" ] && has_pkg "$RESOLVED"; then ok "absent settings → entwurf registered (file created)"; else bad "entwurf not registered into a fresh settings file"; fi

# 2. idempotent: second run is a no-op AND does not even rewrite the file (mtime stable)
MT1="$(stat -c %Y "$S")"
sleep 1
OUT2="$(python3 "$REG" "$S" "$FAKE_REPO")"
MT2="$(stat -c %Y "$S")"
if printf '%s' "$OUT2" | grep -q 'no-op'; then ok "second run is a no-op (idempotent)"; else bad "second run was not a no-op: $OUT2"; fi
if [ "$MT1" = "$MT2" ]; then ok "no-op does NOT rewrite the file (mtime stable — strongest idempotence)"; else bad "no-op rewrote the file (mtime changed $MT1 -> $MT2)"; fi
if [ "$(count_entwurf)" = "1" ]; then ok "no duplicate entwurf entry after idempotent re-run"; else bad "duplicate entwurf entries: $(count_entwurf)"; fi

# 3. preserves unrelated packages AND unrelated keys — including look-alike repos
#    whose path merely CONTAINS 'entwurf' and remote repos whose last segment is
#    'entwurf' but are not THIS package.
cat > "$S" <<'JSON'
{
  "defaultProvider": "openai-codex",
  "theme": "glg-dark",
  "packages": ["../../repos/gh/andenken", "git:github.com/badlogic/pi-telegram",
               "/home/me/entwurf-notes", "/x/openclaw-entwurf",
               "git:github.com/someone/entwurf", "https://github.com/someone/entwurf"]
}
JSON
python3 "$REG" "$S" "$FAKE_REPO" >/dev/null
if python3 -c "
import json
d=json.load(open('$S')); p=d['packages']
assert '../../repos/gh/andenken' in p, 'andenken dropped'
assert 'git:github.com/badlogic/pi-telegram' in p, 'pi-telegram dropped'
assert '/home/me/entwurf-notes' in p, 'entwurf-notes wrongly filtered (substring false-positive)'
assert '/x/openclaw-entwurf' in p, 'openclaw-entwurf wrongly filtered (substring false-positive)'
assert 'git:github.com/someone/entwurf' in p, 'foreign git repo named entwurf wrongly filtered'
assert 'https://github.com/someone/entwurf' in p, 'foreign URL repo named entwurf wrongly filtered'
assert '$RESOLVED' in p, 'entwurf missing'
assert d['defaultProvider']=='openai-codex' and d['theme']=='glg-dark', 'unrelated key dropped'
" 2>/dev/null; then ok "preserves unrelated packages incl. look-alikes/foreign entwurf repos and keys"; else bad "clobbered unrelated packages/keys or a look-alike repo"; fi

# 4. stale entwurf paths (bare local 'entwurf' dir, npm install path, explicit npm
#    package source) normalize to one canonical REPO_DIR.
cat > "$S" <<'JSON'
{"packages": ["/old/moved/entwurf", "/some/root/node_modules/@junghanacs/entwurf",
              "npm:@junghanacs/entwurf@0.12.4", "../../repos/gh/andenken"]}
JSON
python3 "$REG" "$S" "$FAKE_REPO" >/dev/null
if python3 -c "
import json
p=json.load(open('$S'))['packages']
assert '/old/moved/entwurf' not in p, 'stale bare-entwurf path not dropped'
assert '/some/root/node_modules/@junghanacs/entwurf' not in p, 'stale npm path not dropped'
assert 'npm:@junghanacs/entwurf@0.12.4' not in p, 'stale explicit npm source not dropped'
assert '$RESOLVED' in p, 'entwurf not normalized to REPO_DIR'
assert '../../repos/gh/andenken' in p, 'andenken dropped'
ent=[x for x in p if isinstance((x if isinstance(x,str) else x.get('source')),str) and ((x if isinstance(x,str) else x.get('source')).rstrip('/').split('/')[-1]=='entwurf' or (x if isinstance(x,str) else x.get('source')).endswith('/node_modules/@junghanacs/entwurf') or (x if isinstance(x,str) else x.get('source'))=='$RESOLVED')]
assert len(ent)==1, f'expected exactly 1 entwurf entry, got {ent}'
" 2>/dev/null; then ok "stale entwurf paths/sources (bare + npm) normalized to a single REPO_DIR"; else bad "stale entwurf normalization failed"; fi

# 5. object-form entwurf entries collapse to one canonical string (no duplicate)
cat > "$S" <<JSON
{"packages": [{"source": "$RESOLVED"}, "../../repos/gh/andenken"]}
JSON
python3 "$REG" "$S" "$FAKE_REPO" >/dev/null
python3 "$REG" "$S" "$FAKE_REPO" >/dev/null   # twice → still one
if python3 -c "
import json
p=json.load(open('$S'))['packages']
srcs=[(x if isinstance(x,str) else x.get('source')) for x in p]
assert srcs.count('$RESOLVED')==1, f'object-form produced duplicate/none: {p}'
assert all(not isinstance(x,dict) or x.get('source')!='$RESOLVED' for x in p), 'object-form entwurf survived (should collapse to string)'
assert '../../repos/gh/andenken' in p, 'andenken dropped'
" 2>/dev/null; then ok "object-form entwurf collapses to a single canonical string (no dup across re-runs)"; else bad "object-form entwurf caused a duplicate or survived as object"; fi

# 6. a non-object settings file fails loud (never silently wipes operator config)
echo '[]' > "$S"
if python3 "$REG" "$S" "$FAKE_REPO" >/dev/null 2>&1; then bad "non-object settings should fail, not overwrite"; else ok "non-object settings fails loud (no silent clobber)"; fi

# 7. a non-array packages value fails loud (never silently coerced to [])
echo '{"packages": {"broken": true}}' > "$S"
if python3 "$REG" "$S" "$FAKE_REPO" >/dev/null 2>&1; then bad "non-array packages should fail, not coerce to []"; else ok "non-array packages fails loud (no silent drop of operator packages)"; fi

# 8. --remove drops every entwurf entry but preserves unrelated + look-alikes
#    (symmetric with install: same is_entwurf_source predicate, no over-delete).
cat > "$S" <<JSON
{"packages": ["$RESOLVED", "../../repos/gh/andenken", "/home/me/entwurf-notes"]}
JSON
python3 "$REG" "$S" "$FAKE_REPO" --remove >/dev/null
if python3 -c "
import json
p=json.load(open('$S'))['packages']
assert '$RESOLVED' not in p, 'entwurf not removed'
assert '../../repos/gh/andenken' in p, 'andenken over-removed'
assert '/home/me/entwurf-notes' in p, 'entwurf-notes over-removed (substring over-delete)'
" 2>/dev/null; then ok "--remove drops entwurf, preserves unrelated + look-alikes (symmetric with install)"; else bad "--remove over-deleted a look-alike or missed entwurf"; fi

# 9. --dry-run remove REPORTS the count and writes NOTHING (backs run.sh's project
#    `remove` pointer note that suggests the global inverse only when relevant).
cat > "$S" <<JSON
{"packages": ["$RESOLVED", "../../repos/gh/andenken"]}
JSON
MT_DR="$(stat -c %Y "$S")"; sleep 1
OUT_DR="$(python3 "$REG" "$S" "$FAKE_REPO" --remove --dry-run)"
MT_DR2="$(stat -c %Y "$S")"
if printf '%s' "$OUT_DR" | grep -q 'would remove 1'; then ok "--dry-run reports 'would remove' count"; else bad "--dry-run did not report the would-remove count: $OUT_DR"; fi
if [ "$MT_DR" = "$MT_DR2" ] && has_pkg "$RESOLVED"; then ok "--dry-run writes nothing (entry intact, mtime stable)"; else bad "--dry-run mutated settings (mtime $MT_DR -> $MT_DR2)"; fi
OUT_DR_NONE="$(python3 "$REG" "$TMP/absent.json" "$FAKE_REPO" --remove --dry-run)"
if printf '%s' "$OUT_DR_NONE" | grep -q 'no entwurf'; then ok "--dry-run on an entwurf-free file reports nothing to remove"; else bad "--dry-run false-positive on absent entry: $OUT_DR_NONE"; fi

# 9b. --dry-run WITHOUT --remove must FAIL LOUD and write nothing. A flag named
#     "dry-run" that falls through to the register write path and mutates settings
#     is an install-hygiene footgun (GPT blocker, 2026-07-03).
cat > "$S" <<'JSON'
{"packages": ["../../repos/gh/andenken"]}
JSON
MT_DRR="$(stat -c %Y "$S")"; sleep 1
if python3 "$REG" "$S" "$FAKE_REPO" --dry-run >/dev/null 2>&1; then bad "--dry-run without --remove should fail loud, not register"; else ok "--dry-run without --remove fails loud (never a silent write)"; fi
MT_DRR2="$(stat -c %Y "$S")"
if [ "$MT_DRR" = "$MT_DRR2" ] && ! has_pkg "$RESOLVED"; then ok "--dry-run without --remove wrote nothing (mtime stable, no entwurf entry added)"; else bad "--dry-run without --remove mutated settings (mtime $MT_DRR -> $MT_DRR2)"; fi
if python3 "$REG" "$S" "$FAKE_REPO" --bogus >/dev/null 2>&1; then bad "unknown flag should be rejected"; else ok "unknown flag rejected (fail-loud parser)"; fi

# 10. the run.sh SHELL path `remove-user-scope` reaches the SAME SSOT against a
#     PI_CODING_AGENT_DIR-overridden ~/.pi/agent — proves install's user-scope
#     inverse is REACHABLE from run.sh, not only from the python SSOT (the gap GPT
#     flagged: remove symmetry existed at the SSOT but no run.sh path exercised it).
#     REPO_DIR (run.sh's own dir) is the real checkout, so seed THAT as the entry.
RUN="$REPO/run.sh"
AGENT_DIR="$TMP/agent"; mkdir -p "$AGENT_DIR"
US="$AGENT_DIR/settings.json"
cat > "$US" <<JSON
{"defaultProvider": "openai-codex", "packages": ["$REPO", "../../repos/gh/andenken"]}
JSON
# remove-user-scope uses BOTH PI_CODING_AGENT_DIR (settings target) and XDG_DATA_HOME
# (ownership-state authority). Isolating only the former lets the fake inverse consume the
# operator's real state, follow its recorded managedSettingsPath, and remove the live MCP key.
XDG_DATA_HOME="$TMP/xdg" PI_CODING_AGENT_DIR="$AGENT_DIR" bash "$RUN" remove-user-scope >/dev/null 2>&1 || bad "run.sh remove-user-scope exited non-zero"
if python3 -c "
import json
d=json.load(open('$US')); p=d['packages']
assert '$REPO' not in p, 'run.sh remove-user-scope did not drop the global entwurf entry'
assert '../../repos/gh/andenken' in p, 'run.sh remove-user-scope over-removed an unrelated package'
assert d['defaultProvider']=='openai-codex', 'run.sh remove-user-scope dropped an unrelated key'
" 2>/dev/null; then ok "run.sh remove-user-scope drops the global citizen, preserves unrelated (SSOT reached via shell)"; else bad "run.sh remove-user-scope path failed"; fi
# idempotent: a second remove-user-scope is a clean no-op (no crash on absent entry)
if XDG_DATA_HOME="$TMP/xdg" PI_CODING_AGENT_DIR="$AGENT_DIR" bash "$RUN" remove-user-scope >/dev/null 2>&1; then ok "run.sh remove-user-scope is idempotent (no-op second run)"; else bad "run.sh remove-user-scope second run crashed"; fi

echo
if [ "$fail" -eq 0 ]; then echo "smoke-user-scope-citizen: PASS"; else echo "smoke-user-scope-citizen: FAIL (see above)"; exit 1; fi
