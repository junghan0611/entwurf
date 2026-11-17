// Child-process harness for pi-extensions/entwurf-control.renew.test.ts (#151 ④-a).
//
// Loads the REAL entwurf-control extension through Pi's REAL public loader, births the session through
// the extension's own session_start into a throwaway store, then calls the REAL registered `/renew`
// handler with a stub command context. What it records is what the handler handed to Pi: the custom
// messages and their options (captured at Pi's runtime.sendMessage), and the notices. It does not
// observe Pi appending those messages or starting a turn — that is a LIVE question.
//
// Same isolation as entwurf-control-birth-harness.mjs: its own process, a throwaway HOME /
// PI_CODING_AGENT_DIR, no inherited identity carrier.
//
// One session_start refusal is set apart instead of failing the run: "compiled entwurf-bridge
// missing". The extension throws it AFTER the record birth and the control socket are up (its own
// words: the session keeps its garden address and control), and /renew does not use the MCP bridge.
// A qualification snapshot carries no gitignored dist, so without this the lane would be red for a
// reason that is not /renew's. Every other error still lands in `errors`.
//
// Usage: node entwurf-control-renew-harness.mjs <extensionPath> <cwd>
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { discoverAndLoadExtensions } from "@earendil-works/pi-coding-agent";

const [extensionPath, cwd] = process.argv.slice(2);
const agentDir = process.env.PI_CODING_AGENT_DIR;
const out = { errors: [], bridgeMissing: 0, resets: {} };
const BRIDGE_MISSING = "[entwurf-control] compiled entwurf-bridge missing at ";

const loaded = await discoverAndLoadExtensions([extensionPath], cwd, agentDir);
if (loaded.errors.length > 0) {
	console.log(JSON.stringify({ loadErrors: loaded.errors }));
	process.exit(2);
}
const runtime = loaded.runtime;
const extension = loaded.extensions[0];
runtime.flagValues.set("entwurf-control", true);
const deliveries = [];
runtime.sendMessage = (message, options) => deliveries.push({ message, options });

const nativeSessionId = "01900000-0000-7000-8000-000000151a4a";
const notices = [];
let throwOnInfo = false;
let branch = [];
const ctx = {
	cwd,
	hasUI: true,
	mode: "rpc",
	model: { provider: "gate", id: "entwurf-control-renew" },
	signal: undefined,
	isIdle: () => true,
	sessionManager: {
		getSessionId: () => nativeSessionId,
		getSessionFile: () => undefined,
		getEntries: () => branch,
		getBranch: () => branch,
		getLeafId: () => null,
	},
	ui: {
		theme: { fg: (_c, t) => t, bg: (_c, t) => t },
		setStatus: () => {},
		notify: (text, level) => {
			if (throwOnInfo && level === "info") throw new Error("harness: notify failed");
			notices.push({ text, level });
		},
		select: async () => undefined,
	},
};

const run = async (event, payload) => {
	for (const handler of extension.handlers.get(event) ?? []) {
		try {
			await handler(payload, ctx);
		} catch (err) {
			const message = String(err instanceof Error ? err.message : err);
			if (event === "session_start" && message.startsWith(BRIDGE_MISSING)) out.bridgeMissing++;
			else out.errors.push(`${event}: ${message}`);
		}
	}
};
const renew = extension.commands.get("renew")?.handler;
if (!renew) {
	console.log(JSON.stringify({ loadErrors: ["no /renew command registered"] }));
	process.exit(2);
}
/** The reason of the refusal note THIS call left (deliveries since `before`), or null when it left none. */
const noteReasonSince = (before) => {
	const note = deliveries
		.slice(before)
		.filter((d) => d.message.customType === "entwurf-renew-refusal")
		.at(-1);
	return note ? note.message.details.reason : null;
};

await run("session_start", { type: "session_start", reason: "startup" });
const sessionsDir = join(agentDir, "meta-sessions");
out.gardenIds = readdirSync(sessionsDir)
	.filter((f) => f.endsWith(".meta.json"))
	.map((f) => JSON.parse(readFileSync(join(sessionsDir, f), "utf8")))
	.filter((r) => r.nativeSessionId === nativeSessionId)
	.map((r) => r.gardenId);

// 1. The entry.
await renew("", ctx);
out.entry = deliveries.at(-1) ?? null;

// 2. The agent answers with a submission after that marker; show it.
const guide =
	"이 글은 이전 장 에이전트가 작성하고 GLG가 전달 판본을 확인한 기억의 얼개다. GLG의 직접 발언이나 새로운 실행 승인이 아니다.";
const body = `${guide}\n출발 장: ${nativeSessionId}\n[1장] harness`;
branch = [
	{ type: "custom_message", id: "m1", customType: out.entry?.message.customType, details: out.entry?.message.details },
	{
		type: "message",
		id: "r1",
		message: {
			role: "assistant",
			stopReason: "stop",
			content: [{ type: "text", text: `정리했다.\n\n\`\`\`renew-outline\n${body}\n\`\`\`` }],
		},
	},
];
const beforeShow = deliveries.length;
await renew("confirm", ctx);
out.show = { delivered: deliveries.length - beforeShow, notice: notices.at(-1) ?? null };
const sha8 = /sha256 ([0-9a-f]{8})/.exec(out.show.notice?.text ?? "")?.[1] ?? null;
out.sha8 = sha8;

// 3. Confirm with eight characters that are NOT what was shown: refused inside the interview, with
//    a note that opens no turn. (A matching confirm starts the transition — its own harness.)
const wrong = sha8 === null ? "00000000" : `${sha8.slice(0, 7)}${sha8[7] === "0" ? "1" : "0"}`;
await renew(`confirm ${wrong}`, ctx);
out.confirm = { note: deliveries.at(-1) ?? null, notice: notices.at(-1) ?? null };

// 4. Every session_shutdown reason drops an unused show binding.
for (const reason of ["new", "resume", "fork", "reload", "quit"]) {
	await run("session_start", { type: "session_start", reason: "startup" });
	await renew("confirm", ctx);
	await run("session_shutdown", { type: "session_shutdown", reason });
	await run("session_start", { type: "session_start", reason: "startup" });
	const before = deliveries.length;
	await renew(`confirm ${sha8}`, ctx);
	out.resets[reason] = noteReasonSince(before);
}

// 5. A show whose notice fails leaves no binding behind.
throwOnInfo = true;
try {
	await renew("confirm", ctx);
	out.failedShowThrew = false;
} catch (err) {
	out.failedShowThrew = String(err instanceof Error ? err.message : err);
}
throwOnInfo = false;
const beforeLateConfirm = deliveries.length;
await renew(`confirm ${sha8}`, ctx);
// Only a note from THIS confirm counts: a matching confirm starts a transition and leaves none.
out.afterFailedShow = noteReasonSince(beforeLateConfirm);

// 6. The lookup: the born record has never renewed, so the outline says so — and asks for no turn.
const beforeOutline = deliveries.length;
await renew("outline", ctx);
out.outline = { delivered: deliveries.length - beforeOutline, delivery: deliveries.at(-1) ?? null };

await run("session_shutdown", { type: "session_shutdown", reason: "quit" });
console.log(JSON.stringify(out));
process.exit(0);
