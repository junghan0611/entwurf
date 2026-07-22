/**
 * check-entwurf-peers-surface — deterministic gate for the MCP + pi-native `entwurf_peers`
 * RENDER/PAYLOAD layer (0.11 Stage 0 step 4, slice 4c). Drives the PURE
 * `renderEntwurfPeers` with a fabricated `EntwurfFactsResult` (no IO) and proves
 * the surface contract (GPi + Fable 수렴):
 *
 *   - legacy `sessions` is a PROJECTION of the facts (alive pi citizens + alive
 *     socket-only), NOT a second scan — dead / indeterminate / unsupported /
 *     non-pi never appear in it,
 *   - sessions[].socketPath === controlSocketPath(gid, dir) — SSOT, no re-concat
 *     drift of the filename↔gardenId correlation authority (동결결정3, Fable a),
 *   - count === sessions.length (the legacy projection count, NOT peers.length;
 *     Fable d),
 *   - three DISTINCT arrays (peers / socketOnly / diagnostics), never merged,
 *   - NO verb-routing field anywhere in the JSON (deep key scan) AND no
 *     verb-routing WORD in the text render (Fable e①: a "resumable peers" title
 *     leaks routing a key scan would miss),
 *   - diagnostics appear in BOTH the text and the JSON,
 *   - empty sections render "(none)"; an `unsupported` peer is shown (never
 *     dropped); socket-only enrich null renders "(not enriched)",
 *   - WIRING guard (Fable e②/6): the MCP handler and pi-native tool call
 *     listEntwurfFacts + renderEntwurfPeers, and the old getLiveSessions is gone from the bridge.
 *
 * No IO — the facts are fabricated; only the wiring guard reads the bridge source
 * as text (a static assertion, not an execution).
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import type { EntwurfFactsResult } from "../pi-extensions/lib/entwurf-fact-provider.ts";
import type { PeerFact, SocketOnlyFact } from "../pi-extensions/lib/entwurf-facts.ts";
import { renderEntwurfPeers } from "../pi-extensions/lib/entwurf-peers-render.ts";
import type { FactLiveness } from "../pi-extensions/lib/entwurf-v2-contract.ts";
import type { MetaBackendV2 } from "../pi-extensions/lib/meta-session.ts";
import { controlSocketPath } from "../pi-extensions/lib/socket-discovery.ts";

let passed = 0;
function ok(label: string, cond: boolean): void {
	assert.ok(cond, label);
	console.log(`  ok    ${label}`);
	passed++;
}

const DIR = "/fake/entwurf-control";
const FORBIDDEN = ["sendable", "resumable", "dispatch", "action", "transport", "mailboxDeliverable"];

function peer(gardenId: string, backend: MetaBackendV2, liveness: FactLiveness): PeerFact {
	return {
		gardenId,
		backend,
		nativeSessionId: `n-${gardenId}`,
		cwd: "/x",
		model: null,
		createdAt: "2026-06-11T00:00:00.000Z",
		recordUpdatedAt: "2026-06-11T00:00:00.000Z",
		liveness,
	};
}

function socketOnly(
	gardenId: string,
	liveness: SocketOnlyFact["liveness"],
	over: Partial<SocketOnlyFact> = {},
): SocketOnlyFact {
	return { kind: "socket-only", gardenId, liveness, cwd: null, model: null, idle: null, infoError: null, ...over };
}

/** Recursively collect every object key in a JSON-able value. */
function allKeys(value: unknown, acc: Set<string> = new Set()): Set<string> {
	if (Array.isArray(value)) {
		for (const v of value) allKeys(v, acc);
	} else if (value && typeof value === "object") {
		for (const [k, v] of Object.entries(value)) {
			acc.add(k);
			allKeys(v, acc);
		}
	}
	return acc;
}

const GID_PI_ALIVE = "20260611T111111-aaaaaa"; // pi alive → in sessions
const GID_PI_DEAD = "20260611T222222-bbbbbb"; // pi dead (dormant) → NOT in sessions
const GID_PI_INDET = "20260611T333333-cccccc"; // pi indeterminate → NOT in sessions
const GID_CLAUDE = "20260611T444444-dddddd"; // claude unsupported → shown, NOT in sessions
const GID_SOCK_ALIVE = "20260611T555555-eeeeee"; // socket-only alive → in sessions
const GID_SOCK_DEAD = "20260611T666666-ffffff"; // socket-only dead → shown, NOT in sessions

function main(): void {
	const result: EntwurfFactsResult = {
		facts: {
			peers: [
				peer(GID_PI_ALIVE, "pi", "alive"),
				peer(GID_PI_DEAD, "pi", "dead"),
				peer(GID_PI_INDET, "pi", "indeterminate"),
				peer(GID_CLAUDE, "claude-code", "unsupported"),
			],
			socketOnly: [
				socketOnly(GID_SOCK_ALIVE, "alive", { cwd: "/work/cos", model: "gpt-5.4", idle: false }),
				socketOnly(GID_SOCK_DEAD, "dead", { infoError: "get_info failed" }),
			],
		},
		diagnostics: [{ kind: "socket-symlink-rejected", gardenId: "20260611T999999-999999", message: "symlink rejected" }],
	};

	const { text, payload } = renderEntwurfPeers(result, DIR);

	// ── legacy sessions = projection of facts (alive only) ──────────────────────
	const sessGids = payload.sessions.map((s) => s.sessionId);
	ok("sessions: alive pi citizen included", sessGids.includes(GID_PI_ALIVE));
	ok("sessions: alive socket-only included", sessGids.includes(GID_SOCK_ALIVE));
	ok("sessions: dead pi citizen NOT included", !sessGids.includes(GID_PI_DEAD));
	ok("sessions: indeterminate pi citizen NOT included", !sessGids.includes(GID_PI_INDET));
	ok("sessions: unsupported claude citizen NOT included", !sessGids.includes(GID_CLAUDE));
	ok("sessions: dead socket-only NOT included", !sessGids.includes(GID_SOCK_DEAD));
	ok("sessions: exactly the 2 alive entries", payload.sessions.length === 2);

	// ── socketPath SSOT (Fable a) ───────────────────────────────────────────────
	ok(
		"sessions: socketPath built via controlSocketPath (SSOT, no drift)",
		payload.sessions.every((s) => s.socketPath === controlSocketPath(s.sessionId, DIR)),
	);

	// ── count = legacy projection length, NOT peers.length (Fable d) ────────────
	ok("count === sessions.length (projection, not peers)", payload.count === payload.sessions.length);
	ok("count is not peers.length (would be 4)", payload.count !== payload.peers.length);

	// ── three distinct arrays, never merged ─────────────────────────────────────
	ok(
		"payload keeps peers / socketOnly / diagnostics as three arrays",
		Array.isArray(payload.peers) && Array.isArray(payload.socketOnly) && Array.isArray(payload.diagnostics),
	);
	ok("peers carry all 4 citizens (unsupported NOT dropped)", payload.peers.length === 4);
	ok(
		"unsupported citizen present in peers",
		payload.peers.some((p) => p.gardenId === GID_CLAUDE && p.liveness === "unsupported"),
	);
	ok("socketOnly carries both (dead NOT dropped)", payload.socketOnly.length === 2);

	// ── NO verb-routing field in JSON (deep key scan) ───────────────────────────
	const keys = allKeys(payload as unknown);
	for (const f of FORBIDDEN) {
		ok(`JSON has no '${f}' key (facts-only, no verb-routing)`, !keys.has(f));
	}

	// ── NO verb-routing word in the TEXT render (Fable e①) ──────────────────────
	const lowerText = text.toLowerCase();
	for (const f of FORBIDDEN) {
		ok(`text render has no '${f}' word (no routing leak in titles/labels)`, !lowerText.includes(f.toLowerCase()));
	}

	// ── diagnostics visible in BOTH surfaces ────────────────────────────────────
	ok(
		"diagnostic visible in JSON",
		payload.diagnostics.length === 1 && payload.diagnostics[0]?.kind === "socket-symlink-rejected",
	);
	ok("diagnostic visible in text", text.includes("socket-symlink-rejected"));

	// ── three section titles present + ordering ─────────────────────────────────
	ok("text has the citizens section", text.includes("Garden citizens (meta-record):"));
	ok("text has the socket-only section", text.includes("Socket-only control sockets (no meta-record):"));
	ok("text has the diagnostics section", text.includes("Diagnostics:"));

	// ── empty sections render "(none)" + enrich label ──────────────────────────
	{
		const empty = renderEntwurfPeers({ facts: { peers: [], socketOnly: [] }, diagnostics: [] }, DIR);
		ok("empty diagnostics render '(none)' (trust signal, not hidden)", empty.text.includes("Diagnostics:\n  (none)"));
		ok("empty citizens render '(none)'", empty.text.includes("Garden citizens (meta-record):\n  (none)"));
		ok("empty surface → count 0, no sessions", empty.payload.count === 0 && empty.payload.sessions.length === 0);
	}
	ok(
		"socket-only enrich appears in text",
		text.includes(`${GID_SOCK_ALIVE}  liveness=alive  cwd=/work/cos  model=gpt-5.4  idle=no`),
	);
	ok(
		"socket-only infoError appears in text",
		text.includes(
			`${GID_SOCK_DEAD}  liveness=dead  cwd=(not enriched)  model=(not enriched)  infoError=get_info failed`,
		),
	);
	ok("unsupported peer line shown in text", text.includes(`${GID_CLAUDE}  backend=claude-code  liveness=unsupported`));

	// ── human text is bounded: full payload remains structured, not pasted into content ──
	{
		const manyPeers = Array.from({ length: 40 }, (_, i) =>
			peer(`20260612T0000${String(i).padStart(2, "0")}-aaaaaa`, "claude-code", "unsupported"),
		);
		const bounded = renderEntwurfPeers({ facts: { peers: manyPeers, socketOnly: [] }, diagnostics: [] }, DIR);
		ok("bounded text omits older entries when peer list is large", bounded.text.includes("older entries omitted"));
		ok("bounded text shows latest entries", bounded.text.includes("20260612T000039-aaaaaa"));
		ok("bounded text omits oldest entry", !bounded.text.includes("20260612T000000-aaaaaa  backend="));
		ok("bounded payload still carries every peer", bounded.payload.peers.length === 40);
	}

	// ── WIRING guard: bridge handler calls the provider+render, not getLiveSessions ──
	{
		const here = path.dirname(fileURLToPath(import.meta.url));
		const bridgeSrc = readFileSync(path.join(here, "..", "mcp", "entwurf-bridge", "src", "index.ts"), "utf8");
		const nativeSrc = readFileSync(path.join(here, "..", "pi-extensions", "entwurf-control.ts"), "utf8");
		ok("wiring: bridge calls listEntwurfFacts(", bridgeSrc.includes("listEntwurfFacts("));
		ok("wiring: bridge calls renderEntwurfPeers(", bridgeSrc.includes("renderEntwurfPeers("));
		ok("wiring: native pi tool calls listEntwurfFacts(", nativeSrc.includes("listEntwurfFacts("));
		ok("wiring: native pi tool calls renderEntwurfPeers(", nativeSrc.includes("renderEntwurfPeers("));
		ok(
			"wiring: native pi tool description no longer claims socket-only discovery",
			!nativeSrc.includes("List live sessions that expose a control socket. Returns sessionIds only"),
		);
		ok(
			"wiring: bridge does not paste full JSON payload into human text",
			!bridgeSrc.includes("JSON.stringify(payload)"),
		);
		ok(
			"wiring: native pi tool does not paste full JSON payload into human text",
			!nativeSrc.includes("JSON.stringify(payload)"),
		);
		// `\bname\s*\(` catches a definition OR a call (tolerating a space before the
		// paren, GPi Q4); a bare prose mention in a removal-note comment (no paren) is
		// allowed — the guard targets the second scan, not the word.
		ok(
			"wiring: no getLiveSessions definition/call in bridge (no second scan)",
			!/\bgetLiveSessions\s*\(/.test(bridgeSrc),
		);
		ok(
			"wiring: no isSocketAlive definition/call in bridge (legacy probe removed)",
			!/\bisSocketAlive\s*\(/.test(bridgeSrc),
		);
	}

	console.log(`\n[check-entwurf-peers-surface] ${passed} assertions ok`);
}

main();
