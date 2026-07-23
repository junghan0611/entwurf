/**
 * check-bridge-delivery — demo/demo.sh scene 3, recovered as a deterministic gate.
 *
 * WHY THIS EXISTS
 * demo.sh drove two REAL pi panes and made one agent call entwurf_send at the other,
 * so it proved DELIVERY through whatever binary was actually installed. It cost real
 * model turns, and it is not wired into any gate. What replaced it split in half and
 * each half kept the other's blind spot:
 *
 *   smoke-entwurf-v2-matrix-live C2  delivers for real — but calls runEntwurfV2
 *                                    IN-PROCESS from the repo source.
 *   check-entwurf-bridge-boot        runs the MCP server — but `src/index.ts` with
 *                                    "no build step", and tools/list only, never call.
 *   check-pack-install               boots the INSTALLED bridge — tools/list only
 *                                    (this gate is now planted there too; see below).
 *   check-install-container          installs the real tgz — tools/list only.
 *
 * So every gate either delivered from source, or ran the artifact without delivering.
 * `entwurf_v2` through the shipped bundle was never once executed, and it shipped
 * dead through 0.12.8-repair.0: the bundle carried no capability registry, so every
 * real send died `ENOENT ... entwurf-capabilities.json` while entwurf_self /
 * entwurf_peers (which never read it) stayed green and hid the corpse.
 *
 * WHAT THIS DOES
 * Seeds an armed self-fetch citizen (the C2 recipe: upsertMetaSession +
 * writeMetaReceiverMarker owned by this live pid) into a fully env-isolated temp
 * world, then drives the CONSUMER ARTIFACT — spawned as its own process and spoken to
 * over MCP stdio — through a real `tools/call entwurf_v2`, and asserts the message
 * physically landed.
 *
 * The seeder is the repo source; the SUBJECT is the artifact. Separate processes, so
 * the seeder's (correct) source-depth resolution cannot mask the artifact's.
 *
 *   D1  the subject boots and registers entwurf_v2                   (artifact is alive)
 *   D2  tools/call entwurf_v2 returns success, not isError           (delivery executed)
 *   D3  exactly one .msg landed in the target mailbox                (the body moved)
 *   D4  the doorbell inbox.signal was poked                          (the citizen is wakeable)
 *   D5  the landed body names the seeded meta-session sender         (identity joined)
 *   D6  no capability-registry error anywhere in the response/stderr (the 0.12.8 corpse)
 *   D7  a pre-cut (v2) SENDER record refuses the send naming M1,     (F10 — the M1 contract
 *       never claiming "no live meta-sender marker"                   held per surface)
 *   D8  entwurf_self on that record refuses naming M1 + the citizen  (not "missing env")
 *
 * Deterministic: no model, no network, no API cost, no backend. Temp dirs only.
 *
 * TWO CELLS, ONE SCENE. The default subject is the checkout's built dist entry,
 * invoked directly with node — NOT start.sh, which picks its mode by LOCATION (under
 * node_modules → dist, else → src via strip-types) and would therefore run the SOURCE
 * from a checkout, silently turning this back into a source-depth test.
 * `ENTWURF_DELIVERY_SUBJECT` re-points this same scene at another consumer artifact:
 * check-pack-install hands it the npm-INSTALLED `.bin/entwurf-bridge`, where start.sh's
 * node_modules→dist branch IS the correct launcher — and where, until now, nothing had
 * ever delivered through it. Seeder, assertions and isolation are identical across the
 * two cells; only the artifact under test moves, and the subject is printed so a green
 * can never be read as being about an artifact it was not about.
 */

import assert from "node:assert/strict";
import { type ChildProcess, spawn } from "node:child_process";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
	M1_MIGRATE_COMMAND,
	upsertMetaSession,
	writeMetaReceiverMarker,
	writeMetaSenderMarker,
} from "../pi-extensions/lib/meta-session.ts";

const REPO = path.join(import.meta.dirname, "..");
const DIST_ENTRY = path.join(REPO, "mcp/entwurf-bridge/dist/mcp/entwurf-bridge/src/index.js");
const SUBJECT_OVERRIDE = (process.env.ENTWURF_DELIVERY_SUBJECT ?? "").trim();

let passed = 0;
function ok(label: string, cond: boolean, detail?: string): void {
	assert.ok(cond, detail ? `${label}\n${detail}` : label);
	console.log(`  ok    ${label}`);
	passed++;
}

function newestSourceMtime(dir: string, newest = 0): number {
	for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
		if (entry.name === "node_modules" || entry.name === "dist" || entry.name.startsWith(".")) continue;
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) newest = newestSourceMtime(full, newest);
		else if (entry.name.endsWith(".ts")) newest = Math.max(newest, fs.statSync(full).mtimeMs);
	}
	return newest;
}

// ---------------------------------------------------------------------------
// The subject, named out loud before anything runs.
//
// Default cell — the checkout's built dist entry. It must exist AND be newer than
// the source it claims to be built from: a stale dist would let this gate go green
// on bytes nobody ships, the same family of lie the gate exists to end.
//
// Override cell — a launcher handed in by check-pack-install, whose bytes came from
// a tarball that gate packed in the same run. Freshness there is that gate's
// question (it packs from the working tree and asserts the dist is in the tarball),
// so re-asking it here against a repo path would be answering about the wrong tree.
// ---------------------------------------------------------------------------
let subjectCmd: string;
let subjectArgs: string[];
if (SUBJECT_OVERRIDE) {
	if (!path.isAbsolute(SUBJECT_OVERRIDE)) {
		console.error(
			`check-bridge-delivery: ENTWURF_DELIVERY_SUBJECT must be an absolute path — got '${SUBJECT_OVERRIDE}'`,
		);
		process.exit(1);
	}
	try {
		fs.accessSync(SUBJECT_OVERRIDE, fs.constants.X_OK);
	} catch {
		console.error(`check-bridge-delivery: ENTWURF_DELIVERY_SUBJECT is not an executable file — ${SUBJECT_OVERRIDE}`);
		process.exit(1);
	}
	subjectCmd = SUBJECT_OVERRIDE;
	subjectArgs = [];
	console.log(`  subject  handed-in launcher — ${SUBJECT_OVERRIDE}`);
} else {
	if (!fs.existsSync(DIST_ENTRY)) {
		console.error(`check-bridge-delivery: bridge bundle not built — ${DIST_ENTRY}\n  run: pnpm run build-bridge`);
		process.exit(1);
	}
	subjectCmd = process.execPath;
	subjectArgs = [DIST_ENTRY];
	console.log(`  subject  built dist entry — ${DIST_ENTRY}`);
	const srcNewest = Math.max(
		newestSourceMtime(path.join(REPO, "pi-extensions")),
		newestSourceMtime(path.join(REPO, "mcp/entwurf-bridge/src")),
	);
	ok(
		"artifact is not stale (dist entry is newer than the newest .ts source)",
		fs.statSync(DIST_ENTRY).mtimeMs >= srcNewest,
		`--- dist ---\n${DIST_ENTRY}\nrebuild with: pnpm run build-bridge`,
	);
}

// ---------------------------------------------------------------------------
// Temp world — fully env-isolated. Every meta dir the send path touches is
// redirected, so a real citizen on the operator's machine can never be a target
// and no artifact of this gate lands in the real store.
// ---------------------------------------------------------------------------
const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), "bridge-delivery-"));
const agentDir = path.join(tmp, "agent");
const sessionsDir = path.join(agentDir, "meta-sessions");
const mailboxDir = path.join(agentDir, "meta-mailbox");
const receiversDir = path.join(agentDir, "meta-receivers");
const sendersDir = path.join(agentDir, "meta-senders");
for (const d of [sessionsDir, mailboxDir, receiversDir, sendersDir]) await fsp.mkdir(d, { recursive: true });

// SENDER — force the same strict identity path as the installed Claude entry. This
// process owns both marker kinds, like a real SessionStart owner, and the landed body
// must name this garden id. Ambient pi identity is planted then scrubbed below so a
// local pi run cannot silently bypass this marker join while CI takes the intended path.
const sender = upsertMetaSession({
	input: { backend: "claude-code", nativeSessionId: `bridge-delivery-sender-${process.pid}`, cwd: tmp },
	dir: sessionsDir,
});
writeMetaSenderMarker({
	backend: "claude-code",
	gardenId: sender.record.gardenId,
	nativeSessionId: sender.record.nativeSessionId,
	cwd: tmp,
	ownerPid: process.pid,
	sendersDir,
});
writeMetaReceiverMarker({
	gardenId: sender.record.gardenId,
	backend: "claude-code",
	nativeSessionId: sender.record.nativeSessionId,
	ownerPid: process.pid,
	armProvenance: "session-start",
	receiversDir,
});

// RECEIVER — a different armed self-fetch citizen. A dead/unarmed target must remain
// mailbox-undeliverable, so this marker isolates artifact delivery from target liveness.
const receiver = upsertMetaSession({
	input: { backend: "claude-code", nativeSessionId: `bridge-delivery-receiver-${process.pid}`, cwd: tmp },
	dir: sessionsDir,
});
const gid = receiver.record.gardenId;
writeMetaReceiverMarker({
	gardenId: gid,
	backend: "claude-code",
	nativeSessionId: receiver.record.nativeSessionId,
	ownerPid: process.pid,
	armProvenance: "session-start",
	receiversDir,
});

// ---------------------------------------------------------------------------
// Drive the artifact over MCP stdio.
// ---------------------------------------------------------------------------
const env: NodeJS.ProcessEnv = {
	...process.env,
	// Deliberate ambient poison: without the scrub below buildSendSenderEnvelope()
	// chooses strict pi identity before it even asks for the seeded meta-sender marker.
	// This makes the cross-harness regression deterministic on both a plain shell and pi.
	PI_SESSION_ID: "ambient-pi-session-must-not-win",
	PI_AGENT_ID: "ambient-pi-agent/must-not-win",
	ENTWURF_META_SENDER_MARKER: path.join(tmp, "ambient-sender-marker-must-not-win.json"),
	PI_CODING_AGENT_DIR: agentDir,
	ENTWURF_META_SESSIONS_DIR: sessionsDir,
	ENTWURF_META_MAILBOX_DIR: mailboxDir,
	ENTWURF_META_RECEIVERS_DIR: receiversDir,
	ENTWURF_META_SENDERS_DIR: sendersDir,
	ENTWURF_BRIDGE_REQUIRE_META_SENDER: "1",
	// The ENTWURF_META_* roots do NOT cover the socket surface: the bridge reads
	// ENTWURF_DIR (index.ts:71, default ~/.pi/entwurf-control) for its socket-conflict
	// inspection, so without this the gate would consult the operator's REAL live
	// sockets. Read-only against a fresh gid, so it was harmless — but a gate that
	// half-isolates is a gate whose result depends on the host it ran on.
	ENTWURF_DIR: path.join(tmp, "sockets"),
};
// These three carriers outrank marker discovery. They are ambient harness identity,
// not part of the artifact subject, so keeping any one would let local pi and CI prove
// different sender paths. NODE_PATH is the matching dependency-resolution carrier.
delete env.PI_SESSION_ID;
delete env.PI_AGENT_ID;
delete env.ENTWURF_META_SENDER_MARKER;
delete env.NODE_PATH;

let child: ChildProcess | null = null;
let stderr = "";
try {
	child = spawn(subjectCmd, subjectArgs, { stdio: ["pipe", "pipe", "pipe"], env });
	child.stderr?.on("data", (d) => {
		stderr += d.toString();
	});

	const replies = new Map<number, any>();
	let buf = "";
	child.stdout?.on("data", (d) => {
		buf += d.toString();
		const lines = buf.split("\n");
		buf = lines.pop() ?? "";
		for (const line of lines) {
			const t = line.trim();
			if (!t) continue;
			try {
				const msg = JSON.parse(t);
				if (typeof msg?.id === "number") replies.set(msg.id, msg);
			} catch {}
		}
	});

	const send = (o: unknown) => child?.stdin?.write(`${JSON.stringify(o)}\n`);
	const await_ = (id: number, what: string, ms = 15_000): Promise<any> =>
		new Promise((resolve, reject) => {
			const t0 = Date.now();
			const iv = setInterval(() => {
				const got = replies.get(id);
				if (got) {
					clearInterval(iv);
					resolve(got);
				} else if (Date.now() - t0 > ms) {
					clearInterval(iv);
					reject(new Error(`timeout waiting for ${what}${stderr.trim() ? `\n--- stderr ---\n${stderr}` : ""}`));
				}
			}, 50);
		});

	// D1 — the artifact boots and carries the verb under test.
	send({ jsonrpc: "2.0", id: 1, method: "tools/list" });
	const listed = await await_(1, "tools/list");
	const names: string[] = (listed?.result?.tools ?? []).map((t: { name?: string }) => t?.name);
	ok(
		"D1: the subject artifact boots and registers entwurf_v2",
		names.includes("entwurf_v2"),
		`--- tools ---\n${names.join(",") || "(none)"}`,
	);

	// D2 — the real call. This is the line no gate has ever executed against the artifact.
	send({
		jsonrpc: "2.0",
		id: 2,
		method: "tools/call",
		params: {
			name: "entwurf_v2",
			arguments: {
				target: gid,
				intent: "fire-and-forget",
				mode: "follow_up",
				message: "check-bridge-delivery: demo scene 3, recovered as a gate.",
			},
		},
	});
	const called = await await_(2, "tools/call entwurf_v2");
	const body: string = called?.result?.content?.[0]?.text ?? JSON.stringify(called);
	ok("D2: tools/call entwurf_v2 executed (not isError)", called?.result?.isError !== true, `--- response ---\n${body}`);

	// D3/D4 — the body physically moved and the citizen is wakeable.
	const boxDir = path.join(mailboxDir, gid);
	const files = await fsp.readdir(boxDir).catch(() => [] as string[]);
	const messageFiles = files.filter((f) => f.endsWith(".msg"));
	ok(
		"D3: exactly one .msg landed in the target mailbox",
		messageFiles.length === 1,
		`--- mailbox ${boxDir} ---\n${files.join("\n") || "(empty)"}\n--- response ---\n${body}`,
	);
	ok(
		"D4: the doorbell inbox.signal was poked",
		fs.existsSync(path.join(boxDir, "inbox.signal")),
		`--- mailbox ${boxDir} ---\n${files.join("\n") || "(empty)"}`,
	);

	// D5 — prove the strict sender marker joined. Before the carrier scrub, a pi-run
	// gate still landed the message but serialized PI_SESSION_ID here; CI serialized
	// the seeded meta citizen. The physical delivery assertions above could not see that
	// cross-harness lie. The mailbox body is the receiver's actual reply contract, so it
	// is the strongest place to assert which identity rode the send.
	const messageBody =
		messageFiles.length === 1 ? await fsp.readFile(path.join(boxDir, messageFiles[0] as string), "utf8") : "";
	ok(
		"D5: landed sender is the seeded meta citizen (ambient pi identity scrubbed)",
		messageBody.includes("from:        meta-session/claude-code @") &&
			messageBody.includes(`session:     ${sender.record.gardenId} (meta-session, replyable`),
		`--- mailbox body ---\n${messageBody || "(missing)"}`,
	);

	// D6 — the specific corpse. Named explicitly so a regression reads as itself in
	// the log instead of as a generic delivery failure.
	const capabilityCorpse = /entwurf-capabilities\.json|ENOENT/;
	ok(
		"D6: no capability-registry ENOENT in the response or the artifact's stderr",
		!capabilityCorpse.test(body) && !capabilityCorpse.test(stderr),
		`--- response ---\n${body}\n--- stderr ---\n${stderr.slice(0, 1500)}`,
	);

	// D7/D8 — the M1 observability contract, per SURFACE (F10). meta-session.ts fixes
	// the contract: production points at the M1 command BY NAME the moment it meets a
	// pre-cut record. The reader honors it, but the live F10 incident proved the sender
	// path swallowed that error into "no live meta-sender marker was found" — three
	// false claims and a useless fix. So this cell rewrites the SENDER's record as a
	// raw pre-cut v2 body and asserts, against the artifact over MCP stdio, that both
	// sender-identity surfaces refuse WITH the M1 pointer and WITHOUT the false claim.
	const senderRecordFile = path.join(sessionsDir, `${sender.record.gardenId}.meta.json`);
	const senderRecordV3Bytes = await fsp.readFile(senderRecordFile);
	await fsp.writeFile(
		senderRecordFile,
		`${JSON.stringify({
			schemaVersion: 2,
			gardenId: sender.record.gardenId,
			backend: "claude-code",
			nativeSessionId: sender.record.nativeSessionId,
			cwd: tmp,
			model: null,
			transcriptPath: null,
			parentGardenId: null,
			isEntwurf: false,
			createdAt: "2026-03-01T12:00:00.000Z",
			recordUpdatedAt: "2026-03-01T12:30:00.000Z",
		})}\n`,
	);

	send({
		jsonrpc: "2.0",
		id: 3,
		method: "tools/call",
		params: {
			name: "entwurf_v2",
			arguments: {
				target: gid,
				intent: "fire-and-forget",
				mode: "follow_up",
				message: "check-bridge-delivery: M1 cell — this send must be refused naming M1.",
			},
		},
	});
	const preCutSend = await await_(3, "tools/call entwurf_v2 (pre-cut sender record)");
	const preCutSendBody: string = preCutSend?.result?.content?.[0]?.text ?? JSON.stringify(preCutSend);
	ok(
		"D7: a pre-cut sender record refuses the send NAMING the M1 command (not a generic identity error)",
		preCutSend?.result?.isError === true && preCutSendBody.includes(M1_MIGRATE_COMMAND),
		`--- response ---\n${preCutSendBody}`,
	);
	ok(
		'D7: the refusal does NOT claim "no live meta-sender marker" (the marker exists — F10\'s false cause)',
		!preCutSendBody.includes("no live meta-sender marker"),
		`--- response ---\n${preCutSendBody}`,
	);

	send({ jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "entwurf_self", arguments: {} } });
	const preCutSelf = await await_(4, "tools/call entwurf_self (pre-cut sender record)");
	const preCutSelfBody: string = preCutSelf?.result?.content?.[0]?.text ?? JSON.stringify(preCutSelf);
	ok(
		"D8: entwurf_self on a pre-cut record refuses NAMING the M1 command (not 'missing env')",
		preCutSelf?.result?.isError === true && preCutSelfBody.includes(M1_MIGRATE_COMMAND),
		`--- response ---\n${preCutSelfBody}`,
	);
	ok(
		"D8: the entwurf_self refusal names the marker's citizen (the garden id is known, not anonymous)",
		preCutSelfBody.includes(sender.record.gardenId),
		`--- response ---\n${preCutSelfBody}`,
	);

	// D9/D10 — the remaining M1 surfaces: the dispatch TARGET path and the inbox read.
	// Sender restored to v3 (so sender resolution succeeds); the RECEIVER record is
	// rewritten pre-cut instead. Both surfaces read the record via
	// readMetaIdentityByGardenId, whose error names M1 — these cells pin that the
	// naming SURVIVES to the artifact response on each path.
	await fsp.writeFile(senderRecordFile, senderRecordV3Bytes);
	const receiverRecordFile = path.join(sessionsDir, `${gid}.meta.json`);
	await fsp.writeFile(
		receiverRecordFile,
		`${JSON.stringify({
			schemaVersion: 2,
			gardenId: gid,
			backend: "claude-code",
			nativeSessionId: receiver.record.nativeSessionId,
			cwd: tmp,
			model: null,
			transcriptPath: null,
			parentGardenId: null,
			isEntwurf: false,
			createdAt: "2026-03-01T12:00:00.000Z",
			recordUpdatedAt: "2026-03-01T12:30:00.000Z",
		})}\n`,
	);

	send({
		jsonrpc: "2.0",
		id: 5,
		method: "tools/call",
		params: {
			name: "entwurf_v2",
			arguments: {
				target: gid,
				intent: "fire-and-forget",
				mode: "follow_up",
				message: "check-bridge-delivery: M1 cell — pre-cut TARGET must be refused naming M1.",
			},
		},
	});
	const preCutTarget = await await_(5, "tools/call entwurf_v2 (pre-cut target record)");
	const preCutTargetBody: string = preCutTarget?.result?.content?.[0]?.text ?? JSON.stringify(preCutTarget);
	ok(
		"D9: a pre-cut TARGET record refuses the dispatch NAMING the M1 command",
		preCutTarget?.result?.isError === true && preCutTargetBody.includes(M1_MIGRATE_COMMAND),
		`--- response ---\n${preCutTargetBody}`,
	);

	send({
		jsonrpc: "2.0",
		id: 6,
		method: "tools/call",
		params: { name: "entwurf_inbox_read", arguments: { gardenId: gid } },
	});
	const preCutInbox = await await_(6, "tools/call entwurf_inbox_read (pre-cut record)");
	const preCutInboxBody: string = preCutInbox?.result?.content?.[0]?.text ?? JSON.stringify(preCutInbox);
	ok(
		"D10: entwurf_inbox_read on a pre-cut record refuses NAMING the M1 command",
		preCutInbox?.result?.isError === true && preCutInboxBody.includes(M1_MIGRATE_COMMAND),
		`--- response ---\n${preCutInboxBody}`,
	);
} finally {
	try {
		child?.kill("SIGTERM");
	} catch {}
	await fsp.rm(tmp, { recursive: true, force: true });
}

console.log(`\ncheck-bridge-delivery: PASS (${passed} assertions)`);
process.exit(0);
