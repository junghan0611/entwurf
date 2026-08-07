/**
 * check-meta-session — deterministic gate for the 1.0.0 meta-bridge record
 * authority (step 2). Pure functions + a real temp-dir scan; no backend, no
 * network, no hook. Safe in the `pnpm check` static floor.
 *
 * Proves the STORE contract the hook/CLI/mailbox stand on (V3-only; the pure
 * record read/write contract is check-meta-v3-record, the consumer seam is
 * check-meta-identity-consumers):
 *   - decideUpsert keys on record existence (idempotent), refuses identity drift;
 *   - upsertMetaSession creates/attaches atomically on the real fs (v3 bytes);
 *   - mailbox enqueue/read + the honest receipt state;
 *   - the env-derived store/mailbox default dirs.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import os from "node:os";
import path from "node:path";
import {
	decideUpsert,
	defaultMetaMailboxDir,
	defaultMetaSessionsDir,
	enqueueMetaMessage,
	META_SCHEMA_VERSION_V3,
	type MetaIdentityMintInput,
	MetaRecordError,
	metaRecordFilename,
	mintMetaIdentity,
	parseMetaIdentity,
	publishExclusiveIdentity,
	readMailboxReceiptState,
	readMetaInbox,
	serializeMetaIdentity,
	upsertMetaSession,
} from "../pi-extensions/lib/meta-session.ts";

const SESSION_ID_RE = /^\d{8}T\d{6}-[0-9a-f]{6}$/;
const T0 = new Date("2026-06-05T05:00:00.000Z");
const T1 = new Date("2026-06-05T06:30:00.000Z");

let assertions = 0;
function check(label: string, fn: () => void): void {
	fn();
	assertions += 1;
	process.stdout.write(`[check-meta-session] ${label}: ok\n`);
}

function claudeInput(overrides: Partial<MetaIdentityMintInput> = {}): MetaIdentityMintInput {
	return {
		backend: "claude-code",
		nativeSessionId: "11111111-1111-4111-8111-111111111111",
		transcriptPath: "/home/u/.claude/projects/-home-u-proj/11111111.jsonl",
		cwd: "/home/u/proj",
		...overrides,
	};
}

function expectThrows(label: string, fn: () => void): void {
	check(label, () => {
		assert.throws(fn, MetaRecordError, `${label}: expected MetaRecordError`);
	});
}

// ---------------------------------------------------------------- decideUpsert
check("decideUpsert: absent → create, fresh garden id", () => {
	const dec = decideUpsert(null, claudeInput(), T0);
	assert.equal(dec.action, "create");
	assert.match(dec.record.gardenId, SESSION_ID_RE);
});

check("decideUpsert: present → attach, identity preserved, recordUpdatedAt refreshed (v2)", () => {
	const created = decideUpsert(null, claudeInput(), T0).record;
	const moved = claudeInput({ transcriptPath: "/new/path.jsonl", cwd: "/new/cwd" });
	const dec = decideUpsert(created, moved, T1);
	assert.equal(dec.action, "attach");
	assert.equal(dec.record.schemaVersion, META_SCHEMA_VERSION_V3); // v3 identity
	assert.equal(dec.record.gardenId, created.gardenId); // same id
	assert.equal(dec.record.createdAt, created.createdAt); // birth preserved
	assert.equal(dec.record.recordUpdatedAt, T1.toISOString()); // refreshed (NOT lastSeen)
	assert.equal(dec.record.transcriptPath, "/new/path.jsonl"); // string set
	assert.equal(dec.record.cwd, "/new/cwd");
});

check("decideUpsert: 3-value attach merge — undefined keeps, null clears, string sets (G5)", () => {
	const created = decideUpsert(null, claudeInput({ transcriptPath: "/orig.jsonl" }), T0).record;
	assert.equal(created.transcriptPath, "/orig.jsonl");
	// undefined transcriptPath → KEEP existing (a pi-birth caller must not wipe it)
	const kept = decideUpsert(
		created,
		{ backend: "claude-code", nativeSessionId: created.nativeSessionId, cwd: "/c" },
		T1,
	);
	assert.equal(kept.record.transcriptPath, "/orig.jsonl", "undefined keeps existing");
	// explicit null → CLEAR
	const cleared = decideUpsert(
		created,
		{ backend: "claude-code", nativeSessionId: created.nativeSessionId, cwd: "/c", transcriptPath: null },
		T1,
	);
	assert.equal(cleared.record.transcriptPath, null, "explicit null clears");
});

check("decideUpsert: idempotent — create then attach never mints a 2nd id", () => {
	const first = decideUpsert(null, claudeInput(), T0).record;
	const second = decideUpsert(first, claudeInput(), T1);
	assert.equal(second.action, "attach");
	assert.equal(second.record.gardenId, first.gardenId);
});

expectThrows("decideUpsert: nativeSessionId mismatch throws (wrong scan key)", () => {
	const created = decideUpsert(null, claudeInput(), T0).record;
	decideUpsert(created, claudeInput({ nativeSessionId: "different-id" }), T1);
});

expectThrows("decideUpsert: backend drift for same native id throws", () => {
	const created = decideUpsert(null, claudeInput(), T0).record;
	// same nativeSessionId, different backend → corruption
	decideUpsert(created, claudeInput({ backend: "codex" }), T1);
});

// ---------------------------------------------------------------- upsertMetaSession (real fs, step 3)
check("upsertMetaSession: first call creates a record on disk", () => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "meta-session-store-"));
	try {
		const res = upsertMetaSession({ dir, input: claudeInput(), now: T0 });
		assert.equal(res.action, "create");
		assert.equal(res.record.schemaVersion, META_SCHEMA_VERSION_V3); // writes v3
		assert.equal(res.path, path.join(dir, `${res.record.gardenId}.meta.json`));
		assert.ok(fs.existsSync(res.path));
		// on-disk bytes parse back (V3-only) to the same v3 identity
		assert.deepEqual(parseMetaIdentity(fs.readFileSync(res.path, "utf8")), res.record);
	} finally {
		fs.rmSync(dir, { recursive: true, force: true });
	}
});

check("upsertMetaSession: second call attaches — same file/id, recordUpdatedAt refreshed, no 2nd file", () => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "meta-session-store-"));
	try {
		const first = upsertMetaSession({ dir, input: claudeInput(), now: T0 });
		const moved = claudeInput({ transcriptPath: "/moved/path.jsonl", cwd: "/moved/cwd" });
		const second = upsertMetaSession({ dir, input: moved, now: T1 });
		assert.equal(second.action, "attach");
		assert.equal(second.record.gardenId, first.record.gardenId); // same id
		assert.equal(second.path, first.path); // same file, rewritten in place
		assert.equal(second.record.createdAt, T0.toISOString()); // birth preserved
		assert.equal(second.record.recordUpdatedAt, T1.toISOString()); // refreshed (NOT lastSeen)
		assert.equal(second.record.transcriptPath, "/moved/path.jsonl");
		// exactly ONE .meta.json on disk (idempotent — no shadow record)
		const metas = fs.readdirSync(dir).filter((f) => f.endsWith(".meta.json"));
		assert.deepEqual(metas, [`${first.record.gardenId}.meta.json`]);
	} finally {
		fs.rmSync(dir, { recursive: true, force: true });
	}
});

check("upsertMetaSession: creates the store dir if absent; leaves no .tmp residue", () => {
	const base = fs.mkdtempSync(path.join(os.tmpdir(), "meta-session-store-"));
	const dir = path.join(base, "nested", "meta-sessions"); // does not exist yet
	try {
		const res = upsertMetaSession({ dir, input: claudeInput(), now: T0 });
		assert.ok(fs.existsSync(res.path));
		const residue = fs.readdirSync(dir).filter((f) => f.includes(".tmp-"));
		assert.deepEqual(residue, []); // atomic write cleaned up
	} finally {
		fs.rmSync(base, { recursive: true, force: true });
	}
});

// ---------------------------------------------------------------- exclusive CREATE publish (#66 fail-closed)
check("publishExclusiveIdentity: absent final publishes, round-trips, no tmp residue", () => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "meta-session-excl-"));
	try {
		const record = mintMetaIdentity(claudeInput({ nativeSessionId: "excl-fresh" }), T0);
		const file = path.join(dir, metaRecordFilename(record));
		publishExclusiveIdentity(file, record);
		assert.deepEqual(parseMetaIdentity(fs.readFileSync(file, "utf8")), record, "published bytes round-trip");
		assert.deepEqual(
			fs.readdirSync(dir).filter((f) => f.includes(".tmp-")),
			[],
			"normal exclusive publish leaves no tmp residue",
		);
	} finally {
		fs.rmSync(dir, { recursive: true, force: true });
	}
});

check("publishExclusiveIdentity: pre-planted final REFUSES, victim byte-identical, tmp gone", () => {
	// Deterministic collision fixture: the minted suffix is random, so the public
	// upsert seam cannot be forced onto an occupied final path without a
	// retry/sample trick — the primitive is the production subject here, and the
	// wiring claim below pins upsert's create branch to it.
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "meta-session-excl-"));
	try {
		const victim = mintMetaIdentity(claudeInput({ nativeSessionId: "excl-victim" }), T0);
		const rival = {
			...mintMetaIdentity(claudeInput({ nativeSessionId: "excl-rival" }), T1),
			gardenId: victim.gardenId,
		};
		const file = path.join(dir, metaRecordFilename(victim));
		fs.writeFileSync(file, serializeMetaIdentity(victim));
		const victimBytes = fs.readFileSync(file);
		assert.throws(
			() => publishExclusiveIdentity(file, rival),
			(err: unknown) => {
				assert.ok(err instanceof MetaRecordError, "collision throws MetaRecordError");
				assert.match(err.message, /CREATE collision/, "named collision cause");
				assert.ok(err.message.includes(victim.gardenId), "error names the colliding garden id");
				assert.ok(err.message.includes(file), "error names the occupied record path");
				return true;
			},
			"occupied final path must refuse loud, never replace [QK:META-CREATE-EXCLUSIVE]",
		);
		assert.ok(fs.readFileSync(file).equals(victimBytes), "victim bytes byte-identical");
		assert.deepEqual(
			fs.readdirSync(dir).filter((f) => f.includes(".tmp-")),
			[],
			"collision refusal leaves no tmp residue",
		);
	} finally {
		fs.rmSync(dir, { recursive: true, force: true });
	}
});

/**
 * Measured official patch seam for the two error-contract cells below: patch the
 * default CJS fs object, then `syncBuiltinESMExports()` so the production
 * `import * as fs` namespace binding sees it (measured on this host: the
 * namespace does NOT see the patch before sync, does after, and restores after
 * the finally's sync). A non-EEXIST link errno and a post-publish cleanup
 * failure cannot be forced on the real filesystem synchronously.
 */
function withPatchedFs(method: "linkSync" | "unlinkSync", impl: () => never, fn: () => void): void {
	const real = fs[method];
	(fs as unknown as Record<string, unknown>)[method] = impl;
	syncBuiltinESMExports();
	try {
		fn();
	} finally {
		(fs as unknown as Record<string, unknown>)[method] = real;
		syncBuiltinESMExports();
	}
}

check("publishExclusiveIdentity: non-EEXIST link failure rethrows the ORIGINAL error, tmp cleaned", () => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "meta-session-excl-"));
	try {
		const record = mintMetaIdentity(claudeInput({ nativeSessionId: "excl-eacces" }), T0);
		const file = path.join(dir, metaRecordFilename(record));
		const primary = Object.assign(new Error("EACCES: permission denied, link"), { code: "EACCES" });
		withPatchedFs(
			"linkSync",
			() => {
				throw primary;
			},
			() => {
				assert.throws(
					() => publishExclusiveIdentity(file, record),
					(err: unknown) => {
						assert.equal(err, primary, "the identical original error object is rethrown (errno/cause intact)");
						return true;
					},
					"non-EEXIST link failure must surface the original error, not a translation",
				);
			},
		);
		assert.ok(!fs.existsSync(file), "no final record was published");
		assert.deepEqual(
			fs.readdirSync(dir).filter((f) => f.includes(".tmp-")),
			[],
			"tmp cleaned even when the link failed for a non-EEXIST reason",
		);
	} finally {
		fs.rmSync(dir, { recursive: true, force: true });
	}
});

check("publishExclusiveIdentity: post-link cleanup failure is LOUD, final stays published, no rollback", () => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "meta-session-excl-"));
	try {
		const record = mintMetaIdentity(claudeInput({ nativeSessionId: "excl-cleanup" }), T0);
		const file = path.join(dir, metaRecordFilename(record));
		withPatchedFs(
			"unlinkSync",
			() => {
				throw Object.assign(new Error("EPERM: operation not permitted, unlink"), { code: "EPERM" });
			},
			() => {
				assert.throws(
					() => publishExclusiveIdentity(file, record),
					(err: unknown) => {
						assert.ok(err instanceof MetaRecordError, "cleanup failure throws MetaRecordError");
						assert.match(err.message, /already published/, "states the record IS published");
						assert.match(err.message, /temp cleanup failed/, "names the cleanup failure");
						assert.ok(err.message.includes(".tmp-"), "names the leftover tmp path");
						assert.match(
							err.message,
							/no successful birth\/registration receipt/,
							"states the transport-neutral abort consequence",
						);
						assert.match(err.message, /will ATTACH/, "states the retry semantics");
						return true;
					},
					"a real cleanup failure after publish must be loud, never a false success [QK:META-CREATE-PUBLISHED-CLEANUP]",
				);
			},
		);
		assert.deepEqual(
			parseMetaIdentity(fs.readFileSync(file, "utf8")),
			record,
			"the published final record remains and round-trips (no rollback)",
		);
		assert.equal(
			fs.readdirSync(dir).filter((f) => f.includes(".tmp-")).length,
			1,
			"the tmp the primitive could not clean is still there (honest state)",
		);
	} finally {
		fs.rmSync(dir, { recursive: true, force: true });
	}
});

check("upsertMetaSession: CREATE dispatches to the exclusive publish, ATTACH to the replace write", () => {
	// Structural action-dispatch claim, deliberately minimal: runtime forcing of a
	// create collision through upsertMetaSession is genuinely unavailable without
	// a seam (the gid suffix is drawn from randomBytes inside mint), so the
	// runtime oracles above prove the primitive and this claim proves the wiring.
	const source = fs.readFileSync(new URL("../pi-extensions/lib/meta-session.ts", import.meta.url), "utf8");
	assert.ok(
		source.includes(
			'if (decision.action === "create") publishExclusiveIdentity(file, decision.record);\n\telse atomicWriteIdentity(file, decision.record);',
		),
		"upsertMetaSession must split the write by action: create→exclusive, attach→replace [QK:META-CREATE-WIRING]",
	);
});

expectThrows("upsertMetaSession: duplicate nativeSessionId in the store throws (fail-fast)", () => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "meta-session-store-"));
	try {
		// Two records sharing a nativeSessionId already on disk → ambiguous authority.
		const a = mintMetaIdentity(claudeInput({ nativeSessionId: "dup" }), T0);
		const b = mintMetaIdentity(claudeInput({ nativeSessionId: "dup" }), T1);
		fs.mkdirSync(dir, { recursive: true });
		fs.writeFileSync(path.join(dir, metaRecordFilename(a)), serializeMetaIdentity(a));
		fs.writeFileSync(path.join(dir, metaRecordFilename(b)), serializeMetaIdentity(b));
		upsertMetaSession({ dir, input: claudeInput({ nativeSessionId: "dup" }), now: T1 });
	} finally {
		fs.rmSync(dir, { recursive: true, force: true });
	}
});

check("defaultMetaSessionsDir: honors ENTWURF_META_SESSIONS_DIR then PI_CODING_AGENT_DIR", () => {
	const saved = { m: process.env.ENTWURF_META_SESSIONS_DIR, a: process.env.PI_CODING_AGENT_DIR };
	try {
		process.env.ENTWURF_META_SESSIONS_DIR = "/explicit/meta";
		assert.equal(defaultMetaSessionsDir(), "/explicit/meta");
		process.env.ENTWURF_META_SESSIONS_DIR = "";
		delete process.env.ENTWURF_META_SESSIONS_DIR;
		process.env.PI_CODING_AGENT_DIR = "/iso/agent";
		assert.equal(defaultMetaSessionsDir(), path.join("/iso/agent", "meta-sessions"));
	} finally {
		if (saved.m === undefined) delete process.env.ENTWURF_META_SESSIONS_DIR;
		else process.env.ENTWURF_META_SESSIONS_DIR = saved.m;
		if (saved.a === undefined) delete process.env.PI_CODING_AGENT_DIR;
		else process.env.PI_CODING_AGENT_DIR = saved.a;
	}
});

// ---------------------------------------------------------------- mailbox delivery (step 6)
// A self-contained store+mailbox fixture: mint one citizen, return its dirs + garden id.
function mailboxFixture(): { sessionsDir: string; mailboxDir: string; gardenId: string; cleanup: () => void } {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "meta-mailbox-"));
	const sessionsDir = path.join(root, "meta-sessions");
	const mailboxDir = path.join(root, "meta-mailbox");
	const up = upsertMetaSession({ dir: sessionsDir, input: claudeInput({ nativeSessionId: "mbx-native" }), now: T0 });
	return {
		sessionsDir,
		mailboxDir,
		gardenId: up.record.gardenId,
		cleanup: () => fs.rmSync(root, { recursive: true, force: true }),
	};
}

check("enqueueMetaMessage: writes a .msg, pokes inbox.signal, stamps lastEnqueuedAt", () => {
	const fx = mailboxFixture();
	try {
		const r = enqueueMetaMessage({
			gardenId: fx.gardenId,
			body: "hello",
			sessionsDir: fx.sessionsDir,
			mailboxDir: fx.mailboxDir,
			now: T1,
		});
		assert.ok(fs.existsSync(r.messagePath) && r.messagePath.endsWith(".msg"), "a .msg body is written");
		assert.ok(fs.existsSync(r.signalPath) && r.signalPath.endsWith("inbox.signal"), "inbox.signal is poked");
		const st = readMailboxReceiptState({ gardenId: fx.gardenId, mailboxDir: fx.mailboxDir });
		assert.equal(st.lastEnqueuedAt, T1.toISOString(), "lastEnqueuedAt stamped in mailbox state at enqueue time");
		assert.equal(st.lastReadAt, null, "not read yet");
	} finally {
		fx.cleanup();
	}
});

check("readMetaInbox: drains a fresh .msg, returns the body, stamps lastReadAt (D7 receipt)", () => {
	const fx = mailboxFixture();
	try {
		enqueueMetaMessage({
			gardenId: fx.gardenId,
			body: "drain me",
			sessionsDir: fx.sessionsDir,
			mailboxDir: fx.mailboxDir,
			now: T1,
		});
		const read = readMetaInbox({
			gardenId: fx.gardenId,
			sessionsDir: fx.sessionsDir,
			mailboxDir: fx.mailboxDir,
			now: T1,
		});
		assert.equal(read.messages.length, 1, "one message read");
		assert.equal(read.messages[0]?.body, "drain me", "body intact");
		assert.equal(read.readAt, T1.toISOString(), "readAt returned");
		const st = readMailboxReceiptState({ gardenId: fx.gardenId, mailboxDir: fx.mailboxDir });
		assert.equal(st.lastReadAt, T1.toISOString(), "lastReadAt stamped in mailbox state = the honest read receipt");
		// #5 honesty: lastDeliveredAt is the doorbell's to stamp; readMetaInbox must NOT invent it.
		assert.equal(st.lastDeliveredAt, null, "lastDeliveredAt left null (read does not record a delivery time)");
	} finally {
		fx.cleanup();
	}
});

check("readMetaInbox: drains a doorbell-rung .msg.delivered too", () => {
	const fx = mailboxFixture();
	try {
		const dir = path.join(fx.mailboxDir, fx.gardenId);
		fs.mkdirSync(dir, { recursive: true });
		fs.writeFileSync(path.join(dir, "x.msg.delivered"), "via doorbell");
		const read = readMetaInbox({
			gardenId: fx.gardenId,
			sessionsDir: fx.sessionsDir,
			mailboxDir: fx.mailboxDir,
			now: T1,
		});
		assert.equal(read.messages.length, 1, "the .msg.delivered is read");
		assert.equal(read.messages[0]?.body, "via doorbell");
	} finally {
		fx.cleanup();
	}
});

check("readMetaInbox: ONE drain returns ALL queued bodies in order (level-triggered body state; #34 D8 basis)", () => {
	const fx = mailboxFixture();
	try {
		// Three messages land while the session is idle. The wake SIGNAL
		// (inbox.signal) is edge-triggered and can coalesce N rapid pokes into a
		// single FileChanged. Each BODY is a separate level-state file on disk, so
		// a later wake/read drains the whole directory instead of trusting the number
		// of signal edges. A fully lost doorbell can still leave an idle-forever
		// unread backlog; #34 tracks that heartbeat/re-poke backstop separately.
		// This gate asserts the deterministic robustness basis: once the receiver
		// self-fetches, it gets every queued body, including both fresh .msg and
		// doorbell-rung .msg.delivered files.
		const t1 = new Date("2026-06-05T06:30:00.000Z");
		const t2 = new Date("2026-06-05T06:31:00.000Z");
		const t3 = new Date("2026-06-05T06:32:00.000Z");
		const t4 = new Date("2026-06-05T06:33:00.000Z");
		enqueueMetaMessage({
			gardenId: fx.gardenId,
			body: "first",
			sessionsDir: fx.sessionsDir,
			mailboxDir: fx.mailboxDir,
			now: t1,
		});
		enqueueMetaMessage({
			gardenId: fx.gardenId,
			body: "second",
			sessionsDir: fx.sessionsDir,
			mailboxDir: fx.mailboxDir,
			now: t2,
		});
		// The third one's doorbell DID ring: FileChanged moved .msg -> .msg.delivered.
		const third = enqueueMetaMessage({
			gardenId: fx.gardenId,
			body: "third",
			sessionsDir: fx.sessionsDir,
			mailboxDir: fx.mailboxDir,
			now: t3,
		});
		fs.renameSync(third.messagePath, `${third.messagePath}.delivered`);

		const read = readMetaInbox({
			gardenId: fx.gardenId,
			sessionsDir: fx.sessionsDir,
			mailboxDir: fx.mailboxDir,
			now: t4,
		});
		assert.equal(read.messages.length, 3, "a single read drains all three queued bodies");
		assert.deepEqual(
			read.messages.map((m) => m.body),
			["first", "second", "third"],
			"timestamp-distinct bodies drain in deterministic filename order",
		);
		// One batch, one honest receipt — NOT one-per-message.
		const st = readMailboxReceiptState({ gardenId: fx.gardenId, mailboxDir: fx.mailboxDir });
		assert.equal(st.lastReadAt, t4.toISOString(), "a single lastReadAt receipt for the whole batch");
		// Every body archived to .read; nothing unread remains; re-read is empty.
		const dir = path.join(fx.mailboxDir, fx.gardenId);
		const stillUnread = fs.readdirSync(dir).filter((f) => f.endsWith(".msg") || f.endsWith(".msg.delivered"));
		assert.equal(stillUnread.length, 0, "no unread body remains after the batch drain (all archived to .read)");
		assert.equal(
			readMetaInbox({ gardenId: fx.gardenId, sessionsDir: fx.sessionsDir, mailboxDir: fx.mailboxDir, now: t4 }).messages
				.length,
			0,
			"re-read after the batch drain is empty (idempotent consume)",
		);
	} finally {
		fx.cleanup();
	}
});

check("readMetaInbox: empty inbox returns nothing AND mutates no receipt; re-read after drain is empty", () => {
	const fx = mailboxFixture();
	try {
		// empty read: no message, no receipt
		const empty = readMetaInbox({
			gardenId: fx.gardenId,
			sessionsDir: fx.sessionsDir,
			mailboxDir: fx.mailboxDir,
			now: T1,
		});
		assert.equal(empty.messages.length, 0, "empty inbox: no messages");
		assert.equal(empty.readAt, null, "empty inbox: no receipt stamped");
		assert.equal(
			readMailboxReceiptState({ gardenId: fx.gardenId, mailboxDir: fx.mailboxDir }).lastReadAt,
			null,
			"empty read leaves lastReadAt null (state.json not created)",
		);
		// enqueue + drain, then re-read must be empty (archived to .read, not double-returned)
		enqueueMetaMessage({
			gardenId: fx.gardenId,
			body: "once",
			sessionsDir: fx.sessionsDir,
			mailboxDir: fx.mailboxDir,
			now: T1,
		});
		assert.equal(
			readMetaInbox({ gardenId: fx.gardenId, sessionsDir: fx.sessionsDir, mailboxDir: fx.mailboxDir, now: T1 }).messages
				.length,
			1,
			"first drain returns it",
		);
		assert.equal(
			readMetaInbox({ gardenId: fx.gardenId, sessionsDir: fx.sessionsDir, mailboxDir: fx.mailboxDir, now: T1 }).messages
				.length,
			0,
			"re-read is empty",
		);
	} finally {
		fx.cleanup();
	}
});

expectThrows("enqueueMetaMessage: unknown garden id fails loud (not a citizen)", () => {
	const fx = mailboxFixture();
	try {
		enqueueMetaMessage({
			gardenId: "20200101T000000-aaaaaa",
			body: "x",
			sessionsDir: fx.sessionsDir,
			mailboxDir: fx.mailboxDir,
			now: T1,
		});
	} finally {
		fx.cleanup();
	}
});

expectThrows("enqueueMetaMessage: empty body fails loud", () => {
	const fx = mailboxFixture();
	try {
		enqueueMetaMessage({
			gardenId: fx.gardenId,
			body: "",
			sessionsDir: fx.sessionsDir,
			mailboxDir: fx.mailboxDir,
			now: T1,
		});
	} finally {
		fx.cleanup();
	}
});

check("defaultMetaMailboxDir: sibling of meta-sessions under the pi agent dir", () => {
	const saved = { m: process.env.ENTWURF_META_MAILBOX_DIR, a: process.env.PI_CODING_AGENT_DIR };
	try {
		process.env.ENTWURF_META_MAILBOX_DIR = "/explicit/mbx";
		assert.equal(defaultMetaMailboxDir(), "/explicit/mbx");
		delete process.env.ENTWURF_META_MAILBOX_DIR;
		process.env.PI_CODING_AGENT_DIR = "/iso/agent";
		assert.equal(defaultMetaMailboxDir(), path.join("/iso/agent", "meta-mailbox"));
	} finally {
		if (saved.m === undefined) delete process.env.ENTWURF_META_MAILBOX_DIR;
		else process.env.ENTWURF_META_MAILBOX_DIR = saved.m;
		if (saved.a === undefined) delete process.env.PI_CODING_AGENT_DIR;
		else process.env.PI_CODING_AGENT_DIR = saved.a;
	}
});

process.stdout.write(`[check-meta-session] ${assertions} assertions ok\n`);
