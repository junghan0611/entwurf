// ACP plugin — real streamSimple backend: in-memory session reuse (S2d-1b-2b)
// + billing carrier + first-user augment (S2d-1c).
//
// S2c opened the provider path as spawn-per-turn: every streamSimple call spawned
// a FRESH ACP session and tore it down. S2d-1b-2b adds in-memory session REUSE
// for long-lived (process-scoped) pi processes so a resident does not pay a full
// spawn+initialize+newSession on every turn and so the model keeps its own ACP
// history across turns (the delta-only prompt scope — 핀4).
//
// Two orthogonal axes (GPT 73b44d):
//   - bootstrapPath (history source): `new` sends the FULL transcript (a fresh ACP
//     session holds no history); `reuse` sends only the latest user delta (the
//     live ACP session already remembers the prior turns — re-sending the whole
//     transcript would duplicate history). buildAcpPrompt() owns that split.
//   - lifecyclePolicy (does the child outlive the turn): `process-scoped`
//     (`--entwurf-control` resident) MAY keep the child + connection in an
//     in-memory map and reuse it; `turn-scoped` (`pi -p` one-shot AND plain
//     interactive) is ALWAYS `new` + teardown — a surviving child's stdio handle
//     would pin a one-shot pi's exit (the S2c hang).
//
// Scope of THIS cut (GPT 73b44d / c617cb):
//   - in-memory reuse + new ONLY. Persisted resume/load is the next lane (1b-2c):
//     the record is WRITTEN (so 1b-2c can use it) but never READ/used here, and no
//     resume/load capability is passed to decideBootstrap.
//   - S2d-1c carrier + augment: the engraving carrier (`_meta.systemPrompt`,
//     SHORT, NON-EMPTY by default → v1 preset-replacement memory-containment
//     lever) feeds BOTH the config signature and the session meta from one
//     rendered string; the rich first-user augment (bridge identity + AGENTS + pi
//     base) is prepended to the `new` prompt ONLY, on the wire, so it never enters
//     the reuse-compat signature.
//
// CRITICAL — mutable activePromptHandler routing: a retained ClientSideConnection
// outlives the turn, so its sessionUpdate/requestPermission callbacks must NOT
// close over the first turn's stream state (turn 2's notifications would leak into
// turn 1's finished stream). The callbacks delegate to a MUTABLE
// `session.activePromptHandler` that each turn sets to its own stream state and
// clears in finally.
//
// Errors are encoded into the RETURNED event stream as an `error` event with a
// final assistant message — never thrown after the stream is returned (the
// AssistantMessageEventStream contract).

import { type ChildProcessByStdio, spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { Readable, Writable } from "node:stream";
import { ClientSideConnection, ndJsonStream, PROTOCOL_VERSION } from "@agentclientprotocol/sdk";
import type { Api, AssistantMessage, Context, Model, SimpleStreamOptions } from "@earendil-works/pi-ai";
import { createAssistantMessageEventStream } from "@earendil-works/pi-ai";
import { prependNewPromptAugment } from "./augment.js";
import {
	enrichMcpServersWithEnvelope,
	mcpServerNames,
	type ResolvedAcpConfig,
	resolveProviderConfig,
} from "./config.js";
import { type AcpTextBlock, buildAcpPrompt } from "./context.js";
import { loadEngraving } from "./engraving.js";
import {
	type AcpPiStreamState,
	applyAcpSessionUpdate,
	createAcpStreamState,
	finalizeAcpStreamState,
	pushAcpLifecycleNotice,
	pushPermissionNotice,
} from "./event-mapper.js";
import { claudeLaunchEnvDefaults, ensureClaudeConfigOverlay } from "./overlay.js";
import {
	type BootstrapDecision,
	type BootstrapParams,
	bridgeConfigSignature,
	buildSessionRecord,
	contextMessageSignatures,
	decideBootstrap,
	type ExistingSession,
	type LifecyclePolicy,
	resolveLifecyclePolicy,
	writeSessionRecord,
} from "./session-store.js";
import { assertExcludeToolsHonored, buildClaudeSessionMeta, PI_BUILTIN_BACKED_TOOLS } from "./tool-surface.js";

const INITIALIZE_TIMEOUT_MS = 30_000;
const NEW_SESSION_TIMEOUT_MS = 30_000;
const SET_MODEL_TIMEOUT_MS = 30_000;
const PROMPT_TIMEOUT_MS = 600_000;

type StdioChild = ChildProcessByStdio<Writable, Readable, Readable>;

// ---------------------------------------------------------------------------
// Injectable seam (deterministic gates) — production wires the real spawn /
// connection; check-acp-session-reuse injects fakes so it can drive two turns
// and CAPTURE the prompt payloads without launching a real ACP child.
// ---------------------------------------------------------------------------

/** The subset of the spawned child the backend touches (real or fake). */
export interface AcpChildLike {
	pid?: number | null;
	exitCode: number | null;
	signalCode: NodeJS.Signals | null;
	stdin: { destroy(): void; unref?(): void };
	stdout: { destroy(): void; unref?(): void };
	stderr: { on(event: "data", listener: (chunk: Buffer) => void): void; destroy(): void; unref?(): void };
	kill(signal?: NodeJS.Signals | number): boolean;
	unref(): void;
	once(event: "exit" | "error", listener: (...args: unknown[]) => void): void;
}

/** The subset of ClientSideConnection the backend drives (real or fake). */
export interface AcpConnectionLike {
	initialize(params: unknown): Promise<unknown>;
	newSession(params: unknown): Promise<{ sessionId?: string }>;
	prompt(params: { sessionId: string; prompt: AcpTextBlock[] }): Promise<{ stopReason?: string }>;
	unstable_setSessionModel?(params: unknown): Promise<unknown>;
}

/** The ACP client-side callbacks. They delegate to the session's mutable handler. */
export interface AcpClientHandlers {
	sessionUpdate(notification: { update?: Record<string, unknown>; sessionId?: string }): Promise<void>;
	requestPermission(request: { options?: Array<{ optionId: string; kind?: string }> }): Promise<{
		outcome: { outcome: "selected"; optionId: string } | { outcome: "cancelled" };
	}>;
	readTextFile(request: { path: string }): Promise<{ content: string }>;
	writeTextFile(request: unknown): Promise<never>;
}

/** Backend dependencies — defaulted to the real implementations, faked in gates. */
export interface AcpTurnDeps {
	resolveLaunch(): { command: string; args: string[] };
	ensureOverlay(): void;
	spawnChild(launch: { command: string; args: string[] }, cwd: string): AcpChildLike;
	createConnection(child: AcpChildLike, handlers: AcpClientHandlers): AcpConnectionLike;
	lifecyclePolicy(): LifecyclePolicy;
	/** Resolve operator provider config (S2g). Real impl reads global+project settings. */
	loadConfig(cwd: string, modelId: string): ResolvedAcpConfig;
	now(): string;
	/** Record dir override (tests). Defaults to the real session cache dir. */
	sessionDir?: string;
}

// ---------------------------------------------------------------------------
// In-memory session registry (process-scoped reuse) + global cleanup
// ---------------------------------------------------------------------------

interface AcpBridgeEvent {
	type: "session_notification" | "permission_request";
	update?: Record<string, unknown>;
	sessionId?: string;
	decision?: "approved" | "cancelled";
}

interface BridgeSession {
	key: string;
	cwd: string;
	modelId: string;
	child: AcpChildLike;
	connection: AcpConnectionLike;
	acpSessionId: string;
	bridgeConfigSignature: string;
	contextMessageSignatures: string[];
	alive: boolean;
	busy: boolean;
	/** Mutable per-turn router — see the CRITICAL note in the file header. */
	activePromptHandler?: (event: AcpBridgeEvent) => void;
}

const bridgeSessions = new Map<string, BridgeSession>();
const retainedChildren = new Set<AcpChildLike>();
// sessionKeys with a prompt currently in flight. A NEW turn does not enter
// bridgeSessions until it succeeds, so without this a second concurrent FIRST
// turn for the same key would also see `existing === undefined` and spawn a
// second child. Claimed before spawn, released in the orchestrator finally
// (GPT blocker 1).
const inFlightKeys = new Set<string>();
let cleanupRegistered = false;

/**
 * Register ONE global `exit` hook that SIGKILLs every retained child's group, so
 * a resident pi never orphans the `claude` grandchildren. A per-session
 * `process.once` would leak an EventEmitter listener per turn — GPT c617cb. The
 * handler is sync (the `exit` event forbids async work).
 */
function registerGlobalCleanup(): void {
	if (cleanupRegistered) return;
	cleanupRegistered = true;
	process.once("exit", () => {
		for (const child of retainedChildren) killChildGroup(child, "SIGKILL");
	});
}

/** A retained child died between turns: mark dead + drop from map + retained set. */
function onChildGone(session: BridgeSession): void {
	session.alive = false;
	if (bridgeSessions.get(session.key) === session) bridgeSessions.delete(session.key);
	retainedChildren.delete(session.child);
}

// ---------------------------------------------------------------------------
// timeout / launch / permission / stopReason / teardown helpers
// ---------------------------------------------------------------------------

// Race a promise against a timeout, ALWAYS clearing the timer afterwards. A
// naive `Promise.race([p, sleep(ms)])` leaves the timer pending when `p` wins —
// a dangling (here 10-minute) timer that keeps pi's event loop alive long after
// the turn, so pi would never exit a `-p` run. clearTimeout in finally fixes it.
function withTimeout<T>(label: string, p: Promise<T>, ms: number): Promise<T> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	const timeout = new Promise<never>((_, reject) => {
		timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
		timer.unref?.();
	});
	return Promise.race([p, timeout]).finally(() => {
		if (timer) clearTimeout(timer);
	});
}

/** Resolve the claude-agent-acp launch — package bin (resolve), env override for debug. */
function resolveLaunch(): { command: string; args: string[] } {
	const override = process.env.CLAUDE_AGENT_ACP_COMMAND?.trim();
	if (override) return { command: "bash", args: ["-lc", override] };
	const require = createRequire(import.meta.url);
	const pkgJsonPath = require.resolve("@agentclientprotocol/claude-agent-acp/package.json");
	const pkgJson = JSON.parse(readFileSync(pkgJsonPath, "utf8")) as { bin?: string | Record<string, string> };
	const binPath = typeof pkgJson.bin === "string" ? pkgJson.bin : pkgJson.bin?.["claude-agent-acp"];
	if (!binPath) throw new Error("@agentclientprotocol/claude-agent-acp resolved but exposes no bin entry");
	return { command: process.execPath, args: [join(dirname(pkgJsonPath), binPath)] };
}

/** Approve-all permission policy (YOLO — oracle F). options empty → cancelled. */
function resolvePermissionResponse(params: { options?: Array<{ optionId: string; kind?: string }> }): {
	outcome: { outcome: "selected"; optionId: string } | { outcome: "cancelled" };
} {
	const options = Array.isArray(params?.options) ? params.options : [];
	if (options.length === 0) return { outcome: { outcome: "cancelled" } };
	const allow = options.find((o) => o.kind === "allow_once" || o.kind === "allow_always");
	return { outcome: { outcome: "selected", optionId: (allow ?? options[0]).optionId } };
}

/** ACP prompt stopReason → pi stopReason. */
function mapPromptStopReason(stopReason: string | undefined): AssistantMessage["stopReason"] {
	switch (stopReason) {
		case "max_tokens":
			return "length";
		case "cancelled":
			return "aborted";
		default:
			return "stop";
	}
}

// Signal the child's whole PROCESS GROUP. claude-agent-acp spawns a `claude`
// grandchild that inherits the stdio pipe fds; killing only the direct child
// leaves the grandchild holding the write end of pi's stdout pipe, so pi's event
// loop never drains and the process hangs. The child is spawned `detached` (its
// own group), so a negative-pid kill reaches the grandchild too.
function killChildGroup(child: AcpChildLike, signal: NodeJS.Signals): void {
	try {
		if (child.pid != null) process.kill(-child.pid, signal);
		else child.kill(signal);
	} catch {
		try {
			child.kill(signal);
		} catch {
			// already gone
		}
	}
}

// Tear the child down WITHOUT blocking pi's exit. The pi process exits only when
// its event loop has no ref'd handles; the backend child's stdio pipes are such
// handles. Awaiting the child's death (it may be slow to honor SIGTERM, and its
// `claude` grandchild can linger) would pin pi open. Instead we (1) destroy pi's
// own pipe handles immediately so the loop frees, (2) unref the child so it never
// keeps the loop alive, (3) SIGTERM the group now and SIGKILL it after a grace on
// an UNREF'd timer (best-effort reaping that does not itself hold pi open).
//
// REUSE INVARIANT (GPT c617cb): teardownChild is ONLY for turn-scoped one-shots
// and for incompatible/error/abort closes — NEVER between turns of a retained
// process-scoped session (that would destroy the reusable connection's stdio).
function teardownChild(child: AcpChildLike, graceMs = 2_000): void {
	const alreadyDead = child.exitCode !== null || child.signalCode !== null;
	if (!alreadyDead) killChildGroup(child, "SIGTERM");
	for (const s of [child.stdin, child.stdout, child.stderr]) {
		try {
			s?.destroy();
		} catch {
			// best-effort
		}
	}
	try {
		child.unref();
	} catch {
		// best-effort
	}
	if (!alreadyDead) {
		const t = setTimeout(() => killChildGroup(child, "SIGKILL"), graceMs);
		t.unref?.();
	}
}

// unref (NOT destroy) a retained process-scoped child so its live stdio handles
// do not pin pi's event loop. While the resident runs, the control socket (and
// the next turn) keeps the loop alive, so reads still flow and reuse works; on
// resident shutdown the loop can drain to empty so the `exit` cleanup hook fires
// (an un-unref'd stdio handle would re-create the S2c hang at quit). GPT amber.
function unrefRetainedChild(child: AcpChildLike): void {
	try {
		child.unref();
	} catch {
		// best-effort
	}
	for (const s of [child.stdin, child.stdout, child.stderr]) {
		try {
			s?.unref?.();
		} catch {
			// best-effort
		}
	}
}

/** Default (production) dependencies — real spawn + real ClientSideConnection. */
function defaultDeps(): AcpTurnDeps {
	return {
		resolveLaunch,
		ensureOverlay: ensureClaudeConfigOverlay,
		spawnChild: (launch, cwd) =>
			spawn(launch.command, launch.args, {
				cwd,
				env: { ...process.env, ...claudeLaunchEnvDefaults() },
				stdio: ["pipe", "pipe", "pipe"],
				// Own process group so teardown can signal the claude grandchild too.
				detached: true,
			}) as unknown as AcpChildLike,
		createConnection: (child, handlers) => {
			const real = child as unknown as StdioChild;
			const stdoutWeb = Readable.toWeb(real.stdout) as unknown as ReadableStream<Uint8Array>;
			const stdinWeb = Writable.toWeb(real.stdin) as unknown as WritableStream<Uint8Array>;
			const transport = ndJsonStream(stdinWeb, stdoutWeb);
			return new ClientSideConnection(
				() => handlers,
				transport as unknown as ConstructorParameters<typeof ClientSideConnection>[1],
			) as unknown as AcpConnectionLike;
		},
		lifecyclePolicy: () => resolveLifecyclePolicy(),
		loadConfig: (cwd, modelId) => resolveProviderConfig({ cwd, modelId }),
		now: () => new Date().toISOString(),
	};
}

/** sessionKey: options.sessionId, else PI_SESSION_ID, else a cwd fallback (GPT ②). */
function resolveSessionKey(opts: { sessionId?: string } | undefined, cwd: string): string {
	const sid = opts?.sessionId?.trim() || process.env.PI_SESSION_ID?.trim();
	return sid ? `pi:${sid}` : `cwd:${cwd}`;
}

/** Best-effort persist of the session record (1b-2c reads it; this cut only writes). */
function persistRecord(session: BridgeSession, deps: AcpTurnDeps): void {
	try {
		const record = buildSessionRecord(
			{
				sessionKey: session.key,
				acpSessionId: session.acpSessionId,
				cwd: session.cwd,
				modelId: session.modelId,
				bridgeConfigSignature: session.bridgeConfigSignature,
				contextMessageSignatures: session.contextMessageSignatures,
			},
			deps.now(),
		);
		writeSessionRecord(record, deps.sessionDir);
	} catch {
		// record is a 1b-2c convenience — a write failure must not fail the turn.
	}
}

// Detour A (A-c) — actionable rendering of a context-window overflow.
//
// An interactive / one-shot entwurf turn is `turn-scoped`, so it is ALWAYS
// `new`: every turn spawns a fresh ACP child and resends the FULL transcript +
// first-user augment as one prompt (there is no persisted resume yet — that is
// the deferred 1b-2c lane). A long, or resumed, conversation can therefore
// exceed the backend model's input window, which the backend returns as a
// terse 400 the operator sees only as "API Error". This pure classifier turns
// that into an honest, actionable hint. It does NOT change routing or suppress
// the error — it only makes the broken state legible (Code Principle: surface
// broken tool state AS broken).
//
// Resume itself is legitimate — entwurf locks the MODEL, not resume — so
// the hint never tells the operator to stop resuming; it names the real cause
// (turn-scoped full-transcript replay) and the real follow-up fix.
const ACP_CONTEXT_OVERFLOW_SIGNATURES: readonly RegExp[] = [
	/prompt is too long/i,
	/input (?:is )?too long/i,
	/input length and `?max_tokens`? exceed/i,
	/(?:maximum|max) context/i,
	/context (?:window|length)/i,
	/too many (?:input )?tokens/i,
	/exceeds? the (?:maximum|context)/i,
	/reduce the length of/i,
];

export function actionableAcpBackendHint(message: string): string | undefined {
	if (!ACP_CONTEXT_OVERFLOW_SIGNATURES.some((re) => re.test(message))) return undefined;
	return [
		"[acp] likely context-window overflow — the backend model rejected the input as too long.",
		"  Why: this turn used a FRESH ACP backend session (common in a turn-scoped / no --entwurf-control",
		"       session, but also a resident's first or incompatible turn), so it resent the FULL transcript",
		"       + augment as one prompt; a long or resumed conversation can exceed the backend model's input",
		"       window. (Resume is legitimate — entwurf locks the model, not resume.)",
		"  Now: start a fresh or shorter session to get unblocked.",
		"  Root fix (follow-up): persisted resume (delta-only) or a window/summary policy.",
	].join("\n");
}

/**
 * streamSimple for the entwurf provider. Returns the event stream
 * synchronously and drives the ACP turn on a microtask.
 */
export function streamShellAcp(
	model: Model<Api>,
	context: Context,
	options?: SimpleStreamOptions,
): ReturnType<typeof createAssistantMessageEventStream> {
	return streamAcpTurn(model, context, options, defaultDeps());
}

/** The seam-aware turn driver. `streamShellAcp` calls this with the real deps. */
export function streamAcpTurn(
	model: Model<Api>,
	context: Context,
	options: SimpleStreamOptions | undefined,
	deps: AcpTurnDeps,
): ReturnType<typeof createAssistantMessageEventStream> {
	const stream = createAssistantMessageEventStream();
	const state: AcpPiStreamState = createAcpStreamState(stream, {
		api: "entwurf",
		provider: "entwurf",
		model: model.id,
	});
	const opts = options as
		| ({ cwd?: string; signal?: AbortSignal; sessionId?: string } & SimpleStreamOptions)
		| undefined;
	const cwd = opts?.cwd ?? process.cwd();
	const signal = opts?.signal;

	stream.push({ type: "start", partial: state.output });

	// Per-turn event router → the CURRENT stream state. The retained connection's
	// callbacks delegate here; we install it per turn and clear it in finally.
	function makePromptHandler(session: BridgeSession): (event: AcpBridgeEvent) => void {
		return (event) => {
			if (event.type === "session_notification") {
				if (event.sessionId && session.acpSessionId && event.sessionId !== session.acpSessionId) return;
				applyAcpSessionUpdate(state, event.update);
			} else if (event.decision) {
				pushPermissionNotice(state, "permission request", event.decision);
			}
		};
	}

	function finishSuccess(promptResult: { stopReason?: string }): void {
		finalizeAcpStreamState(state);
		const mapped = mapPromptStopReason(promptResult?.stopReason);
		if (signal?.aborted || mapped === "aborted") {
			state.output.stopReason = "aborted";
			stream.push({ type: "error", reason: "aborted", error: state.output });
		} else {
			state.output.stopReason = mapped;
			stream.push({ type: "done", reason: mapped === "length" ? "length" : "stop", message: state.output });
		}
		stream.end();
	}

	function finishError(err: unknown, aborted: boolean, stderrTail?: string[]): void {
		finalizeAcpStreamState(state);
		state.output.stopReason = aborted ? "aborted" : "error";
		const base = err instanceof Error ? err.message : String(err);
		const tail = (stderrTail ?? []).join("").trim().slice(-1_000);
		const full = tail ? `${base}\n--- backend stderr (tail) ---\n${tail}` : base;
		// A-c: a real failure (not an abort) that looks like a context-window
		// overflow gets an actionable hint appended, so "API Error" stops hiding
		// the turn-scoped full-transcript-replay cause.
		const hint = aborted ? undefined : actionableAcpBackendHint(full);
		state.output.errorMessage = hint ? `${full}\n\n${hint}` : full;
		stream.push({ type: "error", reason: aborted ? "aborted" : "error", error: state.output });
		stream.end();
	}

	queueMicrotask(async () => {
		// Operator provider config (S2g) — resolve FIRST. A config the bridge
		// cannot honor (bad mcpServers / skillPlugins / appendSystemPrompt:true /
		// strictMcpConfig:false) fails loud into the stream before any spawn. This
		// is the baseline fix: the operator's entwurfProvider.{mcpServers,
		// skillPlugins,tools,…} now actually reach the session.
		let config: ResolvedAcpConfig;
		try {
			config = deps.loadConfig(cwd, model.id);
		} catch (err) {
			finishError(err, false);
			return;
		}
		const serverNames = mcpServerNames(config);
		// S2g: apply the operator's tool/permission notice preference to THIS turn's
		// stream. Display-only rendering config (not session-compat), so it is set on
		// the stream state and deliberately kept OUT of bridgeConfigSignature. The S2f
		// lifecycle notices ignore this flag (always visible) — only the verbose
		// [tool:*] / [permission:*] stream is suppressed when false.
		state.showToolNotifications = config.showToolNotifications;

		// Tool-surface truthfulness preflight (S2b assertExcludeToolsHonored) —
		// BEFORE any spawn or session lookup. If pi excluded a built-in the Claude
		// child will still expose (declared != actual), fail fast into the stream
		// rather than lie to the model. Uses the RESOLVED tool surface (S2g) so an
		// operator-narrowed `tools` is what the truthfulness check honors.
		try {
			const activeToolNames = context.tools?.map((t) => t.name) ?? [...PI_BUILTIN_BACKED_TOOLS];
			assertExcludeToolsHonored(activeToolNames, { backend: "claude", tools: config.tools });
		} catch (err) {
			finishError(err, false);
			return;
		}

		const policy = deps.lifecyclePolicy();
		const sessionKey = resolveSessionKey(opts, cwd);
		// Billing/memory carrier (S2d-1c): SHORT operator-authored system-prompt
		// additions. The shipped default is NON-empty → tiny string carrier →
		// claude_code preset replacement, which strips auto-memory. The SAME rendered
		// string feeds BOTH the config signature (appendSystemPrompt) and
		// _meta.systemPrompt (in runNewTurn), so a carrier change invalidates reuse;
		// loadEngraving is pure (no clock/random/env) so the signature stays a
		// per-(model,template) constant and does NOT rebuild every turn (NEXT
		// §S2-scout 핀1 / oracle C, GPT c32a6c8 ②). null → "" is the explicit
		// operator opt-out branch. mcpServerNames feed the carrier so
		// `{{mcp_servers}}` lists the real set. If the shipped default carrier is
		// missing/empty, loadEngraving throws (trust lever off); surface that as a
		// stream error instead of an unhandled microtask failure.
		let engraving: string | null;
		try {
			engraving = loadEngraving({ backend: "claude", mcpServerNames: serverNames });
		} catch (err) {
			finishError(err, false);
			return;
		}
		// S2g: the signature folds the FULL resolved config (mcpServersHash + tool
		// surface + skillPlugins + flags) so any operator config change invalidates
		// a reused session; the per-session envelope is excluded (runtime, not config).
		const configSig = bridgeConfigSignature({
			backend: "claude",
			modelId: model.id,
			appendSystemPrompt: engraving ?? "",
			mcpServersHash: config.mcpServersHash,
			settingSources: [...config.settingSources],
			strictMcpConfig: config.strictMcpConfig,
			tools: [...config.tools],
			skillPlugins: [...config.skillPlugins],
			permissionAllow: [...config.permissionAllow],
			disallowedTools: [...config.disallowedTools],
		});
		const ctxSigs = contextMessageSignatures(context);
		const params: BootstrapParams = {
			cwd,
			modelId: model.id,
			bridgeConfigSignature: configSig,
			contextMessageSignatures: ctxSigs,
			lifecyclePolicy: policy,
		};

		const existing = bridgeSessions.get(sessionKey);

		// Concurrent prompt on the same sessionKey → fail-loud (first cut: no
		// queue). Covers BOTH a retained busy session AND an in-flight FIRST turn
		// (a NEW turn is not in the map yet — inFlightKeys). Checked BEFORE we
		// claim/spawn/set any handler, so nothing to unwind (GPT blocker 1).
		if (existing?.busy || inFlightKeys.has(sessionKey)) {
			finishError(new Error(`entwurf session ${sessionKey} is busy with another prompt`), false);
			return;
		}

		const existingFacts: ExistingSession | undefined = existing
			? {
					cwd: existing.cwd,
					modelId: existing.modelId,
					bridgeConfigSignature: existing.bridgeConfigSignature,
					contextMessageSignatures: existing.contextMessageSignatures,
					alive: existing.alive,
				}
			: undefined;

		let decision: BootstrapDecision;
		try {
			// 1b-2b: persisted resume/load is OFF — no persisted record and no
			// resume/load capability passed, so decideBootstrap returns only
			// "new" or "reuse". (Persisted resume/load is the 1b-2c lane.)
			decision = decideBootstrap(params, { existing: existingFacts });
		} catch (err) {
			// Model lock (live alive child, different model): surface as a stream
			// error. Do NOT close the live child or drop it from the map — a
			// mismatch means "not reusable for THIS turn", not "dead" (GPT ③).
			finishError(err, false);
			return;
		}

		// A "new" decision WITH an existing session means we are ABANDONING that
		// session (incompatible drift / stale-dead) — the model-lock throw already
		// returned above, so this is never a "leave it alone" case. Close the old
		// child so it is not orphaned in retainedChildren (GPT blocker 2).
		if (decision.path === "new" && existing) {
			existing.alive = false;
			if (bridgeSessions.get(sessionKey) === existing) bridgeSessions.delete(sessionKey);
			retainedChildren.delete(existing.child);
			teardownChild(existing.child);
		}

		// Claim the key for the whole turn — atomic with the checks above (no await
		// in between), so a concurrent first turn for the same key sees it in flight
		// and fails loud (GPT blocker 1).
		inFlightKeys.add(sessionKey);
		try {
			if (decision.path === "reuse" && existing) {
				await runReuseTurn(existing, ctxSigs);
			} else {
				await runNewTurn(params, ctxSigs, engraving, config);
			}
		} finally {
			inFlightKeys.delete(sessionKey);
		}
	});

	// --- new session: spawn → initialize → newSession → setModel → full transcript
	async function runNewTurn(
		params: BootstrapParams,
		ctxSigs: string[],
		engraving: string | null,
		config: ResolvedAcpConfig,
	): Promise<void> {
		let child: AcpChildLike | undefined;
		let session: BridgeSession | undefined;
		let onAbort: (() => void) | undefined;
		const stderrTail: string[] = [];
		const sessionKey = resolveSessionKey(opts, cwd);
		try {
			if (signal?.aborted) throw new Error("aborted before launch");

			// S2f visibility: surface the otherwise-silent bootstrap so a slow
			// overlay/spawn/init does not read as a hang. Display-only (marked).
			pushAcpLifecycleNotice(state, "preparing claude session");
			deps.ensureOverlay();
			const launch = deps.resolveLaunch();
			child = deps.spawnChild(launch, cwd);
			const spawned = child;

			// Drain stderr (an unconsumed pipe can backpressure-deadlock a long turn).
			spawned.stderr.on("data", (c: Buffer) => {
				stderrTail.push(c.toString());
				if (stderrTail.length > 50) stderrTail.shift();
			});

			if (signal) {
				onAbort = () => killChildGroup(spawned, "SIGTERM");
				signal.addEventListener("abort", onAbort, { once: true });
			}

			// Mutable-routing callbacks — they read `session` (assigned just below)
			// and delegate to its per-turn activePromptHandler. NEVER close over a
			// turn's stream state directly (CRITICAL — see file header).
			const handlers: AcpClientHandlers = {
				sessionUpdate: async (n) => {
					session?.activePromptHandler?.({
						type: "session_notification",
						update: n?.update,
						sessionId: n?.sessionId,
					});
				},
				requestPermission: async (req) => {
					const response = resolvePermissionResponse(req);
					const decision = response.outcome.outcome === "selected" ? "approved" : "cancelled";
					session?.activePromptHandler?.({ type: "permission_request", decision });
					return response;
				},
				readTextFile: async (req) => ({ content: readFileSync(req.path, "utf8") }),
				writeTextFile: async (): Promise<never> => {
					throw new Error("Client-side writeTextFile is not supported in entwurf ACP mode.");
				},
			};
			const connection = deps.createConnection(spawned, handlers);

			session = {
				key: sessionKey,
				cwd,
				modelId: model.id,
				child: spawned,
				connection,
				acpSessionId: "",
				bridgeConfigSignature: params.bridgeConfigSignature,
				contextMessageSignatures: ctxSigs,
				alive: true,
				busy: true,
				activePromptHandler: undefined,
			};
			const sess = session;
			spawned.once("exit", () => onChildGone(sess));
			spawned.once("error", () => onChildGone(sess));

			await withTimeout(
				"initialize",
				connection.initialize({
					protocolVersion: PROTOCOL_VERSION,
					clientCapabilities: {},
					clientInfo: { name: "entwurf", version: "s2d" },
				}),
				INITIALIZE_TIMEOUT_MS,
			);

			// Tool-narrowed session meta (S2b) + the billing carrier (S2d-1c). The
			// carrier is the SAME rendered engraving folded into configSig above;
			// when null, buildClaudeSessionMeta omits the _meta.systemPrompt key
			// entirely so a carrier-absent session is byte-identical to 1b-2b.
			// S2g: the RESOLVED operator config drives the session meta (tools /
			// permission / disallowed / settingSources / strictMcpConfig / skillPlugins)
			// instead of the old hardcoded minimal surface.
			const sessionMeta = buildClaudeSessionMeta(
				{
					modelId: model.id,
					tools: config.tools,
					permissionAllow: config.permissionAllow,
					disallowedTools: config.disallowedTools,
					settingSources: config.settingSources,
					strictMcpConfig: config.strictMcpConfig,
					skillPlugins: config.skillPlugins,
				},
				engraving ?? undefined,
			);
			// Envelope-enrich the normalized servers at spawn time (PI_SESSION_ID/
			// PI_AGENT_ID into entwurf-bridge) — runtime wiring, applied AFTER the
			// config signature was taken so a new session id never forces a rebuild.
			const wireMcpServers = enrichMcpServersWithEnvelope(config.mcpServers, {
				modelId: model.id,
				piSessionId: process.env.PI_SESSION_ID?.trim() || undefined,
			});
			const created = await withTimeout(
				"newSession",
				connection.newSession({ cwd, mcpServers: wireMcpServers, _meta: sessionMeta }),
				NEW_SESSION_TIMEOUT_MS,
			);
			const acpSessionId = created?.sessionId;
			if (!acpSessionId) throw new Error("newSession returned no sessionId");
			session.acpSessionId = acpSessionId;

			// Enforce the requested model — a silent default would lie about which
			// model answered.
			const setModel = connection.unstable_setSessionModel;
			if (typeof setModel !== "function") {
				throw new Error(`unstable_setSessionModel unsupported — cannot enforce model ${model.id}`);
			}
			await withTimeout(
				"setSessionModel",
				setModel.call(connection, { sessionId: acpSessionId, modelId: model.id }),
				SET_MODEL_TIMEOUT_MS,
			);

			// S2f visibility: the session is live and model-locked — the next gap is
			// the prompt round-trip to the first token.
			pushAcpLifecycleNotice(state, `session ready model=${model.id}`);

			session.activePromptHandler = makePromptHandler(session);
			// new session holds NO history → the full transcript is the only carrier.
			const basePrompt = buildAcpPrompt(context, "new");
			if (basePrompt.length === 0) throw new Error("empty pi context — nothing to prompt");
			// S2d-1c: prepend the rich first-user augment (bridge identity + ~/AGENTS.md
			// + cwd/AGENTS.md + pi base + tool surface) on the WIRE only — never into
			// the pi Context, so it stays out of contextMessageSignatures (NEXT §S2d
			// gate ②). `new`-only → reuse turns stay clean (once-only). Entwurf-spawned
			// prompts that already carry cwd/AGENTS.md get that one section de-duped.
			const prompt = prependNewPromptAugment(basePrompt, {
				backend: "claude",
				cwd,
				mcpServerNames: mcpServerNames(config),
				emacsAgentSocket: process.env.PI_EMACS_AGENT_SOCKET?.trim() || undefined,
			});

			// S2f visibility: about to send — say "sending" (not "sent") because the
			// prompt could still sync-reject before the wire write; the next visible
			// event after this is the backend's own first token / tool notice.
			pushAcpLifecycleNotice(state, "sending prompt");
			const promptResult = await withTimeout(
				"prompt",
				connection.prompt({ sessionId: acpSessionId, prompt }),
				PROMPT_TIMEOUT_MS,
			);

			session.activePromptHandler = undefined;
			session.busy = false;
			finishSuccess(promptResult);

			// Retain ONLY a long-lived process-scoped session that survived the turn
			// alive and un-aborted. A turn-scoped one-shot (and any aborted/dead
			// turn) tears down so its stdio handle cannot pin pi's exit (S2c hang).
			if (params.lifecyclePolicy === "process-scoped" && !signal?.aborted && session.alive) {
				bridgeSessions.set(sessionKey, session);
				retainedChildren.add(spawned);
				registerGlobalCleanup();
				// unref so the retained stdio cannot pin pi's exit at resident
				// shutdown — reuse is unaffected (unref ≠ destroy). GPT amber.
				unrefRetainedChild(spawned);
				persistRecord(session, deps);
			} else {
				teardownChild(spawned);
			}
		} catch (err) {
			const aborted = Boolean(signal?.aborted);
			if (session) {
				session.activePromptHandler = undefined;
				session.busy = false;
				if (bridgeSessions.get(sessionKey) === session) bridgeSessions.delete(sessionKey);
			}
			// error/abort → drop the (uncertain) session and close its child; an
			// uncertain connection must never be reused (GPT ④).
			if (child) {
				retainedChildren.delete(child);
				teardownChild(child);
			}
			finishError(err, aborted, stderrTail);
		} finally {
			if (signal && onAbort) signal.removeEventListener("abort", onAbort);
		}
	}

	// --- reuse: send only the latest user delta to the live ACP session
	async function runReuseTurn(session: BridgeSession, ctxSigs: string[]): Promise<void> {
		let onAbort: (() => void) | undefined;
		try {
			if (signal?.aborted) throw new Error("aborted before prompt");

			// S2f visibility: reuse skips spawn/init entirely — say so, otherwise a
			// resident turn looks identical to a cold start that stalled.
			pushAcpLifecycleNotice(state, "reusing live session");
			session.busy = true;
			session.activePromptHandler = makePromptHandler(session);
			if (signal) {
				onAbort = () => killChildGroup(session.child, "SIGTERM");
				signal.addEventListener("abort", onAbort, { once: true });
			}

			// The live ACP session already remembers the prior turns → send only the
			// latest user delta (re-sending the transcript would duplicate history).
			const prompt = buildAcpPrompt(context, "reuse");
			if (prompt.length === 0) throw new Error("empty delta — a reuse turn has no new user message");

			// S2f visibility: about to send the delta to the resident child.
			pushAcpLifecycleNotice(state, "sending prompt");
			const promptResult = await withTimeout(
				"prompt",
				session.connection.prompt({ sessionId: session.acpSessionId, prompt }),
				PROMPT_TIMEOUT_MS,
			);

			session.activePromptHandler = undefined;
			session.busy = false;
			// Advance the stored history to THIS call's context so the NEXT turn's
			// prefix-compat check sees the full prior history (GPT ④: store the
			// ctxSigs from the START of this call, only after the turn succeeds).
			session.contextMessageSignatures = ctxSigs;
			finishSuccess(promptResult);
			persistRecord(session, deps);
		} catch (err) {
			const aborted = Boolean(signal?.aborted);
			session.activePromptHandler = undefined;
			session.busy = false;
			// error/abort on a reused session → drop it and close the child (GPT ④).
			if (bridgeSessions.get(session.key) === session) bridgeSessions.delete(session.key);
			retainedChildren.delete(session.child);
			teardownChild(session.child);
			finishError(err, aborted);
		} finally {
			if (signal && onAbort) signal.removeEventListener("abort", onAbort);
		}
	}

	return stream;
}
