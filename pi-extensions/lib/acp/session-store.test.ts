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
	buildSessionRecord,
	configDrift,
	decideResident,
	hasAcpTrace,
	parseSessionRecord,
	readSessionRecord,
	residentConfigFacts,
	resolveLifecyclePolicy,
	sessionRecordPath,
	withVendorCompaction,
	writeSessionRecord,
} from "./session-store.ts";
import { DEFAULT_CLAUDE_PERMISSION_ALLOW } from "./tool-surface.ts";

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
		sealedTurnId: "entwurf-turn:last",
		config: { mcpServers: "m", text: "t", tools: "x" },
	},
	"2026-11-20T00:00:00Z",
);

const facts = {
	cwd: "/fixture",
	modelId: "model",
	bridgeConfigSignature: "sig",
	contextMessageSignatures: ["a", "b"],
	config: { mcpServers: "m", text: "t", tools: "x" },
};
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
			stop: "version",
		});
		// A current-version record that omits the field is not read as sealed either.
		writeFileSync(path, JSON.stringify(withoutField));
		expect(readSessionRecord("test", dir)).toEqual({ status: "invalid" });
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

it("[QK:ACP-VENDOR-COMPACT-RECORD-PARSE] the vendor compaction slot round-trips; a value this build does not know makes the record invalid; no slot is a valid record", () => {
	const slotted = withVendorCompaction(
		record,
		{ compactionEntryId: "c-1", acpSessionId: "acp", state: "done", effect: "unconfirmed" },
		"2026-11-25T00:00:00Z",
	);
	expect(parseSessionRecord(JSON.parse(JSON.stringify(slotted)), "test")).toEqual(slotted);
	const sent = withVendorCompaction(record, { compactionEntryId: "c-1", acpSessionId: "acp", state: "sent" }, "t");
	expect(parseSessionRecord(JSON.parse(JSON.stringify(sent)), "test")?.vendorCompaction).toEqual({
		compactionEntryId: "c-1",
		acpSessionId: "acp",
		state: "sent",
	});
	// The builder every writer goes through carries it too.
	const { version: _v, provider: _p, updatedAt: _u, ...facts } = slotted;
	expect(buildSessionRecord(facts, "2026-11-25T00:00:00Z")).toEqual(slotted);
	// Absent: a record of an older writer, or one an older reader rewrote. Valid, with nothing suppressed.
	expect(parseSessionRecord(JSON.parse(JSON.stringify(record)), "test")?.vendorCompaction).toBeUndefined();
	for (const bad of [
		{ compactionEntryId: "c-1", acpSessionId: "acp", state: "queued" },
		{ compactionEntryId: "c-1", acpSessionId: "acp", state: "done" },
		{ compactionEntryId: "c-1", acpSessionId: "acp", state: "sent", effect: "confirmed" },
		{ compactionEntryId: "c-1", acpSessionId: "acp", state: "done", effect: "maybe" },
		{ compactionEntryId: "", acpSessionId: "acp", state: "sent" },
		{ compactionEntryId: "c-1", state: "sent" },
		"done",
		null,
	]) {
		expect(
			parseSessionRecord({ ...JSON.parse(JSON.stringify(record)), vendorCompaction: bad }, "test"),
			JSON.stringify(bad),
		).toBeUndefined();
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

	it("[QK:ACP-RESIDENT-GUARD] a birth needs every sign of an earlier session to be absent; a stored session is resumed or stops, never replaced", () => {
		expect(decideResident(facts, { record: missing, reserved: no, hasTrace: no })).toEqual({ kind: "birth" });
		const stored = (over: Record<string, unknown>) =>
			decideResident(facts, {
				record: { status: "found", record: { ...record, ...over } as typeof record },
				reserved: no,
				hasTrace: no,
			});
		// A sealed record that names its last answer is the session to resume, with or without a standing marker.
		const marker = {
			start: 0,
			count: 1,
			contextMessageSignatures: ["a"],
			turnId: "entwurf-turn:m",
			inputEntryIds: ["e"],
		};
		expect(stored({})).toEqual({
			kind: "attach",
			record,
			closeLive: false,
			mcpServersChanged: false,
		});
		expect(stored({ pendingDispatch: marker })).toMatchObject({ kind: "attach" });
		// What cannot be resumed stops by name. None of these is followed by a birth.
		expect(stored({ firstPrompt: "pending" })).toMatchObject({ kind: "stop", stop: "resume" });
		expect(stored({ firstPrompt: "dispatched", pendingDispatch: marker })).toMatchObject({
			kind: "stop",
			stop: "firstUnknown",
		});
		expect(stored({ sealedTurnId: undefined })).toMatchObject({ kind: "stop", stop: "version" });
		expect(stored({ modelId: "other" })).toMatchObject({ kind: "stop", stop: "model" });
		expect(stored({ cwd: "/elsewhere" })).toMatchObject({ kind: "stop", stop: "cwd" });
		expect(decideResident(facts, { record: { status: "outdated" }, reserved: no, hasTrace: no })).toMatchObject({
			kind: "stop",
			stop: "version",
		});
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
		).toMatchObject({ kind: "attach", closeLive: false });
	});

	it("[QK:ACP-RESIDENT-CONFIG-CLASSES] a changed MCP server set resumes the session with the new set, a changed text keeps a live session and stops a stored one, anything else stops", () => {
		const now = (config: Partial<typeof facts.config>) => ({
			...facts,
			bridgeConfigSignature: "sig-now",
			config: { ...facts.config, ...config },
		});
		expect(configDrift(record, facts)).toBe("same");
		// Equal signatures are the same whatever the parts say; without recorded parts a difference has no name.
		expect(configDrift(record, { ...facts, config: { mcpServers: "M2", text: "T2", tools: "X2" } })).toBe("same");
		expect(configDrift({ bridgeConfigSignature: "sig" }, now({ mcpServers: "M2" }))).toBe("other");
		expect(configDrift(record, now({ mcpServers: "M2" }))).toBe("mcpServers");
		expect(configDrift(record, now({ text: "T2" }))).toBe("text");
		expect(configDrift(record, now({ tools: "X2" }))).toBe("other");
		expect(configDrift(record, now({ mcpServers: "M2", text: "T2" }))).toBe("other");
		expect(configDrift(record, now({}))).toBe("other");
		const turn = (params: typeof facts, existing?: typeof live) =>
			decideResident(params, { existing, record: { status: "found", record }, reserved: no, hasTrace: no });
		// Stored: a changed server set resumes under the same carrier. A changed text does not: a resume
		// request would carry a carrier the session was not opened with.
		expect(turn(now({ mcpServers: "M2" }))).toMatchObject({ kind: "attach", mcpServersChanged: true });
		expect(turn(now({ text: "T2" }))).toMatchObject({ kind: "stop", stop: "config" });
		expect(turn(now({ tools: "X2" }))).toMatchObject({ kind: "stop", stop: "config" });
		// Live: a text change keeps the session as it is; an MCP change closes it and resumes from the record.
		expect(turn(now({ text: "T2" }), live)).toEqual({ kind: "reuse", textDrift: true });
		expect(turn(now({ mcpServers: "M2" }), live)).toMatchObject({ kind: "attach", closeLive: true });
		expect(turn(now({ tools: "X2" }), live)).toMatchObject({ kind: "stop", stop: "config" });
		// A live session with an MCP change and no record to resume from stops and is kept.
		expect(
			decideResident(now({ mcpServers: "M2" }), { existing: live, record: missing, reserved: no, hasTrace: no }),
		).toMatchObject({ kind: "stop", stop: "noRecord" });
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
		).toMatchObject({ kind: "attach" });
		expect(decideResident(facts, { existing: live, record: missing, reserved: boom, hasTrace: boom })).toEqual({
			kind: "reuse",
			textDrift: false,
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
		expect(turn({})).toEqual({ kind: "reuse", textDrift: false });
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

describe("a stored session a build before #176 opened under mcp__* (GLG 2026-11-26: a bump alone asks for no /new)", () => {
	// Oracle: the allow lists as written, copied rather than derived: v0.63.0's default
	// (`git show v0.63.0:pi-extensions/lib/acp/config.ts:113`) and this build's. The #176 review composed the
	// stop this resolves (2026-11-26): a 0.109.0 record under the first met the second with `stop: "config"`.
	const V063_DEFAULT_ALLOW = ["Read(*)", "Bash(*)", "Edit(*)", "Write(*)", "mcp__*"];
	const NOW_DEFAULT_ALLOW = ["Read(*)", "Bash(*)", "Edit(*)", "Write(*)", "mcp__entwurf-bridge__*"];
	const TOOLS = ["Read", "Bash", "Edit", "Write"];
	const input = (
		permissionAllow: string[],
		tools: string[] = TOOLS,
		over: { appendSystemPrompt?: string; mcpServersHash?: string } = {},
	) => ({
		backend: "claude",
		modelId: "claude-sonnet-5-5",
		nativeModelId: "claude-sonnet-5-5",
		appendSystemPrompt: over.appendSystemPrompt ?? "carrier",
		mcpServersHash: over.mcpServersHash ?? "servers",
		settingSources: [],
		strictMcpConfig: true,
		tools,
		skillPlugins: [],
		permissionAllow,
		disallowedTools: ["AskUserQuestion"],
		extra: {},
	});
	const storedUnder = (allow: string[]) => {
		const was = residentConfigFacts(input(allow));
		return {
			status: "found",
			record: { ...record, bridgeConfigSignature: was.bridgeConfigSignature, config: was.config },
		} as const;
	};
	const turn = (now: ReturnType<typeof input>, stored: ReturnType<typeof storedUnder>) =>
		decideResident({ ...facts, ...residentConfigFacts(now) }, { record: stored, reserved: no, hasTrace: no });

	it("[QK:ACP-RESUME-BEFORE-176-ALLOW] a stored session opened under mcp__* is resumed under mcp__entwurf-bridge__*, Skill(*) and all", () => {
		expect([...DEFAULT_CLAUDE_PERMISSION_ALLOW]).toEqual(NOW_DEFAULT_ALLOW);
		expect(turn(input(NOW_DEFAULT_ALLOW), storedUnder(V063_DEFAULT_ALLOW))).toMatchObject({ kind: "attach" });
		expect(
			turn(input([...NOW_DEFAULT_ALLOW, "Skill(*)"]), storedUnder([...V063_DEFAULT_ALLOW, "Skill(*)"])),
		).toMatchObject({ kind: "attach" });
		// What this build writes is attached as before.
		expect(turn(input(NOW_DEFAULT_ALLOW), storedUnder(NOW_DEFAULT_ALLOW))).toMatchObject({ kind: "attach" });
	});

	it("[QK:ACP-RESUME-BEFORE-176-EXACT] only that respelling is read away: every other difference is judged as before, and a live session never reads it", () => {
		const now = input(NOW_DEFAULT_ALLOW);
		// Judged as before: an MCP server change alone resumes with the new set; a changed carrier stops.
		expect(
			turn(input(NOW_DEFAULT_ALLOW, TOOLS, { mcpServersHash: "servers-2" }), storedUnder(V063_DEFAULT_ALLOW)),
		).toMatchObject({ kind: "attach", mcpServersChanged: true });
		expect(
			turn(input(NOW_DEFAULT_ALLOW, TOOLS, { appendSystemPrompt: "carrier-2" }), storedUnder(V063_DEFAULT_ALLOW)),
		).toMatchObject({ kind: "stop", stop: "config" });
		expect(turn(input(NOW_DEFAULT_ALLOW, [...TOOLS, "Skill"]), storedUnder(V063_DEFAULT_ALLOW))).toMatchObject({
			kind: "stop",
			stop: "config",
		});
		expect(turn(now, storedUnder(["Read(*)", "Bash(*)", "Edit(*)", "Write(*)", "mcp__github__*"]))).toMatchObject({
			kind: "stop",
			stop: "config",
		});
		// Nothing to respell without the bridge rule.
		expect(residentConfigFacts(input(["Read(*)"])).before176).toBeUndefined();
		// A live session was opened by this build: the respelling is never read for it.
		const liveBefore = {
			...facts,
			...residentConfigFacts(input(V063_DEFAULT_ALLOW)),
			contextMessageSignatures: ["a"],
			alive: true,
		};
		expect(
			decideResident(
				{ ...facts, ...residentConfigFacts(now) },
				{ existing: liveBefore, record: storedUnder(V063_DEFAULT_ALLOW), reserved: no, hasTrace: no },
			),
		).toMatchObject({ kind: "stop", stop: "config" });
	});
});
