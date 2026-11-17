/**
 * #151 /renew — what the human-typed command decides (④-a). The handler in `entwurf-control.ts`
 * owns every side effect (sending the custom messages, the notices, the reset on session_shutdown);
 * this module only reads the current record and branch and returns ONE effect to perform.
 *
 *   /renew                 → the light entry: one short message and an entry marker for THIS chapter
 *   /renew confirm         → show the current candidate (sha8, bytes, first/last line) and bind it
 *   /renew confirm <sha8>  → confirm exactly what was shown
 *   /renew outline         → hand the agent this chapter's current outline (its own record only)
 *
 * `/renew outline` exists so the agent never has to run a store-wide listing (`entwurf meta-facts`
 * prints every citizen's record) to find its own outline after a compaction: the handler reads ONLY
 * its own record, through the certifying reader, and hands back the body's bytes verbatim under a
 * separate custom type that says what it is. The reader still certifies the whole store first, so
 * the store read itself is not smaller — only what reaches the model is (#151, OpenClaw B's report
 * relayed by coordinator 68bd94).
 *
 * Nothing here writes a record. A confirmation that matches all the way returns a `transition`
 * effect; the handler carries it out (lib/renew-transition.ts) and re-runs this module's `recheck`
 * inside K1's locked section, so a confirmation is never itself a renew that happened (#151 b3-2).
 *
 * Every refusal drops an unused show binding. A refusal after the interview began in THIS chapter
 * (its entry marker is on the branch) also leaves a short note for the agent (a custom message that
 * opens no turn; while a reply streams, Pi holds it until the turn ends), so the agent learns why
 * on its next turn. The note is not an assistant message, so it never moves the candidate.
 */

import * as fs from "node:fs";
import { fileURLToPath } from "node:url";

import { type MetaIdentity, readAddressableMetaIdentity } from "./meta-session.ts";
import {
	bindRenewShow,
	checkRenewBody,
	findRenewCandidate,
	hasRenewEntryMarker,
	matchRenewConfirm,
	RENEW_ENTRY_CUSTOM_TYPE,
	RENEW_OUTLINE_CUSTOM_TYPE,
	RENEW_REFUSAL_CUSTOM_TYPE,
	type RenewBranchEntry,
	type RenewChapterRef,
	type RenewShowBinding,
} from "./renew-front-gate.ts";

/** The repository skill the entry points to; read from this checkout, never fetched. */
export const RENEW_SKILL_PATH = fileURLToPath(new URL("../../.claude/skills/entwurf-renew/SKILL.md", import.meta.url));

/**
 * What the outline notice may claim: the handler asked Pi to take the message. The return of Pi's
 * sendMessage is not an acknowledgement that it was appended or recorded: while a reply streams the
 * custom message waits as pending until that turn ends, and a failure goes to a separate error path
 * (pi-coding-agent 1.5.2 agent-session.js:1946-1985, :2861-2867) — so the notice never says the
 * message was recorded or read.
 */
export const RENEW_LOOKUP_DELIVERY = "새 턴 없음; 응답이 진행 중이면 그 턴이 끝난 뒤 반영된다";

export interface RenewCustomMessage {
	customType: string;
	content: string;
	display: true;
	details: Record<string, unknown>;
}

export type RenewCommandEffect =
	/** Send `message` with triggerTurn: the agent answers whether to begin. */
	| { kind: "entry"; message: RenewCustomMessage }
	/** Show `notice` to the human; the candidate is now bound. */
	| { kind: "show"; notice: string }
	/** Send `message` WITHOUT a turn and show `notice`: the current outline, looked up. */
	| { kind: "outline"; message: RenewCustomMessage; notice: string }
	/** Show `notice`; when `note` is present, also leave it for the agent without opening a turn. */
	| { kind: "refused"; reason: string; notice: string; note: RenewCustomMessage | null }
	/**
	 * The confirmation matched all the way: start the transition (#151 b3-2) for exactly this body
	 * and sha. `recheck` is the front gate again, against the branch and idleness at the moment it
	 * is called — the writer runs it inside the K1 locked section, right before the rename (C1.4b
	 * D4). It is synchronous and throws the reason when anything moved.
	 */
	| {
			kind: "transition";
			chapter: RenewChapterRef;
			body: string;
			fullSha: string;
			recheck: (io: RenewCommandIo) => undefined;
	  };

export interface RenewCommandDeps {
	/** The garden id this session is resident under, or null when it is not a citizen. */
	residentGardenId: () => string | null;
	/** Read a record through the addressable reader (default). Throws on any store defect. */
	readRecord?: (gardenId: string) => MetaIdentity;
	/** Whether the skill file exists (default: on disk). */
	skillExists?: () => boolean;
}

/** What one call sees of the live session. */
export interface RenewCommandIo {
	nativeSessionId: string;
	branch: readonly RenewBranchEntry[];
	isIdle: boolean;
}

/** Plain words for every reason the front gate or this command can give. */
const REASON_TEXT: Record<string, string> = {
	"not-a-citizen": "이 세션은 garden 시민이 아니다(--entwurf-control 없이 시작됨)",
	"record-unreadable": "이 세션의 record를 읽지 못했다",
	"not-pi": "renew는 Pi 세션의 record에서만 연다",
	"chapter-mismatch": "record가 가리키는 현재 장과 이 세션의 native id가 다르다",
	"renew-in-progress": "이 record는 이미 장을 넘기는 중이다",
	"not-idle": "응답이 진행 중이다. 끝난 뒤에 다시 친다",
	"skill-unavailable": "이 설치에는 entwurf-renew 스킬 파일이 없다. 스킬 없이 인터뷰를 시작하지 않는다",
	usage: "쓰는 법: /renew · /renew confirm · /renew confirm <sha8> · /renew outline",
	"no-entry-marker": "이 장에서 /renew로 시작한 대화가 없다",
	"no-reply-after-entry": "시작 뒤에 에이전트의 응답이 없다",
	"reply-not-complete": "마지막 응답이 정상으로 끝나지 않았다",
	"no-submission": "마지막 응답에 renew-outline 블록이 없다(판 없이 다시 답하면 앞의 판은 거둔 것이 된다)",
	"several-submissions": "마지막 응답에 renew-outline 여는 줄이 둘 이상이다",
	"submission-not-last": "renew-outline 블록이 마지막 응답의 맨 끝에 있지 않다(뒤에 글이나 도구 알림이 있다)",
	"opening-fence-not-canonical": "여는 줄이 정확한 모양이 아니다(들여쓰기·끝 공백 없이 백틱 N개 + renew-outline)",
	"unclosed-submission": "renew-outline 블록이 닫히지 않았다",
	"closing-fence-mismatch": "닫는 줄이 여는 줄과 같은 개수의 백틱만으로 되어 있지 않다",
	"carriage-return": "블록 안에 \\r 문자가 있다",
	"empty-body": "블록의 본문이 비어 있다",
	"too-large": "본문이 크기 상한을 넘는다",
	"guide-missing": "본문이 합의한 안내문으로 시작하지 않는다",
	"project-context-tag": '본문에 <project-context path=" 태그가 있다',
	"no-binding": "먼저 /renew confirm으로 판을 보여 줘야 한다",
	"chapter-changed": "보여 준 뒤 현재 장이 바뀌었다",
	"candidate-changed": "보여 준 뒤 후보가 바뀌었다(새 응답이나 새 /renew). /renew confirm으로 다시 본다",
	"sha-prefix-mismatch": "입력한 8자가 보여 준 판의 해시와 다르다",
};

function say(reason: string, detail?: string): string {
	const base = REASON_TEXT[reason] ?? reason;
	return detail ? `${base} — ${detail}` : base;
}

function note(chapter: RenewChapterRef, reason: string, text: string): RenewCustomMessage {
	return {
		customType: RENEW_REFUSAL_CUSTOM_TYPE,
		content: `[renew] 확인이 거절됐다: ${text}. 지금 장은 그대로 열려 있다.`,
		display: true,
		details: { gardenId: chapter.gardenId, nativeSessionId: chapter.nativeSessionId, reason },
	};
}

export function createRenewCommand(deps: RenewCommandDeps) {
	const readRecord = deps.readRecord ?? ((gid: string) => readAddressableMetaIdentity(gid));
	const skillExists = deps.skillExists ?? (() => fs.existsSync(RENEW_SKILL_PATH));
	let binding: RenewShowBinding | null = null;

	const refuse = (reason: string, chapter: RenewChapterRef | null, detail?: string): RenewCommandEffect => {
		const text = say(reason, detail);
		return {
			kind: "refused",
			reason,
			notice: `🪛 /renew: ${text}`,
			note: chapter ? note(chapter, reason, text) : null,
		};
	};

	/** The current chapter and its record — or the refusal that says why there is none. */
	const resolveChapter = (
		io: RenewCommandIo,
	): { chapter: RenewChapterRef; record: MetaIdentity } | RenewCommandEffect => {
		const gardenId = deps.residentGardenId();
		if (gardenId === null) return refuse("not-a-citizen", null);
		let record: MetaIdentity;
		try {
			record = readRecord(gardenId);
		} catch (err) {
			return refuse("record-unreadable", null, err instanceof Error ? err.message : String(err));
		}
		if (record.backend !== "pi") return refuse("not-pi", null);
		if (record.nativeSessionId !== io.nativeSessionId) return refuse("chapter-mismatch", null);
		if (record.renewing !== undefined) return refuse("renew-in-progress", null);
		return { chapter: { gardenId, nativeSessionId: io.nativeSessionId }, record };
	};

	const entry = (chapter: RenewChapterRef): RenewCommandEffect => {
		binding = null;
		// No fallback: without this checkout's skill the entry does not open an interview at all,
		// rather than send the agent looking for some other skill by name.
		if (!skillExists()) return refuse("skill-unavailable", null, RENEW_SKILL_PATH);
		const skill = `시작한다면 이 스킬을 먼저 읽는다: ${RENEW_SKILL_PATH}`;
		return {
			kind: "entry",
			message: {
				customType: RENEW_ENTRY_CUSTOM_TYPE,
				content:
					"[renew] 사용자가 /renew를 입력했다. 이 장을 마무리하고 다음 장으로 가는 대화를 지금 시작할지 먼저 답해 달라. " +
					`아직 갈 때가 아니라고 해도 된다. ${skill}`,
				display: true,
				details: { gardenId: chapter.gardenId, nativeSessionId: chapter.nativeSessionId },
			},
		};
	};

	/** `noteTo` is the chapter only while this chapter's interview has begun; otherwise no note. */
	const show = (chapter: RenewChapterRef, io: RenewCommandIo, noteTo: RenewChapterRef | null): RenewCommandEffect => {
		binding = null;
		if (!io.isIdle) return refuse("not-idle", noteTo);
		const candidate = findRenewCandidate(io.branch, chapter);
		if (candidate.kind !== "candidate") return refuse(candidate.reason, noteTo);
		const body = checkRenewBody(candidate.body);
		if (!body.ok) return refuse(body.reason, noteTo, body.detail);
		binding = bindRenewShow(chapter, candidate);
		const lines = candidate.body.split("\n");
		const sha8 = candidate.sha.slice(0, 8);
		return {
			kind: "show",
			notice:
				`🪛 /renew 후보: sha256 ${sha8}… · ${candidate.bytes} bytes\n` +
				`  첫 줄: ${lines[0]}\n  끝 줄: ${lines[lines.length - 1]}\n` +
				`  이 판본으로 넘기려면: /renew confirm ${sha8}`,
		};
	};

	const confirm = (
		chapter: RenewChapterRef,
		io: RenewCommandIo,
		typed: string,
		noteTo: RenewChapterRef | null,
	): RenewCommandEffect => {
		const bound = binding;
		binding = null;
		if (!io.isIdle) return refuse("not-idle", noteTo);
		const candidate = findRenewCandidate(io.branch, chapter);
		const match = matchRenewConfirm(bound, chapter, candidate, typed);
		if (!match.ok) return refuse(match.reason, noteTo);
		if (candidate.kind !== "candidate") return refuse("no-submission", noteTo);
		const body = checkRenewBody(candidate.body);
		if (!body.ok) return refuse(body.reason, noteTo, body.detail);
		if (bound === null) return refuse("no-binding", noteTo); // matchRenewConfirm already refused a null binding
		const pinned = bound;
		const recheck = (now: RenewCommandIo): undefined => {
			if (!now.isIdle) throw new Error("not-idle");
			if (now.nativeSessionId !== chapter.nativeSessionId) throw new Error("native-moved");
			const current = findRenewCandidate(now.branch, chapter);
			const again = matchRenewConfirm(pinned, chapter, current, pinned.fullSha.slice(0, 8));
			if (!again.ok) throw new Error(again.reason);
			if (current.kind !== "candidate") throw new Error("no-submission");
			const checked = checkRenewBody(current.body);
			if (!checked.ok) throw new Error(checked.reason);
			return undefined;
		};
		return { kind: "transition", chapter, body: candidate.body, fullSha: candidate.sha, recheck };
	};

	/**
	 * The current chapter's outline, from its own record only. The bytes are the record's body,
	 * verbatim, after a header that says what this is. It never touches the show binding: a lookup
	 * is not a refusal, a submission or a confirmation.
	 */
	const outline = (chapter: RenewChapterRef, record: MetaIdentity): RenewCommandEffect => {
		const o = record.outline;
		const details = { gardenId: chapter.gardenId, nativeSessionId: chapter.nativeSessionId };
		if (o === undefined) {
			return {
				kind: "outline",
				message: {
					customType: RENEW_OUTLINE_CUSTOM_TYPE,
					content:
						"[renew] 조회: 이 생일은 아직 renew한 적이 없어, 지금 장이 받은 얼개가 없다(첫 renew). " +
						"이 메시지는 조회일 뿐 인터뷰 시작·전환 동의·최종 판본 제출이나 확인이 아니다.",
					display: true,
					details: { ...details, outline: null },
				},
				notice: `🪛 /renew outline: 첫 renew — 받은 얼개가 없다는 조회 결과를 Pi에 전달하도록 요청했다 (${RENEW_LOOKUP_DELIVERY})`,
			};
		}
		return {
			kind: "outline",
			message: {
				customType: RENEW_OUTLINE_CUSTOM_TYPE,
				content:
					`[renew] 조회: 지금 장이 받은 최신 얼개(record의 outline, sha256 ${o.sha.slice(0, 8)}…, ` +
					`${Buffer.byteLength(o.body, "utf8")} bytes, 기록 ${o.writtenAt}). 이전 장이 쓰고 사용자가 확인했던 기억을 ` +
					"그대로 다시 보여 주는 것이다. 사용자의 새 발언도 지금의 실행 승인도 아니고, 인터뷰 시작·전환 동의·" +
					`최종 판본 제출이나 확인도 아니다. 아래는 record의 본문 바이트 그대로다.\n\n${o.body}`,
				display: true,
				details: {
					...details,
					outline: { sha: o.sha, bytes: Buffer.byteLength(o.body, "utf8"), writtenAt: o.writtenAt },
				},
			},
			notice: `🪛 /renew outline: 지금 장이 받은 얼개(${Buffer.byteLength(o.body, "utf8")} bytes)를 Pi에 전달하도록 요청했다 (${RENEW_LOOKUP_DELIVERY})`,
		};
	};

	return {
		handle(args: string, io: RenewCommandIo): RenewCommandEffect {
			const words = args
				.trim()
				.split(/\s+/)
				.filter((w) => w.length > 0);
			const isEntry = words.length === 0;
			const isShow = words.length === 1 && words[0] === "confirm";
			const isConfirm = words.length === 2 && words[0] === "confirm";
			const isOutline = words.length === 1 && words[0] === "outline";
			const known = isEntry || isShow || isConfirm || isOutline;
			const resolved = resolveChapter(io);
			if ("kind" in resolved) {
				binding = null;
				return known ? resolved : refuse("usage", null);
			}
			const { chapter, record } = resolved;
			const noteTo = hasRenewEntryMarker(io.branch, chapter) ? chapter : null;
			if (!known) {
				binding = null;
				return refuse("usage", noteTo);
			}
			if (isOutline) return outline(chapter, record);
			if (isEntry) return entry(chapter);
			if (isShow) return show(chapter, io, noteTo);
			return confirm(chapter, io, words[1], noteTo);
		},
		/** Drop an unused show binding (session_shutdown, any reason). */
		reset(): void {
			binding = null;
		},
	};
}

export type RenewCommand = ReturnType<typeof createRenewCommand>;
