/**
 * entwurf-peers-render — the PURE render/payload layer for the MCP `entwurf_peers`
 * surface (0.11 Stage 0 step 4, slice 4c). The MCP handler stays thin: it does IO
 * (readdir the meta-store + probe sockets via `listEntwurfFacts`) and then calls
 * THIS to shape the text + JSON. No IO here, so the gate drives it without a
 * filesystem and the SAME facts can feed pi-native / doctor / v2 dispatch later
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

function renderPeerLine(p: PeerFact): string {
	const model = p.model ?? "(unknown)";
	return `- ${p.gardenId}  backend=${p.backend}  liveness=${p.liveness}  cwd=${p.cwd}  model=${model}`;
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
 * subject sample. An unmigrated pre-cut store degrades every record identically, and
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

function compactLines(lines: string[], max: number = 32): string[] {
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
export function renderEntwurfPeers(result: EntwurfFactsResult): EntwurfPeersRender {
	const { peers } = result.facts;
	const { diagnostics } = result;

	const text = [
		section("Garden citizens (meta-record):", peers.map(renderPeerLine), { compact: true }),
		"",
		section("Diagnostics:", renderDiagnosticLines(diagnostics)),
	].join("\n");

	const payload: EntwurfPeersPayload = { peers, diagnostics };
	return { text, payload };
}
