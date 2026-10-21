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
	} satisfies RetireDispatcherDeps;
	return { deps, events, target };
}
function noAdapter(deps: ReturnType<typeof fixture>["deps"]) {
	expect(deps.requestPi).not.toHaveBeenCalled();
	expect(deps.requestCc).not.toHaveBeenCalled();
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
			noAdapter(deps);
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
		noAdapter(deps);
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
			noAdapter(deps);
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
		noAdapter(corrupt.deps);
		releasedOnce(corrupt.deps);
		const unsupported = fixture("codex");
		expect((await retireCitizen(gid, unsupported.deps)).outcome).toEqual({
			kind: "refused",
			reason: "target-backend-unsupported",
		});
		expect(unsupported.deps.inspectPath).not.toHaveBeenCalled();
		noAdapter(unsupported.deps);
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
			noAdapter(deps);
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
			noAdapter(deps);
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
			noAdapter(deps);
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
			release: { status: "released" },
		});
		expect(events).toEqual(["caller", "lock", "exists", "read", "inspect", "probe", "read", "pi", "release"]);
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
		expect(events).toEqual(["caller", "lock", "exists", "read", "inspect", "cc", "release"]);
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
			noAdapter(f.deps);
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
			noAdapter(deps);
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
		noAdapter(deps);
		releasedOnce(deps);
	});
});
