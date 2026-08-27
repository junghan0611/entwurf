#!/usr/bin/env bash
# copilot-bridge-doctor.sh — the FAIL-LOUD surface for the Copilot birth plugin (#82).
#
# WHY IT IS NOT `doctor-meta-bridge --copilot`. The Claude doctor's red conditions
# certify Claude's receiver marker and FileChanged/asyncRewake hook rail. Copilot has a
# receiver too since #82 RAIL 5, but it is a different mechanism owned by a different
# process (a forked extension) and certified by its own doctor,
# `doctor-copilot-receive`. This BIRTH doctor certifies birth and who-sent. A shared
# doctor would make one rail pass on evidence owned by another, which is a branch, not a
# shared surface.
#
# (Until #82 RAIL 5b it had none of the four, and this comment said so. The sender
# marker joined because who-sent needs a shared parent, not a doorbell — the two facts
# had been merged under one absence.)
#
# WHAT A PASS FROM THIS DOCTOR MEANS, AND WHAT IT DOES NOT. Copilot exposes no plugin
# load or hook-execution receipt, so this doctor can prove the artifact is correct and
# REGISTERED, never that Copilot loaded it. A PASS with zero records is therefore
# consistent with two different worlds — a session not yet spoken to, and a unit Copilot
# silently never invokes. Only a real first prompt separates them, and that receipt (a
# record in the store) is what closes admission — not this doctor (cross-review, terra).
#
# THE ONE HONEST DIFFERENCE FROM THE CLAUDE DOCTOR. There, a plugin installed with
# zero meta-records is a SILENT MISS and exits non-zero, because a Claude session
# mints at session open — so zero records means something ate the hook. A Copilot
# session is born on its FIRST PROMPT (measured: opening the TUI fires no hook at
# all), so "installed, zero records" is the ordinary state of a Copilot that has been
# opened and not yet spoken to. Calling that red would train the operator to ignore
# the doctor. It is reported as NOT-YET, by name, and the red condition is a hook that
# RAN and FAILED — an ERROR line this unit wrote to the shared hook log.
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/.." && pwd)"
MKT_NAME="meta-bridge-copilot-local"
PLUGIN="entwurf-meta-receive-copilot"
# QUALIFIED ids throughout: `copilot plugin list` prints `plugin@marketplace` (measured
# 2026-08-21), and a bare name would both accept a same-named plugin from somebody
# else's marketplace as ours and flag theirs as our stale unit (cross-review, terra).
QUALIFIED="$PLUGIN@$MKT_NAME"
STALE_CLAUDE_UNIT="entwurf-meta-receive@meta-bridge-local"
ASM="${XDG_DATA_HOME:-$HOME/.local/share}/entwurf/meta-bridge-copilot/.assembled"
STATE_FILE="${XDG_DATA_HOME:-$HOME/.local/share}/entwurf/copilot-bridge/install-state.json"
AGENT_DIR="${PI_CODING_AGENT_DIR:-$HOME/.pi/agent}"
SESSIONS_DIR="$AGENT_DIR/meta-sessions"
HOOK_LOG="$AGENT_DIR/meta-bridge-hook.log"

# RUNTIME truth and OWNERSHIP truth are separate axes (#86 C3a, same discipline as
# doctor-pi-package): a visibly working registration does not prove entwurf owns it,
# and a broken ownership record does not erase working runtime configuration. Either
# required axis red makes the final verdict red.
fail=0
own_fail=0
ok()    { echo "  ok    $*"; }
bad()   { echo "  FAIL  $*"; fail=1; }
badown(){ echo "  FAIL  $*"; own_fail=1; }
note()  { echo "  note  $*"; }

# Shared with the installer and the inverse: one structural oracle, one state
# validator, one exact list-row grammar — three surfaces, zero drifting copies.
# shellcheck source=copilot-bridge-oracle.sh
. "$HERE/copilot-bridge-oracle.sh"

echo "[copilot-bridge-doctor] toolchain"
command -v copilot >/dev/null 2>&1 && ok "copilot CLI on PATH" || bad "copilot CLI missing from PATH"
command -v node >/dev/null 2>&1 && ok "node on PATH" || bad "node missing from PATH"

echo "[copilot-bridge-doctor] assembled artifact"
# The SAME structural oracle the installer's adoption preflight and the inverse use
# (C3a amendment, B defect 1): launcher presence/bake, live baked node and hook
# entry, capability registry at the plugin root, and the native baked hooks.json form
# are all ONE parser in copilot-bridge-oracle.sh — the doctor keeps no second copy
# that could drift from what install/adopt actually accepts. The oracle prints its
# first failing reason, which is surfaced verbatim.
if ORACLE_REASON="$(copilot_assembly_valid "$ASM" "$PLUGIN" 2>&1)"; then
  ok "assembly at $ASM passes the shared structural oracle (baked launcher, live node + hook entry, capability registry, native hooks.json)"
else
  bad "assembly fails the shared structural oracle: ${ORACLE_REASON:-no reason printed} — run ./run.sh install-copilot-bridge"
fi

echo "[copilot-bridge-doctor] copilot wiring"
# A failing list is UNKNOWN, never an absence (#86 C3a): reporting "not installed" off
# a broken/unauthenticated CLI would send the operator to reinstall over a host whose
# real contents nobody read.
QUALIFIED_REGISTERED=0
LISTED_VERSION=""
if ! PLUGIN_LIST="$(copilot plugin list 2>/dev/null)"; then
  bad "'copilot plugin list' failed — this host's installed plugins are UNKNOWN (not empty); fix the Copilot CLI error and re-run"
  PLUGIN_LIST=""
else
  # EXACT row read with its version captured: a substring read would accept a longer id
  # that merely contains ours, and a malformed/ambiguous listing is something nobody
  # may act on. WHAT A MATCH DOES NOT PROVE: Copilot exposes no load/execution receipt,
  # so a listing says the plugin is REGISTERED, never that Copilot loaded this unit or
  # will invoke its hook. Only a real first prompt settles that — see birth evidence.
  if LISTED_ROW="$(copilot_exact_row_version "$PLUGIN_LIST" "$QUALIFIED" 2>&1)"; then
    if [ "$LISTED_ROW" = "absent" ]; then
      bad "$QUALIFIED is NOT installed in Copilot — run ./run.sh install-copilot-bridge"
    else
      QUALIFIED_REGISTERED=1
      LISTED_VERSION="${LISTED_ROW#one }"
      ok "$QUALIFIED (v$LISTED_VERSION) is registered in Copilot (registration, not proof it is loaded)"
    fi
  else
    bad "the plugin listing for $QUALIFIED is malformed or ambiguous: $LISTED_ROW"
  fi
  case "$PLUGIN_LIST" in
    *"$STALE_CLAUDE_UNIT"*)
      bad "the Claude unit '$STALE_CLAUDE_UNIT' is still installed in Copilot — it fires on every prompt and exits 1 before node starts (Copilot's schema has no args key). Re-run the installer without --keep-stale-claude-unit." ;;
    *) ok "the Claude unit is not installed in Copilot" ;;
  esac
fi

echo "[copilot-bridge-doctor] ownership (package-owned state; separate axis from runtime)"
if ! MKT_LIST="$(copilot plugin marketplace list 2>/dev/null)"; then
  badown "'copilot plugin marketplace list' failed — this host's marketplaces are UNKNOWN (not empty); fix the Copilot CLI error and re-run"
  MKT_LIST=""
else
  # The SAME marketplace-row grammar install/inverse refuse on (C3a amendment, B
  # defects 1+2): a malformed, non-Local, or DUPLICATE same-named listing is a red
  # ownership fact here, never "the first row".
  if MKT_ROW="$(copilot_marketplace_local_path "$MKT_LIST" "$MKT_NAME" 2>&1)"; then
    if [ "$MKT_ROW" = "absent" ]; then
      note "marketplace $MKT_NAME is not registered (consistent with an uninstalled or partially installed host)"
    else
      MKT_PATH="${MKT_ROW#one }"
      if [ "$MKT_PATH" = "$ASM" ]; then
        ok "marketplace $MKT_NAME is registered at this package's assembly path"
      else
        badown "marketplace '$MKT_NAME' is registered at '$MKT_PATH', not at $ASM — ownership drift; that registration is not provably ours"
      fi
    fi
  else
    badown "the marketplace listing for '$MKT_NAME' is malformed, non-Local, or duplicated: $MKT_ROW"
  fi
fi
if [ -L "$STATE_FILE" ]; then
  badown "ownership state $STATE_FILE is a symlink — not a trustworthy record"
elif [ -f "$STATE_FILE" ]; then
  # The SAME fail-closed validator the installer and the inverse use (exact keyset,
  # exact types, constants + effective-ASM binding, no flag coercion).
  if STATE_VERDICT="$(copilot_state_read "$STATE_FILE" "$QUALIFIED" "$MKT_NAME" "$ASM" 2>&1)"; then
    ok "ownership state present and bound to this installation (ownedMarketplace/ownedAssembly/pluginVersion: $STATE_VERDICT)"
    # version drift (final amendment): the vendor lists an exact row at a version the
    # ownership record did not install — the inverse would refuse, so the doctor names
    # it now instead of letting the operator discover it there.
    STATE_PLUGIN_VERSION="$(printf '%s' "$STATE_VERDICT" | cut -d' ' -f3)"
    if [ -n "$LISTED_VERSION" ] && [ "$LISTED_VERSION" != "$STATE_PLUGIN_VERSION" ]; then
      badown "version drift — $QUALIFIED is listed at v$LISTED_VERSION but the ownership state recorded v$STATE_PLUGIN_VERSION; repair: './run.sh install-copilot-bridge' re-binds ownership"
    fi
  else
    badown "ownership state is corrupt or names a different installation: $STATE_VERDICT — inspect $STATE_FILE"
  fi
elif [ "$QUALIFIED_REGISTERED" -eq 1 ]; then
  badown "LEGACY no-state installation: $QUALIFIED is registered but no ownership state exists — repair: './run.sh install-copilot-bridge' (same-host adoption binds the state)"
else
  note "no ownership state (nothing this package records as installed here)"
fi

echo "[copilot-bridge-doctor] birth evidence"
COPILOT_RECORDS=0
if [ -d "$SESSIONS_DIR" ]; then
  COPILOT_RECORDS="$(grep -l '"backend": "copilot"' "$SESSIONS_DIR"/*.meta.json 2>/dev/null | wc -l | tr -d ' ')"
fi
if [ "$COPILOT_RECORDS" -gt 0 ]; then
  ok "$COPILOT_RECORDS copilot meta-record(s) in $SESSIONS_DIR — the citizen exists"
else
  # NOT a failure. See the header: a Copilot session mints on its first prompt, so an
  # opened-but-unspoken session legitimately has no record yet.
  note "no copilot meta-record yet. A Copilot session is born on its FIRST PROMPT, not when"
  note "the window opens — open Copilot, send one prompt, then re-run this doctor."
  note "NOT-YET is only meaningful BEFORE that first prompt. If a Copilot session has"
  note "already been prompted on this host and this still says zero, the unit is not"
  note "being invoked and that IS the failure — Copilot gives no load receipt to tell"
  note "the two apart from here."
fi

if [ -f "$HOOK_LOG" ]; then
  # RECOVERY RULE. The hook log is append-only, so a repaired install would otherwise
  # stay red forever on errors it has already outgrown (cross-review, terra). What is
  # red is an ERROR with NO successful mint after it: a failure the unit never recovered
  # from. An ERROR followed by a create/attach is history, and is reported as such.
  #
  # grep -c prints 0 AND exits 1 with no match, so a `|| echo 0` fallback would append a
  # SECOND line and every numeric test below would die on "0\n0". Keep it to one line.
  #
  # MINT ERRORS ONLY. Since #82 RAIL 5b this unit also writes a SENDER marker, and a
  # failed marker write is an ERROR that lands AFTER the successful mint line — so the
  # order rule above would read it as "no successful mint after the error" and print a
  # sentence that is simply false (the record IS there). The two failures are separated
  # here rather than downgraded in the payload, because a marker write that keeps
  # breaking must stay loud somewhere; it just is not a birth failure.
  MINT_ERRORS=' ERROR \[copilot\] (?!sender-marker-)'
  LAST_ERROR_LINE="$(grep -nP "$MINT_ERRORS" "$HOOK_LOG" 2>/dev/null | tail -1 | cut -d: -f1)"
  LAST_OK_LINE="$(grep -n ' INFO \[copilot\] \(create\|attach\) ' "$HOOK_LOG" 2>/dev/null | tail -1 | cut -d: -f1)"
  TOTAL_ERRORS="$(grep -cP "$MINT_ERRORS" "$HOOK_LOG" 2>/dev/null | head -1)"
  TOTAL_ERRORS="${TOTAL_ERRORS:-0}"
  if [ -z "$LAST_ERROR_LINE" ]; then
    ok "no copilot ERROR lines in $HOOK_LOG"
  elif [ -n "$LAST_OK_LINE" ] && [ "$LAST_OK_LINE" -gt "$LAST_ERROR_LINE" ]; then
    note "$TOTAL_ERRORS historical copilot ERROR line(s) in $HOOK_LOG, all followed by a successful mint (line $LAST_OK_LINE > $LAST_ERROR_LINE) — recovered, not red"
  else
    bad "the newest copilot line in $HOOK_LOG is an unrecovered ERROR — the hook RAN and did not mint:"
    grep -P "$MINT_ERRORS" "$HOOK_LOG" | tail -3 | sed 's/^/        /'
  fi

  # WHO-SENT, judged on its own axis. Both outcomes leave a citizen that EXISTS and can
  # be addressed by others; what is missing is only its ability to send under its own
  # garden id. So a REFUSAL is a note (fail-closed by design — a session opened before
  # the current install reaches the payload without launch provenance and correctly
  # claims no owner), while a failed WRITE is red (we tried and the store would not take
  # it, and nothing downstream will say why).
  MARKER_FAILED="$(grep -c ' ERROR \[copilot\] sender-marker-failed ' "$HOOK_LOG" 2>/dev/null | head -1)"
  MARKER_REFUSED="$(grep -c ' WARN \[copilot\] sender-marker-refused ' "$HOOK_LOG" 2>/dev/null | head -1)"
  MARKER_OK="$(grep -c ' INFO \[copilot\] sender marker ' "$HOOK_LOG" 2>/dev/null | head -1)"
  if [ "${MARKER_FAILED:-0}" -gt 0 ]; then
    bad "${MARKER_FAILED} sender-marker WRITE failure(s) in $HOOK_LOG — those citizens exist but cannot send under their own garden id:"
    grep ' ERROR \[copilot\] sender-marker-failed ' "$HOOK_LOG" | tail -3 | sed 's/^/        /'
  elif [ "${MARKER_REFUSED:-0}" -gt 0 ]; then
    note "${MARKER_REFUSED} sender-marker refusal(s) and ${MARKER_OK:-0} armed — a refusal is fail-closed, not a fault. A session that predates this install reaches the hook without launch provenance; RESTART it to arm who-sent"
  elif [ "${MARKER_OK:-0}" -gt 0 ]; then
    ok "${MARKER_OK} sender marker(s) armed — these citizens send under their own garden id"
  else
    note "no sender-marker lines yet in $HOOK_LOG (nothing has fired since who-sent landed)"
  fi
else
  note "no hook log yet at $HOOK_LOG (nothing has fired on this host)"
fi

echo
# The two axes are reported separately and either red is a red verdict (#86 C3a):
# runtime coverage does not prove ownership, and broken ownership does not erase
# visibly working runtime configuration.
if [ "$fail" -ne 0 ] || [ "$own_fail" -ne 0 ]; then
  [ "$fail" -ne 0 ] && echo "[copilot-bridge-doctor] runtime axis: FAIL" || echo "[copilot-bridge-doctor] runtime axis: PASS"
  [ "$own_fail" -ne 0 ] && echo "[copilot-bridge-doctor] ownership axis: FAIL" || echo "[copilot-bridge-doctor] ownership axis: PASS"
  echo "[copilot-bridge-doctor] FAIL"
  exit 1
fi
echo "[copilot-bridge-doctor] runtime axis: PASS"
echo "[copilot-bridge-doctor] ownership axis: PASS"
echo "[copilot-bridge-doctor] PASS"
