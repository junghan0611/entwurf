/**
 * entwurf-v2-native-push — the native-push SEND hand (봉인 3/4, the executor half of the
 * native-push rail). It takes the `native-push` ExecutionPlan the 5b decider ALREADY chose
 * and direct-injects the message into the live conversation via the adapter. It DECIDES NO
 * ROUTING (the NATIVE_PUSH_DISPATCH_TABLE did) and carries NO release seam — a native-push
 * plan is the LOCK-FREE path (봉인 4), so a lock leak is structurally impossible here.
 *
 * Retry is an adapter capability, not a rail-wide assumption. Antigravity re-probes once
 * because its volatile LS port can shift before send. Codex never retries: `codex queue`
 * may have accepted the message before its receipt failed, so replay could duplicate it.
 * The decider stays pure; this hand enforces the adapter's declared policy.
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
	/** Whether the adapter's one permitted re-probe→re-send fired. */
	retried: boolean;
}

/**
 * Deliver `content` through the decider-probed route. A non-retriable adapter propagates
 * the first failure unchanged. A retriable adapter re-probes once and sends once more only
 * when the target is still alive; no adapter gets a third attempt.
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
		if (!adapter.retriable) throw firstErr;
		// One re-probe and one retry for adapters whose send boundary is safe to replay.
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
 * `lock` entirely (a native-push plan is lock-free, 봉인 4), resolves the adapter, then applies
 * that adapter's retry policy. A delivery throw surfaces as a REJECTED promise (the runner's
 * try/catch maps it to execution-failed).
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
