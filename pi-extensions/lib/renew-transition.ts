/**
 * renew-transition — one /renew transition, in contract order (#151 b3-2; C1.2 §2, C1.4·a·b·d,
 * C1.4j/k/l/n).
 *
 *   0  the garden's v2 target lock (held to the end); a confirmed BASELINE of the garden's control
 *      listener (this garden, the leaving chapter, this pid, an incarnation) — or no K1 at all
 *   1  K1 (writeRenewStart), whose precondition is the front gate again, synchronous, inside the
 *      locked section; its record-arm release must be `released` before any switch is asked for
 *   2  the switch, through the caller's `switchSession` (`ctx.newSession` under the in-flight
 *      permit); in its setup: reserve `to` (release `released`), and only then append the body once
 *   3  in its withSession: ① the new session id = `to` = the new file's header id; ② the garden's
 *      listener names this garden, `to`, this pid and a non-empty incarnation other than the
 *      baseline's; ③ the new file's FIRST user message is exactly the agreed body, no line torn, no
 *      user message with anything but text blocks, no other copy; then, in the same synchronous
 *      section, ctx2 still names `to` and that file, and ④ commitRenew against the confirmed sha
 *   4  a cancelled switch is named by what was observed; the K1 mark is cleared only when every
 *      observation — re-read right before the clear — says the leaving chapter is still the live one
 *
 * A write's record and its exclusion evidence are kept apart: a release that is not `released`
 * stops the next effect before it happens, and after a commit or a clear it is reported beside the
 * write, never as a failed or rolled-back transition. Nothing here retries, rolls back or invents a
 * state; anything unexpected stops and reads the record back. Pi-facing work is injected.
 */
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import { sendRpcCommand } from "./entwurf-control-rpc.ts";
import { acquireLock, releaseLock } from "./entwurf-v2-lock.ts";
import { type LockedWriteSeam, RecordArmLockReleaseError } from "./record-arm-lock.ts";
import {
	type ClosedChapterProtection,
	classifyRenewRecord,
	clearRenewStart,
	commitRenew,
	type RenewRecordState,
	RenewWriteRefusal,
	readSessionHeaderIdentity,
	reserveRenewTo,
	writeRenewStart,
} from "./renew-writer.ts";

/** What a control listener says about itself (get_info, #151 b3-2). */
export interface ListenerIdentity {
	gardenId: string | null;
	nativeSessionId: string | null;
	pid: number | null;
	listenerIncarnation: string | null;
}

/** An incarnation counts only as a non-empty string; anything else is "not proven". */
const provenIncarnation = (v: unknown): v is string => typeof v === "string" && v !== "";

/**
 * get_info's data as a listener identity. A field of the wrong type is null; an empty incarnation is
 * null too — the same contract the transition's comparisons use (SOL b3-2-d residual 2).
 */
export function listenerIdentityFrom(data: unknown): ListenerIdentity {
	const d = (data ?? {}) as Record<string, unknown>;
	return {
		gardenId: typeof d.sessionId === "string" ? d.sessionId : null,
		nativeSessionId: typeof d.nativeSessionId === "string" ? d.nativeSessionId : null,
		pid: typeof d.pid === "number" ? d.pid : null,
		listenerIncarnation: provenIncarnation(d.listenerIncarnation) ? d.listenerIncarnation : null,
	};
}

/**
 * A no-turn get_info of a control listener (#151 b3-2, C1.2 step 5 ②): THAT listener's own binding,
 * pid and incarnation, and the garden it answers for. No answer, a refusal or a malformed reply is
 * null — "not observed", never a guessed identity.
 */
export async function probeControlListener(socketPath: string): Promise<ListenerIdentity | null> {
	try {
		const result = await sendRpcCommand(socketPath, { type: "get_info" }, { timeout: 3000 });
		if (!result.response.success) return null;
		return listenerIdentityFrom(result.response.data);
	} catch {
		return null; // no answer is "not observed"
	}
}

export interface SessionManagerLike {
	getSessionId(): string;
	appendMessage(message: { role: "user"; content: { type: "text"; text: string }[]; timestamp: number }): unknown;
}
export interface ReplacedSessionLike {
	sessionManager: { getSessionId(): string; getSessionFile(): string | undefined };
}

export interface RenewTransitionInput {
	gardenId: string;
	/** This renew's token (32 lowercase hex), held only in the caller's memory. */
	token: string;
	from: string;
	body: string;
	fullSha: string;
	/** The front gate again, against the live conversation. Synchronous; throws the reason. */
	recheck: () => undefined;
	/** Run the switch (the caller wraps `ctx.newSession` in the in-flight permit). */
	switchSession: (hooks: {
		setup: (sm: SessionManagerLike) => Promise<void>;
		withSession: (ctx2: ReplacedSessionLike) => Promise<void>;
	}) => Promise<{ cancelled: boolean }>;
	/** A no-turn get_info of the garden's control listener, or null when it does not answer. */
	probeListener: () => Promise<ListenerIdentity | null>;
	/** Did the in-flight permit pass a switch? */
	permitUsed: () => boolean;
	/** The old session's own id, read from its (possibly stale) context; null when unreadable. */
	oldSessionId: () => string | null;
	/** Tell the caller the reserved next native id (it re-binds the new session on it). */
	onReserved: (to: string) => void;
	sessionsDir?: string;
	recordArmLocksDir?: string;
	/** The v2 target lock dir; the real one by default. */
	targetLocksDir?: string;
	/** TEST-ONLY: the record-arm lock seam passed to every write (record-arm-lock.ts). */
	_test_lockedWrite?: LockedWriteSeam;
}

export type RenewTransitionOutcome =
	| { kind: "committed"; to: string; protection: string; notes: string[] }
	| { kind: "refused"; code: string; detail: string; notes: string[] }
	| { kind: "stopped"; code: string; detail: string; record: RenewRecordState; cleared: boolean; notes: string[] };

const messageOf = (err: unknown): string => (err instanceof Error ? err.message : String(err));
const describeProtection = (p: ClosedChapterProtection): string =>
	p.kind === "write-bits-removed"
		? `write bits removed (${p.from.toString(8)} → ${p.to.toString(8)})`
		: `closed-chapter-not-write-protected: ${p.detail}`;
const sha256 = (s: string): string => createHash("sha256").update(s, "utf8").digest("hex");

/**
 * The new chapter's file, checked strictly within a stated scope (C1.4b D3 persistence, SOL b3-2 D6
 * and b3-2-d residual 3): its header names `to`; every line parses as JSON (a torn line is not
 * skipped — it stops the check); EVERY user message carries only text blocks (any other content
 * stops the check); the FIRST user message is exactly the agreed body; no other user message
 * carries it. Entries that are not user messages are not validated beyond parsing — this is not a
 * SessionEntry validator. The file is the small one the transition just wrote, not an original.
 */
export function checkNewChapterFile(
	file: string,
	to: string,
	body: string,
): { ok: true } | { ok: false; reason: string } {
	const lines = fs
		.readFileSync(file, "utf8")
		.split("\n")
		.filter((l) => l.trim() !== "");
	const parsed: unknown[] = [];
	for (const [i, line] of lines.entries()) {
		try {
			parsed.push(JSON.parse(line));
		} catch {
			return { ok: false, reason: `line ${i + 1} of the new chapter's file does not parse` };
		}
	}
	const header = parsed[0] as { type?: unknown; id?: unknown } | undefined;
	if (header?.type !== "session" || header.id !== to)
		return { ok: false, reason: `the new file's header does not name ${to}` };
	const userTexts: string[] = [];
	for (const entry of parsed.slice(1) as { type?: unknown; message?: { role?: unknown; content?: unknown } }[]) {
		if (entry?.type !== "message" || entry.message?.role !== "user") continue;
		const content = entry.message.content;
		const blocks = (Array.isArray(content) ? content : []) as { type?: unknown; text?: unknown }[];
		if (blocks.length === 0 || !blocks.every((b) => b?.type === "text" && typeof b.text === "string"))
			return { ok: false, reason: `user message ${userTexts.length + 1} carries content other than text blocks` };
		userTexts.push(blocks.map((b) => b.text as string).join(""));
	}
	if (userTexts.length === 0) return { ok: false, reason: "the new file carries no user message" };
	if (userTexts[0] !== body)
		return { ok: false, reason: "the new file's first user message is not exactly the agreed body" };
	const copies = userTexts.filter((t) => t === body).length;
	if (copies !== 1) return { ok: false, reason: `the new file carries the agreed body ${copies} times` };
	return { ok: true };
}

export async function runRenewTransition(t: RenewTransitionInput): Promise<RenewTransitionOutcome> {
	const notes: string[] = [];
	const writer = {
		gardenId: t.gardenId,
		token: t.token,
		sessionsDir: t.sessionsDir,
		recordArmLocksDir: t.recordArmLocksDir,
		_test_lockedWrite: t._test_lockedWrite,
	};
	const classify = (): RenewRecordState =>
		classifyRenewRecord({
			gardenId: t.gardenId,
			token: t.token,
			from: t.from,
			outlineSha: t.fullSha,
			sessionsDir: t.sessionsDir,
		});
	const stopped = (code: string, detail: string, cleared = false): RenewTransitionOutcome => ({
		kind: "stopped",
		code,
		detail,
		record: classify(),
		cleared,
		notes,
	});
	const lockDeps = t.targetLocksDir === undefined ? {} : { dir: t.targetLocksDir };

	// 0. The garden's v2 target lock, for the whole transition. A primitive error is not "busy".
	let lock: ReturnType<typeof acquireLock>;
	try {
		lock = acquireLock(t.gardenId, lockDeps);
	} catch (err) {
		return { kind: "refused", code: "target-lock-error", detail: messageOf(err), notes };
	}
	if (!lock.ok) return { kind: "refused", code: "target-locked", detail: lock.conflict.detail, notes };
	let outcome: RenewTransitionOutcome;
	try {
		outcome = await transition();
	} catch (err) {
		outcome = stopped("renew-transition-error", messageOf(err));
	}
	// The target lock's release is evidence beside the outcome; it never overwrites it.
	try {
		const released = releaseLock(lock.claim, lockDeps);
		if (released !== "released") notes.push(`the garden's v2 target lock was ${released} at release`);
	} catch (err) {
		notes.push(`the garden's v2 target lock was not released: ${messageOf(err)}`);
	}
	return outcome;

	async function transition(): Promise<RenewTransitionOutcome> {
		if (sha256(t.body) !== t.fullSha) {
			return { kind: "refused", code: "outline-sha-mismatch", detail: "the body is not the confirmed edition", notes };
		}
		// A confirmed baseline, or no K1: this garden's listener, bound to the leaving chapter, here.
		const before = await t.probeListener();
		if (
			before === null ||
			before.gardenId !== t.gardenId ||
			before.nativeSessionId !== t.from ||
			before.pid !== process.pid ||
			!provenIncarnation(before.listenerIncarnation)
		) {
			return {
				kind: "refused",
				code: "renew-listener-baseline-unproven",
				detail: `the garden's listener answers ${JSON.stringify(before)}, expected ${t.gardenId}/${t.from} in pid ${process.pid}`,
				notes,
			};
		}
		const baseline: string = before.listenerIncarnation;

		// 1. K1, with the front gate re-checked inside the locked section.
		try {
			const k1 = writeRenewStart({ ...writer, expectedNative: t.from, outline: t.body, precondition: t.recheck });
			if (k1.release !== "released") {
				return stopped(
					"renew-k1-exclusion-unproven",
					`K1 was written, but its record-arm lock was ${k1.release} at release`,
				);
			}
		} catch (err) {
			if (err instanceof RenewWriteRefusal) return { kind: "refused", code: err.code, detail: err.message, notes };
			if (err instanceof RecordArmLockReleaseError) return stopped("renew-k1-release-failed", err.message);
			throw err;
		}

		// 2–3. The switch. withSession's verdict is kept here; it never throws out of Pi's hook.
		let reserved: string | null = null;
		let verdict: RenewTransitionOutcome | null = null;
		const result = await t.switchSession({
			setup: async (sm) => {
				const to = sm.getSessionId();
				// Reserve before anything is appended. A reservation whose exclusion is not proven, or that
				// fails, throws: no append (C1.2 3a; the cost is a stopped switch, never a second birth).
				const r = reserveRenewTo({ ...writer, from: t.from, to });
				if (r.release !== "released")
					throw new Error(`renew-reserve-exclusion-unproven: the record-arm lock was ${r.release}`);
				reserved = to;
				t.onReserved(to);
				sm.appendMessage({ role: "user", content: [{ type: "text", text: t.body }], timestamp: Date.now() });
			},
			withSession: async (ctx2) => {
				try {
					verdict = await confirmAndCommit(ctx2, reserved, baseline);
				} catch (err) {
					verdict = stopped("renew-commit-failed", messageOf(err));
				}
			},
		});

		if (result.cancelled) {
			// 4. Named by what was observed. Clear only when every observation — the old id re-read right
			// before the clear, after the listener's await — says the leaving chapter is still live.
			const code = t.permitUsed()
				? "renew-switch-cancelled-after-admission"
				: "renew-switch-cancelled-before-admission";
			const listenerSaysFrom = (await t.probeListener())?.nativeSessionId === t.from;
			const oldIdNow = t.oldSessionId();
			if (listenerSaysFrom && oldIdNow === t.from && reserved === null) {
				try {
					const c = clearRenewStart({ ...writer, from: t.from });
					if (c.release !== "released")
						notes.push(`the clear was written, but its record-arm lock was ${c.release} at release`);
					return stopped(code, "the switch was cancelled with nothing reserved; the K1 mark is cleared", true);
				} catch (err) {
					if (err instanceof RecordArmLockReleaseError) {
						notes.push(`the clear was written, but releasing its record-arm lock threw: ${messageOf(err.cause)}`);
						return stopped(code, "the switch was cancelled with nothing reserved; the K1 mark is cleared", true);
					}
					return stopped(code, `the switch was cancelled; clearing the K1 mark failed: ${messageOf(err)}`);
				}
			}
			return stopped(
				code,
				"the switch was cancelled and the leaving chapter could not be confirmed live; the mark stays",
			);
		}
		return verdict ?? stopped("renew-no-verdict", "the switch completed without reaching withSession");
	}

	async function confirmAndCommit(
		ctx2: ReplacedSessionLike,
		to: string | null,
		baseline: string,
	): Promise<RenewTransitionOutcome> {
		const id2 = ctx2.sessionManager.getSessionId();
		const file = ctx2.sessionManager.getSessionFile();
		if (to === null || id2 !== to)
			return stopped("renew-new-session-mismatch", `the new session is ${id2}, reserved ${to}`);
		if (file === undefined || readSessionHeaderIdentity(file)?.id !== to) {
			return stopped("renew-new-file-mismatch", `the new session's file does not carry header ${to}`);
		}
		const now = await t.probeListener();
		if (
			now === null ||
			now.gardenId !== t.gardenId ||
			now.nativeSessionId !== to ||
			now.pid !== process.pid ||
			!provenIncarnation(now.listenerIncarnation) ||
			now.listenerIncarnation === baseline
		) {
			return stopped(
				"renew-listener-not-bound",
				`the garden's listener answers ${JSON.stringify(now)}, expected ${t.gardenId}/${to} under a new listener of pid ${process.pid} with a non-empty incarnation`,
			);
		}
		const fileCheck = checkNewChapterFile(file, to, t.body);
		if (!fileCheck.ok) return stopped("renew-new-file-unverified", fileCheck.reason);
		// Same synchronous section as the commit: ctx2 still names `to` and that file after the await
		// above (a stale or replaced context stops here).
		let againId: string;
		let againFile: string | undefined;
		try {
			againId = ctx2.sessionManager.getSessionId();
			againFile = ctx2.sessionManager.getSessionFile();
		} catch (err) {
			return stopped("renew-new-session-moved", `the new session's context is no longer readable: ${messageOf(err)}`);
		}
		if (againId !== to || againFile !== file) {
			return stopped(
				"renew-new-session-moved",
				`the new session became ${againId} (${againFile}) while it was being checked`,
			);
		}
		let committed: ReturnType<typeof commitRenew>;
		try {
			committed = commitRenew({ ...writer, from: t.from, to, expectedOutlineSha: t.fullSha, newTranscriptPath: file });
		} catch (err) {
			if (err instanceof RecordArmLockReleaseError) {
				// The commit was written (the error carries what it wrote); only the release of its
				// record-arm lock threw afterwards — not a failed transition.
				notes.push(`the commit was written, but releasing its record-arm lock threw: ${messageOf(err.cause)}`);
				const written = err.written as { protection?: ClosedChapterProtection } | undefined;
				return {
					kind: "committed",
					to,
					protection:
						written?.protection === undefined
							? "not observed by the caller (the commit's result was not carried)"
							: describeProtection(written.protection),
					notes,
				};
			}
			throw err;
		}
		if (committed.release !== "released")
			notes.push(`the commit's record-arm lock was ${committed.release} at release`);
		return { kind: "committed", to, protection: describeProtection(committed.protection), notes };
	}
}
