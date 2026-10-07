// G-send host half (#129 L-send first cell). Runs AS the durable host, under this checkout's
// pi-durable carrier resolver (#130), and is spawned only by scripts/check-pi-durable-send.ts:
//
//   node --import <checkout>/pi/pi-durable/carrier-resolver.mjs \
//        scripts/pi-durable-send-host.mjs <bridge entry> <prompt>
//
// It opens the durable app through the production bootstrap composition, then gives the app ONE
// user input through its native controller — the call its TUI makes when the operator presses
// enter — and watches only the native view. Everything after that input is the app's own: the
// model request, the GenerationTask, the ToolTask, the adapter's bridge call. This driver never
// calls a tool or the bridge itself.
//
// `controller.submit` settling is NOT the turn completing: the controller queues the command and
// turns its failures into notices (runtime.ts:229-252). The driver waits on the view instead —
// the run document is present exactly while the conversation is busy — and reports what the view
// holds. It prints one JSON report line, holds the host alive until the gate writes `close`,
// closes, prints `{"closed":true}` and exits. With ENTWURF_PI_DURABLE_SEND_FAULT=malformed-report
// (the gate's control) it gives the app no input and sends a non-JSON report line instead.
import { createInterface } from "node:readline";
import { openDurableCitizen } from "../plugins/pi-durable/bootstrap.mjs";

const USAGE =
	"usage: pi-durable-send-host.mjs <bridge entry> <prompt> [--await-go] [--report-intent <callId> | --recover <callId>]";
const [bridgeEntry, prompt, ...flags] = process.argv.slice(2);
if (bridgeEntry === undefined || prompt === undefined) throw new Error(USAGE);
// --await-go: report `born` once the citizen exists, and give the app its one input only after the
// gate writes `go` — test-driver sequencing so the gate can read the bridge's counters first. It is
// not a second input and not another controller.
// --report-intent <callId>: after the input, watch the native view and report ONCE the frame in
// which the task graph shows a `pi.tool` node running in phase `execute` and the live slot with the
// same taskId is that call, running. The phase is the task's committed checkpoint (task-graph.ts
// 210-221), written in the same commit as the slot (tool.ts 84-90). Then do nothing: the gate kills
// this process.
// --recover <callId>: continue the newest session, give the app NO input, and report once the view
// holds that call's settled result and the conversation is idle.
let awaitGo = false;
let reportIntent;
let recoverCall;
for (let i = 0; i < flags.length; i++) {
	if (flags[i] === "--await-go") awaitGo = true;
	else if (flags[i] === "--report-intent" && flags[i + 1] !== undefined) reportIntent = flags[++i];
	else if (flags[i] === "--recover" && flags[i + 1] !== undefined) recoverCall = flags[++i];
	else throw new Error(USAGE);
}
if (reportIntent !== undefined && recoverCall !== undefined) throw new Error(USAGE);

const stdinLines = createInterface({ input: process.stdin })[Symbol.asyncIterator]();
/** Wait for one exact line from the gate; the gate closing stdin first is a failure. */
async function waitFor(word) {
	for (;;) {
		const next = await stdinLines.next();
		if (next.done) throw new Error(`stdin closed before "${word}"`);
		if (next.value.trim() === word) return;
	}
}

/** One entry of the native view, reduced to what the gate compares. */
function summarize(entry) {
	const message = entry.model?.[0];
	const blocks = Array.isArray(message?.content) ? message.content : [];
	const text = (typeof message?.content === "string" ? [message.content] : [])
		.concat(blocks.flatMap((b) => (b.type === "text" ? [b.text] : [])))
		.join("\n");
	return {
		kind: entry.kind,
		role: message?.role,
		toolCalls: blocks
			.filter((b) => b.type === "toolCall")
			.map((b) => ({ id: b.id, name: b.name, arguments: b.arguments })),
		...(message?.role === "toolResult"
			? {
					toolCallId: message.toolCallId,
					toolName: message.toolName,
					isError: message.isError === true,
					// The entry's own diagnostics (`data.diagnostics`), copied as they are.
					diagnostics: Array.isArray(entry.data?.diagnostics) ? entry.data.diagnostics : [],
				}
			: {}),
		text,
	};
}

const citizen = await openDurableCitizen({
	bridgeEntry,
	cwd: process.cwd(),
	continueSession: recoverCall !== undefined,
});

/** The frame the gate needs: graph node + same-task live slot, as the native view holds them. */
function intentFrame(view, callId) {
	const nodes = Object.values(view.tasks?.tasks ?? {});
	const slots = view.conversation.docs["pi.live"]?.tools ?? [];
	for (const node of nodes) {
		if (node.kind !== "pi.tool" || node.conversationId !== 1) continue;
		if (node.state?.status !== "running" || node.state?.phase !== "execute") continue;
		const slot = slots.find((s) => s.taskId === node.id);
		if (slot && slot.name === "entwurf_v2" && slot.callId === callId && slot.status === "running") {
			return { node, slot, nodes, slots };
		}
	}
	return undefined;
}

function reportOf(view, before) {
	return {
		hostPid: process.pid,
		session: view.session,
		attachment: citizen.attachment,
		conversationIdBefore: before.conversation.conversation.id,
		conversationIdAfter: view.conversation.conversation.id,
		entries: view.conversation.entries.filter((e) => e.kind.startsWith("pi.")).map(summarize),
		busy: view.conversation.docs["pi.live"]?.run !== undefined,
		notices: view.notices.map((n) => `${n.level}: ${n.message}`),
	};
}
let code = 0;
try {
	if (process.env.ENTWURF_PI_DURABLE_SEND_FAULT === "malformed-report") {
		// The gate's before-valid-report cleanup control: born, no input given to the app, a report
		// line that is deliberately not JSON, then alive until told to close.
		process.stdout.write(`{"malformed send report line\n`);
		await waitFor("close");
		throw new Error("malformed-report control closed");
	}
	const { durable } = citizen;
	if (recoverCall !== undefined) {
		// Recovery may already have run inside openDurable (resume precedes attach): check the current
		// view as well as every later one, so a settled outcome is never missed.
		const before = durable.view.current();
		await new Promise((resolve) => {
			let done = false;
			const check = () => {
				if (done) return;
				const view = durable.view.current();
				const entries = view.conversation.entries;
				const resultAt = entries.findIndex(
					(e) => e.kind === "pi.tool-result" && e.model?.[0]?.toolCallId === recoverCall,
				);
				const answeredAfter = resultAt >= 0 && entries.slice(resultAt + 1).some((e) => e.kind === "pi.assistant");
				const busy = view.conversation.docs["pi.live"]?.run !== undefined;
				const failed = view.notices.some((n) => n.level === "error");
				if ((answeredAfter && !busy) || failed) {
					done = true;
					unsubscribe();
					resolve();
				}
			};
			const unsubscribe = durable.view.subscribe(check);
			check();
		});
		process.stdout.write(`${JSON.stringify({ recovered: true, ...reportOf(durable.view.current(), before) })}\n`);
		await waitFor("close");
		throw new Error("__closed__");
	}
	if (awaitGo) {
		process.stdout.write(
			`${JSON.stringify({ born: true, hostPid: process.pid, attachment: citizen.attachment, session: durable.view.current().session })}\n`,
		);
		await waitFor("go");
	}
	if (reportIntent !== undefined) {
		let reported = false;
		const check = () => {
			if (reported) return;
			const view = durable.view.current();
			const frame = intentFrame(view, reportIntent);
			if (frame === undefined) return;
			reported = true;
			process.stdout.write(
				`${JSON.stringify({ intent: true, hostPid: process.pid, session: view.session, frame, entries: view.conversation.entries.filter((e) => e.kind.startsWith("pi.")).map(summarize) })}\n`,
			);
		};
		durable.view.subscribe(check);
		durable.controller.submit(prompt, "followUp").then(check);
		check();
		// The gate kills this process after the frame; nothing else happens here.
		await waitFor("close");
		throw new Error("report-intent host was asked to close instead of being killed");
	}
	const before = durable.view.current();
	const noticesBefore = before.notices.length;
	let submitted = false;
	const settled = new Promise((resolve) => {
		const check = () => {
			if (!submitted) return;
			const view = durable.view.current();
			const busy = view.conversation.docs["pi.live"]?.run !== undefined;
			const answered = view.conversation.entries.some((e) => e.kind === "pi.assistant");
			const failed = view.notices.slice(noticesBefore).some((n) => n.level === "error");
			if ((!busy && answered) || failed) {
				unsubscribe();
				resolve();
			}
		};
		const unsubscribe = durable.view.subscribe(check);
		durable.controller.submit(prompt, "followUp").then(() => {
			submitted = true;
			check();
		});
	});
	await settled;
	process.stdout.write(`${JSON.stringify(reportOf(durable.view.current(), before))}\n`);
	await waitFor("close");
} catch (error) {
	if (!(error instanceof Error && error.message === "__closed__")) {
		code = 1;
		process.stdout.write(`${JSON.stringify({ error: error instanceof Error ? error.message : String(error) })}\n`);
	}
} finally {
	await citizen.close();
}
process.stdout.write(`${JSON.stringify({ closed: true })}\n`);
process.exit(code);
