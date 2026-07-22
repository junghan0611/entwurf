/**
 * entwurf-peers-render — the PURE render/payload layer for the MCP `entwurf_peers`
 * surface (0.11 Stage 0 step 4, slice 4c). The MCP handler stays thin: it does IO
 * (readdir the meta-store + probe sockets via `listEntwurfFacts`) and then calls
 * THIS to shape the text + JSON. No IO here, so the gate drives it without a
 * filesystem and the SAME facts can feed pi-native / doctor / v2 dispatch later
 * (a handler that did its own brain work would deny them that reuse).
 *
 * Three hard rules carried from the frozen contract (동결결정 10):
 *   - FACTS ONLY, NO VERB-ROUTING. Neither the payload nor the text may carry a
 *     `sendable`/`resumable`/`dispatch`/`action`/`transport`/`mailboxDeliverable`
 *     field or word. Whether a target is sent-to or resumed is computed at call
 *     time by the entwurf_v2 dispatch table from `liveness` — baking it into the
 *     listing is exactly what makes `entwurf_peers` lie. The gate scans both the
 *     JSON keys AND the text for the forbidden words (a section title like
 *     "resumable peers" leaks routing that a key scan would miss).
 *   - THREE SECTIONS, NEVER MERGED. `peers` (citizens, 4-value liveness) and
 *     `socketOnly` (record-less sockets, 3-value liveness) are DISTINCT subjects
 *     (slice 2's two-array split); `diagnostics` is a third. Merging them into one
 *     array collapses the subject separation at the surface.
 *   - LEGACY `sessions` IS A PROJECTION OF FACTS, not a second scan. We do NOT
 *     re-run the old `getLiveSessions` (a separate live-socket scan would bypass
 *     the provider's quarantine — a non-pi citizen colliding with a socket, which
 *     `listEntwurfFacts` removes from BOTH normal arrays, could reappear in
 *     `sessions`). `sessions` is derived from the SAME facts: alive pi citizens +
 *     alive socket-only entries. Its socketPath is built by `controlSocketPath`
 *     (the SSOT helper), never re-concatenated, so the filename↔gardenId
 *     correlation authority (동결결정3) cannot drift between scan and render.
 */

import type { EntwurfDiagnostic, EntwurfFactsResult } from "./entwurf-fact-provider.ts";
import type { PeerFact, SocketOnlyFact } from "./entwurf-facts.ts";
import { controlSocketPath } from "./socket-discovery.ts";

/** The legacy-compatible active-session shape (sessionId + socketPath), retained
 * for old consumers. A PROJECTION of the facts (alive only), not a second scan. */
export interface LegacySession {
	sessionId: string;
	socketPath: string;
}

/** The full `entwurf_peers` JSON payload. `sessions` is the legacy projection;
 * `peers`/`socketOnly`/`diagnostics` are the additive facts surface. NO
 * verb-routing field anywhere (the gate enforces this by deep key scan). */
export interface EntwurfPeersPayload {
	controlDir: string;
	count: number;
	sessions: LegacySession[];
	peers: PeerFact[];
	socketOnly: SocketOnlyFact[];
	diagnostics: EntwurfDiagnostic[];
}

export interface EntwurfPeersRender {
	text: string;
	payload: EntwurfPeersPayload;
}

/**
 * Derive the legacy `sessions` projection from the facts: an active session is an
 * alive pi citizen OR an alive record-less socket. `peers` and `socketOnly` are
 * gid-disjoint (resolveFactList guarantees a gid is in one or the other, never
 * both), so the concatenation needs no dedup. socketPath via `controlSocketPath`
 * (SSOT). Sorted by sessionId for determinism.
 */
function deriveSessions(peers: PeerFact[], socketOnly: SocketOnlyFact[], controlDir: string): LegacySession[] {
	const sessions: LegacySession[] = [];
	for (const p of peers) {
		if (p.backend === "pi" && p.liveness === "alive") {
			sessions.push({ sessionId: p.gardenId, socketPath: controlSocketPath(p.gardenId, controlDir) });
		}
	}
	for (const s of socketOnly) {
		if (s.liveness === "alive") {
			sessions.push({ sessionId: s.gardenId, socketPath: controlSocketPath(s.gardenId, controlDir) });
		}
	}
	sessions.sort((a, b) => (a.sessionId < b.sessionId ? -1 : a.sessionId > b.sessionId ? 1 : 0));
	return sessions;
}

function renderPeerLine(p: PeerFact): string {
	const model = p.model ?? "(unknown)";
	return `- ${p.gardenId}  backend=${p.backend}  liveness=${p.liveness}  cwd=${p.cwd}  model=${model}`;
}

function renderSocketOnlyLine(s: SocketOnlyFact): string {
	// Null enrich is "(not enriched)" — NOT "(unknown)", which would read as
	// identity-unknown rather than not-yet-fetched / not available for this socket.
	const cwd = s.cwd ?? "(not enriched)";
	const model = s.model ?? "(not enriched)";
	const idle = s.idle === null ? "" : `  idle=${s.idle ? "yes" : "no"}`;
	const infoError = s.infoError === null ? "" : `  infoError=${s.infoError}`;
	return `- ${s.gardenId}  liveness=${s.liveness}  cwd=${cwd}  model=${model}${idle}${infoError}`;
}

function renderDiagnosticLine(d: EntwurfDiagnostic): string {
	switch (d.kind) {
		case "meta-record-read-error":
			return `- meta-record-read-error ${d.filename}: ${d.message}`;
		case "garden-id-socket-conflict":
			return `- garden-id-socket-conflict ${d.gardenId} (backend=${d.backend}): ${d.message}`;
		case "socket-symlink-rejected":
			return `- socket-symlink-rejected ${d.gardenId}: ${d.message}`;
		case "malformed-socket-name":
			return `- malformed-socket-name ${d.name}: ${d.message}`;
		case "socket-dir-read-error":
			return `- socket-dir-read-error: ${d.message}`;
	}
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
 * `controlDir` is the same directory the socket scan used — passing it here (not
 * re-deriving) keeps the socketPath SSOT.
 */
export function renderEntwurfPeers(result: EntwurfFactsResult, controlDir: string): EntwurfPeersRender {
	const { peers, socketOnly } = result.facts;
	const { diagnostics } = result;
	const sessions = deriveSessions(peers, socketOnly, controlDir);

	const text = [
		section("Garden citizens (meta-record):", peers.map(renderPeerLine), { compact: true }),
		"",
		section("Socket-only control sockets (no meta-record):", socketOnly.map(renderSocketOnlyLine), { compact: true }),
		"",
		section("Diagnostics:", diagnostics.map(renderDiagnosticLine)),
	].join("\n");

	const payload: EntwurfPeersPayload = {
		controlDir,
		count: sessions.length,
		sessions,
		peers,
		socketOnly,
		diagnostics,
	};
	return { text, payload };
}
