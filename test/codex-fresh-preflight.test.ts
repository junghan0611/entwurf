import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { type CodexPreflightDeps, codexFreshPreflight } from "../pi-extensions/lib/codex-fresh-preflight.ts";
import type { CodexProtocolOpener, CodexRpcProtocol } from "../pi-extensions/lib/native-push/codex-ws-client.ts";

let root = "";
let home = "";
let hooksFile = "";
let helperDir = "";
let configFile = "";
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

function installBirth(handler: Record<string, unknown> | null = null): void {
	const launcher = path.join(helperDir, "codex-birth-launch.sh");
	write(launcher, "#!/bin/sh\nexit 0\n", 0o555);
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
}

function installConfig(statusLine = false, envVars: readonly string[] = managedEnvVars): void {
	write(
		configFile,
		`[mcp_servers.entwurf-bridge]\ncommand = "entwurf-bridge"\nenv_vars = ${JSON.stringify(envVars)}\n\n[mcp_servers.entwurf-bridge.env]\nENTWURF_BRIDGE_NATIVE_HOST = "codex"\n${
			statusLine ? '\n[tui]\nstatus_line = ["model-with-reasoning", "thread-title"]\n' : ""
		}`,
		0o600,
	);
}

beforeEach(() => {
	root = fs.mkdtempSync(path.join(os.tmpdir(), "entwurf-codex-preflight-"));
	home = path.join(root, "home");
	hooksFile = path.join(root, "etc", "codex", "hooks.json");
	helperDir = path.join(root, "etc", "codex", "entwurf-birth");
	configFile = path.join(home, ".codex", "config.toml");
	closedProtocols = 0;
	deps = {
		systemPaths: { hooksFile, helperDir },
		systemUid: process.getuid?.() ?? 0,
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
		expect(await codexFreshPreflight({ HOME: home }, deps)).toBe("codex-mcp-hand-missing");
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

	it("[QK:FRESHCALL-CODEX-HOOKS-SAFE] refuses a mutable or symlinked system birth unit", async () => {
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

	it("refuses contrary MCP provenance and malformed status shape", async () => {
		installBirth();
		write(
			configFile,
			'[mcp_servers.entwurf-bridge]\ncommand="entwurf-bridge"\n[mcp_servers.entwurf-bridge.env]\nENTWURF_BRIDGE_NATIVE_HOST="other"\n[tui]\nstatus_line="thread-title"\n',
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
