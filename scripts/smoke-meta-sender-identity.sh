#!/usr/bin/env bash
# smoke-meta-sender-identity — deterministic E2E for native sender identity
# (0.10.0 blocker). The receiver half (C) made a native Claude session
# addressable; this closes the SENDER half: when a native session sends via the
# user-scope MCP it has no PI_SESSION_ID, so the bridge must learn WHO sent it —
# authoritatively, not by cwd guessing. The SessionStart hook writes a sender
# marker keyed by the shared Claude parent pid; the MCP reads it and promotes the
# send to a REPLYABLE meta-session addressed by garden-id.
#
# Here PI_META_SENDER_MARKER injects a specific marker per send so the round-trip
# is deterministic (no real pids, no Claude turns). Verifies:
#   A→B: B's inbox shows A's garden-id as a (meta-session, replyable) sender
#   B→A: reply by garden-id reaches A's inbox, from B's garden-id
#   no marker + REQUIRE_META_SENDER=1: send is refused AND enqueues nothing
# Deps: bash + node + python3.
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/.." && pwd)"
START="$REPO/mcp/pi-tools-bridge/start.sh"
LIB="$REPO/pi-extensions/lib/meta-session.ts"

command -v node >/dev/null || { echo "FAIL: node not on PATH"; exit 1; }
command -v python3 >/dev/null || { echo "FAIL: python3 not on PATH"; exit 1; }

# This gate is about marker-driven identity; make sure a stray pi env can't flip it.
unset PI_AGENT_ID PI_SESSION_ID 2>/dev/null || true

fail=0
ok()  { echo "  ok    $*"; }
bad() { echo "  FAIL  $*"; fail=1; }

TMP="$(mktemp -d -t psa-meta-sender.XXXXXX)"
cleanup() { rm -rf "$TMP"; }
trap cleanup EXIT

export PI_META_SESSIONS_DIR="$TMP/meta-sessions"
export PI_META_MAILBOX_DIR="$TMP/meta-mailbox"
export PI_META_SENDERS_DIR="$TMP/meta-senders"
export PI_ENTWURF_DIR="$TMP/entwurf-control"   # empty → no control socket → mailbox path
mkdir -p "$PI_META_SESSIONS_DIR" "$PI_META_MAILBOX_DIR" "$PI_META_SENDERS_DIR" "$PI_ENTWURF_DIR"

# Two synthetic native meta-records + their sender markers, via the real lib.
cat > "$TMP/gen.mjs" <<'JS'
const [libPath, store] = process.argv.slice(2);
const fs = await import("node:fs");
const path = await import("node:path");
const { mintMetaRecord, serializeMetaRecord } = await import(libPath);
const out = {};
for (const tag of ["a", "b"]) {
  const r = mintMetaRecord({ backend: "claude-code", nativeSessionId: "n-sender-" + tag, transcriptPath: "/tmp/t.jsonl", cwd: "/tmp/" + tag });
  fs.writeFileSync(path.join(store, r.gardenId + ".meta.json"), serializeMetaRecord(r));
  out[tag] = { gardenId: r.gardenId, nativeSessionId: r.nativeSessionId, cwd: r.cwd };
}
console.log(JSON.stringify(out));
JS
META="$(node --experimental-strip-types "$TMP/gen.mjs" "$LIB" "$PI_META_SESSIONS_DIR")"
GARDEN_A="$(node -e 'process.stdout.write(JSON.parse(process.argv[1]).a.gardenId)' "$META")"
GARDEN_B="$(node -e 'process.stdout.write(JSON.parse(process.argv[1]).b.gardenId)' "$META")"

# Sender markers (what the hook would write). PI_META_SENDER_MARKER points the MCP
# at one. They carry an owner pid + start-key; readMetaSenderMarker re-checks the
# live owner, so the marker must name a STILL-ALIVE process — use this smoke's own
# pid ($$) and its real start-key (via the lib, so the format matches exactly).
SK_SELF=$(node --experimental-strip-types -e "import('$LIB').then(m=>process.stdout.write(m.processStartKey(Number(process.argv[1]))))" "$$")
mkmarker() { # file gardenId native startKey
  python3 -c "import json,sys; json.dump({'backend':'claude-code','gardenId':sys.argv[2],'nativeSessionId':sys.argv[3],'cwd':'/tmp/x','ownerPid':int(sys.argv[5]),'ownerStartKey':sys.argv[4],'updatedAt':'2026-06-06T00:00:00.000Z'}, open(sys.argv[1],'w'))" "$1" "$2" "$3" "$4" "$$"
}
MARKER_A="$TMP/marker-a.json"; MARKER_B="$TMP/marker-b.json"
mkmarker "$MARKER_A" "$GARDEN_A" "n-sender-a" "$SK_SELF"
mkmarker "$MARKER_B" "$GARDEN_B" "n-sender-b" "$SK_SELF"

INIT='{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"smoke","version":"0"}}}'
INITED='{"jsonrpc":"2.0","method":"notifications/initialized"}'

srv() {
  local id="$1" call="$2"
  {
    printf '%s\n' "$INIT"
    printf '%s\n' "$INITED"
    printf '%s\n' "$call"
    sleep 0.6
  } | timeout 20 "$START" 2>/dev/null | grep "\"id\":$id" || true
}
sendcall() { printf '{"jsonrpc":"2.0","id":%s,"method":"tools/call","params":{"name":"entwurf_send","arguments":{"sessionId":"%s","message":"%s","wants_reply":%s}}}' "$1" "$2" "$3" "$4"; }
readcall() { printf '{"jsonrpc":"2.0","id":%s,"method":"tools/call","params":{"name":"entwurf_inbox_read","arguments":{"gardenId":"%s"}}}' "$1" "$2"; }

# A → B (A's marker injected). wants_reply=true allowed because meta-session is replyable.
A_SEND=$(PI_META_SENDER_MARKER="$MARKER_A" srv 10 "$(sendcall 10 "$GARDEN_B" "SENDER_SMOKE_AtoB" true)")
B_READ=$(srv 11 "$(readcall 11 "$GARDEN_B")")

if echo "$A_SEND" | grep -q '"isError":true'; then bad "A→B send errored: ${A_SEND:0:200}"; else ok "marker promotes anonymous MCP send to a meta-session send (no isError)"; fi
echo "$A_SEND" | grep -q '(wants reply)' && ok "meta-session sender may request reply (wants_reply=true allowed)" || bad "meta-session send dropped wants-reply badge"
echo "$B_READ" | grep -q "$GARDEN_A" && ok "receiver sees the SENDER's garden-id (authoritative address)" || bad "sender garden-id missing from receiver body: ${B_READ:0:200}"
echo "$B_READ" | grep -q 'meta-session, replyable — reply with entwurf_send to this sessionId' && ok "sender rendered as (meta-session, replyable)" || bad "meta-session replyable badge missing: ${B_READ:0:200}"
echo "$B_READ" | grep -q 'meta-session/claude-code' && ok "sender agentId is meta-session/claude-code" || bad "sender agentId not meta-session: ${B_READ:0:200}"
echo "$B_READ" | grep -q 'SENDER_SMOKE_AtoB' && ok "message body delivered" || bad "message body missing"

# B → A (reply by garden-id, B's marker injected).
B_REPLY=$(PI_META_SENDER_MARKER="$MARKER_B" srv 12 "$(sendcall 12 "$GARDEN_A" "SENDER_SMOKE_BtoA" false)")
A_READ=$(srv 13 "$(readcall 13 "$GARDEN_A")")

if echo "$B_REPLY" | grep -q '"isError":true'; then bad "B→A reply errored: ${B_REPLY:0:200}"; else ok "reply by garden-id is accepted"; fi
echo "$A_READ" | grep -q "$GARDEN_B" && ok "reply carries B's garden-id back to A (two-way closed)" || bad "reply sender garden-id missing: ${A_READ:0:200}"
echo "$A_READ" | grep -q 'SENDER_SMOKE_BtoA' && ok "reply body delivered to A" || bad "reply body missing"

# PPID production path: NO PI_META_SENDER_MARKER override. The hook and the MCP
# server run under ONE shared parent (this bash -c); start.sh `exec node` and the
# hook's direct `node` both resolve process.ppid to that parent, so the MCP finds
# the marker the hook wrote — exactly the production "hook ppid == MCP ppid"
# claim, closed deterministically with zero Claude turns.
HOOK="$REPO/pi-extensions/meta-bridge-hook.ts"
# One OUTER timeout so the hook node and the start.sh `exec node` share the SAME
# parent (this bash -c). A per-command `timeout` would insert a distinct timeout
# process between each node and bash -c, giving them different ppids — exactly the
# bug this case must NOT mask.
PPID_SEND=$(timeout 35 bash -c "
  printf '%s' '{\"session_id\":\"n-ppid\",\"transcript_path\":\"/tmp/ppid.jsonl\",\"cwd\":\"/tmp/ppid\",\"hook_event_name\":\"SessionStart\"}' \
    | node --experimental-strip-types '$HOOK' >/dev/null 2>&1
  {
    printf '%s\n' '$INIT'
    printf '%s\n' '$INITED'
    printf '%s\n' '$(sendcall 30 "$GARDEN_B" "PPID_PATH_MSG" false)'
    sleep 0.6
  } | '$START' 2>/dev/null | grep '\"id\":30' || true
")
# garden-id the hook minted for n-ppid (authority = the record store)
GARDEN_PPID=$(node -e '
  const fs=require("fs"), d=process.argv[1];
  for (const f of fs.readdirSync(d)) {
    if (!f.endsWith(".meta.json")) continue;
    const r=JSON.parse(fs.readFileSync(d+"/"+f,"utf8"));
    if (r.nativeSessionId==="n-ppid") { process.stdout.write(r.gardenId); break; }
  }' "$PI_META_SESSIONS_DIR")
PPID_READ=$(srv 31 "$(readcall 31 "$GARDEN_B")")

if echo "$PPID_SEND" | grep -q '"isError":true'; then bad "PPID-path send errored: ${PPID_SEND:0:200}"; else ok "PPID path: MCP finds the hook-written marker via shared process.ppid (no override)"; fi
[ -n "$GARDEN_PPID" ] && ok "hook minted a record for the native session (garden=$GARDEN_PPID)" || bad "hook did not create a record for n-ppid"
if [ -n "$GARDEN_PPID" ] && echo "$PPID_READ" | grep -q "$GARDEN_PPID" && echo "$PPID_READ" | grep -q 'meta-session, replyable'; then
  ok "PPID-path send is promoted to a replyable meta-session (hook ppid == MCP ppid)"
else
  bad "PPID-path send not promoted to meta-session: ${PPID_READ:0:200}"
fi

# Unbacked marker: VALID live owner, but its garden-id has NO backing record.
# The record store is the authority, so it must NOT grant identity → reject.
BAD_MARKER="$TMP/marker-unbacked.json"
mkmarker "$BAD_MARKER" "20990101T000000-deadbe" "n-ghost" "$SK_SELF"
STALE_REJECT=$(PI_TOOLS_BRIDGE_REQUIRE_META_SENDER=1 PI_META_SENDER_MARKER="$BAD_MARKER" srv 32 "$(sendcall 32 "$GARDEN_A" "stale" false)")
if echo "$STALE_REJECT" | grep -q '"isError":true' && echo "$STALE_REJECT" | grep -q 'no authoritative sender identity'; then
  ok "marker with no backing meta-record is rejected under REQUIRE (store is authority)"
else
  bad "unbacked marker was not rejected: ${STALE_REJECT:0:200}"
fi

# pid-reuse: marker owner pid is alive but its START-KEY no longer matches (i.e. a
# different process now holds that pid). A bare pid is reused; pid+start-key is
# not. This stale marker must NOT grant a wrong identity → reject (the P0 fix).
REUSE_MARKER="$TMP/marker-pidreuse.json"
mkmarker "$REUSE_MARKER" "$GARDEN_A" "n-sender-a" "linux:1"  # bogus start-key for pid $$
REUSE_REJECT=$(PI_TOOLS_BRIDGE_REQUIRE_META_SENDER=1 PI_META_SENDER_MARKER="$REUSE_MARKER" srv 33 "$(sendcall 33 "$GARDEN_B" "reuse" false)")
if echo "$REUSE_REJECT" | grep -q '"isError":true' && echo "$REUSE_REJECT" | grep -q 'no authoritative sender identity'; then
  ok "pid-reuse stale marker (start-key mismatch) is rejected — no wrong-identity accept"
else
  bad "pid-reuse marker was not rejected: ${REUSE_REJECT:0:200}"
fi

# No marker + REQUIRE_META_SENDER=1 → refuse, and enqueue NOTHING.
REJECT=$(PI_TOOLS_BRIDGE_REQUIRE_META_SENDER=1 srv 14 "$(sendcall 14 "$GARDEN_A" "anon-attempt" false)")
if echo "$REJECT" | grep -q '"isError":true' && echo "$REJECT" | grep -q 'no authoritative sender identity'; then
  ok "anonymous send refused under REQUIRE_META_SENDER (who-sent-it is mandatory)"
else
  bad "anonymous send was not refused: ${REJECT:0:200}"
fi
if ls "$PI_META_MAILBOX_DIR/$GARDEN_A"/*.msg >/dev/null 2>&1; then
  bad "refused anonymous send still enqueued a .msg (must have no side effect)"
else
  ok "refused anonymous send enqueued nothing"
fi

if [ "$fail" = "0" ]; then
  echo "smoke-meta-sender-identity PASS"
else
  echo "smoke-meta-sender-identity FAIL"
  exit 1
fi
