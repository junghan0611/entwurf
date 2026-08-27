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
#      FileChanged/asyncRewake doorbell. Copilot's receiver is a forked first-party
#      extension with its own installer and its own doctor. Sharing a doctor would
#      make one rail certify evidence owned by another.
#
# WHAT THIS INSTALLS. One plugin whose managed job is to mint a meta-record on the
# first prompt of a Copilot session and name that citizen as this host's sender. MCP
# wiring has its own installer, and so does the RECEIVER: the doorbell is a forked
# first-party extension, installed by `run.sh install-copilot-receive`, which also owns
# the launch-flag check. Four surfaces, four installers, four failure modes.
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
# Package-owned ownership state (#86 C3a): the birth unit gets the same discipline the
# MCP/receiver/footer units already have. The state names exactly what this installer
# owns — the qualified plugin id, the marketplace name, and the assembly root — so the
# inverse can remove precisely that and nothing else. No credential, no preimage.
STATE_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/entwurf/copilot-bridge"
STATE_FILE="$STATE_DIR/install-state.json"
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

# shellcheck source=copilot-bridge-oracle.sh
. "$HERE/copilot-bridge-oracle.sh"

if [ "$ASSEMBLE_ONLY" -eq 1 ]; then
  # --assemble-only is a GATE-ONLY path that deliberately writes no ownership state, so
  # it must never touch the LIVE assembly: without a state, a rebuilt live assembly
  # would drift from what the state/marketplace record. Require the explicit temp
  # override its callers already pass, BEFORE any assembly mutation (amendment,
  # 2026-08-27).
  DEFAULT_ASM="${XDG_DATA_HOME:-$HOME/.local/share}/entwurf/meta-bridge-copilot/.assembled"
  if [ -z "${ENTWURF_COPILOT_ASM:-}" ]; then
    die "--assemble-only requires an explicit ENTWURF_COPILOT_ASM (a temp dir): this gate-only path writes no ownership state and must not rebuild the live assembly."
  fi
  if [ "$(python3 -c 'import os,sys;print(os.path.abspath(sys.argv[1]))' "$ENTWURF_COPILOT_ASM")" = \
       "$(python3 -c 'import os,sys;print(os.path.abspath(sys.argv[1]))' "$DEFAULT_ASM")" ]; then
    die "--assemble-only refuses the DEFAULT live assembly path ($DEFAULT_ASM): pass a temp ENTWURF_COPILOT_ASM instead."
  fi
fi

# The shipped plugin version travels into the ownership state so the post-install list
# evidence and the doctor can join on it.
PLUGIN_VERSION="$(python3 -c "import json,sys;print(json.load(open(sys.argv[1]))['version'])" "$SRC/$PLUGIN/.claude-plugin/plugin.json")" \
  || die "could not read the shipped plugin version from $SRC/$PLUGIN/.claude-plugin/plugin.json"
# C3a amendment (B defect 4): the version rides space-separated state facts and exact
# list rows, so a shipped version carrying whitespace/control (or nothing at all)
# would truncate into a fabricated value downstream. Refuse it at the source.
case "$PLUGIN_VERSION" in
  ""|*[![:graph:]]*) die "shipped plugin version ${PLUGIN_VERSION:-<empty>} is empty or carries whitespace/control characters — it must be one printable token (it travels through space-separated fact transports and exact list rows)." ;;
esac

# Atomic state writer: regular file, temp+rename, exact schema. `ownedMarketplace`
# flips false→true around the marketplace add so a partial failure leaves an honest
# record of what is actually owned.
write_state() { # $1 = ownedMarketplace (true|false)
  mkdir -p "$STATE_DIR"
  STATE_FILE_ENV="$STATE_FILE" QUALIFIED_ENV="$QUALIFIED" MKT_ENV="$MKT_NAME" ASM_ENV="$ASM" \
  PLUGIN_VERSION_ENV="$PLUGIN_VERSION" OWNED_MKT_ENV="$1" python3 - <<'PY' || die "could not write the ownership state at $STATE_FILE"
import json, os, tempfile
state_file = os.environ["STATE_FILE_ENV"]
state = {
    "schemaVersion": 1,
    "qualifiedId": os.environ["QUALIFIED_ENV"],
    "marketplaceName": os.environ["MKT_ENV"],
    "assemblyPath": os.path.abspath(os.environ["ASM_ENV"]),
    "pluginVersion": os.environ["PLUGIN_VERSION_ENV"],
    "ownedMarketplace": os.environ["OWNED_MKT_ENV"] == "true",
    "ownedAssembly": True,
    "installedAt": __import__("datetime").datetime.now(__import__("datetime").timezone.utc).isoformat(),
}
fd, tmp = tempfile.mkstemp(dir=os.path.dirname(state_file), prefix=".install-state.")
with os.fdopen(fd, "w") as fh:
    json.dump(state, fh, indent=2)
    fh.write("\n")
os.replace(tmp, state_file)
PY
}

# ── 0. vendor ownership preflight (READ-ONLY; #86 C3a) ────────────────────────
# Every destructive vendor step below is licensed HERE, from `plugin list` +
# `plugin marketplace list` plus the ownership state — a failing list is UNKNOWN and
# refuses (an unknown host is not an empty one), a same-named marketplace at another
# path is someone else's and refuses, and a no-state host adopts an existing exact
# QUALIFIED only when the listed marketplace path is OUR effective assembly AND that
# assembly passes the doctor's structural oracle. Refusals here are zero-write: no
# assembly rebuild, no state, no vendor mutation.
MKT_PREREGISTERED=0
QUALIFIED_LISTED=0
INSTALLED_LIST=""
if [ "$ASSEMBLE_ONLY" -eq 0 ]; then
  if ! INSTALLED_LIST="$(copilot plugin list 2>/dev/null)"; then
    die "'copilot plugin list' failed, so this host's installed plugins are UNKNOWN — refusing before any write. Fix the Copilot CLI error and re-run."
  fi
  if ! MKT_LIST="$(copilot plugin marketplace list 2>/dev/null)"; then
    die "'copilot plugin marketplace list' failed, so this host's marketplaces are UNKNOWN — refusing before any write. Fix the Copilot CLI error and re-run."
  fi
  # EXACT row membership (amendment): a substring match would let `$QUALIFIED-extra`
  # or `prefix-$QUALIFIED` from someone else authorize the adoption/uninstall branches.
  # ANY exact version is accepted here — a reinstall over an older shipped version is
  # exactly the bounded upgrade path (the version is recorded below and the sequence
  # still runs the loud exact uninstall first) — but a malformed or ambiguous listing
  # is something nobody may act on and refuses.
  LISTED_ROW="$(copilot_exact_row_version "$INSTALLED_LIST" "$QUALIFIED")" \
    || die "the 'copilot plugin list' rows for $QUALIFIED are malformed or ambiguous (see above) — refusing before any write."
  if [ "$LISTED_ROW" != "absent" ]; then
    QUALIFIED_LISTED=1
    echo "[copilot-bridge-install] $QUALIFIED currently listed at ${LISTED_ROW#one } (shipped: v$PLUGIN_VERSION) — bounded upgrade via loud exact uninstall"
  fi
  # ONE marketplace-row grammar (C3a amendment, B defects 1+2): the shared oracle
  # parses the measured `<name> (Local: <abs path>)` form, refuses a non-Local or
  # garbled row, and refuses DUPLICATE same-named rows instead of silently taking the
  # first — a second marketplace with our name could otherwise steer every path check
  # at the wrong target. The exact registered path is what ownership joins on.
  MKT_ROW="$(copilot_marketplace_local_path "$MKT_LIST" "$MKT_NAME")" \
    || die "the 'copilot plugin marketplace list' rows for '$MKT_NAME' are malformed, non-Local, or duplicated (see above) — refusing before any write."
  if [ "$MKT_ROW" != "absent" ]; then
    MKT_PREREGISTERED=1
    MKT_PATH="${MKT_ROW#one }"
    if [ "$MKT_PATH" != "$ASM" ]; then
      die "a marketplace named '$MKT_NAME' is registered at '$MKT_PATH', not at this install's assembly ($ASM). That registration is not provably ours — zero writes. Inspect with 'copilot plugin marketplace list' and remove it manually if it is stale."
    fi
  fi

  if [ -L "$STATE_FILE" ]; then
    die "ownership state $STATE_FILE is a symlink — refusing to trust or overwrite it."
  fi
  if [ -f "$STATE_FILE" ]; then
    # The ONE fail-closed schema/constants/binding validator, shared with the inverse
    # and the doctor (copilot_state_read in the oracle) — exact keyset, exact types,
    # no flag coercion. pluginVersion equality with the shipped version is deliberately
    # NOT required here: a state written by an older shipped version is exactly the
    # upgrade-reinstall case.
    copilot_state_read "$STATE_FILE" "$QUALIFIED" "$MKT_NAME" "$ASM" >/dev/null \
      || die "ownership state $STATE_FILE is corrupt or names a different installation (see above) — refusing with zero writes. Inspect it, or remove it manually if it is stale."
    echo "[copilot-bridge-install] ownership state matches this installation (reinstall/repair)"
  else
    # No state. Adoption is EXPLICIT and narrow; anything else that already exists and
    # cannot be proven ours refuses with zero writes.
    if [ "$QUALIFIED_LISTED" -eq 1 ]; then
      if [ "$MKT_PREREGISTERED" -eq 1 ] && copilot_assembly_valid "$ASM" "$PLUGIN"; then
        echo "[copilot-bridge-install] adopting the legacy no-state installation ($QUALIFIED at $ASM; structural oracle green)"
      else
        die "'$QUALIFIED' is installed but carries no ownership state and its assembly/marketplace does not prove it ours (marketplace at ASM: $MKT_PREREGISTERED; structural oracle above). Refusing with zero writes — inspect 'copilot plugin list' / '$ASM' manually."
      fi
    elif [ "$MKT_PREREGISTERED" -eq 1 ]; then
      if copilot_assembly_valid "$ASM" "$PLUGIN"; then
        echo "[copilot-bridge-install] adopting the legacy marketplace registration ($MKT_NAME at $ASM, plugin not installed; structural oracle green)"
      else
        die "marketplace '$MKT_NAME' is registered at this install's assembly path but that assembly fails the structural oracle (see above) and no ownership state exists. Refusing with zero writes — remove the marketplace manually ('copilot plugin marketplace remove $MKT_NAME'), then re-run."
      fi
    fi
    # fresh host (both absent): proceed.
  fi
fi

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

# Ownership state BEFORE any vendor mutation (#86 C3a): once the complete assembly is
# published, the state exists so every partial vendor failure below leaves a repair and
# inverse authority behind. `ownedMarketplace` starts true only when the preflight
# matched/adopted the exact registration; otherwise it flips true after the add. The
# state is never deleted on a later failure — rerunning this installer is the repair.
if [ "$MKT_PREREGISTERED" -eq 1 ]; then write_state true; else write_state false; fi
echo "[copilot-bridge-install] ownership state written: $STATE_FILE"

# --- 2. retire the stale Claude unit from Copilot ---------------------------
# It is ours, it fires on every Copilot prompt, and it exits 1 before node starts.
# Leaving it installed means the operator keeps paying for a hook that cannot work.
# The installed-plugin list was captured (and its failure refused) by the shared
# read-only preflight above — an unknown list never reaches this branch.
# INSTALL-ONLY territory: the inverse never touches this unit.
if [ "$KEEP_STALE" -eq 0 ]; then
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
# LOUD, in a bounded order, licensed by the preflight (#86 C3a): the old blind
# `|| true` pair could swallow a real vendor failure and then report a working
# install. Each step now acts only when the preflight saw its subject, and a failure
# is an honest partial failure — state and assembly stay for the rerun-repair.
# `--force` is forbidden: `marketplace remove --force` uninstalls that marketplace's
# plugins as a side effect (measured 2026-08-27), and no entwurf writer takes that
# shortcut.
if [ "$QUALIFIED_LISTED" -eq 1 ]; then
  copilot plugin uninstall "$QUALIFIED" >/dev/null \
    || die "'copilot plugin uninstall $QUALIFIED' failed — honest partial failure; state and assembly are retained, re-run to repair."
fi
if [ "$MKT_PREREGISTERED" -eq 1 ]; then
  copilot plugin marketplace remove "$MKT_NAME" >/dev/null \
    || die "'copilot plugin marketplace remove $MKT_NAME' failed (never retried with --force) — honest partial failure; state and assembly are retained, re-run to repair."
fi
copilot plugin marketplace add "$ASM" >/dev/null || die "'copilot plugin marketplace add $ASM' failed — state and assembly are retained, re-run to repair."
write_state true
copilot plugin install "$QUALIFIED" >/dev/null || die "'copilot plugin install $QUALIFIED' failed — state and assembly are retained, re-run to repair."

# --- 4. evidence ------------------------------------------------------------
echo "--- copilot plugin list ---"
# The qualified id AND the shipped version as an EXACT row: a bare-name or substring
# grep would be satisfied by a same-named plugin from another marketplace, a stale
# version this run did not install, or a longer id that merely contains ours (list
# shape measured on copilot 1.0.80).
POST_LIST="$(copilot plugin list 2>/dev/null)" || die "post-install: 'copilot plugin list' failed — the install evidence is UNKNOWN."
POST_ROW="$(copilot_exact_row_version "$POST_LIST" "$QUALIFIED")" \
  || die "post-install: the 'copilot plugin list' rows for $QUALIFIED are malformed or ambiguous (see above)."
[ "$POST_ROW" = "one $PLUGIN_VERSION" ] \
  || die "post-install: want exactly one '$QUALIFIED (v$PLUGIN_VERSION)' row, got '$POST_ROW' (install did not take)."
echo "$QUALIFIED (v$PLUGIN_VERSION) registered"
echo
echo "[copilot-bridge-install] DONE. A Copilot session becomes a citizen on its FIRST PROMPT,"
echo "not when the window opens — sessionStart is deferred to the first prompt (measured)."
echo "Verify with: ./run.sh doctor-copilot-bridge · inverse: ./run.sh uninstall-copilot-bridge"
