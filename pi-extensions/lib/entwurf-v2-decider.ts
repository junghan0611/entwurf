/**
 * entwurf-v2-decider — the PURE dispatch decider for the unified `entwurf_v2` verb
 * (0.11 Stage 0 step 5b). It turns a caller's (target, intent, …) request plus
 * already-resolvable facts into a single `DispatchDecision`: either a reject
 * receipt, or an execute receipt + an `ExecutionPlan` + (for in-domain backends) a
 * held `LockClaim`. It performs NO transport: no send, no enqueue, no spawn, no
 * release-watcher. Step 5c executes the chosen plan; step 5d registers the MCP
 * surface. The decider only DECIDES.
 *
 * Why a separate pure module (step 4 discipline = gate-first → pure-before-IO →
 * wire): every IO surface the decision needs — the target lookup, the per-gid lock,
 * the lstat/connect socket inspection, the trust preflight, the capability registry
 * — is INJECTED via `DispatchDeciderDeps`, so the gate drives every branch with
 * fakes and the live wrappers wire the real fns. The plan is shaped so 5c's
 * transport hand consumes it WITHOUT re-deriving any path/arg (socketPath,
 * mailboxDir, sessionsDir, launchArgs are all planted here once — 4c "재유도 금지"):
 * the hand is a plan-keyed dispatcher, never a second brain. The two deliberate
 * exceptions (GPT힣 1차 검수): the spawned child's runtime pid is NOT in the plan
 * (it is born during 5c execution → it is the watcher's release-context, not a plan
 * input), and the launch identity (provider/model) is read by the 5c launcher from
 * the saved session JSONL (its existing authority) — putting that read in the
 * decider would make it impure. So the plan carries no provider/model.
 *
 * The frozen 7-step order (NEXT.md "통합 decider 순서"):
 *   1. requireGardenId   — runtime guard BEFORE any path is built (F2-P1; closes the
 *      MCP-schema bypass for pi-native/internal callers).
 *   2. resolveTarget     — no citizen → bad-target; quarantined (non-pi gid sharing
 *      a socket/symlink) → target-address-conflict. PROBE-FREE.
 *   3. backend           → isLivenessSupported.
 *   4. acquireLock       — IN-DOMAIN ONLY (？7), BEFORE lstat/connect, so the probe
 *      happens under the lock (the TOCTOU 5a's lock closes).
 *   5. in-domain         — inspectTargetControlSocket (lstat-then-connect, ？2) →
 *      resolveDispatch → on a resume verdict, preflight the target cwd (1B: deny →
 *      nonce-owned release → untrusted-fail-fast) → plan.
 *   6. unsupported       — NO lock; resolveMailboxDeliverability (self-fetch only,
 *      fail-closed) → resolveDispatch → meta-mailbox plan or reject.
 *   7. send-fail fallback is 5c's job (the decider decides ONCE; the held lock nonce
 *      is what lets 5c re-resolve at most once under the same claim).
 *
 * Every reject is minted through `makeRejectReceipt` (？6 chokepoint) — the decider
 * never hand-assembles a `{ok:false, …}` literal, so the pre-probe-null rule cannot
 * be bypassed.
 */

import { isNonPiGardenIdSocketConflict } from "./entwurf-facts.ts";
import type { PreflightOutcome } from "./entwurf-preflight.ts";
import {
	type EntwurfIntent,
	type EntwurfV2Receipt,
	isLivenessSupported,
	makeRejectReceipt,
	resolveDispatch,
} from "./entwurf-v2-contract.ts";
import {
	type AcquireLockResult,
	acquireLock as defaultAcquireLock,
	releaseLock as defaultReleaseLock,
	type LockClaim,
} from "./entwurf-v2-lock.ts";
import {
	defaultMetaMailboxDir,
	defaultMetaSessionsDir,
	type MetaBackendV2,
	type MetaCapability,
	type MetaIdentity,
	metaCapabilityFor,
} from "./meta-session.ts";
import { isValidSessionId } from "./session-id.js";
import {
	controlSocketPath,
	inspectTargetControlSocket as defaultInspectSocket,
	type TargetSocketInspection,
} from "./socket-discovery.ts";
import { probeSocketLiveness, type SocketLiveness } from "./socket-probe.ts";

// Re-export the shared conflict predicate so producers of a TargetResolution have a
// single import site for it (it is the SAME fn the fact-provider listing uses).
export { isNonPiGardenIdSocketConflict };

// ── observe timeout (？3) ───────────────────────────────────────────────────
// The bounded wait 5c's release-watcher gives a spawned child to surface its
// control socket / exit. Planted into the resume plan so the hand does not invent
// a timeout. A standalone constant + env override (NOT a multiple of the probe
// timeout — a different concern); 30s initial, tunable to 45s after live data.
export const ENTWURF_V2_OBSERVE_TIMEOUT_MS = ((): number => {
	const raw = process.env.ENTWURF_V2_OBSERVE_TIMEOUT_MS;
	const n = raw !== undefined && raw !== "" ? Number(raw) : Number.NaN;
	return Number.isFinite(n) && n > 0 ? n : 30_000;
})();

export const ENTWURF_V2_MODE_DEFAULT = "follow_up" as const;

// ── receipt branch aliases ──────────────────────────────────────────────────
export type SuccessReceipt = Extract<EntwurfV2Receipt, { ok: true }>;
export type RejectReceipt = Extract<EntwurfV2Receipt, { ok: false }>;
export type EntwurfV2Mode = "steer" | "follow_up";

// ── ExecutionPlan (5c-consumable, no re-derivation) ─────────────────────────
// Each plan kind carries every value 5c's transport fn needs, planted once by the
// decider. control-socket send and meta-mailbox send carry the message; spawn-bg
// resume carries the launch inputs MINUS provider/model (D4: 5c-owned identity
// read) and MINUS the child pid (born at execution, watcher's release-context).
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
	| {
			transport: "spawn-bg";
			action: "resume";
			targetGardenId: string;
			sessionId: string;
			cwd: string;
			prompt: string;
			launchArgs: readonly string[];
			expectedSocketPath: string;
			observeTimeoutMs: number;
			releaseWhen: "socket-alive-or-child-exited";
	  };

// ── DispatchDecision (the decider's only output) ────────────────────────────
// reject ⇒ NO plan AND NO retained lock (any acquired lock was released before
// return). execute ⇒ a plan + a receipt whose transport matches plan.transport;
// `lock` is non-null for an in-domain execute (control-socket send OR spawn-bg
// resume — both keep the claim so 5c's at-most-once re-resolve runs under the same
// nonce) and null for the lock-free meta-mailbox path (？7).
export type DispatchDecision =
	| { kind: "reject"; receipt: RejectReceipt }
	| { kind: "execute"; receipt: SuccessReceipt; plan: ExecutionPlan; lock: LockClaim | null };

// ── target resolution (E: single-target, not a whole-store scan) ────────────
// A non-null identity is an existing citizen. `preProbeAddressConflict` is the
// PROBE-FREE, record-side conflict (non-pi gid sharing a real/symlinked socket —
// isNonPiGardenIdSocketConflict). The production wrapper computes it with a single
// readMetaIdentityByGardenId + a target socket/symlink check; the gate injects it.
// Do NOT call listEntwurfFacts here to find the target — its socket probe would run
// before the lock (the 1C TOCTOU). The shared predicate is the only thing the
// listing and the dispatch share.
export interface TargetResolution {
	identity: MetaIdentity | null;
	preProbeAddressConflict: boolean;
}

export interface DispatchInput {
	target: string;
	intent: EntwurfIntent;
	mode?: EntwurfV2Mode;
	wantsReply?: boolean;
	message: string;
}

export interface DispatchDeciderDeps {
	resolveTarget: (gardenId: string) => TargetResolution | Promise<TargetResolution>;
	acquireLock?: (gardenId: string) => AcquireLockResult;
	releaseLock?: (claim: LockClaim) => unknown;
	inspectSocket?: (gardenId: string) => Promise<TargetSocketInspection>;
	probeSocket?: (socketPath: string) => Promise<SocketLiveness>;
	preflightForCwd: (cwd: string) => PreflightOutcome;
	capabilityFor?: (backend: MetaBackendV2) => MetaCapability;
	controlDir?: string;
	mailboxDir?: string;
	sessionsDir?: string;
	observeTimeoutMs?: number;
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
 * Mailbox deliverability (？0 frozen): ONLY a self-fetch backend (claude-code) has a
 * drainable meta-bridge mailbox. direct-inject backends (codex/agy/pi) are
 * fail-closed to `mailbox-undeliverable` — that is intended, not a gap (the 0.10.0
 * mailbox + doorbell is a self-fetch drain; direct-inject drain is an unproven
 * capability). Do NOT widen by deliveryLevel — only by a real per-backend predicate.
 */
export function resolveMailboxDeliverability(
	identity: MetaIdentity,
	capabilityFor: (backend: MetaBackendV2) => MetaCapability = metaCapabilityFor,
): boolean {
	return capabilityFor(identity.backend).wakeMode === "self-fetch";
}

/**
 * Map an in-domain target's socket inspection to either a measured `SocketLiveness`
 * (to feed resolveDispatch) or a pre-probe address-conflict signal. `absent` (ENOENT
 * only) is the honest `dead` (the citizen is dormant; its canonical socket is the
 * path a resume will create). `socket-file` is the only case we connect on.
 * `address-conflict` (symlink / not-a-socket) and `indeterminate` never connect.
 */
async function livenessFromInspection(
	inspection: TargetSocketInspection,
	probeSocket: (socketPath: string) => Promise<SocketLiveness>,
): Promise<{ liveness: SocketLiveness; socketPath: string } | { addressConflict: true }> {
	switch (inspection.kind) {
		case "absent":
			return { liveness: "dead", socketPath: inspection.socketPath };
		case "socket-file": {
			const liveness = await probeSocket(inspection.socketPath);
			return { liveness, socketPath: inspection.socketPath };
		}
		case "indeterminate":
			return { liveness: "indeterminate", socketPath: inspection.socketPath };
		case "address-conflict":
			return { addressConflict: true };
	}
}

/**
 * The pure dispatch decider. See the module header for the 7-step contract. Async
 * only because the socket inspection/probe are async; it touches the filesystem
 * ONLY through injected deps.
 */
export async function decideDispatch(input: DispatchInput, deps: DispatchDeciderDeps): Promise<DispatchDecision> {
	const acquireLock = deps.acquireLock ?? ((gid: string) => defaultAcquireLock(gid, { dir: undefined }));
	const releaseLock = deps.releaseLock ?? ((claim: LockClaim) => defaultReleaseLock(claim));
	const inspectSocket = deps.inspectSocket ?? ((gid: string) => defaultInspectSocket(gid, deps.controlDir));
	const probeSocket = deps.probeSocket ?? ((p: string) => probeSocketLiveness(p));
	const capabilityFor = deps.capabilityFor ?? metaCapabilityFor;
	const mailboxDir = deps.mailboxDir ?? defaultMetaMailboxDir();
	const sessionsDir = deps.sessionsDir ?? defaultMetaSessionsDir();
	const observeTimeoutMs = deps.observeTimeoutMs ?? ENTWURF_V2_OBSERVE_TIMEOUT_MS;
	const mode: EntwurfV2Mode = input.mode ?? ENTWURF_V2_MODE_DEFAULT;
	const wantsReply = input.wantsReply ?? false;

	const reject = (receipt: RejectReceipt): DispatchDecision => ({ kind: "reject", receipt });

	// 1. requireGardenId — BEFORE any path is built.
	const gardenId = requireGardenId(input.target);

	// 2. resolveTarget — probe-free. no citizen → bad-target; quarantined → conflict.
	const resolution = await deps.resolveTarget(gardenId);
	if (resolution.identity === null) {
		return reject(makeRejectReceipt("bad-target", null));
	}
	if (resolution.preProbeAddressConflict) {
		return reject(makeRejectReceipt("target-address-conflict", null));
	}
	const identity = resolution.identity;

	// 3. backend.
	if (!isLivenessSupported(identity.backend)) {
		// 6. unsupported path — NO lock (？7). mailbox mini-table via resolveDispatch.
		const deliverable = resolveMailboxDeliverability(identity, capabilityFor);
		const receipt = resolveDispatch(input.intent, "unsupported", deliverable);
		if (!receipt.ok) return reject(receipt);
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

	// 4. in-domain → acquire the per-gid lock BEFORE lstat/connect.
	const acq = acquireLock(gardenId);
	if (!acq.ok) {
		return reject(makeRejectReceipt("target-locked", null));
	}
	const lock = acq.claim;

	// Helper: release the held lock, then return a reject decision.
	const rejectAfterRelease = (receipt: RejectReceipt): DispatchDecision => {
		releaseLock(lock);
		return reject(receipt);
	};

	// 5. under the lock: inspect the socket (lstat-then-connect), then route.
	const inspection = await inspectSocket(gardenId);
	const mapped = await livenessFromInspection(inspection, probeSocket);
	if ("addressConflict" in mapped) {
		return rejectAfterRelease(makeRejectReceipt("target-address-conflict", null));
	}
	const { liveness, socketPath } = mapped;

	const receipt = resolveDispatch(input.intent, liveness, false);
	if (!receipt.ok) {
		// resolver reject (owned-live-no-autosend / indeterminate-no-spawn / …) — the
		// lock was for an in-domain probe that yielded no execute, so release it.
		return rejectAfterRelease(receipt);
	}

	if (receipt.action === "resume") {
		// 1B: preflight runs ONLY here (the sole branch that launches a child into a
		// target cwd). deny → nonce-owned release → untrusted-fail-fast, with the
		// honest measured liveness (dormant = the `dead` we just probed).
		const outcome = deps.preflightForCwd(identity.cwd);
		if (outcome.kind === "deny") {
			return rejectAfterRelease(makeRejectReceipt("untrusted-fail-fast", liveness));
		}
		const plan: ExecutionPlan = {
			transport: "spawn-bg",
			action: "resume",
			targetGardenId: gardenId,
			sessionId: gardenId, // D3: gid is the pi resume authority, not nativeSessionId.
			cwd: identity.cwd,
			prompt: input.message,
			launchArgs: outcome.launchArgs,
			expectedSocketPath: socketPath,
			observeTimeoutMs,
			releaseWhen: "socket-alive-or-child-exited",
		};
		return { kind: "execute", receipt, plan, lock };
	}

	// receipt.action === "send" → control-socket send (lock kept for 5c re-resolve).
	const plan: ExecutionPlan = {
		transport: "control-socket",
		action: "send",
		targetGardenId: gardenId,
		socketPath,
		mode,
		wantsReply,
		message: input.message,
	};
	return { kind: "execute", receipt, plan, lock };
}

/** The canonical control-socket path for a target — re-exported so a production
 * resolveTarget/wrapper plants the SAME path the decider/plan use (no drift). */
export { controlSocketPath };
