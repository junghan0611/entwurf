// Child-process harness for pi-extensions/entwurf-control.refresh.test.ts (#151 b1).
//
// Loads the REAL entwurf-control extension through Pi's REAL public loader, births the session through
// its own session_start into a throwaway store, then calls the REAL registered turn_end handler — the
// ordinary record refresh the /renew writer must serialize with. The stub ctx can change which session
// it reports AFTER the handler's synchronous prefix, which is what a session replaced while a refresh
// waits looks like to the handler. What it records: the store on disk, the handler's stderr lines and
// the status calls. Pi's own stale-ctx behaviour is not exercised here; this pins the handler's reading.
//
// Same isolation as the other entwurf-control harnesses: its own process, a throwaway HOME /
// PI_CODING_AGENT_DIR, no inherited identity carrier. The "compiled entwurf-bridge missing" session_start
// refusal is set apart for the same reason as there (thrown after birth and socket; a qualification
// snapshot carries no dist).
//
// Usage: node entwurf-control-refresh-harness.mjs <extensionPath> <cwd>
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { discoverAndLoadExtensions } from "@earendil-works/pi-coding-agent";
import { acquireLock, releaseLock } from "../../pi-extensions/lib/entwurf-v2-lock.ts";

const [extensionPath, cwd] = process.argv.slice(2);
const agentDir = process.env.PI_CODING_AGENT_DIR;
const sessionsDir = join(agentDir, "meta-sessions");
const locksDir = join(agentDir, "meta-record-arm-locks");
const out = { errors: [], bridgeMissing: 0 };
const BRIDGE_MISSING = "[entwurf-control] compiled entwurf-bridge missing at ";

const loaded = await discoverAndLoadExtensions([extensionPath], cwd, agentDir);
if (loaded.errors.length > 0) {
	console.log(JSON.stringify({ loadErrors: loaded.errors }));
	process.exit(2);
}
loaded.runtime.flagValues.set("entwurf-control", true);
loaded.runtime.sendMessage = () => {};
const extension = loaded.extensions[0];

const N0 = "01900000-0000-7000-8000-0000000151b0";
const N1 = "01900000-0000-7000-8000-0000000151b1";
mkdirSync(agentDir, { recursive: true });
const fileN0 = join(agentDir, "n0.jsonl");
const fileN1 = join(agentDir, "n1.jsonl");
writeFileSync(fileN0, "");
writeFileSync(fileN1, "");
let liveNative = N0;
let liveFile;
const statusLog = [];
const ctx = {
	cwd,
	hasUI: true,
	mode: "rpc",
	model: { provider: "gate", id: "entwurf-control-refresh" },
	signal: undefined,
	isIdle: () => true,
	sessionManager: {
		getSessionId: () => liveNative,
		getSessionFile: () => liveFile,
		getEntries: () => [],
		getBranch: () => [],
		getLeafId: () => null,
	},
	ui: {
		theme: { fg: (_c, t) => t, bg: (_c, t) => t },
		setStatus: (_key, value) => statusLog.push(value === undefined ? null : String(value)),
		notify: () => {},
		select: async () => undefined,
	},
};

const stderrLines = [];
const realWrite = process.stderr.write.bind(process.stderr);
process.stderr.write = (chunk, ...rest) => {
	stderrLines.push(String(chunk));
	return realWrite(chunk, ...rest);
};
const settle = async (event, promises) => {
	for (const result of await Promise.allSettled(promises)) {
		if (result.status === "fulfilled") continue;
		const message = String(result.reason instanceof Error ? result.reason.message : result.reason);
		if (event === "session_start" && message.startsWith(BRIDGE_MISSING)) out.bridgeMissing++;
		else out.errors.push(`${event}: ${message}`);
	}
};
const start = (event, payload) => (extension.handlers.get(event) ?? []).map((h) => h(payload, ctx));
const run = (event, payload) => settle(event, start(event, payload));
const records = () =>
	readdirSync(sessionsDir)
		.filter((f) => f.endsWith(".meta.json"))
		.map((f) => ({ file: join(sessionsDir, f), record: JSON.parse(readFileSync(join(sessionsDir, f), "utf8")) }));
const recordOf = (native) => records().find((r) => r.record.nativeSessionId === native) ?? null;
const TURN_END = { type: "turn_end" };

// Birth of N0 (no transcript yet).
await run("session_start", { type: "session_start", reason: "startup" });
const gardenId = recordOf(N0)?.record.gardenId ?? null;
out.gardenId = gardenId;

// 1. A refresh whose session is replaced while it waits: the handler's synchronous prefix sees N0,
//    everything after its first wait would see N1.
liveFile = fileN0;
const pending = start("turn_end", TURN_END);
liveNative = N1;
liveFile = fileN1;
await settle("turn_end", pending);
out.readsEventSession = {
	n1Records: records().filter((r) => r.record.nativeSessionId === N1).length,
	n0Transcript: recordOf(N0)?.record.transcriptPath ?? null,
};
liveNative = N0;
liveFile = fileN0;

// 2. A refresh that meets a held record-arm lock: the one named skip, and the record does not move.
const held = acquireLock(gardenId, { dir: locksDir, nonce: () => "f".repeat(32) });
if (!held.ok) {
	console.log(JSON.stringify({ loadErrors: [`harness could not take the lock: ${held.conflict.detail}`] }));
	process.exit(2);
}
const beforeBusy = readFileSync(recordOf(N0).file);
const linesBeforeBusy = stderrLines.length;
liveFile = fileN1; // a refresh that got through would record this transcript
const busyStart = Date.now();
await run("turn_end", TURN_END);
out.lockBusy = {
	elapsedMs: Date.now() - busyStart,
	lines: stderrLines.slice(linesBeforeBusy).filter((l) => l.startsWith("[entwurf-control]")),
	recordUnchanged: readFileSync(recordOf(N0).file).equals(beforeBusy),
};
releaseLock(held.claim, { dir: locksDir });
liveFile = fileN0;

// 3. A refresh still waiting when the session shuts down writes no status for the old session.
const waiting = start("turn_end", TURN_END);
statusLog.push("<<shutdown>>");
const shutdown = start("session_shutdown", { type: "session_shutdown", reason: "new" });
await settle("turn_end", waiting);
await settle("session_shutdown", shutdown);
const mark = statusLog.indexOf("<<shutdown>>");
out.afterShutdownStatus = statusLog.slice(mark + 1).filter((v) => v !== null);

// 4. Any other refresh failure is reported as that failure, not as the busy skip.
await run("session_start", { type: "session_start", reason: "startup" });
const junk = join(sessionsDir, "zz-not-a-record.meta.json");
writeFileSync(junk, "{");
const linesBeforeDefect = stderrLines.length;
await run("turn_end", TURN_END);
out.otherFailure = stderrLines.slice(linesBeforeDefect).filter((l) => l.startsWith("[entwurf-control]"));
rmSync(junk);

await run("session_shutdown", { type: "session_shutdown", reason: "quit" });
process.stderr.write = realWrite;
console.log(JSON.stringify(out));
process.exit(0);
