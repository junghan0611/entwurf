// #171 Z5 — abandoned session/new, Claude ACP and agy (R10). Zero prompts. NOT a gate. Shares the
// experiments.mjs harness by copy (only runBackend differs), kept as it produced the receipt.
// Launch through run.sh beside this (LIVE=1, sandboxed HOME/XDG/PI_CODING_AGENT_DIR, run dir outside
// the repo). Imports the repo's compiled bridge dist; the two .js/.mjs files the bridge dist does not
// carry (claude-acp-launch.js, agy-acp-hook.mjs) are taken from the source tree. No repo file is written.
import { execFileSync, spawn } from "node:child_process";
import { appendFileSync, existsSync, lstatSync, mkdirSync, readdirSync, readlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
	agyBin,
	CLAUDE_CRED,
	claudeLauncherArg,
	D,
	mt,
	REAL_CLAUDE,
	REAL_GEMINI,
	REPO,
	RUN,
	TOKEN,
} from "./common.mjs";

const ONLY = process.argv[3]; // optional: "claude" | "agy"
if (ONLY !== undefined && ONLY !== "claude" && ONLY !== "agy")
	throw new Error(`backend filter must be claude or agy: ${ONLY}`);
if (ONLY !== "claude") agyBin(); // fail before the first child, not after the Claude half

const ov = await import(join(D, "overlay.js"));
const BA = await import(join(D, "backend-adapter.js"));
const { resolveProviderConfig, mcpServerNames } = await import(join(D, "config.js"));

const EV = join(RUN, "events.jsonl");
const L = (k, v = {}) => appendFileSync(EV, JSON.stringify({ t: new Date().toISOString(), k, ...v }) + "\n");
const summary = { mtimeBefore: { agyToken: mt(TOKEN), claudeCred: mt(CLAUDE_CRED) }, backends: {} };
const save = () => writeFileSync(join(RUN, "summary.json"), JSON.stringify(summary, null, 2));
const scratch = join(RUN, "scratch-cwd");
mkdirSync(scratch, { recursive: true });
const CAPS = { session: { compaction: {} } };
const trunc = (v, n = 400) => {
	const s = JSON.stringify(v);
	return s.length > n ? s.slice(0, n) + "…" : s;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// processes (other than this probe) whose cwd lies under RUN — catches descendants that left the group
function underRun() {
	const out = [];
	for (const p of readdirSync("/proc")) {
		if (!/^\d+$/.test(p) || Number(p) === process.pid) continue;
		try {
			if (readlinkSync(`/proc/${p}/cwd`).startsWith(RUN)) out.push(`${p}:${readFileComm(p)}`);
		} catch {}
	}
	return out;
}
function readFileComm(p) {
	try {
		return execFileSync("cat", [`/proc/${p}/comm`], { encoding: "utf8" }).trim();
	} catch {
		return "?";
	}
}
function groupMembers(pgid) {
	try {
		return execFileSync("ps", ["-eo", "pid=,pgid=,stat=,comm="], { encoding: "utf8" })
			.split("\n")
			.filter((l) => l.trim().split(/\s+/)[1] === String(pgid))
			.map((l) => l.trim());
	} catch {
		return ["ps-failed"];
	}
}

let childSeq = 0;
function startChild(B, tag, envOverride) {
	const label = `${B.name}-${String(++childSeq).padStart(2, "0")}-${tag}`;
	const child = spawn(B.command, B.args, {
		cwd: scratch,
		env: envOverride ?? B.env,
		stdio: ["pipe", "pipe", "pipe"],
		detached: true,
	});
	child.stderr.on("data", (b) => appendFileSync(join(RUN, `${label}.stderr.log`), b));
	const pending = new Map();
	const notes = [];
	let phase = "pre",
		nextId = 1,
		buf = "",
		exit = null;
	const send = (o) => {
		const s = JSON.stringify(o) + "\n";
		appendFileSync(join(RUN, `${label}.wire-out.ndjson`), s);
		child.stdin.write(s);
	};
	child.stdout.on("data", (b) => {
		appendFileSync(join(RUN, `${label}.wire-in.ndjson`), b);
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
					m.error ? p.rej(Object.assign(new Error(m.error.message), { rpc: m.error })) : p.res(m.result);
				}
			} else if (m.method === "session/update") {
				const u = m.params?.update ?? {};
				const n = { phase, kind: u.sessionUpdate, sid: m.params?.sessionId };
				if (typeof u.content?.text === "string") n.text = u.content.text;
				if (u.sessionUpdate === "usage_update") n.usage = { used: u.used, size: u.size };
				if (u.sessionUpdate === "tool_call" || u.sessionUpdate === "tool_call_update") {
					n.title = u.title ?? null;
					n.status = u.status ?? null;
					n.toolKind = u.kind ?? null;
					n.toolCallId = u.toolCallId;
					n.metaKeys = u._meta ? Object.keys(u._meta) : null;
					if (u._meta?.contextCompaction) n.contextCompaction = trunc(u._meta.contextCompaction, 300);
				}
				if (String(u.sessionUpdate).startsWith("compaction"))
					n.compaction = trunc(Object.fromEntries(Object.entries(u).filter(([k]) => k !== "content")), 400);
				notes.push(n);
			} else if (m.method && m.id !== undefined) {
				L("agent-request", { label, method: m.method });
				if (m.method === "session/request_permission")
					send({ jsonrpc: "2.0", id: m.id, result: { outcome: { outcome: "cancelled" } } });
				else send({ jsonrpc: "2.0", id: m.id, error: { code: -32601, message: "probe: not supported" } });
			} else if (m.method) L("agent-notification", { label, method: m.method });
		}
	});
	const exited = new Promise((r) =>
		child.on("exit", (code, signal) => {
			exit = { code, signal };
			r();
		}),
	);
	const rpc = (method, params, ms = 60000) =>
		new Promise((res, rej) => {
			const id = nextId++;
			const t = setTimeout(() => {
				pending.delete(id);
				rej(new Error(`${method} timed out ${ms}ms`));
			}, ms);
			pending.set(id, {
				res: (v) => {
					clearTimeout(t);
					res(v);
				},
				rej: (e) => {
					clearTimeout(t);
					rej(e);
				},
			});
			send({ jsonrpc: "2.0", id, method, params });
		});
	const kill = async () => {
		const rec = { label };
		try {
			process.kill(-child.pid, "SIGTERM");
		} catch {}
		await Promise.race([exited, sleep(6000)]);
		if (!exit) {
			try {
				process.kill(-child.pid, "SIGKILL");
				rec.escalated = true;
			} catch {}
			await Promise.race([exited, sleep(2000)]);
		}
		rec.exit = exit;
		const t0 = Date.now();
		const marks = B.name === "claude" ? [500, 3000, 10000] : [500, 3000];
		rec.scans = {};
		for (const ms of marks) {
			await sleep(Math.max(0, ms - (Date.now() - t0)));
			rec.scans[`${ms}ms`] = { group: groupMembers(child.pid), underRun: underRun() };
		}
		L("reaped", rec);
		B.reclaim.push(rec);
		return rec;
	};
	const conn = { setSessionConfigOption: (p) => rpc("session/set_config_option", p, 30000) };
	return {
		label,
		rpc,
		notes,
		setPhase: (p) => {
			phase = p;
		},
		kill,
		conn,
	};
}

// ---- digests ----
const runLength = (arr) =>
	arr.reduce((a, k) => {
		if (a.length && a[a.length - 1][0] === k) a[a.length - 1][1]++;
		else a.push([k, 1]);
		return a;
	}, []);
function digest(notes, phase) {
	const ns = notes.filter((n) => n.phase === phase);
	const kinds = {};
	for (const n of ns) kinds[n.kind] = (kinds[n.kind] ?? 0) + 1;
	const text = {};
	for (const n of ns) if (n.text) text[n.kind] = (text[n.kind] ?? "") + n.text;
	return {
		kinds,
		sequence: runLength(ns.map((n) => n.kind)),
		textHead: Object.fromEntries(Object.entries(text).map(([k, v]) => [k, v.slice(0, 200)])),
		textChars: Object.fromEntries(Object.entries(text).map(([k, v]) => [k, v.length])),
		tools: ns
			.filter((n) => n.kind === "tool_call" || n.kind === "tool_call_update")
			.map((n) => ({
				kind: n.kind,
				title: n.title,
				status: n.status,
				toolKind: n.toolKind,
				id: n.toolCallId,
				metaKeys: n.metaKeys,
				contextCompaction: n.contextCompaction,
			})),
		compaction: ns.filter((n) => n.compaction).map((n) => n.compaction),
		usage: ns.filter((n) => n.usage).map((n) => n.usage),
		sessionIds: [...new Set(ns.map((n) => n.sid))],
	};
}
const cfgOf = (r) =>
	Object.fromEntries(
		(r?.configOptions ?? [])
			.filter((o) => ["model", "effort", "thought_level", "mode"].includes(o.id))
			.map((o) => [o.id, o.currentValue]),
	);
const errOf = (e) => ({ message: e.message, rpc: e.rpc ?? null });

async function init(c, version = 1) {
	return c.rpc(
		"initialize",
		{ protocolVersion: version, clientCapabilities: CAPS, clientInfo: { name: "entwurf-171-probe", version: "0" } },
		30000,
	);
}
const sessParams = (B, extra) =>
	B.meta === undefined
		? { cwd: scratch, mcpServers: [], ...extra }
		: { cwd: scratch, mcpServers: [], _meta: B.meta, ...extra };

async function openWith(B, c, method, sid, phase) {
	c.setPhase(phase);
	const t0 = Date.now();
	try {
		const r = await c.rpc(method, sessParams(B, { sessionId: sid }), 120000);
		c.setPhase(`${phase}:after`);
		await sleep(2500);
		return {
			ok: true,
			ms: Date.now() - t0,
			keys: Object.keys(r ?? {}),
			sessionId: r?.sessionId,
			config: cfgOf(r),
			window: digest(c.notes, phase),
			after: digest(c.notes, `${phase}:after`),
		};
	} catch (e) {
		c.setPhase(`${phase}:after`);
		return { ok: false, ms: Date.now() - t0, error: errOf(e), window: digest(c.notes, phase) };
	}
}
const listState = (B) => {
	const out = [];
	const walk = (d) => {
		if (!existsSync(d)) return;
		for (const e of readdirSync(d)) {
			const p = join(d, e);
			const s = lstatSync(p);
			if (s.isDirectory()) walk(p);
			else out.push([p.slice(B.stateDir.length + 1), s.size]);
		}
	};
	walk(B.stateDir);
	return out.filter(
		([p]) =>
			!p.includes("/builtin/") &&
			!p.includes("/log/") &&
			!p.endsWith("antigravity-oauth-token") &&
			!p.startsWith("backups/"),
	);
};
const sessionFiles = (B, sid) => listState(B).filter(([p]) => p.includes(sid));

// ---- backends ----
function claudeBackend() {
	const stateDir = ov.CLAUDE_CONFIG_OVERLAY_DIR;
	ov.ensureClaudeConfigOverlay(REAL_CLAUDE, stateDir);
	const config = resolveProviderConfig({
		cwd: scratch,
		adapter: BA.claudeAdapter,
		globalSettingsPath: join(RUN, "absent-g.json"),
		projectSettingsPath: join(RUN, "absent-p.json"),
	});
	const carrier = BA.claudeAdapter.loadCarrier({ mcpServerNames: mcpServerNames(config), config });
	const launch = BA.claudeAdapter.resolveLaunch({ nativeModelId: "claude-sonnet-5-5", config });
	const SRC = join(REPO, "pi-extensions/lib/acp/claude-acp-launch.js");
	return {
		name: "claude",
		adapter: BA.claudeAdapter,
		model: "claude-sonnet-5-5",
		thinking: "low",
		thinkingId: "effort",
		command: launch.command,
		args: launch.args.map((a) => claudeLauncherArg(a, SRC)),
		env: { ...process.env, ...BA.claudeAdapter.launchEnvDefaults() },
		meta: BA.claudeAdapter.buildSessionMeta(
			{ modelId: "claude-sonnet-5-5", nativeModelId: "claude-sonnet-5-5", config },
			carrier,
		),
		stateDir,
		reclaim: [],
		items: {},
	};
}
function agyBackend() {
	const stateDir = join(RUN, "home/.pi/agent/agy-gemini-overlay");
	ov.ensureAgyGeminiOverlay(
		REAL_GEMINI,
		stateDir,
		[],
		BA.agyAcpHookCommand(
			process.execPath,
			join(REPO, "pi-extensions/lib/acp/agy-acp-hook.mjs"),
			BA.AGY_HOOK_POLICY_HIDDEN_TURNS,
		),
	);
	const config = resolveProviderConfig({
		cwd: scratch,
		adapter: BA.agyAdapter,
		globalSettingsPath: join(RUN, "absent-g.json"),
		projectSettingsPath: join(RUN, "absent-p.json"),
	});
	const carrier = BA.agyAdapter.loadCarrier({ mcpServerNames: mcpServerNames(config), config });
	return {
		name: "agy",
		adapter: BA.agyAdapter,
		model: "gemini-3.8-flash",
		thinking: "low",
		thinkingId: "thought_level",
		command: agyBin(),
		args: BA.agyLaunchArgs(stateDir),
		env: { ...process.env },
		meta: BA.agyAdapter.buildSessionMeta({}, carrier),
		stateDir,
		reclaim: [],
		items: {},
	};
}

async function item(B, name, fn) {
	B.items[name] = {};
	const rec = B.items[name];
	try {
		await fn(rec);
	} catch (e) {
		rec.fatal = errOf(e);
		L("item-fatal", { backend: B.name, name, ...rec.fatal });
	}
	save();
}

async function listIds(c) {
	try {
		const r = await c.rpc("session/list", { cwd: scratch }, 30000);
		return { ok: true, ids: (r?.sessions ?? []).map((x) => x.sessionId), nextCursor: r?.nextCursor ?? null };
	} catch (e) {
		return { ok: false, ...errOf(e) };
	}
}
async function probeAfter(B, tag, sid) {
	const c = startChild(B, `${tag}-check`);
	await init(c);
	const out = { list: await listIds(c) };
	if (sid) out.resume = await openWith(B, c, "session/resume", sid, "resume");
	out.files = sid ? sessionFiles(B, sid) : null;
	out.reclaim = await c.kill();
	return out;
}
async function runBackend(B) {
	summary.backends[B.name] = { model: B.model, command: B.command, args: B.args, items: B.items, reclaim: B.reclaim };
	await item(B, "baselineList", async (rec) => {
		const c = startChild(B, "list0");
		await init(c);
		rec.list = await listIds(c);
		rec.files = listState(B).length;
		await c.kill();
	});
	// S-late: response arrives, nobody closes, child killed (today's Entwurf teardown without close)
	await item(B, "S-late", async (rec) => {
		const c = startChild(B, "late");
		await init(c);
		const t0 = Date.now();
		const r = await c.rpc("session/new", sessParams(B, {}), 60000);
		rec.newMs = Date.now() - t0;
		rec.sid = r.sessionId;
		rec.listSameChild = await listIds(c);
		rec.filesBeforeKill = sessionFiles(B, rec.sid);
		await c.kill();
		rec.after = await probeAfter(B, "late", rec.sid);
	});
	// S-late-close: response arrives, client sends session/close (Zed's abandoned-new path), then kill
	await item(B, "S-late-close", async (rec) => {
		const c = startChild(B, "lateclose");
		await init(c);
		const r = await c.rpc("session/new", sessParams(B, {}), 60000);
		rec.sid = r.sessionId;
		try {
			rec.close = { ok: true, result: trunc(await c.rpc("session/close", { sessionId: rec.sid }, 30000), 200) };
		} catch (e) {
			rec.close = { ok: false, ...errOf(e) };
		}
		rec.listAfterClose = await listIds(c);
		await c.kill();
		rec.after = await probeAfter(B, "lateclose", rec.sid);
	});
	// S-kill: abort before the response — Entwurf's bootstrap abort (group SIGTERM, backend.ts:2174)
	await item(B, "S-kill", async (rec) => {
		const c = startChild(B, "kill");
		await init(c);
		const before = new Set(listState(B).map(([p]) => p));
		const killAt = Math.max(100, Math.floor((B.items["S-late"]?.newMs ?? 1000) / 3));
		rec.killAtMs = killAt;
		let answered = null;
		const p = c.rpc("session/new", sessParams(B, {}), 60000).then(
			(r) => {
				answered = { ok: true, sid: r?.sessionId };
			},
			(e) => {
				answered = { ok: false, message: e.message };
			},
		);
		await sleep(killAt);
		rec.answeredBeforeKill = answered;
		rec.reclaim = await c.kill();
		await Promise.race([p, sleep(1000)]);
		rec.answeredAfterKill = answered;
		rec.newStateFiles = listState(B)
			.filter(([q]) => !before.has(q))
			.map(([q, n]) => [q, n]);
		rec.after = await probeAfter(B, "kill", answered?.sid ?? null);
	});
}

for (const [name, make] of [
	["claude", claudeBackend],
	["agy", agyBackend],
]) {
	if (ONLY && ONLY !== name) continue;
	const B = make();
	await runBackend(B);
	save();
}
summary.mtimeAfter = { agyToken: mt(TOKEN), claudeCred: mt(CLAUDE_CRED) };
summary.underRunAtEnd = underRun();
save();
console.log("done");
