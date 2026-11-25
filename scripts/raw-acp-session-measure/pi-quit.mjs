// #175 M4 — does a Pi resident that quits release the holder lease of its ACP session, and how does the Pi
// process end? NOT a gate.
//
//   LIVE=1 scripts/raw-acp-session-measure/run.sh pi-quit <out-dir> [claude|agy]
//
// One Pi (pi-host.mjs) answers one short turn, which births the vendor session and its lease, and is then
// quit by closing its stdin (rpc mode, as pi-smoke's quit). `ENTWURF_RAW_QUIT_VARIANT=compacted` puts a Pi
// compaction and one more turn before the quit (pi-smoke's order); `tui` runs Pi's interactive mode under
// `script` (a pty), types the prompt and `/quit`, and waits for the answer through the session record's
// seal. Pi runs with quit-trace.cjs, which writes `pi-1.quit-trace.ndjson`: whether Pi called process.exit
// or the loop drained first, and what was still active. `ENTWURF_RAW_QUIT_KEEPALIVE=1` adds one ref'd
// interval to Pi (the counterfactual). `ENTWURF_RAW_PI_CLI` (pi-host.mjs) selects another Pi runtime.
//
// The out-dir's length decides whether Pi's control socket can listen (a unix socket path is limited to
// 107 bytes): `pi-1.events.ndjson` / `pi-1.screen.log` show `listen EINVAL` when it could not, and then
// neither the socket server nor the MCP bridge child exists.
//
// Every observation goes to summary.json; exit 0 when the run reached its end, 3 when Pi could not be driven.
import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { REPO, RUN } from "./common.mjs";
import { AGENT, backend, launch, leases, MODEL, piCli, records, steps, TURN_MS } from "./pi-host.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const VARIANT = process.env.ENTWURF_RAW_QUIT_VARIANT ?? "plain";
if (VARIANT !== "plain" && VARIANT !== "compacted" && VARIANT !== "tui")
	throw new Error(`ENTWURF_RAW_QUIT_VARIANT must be plain, compacted or tui: ${VARIANT}`);
const KEEPALIVE = process.env.ENTWURF_RAW_QUIT_KEEPALIVE === "1";
const TRACE = join(RUN, "pi-1.quit-trace.ndjson");
const traceEnv = {
	NODE_OPTIONS: `--require ${join(HERE, "quit-trace.cjs")}`,
	ENTWURF_RAW_QUIT_TRACE: TRACE,
	...(KEEPALIVE ? { ENTWURF_RAW_QUIT_KEEPALIVE: "1" } : {}),
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(test, ms) {
	const end = Date.now() + ms;
	while (Date.now() < end) {
		if (test()) return true;
		await sleep(200);
	}
	return false;
}

/** Pi's interactive mode in a pty, driven by typing. */
function launchTui() {
	const piArgs = ["--no-extensions", "-e", "builtin:mcp", "-e", REPO, "--entwurf-control"];
	piArgs.push("--provider", "entwurf", "--model", MODEL);
	const argv = piCli ? [process.execPath, piCli, ...piArgs] : ["pi", ...piArgs];
	const quote = (a) => `'${a.replaceAll("'", `'\\''`)}'`;
	const child = spawn("script", ["-qfec", argv.map(quote).join(" "), "/dev/null"], {
		cwd: join(RUN, "work"),
		stdio: ["pipe", "pipe", "pipe"],
		detached: true,
		env: { ...process.env, ...traceEnv, TERM: "xterm-256color", COLUMNS: "120", LINES: "40" },
	});
	let screen = "";
	child.stdout.on("data", (d) => {
		screen += d;
	});
	child.stderr.on("data", (d) => {
		screen += d;
	});
	const exited = new Promise((resolve) => child.once("exit", (code, signal) => resolve({ code, signal })));
	const type = (text) => child.stdin.write(text);
	const quit = async () => {
		type("/quit\r");
		const timer = setTimeout(() => {
			try {
				process.kill(-child.pid, "SIGKILL");
			} catch {}
		}, 30_000);
		const end = await exited;
		clearTimeout(timer);
		writeFileSync(join(RUN, "pi-1.screen.log"), screen);
		return end;
	};
	return { type, quit };
}

const summary = { backend, model: MODEL, variant: VARIANT, keepalive: KEEPALIVE, piCli, steps, checks: {}, run: {} };
let status = 0;
try {
	let birthDone;
	if (VARIANT === "tui") {
		const a = launchTui();
		await sleep(5_000);
		a.type("Reply with exactly: OK");
		await sleep(500);
		a.type("\r");
		birthDone = await until(() => records().some((r) => typeof r.sealedTurnId === "string"), TURN_MS);
		await sleep(1_000);
		summary.run.leasesBeforeQuit = leases();
		const quitAt = Date.now();
		summary.run.quit = await a.quit();
		summary.run.quitMs = Date.now() - quitAt;
	} else {
		const a = launch(undefined, traceEnv);
		const t1 = await a.turn("birth", "Reply with exactly: OK");
		birthDone = t1.stopReason === "stop";
		if (VARIANT === "compacted") {
			const compacted = await a
				.command({ type: "compact" }, TURN_MS)
				.catch((error) => ({ success: false, error: String(error) }));
			summary.run.compact = { success: compacted.success === true, error: compacted.error ?? null };
			await a.turn("after-compaction", "Reply with exactly: AGAIN");
		}
		summary.run.leasesBeforeQuit = leases();
		const quitAt = Date.now();
		summary.run.quit = await a.quit();
		summary.run.quitMs = Date.now() - quitAt;
	}
	summary.run.records = records().map((r) => ({ acpSessionId: r.acpSessionId, sealedTurnId: r.sealedTurnId }));
	summary.run.leasesAfterQuit = leases();
	summary.run.leaseAfterQuit = summary.run.leasesAfterQuit.map((f) =>
		JSON.parse(readFileSync(join(AGENT, "entwurf-acp-holders", f), "utf8")),
	);
	const ps = spawnSync("ps", ["-eo", "pid,ppid,pgid,stat,etimes,args"], { encoding: "utf8" }).stdout;
	summary.run.groupsAfterQuit = summary.run.leaseAfterQuit.map((lease) =>
		ps
			.split("\n")
			.filter((l) => l.trim().split(/\s+/)[2] === String(lease.child?.pid))
			.map((l) => l.slice(0, 220)),
	);
	const trace = existsSync(TRACE)
		? readFileSync(TRACE, "utf8")
				.split("\n")
				.filter(Boolean)
				.map((l) => JSON.parse(l))
		: [];
	const first = (k) => trace.find((e) => e.k === k) ?? null;
	summary.run.trace = {
		processExit: first("process.exit"),
		beforeExit: first("beforeExit"),
		exit: first("exit"),
		lastSamples: (first("samples")?.samples ?? []).slice(-12),
	};
	const log = (name) => (existsSync(join(RUN, name)) ? readFileSync(join(RUN, name), "utf8") : "");
	summary.run.stderrBytes = log("pi-1.stderr.log").length;
	summary.run.controlSocketEinval = /listen EINVAL/.test(log("pi-1.events.ndjson") + log("pi-1.screen.log"));
	summary.checks = {
		birthDone,
		leaseHeldBeforeQuit: summary.run.leasesBeforeQuit.length === 1,
		leaseReleasedOnQuit: summary.run.leasesAfterQuit.length === 0,
		piCalledProcessExit: summary.run.trace.processExit !== null,
		loopDrainedBeforeExit: summary.run.trace.beforeExit !== null,
	};
} catch (error) {
	summary.run.fatal = String(error?.stack ?? error);
	status = 3;
}
writeFileSync(join(RUN, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`);
console.log(JSON.stringify({ status, checks: summary.checks, fatal: summary.run.fatal ?? null }, null, 2));
process.exit(status);
