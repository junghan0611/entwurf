/**
 * #107 rail 2a / #149: the sending half of the declared remote pairs, proven beside the module (T1).
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
import type { SuccessReceipt } from "./entwurf-v2-decider.ts";
import {
	type EntwurfV2SurfaceRendered,
	renderEntwurfV2Result,
	type SurfaceEntwurfV2Params,
} from "./entwurf-v2-surface.ts";
import { upsertMetaSession } from "./meta-session.ts";
import { parseRemoteClaim } from "./remote-pair-receive.ts";
import {
	classifyRemoteReceipt,
	makeLocalTraceFact,
	parseRemotePairDeclaration,
	type RemotePairOptIn,
	type RemoteRouteDeclaration,
	type RemoteTransportResult,
	readRemotePairOptIn,
	runEntwurfV2WithRemoteRoute,
} from "./remote-pair-send.ts";

const LOCAL = "20261007T132839-0aaaaa";
const REMOTE = "20261014T212756-0bbbbb";
const OTHER = "20261014T212756-0ccccc";
const LOCAL2 = "20261007T132839-0ddddd";
const REMOTE2 = "20261014T212756-0eeeee";

const ROUTE: RemoteRouteDeclaration = {
	remoteGardenId: REMOTE,
	ssh: "oracle",
	localGardenId: LOCAL,
	remotePairFile: "/home/op/.pi/agent/entwurf-remote-pair.json",
};

const ONE: RemotePairOptIn = { routes: [ROUTE] };

/** A v2 declaration's text, as an operator writes it. */
function v2(...routes: RemoteRouteDeclaration[]): string {
	return JSON.stringify({ version: 2, routes });
}

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
		run(params: SurfaceEntwurfV2Params, optIn: RemotePairOptIn | null, sender: SenderEnvelope | undefined) {
			return runEntwurfV2WithRemoteRoute(params, {
				senderProvider: () => sender,
				optIn,
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
		expect((await h.run({ ...PARAMS, target: OTHER }, ONE, SENDER)).text).toBe("local");
		expect(h.local).toEqual([PARAMS, { ...PARAMS, target: OTHER }]);
		expect(h.calls).toHaveLength(0);
	});

	it("[QK:REMOTE-ROUTE-LOCAL-CONFLICT-FAILS-CLOSED] a declared remote gid with any local trace is refused as ambiguous: no transport, no local dispatch", async () => {
		const h = harness();
		h.setTrace(true);
		const r = await h.run(PARAMS, ONE, SENDER);
		expect(r.isError).toBe(true);
		expect(r.text).toMatch(/remote-route-local-conflict/);
		expect(h.calls).toHaveLength(0);
		expect(h.local).toHaveLength(0);
	});

	it("[QK:REMOTE-ROUTE-SENDER-MUST-BE-DECLARED] an absent, anonymous, or other sender is refused before transport", async () => {
		const h = harness();
		for (const s of [undefined, { ...SENDER, origin: "external-mcp" as const }, { ...SENDER, sessionId: OTHER }]) {
			const r = await h.run(PARAMS, ONE, s);
			expect(r.isError).toBe(true);
			expect(r.text).toMatch(/remote-sender-not-declared/);
		}
		expect(h.calls).toHaveLength(0);
		expect(h.local).toHaveLength(0);
	});

	it("[QK:REMOTE-ROUTE-EXACT-ARGV-ONCE] a declared route runs exactly one transport call with the fixed argv, and its stdin parses as the receiver's claim", async () => {
		const h = harness();
		const r = await h.run(PARAMS, ONE, SENDER);
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
		const r = await h.run(PARAMS, ONE, SENDER);
		expect(r.isError).toBe(true);
		expect(r.text).toMatch(/indeterminate: exit 255.*not retried/s);
		expect(h.calls).toHaveLength(1);
	});
});

describe("the sender's receipt keeps the other host's facts as the other host's", () => {
	it("[QK:REMOTE-ROUTE-RECEIPT-PATHS-OTHER-HOST] an accepted or error-reporting receipt quotes the other host's text verbatim and says its paths are on the other host", async () => {
		const bText = "entwurf_v2 meta-mailbox → enqueued (/home/b/.pi/agent/meta-mailbox/x/1.msg)";
		for (const [stdout, exit] of [
			[{ kind: "dispatched", isError: false, text: bText }, 0],
			[{ kind: "dispatched", isError: true, text: bText }, 4],
		] as const) {
			const r = await harness(ok(stdout, exit)).run(PARAMS, ONE, SENDER);
			expect(r.text).toContain("paths below are on the other host");
			expect(r.text).toContain(bText);
		}
	});
});

describe("an error the other host reports is quoted, not reinterpreted", () => {
	it("[QK:REMOTE-REPORTED-ERROR-NO-DELIVERY-INFERENCE] a post-write failure the other host reports keeps its own retry-safe:false text, and the sender's header claims neither non-delivery nor safety to resend", async () => {
		// The lower texts are the existing local renderer's own output for the two execution
		// failures that can follow a write: a mailbox enqueue whose later step threw, and a
		// finalized send whose lock release failed. This is the text the receiving entry would
		// print; it is not a reproduction of a real host failure.
		const receipt: SuccessReceipt = {
			ok: true,
			action: "send",
			transport: "meta-mailbox",
			ownership: "ack-only",
			observedLiveness: "unsupported",
		};
		const lowers = [
			renderEntwurfV2Result({
				kind: "execution-failed",
				receipt,
				transport: "meta-mailbox",
				error: "signal write failed after the .msg was written",
				retrySafe: false,
			}),
			renderEntwurfV2Result({
				kind: "execution-failed",
				receipt: { ...receipt, transport: "control-socket", observedLiveness: "alive" },
				transport: "control-socket",
				error: "release failed",
				finalizedOutcome: "sent",
				finalizedBoundary: "sent",
				releaseFailed: true,
				retrySafe: false,
			}),
		];
		for (const lower of lowers) {
			expect(lower.isError).toBe(true);
			const r = await harness(ok({ kind: "dispatched", isError: true, text: lower.text }, 4)).run(PARAMS, ONE, SENDER);
			expect(r.isError).toBe(true);
			expect(r.text).toContain(lower.text);
			const header = r.text.split("\n")[0];
			expect(header).toMatch(/reported an error/);
			expect(header).toMatch(/not retried/);
			expect(header).not.toMatch(/did not deliver|not delivered|undelivered|safe to (re)?send|retry-safe: true/i);
		}
		expect(lowers[0].text).toContain("retry-safe: false");
		expect(lowers[1].text).toMatch(/do NOT retry/);
	});
});

describe("the receipt is decided only when exit and JSON agree", () => {
	it("[QK:REMOTE-RECEIPT-EXIT-AND-KIND-AGREE] each exit/kind pair decides; any disagreement, signal, timeout or malformed line is indeterminate", () => {
		const acc = { kind: "dispatched", isError: false, text: "t" };
		const nd = { kind: "dispatched", isError: true, text: "t" };
		const rej = { kind: "rejected", reason: "remote-pair-from-mismatch", detail: "d" };
		const inv = { kind: "invalid", detail: "d" };
		expect(classifyRemoteReceipt(ok(acc, 0)).kind).toBe("remote-accepted");
		expect(classifyRemoteReceipt(ok(nd, 4)).kind).toBe("remote-reported-error");
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
		expect(parseRemotePairDeclaration(v2(ROUTE))).toEqual(ONE);
		const bad: Partial<Record<keyof RemoteRouteDeclaration, string>>[] = [
			{ ssh: "-oProxyCommand=x" },
			{ ssh: "oracle;id" },
			{ ssh: "or acle" },
			{ remotePairFile: "relative/pair.json" },
			{ remotePairFile: "/home/op/pair file.json" },
			{ remotePairFile: "/home/op/$(id).json" },
			{ remotePairFile: "/home/op/../etc/pair.json" },
		];
		for (const b of bad) expect(() => parseRemotePairDeclaration(v2({ ...ROUTE, ...b })), JSON.stringify(b)).toThrow();
		expect(() =>
			parseRemotePairDeclaration(JSON.stringify({ version: 2, routes: [{ ...ROUTE, command: "x" }] })),
		).toThrow(/routes\[0\]: keys must be exactly/);
	});

	it("[QK:REMOTE-ROUTES-V2-EXACT-SHAPE] only an object of exactly version 2 and a non-empty routes array is a declaration", () => {
		const shapes: [unknown, RegExp][] = [
			[{ version: 1, routes: [ROUTE] }, /"version" must be 2/],
			[{ version: "2", routes: [ROUTE] }, /"version" must be 2/],
			[{ version: 2, routes: [] }, /non-empty array; remove the file to switch off/],
			[{ version: 2, routes: ROUTE }, /non-empty array/],
			[{ version: 2, routes: [ROUTE], note: "x" }, /keys must be exactly routes, version/],
			[{ version: 2 }, /keys must be exactly routes, version/],
			[{ version: 2, routes: [[ROUTE]] }, /routes\[0\]: must be a JSON object/],
			[[ROUTE], /must be a JSON object/],
		];
		for (const [shape, err] of shapes)
			expect(() => parseRemotePairDeclaration(JSON.stringify(shape)), JSON.stringify(shape)).toThrow(err);
	});

	it("[QK:REMOTE-ROUTES-LEGACY-NAMED-REFUSAL] the versionless single-pair form is refused by name with the manual rewrite, never read as one route or as off", () => {
		expect(() => parseRemotePairDeclaration(JSON.stringify(ROUTE))).toThrow(
			/versionless single-pair form is no longer read\. Rewrite it by hand as \{"version":2,"routes":\[<the four-key object>\]\}/,
		);
	});
});

describe("the route set is decided on the whole file, not by position", () => {
	const S: RemoteRouteDeclaration = ROUTE;
	const D: RemoteRouteDeclaration = {
		remoteGardenId: REMOTE2,
		ssh: "devbox",
		localGardenId: LOCAL,
		remotePairFile: "/home/dev/.pi/agent/entwurf-remote-pair.json",
	};

	it("[QK:REMOTE-ROUTES-LEGAL-REPEATS-ACCEPTED] one local with several remotes, one remote with several locals, and one alias with several routes are read as written", () => {
		const routes = [S, D, { ...D, localGardenId: LOCAL2 }, { ...S, remoteGardenId: OTHER }];
		expect(parseRemotePairDeclaration(v2(...routes))).toEqual({ routes });
	});

	it("[QK:REMOTE-ROUTES-DUPLICATE-PAIR-REFUSED] the same exact pair twice is refused even when the two entries are identical", () => {
		expect(() => parseRemotePairDeclaration(v2(S, D, S))).toThrow(
			new RegExp(`routes\\[2\\]: duplicate-pair: ${LOCAL} -> ${REMOTE}`),
		);
	});

	it("[QK:REMOTE-ROUTES-LOCAL-REMOTE-OVERLAP-REFUSED] a gid that is local in one route and remote in another, or a route to itself, is refused", () => {
		const reversed = { ...S, remoteGardenId: LOCAL, localGardenId: LOCAL2 };
		for (const routes of [[S, reversed], [reversed, S], [{ ...S, remoteGardenId: LOCAL }]])
			expect(() => parseRemotePairDeclaration(v2(...routes)), JSON.stringify(routes)).toThrow(
				new RegExp(`local-remote-overlap: ${LOCAL} is declared remote here`),
			);
	});

	it("[QK:REMOTE-ROUTES-REMOTE-HOST-CONFLICT-REFUSED] one remote gid reached through two aliases or two files is refused", () => {
		const otherAlias = { ...S, localGardenId: LOCAL2, ssh: "oracle-tailnet" };
		expect(() => parseRemotePairDeclaration(v2(S, otherAlias))).toThrow(
			/remote-host-conflict: .* via oracle .* and via oracle-tailnet/,
		);
		const otherFile = { ...S, localGardenId: LOCAL2, remotePairFile: "/srv/op/entwurf-remote-pair.json" };
		expect(() => parseRemotePairDeclaration(v2(S, otherFile))).toThrow(/remote-host-conflict/);
	});

	it("[QK:REMOTE-ROUTES-ALIAS-FILE-CONFLICT-REFUSED] one alias naming two different remote files is refused, since that host accepts only its one canonical file", () => {
		const sameAliasOtherFile = { ...D, ssh: "oracle" };
		expect(() => parseRemotePairDeclaration(v2(S, sameAliasOtherFile))).toThrow(
			/alias-file-conflict: alias oracle names both \/home\/op\/\.pi\/agent\/entwurf-remote-pair\.json and \/home\/dev/,
		);
	});
});

describe("the route is the exact (sender, target) pair", () => {
	const S: RemoteRouteDeclaration = ROUTE;
	const D: RemoteRouteDeclaration = {
		remoteGardenId: REMOTE2,
		ssh: "devbox",
		localGardenId: LOCAL,
		remotePairFile: "/home/dev/.pi/agent/entwurf-remote-pair.json",
	};
	const D2: RemoteRouteDeclaration = { ...D, localGardenId: LOCAL2 };
	const MANY: RemotePairOptIn = { routes: [S, D, D2] };

	it("[QK:REMOTE-ROUTE-SELECT-EXACT-PAIR] each declared pair goes over its own route, and a sender paired only with another remote is refused before transport", async () => {
		const h = harness();
		const cases: [string, SenderEnvelope, string][] = [
			[REMOTE, SENDER, "oracle"],
			[REMOTE2, SENDER, "devbox"],
			[REMOTE2, { ...SENDER, sessionId: LOCAL2 }, "devbox"],
		];
		for (const [target, sender] of cases) {
			const r = await h.run({ ...PARAMS, target }, MANY, sender);
			expect(r.isError, r.text).toBe(false);
		}
		expect(h.calls.map((c) => [c.argv[5], parseRemoteClaim(c.stdin).from, parseRemoteClaim(c.stdin).target])).toEqual(
			cases.map(([target, sender, alias]) => [alias, sender.sessionId, target]),
		);
		const refused = await h.run(PARAMS, MANY, { ...SENDER, sessionId: LOCAL2 });
		expect(refused.isError).toBe(true);
		expect(refused.text).toMatch(
			new RegExp(`remote-sender-not-declared: only ${LOCAL} may send to ${REMOTE} via oracle \\(sender: ${LOCAL2}\\)`),
		);
		expect(h.calls).toHaveLength(3);
		expect(h.local).toHaveLength(0);
	});

	it("[QK:REMOTE-ROUTE-NO-LOCAL-FALLBACK] a target declared remote, with no route for this sender, is neither sent nor handed to the local path", async () => {
		const h = harness();
		for (const s of [undefined, { ...SENDER, sessionId: OTHER }, { ...SENDER, sessionId: LOCAL2 }]) {
			const r = await h.run(PARAMS, MANY, s);
			expect(r.text).toMatch(/not sent, and not handed to the local path/);
		}
		expect(h.calls).toHaveLength(0);
		expect(h.local).toHaveLength(0);
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
		fs.writeFileSync(file, v2(ROUTE));
		expect(readRemotePairOptIn(file)).toEqual(ONE);
	});

	it("[QK:REMOTE-PAIR-OPT-IN-BROKEN-REFUSED] a symlinked, non-regular or invalid opt-in throws instead of reading as off", () => {
		const real = path.join(dir, "real.json");
		fs.writeFileSync(real, v2(ROUTE));
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
