import { type ChildProcess, spawn } from "node:child_process";
import * as fs from "node:fs";
import * as net from "node:net";
import * as os from "node:os";
import * as path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
	type CodexSocketObservation,
	describeCodexSocketOwnership,
	judgeCodexSocketOwnership,
	listenRowsAt,
	observeCodexSocketSubtree,
	parseProcStat,
	type SubtreeNode,
	UnixTableError,
} from "../scripts/lib/codex-socket-listener.ts";

/**
 * The deterministic half of the Codex first-admission LIVE's ownership precondition (#128).
 *
 * The smoke used to decide "the named app-server owns the default UDS" from argv spelling. Two
 * hosts measured why that is not ownership: oracle's named pid was a node WRAPPER whose child held
 * the socket (passed), thinkpad's named pid was the listener itself started with the vendor-default
 * `--listen unix://` (refused). The judge below is fed both shapes as synthetic observations, and
 * the observer is run against REAL kernel tables with a throwaway wrapper → listener pair: no
 * Codex, no model turn, no operator process read.
 */

const ENDPOINT = "/tmp/codex-daemon-1000/aa11";
const HEADER = "Num       RefCount Protocol Flags    Type St Inode Path";

/** A node whose second read agrees with its first: same parent, same start time, same held fds. */
function node(pid: number, ppid: number, holdingFds: number[] = [], comm = "codex"): SubtreeNode {
	const startTime = `${pid}00`;
	return {
		pid,
		ppid,
		comm,
		startTime,
		holdingFds,
		after: { ppid, startTime, holdingFds: holdingFds.length > 0 ? holdingFds : null },
	};
}

function observation(over: Partial<CodexSocketObservation>): CodexSocketObservation {
	return {
		namedPid: 851181,
		namedStartTime: "85118100",
		endpoint: ENDPOINT,
		rows: [{ inode: "3023464" }],
		rowsAfter: [{ inode: "3023464" }],
		nodes: [],
		failure: null,
		...over,
	};
}

describe("codex socket ownership — judge", () => {
	it("reads a wrapper whose child holds the LISTEN inode as owned, naming the chain (oracle shape)", () => {
		const verdict = judgeCodexSocketOwnership(
			observation({ nodes: [node(851181, 5772, [], "node"), node(851228, 851181, [31])] }),
		);
		expect(verdict.verdict).toBe("owned");
		if (verdict.verdict !== "owned") return;
		expect(verdict.chain.map((n) => n.pid)).toEqual([851181, 851228]);
		expect(verdict.fds).toEqual([31]);
	});

	it("reads a named pid that holds the LISTEN inode itself as owned (thinkpad shape, argv not consulted)", () => {
		const verdict = judgeCodexSocketOwnership(
			observation({ namedPid: 255352, namedStartTime: "25535200", nodes: [node(255352, 1, [31])] }),
		);
		expect(verdict.verdict).toBe("owned");
		if (verdict.verdict !== "owned") return;
		expect(verdict.chain.map((n) => n.pid)).toEqual([255352]);
	});

	it("[QK:CODEX-SOCKET-OWNER-HELD-INODE] a subtree that holds no fd on the inode is not-owned — descent and naming are not ownership", () => {
		const verdict = judgeCodexSocketOwnership(
			observation({ nodes: [node(851181, 5772, [], "node"), node(851228, 851181, [])] }),
		);
		expect(verdict).toMatchObject({ verdict: "not-owned", reason: "not-held-in-named-subtree" });
		// Nothing outside the subtree was read, so the detail must not claim a foreign owner.
		expect(verdict.verdict === "not-owned" && verdict.detail).toContain("no owner is named");
	});

	it("[QK:CODEX-SOCKET-OWNER-PID-REUSE] a pid whose start time changed between reads fails closed", () => {
		const reused = { ...node(851228, 851181, [31]), after: { ppid: 851181, startTime: "99999", holdingFds: [31] } };
		const verdict = judgeCodexSocketOwnership(observation({ nodes: [node(851181, 5772, [], "node"), reused] }));
		expect(verdict).toMatchObject({ verdict: "indeterminate", reason: "subtree-changed" });
	});

	it("[QK:CODEX-SOCKET-OWNER-FD-REREAD] same pid, same start time and a stable row are not enough — a holder that no longer holds the inode on the second read fails closed", () => {
		const released = { ...node(851228, 851181, [31]), after: { ppid: 851181, startTime: "85122800", holdingFds: [] } };
		expect(judgeCodexSocketOwnership(observation({ nodes: [node(851181, 5772, [], "node"), released] }))).toMatchObject(
			{ verdict: "indeterminate", reason: "listener-fd-released" },
		);
		const unread = { ...released, after: { ppid: 851181, startTime: "85122800", holdingFds: null } };
		expect(judgeCodexSocketOwnership(observation({ nodes: [node(851181, 5772, [], "node"), unread] }))).toMatchObject({
			verdict: "indeterminate",
			reason: "listener-fd-released",
		});
	});

	it("fails closed on every other observation that does not say who owns the socket", () => {
		const cases: Array<[Partial<CodexSocketObservation>, string]> = [
			[{ rows: [], rowsAfter: [] }, "no-listen-row"],
			[{ rows: [{ inode: "1" }, { inode: "2" }], rowsAfter: [] }, "several-listen-rows"],
			[{ rowsAfter: [{ inode: "4242" }], nodes: [node(851181, 5772, [31])] }, "listen-row-changed"],
			[{ nodes: [node(851181, 5772, [], "node"), { ...node(851228, 851181, [31]), after: null }] }, "subtree-changed"],
			[
				{
					nodes: [
						node(851181, 5772, [], "node"),
						{ ...node(851228, 851181, [31]), after: { ppid: 1, startTime: "85122800", holdingFds: [31] } },
					],
				},
				"subtree-changed",
			],
			[{ namedStartTime: "1", nodes: [node(851181, 5772, [31])] }, "named-identity-moved"],
			[{ nodes: [node(851228, 851181, [31])] }, "named-identity-moved"],
			[{ nodes: [node(851181, 5772, [7]), node(851228, 851181, [31])] }, "several-holders"],
			[{ nodes: [node(851181, 5772), node(851228, 4242, [31])] }, "chain-broken"],
			[{ failure: { reason: "subtree-unreadable", detail: "fd list of pid 851228: EACCES" } }, "subtree-unreadable"],
		];
		for (const [over, reason] of cases) {
			expect(judgeCodexSocketOwnership(observation(over)), reason).toMatchObject({ verdict: "indeterminate", reason });
		}
	});
});

describe("codex socket ownership — kernel table and stat parsing", () => {
	it("[QK:CODEX-SOCKET-LISTEN-ROW-ONLY] keeps only the LISTEN stream row at exactly the endpoint", () => {
		const table = [
			HEADER,
			`0000000000000000: 00000002 00000000 00010000 0001 01 3023464 ${ENDPOINT}`,
			// A connection the server accepted carries the listener's path, with no ACCEPTCON flag.
			`0000000000000000: 00000003 00000000 00000000 0001 03 3023999 ${ENDPOINT}`,
			`0000000000000000: 00000002 00000000 00010000 0002 01 3024000 ${ENDPOINT}`,
			`0000000000000000: 00000002 00000000 00010000 0001 01 3024001 ${ENDPOINT}x`,
			`0000000000000000: 00000002 00000000 00010000 0001 01 3024002 @${ENDPOINT}`,
			"0000000000000000: 00000003 00000000 00000000 0001 03 3024003",
			"",
		].join("\n");
		expect(listenRowsAt(table, ENDPOINT)).toEqual([{ inode: "3023464" }]);
	});

	it("refuses a table it does not recognise instead of reading around it", () => {
		expect(() => listenRowsAt(`Num Something Else\n`, ENDPOINT)).toThrow(UnixTableError);
		expect(() => listenRowsAt(`${HEADER}\nnot a row\n`, ENDPOINT)).toThrow(UnixTableError);
	});

	it("parses stat fields from the last parenthesis, so a comm with spaces and parens cannot shift them", () => {
		const fields = ["S", "851181", ...Array.from({ length: 17 }, () => "0"), "123456", "0"];
		expect(parseProcStat(`851228 (co) dex (x)) ${fields.join(" ")}`)).toEqual({
			comm: "co) dex (x)",
			ppid: 851181,
			startTime: "123456",
		});
	});
});

/**
 * The observer against REAL kernel tables: a throwaway node wrapper spawns a node listener on a
 * unix socket in its own temp directory. Our own client connection is held open during the
 * reads, so the accepted server-side row (same path, no ACCEPTCON) is present too. Every process
 * is this test's own child and is killed in afterAll.
 */
describe("codex socket ownership — observer on a real wrapper → listener pair", () => {
	const LISTENER = `const net = require("node:net");
const server = net.createServer((socket) => socket.on("error", () => {}));
server.listen(process.env.SOCK, () => process.stdout.write("listening " + process.pid + "\\n"));
process.on("SIGTERM", () => process.exit(0));`;
	const WRAPPER = `const { spawn } = require("node:child_process");
const child = spawn(process.execPath, ["-e", process.env.LISTENER], { stdio: ["ignore", "inherit", "inherit"] });
process.on("SIGTERM", () => { child.kill("SIGTERM"); process.exit(0); });
setInterval(() => {}, 1 << 30);`;

	let dir = "";
	let endpoint = "";
	let wrapper: ChildProcess | undefined;
	let bystander: ChildProcess | undefined;
	let listenerPid = 0;
	let client: net.Socket | undefined;
	// What the smoke does before its identity checks: the caller's own read of the start time.
	const startTimeOf = (pid: number | undefined): string =>
		parseProcStat(fs.readFileSync(`/proc/${pid as number}/stat`, "utf8")).startTime;

	beforeAll(async () => {
		dir = fs.mkdtempSync(path.join(os.tmpdir(), "entwurf-codex-socket-owner-"));
		endpoint = path.join(dir, "control.sock");
		wrapper = spawn(process.execPath, ["-e", WRAPPER], {
			env: { PATH: process.env.PATH ?? "", SOCK: endpoint, LISTENER },
			stdio: ["ignore", "pipe", "inherit"],
		});
		listenerPid = await new Promise<number>((resolve, reject) => {
			const timer = setTimeout(() => reject(new Error("listener did not report within 10s")), 10_000);
			let buffered = "";
			wrapper?.stdout?.on("data", (chunk: Buffer) => {
				buffered += chunk.toString("utf8");
				const match = /listening (\d+)\n/.exec(buffered);
				if (match) {
					clearTimeout(timer);
					resolve(Number(match[1]));
				}
			});
		});
		// Observed only once it has run its own code: a process still in startup opens and closes
		// fds under the reader, and the observer rightly fails closed on that (seen once, cold).
		bystander = spawn(process.execPath, ["-e", 'process.stdout.write("ready\\n"); setInterval(() => {}, 1 << 30)'], {
			stdio: ["ignore", "pipe", "inherit"],
		});
		await new Promise<void>((resolve, reject) => {
			const timer = setTimeout(() => reject(new Error("bystander did not report within 10s")), 10_000);
			bystander?.stdout?.once("data", () => {
				clearTimeout(timer);
				resolve();
			});
		});
		client = net.connect(endpoint);
		await new Promise<void>((resolve, reject) => {
			client?.once("connect", () => resolve());
			client?.once("error", reject);
		});
	});

	afterAll(() => {
		client?.destroy();
		if (listenerPid > 0) {
			try {
				process.kill(listenerPid, "SIGKILL");
			} catch {
				// Already gone: the wrapper's SIGTERM path may have taken it first.
			}
		}
		wrapper?.kill("SIGKILL");
		bystander?.kill("SIGKILL");
		if (dir !== "") fs.rmSync(dir, { recursive: true, force: true });
	});

	it("reads the wrapper's subtree as owned by the child that holds the LISTEN inode, with a client connected", () => {
		const verdict = judgeCodexSocketOwnership(
			observeCodexSocketSubtree(wrapper?.pid as number, endpoint, startTimeOf(wrapper?.pid)),
		);
		expect(verdict.verdict, describeCodexSocketOwnership(verdict)).toBe("owned");
		if (verdict.verdict !== "owned") return;
		expect(verdict.chain.map((n) => n.pid)).toEqual([wrapper?.pid, listenerPid]);
	});

	it("reads the listener named directly as owned by itself", () => {
		const verdict = judgeCodexSocketOwnership(
			observeCodexSocketSubtree(listenerPid, endpoint, startTimeOf(listenerPid)),
		);
		expect(verdict.verdict, describeCodexSocketOwnership(verdict)).toBe("owned");
		if (verdict.verdict !== "owned") return;
		expect(verdict.chain.map((n) => n.pid)).toEqual([listenerPid]);
	});

	it("reads an unrelated process as not-owned, and a path nothing listens on as indeterminate", () => {
		const unrelated = judgeCodexSocketOwnership(
			observeCodexSocketSubtree(bystander?.pid as number, endpoint, startTimeOf(bystander?.pid)),
		);
		expect(unrelated, describeCodexSocketOwnership(unrelated)).toMatchObject({
			verdict: "not-owned",
			reason: "not-held-in-named-subtree",
		});
		const absent = judgeCodexSocketOwnership(
			observeCodexSocketSubtree(wrapper?.pid as number, path.join(dir, "absent.sock"), startTimeOf(wrapper?.pid)),
		);
		expect(absent, describeCodexSocketOwnership(absent)).toMatchObject({
			verdict: "indeterminate",
			reason: "no-listen-row",
		});
	});
});
