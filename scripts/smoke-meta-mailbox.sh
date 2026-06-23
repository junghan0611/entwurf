#!/usr/bin/env bash
# smoke-meta-mailbox — deterministic E2E for the meta-bridge mailbox messaging
# axis (0.10.0 defense C). The native-Claude meta-session async path is:
#
#   entwurf_send → (no live control socket) → meta-mailbox enqueue + signal poke
#   → receiver entwurf_inbox_read → .read archive + lastReadAt receipt
#
# The lib pieces (enqueueMetaMessage / readMetaInbox / markRead) are unit-covered
# by check-meta-session. THIS gate exercises the MCP HANDLER round-trip end to
# end: the entwurf_send fallback branch, the sender-envelope serialization into
# the mailbox body, and entwurf_inbox_read draining + stamping the receipt — with
# ZERO Claude turns. A synthetic meta-record plus an EMPTY PI_ENTWURF_DIR forces
# socket resolution to fail, so every send falls through to the mailbox; no
# backend, no tokens.
#
# Each tool/call runs in its OWN fresh server invocation: the MCP server processes
# a stdin batch concurrently, so an enqueue and a read in one batch would race
# (read sees an empty box, the .msg lands after). Separate invocations make the
# filesystem the source of truth between steps. Deps: bash + node + python3.
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/.." && pwd)"
START="$REPO/mcp/entwurf-bridge/start.sh"
LIB="$REPO/pi-extensions/lib/meta-session.ts"

command -v node >/dev/null || { echo "FAIL: node not on PATH"; exit 1; }
command -v python3 >/dev/null || { echo "FAIL: python3 not on PATH"; exit 1; }

# External sender is the DEFAULT for this gate; the replyable case sets the env
# inline. Unset here so a launch from inside a live pi session can't flip it.
unset PI_AGENT_ID PI_SESSION_ID 2>/dev/null || true

fail=0
ok()  { echo "  ok    $*"; }
bad() { echo "  FAIL  $*"; fail=1; }

TMP="$(mktemp -d -t psa-meta-mailbox.XXXXXX)"
cleanup() { rm -rf "$TMP"; }
trap cleanup EXIT

# Full env isolation (GPT힣 condition 1): private store + mailbox + a control dir
# that holds NO target socket, so the live-socket branch can never resolve for a
# TARGET and the mailbox fallback is forced. (Case A later drops the SENDER's own
# socket here so it is honestly replyable per SE-1 — that does not resolve a target.)
export PI_META_SESSIONS_DIR="$TMP/meta-sessions"
export PI_META_MAILBOX_DIR="$TMP/meta-mailbox"
export PI_META_SENDERS_DIR="$TMP/meta-senders"   # empty → external case never reads a real sender marker
export PI_META_RECEIVERS_DIR="$TMP/meta-receivers"   # SE-2: targets need an active receiver marker to be deliverable
export PI_ENTWURF_DIR="$TMP/entwurf-control"
mkdir -p "$PI_META_SESSIONS_DIR" "$PI_META_MAILBOX_DIR" "$PI_META_SENDERS_DIR" "$PI_META_RECEIVERS_DIR" "$PI_ENTWURF_DIR"

# Three synthetic native-Claude meta-records: a/b get an ACTIVE receiver marker
# (deliverable), c gets a record but NO marker (SE-2: record exists, receiver gone →
# must reject + enqueue nothing). The receiver marker owner is THIS bash ($$), which
# stays alive for the whole smoke, so readMetaReceiverMarker's start-key guard passes.
cat > "$TMP/gen.mjs" <<'JS'
const [libPath, store, receiversDir, ownerPid] = process.argv.slice(2);
const fs = await import("node:fs");
const path = await import("node:path");
const { mintMetaRecord, serializeMetaRecord, writeMetaReceiverMarker } = await import(libPath);
const mk = (nid, active) => {
  const r = mintMetaRecord({ backend: "claude-code", nativeSessionId: nid, transcriptPath: "/tmp/t.jsonl", cwd: "/tmp" });
  fs.writeFileSync(path.join(store, r.gardenId + ".meta.json"), serializeMetaRecord(r));
  if (active) {
    writeMetaReceiverMarker({ gardenId: r.gardenId, backend: "claude-code", nativeSessionId: nid, ownerPid: Number(ownerPid), armProvenance: "session-start", receiversDir });
  }
  return r.gardenId;
};
console.log(JSON.stringify({ a: mk("n-mailbox-a", true), b: mk("n-mailbox-b", true), c: mk("n-mailbox-c", false), d: mk("n-mailbox-d", true) }));
JS
IDS="$(node --experimental-strip-types "$TMP/gen.mjs" "$LIB" "$PI_META_SESSIONS_DIR" "$PI_META_RECEIVERS_DIR" "$$")"
GARDEN_C="$(node -e 'process.stdout.write(JSON.parse(process.argv[1]).c)' "$IDS")"
GARDEN_A="$(node -e 'process.stdout.write(JSON.parse(process.argv[1]).a)' "$IDS")"
GARDEN_B="$(node -e 'process.stdout.write(JSON.parse(process.argv[1]).b)' "$IDS")"
GARDEN_D="$(node -e 'process.stdout.write(JSON.parse(process.argv[1]).d)' "$IDS")"

INIT='{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"smoke","version":"0"}}}'
INITED='{"jsonrpc":"2.0","method":"notifications/initialized"}'

# srv ID CALLJSON — run one tool/call in a fresh server; echo that id's response.
# PI_AGENT_ID/PI_SESSION_ID (replyable) inherit from the caller's env prefix.
srv() {
  local id="$1" call="$2"
  {
    printf '%s\n' "$INIT"
    printf '%s\n' "$INITED"
    printf '%s\n' "$call"
    sleep 0.6
  } | timeout 20 "$START" 2>/dev/null | grep "\"id\":$id" || true
}

sendcall() { # id gardenId message wants_reply
  printf '{"jsonrpc":"2.0","id":%s,"method":"tools/call","params":{"name":"entwurf_send","arguments":{"sessionId":"%s","message":"%s","wants_reply":%s}}}' "$1" "$2" "$3" "$4"
}
readcall() { # id gardenId
  printf '{"jsonrpc":"2.0","id":%s,"method":"tools/call","params":{"name":"entwurf_inbox_read","arguments":{"gardenId":"%s"}}}' "$1" "$2"
}

# ---------------------------------------------------------------------------
# Case A — REPLYABLE sender: a pi session WITH a live control socket of its own.
# SE-1: replyability is a FACT, not env presence. A pi session with PI_SESSION_ID
# but NO --entwurf-control socket is NOT replyable (a reply could never reach it).
# What makes THIS sender honestly replyable is its OWN control socket existing; the
# TARGET (GARDEN_A) still has no socket, so the send still falls through to the
# mailbox. (buildStrictPiSenderEnvelope existsSync-probes the sender's canonical
# socket — a plain file satisfies that gate for this hermetic smoke.)
SENDER_PI_ID="20260606T120000-aaaaaa"
: > "$PI_ENTWURF_DIR/$SENDER_PI_ID.sock"   # the sender's own control socket (bridge SOCKET_SUFFIX=.sock)
# Pin the fallback precondition: the TARGET has no socket, so the send cannot take
# the live-socket branch and MUST fall through to the mailbox. (Without this the
# sender-socket touch above could be misread as also satisfying the target.)
[ ! -e "$PI_ENTWURF_DIR/$GARDEN_A.sock" ] && ok "target has no control socket (mailbox fallback forced)" || bad "target socket unexpectedly present — fallback not forced"
A_SEND=$(PI_AGENT_ID="entwurf/claude-sonnet-4-6" PI_SESSION_ID="$SENDER_PI_ID" \
  srv 10 "$(sendcall 10 "$GARDEN_A" "MAILBOX_SMOKE_A payload" true)")
A_READ=$(srv 11 "$(readcall 11 "$GARDEN_A")")
A_READ2=$(srv 12 "$(readcall 12 "$GARDEN_A")")

if echo "$A_SEND" | grep -q '"isError":true'; then bad "replyable send errored: ${A_SEND:0:200}"; else ok "replyable send succeeds (no isError)"; fi
echo "$A_SEND" | grep -q 'meta-bridge mailbox' && ok "send takes the meta-mailbox fallback (no live socket)" || bad "send did not report mailbox fallback: ${A_SEND:0:200}"
echo "$A_SEND" | grep -q '(wants reply)' && ok "replyable send carries the wants-reply badge" || bad "wants-reply badge missing on send"
echo "$A_READ" | grep -q 'MAILBOX_SMOKE_A payload' && ok "inbox_read returns the message body" || bad "inbox_read missing message body: ${A_READ:0:200}"
echo "$A_READ" | grep -q 'reply with entwurf_send to this sessionId' && ok "envelope round-trip: replyable sender preserved" || bad "replyable envelope not preserved: ${A_READ:0:200}"
echo "$A_READ" | grep -q 'wants reply: yes' && ok "envelope round-trip: wants_reply=yes preserved" || bad "wants_reply not preserved in body"
echo "$A_READ" | grep -q 'lastReadAt=' && ok "inbox_read stamps a read receipt (lastReadAt)" || bad "inbox_read did not report lastReadAt"
echo "$A_READ2" | grep -qi 'empty' && ok "re-read is empty (drain + archive, no double-return)" || bad "re-read was not empty: ${A_READ2:0:200}"

# Receipt + archive on disk (servers have exited). 3D-4: the read receipt lives in
# the mailbox state store (<mailbox>/<gardenId>/state.json), NOT record.delivery
# (the v2 record carries no delivery).
LRA="$(python3 -c "import json,sys; d=json.load(open(sys.argv[1])); print(d['lastReadAt'])" "$PI_META_MAILBOX_DIR/$GARDEN_A/state.json")"
[ "$LRA" != "None" ] && [ -n "$LRA" ] && ok "mailbox-state lastReadAt persisted ($LRA)" || bad "mailbox-state lastReadAt not persisted (got '$LRA')"
ls "$PI_META_MAILBOX_DIR/$GARDEN_A"/*.read >/dev/null 2>&1 && ok "message archived as .read" || bad "no .read archive in mailbox"
if ls "$PI_META_MAILBOX_DIR/$GARDEN_A"/*.msg >/dev/null 2>&1; then bad "unread .msg still present after read"; else ok "no unread .msg remains after read"; fi

# ---------------------------------------------------------------------------
# Case D — MULTI-MESSAGE BACKLOG: two separate sends before one read.
# This is the operator-facing regression from 2026-06-15: a sender may split a
# long review into two entwurf_send calls, but the receiver must be able to drain
# BOTH bodies in one entwurf_inbox_read, in order, with one read receipt. This is
# the MCP-surface companion to check-meta-session's lower-level D8 drain proof and
# smoke-meta-honesty's doorbell-count proof.
# ---------------------------------------------------------------------------
D_SEND1=$(PI_AGENT_ID="entwurf/claude-sonnet-4-6" PI_SESSION_ID="$SENDER_PI_ID" \
  srv 30 "$(sendcall 30 "$GARDEN_D" "MAILBOX_SMOKE_D part 1" false)")
D_SEND2=$(PI_AGENT_ID="entwurf/claude-sonnet-4-6" PI_SESSION_ID="$SENDER_PI_ID" \
  srv 31 "$(sendcall 31 "$GARDEN_D" "MAILBOX_SMOKE_D part 2" false)")
D_READ=$(srv 32 "$(readcall 32 "$GARDEN_D")")
D_READ2=$(srv 33 "$(readcall 33 "$GARDEN_D")")

if echo "$D_SEND1" | grep -q 'meta-bridge mailbox' && echo "$D_SEND2" | grep -q 'meta-bridge mailbox'; then
  ok "two separate sends enqueue to the same mailbox backlog"
else
  bad "multi-message sends did not both enqueue: send1=${D_SEND1:0:160} send2=${D_SEND2:0:160}"
fi
echo "$D_READ" | grep -q 'messages: 2' && ok "one inbox_read reports the two-message backlog" || bad "multi-message read did not report messages:2: ${D_READ:0:240}"
echo "$D_READ" | grep -q 'MAILBOX_SMOKE_D part 1' && ok "multi-message read includes part 1" || bad "multi-message read missing part 1"
echo "$D_READ" | grep -q 'MAILBOX_SMOKE_D part 2' && ok "multi-message read includes part 2" || bad "multi-message read missing part 2"
D_POS1=$(printf '%s' "$D_READ" | python3 -c 'import sys; s=sys.stdin.read(); print(s.find("MAILBOX_SMOKE_D part 1"))')
D_POS2=$(printf '%s' "$D_READ" | python3 -c 'import sys; s=sys.stdin.read(); print(s.find("MAILBOX_SMOKE_D part 2"))')
if [ "$D_POS1" -ge 0 ] && [ "$D_POS2" -gt "$D_POS1" ]; then
  ok "multi-message read preserves enqueue order"
else
  bad "multi-message read order drifted (part1=$D_POS1 part2=$D_POS2)"
fi
echo "$D_READ" | grep -q 'lastReadAt=' && ok "multi-message read stamps a single read receipt" || bad "multi-message read did not report lastReadAt"
D_READ_COUNT=$(find "$PI_META_MAILBOX_DIR/$GARDEN_D" -maxdepth 1 -name '*.read' | wc -l | tr -d ' ')
[ "$D_READ_COUNT" = "2" ] && ok "multi-message read archives both bodies as .read" || bad "expected 2 .read archives, got $D_READ_COUNT"
echo "$D_READ2" | grep -qi 'empty' && ok "multi-message re-read is empty" || bad "multi-message re-read was not empty: ${D_READ2:0:200}"

# ---------------------------------------------------------------------------
# Case B — EXTERNAL sender (no PI_SESSION_ID / PI_AGENT_ID).
# ---------------------------------------------------------------------------
B_SEND=$(srv 20 "$(sendcall 20 "$GARDEN_B" "MAILBOX_SMOKE_B payload" false)")
B_READ=$(srv 21 "$(readcall 21 "$GARDEN_B")")
B_REJECT=$(srv 22 "$(sendcall 22 "$GARDEN_B" "x" true)")

if echo "$B_SEND" | grep -q '"isError":true'; then bad "external send (wants_reply=false) errored: ${B_SEND:0:200}"; else ok "external send (wants_reply=false) enqueues"; fi
echo "$B_READ" | grep -q 'external, non-replyable' && ok "envelope round-trip: external sender marked non-replyable" || bad "external envelope not marked: ${B_READ:0:200}"
echo "$B_READ" | grep -q 'wants reply: no' && ok "envelope round-trip: wants_reply=no preserved" || bad "wants_reply=no not preserved"
echo "$B_READ" | grep -q 'MAILBOX_SMOKE_B payload' && ok "external message body delivered" || bad "external message body missing"
if echo "$B_REJECT" | grep -q '"isError":true' && echo "$B_REJECT" | grep -q 'wants_reply=true requires a replyable'; then
  ok "external send with wants_reply=true is rejected (no reply address)"
else
  bad "external wants_reply=true was not rejected: ${B_REJECT:0:200}"
fi
# Reject is reject — it must not enqueue. The wants_reply=true guard returns
# BEFORE the fallback, so the inbox (drained empty by id21) stays empty.
if ls "$PI_META_MAILBOX_DIR/$GARDEN_B"/*.msg >/dev/null 2>&1; then
  bad "rejected send left an unread .msg (reject must have no enqueue side effect)"
else
  ok "rejected send enqueued nothing (no side effect)"
fi

# ---------------------------------------------------------------------------
# Case C — SE-2: target has a meta-record but NO active receiver marker (a
# terminated / never-armed session). A conversational send must REJECT and write
# nothing — no .msg, no mailbox dir, no doorbell poke.
# ---------------------------------------------------------------------------
C_SEND=$(PI_AGENT_ID="entwurf/claude-sonnet-4-6" PI_SESSION_ID="$SENDER_PI_ID" \
  srv 40 "$(sendcall 40 "$GARDEN_C" "MAILBOX_SMOKE_C should not land" false)")
if echo "$C_SEND" | grep -q '"isError":true' && echo "$C_SEND" | grep -q 'not conversationally deliverable'; then
  ok "send to a record-backed but inactive receiver is rejected (SE-2)"
else
  bad "inactive-receiver send was not rejected: ${C_SEND:0:220}"
fi
if [ -e "$PI_META_MAILBOX_DIR/$GARDEN_C" ]; then
  bad "inactive-receiver reject mutated the mailbox (must enqueue nothing, poke nothing)"
else
  ok "inactive-receiver reject left the mailbox untouched (no .msg, no signal poke)"
fi

if [ "$fail" = "0" ]; then
  echo "smoke-meta-mailbox PASS"
else
  echo "smoke-meta-mailbox FAIL"
  exit 1
fi
