/**
 * check-entwurf-mailbox-guard — deterministic gate for the guarded mailbox enqueue
 * (SE-1/SE-2 slice 2d). The IO orchestration that conversational-reply sites use
 * instead of calling enqueueMetaMessage directly: it must NOT enqueue (no .msg, no
 * doorbell poke, no mailbox mutation) when the target is undeliverable, and must
 * enqueue exactly once when it is.
 *
 * Proves (GPT Q5 — both axes):
 *   1. PURE 0-call: with injected facts/readers, an undeliverable target leaves the
 *      injected enqueue UNCALLED (dead receiver / direct-inject / absent record);
 *      a deliverable target calls it exactly once and carries the result through.
 *   2. TMPDIR SNAPSHOT: with the REAL enqueueMetaMessage against a real mailbox dir,
 *      a refused send leaves the mailbox tree byte-for-byte unchanged (file list +
 *      content hash, not just mtime), and an accepted send writes exactly one .msg +
 *      pokes the signal.
 *   3. fact gathering: recordBacked/wakeMode from the record+capability, ownerAlive/
 *      watchArmed from the receiver marker (present→true, absent/dead→false).
 */

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { gatherMailboxDeliverabilityFacts, guardedMailboxEnqueue } from "../pi-extensions/lib/entwurf-mailbox-guard.ts";
import {
	enqueueMetaMessage,
	type MetaIdentity,
	mintMetaIdentity,
	readMetaReceiverMarker,
	serializeMetaIdentity,
	writeMetaReceiverMarker,
} from "../pi-extensions/lib/meta-session.ts";

let passed = 0;
function ok(label: string, cond: boolean): void {
	assert.ok(cond, label);
	console.log(`  ok    ${label}`);
	passed++;
}

const REPO_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const GARDEN = "20260614T120000-aaaaaa";
const selfFetch = () => ({ wakeMode: "self-fetch" }) as never;
const directInject = () => ({ wakeMode: "direct-inject" }) as never;
// The record identity and the marker MUST agree on garden/backend/native id — that
// agreement is what SE-2 2d-3 now requires (a present marker alone is not enough). Built
// from a fixed garden id (NOT mintMetaIdentity, which would generate a random gardenId that
// never matches GARDEN — the old presence-only test silently ignored that mismatch).
const liveIdentity = (): MetaIdentity => ({
	schemaVersion: 3,
	gardenId: GARDEN,
	backend: "claude-code",
	nativeSessionId: "n-a",
	cwd: "/tmp",
	model: null,
	transcriptPath: null,
	createdAt: "2026-06-14T01:00:00.000Z",
	recordUpdatedAt: "2026-06-14T01:00:00.000Z",
});
const liveMarker = () =>
	({
		gardenId: GARDEN,
		backend: "claude-code",
		nativeSessionId: "n-a",
		ownerPid: 1,
		ownerStartKey: "x",
		ownerKind: "claude-code-cli",
		armProvenance: "session-start",
		updatedAt: "t",
	}) as never;
// Same shape as liveMarker but with a drifted native id → does NOT match the record
// identity ("n-a") → SE-2 2d-3 treats it as a stale/foreign marker (inactive receiver).
const driftMarker = () =>
	({
		gardenId: GARDEN,
		backend: "claude-code",
		nativeSessionId: "n-OTHER",
		ownerPid: 1,
		ownerStartKey: "x",
		ownerKind: "claude-code-cli",
		armProvenance: "session-start",
		updatedAt: "t",
	}) as never;

// ── PURE 0-call (injected facts/readers) ────────────────────────────────────
{
	let calls = 0;
	const enqueue = () => {
		calls++;
		return "ENQUEUED";
	};

	// deliverable: self-fetch record + live marker → enqueue once.
	const okOut = guardedMailboxEnqueue(
		GARDEN,
		{ readIdentity: liveIdentity, readReceiverMarker: liveMarker, capabilityFor: selfFetch },
		enqueue,
	);
	ok("deliverable → enqueue called exactly once", calls === 1);
	ok("deliverable → outcome carries the enqueue result", okOut.delivered === true && okOut.result === "ENQUEUED");

	// dead receiver (marker null) → 0-call.
	calls = 0;
	const deadOut = guardedMailboxEnqueue(
		GARDEN,
		{ readIdentity: liveIdentity, readReceiverMarker: () => null, capabilityFor: selfFetch },
		enqueue,
	);
	ok("dead/absent receiver → enqueue NOT called (0-call)", calls === 0);
	ok(
		"dead receiver → delivered:false with a reason",
		deadOut.delivered === false && !deadOut.delivered && deadOut.reason.length > 0,
	);

	// direct-inject backend (pi) → 0-call even with a live marker (SE-1).
	calls = 0;
	guardedMailboxEnqueue(
		GARDEN,
		{ readIdentity: liveIdentity, readReceiverMarker: liveMarker, capabilityFor: directInject },
		enqueue,
	);
	ok("direct-inject backend → enqueue NOT called (SE-1, 0-call)", calls === 0);

	// SE-2 2d-3: a present marker whose identity has DRIFTED (native session id mismatch) is a
	// stale/foreign marker — not THIS receiver — so presence alone does not deliver. 0-call.
	calls = 0;
	const driftOut = guardedMailboxEnqueue(
		GARDEN,
		{
			readIdentity: liveIdentity,
			readReceiverMarker: driftMarker,
			capabilityFor: selfFetch,
		},
		enqueue,
	);
	ok("marker identity drift (native id) → enqueue NOT called (SE-2 2d-3, 0-call)", calls === 0);
	ok("marker identity drift → delivered:false", driftOut.delivered === false);

	// no backing record → 0-call.
	calls = 0;
	guardedMailboxEnqueue(
		GARDEN,
		{
			readIdentity: () => {
				throw new Error("no record");
			},
			readReceiverMarker: liveMarker,
			capabilityFor: selfFetch,
		},
		enqueue,
	);
	ok("absent record → enqueue NOT called (0-call)", calls === 0);
}

// ── fact gathering ──────────────────────────────────────────────────────────
{
	const facts = gatherMailboxDeliverabilityFacts(GARDEN, {
		readIdentity: liveIdentity,
		readReceiverMarker: liveMarker,
		capabilityFor: selfFetch,
	});
	ok("facts: recordBacked from a present record", facts.recordBacked === true);
	ok("facts: wakeMode from the capability registry", facts.wakeMode === "self-fetch");
	ok("facts: ownerAlive+watchArmed true from a present marker", facts.ownerAlive === true && facts.watchArmed === true);

	const absent = gatherMailboxDeliverabilityFacts(GARDEN, {
		readIdentity: () => {
			throw new Error("none");
		},
		readReceiverMarker: () => null,
		capabilityFor: selfFetch,
	});
	ok(
		"facts: absent record → recordBacked false, wakeMode undefined",
		absent.recordBacked === false && absent.wakeMode === undefined,
	);
	ok("facts: absent marker → ownerAlive+watchArmed false", absent.ownerAlive === false && absent.watchArmed === false);

	// A present-but-drifted marker (native id mismatch) is recordBacked (the record is fine)
	// but the receiver is inactive — the SE-2 2d-3 identity-match gate, not presence alone.
	const drift = gatherMailboxDeliverabilityFacts(GARDEN, {
		readIdentity: liveIdentity,
		readReceiverMarker: driftMarker,
		capabilityFor: selfFetch,
	});
	ok(
		"facts: drifted marker → recordBacked true but ownerAlive+watchArmed false",
		drift.recordBacked === true && drift.ownerAlive === false && drift.watchArmed === false,
	);
}

// ── TMPDIR SNAPSHOT (real enqueueMetaMessage) ───────────────────────────────
function snapshot(dir: string): string {
	const h = createHash("sha256");
	const walk = (d: string) => {
		let entries: string[];
		try {
			entries = readdirSync(d).sort();
		} catch {
			return;
		}
		for (const name of entries) {
			const p = path.join(d, name);
			const st = statSync(p);
			h.update(`${p}\n`);
			if (st.isDirectory()) walk(p);
			else h.update(readFileSync(p));
		}
	};
	walk(dir);
	return h.digest("hex");
}

{
	const TMP = mkdtempSync(path.join(tmpdir(), "psa-mbguard-"));
	const sessionsDir = path.join(TMP, "meta-sessions");
	const mailboxDir = path.join(TMP, "meta-mailbox");
	const receiversDir = path.join(TMP, "meta-receivers");
	for (const d of [sessionsDir, mailboxDir, receiversDir]) mkdirSync(d, { recursive: true });

	// Seed a real claude-code record (recordBacked + self-fetch), but NO receiver
	// marker → the target is a terminated/absent receiver. A guarded send must refuse.
	const id = mintMetaIdentity({ backend: "claude-code", nativeSessionId: "n-snap", cwd: "/tmp" });
	writeFileSync(path.join(sessionsDir, `${id.gardenId}.meta.json`), serializeMetaIdentity(id));

	const deps = {
		readIdentity: (g: string) =>
			JSON.parse(readFileSync(path.join(sessionsDir, `${g}.meta.json`), "utf8")) as MetaIdentity,
		readReceiverMarker: (g: string) => readMetaReceiverMarker({ gardenId: g, receiversDir }),
	};
	const realEnqueue = () => enqueueMetaMessage({ gardenId: id.gardenId, body: "SNAP", sessionsDir, mailboxDir });

	const before = snapshot(mailboxDir);
	const refused = guardedMailboxEnqueue(id.gardenId, deps, realEnqueue);
	const after = snapshot(mailboxDir);
	ok("refused send → delivered:false", refused.delivered === false);
	ok("refused send → mailbox tree byte-identical (no .msg, no signal poke, no state)", before === after);

	// Now arm a live receiver marker (this process is the live owner) → deliverable.
	writeMetaReceiverMarker({
		gardenId: id.gardenId,
		backend: "claude-code",
		nativeSessionId: "n-snap",
		ownerPid: process.pid,
		armProvenance: "session-start",
		receiversDir,
	});
	const accepted = guardedMailboxEnqueue(id.gardenId, deps, realEnqueue);
	ok("active receiver → delivered:true", accepted.delivered === true);
	const msgs = readdirSync(path.join(mailboxDir, id.gardenId)).filter((f) => f.endsWith(".msg"));
	ok("active receiver → exactly one .msg written", msgs.length === 1);
}

// ── V2-ONLY WIRING: legacy MCP entwurf_send fallback is gone ───────────────
// v2 mailbox delivery is covered by check-entwurf-v2-mailbox + decider gates; this
// file keeps the guard primitive pinned for remaining/future conversational enqueue sites.
const mcpSrc = readFileSync(path.join(REPO_DIR, "mcp", "entwurf-bridge", "src", "index.ts"), "utf8");
ok("legacy MCP entwurf_send tool removed", !mcpSrc.includes('server.tool(\n\t"entwurf_send"'));

console.log(`\ncheck-entwurf-mailbox-guard: ${passed} checks passed`);
