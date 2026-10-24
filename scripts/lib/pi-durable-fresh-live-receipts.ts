/**
 * The oracles of `smoke-pi-durable-fresh-live`, as pure functions over raw evidence, so the same code
 * that judges a live run can re-judge its saved raw (Pi's JSONL and the pd native-store snapshot).
 *
 * Pi side: a message lands only as an exact payload with ONE anchored terminal sender envelope —
 * `piCallbackSenders` already decides that shape; this adds the expected sender and returns the row.
 * A body that merely MENTIONS the token and the sender's id (the fixture's own instruction did) is
 * not a delivery.
 *
 * pd side: the native store's ROOT conversation only (no owner conversation or task), read through
 * its entry kinds — `pi.system` (tool offering, applied as toolsAdded/toolsRemoved in order),
 * `pi.assistant` (the model that answered, and the tool calls in order) and `pi.tool-result` (each
 * call's settled result, joined by toolCallId).
 *
 * Each call also carries the native ENTRY ids of its call and of its result (`callOrdinal` /
 * `resultOrdinal`). Entries are read in id order, so the ids order what the store recorded — the same
 * fact Pi's transcript row index gives the bootstrap-order leaf (`assertBootstrapOrder`).
 */
import { piCallbackSenders, type SourceToolReceipt } from "./codex-fresh-source-receipts.ts";

/** The one Pi transcript row whose exact payload arrived from `expectedSender`, or null. */
export function piExactDeliveryRow(
	entries: readonly unknown[],
	payload: string,
	expectedSender: string,
): { row: unknown; index: number } | null {
	const hits: { row: unknown; index: number }[] = [];
	entries.forEach((row, index) => {
		const senders = piCallbackSenders([row], payload);
		if (senders.length === 1 && senders[0] === expectedSender) hits.push({ row, index });
	});
	return hits.length === 1 ? (hits[0] as { row: unknown; index: number }) : null;
}

export interface PdNativeRow {
	id: number;
	conversation_id: number;
	record: string;
}
export interface PdNativeSubmissionRow {
	conversation_id: number;
	status: string;
	record: string;
}
export interface PdToolCall {
	id: string;
	name: string;
	arguments: Record<string, unknown>;
	result: { text: string; isError: boolean } | null;
	/** Native entry id of the assistant row that made this call. */
	callOrdinal: number;
	/** Native entry id of the tool-result row joined to it, or null while none is recorded. */
	resultOrdinal: number | null;
}
export interface PdRootView {
	offering: string[];
	models: string[];
	calls: PdToolCall[];
}

interface Message {
	role?: unknown;
	provider?: unknown;
	model?: unknown;
	content?: unknown;
	toolsAdded?: unknown;
	toolsRemoved?: unknown;
	toolCallId?: unknown;
	isError?: unknown;
}

function messagesOf(record: Record<string, unknown>): Message[] {
	return Array.isArray(record.model) ? (record.model as Message[]) : [];
}
function names(list: unknown): string[] {
	return Array.isArray(list)
		? list.flatMap((t) =>
				t !== null && typeof t === "object" && typeof (t as { name?: unknown }).name === "string"
					? [(t as { name: string }).name]
					: [],
			)
		: [];
}

/** The root conversation's offering, models and tool calls, from its own entries in id order. */
export function pdRootView(entries: readonly PdNativeRow[], rootConversationId: number): PdRootView {
	let offering: string[] = [];
	const models = new Set<string>();
	const calls: PdToolCall[] = [];
	const byId = new Map<string, PdToolCall>();
	for (const row of [...entries].sort((a, b) => a.id - b.id)) {
		if (row.conversation_id !== rootConversationId) continue;
		const record = JSON.parse(row.record) as Record<string, unknown>;
		for (const message of messagesOf(record)) {
			if (record.kind === "pi.system") {
				const removed = new Set(names(message.toolsRemoved));
				offering = [...offering.filter((n) => !removed.has(n)), ...names(message.toolsAdded)];
			} else if (record.kind === "pi.assistant" && message.role === "assistant") {
				if (typeof message.provider === "string" && typeof message.model === "string")
					models.add(`${message.provider}/${message.model}`);
				for (const block of Array.isArray(message.content) ? message.content : []) {
					const b = block as { type?: unknown; id?: unknown; name?: unknown; arguments?: unknown };
					if (b.type !== "toolCall" || typeof b.id !== "string" || typeof b.name !== "string") continue;
					const call: PdToolCall = {
						id: b.id,
						name: b.name,
						arguments: (b.arguments ?? {}) as Record<string, unknown>,
						result: null,
						callOrdinal: row.id,
						resultOrdinal: null,
					};
					calls.push(call);
					byId.set(b.id, call);
				}
			} else if (
				record.kind === "pi.tool-result" &&
				message.role === "toolResult" &&
				typeof message.toolCallId === "string"
			) {
				const call = byId.get(message.toolCallId);
				if (call === undefined) continue;
				const text = (Array.isArray(message.content) ? message.content : [])
					.map((c) =>
						(c as { type?: unknown; text?: unknown }).type === "text" ? String((c as { text: unknown }).text) : "",
					)
					.join("");
				call.result = { text, isError: message.isError === true };
				call.resultOrdinal = row.id;
			}
		}
	}
	return { offering, models: [...models], calls };
}

/**
 * The root calls as source receipts, in call order, for the bootstrap-order leaf: a call with no joined
 * result is PENDING, an errored result is FAILED. pd's verbs are its own bare tool names, so no
 * dialect translation happens here.
 */
export function pdSourceToolReceipts(calls: readonly PdToolCall[]): SourceToolReceipt[] {
	return calls.map((call) => ({
		toolName: call.name,
		arguments: call.arguments,
		text: call.result?.text ?? "",
		status: call.result === null ? "pending" : call.result.isError ? "failed" : "completed",
		isError: call.result?.isError ?? false,
		callOrdinal: call.callOrdinal,
		...(call.resultOrdinal === null ? {} : { resultOrdinal: call.resultOrdinal }),
	}));
}

/** The doorbell submission for exactly this mailbox message, on the root conversation. */
export function pdDoorbellSubmission(
	submissions: readonly PdNativeSubmissionRow[],
	rootConversationId: number,
	requestId: string,
): { status: string; record: Record<string, unknown> } | null {
	const hits = submissions
		.map((s) => ({ s, record: JSON.parse(s.record) as Record<string, unknown> }))
		.filter(({ s, record }) => s.conversation_id === rootConversationId && record.requestId === requestId);
	return hits.length === 1
		? {
				status: (hits[0] as { s: PdNativeSubmissionRow }).s.status,
				record: (hits[0] as { record: Record<string, unknown> }).record,
			}
		: null;
}
