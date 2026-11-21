import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import {
	ACP_HOST_FACTS_KEY,
	readAcpHostFacts,
	reportAcpHostMode,
	reportEntwurfControlFlag,
} from "../acp-host-facts.ts";
import {
	type BootstrapParams,
	buildSessionRecord,
	decideBootstrap,
	decideResident,
	hasAcpTrace,
	parseSessionRecord,
	readSessionRecord,
	recordIsBehind,
	resolveLifecyclePolicy,
	type SealedSessionRecord,
	sessionRecordPath,
	writeSessionRecord,
} from "./session-store.ts";

const record = buildSessionRecord(
	{
		sessionKey: "test",
		acpSessionId: "acp",
		writer: { name: "fixture-agent", version: "1.2.3" },
		firstPrompt: "sealed",
		cwd: "/fixture",
		modelId: "model",
		bridgeConfigSignature: "sig",
		contextMessageSignatures: [],
	},
	"2026-11-20T00:00:00Z",
);

const facts = { cwd: "/fixture", modelId: "model", bridgeConfigSignature: "sig", contextMessageSignatures: ["a", "b"] };
const no = () => false;
const yes = () => true;

it("[QK:ACP-ORACLE-L15-INVALID] invalid JSON and invalid schema are named and preserved", () => {
	const dir = mkdtempSync(join(tmpdir(), "acp-l15-"));
	try {
		const file = sessionRecordPath("test", dir);
		for (const text of ["{bad", JSON.stringify({ ...record, provider: "wrong" })]) {
			writeFileSync(file, text);
			expect(readSessionRecord("test", dir)).toEqual({ status: "invalid" });
			expect(readFileSync(file, "utf8")).toBe(text);
		}
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

it("[QK:ACP-ORACLE-L15-UNREADABLE] missing and unreadable records are distinguished without mutation", () => {
	const dir = mkdtempSync(join(tmpdir(), "acp-l15-"));
	try {
		expect(readSessionRecord("test", dir)).toEqual({ status: "missing" });
		const path = sessionRecordPath("test", dir);
		mkdirSync(path);
		writeFileSync(join(path, "keep"), "evidence");
		expect(readSessionRecord("test", dir)).toMatchObject({ status: "unreadable", code: "EISDIR" });
		expect(readFileSync(join(path, "keep"), "utf8")).toBe("evidence");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

it("[QK:ACP-ORACLE-L15-ATOMIC] replace occurs via same-directory rename, never overwriting a symlink target", () => {
	const dir = mkdtempSync(join(tmpdir(), "acp-l15-"));
	try {
		const path = sessionRecordPath("test", dir);
		const original = join(dir, "original");
		writeFileSync(original, "untouched");
		symlinkSync(original, path);
		writeSessionRecord(record, dir);
		expect(readFileSync(original, "utf8")).toBe("untouched");
		expect(readSessionRecord("test", dir)).toEqual({ status: "found", record });
		rmSync(path);
		mkdirSync(path);
		writeFileSync(join(path, "keep"), "unchanged");
		expect(() => writeSessionRecord(record, dir)).toThrow();
		expect(readFileSync(join(path, "keep"), "utf8")).toBe("unchanged");
		expect(readdirSync(dir).filter((name) => name.endsWith(".tmp"))).toEqual([]);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

it("[QK:ACP-ORACLE-L15-AGENT-DIR] default record path follows Pi's configured agent directory", () => {
	const dir = mkdtempSync(join(tmpdir(), "acp-l15-"));
	const previous = process.env.PI_CODING_AGENT_DIR;
	try {
		process.env.PI_CODING_AGENT_DIR = join(dir, "profile");
		expect(sessionRecordPath("test")).toBe(
			sessionRecordPath("test", join(dir, "profile", "cache", "entwurf", "sessions")),
		);
	} finally {
		if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
		else process.env.PI_CODING_AGENT_DIR = previous;
		rmSync(dir, { recursive: true, force: true });
	}
});

// --- #171 L16: the dispatch marker in the record -------------------------------------------------

it("[QK:ACP-L16-OUTDATED] a record written before the marker existed reads as outdated, stays, and is never attached", () => {
	const dir = mkdtempSync(join(tmpdir(), "acp-l16-"));
	try {
		const { pendingDispatch: _absent, ...withoutField } = record;
		const path = sessionRecordPath("test", dir);
		const v1 = JSON.stringify({ ...withoutField, version: 1 });
		writeFileSync(path, v1);
		expect(readSessionRecord("test", dir)).toEqual({ status: "outdated" });
		expect(readFileSync(path, "utf8")).toBe(v1);
		// Not evidence that nothing is pending. It still names a session, so it is never followed by a birth.
		expect(decideResident(facts, { record: { status: "outdated" }, reserved: no, hasTrace: no })).toMatchObject({
			kind: "stop",
			stop: "interim",
		});
		// A current-version record that omits the field is not read as sealed either.
		writeFileSync(path, JSON.stringify(withoutField));
		expect(readSessionRecord("test", dir)).toEqual({ status: "invalid" });
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

it("a marker round-trips only when its range ends at its own signature count", () => {
	const marked = buildSessionRecord(
		{ ...record, pendingDispatch: { start: 1, count: 2, contextMessageSignatures: ["s0", "s1", "s2"] } },
		record.updatedAt,
	);
	expect(parseSessionRecord(JSON.parse(JSON.stringify(marked)), "test")).toEqual(marked);
	for (const pendingDispatch of [
		{ start: 1, count: 1, contextMessageSignatures: ["s0", "s1", "s2"] },
		{ start: -1, count: 4, contextMessageSignatures: ["s0", "s1", "s2"] },
		{ start: 0.5, count: 2.5, contextMessageSignatures: ["s0", "s1", "s2"] },
		{ start: 0, count: 1, contextMessageSignatures: [1] },
		"pending",
	]) {
		expect(parseSessionRecord({ ...marked, pendingDispatch }, "test")).toBeUndefined();
	}
	// The two facts a record states beside its marker are required and closed.
	for (const broken of [
		{ ...marked, writer: undefined },
		{ ...marked, writer: { name: "", version: "1" } },
		{ ...marked, writer: { name: "a" } },
		{ ...marked, firstPrompt: "done" },
		{ ...marked, firstPrompt: undefined },
	]) {
		expect(parseSessionRecord(broken, "test")).toBeUndefined();
	}
});

describe("a sealed record against the transcript after it (#171 L16 rule 6, R12)", () => {
	const roles = (tail: string) => ["system", "user", ...tail.split(" ").map((r) => (r === "A" ? "assistant" : "user"))];
	const sigs = (n: number) => Array.from({ length: n }, (_, i) => `sig-${i}`);
	const sealed: SealedSessionRecord = { ...record, contextMessageSignatures: sigs(2), pendingDispatch: null };
	const params = (tail: string): BootstrapParams => {
		const messageRoles = roles(tail);
		return {
			cwd: record.cwd,
			modelId: record.modelId,
			bridgeConfigSignature: record.bridgeConfigSignature,
			contextMessageSignatures: sigs(messageRoles.length),
			lifecyclePolicy: "process-scoped",
			messageRoles,
		};
	};

	it("[QK:ACP-L16-RECORD-BEHIND] is behind when a user message is followed by an assistant, and current otherwise", () => {
		// The tail as R12 measured it after a record of 2 signatures: A is the sealed turn's own answer.
		const cells: Array<[string, string]> = [
			["A U", "resume"], // one turn, one input; also an answered cancel, A(aborted)
			["A U U", "resume"], // steering or follow-ups queued together
			["U", "resume"], // after max_tokens Pi omits the cut answer
			["A A U", "resume"], // a custom steer answered twice
			["A U A U", "new"], // a turn ran that the record never sealed
			["A U A U A U", "new"], // R11: a record of one turn against four
		];
		for (const [tail, path] of cells) {
			const messageRoles = roles(tail);
			expect(recordIsBehind(2, messageRoles), tail).toBe(path === "new");
			const decision = decideBootstrap(params(tail), {
				persisted: sealed,
				capabilities: { resumeSession: true, loadSession: false },
			});
			expect(decision.path, tail).toBe(path);
			if (path === "new") expect(decision).toMatchObject({ invalidatePersisted: true, reason: "persisted_behind" });
		}
	});
});

it("[QK:ACP-D18-HOST-LIFECYCLE] only a reported control flag keeps a session, only a Pi-reported one-shot mode opens one per turn", () => {
	for (const mode of ["tui", "rpc", "json", "print", undefined] as const) {
		expect(resolveLifecyclePolicy({ controlEnabled: true, mode }), String(mode)).toBe("process-scoped");
	}
	for (const controlEnabled of [false, undefined]) {
		expect(resolveLifecyclePolicy({ controlEnabled, mode: "print" })).toBe("turn-scoped");
		expect(resolveLifecyclePolicy({ controlEnabled, mode: "json" })).toBe("turn-scoped");
		expect(resolveLifecyclePolicy({ controlEnabled, mode: "tui" })).toBe("unhosted");
		expect(resolveLifecyclePolicy({ controlEnabled, mode: "rpc" })).toBe("unhosted");
		// A mode Pi has not reported is not read as a one-shot.
		expect(resolveLifecyclePolicy({ controlEnabled, mode: undefined })).toBe("unhosted");
	}
});

it("[QK:ACP-D18-FACTS-NOT-ARGV] the control flag is the owner's parsed report: a literal token in argv grants nothing", () => {
	const host = {};
	const argv = process.argv;
	// `pi -- --entwurf-control`: Pi reads the token as a prompt, so the control extension reports false.
	process.argv = [...argv, "--", "--entwurf-control"];
	try {
		expect(readAcpHostFacts(host)).toEqual({ controlEnabled: undefined, mode: undefined });
		expect(resolveLifecyclePolicy(readAcpHostFacts(host))).toBe("unhosted");
		reportEntwurfControlFlag(false, host);
		reportAcpHostMode("tui", host);
		expect(resolveLifecyclePolicy(readAcpHostFacts(host))).toBe("unhosted");
		reportEntwurfControlFlag(true, host);
		expect(resolveLifecyclePolicy(readAcpHostFacts(host))).toBe("process-scoped");
	} finally {
		process.argv = argv;
	}
	// A value of the wrong shape reads as not reported.
	const forged = { [ACP_HOST_FACTS_KEY]: { controlEnabled: "true", mode: "resident" } };
	expect(readAcpHostFacts(forged)).toEqual({ controlEnabled: undefined, mode: undefined });
});

// --- #171 step 8: the resident guard ------------------------------------------------------------

describe("what a resident's turn may do (#171 step 8, decision 17)", () => {
	const missing = { status: "missing" } as const;
	const live = { ...facts, contextMessageSignatures: ["a"], alive: true };

	it("[QK:ACP-RESIDENT-GUARD] a birth needs every sign of an earlier session to be absent; a stored session is never replaced", () => {
		expect(decideResident(facts, { record: missing, reserved: no, hasTrace: no })).toEqual({ kind: "birth" });
		// A stored session, whatever it carries: sealed, marked, or written before the marker existed.
		const marked = { ...record, pendingDispatch: { start: 0, count: 1, contextMessageSignatures: ["a"] } };
		for (const found of [
			{ status: "found", record },
			{ status: "found", record: marked },
			{ status: "outdated" },
		] as const) {
			expect(decideResident(facts, { record: found, reserved: no, hasTrace: no })).toMatchObject({
				kind: "stop",
				stop: "interim",
			});
		}
		expect(decideResident(facts, { record: { status: "invalid" }, reserved: no, hasTrace: no })).toMatchObject({
			kind: "stop",
			stop: "invalid",
		});
		expect(
			decideResident(facts, { record: { status: "unreadable", code: "EACCES" }, reserved: no, hasTrace: no }),
		).toMatchObject({ kind: "stop", stop: "unreadable", code: "EACCES" });
		// A dead session object is no live session: the record decides.
		expect(
			decideResident(facts, {
				existing: { ...live, alive: false },
				record: { status: "found", record },
				reserved: no,
				hasTrace: no,
			}),
		).toMatchObject({ kind: "stop", stop: "interim" });
	});

	it("[QK:ACP-RESIDENT-RESERVED-STOPS] a birth that was attempted and left no record is never attempted again", () => {
		expect(decideResident(facts, { record: missing, reserved: yes, hasTrace: no })).toMatchObject({
			kind: "stop",
			stop: "intent",
		});
		// With a record the reservation is not even read: the record names the session.
		const boom = () => {
			throw new Error("not read");
		};
		expect(
			decideResident(facts, { record: { status: "found", record }, reserved: boom, hasTrace: boom }),
		).toMatchObject({
			stop: "interim",
		});
		expect(decideResident(facts, { existing: live, record: missing, reserved: boom, hasTrace: boom })).toEqual({
			kind: "reuse",
		});
	});

	it("[QK:ACP-RESIDENT-HISTORY-STOPS] ACP history with neither a record nor a reservation is a fork, an import or a lost record: no birth", () => {
		expect(decideResident(facts, { record: missing, reserved: no, hasTrace: yes })).toMatchObject({
			kind: "stop",
			stop: "noRecord",
		});
	});

	it("[QK:ACP-RESIDENT-LIVE-KEPT] a live session that cannot take the turn stops it by name and is never abandoned for a new one", () => {
		const turn = (over: Partial<typeof facts>) =>
			decideResident({ ...facts, ...over }, { existing: live, record: missing, reserved: no, hasTrace: no });
		expect(turn({})).toEqual({ kind: "reuse" });
		expect(turn({ modelId: "other" })).toMatchObject({ kind: "stop", stop: "model" });
		expect(turn({ cwd: "/elsewhere" })).toMatchObject({ kind: "stop", stop: "cwd" });
		expect(turn({ bridgeConfigSignature: "changed" })).toMatchObject({ kind: "stop", stop: "config" });
		expect(turn({ contextMessageSignatures: ["z", "b"] })).toMatchObject({ kind: "stop", stop: "changed" });
	});

	it("[QK:ACP-TRACE-ANY-ANSWER] every Entwurf answer is ACP history, failed and aborted ones too; only a stop proven to precede any session is not", () => {
		const answer = (over: Record<string, unknown>) => ({
			type: "message",
			message: { role: "assistant", provider: "entwurf", stopReason: "stop", content: [], ...over },
		});
		const proven = (message: unknown) => (message as { errorMessage?: unknown }).errorMessage === "proven";
		expect(hasAcpTrace([], proven)).toBe(false);
		expect(hasAcpTrace([{ type: "message", message: { role: "user", content: "hi" } }], proven)).toBe(false);
		expect(hasAcpTrace([answer({ provider: "openai" })], proven)).toBe(false);
		expect(hasAcpTrace([answer({})], proven)).toBe(true);
		expect(hasAcpTrace([answer({ stopReason: "length" })], proven)).toBe(true);
		// A turn that failed or was cut may have reached a vendor session: partial text, tools, no diagnostic.
		expect(hasAcpTrace([answer({ stopReason: "error", errorMessage: "the agent stopped" })], proven)).toBe(true);
		expect(hasAcpTrace([answer({ stopReason: "error" })], proven)).toBe(true);
		expect(hasAcpTrace([answer({ stopReason: "aborted" })], proven)).toBe(true);
		// With no proof offered nothing is excused, and a completed answer is never excused.
		expect(hasAcpTrace([answer({ stopReason: "error", errorMessage: "proven" })])).toBe(true);
		expect(hasAcpTrace([answer({ stopReason: "stop", errorMessage: "proven" })], proven)).toBe(true);
		// The exception, for a failed and for an aborted turn, and it does not hide a real answer beside it.
		const stopped = answer({ stopReason: "error", errorMessage: "proven" });
		expect(hasAcpTrace([stopped, answer({ stopReason: "aborted", errorMessage: "proven" })], proven)).toBe(false);
		expect(hasAcpTrace([stopped, answer({})], proven)).toBe(true);
		expect(
			hasAcpTrace(
				[
					answer({
						stopReason: "error",
						errorMessage: "proven",
						diagnostics: [{ type: "entwurf_acp_prompt_rejection" }],
					}),
				],
				proven,
			),
		).toBe(true);
		expect(hasAcpTrace([{ type: "custom", customType: "entwurf-acp-compaction", data: {} }], proven)).toBe(true);
		expect(hasAcpTrace([{ type: "custom", customType: "someone-else", data: {} }, null, 7], proven)).toBe(false);
	});

	it("[QK:ACP-RECORD-DURABLE] a record write reaches the disk before it returns: the bytes before the rename, the directory after it, the chain above once", () => {
		const dir = mkdtempSync(join(tmpdir(), "acp-durable-"));
		try {
			const path = sessionRecordPath("test", dir);
			const calls: string[] = [];
			const sync = {
				// At the file sync the previous record is still the one in place.
				file: () =>
					void calls.push(`file:${existsSync(path) ? readFileSync(path, "utf8").includes('"acp"') : "absent"}`),
				directory: (at: string) => void calls.push(at),
			};
			const above: string[] = [];
			for (let at = dirname(dir); ; at = dirname(at)) {
				above.push(at);
				if (at === dirname(at)) break;
			}
			const thisProcess = new Set<string>();
			writeSessionRecord(record, dir, sync, thisProcess);
			expect(calls).toEqual(["file:absent", dir, ...above]);
			calls.length = 0;
			writeSessionRecord({ ...record, acpSessionId: "acp-next" }, dir, sync, thisProcess);
			// `true`: the previous record was still the one in place when the new bytes were synced.
			expect(calls).toEqual(["file:true", dir]);
			// A failed file sync throws and leaves the previous record as it was, with no temp file behind.
			const before = readFileSync(path, "utf8");
			const broken = {
				file: () => {
					throw Object.assign(new Error("io"), { code: "EIO" });
				},
				directory: () => undefined,
			};
			expect(() => writeSessionRecord(record, dir, broken, thisProcess)).toThrow(
				expect.objectContaining({ code: "EIO" }),
			);
			expect(readFileSync(path, "utf8")).toBe(before);
			expect(readdirSync(dir)).toHaveLength(1);
			// A failed directory sync throws too: the caller is never told a write is safe when it is not.
			const brokenDir = {
				file: () => undefined,
				directory: () => {
					throw Object.assign(new Error("io"), { code: "EIO" });
				},
			};
			expect(() => writeSessionRecord(record, dir, brokenDir, new Set())).toThrow(
				expect.objectContaining({ code: "EIO" }),
			);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});
