// #171 step 8 — what an ACP session may be sent, read from the Pi session's branch.
//
// A vendor session holds the conversation up to the last answer it gave. Message content cannot
// prove that the branch Pi shows is that conversation: two branches can carry equal text, two
// answers can share one input, and an input whose turn was refused never reached the vendor. So
// every turn's final assistant message carries a turn id (`responseId`), the session's record
// keeps the id of the last turn it sealed (the anchor), and a turn is sent only when that exact
// answer is on the current branch and everything after it is an input or a turn of ours that did
// not complete. `getBranch()` follows parent pointers from the leaf, so the anchor's ancestors are
// the conversation the answer was given to.
//
// Which of those inputs the session may already hold is never read off the branch. The record
// lists, by Pi entry id, exactly the inputs of every dispatch since the anchor whose outcome is
// unknown (`unsealed` and the marker); an input is "dispatched, outcome unknown" when its id is in
// that list and "never sent" otherwise. Where a failed turn sits among the inputs assigns nothing.
//
// Pi may transform the context between its branch and the provider (an extension can drop or
// replace a message), so `contextCarries` holds the branch's inputs against the context the
// provider was actually given and stops on any difference: an input the branch shows and the
// context lacks would otherwise vanish without a word.

import type { AcpStopId } from "./stop-texts.js";

/** `responseId` prefix of an Entwurf ACP turn. */
export const ACP_TURN_ID_PREFIX = "entwurf-turn:";

/** One input after the anchor: a user message, or an extension message Pi projects to one. */
export interface DeltaInput {
	entryId: string;
	/** The content as Pi stores it: a string, or an array of blocks. */
	content: unknown;
	/** An extension message (`custom_message`), such as sibling mail delivered into this Pi. */
	extension: boolean;
}

/** A turn of ours after the anchor that did not complete, as its stored answer shows it. */
export interface FailedTurn {
	turnId: string | undefined;
	stopReason: "error" | "aborted";
	/** The answer carries the local evidence that its dispatch's outcome is unknown. */
	unknownStamped: boolean;
	/** The dispatches this answer told the operator will not be sent again (a skip stop). */
	skipNoticeFor: readonly string[];
}

export type DeltaItem = ({ kind: "input" } & DeltaInput) | ({ kind: "failed" } & FailedTurn);

export type DeltaWalk =
	/** `items`: everything after the anchor, oldest first. `anchor`: the anchor's stored message. */
	| { ok: true; items: DeltaItem[]; inputs: DeltaInput[]; anchor: unknown }
	| { ok: false; stop: Extract<AcpStopId, "changed" | "laterAnswer" | "shellInput" | "compacted">; why: string };

/** Diagnostic types this rail stamps on a failed answer (backend.ts owns the writers). */
export const ACP_PROMPT_UNKNOWN_DIAGNOSTIC = "entwurf_acp_prompt_unknown";
export const ACP_PROMPT_REJECTION_DIAGNOSTIC_TYPE = "entwurf_acp_prompt_rejection";
export const ACP_SKIP_NOTICE_DIAGNOSTIC = "entwurf_acp_skip_notice";

/** Entry types that carry nothing into the model context (pi-coding-agent session-manager `messagesFromEntry`). */
const CONTENTLESS: ReadonlySet<string> = new Set([
	"custom",
	"model_change",
	"thinking_level_change",
	"label",
	"session_info",
	"usage",
]);

function field(value: unknown, key: string): unknown {
	return typeof value === "object" && value !== null ? (value as Record<string, unknown>)[key] : undefined;
}

function readFailedTurn(message: unknown, stopReason: "error" | "aborted"): FailedTurn {
	const turnId = field(message, "responseId");
	const diagnostics = field(message, "diagnostics");
	let unknownStamped = false;
	const skipNoticeFor: string[] = [];
	for (const d of Array.isArray(diagnostics) ? diagnostics : []) {
		const type = field(d, "type");
		const details = field(d, "details");
		if (type === ACP_PROMPT_UNKNOWN_DIAGNOSTIC) unknownStamped = true;
		if (type === ACP_PROMPT_REJECTION_DIAGNOSTIC_TYPE && field(details, "outcomeUnknown") === true) {
			unknownStamped = true;
		}
		if (type === ACP_SKIP_NOTICE_DIAGNOSTIC) {
			const ids = field(details, "turnIds");
			if (Array.isArray(ids)) skipNoticeFor.push(...ids.filter((id): id is string => typeof id === "string"));
		}
	}
	return { turnId: typeof turnId === "string" ? turnId : undefined, stopReason, unknownStamped, skipNoticeFor };
}

/**
 * Walk the branch back from its leaf to the anchor. `anchorTurnId` is the turn the session last
 * sealed; `undefined` (nothing sealed) never passes.
 */
export function walkDelta(anchorTurnId: string | undefined, branch: readonly unknown[]): DeltaWalk {
	const items: DeltaItem[] = [];
	for (let i = branch.length - 1; i >= 0; i--) {
		const entry = branch[i];
		const type = field(entry, "type");
		if (typeof type !== "string") return { ok: false, stop: "changed", why: "an unreadable session entry" };
		if (CONTENTLESS.has(type)) continue;
		const entryId = field(entry, "id");
		// An extension message enters the context as an input, like sibling mail delivered into this Pi.
		// Pi projects it to a user message with the same content (pi-coding-agent messages.js `convertToLlm`).
		if (type === "custom_message") {
			if (typeof entryId !== "string" || entryId === "") {
				return { ok: false, stop: "changed", why: "an input entry without an id" };
			}
			items.unshift({ kind: "input", entryId, content: field(entry, "content"), extension: true });
			continue;
		}
		if (type === "compaction") return { ok: false, stop: "compacted", why: "a compaction after the last answer" };
		if (type !== "message") return { ok: false, stop: "changed", why: `a ${type} entry after the last answer` };
		const message = field(entry, "message");
		const role = field(message, "role");
		if (role === "user") {
			if (typeof entryId !== "string" || entryId === "") {
				return { ok: false, stop: "changed", why: "an input entry without an id" };
			}
			items.unshift({ kind: "input", entryId, content: field(message, "content"), extension: false });
			continue;
		}
		// A system message is Pi's own prompt and tool-surface bookkeeping; it is never forwarded to the ACP
		// child (context.ts `renderMessage`), so it changes nothing the vendor session holds.
		if (role === "system") continue;
		if (role === "bashExecution") return { ok: false, stop: "shellInput", why: "a shell output after the last answer" };
		if (role !== "assistant") {
			return { ok: false, stop: "changed", why: `a ${String(role)} message after the last answer` };
		}
		if (field(message, "provider") !== "entwurf") {
			return { ok: false, stop: "laterAnswer", why: "a later answer is from another provider" };
		}
		// The anchor first: a sealed turn can itself have ended as `aborted` (an answered cancel) or `error`
		// (a refusal), and it is still the answer the session gave last.
		const turnId = field(message, "responseId");
		if (typeof anchorTurnId === "string" && anchorTurnId.length > 0 && turnId === anchorTurnId) {
			return {
				ok: true,
				items,
				inputs: items.flatMap((item) => (item.kind === "input" ? [item] : [])),
				anchor: message,
			};
		}
		const stopReason = field(message, "stopReason");
		if (stopReason === "error" || stopReason === "aborted") {
			items.unshift({ kind: "failed", ...readFailedTurn(message, stopReason) });
			continue;
		}
		return { ok: false, stop: "changed", why: "the last answer is not the one this ACP session gave last" };
	}
	return { ok: false, stop: "changed", why: "no answer of this ACP session on the branch" };
}

/** A dispatch whose outcome is unknown, as the record lists it (session-store `UnsealedDispatch`). */
export interface UnknownDispatch {
	turnId: string;
	inputEntryIds: readonly string[];
}

export type DeltaSelection =
	| {
			ok: true;
			/** The inputs this turn sends, oldest first. */
			send: DeltaInput[];
			/** The inputs a `skip` policy holds back: dispatched before, outcome unknown. */
			held: DeltaInput[];
			/** `skip` only: the dispatches the branch does not show the operator was told about. */
			untold: string[];
	  }
	| { ok: false; stop: "changed"; why: string };

/**
 * Choose what a turn sends. `unknown` is every dispatch since the anchor whose outcome is unknown.
 * `resend` sends every input after the anchor again (an agent that has no memory of an unanswered
 * prompt); `skip` never sends an input of an unknown dispatch a second time.
 *
 * A `skip` dispatch counts as told only by evidence stored with an answer on this branch: the failed
 * answer of that very turn carrying the unknown stamp, or a later answer whose skip notice names
 * the turn. A marker alone is never read as a stop the operator saw.
 */
export function selectDelta(
	walk: Extract<DeltaWalk, { ok: true }>,
	unknown: readonly UnknownDispatch[],
	policy: "skip" | "resend",
): DeltaSelection {
	const onBranch = new Set(walk.inputs.map((input) => input.entryId));
	const dispatched = new Set<string>();
	for (const dispatch of unknown) {
		for (const id of dispatch.inputEntryIds) {
			if (!onBranch.has(id)) {
				return { ok: false, stop: "changed", why: "an input this session was sent is no longer after its last answer" };
			}
			dispatched.add(id);
		}
	}
	if (policy === "resend") return { ok: true, send: [...walk.inputs], held: [], untold: [] };
	const told = new Set<string>();
	for (const item of walk.items) {
		if (item.kind !== "failed") continue;
		if (item.stopReason === "error" && item.unknownStamped && item.turnId !== undefined) told.add(item.turnId);
		for (const id of item.skipNoticeFor) told.add(id);
	}
	return {
		ok: true,
		send: walk.inputs.filter((input) => !dispatched.has(input.entryId)),
		held: walk.inputs.filter((input) => dispatched.has(input.entryId)),
		untold: unknown.filter((dispatch) => !told.has(dispatch.turnId)).map((dispatch) => dispatch.turnId),
	};
}

/**
 * Hold the walk against the context the provider was given, from its end. Every input must be a user
 * message there with the same wire blocks, in order; a failed turn of ours may be there or not (Pi
 * decides what it hands a provider); before them must stand the anchor. The anchor is matched by the
 * turn id it was sealed with and by nothing else: equal content is not the same answer.
 * Returns the context index of each input, in order.
 */
export function contextCarries<Block>(
	walk: Extract<DeltaWalk, { ok: true }>,
	messages: readonly unknown[],
	anchorTurnId: string,
	blocksOf: (content: unknown) => readonly Block[] | undefined,
	equal: (a: unknown, b: unknown) => boolean,
): { ok: true; positions: number[] } | { ok: false; why: string } {
	let at = messages.length - 1;
	const next = (): unknown => {
		while (at >= 0 && field(messages[at], "role") === "system") at--;
		return at >= 0 ? messages[at] : undefined;
	};
	const positions: number[] = [];
	for (let k = walk.items.length - 1; k >= 0; k--) {
		const item = walk.items[k];
		const message = next();
		if (item.kind === "failed") {
			const carried =
				field(message, "role") === "assistant" &&
				(field(message, "stopReason") === "error" || field(message, "stopReason") === "aborted") &&
				(field(message, "responseId") === undefined || field(message, "responseId") === item.turnId);
			if (carried) at--;
			continue;
		}
		if (field(message, "role") !== "user")
			return { ok: false, why: "an input the Pi session shows is not in this turn" };
		const shown = blocksOf(item.content);
		const given = blocksOf(field(message, "content"));
		if (!shown || !given || !equal(shown, given)) {
			return { ok: false, why: "an input differs from the one the Pi session shows" };
		}
		positions.unshift(at);
		at--;
	}
	const anchor = next();
	if (field(anchor, "role") !== "assistant")
		return { ok: false, why: "this turn carries more than the Pi session shows" };
	// Content cannot prove which answer this is: only the turn id it was sealed with does.
	if (field(anchor, "responseId") !== anchorTurnId) {
		return { ok: false, why: "the answer before this turn's inputs is not the one this ACP session gave last" };
	}
	return { ok: true, positions };
}
