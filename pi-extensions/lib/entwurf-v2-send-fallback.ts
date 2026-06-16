/**
 * entwurf-v2-send-fallback — the 5c-2b same-lock re-resolve RESOLVER (the brain the
 * 5c-2a send hand calls as `deps.deadFallback` on a `dead` connect). The hand DECIDED
 * nothing about routing; this resolver re-runs the 5b dispatch logic ONCE — minus the
 * lock lifecycle — under the lock the hand still holds, and hands back a fresh plan to
 * EXECUTE or a reject. It NEVER releases the lock (that is the hand's single
 * responsibility) and NEVER calls decideDispatch whole (that would re-enter the
 * acquire/release lifecycle the hand already owns).
 *
 * Why a re-resolve and not just "dead ⇒ reject": the original control-socket plan came
 * from the 5b decider observing the target ALIVE; the send's `dead` connect is a TOCTOU
 * fact about ONE socketPath at send time, not the gid's latest dispatch state. So we
 * re-inspect + re-probe the canonical path under the held lock and let the SAME frozen
 * table decide again.
 *
 * The intent is pinned to `fire-and-forget` (design lock, GPT 5c-2b): a control-socket
 * send plan is ONLY ever produced by the `fire-and-forget + live` cell, so the re-resolve
 * must read the same row. That pin is also what makes "no resume promotion" structural,
 * not just a 5c-2a guard: the `fire-and-forget` row has NO resume cell —
 *   live          → send / control-socket   (the retry)
 *   dormant(dead) → reject (dormant-fire-forget-unsupported)  ← NOT resume/spawn-bg
 *   indeterminate → reject (indeterminate-no-spawn)
 * Only `owned-outcome + dormant` is resume/spawn-bg, and an owned-outcome dispatch never
 * yields a control-socket send plan in the first place. So a dead re-resolve can only
 * retry (alive), reject (dead/indeterminate pi), or — on an UNSUPPORTED backend, via the
 * separate mailbox mini-table — enqueue to a deliverable citizen. It can never spawn.
 *
 * The N2 asymmetry (frozen in entwurf-v2-contract): in-domain `dormant` is a CONFIRMED
 * not-running pi → reject (enqueuing would be a silent pileup; resume is the honest
 * place, and resume is out of a SEND fallback's scope). `unsupported` is UNKNOWN liveness
 * with no socket axis → the mailbox is its honest channel when deliverable.
 */

import type { MailboxDeliverabilityResult } from "./entwurf-deliverability.ts";
import { isLivenessSupported, resolveDispatch } from "./entwurf-v2-contract.ts";
import type { TargetResolution } from "./entwurf-v2-decider.ts";
import type { LockClaim } from "./entwurf-v2-lock.ts";
import type { ControlSocketPlan, DeadFallbackResolution } from "./entwurf-v2-send.ts";
import { defaultMetaMailboxDir, defaultMetaSessionsDir, type MetaIdentity } from "./meta-session.ts";
import { mapInspectionToLiveness, type TargetSocketInspection } from "./socket-discovery.ts";
import type { SocketLiveness } from "./socket-probe.ts";

/**
 * The resolver's IO seams — the SAME shapes the 5b decider uses, MINUS acquireLock /
 * releaseLock (the resolver runs under a lock it must not touch). Plan-planted dirs keep
 * defaults; mailboxDeliverabilityFor is REQUIRED (SE-2 2d-3 — the same seam the decider
 * takes, no wake-mode-only fallback), as are the IO seams (resolveTarget / inspectSocket /
 * probeSocket), so the gate drives every branch without a filesystem.
 */
export interface DeadFallbackDeps {
	resolveTarget: (gardenId: string) => TargetResolution | Promise<TargetResolution>;
	inspectSocket: (gardenId: string) => Promise<TargetSocketInspection>;
	probeSocket: (socketPath: string) => Promise<SocketLiveness>;
	/** SE-2 slice 2d-3: the SAME required mailbox-deliverability seam the 5b decider takes
	 * (wake-mode capability AND a live active-receiver marker matching the identity). Required
	 * (no default) so the dead-control re-resolve can never fall back to wake-mode-only and
	 * re-open the SE-2 gap on its own path. Production injects the SAME closure into both. */
	mailboxDeliverabilityFor: (
		identity: MetaIdentity,
	) => MailboxDeliverabilityResult | Promise<MailboxDeliverabilityResult>;
	mailboxDir?: string;
	sessionsDir?: string;
}

/**
 * Re-resolve a dead control-socket send ONCE under the held lock. Returns a plan to
 * execute (control-socket retry on a re-observed-alive target, or a meta-mailbox enqueue
 * on a deliverable unsupported citizen) or a reject (dead/indeterminate pi, undeliverable
 * citizen, bad target, address conflict). The returned plan ALWAYS targets the same gid
 * the lock is held for. Inspect/probe throws are left to PROPAGATE — the 5c-2a hand's
 * lock-leak backstop converts them to failed+release; this resolver never releases.
 */
export async function resolveDeadControlSendFallback(
	plan: ControlSocketPlan,
	lock: LockClaim,
	deps: DeadFallbackDeps,
): Promise<DeadFallbackResolution> {
	// Mis-wire fail-loud, same grade as the 5c-2a hand: a plan/lock for different gids
	// would re-resolve B while holding A's lock. (The hand also asserts this on the
	// returned plan; asserting on the INPUT here fails even earlier, before any IO.)
	if (plan.targetGardenId !== lock.gardenId) {
		throw new Error(
			`entwurf-v2-send-fallback: plan target (${plan.targetGardenId}) does not match held lock (${lock.gardenId}) — mis-paired.`,
		);
	}
	const gardenId = plan.targetGardenId;
	const mailboxDir = deps.mailboxDir ?? defaultMetaMailboxDir();
	const sessionsDir = deps.sessionsDir ?? defaultMetaSessionsDir();

	// Probe-free target resolution first — a vanished target or a quarantined address
	// short-circuits before any inspect/probe (mirrors decideDispatch steps 2). A1 narrow:
	// a record-LESS but live pi control socket (socketOnlyPi, identity null) is NOT a
	// bad-target — it is an in-domain pi endpoint that re-resolves through the inspect/probe
	// path below (fire-and-forget: alive → retry control-send, dead → honest reject). Only a
	// genuinely absent target (identity null AND not socket-only) is bad-target.
	const resolution = await deps.resolveTarget(gardenId);
	if (resolution.identity === null && resolution.socketOnlyPi !== true) {
		return { kind: "reject", reason: "bad-target" };
	}
	if (resolution.preProbeAddressConflict) {
		return { kind: "reject", reason: "target-address-conflict" };
	}
	const identity = resolution.identity;

	// Unsupported backend (claude-code self-fetch, …) → the mailbox mini-table, keyed on
	// intent alone. This is NOT an in-domain dormant (the N2 asymmetry) — a deliverable
	// citizen's honest channel is its mailbox. No inspect/probe on this axis. A socket-only
	// pi endpoint (identity null) is in-domain pi, so it NEVER takes this branch — only a
	// record-backed unsupported identity does.
	if (identity !== null && !isLivenessSupported(identity.backend)) {
		const deliverability = await deps.mailboxDeliverabilityFor(identity);
		const receipt = resolveDispatch("fire-and-forget", "unsupported", deliverability.deliverable);
		if (!receipt.ok) {
			return { kind: "reject", reason: receipt.reason };
		}
		// The only allow cell here is fire-and-forget → meta-mailbox send. Preserve the
		// original message/wantsReply; mode is meaningless for the mailbox (not carried).
		return {
			kind: "execute",
			plan: {
				transport: "meta-mailbox",
				action: "send",
				targetGardenId: gardenId,
				mailboxDir,
				sessionsDir,
				wantsReply: plan.wantsReply,
				message: plan.message,
			},
		};
	}

	// In-domain (pi-like) → inspect + probe the canonical path UNDER the held lock. A
	// re-observed `dead`/`indeterminate` is an honest reject (never forced to one or the
	// other); `address-conflict` is a reject too (a symlink planted since dispatch).
	const inspection = await deps.inspectSocket(gardenId);
	const mapped = await mapInspectionToLiveness(inspection, deps.probeSocket);
	if ("addressConflict" in mapped) {
		return { kind: "reject", reason: "target-address-conflict" };
	}
	const { liveness, socketPath } = mapped;

	const receipt = resolveDispatch("fire-and-forget", liveness, false);
	if (!receipt.ok) {
		return { kind: "reject", reason: receipt.reason };
	}
	// fire-and-forget + live is the ONLY in-domain allow cell → control-socket send. A
	// resume/spawn-bg or meta-mailbox transport here would be a frozen-table drift, so
	// fail loud rather than mis-route a SEND fallback into a child spawn.
	if (receipt.transport !== "control-socket") {
		throw new Error(
			`entwurf-v2-send-fallback: in-domain fire-and-forget re-resolve yielded unexpected transport (${receipt.transport}) — table drift.`,
		);
	}
	return {
		kind: "execute",
		plan: {
			transport: "control-socket",
			action: "send",
			targetGardenId: gardenId,
			socketPath,
			mode: plan.mode,
			wantsReply: plan.wantsReply,
			message: plan.message,
		},
	};
}
