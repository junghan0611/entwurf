/**
 * renew-transition — the transition's own conditions, without Pi (#151 b3-2; SOL b3-2 D1–D3, D6).
 *
 * Production subject: `runRenewTransition` and `checkNewChapterFile`. The record writer, the record-arm
 * lock and the v2 target lock are the real ones in a throwaway store; what Pi would do is injected:
 * `switchSession` calls setup then withSession the way the SDK does, `probeListener` answers as the
 * garden's listener would. Oracles: the outcome, the record read back, the new file on disk, whether
 * the switch was asked for at all. The end-to-end path through the real handler is
 * entwurf-control.transition.test.ts.
 */
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readAddressableMetaIdentity } from "./meta-session.ts";
import { birthPiCitizen } from "./pi-citizen-birth.ts";
import {
	checkNewChapterFile,
	type ListenerIdentity,
	listenerIdentityFrom,
	type RenewTransitionInput,
	runRenewTransition,
} from "./renew-transition.ts";

const SAVED = { agent: process.env.PI_CODING_AGENT_DIR };
let root = "";
beforeAll(() => {
	root = fs.mkdtempSync(path.join(os.tmpdir(), "rtr-"));
	process.env.PI_CODING_AGENT_DIR = path.join(root, "env-agent");
});
afterAll(() => {
	if (SAVED.agent === undefined) delete process.env.PI_CODING_AGENT_DIR;
	else process.env.PI_CODING_AGENT_DIR = SAVED.agent;
	fs.rmSync(root, { recursive: true, force: true });
});

const N0 = "01900000-0000-7000-8000-0000000151b0";
const N1 = "01900000-0000-7000-8000-0000000151b1";
const BODY = "이 글은 이전 장 에이전트가 작성하고 GLG가 전달 판본을 확인한 기억의 얼개다.\n[1장] 단위";
const SHA = createHash("sha256").update(BODY, "utf8").digest("hex");
const line = (o: unknown): string => `${JSON.stringify(o)}\n`;
const userLine = (text: string): string =>
	line({
		type: "message",
		id: "u",
		timestamp: "2026-11-17T00:00:00.000Z",
		message: { role: "user", content: [{ type: "text", text }] },
	});

let seq = 0;
interface Fixture {
	t: RenewTransitionInput;
	f1: string;
	gardenId: string;
	switchCalls: () => number;
	setListener: (l: ListenerIdentity | null) => void;
	targetLockPath: string;
}
/** A born garden on N0 with a real original, and a transition input whose Pi side is a faithful stub. */
function fixture(
	over: Partial<RenewTransitionInput> = {},
	hooks: { duringSwitch?: () => void; newIncarnation?: string } = {},
): Fixture {
	const base = path.join(root, `s${++seq}`);
	fs.mkdirSync(base, { recursive: true });
	const sessionsDir = path.join(base, "meta-sessions");
	const recordArmLocksDir = path.join(base, "arm");
	const targetLocksDir = path.join(base, "target");
	const f0 = path.join(base, "n0.jsonl");
	const f1 = path.join(base, "n1.jsonl");
	fs.writeFileSync(
		f0,
		line({ type: "session", version: 3, id: N0, timestamp: "2026-11-17T00:00:00.000Z", cwd: "/tmp" }),
	);
	const gardenId = birthPiCitizen({
		nativeSessionId: N0,
		cwd: "/tmp",
		transcriptPath: f0,
		sessionsDir,
		recordArmLocksDir,
		controlSocketDir: path.join(base, "sock"),
	}).gardenId;
	let listener: ListenerIdentity | null = {
		gardenId,
		nativeSessionId: N0,
		pid: process.pid,
		listenerIncarnation: "baseline",
	};
	let calls = 0;
	const t: RenewTransitionInput = {
		gardenId,
		token: "c".repeat(32),
		from: N0,
		body: BODY,
		fullSha: SHA,
		recheck: () => undefined,
		switchSession: async (h) => {
			calls++;
			hooks.duringSwitch?.();
			try {
				await h.setup({
					getSessionId: () => N1,
					appendMessage: (m) => {
						if (!fs.existsSync(f1))
							fs.writeFileSync(
								f1,
								line({ type: "session", version: 3, id: N1, timestamp: "2026-11-17T00:01:00.000Z", cwd: "/tmp" }),
							);
						fs.appendFileSync(
							f1,
							line({ type: "message", id: "u1", timestamp: "2026-11-17T00:01:00.000Z", message: m }),
						);
					},
				});
			} catch {
				return { cancelled: false }; // the SDK would never return here (G5); the test reads the state
			}
			listener = {
				gardenId,
				nativeSessionId: N1,
				pid: process.pid,
				listenerIncarnation: hooks.newIncarnation ?? "new",
			};
			await h.withSession({ sessionManager: { getSessionId: () => N1, getSessionFile: () => f1 } });
			return { cancelled: false };
		},
		probeListener: async () => listener,
		permitUsed: () => true,
		oldSessionId: () => N0,
		onReserved: () => {},
		sessionsDir,
		recordArmLocksDir,
		targetLocksDir,
		...over,
	};
	return {
		t,
		f1,
		gardenId,
		switchCalls: () => calls,
		setListener: (l) => {
			listener = l;
		},
		targetLockPath: path.join(targetLocksDir, `${gardenId}.lock`),
	};
}
const record = (fx: Fixture) => readAddressableMetaIdentity(fx.gardenId, fx.t.sessionsDir as string);
/** A record-arm seam that makes the Nth write's lock release THROW: its lock path becomes a directory. */
function breakNthRelease(n: number) {
	let k = 0;
	return {
		after: (lockPath: string) => {
			if (++k !== n) return;
			fs.rmSync(lockPath);
			fs.mkdirSync(lockPath);
		},
	};
}
/** A record-arm seam that turns the Nth write's own lock into another's claim after the write. */
function stealNthRelease(n: number) {
	let k = 0;
	return {
		after: (lockPath: string) => {
			if (++k !== n) return;
			const claim = JSON.parse(fs.readFileSync(lockPath, "utf8")) as Record<string, unknown>;
			fs.writeFileSync(lockPath, JSON.stringify({ ...claim, nonce: "e".repeat(32) }));
		},
	};
}

describe("the transition's own conditions (#151 b3-2)", () => {
	it("[QK:RENEW-B32U-HAPPY] with a proven baseline and clean releases the transition commits", async () => {
		const fx = fixture();
		const out = await runRenewTransition(fx.t);
		expect(out.kind).toBe("committed");
		expect(record(fx).nativeSessionId).toBe(N1);
	});

	it("[QK:RENEW-B32U-BASELINE-UNPROVEN] without a proven baseline of the garden's listener nothing is written and no switch is asked for", async () => {
		for (const bad of [
			null,
			{ gardenId: "20261117T000000-aaaaaa", nativeSessionId: N0, pid: process.pid, listenerIncarnation: "x" },
		]) {
			const fx = fixture();
			fx.setListener(bad as ListenerIdentity | null);
			const out = await runRenewTransition(fx.t);
			expect(out).toMatchObject({ kind: "refused", code: "renew-listener-baseline-unproven" });
			expect(record(fx).renewing).toBeUndefined();
			expect(fx.switchCalls()).toBe(0);
		}
	});

	it("[QK:RENEW-B32U-BASELINE-INCARNATION-PROVEN] a baseline that is right in every field but an empty incarnation is not proven: no K1, no switch", async () => {
		const fx = fixture();
		fx.setListener({ gardenId: fx.gardenId, nativeSessionId: N0, pid: process.pid, listenerIncarnation: "" });
		const out = await runRenewTransition(fx.t);
		expect(out).toMatchObject({ kind: "refused", code: "renew-listener-baseline-unproven" });
		expect(record(fx).renewing).toBeUndefined();
		expect(fx.switchCalls()).toBe(0);
	});

	it("[QK:RENEW-B32U-NEW-INCARNATION-PROVEN] a new listener whose incarnation is empty is not proven: nothing is committed", async () => {
		const fx = fixture({}, { newIncarnation: "" });
		const out = await runRenewTransition(fx.t);
		expect(out).toMatchObject({ kind: "stopped", code: "renew-listener-not-bound" });
		expect(record(fx).nativeSessionId).toBe(N0);
	});

	it("[QK:RENEW-B32U-DECODE-INCARNATION] get_info's data decodes an empty or non-string incarnation as not proven", () => {
		const base = { sessionId: "g", nativeSessionId: N0, pid: 7 };
		expect(listenerIdentityFrom({ ...base, listenerIncarnation: "" }).listenerIncarnation).toBeNull();
		expect(listenerIdentityFrom({ ...base, listenerIncarnation: 5 }).listenerIncarnation).toBeNull();
		expect(listenerIdentityFrom({ ...base, listenerIncarnation: "i1" })).toEqual({
			gardenId: "g",
			nativeSessionId: N0,
			pid: 7,
			listenerIncarnation: "i1",
		});
		expect(listenerIdentityFrom(null)).toEqual({
			gardenId: null,
			nativeSessionId: null,
			pid: null,
			listenerIncarnation: null,
		});
	});

	it("[QK:RENEW-B32U-K1-RELEASE-NOT-PROVEN] a K1 whose lock was not this call's at release stops before the switch", async () => {
		const fx = fixture({ _test_lockedWrite: stealNthRelease(1) });
		const out = await runRenewTransition(fx.t);
		expect(out).toMatchObject({ kind: "stopped", code: "renew-k1-exclusion-unproven" });
		expect(fx.switchCalls()).toBe(0);
		expect(record(fx).renewing?.to).toBeNull();
	});

	it("[QK:RENEW-B32U-RESERVE-RELEASE-NO-APPEND] a reservation whose lock was not this call's at release appends nothing", async () => {
		const fx = fixture({ _test_lockedWrite: stealNthRelease(2) });
		const out = await runRenewTransition(fx.t);
		expect(out.kind).toBe("stopped");
		expect(fs.existsSync(fx.f1)).toBe(false);
		expect(record(fx).nativeSessionId).toBe(N0);
	});

	it("[QK:RENEW-B32U-TARGET-RELEASE-BESIDE] the target lock's release is reported beside a commit and never overwrites it", async () => {
		const fx = fixture(
			{},
			{
				duringSwitch: () => {
					const claim = JSON.parse(fs.readFileSync(fx.targetLockPath, "utf8")) as Record<string, unknown>;
					fs.writeFileSync(fx.targetLockPath, JSON.stringify({ ...claim, nonce: "e".repeat(32) }));
				},
			},
		);
		const out = await runRenewTransition(fx.t);
		expect(out.kind).toBe("committed");
		expect(out.notes.some((n) => n.includes("target lock was not-owned"))).toBe(true);
	});

	it("[QK:RENEW-B32U-RELEASE-THROW-KEEPS-WRITE] a commit or a clear whose lock release THROWS is still reported as written, with the release beside it", async () => {
		const committed = fixture({ _test_lockedWrite: breakNthRelease(3) }); // K1, reserve, commit
		const c = await runRenewTransition(committed.t);
		expect(c.kind).toBe("committed");
		expect(c.kind === "committed" && c.protection.startsWith("write bits removed")).toBe(true);
		expect(c.notes.some((n) => n.includes("releasing its record-arm lock threw"))).toBe(true);
		expect(record(committed).nativeSessionId).toBe(N1);
		const cleared = fixture({
			switchSession: async () => ({ cancelled: true }),
			_test_lockedWrite: breakNthRelease(2),
		});
		const k = await runRenewTransition(cleared.t);
		expect(k).toMatchObject({ kind: "stopped", cleared: true });
		expect(k.notes.some((n) => n.includes("releasing its record-arm lock threw"))).toBe(true);
		expect(record(cleared).renewing).toBeUndefined();
	});

	it("[QK:RENEW-B32U-CTX2-MOVED-AFTER-AWAIT] a new-session context that moves while the listener is awaited is not committed", async () => {
		let moved = false;
		const fx = fixture();
		const inner = fx.t.switchSession;
		fx.t.switchSession = async (h) =>
			inner({
				setup: h.setup,
				withSession: (ctx2) =>
					h.withSession({
						sessionManager: {
							getSessionId: () => (moved ? "01900000-0000-7000-8000-00000000dead" : N1),
							getSessionFile: () => ctx2.sessionManager.getSessionFile(),
						},
					}),
			});
		const probe = fx.t.probeListener;
		fx.t.probeListener = async () => {
			const answer = await probe();
			if (answer?.nativeSessionId === N1) moved = true; // the context moves during this await
			return answer;
		};
		const out = await runRenewTransition(fx.t);
		expect(out).toMatchObject({ kind: "stopped", code: "renew-new-session-moved" });
		expect(record(fx).nativeSessionId).toBe(N0);
	});

	it("[QK:RENEW-B32U-CANCEL-REREADS-OLD-ID] a cancelled switch clears only when the old id, re-read after the listener's await, is still the leaving chapter", async () => {
		const cancelled = async () => ({ cancelled: true });
		const ok = fixture({ switchSession: cancelled });
		expect(await runRenewTransition(ok.t)).toMatchObject({ kind: "stopped", cleared: true });
		expect(record(ok).renewing).toBeUndefined();
		let oldId: string | null = N0;
		const moved = fixture({ switchSession: cancelled, oldSessionId: () => oldId });
		const probe = moved.t.probeListener;
		let probes = 0;
		moved.t.probeListener = async () => {
			if (++probes === 2) oldId = "01900000-0000-7000-8000-00000000dead"; // moves during the cancel probe
			return probe();
		};
		expect(await runRenewTransition(moved.t)).toMatchObject({ kind: "stopped", cleared: false });
		expect(record(moved).renewing).toBeDefined();
		const stale = fixture({ switchSession: cancelled, oldSessionId: () => null });
		expect(await runRenewTransition(stale.t)).toMatchObject({ kind: "stopped", cleared: false });
	});

	it("[QK:RENEW-B32U-FILE-FIRST-USER-EXACT] the new file is checked strictly: first user exactly the body, nothing torn, no other copy, text blocks only", () => {
		const dir = fs.mkdtempSync(path.join(root, "f-"));
		const header = line({ type: "session", version: 3, id: N1, timestamp: "t", cwd: "/tmp" });
		const write = (name: string, rest: string): string => {
			const f = path.join(dir, name);
			fs.writeFileSync(f, header + rest);
			return f;
		};
		expect(checkNewChapterFile(write("ok", userLine(BODY)), N1, BODY)).toEqual({ ok: true });
		expect(checkNewChapterFile(write("before", userLine("다른 말") + userLine(BODY)), N1, BODY).ok).toBe(false);
		expect(checkNewChapterFile(write("torn", `${userLine(BODY)}{"type":"mess\n`), N1, BODY).ok).toBe(false);
		expect(checkNewChapterFile(write("twice", userLine(BODY) + userLine(BODY)), N1, BODY).ok).toBe(false);
		const userWith = (content: unknown): string =>
			line({ type: "message", id: "u", timestamp: "t", message: { role: "user", content } });
		const image = userWith([{ type: "image", text: BODY }]);
		expect(checkNewChapterFile(write("nontext", image), N1, BODY).ok).toBe(false);
		expect(checkNewChapterFile(write("header", userLine(BODY)), N0, BODY).ok).toBe(false);
	});

	it("[QK:RENEW-B32U-FILE-EVERY-USER-TEXT] a later user message with anything but text blocks stops the check, though the first one is exactly the body", () => {
		const dir = fs.mkdtempSync(path.join(root, "g-"));
		const header = line({ type: "session", version: 3, id: N1, timestamp: "t", cwd: "/tmp" });
		const write = (name: string, rest: string): string => {
			const f = path.join(dir, name);
			fs.writeFileSync(f, header + rest);
			return f;
		};
		const userWith = (content: unknown): string =>
			line({ type: "message", id: "u", timestamp: "t", message: { role: "user", content } });
		for (const [i, later] of [
			userWith([{ type: "image", data: "AAAA", mimeType: "image/png" }]),
			userWith([]),
			userWith("말"),
		].entries()) {
			const out = checkNewChapterFile(write(`later-${i}`, userLine(BODY) + later), N1, BODY);
			expect(out).toEqual({ ok: false, reason: "user message 2 carries content other than text blocks" });
		}
	});
});
