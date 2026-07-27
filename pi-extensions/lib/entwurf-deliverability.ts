/**
 * entwurf-deliverability — the PURE conversational-mailbox deliverability predicate
 * (SE-1/SE-2 slice 2c). "If I enqueue a conversational reply to this target's mailbox
 * right now, will a model actually see it — or will it rot as garbage?"
 *
 * Three predicates, all pure (facts injected, no IO) — but on TWO different delivery
 * axes that must never be collapsed into one (보정①):
 *
 *  - computeMetaReceiverActive(facts): the shared "is this receiver active?" atom —
 *    recordBacked AND ownerAlive AND watchArmed. This is the SAME conjunction the
 *    self-addressability predicate uses for its meta branch; both import it so the
 *    "active receiver" definition has ONE source of truth (concept shared, API split).
 *    `watchArmed` is the MAILBOX-ONLY "idle-wake watch armed" signal (meta-session
 *    receiver marker) — it belongs to the mailbox axis and nothing else.
 *
 *  - mailboxConversationalDeliverable(facts): the enqueue gate. A mailbox enqueue +
 *    doorbell only delivers for a SELF-FETCH backend (Claude Code): the receiver
 *    drains its own inbox on wake. A DIRECT-INJECT backend (pi / codex / antigravity)
 *    has no mailbox drain at all — enqueuing for it is the SE-1 false success
 *    ("✓ delivered" into a void). So deliverable = wakeMode === "self-fetch" AND the
 *    receiver is active. Every enqueue site must pass this guard before writing a .msg
 *    (slice 2d). The shipped sites are the v2 decider and its send-fallback re-resolve;
 *    the v1 fallback / MCP v1 / pi-native v1 sites this once also listed were removed in
 *    the 0.12 cutover — do not read them as live.
 *
 *  - nativePushDeliverable(facts): the SEPARATE deliverability predicate for a
 *    NATIVE-PUSH backend (antigravity). A native-push citizen has no mailbox and no
 *    idle-wake watch — delivery is a direct injection into a LIVE app-server
 *    conversation the adapter probe located. So deliverable = recordBacked AND
 *    probeAlive. It MUST NOT reuse computeMetaReceiverActive: that atom folds in
 *    `watchArmed`, so composing it here would smuggle a mailbox liveness fact into a
 *    domain that has no mailbox (보정① — native-push replyable ≠ mailbox receiver).
 *    The two axes are pinned apart in code so a future replyable-sender path cannot
 *    quietly collapse them.
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

/**
 * The identity axes a receiver presence marker must agree on to count as THIS target's
 * live receiver (SE-2 slice 2d-3). A structural shape — both `MetaReceiverMarker` and
 * `MetaIdentity` carry these fields, so callers pass either without importing the
 * meta-session types here (keeps this module pure and dependency-light). `backend` is
 * compared as a string (equality only); the enum is validated by the meta-session reader.
 */
export interface ReceiverIdentityFacts {
	gardenId: string;
	backend: string;
	nativeSessionId: string;
}

/**
 * Does this presence marker actually belong to the target identity? A marker that is
 * absent, or whose garden id / backend / native session id has drifted from the record,
 * is NOT this receiver — fail-closed (a stale/foreign marker must never raise a dead
 * target to "active"). The single source of truth for "marker ↔ identity match". Its
 * PRODUCTION consumers are the v2 `mailboxDeliverabilityFor` seam and the MCP bridge's
 * `entwurf_self`. There is no second implementation: `entwurf-mailbox-guard.ts` used to
 * wrap this atom with its own enqueue orchestration, had ZERO production importers (import
 * graph measured 2026-07-27), and was DELETED rather than left as a green gate proving only
 * retired behaviour. A new enqueue site consults this predicate through that seam.
 */
export function receiverMarkerMatchesIdentity(
	marker: ReceiverIdentityFacts | null | undefined,
	identity: ReceiverIdentityFacts,
): boolean {
	return (
		!!marker &&
		marker.gardenId === identity.gardenId &&
		marker.backend === identity.backend &&
		marker.nativeSessionId === identity.nativeSessionId
	);
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
 * self-fetch AND the receiver is active. A direct-inject backend (pi / codex /
 * antigravity) is refused outright — it has no mailbox drain, so an enqueue would be a
 * silent false success. A native-push backend's live delivery goes through
 * nativePushDeliverable, not this gate.
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

// ── native-push deliverability (봉인 6) ──────────────────────────────────────
// A DISTINCT axis from the mailbox one above. Native-push (antigravity) has no
// mailbox and no idle-wake watch: delivery is a direct injection into a live
// app-server conversation the adapter probe found. Kept in this file so the two
// deliverability predicates sit side by side and their axis separation is visible,
// but sharing NOTHING with computeMetaReceiverActive (which requires watchArmed).

export interface NativePushDeliverabilityFacts {
	/** The target garden id is backed by a live meta-record (identity exists). */
	recordBacked?: boolean;
	/** An adapter probe found the target's live native conversation (route resolved). */
	probeAlive?: boolean;
}

export interface NativePushDeliverabilityResult {
	deliverable: boolean;
	reason: string;
}

/**
 * The native-push deliverability predicate (봉인 6). deliverable ⟺ recordBacked ∧
 * probeAlive. This DELIBERATELY does NOT reuse computeMetaReceiverActive — that atom
 * requires `watchArmed`, the mailbox-only "idle-wake watch armed" signal, which is
 * meaningless for a backend with no mailbox (보정①). Fail-closed: an undefined fact
 * is treated as false, never optimistic; each failure names its own cause so a
 * record-less target is never conflated with a probe that found no live conversation.
 */
export function nativePushDeliverable(facts: NativePushDeliverabilityFacts): NativePushDeliverabilityResult {
	if (facts.recordBacked !== true) {
		return { deliverable: false, reason: "no backing meta-record" };
	}
	if (facts.probeAlive !== true) {
		return { deliverable: false, reason: "adapter probe found no live native conversation" };
	}
	return { deliverable: true, reason: "record backed, native conversation probed alive" };
}
