/**
 * entwurf-v2-send — the 5c-2 control-socket SEND hand (0.11 Stage 0 step 5c-2a).
 * It WIRES real transport IO onto the pure release reducer (5c-1): drive a
 * control-socket send to a FINAL outcome, feed that outcome to `reduceRelease`, and
 * release the held lock EXACTLY ONCE. Every IO seam is an injected dep (the gate
 * fakes it, production wires the real fns), so the send→outcome→release ORDERING is
 * gate-provable without a live socket — the same "pure-before-IO, IO-via-dep"
 * discipline 5b used for the decider.
 *
 * Why a control hand that only EXECUTES, never DECIDES routing: the 5b decider
 * already chose this in-domain control-socket plan AFTER observing the target alive.
 * But a send can race that observation — by send time the socket may be `dead`
 * (TOCTOU). The control hand must NOT decide on its own that a dead socket means
 * "mailbox now" — that would bypass the 5b dispatch table (deliverability / conflict /
 * pi-primary wakeMode). So on a `dead` connect it delegates to `deps.deadFallback`,
 * a SAME-LOCK one-shot re-resolve (the 5c-2b resolver: reuse 5b resolveTarget /
 * inspectSocket / resolveDispatch but DO NOT release) that hands back a fresh plan to
 * EXECUTE or a reject. The hand runs that plan once; it never re-routes by itself.
 *
 * The three load-bearing send-final rules (GPT 5c-2 design, conditional GO):
 *   - in-band reject (RPC `success:false`) is FINAL with NO fallback — the receiver
 *     was reached and refused; re-resolving would be a second delivery attempt.
 *   - a `dead` connect (ECONNREFUSED/ENOENT) proves non-delivery → re-resolve once.
 *   - an `indeterminate` connect (timeout/EACCES/stall) proves NOTHING: the socket
 *     may be alive-but-stalled, so a fallback would risk a DOUBLE delivery. It is an
 *     immediate `failed` + rethrow — deadFallback and the mailbox helper are NOT even
 *     called. (This is the exact F3 three-valued liveness distinction, on the send
 *     path: dead ⇒ act, indeterminate ⇒ do not.)
 *
 * Release authority is ALWAYS the LockClaim the decider handed over. `reduceRelease`
 * guarantees the release fires at most once across the single send-final event; a
 * `releaseLock` throw never MASKS a send failure — the original error wins (5b).
 */

import type { ExecutionPlan } from "./entwurf-v2-decider.ts";
import type { LockClaim } from "./entwurf-v2-lock.ts";
import {
	decideReleasePolicy,
	initialReleaseState,
	type ReleasePolicy,
	type ReleaseState,
	reduceRelease,
} from "./entwurf-v2-release.ts";

// The two send-capable plan shapes, narrowed from the decider's ExecutionPlan union.
export type ControlSocketPlan = Extract<ExecutionPlan, { transport: "control-socket" }>;
export type MetaMailboxPlan = Extract<ExecutionPlan, { transport: "meta-mailbox" }>;

/** The terminal outcome of a send attempt, mapped 1:1 onto the reducer's
 * `send-final` outcomes. `fallback-sent` is a REAL final outcome (legacy parity: a
 * re-resolved delivery is not a hidden retry). */
export type SendFinalOutcome = "sent" | "fallback-sent" | "rejected" | "failed";

/** What a single RPC / mailbox enqueue reports. `success:false` is an in-band reject
 * (the receiver answered and refused) — distinct from a thrown connect error. */
export interface RpcSendResult {
	success: boolean;
	error?: string;
}

/** The same-lock one-shot re-resolve result (5c-2b implements the resolver; 5c-2a
 * only consumes its contract). `execute` hands back a fresh plan to run ONCE under the
 * SAME held lock; `reject` means there is no live route — a final `rejected`. The
 * resolver must NOT release the lock — release stays the hand's single responsibility. */
export type DeadFallbackResolution = { kind: "execute"; plan: ExecutionPlan } | { kind: "reject"; reason: string };

/**
 * Every IO seam is a REQUIRED dep — the hand performs ZERO IO of its own, exactly so
 * the gate can drive every send-final path without a socket (5b's "no hidden default
 * that touches the world" rule).
 *   - sendOverSocket  — the control-socket RPC send (1차 AND the re-resolve retry).
 *     Resolves `RpcSendResult` on a completed RPC; THROWS on a connect-time failure
 *     (the thrown error's `.code` is what `classifyConnect` reads).
 *   - classifyConnect — connect-error code → "dead" | "indeterminate" (the F3 split).
 *   - releaseLock     — release the held claim; called at most once, only when the
 *     reducer says shouldRelease.
 *   - deadFallback    — the SAME-LOCK re-resolve, called ONLY on a `dead` connect and
 *     ONLY while the lock is still held. (5c-2b supplies the real resolver.)
 *   - sendViaMailbox  — enqueue-only meta-mailbox delivery, used ONLY when the
 *     re-resolve hands back a meta-mailbox plan. The hand never decides mailbox
 *     routing itself; it just runs the plan the resolver chose. (5c-4 supplies the
 *     real enqueue.)
 */
export interface ControlSocketSendDeps {
	sendOverSocket: (plan: ControlSocketPlan) => Promise<RpcSendResult>;
	classifyConnect: (code: string | undefined) => "dead" | "indeterminate";
	releaseLock: (lock: LockClaim) => void;
	deadFallback: (plan: ControlSocketPlan, lock: LockClaim) => Promise<DeadFallbackResolution>;
	sendViaMailbox: (plan: MetaMailboxPlan, lock: LockClaim) => Promise<RpcSendResult>;
}

export interface ControlSocketSendResult {
	outcome: SendFinalOutcome;
	/** Present ONLY on a `rejected` outcome that came from the dead-path re-resolve
	 * (5c-2b): the resolver's machine-readable reason (dormant-fire-forget-unsupported /
	 * mailbox-undeliverable / indeterminate-no-spawn / bad-target / target-address-conflict).
	 * An in-band RPC refusal carries NO reason (there is no resolver taxonomy for it). The
	 * 5d runner carries this verbatim so the surface can tell "in-band refusal" from
	 * "no live route" — the N3 carry-over the hand boundary used to drop. */
	rejectReason?: string;
}

// A drive step's verdict: the terminal outcome, plus the original error to RETHROW on
// a `failed` (the hand releases first, then rethrows — never swallows the failure), plus
// the optional resolver reject reason to carry on a re-resolve `rejected` (N3).
interface SendDrive {
	outcome: SendFinalOutcome;
	error?: unknown;
	rejectReason?: string;
}

/**
 * Execute a control-socket send to a final outcome and release the held lock exactly
 * once. `lock` MUST be the in-domain claim the decider handed over —
 * `decideReleasePolicy` throws if it is null or paired with the wrong gid (a mis-wire
 * is fail-loud, not a runtime branch). On a `failed` outcome the original transport
 * error is rethrown AFTER the (single) release.
 */
export async function executeControlSocketSend(
	plan: ControlSocketPlan,
	lock: LockClaim | null,
	deps: ControlSocketSendDeps,
): Promise<ControlSocketSendResult> {
	// Throws on a null / mis-paired lock (？7 + gid invariants). After this line the
	// control-socket policy is release-after-send-final and the lock is non-null.
	const policy: ReleasePolicy = decideReleasePolicy(plan, lock);
	const held = lock as LockClaim;

	// Lock-leak backstop: once the lock is held, ANY throw out of the drive — a
	// contract-violation guard (spawn-bg re-resolve), the mis-route assert, even a buggy
	// dep that throws where it should return — must still release the lock before it
	// propagates. A leaked lock pins the gid forever (5a's worst failure). So convert any
	// such throw into a `failed` final outcome, run finalizeRelease (which releases on
	// the send-final event), and then rethrow the original error from there.
	let drive: SendDrive;
	try {
		drive = await driveSend(plan, held, deps);
	} catch (err) {
		drive = { outcome: "failed", error: err };
	}
	finalizeRelease(policy, deps, held, drive);
	return { outcome: drive.outcome, rejectReason: drive.rejectReason };
}

/** Drive the 1차 send and route a connect failure through the F3 split. */
async function driveSend(plan: ControlSocketPlan, lock: LockClaim, deps: ControlSocketSendDeps): Promise<SendDrive> {
	let result: RpcSendResult;
	try {
		result = await deps.sendOverSocket(plan);
	} catch (err) {
		const liveness = deps.classifyConnect((err as NodeJS.ErrnoException)?.code);
		if (liveness === "indeterminate") {
			// Stall/unknown — the socket may be alive. A fallback here risks a DOUBLE
			// delivery, so finalize as failed WITHOUT touching deadFallback / mailbox.
			return { outcome: "failed", error: err };
		}
		// dead ⇒ proven non-delivery ⇒ same-lock one-shot re-resolve (lock still held).
		return await driveDeadFallback(plan, lock, deps);
	}
	// A completed RPC: ack ⇒ sent; in-band refusal ⇒ rejected, NO fallback.
	return { outcome: result.success ? "sent" : "rejected" };
}

/**
 * The dead-path fallback: re-resolve ONCE under the held lock, then run the resolver's
 * chosen plan exactly once (the retry is one-shot — a second connect failure does NOT
 * re-enter the fallback, it finalizes as failed). The hand only executes; the resolver
 * decided.
 */
async function driveDeadFallback(
	plan: ControlSocketPlan,
	lock: LockClaim,
	deps: ControlSocketSendDeps,
): Promise<SendDrive> {
	let resolution: DeadFallbackResolution;
	try {
		resolution = await deps.deadFallback(plan, lock);
	} catch (err) {
		return { outcome: "failed", error: err };
	}
	if (resolution.kind === "reject") {
		// N3: carry the resolver's reason out so the runner/surface can distinguish a
		// dormant-fire-forget / undeliverable / no-route reject from an in-band refusal.
		return { outcome: "rejected", rejectReason: resolution.reason };
	}
	const rePlan = resolution.plan;
	// Same-lock re-resolve invariant: the fallback plan MUST target the SAME gid the lock
	// is held for. A resolver that returns a DIFFERENT target's plan would send/enqueue to
	// B while only A's lock is ever released — a mis-route AND a lock leak. Fail loud (the
	// execute-level catch in executeControlSocketSend releases A's lock before rethrowing).
	if (rePlan.targetGardenId !== plan.targetGardenId || rePlan.targetGardenId !== lock.gardenId) {
		throw new Error(
			`entwurf-v2-send: re-resolve returned a plan for a different target (${rePlan.targetGardenId}) than the held lock (${lock.gardenId}) — same-lock re-resolve violated.`,
		);
	}
	switch (rePlan.transport) {
		case "control-socket":
			// Re-resolve picked another live socket — retry the send ONCE. A second
			// connect failure finalizes as failed (no further fallback).
			try {
				const r = await deps.sendOverSocket(rePlan);
				return { outcome: r.success ? "fallback-sent" : "rejected" };
			} catch (err) {
				return { outcome: "failed", error: err };
			}
		case "meta-mailbox":
			// Re-resolve picked the mailbox — enqueue ONCE via the injected helper. The
			// hand never reaches for the mailbox on its own; only the resolver routes here.
			try {
				const r = await deps.sendViaMailbox(rePlan, lock);
				return { outcome: r.success ? "fallback-sent" : "rejected" };
			} catch (err) {
				return { outcome: "failed", error: err };
			}
		case "spawn-bg":
			// A SEND fallback must never re-resolve into a spawn — that is a decider
			// contract violation (a send and a spawn are different actions), so fail loud
			// rather than silently mis-execute.
			throw new Error("entwurf-v2-send: re-resolve returned a spawn-bg plan for a send fallback (contract violation).");
		case "native-push":
			// The dead-control-socket fallback re-resolves only the pi socket domain
			// (control-socket / mailbox / spawn); it never routes the native-push rail. A
			// native-push rePlan here is structurally impossible — fail loud.
			throw new Error(
				"entwurf-v2-send: re-resolve returned a native-push plan for a send fallback (contract violation).",
			);
	}
}

/**
 * N1: a release failure AFTER a non-`failed` final outcome. The send already reached a
 * terminal result (`sent` / `fallback-sent` / `rejected`) — the delivery (or in-band
 * refusal) HAPPENED — but `releaseLock` then threw, so the lock is dirty. This is NOT a
 * send failure, and the caller MUST NOT re-dispatch (a re-send would double-deliver). A
 * structured error (not a bare rethrow) lets the 5d runner render "finalized + lock
 * dirty, retry-unsafe" distinctly from "send failed". For a `failed` outcome the original
 * send error still wins — that path never builds this error.
 */
export class SendDeliveredReleaseFailedError extends Error {
	readonly finalizedOutcome: Exclude<SendFinalOutcome, "failed">;
	readonly releaseError: unknown;
	constructor(finalizedOutcome: Exclude<SendFinalOutcome, "failed">, releaseError: unknown) {
		const detail = releaseError instanceof Error ? releaseError.message : String(releaseError);
		super(
			`entwurf-v2-send: ${finalizedOutcome} delivered but releaseLock failed (lock dirty, do NOT re-send): ${detail}`,
		);
		this.name = "SendDeliveredReleaseFailedError";
		this.finalizedOutcome = finalizedOutcome;
		this.releaseError = releaseError;
	}
}

/**
 * Fold the single send-final event into the reducer and release the lock if (and only
 * if) the reducer says so. On a `failed` outcome the lock is released FIRST and then
 * the original error is rethrown — and if `releaseLock` itself throws, the original
 * send error still wins (a release failure must not MASK the send failure; 5b). On a
 * NON-`failed` outcome a release failure throws a `SendDeliveredReleaseFailedError` (N1):
 * the delivery happened, so the runner must surface "finalized + lock dirty", not "failed".
 */
function finalizeRelease(policy: ReleasePolicy, deps: ControlSocketSendDeps, lock: LockClaim, drive: SendDrive): void {
	const initial: ReleaseState = initialReleaseState();
	const { shouldRelease } = reduceRelease(policy, initial, { kind: "send-final", outcome: drive.outcome });
	const original = drive.outcome === "failed" ? drive.error : undefined;

	if (shouldRelease) {
		try {
			deps.releaseLock(lock);
		} catch (releaseErr) {
			// A release failure must not swallow a real send failure.
			if (drive.outcome === "failed") throw original;
			// N1: the delivery/refusal already happened — surface it as a structured,
			// retry-unsafe error rather than a bare release throw.
			throw new SendDeliveredReleaseFailedError(drive.outcome, releaseErr);
		}
	}
	if (drive.outcome === "failed") throw original;
}
