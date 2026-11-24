/**
 * entwurf-peers-render — the PURE render/payload layer for the MCP `entwurf_peers`
 * surface (0.11 Stage 0 step 4, slice 4c). The MCP handler stays thin: it does IO
 * (readdir the meta-store + probe sockets via `listEntwurfFacts`) and then calls
 * THIS to shape the text + JSON. No IO here, so the gate drives it without a
 * filesystem and the SAME facts can feed the bridge / doctor / v2 dispatch
 * (a handler that did its own brain work would deny them that reuse).
 *
 * Two hard rules carried from the frozen contract (동결결정 10 + #50 C4):
 *   - FACTS ONLY, NO VERB-ROUTING. Neither the payload nor the text may carry a
 *     `sendable`/`resumable`/`dispatch`/`action`/`transport`/`mailboxDeliverable`
 *     field or word. Whether a target is sent-to or resumed is computed at call
 *     time by the entwurf_v2 dispatch table from `liveness` — baking it into the
 *     listing is exactly what makes `entwurf_peers` lie. The gate scans both the
 *     JSON keys AND the text for the forbidden words (a section title like
 *     "resumable peers" leaks routing that a key scan would miss).
 *   - CITIZENS AND DIAGNOSTICS, NEVER MERGED. `peers` (citizens, 4-value
 *     liveness) is the ONLY identity section; `diagnostics` is the other. The
 *     record is the sole address axis (#50 C4), so nothing socket-shaped appears
 *     as identity: the old socket-only section is a `record-less-socket`
 *     diagnostic now, and the legacy `sessions` projection (sessionId +
 *     socketPath rows — the pre-record socket-scan worldview) is gone with the
 *     `controlDir` it exposed. Socket paths are dispatch-internal transport.
 */

import type { EntwurfDiagnostic, EntwurfFactsResult } from "./entwurf-fact-provider.ts";
import type { PeerFact } from "./entwurf-facts.ts";
import { renderPlacement } from "./herdr-placement.ts";
import { bookmarkLabel, type PeersDisplayPlan, type PeersDisplayRow, renderActivity } from "./peer-presentation.ts";

/** The full `entwurf_peers` JSON payload: citizens + diagnostics, nothing else.
 * NO verb-routing field anywhere (the gate enforces this by deep key scan) and
 * NO socket path / socket-derived identity row (#50 C4). */
export interface EntwurfPeersPayload {
	peers: PeerFact[];
	diagnostics: EntwurfDiagnostic[];
}

export interface EntwurfPeersRender {
	text: string;
	payload: EntwurfPeersPayload;
}

/** Human rows and expensive provider observations share this one presentation budget. */
export const ENTWURF_PEERS_RENDER_LIMIT = 32;

// `receiver` and `transcript` are OBSERVED facts, not routing (#101): they say what was
// found on disk for this citizen, and a caller still asks entwurf_v2 what may be done
// about it. They earn a column because for every claude-code row `liveness` reads
// `unsupported` — the socket probe does not apply — so two rows in one cwd, a live
// conversation and an abandoned startup session whose transcript was never written, used to
// be indistinguishable here. `receiver=active|inactive|none|n/a` is a projection of the
// same measurement dispatch uses; `transcript=exists|absent` is the record's transcript,
// existence only, never the path.
//
// `placement` (#116 S1) is the third observed fact and the one most likely to be
// MISREAD, so it is placed at the END of the row — away from `liveness` — and printed
// as `herdr <pane>` rather than a bare pane id. A pane says where a citizen was last
// SEEN by a placement owner; it says nothing about whether that citizen is running, and
// nothing about how to reach it. `unobserved` = nobody looked (no herdr here), `none` =
// herdr was read and does not have this one, `ambiguous` = more than one pane claimed it.
function renderPeerLine(p: PeerFact): string {
	const model = p.model ?? "(unknown)";
	return (
		`- ${p.gardenId}  backend=${p.backend}  liveness=${p.liveness}  receiver=${p.receiver}  ` +
		`transcript=${p.transcript}  cwd=${p.cwd}  model=${model}  placement=${renderPlacement(p.placement)}`
	);
}

// A planned row is the same fact line with two more observed facts at its end. `activity` is the
// key the rows are ordered by — the mtime of the citizen's current transcript, or the record's
// update time where there is none — printed because an order nobody can see is an order nobody can
// check. `bookmark` is the name the caller's own team.json gives this garden id: a label for the
// eye, encoded as one quoted token, and neither an identity nor an address.
function renderPlannedPeerLine(row: PeersDisplayRow): string {
	return (
		`${renderPeerLine(row.peer)}  activity=${renderActivity(row.activityMs)}` +
		(row.bookmark === null ? "" : `  bookmark=${bookmarkLabel(row.bookmark)}`)
	);
}

/** The counted remainder of a planned listing. Fixed sentences; the only data in them are counts,
 * a limit and the temp root this host resolved. Nothing here says what can be done with a citizen. */
function renderPlanNotes(plan: PeersDisplayPlan, limit: number): string[] {
	const notes: string[] = [];
	if (plan.outsideBudget > 0) {
		notes.push(
			`  … ${plan.outsideBudget} more ${plan.outsideBudget === 1 ? "citizen" : "citizens"} outside this ${limit}-row budget (every row: entwurf peer-facts)`,
		);
	}
	if (plan.testRooms > 0) {
		notes.push(
			// Fixed words only: the temp root is a path from the environment and may hold a line break or
			// an escape, so it is never printed here.
			`  … ${plan.testRooms} test ${plan.testRooms === 1 ? "room" : "rooms"} not shown (record cwd under the OS temp directory)`,
		);
	}
	if (plan.bookmarksWithoutRecord > 0) {
		notes.push(`  … bookmarks without a record: ${plan.bookmarksWithoutRecord}`);
	}
	if (plan.bookmarkNote?.kind === "caller-directory-unknown") {
		notes.push("  … bookmarks: the caller directory is not known for this request; listed without bookmarks");
	} else if (plan.bookmarkNote?.kind === "unreadable") {
		notes.push(
			`  … bookmarks: team.json in the caller directory could not be read (${plan.bookmarkNote.code}); listed without bookmarks`,
		);
	}
	return notes;
}

function renderDiagnosticLine(d: EntwurfDiagnostic): string {
	switch (d.kind) {
		case "meta-record-read-error":
			return `- meta-record-read-error ${d.filename}: ${d.message}`;
		case "garden-id-socket-conflict":
			return `- garden-id-socket-conflict ${d.gardenId} (backend=${d.backend}): ${d.message}`;
		case "record-less-socket":
			return `- record-less-socket ${d.gardenId} (${d.liveness}): ${d.message}`;
		case "socket-symlink-rejected":
			return `- socket-symlink-rejected ${d.gardenId}: ${d.message}`;
		case "malformed-socket-name":
			return `- malformed-socket-name ${d.name}: ${d.message}`;
		case "socket-dir-read-error":
			return `- socket-dir-read-error: ${d.message}`;
	}
}

/** The per-diagnostic subject (the thing the shared message is ABOUT). */
function diagnosticSubject(d: EntwurfDiagnostic): string {
	switch (d.kind) {
		case "meta-record-read-error":
			return d.filename;
		case "garden-id-socket-conflict":
		case "record-less-socket":
		case "socket-symlink-rejected":
			return d.gardenId;
		case "malformed-socket-name":
			return d.name;
		case "socket-dir-read-error":
			return "";
	}
}

const DIAGNOSTIC_SAMPLE_MAX = 3;

/**
 * Group diagnostics sharing (kind + message) into ONE line carrying the count and a
 * subject sample. A store left from a previous generation degrades every record identically, and
 * repeating that sentence per record buried the one citizen line under 177 copies of
 * it (F8) — the aggregated form says how many + which fix ONCE. A group of one renders
 * exactly the classic per-item line; distinct messages stay distinct lines, and the
 * JSON payload keeps every individual diagnostic (aggregation is text-only). The
 * `record-less-socket` messages are liveness-keyed for exactly this reason: same-state
 * sockets share a message and fold into one line per liveness.
 */
function renderDiagnosticLines(diagnostics: EntwurfDiagnostic[]): string[] {
	const groups = new Map<string, EntwurfDiagnostic[]>();
	for (const d of diagnostics) {
		const key = `${d.kind}:${d.message}`;
		const group = groups.get(key);
		if (group) group.push(d);
		else groups.set(key, [d]);
	}
	const lines: string[] = [];
	for (const group of groups.values()) {
		const first = group[0] as EntwurfDiagnostic;
		if (group.length === 1) {
			lines.push(renderDiagnosticLine(first));
			continue;
		}
		const subjects = group.map(diagnosticSubject).filter((s) => s.length > 0);
		const sample = subjects.slice(0, DIAGNOSTIC_SAMPLE_MAX).join(", ");
		const omitted = subjects.length - Math.min(subjects.length, DIAGNOSTIC_SAMPLE_MAX);
		const suffix = subjects.length > 0 ? ` (${sample}${omitted > 0 ? `, … +${omitted} more` : ""})` : "";
		lines.push(`- ${first.kind} ×${group.length}: ${first.message}${suffix}`);
	}
	return lines;
}

function compactLines(lines: string[], max: number = ENTWURF_PEERS_RENDER_LIMIT): string[] {
	if (lines.length <= max) return lines;
	const omitted = lines.length - max;
	return [`  … (${omitted} older entries omitted; showing latest ${max})`, ...lines.slice(-max)];
}

function section(title: string, lines: string[], opts: { compact?: boolean } = {}): string {
	// Empty sections render "(none)" — hiding them would erase the honesty the
	// listing exists to provide (especially diagnostics: "(none)" is a trust
	// signal, and an `unsupported` peer must never be silently dropped).
	const rendered = opts.compact ? compactLines(lines) : lines;
	return rendered.length > 0 ? `${title}\n${rendered.join("\n")}` : `${title}\n  (none)`;
}

/**
 * Shape the facts into the `entwurf_peers` text + JSON. Pure over its inputs.
 * The provider has already folded every record-less socket into a
 * `record-less-socket` diagnostic (#50 C4), so `facts.recordLessSockets` is not
 * re-rendered here — diagnostics are the single channel for non-citizen state.
 */
export function renderEntwurfPeers(
	result: Pick<EntwurfFactsResult, "facts" | "diagnostics">,
	plan?: PeersDisplayPlan,
): EntwurfPeersRender {
	const { peers } = result.facts;
	const { diagnostics } = result;

	// With a plan (#173 P2) the citizen section prints exactly the plan's rows in the plan's order
	// and then what it left out, counted. Without one it is the listing it always was. The payload
	// is every row either way.
	const citizens =
		plan === undefined
			? section("Garden citizens (meta-record):", peers.map(renderPeerLine), { compact: true })
			: section("Garden citizens (meta-record):", [
					...plan.rows.map(renderPlannedPeerLine),
					...renderPlanNotes(plan, ENTWURF_PEERS_RENDER_LIMIT),
				]);
	const text = [citizens, "", section("Diagnostics:", renderDiagnosticLines(diagnostics))].join("\n");

	const payload: EntwurfPeersPayload = { peers, diagnostics };
	return { text, payload };
}
