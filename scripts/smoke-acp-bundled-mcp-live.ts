// S2g LIVE 3 (axis 3) — the BUNDLED entwurf-bridge reaches the live ACP session
// via the 0.11.0 resident/RPC circuit. LIVE-gated, OUT of `pnpm check`.
//
//   LIVE=1 ./run.sh smoke-acp-bundled-mcp-live
//
// WHY a separate axis. smoke-acp-mcp-live proves the generic passthrough with a
// TINY isolated probe MCP (so a failure isolates to "did mcpServers reach
// newSession" without identity/env coupling). This smoke proves the LAST mile that
// probe deliberately skips: the operator's REAL bundled `entwurf-bridge` — the one
// that needs PI_SESSION_ID/PI_AGENT_ID envelope injection (enrichMcpServersWithEnvelope)
// to answer entwurf_self — reaches the live ACP session and can be CALLED by the model.
// GLG verified this by hand (entwurf_self → sessionId/agentId/socketState alive); this
// codifies that hand-check into a repeatable gate.
//
// WHY resident/RPC, not `pi -p` one-shot. A `pi -p` one-shot + bundled tool-call
// hangs on closeSession/teardown — that hang is diagnostic backlog, NOT this smoke's
// subject, and NOT the 0.11.0 release circuit (whose bundled-MCP evidence was always
// resident/RPC). So this smoke RESTORES the 0.11.0 circuit: it drives the bundled
// bridge through a long-lived `pi --entwurf-control --mode rpc` resident, the same
// stdin-RPC / stdout-event-stream driver as scripts/gnew-rpc-drive.ts.
//
// METHOD (gnew-rpc-drive shape): launch a real resident on an ACP model, send one
// `{type:"prompt"}` over stdin asking the model to call mcp__entwurf-bridge__entwurf_self,
// and capture — DIRECTLY from the stdout RPC event stream — the identity envelope
// (the resident's own freshly-minted gid, agentId entwurf/<model>, socketState
// alive) plus `agent_end`. The gid is never told to the model: it lives only as the
// resident's PI_SESSION_ID, injected into the bridge env, so the model can surface it
// ONLY by actually calling the tool. JSONL is an L3 backstop, never the primary proof.
//
// The bundled bridge is supplied by the operator's REAL
// entwurfProvider.mcpServers.entwurf-bridge (global ~/.pi/agent/settings.json) —
// this is the operator circuit, not a scratch-isolated probe. If the operator has not
// wired it, the smoke fails loud (the circuit is not installed).
//
// LIVE-only — kept OUT of `pnpm check`; honest skip when LIVE!=1 (skip = CI safety,
// NOT an acceptance PASS). Model override: ENTWURF_ACP_PROVIDER_MODEL (default sonnet).

import { type ChildProcess, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as readline from "node:readline";
import { fileURLToPath } from "node:url";
import { fetchControlSocketRuntimeInfo, formatRuntimeModel } from "../pi-extensions/lib/entwurf-control-rpc.ts";
import { generateSessionId } from "../pi-extensions/lib/entwurf-core.ts";
import { terminateChild } from "./lib/acp-child-cleanup.ts";

const ACP_PROVIDER = "entwurf";
const ACP_MODEL = process.env.ENTWURF_ACP_PROVIDER_MODEL?.trim() || "claude-sonnet-4-6";

const REAL_CONTROL_DIR = path.join(os.homedir(), ".pi", "entwurf-control");
const SOCKET_SUFFIX = ".sock";
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
// Load ONLY this checkout's extensions so the resident registers THIS acp-provider.ts.
const REPO_EXTENSION_ARGS = ["--no-extensions", "-e", REPO_ROOT] as const;

const BOOT_TIMEOUT_MS = 30_000;
const TURN_TIMEOUT_MS = Number(process.env.ENTWURF_ACP_PROVIDER_TIMEOUT_MS) || 240_000;
const POLL_MS = 100;

const STUB_PATTERN = /AcpBackendNotImplementedError|not implemented in S0/i;

let passed = 0;
function ok(label: string, cond: boolean): void {
	if (!cond) throw new Error(`SMOKE FAIL: ${label}`);
	console.log(`  ok    ${label}`);
	passed++;
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

async function waitForGone(sockPath: string, timeoutMs: number): Promise<boolean> {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		if (!existsSync(sockPath)) return true;
		await sleep(POLL_MS);
	}
	return !existsSync(sockPath);
}

interface TurnCapture {
	agentStartSeen: boolean;
	agentEndSeen: boolean;
	extensionErrors: Array<{ path: unknown; event: unknown; error: unknown }>;
	promptAccepted: boolean;
	// Every line the resident emitted AFTER the prompt was sent — the envelope (a tool
	// result embedded as an escaped string) and the assistant's reply both land here.
	stream: string;
}

// Drive exactly one model turn over the resident's stdin RPC and capture the stdout
// event stream until `agent_end` (or a hard turn timeout). Mirrors gnew-rpc-drive.ts.
function driveSelfTurn(child: ChildProcess, prompt: string): Promise<TurnCapture> {
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
		// If the resident dies before agent_end, settle now instead of burning the full
		// turn timeout — a dead child can never emit agent_end (the assertions then fail loud).
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

		child.stdin?.write(`${JSON.stringify({ type: "prompt", message: prompt, id: "self" })}\n`);
	});
}

async function main(): Promise<void> {
	if (process.env.LIVE !== "1") {
		console.log(
			"[smoke-acp-bundled-mcp-live] skipped — set LIVE=1 to run (spawns a real pi --entwurf-control resident + drives one model turn).",
		);
		return;
	}

	const gid = generateSessionId();
	const sockPath = path.join(REAL_CONTROL_DIR, `${gid}${SOCKET_SUFFIX}`);
	const tmp = os.tmpdir();

	// A fresh gid must not collide with a pre-existing socket (else teardown deletes
	// someone else's live socket). Fail loud rather than risk it.
	ok("fresh gid has no pre-existing control socket", !existsSync(sockPath));

	console.error(`[smoke-acp-bundled-mcp-live] repo:  ${REPO_ROOT}`);
	console.error(
		`[smoke-acp-bundled-mcp-live] gid:   ${gid} (never told to the model — only the bridge env carries it)`,
	);
	console.error(`[smoke-acp-bundled-mcp-live] model: ${ACP_PROVIDER}/${ACP_MODEL}`);

	let stderrTail = "";
	let resident: ChildProcess | null = null;
	let cap: TurnCapture | null = null;
	try {
		resident = spawn(
			"pi",
			[
				...REPO_EXTENSION_ARGS,
				"--session-id",
				gid,
				"--entwurf-control",
				"--provider",
				ACP_PROVIDER,
				"--model",
				ACP_MODEL,
				"--mode",
				"rpc",
			],
			{ cwd: tmp, stdio: ["pipe", "pipe", "pipe"], detached: false },
		);
		resident.stderr?.on("data", (b: Buffer) => {
			stderrTail = (stderrTail + b.toString()).slice(-4000);
		});

		// The resident stands its control socket up (turn-free citizenship — S1).
		const up = await waitForSocket(sockPath, BOOT_TIMEOUT_MS);
		ok(`ACP-model resident stood up a control socket (${ACP_PROVIDER}/${ACP_MODEL})`, up);

		// Citizen fact: get_info answers and reports the un-reverted ACP model (QM1).
		const info = await fetchControlSocketRuntimeInfo(sockPath, { timeout: 3_000 });
		ok(
			`get_info reports the ACP model, not reverted (got ${formatRuntimeModel(info) ?? "none"})`,
			info.modelProvider === ACP_PROVIDER && info.modelId === ACP_MODEL,
		);

		// Drive ONE model turn over the stdin RPC: call the BUNDLED bridge's entwurf_self.
		const prompt =
			"Call the mcp__entwurf-bridge__entwurf_self tool now. Then reply with exactly the " +
			"sessionId, agentId, and socketState values it returned, one per line, and nothing else. " +
			"Do not paraphrase or invent values — copy them verbatim from the tool result.";
		// The prompt must NOT leak the gid — the gid in the envelope is the proof the bridge
		// answered, so a gid in the prompt would make that proof circular (the model could echo
		// the prompt). Assert it at the source, not just by convention.
		ok("the prompt does not leak the resident gid (envelope-gid proof stays non-circular)", !prompt.includes(gid));
		cap = await driveSelfTurn(resident, prompt);

		// A real model turn ran AND completed over RPC — no hang (the whole point of the
		// resident circuit vs. the deferred `pi -p` one-shot teardown hang).
		ok("a real model turn ran over the stdin RPC (agent_start)", cap.agentStartSeen);
		ok("the turn completed cleanly over RPC (agent_end — no hang)", cap.agentEndSeen);
		ok("the prompt RPC command was accepted", cap.promptAccepted);

		// No extension blew up, the S0 fail-loud stub never fired (the provider path is real).
		ok("no extension_error during the turn", cap.extensionErrors.length === 0);
		ok("S0 fail-loud backend stub did NOT fire", !STUB_PATTERN.test(`${cap.stream}\n${stderrTail}`));

		// PRIMARY proof — narrow to the ENVELOPE lines, then assert the three identity
		// values appear TOGETHER inside them. Asserting against the whole stream is weak:
		// readline attaches before the prompt, so startup/buffered events could carry a
		// stray match. The envelope is the entwurf_self tool result (carried in the
		// [tool:done] notice and echoed in the assistant reply), so it is the lines bearing
		// the envelope markers — restrict the match to those.
		const envelopeText = cap.stream
			.split("\n")
			.filter((l) => /socketState|agentId|sessionId|entwurf_self/i.test(l))
			.join("\n");

		// The resident's OWN freshly-minted gid appears in the envelope. The gid is never
		// told to the model (asserted above); it lives only as PI_SESSION_ID inside the
		// bridge env. So its presence in the envelope proves entwurf_self was CALLED and its
		// operator-injected identity reached the model — the bundled bridge's last mile.
		ok(
			"the entwurf_self envelope carried the resident's own gid (bundled bridge reached the session)",
			envelopeText.includes(gid),
		);

		// socketState alive — entwurf_self computes this from the live --entwurf-control socket.
		ok("the envelope reported socketState alive", /socketState[\\":\s]*"?alive/i.test(envelopeText));

		// agentId is the ACP model identity, not reverted/blank.
		ok(
			`the envelope reported agentId ${ACP_PROVIDER}/${ACP_MODEL}`,
			envelopeText.includes(`${ACP_PROVIDER}/${ACP_MODEL}`),
		);

		// SUPPLEMENTARY (not a hard gate) — the ACP event mapper emits a tool notice when
		// showToolNotifications is on. S2g lets operator config turn notices OFF, in which
		// case the tool can succeed with no notice — so the envelope above is the real proof
		// and the notice is only corroborating. Log it; do not fail on its absence.
		const sawToolCall = /\[tool:(start|running|done)\][^\n]*entwurf_self/i.test(cap.stream);
		console.log(
			`  info  tool-call notice ${sawToolCall ? "observed" : "not observed (notices may be off; envelope is the proof)"}`,
		);

		// Still alive after the turn (a live socket-citizen, not a one-shot that exits).
		ok(
			"resident still alive after the turn (live socket-citizen)",
			resident.exitCode === null && resident.signalCode === null,
		);
	} catch (err) {
		if (cap)
			console.error(`[smoke-acp-bundled-mcp-live] stream tail:\n${cap.stream.split("\n").slice(-30).join("\n")}`);
		if (stderrTail)
			console.error(`[smoke-acp-bundled-mcp-live] stderr tail:\n${stderrTail.split("\n").slice(-20).join("\n")}`);
		throw err;
	} finally {
		if (resident) await terminateChild(resident);
	}

	// Hygiene: after teardown the control socket file is gone — no process/socket residue.
	// (The session JSONL is the denote-id memory layer and is intentionally NOT scrubbed.)
	ok("control socket file removed after teardown (no socket residue)", await waitForGone(sockPath, 5_000));

	console.log(
		`[smoke-acp-bundled-mcp-live] PASS — ${passed} checks (bundled entwurf-bridge reaches the live ACP session via the 0.11.0 resident/RPC circuit)`,
	);
}

await main();
