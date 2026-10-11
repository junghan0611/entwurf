/**
 * take-pi-cc — one recorded LIVE take: a pi citizen opens a native Claude Code sibling, hands it one task, and
 * gets the result back (#138). Claude Code keeps its own TUI, transcript and auth; it is a self-fetch citizen:
 * a delivery is a durable mailbox ENQUEUE, its hook wakes the idle session, and the model drains the inbox with
 * entwurf_inbox_read — that read is the receipt (DELIVERY.md, Claude Code row).
 *
 * NOT a gate and not release evidence: a maintainer demo take, judged by raw evidence, FAILED when it does not
 * hold. Run: LIVE=1 node demo/take-pi-cc.ts — spends real turns on openai-codex (coordinator) and on the
 * operator's Claude subscription (native Claude Code).
 *
 * Automated: ONE operator task, as the coordinator's argv prompt (take-only flags `-ne -np -e builtin:mcp -e
 * <the three entwurf extensions>`). The sibling is launched by entwurf_fresh_call with the operator's own
 * Claude Code config. Everything else is the citizens' own live turns. The take is an observer: a drift ends it
 * and closes only its own resources; what a native agent already did is not rolled back.
 *
 * Native evidence is the sibling's OWN Claude Code transcript, at the exact path its V3 record carries (written
 * by its SessionStart hook, meta-bridge-hook.ts:236) — one file, never a search of the operator's history.
 */
import { randomBytes } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import * as meta from "../pi-extensions/lib/meta-session.ts";
import {
	parseJsonLines,
	piCallbackSenders,
	piSourceToolReceipts,
	type SourceToolReceipt,
} from "../scripts/lib/codex-fresh-source-receipts.ts";
import {
	claudeNativeView,
	isApprovedCcAlias,
	isNativeModelOfAlias,
	judgeClaudeCodeReceive,
	judgeClaudeNativeWork,
} from "./lib/claude-native-work.ts";
import { judgePiReceipt, NOTES_TEXT, notesExpectation, workQuestion } from "./lib/pi-durable-work.ts";
import {
	CONTROL_SOCKET_BOUNDARY,
	GARDEN_ID,
	gardenIds,
	NONCE,
	newCitizensIn,
	openRouterOverride,
	piAssistantModels,
	piEntriesOf,
	piInbound,
	sleep,
	Take,
} from "./lib/take-recorder.ts";

const LABEL = "take-pi-cc";
const REPO = path.resolve(import.meta.dirname, "..");
const PI_MODEL = process.env.ENTWURF_DEMO_PI_MODEL?.trim() || "openai-codex/gpt-6.1-sol";
const CC_MODEL = process.env.ENTWURF_DEMO_CC_MODEL?.trim() || "sonnet";
const PI_THINKING = process.env.ENTWURF_DEMO_PI_THINKING?.trim() || "low";
const TURN_WAIT_MS = 300_000;

// The approved rails for THIS scene (MODELS.md:44: for a claude-code sibling `sonnet` is the lighter option):
// overrides may only restate them. The CC selector is the ALIAS; the native id it resolves to is observed, not assumed.
const APPROVED = { pi: "openai-codex/gpt-6.1-sol", cc: "sonnet", thinking: "low" } as const;
if (
	PI_MODEL !== APPROVED.pi ||
	CC_MODEL !== APPROVED.cc ||
	PI_THINKING !== APPROVED.thinking ||
	!isApprovedCcAlias(CC_MODEL)
) {
	console.error(
		`[${LABEL}] selector refused: pi=${PI_MODEL} cc=${CC_MODEL} thinking=${PI_THINKING} — this scene runs only on ` +
			`pi=${APPROVED.pi} cc=${APPROVED.cc} thinking=${APPROVED.thinking}.`,
	);
	process.exit(2);
}
const routedVia = openRouterOverride(process.env);
if (routedVia) {
	console.error(`[${LABEL}] refused before any inference: ${routedVia} routes a provider through OpenRouter.`);
	process.exit(2);
}
const isRequestedNativeModel = (m: string) => isNativeModelOfAlias(APPROVED.cc, m);

if (process.env.LIVE !== "1") {
	console.error(
		`[${LABEL}] set LIVE=1 to run — this opens a real visible pi and a native Claude Code sibling on ${CC_MODEL} ` +
			`and spends model turns on ${PI_MODEL} and the operator's Claude subscription.`,
	);
	process.exit(97);
}

const take = new Take({
	label: LABEL,
	repo: REPO,
	cols: Number(process.env.ENTWURF_DEMO_COLS ?? 132),
	rows: Number(process.env.ENTWURF_DEMO_ROWS ?? 38),
	files: { "notes.txt": NOTES_TEXT },
});
const { scratch } = take;
const token = `DEMO-${randomBytes(3).toString("hex").toUpperCase()}`;
const expectation = notesExpectation(token);

const siblingTask =
	"You were opened by a pi sibling for a short recorded demo. After your callback, wait. When an entwurf inbox " +
	"notice arrives, read it with entwurf_inbox_read using your own garden id, do the one small task in the " +
	"message with your own Bash tool, and send the answer back to the sender's garden id with entwurf_v2 " +
	"(intent fire-and-forget). Then stop.";
const question = workQuestion(token);
const firstTask =
	"Demo: open a Claude Code sibling and give it one task. " +
	`(1) entwurf_fresh_call once: backend "claude-code", model "${CC_MODEL}", cwd "${scratch}", task ${JSON.stringify(siblingTask)}. ` +
	"(2) Its garden id arrives by itself as a callback — do not poll or list peers. Then call entwurf_v2 once to " +
	`that id with intent "fire-and-forget", wants_reply true and message ${JSON.stringify(question)}. ` +
	`(3) When its reply arrives, answer me in one line starting with ${token}. Do not run commands yourself.`;

const ext = (f: string) => path.join(REPO, "pi-extensions", f);
const coordinatorArgv = [
	"entwurf",
	"pi",
	"-ne",
	"-np",
	"-e",
	"builtin:mcp",
	"-e",
	ext("acp-provider.ts"),
	"-e",
	ext("entwurf-control.ts"),
	"-e",
	ext("model-lock.ts"),
	"--model",
	PI_MODEL,
	"--thinking",
	PI_THINKING,
	firstTask,
];

const citizensBefore = gardenIds();
const piWindow = take.startSubject("pi", coordinatorArgv);
take.show(piWindow, "operator's first task in pi (take-only flags: entwurf extensions + built-in MCP only)");
take.startRecorder();

function isStop(raw: unknown): boolean {
	const e = raw as { type?: unknown; message?: { role?: unknown; stopReason?: unknown } };
	return e.type === "message" && e.message?.role === "assistant" && e.message.stopReason === "stop";
}
/** The sibling's own Claude Code transcript rows, from the exact path its record names. */
function ccRows(gid: string): unknown[] {
	const t = meta.readMetaIdentityByGardenId(gid)?.transcriptPath ?? "";
	return t && fs.existsSync(t) ? parseJsonLines(fs.readFileSync(t, "utf8")) : [];
}

const known: { piGid?: string; ccGid?: string } = {};

async function run(): Promise<boolean> {
	const { receipts } = take;
	// 1. birth under -ne -np
	const piGid = await take.until("the coordinator pi record under -ne -np", 60_000, () => {
		const fresh = meta
			.listAllMetaIdentitiesDir(meta.defaultMetaSessionsDir())
			.identities.filter((r) => !citizensBefore.has(r.gardenId) && r.cwd === scratch && r.backend === "pi");
		return fresh.length === 1 ? fresh[0]?.gardenId : null;
	});
	if (!piGid) return false;
	known.piGid = piGid;
	if (!take.must("coordinator pi record minted under the take-only flags", GARDEN_ID.test(piGid), piGid)) return false;
	receipts.piGid = piGid;
	const piEntries = () => piEntriesOf(piGid);
	const piTools = (): SourceToolReceipt[] => piSourceToolReceipts(piEntries());

	// 2. the coordinator opens Claude Code (or answered without calling fresh — STOP)
	const launched = await take.until("the coordinator's entwurf_fresh_call(claude-code) result", TURN_WAIT_MS, () => {
		const call = piTools().find(
			(t) => t.toolName === "entwurf_fresh_call" && t.arguments.backend === "claude-code" && t.status !== "pending",
		);
		if (call) return { call };
		return piEntries().some(isStop) ? { call: null } : null;
	});
	if (!launched) return false;
	if (!take.must("the coordinator's MCP surface carried entwurf_fresh_call", launched.call !== null)) return false;
	const launch = launched.call as SourceToolReceipt;
	receipts.launch = { arguments: launch.arguments, text: launch.text };
	if (
		!take.must(
			"coordinator called entwurf_fresh_call(backend claude-code, model sonnet) and got a launch receipt",
			launch.status === "completed" && launch.arguments.model === CC_MODEL,
			launch.text,
		)
	)
		return false;
	const nonce = NONCE.exec(launch.text)?.[1];
	const ccPane = /pane:\s+(%\d+)/.exec(launch.text)?.[1];
	if (!take.must("launch receipt carries nonce and pane", !!nonce && !!ccPane, launch.text)) return false;
	await sleep(2500);
	const ccWindow = take.windowOfPane(ccPane as string);
	take.show(ccWindow, "Claude Code opens in its own TUI; its first action is the callback");

	// 3. the callback is the address; the sibling is a claude-code record whose transcript its hook named
	const ccGid = await take.until("the Claude Code callback in the coordinator's transcript", TURN_WAIT_MS, () => {
		const s = piCallbackSenders(piEntries(), nonce as string);
		return s.length === 1 ? s[0] : null;
	});
	if (!ccGid) return false;
	if (!take.must("Claude Code called back with the exact nonce", GARDEN_ID.test(ccGid), ccGid)) return false;
	known.ccGid = ccGid;
	if (!take.must("the address came from the callback, not the launch receipt", !launch.text.includes(ccGid)))
		return false;
	const ccRecord = meta.readMetaIdentityByGardenId(ccGid);
	receipts.ccGid = ccGid;
	receipts.ccRecord = ccRecord;
	if (
		!take.must(
			"the sibling is a claude-code record in this take's cwd with a transcript path",
			ccRecord?.backend === "claude-code" && ccRecord.cwd === scratch && !!ccRecord.transcriptPath,
			JSON.stringify(ccRecord),
		)
	)
		return false;
	const firstModels = await take.until("Claude Code's first assistant row", 60_000, () => {
		const m = claudeNativeView(ccRows(ccGid)).models;
		return m.length > 0 ? m : null;
	});
	if (
		!take.must(
			"Claude Code's callback turn answered in the requested alias's family (drift ends the take here)",
			!!firstModels && firstModels.length === 1 && isRequestedNativeModel(firstModels[0] as string),
			JSON.stringify(firstModels),
		)
	)
		return false;
	await sleep(2500);
	take.show(piWindow, "callback arrives; the coordinator dispatches with entwurf_v2 (mailbox)");

	// 4. coordinator → Claude Code: a durable mailbox ENQUEUE (not a read, not an answer)
	const toCc = await take.until("the coordinator's entwurf_v2 → Claude Code result", TURN_WAIT_MS, () =>
		piTools().find((t) => t.toolName === "entwurf_v2" && t.arguments.target === ccGid && t.status !== "pending"),
	);
	if (!toCc) return false;
	receipts.piToCc = { arguments: toCc.arguments, text: toCc.text };
	if (
		!take.must(
			"coordinator → Claude Code answered as a mailbox ENQUEUE",
			toCc.status === "completed" && /meta-mailbox → enqueued/.test(toCc.text),
			toCc.text,
		)
	)
		return false;
	await sleep(2500);
	take.show(ccWindow, "Claude Code wakes on its own hook, reads its inbox, runs Bash, replies");

	// 5. the read receipt, then the reply under Claude Code's envelope
	const state = await take.until("Claude Code's read receipt", TURN_WAIT_MS, () => {
		const file = path.join(meta.defaultMetaMailboxDir(), ccGid, "state.json");
		const s = JSON.parse(fs.readFileSync(file, "utf8")) as { lastReadAt?: string; lastEnqueuedAt?: string };
		return s.lastReadAt && s.lastEnqueuedAt && Date.parse(s.lastReadAt) >= Date.parse(s.lastEnqueuedAt) ? s : null;
	});
	if (!state) return false;
	receipts.ccMailboxState = state;
	take.step("Claude Code read its own inbox (lastReadAt ≥ lastEnqueuedAt)", true, JSON.stringify(state));
	const reply = await take.until("Claude Code's reply landing in the coordinator", TURN_WAIT_MS, () =>
		piInbound(piEntries()).find((m) => m.sender === ccGid && m.payload.includes(token)),
	);
	if (!reply) return false;
	receipts.replyInPi = reply;
	take.step("Claude Code's reply landed in the coordinator under its sender envelope", true, reply.payload);
	await sleep(4000);
	take.show(piWindow, "the reply arrives in pi as its own message; pi answers the operator");
	await take.until("the coordinator's closing answer", 180_000, () =>
		piEntries()
			.slice(reply.index + 1)
			.some(isStop)
			? true
			: null,
	);
	await sleep(6000);
	for (const v of judgePiReceipt(reply, piEntries(), expectation)) take.step(v.name, v.ok, v.detail);

	// 6. native evidence: Claude Code's own transcript (receive, Bash, reply) and its model
	const rows = ccRows(ccGid);
	const view = claudeNativeView(rows);
	receipts.ccNative = { models: view.models, sessionIds: view.sessionIds, cwds: view.cwds, bash: view.bash };
	for (const v of judgeClaudeNativeWork(view, String(ccRecord?.nativeSessionId), scratch, expectation))
		take.step(v.name, v.ok, v.detail);
	for (const v of judgeClaudeCodeReceive(rows, ccGid, piGid, CONTROL_SOCKET_BOUNDARY))
		take.step(v.name, v.ok, v.detail);
	take.step(
		"Claude Code answered in the requested alias's family on every row (observed ids recorded)",
		view.models.length > 0 && view.models.every(isRequestedNativeModel),
		JSON.stringify(view.models),
	);

	// 7. the coordinator did no work itself; models measured; exactly two citizens minted
	const coordinatorBash = piTools().filter((t) => t.toolName === "bash");
	take.step(
		"the coordinator ran no bash itself (the work is the sibling's)",
		coordinatorBash.length === 0,
		JSON.stringify(coordinatorBash),
	);
	const piModels = piAssistantModels(piEntries());
	receipts.piModels = piModels;
	take.measuredModels = { pi: piModels, "Claude Code (native)": view.models };
	take.step(
		"coordinator actual model (transcript assistant rows)",
		piModels.length === 1 && piModels[0] === PI_MODEL,
		piModels.join(" "),
	);
	const minted = newCitizensIn(scratch, citizensBefore);
	take.step(
		"exactly two citizens minted in this take's cwd (coordinator pi, Claude Code)",
		minted.length === 2 && minted.includes(piGid) && minted.includes(ccGid),
		minted.join(", "),
	);
	return true;
}

/** Finish scope: copy raw for what the take established — on a pass and on every early stop alike. */
function collectRaw(): void {
	const errors: string[] = [];
	const copy = (from: string | null | undefined, name: string) => {
		try {
			if (from && fs.existsSync(from)) fs.copyFileSync(from, path.join(take.takeDir, name));
			else if (from) errors.push(`${name}: ${from} absent`);
		} catch (err) {
			errors.push(`${name}: ${err instanceof Error ? err.message : String(err)}`);
		}
	};
	if (known.piGid) copy(meta.readMetaIdentityByGardenId(known.piGid)?.transcriptPath, "pi-transcript.jsonl");
	if (known.ccGid) copy(meta.readMetaIdentityByGardenId(known.ccGid)?.transcriptPath, "claude-code-transcript.jsonl");
	if (errors.length > 0) take.receipts.collectErrors = errors;
}

const passed = await run().catch((err) => {
	take.step("take aborted", false, err instanceof Error ? (err.stack ?? err.message) : String(err));
	return false;
});
collectRaw();
const ok = await take.finish(passed, {
	selectors: { pi: PI_MODEL, piThinking: PI_THINKING, claudeCode: CC_MODEL },
	token,
	operatorInput: {
		kind: "argv prompt to `entwurf pi` with take-only extension flags",
		argv: coordinatorArgv.slice(0, -1),
		text: firstTask,
	},
	measuredModels: take.measuredModels,
});
process.exit(ok ? 0 : 1);
