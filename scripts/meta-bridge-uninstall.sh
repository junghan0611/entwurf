#!/usr/bin/env bash
# meta-bridge-uninstall.sh — honest inverse of install-meta-bridge.
#
# Uses ${CLAUDE_CONFIG_DIR:-~/.claude}/entwurf.install-state.json to restore
# exactly the settings/MCP keys Phase 2 install touched. Without that state file,
# uninstall cannot know whether a scalar false/true/path was user-owned, so it
# fails instead of guessing.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/.." && pwd)"
MKT_NAME="meta-bridge-local"
PLUGIN="entwurf-meta-receive"

die() { echo "meta-bridge-uninstall: $*" >&2; exit 1; }

# Darwin stays here intentionally even though NEW installs are Linux-only in the #51
# repair cut. Removing the inverse would strand an older macOS install precisely when
# support narrows; uninstall is a legacy-cleanup capability, not install certification.
case "$(uname -s)" in
  Linux | Darwin) ;;
  *) die "unsupported platform '$(uname -s)'. This repair cut certifies new Claude meta-bridge installs on Linux only; uninstall additionally permits Darwin so legacy state can be removed honestly." ;;
esac

command -v python3 >/dev/null || die "'python3' not on PATH. It is required for stateful uninstall."

# Refuse to touch Claude's plugin/MCP registrations until state exists and is
# valid. Without this preflight, "uninstall without state fails" would still
# delete live plugin/MCP entries before failing — guessing by side effect.
python3 "$REPO/scripts/meta-bridge-state.py" preflight-uninstall --repo "$REPO"

# Read + shape-validate the RECORDED assembled path BEFORE any side effect. The
# honest inverse must remove exactly what install created; recomputing from
# ${XDG_DATA_HOME} would orphan the real artifact if it changed since install. If
# the recorded path is missing/corrupt we CANNOT safely remove the artifact, so we
# fail loud HERE — before touching any Claude registration or the state file (no
# guessing, no partial uninstall, no side-effect-then-WARN).
ASM_RECORDED="$(python3 "$REPO/scripts/meta-bridge-state.py" assembled-path --repo "$REPO")"
# Validate the FULL recorded path — basename included, not just the parent dir. The
# rm below targets MB_DIR (the parent meta-bridge dir), so a parent-only check would
# let a corrupt basename (…/entwurf/meta-bridge/not-assembled) pass as "well-formed"
# and still nuke the real .assembled + Claude registrations. Only the exact install
# suffix …/entwurf/meta-bridge/.assembled is a safe honest-inverse target.
case "$ASM_RECORDED" in
  */entwurf/meta-bridge/.assembled) MB_DIR="$(dirname "$ASM_RECORDED")" ;;   # …/entwurf/meta-bridge
  *) die "install-state assembledMarketplacePath is missing/corrupt ('$ASM_RECORDED'); refusing to uninstall so the live artifact is not orphaned. Repair the state file or re-run install-meta-bridge, then uninstall." ;;
esac

if command -v claude >/dev/null; then
  claude plugin uninstall "$PLUGIN@$MKT_NAME" >/dev/null 2>&1 || true
  claude plugin marketplace remove "$MKT_NAME" >/dev/null 2>&1 || true
  claude mcp remove entwurf-bridge -s user >/dev/null 2>&1 || true
  echo "[meta-bridge-uninstall] removed Claude plugin/marketplace/MCP registrations when present"
else
  echo "[meta-bridge-uninstall] WARN: claude CLI not on PATH; restoring JSON state only" >&2
fi

python3 "$REPO/scripts/meta-bridge-state.py" uninstall --repo "$REPO"

# Remove the assembled marketplace source (validated above): the parent meta-bridge
# dir of the RECORDED .assembled, then the now-empty entwurf dir. This rm can NEVER
# reach inside the checkout, so repo housekeeping and this uninstall are structurally
# disjoint (the 0.12.x statusline-`?` impurity class is extinct, not guarded).
rm -rf "$MB_DIR"
rmdir "$(dirname "$MB_DIR")" 2>/dev/null || true   # …/entwurf if empty
echo "[meta-bridge-uninstall] DONE"
