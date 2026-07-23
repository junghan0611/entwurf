/**
 * entwurf-fact-provider — the fact-provider's ASSEMBLY layer (0.11 Stage 0 step
 * 4, slice 4b). Composes the two axes into the listing the MCP `entwurf_peers`
 * surface (slice 4c) renders. Lives in its own module so nothing imports it back
 * (one-way: provider → facts / socket-discovery / meta-session) — no import cycle
 * with `entwurf-facts.ts` (which owns `SocketProbe`/`resolveFactList`).
 *
 *   listAllMetaIdentities → pi gid 추출 → scanSocketProbes(piGids)
 *     → pre-quarantine non-pi/socket conflicts → resolveFactList(clean)
 *     → { facts, diagnostics }
 *
 * Two throw-vs-diagnostics policies, kept distinct (GPT힣 C-원칙):
 *   - EXPECTED data corruption → diagnostics, listing survives. A meta-record
 *     parse failure (from listAllMetaIdentities) and a gardenId↔socket address
 *     collision are external-state problems; one must not blind `entwurf_peers`.
 *   - IMPOSSIBLE wiring invariant → throw, NOT swallowed. resolveFactList's
 *     duplicate-identity / unprobed-in-domain throws are assembly BUGS; catching
 *     them here would hide a code defect. We feed resolveFactList only CLEAN
 *     inputs (conflicts pre-removed), so its throw stays the last line of defense
 *     — that is not a re-implementation of the collision rule, it is input
 *     sanitation that leaves the pure-core invariant intact.
 *
 * The non-pi+socket collision quarantines BOTH sides (the PeerFact AND the
 * socket): gardenId is the universal address and a send path reads the socket
 * first, so surfacing the record alone (as a clean `unsupported` PeerFact) while
 * a same-gid socket exists would be half a lie. Both leave the normal output;
 * one diagnostic carries the fact. (pi + same-gid socket = the normal merge.)
 */

import { type FactList, isNonPiGardenIdSocketConflict, resolveFactList } from "./entwurf-facts.ts";
import { isLivenessSupported } from "./entwurf-v2-contract.ts";
import { listAllMetaIdentities, M1_MIGRATE_COMMAND, type MetaBackendV2 } from "./meta-session.ts";
import { type SocketScanDeps, scanSocketProbes } from "./socket-discovery.ts";
import type { SocketLiveness } from "./socket-probe.ts";

/** A listing-surface problem, surfaced explicitly rather than hidden or thrown.
 * Kind-tagged so the render layer shows provenance; each carries only verbatim
 * facts (never a half-parsed identity). `record-less-socket` (#50 C4) is the
 * demoted socket-only listing: a socket no record claims is a migration/
 * diagnostic state, not a citizen, and its message names the cause + fix. The
 * last three are socket-axis hazards folded from `scanSocketProbes` (slice 4c,
 * Fable 검수): a symlinked socket is a correlation-authority forgery attempt
 * (P1), a malformed `*.sock` name a visible drop (P3), a non-ENOENT dir-read
 * failure asymmetric loss of the socket axis (P2e②). */
export type EntwurfDiagnostic =
	| { kind: "meta-record-read-error"; filename: string; message: string }
	| { kind: "garden-id-socket-conflict"; gardenId: string; backend: MetaBackendV2; message: string }
	| { kind: "record-less-socket"; gardenId: string; liveness: SocketLiveness; message: string }
	| { kind: "socket-symlink-rejected"; gardenId: string; message: string }
	| { kind: "malformed-socket-name"; name: string; message: string }
	| { kind: "socket-dir-read-error"; message: string };

/** The #50 C4 demotion messages, one per probed liveness so the F8 aggregation
 * groups same-state sockets into one line. Each names the true cause (no record
 * claims the socket; the record is the sole address authority) and the fix. */
export function recordLessSocketMessage(liveness: SocketLiveness): string {
	switch (liveness) {
		case "alive":
			return (
				"a LIVE control socket no meta-record claims — not an addressable citizen (the record is the " +
				"sole address authority). Restart the pre-record-era resident under the current runtime so " +
				`session_start births its record, or migrate a pre-cut store with \`${M1_MIGRATE_COMMAND}\`.`
			);
		case "dead":
			return (
				"a stale control socket no meta-record claims — not addressable; a leftover from a hard-killed " +
				"or pre-record-era session (removing it is GC's job, not the listing's)."
			);
		case "indeterminate":
			return (
				"a control socket no meta-record claims and the probe was inconclusive — not addressable; " +
				"re-check once the host is responsive."
			);
	}
}

export interface EntwurfFactsResult {
	facts: FactList;
	diagnostics: EntwurfDiagnostic[];
}

export interface EntwurfFactsDeps {
	/** Meta-store axis: the `.meta.json` entry names + a record reader. */
	metaEntries: readonly string[];
	readRecord: (filename: string) => string;
	/** Socket axis: injected into scanSocketProbes (controlDir/readdir/probe). */
	socket?: Partial<SocketScanDeps>;
}

function diagnosticSortKey(d: EntwurfDiagnostic): string {
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
		case "socket-dir-read-error":
			return "5:";
	}
}

/**
 * Assemble the facts-only listing. Pure over its injected deps (no direct IO) so
 * the gate drives it without a filesystem; slice 4c supplies the real readdir /
 * readFile / probe. Live socket probes may carry get_info runtime enrich
 * (cwd/model/idle); null remains honest and renders as "not enriched".
 */
export async function listEntwurfFacts(deps: EntwurfFactsDeps): Promise<EntwurfFactsResult> {
	const diagnostics: EntwurfDiagnostic[] = [];

	// 1. meta-store axis — expected corruption becomes diagnostics, not a throw.
	const { identities, errors } = listAllMetaIdentities(deps.metaEntries, deps.readRecord);
	for (const e of errors) {
		diagnostics.push({ kind: "meta-record-read-error", filename: e.filename, message: e.message });
	}

	// 2. socket axis — probe (dir sockets) ∪ (in-domain citizen canonical paths).
	//    Its three hazards (symlink forgery / malformed name / dir-read error) are
	//    folded into diagnostics here so the listing survives but never lies.
	const piGids = identities.filter((i) => isLivenessSupported(i.backend)).map((i) => i.gardenId);
	const scan = await scanSocketProbes(piGids, deps.socket ?? {});
	const probes = scan.probes;
	const socketGids = new Set(probes.map((p) => p.gardenId));
	const symlinkedGids = new Set(scan.symlinkedGardenIds);
	for (const gardenId of scan.symlinkedGardenIds) {
		diagnostics.push({
			kind: "socket-symlink-rejected",
			gardenId,
			message:
				"control socket is a symlink — never probed (it could redirect to another session's listener and forge " +
				"an alive liveness for this gardenId); a citizen owning it is treated as dead (dormant), a record-less one dropped.",
		});
	}
	for (const name of scan.malformedNames) {
		diagnostics.push({
			kind: "malformed-socket-name",
			name,
			message: "control-socket filename is not a garden id — no citizen to correlate to; dropped from the listing.",
		});
	}
	if (scan.dirError !== null) {
		diagnostics.push({
			kind: "socket-dir-read-error",
			message: `control-socket directory unreadable (socket axis incomplete; meta-record citizens still listed): ${scan.dirError}`,
		});
	}

	// 3. pre-quarantine non-pi citizens that collide with a control socket. The
	//    predicate is SHARED with the v2 decider (isNonPiGardenIdSocketConflict) so
	//    listing and dispatch cannot drift, and it unions socketGids with the
	//    symlinkedGids: a symlinked socket is never probed (absent from socketGids),
	//    so the old socketGids-only check let a non-pi citizen with a forged
	//    (symlinked) socket survive as a clean PeerFact while the legacy send path
	//    still followed the symlink — the gap this closes.
	const conflictGids = new Set<string>();
	for (const id of identities) {
		if (isNonPiGardenIdSocketConflict(id.backend, id.gardenId, socketGids, symlinkedGids)) {
			conflictGids.add(id.gardenId);
			diagnostics.push({
				kind: "garden-id-socket-conflict",
				gardenId: id.gardenId,
				backend: id.backend,
				message:
					`non-pi citizen (${id.backend}) shares its gardenId with a control socket (real or symlinked) — address ` +
					"ambiguity; both the citizen and the socket are quarantined from the listing.",
			});
		}
	}

	// 4. resolveFactList over CLEAN inputs only. Its throws (duplicate identity /
	//    unprobed in-domain citizen) are impossible wiring invariants — left to
	//    fire as the last line of defense, never caught here.
	const cleanIdentities = identities.filter((i) => !conflictGids.has(i.gardenId));
	const cleanProbes = probes.filter((p) => !conflictGids.has(p.gardenId));
	const facts: FactList = resolveFactList(cleanIdentities, cleanProbes);

	// 5. #50 C4 demotion: a record-less socket is a diagnostic, not a listing
	//    section. One diagnostic per socket (subjects aggregate at render, F8);
	//    the message is liveness-keyed so same-state sockets group into one line.
	for (const s of facts.recordLessSockets) {
		diagnostics.push({
			kind: "record-less-socket",
			gardenId: s.gardenId,
			liveness: s.liveness,
			message: recordLessSocketMessage(s.liveness),
		});
	}

	diagnostics.sort((a, b) => {
		const ka = diagnosticSortKey(a);
		const kb = diagnosticSortKey(b);
		return ka < kb ? -1 : ka > kb ? 1 : 0;
	});
	return { facts, diagnostics };
}
