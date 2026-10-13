import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as net from "node:net";
import * as os from "node:os";
import * as path from "node:path";
import { renderFreshCall } from "../pi-extensions/lib/mux-fresh-call.ts";
import {
	type CodexExecRunner,
	type CodexProtocolOpener,
	type CodexRpcProtocol,
	checkCodexSocketFile,
	createCodexNativePushAdapter,
	probeCodexThread,
	readCodexThread,
	realCodexProtocolOpener,
	resolveCodexDefaultSocketPath,
	sendViaCodexQueue,
	setCodexThreadName,
} from "../pi-extensions/lib/native-push/codex-ws-client.ts";
import { launchReceiptWindows } from "./lib/launch-receipt-windows.ts";

class FakeProtocol implements CodexRpcProtocol {
	readonly calls: Array<{ method: string; params: Record<string, unknown> }> = [];
	closed = false;

	private readonly replies: unknown[];

	constructor(replies: unknown[]) {
		this.replies = replies;
	}

	async request(method: string, params: Record<string, unknown>): Promise<unknown> {
		this.calls.push({ method, params });
		return this.replies.shift();
	}

	notify(method: string, params: Record<string, unknown> = {}): void {
		this.calls.push({ method, params });
	}

	close(): void {
		this.closed = true;
	}
}

function opener(protocol: FakeProtocol): CodexProtocolOpener {
	return { open: async () => protocol };
}

const NEGATIVE_FRAMES = {
	masked: Buffer.from([0x81, 0x80]),
	oversize: Buffer.from([0x81, 0x7f, 0x00, 0x00, 0x00, 0x00, 0x00, 0x10, 0x00, 0x01]),
	"json-null": Buffer.from([0x81, 0x04, 0x6e, 0x75, 0x6c, 0x6c]),
} as const;
type NegativeFrameCase = keyof typeof NEGATIVE_FRAMES;

const NEGATIVE_ERRORS: Record<NegativeFrameCase, RegExp> = {
	masked: /masked WebSocket frame/,
	oversize: /WebSocket frame exceeds 1 MiB/,
	"json-null": /non-object JSON message/,
};

async function exerciseNegativeFrame(name: NegativeFrameCase): Promise<void> {
	const scratch = fs.mkdtempSync(path.join(os.tmpdir(), `entwurf-codex-ws-${name}-`));
	const socketPath = path.join(scratch, "app-server.sock");
	let peer: net.Socket | undefined;
	const server = net.createServer((socket) => {
		peer = socket;
		socket.on("error", () => {
			// The client deliberately destroys this connection on the malformed frame.
		});
		let handshake = Buffer.alloc(0);
		let requestBytes = Buffer.alloc(0);
		let upgraded = false;
		let replied = false;
		socket.on("data", (incoming) => {
			let chunk = incoming;
			if (!upgraded) {
				handshake = Buffer.concat([handshake, chunk]);
				const boundary = handshake.indexOf("\r\n\r\n");
				if (boundary < 0) return;
				const request = handshake.subarray(0, boundary).toString("utf8");
				const key = request.match(/\r\nSec-WebSocket-Key:\s*([^\r\n]+)/i)?.[1]?.trim();
				if (!key) {
					socket.destroy(new Error("test client omitted Sec-WebSocket-Key"));
					return;
				}
				const accept = crypto.createHash("sha1").update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest("base64");
				chunk = handshake.subarray(boundary + 4);
				handshake = Buffer.alloc(0);
				upgraded = true;
				socket.write(
					`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`,
				);
			}
			requestBytes = Buffer.concat([requestBytes, chunk]);
			if (replied || requestBytes.length < 2) return;
			if ((requestBytes[1]! & 0x80) === 0) {
				socket.destroy(new Error("test client sent an unmasked WebSocket frame"));
				return;
			}
			replied = true;
			socket.write(NEGATIVE_FRAMES[name]);
		});
	});
	let protocol: CodexRpcProtocol | undefined;
	try {
		await new Promise<void>((resolve, reject) => {
			server.once("error", reject);
			server.listen(socketPath, () => {
				server.off("error", reject);
				resolve();
			});
		});
		protocol = await realCodexProtocolOpener.open(socketPath);
		await assert.rejects(
			() => protocol!.request("negative/check", {}),
			NEGATIVE_ERRORS[name],
			`${name} must reject the pending request through the real UDS handshake and frame parser`,
		);
	} finally {
		protocol?.close();
		peer?.destroy();
		await new Promise<void>((resolve) => server.close(() => resolve()));
		fs.rmSync(scratch, { recursive: true, force: true });
	}
}

const childCase = process.argv[2] === "--ws-negative-child" ? process.argv[3] : undefined;
if (childCase !== undefined) {
	assert.ok(childCase in NEGATIVE_FRAMES, `unknown negative frame case: ${childCase}`);
	await exerciseNegativeFrame(childCase as NegativeFrameCase);
	fs.writeSync(1, `codex WebSocket negative child rejected ${childCase}\n`);
	process.exit(0);
}

async function checkNegativeFrameBounded(name: NegativeFrameCase): Promise<void> {
	const child = spawn(process.execPath, [...process.execArgv, process.argv[1]!, "--ws-negative-child", name], {
		stdio: ["ignore", "pipe", "pipe"],
	});
	let stdout = "";
	let stderr = "";
	child.stdout.on("data", (chunk: Buffer) => {
		stdout += chunk.toString();
	});
	child.stderr.on("data", (chunk: Buffer) => {
		stderr += chunk.toString();
	});
	let timedOut = false;
	const result = await new Promise<{ code: number | null; signal: NodeJS.Signals | null; error?: Error }>((resolve) => {
		let spawnError: Error | undefined;
		const timer = setTimeout(() => {
			timedOut = true;
			child.kill("SIGKILL");
		}, 2_000);
		child.once("error", (error) => {
			spawnError = error;
		});
		child.once("close", (code, signal) => {
			clearTimeout(timer);
			resolve({ code, signal, error: spawnError });
		});
	});
	assert.equal(timedOut, false, `[QK:CODEX-NATIVE-WS-TERMINAL] ${name} held the parser child past its 2s bound`);
	assert.equal(result.code, 0, `${name} child failed (${result.error?.message ?? result.signal ?? stderr.trim()})`);
	assert.match(stdout, new RegExp(`rejected ${name}\\s*$`), `${name} did not reach its bounded rejection`);
}

await Promise.all((Object.keys(NEGATIVE_FRAMES) as NegativeFrameCase[]).map(checkNegativeFrameBounded));

assert.equal(
	resolveCodexDefaultSocketPath({ HOME: "/home/operator" }),
	"/home/operator/.codex/app-server-control/app-server-control.sock",
	"[QK:CODEX-NATIVE-FIXED-SOCKET] HOME resolves only the vendor default socket",
);
assert.equal(
	resolveCodexDefaultSocketPath({ HOME: "/ignored", CODEX_HOME: "/codex-home" }),
	"/codex-home/app-server-control/app-server-control.sock",
	"[QK:CODEX-NATIVE-FIXED-SOCKET] CODEX_HOME owns the vendor default socket root",
);

// ── the control endpoint: a plain socket, or Codex's EXACT rendezvous alias (#141) ──────────
// From Codex 0.162.1 the advertised path is a symlink to a 0600 socket the vendor binds under
// `realpath(/tmp)/codex-daemon-<euid>/`, named by the sha256 hex of the canonical advertised
// parent + "/" + basename (`[source]` rust-v0.162.1 `app-server-transport/src/transport/
// unix_socket.rs:290-304`, `uds/src/daemon_directory.rs:13-38`). The expected target below is
// derived HERE from that upstream rule, not read back from the product, and every cell builds
// its own sandbox socket directory: `daemonRoot`/`euid` point the product at it, so the real
// `/tmp/codex-daemon-<euid>` is never touched. Each refusal cell keeps every OTHER hop valid,
// so it fails on its own rule and not on a neighbour's. A real other-uid owner needs root and
// stays unmeasured; so does macOS, where `/tmp` canonicalizes to `/private/tmp`.
//
// The root and the socket directory names are SHORT on purpose: a bound socket path must fit
// sun_path (108 bytes on Linux), and a 64-hex name under a long sandbox root does not — listen
// fails with EINVAL. That limit is why the vendor keeps its own root at `/tmp/codex-daemon-<euid>`.
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "entwurf-cnp-"));
const euid = process.geteuid?.() ?? -1;
const sandboxServers: net.Server[] = [];
// A tree whose canonical path is longer than PATH_MAX can only be removed through the short
// symlinked path that reaches it, so it is removed first, before the root.
const overlongTrees: string[] = [];
try {
	const missing = checkCodexSocketFile(path.join(temp, "missing.sock"));
	assert.deepEqual(
		missing.ok ? null : [missing.status, missing.status === "dead" ? missing.layout : null],
		["dead", "absent"],
		"missing socket is a dead app-server, and says it is the absent layout",
	);
	const regular = path.join(temp, "regular");
	fs.writeFileSync(regular, "not a socket");
	const wrongType = checkCodexSocketFile(regular);
	assert.deepEqual(wrongType.ok ? null : wrongType.status, "indeterminate", "wrong path type never reads dead");

	const listen = async (socketPath: string, mode: number): Promise<void> => {
		const server = net.createServer();
		sandboxServers.push(server);
		await new Promise<void>((resolve, reject) => {
			server.once("error", reject);
			server.listen(socketPath, () => resolve());
		});
		fs.chmodSync(socketPath, mode);
	};
	const layout = (name: string): { caseRoot: string; advertised: string; daemonRoot: string; expected: string } => {
		const caseRoot = path.join(temp, name);
		const parent = path.join(caseRoot, "home", "app-server-control");
		fs.mkdirSync(parent, { recursive: true });
		const daemonRoot = path.join(caseRoot, "d");
		fs.mkdirSync(daemonRoot);
		fs.chmodSync(daemonRoot, 0o700);
		const hash = crypto
			.createHash("sha256")
			.update(`${fs.realpathSync(parent)}/app-server-control.sock`)
			.digest("hex");
		return {
			caseRoot,
			advertised: path.join(parent, "app-server-control.sock"),
			daemonRoot,
			expected: path.join(daemonRoot, hash),
		};
	};
	const classify = (advertised: string, daemonRoot: string, over: { euid?: number } = {}) =>
		checkCodexSocketFile(advertised, { daemonRoot, euid, ...over });
	const statusOf = (check: ReturnType<typeof checkCodexSocketFile>): string => (check.ok ? "ok" : check.status);

	const plainDir = path.join(temp, "plain");
	fs.mkdirSync(plainDir);
	const plain = path.join(plainDir, "app-server-control.sock");
	await listen(plain, 0o600);
	assert.deepEqual(
		classify(plain, path.join(temp, "no-daemon-dir")),
		{ ok: true, connectPath: plain },
		"(A) a plain socket owned by the effective uid is the endpoint itself — the <=0.153.4 layout is unchanged",
	);

	const exact = layout("exact");
	await listen(exact.expected, 0o600);
	fs.symlinkSync(exact.expected, exact.advertised);
	assert.deepEqual(
		classify(exact.advertised, exact.daemonRoot),
		{ ok: true, connectPath: exact.expected },
		"(B) Codex's exact rendezvous alias is accepted, and the endpoint is the verified physical socket, not the alias",
	);

	const wrongHash = layout("wrong-hash");
	const elsewhere = path.join(wrongHash.daemonRoot, "0".repeat(64));
	await listen(elsewhere, 0o600);
	fs.symlinkSync(elsewhere, wrongHash.advertised);
	const wrongHashCheck = classify(wrongHash.advertised, wrongHash.daemonRoot);
	assert.equal(
		statusOf(wrongHashCheck),
		"indeterminate",
		"[QK:CODEX-SOCKET-ALIAS-EXACT] an alias into Codex's own socket directory whose name is not the hash of THIS advertised path is refused — a valid 0600 socket in the right 0700 directory is not enough",
	);
	assert.match(JSON.stringify(wrongHashCheck), /not Codex's rendezvous alias/, "that refusal says why, by name");

	const relative = layout("relative");
	await listen(relative.expected, 0o600);
	fs.symlinkSync(path.relative(path.dirname(relative.advertised), relative.expected), relative.advertised);
	assert.equal(
		statusOf(classify(relative.advertised, relative.daemonRoot)),
		"indeterminate",
		"a relative alias target is refused even when it resolves to the expected socket",
	);

	const chain = layout("chain");
	await listen(chain.expected, 0o600);
	const hop = path.join(chain.caseRoot, "hop.sock");
	fs.symlinkSync(chain.expected, hop);
	fs.symlinkSync(hop, chain.advertised);
	assert.equal(
		statusOf(classify(chain.advertised, chain.daemonRoot)),
		"indeterminate",
		"an alias that reaches the expected socket through a second link is refused; only the vendor's one hop is accepted",
	);

	const dangling = layout("dangling");
	fs.symlinkSync(dangling.expected, dangling.advertised);
	const danglingCheck = classify(dangling.advertised, dangling.daemonRoot);
	assert.deepEqual(
		danglingCheck.ok ? null : [danglingCheck.status, danglingCheck.status === "dead" ? danglingCheck.layout : null],
		["dead", "dangling-alias"],
		"the exact alias with its socket gone is dead, named as the dangling alias the vendor itself removes on start",
	);

	const openDir = layout("dir-0755");
	await listen(openDir.expected, 0o600);
	fs.symlinkSync(openDir.expected, openDir.advertised);
	fs.chmodSync(openDir.daemonRoot, 0o755);
	assert.equal(
		statusOf(classify(openDir.advertised, openDir.daemonRoot)),
		"indeterminate",
		"a socket directory other users can enter is refused — the vendor's own rule is mode & 0o777 == 0o700",
	);

	const stickyDir = layout("dir-1700");
	await listen(stickyDir.expected, 0o600);
	fs.symlinkSync(stickyDir.expected, stickyDir.advertised);
	fs.chmodSync(stickyDir.daemonRoot, 0o1700);
	assert.deepEqual(
		classify(stickyDir.advertised, stickyDir.daemonRoot),
		{ ok: true, connectPath: stickyDir.expected },
		"a sticky 01700 socket directory is accepted: the vendor masks with 0o777, so refusing it would reject a directory Codex itself uses",
	);

	const linkedDir = layout("dir-symlink");
	await listen(linkedDir.expected, 0o600);
	fs.symlinkSync(linkedDir.expected, linkedDir.advertised);
	const realDir = path.join(linkedDir.caseRoot, "real-daemon-dir");
	fs.renameSync(linkedDir.daemonRoot, realDir);
	fs.symlinkSync(realDir, linkedDir.daemonRoot);
	assert.equal(
		statusOf(classify(linkedDir.advertised, linkedDir.daemonRoot)),
		"indeterminate",
		"a socket directory that is itself a symlink is refused, as the vendor refuses it",
	);

	const fileTarget = layout("physical-file");
	fs.writeFileSync(fileTarget.expected, "", { mode: 0o600 });
	fs.symlinkSync(fileTarget.expected, fileTarget.advertised);
	assert.equal(
		statusOf(classify(fileTarget.advertised, fileTarget.daemonRoot)),
		"indeterminate",
		"an exact alias whose target is a regular file is refused, never connected to",
	);

	const readable = layout("physical-0644");
	await listen(readable.expected, 0o644);
	fs.symlinkSync(readable.expected, readable.advertised);
	assert.equal(
		statusOf(classify(readable.advertised, readable.daemonRoot)),
		"indeterminate",
		"an exact alias whose socket group or other users can open is refused",
	);

	assert.deepEqual(
		[
			statusOf(classify(plain, path.join(temp, "no-daemon-dir"), { euid: euid + 1 })),
			statusOf(classify(exact.advertised, exact.daemonRoot, { euid: euid + 1 })),
		],
		["indeterminate", "indeterminate"],
		"ownership is compared with the EFFECTIVE uid (the vendor's geteuid): under another euid both layouts are refused",
	);

	// canonicalize(parent) failure is the alias state lstat cannot see coming. The advertised
	// path is short, but it reaches its parent through a symlink, and the parent's canonical
	// path is longer than PATH_MAX — the vendor's own `canonicalize` fails on it the same way.
	// It must be indeterminate: never dead, and never a throw the launcher would read as an
	// unrecognised status.
	const canonicalCase = path.join(temp, "canonical");
	let far = canonicalCase;
	while (far.length < 3600) far = path.join(far, "d".repeat(200));
	fs.mkdirSync(far, { recursive: true });
	const via = path.join(canonicalCase, "via");
	fs.symlinkSync(far, via);
	overlongTrees.push(path.join(via, "e".repeat(200)));
	let overlongParent = via;
	for (let i = 0; i < 4; i += 1) overlongParent = path.join(overlongParent, "e".repeat(200));
	fs.mkdirSync(overlongParent, { recursive: true });
	const overlongAdvertised = path.join(overlongParent, "app-server-control.sock");
	fs.symlinkSync(exact.expected, overlongAdvertised);
	const overlongCheck = classify(overlongAdvertised, exact.daemonRoot);
	assert.equal(
		statusOf(overlongCheck),
		"indeterminate",
		"an alias whose parent cannot be canonicalized is indeterminate",
	);
	assert.match(
		JSON.stringify(overlongCheck),
		/could not verify/,
		"that refusal names the verification it could not do",
	);
} finally {
	for (const server of sandboxServers) server.close();
	for (const tree of overlongTrees) fs.rmSync(tree, { recursive: true, force: true });
	fs.rmSync(temp, { recursive: true, force: true });
}

const firstPage = new FakeProtocol([
	{},
	{ data: ["other"], nextCursor: "next" },
	{ data: ["target"], nextCursor: null },
]);
// The check is asked about the advertised default path, and everything after it — the probe's
// connect AND the route the queue send uses — goes to the endpoint the check returned. Here
// the two are different strings, so a probe that went back to the advertised path goes red.
let checkedPath = "";
let openedPath = "";
const alive = await probeCodexThread("target", {
	env: { CODEX_HOME: "/fixed" },
	checkSocket: (advertised) => {
		checkedPath = advertised;
		return { ok: true, connectPath: "/verified/physical.sock" };
	},
	openProtocol: {
		open: async (socketPath) => {
			openedPath = socketPath;
			return firstPage;
		},
	},
});
assert.deepEqual(
	alive,
	{ status: "alive", route: { backend: "codex", socketPath: "/verified/physical.sock" } },
	"[QK:CODEX-NATIVE-LOADED-PROBE] full loaded-thread pagination proves the volatile route, on the endpoint the socket check verified",
);
assert.deepEqual(
	[checkedPath, openedPath],
	["/fixed/app-server-control/app-server-control.sock", "/verified/physical.sock"],
	"the socket check reads the advertised default path; the probe connects to the endpoint it verified, never the alias again",
);
assert.equal(firstPage.closed, true, "successful probe closes its connection");
assert.deepEqual(
	firstPage.calls.map((call) => call.method),
	["initialize", "initialized", "thread/loaded/list", "thread/loaded/list"],
);
assert.deepEqual(firstPage.calls[3]?.params, { cursor: "next" }, "pagination carries the vendor cursor");

const absentProtocol = new FakeProtocol([{}, { data: [], nextCursor: null }]);
const absent = await probeCodexThread("target", {
	env: { CODEX_HOME: "/fixed" },
	checkSocket: (advertised) => ({ ok: true, connectPath: advertised }),
	openProtocol: opener(absentProtocol),
});
assert.equal(absent.status, "dead", "a clean loaded inventory without the target is not delivery-capable");
assert.equal(absentProtocol.closed, true, "negative probe closes its connection");

const malformedProtocol = new FakeProtocol([{}, { data: [{ id: "wrong-shape" }], nextCursor: null }]);
const malformed = await probeCodexThread("target", {
	env: { CODEX_HOME: "/fixed" },
	checkSocket: (advertised) => ({ ok: true, connectPath: advertised }),
	openProtocol: opener(malformedProtocol),
});
assert.equal(malformed.status, "indeterminate", "a malformed inventory is unknown, never dead");
assert.equal(malformedProtocol.closed, true, "failed protocol probe closes its connection");

let queueArgv: readonly string[] = [];
const queueRunner: CodexExecRunner = {
	async exec(argv) {
		queueArgv = argv;
		return { code: 0, stdout: "Queued message 01a-message for thread target.\n", stderr: "" };
	},
};
const body = "quotes ' \" and\nnewlines stay one argv value";
await sendViaCodexQueue({ backend: "codex", socketPath: "/fixed/socket" }, "target", body, queueRunner);
assert.deepEqual(
	queueArgv,
	["codex", "queue", "--remote", "unix:///fixed/socket", "--thread", "target", "--message", body],
	"[QK:CODEX-NATIVE-VENDOR-QUEUE] send is one argv-safe vendor queue invocation",
);
await assert.rejects(
	() =>
		sendViaCodexQueue({ backend: "codex", socketPath: "/fixed/socket" }, "target", "body", {
			async exec() {
				return { code: 0, stdout: "Queued message id for thread another.\n", stderr: "" };
			},
		}),
	/invalid acknowledgement/,
	"an acknowledgement for another thread is not delivery evidence",
);

const titleProtocol = new FakeProtocol([{}, {}]);
await setCodexThreadName("/fixed/socket", "target", "garden-id", opener(titleProtocol));
assert.deepEqual(
	titleProtocol.calls.at(-1),
	{ method: "thread/name/set", params: { threadId: "target", name: "garden-id" } },
	"[QK:CODEX-NATIVE-VISIBLE-NAME] the vendor thread title receives the garden id",
);
assert.equal(titleProtocol.closed, true, "title update closes its connection");

// The READ half of the visible title. `setCodexThreadName` above proves birth ARMS it;
// only reading it back through the app-server proves the operator would see it, and that is
// what the first-admission LIVE acceptance asserts against the garden id. The dialect is
// held here so the metered LIVE run is not the first place a param name is checked.
const readProtocol = new FakeProtocol([{}, { thread: { id: "target", name: "20260911T064717-bc47f9" } }]);
const readThread = await readCodexThread("/fixed/socket", "target", false, opener(readProtocol));
assert.deepEqual(
	readProtocol.calls.at(-1),
	{ method: "thread/read", params: { threadId: "target", includeTurns: false } },
	"[QK:CODEX-THREAD-READ-DIALECT] the visible title is read back with the vendor's own thread/read params",
);
assert.equal(readThread.name, "20260911T064717-bc47f9", "the read view carries the live thread title");
assert.equal(readProtocol.closed, true, "the title read closes its connection");
const turnsProtocol = new FakeProtocol([{}, { thread: { id: "target", name: null, turns: [] } }]);
await readCodexThread("/fixed/socket", "target", true, opener(turnsProtocol));
assert.deepEqual(
	turnsProtocol.calls.at(-1),
	{ method: "thread/read", params: { threadId: "target", includeTurns: true } },
	"includeTurns travels as the vendor spells it — the turn items are the orphan-window recovery authority",
);
for (const malformed of [null, {}, { thread: null }, { thread: [] }]) {
	let refused = false;
	try {
		await readCodexThread("/fixed/socket", "target", false, opener(new FakeProtocol([{}, malformed])));
	} catch {
		refused = true;
	}
	assert.equal(
		refused,
		true,
		`[QK:CODEX-THREAD-READ-REFUSES-MALFORMED] a thread/read reply without a thread object is refused, never read as an empty title: ${JSON.stringify(malformed)}`,
	);
}

// ORPHAN RECOVERY, proven against the REAL renderer rather than a hand-typed sample. When a
// travelling receipt never arrives, the only records of the window a sibling opened are the
// caller's transcript and the Codex thread's tool-call result; this parser is what reads the
// handle back out of them, and a metered LIVE failure must not be the first place it is tried.
// The LONGEST shape the renderer can produce for one launch: both optional lines present,
// a real project path, a long model id. The bound this replaced (400 characters) was already
// down to 56 characters of headroom on an ordinary cwd+seat receipt.
const codexReceipt = renderFreshCall({
	ok: true,
	receipt: {
		backend: "codex",
		runtimePath: "/home/junghan/.local/share/pnpm/global/5/node_modules/@openai/codex/bin/codex",
		model: "gpt-5.6-thinking-high[extended-context]",
		cwd: "/home/junghan/repos/work/a-fairly-long-company-project/packages/backend-service/apps/worker",
		tmuxSession: "a-long-operator-project-session-name",
		windowId: "@41",
		windowIndex: "3",
		sessionId: "$7",
		paneId: "%88",
		panePid: "4242",
		nonce: "mux-fresh-call-abc123",
		serverPid: "9001",
	},
}).text;
const piReceipt = renderFreshCall({
	ok: true,
	receipt: {
		backend: "pi",
		runtimePath: "/usr/bin/pi",
		model: "provider/model",
		windowId: "@42",
		windowIndex: "4",
		sessionId: "$7",
		paneId: "%89",
		panePid: "4243",
		nonce: "mux-fresh-call-def456",
		serverPid: "9001",
	},
}).text;
assert.deepEqual(
	launchReceiptWindows(codexReceipt, "codex"),
	["@41"],
	"[QK:CODEX-ORPHAN-WINDOW-RECOVERY] the exact Codex window handle is recovered from the LONGEST receipt the renderer actually writes — cwd, seat and a long model id included, because a length bound between the backend and window lines is a guess this parser must not make",
);
// The transcript form: the same receipt with its newlines JSON-escaped, which is how the
// caller's own transcript and the Codex tool-call result actually carry it.
assert.deepEqual(
	launchReceiptWindows(JSON.stringify({ text: codexReceipt }), "codex"),
	["@41"],
	"the escaped-newline transcript form recovers the same handle",
);
assert.deepEqual(launchReceiptWindows(codexReceipt, "pi"), [], "a codex receipt never answers as a pi window");
assert.deepEqual(
	launchReceiptWindows(`${codexReceipt}\n${piReceipt}`, "pi"),
	["@42"],
	"each backend keeps its own handle",
);
assert.deepEqual(
	launchReceiptWindows("an operator mentioned @99 and window: @98 with no backend line", "codex"),
	[],
	"a bare handle with no LAUNCH receipt around it is never adopted as ours",
);
assert.deepEqual(
	launchReceiptWindows(`${codexReceipt}\nwindow:   @97 mentioned after the receipt block`, "codex"),
	["@41"],
	"one receipt names ONE window — a later stray line does not inherit its backend",
);

const adapter = createCodexNativePushAdapter({
	env: { CODEX_HOME: "/fixed" },
	checkSocket: (advertised) => ({ ok: true, connectPath: advertised }),
	openProtocol: opener(new FakeProtocol([{}, { data: ["target"], nextCursor: null }])),
	runner: queueRunner,
});
assert.equal(adapter.id, "codex");
assert.equal(adapter.retriable, false, "[QK:CODEX-NATIVE-NO-RETRY] ambiguous queue failure must never be replayed");

console.log(
	"check-codex-native-push: fixed UDS probe, terminal malformed frames, vendor queue send, no-retry policy, and the visible title's write AND read-back are green",
);
