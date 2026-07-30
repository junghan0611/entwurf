// §11-7 ordering probe — the ACP-side turn driver (probe-dedicated raw client).
//
// §11-7 names two client seams and requires picking one explicitly. This lane
// picks the RAW CLIENT (not the stdio wire proxy), so it carries §11-7's bound:
// it is NOT the production path and must be gated as issuing the SAME calls,
// arguments, and order as the backend's real sequence (backend.ts runNewTurn) —
// otherwise the probe measures a lookalike. check-probe-ordering is that gate;
// it drives this exact function over a recording fake connection.
//
// Production values arrive through the `adapter` / `enrichMcpServers` seams —
// the LIVE runner tsc-emits pi-extensions and injects the REAL claudeAdapter +
// enrichMcpServersWithEnvelope (backend-adapter.ts carries `.js` value imports,
// so it is not strip-types-loadable from here; the emit-then-import pattern is
// the house one, see check-acp-session-reuse). This module therefore holds ONLY
// the orchestration backend.ts owns: phase order, arg assembly, timeouts, and
// phase-attributed failure — each pinned against backend.ts source by the gate
// so production drift turns the gate red instead of silently unbinding the probe.
//
// Every phase start/end is stamped into the shared NDJSON log — including
// set-model, because §11-7 measured that dropping it misreads an enforceModel
// stall as C or D.

import { PROTOCOL_VERSION } from "@agentclientprotocol/sdk";
import type { AcpConnectionLike } from "../../pi-extensions/lib/acp/acp-client.ts";
import type { ResolvedAcpConfig } from "../../pi-extensions/lib/acp/config.ts";
import { PROBE_EVENTS, type ProbeEventName } from "./probe-event-log.ts";

export interface ProbePhaseTimeouts {
	initializeMs: number;
	newSessionMs: number;
	setModelMs: number;
}

// BOOTSTRAP phase timeouts — MUST equal backend.ts's INITIALIZE/NEW_SESSION/
// SET_MODEL_TIMEOUT_MS (check-probe-ordering pins them against the source).
// §11-7: a bootstrap-phase D verdict is only readable against production's own
// boundaries, so the probe may not invent its own.
export const PROBE_PHASE_TIMEOUTS: ProbePhaseTimeouts = {
	initializeMs: 30_000,
	newSessionMs: 30_000,
	setModelMs: 30_000,
};

// The prompt phase has NO production counterpart to match: backend.ts ends a
// prompt on lifecycle events only (resolve / abort / child gone) and carries no
// wall-clock cutoff, by policy — an active turn is not a failed turn for being
// long. This value is therefore the MEASUREMENT HARNESS's own bounded
// observation horizon: it stops a probe RUN from hanging forever. It is not a
// production contract, not an equivalence, and not a deadline any §11-7 verdict
// is read against. Horizon expiry means the run's prompt window is
// INCONCLUSIVE — the artifact is preserved and read as "not measured", never as
// a model of production killing a turn.
export const PROBE_PROMPT_OBSERVATION_MS = 600_000;

/** The two adapter methods the turn drives — satisfied by the REAL claudeAdapter
 *  (emitted) in the LIVE runner and by recording stubs in the gate. */
export interface ProbeAdapterSeam {
	buildSessionMeta(
		params: { modelId: string; nativeModelId: string; config: ResolvedAcpConfig },
		carrier: string | null,
	): Record<string, unknown> | undefined;
	enforceModel(params: {
		connection: AcpConnectionLike;
		acpSessionId: string;
		modelId: string;
		nativeModelId: string;
	}): Promise<void>;
}

/** Production's enrichMcpServersWithEnvelope shape (config.ts). */
export type ProbeMcpEnricher = (
	servers: ResolvedAcpConfig["mcpServers"],
	envelope: { modelId?: string; piSessionId?: string },
) => ResolvedAcpConfig["mcpServers"];

/** The turn phases in production order. `initialize` failures are P0/I0 input
 *  (run-invalidating), the rest map to phase-qualified D readings. */
export type ProbeTurnPhase = "initialize" | "newSession" | "enforceModel" | "prompt";

/** A phase-attributed turn failure — the classifier needs WHICH wire step died,
 *  never just that the turn died. */
export class ProbePhaseError extends Error {
	readonly phase: ProbeTurnPhase;
	readonly timedOut: boolean;

	constructor(phase: ProbeTurnPhase, cause: Error, timedOut: boolean) {
		super(`${phase}: ${cause.message}`);
		this.phase = phase;
		this.timedOut = timedOut;
		this.cause = cause;
	}
}

class PhaseTimeoutError extends Error {}

// Same guard shape as backend.ts withTimeout / smoke-acp-raw-turn-live: always
// clear the timer so a passing turn cannot pin the event loop on a stale timer.
function withPhaseTimeout<T>(label: string, p: Promise<T>, ms: number): Promise<T> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	const timeout = new Promise<never>((_, reject) => {
		timer = setTimeout(() => reject(new PhaseTimeoutError(`${label} timed out after ${ms}ms`)), ms);
	});
	return Promise.race([p, timeout]).finally(() => {
		if (timer) clearTimeout(timer);
	});
}

export interface ProbeTurnParams {
	cwd: string;
	modelId: string;
	nativeModelId: string;
	config: ResolvedAcpConfig;
	/** Production carrier (adapter.loadCarrier result) — folded into `_meta` by
	 *  buildSessionMeta so the probe's newSession matches production shape. */
	carrier: string | null;
	promptText: string;
	adapter: ProbeAdapterSeam;
	enrichMcpServers: ProbeMcpEnricher;
	log: (event: ProbeEventName, payload?: Record<string, unknown>) => void;
	/** Bootstrap boundaries (production-pinned). Defaults to PROBE_PHASE_TIMEOUTS. */
	timeouts?: ProbePhaseTimeouts;
	/** Harness observation horizon for the prompt phase — NOT a production deadline. */
	promptObservationMs?: number;
}

export interface ProbeTurnResult {
	acpSessionId: string;
	stopReason: string | undefined;
}

async function runPhase<T>(
	phase: ProbeTurnPhase,
	startEvent: ProbeEventName,
	endEvent: ProbeEventName,
	log: ProbeTurnParams["log"],
	ms: number,
	body: () => Promise<T>,
): Promise<T> {
	log(startEvent, { timeoutMs: ms });
	try {
		const result = await withPhaseTimeout(phase, body(), ms);
		log(endEvent, { ok: true });
		return result;
	} catch (err) {
		const error = err instanceof Error ? err : new Error(String(err));
		const timedOut = error instanceof PhaseTimeoutError;
		log(endEvent, { ok: false, timedOut, error: error.message });
		throw new ProbePhaseError(phase, error, timedOut);
	}
}

/**
 * Drive ONE production-shaped turn over an already-connected ACP connection:
 *
 *   initialize → newSession → enforceModel(setSessionConfigOption) → prompt
 *
 * The connection seam is `AcpConnectionLike` — the same seam backend.ts drives —
 * so the sameness gate runs this function over a recording fake with zero
 * launch/IO coupling.
 */
export async function driveProbeTurn(connection: AcpConnectionLike, params: ProbeTurnParams): Promise<ProbeTurnResult> {
	const t = params.timeouts ?? PROBE_PHASE_TIMEOUTS;
	const log = params.log;

	await runPhase("initialize", PROBE_EVENTS.initializeStart, PROBE_EVENTS.initializeEnd, log, t.initializeMs, () =>
		connection.initialize({
			protocolVersion: PROTOCOL_VERSION,
			clientCapabilities: {},
			clientInfo: { name: "entwurf", version: "s2d" },
		}),
	);

	// _meta + wire servers exactly as backend.ts assembles them (S2g / carrier-less shape): the
	// injected production buildSessionMeta (omitted key when undefined) + the
	// injected production envelope enrichment over the resolved config.
	const sessionMeta = params.adapter.buildSessionMeta(
		{ modelId: params.modelId, nativeModelId: params.nativeModelId, config: params.config },
		params.carrier,
	);
	const wireMcpServers = params.enrichMcpServers(params.config.mcpServers, {
		modelId: params.modelId,
		piSessionId: process.env.PI_SESSION_ID?.trim() || undefined,
	});
	const newSessionArgs =
		sessionMeta === undefined
			? { cwd: params.cwd, mcpServers: wireMcpServers }
			: { cwd: params.cwd, mcpServers: wireMcpServers, _meta: sessionMeta };

	const created = await runPhase(
		"newSession",
		PROBE_EVENTS.newSessionStart,
		PROBE_EVENTS.newSessionEnd,
		log,
		t.newSessionMs,
		() => connection.newSession(newSessionArgs),
	);
	const acpSessionId = created?.sessionId;
	if (!acpSessionId) {
		throw new ProbePhaseError("newSession", new Error("newSession returned no sessionId"), false);
	}

	await runPhase("enforceModel", PROBE_EVENTS.setModelStart, PROBE_EVENTS.setModelEnd, log, t.setModelMs, () =>
		params.adapter.enforceModel({
			connection,
			acpSessionId,
			modelId: params.modelId,
			nativeModelId: params.nativeModelId,
		}),
	);

	// The horizon below bounds THIS MEASUREMENT RUN, not the turn: production has
	// no prompt deadline, so an expiry here is an inconclusive observation.
	const promptObservationMs = params.promptObservationMs ?? PROBE_PROMPT_OBSERVATION_MS;
	const promptResult = await runPhase(
		"prompt",
		PROBE_EVENTS.promptStart,
		PROBE_EVENTS.promptEnd,
		log,
		promptObservationMs,
		() =>
			connection.prompt({
				sessionId: acpSessionId,
				prompt: [{ type: "text", text: params.promptText }],
			}),
	);

	return { acpSessionId, stopReason: promptResult?.stopReason };
}
