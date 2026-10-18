/**
 * The Windows preview's platform wiring (#78), proven beside the modules it changes.
 *
 * Every Windows branch keys on `process.platform === "win32"` and reaches the addon only
 * through `win32Native()`, which returns the process-wide addon slot when one is held. So
 * these cases set the platform to win32 for their own duration and plant a FAKE addon in
 * that slot: what is measured is the wiring — which name is derived, which call is made,
 * how its answer is classified — never the addon's Win32 behaviour, which only the Windows
 * preview workflow measures. Each case restores the platform and the slot itself.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { describe, expect, it } from "vitest";

import { canonRootWin32, controlSocketPathIn, WIN32_PIPE_PREFIX, win32PipeNameFor } from "./control-socket-path.js";
import { sendRpcCommand } from "./entwurf-control-rpc.ts";
import { classifyRecordReadFailure, readStoreRecordFile } from "./meta-session.ts";
import { inspectControlSocketPath, isRecordLessSocketCandidate, scanSocketProbes } from "./socket-discovery.ts";
import { probeSocketLiveness } from "./socket-probe.ts";

const SLOT = Symbol.for("entwurf.win32-native.addon");
const GID = "20261018T120000-abcdef";

type Fake = Partial<{
	readNoFollow: (file: string) => Buffer;
	pipeRpc: (name: string, line: string, timeoutMs: number) => Promise<{ responseLine: string; serverPid: number }>;
	pipeProbe: (name: string, timeoutMs: number) => Promise<{ serverPid: number }>;
}>;

async function asWin32<T>(fake: Fake | null, body: () => Promise<T> | T): Promise<T> {
	const platform = Object.getOwnPropertyDescriptor(process, "platform");
	const slot = process as unknown as Record<symbol, unknown>;
	const held = slot[SLOT];
	Object.defineProperty(process, "platform", { value: "win32", configurable: true });
	if (fake) slot[SLOT] = fake;
	else delete slot[SLOT];
	try {
		return await body();
	} finally {
		if (platform) Object.defineProperty(process, "platform", platform);
		if (held === undefined) delete slot[SLOT];
		else slot[SLOT] = held;
	}
}

function errno(code: string): Error & { code: string } {
	return Object.assign(new Error(code), { code });
}

/** realpath over a fake volume: only the listed directories exist, spelled as stored. */
function fakeVolume(existing: string[]): (p: string) => string {
	const byLower = new Map(existing.map((e) => [e.toLowerCase(), e]));
	return (p) => {
		const hit = byLower.get(p.toLowerCase());
		if (hit === undefined) throw errno("ENOENT");
		return hit;
	};
}

describe("Windows pipe grammar", () => {
	const ROOTS = ["C:\\", "C:\\Users", "C:\\Users\\RunnerAdmin", "C:\\Users\\RunnerAdmin\\.pi"];

	it("[QK:WIN32-PIPE-CANON-STABLE] the pipe name is the same before and after the control dir exists", () => {
		const dir = "C:\\Users\\RunnerAdmin\\.pi\\entwurf-control";
		const before = win32PipeNameFor(dir, GID, fakeVolume(ROOTS));
		const after = win32PipeNameFor(dir, GID, fakeVolume([...ROOTS, dir]));
		expect(after).toBe(before);
		expect(before.startsWith(WIN32_PIPE_PREFIX)).toBe(true);
		expect(before).toMatch(/^\\\\\.\\pipe\\entwurf-[0-9a-f]{16}-20261018T120000-abcdef$/);
	});

	it("[QK:WIN32-PIPE-CANON-FOLD] separators, case and a trailing separator do not change the root", () => {
		const rp = fakeVolume(ROOTS);
		const a = canonRootWin32("C:\\Users\\RunnerAdmin\\.pi\\entwurf-control", rp);
		expect(canonRootWin32("c:/users/runneradmin/.pi/ENTWURF-CONTROL/", rp)).toBe(a);
		expect(a).toBe("c:\\users\\runneradmin\\.pi\\entwurf-control");
	});

	it("[QK:WIN32-PIPE-CANON-ONLY-ENOENT] only absence walks up; any other realpath failure throws", () => {
		const denied = (p: string) => {
			if (p === "C:\\Users\\RunnerAdmin") throw errno("EACCES");
			throw errno("ENOENT");
		};
		expect(() => canonRootWin32("C:\\Users\\RunnerAdmin\\.pi\\entwurf-control", denied)).toThrow(/EACCES/);
	});

	it("two store roots on one host derive different pipes for one garden id", () => {
		const rp = fakeVolume([...ROOTS, "D:\\"]);
		expect(win32PipeNameFor("C:\\Users\\RunnerAdmin\\.pi\\entwurf-control", GID, rp)).not.toBe(
			win32PipeNameFor("D:\\store\\entwurf-control", GID, rp),
		);
	});

	it("[QK:WIN32-PIPE-POSIX-UNCHANGED] off Windows the grammar stays `<dir>/<gid>.sock`", () => {
		if (process.platform === "win32") return;
		expect(controlSocketPathIn("/home/u/.pi/entwurf-control", GID)).toBe(
			path.join("/home/u/.pi/entwurf-control", `${GID}.sock`),
		);
	});
});

describe("Windows discovery", () => {
	const PIPE = `${WIN32_PIPE_PREFIX}0123456789abcdef-${GID}`;

	it("[QK:WIN32-PIPE-NEVER-STAT] a pipe name is never stat-ed (a stat would connect)", async () => {
		let statted = false;
		const inspection = await inspectControlSocketPath(PIPE, async () => {
			statted = true;
			throw errno("ENOENT");
		});
		expect(statted).toBe(false);
		expect(inspection).toEqual({ kind: "socket-file", socketPath: PIPE });
	});

	it("[QK:WIN32-PIPE-NO-RECORDLESS-CLAIM] an unstat-ed pipe name never confirms a record-less socket", () => {
		expect(isRecordLessSocketCandidate({ kind: "socket-file", socketPath: PIPE })).toBe(false);
		expect(isRecordLessSocketCandidate({ kind: "socket-file", socketPath: "/d/x.sock" })).toBe(true);
	});

	it("[QK:WIN32-DISCOVERY-FROM-RECORDS] on Windows the dir is never listed: only the record-backed citizens are probed", async () => {
		// A real dir holding a gid-shaped `.sock` entry: a listing would add that gid to the scan.
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), "entwurf-win32-scan-"));
		fs.writeFileSync(path.join(dir, "20261018T130000-bbbbbb.sock"), "");
		// The default readdir is what is under test, so only the volume is faked (identity
		// realpath) and the pipe name goes through the real default seam.
		const identity = (p: string) => p;
		const realpath = fs.realpathSync.native;
		fs.realpathSync.native = identity as typeof realpath;
		const probed: string[] = [];
		let scan: Awaited<ReturnType<typeof scanSocketProbes>>;
		try {
			scan = await asWin32(null, () =>
				scanSocketProbes([GID], {
					dir,
					probe: async (p) => {
						probed.push(p);
						return "alive";
					},
				}),
			);
		} finally {
			fs.realpathSync.native = realpath;
			fs.rmSync(dir, { recursive: true, force: true });
		}
		expect(scan.probes).toEqual([{ gardenId: GID, liveness: "alive" }]);
		expect(scan.dirError).toBeNull();
		expect(probed).toEqual([win32PipeNameFor(dir, GID, identity)]);
	});
});

describe("Windows probe and rpc", () => {
	const PIPE = `${WIN32_PIPE_PREFIX}0123456789abcdef-${GID}`;

	it("[QK:WIN32-PROBE-CLASSIFY] probe: resolved is alive, ENOENT is dead, a refused owner is indeterminate", async () => {
		const answers: Array<[Error | null, string]> = [
			[null, "alive"],
			[errno("ENOENT"), "dead"],
			[errno("EPERM"), "indeterminate"],
			[errno("ETIMEDOUT"), "indeterminate"],
		];
		for (const [err, want] of answers) {
			const got = await asWin32({ pipeProbe: async () => (err ? Promise.reject(err) : { serverPid: 7 }) }, () =>
				probeSocketLiveness(PIPE, { timeoutMs: 50 }),
			);
			expect(got).toBe(want);
		}
	});

	it("[QK:WIN32-PROBE-REFUSAL-THROWS] a loader refusal is not a liveness fact: the probe throws", async () => {
		await expect(asWin32(null, () => probeSocketLiveness(PIPE))).rejects.toMatchObject({
			code: "ENTWURF_WIN32_UNSUPPORTED",
		});
	});

	it("[QK:WIN32-RPC-FIRST-LINE] rpc sends one JSON line and accepts only this command's response", async () => {
		let sent = "";
		const ok = await asWin32(
			{
				pipeRpc: async (_n, line) => {
					sent = line;
					return { responseLine: '{"type":"response","command":"get_info","success":true}', serverPid: 7 };
				},
			},
			() => sendRpcCommand(PIPE, { type: "get_info" }, { timeout: 100 }),
		);
		expect(ok.response.success).toBe(true);
		expect(JSON.parse(sent)).toEqual({ type: "get_info" });
		expect(sent.includes("\n")).toBe(false);
		await expect(
			asWin32(
				{
					pipeRpc: async () => ({ responseLine: '{"type":"response","command":"send","success":true}', serverPid: 7 }),
				},
				() => sendRpcCommand(PIPE, { type: "get_info" }, { timeout: 100 }),
			),
		).rejects.toThrow(/other than the get_info response/);
	});
});

describe("Windows record reader", () => {
	it("[QK:WIN32-RECORD-READ-NATIVE] on Windows a record read goes through the addon, and its refusals keep their class", async () => {
		const read = await asWin32({ readNoFollow: () => Buffer.from('{"v":3}', "utf8") }, () =>
			readStoreRecordFile("C:\\store\\20261018T120000-abcdef.json"),
		);
		expect(read).toBe('{"v":3}');
		const refused = await asWin32(
			{
				readNoFollow: () => {
					throw errno("ELOOP");
				},
			},
			() => {
				try {
					readStoreRecordFile("C:\\store\\20261018T120000-abcdef.json");
				} catch (err) {
					return (err as { code?: string }).code;
				}
				return undefined;
			},
		);
		expect(refused).toBe("ELOOP");
		expect(classifyRecordReadFailure(refused)).toBe("irregular");
	});
});
