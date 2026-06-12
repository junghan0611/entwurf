/**
 * check-entwurf-v2-send — deterministic gate for the 5c-2a control-socket SEND hand
 * (`executeControlSocketSend`). It proves the send→outcome→release WIRING over
 * injected fakes, with NO live socket, exactly as the 5b decider gate proves dispatch:
 *
 *   1. ack success            → outcome `sent`, release ×1, deadFallback NOT called.
 *   2. in-band reject (success:false) → outcome `rejected`, release ×1, NO fallback
 *      (deadFallback + mailbox NOT called — the receiver was reached and refused).
 *   3. dead → re-resolve(control-socket) → success → `fallback-sent`, release ×1,
 *      deadFallback called EXACTLY once and UNDER the still-held lock (before release).
 *   4. dead → re-resolve reject → `rejected`, release ×1.
 *   5. dead → re-resolve(control-socket) retry THROWS → `failed`, release ×1, original
 *      retry error rethrown; the retry is one-shot (deadFallback called once only).
 *   6. dead → deadFallback THROWS → `failed`, release ×1, rethrow.
 *   7. indeterminate → `failed`, release ×1, rethrow; deadFallback + mailbox NOT called
 *      (no double-delivery on an alive-but-stalled socket).
 *   8. dead → re-resolve(meta-mailbox) → enqueue success → `fallback-sent`, release ×1
 *      (mailbox helper called once); enqueue success:false → `rejected`. A first-dead
 *      NEVER reaches the mailbox without the resolver routing it there.
 *   9. single-release: releaseLock is invoked exactly once per send-final.
 *  10. masking guard: on a `failed` send the ORIGINAL send error is rethrown even if
 *      releaseLock itself throws (a release failure must not mask the send failure).
 *  11. lock invariants: null lock / mismatched-gid lock → throws (decideReleasePolicy).
 *  12. contract: a re-resolve into a spawn-bg plan for a SEND → throws AND still
 *      releases the held lock ×1 (lock-leak backstop, not a leak).
 *  13. lock-leak backstop: any UNEXPECTED dep throw after the lock is held
 *      (classifyConnect) still releases ×1 and rethrows the original error.
 *  14. mis-route: a re-resolve returning a DIFFERENT-target control plan fails loud
 *      BEFORE any retry send (no retry, no mailbox, release ×1).
 *  15. mis-route: a re-resolve returning a DIFFERENT-target mailbox plan fails loud
 *      BEFORE enqueue (no mailbox, release ×1).
 *  16. non-failed releaseLock throw (sent): the delivery already happened, so the
 *      release error propagates honestly (caller must not re-send) — release ×1.
 *  17. mailbox fallback enqueue THROW → failed + rethrow, helper called once, release ×1.
 *
 * No real IO — fakes record call order so "release happens after re-resolve, exactly
 * once" is asserted structurally.
 */

import assert from "node:assert/strict";
import type { ExecutionPlan } from "../pi-extensions/lib/entwurf-v2-decider.ts";
import type { LockClaim } from "../pi-extensions/lib/entwurf-v2-lock.ts";
import {
	type ControlSocketSendDeps,
	type DeadFallbackResolution,
	executeControlSocketSend,
	type RpcSendResult,
} from "../pi-extensions/lib/entwurf-v2-send.ts";

let passed = 0;
function ok(label: string, cond: boolean): void {
	assert.ok(cond, label);
	console.log(`  ok    ${label}`);
	passed++;
}

const GID = "20260612T100000-aaaaaa";
const WRONG_GID = "20260612T999999-bbbbbb";

function lockClaim(gardenId = GID): LockClaim {
	return {
		gardenId,
		pid: 4242,
		hostname: "test-host",
		createdAt: "2026-06-12T01:00:00.000Z",
		nonce: "deadbeefcafef00d",
		owner: "entwurf_v2",
		lockPath: `/fake/locks/${gardenId}.lock`,
	};
}

const CONTROL_PLAN = {
	transport: "control-socket",
	action: "send",
	targetGardenId: GID,
	socketPath: "/fake/ctl/s.sock",
	mode: "follow_up",
	wantsReply: false,
	message: "m",
} as const satisfies Extract<ExecutionPlan, { transport: "control-socket" }>;

const RERESOLVED_CONTROL_PLAN = { ...CONTROL_PLAN, socketPath: "/fake/ctl/alt.sock" } as const;

const MAILBOX_PLAN = {
	transport: "meta-mailbox",
	action: "send",
	targetGardenId: GID,
	mailboxDir: "/fake/mailbox",
	sessionsDir: "/fake/sessions",
	wantsReply: false,
	message: "m",
} as const satisfies Extract<ExecutionPlan, { transport: "meta-mailbox" }>;

const SPAWN_PLAN = {
	transport: "spawn-bg",
	action: "resume",
	targetGardenId: GID,
	sessionId: GID,
	cwd: "/home/junghan/repos/gh/pi-shell-acp",
	prompt: "p",
	launchArgs: [],
	expectedSocketPath: "/fake/ctl/s.sock",
	observeTimeoutMs: 30_000,
	releaseWhen: "socket-alive-or-child-exited",
} as const satisfies Extract<ExecutionPlan, { transport: "spawn-bg" }>;

// A connect-time error with a real `.code` (drives the F3 classifier the way a node
// net error would). dead = ECONNREFUSED/ENOENT; everything else = indeterminate.
function connError(code: string): NodeJS.ErrnoException {
	const e = new Error(`connect ${code}`) as NodeJS.ErrnoException;
	e.code = code;
	return e;
}

// The real F3 classifier — proving the wiring direction (dead vs indeterminate), not a
// hand-rolled stand-in.
function classifyConnect(code: string | undefined): "dead" | "indeterminate" {
	return code === "ECONNREFUSED" || code === "ENOENT" ? "dead" : "indeterminate";
}

interface Trace {
	order: string[];
	socketSends: Array<Extract<ExecutionPlan, { transport: "control-socket" }>>;
	mailboxSends: Array<Extract<ExecutionPlan, { transport: "meta-mailbox" }>>;
	deadFallbackCalls: number;
	releases: LockClaim[];
}

interface FakeSpec {
	// 1차 send: a result (ack/in-band), or a throw with this connect code.
	firstSend: { result: RpcSendResult } | { throwCode: string };
	// re-resolve outcome (only consulted on a dead first send).
	deadFallback?: DeadFallbackResolution | { throw: unknown };
	// the retry/mailbox send when the re-resolve hands back a plan.
	fallbackSend?: { result: RpcSendResult } | { throwCode: string };
	// force releaseLock to throw (masking-guard case).
	releaseThrows?: unknown;
}

function makeDeps(spec: FakeSpec): { deps: ControlSocketSendDeps; trace: Trace } {
	const trace: Trace = { order: [], socketSends: [], mailboxSends: [], deadFallbackCalls: 0, releases: [] };
	let socketCall = 0;

	const deps: ControlSocketSendDeps = {
		async sendOverSocket(plan) {
			socketCall++;
			trace.order.push(`sendOverSocket#${socketCall}`);
			trace.socketSends.push(plan);
			// First socket call = 1차 send; any later = the re-resolve retry.
			const step = socketCall === 1 ? spec.firstSend : spec.fallbackSend;
			if (!step) throw new Error("test: unexpected extra sendOverSocket call");
			if ("throwCode" in step) throw connError(step.throwCode);
			return step.result;
		},
		classifyConnect,
		releaseLock(lock) {
			trace.order.push("releaseLock");
			trace.releases.push(lock);
			if (spec.releaseThrows !== undefined) throw spec.releaseThrows;
		},
		async deadFallback(_plan, _lock) {
			trace.deadFallbackCalls++;
			trace.order.push("deadFallback");
			if (!spec.deadFallback) throw new Error("test: deadFallback called but no spec");
			if ("throw" in spec.deadFallback) throw spec.deadFallback.throw;
			return spec.deadFallback;
		},
		async sendViaMailbox(plan) {
			trace.order.push("sendViaMailbox");
			trace.mailboxSends.push(plan);
			const step = spec.fallbackSend;
			if (!step) throw new Error("test: unexpected sendViaMailbox call");
			if ("throwCode" in step) throw connError(step.throwCode);
			return step.result;
		},
	};
	return { deps, trace };
}

async function run(spec: FakeSpec, lock: LockClaim | null = lockClaim()) {
	const { deps, trace } = makeDeps(spec);
	const result = await executeControlSocketSend(CONTROL_PLAN, lock, deps);
	return { result, trace };
}

async function rejects(fn: () => Promise<unknown>): Promise<unknown> {
	try {
		await fn();
		return Symbol("did-not-throw");
	} catch (err) {
		return err;
	}
}

async function main(): Promise<void> {
	// ── 1: ack success → sent, release once, no fallback ──────────────────────
	{
		const { result, trace } = await run({ firstSend: { result: { success: true } } });
		ok("ack success → sent", result.outcome === "sent");
		ok("ack success → release ×1", trace.releases.length === 1 && trace.releases[0].nonce === lockClaim().nonce);
		ok("ack success → deadFallback NOT called", trace.deadFallbackCalls === 0);
		ok("ack success → release after the send", trace.order.join(",") === "sendOverSocket#1,releaseLock");
	}

	// ── 2: in-band reject → rejected, release once, NO fallback ───────────────
	{
		const { result, trace } = await run({ firstSend: { result: { success: false, error: "refused" } } });
		ok("in-band reject → rejected", result.outcome === "rejected");
		ok("in-band reject → release ×1", trace.releases.length === 1);
		ok(
			"in-band reject → no deadFallback, no mailbox",
			trace.deadFallbackCalls === 0 && trace.mailboxSends.length === 0,
		);
	}

	// ── 3: dead → re-resolve(control) success → fallback-sent, fallback before release
	{
		const { result, trace } = await run({
			firstSend: { throwCode: "ECONNREFUSED" },
			deadFallback: { kind: "execute", plan: RERESOLVED_CONTROL_PLAN },
			fallbackSend: { result: { success: true } },
		});
		ok("dead → re-resolve(control) success → fallback-sent", result.outcome === "fallback-sent");
		ok("dead → deadFallback called exactly once", trace.deadFallbackCalls === 1);
		ok("dead → re-resolve used the alt socket", trace.socketSends[1]?.socketPath === "/fake/ctl/alt.sock");
		ok("dead → release ×1", trace.releases.length === 1);
		ok(
			"dead → deadFallback UNDER held lock (before release)",
			trace.order.indexOf("deadFallback") < trace.order.indexOf("releaseLock"),
		);
	}

	// ── 4: dead → re-resolve reject → rejected ────────────────────────────────
	{
		const { result, trace } = await run({
			firstSend: { throwCode: "ENOENT" },
			deadFallback: { kind: "reject", reason: "no-route" },
		});
		ok("dead → re-resolve reject → rejected", result.outcome === "rejected");
		ok("dead → reject → release ×1, no retry send", trace.releases.length === 1 && trace.socketSends.length === 1);
	}

	// ── 5: dead → re-resolve(control) retry throws → failed + rethrow ──────────
	{
		const { deps, trace } = makeDeps({
			firstSend: { throwCode: "ECONNREFUSED" },
			deadFallback: { kind: "execute", plan: RERESOLVED_CONTROL_PLAN },
			fallbackSend: { throwCode: "ECONNREFUSED" },
		});
		const err = await rejects(() => executeControlSocketSend(CONTROL_PLAN, lockClaim(), deps));
		ok(
			"dead → retry throws → rethrows the retry error",
			err instanceof Error && (err as NodeJS.ErrnoException).code === "ECONNREFUSED",
		);
		ok("dead → retry throws → release ×1 (failed still releases)", trace.releases.length === 1);
		ok("dead → retry is one-shot (deadFallback called once)", trace.deadFallbackCalls === 1);
	}

	// ── 6: dead → deadFallback throws → failed + rethrow ──────────────────────
	{
		const sentinel = new Error("resolver boom");
		const { deps, trace } = makeDeps({ firstSend: { throwCode: "ENOENT" }, deadFallback: { throw: sentinel } });
		const err = await rejects(() => executeControlSocketSend(CONTROL_PLAN, lockClaim(), deps));
		ok("dead → deadFallback throws → rethrows it", err === sentinel);
		ok("dead → deadFallback throws → release ×1", trace.releases.length === 1);
	}
	for (const code of ["ETIMEDOUT", "EACCES"] as const) {
		const { deps, trace } = makeDeps({ firstSend: { throwCode: code } });
		const err = await rejects(() => executeControlSocketSend(CONTROL_PLAN, lockClaim(), deps));
		ok(
			`indeterminate(${code}) → rethrows the connect error`,
			err instanceof Error && (err as NodeJS.ErrnoException).code === code,
		);
		ok(`indeterminate(${code}) → release ×1`, trace.releases.length === 1);
		ok(
			`indeterminate(${code}) → deadFallback + mailbox NOT called`,
			trace.deadFallbackCalls === 0 && trace.mailboxSends.length === 0,
		);
	}

	// ── 8: dead → re-resolve(meta-mailbox) → fallback-sent / rejected ─────────
	{
		const sent = await run({
			firstSend: { throwCode: "ECONNREFUSED" },
			deadFallback: { kind: "execute", plan: MAILBOX_PLAN },
			fallbackSend: { result: { success: true } },
		});
		ok("dead → re-resolve(mailbox) enqueue → fallback-sent", sent.result.outcome === "fallback-sent");
		ok("dead → mailbox helper called once", sent.trace.mailboxSends.length === 1);
		ok("dead → mailbox reached only via resolver, release ×1", sent.trace.releases.length === 1);

		const refused = await run({
			firstSend: { throwCode: "ENOENT" },
			deadFallback: { kind: "execute", plan: MAILBOX_PLAN },
			fallbackSend: { result: { success: false } },
		});
		ok("dead → mailbox enqueue success:false → rejected", refused.result.outcome === "rejected");
	}

	// ── 9: single-release across every outcome (release at most once) ─────────
	{
		const specs: FakeSpec[] = [
			{ firstSend: { result: { success: true } } },
			{ firstSend: { result: { success: false } } },
			{
				firstSend: { throwCode: "ECONNREFUSED" },
				deadFallback: { kind: "execute", plan: RERESOLVED_CONTROL_PLAN },
				fallbackSend: { result: { success: true } },
			},
		];
		let allSingle = true;
		for (const s of specs) {
			const { trace } = await run(s);
			if (trace.releases.length !== 1) allSingle = false;
		}
		ok("single-release: every non-throw outcome releases exactly once", allSingle);
	}

	// ── 10: masking guard — releaseLock throw must NOT mask the send failure ──
	{
		const releaseErr = new Error("release boom");
		// indeterminate first send → failed (error = the ETIMEDOUT connect error); the
		// release then throws. The ORIGINAL send error must surface, not the release one.
		const { deps, trace } = makeDeps({ firstSend: { throwCode: "ETIMEDOUT" }, releaseThrows: releaseErr });
		const err = await rejects(() => executeControlSocketSend(CONTROL_PLAN, lockClaim(), deps));
		ok(
			"masking guard: original send error wins over a releaseLock throw",
			err instanceof Error && (err as NodeJS.ErrnoException).code === "ETIMEDOUT" && err !== releaseErr,
		);
		ok("masking guard: release was still attempted", trace.releases.length === 1);
	}

	// ── 11: lock invariants → throws (decideReleasePolicy) ────────────────────
	{
		const { deps } = makeDeps({ firstSend: { result: { success: true } } });
		const nullErr = await rejects(() => executeControlSocketSend(CONTROL_PLAN, null, deps));
		ok("null lock → throws (must hold lock)", nullErr instanceof Error);

		const { deps: deps2 } = makeDeps({ firstSend: { result: { success: true } } });
		const mismatchErr = await rejects(() => executeControlSocketSend(CONTROL_PLAN, lockClaim(WRONG_GID), deps2));
		ok("mismatched-gid lock → throws (mis-paired plan/lock)", mismatchErr instanceof Error);
	}

	// ── 12: contract — re-resolve into a spawn-bg plan for a SEND → throws,
	//        AND the held lock is STILL released (lock-leak backstop) ───────────
	{
		const { deps, trace } = makeDeps({
			firstSend: { throwCode: "ECONNREFUSED" },
			deadFallback: { kind: "execute", plan: SPAWN_PLAN },
		});
		const err = await rejects(() => executeControlSocketSend(CONTROL_PLAN, lockClaim(), deps));
		ok("re-resolve → spawn-bg for a send → throws (contract violation)", err instanceof Error);
		ok("re-resolve → spawn-bg → lock STILL released ×1 (no leak)", trace.releases.length === 1);
	}

	// ── 13: lock-leak backstop — an UNEXPECTED dep throw (classifyConnect) after
	//        the lock is held still releases ×1 and rethrows the original error ──
	{
		const { deps, trace } = makeDeps({ firstSend: { throwCode: "ECONNREFUSED" } });
		const boom = new Error("classify boom");
		deps.classifyConnect = () => {
			throw boom;
		};
		const err = await rejects(() => executeControlSocketSend(CONTROL_PLAN, lockClaim(), deps));
		ok("dep throw (classifyConnect) → rethrows the original error", err === boom);
		ok("dep throw → lock STILL released ×1 (no leak)", trace.releases.length === 1);
	}

	// ── 14: mis-route — re-resolve returns a DIFFERENT-target control plan →
	//        fail loud BEFORE any retry send, release ×1, no mailbox ────────────
	{
		const otherTargetControl = { ...RERESOLVED_CONTROL_PLAN, targetGardenId: WRONG_GID } as const;
		const { deps, trace } = makeDeps({
			firstSend: { throwCode: "ECONNREFUSED" },
			deadFallback: { kind: "execute", plan: otherTargetControl },
			fallbackSend: { result: { success: true } },
		});
		const err = await rejects(() => executeControlSocketSend(CONTROL_PLAN, lockClaim(), deps));
		ok("mis-route (control, other target) → throws", err instanceof Error);
		ok(
			"mis-route (control) → no retry send, no mailbox, release ×1",
			trace.socketSends.length === 1 && trace.mailboxSends.length === 0 && trace.releases.length === 1,
		);
	}

	// ── 15: mis-route — re-resolve returns a DIFFERENT-target mailbox plan →
	//        fail loud BEFORE enqueue, release ×1 ──────────────────────────────
	{
		const otherTargetMailbox = { ...MAILBOX_PLAN, targetGardenId: WRONG_GID } as const;
		const { deps, trace } = makeDeps({
			firstSend: { throwCode: "ENOENT" },
			deadFallback: { kind: "execute", plan: otherTargetMailbox },
			fallbackSend: { result: { success: true } },
		});
		const err = await rejects(() => executeControlSocketSend(CONTROL_PLAN, lockClaim(), deps));
		ok("mis-route (mailbox, other target) → throws", err instanceof Error);
		ok("mis-route (mailbox) → no enqueue, release ×1", trace.mailboxSends.length === 0 && trace.releases.length === 1);
	}

	// ── 16: non-failed releaseLock throw — the delivery already HAPPENED, so the
	//        release error propagates honestly (caller must NOT re-send; this is the
	//        counterpart to case 10's failed-masking guard). Release still attempted ×1.
	//        (Fable N1: 5d surface must distinguish "send failed" from "delivered +
	//        release failed" — tracked in NEXT.md 5c-2(b)/5d contract list.)
	{
		const releaseErr = new Error("release boom after delivery");
		const { deps, trace } = makeDeps({ firstSend: { result: { success: true } }, releaseThrows: releaseErr });
		const err = await rejects(() => executeControlSocketSend(CONTROL_PLAN, lockClaim(), deps));
		ok("sent + releaseLock throw → release error propagates (delivery already done)", err === releaseErr);
		ok("sent + releaseLock throw → release ×1 attempted", trace.releases.length === 1);
	}

	// ── 17: mailbox fallback enqueue THROW → failed + rethrow, release ×1 (Fable
	//        N2: the sendViaMailbox throw path existed but was ungated). ────────────
	{
		const { deps, trace } = makeDeps({
			firstSend: { throwCode: "ECONNREFUSED" },
			deadFallback: { kind: "execute", plan: MAILBOX_PLAN },
			fallbackSend: { throwCode: "EPIPE" },
		});
		const err = await rejects(() => executeControlSocketSend(CONTROL_PLAN, lockClaim(), deps));
		ok(
			"dead → mailbox enqueue throws → rethrows",
			err instanceof Error && (err as NodeJS.ErrnoException).code === "EPIPE",
		);
		ok(
			"dead → mailbox enqueue throws → helper called once, release ×1",
			trace.mailboxSends.length === 1 && trace.releases.length === 1,
		);
	}

	console.log(`\n[check-entwurf-v2-send] ${passed} assertions ok`);
}

await main();
