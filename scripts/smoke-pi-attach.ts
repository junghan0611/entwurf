/**
 * smoke-pi-attach — the #50 C2 checkpoint: a pi session is addressable as a
 * meta-record citizen, and the CONSUMER ARTIFACT routes a garden id to its socket.
 *
 * WHAT THIS PROVES (the vertical slice GLG's question asks for — "when does pi
 * attach as a meta-record?"):
 *
 *   P1  SessionStart mints a V3 record with backend:"pi"           (pi is a citizen)
 *   P2  the gardenId is the record's, NOT pi's session id          (one authority)
 *   P3  the control socket is keyed on the record gardenId         (address = record)
 *   P4  re-opening the SAME pi session re-ATTACHES                 (the address holds)
 *   P5  a second pi session gets its own citizen                   (join is per-native-id)
 *   P6  the built artifact lists the citizen via entwurf_peers     (peers sees pi)
 *   P7  tools/call entwurf_v2 reaches the socket and gets an ack   (the pi RAIL delivers)
 *   P8  the ACP identity chain (#50 C3 tail): the REAL
 *       enrichMcpServersWithEnvelope injects the HOST record's gardenId into the
 *       bridge child's env, and a send from that child lands on the receiver
 *       carrying the HOST RECORD identity                          (goal 3 gated)
 *
 * P4 is the invariant with teeth. `upsertMetaSession` decides create-vs-attach on
 * record EXISTENCE keyed by `nativeSessionId`, so a reload/resume must land on the
 * SAME gardenId — a second mint would move a live citizen's address out from under
 * every peer already holding it, and nothing else in the tree would notice.
 *
 * WHY THE PI SIDE IS THE SEAM AND NOT A REAL `pi` PROCESS. The record + address half
 * is driven through `birthPiCitizen` — the exact function `entwurf-control.ts`'s
 * session_start calls — so this gate stays deterministic (no model, no network, no
 * cost) and belongs in `pnpm check`. That a REAL `pi --entwurf-control` process
 * executes that seam is a different axis, owned by the LIVE gate
 * (`smoke-resident-garden-guard`, inverted in this same cut). Two axes, neither
 * pretending to be the other.
 *
 * The DELIVERY half is not faked: P6/P7 spawn the built dist entry as its own process
 * and speak MCP stdio to it, reusing check-bridge-delivery's driver. That gate's
 * subject is the mailbox rail (Claude self-fetch); this one is the SOCKET rail, so the
 * fixture and the assertions are its own — a backend string swap would have proven
 * nothing about how a pi citizen is actually reached. The socket responder here plays
 * the pi control server's wire contract (newline JSON-RPC, `message_processed` ack),
 * which is what the send hand's ack contract is defined against.
 *
 * ISOLATION (AGENTS.md Hard Rule 11): every root the record/socket/mailbox paths read
 * is redirected into one mkdtemp world and passed explicitly — this gate never reads
 * the operator's live store, and the live store's 173 pre-cut records can neither
 * fail it nor be touched by it.
 */

import assert from "node:assert/strict";
import { type ChildProcess, spawn } from "node:child_process";
import fs from "node:fs";
import fsp from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { type AcpKeyValue, type AcpMcpServer, enrichMcpServersWithEnvelope } from "../pi-extensions/lib/acp/config.ts";
import { listAllMetaIdentities, parseMetaRecordV3 } from "../pi-extensions/lib/meta-session.ts";
import { birthPiCitizen } from "../pi-extensions/lib/pi-citizen-birth.ts";

/** Record count in the isolated store, read the same way production reads it. */
function citizenCount(dir: string): number {
	return listAllMetaIdentities(fs.readdirSync(dir), (f) => fs.readFileSync(path.join(dir, f), "utf8"), {
		mode: "strict",
	}).identities.length;
}

const REPO = path.join(import.meta.dirname, "..");
const DIST_ENTRY = path.join(REPO, "mcp/entwurf-bridge/dist/mcp/entwurf-bridge/src/index.js");

let passed = 0;
function ok(label: string, cond: boolean, detail?: string): void {
	assert.ok(cond, detail ? `${label}\n${detail}` : label);
	console.log(`  ok    ${label}`);
	passed++;
}

if (!fs.existsSync(DIST_ENTRY)) {
	console.error(`smoke-pi-attach: bridge bundle not built — ${DIST_ENTRY}\n  run: pnpm run build-bridge`);
	process.exit(1);
}

const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), "pi-attach-"));
const agentDir = path.join(tmp, "agent");
const sessionsDir = path.join(agentDir, "meta-sessions");
const mailboxDir = path.join(agentDir, "meta-mailbox");
const receiversDir = path.join(agentDir, "meta-receivers");
const sendersDir = path.join(agentDir, "meta-senders");
// HOME is swapped, not just the ENTWURF_* roots: the v2 DISPATCH path resolves its
// control-socket dir from `os.homedir()` (socket-discovery.CONTROL_SOCKET_DIR), while
// the bridge's own peers/inspection surface honours ENTWURF_DIR. Setting only one of
// them makes the two halves of this gate look at different directories — which is
// exactly how a first run reported the citizen ALIVE in peers and `dead` in dispatch.
// Both are pointed at the same tmp home (AGENTS.md Hard Rule 11: swap HOME AND the
// XDG roots, never HOME alone).
const fakeHome = path.join(tmp, "home");
const socketDir = path.join(fakeHome, ".pi", "entwurf-control");
for (const d of [sessionsDir, mailboxDir, receiversDir, sendersDir, socketDir]) await fsp.mkdir(d, { recursive: true });

let server: net.Server | null = null;
const children: ChildProcess[] = [];

/** Spawn the built bridge dist and speak MCP stdio to it. Each driver owns its
 * child + reply map + stderr, so P6/P7 (external-mcp child) and P8 (the
 * ACP-enriched child) drive two independent processes with one mechanism. */
function makeBridgeDriver(envArg: NodeJS.ProcessEnv): {
	send: (o: unknown) => void;
	await_: (id: number, what: string, ms?: number) => Promise<any>;
} {
	const child = spawn(process.execPath, [DIST_ENTRY], { stdio: ["pipe", "pipe", "pipe"], env: envArg });
	children.push(child);
	let stderr = "";
	child.stderr?.on("data", (d) => {
		stderr += d.toString();
	});
	const replies = new Map<number, any>();
	let outBuf = "";
	child.stdout?.on("data", (d) => {
		outBuf += d.toString();
		const lines = outBuf.split("\n");
		outBuf = lines.pop() ?? "";
		for (const line of lines) {
			const t = line.trim();
			if (!t) continue;
			try {
				const msg = JSON.parse(t);
				if (typeof msg?.id === "number") replies.set(msg.id, msg);
			} catch {}
		}
	});
	return {
		send: (o: unknown) => child.stdin?.write(`${JSON.stringify(o)}\n`),
		await_: (id: number, what: string, ms = 15_000): Promise<any> =>
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
			}),
	};
}

try {
	// ── P1–P3: SessionStart attach ────────────────────────────────────────────────
	// pi's own session id. A uuidv7 is the NORMAL case now: nothing injects an id, and
	// the guard that used to hard-exit on exactly this shape is gone with the cut.
	const nativeSessionId = "019e8faa-04ea-7b73-bf2c-1465d525c2e8";
	const cwd = path.join(tmp, "repo");
	const transcriptPath = path.join(tmp, "sessions", `2026-07-23T09-00-00-000Z_${nativeSessionId}.jsonl`);

	const first = birthPiCitizen({
		nativeSessionId,
		cwd,
		model: "openai-codex/gpt-5.4",
		transcriptPath,
		sessionsDir,
		controlSocketDir: socketDir,
	});

	ok("P1: SessionStart CREATES a citizen (first start of this pi session)", first.action === "create");
	const recordRaw = await fsp.readFile(first.recordPath, "utf8");
	const record = parseMetaRecordV3(recordRaw);
	ok('P1: the record is V3 with backend:"pi"', record.schemaVersion === 3 && record.backend === "pi", recordRaw);
	ok("P1: nativeSessionId is pi's OWN session id", record.nativeSessionId === nativeSessionId, recordRaw);
	ok(
		"P1: transcriptPath + cwd recorded (the resume target C3 reads)",
		record.transcriptPath === transcriptPath && record.cwd === cwd,
		recordRaw,
	);

	ok(
		"P2: the gardenId is minted by the RECORD, not taken from pi's session id",
		first.gardenId !== nativeSessionId && /^\d{8}T\d{6}-[0-9a-f]{6}$/.test(first.gardenId),
		`gardenId=${first.gardenId} nativeSessionId=${nativeSessionId}`,
	);
	ok(
		"P2: the record file is named by the gardenId (body/filename agree)",
		path.basename(first.recordPath) === `${first.gardenId}.meta.json`,
	);

	ok(
		"P3: the control socket is keyed on the record gardenId",
		first.socketPath === path.join(socketDir, `${first.gardenId}.sock`),
		first.socketPath,
	);
	ok(
		"P3: the socket is NOT keyed on pi's session id (the pre-cut address)",
		!first.socketPath.includes(nativeSessionId),
		first.socketPath,
	);

	// ── P4: re-open ATTACHES ──────────────────────────────────────────────────────
	// The same pi session opened again (reload / resume / a warm session_start). The
	// address must be the one peers already hold.
	const second = birthPiCitizen({
		nativeSessionId,
		cwd,
		// A warm start before pi rewrites the file: `undefined` must KEEP the recorded
		// transcript, never clear it (the 3-value merge).
		sessionsDir,
		controlSocketDir: socketDir,
	});
	ok("P4: re-opening the same pi session ATTACHES (no second mint)", second.action === "attach");
	ok("P4: the gardenId is unchanged across the re-open", second.gardenId === first.gardenId);
	ok("P4: the socket address is unchanged across the re-open", second.socketPath === first.socketPath);
	const afterAttach = parseMetaRecordV3(await fsp.readFile(second.recordPath, "utf8"));
	ok("P4: an undefined transcriptPath KEEPS the recorded one", afterAttach.transcriptPath === transcriptPath);
	ok("P4: exactly ONE record exists for this citizen", citizenCount(sessionsDir) === 1);

	// ── P5: a different pi session is a different citizen ─────────────────────────
	const otherNative = "019e8fbb-1111-7b73-bf2c-1465d525c2e8";
	const other = birthPiCitizen({
		nativeSessionId: otherNative,
		cwd,
		sessionsDir,
		controlSocketDir: socketDir,
	});
	ok("P5: a second pi session CREATES its own citizen", other.action === "create" && other.gardenId !== first.gardenId);
	ok("P5: the store now holds exactly two pi citizens", citizenCount(sessionsDir) === 2);

	// ── the live socket the resident would have stood up ──────────────────────────
	// The pi control server's wire contract: newline-delimited JSON-RPC, a `send`
	// answered with `message_processed`. That ack IS the delivery contract for the
	// socket rail (send-is-throw — no turn result is awaited).
	const received: string[] = [];
	server = net.createServer((conn) => {
		let buf = "";
		conn.on("data", (d) => {
			buf += d.toString();
			const lines = buf.split("\n");
			buf = lines.pop() ?? "";
			for (const line of lines) {
				const t = line.trim();
				if (!t) continue;
				received.push(t);
				conn.write(
					`${JSON.stringify({ type: "response", command: "send", success: true, data: { status: "message_processed" } })}\n`,
				);
			}
		});
	});
	await new Promise<void>((resolve, reject) => {
		server?.once("error", reject);
		server?.listen(first.socketPath, () => resolve());
	});

	// ── P6/P7: drive the BUILT ARTIFACT over MCP stdio ────────────────────────────
	const env: NodeJS.ProcessEnv = {
		...process.env,
		PI_CODING_AGENT_DIR: agentDir,
		ENTWURF_META_SESSIONS_DIR: sessionsDir,
		ENTWURF_META_MAILBOX_DIR: mailboxDir,
		ENTWURF_META_RECEIVERS_DIR: receiversDir,
		ENTWURF_META_SENDERS_DIR: sendersDir,
		ENTWURF_DIR: socketDir,
		HOME: fakeHome,
		XDG_DATA_HOME: path.join(fakeHome, ".local", "share"),
		XDG_STATE_HOME: path.join(fakeHome, ".local", "state"),
		XDG_CACHE_HOME: path.join(fakeHome, ".cache"),
		ENTWURF_BRIDGE_EXTERNAL_AGENT_ID: "external-mcp/smoke-pi-attach",
	};
	// Ambient identity carriers must not decide the sender for an isolated gate.
	delete env.PI_SESSION_ID;
	delete env.PI_AGENT_ID;
	delete env.ENTWURF_META_SENDER_MARKER;
	delete env.ENTWURF_BRIDGE_REQUIRE_META_SENDER;
	delete env.NODE_PATH;

	const { send, await_ } = makeBridgeDriver(env);

	send({
		jsonrpc: "2.0",
		id: 1,
		method: "tools/call",
		params: { name: "entwurf_peers", arguments: {} },
	});
	const peers = await await_(1, "tools/call entwurf_peers");
	const peersText: string = peers?.result?.content?.[0]?.text ?? JSON.stringify(peers);
	ok(
		"P6: the artifact lists the pi citizen by its garden id",
		peersText.includes(first.gardenId),
		`--- peers ---\n${peersText}`,
	);
	ok(
		"P6: the citizen is reported ALIVE (record + connectable socket)",
		new RegExp(`${first.gardenId}[^\n]*alive`, "i").test(peersText),
		`--- peers ---\n${peersText}`,
	);

	send({
		jsonrpc: "2.0",
		id: 2,
		method: "tools/call",
		params: {
			name: "entwurf_v2",
			arguments: {
				target: first.gardenId,
				intent: "fire-and-forget",
				mode: "follow_up",
				message: "smoke-pi-attach: the pi rail, driven through the artifact.",
			},
		},
	});
	const called = await await_(2, "tools/call entwurf_v2");
	const body: string = called?.result?.content?.[0]?.text ?? JSON.stringify(called);
	ok("P7: tools/call entwurf_v2 executed (not isError)", called?.result?.isError !== true, `--- response ---\n${body}`);
	ok(
		"P7: the message arrived on the record-gardenId SOCKET (control-socket rail, RPC ack)",
		received.some((line) => line.includes("smoke-pi-attach: the pi rail")),
		`--- socket traffic ---\n${received.join("\n") || "(nothing arrived)"}\n--- response ---\n${body}`,
	);
	ok(
		"P7: nothing was written to a mailbox (pi is the socket rail, not self-fetch)",
		!fs.existsSync(path.join(mailboxDir, first.gardenId)),
		`--- response ---\n${body}`,
	);

	// ── P8: the ACP identity chain (#50 C3 tail — goal 3 gated) ───────────────────
	// A Claude behind pi's ACP plugin uses entwurf through the meta-record too: the
	// pi HOST session owns the record and the socket (LOCKED PROTOCOL 8), and the
	// ACP spawn carries that identity into the bridge child's env via the REAL
	// enrichMcpServersWithEnvelope (acp/config — the exact function backend.ts calls
	// at newSession). This leg launches the built bridge with EXACTLY the env pairs
	// the enrichment produced and asserts the delivered sender is the HOST RECORD's
	// identity — never anonymous external-mcp, never an id of the ACP child's own.
	{
		const hostNative = "019e8fcc-2222-7b73-bf2c-1465d525c2e8";
		const host = birthPiCitizen({
			nativeSessionId: hostNative,
			cwd,
			model: "entwurf/claude-sonnet-5",
			sessionsDir,
			controlSocketDir: socketDir,
		});
		const bare: AcpMcpServer[] = [{ name: "entwurf-bridge", command: process.execPath, args: [DIST_ENTRY], env: [] }];
		const wired = enrichMcpServersWithEnvelope(bare, { modelId: "claude-sonnet-5", piSessionId: host.gardenId });
		const entry = wired[0] as { name: string; command: string; args: string[]; env: AcpKeyValue[] };
		const envPairs = Object.fromEntries(entry.env.map((e) => [e.name, e.value]));
		ok("P8: enrich injects the HOST record gardenId as PI_SESSION_ID", envPairs.PI_SESSION_ID === host.gardenId);
		ok("P8: enrich injects PI_AGENT_ID = entwurf/<model>", envPairs.PI_AGENT_ID === "entwurf/claude-sonnet-5");

		const acp = makeBridgeDriver({ ...env, ...envPairs });
		const acpMessage = "smoke-pi-attach: the ACP chain, sender = the host record.";
		acp.send({
			jsonrpc: "2.0",
			id: 3,
			method: "tools/call",
			params: {
				name: "entwurf_v2",
				arguments: { target: first.gardenId, intent: "fire-and-forget", mode: "follow_up", message: acpMessage },
			},
		});
		const acpCalled = await acp.await_(3, "tools/call entwurf_v2 (ACP-enriched child)");
		const acpBody: string = acpCalled?.result?.content?.[0]?.text ?? JSON.stringify(acpCalled);
		ok("P8: the ACP-enriched send executed (not isError)", acpCalled?.result?.isError !== true, acpBody);
		const acpLine = received.find((line) => line.includes(acpMessage));
		ok("P8: the message landed on the receiver's record-gardenId socket", acpLine !== undefined, received.join("\n"));
		const acpCmd = JSON.parse(acpLine as string) as {
			sender?: { sessionId?: string; agentId?: string; origin?: string };
		};
		ok(
			"P8: the delivered sender sessionId IS the host record gardenId (goal 3)",
			acpCmd.sender?.sessionId === host.gardenId,
			acpLine,
		);
		ok("P8: the delivered sender agentId carries the ACP model", acpCmd.sender?.agentId === "entwurf/claude-sonnet-5");
		ok(
			'P8: the delivered sender origin is "pi-session" (the HOST owns the identity)',
			acpCmd.sender?.origin === "pi-session",
		);
	}
} finally {
	for (const c of children) {
		try {
			c.kill("SIGTERM");
		} catch {}
	}
	await new Promise<void>((resolve) => {
		if (!server) return resolve();
		server.close(() => resolve());
	});
	await fsp.rm(tmp, { recursive: true, force: true });
}

console.log(`\nsmoke-pi-attach: PASS (${passed} assertions)`);
process.exit(0);
