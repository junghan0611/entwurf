// §11-7 ordering probe — the ONE shared NDJSON event log (docs/acp-backend-rail.md).
//
// Every participating process (the ACP-side probe runner AND the MCP fixture the
// ACP child spawns) appends single-line JSON events to the SAME file, so ordering
// is read off a common wall-clock axis instead of being reconstructed from
// separate logs with drifting clocks. Contract per §11-7:
//   - append-only; one event per line;
//   - each line carries the runId, a shared wall-clock stamp, the writing pid,
//     and a monotonic per-process counter (seq) so same-ms events keep their
//     in-process order. That counter is now VERIFIED, not merely produced:
//     `readProbeEvents` walks the raw append order and refuses a log whose per-pid
//     seq repeats or whose per-pid clock runs backwards (GPT review 2026-07-29 —
//     the door checked `seq` was a safe integer and nothing more, so the stated
//     "monotonic" property was a convention the evidence never had to keep).
//
// Writes use appendFileSync (O_APPEND) with exactly ONE write per line: on a
// POSIX local filesystem the O_APPEND offset update + write is atomic per call,
// so concurrent writers interleave at line granularity, never inside a line.
// (PIPE_BUF is irrelevant here — that bound governs pipes/FIFOs, not
// regular-file appends.)

import { appendFileSync, existsSync, readFileSync } from "node:fs";

// ---------------------------------------------------------------------------
// Event vocabulary — shared by fixture, runner, and classifier. A name used by
// a writer that the classifier does not know is a contract bug, so both sides
// import from here instead of retyping strings.
// ---------------------------------------------------------------------------

export const PROBE_EVENTS = {
	// fixture-side (MCP wire)
	fixtureProcessStart: "fixture_process_start",
	fixtureDelayStart: "fixture_delay_start",
	fixtureDelayEnd: "fixture_delay_end",
	fixtureTransportConnected: "fixture_transport_connected",
	fixtureInitializeReceived: "fixture_initialize_received",
	fixtureToolsListReceived: "fixture_tools_list_received",
	// THE wire-availability proxy (§11-7): the ENTIRE expected-tool tools/list
	// response frame was write()-n to downstream stdio AND the write callback
	// fired. Never a readiness claim — the client may not have parsed it yet.
	toolsListResponseForwarded: "tools_list_response_forwarded",
	fixtureToolsCallReceived: "fixture_tools_call_received",
	fixtureToolsCallReplied: "fixture_tools_call_replied",
	// ACP-side (probe runner)
	runStart: "run_start",
	initializeStart: "initialize_start",
	initializeEnd: "initialize_end",
	newSessionStart: "new_session_start",
	newSessionEnd: "new_session_end",
	setModelStart: "set_model_start",
	setModelEnd: "set_model_end",
	promptStart: "prompt_start",
	promptEnd: "prompt_end",
	acpToolCallObserved: "acp_tool_call_observed",
	/** Forensic-only: EVERY raw tool_call / tool_call_update frame (capped). The
	 *  classifier ignores it — it exists so a failed extraction is diagnosable
	 *  from the artifact instead of leaving the observed event silently absent. */
	acpToolCallRaw: "acp_tool_call_raw",
	acpNoSuchTool: "acp_no_such_tool",
	promptReply: "prompt_reply",
	/** The OBSERVATION WINDOW's close, stamped by the runner BEFORE teardown.
	 *  §11-7 measured why this must exist: the first LIVE pair tore the child down
	 *  at turn end while the fixture was still inside its injected delay, so the
	 *  wire marker could never land — and the classifier read that self-inflicted
	 *  absence as an MCP handshake / fixture / config candidate. Absence is only
	 *  an observation when WE kept the window open long enough to see it, so the
	 *  runner records how the window closed and whether the marker was seen. */
	observationWindowEnd: "probe_observation_window_end",
	runEnd: "run_end",
} as const;

export type ProbeEventName = (typeof PROBE_EVENTS)[keyof typeof PROBE_EVENTS];

/** How the observation window closed. The reason is NOT decoration — it decides
 *  whether a missing wire marker is evidence or an artifact of our own teardown:
 *   - `wire-marker`  the marker landed; the window closed because it did its job.
 *   - `deadline`     we waited past the fixture's own delay end plus slack and the
 *                    marker never came. The window WAS sufficient, so absence is a
 *                    real reading (handshake / fixture / config candidate).
 *   - `child-exit`   the ACP child ended before either. The window closed for a
 *                    reason outside the marker → CENSORED, never an attribution.
 *   - `run-failed`   the turn failed at a phase; the window question is moot and
 *                    the phase reading (D-*) owns the run. Stamped anyway so the
 *                    exactly-once topology holds on the failure path too. */
export const PROBE_WINDOW_REASONS = ["wire-marker", "deadline", "child-exit", "run-failed"] as const;
export type ProbeWindowReason = (typeof PROBE_WINDOW_REASONS)[number];
const WINDOW_REASONS: ReadonlySet<string> = new Set(PROBE_WINDOW_REASONS);

/** The one tool the probe expects to find in the schema. SSOT for all three
 *  layers — fixture (serves it), parser (the wire marker must NAME it), and
 *  classifier (the callability marker must be it). Three private copies of this
 *  string could drift apart silently, which is the exact drift this seam exists
 *  to make loud. */
export const PROBE_EXPECTED_TOOL = "probe_nonce";

const KNOWN_EVENT_NAMES: ReadonlySet<string> = new Set(Object.values(PROBE_EVENTS));

/** Vocabulary membership — the contract every writer shares with the classifier. */
export function isProbeEventName(name: unknown): name is ProbeEventName {
	return typeof name === "string" && KNOWN_EVENT_NAMES.has(name);
}

export interface ProbeEvent {
	seq: number;
	pid: number;
	ts: string;
	tsMs: number;
	runId: string;
	event: ProbeEventName;
	[key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Envelope contract — the log IS the evidence, so its door is a gate.
//
// Every line is the six-key envelope {seq,pid,ts,tsMs,runId,event} plus free
// payload. The envelope belongs to the writer, and it is exactly what §11-7
// judges on, so a JSON-valid line that breaks it is NOT a tolerable oddity:
//   - `event` is the marker vocabulary. An unknown name is not a new event, it
//     is a marker that silently went MISSING — and absence is precisely what
//     the classifier reads as evidence (the B / candidate branches).
//   - `tsMs` (with `pid`/`seq` for ties) is the shared sort axis. A missing or
//     non-numeric stamp makes the comparator NaN, un-orders the whole log, and
//     turns the ordering reads (ran-ahead / ordering-kept) into file order.
//   - `ts` is the readable twin of `tsMs` and must agree with it EXACTLY; the
//     writer derives one from the other, so disagreement means a rewritten line.
// Such a line leaves through the same door as a truncated one — `malformed`,
// which the LIVE runner turns into an INVALIDATED run instead of a verdict.
//
// The envelope alone is not enough. The classifier judges on PAYLOAD fields, so
// a line with a valid envelope and a known marker name can still be a lie:
// `tools_list_response_forwarded` whose `tools` does not name the expected tool
// is not wire-availability at all, and a phase end whose `ok` is not a boolean
// reads as a phase FAILURE (`ok === true` is false for "true", 1, null). Those
// silently move the verdict instead of invalidating the run — the same
// "healthy-looking corruption" the envelope check closes one layer up. So every
// event the classifier reads payload off carries a rule below, and a line that
// breaks its rule is malformed too. Events the classifier does not judge on
// (forensics: raw frames, delays, jsonrpc ids) deliberately have no rule —
// PAYLOAD_CONTRACT_EVENTS is exactly the judged set, and the gate pins it
// against a hand-written literal so a new classifier read cannot quietly land
// without a door rule.
// ---------------------------------------------------------------------------

/** The six keys the WRITER owns. A payload carrying one of them could rewrite
 *  the run id, the marker name, or the sort axis OF ITS OWN evidence line, so
 *  the write is refused rather than resolved by key order. */
export const RESERVED_EVENT_KEYS = ["seq", "pid", "ts", "tsMs", "runId", "event"] as const;

function isWellFormedEnvelope(value: unknown): value is ProbeEvent {
	if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
	const e = value as Record<string, unknown>;
	if (!isProbeEventName(e.event)) return false;
	if (typeof e.runId !== "string" || e.runId.length === 0) return false;
	if (!Number.isSafeInteger(e.seq) || (e.seq as number) < 0) return false;
	if (!Number.isSafeInteger(e.pid) || (e.pid as number) <= 0) return false;
	if (!Number.isSafeInteger(e.tsMs) || (e.tsMs as number) <= 0) return false;
	if (typeof e.ts !== "string" || Date.parse(e.ts) !== e.tsMs) return false;
	return true;
}

type PayloadRule = (e: ProbeEvent) => boolean;

const isString = (v: unknown): boolean => typeof v === "string";
const isBoolean = (v: unknown): boolean => typeof v === "boolean";
/** Absent is allowed; present must hold. Used where the WRITER legitimately has
 *  nothing to record — never as a softener for a field it always emits. */
const optional = (v: unknown, holds: (x: unknown) => boolean): boolean => v === undefined || holds(v);

// A phase end is the D/P0/I0 axis: `ok` decides whether the phase passed, so a
// non-boolean must never be read (it would silently mean "failed").
const phaseEndRule: PayloadRule = (e) =>
	isBoolean(e.ok) && optional(e.timedOut, isBoolean) && optional(e.error, isString);

const PAYLOAD_RULES: Partial<Record<ProbeEventName, PayloadRule>> = {
	[PROBE_EVENTS.initializeEnd]: phaseEndRule,
	[PROBE_EVENTS.newSessionEnd]: phaseEndRule,
	[PROBE_EVENTS.setModelEnd]: phaseEndRule,
	[PROBE_EVENTS.promptEnd]: phaseEndRule,
	// THE wire-availability proxy. Its meaning is "the expected tool's tools/list
	// frame reached the pipe" — a marker not naming that tool is not that event.
	[PROBE_EVENTS.toolsListResponseForwarded]: (e) =>
		Array.isArray(e.tools) && e.tools.every(isString) && e.tools.includes(PROBE_EXPECTED_TOOL),
	// Callability marker. BOTH fields are optional by observation: the fixture
	// stamps the inbound call BEFORE validating it, so a call carrying neither a
	// tool name nor a join key is a real reading (the absence branch) and that
	// line is kept. What typed-if-present refuses is a field that is PRESENT and
	// unusable — e.g. a numeric probeRunId, which would fail correlation silently
	// and push the run toward absence.
	[PROBE_EVENTS.fixtureToolsCallReceived]: (e) => optional(e.tool, isString) && optional(e.probeRunId, isString),
	// ACP-side visibility. providerToolId is optional (a frame carrying neither
	// name nor title yields no id — the classifier reads that as P0/unmeasured);
	// probeRunId is REQUIRED because the runner only emits after it is a string.
	[PROBE_EVENTS.acpToolCallObserved]: (e) => optional(e.providerToolId, isString) && isString(e.probeRunId),
	[PROBE_EVENTS.acpNoSuchTool]: (e) => isString(e.toolId),
	[PROBE_EVENTS.promptReply]: (e) => isBoolean(e.carriesNonce),
	// The window close. `reason` decides whether a missing wire marker is a
	// reading or our own teardown, and `markerSeen` is the fact it is read
	// against — an unknown reason string would silently fall through to the
	// permissive branch of whatever consumes it, so the vocabulary is closed here.
	[PROBE_EVENTS.observationWindowEnd]: (e) =>
		typeof e.reason === "string" && WINDOW_REASONS.has(e.reason) && isBoolean(e.markerSeen),
};

/** Exactly the events the classifier judges payload on — the gate pins this
 *  against a hand-written literal, so a new read without a rule turns red. */
export const PAYLOAD_CONTRACT_EVENTS = Object.keys(PAYLOAD_RULES) as ProbeEventName[];

function payloadHoldsContract(e: ProbeEvent): boolean {
	const rule = PAYLOAD_RULES[e.event];
	return rule === undefined || rule(e);
}

// Env names the runner sets on the fixture's mcpServers entry. The fixture and
// the runner must agree on these exactly; single source here.
export const PROBE_ENV = {
	eventLog: "PROBE_MCP_EVENT_LOG",
	startupDelayMs: "PROBE_MCP_STARTUP_DELAY_MS",
	runId: "PROBE_RUN_ID",
	nonce: "PROBE_NONCE",
} as const;

let seqCounter = 0;

/** Append one event line. Synchronous on purpose — an async write could reorder
 *  against the very marker semantics this log exists to pin down. */
export function appendProbeEvent(
	logPath: string,
	runId: string,
	event: ProbeEventName,
	payload: Record<string, unknown> = {},
): void {
	for (const key of RESERVED_EVENT_KEYS) {
		if (Object.hasOwn(payload, key)) {
			throw new Error(
				`probe event payload may not carry the reserved envelope key "${key}" (event=${event}) — ` +
					"the writer owns seq/pid/ts/tsMs/runId/event",
			);
		}
	}
	// ONE clock read: `ts` is DERIVED from `tsMs`, so the readable stamp and the
	// sort axis can never straddle a millisecond boundary (two separate reads
	// can) — which is what lets the parser demand exact agreement between them.
	const tsMs = Date.now();
	const line: ProbeEvent = {
		...payload,
		seq: seqCounter++,
		pid: process.pid,
		ts: new Date(tsMs).toISOString(),
		tsMs,
		runId,
		event,
	};
	appendFileSync(logPath, `${JSON.stringify(line)}\n`, "utf8");
}

/** Per-writer stream integrity, checked on the RAW APPEND ORDER — before the
 *  sort, on purpose. `seq` and `tsMs` are what the sort trusts, so validating
 *  them after sorting would be circular: the comparator would have already
 *  rewritten the very order being checked, and a writer whose clock went
 *  backwards would come out looking perfectly ordered.
 *
 *  Per (runId, pid) writer, walking the file top to bottom:
 *   - `seq` must STRICTLY increase. It is a per-process counter, so a repeat is
 *     two lines claiming one slot (interleaved writers, a re-entered writer, a
 *     spliced log) and the pair is unorderable within its millisecond. GAPS are
 *     fine — a process may write to more than one log, and the counter is
 *     process-wide, not file-wide.
 *   - `tsMs` must not go BACKWARDS. One process reads one clock; a regression
 *     means the stamps were rewritten or the clock stepped, and the shared axis
 *     is exactly what §11-7's ordering reads are made of.
 *  Either violation invalidates the LOG, not a line — the bytes are individually
 *  well-formed, so returning them as `malformed` would misname the defect. */
function findSequenceViolations(events: ProbeEvent[]): string[] {
	const violations: string[] = [];
	const lastSeq = new Map<string, number>();
	const lastTsMs = new Map<string, number>();
	for (const e of events) {
		// WRITER KEY is (runId, pid), not pid alone. The fixture is a fresh child
		// per run and the OS reuses pids: a later run's fixture can be handed the
		// same pid as an earlier one and legitimately start its counter at 0 again.
		// Keying on pid alone would call that healthy log corrupt, and cross-run
		// ordering is not something any §11-7 verdict reads (GPT review 2026-07-29).
		const key = `${e.runId}\u0000${e.pid}`;
		const priorSeq = lastSeq.get(key);
		if (priorSeq !== undefined && e.seq <= priorSeq) {
			violations.push(
				`pid ${e.pid}: seq ${e.seq} does not exceed the preceding ${priorSeq} in append order (event=${e.event}, runId=${e.runId})`,
			);
		}
		const priorTsMs = lastTsMs.get(key);
		if (priorTsMs !== undefined && e.tsMs < priorTsMs) {
			violations.push(
				`pid ${e.pid}: tsMs ${e.tsMs} runs BACKWARDS from the preceding ${priorTsMs} in append order (event=${e.event}, runId=${e.runId})`,
			);
		}
		if (priorSeq === undefined || e.seq > priorSeq) lastSeq.set(key, e.seq);
		if (priorTsMs === undefined || e.tsMs > priorTsMs) lastTsMs.set(key, e.tsMs);
	}
	return violations;
}

/** Parse the shared log. A line is an event only if it clears the envelope
 *  contract above; everything else — unparseable OR JSON-valid-but-broken — is
 *  returned as malformed, so the caller can invalidate the run. Nothing is ever
 *  silently dropped, and nothing broken is ever silently judged.
 *
 *  `sequenceViolations` is the second, STREAM-level door: individually valid
 *  lines whose per-writer order cannot be trusted. Both lists feed the same
 *  INVALIDATED path; they are separate so the artifact says which door refused. */
export function readProbeEvents(logPath: string): {
	events: ProbeEvent[];
	malformed: string[];
	sequenceViolations: string[];
} {
	if (!existsSync(logPath)) return { events: [], malformed: [], sequenceViolations: [] };
	const events: ProbeEvent[] = [];
	const malformed: string[] = [];
	for (const line of readFileSync(logPath, "utf8").split("\n")) {
		const trimmed = line.trim();
		if (trimmed.length === 0) continue;
		try {
			const parsed: unknown = JSON.parse(trimmed);
			if (!isWellFormedEnvelope(parsed) || !payloadHoldsContract(parsed)) {
				malformed.push(trimmed);
				continue;
			}
			events.push(parsed);
		} catch {
			malformed.push(trimmed);
		}
	}
	// RAW append order — must run before the sort below (see the function's note).
	const sequenceViolations = findSequenceViolations(events);
	// One shared axis: wall-clock stamp, then per-process seq for same-ms
	// stability. Cross-process same-ms ties are resolved by pid only to keep the
	// sort total — the classifier never reads meaning into a same-ms cross-pid
	// tie. Totality holds because the envelope check already guaranteed all three
	// fields are finite integers; an unvalidated line would make this comparator
	// return NaN and leave the order implementation-defined.
	events.sort((a, b) => a.tsMs - b.tsMs || a.pid - b.pid || a.seq - b.seq);
	return { events, malformed, sequenceViolations };
}
