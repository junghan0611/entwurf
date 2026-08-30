#!/usr/bin/env bash
# omp-receive-install.sh — operator-grade global installer for the OMP RECEIVER
# extension (#87 bundle B). The fourth thing an omp citizen needs, and deliberately its
# own installer: birth, the MCP hand and receive are three independent atoms with three
# independent failure modes, and one installer owning all of them would let a broken
# birth withhold a doorbell (or worse, imply one).
#
# WHY A SECOND UNIT AND NOT A BRANCH INSIDE THE BIRTH UNIT. There is no second PROCESS
# here — an omp extension runs in-process, so both units live in the operator's TUI — but
# there are two independent CAPABILITIES, and the gate that proves birth mints no
# receiver (`check-omp-receive-arm` / `[QK:OMP-BIRTH-DOES-NOT-ARM-RECEIVER]`) stays true
# only while they are separable. An operator may install birth and decline receive; the
# inverse below is what makes that an honest offer rather than a slogan.
#
# THE UNIT DOES NOT ASSUME IT LOADS SECOND. `[LIVE 2026-08-30]` extension handlers run in
# directory-name collation order, and a discovered unit sorting before the birth unit saw
# no sender marker at its own `session_start` (20ms early). `entwurf-receive-omp` happens
# to sort after `entwurf-meta-omp`, so today it would arm on the first try — by accident.
# The unit therefore carries a bounded vendor-owned retry instead of relying on that, and
# this installer must never be "fixed" by renaming a directory.
#
# WHERE IT PLACES IT. `<agent-dir>/extensions/<unit>/index.{ts,js}`, the same native
# discovery rule the birth unit uses (`discovery/helpers.ts:625-712`). The agent dir is
# resolved by the shared oracle, which REFUSES rather than guesses when an inherited
# `PI_*` knob makes it ambiguous (ledger M6).
#
# Platform: Linux only, same fence as the Claude, Copilot and omp-birth installers.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/.." && pwd)"
UNIT="entwurf-receive-omp"
SRC="$REPO/pi/omp-receive"
# `ENTWURF_OMP_RECEIVE_ASM` exists for the gate: check-omp-receive-arm drives this script for real,
# into a temp dir, with --assemble-only. A gate that re-implemented the assembly would be
# testing its own copy of the logic instead of the shipped one.
ASM="${ENTWURF_OMP_RECEIVE_ASM:-${XDG_DATA_HOME:-$HOME/.local/share}/entwurf/omp-receive/.assembled}"
STATE_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/entwurf/omp-receive"
STATE_FILE="$STATE_DIR/install-state.json"
ASSEMBLE_ONLY=0

die() { echo "[omp-receive-install] $*" >&2; exit 1; }

for arg in "$@"; do
  case "$arg" in
    --assemble-only) ASSEMBLE_ONLY=1 ;;
    *) die "unknown argument: $arg (--assemble-only)" ;;
  esac
done

[ "$(uname -s)" = "Linux" ] || die "Linux only; $(uname -s) is not a certified axis for this install."
command -v python3 >/dev/null 2>&1 || die "python3 is required and is not on PATH."

# shellcheck source=scripts/omp-bridge-oracle.sh
. "$HERE/omp-bridge-oracle.sh"

if [ "$ASSEMBLE_ONLY" -eq 1 ]; then
  # A GATE-ONLY path that writes no ownership state, so it must never touch the LIVE
  # assembly: without a state, a rebuilt live assembly would drift from what the state
  # records. Same refusal the Copilot installer carries, for the same reason.
  DEFAULT_ASM="${XDG_DATA_HOME:-$HOME/.local/share}/entwurf/omp-receive/.assembled"
  [ -n "${ENTWURF_OMP_RECEIVE_ASM:-}" ] \
    || die "--assemble-only requires an explicit ENTWURF_OMP_RECEIVE_ASM (a temp dir): this gate-only path writes no ownership state and must not rebuild the live assembly."
  if [ "$(python3 -c 'import os,sys;print(os.path.abspath(sys.argv[1]))' "$ENTWURF_OMP_RECEIVE_ASM")" = \
       "$(python3 -c 'import os,sys;print(os.path.abspath(sys.argv[1]))' "$DEFAULT_ASM")" ]; then
    die "--assemble-only refuses the DEFAULT live assembly path ($DEFAULT_ASM): pass a temp ENTWURF_OMP_RECEIVE_ASM instead."
  fi
fi

AGENT_DIR=""
UNIT_DIR=""
if [ "$ASSEMBLE_ONLY" -eq 0 ]; then
  command -v omp >/dev/null 2>&1 || die "the 'omp' CLI is not on PATH. entwurf never installs a harness — install omp first, then re-run."
  AGENT_DIR="$(omp_agent_dir)" || die "refusing: the omp agent directory this host reads is ambiguous (see above)."
  UNIT_DIR="$AGENT_DIR/extensions/$UNIT"
fi

UNIT_VERSION="$(python3 -c "import json,sys;print(json.load(open(sys.argv[1]))['version'])" "$SRC/$UNIT/package.json")" \
  || die "could not read the shipped unit version from $SRC/$UNIT/package.json"
case "$UNIT_VERSION" in
  ""|*[![:graph:]]*) die "shipped unit version ${UNIT_VERSION:-<empty>} is empty or carries whitespace/control characters — it travels through space-separated fact transports." ;;
esac

# Same install-shape split as the Claude and Copilot installers: an installed package
# lives below node_modules where Node refuses strip-types on `.ts`, so it ships the
# tsc-emitted closure; a dev clone ships the `.ts` source. omp itself reads both (its
# discovery prefers index.ts and falls back to index.js, `discovery/helpers.ts:700-710`).
case "$REPO" in
  */node_modules/@junghanacs/entwurf)
    ENTRY_NAME="index.js"
    ENTRY_SRC="$REPO/mcp/entwurf-bridge/dist/pi-extensions/meta-bridge-receive-omp.js"
    LIB_SRC="$REPO/mcp/entwurf-bridge/dist/pi-extensions/lib/meta-session.js"
    LIB_EXT="js" ;;
  *)
    ENTRY_NAME="index.ts"
    ENTRY_SRC="$REPO/pi-extensions/meta-bridge-receive-omp.ts"
    LIB_SRC="$REPO/pi-extensions/lib/meta-session.ts"
    LIB_EXT="ts" ;;
esac

[ -f "$ENTRY_SRC" ] || die "receive entry artifact missing: $ENTRY_SRC (run 'pnpm run build-bridge' in a dev clone, or reinstall the package)."
[ -f "$LIB_SRC" ]   || die "entry lib artifact missing: $LIB_SRC (same build-bridge dist closure)."

write_state() { # $1 = ownedUnitDir (true|false)
  mkdir -p "$STATE_DIR"
  STATE_FILE_ENV="$STATE_FILE" UNIT_DIR_ENV="$UNIT_DIR" ASM_ENV="$ASM" \
  UNIT_VERSION_ENV="$UNIT_VERSION" ENTRY_NAME_ENV="$ENTRY_NAME" OWNED_ENV="$1" python3 - <<'PY' \
    || die "could not write the ownership state at $STATE_FILE"
import datetime, json, os, tempfile
state_file = os.environ["STATE_FILE_ENV"]
state = {
    "schemaVersion": 1,
    "unitDir": os.path.abspath(os.environ["UNIT_DIR_ENV"]),
    "assemblyPath": os.path.abspath(os.environ["ASM_ENV"]),
    "unitVersion": os.environ["UNIT_VERSION_ENV"],
    "entryName": os.environ["ENTRY_NAME_ENV"],
    "ownedUnitDir": os.environ["OWNED_ENV"] == "true",
    "installedAt": datetime.datetime.now(datetime.timezone.utc).isoformat(),
}
fd, tmp = tempfile.mkstemp(dir=os.path.dirname(state_file), prefix=".install-state.")
with os.fdopen(fd, "w") as fh:
    json.dump(state, fh, indent=2)
    fh.write("\n")
os.replace(tmp, state_file)
PY
}

# ── 0. ownership preflight (READ-ONLY) ───────────────────────────────────────
# Every destructive step below is licensed HERE, and the only licence is ownership STATE.
# Anything that already exists at our path and cannot be proven ours refuses with zero
# writes — a structural shape is not a proof of ownership (#87 B2). A SYMLINK at the unit
# path is always a refusal too: writing through it would mutate somebody else's tree.
if [ "$ASSEMBLE_ONLY" -eq 0 ]; then
  if [ -L "$STATE_FILE" ]; then
    die "ownership state $STATE_FILE is a symlink — refusing to trust or overwrite it."
  fi
  if [ -L "$UNIT_DIR" ]; then
    die "$UNIT_DIR is a SYMLINK. entwurf never writes through a link into a tree it does not own — remove it by hand if it is stale, then re-run."
  fi
  if [ -f "$STATE_FILE" ]; then
    omp_state_read "$STATE_FILE" "$UNIT_DIR" "$ASM" >/dev/null \
      || die "ownership state $STATE_FILE is corrupt or names a different installation (see above) — refusing with zero writes."
    echo "[omp-receive-install] ownership state matches this installation (reinstall/repair)"
  elif [ -e "$UNIT_DIR" ]; then
    # NO SHAPE-BASED ADOPTION (#87 B2). A structural oracle answers "is this a complete
    # unit", never "is this OURS": it compares no bytes, rejects no extra files and
    # establishes no provenance. Adopting on that answer meant moving a stranger's
    # directory aside, publishing over it and DELETING the preimage — and the inverse
    # then `rm -rf`s the path on the same unproven claim. A foreign or hand-made
    # extension with these filenames, or our own unit plus operator files beside it, was
    # destroyed unrecoverably. Ownership state is the only proof of ownership, so a
    # no-state path refuses with zero writes.
    die "$UNIT_DIR already exists and entwurf holds NO ownership state for it. A directory that merely LOOKS like our unit is not proof that it is ours — adopting it would overwrite it and delete the preimage with no inverse. Refusing with zero writes: inspect it, and if it is stale remove it by hand, then re-run."
  fi
fi

# ── 1. assemble a self-contained unit ────────────────────────────────────────
# ATOMIC: assemble beside the live artifact and swap only once it is complete, so a
# failure never leaves a half-written extension for omp to import on the next launch.
STAGE="$ASM.staging.$$"
rm -rf "$STAGE"
trap 'rm -rf "$STAGE"' EXIT
mkdir -p "$STAGE/$UNIT/lib"
cp "$SRC/$UNIT/package.json" "$STAGE/$UNIT/package.json"
cp "$ENTRY_SRC" "$STAGE/$UNIT/$ENTRY_NAME"
cp "$LIB_SRC" "$STAGE/$UNIT/lib/meta-session.$LIB_EXT"
cp "$REPO/pi-extensions/lib/session-id.js" "$STAGE/$UNIT/lib/session-id.js"
# The capability registry must travel at the unit ROOT: metaCapabilitiesFilePath()
# resolves it via `../` from lib/ in the bundle layout. Without it every mint throws.
cp "$REPO/pi/entwurf-capabilities.json" "$STAGE/$UNIT/entwurf-capabilities.json"

omp_assembly_valid "$STAGE" "$UNIT" || die "the freshly staged assembly fails the structural oracle (see above) — refusing to publish it."

PREV=""
if [ -d "$ASM" ]; then
  PREV="$ASM.previous.$$"
  mv "$ASM" "$PREV" || die "could not move the previous assembly aside ($ASM)."
fi
mkdir -p "$(dirname "$ASM")"
if ! mv "$STAGE" "$ASM"; then
  [ -n "$PREV" ] && mv "$PREV" "$ASM"
  die "could not publish the staged assembly into $ASM (previous assembly restored)."
fi
trap - EXIT
[ -n "$PREV" ] && rm -rf "$PREV"

echo "[omp-receive-install] assembled $ASM (receiver extension only; birth is install-omp-bridge, the MCP hand is install-omp-mcp)"

if [ "$ASSEMBLE_ONLY" -eq 1 ]; then
  echo "[omp-receive-install] --assemble-only: stopping before the omp agent directory is touched"
  exit 0
fi

# ── 2. place it where omp discovers it ───────────────────────────────────────
# Ownership state BEFORE the vendor-directory mutation: once the complete assembly is
# published, the state exists so a partial failure below still leaves an inverse
# authority behind. `ownedUnitDir` flips false→true around the placement.
write_state false
echo "[omp-receive-install] ownership state written: $STATE_FILE"

mkdir -p "$(dirname "$UNIT_DIR")"
PLACE_STAGE="$UNIT_DIR.staging.$$"
rm -rf "$PLACE_STAGE"
cp -r "$ASM/$UNIT" "$PLACE_STAGE" || die "could not stage the unit into $(dirname "$UNIT_DIR")."
PREV_UNIT=""
if [ -d "$UNIT_DIR" ]; then
  PREV_UNIT="$UNIT_DIR.previous.$$"
  mv "$UNIT_DIR" "$PREV_UNIT" || { rm -rf "$PLACE_STAGE"; die "could not move the previous unit aside ($UNIT_DIR)."; }
fi
if ! mv "$PLACE_STAGE" "$UNIT_DIR"; then
  [ -n "$PREV_UNIT" ] && mv "$PREV_UNIT" "$UNIT_DIR"
  rm -rf "$PLACE_STAGE"
  die "could not publish the unit into $UNIT_DIR (previous unit restored)."
fi
[ -n "$PREV_UNIT" ] && rm -rf "$PREV_UNIT"
write_state true

omp_assembly_valid "$(dirname "$UNIT_DIR")" "$UNIT" || die "the placed unit fails the structural oracle (see above)."

echo "[omp-receive-install] installed $UNIT_DIR (entry $ENTRY_NAME, version $UNIT_VERSION)"
echo "[omp-receive-install] DONE. An omp TUI session becomes ADDRESSABLE once this unit"
echo "arms: it joins the citizen birth minted in the same process, holds a watch on that"
echo "citizen's mailbox signal, and rings a doorbell the model drains with"
echo "entwurf_inbox_read. Until it arms, dispatch to that garden id is still the honest"
echo "mailbox-undeliverable refusal, which is what an unarmed receiver SHOULD look like."
echo "Requires the birth unit (install-omp-bridge) and the tool hand (install-omp-mcp):"
echo "without the hand the model has no entwurf_inbox_read to drain with."
echo "Verify with: ./run.sh doctor-omp-receive · inverse: ./run.sh uninstall-omp-receive"
