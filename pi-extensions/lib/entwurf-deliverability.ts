/**
 * entwurf-deliverability — the PURE conversational-mailbox deliverability predicate
 * (SE-1/SE-2 slice 2c). "If I enqueue a conversational reply to this target's mailbox
 * right now, will a model actually see it — or will it rot as garbage?"
 *
 * Two layers, both pure (facts injected, no IO):
 *
 *  - computeMetaReceiverActive(facts): the shared "is this receiver active?" atom —
 *    recordBacked AND ownerAlive AND watchArmed. This is the SAME conjunction the
 *    self-addressability predicate uses for its meta branch; both import it so the
 *    "active receiver" definition has ONE source of truth (concept shared, API split).
 *
 *  - mailboxConversationalDeliverable(facts): the enqueue gate. A mailbox enqueue +
 *    doorbell only delivers for a SELF-FETCH backend (Claude Code / Codex / agy): the
 *    receiver drains its own inbox on wake. A DIRECT-INJECT backend (pi) has no
 *    mailbox drain at all — enqueuing for it is the SE-1 false success ("✓ delivered"
 *    into a void). So deliverable = wakeMode === "self-fetch" AND the receiver is
 *    active. This is the guard that the v1 fallback, MCP v1, pi-native v1, and the v2
 *    decider/send-fallback enqueue sites must all pass before writing a .msg (slice 2d).
 *
 * The contract is "mailboxConversationalDeliverable", NOT a broad "deliverable": it is
 * specifically about a conversational reply that needs a live doorbell wake, NOT about
 * an archival mailbox someone reads later. Naming it narrowly keeps a future archival
 * path from silently inheriting this gate.
 */

import type { WakeMode } from "./meta-session.ts";

export interface MetaReceiverActiveFacts {
	/** The receiver's garden id is backed by a live meta-record (identity exists). */
	recordBacked?: boolean;
	/** The receiver's watch owner pid is still the same live process (start-key match). */
	ownerAlive?: boolean;
	/** The receiver's idle-wake watch is armed (presence marker from an arm event). */
	watchArmed?: boolean;
}

export interface MetaReceiverActiveResult {
	active: boolean;
	reason: string;
}

/**
 * The shared active-receiver atom. Every axis is required (fail-closed: an undefined
 * fact is treated as false, never optimistic), and each failure names its own cause so
 * a terminated-owner is never conflated with a missing record or an unarmed watch.
 */
export function computeMetaReceiverActive(facts: MetaReceiverActiveFacts): MetaReceiverActiveResult {
	if (facts.recordBacked !== true) {
		return { active: false, reason: "no backing meta-record" };
	}
	if (facts.ownerAlive !== true) {
		return { active: false, reason: "owner not alive (start-key mismatch — session exited or pid reused)" };
	}
	if (facts.watchArmed !== true) {
		return { active: false, reason: "idle-watch not armed — a reply would enqueue with no doorbell wake" };
	}
	return { active: true, reason: "record backed, owner alive, watch armed" };
}

export interface MailboxDeliverabilityFacts extends MetaReceiverActiveFacts {
	/** The target backend's wake mode (from the capability registry). */
	wakeMode?: WakeMode | string;
}

export interface MailboxDeliverabilityResult {
	deliverable: boolean;
	reason: string;
}

/**
 * The conversational-mailbox enqueue gate. False (no enqueue) unless the backend is
 * self-fetch AND the receiver is active. A direct-inject backend (pi) is refused
 * outright — it has no mailbox drain, so an enqueue would be a silent false success.
 */
export function mailboxConversationalDeliverable(facts: MailboxDeliverabilityFacts): MailboxDeliverabilityResult {
	if (facts.wakeMode !== "self-fetch") {
		return {
			deliverable: false,
			reason: `backend wake mode ${facts.wakeMode ?? "(unset)"} is not self-fetch — a mailbox enqueue would never be drained`,
		};
	}
	const recv = computeMetaReceiverActive(facts);
	return {
		deliverable: recv.active,
		reason: recv.active
			? `self-fetch receiver active (${recv.reason})`
			: `self-fetch receiver inactive — ${recv.reason}`,
	};
}
