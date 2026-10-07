/**
 * G-receive (#129 L-receive, FIRST CELL) — one mailbox message reaches an idle durable host and its
 * model drains it. CHECKOUT-ONLY dev gate: an installed package refuses it in `run_ts` before it
 * reads an input.
 *
 * EVIDENCE BOXES, kept apart and never substituted for one another:
 *   S  local scripted model protocol — a 127.0.0.1 OpenAI-compatible endpoint THIS gate serves through
 *      the app's documented `models.json` compatible-endpoint support, dummy key, no vendor. Request
 *      #1 is answered with one `entwurf_inbox_read` call — but only after the gate has captured the
 *      enqueue it must explain (the HOLD below); request #2 with text.
 *   H  actual native harness path — the host driver gives the app NO input
 *      (scripts/pi-durable-receive-host.mjs). The only thing that can start a run is the contact's
 *      doorbell admitting its notice to the ROOT conversation through the overlay's `submitToRoot`.
 *   V  an actual vendor model turn — NOT run here.
 *
 * Sender: a SEEDED claude-code citizen whose record and sender marker are owned by a separate idle
 * child of this gate, so no marker is keyed to the gate's own pid. The sending bridge is a child of
 * this gate handed that marker through the explicit carrier `ENTWURF_META_SENDER_MARKER`
 * (meta-sender-identity.ts: an explicit path is read with the live-owner guard and no ancestry scan),
 * and its own `entwurf_self` is asked who it is before it sends — the resolver's answer is measured,
 * not assumed.
 *
 * THE HOLD. The host's doorbell stamps the fresh `.msg` `.delivered` BEFORE it admits the notice, and
 * the model's `entwurf_inbox_read` archives it to `.delivered.read` — so the enqueued body exists under
 * its first name only until the ring, and under its second only until the drain. The endpoint therefore
 * withholds response #1 at the actual request #1 until this gate has captured the ENQUEUE receipt, that
 * file's `.delivered` bytes, the signal, the host's raw receiver marker and the notice; only then is
 * the tool call released. A failed capture is a named GAP thrown BEFORE release: no sleep, no timed
 * success, no fabricated tool result. `.delivered` is a wake attempt, not a read and not a native
 * commit.
 *
 * SQLITE. After every owned process is gone (reap verdict green), the durable session's
 * `session.sqlite`, `-wal`, `-shm` are copied untouched to a forensic set and, separately, to a work
 * set that alone is opened read-only. The submission is selected by the doorbell's request id in its
 * record — and the indexed `request_id` column, under upstream's JSON encoding, must agree — and its row
 * id and record id must both be the id the receiver reported, on the root conversation, an input, done,
 * whose placed entry is the notice. Without a green reap nothing is copied. Row, wire and archive side
 * effects are separate QKs.
 *
 * Intended single idle cell: controller input 0, doorbell admission 1, S requests 2, V 0.
 *
 * Inputs as check-pi-durable-contact (missing → SKIP 97, never a pass):
 *   ENTWURF_PI_DURABLE_BRIDGE_ENTRY (a bundle carrying the owner join; the durable app is this
 *   checkout's verified carrier, #130)
 * Optional:
 *   ENTWURF_PI_DURABLE_RECEIPTS  a NEW absolute directory (refused if it exists) for the cell's raw bytes.
 *
 * Every wire assertion is judged on the FINAL snapshot, after the host has exited and the endpoint is
 * closed, so a late request cannot slip past "exactly two".
 */
import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import * as fs from "node:fs";
import * as http from "node:http";
import type { AddressInfo } from "node:net";
import * as os from "node:os";
import * as path from "node:path";
import { createInterface } from "node:readline";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { metaReceiverMarkerPath, upsertMetaSession, writeMetaSenderMarker } from "../pi-extensions/lib/meta-session.ts";
import { checkPiDurableRuntime, piDurableLayoutAt } from "../pi-extensions/lib/pi-durable-runtime.ts";
import { skipLive } from "./lib/live-skip.ts";
import {
	describeOperatorSnapshot,
	operatorPiDurableSnapshot,
	operatorSnapshotUnchanged,
} from "./lib/pi-durable-operator-guard.ts";
import { ownedReapVerdict } from "./lib/pi-durable-reap.ts";
import {
	encodedRequestIdColumn,
	enqueuedFile,
	heldCaptureVerdict,
	submissionVerdict,
} from "./lib/pi-durable-receive.ts";

const LABEL = "check-pi-durable-receive";
const QK = "PRX";
const REPO = path.resolve(import.meta.dirname, "..");
const HOST_DRIVER = path.join(REPO, "scripts", "pi-durable-receive-host.mjs");
const REPORT_TIMEOUT_MS = 120_000;
/** Validity cutoff for request #1 after the ENQUEUE — a gap bound, never a success inference. */
const HOLD_WAIT_MS = 60_000;
const CLOSE_TIMEOUT_MS = 30_000;
const REAP_TIMEOUT_MS = 5_000;
const CALL_ID = "call_prx_1";
const FINAL_TEXT = "read.";

const bridgeInput = process.env.ENTWURF_PI_DURABLE_BRIDGE_ENTRY?.trim();
if (!bridgeInput) {
	skipLive(
		LABEL,
		"set ENTWURF_PI_DURABLE_BRIDGE_ENTRY=<bridge index.js emitted from this checkout into a private bundle>; " +
			"this gate does not provision it",
	);
}
const bridgeEntry = path.resolve(bridgeInput);
const receiptsInput = process.env.ENTWURF_PI_DURABLE_RECEIPTS?.trim() || undefined;
if (receiptsInput !== undefined) {
	if (!path.isAbsolute(receiptsInput)) {
		console.error(`${LABEL}: ENTWURF_PI_DURABLE_RECEIPTS must be absolute (got ${JSON.stringify(receiptsInput)})`);
		process.exit(2);
	}
	try {
		fs.mkdirSync(receiptsInput);
	} catch (error) {
		console.error(`${LABEL}: ENTWURF_PI_DURABLE_RECEIPTS must be a new directory: ${(error as Error).message}`);
		process.exit(2);
	}
}

let passed = 0;
let failed = 0;
function ok(label: string, cond: boolean): void {
	if (cond) {
		console.log(`  ok    ${label}`);
		passed++;
	} else {
		console.log(`  FAIL  ${label}`);
		failed++;
	}
}
/**
 * A prerequisite of the one cell: the SAME boolean is the QK and the guard, so a failed prerequisite
 * stops here — before the send, the wait or the release — and spends no further request.
 */
function must(label: string, cond: boolean): void {
	ok(label, cond);
	if (!cond) throw new Error(`GAP: prerequisite failed — ${label}`);
}
function fatal(message: string): never {
	console.error(`${LABEL}: ${message}`);
	process.exit(1);
}
const sha256 = (data: string | Buffer): string => createHash("sha256").update(data).digest("hex");
function canonicalJson(value: unknown): string {
	if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
	if (value !== null && typeof value === "object") {
		const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
		return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
	}
	return JSON.stringify(value);
}
function messageText(content: unknown): string {
	if (typeof content === "string") return content;
	if (Array.isArray(content)) {
		return content
			.flatMap((p) =>
				p && typeof p === "object" && typeof (p as { text?: unknown }).text === "string"
					? [(p as { text: string }).text]
					: [],
			)
			.join("\n");
	}
	return "";
}

// ---------------------------------------------------------------------------
// 0. Inputs — the verified checkout carrier, the bundle registry, and the bundle's owner join.
// ---------------------------------------------------------------------------
// The carrier and its SDK set are verified by the ONE verifier the managed launch, setup and the fresh
// preflight use (pi-extensions/lib/pi-durable-runtime.ts), from this checkout's layout.
const carrier = checkPiDurableRuntime(piDurableLayoutAt(REPO));
const resolver = carrier.ok ? carrier.resolver : "";
const bundleRoot = path.resolve(bridgeEntry, "..", "..", "..", "..");
const bundleRegistry = path.join(bundleRoot, "pi-extensions", "entwurf-capabilities.json");
const bundleDeliverability = path.join(bundleRoot, "pi-extensions", "lib", "entwurf-deliverability.js");
console.log("0. inputs");
ok(
	`[QK:${QK}-INPUTS] this checkout's pi-durable carrier and the pi SDK set it resolves are the pin (${carrier.ok ? "verified" : `${carrier.reason}: ${carrier.detail}`}), and the bridge bundle's registry matches this checkout`,
	carrier.ok &&
		fs.existsSync(bridgeEntry) &&
		fs.existsSync(bundleRegistry) &&
		fs.readFileSync(bundleRegistry).equals(fs.readFileSync(path.join(REPO, "pi", "entwurf-capabilities.json"))),
);
const joinLine = fs.existsSync(bundleDeliverability)
	? (/SENDER_JOINED_RECEIVER_OWNER_KINDS\s*=\s*(\[[^\]]*\])/.exec(fs.readFileSync(bundleDeliverability, "utf8"))?.[1] ??
		"")
	: "";
ok(
	`[QK:${QK}-BUNDLE-OWNER-JOIN] the bridge bundle's compiled owner join admits pi-durable-host (${joinLine || "not found"})`,
	joinLine.includes('"pi-durable-host"'),
);
if (failed > 0) fatal("inputs are not the verified carrier, this checkout's registry and owner join");

// Coarse pi-durable-specific operator guard (as G-contact): no operator-byte claim beyond it.
const operatorAgent = path.join(os.homedir(), ".pi", "agent");
const operatorBefore = operatorPiDurableSnapshot(operatorAgent);

// ---------------------------------------------------------------------------
// Sandbox: one private world — HOME/XDG/agent, the four garden roots and ENTWURF_DIR.
// ---------------------------------------------------------------------------
const root = fs.mkdtempSync(path.join(os.tmpdir(), "pi-durable-receive-"));
const dirs = {
	home: path.join(root, "home"),
	agent: path.join(root, "agent"),
	tmp: path.join(root, "tmp"),
	project: path.join(root, "project"),
	senderProject: path.join(root, "sender-project"),
	sessions: path.join(root, "garden", "meta-sessions"),
	senders: path.join(root, "garden", "meta-senders"),
	receivers: path.join(root, "garden", "meta-receivers"),
	mailbox: path.join(root, "garden", "meta-mailbox"),
	entwurf: path.join(root, "entwurf"),
	xdgConfig: path.join(root, "xdg", "config"),
	xdgCache: path.join(root, "xdg", "cache"),
	xdgData: path.join(root, "xdg", "data"),
	xdgState: path.join(root, "xdg", "state"),
};
for (const dir of Object.values(dirs)) fs.mkdirSync(dir, { recursive: true });
process.umask(0o022);
const env: Record<string, string> = {
	PATH: process.env.PATH ?? "/run/current-system/sw/bin",
	HOME: dirs.home,
	TMPDIR: dirs.tmp,
	XDG_CONFIG_HOME: dirs.xdgConfig,
	XDG_CACHE_HOME: dirs.xdgCache,
	XDG_DATA_HOME: dirs.xdgData,
	XDG_STATE_HOME: dirs.xdgState,
	PI_CODING_AGENT_DIR: dirs.agent,
	ENTWURF_META_SESSIONS_DIR: dirs.sessions,
	ENTWURF_META_SENDERS_DIR: dirs.senders,
	ENTWURF_META_RECEIVERS_DIR: dirs.receivers,
	ENTWURF_META_MAILBOX_DIR: dirs.mailbox,
	ENTWURF_DIR: dirs.entwurf,
	PI_OFFLINE: "1",
	NOSYSBASHRC: "1",
	TERM: "dumb",
};

// ---------------------------------------------------------------------------
// S: the scripted endpoint, with the hold at request #1.
// ---------------------------------------------------------------------------
interface WireRequest {
	method: string;
	url: string;
	body: Record<string, unknown> | null;
}
const wire: WireRequest[] = [];
let hostGid = "";
let request1Seen!: () => void;
const request1 = new Promise<void>((resolve) => {
	request1Seen = resolve;
});
let releaseRequest1!: () => void;
const request1Released = new Promise<void>((resolve) => {
	releaseRequest1 = resolve;
});
const sse = (res: http.ServerResponse, chunks: unknown[]) => {
	res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
	for (const chunk of chunks) res.write(`data: ${JSON.stringify(chunk)}\n\n`);
	res.end("data: [DONE]\n\n");
};
const chunk = (delta: Record<string, unknown>, finish: string | null) => ({
	id: "chatcmpl-prx",
	object: "chat.completion.chunk",
	created: 0,
	model: "scripted",
	choices: [{ index: 0, delta, finish_reason: finish }],
});
const usage = {
	id: "chatcmpl-prx",
	object: "chat.completion.chunk",
	created: 0,
	model: "scripted",
	choices: [],
	usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
};
/** Request #2 must be the drained turn carrying a tool result for the scripted call. */
function carriesReadResult(body: Record<string, unknown> | null): boolean {
	const messages = (body?.messages as { role?: string; tool_call_id?: string }[] | undefined) ?? [];
	return messages.some((m) => m.role === "tool" && m.tool_call_id === CALL_ID);
}
const server = http.createServer((req, res) => {
	let raw = "";
	req.on("data", (c: Buffer) => {
		raw += c.toString("utf8");
	});
	req.on("end", () => {
		let body: Record<string, unknown> | null = null;
		try {
			body = raw ? (JSON.parse(raw) as Record<string, unknown>) : null;
		} catch {
			body = null;
		}
		wire.push({ method: req.method ?? "", url: req.url ?? "", body });
		const n = wire.length;
		if (req.method === "POST" && req.url === "/v1/chat/completions" && n === 1) {
			request1Seen();
			// Withheld until the gate has captured what this request must explain. A gate that throws
			// instead never releases; the cleanup closes the socket.
			void request1Released.then(() =>
				sse(res, [
					chunk(
						{
							role: "assistant",
							tool_calls: [
								{
									index: 0,
									id: CALL_ID,
									type: "function",
									function: { name: "entwurf_inbox_read", arguments: JSON.stringify({ gardenId: hostGid }) },
								},
							],
						},
						null,
					),
					chunk({}, "tool_calls"),
					usage,
				]),
			);
		} else if (req.method === "POST" && req.url === "/v1/chat/completions" && n === 2 && carriesReadResult(body)) {
			sse(res, [chunk({ role: "assistant", content: FINAL_TEXT }, null), chunk({}, "stop"), usage]);
		} else {
			res.writeHead(500, { "content-type": "application/json" });
			res.end(
				JSON.stringify({ error: { message: `scripted endpoint: unexpected request #${n} ${req.method} ${req.url}` } }),
			);
		}
	});
});
await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
const port = (server.address() as AddressInfo).port;
fs.writeFileSync(
	path.join(dirs.agent, "models.json"),
	`${JSON.stringify(
		{
			providers: {
				loopback: {
					baseUrl: `http://127.0.0.1:${port}/v1`,
					api: "openai-completions",
					apiKey: "prx-loopback-dummy",
					models: [{ id: "scripted" }],
				},
			},
		},
		null,
		2,
	)}\n`,
);
fs.writeFileSync(
	path.join(dirs.agent, "settings.json"),
	`${JSON.stringify({ defaultProvider: "loopback", defaultModel: "scripted" }, null, 2)}\n`,
);

// ---------------------------------------------------------------------------
// Processes this gate owns, and their bounded reaping (as G-send).
// ---------------------------------------------------------------------------
function procStat(pid: number): { ppid: number; start: string } | null {
	try {
		const stat = fs.readFileSync(`/proc/${pid}/stat`, "utf8");
		const fields = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
		return { ppid: Number(fields[1]), start: fields[19] as string };
	} catch {
		return null;
	}
}
function procArgv(pid: number): string[] {
	try {
		return fs.readFileSync(`/proc/${pid}/cmdline`, "utf8").split("\0").filter(Boolean);
	} catch {
		return [];
	}
}
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
interface Owned {
	pid: number;
	start: string;
	what: string;
}
const owned: Owned[] = [];
function own(pid: number, what: string): Owned {
	const existing = owned.find((p) => p.pid === pid && p.start === (procStat(pid)?.start ?? ""));
	if (existing) return existing;
	const entry = { pid, start: procStat(pid)?.start ?? "", what };
	owned.push(entry);
	return entry;
}
const childrenObserved = new Set<number>();
/** Own every bridge that /proc shows as a DIRECT child of a live owned host (PPID + entry argv). */
function observeBridges(host: Owned): void {
	if (procStat(host.pid)?.start !== host.start) return;
	for (const pid of fs
		.readdirSync("/proc")
		.filter((n) => /^\d+$/.test(n))
		.map(Number)) {
		if (procStat(pid)?.ppid === host.pid && procArgv(pid).includes(bridgeEntry)) own(pid, "host-bridge");
	}
	childrenObserved.add(host.pid);
}
function spawned(child: ReturnType<typeof spawn>, what: string): Promise<number> {
	return new Promise((resolve, reject) => {
		child.once("spawn", () => (child.pid === undefined ? reject(new Error(`${what}: no pid`)) : resolve(child.pid)));
		child.once("error", (error) => reject(new Error(`${what} did not start: ${error.message}`)));
	});
}
const observationNotes: string[] = [];
async function reapAll(): Promise<string[]> {
	const problems: string[] = [];
	for (const host of owned.filter((p) => p.what === "host")) {
		if (procStat(host.pid)?.start === host.start) observeBridges(host);
		else if (!childrenObserved.has(host.pid)) {
			observationNotes.push(`host ${host.pid} exited before its children were observed`);
		}
	}
	for (const p of [...owned].reverse()) {
		if (procStat(p.pid)?.start !== p.start) continue;
		for (const signal of ["SIGTERM", "SIGKILL"] as const) {
			try {
				process.kill(p.pid, signal);
			} catch (error) {
				problems.push(`${p.what} ${p.pid}: ${signal} failed (${(error as Error).message})`);
			}
			const deadline = Date.now() + REAP_TIMEOUT_MS;
			while (Date.now() < deadline && procStat(p.pid)?.start === p.start) await sleep(50);
			if (procStat(p.pid)?.start !== p.start) break;
		}
		if (procStat(p.pid)?.start === p.start) problems.push(`${p.what} ${p.pid} is still alive after SIGKILL`);
	}
	return problems;
}

// ---------------------------------------------------------------------------
// The cell
// ---------------------------------------------------------------------------
interface EntrySummary {
	id: number;
	kind: string;
	role?: string;
	toolCalls: { id: string; name: string; arguments: unknown }[];
	toolCallId?: string;
	toolName?: string;
	isError?: boolean;
	diagnostics?: { severity: string; code: string; message: string }[];
	text: string;
}
interface Admission {
	why: string;
	requestId: string;
	submissionId: unknown;
	fresh: string[];
	unread: number;
}
interface ReceiverReport {
	status: string;
	gardenId?: string;
	markerPath?: string;
	reason?: string;
	detail?: string;
	admissions?: Admission[];
}
interface Born {
	born: true;
	hostPid: number;
	session: { id: string; directory: string; cwd: string };
	conversationId: number;
	attachment: { gardenId: string; bridgePid: number | null };
	receiver: ReceiverReport;
}
interface Settled {
	settled: string;
	hostPid: number;
	session: { id: string };
	conversationId: number;
	receiver: ReceiverReport;
	entries: EntrySummary[];
	busy: boolean;
	notices: string[];
	error?: string;
}
interface Held {
	enqueued: string;
	listing: string[];
	deliveredBody: string;
	signal: string;
	receiverMarker: Record<string, unknown>;
	receiverMarkerBytes: string;
	request1UserText: string;
}
interface CellContext {
	born: Born;
	settled: Settled;
	held: Held;
	listed: Map<string, unknown>;
	message: string;
	senderGid: string;
	senderRecordPath: string;
	senderMarkerPath: string;
	selfText: string;
	receipt: string;
	box: string;
}
let context: CellContext | undefined;

function lastUserText(body: Record<string, unknown> | null): string {
	const messages = (body?.messages as { role?: string; content?: unknown }[] | undefined) ?? [];
	return messageText(messages.filter((m) => m.role === "user").at(-1)?.content);
}

async function cell(): Promise<void> {
	// The sender: a separate idle child owns its record's sender marker.
	const senderOwner = spawn(process.execPath, ["-e", "setTimeout(() => {}, 600000)"], {
		stdio: "ignore",
		env,
		cwd: dirs.senderProject,
	});
	own(await spawned(senderOwner, "the sender owner"), "sender-owner");
	if (senderOwner.pid === undefined) throw new Error("the sender owner has no pid");
	const sender = upsertMetaSession({
		input: { backend: "claude-code", nativeSessionId: `prx-sender-${process.pid}`, cwd: dirs.senderProject },
		dir: dirs.sessions,
	});
	const senderGid = sender.record.gardenId;
	const senderMarkerPath = writeMetaSenderMarker({
		backend: "claude-code",
		gardenId: senderGid,
		nativeSessionId: sender.record.nativeSessionId,
		cwd: dirs.senderProject,
		ownerPid: senderOwner.pid,
		sendersDir: dirs.senders,
	});
	must(
		`[QK:${QK}-SENDER-NOT-GATE] no sender marker is keyed to this gate's pid (${process.pid}); the seeded one is owned by the idle child ${senderOwner.pid}`,
		!fs.existsSync(path.join(dirs.senders, "claude-code", `${process.pid}.json`)) &&
			!fs.existsSync(path.join(dirs.senders, "pi-durable", `${process.pid}.json`)) &&
			(JSON.parse(fs.readFileSync(senderMarkerPath, "utf8")) as { ownerPid?: unknown }).ownerPid === senderOwner.pid,
	);

	console.log("1. receive cell — doorbell admission → native turn → entwurf_inbox_read (S + H, V not run)");
	const host = spawn(process.execPath, ["--import", resolver, HOST_DRIVER, bridgeEntry], {
		cwd: dirs.project,
		env,
		stdio: ["pipe", "pipe", "pipe"],
	});
	let streamError = "";
	host.stdin?.on("error", (e) => {
		streamError += ` [host stdin error: ${e.message}]`;
	});
	const hostOwned = own(await spawned(host, "the host"), "host");
	host.on("error", (e) => {
		streamError += ` [host process error: ${e.message}]`;
	});
	let stderr = "";
	host.stderr?.on("data", (c: Buffer) => {
		stderr = (stderr + c.toString("utf8")).slice(-8192);
	});
	const lines: string[] = [];
	const waiters: ((line: string | null) => void)[] = [];
	createInterface({ input: host.stdout as NodeJS.ReadableStream })
		.on("line", (line) => {
			const w = waiters.shift();
			if (w) w(line);
			else lines.push(line);
		})
		.on("close", () => {
			for (const w of waiters.splice(0)) w(null);
		});
	let exitCode: number | null | undefined;
	const exited = new Promise<void>((resolve) =>
		host.on("exit", (code) => {
			exitCode = code;
			resolve();
		}),
	);
	const next = (ms: number) =>
		new Promise<Record<string, unknown>>((resolve, reject) => {
			const settle = (line: string | null) => {
				if (line === null)
					return reject(new Error(`host ended without a line${streamError}; stderr: ${stderr.trim()}`));
				try {
					resolve(JSON.parse(line) as Record<string, unknown>);
				} catch (error) {
					reject(new Error(`host sent a malformed line (${(error as Error).message}): ${line.slice(0, 200)}`));
				}
			};
			const queued = lines.shift();
			if (queued !== undefined) return settle(queued);
			const timer = setTimeout(
				() => reject(new Error(`gate timeout: no host line within ${ms}ms; stderr: ${stderr.trim()}`)),
				ms,
			);
			waiters.push((line) => {
				clearTimeout(timer);
				settle(line);
			});
		});

	const bornLine = await next(REPORT_TIMEOUT_MS);
	if (bornLine.error !== undefined) throw new Error(`host failed before the send: ${String(bornLine.error)}`);
	if (bornLine.born !== true) throw new Error(`host sent no born line: ${JSON.stringify(bornLine).slice(0, 200)}`);
	const born = bornLine as unknown as Born;
	hostGid = born.attachment.gardenId;
	observeBridges(hostOwned);
	if (owned.filter((p) => p.what === "host-bridge").length !== 1) {
		throw new Error("GAP: expected exactly one bridge child of the host");
	}
	const receiverFile = metaReceiverMarkerPath(hostGid, dirs.receivers);
	const armed = fs.existsSync(receiverFile)
		? (JSON.parse(fs.readFileSync(receiverFile, "utf8")) as Record<string, unknown>)
		: {};
	must(
		`[QK:${QK}-RECEIVER-ARMED] before the send: the host's raw receiver marker names its garden and durable session, owned by the spawned host (pid + /proc start key) as pi-durable-host, and its own receiver() is armed with no admission yet`,
		armed.gardenId === hostGid &&
			armed.backend === "pi-durable" &&
			armed.nativeSessionId === born.session.id &&
			armed.ownerPid === hostOwned.pid &&
			armed.ownerStartKey === `linux:${hostOwned.start}` &&
			armed.ownerKind === "pi-durable-host" &&
			born.receiver.status === "armed" &&
			born.receiver.markerPath === receiverFile &&
			(born.receiver.admissions ?? []).length === 0 &&
			born.conversationId === 1,
	);
	must(`[QK:${QK}-NO-REQUEST-BEFORE-SEND] the idle host has made no model request (${wire.length})`, wire.length === 0);

	// The sending bridge: a child of this gate, handed the seeded marker explicitly.
	const transport = new StdioClientTransport({
		command: process.execPath,
		args: [bridgeEntry],
		env: { ...env, ENTWURF_META_SENDER_MARKER: senderMarkerPath },
		cwd: dirs.senderProject,
		stderr: "pipe",
	});
	transport.stderr?.on("data", () => {});
	const client = new Client({ name: LABEL, version: "1" });
	try {
		await client.connect(transport);
	} catch (error) {
		// A failed connect may already have spawned the bridge, which is not owned yet: close the
		// transport (it ends the child it spawned) before rethrowing, and keep the cause first.
		try {
			await transport.close();
		} catch (closeError) {
			throw new AggregateError(
				[error, closeError],
				`the sending bridge did not connect (${(error as Error).message}); closing it also failed`,
			);
		}
		throw error;
	}
	const sendingPid = transport.pid;
	if (sendingPid === null) throw new Error("GAP: the sending bridge has no pid");
	own(sendingPid, "sending-bridge");
	const text = (r: Awaited<ReturnType<Client["callTool"]>>): string =>
		(Array.isArray(r.content) ? r.content : [])
			.flatMap((b) => (b.type === "text" && typeof b.text === "string" ? [b.text] : []))
			.join("\n");
	let selfText = "";
	let receipt = "";
	let listed = new Map<string, unknown>();
	const message = `prx first cell ${randomBytes(6).toString("hex")}`;
	try {
		must(
			`[QK:${QK}-SENDING-BRIDGE-OWNED] the sending bridge is this gate's direct child running the bundle (pid ${sendingPid})`,
			procStat(sendingPid)?.ppid === process.pid && procArgv(sendingPid).includes(bridgeEntry),
		);
		listed = new Map((await client.listTools()).tools.map((t) => [t.name, t.inputSchema]));
		const self = await client.callTool({ name: "entwurf_self", arguments: {} });
		selfText = text(self);
		const selfJson = (() => {
			try {
				return JSON.parse(selfText.trim().split("\n").at(-1) ?? "") as Record<string, unknown>;
			} catch {
				return {};
			}
		})();
		must(
			`[QK:${QK}-SENDER-RESOLVED] the sending bridge's own entwurf_self resolves the seeded claude-code citizen through the explicit marker (${String(selfJson.sessionId)}, ${String(selfJson.origin)}, isError ${String(self.isError === true)}); otherwise nothing is sent`,
			self.isError !== true && selfJson.sessionId === senderGid && selfJson.origin === "meta-session",
		);
		const sent = await client.callTool({
			name: "entwurf_v2",
			arguments: { target: hostGid, intent: "fire-and-forget", message, wants_reply: false },
		});
		receipt = text(sent);
		must(
			`[QK:${QK}-TRANSPORT] the send is a meta-mailbox ENQUEUE into the host's garden (${JSON.stringify(receipt)}); otherwise nothing is awaited or released`,
			sent.isError !== true && enqueuedFile(receipt) !== undefined,
		);
	} finally {
		await client.close();
	}

	// THE HOLD: request #1 must arrive (cutoff, not success timing), then everything is captured
	// before the tool call is released.
	const arrived = await Promise.race([request1.then(() => true), sleep(HOLD_WAIT_MS).then(() => false)]);
	if (!arrived) throw new Error(`GAP: no model request within ${HOLD_WAIT_MS}ms of the ENQUEUE; nothing released`);
	const box = path.join(dirs.mailbox, hostGid);
	const enqueued = enqueuedFile(receipt);
	const listing = fs.existsSync(box) ? fs.readdirSync(box).sort() : [];
	const deliveredPath = enqueued === undefined ? "" : path.join(box, `${enqueued}.delivered`);
	const deliveredBody =
		enqueued !== undefined && fs.existsSync(deliveredPath) ? fs.readFileSync(deliveredPath, "utf8") : null;
	const signalPath = path.join(box, "inbox.signal");
	const receiverMarkerBytes = fs.existsSync(receiverFile) ? fs.readFileSync(receiverFile, "utf8") : null;
	const receiverMarker =
		receiverMarkerBytes === null ? null : (JSON.parse(receiverMarkerBytes) as Record<string, unknown>);
	const request1Body = wire[0]?.body ?? null;
	const request1Tools = ((request1Body?.tools as { function?: { name?: string } }[] | undefined) ?? []).map(
		(t) => t.function?.name ?? "",
	);
	const request1UserText = lastUserText(request1Body);
	const hold = heldCaptureVerdict({
		hostGid,
		hostPid: hostOwned.pid,
		hostStartKey: hostOwned.start,
		enqueued,
		listing,
		deliveredBody,
		sentMessage: message,
		signalPresent: fs.existsSync(signalPath),
		receiverMarker,
		request1UserText,
		request1Tools,
	});
	ok(
		`[QK:${QK}-HELD-CAPTURE] at the withheld request #1: ${enqueued ?? "?"} is stamped .delivered with the sent bytes, the signal and the host-owned receiver marker are in place, and the request is the one-message notice naming the garden and entwurf_inbox_read without the body${hold.ok ? "" : ` — refused: ${hold.reasons.join("; ")}`}`,
		hold.ok,
	);
	if (
		!hold.ok ||
		enqueued === undefined ||
		deliveredBody === null ||
		receiverMarker === null ||
		receiverMarkerBytes === null
	) {
		throw new Error(`GAP: the hold capture failed (${hold.reasons.join("; ")}); request #1 is not released`);
	}
	const held: Held = {
		enqueued,
		listing,
		deliveredBody,
		signal: fs.readFileSync(signalPath, "utf8"),
		receiverMarker,
		receiverMarkerBytes,
		request1UserText,
	};
	releaseRequest1();

	const settledLine = await next(REPORT_TIMEOUT_MS);
	if (settledLine.error !== undefined)
		throw new Error(`host failed: ${String(settledLine.error)}; stderr: ${stderr.trim()}`);
	const settled = settledLine as unknown as Settled;
	const requestId = `entwurf-doorbell:${hostGid}:${enqueued}`;
	const admissions = settled.receiver.admissions ?? [];
	ok(
		`[QK:${QK}-ROOT-ADMISSION-REPORTED] the receiver reports its latest admission — by signal, for ${enqueued}, with request id ${requestId} and a submission id — and it is still armed; exactly-once is witnessed by NATIVE-DOORBELL-ENTRY/ROW (${JSON.stringify(admissions)})`,
		settled.settled === "answered" &&
			settled.receiver.status === "armed" &&
			admissions.length === 1 &&
			admissions[0]?.why === "signal" &&
			admissions[0]?.requestId === requestId &&
			JSON.stringify(admissions[0]?.fresh) === JSON.stringify([enqueued]) &&
			admissions[0]?.unread === 1 &&
			Number.isSafeInteger(admissions[0]?.submissionId),
	);
	const users = settled.entries.filter((e) => e.kind === "pi.user");
	const calls = settled.entries.filter((e) => e.kind === "pi.assistant").flatMap((e) => e.toolCalls);
	const results = settled.entries.filter((e) => e.kind === "pi.tool-result");
	const lastAssistant = settled.entries.filter((e) => e.kind === "pi.assistant").at(-1);
	ok(
		`[QK:${QK}-NATIVE-DOORBELL-ENTRY] the root conversation's one user entry is the notice the model received — no other input was given`,
		users.length === 1 && users[0]?.text === request1UserText && settled.conversationId === 1,
	);
	ok(
		`[QK:${QK}-NATIVE-DRAIN] the native view records one entwurf_inbox_read call for the host's garden and its non-error result carrying the delivered bytes and the read receipt`,
		calls.length === 1 &&
			calls[0]?.id === CALL_ID &&
			calls[0]?.name === "entwurf_inbox_read" &&
			canonicalJson(calls[0]?.arguments) === canonicalJson({ gardenId: hostGid }) &&
			results.length === 1 &&
			results[0]?.toolCallId === CALL_ID &&
			results[0]?.isError === false &&
			(results[0]?.text ?? "").includes(deliveredBody) &&
			(results[0]?.text ?? "").includes("lastReadAt="),
	);
	ok(
		`[QK:${QK}-NATIVE-TURN-SETTLED] the turn ends on the scripted text and the conversation is idle (last: ${JSON.stringify(lastAssistant?.text)}, busy ${settled.busy})`,
		lastAssistant?.text === FINAL_TEXT && lastAssistant.toolCalls.length === 0 && settled.busy === false,
	);

	// --- raw archive, read here (a separate side effect from the native result and the row)
	const after = fs.existsSync(box) ? fs.readdirSync(box).sort() : [];
	const readPath = path.join(box, `${enqueued}.delivered.read`);
	const state = fs.existsSync(path.join(box, "state.json"))
		? (JSON.parse(fs.readFileSync(path.join(box, "state.json"), "utf8")) as { lastReadAt?: unknown })
		: {};
	ok(
		`[QK:${QK}-ARCHIVE] the drained body is archived as ${enqueued}.delivered.read with the held bytes, nothing unread is left, and the mailbox state carries a read receipt (${after.join(", ")})`,
		fs.existsSync(readPath) &&
			fs.readFileSync(readPath, "utf8") === deliveredBody &&
			!after.some((n) => n.endsWith(".msg") || n.endsWith(".msg.delivered")) &&
			typeof state.lastReadAt === "string",
	);

	context = {
		born,
		settled,
		held,
		listed,
		message,
		senderGid,
		senderRecordPath: sender.path,
		senderMarkerPath,
		selfText,
		receipt,
		box,
	};
	host.stdin?.write("close\n");
	const closed = await next(CLOSE_TIMEOUT_MS);
	await Promise.race([exited, sleep(CLOSE_TIMEOUT_MS)]);
	ok(
		`[QK:${QK}-CLOSE] the host closes and exits 0, and its close removed the receiver marker it owned (closed ${String(closed.closed)}, exit ${exitCode})`,
		closed.closed === true && exitCode === 0 && !fs.existsSync(receiverFile),
	);
}

/** The wire assertions, judged on the closed run's final snapshot. */
function finalWire(ctx: CellContext): void {
	console.log("3. wire, final snapshot (host exited, endpoint closed)");
	const first = wire[0]?.body ?? {};
	const offered = new Map(
		((first.tools as { function?: { name?: string; parameters?: unknown } }[] | undefined) ?? []).map((t) => [
			t.function?.name ?? "",
			t.function?.parameters,
		]),
	);
	ok(
		`[QK:${QK}-WIRE-INBOX-READ-SCHEMA-IS-BRIDGE] the entwurf_inbox_read parameters on the wire are the bridge's own tools/list inputSchema, as this gate listed it`,
		ctx.listed.has("entwurf_inbox_read") &&
			canonicalJson(offered.get("entwurf_inbox_read")) === canonicalJson(ctx.listed.get("entwurf_inbox_read")),
	);
	ok(
		`[QK:${QK}-WIRE-TWO-REQUESTS] over the whole closed run the endpoint saw exactly the two scripted requests, nothing unexpected (${wire.map((w) => `${w.method} ${w.url}`).join(" | ")})`,
		!server.listening &&
			wire.length === 2 &&
			wire.every((w) => w.method === "POST" && w.url === "/v1/chat/completions"),
	);
	const second =
		(wire[1]?.body?.messages as { role?: string; tool_call_id?: string; content?: unknown }[] | undefined) ?? [];
	const toolMessages = second.filter((m) => m.role === "tool");
	const wireResult = messageText(toolMessages[0]?.content);
	const viewText = ctx.settled.entries.find((e) => e.kind === "pi.tool-result")?.text ?? "";
	ok(
		`[QK:${QK}-WIRE-DRAIN] the second request carries ${CALL_ID}'s tool result: the delivered bytes, exactly as the native view recorded them`,
		toolMessages.length === 1 &&
			toolMessages[0]?.tool_call_id === CALL_ID &&
			wireResult.includes(ctx.held.deliveredBody) &&
			wireResult === viewText,
	);
}

interface SqliteInspection {
	forensic: Record<string, string | null>;
	forensicDir: string;
	row: Record<string, unknown> | null;
	record: Record<string, unknown> | null;
	rowsForRequest: number;
	rowsForColumn: number;
	entry: Record<string, unknown> | null;
}

/** After a green reap only: forensic copy of the quiescent set, then a read-only look at a separate work copy. */
async function inspectSubmission(ctx: CellContext): Promise<SqliteInspection> {
	const forensicDir = path.join(root, "forensic");
	const workDir = path.join(root, "forensic-work");
	fs.mkdirSync(forensicDir);
	fs.mkdirSync(workDir);
	const forensic: Record<string, string | null> = {};
	for (const name of ["session.sqlite", "session.sqlite-wal", "session.sqlite-shm"]) {
		const from = path.join(ctx.born.session.directory, name);
		if (fs.existsSync(from)) {
			fs.copyFileSync(from, path.join(forensicDir, name));
			fs.copyFileSync(from, path.join(workDir, name));
			forensic[name] = sha256(fs.readFileSync(path.join(forensicDir, name)));
		} else forensic[name] = null;
	}
	const requestId = ctx.settled.receiver.admissions?.[0]?.requestId ?? "";
	const { DatabaseSync } = await import("node:sqlite");
	try {
		const db = new DatabaseSync(path.join(workDir, "session.sqlite"), { readOnly: true });
		try {
			// Every row, selected by its parsed RECORD; the indexed column is counted separately under
			// upstream's own encoding, so neither reading is trusted alone.
			const all = db.prepare("SELECT id, conversation_id, request_id, status, record FROM submissions").all() as {
				id: number;
				conversation_id: number;
				request_id: string | null;
				status: string;
				record: string;
			}[];
			const rows = all.filter((r) => (JSON.parse(r.record) as { requestId?: unknown }).requestId === requestId);
			const rowsForColumn = all.filter((r) => r.request_id === encodedRequestIdColumn(requestId)).length;
			const row = rows[0] ?? null;
			const record = row === null ? null : (JSON.parse(row.record) as Record<string, unknown>);
			const entryRow =
				record !== null && typeof record.entry === "number"
					? (db.prepare("SELECT id, record FROM entries WHERE id = ?").get(record.entry) as
							| { id: number; record: string }
							| undefined)
					: undefined;
			return {
				forensic,
				forensicDir,
				row:
					row === null
						? null
						: { id: row.id, conversation_id: row.conversation_id, request_id: row.request_id, status: row.status },
				record,
				rowsForRequest: rows.length,
				rowsForColumn,
				entry: entryRow === undefined ? null : (JSON.parse(entryRow.record) as Record<string, unknown>),
			};
		} finally {
			db.close();
		}
	} catch (error) {
		throw new Error(`GAP: the copied durable database could not be inspected read-only: ${(error as Error).message}`);
	}
}

/** Copy the cell's raw bytes into the receipts directory, with a correlation summary. */
function exportReceipts(dir: string, ctx: CellContext | undefined, sqlite: SqliteInspection | undefined): void {
	const files: Record<string, string> = {};
	const write = (name: string, bytes: string | Buffer) => {
		const file = path.join(dir, name);
		fs.mkdirSync(path.dirname(file), { recursive: true });
		fs.writeFileSync(file, bytes);
		files[name] = sha256(bytes);
	};
	const copy = (name: string, from: string) => write(name, fs.readFileSync(from));
	write("wire.json", `${JSON.stringify(wire, null, 1)}\n`);
	if (ctx === undefined) {
		write("correlation.json", `${JSON.stringify({ completed: false, files }, null, 1)}\n`);
		return;
	}
	write("bridge-tools.json", `${JSON.stringify(Object.fromEntries(ctx.listed), null, 1)}\n`);
	write(
		"native-view.json",
		`${JSON.stringify(
			{
				label:
					"PROJECTION of the durable app's native view and the contact's receiver() by scripts/pi-durable-receive-host.mjs — not native internal state",
				born: ctx.born,
				settled: ctx.settled,
			},
			null,
			1,
		)}\n`,
	);
	write(
		"held-capture.json",
		`${JSON.stringify({ label: "captured while response #1 was withheld", ...ctx.held }, null, 1)}\n`,
	);
	write(`garden/host-receiver-marker-at-hold/${hostGid}.json`, ctx.held.receiverMarkerBytes);
	for (const name of fs.existsSync(ctx.box) ? fs.readdirSync(ctx.box) : [])
		copy(`mailbox/${name}`, path.join(ctx.box, name));
	copy(`garden/sender-record/${path.basename(ctx.senderRecordPath)}`, ctx.senderRecordPath);
	copy(`garden/sender-marker/${path.basename(ctx.senderMarkerPath)}`, ctx.senderMarkerPath);
	const hostRecord = fs
		.readdirSync(dirs.sessions)
		.filter((n) => n.endsWith(".meta.json"))
		.find(
			(n) =>
				(JSON.parse(fs.readFileSync(path.join(dirs.sessions, n), "utf8")) as { backend?: string }).backend ===
				"pi-durable",
		);
	if (hostRecord === undefined) throw new Error("no pi-durable record to export");
	copy(`garden/host-record/${hostRecord}`, path.join(dirs.sessions, hostRecord));
	copy(
		`garden/host-sender-marker/${ctx.born.hostPid}.json`,
		path.join(dirs.senders, "pi-durable", `${ctx.born.hostPid}.json`),
	);
	if (sqlite !== undefined) {
		for (const [name, digest] of Object.entries(sqlite.forensic)) {
			if (digest !== null) copy(`forensic-sqlite/${name}`, path.join(sqlite.forensicDir, name));
		}
		const { forensicDir: _dir, ...inspection } = sqlite;
		write("sqlite-inspection.json", `${JSON.stringify(inspection, null, 1)}\n`);
	}
	write(
		"correlation.json",
		`${JSON.stringify(
			{
				completed: true,
				hostGardenId: hostGid,
				senderGardenId: ctx.senderGid,
				senderSelf: ctx.selfText,
				receipt: ctx.receipt,
				enqueued: ctx.held.enqueued,
				admission: ctx.settled.receiver.admissions?.[0] ?? null,
				wireRequests: wire.length,
				files,
			},
			null,
			1,
		)}\n`,
	);
}

let primary: unknown;
try {
	await cell();
} catch (error) {
	primary = error;
}
const cleanupProblems = await reapAll();
server.closeAllConnections();
const endpointClosed = await Promise.race([
	new Promise<boolean>((resolve) => server.close(() => resolve(true))),
	sleep(REAP_TIMEOUT_MS).then(() => false),
]);
console.log("2. cleanup, database and operator guard");
const alive = owned.filter((p) => procStat(p.pid)?.start === p.start);
const reap = ownedReapVerdict({
	alive: alive.map((p) => p.pid),
	problems: cleanupProblems,
	endpointClosed,
	endpointListening: server.listening,
	observationNotes,
});
ok(
	`[QK:${QK}-OWNED-REAPED] every process this gate owns is gone, every owned host's children were observed, and the endpoint is closed (${owned.map((p) => `${p.what} ${p.pid}`).join(", ") || "none"}; ${reap.green ? "complete" : reap.reasons.join("; ")})`,
	reap.green,
);
let sqlite: SqliteInspection | undefined;
if (context !== undefined) {
	if (!reap.green) {
		ok(`[QK:${QK}-ROW] GAP: owned processes were not all gone; the live database is not copied`, false);
	} else {
		try {
			sqlite = await inspectSubmission(context);
			const admission = context.settled.receiver.admissions?.[0];
			const row = submissionVerdict(
				{
					row: sqlite.row,
					record: sqlite.record,
					rowsForRequest: sqlite.rowsForRequest,
					rowsForColumn: sqlite.rowsForColumn,
					entry: sqlite.entry as { kind?: unknown; model?: { role?: unknown; content?: unknown }[] } | null,
				},
				{
					submissionId: admission?.submissionId,
					requestId: admission?.requestId ?? "",
					notice: context.held.request1UserText,
				},
			);
			ok(
				`[QK:${QK}-ROW] the copied database holds one input submission for the doorbell's request id on the root conversation, with the reported id, done, its placed entry the notice (files ${JSON.stringify(sqlite.forensic)})${row.ok ? "" : ` — refused: ${row.reasons.join("; ")}`}`,
				row.ok,
			);
		} catch (error) {
			ok(`[QK:${QK}-ROW] ${(error as Error).message}`, false);
		}
	}
	finalWire(context);
}
if (receiptsInput !== undefined) {
	try {
		exportReceipts(receiptsInput, context, sqlite);
		ok(`[QK:${QK}-RECEIPTS-EXPORTED] the cell's raw bytes and correlation are in ${receiptsInput}`, true);
	} catch (error) {
		ok(`[QK:${QK}-RECEIPTS-EXPORTED] receipt export failed: ${(error as Error).message}`, false);
	}
}
ok(
	`[QK:${QK}-OPERATOR-UNTOUCHED] coarse pi-durable registration guard: this run left the operator's pi-durable registrations exactly as it found them (${describeOperatorSnapshot(operatorBefore)} — same names, same bytes; existing state is not a red; no auth or session content read)`,
	operatorSnapshotUnchanged(operatorBefore, operatorPiDurableSnapshot(operatorAgent)),
);
if (alive.length > 0) console.log(`sandbox kept because owned processes are still alive: ${root}`);
else if (process.env.ENTWURF_PI_DURABLE_KEEP === "1") console.log(`sandbox kept: ${root}`);
else fs.rmSync(root, { recursive: true, force: true });
if (primary !== undefined)
	console.error(`${LABEL}: FAILED — ${primary instanceof Error ? primary.message : String(primary)}`);
for (const problem of cleanupProblems) console.error(`${LABEL}: cleanup — ${problem}`);
console.log(
	`\n${LABEL}: ${passed} passed, ${failed} failed — S (scripted endpoint) + H (doorbell admission); V not run; checkout-only`,
);
process.exit(primary === undefined && failed === 0 && reap.green ? 0 : 1);
