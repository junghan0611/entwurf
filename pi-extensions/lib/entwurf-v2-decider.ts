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
 * the lstat/connect socket inspection, the trust preflight, the mailbox-deliverability
 * seam — is INJECTED via `DispatchDeciderDeps`, so the gate drives every branch with
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
import { isNonPiGardenIdSocketConflict } from "./entwurf-facts.ts";
import type { PreflightOutcome } from "./entwurf-preflight.ts";
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
	type MetaBackendV2,
	type MetaCapability,
	type MetaIdentity,
	metaCapabilityFor,
} from "./meta-session.ts";
import type { NativePushProbeResult, NativePushRoute } from "./native-push/adapter.ts";
import { isValidSessionId } from "./session-id.js";
import { controlSocketPath, mapInspectionToLiveness, type TargetSocketInspection } from "./socket-discovery.ts";
import type { SocketLiveness } from "./socket-probe.ts";

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
			// wantsReply rides the plan so the dormant rail's <sender_info> carries the
			// same wants_reply etiquette marker a live socket delivery renders (#50 F2).
			// mode stays live-injection-only (meaningless for a resume prompt).
			wantsReply: boolean;
			launchArgs: readonly string[];
			expectedSocketPath: string;
			observeTimeoutMs: number;
			releaseWhen: "socket-alive-or-child-exited";
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
// `lock` is non-null for an in-domain execute (control-socket send OR spawn-bg
// resume — both keep the claim so 5c's at-most-once re-resolve runs under the same
// nonce) and null for the lock-free meta-mailbox path (？7).
//
// A reject's optional machine-readable diagnostic. Only `target-locked` carries one:
// the `LockConflict` (holder pid/host/createdAt, lockPath, human detail) the lock
// primitive produced on contention. It rides ALONGSIDE the receipt — the receipt
// schema is unchanged; 5d's surface renders it onto the reject. (B3: without this the
// holder evidence was dropped at the decider boundary, so a PID-reuse permanent lock
// could not be observed/cleared — F2-P2 "관측 가능해야 수용".)
export type RejectDiagnostic = { kind: "target-locked"; conflict: LockConflict };

export type DispatchDecision =
	| { kind: "reject"; receipt: RejectReceipt; diagnostic?: RejectDiagnostic }
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
	/**
	 * A1 narrow (0.11.0): a record-LESS but live-control-socket-present pi endpoint.
	 * `identity` is null (there is NO meta-record citizen), yet a gid-shaped non-symlink
	 * control socket exists, so the gid is an addressable socket-only pi endpoint. The decider
	 * routes EVERY intent through the same in-domain probe table under `allowResume:false` (it
	 * does NOT pre-reject non-fire-and-forget — a live, addressable citizen must never be the
	 * `bad-target` "absent" lie). With no record there is no cwd/resume authority, so spawn-bg
	 * can never open: owned-outcome × live → owned-live-no-autosend (honest table verdict),
	 * owned-outcome × dormant → socket-only-no-resume-authority (the post-probe allowResume:false
	 * guard). PROBE-FREE presence hint — the decider still does the real under-lock
	 * `inspectSocket`. Only meaningful when `identity === null`; a record-backed citizen never sets it.
	 */
	socketOnlyPi?: boolean;
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
	// preflight via `await import()` so the harness-neutral bridge boots pi-free;
	// only the owned-outcome resume branch (below) awaits it. Sync test fakes that
	// return a plain PreflightOutcome still satisfy this.
	preflightForCwd: (cwd: string) => PreflightOutcome | Promise<PreflightOutcome>;
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
	capabilityFor: (backend: MetaBackendV2) => MetaCapability = metaCapabilityFor,
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
	const observeTimeoutMs = deps.observeTimeoutMs ?? ENTWURF_V2_OBSERVE_TIMEOUT_MS;
	const mode: EntwurfV2Mode = input.mode ?? ENTWURF_V2_MODE_DEFAULT;
	const wantsReply = input.wantsReply ?? false;
	const ctx: InDomainCtx = { mode, wantsReply, observeTimeoutMs };

	const reject = (receipt: RejectReceipt, diagnostic?: RejectDiagnostic): DispatchDecision =>
		diagnostic ? { kind: "reject", receipt, diagnostic } : { kind: "reject", receipt };

	// 1. requireGardenId — BEFORE any path is built.
	const gardenId = requireGardenId(input.target);

	// 2. resolveTarget — probe-free. no citizen → bad-target; quarantined → conflict.
	const resolution = await deps.resolveTarget(gardenId);

	// 2b. A1 narrow (0.11.0): a record-LESS live pi control socket — a socket-only pi
	// endpoint (no citizen identity, but an addressable control socket). It is a REAL,
	// addressable citizen, so it runs the SAME in-domain probe table as a record-backed pi
	// (lock → inspect → table verdict) under `allowResume:false`. We DELIBERATELY do NOT
	// short-circuit non-fire-and-forget here: rejecting owned-outcome pre-probe with
	// `bad-target` would be a category lie (a LIVE, addressable peer classified as
	// absent/typo). The frozen table is the honest authority instead —
	//   owned-outcome × live    → `owned-live-no-autosend` (use fire-and-forget for a live peer)
	//   owned-outcome × dormant → resume verdict, but `allowResume:false` refuses it with
	//                             `socket-only-no-resume-authority` (no trusted cwd to spawn-bg)
	//   fire-and-forget × live  → control-socket send (unchanged)
	// `allowResume:false` is what keeps spawn-bg from EVER opening into a record-less
	// endpoint, regardless of intent — so routing every intent through is safe.
	if (resolution.identity === null && resolution.socketOnlyPi === true) {
		return decideInDomain(gardenId, input, deps, ctx, { allowResume: false });
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

	// 4-5. in-domain (record-backed pi): lock → inspect → route (resume allowed, cwd from record).
	return decideInDomain(gardenId, input, deps, ctx, { allowResume: true, cwd: identity.cwd });
}

// ── in-domain probe (steps 4-5), shared by the record-backed pi path and the A1-narrow
// socket-only pi path ────────────────────────────────────────────────────────────────────
// The lock lifecycle (B2) lives here: acquire BEFORE lstat/connect, every reject path
// releases explicitly (rejectAfterRelease), every execute path that keeps the lock sets
// retainLock=true, and a thrown IO error releases the still-held lock before rethrowing so
// the long-lived MCP bridge never pins a gid. `resume.allowResume` gates the ONLY branch
// that reads a target cwd and launches a child: a socket-only endpoint passes `false`, so
// even though the resume verdict is structurally unreachable for it (fire-and-forget never
// yields `resume`), spawn-bg can never open into a record-less endpoint.
type InDomainCtx = { mode: EntwurfV2Mode; wantsReply: boolean; observeTimeoutMs: number };
type ResumePolicy = { allowResume: true; cwd: string } | { allowResume: false };

async function decideInDomain(
	gardenId: string,
	input: DispatchInput,
	deps: DispatchDeciderDeps,
	ctx: InDomainCtx,
	resume: ResumePolicy,
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
			// resolver reject (owned-live-no-autosend / indeterminate-no-spawn / …) — the
			// lock was for an in-domain probe that yielded no execute, so release it.
			return rejectAfterRelease(receipt);
		}

		if (receipt.action === "resume") {
			if (!resume.allowResume) {
				// A1 narrow guard: the resume verdict is owned-outcome × dormant ONLY. A
				// socket-only pi endpoint now routes ALL intents through here under
				// `allowResume:false` (2b no longer pre-rejects non-fire-and-forget), so this
				// guard IS reachable — it is the honest home of "owned-outcome to a DORMANT
				// record-less socket". REFUSE: a record-less endpoint has no trusted cwd/resume
				// authority, so spawn-bg must never open into it. This is a POST-probe guard
				// (we measured `liveness` above), so it carries the honest measured liveness —
				// NOT the pre-probe `bad-target` lie that would mislabel the citizen absent.
				return rejectAfterRelease(makeRejectReceipt("socket-only-no-resume-authority", liveness));
			}
			// 1B: preflight runs ONLY here (the sole branch that launches a child into a
			// target cwd). deny → nonce-owned release → untrusted-fail-fast, with the
			// honest measured liveness (dormant = the `dead` we just probed).
			const outcome = await deps.preflightForCwd(resume.cwd);
			if (outcome.kind === "deny") {
				return rejectAfterRelease(makeRejectReceipt("untrusted-fail-fast", liveness));
			}
			const plan: ExecutionPlan = {
				transport: "spawn-bg",
				action: "resume",
				targetGardenId: gardenId,
				sessionId: gardenId, // D3: gid is the pi resume authority, not nativeSessionId.
				cwd: resume.cwd,
				prompt: input.message,
				wantsReply: ctx.wantsReply,
				launchArgs: outcome.launchArgs,
				expectedSocketPath: socketPath,
				observeTimeoutMs: ctx.observeTimeoutMs,
				releaseWhen: "socket-alive-or-child-exited",
			};
			retainLock = true;
			return { kind: "execute", receipt, plan, lock };
		}

		// receipt.action === "send" → control-socket send (lock kept for 5c re-resolve).
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
