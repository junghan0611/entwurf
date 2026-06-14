/**
 * entwurf-mailbox-guard — the IO orchestration that gates a conversational mailbox
 * enqueue on the (pure) deliverability predicate (SE-1/SE-2 slice 2d). Kept SEPARATE
 * from entwurf-deliverability.ts so the predicate stays pure (gate-pinnable) and only
 * this thin wrapper touches the record store / capability registry / presence marker.
 *
 * The contract every conversational-reply enqueue site (MCP entwurf_send fallback,
 * pi-native entwurf_send fallback) must use INSTEAD of calling enqueueMetaMessage
 * directly:
 *   1. gather facts for the target garden id (record? wakeMode? receiver active?),
 *   2. ask mailboxConversationalDeliverable,
 *   3. enqueue ONLY when deliverable; otherwise return a typed non-delivery with a
 *      reason — no .msg written, no doorbell poked.
 *
 * This is the SE-2 "no garbage in a dead/absent receiver's mailbox" guard and the
 * SE-1 "never enqueue for a backend with no mailbox drain (pi)" guard, in one place.
 * The low-level enqueueMetaMessage stays a raw primitive — it has no in-band reject;
 * the refusal happens HERE, before transport, not inside it.
 */

import { type MailboxDeliverabilityFacts, mailboxConversationalDeliverable } from "./entwurf-deliverability.ts";
import {
	type MetaBackendV2,
	type MetaCapability,
	type MetaIdentity,
	type MetaReceiverMarker,
	metaCapabilityFor,
	readMetaIdentityByGardenId,
	readMetaReceiverMarker,
} from "./meta-session.ts";

export interface MailboxGuardDeps {
	/** Read the target's identity (throws when there is no backing record). */
	readIdentity?: (gardenId: string) => MetaIdentity;
	/** Read the target's receiver presence marker (null = no live, armed receiver). */
	readReceiverMarker?: (gardenId: string) => MetaReceiverMarker | null;
	/** Resolve a backend's capability (wake mode). */
	capabilityFor?: (backend: MetaBackendV2) => MetaCapability;
}

/**
 * Gather the deliverability facts for a target garden id, all via injected (or
 * production-default) readers. recordBacked/wakeMode come from the record + capability
 * registry; ownerAlive and watchArmed both derive from the receiver presence marker —
 * at runtime they move together (a verified marker means a live owner that reached the
 * watch-arm path; its absence/dead-owner means neither), but the pure predicate keeps
 * the axes separate so each cause stays nameable.
 */
export function gatherMailboxDeliverabilityFacts(
	gardenId: string,
	deps: MailboxGuardDeps = {},
): MailboxDeliverabilityFacts {
	const readIdentity = deps.readIdentity ?? ((g: string) => readMetaIdentityByGardenId(g));
	const readReceiverMarker = deps.readReceiverMarker ?? ((g: string) => readMetaReceiverMarker({ gardenId: g }));
	const capabilityFor = deps.capabilityFor ?? metaCapabilityFor;

	let recordBacked = false;
	let wakeMode: string | undefined;
	try {
		const identity = readIdentity(gardenId);
		recordBacked = true;
		wakeMode = capabilityFor(identity.backend).wakeMode;
	} catch {
		recordBacked = false;
	}

	const marker = readReceiverMarker(gardenId);
	const receiverPresent = marker !== null;
	return { wakeMode, recordBacked, ownerAlive: receiverPresent, watchArmed: receiverPresent };
}

export type GuardedMailboxOutcome<T> = { delivered: true; result: T } | { delivered: false; reason: string };

/**
 * Enqueue a conversational reply to the target's mailbox ONLY when it is deliverable.
 * When not, returns `{ delivered: false, reason }` and the injected `enqueue` is never
 * called — the SE-2 guarantee that a refused send mutates nothing.
 */
export function guardedMailboxEnqueue<T>(
	gardenId: string,
	deps: MailboxGuardDeps,
	enqueue: () => T,
): GuardedMailboxOutcome<T> {
	const facts = gatherMailboxDeliverabilityFacts(gardenId, deps);
	const verdict = mailboxConversationalDeliverable(facts);
	if (!verdict.deliverable) return { delivered: false, reason: verdict.reason };
	return { delivered: true, result: enqueue() };
}
