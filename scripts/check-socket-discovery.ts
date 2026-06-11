/**
 * check-socket-discovery — deterministic gate for the fact-provider's SOCKET
 * axis (0.11 Stage 0 step 4, slice 3). Drives `scanSocketProbes` with injected
 * readdir/probe (no IO) and proves the slice-2 contract is fed correctly:
 *
 *   - union: every dir-present socket AND every in-domain citizen is probed,
 *   - dormant trap: a pi citizen with NO socket file reads `dead` (ENOENT), so
 *     downstream it routes dormant→resumable (never an unprobed gap),
 *   - F3 preserve: a stalled socket reads `indeterminate`, never folded to dead,
 *   - dir hygiene: non-`.sock` and malformed (non-garden-id) names are ignored,
 *   - dedup: a gid present in BOTH the dir and the citizen list is probed once,
 *   - missing dir: citizens are still probed (→ dead),
 *   - determinism: output sorted by gardenId,
 *   - enrich is null this slice (probe-only, honest not synthetic),
 *   - end-to-end: scanSocketProbes → resolveFactList yields the dormant citizen
 *     as a resumable `dead` PeerFact (no throw — all in-domain citizens probed).
 *
 * No IO, no backend, no API — readdir/probe are injected fakes.
 */

import assert from "node:assert/strict";
import * as path from "node:path";
import { resolveFactList } from "../pi-extensions/lib/entwurf-facts.ts";
import type { MetaBackendV2, MetaIdentity } from "../pi-extensions/lib/meta-session.ts";
import { controlSocketPath, SOCKET_SUFFIX, scanSocketProbes } from "../pi-extensions/lib/socket-discovery.ts";
import type { SocketLiveness } from "../pi-extensions/lib/socket-probe.ts";

let passed = 0;
function ok(label: string, cond: boolean): void {
	assert.ok(cond, label);
	console.log(`  ok    ${label}`);
	passed++;
}

const DIR = "/fake/entwurf-control";
const GID_LIVE = "20260611T115213-3aa371"; // socket present → alive
const GID_STALL = "20260611T135517-5f0d25"; // socket present → indeterminate (F3)
const GID_DORMANT = "20260611T093858-14984d"; // pi citizen, no socket file → dead
const GID_SOCKET_ONLY = "20260611T222222-bbbbbb"; // socket present, no citizen

const PROBE_MAP: Record<string, SocketLiveness> = {
	[GID_LIVE]: "alive",
	[GID_STALL]: "indeterminate",
	[GID_SOCKET_ONLY]: "alive",
	// GID_DORMANT intentionally absent → fakeProbe returns "dead" (ENOENT)
};

function fakeReaddir(names: string[]): (dir: string) => Promise<string[]> {
	return async () => names;
}

// Probe keyed by the gardenId embedded in the canonical socket path. An absent
// gid → "dead", mirroring an ENOENT connect on a missing socket file.
function fakeProbe(byGid: Record<string, SocketLiveness>): (socketPath: string) => Promise<SocketLiveness> {
	return async (socketPath: string) => {
		const base = path.basename(socketPath, SOCKET_SUFFIX);
		return byGid[base] ?? "dead";
	};
}

const NAMES = [`${GID_LIVE}.sock`, `${GID_STALL}.sock`, `${GID_SOCKET_ONLY}.sock`, "README.txt", "not-a-gid.sock"];

async function main(): Promise<void> {
	// ── union: dir sockets ∪ pi citizens, each probed ──────────────────────────
	{
		const probes = await scanSocketProbes([GID_DORMANT, GID_LIVE], {
			dir: DIR,
			readdir: fakeReaddir(NAMES),
			probe: fakeProbe(PROBE_MAP),
		});
		const byGid = Object.fromEntries(probes.map((p) => [p.gardenId, p]));
		ok("union: dir sockets + pi citizens all probed (LIVE/STALL/SOCKET_ONLY/DORMANT)", probes.length === 4);
		ok("alive socket → alive", byGid[GID_LIVE]?.liveness === "alive");
		ok("F3: stalled socket → indeterminate (never folded to dead)", byGid[GID_STALL]?.liveness === "indeterminate");
		ok("dormant pi citizen (no socket file) → dead (ENOENT)", byGid[GID_DORMANT]?.liveness === "dead");
		ok("record-less socket → alive", byGid[GID_SOCKET_ONLY]?.liveness === "alive");
		ok("enrich null this slice (probe-only, honest)", byGid[GID_LIVE]?.cwd === null && byGid[GID_LIVE]?.model === null);
	}

	// ── dir hygiene: non-.sock + malformed names ignored ───────────────────────
	{
		const probes = await scanSocketProbes([], { dir: DIR, readdir: fakeReaddir(NAMES), probe: fakeProbe(PROBE_MAP) });
		const gids = probes.map((p) => p.gardenId);
		ok("non-.sock entry ignored (README.txt)", !gids.includes("README"));
		ok("malformed socket name (not a garden id) ignored", !gids.some((g) => g.includes("not-a-gid")));
		ok(
			"only well-formed garden ids surface",
			gids.every((g) => /^\d{8}T\d{6}-[0-9a-f]{6}$/.test(g)),
		);
	}

	// ── dedup: gid in BOTH dir and citizen list → probed once ──────────────────
	{
		const probes = await scanSocketProbes([GID_LIVE], {
			dir: DIR,
			readdir: fakeReaddir([`${GID_LIVE}.sock`]),
			probe: fakeProbe(PROBE_MAP),
		});
		ok("dedup: gid in dir AND citizen list → one probe", probes.filter((p) => p.gardenId === GID_LIVE).length === 1);
	}

	// ── missing dir → citizens still probed (→ dead) ───────────────────────────
	{
		const probes = await scanSocketProbes([GID_DORMANT], {
			dir: DIR,
			readdir: async () => {
				throw new Error("ENOENT: no such directory");
			},
			probe: fakeProbe(PROBE_MAP),
		});
		ok("missing dir → empty listing, citizen still probed", probes.length === 1);
		ok("missing dir → dormant citizen reads dead", probes[0]?.liveness === "dead");
	}

	// ── determinism: sorted by gardenId ────────────────────────────────────────
	{
		const probes = await scanSocketProbes(["20260611T333333-cccccc", "20260611T111111-aaaaaa"], {
			dir: DIR,
			readdir: async () => [],
			probe: async () => "dead",
		});
		ok("determinism: probes sorted by gardenId", probes[0]?.gardenId === "20260611T111111-aaaaaa");
	}

	// ── canonical socket path shape ────────────────────────────────────────────
	ok("controlSocketPath = <dir>/<gid>.sock", controlSocketPath(GID_LIVE, DIR) === `${DIR}/${GID_LIVE}.sock`);

	// ── end-to-end: scanSocketProbes → resolveFactList (dormant resumable) ──────
	{
		const identity = (gid: string, backend: MetaBackendV2): MetaIdentity => ({
			schemaVersion: 2,
			gardenId: gid,
			backend,
			nativeSessionId: "n",
			cwd: "/x",
			model: null,
			transcriptPath: null,
			parentGardenId: null,
			isEntwurf: false,
			createdAt: "2026-06-11T00:00:00.000Z",
			recordUpdatedAt: "2026-06-11T00:00:00.000Z",
		});
		const citizens = [identity(GID_LIVE, "pi"), identity(GID_DORMANT, "pi")];
		const probes = await scanSocketProbes([GID_LIVE, GID_DORMANT], {
			dir: DIR,
			readdir: fakeReaddir([`${GID_LIVE}.sock`]),
			probe: fakeProbe(PROBE_MAP),
		});
		const out = resolveFactList(citizens, probes);
		ok("e2e: 2 pi citizens → 2 PeerFacts (no throw — all probed)", out.peers.length === 2);
		ok("e2e: live citizen alive", out.peers.find((p) => p.gardenId === GID_LIVE)?.liveness === "alive");
		ok(
			"e2e: dormant citizen dead (resumable, not stranded)",
			out.peers.find((p) => p.gardenId === GID_DORMANT)?.liveness === "dead",
		);
		ok("e2e: dir held only LIVE socket → no record-less SocketOnlyFact", out.socketOnly.length === 0);
	}

	console.log(`\n[check-socket-discovery] ${passed} assertions ok`);
}

await main();
