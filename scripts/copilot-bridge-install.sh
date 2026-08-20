#!/usr/bin/env bash
# copilot-bridge-install.sh — operator-grade global installer for the Copilot BIRTH
# plugin (#82). The Copilot sibling of meta-bridge-install.sh, deliberately NOT a
# mode of it.
#
# WHY A SEPARATE INSTALLER (§4-5, and one measured blocker)
#
#   1. The Claude installer assembles ONE marketplace root and copies exactly one
#      plugin out of it (`cp -r "$SRC/$PLUGIN"`). Adding the Copilot unit to that
#      same marketplace.json would publish a manifest whose second `source` is not
#      in the assembly, and `claude plugin validate` runs over that root before any
#      user config is touched. Two marketplace roots, two assemblies (cross-review,
#      terra, 2026-08-20).
#   2. The Claude doctor requires sender/receiver markers, a doorbell and live
#      delivery. A Copilot citizen must have NONE of those — its bundle has no
#      FileChanged/asyncRewake/watchPaths. Sharing a doctor would mean teaching it to
#      ignore exactly the evidence it exists to demand.
#
# WHAT THIS INSTALLS. One plugin, whose whole job is to mint a meta-record on the
# first prompt of a Copilot session. No MCP wiring: `entwurf_inbox_read` is the
# receiver half of a delivery rail this backend does not have, and wiring a drain
# tool for a mailbox nothing rings would advertise delivery that cannot happen.
#
# Platform: Linux only, same fence as the Claude installer.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/.." && pwd)"
MKT_NAME="meta-bridge-copilot-local"
PLUGIN="entwurf-meta-receive-copilot"
SRC="$REPO/pi/meta-bridge-copilot"
# `ENTWURF_COPILOT_ASM` exists for ONE caller: check-copilot-birth-hook drives this
# script for real, into a temp dir, with --assemble-only. A gate that re-implemented
# the bake would be testing its own copy of the logic instead of the shipped one.
ASM="${ENTWURF_COPILOT_ASM:-${XDG_DATA_HOME:-$HOME/.local/share}/entwurf/meta-bridge-copilot/.assembled}"
# The Claude unit that is currently installed INTO Copilot. It fires there and then
# dies in hook-launch.sh's no-argv refusal on every prompt, because Copilot's schema
# has no `args` (measured: that refusal is why copilot held 0 of 409 meta-records).
STALE_CLAUDE_UNIT="entwurf-meta-receive"
KEEP_STALE=0
# --assemble-only stops after the assembly, before the Copilot CLI is touched. It is
# how the gate reaches the real bake on a host (and in CI) that has no Copilot.
ASSEMBLE_ONLY=0

die() { echo "[copilot-bridge-install] $*" >&2; exit 1; }

for arg in "$@"; do
  case "$arg" in
    --keep-stale-claude-unit) KEEP_STALE=1 ;;
    --assemble-only) ASSEMBLE_ONLY=1 ;;
    *) die "unknown argument: $arg (--keep-stale-claude-unit, --assemble-only)" ;;
  esac
done

[ "$(uname -s)" = "Linux" ] || die "Linux only; $(uname -s) is not a certified axis for this install."
if [ "$ASSEMBLE_ONLY" -eq 0 ]; then
  command -v copilot >/dev/null 2>&1 || die "the 'copilot' CLI is not on PATH."
fi

NODE_BIN="$(command -v node)" || die "node is not on PATH."
[ -x "$NODE_BIN" ] || die "resolved node is not executable: $NODE_BIN"

# Same install-shape split as the Claude installer: an installed package lives below
# node_modules where Node refuses strip-types on `.ts`, so it runs the tsc-emitted
# closure; a dev clone (and the XDG artifact) runs the `.ts` source.
case "$REPO" in
  */node_modules/@junghanacs/entwurf)
    HOOK_ENTRY="meta-bridge-hook-copilot.js"
    HOOK_SRC="$REPO/mcp/entwurf-bridge/dist/pi-extensions/meta-bridge-hook-copilot.js"
    LIB_SRC="$REPO/mcp/entwurf-bridge/dist/pi-extensions/lib/meta-session.js"
    LIB_EXT="js" ;;
  *)
    HOOK_ENTRY="meta-bridge-hook-copilot.ts"
    HOOK_SRC="$REPO/pi-extensions/meta-bridge-hook-copilot.ts"
    LIB_SRC="$REPO/pi-extensions/lib/meta-session.ts"
    LIB_EXT="ts" ;;
esac

# --- 1. assemble a self-contained, baked plugin -----------------------------
[ -f "$HOOK_SRC" ] || die "hook artifact missing: $HOOK_SRC (run 'pnpm run build-bridge' in a dev clone, or reinstall the package)."
[ -f "$LIB_SRC" ]  || die "hook lib artifact missing: $LIB_SRC (same build-bridge dist closure)."

rm -rf "$ASM"
mkdir -p "$ASM"
cp -r "$SRC/.claude-plugin" "$ASM/.claude-plugin"
cp -r "$SRC/$PLUGIN" "$ASM/$PLUGIN"
cp "$HOOK_SRC" "$ASM/$PLUGIN/$HOOK_ENTRY"
mkdir -p "$ASM/$PLUGIN/lib"
cp "$LIB_SRC" "$ASM/$PLUGIN/lib/meta-session.$LIB_EXT"
cp "$REPO/pi-extensions/lib/session-id.js" "$ASM/$PLUGIN/lib/session-id.js"
# The capability registry must travel at the plugin ROOT: metaCapabilitiesFilePath()
# resolves it via `../` from lib/ in the bundle layout. Without it every mint throws.
cp "$REPO/pi/entwurf-capabilities.json" "$ASM/$PLUGIN/entwurf-capabilities.json"

LAUNCHER="$ASM/$PLUGIN/scripts/copilot-hook-launch.sh"
chmod +x "$LAUNCHER"

# Bake node + entry into the LAUNCHER (not into hooks.json): Copilot's `exec` is a
# single string with no argv beside it, so the payload coordinates cannot ride the
# manifest the way Claude's `args` array carries them.
LAUNCHER_PATH="$LAUNCHER" NODE_PATH_TO_BAKE="$NODE_BIN" HOOK_ENTRY_TO_BAKE="$HOOK_ENTRY" python3 - <<'PY'
from pathlib import Path
import os
launcher = Path(os.environ["LAUNCHER_PATH"])
node = os.environ["NODE_PATH_TO_BAKE"]
hook_entry = os.environ["HOOK_ENTRY_TO_BAKE"]
text = launcher.read_text(encoding="utf-8")
for placeholder in ("__NODE_BIN__", "__HOOK_ENTRY__"):
    if placeholder not in text:
        raise SystemExit(f"launcher bake failed before replacement ({placeholder} absent in {launcher})")
launcher.write_text(text.replace("__NODE_BIN__", node).replace("__HOOK_ENTRY__", hook_entry), encoding="utf-8")
PY
for placeholder in "__NODE_BIN__" "__HOOK_ENTRY__"; do
  grep -q "$placeholder" "$LAUNCHER" && die "launcher bake failed ($placeholder still present in $LAUNCHER)."
done

# Bake the launcher's ABSOLUTE path into hooks.json. `${COPILOT_PLUGIN_ROOT}` and
# `${CLAUDE_PLUGIN_ROOT}` both appear as recognized names in the shipped runtime, but
# whether an `exec` string is substituted was never measured — and the assembly path
# is stable and outside the checkout, so baking needs no such bet.
HOOKS="$ASM/$PLUGIN/hooks/hooks.json"
HOOKS_PATH="$HOOKS" LAUNCHER_TO_BAKE="$LAUNCHER" python3 - <<'PY'
from pathlib import Path
import os
hooks = Path(os.environ["HOOKS_PATH"])
launcher = os.environ["LAUNCHER_TO_BAKE"]
text = hooks.read_text(encoding="utf-8")
if "__COPILOT_LAUNCHER__" not in text:
    raise SystemExit(f"hooks bake failed before replacement (__COPILOT_LAUNCHER__ absent in {hooks})")
hooks.write_text(text.replace("__COPILOT_LAUNCHER__", launcher), encoding="utf-8")
PY
grep -q "__COPILOT_LAUNCHER__" "$HOOKS" && die "hooks bake failed (__COPILOT_LAUNCHER__ still present in $HOOKS)."

echo "[copilot-bridge-install] assembled $ASM (node + entry baked into the launcher; no MCP wiring by design)"

if [ "$ASSEMBLE_ONLY" -eq 1 ]; then
  echo "[copilot-bridge-install] --assemble-only: stopping before the Copilot CLI is touched"
  exit 0
fi

# --- 2. retire the stale Claude unit from Copilot ---------------------------
# It is ours, it fires on every Copilot prompt, and it exits 1 before node starts.
# Leaving it installed means the operator keeps paying for a hook that cannot work.
if [ "$KEEP_STALE" -eq 0 ]; then
  if copilot plugin uninstall "$STALE_CLAUDE_UNIT" >/dev/null 2>&1; then
    echo "[copilot-bridge-install] removed the stale Claude unit '$STALE_CLAUDE_UNIT' from Copilot (it exits 1 on every prompt there)"
  else
    echo "[copilot-bridge-install] stale Claude unit '$STALE_CLAUDE_UNIT' not present in Copilot (nothing to remove)"
  fi
fi

# --- 3. (re)register the marketplace and install ----------------------------
copilot plugin uninstall "$PLUGIN" >/dev/null 2>&1 || true
copilot plugin marketplace remove "$MKT_NAME" >/dev/null 2>&1 || true
copilot plugin marketplace add "$ASM" >/dev/null || die "'copilot plugin marketplace add $ASM' failed."
copilot plugin install "$PLUGIN@$MKT_NAME" >/dev/null || die "'copilot plugin install $PLUGIN@$MKT_NAME' failed."

# --- 4. evidence ------------------------------------------------------------
echo "--- copilot plugin list ---"
copilot plugin list 2>/dev/null | grep -A3 "$PLUGIN" || die "post-install: plugin not in list (install did not take)."
echo
echo "[copilot-bridge-install] DONE. A Copilot session becomes a citizen on its FIRST PROMPT,"
echo "not when the window opens — sessionStart is deferred to the first prompt (measured)."
echo "Verify with: ./run.sh doctor-copilot-bridge"
