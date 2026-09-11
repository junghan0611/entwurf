import * as fs from "node:fs";
import * as path from "node:path";
import { parse } from "smol-toml";

import {
	type CodexProtocolOpener,
	type CodexRpcProtocol,
	type CodexSocketFileCheck,
	checkCodexSocketFile,
	realCodexProtocolOpener,
	resolveCodexDefaultSocketPath,
} from "./native-push/codex-ws-client.ts";

export type CodexPreflightRejectReason =
	| "codex-birth-unit-missing"
	| "codex-mcp-hand-missing"
	| "codex-visible-identity-missing"
	| "codex-app-server-unavailable";

export const CODEX_PREFLIGHT_HINT: Record<CodexPreflightRejectReason, string> = {
	"codex-birth-unit-missing":
		"the root-managed Codex SessionStart birth unit is absent or unsafe; run `sudo entwurf install-codex-birth` deliberately, then `sudo entwurf doctor-codex-birth`",
	"codex-mcp-hand-missing":
		"the Codex user config does not expose the managed entwurf bridge; run `entwurf install-codex-mcp`, then `entwurf doctor-codex-mcp`",
	"codex-visible-identity-missing":
		"Codex tui.status_line does not include thread-title; run `entwurf install-codex-statusline`, then `entwurf doctor-codex-statusline`",
	"codex-app-server-unavailable":
		"the operator-owned Codex app-server default socket is absent or unsafe; start `codex app-server --listen unix://$CODEX_HOME/app-server-control/app-server-control.sock` and retry",
};

export interface CodexSystemPaths {
	hooksFile: string;
	helperDir: string;
}

export interface CodexPreflightDeps {
	systemPaths?: CodexSystemPaths;
	systemUid?: number;
	checkSocket?: (socketPath: string) => CodexSocketFileCheck;
	openProtocol?: CodexProtocolOpener;
	appServerTimeoutMs?: number;
}

const DEFAULT_SYSTEM_PATHS: CodexSystemPaths = {
	hooksFile: "/etc/codex/hooks.json",
	helperDir: "/etc/codex/entwurf-birth",
};

const CODEX_MCP_ENV_VARS = [
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

function isSafeSystemFile(file: string, expectedUid: number, executable = false): boolean {
	try {
		const stat = fs.lstatSync(file);
		return (
			stat.isFile() &&
			!stat.isSymbolicLink() &&
			stat.uid === expectedUid &&
			(stat.mode & 0o022) === 0 &&
			(!executable || (stat.mode & 0o111) !== 0)
		);
	} catch {
		return false;
	}
}

function isSafeSystemDir(dir: string, expectedUid: number): boolean {
	try {
		const stat = fs.lstatSync(dir);
		return stat.isDirectory() && !stat.isSymbolicLink() && stat.uid === expectedUid && (stat.mode & 0o022) === 0;
	} catch {
		return false;
	}
}

function birthMissing(paths: CodexSystemPaths, expectedUid: number): boolean {
	const launcher = path.join(paths.helperDir, "codex-birth-launch.sh");
	const directories = [
		path.dirname(paths.hooksFile),
		paths.helperDir,
		path.join(paths.helperDir, "lib"),
		path.join(paths.helperDir, "lib", "native-push"),
	];
	if (directories.some((dir) => !isSafeSystemDir(dir, expectedUid))) return true;
	if (!isSafeSystemFile(paths.hooksFile, expectedUid)) return true;
	const closure = [
		[launcher, true],
		[path.join(paths.helperDir, "meta-bridge-hook-codex.ts"), false],
		[path.join(paths.helperDir, "lib", "meta-session.ts"), false],
		[path.join(paths.helperDir, "lib", "native-push", "codex-ws-client.ts"), false],
		[path.join(paths.helperDir, "lib", "session-id.js"), false],
		[path.join(paths.helperDir, "entwurf-capabilities.json"), false],
	] as const;
	if (closure.some(([file, executable]) => !isSafeSystemFile(file, expectedUid, executable))) return true;
	try {
		const parsed = JSON.parse(fs.readFileSync(paths.hooksFile, "utf8")) as Record<string, unknown>;
		const events = (parsed.hooks as Record<string, unknown> | undefined)?.SessionStart;
		if (!Array.isArray(events) || events.length !== 1) return true;
		const group = events[0] as Record<string, unknown>;
		if ("matcher" in group || !Array.isArray(group.hooks) || group.hooks.length !== 1) return true;
		const hook = group.hooks[0] as Record<string, unknown>;
		if (Object.keys(hook).sort().join(",") !== "command,timeout,type") return true;
		return hook.type !== "command" || hook.command !== `'${launcher}'` || hook.timeout !== 30;
	} catch {
		return true;
	}
}

function readConfig(env: NodeJS.ProcessEnv): Record<string, unknown> | null {
	try {
		const text = fs.readFileSync(
			path.join(env.CODEX_HOME?.trim() || path.join(env.HOME ?? "", ".codex"), "config.toml"),
			"utf8",
		);
		const value = parse(text);
		return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
	} catch {
		return null;
	}
}

function mcpMissing(config: Record<string, unknown>): boolean {
	const servers = config.mcp_servers;
	if (servers == null || typeof servers !== "object" || Array.isArray(servers)) return true;
	const entry = (servers as Record<string, unknown>)["entwurf-bridge"];
	if (entry == null || typeof entry !== "object" || Array.isArray(entry)) return true;
	const server = entry as Record<string, unknown>;
	if (Object.keys(server).sort().join(",") !== "command,env,env_vars") return true;
	const envVars = server.env_vars;
	if (
		!Array.isArray(envVars) ||
		envVars.length !== CODEX_MCP_ENV_VARS.length ||
		envVars.some((name, index) => name !== CODEX_MCP_ENV_VARS[index])
	)
		return true;
	const env = server.env;
	if (env == null || typeof env !== "object" || Array.isArray(env)) return true;
	const serverEnv = env as Record<string, unknown>;
	return (
		server.command !== "entwurf-bridge" ||
		Object.keys(serverEnv).join(",") !== "ENTWURF_BRIDGE_NATIVE_HOST" ||
		serverEnv.ENTWURF_BRIDGE_NATIVE_HOST !== "codex"
	);
}

function visibleIdentityMissing(config: Record<string, unknown>): boolean {
	const tui = config.tui;
	if (tui == null || typeof tui !== "object" || Array.isArray(tui)) return true;
	const statusLine = (tui as Record<string, unknown>).status_line;
	return !Array.isArray(statusLine) || !statusLine.includes("thread-title");
}

const DEFAULT_APP_SERVER_TIMEOUT_MS = 5_000;

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
	return new Promise((resolve, reject) => {
		const timer = setTimeout(() => reject(new Error("codex app-server exchange timed out")), timeoutMs);
		promise.then(
			(value) => {
				clearTimeout(timer);
				resolve(value);
			},
			(error) => {
				clearTimeout(timer);
				reject(error);
			},
		);
	});
}

/**
 * A bounded real initialize/liveness exchange over the app-server's own JSON-RPC. The inode
 * check above only proves a socket FILE with the right owner and mode exists — a dead
 * app-server's stale socket a new process has not reclaimed yet passes that check identically
 * to a live one. Only a real connection plus a real `initialize` round trip distinguishes them.
 * Any failure — refused/hung connection, a response that never lands within the bound, or a
 * reply the transport itself rejects — answers identically: not live. This is deliberately not
 * `probeCodexThread`: preflight asks "is the app-server there to talk to", never "is a specific
 * thread loaded", so it carries no thread id and no retry/backoff policy.
 */
async function appServerIsLive(
	socketPath: string,
	openProtocol: CodexProtocolOpener,
	timeoutMs: number,
): Promise<boolean> {
	let protocol: CodexRpcProtocol;
	const opening = openProtocol.open(socketPath);
	try {
		protocol = await withTimeout(opening, timeoutMs);
	} catch {
		// The bound expired (or the connect failed), but a slow open can still LAND afterwards.
		// Nothing else holds that handle, so a late success would leave a live connection to the
		// operator's app-server open for the rest of this process. Close it when it arrives —
		// the answer stays "not live" either way; this only refuses to leak.
		void opening.then(
			(late) => {
				try {
					late.close();
				} catch {
					// best-effort: the socket may already be gone.
				}
			},
			() => {
				// The open failed; there is nothing to close.
			},
		);
		return false;
	}
	try {
		await withTimeout(
			protocol.request("initialize", {
				clientInfo: { name: "entwurf-fresh-preflight", title: "entwurf-fresh-preflight", version: "0" },
				capabilities: { experimentalApi: true, requestAttestation: false },
			}),
			timeoutMs,
		);
		return true;
	} catch {
		return false;
	} finally {
		try {
			protocol.close();
		} catch {
			// best-effort: the socket may already be gone.
		}
	}
}

/**
 * Async because the app-server axis now performs a real bounded protocol exchange, not just an
 * inode check (see `appServerIsLive`). Every other axis stays synchronous filesystem/config
 * work; only the last `await` point can suspend.
 */
export async function codexFreshPreflight(
	env: NodeJS.ProcessEnv,
	deps: CodexPreflightDeps = {},
): Promise<CodexPreflightRejectReason | null> {
	if (birthMissing(deps.systemPaths ?? DEFAULT_SYSTEM_PATHS, deps.systemUid ?? 0)) {
		return "codex-birth-unit-missing";
	}
	const config = readConfig(env);
	if (config === null || mcpMissing(config)) return "codex-mcp-hand-missing";
	if (visibleIdentityMissing(config)) return "codex-visible-identity-missing";
	const socketPath = resolveCodexDefaultSocketPath(env);
	const socket = (deps.checkSocket ?? checkCodexSocketFile)(socketPath);
	if (!socket.ok) return "codex-app-server-unavailable";
	const live = await appServerIsLive(
		socketPath,
		deps.openProtocol ?? realCodexProtocolOpener,
		deps.appServerTimeoutMs ?? DEFAULT_APP_SERVER_TIMEOUT_MS,
	);
	return live ? null : "codex-app-server-unavailable";
}
