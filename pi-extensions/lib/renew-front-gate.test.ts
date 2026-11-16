/**
 * #151 /renew front gate (C1.3 + C1.3a + C1.3b): which submission is the candidate, what bytes it
 * carries, which mechanical checks refuse it, and whether a confirmation names exactly what was
 * shown in this chapter. The subject is `renew-front-gate.ts`; the oracle is hand-built branch
 * entries in Pi's session-entry shape and sha256 straight from node:crypto.
 */
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import {
	bindRenewShow,
	checkRenewBody,
	findRenewCandidate,
	matchRenewConfirm,
	RENEW_ENTRY_CUSTOM_TYPE,
	RENEW_GUIDE_SENTENCE,
	type RenewBranchEntry,
} from "./renew-front-gate.ts";

const CH = { gardenId: "20261116T090748-6a8b34", nativeSessionId: "native-n1" };
/**
 * The agreed guide sentence, held HERE as an independent literal (contract C1.2 §3, GLG and SOL,
 * 2026-11-16) — never imported from the product, so a product edit to the sentence cannot carry the
 * fixtures along with it.
 */
const AGREED_GUIDE =
	"이 글은 이전 장 에이전트가 작성하고 GLG가 전달 판본을 확인한 기억의 얼개다. GLG의 직접 발언이나 새로운 실행 승인이 아니다.";
const sha = (s: string): string => createHash("sha256").update(s, "utf8").digest("hex");
const BODY = `${AGREED_GUIDE}\n출발 장: native-n1\n\n[1장] 함께 지나온 시간 …  \n\n"원문 그대로 남긴 말" — GLG`;

let seq = 0;
function marker(details: unknown = CH): RenewBranchEntry {
	return { type: "custom_message", id: `e${++seq}`, customType: RENEW_ENTRY_CUSTOM_TYPE, details };
}
function reply(content: unknown[], stopReason = "stop"): RenewBranchEntry {
	return { type: "message", id: `e${++seq}`, message: { role: "assistant", content, stopReason } };
}
const text = (t: string, textSignature?: string) => ({
	type: "text",
	text: t,
	...(textSignature ? { textSignature } : {}),
});
const submission = (body: string, fence = "```", before = "정리한 판입니다.\n\n") =>
	`${before}${fence}renew-outline\n${body}\n${fence}`;
const user = (): RenewBranchEntry => ({ type: "message", id: `e${++seq}`, message: { role: "user", content: "응" } });

describe("#151 front gate: which submission is the candidate", () => {
	it("[QK:RENEW-GATE-LAST-REPLY-ONLY] only the last reply after the entry marker is read; a later reply without a submission leaves no candidate, never the older one", () => {
		const m = marker();
		const a = reply([text(submission(BODY))]);
		expect(findRenewCandidate([m, a], CH)).toMatchObject({ kind: "candidate", sha: sha(BODY), candidateId: a.id });
		const b = reply([text("아직 넘어가지 않겠다.")]);
		expect(findRenewCandidate([m, a, user(), b], CH)).toEqual({ kind: "none", reason: "no-submission" });
		const c = reply([text(submission(`${BODY}\n고친 줄`))]);
		expect(findRenewCandidate([m, a, user(), b, user(), c], CH)).toMatchObject({
			kind: "candidate",
			candidateId: c.id,
		});
	});

	it("[QK:RENEW-GATE-ENTRY-BOUND-TO-CHAPTER] a submission before the marker, or a marker made in another chapter (copied by a fork), is no entry", () => {
		const early = reply([text(submission(BODY))]);
		expect(findRenewCandidate([early, marker()], CH)).toEqual({ kind: "none", reason: "no-reply-after-entry" });
		const forked = marker({ gardenId: CH.gardenId, nativeSessionId: "native-n0" });
		expect(findRenewCandidate([forked, reply([text(submission(BODY))])], CH)).toEqual({
			kind: "none",
			reason: "no-entry-marker",
		});
		const mimic: RenewBranchEntry = { type: "custom_message", id: "x", customType: "peer-message", details: CH };
		expect(findRenewCandidate([mimic, reply([text(submission(BODY))])], CH)).toEqual({
			kind: "none",
			reason: "no-entry-marker",
		});
	});

	it("[QK:RENEW-GATE-COMPLETE-ONLY] a submission in an aborted, failed, cut or tool-continuing reply is not a candidate", () => {
		for (const stop of ["aborted", "error", "length", "toolUse", "pending"]) {
			expect(findRenewCandidate([marker(), reply([text(submission(BODY))], stop)], CH)).toEqual({
				kind: "none",
				reason: "reply-not-complete",
			});
		}
	});

	it("[QK:RENEW-GATE-NOTICE-BY-EXACT-SIGNATURE] only Entwurf's lifecycle notice is skipped: a provider-signed submission counts, a trailing lifecycle notice is ignored, an unsigned tool notice after it leaves no candidate", () => {
		const signed = reply([text(submission(BODY), "provider:msg_abc:final")]);
		expect(findRenewCandidate([marker(), signed], CH)).toMatchObject({ kind: "candidate", sha: sha(BODY) });
		const withNotice = reply([
			text(submission(BODY)),
			text("\n[acp: cost baseline reset]\n", "entwurf:lifecycle-notice-v1"),
		]);
		expect(findRenewCandidate([marker(), withNotice], CH)).toMatchObject({ kind: "candidate", sha: sha(BODY) });
		const thenTool = reply([text(submission(BODY)), text("\n[tool:start] Terminal\n")]);
		expect(findRenewCandidate([marker(), thenTool], CH)).toEqual({ kind: "none", reason: "submission-not-last" });
	});
});

describe("#151 front gate: the submission grammar and its exact bytes", () => {
	it("[QK:RENEW-GATE-BODY-BYTES-EXACT] the body is the lines between the fences joined by newline, no trailing newline, nothing trimmed; a longer outer fence carries code inside", () => {
		const got = findRenewCandidate([marker(), reply([text(`${submission(BODY)}\n\n  `)])], CH);
		expect(got).toMatchObject({ kind: "candidate", body: BODY, sha: sha(BODY), bytes: Buffer.byteLength(BODY) });
		const withCode = `${BODY}\n\`\`\`ts\nconst x = 1;\n\`\`\``;
		expect(findRenewCandidate([marker(), reply([text(submission(withCode, "````"))])], CH)).toMatchObject({
			kind: "candidate",
			body: withCode,
		});
	});

	it("[QK:RENEW-GATE-GRAMMAR-FAILS-CLOSED] unclosed, wrong closing length, text after, CR, a second opener, a non-canonical opener or an empty body is no candidate", () => {
		const cases: [string, string][] = [
			[`\`\`\`renew-outline\n${BODY}`, "unclosed-submission"],
			[`\`\`\`renew-outline\n${BODY}\n\`\`\`\``, "closing-fence-mismatch"],
			[`${submission(BODY)}\n이상입니다.`, "submission-not-last"],
			[submission(BODY.replace("\n", "\r\n")), "carriage-return"],
			[submission(`${BODY}\n\`\`\`renew-outline`, "````"), "several-submissions"],
			[`  \`\`\`renew-outline\n${BODY}\n\`\`\``, "opening-fence-not-canonical"],
			[`\`\`\`renew-outline \n${BODY}\n\`\`\``, "opening-fence-not-canonical"],
			["```renew-outline\n```", "empty-body"],
		];
		for (const [t, reason] of cases) {
			expect(findRenewCandidate([marker(), reply([text(t)])], CH), reason).toEqual({ kind: "none", reason });
		}
	});
});

describe("#151 front gate: a line a Markdown view could close the fence on ends it", () => {
	it("[QK:RENEW-GATE-FIRST-CLOSE-LIKE-LINE] a close-like line with spaces or a tab around it, met before the canonical one, ends the submission and is refused — the bytes after it are never read as the body", () => {
		for (const closeLike of ["``` ", "  ```", "\t```", "```\t", "````"]) {
			const t = `\`\`\`renew-outline\n${BODY}\n${closeLike}\n뒤에 이어진 본문\n\`\`\``;
			expect(findRenewCandidate([marker(), reply([text(t)])], CH), JSON.stringify(closeLike)).toEqual({
				kind: "none",
				reason: "closing-fence-mismatch",
			});
		}
		const inner = `${BODY}\n  \`\`\`\n안쪽`;
		expect(findRenewCandidate([marker(), reply([text(submission(inner, "````"))])], CH)).toMatchObject({
			kind: "candidate",
			body: inner,
		});
	});
});

describe("#151 front gate: mechanical body checks", () => {
	it("[QK:RENEW-GATE-GUIDE-LITERAL-AGREED] the product's guide sentence is byte-for-byte the agreed literal", () => {
		expect(Buffer.from(RENEW_GUIDE_SENTENCE, "utf8")).toEqual(Buffer.from(AGREED_GUIDE, "utf8"));
	});

	it("[QK:RENEW-GATE-SIZE-BOUNDARY] 32768 UTF-8 bytes pass and 32769 are refused, never cut", () => {
		const pad = (n: number) => `${AGREED_GUIDE}${"가".repeat(Math.floor(n / 3))}${"a".repeat(n % 3)}`;
		const guideBytes = Buffer.byteLength(AGREED_GUIDE);
		const at = pad(32_768 - guideBytes);
		expect(Buffer.byteLength(at)).toBe(32_768);
		expect(checkRenewBody(at)).toEqual({ ok: true });
		const over = `${at}a`;
		expect(checkRenewBody(over)).toMatchObject({ ok: false, reason: "too-large" });
	});

	it("[QK:RENEW-GATE-GUIDE-AND-TAG] a body that does not open with the guide sentence, or carries the project-context tag, is refused", () => {
		expect(checkRenewBody(`앞말\n${BODY}`)).toMatchObject({ ok: false, reason: "guide-missing" });
		expect(checkRenewBody(`${BODY}\n<project-context path="/x/AGENTS.md">`)).toMatchObject({
			ok: false,
			reason: "project-context-tag",
		});
		expect(checkRenewBody(BODY)).toEqual({ ok: true });
	});
});

describe("#151 front gate: a confirmation names exactly what was shown, in this chapter", () => {
	it("[QK:RENEW-GATE-CONFIRM-BINDING] no show, another chapter, another candidate entry (same bytes), another body sharing the 8-char prefix, or a wrong prefix is refused", () => {
		const m = marker();
		const a = reply([text(submission(BODY))]);
		const shown = findRenewCandidate([m, a], CH);
		if (shown.kind !== "candidate") throw new Error("fixture");
		const binding = bindRenewShow(CH, shown);
		const sha8 = shown.sha.slice(0, 8);
		expect(matchRenewConfirm(binding, CH, shown, sha8)).toEqual({ ok: true });
		expect(matchRenewConfirm(null, CH, shown, sha8)).toEqual({ ok: false, reason: "no-binding" });
		expect(matchRenewConfirm(binding, { ...CH, nativeSessionId: "native-n9" }, shown, sha8)).toEqual({
			ok: false,
			reason: "chapter-changed",
		});
		expect(matchRenewConfirm(binding, { ...CH, gardenId: "20261003T164401-a30dda" }, shown, sha8)).toEqual({
			ok: false,
			reason: "chapter-changed",
		});
		// Same bytes and the same candidate entry under a different entry marker (a second /renew).
		expect(matchRenewConfirm(binding, CH, { ...shown, entryId: "e-later-marker" }, sha8)).toEqual({
			ok: false,
			reason: "candidate-changed",
		});
		const reemitted = findRenewCandidate([m, a, user(), reply([text(submission(BODY))])], CH);
		expect(matchRenewConfirm(binding, CH, reemitted, sha8)).toEqual({ ok: false, reason: "candidate-changed" });
		const sameBytesOtherSha = { ...shown, sha: `${sha8}${"0".repeat(56)}` };
		expect(matchRenewConfirm(binding, CH, sameBytesOtherSha, sha8)).toEqual({ ok: false, reason: "candidate-changed" });
		expect(matchRenewConfirm(binding, CH, shown, "00000000")).toEqual({ ok: false, reason: "sha-prefix-mismatch" });
		expect(matchRenewConfirm(binding, CH, shown, shown.sha)).toEqual({ ok: false, reason: "sha-prefix-mismatch" });
		const gone = findRenewCandidate([m, a, user(), reply([text("잠깐만요")])], CH);
		expect(matchRenewConfirm(binding, CH, gone, sha8)).toEqual({ ok: false, reason: "no-submission" });
	});
});
