// §11-7 ordering probe — the PURE verdict classifier (docs/acp-backend-rail.md).
//
// Input: the shared NDJSON events + the run roster (control + interventions).
// Output: per-run facts, per-intervention readings, and ONE paired verdict
// written as a delta against the control — never as an absolute.
//
// The §11-7 rules this encodes (each one is a gate-pinned claim):
//   - P0 / INVALID BASELINE: the delay=0 control fails (including initialize
//     there). Not a branch of the experiment — nothing else is judged.
//   - I0 / INVALID RUN: control passed but an intervention failed at initialize.
//     The injected delay cannot reach that phase (servers ride newSession), so
//     it is environment drift, never a D.
//   - D must name its phase (newSession | enforceModel | prompt) — initialize
//     is structurally excluded, and the injected delay must sit well below the
//     30 s boundaries or the probe measures our own timeout.
//   - A requires TWO nonzero delays whose newSession latency excess tracks D;
//     one D yields at most the ordering observation with the wait verdict
//     WITHHELD ("A-withheld"). B, C, D may be read off the first intervention.
//   - Absence promotes to direct schema-absence evidence ONLY on the marker
//     combination: wire-forwarded ∧ no fixture tools/call ∧ runtime
//     `No such tool` naming EXACTLY the measured expectedProviderToolId.
//     Alias mismatch and model prose never promote. Anything unlisted stays
//     inconclusive by default.
//
// TWO AXES, not one (GPT review 2026-07-29). The first cut folded everything
// into a single verdict, and the first LIVE pair exposed what that costs: D1's
// `promptStart < wireForwarded` is a DIRECT, model-independent answer to the
// narrow question §11-7 exists to ask — does this server/path wait for delayed
// MCP wire availability before opening the turn? — yet the pair reported plain
// `inconclusive`, because the SEPARATE question (is that window sufficient to
// PRODUCE the failure) had no marker. One verdict let the missing (b) evidence
// hide the settled (a) observation. So every intervention now carries:
//   (a) `ordering` — the ORDERING comparison, read off marker timestamps alone:
//       wire-before-newSession-end | wire-before-prompt-request |
//       prompt-request-ahead-of-wire | censored | unknown. Each value names the
//       comparison, never a conclusion: `promptStart` is a CLIENT-side proxy, so
//       `promptStart < wire` says WE issued the prompt request first and does NOT
//       show the server failed to wait.
//   (b) `failure`  — the callability reading: callable | C | B |
//       candidate-handshake | inconclusive.
// A (the WAIT verdict) still belongs to (a) and still needs `wire <
// newSessionEnd` plus latency scaling across two delays. B/C's causal window is
// `promptStart < wire` — used as a stated PREMISE (the prompt request is where
// we hand the turn over; that this is also when the model's tool set was fixed
// is what §11-7-c's snapshot would have to show) — and the newSession comparison
// is kept as a DIAGNOSTIC, not a verdict input. Hence three separately named
// flags rather than one overloaded `ranAhead`.
//
// Pure on purpose: no IO, no clocks — the deterministic gate replays synthetic
// logs through this exact module.

import { PROBE_EVENTS, PROBE_EXPECTED_TOOL, type ProbeEvent, type ProbeWindowReason } from "./probe-event-log.ts";

/** The tool whose call marks callability. One SSOT in probe-event-log.ts — the
 *  fixture serves it and the parser requires the wire marker to name it, so a
 *  private copy here could drift from either without a gate noticing. */
export const EXPECTED_SOURCE_TOOL = PROBE_EXPECTED_TOOL;

// "Well below BOTH the newSession and set-model 30 s boundaries" (§11-7): half.
export const DELAY_WELL_BELOW_MS = 15_000;

// A's discriminator is "newSession latency tracks D" — a BAND plus growth, not
// a floor alone (a floor-only check accepts excess=10s at D=2s, which is not
// tracking; GPT review 2026-07-28). Per intervention the excess over the
// control must absorb at least MIN_RATIO of the injected delay AND stay within
// SLACK above it; across delays the excess must GROW with D.
export const A_LATENCY_TRACK_MIN_RATIO = 0.8;
export const A_LATENCY_SLACK_MS = 2_000;
export const A_GROWTH_MIN_RATIO = 0.6;

/** Axis (a) — the ORDERING observation, from marker timestamps alone.
 *
 *  Every value is named for the comparison it IS, not for a conclusion drawn
 *  from it. That is deliberate and was corrected under review (2026-07-29): the
 *  first cut called `promptStart < wire` "no-wait", which claims something these
 *  stamps cannot show. `promptStart` is a CLIENT-side proxy — the moment we
 *  issued the ACP prompt request — and a server may perfectly well accept that
 *  request and then wait internally for the MCP install before serving the
 *  model. Likewise `wire < newSessionEnd` is not "the server waited": on its own
 *  it is one ordering, and only A's latency scaling over two delays turns it
 *  into wait evidence. So:
 *   - `wire-before-newSession-end`     wire < newSessionEnd. A's input.
 *   - `wire-before-prompt-request`     newSessionEnd < wire < promptStart.
 *   - `prompt-request-ahead-of-wire`   promptStart < wire. Model-independent, and
 *     the ONLY thing it establishes is that WE issued the prompt request first.
 *   - `censored`  our observation window closed before the marker could land —
 *     a fact about the probe, never about the server.
 *   - `unknown`   no marker under a sufficient window, or a same-ms
 *     cross-process tie, which is unordered at this resolution. */
export type OrderingObservation =
	| "wire-before-newSession-end"
	| "wire-before-prompt-request"
	| "prompt-request-ahead-of-wire"
	| "censored"
	| "unknown";

/** Axis (b) — the callability reading.
 *   - `callable`            the expected tool's call reached the fixture.
 *   - `C`                   callable, but the prompt request had been issued
 *     ahead of the wire: late / dynamic readiness with no client fence.
 *   - `B`                   the marker-grade absence combination (see below).
 *   - `candidate-handshake` no wire marker under a SUFFICIENT window: an MCP
 *     handshake / fixture / config candidate. Only reachable when the window
 *     closed on its deadline — a censored run never lands here, which is exactly
 *     the misattribution the first LIVE pair produced.
 *   - `inconclusive`        everything else, by default. */
export type FailureReading = "callable" | "C" | "B" | "candidate-handshake" | "inconclusive";

/** Why a run is INVALIDATED — outside the verdict space entirely, like P0/I0. */
export type RunInvalidReason = "observation-window-closed" | "topology";

export interface ProbeRunRecord {
	runId: string;
	role: "control" | "intervention";
	delayMs: number;
	probeRunId: string;
}

interface PhaseFact {
	started: boolean;
	ok: boolean;
	timedOut: boolean;
	error?: string;
}

export interface RunFacts {
	runId: string;
	role: "control" | "intervention";
	delayMs: number;
	probeRunId: string;
	initialize: PhaseFact;
	newSession: PhaseFact;
	enforceModel: PhaseFact;
	prompt: PhaseFact;
	newSessionStartMs?: number;
	newSessionEndMs?: number;
	newSessionLatencyMs?: number;
	promptStartMs?: number;
	promptEndMs?: number;
	/** ts of tools_list_response_forwarded — THE wire-availability marker. */
	wireForwardedMs?: number;
	/** How the runner's observation window closed. Absent = the run predates the
	 *  window protocol, which is a topology violation, not a permissive default. */
	windowReason?: ProbeWindowReason;
	windowMarkerSeen?: boolean;
	/** Runner-owned marker topology. Violations invalidate the run: these markers
	 *  are OURS, emitted exactly once by construction, so a duplicate, an
	 *  end-without-start, or an out-of-order pair means the log describing the run
	 *  is not the run. */
	topologyViolations: string[];
	/** Topology PLUS window-close coherence — the full "is this log a description
	 *  of one run" answer, computed once here so the control and the interventions
	 *  are held to the SAME bar. The first cut checked coherence inside
	 *  classifyIntervention only, which left a control free to claim a wire marker
	 *  it never logged (GPT review round 2, 2026-07-29). */
	validityViolations: string[];
	/** A fixture tools/call for the expected tool with THIS run's probeRunId —
	 *  §11-7's only callability marker. */
	fixtureToolCall: boolean;
	fixtureToolCallMs?: number;
	/** ACP-side tool_call observed with matching probeRunId (visibility + the
	 *  provider-bound id measurement). */
	acpProviderToolId?: string;
	/** Runtime `No such tool available: <id>` observed during the turn. */
	noSuchToolId?: string;
	nonceEchoed: boolean;
}

export type InterventionReadingKind =
	| "I0"
	| "INVALIDATED"
	| "D-newSession"
	| "D-enforceModel"
	| "D-prompt"
	| "B"
	| "C"
	| "ordering-kept"
	| "inconclusive";

/** The three ordering comparisons, kept SEPARATE on purpose. Collapsing them
 *  into one `ranAhead` is what let a single flag serve A (whose axis is
 *  `wire < newSessionEnd`) and B/C (whose causal window is `promptStart < wire`);
 *  replacing that one flag with the prompt axis would have silently broken A. */
export interface OrderingDeltas {
	/** wire < newSessionEnd — session creation absorbed the delay (A's axis). */
	newSessionOrderingKept: boolean;
	/** newSessionEnd < wire — DIAGNOSTIC only; never a B/C verdict input. */
	newSessionRanAhead: boolean;
	/** promptStart < wire — the causal window for B/C. */
	promptRanAhead: boolean;
	/** newSessionEnd − wire (positive = session ended that many ms early). */
	newSessionAheadOfWireMs?: number;
	/** promptStart − wire (positive = we issued the prompt request that many ms
	 *  before the wire marker landed — a client-side fact, not a server one). */
	promptAheadOfWireMs?: number;
	/** How much turn was LEFT after the wire marker landed. A large value with no
	 *  tool call says the model had time and did not use it — a model-compliance
	 *  reading, not a server reading, and the artifact must show it. */
	postWireTurnMs?: number;
}

export interface InterventionReading {
	runId: string;
	delayMs: number;
	kind: InterventionReadingKind;
	/** Axis (a) — server-wait observation. Independent of the model's behavior. */
	ordering: OrderingObservation;
	/** Axis (b) — callability reading. */
	failure: FailureReading;
	deltas: OrderingDeltas;
	/** Only a B backed by the exact §11-7 marker combination may enter the
	 *  readiness ledger. */
	promotable: boolean;
	evidence: string;
	invalidReason?: RunInvalidReason;
	newSessionExcessMs?: number;
}

export interface ProbeClassification {
	control: { runId: string; pass: boolean; p0Reason?: string };
	/** Measured off the control's ACP tool_call — never hardcoded (§11-7). */
	expectedProviderToolId?: string;
	interventions: InterventionReading[];
	verdict:
		| "P0"
		| "I0"
		| "INVALIDATED"
		| "A"
		| "A-withheld"
		| "B"
		| "C"
		| "D-newSession"
		| "D-enforceModel"
		| "D-prompt"
		| "inconclusive";
	/** Axis (a) reported on its OWN terms, so a settled ordering observation is
	 *  never hidden by the (b) axis lacking a marker. The summary values are named
	 *  for the comparison, never for a conclusion: neither of them asserts that the
	 *  server did or did not wait. `wire-before-newSession-end` is A's input and
	 *  becomes wait evidence only with A's latency scaling on top;
	 *  `prompt-request-ahead-of-wire` says WE issued the prompt request first and
	 *  nothing about what the server then did internally. */
	ordering: {
		summary: "wire-before-newSession-end" | "prompt-request-ahead-of-wire" | "mixed" | "unobserved";
		perRun: { runId: string; delayMs: number; observation: OrderingObservation }[];
	};
	/** The run's outcome split into the three things a caller actually decides on.
	 *  Folding them into one verdict is what made the LIVE runner treat a pair that
	 *  MEASURED its ordering axis as a failed run, purely because the callability
	 *  axis had no marker (GPT review 2026-07-29).
	 *   - `validity`  fatal only. Under P0/I0/INVALIDATED nothing was measured.
	 *   - `orderingMeasurement` did axis (a) produce a comparison? `measured` says
	 *     the comparison exists — it does NOT say the server waited or did not.
	 *   - `failureVerdict` axis (b), or `not-judged` when validity is fatal. */
	status: {
		/** `partial` = the pair was read, but at least one intervention was thrown
		 *  out. Calling that plain `valid` hides a missing delay point behind a
		 *  healthy-looking label (GPT review round 2, 2026-07-29). */
		validity: "valid" | "partial" | "P0" | "I0" | "INVALIDATED";
		orderingMeasurement: "measured" | "censored" | "unobserved";
		failureVerdict: FailureReading | "not-judged";
		/** Which runs were thrown out, and why — never summarized away. */
		invalidRuns: { runId: string; reason: RunInvalidReason }[];
	};
	promotable: boolean;
	detail: string;
}

function phaseFact(events: ProbeEvent[], startName: string, endName: string): PhaseFact {
	const started = events.some((e) => e.event === startName);
	const end = events.find((e) => e.event === endName);
	return {
		started,
		ok: end?.ok === true,
		timedOut: end?.timedOut === true,
		error: typeof end?.error === "string" ? end.error : undefined,
	};
}

function eventTs(events: ProbeEvent[], name: string): number | undefined {
	const hit = events.find((e) => e.event === name);
	return hit?.tsMs;
}

/** The runner-owned phase pairs, in production order. */
const PHASE_PAIRS: ReadonlyArray<readonly [string, string, string]> = [
	["initialize", PROBE_EVENTS.initializeStart, PROBE_EVENTS.initializeEnd],
	["newSession", PROBE_EVENTS.newSessionStart, PROBE_EVENTS.newSessionEnd],
	["enforceModel", PROBE_EVENTS.setModelStart, PROBE_EVENTS.setModelEnd],
	["prompt", PROBE_EVENTS.promptStart, PROBE_EVENTS.promptEnd],
];

/** Markers the RUNNER emits exactly once per run, by construction. Exported so
 *  the gate can pin it against a HAND-WRITTEN literal: dropping a member here
 *  would quietly retire a topology rule, and reading the set off the module under
 *  test would make the gate agree with whatever it was handed. */
export const RUNNER_EXACTLY_ONCE: ReadonlyArray<string> = [
	PROBE_EVENTS.runStart,
	PROBE_EVENTS.observationWindowEnd,
	PROBE_EVENTS.runEnd,
];

/** Window-close coherence. The close is SELF-REPORTED by the runner and
 *  everything downstream turns on it, so it is checked against the log rather
 *  than believed: a close claiming the marker was seen, in a run whose log has
 *  none, would walk a censored run straight into the candidate branch. Applied
 *  to EVERY run — control included, since the baseline is what the pair is a
 *  delta against. */
function windowCoherenceViolations(windowEnd: ProbeEvent | undefined, wireInLog: boolean): string[] {
	if (windowEnd === undefined) {
		return [
			`no ${PROBE_EVENTS.observationWindowEnd} for this run — absence of the wire marker cannot be told apart from our own teardown`,
		];
	}
	const reason = windowEnd.reason as ProbeWindowReason;
	const markerSeen = windowEnd.markerSeen;
	const out: string[] = [];
	if (markerSeen !== wireInLog) {
		out.push(
			`window close reports markerSeen=${markerSeen} but the run's log ${wireInLog ? "DOES" : "does NOT"} carry ${PROBE_EVENTS.toolsListResponseForwarded} — the self-reported window contradicts its own evidence`,
		);
	}
	if (reason === "wire-marker" && markerSeen !== true) {
		out.push("window closed on 'wire-marker' with markerSeen=false — incoherent close");
	}
	if ((reason === "deadline" || reason === "child-exit") && markerSeen === true) {
		out.push(`window closed on '${reason}' with markerSeen=true — those reasons mean the marker did NOT arrive`);
	}
	return out;
}

/** Runner-owned marker topology for ONE run.
 *
 *  This is deliberately narrow: it judges only markers the runner itself emits,
 *  where cardinality is a property of our own code rather than of the model or
 *  the transport. `acp_tool_call_raw` repeats by design, a model may produce
 *  several tool calls, and a client may re-request tools/list — those are
 *  repeatable markers governed by an earliest-wins read, not by this check
 *  (GPT review 2026-07-29 rejected the wider "everything but tools/list is
 *  exactly-once" rule as over-broad, and it was).
 *
 *  Order is compared on `seq`, not timestamps: all runner markers come from one
 *  process, so `seq` is an exact in-process order, while two markers in the same
 *  millisecond are unordered on the shared wall-clock axis. A runner marker
 *  arriving from a SECOND pid is itself a violation — the run would be describing
 *  two writers as one. */
function runnerTopologyViolations(events: ProbeEvent[]): string[] {
	const violations: string[] = [];
	const runnerOwned = new Set<string>([
		...RUNNER_EXACTLY_ONCE,
		...PHASE_PAIRS.flatMap(([, s, e]) => [s, e]),
		PROBE_EVENTS.promptReply,
	]);
	const owned = events.filter((e) => runnerOwned.has(e.event));
	const pids = new Set(owned.map((e) => e.pid));
	if (pids.size > 1) {
		violations.push(
			`runner-owned markers came from ${pids.size} pids (${[...pids].join(", ")}) — one run has one runner`,
		);
	}
	const seqOf = (name: string): number | undefined => owned.find((e) => e.event === name)?.seq;
	const countOf = (name: string): number => owned.filter((e) => e.event === name).length;

	for (const name of RUNNER_EXACTLY_ONCE) {
		const n = countOf(name);
		if (n !== 1) violations.push(`${name} appears ${n} times — the runner emits it exactly once per run`);
	}
	// A reply is judged payload (nonceEchoed), so a second one would silently
	// change the reading depending on which is read first.
	const replies = countOf(PROBE_EVENTS.promptReply);
	if (replies > 1) violations.push(`${PROBE_EVENTS.promptReply} appears ${replies} times — at most one per run`);

	for (const [phase, startName, endName] of PHASE_PAIRS) {
		const starts = countOf(startName);
		const ends = countOf(endName);
		if (starts > 1) violations.push(`${phase}: ${startName} appears ${starts} times — a phase starts at most once`);
		if (ends > 1) violations.push(`${phase}: ${endName} appears ${ends} times — a phase ends at most once`);
		if (ends > 0 && starts === 0) violations.push(`${phase}: ${endName} without ${startName} — an end with no start`);
		// runPhase logs the end on BOTH paths (ok / error), so a started phase that
		// never ends means the log lost a line, not that the phase is still running.
		if (starts > 0 && ends === 0) violations.push(`${phase}: ${startName} without ${endName} — the phase never closed`);
		const s = seqOf(startName);
		const e = seqOf(endName);
		if (s !== undefined && e !== undefined && !(s < e)) {
			violations.push(`${phase}: ${endName} (seq ${e}) does not follow ${startName} (seq ${s})`);
		}
	}
	// PHASE-TO-PHASE production order, not just start<end within a phase. Checking
	// only the pairs would pass a log whose phases are wholly transposed —
	// prompt before newSession, say — while every pair looked fine (GPT review
	// 2026-07-29). The driver's real order is initialize → newSession →
	// enforceModel → prompt, and a failed phase is a PREFIX of it: everything
	// before it ran, nothing after it started.
	const reached = PHASE_PAIRS.filter(([, startName]) => seqOf(startName) !== undefined);
	const reachedNames = reached.map(([phase]) => phase);
	const expectedPrefix = PHASE_PAIRS.slice(0, reached.length).map(([phase]) => phase);
	if (reachedNames.join(">") !== expectedPrefix.join(">")) {
		violations.push(
			`phases reached [${reachedNames.join(", ")}] are not a prefix of the production order [${PHASE_PAIRS.map(([p]) => p).join(", ")}]`,
		);
	}
	for (let i = 1; i < reached.length; i++) {
		const prevEnd = seqOf(reached[i - 1][2]);
		const thisStart = seqOf(reached[i][1]);
		if (prevEnd !== undefined && thisStart !== undefined && !(prevEnd < thisStart)) {
			violations.push(
				`${reached[i][0]} starts (seq ${thisStart}) before ${reached[i - 1][0]} ends (seq ${prevEnd}) — phases are sequential`,
			);
		}
	}
	// A FAILED phase must be the LAST reached one. Being a prefix of the phase
	// list is not enough on its own: `initialize_end ok=false` followed by a tidy
	// newSession → enforceModel → prompt is a perfect prefix and still describes a
	// driver that kept going after a phase failed, which ours never does.
	const okOf = (endName: string): boolean | undefined => {
		const e = owned.find((x) => x.event === endName);
		return e === undefined ? undefined : e.ok === true;
	};
	const failedIdx = reached.findIndex(([, , endName]) => okOf(endName) === false);
	if (failedIdx !== -1 && failedIdx !== reached.length - 1) {
		violations.push(
			`${reached[failedIdx][0]} failed but ${reached
				.slice(failedIdx + 1)
				.map(([p]) => p)
				.join(", ")} started after it — the driver stops at the first failing phase`,
		);
	}

	// The reply is logged by the runner AFTER driveProbeTurn returns, so the real
	// writer order is prompt_end → prompt_reply → window close. (The first cut
	// said "inside the prompt phase" and only checked prompt_start < reply, which
	// admitted a reply stamped before the phase had even ended.)
	const replySeq = seqOf(PROBE_EVENTS.promptReply);
	const promptEndSeq = seqOf(PROBE_EVENTS.promptEnd);
	const promptOk = okOf(PROBE_EVENTS.promptEnd);
	if (replySeq !== undefined && promptEndSeq !== undefined && !(promptEndSeq < replySeq)) {
		violations.push(`prompt_reply (seq ${replySeq}) does not follow prompt_end (seq ${promptEndSeq})`);
	}
	if (promptOk === true && countOf(PROBE_EVENTS.promptReply) !== 1) {
		violations.push(
			`prompt ended ok but prompt_reply appears ${countOf(PROBE_EVENTS.promptReply)} times — expected exactly one`,
		);
	}
	if (promptOk === false && countOf(PROBE_EVENTS.promptReply) !== 0) {
		violations.push("prompt FAILED yet a prompt_reply was stamped — there is no reply to record");
	}

	// The window closes BEFORE the run is declared over — the whole point is that
	// teardown may not happen while the marker could still land — and AFTER every
	// other runner marker, since it is the last thing stamped before teardown.
	const runStartSeq = seqOf(PROBE_EVENTS.runStart);
	const windowSeq = seqOf(PROBE_EVENTS.observationWindowEnd);
	const runEndSeq = seqOf(PROBE_EVENTS.runEnd);
	// run_start opens the run: nothing the runner does may precede it.
	const firstPhaseStartSeq = reached.length > 0 ? seqOf(reached[0][1]) : undefined;
	if (runStartSeq !== undefined && firstPhaseStartSeq !== undefined && !(runStartSeq < firstPhaseStartSeq)) {
		violations.push(
			`${reached[0][0]} starts (seq ${firstPhaseStartSeq}) before run_start (seq ${runStartSeq}) — run_start opens the run`,
		);
	}
	if (windowSeq !== undefined) {
		const laterThanWindow = owned.filter((e) => e.event !== PROBE_EVENTS.runEnd && e.seq > windowSeq);
		if (laterThanWindow.length > 0) {
			violations.push(
				`runner marker(s) ${laterThanWindow.map((e) => e.event).join(", ")} were stamped AFTER the observation window closed`,
			);
		}
	}
	if (runStartSeq !== undefined && windowSeq !== undefined && !(runStartSeq < windowSeq)) {
		violations.push(
			`${PROBE_EVENTS.observationWindowEnd} (seq ${windowSeq}) does not follow run_start (seq ${runStartSeq})`,
		);
	}
	if (windowSeq !== undefined && runEndSeq !== undefined && !(windowSeq < runEndSeq)) {
		violations.push(
			`run_end (seq ${runEndSeq}) does not follow ${PROBE_EVENTS.observationWindowEnd} (seq ${windowSeq}) — the window must close before the run does`,
		);
	}
	return violations;
}

/** Derive one run's facts from the shared log (events already parsed+sorted). */
export function deriveRunFacts(run: ProbeRunRecord, allEvents: ProbeEvent[]): RunFacts {
	const events = allEvents.filter((e) => e.runId === run.runId);
	const newSessionStartMs = eventTs(events, PROBE_EVENTS.newSessionStart);
	const newSessionEndEvent = events.find((e) => e.event === PROBE_EVENTS.newSessionEnd);
	const newSessionEndMs = newSessionEndEvent?.tsMs;
	const fixtureCall = events.find(
		(e) =>
			e.event === PROBE_EVENTS.fixtureToolsCallReceived &&
			e.tool === EXPECTED_SOURCE_TOOL &&
			e.probeRunId === run.probeRunId,
	);
	const acpCall = events.find((e) => e.event === PROBE_EVENTS.acpToolCallObserved && e.probeRunId === run.probeRunId);
	const noSuchTool = events.find((e) => e.event === PROBE_EVENTS.acpNoSuchTool);
	const reply = events.find((e) => e.event === PROBE_EVENTS.promptReply);
	const windowEnd = events.find((e) => e.event === PROBE_EVENTS.observationWindowEnd);
	const topology = runnerTopologyViolations(events);
	const wireForwardedMs = eventTs(events, PROBE_EVENTS.toolsListResponseForwarded);
	return {
		runId: run.runId,
		role: run.role,
		delayMs: run.delayMs,
		probeRunId: run.probeRunId,
		initialize: phaseFact(events, PROBE_EVENTS.initializeStart, PROBE_EVENTS.initializeEnd),
		newSession: phaseFact(events, PROBE_EVENTS.newSessionStart, PROBE_EVENTS.newSessionEnd),
		enforceModel: phaseFact(events, PROBE_EVENTS.setModelStart, PROBE_EVENTS.setModelEnd),
		prompt: phaseFact(events, PROBE_EVENTS.promptStart, PROBE_EVENTS.promptEnd),
		newSessionStartMs,
		newSessionEndMs,
		newSessionLatencyMs:
			newSessionStartMs !== undefined && newSessionEndMs !== undefined && newSessionEndEvent?.ok === true
				? newSessionEndMs - newSessionStartMs
				: undefined,
		promptStartMs: eventTs(events, PROBE_EVENTS.promptStart),
		promptEndMs: eventTs(events, PROBE_EVENTS.promptEnd),
		wireForwardedMs,
		fixtureToolCall: fixtureCall !== undefined,
		fixtureToolCallMs: fixtureCall?.tsMs,
		acpProviderToolId: typeof acpCall?.providerToolId === "string" ? acpCall.providerToolId : undefined,
		noSuchToolId: typeof noSuchTool?.toolId === "string" ? noSuchTool.toolId : undefined,
		nonceEchoed: reply?.carriesNonce === true,
		windowReason: windowEnd?.reason as ProbeWindowReason | undefined,
		windowMarkerSeen: typeof windowEnd?.markerSeen === "boolean" ? windowEnd.markerSeen : undefined,
		topologyViolations: topology,
		validityViolations: [...topology, ...windowCoherenceViolations(windowEnd, wireForwardedMs !== undefined)],
	};
}

function controlP0Reason(facts: RunFacts): string | undefined {
	if (!facts.initialize.ok) return "initialize";
	if (!facts.newSession.ok) return "newSession";
	if (!facts.enforceModel.ok) return "enforceModel";
	if (!facts.prompt.ok) return "prompt";
	// visible ∧ callable: the ACP-side tool_call (visibility + id measurement),
	// the fixture-side call marker (callability), and the end-to-end nonce echo.
	if (!facts.fixtureToolCall) return "tool-unavailable";
	if (facts.acpProviderToolId === undefined) return "tool-unavailable";
	if (!facts.nonceEchoed) return "nonce-missing";
	return undefined;
}

/** The three ordering comparisons. STRICT inequalities on both sides: the stamps
 *  come from different processes and the shared axis has millisecond resolution,
 *  so an equal-ms pair is unordered (probe-event-log sorts such ties by pid for
 *  stability only). Reading meaning into a tie would manufacture evidence. */
function orderingDeltas(facts: RunFacts): OrderingDeltas {
	const w = facts.wireForwardedMs;
	const n = facts.newSessionEndMs;
	const p = facts.promptStartMs;
	return {
		newSessionOrderingKept: w !== undefined && n !== undefined && w < n,
		newSessionRanAhead: w !== undefined && n !== undefined && n < w,
		promptRanAhead: w !== undefined && p !== undefined && p < w,
		newSessionAheadOfWireMs: w !== undefined && n !== undefined ? w - n : undefined,
		promptAheadOfWireMs: w !== undefined && p !== undefined ? w - p : undefined,
		postWireTurnMs: w !== undefined && facts.promptEndMs !== undefined ? facts.promptEndMs - w : undefined,
	};
}

/** Render the deltas so the ARTIFACT carries the observation, not just the
 *  classification. §11-7-b's first pair classified D1 correctly and still left a
 *  reader unable to see the 1.9 s ran-ahead or the 2.3 s of turn that remained
 *  after the wire marker: a diagnosability defect, separate from the verdict. */
function deltaEvidence(d: OrderingDeltas): string {
	const parts: string[] = [];
	parts.push(
		d.promptAheadOfWireMs === undefined
			? "promptStart↔wire unmeasured"
			: `promptStart ${d.promptAheadOfWireMs > 0 ? `${d.promptAheadOfWireMs}ms BEFORE` : `${-d.promptAheadOfWireMs}ms after`} wire`,
	);
	parts.push(
		d.newSessionAheadOfWireMs === undefined
			? "newSessionEnd↔wire unmeasured"
			: `newSessionEnd ${d.newSessionAheadOfWireMs > 0 ? `${d.newSessionAheadOfWireMs}ms BEFORE` : `${-d.newSessionAheadOfWireMs}ms after`} wire`,
	);
	if (d.postWireTurnMs !== undefined) parts.push(`${d.postWireTurnMs}ms of turn remained after wire`);
	return parts.join("; ");
}

function classifyIntervention(facts: RunFacts, expectedProviderToolId: string | undefined): InterventionReading {
	const deltas = orderingDeltas(facts);
	const base = { runId: facts.runId, delayMs: facts.delayMs, deltas };
	const invalid = (reason: RunInvalidReason, evidence: string): InterventionReading => ({
		...base,
		kind: "INVALIDATED",
		ordering: "censored",
		failure: "inconclusive",
		promotable: false,
		invalidReason: reason,
		evidence,
	});

	// Validity first: if the runner's own markers do not describe one coherent run
	// — topology OR a window close that contradicts the log — nothing read off
	// them is a measurement of anything. Same list the control is held to.
	if (facts.validityViolations.length > 0) {
		return invalid("topology", `run validity violated — ${facts.validityViolations.join(" | ")}`);
	}
	if (facts.delayMs <= 0 || facts.delayMs >= DELAY_WELL_BELOW_MS) {
		return {
			...base,
			kind: "inconclusive",
			ordering: "unknown",
			failure: "inconclusive",
			promotable: false,
			evidence: `delay ${facts.delayMs}ms is not 0 < D < ${DELAY_WELL_BELOW_MS}ms — D readings would measure our own timeouts`,
		};
	}
	// I0: the injected delay cannot reach initialize (servers ride newSession) —
	// an initialize failure here is environment drift, never a D.
	if (!facts.initialize.ok) {
		return {
			...base,
			kind: "I0",
			ordering: "unknown",
			failure: "inconclusive",
			promotable: false,
			evidence: facts.initialize.error ?? "initialize failed",
		};
	}
	// Phase-qualified fail-loud observations.
	for (const [kind, phase] of [
		["D-newSession", facts.newSession],
		["D-enforceModel", facts.enforceModel],
		["D-prompt", facts.prompt],
	] as const) {
		if (!phase.ok) {
			return {
				...base,
				kind,
				ordering: "unknown",
				failure: "inconclusive",
				promotable: false,
				evidence: phase.error ?? "failed",
			};
		}
	}

	// CENSORED — the window closed for a reason outside the marker, so a missing
	// marker says nothing about the server. This is the exact misattribution the
	// first LIVE pair produced: D2's child was torn down at turn end while the
	// fixture was still inside its injected delay, and a wire-marker-less run was
	// then filed as an MCP handshake / fixture / config candidate.
	if (!facts.windowMarkerSeen && facts.windowReason !== "deadline") {
		return invalid(
			"observation-window-closed",
			`the observation window closed on '${facts.windowReason}' with the wire marker unseen — right-censored, NOT a handshake/fixture/config candidate (${deltaEvidence(deltas)})`,
		);
	}

	// ---- axis (a): the server-wait observation ------------------------------
	const ordering: OrderingObservation =
		facts.wireForwardedMs === undefined
			? "unknown"
			: deltas.promptRanAhead
				? "prompt-request-ahead-of-wire"
				: deltas.newSessionOrderingKept
					? "wire-before-newSession-end"
					: deltas.newSessionRanAhead
						? "wire-before-prompt-request"
						: "unknown";

	// ---- axis (b): the callability reading ----------------------------------
	let failure: FailureReading;
	let promotable = false;
	let evidence: string;
	if (facts.fixtureToolCall) {
		// Callable in the end. Prompt-request-ahead + late success = C (late /
		// dynamic readiness with no client fence). The causal window is the PROMPT
		// comparison — used as a stated PREMISE, not as proof of when the model's
		// tool set was fixed; only §11-7-c's snapshot could show that.
		if (deltas.promptRanAhead) {
			failure = "C";
			evidence = `the prompt request was issued ahead of wire-availability and a later tools/call succeeded — ${deltaEvidence(deltas)}`;
		} else {
			failure = "callable";
			evidence =
				ordering === "wire-before-newSession-end"
					? `tools/list forwarded before newSession end — ${deltaEvidence(deltas)}`
					: `tools/call arrived and the prompt request was NOT issued ahead of the wire — ${deltaEvidence(deltas)}`;
		}
	} else if (facts.wireForwardedMs === undefined) {
		// Reachable ONLY under a sufficient window (the censored branch returned
		// above), so this really is the handshake/fixture/config candidate that
		// the §11-7 ladder describes rather than a self-inflicted absence.
		failure = "candidate-handshake";
		evidence = `no tools_list_response_forwarded although the window stayed open to its deadline — MCP handshake / fixture / config candidate, not server-behavior evidence`;
	} else if (facts.noSuchToolId !== undefined) {
		// The delta-table B is "the delayed run puts the turn AHEAD of
		// wire-availability and yields absence" — the ran-ahead half is part of the
		// verdict, not decoration (GPT review round 2, 2026-07-28), and its axis is
		// promptStart — the point at which WE issued the request. That it is also
		// when the model's tool set was fixed is a PREMISE this probe cannot yet
		// show; §11-7-c's snapshot is what would.
		if (
			deltas.promptRanAhead &&
			expectedProviderToolId !== undefined &&
			facts.noSuchToolId === expectedProviderToolId
		) {
			failure = "B";
			promotable = true;
			evidence = `prompt request issued ahead of wire-availability ∧ no fixture tools/call ∧ runtime No-such-tool for measured id ${expectedProviderToolId} — the delta-B failure mode with direct schema-absence evidence (${deltaEvidence(deltas)})`;
		} else if (expectedProviderToolId !== undefined && facts.noSuchToolId === expectedProviderToolId) {
			failure = "inconclusive";
			evidence = `direct No-such-tool for the measured id but the prompt request was NOT issued ahead of wire-availability (wire first, or a same-ms tie) — not the delayed-window failure mode; unlisted combination stays inconclusive (${deltaEvidence(deltas)})`;
		} else {
			// §11-7 ladder — a No-such-tool naming a bare/alias id proves nothing: the real
			// provider-bound id may have been in the schema all along.
			failure = "inconclusive";
			evidence = `No-such-tool named ${facts.noSuchToolId} but the measured provider-bound id is ${expectedProviderToolId ?? "unmeasured"} — model/alias mismatch, not absence evidence`;
		}
	} else {
		// No call marker, no direct runtime error. Model prose alone never promotes
		// — but the ORDERING observation above is unaffected by that, which is the
		// whole reason the two axes are reported separately now.
		failure = "inconclusive";
		evidence = `turn completed without tools/call and without a direct No-such-tool error — model-compliance / insufficient evidence for (b); the (a) comparison is '${ordering}' (${deltaEvidence(deltas)})`;
	}

	// Composite label, kept for the paired verdict and the A tally.
	const kind: InterventionReadingKind =
		failure === "B"
			? "B"
			: failure === "C"
				? "C"
				: failure === "callable" && ordering === "wire-before-newSession-end"
					? "ordering-kept"
					: "inconclusive";

	return { ...base, kind, ordering, failure, promotable, evidence };
}

/** Axis (a), summarized over the pair. Only JUDGEABLE interventions vote: an
 *  INVALIDATED (censored / topology) run has no ordering observation to give, and
 *  a phase failure never reached the comparison. Reported separately from the
 *  verdict so a settled ordering fact survives an unsettled (b) axis. */
/** Fatal validity + the two axes, derived once so no return site can disagree. */
function runStatus(
	validity: ProbeClassification["status"]["validity"],
	ordering: ProbeClassification["ordering"],
	failureVerdict: ProbeClassification["status"]["failureVerdict"],
	readings: InterventionReading[] = [],
): ProbeClassification["status"] {
	const orderingMeasurement: ProbeClassification["status"]["orderingMeasurement"] =
		ordering.summary === "unobserved"
			? ordering.perRun.some((r) => r.observation === "censored")
				? "censored"
				: "unobserved"
			: "measured";
	const invalidRuns = readings
		.filter((r) => r.kind === "INVALIDATED")
		.map((r) => ({ runId: r.runId, reason: r.invalidReason ?? "topology" }));
	// A pair that lost a run is not simply "valid" — the label has to carry it.
	const effective = validity === "valid" && invalidRuns.length > 0 ? "partial" : validity;
	const judged = effective === "valid" || effective === "partial";
	return {
		validity: effective,
		orderingMeasurement,
		failureVerdict: judged ? failureVerdict : "not-judged",
		invalidRuns,
	};
}

function summarizeOrdering(readings: InterventionReading[]): ProbeClassification["ordering"] {
	const perRun = readings.map((r) => ({ runId: r.runId, delayMs: r.delayMs, observation: r.ordering }));
	const voting = readings.filter(
		(r) =>
			r.ordering === "wire-before-newSession-end" ||
			r.ordering === "wire-before-prompt-request" ||
			r.ordering === "prompt-request-ahead-of-wire",
	);
	if (voting.length === 0) return { summary: "unobserved", perRun };
	if (voting.every((r) => r.ordering === "prompt-request-ahead-of-wire"))
		return { summary: "prompt-request-ahead-of-wire", perRun };
	if (voting.every((r) => r.ordering === "wire-before-newSession-end")) {
		return { summary: "wire-before-newSession-end", perRun };
	}
	return { summary: "mixed", perRun };
}

/** Classify one paired probe (control + interventions) into the §11-7 verdict. */
export function classifyProbe(runs: ProbeRunRecord[], events: ProbeEvent[]): ProbeClassification {
	const control = runs.find((r) => r.role === "control");
	if (!control) throw new Error("probe roster has no control run — a paired probe is control + interventions");
	const controlFacts = deriveRunFacts(control, events);
	const noOrdering: ProbeClassification["ordering"] = { summary: "unobserved", perRun: [] };

	// The control's own log must describe one coherent run before anything is read
	// off it — including the baseline the whole pair is a delta against.
	if (controlFacts.validityViolations.length > 0) {
		const why = controlFacts.validityViolations.join(" | ");
		return {
			control: { runId: control.runId, pass: false, p0Reason: "topology" },
			expectedProviderToolId: controlFacts.acpProviderToolId,
			interventions: [],
			verdict: "INVALIDATED",
			status: runStatus("INVALIDATED", noOrdering, "not-judged"),
			ordering: noOrdering,
			promotable: false,
			detail: `INVALIDATED (control validity): ${why} — the baseline log is not a description of one run, so nothing is judged.`,
		};
	}
	const p0Reason = controlP0Reason(controlFacts);
	if (p0Reason !== undefined) {
		return {
			control: { runId: control.runId, pass: false, p0Reason },
			expectedProviderToolId: controlFacts.acpProviderToolId,
			interventions: [],
			verdict: "P0",
			status: runStatus("P0", noOrdering, "not-judged"),
			ordering: noOrdering,
			promotable: false,
			detail:
				`P0 / INVALID BASELINE (reason=${p0Reason}): the delay=0 control is not a judgeable baseline — ` +
				"no intervention is judged; preserve the artifact and classify setup/pin/config/fixture/model-compliance first.",
		};
	}
	const expectedProviderToolId = controlFacts.acpProviderToolId;

	const interventionRuns = runs.filter((r) => r.role === "intervention");
	const readings = interventionRuns.map((r) => classifyIntervention(deriveRunFacts(r, events), expectedProviderToolId));
	const ordering = summarizeOrdering(readings);

	const controlResult = { control: { runId: control.runId, pass: true }, expectedProviderToolId, ordering };

	const i0 = readings.find((r) => r.kind === "I0");
	if (i0) {
		return {
			...controlResult,
			interventions: readings,
			verdict: "I0",
			status: runStatus("I0", ordering, "not-judged", readings),
			promotable: false,
			detail:
				`I0 / INVALID RUN (${i0.runId}): control passed but the intervention failed at initialize, which the ` +
				"injected delay cannot reach — environment drift. Re-run the same pair once; if it recurs, stop and root-cause.",
		};
	}

	// Every intervention invalidated → the pair measured nothing. A PARTIAL
	// invalidation does not stop the rest from being read (the (a) summary above
	// already excluded the censored runs), but it does block A below, which needs
	// every delay point it declares.
	const invalidated = readings.filter((r) => r.kind === "INVALIDATED");
	if (readings.length > 0 && invalidated.length === readings.length) {
		return {
			...controlResult,
			interventions: readings,
			verdict: "INVALIDATED",
			status: runStatus("INVALIDATED", ordering, "not-judged", readings),
			promotable: false,
			detail: `INVALIDATED: every intervention is outside the verdict space (${invalidated
				.map((r) => `${r.runId}=${r.invalidReason}`)
				.join(", ")}). Preserve the artifact; re-run the pair with the observation window honored.`,
		};
	}

	const decisive = readings.find((r) => r.kind === "B" || r.kind === "C" || r.kind.startsWith("D-"));
	if (decisive) {
		return {
			...controlResult,
			interventions: readings,
			verdict: decisive.kind as ProbeClassification["verdict"],
			status: runStatus("valid", ordering, decisive.failure, readings),
			promotable: decisive.promotable,
			detail: `${decisive.kind} on ${decisive.runId} (D=${decisive.delayMs}ms): ${decisive.evidence}`,
		};
	}

	// A path: every intervention kept ordering; the wait verdict additionally
	// needs ≥2 distinct nonzero delays whose newSession excess tracks D. An
	// invalidated run in the pair is disqualifying here — A is a claim about the
	// whole delay series, and a censored point is a missing point, not a passing one.
	const orderingKept = readings.filter((r) => r.kind === "ordering-kept");
	if (orderingKept.length !== readings.length || readings.length === 0) {
		return {
			...controlResult,
			interventions: readings,
			verdict: "inconclusive",
			status: runStatus("valid", ordering, "inconclusive", readings),
			promotable: false,
			detail:
				`no decisive (b) reading and not every intervention kept ordering — unlisted combination stays inconclusive for (b). ` +
				`The (a) ordering axis reads '${ordering.summary}': ${ordering.perRun
					.map((r) => `${r.runId}(D=${r.delayMs}ms)=${r.observation}`)
					.join(", ")}.`,
		};
	}
	const controlLatency = controlFacts.newSessionLatencyMs;
	const withExcess = orderingKept.map((r) => {
		const facts = deriveRunFacts(interventionRuns.find((run) => run.runId === r.runId) as ProbeRunRecord, events);
		const excess =
			controlLatency !== undefined && facts.newSessionLatencyMs !== undefined
				? facts.newSessionLatencyMs - controlLatency
				: undefined;
		return { ...r, newSessionExcessMs: excess };
	});
	const distinctDelays = new Set(withExcess.map((r) => r.delayMs));
	// Band per point: MIN_RATIO·D ≤ excess ≤ D + SLACK. A floor alone would call
	// a 10 s excess at D=2 s "tracking" — an overshoot is NOT wait-for-delay
	// evidence, it is some other stall.
	const inBand = withExcess.every(
		(r) =>
			r.newSessionExcessMs !== undefined &&
			r.newSessionExcessMs >= r.delayMs * A_LATENCY_TRACK_MIN_RATIO &&
			r.newSessionExcessMs <= r.delayMs + A_LATENCY_SLACK_MS,
	);
	// Growth across delays: excess must move WITH D between adjacent delays —
	// "latency shifts with D" is the whole discriminator (§11-7).
	const byDelay = [...withExcess].sort((a, b) => a.delayMs - b.delayMs);
	let growsWithD = true;
	for (let i = 1; i < byDelay.length; i++) {
		const dDelay = byDelay[i].delayMs - byDelay[i - 1].delayMs;
		const dExcess = (byDelay[i].newSessionExcessMs ?? 0) - (byDelay[i - 1].newSessionExcessMs ?? 0);
		if (dDelay > 0 && dExcess < dDelay * A_GROWTH_MIN_RATIO) growsWithD = false;
	}
	if (distinctDelays.size >= 2 && inBand && growsWithD) {
		return {
			...controlResult,
			interventions: withExcess,
			verdict: "A",
			status: runStatus("valid", ordering, "callable", readings),
			promotable: false,
			detail:
				"A: ordering kept and newSession latency tracks D across ≥2 delays — wait evidence ON THIS SERVER AND PATH, " +
				"not a general guarantee.",
		};
	}
	return {
		...controlResult,
		interventions: withExcess,
		verdict: "A-withheld",
		status: runStatus("valid", ordering, "callable", readings),
		promotable: false,
		detail:
			distinctDelays.size < 2
				? "ordering kept, but only one nonzero delay — scaling is unobservable, wait verdict WITHHELD (§11-7 requires D1 and D2)"
				: "ordering kept, but newSession latency does not track D (outside the [0.8·D, D+slack] band, or excess not growing with D) — wait verdict WITHHELD",
	};
}
