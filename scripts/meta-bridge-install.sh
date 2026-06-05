#!/usr/bin/env bash
# meta-bridge-install.sh — operator-grade global installer for the garden-native
# meta-bridge plugin (1.0.0 step 5). Makes the exact Claude Code wiring the repo
# needs, so a user never hand-edits hook/plugin settings or passes --plugin-dir.
#
# Mechanism (all proven on 2026-06-05):
#   1. ASSEMBLE a self-contained plugin under pi/meta-bridge/.assembled/ (gitignored):
#      copy the committed skeleton, copy the entry shell + its lib (so
#      ${CLAUDE_PLUGIN_ROOT} self-locates them), and BAKE the node abspath into
#      hooks.json. The node path is the ONLY templated surface — the mailbox /
#      meta-record dirs resolve at runtime inside entry.ts (<pi-agent-dir>, a
#      fixed ~/ path), so nothing else is host-specific.
#   2. marketplace add <repo-stable .assembled>  (NOT /tmp — ephemeral source
#      would break `claude plugin marketplace update`).
#   3. install entwurf-meta-receive@meta-bridge-local --scope user  (= global:
#      every native session auto-loads it; no manual --plugin-dir).
# Idempotent: re-running removes the prior marketplace/plugin first, so a
# `nix rebuild` that moved node just re-bakes and re-installs cleanly.
#
# Platform: Linux + macOS only. Windows fails fast (no "untested but maybe works").
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/.." && pwd)"
MKT_NAME="meta-bridge-local"
PLUGIN="entwurf-meta-receive"
SRC="$REPO/pi/meta-bridge"
ASM="$SRC/.assembled"

die() { echo "meta-bridge-install: $*" >&2; exit 1; }

# --- platform gate (Linux/macOS only) ---------------------------------------
case "$(uname -s)" in
  Linux | Darwin) ;;
  *) die "unsupported platform '$(uname -s)'. meta-bridge supports Linux + macOS only (Windows is fail-fast, not silently attempted)." ;;
esac

# --- toolchain gate ---------------------------------------------------------
command -v claude >/dev/null || die "'claude' CLI not on PATH. Install Claude Code first."
NODE_BIN="$(command -v node)" || die "'node' not on PATH (the hook needs it to run the entry shell)."
# Need TypeScript type-stripping: native default >= 23.6, --experimental-strip-types >= 22.6.
NODE_VER="$(node -p 'process.versions.node')"
NODE_MAJOR="${NODE_VER%%.*}"
NODE_MINOR="$(printf '%s' "$NODE_VER" | cut -d. -f2)"
if [ "$NODE_MAJOR" -lt 22 ] || { [ "$NODE_MAJOR" -eq 22 ] && [ "$NODE_MINOR" -lt 6 ]; }; then
  die "node $NODE_VER too old; meta-bridge entry needs >= 22.6.0 (TypeScript strip-types)."
fi
echo "[meta-bridge-install] platform=$(uname -s) node=$NODE_VER ($NODE_BIN)"

# --- 1. assemble a self-contained, node-baked plugin ------------------------
rm -rf "$ASM"
mkdir -p "$ASM"
cp -r "$SRC/.claude-plugin" "$ASM/.claude-plugin"
cp -r "$SRC/$PLUGIN" "$ASM/$PLUGIN"
# entry shell + its lib travel WITH the plugin so the install copy is self-contained.
cp "$REPO/pi-extensions/meta-bridge-hook.ts" "$ASM/$PLUGIN/meta-bridge-hook.ts"
mkdir -p "$ASM/$PLUGIN/lib"
cp "$REPO/pi-extensions/lib/meta-session.ts" "$ASM/$PLUGIN/lib/meta-session.ts"
cp "$REPO/pi-extensions/lib/session-id.js" "$ASM/$PLUGIN/lib/session-id.js"
chmod +x "$ASM/$PLUGIN/scripts/doorbell.sh"
# bake the node abspath (the only templated surface).
HOOKS="$ASM/$PLUGIN/hooks/hooks.json"
ESC_NODE="${NODE_BIN//\\/\\\\}"; ESC_NODE="${ESC_NODE//&/\\&}"; ESC_NODE="${ESC_NODE//|/\\|}"
sed -i "s|__NODE_BIN__|$ESC_NODE|g" "$HOOKS"
grep -q "__NODE_BIN__" "$HOOKS" && die "node-path bake failed (placeholder still present in $HOOKS)."
echo "[meta-bridge-install] assembled $ASM (node baked, entry+lib bundled)"

# --- validate the manifests before touching user config ---------------------
claude plugin validate "$ASM" >/dev/null || die "marketplace manifest validation failed for $ASM"
echo "[meta-bridge-install] manifest validate: ok"

# --- 2 + 3. (re)register the marketplace and (re)install globally -----------
claude plugin uninstall "$PLUGIN@$MKT_NAME" >/dev/null 2>&1 || true
claude plugin marketplace remove "$MKT_NAME" >/dev/null 2>&1 || true
claude plugin marketplace add "$ASM" >/dev/null
claude plugin install "$PLUGIN@$MKT_NAME" --scope user >/dev/null
echo "[meta-bridge-install] installed $PLUGIN@$MKT_NAME (scope: user = global)"

# --- evidence ---------------------------------------------------------------
echo "--- claude plugin list ---"
claude plugin list 2>/dev/null | grep -A3 "$PLUGIN" || die "post-install: plugin not in list (install did not take)."
echo
echo "[meta-bridge-install] DONE. Open a Claude Code session, then verify with:"
echo "    ./run.sh doctor-meta-bridge"
