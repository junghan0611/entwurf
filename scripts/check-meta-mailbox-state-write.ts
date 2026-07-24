/**
 * check-meta-mailbox-state-write — deterministic gate for 0.11 Stage 0 step 3D-4
 * commit2 (the cut). Renamed from check-meta-mailbox-dualwrite: after the cut the
 * receipt is no longer DUAL-written (record.delivery is gone from the v2 record) —
 * it lives SOLELY in the mailbox state store. A real temp sessions+mailbox dir; no
 * backend, no network, no hook. Safe in the `pnpm check` static floor.
 *
 * Proves the post-cut contract (H1):
 *  - the citizen's meta-record FILE is byte-identical before/after enqueue AND read
 *    (enqueue/read no longer touch the record — invariant ⑤);
 *  - enqueue stamps state.lastEnqueuedAt, read stamps state.lastReadAt, and the
 *    enqueue receipt survives the read (field isolation on the state store);
 *  - lastDeliveredAt is never invented by read (doorbell owns delivery-time);
 *  - an empty inbox is a no-op on BOTH the record (untouched) and the state
 *    (state.json never created) — invariant ⑥;
 *  - a state-store drift makes the read throw fail-loud (partial failure surfaces).
 *
 * Scope is 3D-4 ONLY. The record is written as v3 by upsertMetaSession (#50 hard
 * cut); enqueue/read read the V3-only identity and mutate only the mailbox state.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
	emptyMailboxReceiptState,
	enqueueMetaMessage,
	MetaRecordError,
	mailboxReceiptStatePath,
	readMailboxReceiptState,
	readMetaInbox,
	serializeMailboxReceiptState,
	upsertMetaSession,
} from "../pi-extensions/lib/meta-session.ts";

let passed = 0;
function ok(label: string, cond: boolean): void {
	assert.ok(cond, label);
	console.log(`  ok    ${label}`);
	passed++;
}
function golden(label: string, actual: unknown, expected: unknown): void {
	assert.deepStrictEqual(actual, expected, label);
	console.log(`  ok    ${label}`);
	passed++;
}
function throws(label: string, fn: () => unknown): void {
	assert.throws(fn, MetaRecordError, label);
	console.log(`  ok    ${label}`);
	passed++;
}

const ENQ = new Date("2026-03-01T12:00:00.000Z");
const ENQ_ISO = "2026-03-01T12:00:00.000Z";
const RD = new Date("2026-03-01T12:05:00.000Z");
const RD_ISO = "2026-03-01T12:05:00.000Z";

const tmpRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "psa-statewrite-")));
const sessionsDir = path.join(tmpRoot, "meta-sessions");
const mailboxDir = path.join(tmpRoot, "meta-mailbox");

// Seed a real v2 citizen via the upsert write path (the create that writes v2).
function seed(nativeSessionId: string): string {
	const res = upsertMetaSession({
		dir: sessionsDir,
		input: { backend: "claude-code", nativeSessionId, transcriptPath: "/tmp/t.jsonl", cwd: "/tmp" },
		now: ENQ,
	});
	return res.record.gardenId;
}

try {
	// --- enqueue → read: record FILE untouched, receipt lands in state only ----
	const gidA = seed("n-state-a");
	const recordFile = path.join(sessionsDir, `${gidA}.meta.json`);
	const recordBytes0 = fs.readFileSync(recordFile, "utf8");

	enqueueMetaMessage({ gardenId: gidA, body: "hello", sessionsDir, mailboxDir, now: ENQ });
	ok(
		"enqueue: the meta-record FILE is byte-identical (enqueue does not touch the record)",
		fs.readFileSync(recordFile, "utf8") === recordBytes0,
	);
	const stateAfterEnq = readMailboxReceiptState({ gardenId: gidA, mailboxDir });
	ok("enqueue: state.lastEnqueuedAt stamped (sole receipt home)", stateAfterEnq.lastEnqueuedAt === ENQ_ISO);
	ok("enqueue: read-receipt not pre-stamped", stateAfterEnq.lastReadAt === null);

	const readRes = readMetaInbox({ gardenId: gidA, sessionsDir, mailboxDir, now: RD });
	ok("read: the queued message drained", readRes.messages.length === 1 && readRes.messages[0].body === "hello");
	ok("read: result.readAt comes from the state stamp", readRes.readAt === RD_ISO);
	ok(
		"read: the meta-record FILE is STILL byte-identical (read does not touch the record)",
		fs.readFileSync(recordFile, "utf8") === recordBytes0,
	);
	const stateAfterRead = readMailboxReceiptState({ gardenId: gidA, mailboxDir });
	ok("read: state.lastReadAt stamped", stateAfterRead.lastReadAt === RD_ISO);
	ok("read: enqueue receipt SURVIVES the read (field isolation)", stateAfterRead.lastEnqueuedAt === ENQ_ISO);
	ok("read: lastDeliveredAt never invented by read (doorbell owns it)", stateAfterRead.lastDeliveredAt === null);

	// --- empty inbox: no-op on BOTH record and state --------------------------
	const gidB = seed("n-state-b");
	const recBfile = path.join(sessionsDir, `${gidB}.meta.json`);
	const recBytesB = fs.readFileSync(recBfile, "utf8");
	const emptyRes = readMetaInbox({ gardenId: gidB, sessionsDir, mailboxDir, now: RD });
	ok("empty inbox: nothing drained, readAt null", emptyRes.messages.length === 0 && emptyRes.readAt === null);
	ok("empty inbox: record FILE untouched", fs.readFileSync(recBfile, "utf8") === recBytesB);
	ok(
		"empty inbox: state.json NEVER created (no receipt on the state either)",
		!fs.existsSync(mailboxReceiptStatePath(mailboxDir, gidB)),
	);

	// --- partial-failure SURFACES (never swallowed) ---------------------------
	const gidC = seed("n-state-c");
	enqueueMetaMessage({ gardenId: gidC, body: "surface me", sessionsDir, mailboxDir, now: ENQ });
	const OTHER = "20260301T120000-def456";
	fs.writeFileSync(
		mailboxReceiptStatePath(mailboxDir, gidC),
		serializeMailboxReceiptState(emptyMailboxReceiptState(OTHER)),
	);
	throws("read: a state-store drift throws (partial failure surfaces, not swallowed)", () =>
		readMetaInbox({ gardenId: gidC, sessionsDir, mailboxDir, now: RD }),
	);

	// a fresh citizen (no enqueue/read yet) has an all-null receipt state.
	const gidD = seed("n-state-d");
	golden(
		"a never-touched citizen has an all-null receipt state",
		readMailboxReceiptState({ gardenId: gidD, mailboxDir }),
		emptyMailboxReceiptState(gidD),
	);
} finally {
	fs.rmSync(tmpRoot, { recursive: true, force: true });
}

console.log(`[check-meta-mailbox-state-write] ${passed} assertions ok`);
