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

case "$(uname -s)" in
  Linux | Darwin) ;;
  *) die "unsupported platform '$(uname -s)'. meta-bridge supports Linux + macOS only (Windows is fail-fast, not silently attempted)." ;;
esac

command -v python3 >/dev/null || die "'python3' not on PATH. It is required for stateful uninstall."

# Refuse to touch Claude's plugin/MCP registrations until state exists and is
# valid. Without this preflight, "uninstall without state fails" would still
# delete live plugin/MCP entries before failing — guessing by side effect.
python3 "$REPO/scripts/meta-bridge-state.py" preflight-uninstall --repo "$REPO"

if command -v claude >/dev/null; then
  claude plugin uninstall "$PLUGIN@$MKT_NAME" >/dev/null 2>&1 || true
  claude plugin marketplace remove "$MKT_NAME" >/dev/null 2>&1 || true
  claude mcp remove entwurf-bridge -s user >/dev/null 2>&1 || true
  echo "[meta-bridge-uninstall] removed Claude plugin/marketplace/MCP registrations when present"
else
  echo "[meta-bridge-uninstall] WARN: claude CLI not on PATH; restoring JSON state only" >&2
fi

python3 "$REPO/scripts/meta-bridge-state.py" uninstall --repo "$REPO"
echo "[meta-bridge-uninstall] DONE"
