/**
 * check-entwurf-fact-provider — deterministic gate for `listEntwurfFacts` (0.11
 * Stage 0 step 4, slice 4b). Drives the assembly layer with injected meta + socket
 * deps (no IO) and proves the throw-vs-diagnostics policy:
 *
 *   - basic assembly: pi citizen + claude citizen + record-less socket →
 *     2 peers (pi alive / claude unsupported) + 1 socketOnly, 0 diagnostics,
 *   - corrupt record → meta-record-read-error diagnostic, listing NOT blinded,
 *   - gardenId↔socket collision (non-pi citizen + same-gid socket) → BOTH sides
 *     quarantined (gid in neither peers nor socketOnly) + one
 *     garden-id-socket-conflict diagnostic, and listEntwurfFacts does NOT throw
 *     (expected external-state corruption → diagnostics, not a crash),
 *   - the conflict diagnostic carries backend + gardenId ONLY (no identity field),
 *   - enrich stays null (probe-only slice),
 *   - diagnostics are kind-tagged and sorted.
 *
 * No IO — meta entries/reader and socket dir/readdir/probe are injected fakes.
 */

import assert from "node:assert/strict";
import * as path from "node:path";
import { type EntwurfFactsDeps, listEntwurfFacts } from "../pi-extensions/lib/entwurf-fact-provider.ts";
import { type MetaBackendV2, type MetaIdentity, serializeMetaIdentity } from "../pi-extensions/lib/meta-session.ts";
import { SOCKET_SUFFIX } from "../pi-extensions/lib/socket-discovery.ts";
import type { SocketLiveness } from "../pi-extensions/lib/socket-probe.ts";

let passed = 0;
function ok(label: string, cond: boolean): void {
	assert.ok(cond, label);
	console.log(`  ok    ${label}`);
	passed++;
}

const DIR = "/fake/entwurf-control";
const GID_PI = "20260611T115213-3aa371"; // pi citizen, live socket
const GID_CLAUDE = "20260611T112732-0f42b6"; // claude citizen, no socket
const GID_SOCKET_ONLY = "20260611T222222-bbbbbb"; // live socket, no record
const GID_CONFLICT = "20260611T333333-cccccc"; // claude citizen + same-gid socket

function rec(gardenId: string, backend: MetaBackendV2): string {
	return serializeMetaIdentity({
		schemaVersion: 2,
		gardenId,
		backend,
		nativeSessionId: `n-${gardenId}`,
		cwd: "/x",
		model: null,
		transcriptPath: null,
		parentGardenId: null,
		isEntwurf: false,
		createdAt: "2026-06-11T00:00:00.000Z",
		recordUpdatedAt: "2026-06-11T00:00:00.000Z",
	});
}

function deps(meta: Record<string, string>, sockets: Record<string, SocketLiveness>): EntwurfFactsDeps {
	return {
		metaEntries: Object.keys(meta),
		readRecord: (f: string) => {
			const v = meta[f];
			if (v === undefined) throw new Error(`ENOENT: ${f}`);
			return v;
		},
		socket: {
			dir: DIR,
			readdir: async () => Object.keys(sockets).map((g) => `${g}${SOCKET_SUFFIX}`),
			probe: async (p: string) => sockets[path.basename(p, SOCKET_SUFFIX)] ?? "dead",
		},
	};
}

async function main(): Promise<void> {
	// ── basic assembly ─────────────────────────────────────────────────────────
	{
		const r = await listEntwurfFacts(
			deps(
				{ [`${GID_PI}.meta.json`]: rec(GID_PI, "pi"), [`${GID_CLAUDE}.meta.json`]: rec(GID_CLAUDE, "claude-code") },
				{ [GID_PI]: "alive", [GID_SOCKET_ONLY]: "alive" },
			),
		);
		ok(
			"basic: 2 peers + 1 socketOnly + 0 diagnostics",
			r.facts.peers.length === 2 && r.facts.socketOnly.length === 1 && r.diagnostics.length === 0,
		);
		ok("basic: pi citizen alive", r.facts.peers.find((p) => p.gardenId === GID_PI)?.liveness === "alive");
		ok(
			"basic: claude citizen unsupported",
			r.facts.peers.find((p) => p.gardenId === GID_CLAUDE)?.liveness === "unsupported",
		);
		ok("basic: record-less socket → socketOnly", r.facts.socketOnly[0]?.gardenId === GID_SOCKET_ONLY);
		ok(
			"basic: enrich null (probe-only slice)",
			r.facts.socketOnly[0]?.cwd === null && r.facts.socketOnly[0]?.model === null,
		);
	}

	// ── corrupt record does NOT blind the listing ──────────────────────────────
	{
		const r = await listEntwurfFacts(
			deps(
				{ [`${GID_PI}.meta.json`]: rec(GID_PI, "pi"), [`${GID_CLAUDE}.meta.json`]: "{ broken" },
				{ [GID_PI]: "alive" },
			),
		);
		ok(
			"corrupt: pi citizen still listed (not blinded)",
			r.facts.peers.length === 1 && r.facts.peers[0]?.gardenId === GID_PI,
		);
		ok(
			"corrupt: 1 meta-record-read-error diagnostic",
			r.diagnostics.length === 1 && r.diagnostics[0]?.kind === "meta-record-read-error",
		);
	}

	// ── gardenId↔socket collision: quarantine BOTH, do NOT throw ────────────────
	{
		const r = await listEntwurfFacts(
			deps(
				{ [`${GID_PI}.meta.json`]: rec(GID_PI, "pi"), [`${GID_CONFLICT}.meta.json`]: rec(GID_CONFLICT, "claude-code") },
				{ [GID_PI]: "alive", [GID_CONFLICT]: "alive" },
			),
		);
		ok("collision: conflict gid NOT in peers", !r.facts.peers.some((p) => p.gardenId === GID_CONFLICT));
		ok(
			"collision: conflict gid NOT in socketOnly (both quarantined)",
			!r.facts.socketOnly.some((s) => s.gardenId === GID_CONFLICT),
		);
		ok(
			"collision: pi citizen still present (listing survives)",
			r.facts.peers.some((p) => p.gardenId === GID_PI),
		);
		const conflict = r.diagnostics.find((d) => d.kind === "garden-id-socket-conflict");
		ok(
			"collision: 1 garden-id-socket-conflict diagnostic",
			conflict !== undefined && conflict.kind === "garden-id-socket-conflict",
		);
		if (conflict && conflict.kind === "garden-id-socket-conflict") {
			ok("collision: diagnostic gardenId", conflict.gardenId === GID_CONFLICT);
			ok("collision: diagnostic backend", conflict.backend === "claude-code");
			const keys = Object.keys(conflict).sort();
			assert.deepStrictEqual(
				keys,
				["backend", "gardenId", "kind", "message"],
				`conflict diagnostic keyset drift: ${keys.join(",")}`,
			);
			ok("collision: diagnostic carries backend+gardenId only (no identity field)", true);
		}
	}

	// ── impossible-invariant throw is NOT swallowed (C-원칙) ────────────────────
	// listEntwurfFacts feeds resolveFactList only CLEAN inputs, so its
	// duplicate/unprobed throws never fire on real data — but they remain the last
	// line of defense. The collision case above proves expected corruption is a
	// diagnostic, not a crash; the absence of a catch-all around resolveFactList
	// (verified by reading the source) keeps wiring bugs loud.
	ok("C-원칙: collision handled as diagnostic, not crash (no throw above)", true);

	// ── determinism: diagnostics sorted, kind-tagged ───────────────────────────
	{
		const r = await listEntwurfFacts(
			deps({ [`${GID_CLAUDE}.meta.json`]: "{ broken b", [`${GID_PI}.meta.json`]: "{ broken a" }, {}),
		);
		ok("determinism: 2 read-error diagnostics", r.diagnostics.length === 2);
		ok("determinism: diagnostics sorted by key", diagnosticKey(r.diagnostics[0]) <= diagnosticKey(r.diagnostics[1]));
	}

	console.log(`\n[check-entwurf-fact-provider] ${passed} assertions ok`);
}

function diagnosticKey(d: { kind: string; filename?: string; gardenId?: string }): string {
	return d.kind === "meta-record-read-error" ? `0:${d.filename}` : `1:${d.gardenId}`;
}

await main();
