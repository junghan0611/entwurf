/**
 * check-meta-mailbox-dualwrite — deterministic gate for 0.11 Stage 0 step 3D-2:
 * the LIVE receipt dual-write. enqueueMetaMessage / readMetaInbox now stamp the
 * mailbox receipt state store (3B, `<mailbox>/<gardenId>/state.json`) IN ADDITION
 * to record.delivery (the v1 home), additively. A real temp sessions+mailbox dir;
 * no backend, no network, no hook. Safe in the `pnpm check` static floor.
 *
 * Proves the additive dual-write contract:
 *  - enqueue stamps BOTH record.delivery.lastEnqueuedAt AND state.lastEnqueuedAt,
 *    byte-identical (same `now`, both isoNow) — the dual-write invariant.
 *  - read stamps BOTH record.delivery.lastReadAt AND state.lastReadAt, identical.
 *  - the enqueue receipt SURVIVES a later read (field isolation on the state store).
 *  - an empty inbox is a no-op on BOTH stores — record untouched AND state.json
 *    never created (reading nothing is not a receipt, on either store).
 *  - a state-store throw during read SURFACES fail-loud (never swallowed) — a drift'd
 *    state.json makes the read throw; the .read archive may already exist (3D-2 has no
 *    rollback), but the caller never gets a silent success.
 *  - lastDeliveredAt is NOT backfilled (the doorbell owns delivery-time).
 *
 * Scope is 3D-2 ONLY: additive dual-write. record.delivery is NOT removed, the v2
 * writer/upsert is NOT wired, and the capability consumer is NOT switched — those
 * are 3D-3/3D-4 (NEXT.md 끊을 지점 ②). smoke-meta-mailbox (E2E) stays green: it
 * still asserts record.delivery.*, which this leaves intact.
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
	mintMetaRecord,
	readMailboxReceiptState,
	readMetaInbox,
	readMetaRecordByGardenId,
	serializeMailboxReceiptState,
	serializeMetaRecord,
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

// Distinct enqueue/read instants: same `now` flows to both stamps within one call,
// so a byte-identical record/state value proves they shared it.
const ENQ = new Date("2026-03-01T12:00:00.000Z");
const ENQ_ISO = "2026-03-01T12:00:00.000Z";
const RD = new Date("2026-03-01T12:05:00.000Z");
const RD_ISO = "2026-03-01T12:05:00.000Z";

const tmpRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "psa-dualwrite-")));
const sessionsDir = path.join(tmpRoot, "meta-sessions");
const mailboxDir = path.join(tmpRoot, "meta-mailbox");
fs.mkdirSync(sessionsDir, { recursive: true });

// Seed a synthetic v1 meta-record via the real lib (smoke-meta-mailbox pattern):
// <sessionsDir>/<gardenId>.meta.json, the file enqueue/read read back.
function seed(nativeSessionId: string): string {
	const r = mintMetaRecord({ backend: "claude-code", nativeSessionId, transcriptPath: "/tmp/t.jsonl", cwd: "/tmp" });
	fs.writeFileSync(path.join(sessionsDir, `${r.gardenId}.meta.json`), serializeMetaRecord(r));
	return r.gardenId;
}

try {
	// --- full enqueue → read cycle: both stores stamped, in lockstep ----------
	const gidA = seed("n-dualwrite-a");
	enqueueMetaMessage({ gardenId: gidA, body: "hello", sessionsDir, mailboxDir, now: ENQ });

	const recAfterEnq = readMetaRecordByGardenId(gidA, sessionsDir);
	const stateAfterEnq = readMailboxReceiptState({ gardenId: gidA, mailboxDir });
	ok(
		"enqueue: record.delivery.lastEnqueuedAt stamped (v1 home intact)",
		recAfterEnq.delivery.lastEnqueuedAt === ENQ_ISO,
	);
	ok("enqueue: state.lastEnqueuedAt stamped (v2 home)", stateAfterEnq.lastEnqueuedAt === ENQ_ISO);
	ok(
		"enqueue: dual-write invariant — record and state stamps are byte-identical",
		recAfterEnq.delivery.lastEnqueuedAt === stateAfterEnq.lastEnqueuedAt,
	);
	ok(
		"enqueue: read-receipt NOT pre-stamped on either store",
		recAfterEnq.delivery.lastReadAt === null && stateAfterEnq.lastReadAt === null,
	);

	const readRes = readMetaInbox({ gardenId: gidA, sessionsDir, mailboxDir, now: RD });
	ok("read: the one queued message drained", readRes.messages.length === 1 && readRes.messages[0].body === "hello");
	ok("read: result.readAt is the read-time receipt", readRes.readAt === RD_ISO);

	const recAfterRead = readMetaRecordByGardenId(gidA, sessionsDir);
	const stateAfterRead = readMailboxReceiptState({ gardenId: gidA, mailboxDir });
	ok("read: record.delivery.lastReadAt stamped (v1 home intact)", recAfterRead.delivery.lastReadAt === RD_ISO);
	ok("read: state.lastReadAt stamped (v2 home)", stateAfterRead.lastReadAt === RD_ISO);
	ok(
		"read: dual-write invariant — record and state read-stamps are byte-identical",
		recAfterRead.delivery.lastReadAt === stateAfterRead.lastReadAt,
	);
	ok(
		"read: enqueue receipt SURVIVES the read on the state store (field isolation)",
		stateAfterRead.lastEnqueuedAt === ENQ_ISO,
	);
	ok(
		"read: lastDeliveredAt NOT backfilled on either store (doorbell owns delivery-time)",
		stateAfterRead.lastDeliveredAt === null && recAfterRead.delivery.lastDeliveredAt === null,
	);

	// --- empty inbox = no-op on BOTH stores -----------------------------------
	// An empty read early-returns before either stamp, so neither store mutates:
	// "read nothing" is not a receipt on the record (untouched) NOR the state
	// (state.json never created). The two stamps stay a mirror image.
	const gidB = seed("n-dualwrite-b");
	const recBeforeEmpty = readMetaRecordByGardenId(gidB, sessionsDir);
	const emptyRes = readMetaInbox({ gardenId: gidB, sessionsDir, mailboxDir, now: RD });
	ok("empty inbox: nothing drained, readAt null", emptyRes.messages.length === 0 && emptyRes.readAt === null);
	golden(
		"empty inbox: record untouched (no receipt on v1 home)",
		readMetaRecordByGardenId(gidB, sessionsDir),
		recBeforeEmpty,
	);
	ok(
		"empty inbox: state.json NEVER created (no receipt on v2 home)",
		!fs.existsSync(mailboxReceiptStatePath(mailboxDir, gidB)),
	);

	// --- partial-failure SURFACES (never swallowed) ---------------------------
	// A drift'd state.json (body claims a DIFFERENT citizen) must make the read
	// THROW from the state stamp (3B body/path drift guard). The .read archive may
	// already exist (3D-2 has no rollback), but the caller never gets a silent
	// success. Never warn. Throw.
	const gidC = seed("n-dualwrite-c");
	enqueueMetaMessage({ gardenId: gidC, body: "surface me", sessionsDir, mailboxDir, now: ENQ });
	const OTHER = "20260301T120000-def456";
	fs.writeFileSync(
		mailboxReceiptStatePath(mailboxDir, gidC),
		serializeMailboxReceiptState(emptyMailboxReceiptState(OTHER)),
	);
	throws("read: a state-store drift throws (partial failure surfaces, not swallowed)", () =>
		readMetaInbox({ gardenId: gidC, sessionsDir, mailboxDir, now: RD }),
	);
} finally {
	fs.rmSync(tmpRoot, { recursive: true, force: true });
}

console.log(`[check-meta-mailbox-dualwrite] ${passed} assertions ok`);
