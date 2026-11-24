/**
 * meta-session.start-key.test — the owner start-key leaf and the one case that skips `ps` (#173).
 *
 * Subject: `processStartKeyWith`, `linuxProcfsUsableOn` and the production wiring behind
 * `processStartKey` in `meta-session.ts`. Oracle: literals written here — the key each cell must
 * return and how many times each of the four observations was made — never a value read back from
 * the subject. The production cells count `ps` through a recording stand-in placed first on PATH
 * inside a sandbox, and only ever name this process, a child this test spawned and watched exit, or
 * a pid above `pid_t`.
 *
 * What the leaf must keep: "" is UNKNOWN. The classifier cell at the end is the caller's half — a
 * leaf "" followed by a caller probe that says present or unprovable stays `uncertain`.
 */

import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
	classifyMarkerOwner,
	linuxProcfsUsableOn,
	type ProcessStartKeyDeps,
	processStartKey,
	processStartKeyWith,
} from "./meta-session.ts";

const PID = 4242;
/** A stat line whose comm holds spaces and parentheses; field 22 is 987654. */
const STAT = `${PID} (a (b) c) S 1 ${PID} ${PID} 0 -1 4194560 100 0 0 0 1 2 0 0 20 0 1 0 987654 1000 10 18446744073709551615 0 0 0 0 0 0 0 0 0 0 0 0 17 0 0 0 0 0 0\n`;
/** A stat text that ends before field 22. */
const STAT_SHORT = `${PID} (x) S 1 2 3\n`;
const LSTART = "Mon Nov 24 23:10:00 2026";

type StatScript = { text: string } | { code: string | undefined };
type PsScript = { out: string } | { fail: true };

interface Cell {
	stat: StatScript;
	probe?: boolean | null;
	procfs?: boolean;
	ps?: PsScript;
}

interface Counts {
	stat: number[];
	probe: number[];
	procfs: number;
	ps: number[];
}

function harness(cell: Cell): { deps: ProcessStartKeyDeps; counts: Counts } {
	const counts: Counts = { stat: [], probe: [], procfs: 0, ps: [] };
	const deps: ProcessStartKeyDeps = {
		readProcStat(pid) {
			counts.stat.push(pid);
			if ("text" in cell.stat) return cell.stat.text;
			const err = new Error("scripted stat failure") as Error & { code?: string };
			if (cell.stat.code !== undefined) err.code = cell.stat.code;
			throw err;
		},
		probeExists(pid) {
			counts.probe.push(pid);
			return cell.probe === undefined ? null : cell.probe;
		},
		linuxProcfsUsable() {
			counts.procfs += 1;
			return cell.procfs === true;
		},
		ps(pid) {
			counts.ps.push(pid);
			const script = cell.ps ?? { fail: true };
			if ("fail" in script) throw new Error("scripted ps failure");
			return script.out;
		},
	};
	return { deps, counts };
}

const GONE: Cell = { stat: { code: "ENOENT" }, probe: false, procfs: true, ps: { out: `${LSTART}\n` } };

describe("processStartKeyWith — the owner start-key leaf over injected observations", () => {
	it("[QK:STARTKEY-PROC-WINS] a readable stat is the key, and nothing else is observed", () => {
		const h = harness({ stat: { text: STAT }, probe: false, procfs: true, ps: { out: LSTART } });
		expect(processStartKeyWith(PID, h.deps)).toBe("linux:987654");
		expect(h.counts).toEqual({ stat: [PID], probe: [], procfs: 0, ps: [] });
	});

	it("[QK:STARTKEY-GONE-NO-PS] ENOENT, a pid_t pid, a kernel 'no such process' and a usable procfs end in \"\" with no ps", () => {
		const h = harness(GONE);
		expect(processStartKeyWith(PID, h.deps)).toBe("");
		expect(h.counts).toEqual({ stat: [PID], probe: [PID], procfs: 1, ps: [] });
	});

	it("[QK:STARTKEY-PRESENT-TAKES-PS] ENOENT with a pid the kernel says is present asks ps once and returns its key", () => {
		// The race and hidepid shape: the stat is not visible, the pid is there.
		const h = harness({ ...GONE, probe: true });
		expect(processStartKeyWith(PID, h.deps)).toBe(`ps:${LSTART}`);
		expect(h.counts.ps).toEqual([PID]);
		expect(h.counts.probe).toEqual([PID]);
	});

	it("[QK:STARTKEY-UNPROVABLE-TAKES-PS] ENOENT with an unprovable pid (EPERM) asks ps once and returns its key", () => {
		const h = harness({ ...GONE, probe: null });
		expect(processStartKeyWith(PID, h.deps)).toBe(`ps:${LSTART}`);
		expect(h.counts.ps).toEqual([PID]);
	});

	it("[QK:STARTKEY-NO-PROCFS-TAKES-PS] ENOENT and an absent pid without a usable procfs view asks ps once", () => {
		const h = harness({ ...GONE, procfs: false });
		expect(processStartKeyWith(PID, h.deps)).toBe(`ps:${LSTART}`);
		expect(h.counts).toEqual({ stat: [PID], probe: [PID], procfs: 1, ps: [PID] });
	});

	it("[QK:STARTKEY-ERRNO-ENOENT-ONLY] any stat failure that is not ENOENT asks ps once, whatever the probe would say", () => {
		for (const code of ["EACCES", "EPERM", "ESRCH", "EIO", undefined]) {
			const h = harness({ ...GONE, stat: { code } });
			expect(processStartKeyWith(PID, h.deps), String(code)).toBe(`ps:${LSTART}`);
			expect(h.counts.ps, String(code)).toEqual([PID]);
		}
	});

	it("[QK:STARTKEY-UNPARSEABLE-TAKES-PS] a stat that was read but carries no start time asks ps once and never the probe", () => {
		const h = harness({ ...GONE, stat: { text: STAT_SHORT } });
		expect(processStartKeyWith(PID, h.deps)).toBe(`ps:${LSTART}`);
		expect(h.counts).toEqual({ stat: [PID], probe: [], procfs: 0, ps: [PID] });
	});

	it("[QK:STARTKEY-PID-T-BOUND] the largest pid_t may skip ps; one above it asks ps once and is never probed", () => {
		const atBound = harness(GONE);
		expect(processStartKeyWith(2147483647, atBound.deps)).toBe("");
		expect(atBound.counts).toEqual({ stat: [2147483647], probe: [2147483647], procfs: 1, ps: [] });

		const above = harness(GONE);
		expect(processStartKeyWith(2147483648, above.deps)).toBe(`ps:${LSTART}`);
		expect(above.counts).toEqual({ stat: [2147483648], probe: [], procfs: 0, ps: [2147483648] });
	});

	it('[QK:STARTKEY-PS-MEANING] the ps answer is trimmed and prefixed; an empty answer or a failed ps is ""', () => {
		const live: Cell = { stat: { code: "ENOENT" }, probe: true, procfs: true };
		expect(processStartKeyWith(PID, harness({ ...live, ps: { out: `  ${LSTART} \n` } }).deps)).toBe(`ps:${LSTART}`);
		expect(processStartKeyWith(PID, harness({ ...live, ps: { out: " \n" } }).deps)).toBe("");
		expect(processStartKeyWith(PID, harness({ ...live, ps: { out: "" } }).deps)).toBe("");
		const failed = harness({ ...live, ps: { fail: true } });
		expect(processStartKeyWith(PID, failed.deps)).toBe("");
		expect(failed.counts.ps).toEqual([PID]);
	});

	it('[QK:STARTKEY-INVALID-PID-OBSERVES-NOTHING] a pid that is not a positive integer is "" before any observation', () => {
		for (const pid of [0, -1, -4242, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
			const h = harness({ stat: { text: STAT }, probe: true, procfs: true, ps: { out: LSTART } });
			expect(processStartKeyWith(pid, h.deps), String(pid)).toBe("");
			expect(h.counts, String(pid)).toEqual({ stat: [], probe: [], procfs: 0, ps: [] });
		}
	});
});

describe("linuxProcfsUsableOn — this process's own procfs view", () => {
	it("[QK:STARTKEY-PROCFS-LINUX-ONLY] off Linux the answer is false and the self stat is never read", () => {
		for (const platform of ["darwin", "freebsd", "win32", ""]) {
			let reads = 0;
			const usable = linuxProcfsUsableOn(platform, () => {
				reads += 1;
				return STAT;
			});
			expect(usable, platform).toBe(false);
			expect(reads, platform).toBe(0);
		}
	});

	it("[QK:STARTKEY-PROCFS-PARSED] on Linux the self stat must parse: unreadable or without a start time is false", () => {
		expect(linuxProcfsUsableOn("linux", () => STAT)).toBe(true);
		expect(linuxProcfsUsableOn("linux", () => STAT_SHORT)).toBe(false);
		expect(linuxProcfsUsableOn("linux", () => "")).toBe(false);
		expect(
			linuxProcfsUsableOn("linux", () => {
				throw Object.assign(new Error("no procfs"), { code: "ENOENT" });
			}),
		).toBe(false);
	});

	it("[QK:STARTKEY-FOREIGN-PROC-TAKES-PS] off Linux, a readable proc view and an absent pid still ask ps once", () => {
		// A procfs-shaped mount on another OS is not the kernel's process table: the self stat reads
		// fine here, and the leaf must not take its word.
		const h = harness(GONE);
		let selfReads = 0;
		const deps: ProcessStartKeyDeps = {
			...h.deps,
			linuxProcfsUsable: () =>
				linuxProcfsUsableOn("darwin", () => {
					selfReads += 1;
					return STAT;
				}),
		};
		expect(processStartKeyWith(PID, deps)).toBe(`ps:${LSTART}`);
		expect(h.counts.ps).toEqual([PID]);
		expect(selfReads).toBe(0);
	});
});

describe('the caller\'s half — "" from the leaf stays UNKNOWN', () => {
	it('[QK:STARTKEY-EMPTY-STAYS-UNKNOWN] a leaf "" followed by a caller probe of present or unprovable is uncertain, never dead', () => {
		// The narrow observation-time difference: the leaf saw the pid absent, the caller's own probe a
		// moment later does not. The verdict is the classifier's and it is unchanged.
		const h = harness(GONE);
		const key = processStartKeyWith(PID, h.deps);
		expect(key).toBe("");
		expect(classifyMarkerOwner("linux:987654", { currentStartKey: key, pidExists: true })).toBe("uncertain");
		expect(classifyMarkerOwner("linux:987654", { currentStartKey: key, pidExists: null })).toBe("uncertain");
		expect(classifyMarkerOwner("linux:987654", { currentStartKey: key, pidExists: false })).toBe("dead");
	});
});

// ── production wiring ────────────────────────────────────────────────────────────────────────────
// `processStartKey` over the real /proc, the real kill(0) and a recording `ps` first on PATH.

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), "start-key-"));
const PS_LOG = path.join(SANDBOX, "ps-calls.log");
const FAKE_BIN = path.join(SANDBOX, "bin");
fs.mkdirSync(FAKE_BIN, { mode: 0o700 });
fs.writeFileSync(
	path.join(FAKE_BIN, "ps"),
	`#!/bin/sh\nprintf '%s\\n' "$*" >> '${PS_LOG}'\nprintf '%s\\n' '${LSTART}'\n`,
	{ mode: 0o700 },
);

afterAll(() => {
	fs.rmSync(SANDBOX, { recursive: true, force: true });
});

function withRecordingPs<T>(run: () => T): { value: T; psCalls: string[] } {
	const saved = process.env.PATH;
	fs.rmSync(PS_LOG, { force: true });
	process.env.PATH = `${FAKE_BIN}${path.delimiter}${saved ?? ""}`;
	try {
		const value = run();
		const psCalls = fs.existsSync(PS_LOG) ? fs.readFileSync(PS_LOG, "utf8").split("\n").filter(Boolean) : [];
		return { value, psCalls };
	} finally {
		process.env.PATH = saved;
	}
}

function ownStarttime(): string {
	const stat = fs.readFileSync("/proc/self/stat", "utf8");
	return stat
		.slice(stat.lastIndexOf(")") + 1)
		.trim()
		.split(/\s+/)[19];
}

async function spawnedAndGone(): Promise<number> {
	const child = spawn(process.execPath, ["-e", ""], { stdio: "ignore" });
	const pid = child.pid;
	if (pid === undefined) throw new Error("fixture child has no pid");
	await new Promise<void>((resolve, reject) => {
		child.once("exit", () => resolve());
		child.once("error", reject);
	});
	return pid;
}

describe.skipIf(process.platform !== "linux")("processStartKey — production wiring on Linux", () => {
	it("[QK:STARTKEY-PROD-LIVE] this process reads its own key from /proc and ps is not run", () => {
		const { value, psCalls } = withRecordingPs(() => processStartKey(process.pid));
		expect(value).toBe(`linux:${ownStarttime()}`);
		expect(psCalls).toEqual([]);
	});

	it('[QK:STARTKEY-PROD-GONE-NO-PS] a child this test watched exit is "" and ps is not run', async () => {
		const pid = await spawnedAndGone();
		const { value, psCalls } = withRecordingPs(() => processStartKey(pid));
		expect(value).toBe("");
		expect(psCalls).toEqual([]);
	});

	it("[QK:STARTKEY-PROD-PS-ARGV] a pid above pid_t reaches ps once, with the exact lstart argv, and its answer is the key", () => {
		const { value, psCalls } = withRecordingPs(() => processStartKey(2147483648));
		expect(psCalls).toEqual(["-o lstart= -p 2147483648"]);
		expect(value).toBe(`ps:${LSTART}`);
	});
});
