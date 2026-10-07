/**
 * The pi-durable `--native-module` ingress (#130 P2), beside its subject: the packaged bootstrap's
 * `main` (pi/pi-durable/bootstrap.mjs), driven through its existing seams — `loadTui`, `open` and the
 * contact's connector — so the order of initialization, TUI load and open is observed, not inferred.
 *
 * Fixtures are the synthetic development modules in test/fixtures/pi-durable-native-module (node:*
 * only, no dotenv, nothing real), COPIED per test to a fresh path so every case evaluates its module
 * once; the bad cases are written here. Every test restores process.env and the process directory.
 * What the real carrier, the native registry, the native bash child and an installed package do with
 * a module is proved elsewhere (check-pi-durable-send's native-module cell, check-pack-install).
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { CodingTools } from "@earendil-works/pi-durable/tools";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { main } from "../../plugins/pi-durable/bootstrap.mjs";
import { type BridgeClient, type BridgeSpawnSpec, PI_DURABLE_TOOL_SCHEMAS } from "../meta-bridge-pi-durable.ts";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const FIXTURES = path.join(REPO, "test", "fixtures", "pi-durable-native-module");
const FRESH_ARGS = ["--provider", "loopback", "--model", "scripted", "--width", "task-wide"];
const SESSION_ID = "1759622400000-0b5e2a4c-1f3d-4e8a-9c7b-2d6f8e1a3c5b";
const MOCK_MARK = "mock-native-mark-0f5c";

let root: string;
let cwd: string;
let roots: { sessionsDir: string; sendersDir: string; mailboxDir: string; receiversDir: string };
let envBefore: NodeJS.ProcessEnv;
let cwdBefore: string;
let copies = 0;

beforeEach(() => {
	envBefore = { ...process.env };
	cwdBefore = process.cwd();
	root = fs.mkdtempSync(path.join(os.tmpdir(), "pi-durable-native-module-"));
	cwd = path.join(root, "project");
	fs.mkdirSync(cwd);
	roots = {
		sessionsDir: path.join(root, "meta-sessions"),
		sendersDir: path.join(root, "meta-senders"),
		mailboxDir: path.join(root, "meta-mailbox"),
		receiversDir: path.join(root, "meta-receivers"),
	};
	process.chdir(cwd);
});

afterEach(() => {
	process.chdir(cwdBefore);
	for (const key of Object.keys(process.env)) if (!(key in envBefore)) delete process.env[key];
	for (const [key, value] of Object.entries(envBefore)) process.env[key] = value;
	fs.rmSync(root, { recursive: true, force: true });
});

/** A fresh copy of a fixture (or of literal source) at a new absolute path: evaluated once. */
function moduleFile(source: { fixture: string } | { text: string }): string {
	const file = path.join(root, `module-${++copies}.mjs`);
	if ("fixture" in source) fs.copyFileSync(path.join(FIXTURES, source.fixture), file);
	else fs.writeFileSync(file, source.text);
	return file;
}

/** A bridge stub whose tools/list agrees with the adapter's copies, so the contact's drift check passes. */
function stubBridge() {
	const specs: BridgeSpawnSpec[] = [];
	const client: BridgeClient = {
		pid: 4242,
		listTools: async () =>
			Object.entries(PI_DURABLE_TOOL_SCHEMAS).map(([name, inputSchema]) => ({ name, inputSchema })),
		async callTool(name) {
			return { text: `${name} ok`, isError: false };
		},
		async close() {},
	};
	return {
		specs,
		connect: async (spec: BridgeSpawnSpec) => {
			specs.push(spec);
			return client;
		},
	};
}

interface Trace {
	events: string[];
	opened: { cwd: string; continueSession: boolean; extensions: readonly { name?: string }[] }[];
	markAt: Record<string, string | undefined>;
	cwdAtOpen?: string;
	specs: BridgeSpawnSpec[];
}

/**
 * Run the packaged `main` with a recording TUI loader and open. `onTui` runs inside `loadTui` — after
 * the module phase, before the open. The contact's bridge env is empty unless `processEnv` lets the
 * contact read `process.env`, as production does.
 */
async function runMain(
	argv: string[],
	trace: Trace,
	{ onTui, processEnv = false }: { onTui?: () => void; processEnv?: boolean } = {},
): Promise<void> {
	const bridge = stubBridge();
	trace.specs = bridge.specs;
	await main(argv, {
		loadTui: async () => {
			trace.events.push("loadTui");
			trace.markAt.loadTui = process.env.MOCK_NATIVE_MARK;
			onTui?.();
			return {
				runDurableTui: async () => {
					trace.events.push("tui");
				},
			};
		},
		open: async (options: Trace["opened"][number]) => {
			trace.events.push("open");
			trace.markAt.open = process.env.MOCK_NATIVE_MARK;
			trace.cwdAtOpen = process.cwd();
			trace.opened.push(options);
			return {
				view: {
					current: () => ({ session: { id: SESSION_ID, directory: path.join(root, "durable"), cwd: options.cwd } }),
				},
				controller: {},
				settings: {},
				submitToRoot: async () => ({ id: 41 }),
				close: async () => {},
			};
		},
		contact: { ...roots, ...(processEnv ? {} : { env: {} }), connect: bridge.connect },
	});
}

const newTrace = (): Trace => ({ events: [], opened: [], markAt: {}, specs: [] });

describe("pi-durable --native-module ingress (#130 P2)", () => {
	it("[QK:PI-DURABLE-MODULE-ABSENT-UNCHANGED] without the flag nothing is imported and the app is opened with exactly the contact, as before", async () => {
		const trace = newTrace();
		await runMain([...FRESH_ARGS], trace);
		expect(trace.events).toEqual(["loadTui", "open", "tui"]);
		expect(trace.opened).toHaveLength(1);
		expect(trace.opened[0]?.extensions.map((e) => e.name)).toEqual(["entwurf"]);
		expect(trace.opened[0]?.cwd).toBe(fs.realpathSync(cwd));
		expect(process.env.MOCK_NATIVE_MARK).toBeUndefined();
	});

	it("[QK:PI-DURABLE-MODULE-PATH-REFUSED] a relative, a missing or a non-file path is refused by name before any module, the TUI or the app loads", async () => {
		const relative = path.basename(moduleFile({ fixture: "mock.mjs" }));
		process.chdir(root); // the relative name DOES resolve here: only the absolute rule refuses it
		for (const [value, reason] of [
			[relative, /^native-module-path-not-absolute: /],
			[path.join(root, "absent.mjs"), /^native-module-path-invalid: /],
			[cwd, /^native-module-path-invalid: .* is not a regular file/],
		] as const) {
			const trace = newTrace();
			await expect(runMain([...FRESH_ARGS, "--native-module", value], trace)).rejects.toThrow(reason);
			expect(trace.events).toEqual([]);
		}
		expect(process.env.MOCK_NATIVE_MARK).toBeUndefined();
	});

	it("[QK:PI-DURABLE-MODULE-INIT-BEFORE-RUNTIME] the module's evaluation, top-level await included, completes before the TUI loads and before the app opens — new and continued sessions alike", async () => {
		for (const argv of [
			[...FRESH_ARGS, "--native-module", moduleFile({ fixture: "mock.mjs" })],
			["--continue", "--native-module", moduleFile({ fixture: "mock.mjs" })],
		]) {
			delete process.env.MOCK_NATIVE_MARK;
			const trace = newTrace();
			await runMain(argv, trace);
			expect(trace.events).toEqual(["loadTui", "open", "tui"]);
			expect(trace.markAt).toEqual({ loadTui: MOCK_MARK, open: MOCK_MARK });
			expect(trace.opened[0]?.continueSession).toBe(argv[0] === "--continue");
		}
	});

	it("[QK:PI-DURABLE-MODULE-IMPORT-FAILED] a module whose evaluation throws, or whose top-level await rejects, is a named refusal and nothing opens", async () => {
		for (const [text, cause] of [
			['throw new Error("boom at init");\nexport default { name: "never" };\n', "boom at init"],
			['await Promise.reject(new Error("late boom"));\nexport default { name: "never" };\n', "late boom"],
		] as const) {
			const trace = newTrace();
			await expect(runMain([...FRESH_ARGS, "--native-module", moduleFile({ text })], trace)).rejects.toThrow(
				new RegExp(`^native-module-import-failed: .*${cause}`),
			);
			expect(trace.events).toEqual([]);
		}
	});

	it("[QK:PI-DURABLE-MODULE-IDENTITY-GUARD] an identity carrier changed, added or removed by the module's initialization is refused by key name (never its value); an unrelated key passes", async () => {
		process.env.ENTWURF_NATIVE_MODULE_TEST_PRESENT = "present";
		const marker = "TEST_ONLY_IDENTITY_MARKER";
		for (const [line, key] of [
			[`process.env.PI_SESSION_ID = "${marker}";`, "PI_SESSION_ID"],
			[`process.env.PI_CODING_AGENT_DIR = "/tmp/${marker}";`, "PI_CODING_AGENT_DIR"],
			[`process.env.HOME = "/tmp/${marker}";`, "HOME"],
			[`process.env.ENTWURF_NATIVE_MODULE_TEST_ADDED = "${marker}";`, "ENTWURF_NATIVE_MODULE_TEST_ADDED"],
			["delete process.env.ENTWURF_NATIVE_MODULE_TEST_PRESENT;", "ENTWURF_NATIVE_MODULE_TEST_PRESENT"],
		] as const) {
			const trace = newTrace();
			const text = `${line}\nexport default { name: "identity-mover" };\n`;
			const refusal = await runMain([...FRESH_ARGS, "--native-module", moduleFile({ text })], trace).then(
				() => undefined,
				(error: Error) => error,
			);
			expect(refusal?.message).toMatch(new RegExp(`^native-module-env-identity-changed: .*${key}`));
			expect(refusal?.message).not.toContain(marker);
			expect(trace.events).toEqual([]);
			for (const k of Object.keys(process.env)) if (!(k in envBefore)) delete process.env[k];
			for (const [k, v] of Object.entries(envBefore)) process.env[k] = v;
			process.env.ENTWURF_NATIVE_MODULE_TEST_PRESENT = "present";
		}
		const trace = newTrace();
		const unrelated = 'process.env.MOCK_UNRELATED = "set";\nexport default { name: "unrelated-env" };\n';
		await runMain([...FRESH_ARGS, "--native-module", moduleFile({ text: unrelated })], trace);
		expect(trace.events).toEqual(["loadTui", "open", "tui"]);
		expect(process.env.MOCK_UNRELATED).toBe("set");
	});

	it("[QK:PI-DURABLE-MODULE-CWD-PINNED] a module that moves the process is refused; and the caller's directory, fixed before the module ran, is what the app is opened in even when the process moves before the open", async () => {
		const elsewhere = fs.mkdtempSync(path.join(root, "elsewhere-"));
		const moving = newTrace();
		const text = `process.chdir(${JSON.stringify(elsewhere)});\nexport default { name: "dir-mover" };\n`;
		await expect(runMain([...FRESH_ARGS, "--native-module", moduleFile({ text })], moving)).rejects.toThrow(
			/^native-module-cwd-changed: /,
		);
		expect(moving.events).toEqual([]);

		// Control: the process moves AFTER the module phase (inside the TUI loader), before the open.
		process.chdir(cwd);
		const trace = newTrace();
		await runMain([...FRESH_ARGS, "--native-module", moduleFile({ fixture: "mock.mjs" })], trace, {
			onTui: () => process.chdir(elsewhere),
		});
		expect(trace.cwdAtOpen).toBe(fs.realpathSync(elsewhere)); // the control really moved the process
		expect(trace.opened[0]?.cwd).toBe(fs.realpathSync(cwd));
	});

	it("[QK:PI-DURABLE-MODULE-EXPORT-NAME] only the ingress checks: a function default, no default object or no name is invalid; an extension or contact tool name the app owns is reserved; an env-only module passes; native validation is left to the native registry", async () => {
		const reserved = ["entwurf", "coding-tools", "pi-prompt", "subagent"];
		// The reserved names are the carrier's own: read from the pinned sources, not retyped.
		expect(CodingTools.name).toBe("coding-tools");
		expect(fs.readFileSync(path.join(REPO, "pi", "pi-durable", "carrier", "prompt.js"), "utf8")).toContain(
			'name: "pi-prompt"',
		);
		expect(fs.readFileSync(path.join(REPO, "pi", "pi-durable", "carrier", "subagent.js"), "utf8")).toContain(
			'name: "subagent"',
		);
		const refused: [string, RegExp][] = [
			["export default function (pi) {}\n", /^native-module-export-invalid: .*classic ExtensionAPI factory/],
			["export const notDefault = { name: 'x' };\n", /^native-module-export-invalid: .*no default export object/],
			["export default { tools: [] };\n", /^native-module-export-invalid: .*has no name/],
			...reserved.map((name): [string, RegExp] => [
				`export default { name: "${name}" };\n`,
				/^native-module-name-reserved: /,
			]),
			[
				'export default { name: "taker", tools: [{ name: "entwurf_v2", parameters: {}, execute() {} }] };\n',
				/^native-module-name-reserved: .*entwurf_v2/,
			],
		];
		for (const [text, reason] of refused) {
			const trace = newTrace();
			await expect(runMain([...FRESH_ARGS, "--native-module", moduleFile({ text })], trace)).rejects.toThrow(reason);
			expect(trace.events).toEqual([]);
		}
		const envOnly = newTrace();
		await runMain([...FRESH_ARGS, "--native-module", moduleFile({ fixture: "env-only.mjs" })], envOnly);
		expect(envOnly.opened[0]?.extensions.map((e) => e.name)).toEqual(["entwurf", "mock-env-only"]);
		// Two tools of one name is the native registry's refusal (registry.js validateExtension), not this ingress's.
		const nativeInvalid = newTrace();
		const twice = 'export default { name: "twice", tools: [{ name: "a" }, { name: "a" }] };\n';
		await runMain([...FRESH_ARGS, "--native-module", moduleFile({ text: twice })], nativeInvalid);
		expect(nativeInvalid.opened[0]?.extensions.map((e) => e.name)).toEqual(["entwurf", "twice"]);
	});

	it("[QK:PI-DURABLE-MODULE-EXTENSION-ORDER] the app is opened with the contact first and the module's default export after it, by reference", async () => {
		const file = moduleFile({ fixture: "mock.mjs" });
		const trace = newTrace();
		await runMain([...FRESH_ARGS, "--native-module", file], trace);
		const exported = ((await import(pathToFileURL(file).href)) as { default: object }).default;
		const extensions = trace.opened[0]?.extensions ?? [];
		expect(extensions).toHaveLength(2);
		expect(extensions[0]?.name).toBe("entwurf");
		expect(extensions[1]).toBe(exported);
	});

	it("[QK:PI-DURABLE-MODULE-BRIDGE-ENV-SPEC] the bridge spawn SPEC the contact hands its connector carries what the module set (the spec, not the bridge child's actual inheritance)", async () => {
		const trace = newTrace();
		await runMain([...FRESH_ARGS, "--native-module", moduleFile({ fixture: "mock.mjs" })], trace, { processEnv: true });
		expect(trace.specs).toHaveLength(1);
		expect(trace.specs[0]?.env.MOCK_NATIVE_MARK).toBe(MOCK_MARK);
	});
});
