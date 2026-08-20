// P3 — the cross-harness delivery CHAIN, on real authenticated rails.
//
//   LIVE=1 ./run.sh smoke-entwurf-chain-live
//
// WHY THIS EXISTS. Every v2 delivery proof we had covered ONE hop between TWO
// citizens on ONE rail: matrix-live dispatches programmatically, v2-send-live has
// an ACP model send into a mailbox, bundled-mcp-live only reads identity. The
// claim the project actually makes — that independent harnesses address each
// other by garden id — is a CHAIN claim, and nothing exercised a chain. A gate
// that never links three harnesses cannot catch the failure where hop 2 loses the
// sender identity hop 1 carried, or where a rail change breaks only the seam
// between two backends.
//
// THE CHAIN (each arrow is a real model turn on a real authenticated backend):
//
//   A  native Claude Code      --entwurf_v2-->  B  pi / openai-codex (GPT)
//   B                          --entwurf_v2-->  C  pi / entwurf claude-sonnet-5 (ACP)
//   C                          --entwurf_v2-->  D  mailbox-backed self-fetch citizen
//
// Three harnesses, three rails: A is a native self-fetch citizen born by its own
// SessionStart hook, B and C are live control-socket citizens, and D is the
// mailbox terminus. The terminus is what makes the READ-RECEIPT axis observable
// at all — a control-socket delivery has no receipt to stamp, so a chain that
// ended at C could not produce one. Draining D through the production inbox
// reader stamps `lastReadAt`, and that is the receipt.
//
// WHAT IS REAL AND WHAT IS SMOKE-OWNED (state this honestly or the evidence is
// worth nothing):
//   - REAL: A's meta-record and its first arming are minted by the operator's own
//     Claude Code SessionStart hook; all three deliveries are production
//     `entwurf_v2` dispatches chosen by the decider; all three model turns are
//     real authenticated calls; every sender envelope is the real one.
//   - SMOKE-OWNED: the isolated world (store / mailbox / receivers under one temp
//     root) so the operator's live garden is never paged, and D's arming marker.
//     D is a seeded citizen exactly as smoke-acp-v2-send-live seeds its peer.
//   - NOT CLAIMED: this proves the chain LINKS, not that any model chooses the
//     entwurf surface on its own. Each hop is TOLD which tool to call, which is
//     why this is a MUST-tier delivery gate and not a BEHAVIOR-lane signal (the
//     lane note in run.sh draws exactly that line).
//
// The nonce is the thread: it is minted here, embedded in A's instruction, and
// must arrive at D having been re-sent by B and again by C. A nonce at D proves
// the payload traversed every hop — no hop can fabricate it.
//
// Sender identity is proven the same way v2-send-live proves it: no hop is ever
// told its OWN garden id, so a gid can only appear downstream because the real
// envelope carried it.

import { strict as assert } from "node:assert";
import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import crypto from "node:crypto";
import { existsSync } from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readMetaInbox, upsertMetaSession, writeMetaReceiverMarker } from "../pi-extensions/lib/meta-session.ts";
import { terminateChild } from "./lib/acp-child-cleanup.ts";
import { skipLive } from "./lib/live-skip.ts";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const REPO_EXTENSION_ARGS = ["--no-extensions", "-e", REPO_ROOT] as const;
const REAL_CONTROL_DIR = path.join(os.homedir(), ".pi", "entwurf-control");
const SOCKET_SUFFIX = ".sock";

const GPT_TARGET = process.env.ENTWURF_CHAIN_GPT_TARGET?.trim() || "openai-codex/gpt-5.6-luna";
const ACP_TARGET = process.env.ENTWURF_CHAIN_ACP_TARGET?.trim() || "entwurf/claude-sonnet-5";
const BOOT_TIMEOUT_MS = 45_000;
const CLAUDE_TURN_TIMEOUT_MS = Number(process.env.ENTWURF_CHAIN_CLAUDE_TIMEOUT_MS) || 240_000;
const CHAIN_TIMEOUT_MS = Number(process.env.ENTWURF_CHAIN_TIMEOUT_MS) || 420_000;
const POLL_MS = 250;

let passed = 0;
function ok(label: string, cond: boolean): void {
	assert.ok(cond, `smoke-entwurf-chain-live: ${label}`);
	console.log(`  ok    ${label}`);
	passed++;
}

function splitTarget(t: string): [provider: string, model: string] {
	const i = t.indexOf("/");
	assert.ok(i > 0, `target must be <provider>/<model>, got ${t}`);
	return [t.slice(0, i), t.slice(i + 1)];
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

async function readRecords(dir: string): Promise<Array<{ gardenId: string; backend: string }>> {
	const out: Array<{ gardenId: string; backend: string }> = [];
	for (const f of await fsp.readdir(dir).catch(() => [] as string[])) {
		if (!f.endsWith(".meta.json")) continue;
		try {
			const r = JSON.parse(await fsp.readFile(path.join(dir, f), "utf8")) as Record<string, unknown>;
			if (typeof r.gardenId === "string" && typeof r.backend === "string") {
				out.push({ gardenId: r.gardenId, backend: r.backend });
			}
		} catch {
			/* a half-written record on the next poll is not an error */
		}
	}
	return out;
}

/** Wait for ONE new record of `backend` that is not already in `known`. */
async function waitForNewRecord(dir: string, backend: string, known: Set<string>, ms: number): Promise<string | null> {
	const until = Date.now() + ms;
	while (Date.now() < until) {
		for (const r of await readRecords(dir)) {
			if (r.backend === backend && !known.has(r.gardenId)) return r.gardenId;
		}
		await sleep(POLL_MS);
	}
	return null;
}

async function waitForSocket(p: string, ms: number): Promise<boolean> {
	const until = Date.now() + ms;
	while (Date.now() < until) {
		if (existsSync(p)) return true;
		await sleep(POLL_MS);
	}
	return false;
}

async function main(): Promise<void> {
	if (process.env.LIVE !== "1") {
		skipLive(
			"smoke-entwurf-chain-live",
			"set LIVE=1 to run (drives three real authenticated model turns across Claude Code, pi GPT and pi ACP).",
		);
	}
	if (spawnSync("bash", ["-lc", "command -v claude"], { encoding: "utf8" }).status !== 0) {
		skipLive("smoke-entwurf-chain-live", "claude not on PATH — hop 1 is a real native Claude Code turn.");
	}
	const [gptProvider, gptModel] = splitTarget(GPT_TARGET);
	const [acpProvider, acpModel] = splitTarget(ACP_TARGET);
	// pi holds each backend's credentials in its own auth store; a missing one is a
	// PREREQUISITE (the operator has not logged that backend in), never a defect.
	const authPath = path.join(os.homedir(), ".pi", "agent", "auth.json");
	let auth: Record<string, unknown> = {};
	try {
		auth = JSON.parse(await fsp.readFile(authPath, "utf8")) as Record<string, unknown>;
	} catch {
		skipLive("smoke-entwurf-chain-live", `no pi auth store at ${authPath} — log in the chain's backends first.`);
	}
	if (!(gptProvider in auth)) {
		skipLive(
			"smoke-entwurf-chain-live",
			`pi has no '${gptProvider}' credentials (hop 2 target ${GPT_TARGET}); log that backend in, or point ` +
				"ENTWURF_CHAIN_GPT_TARGET at one you have.",
		);
	}

	const world = await fsp.mkdtemp(path.join(os.tmpdir(), "entwurf-chain-"));
	const sessionsDir = path.join(world, "sessions");
	const mailboxDir = path.join(world, "mailbox");
	const receiversDir = path.join(world, "receivers");
	for (const d of [sessionsDir, mailboxDir, receiversDir]) await fsp.mkdir(d, { recursive: true });
	const worldEnv = {
		ENTWURF_META_SESSIONS_DIR: sessionsDir,
		ENTWURF_META_MAILBOX_DIR: mailboxDir,
		ENTWURF_META_RECEIVERS_DIR: receiversDir,
	};
	// The MCP bridge prefers PI_SESSION_ID+PI_AGENT_ID over a meta-sender marker when both
	// are present. A runner that is itself a pi --entwurf-control session (release-gate,
	// an agent preparing a cut) would otherwise stamp every Claude hop with the RUNNER's
	// garden id — hop 1 then fails "B saw A's real garden id" while the payload still
	// traverses. Strip the carriers so A's SessionStart marker is the only authority.
	const childEnv: NodeJS.ProcessEnv = { ...process.env, ...worldEnv };
	delete childEnv.PI_SESSION_ID;
	delete childEnv.PI_AGENT_ID;

	const nonce = `ENTWURF-CHAIN-${crypto.randomBytes(5).toString("hex").toUpperCase()}`;
	console.error(`[smoke-entwurf-chain-live] repo:   ${REPO_ROOT}`);
	console.error(`[smoke-entwurf-chain-live] world:  ${world}`);
	console.error(`[smoke-entwurf-chain-live] hop2:   ${GPT_TARGET}`);
	console.error(`[smoke-entwurf-chain-live] hop3:   ${ACP_TARGET}`);
	console.error(`[smoke-entwurf-chain-live] nonce:  ${nonce}`);

	// ── D: the mailbox terminus (seeded + armed by this process, like v2-send) ──
	const terminus = upsertMetaSession({
		input: { backend: "claude-code", nativeSessionId: `chain-terminus-${process.pid}`, cwd: world },
		dir: sessionsDir,
	});
	const gidD = terminus.record.gardenId;
	writeMetaReceiverMarker({
		gardenId: gidD,
		backend: "claude-code",
		nativeSessionId: terminus.record.nativeSessionId,
		ownerPid: process.pid,
		armProvenance: "session-start",
		receiversDir,
	});
	console.error(`[smoke-entwurf-chain-live] D:      ${gidD} (mailbox terminus)`);

	const children: ChildProcess[] = [];
	let streamB = "";
	let streamC = "";
	try {
		// ── C: the ACP Claude Sonnet citizen (spawned first so B can be told its id) ──
		const known = new Set((await readRecords(sessionsDir)).map((r) => r.gardenId));
		const c = spawn(
			"pi",
			[...REPO_EXTENSION_ARGS, "--entwurf-control", "--provider", acpProvider, "--model", acpModel, "--mode", "rpc"],
			{ cwd: world, stdio: ["pipe", "pipe", "pipe"], env: childEnv },
		);
		children.push(c);
		c.stdout?.on("data", (b: Buffer) => {
			streamC = (streamC + b.toString()).slice(-200_000);
		});
		c.stderr?.on("data", (b: Buffer) => {
			streamC = (streamC + b.toString()).slice(-200_000);
		});
		const gidC = await waitForNewRecord(sessionsDir, "pi", known, BOOT_TIMEOUT_MS);
		ok(`C birthed its own pi record (${ACP_TARGET})`, gidC !== null);
		known.add(gidC as string);
		ok(
			"C stood up a control socket",
			await waitForSocket(path.join(REAL_CONTROL_DIR, `${gidC}${SOCKET_SUFFIX}`), BOOT_TIMEOUT_MS),
		);

		// ── B: the pi GPT citizen ────────────────────────────────────────────────
		const b = spawn(
			"pi",
			[...REPO_EXTENSION_ARGS, "--entwurf-control", "--provider", gptProvider, "--model", gptModel, "--mode", "rpc"],
			{ cwd: world, stdio: ["pipe", "pipe", "pipe"], env: childEnv },
		);
		children.push(b);
		b.stdout?.on("data", (x: Buffer) => {
			streamB = (streamB + x.toString()).slice(-200_000);
		});
		b.stderr?.on("data", (x: Buffer) => {
			streamB = (streamB + x.toString()).slice(-200_000);
		});
		const gidB = await waitForNewRecord(sessionsDir, "pi", known, BOOT_TIMEOUT_MS);
		ok(`B birthed its own pi record (${GPT_TARGET})`, gidB !== null);
		known.add(gidB as string);
		ok(
			"B stood up a control socket",
			await waitForSocket(path.join(REAL_CONTROL_DIR, `${gidB}${SOCKET_SUFFIX}`), BOOT_TIMEOUT_MS),
		);
		ok("B, C and D are three distinct citizens", new Set([gidB, gidC, gidD]).size === 3);

		// ── A: one real native Claude Code turn that opens the chain ─────────────
		// The instruction each hop receives is the message the previous hop sends.
		// No hop is told its own garden id — that is what makes the downstream
		// sender assertions meaningful.
		const hop3 = [
			`${nonce} hop3. You are the third hop of a delivery chain.`,
			`Call the tool mcp__entwurf-bridge__entwurf_v2 exactly once with target=${gidD}, intent=fire-and-forget,`,
			`and message=${nonce} terminus. Then reply with only the tool's outcome line.`,
		].join(" ");
		const hop2 = [
			`${nonce} hop2. You are the second hop of a delivery chain.`,
			`Call the tool mcp__entwurf-bridge__entwurf_v2 exactly once with target=${gidC}, intent=fire-and-forget,`,
			"and message set to exactly the text between INNER-BEGIN and INNER-END.",
			"Then reply with only the tool's outcome line.",
			"INNER-BEGIN",
			hop3,
			"INNER-END",
		].join("\n");
		const hop1Prompt = [
			"You are the first hop of a delivery chain. Do exactly this and nothing else.",
			`Call the tool mcp__entwurf-bridge__entwurf_v2 exactly once with target=${gidB}, intent=fire-and-forget,`,
			"and message set to exactly the text between BEGIN and END.",
			"Then reply with only the tool's outcome line.",
			"BEGIN",
			hop2,
			"END",
		].join("\n");

		const claudeRun = spawnSync("claude", ["-p", "--output-format=json", hop1Prompt], {
			cwd: world,
			encoding: "utf8",
			timeout: CLAUDE_TURN_TIMEOUT_MS,
			env: childEnv,
		});
		const claudeOut = `${claudeRun.stdout ?? ""}\n${claudeRun.stderr ?? ""}`;
		ok("A's native Claude Code turn ran", claudeRun.status === 0);

		const gidA = await waitForNewRecord(sessionsDir, "claude-code", new Set([gidD]), BOOT_TIMEOUT_MS);
		ok("A was born a garden citizen by its OWN SessionStart hook (not seeded here)", gidA !== null);
		ok("A is distinct from every other citizen", !new Set([gidB, gidC, gidD]).has(gidA as string));
		console.error(`[smoke-entwurf-chain-live] A:      ${gidA} (native Claude Code)`);

		// ── the chain runs on its own from here; wait for the terminus ───────────
		const boxDir = path.join(mailboxDir, gidD);
		const until = Date.now() + CHAIN_TIMEOUT_MS;
		let msgs: string[] = [];
		while (Date.now() < until) {
			msgs = (await fsp.readdir(boxDir).catch(() => [] as string[])).filter(
				(f) => f.endsWith(".msg") || f.endsWith(".msg.delivered"),
			);
			if (msgs.length > 0) break;
			await sleep(POLL_MS);
		}
		if (msgs.length === 0) {
			console.error(`[smoke-entwurf-chain-live] A turn output:\n${claudeOut.slice(0, 1500)}`);
			console.error(`[smoke-entwurf-chain-live] B stream tail:\n${streamB.slice(-2000)}`);
			console.error(`[smoke-entwurf-chain-live] C stream tail:\n${streamC.slice(-2000)}`);
		}
		ok(`the chain reached the mailbox terminus (${msgs.length} .msg)`, msgs.length === 1);
		ok("the terminus doorbell was poked", existsSync(path.join(boxDir, "inbox.signal")));

		const body = await fsp.readFile(path.join(boxDir, msgs[0] as string), "utf8");

		// ── hop-by-hop evidence ─────────────────────────────────────────────────
		// hop 1: B saw the payload AND the real sender identity of a native
		// Claude Code citizen. A never learned its own gid, so its presence in B's
		// stream can only come from the envelope entwurf_v2 rendered.
		ok("hop 1 — B received the chain payload", streamB.includes(nonce));
		ok("hop 1 — B saw A's real garden id as the sender", streamB.includes(gidA as string));
		ok("hop 1 — the sender was rendered replyable to B", /replyable/i.test(streamB));

		// hop 2: C saw the payload and B's identity, so the chain did not collapse
		// into A talking to C directly.
		ok("hop 2 — C received the chain payload", streamC.includes(nonce));
		ok("hop 2 — C saw B's real garden id as the sender", streamC.includes(gidB as string));

		// hop 3: the terminus body carries C's identity, its model, and replyable.
		ok("hop 3 — the terminus payload is the original nonce", body.includes(nonce));
		ok("hop 3 — the terminus names C as the sender", body.includes(gidC as string));
		ok(`hop 3 — the terminus names C's backend model (${acpModel})`, body.includes(acpModel));
		ok("hop 3 — the terminus sender is replyable", /replyable/i.test(body));
		ok(
			"the terminus was not reached by a shortcut — A and B are not its sender",
			!body.includes(gidA as string) && !body.includes(gidB as string),
		);

		// ── the read receipt: the one axis only the mailbox rail can produce ─────
		// The PRODUCTION reader, not a re-implementation: reading is what stamps the
		// receipt, so a hand-rolled drain would prove nothing about the real path.
		const statePath = path.join(mailboxDir, gidD, "state.json");
		const beforeRaw = await fsp.readFile(statePath, "utf8").catch(() => "");
		const drained = readMetaInbox({ gardenId: gidD, sessionsDir, mailboxDir });
		ok(
			"draining the terminus returned the chain payload",
			drained.messages.some((m) => m.body.includes(nonce)),
		);
		ok(
			"the drain stamped a read receipt (lastReadAt)",
			typeof drained.readAt === "string" && drained.readAt.length > 0,
		);
		const afterRaw = await fsp.readFile(statePath, "utf8").catch(() => "");
		ok(
			"the receipt is durable on disk, not just in the return value",
			/lastReadAt/.test(afterRaw) && afterRaw !== beforeRaw,
		);

		console.error(`[smoke-entwurf-chain-live] chain: ${gidA} → ${gidB} → ${gidC} → ${gidD}`);
	} finally {
		for (const ch of children) await terminateChild(ch).catch(() => undefined);
	}

	console.log(
		`[smoke-entwurf-chain-live] ok — ${passed} assertions; three harnesses linked on real authenticated rails`,
	);
}

await main();
