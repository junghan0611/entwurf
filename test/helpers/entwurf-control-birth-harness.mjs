// Child-process harness for pi-extensions/entwurf-control.test.ts (#125).
//
// Loads the REAL entwurf-control extension through Pi's REAL public loader
// (`discoverAndLoadExtensions` — the jiti aliases every pi install uses), then runs the extension's
// own session_start / session_shutdown handlers with a stub ctx. The extension's `pi` API object is
// Pi's own (`createExtensionAPI`), so `registerMcpServer` lands in Pi's own runtime registry. Record
// birth, the control socket and the env carrier are the extension's real code.
//
// It must run in its OWN process with a throwaway HOME / PI_CODING_AGENT_DIR: entwurf-control derives
// its control-socket dir from HOME at module load and births into PI_CODING_AGENT_DIR, and a vitest
// worker shares the invoking operator's environment. The parent test sets that environment.
//
// Usage: node entwurf-control-birth-harness.mjs <extensionPath> <cwd> <ui: ok|throws>
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { discoverAndLoadExtensions } from "@earendil-works/pi-coding-agent";

const [extensionPath, cwd, uiMode] = process.argv.slice(2);
const agentDir = process.env.PI_CODING_AGENT_DIR;
const out = { order: [], errors: [] };

const loaded = await discoverAndLoadExtensions([extensionPath], cwd, agentDir);
if (loaded.errors.length > 0) {
	console.log(JSON.stringify({ loadErrors: loaded.errors }));
	process.exit(2);
}
const runtime = loaded.runtime;
const extension = loaded.extensions[0];
const snapshot = () =>
	runtime.mcpServers.list().map((s) => ({ name: s.name, config: s.config, extensionPath: s.extensionPath }));
out.afterFactory = snapshot();

// Order probe: note when Pi's registry receives the registration, beside the UI status call below.
const register = runtime.mcpServers.register.bind(runtime.mcpServers);
runtime.mcpServers.register = (server) => {
	out.order.push({ what: "register", envAtRegister: process.env.PI_SESSION_ID ?? null });
	return register(server);
};
runtime.flagValues.set("entwurf-control", true);

const nativeSessionId = "01900000-0000-7000-8000-00000000b125";
const theme =
	uiMode === "throws"
		? new Proxy(
				{},
				{
					get() {
						throw new Error("harness: theme unavailable");
					},
				},
			)
		: { fg: (_color, text) => text, bg: (_color, text) => text };
const ctx = {
	cwd,
	hasUI: true,
	mode: "rpc",
	model: { provider: "gate", id: "entwurf-control-test" },
	signal: undefined,
	isIdle: () => true,
	sessionManager: {
		getSessionId: () => nativeSessionId,
		getSessionFile: () => undefined,
		getEntries: () => [],
		getBranch: () => [],
		getLeafId: () => null,
	},
	ui: {
		theme,
		setStatus: () => out.order.push({ what: "status" }),
		notify: () => {},
		select: async () => undefined,
	},
};

for (const handler of extension.handlers.get("session_start") ?? []) {
	try {
		await handler({ type: "session_start", reason: "startup" }, ctx);
	} catch (err) {
		out.errors.push(String(err instanceof Error ? err.message : err));
	}
}
out.afterStart = snapshot();
out.envAfterStart = { PI_SESSION_ID: process.env.PI_SESSION_ID ?? null, PI_AGENT_ID: process.env.PI_AGENT_ID ?? null };
// Independent identity oracle: the V3 record the store holds for THIS native session.
const sessionsDir = join(agentDir, "meta-sessions");
out.records = readdirSync(sessionsDir)
	.filter((f) => f.endsWith(".meta.json"))
	.map((f) => JSON.parse(readFileSync(join(sessionsDir, f), "utf8")))
	.filter((r) => r.nativeSessionId === nativeSessionId)
	.map((r) => ({ gardenId: r.gardenId, backend: r.backend }));

for (const handler of extension.handlers.get("session_shutdown") ?? []) {
	try {
		await handler({ type: "session_shutdown", reason: "quit" }, ctx);
	} catch (err) {
		out.errors.push(`shutdown: ${String(err instanceof Error ? err.message : err)}`);
	}
}
out.afterShutdown = snapshot();
out.execPath = process.execPath;
console.log(JSON.stringify(out));
process.exit(0);
