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

// ── the watch-owner ↔ sender-marker join (#101 결함 B) ──────────────────────
// A receiver marker proves "a LIVE process once armed a watch for this garden".
// It does NOT prove "that process is serving this garden RIGHT NOW". One native
// process can hold markers for several gardens and drain exactly one of them:
// Claude Code's session switch (the TUI resume picker and `/clear`) fires a second
// SessionStart inside the SAME pid under a NEW native session id, so the first
// garden's marker keeps naming a live owner forever while the doorbell it advertises
// is gone. Measured on oracle 2026-09-04 (#101): one pid held both markers, a
// 09:33 enqueue to the retired garden sat unread as a bare `.msg` for ≥50 minutes —
// the "enqueue into a void" this module's header exists to refuse.
//
// The join that decides it is already on disk: the SENDER marker is keyed by owner
// pid and rewritten with the CURRENT garden on every arm/prompt, so
// `meta-senders/<backend>/<ownerPid>.json.gardenId` is the answer to "which garden
// does this process serve now?". A receiver marker naming a different garden than
// its own owner's sender marker is a retired watch.
//
// SCOPE IS NOT UNIVERSAL, AND THE MARKER SAYS SO. The join only exists where the
// watch owner IS the process the sender marker is keyed to. That is true for the
// Claude hook (one `ownerPid` variable writes both markers —
// `meta-bridge-hook.ts` sender + receiver arm) and false BY CONSTRUCTION for
// Copilot, whose watch lives in a forked first-party extension child
// (`extension.mjs` writes `ownerPid: process.pid`) while its sender marker is keyed
// to the CLI parent (`meta-bridge-hook-copilot.ts` uses `process.ppid`). Applying
// the join there would make every Copilot citizen permanently undeliverable — a
// regression on a shipped lane, not a fix. `ownerKind` is recorded on the marker for
// exactly this reason ("the marker records which, because the pid a reader verifies
// differs" — AGENTS.md, self-fetch domain), so it is the axis, not `backend`.
//
// `omp-host` is a CANDIDATE, deliberately not admitted here: OMP already retires the
// previous garden in-process on its `/new` edge (the unarm the claude hook lacked),
// so the cell this join closes has a different owner there. Admitting it needs its
// own measurement, not this file's optimism.
export const SENDER_JOINED_RECEIVER_OWNER_KINDS: readonly string[] = ["claude-code-cli"];

/** Does this watch owner share its pid with the backend's sender marker? */
export function receiverOwnerKindJoinsSender(ownerKind: string): boolean {
	return SENDER_JOINED_RECEIVER_OWNER_KINDS.includes(ownerKind);
}

/** The receiver-marker fields the join reads (a structural shape, like ReceiverIdentityFacts). */
export interface ReceiverOwnerFacts extends ReceiverIdentityFacts {
	ownerPid: number;
	ownerKind: string;
}

/** The sender-marker fields the join reads: which garden this owner pid serves NOW. */
export interface SenderOwnerFacts {
	gardenId: string;
	backend: string;
}

/**
 * Is the watch owner still serving THIS garden? Fail-closed inside the join's scope:
 * an absent/unreadable sender marker, or one naming another garden or backend, means
 * the watch is retired. Outside the scope (an ownerKind whose watch owner is not the
 * sender-marker process) the join does not apply and the marker's own live-owner guard
 * is the whole rule — returning true here is NOT optimism, it is "this axis says
 * nothing", and the caller has already required the marker to match the identity.
 */
export function receiverOwnerServesGarden(
	marker: ReceiverOwnerFacts,
	senderMarker: SenderOwnerFacts | null | undefined,
): boolean {
	if (!receiverOwnerKindJoinsSender(marker.ownerKind)) return true;
	return !!senderMarker && senderMarker.gardenId === marker.gardenId && senderMarker.backend === marker.backend;
}

/** The two marker readers the mailbox receiver facts are composed from (injected — this module does no IO). */
export interface MailboxReceiverReaders {
	/** Read the receiver presence marker for a garden id (null = absent/corrupt/dead owner). */
	readReceiverMarker: (gardenId: string) => ReceiverOwnerFacts | null;
	/** Read the sender marker for an owner pid (null = absent/corrupt/dead owner). */
	readSenderMarker: (backend: string, ownerPid: number) => SenderOwnerFacts | null;
}

/**
 * THE single composition of the two mailbox receiver facts, over injected readers.
 * Both production consumers — the v2 `mailboxDeliverabilityFor` seam and the MCP
 * bridge's `entwurf_self` — call THIS, so a direct send, a re-resolved fallback send
 * and a citizen's own replyability can never drift to different verdicts.
 *
 *   ownerAlive  — a live-owner marker that names THIS identity (the reader already ran
 *                 the plausibility + start-key guards; this adds the identity match).
 *   watchArmed  — that owner is still serving this garden (the join above). It is a
 *                 MEASUREMENT, never a copy of ownerAlive: copying it is what let a
 *                 retired watch read as an armed doorbell (#101 결함 B).
 *
 * `recordBacked` is NOT decided here — it stays the caller's explicit fact, so an
 * absent record and a dead owner stay distinguishable in the reason string.
 */
export function resolveMailboxReceiverFacts(
	identity: ReceiverIdentityFacts,
	readers: MailboxReceiverReaders,
): { ownerAlive: boolean; watchArmed: boolean } {
	const marker = readers.readReceiverMarker(identity.gardenId);
	const ownerAlive = receiverMarkerMatchesIdentity(marker, identity);
	if (!ownerAlive || !marker) return { ownerAlive: false, watchArmed: false };
	const senderMarker = receiverOwnerKindJoinsSender(marker.ownerKind)
		? readers.readSenderMarker(marker.backend, marker.ownerPid)
		: null;
	return { ownerAlive, watchArmed: receiverOwnerServesGarden(marker, senderMarker) };
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
