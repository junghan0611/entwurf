/**
 * The Antigravity ACP adapter (#167): `agy acp` driven as a child of a host pi citizen.
 *
 * The oracles are literals copied from the wire as agy 1.5.9 answered on 2026-11-16 (receipts on
 * #167) — the answer shape of `session/set_config_option`, the offered `thought_level` values per
 * model, the launch arguments — never the adapter's own constants, so a change to the adapter
 * cannot move its own check. No vendor runtime is certified here; that is the LIVE axis.
 */
import {
	lstatSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	readlinkSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isRetryableAssistantError } from "@earendil-works/pi-ai/compat";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
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
import { ensureAgyGeminiOverlay } from "./overlay.ts";

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
});

describe("agy ACP capabilities it does not declare", () => {
	it("[QK:ACP-AGY-NO-SEAL] agy seals no turn accounting — its usage_update carries no cost", () => {
		expect("sealsTurnAccounting" in agyAdapter).toBe(false);
		expect(agyAdapter.resolveAdapterSettings(blocks({}, {}))).toEqual({ skillPlugins: [] });
		expect(agyAdapter.configSignatureFields(undefined)).toEqual({});
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
