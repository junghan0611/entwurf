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
 * THE PLACEMENT AXIS IS MEASURED ONCE, NOT PER CITIZEN (#116 S1). `receiver` and
 * `transcript` are per-citizen filesystem questions; placement is one question asked of
 * one placement owner about every pane it has. So the herdr read happens ABOVE this
 * module (the provider does it once) and arrives here as an already-built index. That
 * is also the anti-watcher shape: one read per listing, no retry, no wait for a pane
 * whose session reference has not landed yet.
 *
 * ONE MEASUREMENT, TWO WORDS. `receiver` is derived from the SAME
 * `resolveMailboxReceiverFacts` composition the v2 dispatch seam and `entwurf_self` use.
 * The surfaces are allowed to phrase it differently — a listing wants an enum, a reject
 * wants a sentence — but they may not disagree, so the enum is a projection of that atom
 * rather than a second opinion about the same markers.
 */

import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import { resolveMailboxReceiverFacts } from "./entwurf-deliverability.ts";
import type { PeerObservations, ReceiverObservation, TranscriptObservation } from "./entwurf-facts.ts";
import {
	buildPlacementIndex,
	type HerdrPlacementIndex,
	parseHerdrPaneList,
	resolvePlacement,
} from "./herdr-placement.ts";
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

/** How long the one placement read may take before we stop waiting for it. A listing
 * must not hang on a placement owner: the column is a convenience and `unobserved` is
 * a complete answer. */
const HERDR_READ_TIMEOUT_MS = 2000;

/**
 * Read the placement owner ONCE, or decline to.
 *
 * TWO ENV FACTS DECIDE, AND BOTH ARE HERDR'S OWN (measured, herdr 0.9.0). `HERDR_ENV=1`
 * is how herdr tells a process it is running inside herdr, and `HERDR_BIN_PATH` is the
 * invocation path herdr's own plugin contract tells callers to use. Neither is
 * discovered: if herdr did not put them in this process's environment we are not inside
 * herdr and we make no claim. There is no path guess, no socket scan, and no PATH
 * lookup — this must stay as explicit as Hard Rule 6 wants configuration to be.
 *
 * EVERY FAILURE IS `null`, NEVER AN EMPTY INDEX. A missing binary, a timeout, a nonzero
 * exit or a payload we cannot parse all mean nobody measured. An empty index would say
 * something much stronger — "herdr was read and has none of your citizens" — about a
 * read that did not happen.
 */
export function readHerdrPlacementIndex(env: NodeJS.ProcessEnv = process.env): HerdrPlacementIndex | null {
	if (env.HERDR_ENV !== "1") return null;
	const bin = env.HERDR_BIN_PATH;
	if (typeof bin !== "string" || bin.length === 0) return null;
	let stdout: string;
	try {
		stdout = execFileSync(bin, ["pane", "list"], {
			encoding: "utf8",
			timeout: HERDR_READ_TIMEOUT_MS,
			stdio: ["ignore", "pipe", "ignore"],
		});
	} catch {
		// Bounded environment probe: a placement owner that did not answer is a citizen
		// column that reads `unobserved`, not a listing that fails.
		return null;
	}
	const rows = parseHerdrPaneList(stdout);
	return rows === null ? null : buildPlacementIndex(rows);
}

/**
 * Build the production observer over an already-resolved placement index.
 *
 * `null` means no placement owner was read on this host — every citizen then reads
 * `unobserved`, which is the only honest answer when nobody looked. It is NOT `none`:
 * that word is reserved for a herdr that WAS read and does not have this citizen.
 */
export function makeObservePeerFacts(placementIndex: HerdrPlacementIndex | null) {
	return (identity: MetaIdentity): PeerObservations => ({
		receiver: observeReceiver(identity),
		transcript: observeTranscript(identity),
		placement: resolvePlacement(placementIndex, identity),
	});
}

/** The production observer with no placement owner read — the shape every caller that
 * has not resolved an index gets, and the default on a host with no herdr. */
export function observePeerFacts(identity: MetaIdentity): PeerObservations {
	return makeObservePeerFacts(null)(identity);
}
