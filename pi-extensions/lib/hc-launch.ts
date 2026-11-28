/**
 * hc-launch — reopen ONE dormant citizen in a new Herdr Core (hc) terminal, from inside an hc terminal
 * (#178). The hc half of the same-id visible resume, and only its LAUNCH.
 *
 * WHAT THIS IS. The v2 composition (`entwurf-v2-visible-resume.ts`) owns everything that makes a
 * resume a resume: the record, the per-gid lock, the dormancy proof and the same-id observation. It
 * reaches this module through the injected launch seam, exactly as it reaches the tmux and herdr
 * leaves; which of them runs is chosen by the shared rail root (`dispatchResumeLaunch`), not here. So
 * this file never sees a garden id, never reads a record and never decides whether a citizen is back.
 *
 * RESUME ONLY. A fresh call into hc is outside #178: nothing here mints a nonce or carries a callback.
 *
 * ONE CONNECTION PER REQUEST, ON ONE NAMED SOCKET. The endpoint is `HC_TERMINAL_SOCKET`, the variable
 * the core sets on every program it starts (`[HC api/run.rs:212-225 @ v0.1.20]`). It is an inherited
 * coordinate HINT: what admits it is the read below, in which the core that answers on that socket
 * reports the caller's own terminal as live. This module never runs the `hc` CLI, because every CLI
 * call except `server stop` may START a core (`[HC client.rs:77-123]`), and never calls a typing
 * method (`terminal.send | keys | put | interrupt`) or `terminal.kill`.
 *
 * ORDER IS THE SAFETY ARGUMENT. Everything decidable without the core — context, backend, cwd, the
 * runtime and the argv — is decided first. Then two requests that create nothing (`hello`, pinned to
 * generation 1, and `terminal.get` of the caller's own terminal). Then the ONE write, `terminal.run`,
 * never resent. Every failure after that write carries a recovery that says what may be out there.
 *
 * A SIBLING IS NOBODY'S CHILD. Every launch sends `no_parent: true` and `no_notify: true`: by default
 * the calling terminal becomes the parent and a parented program is killed when its parent's program
 * ends (`[HC api/run.rs:121-132, :149]`; `[측정 2026-11-28 ops b]` `killed signal=1`), and notes about
 * it are typed into the parent. `keep` stays false: a kept terminal comes back after a core restart
 * as a shell carrying the launch env, which is not the citizen.
 *
 * THE ENV MAP IS FIXED AND CODE-OWNED. The program gets the core's start environment plus the
 * request's `env`, merged by key; a key can be set, never deleted. So the identity carriers Entwurf
 * and its rails read are set EMPTY (every reader treats `""` as absent): a core started from a pi,
 * herdr or tmux seat must not hand that seat's identity or anchor to a reopened citizen. The core
 * does not echo this map back (`restart_env` is private, `[HC terminals.rs:409-423]`), so the echo
 * check below cannot and does not claim it.
 *
 * WHAT THE RECEIPT IS NOT. A successful `terminal.run` is a LAUNCH: the core created a terminal and
 * started that argv in it. The terminal address, the name and the pid are a VIEW — never a garden
 * id, liveness or a delivery coordinate. Where an App shows the terminal is the App's business; this
 * module claims no "beside", "focused" or "tab".
 *
 * NO KILL AUTHORITY. `terminal.kill` takes only an address and no expected token, so this rail closes
 * nothing it opened. An echo that drifts is reported with its coordinates and left as it is.
 */

import { randomBytes } from "node:crypto";
import { accessSync, constants as fsConstants, statSync } from "node:fs";
import { createConnection } from "node:net";
import path from "node:path";
import {
	checkPiDurableRuntime,
	type PiDurablePackageLayout,
	type PiDurableRuntimeRejectReason,
	piDurablePackageLayout,
} from "./pi-durable-runtime.ts";

/** The protocol generation this rail was read and measured against (`[HC api.rs:15 @ v0.1.20]`). */
export const HC_GENERATION = 1;

/** The three backends with a same-id resume, and what each one's terminal runs first. `pi-durable` is
 * absent on purpose: it reopens through this package's own managed launcher, never a PATH name. */
export const HC_RESUME_RUNTIME = { pi: "pi", "claude-code": "claude" } as const;

/** Identity and anchor carriers a core's start environment may hold, set EMPTY on every launch. */
export const HC_SCRUBBED_ENV: Readonly<Record<string, string>> = Object.freeze({
	PI_SESSION_ID: "",
	PI_AGENT_ID: "",
	HERDR_ENV: "",
	HERDR_PANE_ID: "",
	HERDR_SOCKET_PATH: "",
	HERDR_BIN_PATH: "",
	TMUX: "",
	TMUX_PANE: "",
});

/** The pi-durable adopt launch projection, read by name: the same five names the other rails emit. */
export interface HcPiDurableAdoptEnv {
	readonly PI_CODING_AGENT_DIR: string;
	readonly ENTWURF_META_SESSIONS_DIR: string;
	readonly ENTWURF_META_MAILBOX_DIR: string;
	readonly ENTWURF_META_SENDERS_DIR: string;
	readonly ENTWURF_META_RECEIVERS_DIR: string;
}

// ── context ────────────────────────────────────────────────────────────────────────────────────

/** An hc terminal address on THIS core: `t7`, `t1b`. A `machine/t7` form is another core's terminal
 * and is not a caller this rail can read on its own socket. */
const HC_LOCAL_ADDRESS = /^t[0-9]+[a-z0-9]*$/;

/** Does this process carry an hc marker at all? Either variable, non-empty: a half-present pair
 * selects this rail and is then refused by name, never handed to another rail. */
export function hasHcMarker(env: NodeJS.ProcessEnv): boolean {
	return (env.HC_TERMINAL_ID ?? "") !== "" || (env.HC_TERMINAL_SOCKET ?? "") !== "";
}

export interface HcContext {
	readonly callerTerminal: string;
	readonly socketPath: string;
}

export function resolveHcContext(
	env: NodeJS.ProcessEnv,
): { ok: true; context: HcContext } | { ok: false; reason: "hc-context-missing" } {
	const callerTerminal = env.HC_TERMINAL_ID ?? "";
	const socketPath = env.HC_TERMINAL_SOCKET ?? "";
	if (!HC_LOCAL_ADDRESS.test(callerTerminal) || !path.isAbsolute(socketPath) || socketPath.includes("\0")) {
		return { ok: false, reason: "hc-context-missing" };
	}
	return { ok: true, context: { callerTerminal, socketPath } };
}

// ── transport ──────────────────────────────────────────────────────────────────────────────────

/** What one request on the socket came back as. `connect-failed` is the ONLY outcome in which the
 * request line was certainly never written. */
export type HcSocketOutcome =
	| { readonly kind: "connect-failed"; readonly code: string }
	| { readonly kind: "reply"; readonly line: string }
	| { readonly kind: "io-failed"; readonly code: string }
	| { readonly kind: "timeout" }
	| { readonly kind: "oversize" }
	| { readonly kind: "eof-before-newline" };

/** One request, one connection, one reply line. No retry, no reconnect, no resend, no autostart. */
export type HcSocketCall = (requestLine: string, timeoutMs: number) => Promise<HcSocketOutcome>;

/** Reads are bounded short; the write must outlast the core's own 10 s spawn wait
 * (`[HC api/run.rs:181]`), or a slow start would be reported as unknown while the core still answers. */
export const HC_READ_TIMEOUT_MS = 5_000;
export const HC_RUN_TIMEOUT_MS = 30_000;
export const HC_MAX_REPLY_BYTES = 1024 * 1024;

/**
 * The production client: a plain connect to an existing unix socket. A core that is not listening is
 * a connect failure and stays one — nothing here starts a core. The reply is collected as bytes and
 * decoded once, after its newline. Exactly one settle.
 */
export function createHcSocketCall(socketPath: string, maxReplyBytes: number = HC_MAX_REPLY_BYTES): HcSocketCall {
	return (requestLine, timeoutMs) =>
		new Promise((resolve) => {
			let settled = false;
			let connected = false;
			let lineBytes = 0;
			const chunks: Buffer[] = [];
			const socket = createConnection({ path: socketPath });
			const settle = (outcome: HcSocketOutcome) => {
				if (settled) return;
				settled = true;
				clearTimeout(timer);
				socket.destroy();
				resolve(outcome);
			};
			const timer = setTimeout(
				() => settle(connected ? { kind: "timeout" } : { kind: "connect-failed", code: "timeout-before-connect" }),
				timeoutMs,
			);
			timer.unref?.();
			socket.on("connect", () => {
				connected = true;
				socket.write(requestLine);
			});
			socket.on("data", (chunk: Buffer) => {
				const newline = chunk.indexOf(0x0a);
				const part = newline === -1 ? chunk : chunk.subarray(0, newline);
				lineBytes += part.length;
				if (lineBytes > maxReplyBytes) {
					settle({ kind: "oversize" });
					return;
				}
				chunks.push(part);
				if (newline !== -1) settle({ kind: "reply", line: Buffer.concat(chunks).toString("utf8") });
			});
			socket.on("error", (error: NodeJS.ErrnoException) => {
				const code = error.code ?? error.message;
				settle(connected ? { kind: "io-failed", code } : { kind: "connect-failed", code });
			});
			socket.on("close", () => settle({ kind: "eof-before-newline" }));
		});
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** One reply line as the core's JSON-RPC 2.0 envelope for THIS request id, or null. The error's
 * `kind` is the core's own word (`error.data.kind`), quoted and never retyped. */
export type HcEnvelope =
	| { readonly arm: "result"; readonly result: Record<string, unknown> }
	| { readonly arm: "error"; readonly kind: string; readonly message: string };

export function readHcEnvelope(line: string, id: string): HcEnvelope | null {
	let parsed: unknown;
	try {
		parsed = JSON.parse(line);
	} catch {
		return null;
	}
	if (!isRecord(parsed) || parsed.id !== id) return null;
	const hasResult = "result" in parsed;
	const hasError = "error" in parsed;
	if (hasResult === hasError) return null;
	if (hasResult) return isRecord(parsed.result) ? { arm: "result", result: parsed.result } : null;
	const error = parsed.error;
	if (!isRecord(error) || !isRecord(error.data) || typeof error.data.kind !== "string" || error.data.kind === "") {
		return null;
	}
	return { arm: "error", kind: error.data.kind, message: typeof error.message === "string" ? error.message : "" };
}

/** A core-reported string, cut for display. Never parsed back. */
export function boundHcDiagnostic(value: string): string {
	const flat = value.replace(/\p{Cc}/gu, " ");
	return flat.length <= 200 ? flat : `${flat.slice(0, 200)}…`;
}

export function buildHcHelloPacket(id: string): string {
	return `${JSON.stringify({ jsonrpc: "2.0", id, method: "hello", params: { generation: HC_GENERATION } })}\n`;
}

/** The caller-terminal read. No `caller` field: naming one marks the terminal's news as seen. */
export function buildHcTerminalGetPacket(id: string, terminal: string): string {
	return `${JSON.stringify({ jsonrpc: "2.0", id, method: "terminal.get", params: { terminal } })}\n`;
}

/**
 * The fixed launch: an argv vector, an explicit cwd, the env map, a name, and the two flags that make
 * the program nobody's child. No `line`, `on`, `parent`, `caller`, `labels`, `size`, `display`,
 * `keep`, `rm`, `wait`, `timeout` or `outlive_parent` can be expressed through it.
 */
export function buildHcTerminalRunPacket(
	id: string,
	params: {
		readonly argv: readonly string[];
		readonly cwd: string;
		readonly env: Readonly<Record<string, string>>;
		readonly name: string;
	},
): string {
	return `${JSON.stringify({
		jsonrpc: "2.0",
		id,
		method: "terminal.run",
		params: {
			argv: [...params.argv],
			cwd: params.cwd,
			env: { ...params.env },
			name: params.name,
			no_parent: true,
			no_notify: true,
		},
	})}\n`;
}

// ── classification ─────────────────────────────────────────────────────────────────────────────

/** Why an hc resume launch was refused BEFORE the one write. Nothing was created by any of them. */
export type HcResumeRejectReason =
	| "hc-context-missing"
	| "hc-backend-unsupported"
	| "cwd-not-absolute"
	| "cwd-missing"
	| "cwd-not-directory"
	| "hc-runtime-unresolved"
	| PiDurableRuntimeRejectReason
	| "pi-durable-launcher-missing"
	| "hc-argv-nul"
	| "hc-socket-unavailable"
	| "hc-hello-failed"
	| "hc-protocol-generation-unsupported"
	| "hc-caller-terminal-get-failed"
	| "hc-caller-terminal-unparsable"
	| "hc-caller-terminal-drift"
	| "hc-caller-terminal-not-live";

/** Why a launch that reached the write did not become a launch receipt. */
export type HcResumeLaunchFailureReason =
	| "hc-run-transport-failed"
	| "hc-run-refused"
	| "hc-run-failed"
	| "hc-run-reply-unparsable"
	| "hc-run-echo-drift";

/**
 * What is out there after a failed write.
 *   none        the request was never written, or the core answered a well-formed error it raises
 *               before a terminal record exists
 *   unknown     no answer this call can act on: a terminal MAY exist that it cannot name
 *   left-open   the core created a terminal whose echo is not what was asked; it is named and left
 */
export type HcRecovery =
	| { readonly outcome: "none" }
	| { readonly outcome: "unknown" }
	| { readonly outcome: "left-open"; readonly terminal: string };

/**
 * The core's error kinds that `terminal.run` raises BEFORE a terminal record exists
 * (`[HC api/run.rs:19, :86, :98-107, :136-144]`, `[HC terminals.rs:238-246]` at v0.1.20). After
 * `config` one holder process may already have been started and stays; no terminal exists. Every
 * other kind — `spawn_failed` first of all, which also covers "the holder did not answer" and is not
 * split by its message — is `unknown`.
 */
export const HC_RUN_NONE_KINDS: readonly string[] = Object.freeze([
	"invalid_params",
	"unavailable",
	"name_taken",
	"config",
]);

/** The core that answered, as it named itself in `hello`. `id` is permanent per state directory: it
 * names the core, not one run of it. */
export interface HcCore {
	readonly id: string;
	readonly name: string;
}

/** The launch receipt: which core created which terminal for which argv. ABSENT BY CONTRACT: any
 * garden or native session id, the socket path, `status`, `turn`, screen text and `HC_SCOPE`. */
export interface HcResumeReceipt {
	readonly core: HcCore;
	/** The new terminal's address on that core — a VIEW. */
	readonly terminal: string;
	readonly name: string;
	/** The terminal's own process as the core reported it, or null when it reported none. For Claude
	 * Code this is the JOIN its observation reads; it is never an address. */
	readonly pid: string | null;
	/** `argv[0]`: the absolute file this call resolved and the core echoed. */
	readonly runtimePath: string;
	/** The REQUESTED start directory, echoed by the core — not an observation of the process. */
	readonly cwd: string;
}

export type HcResumeCallResult =
	| { readonly ok: true; readonly receipt: HcResumeReceipt }
	| { readonly ok: false; readonly reason: HcResumeRejectReason; readonly reported?: string }
	| {
			readonly ok: false;
			readonly reason: HcResumeLaunchFailureReason;
			readonly core: HcCore;
			/** The core's own error kind when it gave one — quoted, never retyped. */
			readonly hcErrorKind?: string;
			readonly reported?: string;
			readonly recovery: HcRecovery;
	  };

function describeOutcome(outcome: Exclude<HcSocketOutcome, { kind: "reply" }>): string {
	return "code" in outcome ? `${outcome.kind}: ${outcome.code}` : outcome.kind;
}

function classifyCwd(cwd: string): "cwd-not-absolute" | "cwd-missing" | "cwd-not-directory" | null {
	if (!path.isAbsolute(cwd)) return "cwd-not-absolute";
	let st: ReturnType<typeof statSync>;
	try {
		st = statSync(cwd);
	} catch {
		return "cwd-missing";
	}
	return st.isDirectory() ? null : "cwd-not-directory";
}

function isExecutableRegularFile(file: string): boolean {
	try {
		if (!statSync(file).isFile()) return false;
		accessSync(file, fsConstants.X_OK);
		return true;
	} catch {
		return false;
	}
}

/**
 * The first executable regular file named `command` in an ABSOLUTE entry of the caller's PATH, or
 * null. Resolved here, on the caller's PATH, because the program starts with the CORE's environment
 * and a bare name would be looked up there, after the terminal already exists. An absolute `argv[0]`
 * is also what keeps the core from reading it as a template name (`[HC templates.rs:77-80]`), so the
 * core never types a first message into the reopened citizen.
 */
export function resolveHcRuntimeOnPath(command: string, env: NodeJS.ProcessEnv): string | null {
	const raw = env.PATH;
	const entries = typeof raw === "string" ? raw.split(path.delimiter).filter((p) => p.length > 0) : [];
	for (const dir of entries) {
		if (!path.isAbsolute(dir)) continue;
		const candidate = path.join(dir, command);
		if (isExecutableRegularFile(candidate)) return candidate;
	}
	return null;
}

/** What the leaf needs from its surroundings, injectable so a test drives it without a core. */
export interface HcLaunchDeps {
	readonly socket: (socketPath: string) => HcSocketCall;
	readonly resolveRuntime: (command: string, env: NodeJS.ProcessEnv) => string | null;
	readonly packageLayout: () => PiDurablePackageLayout | null;
	readonly runtimeVerdict: (layout: PiDurablePackageLayout) => PiDurableRuntimeRejectReason | null;
	readonly isExecutable: (file: string) => boolean;
}

export const HC_LAUNCH_PRODUCTION_DEPS: HcLaunchDeps = {
	socket: (socketPath) => createHcSocketCall(socketPath),
	resolveRuntime: resolveHcRuntimeOnPath,
	packageLayout: () => piDurablePackageLayout(),
	runtimeVerdict: (layout) => {
		const verdict = checkPiDurableRuntime(layout);
		return verdict.ok ? null : verdict.reason;
	},
	isExecutable: isExecutableRegularFile,
};

/** The terminal name the core will list this launch by: `entwurf-resume-` plus 16 random hex, 31 of
 * the 32 characters the core allows. Random per call — a view, never derived from the citizen. */
export function mintHcTerminalName(): string {
	return `entwurf-resume-${randomBytes(8).toString("hex")}`;
}

export interface HcResumeParams {
	readonly backend: string;
	readonly cwd: string;
	readonly runtimeArgs: readonly string[];
	readonly adoptEnv?: HcPiDurableAdoptEnv;
}

function sameArgv(echoed: unknown, asked: readonly string[]): boolean {
	return Array.isArray(echoed) && echoed.length === asked.length && echoed.every((value, i) => value === asked[i]);
}

/**
 * Open the dormant citizen's runtime in a new hc terminal on the caller's own core.
 *
 * `runtimeArgs` is the record's, built on the v2 side, and passed through untouched: this module does
 * not know what `--session`, `--resume` or `--entwurf-adopt` mean.
 */
export async function hcResumeCall(
	params: HcResumeParams,
	env: NodeJS.ProcessEnv,
	deps: HcLaunchDeps = HC_LAUNCH_PRODUCTION_DEPS,
	name: string = mintHcTerminalName(),
): Promise<HcResumeCallResult> {
	const resolved = resolveHcContext(env);
	if (!resolved.ok) return { ok: false, reason: resolved.reason };
	const { callerTerminal, socketPath } = resolved.context;

	const { backend } = params;
	if (backend !== "pi" && backend !== "claude-code" && backend !== "pi-durable") {
		return { ok: false, reason: "hc-backend-unsupported" };
	}
	const badCwd = classifyCwd(params.cwd);
	if (badCwd !== null) return { ok: false, reason: badCwd };

	let runtimePath: string;
	const launchEnv: Record<string, string> = { ...HC_SCRUBBED_ENV };
	if (backend === "pi-durable") {
		if (params.adoptEnv === undefined) {
			throw new Error("hc-launch: a pi-durable resume reached the hc rail without its adopt projection");
		}
		const layout = deps.packageLayout();
		if (layout === null) return { ok: false, reason: "pi-durable-package-incomplete" };
		const runtimeRefusal = deps.runtimeVerdict(layout);
		if (runtimeRefusal !== null) return { ok: false, reason: runtimeRefusal };
		runtimePath = path.join(layout.root, "run.sh");
		if (!deps.isExecutable(runtimePath)) return { ok: false, reason: "pi-durable-launcher-missing" };
		const adopt: readonly (readonly [string, string])[] = [
			["PI_CODING_AGENT_DIR", params.adoptEnv.PI_CODING_AGENT_DIR],
			["ENTWURF_META_SESSIONS_DIR", params.adoptEnv.ENTWURF_META_SESSIONS_DIR],
			["ENTWURF_META_MAILBOX_DIR", params.adoptEnv.ENTWURF_META_MAILBOX_DIR],
			["ENTWURF_META_SENDERS_DIR", params.adoptEnv.ENTWURF_META_SENDERS_DIR],
			["ENTWURF_META_RECEIVERS_DIR", params.adoptEnv.ENTWURF_META_RECEIVERS_DIR],
		];
		for (const [key, value] of adopt) {
			if (typeof value !== "string" || !path.isAbsolute(value)) {
				throw new Error(`hc-launch: refusing to launch with a non-absolute ${key}: ${JSON.stringify(value)}`);
			}
			launchEnv[key] = value;
		}
	} else {
		const found = deps.resolveRuntime(HC_RESUME_RUNTIME[backend], env);
		if (found === null) return { ok: false, reason: "hc-runtime-unresolved" };
		runtimePath = found;
	}
	const argv = [runtimePath, ...params.runtimeArgs];
	// An exec argv or environment value cannot carry NUL; refused while it is still free.
	if (argv.some((a) => a.includes("\0")) || Object.values(launchEnv).some((v) => v.includes("\0"))) {
		return { ok: false, reason: "hc-argv-nul" };
	}

	const call = deps.socket(socketPath);

	// Read 1: who answers on this socket, and does it speak the generation this rail was read against?
	const helloId = `${name}:hello`;
	const helloOutcome = await call(buildHcHelloPacket(helloId), HC_READ_TIMEOUT_MS);
	if (helloOutcome.kind === "connect-failed") {
		return { ok: false, reason: "hc-socket-unavailable", reported: boundHcDiagnostic(helloOutcome.code) };
	}
	if (helloOutcome.kind !== "reply") {
		return { ok: false, reason: "hc-hello-failed", reported: boundHcDiagnostic(describeOutcome(helloOutcome)) };
	}
	const hello = readHcEnvelope(helloOutcome.line, helloId);
	if (hello === null) return { ok: false, reason: "hc-hello-failed", reported: "the reply could not be read" };
	if (hello.arm === "error") {
		return {
			ok: false,
			reason: hello.kind === "unsupported_generation" ? "hc-protocol-generation-unsupported" : "hc-hello-failed",
			reported: boundHcDiagnostic(`${hello.kind}: ${hello.message}`),
		};
	}
	const coreInfo = hello.result.core;
	if (
		hello.result.generation !== HC_GENERATION ||
		!isRecord(coreInfo) ||
		typeof coreInfo.id !== "string" ||
		coreInfo.id === "" ||
		typeof coreInfo.name !== "string"
	) {
		return hello.result.generation !== HC_GENERATION
			? {
					ok: false,
					reason: "hc-protocol-generation-unsupported",
					reported: boundHcDiagnostic(`generation ${JSON.stringify(hello.result.generation ?? null)}`),
				}
			: { ok: false, reason: "hc-hello-failed", reported: "the reply names no core" };
	}
	const core: HcCore = { id: coreInfo.id, name: coreInfo.name };

	// Read 2: the caller's own terminal, as that core reports it. This is what admits the inherited
	// hint: a socket that answers but does not hold this terminal live is not where the caller is.
	const getId = `${name}:terminal.get`;
	const getOutcome = await call(buildHcTerminalGetPacket(getId, callerTerminal), HC_READ_TIMEOUT_MS);
	if (getOutcome.kind !== "reply") {
		return {
			ok: false,
			reason: "hc-caller-terminal-get-failed",
			reported: boundHcDiagnostic(describeOutcome(getOutcome)),
		};
	}
	const got = readHcEnvelope(getOutcome.line, getId);
	if (got === null) return { ok: false, reason: "hc-caller-terminal-unparsable" };
	if (got.arm === "error") {
		return {
			ok: false,
			reason: "hc-caller-terminal-get-failed",
			reported: boundHcDiagnostic(`${got.kind}: ${got.message}`),
		};
	}
	if (typeof got.result.address !== "string" || typeof got.result.state !== "string") {
		return { ok: false, reason: "hc-caller-terminal-unparsable" };
	}
	if (got.result.address !== callerTerminal) return { ok: false, reason: "hc-caller-terminal-drift" };
	if (got.result.state !== "live") return { ok: false, reason: "hc-caller-terminal-not-live" };

	// ── everything above this line leaves nothing behind; the ONE write follows, never resent ──
	const runId = `${name}:terminal.run`;
	const runOutcome = await call(
		buildHcTerminalRunPacket(runId, { argv, cwd: params.cwd, env: launchEnv, name }),
		HC_RUN_TIMEOUT_MS,
	);
	if (runOutcome.kind !== "reply") {
		return {
			ok: false,
			reason: "hc-run-transport-failed",
			core,
			reported: boundHcDiagnostic(describeOutcome(runOutcome)),
			recovery: runOutcome.kind === "connect-failed" ? { outcome: "none" } : { outcome: "unknown" },
		};
	}
	const ran = readHcEnvelope(runOutcome.line, runId);
	if (ran === null) return { ok: false, reason: "hc-run-reply-unparsable", core, recovery: { outcome: "unknown" } };
	if (ran.arm === "error") {
		const none = HC_RUN_NONE_KINDS.includes(ran.kind);
		return {
			ok: false,
			reason: none ? "hc-run-refused" : "hc-run-failed",
			core,
			hcErrorKind: boundHcDiagnostic(ran.kind),
			reported: boundHcDiagnostic(ran.message),
			recovery: none ? { outcome: "none" } : { outcome: "unknown" },
		};
	}
	// The run result IS the terminal's public facts, flattened (`[HC api/types.rs:795-798 @ v0.1.20]`
	// `#[serde(flatten)]`; `[측정 2026-11-28 live1]` a nested reading called a created terminal
	// unparsable). `first_message` rides beside them and is absent unless a template ran.
	const terminal = ran.result;
	if (typeof terminal.address !== "string" || !HC_LOCAL_ADDRESS.test(terminal.address)) {
		return { ok: false, reason: "hc-run-reply-unparsable", core, recovery: { outcome: "unknown" } };
	}
	// The echo: what the core says it started, against what this call asked for. The env map is not
	// echoed and is not claimed. A first message would mean the core read argv[0] as a template.
	const drift =
		!sameArgv(terminal.argv, argv) ||
		terminal.cwd !== params.cwd ||
		terminal.name !== name ||
		(terminal.parent ?? null) !== null ||
		terminal.notify !== false ||
		terminal.die_with_parent !== false ||
		terminal.keep !== false ||
		(terminal.first_message ?? null) !== null;
	if (drift) {
		return {
			ok: false,
			reason: "hc-run-echo-drift",
			core,
			recovery: { outcome: "left-open", terminal: terminal.address },
		};
	}
	const pid = terminal.pid;
	return {
		ok: true,
		receipt: {
			core,
			terminal: terminal.address,
			name,
			pid: typeof pid === "number" && Number.isSafeInteger(pid) && pid > 1 ? String(pid) : null,
			runtimePath,
			cwd: params.cwd,
		},
	};
}

/** Why each outcome happened, in the caller's terms. Code-owned beside the rail, as herdr's are. */
export const HC_RESUME_HINT: Readonly<Record<HcResumeRejectReason | HcResumeLaunchFailureReason, string>> = {
	"hc-context-missing":
		"HC_TERMINAL_ID and HC_TERMINAL_SOCKET do not both name a terminal on a core this process can reach (a local address like t7 and an absolute socket path), so the hc rail was selected but is unusable here; nothing was sent to tmux or herdr instead",
	"hc-backend-unsupported": "inside hc, same-id resume reopens pi, pi-durable and Claude Code only",
	"cwd-not-absolute": "the recorded start directory is not an absolute path",
	"cwd-missing": "the recorded start directory no longer exists",
	"cwd-not-directory": "the recorded start path is not a directory",
	"hc-runtime-unresolved":
		"no executable for that backend was found in an absolute entry of this caller's PATH; the program would start with the core's environment, so a bare name is never handed to it — put pi / claude on this terminal's PATH and run it again",
	"pi-durable-package-incomplete":
		"this entwurf package does not carry its pi-durable pin, so the managed launcher cannot be verified",
	"pi-durable-carrier-drift": "this entwurf package's pi-durable carrier does not match its pin",
	"pi-durable-sdk-absent": "the pi-durable SDK set this package pins is not installed",
	"pi-durable-sdk-mismatch": "the installed pi-durable SDK set is not the one this package pins",
	"pi-durable-launcher-missing": "this entwurf package's own run.sh is missing or not executable",
	"hc-argv-nul": "the recorded runtime argv or the launch env holds a NUL byte, which no program can be started with",
	"hc-socket-unavailable":
		"nothing accepted a connection on HC_TERMINAL_SOCKET; this rail never starts a core and tries no other endpoint",
	"hc-hello-failed": "the core on HC_TERMINAL_SOCKET did not answer the handshake in a form this rail can read",
	"hc-protocol-generation-unsupported": `the core on HC_TERMINAL_SOCKET does not speak protocol generation ${HC_GENERATION}, the one this rail was read against`,
	"hc-caller-terminal-get-failed":
		"the core would not report this process's own terminal (HC_TERMINAL_ID), so the inherited socket is not shown to be where this caller runs",
	"hc-caller-terminal-unparsable": "the core's reply about this process's own terminal could not be read",
	"hc-caller-terminal-drift": "the core answered about a different terminal than HC_TERMINAL_ID names",
	"hc-caller-terminal-not-live":
		"the core reports the terminal HC_TERMINAL_ID names as finished, so those variables were inherited from a terminal that is gone",
	"hc-run-transport-failed": "the one terminal.run request did not come back as a reply line",
	"hc-run-refused": "the core declined terminal.run by name before any terminal existed",
	"hc-run-failed":
		"the core reported terminal.run as failed in a way that does not prove nothing was started (spawn_failed also covers a holder that did not answer in time)",
	"hc-run-reply-unparsable":
		"the core's terminal.run reply could not be read, so a terminal may exist that this call cannot name",
	"hc-run-echo-drift":
		"the core created a terminal, but what it echoed (argv, cwd, name, parent, notes, keep or a first message) is not what this call asked for; it was left as it is",
};

/**
 * What the v2 launch seam receives. Structural on purpose, as the other leaves' results are: naming
 * v2's types here would import entwurf core into a launch rail.
 */
export type HcResumeLaunchOutcome =
	| { readonly ok: true; readonly handle: { readonly rail: "hc" } & HcResumeReceipt }
	| { readonly ok: false; readonly reason: string; readonly hint: string }
	| {
			readonly ok: false;
			readonly reason: string;
			readonly hint: string;
			readonly failure: {
				readonly rail: "hc";
				readonly vendorCode?: string;
				readonly recovery: HcRecovery;
				readonly core: HcCore;
			};
	  };

function reportedSuffix(reported: string | undefined): string {
	return reported === undefined ? "" : ` (reported, display only and unverified: ${JSON.stringify(reported)})`;
}

export function hcResumeLaunchOutcome(result: HcResumeCallResult): HcResumeLaunchOutcome {
	if (result.ok) return { ok: true, handle: { rail: "hc", ...result.receipt } };
	const hint = `${HC_RESUME_HINT[result.reason]}${reportedSuffix(result.reported)}`;
	if (!("recovery" in result)) return { ok: false, reason: result.reason, hint };
	return {
		ok: false,
		reason: result.reason,
		hint,
		failure: {
			rail: "hc",
			...(result.hcErrorKind === undefined ? {} : { vendorCode: result.hcErrorKind }),
			recovery: result.recovery,
			core: result.core,
		},
	};
}

/** The production hc launch the shared rail root returns to the v2 seam when this process runs in an
 * hc terminal. */
export async function launchHcResume(
	input: HcResumeParams & { readonly piDurableAdoptEnv?: HcPiDurableAdoptEnv },
	env: NodeJS.ProcessEnv,
	deps: HcLaunchDeps = HC_LAUNCH_PRODUCTION_DEPS,
): Promise<HcResumeLaunchOutcome> {
	return hcResumeLaunchOutcome(
		await hcResumeCall(
			{
				backend: input.backend,
				cwd: input.cwd,
				runtimeArgs: input.runtimeArgs,
				...(input.piDurableAdoptEnv === undefined ? {} : { adoptEnv: input.piDurableAdoptEnv }),
			},
			env,
			deps,
		),
	);
}
