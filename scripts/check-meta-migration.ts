/**
 * check-meta-migration — deterministic gate for 0.11 Stage 0 step 3D-4 commit2:
 * the v1→v2 delivery-receipt migration (migrateV1DeliveryReceipts) and its
 * crash-order placement inside upsert. A real temp sessions+mailbox dir; no
 * backend, no network, no hook. Safe in the `pnpm check` static floor.
 *
 * migrateV1DeliveryReceipts — per-field, STATE WINS, 3 timestamps only:
 *  - empty state + v1 receipts → fills every null field, writes, returns merged;
 *  - state already set on a field → v1 does NOT overwrite (state wins);
 *  - v1 all-null OR state already wins on every field v1 has → NO-OP: returns null,
 *    state.json never created ("migrating nothing is not a receipt", G4);
 *  - only the 3 timestamps move (wakeMode/deliveryLevel are capability, H2).
 *
 * crash-order (inside upsert): a v1 file's receipts migrate to state BEFORE the v2
 * rewrite. Proven two ways: (a) a v1 record on disk → upsert attach lands the
 * receipts in state AND rewrites the record to v2; (b) a drift'd state.json makes
 * the migrate throw, and the record is STILL v1 (rewrite not reached) — so a crash
 * there is recoverable (next attach re-migrates; state-wins is idempotent).
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
	emptyMailboxReceiptState,
	META_SCHEMA_VERSION,
	META_SCHEMA_VERSION_V2,
	MetaRecordError,
	mailboxReceiptStatePath,
	markEnqueued,
	markRead,
	migrateV1DeliveryReceipts,
	mintMetaRecord,
	parseMetaRecordAny,
	readMailboxReceiptState,
	serializeMailboxReceiptState,
	serializeMetaRecord,
	upsertMetaSession,
} from "../pi-extensions/lib/meta-session.ts";

let passed = 0;
function ok(label: string, cond: boolean): void {
	assert.ok(cond, label);
	console.log(`  ok    ${label}`);
	passed++;
}
function throws(label: string, fn: () => unknown): void {
	assert.throws(fn, MetaRecordError, label);
	console.log(`  ok    ${label}`);
	passed++;
}

const GID = "20260301T120000-aaaaaa";
const E_ISO = "2026-03-01T12:00:00.000Z";
const R_ISO = "2026-03-01T12:05:00.000Z";
const tmpRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "psa-migrate-")));
const mailboxDir = path.join(tmpRoot, "mbx");

try {
	// --- A: empty state + v1 receipts → fill all, write, create state.json -----
	const merged = migrateV1DeliveryReceipts({
		gardenId: GID,
		delivery: { lastEnqueuedAt: E_ISO, lastDeliveredAt: null, lastReadAt: R_ISO },
		mailboxDir,
	});
	ok(
		"migrate: empty state + v1 receipts fills null fields, returns merged",
		merged !== null &&
			merged.lastEnqueuedAt === E_ISO &&
			merged.lastReadAt === R_ISO &&
			merged.lastDeliveredAt === null,
	);
	ok("migrate: state.json created on a non-empty migration", fs.existsSync(mailboxReceiptStatePath(mailboxDir, GID)));

	// --- B: state wins — a re-migrate with DIFFERENT v1 values changes nothing --
	const noop = migrateV1DeliveryReceipts({
		gardenId: GID,
		delivery: {
			lastEnqueuedAt: "2099-01-01T00:00:00.000Z",
			lastDeliveredAt: null,
			lastReadAt: "2099-01-01T00:00:00.000Z",
		},
		mailboxDir,
	});
	ok("migrate: state wins — re-migrate over set fields is a no-op (returns null)", noop === null);
	const after = readMailboxReceiptState({ gardenId: GID, mailboxDir });
	ok(
		"migrate: state values unchanged by the losing re-migrate",
		after.lastEnqueuedAt === E_ISO && after.lastReadAt === R_ISO,
	);

	// --- C: partial fill — v1 fills only the null field, state keeps the rest ----
	const GID2 = "20260301T120000-bbbbbb";
	migrateV1DeliveryReceipts({
		gardenId: GID2,
		delivery: { lastEnqueuedAt: E_ISO, lastDeliveredAt: null, lastReadAt: null },
		mailboxDir,
	});
	const partial = migrateV1DeliveryReceipts({
		gardenId: GID2,
		delivery: { lastEnqueuedAt: "2099-01-01T00:00:00.000Z", lastDeliveredAt: null, lastReadAt: R_ISO },
		mailboxDir,
	});
	ok(
		"migrate: partial — fills the still-null lastReadAt, keeps the won lastEnqueuedAt",
		partial !== null && partial.lastEnqueuedAt === E_ISO && partial.lastReadAt === R_ISO,
	);

	// --- D: v1 all-null → no-op, NO state.json created --------------------------
	const GID3 = "20260301T120000-cccccc";
	const none = migrateV1DeliveryReceipts({
		gardenId: GID3,
		delivery: { lastEnqueuedAt: null, lastDeliveredAt: null, lastReadAt: null },
		mailboxDir,
	});
	ok("migrate: v1 all-null is a no-op (returns null)", none === null);
	ok("migrate: v1 all-null never creates state.json", !fs.existsSync(mailboxReceiptStatePath(mailboxDir, GID3)));

	// --- E: crash-order via upsert — v1 record attaches → receipts migrate + v2 -
	const sessionsDir = path.join(tmpRoot, "sessions-e");
	fs.mkdirSync(sessionsDir, { recursive: true });
	const mbxE = path.join(tmpRoot, "mbx-e");
	const v1 = markRead(
		markEnqueued(
			mintMetaRecord(
				{ backend: "claude-code", nativeSessionId: "n-mig", transcriptPath: "/t.jsonl", cwd: "/c" },
				new Date(E_ISO),
			),
			new Date(E_ISO),
		),
		new Date(R_ISO),
	);
	fs.writeFileSync(path.join(sessionsDir, `${v1.gardenId}.meta.json`), serializeMetaRecord(v1));
	const res = upsertMetaSession({
		dir: sessionsDir,
		mailboxDir: mbxE,
		input: { backend: "claude-code", nativeSessionId: "n-mig", cwd: "/c" },
		now: new Date(R_ISO),
	});
	ok("crash-order: upsert attach rewrote the record to v2", res.record.schemaVersion === META_SCHEMA_VERSION_V2);
	const migrated = readMailboxReceiptState({ gardenId: v1.gardenId, mailboxDir: mbxE });
	ok(
		"crash-order: the v1 record's receipts migrated to state BEFORE the v2 rewrite",
		migrated.lastEnqueuedAt === E_ISO && migrated.lastReadAt === R_ISO,
	);
	const onDisk = parseMetaRecordAny(fs.readFileSync(path.join(sessionsDir, `${v1.gardenId}.meta.json`), "utf8"));
	ok("crash-order: on-disk record is v2 (delivery gone)", onDisk.schemaVersion === META_SCHEMA_VERSION_V2);

	// --- F: crash-order safety — a drift'd state makes migrate throw, record stays v1
	const sessionsDir2 = path.join(tmpRoot, "sessions-f");
	fs.mkdirSync(sessionsDir2, { recursive: true });
	const mbxF = path.join(tmpRoot, "mbx-f");
	const v1b = markEnqueued(
		mintMetaRecord(
			{ backend: "claude-code", nativeSessionId: "n-drift", transcriptPath: "/t.jsonl", cwd: "/c" },
			new Date(E_ISO),
		),
		new Date(E_ISO),
	);
	fs.writeFileSync(path.join(sessionsDir2, `${v1b.gardenId}.meta.json`), serializeMetaRecord(v1b));
	// plant a drift'd state.json (body claims a DIFFERENT citizen) under v1b's gardenId
	fs.mkdirSync(path.dirname(mailboxReceiptStatePath(mbxF, v1b.gardenId)), { recursive: true });
	fs.writeFileSync(
		mailboxReceiptStatePath(mbxF, v1b.gardenId),
		serializeMailboxReceiptState(emptyMailboxReceiptState("20260301T120000-dddddd")),
	);
	throws("crash-order safety: a drift'd state makes the migrate (hence upsert) throw", () =>
		upsertMetaSession({
			dir: sessionsDir2,
			mailboxDir: mbxF,
			input: { backend: "claude-code", nativeSessionId: "n-drift", cwd: "/c" },
			now: new Date(R_ISO),
		}),
	);
	const stillV1 = parseMetaRecordAny(fs.readFileSync(path.join(sessionsDir2, `${v1b.gardenId}.meta.json`), "utf8"));
	ok(
		"crash-order safety: record is STILL v1 (v2 rewrite not reached → next attach re-migrates)",
		stillV1.schemaVersion === META_SCHEMA_VERSION,
	);

	// --- G: create + attach v2→v2 do NOT migrate (no state.json) ---------------
	// A fresh create writes v2 with no v1 delivery to migrate; a later attach over the
	// now-v2 record sees raw.schemaVersion===v2, so the migration branch never runs.
	const sessionsDir3 = path.join(tmpRoot, "sessions-g");
	fs.mkdirSync(sessionsDir3, { recursive: true });
	const mbxG = path.join(tmpRoot, "mbx-g");
	const created = upsertMetaSession({
		dir: sessionsDir3,
		mailboxDir: mbxG,
		input: { backend: "claude-code", nativeSessionId: "n-fresh", cwd: "/c" },
		now: new Date(E_ISO),
	});
	ok(
		"create: a fresh v2 create does not migrate (state.json not created)",
		!fs.existsSync(mailboxReceiptStatePath(mbxG, created.record.gardenId)),
	);
	upsertMetaSession({
		dir: sessionsDir3,
		mailboxDir: mbxG,
		input: { backend: "claude-code", nativeSessionId: "n-fresh", cwd: "/c2" },
		now: new Date(R_ISO),
	});
	ok(
		"attach v2→v2: no migration (raw is v2, state.json still absent)",
		!fs.existsSync(mailboxReceiptStatePath(mbxG, created.record.gardenId)),
	);
} finally {
	fs.rmSync(tmpRoot, { recursive: true, force: true });
}

console.log(`[check-meta-migration] ${passed} assertions ok`);
