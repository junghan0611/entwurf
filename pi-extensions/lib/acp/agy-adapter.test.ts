/**
 * The Antigravity ACP adapter (#167): `agy acp` driven as a child of a host pi citizen.
 *
 * The oracles are literals copied from the wire as agy 1.5.9 answered on 2026-11-16 (receipts on
 * #167) — the answer shape of `session/set_config_option`, the offered `thought_level` values per
 * model, the launch arguments — never the adapter's own constants, so a change to the adapter
 * cannot move its own check. No vendor runtime is certified here; that is the LIVE axis.
 */
import { spawnSync } from "node:child_process";
import {
	copyFileSync,
	existsSync,
	lstatSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	readlinkSync,
	rmSync,
	statSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { clampThinkingLevel, getSupportedThinkingLevels } from "@earendil-works/pi-ai";
import { isRetryableAssistantError } from "@earendil-works/pi-ai/compat";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	agyAcpHookCommand,
	agyAcpHookPath,
	agyAdapter,
	agyLaunchArgs,
	allCuratedModels,
	claudeAdapter,
	confirmAgySetModelAnswer,
	confirmAgyThoughtLevelAnswer,
	resolveAcpBackendAdapter,
	resolveAgyThoughtLevel,
} from "./backend-adapter.ts";
import { isAgyAcpModelId, isCuratedAcpModelId } from "./model-ids.js";
import { agyHooksSeatTempPath, ensureAgyGeminiOverlay } from "./overlay.ts";

/** The `configOptions` agy answers a set with, as measured: the full list, ids model/thought_level/mode. */
function agyAnswer(model: string, thought: string | undefined, mode = "default") {
	return {
		configOptions: [
			{ id: "model", category: "model", type: "select", currentValue: model },
			...(thought === undefined
				? []
				: [{ id: "thought_level", category: "thought_level", type: "select", currentValue: thought }]),
			{ id: "mode", category: "mode", type: "select", currentValue: mode },
		],
	};
}

/** The raw `entwurfProvider` blocks as config.ts hands them to an adapter. */
function blocks(globalBlock: Record<string, unknown>, projectBlock: Record<string, unknown>) {
	return {
		globalBlock,
		projectBlock,
		mergedBlock: { ...globalBlock, ...projectBlock },
		globalPath: "/home/op/.pi/agent/settings.json",
		projectPath: "/work/.pi/settings.json",
	};
}

function fakeConnection(answers: unknown[]) {
	const calls: Array<Record<string, unknown>> = [];
	return {
		calls,
		connection: {
			setSessionConfigOption(params: Record<string, unknown>) {
				calls.push(params);
				const next = answers.shift();
				return next instanceof Error ? Promise.reject(next) : Promise.resolve(next);
			},
		} as never,
	};
}

describe("agy ACP routing — the reserved prefix and the three measured rows", () => {
	it("[QK:ACP-AGY-ROUTE-EXACT] exactly the three prefixed ids route to agy with the prefix stripped; nothing else does", () => {
		const expected: Record<string, string> = {
			"agy-gemini-4-hydrogen": "gemini-4-hydrogen",
			"agy-gemini-4-argon": "gemini-4-argon",
			"agy-gemini-3.8-flash": "gemini-3.8-flash",
		};
		for (const [id, native] of Object.entries(expected)) {
			const routed = resolveAcpBackendAdapter(id);
			expect(routed.adapter.backend, id).toBe("agy");
			expect(routed.nativeModelId, id).toBe(native);
			expect(claudeAdapter.routeModel(id), id).toBeUndefined();
		}
		// Models agy offers but this rail does not register, a bare native id, and near-misses.
		for (const id of [
			"agy-claude-opus-5-5",
			"agy-gemini-pro-orchestrator-g1-pro",
			"agy-gpt-oss-120b-medium",
			"gemini-4-hydrogen",
			"agy-gemini-4-hydrogen-high",
			"AGY-gemini-4-hydrogen",
			"agy-",
		]) {
			expect(agyAdapter.routeModel(id), id).toBeUndefined();
			expect(() => resolveAcpBackendAdapter(id), id).toThrow(/no ACP backend adapter owns model id/);
		}
		expect(resolveAcpBackendAdapter("claude-opus-5-5").adapter.backend).toBe("claude");
	});

	it("[QK:ACP-AGY-ROWS] the provider gains three text-only agy rows with the measured window and per-model levels", () => {
		const rows = allCuratedModels().filter((row) => row.id.startsWith("agy-"));
		expect(rows.map((row) => row.id).sort()).toEqual([
			"agy-gemini-3.8-flash",
			"agy-gemini-4-argon",
			"agy-gemini-4-hydrogen",
		]);
		const three = { off: null, minimal: null, low: "low", medium: "medium", high: "high", xhigh: null, max: null };
		const levels: Record<string, unknown> = {
			"agy-gemini-3.8-flash": three,
			"agy-gemini-4-argon": three,
			"agy-gemini-4-hydrogen": { ...three, xhigh: "xhigh" },
		};
		for (const row of rows) {
			expect(row.input, row.id).toEqual(["text"]);
			expect(row.contextWindow, row.id).toBe(1048576);
			expect(row.cost, row.id).toEqual({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 });
			expect(row.reasoning, row.id).toBe(true);
			expect(row.thinkingLevelMap, row.id).toEqual(levels[row.id]);
		}
	});

	it("[QK:ACP-AGY-LAUNCH-ADMITTED] the launch seams admit exactly the three agy ids — no native id, no unregistered agy model, no suffix", () => {
		for (const id of ["agy-gemini-4-hydrogen", "agy-gemini-4-argon", "agy-gemini-3.8-flash"]) {
			expect(isCuratedAcpModelId(id), id).toBe(true);
			expect(isAgyAcpModelId(id), id).toBe(true);
		}
		for (const id of [
			"gemini-4-hydrogen",
			"agy-claude-opus-5-5",
			"agy-gemini-3.8-flash:high",
			"agy-gemini",
			"AGY-gemini-4-argon",
		]) {
			expect(isCuratedAcpModelId(id), id).toBe(false);
			expect(isAgyAcpModelId(id), id).toBe(false);
		}
		expect(isAgyAcpModelId("claude-opus-5-5")).toBe(false);
	});
});

describe("agy ACP launch — the overlay and the permission switch are arguments", () => {
	const saved = process.env.AGY_ACP_COMMAND;
	afterEach(() => {
		if (saved === undefined) delete process.env.AGY_ACP_COMMAND;
		else process.env.AGY_ACP_COMMAND = saved;
	});

	it("[QK:ACP-AGY-LAUNCH-ARGV] agy is launched on stdio against the overlay, default customizations off, permissions bypassed, with no env carrier", () => {
		delete process.env.AGY_ACP_COMMAND;
		expect(agyLaunchArgs("/x/overlay")).toEqual([
			"acp",
			"--stdio",
			"--gemini-dir",
			"/x/overlay",
			"--include-default-customizations=false",
			"--dangerously-skip-permissions",
		]);
		const launch = agyAdapter.resolveLaunch({} as never);
		expect(launch.command).toBe("agy");
		expect(launch.args.slice(0, 3)).toEqual(["acp", "--stdio", "--gemini-dir"]);
		expect(launch.args[3]).toMatch(/\/\.pi\/agent\/agy-gemini-overlay$/);
		expect(launch.args.slice(4)).toEqual(["--include-default-customizations=false", "--dangerously-skip-permissions"]);
		expect(agyAdapter.launchEnvDefaults()).toEqual({});
	});

	it("an explicit AGY_ACP_COMMAND owns the whole command line", () => {
		process.env.AGY_ACP_COMMAND = "  /opt/agy acp --stdio  ";
		expect(agyAdapter.resolveLaunch({} as never)).toEqual({ command: "bash", args: ["-lc", "/opt/agy acp --stdio"] });
	});
});

describe("agy ACP session meta — the carrier rides the vendor's own append seat", () => {
	it("[QK:ACP-AGY-CARRIER-APPEND] a carrier is sent byte-for-byte as _meta.antigravity.systemPrompt.append; none sends no _meta", () => {
		const params = { modelId: "agy-gemini-4-argon", nativeModelId: "gemini-4-argon", config: {} as never };
		expect(agyAdapter.buildSessionMeta(params, "\n\ncarrier text")).toEqual({
			antigravity: { systemPrompt: { append: "\n\ncarrier text" } },
		});
		expect(agyAdapter.buildSessionMeta(params, null)).toBeUndefined();
	});
});

describe("agy ACP model enforcement — the answer is read back", () => {
	it("[QK:ACP-AGY-SET-MODEL-READBACK] sets the native id on the model option and accepts only an answer naming it", async () => {
		const ok = fakeConnection([agyAnswer("gemini-3.8-flash", "medium")]);
		await agyAdapter.enforceModel({
			connection: ok.connection,
			acpSessionId: "s1",
			modelId: "agy-gemini-3.8-flash",
			nativeModelId: "gemini-3.8-flash",
		});
		expect(ok.calls).toEqual([{ sessionId: "s1", configId: "model", value: "gemini-3.8-flash" }]);

		for (const answer of [agyAnswer("gemini-4-argon", "medium"), { configOptions: [] }, {}, null]) {
			const bad = fakeConnection([answer]);
			await expect(
				agyAdapter.enforceModel({
					connection: bad.connection,
					acpSessionId: "s1",
					modelId: "agy-gemini-3.8-flash",
					nativeModelId: "gemini-3.8-flash",
				}),
			).rejects.toThrow(/does not name the requested model/);
		}
		expect(() => confirmAgySetModelAnswer(agyAnswer("gemini-4-hydrogen", "medium"), "gemini-4-hydrogen")).not.toThrow();
	});

	it("a vendor refusal of the model (-32602 Unknown model ID) propagates before any prompt", async () => {
		const refused = fakeConnection([new Error("Unknown model ID: gemini-4-hydrogen")]);
		await expect(
			agyAdapter.enforceModel({
				connection: refused.connection,
				acpSessionId: "s1",
				modelId: "agy-gemini-4-hydrogen",
				nativeModelId: "gemini-4-hydrogen",
			}),
		).rejects.toThrow(/Unknown model ID/);
	});
});

describe("agy ACP thought level — mapped per model, set after the model, read back", () => {
	const threeMap = { off: null, minimal: null, low: "low", medium: "medium", high: "high", xhigh: null, max: null };
	const hydrogenMap = { ...threeMap, xhigh: "xhigh" };

	it("[QK:ACP-AGY-THOUGHT-RESOLVE] a level the model offers resolves to the same-named value; off, none, minimal and an unoffered xhigh refuse by name", () => {
		expect(resolveAgyThoughtLevel("agy-gemini-3.8-flash", "low", threeMap)).toBe("low");
		expect(resolveAgyThoughtLevel("agy-gemini-4-argon", "high", threeMap)).toBe("high");
		expect(resolveAgyThoughtLevel("agy-gemini-4-hydrogen", "xhigh", hydrogenMap)).toBe("xhigh");
		for (const [modelId, reasoning, map] of [
			["agy-gemini-3.8-flash", undefined, threeMap],
			["agy-gemini-3.8-flash", "minimal", threeMap],
			["agy-gemini-3.8-flash", "xhigh", threeMap],
			// A row map that claims xhigh for a model measured without it is still refused.
			["agy-gemini-4-argon", "xhigh", hydrogenMap],
			["agy-gemini-4-hydrogen", "max", hydrogenMap],
			["agy-gemini-4-hydrogen", "high", undefined],
		] as const) {
			let message = "";
			try {
				resolveAgyThoughtLevel(modelId, reasoning, map);
			} catch (err) {
				message = (err as Error).message;
			}
			expect(message, `${modelId}/${reasoning}`).toMatch(/acp-agy-thinking-level-unsupported/);
			// The refusal must not read as transient to pi: replaying cannot change the level asked for.
			expect(
				isRetryableAssistantError({ stopReason: "error", errorMessage: message } as never),
				`${modelId}/${reasoning}`,
			).toBe(false);
		}
		expect(
			agyAdapter.resolveThinking?.({ modelId: "agy-gemini-4-argon", reasoning: "medium", thinkingLevelMap: threeMap }),
		).toBe("medium");
	});

	it("[QK:ACP-AGY-THOUGHT-READBACK] sets thought_level and accepts only an answer reading the value back", async () => {
		const ok = fakeConnection([agyAnswer("gemini-4-hydrogen", "xhigh")]);
		await agyAdapter.enforceThinking?.({
			connection: ok.connection,
			acpSessionId: "s1",
			modelId: "agy-gemini-4-hydrogen",
			value: "xhigh",
		});
		expect(ok.calls).toEqual([{ sessionId: "s1", configId: "thought_level", value: "xhigh" }]);

		// Through the adapter: an answer that carries no thought_level option is refused, not trusted.
		const silent = fakeConnection([agyAnswer("gemini-4-argon", undefined)]);
		await expect(
			agyAdapter.enforceThinking?.({
				connection: silent.connection,
				acpSessionId: "s1",
				modelId: "agy-gemini-4-argon",
				value: "high",
			}),
		).rejects.toThrow(/answered with no thought_level option/);

		// A model with no thought_level option at all (measured on the two unregistered models).
		expect(() =>
			confirmAgyThoughtLevelAnswer(agyAnswer("gemini-4-argon", undefined), "agy-gemini-4-argon", "high"),
		).toThrow(/answered with no thought_level option/);
		const refused = fakeConnection([new Error('Thinking level "xhigh" is not offered for model "Gemini 3.8 Flash"')]);
		await expect(
			agyAdapter.enforceThinking?.({
				connection: refused.connection,
				acpSessionId: "s1",
				modelId: "agy-gemini-3.8-flash",
				value: "xhigh",
			}),
		).rejects.toThrow(/agy acp refused the set for thought level "xhigh"/);
	});

	it("[QK:ACP-AGY-THOUGHT-CLAMP] the vendor's silent clamp is caught: Hydrogen at xhigh, then Flash, answers high — a held xhigh is refused", () => {
		// Measured sequence: set-model gemini-4-hydrogen → set thought_level xhigh (read back xhigh)
		// → set-model gemini-3.8-flash answered thought_level "high" with no error.
		const afterModelSwitch = agyAnswer("gemini-3.8-flash", "high");
		expect(() => confirmAgySetModelAnswer(afterModelSwitch, "gemini-3.8-flash")).not.toThrow();
		expect(() => confirmAgyThoughtLevelAnswer(afterModelSwitch, "agy-gemini-3.8-flash", "xhigh")).toThrow(
			/answered thought level "high"/,
		);
		expect(() => confirmAgyThoughtLevelAnswer(afterModelSwitch, "agy-gemini-3.8-flash", "high")).not.toThrow();
	});
	// #168 (a): pi clamps every level it sets — at session creation (`sdk.js` `clampThinkingLevel`), on
	// `setModel`, `setThinkingLevel` and a branch's recorded level (pi-coding-agent 1.5.2
	// `agent-session.js` `_clampThinkingLevel`) — so a turn reaches the adapter with a level the row
	// offers. A characterization of that composition: the refusal stays for a caller that bypasses the
	// clamp. Oracle: pi's own ModelRuntime + getSupportedThinkingLevels / clampThinkingLevel.
	it("[QK:ACP-AGY-THINKING-MENU] pi offers only the levels each row carries, and its clamp lands every other level on one the adapter resolves", async () => {
		const sandbox = mkdtempSync(join(tmpdir(), "acp-agy-thinking-"));
		try {
			const runtime = await ModelRuntime.create({
				authPath: join(sandbox, "oracle-auth.json"),
				modelsPath: null,
				modelsStorePath: join(sandbox, "oracle-models-store.json"),
				allowModelNetwork: false,
				refreshOnCreate: false,
			});
			const rows = allCuratedModels().filter((row) => row.id.startsWith("agy-"));
			runtime.registerProvider("acp-agy-thinking-oracle", {
				baseUrl: "x",
				apiKey: "x",
				api: "acp-agy-thinking-oracle",
				streamSimple: () => {
					throw new Error("the oracle never streams");
				},
				models: rows,
			});
			// Literals: the measured offer per native model (#167).
			const lowToHigh = {
				menu: ["low", "medium", "high"],
				clamp: { off: "low", minimal: "low", xhigh: "high", max: "high" },
			};
			const expected: Record<string, { menu: string[]; clamp: Record<string, string> }> = {
				"agy-gemini-3.8-flash": lowToHigh,
				"agy-gemini-4-argon": lowToHigh,
				"agy-gemini-4-hydrogen": {
					menu: ["low", "medium", "high", "xhigh"],
					clamp: { off: "low", minimal: "low", xhigh: "xhigh", max: "xhigh" },
				},
			};
			expect(rows.map((r) => r.id).sort()).toEqual(Object.keys(expected).sort());
			for (const row of rows) {
				const registered = runtime.getModel("acp-agy-thinking-oracle", row.id);
				expect(registered, row.id).toBeDefined();
				if (!registered) continue;
				expect(getSupportedThinkingLevels(registered), row.id).toEqual(expected[row.id].menu);
				for (const [asked, landed] of Object.entries(expected[row.id].clamp)) {
					const clamped = clampThinkingLevel(registered, asked as never);
					expect(clamped, `${row.id} ${asked}`).toBe(landed);
					// pi sends the clamped level as `reasoning`; the adapter resolves it without its refusal.
					expect(resolveAgyThoughtLevel(row.id, clamped, row.thinkingLevelMap), `${row.id} ${asked}`).toBe(clamped);
				}
			}
		} finally {
			rmSync(sandbox, { recursive: true, force: true });
		}
	});
});

describe("agy ACP capabilities it does not declare", () => {
	it("[QK:ACP-AGY-NO-SEAL] agy seals no turn accounting — its usage_update carries no cost", () => {
		expect("sealsTurnAccounting" in agyAdapter).toBe(false);
		expect(agyAdapter.resolveAdapterSettings(blocks({}, {}))).toEqual({ skillPlugins: [] });
	});
});

describe("agy ACP operator narrowing — refused, never ignored", () => {
	it("[QK:ACP-AGY-NARROWING-REFUSED] a tools, disallowedTools or permissionAllow setting refuses the agy turn by name and file; settings that do not narrow pass", () => {
		for (const key of ["tools", "disallowedTools", "permissionAllow"]) {
			for (const [input, file] of [
				[blocks({ [key]: ["Read"] }, {}), "/home/op/.pi/agent/settings.json"],
				[blocks({}, { [key]: [] }), "/work/.pi/settings.json"],
			] as const) {
				let message = "";
				try {
					agyAdapter.resolveAdapterSettings(input);
				} catch (err) {
					message = (err as Error).message;
				}
				expect(message, key).toContain("acp-agy-narrowing-unsupported");
				expect(message, key).toContain(`entwurfProvider.${key}`);
				expect(message, key).toContain(file);
				expect(isRetryableAssistantError({ stopReason: "error", errorMessage: message } as never), key).toBe(false);
			}
		}
		// What GLG's settings carry today, plus the two Claude-only keys that widen rather than narrow.
		expect(
			agyAdapter.resolveAdapterSettings(
				blocks(
					{ appendSystemPrompt: "x", showToolNotifications: true, skillPlugins: ["/p"], mcpServers: {} },
					{ settingSources: ["user"] },
				),
			),
		).toEqual({ skillPlugins: ["/p"] });
		// The Claude adapter reads none of this here: narrowing is its common config.
		expect(claudeAdapter.resolveAdapterSettings(blocks({ tools: ["Read"] }, {}))).toBeUndefined();
	});
});

describe("agy ACP skills — only the operator's global list is projected", () => {
	it("[QK:ACP-AGY-SKILLS-GLOBAL-ONLY] the adapter's skill list is the global block's; a project list reaches no agy child", () => {
		expect(
			agyAdapter.resolveAdapterSettings(
				blocks({ skillPlugins: ["/global/plugin"] }, { skillPlugins: ["/project/plugin"] }),
			),
		).toEqual({
			skillPlugins: ["/global/plugin"],
		});
		expect(agyAdapter.resolveAdapterSettings(blocks({}, { skillPlugins: ["/project/plugin"] }))).toEqual({
			skillPlugins: [],
		});
	});
});

describe("agy gemini-dir overlay — one credential link, nothing else crosses", () => {
	let root: string;
	let real: string;
	let overlay: string;
	const token = "antigravity-oauth-token";
	beforeEach(() => {
		root = mkdtempSync(join(tmpdir(), "agy-overlay-"));
		real = join(root, "real");
		overlay = join(root, "overlay");
		mkdirSync(join(real, "antigravity-cli", "brain"), { recursive: true });
		mkdirSync(join(real, "config"), { recursive: true });
		writeFileSync(join(real, "antigravity-cli", token), "operator-token");
		writeFileSync(join(real, "antigravity-cli", "settings.json"), "{}");
		writeFileSync(join(real, "config", "mcp_config.json"), "{}");
	});
	afterEach(() => rmSync(root, { recursive: true, force: true }));

	it("[QK:ACP-AGY-OVERLAY-ONE-LINK] links exactly the token file and exposes no other entry of the operator's agy state", () => {
		ensureAgyGeminiOverlay(real, overlay);
		const link = join(overlay, "antigravity-cli", token);
		expect(lstatSync(link).isSymbolicLink()).toBe(true);
		expect(readlinkSync(link)).toBe(join(real, "antigravity-cli", token));
		for (const hidden of ["antigravity-cli/settings.json", "antigravity-cli/brain", "config"]) {
			expect(() => lstatSync(join(overlay, hidden)), hidden).toThrow();
		}
	});

	it("[QK:ACP-AGY-OVERLAY-RELINK] a regular file or a wrong link left at the token path is replaced by the link", () => {
		ensureAgyGeminiOverlay(real, overlay);
		const link = join(overlay, "antigravity-cli", token);
		// A vendor rename-over-refresh would leave a regular file here.
		rmSync(link);
		writeFileSync(link, "renamed-copy");
		ensureAgyGeminiOverlay(real, overlay);
		expect(lstatSync(link).isSymbolicLink()).toBe(true);
		expect(readlinkSync(link)).toBe(join(real, "antigravity-cli", token));
		expect(readFileSync(join(real, "antigravity-cli", token), "utf8")).toBe("operator-token");

		// Wrong target → relinked.
		rmSync(link);
		symlinkSync(join(real, "antigravity-cli", "settings.json"), link);
		ensureAgyGeminiOverlay(real, overlay);
		expect(readlinkSync(link)).toBe(join(real, "antigravity-cli", token));
	});

	it("[QK:ACP-AGY-OVERLAY-SWEEP] a symlink nobody on the allowlist made is removed at both levels; agy's own files and directories stay", () => {
		ensureAgyGeminiOverlay(real, overlay);
		mkdirSync(join(overlay, "antigravity-cli", "brain"), { recursive: true });
		writeFileSync(join(overlay, "antigravity-cli", "installation_id"), "x");
		symlinkSync(join(real, "config"), join(overlay, "config"));
		symlinkSync(join(real, "antigravity-cli", "settings.json"), join(overlay, "antigravity-cli", "keybindings.json"));

		ensureAgyGeminiOverlay(real, overlay);
		expect(() => lstatSync(join(overlay, "config"))).toThrow();
		expect(() => lstatSync(join(overlay, "antigravity-cli", "keybindings.json"))).toThrow();
		expect(lstatSync(join(overlay, "antigravity-cli", "brain")).isDirectory()).toBe(true);
		expect(lstatSync(join(overlay, "antigravity-cli", "installation_id")).isFile()).toBe(true);
		// The sweep removes links, never what they point at.
		expect(lstatSync(join(real, "config", "mcp_config.json")).isFile()).toBe(true);
		expect(lstatSync(join(real, "antigravity-cli", "settings.json")).isFile()).toBe(true);

		// The same foreign `config` link with skills to project: the link goes, a directory of the
		// overlay's own takes its place, and the operator's config gains nothing.
		symlinkSync(join(real, "config"), join(overlay, "config"));
		ensureAgyGeminiOverlay(real, overlay, [plugin("plugin-swept", { gamma: true })]);
		expect(lstatSync(join(overlay, "config")).isDirectory()).toBe(true);
		expect(readdirSync(join(overlay, "config", "skills"))).toEqual(["gamma"]);
		expect(readdirSync(join(real, "config"))).toEqual(["mcp_config.json"]);
	});

	it("[QK:ACP-AGY-OVERLAY-REAL-DIRECTORY] an overlay path that is a symlink into the operator's state refuses before anything is removed or linked", () => {
		// A: the overlay root itself links to the operator's gemini dir.
		symlinkSync(real, overlay);
		expect(() => ensureAgyGeminiOverlay(real, overlay)).toThrow(/acp-agy-overlay-not-a-directory/);
		// B: a real overlay root whose app-data dir links to the operator's.
		rmSync(overlay);
		mkdirSync(overlay);
		symlinkSync(join(real, "antigravity-cli"), join(overlay, "antigravity-cli"));
		symlinkSync(join(real, "config"), join(real, "antigravity-cli", "operator-link"));
		expect(() => ensureAgyGeminiOverlay(real, overlay)).toThrow(/acp-agy-overlay-not-a-directory/);
		// C: a regular file where the overlay root should be.
		rmSync(overlay, { recursive: true });
		writeFileSync(overlay, "not a directory");
		expect(() => ensureAgyGeminiOverlay(real, overlay)).toThrow(/acp-agy-overlay-not-a-directory/);

		// The operator's token is still its own regular file, and the operator's own link survives.
		const operatorToken = join(real, "antigravity-cli", token);
		expect(lstatSync(operatorToken).isSymbolicLink()).toBe(false);
		expect(readFileSync(operatorToken, "utf8")).toBe("operator-token");
		expect(lstatSync(join(real, "antigravity-cli", "operator-link")).isSymbolicLink()).toBe(true);
	});

	const plugin = (name: string, skills: Record<string, boolean>) => {
		const dir = join(root, name);
		mkdirSync(join(dir, "skills"), { recursive: true });
		for (const [skill, hasManifest] of Object.entries(skills)) {
			mkdirSync(join(dir, "skills", skill));
			if (hasManifest) writeFileSync(join(dir, "skills", skill, "SKILL.md"), `# ${skill}\n`);
		}
		return dir;
	};
	const skillSeat = () => join(overlay, "config", "skills");

	it("[QK:ACP-AGY-OVERLAY-SKILL-SEAT-REAL] a skill seat that links into a directory of the operator's refuses before anything in it is removed", () => {
		mkdirSync(join(overlay, "config"), { recursive: true });
		const operatorSkills = join(root, "operator-skills");
		mkdirSync(operatorSkills);
		symlinkSync(join(real, "config"), join(operatorSkills, "kept"));
		symlinkSync(operatorSkills, skillSeat());
		for (const plugins of [[], [plugin("plugin-one", { alpha: true })]]) {
			expect(() => ensureAgyGeminiOverlay(real, overlay, plugins)).toThrow(/acp-agy-overlay-not-a-directory/);
			expect(readdirSync(operatorSkills)).toEqual(["kept"]);
			expect(() => lstatSync(join(overlay, "antigravity-cli"))).toThrow();
		}
	});

	it("[QK:ACP-AGY-SKILLS-PROJECTED] each named plugin's skill that has a SKILL.md is linked at config/skills; nothing else in the plugin is", () => {
		const one = plugin("plugin-one", { alpha: true, "no-manifest": false });
		const two = plugin("plugin-two", { beta: true });
		const bare = join(root, "plugin-bare");
		mkdirSync(join(bare, "commands"), { recursive: true });
		ensureAgyGeminiOverlay(real, overlay, [one, two, bare]);
		expect(readdirSync(skillSeat()).sort()).toEqual(["alpha", "beta"]);
		expect(readlinkSync(join(skillSeat(), "alpha"))).toBe(join(one, "skills", "alpha"));
		expect(readlinkSync(join(skillSeat(), "beta"))).toBe(join(two, "skills", "beta"));
		// No list, no seat: an agy child with no skill setting is given no directory for one.
		const plain = join(root, "overlay-plain");
		ensureAgyGeminiOverlay(real, plain);
		expect(() => lstatSync(join(plain, "config"))).toThrow();
	});

	it("[QK:ACP-AGY-SKILLS-RETRACTED] a link the current list does not ask for is removed; a real directory in the seat is left alone", () => {
		const one = plugin("plugin-one", { alpha: true });
		mkdirSync(join(skillSeat(), "own-directory"), { recursive: true });
		symlinkSync(join(one, "skills", "alpha"), join(skillSeat(), "alpha"));
		symlinkSync(join(real, "config"), join(skillSeat(), "stale"));
		ensureAgyGeminiOverlay(real, overlay, []);
		expect(readdirSync(skillSeat())).toEqual(["own-directory"]);
		expect(lstatSync(join(real, "config")).isDirectory()).toBe(true);
	});

	it("[QK:ACP-AGY-SKILLS-COLLISION] one skill name offered by two plugins refuses by name before anything is linked", () => {
		const one = plugin("plugin-one", { alpha: true });
		const two = plugin("plugin-two", { alpha: true });
		expect(() => ensureAgyGeminiOverlay(real, overlay, [one, two])).toThrow(/acp-agy-skill-name-collision/);
		expect(() => lstatSync(overlay)).toThrow();
	});

	it("no operator token → no link, and a stale overlay copy is dropped", () => {
		ensureAgyGeminiOverlay(real, overlay);
		rmSync(join(real, "antigravity-cli", token));
		ensureAgyGeminiOverlay(real, overlay);
		expect(() => lstatSync(join(overlay, "antigravity-cli", token))).toThrow();
	});
});

describe("agy server admission at initialize (#168)", () => {
	/** The measured answer (#167, 1.5.9) is the oracle; the adapter's constant is not read here. */
	const answer = (agentInfo: unknown) => ({ protocolVersion: 1, agentInfo });
	const admit = (a: unknown) => {
		if (!agyAdapter.admitAgent) throw new Error("agy adapter declares no admitAgent seat");
		agyAdapter.admitAgent(a);
	};

	it("[QK:ACP-AGY-ADMIT-FLOOR] agy's ACP server at 1.5.9 or newer is admitted; an older, malformed, pre-release or absent version is refused by name", () => {
		for (const version of ["1.5.9", "1.5.10", "1.6.0", "2.0.0"]) {
			expect(() => admit(answer({ name: "Antigravity ACP Server", version })), version).not.toThrow();
		}
		const refused: unknown[] = [
			answer({ name: "Antigravity ACP Server", version: "1.5.8" }),
			answer({ name: "Antigravity ACP Server", version: "1.4.99" }),
			answer({ name: "Antigravity ACP Server", version: "1.5" }),
			answer({ name: "Antigravity ACP Server", version: "1.5.9-beta.1" }),
			answer({ name: "Antigravity ACP Server", version: "" }),
			answer({ name: "Antigravity ACP Server" }),
			answer(null),
			{ protocolVersion: 1 },
			undefined,
		];
		for (const a of refused) {
			expect(() => admit(a), JSON.stringify(a)).toThrow(/acp-agy-version-unsupported/);
		}
	});

	it("[QK:ACP-AGY-ADMIT-NAME] a server that does not name itself as agy's ACP server is refused at any version", () => {
		for (const name of ["@agentclientprotocol/claude-agent-acp", "antigravity acp server", "", undefined]) {
			expect(() => admit(answer({ name, version: "1.5.9" })), String(name)).toThrow(/acp-agy-version-unsupported/);
		}
	});
});

// #168 ① — the PreToolUse hook seat and its policy. The oracles are agy's measured shapes (agy 1.5.9,
// #168 lab receipts): the hooks.json literal, the hook stdin key set, and the outcome table — a
// missing command, exit != 0 and a timeout deny, while exit 0 with empty stdout ALLOWS. The hook is
// the real file, spawned; nothing here imports it. The policy is the hook's argument in the seat's
// command, never child env — the shared overlay must not deny a pre-seat pi's children every tool.

/** A PreToolUse stdin as agy 1.5.9 sent it (lab hooklog, paths shortened): the measured key set. */
function hookStdin(tool: string): string {
	return JSON.stringify({
		artifactDirectoryPath: "/g/antigravity-cli/brain/a7bc4f93-04ec-4b90-984c-7fa53baed847",
		conversationId: "a7bc4f93-04ec-4b90-984c-7fa53baed847",
		cwd: "/w",
		hookEventName: "PreToolUse",
		lastUserInput: "do it",
		modelName: "gemini-3.8-flash-low",
		stepIdx: 2,
		toolCall: { args: {}, id: "call_3639952951078831504", name: tool },
		transcriptPath:
			"/g/antigravity-cli/brain/a7bc4f93-04ec-4b90-984c-7fa53baed847/.system_generated/logs/transcript_full.jsonl",
		workspacePaths: ["/w"],
	});
}

/** Run the hook the way agy does: `sh -c <command>`, input on stdin, a scrubbed environment. An absent
 *  policy is the two-path command a seat without the argument would carry. */
function runHook(input: string, policy: string | undefined, hook: string = agyAcpHookPath()) {
	const command =
		policy === undefined ? `'${process.execPath}' '${hook}'` : agyAcpHookCommand(process.execPath, hook, policy);
	const env: Record<string, string> = { PATH: process.env.PATH ?? "/usr/bin:/bin" };
	const r = spawnSync("sh", ["-c", command], { input, env, encoding: "utf8", timeout: 20000 });
	return { status: r.status, stdout: r.stdout };
}

/** One decision line, parsed; anything else fails the caller's assertion. */
function decisionOf(stdout: string): { decision: string; reason?: string } {
	const lines = stdout.split("\n").filter((l) => l !== "");
	expect(lines).toHaveLength(1);
	return JSON.parse(lines[0]);
}

describe("agy ACP tool hook (#168 ①) — the seat, the command, the policy", () => {
	let root: string;
	let real: string;
	let overlay: string;
	const command = "'/n/node' '/h/agy-acp-hook.mjs' 'v1:hidden-turns'";
	beforeEach(() => {
		root = mkdtempSync(join(tmpdir(), "agy-hook-"));
		real = join(root, "real");
		overlay = join(root, "overlay");
		mkdirSync(join(real, "antigravity-cli"), { recursive: true });
		writeFileSync(join(real, "antigravity-cli", "antigravity-oauth-token"), "operator-token");
	});
	afterEach(() => rmSync(root, { recursive: true, force: true }));

	it("[QK:ACP-AGY-HOOKS-SEAT-WRITTEN] config/hooks.json holds one named PreToolUse hook on every tool, in agy's measured shape", () => {
		ensureAgyGeminiOverlay(real, overlay, [], command);
		const seat = join(overlay, "config", "hooks.json");
		expect(lstatSync(seat).isFile()).toBe(true);
		expect(JSON.parse(readFileSync(seat, "utf8"))).toEqual({
			"entwurf-acp-policy": {
				PreToolUse: [{ matcher: "*", hooks: [{ type: "command", command, timeout: 10 }] }],
			},
		});
		// Nothing but the seat lands in config/ — no temp file is left behind.
		expect(readdirSync(join(overlay, "config"))).toEqual(["hooks.json"]);
	});

	it("[QK:ACP-AGY-HOOKS-SEAT-REPLACES-FOREIGN] foreign bytes are replaced; a link at the seat is removed and its target left untouched", () => {
		const seat = join(overlay, "config", "hooks.json");
		mkdirSync(join(overlay, "config"), { recursive: true });
		writeFileSync(seat, "{}");
		ensureAgyGeminiOverlay(real, overlay, [], command);
		expect(JSON.parse(readFileSync(seat, "utf8"))["entwurf-acp-policy"].PreToolUse[0].hooks[0].command).toBe(command);

		const target = join(root, "operator-hooks.json");
		writeFileSync(target, '{"theirs":{}}');
		rmSync(seat);
		symlinkSync(target, seat);
		ensureAgyGeminiOverlay(real, overlay, [], command);
		expect(lstatSync(seat).isSymbolicLink()).toBe(false);
		expect(JSON.parse(readFileSync(seat, "utf8"))["entwurf-acp-policy"]).toBeDefined();
		expect(readFileSync(target, "utf8")).toBe('{"theirs":{}}');
	});

	it("[QK:ACP-AGY-HOOKS-SEAT-DIR-REFUSED] a directory at the seat refuses by name and is left as it was", () => {
		const seat = join(overlay, "config", "hooks.json");
		mkdirSync(join(seat, "inner"), { recursive: true });
		expect(() => ensureAgyGeminiOverlay(real, overlay, [], command)).toThrow(/acp-agy-hooks-seat-not-a-file/);
		expect(statSync(join(seat, "inner")).isDirectory()).toBe(true);
	});

	it("[QK:ACP-AGY-HOOKS-SEAT-UNIQUE-TEMP] two writers never share a temp name: pid and random bytes, beside the seat", () => {
		const seat = join(overlay, "config", "hooks.json");
		const a = agyHooksSeatTempPath(seat);
		const b = agyHooksSeatTempPath(seat);
		expect(a).not.toBe(b);
		for (const temp of [a, b]) {
			expect(dirname(temp)).toBe(dirname(seat));
			expect(temp.startsWith(`${seat}.${process.pid}.`)).toBe(true);
			expect(temp.endsWith(".tmp")).toBe(true);
		}
		// Converging bootstraps leave one file with one set of bytes.
		ensureAgyGeminiOverlay(real, overlay, [], command);
		const first = readFileSync(seat, "utf8");
		ensureAgyGeminiOverlay(real, overlay, [], command);
		expect(readFileSync(seat, "utf8")).toBe(first);
		expect(readdirSync(join(overlay, "config"))).toEqual(["hooks.json"]);
	});

	it("[QK:ACP-AGY-HOOK-PATH-RESOLVES] the hook resolves beside the adapter module and exists there as a regular file", () => {
		const path = agyAcpHookPath();
		expect(dirname(path)).toBe(dirname(fileURLToPath(import.meta.url)));
		expect(path.endsWith("/agy-acp-hook.mjs")).toBe(true);
		expect(statSync(path).isFile()).toBe(true);
	});

	it("[QK:ACP-AGY-HOOK-COMMAND-QUOTED] the command — both paths and the policy — survives a real sh -c round trip with a space, quote, dollar and backtick", () => {
		const odd = join(root, "a b'c$HOME`x`");
		mkdirSync(odd, { recursive: true });
		const hook = join(odd, "agy-acp-hook.mjs");
		copyFileSync(agyAcpHookPath(), hook);
		const cmd = agyAcpHookCommand(process.execPath, hook);
		expect(cmd.endsWith(" 'v1:hidden-turns'")).toBe(true);
		const allowed = runHook(hookStdin("run_command"), "v1:hidden-turns", hook);
		expect(allowed.status).toBe(0);
		expect(decisionOf(allowed.stdout)).toEqual({ decision: "allow" });
		// The policy argument arrives byte for byte: an unknown one is echoed back in the reason.
		const oddPolicy = "v1:x y'$HOME`id`";
		const echoed = runHook(hookStdin("run_command"), oddPolicy, hook);
		expect(echoed.status).toBe(0);
		expect(decisionOf(echoed.stdout).reason).toContain(`unknown policy ${JSON.stringify(oddPolicy)}`);
	});

	it("[QK:ACP-AGY-HOOK-DECISION] v1:hidden-turns denies the three frameless-turn tools with a reason and allows the rest", () => {
		for (const tool of ["invoke_subagent", "schedule", "run_workflow"]) {
			const r = runHook(hookStdin(tool), "v1:hidden-turns");
			expect(r.status, tool).toBe(0);
			const d = decisionOf(r.stdout);
			expect(d.decision, tool).toBe("deny");
			expect(d.reason, tool).toContain(tool);
		}
		for (const tool of ["run_command", "write_file", "view_file", "search_web", "send_message"]) {
			const r = runHook(hookStdin(tool), "v1:hidden-turns");
			expect(r.status, tool).toBe(0);
			expect(decisionOf(r.stdout), tool).toEqual({ decision: "allow" });
		}
	});

	it("[QK:ACP-AGY-HOOK-NO-POLICY-DENIES] an absent, empty or unknown policy argument prints a deny with the fault named", () => {
		for (const policy of [undefined, "", "v2:hidden-turns", "v1:allow-all", "constructor"]) {
			const r = runHook(hookStdin("run_command"), policy);
			const label = String(policy);
			expect(r.status, label).toBe(0);
			const d = decisionOf(r.stdout);
			expect(d.decision, label).toBe("deny");
			expect(d.reason, label).toMatch(/names no policy|unknown policy/);
		}
	});

	it("[QK:ACP-AGY-HOOK-BAD-INPUT-DENIES] input that is not JSON, empty, or names no tool prints a deny", () => {
		for (const input of ["not json at all", "", JSON.stringify({ hookEventName: "PreToolUse", toolCall: {} })]) {
			const r = runHook(input, "v1:hidden-turns");
			expect(r.status, input).toBe(0);
			expect(decisionOf(r.stdout).decision, input).toBe("deny");
		}
	});

	// The invariant agy's outcome table makes load-bearing: exit 0 with nothing on stdout ALLOWS.
	// The hook keeps it with two adjacent defences (the line, and exit 1 when none was written);
	// this claim's mutant removes both.
	it("[QK:ACP-AGY-HOOK-FAILS-CLOSED] whatever the policy or input, the hook exits non-zero or prints a deny — never exit 0 with an empty stdout", () => {
		const cases: Array<[string | undefined, string]> = [
			[undefined, hookStdin("run_command")],
			["v9:unknown", hookStdin("run_command")],
			["v1:hidden-turns", "not json at all"],
			["v1:hidden-turns", hookStdin("invoke_subagent")],
		];
		for (const [policy, input] of cases) {
			const r = runHook(input, policy);
			const label = `${String(policy)} / ${input.slice(0, 20)}`;
			if (r.status !== 0) continue;
			expect(r.stdout, label).not.toBe("");
			expect(decisionOf(r.stdout).decision, label).toBe("deny");
		}
	});

	it("[QK:ACP-AGY-POLICY-SIGNATURE] the seat's command carries the v1:hidden-turns policy, and the policy is part of the reuse signature", () => {
		expect(agyAcpHookCommand("/n/node", "/h/agy-acp-hook.mjs")).toBe(
			"'/n/node' '/h/agy-acp-hook.mjs' 'v1:hidden-turns'",
		);
		expect(agyAdapter.configSignatureFields(undefined)).toEqual({ agyHookPolicy: "v1:hidden-turns" });
		expect(agyAdapter.launchEnvDefaults()).toEqual({});
	});
});

describe("agy ACP tool hook — the adapter's own ensureOverlay, and a seat read by children of either pi (#168 ①)", () => {
	// The overlay and the operator's agy state are module constants resolved from `homedir()` at
	// import (`AGY_REAL_GEMINI_DIR`, `AGY_GEMINI_OVERLAY_DIR`). So HOME points into a temp dir and the
	// module graph is reset BEFORE a fresh import — the static imports at the top of this file keep the
	// operator's values and are not used here. The "token" is meaningless bytes in the sandbox; only the
	// link is under test. The operator's own overlay is lstat-read before and after, never written.
	const operatorOverlay = join(homedir(), ".pi", "agent", "agy-gemini-overlay");
	let sandbox: string;
	let savedHome: string | undefined;
	let savedCommand: string | undefined;

	function operatorOverlayFacts(): string {
		return ["", "config", join("config", "hooks.json"), "antigravity-cli"]
			.map((rel) => {
				try {
					const st = lstatSync(join(operatorOverlay, rel));
					return `${rel}:${st.mode}:${st.mtimeMs}:${st.ino}`;
				} catch {
					return `${rel}:absent`;
				}
			})
			.join("|");
	}

	async function sandboxedAdapter() {
		const home = join(sandbox, "home");
		mkdirSync(join(home, ".gemini", "antigravity-cli"), { recursive: true });
		writeFileSync(join(home, ".gemini", "antigravity-cli", "antigravity-oauth-token"), "not-a-token");
		process.env.HOME = home;
		delete process.env.AGY_ACP_COMMAND;
		vi.resetModules();
		const adapterMod = await import("./backend-adapter.ts");
		const overlayMod = await import("./overlay.ts");
		return { home, adapterMod, overlayMod };
	}

	beforeEach(() => {
		sandbox = mkdtempSync(join(tmpdir(), "agy-wired-"));
		savedHome = process.env.HOME;
		savedCommand = process.env.AGY_ACP_COMMAND;
	});
	afterEach(() => {
		if (savedHome === undefined) delete process.env.HOME;
		else process.env.HOME = savedHome;
		if (savedCommand === undefined) delete process.env.AGY_ACP_COMMAND;
		else process.env.AGY_ACP_COMMAND = savedCommand;
		vi.resetModules();
		rmSync(sandbox, { recursive: true, force: true });
	});

	it("[QK:ACP-AGY-HOOK-WIRED] the adapter's ensureOverlay writes the seat naming the shipped hook with its policy argument, links the token, and sets no env — in the sandbox HOME only", async () => {
		const before = operatorOverlayFacts();
		const { home, adapterMod, overlayMod } = await sandboxedAdapter();
		const overlay = join(home, ".pi", "agent", "agy-gemini-overlay");
		expect(overlayMod.AGY_GEMINI_OVERLAY_DIR).toBe(overlay);

		const result = adapterMod.agyAdapter.ensureOverlay({
			cwd: sandbox,
			modelId: "agy-gemini-3.8-flash",
			nativeModelId: "gemini-3.8-flash",
			config: { adapterSettings: { skillPlugins: [] } } as never,
			sessionKey: "wired-test",
		});
		// The policy rides the seat's command, never child env (a pre-seat pi's children set none).
		expect(result.envOverrides).toEqual({});

		const seat = JSON.parse(readFileSync(join(overlay, "config", "hooks.json"), "utf8"));
		const command: string = seat["entwurf-acp-policy"].PreToolUse[0].hooks[0].command;
		expect(command).toBe(`'${process.execPath}' '${adapterMod.agyAcpHookPath()}' 'v1:hidden-turns'`);
		expect(readlinkSync(join(overlay, "antigravity-cli", "antigravity-oauth-token"))).toBe(
			join(home, ".gemini", "antigravity-cli", "antigravity-oauth-token"),
		);
		expect(operatorOverlayFacts()).toBe(before);
	});

	// The shared overlay is rewritten by whichever pi bootstraps next, and agy re-reads the seat on every
	// call. A child spawned by a pi that predates the seat carries no hook-policy env; a newer pi's child
	// carries what the newer adapter sets. Both must get the same default, never a blanket deny.
	it("[QK:ACP-AGY-HOOK-MIXED-READER] the seat a newer pi writes gives a pre-seat pi's child and a newer pi's child the same hidden-turn default", async () => {
		const { home, adapterMod } = await sandboxedAdapter();
		const overlay = join(home, ".pi", "agent", "agy-gemini-overlay");
		const overlayResult = adapterMod.agyAdapter.ensureOverlay({
			cwd: sandbox,
			modelId: "agy-gemini-3.8-flash",
			nativeModelId: "gemini-3.8-flash",
			config: { adapterSettings: { skillPlugins: [] } } as never,
			sessionKey: "mixed-reader",
		});
		const command: string = JSON.parse(readFileSync(join(overlay, "config", "hooks.json"), "utf8"))[
			"entwurf-acp-policy"
		].PreToolUse[0].hooks[0].command;
		const base = { PATH: process.env.PATH ?? "/usr/bin:/bin" };
		const readers: Array<[string, Record<string, string>]> = [
			// (i) a pre-seat pi set nothing for its agy child.
			["pre-seat pi's child", { ...base }],
			// (ii) a newer pi's child: exactly the env this adapter hands a spawn (identical to (i) today by
			// construction: the adapter sets no hook env; kept so a future env key cannot reintroduce a
			// policy split).
			["newer pi's child", { ...base, ...adapterMod.agyAdapter.launchEnvDefaults(), ...overlayResult.envOverrides }],
		];
		for (const [reader, env] of readers) {
			const run = (tool: string) => {
				const r = spawnSync("sh", ["-c", command], { input: hookStdin(tool), env, encoding: "utf8", timeout: 20000 });
				expect(r.status, `${reader} ${tool}`).toBe(0);
				return decisionOf(r.stdout).decision;
			};
			expect(run("run_command"), reader).toBe("allow");
			for (const tool of ["invoke_subagent", "schedule", "run_workflow"])
				expect(run(tool), `${reader} ${tool}`).toBe("deny");
		}
	});

	it("[QK:ACP-AGY-HOOK-DENY-ALL] v1:deny-all denies every tool with the summary-turn reason and stays fail-closed on malformed input", () => {
		for (const tool of ["run_command", "write_file", "read_file", "search_web", "invoke_subagent"]) {
			const res = spawnSync(process.execPath, [agyAcpHookPath(), "v1:deny-all"], {
				input: hookStdin(tool),
				encoding: "utf8",
				timeout: 10000,
			});
			expect(res.status, tool).toBe(0);
			const parsed = decisionOf(res.stdout);
			expect(parsed.decision, tool).toBe("deny");
			expect(parsed.reason, tool).toContain("summary turn runs no tool");
		}
		const bad = spawnSync(process.execPath, [agyAcpHookPath(), "v1:deny-all"], {
			input: "{not json",
			encoding: "utf8",
			timeout: 10000,
		});
		expect(bad.status).toBe(0);
		expect(decisionOf(bad.stdout).decision).toBe("deny");
	});

	it("[QK:ACP-AGY-SUMMARY-OVERRIDE-REFUSED] AGY_ACP_COMMAND refuses a summary turn by name without leaking its value", async () => {
		const { home, adapterMod } = await sandboxedAdapter();
		const secretSentinel = "/opt/secret-agy-wrapper --token=XYZ";
		const prev = process.env.AGY_ACP_COMMAND;
		process.env.AGY_ACP_COMMAND = secretSentinel;
		try {
			expect(() =>
				adapterMod.agyAdapter.ensureOverlay({
					cwd: sandbox,
					modelId: "agy-gemini-3.8-flash",
					nativeModelId: "gemini-3.8-flash",
					config: { adapterSettings: { skillPlugins: [] } } as never,
					sessionKey: "override-s",
					summaryTurn: true,
				}),
			).toThrow(/acp-agy-summary-override-unsupported/);
			expect(existsSync(join(home, ".pi", "agent", "agy-summary"))).toBe(false);
			expect(() =>
				adapterMod.agyAdapter.resolveLaunch({
					cwd: sandbox,
					modelId: "agy-gemini-3.8-flash",
					nativeModelId: "gemini-3.8-flash",
					config: { adapterSettings: { skillPlugins: [] } } as never,
					summaryTurn: true,
				}),
			).toThrow(/acp-agy-summary-override-unsupported/);
			try {
				adapterMod.agyAdapter.resolveLaunch({
					cwd: sandbox,
					modelId: "agy-gemini-3.8-flash",
					nativeModelId: "gemini-3.8-flash",
					config: { adapterSettings: { skillPlugins: [] } } as never,
					summaryTurn: true,
				});
			} catch (err) {
				const msg = (err as Error).message;
				expect(msg).toContain("AGY_ACP_COMMAND");
				expect(msg).not.toContain(secretSentinel);
			}
		} finally {
			if (prev === undefined) delete process.env.AGY_ACP_COMMAND;
			else process.env.AGY_ACP_COMMAND = prev;
		}
	});

	it("[QK:ACP-AGY-SUMMARY-ISOLATED-DIR] summary ensureOverlay isolates under ~/.pi/agent/agy-summary/<turn>, leaves shared seat bytes intact, and honors S3 cleanup", async () => {
		const { home, adapterMod } = await sandboxedAdapter();
		const sharedOverlay = join(home, ".pi", "agent", "agy-gemini-overlay");
		adapterMod.agyAdapter.ensureOverlay({
			cwd: sandbox,
			modelId: "agy-gemini-3.8-flash",
			nativeModelId: "gemini-3.8-flash",
			config: { adapterSettings: { skillPlugins: [] } } as never,
			sessionKey: "shared-s",
		});
		const sharedSeat = join(sharedOverlay, "config", "hooks.json");
		const sharedBefore = readFileSync(sharedSeat, "utf8");

		const sumOverlay = adapterMod.agyAdapter.ensureOverlay({
			cwd: sandbox,
			modelId: "agy-gemini-3.8-flash",
			nativeModelId: "gemini-3.8-flash",
			config: { adapterSettings: { skillPlugins: [] } } as never,
			sessionKey: "sum-s",
			summaryTurn: true,
		});
		expect(sumOverlay.overlayDir).toBeDefined();
		expect(sumOverlay.effectiveCwd).toBeDefined();
		expect(sumOverlay.overlayDir!.startsWith(join(home, ".pi", "agent", "agy-summary"))).toBe(true);
		expect(sumOverlay.overlayDir).not.toBe(sharedOverlay);
		expect(readFileSync(join(sumOverlay.overlayDir!, "config", "hooks.json"), "utf8")).toContain("v1:deny-all");
		expect(readFileSync(sharedSeat, "utf8")).toBe(sharedBefore);

		const launch = adapterMod.agyAdapter.resolveLaunch({
			cwd: sandbox,
			modelId: "agy-gemini-3.8-flash",
			nativeModelId: "gemini-3.8-flash",
			config: { adapterSettings: { skillPlugins: [] } } as never,
			summaryTurn: true,
			overlayDir: sumOverlay.overlayDir,
		});
		expect(launch.args).toContain(sumOverlay.overlayDir);

		// S3: confirmed child exit + success cleans up (unconfirmed-exit preservation is owned by [QK:ACP-AGY-SUMMARY-CLEANUP-S3]).
		const exited = sumOverlay.cleanup!({ childExited: true, succeeded: true });
		expect(exited.cleaned).toBe(true);
		expect(existsSync(sumOverlay.overlayDir!)).toBe(false);
	});
});
