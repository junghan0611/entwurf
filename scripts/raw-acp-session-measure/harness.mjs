// Raw JSON-RPC child harness for continuity.mjs (#171 step 7). NOT a gate; in no check tier.
// A parameterised copy of the experiments.mjs harness. experiments.mjs and z5.mjs keep their own copies
// unchanged, because the stored R1–R10 runs are the comparator's oracle for those exact probes.
// Differences from that copy:
// - permission requests get the production approve-all answer (backend.ts `resolvePermissionResponse`),
//   because U12 and U17 need a writing tool; every agent request and the answer given are recorded;
// - the endings U21 compares are named: the production teardown, a group SIGKILL, an agent-only
//   SIGKILL, and an orphan (the client closes its pipes and sends no signal);
// - reaping is verified: a child counts as reaped only when its leader has exited and no live member
//   of its process group is left. The group is signalled even after the leader exits. A child whose
//   reaping cannot be verified stays on `unverifiedReaps()`, and continuity.mjs then exits non-zero.
import { execFileSync, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { appendFileSync, existsSync, lstatSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { RUN } from "./common.mjs";
import { sweep, TOKEN_NAME, underDir } from "./sweep.mjs";

export const scratch = join(RUN, "scratch-cwd");
mkdirSync(scratch, { recursive: true });
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const EV = join(RUN, "events.jsonl");
export const L = (k, v = {}) => appendFileSync(EV, `${JSON.stringify({ t: new Date().toISOString(), k, ...v })}\n`);
const CAPS = { session: { compaction: {} } };
const trunc = (v, n = 400) => {
	const s = JSON.stringify(v);
	return s === undefined ? null : s.length > n ? `${s.slice(0, n)}…` : s;
};
export const errOf = (e) => ({ message: e.message, rpc: e.rpc ?? null });
export const cfgOf = (r) =>
	Object.fromEntries(
		(r?.configOptions ?? [])
			.filter((o) => ["model", "effort", "thought_level", "mode"].includes(o.id))
			.map((o) => [o.id, o.currentValue]),
	);

/** backend.ts `resolvePermissionResponse`: allow_once or allow_always, else the first option; none → cancelled. */
function approve(params) {
	const options = Array.isArray(params?.options) ? params.options : [];
	if (options.length === 0) return { outcome: { outcome: "cancelled" } };
	const allow = options.find((o) => o.kind === "allow_once" || o.kind === "allow_always");
	return { outcome: { outcome: "selected", optionId: (allow ?? options[0]).optionId } };
}

/**
 * Every child is started with this run's token in its environment, and its descendants inherit it. Only
 * a process carrying it is ever killed at the end (sweep.mjs): a shell an operator opened inside the run
 * directory has the same cwd but not the token. Under run.sh the token is the one run.sh set, so its own
 * post-probe sweep finds the same processes.
 */
const RUN_TOKEN = process.env[TOKEN_NAME] ?? randomUUID();
/** What is left at the end: owned (killed) and foreign (reported). See sweep.mjs. */
export const survivors = () => sweep(RUN, RUN_TOKEN);
/** Processes (other than this one) whose cwd is the run directory or below it, as pids. */
export const underRun = () => underDir(RUN);
/** Members of one process group: `live` excludes zombies. `null` when `ps` failed (then nothing is verified). */
function groupMembers(pgid) {
	if (!pgid) return { live: [], zombies: [] };
	let text;
	try {
		text = execFileSync("ps", ["-eo", "pid=,pgid=,stat=,comm="], { encoding: "utf8" });
	} catch {
		return null;
	}
	const rows = text
		.split("\n")
		.map((l) => l.trim().split(/\s+/))
		.filter((f) => f[1] === String(pgid));
	return {
		live: rows.filter((f) => !f[2]?.startsWith("Z")).map((f) => `${f[0]} ${f[3]}`),
		zombies: rows.filter((f) => f[2]?.startsWith("Z")).map((f) => `${f[0]} ${f[3]}`),
	};
}
const alive = (pid) => {
	if (!pid) return false;
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
};

let childSeq = 0;
/** Every child whose reaping is not verified yet, so a row that throws cannot leak a detached agent. */
const openChildren = new Set();
const unverified = [];
/** Reap every child still open (a row's fatal path, a signal, and the end of a run). */
export async function reapAll() {
	for (const c of [...openChildren]) await c.end("normal");
}
/** Labels of the children whose reaping could not be verified. */
export const unverifiedReaps = () => [...unverified];
let closed = false;
/** After this, startChild throws: a run that is finishing cannot gain a child it will not reap. */
export const closeHarness = () => {
	closed = true;
};

/** Spawn one ACP child. `env` overrides the backend's environment; `command`/`args` override its launch. */
export function startChild(B, tag, { env, command, args } = {}) {
	if (closed) throw new Error(`the harness is closed; ${tag} was not started`);
	const label = `${B.name}-${String(++childSeq).padStart(2, "0")}-${tag}`;
	const child = spawn(command ?? B.command, args ?? B.args, {
		cwd: scratch,
		env: { ...(env ?? B.env), [TOKEN_NAME]: RUN_TOKEN },
		stdio: ["pipe", "pipe", "pipe"],
		detached: true,
	});
	child.stderr.on("data", (b) => appendFileSync(join(RUN, `${label}.stderr.log`), b));
	child.stdin.on("error", () => {});
	const pending = new Map();
	const notes = [];
	const agentRequests = [];
	let phase = "pre";
	let nextId = 1;
	let buf = "";
	let exit = null;
	let spawnError = null;
	const send = (o) => {
		const s = `${JSON.stringify(o)}\n`;
		appendFileSync(join(RUN, `${label}.wire-out.ndjson`), s);
		if (!child.stdin.destroyed && child.stdin.writable) child.stdin.write(s);
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
				if (u.sessionUpdate === "tool_call" || u.sessionUpdate === "tool_call_update") {
					n.title = u.title ?? null;
					n.status = u.status ?? null;
					n.toolCallId = u.toolCallId;
					if (u.rawInput !== undefined) n.input = trunc(u.rawInput, 600);
				}
				// #175: the occupancy a usage_update reports, for the probes that compare it across a compaction.
				if (u.sessionUpdate === "usage_update") {
					n.used = u.used ?? null;
					n.size = u.size ?? null;
				}
				if (String(u.sessionUpdate).startsWith("compaction"))
					n.compaction = trunc(Object.fromEntries(Object.entries(u).filter(([k]) => k !== "content")), 400);
				notes.push(n);
			} else if (m.method && m.id !== undefined) {
				L("agent-request", { label, method: m.method });
				if (m.method === "session/request_permission") {
					const result = approve(m.params);
					const chosen = m.params?.options?.find((o) => o.optionId === result.outcome.optionId);
					agentRequests.push({ phase, method: m.method, answer: chosen?.kind ?? result.outcome.outcome });
					send({ jsonrpc: "2.0", id: m.id, result });
				} else {
					agentRequests.push({ phase, method: m.method, answer: "refused -32601" });
					send({ jsonrpc: "2.0", id: m.id, error: { code: -32601, message: "probe: not supported" } });
				}
			}
		}
	});
	/** No answer can come any more: settle what is pending now, not at its timeout. `drain` travels
	 * with each rejection (see below), so a caller can tell a drained stream from a capped one. */
	const settleAll = (why, drainHow) => {
		for (const [id, p] of pending) {
			pending.delete(id);
			p.rej(Object.assign(new Error(why), { drain: drainHow }));
		}
	};
	// A frame the child wrote before it died may still be in the pipe when "exit" fires. Pending calls
	// are settled only after stdout has closed ("drained": every written frame was read), or after 2 s
	// ("capped": a surviving descendant holds the pipe open, so a frame may still be unread). Only
	// "drained" lets a caller conclude that no terminal frame came.
	let drain = null;
	let drainDone = Promise.resolve();
	const stdoutClosed = new Promise((r) => child.stdout.once("close", r));
	const exited = new Promise((r) => {
		child.on("exit", (code, signal) => {
			exit = { code, signal };
			r();
			drainDone = Promise.race([stdoutClosed.then(() => "drained"), sleep(2000).then(() => "capped")]).then((how) => {
				drain = how;
				settleAll(`child exited (${code ?? signal}); no answer by the end of its stdout (${how})`, how);
			});
		});
		child.on("error", (e) => {
			spawnError = { message: e.message, code: e.code ?? null };
			L("spawn-error", { label, ...spawnError });
			settleAll(`child failed: ${e.message}`, "not started");
			if (!child.pid) r(); // never started: no exit event will come
		});
	});
	const rpc = (method, params, ms = 60000) =>
		new Promise((res, rej) => {
			if (spawnError || exit) return rej(new Error(`${method}: the child is not running`));
			const id = nextId++;
			const t = setTimeout(() => {
				pending.delete(id);
				rej(new Error(`${method}: no answer within ${ms} ms`));
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
	const notify = (method, params) => send({ jsonrpc: "2.0", method, params });
	// The group is addressed by the leader's pid, which stays its pgid after the leader exits.
	const signalGroup = (sig) => {
		if (!child.pid) return;
		try {
			process.kill(-child.pid, sig);
		} catch {}
	};
	/** True once the leader has exited (or never started) and no live member of its group is left. */
	const groupGone = () => {
		if (!exit && !(spawnError && !child.pid)) return false;
		const g = groupMembers(child.pid);
		return g !== null && g.live.length === 0;
	};
	/** Reap whatever is left and verify it. Always the last call on a child. */
	const reap = async (how) => {
		const rec = { label, how };
		if (!groupGone()) {
			signalGroup("SIGTERM");
			if (!(await until(groupGone, 6000, 200))) {
				signalGroup("SIGKILL");
				rec.escalated = true;
				await until(groupGone, 3000, 200);
			}
		}
		await drainDone; // set at exit; bounded by the 2 s cap, so rec.drain is never left unset after an exit
		const g = groupMembers(child.pid);
		rec.exit = exit;
		rec.drain = drain;
		rec.spawnError = spawnError;
		rec.groupLeft = g === null ? "ps-failed" : g.live;
		rec.zombies = g?.zombies ?? null;
		rec.verified = groupGone();
		if (!rec.verified) unverified.push(label);
		B.reclaim.push(rec);
		L("reaped", rec);
		return rec;
	};
	const endings = {
		/** backend.ts `teardownChild`: SIGTERM the group, destroy stdio, SIGKILL the group after 2 s. */
		production: async () => {
			signalGroup("SIGTERM");
			for (const s of [child.stdin, child.stdout, child.stderr]) s?.destroy();
			await sleep(2000);
			signalGroup("SIGKILL");
			await Promise.race([exited, sleep(2000)]);
			return { leaderExit: exit };
		},
		groupKill: async () => {
			signalGroup("SIGKILL");
			await Promise.race([exited, sleep(2000)]);
			return { leaderExit: exit };
		},
		/** An INJECTED crash: SIGKILL of the agent process alone. Its group as left behind is recorded, then reaped. */
		agentKill: async () => {
			if (child.pid) {
				try {
					process.kill(child.pid, "SIGKILL");
				} catch {}
			}
			await Promise.race([exited, sleep(2000)]);
			const g = groupMembers(child.pid);
			return { leaderExit: exit, groupAfterAgentDeath: g === null ? "ps-failed" : g.live };
		},
		/** The client dies: its pipe ends close and no signal is sent. Reports whether the child outlives it. */
		orphan: async () => {
			for (const s of [child.stdin, child.stdout]) s?.destroy();
			await sleep(3000);
			return { aliveAfter3s: alive(child.pid) };
		},
	};
	let ended;
	const end = (how) => {
		ended ??= (async () => {
			const ending = how === "normal" ? undefined : await endings[how]();
			const rec = { ...(await reap(how)), ending };
			openChildren.delete(handle);
			return rec;
		})();
		return ended;
	};
	const conn = { setSessionConfigOption: (p) => rpc("session/set_config_option", p, 30000) };
	const handle = {
		label,
		pid: child.pid,
		rpc,
		notify,
		notes,
		agentRequests,
		setPhase: (p) => {
			phase = p;
		},
		end,
		/** The orphan ending WITHOUT the reap, so another child can resume while this one may live. */
		orphan: endings.orphan,
		conn,
		isAlive: () => alive(child.pid),
	};
	openChildren.add(handle);
	return handle;
}

export async function init(c) {
	return c.rpc(
		"initialize",
		{ protocolVersion: 1, clientCapabilities: CAPS, clientInfo: { name: "entwurf-171-probe", version: "0" } },
		30000,
	);
}

export const sessParams = (B, extra, { mcpServers = [], meta = B.meta } = {}) =>
	meta === undefined ? { cwd: scratch, mcpServers, ...extra } : { cwd: scratch, mcpServers, _meta: meta, ...extra };

/** Production enforceModel and enforceThinking, with every answer captured as readback. */
export async function enforce(B, c, sid, { thinking = true, model = B.model } = {}) {
	const answers = {};
	const wrap = {
		setSessionConfigOption: async (p) => {
			const a = await c.conn.setSessionConfigOption(p);
			answers[p.configId] = cfgOf(a);
			return a;
		},
	};
	const out = {};
	try {
		await B.adapter.enforceModel({ connection: wrap, acpSessionId: sid, nativeModelId: model, modelId: model });
		out.model = "accepted";
	} catch (e) {
		out.model = errOf(e);
	}
	if (thinking) {
		try {
			await B.adapter.enforceThinking({ connection: wrap, acpSessionId: sid, modelId: model, value: B.thinking });
			out.thinking = "accepted";
		} catch (e) {
			out.thinking = errOf(e);
		}
	}
	out.readback = answers;
	return out;
}

/** Notes of one phase, reduced to what the U-row facts read. */
export function digest(notes, phase) {
	const ns = notes.filter((n) => n.phase === phase);
	const text = {};
	for (const n of ns) if (n.text) text[n.kind] = (text[n.kind] ?? "") + n.text;
	const order = [];
	for (const n of ns) if (order.at(-1) !== n.kind) order.push(n.kind);
	return {
		order,
		text,
		tools: ns
			.filter((n) => n.kind === "tool_call" || n.kind === "tool_call_update")
			.map((n) => ({ title: n.title, status: n.status })),
		compactions: ns.filter((n) => n.compaction).length,
	};
}

/**
 * A load replay's cut turn: the notes between the user message carrying `marker` and the next user
 * message containing `nextHead` (the probe's own following prompt). Consecutive user chunks can be one
 * chunked message or two messages with nothing between them, which is exactly a cut turn, so the
 * boundary is the probe's known next prompt, never a chunk boundary. Returns the partial assistant text
 * length and the last status of each tool call in between; null when no user message carries `marker`.
 */
export function segmentAfter(notes, phase, marker, nextHead) {
	const ns = notes.filter((n) => n.phase === phase);
	let user = "";
	let start = -1;
	for (let i = 0; i < ns.length && start < 0; i++) {
		if (ns[i].kind !== "user_message_chunk") {
			user = "";
			continue;
		}
		user += ns[i].text ?? "";
		if (user.includes(marker)) start = i;
	}
	if (start < 0) return null;
	const tools = {};
	let agentChars = 0;
	let endedBy = "end of replay";
	for (const n of ns.slice(start + 1)) {
		if (n.kind === "user_message_chunk") {
			if ((n.text ?? "").includes(nextHead)) {
				endedBy = "next prompt";
				break;
			}
			continue; // the rest of the chunked cut message
		}
		if (n.kind === "agent_message_chunk") agentChars += (n.text ?? "").length;
		if (n.kind === "tool_call" || n.kind === "tool_call_update")
			tools[n.toolCallId] = n.status ?? tools[n.toolCallId] ?? null;
	}
	return { agentChars, toolStatuses: Object.values(tools), endedBy };
}

/**
 * Whether a failed call got a terminal frame: "error" is a JSON-RPC error response the agent sent; "none"
 * means none was read. Only "error" is an observed rejection.
 */
export const frameOf = (e) => (e?.rpc ? "error" : "none");
/**
 * Why a call without a frame settled: "drained" (the child exited and every byte of its stdout was
 * read), "capped" (it exited but its stdout stayed open past the 2 s cap: a frame may be unread),
 * "not started", or "timeout" / "not running" for a call that never reached an exit. null for a frame.
 */
export const drainOf = (e) =>
	e?.rpc ? null : (e?.drain ?? (/not running/.test(e?.message ?? "") ? "not running" : "timeout"));
/** Proven absence of a terminal frame: none was read AND the child's stdout was fully drained. */
export const noFrameProven = (p) => p?.frame === "none" && p.drain === "drained";
/** A call that got a terminal frame, result or error. */
export const answered = (p) => p?.ok === true || p?.frame === "error";
/** One `session/prompt`; `blocks` is a string or a list of content blocks. Never throws. Each result
 * carries `frame`: "result", "error" or "none" (see frameOf), and for "none" its `drain` (see drainOf). */
export function promptStart(c, sid, phase, blocks, ms = 300000) {
	c.setPhase(phase);
	const prompt = typeof blocks === "string" ? [{ type: "text", text: blocks }] : blocks;
	const t0 = Date.now();
	return c.rpc("session/prompt", { sessionId: sid, prompt }, ms).then(
		(r) => {
			c.setPhase(`${phase}:after`);
			const d = digest(c.notes, phase);
			return {
				ok: true,
				frame: "result",
				stopReason: r?.stopReason ?? null,
				usage: r?.usage ?? null,
				ms: Date.now() - t0,
				d,
			};
		},
		(e) => {
			c.setPhase(`${phase}:after`);
			const d = digest(c.notes, phase);
			return { ok: false, frame: frameOf(e), drain: drainOf(e), error: errOf(e), ms: Date.now() - t0, d };
		},
	);
}
export const prompt = (c, sid, phase, blocks, ms) => promptStart(c, sid, phase, blocks, ms);

/** `session/resume` or `session/load`; never throws. `echoedId` compares the answer's id with the one sent. */
export async function open(B, c, method, sid, phase, opts) {
	c.setPhase(phase);
	try {
		const r = await c.rpc(method, sessParams(B, { sessionId: sid }, opts), 120000);
		c.setPhase(`${phase}:after`);
		await sleep(2500);
		return {
			ok: true,
			frame: "result",
			sessionId: r?.sessionId,
			echoedId: r?.sessionId === undefined ? "omitted" : r.sessionId === sid ? "same" : "different",
			config: cfgOf(r),
			configOptions: r?.configOptions ?? [],
			window: digest(c.notes, phase),
		};
	} catch (e) {
		c.setPhase(`${phase}:after`);
		const window = digest(c.notes, phase);
		return { ok: false, frame: frameOf(e), drain: drainOf(e), error: errOf(e), code: e.rpc?.code ?? null, window };
	}
}

/** Wait until `test()` is true, polling every `every` ms; false on timeout. */
export async function until(test, ms, every = 100) {
	const t0 = Date.now();
	while (Date.now() - t0 < ms) {
		if (test()) return true;
		await sleep(every);
	}
	return test();
}

/** Files of an overlay (symlinks listed, never followed), without logs, builtins and the agy token link. */
export function stateFiles(dir) {
	return Object.keys(stateSnapshot(dir));
}
/** path → "size:mtimeMs" for every non-directory entry of an overlay; symlinks are lstat()ed, never followed. */
export function stateSnapshot(dir) {
	const out = {};
	const walk = (d) => {
		if (!existsSync(d)) return;
		for (const e of readdirSync(d)) {
			const p = join(d, e);
			const s = lstatSync(p);
			if (s.isDirectory()) walk(p);
			else out[p.slice(dir.length + 1)] = `${s.size}:${s.mtimeMs}`;
		}
	};
	walk(dir);
	for (const p of Object.keys(out))
		if (p.includes("/log/") || p.includes("/builtin/") || p.endsWith("antigravity-oauth-token")) delete out[p];
	return out;
}
/** What changed between two snapshots: entry names, and counts for the facts. */
export function stateDelta(before, after) {
	const added = Object.keys(after).filter((p) => !(p in before));
	const removed = Object.keys(before).filter((p) => !(p in after));
	const changed = Object.keys(after).filter((p) => p in before && before[p] !== after[p]);
	return { added, removed, changed, counts: [added.length, removed.length, changed.length] };
}

export const saveJson = (name, value) => writeFileSync(join(RUN, name), JSON.stringify(value, null, 2));
