#!/usr/bin/env bash
# omp-bridge-doctor.sh — the fail-loud surface for the OMP BIRTH extension (#87).
#
# TWO AXES, REPORTED SEPARATELY, EITHER RED IS RED (AGENTS.md Hard Rule 13):
#   runtime   — is there a unit omp will actually import, does it carry the CURRENT
#               writer, and what did it do the last time it ran?
#   ownership — does entwurf own that unit, by a state whose shape and bindings hold?
# Runtime coverage does not prove ownership, and broken ownership does not erase a
# visibly working configuration.
#
# THE PLACEMENT LAYER, AND WHY THIS DOCTOR CAN READ IT AT ALL. omp offers two vendor
# surfaces for declaring an extension (ledger M2): a native root scan of
# `<agent-dir>/extensions` (`discovery/builtin.ts:483` → `discovery/helpers.ts:625-712`)
# and an `extensions:` array in a settings file. This unit uses the FIRST, so the whole
# installed artifact is one directory entwurf created and can remove exactly — there is
# no operator-owned SSOT to preimage, merge into, or accidentally clobber, and this
# doctor's runtime axis is a structural read rather than a diff against somebody else's
# config. (`~/.omp/agent/config.yml` carries the operator's model roles, status line and
# plan settings; nothing here writes to it. The MCP hand is the opposite case and does
# write a vendor config file, with the preimage/inverse discipline that comes with it —
# see doctor-omp-mcp.)
#
# WHAT IT DELIBERATELY DOES NOT CLAIM. A green runtime axis is not a live citizen: only
# a real omp TUI session minting a record is that (`adding-a-harness.md` step 3(b)). An
# installed unit with zero omp records is reported as NOT-YET, never as red.
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/.." && pwd)"
UNIT="entwurf-meta-omp"
SRC="$REPO/pi/meta-bridge-omp"
ASM="${ENTWURF_OMP_ASM:-${XDG_DATA_HOME:-$HOME/.local/share}/entwurf/meta-bridge-omp/.assembled}"
STATE_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/entwurf/omp-bridge"
STATE_FILE="$STATE_DIR/install-state.json"

fail=0
own_fail=0
ok()   { echo "  ok    $*"; }
note() { echo "  note  $*"; }
bad()  { echo "  FAIL  $*"; fail=1; }
own_bad() { echo "  FAIL  $*"; own_fail=1; }

# shellcheck source=scripts/omp-bridge-oracle.sh
. "$HERE/omp-bridge-oracle.sh"

echo "[omp birth extension — runtime axis]"

if ! command -v omp >/dev/null 2>&1; then
  note "the 'omp' CLI is not on PATH — this host has no omp to be a citizen of (entwurf never installs one)"
fi

AGENT_DIR="$(omp_agent_dir)"
if [ -z "$AGENT_DIR" ]; then
  bad "the omp agent directory this host reads is AMBIGUOUS (see the reason above) — no verdict can be given about a directory we refuse to guess"
  AGENT_DIR=""
  UNIT_DIR=""
else
  UNIT_DIR="$AGENT_DIR/extensions/$UNIT"
  ok "effective omp agent dir: $AGENT_DIR (unit path: $UNIT_DIR)"
fi

if [ -n "$UNIT_DIR" ]; then
  if [ -L "$UNIT_DIR" ]; then
    bad "$UNIT_DIR is a SYMLINK — this installer never creates one, so what omp imports there is not ours"
  elif [ ! -d "$UNIT_DIR" ]; then
    if [ -f "$STATE_FILE" ]; then
      bad "ownership state exists but the unit is GONE: $UNIT_DIR — no omp session can be born. Re-run ./run.sh install-omp-bridge"
    else
      note "no unit installed at $UNIT_DIR and no ownership state — this host has not run install-omp-bridge (zero state, not a fault)"
    fi
  elif omp_assembly_valid "$(dirname "$UNIT_DIR")" "$UNIT" 2>/tmp/omp-doctor-oracle.$$; then
    ENTRY_NAME="index.ts"; [ -f "$UNIT_DIR/index.ts" ] || ENTRY_NAME="index.js"
    ok "installed unit is structurally complete (entry $ENTRY_NAME + lib + capability registry + type:module)"
    ok "omp discovers it by its own native rule: <agent-dir>/extensions/$UNIT/$ENTRY_NAME (discovery/helpers.ts:700-710)"
    # WRITER PARITY. The unit carries a COPY of the shared V3 writer and of the capability
    # registry, exactly like the Claude and Copilot units. A stale copy is the failure mode
    # `adding-a-harness.md` step 2(c) names: the deployed reader refuses records the new
    # backend list admits, including its own. Same judgement, same prescription.
    LIB_EXT="ts"; [ "$ENTRY_NAME" = "index.js" ] && LIB_EXT="js"
    case "$REPO" in
      */node_modules/@junghanacs/entwurf) SRC_LIB="$REPO/mcp/entwurf-bridge/dist/pi-extensions/lib/meta-session.js"; SRC_ENTRY="$REPO/mcp/entwurf-bridge/dist/pi-extensions/meta-bridge-omp.js" ;;
      *) SRC_LIB="$REPO/pi-extensions/lib/meta-session.ts"; SRC_ENTRY="$REPO/pi-extensions/meta-bridge-omp.ts" ;;
    esac
    for pair in "lib/meta-session.$LIB_EXT|$SRC_LIB|writer" "$ENTRY_NAME|$SRC_ENTRY|birth entry" "entwurf-capabilities.json|$REPO/pi/entwurf-capabilities.json|capability registry"; do
      rel="${pair%%|*}"; rest="${pair#*|}"; src="${rest%%|*}"; label="${rest##*|}"
      if [ ! -f "$src" ]; then
        note "$label source is absent in this checkout ($src) — parity not measurable here"
        continue
      fi
      INST_SHA="$(sha256sum "$UNIT_DIR/$rel" 2>/dev/null | cut -c1-12)"
      SRC_SHA="$(sha256sum "$src" 2>/dev/null | cut -c1-12)"
      if [ -n "$INST_SHA" ] && [ "$INST_SHA" = "$SRC_SHA" ]; then
        ok "installed $label matches source ($INST_SHA)"
      else
        bad "installed $label is STALE: installed=${INST_SHA:-missing} vs source=$SRC_SHA ($UNIT_DIR/$rel). The live omp extension is running old bytes — run ./run.sh install-omp-bridge, then restart any open omp session"
      fi
    done
  else
    bad "installed unit at $UNIT_DIR fails the structural oracle: $(cat /tmp/omp-doctor-oracle.$$ 2>/dev/null)"
  fi
  rm -f /tmp/omp-doctor-oracle.$$
fi

# ── WHERE THE GARDEN ROOTS ARE, under the SAME policy production uses (#87 B1) ──
# NOT `PI_CODING_AGENT_DIR ?? ~/.pi/agent`. For backend omp that variable is the VENDOR's
# agent dir — `setProfile` exports it for every named profile (`oh-my-pi` v18.0.0
# `utils/src/dirs.ts:452-473`) — so reading it here would point this doctor at a different
# store than the one the extension and the bridge child actually write to. The OMP policy
# is: the four `ENTWURF_META_*` overrides, else `<HOME>/.pi/agent/<surface>`, never PI.
#
# We do not re-implement that policy in bash. We reach it the same way the OMP bridge child
# does — drop the foreign variable, then let entwurf's own default resolver answer — and we
# ask the OWNER for the answer: `meta-facts` (#65) is the read-only projection of the
# CERTIFIED store, so it reports both the store directory it resolved and the records that
# passed certification. One call, two facts, no second parser.
#
# PI presence itself is NOT a fault and is never reported as one: under `omp --profile work`
# the vendor sets it deliberately. It is simply not a garden-root input.
# PREFLIGHT THE SAME GRAMMAR THE POLICY ENFORCES, BEFORE ASKING ANYTHING (#87 A2). The
# overrides are absolute or `~`/`~/…` only. A relative value would resolve against each
# process's own working directory, and this doctor does NOT share one with the extension —
# `run_ts` cd's to the repository. Asking `meta-facts` first would therefore answer from an
# unrelated empty directory and print NOT-YET (or PASS) about a store that is not the one
# the extension writes to. A refused environment is RUNTIME RED here, never laundered.
ROOT_POLICY_REFUSAL=""
for var in ENTWURF_META_SESSIONS_DIR ENTWURF_META_MAILBOX_DIR ENTWURF_META_SENDERS_DIR ENTWURF_META_RECEIVERS_DIR; do
  val="${!var:-}"
  [ -n "$val" ] || continue
  case "$val" in
    /*|"~"|"~/"*) ;;
    *) ROOT_POLICY_REFUSAL="${ROOT_POLICY_REFUSAL:+$ROOT_POLICY_REFUSAL, }$var=$val" ;;
  esac
done

FACTS_RC=0
FACTS_JSON=""
STORE=""
OMP_RECORDS=0
STORE_DEFECTS=0
if [ -n "$ROOT_POLICY_REFUSAL" ]; then
  bad "the omp meta-root policy REFUSES this environment: $ROOT_POLICY_REFUSAL — a garden root must be absolute or ~-rooted. The extension receives the same refusal and mints nothing; no store can be named here, so this is RED rather than a NOT-YET verdict about some other directory"
else
  FACTS_JSON="$(env -u PI_CODING_AGENT_DIR "$REPO/run.sh" meta-facts 2>&1)" || FACTS_RC=$?
fi
if [ -z "$ROOT_POLICY_REFUSAL" ] && [ "$FACTS_RC" -eq 0 ]; then
  FACTS_LINE="$(printf '%s' "$FACTS_JSON" | python3 -c '
import json, sys
facts = json.load(sys.stdin)
citizens = facts.get("citizens") or []
omp = [c for c in citizens if c.get("backend") == "omp"]
print(facts.get("storeDir", ""), len(omp), len(facts.get("defects") or []))
' 2>/dev/null)" || FACTS_LINE=""
  if [ -n "$FACTS_LINE" ]; then
    STORE="${FACTS_LINE%% *}"
    REST="${FACTS_LINE#* }"
    OMP_RECORDS="${REST%% *}"
    STORE_DEFECTS="${REST##* }"
  fi
fi

if [ -n "$ROOT_POLICY_REFUSAL" ]; then
  AGENT=""
  HOOK_LOG=""
elif [ -z "$STORE" ]; then
  bad "the certified record store could not be read (meta-facts rc=$FACTS_RC) — no honest statement about omp citizens can be made on this host:"
  printf '%s\n' "$FACTS_JSON" | tail -3 | sed 's/^/        /'
  AGENT=""
  HOOK_LOG=""
else
  AGENT="$(dirname "$STORE")"
  HOOK_LOG="$AGENT/meta-bridge-hook.log"
  ok "omp garden roots resolve to $AGENT (ENTWURF_META_* overrides, else \$HOME/.pi/agent — PI_CODING_AGENT_DIR is vendor-owned here and ignored)"
fi

# ── what the unit DID, read off the shared hook log ──────────────────────────
# Mint errors and marker errors are judged on SEPARATE axes, and that separation is not
# stylistic: a failed marker write lands AFTER the successful mint line, so a doctor that
# folded them together would read "the hook ran and did not mint" about a session whose
# record is right there (`adding-a-harness.md` step 6, measured on Copilot).
echo
echo "[what the extension did — ${HOOK_LOG:-<unresolved>}]"
if [ -n "$HOOK_LOG" ] && [ -f "$HOOK_LOG" ]; then
  MINT_ERRORS=' ERROR \[omp\] (?!sender-marker-)'
  LAST_ERROR_LINE="$(grep -nP "$MINT_ERRORS" "$HOOK_LOG" 2>/dev/null | tail -1 | cut -d: -f1)"
  LAST_OK_LINE="$(grep -n ' INFO \[omp\] \(create\|attach\) ' "$HOOK_LOG" 2>/dev/null | tail -1 | cut -d: -f1)"
  TOTAL_ERRORS="$(grep -cP "$MINT_ERRORS" "$HOOK_LOG" 2>/dev/null | head -1)"; TOTAL_ERRORS="${TOTAL_ERRORS:-0}"
  if [ -z "$LAST_ERROR_LINE" ]; then
    ok "no omp mint ERROR lines in $HOOK_LOG"
  elif [ -n "$LAST_OK_LINE" ] && [ "$LAST_OK_LINE" -gt "$LAST_ERROR_LINE" ]; then
    note "$TOTAL_ERRORS historical omp mint ERROR line(s), all followed by a successful mint (line $LAST_OK_LINE > $LAST_ERROR_LINE) — recovered, not red"
  else
    bad "the newest omp mint line in $HOOK_LOG is an unrecovered ERROR — the extension RAN and did not mint:"
    grep -P "$MINT_ERRORS" "$HOOK_LOG" | tail -3 | sed 's/^/        /'
  fi

  MARKER_FAILED="$(grep -c ' ERROR \[omp\] sender-marker-failed ' "$HOOK_LOG" 2>/dev/null | head -1)"
  MARKER_REFUSED="$(grep -c ' WARN \[omp\] sender-marker-refused ' "$HOOK_LOG" 2>/dev/null | head -1)"
  MARKER_OK="$(grep -c ' INFO \[omp\] sender marker ' "$HOOK_LOG" 2>/dev/null | head -1)"
  if [ "${MARKER_FAILED:-0}" -gt 0 ]; then
    bad "${MARKER_FAILED} sender-marker WRITE failure(s) — those citizens exist but cannot send under their own garden id:"
    grep ' ERROR \[omp\] sender-marker-failed ' "$HOOK_LOG" | tail -3 | sed 's/^/        /'
  elif [ "${MARKER_REFUSED:-0}" -gt 0 ]; then
    note "${MARKER_REFUSED} sender-marker refusal(s) and ${MARKER_OK:-0} armed — a refusal is fail-closed, not a fault"
  elif [ "${MARKER_OK:-0}" -gt 0 ]; then
    ok "${MARKER_OK} sender marker(s) armed — those citizens send under their own garden id"
  else
    note "no omp sender-marker lines yet (nothing has fired on this host)"
  fi

  # The SCOPE FENCE leaves its own receipt, and it is evidence rather than noise: one
  # line per session this unit refused to mint, naming the mode. A host with subagent
  # traffic and zero refusals would mean the fence never ran.
  SCOPE_REFUSED="$(grep -c ' INFO \[omp\] scope-refused ' "$HOOK_LOG" 2>/dev/null | head -1)"
  STATUS_ISSUES="$(grep -c ' WARN \[omp\] status-' "$HOOK_LOG" 2>/dev/null | head -1)"
  note "${SCOPE_REFUSED:-0} non-tui session(s) refused by the §3.5 scope fence — the designed answer for task subagents, rpc/rpc-ui and acp"
  if [ "${STATUS_ISSUES:-0}" -gt 0 ]; then
    note "${STATUS_ISSUES} visible-identity warning(s) — the garden id did not render on the status line for those sessions (statusLine.showHookStatus is default true; check the operator's config.yml)"
  fi
elif [ -n "$HOOK_LOG" ]; then
  note "no hook log yet at $HOOK_LOG (nothing has fired on this host)"
fi

# ── the records themselves, read through the CERTIFIED surface ───────────────
# NEVER a text grep (#87 B3). "This host has an omp garden citizen" is a claim on the
# record-authority axis, and the production writer earns it by certifying the WHOLE active
# store before writing — regular non-symlink files, live V3 schema, filename↔body
# agreement, unique nativeSessionId (`meta-session.ts` certifyActiveStore). A grep for the
# text `"backend": "omp"` matched a file containing nothing else and printed PASS. A doctor
# that claims admission must not weaken the contract the writer holds, so the count above
# comes from `meta-facts`' certified citizen list.
if [ -n "$STORE" ]; then
  if [ "${STORE_DEFECTS:-0}" -gt 0 ]; then
    note "$STORE_DEFECTS uncertifiable entr(ies) in $STORE are excluded from this count — run ./run.sh doctor-meta-bridge, which owns that axis"
  fi
  if [ "${OMP_RECORDS:-0}" -gt 0 ]; then
    ok "$OMP_RECORDS CERTIFIED omp meta-record(s) in $STORE (garden citizen proven on this host)"
  else
    note "NOT-YET: zero certified omp meta-records. An omp TUI session is born when it OPENS (session_start fires after first paint, before the first prompt) — open one and re-run this doctor"
  fi
fi

# ── §6 identity-carrier contamination, DETECTED (never silently preferred) ───
# `adding-a-harness.md` step 6 and `docs/external-mcp-host.md`: a complete
# PI_SESSION_ID + PI_AGENT_ID pair WINS over a native sender marker in the bridge's
# authoritative-self resolution, so an omp session started from a pi citizen's bash — and
# every internal agent borrowing its MCP manager — would speak under the parent pi garden
# id. Bundle A ships no managed omp launch to strip them at exec, so the only honest half
# available here is detection, and it goes red on its own axis rather than being absorbed
# into any other verdict.
echo
echo "[inherited pi identity carriers on live omp processes]"
if [ -d /proc ]; then
  CONTAMINATED=""
  for pid in $(pgrep -x omp 2>/dev/null); do
    ENVIRON="/proc/$pid/environ"
    [ -r "$ENVIRON" ] || continue
    if tr '\0' '\n' < "$ENVIRON" 2>/dev/null | grep -qE '^(PI_SESSION_ID|PI_AGENT_ID)='; then
      CONTAMINATED="$CONTAMINATED $pid"
    fi
  done
  if [ -n "$CONTAMINATED" ]; then
    bad "live omp process(es)$CONTAMINATED carry PI_SESSION_ID/PI_AGENT_ID inherited from a pi citizen's shell. Their MCP children would speak under the PARENT pi garden id, not their own — close them and relaunch omp from a shell without those variables"
  else
    ok "no live omp process carries PI_SESSION_ID/PI_AGENT_ID (omp mints neither itself — the danger is pure inheritance passthrough, ledger M6)"
  fi
else
  note "/proc is unavailable, so live omp environments could not be read on this platform"
fi

# ── ownership axis ───────────────────────────────────────────────────────────
echo
echo "[ownership axis]"
if [ -L "$STATE_FILE" ]; then
  own_bad "ownership state $STATE_FILE is a SYMLINK — refusing to trust it"
elif [ -f "$STATE_FILE" ]; then
  if STATE_FACTS="$(omp_state_read "$STATE_FILE" "${UNIT_DIR:-$STATE_FILE}" "$ASM" 2>&1)"; then
    ok "ownership state is well-formed and bound to this installation (version ${STATE_FACTS%% *}, entry ${STATE_FACTS##* })"
    if [ -d "$ASM/$UNIT" ]; then
      ok "the recorded assembly is present: $ASM/$UNIT"
    else
      own_bad "ownership state names an assembly that is gone: $ASM/$UNIT — the inverse can no longer prove what it placed. Re-run ./run.sh install-omp-bridge"
    fi
  else
    own_bad "ownership state is corrupt or names a different installation: $STATE_FACTS"
  fi
else
  if [ -n "$UNIT_DIR" ] && [ -d "$UNIT_DIR" ]; then
    own_bad "a unit is installed at $UNIT_DIR but entwurf holds NO ownership state for it — neither the installer nor the inverse will touch it (#87 B2: a shape is not a proof of ownership). Inspect it; if it is a stale copy of ours, remove it by hand and re-run ./run.sh install-omp-bridge"
  else
    note "no ownership state and no installed unit — zero state, which is a SKIP rather than a fault"
  fi
fi

echo
if [ "$fail" -ne 0 ] || [ "$own_fail" -ne 0 ]; then
  [ "$fail" -ne 0 ] && echo "[omp-bridge-doctor] runtime axis: FAIL" || echo "[omp-bridge-doctor] runtime axis: PASS"
  [ "$own_fail" -ne 0 ] && echo "[omp-bridge-doctor] ownership axis: FAIL" || echo "[omp-bridge-doctor] ownership axis: PASS"
  echo "[omp-bridge-doctor] FAIL"
  exit 1
fi
echo "[omp-bridge-doctor] runtime axis: PASS"
echo "[omp-bridge-doctor] ownership axis: PASS"
echo "[omp-bridge-doctor] PASS"
