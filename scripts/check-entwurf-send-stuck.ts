/**
 * check-entwurf-send-stuck — reproduce gate for the 2026-05-18 top bug.
 *
 * Drives the entwurf-control unix-socket RPC against a live receiver pi
 * session and measures whether send messages reach the receiver (jsonl
 * persist) and what the wait surface returns (response / event / timeout /
 * close). Splits the matrix into the two layers the incident left
 * ambiguous: send handler reliability (Phase A) vs turn completion event
 * reliability (Phase B), and exposes the subscribe/send ordering variant
 * so a server-side race shows up against the back-to-back baseline.
 *
 * Receiver is launched by the operator (not this script) so we do not
 * burn provider API budget on automated spawn:
 *
 *   $ cd <some dir>
 *   $ pi --entwurf-control --provider pi-shell-acp --model claude-opus-4-7
 *
 * The receiver's sessionId appears in its status bar / get_info response.
 * Pass it via --target.
 *
 *   $ ./run.sh check-entwurf-stuck --target <sessionId>
 *
 * Default trial count is small (5) so a first pass does not blow real-API
 * budget. Push it up with --trials when you want statistical signal.
 * Phase B trials trigger an actual receiver turn each — that is the cost
 * driver. Phase A trials do not start a turn.
 *
 * No fix here. This script's job is to gather evidence so we know whether
 * commits 2beb213 (server-side handleCommand .catch) and d563743
 * (client-side close-before-response) are sufficient, or whether a
 * second root cause is still hiding behind them.
 *
 * Companion docs: NEXT.md §Top Bug → §Reproduce 방법.
 */

import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { argv, exit, stdout } from "node:process";

// ============================================================================
// Args
// ============================================================================

interface Args {
	target?: string;
	autoReceiver: boolean;
	autoReceiverProvider: string;
	autoReceiverModel: string;
	receiverBootTimeoutMs: number;
	trials: number;
	phase: "A" | "B" | "both";
	variant: "back-to-back" | "ack-first" | "both";
	turnEndTimeoutMs: number;
	messageProcessedTimeoutMs: number;
}

function parseArgs(): Args {
	const out: Partial<Args> = {
		autoReceiver: false,
		autoReceiverProvider: "openai-codex",
		autoReceiverModel: "gpt-5.4",
		receiverBootTimeoutMs: 30_000,
		trials: 5,
		phase: "both",
		variant: "back-to-back",
		turnEndTimeoutMs: 60_000,
		messageProcessedTimeoutMs: 5_000,
	};
	const rest = argv.slice(2);
	for (let i = 0; i < rest.length; i += 1) {
		const key = rest[i];
		const value = rest[i + 1];
		switch (key) {
			case "--target":
				out.target = value;
				i += 1;
				break;
			case "--auto-receiver":
				out.autoReceiver = true;
				break;
			case "--auto-receiver-provider":
				out.autoReceiverProvider = value;
				i += 1;
				break;
			case "--auto-receiver-model":
				out.autoReceiverModel = value;
				i += 1;
				break;
			case "--receiver-boot-timeout-ms":
				out.receiverBootTimeoutMs = Number.parseInt(value, 10);
				i += 1;
				break;
			case "--trials":
				out.trials = Number.parseInt(value, 10);
				i += 1;
				break;
			case "--phase":
				if (value !== "A" && value !== "B" && value !== "both") usage(`invalid --phase: ${value}`);
				out.phase = value;
				i += 1;
				break;
			case "--variant":
				if (value !== "back-to-back" && value !== "ack-first" && value !== "both") usage(`invalid --variant: ${value}`);
				out.variant = value;
				i += 1;
				break;
			case "--turn-end-timeout-ms":
				out.turnEndTimeoutMs = Number.parseInt(value, 10);
				i += 1;
				break;
			case "--message-processed-timeout-ms":
				out.messageProcessedTimeoutMs = Number.parseInt(value, 10);
				i += 1;
				break;
			case "-h":
			case "--help":
				usage();
				break;
			default:
				usage(`unknown arg: ${key}`);
		}
	}
	if (!out.target && !out.autoReceiver) usage("missing --target <sessionId> (or --auto-receiver)");
	if (out.target && out.autoReceiver) usage("--target and --auto-receiver are mutually exclusive");
	return out as Args;
}

function usage(error?: string): never {
	if (error) stdout.write(`error: ${error}\n\n`);
	stdout.write(
		`usage: check-entwurf-send-stuck [--target <sessionId> | --auto-receiver] [options]\n` +
			`\n` +
			`receiver selection (exactly one):\n` +
			`  --target <sessionId>                manual: operator has launched the receiver pi.\n` +
			`  --auto-receiver                     auto: tmux-spawn a fresh receiver loaded from\n` +
			`                                      the working-tree entwurf-control.ts, then tear\n` +
			`                                      it down on exit. Avoids the stale-installed-\n` +
			`                                      extension confusion that bit us today.\n` +
			`\n` +
			`auto-receiver knobs:\n` +
			`  --auto-receiver-provider <name>     default openai-codex\n` +
			`  --auto-receiver-model <id>          default gpt-5.4 (cheap; opus only when needed)\n` +
			`  --receiver-boot-timeout-ms <N>      default 30000\n` +
			`\n` +
			`trial matrix:\n` +
			`  --trials <N>                        trials per (phase × variant). default 5.\n` +
			`  --phase A | B | both                A=message_processed, B=turn_end. default both.\n` +
			`  --variant back-to-back | ack-first | both\n` +
			`                                      subscribe/send ordering for Phase B. default back-to-back.\n` +
			`  --message-processed-timeout-ms <N>  default 5000.\n` +
			`  --turn-end-timeout-ms <N>           default 60000 (shorter than prod 300000 for fast iteration).\n` +
			`\n` +
			`output: per-trial milestones + summary. exit 0 if every trial in every\n` +
			`phase/variant resolved successfully and persisted in receiver jsonl, else 1.\n`,
	);
	exit(error ? 2 : 0);
}

// ============================================================================
// RPC client — minimal reimplementation of sendRpcCommand for instrumentation
// ============================================================================

const ENTWURF_DIR = path.join(os.homedir(), ".pi", "entwurf-control");

interface RpcMilestones {
	startedAt: number;
	connectedAt?: number;
	subscribeAckAt?: number;
	sendAckAt?: number;
	turnEndAt?: number;
	settledAt?: number;
}

type TrialOutcome = "success" | "timeout" | "closed" | "error" | "response-not-success";

interface TrialResult {
	nonce: string;
	outcome: TrialOutcome;
	error?: string;
	milestones: RpcMilestones;
	persisted: boolean;
	persistCheckedAt?: number;
}

interface RpcOptions {
	waitForEvent?: "turn_end";
	timeoutMs: number;
	ackBeforeSend: boolean; // only meaningful when waitForEvent === "turn_end"
}

function rpcSend(socketPath: string, message: string, nonce: string, options: RpcOptions): Promise<TrialResult> {
	const trial: TrialResult = {
		nonce,
		outcome: "error",
		milestones: { startedAt: Date.now() },
		persisted: false,
	};

	return new Promise((resolve) => {
		const socket = net.createConnection(socketPath);
		socket.setEncoding("utf8");

		let buffer = "";
		let settled = false;
		let response: { success?: boolean; error?: string } | null = null;
		let baselineTurnIndex: number | undefined;
		let baselineResolved = false;

		const timeout = setTimeout(() => socket.destroy(new Error("timeout")), options.timeoutMs);

		const settle = (outcome: TrialOutcome, errMsg?: string) => {
			if (settled) return;
			settled = true;
			clearTimeout(timeout);
			socket.removeAllListeners();
			socket.destroy();
			trial.outcome = outcome;
			if (errMsg) trial.error = errMsg;
			trial.milestones.settledAt = Date.now();
			resolve(trial);
		};

		const writeSend = () => {
			const sendCmd = {
				type: "send",
				message,
				mode: "follow_up",
				sender: {
					sessionId: "stuck-smoke",
					agentId: "smoke/check-entwurf-send-stuck",
					cwd: process.cwd(),
					timestamp: new Date().toISOString(),
					origin: "external-mcp",
					replyable: false,
				},
				wants_reply: false,
			};
			socket.write(`${JSON.stringify(sendCmd)}\n`);
		};

		socket.on("connect", () => {
			trial.milestones.connectedAt = Date.now();
			if (options.waitForEvent === "turn_end") {
				const subscribeCmd = { type: "subscribe", event: "turn_end" };
				socket.write(`${JSON.stringify(subscribeCmd)}\n`);
				if (!options.ackBeforeSend) writeSend();
			} else {
				writeSend();
			}
		});

		socket.on("data", (chunk) => {
			buffer += chunk;
			let nl = buffer.indexOf("\n");
			while (nl !== -1) {
				const line = buffer.slice(0, nl).trim();
				buffer = buffer.slice(nl + 1);
				nl = buffer.indexOf("\n");
				if (!line) continue;
				try {
					const msg = JSON.parse(line);
					if (msg.type === "response") {
						if (msg.command === "subscribe" && !baselineResolved) {
							trial.milestones.subscribeAckAt = Date.now();
							const data = msg.data as { baselineTurnIndex?: number } | undefined;
							baselineTurnIndex = data?.baselineTurnIndex;
							baselineResolved = true;
							if (options.waitForEvent === "turn_end" && options.ackBeforeSend) writeSend();
							continue;
						}
						if (msg.command === "send") {
							trial.milestones.sendAckAt = Date.now();
							response = msg;
							if (msg.success === false) {
								settle("response-not-success", msg.error ?? "(no error message)");
								return;
							}
							if (options.waitForEvent !== "turn_end") {
								settle("success");
								return;
							}
						}
						continue;
					}
					if (msg.type === "event" && msg.event === "turn_end" && options.waitForEvent === "turn_end") {
						const evtTurnIndex = typeof msg.data?.turnIndex === "number" ? msg.data.turnIndex : undefined;
						if (
							baselineResolved &&
							typeof baselineTurnIndex === "number" &&
							typeof evtTurnIndex === "number" &&
							evtTurnIndex <= baselineTurnIndex
						) {
							continue;
						}
						trial.milestones.turnEndAt = Date.now();
						if (!response) {
							settle("error", "received turn_end before send response");
							return;
						}
						settle("success");
						return;
					}
				} catch {
					// keep waiting
				}
			}
		});

		socket.on("close", () => {
			if (settled) return;
			settle("closed", "connection closed before final outcome");
		});

		socket.on("error", (error) => {
			if (settled) return;
			const msg = error instanceof Error ? error.message : String(error);
			if (msg === "timeout") settle("timeout", "timed out waiting for response/event");
			else settle("error", msg);
		});
	});
}

// ============================================================================
// jsonl persist verification
// ============================================================================

function findReceiverJsonl(target: string): string | null {
	const sessionsRoot = path.join(os.homedir(), ".pi", "agent", "sessions");
	if (!fs.existsSync(sessionsRoot)) return null;
	const dirs = fs.readdirSync(sessionsRoot);
	for (const dir of dirs) {
		const dirPath = path.join(sessionsRoot, dir);
		let entries: string[];
		try {
			entries = fs.readdirSync(dirPath);
		} catch {
			continue;
		}
		for (const entry of entries) {
			if (entry.endsWith(`_${target}.jsonl`)) return path.join(dirPath, entry);
		}
	}
	return null;
}

function jsonlContainsNonce(jsonlPath: string, nonce: string): boolean {
	const result = spawnSync("grep", ["-l", `stuck-smoke nonce=${nonce}`, jsonlPath], {
		stdio: ["ignore", "pipe", "ignore"],
	});
	return result.status === 0;
}

// ============================================================================
// Auto-receiver — tmux-spawn a fresh pi loaded from working-tree extension
// ============================================================================

const REPO_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const ENTWURF_CONTROL_TS = path.join(REPO_ROOT, "pi-extensions", "entwurf-control.ts");

interface SpawnedReceiver {
	sessionId: string;
	tmuxSession: string;
	socketPath: string;
}

function listExistingSockets(): Set<string> {
	const out = new Set<string>();
	if (!fs.existsSync(ENTWURF_DIR)) return out;
	for (const entry of fs.readdirSync(ENTWURF_DIR)) {
		if (entry.endsWith(".sock")) out.add(entry);
	}
	return out;
}

function killTmuxSession(name: string): void {
	spawnSync("tmux", ["kill-session", "-t", name], { stdio: "ignore" });
}

async function spawnAutoReceiver(args: Args): Promise<SpawnedReceiver> {
	if (!fs.existsSync(ENTWURF_CONTROL_TS)) {
		throw new Error(`working-tree entwurf-control.ts not found at ${ENTWURF_CONTROL_TS}`);
	}
	const tmuxCheck = spawnSync("tmux", ["-V"], { stdio: "ignore" });
	if (tmuxCheck.status !== 0) throw new Error("tmux not found on PATH — required for --auto-receiver");

	const baseline = listExistingSockets();
	const tmuxSession = `stuck-smoke-${crypto.randomUUID().slice(0, 8)}`;
	// Spawn the receiver from os.tmpdir() with --no-context-files /
	// --no-skills / --no-extensions so the first prompt does not pull in
	// the host repo's AGENTS.md, skills, or other extensions as context.
	// Without this the receiver burned ~$0.04 per Phase-B trial reading
	// pi-shell-acp's AGENTS — fine for one-off runs, ruinous for the
	// 100-trial baselines we want from this gate. -e still loads our
	// working-tree entwurf-control.ts so the actual code under test is
	// fresh, not the globally-installed extension.
	const tmpReceiverCwd = fs.mkdtempSync(path.join(os.tmpdir(), "stuck-smoke-receiver-"));
	const piCmd = [
		"cd",
		tmpReceiverCwd,
		"&&",
		"pi",
		"--no-context-files",
		"--no-skills",
		"--no-extensions",
		"-e",
		ENTWURF_CONTROL_TS,
		"--entwurf-control",
		"--provider",
		args.autoReceiverProvider,
		"--model",
		args.autoReceiverModel,
	].join(" ");

	stdout.write(
		`[stuck-smoke] auto-receiver: spawning in tmux session ${tmuxSession}\n` +
			`              cwd: ${tmpReceiverCwd}\n` +
			`              cmd: ${piCmd}\n` +
			`              extension: ${ENTWURF_CONTROL_TS}\n`,
	);

	const spawnResult = spawnSync("tmux", ["new", "-d", "-s", tmuxSession, piCmd], {
		stdio: ["ignore", "pipe", "pipe"],
	});
	if (spawnResult.status !== 0) {
		const stderr = spawnResult.stderr?.toString() ?? "(no stderr)";
		throw new Error(`tmux new failed (exit ${spawnResult.status}): ${stderr}`);
	}

	const deadline = Date.now() + args.receiverBootTimeoutMs;
	let newSessionId: string | null = null;
	while (Date.now() < deadline) {
		await new Promise((r) => setTimeout(r, 500));
		const current = listExistingSockets();
		for (const entry of current) {
			if (!baseline.has(entry)) {
				newSessionId = entry.replace(/\.sock$/, "");
				break;
			}
		}
		if (newSessionId) break;
	}
	if (!newSessionId) {
		killTmuxSession(tmuxSession);
		throw new Error(`no new entwurf-control socket appeared within ${args.receiverBootTimeoutMs}ms`);
	}

	const socketPath = path.join(ENTWURF_DIR, `${newSessionId}.sock`);
	// Wait until the receiver responds with idle:true — the pi process can
	// register its socket before the bridge/model handshake settles, and
	// hammering it during that window produces false-positive failures.
	const idleDeadline = Date.now() + args.receiverBootTimeoutMs;
	let idle = false;
	while (Date.now() < idleDeadline) {
		const info = await getReceiverInfo(socketPath);
		if (info?.idle === true) {
			idle = true;
			break;
		}
		await new Promise((r) => setTimeout(r, 500));
	}
	if (!idle) {
		killTmuxSession(tmuxSession);
		throw new Error(`receiver socket appeared but never reported idle within ${args.receiverBootTimeoutMs}ms`);
	}

	stdout.write(`[stuck-smoke] auto-receiver: sessionId=${newSessionId} ready (idle)\n`);
	return { sessionId: newSessionId, tmuxSession, socketPath };
}

// ============================================================================
// Pre-flight — receiver alive and idle
// ============================================================================

interface ReceiverInfo {
	sessionId: string;
	cwd?: string;
	model?: { id?: string; provider?: string };
	idle?: boolean;
}

function getReceiverInfo(socketPath: string): Promise<ReceiverInfo | null> {
	return new Promise((resolve) => {
		const socket = net.createConnection(socketPath);
		socket.setEncoding("utf8");
		let buffer = "";
		const timeout = setTimeout(() => {
			socket.destroy();
			resolve(null);
		}, 2000);
		socket.on("connect", () => {
			socket.write(`${JSON.stringify({ type: "get_info" })}\n`);
		});
		socket.on("data", (chunk) => {
			buffer += chunk;
			const nl = buffer.indexOf("\n");
			if (nl === -1) return;
			const line = buffer.slice(0, nl).trim();
			try {
				const msg = JSON.parse(line);
				if (msg.type === "response" && msg.command === "get_info" && msg.success) {
					clearTimeout(timeout);
					socket.destroy();
					resolve(msg.data as ReceiverInfo);
					return;
				}
			} catch {
				// ignore
			}
		});
		socket.on("error", () => {
			clearTimeout(timeout);
			resolve(null);
		});
	});
}

// ============================================================================
// Phase runners
// ============================================================================

interface PhaseSummary {
	phase: "A" | "B";
	variant: "back-to-back" | "ack-first";
	trials: TrialResult[];
}

async function runTrial(
	socketPath: string,
	sessionId: string,
	phase: "A" | "B",
	variant: "back-to-back" | "ack-first",
	idx: number,
	total: number,
	args: Args,
): Promise<TrialResult> {
	const nonce = crypto.randomUUID().slice(0, 8);
	const message = `[stuck-smoke nonce=${nonce}] phase=${phase} variant=${variant} trial=${idx + 1}/${total}`;
	const opts: RpcOptions =
		phase === "A"
			? { timeoutMs: args.messageProcessedTimeoutMs, ackBeforeSend: false }
			: {
					waitForEvent: "turn_end",
					timeoutMs: args.turnEndTimeoutMs,
					ackBeforeSend: variant === "ack-first",
				};
	const trial = await rpcSend(socketPath, message, nonce, opts);

	// Persist check — best-effort. Re-resolve the jsonl path every trial:
	// auto-receiver does not create the session jsonl until the first
	// message arrives, so a path captured before run start is permanently
	// null and persist verification becomes a false RED. Brief sleep gives
	// the receiver time to flush before grep.
	await new Promise((r) => setTimeout(r, 200));
	const jsonlPath = findReceiverJsonl(sessionId);
	if (jsonlPath && fs.existsSync(jsonlPath)) {
		trial.persisted = jsonlContainsNonce(jsonlPath, nonce);
		trial.persistCheckedAt = Date.now();
	}

	return trial;
}

function renderMilestones(m: RpcMilestones): string {
	const dt = (after?: number, before = m.startedAt) =>
		after !== undefined ? `${(after - before).toString().padStart(5, " ")}ms` : "  -  ";
	return [
		`connect=${dt(m.connectedAt)}`,
		`subAck=${dt(m.subscribeAckAt)}`,
		`sendAck=${dt(m.sendAckAt)}`,
		`turnEnd=${dt(m.turnEndAt)}`,
		`settled=${dt(m.settledAt)}`,
	].join(" ");
}

function renderTrial(t: TrialResult, idx: number, total: number): string {
	const status = t.outcome.padEnd(20, " ");
	const persist = t.persisted ? "✅" : "❌";
	const err = t.error ? `  err=${t.error.slice(0, 80)}` : "";
	return `  trial ${idx + 1}/${total}  ${status}  persist=${persist}  ${renderMilestones(t.milestones)}${err}`;
}

async function runPhase(
	socketPath: string,
	sessionId: string,
	phase: "A" | "B",
	variant: "back-to-back" | "ack-first",
	args: Args,
): Promise<PhaseSummary> {
	const label = phase === "A" ? "Phase A — message_processed" : `Phase B — turn_end (${variant})`;
	stdout.write(`\n[stuck-smoke] ${label} × ${args.trials}\n`);
	const trials: TrialResult[] = [];
	for (let i = 0; i < args.trials; i += 1) {
		const trial = await runTrial(socketPath, sessionId, phase, variant, i, args.trials, args);
		stdout.write(`${renderTrial(trial, i, args.trials)}\n`);
		trials.push(trial);
	}
	return { phase, variant, trials };
}

// ============================================================================
// Summary
// ============================================================================

function summarize(summaries: PhaseSummary[]): boolean {
	stdout.write(`\n[stuck-smoke] ─── summary ───\n`);
	let allGreen = true;
	for (const s of summaries) {
		const label = s.phase === "A" ? "A msg_proc      " : `B turn_end ${s.variant.padEnd(13, " ")}`;
		const total = s.trials.length;
		const success = s.trials.filter((t) => t.outcome === "success").length;
		const persisted = s.trials.filter((t) => t.persisted).length;
		const timeouts = s.trials.filter((t) => t.outcome === "timeout").length;
		const closes = s.trials.filter((t) => t.outcome === "closed").length;
		const errors = s.trials.filter((t) => t.outcome === "error" || t.outcome === "response-not-success").length;
		stdout.write(
			`  ${label}  success=${success}/${total}  persist=${persisted}/${total}  ` +
				`timeout=${timeouts}  close=${closes}  error=${errors}\n`,
		);
		if (success !== total || persisted !== total) allGreen = false;
	}
	stdout.write(`\n[stuck-smoke] verdict: ${allGreen ? "GREEN — no stuck observed" : "RED — see per-trial details"}\n`);
	return allGreen;
}

// ============================================================================
// Main
// ============================================================================

async function main(): Promise<void> {
	const args = parseArgs();

	let target: string;
	let spawned: SpawnedReceiver | null = null;

	if (args.autoReceiver) {
		spawned = await spawnAutoReceiver(args);
		target = spawned.sessionId;
		// Ensure the tmux receiver is killed on every termination path: clean
		// exit, fatal throw, ctrl+C, parent SIGTERM. Without this we leak pi
		// processes that hold sockets and confuse subsequent runs.
		const cleanup = () => {
			if (spawned) {
				killTmuxSession(spawned.tmuxSession);
				stdout.write(`[stuck-smoke] auto-receiver: tmux session ${spawned.tmuxSession} killed\n`);
				spawned = null;
			}
		};
		process.on("exit", cleanup);
		process.on("SIGINT", () => {
			cleanup();
			exit(130);
		});
		process.on("SIGTERM", () => {
			cleanup();
			exit(143);
		});
	} else {
		target = args.target as string;
	}

	const socketPath = path.join(ENTWURF_DIR, `${target}.sock`);
	if (!fs.existsSync(socketPath)) {
		stdout.write(`error: socket not found at ${socketPath}\n`);
		stdout.write(`hint: is the receiver running with --entwurf-control?\n`);
		exit(2);
	}

	const info = await getReceiverInfo(socketPath);
	if (!info) {
		stdout.write(`error: receiver not responding on ${socketPath}\n`);
		exit(2);
	}
	if (info.idle === false) {
		stdout.write(
			`warning: receiver reports idle=false; trials run against a busy receiver may not exercise the\n` +
				`         follow_up + idle direct-promote path the incident reproduces from.\n`,
		);
	}
	// jsonl path is re-resolved every trial inside runTrial — auto-receiver
	// does not create the jsonl until the first message arrives, so a path
	// captured here would be permanently null for the first run.
	stdout.write(
		`[stuck-smoke] target sessionId=${target}\n` +
			`              cwd=${info.cwd ?? "(unknown)"}\n` +
			`              model=${info.model?.provider ?? "?"}/${info.model?.id ?? "?"}\n` +
			`              idle=${info.idle === true ? "yes" : info.idle === false ? "NO" : "?"}\n` +
			`              trials=${args.trials} phase=${args.phase} variant=${args.variant}\n` +
			`              timeouts: msg_proc=${args.messageProcessedTimeoutMs}ms turn_end=${args.turnEndTimeoutMs}ms\n`,
	);

	const summaries: PhaseSummary[] = [];

	if (args.phase === "A" || args.phase === "both") {
		summaries.push(await runPhase(socketPath, target, "A", "back-to-back", args));
	}

	if (args.phase === "B" || args.phase === "both") {
		const variants: ("back-to-back" | "ack-first")[] =
			args.variant === "both" ? ["back-to-back", "ack-first"] : [args.variant];
		for (const v of variants) {
			summaries.push(await runPhase(socketPath, target, "B", v, args));
		}
	}

	const ok = summarize(summaries);
	exit(ok ? 0 : 1);
}

main().catch((err) => {
	stdout.write(`fatal: ${err instanceof Error ? err.message : String(err)}\n`);
	exit(1);
});
