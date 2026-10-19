/**
 * #107 rail 2a: the sending half of one declared remote pair, proven beside the module (T1).
 *
 * Entry point of every cell: EXECUTOR-IN. The caller's envelope is a fixture handed to
 * `runEntwurfV2WithRemoteRoute` through `senderProvider`. How a sending bridge resolves its own
 * identity is the existing local sender tests' claim; nothing here re-proves that wiring. The
 * transport is a recording stand-in: no ssh runs, no network, no other host. The claim the
 * stand-in receives is read back with the RECEIVING half's own parser (`parseRemoteClaim`), so
 * the send/receive wire shape is checked by the other side's code, not by this module's.
 *
 * Not claimed here: ssh's remote shell-joining of argv (only the no-quoting charset is checked),
 * a real entry process (2c), installed bytes (rail 3), a real host (T3).
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { SenderEnvelope } from "./entwurf-control-rpc.ts";
import type { EntwurfV2SurfaceRendered, SurfaceEntwurfV2Params } from "./entwurf-v2-surface.ts";
import { upsertMetaSession } from "./meta-session.ts";
import { parseRemoteClaim } from "./remote-pair-receive.ts";
import {
	classifyRemoteReceipt,
	makeLocalTraceFact,
	parseRemoteRouteDeclaration,
	type RemoteRouteDeclaration,
	type RemoteTransportResult,
	readRemotePairOptIn,
	runEntwurfV2WithRemoteRoute,
} from "./remote-pair-send.ts";

const LOCAL = "20261007T132839-0aaaaa";
const REMOTE = "20261014T212756-0bbbbb";
const OTHER = "20261014T212756-0ccccc";

const ROUTE: RemoteRouteDeclaration = {
	remoteGardenId: REMOTE,
	ssh: "oracle",
	localGardenId: LOCAL,
	remotePairFile: "/home/op/.pi/agent/entwurf-remote-pair.json",
};

const SENDER: SenderEnvelope = {
	sessionId: LOCAL,
	agentId: "pi-durable/laptop",
	cwd: "/home/op/repos/entwurf",
	timestamp: "2026-10-19T00:00:00.000Z",
	origin: "meta-session",
	replyable: true,
};

function ok(stdoutJson: unknown, exitCode = 0): RemoteTransportResult {
	return { exitCode, signal: null, timedOut: false, stdout: `${JSON.stringify(stdoutJson)}\n`, stderr: "" };
}

function harness(result: RemoteTransportResult = ok({ kind: "dispatched", isError: false, text: "enqueued" })) {
	const calls: { argv: readonly string[]; stdin: string; timeoutMs: number }[] = [];
	const local: SurfaceEntwurfV2Params[] = [];
	let trace = false;
	return {
		calls,
		local,
		setTrace(v: boolean) {
			trace = v;
		},
		run(params: SurfaceEntwurfV2Params, route: RemoteRouteDeclaration | null, sender: SenderEnvelope | undefined) {
			return runEntwurfV2WithRemoteRoute(params, {
				senderProvider: () => sender,
				route,
				localTrace: async () => trace,
				transport: {
					run: async (argv, stdin, timeoutMs) => {
						calls.push({ argv, stdin, timeoutMs });
						return result;
					},
				},
				runLocal: async (p): Promise<EntwurfV2SurfaceRendered> => {
					local.push(p);
					return { isError: false, text: "local" };
				},
			});
		},
	};
}

const PARAMS: SurfaceEntwurfV2Params = {
	target: REMOTE,
	intent: "fire-and-forget",
	message: "nonce-107",
	wants_reply: true,
};

describe("route selection sits in front of the local decider", () => {
	it("[QK:REMOTE-ROUTE-UNDECLARED-LOCAL-UNCHANGED] no declaration, or a target it does not name, runs the existing local surface once and never the transport", async () => {
		const h = harness();
		expect((await h.run(PARAMS, null, SENDER)).text).toBe("local");
		expect((await h.run({ ...PARAMS, target: OTHER }, ROUTE, SENDER)).text).toBe("local");
		expect(h.local).toEqual([PARAMS, { ...PARAMS, target: OTHER }]);
		expect(h.calls).toHaveLength(0);
	});

	it("[QK:REMOTE-ROUTE-LOCAL-CONFLICT-FAILS-CLOSED] a declared remote gid with any local trace is refused as ambiguous: no transport, no local dispatch", async () => {
		const h = harness();
		h.setTrace(true);
		const r = await h.run(PARAMS, ROUTE, SENDER);
		expect(r.isError).toBe(true);
		expect(r.text).toMatch(/remote-route-local-conflict/);
		expect(h.calls).toHaveLength(0);
		expect(h.local).toHaveLength(0);
	});

	it("[QK:REMOTE-ROUTE-SENDER-MUST-BE-DECLARED] an absent, anonymous, or other sender is refused before transport", async () => {
		const h = harness();
		for (const s of [undefined, { ...SENDER, origin: "external-mcp" as const }, { ...SENDER, sessionId: OTHER }]) {
			const r = await h.run(PARAMS, ROUTE, s);
			expect(r.isError).toBe(true);
			expect(r.text).toMatch(/remote-sender-not-declared/);
		}
		expect(h.calls).toHaveLength(0);
		expect(h.local).toHaveLength(0);
	});

	it("[QK:REMOTE-ROUTE-EXACT-ARGV-ONCE] a declared route runs exactly one transport call with the fixed argv, and its stdin parses as the receiver's claim", async () => {
		const h = harness();
		const r = await h.run(PARAMS, ROUTE, SENDER);
		expect(r.isError, r.text).toBe(false);
		expect(h.calls).toHaveLength(1);
		expect(h.calls[0].argv).toEqual([
			"ssh",
			"-o",
			"BatchMode=yes",
			"-o",
			"ConnectTimeout=10",
			"oracle",
			"entwurf",
			"remote-pair-receive",
			"--pair",
			"/home/op/.pi/agent/entwurf-remote-pair.json",
		]);
		expect(parseRemoteClaim(h.calls[0].stdin)).toEqual({
			from: LOCAL,
			fromAgentId: "pi-durable/laptop",
			fromCwd: "/home/op/repos/entwurf",
			target: REMOTE,
			message: "nonce-107",
			wantsReply: true,
		});
		expect(h.local).toHaveLength(0);
	});

	it("[QK:REMOTE-ROUTE-NO-RETRY] an indeterminate transport result is reported as such after exactly one call", async () => {
		const h = harness({ exitCode: 255, signal: null, timedOut: false, stdout: "", stderr: "Connection reset" });
		const r = await h.run(PARAMS, ROUTE, SENDER);
		expect(r.isError).toBe(true);
		expect(r.text).toMatch(/indeterminate: exit 255.*not retried/s);
		expect(h.calls).toHaveLength(1);
	});
});

describe("the sender's receipt keeps the other host's facts as the other host's", () => {
	it("[QK:REMOTE-ROUTE-RECEIPT-PATHS-OTHER-HOST] an accepted or non-delivered receipt quotes the other host's text verbatim and says its paths are on the other host", async () => {
		const bText = "entwurf_v2 meta-mailbox → enqueued (/home/b/.pi/agent/meta-mailbox/x/1.msg)";
		for (const [stdout, exit] of [
			[{ kind: "dispatched", isError: false, text: bText }, 0],
			[{ kind: "dispatched", isError: true, text: bText }, 4],
		] as const) {
			const r = await harness(ok(stdout, exit)).run(PARAMS, ROUTE, SENDER);
			expect(r.text).toContain("paths below are on the other host");
			expect(r.text).toContain(bText);
		}
	});
});

describe("the receipt is decided only when exit and JSON agree", () => {
	it("[QK:REMOTE-RECEIPT-EXIT-AND-KIND-AGREE] each exit/kind pair decides; any disagreement, signal, timeout or malformed line is indeterminate", () => {
		const acc = { kind: "dispatched", isError: false, text: "t" };
		const nd = { kind: "dispatched", isError: true, text: "t" };
		const rej = { kind: "rejected", reason: "remote-pair-from-mismatch", detail: "d" };
		const inv = { kind: "invalid", detail: "d" };
		expect(classifyRemoteReceipt(ok(acc, 0)).kind).toBe("remote-accepted");
		expect(classifyRemoteReceipt(ok(nd, 4)).kind).toBe("remote-non-delivery");
		expect(classifyRemoteReceipt(ok(rej, 3)).kind).toBe("remote-pair-refused");
		expect(classifyRemoteReceipt(ok(inv, 2)).kind).toBe("remote-invalid");
		const indeterminate: RemoteTransportResult[] = [
			ok(rej, 0),
			ok(acc, 3),
			ok(acc, 4),
			ok(nd, 0),
			ok(inv, 0),
			ok({ ...rej, reason: "made-up" }, 3),
			ok({ ...acc, extra: 1 }, 0),
			{ ...ok(acc, 0), stdout: `${JSON.stringify(acc)}\n${JSON.stringify(acc)}\n` },
			{ ...ok(acc, 0), stdout: JSON.stringify(acc) },
			{ ...ok(acc, 0), stdout: "not json\n" },
			{ exitCode: 2, signal: null, timedOut: false, stdout: "", stderr: "usage: …" },
			{ exitCode: 1, signal: null, timedOut: false, stdout: "", stderr: "Error" },
			{ exitCode: 127, signal: null, timedOut: false, stdout: "", stderr: "entwurf: not found" },
			{ exitCode: 255, signal: null, timedOut: false, stdout: "", stderr: "ssh: connect" },
			{ exitCode: null, signal: "SIGKILL", timedOut: false, stdout: "", stderr: "" },
			{ ...ok(acc, 0), timedOut: true },
		];
		for (const r of indeterminate)
			expect(classifyRemoteReceipt(r).kind, JSON.stringify(r)).toBe("remote-indeterminate");
	});
});

describe("the declaration is narrow", () => {
	it("[QK:REMOTE-ROUTE-DECL-NO-QUOTING-NEEDED] the alias and the remote path stay inside a charset ssh's remote shell does not reinterpret", () => {
		const good = JSON.stringify(ROUTE);
		expect(parseRemoteRouteDeclaration(good)).toEqual(ROUTE);
		const bad: Partial<Record<keyof RemoteRouteDeclaration, string>>[] = [
			{ ssh: "-oProxyCommand=x" },
			{ ssh: "oracle;id" },
			{ ssh: "or acle" },
			{ remotePairFile: "relative/pair.json" },
			{ remotePairFile: "/home/op/pair file.json" },
			{ remotePairFile: "/home/op/$(id).json" },
			{ remotePairFile: "/home/op/../etc/pair.json" },
		];
		for (const b of bad)
			expect(() => parseRemoteRouteDeclaration(JSON.stringify({ ...ROUTE, ...b })), JSON.stringify(b)).toThrow();
		expect(() => parseRemoteRouteDeclaration(JSON.stringify({ ...ROUTE, command: "x" }))).toThrow(
			/keys must be exactly/,
		);
	});
});

describe("the production local-trace fact", () => {
	let root: string;
	let sessionsDir: string;
	let controlSocketDir: string;
	let bridgeSocketDir: string;
	beforeEach(() => {
		root = fs.mkdtempSync(path.join(os.tmpdir(), "remote-pair-send-"));
		sessionsDir = path.join(root, "meta-sessions");
		controlSocketDir = path.join(root, "entwurf-control");
		fs.mkdirSync(sessionsDir);
		fs.mkdirSync(controlSocketDir);
		bridgeSocketDir = path.join(root, "bridge-entwurf-dir");
		fs.mkdirSync(bridgeSocketDir);
	});
	afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

	it("[QK:REMOTE-ROUTE-LOCAL-TRACE-ANY-STATE] a readable record, an unreadable record, a symlinked record, or anything at the socket path in ANY named socket dir all count as a local trace", async () => {
		const trace = makeLocalTraceFact({ sessionsDir, controlSocketDirs: [controlSocketDir, bridgeSocketDir] });
		expect(await trace(REMOTE)).toBe(false);
		const gid = upsertMetaSession({
			input: { backend: "pi-durable", nativeSessionId: "n-1", cwd: root, model: null, transcriptPath: null },
			dir: sessionsDir,
		}).record.gardenId;
		expect(await trace(gid)).toBe(true);
		fs.writeFileSync(path.join(sessionsDir, `${REMOTE}.meta.json`), "{not json");
		expect(await trace(REMOTE)).toBe(true);
		fs.rmSync(path.join(sessionsDir, `${REMOTE}.meta.json`));
		fs.symlinkSync(path.join(root, "elsewhere.json"), path.join(sessionsDir, `${REMOTE}.meta.json`));
		expect(await trace(REMOTE)).toBe(true);
		fs.rmSync(path.join(sessionsDir, `${REMOTE}.meta.json`));
		fs.writeFileSync(path.join(controlSocketDir, `${REMOTE}.sock`), "");
		expect(await trace(REMOTE)).toBe(true);
		// A socket only in the bridge's own ENTWURF_DIR, which can differ from the canonical dir.
		fs.rmSync(path.join(controlSocketDir, `${REMOTE}.sock`));
		expect(await trace(REMOTE)).toBe(false);
		fs.writeFileSync(path.join(bridgeSocketDir, `${REMOTE}.sock`), "");
		expect(await trace(REMOTE)).toBe(true);
	});
});

describe("the operator opt-in file", () => {
	let dir: string;
	beforeEach(() => {
		dir = fs.mkdtempSync(path.join(os.tmpdir(), "remote-pair-opt-in-"));
	});
	afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

	it("[QK:REMOTE-PAIR-OPT-IN-ABSENT-IS-OFF] only an absent file is off; a present valid file is read as written", () => {
		const file = path.join(dir, "entwurf-remote-pair.json");
		expect(readRemotePairOptIn(file)).toBeNull();
		fs.writeFileSync(file, JSON.stringify(ROUTE));
		expect(readRemotePairOptIn(file)).toEqual(ROUTE);
	});

	it("[QK:REMOTE-PAIR-OPT-IN-BROKEN-REFUSED] a symlinked, non-regular or invalid opt-in throws instead of reading as off", () => {
		const real = path.join(dir, "real.json");
		fs.writeFileSync(real, JSON.stringify(ROUTE));
		const link = path.join(dir, "link.json");
		fs.symlinkSync(real, link);
		expect(() => readRemotePairOptIn(link)).toThrow(/regular non-symlink/);
		const asDir = path.join(dir, "dir.json");
		fs.mkdirSync(asDir);
		expect(() => readRemotePairOptIn(asDir)).toThrow(/regular non-symlink/);
		const bad = path.join(dir, "bad.json");
		fs.writeFileSync(bad, "{");
		expect(() => readRemotePairOptIn(bad)).toThrow(/not JSON/);
	});
});
