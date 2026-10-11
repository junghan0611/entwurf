/**
 * The work oracle of the pi ↔ pi-durable demo take (#138): did pi-durable actually do the small task, and did the
 * actual result travel back? Pure functions over raw evidence — pd's native root tool calls (`pdRootView`) and
 * pi's own transcript rows — so the same code judges a live take and re-judges its saved raw.
 *
 * Narrow on purpose: the fixture file has a known line count and first line, and each hop must carry exactly
 * those facts. A tool call that merely exists, or a reply that merely carries the token, is not the work.
 */
import type { PdToolCall } from "../../scripts/lib/pi-durable-fresh-live-receipts.ts";

/** The scratch fixture the take writes; its count and first line are what the work must report. */
export const NOTES_LINES = [
	"the record is the address",
	"a launch receipt is not delivery",
	"a receipt is not the answer",
] as const;
export const NOTES_TEXT = `${NOTES_LINES.join("\n")}\n`;

export interface WorkExpectation {
	token: string;
	lineCount: number;
	firstLine: string;
}
export interface Verdict {
	name: string;
	ok: boolean;
	detail: string;
}

export function notesExpectation(token: string): WorkExpectation {
	return { token, lineCount: NOTES_LINES.length, firstLine: NOTES_LINES[0] };
}

const CONTROL_SOCKET_SETTLED =
	/^entwurf_v2 control-socket → (sent|queued-steer|queued-follow-up|accepted-unknown-boundary)/;

/** `wc -l notes.txt` printed exactly one count line for the fixture, and it is the expected count. A digit
 * anywhere else (a nonce, a duration) is not a count. */
export function bashCountsLines(output: string, exp: WorkExpectation): boolean {
	const counts = [...output.matchAll(/^\s*(\d+)\s+notes\.txt\s*$/gm)].map((m) => Number(m[1]));
	return counts.length === 1 && counts[0] === exp.lineCount;
}

/** A reply states the count in exactly one of two declared forms — `<n> line(s)` or wc's own `<n> notes.txt` —
 * every such statement is the expected count, and there is at least one. The count must stand alone: the token's
 * digits (`DEMO-AB3DEF`), a decimal (`3.5 lines`) or a duration (`3.0s`) are not counts. */
export function statesLineCount(text: string, exp: WorkExpectation): boolean {
	const counts = [...text.matchAll(/(?<![\w.-])(\d+)\s+(?:lines?\b|notes\.txt\b)/gi)].map((m) => Number(m[1]));
	return counts.length > 0 && counts.every((n) => n === exp.lineCount);
}

/** The work question a take sends: token first, the count stated as `N lines`, and the first line. */
export function workQuestion(token: string): string {
	return (
		`${token}: please run \`wc -l notes.txt\` and \`head -n 1 notes.txt\` in your working directory and reply ` +
		`starting with ${token}, stating the count as "N lines", and including the first line.`
	);
}

/** A reply carries the work result: the declared line count and the fixture's exact first line. */
export function carriesResult(text: string, exp: WorkExpectation): boolean {
	return text.includes(exp.firstLine) && statesLineCount(text, exp);
}

/** pd's native side: a bash call that settled without error and printed the result, then entwurf_v2 back to pi
 * carrying the token and that result, settled as a control-socket dispatch. */
export function judgePdWork(calls: readonly PdToolCall[], piGid: string, exp: WorkExpectation): Verdict[] {
	const bash = calls.filter((c) => c.name === "bash");
	const bashOk = bash.find(
		(c) =>
			c.result !== null &&
			!c.result.isError &&
			bashCountsLines(c.result.text, exp) &&
			c.result.text.includes(exp.firstLine),
	);
	const back = calls.filter((c) => c.name === "entwurf_v2" && c.arguments.target === piGid);
	const backOk = back.find((c) => {
		const message = c.arguments.message;
		return (
			typeof message === "string" &&
			message.includes(exp.token) &&
			carriesResult(message, exp) &&
			c.result !== null &&
			!c.result.isError &&
			CONTROL_SOCKET_SETTLED.test(c.result.text)
		);
	});
	return [
		{
			name: "pi-durable's native bash settled without error and printed the fixture's line count and first line",
			ok: bashOk !== undefined,
			detail: JSON.stringify(bash.map((c) => c.result)),
		},
		{
			name: "pi-durable's entwurf_v2 back to pi carries the token and the work result, settled on pi's control socket",
			ok: backOk !== undefined,
			detail: JSON.stringify(back.map((c) => ({ message: c.arguments.message, result: c.result }))),
		},
	];
}

/** Text of a COMPLETED assistant row (stopReason "stop"); an interim tool-use row is not an answer. */
function completedAnswerText(raw: unknown): string | null {
	const e = raw as { type?: unknown; message?: { role?: unknown; content?: unknown; stopReason?: unknown } };
	if (e.type !== "message" || e.message?.role !== "assistant" || e.message.stopReason !== "stop") return null;
	if (!Array.isArray(e.message.content)) return null;
	return e.message.content
		.map((b) => {
			const block = b as { type?: unknown; text?: unknown };
			return block.type === "text" && typeof block.text === "string" ? block.text : "";
		})
		.join("");
}

/** pi's side: the reply that landed under pd's envelope carries token + result, and pi's closing answer — the
 * LAST completed (stop) assistant row after that reply — carries the token and the result too. */
export function judgePiReceipt(
	reply: { index: number; payload: string } | null,
	entries: readonly unknown[],
	exp: WorkExpectation,
): Verdict[] {
	const answers = reply
		? entries
				.slice(reply.index + 1)
				.map(completedAnswerText)
				.filter((t): t is string => t !== null && t.trim() !== "")
		: [];
	const closing = answers[answers.length - 1];
	return [
		{
			name: "the reply that landed in pi carries the token and the work result",
			ok: reply !== null && reply.payload.includes(exp.token) && carriesResult(reply.payload, exp),
			detail: reply?.payload ?? "(no reply row)",
		},
		{
			name: "pi's closing answer (last completed row after the reply) carries the token and the work result",
			ok: closing !== undefined && closing.includes(exp.token) && carriesResult(closing, exp),
			detail: JSON.stringify(closing ?? "(no completed answer after the reply)"),
		},
	];
}
