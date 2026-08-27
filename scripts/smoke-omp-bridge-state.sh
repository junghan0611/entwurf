#!/usr/bin/env bash
# smoke-omp-bridge-state — hermetic install/doctor/inverse contract for the OMP BIRTH
# extension (#87). No omp process, no model turn, no writes outside the sandbox.
#
# The four properties an install surface owes (adding-a-harness.md step 4(b)), read for a
# unit that is a DIRECTORY rather than a config key:
#   - it installs where the vendor actually looks, and the doctor agrees;
#   - the inverse is honest — it removes exactly what the state records, and a host whose
#     ownership cannot be established REFUSES rather than tidying up;
#   - a foreign or symlinked artifact at our path is refused, never written through;
#   - a stale deployed copy of the shared writer is named, because that is the failure
#     mode a new backend id creates on every deployed reader (step 2(c)).
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUN="$REPO_DIR/run.sh"
pass=0
ok() { printf '  ok    %s\n' "$1"; pass=$((pass + 1)); }
die() { printf 'FAIL: %s\n' "$1" >&2; exit 1; }
want() { eval "$2" && ok "$1" || die "$1"; }

REPO_BEFORE="$(cd "$REPO_DIR" && git status --porcelain)"
SB="$(mktemp -d)"
trap 'rm -rf "$SB"' EXIT
export HOME="$SB/home"
export XDG_DATA_HOME="$SB/xdg"
export ENTWURF_OMP_AGENT_DIR="$SB/home/.omp/agent"
mkdir -p "$ENTWURF_OMP_AGENT_DIR" "$SB/bin"
# The installer requires the vendor on PATH — entwurf never installs a harness, so an
# absent omp is a refusal rather than a silent no-op. A fake binary is enough: nothing in
# this lane executes it (the unit is a module omp imports, not a process we launch).
printf '#!/usr/bin/env bash\nexit 0\n' > "$SB/bin/omp"
chmod +x "$SB/bin/omp"
export PATH="$SB/bin:$PATH"

UNIT_DIR="$ENTWURF_OMP_AGENT_DIR/extensions/entwurf-meta-omp"
STATE="$XDG_DATA_HOME/entwurf/omp-bridge/install-state.json"
ASM="$XDG_DATA_HOME/entwurf/meta-bridge-omp/.assembled"

# ── 1. install ───────────────────────────────────────────────────────────────
"$RUN" install-omp-bridge >/dev/null || die "install-omp-bridge failed"
want "the unit lands where omp's native discovery looks" "[ -f '$UNIT_DIR/index.ts' ]"
want "it carries the shared V3 writer" "[ -f '$UNIT_DIR/lib/meta-session.ts' ]"
want "it carries the capability registry the writer resolves via ../" "[ -f '$UNIT_DIR/entwurf-capabilities.json' ]"
want "ownership state was written" "[ -f '$STATE' ]"
want "the state records the unit dir it placed" "grep -q '\"unitDir\"' '$STATE' && grep -q 'entwurf-meta-omp' '$STATE'"
want "config.yml was NOT created or touched — this unit owns no operator SSOT" "[ ! -e '$ENTWURF_OMP_AGENT_DIR/config.yml' ]"
"$RUN" doctor-omp-bridge >/dev/null || die "doctor red right after a clean install"
ok "doctor is green right after install"

# ── 2. reinstall is idempotent ───────────────────────────────────────────────
"$RUN" install-omp-bridge >/dev/null || die "reinstall over our own state failed"
"$RUN" doctor-omp-bridge >/dev/null || die "doctor red after a reinstall"
ok "reinstall over our own state is idempotent and stays green"

# ── 3. a STALE deployed writer is named ──────────────────────────────────────
printf '\n// drifted\n' >> "$UNIT_DIR/lib/meta-session.ts"
if OUT="$("$RUN" doctor-omp-bridge 2>&1)"; then
  die "doctor stayed green with a stale deployed writer"
fi
printf '%s\n' "$OUT" | grep -q "STALE" || die "doctor went red without naming the staleness"
ok "a drifted copy of the writer is reported as STALE, with the redeploy prescription"
"$RUN" install-omp-bridge >/dev/null
"$RUN" doctor-omp-bridge >/dev/null || die "reinstall did not repair the stale writer"
ok "reinstall repairs it"

# ── 4. the inverse is honest ─────────────────────────────────────────────────
"$RUN" uninstall-omp-bridge >/dev/null || die "uninstall failed"
want "the unit is gone" "[ ! -e '$UNIT_DIR' ]"
want "the assembly is gone" "[ ! -e '$ASM' ]"
want "the ownership state is gone" "[ ! -e '$STATE' ]"
want "the agent dir itself survives — we only ever owned our own subdirectory" "[ -d '$ENTWURF_OMP_AGENT_DIR' ]"
"$RUN" doctor-omp-bridge >/dev/null || die "doctor red on a clean uninstalled host (zero state is a SKIP, not a fault)"
ok "doctor reads a clean uninstalled host as zero-state, not as a fault"

if "$RUN" uninstall-omp-bridge >/dev/null 2>&1; then
  die "uninstall on a no-state host reported success"
fi
ok "a second uninstall REFUSES — a no-state host is unproven ownership, not an empty one"

# ── 5. a foreign unit at our path is refused, never written through ──────────
mkdir -p "$UNIT_DIR"
printf 'someone else\n' > "$UNIT_DIR/index.ts"
if "$RUN" install-omp-bridge >/dev/null 2>&1; then
  die "install adopted a foreign directory that fails the structural oracle"
fi
want "the foreign file is byte-identical after the refusal" "grep -q 'someone else' '$UNIT_DIR/index.ts'"
want "no ownership state was written by the refusal" "[ ! -e '$STATE' ]"
ok "a foreign no-state unit is refused with zero writes"
rm -rf "$UNIT_DIR"

mkdir -p "$SB/elsewhere"
ln -s "$SB/elsewhere" "$UNIT_DIR"
if "$RUN" install-omp-bridge >/dev/null 2>&1; then
  die "install wrote through a symlinked unit path"
fi
want "the symlink target is still empty — nothing was written through the link" "[ -z \"\$(ls -A '$SB/elsewhere')\" ]"
ok "a SYMLINK at the unit path is refused"
rm -f "$UNIT_DIR"

# ── 6. an ambiguous agent dir refuses instead of guessing (ledger M6) ────────
# omp is a pi fork and reads pi's env vocabulary, so an inherited PI_* knob does not say
# WHICH harness it is addressing. Installing into a directory chosen by that guess is how
# an operator ends up with a unit no live omp reads.
for var in PI_CODING_AGENT_DIR PI_CONFIG_DIR; do
  if env -u ENTWURF_OMP_AGENT_DIR "$var=$SB/ambiguous" "$RUN" install-omp-bridge >/dev/null 2>&1; then
    die "install guessed an agent dir while $var was set"
  fi
  ok "$var set (with no explicit override) REFUSES rather than guessing which harness it addresses"
done
if env -u ENTWURF_OMP_AGENT_DIR PI_PROFILE=work "$RUN" install-omp-bridge >/dev/null 2>&1; then
  die "install guessed an agent dir from PI_PROFILE alone"
fi
ok "PI_PROFILE without OMP_PROFILE REFUSES — pi and omp both read it"

# ── 7. --assemble-only never touches the live assembly ──────────────────────
if ENTWURF_OMP_ASM="$ASM" "$RUN" install-omp-bridge --assemble-only >/dev/null 2>&1; then
  die "--assemble-only rebuilt the DEFAULT live assembly"
fi
ok "--assemble-only refuses the live assembly path (it writes no ownership state)"

# ── 8. the repo itself was never written ────────────────────────────────────
REPO_AFTER="$(cd "$REPO_DIR" && git status --porcelain)"
[ "$REPO_BEFORE" = "$REPO_AFTER" ] || die "the smoke mutated the repo working tree"
ok "the checkout is byte-identical to before the smoke"

printf '[smoke-omp-bridge-state] %d assertions ok\n' "$pass"
