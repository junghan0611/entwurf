// The receive cell's go/no-go predicates for check-pi-durable-receive (#129 L-receive), as pure
// functions so the exact conditions the gate stops on can be checked on their own. Each returns the
// reasons it refuses; an empty list is the only pass. Nothing here imports the adapter: the doorbell
// notice and the request id are recognised by the contract's public words, not by its constants.

export interface Verdict {
	ok: boolean;
	reasons: string[];
}
const verdict = (reasons: string[]): Verdict => ({ ok: reasons.length === 0, reasons });

/** The mailbox file a meta-mailbox ENQUEUE receipt names, or undefined when the text is not one. */
export function enqueuedFile(receipt: string): string | undefined {
	return /^entwurf_v2 meta-mailbox → enqueued \(([^()/]+\.msg)\)$/.exec(receipt.trim())?.[1];
}

export interface HeldCaptureFacts {
	hostGid: string;
	hostPid: number;
	hostStartKey: string;
	/** The ENQUEUE receipt's file name. */
	enqueued: string | undefined;
	/** The host's mailbox directory listing at the hold. */
	listing: string[];
	/** Bytes of `<enqueued>.delivered` at the hold, or null when absent. */
	deliveredBody: string | null;
	sentMessage: string;
	signalPresent: boolean;
	/** The host's raw receiver marker at the hold, or null when absent. */
	receiverMarker: Record<string, unknown> | null;
	/** The newest user message text of the held request #1. */
	request1UserText: string;
	/** The tool names request #1 offers. */
	request1Tools: string[];
}

/**
 * Everything that must hold while response #1 is withheld: the sender's ENQUEUE named a file, the
 * host's doorbell has already stamped exactly that file `.delivered` (a wake attempt, not a read), its
 * bytes carry the sent message, the signal and the host-owned receiver marker are in place, and the
 * request that the root admission started is the announce — garden and tool named, body absent.
 */
export function heldCaptureVerdict(f: HeldCaptureFacts): Verdict {
	const reasons: string[] = [];
	if (f.enqueued === undefined) return verdict(["the sender's receipt is not a meta-mailbox ENQUEUE"]);
	if (f.listing.includes(f.enqueued)) reasons.push(`${f.enqueued} is still a fresh .msg — no doorbell stamped it`);
	if (!f.listing.includes(`${f.enqueued}.delivered`)) reasons.push(`${f.enqueued}.delivered is absent`);
	if (f.listing.some((n) => n.endsWith(".read"))) reasons.push("a body was already archived before the hold");
	if (f.deliveredBody === null || !f.deliveredBody.includes(f.sentMessage)) {
		reasons.push("the delivered bytes do not carry the sent message");
	}
	if (!f.signalPresent) reasons.push("inbox.signal is absent");
	const m = f.receiverMarker;
	if (m === null) reasons.push("the host's receiver marker is absent");
	else {
		if (m.gardenId !== f.hostGid) reasons.push("the receiver marker names another garden");
		if (m.ownerPid !== f.hostPid) reasons.push("the receiver marker is not owned by the spawned host");
		if (m.ownerStartKey !== `linux:${f.hostStartKey}`)
			reasons.push("the receiver marker's start key is not the host's");
		if (m.ownerKind !== "pi-durable-host") reasons.push("the receiver marker is not pi-durable-host");
	}
	const text = f.request1UserText;
	if (!text.startsWith("[entwurf inbox] 1 unread mailbox message available for garden ")) {
		reasons.push("request #1's user input is not a one-message doorbell notice");
	}
	if (!text.includes(f.hostGid) || !text.includes("entwurf_inbox_read")) {
		reasons.push("the notice does not name the host's garden and entwurf_inbox_read");
	}
	if (text.includes(f.sentMessage)) reasons.push("the notice carries the body");
	if (!f.request1Tools.includes("entwurf_inbox_read")) reasons.push("request #1 does not offer entwurf_inbox_read");
	return verdict(reasons);
}

/**
 * How upstream writes the indexed `submissions.request_id` column: `JSON.stringify` of the request id
 * (`[read packages/durable/src/storage/sqlite/storage.ts:64 encodeIndexedString, :762 insert, :442
 * lookup]` @cd32f77), the same encoding R1 measured on `tasks.kind`. The record JSON keeps it raw.
 */
export const encodedRequestIdColumn = (requestId: string): string => JSON.stringify(requestId);

export interface SubmissionFacts {
	/** The `submissions` row whose parsed record carries the request id, with that record, or null. */
	row: { id?: unknown; conversation_id?: unknown; request_id?: unknown; status?: unknown } | null;
	record: {
		id?: unknown;
		conversationId?: unknown;
		requestId?: unknown;
		type?: unknown;
		status?: unknown;
		entry?: unknown;
	} | null;
	/** Rows whose parsed record carries the request id, over the whole table. */
	rowsForRequest: number;
	/** Rows whose indexed `request_id` column holds the request id as upstream encodes it. */
	rowsForColumn: number;
	/** The entry the record names, parsed, or null. */
	entry: { kind?: unknown; model?: { role?: unknown; content?: unknown }[] } | null;
}

/**
 * The copied database holds exactly one input submission for the doorbell's request id — found both
 * by its record and by its indexed column — on the root conversation, whose row id AND record id are
 * the id the receiver reported, placed as the root user entry carrying the notice and answered. A row
 * still queued is reported as queued — never read as placed.
 */
export function submissionVerdict(
	f: SubmissionFacts,
	expect: { submissionId: unknown; requestId: string; notice: string },
): Verdict {
	const reasons: string[] = [];
	if (f.rowsForRequest !== 1) reasons.push(`${f.rowsForRequest} records carry the request id`);
	if (f.rowsForColumn !== 1) reasons.push(`${f.rowsForColumn} rows hold the encoded request id in the indexed column`);
	if (f.row === null || f.record === null) return verdict([...reasons, "no submission row for the request id"]);
	if (f.row.id !== expect.submissionId) reasons.push("the row id is not the reported submission id");
	if (f.record.id === undefined) reasons.push("the record carries no id");
	else if (f.record.id !== f.row.id || f.record.id !== expect.submissionId) {
		reasons.push("the record id is not the row id and the reported submission id");
	}
	if (f.row.conversation_id !== 1 || f.record.conversationId !== 1)
		reasons.push("the row is not on the root conversation");
	if (f.row.request_id !== encodedRequestIdColumn(expect.requestId) || f.record.requestId !== expect.requestId) {
		reasons.push("the row's request id is not the doorbell's");
	}
	if (f.record.type !== "input") reasons.push("the submission is not an input");
	if (f.row.status !== f.record.status) reasons.push("the row status and the record status disagree");
	if (f.record.status === "queued") reasons.push("the submission is still queued, not placed");
	else if (f.record.status !== "done") reasons.push(`the submission is ${String(f.record.status)}, not done`);
	const message = f.entry?.model?.[0];
	if (f.entry === null) reasons.push("the record names no readable entry");
	else {
		if (f.entry.kind !== "pi.user") reasons.push("the placed entry is not pi.user");
		if (message?.role !== "user" || message.content !== expect.notice) {
			reasons.push("the placed entry's content is not the notice the model received");
		}
	}
	return verdict(reasons);
}
