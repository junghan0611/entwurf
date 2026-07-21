#!/usr/bin/env bash
# meta-bridge-doctor.sh — the FAIL-LOUD surface for the meta-bridge (1.0.0 step 5).
#
# The runtime hook is best-effort + log (it must never scream into a user's
# terminal or block startup). THIS is where a silent miss becomes loud. It proves
# the whole chain a real user depends on:
#   platform -> claude/node toolchain -> the BAKED node path still resolves
#   (catches NixOS /nix/store churn after a rebuild) -> plugin installed+enabled
#   globally -> meta-record dir writable -> SessionStart actually landed a record
#   (hook log + >=1 claude-code meta-record). Plugin present but zero record
#   evidence = the dangerous silent miss -> non-zero exit.
#
# Exit 0 = the meta-bridge is wired AND proven to have created a garden citizen.
set -euo pipefail

MKT_NAME="meta-bridge-local"
PLUGIN="entwurf-meta-receive"
CLAUDE_CFG="${CLAUDE_CONFIG_DIR:-$HOME/.claude}"
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# The live artifact lives under the XDG data dir (dev clone and installed package
# alike — never the checkout). Prefer the path RECORDED in install-state so a doctor
# run under a different XDG_DATA_HOME than install still hashes the REAL assembled
# bundle (and state.py check compares the same recorded marketplace path); fall back
# to the current-XDG computation only when no state exists yet (fresh host).
# LIB_EXT still tracks the hook artifact mode (0.12.5): installed packages ship the
# tsc-emitted `.js` closure (node_modules-safe), dev clones run the `.ts` source.
# The writer-version parity below hashes meta-session.<LIB_EXT> so an installed
# `.js` bundle is compared against the SAME-pipeline dist `.js`, never against the
# `.ts` source (which would hash-mismatch and false-STALE).
ASM="${XDG_DATA_HOME:-$HOME/.local/share}/entwurf/meta-bridge/.assembled"
RECORDED_ASM="$(python3 "$REPO/scripts/meta-bridge-state.py" assembled-path --repo "$REPO" 2>/dev/null || true)"
[ -n "$RECORDED_ASM" ] && ASM="$RECORDED_ASM"
case "$REPO" in
  */node_modules/@junghanacs/entwurf) LIB_EXT="js" ;;
  *)                                  LIB_EXT="ts" ;;
esac
# shellcheck source=scripts/meta-bridge-hook-log.sh
source "$REPO/scripts/meta-bridge-hook-log.sh"

fail=0
ok()   { echo "  ok    $*"; }
warn() { echo "  WARN  $*"; }
bad()  { echo "  FAIL  $*"; fail=1; }

# pi agent dir resolution — mirror meta-session.ts (PI_CODING_AGENT_DIR or ~/.pi/agent).
agent_dir() {
  if [ -n "${PI_CODING_AGENT_DIR:-}" ]; then
    case "$PI_CODING_AGENT_DIR" in "~") echo "$HOME";; "~/"*) echo "$HOME/${PI_CODING_AGENT_DIR#\~/}";; *) echo "$PI_CODING_AGENT_DIR";; esac
  else echo "$HOME/.pi/agent"; fi
}
AGENT="$(agent_dir)"
META_SESSIONS="${ENTWURF_META_SESSIONS_DIR:-$AGENT/meta-sessions}"
HOOK_LOG="$AGENT/meta-bridge-hook.log"

echo "meta-bridge doctor"
echo "config=$CLAUDE_CFG  agent-dir=$AGENT"

echo "[platform]"
# Install support and CERTIFIABILITY are two different claims. Both Linux and macOS
# are install-supported, but only Linux can reach the live owner-join tier below
# (bridge discovery needs per-process environ). Say that here rather than letting a
# macOS run reach the end and discover it as a surprise failure.
case "$(uname -s)" in
  Linux)  ok "Linux supported — the certified live axis (live owner join is instrumentable)" ;;
  Darwin) bad "macOS is install-supported but NOT certifiable by this release: the live owner join below cannot be instrumented (no /proc). Tracked as a release blocker in #51; do not read a macOS run as certification." ;;
  *) bad "$(uname -s) unsupported (Linux/macOS only)" ;;
esac

echo "[toolchain]"
if command -v claude >/dev/null; then ok "claude: $(claude --version 2>/dev/null | head -1)"; else bad "claude not on PATH"; fi
if command -v python3 >/dev/null; then ok "python3: $(python3 --version 2>/dev/null | head -1) (doorbell JSON parser)"; else bad "python3 not on PATH — FileChanged wake runtime would silently die"; fi
if command -v node >/dev/null; then
  # Node 24+ single supported axis (GLG, 2026-07-21) — rationale in run.sh setup preflight.
  NV="$(node -p 'process.versions.node' 2>/dev/null || echo 0)"; MJ="${NV%%.*}"
  if [ "${MJ:-0}" -ge 24 ]; then ok "node $NV (>= 24, supported axis)"; else bad "node $NV too old (need >= 24; there is no Node 22 lane)"; fi
else bad "node not on PATH"; fi

echo "[managed config state]"
if command -v python3 >/dev/null; then
  # state.py check is the effect-based keyset-survival guard: it asserts every
  # pi-owned key (scalar policy, permissions items, plugin/marketplace,
  # statusLine, user MCP) still holds its expected value. If another consumer
  # (agent-config merge, hand edit) overwrote one, this fails. Surface WHICH key
  # drifted — a blanket "keyset drifted" sends the operator hunting.
  # NB: branch on the exit code, NOT on empty stderr. A bare CHECK_ERR="$(...)"
  # assignment dies under `set -e` the moment state.py exits nonzero (drift), so
  # the doctor would print "[managed config state]" and exit 1 BEFORE showing
  # which key drifted — silent instead of fail-loud. As an `if` condition the
  # substitution's nonzero status is consumed (set -e suspended), so we always
  # reach the detail. stderr (drift detail) is captured via `2>&1 >/dev/null`.
  if CHECK_ERR="$(python3 "$REPO/scripts/meta-bridge-state.py" check --repo "$REPO" --asm "$ASM" 2>&1 >/dev/null)"; then
    ok "state file present and managed settings/MCP keyset survives intact"
  else
    bad "managed settings/MCP keyset missing or overwritten — another consumer may have clobbered a pi-owned key. Re-run ./run.sh install-meta-bridge. Drift detail:"
    printf '%s\n' "$CHECK_ERR" | sed 's/^/        /'
  fi
else
  bad "cannot validate stateful install without python3"
fi

echo "[plugin install (global / --scope user)]"
PLUGIN_LIST_JSON="$(claude plugin list --json 2>/dev/null || true)"
PLUGIN_FACT="$(printf '%s' "$PLUGIN_LIST_JSON" | python3 -c '
import json, sys
try:
    rows = json.load(sys.stdin)
except Exception:
    raise SystemExit(1)
target = sys.argv[1]
row = next((x for x in rows if isinstance(x, dict) and x.get("id") == target), None)
if row is None:
    print("absent")
else:
    print("present")
    print("true" if row.get("enabled") is True else "false")
    errors = row.get("errors")
    print("; ".join(str(x) for x in errors) if isinstance(errors, list) else "")
    # installPath is the AUTHORITY for which cached artifact Claude loads. Globbing
    # the version dirs and taking the first match inspects a lexicographically-first
    # directory, which after any plugin version bump is the OLD one — the doctor would
    # then certify a stale artifact while Claude runs a different one.
    print(row.get("installPath") if isinstance(row.get("installPath"), str) else "")
' "$PLUGIN@$MKT_NAME" 2>/dev/null || true)"
PLUGIN_ROOT=""
# The ONE plugin-presence fact for this run. Later sections must reuse it instead of
# re-invoking the CLI: two calls can disagree, and the silent-miss guard reading a
# different snapshot than this section is how a hard failure becomes a benign warn.
PLUGIN_PRESENCE="unknown"
if [ -n "$PLUGIN_FACT" ]; then
  PLUGIN_PRESENT="$(printf '%s\n' "$PLUGIN_FACT" | sed -n '1p')"
  PLUGIN_ENABLED="$(printf '%s\n' "$PLUGIN_FACT" | sed -n '2p')"
  PLUGIN_ERRORS="$(printf '%s\n' "$PLUGIN_FACT" | sed -n '3p')"
  PLUGIN_ROOT="$(printf '%s\n' "$PLUGIN_FACT" | sed -n '4p')"
  if [ "$PLUGIN_PRESENT" = "absent" ]; then
    PLUGIN_PRESENCE="absent"
    bad "$PLUGIN@$MKT_NAME not installed — run ./run.sh install-meta-bridge"
  else
    PLUGIN_PRESENCE="present"
    ok "$PLUGIN@$MKT_NAME present"
    if [ -n "$PLUGIN_ERRORS" ]; then
      bad "enabled=$PLUGIN_ENABLED but FAILED TO LOAD: $PLUGIN_ERRORS — the SessionStart hook is not running; re-run ./run.sh install-meta-bridge"
    elif [ "$PLUGIN_ENABLED" = "true" ]; then
      ok "enabled and loadable"
    else
      bad "installed but NOT enabled"
    fi
  fi
else
  # Compatibility fallback for a Claude floor whose plugin list has no --json surface.
  # Two failure shapes must stay apart, and neither may be swallowed:
  #   * `<cli> | grep -q` under pipefail is a RACE, not a test — grep exits at the first
  #     match, the still-writing CLI dies of SIGPIPE, and a present plugin reads as absent.
  #   * `$(... || true)` is the opposite error: it throws away the CLI's exit code, so a
  #     FAILING probe that happened to print a plausible line reads as healthy.
  # So: capture with the assignment as the if-condition (keeps rc, survives `set -e`),
  # then match the content without a pipe.
  if PLUGIN_LIST_TEXT="$(claude plugin list 2>/dev/null)"; then
    case "$PLUGIN_LIST_TEXT" in
      *"$PLUGIN@$MKT_NAME"*)
        PLUGIN_PRESENCE="present"
        ok "$PLUGIN@$MKT_NAME present (text fallback)"
        PLUGIN_LIST_TAIL="$(printf '%s\n' "$PLUGIN_LIST_TEXT" | grep -A3 -- "$PLUGIN@$MKT_NAME" || true)"
        case "$PLUGIN_LIST_TAIL" in
          *[Ee]nabled*) ok "enabled (text fallback; load errors unavailable)" ;;
          *) bad "installed but NOT enabled" ;;
        esac
        ;;
      *)
        PLUGIN_PRESENCE="absent"
        bad "$PLUGIN@$MKT_NAME not installed — run ./run.sh install-meta-bridge"
        ;;
    esac
  else
    PLUGIN_LIST_RC=$?
    bad "'claude plugin list' failed (exit $PLUGIN_LIST_RC) and '--json' was unavailable — plugin state is UNKNOWN, so nothing on this host can be certified. Fix the Claude CLI, then re-run."
  fi
fi

echo "[installed hook launch form + baked node path (NixOS store-churn guard)]"
# Resolve the ONE cached artifact root, then make every later section read it.
# `claude plugin list --json`.installPath names the directory Claude actually loads;
# only when that field is unavailable do we glob, and then an ambiguous multi-version
# cache is a FAILURE, never a guess — hooks, the synthetic drive, and writer-version
# parity must all judge the same root or a green verdict is about the wrong artifact.
CACHE_ROOT=""
CACHE_HOOKS=""
CACHE_SOURCE=""
CACHE_GLOB="$CLAUDE_CFG/plugins/cache/$MKT_NAME/$PLUGIN"
if [ -n "$PLUGIN_ROOT" ] && [ "${PLUGIN_ROOT#/}" = "$PLUGIN_ROOT" ]; then
  # A relative installPath resolves against whatever cwd happens to be current, so the
  # "authority" would name a different directory per caller. Refuse it as authority.
  bad "plugin installPath is not absolute ($PLUGIN_ROOT) — a cwd-dependent path cannot be the authority for which artifact Claude loads."
elif [ -n "$PLUGIN_ROOT" ]; then
  CACHE_ROOT="$PLUGIN_ROOT"
  CACHE_SOURCE="plugin installPath (authoritative)"
else
  CACHE_CANDIDATES="$(ls -d "$CACHE_GLOB/"*/ 2>/dev/null || true)"
  CACHE_COUNT="$(printf '%s' "$CACHE_CANDIDATES" | grep -c . || true)"
  if [ "${CACHE_COUNT:-0}" -gt 1 ]; then
    # Refuse to guess. Lexicographic-first is the OLD version after any bump, so a
    # guess here certifies an artifact Claude does not load.
    bad "installPath unavailable AND the plugin cache holds $CACHE_COUNT version directories — the doctor cannot tell which artifact Claude loads, so it certifies none of them: $(printf '%s' "$CACHE_CANDIDATES" | tr '\n' ' '). Re-run ./run.sh install-meta-bridge to leave exactly one."
  elif [ "${CACHE_COUNT:-0}" -eq 1 ]; then
    CACHE_ROOT="$(printf '%s' "$CACHE_CANDIDATES" | sed 's:/*$::')"
    CACHE_SOURCE="unambiguous cache glob (installPath unavailable)"
  else
    # A registered-but-absent artifact runs NO hook at all. This was a WARN, so the
    # doctor skipped BOTH the form classification and the synthetic owner join and
    # still exited 0 — a plugin row in `claude plugin list` carried the whole verdict.
    bad "no cached plugin artifact under $CACHE_GLOB/ — the plugin is registered but nothing is on disk, so no hook runs and no owner marker is ever written. Re-run ./run.sh install-meta-bridge."
  fi
fi
if [ -n "$CACHE_ROOT" ]; then
  if [ -f "$CACHE_ROOT/hooks/hooks.json" ]; then
    CACHE_HOOKS="$CACHE_ROOT/hooks/hooks.json"
    ok "active cached artifact resolved from $CACHE_SOURCE: $CACHE_ROOT"
  else
    bad "the cached artifact Claude loads has no hooks/hooks.json ($CACHE_SOURCE): $CACHE_ROOT — re-run ./run.sh install-meta-bridge."
  fi
fi
if [ -z "$CACHE_HOOKS" ]; then
  BAKED=""
  HOOK_FILE=""
  HOOK_COMMAND=""
elif ! command -v python3 >/dev/null; then
  BAKED=""
  HOOK_FILE=""
  HOOK_COMMAND=""
  bad "cannot inspect installed hook owner topology: python3 is missing (toolchain failure above); the launch form was NOT classified"
else
  # Classify the INSTALLED launch form, do not merely pattern-match one command.
  # Claude command hooks have two launch forms: shell form (`command` runs through a
  # shell) and exec form (`args` present → no shell at all, #51 v3). This release's
  # owner identity is carried by shell `$PPID` before `exec`, so exec form cannot
  # stand it up — but an unreadable-command message calls that "drift" and sends the
  # operator hand-patching hooks.json. Name the form, then judge it.
  #
  # All THREE owner hooks are read. Reading only SessionStart passed a manifest whose
  # other two hooks were still stale — exactly the hand-patch class this cut refuses.
  # The FileChanged doorbell is reported separately (line 4): its asyncRewake/timeout
  # are the wake path, and losing them must not blank the owner command layer 2 drives.
  if HOOK_PARSE="$(python3 - "$CACHE_HOOKS" "$REPO/pi/meta-bridge/$PLUGIN/hooks/hooks.json" <<'PY' 2>&1
import json, re, sys

inst_path, tmpl_path = sys.argv[1], sys.argv[2]
OWNER_EVENTS = ("SessionStart", "CwdChanged", "UserPromptSubmit")
CONTRACT = re.compile(
    r"ENTWURF_META_HOOK_OWNER_PID=\$PPID exec (\S+) \$\{CLAUDE_PLUGIN_ROOT\}/(meta-bridge-hook\.(?:ts|js))"
)

try:
    manifest = json.load(open(inst_path, encoding="utf-8"))
except Exception as exc:
    raise SystemExit(f"cannot parse installed hooks.json: {exc}")
try:
    tmpl_text = open(tmpl_path, encoding="utf-8").read()
    template = json.loads(tmpl_text)
except Exception as exc:
    raise SystemExit(
        f"cannot read the SHIPPED hook template ({tmpl_path}): {exc}. Without it there is nothing "
        "to compare the installed manifest against, so no form can be certified."
    )


def leaf(event, source=None):
    """First leaf of the first group. Shape is validated separately — never assume it."""
    src = manifest if source is None else source
    try:
        return src["hooks"][event][0]["hooks"][0]
    except (KeyError, IndexError, TypeError) as exc:
        raise SystemExit(f"hooks.{event}: no hook leaf in the installed manifest ({exc})")


# ── container shape ────────────────────────────────────────────────────────
# Claude executes EVERY matcher group and EVERY leaf. Reading leaf[0][0] and calling
# the manifest supported would let an appended group or leaf run uninspected.
inst_events = manifest.get("hooks")
if not isinstance(inst_events, dict):
    raise SystemExit("installed hooks.json has no `hooks` object")
if set(inst_events) != set(template["hooks"]):
    extra = sorted(set(inst_events) - set(template["hooks"]))
    missing = sorted(set(template["hooks"]) - set(inst_events))
    raise SystemExit(
        f"installed hook EVENT SET differs from the shipped template (unexpected: {extra}, missing: {missing})"
    )
for event, tmpl_groups in template["hooks"].items():
    groups = inst_events.get(event)
    if not isinstance(groups, list) or len(groups) != len(tmpl_groups):
        raise SystemExit(
            f"hooks.{event}: expected exactly {len(tmpl_groups)} matcher group(s) as shipped, found "
            f"{len(groups) if isinstance(groups, list) else type(groups).__name__} — every extra group "
            "also runs, and an uninspected group cannot be certified"
        )
    for i, (group, tmpl_group) in enumerate(zip(groups, tmpl_groups)):
        if not isinstance(group, dict) or set(group) != set(tmpl_group):
            raise SystemExit(f"hooks.{event}[{i}]: group keys differ from the shipped template")
        if group.get("matcher") != tmpl_group.get("matcher"):
            raise SystemExit(
                f"hooks.{event}[{i}]: matcher is {group.get('matcher')!r}, shipped contract is "
                f"{tmpl_group.get('matcher')!r}"
            )
        leaves, tmpl_leaves = group.get("hooks"), tmpl_group.get("hooks")
        if not isinstance(leaves, list) or len(leaves) != len(tmpl_leaves):
            raise SystemExit(
                f"hooks.{event}[{i}]: expected exactly {len(tmpl_leaves)} hook leaf/leaves as shipped, "
                f"found {len(leaves) if isinstance(leaves, list) else type(leaves).__name__} — every "
                "extra leaf also runs"
            )


# ── owner launch form ──────────────────────────────────────────────────────
def classify(hook):
    """exec | malformed-exec | non-command | corrupt | shell-carrier | shell-other."""
    if not isinstance(hook, dict):
        return "corrupt"
    command = hook.get("command")
    command_ok = isinstance(command, str) and command != ""
    type_ok = hook.get("type") == "command"
    if hook.get("args") is not None:
        # Only a STRUCTURALLY VALID exec form earns the "recognized upstream form"
        # message. A string/number `args`, an empty command, or a non-command type is
        # corruption wearing exec form's clothes, and must not be excused as one.
        args = hook.get("args")
        args_ok = isinstance(args, list) and all(isinstance(a, str) for a in args)
        return "exec" if (type_ok and command_ok and args_ok) else "malformed-exec"
    if not type_ok:
        return "non-command"
    if not command_ok:
        return "corrupt"
    return "shell-carrier" if CONTRACT.fullmatch(command) else "shell-other"


forms = {event: classify(leaf(event)) for event in OWNER_EVENTS}
distinct = sorted(set(forms.values()))
detail = ", ".join(f"{event}={forms[event]}" for event in OWNER_EVENTS)
if len(distinct) > 1:
    raise SystemExit(
        f"owner hooks disagree on launch form ({detail}) — a partially hand-patched manifest. "
        "Every owner hook must carry the same authorized form; re-run ./run.sh install-meta-bridge."
    )

form = distinct[0]
if form == "exec":
    raise SystemExit(
        "RECOGNIZED EXEC-FORM (`args` present, no shell), NOT AUTHORIZED BY THE CURRENT RELEASE "
        "CONTRACT — #51 B+B2 pending. This is a known upstream launch form, not corruption and not "
        "drift; the doctor reads it fine. It is refused because this release's owner identity is the "
        "shell `$PPID` carrier expanded before `exec`, and exec form has no shell to expand it, so "
        "sender/receiver markers cannot be keyed to the Claude owner. Do not hand-patch hooks.json: "
        "re-run ./run.sh install-meta-bridge to restore the authorized form, then restart existing "
        "Claude sessions."
    )
if form == "malformed-exec":
    raise SystemExit(
        f"MALFORMED exec-form hook ({detail}) — `args` is present but the leaf is not a valid exec "
        "form (needs type=command, a non-empty string command, and args as an array of strings). "
        "This is CORRUPTION, not the recognized upstream exec form, and Claude's behaviour on it is "
        "undefined. Re-run ./run.sh install-meta-bridge."
    )
if form in ("non-command", "corrupt"):
    raise SystemExit(
        f"installed owner hook is not a usable command hook ({detail}) — type must be `command` with "
        "a non-empty string command. Re-run ./run.sh install-meta-bridge."
    )
if form == "shell-other":
    raise SystemExit(
        "installed hooks use shell form WITHOUT the owner carrier contract: "
        f"{leaf('SessionStart').get('command')!r}. Markers would be keyed to whatever process the "
        "host shell leaves behind. Re-run ./run.sh install-meta-bridge; existing Claude sessions "
        "must then restart."
    )

commands = {event: leaf(event)["command"] for event in OWNER_EVENTS}
if len(set(commands.values())) != 1:
    detail = "; ".join(f"{event}={commands[event]!r}" for event in OWNER_EVENTS)
    raise SystemExit(f"owner hooks share a form but not a command — {detail}")

command = commands["SessionStart"]
matched = CONTRACT.fullmatch(command)

# ── exact equality against the shipped template ────────────────────────────
# The installer bakes exactly two values into the template. So "the deployed manifest
# equals what we shipped, modulo those two" is the whole contract — and it is what makes
# per-field allowlists unnecessary: a doorbell pointed at /tmp/evil, a timeout of 999, an
# added field, all surface here instead of slipping through a suffix or isinstance test.
expected = json.loads(
    tmpl_text.replace("__NODE_BIN__", matched.group(1)).replace("__HOOK_ENTRY__", matched.group(2))
)


def first_difference(a, b, path="hooks.json"):
    if isinstance(a, dict) and isinstance(b, dict):
        for key in sorted(set(a) | set(b)):
            if key not in a:
                return f"{path}.{key}: missing (shipped: {b[key]!r})"
            if key not in b:
                return f"{path}.{key}: unexpected ({a[key]!r})"
            found = first_difference(a[key], b[key], f"{path}.{key}")
            if found:
                return found
        return None
    if isinstance(a, list) and isinstance(b, list):
        if len(a) != len(b):
            return f"{path}: {len(a)} entries, shipped {len(b)}"
        for i, (x, y) in enumerate(zip(a, b)):
            found = first_difference(x, y, f"{path}[{i}]")
            if found:
                return found
        return None
    return None if a == b else f"{path}: {a!r}, shipped {b!r}"


diff = first_difference(manifest, expected)
if diff:
    raise SystemExit(
        f"installed manifest DIFFERS from the shipped hook template at {diff}. The installer bakes "
        "only the node path and the hook entry filename, so every other difference is drift or a "
        "hand edit. Re-run ./run.sh install-meta-bridge."
    )

# Doorbell reported separately for legibility. Its correctness now comes from the exact
# template equality above, not from a loose per-field test. It says the wake wiring is
# DECLARED as shipped; it does NOT say exit-2 → wake holds at runtime (#51 B2).
bell = leaf("FileChanged")
doorbell = (
    f"ok FileChanged doorbell matches the shipped static contract exactly "
    f"(command={bell['command']}, asyncRewake={bell['asyncRewake']}, timeout={bell['timeout']}); "
    "runtime exit-2 wake acceptance is NOT proven here (#51 B2)"
)

print(matched.group(1))
print(matched.group(2))
print(command)
print(doorbell)
PY
)"; then
    BAKED="$(printf '%s\n' "$HOOK_PARSE" | sed -n '1p')"
    HOOK_FILE="$(printf '%s\n' "$HOOK_PARSE" | sed -n '2p')"
    HOOK_COMMAND="$(printf '%s\n' "$HOOK_PARSE" | sed -n '3p')"
    HOOK_DOORBELL="$(printf '%s\n' "$HOOK_PARSE" | sed -n '4p')"
    ok "launch form: shell form with the explicit \$PPID owner carrier + exec — supported, and identical across all 3 owner hooks"
    case "$HOOK_DOORBELL" in
      ok\ *)  ok "${HOOK_DOORBELL#ok }" ;;
      *)      bad "${HOOK_DOORBELL#bad }. Re-run ./run.sh install-meta-bridge." ;;
    esac
  else
    BAKED=""
    HOOK_FILE=""
    HOOK_COMMAND=""
    bad "installed hook launch form is UNSUPPORTED — $HOOK_PARSE"
  fi

  if [ -n "$BAKED" ] && [ -x "$BAKED" ]; then
    ok "baked node exists + executable: $BAKED"
    TMP_AGENT="$(mktemp -d 2>/dev/null || mktemp -d -t entwurf-doctor-hook)"
    HOOK_ENV='{"session_id":"doctor-synthetic-native","transcript_path":"/tmp/entwurf-doctor-synthetic-transcript.jsonl","cwd":"/tmp","hook_event_name":"SessionStart","model":{"id":"doctor-model"}}'
    printf '%s' "$HOOK_ENV" > "$TMP_AGENT/hook-input.json"
    # Drive the SAME command Claude loaded, from the SAME resolved artifact root. Run it
    # as a foreground child (not a pipeline/command-substitution grandchild), so inner
    # `$PPID` is this still-live doctor shell (`$$`). The marker key proves the owner
    # join, not merely hook output.
    if env PI_CODING_AGENT_DIR="$TMP_AGENT" CLAUDE_PLUGIN_ROOT="$CACHE_ROOT" bash -c "$HOOK_COMMAND" \
         < "$TMP_AGENT/hook-input.json" > "$TMP_AGENT/hook-output.txt" 2>&1 \
       && grep -q 'hookSpecificOutput' "$TMP_AGENT/hook-output.txt" \
       && [ -f "$TMP_AGENT/meta-senders/claude-code/$$.json" ]; then
      # Say exactly what was driven. This runs the command under BASH; which shell
      # Claude itself uses for a shell-form hook is not instrumented here (#51: the
      # topology matrix is gate 1's job, and it is not built before the B/B2 verdict).
      ok "installed owner command executes under bash and keys its sender marker to the live host pid (bash only — Claude's own shell choice is NOT instrumented here)"
    else
      bad "installed owner command failed owner-join execution under bash — stale plugin cache / unsupported hook topology / broken bundle. Re-run install-meta-bridge. Detail: $(tr '\n' ' ' < "$TMP_AGENT/hook-output.txt" | cut -c1-300)"
    fi
    rm -rf "$TMP_AGENT" 2>/dev/null || true
  elif [ -n "$BAKED" ]; then
    bad "baked node path is DEAD (nix GC / version bump?): $BAKED — re-run ./run.sh install-meta-bridge"
  fi
fi

echo "[statusline — garden identity visible in native Claude]"
if command -v python3 >/dev/null; then
  STATUSLINE_CMD="$(python3 - <<'PY'
import json, os
p=os.path.expanduser('~/.claude/settings.json') if not os.environ.get('CLAUDE_CONFIG_DIR') else os.path.join(os.environ['CLAUDE_CONFIG_DIR'], 'settings.json')
try:
    d=json.load(open(p))
    sl=d.get('statusLine') if isinstance(d, dict) else None
    print(sl.get('command','') if isinstance(sl, dict) else '')
except Exception:
    print('')
PY
)"
  EXPECTED_STATUSLINE="$(python3 "$REPO/scripts/meta-bridge-state.py" desired-statusline --repo "$REPO" | python3 -c 'import json,sys; print(json.load(sys.stdin).get("command", ""))')"
  if [ "$STATUSLINE_CMD" = "$EXPECTED_STATUSLINE" ]; then ok "statusLine.command matches expected (dev: checkout path; installed: entwurf-statusline bin shim): $STATUSLINE_CMD"; else bad "statusLine.command drifted (got '$STATUSLINE_CMD', expected '$EXPECTED_STATUSLINE')"; fi
  if [[ "$EXPECTED_STATUSLINE" == */* ]]; then
    if [ -x "$EXPECTED_STATUSLINE" ]; then ok "statusline executable"; else bad "statusline script not executable: $EXPECTED_STATUSLINE"; fi
  elif command -v "$EXPECTED_STATUSLINE" >/dev/null 2>&1; then
    ok "statusline bin resolves on PATH: $(command -v "$EXPECTED_STATUSLINE")"
  else
    bad "statusline bin not on PATH: $EXPECTED_STATUSLINE"
  fi
  SAMPLE_STATUSLINE_OUT="$(printf '%s' '{"session_id":"doctor-no-record","workspace":{"current_dir":"/tmp"},"model":{"id":"claude-sonnet-5"},"context_window":{"context_window_size":200000,"used_percentage":1,"current_usage":{"input_tokens":1}}}' | "$EXPECTED_STATUSLINE" 2>/dev/null || true)"
  if [ "$(printf '%s\n' "$SAMPLE_STATUSLINE_OUT" | wc -l | tr -d ' ')" = "2" ] && printf '%s\n' "$SAMPLE_STATUSLINE_OUT" | sed -n '1p' | grep -q 'tmp' && printf '%s\n' "$SAMPLE_STATUSLINE_OUT" | sed -n '2p' | grep -q '🪛' && printf '%s\n' "$SAMPLE_STATUSLINE_OUT" | sed -n '2p' | grep -q ' cc | s'; then ok "statusline synthetic execution emits two rows (work context + identity)"; else bad "statusline synthetic execution failed or omitted two-row work/identity marker"; fi
else
  bad "cannot validate statusline without python3"
fi

echo "[receiver MCP reach — entwurf_inbox_read in EVERY native session, NOT plugin-owned]"
# The plugin owns ONLY the wake/record hooks. The receiver self-fetch tool
# (entwurf_inbox_read) comes from the user's entwurf-bridge MCP wiring — a Claude
# Code / agent-config responsibility, never injected here (injecting from the
# plugin duplicates the server and drops its identity env). The honest test is
# GLOBAL REACH: a native session in an arbitrary cwd must see the tool. A
# PROJECT-scoped ~/.mcp.json is NOT enough (it only reaches its own project; a
# /tmp session would wake with no way to record its receipt). USER scope is.
# So probe from a neutral non-project cwd, exactly like a real native session.
if command -v claude >/dev/null; then
	# rc AND content, pipe-free (same class as the installer's post-install check): a
	# piped `grep -q` can SIGPIPE the CLI into a false negative, while `|| true` would
	# let a FAILING probe with plausible output read as a healthy reach.
	# NB: capture rc WITHOUT `!`. Under `if ! cmd; then`, `$?` inside the branch is the
	# status of the negation (always 0), so the real exit code would be lost and the
	# message would report a failure as "exit 0".
	if MCP_GET="$(cd /tmp && claude mcp get entwurf-bridge 2>/dev/null)"; then
		MCP_GET_RC=0
	else
		MCP_GET_RC=$?
	fi
	if [ "$MCP_GET_RC" -ne 0 ]; then
		bad "'claude mcp get entwurf-bridge' failed from /tmp (exit $MCP_GET_RC) — USER-scope receiver reach is UNKNOWN, not proven. A woken session may have no way to record its receipt."
	elif case "$MCP_GET" in *"Scope: User config"*) true ;; *) false ;; esac &&
	     case "$MCP_GET" in *Connected*) true ;; *) false ;; esac; then
		ok "entwurf-bridge reachable from a neutral cwd (/tmp) as USER-scope MCP — every native session can entwurf_inbox_read"
	else
		bad "entwurf-bridge is not USER-scope+Connected from /tmp — a native session outside the wired project cannot entwurf_inbox_read, so a woken receipt is never recorded. A PROJECT-scoped ~/.mcp.json is not enough; wire it USER scope: claude mcp add -s user entwurf-bridge -e ENTWURF_BRIDGE_EXTERNAL_AGENT_ID=external-mcp/claude-code -- bash \"$REPO/mcp/entwurf-bridge/start.sh\""
	fi
else
	warn "claude not on PATH — cannot probe MCP reach"
fi

echo "[meta-record store]"
mkdir -p "$META_SESSIONS" 2>/dev/null || true
if [ -d "$META_SESSIONS" ] && [ -w "$META_SESSIONS" ]; then ok "writable: $META_SESSIONS"; else bad "meta-sessions dir not writable: $META_SESSIONS"; fi
if command -v node >/dev/null; then
  # Full store scan — mode by LOCATION (mirror mcp/entwurf-bridge/start.sh). Node
  # REFUSES --experimental-strip-types for a .ts under node_modules
  # (ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING), so an INSTALLED package must scan
  # via the prebuilt dist JS (build-bridge emits it; files:["mcp/"] ships it); a DEV
  # CLONE lives outside node_modules and runs the .ts source. Before this split the
  # doctor always ran the .ts and reported a FALSE "corrupt records" FAIL on every
  # installed host (the 0.12.0 strip-types-under-node_modules class the bridge boot
  # already fixed, but this doctor helper still ran raw .ts).
  case "$REPO" in
    */node_modules/*)
      store_doctor="$REPO/mcp/entwurf-bridge/dist/scripts/meta-bridge-store-doctor.js"
      if [ -f "$store_doctor" ]; then
        store_scan=(node "$store_doctor" "$META_SESSIONS")
      else
        bad "installed under node_modules but prebuilt store-doctor missing: $store_doctor — the tarball ships it via prepack; reinstall @junghanacs/entwurf"
        store_scan=()
      fi
      ;;
    *)
      store_scan=(node --experimental-strip-types "$REPO/scripts/meta-bridge-store-doctor.ts" "$META_SESSIONS")
      ;;
  esac
  # Guard the expansion: bash 3.2 (macOS) + set -u errors on "${arr[@]}" for a
  # zero-length array, so only run/print when the command was actually built.
  if [ "${#store_scan[@]}" -gt 0 ]; then
    if "${store_scan[@]}" >/dev/null 2>&1; then
      ok "full store scan: no corrupt records, duplicate nativeSessionId, body/filename drift, or backend↔wakeMode contradiction"
    else
      bad "full store scan failed — corrupt/duplicate/drift meta-record(s) present. Inspect with: ${store_scan[*]}"
    fi
  fi
else
  bad "cannot scan meta-record store without node"
fi

echo "[SessionStart creation evidence (silent-miss guard)]"
# `set -euo pipefail` + empty store = doctor abort: with no *.meta.json the glob
# stays literal, grep exits 2 (no such file) / 1 (no match), pipefail propagates,
# and the doctor dies right after the section header — hiding the very "open a
# session" hint a fresh-but-correct install needs. Swallow grep's nonzero IN the
# pipe (same idiom as the `[ -f ] || continue` guard below) so CC_COUNT=0 cleanly.
CC_COUNT="$({ grep -l '"backend": "claude-code"' "$META_SESSIONS"/*.meta.json 2>/dev/null || true; } | wc -l | tr -d ' ')"
if [ -f "$HOOK_LOG" ]; then
  ok "hook log present: $HOOK_LOG ($(wc -l < "$HOOK_LOG" | tr -d ' ') lines)"
  # ERROR is sticky in an append-only log: a one-time miss that was later recovered
  # must NOT keep the doctor red forever. Recovery is deliberately narrow: only a
  # later `INFO armed watch` proves a real SessionStart/CwdChanged wake path is
  # back. A later UserPromptSubmit `INFO attach record` is degraded record
  # backfill and must NOT clear an arm/upsert failure.
  if hook_status="$(meta_bridge_hook_log_status "$HOOK_LOG")"; then
    if [ "$hook_status" = "no-error" ]; then
      ok "hook log contains no ERROR line(s)"
    else
      ok "hook log has past ERROR(s) but a later INFO armed watch recovered the wake path"
    fi
  else
    bad "unrecovered hook ERROR (no later INFO armed watch) — last ERROR: $hook_status"
  fi
  if grep -q ' INFO sender marker ' "$HOOK_LOG"; then
    ok "sender marker evidence present (native meta-session can send as replyable garden-id)"
  else
    bad "no sender marker evidence in hook log — native sessions may receive mail but send as anonymous external-mcp. Re-run ./run.sh install-meta-bridge, then trigger a Claude prompt/SessionStart so the updated hook writes the marker."
  fi
else
  # Absent log = the two assertions above (unrecovered ERROR, sender-marker evidence)
  # never ran. As a WARN that silently removed both from the verdict while the doctor
  # still printed PASS.
  bad "NOT CERTIFIED — no hook log at $HOOK_LOG, so neither the unrecovered-ERROR check nor the sender-marker evidence check could run. Open a Claude Code session and run this doctor again."
fi
if [ "${CC_COUNT:-0}" -ge 1 ]; then
  ok "$CC_COUNT claude-code meta-record(s) landed (garden citizen proven)"
else
  # Reuse the presence fact decided ONCE above — never re-probe the CLI here. A second
  # call can answer differently from the first, and this branch turns a hard SILENT-MISS
  # failure into a benign warn, so a disagreeing snapshot is exactly how the dangerous
  # case would go quiet.
  if [ "$PLUGIN_PRESENCE" = "present" ]; then
    bad "plugin installed but ZERO claude-code meta-records — SILENT MISS. Open a Claude Code session; if still zero, inspect $HOOK_LOG."
  elif [ "$PLUGIN_PRESENCE" = "unknown" ]; then
    bad "ZERO claude-code meta-records and plugin state is UNKNOWN (the plugin-list probe failed above) — this cannot be read as a fresh install."
  else
    warn "no meta-records yet (plugin not installed)"
  fi
fi

# Runtime complement to the installed-command contract above. On Linux, inspect
# every live entwurf MCP process rooted in THIS agent dir and prove its candidate
# owner pid has a live, record-backed sender marker plus the matching receiver
# marker. This catches the observed retained-wrapper failure when an MCP child is
# present: reinstall updated cache files, but an already-running Claude process still executes the old in-memory hook and
# keeps writing dead wrapper pids. A restart is then required, not another install.
echo "[live Claude MCP owner join]"
if command -v python3 >/dev/null; then
  if JOIN_OUT="$(python3 - "$AGENT" "$META_SESSIONS" <<'PY' 2>&1
import json, os, sys
from pathlib import Path

agent = Path(sys.argv[1]).expanduser().resolve()
store = Path(sys.argv[2]).expanduser().resolve()
proc = Path("/proc")
if not proc.is_dir():
    # rc=3 is a PLATFORM verdict, distinct from rc=2 ("no session open right now").
    # The runtime this doctor verifies has a `ps` fallback for start-key/ppid, but
    # bridge DISCOVERY needs per-process environ, which has no portable equivalent
    # here — so the live tier is unreachable, not merely unobserved.
    print("live owner join is NOT INSTRUMENTABLE on this platform: /proc is unavailable, so entwurf MCP children cannot be discovered")
    raise SystemExit(3)

def stat_fields(pid):
    text = Path(f"/proc/{pid}/stat").read_text()
    return text[text.rfind(")") + 2:].split()

def parent(pid):
    try: return int(stat_fields(pid)[1])
    except Exception: return None

def start_key(pid):
    try: return "linux:" + stat_fields(pid)[19]
    except Exception: return ""

def process_agent(env):
    raw = env.get("PI_CODING_AGENT_DIR")
    home = env.get("HOME", str(Path.home()))
    if raw:
        if raw == "~": raw = home
        elif raw.startswith("~/"): raw = str(Path(home) / raw[2:])
        return Path(raw).resolve()
    return (Path(home) / ".pi" / "agent").resolve()

bridges = []
for p in proc.glob("[0-9]*"):
    try:
        pairs = p.joinpath("environ").read_bytes().split(b"\0")
        env = {k.decode(): v.decode(errors="replace") for x in pairs if b"=" in x for k, v in [x.split(b"=", 1)]}
        if env.get("ENTWURF_BRIDGE_REQUIRE_META_SENDER") != "1": continue
        if env.get("ENTWURF_BRIDGE_EXTERNAL_AGENT_ID") != "external-mcp/claude-code": continue
        if process_agent(env) != agent: continue
        bridges.append((int(p.name), parent(int(p.name))))
    except (OSError, ValueError):
        continue
if not bridges:
    print("no live Claude entwurf MCP process for this agent dir — the live owner join was NOT measured")
    raise SystemExit(2)

records = {}
for f in store.glob("*.meta.json"):
    try:
        d = json.loads(f.read_text())
        if d.get("backend") == "claude-code" and isinstance(d.get("gardenId"), str): records[d["gardenId"]] = d
    except Exception:
        pass  # the full store doctor reports corruption separately

failures = []
for bridge_pid, bridge_parent in bridges:
    candidates = []
    if bridge_parent: candidates.append(bridge_parent)
    grand = parent(bridge_parent) if bridge_parent else None
    if grand and grand not in candidates: candidates.append(grand)
    live = []
    for owner in candidates:
        f = agent / "meta-senders" / "claude-code" / f"{owner}.json"
        try:
            d = json.loads(f.read_text())
            if d.get("ownerPid") == owner and d.get("ownerStartKey") == start_key(owner) and start_key(owner):
                live.append(d)
        except Exception:
            pass
    gids = {d.get("gardenId") for d in live if isinstance(d.get("gardenId"), str)}
    if len(gids) != 1:
        failures.append(f"bridge pid={bridge_pid} owner-candidates={candidates}: live sender garden ids={sorted(gids)}")
        continue
    gid = next(iter(gids))
    sender = next(d for d in live if d.get("gardenId") == gid)
    record = records.get(gid)
    if not record or record.get("nativeSessionId") != sender.get("nativeSessionId"):
        failures.append(f"bridge pid={bridge_pid} owner={sender.get('ownerPid')}: sender {gid} is not record-backed")
        continue
    try:
        receiver = json.loads((agent / "meta-receivers" / f"{gid}.json").read_text())
    except Exception:
        receiver = {}
    owner = sender.get("ownerPid")
    if receiver.get("ownerPid") != owner or receiver.get("ownerStartKey") != start_key(owner) or receiver.get("nativeSessionId") != sender.get("nativeSessionId"):
        failures.append(f"bridge pid={bridge_pid} owner={owner}: receiver marker for {gid} is absent/stale/mismatched")
if failures:
    print("; ".join(failures))
    raise SystemExit(1)
print(f"{len(bridges)} live Claude MCP process(es): sender + receiver owner join is live and record-backed")
PY
)"; then
    ok "$JOIN_OUT"
  else
    JOIN_RC=$?
    # Every path below is a FAILURE. This section is the one that measures the axis
    # this cut exists to fix, and it used to WARN and let the doctor exit 0 — so a
    # PASS could be printed having never observed a single live owner join. An oracle
    # whose central evidence is optional is not an oracle. The three causes stay
    # distinguishable, because "your install is broken" and "nothing was measured"
    # send an operator to completely different places.
    case "$JOIN_RC" in
      2) bad "NOT CERTIFIED — $JOIN_OUT. Nothing here says the install is broken: the evidence simply does not exist yet. Open a Claude Code session (or restart the affected one) and run this doctor again." ;;
      3) bad "NOT CERTIFIED on this platform — $JOIN_OUT. This release cannot certify a $(uname -s) host; Linux is the certified live axis today (#51 support matrix)." ;;
      *) bad "$JOIN_OUT. Re-run install-meta-bridge, restart the affected Claude session(s), then run doctor again." ;;
    esac
  fi
else
  bad "cannot validate live Claude MCP owner join without python3"
fi

# ── writer-version parity (source ↔ assembled ↔ installed) ──────────────────
# The dangerous lag: a meta-record schema cut updates the repo SOURCE but the
# DEPLOYED bundle (what the live SessionStart hook runs) is not re-assembled, so
# new sessions are still written by the old writer — invisibly. "source complete"
# ≠ "deployed complete". This section makes the running writer version legible:
# live-write schema = does the bundle carry serializeMetaIdentity (v2 identity
# write) or only mintMetaRecord (v1). Hash = drift catch. The authority for "what
# records me" is the INSTALLED bundle; a mismatch vs source is a loud FAIL.
echo
echo "writer-version parity"
livewrite_schema() { # $1=meta-session.ts → v2|v1|absent
  [ -f "$1" ] || { echo "absent"; return; }
  if grep -q "serializeMetaIdentity" "$1"; then echo "v2"; else echo "v1"; fi
}
hash12() { [ -f "$1" ] && sha256sum "$1" | cut -c1-12 || echo "------------"; }
registry_for_ms() { # $1=bundle meta-session.ts → sibling plugin-root registry path
  [ -f "$1" ] || { echo ""; return; }
  dirname "$(dirname "$1")"
}

# Source authority for parity depends on the mode: an installed bundle carries the
# dist `.js`, so compare it against the dist `.js` (same tsc pipeline → hash-equal);
# a dev clone carries the `.ts`, so compare against the `.ts` source.
if [ "$LIB_EXT" = "js" ]; then
  SRC_MS="$REPO/mcp/entwurf-bridge/dist/pi-extensions/lib/meta-session.js"
else
  SRC_MS="$REPO/pi-extensions/lib/meta-session.ts"
fi
SRC_REG="$REPO/pi/entwurf-capabilities.json"
ASM_MS="$ASM/$PLUGIN/lib/meta-session.$LIB_EXT"
# Read the SAME artifact root the hook sections judged. Re-globbing here could hash a
# different version directory than the one whose hooks.json was classified — the two
# halves of the verdict would then be about two different installs.
INST_MS=""
if [ -n "$CACHE_ROOT" ] && [ -f "$CACHE_ROOT/lib/meta-session.$LIB_EXT" ]; then
  INST_MS="$CACHE_ROOT/lib/meta-session.$LIB_EXT"
fi

ASM_ROOT="$(registry_for_ms "$ASM_MS")"
INST_ROOT="$(registry_for_ms "${INST_MS:-}")"
ASM_REG="${ASM_ROOT:+$ASM_ROOT/entwurf-capabilities.json}"
INST_REG="${INST_ROOT:+$INST_ROOT/entwurf-capabilities.json}"

src_v="$(livewrite_schema "$SRC_MS")";            src_h="$(hash12 "$SRC_MS")";  src_reg_h="$(hash12 "$SRC_REG")"
asm_v="$(livewrite_schema "$ASM_MS")";            asm_h="$(hash12 "$ASM_MS")";  asm_reg_h="$(hash12 "${ASM_REG:-/none}")"
inst_v="$(livewrite_schema "${INST_MS:-/none}")"; inst_h="$(hash12 "${INST_MS:-/none}")"; inst_reg_h="$(hash12 "${INST_REG:-/none}")"

echo "  source    : $src_v  ($src_h)  registry=$src_reg_h"
echo "  assembled : $asm_v  ($asm_h)  registry=$asm_reg_h"
echo "  installed : $inst_v  ($inst_h)  registry=$inst_reg_h  ${INST_MS:-<none>}"

# store reality — distribution of schemaVersion across landed records.
sv1=0; sv2=0
for mf in "$META_SESSIONS"/*.meta.json; do
  [ -f "$mf" ] || continue
  case "$(grep -o '"schemaVersion"[[:space:]]*:[[:space:]]*[0-9]*' "$mf" | grep -o '[0-9]*$' | head -1)" in
    1) sv1=$((sv1 + 1)) ;; 2) sv2=$((sv2 + 1)) ;;
  esac
done
echo "  store     : v1=$sv1 v2=$sv2  (dual-read reads both)"

if [ -z "${INST_MS:-}" ]; then
  # Whether the DEPLOYED writer is stale is the whole point of this section. Skipping
  # it as a WARN meant "we could not look" was printed alongside PASS.
  bad "no installed writer bundle to compare (expected lib/meta-session.$LIB_EXT under the resolved artifact root${CACHE_ROOT:+ $CACHE_ROOT}) — the deployed writer version is UNKNOWN, so a stale writer cannot be ruled out. Re-run ./run.sh install-meta-bridge."
elif [ "$inst_h" = "$src_h" ]; then
  ok "deployed writer matches source ($inst_v) — no version lag"
else
  bad "deployed writer STALE: installed=$inst_v($inst_h) vs source=$src_v($src_h). The live hook records sessions with the OLD writer. Run ./run.sh install-meta-bridge to redeploy, then open a Claude session and re-run this doctor."
fi
if [ -f "$ASM_MS" ] && [ "$asm_h" != "$src_h" ]; then
  warn "assembled bundle differs from source ($asm_v vs $src_v) — stale .assembled; install re-assembles it"
fi

# v2 writer dependency: loadMetaCapabilityRegistry reads entwurf-capabilities.json
# at runtime. In the bundle layout it must sit at the plugin ROOT (resolved via
# `../` from lib/). A v2 bundle WITHOUT it throws on every mint/parse — a silent
# hook break that hash parity alone cannot see (it only hashes meta-session.ts).
check_registry_dep() { # $1=bundle meta-session.ts  $2=label  $3=registry-path  $4=registry-hash
  local ms="$1" label="$2" reg="$3" reg_h="$4"
  [ -f "$ms" ] && grep -q "serializeMetaIdentity" "$ms" || return 0 # v1/absent: no registry dep
  if [ ! -f "$reg" ]; then
    bad "$label is v2 but MISSING entwurf-capabilities.json at plugin root ($reg) — the v2 writer throws on mint/parse (silent hook break). Re-run ./run.sh install-meta-bridge (now bundles the registry)."
  elif [ "$reg_h" != "$src_reg_h" ]; then
    bad "$label v2 carries a STALE capability registry: $reg_h vs source=$src_reg_h ($reg). Re-run ./run.sh install-meta-bridge so the live writer and its load-bearing registry move together."
  else
    ok "$label v2 carries capability registry ($reg, $reg_h)"
  fi
}
check_registry_dep "$ASM_MS" "assembled" "${ASM_REG:-}" "$asm_reg_h"
check_registry_dep "$INST_MS" "installed" "${INST_REG:-}" "$inst_reg_h"

echo
echo "[entwurf-control / v2 dispatch surface]"
# The entwurf_v2 verb (0.11 step 5d-3) rides two surfaces: the pi-native tool (which
# depends on the --entwurf-control flag) and the MCP verb. These are SOURCE/static +
# single-gate checks — a live `pi --entwurf-control` model turn is 5d-5 matrix / live-smoke
# territory (it takes auth/model state), NOT the doctor's job. `pi --help | grep` is also
# avoided: flag exposure depends on extension-load conditions, so source+gate is the honest signal.
V2_CONTROL_SRC="$REPO/pi-extensions/entwurf-control.ts"
V2_SURFACE_SRC="$REPO/pi-extensions/lib/entwurf-v2-surface.ts"
V2_MCP_SRC="$REPO/mcp/entwurf-bridge/src/index.ts"
if [ -f "$V2_CONTROL_SRC" ] && grep -q 'ENTWURF_FLAG = "entwurf-control"' "$V2_CONTROL_SRC" && grep -q 'registerFlag(ENTWURF_FLAG' "$V2_CONTROL_SRC"; then
  ok "pi-native --entwurf-control flag registered (ENTWURF_FLAG)"
else
  bad "pi-native --entwurf-control flag not found in entwurf-control.ts — the v2 pi tool depends on it"
fi
if [ -f "$V2_CONTROL_SRC" ] && grep -q 'registerEntwurfV2Tool' "$V2_CONTROL_SRC" && grep -q 'name: "entwurf_v2"' "$V2_CONTROL_SRC"; then
  ok "pi-native entwurf_v2 tool registered"
else
  bad "pi-native entwurf_v2 tool not found in entwurf-control.ts"
fi
if [ -f "$V2_MCP_SRC" ] && grep -q 'server.tool(' "$V2_MCP_SRC" && grep -q '"entwurf_v2"' "$V2_MCP_SRC"; then
  ok "MCP entwurf_v2 verb registered"
else
  bad "MCP entwurf_v2 verb not found in entwurf-bridge"
fi
# check-entwurf-v2-surface is a SOURCE-SHAPE gate: it strip-types-runs a .ts gate
# (which imports typebox, a dev dep) to assert the surface source shape. Under
# node_modules that cannot run (strip-types refused + dev deps absent), AND its
# subject — the shipped surface source shape — is a repo/release invariant already
# enforced by the release gate. So on an INSTALLED host, confirm the surface source
# SHIPPED and defer the exhaustive gate; the live runtime wiring (flag/tool/MCP verb)
# is already proven by the grep checks just above. Running the full .ts gate here
# produced a FALSE "gate FAILED" on every installed host.
case "$REPO" in
  */node_modules/*)
    if [ -f "$V2_SURFACE_SRC" ]; then
      ok "check-entwurf-v2-surface: shipped surface source present; exhaustive source-shape gate is a repo/release invariant (not run under node_modules)"
    else
      bad "entwurf-v2-surface.ts missing from the installed package — the v2 surface source did not ship"
    fi
    ;;
  *)
    if [ -f "$V2_SURFACE_SRC" ] && (cd "$REPO" && node --experimental-strip-types scripts/check-entwurf-v2-surface.ts >/dev/null 2>&1); then
      ok "check-entwurf-v2-surface gate passes (surface adapter + pi-native/MCP wiring)"
    else
      bad "check-entwurf-v2-surface gate FAILED or surface adapter missing — run: ./run.sh check-entwurf-v2-surface"
    fi
    ;;
esac
# prefixRoots operator policy (5d-4b): the shared env SSOT both v2 surfaces read. Display
# ONLY — the parser SSOT lives in entwurf-v2-surface.ts (proven by check-entwurf-v2-surface);
# the doctor does NOT re-implement parsing. Unset ⇒ no prefix promotion (the safe default).
if [ -z "${ENTWURF_PREFIX_ROOTS:-}" ]; then
  ok "ENTWURF_PREFIX_ROOTS unset → no prefix auto-approve (preflight default trust)"
else
  ok "ENTWURF_PREFIX_ROOTS set → operator prefix-approve roots: $ENTWURF_PREFIX_ROOTS"
fi

echo
if [ "$fail" -eq 0 ]; then echo "meta-bridge doctor: PASS"; else echo "meta-bridge doctor: FAIL (see above)"; exit 1; fi
