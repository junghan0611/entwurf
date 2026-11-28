/**
 * hc-placement — the Herdr Core placement view (#178), proven beside the module.
 *
 * Deterministic. The core is a scripted table of replies in call order; an UNSCRIPTED request fails
 * the test, so a read that should not have happened is a failure. The path probe is injected except
 * in the one claim that proves the real no-follow probe on real files and a real unix socket. Reply
 * shapes are hc 0.1.20's `hello` and `terminal.list`, recorded on oracle on 2026-11-28.
 *
 * Each claim is its own test title (`run_vitest` attributes a mutant kill from the failed title):
 *
 *   HCP-OPT-IN-ONLY            no operator-named socket: nothing is read, and HC_TERMINAL_SOCKET is not borrowed
 *   HCP-CONFIG-NAMED-ERROR     a relative path or a non-socket is a named error, never `unobserved`
 *   HCP-ABSENT-UNOBSERVED      a named path that does not exist is not read and is not an error
 *   HCP-ONE-READ-NO-RETRY      hello then terminal.list, once each; any failure is null with no further request
 *   HCP-GENERATION-PINNED      a core of another generation is not read past its hello
 *   HCP-LOCAL-LIVE-ONLY        only this core's own live terminals with a real pid are indexed
 *   HCP-PID-JOIN               a Claude Code owner pid joins exactly one terminal; two is ambiguous; no hit is none
 *   HCP-CC-ONLY                pi and pi-durable are never claimed: unobserved, even on a pid that matches
 *   HCP-NO-OWNER-UNOBSERVED    a citizen with no active owner is unobserved, not none
 *   HCP-RENDER                 the column says `hc <core>/<terminal>`
 *   HCP-PROBE-NO-FOLLOW        the real probe: socket, regular file, symlink to a socket, missing
 */

import * as fs from "node:fs";
import { createServer } from "node:net";
import * as os from "node:os";
import * as path from "node:path";
import { afterAll, describe, expect, test } from "vitest";
import type { HcSocketOutcome } from "./hc-launch.ts";
import {
	buildHcPlacementIndex,
	HC_PLACEMENT_SOCKET_ENV,
	HcPlacementConfigError,
	type HcPlacementReadDeps,
	type HcSocketPathProbe,
	parseHcTerminalList,
	probeHcSocketPath,
	readHcPlacementIndex,
	resolveHcPlacement,
	resolveHcPlacementSocket,
} from "./hc-placement.ts";
import { renderPlacement } from "./herdr-placement.ts";

function ok(label: string, cond: boolean): void {
	expect(cond, label).toBe(true);
}

const SOCKET = "/run/user/1000/herdr-core/default.sock";
const CORE = { id: "96a4987dcca010b410faac93b2d0607c", name: "oracle" };
const reply = (id: unknown, result: unknown): HcSocketOutcome => ({
	kind: "reply",
	line: JSON.stringify({ jsonrpc: "2.0", id, result }),
});
type Reply = HcSocketOutcome | ((request: Record<string, unknown>) => HcSocketOutcome);
const HELLO: Reply = (r) => reply(r.id, { generation: 1, version: "0.1.20", core: CORE, framed: false });
const term = (address: string, pid: unknown, state = "live") => ({ address, pid, state, name: `n-${address}` });
const LIST =
	(terminals: unknown[]): Reply =>
	(r) =>
		reply(r.id, { hidden_finished: 0, terminals });

function scripted(replies: Reply[], probe: HcSocketPathProbe = () => "socket") {
	const requests: Record<string, unknown>[] = [];
	const sockets: string[] = [];
	const timeouts: number[] = [];
	const deps: HcPlacementReadDeps = {
		probe,
		connect: (socketPath) => {
			sockets.push(socketPath);
			return async (line, timeoutMs) => {
				const request = JSON.parse(line) as Record<string, unknown>;
				const next = replies[requests.length];
				requests.push(request);
				timeouts.push(timeoutMs);
				if (next === undefined) throw new Error(`unscripted hc request: ${String(request.method)}`);
				return typeof next === "function" ? next(request) : next;
			};
		},
	};
	return { deps, requests, sockets, timeouts };
}
const methods = (requests: Record<string, unknown>[]) => requests.map((r) => r.method).join(",");
const OPT_IN = { [HC_PLACEMENT_SOCKET_ENV]: SOCKET };
const thrown = (fn: () => unknown): unknown => {
	try {
		fn();
	} catch (error) {
		return error;
	}
	return null;
};

describe("hc placement: the operator-named read", () => {
	test("[QK:HCP-OPT-IN-ONLY] with no operator-named socket nothing is read, and the launch socket is not borrowed", async () => {
		for (const env of [
			{},
			{ [HC_PLACEMENT_SOCKET_ENV]: "" },
			{ HC_TERMINAL_SOCKET: SOCKET, HC_TERMINAL_ID: "t7" },
		] as NodeJS.ProcessEnv[]) {
			let probed = 0;
			const core = scripted([], () => {
				probed++;
				return "socket";
			});
			ok("no index", (await readHcPlacementIndex(env, core.deps)) === null);
			ok("no connection, no request, no stat", core.sockets.length === 0 && core.requests.length === 0 && probed === 0);
		}
	});

	test("[QK:HCP-CONFIG-NAMED-ERROR] a relative path or a non-socket is a named config error, never unobserved", async () => {
		const relative = thrown(() =>
			resolveHcPlacementSocket({ [HC_PLACEMENT_SOCKET_ENV]: "run/hc.sock" }, () => "socket"),
		);
		ok(
			"a relative path throws by name",
			relative instanceof HcPlacementConfigError && relative.reason === "hc-placement-socket-malformed",
		);
		const nul = thrown(() => resolveHcPlacementSocket({ [HC_PLACEMENT_SOCKET_ENV]: "/run/a\0b" }, () => "socket"));
		ok("a NUL throws by name", nul instanceof HcPlacementConfigError && nul.reason === "hc-placement-socket-malformed");
		const other = thrown(() => resolveHcPlacementSocket(OPT_IN, () => "other"));
		ok(
			"something that is not a socket throws by name",
			other instanceof HcPlacementConfigError && other.reason === "hc-placement-socket-not-a-socket",
		);
		ok(
			"the message names the variable and says it is only a view",
			other instanceof Error &&
				other.message.includes(HC_PLACEMENT_SOCKET_ENV) &&
				other.message.includes("placement view"),
		);
		const core = scripted([], () => "other");
		let rejected: unknown = null;
		await readHcPlacementIndex(OPT_IN, core.deps).catch((error: unknown) => {
			rejected = error;
		});
		ok(
			"the read rejects with the same error and connects to nothing",
			rejected instanceof HcPlacementConfigError && core.sockets.length === 0,
		);
	});

	test("[QK:HCP-ABSENT-UNOBSERVED] a named path that does not exist is not read and is not an error", async () => {
		ok("resolves to nothing to read", resolveHcPlacementSocket(OPT_IN, () => "absent") === null);
		const core = scripted([], () => "absent");
		ok("null index", (await readHcPlacementIndex(OPT_IN, core.deps)) === null);
		ok("no connection", core.sockets.length === 0);
	});

	test("[QK:HCP-ONE-READ-NO-RETRY] hello then terminal.list, once each, and a failure ends the read", async () => {
		const good = scripted([HELLO, LIST([term("t1d", 443471)])]);
		const index = await readHcPlacementIndex(OPT_IN, good.deps);
		ok(
			"exactly hello, terminal.list on the named socket",
			methods(good.requests) === "hello,terminal.list" && good.sockets.join() === SOCKET,
		);
		ok(
			"both reads are bounded",
			good.timeouts.every((t) => t > 0 && t <= 5000),
		);
		ok("the list asks for nothing but live terminals", JSON.stringify(good.requests[1]?.params) === "{}");
		ok(
			"the index carries the core that answered",
			index?.coreId === CORE.id && index.coreName === "oracle" && index.byPid.get(443471) === "t1d",
		);
		const failures: [string, Reply[], string][] = [
			["connect refused", [{ kind: "connect-failed", code: "ECONNREFUSED" }], "hello"],
			["hello timeout", [{ kind: "timeout" }], "hello"],
			[
				"hello error",
				[
					(r) => ({
						kind: "reply",
						line: JSON.stringify({
							jsonrpc: "2.0",
							id: r.id,
							error: { code: 1, message: "m", data: { kind: "unavailable" } },
						}),
					}),
				],
				"hello",
			],
			["hello with no core", [(r) => reply(r.id, { generation: 1 })], "hello"],
			["list timeout", [HELLO, { kind: "timeout" }], "hello,terminal.list"],
			["list garbled", [HELLO, { kind: "reply", line: "not json" }], "hello,terminal.list"],
			["list of another shape", [HELLO, (r) => reply(r.id, { panes: [] })], "hello,terminal.list"],
			["list with an addressless row", [HELLO, LIST([{ pid: 5, state: "live" }])], "hello,terminal.list"],
		];
		for (const [label, replies, expected] of failures) {
			const core = scripted(replies);
			ok(`${label}: nobody looked`, (await readHcPlacementIndex(OPT_IN, core.deps)) === null);
			ok(`${label}: no further request`, methods(core.requests) === expected);
		}
	});

	test("[QK:HCP-GENERATION-PINNED] a core of another generation is not read past its hello", async () => {
		const core = scripted([(r) => reply(r.id, { generation: 2, core: CORE })]);
		ok("null index", (await readHcPlacementIndex(OPT_IN, core.deps)) === null);
		ok(
			"the hello pins generation 1 and no list follows",
			methods(core.requests) === "hello" && JSON.stringify(core.requests[0]?.params) === '{"generation":1}',
		);
	});
});

describe("hc placement: the join", () => {
	test("[QK:HCP-LOCAL-LIVE-ONLY] only this core's own live terminals with a real pid are indexed", () => {
		const rows = parseHcTerminalList({
			terminals: [
				term("t1d", 443471),
				term("t1e", 500, "finished"),
				term("laptop:t3", 443471),
				term("t1f", null),
				term("t1g", 1),
				term("t1h", "77"),
				term("t1i", 600),
			],
		});
		ok("two rows survive", rows?.map((r) => `${r.terminal}=${r.pid}`).join() === "t1d=443471,t1i=600");
		ok(
			"a non-array is unreadable",
			parseHcTerminalList({ terminals: {} }) === null && parseHcTerminalList({}) === null,
		);
	});

	test("[QK:HCP-PID-JOIN] a Claude Code owner pid joins one terminal; two is ambiguous; no hit is none", () => {
		const index = buildHcPlacementIndex(CORE, [
			{ terminal: "t1d", pid: 443471 },
			{ terminal: "t2", pid: 900 },
			{ terminal: "t3", pid: 900 },
			{ terminal: "t4", pid: 901 },
			{ terminal: "t4", pid: 901 },
		]);
		const hit = resolveHcPlacement(index, "claude-code", 443471);
		ok(
			"the one terminal, with the core that was read",
			JSON.stringify(hit) ===
				JSON.stringify({ kind: "hc-terminal", coreId: CORE.id, coreName: "oracle", terminal: "t1d" }),
		);
		ok("a pid two terminals report is ambiguous", resolveHcPlacement(index, "claude-code", 900).kind === "ambiguous");
		ok("the same terminal twice is one terminal", resolveHcPlacement(index, "claude-code", 901).kind === "hc-terminal");
		ok("a core that was read and does not run it: none", resolveHcPlacement(index, "claude-code", 5).kind === "none");
		ok("no index: this owner did not look", resolveHcPlacement(null, "claude-code", 443471).kind === "unobserved");
	});

	test("[QK:HCP-CC-ONLY] pi and pi-durable are never claimed, even on a pid that matches", () => {
		const index = buildHcPlacementIndex(CORE, [{ terminal: "t1m", pid: 482825 }]);
		for (const backend of ["pi", "pi-durable", "codex", "copilot", "agy"]) {
			ok(`${backend} is unobserved`, resolveHcPlacement(index, backend, 482825).kind === "unobserved");
		}
	});

	test("[QK:HCP-NO-OWNER-UNOBSERVED] a citizen with no active owner is unobserved, not none", () => {
		const index = buildHcPlacementIndex(CORE, [{ terminal: "t1d", pid: 443471 }]);
		ok("unobserved", resolveHcPlacement(index, "claude-code", null).kind === "unobserved");
	});

	test("[QK:HCP-RENDER] the column says hc <core>/<terminal>", () => {
		ok(
			"render",
			renderPlacement({ kind: "hc-terminal", coreId: CORE.id, coreName: "oracle", terminal: "t1d" }) ===
				"hc oracle/t1d",
		);
	});
});

describe("hc placement: the real path probe", () => {
	const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "hc-placement-"));
	afterAll(() => fs.rmSync(TMP, { recursive: true, force: true }));

	test("[QK:HCP-PROBE-NO-FOLLOW] socket, regular file, symlink to a socket, missing", async () => {
		const sock = path.join(TMP, "core.sock");
		const server = createServer();
		await new Promise<void>((resolve) => server.listen(sock, resolve));
		try {
			const file = path.join(TMP, "file");
			fs.writeFileSync(file, "");
			const link = path.join(TMP, "link.sock");
			fs.symlinkSync(sock, link);
			ok("a unix socket", probeHcSocketPath(sock) === "socket");
			ok("a regular file is not one", probeHcSocketPath(file) === "other");
			ok("a symlink to a socket is not one", probeHcSocketPath(link) === "other");
			ok("a directory is not one", probeHcSocketPath(TMP) === "other");
			ok("a missing path is absent", probeHcSocketPath(path.join(TMP, "nope.sock")) === "absent");
			ok("a path under a file is absent", probeHcSocketPath(path.join(file, "x.sock")) === "absent");
			ok(
				"the resolver returns the real socket",
				resolveHcPlacementSocket({ [HC_PLACEMENT_SOCKET_ENV]: sock }) === sock,
			);
		} finally {
			await new Promise<void>((resolve) => server.close(() => resolve()));
		}
	});
});
