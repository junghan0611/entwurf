/**
 * check-entwurf-peers-surface — deterministic gate for the MCP + pi-native `entwurf_peers`
 * RENDER/PAYLOAD layer (0.11 Stage 0 step 4, slice 4c; #50 C4 re-author). Drives the PURE
 * `renderEntwurfPeers` with a fabricated `EntwurfFactsResult` (no IO) and proves
 * the surface contract (GPi + Fable 수렴 + the C4 demotion):
 *
 *   - TWO sections only: citizens (peers) + diagnostics. The record is the sole
 *     identity axis — no `sessions` projection, no `socketOnly` section, no
 *     `controlDir`, no socketPath anywhere in payload or text (#50 C4),
 *   - a record-less socket surfaces ONLY as a `record-less-socket` diagnostic,
 *     visible in both text and JSON,
 *   - NO verb-routing field anywhere in the JSON (deep key scan) AND no
 *     verb-routing WORD in the text render (Fable e①: a "resumable peers" title
 *     leaks routing a key scan would miss),
 *   - diagnostics appear in BOTH the text and the JSON,
 *   - empty sections render "(none)"; an `unsupported` peer is shown (never
 *     dropped),
 *   - diagnostics sharing one (kind + message) AGGREGATE in text (F8) — including
 *     record-less-socket groups, which share a message per liveness,
 *   - WIRING guard (Fable e②/6): the MCP handler and pi-native tool call
 *     listEntwurfFacts + renderEntwurfPeers; getLiveSessions and the
 *     `/entwurf-sessions` socket-scan command stay gone from both surfaces.
 *
 * No IO — the facts are fabricated; only the wiring guard reads the bridge source
 * as text (a static assertion, not an execution).
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { type EntwurfFactsResult, recordLessSocketMessage } from "../pi-extensions/lib/entwurf-fact-provider.ts";
import type { PeerFact } from "../pi-extensions/lib/entwurf-facts.ts";
import { renderEntwurfPeers } from "../pi-extensions/lib/entwurf-peers-render.ts";
import type { FactLiveness } from "../pi-extensions/lib/entwurf-v2-contract.ts";
import type { MetaBackendV2 } from "../pi-extensions/lib/meta-session.ts";
import type { SocketLiveness } from "../pi-extensions/lib/socket-probe.ts";

let passed = 0;
function ok(label: string, cond: boolean): void {
	assert.ok(cond, label);
	console.log(`  ok    ${label}`);
	passed++;
}

const FORBIDDEN = ["sendable", "resumable", "dispatch", "action", "transport", "mailboxDeliverable"];
// #50 C4: socket-shaped identity must not reappear on this surface.
const FORBIDDEN_C4_KEYS = ["sessions", "socketOnly", "controlDir", "socketPath", "count"];

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

function recordLessDiag(gardenId: string, liveness: SocketLiveness) {
	return { kind: "record-less-socket" as const, gardenId, liveness, message: recordLessSocketMessage(liveness) };
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

const GID_PI_ALIVE = "20260611T111111-aaaaaa";
const GID_PI_DEAD = "20260611T222222-bbbbbb";
const GID_PI_INDET = "20260611T333333-cccccc";
const GID_CLAUDE = "20260611T444444-dddddd"; // claude unsupported → shown, never dropped
const GID_SOCK_ALIVE = "20260611T555555-eeeeee"; // record-less alive → diagnostic
const GID_SOCK_DEAD = "20260611T666666-ffffff"; // record-less dead → diagnostic (distinct group)

function main(): void {
	const result: EntwurfFactsResult = {
		facts: {
			peers: [
				peer(GID_PI_ALIVE, "pi", "alive"),
				peer(GID_PI_DEAD, "pi", "dead"),
				peer(GID_PI_INDET, "pi", "indeterminate"),
				peer(GID_CLAUDE, "claude-code", "unsupported"),
			],
			// The provider has already folded these into diagnostics; the render layer
			// never re-renders them as a section (facts carry them for the union math).
			recordLessSockets: [
				{ gardenId: GID_SOCK_ALIVE, liveness: "alive" },
				{ gardenId: GID_SOCK_DEAD, liveness: "dead" },
			],
		},
		diagnostics: [
			{ kind: "socket-symlink-rejected", gardenId: "20260611T999999-999999", message: "symlink rejected" },
			recordLessDiag(GID_SOCK_ALIVE, "alive"),
			recordLessDiag(GID_SOCK_DEAD, "dead"),
		],
	};

	const { text, payload } = renderEntwurfPeers(result);

	// ── #50 C4: two arrays only — citizens + diagnostics ────────────────────────
	{
		const topKeys = Object.keys(payload).sort();
		assert.deepStrictEqual(topKeys, ["diagnostics", "peers"], `payload keyset drift: ${topKeys.join(",")}`);
		ok("C4: payload is exactly { peers, diagnostics }", true);
	}
	ok("peers carry all 4 citizens (unsupported NOT dropped)", payload.peers.length === 4);
	ok(
		"unsupported citizen present in peers",
		payload.peers.some((p) => p.gardenId === GID_CLAUDE && p.liveness === "unsupported"),
	);

	// ── #50 C4: no socket-shaped identity anywhere in JSON or text ──────────────
	const keys = allKeys(payload as unknown);
	for (const f of FORBIDDEN_C4_KEYS) {
		ok(`C4: JSON has no '${f}' key (socket is transport, never identity)`, !keys.has(f));
	}
	ok("C4: text has no socket-only section title", !text.includes("Socket-only control sockets"));
	ok("C4: text carries no .sock path", !text.includes(".sock"));

	// ── the record-less sockets surface as diagnostics (both surfaces) ──────────
	ok(
		"record-less alive socket → record-less-socket diagnostic in JSON",
		payload.diagnostics.some((d) => d.kind === "record-less-socket" && d.gardenId === GID_SOCK_ALIVE),
	);
	ok(
		"record-less alive diagnostic line in text (gid + liveness + cause)",
		text.includes(`- record-less-socket ${GID_SOCK_ALIVE} (alive):`) && text.includes("no meta-record claims"),
	);
	ok("record-less alive diagnostic names M1 (#50 F10 discipline)", text.includes("meta-bridge-migrate-v3 migrate"));
	ok(
		"record-less dead socket keeps its own (stale) line — distinct message group",
		text.includes(`- record-less-socket ${GID_SOCK_DEAD} (dead):`),
	);

	// ── NO verb-routing field in JSON (deep key scan) ───────────────────────────
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
		"symlink diagnostic visible in JSON",
		payload.diagnostics.some((d) => d.kind === "socket-symlink-rejected"),
	);
	ok("symlink diagnostic visible in text", text.includes("socket-symlink-rejected"));

	// ── two section titles present ──────────────────────────────────────────────
	ok("text has the citizens section", text.includes("Garden citizens (meta-record):"));
	ok("text has the diagnostics section", text.includes("Diagnostics:"));

	// ── empty sections render "(none)" ─────────────────────────────────────────
	{
		const empty = renderEntwurfPeers({ facts: { peers: [], recordLessSockets: [] }, diagnostics: [] });
		ok("empty diagnostics render '(none)' (trust signal, not hidden)", empty.text.includes("Diagnostics:\n  (none)"));
		ok("empty citizens render '(none)'", empty.text.includes("Garden citizens (meta-record):\n  (none)"));
	}
	ok("unsupported peer line shown in text", text.includes(`${GID_CLAUDE}  backend=claude-code  liveness=unsupported`));

	// ── human text is bounded: full payload remains structured, not pasted into content ──
	{
		const manyPeers = Array.from({ length: 40 }, (_, i) =>
			peer(`20260612T0000${String(i).padStart(2, "0")}-aaaaaa`, "claude-code", "unsupported"),
		);
		const bounded = renderEntwurfPeers({ facts: { peers: manyPeers, recordLessSockets: [] }, diagnostics: [] });
		ok("bounded text omits older entries when peer list is large", bounded.text.includes("older entries omitted"));
		ok("bounded text shows latest entries", bounded.text.includes("20260612T000039-aaaaaa"));
		ok("bounded text omits oldest entry", !bounded.text.includes("20260612T000000-aaaaaa  backend="));
		ok("bounded payload still carries every peer", bounded.payload.peers.length === 40);
	}

	// ── diagnostics sharing one cause AGGREGATE in text (F8) ────────────────────
	// An unmigrated pre-cut store degrades EVERY record with the identical message;
	// 177 copies of that sentence buried the one citizen line the listing existed to
	// show. Same (kind + message) → ONE ×N line with a subject sample; a distinct
	// message keeps its own classic line; the JSON payload keeps every diagnostic.
	{
		const sharedMsg = 'meta-record "schemaVersion" must be 3 (got number 2) — migrate the store.';
		const uniform = Array.from({ length: 177 }, (_, i) => ({
			kind: "meta-record-read-error" as const,
			filename: `20260612T${String(100000 + i).slice(-6)}-cccccc.meta.json`,
			message: sharedMsg,
		}));
		const distinct = {
			kind: "meta-record-read-error" as const,
			filename: "20260612T999998-dddddd.meta.json",
			message: "body/filename drift: this one is different.",
		};
		const agg = renderEntwurfPeers({
			facts: { peers: [], recordLessSockets: [] },
			diagnostics: [...uniform, distinct],
		});
		ok("uniform diagnostics collapse to one ×N line", agg.text.includes("meta-record-read-error ×177:"));
		ok("the shared message appears exactly once in the text", agg.text.split(sharedMsg).length - 1 === 1);
		ok("the aggregated line samples subjects and counts the omitted rest", agg.text.includes("… +174 more"));
		ok(
			"a distinct-message diagnostic keeps its own classic line",
			agg.text.includes("- meta-record-read-error 20260612T999998-dddddd.meta.json: body/filename drift"),
		);
		ok("payload still carries every individual diagnostic", agg.payload.diagnostics.length === 178);
	}

	// ── F8 applies to record-less-socket too: same liveness ⇒ one aggregated line ──
	{
		const gids = Array.from({ length: 5 }, (_, i) => `20260613T00000${i}-eeeeee`);
		const agg = renderEntwurfPeers({
			facts: { peers: [], recordLessSockets: gids.map((g) => ({ gardenId: g, liveness: "dead" as const })) },
			diagnostics: gids.map((g) => recordLessDiag(g, "dead")),
		});
		ok("5 dead record-less sockets collapse to one ×5 line", agg.text.includes("record-less-socket ×5:"));
		ok("the aggregated record-less line samples gids", agg.text.includes(gids[0] as string));
	}

	// ── WIRING guard: both surfaces call the provider+render; the socket-scan lane is gone ──
	{
		const here = path.dirname(fileURLToPath(import.meta.url));
		const bridgeSrc = readFileSync(path.join(here, "..", "mcp", "entwurf-bridge", "src", "index.ts"), "utf8");
		const nativeSrc = readFileSync(path.join(here, "..", "pi-extensions", "entwurf-control.ts"), "utf8");
		ok("wiring: bridge calls listEntwurfFacts(", bridgeSrc.includes("listEntwurfFacts("));
		ok("wiring: bridge calls renderEntwurfPeers(", bridgeSrc.includes("renderEntwurfPeers("));
		ok("wiring: native pi tool calls listEntwurfFacts(", nativeSrc.includes("listEntwurfFacts("));
		ok("wiring: native pi tool calls renderEntwurfPeers(", nativeSrc.includes("renderEntwurfPeers("));
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
		for (const [label, src] of [
			["bridge", bridgeSrc],
			["native pi surface", nativeSrc],
		] as const) {
			ok(
				`wiring: no getLiveSessions definition/call in ${label} (no second scan)`,
				!/\bgetLiveSessions\s*\(/.test(src),
			);
			ok(
				`wiring: no isSocketAlive definition/call in ${label} (legacy probe removed)`,
				!/\bisSocketAlive\s*\(/.test(src),
			);
		}
		// #50 C4: the socket-scan operator command is gone from the pi-native surface.
		ok(
			"wiring: no /entwurf-sessions command registration (socket-scan lane deleted)",
			!nativeSrc.includes('registerCommand("entwurf-sessions"'),
		);
	}

	console.log(`\n[check-entwurf-peers-surface] ${passed} assertions ok`);
}

main();
