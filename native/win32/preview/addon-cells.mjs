// Windows preview addon cells (#78): L0, L0c, R1, R2, T1, N1 against the INSTALLED package bytes.
//
//   node addon-cells.mjs <installed package dir> <work dir> <results.jsonl>
//
// Every cell uses own disposable fixtures under <work dir> and own pipe servers in this
// process; nothing outside them is touched. Each cell records its raw observations and one
// verdict (PASS | RED | INCOMPLETE). The results file and its sha256 are written before the
// verdict line; the exit code is 0 only when every cell PASSES. Never shipped (check-pack
// refuses native/win32/), never run on a consumer machine.

import { execFileSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import * as fs from "node:fs";
import * as net from "node:net";
import * as path from "node:path";
import { pathToFileURL } from "node:url";

const [pkg, work, resultsPath] = process.argv.slice(2);
if (!pkg || !work || !resultsPath) {
	console.error("usage: node addon-cells.mjs <installed package dir> <work dir> <results.jsonl>");
	process.exit(2);
}
fs.mkdirSync(work, { recursive: true });
const lib = (f) => import(pathToFileURL(path.join(pkg, "pi-extensions", "lib", f)).href);
const loader = await lib("win32-native.js");
// The compiled copies a consumer's bridge and record reader actually run.
const distDir = path.join(pkg, "mcp", "entwurf-bridge", "dist", "pi-extensions", "lib");
const distLib = (f) => import(pathToFileURL(path.join(distDir, f)).href);
const grammar = await lib("control-socket-path.js");
const rows = [];
const GID = "20261018T120000-abcdef";

const codeOf = (fn) => {
	try {
		fn();
		return null;
	} catch (err) {
		return err?.code ?? `uncoded:${err?.name}`;
	}
};
const codeOfAsync = async (p) => {
	try {
		await p;
		return null;
	} catch (err) {
		return err?.code ?? `uncoded:${err?.name}`;
	}
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pipeName = (tag) => `\\\\.\\pipe\\entwurf-preview-${tag}-${randomBytes(4).toString("hex")}`;

function listen(name, onConnection) {
	return new Promise((resolve, reject) => {
		const server = net.createServer(onConnection);
		server.once("error", reject);
		server.listen(name, () => {
			server.removeListener("error", reject);
			resolve(server);
		});
	});
}
const close = (server) => new Promise((r) => server.close(() => r()));

async function cell(name, body) {
	const row = { cell: name, verdict: "RED", observed: {} };
	try {
		const verdict = await body(row.observed);
		row.verdict = verdict;
	} catch (err) {
		row.observed.fault = `${err?.name}:${err?.code ?? ""}:${String(err?.message).slice(0, 200)}`;
	}
	rows.push(row);
}

// ---- loader: the installed package verifies and loads its own addon
let addon = null;
await cell("L0-load", async (o) => {
	addon = loader.win32Native();
	// napi_define_properties with napi_default makes non-enumerable own properties, so the
	// surface is read as OWN names (never the prototype); Object.keys is an observation only.
	const expected = ["ioStats", "pipeProbe", "pipeRpc", "readNoFollow"];
	o.ownNames = Object.getOwnPropertyNames(addon).sort();
	o.enumerableKeys = Object.keys(addon).sort();
	o.types = Object.fromEntries(expected.map((n) => [n, Object.hasOwn(addon, n) ? typeof addon[n] : "missing"]));
	o.ioStats = addon.ioStats();
	return JSON.stringify(o.ownNames) === JSON.stringify(expected) && expected.every((n) => o.types[n] === "function")
		? "PASS"
		: "RED";
});

// ---- L0c: the COMPILED loader resolves the same installed root, manifest and addon, and the
// compiled record reader reaches the addon through its win32-only createRequire hop.
await cell("L0c-compiled", async (o) => {
	const real = (p) => fs.realpathSync.native(p);
	const distLoader = await distLib("win32-native.js");
	o.sourceRoot = loader.win32NativePackageRoot() === null ? null : real(loader.win32NativePackageRoot()) === real(pkg);
	o.compiledRoot =
		distLoader.win32NativePackageRoot() === null ? null : real(distLoader.win32NativePackageRoot()) === real(pkg);
	const viaSource = loader.verifyWin32NativeAt(pkg);
	const viaCompiled = distLoader.verifyWin32NativeAt(distLoader.win32NativePackageRoot());
	o.sameAddonPath = real(viaCompiled.addonPath) === real(path.join(pkg, "native", "win32-x64", "entwurf_win.node"));
	o.sameSha = viaCompiled.sha256 === viaSource.sha256;
	o.sameSlot = distLoader.win32Native() === addon;
	const metaSession = await distLib("meta-session.js");
	const dir = path.join(work, "l0c");
	fs.mkdirSync(dir, { recursive: true });
	const nonce = randomBytes(16).toString("hex");
	const record = path.join(dir, `${GID}.json`);
	fs.writeFileSync(record, nonce);
	o.compiledReaderBytes = metaSession.readStoreRecordFile(record) === nonce;
	const link = path.join(dir, "20261018T120009-abcdef.json");
	try {
		fs.symlinkSync(record, link, "file");
		o.compiledReaderLink = codeOf(() => metaSession.readStoreRecordFile(link));
	} catch (err) {
		o.linkCreateError = err?.code ?? String(err);
		return "INCOMPLETE";
	}
	const ok =
		o.sourceRoot === true &&
		o.compiledRoot === true &&
		o.sameAddonPath &&
		o.sameSha &&
		o.sameSlot &&
		o.compiledReaderBytes &&
		o.compiledReaderLink === "ELOOP";
	return ok ? "PASS" : "RED";
});

// ---- R1: record reader outcomes on one handle each
await cell("R1-reader", async (o) => {
	const dir = path.join(work, "r1");
	fs.mkdirSync(dir, { recursive: true });
	const nonce = randomBytes(16).toString("hex");
	const regular = path.join(dir, `${GID}.json`);
	fs.writeFileSync(regular, nonce);
	const t0 = process.hrtime.bigint();
	let bytes = null;
	for (let i = 0; i < 100; i++) bytes = loader.win32ReadNoFollow(regular);
	o.perCallMicros = Number((process.hrtime.bigint() - t0) / 100n / 1000n);
	o.regular = bytes?.toString("utf8") === nonce;
	const target = path.join(dir, "target.json");
	fs.writeFileSync(target, "target bytes");
	const link = path.join(dir, "20261018T120001-abcdef.json");
	const junction = path.join(dir, "20261018T120002-abcdef.json");
	const subdir = path.join(dir, "subdir");
	fs.mkdirSync(subdir);
	try {
		fs.symlinkSync(target, link, "file");
		fs.symlinkSync(subdir, junction, "junction");
	} catch (err) {
		o.linkCreateError = err?.code ?? String(err);
		return "INCOMPLETE";
	}
	o.symlink = codeOf(() => loader.win32ReadNoFollow(link));
	o.junction = codeOf(() => loader.win32ReadNoFollow(junction));
	o.directory = codeOf(() => loader.win32ReadNoFollow(subdir));
	o.missing = codeOf(() => loader.win32ReadNoFollow(path.join(dir, "20261018T120003-abcdef.json")));
	o.pipePathPrecondition = codeOf(() => addon.readNoFollow("\\\\.\\pipe\\anything"));
	o.verbatimPrecondition = codeOf(() => addon.readNoFollow(`\\\\?\\${regular}`));
	o.dosDevice = codeOf(() => loader.win32ReadNoFollow(path.join(dir, "CON")));
	const big = path.join(dir, "20261018T120004-abcdef.json");
	fs.writeFileSync(big, Buffer.alloc(16 * 1024 * 1024 + 1, 0x20));
	o.overCap = codeOf(() => loader.win32ReadNoFollow(big));
	const exact = path.join(dir, "20261018T120005-abcdef.json");
	fs.writeFileSync(exact, Buffer.alloc(16 * 1024 * 1024, 0x20));
	o.atCapLength = loader.win32ReadNoFollow(exact).length;
	const ok =
		o.regular &&
		o.symlink === "ELOOP" &&
		o.junction === "ELOOP" &&
		o.directory === "ENTWURF_ENOTREG" &&
		o.missing === "ENOENT" &&
		o.pipePathPrecondition === "EINVAL" &&
		o.verbatimPrecondition === "EINVAL" &&
		o.dosDevice === "ENTWURF_ENOTREG" &&
		o.overCap === "EFBIG" &&
		o.atCapLength === 16 * 1024 * 1024;
	return ok ? "PASS" : "RED";
});

// ---- R2: a final symlink to an own pipe is refused without connecting
await cell("R2-no-follow-to-pipe", async (o) => {
	const name = pipeName("r2");
	let connections = 0;
	const server = await listen(name, (s) => {
		connections++;
		s.destroy();
	});
	try {
		const link = path.join(work, "r2", `${GID}.json`);
		fs.mkdirSync(path.dirname(link), { recursive: true });
		try {
			fs.symlinkSync(name, link, "file");
		} catch (err) {
			o.linkCreateError = err?.code ?? String(err);
			return "INCOMPLETE";
		}
		const t0 = Date.now();
		o.code = codeOf(() => loader.win32ReadNoFollow(link));
		o.ms = Date.now() - t0;
		await sleep(500);
		o.connections = connections;
		return o.code === "ELOOP" && o.ms < 2000 && o.connections === 0 ? "PASS" : "RED";
	} finally {
		await close(server);
	}
});

// ---- T1: a server that never replies times out within budget; resources come back; next call is healthy
await cell("T1-timeout-reclaim", async (o) => {
	// Which expected-owner branch this run can match (booleans only, no SID). adminRoleObserved is a
	// role observation (IsInRole), not proof of the C TokenIsElevated branch; a pass on the hosted
	// admin image is not user-SID privacy.
	try {
		o.token = JSON.parse(
			execFileSync(
				"pwsh",
				[
					"-NoProfile",
					"-Command",
					"$i=[Security.Principal.WindowsIdentity]::GetCurrent(); $p=New-Object Security.Principal.WindowsPrincipal($i); " +
						"@{ownerIsUser=($i.Owner.Value -eq $i.User.Value); ownerIsAdministrators=($i.Owner.Value -eq 'S-1-5-32-544'); " +
						"adminRoleObserved=$p.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)} | ConvertTo-Json -Compress",
				],
				{ encoding: "utf8", timeout: 30000 },
			),
		);
	} catch (err) {
		o.token = { error: err?.code ?? String(err) };
	}
	const silent = pipeName("t1-silent");
	const held = [];
	const silentServer = await listen(silent, (s) => {
		held.push(s);
		s.on("data", () => {});
	});
	const echo = pipeName("t1-echo");
	const echoServer = await listen(echo, (s) => {
		let buf = "";
		s.setEncoding("utf8");
		s.on("data", (chunk) => {
			buf += chunk;
			const nl = buf.indexOf("\n");
			if (nl >= 0) s.end(`${JSON.stringify({ type: "response", command: "echo", echoed: buf.slice(0, nl) })}\n`);
		});
	});
	try {
		const budget = 1000;
		const t0 = Date.now();
		o.timeoutCode = await codeOfAsync(addon.pipeRpc(silent, '{"type":"echo"}', budget));
		o.timeoutMs = Date.now() - t0;
		o.statsAtTimeout = addon.ioStats();
		const t1 = Date.now();
		let stats = addon.ioStats();
		while ((stats.cancelledIncomplete !== 0 || stats.live !== 0) && Date.now() - t1 < 5000) {
			await sleep(25);
			stats = addon.ioStats();
		}
		o.reclaimMs = Date.now() - t1;
		o.statsAfter = stats;
		const nonce = randomBytes(8).toString("hex");
		const reply = await addon.pipeRpc(echo, JSON.stringify({ type: "echo", nonce }), 5000);
		o.nextOk = JSON.parse(reply.responseLine).echoed === JSON.stringify({ type: "echo", nonce });
		o.nextServerPidIsSelf = reply.serverPid === process.pid;
		o.probe = await addon.pipeProbe(echo, 2000).then(
			(r) => r.serverPid === process.pid,
			(e) => e?.code,
		);
		o.probeAbsent = await codeOfAsync(addon.pipeProbe(pipeName("t1-absent"), 500));
		const ok =
			o.timeoutCode === "ETIMEDOUT" &&
			o.timeoutMs >= budget - 50 &&
			o.timeoutMs <= budget + 750 &&
			o.statsAfter.cancelledIncomplete === 0 &&
			o.statsAfter.live === 0 &&
			o.nextOk &&
			o.nextServerPidIsSelf &&
			o.probe === true &&
			o.probeAbsent === "ENOENT";
		return ok ? "PASS" : "RED";
	} finally {
		for (const s of held) s.destroy();
		await close(silentServer);
		await close(echoServer);
		o.finalStats = addon.ioStats();
	}
});

// ---- N1: name stability and loader refusals (a pre-existing-name birth refusal is B1, unmeasured here)
await cell("N1-names-and-refusals", async (o) => {
	const store = path.join(work, "n1-home", ".pi", "entwurf-control");
	o.dirExistedBefore = fs.existsSync(store);
	const before = grammar.controlSocketPathIn(store, GID);
	fs.mkdirSync(store, { recursive: true });
	const after = grammar.controlSocketPathIn(store, GID);
	const respelled = grammar.controlSocketPathIn(`${store.toUpperCase()}\\`, GID);
	o.before = before;
	o.sameAfterCreate = before === after;
	o.sameRespelled = before === respelled;

	const absentRoot = path.join(work, "n1-absent");
	fs.mkdirSync(absentRoot, { recursive: true });
	o.absent = codeOf(() => loader.verifyWin32NativeAt(absentRoot));
	const driftRoot = path.join(work, "n1-drift");
	fs.cpSync(path.join(pkg, "native", "win32-x64"), path.join(driftRoot, "native", "win32-x64"), { recursive: true });
	const addonFile = path.join(driftRoot, "native", "win32-x64", "entwurf_win.node");
	const bytes = fs.readFileSync(addonFile);
	bytes[bytes.length - 1] ^= 1;
	fs.writeFileSync(addonFile, bytes);
	o.drift = codeOf(() => loader.verifyWin32NativeAt(driftRoot));

	const name = pipeName("n1-squat");
	const squatter = await listen(name, (s) => s.destroy());
	try {
		// Observation only, not in the verdict: a second Node listen on a name this process holds.
		// That is libuv's FIRST_PIPE_INSTANCE, not the addon, not owner refusal, not a birth proof.
		o.nodeSecondListen = await listen(name, () => {}).then(
			async (s) => {
				await close(s);
				return null;
			},
			(e) => e?.code ?? String(e),
		);
	} finally {
		await close(squatter);
	}
	const ok =
		!o.dirExistedBefore &&
		o.sameAfterCreate &&
		o.sameRespelled &&
		o.absent === "ENTWURF_WIN32_UNSUPPORTED" &&
		o.drift === "ENTWURF_WIN32_NATIVE_DRIFT";
	return ok ? "PASS" : "RED";
});

const body = `${rows.map((r) => JSON.stringify(r)).join("\n")}\n`;
fs.writeFileSync(resultsPath, body);
console.log(body);
console.log(`results sha256 ${createHash("sha256").update(body).digest("hex")}`);
const all = rows.every((r) => r.verdict === "PASS");
for (const r of rows) console.log(`addon ${r.cell}: ${r.verdict}`);
console.log(`addon cells: ${all ? "PASS" : "NOT ACCEPTED"}`);
process.exit(all ? 0 : 1);
