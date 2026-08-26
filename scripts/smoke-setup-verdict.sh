#!/usr/bin/env bash
# smoke-setup-verdict.sh — the smallest aggregate `setup` verdict fixture (#86 C1).
#
# The aggregate composition had ZERO automated consumers before this file: no
# living layer executed `entwurf setup` at all, so the false-green shape (WARN
# swallowing + unconditional "DONE ... green") had only a human operator as its
# gate. This fixture drives the REAL `run.sh setup` end to end in a sandbox and
# pins exactly the #86 C1 acceptance cells:
#
#   S-1 all-harness-absent  → core PASS, pi/claude/agy SKIP, computed green,
#                             zero harness writes, credential store untouched
#   S-2 pi below floor      → detected FAIL (never SKIP), nonzero, no Pi wiring
#   S-3 pi at floor         → presence completes project+user wiring, green,
#                             credential store still byte-identical
#   S-4 agy detected+corrupt→ named component FAIL + NON-GREEN + nonzero exit,
#                             core and later components still attempted
#   S-5 installed mode      → the installed-vs-source branch is a NAMED verdict
#                             printed before anything else, and never reaches
#                             the source pnpm bootstrap
#
# Mutation attribution does NOT live here (round 3): the setup-verdict lane's
# QK signatures and kill cells moved to the snapshot-safe oracle
# scripts/check-setup-qualification.sh, so this file carries no [QK] tokens.
# This fixture is the BEHAVIOR authority only — S-2/S-4 still exercise the same
# below-floor and false-green shapes as living end-to-end evidence.
#
# Deterministic: no model, no network, no cost. Presence probes are pinned via
# PI_BIN / CLAUDE_BIN / AGY_BIN (the same hermetic seam smoke-agy-install-state
# uses), and every write root is sandboxed: HOME, XDG roots, the pi agent dir,
# and the dev-bin dir. The source bootstrap (`pnpm install --frozen-lockfile`)
# runs against the ALREADY-INSTALLED checkout, which is a verified no-op under a
# sandbox HOME (measured 2026-08-26).
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$HERE/.." && pwd)"

case "$REPO_DIR" in
  */node_modules/*)
    echo "entwurf: 'smoke-setup-verdict' is a dev-clone-only surface — run it from a checkout." >&2
    exit 1
    ;;
esac

# Same snapshot-purity rule as the sibling install smokes: run.sh paths import
# scripts/*.py and CPython would mint scripts/__pycache__/*.pyc inside the
# gate-qualification snapshot, ending the run IMPURE.
export PYTHONDONTWRITEBYTECODE=1

SB="$(mktemp -d -t entwurf-setup-verdict.XXXXXX)"
cleanup() { rm -rf "$SB"; }
trap cleanup EXIT

export HOME="$SB/home"
export XDG_DATA_HOME="$SB/home/.local/share"
export XDG_STATE_HOME="$SB/home/.local/state"
export XDG_CACHE_HOME="$SB/home/.cache"
export XDG_CONFIG_HOME="$SB/home/.config"
export PI_CODING_AGENT_DIR="$SB/home/.pi/agent"
export ENTWURF_DEV_BIN_DIR="$SB/bin"
export PATH="$SB/bin:$PATH"
mkdir -p "$HOME" "$PI_CODING_AGENT_DIR" "$SB/bin" "$SB/harness"

# Presence pins: default every harness to a definitely-absent path; each cell
# re-pins what it needs. Production leaves these unset.
ABSENT="$SB/harness/definitely-absent"
export PI_BIN="$ABSENT" CLAUDE_BIN="$ABSENT" AGY_BIN="$ABSENT"

PASS=0
ok()   { PASS=$((PASS + 1)); printf '  ok    %s\n' "$*"; }
die()  { printf 'FAIL: %s\n' "$*" >&2; exit 1; }
want() { # $1 = label, $2 = shell condition
  if eval "$2"; then ok "$1"; else die "$1"; fi
}

AUTH="$PI_CODING_AGENT_DIR/auth.json"
seed_auth() {
  printf '{\n  "anthropic": {\n    "type": "oauth",\n    "access": "sandbox-oauth-token"\n  }\n}\n' > "$AUTH"
  AUTH_BEFORE="$(sha256sum "$AUTH" | cut -d' ' -f1)"
}
want_auth_untouched() { # $1 = cell label prefix
  want "$1: credential store is byte-identical (no read-modify-write)" \
    "[ \"\$(sha256sum '$AUTH' | cut -d' ' -f1)\" = '$AUTH_BEFORE' ]"
  want "$1: no auth.json.bak was written" "[ ! -e '$AUTH.bak' ]"
  want "$1: no 'entwurf' credential alias appeared" \
    "! grep -q '\"entwurf\"' '$AUTH'"
}

# ── S-1: all harnesses absent → core PASS, three SKIPs, computed green, zero writes ──
echo "[smoke-setup-verdict] S-1 all-harness-absent setup"
PROJ1="$SB/proj1"; mkdir -p "$PROJ1"
seed_auth
set +e; OUT="$(bash "$REPO_DIR/run.sh" setup "$PROJ1" 2>&1)"; RC=$?; set -e
want "S-1: all-absent setup exits 0 (core green is still green)" "[ '$RC' -eq 0 ]"
want "S-1: mode is a named source-checkout branch, printed first" \
  "printf '%s' \"\$OUT\" | head -n 1 | grep -q 'mode: source checkout'"
want "S-1: pi absent is an explicit zero-state SKIP" "printf '%s' \"\$OUT\" | grep -q 'pi: SKIP'"
want "S-1: claude absent is an explicit zero-state SKIP" "printf '%s' \"\$OUT\" | grep -q 'claude: SKIP'"
want "S-1: agy absent is an explicit zero-state SKIP" "printf '%s' \"\$OUT\" | grep -q 'agy: SKIP'"
want "S-1: core bridge boundary validated (PASS)" "printf '%s' \"\$OUT\" | grep -q 'core: PASS'"
want "S-1: final verdict is computed, not unconditional" \
  "printf '%s' \"\$OUT\" | grep -q 'result: green (computed from the component outcomes above)'"
want "S-1: the retired unconditional green line is gone" \
  "! printf '%s' \"\$OUT\" | grep -q 'pi adapter + detected native bridges + v2 install smoke) green'"
want "S-1: zero Pi wiring written for an absent pi" "[ ! -e '$PROJ1/.pi' ]"
want "S-1: no user-scope pi settings were created" "[ ! -e '$PI_CODING_AGENT_DIR/settings.json' ]"
want "S-1: no agy config was created" "[ ! -e '$HOME/.gemini' ]"
want_auth_untouched "S-1"

# ── S-2: pi resolvable but BELOW floor → detected FAIL, never SKIP, no writes ──
echo "[smoke-setup-verdict] S-2 pi below floor"
PROJ2="$SB/proj2"; mkdir -p "$PROJ2"
printf '#!/usr/bin/env bash\necho 0.1.0\n' > "$SB/harness/pi-stale"; chmod +x "$SB/harness/pi-stale"
seed_auth
set +e; OUT="$(PI_BIN="$SB/harness/pi-stale" bash "$REPO_DIR/run.sh" setup "$PROJ2" 2>&1)"; RC=$?; set -e
# Assertion ORDER is part of the kill contract: the verdict-label check runs
# FIRST so the PI-FLOOR-SKIP mutant dies on its own token, and the exit-code
# check runs SECOND so the FALSE-GREEN mutant (labels intact, exit flipped)
# dies on its token instead of a mislabeled line.
want "S-2: below-floor pi is a detected FAIL naming the supported range" \
  "printf '%s' \"\$OUT\" | grep -q 'pi: FAIL' && printf '%s' \"\$OUT\" | grep -q 'outside the supported range'"
want "S-2: a detected component FAIL owns a nonzero setup exit" "[ '$RC' -ne 0 ]"
want "S-2: a stale pi is never relabeled SKIP" "! printf '%s' \"\$OUT\" | grep -q 'pi: SKIP'"
want "S-2: summary is NON-GREEN and names the failed component" \
  "printf '%s' \"\$OUT\" | grep -q 'NON-GREEN (FAIL: pi)'"
want "S-2: no Pi wiring was written for the refused pi" "[ ! -e '$PROJ2/.pi' ]"
want_auth_untouched "S-2"

# ── S-2b: pi resolvable but --version CRASHES → computed FAIL, never a set -e abort ──
# Review defect (2026-08-26): an unreadable detected pi must reach the verdict
# engine and the summary, not kill setup before them.
echo "[smoke-setup-verdict] S-2b pi present but version unreadable"
PROJ2B="$SB/proj2b"; mkdir -p "$PROJ2B"
printf '#!/usr/bin/env bash\necho "pi exploded" >&2\nexit 1\n' > "$SB/harness/pi-broken"; chmod +x "$SB/harness/pi-broken"
seed_auth
set +e; OUT="$(PI_BIN="$SB/harness/pi-broken" bash "$REPO_DIR/run.sh" setup "$PROJ2B" 2>&1)"; RC=$?; set -e
want "S-2b: unreadable pi version makes setup exit nonzero via the computed verdict" "[ '$RC' -ne 0 ]"
want "S-2b: unreadable pi is a detected FAIL naming the unreadable version" \
  "printf '%s' \"\$OUT\" | grep -q 'pi: FAIL' && printf '%s' \"\$OUT\" | grep -q 'unreadable version'"
want "S-2b: later components were still attempted (core bridge smoke ran)" \
  "printf '%s' \"\$OUT\" | grep -q 'core: PASS'"
want "S-2b: summary is NON-GREEN (no set -e abort before the summary)" \
  "printf '%s' \"\$OUT\" | grep -q 'NON-GREEN (FAIL: pi)'"
want "S-2b: no Pi wiring was written for the unreadable pi" "[ ! -e '$PROJ2B/.pi' ]"
want_auth_untouched "S-2b"

# ── S-3: pi at the pinned floor → presence completes project + user wiring ──
echo "[smoke-setup-verdict] S-3 pi present at floor"
PROJ3="$SB/proj3"; mkdir -p "$PROJ3"
PI_PIN="$(node -e 'console.log(require(process.argv[1]).devDependencies["@earendil-works/pi-coding-agent"])' "$REPO_DIR/package.json")"
printf '#!/usr/bin/env bash\necho %s\n' "$PI_PIN" > "$SB/harness/pi-ok"; chmod +x "$SB/harness/pi-ok"
seed_auth
set +e; OUT="$(PI_BIN="$SB/harness/pi-ok" bash "$REPO_DIR/run.sh" setup "$PROJ3" 2>&1)"; RC=$?; set -e
want "S-3: pi-present setup exits 0" "[ '$RC' -eq 0 ]"
want "S-3: pi wiring completed as PASS at pin $PI_PIN" "printf '%s' \"\$OUT\" | grep -q 'pi: PASS'"
want "S-3: project .pi/settings.json written (Pi-owned wiring gated on presence)" \
  "[ -f '$PROJ3/.pi/settings.json' ] && grep -q 'entwurf' '$PROJ3/.pi/settings.json'"
want "S-3: user-scope citizen registered" \
  "[ -f '$PI_CODING_AGENT_DIR/settings.json' ] && grep -q 'entwurf' '$PI_CODING_AGENT_DIR/settings.json'"
want_auth_untouched "S-3"

# ── S-4: agy detected + corrupt config → named component FAIL, NON-GREEN, later components attempted ──
echo "[smoke-setup-verdict] S-4 agy detected but corrupt"
PROJ4="$SB/proj4"; mkdir -p "$PROJ4"
printf '#!/usr/bin/env bash\necho fake-agy\n' > "$SB/harness/agy"; chmod +x "$SB/harness/agy"
mkdir -p "$HOME/.gemini/config"
printf 'this is not json{{{' > "$HOME/.gemini/config/mcp_config.json"
seed_auth
set +e; OUT="$(AGY_BIN="$SB/harness/agy" bash "$REPO_DIR/run.sh" setup "$PROJ4" 2>&1)"; RC=$?; set -e
want "S-4: detected agy failure owns a nonzero setup exit" "[ '$RC' -ne 0 ]"
want "S-4: the corrupt agy bridge is a NAMED component FAIL" \
  "printf '%s' \"\$OUT\" | grep -q 'agy-bridge: FAIL'"
want "S-4: the reason is corrupt-specific (invalid JSON), not a silent skip" \
  "printf '%s' \"\$OUT\" | grep -qi 'invalid JSON'"
want "S-4: later components were still attempted (core bridge smoke ran)" \
  "printf '%s' \"\$OUT\" | grep -q 'core: PASS'"
want "S-4: summary is NON-GREEN and computed from the outcomes" \
  "printf '%s' \"\$OUT\" | grep -q 'NON-GREEN' && ! printf '%s' \"\$OUT\" | grep -q 'result: green'"
want "S-4: the corrupt config was preserved, not clobbered" \
  "[ \"\$(cat '$HOME/.gemini/config/mcp_config.json')\" = 'this is not json{{{' ]"
want_auth_untouched "S-4"
rm -rf "$HOME/.gemini" "$SB/harness/agy"

# ── S-5: installed mode is a NAMED first verdict, never the source bootstrap ──
# A bare copy of run.sh under a fake node_modules root pins the mode seam
# cheaply: the copy is NOT a runnable installed package (no dist), so this cell
# asserts only that the installed-vs-source branch is decided and printed before
# any prerequisite check and the source-only pnpm bootstrap is never reached.
# The REAL packed installed-package `setup` consumer (all-absent SKIP, computed
# green, zero writes) lives in check-pack-install's installed all-absent setup
# row; the no-bootstrap KILL attribution lives in the oracle
# scripts/check-setup-qualification.sh (round 3).
echo "[smoke-setup-verdict] S-5 installed-mode named branch (pnpm-scrubbed)"
FAKE_PKG="$SB/node_modules/@junghanacs/entwurf"
mkdir -p "$FAKE_PKG" "$SB/proj5"
cp "$REPO_DIR/run.sh" "$FAKE_PKG/run.sh"; chmod +x "$FAKE_PKG/run.sh"
cp "$REPO_DIR/package.json" "$FAKE_PKG/package.json"
# The Missing-pnpm assertion was vacuous while the fixture inherited a PATH that
# still resolved pnpm (review round 2, 2026-08-26). Build a GENUINELY scrubbed
# PATH: shim the tools the pre-death setup path needs (resolved BEFORE the
# scrub, so a host that co-locates pnpm with node — e.g. corepack — still keeps
# node), then keep only the PATH directories that do NOT carry an executable
# pnpm, and PROVE the scrub before running the cell.
SCRUB_SHIMS="$SB/pnpm-scrub-shims"; mkdir -p "$SCRUB_SHIMS"
for _tool in bash node python3 head tr cut sed grep dirname readlink cat mkdir cp chmod rm env sha256sum; do
  _src="$(command -v "$_tool" 2>/dev/null || true)"
  [ -n "$_src" ] && ln -s "$_src" "$SCRUB_SHIMS/$_tool"
done
SCRUBBED_PATH="$SCRUB_SHIMS"
IFS=':' read -r -a _path_dirs <<<"$PATH"
for _d in "${_path_dirs[@]}"; do
  [ -n "$_d" ] || continue
  [ -x "$_d/pnpm" ] && continue
  SCRUBBED_PATH="$SCRUBBED_PATH:$_d"
done
unset _path_dirs _d _tool _src
want "S-5: the scrub itself holds — pnpm does NOT resolve on the scrubbed PATH" \
  "! PATH=\"$SCRUBBED_PATH\" command -v pnpm >/dev/null 2>&1"
want "S-5: the scrub preserved the tools the cell needs (bash/node/python3)" \
  "PATH=\"$SCRUBBED_PATH\" command -v bash >/dev/null && PATH=\"$SCRUBBED_PATH\" command -v node >/dev/null && PATH=\"$SCRUBBED_PATH\" command -v python3 >/dev/null"
set +e; OUT="$(PATH="$SCRUBBED_PATH" bash "$FAKE_PKG/run.sh" setup "$SB/proj5" 2>&1)"; RC=$?; set -e
want "S-5: installed mode is the FIRST named line, before any prerequisite check" \
  "printf '%s' \"\$OUT\" | head -n 1 | grep -q 'mode: installed package'"
want "S-5: installed mode never runs the source pnpm bootstrap" \
  "! printf '%s' \"\$OUT\" | grep -qi 'pnpm install\|Lockfile is up to date\|Progress: resolved'"
want "S-5: installed setup never requires pnpm merely to decide/compose" \
  "! printf '%s' \"\$OUT\" | grep -q 'Missing command: pnpm'"

echo ""
echo "smoke-setup-verdict: $PASS checks passed"
