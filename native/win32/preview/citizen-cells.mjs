// Windows preview citizen cells (#78): B1 (two installed Pi citizens) and D1 (one garden-id v2
// nonce delivery A → B) against the INSTALLED package and the INSTALLED pinned Pi CLI.
//
//   node citizen-cells.mjs <pi cli.js> <installed package dir> <work dir> <results.jsonl> <sandbox root>
//
// The profile roots (HOME, USERPROFILE, APPDATA, LOCALAPPDATA, PI_CODING_AGENT_DIR) are the
// caller's sandbox, declared explicitly as <sandbox root> (home = <sandbox root>/home) and checked
// before anything is installed or spawned. Entwurf is wired the way a user wires it: `pi install <package dir>`, then
// `pi --entwurf-control`. The only fixture is the model: a `-e` extension registers a pi-ai
// fauxProvider through pi.registerProvider, with scripted responses and no network. Records,
// control pipes, the bridge, peer-facts and the v2 send are the product's own. Every child is
// this process's own and is ended through its own handle. The results file and its sha256 are
// written before the verdict. Never shipped (check-pack refuses native/win32/).

import { spawn, spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { pathToFileURL } from "node:url";

const [piCli, pkg, work, resultsPath, sandboxRoot] = process.argv.slice(2);
if (!piCli || !pkg || !work || !resultsPath || !sandboxRoot || !path.isAbsolute(sandboxRoot)) {
	console.error(
		"usage: node citizen-cells.mjs <pi cli.js> <installed package dir> <work dir> <results.jsonl> <absolute sandbox root>",
	);
	process.exit(2);
}
fs.mkdirSync(work, { recursive: true });
const agentDir = process.env.PI_CODING_AGENT_DIR;
if (!agentDir || !path.isAbsolute(agentDir)) {
	console.error("PI_CODING_AGENT_DIR must be the caller's absolute sandbox");
	process.exit(2);
}
const META_DIR = path.join(agentDir, "meta-sessions");
const PROVIDER = "entwurf-preview-faux";
const V2_TOOL = "mcp__entwurf_bridge__entwurf_v2";
const lib = (f) => import(pathToFileURL(path.join(pkg, "pi-extensions", "lib", f)).href);
const native = await lib("win32-native.js");
const grammar = await lib("control-socket-path.js");
const distLib = (f) =>
	import(pathToFileURL(path.join(pkg, "mcp", "entwurf-bridge", "dist", "pi-extensions", "lib", f)).href);
const distMeta = await distLib("meta-session.js");
// The product's own liveness probe (on Windows it is the addon's owner-validated pipeProbe).
const { probeSocketLiveness } = await distLib("socket-probe.js");
const rows = [];
const cap = (s, n = 4000) => (typeof s === "string" && s.length > n ? `${s.slice(0, n)}…[${s.length}]` : s);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sha = (b) => createHash("sha256").update(b).digest("hex");

// ---- the model fixture: one -e extension per citizen, responses scripted, all evidence to files
const fauxSource = (model, kind) => `// Fixture model for ${model} (#78 preview). Not product code.
import * as fs from "node:fs";
import { fauxAssistantMessage, fauxProvider, fauxText, fauxToolCall, getCurrentTools } from "@earendil-works/pi-ai";
const here = new URL(".", import.meta.url);
const log = (name, value) => fs.appendFileSync(new URL(name, here), JSON.stringify(value) + "\\n");
const textOf = (messages) =>
	messages
		.flatMap((m) => (Array.isArray(m.content) ? m.content : typeof m.content === "string" ? [{ type: "text", text: m.content }] : []))
		.filter((c) => c && c.type === "text")
		.map((c) => c.text)
		.join("\\n");
export default function (pi) {
	const faux = fauxProvider({ provider: ${JSON.stringify(PROVIDER)}, models: [{ id: ${JSON.stringify(model)} }] });
	${
		kind === "sender"
			? `const send = (ctx) => {
		const tools = getCurrentTools(ctx.messages).map((t) => t.name);
		const plan = JSON.parse(fs.readFileSync(new URL("plan-a.json", here), "utf8"));
		log("a-model.jsonl", { step: "send", tools });
		if (!tools.includes(${JSON.stringify(V2_TOOL)})) return fauxAssistantMessage([fauxText("no v2 tool")]);
		return fauxAssistantMessage(
			[fauxToolCall(${JSON.stringify(V2_TOOL)}, { target: plan.target, intent: "fire-and-forget", message: plan.message }, { id: "preview-d1-send" })],
			{ stopReason: "toolUse" },
		);
	};
	const after = (ctx) => {
		log("a-model.jsonl", { step: "after", text: textOf(ctx.messages.slice(-2)).slice(0, 4000) });
		return fauxAssistantMessage([fauxText("sent")]);
	};
	faux.setResponses([send, after]);`
			: `const receive = (ctx) => {
		log("b-model.jsonl", { step: "receive", text: textOf(ctx.messages).slice(-8000) });
		return fauxAssistantMessage([fauxText("received")]);
	};
	faux.setResponses([receive, receive, receive, receive]);`
	}
	log(${JSON.stringify(kind === "sender" ? "a-model.jsonl" : "b-model.jsonl")}, { step: "factory", fauxProvider: typeof fauxProvider });
	pi.registerProvider(faux.provider);
}
`;

// ---- an own Pi RPC child: LF-only framing, every record kept, ended through its own handle
function startPi(name, model, extension, cwd) {
	fs.mkdirSync(cwd, { recursive: true });
	const args = [piCli, "--mode", "rpc", "--entwurf-control", "-e", extension, "--model", `${PROVIDER}/${model}`];
	const child = spawn(process.execPath, args, { cwd, stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
	const pi = { name, child, records: [], stderr: "", waiters: [], exit: null, spawnError: null, stdinError: null };
	let buf = "";
	// setEncoding: a StringDecoder, so a multi-byte character split across chunks stays whole.
	child.stdout.setEncoding("utf8");
	child.stderr.setEncoding("utf8");
	child.on("error", (err) => {
		pi.spawnError = `${err?.code ?? ""}:${cap(String(err?.message), 300)}`;
	});
	// A write or end racing the child's exit (EPIPE, destroyed stream) is evidence, never a crash.
	child.stdin.on("error", (err) => {
		pi.stdinError = `${err?.code ?? ""}:${cap(String(err?.message), 300)}`;
	});
	child.stdout.on("data", (d) => {
		buf += d;
		for (let i = buf.indexOf("\n"); i >= 0; i = buf.indexOf("\n")) {
			const line = buf.slice(0, i).replace(/\r$/, "");
			buf = buf.slice(i + 1);
			if (!line.trim()) continue;
			let rec;
			try {
				rec = JSON.parse(line);
			} catch {
				rec = { unparsed: cap(line, 400) };
			}
			pi.records.push(rec);
			for (const w of pi.waiters.slice()) if (w.match(rec)) w.resolve(rec);
		}
	});
	child.stderr.on("data", (d) => {
		pi.stderr = cap(pi.stderr + d, 20000);
	});
	child.on("exit", (code, signal) => {
		pi.exit = { code, signal };
	});
	pi.send = (cmd) => {
		if (!pi.exit && !pi.spawnError && !pi.stdinError && child.stdin.writable)
			child.stdin.write(`${JSON.stringify(cmd)}\n`);
	};
	pi.wait = (match, ms, what) =>
		new Promise((resolve, reject) => {
			const hit = pi.records.find(match);
			if (hit) return resolve(hit);
			const w = { match, resolve: (r) => (clearTimeout(t), pi.waiters.splice(pi.waiters.indexOf(w), 1), resolve(r)) };
			const t = setTimeout(() => {
				pi.waiters.splice(pi.waiters.indexOf(w), 1);
				reject(new Error(`${name}: ${what} not seen within ${ms} ms`));
			}, ms);
			pi.waiters.push(w);
		});
	pi.request = async (cmd, ms) => {
		const id = `${name}-${cmd.type}-${randomBytes(3).toString("hex")}`;
		pi.send({ ...cmd, id });
		const res = await pi.wait((r) => r.type === "response" && r.id === id, ms, `response to ${cmd.type}`);
		if (res.success !== true) throw new Error(`${name}: ${cmd.type} refused: ${cap(String(res.error), 300)}`);
		return res;
	};
	return pi;
}

async function stopPi(pi) {
	const waitExit = (ms) =>
		new Promise((resolve) => {
			if (pi.exit) return resolve(true);
			const t = setTimeout(() => resolve(false), ms);
			pi.child.once("exit", () => (clearTimeout(t), resolve(true)));
		});
	try {
		pi.child.stdin.end();
	} catch {}
	let gone = await waitExit(15000);
	let killed = false;
	if (!gone) {
		killed = true;
		try {
			pi.child.kill();
		} catch {}
		gone = await waitExit(5000);
	}
	return {
		gone,
		killed,
		exit: pi.exit,
		spawnError: pi.spawnError,
		stdinError: pi.stdinError,
		stderrTail: cap(pi.stderr.slice(-2000), 2000),
	};
}

const readJsonl = (f) =>
	fs.existsSync(f)
		? fs
				.readFileSync(f, "utf8")
				.split("\n")
				.filter(Boolean)
				.map((l) => JSON.parse(l))
		: [];

function recordFor(nativeSessionId) {
	const files = fs.existsSync(META_DIR) ? fs.readdirSync(META_DIR).filter((f) => f.endsWith(".meta.json")) : [];
	const mine = [];
	for (const f of files) {
		const bytes = fs.readFileSync(path.join(META_DIR, f));
		const body = JSON.parse(bytes.toString("utf8"));
		if (body.nativeSessionId === nativeSessionId) mine.push({ file: f, body, sha: sha(bytes) });
	}
	return { total: files.length, mine };
}

// ---- run
const nonce = `entwurf-preview-nonce-${randomBytes(12).toString("hex")}`;
const b1 = { cell: "B1-installed-citizens", verdict: "RED", observed: {} };
const d1 = { cell: "D1-v2-nonce-delivery", verdict: "RED", observed: { nonce } };
const procs = [];
const pipes = [];
// Set once, never cleared: a run that reached the bound is NOT ACCEPTED whatever the main flow does
// while teardown runs.
let timedOut = false;
const deadline = setTimeout(() => {
	timedOut = true;
	console.error("citizen cells: 300 s harness bound reached");
	finish();
}, 300000);
let finishing = null;

function finish() {
	finishing ??= finishOnce();
	return finishing;
}

async function finishOnce() {
	clearTimeout(deadline);
	// The verdicts as they stand NOW; nothing the main flow does after this point reaches the file.
	const final = [structuredClone(b1), structuredClone(d1)];
	const [fb1] = final;
	const red = (row, why) => {
		row.verdict = "RED";
		row.observed.faults = [...(row.observed.faults ?? []), why];
	};
	if (timedOut) for (const row of final) red(row, "harness bound reached (300 s)");
	// Teardown: graceful EOF is the contract under test; a forced kill is not a pass.
	const teardown = {};
	for (const pi of procs) teardown[pi.name] = await stopPi(pi);
	fb1.observed.teardown = teardown;
	for (const [n, t] of Object.entries(teardown)) {
		if (!t.gone) red(fb1, `${n} did not exit`);
		if (t.killed) red(fb1, `${n} needed a forced kill (graceful EOF exit is the contract)`);
		if (t.spawnError) red(fb1, `${n} spawn error ${t.spawnError}`);
		if (t.stdinError) red(fb1, `${n} stdin error ${t.stdinError}`);
	}
	// After both exited, their record-derived control addresses must be dead (product probe).
	fb1.observed.postExit = {};
	for (const { name, pipe } of pipes) {
		const liveness = await probeSocketLiveness(pipe, { timeoutMs: 3000 }).catch((e) => `error:${e?.code ?? e}`);
		fb1.observed.postExit[name] = liveness;
		if (liveness !== "dead") red(fb1, `${name} control address is ${liveness} after exit`);
	}
	fb1.observed.unmeasured = [
		"descendant (bridge) cleanup after a forced kill",
		"own pre-existing-name birth refusal (N1 birth negative), deferred for the first preview",
	];
	rows.push(...final);
	const body = `${rows.map((r) => JSON.stringify(r)).join("\n")}\n`;
	fs.writeFileSync(resultsPath, body);
	console.log(body);
	console.log(`results sha256 ${sha(body)}`);
	for (const r of rows) console.log(`citizen ${r.cell}: ${r.verdict}`);
	const all = rows.every((r) => r.verdict === "PASS");
	console.log(`citizen cells: ${all ? "PASS" : "NOT ACCEPTED"}`);
	process.exit(all ? 0 : 1);
}

try {
	// The sandbox is DECLARED by the caller, never derived from the env being checked. Every profile
	// root this run can write through must sit inside it, and the home must be <root>/home.
	const win = process.platform === "win32";
	const norm = (p) => (win ? path.resolve(p).toLowerCase() : path.resolve(p));
	const inside = (p) => typeof p === "string" && p !== "" && norm(p).startsWith(norm(sandboxRoot) + path.sep);
	const roots = {
		homedir: os.homedir(),
		HOME: process.env.HOME,
		PI_CODING_AGENT_DIR: agentDir,
		...(win
			? { USERPROFILE: process.env.USERPROFILE, APPDATA: process.env.APPDATA, LOCALAPPDATA: process.env.LOCALAPPDATA }
			: {}),
	};
	const outside = Object.entries(roots)
		.filter(([, v]) => !inside(v))
		.map(([k]) => k);
	const expectedHome = path.join(sandboxRoot, "home");
	b1.observed.paths = {
		pkg,
		piCli,
		sandboxRoot,
		expectedHome,
		roots,
		rootsChecked: Object.keys(roots),
		outside,
		metaDir: META_DIR,
		pkgInNodeModules: pkg.split(/[\\/]/).includes("node_modules"),
	};
	if (outside.length > 0) throw new Error(`profile roots outside the declared sandbox: ${outside.join(", ")}`);
	if (norm(os.homedir()) !== norm(expectedHome)) throw new Error("os.homedir() is not <sandbox root>/home");
	if (win && !b1.observed.paths.pkgInNodeModules)
		throw new Error("on Windows the package must be the installed one under node_modules");
	// Wiring, the way a user wires it.
	const install = spawnSync(process.execPath, [piCli, "install", pkg], {
		encoding: "utf8",
		timeout: 180000,
		cwd: work,
		windowsHide: true,
	});
	b1.observed.install = {
		status: install.status,
		error: install.error?.code ?? null,
		stdout: cap(install.stdout, 1500),
		stderr: cap(install.stderr, 1500),
	};
	const version = spawnSync(process.execPath, [piCli, "--version"], { encoding: "utf8", timeout: 60000 });
	b1.observed.piVersion = (version.stdout ?? "").trim();
	if (install.status !== 0) throw new Error("pi install of the installed package failed");
	b1.observed.install.namesPkg = (install.stdout ?? "").includes(pkg);
	if (!b1.observed.install.namesPkg) throw new Error("pi install did not name the package path it was given");

	const extB = path.join(work, "b", "faux-b.mjs");
	const extA = path.join(work, "a", "faux-a.mjs");
	fs.mkdirSync(path.dirname(extB), { recursive: true });
	fs.mkdirSync(path.dirname(extA), { recursive: true });
	fs.writeFileSync(extB, fauxSource("faux-b", "receiver"));
	fs.writeFileSync(extA, fauxSource("faux-a", "sender"));

	const B = startPi("B", "faux-b", extB, path.join(work, "b", "cwd"));
	procs.push(B);
	const A = startPi("A", "faux-a", extA, path.join(work, "a", "cwd"));
	procs.push(A);

	// B1 — each citizen: get_state, its one V3 record, the record-derived pipe, the addon read.
	const citizens = {};
	for (const pi of [B, A]) {
		await sleep(1500);
		const state = (await pi.request({ type: "get_state" }, 90000)).data ?? {};
		const nativeSessionId = state.sessionId;
		let rec = recordFor(nativeSessionId);
		for (let i = 0; i < 40 && rec.mine.length === 0; i++) {
			await sleep(250);
			rec = recordFor(nativeSessionId);
		}
		const o = { nativeSessionId, model: state.model?.id ?? null, records: rec.total, claims: rec.mine.length };
		citizens[pi.name] = o;
		o.extensionErrors = pi.records.filter((r) => r.type === "extension_error").map((r) => cap(JSON.stringify(r), 600));
		if (rec.mine.length !== 1) continue;
		const { file, body } = rec.mine[0];
		o.gardenId = body.gardenId;
		o.recordSha = rec.mine[0].sha;
		o.fileIsGid = file === `${body.gardenId}.meta.json`;
		o.v3pi = body.schemaVersion === 3 && body.backend === "pi";
		o.gidMinted = /^\d{8}T\d{6}-[0-9a-f]{6}$/.test(body.gardenId) && body.gardenId !== nativeSessionId;
		o.addonReadEqual =
			distMeta.readStoreRecordFile(path.join(META_DIR, file)) === fs.readFileSync(path.join(META_DIR, file), "utf8");
		o.pipe = grammar.controlSocketPathIn(grammar.defaultControlSocketDir(os.homedir()), body.gardenId);
		pipes.push({ name: pi.name, pipe: o.pipe });
		o.liveness = await probeSocketLiveness(o.pipe, { timeoutMs: 3000 });
		if (process.platform === "win32") {
			// Observation only: which process serves the record-derived pipe.
			o.pipeServer = await native
				.win32Native()
				.pipeProbe(o.pipe, 3000)
				.then(
					(r) => ({ serverPidIsChild: r.serverPid === pi.child.pid }),
					(e) => ({ code: e?.code ?? String(e) }),
				);
		}
	}
	b1.observed.citizens = citizens;
	b1.observed.homedir = os.homedir();
	const peers = spawnSync(
		process.execPath,
		[path.join(pkg, "mcp", "entwurf-bridge", "dist", "scripts", "peer-facts.js")],
		{ encoding: "utf8", timeout: 60000, windowsHide: true },
	);
	let peerRows = [];
	let peerParse = false;
	try {
		peerRows = JSON.parse(peers.stdout).peers;
		peerParse = Array.isArray(peerRows);
	} catch {}
	if (!peerParse) peerRows = [];
	b1.observed.peerFacts = {
		status: peers.status,
		parsed: peerParse,
		rows: peerRows
			.filter((p) => [citizens.A?.gardenId, citizens.B?.gardenId].includes(p.gardenId))
			.map((p) => ({ gardenId: p.gardenId, backend: p.backend, liveness: p.liveness })),
		stderr: cap(peers.stderr, 600),
	};
	const cit = (n) => citizens[n] ?? {};
	const citizenOk = (n) =>
		cit(n).claims === 1 &&
		cit(n).fileIsGid &&
		cit(n).v3pi &&
		cit(n).gidMinted &&
		cit(n).addonReadEqual &&
		cit(n).liveness === "alive" &&
		cit(n).model === `faux-${n.toLowerCase()}` &&
		cit(n).extensionErrors.length === 0;
	const peersAlive =
		b1.observed.peerFacts.status === 0 &&
		peerParse &&
		["A", "B"].every((n) =>
			b1.observed.peerFacts.rows.some(
				(p) => p.gardenId === cit(n).gardenId && p.liveness === "alive" && p.backend === "pi",
			),
		);
	b1.observed.publication =
		"one V3 record per citizen, readable through the addon; the link (create) and rename (update) calls are not directly observed";
	b1.verdict =
		citizenOk("A") && citizenOk("B") && cit("A").gardenId !== cit("B").gardenId && peersAlive ? "PASS" : "RED";

	// D1 — A's model calls the real entwurf_v2 tool toward B's gid with the nonce.
	if (b1.verdict === "PASS") {
		fs.writeFileSync(
			path.join(work, "a", "plan-a.json"),
			JSON.stringify({ target: cit("B").gardenId, message: `D1 delivery check ${nonce}` }),
		);
		const sent = await A.request({ type: "prompt", message: "deliver the preview nonce" }, 60000);
		d1.observed.promptResponse = { success: sent.success === true, data: sent.data ?? null };
		await A.wait((r) => r.type === "agent_settled", 120000, "A agent_settled");
		const toolEnds = A.records.filter((r) => r.type === "tool_execution_end");
		d1.observed.aModel = readJsonl(path.join(work, "a", "a-model.jsonl"));
		d1.observed.aToolEnds = toolEnds.map((r) => ({
			toolName: r.toolName,
			isError: r.isError === true,
			text: cap(
				(r.result?.content ?? [])
					.filter((c) => c.type === "text")
					.map((c) => c.text)
					.join("\n"),
				2000,
			),
		}));
		const CALL_ID = "preview-d1-send";
		const start = A.records.find((r) => r.type === "tool_execution_start" && r.toolCallId === CALL_ID);
		const end = toolEnds.find((r) => r.toolCallId === CALL_ID);
		const endText = (end?.result?.content ?? [])
			.filter((c) => c.type === "text")
			.map((c) => c.text)
			.join("\n");
		const sendStep = d1.observed.aModel.find((x) => x.step === "send");
		d1.observed.aCall = {
			started: Boolean(start),
			toolName: start?.toolName ?? null,
			argsTargetIsB: start?.args?.target === cit("B").gardenId,
			argsMessageHasNonce: typeof start?.args?.message === "string" && start.args.message.includes(nonce),
			toolInDeclaredList: Array.isArray(sendStep?.tools) && sendStep.tools.includes(V2_TOOL),
			ended: Boolean(end),
			isError: end?.isError === true,
			boundary:
				/control-socket → (sent|queued-steer|queued-follow-up|accepted-unknown-boundary)\b/.exec(endText)?.[1] ?? null,
			text: cap(endText, 2000),
		};
		const c = d1.observed.aCall;
		d1.observed.aReceipt =
			sent.success === true &&
			c.started &&
			c.toolName === V2_TOOL &&
			c.argsTargetIsB &&
			c.argsMessageHasNonce &&
			c.toolInDeclaredList &&
			c.ended &&
			!c.isError &&
			c.boundary !== null;

		// B: its model saw the nonce, and its transcript holds it. Receipt != consumption.
		let bModel = [];
		for (let i = 0; i < 120; i++) {
			bModel = readJsonl(path.join(work, "b", "b-model.jsonl"));
			if (bModel.some((x) => x.step === "receive" && x.text.includes(nonce))) break;
			await sleep(250);
		}
		d1.observed.bModelSawNonce = bModel.some((x) => x.step === "receive" && x.text.includes(nonce));
		d1.observed.bModelSteps = bModel.map((x) => x.step);
		if (d1.observed.bModelSawNonce)
			await B.wait((r) => r.type === "agent_settled", 60000, "B agent_settled").catch(() => {});
		const bState = (await B.request({ type: "get_state" }, 30000)).data ?? {};
		const sessionFile = typeof bState.sessionFile === "string" ? path.resolve(bState.sessionFile) : null;
		const sessionsRoot = path.resolve(agentDir, "sessions");
		const t = { sessionFile, contained: false, headerIsB: false, inbound: null };
		if (sessionFile && sessionFile.startsWith(sessionsRoot + path.sep) && fs.existsSync(sessionFile)) {
			t.contained = true;
			const entries = fs
				.readFileSync(sessionFile, "utf8")
				.split("\n")
				.filter(Boolean)
				.map((l) => {
					try {
						return JSON.parse(l);
					} catch {
						return null;
					}
				});
			t.headerIsB = entries[0]?.type === "session" && entries[0]?.id === cit("B").nativeSessionId;
			const flat = (content) =>
				typeof content === "string"
					? content
					: Array.isArray(content)
						? content.map((x) => (x?.type === "text" ? x.text : "")).join("\n")
						: "";
			// Credit only the control receiver's own inbound entry: pi.sendMessage with customType
			// "entwurf-message" (entwurf-control.ts), as Pi persisted it. Its content must carry the nonce
			// and the sender_info naming A's garden id. A nonce in tool or metadata JSON does not count.
			const senderOf = (text) => {
				const m = /<sender_info>(.*?)<\/sender_info>/s.exec(text);
				try {
					return m ? JSON.parse(m[1]).sessionId : null;
				} catch {
					return null;
				}
			};
			const inbound = entries
				.map((e) =>
					e?.type === "custom_message" && e.customType === "entwurf-message"
						? { shape: "custom_message", text: flat(e.content) }
						: e?.type === "message" && e.message?.customType === "entwurf-message"
							? { shape: `message:${e.message?.role}`, text: flat(e.message?.content) }
							: null,
				)
				.filter(Boolean);
			t.inboundEntries = inbound.length;
			const hit = inbound.find((x) => x.text.includes(nonce));
			if (hit) t.inbound = { shape: hit.shape, senderIsA: senderOf(hit.text) === cit("A").gardenId };
		}
		d1.observed.bTranscript = t;
		d1.observed.bTranscriptHasNonce = t.contained && t.headerIsB && t.inbound?.senderIsA === true;
		// Post-D1 record facts: still one claim per native id, the compiled addon read equals the disk.
		const after = {};
		for (const n of ["A", "B"]) {
			const r = recordFor(cit(n).nativeSessionId);
			const one = r.mine.length === 1 ? r.mine[0] : null;
			after[n] = {
				claims: r.mine.length,
				addonReadEqual: one
					? distMeta.readStoreRecordFile(path.join(META_DIR, one.file)) ===
						fs.readFileSync(path.join(META_DIR, one.file), "utf8")
					: false,
				changed: one ? one.sha !== cit(n).recordSha : null,
			};
		}
		d1.observed.recordsAfter = after;
		const recordsHold = ["A", "B"].every((n) => after[n].claims === 1 && after[n].addonReadEqual);
		d1.verdict =
			d1.observed.aReceipt && d1.observed.bModelSawNonce && d1.observed.bTranscriptHasNonce && recordsHold
				? "PASS"
				: "RED";
	} else {
		d1.verdict = "INCOMPLETE";
		d1.observed.reason = "B1 did not pass";
	}
} catch (err) {
	const row = b1.verdict === "PASS" ? d1 : b1;
	row.verdict = "RED";
	row.observed.fault = `${err?.name}:${err?.code ?? ""}:${cap(String(err?.message), 400)}`;
}
await finish();
