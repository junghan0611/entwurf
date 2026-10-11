/**
 * take-pi-durable — one recorded LIVE take of a pi citizen and a pi-durable citizen working together (#138).
 *
 * NOT a gate and not release evidence. It is a maintainer demo take: real native TUIs, real model turns, real
 * entwurf verbs, recorded read-only, then judged by the same raw evidence the LIVE smoke reads. A take whose
 * evidence does not hold is kept as a FAILED diagnostic and never promoted.
 *
 *   LIVE=1 node demo/take-pi-durable.ts            # spends real model turns on the approved rails below
 *
 * What is automated, and what is not:
 *   operator   ONE first task, given to `entwurf pi` as its argv prompt (no keystrokes into any pane).
 *   view       a recorder-only grouped tmux session on a PRIVATE tmux server this take owns. Switching
 *              its window changes what the recording shows; it never changes the subject session's
 *              current window, pane layout or any citizen's placement.
 *   everything else — the fresh launch, the callback address, both entwurf_v2 dispatches, pi-durable's
 *              doorbell/inbox read/native tool work and its reply — is the citizens' own live turns.
 *
 * Writes: REAL meta roots (the births run inside the launched processes, as for smoke-pi-durable-fresh-live,
 * which has no env carrier to fence them). Records, transcripts and the durable session database are left in
 * place. Only this take's private tmux server is killed at the end.
 *
 * Oracles reuse scripts/lib/{codex-fresh-source-receipts,pi-durable-fresh-live-receipts}.ts. Screen text is
 * never delivery evidence; the view-switch log only says what the recording was pointed at.
 */
import { createHash, randomBytes } from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as meta from "../pi-extensions/lib/meta-session.ts";
import {
	piCallbackSenders,
	piSourceToolReceipts,
	type SourceToolReceipt,
} from "../scripts/lib/codex-fresh-source-receipts.ts";
import { type PdNativeRow, pdRootView } from "../scripts/lib/pi-durable-fresh-live-receipts.ts";
import { judgePdWork, judgePiReceipt, NOTES_TEXT, notesExpectation, workQuestion } from "./lib/pi-durable-work.ts";
import {
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

const LABEL = "take-pi-durable";
const REPO = path.resolve(import.meta.dirname, "..");
const PI_MODEL = process.env.ENTWURF_DEMO_PI_MODEL?.trim() || "openai-codex/gpt-6.1-sol";
const PD_MODEL = process.env.ENTWURF_DEMO_PD_MODEL?.trim() || "openai-codex/gpt-6.1-sol";
const PI_THINKING = process.env.ENTWURF_DEMO_PI_THINKING?.trim() || "low";
const TURN_WAIT_MS = 300_000;

// The approved rails for THIS scene, as in the other takes: overrides may only restate them.
const APPROVED = { pi: "openai-codex/gpt-6.1-sol", pd: "openai-codex/gpt-6.1-sol", thinking: "low" } as const;
if (PI_MODEL !== APPROVED.pi || PD_MODEL !== APPROVED.pd || PI_THINKING !== APPROVED.thinking) {
	console.error(
		`[${LABEL}] selector refused: pi=${PI_MODEL} pd=${PD_MODEL} thinking=${PI_THINKING} — this scene runs only on ` +
			`pi=${APPROVED.pi} pd=${APPROVED.pd} thinking=${APPROVED.thinking}.`,
	);
	process.exit(2);
}
const routedVia = openRouterOverride(process.env);
if (routedVia) {
	console.error(`[${LABEL}] refused before any inference: ${routedVia} routes a provider through OpenRouter.`);
	process.exit(2);
}

if (process.env.LIVE !== "1") {
	console.error(
		`[${LABEL}] set LIVE=1 to run — this opens a real visible pi and pi-durable and spends model turns on ` +
			`${PI_MODEL} (pi) and ${PD_MODEL} (pi-durable).`,
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

const pdTask =
	"You were opened by a pi sibling for a short recorded demo. After your callback, wait. When an entwurf " +
	"inbox notice arrives, read it with entwurf_inbox_read using your own garden id, do the one small task in " +
	"the message with your own tools, and send the answer back to the sender's garden id with entwurf_v2 " +
	"(intent fire-and-forget). Then stop.";
const question = workQuestion(token);
const firstTask =
	"Demo: work with a pi-durable sibling. " +
	`(1) Call entwurf_fresh_call once: backend "pi-durable", model "${PD_MODEL}", cwd "${scratch}", ` +
	`task ${JSON.stringify(pdTask)}. ` +
	"(2) Its garden id arrives by itself as a callback message — do not poll or list peers. When it arrives, " +
	'call entwurf_v2 once to that sender\'s garden id with intent "fire-and-forget", wants_reply true and ' +
	`message ${JSON.stringify(question)}. ` +
	`(3) When its reply arrives, tell me the answer in one line starting with ${token}, and stop. Do not read files or run commands yourself.`;

const citizensBefore = gardenIds();
const piWindow = take.startSubject("pi", ["entwurf", "pi", "--model", PI_MODEL, "--thinking", PI_THINKING, firstTask]);
take.show(piWindow, "operator's first task in pi");
take.startRecorder();

async function run(): Promise<boolean> {
	const { step, receipts } = { step: take.step.bind(take), receipts: take.receipts };
	// 1. the pi citizen is born by its own extension in the scratch cwd
	const piGid = await take.until("the pi record in the scratch cwd", 60_000, () => {
		const fresh = meta
			.listAllMetaIdentitiesDir(meta.defaultMetaSessionsDir())
			.identities.filter((r) => !citizensBefore.has(r.gardenId) && r.cwd === scratch && r.backend === "pi");
		return fresh.length === 1 ? fresh[0]?.gardenId : null;
	});
	if (!piGid) return false;
	step("pi citizen record minted in the scratch cwd", GARDEN_ID.test(piGid), piGid);
	receipts.piGid = piGid;
	const piEntries = () => piEntriesOf(piGid);
	const piTools = (): SourceToolReceipt[] => piSourceToolReceipts(piEntries());

	// 2. pi's live turn opens pi-durable (launch receipt: nonce + pane, never the address)
	const launch = await take.until("pi's entwurf_fresh_call(pi-durable) result", TURN_WAIT_MS, () =>
		piTools().find(
			(t) => t.toolName === "entwurf_fresh_call" && t.arguments.backend === "pi-durable" && t.status !== "pending",
		),
	);
	if (!launch) return false;
	receipts.launch = { arguments: launch.arguments, text: launch.text };
	step("pi called entwurf_fresh_call(pi-durable) and got a launch receipt", launch.status === "completed", launch.text);
	const nonce = NONCE.exec(launch.text)?.[1];
	const pdPane = /pane:\s+(%\d+)/.exec(launch.text)?.[1];
	if (!nonce || !pdPane) {
		step("launch receipt carries nonce and pane", false, launch.text);
		return false;
	}
	await sleep(2500); // let pi render its tool result before the view moves
	const pdWindow = take.windowOfPane(pdPane);
	take.show(pdWindow, "pi-durable opens; its first action is the callback");

	// 3. pd's callback lands in pi with the exact nonce; the sender envelope is the address
	const pdGid = await take.until("pi-durable's callback in pi's transcript", TURN_WAIT_MS, () => {
		const s = piCallbackSenders(piEntries(), nonce);
		return s.length === 1 ? s[0] : null;
	});
	if (!pdGid) return false;
	step("pi-durable called back with the exact nonce", GARDEN_ID.test(pdGid), pdGid);
	step("the address came from the callback, not the launch receipt", !launch.text.includes(pdGid));
	const pdRecord = meta.readMetaIdentityByGardenId(pdGid);
	step("the callback id is a pi-durable record", pdRecord?.backend === "pi-durable", JSON.stringify(pdRecord));
	receipts.pdGid = pdGid;
	receipts.pdRecord = pdRecord;
	await sleep(2500);
	take.show(piWindow, "callback arrives in pi; pi dispatches with entwurf_v2");

	// 4. pi → pd: a mailbox ENQUEUE receipt (not a read, not an answer)
	const toPd = await take.until("pi's entwurf_v2 → pi-durable result", TURN_WAIT_MS, () =>
		piTools().find((t) => t.toolName === "entwurf_v2" && t.arguments.target === pdGid && t.status !== "pending"),
	);
	if (!toPd) return false;
	receipts.piToPd = { arguments: toPd.arguments, text: toPd.text };
	step(
		"pi → pi-durable answered as a mailbox ENQUEUE",
		toPd.status === "completed" && /meta-mailbox → enqueued/.test(toPd.text),
		toPd.text,
	);
	await sleep(2500);
	take.show(pdWindow, "pi-durable wakes on its doorbell, reads its inbox, works, replies");

	// 5. pd drained its inbox (read receipt) and its reply lands in pi from pd's own envelope
	const pdState = await take.until("pi-durable's read receipt", TURN_WAIT_MS, () => {
		const file = path.join(meta.defaultMetaMailboxDir(), pdGid, "state.json");
		const s = JSON.parse(fs.readFileSync(file, "utf8")) as { lastReadAt?: string; lastEnqueuedAt?: string };
		return s.lastReadAt && s.lastEnqueuedAt && Date.parse(s.lastReadAt) >= Date.parse(s.lastEnqueuedAt) ? s : null;
	});
	if (!pdState) return false;
	receipts.pdMailboxState = pdState;
	step("pi-durable read its own inbox (lastReadAt ≥ lastEnqueuedAt)", true, JSON.stringify(pdState));
	const reply = await take.until("pi-durable's reply landing in pi", TURN_WAIT_MS, () =>
		piInbound(piEntries()).find((m) => m.sender === pdGid && m.payload.includes(token)),
	);
	if (!reply) return false;
	receipts.replyInPi = reply;
	step("pi-durable's reply landed in pi under pi-durable's sender envelope", true, reply.payload);
	await sleep(4000);
	take.show(piWindow, "the reply arrives in pi as its own message; pi answers the operator");

	// 6. pi's closing turn: wait for a completed assistant row after the reply, then hold on screen
	await take.until("pi's answer after the reply", 180_000, () =>
		piEntries()
			.slice(reply.index + 1)
			.some((raw) => {
				const e = raw as { type?: unknown; message?: { role?: unknown; stopReason?: unknown } };
				return e.type === "message" && e.message?.role === "assistant" && e.message.stopReason === "stop";
			})
			? true
			: null,
	);
	await sleep(6000);
	for (const v of judgePiReceipt(reply, piEntries(), expectation)) step(v.name, v.ok, v.detail);

	// 7. pi-durable's NATIVE store — actual model and tool calls (a consistent online snapshot, read-only)
	const agentDir = take.env.PI_CODING_AGENT_DIR?.trim() || path.join(os.homedir(), ".pi", "agent");
	const liveDb = path.join(
		agentDir,
		"experimental",
		"durable-sessions",
		createHash("sha256").update(scratch).digest("hex").slice(0, 24),
		String(pdRecord?.nativeSessionId ?? ""),
		"session.sqlite",
	);
	let pdModels: string[] = [];
	if (fs.existsSync(liveDb)) {
		const snapshot = path.join(take.takeDir, "pd-session.snapshot.sqlite");
		const sqlite = await import("node:sqlite");
		const source = new sqlite.DatabaseSync(liveDb, { readOnly: true });
		try {
			await sqlite.backup(source, snapshot);
		} finally {
			source.close();
		}
		const db = new sqlite.DatabaseSync(snapshot, { readOnly: true });
		const roots = db
			.prepare("SELECT id FROM conversations WHERE owner_conversation_id IS NULL AND owner_task_id IS NULL")
			.all() as Array<{ id: number }>;
		const rows = db.prepare("SELECT id, conversation_id, record FROM entries").all() as unknown as PdNativeRow[];
		db.close();
		const view = roots.length === 1 ? pdRootView(rows, (roots[0] as { id: number }).id) : null;
		pdModels = view?.models ?? [];
		receipts.pdNative = view
			? { models: view.models, calls: view.calls.map((c) => ({ name: c.name, isError: c.result?.isError })) }
			: { roots: roots.length };
		step("pi-durable native store: one root conversation", roots.length === 1);
		step(
			"pi-durable actual model (native pi.assistant rows)",
			!!view && view.models.length === 1 && view.models[0] === PD_MODEL,
			JSON.stringify(view?.models),
		);
		step(
			"pi-durable native calls: callback first, own inbox read, a native tool, entwurf_v2 back to pi",
			!!view &&
				view.calls[0]?.name === "entwurf_callback" &&
				view.calls.some((c) => c.name === "entwurf_inbox_read" && c.arguments.gardenId === pdGid) &&
				view.calls.some((c) => c.name === "bash") &&
				view.calls.some((c) => c.name === "entwurf_v2" && c.arguments.target === piGid && c.result?.isError === false),
			JSON.stringify(view?.calls.map((c) => c.name)),
		);
		for (const v of judgePdWork(view?.calls ?? [], piGid, expectation)) step(v.name, v.ok, v.detail);
	} else {
		step("pi-durable native session database exists", false, liveDb);
	}

	// 8. pi's actual model from its own transcript, and exactly two citizens minted here
	const piModels = piAssistantModels(piEntries());
	receipts.piModels = piModels;
	take.measuredModels = { pi: piModels, "pi-durable": pdModels };
	step(
		"pi actual model (transcript assistant rows)",
		piModels.length === 1 && piModels[0] === PI_MODEL,
		piModels.join(" "),
	);
	const minted = newCitizensIn(scratch, citizensBefore);
	step(
		"exactly two citizens minted in this take's cwd (pi, pi-durable)",
		minted.length === 2 && minted.includes(piGid) && minted.includes(pdGid),
		minted.join(", "),
	);
	fs.copyFileSync(
		meta.readMetaIdentityByGardenId(piGid)?.transcriptPath as string,
		path.join(take.takeDir, "pi-transcript.jsonl"),
	);
	return true;
}

const passed = await run().catch((err) => {
	take.step("take aborted", false, err instanceof Error ? (err.stack ?? err.message) : String(err));
	return false;
});
const ok = await take.finish(passed, {
	selectors: { pi: PI_MODEL, piThinking: PI_THINKING, pd: PD_MODEL },
	token,
	operatorInput: { kind: "argv prompt to `entwurf pi`", text: firstTask },
	measuredModels: take.measuredModels,
});
process.exit(ok ? 0 : 1);
