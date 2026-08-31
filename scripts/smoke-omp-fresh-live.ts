/**
 * smoke-omp-fresh-live — the LIVE acceptance for #87 Bundle C: OMP opened as ONE visible fresh
 * sibling through the public `entwurf_fresh_call` surface, naming itself back by exact nonce, and
 * then receiving an addressed message in that same native session.
 *
 * RELEASE MUST. Needs `LIVE=1`. Opens a real omp TUI and spends real model turns.
 *
 * ── Why this is a release MUST and not an on-demand axis ──
 *
 * The static gates admit omp to the fresh set and hold every public surface in parity, but a
 * schema is not a product. `[측정]` omp 18.0.0's bootstrap-payload submission PARSES correctly,
 * and parsing is exactly what pi got right while submitting no message at all
 * (`mux-fresh-call.ts` — "Flag-first submitted no message"). For THIS backend that is not a
 * hypothetical: `[LIVE 2026-08-30]` the retired positional candidate parsed perfectly, opened its
 * window and minted its citizen, and the model still answered the literal text `ACK` with zero
 * tool calls because the turn began before the callback tool existed. A release whose
 * `entwurf_fresh_call(omp)` opens a window that never runs its turn, or whose model cannot see
 * `mcp__entwurf_bridge_entwurf_v`, would pass every deterministic gate in this repo. So the
 * admission contract's clause 7 receipt is wired here rather than left to an operator's memory:
 * `docs/adding-a-harness.md` step 9 makes visible fresh the thing "supported" MEANS, and a MUST
 * step is how that stops being prose. This is a NEW contract applied from omp onward; it does not
 * retroactively redesign Copilot's operator-metered exclusion.
 *
 * ── It decides its own outcome, never a hardcoded verdict ──
 *
 *   omp absent from FRESH_CALL_BACKENDS → protocol SKIP: the composition cannot open it, so
 *       there is no product to accept. `check-harness-admission-parity` is what makes that state
 *       a red release rather than a quiet one, and this step stays honest about having no subject.
 *   registry says omp has no drainable mailbox → protocol SKIP: clause 7 requires callback AND
 *       addressed receive, and half a contract is not an acceptance.
 *   admitted, and LIVE≠1 → protocol SKIP naming LIVE=1.
 *   admitted, and LIVE=1 → every missing prerequisite below is a FAIL, not a skip. Once the
 *       composition offers the backend, a host that cannot open it is a broken promise.
 *
 * ── Product surface only ──
 *
 * The sibling is opened by `tools/call entwurf_fresh_call` through the REAL bridge, in a private
 * tmux server this step owns. A raw `tmux new-window omp` would prove the vendor and nothing about
 * our product — that shortcut is what `smoke-omp-receive-live` uses deliberately, because ITS
 * subject is receive and launch was not yet admitted. Here launch IS the subject, so the entry
 * point is the one a caller reaches.
 *
 * ── What it writes ──
 *
 * The four meta roots are REAL, and that is stated rather than hidden. The birth and receiver
 * extensions run INSIDE the launched omp process and resolve their own roots from the omp root
 * policy; there is no env carrier on the fresh argv that could fence them, and inventing one to
 * make a gate convenient would add a garden-root carrier the product refuses. So this step mints
 * one real citizen, exactly as an operator's own `omp` would, and proves it minted only that.
 * `smoke-omp-receive-live` set the precedent on the same lane.
 */
import { type ChildProcess, execFileSync, spawn, spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { FRESH_CALL_BACKENDS } from "../pi-extensions/lib/mux-fresh-call.ts";
import { ompFreshPreflight } from "../pi-extensions/lib/omp-fresh-preflight.ts";
import { buildOmpCallbackOnlyPrompt } from "../pi-extensions/meta-bridge-omp.ts";
import { skipLive } from "./lib/live-skip.ts";

const LABEL = "smoke-omp-fresh-live";
const REPO = path.resolve(import.meta.dirname, "..");
const DIST_ENTRY = path.join(REPO, "mcp/entwurf-bridge/dist/mcp/entwurf-bridge/src/index.js");
/**
 * The operator's configured omp model. Overridable because a model is a host fact, not a
 * product one — but never OPTIONAL: step 9 clause 2 requires an explicit model.
 *
 * THE DEFAULT IS THE MODEL THE CALLBACK WAS MEASURED ON. `[측정 2026-08-30]` the reference
 * callback-only run that proved the two-stage bootstrap end to end used
 * `openai-codex/gpt-5.6-sol`: the tool appeared at +1105ms, the prompt went in at +1107ms and
 * the sibling called `mcp__entwurf_bridge_entwurf_v` with the exact nonce
 * (`omp-cb-btkvva4r87` -> `20260830T184054-1aa1f2`, `meta-mailbox → enqueued`). The earlier
 * `-terra` default is deliberately NOT kept: the one run it was measured on is the run that
 * answered `ACK` without calling anything, and while the tool was provably absent for that
 * turn — so the model is not the established cause — a release MUST step should default to
 * the configuration that has actually been observed to close, not to the one that has only
 * been observed to fail.
 */
const OMP_MODEL = process.env.ENTWURF_OMP_FRESH_MODEL ?? "openai-codex/gpt-5.6-sol";
const GARDEN_ID = /^\d{8}T\d{6}-[0-9a-f]{6}$/;
const CALLBACK_WAIT_MS = 240_000;
const READ_WAIT_MS = 240_000;

let passed = 0;
const receipts: Record<string, string> = {};
let socket = "";
let root = "";

function teardown(): void {
	if (socket) {
		spawnSync("tmux", ["-S", socket, "kill-server"], { stdio: "ignore" });
		socket = "";
	}
	if (root) {
		fs.rmSync(root, { recursive: true, force: true });
		root = "";
	}
}
function ok(label: string, cond: boolean, detail = ""): void {
	if (!cond) {
		console.error(`  FAIL  ${label}${detail ? `\n${detail}` : ""}`);
		printReceipts();
		teardown();
		process.exit(1);
	}
	console.log(`  ok    ${label}`);
	passed++;
}
function fail(message: string): never {
	console.error(`[${LABEL}] ${message}`);
	printReceipts();
	teardown();
	process.exit(1);
}
/** Receipts must travel: a host-local path is unreadable to whoever reads the cut record, so
 * the decisive lines are printed into this run's own output. */
function printReceipts(): void {
	if (Object.keys(receipts).length === 0) return;
	console.log(`\n[${LABEL}] receipts`);
	for (const [k, v] of Object.entries(receipts)) console.log(`--- ${k} ---\n${v}`);
}

async function until<T>(what: string, timeoutMs: number, probe: () => T | null): Promise<T> {
	const deadline = Date.now() + timeoutMs;
	for (;;) {
		const got = probe();
		if (got !== null && got !== undefined) return got;
		if (Date.now() > deadline) fail(`timed out after ${timeoutMs}ms waiting for ${what}`);
		await new Promise((r) => setTimeout(r, 500));
	}
}

// ── 1. does this step have a subject at all? ─────────────────────────────────
const meta = await import("../pi-extensions/lib/meta-session.ts");

if (!(FRESH_CALL_BACKENDS as readonly string[]).includes("omp")) {
	skipLive(
		LABEL,
		"omp is not in FRESH_CALL_BACKENDS, so the composition cannot open it and there is no visible-fresh product to accept. " +
			"That state is not neutral: check-harness-admission-parity turns a citizen backend missing from the fresh set into a " +
			"RED release package, because an `unsupported` note is not a partial-release permit (docs/adding-a-harness.md step 9).",
	);
}
const wakeMode = (() => {
	try {
		return meta.loadMetaCapabilityRegistry().backends.omp?.wakeMode ?? "ABSENT";
	} catch (err) {
		fail(`capability registry unreadable: ${String(err)}`);
	}
})();
if (wakeMode !== "self-fetch") {
	skipLive(
		LABEL,
		`omp declares wakeMode=${wakeMode}, so it has no drainable mailbox. Step 9 clause 7 requires ONE receipt covering ` +
			"callback AND addressed receive; half of that contract is not an acceptance.",
	);
}
if (process.env.LIVE !== "1") {
	skipLive(
		LABEL,
		"set LIVE=1 to run — this step opens a real omp TUI through entwurf_fresh_call and spends real model turns on the " +
			"operator's configured omp model.",
	);
}

// ── 2. prerequisites: FAIL, not skip ─────────────────────────────────────────
try {
	execFileSync("bash", ["-c", "command -v omp"], { stdio: "ignore" });
} catch {
	fail(
		"the 'omp' CLI is not on PATH, but the composition offers omp as a fresh backend. entwurf never installs a harness.",
	);
}
if (!fs.existsSync(DIST_ENTRY)) fail(`the built bridge is missing at ${DIST_ENTRY} — run 'pnpm run build-bridge'.`);

const missing = ompFreshPreflight(process.env);
if (missing) {
	fail(
		`the OMP fresh preflight refuses this host (${missing}). The composition offers omp, so a host that cannot open it is a ` +
			"broken promise rather than an absent prerequisite. Repair the named unit and re-run.",
	);
}
console.log(`  ok    the OMP fresh preflight passes on this host (all five axes)`);
passed++;

// The callback has to LAND. The caller citizen is minted under the default roots while the
// sibling's bridge child resolves the omp root policy; on a host where those disagree the
// callback would be enqueued into a mailbox this process never reads, and the failure would
// look like "the sibling never called back". Name it up front instead.
const ompRoots = meta.ompMetaRoots();
ok(
	"the omp root policy and this process's default roots address the SAME mailbox — otherwise the callback lands somewhere this step cannot read and the failure would masquerade as a silent sibling",
	ompRoots.mailboxDir === meta.defaultMetaMailboxDir() && ompRoots.sessionsDir === meta.defaultMetaSessionsDir(),
	`        omp:     ${ompRoots.mailboxDir}\n        default: ${meta.defaultMetaMailboxDir()}`,
);

// ── 3. the caller: a citizen the bridge recognises as its own owner ──────────
root = fs.mkdtempSync(path.join(os.tmpdir(), "entwurf-omp-fresh-"));
process.on("exit", teardown);
const scratch = path.join(root, "scratch");
fs.mkdirSync(scratch, { recursive: true });

const nativeSessionId = `omp-fresh-live-${process.pid}`;
const caller = meta.upsertMetaSession({ input: { backend: "claude-code", nativeSessionId, cwd: scratch } });
const callerGid = caller.record.gardenId;
meta.writeMetaReceiverMarker({
	gardenId: callerGid,
	backend: "claude-code",
	nativeSessionId,
	ownerPid: process.pid,
	armProvenance: "session-start",
});
const senderMarkerPath = meta.writeMetaSenderMarker({
	backend: "claude-code",
	gardenId: callerGid,
	nativeSessionId,
	cwd: scratch,
	ownerPid: process.pid,
});
ok("the caller is a record-backed citizen with an armed mailbox and a sender marker", Boolean(callerGid));

const citizensBefore = new Set(
	(
		JSON.parse(execFileSync("bash", [path.join(REPO, "run.sh"), "meta-facts"], { encoding: "utf8" }))
			.citizens as Array<{
			gardenId: string;
		}>
	).map((c) => c.gardenId),
);

// ── 4. a private tmux server, so placement never touches the operator's ──────
{
	socket = path.join(root, "fresh.sock");
	const serverEnv = { ...process.env } as NodeJS.ProcessEnv;
	delete serverEnv.TMUX;
	delete serverEnv.TMUX_PANE;
	const started = spawnSync(
		"tmux",
		["-S", socket, "new-session", "-d", "-s", "fixture", "-n", "anchor", "-c", scratch],
		{ env: serverEnv, encoding: "utf8" },
	);
	if (started.status !== 0) fail(`could not start the private tmux server at ${socket}: ${started.stderr}`);
}
const anchorPane = execFileSync("tmux", ["-S", socket, "display-message", "-p", "-t", "fixture:anchor", "#{pane_id}"], {
	encoding: "utf8",
}).trim();
ok("the tmux anchor is a private socket, never the operator's", socket.startsWith(root) && anchorPane.startsWith("%"));

const bridgeEnv: NodeJS.ProcessEnv = {
	...process.env,
	TMUX: `${socket},0,0`,
	TMUX_PANE: anchorPane,
	ENTWURF_META_SENDER_MARKER: senderMarkerPath,
};

// ── a persistent MCP client over the real bridge ─────────────────────────────
class BridgeClient {
	private child: ChildProcess;
	private buf = "";
	private err = "";
	private next = 2;
	private waiters = new Map<number, (v: { text: string; isError: boolean }) => void>();
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
	call(name: string, args: Record<string, unknown>, timeoutMs = 60_000): Promise<{ text: string; isError: boolean }> {
		const id = this.next++;
		return new Promise((resolve, reject) => {
			const timer = setTimeout(
				() => reject(new Error(`${name} did not answer in ${timeoutMs}ms\n${this.err}`)),
				timeoutMs,
			);
			this.waiters.set(id, (v) => {
				clearTimeout(timer);
				resolve(v);
			});
			this.send({ jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: args } });
		});
	}
}
const bridge = new BridgeClient(bridgeEnv);

// ── 5. open the sibling through the PUBLIC surface ───────────────────────────
const sceneFact = `TEAL-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
const launch = await bridge.call("entwurf_fresh_call", {
	backend: "omp",
	model: OMP_MODEL,
	task: `Answer with the single word ACK and then stop. Do not read files, do not run commands. (scene fact: ${sceneFact})`,
	cwd: scratch,
});
receipts["1-launch"] = launch.text;
ok(
	"tools/call entwurf_fresh_call(backend=omp) returned a LAUNCH receipt through the public surface",
	!launch.isError,
	`--- response ---\n${launch.text}\n--- bridge stderr ---\n${bridge.stderrTail()}`,
);
const nonce = /nonce:\s*(mux-fresh-call-[0-9a-f]+)/.exec(launch.text)?.[1];
ok("the launch receipt carries the correlation nonce", typeof nonce === "string", `--- receipt ---\n${launch.text}`);

// ── 6. the sibling names ITSELF, by exact nonce, from the sender envelope ────
const siblingGid = await until("the nonce callback", CALLBACK_WAIT_MS, () => {
	let sender: string | null = null;
	for (const msg of meta.readMetaInbox({ gardenId: callerGid }).messages) {
		const from = /^\s*session:\s+(\S+)/m.exec(msg.body)?.[1] ?? "";
		if (msg.body.includes(nonce as string) && from) sender = from;
	}
	return sender;
});
receipts["2-callback-identity"] = `${siblingGid} (sender envelope of ${nonce})`;
ok(
	`the sibling called back with the exact nonce and its SENDER ENVELOPE names garden ${siblingGid}`,
	GARDEN_ID.test(siblingGid),
);
ok(
	"the launch receipt never named that garden id — the address came from the CALLBACK, not from the launch",
	!launch.text.includes(siblingGid) && siblingGid !== callerGid,
);

// ── 7. that id is a real omp citizen, and the ONLY one this step minted ──────
const facts = JSON.parse(execFileSync("bash", [path.join(REPO, "run.sh"), "meta-facts"], { encoding: "utf8" }));
const citizen = (facts.citizens as Array<Record<string, unknown>>).find((c) => c.gardenId === siblingGid);
ok(
	"the callback id resolves to a V3 record whose backend is omp",
	citizen?.backend === "omp",
	`        ${JSON.stringify(citizen)}`,
);
const minted = (facts.citizens as Array<{ gardenId: string }>)
	.map((c) => c.gardenId)
	.filter((g) => !citizensBefore.has(g) && g !== callerGid);
ok(
	"exactly ONE new citizen was minted — the visible host, never a subagent (§3.5)",
	minted.length === 1 && minted[0] === siblingGid,
	`        new: ${minted.join(", ") || "(none)"}`,
);

// ── 8. addressed receive into that same native session ───────────────────────
ok(
	"the sibling's own receiver extension armed its mailbox (a self-fetch citizen is deliverable)",
	await until("the sibling's receiver marker", 120_000, () =>
		meta.readMetaReceiverMarker({ gardenId: siblingGid }) ? true : null,
	),
);
const probe = `OMP-FRESH-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
const send = await bridge.call("entwurf_v2", {
	target: siblingGid,
	intent: "fire-and-forget",
	message: `Bundle C acceptance probe ${probe}. No action is requested; this message exists so an automated acceptance can confirm it reached the right mailbox.`,
});
receipts["3-addressed-send"] = send.text;
ok(
	"tools/call entwurf_v2 to the fresh sibling chose the MAILBOX rail, not a refusal",
	!send.isError && /mailbox|enqueued/i.test(send.text),
	`--- response ---\n${send.text}\n--- bridge stderr ---\n${bridge.stderrTail()}`,
);

const statePath = path.join(ompRoots.mailboxDir, siblingGid, "state.json");
const state = await until("the sibling to record a read receipt (lastReadAt)", READ_WAIT_MS, () => {
	if (!fs.existsSync(statePath)) return null;
	try {
		const s = JSON.parse(fs.readFileSync(statePath, "utf8"));
		return s.lastReadAt ? s : null;
	} catch {
		return null;
	}
});
receipts["4-read-receipt"] = JSON.stringify(state);
ok(
	"lastReadAt moved AFTER lastEnqueuedAt — the sibling DRAINED its own inbox; a rung doorbell alone is only a wake attempt",
	Date.parse(state.lastReadAt) >= Date.parse(state.lastEnqueuedAt),
	`        ${JSON.stringify(state)}`,
);

// The drain must have happened INSIDE the session we opened. `entwurf_inbox_read` takes a
// CALLER-SUPPLIED garden id and does not verify it against the caller, so `lastReadAt` alone
// proves a read happened — not that THIS citizen performed it. The vendor's own transcript is
// the oracle, exactly as smoke-omp-receive-live established.
const transcriptPath = citizen?.transcriptPath as string | undefined;
ok("the citizen's V3 record names a transcript for this session", typeof transcriptPath === "string");
ok(
	"the sibling's OWN transcript shows it calling the omp-dialect inbox tool for its OWN garden id — the launch, the callback and the drain are one session",
	await until("the drain to appear in the sibling's transcript", 60_000, () => {
		if (!fs.existsSync(transcriptPath as string)) return null;
		const body = fs.readFileSync(transcriptPath as string, "utf8");
		return body.includes("mcp__entwurf_bridge_entwurf_inbox_read") && body.includes(siblingGid) ? true : null;
	}),
	`        ${transcriptPath}`,
);

// ── 8. the TASK reached that same session, and only AFTER the callback ──────
//
// THIS IS THE STEP THE FIRST CANDIDATE COULD NOT HAVE PASSED. Its argv put the whole framing
// in a positional prompt and the sibling answered `ACK` without calling anything, so a
// "callback + receive" acceptance would still have shipped a sibling that never got its work.
// The two-stage bootstrap splits those into two messages, and the ORDER is the contract: the
// callback-only prompt is delivered first, and the task is released only by the exact
// successful callback result. The transcript is where both are visible, in order, in one
// native session.
const bootstrapLine = buildOmpCallbackOnlyPrompt({ target: callerGid, nonce: nonce as string })
	.split("\n")
	.find((l) => l.includes("FIRST AND ONLY ACTION")) as string;
const transcript = fs.readFileSync(transcriptPath as string, "utf8");
const callbackAt = transcript.indexOf(bootstrapLine);
const taskAt = transcript.indexOf(sceneFact);
receipts["5-two-stage-order"] = `callback-only prompt @${callbackAt}, task scene fact @${taskAt}`;
ok(
	"stage one is in the sibling's own transcript: the extension delivered the callback-ONLY prompt, carrying this call's target and nonce",
	callbackAt >= 0,
	`        expected line: ${bootstrapLine}`,
);
ok(
	"[QK:OMP-FRESH-LIVE-NO-POSITIONAL] the four-backend positional framing appears NOWHERE in this session — omp's first turn came from the extension, not from argv",
	!transcript.includes("After the tool receipt, carry out this task:"),
);
ok(
	"stage two: the caller's TASK reached the same native session as a separate later message",
	taskAt >= 0,
	`        scene fact ${sceneFact} not found in ${transcriptPath}`,
);
ok(
	"[QK:OMP-FRESH-LIVE-CALLBACK-BEFORE-TASK] the callback-only prompt precedes the task — the task is armed by the callback RESULT and sent at the turn_end after it, never raced against it",
	callbackAt >= 0 && taskAt > callbackAt,
	`        callback @${callbackAt} vs task @${taskAt}`,
);
// ARRIVAL IS NOT THE SAME AS A TURN, and #87 paid for that distinction. `[LIVE 2026-08-30]` the
// first stage-two attempt queued the task with an explicit delivery option and it never became a
// message at all; a weaker assertion than "a user message carrying the task, followed by an
// assistant message" would have called a queued-and-forgotten task delivered.
const entries = transcript
	.trim()
	.split("\n")
	.map((l) => {
		try {
			return JSON.parse(l) as { type?: string; message?: { role?: string; content?: unknown[] } };
		} catch {
			return null;
		}
	});
const taskEntry = entries.findIndex(
	(e) =>
		e?.type === "message" && e.message?.role === "user" && JSON.stringify(e.message?.content ?? []).includes(sceneFact),
);
ok(
	"the task arrived as a USER message in that session, not as a queued payload nobody drained",
	taskEntry >= 0,
	`        no user message carrying ${sceneFact} in ${transcriptPath}`,
);
ok(
	"[QK:OMP-FRESH-LIVE-TASK-STARTS-A-TURN] and it STARTED A TURN — an assistant message follows it, which is the only proof the omitted-option send did what the source says it does on an idle session",
	entries.slice(taskEntry + 1).some((e) => e?.type === "message" && e.message?.role === "assistant"),
	`        task entry #${taskEntry} of ${entries.length}, no assistant message after it`,
);

bridge.close();
printReceipts();
console.log(
	`[${LABEL}] ${passed} assertions ok — visible fresh + two-stage bootstrap + addressed receive accepted for omp (step 9 clause 7)`,
);
teardown();
