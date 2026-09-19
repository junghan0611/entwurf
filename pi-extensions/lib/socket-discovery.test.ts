/**
 * socket-discovery — the fact-provider's SOCKET axis (0.11 Stage 0 step 4, slice 3),
 * proven beside the module it drives (#119 V3).
 *
 * MIGRATED from scripts/check-socket-discovery.ts, assertion for assertion. Every case
 * builds its own fakes inside its own test: two of the claims below are "this seam was
 * NEVER called", and a probe flag shared across tests would record a neighbour's call.
 *
 * The original header, unchanged — deterministic gate for the fact-provider's SOCKET
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
 *   - #50 C4: a probe is gid + liveness ONLY (keyset pinned — the get_info enrich
 *     went with the socket-only quasi-citizen listing),
 *   - end-to-end: scanSocketProbes → resolveFactList yields the dormant citizen
 *     as a resumable `dead` PeerFact (no throw — all in-domain citizens probed).
 *
 * No IO, no backend, no API — readdir/probe are injected fakes.
 */

import * as path from "node:path";

import { describe, expect, it } from "vitest";

import { resolveFactList } from "./entwurf-facts.ts";
import type { MetaCitizenBackend, MetaIdentity } from "./meta-session.ts";
import {
	controlSocketPath,
	inspectControlSocketPath,
	inspectTargetControlSocket,
	type LstatLike,
	mapInspectionToLiveness,
	SOCKET_SUFFIX,
	type SocketDirEntry,
	scanSocketProbes,
} from "./socket-discovery.ts";
import type { SocketLiveness } from "./socket-probe.ts";

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

describe("scanSocketProbes — the union of dir sockets and in-domain citizens", () => {
	it("every dir socket and every pi citizen is probed", async () => {
		const { probes } = await scanSocketProbes([GID_DORMANT, GID_LIVE], {
			dir: DIR,
			readdir: fakeReaddir(NAMES),
			probe: fakeProbe(PROBE_MAP),
		});
		const byGid = Object.fromEntries(probes.map((p) => [p.gardenId, p]));
		expect(probes.length).toBe(4);
		expect(byGid[GID_LIVE]?.liveness).toBe("alive");
		// F3: a stalled socket is indeterminate and is never folded to dead.
		expect(byGid[GID_STALL]?.liveness).toBe("indeterminate");
		// The dormant trap: a pi citizen with no socket file reads dead (ENOENT), which is
		// what routes it downstream as resumable instead of leaving an unprobed gap.
		expect(byGid[GID_DORMANT]?.liveness).toBe("dead");
		expect(byGid[GID_SOCKET_ONLY]?.liveness).toBe("alive");
	});

	// #50 C4. The per-socket RPC enrich (cwd/model/idle/infoError) existed to decorate the
	// retired socket-only quasi-citizen listing. A probe carrying anything beyond gid +
	// liveness would re-open that door, so the keyset is pinned exact.
	it("a probe is gardenId + liveness ONLY — the get_info enrich is gone", async () => {
		const { probes } = await scanSocketProbes([], {
			dir: DIR,
			readdir: fakeReaddir([`${GID_LIVE}.sock`]),
			probe: fakeProbe(PROBE_MAP),
		});
		expect(Object.keys(probes[0] as object).sort()).toEqual(["gardenId", "liveness"]);
	});

	it("dir hygiene: non-.sock ignored, malformed names VISIBLY dropped (P3)", async () => {
		const { probes, malformedNames } = await scanSocketProbes([], {
			dir: DIR,
			readdir: fakeReaddir(NAMES),
			probe: fakeProbe(PROBE_MAP),
		});
		const gids = probes.map((p) => p.gardenId);
		expect(gids).not.toContain("README");
		expect(gids.some((g) => g.includes("not-a-gid"))).toBe(false);
		expect(gids.every((g) => /^\d{8}T\d{6}-[0-9a-f]{6}$/.test(g))).toBe(true);
		expect(malformedNames).toContain("not-a-gid.sock");
		// A non-.sock entry is not a malformed NAME — it is simply not ours.
		expect(malformedNames).not.toContain("README.txt");
	});

	// P1. GID_LIVE is a symlink (the forgery vector) AND a pi citizen; GID_SOCKET_ONLY is a
	// symlink with no citizen. The fake probe would answer "alive" for both, which is what
	// makes "we did not probe them" provable rather than asserted.
	it("a gid-shaped .sock symlink is never probed, and is surfaced (P1)", async () => {
		const { probes, symlinkedGardenIds } = await scanSocketProbes([GID_LIVE, GID_DORMANT], {
			dir: DIR,
			readdir: fakeReaddir([
				{ name: `${GID_LIVE}.sock`, isSymbolicLink: true },
				{ name: `${GID_SOCKET_ONLY}.sock`, isSymbolicLink: true },
				`${GID_DORMANT}.sock`,
			]),
			probe: fakeProbe({ [GID_LIVE]: "alive", [GID_SOCKET_ONLY]: "alive", [GID_DORMANT]: "alive" }),
		});
		const byGid = Object.fromEntries(probes.map((p) => [p.gardenId, p]));
		expect(symlinkedGardenIds.length).toBe(2);
		expect(byGid[GID_LIVE]?.liveness).toBe("dead");
		expect(byGid[GID_SOCKET_ONLY]).toBeUndefined();
		expect(byGid[GID_DORMANT]?.liveness).toBe("alive");
		expect(symlinkedGardenIds[0] < (symlinkedGardenIds[1] ?? "~")).toBe(true);
	});

	it("a gid in BOTH the dir and the citizen list is probed once", async () => {
		const { probes } = await scanSocketProbes([GID_LIVE], {
			dir: DIR,
			readdir: fakeReaddir([`${GID_LIVE}.sock`]),
			probe: fakeProbe(PROBE_MAP),
		});
		expect(probes.filter((p) => p.gardenId === GID_LIVE).length).toBe(1);
	});

	it("determinism: probes are sorted by gardenId", async () => {
		const { probes } = await scanSocketProbes(["20260611T333333-cccccc", "20260611T111111-aaaaaa"], {
			dir: DIR,
			readdir: async () => [],
			probe: async () => "dead",
		});
		expect(probes[0]?.gardenId).toBe("20260611T111111-aaaaaa");
	});

	it("controlSocketPath is <dir>/<gid>.sock", () => {
		expect(controlSocketPath(GID_LIVE, DIR)).toBe(`${DIR}/${GID_LIVE}.sock`);
	});
});

// P2e②. ENOENT is the normal empty directory; anything else is a LOSS of the socket axis
// and has to be surfaced rather than swallowed.
describe("scanSocketProbes — when the directory itself cannot be read", () => {
	const enoentReaddir = async () => {
		const e = new Error("ENOENT: no such directory") as NodeJS.ErrnoException;
		e.code = "ENOENT";
		throw e;
	};

	it("ENOENT → empty listing, citizen still probed, dirError null", async () => {
		const enoent = await scanSocketProbes([GID_DORMANT], {
			dir: DIR,
			readdir: enoentReaddir,
			probe: fakeProbe(PROBE_MAP),
		});
		expect(enoent.probes.length).toBe(1);
		expect(enoent.probes[0]?.liveness).toBe("dead");
		expect(enoent.dirError).toBeNull();
	});

	// The probe here would answer "alive". That it is never called is the claim: connect()
	// would follow a symlink, so an untrusted dir holds the citizen at indeterminate rather
	// than reaching through an unverified path (GPi Q2/P1).
	it("a non-ENOENT failure surfaces dirError, and the citizen is held without connecting", async () => {
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
		expect(typeof eacces.dirError).toBe("string");
		expect(eacces.dirError?.includes("EACCES")).toBe(true);
		expect(eacces.probes.length).toBe(1);
		expect(probeCalled).toBe(false);
		expect(eacces.probes[0]?.liveness).toBe("indeterminate");
	});
});

describe("end to end: scanSocketProbes feeds resolveFactList", () => {
	it("a dormant pi citizen arrives as a resumable dead PeerFact, with no throw", async () => {
		const identity = (gid: string, backend: MetaCitizenBackend): MetaIdentity => ({
			schemaVersion: 3,
			gardenId: gid,
			backend,
			nativeSessionId: "n",
			cwd: "/x",
			model: null,
			transcriptPath: null,
			createdAt: "2026-06-11T00:00:00.000Z",
			recordUpdatedAt: "2026-06-11T00:00:00.000Z",
		});
		const { probes } = await scanSocketProbes([GID_LIVE, GID_DORMANT], {
			dir: DIR,
			readdir: fakeReaddir([`${GID_LIVE}.sock`]),
			probe: fakeProbe(PROBE_MAP),
		});
		const out = resolveFactList([identity(GID_LIVE, "pi"), identity(GID_DORMANT, "pi")], probes);
		expect(out.peers.length).toBe(2);
		expect(out.peers.find((p) => p.gardenId === GID_LIVE)?.liveness).toBe("alive");
		expect(out.peers.find((p) => p.gardenId === GID_DORMANT)?.liveness).toBe("dead");
		expect(out.recordLessSockets.length).toBe(0);
	});
});

const stat = (over: Partial<Record<"sym" | "sock", boolean>>): LstatLike => ({
	isSymbolicLink: () => over.sym === true,
	isSocket: () => over.sock === true,
});
const lstatThrowing = (code: string) => async (): Promise<LstatLike> => {
	const e = new Error(`${code}: lstat`) as NodeJS.ErrnoException;
	e.code = code;
	throw e;
};

// ？2 — the single-target, lock-time inspection. lstat is injected so every branch is driven
// without a real fs, and every variant carries the canonical socketPath.
describe("inspectTargetControlSocket — lstat, then decide whether connecting is even allowed", () => {
	const DIR2 = "/fake/ctl";
	const expectedPath = controlSocketPath(GID_LIVE, DIR2);

	it("ENOENT → absent, carrying the path a resume would create", async () => {
		const absent = await inspectTargetControlSocket(GID_LIVE, DIR2, lstatThrowing("ENOENT"));
		expect(absent.kind).toBe("absent");
		expect(absent.socketPath).toBe(expectedPath);
	});

	it("a symlink → address-conflict, and is NEVER connected (P1)", async () => {
		const sym = await inspectTargetControlSocket(GID_LIVE, DIR2, async () => stat({ sym: true }));
		expect(sym.kind).toBe("address-conflict");
		expect(sym.kind === "address-conflict" && sym.reason).toBe("symlink");
	});

	it("a real socket file → socket-file, safe to connect", async () => {
		const sock = await inspectTargetControlSocket(GID_LIVE, DIR2, async () => stat({ sock: true }));
		expect(sock.kind).toBe("socket-file");
		expect(sock.socketPath).toBe(expectedPath);
	});

	it("a non-socket at the canonical path → address-conflict", async () => {
		const notSock = await inspectTargetControlSocket(GID_LIVE, DIR2, async () => stat({}));
		expect(notSock.kind).toBe("address-conflict");
		expect(notSock.kind === "address-conflict" && notSock.reason).toBe("not-socket");
	});

	it("EACCES or an unknown lstat error → indeterminate, never connect and never spawn", async () => {
		const indet = await inspectTargetControlSocket(GID_LIVE, DIR2, lstatThrowing("EACCES"));
		expect(indet.kind).toBe("indeterminate");
		expect(indet.kind === "indeterminate" && indet.error).toBe("EACCES");
	});

	it("symlink is decided BEFORE socket — one that also reports isSocket is still a conflict", async () => {
		const symSock = await inspectTargetControlSocket(GID_LIVE, DIR2, async () => stat({ sym: true, sock: true }));
		expect(symSock.kind).toBe("address-conflict");
	});
});

// 5c-3c R1 — the path-addressed SSOT. A resume watcher observes an expected socket path and
// MUST inspect THAT exact path, with no gid re-derivation.
describe("inspectControlSocketPath — the same classification, on an exact path", () => {
	const EXACT = "/fake/ctl/some-exact.sock";
	const WRAP_DIR = "/fake/ctl";

	it("ENOENT → absent, carrying the EXACT path handed in", async () => {
		const absent = await inspectControlSocketPath(EXACT, lstatThrowing("ENOENT"));
		expect(absent.kind).toBe("absent");
		expect(absent.socketPath).toBe(EXACT);
	});

	it("a symlink → address-conflict, never connected (P1)", async () => {
		const sym = await inspectControlSocketPath(EXACT, async () => stat({ sym: true }));
		expect(sym.kind).toBe("address-conflict");
		expect(sym.kind === "address-conflict" && sym.reason).toBe("symlink");
	});

	it("a socket file → socket-file, carrying the EXACT path", async () => {
		const sock = await inspectControlSocketPath(EXACT, async () => stat({ sock: true }));
		expect(sock.kind).toBe("socket-file");
		expect(sock.socketPath).toBe(EXACT);
	});

	it("a non-socket → address-conflict", async () => {
		const notSock = await inspectControlSocketPath(EXACT, async () => stat({}));
		expect(notSock.kind).toBe("address-conflict");
		expect(notSock.kind === "address-conflict" && notSock.reason).toBe("not-socket");
	});

	it("EACCES → indeterminate, carrying the error code", async () => {
		const indet = await inspectControlSocketPath(EXACT, lstatThrowing("EACCES"));
		expect(indet.kind).toBe("indeterminate");
		expect(indet.kind === "indeterminate" && indet.error).toBe("EACCES");
	});

	// The thin-wrapper equivalence: the gid wrapper feeds the path-core
	// controlSocketPath(gid, dir) verbatim, so the two cannot drift.
	it("the gid wrapper is the path core over controlSocketPath(gid)", async () => {
		const wrapped = await inspectTargetControlSocket(GID_LIVE, WRAP_DIR, async () => stat({ sock: true }));
		const direct = await inspectControlSocketPath(controlSocketPath(GID_LIVE, WRAP_DIR), async () =>
			stat({ sock: true }),
		);
		expect(wrapped.socketPath).toBe(direct.socketPath);
		expect(wrapped.kind).toBe(direct.kind);
	});
});

// The shared inspection→liveness mapper, SSOT for the 5b decider AND the 5c-2b
// dead-control-send resolver. Proving the 4-way mapping here is what makes a drift between
// those two callers impossible.
describe("mapInspectionToLiveness", () => {
	const SP = "/fake/ctl/m.sock";

	it("absent → dead (ENOENT is an honest dormant), carrying socketPath", async () => {
		const absent = await mapInspectionToLiveness({ kind: "absent", socketPath: SP }, async () => "alive");
		expect("addressConflict" in absent).toBe(false);
		expect(!("addressConflict" in absent) && absent.liveness).toBe("dead");
		expect(!("addressConflict" in absent) && absent.socketPath).toBe(SP);
	});

	it("socket-file → the probe result, and it is the ONLY case that connects", async () => {
		let probed = "";
		const live = await mapInspectionToLiveness({ kind: "socket-file", socketPath: SP }, async (p) => {
			probed = p;
			return "alive";
		});
		expect(!("addressConflict" in live) && live.liveness).toBe("alive");
		expect(probed).toBe(SP);
	});

	it("socket-file + probe indeterminate → indeterminate, never folded to dead", async () => {
		const stall = await mapInspectionToLiveness({ kind: "socket-file", socketPath: SP }, async () => "indeterminate");
		expect(!("addressConflict" in stall) && stall.liveness).toBe("indeterminate");
	});

	it("inspect indeterminate → indeterminate, and NEVER connects", async () => {
		let connected = false;
		const indet = await mapInspectionToLiveness(
			{ kind: "indeterminate", socketPath: SP, error: "EACCES" },
			async () => {
				connected = true;
				return "alive";
			},
		);
		expect(!("addressConflict" in indet) && indet.liveness).toBe("indeterminate");
		expect(connected).toBe(false);
	});

	it("address-conflict → {addressConflict:true}, and NEVER connects", async () => {
		let connected = false;
		const conflict = await mapInspectionToLiveness(
			{ kind: "address-conflict", socketPath: SP, reason: "symlink" },
			async () => {
				connected = true;
				return "alive";
			},
		);
		expect("addressConflict" in conflict).toBe(true);
		expect(connected).toBe(false);
	});
});
