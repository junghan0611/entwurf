#!/usr/bin/env bash
# copilot-bridge-uninstall.sh — the package-owned INVERSE of copilot-bridge-install.sh
# (#86 C3a). Removes exactly what the ownership state records this package installed —
# the qualified plugin, the local marketplace registration, the assembly — and nothing
# else. The stale Claude unit is INSTALL-ONLY territory; this inverse never touches it.
#
# ORDER AND AUTHORITY (amendment: the ownership preflight is COMPLETE before any vendor
# mutation). The state is required and validated fail-closed against this package's
# constants and the effective assembly path; both vendor lists are read next and a
# failing list is UNKNOWN (an unknown host is not an empty one — refuse); then EVERY
# ownership and safety fact — marketplace name/path/recorded ownership, assembly path
# safety, exact plugin row presence — is decided read-only. Only after all of it passes
# may the first vendor write run. So a refusal, any refusal, is zero vendor/filesystem
# writes with the state retained. Vendor steps run before filesystem steps, the state
# is deleted LAST, and any failure stops with the state retained so a rerun can finish
# the job. `--force` is forbidden: `marketplace remove --force` uninstalls that
# marketplace's plugins as a side effect (measured 2026-08-27).
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MKT_NAME="meta-bridge-copilot-local"
PLUGIN="entwurf-meta-receive-copilot"
QUALIFIED="$PLUGIN@$MKT_NAME"
ASM="${ENTWURF_COPILOT_ASM:-${XDG_DATA_HOME:-$HOME/.local/share}/entwurf/meta-bridge-copilot/.assembled}"
STATE_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/entwurf/copilot-bridge"
STATE_FILE="$STATE_DIR/install-state.json"

die() { echo "[copilot-bridge-uninstall] $*" >&2; exit 1; }

[ $# -eq 0 ] || die "unknown argument: $1 (this inverse takes no arguments; --force does not exist here)"
command -v copilot >/dev/null 2>&1 || die "the 'copilot' CLI is not on PATH."
command -v python3 >/dev/null 2>&1 || die "python3 is required and is not on PATH."

# shellcheck source=copilot-bridge-oracle.sh
. "$HERE/copilot-bridge-oracle.sh"

# --- 1. the ownership state is the sole removal authority --------------------
[ -L "$STATE_FILE" ] && die "ownership state $STATE_FILE is a symlink — refusing to trust it."
[ -f "$STATE_FILE" ] || die "no ownership state at $STATE_FILE — nothing this package provably owns to remove. A legacy no-state installation is adopted by './run.sh install-copilot-bridge' first, then removed."
STATE_FACTS="$(copilot_state_read "$STATE_FILE" "$QUALIFIED" "$MKT_NAME" "$ASM")" \
  || die "ownership state $STATE_FILE is corrupt or names a different installation (see above) — refusing with zero vendor/filesystem writes."
OWNED_MKT="$(printf '%s' "$STATE_FACTS" | cut -d' ' -f1)"
OWNED_ASM="$(printf '%s' "$STATE_FACTS" | cut -d' ' -f2)"
STATE_PLUGIN_VERSION="$(printf '%s' "$STATE_FACTS" | cut -d' ' -f3)"

# --- 2. read-only vendor facts (a failing list is UNKNOWN, never absence) ----
if ! INSTALLED_LIST="$(copilot plugin list 2>/dev/null)"; then
  die "'copilot plugin list' failed, so this host's installed plugins are UNKNOWN — refusing with zero writes. Fix the Copilot CLI error and re-run."
fi
if ! MKT_LIST="$(copilot plugin marketplace list 2>/dev/null)"; then
  die "'copilot plugin marketplace list' failed, so this host's marketplaces are UNKNOWN — refusing with zero writes. Fix the Copilot CLI error and re-run."
fi

# --- 3. COMPLETE ownership/safety preflight, read-only, before ANY mutation --
# 3a. the marketplace half: exact name must sit at the recorded path AND be recorded
#     as ours. Refusing HERE — before the plugin uninstall — is the amendment's point:
#     the same qualified id could have been installed from a same-named marketplace at
#     another path, and an inverse that had already uninstalled the plugin would have
#     removed someone else's unit before discovering that.
MKT_PRESENT=0
# ONE marketplace-row grammar (C3a amendment, B defects 1+2): the shared oracle
# refuses malformed/non-Local rows and DUPLICATE same-named rows instead of silently
# acting on the first — an inverse steered at the wrong same-named marketplace would
# remove a registration it cannot attribute.
MKT_ROW="$(copilot_marketplace_local_path "$MKT_LIST" "$MKT_NAME")" \
  || die "the 'copilot plugin marketplace list' rows for '$MKT_NAME' are malformed, non-Local, or duplicated (see above) — refusing with zero vendor/filesystem writes."
if [ "$MKT_ROW" != "absent" ]; then
  MKT_PRESENT=1
  MKT_PATH="${MKT_ROW#one }"
  if [ "$MKT_PATH" != "$ASM" ]; then
    die "a marketplace named '$MKT_NAME' is registered at '$MKT_PATH', not at the recorded assembly ($ASM). That registration is not provably ours — refusing with zero vendor/filesystem writes; inspect 'copilot plugin marketplace list' manually."
  fi
  if [ "$OWNED_MKT" != "true" ]; then
    die "marketplace '$MKT_NAME' is registered at our recorded path, but the ownership state does not record marketplace ownership. Completing this inverse would leave a registered marketplace pointing at removed backing — refusing with zero vendor/filesystem writes (plugin, marketplace, assembly and state all preserved). Resolve the marketplace registration manually, or re-run './run.sh install-copilot-bridge' to re-bind ownership."
  fi
fi
# 3b. assembly delete safety, decided BEFORE any vendor write: the recorded path must
#     be a sane rm target or nothing at all may start.
if [ "$OWNED_ASM" = "true" ]; then
  case "$ASM" in
    /) die "recorded assembly path is '/' — refusing everything." ;;
    /*) : ;;
    *) die "recorded assembly path is not absolute: $ASM — refusing everything." ;;
  esac
  [ -L "$ASM" ] && die "recorded assembly path $ASM is a symlink — refusing everything; the inverse removes only the real recorded directory."
  if [ -e "$ASM" ] && [ ! -d "$ASM" ]; then
    die "recorded assembly path $ASM exists but is not a directory — refusing everything."
  fi
fi
# 3c. the plugin half (final amendment): the exact QUALIFIED must be ABSENT (a previous
#     run got that far — retry-safe) or present EXACTLY ONCE at the state's recorded
#     version. A different version is `version-drift` — something other than the
#     recorded install put it there, and this inverse must not remove what it cannot
#     prove it installed. Malformed/multiple exact rows refuse too. Longer tokens that
#     merely contain the qualified id remain foreign, same as everywhere.
PLUGIN_PRESENT=0
LISTED_ROW="$(copilot_exact_row_version "$INSTALLED_LIST" "$QUALIFIED")" \
  || die "the 'copilot plugin list' rows for $QUALIFIED are malformed or ambiguous (see above) — refusing with zero vendor/filesystem writes."
case "$LISTED_ROW" in
  absent) : ;;
  "one $STATE_PLUGIN_VERSION") PLUGIN_PRESENT=1 ;;
  one\ *)
    die "version-drift: $QUALIFIED is listed at ${LISTED_ROW#one }, but the ownership state recorded v$STATE_PLUGIN_VERSION. This inverse removes only what it provably installed — refusing with zero vendor/filesystem writes (plugin, marketplace, assembly and state all preserved). Re-run './run.sh install-copilot-bridge' to re-bind ownership, then remove." ;;
  *) die "unexpected exact-row verdict '$LISTED_ROW' — refusing with zero writes." ;;
esac

# --- 4. vendor mutation (licensed by the complete preflight above) -----------
if [ "$PLUGIN_PRESENT" -eq 1 ]; then
  copilot plugin uninstall "$QUALIFIED" >/dev/null \
    || die "'copilot plugin uninstall $QUALIFIED' failed — stopping with the state retained; re-run to finish."
  echo "[copilot-bridge-uninstall] uninstalled $QUALIFIED"
else
  echo "[copilot-bridge-uninstall] $QUALIFIED (v$STATE_PLUGIN_VERSION) is already absent from 'copilot plugin list' (a previous run got this far) — continuing"
fi
if [ "$MKT_PRESENT" -eq 1 ]; then
  copilot plugin marketplace remove "$MKT_NAME" >/dev/null \
    || die "'copilot plugin marketplace remove $MKT_NAME' failed (never retried with --force) — stopping with the state retained; re-run to finish."
  echo "[copilot-bridge-uninstall] removed marketplace $MKT_NAME"
else
  echo "[copilot-bridge-uninstall] marketplace $MKT_NAME is already absent (a previous run got this far) — continuing"
fi

# --- 5. the assembly: only the recorded directory, only when owned -----------
if [ "$OWNED_ASM" = "true" ]; then
  if [ -d "$ASM" ]; then
    rm -rf "$ASM"
    echo "[copilot-bridge-uninstall] removed assembly $ASM"
  else
    echo "[copilot-bridge-uninstall] assembly already absent at $ASM (a previous run got this far) — continuing"
  fi
else
  echo "[copilot-bridge-uninstall] state does not record assembly ownership — preserving $ASM"
fi

# --- 6. the state, LAST ------------------------------------------------------
rm -f "$STATE_FILE"
echo "[copilot-bridge-uninstall] DONE — ownership state cleared ($STATE_FILE). The stale Claude unit, if any, was deliberately not touched (install-only territory)."
