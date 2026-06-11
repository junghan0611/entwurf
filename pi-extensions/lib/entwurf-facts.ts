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

import { type FactLiveness, factLivenessOf } from "./entwurf-v2-contract.ts";
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
