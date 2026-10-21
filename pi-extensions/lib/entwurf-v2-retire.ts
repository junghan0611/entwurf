/** Internal retire dispatcher. Host-authoritative caller resolution is an injected
 * composition seam, NOT authorization. Public exposure still needs an operator policy;
 * no role DB, permission boolean, or actor-label permission is manufactured here.
 * The same existing v2 target lock spans fresh reads, preflight and ONE adapter call.
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
}

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
				| "target-drifted";
			detail?: string;
	  }
	| { kind: "preflight-error"; cause: string }
	| { kind: "pi"; result: PiRetireRequestResult }
	| { kind: "claude-code"; result: CcRetireResult }
	| { kind: "unknown"; backend: "pi" | "claude-code"; cause: string };

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
	release: RetireReleaseReceipt;
}

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
		release: { status: "not-acquired" },
	});
	if (!isValidSessionId(targetGardenId)) return beforeLock({ kind: "refused", reason: "target-invalid" });
	let acquired: AcquireLockResult;
	try {
		actor = await deps.resolveCaller();
		if (!actor || !isValidSessionId(actor.sessionId) || actor.origin === "external-mcp") {
			return beforeLock({ kind: "refused", reason: "caller-unavailable" });
		}
		if (actor.sessionId === targetGardenId) return beforeLock({ kind: "refused", reason: "self-target" });
		acquired = deps.acquireLock(targetGardenId);
	} catch (error) {
		return beforeLock({ kind: "preflight-error", cause: causeOf(error) });
	}
	if (!acquired.ok) return beforeLock({ kind: "refused", reason: "target-locked", detail: acquired.conflict.detail });
	const claim = acquired.claim;
	let enteredBackend: "pi" | "claude-code" | null = null;
	let outcome: RetireDispatchOutcome;
	let release: RetireReleaseReceipt;
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
			enteredBackend = "pi";
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
		enteredBackend = "claude-code";
		const { gardenId, backend, nativeSessionId, createdAt, attachIncarnation } = identity;
		const result = await deps.requestCc({ gardenId, backend, nativeSessionId, createdAt, attachIncarnation });
		return { kind: "claude-code", result };
	};
	try {
		outcome = await runLocked();
	} catch (error) {
		outcome =
			enteredBackend === null
				? { kind: "preflight-error", cause: causeOf(error) }
				: { kind: "unknown", backend: enteredBackend, cause: causeOf(error) };
	} finally {
		// One acquired claim, one release attempt. No throw here may overwrite outcome.
		try {
			release = { status: deps.releaseLock(claim) };
		} catch (error) {
			release = { status: "error", cause: causeOf(error) };
		}
	}
	return { targetGardenId, actor, outcome, release };
}
