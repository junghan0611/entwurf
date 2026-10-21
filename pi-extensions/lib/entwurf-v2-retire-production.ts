/**
 * entwurf-v2-retire-production — the ctx-free PRODUCTION assembly of `retireCitizen`'s deps
 * (#147). `makeProductionRetireDeps(opts)` binds the existing owning APIs — the v2 target lock,
 * the meta-session readers, the control-socket inspection and probe, and the two internal
 * retire adapters — into one `RetireDispatcherDeps`. Same shape as `makeProductionEntwurfV2Deps`:
 * leaf IO seams are overridable for tests; which closure reaches which seam is not.
 *
 * Wiring, not a grant. Building or holding these deps confers no permission to retire anyone.
 * `resolveCaller` is the trusted host's own caller resolution, injected at the wiring site (the
 * bridge's private resolver, passed through unchanged); the dispatcher uses it for attribution
 * and the self-target refusal only. No tool, index entry or annotation is registered here.
 *
 * ONE path set, from two sources. The lock and control-socket directories default to
 * module-load constants (`ENTWURF_V2_LOCK_DIR`, `CONTROL_SOCKET_DIR`, HOME-derived when their
 * modules load); this factory does not re-derive them. The sessions, receivers and senders
 * directories default to an environment read made ONCE, at construction. Every closure uses
 * that one set — including the Claude Code adapter's own record / receiver / sender witnesses,
 * whose defaults would otherwise resolve their directories again on every call and could read
 * a different store than the dispatcher. The capture covers these five directories (and the
 * sidecar directory derived from the sessions one) only; the runtime environment below them
 * (the CC helper's interpreter lookup, for one) is the adapter's own and is not frozen here.
 * The CC helper path and spawn stay the adapter's defaults.
 *
 * `signal` is request-scoped: build these deps for ONE retire request. It is captured once and
 * handed both to the dispatcher's own cancellation checks and, unchanged, to the CC adapter's
 * abort checks; it is not an approval, and the Pi rail takes none.
 *
 * Recording: the #106 B sidecar directory is derived ONCE from the captured sessions directory
 * (`retirementsDirBesideSessions`), never from a sixth path or environment knob. The two record
 * callbacks are synchronous: each mints its event (random 128-bit id, ISO UTC `at`) and appends
 * it once through the `append` seam; the requested callback returns the id only after its append
 * returned. The outcome summary is a closed semantic code, never a cause, detail or stderr: Pi
 * keeps its own closed reason code, a CC reason is always null (its status is kept; the full
 * result stays on the wire receipt), an adapter throw is `unknown/adapter-threw` and a
 * post-request cancellation `refused/request-aborted`. Nothing here mutates the identity store.
 */

import { randomBytes } from "node:crypto";
import {
	type CcRetireDeps,
	type CcRetireExpected,
	type CcRetireOptions,
	type CcRetireResult,
	makeCcRetireDeps,
	requestCcRetire,
} from "./cc-retire-request.ts";
import type { SenderEnvelope } from "./entwurf-control-rpc.ts";
import {
	type AcquireLockResult,
	ENTWURF_V2_LOCK_DIR,
	type LockClaim,
	type ReleaseResult,
	acquireLock as realAcquireLock,
	releaseLock as realReleaseLock,
} from "./entwurf-v2-lock.ts";
import type {
	RetireDispatcherDeps,
	RetireDispatchOutcome,
	RetireRecordContext,
	RetireTargetBackend,
} from "./entwurf-v2-retire.ts";
import { inspectReceiverMarker, type ReceiverInspection } from "./entwurf-v2-visible-resume.ts";
import {
	defaultMetaReceiversDir,
	defaultMetaSendersDir,
	defaultMetaSessionsDir,
	type MetaIdentity,
	type MetaSenderMarker,
	metaRecordExistsByGardenId,
	readAddressableMetaIdentity,
	readMetaSenderMarker,
} from "./meta-session.ts";
import { type PiRetireRequestResult, requestPiRetire } from "./pi-retire-request.ts";
import {
	appendRetirementEvent,
	RETIREMENT_EVENT_VERSION,
	type RetirementEvent,
	type RetirementOutcomeSummary,
	retirementsDirBesideSessions,
} from "./retirement-event.ts";
import { CONTROL_SOCKET_DIR, inspectControlSocketPath, type TargetSocketInspection } from "./socket-discovery.ts";
import { probeSocketLiveness, type SocketLiveness } from "./socket-probe.ts";

/** The leaf IO the factory calls. Each defaults to the real owning function; tests override
 * them with spies to prove which directory reaches which seam. */
export interface ProductionRetireSeams {
	acquireLock: (gid: string, deps: { dir: string }) => AcquireLockResult;
	releaseLock: (claim: LockClaim, deps: { dir: string }) => ReleaseResult;
	metaRecordExists: (gid: string, sessionsDir: string) => boolean;
	readIdentity: (gid: string, sessionsDir: string) => MetaIdentity;
	inspectPath: (socketPath: string) => Promise<TargetSocketInspection>;
	probeSocket: (socketPath: string) => Promise<SocketLiveness>;
	inspectReceiver: (gid: string, receiversDir: string) => ReceiverInspection;
	readSender: (opts: { backend: "claude-code"; ownerPid: number; sendersDir: string }) => MetaSenderMarker | null;
	requestPi: (
		target: MetaIdentity,
		expected: { gardenId: string; nativeSessionId: string },
		options: { controlSocketDir: string },
	) => Promise<PiRetireRequestResult>;
	requestCc: (expected: CcRetireExpected, deps: CcRetireDeps, options: CcRetireOptions) => Promise<CcRetireResult>;
	append: (retirementsDir: string, event: RetirementEvent) => { bytes: number };
}

type PiReason = Extract<PiRetireRequestResult, { reason: string }>["reason"];
/** Pi's closed reason union, exhaustively (a Record keyed by it fails to type if one is added or
 * removed). Only these codes reach the sidecar; anything else becomes null. */
const PI_REASON_CODES: Record<PiReason, true> = {
	"target-backend-unsupported": true,
	"target-identity-mismatch": true,
	"target-closing": true,
	"target-stale": true,
	"target-context-unavailable": true,
	"target-non-tui": true,
	"target-busy": true,
	"target-pending": true,
	"malformed-response": true,
	"transport-error": true,
	"shutdown-call-failed": true,
};

/** The closed summary of an attempt that was recorded as requested. Any other outcome kind is a
 * composition fault and throws, which the dispatcher reports as an outcome-record failure. */
function summarizeAttempt(backend: RetireTargetBackend, outcome: RetireDispatchOutcome): RetirementOutcomeSummary {
	if (outcome.kind === "pi" && backend === "pi") {
		const { result } = outcome;
		const reason = "reason" in result && Object.hasOwn(PI_REASON_CODES, result.reason) ? result.reason : null;
		return { status: result.boundary, reason };
	}
	if (outcome.kind === "claude-code" && backend === "claude-code")
		return { status: outcome.result.outcome, reason: null };
	if (outcome.kind === "unknown" && outcome.backend === backend) return { status: "unknown", reason: "adapter-threw" };
	if (outcome.kind === "refused" && outcome.reason === "request-aborted") {
		return { status: "refused", reason: "request-aborted" };
	}
	throw new Error(`no retirement summary for a ${outcome.kind} outcome on ${backend}`);
}

export interface ProductionRetireOpts {
	/** The trusted host's caller resolution (attribution / self-target refusal), NOT authorization. */
	resolveCaller: () => Promise<SenderEnvelope | null>;
	/** This request's abort signal, for the core cancellation checks and the CC adapter. */
	signal?: AbortSignal;
	lockDir?: string;
	sessionsDir?: string;
	receiversDir?: string;
	sendersDir?: string;
	controlSocketDir?: string;
	/** Test seam overrides — defaults are the real IO. */
	seams?: Partial<ProductionRetireSeams>;
}

export function makeProductionRetireDeps(opts: ProductionRetireOpts): RetireDispatcherDeps {
	// ── ONE path set: two module-load constants, three construction-time reads ──
	const lockDir = opts.lockDir ?? ENTWURF_V2_LOCK_DIR;
	const sessionsDir = opts.sessionsDir ?? defaultMetaSessionsDir();
	const receiversDir = opts.receiversDir ?? defaultMetaReceiversDir();
	const sendersDir = opts.sendersDir ?? defaultMetaSendersDir();
	const controlSocketDir = opts.controlSocketDir ?? CONTROL_SOCKET_DIR;
	const retirementsDir = retirementsDirBesideSessions(sessionsDir);
	const signal = opts.signal;

	const s = opts.seams ?? {};
	const io: ProductionRetireSeams = {
		acquireLock: s.acquireLock ?? realAcquireLock,
		releaseLock: s.releaseLock ?? realReleaseLock,
		metaRecordExists: s.metaRecordExists ?? metaRecordExistsByGardenId,
		readIdentity: s.readIdentity ?? readAddressableMetaIdentity,
		inspectPath: s.inspectPath ?? ((socketPath) => inspectControlSocketPath(socketPath)),
		probeSocket: s.probeSocket ?? probeSocketLiveness,
		inspectReceiver: s.inspectReceiver ?? inspectReceiverMarker,
		readSender: s.readSender ?? readMetaSenderMarker,
		requestPi: s.requestPi ?? requestPiRetire,
		requestCc: s.requestCc ?? ((expected, deps, options) => requestCcRetire(expected, deps, options)),
		append: s.append ?? appendRetirementEvent,
	};
	const attribution = (context: RetireRecordContext) => ({
		actorGardenId: context.actorGardenId,
		targetGardenId: context.targetGardenId,
		targetBackend: context.targetBackend,
	});

	// The CC adapter's three witnesses, closed over the SAME directories as the dispatcher's own
	// reads. Its helper path and spawn are left to the adapter's defaults.
	const ccDeps = makeCcRetireDeps({
		readRecord: (gid) => io.readIdentity(gid, sessionsDir),
		inspectReceiver: (gid) => io.inspectReceiver(gid, receiversDir),
		readSender: (ownerPid) => io.readSender({ backend: "claude-code", ownerPid, sendersDir }),
	});

	return {
		resolveCaller: opts.resolveCaller,
		// ONE lock domain: acquire and release are bound to the same directory.
		acquireLock: (gid) => io.acquireLock(gid, { dir: lockDir }),
		releaseLock: (claim) => io.releaseLock(claim, { dir: lockDir }),
		recordExists: (gid) => io.metaRecordExists(gid, sessionsDir),
		readIdentity: (gid) => io.readIdentity(gid, sessionsDir),
		controlSocketDir,
		inspectPath: (socketPath) => io.inspectPath(socketPath),
		probeSocket: (socketPath) => io.probeSocket(socketPath),
		requestPi: (target, expected, options) =>
			io.requestPi(target, expected, { controlSocketDir: options.controlSocketDir }),
		requestCc: (expected) => io.requestCc(expected, ccDeps, { signal }),
		recordRequested: (context) => {
			const eventId = randomBytes(16).toString("hex");
			io.append(retirementsDir, {
				v: RETIREMENT_EVENT_VERSION,
				kind: "retirement-requested",
				eventId,
				at: new Date().toISOString(),
				...attribution(context),
			});
			return eventId;
		},
		recordOutcome: (eventId, context, outcome) => {
			io.append(retirementsDir, {
				v: RETIREMENT_EVENT_VERSION,
				kind: "retirement-outcome",
				eventId,
				at: new Date().toISOString(),
				...attribution(context),
				outcome: summarizeAttempt(context.targetBackend, outcome),
			});
			return undefined;
		},
		signal,
	};
}
