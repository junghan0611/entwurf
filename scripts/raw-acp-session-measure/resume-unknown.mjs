// #171 — session/resume of an unknown id, Claude ACP and agy (R2 unknown-id). Zero prompts. NOT a gate.
// Launch through run.sh beside this (LIVE=1, sandboxed HOME/XDG/PI_CODING_AGENT_DIR, run dir outside the repo).
import { execFileSync, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { appendFileSync, existsSync, lstatSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
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

const ov = await import(join(D, "overlay.js"));
const { claudeAdapter, agyLaunchArgs, agyAcpHookCommand, AGY_HOOK_POLICY_HIDDEN_TURNS } = await import(
	join(D, "backend-adapter.js")
);
const { resolveProviderConfig, mcpServerNames } = await import(join(D, "config.js"));
const summary = { mtimeBefore: { agyToken: mt(TOKEN), claudeCred: mt(CLAUDE_CRED) }, runs: {} };
const scratch = join(RUN, "scratch-cwd");
mkdirSync(scratch, { recursive: true });
const listFiles = (dir) => {
	const out = [];
	const walk = (d) => {
		if (!existsSync(d)) return;
		for (const e of readdirSync(d)) {
			const p = join(d, e);
			const s = lstatSync(p);
			if (s.isDirectory()) walk(p);
			else out.push(p.slice(dir.length + 1));
		}
	};
	walk(dir);
	return out;
};

function startChild(label, command, args, env) {
	const child = spawn(command, args, { cwd: scratch, env, stdio: ["pipe", "pipe", "pipe"], detached: true });
	child.stderr.on("data", (b) => appendFileSync(join(RUN, `${label}.stderr.log`), b));
	const pending = new Map();
	const notes = [];
	let phase = "pre";
	let id = 1;
	let buf = "";
	let exit = null;
	const send = (o) => {
		const s = JSON.stringify(o) + "\n";
		appendFileSync(join(RUN, `${label}.wire-out.ndjson`), s);
		child.stdin.write(s);
	};
	child.stdout.on("data", (b) => {
		appendFileSync(join(RUN, `${label}.wire-in.ndjson`), b);
		buf += b.toString();
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
			if (m.id !== undefined && !m.method) {
				const p = pending.get(m.id);
				if (p) {
					pending.delete(m.id);
					m.error ? p.rej(Object.assign(new Error(m.error.message), { rpc: m.error })) : p.res(m.result);
				}
			} else if (m.method === "session/update") notes.push({ phase, kind: m.params?.update?.sessionUpdate });
			else if (m.method && m.id !== undefined)
				send({ jsonrpc: "2.0", id: m.id, error: { code: -32601, message: "probe: not supported" } });
		}
	});
	const exited = new Promise((r) =>
		child.on("exit", (code, signal) => {
			exit = { code, signal };
			r();
		}),
	);
	const rpc = (method, params, ms) =>
		new Promise((res, rej) => {
			const n = id++;
			const t = setTimeout(() => {
				pending.delete(n);
				rej(new Error(`${method} timed out ${ms}ms`));
			}, ms);
			pending.set(n, {
				res: (v) => {
					clearTimeout(t);
					res(v);
				},
				rej: (e) => {
					clearTimeout(t);
					rej(e);
				},
			});
			send({ jsonrpc: "2.0", id: n, method, params });
		});
	const scan = () => {
		try {
			return execFileSync("ps", ["-eo", "pid=,pgid=,stat=,comm="], { encoding: "utf8" })
				.split("\n")
				.filter((l) => l.trim().split(/\s+/)[1] === String(child.pid))
				.join("\n");
		} catch {
			return "ps-failed";
		}
	};
	const kill = async () => {
		try {
			process.kill(-child.pid, "SIGTERM");
		} catch {}
		await Promise.race([exited, new Promise((r) => setTimeout(r, 6000))]);
		if (!exit) {
			try {
				process.kill(-child.pid, "SIGKILL");
			} catch {}
			await exited;
		}
		await new Promise((r) => setTimeout(r, 500));
		const imm = scan();
		await new Promise((r) => setTimeout(r, 3000));
		return { exit, leftoverImmediate: imm, leftoverAfter3s: scan() };
	};
	return {
		rpc,
		notes,
		setPhase: (p) => {
			phase = p;
		},
		kill,
	};
}
const caps = { session: { compaction: {} } };
const init = (c) =>
	c.rpc(
		"initialize",
		{ protocolVersion: 1, clientCapabilities: caps, clientInfo: { name: "entwurf-171-probe", version: "0" } },
		30000,
	);
const cfgVal = (r, id) => (r?.configOptions ?? []).find((o) => o.id === id)?.currentValue;

async function one(label, command, args, env, meta, stateDir) {
	summary.runs[label] = {};
	const R = summary.runs[label];
	const before = new Set(listFiles(stateDir));
	const c = startChild(label, command, args, env);
	try {
		await init(c);
		const bogus = randomUUID();
		R.bogus = bogus;
		c.setPhase("resume");
		const t0 = Date.now();
		try {
			const r = await c.rpc(
				"session/resume",
				{ sessionId: bogus, cwd: scratch, mcpServers: [], ...(meta ? { _meta: meta } : {}) },
				60000,
			);
			R.ms = Date.now() - t0;
			R.result = {
				ok: true,
				keys: Object.keys(r ?? {}),
				sessionId: r?.sessionId,
				sameId: r?.sessionId === bogus,
				model: cfgVal(r, "model"),
				effortOrThought: cfgVal(r, "effort") ?? cfgVal(r, "thought_level"),
			};
		} catch (e) {
			R.ms = Date.now() - t0;
			R.result = { ok: false, message: e.message, rpc: e.rpc ?? null };
		}
		c.setPhase("after");
		await new Promise((r) => setTimeout(r, 2500));
		R.updatesInWindow = c.notes.filter((n) => n.phase === "resume").map((n) => n.kind);
		R.updatesAfter = c.notes.filter((n) => n.phase === "after").map((n) => n.kind);
	} catch (e) {
		R.fatal = e.message;
	}
	R.reclaim = await c.kill();
	R.newStateFiles = listFiles(stateDir).filter(
		(p) => !before.has(p) && !p.endsWith("antigravity-oauth-token") && !p.includes("/log/") && !p.includes("/builtin/"),
	);
}

// Claude
const claudeOverlay = ov.CLAUDE_CONFIG_OVERLAY_DIR;
ov.ensureClaudeConfigOverlay(REAL_CLAUDE, claudeOverlay);
const cCfg = resolveProviderConfig({
	cwd: scratch,
	adapter: claudeAdapter,
	globalSettingsPath: join(RUN, "absent-g.json"),
	projectSettingsPath: join(RUN, "absent-p.json"),
});
const cMeta = claudeAdapter.buildSessionMeta(
	{ modelId: "claude-sonnet-5-5", nativeModelId: "claude-sonnet-5-5", config: cCfg },
	claudeAdapter.loadCarrier({ mcpServerNames: mcpServerNames(cCfg), config: cCfg }),
);
const cl = claudeAdapter.resolveLaunch({ nativeModelId: "claude-sonnet-5-5", config: cCfg });
const SRC_LAUNCHER = join(REPO, "pi-extensions/lib/acp/claude-acp-launch.js");
const cArgs = cl.args.map((a) => claudeLauncherArg(a, SRC_LAUNCHER));
await one("claude", cl.command, cArgs, { ...process.env, ...claudeAdapter.launchEnvDefaults() }, cMeta, claudeOverlay);

// agy
const agyOverlay = join(RUN, "home/.pi/agent/agy-gemini-overlay");
ov.ensureAgyGeminiOverlay(
	REAL_GEMINI,
	agyOverlay,
	[],
	agyAcpHookCommand(
		process.execPath,
		join(REPO, "pi-extensions/lib/acp/agy-acp-hook.mjs"),
		AGY_HOOK_POLICY_HIDDEN_TURNS,
	),
);
const { agyAdapter } = await import(join(D, "backend-adapter.js"));
const aCfg = resolveProviderConfig({
	cwd: scratch,
	adapter: agyAdapter,
	globalSettingsPath: join(RUN, "absent-g.json"),
	projectSettingsPath: join(RUN, "absent-p.json"),
});
const aMeta = agyAdapter.buildSessionMeta(
	{},
	agyAdapter.loadCarrier({ mcpServerNames: mcpServerNames(aCfg), config: aCfg }),
);
await one("agy", agyBin(), agyLaunchArgs(agyOverlay), { ...process.env }, aMeta, agyOverlay);

summary.mtimeAfter = { agyToken: mt(TOKEN), claudeCred: mt(CLAUDE_CRED) };
writeFileSync(join(RUN, "summary.json"), JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary, null, 2));
