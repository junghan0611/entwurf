/**
 * check-herdr-activation — deterministic gate for the #116 M3-b2 scoped activation
 * (`scripts/herdr-activation.mjs`, `scripts/herdr-plugin-deactivate.mjs`, and the explicit plugin
 * modes in the Pi provider writer and the Claude state owner).
 *
 * WHAT IS REAL HERE AND WHAT STANDS IN. The Pi cells drive the REAL writers — `run.sh
 * install-user-scope`, `register-pi-provider.py`, `remove-user-scope` — against a sandboxed HOME,
 * XDG and `PI_CODING_AGENT_DIR`, so the bytes asserted are bytes those writers actually produced.
 * The Claude cells drive the REAL state owner's pure surfaces (`desired-mcp`,
 * `desired-statusline`, `preflight-install`, `preflight-uninstall`); the vendor `claude` CLI is NOT
 * invoked and its acceptance of an absolute executable stays a named LIVE boundary. Nothing in this
 * file claims the vendor result.
 *
 * WHY THE ORACLE IS JSON EQUALITY, NOT BYTES. Measured 2026-09-16: the pi settings writer preserves
 * semantics and unrelated keys but may reindent. "Byte-identical" would therefore fail a correct
 * roundtrip and pass nothing extra — the honest oracle is JSON equality plus unrelated-key survival
 * plus zero install-state.
 *
 * Each [QK:HAC-*] token appears exactly once, and the cells are ordered so a mutant of one claim
 * cannot trip an earlier claim's assertion first.
 */

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { reclaimOnExit } from "./lib/reclaim-on-exit.ts";

let passed = 0;
function ok(label: string, cond: boolean): void {
	assert.ok(cond, label);
	console.log(`  ok    ${label}`);
	passed++;
}

const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const ACTIVATION = path.join(REPO, "scripts", "herdr-activation.mjs");
const DEACTIVATE = path.join(REPO, "scripts", "herdr-plugin-deactivate.mjs");
const ACTIVATE = path.join(REPO, "scripts", "herdr-plugin-activate.mjs");
const COMPILED_ENTRY = path.join("mcp", "entwurf-bridge", "dist", "mcp", "entwurf-bridge", "src", "index.js");

/**
 * A runtime at the stable address that the runtime owner certifies: a package tree, the compiled
 * entry, three executable bins, and a `runtime-ready` journal. The activation verb refuses without
 * one, and it should — activating against an address nothing put a runtime at is the failure this
 * whole lane exists to make impossible.
 */
const PACKAGE = "@junghanacs/entwurf";
/**
 * Three artifact identities in the ONE union the runtime journal and this ledger share: two
 * checkout-sourced commits of the SAME package version (which is the whole point — a version cannot
 * tell them apart) and one npm-sourced spec, for the source-drift cell.
 */
const IDENTITY_A = {
	kind: "herdr-checkout",
	repository: "junghan0611/entwurf",
	commit: "a".repeat(40),
	packageName: PACKAGE,
	packageVersion: "0.21.0",
	observedDigest: `sha256-${"a".repeat(64)}`,
};
const IDENTITY_B = { ...IDENTITY_A, commit: "b".repeat(40), observedDigest: `sha256-${"b".repeat(64)}` };
const IDENTITY_NPM = {
	kind: "npm",
	name: PACKAGE,
	version: "0.21.0",
	expectedIntegrity: "sha512-fixture",
	observedDigest: `sha256-${"c".repeat(64)}`,
};

function seedRuntime(env: NodeJS.ProcessEnv, identity: Record<string, unknown> = IDENTITY_A): string {
	const active = runtimeRootOf(env);
	const pkg = path.join(active, "node_modules", "@junghanacs", "entwurf");
	fs.mkdirSync(path.join(pkg, path.dirname(COMPILED_ENTRY)), { recursive: true });
	fs.writeFileSync(
		path.join(pkg, "package.json"),
		`${JSON.stringify({ name: "@junghanacs/entwurf", version: "0.21.0" })}\n`,
	);
	fs.writeFileSync(path.join(pkg, COMPILED_ENTRY), "// compiled entry fixture\n");
	const bin = path.join(active, "node_modules", ".bin");
	fs.mkdirSync(bin, { recursive: true });
	for (const name of ["entwurf", "entwurf-bridge", "entwurf-statusline"]) {
		fs.writeFileSync(path.join(bin, name), "#!/bin/sh\nexit 0\n");
		fs.chmodSync(path.join(bin, name), 0o755);
	}
	fs.writeFileSync(
		path.join(env.XDG_DATA_HOME as string, "entwurf", "herdr-plugin", "journal.json"),
		`${JSON.stringify({
			schemaVersion: 2,
			phase: "runtime-ready",
			runtimeRoot: active,
			artifactIdentity: identity,
			previousRuntime: null,
		})}\n`,
	);
	return active;
}

/**
 * A faithful-enough `claude` for the installer's OWN calls. It stands in for the vendor CLI's
 * INTERFACE, never for its judgement: whether the real Claude Code accepts an absolute executable
 * as an MCP command is a LIVE question and nothing in this file answers it.
 */
function fakeClaude(env: NodeJS.ProcessEnv): string {
	const dir = path.join(env.HOME as string, "fake-claude-bin");
	fs.mkdirSync(dir, { recursive: true });
	fs.writeFileSync(
		path.join(dir, "claude"),
		[
			"#!/usr/bin/env bash",
			'printf \'%s\\n\' "$*" >> "${FAKE_CLAUDE_LOG:?}"',
			'case "$1${2:+ $2}" in',
			'  "--version") echo "2.1.217 (Claude Code)" ;;',
			'  "plugin validate") : ;;',
			'  "plugin uninstall") : ;;',
			'  "plugin marketplace") : ;;',
			'  "plugin install") : ;;',
			'  "plugin list") printf \'%s\\n\' "entwurf-meta-receive@meta-bridge-local" "  Status: enabled" ;;',
			'  "mcp remove") : ;;',
			'  "mcp add") : ;;',
			'  "mcp get") printf \'%s\\n\' "Scope: User config" "Status: ✔ Connected" ;;',
			"  *) : ;;",
			"esac",
			"exit 0",
		].join("\n"),
	);
	fs.chmodSync(path.join(dir, "claude"), 0o755);
	return dir;
}

interface Root {
	path: string;
	source: string;
}
interface Ledger {
	schemaVersion: number;
	phase: string;
	runtimeRoot: string;
	artifactIdentity: Record<string, string>;
	piAgentDir: Root;
	claudeConfigDir: Root;
	claudeUserConfig: Root;
	activatedBackends: string[];
	components: { backend: string; state: string }[];
}
interface Layout {
	stateRoot: string;
	ledgerPath: string;
}
interface Mod {
	ACTIVATABLE_BACKENDS: string[];
	LEDGER_KEYS: string[];
	resolveActivationLayout: (env: NodeJS.ProcessEnv) => Layout;
	resolveComponentRoots: (env: NodeJS.ProcessEnv) => {
		piAgentDir: Root;
		claudeConfigDir: Root;
		claudeUserConfig: Root;
	};
	readCertifiedLedger: (layout: Layout) => Ledger | null;
	writeLedger: (layout: Layout, entry: Record<string, unknown>) => void;
	certifyRootsAgainstLedger: (ledger: Ledger | null, roots: unknown, runtimeRoot: string) => void;
	planActivation: (args: { ledger: Ledger | null; requested: string[] }) => {
		reconcile: string[];
		add: string[];
		retained: string[];
		resulting: string[];
	};
	planDeactivation: (ledger: Ledger | null) => string[];
	certifyPhaseForForward: (ledger: Ledger | null, requested: string[]) => void;
	certifyPhaseForInverse: (ledger: Ledger | null) => void;
	ledgerBody: (args: {
		phase: string;
		runtimeRoot: string;
		artifactIdentity: Record<string, unknown>;
		roots: { piAgentDir: Root; claudeConfigDir: Root; claudeUserConfig: Root };
		states: Record<string, string>;
	}) => Record<string, unknown>;
	certifyArtifactForForward: (ledger: Ledger | null, current: Record<string, unknown>, requested: string[]) => string;
	piStatePaths: (env: NodeJS.ProcessEnv) => { packageState: string; providerState: string };
	resolveEntwurfDataRoot: (env: NodeJS.ProcessEnv) => string;
	LEDGER_PHASES: string[];
	COMPONENT_STATES: string[];
}

const mod = (await import(pathToFileURL(ACTIVATION).href)) as Mod;
const {
	ACTIVATABLE_BACKENDS,
	LEDGER_KEYS,
	resolveActivationLayout,
	resolveComponentRoots,
	readCertifiedLedger,
	writeLedger,
	certifyRootsAgainstLedger,
	planActivation,
	planDeactivation,
	certifyPhaseForForward,
	certifyPhaseForInverse,
	certifyArtifactForForward,
	ledgerBody,
	piStatePaths,
	resolveEntwurfDataRoot,
	LEDGER_PHASES,
	COMPONENT_STATES,
} = mod;

/** The pi pin package.json declares — the SSOT `run.sh pi_supported_range` derives its range from. */
const PI_PIN = (
	JSON.parse(fs.readFileSync(path.join(REPO, "package.json"), "utf8")) as {
		devDependencies: Record<string, string>;
	}
).devDependencies["@earendil-works/pi-coding-agent"];

/** A `pi` stand-in that reports `version` and nothing else — enough for a `--version` floor probe. */
function fakePi(dir: string, name: string, version: string): string {
	fs.mkdirSync(dir, { recursive: true });
	const file = path.join(dir, name);
	fs.writeFileSync(file, `#!/bin/sh\necho ${version}\n`, { mode: 0o755 });
	return file;
}

function world(tag: string): NodeJS.ProcessEnv {
	const home = reclaimOnExit(fs.mkdtempSync(path.join(os.tmpdir(), `entwurf-hac-${tag}-`)));
	for (const d of [".config", ".state", ".data", ".cache", "pi-agent", ".claude"]) {
		fs.mkdirSync(path.join(home, d), { recursive: true });
	}
	return {
		PATH: process.env.PATH,
		HOME: home,
		TERM: "dumb",
		XDG_CONFIG_HOME: path.join(home, ".config"),
		XDG_STATE_HOME: path.join(home, ".state"),
		XDG_DATA_HOME: path.join(home, ".data"),
		XDG_CACHE_HOME: path.join(home, ".cache"),
		PI_CODING_AGENT_DIR: path.join(home, "pi-agent"),
		CLAUDE_CONFIG_DIR: path.join(home, ".claude"),
		// PI_BIN is a sandbox root like the four XDG vars above, not a convenience. Since #119
		// `install-user-scope` probes `pi --version` against the same closed range setup enforces,
		// so leaving this unset would let the OPERATOR'S installed pi decide whether these cells
		// pass — the gate would go red on a developer machine sitting one minor behind the pin and
		// green on another, for reasons none of these cells are about. It is pinned IN RANGE here;
		// the one cell whose subject IS the floor overrides it per run.
		PI_BIN: fakePi(path.join(home, "bin"), "pi", PI_PIN),
	};
}

function sh(env: NodeJS.ProcessEnv, args: string[]) {
	return spawnSync("bash", [path.join(REPO, "run.sh"), ...args], { encoding: "utf8", env, cwd: REPO });
}
function py(env: NodeJS.ProcessEnv, script: string, args: string[]) {
	return spawnSync("python3", [path.join(REPO, "scripts", script), ...args], { encoding: "utf8", env, cwd: REPO });
}
function readJson(file: string): unknown {
	return JSON.parse(fs.readFileSync(file, "utf8"));
}
/**
 * The `command` a helper run PRINTED, or `null` when it printed no readable one.
 *
 * A cell that reads `JSON.parse(run.stdout).command` inline dies with a SyntaxError the moment the
 * helper exits non-zero — and a gate that dies before its own assertion reports someone else's
 * failure, which is exactly the WRONG-REASON shape a mutant must never produce. So the parse is
 * done defensively and the ASSERTION decides, with the run's own exit code and stderr carried into
 * the message.
 */
function printedCommand(run: { status: number | null; stdout: string }): string | null {
	if (run.status !== 0) return null;
	try {
		const parsed = JSON.parse(run.stdout) as { command?: unknown };
		return typeof parsed.command === "string" ? parsed.command : null;
	} catch {
		return null;
	}
}
function refusal(fn: () => unknown): string | null {
	try {
		fn();
		return null;
	} catch (err) {
		return (err as { code?: string }).code ?? `not-an-ActivationError:${String(err)}`;
	}
}
function runtimeRootOf(env: NodeJS.ProcessEnv): string {
	return path.join(env.XDG_DATA_HOME as string, "entwurf", "herdr-plugin", "runtime", "active");
}
function ledgerFor(
	env: NodeJS.ProcessEnv,
	backends: string[],
	phase = "active",
	artifactIdentity: Record<string, unknown> = IDENTITY_A,
): Record<string, unknown> {
	const states: Record<string, string> = {};
	for (const b of backends) states[b] = "active";
	return ledgerBody({
		phase,
		runtimeRoot: runtimeRootOf(env),
		artifactIdentity,
		roots: resolveComponentRoots(env),
		states,
	});
}
function ledgerWith(
	env: NodeJS.ProcessEnv,
	phase: string,
	states: Record<string, string>,
	artifactIdentity: Record<string, unknown> = IDENTITY_A,
): Record<string, unknown> {
	return ledgerBody({
		phase,
		runtimeRoot: runtimeRootOf(env),
		artifactIdentity,
		roots: resolveComponentRoots(env),
		states,
	});
}

// ── 1. activation writes the global pi citizen and NOTHING in a project ────────
{
	const env = world("pi-only");
	const agentSettings = path.join(env.PI_CODING_AGENT_DIR as string, "settings.json");
	fs.writeFileSync(agentSettings, '{"theme":"dark"}\n');
	const opencode = path.join(env.HOME as string, ".config", "opencode");
	fs.mkdirSync(opencode, { recursive: true });
	fs.writeFileSync(path.join(opencode, "plugins.json"), "{}\n");
	const opencodeBefore = fs.readFileSync(path.join(opencode, "plugins.json"), "utf8");
	const run = sh(env, ["install-user-scope", "--plugin-runtime", runtimeRootOf(env)]);
	const after = readJson(agentSettings) as { packages?: string[]; entwurfProvider?: Record<string, never> };
	// ANY project settings file anywhere under the sandbox HOME counts: the claim is not that one
	// known path stayed clean, it is that plugin activation invents no project at all.
	const projectWrites: string[] = [];
	const walk = (dir: string): void => {
		for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
			const abs = path.join(dir, e.name);
			if (e.isDirectory()) walk(abs);
			else if (abs.endsWith(path.join(".pi", "settings.json"))) {
				projectWrites.push(path.relative(env.HOME as string, abs));
			}
		}
	};
	walk(env.HOME as string);
	ok(
		"[QK:HAC-PI-USER-SCOPE-ONLY] plugin activation composes the GLOBAL pi citizen and writes no project " +
			"`.pi/settings.json` — generic `install` writes both halves, but a Herdr plugin has no project and " +
			"inventing one would leave a second package identity that `--entwurf-control` then has to arbitrate " +
			`(exit=${run.status} packages=${JSON.stringify(after.packages)} project-writes=${JSON.stringify(projectWrites)} opencode-untouched=${fs.readFileSync(path.join(opencode, "plugins.json"), "utf8") === opencodeBefore})`,
		run.status === 0 &&
			Array.isArray(after.packages) &&
			after.packages.length === 1 &&
			after.entwurfProvider !== undefined &&
			projectWrites.length === 0 &&
			fs.readFileSync(path.join(opencode, "plugins.json"), "utf8") === opencodeBefore,
	);
}

// ── 1b. the plugin door enforces the SAME pi floor the setup door does ────────
// #119: `setup` refuses an out-of-range pi by name before it writes any Pi wiring, but
// `install-user-scope` — the door herdr plugin activation actually goes through
// (plugins/herdr/lib/build.mjs → scripts/herdr-plugin-activate.mjs → `run.sh
// install-user-scope --plugin-runtime …`) — had no version check at all. Two doors onto ONE
// registration telling different truths is the whole defect, so the oracle here is the
// out-of-range/in-range PAIR: the refusal alone would also be satisfied by a door that refuses
// everything. Absent pi is deliberately NOT asserted as a third state — this verb invents no
// presence verdict, setup owns that one.
{
	const env = world("pi-floor");
	const bin = path.join(env.HOME as string, "bin");
	// The supported range is DERIVED from the package.json devDep pin (run.sh
	// `pi_supported_range`), so the fixtures are derived from it too — a hardcoded "0.85.1" here
	// would silently stop being out-of-range the day the pin moves past it.
	const [maj, min] = PI_PIN.split(".").map(Number);
	const belowFloor = `${maj}.${min - 1}.0`;
	const settingsPath = path.join(env.PI_CODING_AGENT_DIR as string, "settings.json");
	fs.writeFileSync(settingsPath, '{"theme":"dark"}\n');
	const before = fs.readFileSync(settingsPath, "utf8");

	const stale = sh({ ...env, PI_BIN: fakePi(bin, "stale-pi", belowFloor) }, [
		"install-user-scope",
		"--plugin-runtime",
		runtimeRootOf(env),
	]);
	const afterRefusal = fs.readFileSync(settingsPath, "utf8");
	const current = sh({ ...env, PI_BIN: fakePi(bin, "current-pi", PI_PIN) }, [
		"install-user-scope",
		"--plugin-runtime",
		runtimeRootOf(env),
	]);
	const afterAccept = readJson(settingsPath) as { packages?: string[] };

	ok(
		"[QK:HAC-PI-FLOOR-BOTH-DOORS] the plugin activation door enforces the SAME closed pi range as the " +
			"setup door: a below-floor pi is a named FAIL that writes zero settings bytes (not a SKIP, not a " +
			"silent write), while an in-range pi still registers — one registration reached through two doors " +
			"may not report two different verdicts, and the range both read is DERIVED from one package.json pin " +
			`(pin=${PI_PIN} stale=${belowFloor}/exit=${stale.status} named=${(stale.stderr || "").includes("outside the supported range")} ` +
			`untouched=${before === afterRefusal} current=exit=${current.status}/packages=${JSON.stringify(afterAccept.packages)})`,
		stale.status !== 0 &&
			(stale.stderr || "").includes("[install-user-scope] pi: FAIL") &&
			(stale.stderr || "").includes("outside the supported range") &&
			before === afterRefusal &&
			current.status === 0 &&
			Array.isArray(afterAccept.packages) &&
			afterAccept.packages.length === 1,
	);
}

// ── 2. the plugin command is DERIVED from the runtime root, never supplied ─────
{
	const env = world("derived");
	const settings = path.join(env.HOME as string, "settings.json");
	const state = path.join(env.HOME as string, "state.json");
	fs.writeFileSync(settings, "{}\n");
	const root = runtimeRootOf(env);
	py(env, "register-pi-provider.py", [
		"install",
		settings,
		REPO,
		"--scope",
		"user",
		"--state",
		state,
		"--plugin-runtime",
		root,
	]);
	const written = (readJson(settings) as { entwurfProvider: { mcpServers: { "entwurf-bridge": { command: string } } } })
		.entwurfProvider.mcpServers["entwurf-bridge"].command;
	const relative = py(env, "register-pi-provider.py", [
		"install",
		settings,
		REPO,
		"--scope",
		"user",
		"--state",
		state,
		"--plugin-runtime",
		"relative/path",
	]);
	const trailing = py(env, "register-pi-provider.py", [
		"install",
		settings,
		REPO,
		"--scope",
		"user",
		"--state",
		state,
		"--plugin-runtime",
		`${root}/`,
	]);
	// An ARBITRARY absolute directory is the shape this mode must not accept: "absolute" was never
	// the contract, "this host's stable runtime" was. And a flag with no value must not fall through
	// to bare mode — the caller asked for the plugin runtime and would be told, silently, that it
	// got it.
	const arbitrary = py(env, "register-pi-provider.py", [
		"install",
		settings,
		REPO,
		"--scope",
		"user",
		"--state",
		state,
		"--plugin-runtime",
		path.join(env.HOME as string, "somewhere-else"),
	]);
	const noValue = py(env, "register-pi-provider.py", [
		"install",
		settings,
		REPO,
		"--scope",
		"user",
		"--state",
		state,
		"--plugin-runtime",
	]);
	const claudeArbitrary = py(env, "meta-bridge-state.py", [
		"desired-mcp",
		"--repo",
		REPO,
		"--plugin-runtime",
		path.join(env.HOME as string, "somewhere-else"),
	]);
	const shellNoValue = sh(env, ["install-user-scope", "--plugin-runtime"]);
	const claudeMcp = py(env, "meta-bridge-state.py", ["desired-mcp", "--repo", REPO, "--plugin-runtime", root]);
	const claudeStatus = py(env, "meta-bridge-state.py", [
		"desired-statusline",
		"--repo",
		REPO,
		"--plugin-runtime",
		root,
	]);
	ok(
		"[QK:HAC-COMMAND-IS-DERIVED] both harnesses get an absolute command DERIVED from THIS HOST'S stable runtime root by " +
			"appending a fixed suffix — the caller may NAME the root and it is accepted only when it IS that one, so a " +
			"relative, unnormalised, absent or merely-absolute-somewhere-else value is refused. Accepting any absolute " +
			"directory would be a 'point every pi session and every Claude MCP call at an executable of my choosing' " +
			`authority wearing a plugin's clothes (pi=${written.endsWith("/node_modules/.bin/entwurf-bridge")} relative=${relative.status} trailing=${trailing.status} claude-mcp-exit=${claudeMcp.status})`,
		written === path.join(root, "node_modules", ".bin", "entwurf-bridge") &&
			relative.status !== 0 &&
			trailing.status !== 0 &&
			arbitrary.status !== 0 &&
			claudeArbitrary.status !== 0 &&
			noValue.status !== 0 &&
			shellNoValue.status !== 0 &&
			claudeMcp.status === 0 &&
			(JSON.parse(claudeMcp.stdout) as { command: string }).command ===
				path.join(root, "node_modules", ".bin", "entwurf-bridge") &&
			(JSON.parse(claudeStatus.stdout) as { command: string }).command ===
				path.join(root, "node_modules", ".bin", "entwurf-statusline"),
	);
}

// ── 3. default mode is byte-for-byte what it always was ────────────────────────
{
	const env = world("default-mode");
	const settings = path.join(env.HOME as string, "settings.json");
	const state = path.join(env.HOME as string, "state.json");
	fs.writeFileSync(settings, "{}\n");
	py(env, "register-pi-provider.py", ["install", settings, REPO, "--scope", "user", "--state", state]);
	const piDefault = (
		readJson(settings) as { entwurfProvider: { mcpServers: { "entwurf-bridge": { command: string } } } }
	).entwurfProvider.mcpServers["entwurf-bridge"].command;
	const claudeDefault = py(env, "meta-bridge-state.py", ["desired-mcp", "--repo", REPO]);
	const claudeStatusDefault = py(env, "meta-bridge-state.py", ["desired-statusline", "--repo", REPO]);
	const claudeDefaultCommand = printedCommand(claudeDefault);
	const claudeStatusDefaultCommand = printedCommand(claudeStatusDefault);
	ok(
		"[QK:HAC-DEFAULT-MODE-UNCHANGED] with no mode requested the pi provider still writes the bare `entwurf-bridge` " +
			"and the Claude owner still answers from its historical installed/clone branch — every host that never asks " +
			"for the plugin mode keeps the bytes it had, which is the only thing that makes adding a mode safe rather " +
			`than a migration (pi=${JSON.stringify(piDefault)} claude=${JSON.stringify(claudeDefaultCommand)} ` +
			`claude-statusline=${JSON.stringify(claudeStatusDefaultCommand)} mcp-exit=${claudeDefault.status} ` +
			`statusline-exit=${claudeStatusDefault.status} mcp-stderr=${JSON.stringify((claudeDefault.stderr || "").trim().slice(-200))})`,
		piDefault === "entwurf-bridge" &&
			claudeDefault.status === 0 &&
			claudeStatusDefault.status === 0 &&
			claudeDefaultCommand !== null &&
			!claudeDefaultCommand.includes("herdr-plugin") &&
			claudeStatusDefaultCommand !== null &&
			!claudeStatusDefaultCommand.includes("herdr-plugin"),
	);
}

// ── 4. the pi inverse refuses drift instead of deleting an override ────────────
{
	const env = world("drift");
	const settings = path.join(env.HOME as string, "settings.json");
	const state = path.join(env.HOME as string, "state.json");
	fs.writeFileSync(settings, "{}\n");
	const root = runtimeRootOf(env);
	py(env, "register-pi-provider.py", [
		"install",
		settings,
		REPO,
		"--scope",
		"user",
		"--state",
		state,
		"--plugin-runtime",
		root,
	]);
	const doc = readJson(settings) as { entwurfProvider: { mcpServers: Record<string, { command: string }> } };
	doc.entwurfProvider.mcpServers["entwurf-bridge"].command = "/somebody/elses/bridge";
	fs.writeFileSync(settings, JSON.stringify(doc));
	const before = fs.readFileSync(settings, "utf8");
	const refused = py(env, "register-pi-provider.py", [
		"remove",
		settings,
		REPO,
		"--scope",
		"user",
		"--state",
		state,
		"--preflight",
	]);
	ok(
		"[QK:HAC-INVERSE-REFUSES-DRIFT] the user-scope inverse is admitted by the ownership RECORD, so without a drift " +
			"check it would delete whatever now sits at our key — the state names the exact command we wrote, and a " +
			"present-but-different value is somebody's override, refused by name with the settings and the ownership " +
			`state both left intact (exit=${refused.status} bytes-unchanged=${before === fs.readFileSync(settings, "utf8")} state-kept=${fs.existsSync(state)})`,
		refused.status === 6 &&
			before === fs.readFileSync(settings, "utf8") &&
			fs.existsSync(state) &&
			(refused.stderr || "").includes("drifted since install"),
	);
}

// ── 5. the ledger is certified, and never names anything outside P ─────────────
{
	const env = world("ledger");
	const layout = resolveActivationLayout(env);
	writeLedger(layout, ledgerFor(env, ["pi"]));
	const good = readCertifiedLedger(layout) as Ledger;
	const write = (body: unknown): string | null => {
		fs.writeFileSync(layout.ledgerPath, `${JSON.stringify(body)}\n`);
		return refusal(() => readCertifiedLedger(layout));
	};
	const cells: Record<string, string | null> = {
		"json-null": write(null),
		array: write([good]),
		"missing-key": write({ schemaVersion: 1 }),
		"outside-p": write({ ...good, activatedBackends: ["pi", "opencode"] }),
		"component-outside-p": write({ ...good, components: [{ backend: "opencode", state: "active" }] }),
		"relative-root": write({ ...good, piAgentDir: { path: "relative/dir", source: "default" } }),
		"root-source-missing": write({ ...good, piAgentDir: { path: good.piAgentDir.path } }),
	};
	ok(
		"[QK:HAC-LEDGER-CERTIFIED] the ledger is read through one certifying reader — exact key set, a resolved " +
			"absolute path AND its source for each harness root, and a backend set that can only ever be a subset of " +
			"`{pi, claude-code}` — because this record is the authority a teardown aims with, and an entry naming " +
			`OpenCode would be a teardown pointed at a harness this lane promised to never write (${Object.entries(cells)
				.map(([k, v]) => `${k}=${v}`)
				.join(" ")})`,
		good.activatedBackends.join(",") === "pi" &&
			JSON.stringify(LEDGER_KEYS) === JSON.stringify(Object.keys(good as object)) &&
			cells["json-null"] === "activation-ledger-uncertified" &&
			cells.array === "activation-ledger-uncertified" &&
			cells["missing-key"] === "activation-ledger-uncertified" &&
			cells["outside-p"] === "activation-ledger-backend-outside-p" &&
			cells["component-outside-p"] === "activation-ledger-backend-outside-p" &&
			cells["relative-root"] === "activation-ledger-uncertified" &&
			cells["root-source-missing"] === "activation-ledger-uncertified",
	);
}

// ── 6. the ledger is a state machine, and it has to agree with itself ──────────
{
	const env = world("state-machine");
	const layout = resolveActivationLayout(env);
	writeLedger(layout, ledgerWith(env, "deactivating", { pi: "active", "claude-code": "removed" }));
	const mid = readCertifiedLedger(layout) as Ledger;
	const write = (body: unknown): string | null => {
		fs.writeFileSync(layout.ledgerPath, `${JSON.stringify(body)}\n`);
		return refusal(() => readCertifiedLedger(layout));
	};
	const cells: Record<string, string | null> = {
		"bad-phase": write({ ...mid, phase: "halfway" }),
		"bad-state": write({ ...mid, activatedBackends: ["pi"], components: [{ backend: "pi", state: "sort-of" }] }),
		"phase-contradiction": write({
			...mid,
			phase: "active",
			activatedBackends: ["pi"],
			components: [{ backend: "pi", state: "removed" }],
		}),
		duplicate: write({
			...mid,
			activatedBackends: ["pi"],
			components: [
				{ backend: "pi", state: "active" },
				{ backend: "pi", state: "active" },
			],
		}),
		"missing-component": write({ ...mid, components: [{ backend: "pi", state: "active" }] }),
		"extra-component": write({ ...mid, activatedBackends: ["pi"] }),
		"non-canonical": write({ ...mid, activatedBackends: ["claude-code", "pi"] }),
	};
	ok(
		"[QK:HAC-LEDGER-STATE-MACHINE] phase and component state are a closed machine that must agree with itself — " +
			"duplicate, missing or extra components, a non-canonical backend order, and a phase that contradicts its own " +
			"rows are each refused by name. Without progress IN the ledger, a teardown whose first inverse succeeded and " +
			"whose second failed would retry the first against ownership state its own earlier run deleted, and refuse " +
			`forever; with it, the retry knows what is left (${Object.entries(cells)
				.map(([k, v]) => `${k}=${v}`)
				.join(" ")} phases=${JSON.stringify(LEDGER_PHASES)} states=${JSON.stringify(COMPONENT_STATES)})`,
		mid.phase === "deactivating" &&
			cells["bad-phase"] === "activation-ledger-uncertified" &&
			cells["bad-state"] === "activation-ledger-uncertified" &&
			cells["phase-contradiction"] === "activation-ledger-phase-contradiction" &&
			cells.duplicate === "activation-ledger-uncertified" &&
			cells["missing-component"] === "activation-ledger-uncertified" &&
			cells["extra-component"] === "activation-ledger-uncertified" &&
			cells["non-canonical"] === "activation-ledger-uncertified",
	);
}

// ── 7. activation is add-only; a shrinking H never removes ─────────────────────
{
	const env = world("add-only");
	const layout = resolveActivationLayout(env);
	writeLedger(layout, ledgerFor(env, ["pi"]));
	const ledger = readCertifiedLedger(layout);
	const grow = planActivation({ ledger, requested: ["pi", "claude-code"] });
	const shrink = planActivation({ ledger: readCertifiedLedger(layout), requested: [] });
	const outside = refusal(() => planActivation({ ledger, requested: ["pi", "opencode"] }));
	ok(
		"[QK:HAC-ADD-ONLY] a reinstall reconciles what is already activated and ADDS what is newly in `H ∩ P`, and a " +
			"backend that has vanished from the request is RETAINED, never removed — Herdr's reinstall is the refresh " +
			"trigger, so an operator who uninstalls a Herdr integration for unrelated reasons must not silently lose " +
			`the Entwurf wiring they still use; only the explicit verb removes (grow=${JSON.stringify(grow)} shrink.retained=${JSON.stringify(shrink.retained)} outside=${outside})`,
		grow.reconcile.join(",") === "pi" &&
			grow.add.join(",") === "claude-code" &&
			grow.resulting.join(",") === "pi,claude-code" &&
			shrink.retained.join(",") === "pi" &&
			shrink.resulting.join(",") === "pi" &&
			outside === "activation-backend-outside-p" &&
			ACTIVATABLE_BACKENDS.join(",") === "pi,claude-code",
	);
}

// ── 8. a ledger describing different roots refuses before the first byte ───────
{
	const env = world("roots");
	const layout = resolveActivationLayout(env);
	writeLedger(layout, ledgerFor(env, ["pi"]));
	const ledger = readCertifiedLedger(layout);
	const moved = { ...env, PI_CODING_AGENT_DIR: path.join(env.HOME as string, "somewhere-else") };
	const drifted = refusal(() => certifyRootsAgainstLedger(ledger, resolveComponentRoots(moved), runtimeRootOf(env)));
	const same = refusal(() => certifyRootsAgainstLedger(ledger, resolveComponentRoots(env), runtimeRootOf(env)));
	ok(
		"[QK:HAC-ROOTS-CERTIFIED] an activation recorded under one set of resolved harness roots refuses to be acted on " +
			"under another — `PI_CODING_AGENT_DIR` and `CLAUDE_CONFIG_DIR` each decide WHERE a component's bytes live, " +
			"so the same override has to hold for the status read, the install and the removal; undoing an activation " +
			`against a root it never described is how an inverse edits a config that was never ours (drifted=${drifted} same=${same})`,
		drifted === "activation-roots-drifted" && same === null,
	);
}

// ── 9. teardown order: components, runtime, then the ledger LAST ───────────────
{
	const env = world("order");
	const layout = resolveActivationLayout(env);
	writeLedger(layout, ledgerFor(env, ["pi", "claude-code"]));
	const steps = planDeactivation(readCertifiedLedger(layout));
	const absent = refusal(() => planDeactivation(null));
	ok(
		"[QK:HAC-TEARDOWN-ORDER] the teardown runs component inverses first, then the runtime, and retires the ledger " +
			"LAST — both harnesses' wiring NAMES the runtime, so removing it first leaves configs pointing at nothing, " +
			"and the ledger is the retry authority, so a teardown that deletes its own record of what remains is one " +
			`nobody can resume (steps=${JSON.stringify(steps)} no-ledger=${absent})`,
		JSON.stringify(steps) === JSON.stringify(["claude-code", "pi", "runtime", "ledger"]) &&
			absent === "activation-ledger-absent",
	);
}

// ── 10. the same XDG/HOME resolution everywhere, including with XDG unset ──────
{
	const home = reclaimOnExit(fs.mkdtempSync(path.join(os.tmpdir(), "entwurf-hac-homeonly-")));
	const bare: NodeJS.ProcessEnv = { PATH: process.env.PATH, HOME: home, TERM: "dumb" };
	const dataRoot = resolveEntwurfDataRoot(bare);
	const states = piStatePaths(bare);
	const piExpected = path.join(home, ".local", "share", "entwurf");
	// The python writers derive the SAME stable root from the SAME environment.
	const pyRoot = spawnSync(
		"python3",
		[
			"-c",
			"import sys; sys.path.insert(0, 'scripts'); from importlib import import_module; m = import_module('register-pi-provider'.replace('-', '_')) if False else None",
		],
		{ encoding: "utf8", env: bare },
	);
	ok(
		"[QK:HAC-XDG-RESOLUTION-SHARED] every root comes from one resolution — `XDG_DATA_HOME`, else " +
			"`$HOME/.local/share` — so a host with XDG unset is the same host to the teardown as it is to the writers. " +
			'The first cut built its Pi state paths from `env.XDG_DATA_HOME || ""`, which on such a host pointed at ' +
			"`/entwurf/...`: a preflight that looked at a file nobody writes and passed for the wrong reason " +
			`(dataRoot=${dataRoot === piExpected} packageState=${path.relative(home, states.packageState)} py=${pyRoot.status === 0})`,
		dataRoot === piExpected &&
			states.packageState === path.join(piExpected, "pi-package", "install-state.json") &&
			states.providerState === path.join(piExpected, "pi-provider", "install-state.json"),
	);
}

// ── 11. the Claude state owner certifies the plan it will actually execute ─────
{
	const env = world("claude-plan");
	const claudeDir = env.CLAUDE_CONFIG_DIR as string;
	const asm = path.join(env.XDG_DATA_HOME as string, "entwurf", "meta-bridge", ".assembled");
	fs.mkdirSync(asm, { recursive: true });
	fs.writeFileSync(path.join(claudeDir, "settings.json"), '{"theme":"dark","permissions":{"allow":["Bash(ls)"]}}\n');
	const before = py(env, "meta-bridge-state.py", ["preflight-install", "--repo", REPO, "--asm", asm]);
	const prepared = py(env, "meta-bridge-state.py", ["prepare", "--repo", REPO, "--asm", asm]);
	const after = py(env, "meta-bridge-state.py", ["preflight-uninstall", "--repo", REPO]);

	// every kind the restorer knows, refused by name when malformed
	const statePath = path.join(claudeDir, "entwurf.install-state.json");
	const state = JSON.parse(fs.readFileSync(statePath, "utf8")) as {
		files: { settings: { keys: Record<string, { kind: string }> } };
	};
	const kinds = [...new Set(Object.values(state.files.settings.keys).map((k) => k.kind))].sort();
	const breakEntry = (mutate: (k: Record<string, unknown>) => void): string => {
		const doc = JSON.parse(fs.readFileSync(statePath, "utf8")) as {
			files: { settings: { keys: Record<string, Record<string, unknown>> } };
		};
		mutate(doc.files.settings.keys["permissions.allow"]);
		fs.writeFileSync(statePath, JSON.stringify(doc));
		const r = py(env, "meta-bridge-state.py", ["preflight-uninstall", "--repo", REPO]);
		fs.writeFileSync(statePath, JSON.stringify(state));
		return `${r.status}`;
	};
	const droppedAdded = breakEntry((k) => {
		k.added = "not-a-list";
	});
	const droppedExisted = breakEntry((k) => {
		delete k.originalExisted;
	});

	ok(
		"[QK:HAC-CLAUDE-PLAN-CERTIFIED] the forward preflight runs the REAL snapshot plan on copies and the inverse " +
			"preflight certifies every recorded entry through the SAME function the restorer uses — the first cut " +
			"re-implemented the check and knew only one of the three entry shapes, demanding `original` while " +
			"`snapshot_array_items` writes `{originalExisted, added}`, so EVERY real Claude activation failed its own " +
			`preflight and the aggregate could never claim preflight-all (install=${before.status} prepare=${prepared.status} uninstall=${after.status} kinds=${JSON.stringify(kinds)} malformed=${droppedAdded}/${droppedExisted})`,
		before.status === 0 &&
			prepared.status === 0 &&
			after.status === 0 &&
			kinds.includes("array-items") &&
			kinds.includes("map-entry") &&
			kinds.includes("scalar") &&
			droppedAdded === "1" &&
			droppedExisted === "1" &&
			(after.stdout || "").includes("restore entries applicable"),
	);
}

// ── 12. the two-stage activation a reinstall actually performs ─────────────────
{
	const env = world("two-stage");
	const claudeBin = fakeClaude(env);
	const runEnv = {
		...env,
		PATH: `${claudeBin}${path.delimiter}${env.PATH}`,
		FAKE_CLAUDE_LOG: path.join(env.HOME as string, "claude.log"),
	};
	const active = seedRuntime(env);
	const layout = resolveActivationLayout(env);
	const agentSettings = path.join(env.PI_CODING_AGENT_DIR as string, "settings.json");
	fs.writeFileSync(agentSettings, '{"theme":"dark"}\n');
	// OpenCode is the negative control: present on the host, never named, never touched.
	const opencode = path.join(env.HOME as string, ".config", "opencode");
	fs.mkdirSync(opencode, { recursive: true });
	fs.writeFileSync(path.join(opencode, "plugins.json"), '{"sentinel":true}\n');
	const opencodeBefore = fs.readFileSync(path.join(opencode, "plugins.json"), "utf8");

	// stage 1 — H ∩ P = {pi}
	const first = spawnSync("node", [ACTIVATE, "pi"], { encoding: "utf8", env: runEnv });
	const piAfterFirst = fs.readFileSync(agentSettings, "utf8");
	// What the ownership record ESTABLISHES, not what it observed on the way. `installedAt` moves by
	// design; `ownership`/`preimage` describe what THAT run found (absent the first time, our own
	// value the second) and are audit fields about the run, not the installed state. The load-bearing
	// claim is that a reconcile leaves the same managed file, key, command and owner behind — a byte
	// oracle here would fail a correct reconcile and prove nothing extra.
	const ownershipEstablished = (): string => {
		const doc = JSON.parse(fs.readFileSync(piStatePaths(env).providerState, "utf8")) as Record<string, unknown>;
		return JSON.stringify({
			managedSettingsPath: doc.managedSettingsPath,
			scope: doc.scope,
			key: doc.key,
			command: doc.command,
			installerRoot: doc.installerRoot,
		});
	};
	const stateAfterFirst = ownershipEstablished();
	const ledger1 = readCertifiedLedger(layout) as Ledger;
	const claudeSettingsAfterFirst = fs.existsSync(path.join(env.CLAUDE_CONFIG_DIR as string, "settings.json"));

	// stage 2 — the operator added Claude Code (and OpenCode, which is not ours to see)
	const second = spawnSync("node", [ACTIVATE, "pi", "claude-code"], { encoding: "utf8", env: runEnv });
	const ledger2 = readCertifiedLedger(layout) as Ledger;
	const claudeSettings = JSON.parse(
		fs.readFileSync(path.join(env.CLAUDE_CONFIG_DIR as string, "settings.json"), "utf8"),
	) as { statusLine?: { command?: string } };
	// `$HOME/.claude.json`, not `$CLAUDE_CONFIG_DIR/.claude.json`: the state owner derives the root
	// config from HOME (`claude_root_config_path`, meta-bridge-state.py:144-147) while the settings
	// half follows the override. Asserting the path the writer actually uses is the point — an
	// assertion aimed at the other one would pass only by accident of where the vendor CLI writes.
	const claudeRoot = JSON.parse(fs.readFileSync(path.join(env.HOME as string, ".claude.json"), "utf8")) as {
		mcpServers?: Record<string, { command?: string }>;
	};
	const mcpAdds = fs
		.readFileSync(path.join(env.HOME as string, "claude.log"), "utf8")
		.split("\n")
		.filter((l) => l.startsWith("mcp add"));

	ok(
		"[QK:HAC-TWO-STAGE-ADD-ONLY] the reinstall a real operator performs, end to end: `{pi}` first, then " +
			"`{pi, claude-code}` after they installed Claude Code — Pi's bytes and ownership state come out IDENTICAL " +
			"the second time (reconciled, not rewritten), Claude is wired exactly once at the absolute command under the " +
			"stable runtime, and OpenCode — present on the host the whole time — is never named, never planned and never " +
			`touched (first=${first.status} second=${second.status} pi-identical=${piAfterFirst === fs.readFileSync(agentSettings, "utf8")} ledger=${JSON.stringify(ledger1.activatedBackends)}->${JSON.stringify(ledger2.activatedBackends)} mcp-adds=${mcpAdds.length})`,
		first.status === 0 &&
			second.status === 0 &&
			ledger1.activatedBackends.join(",") === "pi" &&
			ledger1.phase === "active" &&
			!claudeSettingsAfterFirst &&
			ledger2.activatedBackends.join(",") === "pi,claude-code" &&
			ledger2.phase === "active" &&
			ledger2.components.every((c) => c.state === "active") &&
			piAfterFirst === fs.readFileSync(agentSettings, "utf8") &&
			stateAfterFirst === ownershipEstablished() &&
			claudeRoot.mcpServers?.["entwurf-bridge"]?.command ===
				path.join(active, "node_modules", ".bin", "entwurf-bridge") &&
			claudeSettings.statusLine?.command === path.join(active, "node_modules", ".bin", "entwurf-statusline") &&
			mcpAdds.length === 1 &&
			fs.readFileSync(path.join(opencode, "plugins.json"), "utf8") === opencodeBefore,
	);
}

// ── 13. a refused preflight changes nothing at all ─────────────────────────────
{
	const env = world("preflight");
	const layout = resolveActivationLayout(env);
	const agentSettings = path.join(env.PI_CODING_AGENT_DIR as string, "settings.json");
	fs.writeFileSync(agentSettings, '{"theme":"dark"}\n');
	sh(env, ["install-user-scope", "--plugin-runtime", runtimeRootOf(env)]);
	writeLedger(layout, ledgerFor(env, ["pi", "claude-code"]));
	// claude-code is in the ledger but was never installed, so its preflight must refuse.
	const settingsBefore = fs.readFileSync(agentSettings, "utf8");
	const stateBefore = fs
		.readdirSync(path.join(env.XDG_DATA_HOME as string, "entwurf"))
		.sort()
		.join(",");
	const run = spawnSync("node", [DEACTIVATE], { encoding: "utf8", env });
	ok(
		"[QK:HAC-PREFLIGHT-ALL-OR-NOTHING] one refused preflight aborts the whole teardown with every byte untouched — " +
			"a multi-component inverse that starts mutating on a promise it never checked is exactly how a Claude " +
			"failure strands a half-removed Pi, and the ledger survives because it is the only record of what is still " +
			`installed (exit=${run.status} refusal=${(run.stderr || "").trim().split("\\n").pop()} settings-unchanged=${settingsBefore === fs.readFileSync(agentSettings, "utf8")})`,
		run.status !== 0 &&
			(run.stderr || "").includes("deactivate-preflight-refused") &&
			settingsBefore === fs.readFileSync(agentSettings, "utf8") &&
			stateBefore ===
				fs
					.readdirSync(path.join(env.XDG_DATA_HOME as string, "entwurf"))
					.sort()
					.join(",") &&
			fs.existsSync(layout.ledgerPath),
	);
}

// ── 14. the entry runs even when a package manager hands it over through a symlink ─
{
	const env = world("entry-guard");
	const link = path.join(env.HOME as string, "linked-package");
	fs.symlinkSync(REPO, link);
	const direct = spawnSync("node", [DEACTIVATE], { encoding: "utf8", env });
	const linked = spawnSync("node", [path.join(link, "scripts", "herdr-plugin-deactivate.mjs")], {
		encoding: "utf8",
		env,
	});
	ok(
		"[QK:HAC-ENTRY-GUARD-REALPATH] the main-module guard compares REALPATHS, so the verb still runs when a package " +
			"manager hands the file over through a symlink — pnpm links `node_modules/@junghanacs/entwurf` into its " +
			"content-addressed store, and an unresolved comparison makes the guard silently false: the process prints " +
			`nothing, exits 0, and every caller reads a teardown that never happened (direct=${direct.status}/${JSON.stringify(direct.stdout.trim().slice(0, 40))} linked=${linked.status}/${JSON.stringify(linked.stdout.trim().slice(0, 40))})`,
		direct.status === 0 &&
			linked.status === 0 &&
			direct.stdout.includes("no certified activation ledger") &&
			linked.stdout.includes("no certified activation ledger"),
	);
}

// ── 15. a partial teardown is resumable, and a retry finishes it ───────────────
{
	const env = world("retry");
	const claudeBin = fakeClaude(env);
	const runEnv = {
		...env,
		PATH: `${claudeBin}${path.delimiter}${env.PATH}`,
		FAKE_CLAUDE_LOG: path.join(env.HOME as string, "claude.log"),
	};
	seedRuntime(env);
	const layout = resolveActivationLayout(env);
	const agentSettings = path.join(env.PI_CODING_AGENT_DIR as string, "settings.json");
	fs.writeFileSync(agentSettings, '{"theme":"dark"}\n');
	spawnSync("node", [ACTIVATE, "pi", "claude-code"], { encoding: "utf8", env: runEnv });

	// The shape the first cut could not survive: Claude's inverse already ran and recorded itself,
	// Pi's has not. A retry must NOT re-run Claude — its state file is gone, so its preflight would
	// refuse forever — and must pick up at Pi.
	spawnSync("bash", [path.join(REPO, "run.sh"), "uninstall-meta-bridge"], { encoding: "utf8", env: runEnv });
	writeLedger(layout, ledgerWith(env, "deactivating", { pi: "active", "claude-code": "removed" }));
	const resumed = spawnSync("node", [DEACTIVATE], { encoding: "utf8", env: runEnv });
	const afterResume = JSON.parse(fs.readFileSync(agentSettings, "utf8")) as Record<string, unknown>;

	// And the other torn shape: the runtime is already gone but the ledger survived the crash.
	const env2 = world("retry-ledger");
	const layout2 = resolveActivationLayout(env2);
	fs.mkdirSync(path.join(env2.XDG_DATA_HOME as string, "entwurf", "herdr-plugin"), { recursive: true });
	writeLedger(layout2, ledgerWith(env2, "deactivating", { pi: "removed", "claude-code": "removed" }));
	const finished = spawnSync("node", [DEACTIVATE], { encoding: "utf8", env: env2 });

	ok(
		"[QK:HAC-RETRY-RESUMES] a teardown that stopped halfway is resumable: the retry SKIPS every component the " +
			"ledger already records as removed and continues at the next one, and a crash that left only the ledger " +
			"behind is finished by re-running the verb. Re-running a completed inverse is not idempotent here — its " +
			"ownership state is gone, so its preflight refuses forever, which is how the first cut turned one partial " +
			`failure into a host nobody could ever finish cleaning (resume=${resumed.status} after=${JSON.stringify(afterResume)} finish=${finished.status} ledger-gone=${!fs.existsSync(layout2.ledgerPath)})`,
		resumed.status === 0 &&
			JSON.stringify(afterResume) === JSON.stringify({ theme: "dark", packages: [] }) &&
			!fs.existsSync(layout.ledgerPath) &&
			finished.status === 0 &&
			!fs.existsSync(layout2.ledgerPath),
	);
}

// ── 16. a pi-only activation is fully undone, and the roots it named survive ───
{
	const env = world("roundtrip");
	const layout = resolveActivationLayout(env);
	const runtimeLayout = path.join(env.XDG_DATA_HOME as string, "entwurf", "herdr-plugin", "runtime");
	const agentSettings = path.join(env.PI_CODING_AGENT_DIR as string, "settings.json");
	const originalText = '{"packages":["/some/other/pkg"],"theme":"dark"}\n';
	fs.writeFileSync(agentSettings, originalText);
	const original = JSON.parse(originalText) as Record<string, unknown>;

	sh(env, ["install-user-scope", "--plugin-runtime", runtimeRootOf(env)]);
	// A certified runtime journal, so the runtime step has something of ours to retire.
	fs.mkdirSync(runtimeRootOf(env), { recursive: true });
	fs.mkdirSync(path.join(env.XDG_DATA_HOME as string, "entwurf", "herdr-plugin"), { recursive: true });
	fs.writeFileSync(
		path.join(env.XDG_DATA_HOME as string, "entwurf", "herdr-plugin", "journal.json"),
		`${JSON.stringify({
			schemaVersion: 2,
			phase: "runtime-ready",
			runtimeRoot: runtimeRootOf(env),
			artifactIdentity: IDENTITY_A,
			previousRuntime: null,
		})}\n`,
	);
	writeLedger(layout, ledgerFor(env, ["pi"]));

	const run = spawnSync("node", [DEACTIVATE], { encoding: "utf8", env });
	const after = readJson(agentSettings) as Record<string, unknown>;
	// FILES, not directories: an emptied `pi-package/` is a reclaimed install-state, and asserting on
	// the directory name would call a clean inverse dirty.
	const leftoverState: string[] = [];
	const entwurfData = path.join(env.XDG_DATA_HOME as string, "entwurf");
	const walkState = (dir: string): void => {
		if (!fs.existsSync(dir)) return;
		for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
			const abs = path.join(dir, e.name);
			if (e.isDirectory()) walkState(abs);
			else leftoverState.push(path.relative(entwurfData, abs));
		}
	};
	walkState(entwurfData);
	ok(
		"[QK:HAC-DEACTIVATE-ROUNDTRIP] an explicit teardown returns the pi settings to their ORIGINAL meaning — " +
			"unrelated keys intact, our entry gone, zero install-state — and then retires the runtime and the ledger. " +
			"The oracle is JSON equality, not bytes: the settings writer preserves semantics but may reindent, so a " +
			"byte oracle would fail a correct roundtrip and prove nothing extra. This is the whole promise the plugin " +
			`makes to a host it no longer wants to be on (exit=${run.status} after=${JSON.stringify(after)} leftover-state=${JSON.stringify(leftoverState)} runtime-gone=${!fs.existsSync(runtimeLayout)} ledger-gone=${!fs.existsSync(layout.ledgerPath)})`,
		run.status === 0 &&
			JSON.stringify(after) === JSON.stringify({ packages: original.packages, theme: original.theme }) &&
			leftoverState.length === 0 &&
			!fs.existsSync(runtimeLayout) &&
			!fs.existsSync(layout.ledgerPath),
	);
}

// ── 17. nothing is imported after the runtime is deleted ───────────────────────
{
	const sources = [DEACTIVATE, ACTIVATION, path.join(REPO, "scripts", "herdr-runtime.mjs")];
	// Comments are stripped first: these files DOCUMENT the hazard, and a scan that cannot tell a
	// warning about `import()` from a call to it would be satisfied by deleting the explanation.
	const strip = (body: string): string => body.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
	const dynamic = sources
		.map((f) => [path.basename(f), strip(fs.readFileSync(f, "utf8"))] as const)
		.filter(([, body]) => /\bimport\s*\(/.test(body) || /\brequire\s*\(/.test(body))
		.map(([name]) => name);
	const head = fs.readFileSync(DEACTIVATE, "utf8");
	const importsAreTopLevel = head.split("\n").filter((l) => l.startsWith("import ")).length > 0;
	ok(
		"[QK:HAC-NO-DEFERRED-IMPORT] the teardown path loads no module lazily — measured on Linux, a process survives " +
			"deleting the runtime it is executing from and keeps using what it already loaded, but an `import()` after " +
			"that fails with ERR_MODULE_NOT_FOUND, which would strand a host with its runtime gone, its ledger " +
			`unretired, and nothing left to run the rest (dynamic-import-files=${JSON.stringify(dynamic)} top-level=${importsAreTopLevel})`,
		dynamic.length === 0 && importsAreTopLevel,
	);
}

// ── 18. a verb never acts across the other verb's phase ────────────────────────
{
	const env = world("phases");
	const layout = resolveActivationLayout(env);
	const claudeBin = fakeClaude(env);
	const runEnv = {
		...env,
		PATH: `${claudeBin}${path.delimiter}${env.PATH}`,
		FAKE_CLAUDE_LOG: path.join(env.HOME as string, "claude.log"),
	};
	seedRuntime(env);
	fs.writeFileSync(path.join(env.PI_CODING_AGENT_DIR as string, "settings.json"), '{"theme":"dark"}\n');

	// forward over a teardown-in-progress: refused, and not one byte written.
	writeLedger(layout, ledgerWith(env, "deactivating", { pi: "active" }));
	const midTeardown = fs.readFileSync(layout.ledgerPath, "utf8");
	const piBefore = fs.readFileSync(path.join(env.PI_CODING_AGENT_DIR as string, "settings.json"), "utf8");
	const overTeardown = spawnSync("node", [ACTIVATE, "pi"], { encoding: "utf8", env: runEnv });

	// inverse over an activation-in-progress: refused, told to repair the activation first.
	writeLedger(layout, ledgerWith(env, "activating", { pi: "active", "claude-code": "pending" }));
	const overActivating = spawnSync("node", [DEACTIVATE], { encoding: "utf8", env: runEnv });

	// forward retry of the SAME set over `activating`: allowed, that is what the phase is for.
	const sameTarget = refusal(() => certifyPhaseForForward(readCertifiedLedger(layout), ["pi", "claude-code"]));
	// forward that ABANDONS a pending backend: refused, it would strand half-wired work.
	const changedTarget = refusal(() => certifyPhaseForForward(readCertifiedLedger(layout), ["pi"]));

	ok(
		"[QK:HAC-PHASE-TRANSITIONS] neither verb acts across the other's phase — a forward run over a `deactivating` " +
			"ledger would re-wire what a teardown is midway through removing AND overwrite its record of where it " +
			"stopped, and a teardown over an `activating` ledger would SKIP every still-`pending` component (they are " +
			"not `active`, so the plan has no step for them) and then delete the runtime their half-written wiring " +
			`names. A retry of the same set is welcome; a request that abandons a pending backend is not ` +
			`(over-teardown=${overTeardown.status}/${(overTeardown.stderr || "").includes("activation-phase-refused")} ledger-untouched=${midTeardown === fs.readFileSync(layout.ledgerPath, "utf8") ? "n/a" : "changed"} over-activating=${overActivating.status}/${(overActivating.stderr || "").includes("activation-phase-refused")} same-target=${sameTarget} changed-target=${changedTarget})`,
		overTeardown.status !== 0 &&
			(overTeardown.stderr || "").includes("activation-phase-refused") &&
			piBefore === fs.readFileSync(path.join(env.PI_CODING_AGENT_DIR as string, "settings.json"), "utf8") &&
			overActivating.status !== 0 &&
			(overActivating.stderr || "").includes("activation-phase-refused") &&
			sameTarget === null &&
			changedTarget === "activation-phase-refused",
	);
}

// ── 19. every Claude root the install actually uses, including the HOME one ────
{
	const env = world("claude-roots");
	const roots = resolveComponentRoots(env);
	const layout = resolveActivationLayout(env);
	writeLedger(layout, ledgerFor(env, ["claude-code"]));
	const ledger = readCertifiedLedger(layout) as Ledger;
	// Same XDG, same CLAUDE_CONFIG_DIR, HOME moved: the settings half still resolves under the
	// override, but `$HOME/.claude.json` — where the user-scope MCP entry lives — has moved with it.
	const movedHome = { ...env, HOME: path.join(env.HOME as string, "elsewhere") };
	const drifted = refusal(() =>
		certifyRootsAgainstLedger(ledger, resolveComponentRoots(movedHome), runtimeRootOf(env)),
	);
	const same = refusal(() => certifyRootsAgainstLedger(ledger, resolveComponentRoots(env), runtimeRootOf(env)));
	ok(
		"[QK:HAC-CLAUDE-ROOTS-COMPLETE] the ledger records EVERY root the install writes to — including " +
			"`$HOME/.claude.json`, which the state owner derives from HOME and NOT from `CLAUDE_CONFIG_DIR`. Measured: " +
			"with the same XDG and the same override but a moved HOME, a ledger that knew only the two obvious roots " +
			"went green and left the MCP entry behind in the old home. A record that claims to know where an install " +
			`went has to know all of it (userConfig=${path.basename(roots.claudeUserConfig.path)}/${roots.claudeUserConfig.source} home-drift=${drifted} same=${same})`,
		roots.claudeUserConfig.path === path.join(env.HOME as string, ".claude.json") &&
			roots.claudeUserConfig.source === "HOME" &&
			ledger.claudeUserConfig.path === roots.claudeUserConfig.path &&
			drifted === "activation-roots-drifted" &&
			same === null,
	);
}

// ── 20. the forward preflight covers both Pi halves and the real Claude mode ───
{
	const env = world("aggregate-preflight");
	const claudeBin = fakeClaude(env);
	const runEnv = {
		...env,
		PATH: `${claudeBin}${path.delimiter}${env.PATH}`,
		FAKE_CLAUDE_LOG: path.join(env.HOME as string, "claude.log"),
	};
	const active = seedRuntime(env);
	const layout = resolveActivationLayout(env);
	fs.writeFileSync(path.join(env.PI_CODING_AGENT_DIR as string, "settings.json"), '{"theme":"dark"}\n');
	// A FOREIGN owner on the pi PACKAGE half only. The provider half would pass; the package half is
	// the one that refuses, and the ledger must not exist afterwards.
	const pkgState = piStatePaths(env).packageState;
	fs.mkdirSync(path.dirname(pkgState), { recursive: true });
	fs.writeFileSync(
		pkgState,
		`${JSON.stringify({
			schemaVersion: 1,
			managedSettingsPath: path.join(env.PI_CODING_AGENT_DIR as string, "settings.json"),
			scope: "user",
			packageRoot: "/somebody/elses/entwurf",
			installedAt: "2026-01-01T00:00:00.000Z",
		})}\n`,
	);
	const piBefore = fs.readFileSync(path.join(env.PI_CODING_AGENT_DIR as string, "settings.json"), "utf8");
	const refusedRun = spawnSync("node", [ACTIVATE, "pi"], { encoding: "utf8", env: runEnv });

	// And the Claude half: the preflight must be told the mode on the ARGV the state owner reads.
	const claudePreflight = py(env, "meta-bridge-state.py", [
		"preflight-install",
		"--repo",
		REPO,
		"--plugin-runtime",
		active,
	]);
	ok(
		"[QK:HAC-AGGREGATE-PREFLIGHT-COMPLETE] the forward preflight asks EVERY authority the run will need — both pi " +
			"ownership records, not just the provider — and asks the Claude owner in the mode it will actually install: " +
			"the env var is the installer script's channel, while the state owner reads `--plugin-runtime` from argv, so " +
			"passing only the env preflights the DEFAULT mode and then installs the plugin one, which is a green check " +
			`of work nobody is going to do (pi-refused=${refusedRun.status} ledger-absent=${!fs.existsSync(layout.ledgerPath)} claude-mode=${(claudePreflight.stdout || "").includes("mode=plugin-runtime")})`,
		refusedRun.status !== 0 &&
			!fs.existsSync(layout.ledgerPath) &&
			piBefore === fs.readFileSync(path.join(env.PI_CODING_AGENT_DIR as string, "settings.json"), "utf8") &&
			claudePreflight.status === 0 &&
			(claudePreflight.stdout || "").includes("mode=plugin-runtime") &&
			(claudePreflight.stdout || "").includes(path.join(active, "node_modules", ".bin", "entwurf-bridge")) &&
			(claudePreflight.stdout || "").includes(path.join(active, "node_modules", ".bin", "entwurf-statusline")),
	);
}

// ── 21. the runtime on disk must BE the one the journal certifies ──────────────
{
	const env = world("exact-runtime");
	const claudeBin = fakeClaude(env);
	const runEnv = {
		...env,
		PATH: `${claudeBin}${path.delimiter}${env.PATH}`,
		FAKE_CLAUDE_LOG: path.join(env.HOME as string, "claude.log"),
	};
	const active = seedRuntime(env);
	const layout = resolveActivationLayout(env);
	// A tree that is usable and has the right NAME, but not the version the journal certifies.
	const pkgJson = path.join(active, "node_modules", "@junghanacs", "entwurf", "package.json");
	fs.writeFileSync(pkgJson, `${JSON.stringify({ name: "@junghanacs/entwurf", version: "0.99.0" })}\n`);
	const drifted = spawnSync("node", [ACTIVATE, "pi"], { encoding: "utf8", env: runEnv });
	ok(
		"[QK:HAC-RUNTIME-EXACT-VERSION] the disk check is bound to the journal's exact name AND version — a tree that " +
			"is merely 'a usable runtime of that name' is not the runtime this activation was certified against, and " +
			"wiring two harnesses at an address whose contents disagree with the record is a host where the provenance " +
			`line is a statement about something else (exit=${drifted.status} refusal=${(drifted.stderr || "").trim().split("\n").pop()} ledger-absent=${!fs.existsSync(layout.ledgerPath)})`,
		drifted.status !== 0 &&
			(drifted.stderr || "").includes("activation-runtime-not-ready") &&
			(drifted.stderr || "").includes("runtime-package-spec-mismatch") &&
			!fs.existsSync(layout.ledgerPath),
	);
}

// ── 22. the ledger carries the SAME identity union, through the same certifier ──
{
	const env = world("ledger-identity");
	const layout = resolveActivationLayout(env);
	writeLedger(layout, ledgerFor(env, ["pi"]));
	const good = readCertifiedLedger(layout) as Ledger;
	const write = (body: unknown): string | null => {
		fs.writeFileSync(layout.ledgerPath, `${JSON.stringify(body)}\n`);
		return refusal(() => readCertifiedLedger(layout));
	};
	const cells: Record<string, string | null> = {
		"no-identity": write({ ...good, artifactIdentity: undefined }),
		"requested-shape": write({
			...good,
			artifactIdentity: { kind: "herdr-checkout", repository: IDENTITY_A.repository, commit: IDENTITY_A.commit },
		}),
		"foreign-repo": write({ ...good, artifactIdentity: { ...IDENTITY_A, repository: "someone/else" } }),
		"second-source-field": write({ ...good, source: "npm" }),
		"scalar-identity": write({ ...good, artifactIdentity: "herdr-checkout" }),
	};
	const verdicts = Object.entries(cells).map(([k, v]) => `${k}=${v}`);
	ok(
		"[QK:HAC-LEDGER-IDENTITY-CERTIFIED] the ledger records WHICH artifact it activated in the same union the runtime " +
			"journal uses, certified by the same imported certifier and in the READY shape only — a missing identity, a " +
			"requested shape (nothing observed it), a foreign repository, a scalar, and a SECOND source-ish field beside " +
			"it are each refused. A ledger that described the artifact in its own words could disagree with the journal " +
			"about which runtime the wiring below it names, and nothing on the host would be able to say which of the two " +
			`was right (${verdicts.join(" ")} keys=${JSON.stringify(LEDGER_KEYS)} good=${good.artifactIdentity.commit?.slice(0, 8)})`,
		Object.values(cells).every((v) => v === "activation-ledger-uncertified") &&
			LEDGER_KEYS.includes("artifactIdentity") &&
			good.artifactIdentity.commit === IDENTITY_A.commit,
	);
}

// ── 23. a SOURCE change is refused; a new commit on the same source may rebind ──
{
	const env = world("rebind-legality");
	const layout = resolveActivationLayout(env);
	const ledgerA = () => {
		writeLedger(layout, ledgerFor(env, ["pi", "claude-code"]));
		return readCertifiedLedger(layout) as Ledger;
	};
	const sourceDrift = refusal(() => certifyArtifactForForward(ledgerA(), IDENTITY_NPM, ["pi", "claude-code"]));
	const matched = certifyArtifactForForward(ledgerA(), IDENTITY_A, ["pi"]);
	const legal = certifyArtifactForForward(ledgerA(), IDENTITY_B, ["pi", "claude-code", "pi"]);
	const fresh = certifyArtifactForForward(null, IDENTITY_B, ["pi"]);
	const dropped = refusal(() => certifyArtifactForForward(ledgerA(), IDENTITY_B, ["pi"]));
	writeLedger(layout, ledgerWith(env, "activating", { pi: "pending" }));
	const midActivation = refusal(() =>
		certifyArtifactForForward(readCertifiedLedger(layout) as Ledger, IDENTITY_B, ["pi"]),
	);
	writeLedger(layout, ledgerWith(env, "deactivating", { pi: "removed" }));
	const midTeardown = refusal(() =>
		certifyArtifactForForward(readCertifiedLedger(layout) as Ledger, IDENTITY_B, ["pi"]),
	);
	ok(
		"[QK:HAC-REBIND-LEGALITY] the runtime address is stable while the artifact under it is not, so a reinstall may " +
			"REBIND the ledger's claim — but only from a settled `active` ledger, with every component `active`, and only " +
			"when the request still covers every activated backend. A SOURCE change is not a reinstall at all: it is a " +
			"different acquisition authority inheriting an existing activation, and it needs the operator's explicit " +
			"teardown. Dropping a backend would leave its wiring pointing at a root no record names, and rebinding over " +
			"an unfinished transaction would discard the only account of how far that run got " +
			`(drift=${sourceDrift} match=${matched} legal=${legal} fresh=${fresh} dropped=${dropped} mid-activation=${midActivation} mid-teardown=${midTeardown})`,
		sourceDrift === "activation-artifact-source-drifted" &&
			matched === "match" &&
			legal === "rebind" &&
			fresh === "fresh" &&
			dropped === "activation-rebind-refused" &&
			midActivation === "activation-rebind-refused" &&
			midTeardown === "activation-rebind-refused",
	);
}

// ── 24. the rebind is ONE checkpoint, and what it leaves is resumable ─────────
{
	const env = world("rebind-atomic");
	const layout = resolveActivationLayout(env);
	const log = path.join(env.HOME as string, "claude.log");
	const workingClaude = fakeClaude(env);
	const runEnv = { ...env, PATH: `${workingClaude}${path.delimiter}${env.PATH}`, FAKE_CLAUDE_LOG: log };
	fs.writeFileSync(path.join(env.PI_CODING_AGENT_DIR as string, "settings.json"), '{"theme":"dark"}\n');
	seedRuntime(env, IDENTITY_A);
	const firstRun = spawnSync("node", [ACTIVATE, "pi", "claude-code"], { encoding: "utf8", env: runEnv });
	const settled = readCertifiedLedger(layout) as Ledger;

	// The artifact under the same stable root is replaced: new commit, SAME package version.
	seedRuntime(env, IDENTITY_B);

	// (a) a refusal BEFORE the checkpoint leaves the old ledger byte-identical. The request drops a
	// backend the ledger holds, which is exactly the illegal rebind above.
	const ledgerTextBefore = fs.readFileSync(layout.ledgerPath, "utf8");
	const refusedRun = spawnSync("node", [ACTIVATE, "pi"], { encoding: "utf8", env: runEnv });
	const ledgerTextAfterRefusal = fs.readFileSync(layout.ledgerPath, "utf8");

	// (b) a component that fails AFTER the checkpoint: the claude writer dies on its own CLI, so the
	// ledger must already name the NEW artifact and record exactly how far the run got.
	const brokenDir = path.join(env.HOME as string, "broken-claude-bin");
	fs.mkdirSync(brokenDir, { recursive: true });
	fs.writeFileSync(
		path.join(brokenDir, "claude"),
		[
			"#!/usr/bin/env bash",
			'case "$1 $2" in',
			'  "--version "*|"--version") echo "2.1.217 (Claude Code)" ;;',
			'  *) echo "broken fixture" >&2; exit 1 ;;',
			"esac",
		].join("\n"),
	);
	fs.chmodSync(path.join(brokenDir, "claude"), 0o755);
	const brokenRun = spawnSync("node", [ACTIVATE, "pi", "claude-code"], {
		encoding: "utf8",
		env: { ...env, PATH: `${brokenDir}${path.delimiter}${env.PATH}`, FAKE_CLAUDE_LOG: log },
	});
	const halfway = readCertifiedLedger(layout) as Ledger;

	// (c) the SAME verb finishes it.
	const resumed = spawnSync("node", [ACTIVATE, "pi", "claude-code"], { encoding: "utf8", env: runEnv });
	const finished = readCertifiedLedger(layout) as Ledger;
	ok(
		"[QK:HAC-REBIND-ATOMIC-CHECKPOINT] the rebind lands in ONE ledger write: the new artifact identity and the " +
			"`activating` phase together, with every selected component back to `pending` because they are being " +
			"re-pointed at different bytes. A refusal before it leaves the previous ledger byte-identical; a component " +
			"failure after it leaves a ledger that already names the new artifact and says how far the run got, which the " +
			"SAME verb resumes. Splitting identity and phase across two writes would open a window where the ledger " +
			"claims the new artifact while still reporting the old transaction as finished " +
			`(first=${firstRun.status}/${settled.artifactIdentity.commit?.slice(0, 8)} refused=${refusedRun.status}/unchanged=${ledgerTextBefore === ledgerTextAfterRefusal} broken=${brokenRun.status}/${halfway.phase}/${halfway.artifactIdentity.commit?.slice(0, 8)}/${JSON.stringify(halfway.components)} resumed=${resumed.status}/${finished.phase}/${finished.artifactIdentity.commit?.slice(0, 8)})`,
		firstRun.status === 0 &&
			settled.phase === "active" &&
			settled.artifactIdentity.commit === IDENTITY_A.commit &&
			refusedRun.status !== 0 &&
			(refusedRun.stderr || "").includes("activation-rebind-refused") &&
			ledgerTextBefore === ledgerTextAfterRefusal &&
			brokenRun.status !== 0 &&
			halfway.phase === "activating" &&
			halfway.artifactIdentity.commit === IDENTITY_B.commit &&
			halfway.components.find((c) => c.backend === "pi")?.state === "active" &&
			halfway.components.find((c) => c.backend === "claude-code")?.state === "pending" &&
			resumed.status === 0 &&
			finished.phase === "active" &&
			finished.artifactIdentity.commit === IDENTITY_B.commit &&
			finished.components.every((c) => c.state === "active"),
	);
}

console.log(`\ncheck-herdr-activation: ${passed} assertions passed`);
