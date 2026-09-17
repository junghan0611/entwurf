import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
	type CodexPreflightDeps,
	codexCallerFreshPreflight,
	codexFreshPreflight,
	codexLaunchCwdFreshPreflight,
} from "../pi-extensions/lib/codex-fresh-preflight.ts";
import type { CodexProtocolOpener, CodexRpcProtocol } from "../pi-extensions/lib/native-push/codex-ws-client.ts";

let root = "";
let home = "";
let hooksFile = "";
let helperDir = "";
let configFile = "";
let stateFile = "";
let deps: CodexPreflightDeps;
let closedProtocols = 0;
const managedEnvVars = [
	"CODEX_HOME",
	"ENTWURF_DIR",
	"PI_CODING_AGENT_DIR",
	"ENTWURF_META_SESSIONS_DIR",
	"ENTWURF_META_MAILBOX_DIR",
	"ENTWURF_META_SENDERS_DIR",
	"ENTWURF_META_RECEIVERS_DIR",
	"TMUX",
	"TMUX_PANE",
] as const;

function write(file: string, content: string, mode = 0o444): void {
	fs.mkdirSync(path.dirname(file), { recursive: true });
	// The published closure is read-only, so a second install in the same case has to
	// replace the file rather than reopen it for writing.
	fs.rmSync(file, { force: true });
	fs.writeFileSync(file, content, { mode });
}

/**
 * The three app-server shapes the inode check cannot tell apart. `live` answers
 * `initialize`; `dead` refuses the connection the way a stale socket file does; `stalled`
 * accepts the connection and then never answers — the exact case a lstat-only preflight
 * called ready. Every fixture counts `close()` so the bounded path is proven to hang up.
 */
function liveOpener(): CodexProtocolOpener {
	return {
		open: async () => protocolStub(async () => ({ ok: true })),
	};
}

function deadOpener(): CodexProtocolOpener {
	return {
		open: () => Promise.reject(new Error("connect ECONNREFUSED")),
	};
}

function stalledRequestOpener(): CodexProtocolOpener {
	return {
		open: async () => protocolStub(() => new Promise<unknown>(() => {})),
	};
}

function stalledOpenOpener(): CodexProtocolOpener {
	return {
		open: () => new Promise<CodexRpcProtocol>(() => {}),
	};
}

/** The open lands AFTER the bound expired — nobody is holding that handle any more. */
function lateOpenOpener(delayMs: number): CodexProtocolOpener {
	return {
		open: () =>
			new Promise<CodexRpcProtocol>((resolve) => setTimeout(() => resolve(protocolStub(async () => ({}))), delayMs)),
	};
}

function protocolStub(request: () => Promise<unknown>): CodexRpcProtocol {
	return {
		request,
		notify: () => {},
		close: () => {
			closedProtocols += 1;
		},
	};
}

const sha = (file: string): string => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");

/**
 * The installed unit, including the ownership state that licenses it. The state is not
 * decoration here: the preflight compares every recorded digest to the live bytes, so a
 * fixture that skipped it would be testing a unit no installer ever produced.
 */
function installBirth(handler: Record<string, unknown> | null = null): void {
	const launcher = path.join(helperDir, "codex-birth-launch.sh");
	write(launcher, "#!/bin/sh\nexit 0\n", 0o755);
	write(path.join(helperDir, "meta-bridge-hook-codex.ts"), "export {};\n");
	write(path.join(helperDir, "lib", "meta-session.ts"), "export {};\n");
	write(path.join(helperDir, "lib", "native-push", "codex-ws-client.ts"), "export {};\n");
	write(path.join(helperDir, "lib", "session-id.js"), "export {};\n");
	write(path.join(helperDir, "entwurf-capabilities.json"), "{}\n");
	write(
		hooksFile,
		JSON.stringify({
			hooks: {
				SessionStart: [{ hooks: [handler ?? { type: "command", command: `'${launcher}'`, timeout: 30 }] }],
			},
		}),
	);
	writeState();
}

function writeState(): void {
	write(
		stateFile,
		JSON.stringify({
			schema: "codex-birth-install-state/v1",
			status: "installed",
			hooksFile,
			hooksSha256: sha(hooksFile),
			helperDir,
			helperFiles: [
				{ path: "codex-birth-launch.sh", sha256: sha(path.join(helperDir, "codex-birth-launch.sh")), mode: "0755" },
				{
					path: "meta-bridge-hook-codex.ts",
					sha256: sha(path.join(helperDir, "meta-bridge-hook-codex.ts")),
					mode: "0644",
				},
				{ path: "lib/meta-session.ts", sha256: sha(path.join(helperDir, "lib", "meta-session.ts")), mode: "0644" },
				{
					path: "lib/native-push/codex-ws-client.ts",
					sha256: sha(path.join(helperDir, "lib", "native-push", "codex-ws-client.ts")),
					mode: "0644",
				},
				{ path: "lib/session-id.js", sha256: sha(path.join(helperDir, "lib", "session-id.js")), mode: "0644" },
				{
					path: "entwurf-capabilities.json",
					sha256: sha(path.join(helperDir, "entwurf-capabilities.json")),
					mode: "0644",
				},
			],
		}),
		0o600,
	);
}

/** The vendor's receipt for OUR declaration — written by the vendor in production, forged
 * here so the reading is what is under test. */
function trustBlock(key = `${hooksFile}:session_start:0:0`): string {
	return `\n[hooks.state."${key}"]\ntrusted_hash = "sha256:${"4".repeat(64)}"\n`;
}

function installConfig(statusLine = false, envVars: readonly string[] = managedEnvVars, trust = trustBlock()): void {
	write(
		configFile,
		`[mcp_servers.entwurf-bridge]\ncommand = "entwurf-bridge"\nenv_vars = ${JSON.stringify(envVars)}\n\n[mcp_servers.entwurf-bridge.env]\nENTWURF_BRIDGE_NATIVE_HOST = "codex"\n${
			statusLine ? '\n[tui]\nstatus_line = ["model-with-reasoning", "thread-title"]\n' : ""
		}${trust}`,
		0o600,
	);
}

beforeEach(() => {
	root = fs.mkdtempSync(path.join(os.tmpdir(), "entwurf-codex-preflight-"));
	home = path.join(root, "home");
	hooksFile = path.join(home, ".codex", "hooks.json");
	helperDir = path.join(root, "xdg", "entwurf", "codex-birth", "helper");
	stateFile = path.join(root, "xdg", "entwurf", "codex-birth", "install-state.json");
	configFile = path.join(home, ".codex", "config.toml");
	closedProtocols = 0;
	deps = {
		unitPathsOverride: { hooksFile, helperDir, stateFile },
		operatorUid: process.getuid?.() ?? 0,
		checkSocket: () => ({ ok: true }),
		openProtocol: liveOpener(),
		appServerTimeoutMs: 50,
	};
});

afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

describe("Codex fresh preflight", () => {
	it("[QK:FRESHCALL-CODEX-PREFLIGHT] names each missing capability before placement", async () => {
		expect(await codexFreshPreflight({ HOME: home }, deps)).toBe("codex-birth-unit-missing");
		installBirth();
		// Our bytes are perfect and the vendor has still recorded nothing: a DIFFERENT repair,
		// and one only the operator can perform, so it gets its own reject rather than being
		// folded into the installer's.
		expect(await codexFreshPreflight({ HOME: home }, deps)).toBe("codex-birth-trust-missing");
		installConfig();
		expect(await codexFreshPreflight({ HOME: home }, deps)).toBe("codex-visible-identity-missing");
		installConfig(true);
		expect(
			await codexFreshPreflight(
				{ HOME: home },
				{ ...deps, checkSocket: () => ({ ok: false, status: "dead", reason: "absent" }) },
			),
		).toBe("codex-app-server-unavailable");
		expect(await codexFreshPreflight({ HOME: home }, deps)).toBeNull();
	});

	it("[QK:FRESHCALL-CODEX-APP-SERVER-LIVE] refuses a socket file whose app-server does not answer", async () => {
		installBirth();
		installConfig(true);
		// The inode axis says ok on all four of these; only the bounded exchange separates them.
		expect(await codexFreshPreflight({ HOME: home }, { ...deps, openProtocol: deadOpener() })).toBe(
			"codex-app-server-unavailable",
		);
		expect(await codexFreshPreflight({ HOME: home }, { ...deps, openProtocol: stalledOpenOpener() })).toBe(
			"codex-app-server-unavailable",
		);
		expect(closedProtocols).toBe(0);
		expect(await codexFreshPreflight({ HOME: home }, { ...deps, openProtocol: stalledRequestOpener() })).toBe(
			"codex-app-server-unavailable",
		);
		// A connection that was opened is hung up on the refusal path too, not leaked.
		expect(closedProtocols).toBe(1);
		expect(await codexFreshPreflight({ HOME: home }, deps)).toBeNull();
		expect(closedProtocols).toBe(2);
	});

	it("[QK:FRESHCALL-CODEX-APP-SERVER-NO-LEAK] closes an app-server connection that lands after the bound expired", async () => {
		installBirth();
		installConfig(true);
		expect(
			await codexFreshPreflight({ HOME: home }, { ...deps, openProtocol: lateOpenOpener(120), appServerTimeoutMs: 20 }),
		).toBe("codex-app-server-unavailable");
		// The refusal already returned; the handle arrives afterwards and must be hung up
		// exactly once rather than left open against the operator's app-server.
		expect(closedProtocols).toBe(0);
		for (let waited = 0; closedProtocols === 0 && waited < 2000; waited += 25) {
			await new Promise<void>((resolve) => setTimeout(resolve, 25));
		}
		expect(closedProtocols).toBe(1);
		await new Promise<void>((resolve) => setTimeout(resolve, 50));
		expect(closedProtocols).toBe(1);
	});

	it("[QK:FRESHCALL-CODEX-HOOKS-SAFE] refuses a mutable or symlinked birth unit", async () => {
		installBirth();
		installConfig(true);
		const helper = path.join(helperDir, "meta-bridge-hook-codex.ts");
		fs.chmodSync(helper, 0o666);
		expect(await codexFreshPreflight({ HOME: home }, deps)).toBe("codex-birth-unit-missing");
		fs.chmodSync(helper, 0o444);
		fs.chmodSync(helperDir, 0o777);
		expect(await codexFreshPreflight({ HOME: home }, deps)).toBe("codex-birth-unit-missing");
		fs.chmodSync(helperDir, 0o755);
		fs.chmodSync(hooksFile, 0o666);
		expect(await codexFreshPreflight({ HOME: home }, deps)).toBe("codex-birth-unit-missing");
		fs.chmodSync(hooksFile, 0o444);
		const hooksTarget = path.join(path.dirname(hooksFile), "hooks-target.json");
		fs.renameSync(hooksFile, hooksTarget);
		fs.symlinkSync(hooksTarget, hooksFile);
		expect(await codexFreshPreflight({ HOME: home }, deps)).toBe("codex-birth-unit-missing");
	});

	it("[QK:FRESHCALL-CODEX-HOOK-KEYS] refuses a birth handler carrying async or any key the installer never writes", async () => {
		const launcher = path.join(helperDir, "codex-birth-launch.sh");
		installConfig(true);
		// `async: true` would run birth beside the turn instead of before it, so the MCP child
		// of that same turn could resolve its identity against a record that does not exist yet.
		installBirth({ type: "command", command: `'${launcher}'`, timeout: 30, async: true });
		expect(await codexFreshPreflight({ HOME: home }, deps)).toBe("codex-birth-unit-missing");
		installBirth({ type: "command", command: `'${launcher}'`, timeout: 30, statusMessage: "minting" });
		expect(await codexFreshPreflight({ HOME: home }, deps)).toBe("codex-birth-unit-missing");
		installBirth({ type: "command", command: `'${launcher}'` });
		expect(await codexFreshPreflight({ HOME: home }, deps)).toBe("codex-birth-unit-missing");
		installBirth();
		expect(await codexFreshPreflight({ HOME: home }, deps)).toBeNull();
	});

	it("[QK:FRESHCALL-CODEX-TRUST-RECEIPT] refuses a birth the vendor never agreed to run", async () => {
		installBirth();
		// No receipt at all.
		installConfig(true, managedEnvVars, "");
		expect(await codexFreshPreflight({ HOME: home }, deps)).toBe("codex-birth-trust-missing");
		// A receipt for SOMEBODY ELSE's declaration is not ours, however valid it is for them.
		installConfig(true, managedEnvVars, trustBlock("/some/other/hooks.json:session_start:0:0"));
		expect(await codexFreshPreflight({ HOME: home }, deps)).toBe("codex-birth-trust-missing");
		// Present but not the vendor's shape: entwurf reads the receipt, it does not interpret
		// a hash of its own making.
		installConfig(
			true,
			managedEnvVars,
			`\n[hooks.state."${hooksFile}:session_start:0:0"]\ntrusted_hash = "sha256:not-hex"\n`,
		);
		expect(await codexFreshPreflight({ HOME: home }, deps)).toBe("codex-birth-trust-missing");
		installConfig(true);
		expect(await codexFreshPreflight({ HOME: home }, deps)).toBeNull();
	});

	it("[QK:FRESHCALL-CODEX-STATE-DIGEST] refuses a closure whose bytes drifted from the recorded digests", async () => {
		installBirth();
		installConfig(true);
		expect(await codexFreshPreflight({ HOME: home }, deps)).toBeNull();
		// The launcher codex is about to exec is not the one this unit published. Existing is
		// not enough — the state is a digest inventory, and a sibling opened over drifted bytes
		// would run somebody else's script under our name.
		write(path.join(helperDir, "codex-birth-launch.sh"), "#!/bin/sh\necho edited\n", 0o755);
		expect(await codexFreshPreflight({ HOME: home }, deps)).toBe("codex-birth-unit-missing");
		writeState();
		expect(await codexFreshPreflight({ HOME: home }, deps)).toBeNull();
		// ...and with no state at all there is nothing to compare against, which is the same
		// refusal rather than a pass by absence.
		fs.rmSync(stateFile);
		expect(await codexFreshPreflight({ HOME: home }, deps)).toBe("codex-birth-unit-missing");
	});

	it("[QK:FRESHCALL-CODEX-EXACT-INVENTORY] refuses a state whose closure inventory is not the exact six members", async () => {
		installBirth();
		installConfig(true);
		expect(await codexFreshPreflight({ HOME: home }, deps)).toBeNull();
		const short = JSON.parse(fs.readFileSync(stateFile, "utf8"));
		short.helperFiles = short.helperFiles.filter((f: { path: string }) => f.path === "codex-birth-launch.sh");
		write(stateFile, JSON.stringify(short), 0o600);
		// Every named member still matches its digest — the hole is the member nobody named.
		expect(await codexFreshPreflight({ HOME: home }, deps)).toBe("codex-birth-unit-missing");
		writeState();
		const extra = JSON.parse(fs.readFileSync(stateFile, "utf8"));
		extra.helperFiles.push({ path: "lib/session-id.js", sha256: "0".repeat(64), mode: "0644" });
		write(stateFile, JSON.stringify(extra), 0o600);
		expect(await codexFreshPreflight({ HOME: home }, deps)).toBe("codex-birth-unit-missing");
	});

	it("[QK:FRESHCALL-CODEX-STATE-PARENT-AUTHORITY] refuses a state whose own directory anyone can rewrite", async () => {
		installBirth();
		installConfig(true);
		expect(await codexFreshPreflight({ HOME: home }, deps)).toBeNull();
		// Every recorded digest still matches. What changed is who may replace the inventory
		// those digests live in — which is the same as nobody having vouched for them.
		fs.chmodSync(path.dirname(stateFile), 0o777);
		expect(await codexFreshPreflight({ HOME: home }, deps)).toBe("codex-birth-unit-missing");
		fs.chmodSync(path.dirname(stateFile), 0o755);
		expect(await codexFreshPreflight({ HOME: home }, deps)).toBeNull();
	});

	it("refuses a unit root that is not absolute", async () => {
		installBirth();
		installConfig(true);
		// The declaration records an absolute launcher path and the vendor keys its receipt to
		// it, so a cwd-dependent root is a different unit by definition.
		expect(
			await codexFreshPreflight(
				{ HOME: home },
				{ ...deps, unitPathsOverride: { hooksFile: "relative/hooks.json", helperDir, stateFile } },
			),
		).toBe("codex-birth-unit-missing");
	});

	it("refuses contrary MCP provenance and malformed status shape", async () => {
		installBirth();
		write(
			configFile,
			`[mcp_servers.entwurf-bridge]\ncommand="entwurf-bridge"\n[mcp_servers.entwurf-bridge.env]\nENTWURF_BRIDGE_NATIVE_HOST="other"\n[tui]\nstatus_line="thread-title"\n${trustBlock()}`,
			0o600,
		);
		expect(await codexFreshPreflight({ HOME: home }, deps)).toBe("codex-mcp-hand-missing");
	});

	it("[QK:FRESHCALL-CODEX-MCP-EXACT] [QK:FRESHCALL-CODEX-MCP-ENV-ORDER] refuses malformed MCP tables or literal environment redirects", async () => {
		installBirth();
		installConfig(true, managedEnvVars.slice(0, -1));
		expect(await codexFreshPreflight({ HOME: home }, deps)).toBe("codex-mcp-hand-missing");
		installConfig(true, [managedEnvVars[1], managedEnvVars[0], ...managedEnvVars.slice(2)]);
		expect(await codexFreshPreflight({ HOME: home }, deps)).toBe("codex-mcp-hand-missing");
		installConfig(true, [...managedEnvVars, "HOME"]);
		expect(await codexFreshPreflight({ HOME: home }, deps)).toBe("codex-mcp-hand-missing");
		installConfig(true);
		fs.writeFileSync(
			configFile,
			fs
				.readFileSync(configFile, "utf8")
				.replace(
					'ENTWURF_BRIDGE_NATIVE_HOST = "codex"',
					'ENTWURF_BRIDGE_NATIVE_HOST = "codex"\nENTWURF_META_SESSIONS_DIR = "/tmp/foreign-store"',
				),
		);
		expect(await codexFreshPreflight({ HOME: home }, deps)).toBe("codex-mcp-hand-missing");
		installConfig(true);
		fs.writeFileSync(
			configFile,
			fs
				.readFileSync(configFile, "utf8")
				.replace('command = "entwurf-bridge"', 'command = "entwurf-bridge"\nargs = []'),
		);
		expect(await codexFreshPreflight({ HOME: home }, deps)).toBe("codex-mcp-hand-missing");
	});
});

/**
 * The CALLER axis (#95 lane B C4) — a different question from everything above, asked of the
 * same file. "Can the Codex citizen DOING the opening be located in tmux" is about
 * `[tui].terminal_title`, and it is required no matter which backend that citizen opens; the
 * five checks above are about whether a Codex sibling can be opened here at all. Nothing in
 * this describe touches the app-server: whether the operator's app-server is up says nothing
 * about whether a pane can be found, and asking would fail a placement check for a delivery
 * reason.
 */
describe("Codex CALLER-side fresh preflight", () => {
	/** Write only what this axis reads. Deliberately not `installConfig`: proving the two axes
	 * are independent needs a config that satisfies neither by accident. */
	function writeTui(body: string): void {
		write(configFile, `model = "operator-model"\n\n[tui]\n${body}\n`, 0o600);
	}

	it("[QK:CODEX-CALLER-PREFLIGHT-TITLE] refuses until tui.terminal_title carries thread-id, and names the installer that repairs it", () => {
		// No config at all — the ordinary pre-install state, and not an error.
		expect(codexCallerFreshPreflight({ HOME: home })).toBe("codex-caller-title-missing");
		writeTui('theme = "zenburn"');
		expect(codexCallerFreshPreflight({ HOME: home })).toBe("codex-caller-title-missing");
		writeTui('terminal_title = ["activity", "project-name"]');
		expect(codexCallerFreshPreflight({ HOME: home })).toBe("codex-caller-title-missing");
		writeTui('terminal_title = ["activity", "project-name", "thread-id"]');
		expect(codexCallerFreshPreflight({ HOME: home })).toBeNull();
		// The operator's own order is not ours to require — only MEMBERSHIP is the axis, exactly
		// what `entwurf doctor-codex-terminal-title` judges.
		writeTui('terminal_title = ["thread-id"]');
		expect(codexCallerFreshPreflight({ HOME: home })).toBeNull();
	});

	it("[QK:CODEX-CALLER-PREFLIGHT-NOT-STATUS-LINE] neither the status line nor a neighbouring thread-title item satisfies the caller axis — only `terminal_title` reaches `#{pane_title}`, and only `thread-id` renders the id the anchor matches", () => {
		writeTui('status_line = ["thread-title"]');
		expect(codexCallerFreshPreflight({ HOME: home })).toBe("codex-caller-title-missing");
		// The near-miss that actually happens: `thread-title` IS a legal terminal_title item, and
		// it renders the thread NAME (the garden id, for an entwurf-named thread) rather than the
		// id the anchor is built from. Accepting it here would report a configured seat for a
		// host whose panes never carry a matchable token.
		writeTui('terminal_title = ["activity", "thread-title"]');
		expect(codexCallerFreshPreflight({ HOME: home })).toBe("codex-caller-title-missing");
		writeTui('terminal_title = ["activity", "thread-title", "thread-id"]');
		expect(codexCallerFreshPreflight({ HOME: home })).toBeNull();
		// ...and the reverse: a config that satisfies the CALLER axis does not satisfy the
		// target's visible-identity axis. Two keys, two repairs, neither standing in for the
		// other.
		installBirth();
		writeTui('terminal_title = ["thread-id"]');
		expect(codexCallerFreshPreflight({ HOME: home })).toBeNull();
	});

	it("[QK:CODEX-CALLER-PREFLIGHT-SHAPE] a terminal_title that is not an array of items is refused, never read as satisfied", () => {
		for (const body of ['terminal_title = "thread-id"', "terminal_title = 7", "terminal_title = []"]) {
			writeTui(body);
			expect(codexCallerFreshPreflight({ HOME: home }), body).toBe("codex-caller-title-missing");
		}
		// An unparseable config is the same answer — `readConfig` returns null rather than
		// guessing, and a caller whose config cannot be read has no provable seat axis.
		write(configFile, "garbage [[[\n", 0o600);
		expect(codexCallerFreshPreflight({ HOME: home })).toBe("codex-caller-title-missing");
	});
});

/**
 * THE LAUNCH-DIRECTORY AXIS. The two above ask about the HOST and the CALLER — facts that do not
 * change between two calls made a second apart. This one asks about ONE directory, so it is the
 * only codex axis whose answer can differ per call on an unchanged host, and the only one that
 * needed the cwd rules to have already run.
 */
describe("Codex launch-directory preflight", () => {
	function writeProjects(body: string): void {
		write(configFile, `model = "operator-model"\n\n${body}\n`, 0o600);
	}

	it("[QK:CODEX-LAUNCH-CWD-TRUST] refuses a launch directory the vendor has recorded no decision for, because an undecided folder opens a consent screen instead of a first turn", () => {
		const target = path.join(root, "scratch");
		// No config at all is NOT this axis's answer — absence proves nothing about the effective
		// config, and its own cell below owns that. The refusal starts where the evidence does: a
		// readable `projects` table that is silent about this exact directory.
		expect(codexLaunchCwdFreshPreflight({ HOME: home }, target)).toBeNull();
		writeProjects(`[projects."${path.join(root, "elsewhere")}"]\ntrust_level = "trusted"`);
		expect(codexLaunchCwdFreshPreflight({ HOME: home }, target)).toBe("codex-launch-cwd-undecided");
		writeProjects(`[projects."${target}"]\ntrust_level = "trusted"`);
		expect(codexLaunchCwdFreshPreflight({ HOME: home }, target)).toBeNull();
	});

	it("[QK:CODEX-LAUNCH-CWD-EXACT-KEY] neither a TRUSTED parent nor a child entry answers for the directory being launched — this rail's vendor lookup is the exact cwd string and nothing else", () => {
		const target = path.join(root, "parent", "scratch");
		// `[source rust-v0.153.4]` project-root markers and the git root are consulted only for
		// ProjectTrustHost::Local; a `--remote` startup looks up `vec![cwd_key]`. A parent that
		// answered here would let the preflight pass a launch the vendor still stops — measured
		// on 2026-09-16 with a trusted `/tmp` and an undecided `/tmp/entwurf-codex-fresh-live-*`.
		// An UNTRUSTED ancestor is the one prefix that does travel, and it travels to a DIFFERENT
		// reason rather than to consent — its own cell below.
		writeProjects(`[projects."${path.join(root, "parent")}"]\ntrust_level = "trusted"`);
		expect(codexLaunchCwdFreshPreflight({ HOME: home }, target)).toBe("codex-launch-cwd-undecided");
		writeProjects(`[projects."${path.join(target, "deeper")}"]\ntrust_level = "trusted"`);
		expect(codexLaunchCwdFreshPreflight({ HOME: home }, target)).toBe("codex-launch-cwd-undecided");
		writeProjects(`[projects."${target}"]\ntrust_level = "trusted"`);
		expect(codexLaunchCwdFreshPreflight({ HOME: home }, target)).toBeNull();
	});

	it("[QK:CODEX-LAUNCH-CWD-DECIDED-NOT-TRUSTED] a deliberate `untrusted` still passes — the axis asks whether a turn STARTS, and on this rail the vendor skips the consent screen for a saved untrusted folder; refusing it would invent a policy the vendor does not have", () => {
		const target = path.join(root, "scratch");
		// `[source rust-v0.153.4]` `if target.uses_remote_workspace() && trust_level == Some(Untrusted)
		// { continue; }` (onboarding/directory_trust.rs:94-96), and every fresh call IS a remote
		// target because its argv always passes `--remote` (tui/src/lib.rs:307-309).
		writeProjects(`[projects."${target}"]\ntrust_level = "untrusted"`);
		expect(codexLaunchCwdFreshPreflight({ HOME: home }, target)).toBeNull();
		writeProjects(`[projects."${target}"]\ntrust_level = "trusted"`);
		expect(codexLaunchCwdFreshPreflight({ HOME: home }, target)).toBeNull();
		// UNDECIDED is the one that blocks, and the reason is named for it rather than for trust.
		writeProjects(`[projects."${path.join(root, "elsewhere")}"]\ntrust_level = "trusted"`);
		expect(codexLaunchCwdFreshPreflight({ HOME: home }, target)).toBe("codex-launch-cwd-undecided");
	});

	it("[QK:CODEX-LAUNCH-CWD-SHAPE] only a level the vendor itself recognises counts as decided, and a relative or unreadable input is refused rather than repaired into a different directory", () => {
		const target = path.join(root, "scratch");
		// An unrecognised string leaves `trust_level` as `None` on the vendor side too, and `None`
		// with no project layer is precisely the case that renders the screen.
		for (const level of ['trust_level = "Trusted"', 'trust_level = "yes"', "trust_level = true", ""]) {
			writeProjects(`[projects."${target}"]\n${level}`);
			expect(codexLaunchCwdFreshPreflight({ HOME: home }, target), level).toBe("codex-launch-cwd-undecided");
		}
		writeProjects(`[projects."${target}"]\ntrust_level = "trusted"`);
	});

	it("[QK:CODEX-LAUNCH-CWD-NO-EVIDENCE-PROCEEDS] absence is never a refusal — a relative path, an unreadable user config and a missing `projects` table all PROCEED, because none of them is evidence about what the vendor will do", () => {
		const target = path.join(root, "scratch");
		writeProjects(`[projects."${path.join(root, "elsewhere")}"]\ntrust_level = "trusted"`);
		// A relative cwd: the vendor does not give up on one, it asks its app-server for a cwd and
		// joins (`config_update.rs:203-224`). Production never reaches this anyway — the shared cwd
		// leaf refuses a non-absolute request as `cwd-not-absolute`, a better reason than this axis
		// could give.
		expect(codexLaunchCwdFreshPreflight({ HOME: home }, "scratch")).toBeNull();
		expect(codexLaunchCwdFreshPreflight({ HOME: home }, "")).toBeNull();
		// No readable user config is NOT "no decisions": the vendor loads an empty user table and
		// merges system, managed and cloud layers around it (`config/src/loader/mod.rs:258-290`,
		// `:430-460`, `:520-610`), any of which can carry the decision that starts the turn.
		write(configFile, "garbage [[[\n", 0o600);
		expect(codexLaunchCwdFreshPreflight({ HOME: home }, target)).toBeNull();
		fs.rmSync(configFile, { force: true });
		expect(codexLaunchCwdFreshPreflight({ HOME: home }, target)).toBeNull();
		// A readable config with no `projects` table says the USER layer records nothing, not that
		// the effective config does.
		write(configFile, 'model = "operator-model"\n', 0o600);
		expect(codexLaunchCwdFreshPreflight({ HOME: home }, target)).toBeNull();
		// ...and with a table present but silent about this directory, the evidence is positive
		// again and the refusal returns.
		writeProjects(`[projects."${path.join(root, "elsewhere")}"]\ntrust_level = "trusted"`);
		expect(codexLaunchCwdFreshPreflight({ HOME: home }, target)).toBe("codex-launch-cwd-undecided");
	});
	it("[QK:CODEX-LAUNCH-CWD-UNTRUSTED-ANCESTOR] a cwd inside an explicitly untrusted project is its OWN failure, because the vendor answers it with an error rather than a consent screen and the repair is a different directory", () => {
		// `[source rust-v0.153.4]` with no direct decision and no project layers, the remote branch
		// returns `Err("remote project directory is inside an explicitly untrusted project; pass the
		// repository root explicitly with --cd")` (`config_update.rs:357-371`). Reporting that as
		// `undecided` would send the operator to answer a prompt at the child, which only
		// reproduces the same vendor error.
		const forbidden = path.join(root, "forbidden");
		const target = path.join(forbidden, "inner", "scratch");
		writeProjects(`[projects."${forbidden}"]\ntrust_level = "untrusted"`);
		expect(codexLaunchCwdFreshPreflight({ HOME: home }, target)).toBe("codex-launch-cwd-untrusted-ancestor");
		// A DIRECT decision on the launch directory still wins: the vendor never reaches the
		// ancestor branch when the exact cwd is answered.
		writeProjects(
			`[projects."${forbidden}"]\ntrust_level = "untrusted"\n\n[projects."${target}"]\ntrust_level = "trusted"`,
		);
		expect(codexLaunchCwdFreshPreflight({ HOME: home }, target)).toBeNull();
		// A sibling path that merely SHARES A PREFIX is not inside it — the boundary is a path
		// separator, not a string prefix.
		writeProjects(`[projects."${forbidden}"]\ntrust_level = "untrusted"`);
		expect(codexLaunchCwdFreshPreflight({ HOME: home }, `${forbidden}-elsewhere/x`)).toBe("codex-launch-cwd-undecided");
	});

	it("[QK:CODEX-LAUNCH-CWD-LAYER-NOT-REFUSED] a directory that could carry a project layer is NOT refused — the vendor consents through layers this leaf cannot enumerate, so the unseeable case proceeds instead of blocking a launch that would have run", () => {
		// `[source rust-v0.153.4]` `trust_level.is_none() && disabled_project.is_none() &&
		// project_layers.any(no disabledReason)` returns `Ok(None)` — no screen, turn starts
		// (`config_update.rs:346-354`). Those layers come from the server's `ConfigRead
		// { include_layers: true }`, which this leaf does not ask. The asymmetry is deliberate and
		// one-directional: miss a hang, never refuse a working launch.
		const target = path.join(root, "layered");
		fs.mkdirSync(path.join(target, ".codex"), { recursive: true, mode: 0o700 });
		// EXISTENCE is the predicate, not safe ownership: a world-writable `.codex` is still a
		// place the vendor can admit a layer from, and narrowing here would synthesise a refusal
		// for a launch the vendor runs.
		fs.chmodSync(path.join(target, ".codex"), 0o777);
		writeProjects(`[projects."${path.join(root, "elsewhere")}"]\ntrust_level = "trusted"`);
		expect(codexLaunchCwdFreshPreflight({ HOME: home }, target)).toBeNull();
		// An ANCESTOR's `.codex` counts the same way, and it outranks the untrusted-ancestor
		// reason for the vendor's own reason: that error branch requires `project_layers.is_empty()`.
		const child = path.join(target, "inner");
		fs.mkdirSync(child, { recursive: true, mode: 0o700 });
		writeProjects(`[projects."${target}"]\ntrust_level = "untrusted"`);
		expect(codexLaunchCwdFreshPreflight({ HOME: home }, child)).toBeNull();
		// Without that `.codex` anywhere above it, the same shape is the ancestor refusal.
		fs.rmSync(path.join(target, ".codex"), { recursive: true, force: true });
		expect(codexLaunchCwdFreshPreflight({ HOME: home }, child)).toBe("codex-launch-cwd-untrusted-ancestor");
	});

	it("[QK:CODEX-LAUNCH-CWD-HOME-NOT-A-LAYER] the operator's own CODEX HOME never counts as a project layer — counting it would answer `null` for every path under $HOME and retire the whole axis in real use", () => {
		// `~/.codex` is an ancestor of nearly every directory a sibling is launched in, and it is
		// the USER config root rather than a project layer. This is the cell that keeps the check
		// from being silently dead on a real host.
		const underHome = path.join(home, "repos", "project");
		fs.mkdirSync(path.join(home, ".codex"), { recursive: true, mode: 0o700 });
		fs.mkdirSync(underHome, { recursive: true, mode: 0o700 });
		writeProjects(`[projects."${path.join(root, "elsewhere")}"]\ntrust_level = "trusted"`);
		expect(codexLaunchCwdFreshPreflight({ HOME: home }, underHome)).toBe("codex-launch-cwd-undecided");
		// The exclusion follows CODEX_HOME rather than a hardcoded `~/.codex`, and the default one
		// then stops being special: for a host whose codex home is elsewhere, a `.codex` at $HOME
		// IS a project layer. Its config moves with it, so the fixture writes both.
		const otherHome = path.join(root, "codex-home");
		write(
			path.join(otherHome, "config.toml"),
			`[projects."${path.join(root, "elsewhere")}"]\ntrust_level = "trusted"\n`,
			0o600,
		);
		expect(codexLaunchCwdFreshPreflight({ HOME: home, CODEX_HOME: otherHome }, underHome)).toBeNull();
	});
	it("[QK:CODEX-LAUNCH-CWD-ANCESTOR-PLAIN-PATHS-ONLY] a path this leaf cannot compare the way the vendor does degrades to the weaker reason instead of asserting the ancestor one — the disagreement lands on the permissive side", () => {
		// `[source rust-v0.153.4]` the vendor compares path URIs segment-wise and fails closed on
		// encoded separators (`utils/path-uri`); this compares strings on a separator boundary. An
		// encoded or dot-segmented key is exactly where those two could part, so the ancestor
		// reason — whose repair names a specific other directory — is not asserted there.
		const forbidden = path.join(root, "forb%idden");
		const target = path.join(forbidden, "inner");
		writeProjects(`[projects."${forbidden}"]\ntrust_level = "untrusted"`);
		expect(codexLaunchCwdFreshPreflight({ HOME: home }, target)).toBe("codex-launch-cwd-undecided");
		// A plain key under a plain cwd still gets the precise reason.
		const plain = path.join(root, "forbidden");
		writeProjects(`[projects."${plain}"]\ntrust_level = "untrusted"`);
		expect(codexLaunchCwdFreshPreflight({ HOME: home }, path.join(plain, "inner"))).toBe(
			"codex-launch-cwd-untrusted-ancestor",
		);
	});
});
