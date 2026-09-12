import { isDeepStrictEqual } from "node:util";
import { launchReceiptWindows } from "./launch-receipt-windows.ts";

export type SourceToolStatus = "pending" | "completed" | "failed";

export interface SourceToolReceipt {
	toolName: string;
	arguments: Record<string, unknown>;
	text: string;
	status: SourceToolStatus;
	isError: boolean;
}

export interface ExpectedSourceToolCall {
	toolName: string;
	arguments: Record<string, unknown>;
}

/** Select one source call in its backend/target scope, rejecting drift, errors, and duplicates. */
export function selectExactSourceToolReceipt(
	receipts: readonly SourceToolReceipt[],
	toolName: string,
	expectedArguments: Record<string, unknown>,
	label: string,
): SourceToolReceipt | null {
	const scopeKey = toolName === "entwurf_v2" ? "target" : null;
	const matchingScope = receipts.filter(
		(receipt) =>
			receipt.toolName === toolName &&
			(scopeKey === null || receipt.arguments[scopeKey] === expectedArguments[scopeKey]),
	);
	if (matchingScope.length > 1) throw new Error(`${label}: duplicate source tool calls (${matchingScope.length})`);
	const receipt = matchingScope[0] ?? null;
	if (receipt === null) return null;
	if (!isDeepStrictEqual(receipt.arguments, expectedArguments))
		throw new Error(
			`${label}: source tool arguments differ\nexpected=${JSON.stringify(expectedArguments)}\nactual=${JSON.stringify(receipt.arguments)}`,
		);
	if (receipt.status === "pending") return null;
	if (receipt.status === "failed") throw new Error(`${label}: exact source tool result failed: ${receipt.text}`);
	return receipt;
}

export function assertSourceCallScopes(
	receipts: readonly SourceToolReceipt[],
	toolName: string,
	scopeKey: string,
	allowed: readonly unknown[],
	label: string,
): void {
	for (const receipt of receipts) {
		if (receipt.toolName !== toolName) continue;
		if (!allowed.includes(receipt.arguments[scopeKey]))
			throw new Error(`${label}: unexpected ${scopeKey} ${JSON.stringify(receipt.arguments[scopeKey])}`);
	}
}

/** Final exact-once audit over every source-observed Entwurf role in one smoke citizen. */
export function assertExactSourceToolCalls(
	receipts: readonly SourceToolReceipt[],
	expected: readonly ExpectedSourceToolCall[],
	label: string,
): void {
	if (receipts.length !== expected.length)
		throw new Error(`${label}: source call count differs: expected=${expected.length} actual=${receipts.length}`);
	const remaining = [...expected];
	for (const receipt of receipts) {
		if (receipt.status !== "completed") throw new Error(`${label}: ${receipt.toolName} remained ${receipt.status}`);
		const index = remaining.findIndex(
			(candidate) =>
				candidate.toolName === receipt.toolName && isDeepStrictEqual(candidate.arguments, receipt.arguments),
		);
		if (index < 0)
			throw new Error(`${label}: unexpected source call ${receipt.toolName} ${JSON.stringify(receipt.arguments)}`);
		remaining.splice(index, 1);
	}
	if (remaining.length > 0) throw new Error(`${label}: missing source calls ${JSON.stringify(remaining)}`);
}

/** The only production leaf that turns joined source receipts into cleanup window authority. */
export function sourceCleanupWindows(receipts: readonly SourceToolReceipt[]): string[] {
	const windows: string[] = [];
	for (const receipt of receipts) {
		if (receipt.toolName !== "entwurf_fresh_call" || receipt.status !== "completed" || receipt.isError) continue;
		const backend = receipt.arguments.backend;
		if (backend !== "pi" && backend !== "codex") continue;
		windows.push(...launchReceiptWindows(receipt.text, backend));
	}
	return windows;
}

function textContent(value: unknown): string {
	if (!Array.isArray(value)) return "";
	return value
		.map((block) => {
			if (typeof block !== "object" || block === null) return "";
			const text = (block as { text?: unknown }).text;
			return typeof text === "string" ? text : "";
		})
		.join("\n");
}

function looksLikeIncompleteJsonAppend(source: string): boolean {
	let depth = 0;
	let inString = false;
	let escaped = false;
	for (const character of source) {
		if (inString) {
			if (escaped) escaped = false;
			else if (character === "\\") escaped = true;
			else if (character === '"') inString = false;
			continue;
		}
		if (character === '"') inString = true;
		else if (character === "{" || character === "[") depth++;
		else if (character === "}" || character === "]") depth--;
		if (depth < 0) return false;
	}
	return inString || depth > 0;
}

/**
 * Resolve a source transcript path whose own record may not carry it yet. The record stays the
 * sole authority: an empty cache re-reads it, so a path the runtime writes AFTER callback
 * correlation is still observed instead of being frozen out of the run. Measured — a pi record
 * gained its `transcriptPath` 34s after correlation, and a one-shot read made every later
 * source observation permanently empty. A reader that throws is fail-loud; only "the record has
 * no path yet" is pending. Model prose and tmux listings are never a substitute source.
 */
export function resolveSourceTranscriptPath(cached: string, readRecordPath: () => string | null | undefined): string {
	if (cached !== "") return cached;
	return readRecordPath() ?? "";
}

/** Parse complete JSONL rows; only one structurally incomplete final append is pending. */
export function parseJsonLines(source: string): unknown[] {
	const lines = source.split("\n");
	const entries: unknown[] = [];
	for (const [index, line] of lines.entries()) {
		if (line.trim() === "") continue;
		try {
			entries.push(JSON.parse(line));
		} catch (error) {
			const isIncompleteLastAppend =
				index === lines.length - 1 && !source.endsWith("\n") && looksLikeIncompleteJsonAppend(line);
			if (isIncompleteLastAppend) return entries;
			throw new Error(
				`invalid complete JSONL row ${index + 1}: ${error instanceof Error ? error.message : String(error)}`,
			);
		}
	}
	return entries;
}

/** Join Pi's own toolCall and toolResult rows by native id, retaining pending calls. */
export function piSourceToolReceipts(entries: readonly unknown[]): SourceToolReceipt[] {
	const calls = new Map<string, { toolName: string; arguments: Record<string, unknown> }>();
	const results = new Map<string, { toolName: string; text: string; isError: boolean }>();
	for (const raw of entries) {
		if (typeof raw !== "object" || raw === null) continue;
		const entry = raw as { type?: unknown; message?: unknown };
		if (entry.type !== "message" || typeof entry.message !== "object" || entry.message === null) continue;
		const message = entry.message as {
			role?: unknown;
			content?: unknown;
			toolCallId?: unknown;
			toolName?: unknown;
			isError?: unknown;
		};
		if (message.role === "assistant" && Array.isArray(message.content)) {
			for (const rawBlock of message.content) {
				if (typeof rawBlock !== "object" || rawBlock === null) continue;
				const block = rawBlock as { type?: unknown; id?: unknown; name?: unknown; arguments?: unknown };
				if (block.type !== "toolCall") continue;
				if (
					typeof block.id !== "string" ||
					typeof block.name !== "string" ||
					typeof block.arguments !== "object" ||
					block.arguments === null ||
					Array.isArray(block.arguments)
				)
					throw new Error("malformed Pi toolCall row");
				if (calls.has(block.id)) throw new Error(`duplicate Pi toolCall id ${block.id}`);
				calls.set(block.id, {
					toolName: block.name,
					arguments: block.arguments as Record<string, unknown>,
				});
			}
		}
		if (message.role === "toolResult") {
			if (typeof message.toolCallId !== "string" || typeof message.toolName !== "string")
				throw new Error("malformed Pi toolResult row");
			if (typeof message.isError !== "boolean")
				throw new Error(`Pi toolResult ${message.toolCallId} lacks explicit boolean isError`);
			if (results.has(message.toolCallId)) throw new Error(`duplicate Pi toolResult id ${message.toolCallId}`);
			results.set(message.toolCallId, {
				toolName: message.toolName,
				text: textContent(message.content),
				isError: message.isError,
			});
		}
	}
	for (const id of results.keys()) {
		if (!calls.has(id)) throw new Error(`unmatched Pi toolResult id ${id}`);
	}
	const joined: SourceToolReceipt[] = [];
	for (const [id, call] of calls) {
		const result = results.get(id);
		if (result === undefined) {
			joined.push({ ...call, text: "", status: "pending", isError: false });
			continue;
		}
		if (result.toolName !== call.toolName)
			throw new Error(`Pi tool name drift for ${id}: call=${call.toolName} result=${result.toolName}`);
		joined.push({
			...call,
			text: result.text,
			status: result.isError ? "failed" : "completed",
			isError: result.isError,
		});
	}
	return joined;
}

export function codexThreadIsTerminal(thread: unknown): boolean {
	if (typeof thread !== "object" || thread === null || !Array.isArray((thread as { turns?: unknown }).turns))
		throw new Error("malformed Codex thread/read turns");
	const turns = (thread as { turns: unknown[] }).turns;
	if (turns.length === 0) return false;
	for (const rawTurn of turns) {
		if (typeof rawTurn !== "object" || rawTurn === null) throw new Error("malformed Codex thread/read turn");
		if (!Array.isArray((rawTurn as { items?: unknown }).items)) throw new Error("malformed Codex thread/read items");
		const status = (rawTurn as { status?: unknown }).status;
		if (status === "inProgress") return false;
		if (status === "failed" || status === "interrupted") throw new Error(`Codex turn ended ${status}, not completed`);
		if (status !== "completed") throw new Error(`unknown Codex turn status ${String(status)}`);
	}
	return true;
}

/** Read Entwurf MCP calls from Codex thread/read, retaining vendor inProgress state. */
export function codexSourceToolReceipts(thread: unknown): SourceToolReceipt[] {
	if (typeof thread !== "object" || thread === null) return [];
	const turns = (thread as { turns?: unknown }).turns;
	if (!Array.isArray(turns)) return [];
	const found: SourceToolReceipt[] = [];
	const ids = new Set<string>();
	for (const rawTurn of turns) {
		if (typeof rawTurn !== "object" || rawTurn === null) continue;
		const items = (rawTurn as { items?: unknown }).items;
		if (!Array.isArray(items)) continue;
		for (const rawItem of items) {
			if (typeof rawItem !== "object" || rawItem === null) continue;
			const item = rawItem as {
				type?: unknown;
				id?: unknown;
				server?: unknown;
				tool?: unknown;
				status?: unknown;
				arguments?: unknown;
				result?: unknown;
				error?: unknown;
			};
			if (item.type !== "mcpToolCall" || item.server !== "entwurf-bridge") continue;
			if (typeof item.id !== "string" || typeof item.tool !== "string")
				throw new Error("malformed Codex entwurf MCP call identity");
			if (ids.has(item.id)) throw new Error(`duplicate Codex MCP tool-call id ${item.id}`);
			ids.add(item.id);
			if (typeof item.arguments !== "object" || item.arguments === null || Array.isArray(item.arguments))
				throw new Error(`malformed Codex MCP arguments for ${item.id}`);
			const result = typeof item.result === "object" && item.result !== null ? item.result : null;
			if (item.status === "inProgress") {
				if (result !== null || item.error !== null)
					throw new Error(`malformed inProgress Codex MCP state for ${item.id}`);
				found.push({
					toolName: item.tool,
					arguments: item.arguments as Record<string, unknown>,
					text: "",
					status: "pending",
					isError: false,
				});
				continue;
			}
			if (item.status !== "completed" && item.status !== "failed")
				throw new Error(`unknown Codex MCP status ${String(item.status)} for ${item.id}`);
			const completed = item.status === "completed" && item.error === null && result !== null;
			found.push({
				toolName: item.tool,
				arguments: item.arguments as Record<string, unknown>,
				text: textContent((result as { content?: unknown } | null)?.content),
				status: completed ? "completed" : "failed",
				isError: !completed,
			});
		}
	}
	return found;
}

function exactSenderInfoSuffix(text: string, nonce: string): string | null {
	const prefix = `${nonce}\n\n<sender_info>`;
	const suffix = "</sender_info>";
	if (!text.startsWith(prefix) || !text.endsWith(suffix)) return null;
	const json = text.slice(prefix.length, -suffix.length);
	if (json.includes("\n") || json.includes("<sender_info>")) return null;
	try {
		const sender = JSON.parse(json) as { sessionId?: unknown };
		return typeof sender.sessionId === "string" ? sender.sessionId : null;
	} catch {
		return null;
	}
}

/** Exact callback in Pi's own transcript: nonce plus one terminal generated sender envelope. */
export function piCallbackSenders(entries: readonly unknown[], nonce: string): string[] {
	const found: string[] = [];
	for (const raw of entries) {
		if (typeof raw !== "object" || raw === null) continue;
		const entry = raw as { type?: unknown; customType?: unknown; content?: unknown };
		if (entry.type !== "custom_message" || entry.customType !== "entwurf-message" || typeof entry.content !== "string")
			continue;
		const sender = exactSenderInfoSuffix(entry.content, nonce);
		if (sender !== null) found.push(sender);
	}
	return found;
}

export interface MetaMailboxBody {
	sender: string;
	payload: string;
}

/** Strip exactly formatMetaMailboxBody's anchored outer frame and one terminal newline. */
export function parseMetaMailboxBody(text: string): MetaMailboxBody | null {
	const frame =
		/^\[entwurf received ⟵\]\n {2}from: {8}[^\n]*\n {2}session: {5}(\S+)(?: [^\n]*)?\n {2}at: {10}[^\n]+\n {2}wants reply: (?:yes|no)\n────────────────────────────────────────\n/;
	const match = frame.exec(text);
	if (match === null || !text.endsWith("\n")) return null;
	return { sender: match[1] as string, payload: text.slice(match[0].length, -1) };
}

export interface FinalMailboxValidation {
	accepted: boolean;
	reason: string;
	parsed: MetaMailboxBody | null;
}

export function validateFinalMailboxBody(
	body: string,
	expectedSender: string,
	expectedPayload: string,
): FinalMailboxValidation {
	const parsed = parseMetaMailboxBody(body);
	if (parsed === null) return { accepted: false, reason: "rejected: invalid outer frame", parsed: null };
	if (parsed.sender !== expectedSender)
		return { accepted: false, reason: `rejected: sender differs from ${expectedSender}`, parsed };
	if (parsed.payload !== expectedPayload)
		return { accepted: false, reason: "rejected: payload differs from source-call argument", parsed };
	return { accepted: true, reason: "accepted: exact outer frame, sender, and source-call payload", parsed };
}

export interface MailboxCallback {
	body: string;
	sender: string;
}

/** Exact callback bodies read by the record-backed fixture's mailbox. */
export function mailboxCallbacks(bodies: readonly string[], nonce: string): MailboxCallback[] {
	const found: MailboxCallback[] = [];
	for (const body of bodies) {
		const parsed = parseMetaMailboxBody(body);
		if (parsed !== null && parsed.payload === nonce) found.push({ body, sender: parsed.sender });
	}
	return found;
}

/** Exact callback in a Codex thread/read userMessage item. */
export function codexCallbackSenders(thread: unknown, nonce: string): string[] {
	if (typeof thread !== "object" || thread === null) return [];
	const turns = (thread as { turns?: unknown }).turns;
	if (!Array.isArray(turns)) return [];
	const found: string[] = [];
	for (const rawTurn of turns) {
		if (typeof rawTurn !== "object" || rawTurn === null) continue;
		const items = (rawTurn as { items?: unknown }).items;
		if (!Array.isArray(items)) continue;
		for (const rawItem of items) {
			if (typeof rawItem !== "object" || rawItem === null || (rawItem as { type?: unknown }).type !== "userMessage")
				continue;
			const content = (rawItem as { content?: unknown }).content;
			if (!Array.isArray(content) || content.length !== 1) continue;
			const block = content[0];
			if (typeof block !== "object" || block === null || typeof (block as { text?: unknown }).text !== "string")
				continue;
			const parsed = parseMetaMailboxBody((block as { text: string }).text);
			if (parsed !== null && parsed.payload === nonce) found.push(parsed.sender);
		}
	}
	return found;
}
