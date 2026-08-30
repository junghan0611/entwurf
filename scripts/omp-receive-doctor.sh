#!/usr/bin/env bash
# omp-receive-doctor.sh — the fail-loud surface for the OMP RECEIVER extension
# (#87 bundle B).
#
# TWO AXES, REPORTED SEPARATELY, EITHER RED IS RED (AGENTS.md Hard Rule 13):
#   runtime   — is there a receiver unit omp will import, does it carry the CURRENT
#               writer, what did it do the last time it ran, and is a doorbell actually
#               held right now?
#   ownership — does entwurf own that unit, by a state whose shape and bindings hold?
#
# WHAT "ARMED" IS ALLOWED TO MEAN HERE, AND WHAT IT IS NOT. A receiver marker records
# that a LIVE owner reached the watch-arm emit. It is NOT proof that the vendor's file
# watch is still registered — the Claude unit says the same about its own marker in the
# same words (`meta-bridge-hook.ts:279-280`), and on this rail the owner is the operator's
# TUI process itself, so a wedged event loop looks identical to a healthy one from out
# here. This doctor therefore reports what it can prove (a marker, its owner's liveness,
# the mailbox behind it) and never upgrades that into "a wake will happen".
#
# THE MARKER READ GOES THROUGH THE PRODUCTION READER, never a filename or a grep:
# `./run.sh omp-receive-facts` projects `readMetaReceiverMarker` for both readings — the
# live one dispatch gets, and the file as written — so "nothing armed" stays
# distinguishable from "armed, then the session died".
#
# ZERO ARMED RECEIVERS IS NOT-YET, NEVER RED. A host with the unit installed and no omp
# TUI open has nothing to arm; that is the designed resting state.
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/.." && pwd)"
UNIT="entwurf-receive-omp"
SRC="$REPO/pi/omp-receive"
ASM="${ENTWURF_OMP_RECEIVE_ASM:-${XDG_DATA_HOME:-$HOME/.local/share}/entwurf/omp-receive/.assembled}"
STATE_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/entwurf/omp-receive"
STATE_FILE="$STATE_DIR/install-state.json"
BIRTH_STATE="${XDG_DATA_HOME:-$HOME/.local/share}/entwurf/omp-bridge/install-state.json"

fail=0
own_fail=0
ok()   { echo "  ok    $*"; }
note() { echo "  note  $*"; }
bad()  { echo "  FAIL  $*"; fail=1; }
own_bad() { echo "  FAIL  $*"; own_fail=1; }

# shellcheck source=scripts/omp-bridge-oracle.sh
. "$HERE/omp-bridge-oracle.sh"

echo "[omp-receive-doctor] unit: $UNIT"

# ── root-grammar preflight, BEFORE anything is read ──────────────────────────
# Same rule and same reason as the birth doctor (#87 A2): the four overrides are absolute
# or `~`-rooted only. A relative value resolves against each process's own cwd, and this
# doctor does not share one with the extension, so asking anything first would answer
# about a different directory. A refused environment is RUNTIME RED, never laundered into
# a NOT-YET about some other store.
ROOT_POLICY_REFUSAL=""
for var in ENTWURF_META_SESSIONS_DIR ENTWURF_META_MAILBOX_DIR ENTWURF_META_SENDERS_DIR ENTWURF_META_RECEIVERS_DIR; do
  val="${!var:-}"
  [ -n "$val" ] || continue
  case "$val" in
    /*|"~"|"~/"*) ;;
    *) ROOT_POLICY_REFUSAL="${ROOT_POLICY_REFUSAL:+$ROOT_POLICY_REFUSAL, }$var=$val" ;;
  esac
done

echo
echo "[omp-receive-doctor] runtime axis"

AGENT_DIR=""
UNIT_DIR=""
if AGENT_DIR="$(omp_agent_dir 2>/dev/null)"; then
  UNIT_DIR="$AGENT_DIR/extensions/$UNIT"
  ok "omp agent directory: $AGENT_DIR"
else
  bad "the omp agent directory this host reads is AMBIGUOUS (inherited PI_CODING_AGENT_DIR / PI_CONFIG_DIR / PI_PROFILE) — no honest statement about the installed unit can be made; pass ENTWURF_OMP_AGENT_DIR if you mean a non-default one"
fi

# ── the artifact omp would import ────────────────────────────────────────────
INSTALLED_ENTRY=""
if [ -n "$UNIT_DIR" ]; then
  if [ -L "$UNIT_DIR" ]; then
    bad "$UNIT_DIR is a SYMLINK — this installer never creates one, so what omp would import is not ours"
  elif [ -d "$UNIT_DIR" ]; then
    if omp_assembly_valid "$(dirname "$UNIT_DIR")" "$UNIT" 2>/dev/null; then
      [ -f "$UNIT_DIR/index.ts" ] && INSTALLED_ENTRY="index.ts"
      [ -z "$INSTALLED_ENTRY" ] && [ -f "$UNIT_DIR/index.js" ] && INSTALLED_ENTRY="index.js"
      ok "installed unit is structurally complete: $UNIT_DIR (entry $INSTALLED_ENTRY)"
    else
      bad "installed unit at $UNIT_DIR fails the structural oracle — omp may import a half-unit"
    fi
  else
    note "NOT-INSTALLED: no receiver unit at $UNIT_DIR. omp citizens on this host are outbound-only; dispatch to them answers mailbox-undeliverable. Install with ./run.sh install-omp-receive"
  fi
fi

# ── writer parity: source vs assembled vs installed ──────────────────────────
# The same stale-writer axis the birth and Claude doctors carry. A deployed unit that
# predates the source is the failure that looks like success: everything is green and the
# behaviour is last week's.
digest() { [ -f "$1" ] && python3 -c "import hashlib,sys;print(hashlib.sha256(open(sys.argv[1],'rb').read()).hexdigest()[:12])" "$1" || echo "-"; }
SRC_ENTRY="$REPO/pi-extensions/meta-bridge-receive-omp.ts"
case "$REPO" in
  */node_modules/@junghanacs/entwurf) SRC_ENTRY="$REPO/mcp/entwurf-bridge/dist/pi-extensions/meta-bridge-receive-omp.js" ;;
esac
# TWO artifacts, not one. The ENTRY is this unit's own logic; `lib/meta-session` is the
# SHARED writer every native unit carries a copy of, and it is the one that goes stale
# silently — a backend id, a marker field or a root-policy fix lands in the source while
# three deployed bundles keep last week's copy. Checking only the entry would call such a
# host green (measured: it did, in this very smoke).
if [ -n "$INSTALLED_ENTRY" ]; then
  LIB_EXT="ts"; [ "$INSTALLED_ENTRY" = "index.js" ] && LIB_EXT="js"
  SRC_LIB="$REPO/pi-extensions/lib/meta-session.ts"
  [ "$LIB_EXT" = "js" ] && SRC_LIB="$REPO/mcp/entwurf-bridge/dist/pi-extensions/lib/meta-session.js"
  for pair in "entry:$SRC_ENTRY:$UNIT_DIR/$INSTALLED_ENTRY" "writer:$SRC_LIB:$UNIT_DIR/lib/meta-session.$LIB_EXT"; do
    what="${pair%%:*}"; rest="${pair#*:}"; src="${rest%%:*}"; ins="${rest#*:}"
    SRC_D="$(digest "$src")"; INS_D="$(digest "$ins")"
    if [ "$SRC_D" = "$INS_D" ]; then
      ok "$what parity: source == installed ($SRC_D)"
    else
      bad "STALE $what: source=$SRC_D installed=$INS_D ($ins) — the deployed receiver is not this checkout's. Re-run ./run.sh install-omp-receive (and 'pnpm run build-bridge' first in a dev clone if you changed the source)"
    fi
  done
fi

# ── what the unit DID, off its own log ───────────────────────────────────────
# Arm failures and doorbell failures are judged on SEPARATE axes: a citizen can be armed
# and still fail to ring, and folding the two would print "nothing is armed" about a
# session whose marker is right there.
RECEIVE_LOG=""
if [ -n "$ROOT_POLICY_REFUSAL" ]; then
  bad "the omp meta-root policy REFUSES this environment: $ROOT_POLICY_REFUSAL — a garden root must be absolute or ~-rooted. The extension receives the same refusal, so no store can be named here"
else
  RECEIVE_LOG="${ENTWURF_META_SESSIONS_DIR:+$(dirname "$ENTWURF_META_SESSIONS_DIR")}"
  [ -n "$RECEIVE_LOG" ] || RECEIVE_LOG="$HOME/.pi/agent"
  RECEIVE_LOG="$RECEIVE_LOG/meta-bridge-receive-omp.log"
fi
if [ -n "$RECEIVE_LOG" ] && [ -f "$RECEIVE_LOG" ]; then
  # `grep -c` PRINTS 0 and EXITS 1 on no-match, so the idiomatic `|| echo 0` appends a
  # SECOND zero and every later `[ "$N" -gt 0 ]` dies with "integer expected" — caught
  # here on a real host, where a stale-marker read went through a doctor that had already
  # printed two shell errors. Count without the fallback and normalise once.
  count_in_log() { grep -c -- "$1" "$RECEIVE_LOG" 2>/dev/null | head -1 | tr -cd '0-9'; }
  ARMED_N="$(count_in_log " armed garden=")"; ARMED_N="${ARMED_N:-0}"
  RANG_N="$(count_in_log " rang garden=")"; RANG_N="${RANG_N:-0}"
  GAVEUP_N="$(count_in_log "arm-gave-up")"; GAVEUP_N="${GAVEUP_N:-0}"
  ARMFAIL_N="$(grep -cE "arm-failed|arm-refused" "$RECEIVE_LOG" 2>/dev/null | head -1 | tr -cd '0-9')"; ARMFAIL_N="${ARMFAIL_N:-0}"
  RINGFAIL_N="$(grep -cE "doorbell-failed|watch-error|signal-vanished" "$RECEIVE_LOG" 2>/dev/null | head -1 | tr -cd '0-9')"; RINGFAIL_N="${RINGFAIL_N:-0}"
  ok "receive log: $RECEIVE_LOG (armed=$ARMED_N rang=$RANG_N)"
  [ "$GAVEUP_N" -gt 0 ] && bad "$GAVEUP_N session(s) GAVE UP arming — birth never wrote a sender marker in that process. Those citizens were never addressable; check ./run.sh doctor-omp-bridge"
  [ "$ARMFAIL_N" -gt 0 ] && bad "$ARMFAIL_N arm failure/refusal line(s) — a citizen exists but no doorbell was published for it:" && grep "arm-failed\|arm-refused" "$RECEIVE_LOG" | tail -3 | sed 's/^/        /'
  [ "$RINGFAIL_N" -gt 0 ] && bad "$RINGFAIL_N doorbell/watch failure line(s) — the wake half broke on a live citizen:" && grep "doorbell-failed\|watch-error\|signal-vanished" "$RECEIVE_LOG" | tail -3 | sed 's/^/        /'
elif [ -n "$RECEIVE_LOG" ]; then
  note "NOT-YET: no receive log at $RECEIVE_LOG — this unit has not run. Open an omp TUI and re-run"
fi

# ── who is armed RIGHT NOW, through the production reader ────────────────────
if [ -z "$ROOT_POLICY_REFUSAL" ]; then
  FACTS_RC=0
  FACTS="$(env -u PI_CODING_AGENT_DIR "$REPO/run.sh" omp-receive-facts 2>&1)" || FACTS_RC=$?
  if [ "$FACTS_RC" -ne 0 ]; then
    bad "omp-receive-facts could not read the receiver markers (rc=$FACTS_RC):"
    printf '%s\n' "$FACTS" | tail -3 | sed 's/^/        /'
  else
    SUMMARY="$(printf '%s' "$FACTS" | python3 -c '
import json, sys
d = json.load(sys.stdin)
rs = d.get("receivers") or []
live = [r for r in rs if r.get("ownerLive")]
dead = [r for r in rs if not r.get("ownerLive")]
print(len(rs), len(live), len(dead), len(d.get("unreadableMarkers") or []))
for r in live:
    print("LIVE", r["gardenId"], r["ownerPid"], r["ownerKind"], r["unreadDelivered"], r["freshUnannounced"])
for r in dead:
    print("DEAD", r["gardenId"], r["ownerPid"], r["ownerKind"], r["unreadDelivered"], r["freshUnannounced"])
' 2>/dev/null)" || SUMMARY=""
    if [ -z "$SUMMARY" ]; then
      bad "omp-receive-facts returned output this doctor could not parse — refusing to guess"
    else
      COUNTS="$(printf '%s' "$SUMMARY" | head -1)"
      TOTAL="$(echo "$COUNTS" | cut -d' ' -f1)"; LIVE="$(echo "$COUNTS" | cut -d' ' -f2)"
      DEAD="$(echo "$COUNTS" | cut -d' ' -f3)"; BADM="$(echo "$COUNTS" | cut -d' ' -f4)"
      if [ "$TOTAL" -eq 0 ]; then
        note "NOT-YET: no omp receiver markers. Nothing is armed, so dispatch to an omp citizen is the honest mailbox-undeliverable refusal. Open an omp TUI with this unit installed and re-run"
      else
        # A stale marker is not a fault: the reader already refuses it and dispatch is
        # fail-closed. It is reported so an operator can tell "nothing armed" from
        # "something armed and then the session died" — two states one count would hide.
        if [ "$LIVE" -gt 0 ]; then
          ok "$LIVE live / $DEAD stale omp receiver marker(s)"
        else
          note "0 live / $DEAD stale omp receiver marker(s) — nothing is armed right now, so dispatch to an omp citizen is the honest mailbox-undeliverable refusal"
        fi
        printf '%s\n' "$SUMMARY" | tail -n +2 | while read -r state gid pid kind unread fresh; do
          if [ "$state" = "LIVE" ]; then
            echo "        armed  $gid owner=$pid ($kind) unread=$unread not-yet-announced=$fresh"
            [ "${fresh:-0}" -gt 0 ] && echo "        note   $fresh body/ies are enqueued but no doorbell has announced them — the watch may not be firing"
          else
            echo "        stale  $gid owner=$pid ($kind) — owner is gone; the reader already refuses this, dispatch is fail-closed"
          fi
        done
      fi
      [ "${BADM:-0}" -gt 0 ] && bad "$BADM receiver marker file(s) the production reader could not parse — inspect them by hand"
    fi
  fi
fi

# ── the two units this one is useless without ────────────────────────────────
# Not a duplicate of their own doctors — a NOTE, on the one axis this doctor owns:
# a doorbell with no birth has no citizen to join, and a doorbell with no tool hand rings
# for a model that has no entwurf_inbox_read to drain with.
if [ -f "$BIRTH_STATE" ]; then
  ok "birth unit is installed (ownership state present) — this receiver has a citizen to join"
else
  note "the BIRTH unit is not installed here (no $BIRTH_STATE). Without it nothing mints a citizen, so this receiver will log arm-deferred and then give up. Install with ./run.sh install-omp-bridge"
fi
if [ -n "$AGENT_DIR" ] && [ -f "$AGENT_DIR/mcp.json" ] && grep -q "entwurf-bridge" "$AGENT_DIR/mcp.json" 2>/dev/null; then
  ok "an entwurf-bridge MCP entry exists in $AGENT_DIR/mcp.json — the model has a way to reach entwurf_inbox_read (doctor-omp-mcp owns that axis)"
else
  note "no entwurf-bridge entry found in the omp MCP config. The doorbell announces a tool the model would not have; install with ./run.sh install-omp-mcp and verify with ./run.sh doctor-omp-mcp"
fi

# ── ownership axis ───────────────────────────────────────────────────────────
echo
echo "[omp-receive-doctor] ownership axis"
if [ -L "$STATE_FILE" ]; then
  own_bad "ownership state $STATE_FILE is a SYMLINK — refusing to trust it"
elif [ -f "$STATE_FILE" ]; then
  if [ -n "$UNIT_DIR" ] && omp_state_read "$STATE_FILE" "$UNIT_DIR" "$ASM" >/dev/null 2>&1; then
    ok "ownership state binds this installation: $STATE_FILE"
    if [ -n "$UNIT_DIR" ] && [ ! -e "$UNIT_DIR" ]; then
      own_bad "ownership state claims $UNIT_DIR but nothing is there — the inverse (./run.sh uninstall-omp-receive) will refuse until this is resolved"
    fi
  else
    own_bad "ownership state $STATE_FILE is corrupt or names a DIFFERENT installation than $UNIT_DIR"
  fi
elif [ -n "$UNIT_DIR" ] && [ -e "$UNIT_DIR" ]; then
  own_bad "$UNIT_DIR exists with NO ownership state. A directory that looks like our unit is not proof it is ours — the installer refuses to adopt it and the inverse refuses to remove it. Resolve by hand"
else
  note "no ownership state and no unit — this host has no omp receiver installed (a clean absence, not a fault)"
fi

echo
if [ "$fail" -eq 0 ]; then echo "[omp-receive-doctor] runtime axis: PASS"; else echo "[omp-receive-doctor] runtime axis: FAIL"; fi
if [ "$own_fail" -eq 0 ]; then echo "[omp-receive-doctor] ownership axis: PASS"; else echo "[omp-receive-doctor] ownership axis: FAIL"; fi
if [ "$fail" -eq 0 ] && [ "$own_fail" -eq 0 ]; then echo "[omp-receive-doctor] PASS"; exit 0; fi
echo "[omp-receive-doctor] FAIL"
exit 1
