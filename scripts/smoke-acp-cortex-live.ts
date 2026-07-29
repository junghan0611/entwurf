// CP2 LIVE — the cortex ACP citizen path, end to end: a REAL `cortex acp serve`
// child behind the entwurf provider carries a model to outbound sibling
// dispatch, under the dual-HOME overlay, and is reclaimed by process-group
// teardown afterwards.
//
//   LIVE=1 ENTWURF_ACP_CORTEX_CONNECTION=<conn> ./run.sh smoke-acp-cortex-live
//
// WHY this exact axis. The CP0 audit (docs/acp-backend-rail.md §11-8) measured
// three things no offline gate can prove:
//   - D9/D10: cortex ignores the wire `mcpServers` param, so the bundled
//     entwurf-bridge reaches a cortex session ONLY through the overlay-private
//     mcp.json projection — and only the dual-HOME env restore keeps the bridge
//     child's garden store real (an isolated-HOME bridge saw "(none)" citizens).
//     The CP0 LIVE run proved tool exposure + entwurf_peers; the outbound
//     `entwurf_v2` send was DELIBERATELY not exercised there ("흉내내지 않았다")
//     and is owed to THIS smoke.
//   - CP0-M: set-model is accepted live, but "the prompt actually runs on the
//     selected model" needed a model turn — this smoke drives one.
//   - teardown: an MCP-configured cortex child does NOT exit on stdin EOF
//     (measured twice); only process-group signalling reclaims it. This smoke
//     asserts the reclaim actually happens after the resident dies.
//
// METHOD — mirrors smoke-acp-v2-send-live: seed an isolated garden world (store
// + mailbox + receivers) with ONE armed self-fetch receiver, launch a real
// `pi --entwurf-control --mode rpc` resident on entwurf/cortex-claude-sonnet-5
// with that world in env, drive one turn telling the model to call
// `mcp__entwurf-bridge__entwurf_v2` at the seeded receiver with a nonce, then
// assert ON DISK: the landed .msg, the envelope naming the resident's own gid +
// entwurf/<cortex model>, the overlay scope dir + its mcp.json projection, and
// (after teardown) that no process still lives inside this run's overlay.
//
// LIVE-only and OUTSIDE the claude-only AGGREGATE release floor (capability
// dignity): a host that runs no cortex must not redden a claude release. That is
// a wiring decision — shipping cortex still owes a deliberate run of this smoke,
// and the aggregate gate's silence is not a pass (rail §11-8 tail).
// Honest skip when LIVE!=1, when `cortex` is not on PATH, or when
// ENTWURF_ACP_CORTEX_CONNECTION is unset — the overlay denies the operator's
// cortex settings.json (where a default connection would live), so the
// connection must arrive through the adapter's own env/settings seam, and
// running without one would measure a config hole, not the rail. This gate
// touches the real host exactly where LIVE gates may: the operator's real
// cortex auth (read-only through symlinks) and ~/.pi/agent/cortex-overlays.
//
// Model override: ENTWURF_ACP_CORTEX_MODEL (default cortex-claude-sonnet-5).

import { type ChildProcess, spawn } from "node:child_process";
import * as crypto from "node:crypto";
import { existsSync } from "node:fs";
import * as fsp from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import * as readline from "node:readline";
import { fileURLToPath } from "node:url";
import { upsertMetaSession, writeMetaReceiverMarker } from "../pi-extensions/lib/meta-session.ts";
import { terminateChild } from "./lib/acp-child-cleanup.ts";
import { waitForPiRecord } from "./lib/pi-record-discovery.ts";

const ACP_PROVIDER = "entwurf";
const ACP_MODEL = process.env.ENTWURF_ACP_CORTEX_MODEL?.trim() || "cortex-claude-sonnet-5";

const REAL_CONTROL_DIR = path.join(os.homedir(), ".pi", "entwurf-control");
const CORTEX_OVERLAYS_ROOT = path.join(os.homedir(), ".pi", "agent", "cortex-overlays");
const SOCKET_SUFFIX = ".sock";
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
// Load ONLY this checkout's extensions so the resident registers THIS acp-provider.ts.
const REPO_EXTENSION_ARGS = ["--no-extensions", "-e", REPO_ROOT] as const;

const BOOT_TIMEOUT_MS = 30_000;
// The cortex CLI self-extracts on first launch and its newSession alone is
// ~2.5 s; keep the generous default of the sibling smoke.
const TURN_TIMEOUT_MS = Number(process.env.ENTWURF_ACP_CORTEX_TIMEOUT_MS) || 300_000;
const RECLAIM_TIMEOUT_MS = 20_000;
const POLL_MS = 100;

let passed = 0;
function ok(label: string, cond: boolean): void {
	if (!cond) throw new Error(`SMOKE FAIL: ${label}`);
	console.log(`  ok    ${label}`);
	passed++;
}

async function writeFailureArtifact(cap: { stream: string } | null, stderrTail: string, err: unknown): Promise<void> {
	try {
		const stamp = new Date().toISOString().replace(/[:.]/g, "-");
		const file = path.join(os.tmpdir(), `entwurf-smoke-acp-cortex-live-FAIL-${stamp}.log`);
		await fsp.writeFile(
			file,
			`# smoke-acp-cortex-live FAILURE\n# ${err instanceof Error ? err.message : String(err)}\n` +
				`# model: ${ACP_PROVIDER}/${ACP_MODEL}\n\n` +
				`## event stream\n${cap?.stream ?? "(no turn captured)"}\n\n` +
				`## resident stderr tail\n${stderrTail || "(empty)"}\n`,
			"utf8",
		);
		console.error(`[smoke-acp-cortex-live] FAILURE transcript: ${file}`);
	} catch {
		console.error("[smoke-acp-cortex-live] could not write the failure transcript (reporting the original error)");
	}
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForSocket(sockPath: string, timeoutMs: number): Promise<boolean> {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		if (existsSync(sockPath)) return true;
		await sleep(POLL_MS);
	}
	return false;
}

/** pids (other than ours) whose environ carries `needle` — the overlay scope
 *  path is unique per run, so this finds exactly the cortex child + its
 *  grandchildren, never an unrelated operator cortex. Foreign-user /proc
 *  entries EACCES-skip (they cannot be our children). */
async function pidsWithEnvNeedle(needle: string): Promise<number[]> {
	const hits: number[] = [];
	const entries = await fsp.readdir("/proc").catch(() => [] as string[]);
	for (const entry of entries) {
		if (!/^\d+$/.test(entry)) continue;
		const pid = Number(entry);
		if (pid === process.pid) continue;
		try {
			const environ = await fsp.readFile(path.join("/proc", entry, "environ"), "utf8");
			if (environ.includes(needle)) hits.push(pid);
		} catch {
			// gone or not ours — either way not a leak we own
		}
	}
	return hits;
}

interface TurnCapture {
	agentStartSeen: boolean;
	agentEndSeen: boolean;
	extensionErrors: Array<{ path: unknown; event: unknown; error: unknown }>;
	promptAccepted: boolean;
	stream: string;
}

// Drive exactly one model turn over the resident's stdin RPC and capture the
// stdout event stream until `agent_end` (or the hard turn timeout).
function driveTurn(child: ChildProcess, prompt: string): Promise<TurnCapture> {
	return new Promise((resolve) => {
		const cap: TurnCapture = {
			agentStartSeen: false,
			agentEndSeen: false,
			extensionErrors: [],
			promptAccepted: false,
			stream: "",
		};
		let settled = false;
		const finish = (): void => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			rl.close();
			resolve(cap);
		};
		const timer = setTimeout(finish, TURN_TIMEOUT_MS);
		child.once("exit", finish);

		const rl = readline.createInterface({ input: child.stdout! });
		rl.on("line", (line: string) => {
			const trimmed = line.trim();
			if (!trimmed) return;
			cap.stream += `${trimmed}\n`;
			let evt: Record<string, unknown>;
			try {
				evt = JSON.parse(trimmed) as Record<string, unknown>;
			} catch {
				return;
			}
			if (evt.type === "agent_start") cap.agentStartSeen = true;
			if (evt.type === "extension_error") {
				cap.extensionErrors.push({ path: evt.extensionPath, event: evt.event, error: evt.error });
			}
			if (evt.type === "response" && evt.command === "prompt") cap.promptAccepted = evt.success === true;
			if (evt.type === "agent_end") {
				cap.agentEndSeen = true;
				finish();
			}
		});

		child.stdin?.write(`${JSON.stringify({ type: "prompt", message: prompt, id: "cortexv2" })}\n`);
	});
}

async function main(): Promise<void> {
	if (process.env.LIVE !== "1") {
		console.log(
			"[smoke-acp-cortex-live] skipped — set LIVE=1 to run (spawns a real cortex ACP resident + one model turn).",
		);
		return;
	}
	const connection = process.env.ENTWURF_ACP_CORTEX_CONNECTION?.trim();
	if (!connection) {
		console.log(
			"[smoke-acp-cortex-live] skipped — set ENTWURF_ACP_CORTEX_CONNECTION=<snowflake connection> (the dual-HOME " +
				"overlay denies the operator cortex settings.json, so the connection must ride the adapter's own seam).",
		);
		return;
	}
	if ("CORTEX_HOME" in process.env) {
		console.log(
			"[smoke-acp-cortex-live] skipped — unset CORTEX_HOME first (the adapter refuses its presence, CP0 D3).",
		);
		return;
	}

	// One temp root holding the whole garden this smoke can see: store, mailbox
	// and receiver markers. Only these move — the operator's real cortex auth
	// (via overlay symlinks) and the control dir stay real.
	const world = await fsp.mkdtemp(path.join(os.tmpdir(), "acp-cortex-"));
	const sessionsDir = path.join(world, "sessions");
	const mailboxDir = path.join(world, "mailbox");
	const receiversDir = path.join(world, "receivers");
	for (const d of [sessionsDir, mailboxDir, receiversDir]) await fsp.mkdir(d, { recursive: true });

	const nonce = `CORTEXV2-${crypto.randomBytes(5).toString("hex").toUpperCase()}`;

	console.error(`[smoke-acp-cortex-live] repo:  ${REPO_ROOT}`);
	console.error(`[smoke-acp-cortex-live] model: ${ACP_PROVIDER}/${ACP_MODEL} (connection ${connection})`);
	console.error(`[smoke-acp-cortex-live] world: ${world}`);

	// ── the peer: an armed self-fetch citizen, deliverable by the mailbox rail ──
	const receiver = upsertMetaSession({
		input: { backend: "claude-code", nativeSessionId: `acp-cortex-${process.pid}`, cwd: world },
		dir: sessionsDir,
	});
	const receiverGid = receiver.record.gardenId;
	writeMetaReceiverMarker({
		gardenId: receiverGid,
		backend: "claude-code",
		nativeSessionId: receiver.record.nativeSessionId,
		ownerPid: process.pid,
		armProvenance: "session-start",
		receiversDir,
	});
	console.error(`[smoke-acp-cortex-live] peer:  ${receiverGid} (armed mailbox receiver)`);

	let senderGid = "";
	let stderrTail = "";
	let resident: ChildProcess | null = null;
	let cap: TurnCapture | null = null;
	let overlayScopeDir = "";
	try {
		resident = spawn(
			"pi",
			[...REPO_EXTENSION_ARGS, "--entwurf-control", "--provider", ACP_PROVIDER, "--model", ACP_MODEL, "--mode", "rpc"],
			{
				cwd: world,
				stdio: ["pipe", "pipe", "pipe"],
				detached: false,
				env: {
					...process.env,
					ENTWURF_META_SESSIONS_DIR: sessionsDir,
					ENTWURF_META_MAILBOX_DIR: mailboxDir,
					ENTWURF_META_RECEIVERS_DIR: receiversDir,
				},
			},
		);
		resident.stderr?.on("data", (b: Buffer) => {
			stderrTail = (stderrTail + b.toString()).slice(-4000);
		});

		const bornGid = await waitForPiRecord(sessionsDir, BOOT_TIMEOUT_MS);
		ok(`cortex-model resident birthed its own V3 record (${ACP_PROVIDER}/${ACP_MODEL})`, bornGid !== null);
		senderGid = bornGid as string;
		console.error(`[smoke-acp-cortex-live] sender:${senderGid} (never told to the model)`);
		ok("sender and receiver are distinct citizens", senderGid !== receiverGid);
		const sockPath = path.join(REAL_CONTROL_DIR, `${senderGid}${SOCKET_SUFFIX}`);
		ok(
			"resident stood up a control socket keyed on its record gardenId",
			await waitForSocket(sockPath, BOOT_TIMEOUT_MS),
		);

		// The prompt names the TARGET but never the sender's own gid — that can
		// only reach the mailbox via the real envelope the projection carried.
		const prompt =
			`Call the mcp__entwurf-bridge__entwurf_v2 tool exactly once with these arguments: ` +
			`target="${receiverGid}", intent="fire-and-forget", message="${nonce}". ` +
			`Then reply with ONLY the tool's outcome line.`;
		cap = await driveTurn(resident, prompt);

		ok("the prompt RPC command was accepted", cap.promptAccepted);
		ok("a real model turn ran over the stdin RPC (agent_start)", cap.agentStartSeen);
		ok("the turn completed cleanly over RPC (agent_end — no hang)", cap.agentEndSeen);
		ok("no extension_error during the turn", cap.extensionErrors.length === 0);

		// ── the dual-HOME overlay is a disk fact, not an implementation detail ──
		// scope id = `<resident pid>-<hash>` (the resident hosts the ACP spawn).
		const scopeEntries = (await fsp.readdir(CORTEX_OVERLAYS_ROOT).catch(() => [] as string[])).filter((e) =>
			e.startsWith(`${resident?.pid}-`),
		);
		ok(
			`the resident materialized exactly one overlay scope dir (got ${scopeEntries.length})`,
			scopeEntries.length === 1,
		);
		overlayScopeDir = path.join(CORTEX_OVERLAYS_ROOT, scopeEntries[0] as string);
		const ovlCortex = path.join(overlayScopeDir, "home", ".snowflake", "cortex");
		const ovlSettings = JSON.parse(await fsp.readFile(path.join(ovlCortex, "settings.json"), "utf8"));
		ok("the overlay pinned autoUpdate:false (D4)", ovlSettings.autoUpdate === false);
		const ovlMcp = JSON.parse(await fsp.readFile(path.join(ovlCortex, "mcp.json"), "utf8"));
		const bridge = ovlMcp.mcpServers?.["entwurf-bridge"];
		ok("the overlay mcp.json projected the entwurf-bridge entry (D9)", Boolean(bridge));
		ok("the projected bridge entry restored the REAL operator HOME (D10 dual-HOME)", bridge.env?.HOME === os.homedir());
		ok(
			"the projected bridge entry carries the live PI_SESSION_ID envelope",
			typeof bridge.env?.PI_SESSION_ID === "string" && bridge.env.PI_SESSION_ID.length > 0,
		);
		ok(
			`the projected bridge entry carries PI_AGENT_ID=entwurf/${ACP_MODEL}`,
			bridge.env?.PI_AGENT_ID === `${ACP_PROVIDER}/${ACP_MODEL}`,
		);

		// ── the outbound proof is on disk, not in the transcript ──
		const boxDir = path.join(mailboxDir, receiverGid);
		const entries = await fsp.readdir(boxDir).catch(() => [] as string[]);
		const msgs = entries.filter((f) => f.endsWith(".msg"));
		ok(`the model's entwurf_v2 call enqueued exactly one .msg to the peer (got ${msgs.length})`, msgs.length === 1);
		ok("the doorbell inbox.signal was poked", existsSync(path.join(boxDir, "inbox.signal")));

		const body = await fsp.readFile(path.join(boxDir, msgs[0] as string), "utf8");
		const SEPARATOR = "────────────────────────────────────────";
		const sepAt = body.indexOf(`\n${SEPARATOR}\n`);
		ok("the delivered body carries the rendered envelope separator", sepAt !== -1);
		const header = body.slice(0, sepAt + 1);
		const payload = body.slice(sepAt + 1 + SEPARATOR.length + 1);

		const rx = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
		ok("the payload is EXACTLY the nonce (no envelope text folded into it)", payload === `${nonce}\n`);
		ok(
			"the landed sender agentId is the cortex ACP model (anchored envelope line)",
			new RegExp(`^ {2}from: {8}${rx(ACP_PROVIDER)}/${rx(ACP_MODEL)} @ \\S`, "m").test(header),
		);
		ok(
			"the landed sender session IS the resident's own garden id, replyable (anchored envelope line)",
			new RegExp(
				`^ {2}session: {5}${rx(senderGid)} \\(replyable — reply via entwurf_v2 to this sessionId, intent=fire-and-forget\\)$`,
				"m",
			).test(header),
		);
		ok("the sender gid appears ONLY in the envelope, never in the payload", !payload.includes(senderGid));
		ok("the landed sender renders as a pi-session, not a meta-session", !header.includes("(meta-session"));

		// ── process-group reclaim (CP0 teardown finding) ──
		// While the resident lives, its retained cortex child inhabits this run's
		// overlay (SNOWFLAKE_HOME env is unique per scope). An MCP-configured
		// cortex child ignores stdin EOF, so only the resident's process-group
		// teardown can reclaim it — kill the resident and require extinction.
		const liveBefore = await pidsWithEnvNeedle(overlayScopeDir);
		ok(
			`the cortex child (group) is alive inside this run's overlay pre-teardown (got ${liveBefore.length})`,
			liveBefore.length > 0,
		);
		await terminateChild(resident);
		resident = null;
		let leaked: number[] = [];
		const deadline = Date.now() + RECLAIM_TIMEOUT_MS;
		for (;;) {
			leaked = await pidsWithEnvNeedle(overlayScopeDir);
			if (leaked.length === 0 || Date.now() > deadline) break;
			await sleep(250);
		}
		ok(
			`process-group teardown reclaimed every process in this run's overlay (leaked: ${leaked.join(",") || "none"})`,
			leaked.length === 0,
		);
	} catch (err) {
		await writeFailureArtifact(cap, stderrTail, err);
		throw err;
	} finally {
		if (resident) await terminateChild(resident);
		if (overlayScopeDir) await fsp.rm(overlayScopeDir, { recursive: true, force: true }).catch(() => {});
		if (process.env.ENTWURF_KEEP_SMOKE_WORLD === "1") {
			console.error(`[smoke-acp-cortex-live] kept world: ${world}`);
		} else {
			await fsp.rm(world, { recursive: true, force: true }).catch(() => {});
		}
	}

	if (stderrTail && process.env.ENTWURF_SMOKE_VERBOSE === "1") {
		console.error(`[smoke-acp-cortex-live] resident stderr tail:\n${stderrTail}`);
	}
	console.log(
		`smoke-acp-cortex-live: PASS (${passed} assertions) — a cortex ACP model delivered to a peer as itself and was reclaimed`,
	);
}

await main();
