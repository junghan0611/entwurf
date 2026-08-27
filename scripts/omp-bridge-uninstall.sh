#!/usr/bin/env bash
# omp-bridge-uninstall.sh — the honest inverse of install-omp-bridge (#87).
#
# HONEST means: remove exactly what the ownership state says this repo installed, and
# nothing else. No `--force`, no "clean up anything that looks like ours", no removal of
# a unit directory we cannot prove we placed. A no-state host is NOT an empty host: it is
# a host whose ownership we cannot establish, so the answer is a named refusal.
#
# The state is deleted LAST, so an interrupted inverse leaves the authority to retry.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
UNIT="entwurf-meta-omp"
ASM="${ENTWURF_OMP_ASM:-${XDG_DATA_HOME:-$HOME/.local/share}/entwurf/meta-bridge-omp/.assembled}"
STATE_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/entwurf/omp-bridge"
STATE_FILE="$STATE_DIR/install-state.json"

die() { echo "[omp-bridge-uninstall] $*" >&2; exit 1; }

# shellcheck source=scripts/omp-bridge-oracle.sh
. "$HERE/omp-bridge-oracle.sh"

AGENT_DIR="$(omp_agent_dir)" || die "refusing: the omp agent directory this host reads is ambiguous (see above)."
UNIT_DIR="$AGENT_DIR/extensions/$UNIT"

[ -L "$STATE_FILE" ] && die "ownership state $STATE_FILE is a symlink — refusing to trust it."
if [ ! -f "$STATE_FILE" ]; then
  die "no ownership state at $STATE_FILE, so nothing here is provably ours. Refusing with zero writes — if $UNIT_DIR is a stale hand-copied unit, remove it by hand."
fi
STATE_FACTS="$(omp_state_read "$STATE_FILE" "$UNIT_DIR" "$ASM")" \
  || die "ownership state $STATE_FILE is corrupt or names a different installation (see above) — refusing with zero writes."
STATE_ENTRY="${STATE_FACTS#* }"

if [ -e "$UNIT_DIR" ]; then
  if [ -L "$UNIT_DIR" ]; then
    die "$UNIT_DIR is a SYMLINK — this installer never creates one, so it is not ours. Refusing; remove it by hand."
  fi
  if [ ! -f "$UNIT_DIR/$STATE_ENTRY" ]; then
    die "$UNIT_DIR exists but does not carry the entry this install recorded ($STATE_ENTRY) — it is not provably the unit we placed. Refusing with zero writes."
  fi
  rm -rf "$UNIT_DIR"
  echo "[omp-bridge-uninstall] removed the installed unit: $UNIT_DIR"
else
  echo "[omp-bridge-uninstall] the installed unit was already absent: $UNIT_DIR"
fi

if [ -d "$ASM" ]; then
  rm -rf "$ASM"
  echo "[omp-bridge-uninstall] removed the assembly: $ASM"
fi

rm -f "$STATE_FILE"
rmdir "$STATE_DIR" 2>/dev/null || true
echo "[omp-bridge-uninstall] ownership state removed: $STATE_FILE"
echo "[omp-bridge-uninstall] DONE. Existing omp sessions keep the record they already"
echo "minted — records are preserved, never deleted (AGENTS.md Hard Rule 8); what stops"
echo "is any FUTURE birth. The MCP hand is a separate inverse: ./run.sh uninstall-omp-mcp"
