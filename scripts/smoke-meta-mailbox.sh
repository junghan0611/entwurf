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
START="$REPO/mcp/pi-tools-bridge/start.sh"
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

# Full env isolation (GPT힣 condition 1): private store + mailbox + an EMPTY
# control dir so the live-socket branch can never resolve and fallback is forced.
export PI_META_SESSIONS_DIR="$TMP/meta-sessions"
export PI_META_MAILBOX_DIR="$TMP/meta-mailbox"
export PI_META_SENDERS_DIR="$TMP/meta-senders"   # empty → external case never reads a real sender marker
export PI_ENTWURF_DIR="$TMP/entwurf-control"
mkdir -p "$PI_META_SESSIONS_DIR" "$PI_META_MAILBOX_DIR" "$PI_META_SENDERS_DIR" "$PI_ENTWURF_DIR"

# Two synthetic native-Claude meta-records (one per sender case), via the real lib.
cat > "$TMP/gen.mjs" <<'JS'
const [libPath, store] = process.argv.slice(2);
const fs = await import("node:fs");
const path = await import("node:path");
const { mintMetaRecord, serializeMetaRecord } = await import(libPath);
const mk = (nid) => {
  const r = mintMetaRecord({ backend: "claude-code", nativeSessionId: nid, transcriptPath: "/tmp/t.jsonl", cwd: "/tmp" });
  fs.writeFileSync(path.join(store, r.gardenId + ".meta.json"), serializeMetaRecord(r));
  return r.gardenId;
};
console.log(JSON.stringify({ a: mk("n-mailbox-a"), b: mk("n-mailbox-b") }));
JS
IDS="$(node --experimental-strip-types "$TMP/gen.mjs" "$LIB" "$PI_META_SESSIONS_DIR")"
GARDEN_A="$(node -e 'process.stdout.write(JSON.parse(process.argv[1]).a)' "$IDS")"
GARDEN_B="$(node -e 'process.stdout.write(JSON.parse(process.argv[1]).b)' "$IDS")"

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
# Case A — REPLYABLE sender (PI_SESSION_ID + PI_AGENT_ID present).
# ---------------------------------------------------------------------------
A_SEND=$(PI_AGENT_ID="pi-shell-acp/claude-sonnet-4-6" PI_SESSION_ID="20260606T120000-aaaaaa" \
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

if [ "$fail" = "0" ]; then
  echo "smoke-meta-mailbox PASS"
else
  echo "smoke-meta-mailbox FAIL"
  exit 1
fi
