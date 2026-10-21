/**
 * cc-retire-pidfd.test — the pidfd helper against processes THIS test spawned, and nothing else
 * (#147 G3 leaf).
 *
 * Subject: `cc-retire-pidfd.py`, run the way a caller will run it (`python3 -I -S <file> <pid>
 * <start-key>`, the ready → go/cancel/EOF → result exchange on its pipes). Oracle: the owned child's
 * own lifecycle — whether its `exit` event fired, and with which signal — plus the helper's JSON
 * outcome and exit code. No other process is ever opened or signalled: every pid handed to the
 * helper is a child spawned here, a pid this test just watched exit, or a malformed value the
 * helper must refuse before touching /proc.
 *
 * Fixture cleanup is NOT the helper: a child still running at the end of a cell (the SIGTERM-ignoring
 * one by design) is reaped by `ChildProcess.kill("SIGKILL")` on that child object, which the cell
 * owns. Exit listeners are registered at spawn, so an early exit is never missed.
 *
 * Linux only (pidfd). The capability-absent refusal is reachable only off Linux and is not run here.
 */

import { type ChildProcess, spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { processStartKey } from "./meta-session.ts";

function ok(label: string, cond: boolean): void {
	expect(cond, label).toBe(true);
}

const HELPER = path.join(path.dirname(fileURLToPath(import.meta.url)), "cc-retire-pidfd.py");
const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), "cc-retire-pidfd-"));
const ENV: NodeJS.ProcessEnv = {
	PATH: process.env.PATH,
	LANG: "C.UTF-8",
	HOME: path.join(SANDBOX, "home"),
	XDG_CONFIG_HOME: path.join(SANDBOX, "xdg-config"),
	XDG_CACHE_HOME: path.join(SANDBOX, "xdg-cache"),
	XDG_DATA_HOME: path.join(SANDBOX, "xdg-data"),
	XDG_STATE_HOME: path.join(SANDBOX, "xdg-state"),
	XDG_RUNTIME_DIR: path.join(SANDBOX, "xdg-runtime"),
	TMPDIR: path.join(SANDBOX, "tmp"),
};
for (const dir of ["home", "xdg-config", "xdg-cache", "xdg-data", "xdg-state", "xdg-runtime", "tmp"]) {
	fs.mkdirSync(path.join(SANDBOX, dir), { recursive: true, mode: 0o700 });
}
const OWNED: ChildProcess[] = [];

afterAll(() => {
	for (const child of OWNED) if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
	fs.rmSync(SANDBOX, { recursive: true, force: true });
});

interface Owned {
	child: ChildProcess;
	pid: number;
	key: string;
	exited: Promise<{ code: number | null; signal: NodeJS.Signals | null }>;
	isAlive: () => boolean;
	/** How many lines matching `word` the child (and any descendant sharing its stdout) has printed. */
	count: (word: string) => number;
}

/**
 * A child this test owns, printing `up` once it runs. `ignoreTerm`: its SIGTERM handler prints
 * `term` and does nothing else — the receiver-side count of signals actually delivered.
 * `descendant`: it also starts one grandchild in the SAME process group that prints `tick` every
 * 100 ms on the shared stdout and ends ITSELF after 3 s, so nothing outside this cell cleans it up.
 */
async function ownedChild(opts: { ignoreTerm?: boolean; descendant?: boolean } = {}): Promise<Owned> {
	const grandchild =
		'const t = setInterval(() => process.stdout.write("tick\\n"), 100); setTimeout(() => { clearInterval(t); process.exit(0); }, 3000);';
	const script = [
		opts.ignoreTerm ? 'process.on("SIGTERM", () => process.stdout.write("term\\n"));' : "",
		opts.descendant
			? `require("node:child_process").spawn(process.execPath, ["-e", ${JSON.stringify(grandchild)}], { stdio: ["ignore", "inherit", "ignore"] });`
			: "",
		'process.stdout.write("up\\n"); setInterval(() => {}, 1000);',
	].join(" ");
	const child = spawn(process.execPath, ["-e", script], { env: ENV, stdio: ["ignore", "pipe", "ignore"] });
	OWNED.push(child);
	let done = false;
	let out = "";
	const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) =>
		child.on("exit", (code, signal) => {
			done = true;
			resolve({ code, signal });
		}),
	);
	const up = new Promise<void>((resolve) =>
		child.stdout?.on("data", (chunk: Buffer) => {
			out += chunk.toString("utf8");
			if (out.includes("up\n")) resolve();
		}),
	);
	await up;
	const pid = child.pid as number;
	return {
		child,
		pid,
		key: processStartKey(pid),
		exited,
		isAlive: () => !done,
		count: (word) => out.split("\n").filter((l) => l === word).length,
	};
}

interface HelperRun {
	lines: Record<string, unknown>[];
	code: number | null;
	outcome: Record<string, unknown>;
}

/** What the caller does after `ready`: a control line (newline added, then close), `null` (close at
 * once — EOF), or raw bytes written as-is and then either closed or left open. */
type Reply = string | null | { raw: string; close: boolean };

/** Run the helper; `onReady` decides what to send once it prints `ready`. */
function runHelper(args: string[], onReady?: () => Promise<Reply>): Promise<HelperRun> {
	const helper = spawn("python3", ["-I", "-S", HELPER, ...args], { env: ENV, stdio: ["pipe", "pipe", "pipe"] });
	const closed = new Promise<number | null>((resolve) => helper.on("close", (code) => resolve(code)));
	const lines: Record<string, unknown>[] = [];
	let buf = "";
	helper.stdout.on("data", (chunk: Buffer) => {
		buf += chunk.toString("utf8");
		let nl = buf.indexOf("\n");
		while (nl >= 0) {
			const line = JSON.parse(buf.slice(0, nl)) as Record<string, unknown>;
			buf = buf.slice(nl + 1);
			lines.push(line);
			if (line.phase === "ready") {
				void (async () => {
					const reply = onReady ? await onReady() : null;
					if (reply === null) helper.stdin.end();
					else if (typeof reply === "string") helper.stdin.end(`${reply}\n`);
					else if (reply.close) helper.stdin.end(reply.raw);
					else helper.stdin.write(reply.raw);
				})();
			}
			nl = buf.indexOf("\n");
		}
	});
	return closed.then((code) => {
		if (!helper.stdin.destroyed) helper.stdin.destroy();
		return { lines, code, outcome: lines[lines.length - 1] ?? {} };
	});
}

const phases = (run: HelperRun) => run.lines.map((l) => l.phase).filter(Boolean);

// pidfd is Linux-only, so the scope is the PLATFORM: off Linux nothing here runs. On Linux every cell
// runs, and a kernel or Python without pidfd fails them (the helper refuses), never skips them.
describe.runIf(process.platform === "linux")("cc-retire-pidfd (Linux pidfd helper, owned children only)", () => {
	it("[QK:CCRETIRE-MALFORMED-REFUSED] a malformed pid or start key is refused before anything is opened — no ready, exit 2", async () => {
		const cases = [
			["1", "linux:1"],
			["0", "linux:1"],
			["-5", "linux:1"],
			["12a", "linux:1"],
			["4242", "ps:Tue Oct 21"],
			["4242", "linux:"],
			["4242", "linux:12x"],
			["4242\n", "linux:1"],
			["4194305", "linux:1"],
			["99999999999999999999", "linux:1"],
			["9".repeat(5000), "linux:1"],
			["4242", "linux:1\n"],
		];
		const runs = await Promise.all(cases.map((args) => runHelper(args)));
		ok(
			"every malformed input → refused (malformed-pid / malformed-start-key), exit 2, never ready",
			runs.every(
				(r) =>
					r.code === 2 &&
					r.outcome.outcome === "refused" &&
					(r.outcome.reason === "malformed-pid" || r.outcome.reason === "malformed-start-key") &&
					!phases(r).includes("ready"),
			),
		);
	});

	it("[QK:CCRETIRE-WRONG-KEY-NO-SIGNAL] an owned live child with the WRONG start key is refused as start-key-mismatch and stays alive", async () => {
		const target = await ownedChild();
		const run = await runHelper([String(target.pid), "linux:1"]);
		await new Promise((resolve) => setTimeout(resolve, 200));
		ok(
			"start-key-mismatch, exit 2, never ready, child still alive",
			run.code === 2 &&
				run.outcome.reason === "start-key-mismatch" &&
				!phases(run).includes("ready") &&
				target.isAlive(),
		);
	});

	it("[QK:CCRETIRE-CANCEL-NO-SIGNAL] `cancel` after ready sends nothing: cancelled, exit 3, child alive", async () => {
		const target = await ownedChild();
		const run = await runHelper([String(target.pid), target.key], async () => "cancel");
		await new Promise((resolve) => setTimeout(resolve, 200));
		ok(
			"ready, then cancelled with no signal-requested phase, child alive",
			run.code === 3 && run.outcome.outcome === "cancelled" && phases(run).join(",") === "ready" && target.isAlive(),
		);
	});

	it("[QK:CCRETIRE-EOF-NO-SIGNAL] a caller that closes the pipe after ready sends nothing: cancelled-eof, exit 3, child alive", async () => {
		const target = await ownedChild();
		const run = await runHelper([String(target.pid), target.key], async () => null);
		await new Promise((resolve) => setTimeout(resolve, 200));
		ok(
			"ready, then cancelled-eof with no signal, child alive",
			run.code === 3 &&
				run.outcome.outcome === "cancelled-eof" &&
				phases(run).join(",") === "ready" &&
				target.isAlive(),
		);
	});

	it("[QK:CCRETIRE-GO-TERMINATES-SAME-PROCESS] `go` sends SIGTERM through the fd ONCE and observes THAT process exit: exited, exit 0, the child died of SIGTERM", async () => {
		const target = await ownedChild();
		const run = await runHelper([String(target.pid), target.key], async () => "go");
		const death = await target.exited;
		ok(
			"ready → signal-requested → exited, exit 0, and the owned child's own exit event says SIGTERM",
			run.code === 0 &&
				run.outcome.outcome === "exited" &&
				phases(run).join(",") === "ready,signal-requested" &&
				death.signal === "SIGTERM",
		);
	});

	it("[QK:CCRETIRE-EXITED-BEFORE-GO-NO-SIGNAL] a child that exits while the fd is held is reported already-exited at `go`, with no signal sent", async () => {
		const target = await ownedChild();
		const run = await runHelper([String(target.pid), target.key], async () => {
			// Fixture action, not the helper: the cell ends its own child, then answers go.
			target.child.kill("SIGKILL");
			await target.exited;
			return "go";
		});
		const death = await target.exited;
		ok(
			"already-exited, exit 3, no signal-requested phase, and the child died of the fixture's SIGKILL, not a SIGTERM",
			run.code === 3 &&
				run.outcome.outcome === "already-exited" &&
				phases(run).join(",") === "ready" &&
				death.signal === "SIGKILL",
		);
	});

	it("[QK:CCRETIRE-GONE-PID-REFUSED] a pid whose owned child already exited and was reaped is refused as pid-not-found (or start-key-mismatch if reused) — never success", async () => {
		const target = await ownedChild();
		target.child.kill("SIGKILL");
		await target.exited;
		const run = await runHelper([String(target.pid), target.key]);
		ok(
			"refused, exit 2, never ready",
			run.code === 2 &&
				run.outcome.outcome === "refused" &&
				(run.outcome.reason === "pid-not-found" || run.outcome.reason === "start-key-mismatch") &&
				!phases(run).includes("ready"),
		);
	});

	it("[QK:CCRETIRE-TERM-IGNORED-NO-ESCALATION] a child that ignores SIGTERM is left running: exit-unobserved after the fixed bound, exit 4, no second signal", async () => {
		const target = await ownedChild({ ignoreTerm: true });
		const run = await runHelper([String(target.pid), target.key], async () => "go");
		const aliveAfter = target.isAlive();
		// Give a late second signal time to land and be printed before the count is read.
		await new Promise((resolve) => setTimeout(resolve, 300));
		target.child.kill("SIGKILL"); // fixture cleanup of the owned child, separate from the helper
		await target.exited;
		ok(
			"ready → signal-requested → exit-unobserved, exit 4, the child alive when the helper returned, and it RECEIVED exactly one SIGTERM",
			run.code === 4 &&
				run.outcome.outcome === "exit-unobserved" &&
				phases(run).join(",") === "ready,signal-requested" &&
				aliveAfter &&
				target.count("term") === 1,
		);
	}, 20_000);

	it("[QK:CCRETIRE-TRUNCATED-GO-NO-SIGNAL] the bytes `go` followed by EOF, with no newline, are not a go frame: truncated-control, exit 3, child alive", async () => {
		const target = await ownedChild();
		const run = await runHelper([String(target.pid), target.key], async () => ({ raw: "go", close: true }));
		await new Promise((resolve) => setTimeout(resolve, 200));
		ok(
			"truncated-control, no signal-requested phase, child alive",
			run.code === 3 &&
				run.outcome.outcome === "truncated-control" &&
				phases(run).join(",") === "ready" &&
				target.isAlive(),
		);
	});

	it("[QK:CCRETIRE-OVERSIZE-NO-SIGNAL] a control frame longer than the bound is refused even if it would strip to `go`: oversize-control, exit 3, child alive", async () => {
		const target = await ownedChild();
		const run = await runHelper([String(target.pid), target.key], async () => ({
			raw: `go${" ".repeat(40)}\n`,
			close: true,
		}));
		await new Promise((resolve) => setTimeout(resolve, 200));
		ok(
			"oversize-control, no signal-requested phase, child alive",
			run.code === 3 &&
				run.outcome.outcome === "oversize-control" &&
				phases(run).join(",") === "ready" &&
				target.isAlive(),
		);
	});

	it("[QK:CCRETIRE-PARTIAL-DEADLINE-NO-SIGNAL] a partial frame left open does not extend the go deadline: go-deadline after the fixed bound, exit 3, child alive", async () => {
		const target = await ownedChild();
		const started = Date.now();
		const run = await runHelper([String(target.pid), target.key], async () => ({ raw: "go", close: false }));
		const waited = Date.now() - started;
		await new Promise((resolve) => setTimeout(resolve, 200));
		ok(
			"go-deadline near the 10 s bound, no signal-requested phase, child alive",
			run.code === 3 &&
				run.outcome.outcome === "go-deadline" &&
				phases(run).join(",") === "ready" &&
				waited >= 9_500 &&
				waited < 14_000 &&
				target.isAlive(),
		);
	}, 25_000);

	it("[QK:CCRETIRE-GROUP-UNTOUCHED] the signal reaches the target process only: its descendant in the same process group keeps running after the target's SIGTERM exit", async () => {
		const target = await ownedChild({ descendant: true });
		const run = await runHelper([String(target.pid), target.key], async () => "go");
		const death = await target.exited;
		const ticksAtDeath = target.count("tick");
		await new Promise((resolve) => setTimeout(resolve, 500));
		ok(
			"the target exited of SIGTERM and its same-group descendant printed more ticks afterwards",
			run.outcome.outcome === "exited" && death.signal === "SIGTERM" && target.count("tick") > ticksAtDeath,
		);
	});

	it("[QK:CCRETIRE-NO-NUMERIC-KILL] the helper signals only through the pidfd: no os.kill / killpg / SIGKILL / kill(1), one SIGTERM call, flags 0", () => {
		const source = fs.readFileSync(HELPER, "utf8");
		const code = source.replace(/"""[\s\S]*?"""/g, "").replace(/#.*$/gm, "");
		ok(
			"the only signal call is pidfd_send_signal(fd, signal.SIGTERM, None, 0)",
			!/os\.kill\(|killpg|SIGKILL|subprocess|os\.system|os\.exec/.test(code) &&
				(code.match(/pidfd_send_signal\(/g) ?? []).length === 1 &&
				/pidfd_send_signal\(fd, signal\.SIGTERM, None, 0\)/.test(code),
		);
	});
});
