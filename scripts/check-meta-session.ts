/**
 * check-meta-session — deterministic gate for the 1.0.0 meta-bridge record
 * authority (step 2). Pure functions + a real temp-dir scan; no backend, no
 * network, no hook. Safe in the `pnpm check` static floor.
 *
 * Proves the contract the later hook/CLI/mailbox steps build on:
 *   - mint stamps a valid garden id + seeded read-receipt slot;
 *   - serialize is deterministic and round-trips through parse;
 *   - parse crashes (not warns) on every malformed shape;
 *   - scanByNativeId is the lookup AUTHORITY by record BODY, never by filename;
 *   - decideUpsert keys on record existence (idempotent), refuses identity drift;
 *   - the pre-drilled read-receipt mutators touch only their own field.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
	decideUpsert,
	defaultMetaMailboxDir,
	defaultMetaSessionsDir,
	enqueueMetaMessage,
	META_BACKEND_DESCRIPTORS,
	META_SCHEMA_VERSION,
	META_SCHEMA_VERSION_V2,
	type MetaMintInput,
	MetaRecordError,
	markDelivered,
	markEnqueued,
	markRead,
	metaRecordFilename,
	mintMetaRecord,
	parseMetaIdentity,
	parseMetaRecord,
	readMailboxReceiptState,
	readMetaInbox,
	readMetaRecordV1ByGardenId,
	scanByNativeId,
	serializeMetaRecord,
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

function claudeInput(overrides: Partial<MetaMintInput> = {}): MetaMintInput {
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

// ---------------------------------------------------------------- mint
check("mint: garden id matches the SSOT grammar", () => {
	const r = mintMetaRecord(claudeInput(), T0);
	assert.match(r.gardenId, SESSION_ID_RE);
});

check("mint: createdAt == lastSeen at birth, ISO from `now`", () => {
	const r = mintMetaRecord(claudeInput(), T0);
	assert.equal(r.createdAt, T0.toISOString());
	assert.equal(r.lastSeen, T0.toISOString());
});

check("mint: delivery slot seeded from backend descriptor, receipts null", () => {
	const r = mintMetaRecord(claudeInput(), T0);
	const d = META_BACKEND_DESCRIPTORS["claude-code"];
	assert.equal(r.delivery.wakeMode, d.wakeMode);
	assert.equal(r.delivery.wakeMode, "self-fetch");
	assert.equal(r.delivery.deliveryLevel, d.deliveryLevel);
	assert.equal(r.delivery.lastEnqueuedAt, null);
	assert.equal(r.delivery.lastDeliveredAt, null);
	assert.equal(r.delivery.lastReadAt, null);
	assert.equal(r.schemaVersion, META_SCHEMA_VERSION);
});

check("mint: agy/codex direct-inject descriptors differ from claude self-fetch", () => {
	const agy = mintMetaRecord(claudeInput({ backend: "antigravity", nativeSessionId: "agy-conv-1" }), T0);
	const codex = mintMetaRecord(claudeInput({ backend: "codex", nativeSessionId: "codex-thread-1" }), T0);
	assert.equal(agy.delivery.wakeMode, "direct-inject");
	assert.equal(codex.delivery.wakeMode, "direct-inject");
});

expectThrows("mint: empty nativeSessionId throws", () => mintMetaRecord(claudeInput({ nativeSessionId: "" }), T0));
expectThrows("mint: empty transcriptPath throws", () => mintMetaRecord(claudeInput({ transcriptPath: "" }), T0));
expectThrows("mint: empty cwd throws", () => mintMetaRecord(claudeInput({ cwd: "" }), T0));
expectThrows("mint: bad backend throws", () =>
	mintMetaRecord(claudeInput({ backend: "gemini" as unknown as MetaMintInput["backend"] }), T0),
);

// ---------------------------------------------------------------- serialize / parse
check("serialize: deterministic (same record → byte-identical)", () => {
	const r = mintMetaRecord(claudeInput(), T0);
	assert.equal(serializeMetaRecord(r), serializeMetaRecord(r));
});

check("serialize → parse round-trips to a deep-equal record", () => {
	const r = mintMetaRecord(claudeInput(), T0);
	assert.deepEqual(parseMetaRecord(serializeMetaRecord(r)), r);
});

check("serialize: trailing newline, 2-space indent, stable key order", () => {
	const r = mintMetaRecord(claudeInput(), T0);
	const text = serializeMetaRecord(r);
	assert.ok(text.endsWith("}\n"));
	const keys = Object.keys(JSON.parse(text));
	assert.deepEqual(keys, [
		"schemaVersion",
		"gardenId",
		"backend",
		"nativeSessionId",
		"transcriptPath",
		"cwd",
		"createdAt",
		"lastSeen",
		"delivery",
	]);
});

expectThrows("parse: invalid JSON throws", () => parseMetaRecord("{not json"));
expectThrows("parse: array (non-object) throws", () => parseMetaRecord("[]"));
expectThrows("parse: wrong schemaVersion throws", () => {
	const r = mintMetaRecord(claudeInput(), T0);
	const bad = JSON.parse(serializeMetaRecord(r));
	bad.schemaVersion = 2;
	parseMetaRecord(JSON.stringify(bad));
});
expectThrows("parse: malformed gardenId throws", () => {
	const r = mintMetaRecord(claudeInput(), T0);
	const bad = JSON.parse(serializeMetaRecord(r));
	bad.gardenId = "not-a-garden-id";
	parseMetaRecord(JSON.stringify(bad));
});
expectThrows("parse: unknown backend throws", () => {
	const r = mintMetaRecord(claudeInput(), T0);
	const bad = JSON.parse(serializeMetaRecord(r));
	bad.backend = "openai";
	parseMetaRecord(JSON.stringify(bad));
});
expectThrows("parse: missing nativeSessionId throws", () => {
	const r = mintMetaRecord(claudeInput(), T0);
	const bad = JSON.parse(serializeMetaRecord(r));
	delete bad.nativeSessionId;
	parseMetaRecord(JSON.stringify(bad));
});
expectThrows("parse: bad delivery.wakeMode throws", () => {
	const r = mintMetaRecord(claudeInput(), T0);
	const bad = JSON.parse(serializeMetaRecord(r));
	bad.delivery.wakeMode = "magic";
	parseMetaRecord(JSON.stringify(bad));
});
expectThrows("parse: delivery not an object throws", () => {
	const r = mintMetaRecord(claudeInput(), T0);
	const bad = JSON.parse(serializeMetaRecord(r));
	bad.delivery = "nope";
	parseMetaRecord(JSON.stringify(bad));
});
expectThrows("parse: backend↔wakeMode contradiction throws (claude record claiming direct-inject)", () => {
	const r = mintMetaRecord(claudeInput(), T0); // claude-code → self-fetch
	const bad = JSON.parse(serializeMetaRecord(r));
	bad.delivery.wakeMode = "direct-inject"; // valid mode, wrong for this backend
	parseMetaRecord(JSON.stringify(bad));
});
check("parse: matching backend↔wakeMode round-trips (codex direct-inject)", () => {
	const r = mintMetaRecord(claudeInput({ backend: "codex", nativeSessionId: "codex-thread-X" }), T0);
	assert.deepEqual(parseMetaRecord(serializeMetaRecord(r)), r);
});

// ---------------------------------------------------------------- filename
check("metaRecordFilename: <gardenId>.meta.json", () => {
	const r = mintMetaRecord(claudeInput(), T0);
	assert.equal(metaRecordFilename(r), `${r.gardenId}.meta.json`);
});

// ---------------------------------------------------------------- scanByNativeId (in-memory)
check("scanByNativeId: ignores non-.meta.json entries", () => {
	const r = mintMetaRecord(claudeInput(), T0);
	const reader = (f: string) => {
		if (f === "x.meta.json") return serializeMetaRecord(r);
		throw new Error(`unexpected read ${f}`);
	};
	const found = scanByNativeId(["README.md", "notes.txt", "x.meta.json"], r.nativeSessionId, reader);
	assert.deepEqual(found, r);
});

check("scanByNativeId: returns null when no body matches", () => {
	const r = mintMetaRecord(claudeInput(), T0);
	const found = scanByNativeId(["a.meta.json"], "no-such-native-id", () => serializeMetaRecord(r));
	assert.equal(found, null);
});

check("scanByNativeId: malformed entry is skipped via onSkip, scan continues", () => {
	const good = mintMetaRecord(claudeInput(), T0);
	const skipped: string[] = [];
	const reader = (f: string) => (f === "bad.meta.json" ? "{broken" : serializeMetaRecord(good));
	const found = scanByNativeId(["bad.meta.json", "good.meta.json"], good.nativeSessionId, reader, (f) =>
		skipped.push(f),
	);
	assert.deepEqual(found, good);
	assert.deepEqual(skipped, ["bad.meta.json"]);
});

expectThrows("scanByNativeId: duplicate nativeSessionId is authority ambiguity → throws", () => {
	// Two records (different garden ids) claiming the SAME nativeSessionId. The
	// native→garden mapping must be unique; the scan must fail-fast, not pick one.
	const a = mintMetaRecord(claudeInput({ nativeSessionId: "dup-native" }), T0);
	const b = mintMetaRecord(claudeInput({ nativeSessionId: "dup-native" }), T1);
	assert.notEqual(a.gardenId, b.gardenId);
	const reader = (f: string) => (f === "a.meta.json" ? serializeMetaRecord(a) : serializeMetaRecord(b));
	scanByNativeId(["a.meta.json", "b.meta.json"], "dup-native", reader);
});

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
	assert.equal(dec.record.schemaVersion, META_SCHEMA_VERSION_V2); // v2 identity
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

expectThrows("decideUpsert: non-boolean isEntwurf throws (runtime guard, not coerced)", () => {
	decideUpsert(null, { ...claudeInput(), isEntwurf: "yes" as unknown as boolean }, T0);
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

// ---------------------------------------------------------------- read-receipt mutators
check("read-receipt mutators touch only their own field", () => {
	const base = mintMetaRecord(claudeInput(), T0);
	const enq = markEnqueued(base, T1);
	assert.equal(enq.delivery.lastEnqueuedAt, T1.toISOString());
	assert.equal(enq.delivery.lastDeliveredAt, null);
	assert.equal(enq.delivery.lastReadAt, null);

	const del = markDelivered(enq, T1);
	assert.equal(del.delivery.lastDeliveredAt, T1.toISOString());
	assert.equal(del.delivery.lastReadAt, null);

	const read = markRead(del, T1);
	assert.equal(read.delivery.lastReadAt, T1.toISOString());
	// original untouched (pure)
	assert.equal(base.delivery.lastEnqueuedAt, null);
});

// ---------------------------------------------------------------- temp-dir: authority = body, not filename
check("temp-dir scan: authority is record BODY, not filename", () => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "meta-session-scan-"));
	try {
		const a = mintMetaRecord(claudeInput({ nativeSessionId: "native-A" }), T0);
		const b = mintMetaRecord(claudeInput({ backend: "codex", nativeSessionId: "native-B" }), T1);
		// Write A under its honest filename, but B under a DECOY filename whose
		// garden id does not match B's body — a filename-parser would be fooled.
		fs.writeFileSync(path.join(dir, metaRecordFilename(a)), serializeMetaRecord(a));
		const decoyName = "19990101T000000-deadbe.meta.json";
		assert.notEqual(decoyName, metaRecordFilename(b));
		fs.writeFileSync(path.join(dir, decoyName), serializeMetaRecord(b));
		fs.writeFileSync(path.join(dir, "unrelated.txt"), "noise");

		const entries = fs.readdirSync(dir);
		const reader = (f: string) => fs.readFileSync(path.join(dir, f), "utf8");

		const foundA = scanByNativeId(entries, "native-A", reader);
		assert.ok(foundA && foundA.gardenId === a.gardenId);
		// B is found by BODY nativeSessionId despite the decoy filename.
		const foundB = scanByNativeId(entries, "native-B", reader);
		assert.ok(foundB && foundB.gardenId === b.gardenId && foundB.backend === "codex");
		assert.equal(scanByNativeId(entries, "native-Z", reader), null);
	} finally {
		fs.rmSync(dir, { recursive: true, force: true });
	}
});

// ---------------------------------------------------------------- upsertMetaSession (real fs, step 3)
check("upsertMetaSession: first call creates a record on disk", () => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "meta-session-store-"));
	try {
		const res = upsertMetaSession({ dir, input: claudeInput(), now: T0 });
		assert.equal(res.action, "create");
		assert.equal(res.record.schemaVersion, META_SCHEMA_VERSION_V2); // writes v2
		assert.equal(res.path, path.join(dir, `${res.record.gardenId}.meta.json`));
		assert.ok(fs.existsSync(res.path));
		// on-disk bytes parse back (dual-read) to the same v2 identity
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

expectThrows("upsertMetaSession: duplicate nativeSessionId in the store throws (fail-fast)", () => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "meta-session-store-"));
	try {
		// Two records sharing a nativeSessionId already on disk → ambiguous authority.
		const a = mintMetaRecord(claudeInput({ nativeSessionId: "dup" }), T0);
		const b = mintMetaRecord(claudeInput({ nativeSessionId: "dup" }), T1);
		fs.writeFileSync(path.join(dir, metaRecordFilename(a)), serializeMetaRecord(a));
		fs.writeFileSync(path.join(dir, metaRecordFilename(b)), serializeMetaRecord(b));
		upsertMetaSession({ dir, input: claudeInput({ nativeSessionId: "dup" }), now: T1 });
	} finally {
		fs.rmSync(dir, { recursive: true, force: true });
	}
});

check("defaultMetaSessionsDir: honors PI_META_SESSIONS_DIR then PI_CODING_AGENT_DIR", () => {
	const saved = { m: process.env.PI_META_SESSIONS_DIR, a: process.env.PI_CODING_AGENT_DIR };
	try {
		process.env.PI_META_SESSIONS_DIR = "/explicit/meta";
		assert.equal(defaultMetaSessionsDir(), "/explicit/meta");
		process.env.PI_META_SESSIONS_DIR = "";
		delete process.env.PI_META_SESSIONS_DIR;
		process.env.PI_CODING_AGENT_DIR = "/iso/agent";
		assert.equal(defaultMetaSessionsDir(), path.join("/iso/agent", "meta-sessions"));
	} finally {
		if (saved.m === undefined) delete process.env.PI_META_SESSIONS_DIR;
		else process.env.PI_META_SESSIONS_DIR = saved.m;
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

expectThrows("readMetaRecordV1ByGardenId: body/filename gardenId drift is corruption (body is SSOT)", () => {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "meta-drift-"));
	try {
		const sessionsDir = path.join(root, "meta-sessions");
		fs.mkdirSync(sessionsDir, { recursive: true });
		// A record whose BODY gardenId differs from the <id>.meta.json filename it lives in.
		const rec = mintMetaRecord(claudeInput({ nativeSessionId: "drift" }), T0);
		const wrongName = "20200101T000000-bbbbbb.meta.json"; // filename id != rec.gardenId
		fs.writeFileSync(path.join(sessionsDir, wrongName), serializeMetaRecord(rec));
		readMetaRecordV1ByGardenId("20200101T000000-bbbbbb", sessionsDir);
	} finally {
		fs.rmSync(root, { recursive: true, force: true });
	}
});

check("defaultMetaMailboxDir: sibling of meta-sessions under the pi agent dir", () => {
	const saved = { m: process.env.PI_META_MAILBOX_DIR, a: process.env.PI_CODING_AGENT_DIR };
	try {
		process.env.PI_META_MAILBOX_DIR = "/explicit/mbx";
		assert.equal(defaultMetaMailboxDir(), "/explicit/mbx");
		delete process.env.PI_META_MAILBOX_DIR;
		process.env.PI_CODING_AGENT_DIR = "/iso/agent";
		assert.equal(defaultMetaMailboxDir(), path.join("/iso/agent", "meta-mailbox"));
	} finally {
		if (saved.m === undefined) delete process.env.PI_META_MAILBOX_DIR;
		else process.env.PI_META_MAILBOX_DIR = saved.m;
		if (saved.a === undefined) delete process.env.PI_CODING_AGENT_DIR;
		else process.env.PI_CODING_AGENT_DIR = saved.a;
	}
});

process.stdout.write(`[check-meta-session] ${assertions} assertions ok\n`);
