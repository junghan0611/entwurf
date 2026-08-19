#!/usr/bin/env node
// probe-bridge-command — does the EFFECTIVE bridge command actually BOOT and serve MCP?
//
// WHY THIS EXISTS (#81): every doctor that judged the bridge wiring asked only whether the
// configured command RESOLVES — `command -v <bare name>` for pi (doctor-pi-provider) and agy
// (agy-bridge.sh). Resolvability is not bootability, and the gap is not theoretical: on the
// reference host `~/.local/bin/entwurf-bridge` was a symlink to the canonical pnpm shim, and
// that shim derives its target from `$0`. Invoked through the relocated link the derived
// `../global/...` path does not exist, so the launcher exits 127 and the MCP child never boots
// — while `command -v` kept answering yes and both doctors kept printing ok. The model in a
// Pi-hosted ACP turn then had no `mcp__entwurf-bridge__*` tool at all, which is a direct
// violation of #81's minimum core value (explicit Entwurf bridge connectivity).
//
// So this leaf asks the only question that carries the claim: run the command, speak MCP to it,
// and require the entwurf tool surface back. A green here is about the command the harness
// actually execs — never a recomputed desired one (the same rule meta-bridge-doctor's delivery
// self-diagnostic already states for the Claude lane).
//
// SIDE EFFECTS: none on operator state. Only `initialize` + `tools/list` are sent — never a
// `tools/call` — so no lock is taken, no record is written, and no message is delivered. The
// child is killed as soon as the frame arrives or the deadline passes. This is what makes the
// probe affordable inside a doctor an operator runs repeatedly.
//
// USAGE
//   library:  const r = await probeBridgeCommand({ command, args });   // doctor-pi-provider.ts
//   CLI:      node probe-bridge-command.ts <command> [args...]
//             node probe-bridge-command.ts --invocation-json '{"command":"…","args":[],"env":{}}'
//             exit 0 = booted and served the entwurf tool surface; 1 = did not (reason on stdout).
import { spawn } from "node:child_process";
import { basename } from "node:path";

/** Why a probe failed. Each value is a DISTINCT operator situation, never a generic "broken". */
export type BridgeProbeReason =
	| "ok"
	| "spawn-failed" // the command could not be executed at all (ENOENT / EACCES)
	| "exited-before-tools-list" // it ran and DIED — the relocated-shim 127 class lands here
	| "initialize-failed" // it did not complete the MCP initialize handshake before tools/list
	| "timeout" // it stayed up but never answered — a hung/wrong binary
	| "no-tools-array" // it answered id:2 without result.tools — not an MCP server
	| "tool-set-mismatch"; // an MCP server, but not THIS bridge (foreign binary, or a stale build)

export interface BridgeProbeResult {
	ok: boolean;
	reason: BridgeProbeReason;
	/** One line, safe to print in a doctor verdict. Carries rc/signal/stderr head when relevant. */
	detail: string;
}

export interface BridgeProbeOptions {
	command: string;
	args?: string[];
	env?: NodeJS.ProcessEnv;
	timeoutMs?: number;
}

// The EXACT public verb set of the current bridge. Identity is the whole set, not one member:
// the #81 symptom was a session whose schema lacked `entwurf_self` specifically, and a probe that
// only looked for `entwurf_v2` would have called that host healthy. Exactness also catches the
// other direction — a STALE build still serving a retired verb, or a foreign binary that happens
// to expose an `entwurf_v2`. check-entwurf-bridge-boot binds this list to the real runtime
// tools/list, so a verb added or retired without updating it turns that gate red.
export const EXPECTED_TOOLS = [
	"entwurf_v2",
	"entwurf_self",
	"entwurf_peers",
	"entwurf_inbox_read",
	"entwurf_register_native",
	"entwurf_fresh_call",
	"entwurf_resume_call",
] as const;
const DEFAULT_TIMEOUT_MS = 10_000;
/** How long a probed child gets to die politely before it is killed outright. */
const CLEANUP_GRACE_MS = 500;

/** Collapse captured stderr into one printable line — a doctor verdict must stay one line. */
function head(text: string, limit = 200): string {
	const flat = text.replace(/\s+/g, " ").trim();
	return flat.length > limit ? `${flat.slice(0, limit)}…` : flat;
}

export function probeBridgeCommand(opts: BridgeProbeOptions): Promise<BridgeProbeResult> {
	const { command, args = [], env, timeoutMs = DEFAULT_TIMEOUT_MS } = opts;
	return new Promise((resolve) => {
		// No shell: a bare name goes through the normal PATH lookup the harness itself does,
		// and an argument can never be reinterpreted as shell syntax.
		const child = spawn(command, args, { stdio: ["pipe", "pipe", "pipe"], env });
		// `write()` reports a synchronous closed pipe by throwing, but a launcher can also exit
		// between write scheduling and completion. Its asynchronous EPIPE belongs to the close
		// verdict (with captured stderr), never to an unhandled probe crash.
		child.stdin.on("error", () => {});
		let stdoutPending = "";
		let stderr = "";
		let settled = false;
		let initialized = false;
		let exited: { code: number | null; signal: NodeJS.Signals | null } | undefined;
		let stderrEnded = false;

		// This probe deliberately runs whatever command the operator configured — including a
		// foreign or broken one — so it owns closing what it opened. Escalate SIGTERM → SIGKILL
		// once, bounded: cleanup for THIS child, not a supervisor (no retries, no watching, no
		// process-tree walking).
		//
		// The reap is AWAITED before the result resolves, and that ordering is load-bearing: the
		// callers are doctors that print a verdict and `process.exit()` immediately, which tears
		// down any still-pending timer. A fire-and-forget SIGTERM plus a deferred SIGKILL would
		// therefore leave a TERM-ignoring launcher running after the doctor is gone — the probe
		// would leak exactly the kind of broken process it exists to detect.
		const reap = (): Promise<void> =>
			new Promise((finished) => {
				if (child.exitCode !== null || child.signalCode !== null) return finished();
				let reaped = false;
				let hard: ReturnType<typeof setTimeout> | undefined;
				const finish = (): void => {
					if (reaped) return;
					reaped = true;
					if (hard) clearTimeout(hard);
					finished();
				};
				child.once("close", finish);
				try {
					child.kill("SIGTERM");
				} catch {
					return finish(); // already gone
				}
				hard = setTimeout(() => {
					try {
						child.kill("SIGKILL");
					} catch {}
					// SIGKILL cannot be trapped, so `close` follows. The outer bound exists only so a
					// child already reaped by someone else can never hang this promise forever.
					setTimeout(finish, CLEANUP_GRACE_MS);
				}, CLEANUP_GRACE_MS);
			});

		const done = (reason: BridgeProbeReason, detail: string): void => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			void reap().then(() => resolve({ ok: reason === "ok", reason, detail }));
		};

		const timer = setTimeout(() => {
			const waitingFor = initialized ? "tools/list" : "initialize";
			done(
				"timeout",
				`'${command}' stayed up but never answered ${waitingFor} within ${timeoutMs}ms` +
					(stderr.trim() ? ` — stderr: ${head(stderr)}` : ""),
			);
		}, timeoutMs);

		child.on("error", (err) => {
			done("spawn-failed", `'${command}' could not be executed: ${String(err)}`);
		});

		// `ChildProcess` close is normally after the stdio pipes close, but under nested shell
		// capture that ordering has raced on this host. Do not mint a no-stderr diagnosis until the
		// stderr reader ended: the launcher's own final diagnostic is part of the operator verdict.
		const reportExited = (): void => {
			if (!exited || !stderrEnded) return;
			// Reaching here un-settled means the process died before answering id:2. This is the
			// cell the relocated pnpm shim lands in (exit 127), and the stderr head is what tells
			// the operator WHICH launcher hop broke.
			done(
				"exited-before-tools-list",
				`'${command}' exited before answering tools/list (code=${exited.code} signal=${String(exited.signal)})` +
					(stderr.trim() ? ` — stderr: ${head(stderr)}` : " — no stderr"),
			);
		};
		child.on("close", (code, signal) => {
			exited = { code, signal };
			reportExited();
		});

		child.stderr.on("data", (d) => {
			stderr += String(d);
		});
		child.stderr.on("end", () => {
			stderrEnded = true;
			reportExited();
		});
		child.stdout.on("data", (d) => {
			const chunk = String(d);
			stdoutPending += chunk;
			if (settled) return;
			// MCP frames are newline-delimited JSON-RPC. Consume each complete frame exactly once:
			// replaying the accumulated id:1 response on a later data event would send a second
			// tools/list before the first reply and stop being a sequential handshake.
			const frames = stdoutPending.split("\n");
			stdoutPending = frames.pop() ?? "";
			for (const line of frames) {
				const trimmed = line.trim();
				if (!trimmed) continue;
				let msg: {
					id?: unknown;
					error?: unknown;
					result?: { protocolVersion?: unknown; capabilities?: unknown; serverInfo?: unknown; tools?: unknown };
				};
				try {
					msg = JSON.parse(trimmed);
				} catch {
					continue;
				}
				if (msg?.id === 1) {
					const result = msg.result;
					const valid =
						msg.error === undefined &&
						result?.protocolVersion === "2024-11-05" &&
						typeof result.capabilities === "object" &&
						result.capabilities !== null &&
						typeof result.serverInfo === "object" &&
						result.serverInfo !== null;
					if (!valid) {
						done("initialize-failed", `'${command}' returned an invalid MCP initialize response`);
						return;
					}
					initialized = true;
					sendReadyFrames();
					continue;
				}
				if (msg?.id !== 2) continue;
				if (!initialized) {
					done("initialize-failed", `'${command}' answered tools/list before MCP initialize completed`);
					return;
				}
				const tools = msg?.result?.tools;
				if (!Array.isArray(tools)) {
					done("no-tools-array", `'${command}' answered tools/list without result.tools — not an MCP server`);
					return;
				}
				const names = tools
					.map((t) => (t as { name?: unknown })?.name)
					.filter((n): n is string => typeof n === "string");
				const served = new Set(names);
				const missing = EXPECTED_TOOLS.filter((t) => !served.has(t));
				const unexpected = names.filter((n) => !(EXPECTED_TOOLS as readonly string[]).includes(n));
				if (missing.length > 0 || unexpected.length > 0) {
					// Name BOTH directions: a missing verb is the #81 symptom (the model had no
					// entwurf_self), an unexpected one means this is not the bridge we ship.
					const parts: string[] = [];
					if (missing.length > 0) parts.push(`missing ${missing.join(", ")}`);
					if (unexpected.length > 0) parts.push(`unexpected ${unexpected.join(", ")}`);
					done(
						"tool-set-mismatch",
						`'${command}' is an MCP server but does not serve this bridge's verb set — ${parts.join("; ")} (served: ${names.join(", ") || "none"})`,
					);
					return;
				}
				done("ok", `'${command}' booted and served the exact entwurf verb set (${EXPECTED_TOOLS.length} tools)`);
				return;
			}
		});

		const send = (obj: unknown): void => {
			try {
				child.stdin.write(`${JSON.stringify(obj)}\n`);
			} catch {
				// A launcher that died on exec closes stdin under us; the `close` handler owns
				// that verdict, so swallowing the EPIPE here keeps ONE reason per failure.
			}
		};
		const sendReadyFrames = (): void => {
			send({ jsonrpc: "2.0", method: "notifications/initialized" });
			send({ jsonrpc: "2.0", id: 2, method: "tools/list" });
		};
		send({
			jsonrpc: "2.0",
			id: 1,
			method: "initialize",
			params: {
				protocolVersion: "2024-11-05",
				capabilities: {},
				clientInfo: { name: "probe-bridge-command", version: "0" },
			},
		});
	});
}

// CLI entrypoint. Kept argv-driven (no env carrier) so `./run.sh probe-bridge-command entwurf-bridge`
// asks about exactly the name an operator typed, and a doctor can shell out to the same verdict.
// Match the BASENAME exactly. A suffix test would also fire for `check-probe-bridge-command.ts`,
// which imports this module — the CLI arm would then hijack that gate's argv and exit 2.
if (process.argv[1] && /^probe-bridge-command\.(ts|js)$/.test(basename(process.argv[1]))) {
	const argv = process.argv.slice(2);
	let options: BridgeProbeOptions;
	if (argv[0] === "--invocation-json") {
		let raw: unknown;
		try {
			raw = JSON.parse(argv[1] ?? "");
		} catch {
			console.error("probe-bridge-command: --invocation-json must be valid JSON");
			process.exit(2);
		}
		const obj = raw as { command?: unknown; args?: unknown; env?: unknown };
		if (
			typeof obj?.command !== "string" ||
			!obj.command ||
			!Array.isArray(obj.args) ||
			!obj.args.every((arg) => typeof arg === "string") ||
			typeof obj.env !== "object" ||
			obj.env === null ||
			Array.isArray(obj.env) ||
			!Object.values(obj.env).every((value) => typeof value === "string")
		) {
			console.error("probe-bridge-command: invocation JSON requires string command, string[] args, string-map env");
			process.exit(2);
		}
		options = {
			command: obj.command,
			args: obj.args as string[],
			env: { ...process.env, ...(obj.env as Record<string, string>) },
		};
	} else {
		const [command, ...args] = argv;
		if (!command) {
			console.error("usage: probe-bridge-command <command> [args...]");
			process.exit(2);
		}
		options = { command, args };
	}
	const result = await probeBridgeCommand(options);
	console.log(`[probe-bridge-command] ${result.reason}: ${result.detail}`);
	process.exit(result.ok ? 0 : 1);
}
