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

# 12-hex digest, portable. NOT `sha256sum`: that is coreutils and absent on macOS.
# NOT `shasum -a 256` either (byte-identical layout though it is) — that would be a
# second digest convention in this tree, and python3 is already a HARD prerequisite
# on every path that reaches a digest here: the structural oracle below runs python3
# before this loop is entered. So the digest reuses the python3 hashlib form
# omp-receive-doctor.sh:99 and copilot-receive-bridge.sh:174 already ship. Empty on
# any failure, exactly like the old `2>/dev/null` form — the caller reads an empty
# digest as STALE, which is the fail-closed side.
sha12() { python3 -c 'import hashlib,sys;print(hashlib.sha256(open(sys.argv[1],"rb").read()).hexdigest()[:12])' "$1" 2>/dev/null || true; }

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
      INST_SHA="$(sha12 "$UNIT_DIR/$rel")"
      SRC_SHA="$(sha12 "$src")"
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
  # PORTABLE SELECTOR, SAME CONTRACT. The separation above is a negative lookahead,
  # and BSD grep (macOS) has no `-P` at all — so the selector is awk, where two
  # conditions ARE `(?!…)`. It is also the pipefail-safe form: `grep -c` exits 1 on a
  # zero-match file, which under this file's `set -o pipefail` (line 26) is exactly
  # what the old `| head -1` was laundering; awk exits 0 and prints 0.
  # The success selector moves from GNU BRE `\(a\|b\)` to ERE `(a|b)` for the same
  # reason: BRE alternation is a GNU extension, so on BSD grep that pattern matches
  # nothing and a RECOVERED host would be reported as unrecovered — a false RED.
  MINT_ERRORS='/ ERROR \[omp\] / && !/ ERROR \[omp\] sender-marker-/'
  LAST_ERROR_LINE="$(awk "$MINT_ERRORS{print NR}" "$HOOK_LOG" 2>/dev/null | tail -1)"
  LAST_OK_LINE="$(grep -nE ' INFO \[omp\] (create|attach) ' "$HOOK_LOG" 2>/dev/null | tail -1 | cut -d: -f1)"
  TOTAL_ERRORS="$(awk "$MINT_ERRORS{n++} END{print n+0}" "$HOOK_LOG" 2>/dev/null)"; TOTAL_ERRORS="${TOTAL_ERRORS:-0}"
  if [ -z "$LAST_ERROR_LINE" ]; then
    ok "no omp mint ERROR lines in $HOOK_LOG"
  elif [ -n "$LAST_OK_LINE" ] && [ "$LAST_OK_LINE" -gt "$LAST_ERROR_LINE" ]; then
    note "$TOTAL_ERRORS historical omp mint ERROR line(s), all followed by a successful mint (line $LAST_OK_LINE > $LAST_ERROR_LINE) — recovered, not red"
  else
    bad "the newest omp mint line in $HOOK_LOG is an unrecovered ERROR — the extension RAN and did not mint:"
    awk "$MINT_ERRORS" "$HOOK_LOG" | tail -3 | sed 's/^/        /'
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
# id. Bundle C's managed fresh launch has no per-window unset form in tmux, so it writes
# both names EMPTY instead. That is an honest scrub: authoritative readers trim and require
# truthy values, so an empty or whitespace-only value is nonauthoritative just like absence.
# This doctor detects only an actual nonblank carrier and reports it on its own axis rather
# than absorbing it into any other verdict.
echo
echo "[inherited pi identity carriers on live omp processes]"
# THE CANDIDATE HALF IS PORTABLE; THE PREDICATE INPUT IS NOT. `pgrep -x omp` is POSIX
# and answers on every platform; reading another process's environment is what needs
# `/proc`. Those two facts used to be fused into one `[ -d /proc ]` branch whose else
# arm was a `note`, and a note lets this doctor end in PASS while the contamination
# detector is blind — the same fail-OPEN shape copilot-receive-bridge.sh:376-380
# refuses on Linux ("A note would let the doctor end in PASS while a session that can
# never arm is running, which is the exact false-success the section was written to
# break"). The epistemic state is identical, so the verdict is now identical: an axis
# whose predicate INPUT cannot be obtained is UNVERIFIABLE and non-green, never clean.
#
# Candidate set. Production scans every `omp` pid. `ENTWURF_OMP_CARRIER_PIDS` (set, even
# to empty) narrows it so a hermetic smoke can hand this branch REAL processes it launched
# and read their real `/proc/<pid>/environ`. It narrows candidates ONLY — the nonblank
# predicate below is the same production code either way. It is a TEST SEAM, never
# production proof: the branch below is what a real host runs, so it owes its own honesty.
ENUM_FAILED=""
if [ -n "${ENTWURF_OMP_CARRIER_PIDS+x}" ]; then
  CARRIER_CANDIDATES="$ENTWURF_OMP_CARRIER_PIDS"
else
  # `pgrep` HAS THREE ANSWERS AND ONLY TWO OF THEM ARE FACTS ABOUT omp. 0 = it enumerated
  # and matched. 1 = it enumerated and NOTHING matched — a real, positive absence, which
  # is evidence. ANYTHING ELSE (2 usage/syntax, 3 fatal, 127 not on PATH) means the
  # enumeration itself did not happen, so the candidate set is UNKNOWN — not empty.
  # This used to be `|| true`, which folded that third answer into the second: an empty
  # candidate set, a loop that never runs, and the clean `ok` below. A live contaminated
  # omp session then read as CLEAN because the tool that would have found it never ran
  # (reproduced on an isolated install with a PATH-preceding `pgrep` shim exiting 2:
  # rc=0, runtime PASS, ownership PASS). Same class as the missing-/proc branches below,
  # so it gets the same verdict: an axis whose predicate INPUT cannot be obtained is
  # UNVERIFIABLE and non-green, never clean.
  ENUM_RC=0
  CARRIER_CANDIDATES="$(pgrep -x omp 2>/dev/null)" || ENUM_RC=$?
  if [ "$ENUM_RC" -gt 1 ]; then
    ENUM_FAILED="$ENUM_RC"
  fi
fi
CONTAMINATED=""
UNVERIFIABLE=""
for pid in $CARRIER_CANDIDATES; do
  case "$pid" in *[!0-9]*) continue ;; esac
  ENVIRON="/proc/$pid/environ"
  if [ ! -d "/proc/$pid" ]; then
    # TWO DIFFERENT FACTS SHARE THIS SHAPE AND ONLY ONE IS EVIDENCE. Where /proc
    # exists, a missing /proc/<pid> means the process vanished between `pgrep` and
    # this read — nothing to judge, so it is skipped. Where /proc ITSELF does not
    # exist (Darwin), the process is still there and it is the INTERFACE that is
    # missing: the verdict input is gone while the subject is not, which is the
    # UNVERIFIABLE state and is reported, never skipped.
    [ -d /proc ] && continue
    UNVERIFIABLE="$UNVERIFIABLE $pid"
    continue
  fi
  # STILL THERE, STILL UNREADABLE (hidepid, or an omp owned by another user that
  # `pgrep` legitimately found) — same missing input, same state. This used to be a
  # silent `continue`, which reported such a process as clean.
  if [ ! -r "$ENVIRON" ]; then
    UNVERIFIABLE="$UNVERIFIABLE $pid"
    continue
  fi
  # `grep -c`, never `grep -q`. This file runs under `set -o pipefail` (line 26), and a
  # `-q` grep EXITS AT THE FIRST MATCH, closing the pipe while `tr` is still writing the
  # rest of an ~12KB environ. `tr` dies of SIGPIPE (141), pipefail promotes that to the
  # pipeline's status, and the `if` takes the CLEAN branch — so a genuinely contaminated
  # process was reported as clean, and the doctor printed PASS. It is a RACE on how far
  # `tr` got, which is why it read as flakiness: measured on this host, 6 misses in 40
  # reads of one live fixture carrying PI_SESSION_ID=foreign-garden. `-c` consumes all of
  # stdin, so there is no early close and nothing to race. The same lesson is already
  # written at smoke-omp-mcp-state.sh:91 — it had not reached this reader.
  HITS="$(tr '\0' '\n' < "$ENVIRON" 2>/dev/null | grep -cE '^(PI_SESSION_ID|PI_AGENT_ID)=.*[^[:space:]]' || true)"
  if [ "${HITS:-0}" -gt 0 ]; then
    CONTAMINATED="$CONTAMINATED $pid"
  fi
done
# Reported on their own lines, never folded: "contaminated", "cannot be judged" and "the
# candidate set is unknown" send an operator to three different places, and absence is a
# fourth answer that is none of them.
if [ -n "$CONTAMINATED" ]; then
  bad "live omp process(es)$CONTAMINATED carry a non-empty PI_SESSION_ID/PI_AGENT_ID inherited from a pi citizen's shell. Their MCP children would speak under the PARENT pi garden id, not their own — close them and relaunch omp from a shell without those variables"
fi
if [ -n "$UNVERIFIABLE" ]; then
  bad "UNVERIFIABLE — the environment of live omp process(es)$UNVERIFIABLE could not be read, so their PI_SESSION_ID/PI_AGENT_ID state is UNKNOWN and is NOT assumed clean. On this platform there may be no per-process environment interface at all; \`ps -E\`/\`ps eww\` is deliberately NOT used as a substitute, because on Darwin it succeeds only for unrestricted targets and the measurement that would say which side omp falls on has not been run (scripts/raw-macos-measure/probe.sh cell M6). Otherwise, re-run this doctor as the user that owns those sessions."
fi
if [ -n "$ENUM_FAILED" ]; then
  bad "UNVERIFIABLE — 'pgrep -x omp' FAILED (exit $ENUM_FAILED), so the SET of live omp processes is UNKNOWN and is NOT assumed empty. Nothing was enumerated, so this doctor can neither name a contaminated session nor claim there is none. Repair the process-enumeration tool on PATH (a \`pgrep\` that exits 1 is the honest 'nothing matched' and stays green) and re-run."
fi
if [ -z "$CONTAMINATED" ] && [ -z "$UNVERIFIABLE" ] && [ -z "$ENUM_FAILED" ]; then
  ok "no live omp process carries a non-empty PI_SESSION_ID/PI_AGENT_ID (empty carrier values are the managed tmux scrub and are nonauthoritative; omp mints neither itself — the danger is pure inheritance passthrough, ledger M6)"
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
