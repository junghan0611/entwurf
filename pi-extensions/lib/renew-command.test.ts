/**
 * #151 /renew ④-a: what the human-typed command decides. The subject is `renew-command.ts`; the
 * record and the branch are injected, so each effect is checked as the exact thing the handler
 * would send or show. Nothing here writes a record — and a confirmation that matches all the way is
 * still refused as transition-not-connected until the writer (④-b) exists.
 */
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import type { MetaIdentity } from "./meta-session.ts";
import { createRenewCommand, type RenewCommandIo } from "./renew-command.ts";
import {
	RENEW_ENTRY_CUSTOM_TYPE,
	RENEW_OUTLINE_CUSTOM_TYPE,
	RENEW_REFUSAL_CUSTOM_TYPE,
	type RenewBranchEntry,
} from "./renew-front-gate.ts";

const GID = "20261116T090748-6a8b34";
const NATIVE = "native-n1";
const GUIDE =
	"이 글은 이전 장 에이전트가 작성하고 GLG가 전달 판본을 확인한 기억의 얼개다. GLG의 직접 발언이나 새로운 실행 승인이 아니다.";
const BODY = `${GUIDE}\n출발 장: ${NATIVE}\n[1장] …\n끝 줄`;
const sha = (s: string): string => createHash("sha256").update(s, "utf8").digest("hex");

function record(over: Partial<MetaIdentity> = {}): MetaIdentity {
	return {
		schemaVersion: 3,
		gardenId: GID,
		backend: "pi",
		nativeSessionId: NATIVE,
		cwd: "/tmp/w",
		model: null,
		transcriptPath: null,
		createdAt: "2026-11-16T00:00:00.000Z",
		recordUpdatedAt: "2026-11-17T00:00:00.000Z",
		attachIncarnation: null,
		...over,
	};
}

function command(rec: MetaIdentity | Error = record(), resident: string | null = GID) {
	return createRenewCommand({
		residentGardenId: () => resident,
		readRecord: () => {
			if (rec instanceof Error) throw rec;
			return rec;
		},
		skillExists: () => true,
	});
}

let seq = 0;
const markerEntry = (): RenewBranchEntry => ({
	type: "custom_message",
	id: `e${++seq}`,
	customType: RENEW_ENTRY_CUSTOM_TYPE,
	details: { gardenId: GID, nativeSessionId: NATIVE },
});
const replyEntry = (t: string): RenewBranchEntry => ({
	type: "message",
	id: `e${++seq}`,
	message: { role: "assistant", content: [{ type: "text", text: t }], stopReason: "stop" },
});
const io = (branch: RenewBranchEntry[], isIdle = true): RenewCommandIo => ({ nativeSessionId: NATIVE, branch, isIdle });
const submitted = (body: string) => replyEntry(`정리했다.\n\n\`\`\`renew-outline\n${body}\n\`\`\``);

describe("#151 ④-a /renew: the entry", () => {
	it("[QK:RENEW-CMD-ENTRY-MARKS-CHAPTER] /renew leaves one short entry message whose marker names this garden and native chapter, and carries neither the skill text nor an outline", () => {
		const eff = command().handle("", io([]));
		expect(eff.kind).toBe("entry");
		if (eff.kind !== "entry") return;
		expect(eff.message.customType).toBe(RENEW_ENTRY_CUSTOM_TYPE);
		expect(eff.message.details).toEqual({ gardenId: GID, nativeSessionId: NATIVE });
		expect(eff.message.content).toContain("지금 시작할지 먼저 답해 달라");
		expect(eff.message.content).toContain("아직 갈 때가 아니라고 해도 된다");
		expect(eff.message.content.length).toBeLessThan(400);
	});

	it("[QK:RENEW-CMD-ENTRY-REFUSES-WITHOUT-CHAPTER] no garden id, an unreadable record, a non-pi record, another native chapter or a record mid-/renew opens nothing", () => {
		const renewing = record({
			renewing: {
				from: NATIVE,
				to: null,
				token: "c".repeat(32),
				outlineSha: sha(BODY),
				outline: BODY,
				owner: { pid: 1, startKey: "k" },
				startedAt: "2026-11-17T00:00:00.000Z",
			},
		});
		const cases: [ReturnType<typeof command>, string][] = [
			[command(record(), null), "not-a-citizen"],
			[command(new Error("store defect")), "record-unreadable"],
			[command(record({ backend: "claude-code" })), "not-pi"],
			[command(record({ nativeSessionId: "native-n0" })), "chapter-mismatch"],
			[command(renewing), "renew-in-progress"],
		];
		for (const [cmd, reason] of cases) {
			expect(cmd.handle("", io([])), reason).toMatchObject({ kind: "refused", reason, note: null });
		}
		expect(command().handle("go now", io([]))).toMatchObject({ kind: "refused", reason: "usage" });
		const noSkill = createRenewCommand({
			residentGardenId: () => GID,
			readRecord: () => record(),
			skillExists: () => false,
		});
		expect(noSkill.handle("", io([]))).toMatchObject({ kind: "refused", reason: "skill-unavailable", note: null });
	});
});

describe("#151 ④-a /renew confirm: show, bind, confirm", () => {
	it("[QK:RENEW-CMD-SHOW-THEN-CONFIRM] show binds the candidate and names its sha8; confirming those eight characters reaches the end and is still refused as transition-not-connected", () => {
		const cmd = command();
		const branch = [markerEntry(), submitted(BODY)];
		const shown = cmd.handle("confirm", io(branch));
		expect(shown.kind).toBe("show");
		const sha8 = sha(BODY).slice(0, 8);
		if (shown.kind === "show") expect(shown.notice).toContain(`/renew confirm ${sha8}`);
		expect(cmd.handle(`confirm ${sha8}`, io(branch))).toMatchObject({
			kind: "refused",
			reason: "transition-not-connected",
		});
	});

	it("[QK:RENEW-CMD-CONFIRM-NEEDS-FRESH-SHOW] a confirm without a show, after a reset, after any refusal (a mistyped /renew too), or a second time after one confirm is refused as no-binding", () => {
		const branch = [markerEntry(), submitted(BODY)];
		const sha8 = sha(BODY).slice(0, 8);
		expect(command().handle(`confirm ${sha8}`, io(branch))).toMatchObject({ reason: "no-binding" });
		const cmd = command();
		cmd.handle("confirm", io(branch));
		cmd.reset();
		expect(cmd.handle(`confirm ${sha8}`, io(branch))).toMatchObject({ reason: "no-binding" });
		cmd.handle("confirm", io(branch));
		cmd.handle(`confirm ${sha8}`, io(branch));
		expect(cmd.handle(`confirm ${sha8}`, io(branch))).toMatchObject({ reason: "no-binding" });
	});

	it("[QK:RENEW-CMD-USAGE-DROPS-BINDING] a mistyped /renew between show and confirm drops the binding like any other refusal", () => {
		const branch = [markerEntry(), submitted(BODY)];
		const sha8 = sha(BODY).slice(0, 8);
		const cmd = command();
		cmd.handle("confirm", io(branch));
		expect(cmd.handle("confrim now", io(branch))).toMatchObject({ reason: "usage" });
		expect(cmd.handle(`confirm ${sha8}`, io(branch))).toMatchObject({ reason: "no-binding" });
	});

	it("[QK:RENEW-CMD-REFUSAL-LEAVES-NOTE] a failed check inside the interview leaves the agent a note naming the reason", () => {
		const cmd = command();
		const tooLong = `${GUIDE}\n${"가".repeat(11_000)}`;
		const eff = cmd.handle("confirm", io([markerEntry(), submitted(tooLong)]));
		expect(eff).toMatchObject({ kind: "refused", reason: "too-large" });
		if (eff.kind === "refused") {
			expect(eff.note?.customType).toBe(RENEW_REFUSAL_CUSTOM_TYPE);
			expect(eff.note?.details).toMatchObject({ gardenId: GID, nativeSessionId: NATIVE, reason: "too-large" });
			expect(eff.note?.content).toContain("지금 장은 그대로 열려 있다");
		}
	});

	it("[QK:RENEW-CMD-NOTE-ONLY-IN-INTERVIEW] inside this chapter's interview a busy session or a mistyped command also leaves a note; outside one (no entry marker) neither does, and a busy session is refused before the candidate is read", () => {
		const cmd = command();
		const busy = cmd.handle("confirm", io([markerEntry(), submitted(BODY)], false));
		expect(busy).toMatchObject({ kind: "refused", reason: "not-idle" });
		if (busy.kind === "refused") expect(busy.note?.details).toMatchObject({ reason: "not-idle" });
		const typo = cmd.handle("confirm a b", io([markerEntry()]));
		expect(typo).toMatchObject({ kind: "refused", reason: "usage" });
		if (typo.kind === "refused") expect(typo.note?.customType).toBe(RENEW_REFUSAL_CUSTOM_TYPE);
		expect(cmd.handle("confirm", io([submitted(BODY)], false))).toMatchObject({ reason: "not-idle", note: null });
		expect(cmd.handle("confirm a b", io([]))).toMatchObject({ reason: "usage", note: null });
		// Idle, outside an interview: a show finds no entry marker, a confirm finds no binding — no note either.
		expect(cmd.handle("confirm", io([]))).toMatchObject({ reason: "no-entry-marker", note: null });
		expect(cmd.handle("confirm deadbeef", io([]))).toMatchObject({ reason: "no-binding", note: null });
	});

	it("[QK:RENEW-CMD-RESHOW-AFTER-NEW-REPLY] after the agent answers again, the old show no longer confirms — even when the new reply re-emits the same bytes", () => {
		const cmd = command();
		const m = markerEntry();
		const first = submitted(BODY);
		cmd.handle("confirm", io([m, first]));
		const sha8 = sha(BODY).slice(0, 8);
		const again = submitted(BODY);
		expect(cmd.handle(`confirm ${sha8}`, io([m, first, again]))).toMatchObject({ reason: "candidate-changed" });
	});
});

describe("#151 ④-a /renew outline: the agent's own current outline, looked up", () => {
	const EDITION = `${GUIDE}\n[1장] 함께 지나온 시간 …\n"원문 그대로 남긴 말"`;
	const lived = () =>
		record({
			chapters: [
				{
					nativeSessionId: "native-n0",
					transcriptPath: "/tmp/w/n0.jsonl",
					model: null,
					startedAt: null,
					endedAt: null,
				},
			],
			outline: { body: EDITION, sha: sha(EDITION), forNativeSessionId: NATIVE, writtenAt: "2026-11-10T00:00:00.000Z" },
		});

	it("[QK:RENEW-CMD-OUTLINE-SELF-ONLY] /renew outline reads only this garden's record and hands back its body verbatim under the outline type, saying it is a lookup, not new words or any step of the renew", () => {
		const read: string[] = [];
		const cmd = createRenewCommand({
			residentGardenId: () => GID,
			readRecord: (gid) => {
				read.push(gid);
				return lived();
			},
			skillExists: () => true,
		});
		const eff = cmd.handle("outline", io([]));
		expect(read).toEqual([GID]);
		expect(eff.kind).toBe("outline");
		if (eff.kind !== "outline") return;
		expect(eff.message.customType).toBe(RENEW_OUTLINE_CUSTOM_TYPE);
		expect(eff.message.content.endsWith(`\n\n${EDITION}`)).toBe(true);
		expect(eff.message.content).toContain("인터뷰 시작·전환 동의·최종 판본 제출이나 확인도 아니다");
		// The notice claims the hand-off to Pi only — never that the message was recorded or read.
		expect(eff.notice).toContain("Pi에 전달하도록 요청했다");
		expect(eff.notice).toContain("새 턴 없음");
		expect(eff.notice).not.toMatch(/남겼다|기록했다|읽었다/);
		expect(eff.message.details).toMatchObject({
			gardenId: GID,
			nativeSessionId: NATIVE,
			outline: { sha: sha(EDITION), bytes: Buffer.byteLength(EDITION) },
		});
	});

	it("[QK:RENEW-CMD-OUTLINE-FIRST-ONLY-WHEN-CLEAN] only a readable own record with no outline reads as a first renew; an unreadable, foreign or mid-renew record is refused by name", () => {
		const first = command().handle("outline", io([]));
		expect(first).toMatchObject({ kind: "outline" });
		if (first.kind === "outline") {
			expect(first.message.details).toMatchObject({ outline: null });
			expect(first.message.content).toContain("첫 renew");
			expect(first.notice).toContain("Pi에 전달하도록 요청했다");
			expect(first.notice).not.toMatch(/남겼다|기록했다|읽었다/);
		}
		expect(command(new Error("duplicate nativeSessionId")).handle("outline", io([]))).toMatchObject({
			kind: "refused",
			reason: "record-unreadable",
		});
		expect(command(record(), null).handle("outline", io([]))).toMatchObject({ reason: "not-a-citizen" });
		expect(command(record({ nativeSessionId: "native-n0" })).handle("outline", io([]))).toMatchObject({
			reason: "chapter-mismatch",
		});
	});

	it("[QK:RENEW-CMD-OUTLINE-KEEPS-BINDING] a lookup between show and confirm neither refuses nor drops the binding", () => {
		const cmd = command();
		const branch = [markerEntry(), submitted(BODY)];
		cmd.handle("confirm", io(branch));
		expect(cmd.handle("outline", io(branch)).kind).toBe("outline");
		expect(cmd.handle(`confirm ${sha(BODY).slice(0, 8)}`, io(branch))).toMatchObject({
			reason: "transition-not-connected",
		});
	});
});
