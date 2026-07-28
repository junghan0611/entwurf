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
// Pure on purpose: no IO, no clocks — the deterministic gate replays synthetic
// logs through this exact module.

import { PROBE_EVENTS, PROBE_EXPECTED_TOOL, type ProbeEvent } from "./probe-event-log.ts";

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
	/** ts of tools_list_response_forwarded — THE wire-availability marker. */
	wireForwardedMs?: number;
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
	| "D-newSession"
	| "D-enforceModel"
	| "D-prompt"
	| "B"
	| "C"
	| "ordering-kept"
	| "inconclusive";

export interface InterventionReading {
	runId: string;
	delayMs: number;
	kind: InterventionReadingKind;
	/** Only a B backed by the exact §11-7 marker combination may enter the
	 *  readiness ledger. */
	promotable: boolean;
	evidence: string;
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
		| "A"
		| "A-withheld"
		| "B"
		| "C"
		| "D-newSession"
		| "D-enforceModel"
		| "D-prompt"
		| "inconclusive";
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
		wireForwardedMs: eventTs(events, PROBE_EVENTS.toolsListResponseForwarded),
		fixtureToolCall: fixtureCall !== undefined,
		fixtureToolCallMs: fixtureCall?.tsMs,
		acpProviderToolId: typeof acpCall?.providerToolId === "string" ? acpCall.providerToolId : undefined,
		noSuchToolId: typeof noSuchTool?.toolId === "string" ? noSuchTool.toolId : undefined,
		nonceEchoed: reply?.carriesNonce === true,
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

function classifyIntervention(facts: RunFacts, expectedProviderToolId: string | undefined): InterventionReading {
	const base = { runId: facts.runId, delayMs: facts.delayMs };
	if (facts.delayMs <= 0 || facts.delayMs >= DELAY_WELL_BELOW_MS) {
		return {
			...base,
			kind: "inconclusive",
			promotable: false,
			evidence: `delay ${facts.delayMs}ms is not 0 < D < ${DELAY_WELL_BELOW_MS}ms — D readings would measure our own timeouts`,
		};
	}
	// I0: the injected delay cannot reach initialize (servers ride newSession) —
	// an initialize failure here is environment drift, never a D.
	if (!facts.initialize.ok) {
		return { ...base, kind: "I0", promotable: false, evidence: facts.initialize.error ?? "initialize failed" };
	}
	// Phase-qualified fail-loud observations.
	if (!facts.newSession.ok) {
		return { ...base, kind: "D-newSession", promotable: false, evidence: facts.newSession.error ?? "failed" };
	}
	if (!facts.enforceModel.ok) {
		return { ...base, kind: "D-enforceModel", promotable: false, evidence: facts.enforceModel.error ?? "failed" };
	}
	if (!facts.prompt.ok) {
		return { ...base, kind: "D-prompt", promotable: false, evidence: facts.prompt.error ?? "failed" };
	}

	// STRICT inequalities on both sides: the two stamps come from different
	// processes and the shared axis has millisecond resolution, so an equal-ms
	// pair is unordered (probe-event-log sorts such ties by pid for stability
	// only). Reading meaning into a tie would manufacture ordering evidence.
	const ranAhead =
		facts.wireForwardedMs !== undefined &&
		facts.newSessionEndMs !== undefined &&
		facts.newSessionEndMs < facts.wireForwardedMs;
	const orderingKept =
		facts.wireForwardedMs !== undefined &&
		facts.newSessionEndMs !== undefined &&
		facts.wireForwardedMs < facts.newSessionEndMs;

	if (facts.fixtureToolCall) {
		// Callable in the end. Ahead-of-wire + late success = C (late/dynamic
		// readiness without a client fence); wire-before-newSession-end = the
		// A-side ordering observation (wait verdict needs D-scaling on top).
		if (ranAhead) {
			return {
				...base,
				kind: "C",
				promotable: false,
				evidence: "turn ran ahead of wire-availability, later tools/call succeeded",
			};
		}
		if (orderingKept) {
			return {
				...base,
				kind: "ordering-kept",
				promotable: false,
				evidence: "tools/list forwarded before newSession end",
			};
		}
		return {
			...base,
			kind: "inconclusive",
			promotable: false,
			evidence:
				"tools/call arrived but wire-forwarded and newSession end are not strictly ordered — missing marker or a same-ms cross-process tie, which is unordered at this resolution",
		};
	}

	// Absence branch. B is ONLY the marker-grade §11-7 combination — the delta
	// table's B is a SUFFICIENCY claim, and an unestablished failure mode cannot
	// carry it: rail doc :631 files a wire-marker-less run as an MCP handshake /
	// fixture / config CANDIDATE, and :638 keeps every unlisted combination
	// inconclusive by default. (The first cut here read no-wire as a
	// non-promotable B; GPT review 2026-07-28 caught the conflict.)
	if (facts.wireForwardedMs === undefined) {
		return {
			...base,
			kind: "inconclusive",
			promotable: false,
			evidence:
				"no tools_list_response_forwarded — MCP handshake / fixture / config candidate, not server-behavior evidence",
		};
	}
	if (facts.noSuchToolId !== undefined) {
		// The delta-table B is "the delayed run puts the turn AHEAD of
		// wire-availability and yields absence" — ranAhead is part of the verdict,
		// not decoration (GPT review round 2, 2026-07-28). An exact-id absence
		// with ordering kept (or a same-ms tie) is a different, unlisted finding.
		if (ranAhead && expectedProviderToolId !== undefined && facts.noSuchToolId === expectedProviderToolId) {
			return {
				...base,
				kind: "B",
				promotable: true,
				evidence: `ran ahead of wire-availability ∧ no fixture tools/call ∧ runtime No-such-tool for measured id ${expectedProviderToolId} — the delta-B failure mode with direct schema-absence evidence`,
			};
		}
		if (expectedProviderToolId !== undefined && facts.noSuchToolId === expectedProviderToolId) {
			return {
				...base,
				kind: "inconclusive",
				promotable: false,
				evidence:
					"direct No-such-tool for the measured id but the turn did NOT run ahead of wire-availability (ordering kept or same-ms tie) — not the delayed-window failure mode; unlisted combination stays inconclusive",
			};
		}
		// :634 — a No-such-tool naming a bare/alias id proves nothing: the real
		// provider-bound id may have been in the schema all along.
		return {
			...base,
			kind: "inconclusive",
			promotable: false,
			evidence: `No-such-tool named ${facts.noSuchToolId} but the measured provider-bound id is ${expectedProviderToolId ?? "unmeasured"} — model/alias mismatch, not absence evidence`,
		};
	}
	// No call marker, no direct runtime error — model prose alone never promotes,
	// and without a marker-grade absence signal it does not even read as B.
	return {
		...base,
		kind: "inconclusive",
		promotable: false,
		evidence:
			"turn completed without tools/call, without a direct No-such-tool error — model-compliance / insufficient evidence",
	};
}

/** Classify one paired probe (control + interventions) into the §11-7 verdict. */
export function classifyProbe(runs: ProbeRunRecord[], events: ProbeEvent[]): ProbeClassification {
	const control = runs.find((r) => r.role === "control");
	if (!control) throw new Error("probe roster has no control run — a paired probe is control + interventions");
	const controlFacts = deriveRunFacts(control, events);
	const p0Reason = controlP0Reason(controlFacts);
	if (p0Reason !== undefined) {
		return {
			control: { runId: control.runId, pass: false, p0Reason },
			expectedProviderToolId: controlFacts.acpProviderToolId,
			interventions: [],
			verdict: "P0",
			promotable: false,
			detail:
				`P0 / INVALID BASELINE (reason=${p0Reason}): the delay=0 control is not a judgeable baseline — ` +
				"no intervention is judged; preserve the artifact and classify setup/pin/config/fixture/model-compliance first.",
		};
	}
	const expectedProviderToolId = controlFacts.acpProviderToolId;

	const interventionRuns = runs.filter((r) => r.role === "intervention");
	const readings = interventionRuns.map((r) => classifyIntervention(deriveRunFacts(r, events), expectedProviderToolId));

	const controlResult = { control: { runId: control.runId, pass: true }, expectedProviderToolId };

	const i0 = readings.find((r) => r.kind === "I0");
	if (i0) {
		return {
			...controlResult,
			interventions: readings,
			verdict: "I0",
			promotable: false,
			detail:
				`I0 / INVALID RUN (${i0.runId}): control passed but the intervention failed at initialize, which the ` +
				"injected delay cannot reach — environment drift. Re-run the same pair once; if it recurs, stop and root-cause.",
		};
	}

	const decisive = readings.find((r) => r.kind === "B" || r.kind === "C" || r.kind.startsWith("D-"));
	if (decisive) {
		return {
			...controlResult,
			interventions: readings,
			verdict: decisive.kind as ProbeClassification["verdict"],
			promotable: decisive.promotable,
			detail: `${decisive.kind} on ${decisive.runId} (D=${decisive.delayMs}ms): ${decisive.evidence}`,
		};
	}

	// A path: every intervention kept ordering; the wait verdict additionally
	// needs ≥2 distinct nonzero delays whose newSession excess tracks D.
	const orderingKept = readings.filter((r) => r.kind === "ordering-kept");
	if (orderingKept.length !== readings.length || readings.length === 0) {
		return {
			...controlResult,
			interventions: readings,
			verdict: "inconclusive",
			promotable: false,
			detail: "no decisive reading and not every intervention kept ordering — unlisted combination stays inconclusive",
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
		promotable: false,
		detail:
			distinctDelays.size < 2
				? "ordering kept, but only one nonzero delay — scaling is unobservable, wait verdict WITHHELD (§11-7 requires D1 and D2)"
				: "ordering kept, but newSession latency does not track D (outside the [0.8·D, D+slack] band, or excess not growing with D) — wait verdict WITHHELD",
	};
}
