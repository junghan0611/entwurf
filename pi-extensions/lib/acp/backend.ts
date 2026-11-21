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
//     session holds no history); `reuse` sends only the user messages after the last
//     assistant (the live ACP session already remembers the prior turns — re-sending the whole
//     transcript would duplicate history). buildAcpPrompt() owns that split.
//   - lifecyclePolicy (does the child outlive the turn): `process-scoped`
//     (`--entwurf-control` resident) MAY keep the child + connection in an
//     in-memory map and reuse it; `turn-scoped` (an explicit `pi -p` / json
//     one-shot) is ALWAYS `new` + teardown — a surviving child's stdio handle
//     would pin a one-shot pi's exit (the S2c hang). A plain interactive or RPC
//     pi without the flag is `unhosted`: its ACP turn stops (#171 decision 18).
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
// CRITICAL — mutable activePromptHandler routing: a retained ACP connection
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
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { Readable, Writable } from "node:stream";
import { isDeepStrictEqual } from "node:util";
import { ndJsonStream, PROTOCOL_VERSION } from "@agentclientprotocol/sdk";
import type { Api, AssistantMessage, Model, SimpleStreamOptions, TranscriptContext } from "@earendil-works/pi-ai";
import {
	appendAssistantMessageDiagnostic,
	createAssistantMessageDiagnostic,
	createAssistantMessageEventStream,
	getCurrentSystemPrompt,
	getCurrentTools,
} from "@earendil-works/pi-ai";
import { type AcpSessionReader, readAcpHostFacts, readAcpSessionReader } from "../acp-host-facts.js";
import type { AcpSteerEffect, AcpSteerSeamV1 } from "../acp-steer-seam.js";
import {
	type AcpClientHandlers,
	type AcpConnectionLike,
	type AcpPromptResponse,
	connectAcpClient,
	requestAcpSteer,
} from "./acp-client.js";
import { prependNewPromptAugment } from "./augment.js";
import {
	ACP_PROMPT_REJECTION_DIAGNOSTIC,
	ACP_SUMMARY_TURN_UNSUPPORTED,
	type AcpAgentFacts,
	type AcpBackendAdapter,
	type AcpOverlayResult,
	type AcpSummaryTurnMode,
	assertSupportedDeclaredBackend,
	readAgentFacts,
	resolveAcpBackendAdapter,
} from "./backend-adapter.js";
import { ACP_TURN_ID_PREFIX, reuseBranchVerdict } from "./branch-gate.js";
import {
	AcpCompactionCollector,
	type AcpCompactionRecord,
	type AcpCompactionStatus,
	isCompactCommand,
} from "./compaction-record.js";
import {
	enrichMcpServersWithEnvelope,
	mcpServerNames,
	type ResolvedAcpConfig,
	resolveProviderConfig,
} from "./config.js";
import {
	type AcpTextBlock,
	buildAcpPrompt,
	latestUserDelta,
	separateTextBlocks,
	textInputBlocks,
	userDeltaRange,
} from "./context.js";
import {
	type AcpPiStreamState,
	applyAcpSessionUpdate,
	createAcpStreamState,
	finalizeAcpStreamState,
	pushAcpLifecycleNotice,
	pushPermissionNotice,
} from "./event-mapper.js";
import {
	type BootstrapDecision,
	type BootstrapParams,
	bridgeConfigSignature,
	buildSessionRecord,
	contextMessageSignatures,
	decideBootstrap,
	deleteSessionRecord,
	type ExistingSession,
	type HostLifecycle,
	type PendingDispatch,
	readSessionRecord,
	resolveLifecyclePolicy,
	sessionRecordPath,
	standingRecordVerdict,
	writeSessionRecord,
} from "./session-store.js";
import { ACP_STOPS, type AcpStopId, acpStopExitNotice } from "./stop-texts.js";
import { assertExcludeToolsHonored, isPiSummaryRequest } from "./tool-surface.js";

// Bootstrap boundaries ONLY. initialize / newSession / set-model are handshake
// steps that make no model progress, so a stuck one is a dead session and a cold
// retry costs nothing — a wall-clock bound is honest there.
//
// There is deliberately NO prompt boundary. A running turn is not a failure for
// having taken long: tool use, reasoning, and provider queueing all legitimately
// outlive any number we could pick, and the previous 600s absolute cutoff killed
// turns that were still actively producing tool calls. Worse, the cutoff's own
// message ("prompt timed out after 600000ms") lands inside pi's transient-error
// dictionary (`RETRYABLE_PROVIDER_ERROR_PATTERN` in @earendil-works/pi-ai
// `utils/retry.ts` matches `timed? out` / `timeout`), so pi replayed the SAME
// full prompt from a cold ACP session up to `retry.maxRetries` times — paying the
// whole turn again to arrive at the same wall. Elapsed time is not evidence.
// A prompt now ends only on lifecycle events: it resolves, the operator aborts,
// or the child dies / its stdio ends (see awaitAcpPromptTurn).
const INITIALIZE_TIMEOUT_MS = 30_000;
const NEW_SESSION_TIMEOUT_MS = 30_000;
const SET_MODEL_TIMEOUT_MS = 30_000;

// Bounded CLEANUP window after a user abort — not a turn deadline. On abort we
// send the ACP `session/cancel` notification and give the agent this long to
// answer the pending prompt with `cancelled` (the protocol's own ending, which
// maps to aborted). Only if it does not do so within the window do we escalate
// to process-group teardown, so an abort always returns promptly.
const ABORT_CANCEL_GRACE_MS = 5_000;

/** Tokens below which a re-billed prefix is breakpoint granularity, not news.
 *  This matches pi's token threshold for a native cache-miss notice, which also
 *  considers a separate $0.10 cost threshold (read at pi-coding-agent
 *  `dist/modes/interactive/interactive-mode.js:3130`). */
const CACHE_MISS_NOTICE_FLOOR_TOKENS = 20_000;

/** ONE turn's ACCOUNTING totals: the SUM over that turn's API round trips, as
 *  ACP reports them. Carried on `usage.acp`, never on pi's four `Usage` fields —
 *  those mean one REQUEST's prompt shape to readers that would misread a sum
 *  (see `sealTurnUsage`). This is the vendor's own arithmetic, relayed. */
interface AcpTurnAccounting {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
}

function finiteOrZero(value: unknown): number {
	return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

/**
 * ONE turn's ACCOUNTING totals, preferring the widest scope the backend offers.
 *
 * `_meta.quota.model_usage` comes from `result.modelUsage` and the vendor calls it
 * "the accounting-grade figure per the SDK" — it also counts Task subagents,
 * sidechains, and INTERNAL CALLS SUCH AS COMPACTION, so its rows "can total more
 * than `token_count`" and are "the fuller picture, not a decomposition of it"
 * (read at claude-agent-acp 0.79.0 `dist/acp-agent.js:6551-6571`). The narrower
 * `PromptResponse.usage` (== `quota.token_count`) is the MAIN AGENT LOOP only.
 *
 * The wider one is the right numerator because the denominator already has that
 * scope: `usage.cost.total` is the diff of the backend's running total, which
 * includes those internal calls. Pairing a main-loop token sum with an
 * all-inclusive cost understates the cache-effect badge exactly when compaction
 * ran — and compaction is a live path again (#94). Rows are summed because a
 * session may in principle report more than one model; with GLG's single-model
 * rule there is exactly one.
 *
 * Falls back to `usage` when the sidecar is absent: `_meta` is a standard ACP
 * extension slot whose contents a client may not assume, and `quota` is not in
 * claude-agent-acp's exported types (#96 carries the re-measure-on-bump duty).
 */
function readTurnAccounting(promptResult: AcpPromptResponse): AcpTurnAccounting | undefined {
	const rows = promptResult?._meta?.quota?.model_usage;
	if (Array.isArray(rows) && rows.length > 0) {
		const total = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
		for (const row of rows) {
			const t = row?.token_count;
			if (!t) continue;
			total.input += finiteOrZero(t.inputTokens);
			total.output += finiteOrZero(t.outputTokens);
			total.cacheRead += finiteOrZero(t.cachedInputTokens);
			total.cacheWrite += finiteOrZero(t.cachedWriteTokens);
		}
		return total;
	}
	const wire = promptResult?.usage;
	if (!wire) return undefined;
	return {
		input: finiteOrZero(wire.inputTokens),
		output: finiteOrZero(wire.outputTokens),
		cacheRead: finiteOrZero(wire.cachedReadTokens),
		cacheWrite: finiteOrZero(wire.cachedWriteTokens),
	};
}

/**
 * The MAIN AGENT LOOP's token totals (`PromptResponse.usage` ==
 * `quota.token_count`). Same four fields as `readTurnAccounting`, different
 * scope: this excludes Task subagents, sidechains, and internal calls such
 * as compaction. The cache-miss bound's recurrence is a MAIN-LOOP identity
 * — occupancy is main-context occupancy — so its IO terms come from here,
 * never from the wide rows. Reporting still uses `readTurnAccounting`.
 */
function readMainLoopAccounting(promptResult: AcpPromptResponse): AcpTurnAccounting | undefined {
	const wire = promptResult?.usage;
	if (!wire) return undefined;
	return {
		input: finiteOrZero(wire.inputTokens),
		output: finiteOrZero(wire.outputTokens),
		cacheRead: finiteOrZero(wire.cachedReadTokens),
		cacheWrite: finiteOrZero(wire.cachedWriteTokens),
	};
}

/** 191,971 → "192k". Keeps the notice inside the 80-char fragment cap. */
function formatTokenCount(tokens: number): string {
	return tokens >= 1000 ? `${Math.round(tokens / 1000)}k` : String(Math.round(tokens));
}

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
	stderr: {
		on(event: "data", listener: (chunk: Buffer) => void): void;
		/** Optional: absent on minimal fakes; the flush is best-effort, never load-bearing for liveness. */
		once?(event: "close", listener: () => void): void;
		destroy(): void;
		unref?(): void;
	};
	kill(signal?: NodeJS.Signals | number): boolean;
	unref(): void;
	once(event: "exit" | "error", listener: (...args: unknown[]) => void): void;
}

// AcpConnectionLike / AcpClientHandlers (the connection seam the backend drives
// and the gate fakes) now live in ./acp-client.ts alongside the connectAcpClient
// factory that builds the real one — imported above.

/** Backend dependencies — defaulted to the real implementations, faked in gates. */
export interface AcpTurnDeps {
	spawnChild(launch: { command: string; args: string[] }, cwd: string, extraEnv: Record<string, string>): AcpChildLike;
	createConnection(child: AcpChildLike, handlers: AcpClientHandlers): AcpConnectionLike;
	lifecyclePolicy(): HostLifecycle;
	/** #171 step 8: the Pi session this process runs, read-only; `undefined` when none was reported. */
	sessionReader(): AcpSessionReader | undefined;
	/** Resolve operator provider config (S2g). Real impl reads global+project settings.
	 *  Takes the already-routed `adapter` (resolved once at turn entry) so the backend
	 *  can parse its OWN settings without config.ts re-routing — the model id stays the
	 *  single routing authority. */
	loadConfig(cwd: string, modelId: string, adapter: AcpBackendAdapter): ResolvedAcpConfig;
	now(): string;
	/** Record dir override (tests). Defaults to the real session cache dir. */
	sessionDir?: string;
	/**
	 * Post-abort cleanup grace (gates). Defaults to ABORT_CANCEL_GRACE_MS. This is
	 * the ONLY injectable clock left on the turn path and it bounds cleanup after
	 * an abort — never a running prompt.
	 */
	abortGraceMs?: number;
	/** Bound for waiting on summary-child exit before cleaning its isolated root (#168 S3). */
	childExitTimeoutMs?: number;
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

/**
 * A one-shot latch for "the child has ended", created at spawn and settled by
 * `onChildGone`. `settled` answers the question with no waiting at all; the
 * promise is only for the bounded post-mortem window (settleChildEnd).
 */
interface ChildEndLatch {
	settled: boolean;
	promise: Promise<void>;
	/** Called exactly once by onChildGone; cleared so a second end is a no-op. */
	settle?: () => void;
}

function makeChildEndLatch(): ChildEndLatch {
	let settle!: () => void;
	const promise = new Promise<void>((resolve) => {
		settle = resolve;
	});
	const latch: ChildEndLatch = {
		settled: false,
		promise,
		settle: () => {
			latch.settled = true;
			latch.settle = undefined;
			settle();
		},
	};
	return latch;
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
	/** #171 step 8: the turn id (`responseId`) of the last turn this session sealed; the branch gate
	 *  allows a reuse turn only when that exact answer is the last one on Pi's branch. */
	sealedTurnId?: string;
	/** The backend thinking value the driver last read back on this session (#142); a fact about the
	 *  live session, never part of the reuse signature. Undefined until one is set. */
	thinkingValue?: string;
	alive: boolean;
	busy: boolean;
	/** #163 S7: the adapter advertised `_meta.steering.supported === true` at initialize. */
	steeringSupported?: boolean;
	/** #171 L1: what this child answered `initialize` with, read once after admission. A fact about
	 *  the child, never part of the reuse signature; L8 decides attach from it after initialize. */
	agentFacts?: AcpAgentFacts;
	/** Mutable per-turn router — see the CRITICAL note in the file header. */
	activePromptHandler?: (event: AcpBridgeEvent) => void;
	/**
	 * The child's own dying words, SESSION-scoped on purpose. The stderr drain is
	 * installed once at spawn; keeping the buffer on the turn that spawned would
	 * leave every later reuse turn reporting a bare "ACP connection closed" with
	 * nothing to diagnose it by (observed 2026-07-30 on a live sonnet reuse turn).
	 */
	stderrTail: string[];
	/**
	 * SESSION-scoped like `stderrTail`, and for the same reason: the launcher's
	 * frame can arrive on a turn later than the one that spawned the child.
	 */
	launchObservation: AcpLaunchObservation;
	/** How the child ended, once it has — folded into the prompt-phase error. */
	exit?: { code: number | null; signal: NodeJS.Signals | null };
	/**
	 * LATCH for the child's end, readable at ANY time — deliberately not a
	 * callback.
	 *
	 * `notifyChildGone` lives only between the two lines of
	 * `awaitAcpPromptTurn`'s try/finally, so it can carry the exit status only
	 * when the child's `exit` event wins the race against the transport — and on
	 * the shape this backend actually runs, it does not. With piped stdio on
	 * Linux the child's stdout EOF was measured landing about a millisecond BEFORE
	 * node emits `exit`, for a clean exit and for SIGKILL alike (issue #72). The
	 * SDK's generic "ACP connection closed" therefore settles the race first,
	 * `finally` clears the callback, and the exit status arriving one tick later
	 * has nowhere to go — which is how #72's field sample reached the operator
	 * naming neither exit code nor signal. The opposite order stays possible and
	 * is still handled (notifyChildGone), so both are covered by the gate.
	 *
	 * The latch outlives the race: `settled` is the durable fact and `promise`
	 * lets a failing turn wait a BOUNDED moment for a late end (settleChildEnd).
	 */
	childEnd: ChildEndLatch;
	/** Set while a prompt is in flight so a child death can close it (awaitAcpPromptTurn). */
	notifyChildGone?: (err: Error) => void;
	/**
	 * The SDK's last-observed SESSION-CUMULATIVE cost, in USD — the baseline the
	 * NEXT turn's cost is differenced against — authoritative for this rail in
	 * the sense that the backend's own estimate outranks any local recompute,
	 * not in the sense of a billing statement (#93).
	 *
	 * BRIDGE-SESSION SCOPED, and that scope is the invariant. It must track the
	 * live child, because the cumulative it measures is that child's own running
	 * total and restarts at zero with a new one: a rebuilt session (config-signature
	 * drift) gets a fresh object and therefore a fresh baseline, which is exactly
	 * right. Hoisting this to the pi session would keep a dead child's total as the
	 * baseline and make the next real turn's diff enormous or negative.
	 *
	 * `undefined` = no cumulative observed yet, which is NOT the same as 0: a turn
	 * that reports no cost must HOLD this value, not zero it, or the amount it
	 * carried would be double-counted by the next diff.
	 */
	sdkCumulativeCostUsd?: number;
	/**
	 * The last observed context OCCUPANCY (`usage_update.used`), carried forward
	 * across a turn whose notification never arrived (#93).
	 *
	 * Without this, such a turn carries accounting at `usage.acp` but has zero
	 * `totalTokens` and zero pi-native usage fields. pi's
	 * `calculateContextTokens` (read at pi-coding-agent
	 * `dist/core/compaction/compaction.js:86-88`) then returns 0, making
	 * auto-compaction replace the vendor observation with its local estimate
	 * (read at pi-coding-agent `dist/core/agent-session.js:1696-1699`). Carrying
	 * the last measurement preserves the last known occupancy. Assigned, never
	 * summed.
	 */
	contextOccupancyTokens?: number;
	/**
	 * The PREVIOUS turn's MAIN-LOOP `Σinput + Σoutput` (`PromptResponse.usage`,
	 * never the wide `model_usage` sum) and the wall-clock ms at which that
	 * turn SEALED. The idle gap is then measured from that seal to THIS turn's
	 * START (`turnStartedAtMs`), never to its seal, so a turn's own duration can
	 * never inflate the gap it reports. Together with `contextOccupancyTokens`,
	 * they are the whole input to the cache-miss bound in `sealTurnUsage` — no
	 * per-round-trip collection.
	 *
	 * Why these two and nothing else: within one turn Claude Code's cache
	 * breakpoints make `cacheRead_i = cacheRead_(i-1) + cacheWrite_(i-1)`
	 * (re-measured 2026-09-02 across the WHOLE ACP overlay corpus, not one ledger:
	 * 2,398 of 2,410 adjacent pairs hold — 99.50% — over 30+ session transcripts
	 * under `~/.pi/agent/claude-config-overlay/projects` spanning 2026-05 to
	 * 2026-09. On the incident ledger alone it is 101 of 102, and that single break
	 * IS the miss: cacheRead 0 against a predicted 195,177 at 2026-09-01T21:15:09Z.
	 * Of the 12 corpus-wide breaks, 10 fall BELOW prediction — each one a real miss
	 * or partial re-read — and the 2 that exceed it do so by 4,357 and 3,283 tokens,
	 * both far under the notice floor, so neither could lift a quiet turn over the
	 * threshold on its own). Telescoping that identity gives
	 *
	 *     cacheRead_first = used_end − ΣcacheWrite − (input_last + output_last)
	 *
	 * and the same identity on the previous turn gives what THIS turn's first
	 * request would have read had the cache still been warm:
	 *
	 *     expected = used_prev − (input_last' + output_last')
	 *
	 * Only the LAST request's input+output is unknown at turn scope, and it is
	 * bounded by the turn's own sums — so both quantities come out as PROVEN
	 * INTERVALS, never estimates. Assigned, never summed.
	 */
	priorTurnInputOutputSum?: number;
	priorTurnSealedAtMs?: number;
	/**
	 * This TURN owns reporting the child's end, so the next turn must not also
	 * announce it. Raised at the top of a failure path — BEFORE the bounded
	 * settle and before any teardown — so an end observed during that window is
	 * still a natural one (we have not signalled anything yet) but is reported
	 * exactly once, by the turn that failed on it.
	 */
	reporting?: boolean;
	/**
	 * We are tearing this child down ON PURPOSE (turn-scoped teardown, config
	 * drift, error/abort cleanup). Its exit is then expected, not news: without
	 * this flag every ordinary turn-scoped turn would announce its own routine
	 * teardown to the NEXT turn as if the session had died.
	 */
	retiring?: boolean;
}

const bridgeSessions = new Map<string, BridgeSession>();

/**
 * #163 S7: the busy-steer windows, keyed like `bridgeSessions` (`pi:<id>`) but kept apart from it.
 * `bridgeSessions` is the REUSE authority and a NEW turn enters it only on success, so a NEW turn's
 * prompt would be unreachable there. A window is open exactly while a prompt is on the wire
 * (`awaitAcpPromptTurn`, which every path — new, rebuild, reuse — goes through), carries the
 * connection and ACP session it was opened with, and is removed only by the turn that opened it.
 */
export interface AcpSteerWindow {
	connection: AcpConnectionLike;
	acpSessionId: string;
	steering: boolean;
}
const steerWindows = new Map<string, AcpSteerWindow & { owner: symbol }>();

/** Open a window for `key`; the returned close removes it only while it is still this one's. */
export function openAcpSteerWindow(key: string, window: AcpSteerWindow): () => void {
	const owner = Symbol("acp-steer-window");
	steerWindows.set(key, { ...window, owner });
	return () => {
		if (steerWindows.get(key)?.owner === owner) steerWindows.delete(key);
	};
}

/** Read `_meta.steering.supported === true` from an initialize answer. Anything else is unsupported. */
export function readSteeringSupported(initializeAnswer: unknown): boolean {
	const meta = (initializeAnswer as { _meta?: { steering?: { supported?: unknown } } } | null | undefined)?._meta;
	return meta?.steering?.supported === true;
}

/**
 * Steer the busy ACP turn of Pi session `piSessionId` (#163 S7). Sends at most ONE request, on the
 * window's own connection and ACP session — never a replacement child, never a retry — and never
 * cancels or tears down the running prompt. The control socket reaches this through the
 * `acp-steer-seam`.
 */
export async function steerBusyAcpSession(
	piSessionId: string,
	text: string,
	timeoutMs?: number,
): Promise<AcpSteerEffect> {
	const window = steerWindows.get(`pi:${piSessionId}`);
	if (!window) return { effect: "not-sent", reason: "no-busy-window" };
	if (!window.steering) return { effect: "not-sent", reason: "steering-unsupported" };
	if (!window.connection.steer) return { effect: "not-sent", reason: "no-steer-method" };
	const r = await requestAcpSteer(window.connection, window.acpSessionId, text, timeoutMs);
	switch (r.kind) {
		case "injected":
			return { effect: "injected" };
		case "promptRequired":
			return { effect: "prompt-required" };
		case "unrecognized":
			return { effect: "unknown", reason: "answer-unrecognized", detail: r.detail };
		case "timeout":
			return { effect: "unknown", reason: "timeout", detail: r.detail };
		case "request-rejected":
			return { effect: "unknown", reason: "request-rejected", detail: r.detail };
		case "connection-closed":
			return { effect: "unknown", reason: "connection-closed", detail: r.detail };
	}
}

/** This backend module's one steer seam object; the provider registers it (acp-steer-seam). */
export const ACP_STEER_SEAM: AcpSteerSeamV1 = Object.freeze({
	version: 1 as const,
	steerBusy: (piSessionId: string, text: string) => steerBusyAcpSession(piSessionId, text),
	hasOpenWindow: () => steerWindows.size > 0,
});

/**
 * #163 S8: compaction records waiting for their prompt's `message_end`, by session key. Backend
 * memory only — nothing rides the assistant message. The provider takes (and so drains) them.
 */
interface DroppedCompaction {
	compactionId: string;
	status: AcpCompactionStatus;
}
const compactionStore = new Map<string, { records: AcpCompactionRecord[]; dropped: DroppedCompaction[] }>();

function compactionEntryOf(key: string) {
	let entry = compactionStore.get(key);
	if (!entry) {
		entry = { records: [], dropped: [] };
		compactionStore.set(key, entry);
	}
	return entry;
}

/** Keep a finished prompt's records for its `message_end`. */
export function depositAcpCompactionRecords(key: string, records: AcpCompactionRecord[]): void {
	if (records.length === 0) return;
	compactionEntryOf(key).records.push(...records);
}

/**
 * Drop records no `message_end` took. Said at once on stderr, never with the summary; the UI hears
 * of it only through a later take of the SAME key (`droppedBefore`) — a key never reopened leaves
 * this stderr line as the only trace (S8 v5.2 §1).
 */
function discardStrandedCompactionRecords(key: string): void {
	const entry = compactionStore.get(key);
	if (!entry || entry.records.length === 0) return;
	const dropped = entry.records.map((r) => ({ compactionId: r.compactionId, status: r.status }));
	entry.records = [];
	entry.dropped.push(...dropped);
	process.stderr.write(
		`[acp] dropped ${dropped.length} compaction record(s) for ${key.slice(0, 40)}: ${dropped
			.map((d) => `${d.compactionId.slice(0, 8)}/${d.status}`)
			.join(", ")}\n`,
	);
}

/** #171 L1: the `initialize` facts of the live ACP child kept for Pi session `piSessionId`, if any. */
export function readAcpAgentFacts(piSessionId: string): AcpAgentFacts | undefined {
	return bridgeSessions.get(`pi:${piSessionId}`)?.agentFacts;
}

/** Take (and drain) the records and the drop notices of a Pi session. Empty means no compaction. */
export function takeAcpCompactionRecords(piSessionId: string): {
	records: AcpCompactionRecord[];
	droppedBefore: DroppedCompaction[];
} {
	const key = `pi:${piSessionId}`;
	const entry = compactionStore.get(key);
	compactionStore.delete(key);
	return { records: entry?.records ?? [], droppedBefore: entry?.dropped ?? [] };
}
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
/**
 * Close a retained session we are leaving on purpose: mark it retiring (so its exit is not
 * announced as an unexpected end), drop it from the map, and tear its child down.
 */
function abandonRetainedSession(session: BridgeSession): void {
	session.alive = false;
	session.retiring = true;
	if (bridgeSessions.get(session.key) === session) bridgeSessions.delete(session.key);
	retainedChildren.delete(session.child);
	session.connection.close?.();
	teardownChild(session.child);
}

/**
 * #163, GLG 2026-11-14: after a successful Pi compaction the retained Claude child of that Pi
 * session is closed at once, not kept until the next turn's prefix break discards it. The next
 * turn then opens a new child from Pi's compacted transcript (summary + kept tail) — the path
 * `decideBootstrap` already takes when the stored prefix no longer matches.
 *
 * Keyed exactly as an ordinary turn keys its session: Pi passes its session manager's id as the
 * stream `sessionId` (pi-coding-agent 1.5.2 `dist/core/sdk.js:276`), and `resolveSessionKey`
 * turns that into `pi:<id>`. A busy or in-flight session is left alone — Pi aborts the running
 * turn before compacting (`dist/core/agent-session.js:2327`), so a busy one is not the session
 * that compaction left behind, and the prefix break still covers it. Returns whether a child
 * was closed.
 */
export function closeRetainedAcpSession(piSessionId: string): boolean {
	const key = `pi:${piSessionId}`;
	const session = bridgeSessions.get(key);
	if (!session || session.busy || inFlightKeys.has(key)) return false;
	abandonRetainedSession(session);
	return true;
}

function registerGlobalCleanup(): void {
	if (cleanupRegistered) return;
	cleanupRegistered = true;
	process.once("exit", () => {
		for (const child of retainedChildren) killChildGroup(child, "SIGKILL");
	});
}

/**
 * The child died: mark dead + drop from map + retained set, RECORD how it ended,
 * and close any prompt that was waiting on it. Without that last step a
 * mid-prompt death is only observable through the SDK's generic "ACP connection
 * closed" rejection, which names neither the exit status nor the stderr.
 */
function onChildGone(session: BridgeSession, exit?: { code: number | null; signal: NodeJS.Signals | null }): void {
	session.alive = false;
	if (exit) session.exit = exit;
	if (bridgeSessions.get(session.key) === session) bridgeSessions.delete(session.key);
	retainedChildren.delete(session.child);
	// Close the latch FIRST and unconditionally: it is the durable fact, and a
	// failing turn may already be waiting on it inside its bounded settle window.
	session.childEnd.settle?.();
	if (session.notifyChildGone) {
		// A turn was waiting on this child — it reports the death itself.
		session.notifyChildGone(childEndedError(session));
	} else if (!session.retiring && !session.reporting) {
		// Died BETWEEN turns with no turn to fail and nobody tearing it down, so
		// nobody has seen it. Without this the next turn would silently open a
		// fresh child and read as an ordinary cold start, hiding that the backend
		// session the operator was talking to is gone. A DELIBERATE teardown is
		// excluded — announcing our own routine cleanup would be noise, not news.
		unreportedChildEnds.set(session.key, session.exit ?? { code: null, signal: null });
	}
}

/** Deaths no turn observed, keyed by sessionKey and announced once by the next turn. */
const unreportedChildEnds = new Map<string, { code: number | null; signal: NodeJS.Signals | null }>();

/** Read-and-clear: an unreported death is announced exactly once. */
function takeUnreportedChildEnd(
	sessionKey: string,
): { code: number | null; signal: NodeJS.Signals | null } | undefined {
	const end = unreportedChildEnds.get(sessionKey);
	if (end) unreportedChildEnds.delete(sessionKey);
	return end;
}

/** "exit code 1" / "signal SIGKILL" / "exit code 0, signal SIGTERM" / "no exit status". */
function describeChildEnd(exit?: { code: number | null; signal: NodeJS.Signals | null }): string {
	if (!exit) return "no exit status";
	const parts = [
		exit.code !== null ? `exit code ${exit.code}` : undefined,
		exit.signal ? `signal ${exit.signal}` : undefined,
	].filter(Boolean);
	return parts.length > 0 ? parts.join(", ") : "no exit status";
}

/**
 * The prompt-phase error for a child that died under a live turn.
 *
 * Wording is load-bearing: pi classifies a failed assistant message by matching
 * its errorMessage against `RETRYABLE_PROVIDER_ERROR_PATTERN`, so anything we
 * author here that reads like "timed out" / "timeout" / "terminated" /
 * "connection lost" would put a full cold prompt replay back on the table. This
 * text names the lifecycle fact and nothing that looks transient.
 * (The appended backend stderr tail is the child's text, not ours.)
 */
function childEndedError(session: BridgeSession): Error {
	return new Error(
		`entwurf: the ACP backend process ended while the prompt was still in flight (${describeChildEnd(session.exit)}) — ` +
			"this turn has no answer",
	);
}

/**
 * The BOUNDED post-mortem window a turn that ALREADY failed may wait for the
 * child's exit status.
 *
 * This is NOT a prompt deadline and must never become one: nothing here can end
 * a running turn. It opens only after the prompt has already settled as a
 * transport closure, and it closes on the child's own `exit` — which follows the
 * stdout EOF by about a millisecond, so this is headroom, not a felt wait.
 */
const CHILD_END_SETTLE_MS = 500;

/**
 * The SDK's exact words for "the transport ended under a pending request"
 * (`@agentclientprotocol/sdk` jsonrpc.js / acp.js:
 * `closeSignal.reason ?? new Error("ACP connection closed")`).
 *
 * Matched EXACTLY, not by substring: this text appears only when the close
 * carried NO reason — a clean stdout EOF rather than an errored stream — which
 * is the one failure shape that arrives with no lifecycle facts of its own. A
 * close that DID carry a reason already explains itself and must not be given a
 * settle delay, and our own `childEndedError` already names the exit status.
 * Widening this to a substring test would put that delay on errors that do not
 * need it.
 */
const ACP_CONNECTION_CLOSED_TEXT = "ACP connection closed";

/**
 * The launcher's control frame — see `claude-acp-launch.js`.
 *
 * Matched as an EXACT FULL LINE and nothing else. The vendor writes prose that
 * mentions signals; a substring test would let vendor text manufacture an
 * entwurf observation, which is precisely the confusion #72 cost three
 * diagnosis passes. Our own frame is a fixed enum, so exact-line matching is
 * sufficient AND necessary.
 */
const LAUNCH_SIGNAL_FRAME_PREFIX = "ENTWURF_ACP_LAUNCH_SIGNAL=";
const LAUNCH_SIGNAL_FRAME_VALUES: ReadonlySet<string> = new Set(["SIGTERM", "SIGINT"]);

/** A mutable, session-scoped record of a terminating signal the LAUNCHER caught. */
export type AcpLaunchObservation = { signal?: "SIGTERM" | "SIGINT" };

/**
 * Split a stderr chunk stream into lines, consuming our own frames and passing
 * everything else through to the tail untouched.
 *
 * Line-buffered because a chunk boundary can fall inside a frame; the trailing
 * partial line is held, not emitted, so a frame split across two reads is still
 * recognised exactly.
 */
function makeLaunchFrameFilter(observation: AcpLaunchObservation, onText: (text: string) => void) {
	let held = "";
	return {
		write(chunk: string): void {
			held += chunk;
			let nl = held.indexOf("\n");
			let passed = "";
			while (nl !== -1) {
				const line = held.slice(0, nl);
				if (
					line.startsWith(LAUNCH_SIGNAL_FRAME_PREFIX) &&
					LAUNCH_SIGNAL_FRAME_VALUES.has(line.slice(LAUNCH_SIGNAL_FRAME_PREFIX.length))
				) {
					// FIRST caught signal wins: a later one is our own teardown racing
					// the external kill, and reporting that would bury the cause.
					observation.signal ??= line.slice(LAUNCH_SIGNAL_FRAME_PREFIX.length) as "SIGTERM" | "SIGINT";
				} else {
					passed += `${line}\n`;
				}
				held = held.slice(nl + 1);
				nl = held.indexOf("\n");
			}
			if (passed) onText(passed);
		},
		/**
		 * The child's LAST words may arrive without a trailing newline — a process
		 * dying mid-write is exactly when that happens, and it is exactly when the
		 * tail matters most. Line buffering would otherwise hold that fragment
		 * forever, so the stream's close flushes it VERBATIM.
		 *
		 * No frame check here, deliberately: the launcher writes its frame with a
		 * single `writeSync` including the newline, well under PIPE_BUF, so a
		 * complete frame can never be the un-terminated remainder. Anything left
		 * without a newline is vendor text by construction.
		 */
		flush(): void {
			if (!held) return;
			onText(held);
			held = "";
		},
	};
}

/**
 * What the operator is told about a caught signal — and what they are NOT told.
 *
 * Absence is reported as "not observed", never as "no signal": the launcher can
 * only see what reached it, and an override launch (`CLAUDE_AGENT_ACP_COMMAND`)
 * has no launcher at all. Attribution of the SENDER is not claimed here either —
 * that needs the host's journal, which this process cannot read.
 */
function launchSignalLine(observation: AcpLaunchObservation | undefined): string | undefined {
	if (!observation?.signal) return undefined;
	return `[acp] launch observed ${observation.signal} before child exit (sender not attributed)`;
}

function isAcpConnectionClosure(err: unknown): boolean {
	const message = err instanceof Error ? err.message : typeof err === "string" ? err : "";
	return message.trim() === ACP_CONNECTION_CLOSED_TEXT;
}

/**
 * Wait a BOUNDED moment for a child end that the transport already implied.
 *
 * Resolves immediately when the latch is already closed (the common case once
 * the ~1ms gap has passed) and never rejects. The timer is deliberately NOT
 * unref'd: it is the only thing that ends this wait, so letting the loop drain
 * past it would leave a failing turn unsealed — the opposite of the honesty this
 * exists for. It is cleared on both exits, so it holds nothing open.
 */
async function settleChildEnd(latch: ChildEndLatch, ms: number): Promise<void> {
	if (latch.settled) return;
	let timer: ReturnType<typeof setTimeout> | undefined;
	try {
		await Promise.race([
			latch.promise,
			new Promise<void>((resolve) => {
				timer = setTimeout(resolve, ms);
			}),
		]);
	} finally {
		if (timer) clearTimeout(timer);
	}
}

/**
 * The lifecycle line appended to a transport-closure failure, so the operator
 * reads WHICH phase died and HOW the child ended.
 *
 * Wording is load-bearing for the same reason `childEndedError`'s is: pi
 * classifies a failed assistant message against `RETRYABLE_PROVIDER_ERROR_PATTERN`
 * (@earendil-works/pi-ai `utils/retry`), whose terms include "timed out",
 * "timeout", "terminated", "connection lost" and "ended without". None of those
 * may appear here, or a dead child would put a full cold prompt replay back on
 * the table — with the tool side effects this turn already produced.
 *
 * That pattern is a substring alternation (`new RegExp(terms.join("|"), "i")` — NO word
 * boundaries on its word terms). Through pi-ai 1.3 its HTTP status terms ("429", "500",
 * "502", "503", "504", "520", "524") were bare substrings too, and rendering
 * CHILD_END_SETTLE_MS made this line say "within 500ms", which pi read as an HTTP 500 and
 * classified as transient. pi-ai 1.4 bounds only those status terms (upstream #11057), so
 * "500ms" no longer matches; the word terms above are still unbounded. The settle bound
 * stays deliberately NOT interpolated: naming the window in prose keeps a later change of
 * that constant, or of the classifier, from silently re-arming the replay — do not
 * "improve" this by putting the number back; the bound belongs in the code and the gate.
 *
 * The three endings are kept DISTINCT on purpose (issue #72 Done-when): an
 * exit code, a signal, and "we waited and it never said" are three different
 * facts, and collapsing them is what made the original sample unreadable.
 */
function childEndLifecycleLine(opts: {
	/** "pre-prompt" covers a new turn's bootstrap AND a reuse turn's pre-send steps. */
	phase: "pre-prompt" | "prompt";
	exit?: { code: number | null; signal: NodeJS.Signals | null };
	ended: boolean;
}): string {
	const where =
		opts.phase === "prompt"
			? "the ACP backend connection closed while the prompt was still in flight"
			: "the ACP backend connection closed before this turn's prompt was sent";
	const how = opts.ended
		? `the child ended (${describeChildEnd(opts.exit)})`
		: "the child reported no exit status within the bounded post-mortem window";
	return `[acp] lifecycle: ${where} — ${how}; this turn has no answer`;
}

/**
 * The failure path's post-mortem: enrich ONLY the transport-closure shape, and
 * only after waiting a bounded moment for the exit status the close implies.
 *
 * Returns `undefined` for every other failure — an abort, a bootstrap throw, or
 * a child death our own `notifyChildGone` already diagnosed — so no other error
 * pays a delay and none is double-reported.
 *
 * Callers MUST run this BEFORE tearing the child down: our teardown SIGTERMs the
 * process group, so an exit read after it would be OUR signal recorded as the
 * child's cause of death.
 *
 * The stderr claim is deliberately NARROW. Running before teardown means the tail
 * already collected is not cut short by our own cleanup, and stderr arriving
 * during this window still lands in it. It does NOT promise the child's last
 * words: node's `exit` can precede the stdio drain, and nothing here waits for
 * the stderr pipe to close. Draining it is a separate lever, not this one.
 */
async function diagnoseTransportClosure(opts: {
	err: unknown;
	session: BridgeSession | undefined;
	phase: "pre-prompt" | "prompt";
	aborted: boolean;
}): Promise<string | undefined> {
	if (opts.aborted || !opts.session) return undefined;
	if (!isAcpConnectionClosure(opts.err)) return undefined;
	const session = opts.session;
	// This turn owns the announcement from here on, so the next turn must not
	// repeat it. Raised BEFORE the wait and before any signal of ours, so an end
	// observed inside the window is still a natural one.
	session.reporting = true;
	await settleChildEnd(session.childEnd, CHILD_END_SETTLE_MS);
	return childEndLifecycleLine({
		phase: opts.phase,
		exit: session.exit,
		ended: session.childEnd.settled,
	});
}

// ---------------------------------------------------------------------------
// timeout / launch / permission / stopReason / teardown helpers
// ---------------------------------------------------------------------------

// Race a BOOTSTRAP phase against its timeout, ALWAYS clearing the timer
// afterwards. A naive `Promise.race([p, sleep(ms)])` leaves the timer pending
// when `p` wins — a dangling timer that keeps pi's event loop alive long after
// the turn, so pi would never exit a `-p` run. clearTimeout in finally fixes it.
// Only initialize / newSession / set-model use this; the prompt has no deadline.
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

// Reject as soon as the operator aborts, so a pre-prompt step on a LIVE session
// (reuse has no bootstrap child to tear down) settles on the abort instead of on
// the driver's answer or the bootstrap timeout. The step itself is abandoned, not
// cancelled: the caller drops the session, since what the driver now holds is
// unknown (#142, Dot review of the reuse effort set).
function untilAborted<T>(p: Promise<T>, signal: AbortSignal | undefined): Promise<T> {
	if (!signal) return p;
	let onAbort: (() => void) | undefined;
	const aborted = new Promise<never>((_, reject) => {
		onAbort = () => reject(new Error("entwurf: aborted by the operator before the prompt was sent"));
		if (signal.aborted) onAbort();
		else signal.addEventListener("abort", onAbort, { once: true });
	});
	return Promise.race([p, aborted]).finally(() => {
		if (onAbort) signal.removeEventListener("abort", onAbort);
	});
}

// What an operator who pressed ESC needs before speaking again (#142): the turn
// has stopped, nothing already done was undone, and whether the next message
// continues this live ACP session or opens a new one. Said only after the turn
// settled, and only about the live session — not about any private transcript.
export const ACP_CANCEL_KEPT_NOTICE = "stopped — changes already made stay; next message continues this session";
export const ACP_CANCEL_CLOSED_NOTICE = "stopped — changes already made stay; next message opens a new session";
/** #171 step 8: an abort before a reuse turn's prompt went out. Nothing ran and the live session is kept. */
export const ACP_CANCEL_UNSENT_NOTICE = "stopped before the prompt was sent — nothing ran; the ACP session is kept";
export const ACP_RECORD_DEGRADED_NOTICE = "session record not saved — future continuation may require a new session";
// #171 L16 — the dispatch marker. Pi's retry classifier reads `errorMessage` alone, and a retried turn after a
// stop would be an automatic send, so these error texts are fixed and carry no number, id or path (a bare
// 500 or 503 there reads as transient). The range and the store's code ride the notices and stderr instead.
export const ACP_DISPATCH_STOP_MESSAGE =
	"entwurf: the last prompt to this ACP session has no sealed answer, so nothing was sent this turn";
// Decision 17: a stop never asks the operator to remove a record — deleting it can erase the only binding.
export const ACP_RECORD_UNREADABLE_MESSAGE = ACP_STOPS.unreadable.text;
export const ACP_DISPATCH_MARKER_NOT_SAVED =
	"entwurf: the dispatch marker was not saved, so nothing was sent this turn";
export const ACP_RECORD_DROPPED_NOTICE = "session record dropped — the next turn starts a new session";
export const ACP_RECORD_NOT_DROPPED_NOTICE = "session record not dropped — the next turn stops again";
/** #163: Pi's summary turn ended as `cancelled` with no abort from Pi. Kept non-transient for pi's retry classifier. */
export const ACP_SUMMARY_CANCELLED_MESSAGE =
	"ACP backend ended the summary turn as cancelled although Pi did not abort it; the summary is incomplete and is not kept";

/**
 * Await ONE ACP prompt with NO wall-clock deadline — the turn ends on lifecycle
 * events only. Shared by the new and the reuse turn so both close the same way.
 *
 * The three endings:
 *
 *   resolve      the agent answered `session/prompt` (any stopReason — the
 *                verdict mapping is the caller's job).
 *   child gone   the child exited or its stdio ended. Both are already fatal to
 *                the request — the SDK rejects every pending response when the
 *                read loop hits EOF — but the SDK's own error says only "ACP
 *                connection closed". `notifyChildGone` gets there first with the
 *                exit status, and the caller appends the session stderr tail.
 *   abort        the operator cancelled. We send ACP `session/cancel` and let
 *                the agent end its own turn (`cancelled` → aborted). Escalation
 *                to process-group teardown happens only after a bounded grace,
 *                and closing the connection rejects the pending request, so an
 *                abort is always answered even against a wedged child.
 *
 * A stalled-but-alive child is deliberately NOT an ending: a silent turn is not
 * a failed turn, and nothing here may kill one for being quiet.
 */
async function awaitAcpPromptTurn(
	session: BridgeSession,
	promptArgs: { sessionId: string; prompt: AcpTextBlock[] },
	opts: { signal?: AbortSignal; graceMs: number; onWindow?: (open: boolean) => void },
): Promise<AcpPromptResponse> {
	let rejectLifecycle: ((err: Error) => void) | undefined;
	const lifecycle = new Promise<never>((_, reject) => {
		rejectLifecycle = reject;
	});
	// The race's loser stays pending forever when the prompt wins; a rejection
	// nobody observed would surface as an unhandled rejection at that point.
	lifecycle.catch(() => {});

	let graceTimer: ReturnType<typeof setTimeout> | undefined;
	const escalateAbort = (): void => {
		killChildGroup(session.child, "SIGTERM");
		// Closing rejects the still-pending ACP request, so the await below settles
		// even when the child ignores both the cancel notification and the signal.
		session.connection.close?.(new Error("entwurf: ACP prompt cancelled by the operator"));
		rejectLifecycle?.(new Error("entwurf: the ACP prompt was cancelled by the operator"));
	};
	const onAbort = (): void => {
		try {
			session.connection.cancel?.({ sessionId: promptArgs.sessionId });
		} catch {
			// best-effort: escalation below is what guarantees the abort returns.
		}
		// NOT unref'd, deliberately. This timer is the only thing that finishes an
		// abort against an agent that ignores session/cancel, so letting the event
		// loop drain past it would leave the turn unsettled and the child alive.
		// It is bounded (graceMs) and cleared in the finally below, so the worst it
		// can do is hold an exiting process for that grace — which is the cleanup
		// we asked for.
		graceTimer = setTimeout(escalateAbort, opts.graceMs);
	};

	session.notifyChildGone = (err) => rejectLifecycle?.(err);
	const signal = opts.signal;
	if (signal) {
		if (signal.aborted) onAbort();
		else signal.addEventListener("abort", onAbort, { once: true });
	}

	// #163 S7: the prompt is on the wire from here — a remote steer may reach this turn until it ends.
	const closeSteerWindow = openAcpSteerWindow(session.key, {
		connection: session.connection,
		acpSessionId: promptArgs.sessionId,
		steering: session.steeringSupported === true,
	});
	// #163 S8: the same window bounds what counts as THIS prompt's compaction. A record of an
	// earlier prompt still here was never taken by a message_end, so it is dropped (and said so).
	discardStrandedCompactionRecords(session.key);
	opts.onWindow?.(true);
	try {
		return await Promise.race([session.connection.prompt(promptArgs), lifecycle]);
	} finally {
		opts.onWindow?.(false);
		closeSteerWindow();
		if (graceTimer) clearTimeout(graceTimer);
		signal?.removeEventListener("abort", onAbort);
		session.notifyChildGone = undefined;
	}
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

/** Verdict for one ACP prompt result — what pi should report, and why. */
export type AcpStopVerdict = {
	stopReason: AssistantMessage["stopReason"];
	/** The raw ACP reason, preserved whenever the wire carried one. */
	rawStopReason?: string;
	/** Set exactly when `stopReason` is "error" — carries the reason into the UI. */
	errorMessage?: string;
};

/**
 * ACP prompt stopReason → pi verdict.
 *
 * The ACP terminal set is closed (`@agentclientprotocol/sdk` 1.4.0
 * `dist/schema/types.gen.d.ts:3001`): end_turn | max_tokens | max_turn_requests |
 * refusal | cancelled — no `| string` arm. 1.4.0 also ships an OPEN union at
 * `dist/v2/schema/types.gen.d.ts:3607`, but that is behind the `./experimental/v2`
 * export and entwurf imports the bare specifier, which resolves to the closed v1
 * surface. Only three of those are successful or benign ends. The previous
 * implementation returned a bare StopReason with `default: "stop"`, which turned
 * `refusal`, `max_turn_requests`, any future member, AND a missing reason into a
 * clean successful turn — pi then rendered a silently truncated answer as if the
 * model had finished. pi 0.83 closed the same hole in its own providers (#7272:
 * unmapped terminal reasons surface as provider errors, never successful stops)
 * and added `rawStopReason` so the wire value survives the mapping. This mirrors
 * that contract rather than inventing a local one.
 */
export function mapPromptStopReason(stopReason: string | undefined): AcpStopVerdict {
	switch (stopReason) {
		case "end_turn":
			return { stopReason: "stop", rawStopReason: stopReason };
		case "max_tokens":
			return { stopReason: "length", rawStopReason: stopReason };
		case "cancelled":
			return { stopReason: "aborted", rawStopReason: stopReason };
		case "refusal":
			return {
				stopReason: "error",
				rawStopReason: stopReason,
				errorMessage: "ACP backend stopped with: refusal (the model declined to answer; the turn is incomplete)",
			};
		case "max_turn_requests":
			return {
				stopReason: "error",
				rawStopReason: stopReason,
				errorMessage:
					"ACP backend stopped with: max_turn_requests (the backend's per-turn request budget was exhausted; the turn is incomplete)",
			};
		case undefined:
			return {
				stopReason: "error",
				errorMessage: "ACP backend ended the turn without a stop reason",
			};
		default:
			return {
				stopReason: "error",
				rawStopReason: stopReason,
				errorMessage: `ACP backend stopped with an unrecognized reason: ${stopReason}`,
			};
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

/** Explicit summary-turn modes accepted by the common dispatch (#168 S1). */
export const ALLOWED_SUMMARY_TURN_MODES: readonly AcpSummaryTurnMode[] = ["toolless", "execution-denied"];

/** Wait up to `timeoutMs` for `child` to exit so isolated summary cleanup never runs on a live child (#168 S3).
 *  3_000 ms exceeds `teardownChild`'s 2_000 ms SIGTERM→SIGKILL grace so a slow child settles before cleanup checks it (O4). */
async function waitForChildExit(child: AcpChildLike, timeoutMs = 3_000): Promise<boolean> {
	if (child.exitCode !== null || child.signalCode !== null) return true;
	return await new Promise<boolean>((resolve) => {
		let settled = false;
		const finish = (exited: boolean) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			resolve(exited);
		};
		const timer = setTimeout(() => {
			finish(child.exitCode !== null || child.signalCode !== null);
		}, timeoutMs);
		timer.unref?.();
		child.once("exit", () => finish(true));
	});
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

/** #171 L18: the prompt as it goes on the wire — separated where the backend joins its blocks. */
function wireTextBlocks(blocks: AcpTextBlock[], adapter: AcpBackendAdapter): AcpTextBlock[] {
	return adapter.textBlockSeparator === undefined ? blocks : separateTextBlocks(blocks, adapter.textBlockSeparator);
}

/** Default (production) dependencies — real spawn + real ACP client connection. */
function defaultDeps(): AcpTurnDeps {
	return {
		spawnChild: (launch, cwd, extraEnv) =>
			spawn(launch.command, launch.args, {
				cwd,
				env: { ...process.env, ...extraEnv },
				stdio: ["pipe", "pipe", "pipe"],
				// Own process group so teardown can signal the claude grandchild too.
				detached: true,
			}) as unknown as AcpChildLike,
		createConnection: (child, handlers) => {
			const real = child as unknown as StdioChild;
			const stdoutWeb = Readable.toWeb(real.stdout) as unknown as ReadableStream<Uint8Array>;
			const stdinWeb = Writable.toWeb(real.stdin) as unknown as WritableStream<Uint8Array>;
			const transport = ndJsonStream(stdinWeb, stdoutWeb);
			return connectAcpClient(transport as unknown as Parameters<typeof connectAcpClient>[0], handlers);
		},
		// #171 decision 18: from the facts the control extension and the provider entry reported, not argv.
		lifecyclePolicy: () => resolveLifecyclePolicy(readAcpHostFacts()),
		sessionReader: () => readAcpSessionReader(),
		loadConfig: (cwd, modelId, adapter) => resolveProviderConfig({ cwd, modelId, adapter }),
		now: () => new Date().toISOString(),
	};
}

/** sessionKey: options.sessionId, else PI_SESSION_ID, else a cwd fallback (GPT ②). */
function resolveSessionKey(opts: { sessionId?: string } | undefined, cwd: string): string {
	const sid = opts?.sessionId?.trim() || process.env.PI_SESSION_ID?.trim();
	return sid ? `pi:${sid}` : `cwd:${cwd}`;
}

/** The errno code of a store failure, or UNKNOWN — never a message, which could carry a path or text. */
function storeErrorCode(error: unknown): string {
	return error &&
		typeof error === "object" &&
		"code" in error &&
		typeof error.code === "string" &&
		/^E[A-Z0-9_]+$/.test(error.code)
		? error.code
		: "UNKNOWN";
}

/** Write this session's record atomically: sealed (`pendingDispatch: null`) or carrying a marker. Throws. */
function writeRecordFor(session: BridgeSession, deps: AcpTurnDeps, pendingDispatch: PendingDispatch | null): void {
	const record = buildSessionRecord(
		{
			sessionKey: session.key,
			acpSessionId: session.acpSessionId,
			cwd: session.cwd,
			modelId: session.modelId,
			bridgeConfigSignature: session.bridgeConfigSignature,
			contextMessageSignatures: session.contextMessageSignatures,
			pendingDispatch,
		},
		deps.now(),
	);
	writeSessionRecord(record, deps.sessionDir);
}

/**
 * Best-effort persistence; a false result must be surfaced before the turn is sealed. This is the
 * sealing write, so it also clears the dispatch marker (#171 L16 rule 2). It must stay before the
 * seal: a clear that ran after the caller was released could erase the next turn's marker.
 */
function persistRecord(session: BridgeSession, deps: AcpTurnDeps): boolean {
	try {
		writeRecordFor(session, deps, null);
		return true;
	} catch (error) {
		process.stderr.write(`[acp] session record persist failed: code=${storeErrorCode(error)}\n`);
		return false;
	}
}

/**
 * #171 L16: a store failure before anything is sent, as the turn seals it and as the operator reads it.
 * Pi's retry classifier reads `errorMessage` alone, and an errno code can read as transient there
 * (EAI_AGAIN, ENOTFOUND), so the sealed text is the fixed `message` whatever the code; the code rides
 * the notice, and stderr.
 */
export function acpStoreRefusal(message: string, what: string, code: string): { errorMessage: string; notice: string } {
	return { errorMessage: message, notice: `${what} (code=${code})` };
}

/** #171 L16: drop the record after a stop. Returns the failure code, or undefined once it is gone. */
function dropRecord(sessionKey: string, deps: AcpTurnDeps): string | undefined {
	try {
		deleteSessionRecord(sessionKey, deps.sessionDir);
		return undefined;
	} catch (error) {
		const code = storeErrorCode(error);
		process.stderr.write(`[acp] session record drop failed: code=${code}\n`);
		return code;
	}
}

/** The range a marker names, as positions and a count over its own context — never the text (#171 L16). */
export function describeDispatchRange(marker: PendingDispatch): string {
	return `messages [${marker.start},${marker.start + marker.count}) of ${marker.contextMessageSignatures.length}`;
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
 * pi 0.84 streamSimple hook contract (#63; upstream pi-mono #7372 → doc-only PR
 * #7576): implementations must invoke `options.onPayload` before sending the
 * provider request and use any returned replacement.
 *
 * On this rail the provider request is the ACP `session/prompt` params — so the
 * hook receives the EXACT `{sessionId, prompt}` object after the wire content is
 * fully built (augment / reuse delta included) and immediately before
 * `connection.prompt`. That is the truthful analogue of the built-in providers'
 * post-build/pre-send boundary. Replacement is honored fail-closed, never
 * silently: the effective payload — the replacement, or `params` itself when the
 * hook returned nothing and may have mutated it — must be a non-null, non-array
 * object, keep the `sessionId` captured before the hook ran, and carry a
 * non-empty prompt array. It is a detached copy, so a hook that changes its
 * object afterwards changes nothing that is sent — prompt rewriting is
 * upstream-granted power, but entwurf cannot truthfully deliver to an ACP
 * session it did not open, and an emptied prompt would undo this rail's own
 * non-empty-prompt invariant; either refuses the turn before the wire.
 *
 * `options.onResponse` is an EXPLICIT LOCAL NON-HTTP EXEMPTION and is never
 * invoked anywhere on this rail: pi hard-types it as HTTP `{status, headers}`
 * (and the `after_provider_response` extension event re-emits exactly that), and
 * ACP's terminal result arrives only AFTER the session-update body was already
 * consumed — both the shape and the "before consuming its body" ordering are
 * unmappable, so any call would fabricate HTTP evidence that does not exist.
 * The absence is pinned behaviorally by check-acp-stream-hooks.
 */
async function applyProviderPayloadHook<T extends { sessionId: string; prompt: AcpTextBlock[] }>(
	options: SimpleStreamOptions | undefined,
	params: T,
	model: Model<Api>,
	/** #171 step 8: a resident's prompt is what the session record accounts for, so no hook may change it. */
	resident: boolean,
): Promise<T> {
	const onPayload = options?.onPayload;
	if (!onPayload) return params;
	// Taken BEFORE the hook runs: a hook may mutate `params` in place and return nothing.
	const sessionId = params.sessionId;
	const sent = resident ? { sessionId, prompt: structuredClone(params.prompt) } : undefined;
	const replacement = await onPayload(params, model);
	// Detached at once: the hook keeps its own object and may change it later, after these checks and
	// before the caller resumes. What is checked below is what is sent.
	const effective: unknown = structuredClone(replacement === undefined ? params : replacement);
	if (typeof effective !== "object" || effective === null || Array.isArray(effective)) {
		throw new Error(
			"entwurf: before_provider_request returned a non-object replacement — the ACP prompt payload must stay a non-null, non-array object",
		);
	}
	if ((effective as { sessionId?: unknown }).sessionId !== sessionId) {
		throw new Error(
			"entwurf: before_provider_request changed the ACP sessionId — entwurf cannot truthfully deliver to a session it did not bootstrap; prompt rewriting is allowed, session identity is not",
		);
	}
	const effectivePrompt = (effective as { prompt?: unknown }).prompt;
	if (!Array.isArray(effectivePrompt) || effectivePrompt.length === 0) {
		throw new Error(
			"entwurf: before_provider_request returned a replacement without a non-empty prompt array — an empty ACP prompt cannot be sent",
		);
	}
	if (sent && !isDeepStrictEqual(effective, sent))
		throw new AcpStopSignal("hook", "a provider hook changed the prompt");
	return effective as T;
}

/** #171 step 8: a named stop raised inside a turn; the catch shows its cause and its way out. */
class AcpStopSignal extends Error {
	readonly stop: AcpStopId;
	readonly why: string;
	constructor(stop: AcpStopId, why: string) {
		super(ACP_STOPS[stop].text);
		this.name = "AcpStopSignal";
		this.stop = stop;
		this.why = why;
	}
}

/**
 * streamSimple for the entwurf provider. Returns the event stream
 * synchronously and drives the ACP turn on a microtask.
 */
export function streamShellAcp(
	model: Model<Api>,
	context: TranscriptContext,
	options?: SimpleStreamOptions,
): ReturnType<typeof createAssistantMessageEventStream> {
	return streamAcpTurn(model, context, options, defaultDeps());
}

/** The seam-aware turn driver. `streamShellAcp` calls this with the real deps. */
export function streamAcpTurn(
	model: Model<Api>,
	context: TranscriptContext,
	options: SimpleStreamOptions | undefined,
	deps: AcpTurnDeps,
): ReturnType<typeof createAssistantMessageEventStream> {
	const stream = createAssistantMessageEventStream();
	// When THIS turn began. The idle gap that expires a prompt cache is the time
	// between turns, so it must be measured to a turn's START — measuring to its
	// seal would fold this turn's own duration into the gap and call a 58-minute
	// pause plus a 4-minute turn "62m idle", which crosses the 1h TTL in the
	// report while nothing crossed it in fact. pi's native detector uses message
	// timestamps for the same reason (read at pi-coding-agent
	// `dist/core/cache-stats.js:14-37`, `idleMs`).
	const turnStartedAtMs = Date.now();
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
	// #171 step 8: this turn's id rides its final assistant message, sealed or not. Pi stores that message
	// whole, so the branch gate can tell this answer from any other entry with the same text.
	const turnId = `${ACP_TURN_ID_PREFIX}${randomUUID()}`;
	state.output.responseId = turnId;
	// Read once, synchronously: the session whose prompt this call is.
	const piSession = deps.sessionReader();
	/** #163: this turn is Pi's one-shot summary request (set by runSummaryTurn). */
	let summaryTurnActive = false;

	/** #163 S8: the session key this turn's prompt window ran under (set when it opens). */
	let compactionKey: string | undefined;
	/** #163 S8: the prompt window opens and closes this turn's compaction collector. */
	function compactionWindow(session: BridgeSession): (open: boolean) => void {
		return (open) => {
			if (!open) {
				if (state.compaction) state.compaction.windowOpen = false;
				return;
			}
			compactionKey = session.key;
			const delta = latestUserDelta(context);
			state.compaction = new AcpCompactionCollector({
				// Scope is decided HERE, at collection (S8 v5.1 §3): Pi's summary turn and a key with no
				// Pi session (`cwd:`) record nothing, so nothing of theirs waits in backend memory.
				collect: !summaryTurnActive && session.key.startsWith("pi:"),
				// Claude ACP reads a command from the first text block (claude-agent-acp 0.109.0 prompt-to-claude.js:31,36-39,
				// v1/acp-agent.js:1147,1152-1153). #171 U14: /compact as the first of two blocks gave 0 compactions on 0.107.3,
				// 0.109.0 and agy 1.5.13 (step-7 continuity-claude-20261121T064907Z, -T070856Z, continuity-agy-20261121T071729Z).
				promptWasCompactCommand: isCompactCommand(delta[0]?.text),
				carried: session.contextOccupancyTokens,
				now: Date.now,
				emitLine: (text) => pushAcpLifecycleNotice(state, text),
			});
			state.compaction.windowOpen = true;
		};
	}
	/** #163 S8: set once this turn's records were deposited (a seal followed by a catch is two calls). */
	let compactionDeposited = false;
	/** #163 S8: after finalize — keep this prompt's records for its message_end, report what was not kept. */
	function depositCompaction(): void {
		if (compactionDeposited) return;
		compactionDeposited = true;
		const fenced = state.compactionFencedOut ?? 0;
		if (fenced > 0) {
			process.stderr.write(`[acp] ignored ${fenced} compaction update(s) outside the prompt window\n`);
		}
		const collector = state.compaction;
		if (!collector || !compactionKey) return;
		if (!collector.collect) {
			if (collector.observedCount > 0) {
				process.stderr.write(
					`[acp] ${collector.observedCount} compaction(s) not recorded: outside the record's scope\n`,
				);
			}
			return;
		}
		depositAcpCompactionRecords(compactionKey, state.compactionRecords ?? []);
	}

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

	/**
	 * Seal this turn's ACCOUNTING — the #93 authority boundary.
	 *
	 * Runs ONLY for a backend whose adapter declares `sealsTurnAccounting`. Flag
	 * absence means that backend's usage semantics were never measured, so nothing
	 * is sealed and its emitted usage is whatever the common mapper produced —
	 * unchanged, not guessed at.
	 *
	 * Two INDEPENDENT axes, because they arrive on different wires:
	 *
	 *   tokens  the turn aggregate, relayed from PromptResponse on `usage.acp`.
	 *   cost    an ADJACENT DIFF of the backend's own running session total, which
	 *           arrives on `usage_update` and is captured raw by the mapper.
	 *
	 * The diff is what makes the session sum reproduce the backend's own running
	 * total exactly — with no residue, which is what the gate measures. Read that
	 * exactness for what it is: agreement with the BACKEND'S CUMULATIVE ESTIMATE,
	 * never with an Anthropic invoice. The vendor calls `total_cost_usd` a
	 * "Cumulative estimated cost" and "An estimate, not a billing statement"
	 * (claude-agent-sdk `sdk.d.ts:4884`), and entwurf has measured no live
	 * comparison against a bill.
	 *
	 * We prefer that estimate anyway for a STRUCTURAL reason, not because it is
	 * more precise in general: it is computed UPSTREAM of a lossy flattening we
	 * cannot undo. The observed cache-writes are entirely 1h, ACP carries no 1h
	 * field, and pi prices a write with no `cacheWrite1h` at the 5m rate (read at
	 * pi-coding-agent `dist/bundle/chunks/bedrock-converse-stream.js`,
	 * `calculateCost`) — a local recompute measured $1.66 low on one live
	 * ledger. Nothing here calls calculateCost: any price table we could apply
	 * runs DOWNSTREAM of that flattening, so it would be a second, wronger
	 * source.
	 */
	function sealTurnUsage(adapter: AcpBackendAdapter, session: BridgeSession, promptResult: AcpPromptResponse): void {
		if (!adapter.sealsTurnAccounting) return;

		// --- the turn's ACCOUNTING aggregate, verbatim ------------------------
		// ACP reports one number set per turn and it is the SUM OVER THAT TURN'S API
		// ROUND TRIPS. It is carried on its OWN key, never on pi's four, because
		// those four mean ONE REQUEST's prompt shape to two readers that never go
		// through `calculateContextTokens` and so cannot be rescued by an honest
		// `totalTokens` (isContextOverflow, read at pi-ai
		// `dist/utils/overflow.js:132-145`; cache-stats.detectMiss, read at
		// pi-coding-agent `dist/core/cache-stats.js:14-37`). Projecting the
		// aggregate onto them compacted a live 223,516-token session on a 1,000,000
		// window (measured 2026-09-01).
		//
		// Nothing is computed here: these are the vendor's own four numbers, put
		// somewhere they cannot be mistaken for a per-request reading. pi stores an
		// assistant message as JSON and reads it back the same way (read at
		// pi-coding-agent `dist/core/session-manager.js:768-777` appendMessage,
		// `:98` parseSessionEntries), so a key pi does not know survives a resume.
		const aggregate = readTurnAccounting(promptResult);
		const mainLoop = readMainLoopAccounting(promptResult);
		if (aggregate) {
			(state.output.usage as unknown as { acp?: AcpTurnAccounting }).acp = aggregate;
		}

		// --- token axis: DELIBERATELY UNWRITTEN ------------------------------
		// The four token fields stay at their zero initialisation. ACP's only token
		// carrier is `PromptResponse.usage`, and that is the SUM OVER THIS TURN'S
		// API ROUND TRIPS — measured 2026-09-02 on one 21-round-trip turn whose
		// overlay rows summed to exactly the four numbers ACP reported
		// (cacheRead 4,185,084) while the context it occupied was 223,516.
		//
		// pi reads these four as ONE REQUEST's prompt shape, in two places that do
		// NOT go through `calculateContextTokens` and so cannot be rescued by the
		// honest `totalTokens` written below:
		//
		//   isContextOverflow  `input + cacheRead > contextWindow` (read at pi-ai
		//                      `dist/utils/overflow.js:132-145`). The aggregate made
		//                      that true at 223k of a 1M window and compacted a live
		//                      session — the defect this seal now refuses to feed.
		//   detectMiss         `input + cacheRead + cacheWrite` vs the previous
		//                      request (read at pi-coding-agent
		//                      `dist/core/cache-stats.js:14-37`). Under the aggregate
		//                      it invented two phantom misses and SILENCED the real
		//                      195,177-token one after a 401-minute idle gap.
		//
		// Writing zeros is not a placeholder for a better number we could compute:
		// the per-request partition is genuinely absent from the wire. The vendor
		// builds it in `lastAssistantUsage` and sends only its scalar sum (read at
		// claude-agent-acp 0.79.0 `dist/acp-agent.js:3920-3945`) — #96.
		//
		// But silence is NOT the resting state. A cache miss the operator never sees
		// is a false reading, not a modest one: a session can run for hours believing
		// its badge while a full prefix rewrite has already been paid for. So the
		// aggregate rides its own key above, and the bound below reports the rewrite.

		// --- context occupancy (NOT a turn total — see the field's note) -----
		// Refresh from THIS turn's notification when there was one, then assign the
		// session's value UNCONDITIONALLY. The assignment is not conditional on the
		// notification having been missing: on this path the seal — not the mapper —
		// is the authority for what pi reads as occupancy, and when a fresh value did
		// arrive the two agree by construction.
		//
		// Why the field must be right rather than merely non-zero: pi's auto-compaction
		// takes `calculateContextTokens(message.usage)` at face value and falls back to
		// its own estimate ONLY when the message errored or that value is exactly 0
		// (read at pi-coding-agent `dist/core/agent-session.js:1696-1697`). A turn
		// aggregate written here would be non-zero and therefore never corrected — the
		// session would read as nearly empty all the way to an overflow.
		const priorOccupancy = session.contextOccupancyTokens;
		const priorIoSum = session.priorTurnInputOutputSum;
		const priorSealedAtMs = session.priorTurnSealedAtMs;

		const occupancy = state.observedContextOccupancyTokens;
		if (typeof occupancy === "number") session.contextOccupancyTokens = occupancy;
		if (typeof session.contextOccupancyTokens === "number") {
			state.output.usage.totalTokens = session.contextOccupancyTokens;
		}

		// --- cache-miss bound (the rewrite the operator must not miss) -------
		// Both quantities below are PROVEN INTERVALS derived from numbers already in
		// hand, not estimates. See `priorTurnInputOutputSum` for the identity and its
		// telescoping. Only the LAST request's input+output is unknown at turn scope,
		// and each turn's own sums bound it:
		//
		//   cacheRead_first ≤ used_end − ΣcacheWrite                     (upper)
		//   expected        ≥ used_prev − (Σinput' + Σoutput')           (lower)
		//   miss            ≥ expected_lower − cacheRead_first_upper
		//
		// The interval is proven only while the within-turn recurrence holds, and that
		// recurrence is an OBSERVED property of Claude Code's breakpoint placement
		// (measured 2026-09-02 corpus-wide: 2,398 of 2,410 adjacent pairs, 99.50%; see
		// `priorTurnInputOutputSum` for the full count and the break characterisation),
		// not a guarantee. If it breaks mid-turn — a 1h TTL expiring
		// between round trips, or the child compacting itself — `used_end − ΣcacheWrite`
		// goes negative and the `max(0, …)` below assumes cacheRead_first = 0. The
		// notice is still TRUE (a rewrite did happen) but its N is then a floor of a
		// weaker kind, not a telescoped bound. #96 carries that limit.
		//
		// A negative or small bound proves nothing was re-billed beyond breakpoint
		// granularity, so nothing is said. The floor is the TOKEN half of pi's own
		// native cache-miss display policy, which suppresses a notice only when the
		// miss is under 20,000 tokens AND under $0.10 (read at pi-coding-agent
		// `dist/modes/interactive/interactive-mode.js:3130`). The ACP rail borrows
		// that familiar token threshold alone and claims no part of the cost half:
		// this bound is a token interval, and pricing it locally is the very
		// downstream reprice the cost axis above refuses.
		// The re-billed size can never exceed what this turn's MAIN LOOP actually
		// WROTE: a re-billed prefix is paid for as cache creation. Clamping to
		// `mainLoop.cacheWrite` (not the wide aggregate) is what keeps the notice
		// a statement about money that changed hands on the prefix rather than
		// about the recurrence holding, or about an internal compaction write.
		//
		// Without it a context SHRINK reads as a giant miss. Worked counterexample
		// (gpt-5.6-sol, 2026-09-02): prior occupancy 200,000, prior IO 1,000, this
		// turn occupancy 20,000 with cacheWrite 1,000 — organic compaction, nothing
		// re-billed — yields 200,000 − 1,000 − 19,000 = 180,000 and would announce
		// "cache miss ≥180k" over a turn that wrote 1,000 tokens. The clamp answers
		// 1,000, which is under the floor, so nothing is said. On the real incident
		// the clamp does not bind: 191,971 ≤ cacheWrite 221,084.
		//
		// Both prior marks are read from ONE turn and written from ONE turn. Mixing
		// an older occupancy with a newer IO sum puts two turns in one equation and
		// can skew the bound HIGH, so the update below is all-or-nothing.
		//
		// The same all-or-nothing applies to SCOPE. Occupancy is main-context;
		// the recurrence is a main-loop identity. `aggregate.cacheWrite` is the
		// WIDE accounting figure (Task subagents, sidechains, internal compaction).
		// A large unrelated wide write shrinks `max(0, occupancy − cacheWrite)`
		// (less is subtracted) AND raises the `min(…, cacheWrite)` ceiling — both
		// paths push the bound UP, so a warm main prefix can announce a miss and
		// attach this turn's all-inclusive dollar figure to it. The IO terms
		// therefore come from `mainLoop`, never from `aggregate`.
		const derivable =
			mainLoop !== undefined &&
			typeof occupancy === "number" &&
			typeof priorOccupancy === "number" &&
			typeof priorIoSum === "number";
		const cacheWriteForBound = mainLoop !== undefined ? mainLoop.cacheWrite : 0;
		const rawBound = derivable
			? (priorOccupancy as number) - (priorIoSum as number) - Math.max(0, (occupancy as number) - cacheWriteForBound)
			: undefined;
		const missLowerBound = rawBound === undefined ? undefined : Math.min(rawBound, cacheWriteForBound);

		if (mainLoop && typeof occupancy === "number") {
			session.priorTurnInputOutputSum = mainLoop.input + mainLoop.output;
			session.priorTurnSealedAtMs = Date.now();
		}

		// --- cost axis ------------------------------------------------------
		// ALWAYS assigned on this path, including the 0 cases: the mapper may have
		// written the running cumulative into this field, and leaving it would put a
		// session total on a dashboard that sums per-turn costs — the whole defect.
		const observed = state.observedSessionCostUsd;
		let turnCostUsd: number | undefined;
		if (typeof observed !== "number") {
			// No cumulative arrived this turn. HOLD the baseline: this turn's real
			// amount is still inside the backend's running total and the next
			// adjacent diff absorbs it. Attributed to the wrong turn, exact in the
			// session sum. Zeroing the baseline here would double-count it instead.
			state.output.usage.cost.total = 0;
		} else {
			const diff = observed - (session.sdkCumulativeCostUsd ?? 0);
			if (diff < 0) {
				// The backend's running total went BACKWARDS. TWO receipts, and the gap
				// between them is exactly why the notice below names a MECHANISM and
				// never a cause: claude-agent-acp's `conversation_reset` handler only
				// switches the SDK to a fresh conversation and touches no cost at all
				// (read at 0.79.0 `dist/acp-agent.js:4349-4356`), while claude-agent-sdk
				// separately documents that "a mid-session /clear resets the running
				// total" (read at 0.3.274 `sdk.d.ts:5342`). A reset therefore PLAUSIBLY
				// explains a backwards total, but nothing here has MEASURED that it did,
				// and asserting the cause would be the same unmeasured claim this lane
				// exists to end.
				// Rebaseline and attribute 0 — but SAY SO. Silently absorbing it would
				// hide the one observation that can settle what a reset does to the
				// total, which is precisely the "no silent misaccounting" this lane owes.
				const detail = `${(session.sdkCumulativeCostUsd ?? 0).toFixed(6)} → ${observed.toFixed(6)} USD`;
				session.sdkCumulativeCostUsd = observed;
				state.output.usage.cost.total = 0;
				// Kept under the notice fragment cap (80) so the two numbers survive
				// verbatim — a truncated diagnostic is not evidence.
				pushAcpLifecycleNotice(state, `cost baseline reset (${detail}) — this turn attributed $0`);
				console.error(
					`entwurf: ACP backend reported a DECREASING session cost (${detail}). Rebaselined; this turn is ` +
						`attributed $0. The cause is NOT measured here. The one documented mechanism is a mid-session ` +
						`/clear, which claude-agent-sdk (sdk.d.ts:4884) says resets the running total; the adapter's ` +
						`conversation_reset event is NOT it — that handler switches conversation and touches no cost. ` +
						`The session total from here on is measured against the new baseline.`,
				);
			} else {
				session.sdkCumulativeCostUsd = observed;
				state.output.usage.cost.total = diff;
				turnCostUsd = diff;
			}
		}

		// --- report the rewrite ----------------------------------------------
		// Said LAST so it can quote what this turn actually cost. The cost is the
		// SDK's own adjacent diff, never a local repricing.
		if (typeof missLowerBound === "number" && missLowerBound >= CACHE_MISS_NOTICE_FLOOR_TOKENS) {
			// Only when there is an idle gap worth naming. A sub-minute one explains
			// nothing and "after 0m idle" reads as noise, so the clause is dropped —
			// the re-billed size and the cost still stand on their own.
			const idleMinutes =
				typeof priorSealedAtMs === "number" ? Math.round((turnStartedAtMs - priorSealedAtMs) / 60_000) : 0;
			const idle = idleMinutes >= 1 ? ` after ${idleMinutes}m idle` : "";
			const paid = typeof turnCostUsd === "number" ? ` — this turn $${turnCostUsd.toFixed(2)}` : "";
			pushAcpLifecycleNotice(state, `cache miss ≥${formatTokenCount(missLowerBound)} re-billed${idle}${paid}`);
		}
	}

	/**
	 * Seal the turn from the ACP prompt result. "Success" here means the RPC
	 * returned, not that the turn ended well — a returned `refusal` /
	 * `max_turn_requests` / unknown / absent reason is sealed as an error event,
	 * never a `done`. `rawStopReason` carries the wire value out either way.
	 */
	function finishSuccess(adapter: AcpBackendAdapter, session: BridgeSession, promptResult: AcpPromptResponse): void {
		sealTurnUsage(adapter, session, promptResult);
		finalizeAcpStreamState(state);
		depositCompaction();
		let verdict = mapPromptStopReason(promptResult?.stopReason);
		// #163: Pi keeps an `aborted` summary as a checkpoint — only `error` and `length` are refused
		// (pi-coding-agent 1.5.2 `compaction.js:454-462`). A summary the backend cancelled while
		// nobody aborted it is incomplete text, so it is sealed as an error, never stored.
		if (summaryTurnActive && verdict.stopReason === "aborted" && !signal?.aborted) {
			verdict = {
				stopReason: "error",
				rawStopReason: verdict.rawStopReason,
				errorMessage: ACP_SUMMARY_CANCELLED_MESSAGE,
			};
		}
		if (verdict.rawStopReason !== undefined) state.output.rawStopReason = verdict.rawStopReason;
		if (signal?.aborted || verdict.stopReason === "aborted") {
			state.output.stopReason = "aborted";
			stream.push({ type: "error", reason: "aborted", error: state.output });
		} else if (verdict.stopReason === "error") {
			state.output.stopReason = "error";
			state.output.errorMessage = verdict.errorMessage;
			stream.push({ type: "error", reason: "error", error: state.output });
		} else {
			state.output.stopReason = verdict.stopReason;
			stream.push({
				type: "done",
				reason: verdict.stopReason === "length" ? "length" : "stop",
				message: state.output,
			});
		}
		stream.end();
	}

	/**
	 * #171 L16 rule 1 and decision 9: the marker goes into the record immediately before `session/prompt`.
	 * It names the messages after the last assistant of this call's context; if it cannot be written, this
	 * throws before the prompt, so nothing is sent and the turn is refused with the reason.
	 */
	function markDispatch(
		session: BridgeSession,
		ctxSigs: string[],
		range: { start: number; count: number } = userDeltaRange(context),
	): PendingDispatch {
		const marker: PendingDispatch = { ...range, contextMessageSignatures: [...ctxSigs] };
		try {
			writeRecordFor(session, deps, marker);
		} catch (error) {
			const code = storeErrorCode(error);
			process.stderr.write(`[acp] dispatch marker write failed: code=${code}\n`);
			const refusal = acpStoreRefusal(ACP_DISPATCH_MARKER_NOT_SAVED, "dispatch marker not saved", code);
			pushAcpLifecycleNotice(state, refusal.notice);
			throw new Error(refusal.errorMessage);
		}
		return marker;
	}

	/** #171 step 8: the way out of a stop, as its own notice so the 80-character clip cannot cut it. */
	function pushStopExit(id: AcpStopId): void {
		const exit = acpStopExitNotice(id);
		if (exit !== null) pushAcpLifecycleNotice(state, exit);
	}

	/** #171 step 8: a named stop before anything is sent; whatever session is live stays as it is. */
	function finishStop(id: AcpStopId, cause: string): void {
		pushAcpLifecycleNotice(state, cause);
		pushStopExit(id);
		finishError(new Error(ACP_STOPS[id].text), false);
	}

	/** #171 L16: say what a drop did. A failed drop keeps the marker, so the next turn stops on it again. */
	function reportRecordDrop(failureCode: string | undefined): void {
		pushAcpLifecycleNotice(
			state,
			failureCode ? `${ACP_RECORD_NOT_DROPPED_NOTICE} (code=${failureCode})` : ACP_RECORD_DROPPED_NOTICE,
		);
	}

	/** #171 L16 stop (decision 8a, G2): name the range the marker held, then drop the record. */
	function dropAfterStop(sessionKey: string, marker: PendingDispatch): void {
		pushAcpLifecycleNotice(state, `${describeDispatchRange(marker)} may have run`);
		reportRecordDrop(dropRecord(sessionKey, deps));
	}

	/** #171 L16 G2: a turn that failed after its marker was written is a named stop; one before it ran nothing. */
	function stopAfterFailure(sessionKey: string, marker: PendingDispatch | undefined): void {
		if (marker) dropAfterStop(sessionKey, marker);
	}

	function finishError(
		err: unknown,
		aborted: boolean,
		stderrTail?: string[],
		lifecycle?: string,
		launchObservation?: AcpLaunchObservation,
		/** Passed only from the two turn catches, and only once the prompt is on the wire
		 *  (`phase === "prompt"`): a bootstrap failure ran no tool and keeps the verbatim path. */
		adapter?: AcpBackendAdapter,
	): void {
		finalizeAcpStreamState(state);
		depositCompaction();
		state.output.stopReason = aborted ? "aborted" : "error";
		const base = err instanceof Error ? err.message : String(err);
		// The FIRST failure stays first and verbatim (it is what the backend
		// actually said); the lifecycle line is added, never substituted, so a
		// reader can still match the transport's own text. One typed exception
		// below: a vendor rejection the adapter recognises keeps that verbatim text
		// as a pi diagnostic instead, because pi reads errorMessage to decide a
		// whole-prompt replay (#127).
		const withLifecycle = lifecycle ? `${base}\n${lifecycle}` : base;
		// Its OWN line, above the vendor tail: an entwurf-owned observation must not
		// have to be recovered by reading vendor prose.
		const observed = launchSignalLine(launchObservation);
		const diagnosed = observed ? `${withLifecycle}\n${observed}` : withLifecycle;
		const tail = (stderrTail ?? []).join("").trim().slice(-1_000);
		const full = tail ? `${diagnosed}\n--- backend stderr (tail) ---\n${tail}` : diagnosed;
		// A-c: a real failure (not an abort) that looks like a context-window
		// overflow gets an actionable hint appended, so "API Error" stops hiding
		// the turn-scoped full-transcript-replay cause.
		const hint = aborted ? undefined : actionableAcpBackendHint(full);
		// #127: pi's retry and overflow classifiers read `errorMessage` ALONE, and a
		// vendor's "Internal error" reads as transient — a replay of a turn whose tools
		// already ran. (Through pi-ai 1.3 a digit run in its ids/stderr did too; 1.4 bounds
		// the status terms, upstream #11057.) A rejection the adapter names gets
		// its fixed verdict there; every raw part rides one diagnostic, appended after any
		// existing ones. An abort keeps the abort path.
		const rejection = aborted ? undefined : adapter?.readPromptRejection?.(err);
		if (rejection) {
			appendAssistantMessageDiagnostic(
				state.output,
				createAssistantMessageDiagnostic(ACP_PROMPT_REJECTION_DIAGNOSTIC, err, {
					errorKind: rejection.errorKind,
					dataJson: rejection.dataJson,
					...(lifecycle ? { lifecycle } : {}),
					...(observed ? { launchSignal: observed } : {}),
					...(tail ? { stderrTail: tail } : {}),
					...(hint ? { hint } : {}),
				}),
			);
			state.output.errorMessage = rejection.verdict;
		} else {
			state.output.errorMessage = hint ? `${full}\n\n${hint}` : full;
		}
		stream.push({ type: "error", reason: aborted ? "aborted" : "error", error: state.output });
		stream.end();
	}

	queueMicrotask(async () => {
		// Operator provider config (S2g) — resolve FIRST. A config the bridge
		// cannot honor (bad mcpServers / skillPlugins / appendSystemPrompt:true /
		// strictMcpConfig:false) fails loud into the stream before any spawn. This
		// is the baseline fix: the operator's entwurfProvider.{mcpServers,
		// skillPlugins,tools,…} now actually reach the session.
		// Backend adapter — resolve ONCE at turn entry (GPT §9 / Step B). The modelId
		// prefix routes to the owning adapter; an unknown or colliding id fails loud.
		let adapter: AcpBackendAdapter;
		let nativeModelId: string;
		try {
			({ adapter, nativeModelId } = resolveAcpBackendAdapter(model.id));
		} catch (err) {
			finishError(err, false);
			return;
		}
		let config: ResolvedAcpConfig;
		try {
			config = deps.loadConfig(cwd, model.id, adapter);
		} catch (err) {
			finishError(err, false);
			return;
		}
		// settings.backend is a DIAGNOSTIC guard, never a router. The model id already
		// chose the adapter (above); if the operator ALSO declared a backend it must
		// agree, else fail loud — a mismatch means the settings and the requested model
		// disagree about which backend runs, and silently trusting the model id would
		// hide an operator typo. Routing authority stays single (the model id).
		try {
			assertSupportedDeclaredBackend(config.backend);
		} catch (err) {
			finishError(err, false);
			return;
		}
		if (config.backend !== undefined && config.backend !== adapter.backend) {
			finishError(
				new Error(
					`entwurf: entwurfProvider.backend "${config.backend}" does not match the backend that owns model ` +
						`"${model.id}" (${adapter.backend}) — the model id is the routing authority; fix or remove the backend field`,
				),
				false,
			);
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
		//
		// pi 0.86 folded `Context.systemPrompt`/`Context.tools` into a leading
		// `role:"system"` message (`normalizeContext`, pi-ai
		// `utils/transcript.ts`), so a provider only ever sees a
		// `TranscriptContext`. The active surface is therefore REPLAYED from the
		// system messages — `getCurrentTools` applies every toolsAdded/toolsRemoved
		// delta in order. No `?? [...PI_BUILTIN_BACKED_TOOLS]` fallback: under 0.86
		// the old `context.tools` read was ALWAYS undefined, so that fallback
		// silently declared the full builtin set and the truthfulness preflight
		// could never fire (false green). An empty replayed list on an ordinary turn
		// means the operator excluded everything — keep that honest and reject.
		//
		// #163: the one empty surface that is NOT refused is Pi's own summarization
		// request (`isPiSummaryRequest`). It is honoured rather than refused: the
		// summary turn below runs on a child that is given no tools at all, so the
		// declared surface (none) is the actual one.
		let summaryTurn: boolean;
		try {
			const activeToolNames = getCurrentTools(context.messages).map((t) => t.name);
			summaryTurn = isPiSummaryRequest(activeToolNames, opts?.cacheRetention);
			if (!summaryTurn) assertExcludeToolsHonored(activeToolNames, { backend: adapter.backend, tools: config.tools });
		} catch (err) {
			finishError(err, false);
			return;
		}
		if (summaryTurn) {
			// #167/#168 S1: dispatch only explicitly enumerated summary-turn modes; an absent or
			// unknown mode is refused by name before any spawn.
			const summaryMode = adapter.summaryTurnMode;
			if (!summaryMode || !ALLOWED_SUMMARY_TURN_MODES.includes(summaryMode)) {
				finishError(
					new Error(
						`entwurf: ${ACP_SUMMARY_TURN_UNSUPPORTED} — Pi asked ${model.id} for a summary, which declares no tools, ` +
							`but the ${adapter.backend} ACP backend declares no supported summaryTurnMode. ` +
							`Nothing was started. Switch this session to a Claude row to summarize; repeating this request cannot change that.`,
					),
					false,
				);
				return;
			}
			await runSummaryTurn(config, adapter, nativeModelId);
			return;
		}

		const policy = deps.lifecyclePolicy();
		if (policy === "unhosted") {
			// Decision 18: neither a resident nor an explicit one-shot. Nothing is spawned.
			pushAcpLifecycleNotice(state, "this Pi has no entwurf control and is not an explicit one-shot");
			pushStopExit("mode");
			finishError(new Error(ACP_STOPS.mode.text), false);
			return;
		}
		// #171 step 8: a resident's key is the native id of the Pi session it can read. No reader, or a
		// prompt for another session id, stops: neither the environment nor the cwd stands in for it.
		if (policy === "process-scoped" && (!piSession || piSession.getSessionId() !== opts?.sessionId?.trim())) {
			finishStop("host", piSession ? "this prompt is not for the Pi session in view" : "no Pi session reader");
			return;
		}
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
			engraving = adapter.loadCarrier({ mcpServerNames: serverNames, config });
		} catch (err) {
			finishError(err, false);
			return;
		}
		// #142: pi's thinking level → the backend's own value, resolved BEFORE any process or session is
		// touched, so an unsupported level refuses with nothing to unwind. A backend without the
		// capability (cortex) resolves nothing and keeps its old behaviour. The value is deliberately NOT
		// in the reuse signature: changing it must not trade the live Claude conversation for a new one,
		// so it is set on the live session before the prompt instead (runNewTurn / runReuseTurn).
		let thinkingValue: string | undefined;
		if (adapter.resolveThinking) {
			try {
				thinkingValue = adapter.resolveThinking({
					modelId: model.id,
					reasoning: opts?.reasoning,
					thinkingLevelMap: model.thinkingLevelMap,
				});
			} catch (err) {
				finishError(err, false);
				return;
			}
		}
		// S2g: the signature folds the FULL resolved config (mcpServersHash + tool
		// surface + skillPlugins + flags) so any operator config change invalidates
		// a reused session; the per-session envelope is excluded (runtime, not config).
		const configSig = bridgeConfigSignature({
			backend: adapter.backend,
			modelId: model.id,
			nativeModelId,
			appendSystemPrompt: engraving ?? "",
			mcpServersHash: config.mcpServersHash,
			settingSources: [...config.settingSources],
			strictMcpConfig: config.strictMcpConfig,
			tools: [...config.tools],
			skillPlugins: [...config.skillPlugins],
			permissionAllow: [...config.permissionAllow],
			disallowedTools: [...config.disallowedTools],
			extra: adapter.configSignatureFields(config.adapterSettings),
		});
		const ctxSigs = contextMessageSignatures(context);
		const params: BootstrapParams = {
			cwd,
			modelId: model.id,
			bridgeConfigSignature: configSig,
			contextMessageSignatures: ctxSigs,
			lifecyclePolicy: policy,
			messageRoles: context.messages.map((message) => message.role),
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

		// #171 L16 — reconnect. With no live session for this key, a record left by an earlier process, or by
		// an earlier turn of this one, is read for its dispatch marker only, before anything is spawned or sent.
		// Attach stays off: the record never reaches decideBootstrap below (L8 wires that). Read and drop are
		// synchronous, so nothing can claim the key in between.
		if (policy === "process-scoped" && !existing?.alive) {
			const verdict = standingRecordVerdict(readSessionRecord(sessionKey, deps.sessionDir));
			if (verdict.kind === "refuse") {
				const code = verdict.code ?? "UNKNOWN";
				process.stderr.write(
					`[acp] session record unreadable: code=${code} path=${sessionRecordPath(sessionKey, deps.sessionDir)}\n`,
				);
				const refusal = acpStoreRefusal(ACP_RECORD_UNREADABLE_MESSAGE, "session record unreadable", code);
				pushAcpLifecycleNotice(state, refusal.notice);
				pushStopExit("unreadable");
				finishError(new Error(refusal.errorMessage), false);
				return;
			}
			if (verdict.kind === "stop") {
				// Stop once (decision 8a): say what may have run, drop the record, send nothing — neither to the
				// recorded session nor to a new one. The next turn finds no record and starts a new session.
				process.stderr.write(`[acp] dispatch stop: acpSessionId=${verdict.acpSessionId}\n`);
				dropAfterStop(sessionKey, verdict.marker);
				finishError(new Error(ACP_DISPATCH_STOP_MESSAGE), false);
				return;
			}
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
			// Attach is OFF until L8: no persisted record and no resume/load
			// capability passed, so decideBootstrap returns only "new" or "reuse".
			// The record was read above for its dispatch marker only (#171 L16).
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
		// connection + child so it is not orphaned in retainedChildren (GPT blocker 2).
		if (decision.path === "new" && existing) abandonRetainedSession(existing);

		// #171 step 8: equal content is not proof. The live session is sent a delta only when the last answer
		// on Pi's branch is the exact one it sealed last; otherwise this turn stops and the session is kept.
		/** The delta a reuse turn sends and the range its marker names, fixed here and never read again. */
		let checkedReuse: { prompt: AcpTextBlock[]; range: { start: number; count: number } } | undefined;
		if (decision.path === "reuse" && existing) {
			const verdict = reuseBranchVerdict(existing.sealedTurnId, piSession?.getBranch() ?? []);
			if (!verdict.ok) {
				finishStop(verdict.stop, verdict.why);
				return;
			}
			// The delta this turn would send must be exactly the inputs the branch shows after that answer: the
			// same wire texts in the same order, rendered by the one renderer. Pi transforms the context before
			// the provider sees it; a dropped, replaced or added input stops here instead of leaving the
			// conversation without a word. Only text inputs are admitted: anything else cannot be compared.
			const delta = userDeltaRange(context);
			const tail = context.messages.slice(delta.start).filter((message) => message.role !== "system");
			const shown = textInputBlocks(verdict.inputs);
			const carried = textInputBlocks(tail.map((message) => (message as { content: unknown }).content));
			// The live ACP session already remembers the prior turns → only the user messages after the last
			// assistant are sent (re-sending the transcript would duplicate history). Built once, here.
			const prompt = buildAcpPrompt(context, "reuse");
			if (
				tail.some((message) => message.role !== "user") ||
				!shown ||
				!carried ||
				!isDeepStrictEqual(shown, carried) ||
				!isDeepStrictEqual(carried, prompt)
			) {
				finishStop("changed", "this turn's inputs are not the ones the Pi session shows after the last answer");
				return;
			}
			// Pi hands the provider its own message objects, and an extension that kept the context can change
			// one while this turn awaits the effort readback. What was just compared is what is sent and what
			// the marker names: the reuse turn takes these, and reads the context for neither again.
			checkedReuse = { prompt, range: { start: delta.start, count: delta.count } };
		}

		// Claim the key for the whole turn — atomic with the checks above (no await
		// in between), so a concurrent first turn for the same key sees it in flight
		// and fails loud (GPT blocker 1).
		inFlightKeys.add(sessionKey);
		try {
			if (decision.path === "reuse" && existing) {
				// Unreachable: the gate above either set it or ended the turn. A reuse decision without a
				// checked delta must never fall through to a new session.
				if (!checkedReuse) throw new Error("entwurf: a reuse turn has no checked delta");
				await runReuseTurn(existing, ctxSigs, adapter, thinkingValue, checkedReuse);
			} else {
				await runNewTurn(params, ctxSigs, engraving, config, adapter, nativeModelId, thinkingValue);
			}
		} finally {
			inFlightKeys.delete(sessionKey);
		}
	});

	// --- #163: Pi's summary request → a one-shot, tool-less child that is never retained
	//
	// What makes it a SUMMARY turn rather than an ordinary new one, each for a reason:
	//   - No tools, no MCP, nothing pre-approved, no skill plugins: the request declares no tools,
	//     and a summarizer that could still run Bash would act where Pi cannot see it (Pi's own
	//     "Summarization attempted to call a tool" guard reads `toolCall` blocks, which ACP tool
	//     calls never become).
	//   - No notice of any kind (`state.quiet`): Pi keeps `contentText(response.content)` as the
	//     summary, joining every text block, and that summary lands in the session file.
	//   - No first-user augment: it is operator context for a working session, not for a summary.
	//   - The operator's engraving carrier stays (identity/billing/memory containment are not a
	//     working-session feature), rendered with the empty MCP list this child really has.
	//   - Pi's summarization instructions arrive as a system message, which the transcript
	//     flattening never forwards (context.ts `case "system"`). They are relayed here, verbatim,
	//     through Pi's own renderer, as the first prompt block — for this one turn only.
	//   - Never retained and never registered: it shares no state with the conversation's session.
	//     It neither reads nor tears down `bridgeSessions`, whatever key it arrived with.
	async function runSummaryTurn(
		config: ResolvedAcpConfig,
		adapter: AcpBackendAdapter,
		nativeModelId: string,
	): Promise<void> {
		state.quiet = true;
		summaryTurnActive = true;
		const summaryConfig: ResolvedAcpConfig = {
			...config,
			tools: [],
			mcpServers: [],
			skillPlugins: [],
			permissionAllow: [],
			// Filesystem isolation: no CLAUDE.md, hooks or plugins from the operator's Claude settings —
			// the summarizer gets the carrier and Pi's instructions, nothing else (config.ts:413-420).
			settingSources: [],
		};
		let engraving: string | null;
		let thinkingValue: string | undefined;
		try {
			engraving = adapter.loadCarrier({ mcpServerNames: [], config: summaryConfig });
			if (adapter.resolveThinking) {
				thinkingValue = adapter.resolveThinking({
					modelId: model.id,
					reasoning: opts?.reasoning,
					thinkingLevelMap: model.thinkingLevelMap,
				});
			}
		} catch (err) {
			finishError(err, false);
			return;
		}
		const instructions = getCurrentSystemPrompt(context.messages).trim();
		const params: BootstrapParams = {
			cwd,
			modelId: model.id,
			bridgeConfigSignature: "",
			contextMessageSignatures: [],
			lifecyclePolicy: "turn-scoped",
			messageRoles: [],
		};
		await runNewTurn(params, [], engraving, summaryConfig, adapter, nativeModelId, thinkingValue, {
			instructions,
		});
	}

	// --- new session: spawn → initialize → newSession → setSessionConfigOption(model) → full transcript
	async function runNewTurn(
		params: BootstrapParams,
		ctxSigs: string[],
		engraving: string | null,
		config: ResolvedAcpConfig,
		adapter: AcpBackendAdapter,
		nativeModelId: string,
		thinkingValue: string | undefined,
		/** #163: set only by runSummaryTurn — relay these instructions, add no augment. */
		summary?: { instructions: string },
	): Promise<void> {
		let child: AcpChildLike | undefined;
		let session: BridgeSession | undefined;
		let onAbort: (() => void) | undefined;
		let overlay: AcpOverlayResult | undefined;
		let summarySucceeded = false;
		/** #171 L16: set once this turn's dispatch marker is in the record. */
		let marker: PendingDispatch | undefined;
		/** Which phase a failure belongs to — flipped once the prompt is on the wire. */
		let phase: "pre-prompt" | "prompt" = "pre-prompt";
		const stderrTail: string[] = [];
		// Session-scoped alongside the tail — see the field's note on the session type.
		const launchObservation: AcpLaunchObservation = {};
		const sessionKey = resolveSessionKey(opts, cwd);
		try {
			if (signal?.aborted) throw new Error("aborted before launch");

			// A backend session that died BETWEEN turns is announced here, before
			// the bootstrap notice — otherwise this turn looks like an ordinary
			// cold start and the operator never learns that the session they were
			// talking to ended. Announced once (read-and-clear); the turn continues
			// normally, since opening a fresh child for a NEW user turn is not a
			// replay of anything.
			// A summary turn must not consume the conversation's end notice, whatever key it carries.
			const priorEnd = summary ? undefined : takeUnreportedChildEnd(sessionKey);
			if (priorEnd) {
				pushAcpLifecycleNotice(
					state,
					`previous ${adapter.backend} session ended between turns (${describeChildEnd(priorEnd)}) — opening a new one`,
				);
			}
			// S2f visibility: surface the otherwise-silent bootstrap so a slow
			// overlay/spawn/init does not read as a hang. Display-only (marked).
			pushAcpLifecycleNotice(state, `preparing ${adapter.backend} session`);
			// Overlay ordering (rail “Adapter contract”): materialize the overlay first, then spawn with launchEnvDefaults
			// + overlay.envOverrides merged over process.env (defaultDeps spawnChild).
			// sessionKey is the AUTHORITATIVE per-session identity (resolveSessionKey:
			// opts.sessionId → PI_SESSION_ID → cwd) — a session-scoped overlay must
			// scope on it, so it rides the params explicitly and the adapter never
			// re-derives a weaker key from ambient env (P0-1).
			overlay = adapter.ensureOverlay({
				cwd,
				modelId: model.id,
				nativeModelId,
				config,
				sessionKey,
				summaryTurn: Boolean(summary),
			});
			const effectiveCwd = overlay.effectiveCwd ?? cwd;
			const launch = adapter.resolveLaunch({
				cwd,
				modelId: model.id,
				nativeModelId,
				config,
				summaryTurn: Boolean(summary),
				overlayDir: overlay.overlayDir,
			});
			child = deps.spawnChild(launch, effectiveCwd, { ...adapter.launchEnvDefaults(), ...overlay.envOverrides });
			const spawned = child;

			// Drain stderr (an unconsumed pipe can backpressure-deadlock a long turn).
			// The launcher's own control frames are consumed here and kept OUT of the
			// tail: the tail is vendor evidence, the observation is an entwurf fact,
			// and mixing the two is the overloading #72 was made of.
			const consumeStderr = makeLaunchFrameFilter(launchObservation, (text) => {
				stderrTail.push(text);
				if (stderrTail.length > 50) stderrTail.shift();
			});
			spawned.stderr.on("data", (c: Buffer) => consumeStderr.write(c.toString()));
			// `close` rather than `end`: it covers the destroy path our own teardown
			// takes, and on the EOF-first death it lands inside the post-mortem
			// settle window, so the flushed fragment is in the tail before we seal.
			spawned.stderr.once?.("close", () => consumeStderr.flush());

			// Abort during BOOTSTRAP (spawn → initialize → newSession → set-model):
			// there is no prompt turn for the agent to cancel yet, so the child is
			// simply torn down. This listener is handed off before the prompt —
			// awaitAcpPromptTurn installs the protocol-cancel-first one for that
			// window, and two live listeners would race SIGTERM against the cancel.
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
				// SAME array the stderr drain above pushes into: the buffer outlives
				// this turn with the session, so a later reuse turn can still report
				// the child's dying words.
				stderrTail,
				// SAME object the frame filter writes into, for the same reason.
				launchObservation,
				// Armed at spawn, before ANY turn can fail on this child — the latch
				// must already exist when the `exit` listener below can fire.
				childEnd: makeChildEndLatch(),
			};
			const sess = session;
			spawned.once("exit", (...args: unknown[]) =>
				onChildGone(sess, { code: (args[0] as number | null) ?? null, signal: (args[1] as NodeJS.Signals) ?? null }),
			);
			spawned.once("error", () => onChildGone(sess));

			const initialized = await withTimeout(
				"initialize",
				connection.initialize({
					protocolVersion: PROTOCOL_VERSION,
					// #163 S8: declare the compaction contract, so the child's own compactions arrive as
					// `compaction_update` with their summary (S1/K1, GLG 2026-11-15) — recorded out of
					// context by the provider, never sent back to a model or a backend session.
					clientCapabilities: { session: { compaction: {} } },
					clientInfo: { name: "entwurf", version: "s2d" },
				}),
				INITIALIZE_TIMEOUT_MS,
			);
			// #163 S7: only an adapter that advertises steering is ever sent one.
			session.steeringSupported = readSteeringSupported(initialized);
			// #168: the server that answered must be the adapter's vendor at or above its floor, before any session.
			adapter.admitAgent?.(initialized);
			// #171 L1: keep what this child said about itself (version, capabilities, auth methods).
			session.agentFacts = readAgentFacts(initialized);

			// Tool-narrowed session meta (S2b) + the billing carrier (S2d-1c). The
			// carrier is the SAME rendered engraving folded into configSig above;
			// when null, buildClaudeSessionMeta omits the _meta.systemPrompt key
			// entirely so a carrier-absent session is byte-identical to 1b-2b.
			// S2g: the RESOLVED operator config drives the session meta (tools /
			// permission / disallowed / settingSources / strictMcpConfig / skillPlugins)
			// instead of the old hardcoded minimal surface.
			const sessionMeta = adapter.buildSessionMeta({ modelId: model.id, nativeModelId, config }, engraving);
			// Envelope-enrich the normalized servers at spawn time (PI_SESSION_ID/
			// PI_AGENT_ID into entwurf-bridge) — runtime wiring, applied AFTER the
			// config signature was taken so a new session id never forces a rebuild.
			const wireMcpServers = enrichMcpServersWithEnvelope(config.mcpServers, {
				modelId: model.id,
				piSessionId: process.env.PI_SESSION_ID?.trim() || undefined,
			});
			// Carrier-less shape (rail “Adapter contract”): omit the `_meta` KEY entirely for a carrier-less backend
			// (sessionMeta === undefined), not `_meta: undefined`.
			const newSessionArgs =
				sessionMeta === undefined
					? { cwd: effectiveCwd, mcpServers: wireMcpServers }
					: { cwd: effectiveCwd, mcpServers: wireMcpServers, _meta: sessionMeta };
			const created = await withTimeout("newSession", connection.newSession(newSessionArgs), NEW_SESSION_TIMEOUT_MS);
			const acpSessionId = created?.sessionId;
			if (!acpSessionId) throw new Error("newSession returned no sessionId");
			session.acpSessionId = acpSessionId;

			// Enforce the requested model — a silent default would lie about which
			// model answered. pi 0.50/sdk 0.29: model selection moved from the removed
			// unstable_setSessionModel to setSessionConfigOption({configId:"model"}).
			// The agent resolves the value (full id or alias) to a canonical model id
			// and routes it through query.setModel.
			await withTimeout(
				"enforceModel",
				adapter.enforceModel({ connection, acpSessionId, modelId: model.id, nativeModelId }),
				SET_MODEL_TIMEOUT_MS,
			);
			// #142: the requested thinking level, set and read back before the prompt. The session keeps
			// the value the driver confirmed, so a reuse turn sets it again only when it changes.
			if (thinkingValue !== undefined && adapter.enforceThinking) {
				await withTimeout(
					"enforceThinking",
					adapter.enforceThinking({ connection, acpSessionId, modelId: model.id, value: thinkingValue }),
					SET_MODEL_TIMEOUT_MS,
				);
				session.thinkingValue = thinkingValue;
				// Visible like the model lock: the operator sees the effort the driver read back.
				pushAcpLifecycleNotice(state, `effort ${thinkingValue} read back`);
			}

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
			// #163: a summary turn carries Pi's summarization instructions instead.
			const builtPrompt: AcpTextBlock[] = summary
				? [...(summary.instructions ? [{ type: "text" as const, text: summary.instructions }] : []), ...basePrompt]
				: prependNewPromptAugment(basePrompt, {
						backend: adapter.backend,
						cwd,
						mcpServerNames: mcpServerNames(config),
						emacsAgentSocket: process.env.PI_EMACS_AGENT_SOCKET?.trim() || undefined,
					});
			const prompt = wireTextBlocks(builtPrompt, adapter);

			// S2f visibility: about to send — say "sending" (not "sent") because the
			// prompt could still sync-reject before the wire write; the next visible
			// event after this is the backend's own first token / tool notice.
			pushAcpLifecycleNotice(state, "sending prompt");
			// #63: the pi streamSimple payload hook sees the EXACT wire params and may
			// replace them (fail-closed integrity inside the helper). It runs while the
			// bootstrap abort listener is still armed; the recheck below keeps an abort
			// raised during a slow handler ahead of the wire write.
			const resident = params.lifecyclePolicy === "process-scoped";
			const wireParams = await applyProviderPayloadHook(options, { sessionId: acpSessionId, prompt }, model, resident);
			if (signal?.aborted) throw new Error("aborted during payload hook");
			// #171 L16: the marker, immediately before the prompt, for a process-scoped session only — a
			// turn-scoped Pi (and a summary turn) never writes a record. A failed write throws here, before
			// the prompt, so nothing is sent (decision 9).
			if (params.lifecyclePolicy === "process-scoped") marker = markDispatch(session, ctxSigs);
			// Hand the abort window over to the prompt driver: from here on an abort
			// is a protocol `session/cancel` first, teardown only after the grace.
			if (signal && onAbort) {
				signal.removeEventListener("abort", onAbort);
				onAbort = undefined;
			}
			// From here the prompt is on the wire: a transport closure now is a
			// PROMPT-phase failure, and the catch says so.
			phase = "prompt";
			const promptResult = await awaitAcpPromptTurn(session, wireParams, {
				signal,
				graceMs: deps.abortGraceMs ?? ABORT_CANCEL_GRACE_MS,
				onWindow: compactionWindow(session),
			});

			session.activePromptHandler = undefined;
			session.busy = false;

			// Retain ONLY a long-lived process-scoped session that survived the turn
			// alive and un-aborted. A turn-scoped one-shot (and any aborted/dead
			// turn) tears down so its stdio handle cannot pin pi's exit (S2c hang).
			const retain = params.lifecyclePolicy === "process-scoped" && !signal?.aborted && session.alive;

			// DISCOVERABILITY BEFORE THE SEAL. `finishSuccess` ends the stream, and
			// ending the stream is what releases the caller — which may start the next
			// turn on that event. A completed process-scoped session that is not yet in
			// the map would send that turn down the NEW path: a second child, and with
			// it a FRESH cost baseline, so a long session's accounting would silently
			// reset at a turn boundary (#93).
			//
			// Two things make that window empty today — nothing here awaits, and the
			// turn's in-flight claim is not released until after this returns — but both
			// are invariants of surrounding code rather than of this ordering, and
			// neither is visible from this line. Registering first makes the guarantee
			// local: the session is discoverable before anything can act on the seal,
			// whatever the code around it later does.
			if (retain) {
				session.sealedTurnId = turnId;
				bridgeSessions.set(sessionKey, session);
				retainedChildren.add(spawned);
				registerGlobalCleanup();
				// unref so the retained stdio cannot pin pi's exit at resident
				// shutdown — reuse is unaffected (unref ≠ destroy). GPT amber.
				unrefRetainedChild(spawned);
			}

			if (signal?.aborted || mapPromptStopReason(promptResult?.stopReason).stopReason === "aborted") {
				pushAcpLifecycleNotice(state, retain ? ACP_CANCEL_KEPT_NOTICE : ACP_CANCEL_CLOSED_NOTICE);
			}
			if (summary && !signal?.aborted && mapPromptStopReason(promptResult?.stopReason).stopReason === "stop") {
				summarySucceeded = true;
			}
			if (retain && !persistRecord(session, deps)) {
				pushAcpLifecycleNotice(state, ACP_RECORD_DEGRADED_NOTICE);
			}
			// #171 L16: a marked turn that sealed but is not kept (an abort, a child gone after its answer) leaves
			// no session to continue. Its record is dropped, or the next turn would stop on a marker for a turn
			// whose end was already shown.
			if (!retain && marker) {
				const dropFailure = dropRecord(sessionKey, deps);
				if (dropFailure) reportRecordDrop(dropFailure);
				// Handled: a teardown that throws below must not reach the catch as a second, later stop.
				marker = undefined;
			}
			finishSuccess(adapter, session, promptResult);

			if (!retain) {
				session.retiring = true;
				connection.close?.();
				teardownChild(spawned);
			}
		} catch (err) {
			const aborted = Boolean(signal?.aborted);
			if (session) {
				session.activePromptHandler = undefined;
				session.busy = false;
				if (bridgeSessions.get(sessionKey) === session) bridgeSessions.delete(sessionKey);
			}
			// ORDER IS THE CONTRACT (#72): natural settle → seal → teardown.
			// The bounded wait for the child's own exit status runs BEFORE we signal
			// anything, so what we report is how the child actually ended and not our
			// own SIGTERM; the tail collected by then is sealed before our cleanup
			// touches the stderr pipe.
			const lifecycle = await diagnoseTransportClosure({ err, session, phase, aborted });
			if (aborted) pushAcpLifecycleNotice(state, ACP_CANCEL_CLOSED_NOTICE);
			if (err instanceof AcpStopSignal) {
				pushAcpLifecycleNotice(state, err.why);
				pushStopExit(err.stop);
			}
			stopAfterFailure(sessionKey, marker);
			finishError(
				err,
				aborted,
				session?.stderrTail ?? stderrTail,
				lifecycle,
				session?.launchObservation ?? launchObservation,
				phase === "prompt" ? adapter : undefined,
			);
			// error/abort → drop the (uncertain) session and close its child; an
			// uncertain connection must never be reused (GPT ④).
			if (child) {
				if (session) session.retiring = true;
				retainedChildren.delete(child);
				session?.connection.close?.(err);
				teardownChild(child);
			}
		} finally {
			if (signal && onAbort) signal.removeEventListener("abort", onAbort);
			if (overlay?.cleanup) {
				const spawned = child !== undefined;
				const childExited = child ? await waitForChildExit(child, deps.childExitTimeoutMs) : true;
				// The turn is already sealed: a cleanup that throws (EACCES, EBUSY on unlink/rm) is reported
				// and the root preserved, never thrown out of this un-awaited microtask, where it would be an
				// unhandled rejection after the answer. The sealed result stays what it is (as persistRecord).
				try {
					overlay.cleanup({ childExited, succeeded: summarySucceeded, spawned });
				} catch (cleanupErr) {
					console.warn(
						`[acp] summary root cleanup failed; preserved ${overlay.overlayDir ?? "summary root"}: ${cleanupErr instanceof Error ? cleanupErr.message : String(cleanupErr)}`,
					);
				}
				if (!childExited) {
					console.warn(`[acp] summary child exit unconfirmed; preserved ${overlay.overlayDir ?? "summary root"}`);
				}
			}
		}
	}

	// --- reuse: send only the user messages after the last assistant to the live ACP session
	async function runReuseTurn(
		session: BridgeSession,
		ctxSigs: string[],
		adapter: AcpBackendAdapter,
		thinkingValue: string | undefined,
		/** The delta and its range as the branch gate compared them (#171 step 8). */
		checked: { prompt: AcpTextBlock[]; range: { start: number; count: number } },
	): Promise<void> {
		/** Same phase discipline as a new turn — reuse just has no bootstrap to lose. */
		let phase: "pre-prompt" | "prompt" = "pre-prompt";
		/** #171 L16: set once this turn's dispatch marker is in the record. */
		let marker: PendingDispatch | undefined;
		try {
			if (signal?.aborted) throw new Error("aborted before prompt");

			// S2f visibility: reuse skips spawn/init entirely — say so, otherwise a
			// resident turn looks identical to a cold start that stalled.
			pushAcpLifecycleNotice(state, "reusing live session");
			session.busy = true;

			// #142: a changed thinking level is set on THIS live session, before the delta is sent; the
			// conversation is kept. A refused or mismatched answer fails the turn before the prompt and
			// the session is dropped by the catch below, like any other pre-prompt failure on reuse.
			if (thinkingValue !== undefined && adapter.enforceThinking && session.thinkingValue !== thinkingValue) {
				await withTimeout(
					"enforceThinking",
					untilAborted(
						adapter.enforceThinking({
							connection: session.connection,
							acpSessionId: session.acpSessionId,
							modelId: model.id,
							value: thinkingValue,
						}),
						signal,
					),
					SET_MODEL_TIMEOUT_MS,
				);
				session.thinkingValue = thinkingValue;
				pushAcpLifecycleNotice(state, `effort ${thinkingValue} read back`);
			}

			// The live ACP session already remembers the prior turns → send only the user
			// messages after the last assistant (re-sending the transcript would duplicate history).
			// The blocks the branch gate compared, not a second rendering of a context that may have moved.
			const prompt = checked.prompt;
			if (prompt.length === 0) throw new Error("empty delta — a reuse turn has no new user message");

			// S2f visibility: about to send the delta to the resident child.
			pushAcpLifecycleNotice(state, "sending prompt");
			// #63: same hook boundary as a new turn — the reuse delta is the wire
			// params here. The recheck keeps an abort raised during a slow handler
			// ahead of the wire write; the prompt driver then owns the abort surface.
			const built = { sessionId: session.acpSessionId, prompt: wireTextBlocks(prompt, adapter) };
			const wireParams = await applyProviderPayloadHook(options, built, model, true);
			if (signal?.aborted) throw new Error("aborted during payload hook");
			// #171 L16: the marker, immediately before the prompt. A reused session is always process-scoped.
			// A failed write throws here: nothing is sent, and this session is dropped like any pre-prompt failure.
			marker = markDispatch(session, ctxSigs, checked.range);
			// #142: this turn's stream receives updates only from the moment its own prompt goes out.
			// Before that, nothing on this live session can be this turn's output — a late update of
			// the previous (cancelled) turn arriving during the effort set would otherwise be shown as
			// this turn's answer. Inside the prompt window the wire carries no turn id; that part
			// rests on the agent not speaking for a turn it already answered.
			session.activePromptHandler = makePromptHandler(session);
			phase = "prompt";
			const promptResult = await awaitAcpPromptTurn(session, wireParams, {
				signal,
				graceMs: deps.abortGraceMs ?? ABORT_CANCEL_GRACE_MS,
				onWindow: compactionWindow(session),
			});

			session.activePromptHandler = undefined;
			session.busy = false;
			// Advance the stored history to THIS call's context so the NEXT turn's
			// prefix-compat check sees the full prior history (GPT ④: store the
			// ctxSigs from the START of this call, only after the turn succeeds).
			session.contextMessageSignatures = ctxSigs;
			session.sealedTurnId = turnId;
			// A cancel the agent answered itself leaves this live session in place (no drop below).
			if (signal?.aborted || mapPromptStopReason(promptResult?.stopReason).stopReason === "aborted") {
				pushAcpLifecycleNotice(state, ACP_CANCEL_KEPT_NOTICE);
			}
			if (!persistRecord(session, deps)) {
				pushAcpLifecycleNotice(state, ACP_RECORD_DEGRADED_NOTICE);
			}
			finishSuccess(adapter, session, promptResult);
		} catch (err) {
			const aborted = Boolean(signal?.aborted);
			session.activePromptHandler = undefined;
			session.busy = false;
			// #171 step 8: a turn refused before its marker sent nothing, so the live session is as it was and
			// is kept; only this turn fails. Its answer carries a turn id the session never sealed, so the
			// branch gate stops later turns until the unsent input can be placed.
			if (phase === "pre-prompt" && !marker && session.alive) {
				if (aborted) pushAcpLifecycleNotice(state, ACP_CANCEL_UNSENT_NOTICE);
				if (err instanceof AcpStopSignal) {
					pushAcpLifecycleNotice(state, err.why);
					pushStopExit(err.stop);
				}
				finishError(err, aborted);
				return;
			}
			if (bridgeSessions.get(session.key) === session) bridgeSessions.delete(session.key);
			// The SAME diagnostics a new turn reports, in the SAME order (#72):
			// natural settle → seal → teardown. This is the path the field sample
			// took — a retained child that died after its tool phase — so the
			// ordering matters most here: teardown first would have overwritten the
			// child's own exit status with our SIGTERM.
			const lifecycle = await diagnoseTransportClosure({ err, session, phase, aborted });
			if (aborted) pushAcpLifecycleNotice(state, ACP_CANCEL_CLOSED_NOTICE);
			stopAfterFailure(session.key, marker);
			// Without the session-scoped tail a mid-turn child death on a resident
			// session surfaced as a bare "ACP connection closed" with nothing to read
			// it by.
			finishError(
				err,
				aborted,
				session.stderrTail,
				lifecycle,
				session.launchObservation,
				phase === "prompt" ? adapter : undefined,
			);
			// error/abort on a reused session → drop it and close the child (GPT ④).
			session.retiring = true;
			retainedChildren.delete(session.child);
			session.connection.close?.(err);
			teardownChild(session.child);
		}
	}

	return stream;
}
