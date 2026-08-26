#!/usr/bin/env bash
# check-setup-qualification.sh — snapshot-safe mutation-attribution oracle for the
# five aggregate-setup verdict claims (#86 C1). Invoked DIRECTLY by the mutant
# manifests (`bash scripts/check-setup-qualification.sh`); deliberately NOT a
# run.sh subcommand and NOT in any check tier. This file proves ONLY that each
# mutant dies at its own claim token inside the tracked-files qualification
# snapshot (no node_modules, no network, no pack). It is NOT behavior, package,
# or preflight evidence: the rich `smoke-setup-verdict` (check:package) and the
# actual packed consumer row in `check-pack-install` keep those authorities.
#
# The fake installed tree copies run.sh+package.json under a temp node_modules
# and plants ONE explicit PRECONDITION STUB at the installed store-doctor path
# (exit 0 + named stub verdict) because preflight_v3_store runs before
# SETUP_RESULTS exists. The stub is not a compiled-product twin. No bridge
# launcher is planted, so the core component FAILs BY DESIGN and every cell
# expects setup rc=1 with a computed NON-GREEN summary.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$HERE/.." && pwd)"
export PYTHONDONTWRITEBYTECODE=1

SB="$(mktemp -d -t entwurf-setup-qualification.XXXXXX)"
trap 'rm -rf "$SB"' EXIT
PASS=0
ok()   { PASS=$((PASS + 1)); printf '  ok    %s\n' "$*"; }
die()  { printf 'FAIL: %s\n' "$*" >&2; exit 1; }
want() { if eval "$2"; then ok "$1"; else die "$1"; fi; }

PKG="$SB/node_modules/@junghanacs/entwurf"
mkdir -p "$PKG/mcp/entwurf-bridge/dist/scripts"
cp "$REPO_DIR/run.sh" "$PKG/run.sh"; chmod +x "$PKG/run.sh"
cp "$REPO_DIR/package.json" "$PKG/package.json"
printf '%s\n' 'console.log("stub-store-doctor: precondition stub for the setup-qualification oracle — empty sandbox store, verdict clean by construction");' \
  > "$PKG/mcp/entwurf-bridge/dist/scripts/meta-bridge-store-doctor.js"

# Fake pnpm: resolvable (so an unconditional require_cmd would pass), but any
# INVOCATION writes a marker and exits uniquely — the bootstrap tripwire.
MARKER="$SB/pnpm-invoked.marker"
mkdir -p "$SB/bin"
printf '#!/usr/bin/env bash\necho invoked > "%s"\nexit 97\n' "$MARKER" > "$SB/bin/pnpm"
chmod +x "$SB/bin/pnpm"

ABSENT="$SB/definitely-absent"
run_setup() { # $1=HOME-root $2=project $3=PATH $4=PI_BIN → OUT/RC
  mkdir -p "$1/.pi/agent" "$2"
  set +e
  # ONE physical line by contract: check-install-surface S5c is a line-scoped static tripwire,
  # so the sandbox env assignments must ride the same line as the run.sh drive they guard.
  OUT="$(HOME="$1" XDG_DATA_HOME="$1/.local/share" XDG_STATE_HOME="$1/.local/state" XDG_CACHE_HOME="$1/.cache" XDG_CONFIG_HOME="$1/.config" PI_CODING_AGENT_DIR="$1/.pi/agent" PATH="$3" PI_BIN="$4" CLAUDE_BIN="$ABSENT" AGY_BIN="$ABSENT" bash "$PKG/run.sh" setup "$2" 2>&1)"
  RC=$?
  set -e
}

# ── Cell A: installed / all-absent (fake pnpm resolvable, never invoked) ──
HOME_A="$SB/home-a"; mkdir -p "$HOME_A/.pi/agent"
printf '{"anthropic":{"type":"oauth","access":"oracle-token"}}\n' > "$HOME_A/.pi/agent/auth.json"
AUTH_SHA="$(sha256sum "$HOME_A/.pi/agent/auth.json" | cut -d' ' -f1)"
run_setup "$HOME_A" "$SB/proj-a" "$SB/bin:$PATH" "$ABSENT"
want "A: the source bootstrap never invoked pnpm in installed mode (marker absent) [QK:SETUP-INSTALLED-NO-BOOTSTRAP]" \
  "[ ! -e '$MARKER' ]"
want "A: the deliberate core FAIL owns setup exit 1 (computed, never cosmetic green) [QK:SETUP-FALSE-GREEN]" \
  "[ '$RC' -eq 1 ]"
want "A: no auth.json.bak and credential bytes identical [QK:SETUP-CREDENTIAL-FREE]" \
  "[ ! -e '$HOME_A/.pi/agent/auth.json.bak' ] && [ \"\$(sha256sum '$HOME_A/.pi/agent/auth.json' | cut -d' ' -f1)\" = '$AUTH_SHA' ]"
want "A control: mode named first, pi/claude/agy SKIP, bins PASS, core FAIL, NON-GREEN summary" \
  "printf '%s' \"\$OUT\" | head -n 1 | grep -q 'mode: installed package' && printf '%s' \"\$OUT\" | grep -q 'pi: SKIP' && printf '%s' \"\$OUT\" | grep -q 'claude: SKIP' && printf '%s' \"\$OUT\" | grep -q 'agy: SKIP' && printf '%s' \"\$OUT\" | grep -q 'bins: PASS' && printf '%s' \"\$OUT\" | grep -q 'core: FAIL' && printf '%s' \"\$OUT\" | grep -q 'NON-GREEN'"

# ── Cell B: detected pi below floor — the verdict LABEL is the oracle ──
printf '#!/usr/bin/env bash\necho 0.1.0\n' > "$SB/pi-stale"; chmod +x "$SB/pi-stale"
run_setup "$SB/home-b" "$SB/proj-b" "$SB/bin:$PATH" "$SB/pi-stale"
want "B: a below-floor pi is a detected FAIL naming the supported range, never SKIP [QK:SETUP-PI-FLOOR-SKIP]" \
  "printf '%s' \"\$OUT\" | grep -q 'pi: FAIL' && printf '%s' \"\$OUT\" | grep -q 'outside the supported range' && ! printf '%s' \"\$OUT\" | grep -q 'pi: SKIP'"

# ── Cell C: genuinely pnpm-scrubbed PATH — installed setup needs no pnpm ──
SHIMS="$SB/scrub-shims"; mkdir -p "$SHIMS"
for _t in bash node python3 head tr cut sed grep dirname readlink cat mkdir cp chmod rm env sha256sum; do
  _s="$(command -v "$_t" 2>/dev/null || true)"; [ -n "$_s" ] && ln -s "$_s" "$SHIMS/$_t"
done
SCRUBBED="$SHIMS"
IFS=':' read -r -a _dirs <<<"$PATH"
for _d in "${_dirs[@]}"; do
  [ -n "$_d" ] || continue
  [ -x "$_d/pnpm" ] && continue
  SCRUBBED="$SCRUBBED:$_d"
done
want "C scrub proof: pnpm absent, needed tools present on the scrubbed PATH" \
  "! PATH=\"$SCRUBBED\" command -v pnpm >/dev/null 2>&1 && PATH=\"$SCRUBBED\" command -v node >/dev/null && PATH=\"$SCRUBBED\" command -v python3 >/dev/null"
run_setup "$SB/home-c" "$SB/proj-c" "$SCRUBBED" "$ABSENT"
want "C: installed setup needs no pnpm to decide/compose — summary reached, no Missing-command refusal [QK:SETUP-INSTALLED-NO-PNPM]" \
  "printf '%s' \"\$OUT\" | grep -q 'setup summary (computed from component outcomes)' && ! printf '%s' \"\$OUT\" | grep -q 'Missing command: pnpm'"

echo ""
echo "check-setup-qualification: $PASS checks passed (mutation-attribution oracle only — behavior evidence lives in smoke-setup-verdict and check-pack-install)"
