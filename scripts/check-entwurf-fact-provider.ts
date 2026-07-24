/**
 * check-entwurf-fact-provider — deterministic gate for `listEntwurfFacts` (0.11
 * Stage 0 step 4, slice 4b). Drives the assembly layer with injected meta + socket
 * deps (no IO) and proves the throw-vs-diagnostics policy:
 *
 *   - basic assembly: pi citizen + claude citizen + record-less socket →
 *     2 peers (pi alive / claude unsupported) + the record-less socket folded
 *     into ONE `record-less-socket` diagnostic (#50 C4: a diagnostic subject,
 *     never a listing section) whose message names the cause + fix (M1),
 *   - corrupt record → meta-record-read-error diagnostic, listing NOT blinded,
 *   - gardenId↔socket collision (non-pi citizen + same-gid socket) → BOTH sides
 *     quarantined (gid in neither peers nor socketOnly) + one
 *     garden-id-socket-conflict diagnostic, and listEntwurfFacts does NOT throw
 *     (expected external-state corruption → diagnostics, not a crash),
 *   - the conflict diagnostic carries backend + gardenId ONLY (no identity field),
 *   - socket-axis hazards folded (slice 4c, Fable 검수): a symlinked socket →
 *     socket-symlink-rejected diagnostic (P1), a malformed *.sock name →
 *     malformed-socket-name diagnostic (P3), a non-ENOENT dir-read failure →
 *     socket-dir-read-error diagnostic (P2e②),
 *   - diagnostics are kind-tagged and sorted.
 *
 * No IO — meta entries/reader and socket dir/readdir/probe are injected fakes.
 */

import assert from "node:assert/strict";
import * as path from "node:path";
import { type EntwurfFactsDeps, listEntwurfFacts } from "../pi-extensions/lib/entwurf-fact-provider.ts";
import { type MetaBackendV2, serializeMetaIdentity } from "../pi-extensions/lib/meta-session.ts";
import { SOCKET_SUFFIX, type SocketDirEntry } from "../pi-extensions/lib/socket-discovery.ts";
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
		schemaVersion: 3,
		gardenId,
		backend,
		nativeSessionId: `n-${gardenId}`,
		cwd: "/x",
		model: null,
		transcriptPath: null,
		createdAt: "2026-06-11T00:00:00.000Z",
		recordUpdatedAt: "2026-06-11T00:00:00.000Z",
	});
}

interface SocketOpts {
	/** gids whose `*.sock` entry is a symlink (P1). */
	symlinks?: string[];
	/** extra raw dir entries (e.g. a malformed `*.sock` name) (P3). */
	extraNames?: string[];
	/** readdir throws with this code (e.g. "EACCES" / "ENOENT") (P2e②). */
	readdirErrorCode?: string;
}

function deps(
	meta: Record<string, string>,
	sockets: Record<string, SocketLiveness>,
	opts: SocketOpts = {},
): EntwurfFactsDeps {
	const symlinkSet = new Set(opts.symlinks ?? []);
	return {
		metaEntries: Object.keys(meta),
		readRecord: (f: string) => {
			const v = meta[f];
			if (v === undefined) throw new Error(`ENOENT: ${f}`);
			return v;
		},
		socket: {
			dir: DIR,
			readdir: async (): Promise<SocketDirEntry[]> => {
				if (opts.readdirErrorCode) {
					const e = new Error(`${opts.readdirErrorCode}: readdir failed`) as NodeJS.ErrnoException;
					e.code = opts.readdirErrorCode;
					throw e;
				}
				const sockEntries: SocketDirEntry[] = Object.keys(sockets).map((g) => ({
					name: `${g}${SOCKET_SUFFIX}`,
					isSymbolicLink: symlinkSet.has(g),
				}));
				const extra: SocketDirEntry[] = (opts.extraNames ?? []).map((n) => ({ name: n, isSymbolicLink: false }));
				return [...sockEntries, ...extra];
			},
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
			"basic: 2 peers + 1 record-less fact + 1 record-less-socket diagnostic (#50 C4)",
			r.facts.peers.length === 2 && r.facts.recordLessSockets.length === 1 && r.diagnostics.length === 1,
		);
		ok("basic: pi citizen alive", r.facts.peers.find((p) => p.gardenId === GID_PI)?.liveness === "alive");
		ok(
			"basic: claude citizen unsupported",
			r.facts.peers.find((p) => p.gardenId === GID_CLAUDE)?.liveness === "unsupported",
		);
		const rls = r.diagnostics[0];
		ok(
			"basic: the record-less socket IS the diagnostic (kind + gid + liveness)",
			rls?.kind === "record-less-socket" && rls.gardenId === GID_SOCKET_ONLY && rls.liveness === "alive",
		);
		if (rls && rls.kind === "record-less-socket") {
			ok(
				"basic: alive record-less message names the record authority + M1 (#50 F10 discipline)",
				rls.message.includes("no meta-record claims") &&
					rls.message.includes("sole address authority") &&
					rls.message.includes("meta-bridge-migrate-v3 migrate"),
			);
			const keys = Object.keys(rls).sort();
			assert.deepStrictEqual(
				keys,
				["gardenId", "kind", "liveness", "message"],
				`record-less-socket diagnostic keyset drift: ${keys.join(",")}`,
			);
			ok("basic: record-less-socket diagnostic keyset exact", true);
		}
		// A DEAD record-less socket groups under a different (stale) message — no M1
		// pointer for a leftover file, so same-state sockets aggregate per liveness.
		const r2 = await listEntwurfFacts(deps({}, { [GID_SOCKET_ONLY]: "dead" }));
		const rls2 = r2.diagnostics[0];
		ok(
			"basic: dead record-less socket → stale-flavored message (no M1, distinct group)",
			rls2?.kind === "record-less-socket" &&
				rls2.liveness === "dead" &&
				rls2.message.includes("stale") &&
				!rls2.message.includes("meta-bridge-migrate-v3"),
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
			"collision: conflict gid NOT in recordLessSockets (both quarantined)",
			!r.facts.recordLessSockets.some((s) => s.gardenId === GID_CONFLICT),
		);
		ok(
			"collision: quarantined gid raises NO record-less-socket diagnostic (conflict owns it)",
			!r.diagnostics.some((d) => d.kind === "record-less-socket" && d.gardenId === GID_CONFLICT),
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

	// ── non-pi citizen + SYMLINKED socket: the fact-provider:125 gap (closed) ───
	// A non-pi record sharing its gid with a *symlinked* `*.sock`. The symlink is
	// never probed, so its gid is absent from socketGids — the old socketGids-only
	// check missed this and the non-pi citizen survived as a clean PeerFact while
	// the legacy send path still followed the symlink to a forged receiver. The
	// shared isNonPiGardenIdSocketConflict predicate unions socketGids with the
	// symlinked gids, so the citizen is now quarantined (gid in NEITHER peers nor
	// socketOnly) and the conflict diagnostic is raised — alongside the existing
	// socket-symlink-rejected one (both are honest: symlink-rejected = "not probed",
	// conflict = "non-pi address split").
	{
		const r = await listEntwurfFacts(
			deps(
				{ [`${GID_PI}.meta.json`]: rec(GID_PI, "pi"), [`${GID_CONFLICT}.meta.json`]: rec(GID_CONFLICT, "claude-code") },
				{ [GID_PI]: "alive", [GID_CONFLICT]: "alive" },
				{ symlinks: [GID_CONFLICT] },
			),
		);
		ok(
			"symlink-collision: non-pi citizen quarantined (NOT in peers)",
			!r.facts.peers.some((p) => p.gardenId === GID_CONFLICT),
		);
		ok(
			"symlink-collision: gid NOT in recordLessSockets (symlink never probed)",
			!r.facts.recordLessSockets.some((s) => s.gardenId === GID_CONFLICT),
		);
		ok(
			"symlink-collision: pi citizen still present",
			r.facts.peers.some((p) => p.gardenId === GID_PI),
		);
		const conflict = r.diagnostics.find((d) => d.kind === "garden-id-socket-conflict" && d.gardenId === GID_CONFLICT);
		ok("symlink-collision: garden-id-socket-conflict diagnostic raised for the symlinked gid", conflict !== undefined);
		ok(
			"symlink-collision: socket-symlink-rejected diagnostic ALSO raised (both honest)",
			r.diagnostics.some((d) => d.kind === "socket-symlink-rejected" && d.gardenId === GID_CONFLICT),
		);
	}

	// ── impossible-invariant throw is NOT swallowed (C-원칙) ────────────────────
	// listEntwurfFacts feeds resolveFactList only CLEAN inputs, so its
	// duplicate/unprobed throws never fire on real data — but they remain the last
	// line of defense. The collision case above proves expected corruption is a
	// diagnostic, not a crash; the absence of a catch-all around resolveFactList
	// (verified by reading the source) keeps wiring bugs loud.
	ok("C-원칙: collision handled as diagnostic, not crash (no throw above)", true);

	// ── socket-axis hazard: symlinked socket → diagnostic, never probed (P1) ────
	{
		// A pi citizen whose socket is a symlink: it must NOT probe alive (forgery),
		// it is forced dead → still a peer (dormant), and a diagnostic is raised.
		const r = await listEntwurfFacts(
			deps({ [`${GID_PI}.meta.json`]: rec(GID_PI, "pi") }, { [GID_PI]: "alive" }, { symlinks: [GID_PI] }),
		);
		const peer = r.facts.peers.find((p) => p.gardenId === GID_PI);
		ok("P1: symlinked pi citizen forced dead (not probed alive)", peer?.liveness === "dead");
		const sym = r.diagnostics.find((d) => d.kind === "socket-symlink-rejected");
		ok("P1: socket-symlink-rejected diagnostic raised", sym?.kind === "socket-symlink-rejected");
		if (sym && sym.kind === "socket-symlink-rejected") {
			ok("P1: symlink diagnostic carries the gardenId", sym.gardenId === GID_PI);
			const keys = Object.keys(sym).sort();
			assert.deepStrictEqual(
				keys,
				["gardenId", "kind", "message"],
				`symlink diagnostic keyset drift: ${keys.join(",")}`,
			);
		}
	}

	// ── socket-axis hazard: malformed *.sock name → visible diagnostic (P3) ─────
	{
		const r = await listEntwurfFacts(
			deps({ [`${GID_PI}.meta.json`]: rec(GID_PI, "pi") }, { [GID_PI]: "alive" }, { extraNames: ["not-a-gid.sock"] }),
		);
		const mal = r.diagnostics.find((d) => d.kind === "malformed-socket-name");
		ok("P3: malformed-socket-name diagnostic raised", mal?.kind === "malformed-socket-name");
		if (mal && mal.kind === "malformed-socket-name") {
			ok("P3: malformed diagnostic carries the offending name", mal.name === "not-a-gid.sock");
		}
		ok("P3: pi citizen still listed alongside the malformed-name diagnostic", r.facts.peers.length === 1);
	}

	// ── socket-axis hazard: non-ENOENT dir-read failure → diagnostic (P2e②) ─────
	{
		const r = await listEntwurfFacts(
			deps({ [`${GID_PI}.meta.json`]: rec(GID_PI, "pi") }, { [GID_PI]: "alive" }, { readdirErrorCode: "EACCES" }),
		);
		const dirErr = r.diagnostics.find((d) => d.kind === "socket-dir-read-error");
		ok("P2e②: socket-dir-read-error diagnostic raised on EACCES", dirErr?.kind === "socket-dir-read-error");
		ok(
			"P2e②: meta citizen still listed (socket axis lost, citizen axis survives)",
			r.facts.peers.length === 1 && r.facts.peers[0]?.gardenId === GID_PI,
		);
		ok(
			"P2e②/P1: untrusted dir → pi citizen held at indeterminate (NOT probed alive through unverified path)",
			r.facts.peers[0]?.liveness === "indeterminate",
		);
	}

	// ── ENOENT dir is the normal empty → NO socket-dir-read-error (P2e②) ────────
	{
		const r = await listEntwurfFacts(
			deps({ [`${GID_PI}.meta.json`]: rec(GID_PI, "pi") }, { [GID_PI]: "alive" }, { readdirErrorCode: "ENOENT" }),
		);
		ok(
			"P2e②: ENOENT dir → no socket-dir-read-error diagnostic (normal empty)",
			!r.diagnostics.some((d) => d.kind === "socket-dir-read-error"),
		);
	}

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

function diagnosticKey(d: { kind: string; filename?: string; gardenId?: string; name?: string }): string {
	switch (d.kind) {
		case "meta-record-read-error":
			return `0:${d.filename}`;
		case "garden-id-socket-conflict":
			return `1:${d.gardenId}`;
		case "record-less-socket":
			return `2:${d.gardenId}`;
		case "socket-symlink-rejected":
			return `3:${d.gardenId}`;
		case "malformed-socket-name":
			return `4:${d.name}`;
		default:
			return "5:";
	}
}

await main();
