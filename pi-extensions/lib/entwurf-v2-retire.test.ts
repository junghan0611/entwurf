import { describe, expect, it, vi } from "vitest";
import type { SenderEnvelope } from "./entwurf-control-rpc.ts";
import type { LockClaim } from "./entwurf-v2-lock.ts";
import { type RetireDispatcherDeps, retireCitizen } from "./entwurf-v2-retire.ts";
import type { MetaIdentity } from "./meta-session.ts";

const gid = "20261021T120000-abcdef";
const socketPath = `/fake-only/control/${gid}.sock`;
const record: MetaIdentity = {
	schemaVersion: 3,
	gardenId: gid,
	backend: "pi",
	nativeSessionId: "fixture-native-id",
	cwd: "/fake-only",
	model: null,
	transcriptPath: null,
	createdAt: "2026-10-21T12:00:00.000Z",
	recordUpdatedAt: "2026-10-21T12:00:00.000Z",
	attachIncarnation: null,
};
const actor: SenderEnvelope = {
	sessionId: "20261021T120001-abcdef",
	agentId: "attribution-not-permission",
	cwd: "/fake-only",
	timestamp: "2026-10-21T12:00:00.000Z",
	origin: "pi-session",
	replyable: false,
};
const claim: LockClaim = {
	gardenId: gid,
	pid: 123,
	hostname: "fake",
	createdAt: actor.timestamp,
	nonce: "fake-lock-nonce",
	owner: "entwurf_v2",
	lockPath: "/fake-only/target.lock",
};
const eventId = "0123456789abcdef0123456789abcdef";

function fixture(backend: MetaIdentity["backend"] = "pi") {
	const events: string[] = [];
	const target = { ...record, backend };
	const deps = {
		controlSocketDir: "/fake-only/control",
		resolveCaller: vi.fn<RetireDispatcherDeps["resolveCaller"]>(async () => {
			events.push("caller");
			return actor;
		}),
		acquireLock: vi.fn<RetireDispatcherDeps["acquireLock"]>(() => {
			events.push("lock");
			return { ok: true, claim };
		}),
		releaseLock: vi.fn<RetireDispatcherDeps["releaseLock"]>(() => {
			events.push("release");
			return "released";
		}),
		recordExists: vi.fn<RetireDispatcherDeps["recordExists"]>(() => {
			events.push("exists");
			return true;
		}),
		readIdentity: vi.fn<RetireDispatcherDeps["readIdentity"]>(() => {
			events.push("read");
			return { ...target };
		}),
		inspectPath: vi.fn<RetireDispatcherDeps["inspectPath"]>(async () => {
			events.push("inspect");
			return { kind: backend === "pi" ? "socket-file" : "absent", socketPath };
		}),
		probeSocket: vi.fn<RetireDispatcherDeps["probeSocket"]>(async () => {
			events.push("probe");
			return "alive";
		}),
		requestPi: vi.fn<RetireDispatcherDeps["requestPi"]>(async () => {
			events.push("pi");
			return { boundary: "shutdown-requested" };
		}),
		requestCc: vi.fn<RetireDispatcherDeps["requestCc"]>(async () => {
			events.push("cc");
			return { outcome: "exited", gardenId: gid, pid: 123 };
		}),
		recordRequested: vi.fn<RetireDispatcherDeps["recordRequested"]>(() => {
			events.push("requested");
			return eventId;
		}),
		recordOutcome: vi.fn<RetireDispatcherDeps["recordOutcome"]>(() => {
			events.push("outcome");
			return undefined;
		}),
	} satisfies RetireDispatcherDeps;
	return { deps, events, target };
}
function noAdapter(deps: ReturnType<typeof fixture>["deps"]) {
	expect(deps.requestPi).not.toHaveBeenCalled();
	expect(deps.requestCc).not.toHaveBeenCalled();
}
/** A preflight ending: no adapter and no recorder call. */
function noAttempt(deps: ReturnType<typeof fixture>["deps"]) {
	noAdapter(deps);
	expect(deps.recordRequested).not.toHaveBeenCalled();
	expect(deps.recordOutcome).not.toHaveBeenCalled();
}
function releasedOnce(deps: ReturnType<typeof fixture>["deps"]) {
	expect(deps.releaseLock).toHaveBeenCalledExactlyOnceWith(claim);
}

describe("internal retirement dispatcher — fake seams only, no native operations", () => {
	it("[QK:RETIRE-CORE-ADMISSION] invalid, anonymous and self callers touch no target IO", async () => {
		for (const [target, caller, reason] of [
			["../escape", actor, "target-invalid"],
			[gid, null, "caller-unavailable"],
			[gid, { ...actor, sessionId: gid }, "self-target"],
			[gid, { ...actor, sessionId: "not-garden" }, "caller-unavailable"],
			[gid, { ...actor, origin: "external-mcp" as const }, "caller-unavailable"],
		] as const) {
			const { deps } = fixture();
			deps.resolveCaller.mockResolvedValue(caller);
			expect((await retireCitizen(target, deps)).outcome).toEqual({ kind: "refused", reason });
			for (const op of [
				deps.acquireLock,
				deps.recordExists,
				deps.readIdentity,
				deps.inspectPath,
				deps.probeSocket,
				deps.releaseLock,
			])
				expect(op).not.toHaveBeenCalled();
			noAttempt(deps);
		}
	});
	it("[QK:RETIRE-CORE-LOCK] locked targets are not read and unacquired locks are not released", async () => {
		const { deps } = fixture();
		deps.acquireLock.mockReturnValue({
			ok: false,
			conflict: { reason: "target-locked", lockPath: claim.lockPath, holder: claim, detail: "held" },
		});
		const got = await retireCitizen(gid, deps);
		expect(got.outcome).toEqual({ kind: "refused", reason: "target-locked", detail: "held" });
		expect(got.release).toEqual({ status: "not-acquired" });
		for (const op of [deps.recordExists, deps.readIdentity, deps.inspectPath, deps.probeSocket, deps.releaseLock])
			expect(op).not.toHaveBeenCalled();
		noAttempt(deps);
	});
	it("[QK:RETIRE-CORE-RECORD] absent, record-less, corrupt and unsupported records cannot act", async () => {
		for (const kind of ["absent", "socket-file"] as const) {
			const { deps } = fixture();
			deps.recordExists.mockReturnValue(false);
			deps.inspectPath.mockResolvedValue({ kind, socketPath });
			expect((await retireCitizen(gid, deps)).outcome).toEqual({
				kind: "refused",
				reason: kind === "absent" ? "target-not-found" : "record-less-socket",
			});
			expect(deps.readIdentity).not.toHaveBeenCalled();
			expect(deps.probeSocket).not.toHaveBeenCalled();
			noAttempt(deps);
			releasedOnce(deps);
		}
		const corrupt = fixture();
		corrupt.deps.readIdentity.mockImplementation(() => {
			throw new Error("corrupt record");
		});
		expect((await retireCitizen(gid, corrupt.deps)).outcome).toEqual({
			kind: "preflight-error",
			cause: "corrupt record",
		});
		noAttempt(corrupt.deps);
		releasedOnce(corrupt.deps);
		const unsupported = fixture("codex");
		expect((await retireCitizen(gid, unsupported.deps)).outcome).toEqual({
			kind: "refused",
			reason: "target-backend-unsupported",
		});
		expect(unsupported.deps.inspectPath).not.toHaveBeenCalled();
		noAttempt(unsupported.deps);
		releasedOnce(unsupported.deps);
	});
	it("[QK:RETIRE-CORE-LIVE] only an alive Pi path proceeds and corrupt paths never connect", async () => {
		for (const inspection of [
			{ kind: "absent", socketPath } as const,
			{ kind: "address-conflict", socketPath, reason: "symlink" } as const,
			{ kind: "address-conflict", socketPath, reason: "not-socket" } as const,
			{ kind: "indeterminate", socketPath, error: "EACCES" } as const,
		]) {
			const { deps } = fixture();
			deps.inspectPath.mockResolvedValue(inspection);
			expect((await retireCitizen(gid, deps)).outcome).toEqual({
				kind: "refused",
				reason:
					inspection.kind === "absent"
						? "target-dead"
						: inspection.kind === "address-conflict"
							? "target-address-conflict"
							: "target-indeterminate",
			});
			expect(deps.probeSocket).not.toHaveBeenCalled();
			noAttempt(deps);
			releasedOnce(deps);
		}
		for (const live of ["dead", "indeterminate"] as const) {
			const { deps } = fixture();
			deps.probeSocket.mockResolvedValue(live);
			expect((await retireCitizen(gid, deps)).outcome).toEqual({
				kind: "refused",
				reason: live === "dead" ? "target-dead" : "target-indeterminate",
			});
			expect(deps.probeSocket).toHaveBeenCalledExactlyOnceWith(socketPath);
			noAttempt(deps);
			releasedOnce(deps);
		}
	});
	it("[QK:RETIRE-CORE-FRESH] Pi birth changes during probe refuse; refreshed metadata is forwarded", async () => {
		for (const change of [
			{ gardenId: actor.sessionId },
			{ nativeSessionId: "new-native" },
			{ backend: "claude-code" as const },
			{ createdAt: "later-birth" },
		]) {
			const { deps } = fixture();
			deps.probeSocket.mockImplementation(async () => {
				deps.readIdentity.mockReturnValue({ ...record, ...change });
				return "alive";
			});
			expect((await retireCitizen(gid, deps)).outcome).toEqual({ kind: "refused", reason: "target-drifted" });
			noAttempt(deps);
			releasedOnce(deps);
		}
		const { deps } = fixture();
		const refreshed = { ...record, recordUpdatedAt: "metadata-only" };
		deps.probeSocket.mockImplementation(async () => {
			deps.readIdentity.mockReturnValue(refreshed);
			return "alive";
		});
		await retireCitizen(gid, deps);
		expect(deps.requestPi).toHaveBeenCalledExactlyOnceWith(
			refreshed,
			{ gardenId: gid, nativeSessionId: record.nativeSessionId },
			{ controlSocketDir: "/fake-only/control" },
		);
		releasedOnce(deps);
	});
	it("[QK:RETIRE-CORE-PI] locked Pi sequence uses one directory and preserves request-only result", async () => {
		const { deps, events } = fixture();
		const result = { boundary: "shutdown-requested" as const };
		const got = await retireCitizen(gid, deps);
		expect(got).toEqual({
			targetGardenId: gid,
			actor,
			outcome: { kind: "pi", result },
			record: { status: "complete", eventId },
			release: { status: "released" },
		});
		expect(events).toEqual([
			"caller",
			"lock",
			"exists",
			"read",
			"inspect",
			"probe",
			"read",
			"requested",
			"pi",
			"outcome",
			"release",
		]);
		expect(deps.acquireLock).toHaveBeenCalledExactlyOnceWith(gid);
		expect(deps.inspectPath).toHaveBeenCalledExactlyOnceWith(socketPath);
		expect(deps.probeSocket).toHaveBeenCalledExactlyOnceWith(socketPath);
		expect(deps.requestPi).toHaveBeenCalledExactlyOnceWith(
			record,
			{ gardenId: gid, nativeSessionId: record.nativeSessionId },
			{ controlSocketDir: "/fake-only/control" },
		);
		expect(deps.requestCc).not.toHaveBeenCalled();
		releasedOnce(deps);
	});
	it("[QK:RETIRE-CORE-CC] CC forwards five expected fields without duplicate live/witness checks", async () => {
		const { deps, events } = fixture("claude-code");
		const got = await retireCitizen(gid, deps);
		expect(got.outcome).toEqual({ kind: "claude-code", result: { outcome: "exited", gardenId: gid, pid: 123 } });
		expect(deps.requestCc).toHaveBeenCalledExactlyOnceWith({
			gardenId: gid,
			backend: "claude-code",
			nativeSessionId: record.nativeSessionId,
			createdAt: record.createdAt,
			attachIncarnation: null,
		});
		expect(events).toEqual(["caller", "lock", "exists", "read", "inspect", "requested", "cc", "outcome", "release"]);
		expect(deps.probeSocket).not.toHaveBeenCalled();
		expect(deps.requestPi).not.toHaveBeenCalled();
		releasedOnce(deps);
		for (const inspection of [
			{ kind: "socket-file", socketPath } as const,
			{ kind: "address-conflict", socketPath, reason: "symlink" } as const,
			{ kind: "indeterminate", socketPath, error: "EACCES" } as const,
		]) {
			const f = fixture("claude-code");
			f.deps.inspectPath.mockResolvedValue(inspection);
			const receipt = await retireCitizen(gid, f.deps);
			expect(receipt.outcome).toEqual(
				inspection.kind === "indeterminate"
					? { kind: "preflight-error", cause: "control address inspection indeterminate: EACCES" }
					: { kind: "refused", reason: "target-address-conflict" },
			);
			noAttempt(f.deps);
			expect(f.deps.probeSocket).not.toHaveBeenCalled();
			releasedOnce(f.deps);
		}
	});
	it("[QK:RETIRE-CORE-THROW] adapter throws are unknown, never preflight refusal or retry", async () => {
		for (const backend of ["pi", "claude-code"] as const) {
			const { deps } = fixture(backend);
			const request = backend === "pi" ? deps.requestPi : deps.requestCc;
			request.mockRejectedValue(new Error("after possible effect"));
			const got = await retireCitizen(gid, deps);
			expect(got.outcome).toEqual({ kind: "unknown", backend, cause: "after possible effect" });
			expect(request).toHaveBeenCalledTimes(1);
			releasedOnce(deps);
		}
	});
	it("[QK:RETIRE-CORE-RELEASE] dirty cleanup preserves every backend outcome unchanged", async () => {
		const piResults = [
			{ boundary: "shutdown-requested" },
			{ boundary: "unknown", reason: "transport-error" },
			{ boundary: "refused", phase: "receiver", reason: "target-busy" },
		] as const;
		const ccResults = [
			{ outcome: "exited", gardenId: gid, pid: 123 },
			{ outcome: "refused", reason: "binding", detail: "before" },
			{ outcome: "not-signalled", reason: "drift", detail: "fd held" },
			{ outcome: "unknown", reason: "timeout", detail: "after go" },
		] as const;
		for (const cleanup of ["released", "not-owned", "absent", "throw"] as const) {
			for (const result of [...piResults, ...ccResults]) {
				const backend = "boundary" in result ? "pi" : "claude-code";
				const { deps } = fixture(backend);
				if ("boundary" in result) deps.requestPi.mockResolvedValue(result);
				else deps.requestCc.mockResolvedValue(result);
				deps.releaseLock.mockImplementation(() => {
					if (cleanup === "throw") throw new Error("cleanup failed");
					return cleanup;
				});
				const got = await retireCitizen(gid, deps);
				expect(got.outcome).toEqual({ kind: backend, result });
				if (got.outcome.kind === "pi" || got.outcome.kind === "claude-code") expect(got.outcome.result).toBe(result);
				expect(got.release).toEqual(
					cleanup === "throw" ? { status: "error", cause: "cleanup failed" } : { status: cleanup },
				);
				expect(deps.requestPi.mock.calls.length + deps.requestCc.mock.calls.length).toBe(1);
				releasedOnce(deps);
			}
		}
	});
	it("[QK:RETIRE-CORE-FAULT] preflight faults retain their causes and acquired claims release once", async () => {
		for (const op of [
			"resolveCaller",
			"acquireLock",
			"recordExists",
			"readIdentity",
			"inspectPath",
			"probeSocket",
		] as const) {
			const { deps } = fixture();
			deps[op].mockImplementation(() => {
				throw new Error(`fault:${op}`);
			});
			const got = await retireCitizen(gid, deps);
			expect(got.outcome).toEqual({ kind: "preflight-error", cause: `fault:${op}` });
			noAttempt(deps);
			if (op === "resolveCaller" || op === "acquireLock") expect(deps.releaseLock).not.toHaveBeenCalled();
			else releasedOnce(deps);
		}
		const { deps } = fixture();
		deps.readIdentity.mockReturnValueOnce(record).mockImplementation(() => {
			throw new Error("fresh read corrupt");
		});
		deps.releaseLock.mockImplementation(() => {
			throw new Error("cleanup failed");
		});
		const got = await retireCitizen(gid, deps);
		expect(got.outcome).toEqual({ kind: "preflight-error", cause: "fresh read corrupt" });
		expect(got.release).toEqual({ status: "error", cause: "cleanup failed" });
		noAttempt(deps);
		releasedOnce(deps);
	});
});

describe("internal retirement dispatcher — record join and cancellation, fake seams only", () => {
	const piContext = { actorGardenId: actor.sessionId, targetGardenId: gid, targetBackend: "pi" } as const;
	const ccContext = { ...piContext, targetBackend: "claude-code" } as const;

	it("[QK:RETIRE-CORE-ABORT-BEFORE-LOCK] a cancelled request takes no lock and records nothing", async () => {
		const { deps } = fixture();
		const controller = new AbortController();
		controller.abort();
		const got = await retireCitizen(gid, { ...deps, signal: controller.signal });
		expect(got).toEqual({
			targetGardenId: gid,
			actor,
			outcome: { kind: "refused", reason: "request-aborted" },
			record: { status: "not-attempted" },
			release: { status: "not-acquired" },
		});
		expect(deps.acquireLock).not.toHaveBeenCalled();
		expect(deps.releaseLock).not.toHaveBeenCalled();
		noAttempt(deps);
	});

	it("[QK:RETIRE-CORE-ABORT-PREFLIGHT] cancellation across the locked await skips record and adapter", async () => {
		for (const backend of ["pi", "claude-code"] as const) {
			const { deps } = fixture(backend);
			const controller = new AbortController();
			deps.inspectPath.mockImplementation(async () => {
				controller.abort();
				return { kind: backend === "pi" ? "socket-file" : "absent", socketPath };
			});
			const got = await retireCitizen(gid, { ...deps, signal: controller.signal });
			expect(got.outcome).toEqual({ kind: "refused", reason: "request-aborted" });
			expect(got.record).toEqual({ status: "not-attempted" });
			noAttempt(deps);
			releasedOnce(deps);
		}
	});

	it("[QK:RETIRE-CORE-ABORT-AFTER-REQUESTED] cancellation inside the requested hook records an aborted outcome", async () => {
		for (const [backend, context] of [
			["pi", piContext],
			["claude-code", ccContext],
		] as const) {
			const { deps, events } = fixture(backend);
			const controller = new AbortController();
			deps.recordRequested.mockImplementation(() => {
				events.push("requested");
				controller.abort();
				return eventId;
			});
			const got = await retireCitizen(gid, { ...deps, signal: controller.signal });
			const aborted = { kind: "refused", reason: "request-aborted" } as const;
			expect(got.outcome).toEqual(aborted);
			expect(got.record).toEqual({ status: "complete", eventId });
			noAdapter(deps);
			expect(deps.recordRequested).toHaveBeenCalledExactlyOnceWith(context);
			expect(deps.recordOutcome).toHaveBeenCalledExactlyOnceWith(eventId, context, aborted);
			expect(events.slice(-3)).toEqual(["requested", "outcome", "release"]);
			releasedOnce(deps);
		}
	});

	it("[QK:RETIRE-CORE-RECORD-JOIN] requested precedes ONE adapter; its outcome object is recorded before release", async () => {
		for (const [backend, context] of [
			["pi", piContext],
			["claude-code", ccContext],
		] as const) {
			const { deps, events } = fixture(backend);
			const got = await retireCitizen(gid, deps);
			const adapter = backend === "pi" ? "pi" : "cc";
			expect(events.slice(-4)).toEqual(["requested", adapter, "outcome", "release"]);
			expect(deps.recordRequested).toHaveBeenCalledExactlyOnceWith(context);
			expect(deps.recordOutcome).toHaveBeenCalledTimes(1);
			const [id, ctx, recorded] = deps.recordOutcome.mock.calls[0] ?? [];
			expect(id).toBe(eventId);
			expect(ctx).toEqual(context);
			expect(recorded).toBe(got.outcome);
			expect(got.record).toEqual({ status: "complete", eventId });
			releasedOnce(deps);
		}
	});

	it("[QK:RETIRE-CORE-RECORD-THROWN-ADAPTER] a thrown adapter is recorded as the same unknown outcome", async () => {
		for (const backend of ["pi", "claude-code"] as const) {
			const { deps } = fixture(backend);
			(backend === "pi" ? deps.requestPi : deps.requestCc).mockRejectedValue(new Error("after possible effect"));
			const got = await retireCitizen(gid, deps);
			const unknown = { kind: "unknown", backend, cause: "after possible effect" };
			expect(got.outcome).toEqual(unknown);
			expect(deps.recordOutcome.mock.calls[0]?.[2]).toBe(got.outcome);
			expect(got.record).toEqual({ status: "complete", eventId });
			releasedOnce(deps);
		}
	});

	it("[QK:RETIRE-CORE-REQUESTED-FAIL] a failed or invalid requested record refuses before any adapter", async () => {
		// biome-ignore lint/suspicious/noThenProperty: the oracle IS a thenable the core must never call.
		const thenable = { then: vi.fn() };
		const cases: [string, () => unknown, string][] = [
			[
				"throw",
				() => {
					throw new Error("append failed after partial bytes");
				},
				"append failed after partial bytes",
			],
			["fulfilled promise", () => Promise.resolve(eventId), "recorder returned no event id"],
			["thenable", () => thenable, "recorder returned no event id"],
			["uppercase", () => eventId.toUpperCase(), "recorder returned no event id"],
			["short", () => eventId.slice(1), "recorder returned no event id"],
			["undefined", () => undefined, "recorder returned no event id"],
		];
		for (const [, recorder, cause] of cases) {
			const { deps } = fixture();
			deps.recordRequested.mockImplementation(recorder as () => string);
			const got = await retireCitizen(gid, deps);
			expect(got.outcome).toEqual({ kind: "refused", reason: "retirement-record-unavailable" });
			expect(got.record).toEqual({ status: "requested-append-error", cause });
			expect(deps.recordRequested).toHaveBeenCalledTimes(1);
			noAdapter(deps);
			expect(deps.recordOutcome).not.toHaveBeenCalled();
			releasedOnce(deps);
		}
		expect(thenable.then).not.toHaveBeenCalled();
	});

	it("[QK:RETIRE-CORE-OUTCOME-FAIL] a failed or invalid outcome record keeps the backend result and releases once", async () => {
		// biome-ignore lint/suspicious/noThenProperty: the oracle IS a thenable the core must never call.
		const thenable = { then: vi.fn() };
		const cases: [() => unknown, string][] = [
			[
				() => {
					throw new Error("outcome append failed");
				},
				"outcome append failed",
			],
			[() => Promise.resolve(undefined), "recorder returned a value"],
			[() => thenable, "recorder returned a value"],
			[() => null, "recorder returned a value"],
			[() => eventId, "recorder returned a value"],
		];
		for (const cleanup of ["released", "throw"] as const) {
			for (const [recorder, cause] of cases) {
				for (const backend of ["pi", "claude-code"] as const) {
					const { deps } = fixture(backend);
					const result =
						backend === "pi"
							? ({ boundary: "shutdown-requested" } as const)
							: ({ outcome: "exited", gardenId: gid, pid: 123 } as const);
					if (backend === "pi") deps.requestPi.mockResolvedValue(result as { boundary: "shutdown-requested" });
					else deps.requestCc.mockResolvedValue(result as { outcome: "exited"; gardenId: string; pid: number });
					deps.recordOutcome.mockImplementation(recorder as () => undefined);
					deps.releaseLock.mockImplementation(() => {
						if (cleanup === "throw") throw new Error("cleanup failed");
						return "released";
					});
					const got = await retireCitizen(gid, deps);
					expect(got.outcome).toEqual({ kind: backend, result });
					if (got.outcome.kind === "pi" || got.outcome.kind === "claude-code") expect(got.outcome.result).toBe(result);
					expect(got.record).toEqual({ status: "outcome-append-error", eventId, cause });
					expect(got.release).toEqual(
						cleanup === "throw" ? { status: "error", cause: "cleanup failed" } : { status: "released" },
					);
					expect(deps.requestPi.mock.calls.length + deps.requestCc.mock.calls.length).toBe(1);
					expect(deps.recordOutcome).toHaveBeenCalledTimes(1);
					releasedOnce(deps);
				}
			}
		}
		expect(thenable.then).not.toHaveBeenCalled();
	});
});
