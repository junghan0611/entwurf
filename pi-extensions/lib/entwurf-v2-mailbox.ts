/**
 * entwurf-v2-mailbox — the 5c-4 meta-mailbox SEND body (0.11 Stage 0 step 5c-4, the
 * LAST 5c transport slice). It is ENQUEUE-ONLY: render the mailbox body from the plan
 * the 5b decider ALREADY chose and drop it in the target citizen's meta-bridge mailbox.
 * It DECIDES NO ROUTING (the dispatch table did) and carries NO release seam — a
 * meta-mailbox plan is the lock-free path (？7), and even when the 5c-2a send hand calls
 * this on a re-resolved mailbox fallback (under a still-held control-socket lock),
 * RELEASE STAYS THE HAND'S SINGLE RESPONSIBILITY. So this module has no `releaseLock`
 * dep AT ALL — a lock leak from the mailbox body is structurally impossible.
 *
 * Two consumers, one body:
 *   - the 5c-2a send hand's `deps.sendViaMailbox(plan, lock)` fallback seam
 *     (entwurf-v2-send.ts) — a dead control socket re-resolved into a mailbox plan.
 *   - the 5d dispatch runner's direct unsupported-citizen fire-and-forget path
 *     (the decider hands back a meta-mailbox plan with a NULL lock) — landed, and
 *     wired in the production runner (entwurf-v2-production.ts).
 * Both call `executeMetaMailboxSend`; the hand reaches it through the async
 * `sendViaMailbox(plan, lock)` adapter the production factory builds.
 *
 * A mailbox has NO in-band refuse — there is no live receiver to answer `success:false`.
 * An enqueue either succeeds (`{success:true}`) or THROWS (citizen gone / fs / identity).
 * The body NEVER folds a throw into `{success:false}`: the send hand maps a thrown error
 * to `failed`+rethrow, which is the honest outcome for a non-delivery. `success:false` is
 * a control-socket RPC notion (the receiver answered and refused) and would be a lie here.
 *
 * ctx-free, dep-injected (the same discipline the other entwurf-v2-* libs keep): the live
 * sender envelope is built at the wiring site and passed in, so this module never imports
 * ExtensionContext.
 */

import type { LockClaim } from "./entwurf-v2-lock.ts";
import type { MetaMailboxPlan, RpcSendResult } from "./entwurf-v2-send.ts";
import { formatMetaMailboxBody, type MailboxSenderEnvelope } from "./meta-mailbox-body.ts";
import { type EnqueueMetaMessageOptions, type EnqueueMetaMessageResult, enqueueMetaMessage } from "./meta-session.ts";

/**
 * The ONLY IO seam: enqueue a rendered body into a citizen's mailbox. Injected so the
 * gate proves the enqueue ARGUMENTS plus the no-routing / no-release shape without
 * touching the filesystem. There is deliberately NO release seam and NO routing seam
 * (no inspect / probe / resolve) — the plan is final.
 */
export interface MetaMailboxSendDeps {
	enqueue: (opts: EnqueueMetaMessageOptions) => EnqueueMetaMessageResult;
}

/**
 * Render the plan into a mailbox body and enqueue it ONCE. `sender` is the resolved
 * envelope (built from live ctx at the wiring site — ctx kept OUT of this module); when
 * it is undefined the raw `plan.message` is enqueued (the same envelope-less fallback the
 * legacy mailbox path used). `plan.wantsReply` is threaded into the body — v2 carries the
 * caller's intent, a DELIBERATE divergence from the legacy hard-coded `false`. An enqueue
 * throw PROPAGATES; it is never converted to `{success:false}`.
 */
export function executeMetaMailboxSend(
	plan: MetaMailboxPlan,
	sender: MailboxSenderEnvelope | undefined,
	deps: MetaMailboxSendDeps,
): RpcSendResult {
	const body = sender ? formatMetaMailboxBody(sender, plan.message, plan.wantsReply) : plan.message;
	deps.enqueue({
		gardenId: plan.targetGardenId,
		body,
		sessionsDir: plan.sessionsDir,
		mailboxDir: plan.mailboxDir,
	});
	return { success: true };
}

/**
 * Build the production `sendViaMailbox(plan, lock)` adapter the 5c-2a send hand consumes.
 * It IGNORES `lock` entirely (release is the hand's job; a mailbox plan is lock-free) and
 * wraps the sync body in the async dep signature. `senderProvider` is supplied by the
 * wiring site — it calls the private `buildLocalSenderEnvelope(ctx)` and decorates
 * origin/replyable — so this module never imports ExtensionContext. `enqueue` defaults to
 * the real `enqueueMetaMessage`; the gate injects a fake.
 */
export function makeProductionSendViaMailbox(opts: {
	senderProvider: () => MailboxSenderEnvelope | undefined;
	enqueue?: (opts: EnqueueMetaMessageOptions) => EnqueueMetaMessageResult;
}): (plan: MetaMailboxPlan, lock: LockClaim) => Promise<RpcSendResult> {
	const enqueue = opts.enqueue ?? enqueueMetaMessage;
	// `_lock` is named in the signature for the send-hand dep contract but is NEVER read:
	// a mailbox enqueue does not own or release the lock. `async` so a synchronous enqueue
	// throw surfaces as a REJECTED promise (the async dep contract), not a sync throw — the
	// send hand's `await` + try/catch handles either, but a rejection is the honest shape.
	return async (plan: MetaMailboxPlan, _lock: LockClaim): Promise<RpcSendResult> =>
		executeMetaMailboxSend(plan, opts.senderProvider(), { enqueue });
}
