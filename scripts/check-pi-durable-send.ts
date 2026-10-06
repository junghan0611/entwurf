/**
 * G-send (#129 L-send, FIRST CELL) — one native durable turn sends one `entwurf_v2`.
 * CHECKOUT-ONLY dev gate: an installed package refuses it in `run_ts` before it reads an input.
 *
 * EVIDENCE BOXES, kept apart and never substituted for one another:
 *   S  local scripted model protocol — a 127.0.0.1 OpenAI-compatible endpoint THIS gate serves,
 *      configured through the app's documented `models.json` compatible-endpoint support. It
 *      answers the first request with exactly one `entwurf_v2` tool call and the second with text.
 *      No vendor, no credential (a literal dummy key), no runtime or provider patch.
 *   H  actual native harness path — the app's own controller input → GenerationTask → ToolTask →
 *      the adapter's registered tool → the private compiled bridge. The host driver submits once
 *      and only watches the native view (scripts/pi-durable-send-host.mjs).
 *   V  an actual vendor model turn — NOT run here.
 *
 * Target: a SEEDED self-fetch fixture (the check-bridge-delivery C2 recipe): one claude-code
 * record whose sender and receiver markers are owned by a separate idle child of this gate —
 * outside the gate → host → bridge ancestry the bridge scans for its own sender, so the host's
 * pi-durable marker is the only identity in that chain. Delivery here means a physical .msg and a
 * poked inbox.signal for this one forced call: not a recipient turn, not exactly-once, not recovery.
 *
 * Independent oracles: the wire (what the app sent the endpoint), the raw private store and
 * mailbox, the bridge's own tools/list as asked by this gate, and the native view the host
 * reports. None imports the adapter's expected constants.
 *
 * Inputs as check-pi-durable-contact (missing → SKIP 97, never a pass):
 *   ENTWURF_PI_DURABLE_RUNTIME, ENTWURF_PI_DURABLE_BRIDGE_ENTRY
 * Optional:
 *   ENTWURF_PI_DURABLE_RECEIPTS     a NEW absolute directory (refused if it exists) that receives the
 *                                   cell's raw bytes: wire.json, bridge-tools.json, native-view.json (a
 *                                   projection by the host driver, not native internals), the landed
 *                                   mailbox files, the raw host/target records and markers, and a
 *                                   correlation.json. Export failure fails the gate; cleanup still runs.
 *   ENTWURF_PI_DURABLE_SEND_FAULT   `malformed-report`: the gate's own cleanup control — the host
 *                                   driver births, sends a non-JSON report line and gives the app no
 *                                   input; the gate must fail for that cause and still reap.
 *
 *   ENTWURF_PI_DURABLE_SEND_CELL    `valid` (default); `invalid-args` — the scripted call omits the
 *                                   REQUIRED `intent`, and the app's own validation must settle it as
 *                                   `invalid_arguments`; `reject-undeliverable` — valid arguments, a
 *                                   target with no receiver marker, and the bridge must refuse by name
 *                                   (`mailbox-undeliverable`), surfacing natively as `tool_error`.
 *                                   Unknown selector exits 2 before anything spawns.
 *
 * Both cells read the bridge child's kernel counters (/proc/<pid>/io `rchar`, `syscr`) at sampled
 * points: idleA, idleB (one sampled idle window), beforeGo (just before the one native input) and
 * afterSettle (after the turn settles, before any close). The valid cell is the CALIBRATION: both
 * counters must rise over beforeGo→afterSettle. The invalid cell must leave both unchanged — "no
 * additional counted reads over the observed interval", NOT an interception of RPC writes or of
 * adapter.execute. An unreadable counter, idle movement or a missing rise is a named GAP.
 *
 * Every wire assertion is judged on the FINAL snapshot, after the host has exited and the endpoint
 * is closed, so a late request cannot slip past "exactly two".
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
import {
	metaReceiverMarkerPath,
	upsertMetaSession,
	writeMetaReceiverMarker,
	writeMetaSenderMarker,
} from "../pi-extensions/lib/meta-session.ts";
import {
	inspectPiDurableRuntime,
	PI_DURABLE_RESOLVER_RELATIVE,
	readPiDurablePin,
} from "../pi-extensions/lib/pi-durable-runtime.ts";
import { skipLive } from "./lib/live-skip.ts";
import { checkpointVerdict, intentFrameVerdict, preCopyVerdict } from "./lib/pi-durable-r1.ts";
import { ownedReapVerdict } from "./lib/pi-durable-reap.ts";

const LABEL = "check-pi-durable-send";
const REPO = path.resolve(import.meta.dirname, "..");
const OVERLAY = path.join(REPO, "pi", "pi-durable", "overlay");
const HOST_DRIVER = path.join(REPO, "scripts", "pi-durable-send-host.mjs");
const REPORT_TIMEOUT_MS = 120_000;
const CLOSE_TIMEOUT_MS = 30_000;
const REAP_TIMEOUT_MS = 5_000;
const CELL = process.env.ENTWURF_PI_DURABLE_SEND_CELL?.trim() || "valid";
if (CELL !== "valid" && CELL !== "invalid-args" && CELL !== "reject-undeliverable" && CELL !== "r1-unsafe-recovery") {
	console.error(
		`check-pi-durable-send: unknown ENTWURF_PI_DURABLE_SEND_CELL ${JSON.stringify(CELL)} (only "valid", "invalid-args", "reject-undeliverable", "r1-unsafe-recovery")`,
	);
	process.exit(2);
}
const VALID = CELL === "valid";
/** invalid-args: the scripted call omits the REQUIRED `intent`; native validation must settle it. */
const INVALID = CELL === "invalid-args";
/**
 * reject-undeliverable: valid arguments reach the bridge, whose target is the same seeded record and
 * sender marker as the valid cell with ONE declared cause axis changed — no receiver marker — so the
 * bridge must refuse it by name. Fresh ids, nonce and pids differ run to run; that is not a
 * byte-identical one-variable fixture.
 */
const REJECT = CELL === "reject-undeliverable";
/**
 * r1-unsafe-recovery: the native ToolTask commits the call's intent while the host's own bridge is
 * paused, so the bridge reads no request; the host is killed, the session is reopened with no new
 * input, and the call must settle as interrupted without the tool implementation running again.
 */
const R1 = CELL === "r1-unsafe-recovery";
const QK = INVALID ? "PDI" : REJECT ? "PDR" : R1 ? "PR1" : "PDS";
const CALL_ID = INVALID ? "call_pdi_1" : REJECT ? "call_pdr_1" : R1 ? "call_pr1_1" : "call_pds_1";
const FINAL_TEXT = INVALID ? "invalid noted." : REJECT ? "reject noted." : R1 ? "recovered." : "sent.";
/** The committed-intent frame must arrive within this of `go` — a validity cutoff under the MCP
 * SDK's 60s request timeout, never an elapsed-time success inference. */
const INTENT_DEADLINE_MS = 30_000;
const INTERRUPTED_MESSAGE = "Tool entwurf_v2 was interrupted and may have partially run";
/** One sampled idle window between two counter reads, before the input. Not a quiescence proof. */
const IDLE_SAMPLE_MS = 300;

const runtimeInput = process.env.ENTWURF_PI_DURABLE_RUNTIME?.trim();
const bridgeInput = process.env.ENTWURF_PI_DURABLE_BRIDGE_ENTRY?.trim();
if (!runtimeInput || !bridgeInput) {
	skipLive(
		LABEL,
		"set ENTWURF_PI_DURABLE_RUNTIME=<overlay checkout at the pin, patch applied, deps and model data installed> and " +
			"ENTWURF_PI_DURABLE_BRIDGE_ENTRY=<bridge index.js emitted from this checkout into a private bundle>; " +
			"this gate provisions neither",
	);
}
const runtime = path.resolve(runtimeInput);
const bridgeEntry = path.resolve(bridgeInput);
const FAULT = process.env.ENTWURF_PI_DURABLE_SEND_FAULT?.trim() || undefined;
if (FAULT !== undefined && FAULT !== "malformed-report") {
	console.error(`${LABEL}: unknown ENTWURF_PI_DURABLE_SEND_FAULT ${JSON.stringify(FAULT)} (only "malformed-report")`);
	process.exit(2);
}
const receiptsInput = process.env.ENTWURF_PI_DURABLE_RECEIPTS?.trim() || undefined;
if (receiptsInput !== undefined) {
	// Fail closed BEFORE anything is spawned: absolute, and a directory this run creates itself.
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
/** Pre-spawn only. */
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

// ---------------------------------------------------------------------------
// 0. Inputs — the same pinned overlay / model data / bundle registry facts as G-contact.
// ---------------------------------------------------------------------------
// The pin and the runtime facts come from the ONE verifier the managed launch, setup and the fresh
// preflight use (pi-extensions/lib/pi-durable-runtime.ts).
const { pin } = readPiDurablePin(OVERLAY);
const facts = inspectPiDurableRuntime(runtime, OVERLAY);
const resolver = path.join(runtime, PI_DURABLE_RESOLVER_RELATIVE);
const bundleRegistry = path.join(
	path.resolve(bridgeEntry, "..", "..", "..", ".."),
	"pi-extensions",
	"entwurf-capabilities.json",
);
console.log("0. inputs");
ok(
	`[QK:${QK}-INPUTS] runtime is the pin with exactly the tracked overlay (index == HEAD, nothing staged), the pin's ignored model data, the resolver, and a bridge bundle whose registry matches this checkout`,
	facts.gitAnswered &&
		facts.head === pin.commit &&
		facts.indexMatchesHead &&
		facts.diffEqualsPatch &&
		facts.untracked === "" &&
		facts.modelDataFiles === pin.modelData.files &&
		facts.modelDataAggregate === pin.modelData.aggregateSha256 &&
		facts.manifestSha256 === pin.modelData.manifestSha256 &&
		facts.resolverPresent &&
		fs.existsSync(bridgeEntry) &&
		fs.existsSync(bundleRegistry) &&
		fs.readFileSync(bundleRegistry).equals(fs.readFileSync(path.join(REPO, "pi", "entwurf-capabilities.json"))),
);
// The bundle's compiled owner join decides the armed host's replyability in the landed body.
const bundleDeliverability = path.join(
	path.resolve(bridgeEntry, "..", "..", "..", ".."),
	"pi-extensions",
	"lib",
	"entwurf-deliverability.js",
);
const joinLine = fs.existsSync(bundleDeliverability)
	? (/SENDER_JOINED_RECEIVER_OWNER_KINDS\s*=\s*(\[[^\]]*\])/.exec(fs.readFileSync(bundleDeliverability, "utf8"))?.[1] ??
		"")
	: "";
ok(
	`[QK:${QK}-BUNDLE-OWNER-JOIN] the bridge bundle's compiled owner join admits pi-durable-host (${joinLine || "not found"})`,
	joinLine.includes('"pi-durable-host"'),
);
if (failed > 0)
	fatal("inputs are not the pinned overlay, its model data, this checkout's registry and owner join — refusing to run");

// Coarse pi-durable-specific operator guard (as G-contact): no operator-byte claim beyond it.
const operatorAgent = path.join(os.homedir(), ".pi", "agent");
function operatorPiDurableFacts(): string {
	const sessions = path.join(operatorAgent, "meta-sessions");
	const durableRecords = fs.existsSync(sessions)
		? fs
				.readdirSync(sessions)
				.filter((n) => n.endsWith(".meta.json"))
				.filter((n) => {
					try {
						return (
							(JSON.parse(fs.readFileSync(path.join(sessions, n), "utf8")) as { backend?: unknown }).backend ===
							"pi-durable"
						);
					} catch {
						return false;
					}
				})
		: [];
	return JSON.stringify({
		durableRecords,
		senders: fs.existsSync(path.join(operatorAgent, "meta-senders", "pi-durable")),
		durableSessions: fs.existsSync(path.join(operatorAgent, "experimental", "durable-sessions")),
	});
}
const operatorBefore = operatorPiDurableFacts();

// ---------------------------------------------------------------------------
// Sandbox: one private world — HOME/XDG/agent, the four garden roots and ENTWURF_DIR.
// ---------------------------------------------------------------------------
const root = fs.mkdtempSync(path.join(os.tmpdir(), "pi-durable-send-"));
const dirs = {
	home: path.join(root, "home"),
	agent: path.join(root, "agent"),
	tmp: path.join(root, "tmp"),
	project: path.join(root, "project"),
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
const hostEnv: Record<string, string> = {
	...env,
	...(FAULT === undefined ? {} : { ENTWURF_PI_DURABLE_SEND_FAULT: FAULT }),
};

// ---------------------------------------------------------------------------
// S: the scripted endpoint. It records every request; anything beyond the two it scripts is
// answered 500 and counted, never satisfied.
// ---------------------------------------------------------------------------
interface WireRequest {
	method: string;
	url: string;
	body: Record<string, unknown> | null;
}
const wire: WireRequest[] = [];
let scriptedArgs: Record<string, unknown> = {};
const sse = (res: http.ServerResponse, chunks: unknown[]) => {
	res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
	for (const chunk of chunks) res.write(`data: ${JSON.stringify(chunk)}\n\n`);
	res.end("data: [DONE]\n\n");
};
const chunk = (delta: Record<string, unknown>, finish: string | null) => ({
	id: "chatcmpl-pds",
	object: "chat.completion.chunk",
	created: 0,
	model: "scripted",
	choices: [{ index: 0, delta, finish_reason: finish }],
});
const usage = {
	id: "chatcmpl-pds",
	object: "chat.completion.chunk",
	created: 0,
	model: "scripted",
	choices: [],
	usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
};
/** R1's second request must be the recovered turn carrying the interrupted result for the call. */
function isRecoveryRequest(body: Record<string, unknown> | null): boolean {
	const messages = (body?.messages as { role?: string; tool_call_id?: string; content?: unknown }[] | undefined) ?? [];
	return messages.some(
		(m) =>
			m.role === "tool" && m.tool_call_id === CALL_ID && JSON.stringify(m.content ?? "").includes("was interrupted"),
	);
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
			sse(res, [
				chunk(
					{
						role: "assistant",
						tool_calls: [
							{
								index: 0,
								id: CALL_ID,
								type: "function",
								function: { name: "entwurf_v2", arguments: JSON.stringify(scriptedArgs) },
							},
						],
					},
					null,
				),
				chunk({}, "tool_calls"),
				usage,
			]);
		} else if (
			req.method === "POST" &&
			req.url === "/v1/chat/completions" &&
			n === 2 &&
			(!R1 || isRecoveryRequest(body))
		) {
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
					apiKey: "pds-loopback-dummy",
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
// Processes this gate owns, and their bounded reaping.
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
	/** Paused by this gate with SIGSTOP: reaped with SIGKILL only, never left stopped. */
	stopped?: boolean;
}
const owned: Owned[] = [];
/**
 * Owned under `start`: for a bridge, the start key of the snapshot that qualified it (observeBridges);
 * otherwise one read here, for this gate's own direct child right after its spawn event.
 */
function own(pid: number, what: string, start: string = procStat(pid)?.start ?? ""): Owned {
	const existing = owned.find((p) => p.pid === pid && p.start === start);
	if (existing) return existing;
	const entry = { pid, start, what };
	owned.push(entry);
	return entry;
}
/** Owned hosts — that exact pid and start — whose bridge children were observed while the host was alive. */
const childrenObserved = new Set<Owned>();
/**
 * Own every bridge that /proc shows as a DIRECT child of a live owned host (PPID + entry argv). A child
 * qualifies only if the `{ppid, start}` snapshot taken before its argv reads the same after it, and is owned
 * under THAT start; the host must be the observed process before and after the scan. Any drift is a named
 * note: nothing from the scan is owned and the host's children stay unobserved.
 */
function observeBridges(host: Owned): boolean {
	if (procStat(host.pid)?.start !== host.start) return false;
	const qualified: { pid: number; start: string }[] = [];
	const drift: string[] = [];
	for (const pid of fs
		.readdirSync("/proc")
		.filter((n) => /^\d+$/.test(n))
		.map(Number)) {
		const before = procStat(pid);
		if (before?.ppid !== host.pid) continue;
		const bridge = procArgv(pid).includes(bridgeEntry);
		const after = procStat(pid);
		if (after?.ppid !== before.ppid || after.start !== before.start) {
			drift.push(`child ${pid} of host ${host.pid} changed or vanished while it was qualified`);
		} else if (bridge) qualified.push({ pid, start: before.start });
	}
	if (procStat(host.pid)?.start !== host.start) drift.push(`host ${host.pid} changed identity during its child scan`);
	if (drift.length > 0) {
		observationNotes.push(...drift);
		return false;
	}
	for (const child of qualified) own(child.pid, "bridge", child.start);
	childrenObserved.add(host);
	return true;
}
/** Spawn completion or its named failure — never an error swallowed into an empty sink. */
function spawned(child: ReturnType<typeof spawn>, what: string): Promise<number> {
	return new Promise((resolve, reject) => {
		child.once("spawn", () => (child.pid === undefined ? reject(new Error(`${what}: no pid`)) : resolve(child.pid)));
		child.once("error", (error) => reject(new Error(`${what} did not start: ${error.message}`)));
	});
}
const observationNotes: string[] = [];
async function reapAll(): Promise<string[]> {
	const problems: string[] = [];
	// Before any signal: a still-live host's direct children become owned, from /proc, not from the
	// host's own report. A host already gone cannot be asked, and that is said, not painted green.
	for (const host of owned.filter((p) => p.what === "host")) {
		if (procStat(host.pid)?.start === host.start) observeBridges(host);
		else if (!childrenObserved.has(host)) {
			observationNotes.push(`host ${host.pid} exited before its children were observed`);
		}
	}
	for (const p of [...owned].reverse()) {
		if (procStat(p.pid)?.start !== p.start) continue;
		for (const signal of p.stopped ? (["SIGKILL"] as const) : (["SIGTERM", "SIGKILL"] as const)) {
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
	kind: string;
	role?: string;
	toolCalls: { id: string; name: string; arguments: unknown }[];
	toolCallId?: string;
	toolName?: string;
	isError?: boolean;
	/** The tool-result entry's `data.diagnostics`, copied as the driver read them. */
	diagnostics?: { severity: string; code: string; message: string }[];
	text: string;
}

interface IoSnapshot {
	label: string;
	at: string;
	pid: number;
	startKey: string;
	raw: string;
	rchar: number;
	syscr: number;
}
const ioSnapshots: IoSnapshot[] = [];
/** One raw read of the owned bridge's /proc io, with its identity checked; any doubt is a named GAP. */
function ioSnapshot(p: Owned, label: string): IoSnapshot {
	if (procStat(p.pid)?.start !== p.start)
		throw new Error(`GAP: bridge ${p.pid} is no longer the observed process at ${label}`);
	let raw: string;
	try {
		raw = fs.readFileSync(`/proc/${p.pid}/io`, "utf8");
	} catch (error) {
		throw new Error(`GAP: /proc/${p.pid}/io is unreadable at ${label}: ${(error as Error).message}`);
	}
	const field = (name: string): number => {
		const match = new RegExp(`^${name}: (\\d+)$`, "m").exec(raw);
		const value = match ? Number(match[1]) : Number.NaN;
		if (!Number.isSafeInteger(value)) throw new Error(`GAP: /proc/${p.pid}/io has no integer ${name} at ${label}`);
		return value;
	};
	const snapshot = {
		label,
		at: new Date().toISOString(),
		pid: p.pid,
		startKey: p.start,
		raw,
		rchar: field("rchar"),
		syscr: field("syscr"),
	};
	ioSnapshots.push(snapshot);
	return snapshot;
}
interface Report {
	hostPid: number;
	session: { id: string };
	attachment: { gardenId: string; bridgePid: number | null };
	conversationIdBefore: number;
	conversationIdAfter: number;
	entries: EntrySummary[];
	busy: boolean;
	notices: string[];
	error?: string;
}

async function bridgeToolList(): Promise<Map<string, unknown>> {
	const transport = new StdioClientTransport({
		command: process.execPath,
		args: [bridgeEntry],
		env,
		cwd: dirs.project,
		stderr: "pipe",
	});
	transport.stderr?.on("data", () => {});
	const client = new Client({ name: LABEL, version: "1" });
	try {
		await client.connect(transport);
	} catch (error) {
		try {
			await transport.close();
		} catch (closeError) {
			throw new AggregateError(
				[error, closeError],
				`bridge tools/list client did not start (${(error as Error).message}); closing it also failed`,
			);
		}
		throw error;
	}
	try {
		return new Map((await client.listTools()).tools.map((t) => [t.name, t.inputSchema]));
	} finally {
		await client.close();
	}
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

interface CellContext {
	listed: Map<string, unknown>;
	report: Report;
	hostPid: number;
	targetGid: string;
	targetRecordPath: string;
	targetSenderMarker: string;
	targetReceiverMarker: string | null;
	msgs: string[];
	box: string;
}
let context: CellContext | undefined;
interface TargetFacts {
	recordSha: string;
	recordBackend: string | undefined;
	senderMarkerPresent: boolean;
	receiverMarkerPresent: boolean;
	receiversDirListing: string[] | null;
}
let causeBefore: TargetFacts | undefined;
let causeAfterSettle: TargetFacts | undefined;

async function cell(): Promise<void> {
	// The target: a separate idle child owns both of its markers (C2 recipe). It runs in the same
	// constructed private world as everything else this gate starts.
	const targetOwner = spawn(process.execPath, ["-e", "setTimeout(() => {}, 600000)"], {
		stdio: "ignore",
		env,
		cwd: dirs.project,
	});
	own(await spawned(targetOwner, "the target owner"), "target-owner");
	if (targetOwner.pid === undefined) throw new Error("the target owner has no pid");
	const target = upsertMetaSession({
		input: { backend: "claude-code", nativeSessionId: `pds-target-${process.pid}`, cwd: dirs.project },
		dir: dirs.sessions,
	});
	const targetGid = target.record.gardenId;
	const targetSenderMarker = writeMetaSenderMarker({
		backend: "claude-code",
		gardenId: targetGid,
		nativeSessionId: target.record.nativeSessionId,
		cwd: dirs.project,
		ownerPid: targetOwner.pid,
		sendersDir: dirs.senders,
	});
	// The reject cell's declared cause axis: this one marker is not written.
	const targetReceiverMarker = REJECT
		? null
		: writeMetaReceiverMarker({
				gardenId: targetGid,
				backend: "claude-code",
				nativeSessionId: target.record.nativeSessionId,
				ownerPid: targetOwner.pid,
				armProvenance: "session-start",
				receiversDir: dirs.receivers,
			});
	const receiverPath = metaReceiverMarkerPath(targetGid, dirs.receivers);
	const targetFacts = (): TargetFacts => ({
		recordSha: sha256(fs.readFileSync(target.path)),
		recordBackend: (JSON.parse(fs.readFileSync(target.path, "utf8")) as { backend?: string }).backend,
		senderMarkerPresent: fs.existsSync(targetSenderMarker),
		receiverMarkerPresent: fs.existsSync(receiverPath),
		receiversDirListing: fs.existsSync(dirs.receivers) ? fs.readdirSync(dirs.receivers) : null,
	});
	const before = targetFacts();
	causeBefore = before;
	if (REJECT) {
		ok(
			`[QK:PDR-CAUSE-FIXTURE] before the input: the target's record (claude-code) and sender marker exist and its receiver marker path is ABSENT (${receiverPath}; receivers dir: ${JSON.stringify(before.receiversDirListing)})`,
			before.recordBackend === "claude-code" &&
				before.senderMarkerPresent &&
				!before.receiverMarkerPresent &&
				!(before.receiversDirListing ?? []).some((n) => n.includes(targetGid)),
		);
	}
	const message = `${INVALID ? "pds invalid" : REJECT ? "pds reject" : "pds first cell"} ${randomBytes(6).toString("hex")}`;
	scriptedArgs = INVALID
		? { target: targetGid, message, wants_reply: false }
		: { target: targetGid, intent: "fire-and-forget", message, wants_reply: false };

	const listed = await bridgeToolList();

	console.log(
		`1. ${CELL} cell — one native turn: controller input → GenerationTask → ToolTask${INVALID ? " (validation)" : " → bridge"}${REJECT ? " (named refusal)" : ""} (S + H, V not run)`,
	);
	const host = spawn(
		process.execPath,
		["--import", resolver, HOST_DRIVER, bridgeEntry, "send the scripted message", "--await-go"],
		{
			cwd: dirs.project,
			env: hostEnv,
			stdio: ["pipe", "pipe", "pipe"],
		},
	);
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
				() =>
					reject(
						new Error(
							`gate timeout: no host line within ${ms}ms (a gate failure, not a dispatch verdict); stderr: ${stderr.trim()}`,
						),
					),
				ms,
			);
			waiters.push((line) => {
				clearTimeout(timer);
				settle(line);
			});
		});

	const born = await next(REPORT_TIMEOUT_MS);
	if (born.error !== undefined)
		throw new Error(`host failed before input: ${String(born.error)}; stderr: ${stderr.trim()}`);
	if (born.born !== true) throw new Error(`host sent no born line: ${JSON.stringify(born).slice(0, 200)}`);
	// Own the bridge from /proc BEFORE reading any of its counters.
	if (!observeBridges(hostOwned)) throw new Error(`GAP: host ${hostOwned.pid}'s children were not observed coherently`);
	const bridges = owned.filter((p) => p.what === "bridge");
	if (bridges.length !== 1)
		throw new Error(`GAP: expected exactly one bridge child of the host, observed ${bridges.length}`);
	const bridge = bridges[0] as Owned;
	const idleA = ioSnapshot(bridge, "idleA");
	await sleep(IDLE_SAMPLE_MS);
	const idleB = ioSnapshot(bridge, "idleB");
	if (idleA.rchar !== idleB.rchar || idleA.syscr !== idleB.syscr) {
		throw new Error(
			`GAP: the bridge's counters moved in the sampled idle window (rchar ${idleA.rchar}→${idleB.rchar}, syscr ${idleA.syscr}→${idleB.syscr}); the read-count oracle cannot be used`,
		);
	}
	ok(
		`[QK:${QK}-IO-IDLE-SAMPLE-STABLE] the bridge child's counters are readable and unchanged over one sampled idle window (rchar ${idleA.rchar}, syscr ${idleA.syscr}) — that window only`,
		true,
	);
	const beforeGo = ioSnapshot(bridge, "beforeGo");
	host.stdin?.write("go\n");

	const report = (await next(REPORT_TIMEOUT_MS)) as unknown as Report;
	if (report.error !== undefined) throw new Error(`host failed: ${report.error}; stderr: ${stderr.trim()}`);
	const afterSettle = ioSnapshot(bridge, "afterSettle");
	const hostGid = report.attachment.gardenId;
	// The receipt the app carried back is compared against the native view here and against the
	// wire on the FINAL snapshot below; the native view records the same text.
	const resultTextInView = report.entries.find((e) => e.kind === "pi.tool-result")?.text ?? "";

	// --- raw mailbox (the bridge's ENQUEUE, read here)
	const box = path.join(dirs.mailbox, targetGid);
	const msgs = fs.existsSync(box) ? fs.readdirSync(box).filter((f) => f.endsWith(".msg")) : [];
	const body = msgs.length === 1 ? fs.readFileSync(path.join(box, msgs[0] as string), "utf8") : "";
	const rise = { rchar: afterSettle.rchar - beforeGo.rchar, syscr: afterSettle.syscr - beforeGo.syscr };
	if (INVALID) {
		ok(
			`[QK:PDI-MAILBOX-EMPTY] side-effect check: the armed target's mailbox holds no .msg and no inbox.signal (${fs.existsSync(box) ? fs.readdirSync(box).join(", ") || "empty" : "no mailbox dir"}) — a side-effect check only: the bridge also requires intent, so an empty mailbox does NOT by itself show that no call was made`,
			msgs.length === 0 && !fs.existsSync(path.join(box, "inbox.signal")),
		);
		ok(
			`[QK:PDI-BRIDGE-READ-NOTHING] the bridge child made no additional counted reads over beforeGo→afterSettle (rchar +${rise.rchar}, syscr +${rise.syscr}); an increase is inconclusive, not dispatch evidence`,
			rise.rchar === 0 && rise.syscr === 0,
		);
	} else if (REJECT) {
		ok(
			`[QK:PDR-BRIDGE-ACTIVITY] over beforeGo→afterSettle the bridge child made counted reads (rchar +${rise.rchar}, syscr +${rise.syscr}) — activity only, not a decoding of the request`,
			rise.rchar > 0 && rise.syscr > 0,
		);
		const after = targetFacts();
		causeAfterSettle = after;
		ok(
			`[QK:PDR-NO-SIDE-EFFECT] the target's mailbox holds no .msg and no inbox.signal (${fs.existsSync(box) ? fs.readdirSync(box).join(", ") || "empty" : "no mailbox dir"}), its record bytes are unchanged (${(causeBefore?.recordSha ?? "").slice(0, 12)} → ${after.recordSha.slice(0, 12)}), its sender marker is still there and its receiver marker is still absent`,
			msgs.length === 0 &&
				!fs.existsSync(path.join(box, "inbox.signal")) &&
				after.recordSha === causeBefore?.recordSha &&
				after.senderMarkerPresent &&
				!after.receiverMarkerPresent,
		);
	} else {
		ok(
			`[QK:PDS-IO-CALIBRATED] calibration: over beforeGo→afterSettle the one dispatched call raised both bridge counters (rchar +${rise.rchar}, syscr +${rise.syscr}); no rise is a sensitivity GAP`,
			rise.rchar > 0 && rise.syscr > 0,
		);
	}
	if (VALID) {
		ok(
			`[QK:${QK}-DELIVERED-ONCE] the seeded target's mailbox holds exactly one .msg and its inbox.signal was poked (${msgs.join(", ") || "none"})`,
			msgs.length === 1 && fs.existsSync(path.join(box, "inbox.signal")),
		);
		ok(
			`[QK:${QK}-SENDER-IS-THE-HOST] the landed body names the host's garden id as a meta-session/pi-durable sender and carries the scripted message`,
			body.includes("from:        meta-session/pi-durable @") &&
				body.includes(`session:     ${hostGid} (meta-session, `) &&
				body.includes(message),
		);
		// Replyability is a separate claim with its own oracle: the host's raw receiver marker, owned
		// by the host this gate spawned (pid + /proc start key), read while the host is still alive.
		const hostReceiverFile = metaReceiverMarkerPath(hostGid, dirs.receivers);
		const hostReceiver = fs.existsSync(hostReceiverFile)
			? (JSON.parse(fs.readFileSync(hostReceiverFile, "utf8")) as Record<string, unknown>)
			: {};
		const hostArmed =
			hostReceiver.gardenId === hostGid &&
			hostReceiver.ownerPid === hostOwned.pid &&
			hostReceiver.ownerStartKey === `linux:${hostOwned.start}` &&
			hostReceiver.ownerKind === "pi-durable-host";
		ok(
			`[QK:${QK}-SENDER-REPLYABILITY] the host's receiver marker is armed and owned by the spawned host, and the landed body says what that predicts: replyable (armed ${hostArmed})`,
			hostArmed && body.includes(`session:     ${hostGid} (meta-session, replyable — reply via entwurf_v2`),
		);
		const hostRecords = fs
			.readdirSync(dirs.sessions)
			.filter((n) => n.endsWith(".meta.json"))
			.map((n) => JSON.parse(fs.readFileSync(path.join(dirs.sessions, n), "utf8")) as Record<string, unknown>)
			.filter((r) => r.backend === "pi-durable");
		ok(
			`[QK:${QK}-HOST-RECORD] that garden id is the one pi-durable record in the private store, keyed by the host's durable session`,
			hostRecords.length === 1 &&
				hostRecords[0]?.gardenId === hostGid &&
				hostRecords[0]?.nativeSessionId === report.session.id,
		);
	}

	if (!VALID) {
		const durableRecords = fs
			.readdirSync(dirs.sessions)
			.filter((n) => n.endsWith(".meta.json"))
			.map((n) => JSON.parse(fs.readFileSync(path.join(dirs.sessions, n), "utf8")) as Record<string, unknown>)
			.filter((r) => r.backend === "pi-durable");
		ok(
			`[QK:${QK}-HOST-RECORD] the host's garden id is the one pi-durable record in the private store, keyed by the host's durable session`,
			durableRecords.length === 1 &&
				durableRecords[0]?.gardenId === hostGid &&
				durableRecords[0]?.nativeSessionId === report.session.id,
		);
	}

	// --- native view (what the app itself recorded; a PROJECTION by the host driver)
	const calls = report.entries.filter((e) => e.kind === "pi.assistant").flatMap((e) => e.toolCalls);
	const results = report.entries.filter((e) => e.kind === "pi.tool-result");
	const lastAssistant = report.entries.filter((e) => e.kind === "pi.assistant").at(-1);
	ok(
		`[QK:${QK}-NATIVE-TOOL-CALL] the native view records exactly one tool call, ${CALL_ID} → entwurf_v2 with the scripted arguments`,
		calls.length === 1 &&
			calls[0]?.id === CALL_ID &&
			calls[0]?.name === "entwurf_v2" &&
			canonicalJson(calls[0]?.arguments) === canonicalJson(scriptedArgs),
	);
	if (INVALID) {
		const diagnostics = results[0]?.diagnostics ?? [];
		const diag = diagnostics[0];
		ok(
			`[QK:PDI-NATIVE-INVALID-ARGUMENTS] the native view records ${CALL_ID}'s settled result as an error whose one diagnostic is invalid_arguments, and its text is that diagnostic as the harness renders it — the validator's message names intent and echoes the received arguments (${JSON.stringify(resultTextInView.slice(0, 160))}…)`,
			results.length === 1 &&
				results[0]?.toolCallId === CALL_ID &&
				results[0]?.isError === true &&
				diagnostics.length === 1 &&
				diag?.severity === "error" &&
				diag?.code === "invalid_arguments" &&
				resultTextInView === `<harness>\n[error] ${diag.message}\n</harness>` &&
				diag.message.startsWith('Validation failed for tool "entwurf_v2":') &&
				diag.message.includes("intent") &&
				diag.message.includes("Received arguments:") &&
				diag.message.includes(message),
		);
	} else if (REJECT) {
		const diagnostics = results[0]?.diagnostics ?? [];
		const diag = diagnostics[0];
		ok(
			`[QK:PDR-NATIVE-TOOL-ERROR] the native view records ${CALL_ID}'s settled result as an error whose one diagnostic is tool_error (not invalid_arguments), carrying the bridge's named refusal, and its text is that diagnostic as the harness renders it (${JSON.stringify(diag?.message ?? "")})`,
			results.length === 1 &&
				results[0]?.toolCallId === CALL_ID &&
				results[0]?.isError === true &&
				diagnostics.length === 1 &&
				diag?.severity === "error" &&
				diag?.code === "tool_error" &&
				diag.message.startsWith("entwurf_v2 rejected: mailbox-undeliverable") &&
				diag.message.includes("mailbox-undeliverable: self-fetch receiver inactive —") &&
				resultTextInView === `<harness>\n[error] ${diag.message}\n</harness>`,
		);
	} else {
		ok(
			`[QK:PDS-NATIVE-TOOL-RESULT] the native view records that call's settled result, not an error, naming the .msg that landed (${JSON.stringify(resultTextInView)})`,
			results.length === 1 &&
				results[0]?.toolCallId === CALL_ID &&
				results[0]?.isError === false &&
				msgs.length === 1 &&
				resultTextInView === `entwurf_v2 meta-mailbox → enqueued (${msgs[0]})`,
		);
	}
	ok(
		`[QK:${QK}-NATIVE-TURN-SETTLED] the turn ends on the scripted text and the conversation is no longer busy (last: ${JSON.stringify(lastAssistant?.text)}, busy ${report.busy})`,
		lastAssistant?.text === FINAL_TEXT && lastAssistant.toolCalls.length === 0 && report.busy === false,
	);
	ok(
		`[QK:${QK}-ROOT-CURRENT] input and turn stayed on the root conversation (${report.conversationIdBefore} → ${report.conversationIdAfter})`,
		report.conversationIdBefore === 1 && report.conversationIdAfter === 1,
	);
	console.log(`     notices: ${report.notices.join(" | ") || "none"}`);

	context = {
		listed,
		report,
		hostPid: hostOwned.pid,
		targetGid,
		targetRecordPath: target.path,
		targetSenderMarker,
		targetReceiverMarker,
		msgs,
		box,
	};
	host.stdin?.write("close\n");
	const closed = await next(CLOSE_TIMEOUT_MS);
	await Promise.race([exited, sleep(CLOSE_TIMEOUT_MS)]);
	ok(
		`[QK:${QK}-CLOSE] the host closes and exits 0 (closed ${String(closed.closed)}, exit ${exitCode})`,
		closed.closed === true && exitCode === 0,
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
		`[QK:${QK}-WIRE-TOOLS-OFFERED] the app's first model request offers entwurf_self, entwurf_peers and entwurf_v2 (offered: ${[...offered.keys()].join(", ")})`,
		["entwurf_self", "entwurf_peers", "entwurf_v2"].every((name) => offered.has(name)),
	);
	ok(
		`[QK:${QK}-WIRE-V2-SCHEMA-IS-BRIDGE] the entwurf_v2 parameters on the wire are the bridge's own tools/list inputSchema, as this gate listed it`,
		ctx.listed.has("entwurf_v2") &&
			canonicalJson(offered.get("entwurf_v2")) === canonicalJson(ctx.listed.get("entwurf_v2")),
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
	const viewText = ctx.report.entries.find((e) => e.kind === "pi.tool-result")?.text ?? "";
	if (INVALID) {
		ok(
			`[QK:PDI-WIRE-VALIDATION-RESULT] the app's second model request carries ${CALL_ID}'s tool result with exactly the validation error text the native view recorded (got ${JSON.stringify(wireResult.slice(0, 120))}…)`,
			toolMessages.length === 1 &&
				toolMessages[0]?.tool_call_id === CALL_ID &&
				wireResult.startsWith('<harness>\n[error] Validation failed for tool "entwurf_v2":') &&
				wireResult === viewText,
		);
	} else if (REJECT) {
		ok(
			`[QK:PDR-WIRE-REJECT-RESULT] the app's second model request carries ${CALL_ID}'s tool result with exactly the refusal text the native view recorded (got ${JSON.stringify(wireResult.slice(0, 140))}…)`,
			toolMessages.length === 1 &&
				toolMessages[0]?.tool_call_id === CALL_ID &&
				wireResult.startsWith("<harness>\n[error] entwurf_v2 rejected: mailbox-undeliverable") &&
				wireResult === viewText,
		);
	} else {
		ok(
			`[QK:PDS-RESULT-REACHES-MODEL] the app's second model request carries the ${CALL_ID} tool result with the bridge's receipt for that .msg (got ${JSON.stringify(wireResult)})`,
			toolMessages.length === 1 &&
				toolMessages[0]?.tool_call_id === CALL_ID &&
				ctx.msgs.length === 1 &&
				wireResult === `entwurf_v2 meta-mailbox → enqueued (${ctx.msgs[0]})` &&
				wireResult === viewText,
		);
	}
}

/** Copy the cell's raw bytes into the receipts directory, with a correlation summary. */
function exportReceipts(dir: string, ctx: CellContext | undefined): void {
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
		write(
			"correlation.json",
			`${JSON.stringify({ cell: CELL, completed: false, bridgeIo: ioSnapshots, files }, null, 1)}\n`,
		);
		return;
	}
	write("bridge-tools.json", `${JSON.stringify(Object.fromEntries(ctx.listed), null, 1)}\n`);
	write(
		"native-view.json",
		`${JSON.stringify(
			{
				label:
					"PROJECTION of the durable app's native view by scripts/pi-durable-send-host.mjs (entry kind/role/tool calls/tool result/text/data.diagnostics, ids, busy, notices) — not native internal checkpoint state",
				report: ctx.report,
			},
			null,
			1,
		)}\n`,
	);
	const boxNames = fs.existsSync(ctx.box) ? fs.readdirSync(ctx.box) : [];
	for (const name of boxNames) copy(`mailbox/${name}`, path.join(ctx.box, name));
	const signalFile = path.join(ctx.box, "inbox.signal");
	const signalMtime = fs.existsSync(signalFile) ? fs.statSync(signalFile).mtime.toISOString() : null;
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
	copy(`garden/host-sender-marker/${ctx.hostPid}.json`, path.join(dirs.senders, "pi-durable", `${ctx.hostPid}.json`));
	copy(`garden/target-record/${path.basename(ctx.targetRecordPath)}`, ctx.targetRecordPath);
	copy(`garden/target-sender-marker/${path.basename(ctx.targetSenderMarker)}`, ctx.targetSenderMarker);
	if (ctx.targetReceiverMarker !== null) {
		copy(`garden/target-receiver-marker/${path.basename(ctx.targetReceiverMarker)}`, ctx.targetReceiverMarker);
	}
	const call = ctx.report.entries.flatMap((e) => e.toolCalls)[0];
	const result = ctx.report.entries.find((e) => e.kind === "pi.tool-result");
	write(
		"correlation.json",
		`${JSON.stringify(
			{
				cell: CELL,
				callId: call?.id,
				tool: call?.name,
				arguments: call?.arguments,
				receiptFile: ctx.msgs[0] ?? null,
				mailbox: { files: boxNames, msgCount: ctx.msgs.length, signal: signalMtime !== null },
				diagnostics: result?.diagnostics ?? [],
				bridgeIo: ioSnapshots,
				// The target's cause-side facts as observed, absence included; nothing absent is fabricated.
				targetFacts: { beforeInput: causeBefore ?? null, afterSettle: causeAfterSettle ?? null },
				targetReceiverMarker: ctx.targetReceiverMarker ?? "absent (not written by this cell)",
				receiptText: result?.text,
				resultIsError: result?.isError,
				senderGardenId: ctx.report.attachment.gardenId,
				targetGardenId: ctx.targetGid,
				root: { before: ctx.report.conversationIdBefore, after: ctx.report.conversationIdAfter },
				wireRequests: wire.length,
				inboxSignalMtime: signalMtime,
				files,
			},
			null,
			1,
		)}\n`,
	);
}

// ---------------------------------------------------------------------------
// R1 — committed intent, unread request, kill, reopen, unsafe recovery
// ---------------------------------------------------------------------------
function procState(pid: number): string | null {
	try {
		const stat = fs.readFileSync(`/proc/${pid}/stat`, "utf8");
		return stat.slice(stat.lastIndexOf(")") + 2).split(" ")[0] ?? null;
	} catch {
		return null;
	}
}

interface LaunchedHost {
	owned: Owned;
	child: ReturnType<typeof spawn>;
	next(ms: number): Promise<Record<string, unknown>>;
	exited: Promise<void>;
	exit(): { code: number | null | undefined; signal: string | null | undefined };
	stderr(): string;
}

async function launchHost(args: string[], what: string): Promise<LaunchedHost> {
	const child = spawn(process.execPath, ["--import", resolver, HOST_DRIVER, bridgeEntry, ...args], {
		cwd: dirs.project,
		env: hostEnv,
		stdio: ["pipe", "pipe", "pipe"],
	});
	let streamError = "";
	child.stdin?.on("error", (e) => {
		streamError += ` [${what} stdin error: ${e.message}]`;
	});
	const hostOwned = own(await spawned(child, what), "host");
	child.on("error", (e) => {
		streamError += ` [${what} process error: ${e.message}]`;
	});
	let stderr = "";
	child.stderr?.on("data", (c: Buffer) => {
		stderr = (stderr + c.toString("utf8")).slice(-8192);
	});
	const lines: string[] = [];
	const waiters: ((line: string | null) => void)[] = [];
	createInterface({ input: child.stdout as NodeJS.ReadableStream })
		.on("line", (line) => {
			const w = waiters.shift();
			if (w) w(line);
			else lines.push(line);
		})
		.on("close", () => {
			for (const w of waiters.splice(0)) w(null);
		});
	let exitCode: number | null | undefined;
	let exitSignal: string | null | undefined;
	const exited = new Promise<void>((resolve) =>
		child.on("exit", (code, signal) => {
			exitCode = code;
			exitSignal = signal;
			resolve();
		}),
	);
	return {
		owned: hostOwned,
		child,
		exited,
		exit: () => ({ code: exitCode, signal: exitSignal }),
		stderr: () => stderr,
		next: (ms) =>
			new Promise((resolve, reject) => {
				const settle = (line: string | null) => {
					if (line === null)
						return reject(new Error(`${what} ended without a line${streamError}; stderr: ${stderr.trim()}`));
					try {
						resolve(JSON.parse(line) as Record<string, unknown>);
					} catch (error) {
						reject(new Error(`${what} sent a malformed line (${(error as Error).message}): ${line.slice(0, 200)}`));
					}
				};
				const queued = lines.shift();
				if (queued !== undefined) return settle(queued);
				const timer = setTimeout(
					() =>
						reject(
							new Error(`GAP: no ${what} line within ${ms}ms (a cutoff, not a verdict); stderr: ${stderr.trim()}`),
						),
					ms,
				);
				waiters.push((line) => {
					clearTimeout(timer);
					settle(line);
				});
			}),
	};
}

interface R1Context {
	listed: Map<string, unknown>;
	born: Record<string, unknown>;
	intent: Record<string, unknown>;
	recovered: Report;
	targetGid: string;
	targetRecordPath: string;
	targetSenderMarker: string;
	targetReceiverMarker: string;
	box: string;
	host1Pid: number;
	host2Pid: number;
	pauseReceipt: Record<string, unknown>;
	killReceipt: Record<string, unknown>;
	forensic: { files: Record<string, string | null>; dir: string };
	inspection: Record<string, unknown>;
}
let r1Context: R1Context | undefined;

async function r1Cell(): Promise<void> {
	const targetOwner = spawn(process.execPath, ["-e", "setTimeout(() => {}, 600000)"], {
		stdio: "ignore",
		env,
		cwd: dirs.project,
	});
	own(await spawned(targetOwner, "the target owner"), "target-owner");
	if (targetOwner.pid === undefined) throw new Error("the target owner has no pid");
	const target = upsertMetaSession({
		input: { backend: "claude-code", nativeSessionId: `pds-target-${process.pid}`, cwd: dirs.project },
		dir: dirs.sessions,
	});
	const targetGid = target.record.gardenId;
	const targetSenderMarker = writeMetaSenderMarker({
		backend: "claude-code",
		gardenId: targetGid,
		nativeSessionId: target.record.nativeSessionId,
		cwd: dirs.project,
		ownerPid: targetOwner.pid,
		sendersDir: dirs.senders,
	});
	const targetReceiverMarker = writeMetaReceiverMarker({
		gardenId: targetGid,
		backend: "claude-code",
		nativeSessionId: target.record.nativeSessionId,
		ownerPid: targetOwner.pid,
		armProvenance: "session-start",
		receiversDir: dirs.receivers,
	});
	const message = `pds r1 ${randomBytes(6).toString("hex")}`;
	scriptedArgs = { target: targetGid, intent: "fire-and-forget", message, wants_reply: false };
	const listed = await bridgeToolList();

	console.log("1. r1 host1 — one native input; intent committed while the host's bridge is paused (S + H, V not run)");
	const h1 = await launchHost(["send the scripted message", "--await-go", "--report-intent", CALL_ID], "host1");
	const born = await h1.next(REPORT_TIMEOUT_MS);
	if (born.error !== undefined) throw new Error(`host1 failed before input: ${String(born.error)}`);
	if (born.born !== true) throw new Error(`host1 sent no born line: ${JSON.stringify(born).slice(0, 200)}`);
	if (!observeBridges(h1.owned)) throw new Error(`GAP: host1 ${h1.owned.pid}'s children were not observed coherently`);
	const bridges = owned.filter((p) => p.what === "bridge");
	if (bridges.length !== 1)
		throw new Error(`GAP: expected exactly one bridge child of host1, observed ${bridges.length}`);
	const bridge1 = bridges[0] as Owned;
	const idleA = ioSnapshot(bridge1, "idleA");
	await sleep(IDLE_SAMPLE_MS);
	const idleB = ioSnapshot(bridge1, "idleB");
	if (idleA.rchar !== idleB.rchar || idleA.syscr !== idleB.syscr) {
		throw new Error(`GAP: bridge1's counters moved in the sampled idle window; the read-count oracle cannot be used`);
	}
	// Pause exactly the observed bridge; confirm the kernel shows it stopped before the input.
	if (procStat(bridge1.pid)?.start !== bridge1.start) throw new Error("GAP: bridge1 changed identity before pause");
	process.kill(bridge1.pid, "SIGSTOP");
	bridge1.stopped = true;
	const pauseDeadline = Date.now() + REAP_TIMEOUT_MS;
	while (Date.now() < pauseDeadline && procState(bridge1.pid) !== "T") await sleep(20);
	const pauseReceipt = {
		pid: bridge1.pid,
		startKey: bridge1.start,
		state: procState(bridge1.pid),
		startKeyNow: procStat(bridge1.pid)?.start,
		at: new Date().toISOString(),
	};
	if (pauseReceipt.state !== "T" || pauseReceipt.startKeyNow !== bridge1.start) {
		throw new Error(`GAP: bridge1 is not observed stopped before the input (${JSON.stringify(pauseReceipt)})`);
	}
	ok(
		`[QK:PR1-BRIDGE-PAUSED] bridge1 ${bridge1.pid} is observed stopped (state T, same start key) before the input`,
		true,
	);
	const beforeGo = ioSnapshot(bridge1, "beforeGo");
	h1.child.stdin?.write("go\n");
	const goAt = Date.now();

	const intent = await h1.next(INTENT_DEADLINE_MS);
	if (intent.error !== undefined) throw new Error(`host1 failed after input: ${String(intent.error)}`);
	if (intent.intent !== true)
		throw new Error(`host1 reported something other than the intent frame: ${JSON.stringify(intent).slice(0, 300)}`);
	const frame = intent.frame as {
		node: { id: number; kind: string; conversationId: number; state: { status: string; phase: string } };
		slot: { taskId: number; name: string; callId: string; status: string };
	};
	const intentVerdict = intentFrameVerdict(frame, CALL_ID);
	ok(
		`[QK:PR1-INTENT-OBSERVED] the native task graph shows the pi.tool node ${frame.node?.id} running in phase execute on the root conversation, and the live slot with the same taskId is ${CALL_ID} → entwurf_v2, running${intentVerdict.ok ? "" : ` — refused: ${intentVerdict.reasons.join("; ")}`}`,
		intentVerdict.ok,
	);
	// A frame that does not match stops the kill/copy/reopen flow here; owned cleanup still runs.
	if (!intentVerdict.ok) throw new Error(`GAP: the reported frame is not the committed intent of ${CALL_ID}`);

	// Kill host1 at once; the bridge stays paused while its counters are read, then is killed too.
	if (procStat(h1.owned.pid)?.start !== h1.owned.start) throw new Error("GAP: host1 changed identity before kill");
	const killAt = Date.now();
	process.kill(h1.owned.pid, "SIGKILL");
	await Promise.race([h1.exited, sleep(REAP_TIMEOUT_MS)]);
	const afterHostKill = ioSnapshot(bridge1, "afterHostKill");
	const bridgeStateAtRead = procState(bridge1.pid);
	// The signal names the observed paused process: its start key is re-read right before it.
	if (procStat(bridge1.pid)?.start !== bridge1.start)
		throw new Error(`GAP: bridge1 ${bridge1.pid} is not the observed process immediately before its SIGKILL`);
	process.kill(bridge1.pid, "SIGKILL");
	const goneDeadline = Date.now() + REAP_TIMEOUT_MS;
	while (Date.now() < goneDeadline && procStat(bridge1.pid)?.start === bridge1.start) await sleep(20);
	const killReceipt = {
		host1: { pid: h1.owned.pid, ...h1.exit() },
		bridge1: { pid: bridge1.pid, stateAtRead: bridgeStateAtRead, gone: procStat(bridge1.pid)?.start !== bridge1.start },
		at: new Date().toISOString(),
	};
	ok(
		`[QK:PR1-OLD-BRIDGE-READ-NOTHING] paused bridge1 made no counted reads from beforeGo to after host1's kill (rchar +${afterHostKill.rchar - beforeGo.rchar}, syscr +${afterHostKill.syscr - beforeGo.syscr}, state ${bridgeStateAtRead}) — it consumed no request; bytes may still have been written to its pipe`,
		afterHostKill.rchar === beforeGo.rchar && afterHostKill.syscr === beforeGo.syscr && bridgeStateAtRead === "T",
	);
	ok(
		`[QK:PR1-KILLED] host1 died by SIGKILL and paused bridge1 is gone (${JSON.stringify(killReceipt)})`,
		killReceipt.host1.signal === "SIGKILL" && killReceipt.bridge1.gone,
	);
	// Nothing is copied or reopened unless every pre-copy fact holds, timing included.
	const preCopy = preCopyVerdict({
		hostExitSignal: killReceipt.host1.signal,
		bridgeStateAtRead,
		bridgeGone: killReceipt.bridge1.gone,
		readDelta: { rchar: afterHostKill.rchar - beforeGo.rchar, syscr: afterHostKill.syscr - beforeGo.syscr },
		goAt,
		killAt,
		deadlineMs: INTENT_DEADLINE_MS,
	});
	ok(
		`[QK:PR1-PRE-COPY] go→kill ${killAt - goAt}ms within the ${INTENT_DEADLINE_MS}ms validity cutoff (a cutoff, not a success delay), host1 SIGKILLed, bridge1 read nothing while stopped and is gone${preCopy.ok ? "" : ` — refused: ${preCopy.reasons.join("; ")}`}`,
		preCopy.ok,
	);
	if (!preCopy.ok)
		throw new Error(`GAP: pre-copy conditions failed (${preCopy.reasons.join("; ")}); no database copy, no reopen`);

	// Forensic copy of the quiescent database set, then a read-only look at a SEPARATE working copy.
	const session = born.session as { id: string; directory: string };
	const forensicDir = path.join(root, "forensic");
	const workDir = path.join(root, "forensic-work");
	fs.mkdirSync(forensicDir);
	fs.mkdirSync(workDir);
	const forensicFiles: Record<string, string | null> = {};
	for (const name of ["session.sqlite", "session.sqlite-wal", "session.sqlite-shm"]) {
		const from = path.join(session.directory, name);
		if (fs.existsSync(from)) {
			fs.copyFileSync(from, path.join(forensicDir, name));
			fs.copyFileSync(from, path.join(workDir, name));
			forensicFiles[name] = sha256(fs.readFileSync(path.join(forensicDir, name)));
		} else forensicFiles[name] = null;
	}
	const { DatabaseSync } = await import("node:sqlite");
	let inspection: Record<string, unknown>;
	try {
		const db = new DatabaseSync(path.join(workDir, "session.sqlite"), { readOnly: true });
		try {
			const row = db
				.prepare("SELECT id, conversation_id, kind, status, record FROM tasks WHERE id = ?")
				.get(frame.node.id) as
				| { id: number; conversation_id: number; kind: string; status: string; record: string }
				| undefined;
			const entryRows = db.prepare("SELECT id, record FROM entries ORDER BY id").all() as {
				id: number;
				record: string;
			}[];
			const entries = entryRows.map(
				(r) =>
					JSON.parse(r.record) as {
						kind?: string;
						model?: { role?: string; toolCallId?: string; content?: unknown }[];
					},
			);
			inspection = {
				row: row ?? null,
				record: row ? JSON.parse(row.record) : null,
				resultEntriesForCall: entries.filter((e) => e.kind === "pi.tool-result" && e.model?.[0]?.toolCallId === CALL_ID)
					.length,
				entryKinds: entries.map((e) => e.kind),
			};
		} finally {
			db.close();
		}
	} catch (error) {
		throw new Error(`GAP: the copied durable database could not be inspected read-only: ${(error as Error).message}`);
	}
	const checkpoint = checkpointVerdict(
		{
			row: inspection.row as { id?: unknown } | null,
			record: inspection.record as Parameters<typeof checkpointVerdict>[0]["record"],
			resultEntriesForCall: inspection.resultEntriesForCall as number,
		},
		{ nodeId: frame.node.id, callId: CALL_ID, args: scriptedArgs },
	);
	ok(
		`[QK:PR1-RAW-CHECKPOINT] before reopening: the copied database's row and record ${frame.node.id} are this call's pi.tool task (input callId ${CALL_ID}), running, checkpoint execute / unsafe / the scripted arguments, with no result entry for it (files ${JSON.stringify(forensicFiles)})${checkpoint.ok ? "" : ` — refused: ${checkpoint.reasons.join("; ")}`}`,
		checkpoint.ok,
	);
	if (!checkpoint.ok) throw new Error("GAP: the raw committed checkpoint does not match; host2 is not started");

	console.log("2. r1 host2 — continue the same session, no input; native recovery settles the call");
	const h2 = await launchHost(["-", "--recover", CALL_ID], "host2");
	const recovered = (await h2.next(REPORT_TIMEOUT_MS)) as unknown as Report & { recovered?: boolean };
	if (recovered.error !== undefined) throw new Error(`host2 failed: ${recovered.error}; stderr: ${h2.stderr().trim()}`);
	if (!observeBridges(h2.owned)) throw new Error(`GAP: host2 ${h2.owned.pid}'s children were not observed coherently`);
	const attachment = recovered.attachment as unknown as { gardenId: string; action?: string };
	const bornAttachment = born.attachment as { gardenId: string };
	const records = fs
		.readdirSync(dirs.sessions)
		.filter((n) => n.endsWith(".meta.json"))
		.map((n) => JSON.parse(fs.readFileSync(path.join(dirs.sessions, n), "utf8")) as Record<string, unknown>)
		.filter((r) => r.backend === "pi-durable");
	ok(
		`[QK:PR1-SAME-SESSION] host2 continued the same native session and garden: session ${String((recovered.session as unknown as { id: string }).id)} == ${session.id}, attach action ${String(attachment.action)}, garden ${attachment.gardenId}, one pi-durable record, a marker for host2's pid`,
		(recovered.session as unknown as { id: string; directory: string }).id === session.id &&
			(recovered.session as unknown as { directory: string }).directory === session.directory &&
			attachment.gardenId === bornAttachment.gardenId &&
			attachment.action === "attach" &&
			records.length === 1 &&
			fs.existsSync(path.join(dirs.senders, "pi-durable", `${h2.owned.pid}.json`)),
	);
	const results = recovered.entries.filter((e) => e.kind === "pi.tool-result" && e.toolCallId === CALL_ID);
	const calls = recovered.entries.filter((e) => e.kind === "pi.assistant").flatMap((e) => e.toolCalls);
	const diag = results[0]?.diagnostics?.[0];
	const lastAssistant = recovered.entries.filter((e) => e.kind === "pi.assistant").at(-1);
	ok(
		`[QK:PR1-RECOVERED-INTERRUPTED] the recovered view holds exactly one result for ${CALL_ID}: an error whose one diagnostic is interrupted with the native message, rendered by the harness — and exactly one tool call in the whole conversation`,
		results.length === 1 &&
			results[0]?.isError === true &&
			results[0]?.diagnostics?.length === 1 &&
			diag?.severity === "error" &&
			diag?.code === "interrupted" &&
			diag.message === INTERRUPTED_MESSAGE &&
			results[0]?.text === `<harness>\n[error] ${INTERRUPTED_MESSAGE}\n</harness>` &&
			calls.length === 1 &&
			calls[0]?.id === CALL_ID,
	);
	ok(
		`[QK:PR1-TURN-SETTLED] the recovered turn ends on the scripted text, idle, on the root conversation (last ${JSON.stringify(lastAssistant?.text)}, busy ${recovered.busy}, ${recovered.conversationIdAfter})`,
		lastAssistant?.text === FINAL_TEXT &&
			lastAssistant.toolCalls.length === 0 &&
			recovered.busy === false &&
			recovered.conversationIdAfter === 1,
	);
	const box = path.join(dirs.mailbox, targetGid);
	const msgs = fs.existsSync(box) ? fs.readdirSync(box).filter((f) => f.endsWith(".msg")) : [];
	ok(
		`[QK:PR1-NO-SIDE-EFFECT] side-effect check: the armed target's mailbox holds no .msg and no inbox.signal (${fs.existsSync(box) ? fs.readdirSync(box).join(", ") || "empty" : "no mailbox dir"}) — no-resend itself is an inference, not this check`,
		msgs.length === 0 && !fs.existsSync(path.join(box, "inbox.signal")),
	);
	console.log(`     notices: ${recovered.notices.join(" | ") || "none"}`);
	r1Context = {
		listed,
		born,
		intent,
		recovered,
		targetGid,
		targetRecordPath: target.path,
		targetSenderMarker,
		targetReceiverMarker,
		box,
		host1Pid: h1.owned.pid,
		host2Pid: h2.owned.pid,
		pauseReceipt,
		killReceipt,
		forensic: { files: forensicFiles, dir: forensicDir },
		inspection,
	};
	h2.child.stdin?.write("close\n");
	const closed = await h2.next(CLOSE_TIMEOUT_MS);
	await Promise.race([h2.exited, sleep(CLOSE_TIMEOUT_MS)]);
	ok(
		`[QK:PR1-CLOSE] host2 closes and exits 0 (closed ${String(closed.closed)}, exit ${h2.exit().code})`,
		closed.closed === true && h2.exit().code === 0,
	);
}

function finalWireR1(ctx: R1Context): void {
	console.log("3. wire, final snapshot (hosts exited, endpoint closed)");
	const first = wire[0]?.body ?? {};
	const offered = new Map(
		((first.tools as { function?: { name?: string; parameters?: unknown } }[] | undefined) ?? []).map((t) => [
			t.function?.name ?? "",
			t.function?.parameters,
		]),
	);
	ok(
		`[QK:PR1-WIRE-TOOLS-OFFERED] host1's model request offers entwurf_v2 with the bridge's own tools/list inputSchema`,
		ctx.listed.has("entwurf_v2") &&
			canonicalJson(offered.get("entwurf_v2")) === canonicalJson(ctx.listed.get("entwurf_v2")),
	);
	ok(
		`[QK:PR1-WIRE-TWO-REQUESTS] over the whole closed run the endpoint saw exactly two requests: host1's and host2's recovery (${wire.map((w) => `${w.method} ${w.url}`).join(" | ")})`,
		!server.listening &&
			wire.length === 2 &&
			wire.every((w) => w.method === "POST" && w.url === "/v1/chat/completions"),
	);
	const second =
		(wire[1]?.body?.messages as { role?: string; tool_call_id?: string; content?: unknown }[] | undefined) ?? [];
	const toolMessages = second.filter((m) => m.role === "tool");
	const viewText = ctx.recovered.entries.find((e) => e.kind === "pi.tool-result")?.text ?? "";
	ok(
		`[QK:PR1-WIRE-RECOVERY] the recovery request carries ${CALL_ID}'s interrupted result exactly as the recovered view holds it`,
		toolMessages.length === 1 &&
			toolMessages[0]?.tool_call_id === CALL_ID &&
			messageText(toolMessages[0]?.content) === viewText,
	);
}

function exportR1Receipts(dir: string, ctx: R1Context | undefined): void {
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
		write(
			"correlation.json",
			`${JSON.stringify({ cell: CELL, completed: false, bridgeIo: ioSnapshots, files }, null, 1)}\n`,
		);
		return;
	}
	write("bridge-tools.json", `${JSON.stringify(Object.fromEntries(ctx.listed), null, 1)}\n`);
	write("host1-born.json", `${JSON.stringify(ctx.born, null, 1)}\n`);
	write(
		"host1-intent-frame.json",
		`${JSON.stringify({ label: "the native view frame host1 reported (task graph nodes + live slots + entries PROJECTION)", intent: ctx.intent }, null, 1)}\n`,
	);
	write(
		"host2-recovered-view.json",
		`${JSON.stringify({ label: "PROJECTION of host2's native view after recovery", report: ctx.recovered }, null, 1)}\n`,
	);
	for (const [name, digest] of Object.entries(ctx.forensic.files)) {
		if (digest !== null) copy(`forensic-sqlite/${name}`, path.join(ctx.forensic.dir, name));
	}
	write("sqlite-inspection.json", `${JSON.stringify(ctx.inspection, null, 1)}\n`);
	const boxNames = fs.existsSync(ctx.box) ? fs.readdirSync(ctx.box) : [];
	for (const name of boxNames) copy(`mailbox/${name}`, path.join(ctx.box, name));
	copy(`garden/target-record/${path.basename(ctx.targetRecordPath)}`, ctx.targetRecordPath);
	copy(`garden/target-sender-marker/${path.basename(ctx.targetSenderMarker)}`, ctx.targetSenderMarker);
	copy(`garden/target-receiver-marker/${path.basename(ctx.targetReceiverMarker)}`, ctx.targetReceiverMarker);
	for (const pid of [ctx.host1Pid, ctx.host2Pid]) {
		const marker = path.join(dirs.senders, "pi-durable", `${pid}.json`);
		if (fs.existsSync(marker)) copy(`garden/host-sender-marker/${pid}.json`, marker);
	}
	for (const name of fs.readdirSync(dirs.sessions).filter((n) => n.endsWith(".meta.json"))) {
		copy(`garden/records/${name}`, path.join(dirs.sessions, name));
	}
	write(
		"correlation.json",
		`${JSON.stringify(
			{
				cell: CELL,
				callId: CALL_ID,
				arguments: scriptedArgs,
				intentNode: (ctx.intent.frame as { node?: unknown } | undefined)?.node,
				intentSlot: (ctx.intent.frame as { slot?: unknown } | undefined)?.slot,
				pause: ctx.pauseReceipt,
				kill: ctx.killReceipt,
				bridgeIo: ioSnapshots,
				forensicSqlite: ctx.forensic.files,
				rawTaskRow: ctx.inspection.row,
				resultEntriesBeforeReopen: ctx.inspection.resultEntriesForCall,
				recoveredResult: ctx.recovered.entries.find((e) => e.kind === "pi.tool-result") ?? null,
				session: { host1: ctx.born.session, host2: ctx.recovered.session },
				garden: {
					host1: (ctx.born.attachment as { gardenId?: string }).gardenId,
					host2: ctx.recovered.attachment as unknown as { gardenId?: string; action?: string },
				},
				mailbox: { files: boxNames },
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
	await (R1 ? r1Cell() : cell());
} catch (error) {
	primary = error;
}
const cleanupProblems = await reapAll();
// The host is gone, so every client socket is ours to drop; the close is still bounded.
server.closeAllConnections();
const endpointClosed = await Promise.race([
	new Promise<boolean>((resolve) => server.close(() => resolve(true))),
	sleep(REAP_TIMEOUT_MS).then(() => false),
]);
console.log("2. cleanup and operator guard");
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
if (R1) {
	if (r1Context !== undefined) finalWireR1(r1Context);
} else if (context !== undefined) finalWire(context);
if (receiptsInput !== undefined) {
	try {
		if (R1) exportR1Receipts(receiptsInput, r1Context);
		else exportReceipts(receiptsInput, context);
		ok(`[QK:${QK}-RECEIPTS-EXPORTED] the cell's raw bytes and correlation are in ${receiptsInput}`, true);
	} catch (error) {
		ok(`[QK:${QK}-RECEIPTS-EXPORTED] receipt export failed: ${(error as Error).message}`, false);
	}
}
const before = JSON.parse(operatorBefore) as { durableRecords: string[]; senders: boolean };
ok(
	`[QK:${QK}-OPERATOR-UNTOUCHED] coarse pi-durable guard: the operator's own roots are unchanged by this run and hold no pi-durable record or sender dir (${operatorBefore})`,
	operatorPiDurableFacts() === operatorBefore && before.durableRecords.length === 0 && !before.senders,
);
if (alive.length > 0) console.log(`sandbox kept because owned processes are still alive: ${root}`);
else if (process.env.ENTWURF_PI_DURABLE_KEEP === "1") console.log(`sandbox kept: ${root}`);
else fs.rmSync(root, { recursive: true, force: true });
if (primary !== undefined)
	console.error(`${LABEL}: FAILED — ${primary instanceof Error ? primary.message : String(primary)}`);
for (const problem of cleanupProblems) console.error(`${LABEL}: cleanup — ${problem}`);
console.log(
	`\n${LABEL}: ${passed} passed, ${failed} failed — S (scripted endpoint) + H (native ToolTask); V not run; checkout-only`,
);
process.exit(primary === undefined && failed === 0 && reap.green ? 0 : 1);
