/**
 * smoke-pi-durable-fresh-live — the first-admission LIVE acceptance for the native durable host (#129):
 * `docs/adding-a-harness.md` step 9 clause 7, plus the two cross-harness dispatch receipts the release
 * stop requires, all through the public product surface.
 *
 * RELEASE MUST. Needs `LIVE=1`. Opens a real visible Pi and a real visible pi-durable host and spends
 * real model turns on both.
 *
 * ── The sequence, on a private tmux server this step owns ──
 *
 *   fixture  a record-backed self-fetch COLLECTOR (claude-code backend, armed mailbox, sender marker).
 *            It only launches and collects; it never stands in for the existing citizen.
 *   1. fixture → `entwurf_fresh_call(pi)` → a real visible Pi; Pi's first action calls back (nonce A).
 *   2. Pi's live turn → `entwurf_fresh_call(pi-durable, <model>)` → the managed `entwurf pi-durable`
 *      verb opens the durable host; ITS first action calls back into Pi (nonce B, read from Pi's
 *      own transcript). Clauses 1, 2, 5 and 6 through the product surface; no raw tmux launch.
 *   3. fixture → Pi (one instruction). Pi's live turn → `entwurf_v2` → pd: receipt 1, existing → new.
 *      pd's doorbell admits the notice; pd's live turn drains it with `entwurf_inbox_read` (addressed
 *      receive, clause 7) and follows the one instruction it read:
 *   4. pd's live turn → `entwurf_v2` → Pi: receipt 2, new → existing, with the expected payload, from its authoritative sender. Pi relays it to the fixture, which must read it.
 *
 * ── Oracles (screen text and model-reformatted reports are never delivery evidence) ──
 *
 *   Pi        its own JSONL toolCall/toolResult rows and `entwurf-message` custom rows.
 *   pd        its NATIVE store, read from a consistent snapshot taken with node:sqlite's online
 *             `backup` while the host is live (a raw copy of a live WAL set is not consistent):
 *             the `pi.system` entries' `toolsAdded` (the actual offering — task-wide means the six
 *             contact tools AND the native tools, no filter), the generation checkpoint's
 *             `request.model` and the assistant messages' provider/model (the actual model), the
 *             contact tool calls, and the doorbell submission. The live database and its transcript
 *             are only read, never written or removed.
 *   records   V3 records, receiver markers and mailbox state files, read raw.
 *   identity  the garden id on the pd pane is OBSERVED (capture-pane) as a visible-identity fact
 *             only — never as evidence that anything was delivered.
 *
 * ── What it writes ──
 *
 * The meta roots are REAL, as for smoke-omp-fresh-live: the birth runs inside the launched processes
 * under their own root policy, and no env carrier exists to fence it. This step mints exactly one Pi
 * and one pi-durable citizen (asserted) plus its own fixture record. It kills only its private tmux
 * server, removes only its own fixture markers, and leaves every record, transcript and durable
 * session database in place. Raw receipts are exported to a directory it prints.
 */
import { type ChildProcess, execFileSync, spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { FRESH_CALL_BACKENDS } from "../pi-extensions/lib/mux-fresh-call.ts";
import { splitPiDurableModel } from "../pi-extensions/lib/pi-durable-fresh-preflight.ts";
import { checkPiDurableRuntime, piDurablePackageLayout } from "../pi-extensions/lib/pi-durable-runtime.ts";
import {
	mailboxCallbacks,
	parseJsonLines,
	parseMetaMailboxBody,
	piCallbackSenders,
	piSourceToolReceipts,
	type SourceToolReceipt,
} from "./lib/codex-fresh-source-receipts.ts";
import { skipLive } from "./lib/live-skip.ts";
import {
	type PdNativeRow,
	type PdNativeSubmissionRow,
	pdDoorbellSubmission,
	pdRootView,
	piExactDeliveryRow,
} from "./lib/pi-durable-fresh-live-receipts.ts";

const LABEL = "smoke-pi-durable-fresh-live";
const REPO = path.resolve(import.meta.dirname, "..");
const DIST_ENTRY = path.join(REPO, "mcp/entwurf-bridge/dist/mcp/entwurf-bridge/src/index.js");
/** The documented Codex-subscription selector (MODELS.md) — an exact id in the pinned catalog. A model
 * is a host fact, so both are overridable, and both are recorded in the receipt as given. */
const PD_MODEL = process.env.ENTWURF_PI_DURABLE_FRESH_MODEL?.trim() || "openai-codex/gpt-6.1-sol";
const PI_MODEL = process.env.ENTWURF_PI_DURABLE_FRESH_PI_MODEL?.trim() || "openai-codex/gpt-6.1-sol";
const WIDTH = "task-wide";
/** Independent of the adapter's own constant: the six contact tools step 9 expects the host to offer. */
const CONTACT_TOOLS = [
	"entwurf_self",
	"entwurf_peers",
	"entwurf_v2",
	"entwurf_inbox_read",
	"entwurf_callback",
	"entwurf_fresh_call",
];
/** The native app's own tools; task-wide = no filter, so they must be offered beside the contact. */
const NATIVE_TOOLS = ["bash", "read", "edit", "write", "subagent"];
const GARDEN_ID = /^\d{8}T\d{6}-[0-9a-f]{6}$/;
const NONCE = /nonce:\s+(mux-fresh-call-[0-9a-f]+)/;
const TURN_WAIT_MS = 300_000;

let passed = 0;
let root = "";
let socket = "";
const receipts: Record<string, string> = {};
const cleanups: Array<() => void> = [];

function teardown(): void {
	for (const step of cleanups.splice(0).reverse()) {
		try {
			step();
		} catch {
			// Bounded cleanup of this step's own artifacts; a failure here cannot change the verdict.
		}
	}
	if (socket) {
		spawnSync("tmux", ["-S", socket, "kill-server"], { stdio: "ignore" });
		socket = "";
	}
	if (root) {
		fs.rmSync(root, { recursive: true, force: true });
		root = "";
	}
}
function printReceipts(): void {
	if (Object.keys(receipts).length === 0) return;
	console.log(`\n[${LABEL}] receipts`);
	for (const [k, v] of Object.entries(receipts)) console.log(`--- ${k} ---\n${v}`);
}
function fail(message: string): never {
	console.error(`[${LABEL}] ${message}`);
	printReceipts();
	exportReceipts();
	teardown();
	process.exit(1);
}
function ok(label: string, cond: unknown, detail = ""): asserts cond {
	if (!cond) fail(`FAIL  ${label}${detail ? `\n${detail}` : ""}`);
	console.log(`  ok    ${label}`);
	passed++;
}
async function until<T>(what: string, timeoutMs: number, probe: () => T | null | undefined): Promise<T> {
	const deadline = Date.now() + timeoutMs;
	for (;;) {
		let got: T | null | undefined = null;
		try {
			got = probe();
		} catch {
			got = null; // a half-written file is "not yet", never a verdict
		}
		if (got !== null && got !== undefined) return got;
		if (Date.now() > deadline) fail(`timed out after ${timeoutMs}ms waiting for ${what}`);
		await new Promise((r) => setTimeout(r, 1000));
	}
}

// Raw receipts travel: a directory outside the scratch root, printed, never removed by this step.
const receiptsDir =
	process.env.ENTWURF_PI_DURABLE_FRESH_RECEIPTS?.trim() ||
	path.join(os.tmpdir(), `${LABEL}-${new Date().toISOString().replace(/[:.]/g, "-")}`);
function exportFile(name: string, bytes: string | Buffer): void {
	fs.mkdirSync(receiptsDir, { recursive: true });
	fs.writeFileSync(path.join(receiptsDir, name), bytes);
}
function exportReceipts(): void {
	try {
		fs.mkdirSync(receiptsDir, { recursive: true });
		fs.writeFileSync(path.join(receiptsDir, "receipts.json"), `${JSON.stringify(receipts, null, "\t")}\n`);
		console.log(`[${LABEL}] raw receipts: ${receiptsDir}`);
	} catch {
		// Exporting is evidence hygiene; it cannot change the verdict.
	}
}

// ── 1. does this step have a subject? ────────────────────────────────────────
const meta = await import("../pi-extensions/lib/meta-session.ts");
if (!(FRESH_CALL_BACKENDS as readonly string[]).includes("pi-durable")) {
	skipLive(
		LABEL,
		"pi-durable is not in FRESH_CALL_BACKENDS, so there is no visible-fresh product to accept; check-harness-admission-parity owns that state.",
	);
}
const wakeMode = (() => {
	try {
		return meta.loadMetaCapabilityRegistry().backends["pi-durable"]?.wakeMode ?? "ABSENT";
	} catch (err) {
		fail(`capability registry unreadable: ${String(err)}`);
	}
})();
if (wakeMode !== "self-fetch") {
	skipLive(
		LABEL,
		`pi-durable declares wakeMode=${wakeMode}; clause 7 needs a drainable mailbox for addressed receive.`,
	);
}
if (process.env.LIVE !== "1") {
	skipLive(
		LABEL,
		"set LIVE=1 to run — this opens a real visible Pi and a real visible pi-durable host and spends model turns on " +
			`${PI_MODEL} (Pi) and ${PD_MODEL} (pi-durable). Override with ENTWURF_PI_DURABLE_FRESH_PI_MODEL / ENTWURF_PI_DURABLE_FRESH_MODEL.`,
	);
}

// ── 2. prerequisites: FAIL, not skip ─────────────────────────────────────────
// The release gate strips ambient identity; a standalone run must not leak this shell's either.
for (const name of [
	"PI_SESSION_ID",
	"PI_AGENT_ID",
	"ENTWURF_CALLBACK_TARGET",
	"ENTWURF_CALLBACK_NONCE",
	"ENTWURF_META_SENDER_MARKER",
]) {
	delete process.env[name];
}
receipts["0-selectors"] =
	`pd: ${PD_MODEL} width=${WIDTH}\npi: ${PI_MODEL}\n(as requested; the actual model is measured below)`;
const pdModel = splitPiDurableModel(PD_MODEL);
ok("the pi-durable model is provider-qualified (`<provider>/<id>`)", pdModel !== null, PD_MODEL);
ok("the built bridge exists", fs.existsSync(DIST_ENTRY), DIST_ENTRY);
for (const bin of ["pi", "entwurf", "tmux"]) {
	const found = spawnSync("bash", ["-c", `command -v ${bin}`], { encoding: "utf8" });
	ok(`'${bin}' resolves on PATH`, found.status === 0, `missing ${bin}`);
	receipts[`0-path-${bin}`] = found.stdout.trim();
}
const layout = piDurablePackageLayout();
ok("this package closure carries the pi-durable units", layout !== null);
const runtime = checkPiDurableRuntime(process.env, layout);
ok(
	"the operator-provided durable runtime is present and is the pin (the 0.31.0 supply contract)",
	runtime.ok,
	runtime.ok ? "" : `${runtime.reason}`,
);
receipts["0-runtime"] = runtime.ok ? JSON.stringify(runtime) : "";

// ── 3. the fixture collector, and a private tmux server ──────────────────────
root = fs.mkdtempSync(path.join(os.tmpdir(), "entwurf-pd-fresh-"));
process.on("exit", teardown);
fs.mkdirSync(path.join(root, "scratch"));
// The native app keys its session directory by the REALPATH of the cwd; use that same string everywhere.
const scratch = fs.realpathSync(path.join(root, "scratch"));
const fixtureNative = `pd-fresh-live-${process.pid}`;
const fixture = meta.upsertMetaSession({
	input: { backend: "claude-code", nativeSessionId: fixtureNative, cwd: scratch },
});
const fixtureGid = fixture.record.gardenId;
meta.writeMetaReceiverMarker({
	gardenId: fixtureGid,
	backend: "claude-code",
	nativeSessionId: fixtureNative,
	ownerPid: process.pid,
	armProvenance: "session-start",
});
cleanups.push(() => meta.removeMetaReceiverMarker({ gardenId: fixtureGid, ownerPid: process.pid }));
const senderMarkerPath = meta.writeMetaSenderMarker({
	backend: "claude-code",
	gardenId: fixtureGid,
	nativeSessionId: fixtureNative,
	cwd: scratch,
	ownerPid: process.pid,
});
cleanups.push(() => fs.rmSync(senderMarkerPath, { force: true }));
ok("the fixture is a record-backed collector with an armed mailbox and a sender marker", GARDEN_ID.test(fixtureGid));
receipts["1-fixture"] = `gardenId=${fixtureGid} backend=claude-code (collector only) cwd=${scratch}`;

const citizensBefore = new Set(
	(
		JSON.parse(execFileSync("bash", [path.join(REPO, "run.sh"), "meta-facts"], { encoding: "utf8" })) as {
			citizens: Array<{ gardenId: string }>;
		}
	).citizens.map((c) => c.gardenId),
);

socket = path.join(root, "pd.sock");
{
	const serverEnv = { ...process.env } as NodeJS.ProcessEnv;
	delete serverEnv.TMUX;
	delete serverEnv.TMUX_PANE;
	const started = spawnSync(
		"tmux",
		["-S", socket, "new-session", "-d", "-s", "fixture", "-n", "anchor", "-c", scratch],
		{
			env: serverEnv,
			encoding: "utf8",
		},
	);
	if (started.status !== 0) fail(`could not start the private tmux server at ${socket}: ${started.stderr}`);
}
const anchorPane = execFileSync("tmux", ["-S", socket, "display-message", "-p", "-t", "fixture:anchor", "#{pane_id}"], {
	encoding: "utf8",
}).trim();
ok("placement is a private tmux socket this step owns, never the operator's", anchorPane.startsWith("%"));

// ── a persistent MCP client over the real compiled bridge ────────────────────
class BridgeClient {
	private child: ChildProcess;
	private buf = "";
	private err = "";
	private next = 2;
	private waiters = new Map<number, (v: { raw: unknown; text: string; isError: boolean }) => void>();
	constructor(env: NodeJS.ProcessEnv) {
		this.child = spawn(process.execPath, [DIST_ENTRY], { stdio: ["pipe", "pipe", "pipe"], env });
		this.child.stderr?.on("data", (d) => {
			this.err += d.toString();
		});
		this.child.stdout?.on("data", (d) => {
			this.buf += d.toString();
			const lines = this.buf.split("\n");
			this.buf = lines.pop() ?? "";
			for (const line of lines) {
				if (!line.trim().startsWith("{")) continue;
				try {
					const msg = JSON.parse(line);
					const w = this.waiters.get(msg.id);
					if (!w) continue;
					this.waiters.delete(msg.id);
					w({
						raw: msg.result,
						text: (msg.result?.content ?? []).map((c: { text?: string }) => c.text ?? "").join("\n"),
						isError: msg.result?.isError === true,
					});
				} catch {
					/* partial frame */
				}
			}
		});
		this.send({
			jsonrpc: "2.0",
			id: 1,
			method: "initialize",
			params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: LABEL, version: "0" } },
		});
		this.send({ jsonrpc: "2.0", method: "notifications/initialized" });
	}
	private send(msg: unknown): void {
		this.child.stdin?.write(`${JSON.stringify(msg)}\n`);
	}
	stderrTail(): string {
		return this.err.slice(-2000);
	}
	close(): void {
		this.child.kill("SIGTERM");
	}
	rpc(method: string, params: unknown, timeoutMs = 60_000): Promise<{ raw: unknown; text: string; isError: boolean }> {
		const id = this.next++;
		return new Promise((resolve, reject) => {
			const timer = setTimeout(
				() => reject(new Error(`${method} did not answer in ${timeoutMs}ms\n${this.err}`)),
				timeoutMs,
			);
			this.waiters.set(id, (v) => {
				clearTimeout(timer);
				resolve(v);
			});
			this.send({ jsonrpc: "2.0", id, method, params });
		});
	}
	call(name: string, args: Record<string, unknown>, timeoutMs = 60_000) {
		return this.rpc("tools/call", { name, arguments: args }, timeoutMs);
	}
}
const bridge = new BridgeClient({
	...process.env,
	TMUX: `${socket},0,0`,
	TMUX_PANE: anchorPane,
	ENTWURF_META_SENDER_MARKER: senderMarkerPath,
});
cleanups.push(() => bridge.close());

// The compiled bridge this candidate ships is the schema authority; pi-durable must be openable there.
const listed = await bridge.rpc("tools/list", {});
const freshSchema = (
	listed.raw as { tools?: Array<{ name: string; inputSchema?: { properties?: { backend?: { enum?: string[] } } } }> }
).tools?.find((t) => t.name === "entwurf_fresh_call")?.inputSchema?.properties?.backend?.enum;
ok(
	"the current compiled bridge offers entwurf_fresh_call with pi-durable in its backend enum",
	Array.isArray(freshSchema) && freshSchema.includes("pi-durable"),
	JSON.stringify(freshSchema),
);
receipts["1-bridge-fresh-enum"] = JSON.stringify(freshSchema);

// ── 4. hop 1: the fixture opens a REAL visible Pi through the public surface ──
const tokenT1 = `PD-T1-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
const tokenT2 = `PD-T2-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
const pdTask =
	"You are an automated acceptance probe. After your callback, do nothing until an entwurf inbox notice arrives. " +
	"When it does, call entwurf_inbox_read with your own garden id, then carry out exactly the one instruction in the " +
	"message you read. Do not read files and do not run commands.";
const piPhaseOne =
	"You are an automated acceptance probe. Call the tool entwurf_fresh_call exactly once with these exact arguments: " +
	`backend "pi-durable", model "${PD_MODEL}", cwd "${scratch}", task ${JSON.stringify(pdTask)}. ` +
	"Then stop and wait; a callback will arrive by itself. Do not read files and do not run commands.";
const launchPi = await bridge.call(
	"entwurf_fresh_call",
	{ backend: "pi", model: PI_MODEL, task: piPhaseOne, cwd: scratch },
	120_000,
);
receipts["2-launch-pi"] = launchPi.text;
ok(
	"tools/call entwurf_fresh_call(pi) returned a launch receipt",
	!launchPi.isError,
	`${launchPi.text}\n${bridge.stderrTail()}`,
);
const nonceA = NONCE.exec(launchPi.text)?.[1];
ok("the Pi launch receipt carries a nonce", typeof nonceA === "string", launchPi.text);

const piGid = await until("Pi's callback into the fixture", TURN_WAIT_MS, () => {
	const bodies = meta.readMetaInbox({ gardenId: fixtureGid }).messages.map((m) => m.body);
	const found = mailboxCallbacks(bodies, nonceA as string);
	return found.length === 1 ? found[0]?.sender : null;
});
ok("Pi called back with the exact nonce, and its sender envelope names its garden id", GARDEN_ID.test(piGid));
receipts["2-pi-callback"] = `${piGid} (sender of ${nonceA})`;
const piRecord = () => meta.readMetaIdentityByGardenId(piGid);
ok("the Pi callback id is a pi record", piRecord()?.backend === "pi", JSON.stringify(piRecord()));

const piEntries = (): unknown[] => {
	const transcript = (piRecord() as { transcriptPath?: string | null } | null)?.transcriptPath ?? "";
	if (!transcript || !fs.existsSync(transcript)) return [];
	return parseJsonLines(fs.readFileSync(transcript, "utf8"));
};
const piTools = (): SourceToolReceipt[] => piSourceToolReceipts(piEntries());

// ── 5. hop 2: Pi's live turn opens pi-durable; pd's first action calls back into Pi ──
const pdLaunch = await until("Pi's own entwurf_fresh_call(pi-durable) result", TURN_WAIT_MS, () =>
	piTools().find(
		(t) => t.toolName === "entwurf_fresh_call" && t.arguments.backend === "pi-durable" && t.status !== "pending",
	),
);
receipts["3-pi-fresh-call-pd"] = `${JSON.stringify(pdLaunch.arguments)}\n${pdLaunch.text}`;
ok(
	"Pi's live turn called entwurf_fresh_call(backend pi-durable) with the requested model and got a launch receipt",
	pdLaunch.status === "completed" && pdLaunch.arguments.model === PD_MODEL,
	pdLaunch.text,
);
const nonceB = NONCE.exec(pdLaunch.text)?.[1];
ok("the pi-durable launch receipt carries a nonce", typeof nonceB === "string", pdLaunch.text);
const pdPane = /pane:\s+(%\d+)/.exec(pdLaunch.text)?.[1];
ok("the pi-durable launch receipt names its pane", typeof pdPane === "string", pdLaunch.text);

const pdGid = await until("pi-durable's callback into Pi (Pi's own transcript)", TURN_WAIT_MS, () => {
	const senders = piCallbackSenders(piEntries(), nonceB as string);
	return senders.length === 1 ? senders[0] : null;
});
ok(
	"pi-durable's FIRST action called back into Pi with the exact nonce; the sender envelope names its garden id",
	GARDEN_ID.test(pdGid),
);
ok("the address came from the callback, not the launch receipt", !pdLaunch.text.includes(pdGid));
receipts["3-pd-callback"] = `${pdGid} (sender of ${nonceB}, read from Pi's transcript)`;
const pdRecord = meta.readMetaIdentityByGardenId(pdGid) as unknown as Record<string, unknown> | null;
ok("the pd callback id is a pi-durable V3 record", pdRecord?.backend === "pi-durable", JSON.stringify(pdRecord));
receipts["3-pd-record"] = JSON.stringify(pdRecord);
const pdMarker = await until("pi-durable's receiver marker (armed doorbell)", 120_000, () =>
	meta.readMetaReceiverMarker({ gardenId: pdGid }),
);
ok(
	"pi-durable's receiver is armed and owned by the durable host",
	(pdMarker as { ownerKind?: string }).ownerKind === "pi-durable-host",
	JSON.stringify(pdMarker),
);

const facts = JSON.parse(execFileSync("bash", [path.join(REPO, "run.sh"), "meta-facts"], { encoding: "utf8" })) as {
	citizens: Array<{ gardenId: string }>;
};
// Other siblings may mint citizens in the operator's garden meanwhile; this step's are the ones in its scratch cwd.
const minted = facts.citizens
	.map((c) => c.gardenId)
	.filter((g) => !citizensBefore.has(g) && g !== fixtureGid && meta.readMetaIdentityByGardenId(g)?.cwd === scratch);
ok(
	"exactly two citizens were minted in this step's cwd — the visible Pi and the visible pi-durable host, never a subagent",
	minted.length === 2 && minted.includes(piGid) && minted.includes(pdGid),
	`new: ${minted.join(", ")}`,
);

// Visible identity: OBSERVED on the pd pane (an identity fact, not delivery evidence).
const pdScreen = await until("the garden id on the pi-durable pane", 60_000, () => {
	const shot = spawnSync("tmux", ["-S", socket, "capture-pane", "-p", "-J", "-t", pdPane as string, "-S", "-200"], {
		encoding: "utf8",
	});
	return shot.status === 0 && shot.stdout.includes(pdGid) ? shot.stdout : null;
});
ok("the pi-durable host shows its own garden id on its visible surface", pdScreen.includes(pdGid));
exportFile("pd-pane-identity.txt", pdScreen);

// ── 6. receipt 1: Pi's live turn → pd; pd drains it in a live turn ───────────
const m1 =
	`Acceptance probe ${tokenT1}. Reply by calling entwurf_v2 exactly once with target "${piGid}", ` +
	`intent "fire-and-forget", message "${tokenT2}". Then stop.`;
const piPhaseTwo =
	`Call entwurf_v2 exactly once with target "${pdGid}", intent "fire-and-forget", message ${JSON.stringify(m1)}. ` +
	`Then stop. Later, when a message from ${pdGid} containing "${tokenT2}" arrives, call entwurf_v2 exactly once with ` +
	`target "${fixtureGid}", intent "fire-and-forget", message "${tokenT2} RELAYED", then stop. Do nothing else.`;
const toPi = await bridge.call("entwurf_v2", { target: piGid, intent: "fire-and-forget", message: piPhaseTwo });
receipts["4-fixture-to-pi"] = toPi.text;
ok("the fixture's instruction reached Pi on its control socket", !toPi.isError, toPi.text);

const piToPd = await until("Pi's entwurf_v2 → pi-durable result", TURN_WAIT_MS, () =>
	piTools().find((t) => t.toolName === "entwurf_v2" && t.arguments.target === pdGid && t.status !== "pending"),
);
receipts["4-receipt-1-pi-to-pd"] = `${JSON.stringify(piToPd.arguments)}\n${piToPd.text}`;
ok(
	"RECEIPT 1 (existing → new): Pi's live turn dispatched to pi-durable and the bridge answered with a mailbox ENQUEUE",
	piToPd.status === "completed" && piToPd.arguments.message === m1 && /meta-mailbox → enqueued/.test(piToPd.text),
	piToPd.text,
);
const pdState = await until("pi-durable's read receipt (lastReadAt)", TURN_WAIT_MS, () => {
	const file = path.join(meta.defaultMetaMailboxDir(), pdGid, "state.json");
	if (!fs.existsSync(file)) return null;
	const s = JSON.parse(fs.readFileSync(file, "utf8")) as { lastReadAt?: string; lastEnqueuedAt?: string };
	return s.lastReadAt && s.lastEnqueuedAt && Date.parse(s.lastReadAt) >= Date.parse(s.lastEnqueuedAt) ? s : null;
});
receipts["4-pd-mailbox-state"] = JSON.stringify(pdState);
ok("pi-durable drained its own inbox after the enqueue (lastReadAt ≥ lastEnqueuedAt)", true);

// ── 7. receipt 2: pd's live turn → Pi; Pi relays to the fixture ──────────────
// Exact payload + ONE anchored terminal sender envelope naming pd. A row that merely mentions the
// token and pd's id is not a delivery: the fixture's own instruction to Pi did exactly that.
const landed = await until("pi-durable's message landing in Pi's transcript", TURN_WAIT_MS, () =>
	piExactDeliveryRow(piEntries(), tokenT2, pdGid),
);
receipts["5-receipt-2-landed-in-pi"] = `row ${landed.index}: ${JSON.stringify(landed.row)}`;
ok(
	"RECEIPT 2 (new → existing): exactly one Pi row carries the expected payload with pi-durable as its authoritative sender",
	true,
);
const relay = await until("Pi's relay into the fixture", TURN_WAIT_MS, () => {
	for (const m of meta.readMetaInbox({ gardenId: fixtureGid }).messages) {
		const parsed = parseMetaMailboxBody(m.body);
		if (parsed?.sender === piGid && parsed.payload === `${tokenT2} RELAYED`) return m.body;
	}
	return null;
});
receipts["5-relay-to-fixture"] = relay;
ok("Pi relayed the token to the fixture, which read it", true);

// ── 8. pd's NATIVE store: a consistent online snapshot, read-only ────────────
const agentDir = process.env.PI_CODING_AGENT_DIR?.trim() || path.join(os.homedir(), ".pi", "agent");
const sessionDir = path.join(
	agentDir,
	"experimental",
	"durable-sessions",
	createHash("sha256").update(scratch).digest("hex").slice(0, 24),
	String(pdRecord?.nativeSessionId ?? ""),
);
const liveDb = path.join(sessionDir, "session.sqlite");
ok(
	"the pi-durable record's native session database exists where the native app keeps it",
	fs.existsSync(liveDb),
	liveDb,
);
const snapshot = path.join(receiptsDir, "pd-session.snapshot.sqlite");
fs.mkdirSync(receiptsDir, { recursive: true });
const sqlite = await import("node:sqlite");
{
	const source = new sqlite.DatabaseSync(liveDb, { readOnly: true });
	try {
		await sqlite.backup(source, snapshot);
	} finally {
		source.close();
	}
}
receipts["6-native-db"] = `live=${liveDb} (read-only)\nsnapshot=${snapshot} (node:sqlite online backup)`;
const db = new sqlite.DatabaseSync(snapshot, { readOnly: true });
const roots = db
	.prepare("SELECT id FROM conversations WHERE owner_conversation_id IS NULL AND owner_task_id IS NULL")
	.all() as Array<{ id: number }>;
const nativeEntries = db.prepare("SELECT id, conversation_id, record FROM entries").all() as unknown as PdNativeRow[];
const nativeSubmissions = db
	.prepare("SELECT conversation_id, status, record FROM submissions")
	.all() as unknown as PdNativeSubmissionRow[];
db.close();
ok("pd's native store has exactly one root conversation", roots.length === 1, JSON.stringify(roots));
const rootId = (roots[0] as { id: number }).id;
const view = pdRootView(nativeEntries, rootId);
receipts["6-native-offering"] = view.offering.join(" ") || "(no pi.system offering)";
ok(
	"ACTUAL OFFERING (root pi.system, toolsAdded/toolsRemoved applied): the six contact tools AND the native tools — task-wide, no filter",
	CONTACT_TOOLS.every((t) => view.offering.includes(t)) && NATIVE_TOOLS.every((t) => view.offering.includes(t)),
	`offered: ${view.offering.join(", ") || "(none)"}`,
);
receipts["6-native-model"] = `root pi.assistant provider/model: ${view.models.join(" ") || "(none)"}`;
ok(
	`ACTUAL MODEL (root pi.assistant rows): every turn answered as ${PD_MODEL}`,
	view.models.length === 1 && view.models[0] === PD_MODEL,
	receipts["6-native-model"],
);
receipts["6-native-tool-calls"] = JSON.stringify(view.calls);
ok(
	"pd's FIRST root tool call is entwurf_callback, and it is the only one",
	view.calls[0]?.name === "entwurf_callback" && view.calls.filter((c) => c.name === "entwurf_callback").length === 1,
	receipts["6-native-tool-calls"],
);
ok(
	"pd's root entwurf_inbox_read is for its OWN garden id and settled without error",
	view.calls.some(
		(c) => c.name === "entwurf_inbox_read" && c.arguments.gardenId === pdGid && c.result?.isError === false,
	),
	receipts["6-native-tool-calls"],
);
const pdToPi = view.calls.find(
	(c) => c.name === "entwurf_v2" && c.arguments.target === piGid && c.arguments.message === tokenT2,
);
ok(
	"pd's root entwurf_v2 to Pi carries the expected payload and SETTLED as a control-socket dispatch (native tool-result, joined by toolCallId)",
	pdToPi?.result?.isError === false &&
		/^entwurf_v2 control-socket → (sent|queued-steer|queued-follow-up|accepted-unknown-boundary)/.test(
			pdToPi.result.text,
		),
	JSON.stringify(pdToPi),
);
receipts["6-pd-to-pi-settled"] = JSON.stringify(pdToPi);
const msgName = /meta-mailbox → enqueued \(([^)]+)\)/.exec(piToPd.text)?.[1] ?? "";
const doorbell = pdDoorbellSubmission(nativeSubmissions, rootId, `entwurf-doorbell:${pdGid}:${msgName}`);
receipts["6-native-doorbell-submission"] = JSON.stringify(doorbell);
ok(
	"the doorbell admitted THIS message's notice to the root conversation and the submission is done",
	msgName !== "" && doorbell?.status === "done",
	`${msgName} → ${receipts["6-native-doorbell-submission"]}`,
);
exportFile("pi-transcript.jsonl", fs.readFileSync((piRecord() as { transcriptPath: string }).transcriptPath));

// ── decisive lines, for the record that crosses hosts ────────────────────────
console.log(`\n[${LABEL}] decisive`);
console.log(`  pi-durable ${pdGid} native=${pdRecord?.nativeSessionId} model=${PD_MODEL} width=${WIDTH}`);
console.log(`  pi        ${piGid} model=${PI_MODEL}`);
console.log(`  fixture   ${fixtureGid} (collector)`);
console.log(`  offering  ${receipts["6-native-offering"]}`);
console.log(`  ${receipts["6-native-model"].replace(/\n/g, "\n  ")}`);
console.log(`  receipt-1 ${piToPd.text.split("\n")[0]}`);
console.log(`  receipt-2 ${pdToPi?.result?.text} → Pi row ${landed.index} (exact payload ${tokenT2}, sender ${pdGid})`);
console.log(`  root      meta=${meta.defaultMetaSessionsDir()} agent=${agentDir}`);
exportReceipts();
console.log(`\n[${LABEL}] PASS (${passed} assertions)`);
teardown();
