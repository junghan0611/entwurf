// S2g LIVE 4 (axis 4) — an ACP-backed model SENDS through entwurf_v2 and the
// message lands in a peer's mailbox with the sender's real garden identity.
//
//   LIVE=1 ./run.sh smoke-acp-v2-send-live
//
// WHY this axis exists. Until 2026-07-24 every v2 delivery proof was either
// PROGRAMMATIC (smoke-entwurf-v2-matrix-live calls runEntwurfV2 from the smoke
// process — no model in the loop) or RECEIVE-ONLY (smoke-acp-bundled-mcp-live has
// the model call `entwurf_self`, which reads identity but sends nothing). So the
// one claim the branch actually ships — "a Claude behind ACP is a garden citizen
// that can reach its siblings" — had no gate on its SEND half. GLG hit exactly
// that blind spot in real use. A hand-run on 2026-07-24 proved it works (an ACP
// sonnet landed a nonce in a peer mailbox as `entwurf/claude-sonnet-5`,
// replyable); this codifies that hand-run so it cannot silently regress.
//
// It is deliberately NOT satisfiable by the two smokes above: a programmatic
// dispatch never exercises the model's tool-call path, and `entwurf_self` never
// writes a `.msg`. Do not fold this into either of them.
//
// METHOD. Seed an isolated world (store + mailbox + receivers under one temp
// root) holding ONE armed self-fetch receiver — a citizen that is deliverable by
// the mailbox rail. Launch a real `pi --entwurf-control --mode rpc` resident on an
// ACP model with that world in its env, so the bundled entwurf-bridge child
// inherits it and can only reach the seeded receiver. Drive one turn asking the
// model to call `mcp__entwurf-bridge__entwurf_v2` at that exact target with a
// nonce, then assert ON DISK: exactly one `.msg` in the receiver's mailbox, the
// doorbell poked, the nonce intact, and the rendered sender naming the RESIDENT's
// own garden id + `entwurf/<model>` + replyable. The resident's gid is never put
// in the prompt — it can only appear in the landed message because the real
// envelope carried it.
//
// The isolated world also keeps the operator's live store and mailbox clean: a
// smoke that delivers into the real garden would page a human.
//
// KNOWN OPEN DEFECT this gate catches — bundled-MCP readiness (2026-07-24). Two
// independent failures were first read as the model declining an explicit
// instruction, and the transcripts said otherwise: the model DID call, and the
// runtime answered `No such tool available: mcp__entwurf-bridge__entwurf_v2` (the
// sibling smoke-acp-bundled-mcp-live failed the same way in the same aggregate, its
// model reporting that only Read/Bash/Edit/Write/Skill were exposed). The window is
// structural: claude-agent-acp 0.61.0's createSession awaits only
// `initializationResult()`, and this backend prompts right after
// (acp/backend.ts:718-790) — nothing waits for the configured MCP servers to reach
// `connected`, though claude-agent-sdk 0.3.217 exposes exactly that via
// `mcpServerStatus()`. Both observed hits came under heavy concurrent load, which
// is correlation, not established cause. So this gate stays MUST: its failures are
// OURS. Until the readiness wait exists, a FAIL here is a real release blocker and
// must not be re-read as model flakiness.
//
// LIVE-only — kept OUT of `pnpm check`; honest skip when LIVE!=1 (skip = CI safety,
// NOT an acceptance PASS). Model override: ENTWURF_ACP_PROVIDER_MODEL (default sonnet).

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
const ACP_MODEL = process.env.ENTWURF_ACP_PROVIDER_MODEL?.trim() || "claude-sonnet-5";

const REAL_CONTROL_DIR = path.join(os.homedir(), ".pi", "entwurf-control");
const SOCKET_SUFFIX = ".sock";
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
// Load ONLY this checkout's extensions so the resident registers THIS acp-provider.ts.
const REPO_EXTENSION_ARGS = ["--no-extensions", "-e", REPO_ROOT] as const;

const BOOT_TIMEOUT_MS = 30_000;
const TURN_TIMEOUT_MS = Number(process.env.ENTWURF_ACP_PROVIDER_TIMEOUT_MS) || 240_000;
const POLL_MS = 100;

let passed = 0;
function ok(label: string, cond: boolean): void {
	if (!cond) throw new Error(`SMOKE FAIL: ${label}`);
	console.log(`  ok    ${label}`);
	passed++;
}

/** On failure, persist the turn transcript outside the temp world and name the file.
 * Best-effort: an artifact write must never mask the real assertion error. */
async function writeFailureArtifact(cap: { stream: string } | null, stderrTail: string, err: unknown): Promise<void> {
	try {
		const stamp = new Date().toISOString().replace(/[:.]/g, "-");
		const file = path.join(os.tmpdir(), `entwurf-smoke-acp-v2-send-live-FAIL-${stamp}.log`);
		await fsp.writeFile(
			file,
			`# smoke-acp-v2-send-live FAILURE\n# ${err instanceof Error ? err.message : String(err)}\n` +
				`# model: ${ACP_PROVIDER}/${ACP_MODEL}\n\n` +
				`## event stream\n${cap?.stream ?? "(no turn captured)"}\n\n` +
				`## resident stderr tail\n${stderrTail || "(empty)"}\n`,
			"utf8",
		);
		console.error(`[smoke-acp-v2-send-live] FAILURE transcript: ${file}`);
	} catch {
		console.error("[smoke-acp-v2-send-live] could not write the failure transcript (reporting the original error)");
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

interface TurnCapture {
	agentStartSeen: boolean;
	agentEndSeen: boolean;
	extensionErrors: Array<{ path: unknown; event: unknown; error: unknown }>;
	promptAccepted: boolean;
	stream: string;
}

// Drive exactly one model turn over the resident's stdin RPC and capture the stdout
// event stream until `agent_end` (or a hard turn timeout). Mirrors resident-rpc-drive.ts.
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
		// A dead child can never emit agent_end — settle instead of burning the timeout.
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

		child.stdin?.write(`${JSON.stringify({ type: "prompt", message: prompt, id: "v2send" })}\n`);
	});
}

async function main(): Promise<void> {
	if (process.env.LIVE !== "1") {
		console.log(
			"[smoke-acp-v2-send-live] skipped — set LIVE=1 to run (spawns a real pi --entwurf-control resident + drives one model turn).",
		);
		return;
	}

	// One temp root holding the whole garden this smoke can see: store, mailbox and
	// receiver markers. Only these move — auth.json (subscription login) and the
	// control dir stay real, exactly as smoke-acp-bundled-mcp-live does.
	const world = await fsp.mkdtemp(path.join(os.tmpdir(), "acp-v2-send-"));
	const sessionsDir = path.join(world, "sessions");
	const mailboxDir = path.join(world, "mailbox");
	const receiversDir = path.join(world, "receivers");
	for (const d of [sessionsDir, mailboxDir, receiversDir]) await fsp.mkdir(d, { recursive: true });

	const nonce = `ACPV2-${crypto.randomBytes(5).toString("hex").toUpperCase()}`;

	console.error(`[smoke-acp-v2-send-live] repo:  ${REPO_ROOT}`);
	console.error(`[smoke-acp-v2-send-live] model: ${ACP_PROVIDER}/${ACP_MODEL}`);
	console.error(`[smoke-acp-v2-send-live] world: ${world}`);

	// ── the peer: an armed self-fetch citizen, deliverable by the mailbox rail ──
	const receiver = upsertMetaSession({
		input: { backend: "claude-code", nativeSessionId: `acp-v2-send-${process.pid}`, cwd: world },
		dir: sessionsDir,
	});
	const receiverGid = receiver.record.gardenId;
	// armed = a presence marker owned by THIS (live) process → deliverable.
	writeMetaReceiverMarker({
		gardenId: receiverGid,
		backend: "claude-code",
		nativeSessionId: receiver.record.nativeSessionId,
		ownerPid: process.pid,
		armProvenance: "session-start",
		receiversDir,
	});
	console.error(`[smoke-acp-v2-send-live] peer:  ${receiverGid} (armed mailbox receiver)`);

	let senderGid = "";
	let stderrTail = "";
	let resident: ChildProcess | null = null;
	let cap: TurnCapture | null = null;
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

		// The resident births its own record — that gid is the SENDER identity under test.
		// waitForPiRecord matches `backend:"pi"` only, so the seeded claude-code receiver
		// sharing this store can never be mistaken for it.
		const bornGid = await waitForPiRecord(sessionsDir, BOOT_TIMEOUT_MS);
		ok(`ACP-model resident birthed its own V3 record (${ACP_PROVIDER}/${ACP_MODEL})`, bornGid !== null);
		senderGid = bornGid as string;
		console.error(`[smoke-acp-v2-send-live] sender:${senderGid} (never told to the model)`);
		ok("sender and receiver are distinct citizens", senderGid !== receiverGid);
		const sockPath = path.join(REAL_CONTROL_DIR, `${senderGid}${SOCKET_SUFFIX}`);
		ok(
			`resident stood up a control socket keyed on its record gardenId`,
			await waitForSocket(sockPath, BOOT_TIMEOUT_MS),
		);

		// The prompt names the TARGET (the model must be told whom to reach) but never
		// the sender's own gid — that can only reach the mailbox via the real envelope.
		const prompt =
			`Call the mcp__entwurf-bridge__entwurf_v2 tool exactly once with these arguments: ` +
			`target="${receiverGid}", intent="fire-and-forget", message="${nonce}". ` +
			`Then reply with ONLY the tool's outcome line.`;
		cap = await driveTurn(resident, prompt);

		ok("the prompt RPC command was accepted", cap.promptAccepted);
		ok("a real model turn ran over the stdin RPC (agent_start)", cap.agentStartSeen);
		ok("the turn completed cleanly over RPC (agent_end — no hang)", cap.agentEndSeen);
		ok("no extension_error during the turn", cap.extensionErrors.length === 0);

		// ── the proof is on disk, not in the transcript ────────────────────────────
		const boxDir = path.join(mailboxDir, receiverGid);
		const entries = await fsp.readdir(boxDir).catch(() => [] as string[]);
		const msgs = entries.filter((f) => f.endsWith(".msg"));
		ok(`the model's entwurf_v2 call enqueued exactly one .msg to the peer (got ${msgs.length})`, msgs.length === 1);
		ok("the doorbell inbox.signal was poked", existsSync(path.join(boxDir, "inbox.signal")));

		const body = await fsp.readFile(path.join(boxDir, msgs[0] as string), "utf8");

		// GPT cross-review (2026-07-24): these identity assertions used to be
		// substring scans over the WHOLE body, which is a false-green hole — the
		// model can learn its own gid (a bundled `entwurf_self` call) and echo it
		// into the message PAYLOAD, satisfying every `includes()` even if the
		// rendered envelope were wrong. The envelope is the thing under test, so
		// split the body at the renderer's separator and assert the header lines
		// ANCHORED and the payload EXACTLY. Then a payload can never stand in for
		// an envelope. Format owner: pi-extensions/lib/meta-mailbox-body.ts.
		const SEPARATOR = "────────────────────────────────────────";
		const sepAt = body.indexOf(`\n${SEPARATOR}\n`);
		ok("the delivered body carries the rendered envelope separator", sepAt !== -1);
		const header = body.slice(0, sepAt + 1);
		const payload = body.slice(sepAt + 1 + SEPARATOR.length + 1);

		// ACP_MODEL is operator-overridable (ENTWURF_ACP_PROVIDER_MODEL), so it is
		// UNTRUSTED regex input: a `.` in a model name would silently become a
		// wildcard (false green) and a `(` would crash the compile. Escape every
		// interpolation, including the gid, before it reaches a pattern.
		const rx = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
		ok("the payload is EXACTLY the nonce (no envelope text folded into it)", payload === `${nonce}\n`);
		ok(
			"the landed sender agentId is the ACP model (anchored envelope line)",
			new RegExp(`^ {2}from: {8}${rx(ACP_PROVIDER)}/${rx(ACP_MODEL)} @ \\S`, "m").test(header),
		);
		ok(
			"the landed sender session IS the resident's own garden id, replyable (anchored envelope line)",
			new RegExp(
				`^ {2}session: {5}${rx(senderGid)} \\(replyable — reply via entwurf_v2 to this sessionId, intent=fire-and-forget\\)$`,
				"m",
			).test(header),
		);
		// The gid reached the mailbox through the envelope, not through anything the
		// model typed: it is never in the prompt, and it must not be in the payload.
		ok("the sender gid appears ONLY in the envelope, never in the payload", !payload.includes(senderGid));
		// origin=pi-session renders WITHOUT the "meta-session, " qualifier; a self-fetch
		// origin would render "(meta-session, replyable…)". Pin the pi-session shape.
		ok("the landed sender renders as a pi-session, not a meta-session", !header.includes("(meta-session"));
	} catch (err) {
		// A model-in-loop failure is unreadable without the turn it failed on. Both
		// 2026-07-24 failures of this gate were first misdiagnosed as "the model
		// declined the instruction" and only the stream showed the truth — the model
		// DID call and the runtime answered `No such tool available`. That stream was
		// only recoverable from the pi session JSONL, because the tail here prints
		// under ENTWURF_SMOKE_VERBOSE and a CI/aggregate run does not set it. So a
		// FAILURE now always leaves the transcript on disk, outside the world dir the
		// finally block is about to delete, and says where.
		await writeFailureArtifact(cap, stderrTail, err);
		throw err;
	} finally {
		if (resident) await terminateChild(resident);
		if (process.env.ENTWURF_KEEP_SMOKE_WORLD === "1") {
			console.error(`[smoke-acp-v2-send-live] kept world: ${world}`);
		} else {
			await fsp.rm(world, { recursive: true, force: true }).catch(() => {});
		}
	}

	if (stderrTail && process.env.ENTWURF_SMOKE_VERBOSE === "1") {
		console.error(`[smoke-acp-v2-send-live] resident stderr tail:\n${stderrTail}`);
	}
	console.log(`smoke-acp-v2-send-live: PASS (${passed} assertions) — an ACP model delivered to a peer as itself`);
}

await main();
