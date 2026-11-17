/**
 * renew-recover — the explicit offline recovery of a /renew whose owner is gone (#151 C1.4o).
 *
 * Production subject: `recoverRenew` over the REAL writer and record-arm lock in a throwaway store.
 * The gone owner is a real process that ran and was killed (its pid and start key are written into
 * the mark), so the owner rule is the real one. Oracles: the outcome, the record's bytes and
 * fields read back, the reserved chapter's file bytes, the leaving original's mode and the saved
 * body. The real Pi path (kill, recover, then `pi --session`) is the isolated measurement.
 */
import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { processStartKey, readAddressableMetaIdentity } from "./meta-session.ts";
import { birthPiCitizen } from "./pi-citizen-birth.ts";
import { type RecoverPlan, recoverRenew } from "./renew-recover.ts";
import { reserveRenewTo, writeRenewStart } from "./renew-writer.ts";

const SAVED = { agent: process.env.PI_CODING_AGENT_DIR };
let root = "";
beforeAll(() => {
	root = fs.mkdtempSync(path.join(os.tmpdir(), "rrc-"));
	process.env.PI_CODING_AGENT_DIR = path.join(root, "env-agent");
});
afterAll(() => {
	if (SAVED.agent === undefined) delete process.env.PI_CODING_AGENT_DIR;
	else process.env.PI_CODING_AGENT_DIR = SAVED.agent;
	fs.rmSync(root, { recursive: true, force: true });
});

const N0 = "01900000-0000-7000-8000-0000000151d0";
const N1 = "01900000-0000-7000-8000-0000000151d1";
const TOKEN = "c".repeat(32);
const BODY =
	"이 글은 이전 장 에이전트가 작성하고 GLG가 전달 판본을 확인한 기억의 얼개다. GLG의 직접 발언이나 새로운 실행 승인이 아니다.\n[1장] 수습";
const line = (o: unknown): string => `${JSON.stringify(o)}\n`;
const header = (id: string): string =>
	line({ type: "session", version: 3, id, timestamp: "2026-11-17T00:00:00.000Z", cwd: "/tmp" });
const user = (text: string): string =>
	line({ type: "message", id: "u", timestamp: "t", message: { role: "user", content: [{ type: "text", text }] } });

async function deadOwner(): Promise<{ pid: number; startKey: string }> {
	const child = spawn(process.execPath, ["-e", "setTimeout(() => {}, 30000)"], { stdio: "ignore" });
	await new Promise((r) => setTimeout(r, 150));
	const pid = child.pid as number;
	const startKey = processStartKey(pid);
	const exited = new Promise((r) => child.once("exit", r));
	child.kill("SIGKILL");
	await exited;
	return { pid, startKey };
}

let seq = 0;
interface Mid {
	gardenId: string;
	recordPath: string;
	original: string;
	reserved: string;
	base: string;
	sessionsDir: string;
	recordArmLocksDir: string;
}
/** A garden left mid-/renew by a gone owner: K1, and with `reserve` the next chapter reserved and written. */
async function midRenew(reserve: boolean, owner: "dead" | "live" = "dead"): Promise<Mid> {
	const base = path.join(root, `s${++seq}`);
	fs.mkdirSync(base, { recursive: true });
	const sessionsDir = path.join(base, "meta-sessions");
	const recordArmLocksDir = path.join(base, "arm");
	const original = path.join(base, "n0.jsonl");
	fs.writeFileSync(original, header(N0), { mode: 0o644 });
	const b = birthPiCitizen({
		nativeSessionId: N0,
		cwd: "/tmp",
		transcriptPath: original,
		sessionsDir,
		recordArmLocksDir,
		controlSocketDir: path.join(base, "sock"),
	});
	const at = { gardenId: b.gardenId, token: TOKEN, sessionsDir, recordArmLocksDir };
	writeRenewStart({ ...at, expectedNative: N0, outline: BODY, precondition: () => undefined });
	const reserved = path.join(base, "n1.jsonl");
	if (reserve) {
		reserveRenewTo({ ...at, from: N0, to: N1 });
		fs.writeFileSync(reserved, header(N1) + user(BODY));
	}
	if (owner === "dead") {
		const raw = JSON.parse(fs.readFileSync(b.recordPath, "utf8")) as { renewing: { owner: unknown } };
		raw.renewing.owner = await deadOwner();
		fs.writeFileSync(b.recordPath, JSON.stringify(raw, null, 2));
	}
	return { gardenId: b.gardenId, recordPath: b.recordPath, original, reserved, base, sessionsDir, recordArmLocksDir };
}
const run = (m: Mid, plan: RecoverPlan, extra: Record<string, unknown> = {}) =>
	recoverRenew({
		gardenId: m.gardenId,
		plan,
		sessionsDir: m.sessionsDir,
		recordArmLocksDir: m.recordArmLocksDir,
		...extra,
	});
const record = (m: Mid) => readAddressableMetaIdentity(m.gardenId, m.sessionsDir);
const bytes = (f: string): Buffer => fs.readFileSync(f);

describe("/renew offline recovery (#151 C1.4o)", () => {
	it("[QK:RENEW-REC-STATUS-READ-ONLY] the status names the attempt and its owner's verdict and writes nothing", async () => {
		const m = await midRenew(true);
		const before = bytes(m.recordPath);
		expect(run(m, { kind: "status" })).toMatchObject({
			kind: "status",
			from: N0,
			to: N1,
			token8: TOKEN.slice(0, 8),
			owner: { verdict: "dead" },
		});
		expect(bytes(m.recordPath).equals(before)).toBe(true);
	});

	it("[QK:RENEW-REC-CONTINUE-COMMITS-SAME-TO] a reserved chapter is continued under the same garden: the record names it, its file is untouched, the original loses its write bits", async () => {
		const m = await midRenew(true);
		const file = bytes(m.reserved);
		const out = run(m, { kind: "continue", file: m.reserved });
		expect(out).toMatchObject({ kind: "continued", to: N1, file: m.reserved });
		const r = record(m);
		expect(r.gardenId).toBe(m.gardenId);
		expect(r.nativeSessionId).toBe(N1);
		expect(r.transcriptPath).toBe(m.reserved);
		expect(r.renewing).toBeUndefined();
		expect(r.chapters?.map((c) => c.nativeSessionId)).toEqual([N0]);
		expect(r.outline).toMatchObject({ body: BODY, forNativeSessionId: N1 });
		expect(bytes(m.reserved).equals(file)).toBe(true);
		expect(fs.statSync(m.original).mode & 0o222).toBe(0);
	});

	it("[QK:RENEW-REC-CONTINUE-FILE-CHECKED] a file that is not the reserved chapter carrying the body first and once is refused before the hand-over; nothing is written", async () => {
		const m = await midRenew(true);
		const marked = bytes(m.recordPath);
		const write = (name: string, content: string): string => {
			const f = path.join(m.base, name);
			fs.writeFileSync(f, content);
			return f;
		};
		for (const file of [
			"n1.jsonl", // relative
			write("other.jsonl", header(N0) + user(BODY)),
			write("twice.jsonl", header(N1) + user(BODY) + user(BODY)),
			write("first-not-body.jsonl", header(N1) + user("다른 말") + user(BODY)),
		]) {
			expect(run(m, { kind: "continue", file })).toMatchObject({ kind: "refused", code: "file-unverified" });
			expect(bytes(m.recordPath).equals(marked)).toBe(true);
		}
	});

	it("[QK:RENEW-REC-HANDOVER-RELEASE-STOPS] a hand-over whose lock was not this call's at release stops before the commit", async () => {
		const m = await midRenew(true);
		const steal = {
			after: (lockPath: string) => {
				const claim = JSON.parse(fs.readFileSync(lockPath, "utf8")) as Record<string, unknown>;
				fs.writeFileSync(lockPath, JSON.stringify({ ...claim, nonce: "e".repeat(32) }));
			},
		};
		const out = run(m, { kind: "continue", file: m.reserved }, { _test_lockedWrite: steal });
		expect(out).toMatchObject({ kind: "stopped", code: "hand-over-exclusion-unproven" });
		const r = record(m);
		expect(r.nativeSessionId).toBe(N0);
		expect(r.renewing?.to).toBe(N1);
		expect(fs.statSync(m.original).mode & 0o200).toBe(0o200);
	});

	it("[QK:RENEW-REC-ABORT-SAVES-THEN-CLEARS] an unreserved attempt is aborted only after the agreed body is saved and read back; the leaving chapter is current again", async () => {
		const m = await midRenew(false);
		const save = path.join(m.base, "saved-outline.md");
		expect(run(m, { kind: "abort", saveOutline: save })).toMatchObject({ kind: "aborted", from: N0, savedAt: save });
		expect(fs.readFileSync(save, "utf8")).toBe(BODY);
		const r = record(m);
		expect(r.renewing).toBeUndefined();
		expect(r.nativeSessionId).toBe(N0);
	});

	it("[QK:RENEW-REC-ABORT-KEEPS-MARK-WHEN-UNSAVED] when the body cannot be saved, or the leaving original does not read as that chapter, the mark stays", async () => {
		const m = await midRenew(false);
		const marked = bytes(m.recordPath);
		const taken = path.join(m.base, "taken.md");
		fs.writeFileSync(taken, "이미 있는 파일");
		expect(run(m, { kind: "abort", saveOutline: taken })).toMatchObject({ kind: "refused", code: "outline-not-saved" });
		expect(fs.readFileSync(taken, "utf8")).toBe("이미 있는 파일");
		fs.writeFileSync(m.original, header(N1));
		expect(run(m, { kind: "abort", saveOutline: path.join(m.base, "x.md") })).toMatchObject({
			kind: "refused",
			code: "original-unverified",
		});
		expect(bytes(m.recordPath).equals(marked)).toBe(true);
	});

	it("[QK:RENEW-REC-PLAN-MATCHES-RESERVATION] a reserved chapter is never aborted and an unreserved attempt is never continued", async () => {
		const reserved = await midRenew(true);
		const r0 = bytes(reserved.recordPath);
		expect(run(reserved, { kind: "abort", saveOutline: path.join(reserved.base, "s.md") })).toMatchObject({
			kind: "refused",
			code: "reserved",
		});
		expect(bytes(reserved.recordPath).equals(r0)).toBe(true);
		const open = await midRenew(false);
		const o0 = bytes(open.recordPath);
		expect(run(open, { kind: "continue", file: open.reserved })).toMatchObject({ kind: "refused", code: "unreserved" });
		expect(bytes(open.recordPath).equals(o0)).toBe(true);
	});

	it("[QK:RENEW-REC-LIVE-OWNER-NOTHING] a live owner is never recovered: nothing is saved, handed over or written", async () => {
		const m = await midRenew(false, "live");
		const marked = bytes(m.recordPath);
		const save = path.join(m.base, "never.md");
		expect(run(m, { kind: "abort", saveOutline: save })).toMatchObject({ kind: "refused", code: "owner-not-dead" });
		expect(fs.existsSync(save)).toBe(false);
		expect(bytes(m.recordPath).equals(marked)).toBe(true);
	});

	it("[QK:RENEW-REC-SAVE-NAMED-ON-REFUSAL] a hand-over refused after the body was saved leaves the record unchanged and names the verified save file it already wrote", async () => {
		const m = await midRenew(false, "live");
		const marked = bytes(m.recordPath);
		let calls = 0;
		const facts = (owner: { startKey: string }) =>
			++calls === 1 ? { currentStartKey: "", pidExists: false } : { currentStartKey: owner.startKey, pidExists: true };
		const save = path.join(m.base, "saved-before-refusal.md");
		const out = run(m, { kind: "abort", saveOutline: save }, { _test_ownerFacts: facts });
		expect(out).toMatchObject({ kind: "refused", code: "owner-not-dead", saved: { path: save, state: "verified" } });
		expect(fs.readFileSync(save, "utf8")).toBe(BODY);
		expect(bytes(m.recordPath).equals(marked)).toBe(true);
	});

	it("[QK:RENEW-REC-STOP-READS-RECORD-BACK] a stop after the hand-over carries what the record says now: still renewing, already committed or already open", async () => {
		// a read error on the second file check, after the hand-over
		const unreadable = await midRenew(true);
		const chmodAfterHandOver = {
			after: () => {
				if (!fs.existsSync(`${unreadable.reserved}.done`)) {
					fs.chmodSync(unreadable.reserved, 0o000);
					fs.writeFileSync(`${unreadable.reserved}.done`, "");
				}
			},
		};
		const a = run(
			unreadable,
			{ kind: "continue", file: unreadable.reserved },
			{ _test_lockedWrite: chmodAfterHandOver },
		);
		fs.chmodSync(unreadable.reserved, 0o644);
		expect(a).toMatchObject({
			kind: "stopped",
			code: "file-changed",
			record: { state: "renewing", to: N1 },
			ownerPid: process.pid,
		});
		// the commit is written, then the write path throws
		const throwOnSecond = () => {
			let k = 0;
			return {
				after: () => {
					if (++k === 2) throw new Error("after the write");
				},
			};
		};
		const committed = await midRenew(true);
		const b = run(committed, { kind: "continue", file: committed.reserved }, { _test_lockedWrite: throwOnSecond() });
		expect(b).toMatchObject({ kind: "stopped", code: "commit-failed", record: { state: "committed", current: N1 } });
		// the clear is written, then the write path throws; the save file is still named
		const cleared = await midRenew(false);
		const save = path.join(cleared.base, "saved.md");
		const c = run(cleared, { kind: "abort", saveOutline: save }, { _test_lockedWrite: throwOnSecond() });
		expect(c).toMatchObject({
			kind: "stopped",
			code: "clear-failed",
			record: { state: "open" },
			saved: { path: save, state: "verified" },
		});
	});
});
