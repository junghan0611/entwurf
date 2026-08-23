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
#   2. The Claude doctor certifies Claude's own receiver marker and
#      FileChanged/asyncRewake doorbell. Copilot does not use that mechanism: its
#      first-party extension transport is a separate, still-unadmitted lifecycle.
#      Sharing a doctor would make one rail certify evidence owned by another.
#
# WHAT THIS INSTALLS. One plugin whose current managed job is to mint a meta-record
# on the first prompt of a Copilot session. MCP wiring has its own installer. The
# 2026-08-23 extension idle-wake receipt does not make this birth installer own a
# receiver marker, feature flag, or dispatch route; those remain admission work.
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
#
# QUALIFIED, never bare. `copilot plugin uninstall` accepts `plugin-name` or
# `plugin-name@marketplace-name` (measured 2026-08-21 from `plugin uninstall --help`),
# and `copilot plugin list` prints the qualified id. A bare name would also match a
# same-named plugin from somebody else's marketplace — this installer may only remove
# the unit THIS repo installed (cross-review, terra).
STALE_CLAUDE_UNIT="entwurf-meta-receive@meta-bridge-local"
QUALIFIED="$PLUGIN@$MKT_NAME"
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

# PREFLIGHT, and all of it BEFORE the first destructive step. The assembly is removed
# and rebuilt in place further down; discovering a missing python3 or an under-floor
# node AFTER that would leave the operator with no assembly at all (cross-review, terra).
command -v python3 >/dev/null 2>&1 || die "python3 is required (both bakes run through it) and is not on PATH."
NODE_BIN="$(command -v node)" || die "node is not on PATH."
[ -x "$NODE_BIN" ] || die "resolved node is not executable: $NODE_BIN"
NODE_MAJOR="$("$NODE_BIN" -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
# The dev-clone shape bakes the raw `.ts` entry and relies on strip-types, so an
# under-floor node does not fail at install — it fails at the operator's first prompt,
# inside Copilot, where nothing surfaces it. Refuse here instead.
[ "$NODE_MAJOR" -ge 24 ] 2>/dev/null || die "node >= 24 is required (package engines); resolved $NODE_BIN reports major '$NODE_MAJOR'."

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

# ATOMIC: assemble beside the live artifact and swap only once it is complete. The
# previous shape removed the live assembly first, so any failure between there and the
# marketplace re-registration left the INSTALLED plugin pointing at a launcher that no
# longer existed — a working hook broken by a failed upgrade (cross-review, terra).
STAGE="$ASM.staging.$$"
rm -rf "$STAGE"
trap 'rm -rf "$STAGE"' EXIT
mkdir -p "$STAGE"
cp -r "$SRC/.claude-plugin" "$STAGE/.claude-plugin"
cp -r "$SRC/$PLUGIN" "$STAGE/$PLUGIN"
cp "$HOOK_SRC" "$STAGE/$PLUGIN/$HOOK_ENTRY"
mkdir -p "$STAGE/$PLUGIN/lib"
cp "$LIB_SRC" "$STAGE/$PLUGIN/lib/meta-session.$LIB_EXT"
cp "$REPO/pi-extensions/lib/session-id.js" "$STAGE/$PLUGIN/lib/session-id.js"
# The capability registry must travel at the plugin ROOT: metaCapabilitiesFilePath()
# resolves it via `../` from lib/ in the bundle layout. Without it every mint throws.
cp "$REPO/pi/entwurf-capabilities.json" "$STAGE/$PLUGIN/entwurf-capabilities.json"

LAUNCHER="$STAGE/$PLUGIN/scripts/copilot-hook-launch.sh"
# What gets BAKED into hooks.json is the FINAL path, not the staging one: the manifest
# has to name where the launcher will live after the swap.
FINAL_LAUNCHER="$ASM/$PLUGIN/scripts/copilot-hook-launch.sh"
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
HOOKS="$STAGE/$PLUGIN/hooks/hooks.json"
HOOKS_PATH="$HOOKS" LAUNCHER_TO_BAKE="$FINAL_LAUNCHER" python3 - <<'PY'
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

# SWAP. Move the old assembly aside rather than deleting it, so a failed rename can be
# undone; only then drop it.
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

echo "[copilot-bridge-install] assembled $ASM (birth plugin only; MCP and receive are separate surfaces)"

if [ "$ASSEMBLE_ONLY" -eq 1 ]; then
  echo "[copilot-bridge-install] --assemble-only: stopping before the Copilot CLI is touched"
  exit 0
fi

# --- 2. retire the stale Claude unit from Copilot ---------------------------
# It is ours, it fires on every Copilot prompt, and it exits 1 before node starts.
# Leaving it installed means the operator keeps paying for a hook that cannot work.
if [ "$KEEP_STALE" -eq 0 ]; then
  # ASK FIRST, then act. Treating every nonzero uninstall as "not present" would report
  # a CLI, config or permission failure as an absence and then install on top of a unit
  # that is still firing (cross-review, terra). `copilot plugin list` prints the
  # QUALIFIED id, which is also what distinguishes our unit from a same-named plugin
  # somebody else installed from another marketplace.
  # The LIST failing is not an empty list. `|| true` would hand the "nothing installed"
  # arm a broken, unauthenticated or permission-denied Copilot CLI and then install on
  # top of whatever is really there (cross-review, terra). The assignment IS the
  # condition so `set -e` cannot kill us before we can say why.
  if ! INSTALLED_LIST="$(copilot plugin list 2>/dev/null)"; then
    die "'copilot plugin list' failed, so this host's installed plugins are UNKNOWN. An unknown list is not an empty one — the stale Claude unit may still be firing. Fix the Copilot CLI error, or re-run with --keep-stale-claude-unit to skip this check deliberately."
  fi
  case "$INSTALLED_LIST" in
    *"$STALE_CLAUDE_UNIT"*)
      copilot plugin uninstall "$STALE_CLAUDE_UNIT" >/dev/null \
        || die "the stale Claude unit '$STALE_CLAUDE_UNIT' is installed in Copilot but could not be removed. It fires on every prompt and exits 1 before node starts, so installing on top of it would leave that noise in place. Fix the Copilot CLI error above, or re-run with --keep-stale-claude-unit to proceed deliberately."
      echo "[copilot-bridge-install] removed the stale Claude unit '$STALE_CLAUDE_UNIT' from Copilot (it exits 1 on every prompt there)"
      ;;
    *)
      echo "[copilot-bridge-install] stale Claude unit '$STALE_CLAUDE_UNIT' is not installed in Copilot (nothing to remove)"
      ;;
  esac
fi

# --- 3. (re)register the marketplace and install ----------------------------
copilot plugin uninstall "$QUALIFIED" >/dev/null 2>&1 || true
copilot plugin marketplace remove "$MKT_NAME" >/dev/null 2>&1 || true
copilot plugin marketplace add "$ASM" >/dev/null || die "'copilot plugin marketplace add $ASM' failed."
copilot plugin install "$QUALIFIED" >/dev/null || die "'copilot plugin install $QUALIFIED' failed."

# --- 4. evidence ------------------------------------------------------------
echo "--- copilot plugin list ---"
# The qualified id, not the bare name: a bare grep would be satisfied by a same-named
# plugin from another marketplace and report an install that never happened.
copilot plugin list 2>/dev/null | grep -F "$QUALIFIED" || die "post-install: $QUALIFIED is not in 'copilot plugin list' (install did not take)."
echo
echo "[copilot-bridge-install] DONE. A Copilot session becomes a citizen on its FIRST PROMPT,"
echo "not when the window opens — sessionStart is deferred to the first prompt (measured)."
echo "Verify with: ./run.sh doctor-copilot-bridge"
