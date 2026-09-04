/**
 * entwurf-v2-decider — the PURE dispatch decider for the unified `entwurf_v2` verb
 * (0.11 Stage 0 step 5b). It turns a caller's (target, intent, …) request plus
 * already-resolvable facts into a single `DispatchDecision`: either a reject
 * receipt, or an execute receipt + an `ExecutionPlan` + (for in-domain backends) a
 * held `LockClaim`. It performs NO transport: no send, no enqueue, no release-watcher.
 * Step 5c executes the chosen plan; step 5d registers the MCP surface. The decider
 * only DECIDES.
 *
 * Since the visible-first cut (contract header) this module also starts NO process:
 * the resume verdict, its trust preflight, and the detached spawn-bg plan are gone.
 * Every plan it can emit now targets a citizen that is already running.
 *
 * Why a separate pure module (step 4 discipline = gate-first → pure-before-IO →
 * wire): every IO surface the decision needs — the target lookup, the per-gid lock,
 * the lstat/connect socket inspection, the mailbox-deliverability seam — is INJECTED
 * via `DispatchDeciderDeps`, so the gate drives every branch with fakes and the live
 * wrappers wire the real fns. The plan is shaped so 5c's transport hand consumes it
 * WITHOUT re-deriving any path/arg (socketPath, mailboxDir, sessionsDir are all
 * planted here once — 4c "재유도 금지"): the hand is a plan-keyed dispatcher, never a
 * second brain.
 *
 * The frozen 7-step order (NEXT.md "통합 decider 순서"):
 *   1. requireGardenId   — runtime guard BEFORE any path is built (F2-P1; closes the
 *      MCP-schema bypass for pi-native/internal callers).
 *   2. resolveTarget     — no citizen → bad-target; a record-less control socket →
 *      record-less-socket (#50 C4: the record is the sole address authority);
 *      quarantined (out-of-socket-domain record sharing a socket/symlink) → target-address-conflict.
 *      PROBE-FREE.
 *   3. backend           → isLivenessSupported.
 *   4. acquireLock       — IN-DOMAIN ONLY (？7), BEFORE lstat/connect, so the probe
 *      happens under the lock (the TOCTOU 5a's lock closes).
 *   5. in-domain         — inspectTargetControlSocket (lstat-then-connect, ？2) →
 *      resolveDispatch → control-socket send plan, or a reject that releases the lock.
 *   6. unsupported       — NO lock; deps.mailboxDeliverabilityFor (REQUIRED seam: wake-mode
 *      capability AND a live active-receiver, fail-closed) → resolveDispatch → meta-mailbox
 *      plan or reject. SE-2 2d-3: a terminated/drifted self-fetch citizen is refused, never
 *      enqueued as mailbox garbage.
 *   7. send-fail fallback is 5c's job (the decider decides ONCE; the held lock nonce
 *      is what lets 5c re-resolve at most once under the same claim).
 *
 * Every reject is minted through `makeRejectReceipt` (？6 chokepoint) — the decider
 * never hand-assembles a `{ok:false, …}` literal, so the pre-probe-null rule cannot
 * be bypassed.
 */

import type { MailboxDeliverabilityResult } from "./entwurf-deliverability.ts";
import { isOutOfSocketDomainGardenIdConflict } from "./entwurf-facts.ts";
import {
	type EntwurfIntent,
	type EntwurfV2Receipt,
	isLivenessSupported,
	makeRejectReceipt,
	type NativePushBackend,
	nativePushSupported,
	resolveDispatch,
	resolveNativePushDispatch,
} from "./entwurf-v2-contract.ts";
import type { AcquireLockResult, LockClaim, LockConflict } from "./entwurf-v2-lock.ts";
import {
	defaultMetaMailboxDir,
	defaultMetaSessionsDir,
	type MetaCapability,
	type MetaCitizenBackend,
	type MetaIdentity,
	metaCapabilityFor,
} from "./meta-session.ts";
import type { NativePushProbeResult, NativePushRoute } from "./native-push/adapter.ts";
import { isValidSessionId } from "./session-id.js";
import { controlSocketPath, mapInspectionToLiveness, type TargetSocketInspection } from "./socket-discovery.ts";
import type { SocketLiveness } from "./socket-probe.ts";

// Re-export the shared conflict predicate so producers of a TargetResolution have a
// single import site for it (it is the SAME fn the fact-provider listing uses).
export { isOutOfSocketDomainGardenIdConflict };

export const ENTWURF_V2_MODE_DEFAULT = "follow_up" as const;

// ── receipt branch aliases ──────────────────────────────────────────────────
export type SuccessReceipt = Extract<EntwurfV2Receipt, { ok: true }>;
export type RejectReceipt = Extract<EntwurfV2Receipt, { ok: false }>;
export type EntwurfV2Mode = "steer" | "follow_up";

// ── ExecutionPlan (5c-consumable, no re-derivation) ─────────────────────────
// Each plan kind carries every value 5c's transport fn needs, planted once by the
// decider. Every remaining kind is a SEND to an already-running citizen: the
// spawn-bg resume plan (launch inputs, expected socket path, observe timeout) went
// with the transport in the visible-first cut.
export type ExecutionPlan =
	| {
			transport: "control-socket";
			action: "send";
			targetGardenId: string;
			socketPath: string;
			mode: EntwurfV2Mode;
			wantsReply: boolean;
			message: string;
	  }
	| {
			transport: "meta-mailbox";
			action: "send";
			targetGardenId: string;
			mailboxDir: string;
			sessionsDir: string;
			wantsReply: boolean;
			message: string;
	  }
	// native-push send (봉인 4): direct-inject into a live app-server conversation. LOCK-FREE
	// (the DispatchDecision carries lock:null). Carries the decider-probed VOLATILE route so
	// the executor sends without re-deriving it (봉인 3 "used within the same dispatch"); the
	// executor still owns the 1-shot re-probe→re-send on failure. `backend` lets the executor
	// resolve the adapter for that re-probe.
	| {
			transport: "native-push";
			action: "send";
			targetGardenId: string;
			backend: NativePushBackend;
			nativeSessionId: string;
			route: NativePushRoute;
			wantsReply: boolean;
			message: string;
	  };

// ── DispatchDecision (the decider's only output) ────────────────────────────
// reject ⇒ NO plan AND NO retained lock (any acquired lock was released before
// return). execute ⇒ a plan + a receipt whose transport matches plan.transport;
// `lock` is non-null for an in-domain execute (the control-socket send keeps the
// claim so 5c's at-most-once re-resolve runs under the same nonce) and null for the
// lock-free meta-mailbox path (？7).
//
// A reject's optional machine-readable diagnostic, riding ALONGSIDE the receipt — the
// receipt schema is unchanged and 5d's surface renders the diagnostic onto the reject.
// Two kinds, both here for the same reason: the evidence that decided the reject was
// produced one layer down and would otherwise be dropped at this boundary, leaving the
// caller a verdict with no way to see or clear its cause (F2-P2 "관측 가능해야 수용").
//
//   target-locked         the `LockConflict` (holder pid/host/createdAt, lockPath, human
//                         detail) the lock primitive produced on contention. B3: without
//                         it a PID-reuse permanent lock could not be observed/cleared.
//   mailbox-undeliverable WHICH receiver axis failed, in the deliverability predicate's own
//                         words — no backing record vs. a dead owner vs. a watch that is no
//                         longer armed are three different situations with three different
//                         fixes, and the bare `mailbox-undeliverable` reason told a caller
//                         none of them (#101 갭 C). The predicate already computes the
//                         sentence; this carries it instead of discarding it.
export type RejectDiagnostic =
	| { kind: "target-locked"; conflict: LockConflict }
	| { kind: "mailbox-undeliverable"; reason: string };

export type DispatchDecision =
	| { kind: "reject"; receipt: RejectReceipt; diagnostic?: RejectDiagnostic }
	| { kind: "execute"; receipt: SuccessReceipt; plan: ExecutionPlan; lock: LockClaim | null };

// ── target resolution (E: single-target, not a whole-store scan) ────────────
// A non-null identity is an existing citizen. `preProbeAddressConflict` is the
// PROBE-FREE record-side conflict: a backend outside the control-socket domain
// sharing a real/symlinked socket (`isOutOfSocketDomainGardenIdConflict`). Production uses one
// readMetaIdentityByGardenId + a target socket/symlink check; the gate injects it.
// Do NOT call listEntwurfFacts here to find the target — its socket probe would run
// before the lock (the 1C TOCTOU). The shared predicate is the only thing the
// listing and the dispatch share.
export interface TargetResolution {
	identity: MetaIdentity | null;
	preProbeAddressConflict: boolean;
	/**
	 * #50 C4: a record-LESS gid whose canonical control socket exists as a confirmed
	 * non-symlink socket file (a single PROBE-FREE lstat — `isRecordLessSocketCandidate`).
	 * The record is the sole address authority, so this is NOT an addressable citizen:
	 * the decider rejects it pre-probe as `record-less-socket` — a diagnostic
	 * state named honestly, never the `bad-target` "absent" lie (something real answers
	 * to the gid) and never a dispatchable endpoint (the retired A1 narrow). Only
	 * meaningful when `identity === null`; a record-backed citizen never sets it.
	 */
	recordLessSocket?: boolean;
}

export interface DispatchInput {
	target: string;
	intent: EntwurfIntent;
	mode?: EntwurfV2Mode;
	wantsReply?: boolean;
	message: string;
}

// Every IO seam is a REQUIRED dep (no default): the decider performs ZERO IO of its
// own. The live wrappers (5c) wire the real fns; the gate injects fakes. This is what
// makes "pure decider" honest — there is no hidden default that touches `~/.pi`. (B1:
// the removed `acquireLock` default hardcoded `{ dir: undefined }` → it ignored any
// injected lock dir and leaked the per-gid lock to the real `~/.pi/entwurf-v2-locks`
// whenever a caller/test wired the other dirs but relied on the lock default.) The
// mailbox-deliverability seam is required too (SE-2 2d-3): it carries the active-receiver
// judgement, so leaving a wake-mode-only default would let a caller skip it and re-open the
// gap. Only pure config (plan-planted dirs, the observe timeout) keeps a default — it is
// data, not an IO seam.
export interface DispatchDeciderDeps {
	resolveTarget: (gardenId: string) => TargetResolution | Promise<TargetResolution>;
	acquireLock: (gardenId: string) => AcquireLockResult;
	releaseLock: (claim: LockClaim) => unknown;
	inspectSocket: (gardenId: string) => Promise<TargetSocketInspection>;
	probeSocket: (socketPath: string) => Promise<SocketLiveness>;
	// MaybePromise (0.12.1 B-2): production lazy-imports the pi-coding-agent-backed
	/**
	 * SE-2 slice 2d-3: the REQUIRED mailbox-deliverability seam (no default). The decider
	 * does NOT judge deliverability itself — it asks this injected fn, which combines the
	 * backend wake-mode capability (only self-fetch has a drainable mailbox) with the LIVE
	 * active-receiver check (a presence marker that matches the target identity). Making it
	 * required is the whole point: every call site is forced by the compiler to wire the
	 * active-receiver axis, so no future caller can silently fall back to wake-mode-only and
	 * reopen the SE-2 "enqueue garbage into a terminated session's mailbox" gap.
	 */
	mailboxDeliverabilityFor: (
		identity: MetaIdentity,
	) => MailboxDeliverabilityResult | Promise<MailboxDeliverabilityResult>;
	/**
	 * 봉인 4: the native-push liveness+route probe seam (REQUIRED, no default). Called ONLY on
	 * the native-push branch (a nativePushSupported backend, e.g. antigravity), it returns the
	 * adapter probe result — the 3-value liveness the NATIVE_PUSH table routes on PLUS the
	 * volatile route the executor sends over. The decider does NOT probe itself (purity); the
	 * production wrapper resolves the native-push adapter and calls its probe. Making it
	 * required forces every construction site to wire it, so a native-push dispatch can never
	 * silently fall through to the pi-socket / mailbox path.
	 */
	nativePushProbe: (identity: MetaIdentity) => NativePushProbeResult | Promise<NativePushProbeResult>;
	mailboxDir?: string;
	sessionsDir?: string;
}

/**
 * F2-P1 defense in depth: never build a lock/socket path from an unvalidated gid.
 * The MCP TypeBox pattern guards that one surface; a pi-native / internal caller
 * bypasses the schema, so the decider re-validates as its very first step.
 */
function requireGardenId(target: string): string {
	if (!isValidSessionId(target)) {
		throw new Error(`entwurf_v2 decider: refusing to dispatch to an invalid garden id (${JSON.stringify(target)}).`);
	}
	return target;
}

/**
 * Mailbox WAKE-MODE capability (？0 frozen): ONLY a self-fetch backend (claude-code) has a
 * drainable meta-bridge mailbox. direct-inject backends (codex/agy/pi) are fail-closed —
 * that is intended, not a gap (the 0.10.0 mailbox + doorbell is a self-fetch drain;
 * direct-inject drain is an unproven capability). Do NOT widen by deliveryLevel — only by
 * a real per-backend predicate.
 *
 * This is the CAPABILITY HALF of deliverability only. Full mailbox deliverability ALSO
 * requires a live active-receiver (a presence marker matching the identity) — that
 * conjunction lives in the required `mailboxDeliverabilityFor` seam (SE-2 slice 2d-3). The
 * decider NEVER calls this helper directly: deliverability flows exclusively through the
 * seam so the active-receiver axis can never be skipped. Kept as a named, gate-pinned
 * helper for the production seam to compose and for capability-only call sites.
 */
export function resolveMailboxWakeModeCapability(
	identity: MetaIdentity,
	capabilityFor: (backend: MetaCitizenBackend) => MetaCapability = metaCapabilityFor,
): boolean {
	return capabilityFor(identity.backend).wakeMode === "self-fetch";
}

/**
 * The pure dispatch decider. See the module header for the 7-step contract. Async
 * only because the socket inspection/probe are async; it touches the filesystem
 * ONLY through injected deps.
 */
export async function decideDispatch(input: DispatchInput, deps: DispatchDeciderDeps): Promise<DispatchDecision> {
	const mailboxDir = deps.mailboxDir ?? defaultMetaMailboxDir();
	const sessionsDir = deps.sessionsDir ?? defaultMetaSessionsDir();
	const mode: EntwurfV2Mode = input.mode ?? ENTWURF_V2_MODE_DEFAULT;
	const wantsReply = input.wantsReply ?? false;
	const ctx: InDomainCtx = { mode, wantsReply };

	const reject = (receipt: RejectReceipt, diagnostic?: RejectDiagnostic): DispatchDecision =>
		diagnostic ? { kind: "reject", receipt, diagnostic } : { kind: "reject", receipt };

	// 1. requireGardenId — BEFORE any path is built.
	const gardenId = requireGardenId(input.target);

	// 2. resolveTarget — probe-free. no citizen → bad-target; quarantined → conflict.
	const resolution = await deps.resolveTarget(gardenId);

	// 2b. #50 C4: a record-LESS control socket is NOT an addressable citizen. The record
	// is the sole address authority (목표 ②), so EVERY intent is refused pre-probe with
	// `record-less-socket` — a diagnostic state named honestly. NOT `bad-target`
	// (something real answers to this gid; "absent" would hide the state the reject exists
	// to surface), and no lock/probe runs (no citizen ⇒ nothing in-domain to measure).
	// The retired A1 narrow used to route this through the probe table as a dispatchable
	// socket-only endpoint; that acceptance is gone with the socket identity axis.
	if (resolution.identity === null && resolution.recordLessSocket === true) {
		return reject(makeRejectReceipt("record-less-socket", null));
	}

	// 2c. no citizen → bad-target; quarantined → conflict.
	if (resolution.identity === null) {
		return reject(makeRejectReceipt("bad-target", null));
	}
	if (resolution.preProbeAddressConflict) {
		return reject(makeRejectReceipt("target-address-conflict", null));
	}
	const identity = resolution.identity;

	// 2d. native-push rail (봉인 4): a native-push backend (antigravity) is measured by its
	// adapter probe, NOT the pi socket and NOT the mailbox. Intercept it HERE — after identity
	// resolution + the address-conflict guard, but BEFORE the unsupported mailbox branch — so
	// agy routes to native-push and never falls through to a mailbox it does not have. This
	// branch is LOCK-FREE (봉인 4): the pi in-domain lock closes a socket TOCTOU, but a
	// volatile probe route has no lock meaning (a duplicate-send idempotency is a D8 future).
	if (nativePushSupported(identity.backend)) {
		const probe = await deps.nativePushProbe(identity);
		const receipt = resolveNativePushDispatch(input.intent, probe.status);
		if (!receipt.ok) return reject(receipt);
		// The ONLY allow cell is fire-and-forget × alive, so an ok receipt ⟹ the probe is
		// alive and carries a route. The narrow is defensive: a contract-breaking probe/table
		// mismatch fails loud rather than planting a routeless send plan.
		if (probe.status !== "alive") {
			throw new Error(
				"entwurf_v2 decider: native-push send verdict without an alive probe route (contract invariant broken).",
			);
		}
		const plan: ExecutionPlan = {
			transport: "native-push",
			action: "send",
			targetGardenId: gardenId,
			backend: identity.backend,
			nativeSessionId: identity.nativeSessionId,
			route: probe.route,
			wantsReply,
			message: input.message,
		};
		return { kind: "execute", receipt, plan, lock: null };
	}

	// 3. backend.
	if (!isLivenessSupported(identity.backend)) {
		// 6. unsupported path — NO lock (？7). Deliverability comes from the REQUIRED seam
		// (wake-mode capability AND a live active-receiver marker matching this identity),
		// NOT a wake-mode-only helper — so a terminated self-fetch citizen's mailbox is
		// fail-closed (SE-2 2d-3). resolveDispatch then routes intent × deliverable.
		const deliverability = await deps.mailboxDeliverabilityFor(identity);
		const receipt = resolveDispatch(input.intent, "unsupported", deliverability.deliverable);
		// The predicate's reason travels with the reject (#101 갭 C). It is attached only when
		// undeliverability is what produced the reject — an intent-shaped refusal on a
		// DELIVERABLE target must not be dressed up as a receiver problem.
		if (!receipt.ok) {
			return deliverability.deliverable
				? reject(receipt)
				: reject(receipt, { kind: "mailbox-undeliverable", reason: deliverability.reason });
		}
		// the only allow cell here is fire-and-forget → meta-mailbox send.
		const plan: ExecutionPlan = {
			transport: "meta-mailbox",
			action: "send",
			targetGardenId: gardenId,
			mailboxDir,
			sessionsDir,
			wantsReply,
			message: input.message,
		};
		return { kind: "execute", receipt, plan, lock: null };
	}

	// 4-5. control-socket domain (currently backend pi): lock → inspect → route.
	return decideInDomain(gardenId, input, deps, ctx);
}

// ── control-socket-domain probe (steps 4-5; currently backend pi). Every target
// is record-backed; a record-less socket rejects before this branch. ────────────
// The lock lifecycle (B2) lives here: acquire BEFORE lstat/connect, every reject path
// releases explicitly (rejectAfterRelease), every execute path that keeps the lock sets
// retainLock=true, and a thrown IO error releases the still-held lock before rethrowing so
// the long-lived MCP bridge never pins a gid.
type InDomainCtx = { mode: EntwurfV2Mode; wantsReply: boolean };

async function decideInDomain(
	gardenId: string,
	input: DispatchInput,
	deps: DispatchDeciderDeps,
	ctx: InDomainCtx,
): Promise<DispatchDecision> {
	const { acquireLock, releaseLock, inspectSocket, probeSocket } = deps;

	// 4. acquire the per-gid lock BEFORE lstat/connect.
	const acq = acquireLock(gardenId);
	if (!acq.ok) {
		// B3: carry the lock's holder evidence (pid/host/createdAt + lockPath) as a
		// diagnostic so a permanently-held gid is observable/clearable. The receipt
		// stays pre-probe-null; the conflict rides alongside it.
		return {
			kind: "reject",
			receipt: makeRejectReceipt("target-locked", null),
			diagnostic: { kind: "target-locked", conflict: acq.conflict },
		};
	}
	const lock = acq.claim;

	const rejectAfterRelease = (receipt: RejectReceipt): DispatchDecision => {
		releaseLock(lock);
		return { kind: "reject", receipt };
	};

	let retainLock = false;
	try {
		// 5. under the lock: inspect the socket (lstat-then-connect), then route.
		const inspection = await inspectSocket(gardenId);
		const mapped = await mapInspectionToLiveness(inspection, probeSocket);
		if ("addressConflict" in mapped) {
			return rejectAfterRelease(makeRejectReceipt("target-address-conflict", null));
		}
		const { liveness, socketPath } = mapped;

		const receipt = resolveDispatch(input.intent, liveness, false);
		if (!receipt.ok) {
			// resolver reject (dormant-fire-forget-unsupported / indeterminate-no-spawn) —
			// the lock was for an in-domain probe that yielded no execute, so release it.
			return rejectAfterRelease(receipt);
		}

		// `send` is the only action this table can return since the visible-first cut, so
		// there is exactly one execute shape here → control-socket send (lock kept for the
		// 5c re-resolve). The resume branch that used to sit above this — preflight the
		// target cwd, then plan a detached spawn-bg child — is gone with the transport.
		const plan: ExecutionPlan = {
			transport: "control-socket",
			action: "send",
			targetGardenId: gardenId,
			socketPath,
			mode: ctx.mode,
			wantsReply: ctx.wantsReply,
			message: input.message,
		};
		retainLock = true;
		return { kind: "execute", receipt, plan, lock };
	} catch (err) {
		if (!retainLock) {
			try {
				releaseLock(lock);
			} catch {
				// best-effort: a release failure must NOT mask the original throw.
			}
		}
		throw err;
	}
}

/** The canonical control-socket path for a target — re-exported so a production
 * resolveTarget/wrapper plants the SAME path the decider/plan use (no drift). */
export { controlSocketPath };
