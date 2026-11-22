// #171 RAIL 0 — raw session/load + session/resume measurement (R1, R2 Claude half). NOT a gate.
// Launch through run.sh beside this (LIVE=1, sandboxed HOME/XDG/PI_CODING_AGENT_DIR, run dir outside the repo).
// Imports the repo's compiled bridge dist; no repo file is written. NOTE: initialize sends
// `clientCapabilities: {}`, not the production value — kept as measured; see README.
import { execFileSync, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { appendFileSync, existsSync, lstatSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { agyBin, CLAUDE_CRED, claudeLauncherArg, D, mt, REAL_CLAUDE, REPO, RUN, TOKEN } from "./common.mjs";

const MODEL = process.env.PROBE_MODEL ?? "claude-sonnet-5-5";
const EFFORT = process.env.PROBE_EFFORT ?? "low";

const ov = await import(join(D, "overlay.js"));
const { claudeAdapter, agyLaunchArgs } = await import(join(D, "backend-adapter.js"));
const { resolveProviderConfig, mcpServerNames } = await import(join(D, "config.js"));

const EV = join(RUN, "events.jsonl");
const L = (k, v = {}) => appendFileSync(EV, JSON.stringify({ t: new Date().toISOString(), k, ...v }) + "\n");
const summary = {
	model: MODEL,
	effort: EFFORT,
	mtimeBefore: { agyToken: mt(TOKEN), claudeCred: mt(CLAUDE_CRED) },
	runs: {},
	children: [],
};
const save = () => writeFileSync(join(RUN, "summary.json"), JSON.stringify(summary, null, 2));

L("env", {
	home: process.env.HOME,
	overlayDir: ov.CLAUDE_CONFIG_OVERLAY_DIR,
	ambient: Object.keys(process.env).filter((k) => /^(ANTHROPIC|CLAUDE|PI_|ENTWURF|GEMINI|GOOGLE)/.test(k)),
});

// ---- overlay (production function, explicit dirs) ----
const overlayA = ov.CLAUDE_CONFIG_OVERLAY_DIR;
const overlayB = join(RUN, "home/.pi/agent/claude-config-overlay-B");
ov.ensureClaudeConfigOverlay(REAL_CLAUDE, overlayA);
ov.ensureClaudeConfigOverlay(REAL_CLAUDE, overlayB);
const entries = (d) => readdirSync(d).map((e) => [e, lstatSync(join(d, e)).isSymbolicLink() ? "symlink" : "real"]);
L("overlay", { overlayA: entries(overlayA), overlayB: entries(overlayB) });

const scratch = join(RUN, "scratch-cwd");
mkdirSync(scratch, { recursive: true });
const config = resolveProviderConfig({
	cwd: scratch,
	adapter: claudeAdapter,
	globalSettingsPath: join(RUN, "absent-global.json"),
	projectSettingsPath: join(RUN, "absent-project.json"),
});
const carrier = claudeAdapter.loadCarrier({ mcpServerNames: mcpServerNames(config), config });
const meta = claudeAdapter.buildSessionMeta({ modelId: MODEL, nativeModelId: MODEL, config }, carrier);
const launch0 = claudeAdapter.resolveLaunch({ nativeModelId: MODEL, config });
// bridge dist ships no copy of the .js launcher; use the source-tree launcher (identical role, same vendor resolution).
const SRC_LAUNCHER = join(REPO, "pi-extensions/lib/acp/claude-acp-launch.js");
const launch = {
	...launch0,
	args: launch0.args.map((a) => claudeLauncherArg(a, SRC_LAUNCHER)),
};
const baseEnv = claudeAdapter.launchEnvDefaults();
L("launch", { launch, baseEnv, carrierChars: carrier?.length ?? null, mcpServers: config.mcpServers.length });

// ---- minimal JSON-RPC child ----
function startChild(label, { command, args, env }) {
	const wireIn = join(RUN, `${label}.wire-in.ndjson`);
	const wireOut = join(RUN, `${label}.wire-out.ndjson`);
	const child = spawn(command, args, { cwd: scratch, env, stdio: ["pipe", "pipe", "pipe"], detached: true });
	const rec = { label, pid: child.pid, exit: null };
	summary.children.push(rec);
	child.stderr.on("data", (b) => appendFileSync(join(RUN, `${label}.stderr.log`), b));
	const pending = new Map();
	const notes = []; // {phase, kind, text?, raw-ish}
	let phase = "pre";
	let nextId = 1;
	let buf = "";
	const send = (obj) => {
		const s = JSON.stringify(obj) + "\n";
		appendFileSync(wireOut, s);
		child.stdin.write(s);
	};
	child.stdout.on("data", (b) => {
		appendFileSync(wireIn, b);
		buf += b.toString("utf8");
		for (let i = buf.indexOf("\n"); i >= 0; i = buf.indexOf("\n")) {
			const line = buf.slice(0, i).trim();
			buf = buf.slice(i + 1);
			if (!line) continue;
			let m;
			try {
				m = JSON.parse(line);
			} catch {
				continue;
			}
			if (m.id !== undefined && m.method === undefined) {
				const p = pending.get(m.id);
				if (p) {
					pending.delete(m.id);
					m.error ? p.reject(Object.assign(new Error(m.error.message), { rpc: m.error })) : p.resolve(m.result);
				}
			} else if (m.method === "session/update") {
				const u = m.params?.update ?? {};
				const n = { phase, kind: u.sessionUpdate, sid: m.params?.sessionId };
				const t = u.content?.text;
				if (typeof t === "string") n.text = t;
				if (u.sessionUpdate === "usage_update") n.usage = { used: u.used, size: u.size };
				if (u.sessionUpdate === "tool_call" || u.sessionUpdate === "tool_call_update") n.title = u.title ?? null;
				if (u._meta) n.metaKeys = Object.keys(u._meta);
				notes.push(n);
			} else if (m.method && m.id !== undefined) {
				L("agent-request", { label, method: m.method });
				if (m.method === "session/request_permission")
					send({ jsonrpc: "2.0", id: m.id, result: { outcome: { outcome: "cancelled" } } });
				else send({ jsonrpc: "2.0", id: m.id, error: { code: -32601, message: "probe: not supported" } });
			} else if (m.method) {
				L("agent-notification", { label, method: m.method });
			}
		}
	});
	const exited = new Promise((r) =>
		child.on("exit", (code, signal) => {
			rec.exit = { code, signal };
			L("child-exit", { label, code, signal });
			r();
		}),
	);
	const rpc = (method, params, ms = 60000) => {
		const id = nextId++;
		return new Promise((resolve, reject) => {
			const timer = setTimeout(() => {
				pending.delete(id);
				reject(new Error(`${method} timed out ${ms}ms`));
			}, ms);
			pending.set(id, {
				resolve: (v) => {
					clearTimeout(timer);
					resolve(v);
				},
				reject: (e) => {
					clearTimeout(timer);
					reject(e);
				},
			});
			send({ jsonrpc: "2.0", id, method, params });
		});
	};
	const setPhase = (p) => {
		phase = p;
	};
	const kill = async () => {
		try {
			process.kill(-child.pid, "SIGTERM");
		} catch {}
		await Promise.race([exited, new Promise((r) => setTimeout(r, 6000))]);
		if (!rec.exit) {
			try {
				process.kill(-child.pid, "SIGKILL");
				rec.escalated = true;
			} catch {}
			await Promise.race([exited, new Promise((r) => setTimeout(r, 2000))]);
		}
		await new Promise((r) => setTimeout(r, 500));
		let groupAlive = true;
		try {
			process.kill(-child.pid, 0);
		} catch (e) {
			groupAlive = e.code !== "ESRCH";
		}
		let left = "";
		try {
			left = execFileSync("ps", ["-eo", "pid=,pgid=,comm="], { encoding: "utf8" })
				.split("\n")
				.filter((l) => l.trim().split(/\s+/)[1] === String(child.pid))
				.join("\n");
		} catch {}
		rec.groupAliveAfterKill = groupAlive;
		rec.leftoverInGroup = left;
		L("child-reaped", { label, exit: rec.exit, groupAlive, left });
	};
	return { rpc, notes, setPhase, kill, rec };
}

const claudeEnv = (overlayDir) => {
	const env = { ...process.env, ...baseEnv };
	if (overlayDir) env.CLAUDE_CONFIG_DIR = overlayDir;
	return env;
};
const connShim = (c) => ({ setSessionConfigOption: (p) => c.rpc("session/set_config_option", p, 30000) });

const countKinds = (notes, phase) => {
	const out = {};
	for (const n of notes.filter((x) => x.phase === phase)) out[n.kind] = (out[n.kind] ?? 0) + 1;
	return out;
};
const phaseDigest = (notes, phase) => {
	const ns = notes.filter((x) => x.phase === phase);
	const texts = {};
	for (const n of ns) if (n.text) texts[n.kind] = (texts[n.kind] ?? "") + n.text;
	return {
		kinds: countKinds(notes, phase),
		sequence: ns
			.map((n) => n.kind)
			.reduce((a, k) => {
				if (a.length && a[a.length - 1][0] === k) a[a.length - 1][1]++;
				else a.push([k, 1]);
				return a;
			}, []),
		textHead: Object.fromEntries(Object.entries(texts).map(([k, v]) => [k, v.slice(0, 240)])),
		textChars: Object.fromEntries(Object.entries(texts).map(([k, v]) => [k, v.length])),
		usage: ns.filter((n) => n.usage).map((n) => n.usage),
		sessionIds: [...new Set(ns.map((n) => n.sid))],
	};
};
async function prompt(c, sid, phase, text) {
	c.setPhase(phase);
	const t0 = Date.now();
	const res = await c.rpc("session/prompt", { sessionId: sid, prompt: [{ type: "text", text }] }, 240000);
	c.setPhase(`${phase}:after`);
	return {
		stopReason: res?.stopReason,
		usage: res?.usage ?? null,
		ms: Date.now() - t0,
		digest: phaseDigest(c.notes, phase),
	};
}
const init = (c) =>
	c.rpc(
		"initialize",
		{ protocolVersion: 1, clientCapabilities: {}, clientInfo: { name: "entwurf-171-probe", version: "0" } },
		30000,
	);
const sessParams = (extra) => ({ cwd: scratch, mcpServers: [], _meta: meta, ...extra });
const transcriptFiles = (dir) => {
	const out = [];
	const walk = (d) => {
		if (!existsSync(d)) return;
		for (const e of readdirSync(d)) {
			const p = join(d, e);
			const s = lstatSync(p);
			if (s.isDirectory()) walk(p);
			else out.push([p.slice(dir.length + 1), s.size]);
		}
	};
	walk(join(dir, "projects"));
	return out;
};
const errOf = (e) => ({ message: e.message, rpc: e.rpc ?? null });

const W = "ZIRCON-47";
let sid;
try {
	// ---------------- Run A ----------------
	summary.runs.A = {};
	const A = summary.runs.A;
	const c1 = startChild("c1", { ...launch, env: claudeEnv() });
	const i1 = await init(c1);
	writeFileSync(join(RUN, "c1.initialize.json"), JSON.stringify(i1, null, 2));
	A.init = {
		protocolVersion: i1.protocolVersion,
		loadSession: i1.agentCapabilities?.loadSession,
		sessionCapabilities: Object.keys(i1.agentCapabilities?.sessionCapabilities ?? {}),
	};
	c1.setPhase("new");
	const created = await c1.rpc("session/new", sessParams({}), 60000);
	sid = created.sessionId;
	A.sessionId = sid;
	await claudeAdapter.enforceModel({
		connection: connShim(c1),
		acpSessionId: sid,
		nativeModelId: MODEL,
		modelId: MODEL,
	});
	await claudeAdapter.enforceThinking({ connection: connShim(c1), acpSessionId: sid, modelId: MODEL, value: EFFORT });
	A.newDigest = phaseDigest(c1.notes, "new");
	A.P1 = await prompt(c1, sid, "P1", `Remember this word: '${W}'. Reply with only OK.`);
	A.P2 = await prompt(c1, sid, "P2", "One number only: what is 3+4?");
	A.betweenP2andKill = phaseDigest(c1.notes, "P2:after");
	A.transcriptsAfterC1 = transcriptFiles(overlayA);
	await c1.kill();
	save();

	const c2 = startChild("c2", { ...launch, env: claudeEnv() });
	const i2 = await init(c2);
	A.c2LoadSession = i2.agentCapabilities?.loadSession;
	c2.setPhase("load");
	const t0 = Date.now();
	const loaded = await c2.rpc("session/load", sessParams({ sessionId: sid }), 120000);
	A.loadMs = Date.now() - t0;
	writeFileSync(join(RUN, "c2.load-response.json"), JSON.stringify(loaded, null, 2));
	A.loadResponseKeys = Object.keys(loaded ?? {});
	c2.setPhase("load:after");
	await new Promise((r) => setTimeout(r, 3000));
	A.loadDigest = phaseDigest(c2.notes, "load");
	A.loadAfterDigest = phaseDigest(c2.notes, "load:after");
	// production enforceModel/effort after load, same as after new
	try {
		await claudeAdapter.enforceModel({
			connection: connShim(c2),
			acpSessionId: sid,
			nativeModelId: MODEL,
			modelId: MODEL,
		});
		A.enforceAfterLoad = "ok";
	} catch (e) {
		A.enforceAfterLoad = errOf(e);
	}
	A.P3 = await prompt(c2, sid, "P3", "Earlier I asked you to remember a word. What was it? Reply with the word only.");
	A.recallP3 = A.P3.digest.textHead.agent_message_chunk ?? "";
	A.recallP3Hit = A.recallP3.includes(W);
	A.transcriptsAfterC2 = transcriptFiles(overlayA);
	await c2.kill();
	save();

	// ---------------- Run C (resume) ----------------
	summary.runs.C = {};
	const C = summary.runs.C;
	const c4 = startChild("c4", { ...launch, env: claudeEnv() });
	await init(c4);
	c4.setPhase("resume");
	const t1 = Date.now();
	try {
		const resumed = await c4.rpc("session/resume", sessParams({ sessionId: sid }), 120000);
		C.resumeMs = Date.now() - t1;
		writeFileSync(join(RUN, "c4.resume-response.json"), JSON.stringify(resumed, null, 2));
		c4.setPhase("resume:after");
		await new Promise((r) => setTimeout(r, 3000));
		C.resumeDigest = phaseDigest(c4.notes, "resume");
		C.resumeAfterDigest = phaseDigest(c4.notes, "resume:after");
		try {
			await claudeAdapter.enforceModel({
				connection: connShim(c4),
				acpSessionId: sid,
				nativeModelId: MODEL,
				modelId: MODEL,
			});
			C.enforceAfterResume = "ok";
		} catch (e) {
			C.enforceAfterResume = errOf(e);
		}
		C.P4 = await prompt(
			c4,
			sid,
			"P4",
			"Earlier I asked you to remember a word. What was it? Reply with the word only.",
		);
		C.recallP4 = C.P4.digest.textHead.agent_message_chunk ?? "";
		C.recallP4Hit = C.recallP4.includes(W);
	} catch (e) {
		C.resumeError = errOf(e);
	}
	C.transcriptsAfterC4 = transcriptFiles(overlayA);
	await c4.kill();
	save();

	// ---------------- Run B (failure contract, no prompt) ----------------
	summary.runs.B = {};
	const B = summary.runs.B;
	const c3 = startChild("c3", { ...launch, env: claudeEnv(overlayB) });
	await init(c3);
	c3.setPhase("load-other-overlay");
	try {
		const r = await c3.rpc("session/load", sessParams({ sessionId: sid }), 60000);
		B.otherOverlay = { ok: true, keys: Object.keys(r ?? {}) };
	} catch (e) {
		B.otherOverlay = errOf(e);
	}
	B.otherOverlayDigest = phaseDigest(c3.notes, "load-other-overlay");
	await c3.kill();
	const c5 = startChild("c5", { ...launch, env: claudeEnv() });
	await init(c5);
	c5.setPhase("load-unknown");
	const bogus = randomUUID();
	try {
		const r = await c5.rpc("session/load", sessParams({ sessionId: bogus }), 60000);
		B.unknownId = { ok: true, bogus, keys: Object.keys(r ?? {}) };
	} catch (e) {
		B.unknownId = { bogus, ...errOf(e) };
	}
	B.unknownDigest = phaseDigest(c5.notes, "load-unknown");
	await c5.kill();
	save();
} catch (e) {
	summary.fatal = errOf(e);
	L("fatal", summary.fatal);
}

// ---------------- agy: initialize only ----------------
try {
	summary.runs.agy = {};
	const G = summary.runs.agy;
	const gdir = join(RUN, "home/agy-gemini-empty");
	mkdirSync(gdir, { recursive: true });
	const agy = agyBin();
	G.version = execFileSync(agy, ["--version"], { encoding: "utf8", env: process.env }).trim();
	const g = startChild("agy", { command: agy, args: agyLaunchArgs(gdir), env: { ...process.env } });
	const gi = await init(g);
	writeFileSync(join(RUN, "agy.initialize.json"), JSON.stringify(gi, null, 2));
	G.init = {
		protocolVersion: gi.protocolVersion,
		loadSession: gi.agentCapabilities?.loadSession,
		sessionCapabilities: gi.agentCapabilities?.sessionCapabilities ?? null,
		authMethods: (gi.authMethods ?? []).map((a) => a.id),
		agentInfo: gi.agentInfo ?? null,
	};
	G.notesDuringInit = g.notes.map((n) => n.kind);
	await g.kill();
	G.geminiDirAfter = readdirSync(gdir);
} catch (e) {
	summary.runs.agy = { ...(summary.runs.agy ?? {}), error: errOf(e) };
}
summary.mtimeAfter = { agyToken: mt(TOKEN), claudeCred: mt(CLAUDE_CRED) };
save();
console.log(JSON.stringify(summary, null, 2));
