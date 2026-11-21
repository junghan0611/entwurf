/**
 * The claude child launches with Claude Code's own background-task switch on (#125): the vendor
 * stops offering its Bash/Agent `run_in_background` option and stops auto-backgrounding on timeout
 * or turn abort. A process a command detaches on its own is outside that switch. The oracle below is
 * the literal key and value, never `CLAUDE_FOREGROUND_ONLY_ENV`, so a change to the constant cannot
 * move its own check.
 *
 * The claude adapter alone reads a vendor prompt rejection (#127): the `incomplete_tool_call`
 * vocabulary belongs to claude-agent-acp, so a capability check — not a backend-name branch in the
 * common loop — keeps it from capturing another backend's failures.
 *
 * The claude adapter reads its set-model answer back before the prompt (#128). The rows below are
 * the shape claude-agent-acp 0.85.1 answered on 2026-10-12, copied as literals so a change to the
 * adapter's declared names cannot move its own oracle. No vendor runtime is certified here.
 */
import { readFileSync } from "node:fs";
import { RequestError } from "@agentclientprotocol/sdk";
import { isRetryableAssistantError } from "@earendil-works/pi-ai/compat";
import { describe, expect, it } from "vitest";
import {
	type AcpAgentFacts,
	AGY_ACP_AGENT,
	admitAcpAgent,
	agyAdapter,
	attachAllowed,
	bootstrapCapabilities,
	CLAUDE_ACP_AGENT,
	claudeAdapter,
	cortexAdapter,
	INCOMPLETE_TOOL_CALL_VERDICT,
	readAgentFacts,
} from "./backend-adapter.ts";
import { CLAUDE_CONFIG_OVERLAY_DIR } from "./overlay.ts";

describe("ACP launch env — claude foreground-only", () => {
	it("[QK:ACP-CLAUDE-FOREGROUND-ONLY] the claude child is launched with Claude Code's background-task switch on, beside its config overlay", () => {
		expect(claudeAdapter.launchEnvDefaults()).toEqual({
			CLAUDE_CONFIG_DIR: CLAUDE_CONFIG_OVERLAY_DIR,
			CLAUDE_CODE_DISABLE_BACKGROUND_TASKS: "1",
		});
	});

	it("the disabled Cortex adapter refuses its launch environment", () => {
		expect(() => cortexAdapter.launchEnvDefaults()).toThrow(/cortex-acp-disabled/);
	});
});

describe("ACP session settings — claude idle compaction", () => {
	it("[QK:ACP-CLAUDE-NO-IDLE-COMPACTION] claude session settings turn off only the adapter's idle compaction, never in-prompt compaction", () => {
		const config = {
			tools: ["Read"],
			permissionAllow: ["Read(*)"],
			disallowedTools: [],
			settingSources: [],
			strictMcpConfig: true,
			skillPlugins: [],
		} as never;
		const meta = claudeAdapter.buildSessionMeta(
			{ modelId: "claude-opus-5-5", nativeModelId: "claude-opus-5-5", config },
			null,
		) as { claudeCode: { options: { settings: Record<string, unknown> } } };
		const settings = meta.claudeCode.options.settings;
		expect(settings.idleCompaction).toBe(false);
		expect("autoCompactEnabled" in settings).toBe(false);
	});
});

describe("ACP prompt rejection — claude-only capability", () => {
	it("[QK:ACP-PROMPT-REJECTION-CLAUDE-ONLY] only claude reads a vendor prompt rejection, and only the typed incomplete_tool_call one", () => {
		const data = { errorKind: "incomplete_tool_call" };
		const typed = new RequestError(
			-32603,
			"Internal error: Claude ended the turn without returning results for tool calls: t",
			data,
		);
		const read = claudeAdapter.readPromptRejection?.(typed);
		expect(read?.errorKind).toBe("incomplete_tool_call");
		expect(read?.verdict).toBe(INCOMPLETE_TOOL_CALL_VERDICT);
		expect(JSON.parse(read?.dataJson ?? "null")).toEqual(data);

		const refused: unknown[] = [
			new RequestError(-32603, "Internal error: no result"),
			new RequestError(-32603, "Internal error: no result", { errorKind: "no_result" }),
			new RequestError(-32603, "Internal error: odd data", "incomplete_tool_call"),
			new RequestError(-32000, "Authentication required", data),
			new Error(typed.message),
			{ name: "RequestError", code: -32603, message: typed.message, data },
		];
		for (const err of refused) expect(claudeAdapter.readPromptRejection?.(err)).toBeUndefined();

		// Non-wire data that passes the guard but cannot serialize is still recognised, and named.
		const cyclic: { errorKind: string; self?: unknown } = { errorKind: "incomplete_tool_call" };
		cyclic.self = cyclic;
		for (const nonWire of [cyclic, { errorKind: "incomplete_tool_call", tokens: BigInt(10) }]) {
			const named = claudeAdapter.readPromptRejection?.(new RequestError(-32603, typed.message, nonWire));
			expect(named?.dataJson).toBe("[unserializable: TypeError]");
			expect(named?.verdict).toBe(INCOMPLETE_TOOL_CALL_VERDICT);
		}

		// The disabled Cortex stub declares no vendor-rejection reader.
		expect("readPromptRejection" in cortexAdapter).toBe(false);
	});
});

describe("ACP set-model readback — claude", () => {
	// Measured 0.85.1 rows (a subset): two alias rows, the exact Fable row, and the rows a wrong
	// resolution could land on.
	const MEASURED_ROWS = [
		{ value: "default", name: "Default (recommended)", description: "Opus 5.5" },
		{ value: "opus", name: "Opus 5.5", description: "For complex work and everyday tasks" },
		{ value: "claude-fable-5-1", name: "Fable 5.1", description: "For your toughest challenges" },
		{ value: "sonnet", name: "Sonnet 5.5", description: "Most efficient for simpler tasks" },
		{ value: "claude-sonnet-5", name: "Sonnet 5", description: "Efficient for routine tasks" },
		{ value: "claude-opus-5", name: "Opus 5", description: "Best for everyday, complex tasks" },
	];
	const answer = (currentValue: unknown, options: unknown[] = MEASURED_ROWS) => ({
		configOptions: [{ id: "model", type: "select", currentValue, options }],
	});
	const enforce = async (nativeModelId: string, response: unknown) => {
		const sent: unknown[] = [];
		const connection = {
			setSessionConfigOption: async (params: unknown) => {
				sent.push(params);
				return response;
			},
		} as never;
		await claudeAdapter.enforceModel({ connection, acpSessionId: "S", modelId: nativeModelId, nativeModelId });
		return sent;
	};

	it("[QK:ACP-CLAUDE-SET-MODEL-READBACK] enforceModel refuses an answer that does not name the requested model", async () => {
		expect(await enforce("claude-fable-5-1", answer("claude-fable-5-1"))).toEqual([
			{ sessionId: "S", configId: "model", value: "claude-fable-5-1" },
		]);
		// 0.106.0 (#142, authenticated, no prompt): `claude-fable-5-2` answers its own row "Fable 5.2",
		// which then replaces the alias row `fable` in the offered list.
		const fable52Rows = [...MEASURED_ROWS, { value: "claude-fable-5-2", name: "Fable 5.2", description: "" }];
		expect(await enforce("claude-fable-5-2", answer("claude-fable-5-2", fable52Rows))).toEqual([
			{ sessionId: "S", configId: "model", value: "claude-fable-5-2" },
		]);
		const refused: Array<[string, unknown]> = [
			// The alias `fable` also names Fable 5.2, but no alias row is declared for 5.2 and 5.1 must
			// never be answered by it: either is a different id answering under the requested one.
			["claude-fable-5-2", answer("fable", [...MEASURED_ROWS, { value: "fable", name: "Fable 5.2" }])],
			["claude-fable-5-1", answer("fable", [...MEASURED_ROWS, { value: "fable", name: "Fable 5.2" }])],
			["claude-fable-5-2", answer("claude-fable-5-1")],
			["claude-fable-5-1", {}],
			["claude-fable-5-1", undefined],
			["claude-fable-5-1", { configOptions: [{ id: "effort", currentValue: "claude-fable-5-1" }] }],
			["claude-fable-5-1", answer("claude-fable-5")],
			["claude-fable-5-1", answer(undefined)],
			["claude-sonnet-5-5", answer("claude-sonnet-5")],
			["claude-opus-5-5", answer("default")],
		];
		for (const [id, response] of refused) {
			const failure = await enforce(id, response).then(
				() => undefined,
				(err: unknown) => err,
			);
			expect(failure, `${id} answered ${JSON.stringify(response)}`).toBeInstanceOf(Error);
			const message = (failure as Error).message;
			expect(message).toContain(JSON.stringify(id));
			// A refusal we author must not invite pi's blind replay of the whole prompt.
			expect(isRetryableAssistantError({ stopReason: "error", errorMessage: message } as never)).toBe(false);
		}
	});

	it("[QK:ACP-CLAUDE-SET-MODEL-ALIAS-EXACT] an alias answer is accepted only as the row measured for the requested id, value and name", async () => {
		await enforce("claude-sonnet-5-5", answer("sonnet"));
		await enforce("claude-opus-5-5", answer("opus"));
		const grouped = [{ group: "all", name: "All", options: MEASURED_ROWS }];
		await enforce("claude-opus-5-5", answer("opus", grouped));
		// The alias value under another generation's name; the 5.5 name on a row that is not the
		// alias (the default row, a retired id, the other alias); or answering the other id.
		const renamed = (value: string, name: string) =>
			MEASURED_ROWS.map((row) => (row.value === value ? { ...row, name } : row));
		for (const [id, response] of [
			["claude-sonnet-5-5", answer("sonnet", renamed("sonnet", "Sonnet 6"))],
			["claude-sonnet-5-5", answer("sonnet", [])],
			["claude-sonnet-5-5", answer("default", renamed("default", "Sonnet 5.5"))],
			["claude-sonnet-5-5", answer("claude-sonnet-5", renamed("claude-sonnet-5", "Sonnet 5.5"))],
			["claude-sonnet-5-5", answer("opus", renamed("opus", "Sonnet 5.5"))],
			["claude-opus-5-5", answer("sonnet")],
			["claude-fable-5-1", answer("opus")],
		] as const) {
			await expect(enforce(id, response), `${id} answered ${JSON.stringify(response)}`).rejects.toThrow(
				/does not name the requested model/,
			);
		}
	});
});

describe("claude server admission at initialize (#168)", () => {
	/** The bundled pin, read from the package manifest: the floor the adapter must hold. */
	const pin: string = JSON.parse(readFileSync(new URL("../../../package.json", import.meta.url), "utf8")).dependencies[
		"@agentclientprotocol/claude-agent-acp"
	];
	const NAME = "@agentclientprotocol/claude-agent-acp";
	const answer = (agentInfo: unknown) => ({ protocolVersion: 1, agentInfo });
	const admit = (a: unknown) => {
		if (!claudeAdapter.admitAgent) throw new Error("claude adapter declares no admitAgent seat");
		claudeAdapter.admitAgent(a);
	};
	const below = (v: string) => {
		const [x, y, z] = v.split(".").map(Number);
		return z > 0 ? `${x}.${y}.${z - 1}` : y > 0 ? `${x}.${y - 1}.99` : `${x - 1}.99.99`;
	};

	it("[QK:ACP-CLAUDE-ADMIT-FLOOR] claude-agent-acp at the bundled pin or newer is admitted; an older, malformed, pre-release or absent version is refused by name", () => {
		const [x, y, z] = pin.split(".").map(Number);
		for (const version of [pin, `${x}.${y}.${z + 1}`, `${x}.${y + 1}.0`, `${x + 1}.0.0`]) {
			expect(() => admit(answer({ name: NAME, version })), version).not.toThrow();
		}
		for (const a of [
			answer({ name: NAME, version: below(pin) }),
			answer({ name: NAME, version: `${pin}-rc.1` }),
			answer({ name: NAME, version: `${x}.${y}` }),
			answer({ name: NAME }),
			answer(null),
			{ protocolVersion: 1 },
		]) {
			expect(() => admit(a), JSON.stringify(a)).toThrow(/acp-claude-version-unsupported/);
		}
	});

	it("[QK:ACP-CLAUDE-ADMIT-NAME] a server that does not name itself as claude-agent-acp is refused at the pin", () => {
		for (const name of ["Antigravity ACP Server", "claude-agent-acp", "", undefined]) {
			expect(() => admit(answer({ name, version: pin })), String(name)).toThrow(/acp-claude-version-unsupported/);
		}
	});

	it("[QK:ACP-CLAUDE-FLOOR-MATCHES-PIN] the Claude floor is the exact version package.json pins", () => {
		expect(pin).toMatch(/^\d+\.\d+\.\d+$/);
		expect(CLAUDE_ACP_AGENT.floor).toBe(pin);
	});
});

describe("the shared admission rule (#168)", () => {
	const expected = { name: "Example ACP Server", floor: "2.10.3" };
	const admit = (version: unknown) =>
		admitAcpAgent({ agentInfo: { name: expected.name, version } }, "example", "example-refusal", expected);

	it("[QK:ACP-AGENT-ADMIT-COMPARE] versions compare as three numbers, major first — never as text, never one part alone", () => {
		for (const version of ["2.10.3", "2.10.4", "2.11.0", "3.0.0", "10.0.0", "2.10.10"]) {
			expect(() => admit(version), version).not.toThrow();
		}
		for (const version of ["2.10.2", "2.9.99", "1.99.99", "0.10.3", "2.1.30"]) {
			expect(() => admit(version), version).toThrow(/example-refusal/);
		}
	});

	it("[QK:ACP-AGENT-ADMIT-STRICT-VERSION] only a strict X.Y.Z version is read; a pre-release, build metadata or padding refuses even above the floor", () => {
		for (const version of [
			"2.10.3-beta.1",
			"2.10.3+build.7",
			"v2.10.3",
			" 2.10.3",
			"2.10.3 ",
			"2.10",
			"2.10.3.1",
			2103,
		]) {
			expect(() => admit(version), String(version)).toThrow(/example-refusal/);
		}
	});

	it("[QK:ACP-AGENT-ADMIT-OVERRIDE-NAMED] a refusal names the operator override that launched the server, never its value; without it, no launch is named", () => {
		const cells = [
			{ env: "CLAUDE_AGENT_ACP_COMMAND", adapter: claudeAdapter, name: CLAUDE_ACP_AGENT.name },
			{ env: "AGY_ACP_COMMAND", adapter: agyAdapter, name: AGY_ACP_AGENT.name },
		];
		for (const cell of cells) {
			const saved = process.env[cell.env];
			try {
				const refused = () => cell.adapter.admitAgent?.({ agentInfo: { name: cell.name, version: "0.0.1" } });
				process.env[cell.env] = "/secret/launcher --token s3cr3t";
				const withOverride = (() => {
					try {
						refused();
					} catch (err) {
						return (err as Error).message;
					}
					throw new Error(`${cell.env}: no refusal`);
				})();
				expect(withOverride).toContain(`launched by ${cell.env}, which owns its whole command line`);
				expect(withOverride).not.toContain("/secret/launcher");
				expect(withOverride).not.toContain("s3cr3t");
				expect(isRetryableAssistantError({ stopReason: "error", errorMessage: withOverride } as never)).toBe(false);
				delete process.env[cell.env];
				expect(refused).toThrow(/^(?![\s\S]*launched by)/);
			} finally {
				if (saved === undefined) delete process.env[cell.env];
				else process.env[cell.env] = saved;
			}
		}
	});
});

/**
 * #171 L1 and V5. The two answers below are the `initialize` results the vendors gave on 2026-11-21
 * (receipts all-claude-20261121T065930Z/experiments-claude-20261121T070023Z/claude-02-l11-new.wire-in.ndjson
 * and all-agy-20261121T071252Z/experiments-agy-20261121T071413Z/agy-01-z2.wire-in.ndjson; protocolVersion,
 * promptCapabilities and the fields the reader does not read left out), copied as literals so the reader
 * cannot move its own oracle. The judgement is checked against those facts with the shipped pins.
 */
const CLAUDE_R1 = {
	protocolVersion: 1,
	agentInfo: { name: "@agentclientprotocol/claude-agent-acp", title: "Claude Agent", version: "0.109.0" },
	agentCapabilities: {
		loadSession: true,
		sessionCapabilities: {
			additionalDirectories: {},
			close: {},
			delete: {},
			fork: {},
			list: {},
			options: {},
			resume: {},
			status: {},
			systemPrompt: { mode: { override: {} } },
			title: {},
		},
		auth: { logout: {}, status: {} },
	},
	authMethods: [],
};
const AGY_R1 = {
	protocolVersion: 1,
	agentInfo: { name: "Antigravity ACP Server", version: "1.5.13" },
	agentCapabilities: {
		loadSession: true,
		sessionCapabilities: { resume: {}, close: {}, load: {}, list: {}, additionalDirectories: {} },
		auth: { logout: {} },
	},
	authMethods: [{ id: "oauth-personal" }, { id: "oauth-business" }, { id: "gemini-api-key" }, { id: "agent-platform" }],
};
const at = (answer: { agentInfo: { name: string } }, version: string): AcpAgentFacts =>
	readAgentFacts({ ...answer, agentInfo: { ...answer.agentInfo, version } });

describe("the child's initialize facts and the attach judgement (#171 L1, V5)", () => {
	it("[QK:ACP-L1-FACTS-READ] reads name, version, loadSession, session capabilities and auth method ids as answered, and nothing it was not told", () => {
		expect(readAgentFacts(CLAUDE_R1)).toEqual({
			agent: { name: "@agentclientprotocol/claude-agent-acp", version: "0.109.0" },
			loadSession: true,
			sessionCapabilities: [
				"additionalDirectories",
				"close",
				"delete",
				"fork",
				"list",
				"options",
				"resume",
				"status",
				"systemPrompt",
				"title",
			],
			authMethods: [],
		});
		expect(readAgentFacts(AGY_R1)).toEqual({
			agent: { name: "Antigravity ACP Server", version: "1.5.13" },
			loadSession: true,
			sessionCapabilities: ["additionalDirectories", "close", "list", "load", "resume"],
			authMethods: ["oauth-personal", "oauth-business", "gemini-api-key", "agent-platform"],
		});
		const nothing = { agent: null, loadSession: false, sessionCapabilities: [], authMethods: [] };
		for (const answer of [undefined, null, "initialize", [], {}, { agentInfo: null, agentCapabilities: null }])
			expect(readAgentFacts(answer), JSON.stringify(answer)).toEqual(nothing);
		expect(
			readAgentFacts({
				agentInfo: { name: "n", version: 1 },
				agentCapabilities: { loadSession: "true", sessionCapabilities: { resume: null, close: true, list: {} } },
				authMethods: [{ id: 7 }, null, { id: "kept" }],
			}),
		).toEqual({ agent: null, loadSession: false, sessionCapabilities: ["list"], authMethods: ["kept"] });
	});

	it("[QK:ACP-V5-ATTACH-EQUAL] each pinned agent at exactly its measured version, advertising the capability, may resume and load", () => {
		for (const [answer, agent] of [
			[CLAUDE_R1, CLAUDE_ACP_AGENT],
			[AGY_R1, AGY_ACP_AGENT],
		] as const) {
			const facts = readAgentFacts(answer);
			expect(facts.agent?.version).toBe(agent.measured);
			expect(attachAllowed(facts, agent, "resume")).toEqual({ allowed: true });
			expect(attachAllowed(facts, agent, "load")).toEqual({ allowed: true });
		}
	});

	it("[QK:ACP-V5-ATTACH-UNMEASURED] an admitted server at any other version may not attach — the previously measured agy 1.5.12, the agy floor, a newer Claude behind CLAUDE_AGENT_ACP_COMMAND", () => {
		const saved = process.env.CLAUDE_AGENT_ACP_COMMAND;
		try {
			process.env.CLAUDE_AGENT_ACP_COMMAND = "/opt/claude-agent-acp-0.110.0";
			const cells = [
				{ answer: AGY_R1, adapter: agyAdapter, agent: AGY_ACP_AGENT, version: "1.5.12" },
				{ answer: AGY_R1, adapter: agyAdapter, agent: AGY_ACP_AGENT, version: AGY_ACP_AGENT.floor },
				{ answer: CLAUDE_R1, adapter: claudeAdapter, agent: CLAUDE_ACP_AGENT, version: "0.110.0" },
				{ answer: CLAUDE_R1, adapter: claudeAdapter, agent: CLAUDE_ACP_AGENT, version: "0.109.1" },
			];
			for (const cell of cells) {
				const answer = { ...cell.answer, agentInfo: { ...cell.answer.agentInfo, version: cell.version } };
				expect(() => cell.adapter.admitAgent?.(answer), cell.version).not.toThrow();
				for (const need of ["resume", "load"] as const)
					expect(attachAllowed(readAgentFacts(answer), cell.agent, need), `${cell.version} ${need}`).toEqual({
						allowed: false,
						reason: "version-unmeasured",
					});
			}
			for (const version of ["1.5.13-beta.1", "1.5.13+b", "v1.5.13", " 1.5.13"])
				expect(attachAllowed(at(AGY_R1, version), AGY_ACP_AGENT, "resume"), version).toEqual({
					allowed: false,
					reason: "version-unmeasured",
				});
		} finally {
			if (saved === undefined) delete process.env.CLAUDE_AGENT_ACP_COMMAND;
			else process.env.CLAUDE_AGENT_ACP_COMMAND = saved;
		}
	});

	it("[QK:ACP-V5-ATTACH-CAPABILITY-ABSENT] at the measured version, resume needs sessionCapabilities.resume and load needs loadSession", () => {
		const noResume = readAgentFacts({
			...AGY_R1,
			agentCapabilities: { loadSession: true, sessionCapabilities: { load: {}, close: {} } },
		});
		expect(attachAllowed(noResume, AGY_ACP_AGENT, "resume")).toEqual({ allowed: false, reason: "capability-absent" });
		expect(attachAllowed(noResume, AGY_ACP_AGENT, "load")).toEqual({ allowed: true });
		const noLoad = readAgentFacts({
			...CLAUDE_R1,
			agentCapabilities: { ...CLAUDE_R1.agentCapabilities, loadSession: false },
		});
		expect(attachAllowed(noLoad, CLAUDE_ACP_AGENT, "load")).toEqual({ allowed: false, reason: "capability-absent" });
		expect(attachAllowed(noLoad, CLAUDE_ACP_AGENT, "resume")).toEqual({ allowed: true });
	});

	it("[QK:ACP-V5-ATTACH-NAME] a server that does not answer the pinned name may not attach, even at that pin's measured version", () => {
		const cells = [
			{ facts: at(AGY_R1, CLAUDE_ACP_AGENT.measured), agent: CLAUDE_ACP_AGENT },
			{ facts: at(CLAUDE_R1, AGY_ACP_AGENT.measured), agent: AGY_ACP_AGENT },
			{ facts: readAgentFacts({ ...AGY_R1, agentInfo: undefined }), agent: AGY_ACP_AGENT },
		];
		for (const { facts, agent } of cells)
			expect(attachAllowed(facts, agent, "load")).toEqual({ allowed: false, reason: "agent-unnamed" });
	});

	it("[QK:ACP-L1-BOOTSTRAP-CAPABILITIES] the bootstrap input counts each capability only as the judgement admits it", () => {
		const resumeOnly = readAgentFacts({
			...CLAUDE_R1,
			agentCapabilities: { ...CLAUDE_R1.agentCapabilities, loadSession: false },
		});
		expect(bootstrapCapabilities(resumeOnly, CLAUDE_ACP_AGENT)).toEqual({ resumeSession: true, loadSession: false });
		const loadOnly = readAgentFacts({ ...AGY_R1, agentCapabilities: { loadSession: true } });
		expect(bootstrapCapabilities(loadOnly, AGY_ACP_AGENT)).toEqual({ resumeSession: false, loadSession: true });
		expect(bootstrapCapabilities(at(AGY_R1, "1.5.12"), AGY_ACP_AGENT)).toEqual({
			resumeSession: false,
			loadSession: false,
		});
	});

	it("a pinned measured version that is not X.Y.Z crashes rather than judging", () => {
		expect(() => attachAllowed(readAgentFacts(AGY_R1), { ...AGY_ACP_AGENT, measured: "1.5" }, "load")).toThrow(
			/measured version "1\.5" of Antigravity ACP Server is not X\.Y\.Z/,
		);
	});
});
