#!/usr/bin/env bash
# check-setup-qualification.sh — snapshot-safe mutation-attribution oracle for the
# aggregate-setup verdict claims (#86 C1 five + C3b three). Invoked DIRECTLY by the mutant
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

# Copilot composition surface (#86 C3b, Cell D): the three writer units and the
# birth installer's pre-vendor path are real tracked files; only the compiled
# dist closure is stubbed (the receive installer copies and digests those bytes,
# it never executes them — same not-a-product-twin discipline as the store stub).
mkdir -p "$PKG/scripts" "$PKG/mcp/entwurf-bridge/dist/pi-extensions/lib" "$PKG/pi-extensions/lib"
for _f in copilot-bridge-install.sh copilot-bridge-oracle.sh copilot-mcp-bridge.sh copilot-mcp-config.py \
  copilot-receive-bridge.sh copilot-statusline-bridge.sh copilot-statusline-config.py; do
  cp "$REPO_DIR/scripts/$_f" "$PKG/scripts/$_f"
done
# OMP composition surface (Cells E/F): same discipline — every omp unit script is a real
# tracked file here, because the claims are about what the composition actually reaches.
for _f in omp-bridge-install.sh omp-bridge-oracle.sh omp-mcp-bridge.sh omp-mcp-config.py \
  omp-tool-surface.py omp-config-xdev.sh omp-config-xdev.py omp-receive-install.sh; do
  cp "$REPO_DIR/scripts/$_f" "$PKG/scripts/$_f"
done
cp -r "$REPO_DIR/pi" "$PKG/pi"
cp "$REPO_DIR/pi-extensions/lib/session-id.js" "$PKG/pi-extensions/lib/session-id.js"
printf '%s\n' '// dist stub: copied+digested by the receive installer, never executed here' \
  > "$PKG/mcp/entwurf-bridge/dist/pi-extensions/lib/meta-session.js"
cp "$PKG/pi-extensions/lib/session-id.js" "$PKG/mcp/entwurf-bridge/dist/pi-extensions/lib/session-id.js"
# The omp units select the same compiled closure in installed mode. Same stub discipline:
# the installers copy and digest these bytes, they never execute them here.
for _e in meta-bridge-omp.js meta-bridge-receive-omp.js; do
  printf '%s\n' '// dist stub: copied+digested by the omp installers, never executed here' \
    > "$PKG/mcp/entwurf-bridge/dist/pi-extensions/$_e"
done

# Fake pnpm: resolvable (so an unconditional require_cmd would pass), but any
# INVOCATION writes a marker and exits uniquely — the bootstrap tripwire.
MARKER="$SB/pnpm-invoked.marker"
mkdir -p "$SB/bin"
printf '#!/usr/bin/env bash\necho invoked > "%s"\nexit 97\n' "$MARKER" > "$SB/bin/pnpm"
chmod +x "$SB/bin/pnpm"

ABSENT="$SB/definitely-absent"
run_setup() { # $1=HOME-root $2=project $3=PATH $4=PI_BIN $5=COPILOT_BIN(opt) $6=OMP_BIN(opt) → OUT/RC
  mkdir -p "$1/.pi/agent" "$2"
  set +e
  # ONE physical line by contract: check-install-surface S5c is a line-scoped static tripwire,
  # so the sandbox env assignments must ride the same line as the run.sh drive they guard.
  OUT="$(HOME="$1" XDG_DATA_HOME="$1/.local/share" XDG_STATE_HOME="$1/.local/state" XDG_CACHE_HOME="$1/.cache" XDG_CONFIG_HOME="$1/.config" PI_CODING_AGENT_DIR="$1/.pi/agent" PATH="$3" PI_BIN="$4" CLAUDE_BIN="$ABSENT" AGY_BIN="$ABSENT" COPILOT_BIN="${5:-$ABSENT}" OMP_BIN="${6:-$ABSENT}" ENTWURF_OMP_AGENT_DIR="$1/.omp/agent" bash "$PKG/run.sh" setup "$2" 2>&1)"
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
want "A: an absent copilot is one zero-state SKIP — no unit composed, no .copilot written [QK:SETUP-COPILOT-ABSENT-SKIP]" \
  "printf '%s' \"\$OUT\" | grep -q 'copilot: SKIP' && [ ! -e '$HOME_A/.copilot' ]"
want "A: an absent omp is one zero-state SKIP — no unit composed, no .omp written [QK:SETUP-OMP-ABSENT-SKIP]" \
  "printf '%s' \"\$OUT\" | grep -q 'omp: SKIP' && [ ! -e '$HOME_A/.omp' ]"
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

# ── Cell D: copilot PRESENT, vendor lists failing — independence + no cosmetic PASS ──
# A two-line always-failing vendor is enough here: the birth installer dies at its
# read-only `plugin list` preflight (UNKNOWN, never absence), while the three writer
# units never touch the vendor and land in the sandbox. Behavior evidence for the
# full success composition lives in smoke-setup-verdict S-6 / check-pack-install.
BROKEN="$SB/broken-vendor"; mkdir -p "$BROKEN"
printf '#!/usr/bin/env bash\necho "not authenticated" >&2\nexit 1\n' > "$BROKEN/copilot"
chmod +x "$BROKEN/copilot"
run_setup "$SB/home-d" "$SB/proj-d" "$BROKEN:$SB/bin:$PATH" "$ABSENT" "$BROKEN/copilot"
want "D: a failed birth leaves the other three units attempted with their own rows [QK:SETUP-COPILOT-INDEPENDENT]" \
  "printf '%s' \"\$OUT\" | grep -q 'copilot-mcp: PASS' && printf '%s' \"\$OUT\" | grep -q 'copilot-receive: PASS' && printf '%s' \"\$OUT\" | grep -q 'copilot-statusline: PASS'"
want "D: the failing-vendor birth is a named FAIL, never a cosmetic PASS [QK:SETUP-COPILOT-COSMETIC-PASS]" \
  "printf '%s' \"\$OUT\" | grep -q 'copilot-birth: FAIL' && ! printf '%s' \"\$OUT\" | grep -q 'copilot-birth: PASS'"
want "D control: detected copilot never reads SKIP, and the summary names copilot-birth NON-GREEN" \
  "! printf '%s' \"\$OUT\" | grep -q 'copilot: SKIP' && printf '%s' \"\$OUT\" | grep -q 'NON-GREEN' && printf '%s' \"\$OUT\" | grep -q 'copilot-birth'"

# ── Cell E: omp PRESENT — the four units compose, and the SETTING is a real writer ──
# The omp unit scripts never spawn the vendor (they probe `omp` on PATH and write into the
# agent dir), so a stub binary is a faithful presence pin. Two claims live here: the
# composition reaches omp at all, and the tools.xdev writer refuses an EXPLICIT operator
# `true` by name rather than overwriting a decision it disagrees with.
STUB_OMP="$SB/stub-omp"; mkdir -p "$STUB_OMP"
printf '#!/usr/bin/env bash\necho "omp/18.0.0"\n' > "$STUB_OMP/omp"
chmod +x "$STUB_OMP/omp"
run_setup "$SB/home-e" "$SB/proj-e" "$STUB_OMP:$SB/bin:$PATH" "$ABSENT" "" "$STUB_OMP/omp"
# One assertion on purpose: the four PASS rows AND the artifacts behind them. Split in two,
# the row half alone passes a composition that reports PASS without running the unit.
want "E: a detected omp composes all four units — own rows, each backed by its ARTIFACT rather than an exit code [QK:SETUP-OMP-INDEPENDENT]" \
  "printf '%s' \"\$OUT\" | grep -q 'omp-birth: PASS' && printf '%s' \"\$OUT\" | grep -q 'omp-mcp: PASS' && printf '%s' \"\$OUT\" | grep -q 'omp-config: PASS' && printf '%s' \"\$OUT\" | grep -q 'omp-receive: PASS' && ! printf '%s' \"\$OUT\" | grep -q 'omp: SKIP' && [ -d '$SB/home-e/.omp/agent/extensions/entwurf-meta-omp' ] && [ -d '$SB/home-e/.omp/agent/extensions/entwurf-receive-omp' ] && [ -f '$SB/home-e/.omp/agent/mcp.json' ]"
want "E control: the setting reached the config the vendor reads (effective xdev-off)" \
  "[ \"\$(python3 '$PKG/scripts/omp-tool-surface.py' '$SB/home-e/.omp/agent' | awk '/^verdict /{print \$2}')\" = 'xdev-off' ]"
# Now the disagreement branch: an operator who wrote xdev: true explicitly owns that value.
mkdir -p "$SB/home-f/.omp/agent"
printf 'tools: \n  xdev: true\n' > "$SB/home-f/.omp/agent/config.yml"
run_setup "$SB/home-f" "$SB/proj-f" "$STUB_OMP:$SB/bin:$PATH" "$ABSENT" "" "$STUB_OMP/omp"
want "F: an EXPLICIT operator tools.xdev:true is refused by name, never overwritten [QK:SETUP-OMP-CONFIG-NO-OVERWRITE]" \
  "printf '%s' \"\$OUT\" | grep -q 'omp-config: FAIL' && grep -q 'xdev: true' '$SB/home-f/.omp/agent/config.yml' && ! grep -q 'xdev: false' '$SB/home-f/.omp/agent/config.yml'"
want "F control: the disagreement is a component FAIL that leaves the other omp units composed" \
  "printf '%s' \"\$OUT\" | grep -q 'omp-birth: PASS' && printf '%s' \"\$OUT\" | grep -q 'omp-receive: PASS' && printf '%s' \"\$OUT\" | grep -q 'NON-GREEN'"

echo ""
echo "check-setup-qualification: $PASS checks passed (mutation-attribution oracle only — behavior evidence lives in smoke-setup-verdict and check-pack-install)"
