/**
 * control-steer — the whole control-socket `send` decision, after the envelope is validated
 * (#163 S7 design v2.1 §2.4). `entwurf-control.ts` only calls `deliverControlSend`; the guards and
 * their order live here, once.
 *
 * Unchanged from before for every message that is not a busy `steer` with an ACP seam present: the
 * compaction guard, then one `pi.sendMessage` (idle → direct trigger; busy → the asked queue), then
 * the queue boundary receipt, with no await in between.
 *
 * NEW: a busy `mode=steer` when the ACP steer seam is registered asks the seam to put the text
 * into the running backend turn. That is the one await on this path, so everything the sync path
 * relied on is re-read after it (the decision table, design §2.4):
 *
 *   effect                      adapter request / Pi queue   receipt                  record
 *   (no seam)                   0 / 1 on the current binding  sent | queued-*          —
 *   not-sent, prompt-required   0|1 / 1 if the same binding   sent | queued-* (idle    —
 *                               and the compaction guard      re-read now)
 *                               passes; binding changed →
 *                               0 + target-stale; guard
 *                               refuses → 0 + its reason
 *   injected                    1 / 0                         steer-in-turn            1 on the same binding (also
 *                                                                                      while compacting: the guard
 *                                                                                      forbids sendMessage, and a
 *                                                                                      plain entry is outside the
 *                                                                                      LLM projection); 0 and
 *                                                                                      `skipped-binding-changed`
 *                                                                                      after a binding change
 *   unknown                     1 / 0                         steer-unknown + reason   0
 *   injected, record throws     1 / 0                         steer-in-turn +          the failure, as a receipt
 *                                                             record `failed:<msg>`    diagnostic only
 *
 * At most one adapter attempt and never a retry; a steer-unknown may have been injected. Nothing is
 * ever queued or recorded for a binding other than the one captured before the await. `follow_up`
 * never consults the seam. A seam of the wrong shape is a configuration error, refused by name
 * with nothing queued.
 */

import type { AcpSteerEffect, AcpSteerSeamLookup } from "./acp-steer-seam.js";
import { type CompactionGuard, compactionSendReject } from "./compaction-send-guard.js";
import { type ObservedBoundary, sendReceiptBoundary } from "./control-send-receipt.js";

/** Receipt names (#163 S7 design §5), final since the R2 wrap-up. */
export const STEER_IN_TURN = "steer-in-turn" as const;
export const STEER_UNKNOWN = "steer-unknown" as const;

/** The plain custom entry that records a steer the running turn took (design §3). */
export const STEER_ENTRY_TYPE = "entwurf-steer-in-turn";

export interface ControlSendInput {
	/** The message text with the rendered sender block, exactly what would be queued. */
	content: string;
	/** The bare message, for the record. */
	message: string;
	sender?: unknown;
	wantsReply: boolean;
	mode: "steer" | "follow_up";
}

export interface ControlSendDeps<Binding extends { nativeSessionId: string }, Context> {
	isIdle(): boolean;
	hasAgentSignal(): boolean;
	compaction: CompactionGuard;
	/** The current binding object; its identity is the binding generation. */
	binding(): Binding | null;
	/** The current extension context object (identity compared). */
	context(): Context | null;
	/** closing or retire requested. */
	closing(): boolean;
	/** The current session manager's native id. */
	sessionId(): string;
	lookupSeam(): AcpSteerSeamLookup;
	sendMessage(
		message: { customType: string; content: string; display: boolean },
		options: { triggerTurn: true; deliverAs?: "steer" | "followUp" },
	): void;
	appendEntry(customType: string, data: unknown): void;
	customType: string;
	now(): string;
	respond(success: boolean, data?: unknown, error?: string): void;
}

export async function deliverControlSend<Binding extends { nativeSessionId: string }, Context>(
	input: ControlSendInput,
	deps: ControlSendDeps<Binding, Context>,
): Promise<void> {
	const compactionReject = compactionSendReject(deps.compaction, {
		idle: deps.isIdle(),
		hasAgentSignal: deps.hasAgentSignal(),
	});
	if (compactionReject) {
		deps.respond(false, undefined, compactionReject);
		return;
	}

	if (input.mode === "steer" && !deps.isIdle()) {
		const lookup = deps.lookupSeam();
		if (lookup.kind === "invalid") {
			deps.respond(false, undefined, lookup.detail);
			return;
		}
		if (lookup.kind === "ok") {
			const bound = deps.binding();
			const ctx = deps.context();
			const nativeA = deps.sessionId();
			if (bound && bound.nativeSessionId === nativeA) {
				let effect: AcpSteerEffect;
				try {
					effect = await lookup.seam.steerBusy(nativeA, input.content);
				} catch (err) {
					// The seam threw: whether a request left is unknown, so this is never re-queued.
					effect = {
						effect: "unknown",
						reason: "seam-threw",
						detail: err instanceof Error ? err.message : String(err),
					};
				}
				// ── after the one await: synchronous until the SDK call ──
				const sameBinding =
					deps.binding() === bound && !deps.closing() && deps.context() === ctx && deps.sessionId() === nativeA;
				if (effect.effect === "injected") {
					const record = sameBinding ? recordSteer(input, deps) : "skipped-binding-changed";
					deps.respond(true, { boundary: STEER_IN_TURN, record, wants_reply: input.wantsReply });
					return;
				}
				if (effect.effect === "unknown") {
					deps.respond(true, {
						boundary: STEER_UNKNOWN,
						reason: effect.reason,
						detail: effect.detail,
						wants_reply: input.wantsReply,
					});
					return;
				}
				// not-sent / prompt-required: nothing reached the turn; queue only on the same binding.
				if (!sameBinding) {
					deps.respond(false, undefined, "target-stale");
					return;
				}
				const again = compactionSendReject(deps.compaction, {
					idle: deps.isIdle(),
					hasAgentSignal: deps.hasAgentSignal(),
				});
				if (again) {
					deps.respond(false, undefined, again);
					return;
				}
			}
		}
	}

	queueNow(input, deps);
}

/** The queue path: idle re-read here, the SDK call and the receipt chosen together, no await. */
function queueNow<Binding extends { nativeSessionId: string }, Context>(
	input: ControlSendInput,
	deps: ControlSendDeps<Binding, Context>,
): void {
	const idleNow = deps.isIdle();
	const customMessage = { customType: deps.customType, content: input.content, display: true };
	// Crash-loud: a sendMessage throw (queue refusal, internal invariant) is answered on the RPC
	// channel, so the sender knows the message did NOT enter the queue — never a silent drop.
	try {
		if (idleNow) {
			deps.sendMessage(customMessage, { triggerTurn: true });
		} else {
			deps.sendMessage(customMessage, {
				triggerTurn: true,
				deliverAs: input.mode === "follow_up" ? "followUp" : "steer",
			});
		}
	} catch (error) {
		const msg = error instanceof Error ? error.message : String(error);
		deps.respond(false, undefined, `pi.sendMessage failed: ${msg}`);
		return;
	}
	// #120 P2: the receiver reports the boundary it actually observed, and nothing else.
	const boundary: ObservedBoundary = sendReceiptBoundary({ idle: idleNow, mode: input.mode });
	deps.respond(true, { boundary, wants_reply: input.wantsReply });
}

/** Record an injected steer as a plain entry. A failure is reported, never escalated. */
function recordSteer<Binding extends { nativeSessionId: string }, Context>(
	input: ControlSendInput,
	deps: ControlSendDeps<Binding, Context>,
): string {
	try {
		deps.appendEntry(STEER_ENTRY_TYPE, {
			text: input.message,
			sender: input.sender ?? null,
			at: deps.now(),
			wantsReply: input.wantsReply,
		});
		return "ok";
	} catch (err) {
		return `failed:${err instanceof Error ? err.message : String(err)}`;
	}
}
