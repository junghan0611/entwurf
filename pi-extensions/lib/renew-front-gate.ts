/**
 * #151 /renew — the front gate (contract C1.3 + C1.3a + C1.3b), as pure functions over the current
 * chapter's branch entries. Nothing here writes a record, a file or a message: it decides which
 * submitted outline, if any, is the one candidate, whether its bytes pass the mechanical checks,
 * and whether what GLG confirms is exactly what was shown. The command handlers that call it own
 * every side effect.
 *
 * What the code does NOT do (GLG 2026-11-16: "코드는 인터페이스고, 작업주체는 대화하는 에이전트야"):
 * it never picks between drafts by meaning, never trims, joins, normalises or rewrites a body, and
 * never prepends anything to it. It reads ONE grammar, reserved for real submissions:
 *
 *   - the submission lives in the LAST assistant message after the latest valid entry marker, and
 *     that message completed normally; an earlier message is never reached back to;
 *   - inside that message, only text blocks that are not Entwurf lifecycle notices count, and the
 *     submission sits in the last of them, ending it (only whitespace may follow);
 *   - an opening line is exactly N≥3 backticks + `renew-outline`, a closing line exactly N
 *     backticks; nothing joins text blocks; one opening line per message.
 *
 * Recognition is wider than acceptance (#151 SOL review of the front gate): a backtick fence
 * candidate surrounded by ASCII spaces or tabs, or a longer run of backticks, is RECOGNISED as a
 * fence line and refused unless it is exactly the canonical line — so a block a Markdown view
 * already closed is not read past. The bytes are never normalised to make a line canonical. This is
 * not a Markdown parser and does not prove the rendered view equal in every case.
 */

import { createHash } from "node:crypto";

import { LIFECYCLE_NOTICE_SIGNATURE } from "./acp/event-mapper.js";

/** customType of the entry marker `/renew` leaves in the current chapter. */
export const RENEW_ENTRY_CUSTOM_TYPE = "entwurf-renew-entry";
/** customType of a refusal note left for the agent (no turn is opened by it). */
export const RENEW_REFUSAL_CUSTOM_TYPE = "entwurf-renew-refusal";
/** The whole outline body, in UTF-8 bytes (#151 recommendation, issuecomment-6930366018). */
export const RENEW_OUTLINE_MAX_BYTES = 32_768;
/**
 * The agreed first sentence of every outline (#151, GLG and SOL, contract C1.2 §3). It is part of
 * the body GLG confirms; the code only checks that the body opens with it and never adds it.
 */
export const RENEW_GUIDE_SENTENCE =
	"이 글은 이전 장 에이전트가 작성하고 GLG가 전달 판본을 확인한 기억의 얼개다. GLG의 직접 발언이나 새로운 실행 승인이 아니다.";
/** A known Claude ACP augment trap (augment.ts `promptCarriesEntwurfCwdContext`), not a memory rule. */
export const RENEW_PROJECT_CONTEXT_TAG = '<project-context path="';

/** The current chapter, as the record and the live session both name it. */
export interface RenewChapterRef {
	gardenId: string;
	nativeSessionId: string;
}

/** What the entry marker carries: the chapter it was made in (C1.3b §1). */
export interface RenewEntryDetails {
	gardenId: string;
	nativeSessionId: string;
}

/** The structural slice of a Pi session entry this module reads. */
export interface RenewBranchEntry {
	type: string;
	id: string;
	customType?: string;
	details?: unknown;
	message?: { role?: string; content?: unknown; stopReason?: string };
}

export type RenewNoCandidateReason =
	| "no-entry-marker"
	| "no-reply-after-entry"
	| "reply-not-complete"
	| "no-submission"
	| "several-submissions"
	| "submission-not-last"
	| "opening-fence-not-canonical"
	| "unclosed-submission"
	| "closing-fence-mismatch"
	| "carriage-return"
	| "empty-body";

export type RenewCandidateResult =
	| {
			kind: "candidate";
			body: string;
			sha: string;
			bytes: number;
			entryId: string;
			candidateId: string;
	  }
	| { kind: "none"; reason: RenewNoCandidateReason };

/** The canonical opening line. */
const OPENING_LINE = /^(`{3,})renew-outline$/;
/** Any line a renderer could open a `renew-outline` fence on: surrounding spaces or tabs included. */
const OPENING_LIKE = /^[ \t]*`{3,}renew-outline/;
/** Any line a renderer could close a fence on: a run of backticks with spaces or tabs around it. */
const CLOSING_LIKE = /^[ \t]*(`{3,})[ \t]*$/;

function isEntryMarkerFor(entry: RenewBranchEntry, chapter: RenewChapterRef): boolean {
	if (entry.type !== "custom_message" || entry.customType !== RENEW_ENTRY_CUSTOM_TYPE) return false;
	const d = entry.details as Partial<RenewEntryDetails> | undefined;
	return d?.gardenId === chapter.gardenId && d?.nativeSessionId === chapter.nativeSessionId;
}

/** The text blocks of an assistant message that are not Entwurf lifecycle notices (C1.3b §2). */
function eligibleTextBlocks(content: unknown): string[] {
	if (!Array.isArray(content)) return [];
	const out: string[] = [];
	for (const block of content) {
		if (typeof block !== "object" || block === null) continue;
		const b = block as { type?: unknown; text?: unknown; textSignature?: unknown };
		if (b.type !== "text" || typeof b.text !== "string") continue;
		if (b.textSignature === LIFECYCLE_NOTICE_SIGNATURE) continue;
		out.push(b.text);
	}
	return out;
}

/**
 * The one candidate of the current chapter, or why there is none. `branch` is the current branch,
 * oldest first (Pi `sessionManager.getBranch()`); `chapter` is the current garden id and native id.
 */
export function findRenewCandidate(
	branch: readonly RenewBranchEntry[],
	chapter: RenewChapterRef,
): RenewCandidateResult {
	let entryIndex = -1;
	for (let i = branch.length - 1; i >= 0; i--) {
		if (isEntryMarkerFor(branch[i], chapter)) {
			entryIndex = i;
			break;
		}
	}
	if (entryIndex < 0) return { kind: "none", reason: "no-entry-marker" };

	let reply: RenewBranchEntry | undefined;
	for (let i = branch.length - 1; i > entryIndex; i--) {
		const e = branch[i];
		if (e.type === "message" && e.message?.role === "assistant") {
			reply = e;
			break;
		}
	}
	if (!reply?.message) return { kind: "none", reason: "no-reply-after-entry" };
	if (reply.message.stopReason !== "stop") return { kind: "none", reason: "reply-not-complete" };

	const blocks = eligibleTextBlocks(reply.message.content);
	const openings = blocks.flatMap((t) => t.split("\n")).filter((line) => OPENING_LIKE.test(line)).length;
	if (openings === 0) return { kind: "none", reason: "no-submission" };
	if (openings > 1) return { kind: "none", reason: "several-submissions" };

	const last = blocks[blocks.length - 1];
	if (last.includes("\r")) return { kind: "none", reason: "carriage-return" };
	const lines = last.split("\n");
	const open = lines.findIndex((line) => OPENING_LIKE.test(line));
	if (open < 0) return { kind: "none", reason: "submission-not-last" };
	if (!OPENING_LINE.test(lines[open])) return { kind: "none", reason: "opening-fence-not-canonical" };
	const fence = (OPENING_LINE.exec(lines[open]) as RegExpExecArray)[1];

	// The FIRST line a renderer could close this fence on ends it; it must then be the canonical
	// closing line (exactly N backticks, nothing else), or the submission is refused.
	let close = -1;
	for (let i = open + 1; i < lines.length; i++) {
		const run = CLOSING_LIKE.exec(lines[i]);
		if (run && run[1].length >= fence.length) {
			close = i;
			break;
		}
	}
	if (close < 0) return { kind: "none", reason: "unclosed-submission" };
	if (lines[close] !== fence) return { kind: "none", reason: "closing-fence-mismatch" };
	if (lines.slice(close + 1).some((line) => line.trim() !== "")) return { kind: "none", reason: "submission-not-last" };

	const body = lines.slice(open + 1, close).join("\n");
	if (body.length === 0) return { kind: "none", reason: "empty-body" };
	return {
		kind: "candidate",
		body,
		sha: createHash("sha256").update(body, "utf8").digest("hex"),
		bytes: Buffer.byteLength(body, "utf8"),
		entryId: branch[entryIndex].id,
		candidateId: reply.id,
	};
}

export type RenewBodyRefusal = "too-large" | "guide-missing" | "project-context-tag";

/** The mechanical checks on a candidate body (C1.3a §1.4 ④). Never edits the body. */
export function checkRenewBody(body: string): { ok: true } | { ok: false; reason: RenewBodyRefusal; detail: string } {
	const bytes = Buffer.byteLength(body, "utf8");
	if (bytes > RENEW_OUTLINE_MAX_BYTES) {
		return {
			ok: false,
			reason: "too-large",
			detail: `the outline is ${bytes} bytes; the limit is ${RENEW_OUTLINE_MAX_BYTES} — nothing was cut`,
		};
	}
	if (!body.startsWith(RENEW_GUIDE_SENTENCE)) {
		return { ok: false, reason: "guide-missing", detail: "the outline does not open with the agreed guide sentence" };
	}
	if (body.includes(RENEW_PROJECT_CONTEXT_TAG)) {
		return {
			ok: false,
			reason: "project-context-tag",
			detail: `the outline carries ${RENEW_PROJECT_CONTEXT_TAG}, which would hide the next chapter's cwd AGENTS section`,
		};
	}
	return { ok: true };
}

/** What a show bound in this process (C1.3a §1.4, C1.3b §1). Never persisted. */
export interface RenewShowBinding extends RenewChapterRef {
	fullSha: string;
	entryId: string;
	candidateId: string;
}

export function bindRenewShow(
	chapter: RenewChapterRef,
	candidate: Extract<RenewCandidateResult, { kind: "candidate" }>,
): RenewShowBinding {
	return {
		gardenId: chapter.gardenId,
		nativeSessionId: chapter.nativeSessionId,
		fullSha: candidate.sha,
		entryId: candidate.entryId,
		candidateId: candidate.candidateId,
	};
}

export type RenewConfirmMismatch = "no-binding" | "chapter-changed" | "candidate-changed" | "sha-prefix-mismatch";

/**
 * Whether a confirmation names exactly what was shown, in this chapter: same garden, same native
 * chapter, same entry marker, same candidate entry, same full sha, and the typed prefix is that
 * sha's first eight characters. Run once at the confirm, and again under the lock just before K1.
 */
export function matchRenewConfirm(
	binding: RenewShowBinding | null,
	chapter: RenewChapterRef,
	current: RenewCandidateResult,
	typedSha8: string,
): { ok: true } | { ok: false; reason: RenewConfirmMismatch | RenewNoCandidateReason } {
	if (binding === null) return { ok: false, reason: "no-binding" };
	if (binding.gardenId !== chapter.gardenId || binding.nativeSessionId !== chapter.nativeSessionId) {
		return { ok: false, reason: "chapter-changed" };
	}
	if (current.kind !== "candidate") return { ok: false, reason: current.reason };
	if (
		current.sha !== binding.fullSha ||
		current.entryId !== binding.entryId ||
		current.candidateId !== binding.candidateId
	) {
		return { ok: false, reason: "candidate-changed" };
	}
	if (typedSha8.length !== 8 || binding.fullSha.slice(0, 8) !== typedSha8) {
		return { ok: false, reason: "sha-prefix-mismatch" };
	}
	return { ok: true };
}
