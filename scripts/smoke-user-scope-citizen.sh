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
#
# Cells 11–13 close the second omission (#53 B): every case here drove a fake
# settings file with ABSOLUTE entries, so the portable, settings-relative form this
# repo actually commits was never registered against — and `setup` duplicated and
# restyled the tracked file for four cuts without a single gate seeing it.
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

# ── 11–13. #53 B: install must not dirty a tracked, formatter-governed settings file
# The cell whose ABSENCE let this ship. Every case above drove a fake settings file
# with absolute entries, so the one shape this repo actually commits — the portable,
# settings-relative `".."` that check-install-surface S7c pins — was never registered
# against. `setup` therefore appended the absolute path BESIDE it and rewrote the
# tracked, biome-owned bytes at indent=2, and `pnpm check` died at step 1 reading
# "format error" instead of "install wrote this".
#
# The seed is the repo's OWN committed settings, copied into a stand-in checkout so
# `".."` resolves to that clone rather than to the real repo (nothing here touches
# $REPO). Setup landing is PROVEN before any product verdict: if the seed is not the
# portable form, this says SETUP MISS in its own name instead of blaming the code.
CLONE="$TMP/selfclone"; mkdir -p "$CLONE/.pi"
CS="$CLONE/.pi/settings.json"
seed_src=""
if (cd "$REPO" && git show :.pi/settings.json) > "$CS" 2>/dev/null && [ -s "$CS" ]; then
  seed_src="candidate index"
elif cp "$REPO/.pi/settings.json" "$CS" 2>/dev/null; then
  seed_src="worktree"
fi
if [ ! -s "$CS" ]; then
  bad "11 SETUP MISS: could not seed this repo's own .pi/settings.json (no git object, no worktree file)"
elif ! python3 -c "
import json,sys
p=json.load(open(sys.argv[1])).get('packages')
sys.exit(0 if p==['..'] else 1)" "$CS"; then
  bad "11 SETUP MISS: the seed ($seed_src) is not the committed portable form (packages != ['..']) — product verdict withheld"
else
  BEFORE="$(sha256sum "$CS" | cut -d' ' -f1)"; MT_B="$(stat -c %Y "$CS")"; sleep 1
  OUT_SELF="$(python3 "$REG" "$CS" "$CLONE")"
  AFTER="$(sha256sum "$CS" | cut -d' ' -f1)"; MT_A="$(stat -c %Y "$CS")"
  if printf '%s' "$OUT_SELF" | grep -q 'no-op'; then
    ok "11 register against this repo's OWN committed settings is a no-op (seed: $seed_src)"
  else
    bad "11 register duplicated/absolutized the portable '..' entry" "$OUT_SELF"
  fi
  if [ "$BEFORE" = "$AFTER" ] && [ "$MT_B" = "$MT_A" ]; then
    ok "11b the tracked, formatter-governed bytes are UNCHANGED (sha256 + mtime)"
  else
    bad "11b install rewrote the tracked settings file (sha $BEFORE -> $AFTER, mtime $MT_B -> $MT_A)"
  fi
  # The inverse direction of the same asymmetry: the shared matcher now RECOGNIZES
  # `".."`, so an uninstall that deleted it would edit committed source — the same
  # defect pointed the other way. remove leaves it and says so; dry-run agrees,
  # because both ask one predicate.
  BEFORE_R="$(sha256sum "$CS" | cut -d' ' -f1)"
  OUT_RM="$(python3 "$REG" "$CS" "$CLONE" --remove)"
  OUT_DRY="$(python3 "$REG" "$CS" "$CLONE" --remove --dry-run)"
  if [ "$BEFORE_R" = "$(sha256sum "$CS" | cut -d' ' -f1)" ]; then
    ok "11c --remove does NOT delete the committed portable entry (bytes unchanged)"
  else
    bad "11c --remove edited the repo's committed settings source" "$OUT_RM"
  fi
  if printf '%s' "$OUT_RM" | grep -q 'kept 1 settings-relative'; then
    ok "11d the inverse REPORTS what it deliberately left behind (never a silent partial uninstall)"
  else
    bad "11d --remove left the entry without saying so" "$OUT_RM"
  fi
  if printf '%s' "$OUT_DRY" | grep -q 'no entwurf packages\[\] entry to remove'; then
    ok "11e --dry-run agrees with remove (one predicate, no over-report)"
  else
    bad "11e --dry-run disagreed with what remove actually does" "$OUT_DRY"
  fi
fi

# 12. the state a pre-fix `setup` already left on real hosts: the portable entry AND
#     the absolute one. The repair must collapse onto the PORTABLE form — absolutizing
#     it would fix the duplicate and dirty the tracked bytes in the same breath.
DUP="$TMP/dupclone"; mkdir -p "$DUP/.pi"
DS="$DUP/.pi/settings.json"
cat > "$DS" <<JSON
{"packages": ["..", "$DUP", "../../repos/gh/andenken"]}
JSON
python3 "$REG" "$DS" "$DUP" >/dev/null
if python3 -c "
import json
p=json.load(open('$DS'))['packages']
assert p.count('..')==1, f'the portable entry did not survive as the sole self-reference: {p}'
assert '$DUP' not in p, f'the absolute path was written beside/instead of the portable one: {p}'
assert '../../repos/gh/andenken' in p, 'unrelated relative package dropped'
" 2>/dev/null; then ok "12 a duplicated ('..' + absolute) settings file repairs onto the PORTABLE entry"; else bad "12 the duplicate repair absolutized or dropped the portable entry: $(cat "$DS")"; fi

# 13. a genuine rewrite keeps the file's own indent unit. Narrow by design: it does
#     NOT make the output formatter-clean (biome also decides where short arrays
#     collapse), which is why byte-identity for this repo's own file rests on the
#     no-op above, not on the writer's style.
printf '{\n\t"packages": [\n\t\t"/old/moved/entwurf"\n\t]\n}\n' > "$S"
python3 "$REG" "$S" "$FAKE_REPO" >/dev/null
if grep -q $'^\t"packages"' "$S"; then ok "13 a rewrite preserves the file's tab indentation (never forces 2 spaces)"; else bad "13 the rewrite restyled a file it does not own: $(cat -A "$S" | head -3)"; fi

# ── 14. THE cell #53 B needed: the whole `run.sh install` drive, end to end ──
# Cells 11–13 call ONE python writer. That is what let the second round ship: the same
# settings file has TWO writers (register-pi-package for packages[], register-pi-provider
# for entwurfProvider.mcpServers) plus a user-scope side effect, and closing only the
# first left `install` still re-serializing this repo's tracked, biome-governed bytes at
# indent=2 — semantically a no-op, byte-wise a RED `pnpm check` diagnosed as "formatting".
# A per-writer cell can never see that; only the real drive can. So this one runs
# `run.sh install <checkout>` for real and demands sha256 + mtime invariance.
#
# The checkout is a stand-in: run.sh resolves its OWN symlinks to find REPO_DIR, so
# run.sh is COPIED (a link would point the drive back at the operator's real repo) while
# the trees it only reads are linked. That makes REPO_DIR == the stand-in, which is the
# shape that matters — `".."` in <checkout>/.pi/settings.json resolves to the very repo
# being registered, exactly as it does in a dev clone.
CK="$TMP/checkout"
mkdir -p "$CK/.pi"
cp "$REPO/run.sh" "$CK/run.sh"
for entry in scripts node_modules package.json mcp pi-extensions pi protocol.js; do
  [ -e "$REPO/$entry" ] && ln -s "$REPO/$entry" "$CK/$entry"
done
CKS="$CK/.pi/settings.json"
ck_seed=""
if (cd "$REPO" && git show :.pi/settings.json) > "$CKS" 2>/dev/null && [ -s "$CKS" ]; then
  ck_seed="candidate index"
elif cp "$REPO/.pi/settings.json" "$CKS" 2>/dev/null; then
  ck_seed="worktree"
fi
# Landing is PROVEN before any product verdict — a bad seed or a drive that died for its
# own reasons is SETUP MISS, never "install dirtied the file".
if [ ! -s "$CKS" ]; then
  bad "14 SETUP MISS: could not seed the stand-in checkout's .pi/settings.json"
elif ! python3 -c "
import json,sys
d=json.load(open(sys.argv[1]))
sys.exit(0 if d.get('packages')==['..'] and isinstance(d.get('entwurfProvider'),dict) else 1)" "$CKS"; then
  bad "14 SETUP MISS: the seed ($ck_seed) is not the committed portable form (packages ['..'] + entwurfProvider)"
else
  CK_BEFORE="$(sha256sum "$CKS" | cut -d' ' -f1)"; CK_MT="$(stat -c %Y "$CKS")"
  sleep 1
  set +e
  # Isolated on the same line as the drive, not only by the exports above: this is a
  # MUTATING run.sh command and it writes through three roots (agent dir, XDG state,
  # $HOME for the user-scope registration). check-install-surface S5c matches the drive
  # and then demands exactly these — which is why the path is unquoted here, so the
  # tripwire can SEE the drive it is meant to police.
  ck_out="$(HOME="$TMP/home" XDG_DATA_HOME="$TMP/xdg" XDG_STATE_HOME="$TMP/state" XDG_CACHE_HOME="$TMP/cache" PI_CODING_AGENT_DIR="$TMP/agent14" bash $CK/run.sh install "$CK" 2>&1)"
  ck_rc=$?
  set -e
  if [ "$ck_rc" != 0 ]; then
    bad "14 SETUP MISS: the stand-in \`run.sh install\` drive did not complete (exit $ck_rc) — no byte verdict from a drive that failed for its own reasons" "$ck_out"
  else
    ok "14 the stand-in \`run.sh install\` drive completed (seed: $ck_seed)"
    if [ "$CK_BEFORE" = "$(sha256sum "$CKS" | cut -d' ' -f1)" ] && [ "$CK_MT" = "$(stat -c %Y "$CKS")" ]; then
      ok "14b end-to-end: install left the tracked .pi/settings.json byte-identical (sha256 + mtime)"
    else
      bad "14b \`run.sh install\` rewrote the tracked settings file — one of its writers does not know the contract" "$(diff <(printf '%s' "$CK_BEFORE") <(sha256sum "$CKS" | cut -d' ' -f1); cat -A "$CKS" | head -6)"
    fi
    # The drive really did reach the writers (a no-op that never ran proves nothing), and
    # the user-scope side effect landed in the sandbox rather than the operator's home.
    case "$ck_out" in
      *"entwurf-bridge"*) ok "14c the provider writer really ran (it reported its classification)" ;;
      *) bad "14c the drive never reached the provider writer — 14b would be vacuous" "$ck_out" ;;
    esac
    if [ -f "$TMP/agent14/settings.json" ]; then
      ok "14d the user-scope registration landed in the SANDBOX agent dir (isolation held)"
    else
      bad "14d the user-scope citizen was not written under the sandboxed PI_CODING_AGENT_DIR" "$ck_out"
    fi
  fi
fi

# 15. WIRING: both writers of this one file must share the serializer, not copy it.
#     A duplicated indent-detector is how the provider writer stayed open after the
#     package writer was closed; a parity check is cheaper than a third round.
for w in register-pi-package.py register-pi-provider.py; do
  if grep -q "from pi_settings_io import" "$REPO/scripts/$w"; then
    ok "15 $w routes through the shared pi_settings_io serializer"
  else
    bad "15 $w serializes settings on its own again (copied rule = the #53 B shape)"
  fi
done

echo
if [ "$fail" -eq 0 ]; then echo "smoke-user-scope-citizen: PASS"; else echo "smoke-user-scope-citizen: FAIL (see above)"; exit 1; fi
