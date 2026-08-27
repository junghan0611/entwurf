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
# regresses, `pnpm run check:full` goes red.
#
# Cells 11–13 close the second omission (#53 B): every case here drove a fake
# settings file with ABSOLUTE entries, so the portable, settings-relative form this
# repo actually commits was never registered against — and `setup` duplicated and
# restyled the tracked file for four cuts without a single gate seeing it.
set -euo pipefail
export PYTHONDONTWRITEBYTECODE=1 # snapshot purity: no ignored scripts/__pycache__ writes under qualification

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
    if printf '%s' "$ck_out" | grep -q 'repo dependency integrity check failed'; then
      # Snapshot honesty: the stand-in drive needs the bundled runtime deps to
      # resolve (node_modules), which a tracked-files-only checkout — e.g. the
      # gate-qualification snapshot — does not have. The byte-identity property is
      # untestable there, not violated: a named skip, never a FAIL and never an ok.
      echo "  skip  14 stand-in \`run.sh install\` drive skipped: bundled deps unresolvable in this checkout (no node_modules — snapshot shape); byte verdict untestable here"
    else
      bad "14 SETUP MISS: the stand-in \`run.sh install\` drive did not complete (exit $ck_rc) — no byte verdict from a drive that failed for its own reasons" "$ck_out"
    fi
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

# ── 16–25. #86 C2: user-scope OWNERSHIP — explicit takeover, same-owner inverse ──
# Axes fixed here (literal cells, no matrix framework): first/same root · legacy
# same-root adoption · legacy other-root refuse · live-other normal-install refuse
# · operator-explicit takeover · old-root inverse refusal · missing-owner normal
# refusal + doctor verdict · aligned orphan remove (run.sh path) · package/provider
# state mismatch refusal · ATOMIC two-writer refusals for install/remove/takeover
# (cells 26–29: the refusing half leaves the other half byte-identical) ·
# provider-absent orphan refusal (30) · doctor ownership-coupling mismatch (31) ·
# exact-owner classifier vs a second entwurf-shaped root: install/inverse/takeover
# refuse + doctor red (32–33, B blockers 1–2) · typed installerRoot corrupt
# fail-closed across install/remove/doctor (34, B blocker 3) ·
# look-alike + settings-relative + project-local preservation (cells 3/8/11 above
# keep owning those three). EXCLUDED by design: C3/Copilot, credentials,
# platform/Windows, provider RUNTIME verdicts (doctor-pi-provider owns those).
# Every cell builds its own fixtures so one planted production defect fails
# exactly its own cell.
US_ROOT_A="$TMP/own/checkout-a/entwurf"; mkdir -p "$US_ROOT_A"
US_ROOT_B="$TMP/own/checkout-b/entwurf"; mkdir -p "$US_ROOT_B"
c2_reset() { # $1=cell tag → sets OS (settings), OST (pkg state) fresh
  OS="$TMP/own/$1-settings.json"; OST="$TMP/own/$1-pkg-state.json"
  rm -f "$OS" "$OST"
}

# 16. first root: fresh install writes the owner state (packageRoot + managedSettingsPath)
c2_reset c16
python3 "$REG" "$OS" "$US_ROOT_A" --scope user --state "$OST" >/dev/null
if python3 -c "
import json,sys
st=json.load(open('$OST'))
assert st['packageRoot']=='$US_ROOT_A', st
assert st['managedSettingsPath'].endswith('c16-settings.json'), st
p=json.load(open('$OS'))['packages']; assert '$US_ROOT_A' in p, p
" 2>/dev/null; then ok "16 fresh user-scope install records the owner (packageRoot + managedSettingsPath)"; else bad "16 owner state missing/wrong after fresh install"; fi

# 17. same root re-run: no-op, mtime stable, state intact
MT16="$(stat -c %Y "$OS")"; sleep 1
OUT17="$(python3 "$REG" "$OS" "$US_ROOT_A" --scope user --state "$OST")"
if printf '%s' "$OUT17" | grep -q 'no-op' && [ "$MT16" = "$(stat -c %Y "$OS")" ]; then ok "17 same-owner re-install is a no-op (mtime stable)"; else bad "17 same-owner re-install rewrote or refused: $OUT17"; fi

# 18. legacy no-state entry EXACTLY this root → adoption: state written, settings bytes/mtime untouched
c2_reset c18
printf '{"packages": ["%s", "../../repos/gh/andenken"]}\n' "$US_ROOT_A" > "$OS"
SHA18="$(sha256sum "$OS" | cut -d' ' -f1)"; MT18="$(stat -c %Y "$OS")"; sleep 1
OUT18="$(python3 "$REG" "$OS" "$US_ROOT_A" --scope user --state "$OST")"
if printf '%s' "$OUT18" | grep -q 'adopted legacy' && [ -f "$OST" ] \
   && [ "$SHA18" = "$(sha256sum "$OS" | cut -d' ' -f1)" ] && [ "$MT18" = "$(stat -c %Y "$OS")" ]; then
  ok "18 legacy same-root entry is ADOPTED (state written; settings bytes+mtime untouched)"
else bad "18 legacy same-root adoption failed or touched settings: $OUT18"; fi

# 19. legacy no-state entries that do NOT exactly name this root → refuse, zero write
c2_reset c19
printf '{"packages": ["/old/moved/entwurf", "../../repos/gh/andenken"]}\n' > "$OS"
SHA19="$(sha256sum "$OS" | cut -d' ' -f1)"
if python3 "$REG" "$OS" "$US_ROOT_A" --scope user --state "$OST" >/dev/null 2>&1; then
  bad "19 ambiguous legacy entries were silently normalized (must refuse)"
elif [ "$SHA19" = "$(sha256sum "$OS" | cut -d' ' -f1)" ] && [ ! -e "$OST" ]; then
  ok "19 ambiguous/other legacy no-state entries REFUSE (zero settings write, no state minted)"
else bad "19 the legacy refusal wrote settings or state"; fi

# 20. live other owner: NORMAL install from root B refuses — zero write, takeover named
c2_reset c20
python3 "$REG" "$OS" "$US_ROOT_A" --scope user --state "$OST" >/dev/null
SHA20="$(sha256sum "$OS" | cut -d' ' -f1)"
set +e; OUT20="$(python3 "$REG" "$OS" "$US_ROOT_B" --scope user --state "$OST" 2>&1)"; RC20=$?; set -e
L20="20 a LIVE other owner makes normal install a zero-write refusal, never a silent replace [QK:SILENT-TAKEOVER]"
if [ "$RC20" -ne 0 ] && [ "$SHA20" = "$(sha256sum "$OS" | cut -d' ' -f1)" ] \
   && [ "$(python3 -c "import json;print(json.load(open('$OST'))['packageRoot'])")" = "$US_ROOT_A" ]; then
  ok "$L20"
else bad "$L20 — violated (rc=$RC20): $OUT20"; fi
if printf '%s' "$OUT20" | grep -q 'takeover-user-scope'; then ok "20b the refusal names the explicit takeover action"; else bad "20b refusal does not point at takeover-user-scope: $OUT20"; fi

# 21. operator-explicit takeover: old→new replace, both roots reported, state moves
OUT21="$(python3 "$REG" "$OS" "$US_ROOT_B" --scope user --state "$OST" --takeover)"
if printf '%s' "$OUT21" | grep -q "moved $US_ROOT_A -> $US_ROOT_B" \
   && [ "$(python3 -c "import json;print(json.load(open('$OST'))['packageRoot'])")" = "$US_ROOT_B" ] \
   && python3 -c "
import json;p=json.load(open('$OS'))['packages']
assert '$US_ROOT_B' in p and '$US_ROOT_A' not in p, p" 2>/dev/null; then
  ok "21 explicit takeover replaces old→new and REPORTS both roots"
else bad "21 takeover did not replace/report correctly: $OUT21 / $(cat "$OS")"; fi

# 22. old root's inverse after takeover: LIVE foreign owner → remove refuses, zero write
SHA22="$(sha256sum "$OS" | cut -d' ' -f1)"
set +e; OUT22="$(python3 "$REG" "$OS" "$US_ROOT_A" --scope user --state "$OST" --remove 2>&1)"; RC22=$?; set -e
L22="22 an old root's inverse cannot remove the LIVE current owner's registration [QK:FOREIGN-INVERSE-REMOVE]"
if [ "$RC22" -ne 0 ] && [ "$SHA22" = "$(sha256sum "$OS" | cut -d' ' -f1)" ] && [ -f "$OST" ]; then
  ok "$L22"
else bad "$L22 — violated (rc=$RC22): $OUT22"; fi

# 23. missing owner: normal install still refuses; doctor names missing-owner
c2_reset c23
MISSING_ROOT="$TMP/own/gone/entwurf"; mkdir -p "$MISSING_ROOT"
python3 "$REG" "$OS" "$MISSING_ROOT" --scope user --state "$OST" >/dev/null
rm -rf "$TMP/own/gone"
SHA23="$(sha256sum "$OS" | cut -d' ' -f1)"
set +e; OUT23="$(python3 "$REG" "$OS" "$US_ROOT_A" --scope user --state "$OST" 2>&1)"; RC23=$?; set -e
L23="23 a MISSING owner still refuses a normal install — no auto-takeover of an orphan [QK:MISSING-OWNER-AUTO-TAKEOVER]"
if [ "$RC23" -ne 0 ] && [ "$SHA23" = "$(sha256sum "$OS" | cut -d' ' -f1)" ] \
   && [ "$(python3 -c "import json;print(json.load(open('$OST'))['packageRoot'])")" = "$MISSING_ROOT" ]; then
  ok "$L23"
else bad "$L23 — violated (rc=$RC23): $OUT23"; fi
set +e; OUT23D="$(python3 "$REG" "$OS" "$US_ROOT_A" --scope user --state "$OST" --doctor)"; RC23D=$?; set -e
if [ "$RC23D" -ne 0 ] && printf '%s' "$OUT23D" | grep -q 'missing-owner'; then ok "23b doctor verdict names missing-owner (nonzero)"; else bad "23b doctor missing-owner verdict wrong (rc=$RC23D): $OUT23D"; fi

# 24. aligned orphan remove through run.sh: entry + package state + provider installerRoot
#     all name the same MISSING root → reported cleanup; then idempotent
AG24="$TMP/own/agent24"; XD24="$TMP/own/xdg24"; mkdir -p "$AG24" "$XD24"
GONE24="$TMP/own/gone24/entwurf"; mkdir -p "$GONE24"
PKGST24="$XD24/entwurf/pi-package/install-state.json"; PPST24="$XD24/entwurf/pi-provider/install-state.json"
python3 "$REG" "$AG24/settings.json" "$GONE24" --scope user --state "$PKGST24" >/dev/null
python3 "$REPO/scripts/register-pi-provider.py" install "$AG24/settings.json" "$GONE24" --scope user --state "$PPST24" >/dev/null
rm -rf "$TMP/own/gone24"
set +e; OUT24="$(HOME="$TMP/home" XDG_DATA_HOME="$XD24" XDG_STATE_HOME="$TMP/state" XDG_CACHE_HOME="$TMP/cache" PI_CODING_AGENT_DIR="$AG24" bash "$RUN" remove-user-scope 2>&1)"; RC24=$?; set -e
if [ "$RC24" -eq 0 ] && printf '%s' "$OUT24" | grep -q 'orphan cleanup' \
   && [ ! -e "$PKGST24" ] \
   && python3 -c "
import json;p=json.load(open('$AG24/settings.json'))['packages']
assert not any(isinstance(x,str) and x.endswith('gone24/entwurf') for x in p), p" 2>/dev/null; then
  ok "24 remove-user-scope performs the ALIGNED orphan cleanup (missing owner; reported; states cleared)"
else bad "24 aligned orphan cleanup failed (rc=$RC24): $OUT24"; fi

# 25. mismatch: package state names a missing owner but provider installerRoot names a DIFFERENT root → refuse
AG25="$TMP/own/agent25"; XD25="$TMP/own/xdg25"; mkdir -p "$AG25" "$XD25"
GONE25="$TMP/own/gone25/entwurf"; mkdir -p "$GONE25"
PKGST25="$XD25/entwurf/pi-package/install-state.json"; PPST25="$XD25/entwurf/pi-provider/install-state.json"
python3 "$REG" "$AG25/settings.json" "$GONE25" --scope user --state "$PKGST25" >/dev/null
python3 "$REPO/scripts/register-pi-provider.py" install "$AG25/settings.json" "$US_ROOT_B" --scope user --state "$PPST25" --takeover >/dev/null
rm -rf "$TMP/own/gone25"
SHA25="$(sha256sum "$AG25/settings.json" | cut -d' ' -f1)"
set +e; OUT25="$(HOME="$TMP/home" XDG_DATA_HOME="$XD25" XDG_STATE_HOME="$TMP/state" XDG_CACHE_HOME="$TMP/cache" PI_CODING_AGENT_DIR="$AG25" bash "$RUN" remove-user-scope 2>&1)"; RC25=$?; set -e
if [ "$RC25" -ne 0 ] && [ "$SHA25" = "$(sha256sum "$AG25/settings.json" | cut -d' ' -f1)" ] && [ -e "$PKGST25" ]; then
  ok "25 package/provider owner MISMATCH refuses the orphan path (no cleanup without full alignment)"
else bad "25 mismatched states were cleaned up anyway (rc=$RC25): $OUT25"; fi

# ── 26–31. #86 C2 amendment: ATOMIC two-writer operations + coupling doctor ──
PROV="$REPO/scripts/register-pi-provider.py"

# 26. install atomicity through the PUBLIC drive: provider owned by another LIVE
#     root → the whole `run.sh install` user-scope step refuses and the PACKAGE
#     half is byte-identical (no entry, no state minted). Needs resolvable bundled
#     deps like cell 14 — a dep-unresolvable checkout (qualification snapshot) gets
#     the same NAMED skip; the atomic decision itself stays covered snapshot-safe
#     by the SSOT preflights cells 27/29/30 drive through remove-user-scope.
AG26="$TMP/own/agent26"; XD26="$TMP/own/xdg26"; PROJ26="$TMP/own/proj26"; mkdir -p "$AG26" "$XD26" "$PROJ26"
python3 "$PROV" install "$AG26/settings.json" "$US_ROOT_A" --scope user --state "$XD26/entwurf/pi-provider/install-state.json" >/dev/null
set +e
OUT26="$(HOME="$TMP/home" XDG_DATA_HOME="$XD26" XDG_STATE_HOME="$TMP/state" XDG_CACHE_HOME="$TMP/cache" PI_CODING_AGENT_DIR="$AG26" bash "$RUN" install "$PROJ26" 2>&1)"
RC26=$?
set -e
if [ "$RC26" -eq 0 ]; then
  bad "26 install completed although the provider half is owned by another root: $OUT26"
elif printf '%s' "$OUT26" | grep -q 'repo dependency integrity check failed'; then
  echo "  skip  26 public install drive skipped: bundled deps unresolvable in this checkout (snapshot shape); atomicity stays covered by cells 27/29/30"
elif [ -e "$XD26/entwurf/pi-package/install-state.json" ] \
     || python3 -c "
import json,sys
try: p=json.load(open('$AG26/settings.json')).get('packages',[])
except FileNotFoundError: sys.exit(1)
sys.exit(0 if any(isinstance(x,str) and x=='$REPO' for x in p) else 1)"; then
  # EITHER leak is a broken atomic contract: a minted package state OR a written
  # packages[] entry before the provider-side refusal.
  bad "26 refusal was not atomic — the package half (state and/or entry) was written before the provider refusal"
else
  ok "26 install is ATOMIC: a provider-side owner refusal leaves the package half byte-identical (no entry, no state)"
fi

# 27. remove atomicity: package owned by the CALLING root (run.sh's own checkout),
#     provider owned by another LIVE root → remove-user-scope refuses ON THE
#     PROVIDER SIDE and the package entry + state stay intact.
AG27="$TMP/own/agent27"; XD27="$TMP/own/xdg27"; mkdir -p "$AG27" "$XD27"
python3 "$REG" "$AG27/settings.json" "$REPO" --scope user --state "$XD27/entwurf/pi-package/install-state.json" >/dev/null
python3 "$PROV" install "$AG27/settings.json" "$US_ROOT_B" --scope user --state "$XD27/entwurf/pi-provider/install-state.json" --takeover >/dev/null
set +e
OUT27="$(HOME="$TMP/home" XDG_DATA_HOME="$XD27" XDG_STATE_HOME="$TMP/state" XDG_CACHE_HOME="$TMP/cache" PI_CODING_AGENT_DIR="$AG27" bash "$RUN" remove-user-scope 2>&1)"
RC27=$?
set -e
if [ "$RC27" -ne 0 ] && printf '%s' "$OUT27" | grep -q 'register-pi-provider' \
   && [ -e "$XD27/entwurf/pi-package/install-state.json" ] \
   && python3 -c "
import json,sys;p=json.load(open('$AG27/settings.json'))['packages']
sys.exit(0 if any(isinstance(x,str) and x=='$REPO' for x in p) else 1)"; then
  ok "27 remove is ATOMIC: a provider-side owner refusal leaves the package entry + state intact"
else bad "27 remove was not atomic or refused on the wrong side (rc=$RC27): $OUT27"; fi
# 27b (final amendment): provider SAME-owner but its managedSettingsPath names a
# DIFFERENT settings file → the provider preflight is RED (binding check runs
# before any green) and the package entry + state stay byte-identical.
printf '{"schemaVersion":1,"managedSettingsPath":"%s","ownership":"managed-current","installerRoot":"%s"}\n' \
  "$TMP/own/elsewhere-settings.json" "$REPO" > "$XD27/entwurf/pi-provider/install-state.json"
SHA27B="$(sha256sum "$AG27/settings.json" | cut -d' ' -f1)"
set +e
OUT27B="$(HOME="$TMP/home" XDG_DATA_HOME="$XD27" XDG_STATE_HOME="$TMP/state" XDG_CACHE_HOME="$TMP/cache" PI_CODING_AGENT_DIR="$AG27" bash "$RUN" remove-user-scope 2>&1)"
RC27B=$?
set -e
if [ "$RC27B" -ne 0 ] && printf '%s' "$OUT27B" | grep -q 'ownership record and target disagree' \
   && [ "$SHA27B" = "$(sha256sum "$AG27/settings.json" | cut -d' ' -f1)" ] \
   && [ -e "$XD27/entwurf/pi-package/install-state.json" ]; then
  ok "27b a provider managedSettingsPath mismatch is preflight-RED with the package half byte-identical"
else bad "27b provider binding mismatch was not fail-closed atomically (rc=$RC27B): $OUT27B"; fi

# 28. takeover over a provider USER-OVERRIDE: split verdict — package moved,
#     override preserved and UNOWNED, stale provider ownership state cleared.
AG28="$TMP/own/agent28"; XD28="$TMP/own/xdg28"; mkdir -p "$AG28" "$XD28"
python3 "$REG" "$AG28/settings.json" "$US_ROOT_A" --scope user --state "$XD28/entwurf/pi-package/install-state.json" >/dev/null
python3 - "$AG28/settings.json" <<'PY'
import json,sys
p=sys.argv[1]
d=json.load(open(p))
d["entwurfProvider"]={"mcpServers":{"entwurf-bridge":{"command":"/custom/operator-bridge"}}}
open(p,"w").write(json.dumps(d,indent=2)+"\n")
PY
mkdir -p "$XD28/entwurf/pi-provider"
printf '{"schemaVersion":1,"managedSettingsPath":"%s","ownership":"absent","installerRoot":"%s"}\n' "$AG28/settings.json" "$US_ROOT_A" > "$XD28/entwurf/pi-provider/install-state.json"
set +e
OUT28="$(HOME="$TMP/home" XDG_DATA_HOME="$XD28" XDG_STATE_HOME="$TMP/state" XDG_CACHE_HOME="$TMP/cache" PI_CODING_AGENT_DIR="$AG28" bash "$RUN" takeover-user-scope 2>&1)"
RC28=$?
set -e
if [ "$RC28" -eq 0 ] && printf '%s' "$OUT28" | grep -q 'provider override preserved' \
   && printf '%s' "$OUT28" | grep -q 'package owner moved' \
   && ! printf '%s' "$OUT28" | grep -q 'now owns the user-scope registration' \
   && [ ! -e "$XD28/entwurf/pi-provider/install-state.json" ] \
   && grep -q '/custom/operator-bridge' "$AG28/settings.json"; then
  ok "28 takeover over a provider override is a SPLIT verdict (package moved; override preserved, unowned; stale state cleared; no false both-owned)"
else bad "28 takeover override split verdict wrong (rc=$RC28): $OUT28"; fi

# 29. legacy provider state (no installerRoot): the inverse is FAIL-CLOSED and the
#     package half stays intact (atomic) — adoption is install-only.
AG29="$TMP/own/agent29"; XD29="$TMP/own/xdg29"; mkdir -p "$AG29" "$XD29/entwurf/pi-provider"
python3 "$REG" "$AG29/settings.json" "$REPO" --scope user --state "$XD29/entwurf/pi-package/install-state.json" >/dev/null
printf '{"schemaVersion":1,"managedSettingsPath":"%s","ownership":"managed-current"}\n' "$AG29/settings.json" > "$XD29/entwurf/pi-provider/install-state.json"
set +e
OUT29="$(HOME="$TMP/home" XDG_DATA_HOME="$XD29" XDG_STATE_HOME="$TMP/state" XDG_CACHE_HOME="$TMP/cache" PI_CODING_AGENT_DIR="$AG29" bash "$RUN" remove-user-scope 2>&1)"
RC29=$?
set -e
if [ "$RC29" -ne 0 ] && printf '%s' "$OUT29" | grep -qi 'LEGACY' \
   && [ -e "$XD29/entwurf/pi-package/install-state.json" ] \
   && python3 -c "
import json,sys;p=json.load(open('$AG29/settings.json'))['packages']
sys.exit(0 if any(isinstance(x,str) and x=='$REPO' for x in p) else 1)"; then
  ok "29 a LEGACY provider state fail-closes the inverse (adopt via install/setup first) and the package half stays intact"
else bad "29 legacy provider inverse did not fail closed atomically (rc=$RC29): $OUT29"; fi

# 30. orphan alignment REQUIRES the provider state: package owner missing + entry
#     aligned but NO provider state → refuse, zero write.
AG30="$TMP/own/agent30"; XD30="$TMP/own/xdg30"; mkdir -p "$AG30" "$XD30"
GONE30="$TMP/own/gone30/entwurf"; mkdir -p "$GONE30"
python3 "$REG" "$AG30/settings.json" "$GONE30" --scope user --state "$XD30/entwurf/pi-package/install-state.json" >/dev/null
rm -rf "$TMP/own/gone30"
SHA30="$(sha256sum "$AG30/settings.json" | cut -d' ' -f1)"
set +e
OUT30="$(HOME="$TMP/home" XDG_DATA_HOME="$XD30" XDG_STATE_HOME="$TMP/state" XDG_CACHE_HOME="$TMP/cache" PI_CODING_AGENT_DIR="$AG30" bash "$RUN" remove-user-scope 2>&1)"
RC30=$?
set -e
if [ "$RC30" -ne 0 ] && [ "$SHA30" = "$(sha256sum "$AG30/settings.json" | cut -d' ' -f1)" ] \
   && [ -e "$XD30/entwurf/pi-package/install-state.json" ]; then
  ok "30 an ABSENT provider state is NOT orphan alignment — remove refuses with zero writes"
else bad "30 orphan cleanup ran without a provider state (rc=$RC30): $OUT30"; fi

# 31. doctor ownership coupling: package state and provider installerRoot disagree → FAIL naming the mismatch.
AG31="$TMP/own/agent31"; XD31="$TMP/own/xdg31"; mkdir -p "$AG31" "$XD31/entwurf/pi-provider"
python3 "$REG" "$AG31/settings.json" "$US_ROOT_A" --scope user --state "$XD31/entwurf/pi-package/install-state.json" >/dev/null
printf '{"schemaVersion":1,"managedSettingsPath":"%s","ownership":"absent","installerRoot":"%s"}\n' "$AG31/settings.json" "$US_ROOT_B" > "$XD31/entwurf/pi-provider/install-state.json"
set +e
OUT31="$(HOME="$TMP/home" XDG_DATA_HOME="$XD31" XDG_STATE_HOME="$TMP/state" XDG_CACHE_HOME="$TMP/cache" PI_CODING_AGENT_DIR="$AG31" bash "$RUN" doctor-pi-package 2>&1)"
RC31=$?
set -e
if [ "$RC31" -ne 0 ] && printf '%s' "$OUT31" | grep -q 'coupling mismatch'; then
  ok "31 doctor-pi-package FAILs on a packageRoot↔installerRoot coupling mismatch"
else bad "31 doctor coupling mismatch verdict wrong (rc=$RC31): $OUT31"; fi
# 31b (final amendment): a package state whose managedSettingsPath names a DIFFERENT
# settings file is an ownership FAIL for the doctor too (runtime never probed).
python3 - "$XD31/entwurf/pi-package/install-state.json" <<'PY'
import json,sys
p=sys.argv[1]; st=json.load(open(p))
st["managedSettingsPath"]="/somewhere/else/settings.json"
open(p,"w").write(json.dumps(st,indent=2)+"\n")
PY
set +e
OUT31B="$(HOME="$TMP/home" XDG_DATA_HOME="$XD31" XDG_STATE_HOME="$TMP/state" XDG_CACHE_HOME="$TMP/cache" PI_CODING_AGENT_DIR="$AG31" bash "$RUN" doctor-pi-package 2>&1)"
RC31B=$?
set -e
if [ "$RC31B" -ne 0 ] && printf '%s' "$OUT31B" | grep -q 'managedSettingsPath mismatch'; then
  ok "31b doctor-pi-package FAILs on a package managedSettingsPath mismatch"
else bad "31b doctor package managed-path mismatch verdict wrong (rc=$RC31B): $OUT31B"; fi

# ── 32–34. #86 C2 corrective amendment (B review blockers, 2026-08-27): the ONE
# exact-owner classifier across install/takeover/inverse/doctor, and the ONE typed
# provider installerRoot verdict. Each cell replants a transition B reproduced
# OUTSIDE the original C2 gate space.
# 32. B blocker 1: recorded owner A, packages [A, another-entwurf-shaped root B].
#     A's NORMAL install must refuse with zero writes — never route through the
#     broad register() collapse that silently deletes B's entry.
c2_reset c32
python3 "$REG" "$OS" "$US_ROOT_A" --scope user --state "$OST" >/dev/null
python3 - "$OS" "$US_ROOT_B" <<'PY'
import json,sys
d=json.load(open(sys.argv[1])); d["packages"].append(sys.argv[2])
open(sys.argv[1],"w").write(json.dumps(d,indent=2)+"\n")
PY
SHA32="$(sha256sum "$OS" | cut -d' ' -f1)"
set +e; OUT32="$(python3 "$REG" "$OS" "$US_ROOT_A" --scope user --state "$OST" 2>&1)"; RC32=$?; set -e
L32="32 owner A + another entwurf-shaped root: A's NORMAL install refuses zero-write, B's entry survives [QK:BROAD-INSTALL-COLLAPSE]"
if [ "$RC32" -ne 0 ] && [ "$SHA32" = "$(sha256sum "$OS" | cut -d' ' -f1)" ] \
   && python3 -c "
import json;p=json.load(open('$OS'))['packages']
assert '$US_ROOT_B' in p and '$US_ROOT_A' in p, p" 2>/dev/null; then
  ok "$L32"
else bad "$L32 — violated (rc=$RC32): $OUT32 / $(cat "$OS")"; fi
# 32b. the SAME ambiguous store refuses the owned inverse (one classifier, not a
#      broad-install/exact-inverse double standard) …
set +e; OUT32B="$(python3 "$REG" "$OS" "$US_ROOT_A" --scope user --state "$OST" --remove 2>&1)"; RC32B=$?; set -e
if [ "$RC32B" -ne 0 ] && [ "$SHA32" = "$(sha256sum "$OS" | cut -d' ' -f1)" ] && [ -f "$OST" ]; then
  ok "32b the ambiguous store refuses the owned inverse too (zero writes, state kept)"
else bad "32b owned inverse proceeded over an ambiguous store (rc=$RC32B): $OUT32B"; fi
# 32c. … and refuses the explicit takeover: takeover licenses moving THE exact
#      entry, never collateral deletion of an unattributed second root.
set +e; OUT32C="$(python3 "$REG" "$OS" "$US_ROOT_B" --scope user --state "$OST" --takeover 2>&1)"; RC32C=$?; set -e
if [ "$RC32C" -ne 0 ] && [ "$SHA32" = "$(sha256sum "$OS" | cut -d' ' -f1)" ] \
   && [ "$(python3 -c "import json;print(json.load(open('$OST'))['packageRoot'])")" = "$US_ROOT_A" ]; then
  ok "32c even explicit takeover refuses the ambiguous store (no collateral license)"
else bad "32c takeover proceeded over an ambiguous store (rc=$RC32C): $OUT32C"; fi

# 33. B blocker 2: owner state records A, A's exact entry is GONE and only another
#     entwurf-shaped root remains → the doctor must be RED naming the mismatch,
#     never "owned" through the broad shape matcher (while the inverse refuses the
#     very same state — contradictory verdicts on one store).
c2_reset c33
python3 "$REG" "$OS" "$US_ROOT_A" --scope user --state "$OST" >/dev/null
python3 - "$OS" "$US_ROOT_A" "$US_ROOT_B" <<'PY'
import json,sys
d=json.load(open(sys.argv[1]))
d["packages"]=[sys.argv[3] if x==sys.argv[2] else x for x in d["packages"]]
open(sys.argv[1],"w").write(json.dumps(d,indent=2)+"\n")
PY
set +e; OUT33="$(python3 "$REG" "$OS" "$US_ROOT_A" --scope user --state "$OST" --doctor)"; RC33=$?; set -e
L33="33 doctor: owner A recorded, only another entwurf-shaped root present → RED mismatch, never owned [QK:BROAD-DOCTOR-GREEN]"
if [ "$RC33" -ne 0 ] && printf '%s' "$OUT33" | grep -q 'mismatch' \
   && ! printf '%s' "$OUT33" | grep -q 'doctor-pi-package: owned '; then
  ok "$L33"
else bad "$L33 — violated (rc=$RC33): $OUT33"; fi

# 34. B blocker 3: a wrong-TYPE provider installerRoot (number / empty string /
#     bool / object / array) is CORRUPT and fail-closed for install AND remove —
#     zero settings writes, state never rebound — instead of falling between the
#     isinstance(str) arm and the is-None legacy arm and proceeding unattributed.
AG34="$TMP/own/agent34"; XD34="$TMP/own/xdg34"; mkdir -p "$AG34" "$XD34/entwurf/pi-provider"
PPST34="$XD34/entwurf/pi-provider/install-state.json"
QK34='[QK:PROVIDER-ROOT-TYPE-FAIL-OPEN]'
fail34=0
for bad_root in '7' '""' 'true' '{}' '[]'; do
  printf '{"entwurfProvider":{"mcpServers":{"entwurf-bridge":{"command":"entwurf-bridge"}}}}\n' > "$AG34/settings.json"
  printf '{"schemaVersion":1,"managedSettingsPath":"%s","ownership":"managed-current","command":"entwurf-bridge","installerRoot":%s}\n' \
    "$AG34/settings.json" "$bad_root" > "$PPST34"
  SHA34="$(sha256sum "$AG34/settings.json" | cut -d' ' -f1)"
  ST34="$(sha256sum "$PPST34" | cut -d' ' -f1)"
  set +e
  python3 "$PROV" install "$AG34/settings.json" "$US_ROOT_A" --scope user --state "$PPST34" >/dev/null 2>&1; RCI=$?
  python3 "$PROV" remove  "$AG34/settings.json" "$US_ROOT_A" --scope user --state "$PPST34" >/dev/null 2>&1; RCR=$?
  set -e
  if [ "$RCI" -eq 0 ] || [ "$RCR" -eq 0 ] \
     || [ "$SHA34" != "$(sha256sum "$AG34/settings.json" | cut -d' ' -f1)" ] \
     || [ "$ST34" != "$(sha256sum "$PPST34" | cut -d' ' -f1)" ]; then
    bad "34 installerRoot=$bad_root not fail-closed (install rc=$RCI, remove rc=$RCR) $QK34"; fail34=1
  fi
done
if [ "$fail34" -eq 0 ]; then
  ok "34 wrong-type provider installerRoot (number/empty-string/bool/object/array) is CORRUPT: install+remove refuse, zero writes, state never rebound $QK34"
fi
# 34b. the doctor coupling asks the SAME typed classifier: package owner A + a
#      wrong-type provider installerRoot → FAIL naming CORRUPT, never silence.
c2_reset c34b
python3 "$REG" "$OS" "$US_ROOT_A" --scope user --state "$OST" >/dev/null
printf '{"schemaVersion":1,"managedSettingsPath":"%s","ownership":"managed-current","command":"entwurf-bridge","installerRoot":7}\n' \
  "$OS" > "$PPST34"
set +e; OUT34B="$(python3 "$REG" "$OS" "$US_ROOT_A" --scope user --state "$OST" --doctor --provider-state "$PPST34")"; RC34B=$?; set -e
if [ "$RC34B" -ne 0 ] && printf '%s' "$OUT34B" | grep -q 'CORRUPT'; then
  ok "34b doctor coupling FAILs on a wrong-type provider installerRoot (named CORRUPT) $QK34"
else bad "34b doctor stayed green/silent over a corrupt installerRoot (rc=$RC34B): $OUT34B $QK34"; fi

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
