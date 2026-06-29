/**
 * check-mailbox-receipt-state — deterministic gate for 0.11 Stage 0 step 3B:
 * the mailbox receipt state schema + store. A real temp mailbox dir; no backend,
 * no network, no hook. Safe in the `pnpm check` static floor.
 *
 * Proves the new receipt authority's home (`<mailbox>/<gardenId>/state.json`):
 * pure schema round-trip + crash-on-malformed + strict keyset, then the fs store
 * (stamp → persist → read-back) including the observable result GPT named for
 * 3B — "read receipt가 record.delivery가 아니라 mailbox state로: stamp 후 state를
 * 보면 lastReadAt가 남는다". ENTWURF_META_MAILBOX_DIR / explicit mailboxDir keep this
 * off the operator's real ~/.pi/agent/meta-mailbox.
 *
 * Scope is 3B ONLY: schema + store. The live enqueue/read dual-write and the
 * record.delivery removal land in step 3D (NEXT.md 끊을 지점 ②) — no live-path
 * assertions here, and wakeMode/deliveryLevel (capability, step 3C) are out.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
	emptyMailboxReceiptState,
	type MailboxReceiptField,
	MetaRecordError,
	mailboxReceiptStatePath,
	parseMailboxReceiptState,
	readMailboxReceiptState,
	serializeMailboxReceiptState,
	stampMailboxReceipt,
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

const GID = "20260301T120000-abc123";
const tmpRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "psa-receipt-")));
const mailboxDir = path.join(tmpRoot, "meta-mailbox");

try {
	// --- pure schema ---------------------------------------------------------
	const empty = emptyMailboxReceiptState(GID);
	golden("emptyMailboxReceiptState: schema v1, gardenId, all timestamps null", empty, {
		schemaVersion: 1,
		gardenId: GID,
		lastEnqueuedAt: null,
		lastDeliveredAt: null,
		lastReadAt: null,
	});

	const seeded = { ...empty, lastEnqueuedAt: "2026-03-01T12:00:00.000Z", lastReadAt: "2026-03-01T12:05:00.000Z" };
	golden(
		"serialize → parse round-trips deep-equal",
		parseMailboxReceiptState(serializeMailboxReceiptState(seeded)),
		seeded,
	);
	ok(
		"serialize: stable key order, 2-space indent, trailing newline",
		serializeMailboxReceiptState(empty) ===
			`{\n  "schemaVersion": 1,\n  "gardenId": "${GID}",\n  "lastEnqueuedAt": null,\n  "lastDeliveredAt": null,\n  "lastReadAt": null\n}\n`,
	);

	// --- crash, don't warn ---------------------------------------------------
	throws("parse: invalid JSON throws", () => parseMailboxReceiptState("{not json"));
	throws("parse: array (non-object) throws", () => parseMailboxReceiptState("[]"));
	throws("parse: wrong schemaVersion throws", () =>
		parseMailboxReceiptState(JSON.stringify({ ...empty, schemaVersion: 2 })),
	);
	throws("parse: malformed gardenId throws", () =>
		parseMailboxReceiptState(JSON.stringify({ ...empty, gardenId: "nope" })),
	);
	throws("parse: non-string/non-null timestamp throws", () =>
		parseMailboxReceiptState(JSON.stringify({ ...empty, lastReadAt: 123 })),
	);
	// strict keyset — wakeMode is CAPABILITY (step 3C), never receipt state.
	throws("parse: capability field `wakeMode` is rejected (not receipt state)", () =>
		parseMailboxReceiptState(JSON.stringify({ ...empty, wakeMode: "self-fetch" })),
	);

	// --- path derivation -----------------------------------------------------
	ok(
		"mailboxReceiptStatePath = <mailbox>/<gardenId>/state.json",
		mailboxReceiptStatePath(mailboxDir, GID) === path.join(mailboxDir, GID, "state.json"),
	);

	// --- fs store ------------------------------------------------------------
	// absent → empty, and reading must NOT create the file (no side effect).
	golden(
		"readMailboxReceiptState: absent → empty state",
		readMailboxReceiptState({ gardenId: GID, mailboxDir }),
		empty,
	);
	ok(
		"readMailboxReceiptState: absent read leaves no state.json on disk",
		!fs.existsSync(mailboxReceiptStatePath(mailboxDir, GID)),
	);

	// THE 3B observable: stamp lastReadAt → state.json exists, lastReadAt set.
	const afterRead = stampMailboxReceipt({
		gardenId: GID,
		mailboxDir,
		field: "lastReadAt",
		now: new Date("2026-03-01T12:05:00.000Z"),
	});
	ok("stamp lastReadAt: state.json created on first stamp", fs.existsSync(mailboxReceiptStatePath(mailboxDir, GID)));
	ok(
		"stamp lastReadAt: only lastReadAt set, others null (읽음이 남는다)",
		afterRead.lastReadAt === "2026-03-01T12:05:00.000Z" &&
			afterRead.lastEnqueuedAt === null &&
			afterRead.lastDeliveredAt === null,
	);
	golden(
		"read-back equals the stamped state (persisted to disk)",
		readMailboxReceiptState({ gardenId: GID, mailboxDir }),
		afterRead,
	);

	// field isolation: a second stamp touches only its field, retains the first.
	const afterEnqueue = stampMailboxReceipt({
		gardenId: GID,
		mailboxDir,
		field: "lastEnqueuedAt",
		now: new Date("2026-03-01T12:10:00.000Z"),
	});
	ok(
		"stamp lastEnqueuedAt: retains lastReadAt, sets lastEnqueuedAt, lastDeliveredAt still null",
		afterEnqueue.lastReadAt === "2026-03-01T12:05:00.000Z" &&
			afterEnqueue.lastEnqueuedAt === "2026-03-01T12:10:00.000Z" &&
			afterEnqueue.lastDeliveredAt === null,
	);

	// atomic write leaves no .tmp residue in the citizen dir.
	const citizenDir = path.join(mailboxDir, GID);
	ok("stamp is atomic: no .tmp residue left behind", !fs.readdirSync(citizenDir).some((f) => f.includes(".tmp-")));

	// Blocker 1 — body/path gardenId drift is corruption (body is SSOT). Plant a
	// state.json whose body claims a DIFFERENT citizen under GID's path; reading
	// it back by GID must fail-fast, not silently return the wrong identity.
	const OTHER = "20260301T120000-def456";
	const driftFile = mailboxReceiptStatePath(mailboxDir, GID);
	fs.writeFileSync(driftFile, serializeMailboxReceiptState(emptyMailboxReceiptState(OTHER)));
	throws("readMailboxReceiptState: body/path gardenId drift is corruption", () =>
		readMailboxReceiptState({ gardenId: GID, mailboxDir }),
	);

	// Blocker 2 — stamp field runtime validation (the TS type does not survive a
	// JS/cast call site). An unknown field must crash, not create a stray key.
	throws("stampMailboxReceipt rejects an unknown receipt field", () =>
		// cast bypasses the TS field type on purpose, to prove the runtime guard
		stampMailboxReceipt({ gardenId: OTHER, mailboxDir, field: "lastBogusAt" as unknown as MailboxReceiptField }),
	);
} finally {
	fs.rmSync(tmpRoot, { recursive: true, force: true });
}

console.log(`[check-mailbox-receipt-state] ${passed} assertions ok`);
