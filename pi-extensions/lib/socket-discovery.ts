/**
 * socket-discovery — the SOCKET-axis wiring for the fact-provider (0.11 Stage 0
 * step 4, slice 3). Turns the control-socket directory + the in-domain citizen
 * list into the `SocketProbe[]` that `resolveFactList` (slice 2) consumes.
 *
 * Why a probe per in-domain citizen, not just a directory listing: slice 2's
 * frozen invariant is that EVERY in-domain (pi) citizen must arrive PROBED — a
 * dormant citizen whose socket file is gone must read as `dead` (ENOENT =
 * positive proof of absence) so it routes dormant→resumable, never as an
 * unprobed `null`/`indeterminate` that would strand it (resolveFactList throws
 * on an unprobed in-domain citizen). So we probe the union of
 *   (sockets present in the dir) ∪ (every in-domain citizen's canonical path):
 * a dir-present socket yields alive / indeterminate / dead; a citizen with no
 * file yields `dead` via ENOENT. Three-valued throughout (`probeSocketLiveness`)
 * — an indeterminate stall is NEVER folded to dead (F3). This is exactly why we
 * cannot reuse the legacy `getLiveSessions` (alive-only listing): folding the
 * hidden indeterminate/dead sockets into "absent" would resurrect the F3 split.
 *
 * This slice fills only the LIVENESS axis. The get_info enrich (cwd / model /
 * idle) is a separate follow-up — `SocketProbe`'s enrich fields are
 * nullable-by-design, so a probe with no RPC enrich is HONEST, not synthetic.
 *
 * Three socket-axis hazards are surfaced (slice 4c, Fable 검수), never swallowed:
 *   - SYMLINK (P1, security): a `<gid>.sock` that is a symlink can redirect to
 *     another session's listener, so gid X would probe ALIVE on Y's socket — a
 *     forgery of 동결결정3's correlation authority (the socket filename = the gid).
 *     The legacy bridge `getLiveSessions` guarded this (`entry.isSymbolicLink()`);
 *     deriving the listing from facts would drop that guard unless we re-assert it
 *     here. A symlinked socket is NEVER probed: a citizen owning one is forced to
 *     `dead` (→ dormant → resume a fresh process, never SEND to a hijacked
 *     listener); a record-less one is quarantined out of the listing entirely.
 *     Both surface as `symlinkedGardenIds`.
 *   - MALFORMED NAME (P3): a `*.sock` whose stem is not a garden id has no citizen
 *     to correlate to and is dropped — but VISIBLY (`malformedNames`), not
 *     silently (the legacy path listed any non-empty name; a silent regex drop
 *     would violate "no silent drops").
 *   - DIR-READ ERROR (P2e②): a missing dir (ENOENT) is the normal fresh-install
 *     empty; ANY OTHER readdir failure (EACCES, …) is asymmetric loss of the whole
 *     socket axis and is surfaced as `dirError`, not catch-all'd to empty (which
 *     would silently vanish every socket-only session). When the dir is untrusted
 *     this way, in-domain citizens are NOT probed (a non-ENOENT readdir failure
 *     means we cannot confirm the canonical path is not a symlink, and `connect()`
 *     would follow one) — they are reported `indeterminate` (liveness unknown),
 *     held not stranded: once the dir reads again they route normally (GPi Q2/P1).
 * The provider (slice 4b) folds these three into kind-tagged `EntwurfDiagnostic`s;
 * this lib only reports the raw facts so the import stays one-way (provider →
 * socket-discovery, never back).
 *
 * Deps (dir / readdir / probe) are injectable so the gate drives it without IO.
 */

import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import type { SocketProbe } from "./entwurf-facts.ts";
import { SESSION_ID_RE } from "./session-id.js";
import { probeSocketLiveness, type SocketLiveness } from "./socket-probe.ts";

/** Canonical control-socket directory; the socket filename IS the gardenId
 * (동결결정3 correlation authority). */
export const CONTROL_SOCKET_DIR = path.join(os.homedir(), ".pi", "entwurf-control");
export const SOCKET_SUFFIX = ".sock";

// A control-socket filename is a bare garden id. We reuse the repo-wide
// `SESSION_ID_RE` SSOT (not a local copy): 동결결정3 makes the socket filename the
// correlation authority, which only holds if the socket axis and the meta-record
// axis speak the SAME id grammar — a drifted local regex would silently drop a
// legitimate gid's socket from the scan. A malformed name has no citizen to
// correlate to and is ignored.

export function controlSocketPath(gardenId: string, dir: string = CONTROL_SOCKET_DIR): string {
	return path.join(dir, `${gardenId}${SOCKET_SUFFIX}`);
}

/**
 * Target-specific control-socket inspection for the v2 decider (？2 — lstat-then-
 * connect). The listing scan (`scanSocketProbes`) reads readdir dirents; a dispatch
 * decision needs a fresh, single-target lstat UNDER the per-gid lock so a symlink
 * planted between listing and dispatch cannot forge an alive liveness and hijack a
 * control-socket send (the P1 reopening `probeSocketLiveness`-alone would allow,
 * since it is connect-only and follows symlinks). This helper NEVER connects — it
 * only classifies the canonical path's type so the decider can decide whether a
 * probe is even safe:
 *   - `absent` (ENOENT only)            → in-domain ⇒ dead (dormant)
 *   - `socket-file`                     → safe to probe (connect) now
 *   - `address-conflict` (symlink OR    → reject `target-address-conflict` (the gid
 *      not-a-socket)                       resolves to a forged/corrupt address)
 *   - `indeterminate` (EACCES/unknown)  → not provably absent, never connect, no spawn
 * Every variant carries `socketPath` so the decider plants the SAME path into the
 * plan (no re-derivation — 4c SSOT). `lstatFn` is injectable so the gate drives
 * every branch without a real filesystem; the default is `fs.lstat` (which, unlike
 * connect, does NOT follow the final symlink — that is the whole point).
 */
export type TargetSocketInspection =
	| { kind: "absent"; socketPath: string }
	| { kind: "socket-file"; socketPath: string }
	| { kind: "address-conflict"; socketPath: string; reason: "symlink" | "not-socket" }
	| { kind: "indeterminate"; socketPath: string; error: string };

export interface LstatLike {
	isSymbolicLink(): boolean;
	isSocket(): boolean;
}

export async function inspectTargetControlSocket(
	gardenId: string,
	dir: string = CONTROL_SOCKET_DIR,
	lstatFn: (p: string) => Promise<LstatLike> = (p) => fs.lstat(p),
): Promise<TargetSocketInspection> {
	const socketPath = controlSocketPath(gardenId, dir);
	let st: LstatLike;
	try {
		st = await lstatFn(socketPath);
	} catch (err) {
		const code = (err as NodeJS.ErrnoException).code;
		if (code === "ENOENT") return { kind: "absent", socketPath };
		// EACCES / unknown: not provably absent, so never treat as dead-and-spawn.
		return { kind: "indeterminate", socketPath, error: code ?? "unknown lstat error" };
	}
	// lstat does NOT dereference the final component — a symlink is caught HERE and
	// never connected (P1). A non-socket regular file / dir / fifo at the canonical
	// path is address corruption, not a live socket.
	if (st.isSymbolicLink()) return { kind: "address-conflict", socketPath, reason: "symlink" };
	if (st.isSocket()) return { kind: "socket-file", socketPath };
	return { kind: "address-conflict", socketPath, reason: "not-socket" };
}

/** One control-socket directory entry, with the single bit the scan needs from
 * the filesystem beyond its name: whether it is a symlink (P1 forgery guard).
 * The real wiring maps `fs.readdir(dir, {withFileTypes:true})` Dirents to this. */
export interface SocketDirEntry {
	name: string;
	isSymbolicLink: boolean;
}

export interface SocketScanDeps {
	dir: string;
	readdir: (dir: string) => Promise<SocketDirEntry[]>;
	probe: (socketPath: string) => Promise<SocketLiveness>;
}

/**
 * The socket axis result. `probes` is the listing input to `resolveFactList`;
 * the other three are surfaced hazards (see the module header) the provider folds
 * into diagnostics — never hidden.
 */
export interface SocketScanResult {
	probes: SocketProbe[];
	/** gid-shaped `*.sock` symlinks: quarantined from probing (P1). */
	symlinkedGardenIds: string[];
	/** `*.sock` names that are not garden ids: visibly dropped (P3). */
	malformedNames: string[];
	/** non-ENOENT readdir failure: socket axis lost, surfaced not swallowed (P2e②). */
	dirError: string | null;
}

/**
 * Probe the union of (control sockets present in `dir`) ∪ (`piCitizenGardenIds`)
 * and return one `SocketProbe` per gardenId (liveness only; enrich = null), plus
 * the three surfaced hazards. A missing directory (ENOENT) is the normal empty
 * (`dirError=null`) — the in-domain citizens are still probed (their absent
 * canonical paths read `dead`); any OTHER readdir failure sets `dirError`. A
 * symlinked `*.sock` is never probed (P1): a citizen owning one is forced `dead`,
 * a record-less one is dropped from `probes` entirely. Output sorted by gardenId.
 */
export async function scanSocketProbes(
	piCitizenGardenIds: readonly string[],
	deps: Partial<SocketScanDeps> = {},
): Promise<SocketScanResult> {
	const dir = deps.dir ?? CONTROL_SOCKET_DIR;
	const readdir =
		deps.readdir ??
		(async (d: string): Promise<SocketDirEntry[]> => {
			const dirents = await fs.readdir(d, { withFileTypes: true });
			return dirents.map((e) => ({ name: e.name, isSymbolicLink: e.isSymbolicLink() }));
		});
	const probe = deps.probe ?? ((p: string) => probeSocketLiveness(p));

	let entries: SocketDirEntry[] = [];
	let dirError: string | null = null;
	try {
		entries = await readdir(dir);
	} catch (err) {
		// ENOENT = fresh install / no sessions yet = the normal empty. Anything else
		// (EACCES, EIO, …) is real loss of the socket axis — surface it, don't hide it.
		const code = (err as NodeJS.ErrnoException)?.code;
		if (code !== "ENOENT") {
			dirError = err instanceof Error ? err.message : String(err);
		}
		entries = [];
	}

	const socketGids = new Set<string>();
	const symlinkedGardenIds: string[] = [];
	const malformedNames: string[] = [];
	for (const entry of entries) {
		if (!entry.name.endsWith(SOCKET_SUFFIX)) continue;
		const gid = entry.name.slice(0, -SOCKET_SUFFIX.length);
		if (!SESSION_ID_RE.test(gid)) {
			malformedNames.push(entry.name);
			continue;
		}
		if (entry.isSymbolicLink) {
			// Never trust a symlinked socket: it can point at another session's
			// listener and forge an `alive` for this gid (동결결정3 authority forgery).
			symlinkedGardenIds.push(gid);
			continue;
		}
		socketGids.add(gid);
	}
	const symlinkSet = new Set(symlinkedGardenIds);

	// A non-ENOENT readdir failure means the dir is untrusted: we could not enumerate
	// it, so we cannot confirm a canonical path is not a symlink. connect() follows
	// symlinks, so probing here would defeat the P1 guard — hold every citizen at
	// `indeterminate` instead (the socket-dir-read-error diagnostic carries the why).
	const dirUntrusted = dirError !== null;
	const allGids = [...new Set([...socketGids, ...piCitizenGardenIds])].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
	const probes: SocketProbe[] = [];
	for (const gardenId of allGids) {
		// A citizen whose canonical socket is a symlink is forced `dead` (→ dormant →
		// resume a fresh process) rather than probed through the untrusted link. A
		// record-less symlink gid is not in `allGids` at all (dropped above).
		let liveness: SocketLiveness;
		if (symlinkSet.has(gardenId)) {
			liveness = "dead";
		} else if (dirUntrusted) {
			liveness = "indeterminate";
		} else {
			liveness = await probe(controlSocketPath(gardenId, dir));
		}
		probes.push({ gardenId, liveness, cwd: null, model: null, idle: null, infoError: null });
	}
	symlinkedGardenIds.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
	malformedNames.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
	return { probes, symlinkedGardenIds, malformedNames, dirError };
}
