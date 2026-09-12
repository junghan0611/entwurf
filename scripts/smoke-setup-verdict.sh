#!/usr/bin/env bash
# smoke-setup-verdict.sh — the smallest aggregate `setup` verdict fixture (#86 C1).
#
# The aggregate composition had ZERO automated consumers before this file: no
# living layer executed `entwurf setup` at all, so the false-green shape (WARN
# swallowing + unconditional "DONE ... green") had only a human operator as its
# gate. This fixture drives the REAL `run.sh setup` end to end in a sandbox and
# pins exactly the #86 C1 acceptance cells:
#
#   S-1 all-harness-absent  → core PASS, pi/claude/agy/copilot/omp SKIP, computed green,
#                             zero harness writes, credential store untouched
#   S-2 pi below floor      → detected FAIL (never SKIP), nonzero, no Pi wiring
#   S-3 pi at floor         → presence completes project+user wiring, green,
#                             credential store still byte-identical
#   S-4 agy detected+corrupt→ named component FAIL + NON-GREEN + nonzero exit,
#                             core and later components still attempted
#   S-8 omp present         → the four omp units compose (birth/MCP/tools.xdev
#                             setting/receiver), states exist, second run idempotent
#   S-8c codex present      → birth publishes but stays a named FAIL until the vendor trust
#                             receipt exists; all three atoms compose twice, preserve foreign
#                             config, stay idempotent, and go green on the trusted rerun
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
# PI_BIN / CLAUDE_BIN / AGY_BIN / COPILOT_BIN / OMP_BIN / CODEX_BIN (the same hermetic seam
# smoke-agy-install-state
# uses), and every write root is sandboxed: HOME, XDG roots, the pi agent dir,
# and the dev-bin dir. Source-mode cells put a strict fixture `pnpm` first on PATH:
# it accepts the no-op `install --frozen-lockfile` and the source-owned `run build-bridge`
# emit only. Package-manager behavior belongs to the package gates. This is load-bearing
# under mutation qualification, whose snapshot shares node_modules read-only — a real pnpm
# follows that symlink and attempts to rewrite the origin checkout. Any dist this gate had
# to build is removed on exit, restoring the snapshot's pre-gate surface.
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
DIST_ROOT="$REPO_DIR/mcp/entwurf-bridge/dist"
DIST_PREEXISTED=0
[ -d "$DIST_ROOT" ] && DIST_PREEXISTED=1
cleanup() {
  [ "$DIST_PREEXISTED" -eq 1 ] || rm -rf "$DIST_ROOT"
  rm -rf "$SB"
}
trap cleanup EXIT

export HOME="$SB/home"
export XDG_DATA_HOME="$SB/home/.local/share"
export XDG_STATE_HOME="$SB/home/.local/state"
export XDG_CACHE_HOME="$SB/home/.cache"
export XDG_CONFIG_HOME="$SB/home/.config"
export PI_CODING_AGENT_DIR="$SB/home/.pi/agent"
export ENTWURF_DEV_BIN_DIR="$SB/bin"
export PATH="$SB/bin:$PATH"
mkdir -p "$HOME" "$PI_CODING_AGENT_DIR" "$SB/bin" "$SB/harness" "$SB/bootstrap-bin"
cat > "$SB/bootstrap-bin/pnpm" <<'SH'
#!/bin/sh
if [ "$#" -eq 2 ] && [ "$1" = install ] && [ "$2" = --frozen-lockfile ]; then
  exit 0
fi
if [ "$#" -eq 2 ] && [ "$1" = run ] && [ "$2" = build-bridge ]; then
  # The qualification snapshot is process-exclusive. Invoke the source-owned emit
  # directly so the production lock wrapper cannot leave its ignored parent dir.
  exec bash scripts/build-bridge.sh
fi
echo "fixture pnpm accepts only: install --frozen-lockfile | run build-bridge" >&2
exit 64
SH
chmod +x "$SB/bootstrap-bin/pnpm"
export PATH="$SB/bootstrap-bin:$PATH"

# Presence pins: default every harness to a definitely-absent path; each cell
# re-pins what it needs. Production leaves these unset.
ABSENT="$SB/harness/definitely-absent"
export PI_BIN="$ABSENT" CLAUDE_BIN="$ABSENT" AGY_BIN="$ABSENT" COPILOT_BIN="$ABSENT" OMP_BIN="$ABSENT" CODEX_BIN="$ABSENT"

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
want "S-1: all-absent setup exits 0 with a Codex SKIP" \
  "[ '$RC' -eq 0 ] && printf '%s' \"\$OUT\" | grep -q 'codex: SKIP'"
want "S-1: mode is a named source-checkout branch, printed first" \
  "printf '%s' \"\$OUT\" | head -n 1 | grep -q 'mode: source checkout'"
want "S-1: pi absent is an explicit zero-state SKIP" "printf '%s' \"\$OUT\" | grep -q 'pi: SKIP'"
want "S-1: claude absent is an explicit zero-state SKIP" "printf '%s' \"\$OUT\" | grep -q 'claude: SKIP'"
want "S-1: agy absent is an explicit zero-state SKIP" "printf '%s' \"\$OUT\" | grep -q 'agy: SKIP'"
want "S-1: copilot absent is an explicit zero-state SKIP" "printf '%s' \"\$OUT\" | grep -q 'copilot: SKIP'"
want "S-1: omp absent is an explicit zero-state SKIP" "printf '%s' \"\$OUT\" | grep -q 'omp: SKIP'"
want "S-1: core bridge boundary validated (PASS)" "printf '%s' \"\$OUT\" | grep -q 'core: PASS'"
want "S-1: final verdict is computed, not unconditional" \
  "printf '%s' \"\$OUT\" | grep -q 'result: green (computed from the component outcomes above)'"
want "S-1: the retired unconditional green line is gone" \
  "! printf '%s' \"\$OUT\" | grep -q 'pi adapter + detected native bridges + v2 install smoke) green'"
want "S-1: zero Pi wiring written for an absent pi" "[ ! -e '$PROJ1/.pi' ]"
want "S-1: no user-scope pi settings were created" "[ ! -e '$PI_CODING_AGENT_DIR/settings.json' ]"
want "S-1: no agy config was created" "[ ! -e '$HOME/.gemini' ]"
want "S-1: no Copilot config/units were created" "[ ! -e '$HOME/.copilot' ]"
want "S-1: no OMP config/units were created" "[ ! -e '$HOME/.omp' ]"
want "S-1: no Codex config/units were created" "[ ! -e '$HOME/.codex' ]"
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

# ── S-6: copilot PRESENT → all FOUR units compose independently as PASS (#86 C3b) ──
# The fake vendor is the shared factory (scripts/fake-copilot-vendor.sh, the
# same measured answer shapes check-copilot-birth-hook.ts bakes), so the birth
# installer's real preflight/list/add/install sequence runs end to end against
# it. The three writer units (MCP/receiver/footer) never touch the vendor; they
# land in the sandbox HOME/XDG.
echo "[smoke-setup-verdict] S-6 copilot present — four-unit composition"
PROJ6="$SB/proj6"; mkdir -p "$PROJ6"
FAKE_COP="$SB/harness/copilot-fake"
bash "$REPO_DIR/scripts/fake-copilot-vendor.sh" "$FAKE_COP" "$REPO_DIR/pi/meta-bridge-copilot/entwurf-meta-receive-copilot/.claude-plugin/plugin.json"
seed_auth
set +e; OUT="$(COPILOT_BIN="$FAKE_COP/copilot" PATH="$FAKE_COP:$PATH" bash "$REPO_DIR/run.sh" setup "$PROJ6" 2>&1)"; RC=$?; set -e
want "S-6: copilot-present setup exits 0 (four units + core all green)" "[ '$RC' -eq 0 ]"
want "S-6: birth unit composed as PASS" "printf '%s' \"\$OUT\" | grep -q 'copilot-birth: PASS'"
want "S-6: MCP unit composed as PASS" "printf '%s' \"\$OUT\" | grep -q 'copilot-mcp: PASS'"
want "S-6: receiver unit composed as PASS" "printf '%s' \"\$OUT\" | grep -q 'copilot-receive: PASS'"
want "S-6: visible-footer unit composed as PASS" "printf '%s' \"\$OUT\" | grep -q 'copilot-statusline: PASS'"
want "S-6: computed summary is green" \
  "printf '%s' \"\$OUT\" | grep -q 'result: green (computed from the component outcomes above)'"
want "S-6: the birth install drove the real vendor sequence (marketplace add before plugin install)" \
  "grep -q '^plugin marketplace add ' '$FAKE_COP/calls.log' && grep -q '^plugin install entwurf-meta-receive-copilot@meta-bridge-copilot-local$' '$FAKE_COP/calls.log'"
want "S-6: all four package-owned install-states exist (each unit keeps its inverse authority)" \
  "[ -f '$XDG_DATA_HOME/entwurf/copilot-bridge/install-state.json' ] && [ -f '$XDG_DATA_HOME/entwurf/copilot-mcp/install-state.json' ] && [ -f '$XDG_DATA_HOME/entwurf/copilot-receive/install-state.json' ] && [ -f '$XDG_DATA_HOME/entwurf/copilot-statusline/install-state.json' ]"
want "S-6: the receiver unit was deployed from the compiled dist closure" \
  "[ -f '$HOME/.copilot/extensions/entwurf-receive/extension.mjs' ] && [ -f '$HOME/.copilot/extensions/entwurf-receive/lib/meta-session.js' ]"
want "S-6: MCP config and footer settings landed in the sandbox HOME" \
  "grep -q 'entwurf-bridge' '$HOME/.copilot/mcp-config.json' && grep -q 'entwurf-copilot-statusline' '$HOME/.copilot/settings.json'"
want_auth_untouched "S-6"
# Reset the composed Copilot state so the next cell decides on a clean host.
rm -rf "$HOME/.copilot" "$XDG_DATA_HOME/entwurf/copilot-bridge" "$XDG_DATA_HOME/entwurf/copilot-mcp" \
  "$XDG_DATA_HOME/entwurf/copilot-receive" "$XDG_DATA_HOME/entwurf/copilot-statusline" \
  "$XDG_DATA_HOME/entwurf/meta-bridge-copilot"

# ── S-7: copilot present but vendor lists FAIL → birth is a NAMED FAIL, the other ──
# three units are still attempted (independent outcomes), and the aggregate is
# NON-GREEN + nonzero. A failing `plugin list` is UNKNOWN, never absence (#86
# C3a), so the composition must not relabel it SKIP or cosmetic PASS.
echo "[smoke-setup-verdict] S-7 copilot present, vendor list failing"
PROJ7="$SB/proj7"; mkdir -p "$PROJ7"
BROKEN_COP="$SB/harness/copilot-broken"; mkdir -p "$BROKEN_COP"
printf '#!/usr/bin/env bash\necho "not authenticated" >&2\nexit 1\n' > "$BROKEN_COP/copilot"
chmod +x "$BROKEN_COP/copilot"
seed_auth
set +e; OUT="$(COPILOT_BIN="$BROKEN_COP/copilot" PATH="$BROKEN_COP:$PATH" bash "$REPO_DIR/run.sh" setup "$PROJ7" 2>&1)"; RC=$?; set -e
want "S-7: the failing-vendor birth is a NAMED component FAIL, never SKIP or PASS" \
  "printf '%s' \"\$OUT\" | grep -q 'copilot-birth: FAIL' && ! printf '%s' \"\$OUT\" | grep -q 'copilot: SKIP'"
want "S-7: the other three units were still attempted independently" \
  "printf '%s' \"\$OUT\" | grep -q 'copilot-mcp: PASS' && printf '%s' \"\$OUT\" | grep -q 'copilot-receive: PASS' && printf '%s' \"\$OUT\" | grep -q 'copilot-statusline: PASS'"
want "S-7: the detected birth failure owns a nonzero setup exit" "[ '$RC' -ne 0 ]"
want "S-7: summary is NON-GREEN naming copilot-birth" \
  "printf '%s' \"\$OUT\" | grep -q 'NON-GREEN (FAIL: copilot-birth)'"
want "S-7: later components were still attempted (core bridge smoke ran)" \
  "printf '%s' \"\$OUT\" | grep -q 'core: PASS'"
want "S-7: the refused birth wrote no vendor ownership state" \
  "[ ! -e '$XDG_DATA_HOME/entwurf/copilot-bridge/install-state.json' ]"
want_auth_untouched "S-7"
rm -rf "$HOME/.copilot" "$XDG_DATA_HOME/entwurf/copilot-mcp" "$XDG_DATA_HOME/entwurf/copilot-receive" \
  "$XDG_DATA_HOME/entwurf/copilot-statusline"

# ── S-8: omp present → the FOUR omp units compose, including the operator setting ──
# OMP shipped in v0.16.0 with installers, doctors and inverses for every unit, but
# `setup` did not compose it — the fifth backend was a hand-run verb list and the
# `tools.xdev` setting was a documentation step, so a one-command host came up with
# an omp citizen whose MCP tools the model could not call. This cell is the standing
# consumer of that composition. The omp unit scripts touch NO vendor process: they
# only probe `omp` on PATH and write into the agent dir, so a stub binary is a
# faithful presence pin and every write lands in the sandbox HOME.
echo "[smoke-setup-verdict] S-8 omp present — four-unit composition"
PROJ8="$SB/proj8"; mkdir -p "$PROJ8"
FAKE_OMP="$SB/harness/omp-fake"; mkdir -p "$FAKE_OMP"
printf '#!/usr/bin/env bash\necho "omp/18.0.0"\n' > "$FAKE_OMP/omp"
chmod +x "$FAKE_OMP/omp"
seed_auth
# This sandbox exports PI_CODING_AGENT_DIR, which omp reads too — the oracle refuses
# that ambiguity by design (ledger M6), so the cell names the agent dir explicitly, the
# same seam a real operator on a pi-rail host would use.
OMP_AGENT="$HOME/.omp/agent"
set +e; OUT="$(OMP_BIN="$FAKE_OMP/omp" ENTWURF_OMP_AGENT_DIR="$OMP_AGENT" PATH="$FAKE_OMP:$PATH" bash "$REPO_DIR/run.sh" setup "$PROJ8" 2>&1)"; RC=$?; set -e
want "S-8: omp-present setup exits 0 (four units + core all green)" "[ '$RC' -eq 0 ]"
want "S-8: birth unit composed as PASS" "printf '%s' \"\$OUT\" | grep -q 'omp-birth: PASS'"
want "S-8: MCP unit composed as PASS" "printf '%s' \"\$OUT\" | grep -q 'omp-mcp: PASS'"
want "S-8: the tools.xdev operator setting composed as PASS" "printf '%s' \"\$OUT\" | grep -q 'omp-config: PASS'"
want "S-8: receiver unit composed as PASS" "printf '%s' \"\$OUT\" | grep -q 'omp-receive: PASS'"
want "S-8: computed summary is green" \
  "printf '%s' \"\$OUT\" | grep -q 'result: green (computed from the component outcomes above)'"
want "S-8: all four package-owned install-states exist (each unit keeps its inverse authority)" \
  "[ -f '$XDG_DATA_HOME/entwurf/omp-bridge/install-state.json' ] && [ -f '$XDG_DATA_HOME/entwurf/omp-mcp/install-state.json' ] && [ -f '$XDG_DATA_HOME/entwurf/omp-config/install-state.json' ] && [ -f '$XDG_DATA_HOME/entwurf/omp-receive/install-state.json' ]"
want "S-8: both extension units landed in the sandbox omp agent dir" \
  "[ -d '$HOME/.omp/agent/extensions/entwurf-meta-omp' ] && [ -d '$HOME/.omp/agent/extensions/entwurf-receive-omp' ]"
want "S-8: the MCP hand wrote the pinned key and the setting reached the config the vendor reads" \
  "grep -q 'entwurf-bridge' '$HOME/.omp/agent/mcp.json' && [ \"\$(python3 '$REPO_DIR/scripts/omp-tool-surface.py' '$HOME/.omp/agent' | awk '/^verdict /{print \$2}')\" = 'xdev-off' ]"
want "S-8: setup is idempotent — a second run over the composed host is still green" \
  "OMP_BIN='$FAKE_OMP/omp' ENTWURF_OMP_AGENT_DIR='$HOME/.omp/agent' PATH='$FAKE_OMP:$PATH' bash '$REPO_DIR/run.sh' setup '$PROJ8' 2>&1 | grep -q 'result: green (computed from the component outcomes above)'"
want_auth_untouched "S-8"
# Reset the composed OMP state so the next cell decides on a clean host.
rm -rf "$HOME/.omp" "$XDG_DATA_HOME/entwurf/omp-bridge" "$XDG_DATA_HOME/entwurf/omp-mcp" \
  "$XDG_DATA_HOME/entwurf/omp-config" "$XDG_DATA_HOME/entwurf/omp-receive" \
  "$XDG_DATA_HOME/entwurf/meta-bridge-omp" "$XDG_DATA_HOME/entwurf/omp-receive"

# ── S-8c: codex PRESENT → setup publishes birth, and stays NON-GREEN until the vendor agrees ──
# The birth unit's paths are the operator's own, so setup installs it here for real, inside the
# fixture's HOME/CODEX_HOME/XDG. What setup CANNOT do is answer the vendor's one-time trust
# prompt: that is the operator's, in their own visible Codex. So the first run writes every
# byte and is honestly non-green, the two config atoms compose anyway, and the run after a
# vendor receipt appears is green and byte-idempotent. Nothing here ever writes [hooks.state] —
# the receipt is forged by the FIXTURE to stand in for the vendor, never by setup.
echo "[smoke-setup-verdict] S-8c codex present — incomplete three-unit composition"
PROJ8C="$SB/proj8c"; mkdir -p "$PROJ8C"
FAKE_CODEX="$SB/harness/codex-fake"; mkdir -p "$FAKE_CODEX"
printf '#!/usr/bin/env bash\necho "codex-cli 0.153.4"\n' > "$FAKE_CODEX/codex"
chmod +x "$FAKE_CODEX/codex"
CODEX_HOME_SANDBOX="$HOME/.codex"
mkdir -p "$CODEX_HOME_SANDBOX"
cat > "$CODEX_HOME_SANDBOX/config.toml" <<'TOML'
model = "operator-model"

[projects."/operator/keep"]
trust_level = "trusted"

[mcp_servers.operator-owned]
command = "/operator/bin/server"
args = ["--keep"]

[tui]
status_line = ["model-with-reasoning"]
TOML
REAL_BASH="$(command -v bash)"
CODEX_BIRTH_UNIT_ROOT="$XDG_DATA_HOME/entwurf/codex-birth"
seed_auth
set +e
OUT="$(CODEX_BIN="$FAKE_CODEX/codex" CODEX_HOME="$CODEX_HOME_SANDBOX" PATH="$FAKE_CODEX:$PATH" "$REAL_BASH" "$REPO_DIR/run.sh" setup "$PROJ8C" 2>&1)"
RC=$?
set -e
want "[QK:CODEX-SETUP-NEVER-PRESEEDS-TRUST] S-8c: setup wrote NO vendor trust receipt of its own" \
  "! grep -q 'hooks.state' '$CODEX_HOME_SANDBOX/config.toml' && ! grep -q 'trusted_hash' '$CODEX_HOME_SANDBOX/config.toml'"
want "S-8c: detected-incomplete Codex is a named nonzero result, never an absent SKIP [QK:CODEX-SETUP-BIRTH-COSMETIC-PASS]" \
  "[ '$RC' -ne 0 ] && printf '%s' \"\$OUT\" | grep -q 'codex-birth: FAIL' && ! printf '%s' \"\$OUT\" | grep -q 'codex: SKIP'"
want "S-8c: both user-owned Codex atoms still compose independently as PASS [QK:CODEX-SETUP-BIRTH-INDEPENDENT]" \
  "printf '%s' \"\$OUT\" | grep -q 'codex-mcp: PASS' && printf '%s' \"\$OUT\" | grep -q 'codex-statusline: PASS'"
want "S-8c: summary is NON-GREEN and attributes it to the untrusted birth unit" \
  "printf '%s' \"\$OUT\" | grep -q 'NON-GREEN (FAIL: codex-birth)' && ! printf '%s' \"\$OUT\" | grep -q 'result: green'"
want "S-8c: the reason names the operator's one-time answer, not a repair setup could have made" \
  "printf '%s' \"\$OUT\" | grep -q 'no trust receipt' && printf '%s' \"\$OUT\" | grep -q 'Trust all and continue'"
want "S-8c: setup PUBLISHED the birth unit — declaration, launcher closure and ownership state" \
  "[ -f '$CODEX_HOME_SANDBOX/hooks.json' ] && [ -x '$CODEX_BIRTH_UNIT_ROOT/helper/codex-birth-launch.sh' ] && [ -f '$CODEX_BIRTH_UNIT_ROOT/install-state.json' ]"
CODEX_MCP_STATE="$XDG_DATA_HOME/entwurf/codex-mcp/install-state.json"
CODEX_STATUSLINE_STATE="$XDG_DATA_HOME/entwurf/codex-statusline/install-state.json"
want "S-8c: both user atoms wrote their package-owned install states inside the sandbox" \
  "[ -f '$CODEX_MCP_STATE' ] && [ -f '$CODEX_STATUSLINE_STATE' ] && grep -q '\"atom\": \"codex-mcp\"' '$CODEX_MCP_STATE' && grep -q '\"atom\": \"codex-statusline\"' '$CODEX_STATUSLINE_STATE'"
want "S-8c: MCP and visible-identity atoms landed in the sandbox Codex config" \
  "grep -q '\\[mcp_servers\\.entwurf-bridge\\]' '$CODEX_HOME_SANDBOX/config.toml' && grep -q 'status_line = \\[\"thread-title\", \"model-with-reasoning\"\\]' '$CODEX_HOME_SANDBOX/config.toml'"
want "S-8c: unrelated operator config survives both atom writers" \
  "grep -q 'model = \"operator-model\"' '$CODEX_HOME_SANDBOX/config.toml' && grep -q '\\[mcp_servers\\.operator-owned\\]' '$CODEX_HOME_SANDBOX/config.toml' && grep -q 'command = \"/operator/bin/server\"' '$CODEX_HOME_SANDBOX/config.toml'"
CODEX_CONFIG_AFTER="$(sha256sum "$CODEX_HOME_SANDBOX/config.toml" | cut -d' ' -f1)"
CODEX_MCP_STATE_AFTER="$(sha256sum "$CODEX_MCP_STATE" | cut -d' ' -f1)"
CODEX_STATUSLINE_STATE_AFTER="$(sha256sum "$CODEX_STATUSLINE_STATE" | cut -d' ' -f1)"
set +e
OUT2="$(CODEX_BIN="$FAKE_CODEX/codex" CODEX_HOME="$CODEX_HOME_SANDBOX" PATH="$FAKE_CODEX:$PATH" "$REAL_BASH" "$REPO_DIR/run.sh" setup "$PROJ8C" 2>&1)"
RC2=$?
set -e
want "S-8c: second setup still reports the untrusted birth FAIL and both user atoms PASS" \
  "[ '$RC2' -ne 0 ] && printf '%s' \"\$OUT2\" | grep -q 'codex-birth: FAIL' && printf '%s' \"\$OUT2\" | grep -q 'codex-mcp: PASS' && printf '%s' \"\$OUT2\" | grep -q 'codex-statusline: PASS'"
want "S-8c: second setup is byte-idempotent for config and both ownership receipts" \
  "[ \"\$(sha256sum '$CODEX_HOME_SANDBOX/config.toml' | cut -d' ' -f1)\" = '$CODEX_CONFIG_AFTER' ] && [ \"\$(sha256sum '$CODEX_MCP_STATE' | cut -d' ' -f1)\" = '$CODEX_MCP_STATE_AFTER' ] && [ \"\$(sha256sum '$CODEX_STATUSLINE_STATE' | cut -d' ' -f1)\" = '$CODEX_STATUSLINE_STATE_AFTER' ]"
want "S-8c: second setup rechecks rather than faking the missing receipt" \
  "! printf '%s' \"\$OUT2\" | grep -q 'codex-birth: PASS' && ! grep -q 'trusted_hash' '$CODEX_HOME_SANDBOX/config.toml'"

# The vendor answers. Written by the FIXTURE, exactly as the vendor writes it after one
# 'Trust all': the receipt keyed to this declaration, carrying its own hash.
printf '\n[hooks.state."%s/hooks.json:session_start:0:0"]\ntrusted_hash = "sha256:%s"\n' \
  "$CODEX_HOME_SANDBOX" "$(printf '4%.0s' $(seq 64))" >> "$CODEX_HOME_SANDBOX/config.toml"
CODEX_CONFIG_TRUSTED="$(sha256sum "$CODEX_HOME_SANDBOX/config.toml" | cut -d' ' -f1)"
set +e
OUT3="$(CODEX_BIN="$FAKE_CODEX/codex" CODEX_HOME="$CODEX_HOME_SANDBOX" PATH="$FAKE_CODEX:$PATH" "$REAL_BASH" "$REPO_DIR/run.sh" setup "$PROJ8C" 2>&1)"
RC3=$?
set -e
want "[QK:CODEX-SETUP-TRUSTED-RERUN-GREEN] S-8c: once the vendor receipt exists the same setup is GREEN" \
  "[ '$RC3' -eq 0 ] && printf '%s' \"\$OUT3\" | grep -q 'codex-birth: PASS' && printf '%s' \"\$OUT3\" | grep -q 'result: green'"
want "S-8c: the trusted rerun is byte-idempotent — it neither rewrote the config nor touched the receipt" \
  "[ \"\$(sha256sum '$CODEX_HOME_SANDBOX/config.toml' | cut -d' ' -f1)\" = '$CODEX_CONFIG_TRUSTED' ]"
want_auth_untouched "S-8c"
rm -rf "$HOME/.codex" "$XDG_DATA_HOME/entwurf/codex-mcp" "$XDG_DATA_HOME/entwurf/codex-statusline" "$CODEX_BIRTH_UNIT_ROOT"

# ── S-9: rail certification is a SEPARATE axis from install success (#78 D1) ──
# The 0.20.0 macOS lane opened the installers to Darwin (meta-bridge-install.sh's
# platform gate became its own python3/node dependency instead of the platform
# name), and that removed the only thing which used to keep a detected Mac host
# non-green: the installer's refusal. A detected harness on Darwin now INSTALLS,
# every harness doctor still refuses there (NOT CERTIFIED — pending physical
# host), and `setup` runs no doctor. Hard Rule 17 names that shape non-green, so
# setup_harness_result does — and these cells are its ONLY executing consumer,
# because nothing else in this repo ever takes the Darwin branch.
#
# `uname` is faked on PATH exactly the way smoke-meta-install-state.sh already
# fakes it for the installer's own platform gate. Both directions are pinned so
# the fixture cannot pass for the wrong reason: the Linux twin below is the SAME
# sandbox, the SAME stub harnesses and the SAME fixture with one byte different,
# and S-3/S-8 above are the unfaked real-host Linux evidence.
FAKE_UNAME="$SB/fake-uname-darwin"; mkdir -p "$FAKE_UNAME"
# Absolute bash in the shebang, same reason as the sibling fixture: a cell may
# hand this script a PATH that does not carry `env`/`bash` itself.
cat > "$FAKE_UNAME/uname" <<SH
#!$(command -v bash)
printf '%s\n' Darwin
SH
chmod +x "$FAKE_UNAME/uname"
FAKE_UNAME_LINUX="$SB/fake-uname-linux"; mkdir -p "$FAKE_UNAME_LINUX"
cat > "$FAKE_UNAME_LINUX/uname" <<SH
#!$(command -v bash)
printf '%s\n' Linux
SH
chmod +x "$FAKE_UNAME_LINUX/uname"

omp_reset() {
  rm -rf "$HOME/.omp" "$XDG_DATA_HOME/entwurf/omp-bridge" "$XDG_DATA_HOME/entwurf/omp-mcp" \
    "$XDG_DATA_HOME/entwurf/omp-config" "$XDG_DATA_HOME/entwurf/omp-receive" \
    "$XDG_DATA_HOME/entwurf/meta-bridge-omp"
}

# ── S-9a: fake Darwin + DETECTED harnesses → named non-green, install intact ──
# Two harness FAMILIES on purpose (the pi adapter rail and the four omp units):
# a rule applied to one backend and not the next is a new defect, not half a fix.
echo "[smoke-setup-verdict] S-9a detected harnesses on an uncertified platform"
PROJ9="$SB/proj9"; mkdir -p "$PROJ9"
seed_auth
set +e; OUT="$(PI_BIN="$SB/harness/pi-ok" OMP_BIN="$FAKE_OMP/omp" ENTWURF_OMP_AGENT_DIR="$HOME/.omp/agent" PATH="$FAKE_UNAME:$FAKE_OMP:$PATH" bash "$REPO_DIR/run.sh" setup "$PROJ9" 2>&1)"; RC=$?; set -e
want "S-9a: a detected harness on an uncertified platform owns a nonzero setup exit" "[ '$RC' -ne 0 ]"
want "S-9a: the pi adapter rail is named non-green, never a cosmetic PASS" \
  "printf '%s' \"\$OUT\" | grep -q 'pi: FAIL' && ! printf '%s' \"\$OUT\" | grep -q 'pi: PASS'"
want "S-9a: all four omp units are named non-green, none cosmetically PASS" \
  "printf '%s' \"\$OUT\" | grep -q 'omp-birth: FAIL' && printf '%s' \"\$OUT\" | grep -q 'omp-mcp: FAIL' && printf '%s' \"\$OUT\" | grep -q 'omp-config: FAIL' && printf '%s' \"\$OUT\" | grep -q 'omp-receive: FAIL' && ! printf '%s' \"\$OUT\" | grep -q 'omp-[a-z]*: PASS'"
want "S-9a: the reason says the wiring WAS written (this is not an install failure)" \
  "printf '%s' \"\$OUT\" | grep -q 'the wiring WAS written and nothing failed to install'"
want "S-9a: the reason names the RAIL evidence state and the platform" \
  "printf '%s' \"\$OUT\" | grep -q 'NOT CERTIFIED — pending physical host on Darwin'"
want "S-9a: the reason names the doctor that owns the rail axis, per component" \
  "printf '%s' \"\$OUT\" | grep -qF \"owned by './run.sh doctor-omp-bridge'\" && printf '%s' \"\$OUT\" | grep -qF \"owned by './run.sh doctor-pi-provider'\""
want "S-9a: the reason points at the tracking issue" "printf '%s' \"\$OUT\" | grep -q 'Tracking: #78'"
want "S-9a: it never reads as an install refusal (no unsupported-platform / did-not-complete vocabulary)" \
  "! printf '%s' \"\$OUT\" | grep -qi 'unsupported platform' && ! printf '%s' \"\$OUT\" | grep -q 'did not complete'"
want "S-9a: the summary is NON-GREEN and names the uncertified components" \
  "printf '%s' \"\$OUT\" | grep -q 'NON-GREEN (FAIL:' && ! printf '%s' \"\$OUT\" | grep -q 'result: green'"
# The load-bearing half: the installs genuinely SUCCEEDED. Without this the cell
# would also pass if the platform had merely broken the installers.
want "S-9a: the wiring really landed — pi project settings plus both omp extensions and the MCP hand" \
  "[ -f '$PROJ9/.pi/settings.json' ] && [ -d '$HOME/.omp/agent/extensions/entwurf-meta-omp' ] && [ -d '$HOME/.omp/agent/extensions/entwurf-receive-omp' ] && [ -f '$HOME/.omp/agent/mcp.json' ]"
want_auth_untouched "S-9a"
omp_reset

# ── S-9b: the Linux twin — same fixture, one byte different → still PASS/green ──
# This is the regression axis that matters most: the certified platform's behavior
# must not have moved at all.
echo "[smoke-setup-verdict] S-9b the same detected harnesses on the certified platform"
PROJ9B="$SB/proj9b"; mkdir -p "$PROJ9B"
seed_auth
set +e; OUT="$(PI_BIN="$SB/harness/pi-ok" OMP_BIN="$FAKE_OMP/omp" ENTWURF_OMP_AGENT_DIR="$HOME/.omp/agent" PATH="$FAKE_UNAME_LINUX:$FAKE_OMP:$PATH" bash "$REPO_DIR/run.sh" setup "$PROJ9B" 2>&1)"; RC=$?; set -e
want "S-9b: the certified platform still exits 0" "[ '$RC' -eq 0 ]"
want "S-9b: pi and all four omp units still compose as PASS" \
  "printf '%s' \"\$OUT\" | grep -q 'pi: PASS' && printf '%s' \"\$OUT\" | grep -q 'omp-birth: PASS' && printf '%s' \"\$OUT\" | grep -q 'omp-mcp: PASS' && printf '%s' \"\$OUT\" | grep -q 'omp-config: PASS' && printf '%s' \"\$OUT\" | grep -q 'omp-receive: PASS'"
want "S-9b: a PASS row is byte-identical to the pre-#78 wording (the operator surface did not move)" \
  "printf '%s' \"\$OUT\" | grep -q 'omp-birth: PASS — birth extension installed — verify: ./run.sh doctor-omp-bridge'"
want "S-9b: the computed summary is green and carries no rail-certification wording" \
  "printf '%s' \"\$OUT\" | grep -q 'result: green (computed from the component outcomes above)' && ! printf '%s' \"\$OUT\" | grep -q 'NOT CERTIFIED'"
want_auth_untouched "S-9b"
omp_reset

# ── S-9c: fake Darwin + NO harness → still green (the macOS CI job's contract) ──
# The macos-install-surface job asserts exactly this shape on a real Darwin runner:
# five zero-state SKIPs, core PASS, computed green. The rule above must not reach
# an absent harness — SKIP is not a completed integration.
echo "[smoke-setup-verdict] S-9c harness-free host on an uncertified platform"
PROJ9C="$SB/proj9c"; mkdir -p "$PROJ9C"
seed_auth
set +e; OUT="$(PATH="$FAKE_UNAME:$PATH" bash "$REPO_DIR/run.sh" setup "$PROJ9C" 2>&1)"; RC=$?; set -e
want "S-9c: a harness-free uncertified host still exits 0" "[ '$RC' -eq 0 ]"
want "S-9c: all six harness probes are still zero-state SKIPs" \
  "printf '%s' \"\$OUT\" | grep -q 'pi: SKIP' && printf '%s' \"\$OUT\" | grep -q 'claude: SKIP' && printf '%s' \"\$OUT\" | grep -q 'agy: SKIP' && printf '%s' \"\$OUT\" | grep -q 'copilot: SKIP' && printf '%s' \"\$OUT\" | grep -q 'omp: SKIP' && printf '%s' \"\$OUT\" | grep -q 'codex: SKIP'"
want "S-9c: core still PASSes and the computed summary is still green" \
  "printf '%s' \"\$OUT\" | grep -q 'core: PASS' && printf '%s' \"\$OUT\" | grep -q 'result: green (computed from the component outcomes above)'"
want "S-9c: an absent harness is never given a rail verdict it did not earn" \
  "! printf '%s' \"\$OUT\" | grep -q 'NOT CERTIFIED'"
want_auth_untouched "S-9c"

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
