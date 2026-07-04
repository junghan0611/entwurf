/**
 * check-entwurf-v2-native-push — deterministic gate for the native-push SEND hand
 * (봉인 3/4), the executor half of the native-push rail. This is where the 1-shot retry
 * lives (moved out of the adapter leaf per the review): the decider planted a fresh route,
 * the hand sends over it, and on failure re-probes ONCE and re-sends.
 *
 * Proves (deliverViaNativePush, fake adapter):
 *   - success first try → {retried:false}, ONE send, ZERO re-probe (the planted route is used).
 *   - fail → re-probe alive → re-send success → {retried:true}, TWO sends, ONE re-probe, and
 *     the second send uses the RE-DISCOVERED route (not the stale planted one).
 *   - fail → re-probe alive → re-send FAIL → THROWS (fail-loud, no third attempt).
 *   - fail → re-probe dead/indeterminate → THROWS (not retried), NO second send.
 * Proves (makeNativePushSend):
 *   - resolves the adapter from plan.backend, delivers via deliverViaNativePush, and IGNORES
 *     the lock (native-push is lock-free, 봉인 4).
 *
 * Pure; no backend, no socket, no real process.
 */

import assert from "node:assert/strict";
import type { LockClaim } from "../pi-extensions/lib/entwurf-v2-lock.ts";
import type { NativePushPlan } from "../pi-extensions/lib/entwurf-v2-native-push.ts";
import { deliverViaNativePush, makeNativePushSend } from "../pi-extensions/lib/entwurf-v2-native-push.ts";
import type {
	NativePushAdapter,
	NativePushProbeResult,
	NativePushRoute,
} from "../pi-extensions/lib/native-push/adapter.ts";

let passed = 0;
function ok(label: string, cond: boolean): void {
	assert.ok(cond, label);
	console.log(`  ok    ${label}`);
	passed++;
}

const CONV = "conv-xyz";
const PLANTED: NativePushRoute = { lsAddress: "127.0.0.1:5600" };

interface SendCall {
	route: NativePushRoute;
	nativeSessionId: string;
	content: string;
}

interface FakeAdapterConfig {
	/** probe() results consumed in order (each re-probe pops the next). */
	probes: NativePushProbeResult[];
	/** 0-based indices of send() calls that THROW. */
	sendFailAt?: number[];
}

function makeFakeAdapter(config: FakeAdapterConfig): {
	adapter: NativePushAdapter;
	sends: SendCall[];
	probeCount: () => number;
} {
	let probeIdx = 0;
	let sendIdx = 0;
	const sends: SendCall[] = [];
	const adapter: NativePushAdapter = {
		id: "antigravity",
		async probe() {
			const p = config.probes[probeIdx] ?? { status: "dead", reason: "fake: probes exhausted" };
			probeIdx++;
			return p;
		},
		async send(route, nativeSessionId, content) {
			const i = sendIdx++;
			sends.push({ route, nativeSessionId, content });
			if (config.sendFailAt?.includes(i)) throw new Error(`fake send fail #${i}`);
		},
	};
	return { adapter, sends, probeCount: () => probeIdx };
}

async function main(): Promise<void> {
	// ── success first try: ONE send over the planted route, ZERO re-probe ────────
	{
		const { adapter, sends, probeCount } = makeFakeAdapter({ probes: [] });
		const r = await deliverViaNativePush(adapter, PLANTED, CONV, "hi");
		ok("success: retried:false", r.success === true && r.retried === false);
		ok("success: exactly ONE send", sends.length === 1);
		ok("success: send used the PLANTED route (no re-probe)", sends[0]?.route.lsAddress === "127.0.0.1:5600");
		ok("success: ZERO re-probe", probeCount() === 0);
	}

	// ── fail → re-probe alive → re-send success: retried, fresh route ────────────
	{
		const { adapter, sends, probeCount } = makeFakeAdapter({
			probes: [{ status: "alive", route: { lsAddress: "127.0.0.1:5601" } }],
			sendFailAt: [0],
		});
		const r = await deliverViaNativePush(adapter, PLANTED, CONV, "hi");
		ok("retry: retried:true", r.success === true && r.retried === true);
		ok("retry: TWO sends (initial + one retry)", sends.length === 2);
		ok("retry: exactly ONE re-probe", probeCount() === 1);
		ok("retry: 1st send used the planted route", sends[0]?.route.lsAddress === "127.0.0.1:5600");
		ok(
			"retry: 2nd send used the RE-DISCOVERED route (not the stale one)",
			sends[1]?.route.lsAddress === "127.0.0.1:5601",
		);
	}

	// ── fail → re-probe alive → re-send FAIL: throws (fail-loud, no 3rd attempt) ──
	{
		const { adapter, sends } = makeFakeAdapter({
			probes: [{ status: "alive", route: { lsAddress: "127.0.0.1:5601" } }],
			sendFailAt: [0, 1],
		});
		let threw = false;
		try {
			await deliverViaNativePush(adapter, PLANTED, CONV, "hi");
		} catch {
			threw = true;
		}
		ok("double-fail: THROWS (fail-loud)", threw);
		ok("double-fail: exactly TWO sends, no third attempt", sends.length === 2);
	}

	// ── fail → re-probe dead: throws (not retried), NO second send ───────────────
	{
		const { adapter, sends, probeCount } = makeFakeAdapter({
			probes: [{ status: "dead", reason: "host gone" }],
			sendFailAt: [0],
		});
		let msg = "";
		try {
			await deliverViaNativePush(adapter, PLANTED, CONV, "hi");
		} catch (err) {
			msg = (err as Error).message;
		}
		ok("reprobe-dead: THROWS", msg.length > 0);
		ok("reprobe-dead: error names the dead re-probe + 'not retried'", /dead/.test(msg) && /not retried/.test(msg));
		ok("reprobe-dead: exactly ONE send (no re-send into a dead conversation)", sends.length === 1);
		ok("reprobe-dead: re-probe was attempted once", probeCount() === 1);
	}

	// ── fail → re-probe indeterminate: throws (not retried) ──────────────────────
	{
		const { adapter, sends } = makeFakeAdapter({
			probes: [{ status: "indeterminate", reason: "no port" }],
			sendFailAt: [0],
		});
		let threw = false;
		try {
			await deliverViaNativePush(adapter, PLANTED, CONV, "hi");
		} catch {
			threw = true;
		}
		ok("reprobe-indeterminate: THROWS (never coerced to a retry)", threw);
		ok("reprobe-indeterminate: exactly ONE send", sends.length === 1);
	}

	// ── makeNativePushSend: resolves adapter from plan.backend, ignores lock ─────
	{
		const plan: NativePushPlan = {
			transport: "native-push",
			action: "send",
			targetGardenId: "20260704T000000-abcdef",
			backend: "antigravity",
			nativeSessionId: CONV,
			route: PLANTED,
			wantsReply: false,
			message: "payload",
		};
		const { adapter, sends } = makeFakeAdapter({ probes: [] });
		const resolvedBackends: string[] = [];
		const send = makeNativePushSend({
			resolveAdapter: (backend) => {
				resolvedBackends.push(backend);
				return adapter;
			},
		});
		// pass a NON-null lock to prove it is ignored (lock-free rail).
		const bogusLock = { gardenId: "x" } as unknown as LockClaim;
		const r = await send(plan, bogusLock);
		ok("makeNativePushSend: delivered success", r.success === true && r.retried === false);
		ok(
			"makeNativePushSend: resolved the adapter from plan.backend",
			resolvedBackends.length === 1 && resolvedBackends[0] === "antigravity",
		);
		ok(
			"makeNativePushSend: sent the plan message over the plan route",
			sends[0]?.content === "payload" && sends[0]?.route.lsAddress === "127.0.0.1:5600",
		);
		ok("makeNativePushSend: lock IGNORED (lock-free — a bogus lock did not break delivery)", sends.length === 1);
	}

	console.log(`\ncheck-entwurf-v2-native-push: ${passed} assertions passed`);
}

void main();
