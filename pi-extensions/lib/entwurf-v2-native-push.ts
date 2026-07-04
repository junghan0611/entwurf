/**
 * entwurf-v2-native-push — the native-push SEND hand (봉인 3/4, the executor half of the
 * native-push rail). It takes the `native-push` ExecutionPlan the 5b decider ALREADY chose
 * and direct-injects the message into the live conversation via the adapter. It DECIDES NO
 * ROUTING (the NATIVE_PUSH_DISPATCH_TABLE did) and carries NO release seam — a native-push
 * plan is the LOCK-FREE path (봉인 4), so a lock leak is structurally impossible here.
 *
 * This is where the 1-shot retry lives — NOT in the adapter leaf (봉인 3). The decider
 * probed a fresh route and planted it in the plan; the executor sends over it, and on a
 * failure it re-probes ONCE (the volatile LS port may have shifted between decide and
 * execute) and re-sends. A second failure is fail-loud (no infinite loop). This mirrors the
 * control-socket send-fallback pattern: the decider stays pure, the hand owns the retry.
 *
 * A native-push send has NO in-band refuse (there is no live receiver to answer
 * success:false) — like a mailbox enqueue, it either succeeds or THROWS. The hand never
 * folds a throw into {success:false}; the runner maps a thrown error to execution-failed.
 */

import type { ExecutionPlan } from "./entwurf-v2-decider.ts";
import type { LockClaim } from "./entwurf-v2-lock.ts";
import { type NativePushAdapter, type NativePushRoute, resolveNativePushAdapter } from "./native-push/adapter.ts";

/** The native-push slice of the ExecutionPlan union (the decider plants it, this consumes it). */
export type NativePushPlan = Extract<ExecutionPlan, { transport: "native-push" }>;

export interface NativePushSendResult {
	success: true;
	/** Whether the 1-shot re-probe→re-send fired (the first send over the planted route failed). */
	retried: boolean;
}

/**
 * Deliver `content` into the conversation, owning the 1-shot retry (봉인 3). Send over the
 * planted (decider-probed) route first; on failure re-probe ONCE and re-send over the fresh
 * route; a second failure PROPAGATES (fail-loud). If the re-probe finds the target no longer
 * alive, throw — a failed send into a now-dead conversation is an honest non-delivery, never
 * a silent success. The re-probe is the ONLY re-derivation of the volatile route.
 */
export async function deliverViaNativePush(
	adapter: NativePushAdapter,
	route: NativePushRoute,
	nativeSessionId: string,
	content: string,
): Promise<NativePushSendResult> {
	try {
		await adapter.send(route, nativeSessionId, content);
		return { success: true, retried: false };
	} catch (firstErr) {
		// 1-shot re-probe → re-send: the volatile LS route may have shifted since the decider
		// probed it. Re-discover it fresh and retry exactly once.
		const reprobe = await adapter.probe(nativeSessionId);
		if (reprobe.status !== "alive") {
			throw new Error(
				`native-push deliver: first send failed and re-probe found target ${reprobe.status} (${reprobe.reason}) — not retried`,
				{ cause: firstErr },
			);
		}
		// A second failure THROWS out of this call (fail-loud) — no third attempt.
		await adapter.send(reprobe.route, nativeSessionId, content);
		return { success: true, retried: true };
	}
}

/** Deps for the production native-push send hand — the adapter resolver (default: the real
 *  registry). Injected so the 5d gate proves the wiring with a fake adapter. */
export interface NativePushSendDeps {
	resolveAdapter?: (backend: string) => NativePushAdapter;
}

/**
 * Build the production `sendNativePush(plan, lock)` adapter the runner consumes. It IGNORES
 * `lock` entirely (a native-push plan is lock-free, 봉인 4) — the field exists only to match
 * the DispatchExecutorDeps hand signature. It resolves the adapter from the plan's backend
 * and delivers with the 1-shot retry. A delivery throw surfaces as a REJECTED promise (the
 * runner's try/catch maps it to execution-failed).
 */
export function makeNativePushSend(
	deps: NativePushSendDeps = {},
): (plan: NativePushPlan, lock: LockClaim | null) => Promise<NativePushSendResult> {
	const resolveAdapter = deps.resolveAdapter ?? resolveNativePushAdapter;
	// `_lock` is named for the hand contract but NEVER read — native-push owns/releases no lock.
	return async (plan: NativePushPlan, _lock: LockClaim | null): Promise<NativePushSendResult> => {
		const adapter = resolveAdapter(plan.backend);
		return deliverViaNativePush(adapter, plan.route, plan.nativeSessionId, plan.message);
	};
}
