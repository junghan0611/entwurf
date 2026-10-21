/**
 * Metadata wiring of `makeProductionRetireDeps` (#147): which directory and which option reach
 * which injected leaf seam, and that backend results pass through untouched. Every leaf seam is a
 * fake spy. The real owning functions behind the defaults are replaced by throwing spies that must
 * never be called, so a closure that bypasses its seam fails here instead of touching a store, a
 * socket, /proc, a sidecar file or a helper process. This certifies dependency binding and the
 * record callbacks' event shape only — no lock, record, socket, signal, file or process lifecycle
 * is exercised.
 */
import * as os from "node:os";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const real = vi.hoisted(() => {
	const reached = (name: string) =>
		vi.fn(() => {
			throw new Error(`real ${name} reached`);
		});
	return {
		acquireLock: reached("acquireLock"),
		releaseLock: reached("releaseLock"),
		metaRecordExistsByGardenId: reached("metaRecordExistsByGardenId"),
		readAddressableMetaIdentity: reached("readAddressableMetaIdentity"),
		readMetaSenderMarker: reached("readMetaSenderMarker"),
		inspectReceiverMarker: reached("inspectReceiverMarker"),
		inspectControlSocketPath: reached("inspectControlSocketPath"),
		probeSocketLiveness: reached("probeSocketLiveness"),
		requestPiRetire: reached("requestPiRetire"),
		requestCcRetire: reached("requestCcRetire"),
		appendRetirementEvent: reached("appendRetirementEvent"),
		spawn: reached("spawn"),
	};
});

vi.mock("node:child_process", async (importOriginal) => ({
	...(await importOriginal<typeof import("node:child_process")>()),
	spawn: real.spawn,
}));
vi.mock("./entwurf-v2-lock.ts", async (importOriginal) => ({
	...(await importOriginal<typeof import("./entwurf-v2-lock.ts")>()),
	acquireLock: real.acquireLock,
	releaseLock: real.releaseLock,
}));
vi.mock("./meta-session.ts", async (importOriginal) => ({
	...(await importOriginal<typeof import("./meta-session.ts")>()),
	metaRecordExistsByGardenId: real.metaRecordExistsByGardenId,
	readAddressableMetaIdentity: real.readAddressableMetaIdentity,
	readMetaSenderMarker: real.readMetaSenderMarker,
}));
vi.mock("./entwurf-v2-visible-resume.ts", async (importOriginal) => ({
	...(await importOriginal<typeof import("./entwurf-v2-visible-resume.ts")>()),
	inspectReceiverMarker: real.inspectReceiverMarker,
}));
vi.mock("./socket-discovery.ts", async (importOriginal) => ({
	...(await importOriginal<typeof import("./socket-discovery.ts")>()),
	inspectControlSocketPath: real.inspectControlSocketPath,
}));
vi.mock("./socket-probe.ts", async (importOriginal) => ({
	...(await importOriginal<typeof import("./socket-probe.ts")>()),
	probeSocketLiveness: real.probeSocketLiveness,
}));
vi.mock("./pi-retire-request.ts", async (importOriginal) => ({
	...(await importOriginal<typeof import("./pi-retire-request.ts")>()),
	requestPiRetire: real.requestPiRetire,
}));
vi.mock("./cc-retire-request.ts", async (importOriginal) => ({
	...(await importOriginal<typeof import("./cc-retire-request.ts")>()),
	requestCcRetire: real.requestCcRetire,
}));
vi.mock("./retirement-event.ts", async (importOriginal) => ({
	...(await importOriginal<typeof import("./retirement-event.ts")>()),
	appendRetirementEvent: real.appendRetirementEvent,
}));

import type { CcRetireDeps, CcRetireExpected, CcRetireOptions, CcRetireResult } from "./cc-retire-request.ts";
import type { SenderEnvelope } from "./entwurf-control-rpc.ts";
import { type AcquireLockResult, ENTWURF_V2_LOCK_DIR, type LockClaim } from "./entwurf-v2-lock.ts";
import { type RetireDispatchOutcome, type RetireRecordContext, retireCitizen } from "./entwurf-v2-retire.ts";
import { makeProductionRetireDeps, type ProductionRetireSeams } from "./entwurf-v2-retire-production.ts";
import type { ReceiverInspection } from "./entwurf-v2-visible-resume.ts";
import type { MetaIdentity, MetaSenderMarker } from "./meta-session.ts";
import type { PiRetireRequestResult } from "./pi-retire-request.ts";
import type { RetirementEvent } from "./retirement-event.ts";
import { CONTROL_SOCKET_DIR, type TargetSocketInspection } from "./socket-discovery.ts";
import type { SocketLiveness } from "./socket-probe.ts";

const gid = "20261022T060000-abcdef";
const ownerPid = 4242;
const record: MetaIdentity = {
	schemaVersion: 3,
	gardenId: gid,
	backend: "claude-code",
	nativeSessionId: "fixture-native-id",
	cwd: "/fake-only",
	model: null,
	transcriptPath: null,
	createdAt: "2026-10-22T06:00:00.000Z",
	recordUpdatedAt: "2026-10-22T06:00:00.000Z",
	attachIncarnation: "0123456789abcdef0123456789abcdef",
};
const expectedCc: CcRetireExpected = {
	gardenId: gid,
	backend: "claude-code",
	nativeSessionId: record.nativeSessionId,
	createdAt: record.createdAt,
	attachIncarnation: record.attachIncarnation,
};
const claim = { gardenId: gid, nonce: "fake-lock-nonce" } as unknown as LockClaim;

// Opaque sentinels: the factory must hand each back by identity, never reshape it.
const out = {
	acquire: { ok: true, claim } as AcquireLockResult,
	inspect: { kind: "fake-inspection" } as unknown as TargetSocketInspection,
	probe: { liveness: "fake-liveness" } as unknown as SocketLiveness,
	receiver: { kind: "fake-receiver" } as unknown as ReceiverInspection,
	sender: { kind: "fake-sender" } as unknown as MetaSenderMarker,
	pi: { boundary: "fake-pi-result" } as unknown as PiRetireRequestResult,
	cc: { outcome: "fake-cc-result" } as unknown as CcRetireResult,
	caller: { sessionId: "fake-caller" } as unknown as SenderEnvelope,
};

function fakeSeams() {
	const cc: { deps?: CcRetireDeps; options?: CcRetireOptions } = {};
	const appended: { dir: string; event: RetirementEvent }[] = [];
	const seams = {
		acquireLock: vi.fn((_gid: string, _deps: { dir: string }) => out.acquire),
		releaseLock: vi.fn((_claim: LockClaim, _deps: { dir: string }) => "released" as const),
		metaRecordExists: vi.fn((_gid: string, _dir: string) => true),
		readIdentity: vi.fn((_gid: string, _dir: string) => record),
		inspectPath: vi.fn(async (_socketPath: string) => out.inspect),
		probeSocket: vi.fn(async (_socketPath: string) => out.probe),
		inspectReceiver: vi.fn((_gid: string, _dir: string) => out.receiver),
		readSender: vi.fn((_opts: { backend: "claude-code"; ownerPid: number; sendersDir: string }) => out.sender),
		requestPi: vi.fn(
			async (
				_target: MetaIdentity,
				_expected: { gardenId: string; nativeSessionId: string },
				_options: { controlSocketDir: string },
			) => out.pi,
		),
		requestCc: vi.fn(async (_expected: CcRetireExpected, deps: CcRetireDeps, options: CcRetireOptions) => {
			cc.deps = deps;
			cc.options = options;
			return out.cc;
		}),
		append: vi.fn((dir: string, event: RetirementEvent) => {
			appended.push({ dir, event });
			return { bytes: 1 };
		}),
	} satisfies ProductionRetireSeams;
	return { seams, cc, appended };
}

const resolveCaller = async () => out.caller;
const explicit = {
	lockDir: "/fake-only/opts/locks",
	sessionsDir: "/fake-only/opts/sessions",
	receiversDir: "/fake-only/opts/receivers",
	sendersDir: "/fake-only/opts/senders",
	controlSocketDir: "/fake-only/opts/control",
};
const META_ENV = ["ENTWURF_META_SESSIONS_DIR", "ENTWURF_META_RECEIVERS_DIR", "ENTWURF_META_SENDERS_DIR"] as const;

function stubMetaEnv(root: string) {
	vi.stubEnv("ENTWURF_META_SESSIONS_DIR", `${root}/sessions`);
	vi.stubEnv("ENTWURF_META_RECEIVERS_DIR", `${root}/receivers`);
	vi.stubEnv("ENTWURF_META_SENDERS_DIR", `${root}/senders`);
}

/** Drive every returned closure once, plus the CC adapter's three witnesses, and report the
 * directory each seam saw. */
async function observeDirs(
	deps: ReturnType<typeof makeProductionRetireDeps>,
	{ seams, cc }: ReturnType<typeof fakeSeams>,
) {
	for (const spy of Object.values(seams)) spy.mockClear();
	deps.acquireLock(gid);
	deps.releaseLock(claim);
	deps.recordExists(gid);
	deps.readIdentity(gid);
	await deps.requestCc(expectedCc);
	cc.deps?.readRecord(gid);
	cc.deps?.inspectReceiver(gid);
	cc.deps?.readSender(ownerPid);
	return {
		acquire: seams.acquireLock.mock.calls[0]?.[1].dir,
		release: seams.releaseLock.mock.calls[0]?.[1].dir,
		sessions: [seams.metaRecordExists.mock.calls[0]?.[1], ...seams.readIdentity.mock.calls.map((c) => c[1])],
		receivers: seams.inspectReceiver.mock.calls.map((c) => c[1]),
		senders: seams.readSender.mock.calls.map((c) => c[0].sendersDir),
		control: deps.controlSocketDir,
	};
}

beforeEach(() => {
	for (const name of META_ENV) vi.stubEnv(name, undefined);
});

afterEach(() => {
	vi.unstubAllEnvs();
	for (const [name, spy] of Object.entries(real)) {
		expect(spy, `real ${name}`).not.toHaveBeenCalled();
		spy.mockClear();
	}
});

describe("makeProductionRetireDeps — directory binding", () => {
	it("[QK:RETIRE-FACTORY-DIRS-EXPLICIT] binds every explicit directory to exactly the seams that own it", async () => {
		const f = fakeSeams();
		const deps = makeProductionRetireDeps({ resolveCaller, ...explicit, seams: f.seams });
		expect(await observeDirs(deps, f)).toEqual({
			acquire: explicit.lockDir,
			release: explicit.lockDir,
			sessions: [explicit.sessionsDir, explicit.sessionsDir, explicit.sessionsDir],
			receivers: [explicit.receiversDir],
			senders: [explicit.sendersDir],
			control: explicit.controlSocketDir,
		});
		expect(f.seams.acquireLock).toHaveBeenCalledWith(gid, { dir: explicit.lockDir });
		expect(f.seams.releaseLock.mock.calls[0]?.[0]).toBe(claim);
		expect(f.seams.releaseLock).toHaveBeenCalledWith(claim, { dir: explicit.lockDir });
	});

	it("[QK:RETIRE-FACTORY-DIRS-MODULE-LOAD] defaults lock and control-socket directories to the module-load constants", async () => {
		// HOME moves AFTER the modules loaded but BEFORE construction, so a factory that
		// re-derived either directory from HOME at construction would see the moved home.
		vi.stubEnv("HOME", "/fake-only/moved-home");
		expect(os.homedir()).toBe("/fake-only/moved-home");
		const f = fakeSeams();
		const deps = makeProductionRetireDeps({ resolveCaller, seams: f.seams });
		const seen = await observeDirs(deps, f);
		expect(seen.acquire).toBe(ENTWURF_V2_LOCK_DIR);
		expect(seen.release).toBe(ENTWURF_V2_LOCK_DIR);
		expect(seen.control).toBe(CONTROL_SOCKET_DIR);
	});

	it("[QK:RETIRE-FACTORY-DIRS-CONSTRUCTION] reads the three meta directories from the environment once, at construction", async () => {
		stubMetaEnv("/fake-only/env-a");
		const f = fakeSeams();
		const deps = makeProductionRetireDeps({ resolveCaller, seams: f.seams });
		const capturedA = {
			sessions: ["/fake-only/env-a/sessions", "/fake-only/env-a/sessions", "/fake-only/env-a/sessions"],
			receivers: ["/fake-only/env-a/receivers"],
			senders: ["/fake-only/env-a/senders"],
		};
		expect(await observeDirs(deps, f)).toMatchObject(capturedA);

		stubMetaEnv("/fake-only/env-b");
		vi.stubEnv("PI_CODING_AGENT_DIR", "/fake-only/env-b/agent");
		expect(await observeDirs(deps, f)).toMatchObject(capturedA);

		// A NEW construction does see the moved environment: the read is per construction,
		// not per module load and not per call.
		const g = fakeSeams();
		const later = makeProductionRetireDeps({ resolveCaller, seams: g.seams });
		expect(await observeDirs(later, g)).toMatchObject({
			sessions: ["/fake-only/env-b/sessions", "/fake-only/env-b/sessions", "/fake-only/env-b/sessions"],
			receivers: ["/fake-only/env-b/receivers"],
			senders: ["/fake-only/env-b/senders"],
		});
	});
});

describe("makeProductionRetireDeps — adapter options", () => {
	it("[QK:RETIRE-FACTORY-CC-WITNESSES] hands the CC adapter witnesses over the same directories with the exact reader arguments", async () => {
		const f = fakeSeams();
		const deps = makeProductionRetireDeps({ resolveCaller, ...explicit, seams: f.seams });
		await deps.requestCc(expectedCc);
		expect(f.seams.requestCc.mock.calls[0]?.[0]).toBe(expectedCc);
		const ccDeps = f.cc.deps as CcRetireDeps;
		expect(ccDeps.readRecord(gid)).toBe(record);
		expect(ccDeps.inspectReceiver(gid)).toBe(out.receiver);
		expect(ccDeps.readSender(ownerPid)).toBe(out.sender);
		expect(f.seams.readIdentity).toHaveBeenLastCalledWith(gid, explicit.sessionsDir);
		expect(f.seams.inspectReceiver).toHaveBeenLastCalledWith(gid, explicit.receiversDir);
		expect(f.seams.readSender).toHaveBeenLastCalledWith({
			backend: "claude-code",
			ownerPid,
			sendersDir: explicit.sendersDir,
		});
	});

	it("[QK:RETIRE-FACTORY-CC-SIGNAL] passes the request's AbortSignal to the CC adapter by identity and nothing else", async () => {
		const f = fakeSeams();
		const { signal } = new AbortController();
		const deps = makeProductionRetireDeps({ resolveCaller, signal, seams: f.seams });
		await deps.requestCc(expectedCc);
		expect(f.cc.options?.signal).toBe(signal);
		expect(Object.keys(f.cc.options ?? {})).toEqual(["signal"]);

		const g = fakeSeams();
		await makeProductionRetireDeps({ resolveCaller, seams: g.seams }).requestCc(expectedCc);
		expect(g.cc.options).toEqual({ signal: undefined });
	});

	it("[QK:RETIRE-FACTORY-PI-OPTIONS] forwards only the control-socket directory to the Pi adapter", async () => {
		const f = fakeSeams();
		const deps = makeProductionRetireDeps({ resolveCaller, ...explicit, seams: f.seams });
		const expectedPi = { gardenId: gid, nativeSessionId: record.nativeSessionId };
		const options = { controlSocketDir: deps.controlSocketDir, timeoutMs: 1 } as { controlSocketDir: string };
		await deps.requestPi(record, expectedPi, options);
		const [target, expected, passed] = f.seams.requestPi.mock.calls[0] ?? [];
		expect(target).toBe(record);
		expect(expected).toBe(expectedPi);
		expect(passed).toEqual({ controlSocketDir: explicit.controlSocketDir });
	});
});

describe("makeProductionRetireDeps — opaque results", () => {
	it("[QK:RETIRE-FACTORY-OPAQUE] returns every seam's result and the host caller resolver unchanged", async () => {
		const f = fakeSeams();
		const deps = makeProductionRetireDeps({ resolveCaller, ...explicit, seams: f.seams });
		const socketPath = `${explicit.controlSocketDir}/${gid}.sock`;
		expect(deps.resolveCaller).toBe(resolveCaller);
		expect(deps.acquireLock(gid)).toBe(out.acquire);
		expect(deps.releaseLock(claim)).toBe("released");
		expect(deps.readIdentity(gid)).toBe(record);
		expect(await deps.inspectPath(socketPath)).toBe(out.inspect);
		expect(f.seams.inspectPath).toHaveBeenCalledWith(socketPath);
		expect(await deps.probeSocket(socketPath)).toBe(out.probe);
		expect(f.seams.probeSocket).toHaveBeenCalledWith(socketPath);
		expect(await deps.requestPi(record, { gardenId: gid, nativeSessionId: record.nativeSessionId }, explicit)).toBe(
			out.pi,
		);
		expect(await deps.requestCc(expectedCc)).toBe(out.cc);
	});
});

const actorGid = "20261022T060001-abcdef";
const ccContext: RetireRecordContext = { actorGardenId: actorGid, targetGardenId: gid, targetBackend: "claude-code" };
const piContext: RetireRecordContext = { ...ccContext, targetBackend: "pi" };
const EVENT_ID = /^[0-9a-f]{32}$/;
const BASE_KEYS = ["actorGardenId", "at", "eventId", "kind", "targetBackend", "targetGardenId", "v"];

function isIsoInstant(at: unknown): boolean {
	return typeof at === "string" && new Date(at).toISOString() === at;
}

describe("makeProductionRetireDeps — retirement record callbacks", () => {
	it("[QK:RETIRE-FACTORY-RECORD-DIR] derives the sidecar directory once from the captured sessions directory", () => {
		stubMetaEnv("/fake-only/env-a");
		const f = fakeSeams();
		const deps = makeProductionRetireDeps({ resolveCaller, seams: f.seams });
		stubMetaEnv("/fake-only/env-b");
		vi.stubEnv("PI_CODING_AGENT_DIR", "/fake-only/env-b/agent");
		const id = deps.recordRequested(ccContext);
		deps.recordOutcome(id, ccContext, { kind: "unknown", backend: "claude-code", cause: "x" });
		expect(f.appended.map((a) => a.dir)).toEqual([
			"/fake-only/env-a/meta-retirements",
			"/fake-only/env-a/meta-retirements",
		]);

		const g = fakeSeams();
		makeProductionRetireDeps({ resolveCaller, ...explicit, seams: g.seams }).recordRequested(ccContext);
		expect(g.appended[0]?.dir).toBe("/fake-only/opts/meta-retirements");
	});

	it("[QK:RETIRE-FACTORY-RECORD-EVENTS] two closed events share one fresh id and the three attribution fields only", () => {
		const f = fakeSeams();
		const deps = makeProductionRetireDeps({ resolveCaller, ...explicit, seams: f.seams });
		const widened = { ...ccContext, approval: "operator said yes", nativeSessionId: "n", pid: ownerPid };
		const id = deps.recordRequested(widened as RetireRecordContext);
		expect(id).toMatch(EVENT_ID);
		const returned: unknown = deps.recordOutcome(id, widened as RetireRecordContext, {
			kind: "claude-code",
			result: { outcome: "exited", gardenId: gid, pid: ownerPid },
		});
		expect(returned).toBeUndefined();
		expect(f.seams.append).toHaveBeenCalledTimes(2);
		const [requested, outcome] = f.appended.map((a) => a.event as unknown as Record<string, unknown>);
		expect(requested).toEqual({ v: 1, kind: "retirement-requested", eventId: id, at: requested?.at, ...ccContext });
		expect(Object.keys(requested ?? {}).sort()).toEqual(BASE_KEYS);
		expect(outcome).toEqual({
			v: 1,
			kind: "retirement-outcome",
			eventId: id,
			at: outcome?.at,
			...ccContext,
			outcome: { status: "exited", reason: null },
		});
		expect(Object.keys(outcome ?? {}).sort()).toEqual([...BASE_KEYS, "outcome"].sort());
		expect(isIsoInstant(requested?.at)).toBe(true);
		expect(isIsoInstant(outcome?.at)).toBe(true);
		// Random eventId/at are excluded: hex or digits there may contain any substring.
		const semantic = f.appended.map(({ event: { eventId: _id, at: _at, ...rest } }) => rest);
		expect(JSON.stringify(semantic)).not.toMatch(/4242|approval|nativeSessionId|pid/);
		expect(deps.recordRequested(ccContext)).not.toBe(id);
	});

	it("[QK:RETIRE-FACTORY-RECORD-APPEND-FAIL] an append failure propagates and no event id is returned", () => {
		const f = fakeSeams();
		f.seams.append.mockImplementation(() => {
			throw new Error("append failed");
		});
		const deps = makeProductionRetireDeps({ resolveCaller, ...explicit, seams: f.seams });
		expect(() => deps.recordRequested(ccContext)).toThrow("append failed");
		expect(() =>
			deps.recordOutcome("0123456789abcdef0123456789abcdef", ccContext, {
				kind: "unknown",
				backend: "claude-code",
				cause: "x",
			}),
		).toThrow("append failed");
		expect(f.seams.append).toHaveBeenCalledTimes(2);
	});

	it("[QK:RETIRE-FACTORY-SUMMARY] summaries are closed codes: Pi closed reasons, CC reason null, fixed core codes", () => {
		const cases: [RetireRecordContext, RetireDispatchOutcome, { status: string; reason: string | null }][] = [
			[
				piContext,
				{ kind: "pi", result: { boundary: "shutdown-requested" } },
				{ status: "shutdown-requested", reason: null },
			],
			[
				piContext,
				{ kind: "pi", result: { boundary: "refused", phase: "receiver", reason: "target-busy" } },
				{ status: "refused", reason: "target-busy" },
			],
			[
				piContext,
				{ kind: "pi", result: { boundary: "refused", phase: "preflight", reason: "target-identity-mismatch" } },
				{ status: "refused", reason: "target-identity-mismatch" },
			],
			[
				piContext,
				{ kind: "pi", result: { boundary: "unknown", reason: "transport-error" } },
				{ status: "unknown", reason: "transport-error" },
			],
			[
				piContext,
				{ kind: "pi", result: { boundary: "unknown", reason: "future-code" } } as unknown as RetireDispatchOutcome,
				{ status: "unknown", reason: null },
			],
			[
				piContext,
				{
					kind: "pi",
					result: { boundary: "refused", reason: "Free Text: /home/x" },
				} as unknown as RetireDispatchOutcome,
				{ status: "refused", reason: null },
			],
			[
				ccContext,
				{ kind: "claude-code", result: { outcome: "refused", reason: "receiver-dead", detail: "pid 4242 /proc/4242" } },
				{ status: "refused", reason: null },
			],
			[
				ccContext,
				{ kind: "claude-code", result: { outcome: "not-signalled", reason: "cancelled", detail: "secret stderr" } },
				{ status: "not-signalled", reason: null },
			],
			[
				ccContext,
				{ kind: "claude-code", result: { outcome: "unknown", reason: "exit-unobserved", detail: "after go" } },
				{ status: "unknown", reason: null },
			],
			[
				piContext,
				{ kind: "unknown", backend: "pi", cause: "socket reset /tmp/x" },
				{ status: "unknown", reason: "adapter-threw" },
			],
			[
				ccContext,
				{ kind: "unknown", backend: "claude-code", cause: "spawn EACCES" },
				{ status: "unknown", reason: "adapter-threw" },
			],
			[piContext, { kind: "refused", reason: "request-aborted" }, { status: "refused", reason: "request-aborted" }],
			[ccContext, { kind: "refused", reason: "request-aborted" }, { status: "refused", reason: "request-aborted" }],
		];
		for (const [context, outcome, summary] of cases) {
			const f = fakeSeams();
			makeProductionRetireDeps({ resolveCaller, ...explicit, seams: f.seams }).recordOutcome(
				"0123456789abcdef0123456789abcdef",
				context,
				outcome,
			);
			const event = f.appended[0]?.event as unknown as Record<string, unknown>;
			expect(event.outcome).toEqual(summary);
			expect(JSON.stringify(event)).not.toMatch(/detail|cause|4242|secret|stderr|EACCES|\/tmp|\/home/);
		}
	});

	it("[QK:RETIRE-FACTORY-SUMMARY-REFUSE] a non-attempt or cross-backend outcome throws before any append", () => {
		const cases: [RetireRecordContext, RetireDispatchOutcome][] = [
			[ccContext, { kind: "preflight-error", cause: "x" }],
			[ccContext, { kind: "refused", reason: "target-dead" }],
			[ccContext, { kind: "refused", reason: "retirement-record-unavailable" }],
			[ccContext, { kind: "pi", result: { boundary: "shutdown-requested" } }],
			[piContext, { kind: "claude-code", result: { outcome: "exited", gardenId: gid, pid: ownerPid } }],
			[piContext, { kind: "unknown", backend: "claude-code", cause: "x" }],
		];
		for (const [context, outcome] of cases) {
			const f = fakeSeams();
			const deps = makeProductionRetireDeps({ resolveCaller, ...explicit, seams: f.seams });
			expect(() => deps.recordOutcome("0123456789abcdef0123456789abcdef", context, outcome)).toThrow(
				/no retirement summary/,
			);
			expect(f.seams.append).not.toHaveBeenCalled();
		}
	});

	it("[QK:RETIRE-FACTORY-SIGNAL-CAPTURE] the signal is captured once and shared by dispatcher and CC adapter", async () => {
		const first = new AbortController();
		const f = fakeSeams();
		const opts = { resolveCaller, signal: first.signal as AbortSignal | undefined, seams: f.seams };
		const deps = makeProductionRetireDeps(opts);
		opts.signal = new AbortController().signal;
		expect(deps.signal).toBe(first.signal);
		await deps.requestCc(expectedCc);
		expect(f.cc.options?.signal).toBe(first.signal);
		expect(makeProductionRetireDeps({ resolveCaller, seams: fakeSeams().seams }).signal).toBeUndefined();
	});
});

describe("makeProductionRetireDeps × retireCitizen — fake seams through the real core", () => {
	const actorEnvelope: SenderEnvelope = {
		sessionId: actorGid,
		agentId: "attribution-not-permission",
		cwd: "/fake-only",
		timestamp: "2026-10-22T06:00:00.000Z",
		origin: "pi-session",
		replyable: false,
	};
	const socketPath = `${explicit.controlSocketDir}/${gid}.sock`;
	const caller = async () => actorEnvelope;

	it("[QK:RETIRE-FACTORY-CORE-JOIN] requested append, one adapter, outcome append, then one release", async () => {
		for (const backend of ["pi", "claude-code"] as const) {
			const f = fakeSeams();
			f.seams.readIdentity.mockReturnValue({ ...record, backend });
			f.seams.inspectPath.mockResolvedValue({ kind: backend === "pi" ? "socket-file" : "absent", socketPath });
			f.seams.probeSocket.mockResolvedValue("alive");
			f.seams.requestPi.mockResolvedValue({ boundary: "refused", phase: "receiver", reason: "target-busy" });
			f.seams.requestCc.mockResolvedValue({ outcome: "not-signalled", reason: "cancelled", detail: "pid 4242" });
			const got = await retireCitizen(
				gid,
				makeProductionRetireDeps({ resolveCaller: caller, ...explicit, seams: f.seams }),
			);
			const adapter = backend === "pi" ? f.seams.requestPi : f.seams.requestCc;
			const other = backend === "pi" ? f.seams.requestCc : f.seams.requestPi;
			expect(adapter).toHaveBeenCalledTimes(1);
			expect(other).not.toHaveBeenCalled();
			expect(f.seams.append).toHaveBeenCalledTimes(2);
			expect(f.seams.releaseLock).toHaveBeenCalledTimes(1);
			const [appendRequested, appendOutcome] = f.seams.append.mock.invocationCallOrder;
			expect(appendRequested).toBeLessThan(adapter.mock.invocationCallOrder[0] ?? 0);
			expect(adapter.mock.invocationCallOrder[0]).toBeLessThan(appendOutcome ?? 0);
			expect(appendOutcome).toBeLessThan(f.seams.releaseLock.mock.invocationCallOrder[0] ?? 0);
			const [requested, outcome] = f.appended.map((a) => a.event);
			expect(requested?.eventId).toMatch(EVENT_ID);
			expect(outcome?.eventId).toBe(requested?.eventId);
			expect(got.record).toEqual({ status: "complete", eventId: requested?.eventId });
			expect(outcome).toMatchObject({
				actorGardenId: actorGid,
				targetGardenId: gid,
				targetBackend: backend,
				outcome:
					backend === "pi" ? { status: "refused", reason: "target-busy" } : { status: "not-signalled", reason: null },
			});
			expect(got.release).toEqual({ status: "released" });
		}
	});

	it("[QK:RETIRE-FACTORY-CORE-REQUESTED-FAIL] a failing requested append refuses with no adapter and one release", async () => {
		const f = fakeSeams();
		f.seams.inspectPath.mockResolvedValue({ kind: "absent", socketPath });
		f.seams.append.mockImplementation(() => {
			throw new Error("append failed after partial bytes");
		});
		const got = await retireCitizen(
			gid,
			makeProductionRetireDeps({ resolveCaller: caller, ...explicit, seams: f.seams }),
		);
		expect(got.outcome).toEqual({ kind: "refused", reason: "retirement-record-unavailable" });
		expect(got.record).toEqual({ status: "requested-append-error", cause: "append failed after partial bytes" });
		expect(f.seams.requestCc).not.toHaveBeenCalled();
		expect(f.seams.requestPi).not.toHaveBeenCalled();
		expect(f.seams.append).toHaveBeenCalledTimes(1);
		expect(f.seams.releaseLock).toHaveBeenCalledTimes(1);
	});
});
