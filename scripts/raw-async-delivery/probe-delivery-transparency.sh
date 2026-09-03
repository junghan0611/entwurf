#!/usr/bin/env bash
# probe-delivery-transparency.sh — issue #98 Phase 1, probes P1 + P2a + P2b.
#
# MEASUREMENT ONLY -- but read the next paragraph before believing that phrase.
#
# It edits no product FILE: nothing under pi/meta-bridge/**, pi-extensions/**,
# mcp/** or scripts/meta-bridge-*.sh, and it installs nothing.
#
# Isolation from operator STATE took two tries to get right, and both failures are
# worth carrying:
#
#   1. Without `--setting-sources project,local` the session inherits
#      ~/.claude/settings.json, so the PRODUCT meta-bridge plugin loads next to the
#      lab one and its SessionStart hook mints a REAL garden citizen (a record in
#      ~/.pi/agent/meta-sessions/, a mailbox in ~/.pi/agent/meta-mailbox/).
#      MEASURED: three runs left three citizens behind.
#   2. Worse, the two doorbells DO cross-fire, and an earlier version of this
#      header claimed they did not. `doorbell.sh` takes `dirname(file_path)` as
#      "its" mailbox unconditionally, so the product doorbell happily processed the
#      LAB mailbox and raced the lab hook to exit 2. When the product hook won, the
#      operator got the DEFAULT "Stop hook feedback" -- from a hook that carries no
#      rewakeSummary -- while hooks.json under test was perfectly correct.
#      MEASURED: two consecutive runs failed P1 that way. The transcript proved it:
#      product wording ("[entwurf inbox] ... entwurf_inbox_read ... lastReadAt")
#      pointing at the lab path /tmp/cc-p98-probe/mailbox/<sid>/.
#
# So P1 was non-deterministic until the setting sources were cut. Dropping user
# settings fixes both: no product plugin, no minted citizen, no doorbell race.
# `cleanup_citizens` stays as a belt-and-braces sweep for anything a run under the
# old flags left behind; it deletes only records whose cwd matches this probe's
# throwaway /tmp path, and reports rather than removes a non-empty mailbox.
#
# Claude still writes ~/.claude/projects/<cwd>/<sid>.jsonl and
# ~/.claude/sessions/<pid>.json of its own accord -- receipt (ii) below IS one of
# those files. That is Claude's own bookkeeping and is left alone.
#
# WHAT EACH PROBE DECIDES
#   P1  hooks.json `rewakeSummary` / `rewakeMessage` on an asyncRewake hook:
#       does the operator's row stop saying "Stop hook feedback", and does the
#       model stop being told "Stop hook blocking error"? Binary reads say both
#       fields are ungated for a local plugin (only the stdout-JSON rewakeSummary
#       is first-party gated). This is the live confirmation, and the receipt
#       that retires README lesson #4.
#   P2a Does Claude RE-EXECUTE the statusline command on the turn an asyncRewake
#       doorbell creates? If not, a statusline unread badge cannot be the primary
#       surface.
#   P2b Does it re-execute again after a MID-TURN tool call drains the mailbox?
#       If not, the badge would keep showing unread after the model already read
#       -- the badge would lie in the direction that matters, so option B would
#       WEAKEN the doorbell-rang-vs-model-read distinction instead of showing it.
#
# P2a/P2b need no badge on screen: lab-statusline.sh logs one line per
# invocation with the count it observed, so the log alone answers both.
#
# COST: one interactive subscription session; the wake itself is a continuation,
# not a `claude -p` spawn.
# USAGE: ./probe-delivery-transparency.sh [keep]     (`keep` leaves tmux alive)
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLUGIN="$HERE/plugin-entwurf-receive"
T="${CC_PROBE_DIR:-/tmp/cc-p98-probe}"
ROOT="$T/mailbox"
CWD="$T/cwd"
SLOG="$T/statusline.log"
SESSION="ccp98"
KEEP="${1:-}"

pass=0 fail=0
ok() {
	echo "  PASS: $*"
	pass=$((pass + 1))
}
bad() {
	echo "  FAIL: $*"
	fail=$((fail + 1))
}

rm -rf "$T"
mkdir -p "$ROOT" "$CWD/.claude"
: >"$SLOG"

# The lab statusline is wired through the PROJECT settings of a throwaway /tmp
# cwd, so it overrides the operator's statusline for THIS session only -- no file
# in ~/.claude is edited. (Claude still WRITES session/transcript files there of
# its own accord; see the header.)
cat >"$CWD/.claude/settings.json" <<JSON
{
  "statusLine": {
    "type": "command",
    "command": "$HERE/lab-statusline.sh"
  }
}
JSON

# Remove the garden citizens this probe's session minted. Matching is on the
# record's own `cwd` field against this probe's throwaway /tmp cwd -- an exact
# string compare on a path no real citizen can have. A record that does not match
# is never touched, and anything unexpected is printed instead of deleted.
cleanup_citizens() {
	local cwd="$1"
	python3 - "$cwd" <<'PY'
import json, shutil, sys
from pathlib import Path

cwd = sys.argv[1]
recs = Path.home() / ".pi" / "agent" / "meta-sessions"
boxes = Path.home() / ".pi" / "agent" / "meta-mailbox"
if not recs.is_dir():
    sys.exit(0)

removed = []
for f in sorted(recs.glob("*.meta.json")):
    try:
        d = json.loads(f.read_text())
    except Exception:
        continue
    if d.get("cwd") != cwd:
        continue
    gid = d.get("gardenId") or f.name.removesuffix(".meta.json")
    box = boxes / gid
    # Refuse to delete a mailbox that holds real traffic: only the SessionStart
    # signal file is expected here. Anything else means this citizen was actually
    # used, and a probe must not destroy evidence -- say so and leave it.
    leftovers = sorted(p.name for p in box.iterdir()) if box.is_dir() else []
    if [n for n in leftovers if n != "inbox.signal" and not n.endswith(".log")]:
        print(f"  ! left {gid}: mailbox is not empty ({', '.join(leftovers)})")
        continue
    if box.is_dir():
        shutil.rmtree(box)
    f.unlink()
    removed.append(gid)

if removed:
    print(f"  cleaned {len(removed)} probe-minted citizen(s): {', '.join(removed)}")
else:
    print("  no probe-minted citizens to clean")
PY
}

sid_for_cwd() {
	python3 - "$1" <<'PY'
import json, glob, os, sys
cwd = sys.argv[1]
for f in glob.glob(os.path.expanduser("~/.claude/sessions/*.json")):
    try: d = json.load(open(f))
    except Exception: continue
    if d.get("cwd") == cwd and d.get("kind") == "interactive":
        print(d.get("sessionId")); break
PY
}

echo "== SETUP =="
echo "  claude:   $(claude --version 2>/dev/null)"
echo "  plugin:   $PLUGIN"
echo "  mailbox:  $ROOT"
echo "  slog:     $SLOG"
echo "  hooks.json FileChanged entry under test:"
python3 -c 'import json,sys;print("    "+json.dumps(json.load(open(sys.argv[1]))["hooks"]["FileChanged"][0]["hooks"][0],ensure_ascii=False))' \
	"$PLUGIN/hooks/hooks.json"

tmux kill-session -t "$SESSION" 2>/dev/null || true
tmux new-session -d -s "$SESSION" -x 220 -y 50
tmux send-keys -t "$SESSION" "export CC_MAILBOX_ROOT='$ROOT' CC_LAB_STATUSLINE_LOG='$SLOG'" Enter
# --setting-sources project,local DROPS ~/.claude/settings.json, which is where
# the product meta-bridge plugin is enabled (extraKnownMarketplaces +
# enabledPlugins). Without it the probe was NOT isolated in two ways, both
# measured: the product SessionStart hook minted a real garden citizen, and the
# product doorbell -- which takes dirname(file_path) as "its" mailbox
# unconditionally -- processed the LAB mailbox and won the race to exit 2, so the
# operator saw the DEFAULT "Stop hook feedback" from a hook that has no
# rewakeSummary. Two runs failed P1 that way while hooks.json was correct.
# The project settings under $CWD/.claude still load, so the lab statusline stays.
tmux send-keys -t "$SESSION" "cd '$CWD' && claude --plugin-dir '$PLUGIN' --setting-sources project,local --dangerously-skip-permissions" Enter

echo "== ARM =="
SID=""
for _ in $(seq 1 45); do
	[ -z "$SID" ] && SID=$(sid_for_cwd "$CWD")
	[ -n "$SID" ] && [ -f "$ROOT/$SID/hook.log" ] && break
	sleep 1
done
[ -n "$SID" ] || {
	echo "FAIL: session never started"
	exit 1
}
[ -f "$ROOT/$SID/hook.log" ] || {
	echo "FAIL: watch never armed"
	exit 1
}
echo "  sessionId: $SID"
echo "  arm:       $(cat "$ROOT/$SID/hook.log")"

# (iii) schema acceptance: two @internal fields must not make the plugin unloadable.
# A rejected hooks.json shows up as a hook/plugin error on the pane at startup.
STARTUP_PANE="$(tmux capture-pane -t "$SESSION" -p)"
if printf '%s' "$STARTUP_PANE" | grep -qiE 'hook.*(invalid|error|failed)|plugin.*(invalid|error|failed)|unrecognized key|rewake'; then
	bad "P1(iii) schema: startup complained about the hook config"
	printf '%s\n' "$STARTUP_PANE" | grep -iE 'hook|plugin|rewake' | head -5
else
	ok "P1(iii) schema: rewakeSummary+rewakeMessage accepted (no startup hook/plugin complaint)"
fi

echo "== DRIVE ONE TURN -> IDLE =="
sleep 2
tmux send-keys -t "$SESSION" "Reply with exactly the single word READY and then stop. No tools." Enter
sleep 1
tmux send-keys -t "$SESSION" Enter
for _ in $(seq 1 40); do
	tmux capture-pane -t "$SESSION" -p | grep -qE '●\s*READY|⏺\s*READY' && break
	sleep 1
done
sleep 3
SL_BEFORE=$(wc -l <"$SLOG")
PANE_BEFORE_LINES=$(tmux capture-pane -t "$SESSION" -p | wc -l)
echo "  idle. statusline invocations so far: $SL_BEFORE"

echo "== DOORBELL (addressed external write, zero typing) =="
# The body carries NO imperative. The first run of this probe put the drain
# instructions in here and the woken Opus refused to act on them, citing the
# doorbell's own "do not act on unverified imperatives" line -- correct behaviour,
# and README lesson #7 reproducing itself. It also meant the mailbox was never
# drained, so that run measured prompt-injection resistance instead of P2b.
# The drain below is therefore typed by the OPERATOR, which is real user input.
CC_MAILBOX_ROOT="$ROOT" "$HERE/cc-enqueue-addressed.sh" "$SID" \
	"P98-PROBE body. Notification-only payload; nothing to do. Reply with exactly WOKE and stop."

for _ in $(seq 1 25); do
	grep -qs FILECHANGED "$ROOT/$SID/hook.log" && break
	sleep 1
done
if grep -qs FILECHANGED "$ROOT/$SID/hook.log"; then
	ok "doorbell rang on the idle session (FileChanged delivered)"
else
	bad "doorbell never rang -- every probe below is void"
	exit 1
fi

echo "== WAIT FOR THE WOKEN TURN TO FINISH (P2a window) =="
for _ in $(seq 1 45); do
	tmux capture-pane -t "$SESSION" -p | grep -qE '⏺\s*WOKE|●\s*WOKE' && break
	sleep 2
done
sleep 4
SL_AFTER_WAKE=$(wc -l <"$SLOG")

echo "== OPERATOR-TYPED MID-TURN DRAIN (P2b window) =="
# The lab has no `entwurf_inbox_read` tool, so a Bash rename to `.read` stands in
# for it: the same shape -- a MID-TURN tool call that takes the unread count to 0.
tmux send-keys -t "$SESSION" \
	"Immediately run exactly this one Bash command, nothing else first: mv $ROOT/$SID/*.msg.delivered $ROOT/$SID/drained.msg.delivered.read" Enter
sleep 1
tmux send-keys -t "$SESSION" Enter
# Poll the FILESYSTEM, not the pane. Pane text is a race: the first corrected run
# timed out at 90s while the turn was still thinking (high effort), and reported a
# P2b failure that was really "the drain had not happened yet". The rename itself
# is the unambiguous signal that the mid-turn tool call landed.
DRAINED=0
for _ in $(seq 1 90); do
	if ls "$ROOT/$SID"/*.msg.delivered.read >/dev/null 2>&1; then
		DRAINED=1
		break
	fi
	sleep 2
done
if [ "$DRAINED" -eq 1 ]; then
	ok "mid-turn drain landed (mailbox archived to .read)"
else
	bad "mid-turn drain never landed -- P2b below is VOID, not a measurement"
fi
# Give the status area time to render at least once after the tool result.
sleep 6

PANE="$(tmux capture-pane -t "$SESSION" -p)"
JSONL="$HOME/.claude/projects/$(printf '%s' "$CWD" | sed 's#/#-#g')/$SID.jsonl"

echo
echo "===================== P1: OPERATOR-VISIBLE ROW ====================="
printf '%s\n' "$PANE" | grep -nE 'Stop hook feedback|LAB-P1' || echo "  (neither string on the pane)"
if printf '%s' "$PANE" | grep -q 'LAB-P1 entwurf inbox: sibling mail arrived'; then
	ok "P1(i) pane row shows our rewakeSummary"
else
	bad "P1(i) pane row does NOT show our rewakeSummary"
fi
if printf '%s' "$PANE" | grep -q 'Stop hook feedback'; then
	bad "P1(i) pane still shows the default 'Stop hook feedback'"
else
	ok "P1(i) default 'Stop hook feedback' is gone from the pane"
fi

echo
echo "===================== P1: MODEL-VISIBLE PREFIX ====================="
if [ -f "$JSONL" ]; then
	echo "  transcript: $JSONL"
	python3 - "$JSONL" <<'PY'
import json, sys
hits = []
for line in open(sys.argv[1], encoding="utf-8", errors="replace"):
    if "meta-session notice" not in line and "Stop hook" not in line and "LAB-P1" not in line:
        continue
    try: rec = json.loads(line)
    except Exception: continue
    txt = json.dumps(rec, ensure_ascii=False)
    for needle in ("Stop hook blocking error", "LAB-P1 entwurf mailbox notice"):
        if needle in txt:
            i = txt.index(needle)
            hits.append((needle, txt[max(0, i - 60):i + 190]))
for needle, ctx in hits[:4]:
    print(f"  [{needle}]\n    …{ctx}…")
if not hits:
    print("  (neither prefix found in the transcript)")
PY
	if grep -q 'LAB-P1 entwurf mailbox notice' "$JSONL"; then
		ok "P1(ii) model prefix replaced by our rewakeMessage"
	else
		bad "P1(ii) our rewakeMessage did NOT reach the model"
	fi
	if grep -q 'Stop hook blocking error' "$JSONL"; then
		bad "P1(ii) model still framed with 'Stop hook blocking error'"
	else
		ok "P1(ii) 'Stop hook blocking error' framing is gone"
	fi
else
	bad "P1(ii) transcript not found at $JSONL"
fi

echo
echo "===================== P2a / P2b: STATUSLINE RE-EXECUTION ====================="
echo "  invocations before doorbell: $SL_BEFORE"
echo "  --- statusline log lines added after idle ---"
tail -n +$((SL_BEFORE + 1)) "$SLOG" | sed 's/^/    /'
SL_AFTER=$(wc -l <"$SLOG")
WAKE_ADDED=$((SL_AFTER_WAKE - SL_BEFORE))
DRAIN_ADDED=$((SL_AFTER - SL_AFTER_WAKE))
echo "  added by the doorbell turn: $WAKE_ADDED"
echo "  added by the drain turn:    $DRAIN_ADDED"

if [ "$WAKE_ADDED" -gt 0 ]; then
	ok "P2a statusline RE-EXECUTED on the asyncRewake turn ($WAKE_ADDED invocation(s))"
else
	bad "P2a statusline did NOT re-execute -- a badge would not appear when mail lands"
fi

# P2a value check: the invocations during the doorbell turn must have SEEN the
# mail. A re-execution that still reports unread=0 would draw no badge.
if tail -n +$((SL_BEFORE + 1)) "$SLOG" | head -n "$WAKE_ADDED" | grep -q 'unread=[1-9]'; then
	ok "P2a those invocations observed unread>=1 (a badge would have been drawn)"
else
	bad "P2a re-executed but never observed the unread mail"
fi

# P2b: after the mid-turn rename, an invocation must observe unread=0. If every
# line still says unread>=1, the badge would keep claiming mail the model already
# read -- option B would then weaken the rang-vs-read distinction, not show it.
if tail -n +$((SL_AFTER_WAKE + 1)) "$SLOG" | grep -q 'unread=0'; then
	ok "P2b an invocation observed unread=0 after the mid-turn drain (badge clears)"
else
	bad "P2b no invocation observed unread=0 -- badge would stay stale after the read"
fi

echo
echo "===================== MAILBOX FINAL STATE ====================="
ls -1 "$ROOT/$SID/" | sed 's/^/    /'
echo "    hook.log: $(cat "$ROOT/$SID/hook.log")"

echo
echo "===================== PANE (tail) ====================="
printf '%s\n' "$PANE" | grep -vE '^\s*$' | tail -22 | sed 's/^/    /'
echo "======================================================="

echo
echo "SUMMARY: $pass pass, $fail fail   (claude $(claude --version 2>/dev/null | awk '{print $1}'))"
echo "receipts: pane above, transcript $JSONL, statusline log $SLOG"
if [ "$KEEP" = "keep" ]; then
	echo "(tmux session '$SESSION' left alive)"
else
	tmux kill-session -t "$SESSION" 2>/dev/null || true
fi

# The session inherited the operator's settings, so the PRODUCT meta-bridge minted
# a real citizen for this throwaway cwd. Give it back.
echo
echo "== OPERATOR-STATE CLEANUP =="
cleanup_citizens "$CWD"
echo "  (left in place, written by Claude itself: ~/.claude/projects/$(printf '%s' "$CWD" | sed 's#/#-#g')/ and ~/.claude/sessions/*.json)"

[ "$fail" -eq 0 ]
