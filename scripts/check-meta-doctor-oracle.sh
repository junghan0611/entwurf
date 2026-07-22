#!/usr/bin/env bash
# check-meta-doctor-oracle — detection-power gate for meta-bridge-doctor.sh (#51).
#
# WHY THIS EXISTS. `doctor-meta-bridge` was made the release oracle: the recovery of a
# broken host is judged by ITS exit code and nothing else. But until this gate, the
# doctor's GREEN path was the one verification surface in this repo with zero mutation
# coverage. `smoke-meta-install-state` drives the doctor twice and BOTH drives expect
# exit 1, and neither fixture has a plugin cache — so the installed-form classification
# and the synthetic owner join never executed under any gate. An oracle nobody has ever
# seen say PASS, and that nobody has ever forced to say FAIL, is a hope, not an oracle.
#
# WHAT IT PROVES. One healthy fixture must reach `meta-bridge doctor: PASS`, and each
# planted defect must flip it to FAIL *with the message that names that defect*. Exit
# code alone would be a vacuous pass: several of these defects are one section apart,
# and a doctor that goes red for the wrong reason sends an operator to the wrong place.
#
# WHAT IT DOES NOT PROVE. The host-shell matrix (dash/zsh × command shape) is #51 gate
# 1's job and is deliberately not built before the exec-form B/B2 verdict. This gate
# drives whatever shell the doctor drives.
#
# FIXTURE HONESTY. The plugin ASSEMBLY is real — `meta-bridge-install.sh` runs, with a
# fake `claude` on PATH. The Claude plugin CACHE is NOT real: the fake CLI cannot copy
# an artifact into its cache the way the real `claude plugin install` does, so this gate
# PLANTS the cache from the assembled bundle. Every claim below is worded to that line.
#
# Offline / hermetic. Deps: bash + node + python3. Swaps HOME and every writable XDG
# root plus the agent dir (rule 11), and fences the operator's real data tree on exit.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/.." && pwd)"
MKT_NAME="meta-bridge-local"
PLUGIN="entwurf-meta-receive"

command -v python3 >/dev/null || { echo "FAIL: python3 not on PATH"; exit 1; }
command -v node >/dev/null || { echo "FAIL: node not on PATH"; exit 1; }

fail=0
ok()  { echo "  ok    $*"; }
bad() { echo "  FAIL  $*"; fail=1; }

TMP="$(mktemp -d -t entwurf-doctor-oracle.XXXXXX)"

# Rule 11 self-fence: capture the operator's REAL data tree before anything runs, and
# compare on every exit path. A green sandbox claim is worth nothing if the gate wrote
# through an inherited XDG root while making it.
REAL_DATA_ROOT="${XDG_DATA_HOME:-$HOME/.local/share}/entwurf"
REAL_DATA_BEFORE="$( (find "$REAL_DATA_ROOT" -type f -print0 2>/dev/null | sort -z | xargs -0r sha256sum) 2>/dev/null || true)"

BRIDGE_PID=""
cleanup() {
  [ -n "$BRIDGE_PID" ] && kill "$BRIDGE_PID" 2>/dev/null || true
  local after
  after="$( (find "$REAL_DATA_ROOT" -type f -print0 2>/dev/null | sort -z | xargs -0r sha256sum) 2>/dev/null || true)"
  if [ "$REAL_DATA_BEFORE" != "$after" ]; then
    echo "  FAIL  SELF-FENCE: this gate mutated the operator's REAL install-state tree ($REAL_DATA_ROOT)" >&2
    rm -rf "$TMP"
    exit 1
  fi
  rm -rf "$TMP"
}
trap cleanup EXIT

# --- sandbox: HOME and EVERY writable XDG root move together (rule 11) -------
export HOME="$TMP/home"
export XDG_DATA_HOME="$TMP/xdg-data"
export XDG_STATE_HOME="$TMP/xdg-state"
export XDG_CACHE_HOME="$TMP/xdg-cache"
export CLAUDE_CONFIG_DIR="$HOME/.claude"
export PI_CODING_AGENT_DIR="$TMP/agent"
AGENT="$PI_CODING_AGENT_DIR"
CACHE_DIR="$CLAUDE_CONFIG_DIR/plugins/cache/$MKT_NAME/$PLUGIN"
PLANTED="$CACHE_DIR/0.1.0"
mkdir -p "$CLAUDE_CONFIG_DIR" "$AGENT" "$XDG_DATA_HOME" "$XDG_STATE_HOME" "$XDG_CACHE_HOME"
echo '{}' > "$CLAUDE_CONFIG_DIR/settings.json"
echo '{}' > "$HOME/.claude.json"

echo "check-meta-doctor-oracle (sandbox=$TMP)"

# --- fake claude CLI ---------------------------------------------------------
# Answers every subcommand install + doctor invoke. installPath is the field the doctor
# uses as the authority for WHICH cached artifact Claude loads; FAKE_NO_INSTALL_PATH
# drops it so the ambiguity path can be exercised.
BIN="$TMP/bin"
mkdir -p "$BIN"
cat > "$BIN/claude" <<'SH'
#!/usr/bin/env bash
printf '%s\n' "$*" >> "$FAKE_CLAUDE_LOG"
case "$1${2:+ $2}${3:+ $3}" in
  "--version")
    echo "2.1.217 (Claude Code)" ;;
  "plugin list --json")
    # FAKE_NO_JSON stands in for a Claude floor with no --json surface at all.
    [ "${FAKE_NO_JSON:-0}" = 1 ] && exit 0
    if [ "${FAKE_NO_INSTALL_PATH:-0}" = 1 ]; then
      printf '%s\n' '[{"id":"entwurf-meta-receive@meta-bridge-local","version":"0.1.0","enabled":true}]'
    else
      printf '[{"id":"entwurf-meta-receive@meta-bridge-local","version":"0.1.0","enabled":true,"installPath":"%s"}]\n' "$FAKE_INSTALL_PATH"
    fi ;;
  "plugin list"*)
    printf '%s\n' "entwurf-meta-receive@meta-bridge-local" "  Status: enabled"
    exit "${FAKE_PLUGIN_LIST_RC:-0}" ;;
  "mcp get"*)
    printf '%s\n' "Scope: User config" "Status: ✔ Connected"
    [ "${FAKE_MCP_RC:-0}" != 0 ] && exit "$FAKE_MCP_RC"
    # FAKE_MCP_TAIL keeps the CLI writing past the pipe buffer, so any reader that
    # leaves early would SIGPIPE it — the deterministic form of the flake that a
    # `cli | grep -q` probe turns into a false negative.
    [ -n "${FAKE_MCP_TAIL:-}" ] && { cat "$FAKE_MCP_TAIL"; exit $?; }
    exit 0 ;;
  *) : ;;
esac
exit 0
SH
chmod +x "$BIN/claude"
python3 - "$TMP/mcp-tail" <<'PY'
from pathlib import Path
import sys
Path(sys.argv[1]).write_bytes(b"x" * (128 * 1024))  # > the usual 64 KiB pipe buffer
PY
export PATH="$BIN:$PATH"
export FAKE_INSTALL_PATH="$PLANTED"
export FAKE_CLAUDE_LOG="$TMP/fake-claude.log"
: > "$FAKE_CLAUDE_LOG"

# --- 1. REAL assembly via the real installer --------------------------------
if bash "$REPO/scripts/meta-bridge-install.sh" >"$TMP/install.log" 2>&1; then
  ok "real meta-bridge-install.sh assembles under the sandbox XDG (fake claude CLI, real assembly)"
else
  bad "real install-meta-bridge failed in the sandbox:"$'\n'"$(sed 's/^/        install| /' "$TMP/install.log")"$'\n'"$(sed 's/^/        claude| /' "$FAKE_CLAUDE_LOG")"
  echo; echo "check-meta-doctor-oracle: FAIL (see above)"; exit 1
fi

ASM="$XDG_DATA_HOME/entwurf/meta-bridge/.assembled"
# PLANTED cache — the fake CLI cannot materialize Claude's plugin cache, so this gate
# copies the assembled bundle into the cache layout the doctor reads. Stated plainly so
# nobody later reads this gate as proof that `claude plugin install` itself works.
mkdir -p "$PLANTED"
cp -r "$ASM/$PLUGIN/." "$PLANTED/"
ok "plugin cache PLANTED from the assembled bundle (fixture, not a real \`claude plugin install\`): $PLANTED"
cp -r "$PLANTED" "$TMP/pristine-cache"

# --- 2. live owner fixture ---------------------------------------------------
# THIS shell stands in for Claude. Drive the installed owner ARGV the way Claude execs
# an exec-form hook — resolving ${CLAUDE_PLUGIN_ROOT} per element as a plain string,
# with no shell — as a foreground child. hook-launch.sh then `exec`s the payload, so the
# hook's parent is $$ and it keys sender+receiver markers to $$.
mapfile -t HOOK_ARGV < <(python3 -c '
import json, sys
d = json.load(open(sys.argv[1], encoding="utf-8"))
leaf = d["hooks"]["SessionStart"][0]["hooks"][0]
root = sys.argv[2]
print(leaf["command"].replace("${CLAUDE_PLUGIN_ROOT}", root))
for a in leaf["args"]:
    print(a.replace("${CLAUDE_PLUGIN_ROOT}", root))
' "$PLANTED/hooks/hooks.json" "$PLANTED")
printf '%s' '{"session_id":"oracle-native-1","transcript_path":"/tmp/entwurf-oracle-transcript.jsonl","cwd":"/tmp","hook_event_name":"SessionStart","model":{"id":"oracle-model"}}' > "$TMP/hook-input.json"
if env CLAUDE_PLUGIN_ROOT="$PLANTED" "${HOOK_ARGV[@]}" < "$TMP/hook-input.json" > "$TMP/hook-run.txt" 2>&1 \
   && [ -f "$AGENT/meta-senders/claude-code/$$.json" ]; then
  ok "installed owner argv keyed its sender marker to this stand-in Claude pid ($$)"
else
  bad "owner fixture drive failed: $(tr '\n' ' ' < "$TMP/hook-run.txt" | cut -c1-300)"
fi

# Fake live entwurf MCP child of this same stand-in Claude pid. The doctor discovers it
# by env + agent dir, so a UNIQUE sandbox agent dir keeps it from colliding with the
# operator's real bridges in /proc.
env ENTWURF_BRIDGE_REQUIRE_META_SENDER=1 \
    ENTWURF_BRIDGE_EXTERNAL_AGENT_ID=external-mcp/claude-code \
    PI_CODING_AGENT_DIR="$AGENT" \
    sleep 600 &
BRIDGE_PID=$!
ok "fake live entwurf MCP bridge running as a child of the stand-in Claude pid (pid=$BRIDGE_PID, agent-dir isolated)"

# --- doctor driver -----------------------------------------------------------
DOC_OUT=""
DOC_RC=0
run_doctor() {
  set +e
  DOC_OUT="$(bash "$REPO/scripts/meta-bridge-doctor.sh" 2>&1)"
  DOC_RC=$?
  set -e
}
restore_cache() {
  rm -rf "$PLANTED"
  cp -r "$TMP/pristine-cache" "$PLANTED"
}
# A mutation must fail for ITS OWN reason. Asserting only the exit code would let one
# defect's red be credited to another's.
expect_red() {
  local label="$1" needle="$2"
  run_doctor
  if [ "$DOC_RC" -eq 0 ]; then
    bad "mutation '$label' did NOT turn the doctor red (exit 0)"
  elif printf '%s\n' "$DOC_OUT" | grep -qF "$needle"; then
    ok "mutation '$label' → FAIL naming its own cause"
  else
    bad "mutation '$label' turned red for the WRONG reason (want: $needle):"$'\n'"$(printf '%s\n' "$DOC_OUT" | grep -E '^  (FAIL|WARN)' | sed 's/^/        /')"
  fi
}

# --- 3. CONTROL: the healthy fixture must PASS -------------------------------
echo "[control] healthy install"
run_doctor
if [ "$DOC_RC" -eq 0 ] && printf '%s\n' "$DOC_OUT" | grep -q 'meta-bridge doctor: PASS'; then
  ok "healthy fixture reaches doctor PASS (exit 0)"
else
  bad "healthy fixture did NOT reach PASS (exit $DOC_RC):"$'\n'"$(printf '%s\n' "$DOC_OUT" | grep -E '^  (FAIL|WARN)' | sed 's/^/        /')"
fi
for claim in \
  'active cached artifact resolved from plugin installPath' \
  'exec-form launch contract supported' \
  'launch form: exec form through the shipped hook-launch.sh' \
  'FileChanged doorbell matches the shipped static contract exactly' \
  'keys its sender marker to the live host pid' \
  'sender + receiver owner join is live and record-backed'
do
  if printf '%s\n' "$DOC_OUT" | grep -qF "$claim"; then ok "control claim present: $claim"; else bad "control run never made the claim: $claim"; fi
done

# --- 4. MUTATIONS ------------------------------------------------------------
echo "[mutations] each must flip PASS→FAIL for its own reason"

# M1 — reversion to the RETIRED shell form (the `$PPID` carrier manifest this release
# replaced, and the form hejdev6g was hand-patched away from). Must be NAMED, not
# reported as unreadable drift: the operator has to learn the form is retired, not that
# their file is corrupt.
python3 - "$PLANTED/hooks/hooks.json" <<'PY'
import json, sys
p = sys.argv[1]
d = json.load(open(p, encoding="utf-8"))
for event in ("SessionStart", "CwdChanged", "UserPromptSubmit"):
    leaf = d["hooks"][event][0]["hooks"][0]
    node, entry = leaf.pop("args")
    leaf["command"] = f"ENTWURF_META_HOOK_OWNER_PID=$PPID exec {node} {entry}"
json.dump(d, open(p, "w", encoding="utf-8"), indent=2)
PY
expect_red "reverted to the retired shell form" "SHELL FORM, which this release no longer authorizes"
restore_cache

# M2 — partial hand-patch: SessionStart authorized, CwdChanged reverted. THE hole that
# let a one-hook fix look healthy.
python3 - "$PLANTED/hooks/hooks.json" <<'PY'
import json, sys
p = sys.argv[1]
d = json.load(open(p, encoding="utf-8"))
leaf = d["hooks"]["CwdChanged"][0]["hooks"][0]
node, entry = leaf.pop("args")
leaf["command"] = f"{node} {entry}"
json.dump(d, open(p, "w", encoding="utf-8"), indent=2)
PY
expect_red "only SessionStart carries the contract" "owner hooks disagree on launch form"
restore_cache

# M3 — exec form that SKIPS the shipped launcher (`command` = node directly). This is
# the seductive one: it works perfectly on a current Claude, so every runtime signal
# looks healthy — and then on an older Claude it degrades in total silence, because the
# launcher that would have refused an empty argv is not on the path. The doctor must
# refuse the shape, not wait for the host that breaks.
python3 - "$PLANTED/hooks/hooks.json" <<'PY'
import json, sys
p = sys.argv[1]
d = json.load(open(p, encoding="utf-8"))
for event in ("SessionStart", "CwdChanged", "UserPromptSubmit"):
    leaf = d["hooks"][event][0]["hooks"][0]
    node, entry = leaf["args"]
    leaf["command"] = node
    leaf["args"] = [entry]
json.dump(d, open(p, "w", encoding="utf-8"), indent=2)
PY
expect_red "exec form bypassing hook-launch.sh" "do NOT go through the shipped"
restore_cache

# M3a — launcher repointed at an attacker path that still ends in hook-launch.sh. The
# same suffix-vs-equality lesson M4b teaches for the doorbell, on the owner side.
python3 - "$PLANTED/hooks/hooks.json" <<'PY'
import json, sys
p = sys.argv[1]
d = json.load(open(p, encoding="utf-8"))
for event in ("SessionStart", "CwdChanged", "UserPromptSubmit"):
    d["hooks"][event][0]["hooks"][0]["command"] = "/tmp/evil/scripts/hook-launch.sh"
json.dump(d, open(p, "w", encoding="utf-8"), indent=2)
PY
expect_red "launcher repointed at /tmp/evil (suffix still matches)" "do NOT go through the shipped"
restore_cache

# M3f — the INSTALLED launcher stops stamping exec-launch provenance. Nothing about
# the manifest changes, so every static check still passes; what breaks is the thing
# the launcher exists for. Without the token the hook refuses to write sender/receiver
# markers (fail-closed), so the synthetic owner join has nothing to prove itself with.
# This is the upgrade-mismatch defect seen from the doctor's side.
python3 - "$PLANTED/scripts/hook-launch.sh" <<'PY'
import sys
p = sys.argv[1]
s = open(p, encoding="utf-8").read()
s = s.replace('export ENTWURF_META_HOOK_LAUNCH="hook-launch/v1"', ": # provenance removed")
open(p, "w", encoding="utf-8").write(s)
PY
expect_red "installed launcher stopped stamping exec-launch provenance" "failed owner-join execution"
restore_cache

# M3b — `args` present but malformed. Must NOT be excused as the recognized upstream
# exec form: corruption wearing exec form's clothes is still corruption.
python3 - "$PLANTED/hooks/hooks.json" <<'PY'
import json, sys
p = sys.argv[1]
d = json.load(open(p, encoding="utf-8"))
for event in ("SessionStart", "CwdChanged", "UserPromptSubmit"):
    d["hooks"][event][0]["hooks"][0]["args"] = "not-an-array"
json.dump(d, open(p, "w", encoding="utf-8"), indent=2)
PY
expect_red "malformed exec args (string, not array)" "MALFORMED exec-form hook"
restore_cache

# M3c — owner leaf type drift. A `prompt` leaf that still carries a command field used
# to sail through, because only the command string was ever read.
python3 - "$PLANTED/hooks/hooks.json" <<'PY'
import json, sys
p = sys.argv[1]
d = json.load(open(p, encoding="utf-8"))
for event in ("SessionStart", "CwdChanged", "UserPromptSubmit"):
    d["hooks"][event][0]["hooks"][0]["type"] = "prompt"
json.dump(d, open(p, "w", encoding="utf-8"), indent=2)
PY
expect_red "owner leaf type drifted to prompt" "not a usable command hook"
restore_cache

# M3d — an APPENDED owner leaf. Claude runs every leaf; inspecting only leaf[0] would
# certify a manifest with an extra, uninspected command in it.
python3 - "$PLANTED/hooks/hooks.json" <<'PY'
import json, sys
p = sys.argv[1]
d = json.load(open(p, encoding="utf-8"))
d["hooks"]["SessionStart"][0]["hooks"].append({"type": "command", "command": "/tmp/evil.sh"})
json.dump(d, open(p, "w", encoding="utf-8"), indent=2)
PY
expect_red "extra owner hook leaf appended" "expected exactly 1 hook leaf/leaves as shipped"
restore_cache

# M3e — an APPENDED matcher group. Same class one level up.
python3 - "$PLANTED/hooks/hooks.json" <<'PY'
import json, sys
p = sys.argv[1]
d = json.load(open(p, encoding="utf-8"))
d["hooks"]["SessionStart"].append({"matcher": "", "hooks": [{"type": "command", "command": "/tmp/evil.sh"}]})
json.dump(d, open(p, "w", encoding="utf-8"), indent=2)
PY
expect_red "extra matcher group appended" "expected exactly 1 matcher group(s) as shipped"
restore_cache

# M4 — doorbell loses asyncRewake: mail lands, nothing wakes.
python3 - "$PLANTED/hooks/hooks.json" <<'PY'
import json, sys
p = sys.argv[1]
d = json.load(open(p, encoding="utf-8"))
d["hooks"]["FileChanged"][0]["hooks"][0].pop("asyncRewake", None)
json.dump(d, open(p, "w", encoding="utf-8"), indent=2)
PY
expect_red "doorbell lost asyncRewake" "hooks.FileChanged[0].hooks[0].asyncRewake: missing"
restore_cache

# M4b — doorbell repointed at an attacker path that still ENDS in /scripts/doorbell.sh.
# A suffix test passes this; exact equality against the shipped template does not.
python3 - "$PLANTED/hooks/hooks.json" <<'PY'
import json, sys
p = sys.argv[1]
d = json.load(open(p, encoding="utf-8"))
d["hooks"]["FileChanged"][0]["hooks"][0]["command"] = "/tmp/evil/scripts/doorbell.sh"
json.dump(d, open(p, "w", encoding="utf-8"), indent=2)
PY
expect_red "doorbell repointed at /tmp/evil (suffix still matches)" "hooks.FileChanged[0].hooks[0].command"
restore_cache

# M4c — doorbell timeout drift. An "isinstance(int)" test passes 999; the shipped value
# is the contract.
python3 - "$PLANTED/hooks/hooks.json" <<'PY'
import json, sys
p = sys.argv[1]
d = json.load(open(p, encoding="utf-8"))
d["hooks"]["FileChanged"][0]["hooks"][0]["timeout"] = 999
json.dump(d, open(p, "w", encoding="utf-8"), indent=2)
PY
expect_red "doorbell timeout drifted to 999" "hooks.FileChanged[0].hooks[0].timeout: 999"
restore_cache

# M5 — no live bridge. The WARN→exit-0 hole this cut closes: the install is fine, the
# EVIDENCE is missing, and those must read differently.
kill "$BRIDGE_PID" 2>/dev/null || true
wait "$BRIDGE_PID" 2>/dev/null || true
SAVED_BRIDGE="$BRIDGE_PID"
BRIDGE_PID=""
expect_red "no live Claude MCP process" "NOT CERTIFIED — no live Claude entwurf MCP process"
env ENTWURF_BRIDGE_REQUIRE_META_SENDER=1 \
    ENTWURF_BRIDGE_EXTERNAL_AGENT_ID=external-mcp/claude-code \
    PI_CODING_AGENT_DIR="$AGENT" \
    sleep 600 &
BRIDGE_PID=$!
: "$SAVED_BRIDGE"

# M6 — receiver marker stale while sender is fine (a dead-owner watch).
RECV_FILE="$(ls "$AGENT"/meta-receivers/*.json | head -1)"
cp "$RECV_FILE" "$TMP/recv.bak"
python3 - "$RECV_FILE" <<'PY'
import json, sys
p = sys.argv[1]
d = json.load(open(p, encoding="utf-8"))
d["ownerStartKey"] = "linux:1"
json.dump(d, open(p, "w", encoding="utf-8"))
PY
expect_red "receiver marker stale" "receiver marker for"
cp "$TMP/recv.bak" "$RECV_FILE"

# M7 — ambiguous cache with no installPath authority. The doctor must refuse to guess,
# because lexicographic-first is the OLD version after any bump.
# (export/unset explicitly: whether an env prefix on a FUNCTION call persists afterwards
# differs between bash modes, and a leaked flag would silently weaken every later case.)
mkdir -p "$CACHE_DIR/0.2.0"
cp -r "$TMP/pristine-cache/." "$CACHE_DIR/0.2.0/"
export FAKE_NO_INSTALL_PATH=1
expect_red "two cache versions, installPath unavailable" "cannot tell which artifact Claude loads"
rm -rf "$CACHE_DIR/0.2.0"

# M8a — installPath authority still names a directory, but the artifact is gone. The
# doctor must judge the path Claude loads, not fall back to a luckier one.
unset FAKE_NO_INSTALL_PATH
mv "$PLANTED" "$TMP/cache-away"
expect_red "artifact removed while installPath still names it" "the cached artifact Claude loads has no hooks/hooks.json"

# M8b — same missing artifact, but with no installPath field either: nothing at all is
# on disk and no authority points anywhere.
export FAKE_NO_INSTALL_PATH=1
expect_red "no artifact and no installPath authority" "no cached plugin artifact"
unset FAKE_NO_INSTALL_PATH
mv "$TMP/cache-away" "$PLANTED"

# M9 — hook log gone: both log-backed assertions silently vanish.
mv "$AGENT/meta-bridge-hook.log" "$TMP/hook-log.bak"
expect_red "hook log absent" "NOT CERTIFIED — no hook log"
mv "$TMP/hook-log.bak" "$AGENT/meta-bridge-hook.log"

# M10 — deployed writer bundle missing: staleness becomes unknowable.
mv "$PLANTED/lib/meta-session.ts" "$TMP/meta-session.bak"
expect_red "installed writer bundle missing" "deployed writer version is UNKNOWN"
mv "$TMP/meta-session.bak" "$PLANTED/lib/meta-session.ts"

# M11 — a FAILING `claude mcp get` whose output still matches. `|| true` would have
# read this as a healthy USER-scope reach; rc must survive the capture.
export FAKE_MCP_RC=3
expect_red "mcp get exits nonzero with matching output" "'claude mcp get entwurf-bridge' failed from /tmp (exit 3)"
unset FAKE_MCP_RC

# M12 — no --json surface AND `claude plugin list` fails. Plugin state is UNKNOWN, and
# unknown must not be spelled the same as "not installed".
export FAKE_NO_JSON=1 FAKE_PLUGIN_LIST_RC=4
expect_red "plugin list fails with no --json surface" "'claude plugin list' failed (exit 4)"
unset FAKE_NO_JSON FAKE_PLUGIN_LIST_RC

# M13 (positive) — the SIGPIPE fix itself. A CLI that keeps writing long past the pipe
# buffer must NOT be turned into a false negative. Deterministic: the tail is 128 KiB.
export FAKE_MCP_TAIL="$TMP/mcp-tail"
run_doctor
if [ "$DOC_RC" -eq 0 ]; then
  ok "long-writing \`claude mcp get\` (128 KiB tail) still reads as reachable — no SIGPIPE false negative"
else
  bad "a long-writing CLI probe turned the doctor red (SIGPIPE false negative is back):"$'\n'"$(printf '%s\n' "$DOC_OUT" | grep -E '^  FAIL' | sed 's/^/        /')"
fi
unset FAKE_MCP_TAIL

# --- 5. the control must still hold after every restore ----------------------
echo "[control] re-run after all mutations were reverted"
run_doctor
if [ "$DOC_RC" -eq 0 ]; then
  ok "doctor returns to PASS once every planted defect is reverted (mutations were the cause, not drift)"
else
  bad "doctor stayed red after reverting every mutation (a restore is incomplete):"$'\n'"$(printf '%s\n' "$DOC_OUT" | grep -E '^  FAIL' | sed 's/^/        /')"
fi

echo
if [ "$fail" -eq 0 ]; then echo "check-meta-doctor-oracle: PASS"; else echo "check-meta-doctor-oracle: FAIL (see above)"; exit 1; fi
