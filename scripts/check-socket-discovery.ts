/**
 * check-socket-discovery — deterministic gate for the fact-provider's SOCKET
 * axis (0.11 Stage 0 step 4, slice 3). Drives `scanSocketProbes` with injected
 * readdir/probe (no IO) and proves the slice-2 contract is fed correctly:
 *
 *   - union: every dir-present socket AND every in-domain citizen is probed,
 *   - dormant trap: a pi citizen with NO socket file reads `dead` (ENOENT), so
 *     downstream it routes dormant→resumable (never an unprobed gap),
 *   - F3 preserve: a stalled socket reads `indeterminate`, never folded to dead,
 *   - dir hygiene: non-`.sock` names ignored; malformed (non-garden-id) names
 *     are VISIBLY dropped (`malformedNames`), not silently (P3),
 *   - symlink guard (P1): a gid-shaped `*.sock` symlink is never probed — a
 *     citizen owning one is forced `dead`, a record-less one dropped — and is
 *     surfaced in `symlinkedGardenIds`,
 *   - dir-read error (P2e②): ENOENT → `dirError=null` (normal empty); any other
 *     failure → `dirError` set (socket axis loss surfaced, not swallowed),
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
import {
	controlSocketPath,
	inspectTargetControlSocket,
	type LstatLike,
	SOCKET_SUFFIX,
	type SocketDirEntry,
	scanSocketProbes,
} from "../pi-extensions/lib/socket-discovery.ts";
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

// Plain regular-file entries (the common case). A name may be passed as a
// `{name, isSymbolicLink}` tuple to mark it a symlink.
function fakeReaddir(names: Array<string | SocketDirEntry>): (dir: string) => Promise<SocketDirEntry[]> {
	return async () => names.map((n) => (typeof n === "string" ? { name: n, isSymbolicLink: false } : n));
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
		const { probes } = await scanSocketProbes([GID_DORMANT, GID_LIVE], {
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

	// ── dir hygiene: non-.sock ignored; malformed names VISIBLY dropped (P3) ────
	{
		const { probes, malformedNames } = await scanSocketProbes([], {
			dir: DIR,
			readdir: fakeReaddir(NAMES),
			probe: fakeProbe(PROBE_MAP),
		});
		const gids = probes.map((p) => p.gardenId);
		ok("non-.sock entry ignored (README.txt)", !gids.includes("README"));
		ok("malformed socket name (not a garden id) not probed", !gids.some((g) => g.includes("not-a-gid")));
		ok(
			"only well-formed garden ids surface",
			gids.every((g) => /^\d{8}T\d{6}-[0-9a-f]{6}$/.test(g)),
		);
		ok("P3: malformed .sock name surfaced (not silently dropped)", malformedNames.includes("not-a-gid.sock"));
		ok("P3: non-.sock entry is NOT a malformed-name diagnostic", !malformedNames.includes("README.txt"));
	}

	// ── symlink guard (P1): gid-shaped .sock symlink never probed, surfaced ─────
	{
		// GID_LIVE is a symlink (forgery vector) AND a pi citizen; GID_SOCKET_ONLY is
		// a symlink with no citizen (record-less). GID_DORMANT is a clean citizen.
		const { probes, symlinkedGardenIds } = await scanSocketProbes([GID_LIVE, GID_DORMANT], {
			dir: DIR,
			readdir: fakeReaddir([
				{ name: `${GID_LIVE}.sock`, isSymbolicLink: true },
				{ name: `${GID_SOCKET_ONLY}.sock`, isSymbolicLink: true },
				`${GID_DORMANT}.sock`,
			]),
			// probe would return "alive" for both — proving we did NOT probe the symlinks.
			probe: fakeProbe({ [GID_LIVE]: "alive", [GID_SOCKET_ONLY]: "alive", [GID_DORMANT]: "alive" }),
		});
		const byGid = Object.fromEntries(probes.map((p) => [p.gardenId, p]));
		ok("P1: symlinked sockets surfaced in symlinkedGardenIds", symlinkedGardenIds.length === 2);
		ok("P1: symlinked citizen forced dead (NOT probed alive)", byGid[GID_LIVE]?.liveness === "dead");
		ok("P1: record-less symlink dropped from probes entirely", byGid[GID_SOCKET_ONLY] === undefined);
		ok("P1: clean citizen still probed normally", byGid[GID_DORMANT]?.liveness === "alive");
		ok(
			"P1: symlinkedGardenIds sorted",
			symlinkedGardenIds[0] !== undefined && symlinkedGardenIds[0] < (symlinkedGardenIds[1] ?? "~"),
		);
	}

	// ── dedup: gid in BOTH dir and citizen list → probed once ──────────────────
	{
		const { probes } = await scanSocketProbes([GID_LIVE], {
			dir: DIR,
			readdir: fakeReaddir([`${GID_LIVE}.sock`]),
			probe: fakeProbe(PROBE_MAP),
		});
		ok("dedup: gid in dir AND citizen list → one probe", probes.filter((p) => p.gardenId === GID_LIVE).length === 1);
	}

	// ── dir-read error (P2e②): ENOENT empty vs other-error surfaced ────────────
	{
		const enoent = await scanSocketProbes([GID_DORMANT], {
			dir: DIR,
			readdir: async () => {
				const e = new Error("ENOENT: no such directory") as NodeJS.ErrnoException;
				e.code = "ENOENT";
				throw e;
			},
			probe: fakeProbe(PROBE_MAP),
		});
		ok("missing dir (ENOENT) → empty listing, citizen still probed", enoent.probes.length === 1);
		ok("missing dir → dormant citizen reads dead", enoent.probes[0]?.liveness === "dead");
		ok("P2e②: ENOENT is the normal empty → dirError null (not surfaced)", enoent.dirError === null);

		// probe returns "alive" — proving the citizen is NOT probed when the dir is
		// untrusted (a non-ENOENT readdir failure): connect() would follow a symlink,
		// so we hold the citizen at indeterminate instead (GPi Q2/P1).
		let probeCalled = false;
		const eacces = await scanSocketProbes([GID_DORMANT], {
			dir: DIR,
			readdir: async () => {
				const e = new Error("EACCES: permission denied, scandir") as NodeJS.ErrnoException;
				e.code = "EACCES";
				throw e;
			},
			probe: async () => {
				probeCalled = true;
				return "alive";
			},
		});
		ok("P2e②: non-ENOENT readdir failure → dirError surfaced", typeof eacces.dirError === "string");
		ok("P2e②: EACCES message preserved in dirError", eacces.dirError?.includes("EACCES") === true);
		ok("P2e②: citizen still reported (socket axis lost, not blinded)", eacces.probes.length === 1);
		ok("P2e②/P1: untrusted dir → citizen NOT probed (no connect through unverified path)", !probeCalled);
		ok(
			"P2e②/P1: untrusted dir → citizen held at indeterminate (not alive, not stranded)",
			eacces.probes[0]?.liveness === "indeterminate",
		);
	}

	// ── determinism: sorted by gardenId ────────────────────────────────────────
	{
		const { probes } = await scanSocketProbes(["20260611T333333-cccccc", "20260611T111111-aaaaaa"], {
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
		const { probes } = await scanSocketProbes([GID_LIVE, GID_DORMANT], {
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

	// ── inspectTargetControlSocket (？2 — lstat-then-connect, v2 decider helper) ──
	// The single-target, lock-time inspection. lstat is injected so every branch is
	// driven without a real fs; every variant carries the canonical socketPath.
	{
		const DIR2 = "/fake/ctl";
		const expectedPath = controlSocketPath(GID_LIVE, DIR2);
		const stat = (over: Partial<Record<"sym" | "sock", boolean>>): LstatLike => ({
			isSymbolicLink: () => over.sym === true,
			isSocket: () => over.sock === true,
		});
		const lstatThrowing = (code: string) => async (): Promise<LstatLike> => {
			const e = new Error(`${code}: lstat`) as NodeJS.ErrnoException;
			e.code = code;
			throw e;
		};

		// ENOENT → absent (the citizen is dormant; this is the path a resume creates).
		const absent = await inspectTargetControlSocket(GID_LIVE, DIR2, lstatThrowing("ENOENT"));
		ok("inspect: ENOENT → absent", absent.kind === "absent");
		ok("inspect: absent carries socketPath", absent.socketPath === expectedPath);

		// symlink → address-conflict (NEVER connected — P1), reason symlink.
		const sym = await inspectTargetControlSocket(GID_LIVE, DIR2, async () => stat({ sym: true }));
		ok("inspect: symlink → address-conflict", sym.kind === "address-conflict");
		ok("inspect: symlink reason", sym.kind === "address-conflict" && sym.reason === "symlink");

		// a real socket file → socket-file (safe to connect now).
		const sock = await inspectTargetControlSocket(GID_LIVE, DIR2, async () => stat({ sock: true }));
		ok("inspect: socket file → socket-file", sock.kind === "socket-file");
		ok("inspect: socket-file carries socketPath", sock.socketPath === expectedPath);

		// a non-socket regular file/dir at the canonical path → address-conflict.
		const notSock = await inspectTargetControlSocket(GID_LIVE, DIR2, async () => stat({}));
		ok("inspect: non-socket → address-conflict", notSock.kind === "address-conflict");
		ok("inspect: non-socket reason", notSock.kind === "address-conflict" && notSock.reason === "not-socket");

		// EACCES / unknown lstat error → indeterminate (never connect, never spawn).
		const indet = await inspectTargetControlSocket(GID_LIVE, DIR2, lstatThrowing("EACCES"));
		ok("inspect: EACCES → indeterminate", indet.kind === "indeterminate");
		ok("inspect: indeterminate carries error code", indet.kind === "indeterminate" && indet.error === "EACCES");
		// symlink is decided BEFORE socket — a symlink that also reports isSocket is still a conflict.
		const symSock = await inspectTargetControlSocket(GID_LIVE, DIR2, async () => stat({ sym: true, sock: true }));
		ok("inspect: symlink wins over isSocket (never connect a symlink)", symSock.kind === "address-conflict");
	}

	console.log(`\n[check-socket-discovery] ${passed} assertions ok`);
}

await main();
