// Child-process harness for pi-extensions/entwurf-control.transition.test.ts (#151 b3-2).
//
// Loads the REAL entwurf-control through Pi's REAL loader into a throwaway store and drives the REAL
// registered /renew handler to the end. The command ctx's newSession is a stub that follows the SDK's
// order (agent-session-runtime.js): the registered session_before_switch handlers → session_shutdown
// → setup(sm) → session_start(new) → withSession(ctx2). The stub's session manager writes a real
// JSONL file. The control socket is the extension's own; get_info goes over it. What this does NOT
// exercise: Pi's own runner and runtime, a real model, ACP.
//
// SCENARIO=commit  the transition commits; a switch from OUTSIDE the permit's async context (an
//                  AsyncResource made before /renew) is attempted while it is in flight
// SCENARIO=cancel  a later before-handler cancels after Entwurf admitted the switch (no teardown)
// SCENARIO=double  the setup appends the agreed body twice: the transition must not commit; then a
//                  switch is attempted after it stopped (the flight is still held)
// SCENARIO=mismatch the runtime that starts is not the reserved chapter (session_start names N2)
// SCENARIO=token   the record's renew token is not this renew's when the new chapter starts
// SCENARIO=escaped Pi cancels before Entwurf's guard runs and the garden's listener does not answer;
//                  a continuation made INSIDE the permit's async context then attempts a switch
// SCENARIO=concurrent two confirmed effects both enter before either reaches its flight claim
//
// Usage: node entwurf-control-transition-harness.mjs <extensionPath> <cwd>
import { AsyncResource } from "node:async_hooks";
import {
	appendFileSync,
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { discoverAndLoadExtensions } from "@earendil-works/pi-coding-agent";
import { controlSocketPathIn, defaultControlSocketDir } from "../../pi-extensions/lib/control-socket-path.js";

const [extensionPath, cwd] = process.argv.slice(2);
const SCENARIO = process.env.SCENARIO ?? "commit";
const agentDir = process.env.PI_CODING_AGENT_DIR;
const sessionsDir = join(agentDir, "meta-sessions");
mkdirSync(agentDir, { recursive: true });
const out = { scenario: SCENARIO, errors: [], bridgeMissing: 0 };
const BRIDGE_MISSING = "[entwurf-control] compiled entwurf-bridge missing at ";

const loaded = await discoverAndLoadExtensions([extensionPath], cwd, agentDir);
if (loaded.errors.length > 0) {
	console.log(JSON.stringify({ loadErrors: loaded.errors }));
	process.exit(2);
}
loaded.runtime.flagValues.set("entwurf-control", true);
const deliveries = [];
loaded.runtime.sendMessage = (message, options) => deliveries.push({ message, options });
const extension = loaded.extensions[0];

const N0 = "01900000-0000-7000-8000-0000000151a0";
const N1 = "01900000-0000-7000-8000-0000000151a1";
const N2 = "01900000-0000-7000-8000-0000000151a2";
const f0 = join(agentDir, "n0.jsonl");
const f1 = join(agentDir, "n1.jsonl");
const line = (o) => `${JSON.stringify(o)}\n`;
writeFileSync(
	f0,
	line({ type: "session", version: 3, id: N0, timestamp: "2026-11-17T00:00:00.000Z", cwd }) +
		line({
			type: "message",
			id: "a1",
			parentId: null,
			timestamp: "2026-11-17T00:10:00.000Z",
			message: { role: "assistant", content: [] },
		}),
);
let liveNative = N0;
let liveFile = f0;
let branch = [];
const notices = [];
const stderrLines = [];
const realWrite = process.stderr.write.bind(process.stderr);
process.stderr.write = (chunk, ...rest) => {
	stderrLines.push(String(chunk));
	return realWrite(chunk, ...rest);
};
const sessionManager = {
	getSessionId: () => liveNative,
	getSessionFile: () => liveFile,
	getEntries: () => branch,
	getBranch: () => branch,
	getLeafId: () => null,
};
const ui = {
	theme: { fg: (_c, t) => t, bg: (_c, t) => t },
	setStatus: () => {},
	notify: (text, level) => notices.push({ text, level }),
	select: async () => undefined,
};
const runAll = async (event, payload) => {
	const results = [];
	for (const handler of extension.handlers.get(event) ?? []) {
		try {
			results.push({ returned: (await handler(payload, ctx)) ?? null });
		} catch (err) {
			const message = String(err instanceof Error ? err.message : err);
			if (event === "session_start" && message.startsWith(BRIDGE_MISSING)) out.bridgeMissing++;
			else out.errors.push(`${event}: ${message}`);
			results.push({ threw: message });
		}
	}
	return results;
};
// Made BEFORE /renew: its async context has no permit — an independent switch, like a typed /new.
const outside = new AsyncResource("harness-outside");
// Made INSIDE the renew's own newSession call (SCENARIO=escaped): it carries the permit's context.
let insidePermit = null;
/** A guard attempt: what the handlers returned and the cancel lines they wrote. */
const attemptSwitch = async () => {
	const mark = stderrLines.length;
	const results = await runAll("session_before_switch", { type: "session_before_switch", reason: "new" });
	return { results, lines: stderrLines.slice(mark).filter((l) => l.includes("cancelled (")) };
};
const ctx = {
	cwd,
	hasUI: true,
	mode: "rpc",
	model: { provider: "gate", id: "entwurf-control-transition" },
	signal: undefined,
	isIdle: () => true,
	sessionManager,
	ui,
	newSession: async (opts) => {
		out.newSessionCalls = (out.newSessionCalls ?? 0) + 1;
		if (SCENARIO === "escaped") {
			insidePermit = new AsyncResource("harness-inside-permit");
			rmSync(controlSocketPathIn(defaultControlSocketDir(homedir()), out.gardenBefore), { force: true });
			return { cancelled: true }; // an earlier handler cancelled; Entwurf's guard never ran
		}
		if (SCENARIO === "commit") {
			out.outsideDuringFlight = await outside.runInAsyncScope(() =>
				runAll("session_before_switch", { type: "session_before_switch", reason: "new" }),
			);
		}
		const before = await runAll("session_before_switch", { type: "session_before_switch", reason: "new" });
		out.ownSwitchAdmission = before;
		if (before.some((r) => r.returned?.cancel === true)) return { cancelled: true };
		if (SCENARIO === "cancel") return { cancelled: true }; // a later handler cancelled: no teardown
		await runAll("session_shutdown", { type: "session_shutdown", reason: "new" });
		const sm = {
			getSessionId: () => N1,
			getSessionFile: () => f1,
			appendMessage: (message) => {
				if (!existsSync(f1))
					writeFileSync(f1, line({ type: "session", version: 3, id: N1, timestamp: new Date().toISOString(), cwd }));
				const entry = {
					type: "message",
					id: `u${Date.now()}`,
					parentId: null,
					timestamp: new Date().toISOString(),
					message,
				};
				appendFileSync(f1, line(entry));
				if (SCENARIO === "double") appendFileSync(f1, line({ ...entry, id: `${entry.id}b` }));
			},
		};
		await opts.setup?.(sm);
		if (SCENARIO === "token") {
			const recordFile = join(sessionsDir, `${out.gardenBefore}.meta.json`);
			const rec = JSON.parse(readFileSync(recordFile, "utf8"));
			writeFileSync(recordFile, JSON.stringify({ ...rec, renewing: { ...rec.renewing, token: "d".repeat(32) } }));
		}
		liveNative = SCENARIO === "mismatch" ? N2 : N1;
		liveFile = f1;
		await runAll("session_start", { type: "session_start", reason: "new" });
		const live = liveNative;
		await opts.withSession?.({
			sessionManager: { getSessionId: () => live, getSessionFile: () => f1 },
			ui,
			hasUI: true,
		});
		return { cancelled: false };
	},
};

await runAll("session_start", { type: "session_start", reason: "startup" });
const renew = extension.commands.get("renew")?.handler;
const readRecord = () =>
	readdirSync(sessionsDir)
		.filter((f) => f.endsWith(".meta.json"))
		.map((f) => JSON.parse(readFileSync(join(sessionsDir, f), "utf8")))
		.find((r) => r.nativeSessionId === N0 || r.nativeSessionId === N1 || r.renewing?.from === N0);
out.gardenBefore = readRecord()?.gardenId ?? null;

// The interview: the entry marker, then the agent's final reply with the agreed body.
await renew("", ctx);
const entry = deliveries.at(-1);
const BODY =
	"이 글은 이전 장 에이전트가 작성하고 GLG가 전달 판본을 확인한 기억의 얼개다. GLG의 직접 발언이나 새로운 실행 승인이 아니다.\n" +
	`출발 장: ${N0}\n[1장] harness 전환`;
out.body = BODY;
branch = [
	{ type: "custom_message", id: "m1", customType: entry?.message.customType, details: entry?.message.details },
	{
		type: "message",
		id: "r1",
		message: {
			role: "assistant",
			stopReason: "stop",
			content: [{ type: "text", text: `정리했다.\n\n\`\`\`renew-outline\n${BODY}\n\`\`\`` }],
		},
	},
];
await renew("confirm", ctx);
const sha8 = /sha256 ([0-9a-f]{8})/.exec(notices.at(-1)?.text ?? "")?.[1] ?? null;
if (SCENARIO === "concurrent") {
	// All three calls run synchronously up to their first await: A and B both enter the effect
	// before either reaches its claim; the show in between re-binds the same candidate for B.
	const a = renew(`confirm ${sha8}`, ctx);
	const shown = renew("confirm", ctx);
	const b = renew(`confirm ${sha8}`, ctx);
	await Promise.all([a, shown, b]);
} else {
	await renew(`confirm ${sha8}`, ctx);
}

// After the transition returned: a switch from the top level (no permit), and from the continuation
// made inside the permit's context.
out.afterStop = await attemptSwitch();
out.escapedAfter = insidePermit === null ? null : await insidePermit.runInAsyncScope(attemptSwitch);

const after = readRecord();
out.record = after
	? {
			gardenId: after.gardenId,
			nativeSessionId: after.nativeSessionId,
			renewing: after.renewing ? { from: after.renewing.from, to: after.renewing.to } : null,
			chapters: (after.chapters ?? []).map((c) => c.nativeSessionId),
			outlineBody: after.outline?.body ?? null,
			outlineFor: after.outline?.forNativeSessionId ?? null,
		}
	: null;
out.newFile = existsSync(f1) ? readFileSync(f1, "utf8") : null;
out.recordCount = readdirSync(sessionsDir).filter((f) => f.endsWith(".meta.json")).length;
out.leavingOriginalMode = statSync(f0).mode & 0o777;
out.targetLockLeft =
	out.gardenBefore === null
		? null
		: existsSync(join(process.env.HOME, ".pi", "entwurf-v2-locks", `${out.gardenBefore}.lock`));
out.resultLines = stderrLines.filter((l) => l.includes("/renew"));
out.notices = notices.map((n) => n.text);
process.stderr.write = realWrite;
console.log(JSON.stringify(out));
process.exit(0);
