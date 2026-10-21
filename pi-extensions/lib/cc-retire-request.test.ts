/**
 * cc-retire-request.test — the Node adapter that joins the record / receiver / sender witnesses to
 * the packaged pidfd helper (#147 G3, core-side leaf).
 *
 * Subject: `requestCcRetire` and its fixed helper path. Oracles, all owned here:
 *  - a child THIS test spawned, whose `exit` event (and signal) says what reached it;
 *  - the real packaged helper, run by the production spawn seam, for every cell where the protocol
 *    itself is not the subject;
 *  - a FAKE helper (a Node script written into this test's sandbox) for the cells where the helper
 *    misbehaves on purpose. It records the control bytes Node wrote to it, so `go` vs `cancel` vs
 *    nothing is read from what actually crossed the pipe.
 * The record, receiver and sender witnesses are in-memory fakes built from the owned child's own
 * pid and start key; no store, marker directory, real Claude Code or Pi process is touched.
 */

import { type ChildProcess, type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PassThrough, Writable } from "node:stream";
import { afterAll, describe, expect, it } from "vitest";
import {
	CC_RETIRE_HELPER_FILE,
	type CcRetireDeps,
	type CcRetireExpected,
	ccRetireHelperArgv,
	ccRetireHelperPath,
	checkCcRetireBinding,
	makeCcRetireDeps,
	requestCcRetire,
} from "./cc-retire-request.ts";
import { inspectReceiverMarker, type ReceiverInspection } from "./entwurf-v2-visible-resume.ts";
import {
	META_SCHEMA_VERSION_V3,
	type MetaIdentity,
	type MetaSenderMarker,
	processStartKey,
	readMetaSenderMarker,
	writeMetaReceiverMarker,
	writeMetaSenderMarker,
} from "./meta-session.ts";

function ok(label: string, cond: boolean): void {
	expect(cond, label).toBe(true);
}

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), "entwurf-cc-retire-request-"));
const ENV: NodeJS.ProcessEnv = {
	PATH: process.env.PATH ?? "",
	HOME: path.join(SANDBOX, "home"),
	XDG_CONFIG_HOME: path.join(SANDBOX, "xdg-config"),
	XDG_CACHE_HOME: path.join(SANDBOX, "xdg-cache"),
	XDG_DATA_HOME: path.join(SANDBOX, "xdg-data"),
	XDG_STATE_HOME: path.join(SANDBOX, "xdg-state"),
	XDG_RUNTIME_DIR: path.join(SANDBOX, "xdg-runtime"),
	TMPDIR: path.join(SANDBOX, "tmp"),
};
for (const dir of ["home", "xdg-config", "xdg-cache", "xdg-data", "xdg-state", "xdg-runtime", "tmp", "fake"]) {
	fs.mkdirSync(path.join(SANDBOX, dir), { recursive: true });
}

const OWNED: ChildProcess[] = [];
afterAll(() => {
	for (const child of OWNED) if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
	fs.rmSync(SANDBOX, { recursive: true, force: true });
});

interface Owned {
	pid: number;
	key: string;
	exited: Promise<{ code: number | null; signal: NodeJS.Signals | null }>;
	isAlive: () => boolean;
}

/** A child this test owns: prints `up` once running, then idles until signalled. */
async function ownedChild(): Promise<Owned> {
	const child = spawn(process.execPath, ["-e", 'process.stdout.write("up\\n"); setInterval(() => {}, 1000);'], {
		env: ENV,
		stdio: ["ignore", "pipe", "ignore"],
	});
	OWNED.push(child);
	let done = false;
	const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) =>
		child.on("exit", (code, signal) => {
			done = true;
			resolve({ code, signal });
		}),
	);
	await new Promise<void>((resolve) => child.stdout?.once("data", () => resolve()));
	const pid = child.pid as number;
	return { pid, key: processStartKey(pid), exited, isAlive: () => !done };
}

const GID = "20261021T220000-abcdef";
const NSID = "4f1c2b9e-0000-4000-8000-000000000001";
const CREATED = "2026-10-21T13:00:00.000Z";
const BINDING = "0123456789abcdef0123456789abcdef";

function record(over: Partial<MetaIdentity> = {}): MetaIdentity {
	return {
		schemaVersion: META_SCHEMA_VERSION_V3,
		gardenId: GID,
		backend: "claude-code",
		nativeSessionId: NSID,
		cwd: SANDBOX,
		model: null,
		transcriptPath: null,
		createdAt: CREATED,
		recordUpdatedAt: CREATED,
		attachIncarnation: BINDING,
		...over,
	};
}

const EXPECTED: CcRetireExpected = {
	gardenId: GID,
	backend: "claude-code",
	nativeSessionId: NSID,
	createdAt: CREATED,
	attachIncarnation: BINDING,
};

function receiver(target: Owned, over: Partial<Extract<ReceiverInspection, { kind: "marker" }>["marker"]> = {}) {
	return {
		kind: "marker" as const,
		marker: {
			gardenId: GID,
			backend: "claude-code",
			nativeSessionId: NSID,
			ownerPid: target.pid,
			ownerStartKey: target.key,
			attachIncarnation: BINDING,
			ownerKind: "claude-code-cli",
			armProvenance: "session-start",
			...over,
		},
		owner: "live" as const,
	};
}

function sender(target: Owned, over: Partial<MetaSenderMarker> = {}): MetaSenderMarker {
	return {
		backend: "claude-code",
		gardenId: GID,
		nativeSessionId: NSID,
		cwd: SANDBOX,
		ownerPid: target.pid,
		ownerStartKey: target.key,
		updatedAt: CREATED,
		...over,
	};
}

interface Calls {
	record: number;
	receiver: number;
	sender: number;
	spawn: (readonly string[])[];
}

/** Witness fakes; each `*At(n)` answers the n-th read (0 = before the helper, 1 = after ready). */
function deps(
	target: Owned,
	opts: {
		recordAt?: (n: number) => MetaIdentity;
		receiverAt?: (n: number) => ReceiverInspection;
		senderAt?: (n: number) => MetaSenderMarker | null;
		helperPath?: () => string | null;
		spawnHelper?: (argv: readonly string[]) => ChildProcessWithoutNullStreams;
	} = {},
): { deps: CcRetireDeps; calls: Calls } {
	const calls: Calls = { record: 0, receiver: 0, sender: 0, spawn: [] };
	const prod = makeCcRetireDeps();
	return {
		calls,
		deps: {
			readRecord: () => (opts.recordAt ?? (() => record()))(calls.record++),
			inspectReceiver: () => (opts.receiverAt ?? (() => receiver(target)))(calls.receiver++),
			readSender: () => (opts.senderAt ?? (() => sender(target)))(calls.sender++),
			helperPath: opts.helperPath ?? prod.helperPath,
			spawnHelper: (argv) => {
				calls.spawn.push(argv);
				return (opts.spawnHelper ?? prod.spawnHelper)(argv);
			},
		},
	};
}

// --- fake helper -------------------------------------------------------------------------------

const FAKE = path.join(SANDBOX, "fake", "fake-helper.mjs");
fs.writeFileSync(
	FAKE,
	`
import fs from "node:fs";
const [mode, , , , pidArg, , recordFile] = process.argv.slice(2);
const pid = Number(pidArg);
const out = (o) => process.stdout.write(JSON.stringify(o) + "\\n");
let input = "";
const afterControl = (fn) => {
	process.stdin.on("data", (c) => { input += c; });
	process.stdin.on("end", () => { fs.writeFileSync(recordFile, input); fn(); });
};
switch (mode) {
	case "wrong-pid": out({ phase: "ready", pid: pid + 1 }); afterControl(() => process.exit(3)); break;
	case "garbage": process.stdout.write("hello\\n"); setInterval(() => {}, 1000); break;
	case "silent": process.exit(0); break;
	case "exited-no-signal": out({ phase: "ready", pid }); afterControl(() => { out({ outcome: "exited" }); process.exit(0); }); break;
	case "signal-then-vanish": out({ phase: "ready", pid }); afterControl(() => { out({ phase: "signal-requested", signal: "SIGTERM" }); process.exit(0); }); break;
	case "wrong-code": out({ phase: "ready", pid }); afterControl(() => { out({ phase: "signal-requested", signal: "SIGTERM" }); out({ outcome: "exited" }); process.exit(4); }); break;
	case "hang-after-signal": out({ phase: "ready", pid }); afterControl(() => { out({ phase: "signal-requested", signal: "SIGTERM" }); setInterval(() => {}, 1000); }); break;
	case "hang": setInterval(() => {}, 1000); break;
}
`,
);

/** A fake-helper spawner for `mode`. Its last argv entry is where it records Node's control bytes. */
function fakeSpawner(mode: string): {
	spawnHelper: (argv: readonly string[]) => ChildProcessWithoutNullStreams;
	control: () => string | null;
	child: () => ChildProcess | null;
} {
	const recordFile = path.join(SANDBOX, "fake", `${mode}-${Math.random().toString(16).slice(2)}.stdin`);
	let spawned: ChildProcess | null = null;
	return {
		spawnHelper: (argv) => {
			const child = spawn(process.execPath, [FAKE, mode, ...argv, recordFile], {
				env: ENV,
				stdio: ["pipe", "pipe", "pipe"],
			});
			OWNED.push(child);
			spawned = child;
			return child;
		},
		control: () => (fs.existsSync(recordFile) ? fs.readFileSync(recordFile, "utf8") : null),
		child: () => spawned,
	};
}

const settle = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * An in-process scripted helper: emits `steps` on stdout on a fixed schedule, records every byte the
 * adapter writes to its stdin, and IGNORES kill() (records it only) — so the cells below measure the
 * adapter's own guard, not whether killing the helper won a race. Nothing is spawned; its pid is a
 * placeholder no code path signals (kill is the stub).
 */
function scriptedHelper(
	steps: { stdout: string; delayMs?: number }[],
	exitCode: number,
	opts: { endThrows?: boolean } = {},
): { child: ChildProcessWithoutNullStreams; frames: string[]; kills: string[] } {
	const frames: string[] = [];
	const kills: string[] = [];
	const stdin = new Writable({
		write(chunk: Buffer, _enc, cb) {
			frames.push(chunk.toString("utf8"));
			cb();
		},
	});
	if (opts.endThrows) {
		stdin.end = (() => {
			throw new Error("pipe gone");
		}) as typeof stdin.end;
	}
	const stdout = new PassThrough();
	const stderr = new PassThrough();
	const child = Object.assign(new EventEmitter(), {
		stdin,
		stdout,
		stderr,
		pid: 4_000_000,
		exitCode: null,
		signalCode: null,
		kill: (sig?: NodeJS.Signals | number) => {
			kills.push(String(sig));
			return true;
		},
	});
	void (async () => {
		for (const step of steps) {
			await settle(step.delayMs ?? 10);
			stdout.write(step.stdout);
		}
		await settle(30);
		stdout.end();
		stderr.end();
		child.emit("close", exitCode, null);
	})();
	return { child: child as unknown as ChildProcessWithoutNullStreams, frames, kills };
}

const line = (o: Record<string, unknown>) => `${JSON.stringify(o)}\n`;

// Linux only: the real helper is pidfd. On Linux every cell runs; nothing here skips on capability.
describe.runIf(process.platform === "linux")("cc-retire-request (core-side adapter, owned children only)", () => {
	it("[QK:CCREQ-STABLE-GO-EXITS] stable witnesses before and after ready → one helper, exact argv, go, THAT child dies of SIGTERM", async () => {
		const target = await ownedChild();
		const { deps: d, calls } = deps(target);
		const helper = ccRetireHelperPath() as string;
		const result = await requestCcRetire(EXPECTED, d);
		const death = await target.exited;
		ok(
			"exited for the owned pid; the child died of SIGTERM; one spawn with the fixed argv; each witness read twice",
			result.outcome === "exited" &&
				result.pid === target.pid &&
				death.signal === "SIGTERM" &&
				calls.spawn.length === 1 &&
				JSON.stringify(calls.spawn[0]) === JSON.stringify(["-I", "-S", helper, String(target.pid), target.key]) &&
				calls.record === 2 &&
				calls.receiver === 2 &&
				calls.sender === 2,
		);
	});

	it("[QK:CCREQ-RECORD-DRIFT-CANCELS] the record's binding changes after ready (a committed re-arm) → cancel, no signal, child alive", async () => {
		const target = await ownedChild();
		const { deps: d, calls } = deps(target, {
			recordAt: (n) => record(n === 0 ? {} : { attachIncarnation: "f".repeat(32) }),
		});
		const result = await requestCcRetire(EXPECTED, d);
		await settle(200);
		ok(
			"not-signalled record-drifted after one spawn, child alive",
			result.outcome === "not-signalled" &&
				result.reason === "record-drifted" &&
				calls.spawn.length === 1 &&
				target.isAlive(),
		);
	});

	it("[QK:CCREQ-RECEIVER-DRIFT-CANCELS] the receiver marker re-armed for another session after ready → cancel, no signal, child alive", async () => {
		const target = await ownedChild();
		const { deps: d } = deps(target, {
			receiverAt: (n) => receiver(target, n === 0 ? {} : { nativeSessionId: "another-session" }),
		});
		const result = await requestCcRetire(EXPECTED, d);
		const foreign = deps(target, {
			receiverAt: (n) => receiver(target, n === 0 ? {} : { ownerKind: "pi-durable-host" }),
		});
		const foreignResult = await requestCcRetire(EXPECTED, foreign.deps);
		await settle(200);
		ok(
			"not-signalled receiver-drifted, and a foreign owner kind after ready → receiver-foreign-owner; child alive",
			result.outcome === "not-signalled" &&
				result.reason === "receiver-drifted" &&
				foreignResult.outcome === "not-signalled" &&
				foreignResult.reason === "receiver-foreign-owner" &&
				target.isAlive(),
		);
	});

	it("[QK:CCREQ-SENDER-DRIFT-CANCELS] the owner's sender marker switched garden after ready (an in-place /resume) → cancel, no signal, child alive", async () => {
		const target = await ownedChild();
		const { deps: d } = deps(target, {
			senderAt: (n) => sender(target, n === 0 ? {} : { gardenId: "20261021T220001-fedcba" }),
		});
		const result = await requestCcRetire(EXPECTED, d);
		await settle(200);
		ok(
			"not-signalled sender-drifted, child alive",
			result.outcome === "not-signalled" && result.reason === "sender-drifted" && target.isAlive(),
		);
	});

	it("[QK:CCREQ-PRECHECK-REFUSES] a witness that does not hold before the helper → refused by name, helper never started", async () => {
		const target = await ownedChild();
		const cases: [string, Parameters<typeof deps>[1], CcRetireExpected?][] = [
			[
				"record-unreadable",
				{
					recordAt: () => {
						throw new Error("store says no");
					},
				},
			],
			["target-not-claude-code", { recordAt: () => record({ backend: "pi" }) }],
			["target-unbound", { recordAt: () => record({ attachIncarnation: null }) }],
			["record-drifted", {}, { ...EXPECTED, createdAt: "2026-10-21T13:00:01.000Z" }],
			["receiver-absent", { receiverAt: () => ({ kind: "absent" }) }],
			["receiver-corrupt", { receiverAt: () => ({ kind: "corrupt" }) }],
			["receiver-unbound", { receiverAt: () => receiver(target, { attachIncarnation: null }) }],
			["receiver-drifted", { receiverAt: () => receiver(target, { attachIncarnation: "e".repeat(32) }) }],
			["receiver-dead", { receiverAt: () => ({ ...receiver(target), owner: "dead" }) }],
			["receiver-uncertain", { receiverAt: () => ({ ...receiver(target), owner: "uncertain" }) }],
			["start-key-unsupported", { receiverAt: () => receiver(target, { ownerStartKey: "ps:Tue Oct 21" }) }],
			["receiver-foreign-owner", { receiverAt: () => receiver(target, { ownerKind: "pi-durable-host" }) }],
			["receiver-foreign-provenance", { receiverAt: () => receiver(target, { armProvenance: "extension-join" }) }],
			["sender-absent", { senderAt: () => null }],
			["sender-foreign-backend", { senderAt: () => sender(target, { backend: "copilot" }) }],
			["sender-drifted", { senderAt: () => sender(target, { nativeSessionId: "another-session" }) }],
		];
		const results = [];
		for (const [want, o, expected] of cases) {
			const { deps: d, calls } = deps(target, o);
			const r = await requestCcRetire(expected ?? EXPECTED, d);
			results.push({ want, r, spawned: calls.spawn.length });
		}
		const bad = results.filter((x) => x.r.outcome !== "refused" || x.r.reason !== x.want || x.spawned !== 0);
		ok(
			`every case refused by its own name with no spawn; mismatches: ${JSON.stringify(bad)}`,
			bad.length === 0 && target.isAlive() && JSON.stringify(results[0]?.r ?? {}).includes("store says no"),
		);
	});

	it("[QK:CCREQ-HELPER-MISSING-REFUSED] no packaged helper → refused helper-missing, nothing spawned", async () => {
		const target = await ownedChild();
		const { deps: d, calls } = deps(target, { helperPath: () => null });
		const result = await requestCcRetire(EXPECTED, d);
		ok(
			"refused helper-missing, no spawn",
			result.outcome === "refused" && result.reason === "helper-missing" && calls.spawn.length === 0,
		);
	});

	it("[QK:CCREQ-HELPER-PATH-FIXED] the helper path is the fixed basename beside the module, a regular file, and nothing else", () => {
		const here = import.meta.dirname;
		const lib = fs.mkdtempSync(path.join(SANDBOX, "layout-"));
		// A copy OUTSIDE `lib` must never be found from it: there is no parent-directory search.
		fs.mkdirSync(path.join(lib, "..", "pi-extensions", "lib"), { recursive: true });
		fs.writeFileSync(path.join(lib, "..", "pi-extensions", "lib", CC_RETIRE_HELPER_FILE), "# elsewhere\n");
		const absent = ccRetireHelperPath(lib);
		const beside = path.join(lib, CC_RETIRE_HELPER_FILE);
		fs.symlinkSync(path.join(here, CC_RETIRE_HELPER_FILE), beside);
		const symlinked = ccRetireHelperPath(lib);
		fs.rmSync(beside);
		fs.mkdirSync(beside);
		const directory = ccRetireHelperPath(lib);
		fs.rmdirSync(beside);
		fs.writeFileSync(beside, "# packaged copy\n");
		ok(
			"source → this directory's file; a regular file beside → found; absent, symlink or directory → null; argv fixed",
			ccRetireHelperPath(here) === path.join(here, CC_RETIRE_HELPER_FILE) &&
				ccRetireHelperPath(lib) === beside &&
				absent === null &&
				symlinked === null &&
				directory === null &&
				JSON.stringify(ccRetireHelperArgv("/h.py", 42, "linux:7")) ===
					JSON.stringify(["-I", "-S", "/h.py", "42", "linux:7"]),
		);
	});

	it("[QK:CCREQ-PROTOCOL-NOT-SUCCESS] a helper that breaks the protocol is never read as success, and before go Node writes no go", async () => {
		const target = await ownedChild();
		const run = async (mode: string, wallMs?: number) => {
			const fake = fakeSpawner(mode);
			const { deps: d, calls } = deps(target, { spawnHelper: fake.spawnHelper });
			const r = await requestCcRetire(EXPECTED, d, wallMs ? { wallMs } : {});
			await settle(50);
			return { mode, r, control: fake.control(), spawns: calls.spawn.length };
		};
		const results = [
			await run("wrong-pid"),
			await run("garbage"),
			await run("silent"),
			await run("hang", 400),
			await run("exited-no-signal"),
			await run("signal-then-vanish"),
			await run("wrong-code"),
		];
		const noPython = deps(target, {
			spawnHelper: (argv) =>
				spawn(path.join(SANDBOX, "fake", "no-such-interpreter"), [...argv], {
					env: ENV,
					stdio: ["pipe", "pipe", "pipe"],
				}),
		});
		const missing = await requestCcRetire(EXPECTED, noPython.deps);
		const by = Object.fromEntries(results.map((x) => [x.mode, { ...x, reason: "reason" in x.r ? x.r.reason : null }]));
		ok(
			`protocol breaks → non-success, one spawn each, no go before ready: ${JSON.stringify(results)}`,
			results.every((x) => x.r.outcome !== "exited" && x.spawns === 1) &&
				by["wrong-pid"]?.reason === "helper-protocol" &&
				!(by["wrong-pid"]?.control ?? "").includes("go") &&
				by.garbage?.reason === "helper-protocol" &&
				by.silent?.r.outcome === "refused" &&
				by.hang?.reason === "helper-wall-timeout" &&
				by["exited-no-signal"]?.r.outcome === "unknown" &&
				by["exited-no-signal"]?.control === "go\n" &&
				by["signal-then-vanish"]?.r.outcome === "unknown" &&
				by["wrong-code"]?.r.outcome === "unknown" &&
				missing.outcome === "refused" &&
				missing.reason === "helper-spawn-failed" &&
				noPython.calls.spawn.length === 1 &&
				target.isAlive(),
		);
	});

	it("[QK:CCREQ-LATCH-NO-GO-AFTER-FAILURE] a bad line latches the exchange: a buffered valid ready behind it never gets a go, even if killing the helper loses the race", async () => {
		const target = await ownedChild();
		const ready = line({ phase: "ready", pid: target.pid });
		const helper = scriptedHelper(
			[{ stdout: `not json\n${ready}` }, { stdout: line({ phase: "signal-requested", signal: "SIGTERM" }) }],
			3,
		);
		const { deps: d } = deps(target, { spawnHelper: () => helper.child });
		const result = await requestCcRetire(EXPECTED, d);
		ok(
			`no go frame was ever written, the result is a protocol failure, the helper was asked to die: ${JSON.stringify({ result, frames: helper.frames })}`,
			!helper.frames.join("").includes("go") &&
				result.outcome !== "exited" &&
				"reason" in result &&
				result.reason === "helper-protocol" &&
				helper.kills.includes("SIGKILL") &&
				target.isAlive(),
		);
	});

	it("[QK:CCREQ-CONTROL-WRITE-THROW-UNKNOWN] a go whose write throws is unknown, not not-signalled, and does not throw out of the adapter", async () => {
		const target = await ownedChild();
		const helper = scriptedHelper([{ stdout: line({ phase: "ready", pid: target.pid }) }], 0, { endThrows: true });
		const { deps: d } = deps(target, { spawnHelper: () => helper.child });
		const result = await requestCcRetire(EXPECTED, d);
		ok(
			`unknown helper-protocol naming the write failure: ${JSON.stringify(result)}`,
			result.outcome === "unknown" &&
				result.reason === "helper-protocol" &&
				result.detail.includes("writing the go frame threw") &&
				target.isAlive(),
		);
	});

	it("[QK:CCREQ-TRAILING-OUTPUT-NOT-SUCCESS] a valid exited line followed by incomplete trailing bytes is not proof of exit: unknown", async () => {
		const target = await ownedChild();
		const helper = scriptedHelper(
			[
				{ stdout: line({ phase: "ready", pid: target.pid }) },
				{ stdout: `${line({ phase: "signal-requested", signal: "SIGTERM" })}${line({ outcome: "exited" })}junk` },
			],
			0,
		);
		const { deps: d } = deps(target, { spawnHelper: () => helper.child });
		const result = await requestCcRetire(EXPECTED, d);
		ok(
			`go was written, and the ending is unknown helper-protocol, not exited: ${JSON.stringify(result)}`,
			helper.frames.join("") === "go\n" &&
				result.outcome === "unknown" &&
				result.reason === "helper-protocol" &&
				result.detail.includes("incomplete trailing output"),
		);
	});

	it("[QK:CCREQ-TERMINAL-SHAPE-CLOSED] each terminal line is closed to the helper's wire shape: a missing, extra or contradicting key is never that outcome", async () => {
		const target = await ownedChild();
		const ready = line({ phase: "ready", pid: target.pid });
		const signalled = line({ phase: "signal-requested", signal: "SIGTERM" });
		const run = async (steps: { stdout: string }[], code: number) => {
			const helper = scriptedHelper(steps, code);
			const { deps: d } = deps(target, { spawnHelper: () => helper.child });
			return await requestCcRetire(EXPECTED, d);
		};
		const results = {
			// accepted shapes
			refusedErrno: await run([{ stdout: line({ outcome: "refused", reason: "open-failed", errno: "EMFILE" }) }], 2),
			unobserved: await run(
				[{ stdout: ready }, { stdout: signalled + line({ outcome: "exit-unobserved", waitedS: 5 }) }],
				4,
			),
			// rejected shapes
			refusedExtra: await run([{ stdout: line({ outcome: "refused", reason: "pid-not-found", pid: 1 }) }], 2),
			unobservedNoWait: await run([{ stdout: ready }, { stdout: signalled + line({ outcome: "exit-unobserved" }) }], 4),
			exitedExtra: await run([{ stdout: ready }, { stdout: signalled + line({ outcome: "exited", code: 0 }) }], 0),
			alreadyExitedExtra: await run(
				[{ stdout: ready }, { stdout: line({ outcome: "already-exited", signal: "SIGTERM" }) }],
				3,
			),
		};
		const r = Object.fromEntries(
			Object.entries(results).map(([k, v]) => [k, `${v.outcome}:${"reason" in v ? v.reason : ""}`]),
		);
		ok(
			`closed shapes: ${JSON.stringify(r)}`,
			r.refusedErrno === "refused:helper-refused:open-failed" &&
				r.unobserved === "unknown:exit-unobserved" &&
				r.refusedExtra === "refused:helper-protocol" &&
				r.unobservedNoWait === "unknown:helper-protocol" &&
				r.exitedExtra === "unknown:helper-protocol" &&
				r.alreadyExitedExtra === "unknown:helper-protocol",
		);
	});

	it("[QK:CCREQ-DOMAIN-FROM-WRITER] markers written by the real Claude Code writers pass the domain join; the same writer naming another owner kind is refused", async () => {
		const target = await ownedChild();
		const receiversDir = fs.mkdtempSync(path.join(SANDBOX, "receivers-"));
		const sendersDir = fs.mkdtempSync(path.join(SANDBOX, "senders-"));
		const write = (ownerKind?: string) =>
			writeMetaReceiverMarker({
				gardenId: GID,
				backend: "claude-code",
				nativeSessionId: NSID,
				ownerPid: target.pid,
				armProvenance: "session-start",
				attachIncarnation: BINDING,
				receiversDir,
				...(ownerKind ? { ownerKind } : {}),
			});
		writeMetaSenderMarker({
			backend: "claude-code",
			gardenId: GID,
			nativeSessionId: NSID,
			cwd: SANDBOX,
			ownerPid: target.pid,
			sendersDir,
		});
		const real: CcRetireDeps = {
			...deps(target).deps,
			inspectReceiver: (gid) => inspectReceiverMarker(gid, receiversDir),
			readSender: (ownerPid) => readMetaSenderMarker({ backend: "claude-code", ownerPid, sendersDir }),
		};
		write();
		const accepted = checkCcRetireBinding(EXPECTED, real);
		write("pi-durable-host");
		const foreign = checkCcRetireBinding(EXPECTED, real);
		ok(
			`default writer → ok for the owned pid+key; another owner kind → receiver-foreign-owner: ${JSON.stringify({ accepted, foreign })}`,
			accepted.ok &&
				accepted.owner.pid === target.pid &&
				accepted.owner.startKey === target.key &&
				!foreign.ok &&
				foreign.reason === "receiver-foreign-owner",
		);
	});

	it("[QK:CCREQ-ABORT-BEFORE-GO-NO-SIGNAL] the requester aborts while the helper holds the fd → no go, child alive", async () => {
		const target = await ownedChild();
		const controller = new AbortController();
		const prod = makeCcRetireDeps();
		const { deps: d } = deps(target, {
			spawnHelper: (argv) => {
				const child = prod.spawnHelper(argv);
				// Registered before the adapter's own listener, so the abort lands before `ready` is acted on.
				child.stdout.once("data", () => controller.abort());
				return child;
			},
		});
		const result = await requestCcRetire(EXPECTED, d, { signal: controller.signal });
		await settle(200);
		ok(
			"not-signalled aborted-before-go, child alive",
			result.outcome === "not-signalled" && result.reason === "aborted-before-go" && target.isAlive(),
		);
	});

	it("[QK:CCREQ-ABORT-AFTER-GO-UNKNOWN] an abort after go is unknown, not success and not a retry; Node ends only its own helper", async () => {
		const target = await ownedChild();
		const controller = new AbortController();
		const fake = fakeSpawner("hang-after-signal");
		const { deps: d, calls } = deps(target, {
			spawnHelper: (argv) => {
				const child = fake.spawnHelper(argv);
				child.stdout.on("data", (chunk: Buffer) => {
					if (chunk.toString("utf8").includes("signal-requested")) controller.abort();
				});
				return child;
			},
		});
		const result = await requestCcRetire(EXPECTED, d, { signal: controller.signal });
		await settle(100);
		const helper = fake.child();
		ok(
			"unknown aborted-after-go, one spawn, the fake helper was ended by SIGKILL, the target untouched",
			result.outcome === "unknown" &&
				result.reason === "aborted-after-go" &&
				calls.spawn.length === 1 &&
				helper?.signalCode === "SIGKILL" &&
				target.isAlive(),
		);
	});
});
