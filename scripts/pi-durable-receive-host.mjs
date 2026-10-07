// G-receive host half (#129 L-receive). Runs AS the durable host, under this checkout's pi-durable
// carrier resolver (#130), and is spawned only by scripts/check-pi-durable-receive.ts:
//
//   node --import <checkout>/pi/pi-durable/carrier-resolver.mjs \
//        scripts/pi-durable-receive-host.mjs <bridge entry>
//
// It opens the durable app through the production bootstrap composition — which arms the contact's
// doorbell on the root conversation — reports `born`, and then gives the app NO input: no controller
// call, no tool call, no bridge call, no native state of its own. Whatever runs afterwards was
// started by the doorbell's root admission. The driver only watches the native view and the
// contact's own `receiver()` state (never the path the attachment returned, which a later retire
// can make stale), and reports once:
//
//   - the receiver has made an admission, the view holds an assistant entry after the newest user
//     entry that calls no tool, and the conversation is no longer busy; or
//   - the receiver is no longer armed; or
//   - the app raised an error notice.
//
// Then it holds the host alive until the gate writes `close`, closes, prints `{"closed":true}` and
// exits.
import { createInterface } from "node:readline";
import { openDurableCitizen } from "../plugins/pi-durable/bootstrap.mjs";

const USAGE = "usage: pi-durable-receive-host.mjs <bridge entry>";
const [bridgeEntry, ...extra] = process.argv.slice(2);
if (bridgeEntry === undefined || extra.length > 0) throw new Error(USAGE);

const stdinLines = createInterface({ input: process.stdin })[Symbol.asyncIterator]();
/** Wait for one exact line from the gate; the gate closing stdin first is a failure. */
async function waitFor(word) {
	for (;;) {
		const next = await stdinLines.next();
		if (next.done) throw new Error(`stdin closed before "${word}"`);
		if (next.value.trim() === word) return;
	}
}

/** One entry of the native view, reduced to what the gate compares (the send driver's reduction). */
function summarize(entry) {
	const message = entry.model?.[0];
	const blocks = Array.isArray(message?.content) ? message.content : [];
	const text = (typeof message?.content === "string" ? [message.content] : [])
		.concat(blocks.flatMap((b) => (b.type === "text" ? [b.text] : [])))
		.join("\n");
	return {
		id: entry.id,
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
					diagnostics: Array.isArray(entry.data?.diagnostics) ? entry.data.diagnostics : [],
				}
			: {}),
		text,
	};
}

const citizen = await openDurableCitizen({ bridgeEntry, cwd: process.cwd() });

function reportOf(view, why) {
	return {
		settled: why,
		hostPid: process.pid,
		session: view.session,
		conversationId: view.conversation.conversation.id,
		receiver: citizen.contact.receiver(),
		entries: view.conversation.entries.filter((e) => e.kind.startsWith("pi.")).map(summarize),
		busy: view.conversation.docs["pi.live"]?.run !== undefined,
		notices: view.notices.map((n) => `${n.level}: ${n.message}`),
	};
}

let code = 0;
try {
	const { durable } = citizen;
	const born = durable.view.current();
	const noticesBefore = born.notices.length;
	process.stdout.write(
		`${JSON.stringify({
			born: true,
			hostPid: process.pid,
			session: born.session,
			conversationId: born.conversation.conversation.id,
			attachment: citizen.attachment,
			receiver: citizen.contact.receiver(),
		})}\n`,
	);
	const why = await new Promise((resolve) => {
		let done = false;
		const check = () => {
			if (done) return;
			const view = durable.view.current();
			const receiver = citizen.contact.receiver();
			const entries = view.conversation.entries;
			const lastUser = entries.findLastIndex((e) => e.kind === "pi.user");
			const lastAnswer =
				lastUser < 0 ? undefined : entries.slice(lastUser + 1).findLast((e) => e.kind === "pi.assistant");
			const answered = lastAnswer !== undefined && summarize(lastAnswer).toolCalls.length === 0;
			const busy = view.conversation.docs["pi.live"]?.run !== undefined;
			let outcome;
			if (receiver.status !== "armed") outcome = "receiver-not-armed";
			else if (view.notices.slice(noticesBefore).some((n) => n.level === "error")) outcome = "error-notice";
			else if (receiver.admissions.length > 0 && answered && !busy) outcome = "answered";
			if (outcome === undefined) return;
			done = true;
			unsubscribe();
			resolve(outcome);
		};
		const unsubscribe = durable.view.subscribe(check);
		check();
	});
	process.stdout.write(`${JSON.stringify(reportOf(durable.view.current(), why))}\n`);
	await waitFor("close");
} catch (error) {
	code = 1;
	process.stdout.write(`${JSON.stringify({ error: error instanceof Error ? error.message : String(error) })}\n`);
} finally {
	await citizen.close();
}
process.stdout.write(`${JSON.stringify({ closed: true })}\n`);
process.exit(code);
