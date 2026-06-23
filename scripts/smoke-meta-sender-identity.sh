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
#   entwurf_self: A's marker returns A's garden-id (not the old pi-env-only throw)
#   A→B: B's inbox shows A's garden-id as a (meta-session, replyable) sender
#   B→A: reply by garden-id reaches A's inbox, from B's garden-id
#   no marker + REQUIRE_META_SENDER=1: send is refused AND enqueues nothing
# Deps: bash + node + python3.
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/.." && pwd)"
START="$REPO/mcp/entwurf-bridge/start.sh"
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
export PI_META_RECEIVERS_DIR="$TMP/meta-receivers"   # SE-2: targets need an active receiver marker to be deliverable
export PI_ENTWURF_DIR="$TMP/entwurf-control"   # empty → no control socket → mailbox path
mkdir -p "$PI_META_SESSIONS_DIR" "$PI_META_MAILBOX_DIR" "$PI_META_SENDERS_DIR" "$PI_META_RECEIVERS_DIR" "$PI_ENTWURF_DIR"

# Synthetic native meta-records. a/b get an ACTIVE receiver marker (owner = this bash
# $$, alive for the whole smoke) so they are conversationally deliverable; c gets a
# record but NO marker (SE-2: record exists, receiver gone → send must reject).
cat > "$TMP/gen.mjs" <<'JS'
const [libPath, store, receiversDir, ownerPid] = process.argv.slice(2);
const fs = await import("node:fs");
const path = await import("node:path");
const { mintMetaRecord, serializeMetaRecord, writeMetaReceiverMarker } = await import(libPath);
const out = {};
const mk = (tag, active) => {
  const nid = "n-sender-" + tag;
  const r = mintMetaRecord({ backend: "claude-code", nativeSessionId: nid, transcriptPath: "/tmp/t.jsonl", cwd: "/tmp/" + tag });
  fs.writeFileSync(path.join(store, r.gardenId + ".meta.json"), serializeMetaRecord(r));
  if (active) {
    writeMetaReceiverMarker({ gardenId: r.gardenId, backend: "claude-code", nativeSessionId: nid, ownerPid: Number(ownerPid), armProvenance: "session-start", receiversDir });
  }
  out[tag] = { gardenId: r.gardenId, nativeSessionId: nid, cwd: r.cwd };
};
mk("a", true); mk("b", true); mk("c", false);
console.log(JSON.stringify(out));
JS
META="$(node --experimental-strip-types "$TMP/gen.mjs" "$LIB" "$PI_META_SESSIONS_DIR" "$PI_META_RECEIVERS_DIR" "$$")"
GARDEN_A="$(node -e 'process.stdout.write(JSON.parse(process.argv[1]).a.gardenId)' "$META")"
GARDEN_B="$(node -e 'process.stdout.write(JSON.parse(process.argv[1]).b.gardenId)' "$META")"
GARDEN_C="$(node -e 'process.stdout.write(JSON.parse(process.argv[1]).c.gardenId)' "$META")"

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
selfcall() { printf '{"jsonrpc":"2.0","id":%s,"method":"tools/call","params":{"name":"entwurf_self","arguments":{}}}' "$1"; }

# entwurf_self must resolve the same trusted marker identity, not remain pi-env-only.
SELF_A=$(PI_META_SENDER_MARKER="$MARKER_A" srv 9 "$(selfcall 9)")
if echo "$SELF_A" | grep -q '"isError":true'; then bad "entwurf_self with meta marker errored: ${SELF_A:0:200}"; else ok "entwurf_self accepts trusted meta-session identity (not pi-env-only)"; fi
echo "$SELF_A" | grep -q "$GARDEN_A" && echo "$SELF_A" | grep -q 'meta-session/claude-code' && echo "$SELF_A" | grep -q 'replyable:' \
  && ok "entwurf_self returns garden-id + meta-session agentId + replyable flag" \
  || bad "entwurf_self meta envelope incomplete: ${SELF_A:0:220}"

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

# SE-2: a fully-replyable sender to a record-backed but INACTIVE receiver (C has a
# record but no receiver marker) must reject and enqueue nothing — identity is honest,
# deliverability is not. (Distinct surface from smoke-meta-mailbox's pi-sender path.)
C_REJECT=$(PI_META_SENDER_MARKER="$MARKER_A" srv 40 "$(sendcall 40 "$GARDEN_C" "to-inactive" false)")
if echo "$C_REJECT" | grep -q '"isError":true' && echo "$C_REJECT" | grep -q 'not conversationally deliverable'; then
  ok "replyable sender → inactive receiver (record, no marker) is rejected (SE-2)"
else
  bad "send to inactive receiver was not rejected: ${C_REJECT:0:220}"
fi
if [ -e "$PI_META_MAILBOX_DIR/$GARDEN_C" ]; then
  bad "inactive-receiver reject mutated the mailbox (must enqueue nothing)"
else
  ok "inactive-receiver reject left the mailbox untouched"
fi

# 2e-c (SE-2 sender-side, identity ≠ replyability): a sender whose OWN receiver is inactive.
# C has a backing record (identity is real) but NO receiver marker (its inbox cannot wake).
# entwurf_self must KEEP the meta identity (garden-id + agentId — NOT degrade to external-mcp,
# which would erase who-sent) yet report replyable:false; wants_reply=true from it must be
# refused (no live reply address). Runtime proof of slice 2e-b's core contract — the regression
# this guards against ("inactive → degrade to external-mcp") is one a source guard can miss.
MARKER_C="$TMP/marker-c.json"
mkmarker "$MARKER_C" "$GARDEN_C" "n-sender-c" "$SK_SELF"
SELF_C=$(PI_META_SENDER_MARKER="$MARKER_C" srv 50 "$(selfcall 50)")
if echo "$SELF_C" | grep -q "$GARDEN_C" && echo "$SELF_C" | grep -q 'meta-session/claude-code'; then
  ok "2e-c: inactive-receiver sender keeps its meta identity (not degraded to external-mcp)"
else
  bad "2e-c: inactive-receiver sender identity lost: ${SELF_C:0:220}"
fi
if echo "$SELF_C" | grep -Eq 'replyable: *false'; then
  ok "2e-c: inactive-receiver sender is replyable:false (identity ≠ replyability)"
else
  bad "2e-c: inactive-receiver sender not replyable:false: ${SELF_C:0:220}"
fi
# wants_reply=true from a non-replyable sender → refused (no reply address). Target A is
# active, so the reject is about the SENDER's reply address, not the target's deliverability.
C_WANTS=$(PI_META_SENDER_MARKER="$MARKER_C" srv 51 "$(sendcall 51 "$GARDEN_A" "from-inactive-wants" true)")
if echo "$C_WANTS" | grep -q '"isError":true' && echo "$C_WANTS" | grep -q 'wants_reply=true requires a replyable'; then
  ok "2e-c: wants_reply=true from an inactive-receiver sender is refused (no reply address)"
else
  bad "2e-c: wants_reply=true from inactive sender not refused: ${C_WANTS:0:220}"
fi
# wants_reply=false from the SAME sender still delivers (target A is active) — a non-replyable
# sender is not blocked from fire-and-forget; only the reply badge is withheld.
C_FF=$(PI_META_SENDER_MARKER="$MARKER_C" srv 52 "$(sendcall 52 "$GARDEN_A" "from-inactive-ff" false)")
if echo "$C_FF" | grep -q '"isError":true'; then
  bad "2e-c: wants_reply=false from inactive sender should still deliver: ${C_FF:0:220}"
else
  ok "2e-c: wants_reply=false from inactive-receiver sender still delivers (badge ≠ block)"
fi

if [ "$fail" = "0" ]; then
  echo "smoke-meta-sender-identity PASS"
else
  echo "smoke-meta-sender-identity FAIL"
  exit 1
fi
