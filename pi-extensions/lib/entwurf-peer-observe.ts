/**
 * entwurf-peer-observe — the IO half of the two OBSERVED peer facts (#101).
 *
 * `entwurf_peers` used to answer a claude-code citizen with `liveness=unsupported` and
 * nothing else, because the control-socket probe genuinely does not apply to a self-fetch
 * backend. Two same-cwd rows — one a live conversation, one an abandoned startup session
 * whose transcript was never written — were therefore byte-identical in the listing, and
 * a caller picking "the newest record in this cwd" (the natural heuristic, and the one the
 * surface encourages) picked the phantom as often as the real one. Both halves of the
 * distinction were already on disk; nothing read them.
 *
 * FACTS, NOT VERBS. `receiver` and `transcript` say what was found, never what to do
 * about it: no `sendable`, no `deliverable`, no transport. The listing stays a listing —
 * dispatch still computes routing at call time from the same underlying markers.
 *
 * ONE MEASUREMENT, TWO WORDS. `receiver` is derived from the SAME
 * `resolveMailboxReceiverFacts` composition the v2 dispatch seam and `entwurf_self` use.
 * The surfaces are allowed to phrase it differently — a listing wants an enum, a reject
 * wants a sentence — but they may not disagree, so the enum is a projection of that atom
 * rather than a second opinion about the same markers.
 */

import * as fs from "node:fs";
import { resolveMailboxReceiverFacts } from "./entwurf-deliverability.ts";
import type { PeerObservations, ReceiverObservation, TranscriptObservation } from "./entwurf-facts.ts";
import {
	type MetaBackend,
	type MetaIdentity,
	metaCapabilityFor,
	metaReceiverMarkerPath,
	readMetaReceiverMarker,
	readMetaSenderMarker,
	requireBackend,
} from "./meta-session.ts";

/**
 * The mailbox receiver axis for one citizen.
 *
 * `n/a` is not a failure: a backend with no mailbox (pi's control socket, antigravity's
 * native push) has no receiver marker to be right or wrong about, and printing `none`
 * there would invent a missing thing. The `inactive` / `none` split is what a reader
 * needs to tell "a watch was armed and is no longer valid" from "no watch was ever
 * armed here", so it is taken from the marker FILE's existence rather than from the
 * reader's null — the reader folds absent, corrupt and dead-owner into one null.
 */
function observeReceiver(identity: MetaIdentity): ReceiverObservation {
	if (metaCapabilityFor(identity.backend).wakeMode !== "self-fetch") return "n/a";
	const facts = resolveMailboxReceiverFacts(identity, {
		readReceiverMarker: (gardenId: string) => readMetaReceiverMarker({ gardenId }),
		readSenderMarker: (backend: string, ownerPid: number) =>
			readMetaSenderMarker({ backend: requireBackend(backend) as MetaBackend, ownerPid }),
	});
	if (facts.ownerAlive && facts.watchArmed) return "active";
	return fs.existsSync(metaReceiverMarkerPath(identity.gardenId)) ? "inactive" : "none";
}

/**
 * Does the recorded transcript exist? A record is minted at SessionStart, but a harness
 * that writes its transcript lazily (Claude Code writes on the first turn) leaves a
 * citizen with no conversation behind it until someone actually says something. The PATH
 * stays private — only its existence crosses to the listing.
 */
function observeTranscript(identity: MetaIdentity): TranscriptObservation {
	try {
		// A record with no recorded transcript path has nothing to stat — that is the same
		// observable state as a path that is not there, and neither is an `exists` claim.
		return identity.transcriptPath && fs.existsSync(identity.transcriptPath) ? "exists" : "absent";
	} catch {
		// A transcript we cannot stat is not a transcript we can claim exists.
		return "absent";
	}
}

/** The production observer: both axes, measured for one citizen. */
export function observePeerFacts(identity: MetaIdentity): PeerObservations {
	return { receiver: observeReceiver(identity), transcript: observeTranscript(identity) };
}
