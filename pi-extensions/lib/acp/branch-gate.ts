// #171 step 8 — what a live ACP session may be sent, read from the Pi session's branch.
//
// A live vendor session holds the conversation up to the last answer it gave. Message content
// cannot prove that the branch Pi shows is that conversation: two branches can carry equal text,
// two answers can share one input, and an input whose turn was refused never reached the vendor.
// So every turn's final assistant message carries a turn id (`responseId`), the live session
// keeps the id of the last turn it sealed, and a reuse turn is allowed only when the LAST
// assistant entry on the current branch is that exact answer and everything after it is an
// input. `getBranch()` follows parent pointers from the leaf, so that entry's ancestors are the
// conversation the answer was given to.
//
// The gate also returns those inputs. Pi may transform the context between its branch and the
// provider (an extension can drop or replace a message), so the caller holds them against the
// delta the context actually carries and stops on any difference: an input the branch shows and
// the context lacks would otherwise vanish without a word.
//
// Anything else stops, with the live session kept. Continuing past a refused turn needs the
// unsent inputs mapped to the context, which is the resume delta's work, not this gate's.

import type { AcpStopId } from "./stop-texts.js";

/** `responseId` prefix of an Entwurf ACP turn. */
export const ACP_TURN_ID_PREFIX = "entwurf-turn:";

export type ReuseBranchVerdict =
	/** `inputs`: the content of each input after the pinned answer, oldest first, as Pi projects it to a user message. */
	| { ok: true; inputs: unknown[] }
	| { ok: false; stop: Extract<AcpStopId, "changed" | "laterAnswer" | "shellInput">; why: string };

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

/**
 * Decide a reuse turn from the branch at its start. `sealedTurnId` is the turn the live session
 * last sealed; `undefined` (nothing sealed) never passes.
 */
export function reuseBranchVerdict(sealedTurnId: string | undefined, branch: readonly unknown[]): ReuseBranchVerdict {
	const inputs: unknown[] = [];
	for (let i = branch.length - 1; i >= 0; i--) {
		const entry = branch[i];
		const type = field(entry, "type");
		if (typeof type !== "string") return { ok: false, stop: "changed", why: "an unreadable session entry" };
		if (CONTENTLESS.has(type)) continue;
		// An extension message enters the context as an input, like sibling mail delivered into this Pi.
		// Pi projects it to a user message with the same content (pi-coding-agent messages.js `convertToLlm`).
		if (type === "custom_message") {
			inputs.unshift(field(entry, "content"));
			continue;
		}
		if (type !== "message") return { ok: false, stop: "changed", why: `a ${type} entry after the last answer` };
		const message = field(entry, "message");
		const role = field(message, "role");
		if (role === "user") {
			inputs.unshift(field(message, "content"));
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
			return { ok: false, stop: "laterAnswer", why: "the last answer is from another provider" };
		}
		const turnId = field(message, "responseId");
		if (typeof sealedTurnId === "string" && sealedTurnId.length > 0 && turnId === sealedTurnId)
			return { ok: true, inputs };
		return { ok: false, stop: "changed", why: "the last answer is not the one this ACP session gave last" };
	}
	return { ok: false, stop: "changed", why: "no answer of this ACP session on the branch" };
}
