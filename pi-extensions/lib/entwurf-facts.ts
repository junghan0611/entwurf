/**
 * entwurf-facts — the TS fact-provider's PURE core (0.11 Stage 0 step 4).
 *
 * The "brain" reads disk SSOT (meta-record) + a socket probe and emits FACTS,
 * never verbs. This module holds the single pure composition step:
 *
 *     (MetaIdentity, SocketLiveness | null)  →  PeerFact
 *
 * What it deliberately does NOT do (동결결정 10 / bucket B boundary):
 *   - NO verb-routing. A `PeerFact` carries no `resumable`/`sendable`/`transport`
 *     /`dispatch` field. Whether a target is resumed or sent-to is computed at
 *     call time by the entwurf_v2 dispatch table from `liveness` — baking that
 *     decision into the fact layer is exactly what makes `entwurf_peers` lie
 *     (the reason 동결결정 10 orders contract-lock before this provider).
 *   - NO IO. readdir of the meta-store and the live socket probe are slice-2
 *     wiring; this slice locks the fact SHAPE and the R1/R3b liveness invariant
 *     in code first (gate-first discipline), with both inputs injected.
 *   - NO transcriptPath. The transcript path is a private on-disk location, not
 *     a peer-facing fact; `entwurf_peers` exposes identity + cwd-history, not
 *     filesystem internals. (who-can / dispatch read it via the meta-record
 *     directly when they genuinely need it — it does not belong in the listing.)
 *
 * The 4-value liveness (`alive|dead|indeterminate|unsupported`, R3b) and the
 * out-of-domain → `unsupported` rule (R1: never coerce an unprobed backend to
 * `dead`/`indeterminate`) come from entwurf-v2-contract's `factLivenessOf` — the
 * frozen contract is the single source for that mapping; this module only shapes
 * the surrounding identity facts around it.
 */

import { type FactLiveness, factLivenessOf, isLivenessSupported } from "./entwurf-v2-contract.ts";
import type { MetaBackendV2, MetaIdentity } from "./meta-session.ts";
import type { SocketLiveness } from "./socket-probe.ts";

/**
 * Facts-only view of one garden citizen for `entwurf_peers`. Every field except
 * `liveness` is verbatim identity / cwd-history from the meta-record; `liveness`
 * is the one COMPUTED fact (4-value, R1/R3b). No verb-routing, no transcript.
 */
export interface PeerFact {
	// — identity + cwd-history facts (verbatim from the meta-record) —
	gardenId: string;
	backend: MetaBackendV2;
	nativeSessionId: string;
	cwd: string;
	model: string | null;
	parentGardenId: string | null;
	isEntwurf: boolean;
	createdAt: string;
	recordUpdatedAt: string;
	// — the single computed fact: 4-value liveness (R1/R3b). NOT a verb. —
	liveness: FactLiveness;
}

/**
 * Compose a `PeerFact` from a citizen's identity and an optional socket probe.
 *
 * `socket` is the 3-value control-socket result for an IN-DOMAIN backend (pi),
 * or `null` when no probe was taken (out-of-domain backend, or in-domain with no
 * socket found). `factLivenessOf` resolves the 4-value fact:
 *   - out-of-domain backend       → `unsupported`   (R1, regardless of `socket`)
 *   - in-domain, socket present    → that socket value
 *   - in-domain, socket null        → `indeterminate` (no proof, never `dead`)
 *
 * Pure: same inputs → same output, no IO.
 */
export function resolvePeerFact(identity: MetaIdentity, socket: SocketLiveness | null): PeerFact {
	return {
		gardenId: identity.gardenId,
		backend: identity.backend,
		nativeSessionId: identity.nativeSessionId,
		cwd: identity.cwd,
		model: identity.model,
		parentGardenId: identity.parentGardenId,
		isEntwurf: identity.isEntwurf,
		createdAt: identity.createdAt,
		recordUpdatedAt: identity.recordUpdatedAt,
		liveness: factLivenessOf(identity.backend, socket),
	};
}

/**
 * A non-pi RECORD whose gardenId collides with a control socket — a real (probed)
 * one OR a symlinked/forged one. The gardenId is the universal address (동결결정3),
 * so a non-pi citizen sharing it with a socket means a send-path that reaches the
 * socket first hits a DIFFERENT receiver than the record names — an address split.
 * Both the citizen and the socket are quarantined from the facts listing.
 *
 * The union `socketGids ∪ symlinkedGardenIds` is load-bearing: `socketGids` are
 * gids with a real probed `*.sock`, but `symlinkedGardenIds` are NEVER probed (P1)
 * and so are absent from `socketGids`. Looking at `socketGids` alone (the
 * fact-provider:125 gap this closes) let a non-pi citizen with a *symlinked* socket
 * survive as a clean PeerFact while the legacy send path still followed the symlink
 * to a forged receiver. Both axes claim the gid → both must quarantine it.
 *
 * SCOPE: this is the RECORD-side, non-pi conflict only — shared by the fact-provider
 * (listing) and the v2 decider (dispatch) so the two cannot drift (4c "재유도 금지"
 * 동형; only the observation-bit source is parameterized). A pi citizen whose own
 * canonical socket is a symlink is NOT this predicate's concern — that is a
 * target-specific lstat conflict the decider's `inspectTargetControlSocket` raises
 * as `address-conflict`, kept deliberately separate (GPT 1차 검수 C).
 */
export function isNonPiGardenIdSocketConflict(
	backend: string,
	gardenId: string,
	socketGids: ReadonlySet<string>,
	symlinkedGardenIds: ReadonlySet<string>,
): boolean {
	return !isLivenessSupported(backend) && (socketGids.has(gardenId) || symlinkedGardenIds.has(gardenId));
}

// ── slice 2: meta-store axis ⨯ socket axis → facts-only listing ─────────────
// (설계 동결 2026-06-11, GPT힣 + Fable 수렴 — NEXT.md "step 4 slice 2 설계 동결")

/**
 * The SOCKET-axis input to the union: one 3-value probe of a control socket plus
 * its get_info-derived runtime enrich. Slice-3 wiring fills this by probing the
 * control-socket dir AND every in-domain citizen's canonical socket path with
 * `probeSocketLiveness` (3-value, indeterminate preserved). `liveness` is the
 * 3-value `SocketLiveness` — never `unsupported`, because a probe genuinely ran.
 * The enrich fields are probe-derived RUNTIME facts (the get_info RPC), labelled
 * as such — they are NOT meta-record identity and NOT synthetic; a `null` means
 * the RPC did not surface that field (see `infoError`).
 */
export interface SocketProbe {
	gardenId: string;
	liveness: SocketLiveness;
	cwd: string | null;
	model: string | null;
	idle: boolean | null;
	infoError: string | null;
}

/**
 * A record-less control-socket probe — a socket path that no meta-record citizen
 * claims. The canonical case is "socket-only pi": a live pi session that predates
 * the pi meta-record writer, or one caught in a deploy-lag / crash window. But
 * `liveness` is the full 3-value `SocketLiveness`, NOT only `alive` — a
 * dir-present stale socket arrives as `dead` and a load-stalled one as
 * `indeterminate`; both stay in the listing (hiding a dead socket is GC's job,
 * not the listing's, and an indeterminate socket-only — "not unlinked, not live"
 * — is the most worth surfacing). Kept as a DISTINCT fact kind, never folded into
 * `PeerFact` and never given a 5th liveness value: "this socket has no citizen"
 * is a statement whose SUBJECT is the socket, not a citizen, so it must not
 * borrow the citizen-keyed 4-value liveness enum (the sibling of R1 — do not
 * collapse a different subject). All fields are the socket filename (gardenId =
 * 동결결정3 correlation authority) + probe-derived runtime facts.
 */
export interface SocketOnlyFact {
	kind: "socket-only";
	gardenId: string;
	liveness: SocketLiveness;
	cwd: string | null;
	model: string | null;
	idle: boolean | null;
	infoError: string | null;
}

/**
 * The union output. Two arrays, NOT one discriminated array: the surface layer
 * (slice 4) may tag a `PeerFact` with `kind:"peer"` when it merges the sections,
 * but the pure core keeps `PeerFact`'s slice-1 keyset untouched (no `kind` field
 * baked onto it). `entwurf_peers` reports both sections so the new listing fully
 * replaces the old live-pi discovery.
 */
export interface FactList {
	peers: PeerFact[];
	socketOnly: SocketOnlyFact[];
}

/**
 * Pure union of the meta-store axis (citizens) and the socket axis (probes) into
 * a facts-only listing. No IO — slice-3 wiring reads the meta-store and probes
 * the sockets, then injects both lists.
 *
 * Correlation key = `gardenId` (동결결정3; `nativeSessionId` is backend-local, not
 * a global key). Rules frozen 2026-06-11 (GPT힣 + Fable):
 *   - in-domain (pi) citizen: liveness = its socket probe (3-value preserved).
 *     The wiring MUST probe every in-domain citizen's canonical socket path, so a
 *     citizen ABSENT from `socketProbes` is a wiring-invariant violation → throw.
 *     We never pass `null` for a pi citizen (resolvePeerFact would map it to
 *     `indeterminate` and strand a dormant citizen as un-resumable); a dormant
 *     citizen's absent socket file is probed to `dead` (ENOENT) by the wiring and
 *     arrives here AS `dead` → dormant → resumable.
 *   - out-of-domain citizen WITH a control socket at its gardenId → fail-loud
 *     (address ambiguity; a non-pi citizen must not own a pi control socket).
 *   - out-of-domain citizen without a socket → `unsupported` (via resolvePeerFact).
 *   - a probed gardenId with NO citizen → `SocketOnlyFact` (socket-only pi).
 * A gardenId is never emitted as both a `PeerFact` and a `SocketOnlyFact`; once a
 * pi meta-record writer ships, a socket-only entry is promoted to a `PeerFact`.
 */
export function resolveFactList(identities: MetaIdentity[], socketProbes: SocketProbe[]): FactList {
	const probeMap = new Map<string, SocketProbe>();
	for (const probe of socketProbes) {
		if (probeMap.has(probe.gardenId)) {
			throw new Error(`resolveFactList: duplicate socket probe for gardenId ${probe.gardenId}`);
		}
		probeMap.set(probe.gardenId, probe);
	}

	const peers: PeerFact[] = [];
	const consumed = new Set<string>();
	for (const identity of identities) {
		const gid = identity.gardenId;
		if (consumed.has(gid)) {
			throw new Error(`resolveFactList: duplicate meta-record for gardenId ${gid}`);
		}
		let socket: SocketLiveness | null;
		if (isLivenessSupported(identity.backend)) {
			const probe = probeMap.get(gid);
			if (!probe) {
				throw new Error(
					`resolveFactList: in-domain citizen ${gid} (${identity.backend}) was not probed — ` +
						"wiring must probe every in-domain citizen's canonical socket path (absent file → dead, never unprobed)",
				);
			}
			socket = probe.liveness;
		} else {
			if (probeMap.has(gid)) {
				throw new Error(
					`resolveFactList: out-of-domain citizen ${gid} (${identity.backend}) has a control socket — ` +
						"address ambiguity (a non-pi citizen must not own a pi control socket)",
				);
			}
			socket = null;
		}
		peers.push(resolvePeerFact(identity, socket));
		consumed.add(gid);
	}

	const socketOnly: SocketOnlyFact[] = [];
	for (const probe of socketProbes) {
		if (consumed.has(probe.gardenId)) continue;
		socketOnly.push({
			kind: "socket-only",
			gardenId: probe.gardenId,
			liveness: probe.liveness,
			cwd: probe.cwd,
			model: probe.model,
			idle: probe.idle,
			infoError: probe.infoError,
		});
	}

	// Sort by gardenId with a plain `<` compare (not localeCompare) so both fact
	// surfaces and the socket scan share one locale-independent ordering.
	const byGardenId = (a: { gardenId: string }, b: { gardenId: string }): number =>
		a.gardenId < b.gardenId ? -1 : a.gardenId > b.gardenId ? 1 : 0;
	peers.sort(byGardenId);
	socketOnly.sort(byGardenId);
	return { peers, socketOnly };
}
