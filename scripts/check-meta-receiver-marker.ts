/**
 * check-meta-receiver-marker — deterministic gate for the meta-receiver presence
 * marker (SE-2 slice 2b). The active-receiver signal a self-fetch backend (Claude
 * Code) needs: a meta-record proves a session once existed; this marker proves a
 * live watch owner is still there to be woken. Without it a terminated session's
 * lingering record reads as a ghost active receiver and replies pile up as mailbox
 * garbage.
 *
 * Proves:
 *   - write→read round-trip preserves every field; keyed by GARDEN id (not owner pid),
 *     because deliverability lookup starts from a target garden id.
 *   - atomic write lands valid JSON at 0600.
 *   - dead-owner / pid-reuse guard: a marker whose ownerStartKey no longer matches the
 *     live owner reads as null (inactive), distinct from "no marker". verifyOwner:false
 *     bypasses it for inspection.
 *   - armProvenance is constrained to the arm-capable events; "user-prompt-submit" (and
 *     any other value) is rejected at write — UserPromptSubmit can never mint a presence
 *     it cannot back.
 *   - record-backing is NOT checked by the reader (recordBacked is the deliverability
 *     predicate's explicit fact, so an absent record and a dead owner stay distinct).
 */

import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import {
	META_RECEIVER_ARM_PROVENANCES,
	metaReceiverMarkerPath,
	processStartKey,
	readMetaReceiverMarker,
	writeMetaReceiverMarker,
} from "../pi-extensions/lib/meta-session.ts";

let passed = 0;
function ok(label: string, cond: boolean): void {
	assert.ok(cond, label);
	console.log(`  ok    ${label}`);
	passed++;
}

const REPO_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIR = mkdtempSync(path.join(tmpdir(), "psa-meta-receivers-"));
const GARDEN = "20260614T120000-aaaaaa";

// ── write → read round-trip, garden-id keyed ────────────────────────────────
const file = writeMetaReceiverMarker({
	gardenId: GARDEN,
	backend: "claude-code",
	nativeSessionId: "n-recv-a",
	ownerPid: process.pid, // this live node process — start-key will match on read
	armProvenance: "session-start",
	receiversDir: DIR,
});
ok(
	"marker path is keyed by garden id",
	file === metaReceiverMarkerPath(GARDEN, DIR) && file.endsWith(`${GARDEN}.json`),
);
ok("write lands JSON at mode 0600", (statSync(file).mode & 0o777) === 0o600);

const back = readMetaReceiverMarker({ gardenId: GARDEN, receiversDir: DIR });
ok("read returns a marker for a live owner", back !== null);
if (back) {
	ok("round-trip gardenId", back.gardenId === GARDEN);
	ok("round-trip backend", back.backend === "claude-code");
	ok("round-trip nativeSessionId", back.nativeSessionId === "n-recv-a");
	ok("round-trip ownerPid", back.ownerPid === process.pid);
	ok("ownerStartKey computed at write equals the live owner key", back.ownerStartKey === processStartKey(process.pid));
	ok("ownerKind defaults to claude-code-cli", back.ownerKind === "claude-code-cli");
	ok("round-trip armProvenance", back.armProvenance === "session-start");
	ok("updatedAt present", typeof back.updatedAt === "string" && back.updatedAt.length > 0);
}

// ── dead-owner / pid-reuse guard ────────────────────────────────────────────
// A marker whose start-key no longer matches the live pid must read as null.
const ghostGarden = "20260614T120000-bbbbbb";
const ghostFile = metaReceiverMarkerPath(ghostGarden, DIR);
writeFileSync(
	ghostFile,
	`${JSON.stringify({
		gardenId: ghostGarden,
		backend: "claude-code",
		nativeSessionId: "n-ghost",
		ownerPid: process.pid,
		ownerStartKey: "linux:1", // bogus start-key for this pid → guard must reject
		ownerKind: "claude-code-cli",
		armProvenance: "session-start",
		updatedAt: "2026-06-14T03:00:00.000Z",
	})}\n`,
);
ok(
	"dead-owner (start-key mismatch) marker reads as null",
	readMetaReceiverMarker({ gardenId: ghostGarden, receiversDir: DIR }) === null,
);
ok(
	"verifyOwner:false bypasses the guard (inspection only)",
	readMetaReceiverMarker({ gardenId: ghostGarden, receiversDir: DIR, verifyOwner: false }) !== null,
);

// ── armProvenance constraint ────────────────────────────────────────────────
ok(
	"arm provenances are exactly the arm-capable events",
	JSON.stringify([...META_RECEIVER_ARM_PROVENANCES].sort()) ===
		JSON.stringify(["cwd-changed", "file-changed", "session-start"]),
);
let upsRejected = false;
try {
	writeMetaReceiverMarker({
		gardenId: GARDEN,
		backend: "claude-code",
		nativeSessionId: "n-recv-a",
		ownerPid: process.pid,
		// @ts-expect-error — user-prompt-submit is intentionally NOT a valid arm provenance
		armProvenance: "user-prompt-submit",
		receiversDir: DIR,
	});
} catch {
	upsRejected = true;
}
ok("user-prompt-submit armProvenance is rejected at write (UPS cannot mint presence)", upsRejected);

// ── absent marker, no record-backing requirement ────────────────────────────
ok(
	"absent marker reads as null",
	readMetaReceiverMarker({ gardenId: "20260614T120000-cccccc", receiversDir: DIR }) === null,
);
// The round-trip marker above has NO backing meta-record in this dir, yet it read
// fine — the reader does not gate on record existence (that is the predicate's fact).
ok("reader does not require a backing record (recordBacked is the predicate's job)", back !== null);

// corrupt file → null, never throw.
const corruptGarden = "20260614T120000-dddddd";
writeFileSync(metaReceiverMarkerPath(corruptGarden, DIR), "{ not json");
ok(
	"corrupt marker reads as null (no throw)",
	readMetaReceiverMarker({ gardenId: corruptGarden, receiversDir: DIR }) === null,
);

// ── HOOK WIRING source guard: the marker is only as honest as where it is written ──
const hookSrc = readFileSync(path.join(REPO_DIR, "pi-extensions", "meta-bridge-hook.ts"), "utf8");

ok("hook imports + calls writeMetaReceiverMarker", /writeMetaReceiverMarker/.test(hookSrc));

// ownerPid is process.ppid ONLY — never the grandparent (parentPid). The receiver
// owner is the watchPaths subscriber (the Claude CLI); a grandparent (login shell)
// outlives the session and would resurrect the ghost active-receiver leak.
ok("receiver marker ownerPid is process.ppid", /ownerPid\s*=\s*process\.ppid/.test(hookSrc));
ok("hook does NOT use parentPid (no grandparent owner)", !/parentPid\s*\(/.test(hookSrc));

// UserPromptSubmit must early-return BEFORE the receiver marker write — it cannot
// arm a watch, so it must never mint a presence. Check the early-return appears
// before the writeMetaReceiverMarker call site in source order.
const upsReturnAt = hookSrc.search(/eventName\s*===\s*"UserPromptSubmit"/);
const recvWriteAt = hookSrc.search(/writeMetaReceiverMarker\s*\(/);
ok(
	"UserPromptSubmit early-return precedes the receiver marker write",
	upsReturnAt >= 0 && recvWriteAt >= 0 && upsReturnAt < recvWriteAt,
);

// armProvenanceFor maps ONLY the arm-capable events and returns null otherwise — an
// unknown event must not masquerade as an optimistic session-start.
const armFnMatch = hookSrc.match(/function armProvenanceFor\([^)]*\)[^{]*\{[\s\S]*?\n\}/);
ok("armProvenanceFor is present", armFnMatch !== null);
if (armFnMatch) {
	const body = armFnMatch[0];
	ok(
		"armProvenanceFor maps SessionStart/CwdChanged/FileChanged",
		/SessionStart/.test(body) && /CwdChanged/.test(body) && /FileChanged/.test(body),
	);
	ok(
		"armProvenanceFor returns null for unknown events (fail-closed, no optimistic session-start)",
		/return null/.test(body),
	);
}

// The receiver marker write rides the watch-arm block (near the inbox.signal arm),
// not the sender-marker block — keep the two presences from drifting together.
const signalAt = hookSrc.search(/inbox\.signal/);
ok(
	"receiver marker write sits within the watch-arm region (near inbox.signal)",
	signalAt >= 0 && recvWriteAt > signalAt,
);

console.log(`\ncheck-meta-receiver-marker: ${passed} checks passed`);
