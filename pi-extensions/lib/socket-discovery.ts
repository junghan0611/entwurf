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
 * This slice fills the LIVENESS axis and, for live sockets, best-effort runtime
 * enrich via the control RPC `get_info` (cwd / model / idle). `SocketProbe`'s
 * enrich fields remain nullable-by-design: a dead/indeterminate socket or a
 * failed enrich is HONEST, not synthetic, and carries `infoError` when known.
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
import {
	CONTROL_SOCKET_SUFFIX,
	controlSocketPathIn,
	defaultControlSocketDir,
	gardenIdFromSocketFilename,
} from "./control-socket-path.js";
import { fetchControlSocketRuntimeInfo, formatRuntimeModel } from "./entwurf-control-rpc.ts";
import type { SocketProbe } from "./entwurf-facts.ts";
import { SESSION_ID_RE } from "./session-id.js";
import { probeSocketLiveness, type SocketLiveness } from "./socket-probe.ts";

/** Canonical control-socket directory; the socket filename IS the gardenId
 * (동결결정3 correlation authority). Directory SOURCE stays here (HOME-derived);
 * only the path GRAMMAR lives in `control-socket-path.js`. */
export const CONTROL_SOCKET_DIR = defaultControlSocketDir(os.homedir());
/** Re-export of the grammar SSOT's suffix. Consumers and gates keep this name. */
export const SOCKET_SUFFIX = CONTROL_SOCKET_SUFFIX;

// A control-socket filename is a bare garden id. We reuse the repo-wide
// `SESSION_ID_RE` SSOT (not a local copy): 동결결정3 makes the socket filename the
// correlation authority, which only holds if the socket axis and the meta-record
// axis speak the SAME id grammar — a drifted local regex would silently drop a
// legitimate gid's socket from the scan. A malformed name has no citizen to
// correlate to and is ignored.

export function controlSocketPath(gardenId: string, dir: string = CONTROL_SOCKET_DIR): string {
	return controlSocketPathIn(dir, gardenId);
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

/**
 * A1 narrow (0.11.0): does this PROBE-FREE single-lstat inspection of a gid's canonical
 * control socket mean a record-LESS pi endpoint is addressable as a socket-only target?
 * TRUE only for a confirmed NON-SYMLINK socket file (`socket-file`); a symlinked /
 * absent / not-socket / `indeterminate` path is conservatively NOT promoted (never trust a
 * symlink, never claim a target on an unprovable lstat). Shared by the v2 production
 * `resolveTarget` so the socket-only acceptance uses the SAME lstat classification the
 * listing/conflict paths use — listing↔dispatch cannot drift on what counts as a real
 * control socket. The decider still does its own under-lock `inspectSocket` probe; this is
 * only the presence hint that promotes `bad-target` → fire-and-forget socket-only pi.
 */
export function isSocketOnlyPiCandidate(inspection: TargetSocketInspection): boolean {
	return inspection.kind === "socket-file";
}

export interface LstatLike {
	isSymbolicLink(): boolean;
	isSocket(): boolean;
}

/**
 * Inspect the EXACT control-socket path given (no gid re-derivation) and classify it by
 * lstat alone. This is the path-addressed core of the inspection: the 5c-3 spawn-bg watcher
 * observes `plan.expectedSocketPath` and MUST inspect that exact path (its contract forbids
 * re-deriving a path from the gid), so the path-taking form is the SSOT and
 * `inspectTargetControlSocket` is the thin gid→path wrapper over it. `lstatFn` is injectable
 * so the gate drives every branch without a real filesystem; the default is `fs.lstat`
 * (which, unlike connect, does NOT follow the final symlink — that is the whole point: a
 * symlink is caught as an address-conflict and never connected, P1).
 */
export async function inspectControlSocketPath(
	socketPath: string,
	lstatFn: (p: string) => Promise<LstatLike> = (p) => fs.lstat(p),
): Promise<TargetSocketInspection> {
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

/**
 * The gid-addressed inspection (？2 — lstat-then-connect, v2 decider helper): derive the
 * canonical control-socket path for `gardenId` and inspect it. A thin wrapper over
 * `inspectControlSocketPath` so the decider's gid-keyed path and the watcher's exact-path
 * observation share ONE lstat classifier (no drift in the P1 symlink guard).
 */
export async function inspectTargetControlSocket(
	gardenId: string,
	dir: string = CONTROL_SOCKET_DIR,
	lstatFn: (p: string) => Promise<LstatLike> = (p) => fs.lstat(p),
): Promise<TargetSocketInspection> {
	return inspectControlSocketPath(controlSocketPath(gardenId, dir), lstatFn);
}

/**
 * Map a target's socket inspection to a measured `SocketLiveness` (to feed
 * resolveDispatch) or a pre-probe address-conflict signal. `absent` (ENOENT only) is
 * the honest `dead` (the citizen is dormant; its canonical socket is the path a resume
 * will create). `socket-file` is the only case that connects. `address-conflict`
 * (symlink / not-a-socket) and `indeterminate` never connect.
 *
 * Shared SSOT for the v2 decider (5b, decideDispatch) AND the dead-control-send
 * fallback resolver (5c-2b): both must map an inspection the SAME way, or one could
 * route a stalled socket where the other reclaims it — exactly the F3 split this lib
 * exists to prevent. A per-caller copy would drift; this is the single mapper.
 */
export async function mapInspectionToLiveness(
	inspection: TargetSocketInspection,
	probeSocket: (socketPath: string) => Promise<SocketLiveness>,
): Promise<{ liveness: SocketLiveness; socketPath: string } | { addressConflict: true }> {
	switch (inspection.kind) {
		case "absent":
			return { liveness: "dead", socketPath: inspection.socketPath };
		case "socket-file": {
			const liveness = await probeSocket(inspection.socketPath);
			return { liveness, socketPath: inspection.socketPath };
		}
		case "indeterminate":
			return { liveness: "indeterminate", socketPath: inspection.socketPath };
		case "address-conflict":
			return { addressConflict: true };
	}
}

/** One control-socket directory entry, with the single bit the scan needs from
 * the filesystem beyond its name: whether it is a symlink (P1 forgery guard).
 * The real wiring maps `fs.readdir(dir, {withFileTypes:true})` Dirents to this. */
export interface SocketDirEntry {
	name: string;
	isSymbolicLink: boolean;
}

export interface SocketRuntimeInfo {
	cwd: string | null;
	model: string | null;
	idle: boolean | null;
}

export interface SocketScanDeps {
	dir: string;
	readdir: (dir: string) => Promise<SocketDirEntry[]>;
	probe: (socketPath: string) => Promise<SocketLiveness>;
	/** Best-effort live-socket runtime enrich. Called only when liveness === "alive". */
	getInfo: (socketPath: string) => Promise<SocketRuntimeInfo>;
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
 * and return one `SocketProbe` per gardenId (liveness + live get_info enrich), plus
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
	// Deterministic gates commonly inject fake readdir/probe over fake paths. In that
	// case, default enrich must stay no-op unless the test explicitly injects getInfo.
	// Real production calls inject neither readdir nor probe, so they get live RPC
	// enrich by default.
	const getInfo =
		deps.getInfo ??
		(deps.readdir || deps.probe
			? async (): Promise<SocketRuntimeInfo> => ({ cwd: null, model: null, idle: null })
			: getRuntimeInfoOverControlSocket);

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
		const gid = gardenIdFromSocketFilename(entry.name);
		if (gid === null) continue;
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
		let cwd: string | null = null;
		let model: string | null = null;
		let idle: boolean | null = null;
		let infoError: string | null = null;
		if (liveness === "alive") {
			try {
				const info = await getInfo(controlSocketPath(gardenId, dir));
				cwd = info.cwd;
				model = info.model;
				idle = info.idle;
			} catch (err) {
				infoError = err instanceof Error ? err.message : String(err);
			}
		}
		probes.push({ gardenId, liveness, cwd, model, idle, infoError });
	}
	symlinkedGardenIds.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
	malformedNames.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
	return { probes, symlinkedGardenIds, malformedNames, dirError };
}

async function getRuntimeInfoOverControlSocket(socketPath: string): Promise<SocketRuntimeInfo> {
	const info = await fetchControlSocketRuntimeInfo(socketPath, { timeout: 1500 });
	return {
		cwd: info.cwd ?? null,
		model: formatRuntimeModel(info) ?? null,
		idle: info.idle ?? null,
	};
}
