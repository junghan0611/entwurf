/**
 * take-pi-acp — one recorded LIVE take: a pi citizen opens a pi sibling whose provider is ACP Claude, and the
 * two work together (#138). The sibling is a pi citizen like any other — its record is `backend: "pi"` with the
 * model `entwurf/claude-sonnet-5`; ACP mints no second citizen and no socket layer (AGENTS.md ACP plugin).
 *
 * NOT a gate and not release evidence: a maintainer demo take, judged by raw evidence, FAILED when it does not
 * hold. Run: LIVE=1 node demo/take-pi-acp.ts — spends real turns on openai-codex (coordinator) and on the
 * operator's Claude subscription through the ACP provider (sibling).
 *
 * Automated: ONE operator task, as the coordinator's argv prompt. The coordinator pi is started with take-only
 * flags that load just the entwurf extensions and no prompt templates (`-ne -np -e builtin:mcp -e <the three
 * entwurf extensions>`, pi docs/cli.md:195-197) — this take MEASURES that its birth and MCP surface survive (named STOP if not). The
 * sibling is launched by entwurf_fresh_call with the operator's normal pi config (a product surface this take
 * does not change). Everything else is the citizens' own live turns.
 *
 * Work evidence: the sibling's Bash runs INSIDE ACP Claude, so pi shows it only as a `[tool:*]` text notice
 * (event-mapper.ts:20-25) — recorded, never graded. The graded evidence is Claude's own transcript
 * (demo/lib/claude-native-work.ts). If it cannot be located, native work is UNMEASURED and the take FAILS.
 * The coordinator running Bash itself would be its own work, not the sibling's: it must run none.
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
import { claudeNativeView, judgeClaudeNativeWork, resolveAcpTranscript } from "./lib/claude-native-work.ts";
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

const LABEL = "take-pi-acp";
const REPO = path.resolve(import.meta.dirname, "..");
const PI_MODEL = process.env.ENTWURF_DEMO_PI_MODEL?.trim() || "openai-codex/gpt-6.1-sol";
const ACP_MODEL = process.env.ENTWURF_DEMO_ACP_MODEL?.trim() || "entwurf/claude-sonnet-5";
const PI_THINKING = process.env.ENTWURF_DEMO_PI_THINKING?.trim() || "low";
const TURN_WAIT_MS = 300_000;

// The approved rails for THIS scene (MODELS.md, coordinator 2026-10-11): an override may only restate them.
// Checked before any process starts — an unknown selector never reaches a launch.
const APPROVED = { pi: "openai-codex/gpt-6.1-sol", acp: "entwurf/claude-sonnet-5", thinking: "low" } as const;
if (PI_MODEL !== APPROVED.pi || ACP_MODEL !== APPROVED.acp || PI_THINKING !== APPROVED.thinking) {
	console.error(
		`[${LABEL}] selector refused: pi=${PI_MODEL} acp=${ACP_MODEL} thinking=${PI_THINKING} — this scene runs only on ` +
			`pi=${APPROVED.pi} acp=${APPROVED.acp} thinking=${APPROVED.thinking}.`,
	);
	process.exit(2);
}
const ACP_MODEL_ID = ACP_MODEL.slice(ACP_MODEL.indexOf("/") + 1); // the id the ACP session record stores
const routedVia = openRouterOverride(process.env);
if (routedVia) {
	console.error(`[${LABEL}] refused before any inference: ${routedVia} routes a provider through OpenRouter.`);
	process.exit(2);
}

if (process.env.LIVE !== "1") {
	console.error(
		`[${LABEL}] set LIVE=1 to run — this opens a real visible pi and a pi sibling on ${ACP_MODEL} and spends ` +
			`model turns on ${PI_MODEL} and the operator's Claude subscription (ACP).`,
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
	"You were opened by a pi sibling for a short recorded demo. After your callback, wait. When a message from " +
	"the sibling that opened you arrives, do the one small task it asks with your own Bash tool, and send the " +
	"answer back to its garden id with entwurf_v2 (intent fire-and-forget). Then stop.";
const question = workQuestion(token);
const firstTask =
	"Demo: open a pi sibling on Claude and give it one task. " +
	`(1) entwurf_fresh_call once: backend "pi", model "${ACP_MODEL}", cwd "${scratch}", task ${JSON.stringify(siblingTask)}. ` +
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

/** What this take has established so far — the finish scope collects raw for exactly these, on every path. */
const known: { piGid?: string; sibGid?: string; acpJsonl?: string } = {};

async function run(): Promise<boolean> {
	const { receipts } = take;
	// 1. birth under -ne: the coordinator pi mints its own record (or the take stops by name)
	const piGid = await take.until(
		"the coordinator pi record under -ne (birth survived the take-only flags)",
		60_000,
		() => {
			const fresh = meta
				.listAllMetaIdentitiesDir(meta.defaultMetaSessionsDir())
				.identities.filter((r) => !citizensBefore.has(r.gardenId) && r.cwd === scratch && r.backend === "pi");
			return fresh.length === 1 ? fresh[0]?.gardenId : null;
		},
	);
	if (!piGid) return false;
	known.piGid = piGid;
	if (
		!take.must(
			"coordinator pi record minted under -ne -e builtin:mcp -e <entwurf extensions>",
			GARDEN_ID.test(piGid),
			piGid,
		)
	)
		return false;
	receipts.piGid = piGid;
	const piEntries = () => piEntriesOf(piGid);
	const piTools = (): SourceToolReceipt[] => piSourceToolReceipts(piEntries());

	// 2. MCP under -ne: the coordinator's live turn reaches entwurf_fresh_call — or it answered without it (STOP).
	// `until` reads a throwing probe as "not yet", so the early stop is a sentinel value, not an exception.
	const launched = await take.until("the coordinator's entwurf_fresh_call(pi, ACP) result", TURN_WAIT_MS, () => {
		const call = piTools().find(
			(t) => t.toolName === "entwurf_fresh_call" && t.arguments.backend === "pi" && t.status !== "pending",
		);
		if (call) return { call };
		return piEntries().some(isStop) ? { call: null } : null;
	});
	if (!launched) return false;
	if (!take.must("the coordinator's MCP surface under -ne carried entwurf_fresh_call", launched.call !== null))
		return false;
	const launch = launched.call as SourceToolReceipt;
	receipts.launch = { arguments: launch.arguments, text: launch.text };
	if (
		!take.must(
			"coordinator called entwurf_fresh_call(backend pi, model entwurf/claude-sonnet-5) and got a launch receipt",
			launch.status === "completed" && launch.arguments.model === ACP_MODEL,
			launch.text,
		)
	)
		return false;
	const nonce = NONCE.exec(launch.text)?.[1];
	const sibPane = /pane:\s+(%\d+)/.exec(launch.text)?.[1];
	if (!take.must("launch receipt carries nonce and pane", !!nonce && !!sibPane, launch.text)) return false;
	await sleep(2500);
	const sibWindow = take.windowOfPane(sibPane as string);
	take.show(sibWindow, "the sibling opens: a pi citizen whose provider is ACP Claude; it calls back before its task");

	// 3. the callback is the address; the sibling is a pi record with the ACP model
	const sibGid = await take.until("the sibling's callback in the coordinator's transcript", TURN_WAIT_MS, () => {
		const s = piCallbackSenders(piEntries(), nonce as string);
		return s.length === 1 ? s[0] : null;
	});
	if (!sibGid) return false;
	if (!take.must("the sibling called back with the exact nonce", GARDEN_ID.test(sibGid), sibGid)) return false;
	known.sibGid = sibGid;
	if (!take.must("the address came from the callback, not the launch receipt", !launch.text.includes(sibGid)))
		return false;
	const sibRecord = meta.readMetaIdentityByGardenId(sibGid);
	receipts.sibGid = sibGid;
	receipts.sibRecord = sibRecord;
	if (
		!take.must(
			"the sibling is a pi record whose model is the ACP provider's (no separate ACP citizen)",
			sibRecord?.backend === "pi" && sibRecord.model === ACP_MODEL,
			JSON.stringify(sibRecord),
		)
	)
		return false;
	// The sibling's own callback turn answered as exactly the requested model. The take is an observer: a drift
	// ends it here and closes only its own resources — what a native agent already did is not rolled back, and
	// the coordinator may already be acting on its own first task.
	const firstModels = await take.until("the sibling's first assistant row", 60_000, () => {
		const m = piAssistantModels(piEntriesOf(sibGid));
		return m.length > 0 ? m : null;
	});
	if (
		!take.must(
			"the sibling's callback turn answered as exactly the requested ACP model (drift ends the take here)",
			!!firstModels && firstModels.length === 1 && firstModels[0] === ACP_MODEL,
			JSON.stringify(firstModels),
		)
	)
		return false;
	await sleep(2500);
	take.show(piWindow, "callback arrives; the coordinator dispatches with entwurf_v2 (control socket)");

	// 4. coordinator → sibling: a control-socket acceptance boundary (contrast: pi-durable answers by mailbox)
	const toSib = await take.until("the coordinator's entwurf_v2 → sibling result", TURN_WAIT_MS, () =>
		piTools().find((t) => t.toolName === "entwurf_v2" && t.arguments.target === sibGid && t.status !== "pending"),
	);
	if (!toSib) return false;
	receipts.piToSib = { arguments: toSib.arguments, text: toSib.text };
	if (
		!take.must(
			"coordinator → sibling answered at a control-socket boundary",
			toSib.status === "completed" && CONTROL_SOCKET_BOUNDARY.test(toSib.text),
			toSib.text,
		)
	)
		return false;
	await sleep(2500);
	take.show(sibWindow, "ACP Claude runs its own Bash on the task and replies with entwurf_v2");

	// 5. the reply lands in the coordinator from the sibling's own envelope
	const reply = await take.until("the sibling's reply landing in the coordinator", TURN_WAIT_MS, () =>
		piInbound(piEntries()).find((m) => m.sender === sibGid && m.payload.includes(token)),
	);
	if (!reply) return false;
	receipts.replyInPi = reply;
	take.step("the sibling's reply landed in the coordinator under the sibling's sender envelope", true, reply.payload);
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

	// 6. native work: ACP Claude's own transcript, located from the sibling's own cache record (never searched)
	const sibEntries = piEntriesOf(sibGid);
	const sibModels = piAssistantModels(sibEntries);
	const located = resolveAcpTranscript([`pi:${sibRecord?.nativeSessionId}`, `pi:${sibGid}`], {
		cwd: scratch,
		modelId: ACP_MODEL_ID,
	});
	receipts.acpTranscriptResolution = located;
	let nativeModels: string[] = [];
	if (located.ok && fs.existsSync(located.jsonl)) {
		known.acpJsonl = located.jsonl;
		const view = claudeNativeView(parseJsonLines(fs.readFileSync(located.jsonl, "utf8")));
		nativeModels = view.models;
		receipts.acpNative = { models: view.models, sessionIds: view.sessionIds, cwds: view.cwds, bash: view.bash };
		for (const v of judgeClaudeNativeWork(view, located.acpSessionId, scratch, expectation))
			take.step(v.name, v.ok, v.detail);
	} else {
		take.step(
			"native ACP work measured from Claude's own transcript",
			false,
			`UNMEASURED — ${located.ok ? `no transcript at ${located.jsonl}` : located.reason}; ${JSON.stringify(located.diagnostics)}`,
		);
	}
	// recorded, not graded: the pi-side text notice entwurf drew for that Bash
	receipts.siblingToolNotices = sibEntries
		.flatMap((raw) => {
			const e = raw as { type?: unknown; message?: { role?: unknown; content?: unknown } };
			if (e.type !== "message" || e.message?.role !== "assistant" || !Array.isArray(e.message.content)) return [];
			return (e.message.content as Array<{ type?: unknown; text?: unknown }>)
				.filter((b) => b.type === "text" && typeof b.text === "string")
				.flatMap((b) => (b.text as string).split("\n").filter((l) => /^\[tool:/.test(l)));
		})
		.slice(0, 20);

	// 7. the coordinator did no work itself; models measured exactly; exactly two citizens minted
	const coordinatorBash = piTools().filter((t) => t.toolName === "bash");
	take.step(
		"the coordinator ran no bash itself (the work is the sibling's)",
		coordinatorBash.length === 0,
		JSON.stringify(coordinatorBash),
	);
	const piModels = piAssistantModels(piEntries());
	receipts.piModels = piModels;
	take.measuredModels = { pi: piModels, "pi sibling": sibModels, "ACP Claude (native)": nativeModels };
	take.step(
		"coordinator actual model (transcript assistant rows)",
		piModels.length === 1 && piModels[0] === PI_MODEL,
		piModels.join(" "),
	);
	take.step(
		"the sibling's pi transcript answered as exactly the requested ACP model",
		sibModels.length === 1 && sibModels[0] === ACP_MODEL,
		sibModels.join(" "),
	);
	const minted = newCitizensIn(scratch, citizensBefore);
	take.step(
		"exactly two citizens minted in this take's cwd (coordinator pi, ACP-backed pi sibling)",
		minted.length === 2 && minted.includes(piGid) && minted.includes(sibGid),
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
	if (known.sibGid) copy(meta.readMetaIdentityByGardenId(known.sibGid)?.transcriptPath, "sibling-pi-transcript.jsonl");
	if (known.acpJsonl) copy(known.acpJsonl, "acp-claude-transcript.jsonl");
	if (errors.length > 0) take.receipts.collectErrors = errors;
}

const passed = await run().catch((err) => {
	take.step("take aborted", false, err instanceof Error ? (err.stack ?? err.message) : String(err));
	return false;
});
collectRaw();
const ok = await take.finish(passed, {
	selectors: { pi: PI_MODEL, piThinking: PI_THINKING, sibling: ACP_MODEL },
	token,
	operatorInput: {
		kind: "argv prompt to `entwurf pi` with take-only extension flags",
		argv: coordinatorArgv.slice(0, -1),
		text: firstTask,
	},
	measuredModels: take.measuredModels,
});
process.exit(ok ? 0 : 1);
