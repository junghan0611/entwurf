/** Internal retire dispatcher. Host-authoritative caller resolution is an injected
 * composition seam, NOT authorization. Public exposure still needs an operator policy;
 * no role DB, permission boolean, or actor-label permission is manufactured here.
 * The same existing v2 target lock spans fresh reads, preflight, the requested record, ONE adapter
 * call and its outcome record.
 *
 * Recording is two mandatory synchronous callbacks, NOT permission hooks: `recordRequested` runs
 * after the locked preflight and before the adapter, and must return the attempt's 32-hex event
 * id; `recordOutcome` runs once after that attempt and must return `undefined`. This module knows
 * no path, file format or clock. A recorder that throws or returns anything else is a record
 * failure: before the adapter it refuses (`retirement-record-unavailable`, adapter never entered);
 * after it, the backend outcome stands and only `record` says so. A returned Promise is never
 * awaited, `.then`-ed or treated as completion — what it does afterwards is outside this receipt.
 * `record: not-attempted` means no recorder was called, not a runtime proof that no bytes exist.
 *
 * `signal` is request cancellation, not approval. It is checked before the lock, after the
 * locked preflight and after the requested record; once the adapter is entered it is the
 * adapter's own business (Pi takes none; CC receives it through the composition).
 */
import type { CcRetireExpected, CcRetireResult } from "./cc-retire-request.ts";
import { controlSocketPathIn } from "./control-socket-path.js";
import type { SenderEnvelope } from "./entwurf-control-rpc.ts";
import { isOutOfSocketDomainGardenIdConflict } from "./entwurf-facts.ts";
import type { AcquireLockResult, LockClaim, ReleaseResult } from "./entwurf-v2-lock.ts";
import type { MetaIdentity } from "./meta-session.ts";
import type { PiRetireRequestResult } from "./pi-retire-request.ts";
import { isValidSessionId } from "./session-id.js";
import {
	isRecordLessSocketCandidate,
	mapInspectionToLiveness,
	type TargetSocketInspection,
} from "./socket-discovery.ts";
import type { SocketLiveness } from "./socket-probe.ts";

export interface RetireDispatcherDeps {
	/** Existing host resolver's verified result, not a caller-authored envelope. */
	resolveCaller(): Promise<SenderEnvelope | null>;
	acquireLock(gardenId: string): AcquireLockResult;
	releaseLock(claim: LockClaim): ReleaseResult;
	/** Owning metaRecordExistsByGardenId / readAddressableMetaIdentity seams. */
	recordExists(gardenId: string): boolean;
	readIdentity(gardenId: string): MetaIdentity;
	/** One composition-owned directory shared by inspection, probe and Pi request. */
	controlSocketDir: string;
	inspectPath(socketPath: string): Promise<TargetSocketInspection>;
	probeSocket(socketPath: string): Promise<SocketLiveness>;
	requestPi(
		target: MetaIdentity,
		expected: { gardenId: string; nativeSessionId: string },
		options: { controlSocketDir: string },
	): Promise<PiRetireRequestResult>;
	/** Composition binds existing requestCcRetire and its owning first/late witness deps. */
	requestCc(expected: CcRetireExpected): Promise<CcRetireResult>;
	/** Append the requested event; return its 32 lowercase hex id only after the append succeeded. */
	recordRequested(context: RetireRecordContext): string;
	/** Append the outcome event of that attempt. `undefined`, not `void`: an async recorder does not type. */
	recordOutcome(eventId: string, context: RetireRecordContext, outcome: RetireDispatchOutcome): undefined;
	/** This request's cancellation. Not an approval. */
	signal?: AbortSignal;
}

export type RetireTargetBackend = "pi" | "claude-code";

/** Attribution only: who asked, about whom, on which rail. */
export interface RetireRecordContext {
	actorGardenId: string;
	targetGardenId: string;
	targetBackend: RetireTargetBackend;
}

export type RetireRecordReceipt =
	| { status: "not-attempted" }
	| { status: "requested-append-error"; cause: string }
	| { status: "complete"; eventId: string }
	| { status: "outcome-append-error"; eventId: string; cause: string };

export type RetireDispatchOutcome =
	| {
			kind: "refused";
			reason:
				| "target-invalid"
				| "caller-unavailable"
				| "self-target"
				| "target-locked"
				| "target-not-found"
				| "record-less-socket"
				| "target-backend-unsupported"
				| "target-address-conflict"
				| "target-dead"
				| "target-indeterminate"
				| "target-drifted"
				| "request-aborted"
				| "retirement-record-unavailable";
			detail?: string;
	  }
	| { kind: "preflight-error"; cause: string }
	| { kind: "pi"; result: PiRetireRequestResult }
	| { kind: "claude-code"; result: CcRetireResult }
	| { kind: "unknown"; backend: RetireTargetBackend; cause: string };

export type RetireReleaseReceipt =
	| { status: "not-acquired" }
	| { status: ReleaseResult }
	| { status: "error"; cause: string };

/** Neither backend outcome is upgraded: Pi ACK is request-only, CC exited is fd-process
 * exit only (not conversation, children or flush). Cleanup failure is independently non-green
 * and NEVER erases a possibly effective action or grants permission to replay it.
 */
export interface RetireDispatchReceipt {
	targetGardenId: string;
	actor: SenderEnvelope | null;
	outcome: RetireDispatchOutcome;
	/** Independent of `outcome` and `release`: a record failure never rewrites either. */
	record: RetireRecordReceipt;
	release: RetireReleaseReceipt;
}

const EVENT_ID_RE = /^[0-9a-f]{32}$/;

function causeOf(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

export async function retireCitizen(
	targetGardenId: string,
	deps: RetireDispatcherDeps,
): Promise<RetireDispatchReceipt> {
	let actor: SenderEnvelope | null = null;
	const beforeLock = (outcome: RetireDispatchOutcome): RetireDispatchReceipt => ({
		targetGardenId,
		actor,
		outcome,
		record: { status: "not-attempted" },
		release: { status: "not-acquired" },
	});
	const aborted = () => deps.signal?.aborted === true;
	if (!isValidSessionId(targetGardenId)) return beforeLock({ kind: "refused", reason: "target-invalid" });
	let acquired: AcquireLockResult;
	try {
		actor = await deps.resolveCaller();
		if (!actor || !isValidSessionId(actor.sessionId) || actor.origin === "external-mcp") {
			return beforeLock({ kind: "refused", reason: "caller-unavailable" });
		}
		if (actor.sessionId === targetGardenId) return beforeLock({ kind: "refused", reason: "self-target" });
		if (aborted()) return beforeLock({ kind: "refused", reason: "request-aborted" });
		acquired = deps.acquireLock(targetGardenId);
	} catch (error) {
		return beforeLock({ kind: "preflight-error", cause: causeOf(error) });
	}
	if (!acquired.ok) return beforeLock({ kind: "refused", reason: "target-locked", detail: acquired.conflict.detail });
	const claim = acquired.claim;
	const actorGardenId = actor.sessionId;
	let enteredBackend: RetireTargetBackend | null = null;
	// Assigned inside runLocked; the cast keeps control flow from narrowing it to null here.
	let attempt = null as { eventId: string; context: RetireRecordContext } | null;
	let record: RetireRecordReceipt = { status: "not-attempted" };
	let outcome: RetireDispatchOutcome;
	let release: RetireReleaseReceipt;
	/** The last step before ONE adapter: cancellation, requested record, cancellation again.
	 * Returns the outcome that replaces the adapter, or null to enter it. */
	const admit = (targetBackend: RetireTargetBackend): RetireDispatchOutcome | null => {
		if (aborted()) return { kind: "refused", reason: "request-aborted" };
		const context: RetireRecordContext = { actorGardenId, targetGardenId, targetBackend };
		let eventId: unknown;
		try {
			eventId = deps.recordRequested(context);
		} catch (error) {
			record = { status: "requested-append-error", cause: causeOf(error) };
			return { kind: "refused", reason: "retirement-record-unavailable" };
		}
		if (typeof eventId !== "string" || !EVENT_ID_RE.test(eventId)) {
			record = { status: "requested-append-error", cause: "recorder returned no event id" };
			return { kind: "refused", reason: "retirement-record-unavailable" };
		}
		attempt = { eventId, context };
		if (aborted()) return { kind: "refused", reason: "request-aborted" };
		enteredBackend = targetBackend;
		return null;
	};
	const runLocked = async (): Promise<RetireDispatchOutcome> => {
		const socketPath = controlSocketPathIn(deps.controlSocketDir, targetGardenId);
		if (!deps.recordExists(targetGardenId)) {
			const inspection = await deps.inspectPath(socketPath);
			return {
				kind: "refused",
				reason: isRecordLessSocketCandidate(inspection) ? "record-less-socket" : "target-not-found",
			};
		}
		const identity = deps.readIdentity(targetGardenId);
		if (identity.gardenId !== targetGardenId) throw new Error("addressable target read returned a different garden id");
		if (identity.backend !== "pi" && identity.backend !== "claude-code") {
			return { kind: "refused", reason: "target-backend-unsupported" };
		}
		const inspection = await deps.inspectPath(socketPath);
		if (identity.backend === "pi") {
			const live = await mapInspectionToLiveness(inspection, deps.probeSocket);
			if ("addressConflict" in live) return { kind: "refused", reason: "target-address-conflict" };
			if (live.liveness === "dead") return { kind: "refused", reason: "target-dead" };
			if (live.liveness !== "alive") return { kind: "refused", reason: "target-indeterminate" };
			// Fresh after awaited lstat/connect; timestamps are metadata, not birth identity.
			const current = deps.readIdentity(targetGardenId);
			if (
				["gardenId", "backend", "nativeSessionId", "createdAt"].some(
					(key) => current[key as keyof MetaIdentity] !== identity[key as keyof MetaIdentity],
				)
			) {
				return { kind: "refused", reason: "target-drifted" };
			}
			const replaced = admit("pi");
			if (replaced) return replaced;
			const result = await deps.requestPi(
				current,
				{ gardenId: current.gardenId, nativeSessionId: current.nativeSessionId },
				{
					controlSocketDir: deps.controlSocketDir,
				},
			);
			return { kind: "pi", result };
		}
		// Same out-of-socket-domain conflict policy as entwurf-v2-production. Non-socket
		// regular entries do not claim a garden address; symlinks/socket entries do.
		if (inspection.kind === "indeterminate")
			throw new Error(`control address inspection indeterminate: ${inspection.error}`);
		const sockets = new Set(inspection.kind === "socket-file" ? [targetGardenId] : []);
		const symlinks = new Set(
			inspection.kind === "address-conflict" && inspection.reason === "symlink" ? [targetGardenId] : [],
		);
		if (isOutOfSocketDomainGardenIdConflict(identity.backend, targetGardenId, sockets, symlinks)) {
			return { kind: "refused", reason: "target-address-conflict" };
		}
		const replaced = admit("claude-code");
		if (replaced) return replaced;
		const { gardenId, backend, nativeSessionId, createdAt, attachIncarnation } = identity;
		const result = await deps.requestCc({ gardenId, backend, nativeSessionId, createdAt, attachIncarnation });
		return { kind: "claude-code", result };
	};
	try {
		try {
			outcome = await runLocked();
		} catch (error) {
			outcome =
				enteredBackend === null
					? { kind: "preflight-error", cause: causeOf(error) }
					: { kind: "unknown", backend: enteredBackend, cause: causeOf(error) };
		}
		// An attempt that was recorded as requested gets ONE outcome record, before release.
		if (attempt) {
			const { eventId, context } = attempt;
			try {
				const returned: unknown = deps.recordOutcome(eventId, context, outcome);
				record =
					returned === undefined
						? { status: "complete", eventId }
						: { status: "outcome-append-error", eventId, cause: "recorder returned a value" };
			} catch (error) {
				record = { status: "outcome-append-error", eventId, cause: causeOf(error) };
			}
		}
	} finally {
		// One acquired claim, one release attempt. No throw here may overwrite outcome.
		try {
			release = { status: deps.releaseLock(claim) };
		} catch (error) {
			release = { status: "error", cause: causeOf(error) };
		}
	}
	return { targetGardenId, actor, outcome, record, release };
}
