/**
 * renew-admission — what a switch target is to the /renew lineage (#151 b3; C1.4c D2, C1.4e D2).
 *
 * Production subject: `classifySwitchTarget` and `isRenewing`. Fixtures are made with the real
 * pi birth and the real b2 writer (a committed renew, a reserved next chapter) in throwaway stores.
 * Oracles: the verdict and its code, the file system's own inode facts (cp vs hard link), and a
 * FIFO target classified in an isolated child under a time limit.
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { birthPiCitizen } from "./pi-citizen-birth.ts";
import { classifySwitchTarget, isRenewing } from "./renew-admission.ts";
import { commitRenew, reserveRenewTo, writeRenewStart } from "./renew-writer.ts";

const SAVED = {
	agent: process.env.PI_CODING_AGENT_DIR,
	sessions: process.env.ENTWURF_META_SESSIONS_DIR,
	receivers: process.env.ENTWURF_META_RECEIVERS_DIR,
};
let root = "";
beforeAll(() => {
	root = fs.mkdtempSync(path.join(os.tmpdir(), "radm-"));
	process.env.PI_CODING_AGENT_DIR = path.join(root, "env-agent");
	delete process.env.ENTWURF_META_SESSIONS_DIR;
	delete process.env.ENTWURF_META_RECEIVERS_DIR;
});
afterAll(() => {
	for (const [key, value] of [
		["PI_CODING_AGENT_DIR", SAVED.agent],
		["ENTWURF_META_SESSIONS_DIR", SAVED.sessions],
		["ENTWURF_META_RECEIVERS_DIR", SAVED.receivers],
	] as const) {
		if (value === undefined) delete process.env[key];
		else process.env[key] = value;
	}
	fs.rmSync(root, { recursive: true, force: true });
});

const FIFO_CHILD = path.join(
	path.dirname(fileURLToPath(import.meta.url)),
	"..",
	"..",
	"test",
	"helpers",
	"renew-admission-fifo-child.mjs",
);
const N0 = "01900000-0000-7000-8000-0000000151d0";
const N1 = "01900000-0000-7000-8000-0000000151d1";
const M0 = "01900000-0000-7000-8000-0000000151e0";
const M1 = "01900000-0000-7000-8000-0000000151e1";
const FREE = "01900000-0000-7000-8000-0000000151f9";
const OUTLINE = "이 글은 이전 장 에이전트가 작성하고 GLG가 전달 판본을 확인한 기억의 얼개다.";
const header = (id: string): string =>
	JSON.stringify({ type: "session", version: 3, id, timestamp: "2026-11-01T00:00:00.000Z", cwd: "/tmp" });
const sha256 = (s: string): string => createHash("sha256").update(s, "utf8").digest("hex");

let seq = 0;
interface Store {
	base: string;
	sessionsDir: string;
	locksDir: string;
}
function store(): Store {
	const base = path.join(root, `s${++seq}`);
	fs.mkdirSync(base, { recursive: true });
	return { base, sessionsDir: path.join(base, "meta-sessions"), locksDir: path.join(base, "meta-record-arm-locks") };
}
function file(s: Store, name: string, firstLine: string): string {
	const f = path.join(s.base, name);
	fs.writeFileSync(f, `${firstLine}\n`, { mode: 0o600 });
	return f;
}
function birth(s: Store, native: string, transcript?: string): string {
	return birthPiCitizen({
		nativeSessionId: native,
		cwd: "/tmp",
		transcriptPath: transcript,
		sessionsDir: s.sessionsDir,
		recordArmLocksDir: s.locksDir,
		controlSocketDir: path.join(s.base, "sockets"),
	}).gardenId;
}
/** A store with one committed renew (N0 closed, N1 current) and one renew reserved at M1. The
 * closed original lives in its own `orig/` directory so a cell can make it unreadable. */
function lineage(): { s: Store; closedOriginal: string } {
	const s = store();
	fs.mkdirSync(path.join(s.base, "orig"));
	const closedOriginal = file(s, path.join("orig", "n0.jsonl"), header(N0));
	const g = birth(s, N0, closedOriginal);
	const t = { gardenId: g, token: "c".repeat(32), sessionsDir: s.sessionsDir, recordArmLocksDir: s.locksDir };
	writeRenewStart({ ...t, expectedNative: N0, outline: OUTLINE, precondition: () => undefined });
	reserveRenewTo({ ...t, from: N0, to: N1 });
	commitRenew({
		...t,
		from: N0,
		to: N1,
		expectedOutlineSha: sha256(OUTLINE),
		newTranscriptPath: file(s, "n1.jsonl", header(N1)),
	});
	const h = birth(s, M0, file(s, "m0.jsonl", header(M0)));
	const u = { gardenId: h, token: "d".repeat(32), sessionsDir: s.sessionsDir, recordArmLocksDir: s.locksDir };
	writeRenewStart({ ...u, expectedNative: M0, outline: OUTLINE, precondition: () => undefined });
	reserveRenewTo({ ...u, from: M0, to: M1 });
	return { s, closedOriginal };
}

describe("switch admission targets (#151 b3)", () => {
	it("[QK:RENEW-B3-ADMIT-CLOSED-COPY] a copy of a closed chapter (another inode, the same session id) is refused", () => {
		const { s, closedOriginal } = lineage();
		const copy = path.join(s.base, "copy-of-n0.jsonl");
		fs.copyFileSync(closedOriginal, copy);
		expect(fs.statSync(copy).ino).not.toBe(fs.statSync(closedOriginal).ino);
		expect(classifySwitchTarget(copy, s.sessionsDir)).toMatchObject({
			kind: "cancel",
			code: "renew-admission-closed-chapter",
		});
		expect(classifySwitchTarget(closedOriginal, s.sessionsDir)).toMatchObject({ kind: "cancel" });
	});

	it("[QK:RENEW-B3-ADMIT-RESERVED-COPY] a session file of another garden's reserved next chapter is refused", () => {
		const { s } = lineage();
		const reservedFile = file(s, "m1-somewhere.jsonl", header(M1));
		expect(classifySwitchTarget(reservedFile, s.sessionsDir)).toMatchObject({
			kind: "cancel",
			code: "renew-admission-reserved-to",
		});
	});

	it("[QK:RENEW-B3-ADMIT-CLOSED-INODE] the very file of a closed original is refused by inode even when its header no longer reads", () => {
		const { s, closedOriginal } = lineage();
		const link = path.join(s.base, "link-to-n0.jsonl");
		fs.linkSync(closedOriginal, link);
		fs.chmodSync(closedOriginal, 0o600);
		fs.writeFileSync(closedOriginal, "not a session header\n"); // same inode: the link sees it too
		expect(fs.statSync(link).ino).toBe(fs.statSync(closedOriginal).ino);
		expect(classifySwitchTarget(link, s.sessionsDir)).toMatchObject({
			kind: "cancel",
			code: "renew-admission-closed-original",
		});
	});

	it("[QK:RENEW-B3-ADMIT-UNIDENTIFIABLE] an unidentified target is refused while any closed or reserved claim exists, and passes in a store with none", () => {
		const { s } = lineage();
		const notYetCopied = path.join(s.base, "import-destination.jsonl");
		expect(classifySwitchTarget(notYetCopied, s.sessionsDir)).toMatchObject({
			kind: "cancel",
			code: "renew-admission-target-unidentifiable",
		});
		const garbled = file(s, "garbled.jsonl", "{not json");
		expect(classifySwitchTarget(garbled, s.sessionsDir)).toMatchObject({
			kind: "cancel",
			code: "renew-admission-target-unidentifiable",
		});
		const plain = store();
		birth(plain, N0, file(plain, "n0.jsonl", header(N0)));
		expect(classifySwitchTarget(path.join(plain.base, "import-destination.jsonl"), plain.sessionsDir)).toEqual({
			kind: "pass",
		});
	});

	it("[QK:RENEW-B3-ADMIT-PLAIN-PASS] an ordinary session file passes, and so does any target when there is no store at all", () => {
		const { s } = lineage();
		expect(classifySwitchTarget(file(s, "free.jsonl", header(FREE)), s.sessionsDir)).toEqual({ kind: "pass" });
		const none = store();
		expect(classifySwitchTarget(path.join(none.base, "anything.jsonl"), none.sessionsDir)).toEqual({ kind: "pass" });
		expect(fs.existsSync(none.sessionsDir)).toBe(false);
	});

	it("[QK:RENEW-B3-ADMIT-RESERVED-ONLY-IMPORT] with no closed chapter anywhere, one garden's reserved next chapter still refuses an unidentified import target", () => {
		const s = store();
		const g = birth(s, M0, file(s, "m0.jsonl", header(M0)));
		const t = { gardenId: g, token: "d".repeat(32), sessionsDir: s.sessionsDir, recordArmLocksDir: s.locksDir };
		writeRenewStart({ ...t, expectedNative: M0, outline: OUTLINE, precondition: () => undefined });
		reserveRenewTo({ ...t, from: M0, to: M1 });
		expect(classifySwitchTarget(path.join(s.base, "import-destination.jsonl"), s.sessionsDir)).toMatchObject({
			kind: "cancel",
			code: "renew-admission-target-unidentifiable",
		});
	});

	it("[QK:RENEW-B3-ADMIT-IO-TARGET-THROWS] a target that cannot be opened (EACCES) is an error, not an absence — even in a store with nothing to protect; a known absence stays an absence", () => {
		// A target the process may not open (EACCES), in a store with no claim: not a pass.
		const plain = store();
		birth(plain, N0, file(plain, "n0.jsonl", header(N0)));
		// The FILE is unreadable while its directory is not: open fails (EACCES) yet stat succeeds, so
		// only the open's own error can make this a throw.
		const hidden = file(plain, "unreadable.jsonl", header(FREE));
		fs.chmodSync(hidden, 0o000);
		try {
			expect(fs.statSync(hidden).isFile()).toBe(true);
			expect(() => classifySwitchTarget(hidden, plain.sessionsDir)).toThrow(/EACCES/);
		} finally {
			fs.chmodSync(hidden, 0o600);
		}
		// A known absence stays an absence.
		expect(classifySwitchTarget(path.join(plain.base, "not-there.jsonl"), plain.sessionsDir)).toEqual({ kind: "pass" });
	});

	it('[QK:RENEW-B3-ADMIT-IO-ORIGINAL-THROWS] a closed original that cannot be stat\'d (EACCES) is an error, not "no inode to match" — an identified free target is not passed over it', () => {
		const { s } = lineage();
		const free = file(s, "free.jsonl", header(FREE));
		const origDir = path.join(s.base, "orig");
		fs.chmodSync(origDir, 0o000);
		try {
			expect(() => classifySwitchTarget(free, s.sessionsDir)).toThrow(/EACCES/);
		} finally {
			fs.chmodSync(origDir, 0o755);
		}
	});

	it("[QK:RENEW-B3-ADMIT-FIFO-NO-WAIT] a FIFO target is answered at once (unidentified while a claim exists), never waited on", () => {
		const s = store();
		const r = spawnSync(process.execPath, [FIFO_CHILD, s.base], {
			encoding: "utf8",
			timeout: 15_000,
			env: { PATH: process.env.PATH, HOME: s.base, PI_CODING_AGENT_DIR: path.join(s.base, "agent") },
		});
		expect(r.error?.message ?? null).toBeNull();
		expect(r.status).toBe(0);
		expect(JSON.parse(r.stdout.trim().split("\n").at(-1) as string)).toMatchObject({
			kind: "cancel",
			code: "renew-admission-target-unidentifiable",
		});
	});

	it("[QK:RENEW-B3-ADMIT-IS-RENEWING] isRenewing reads the garden's own record: false when open, true once K1 is written", () => {
		const s = store();
		const g = birth(s, N0, file(s, "n0.jsonl", header(N0)));
		expect(isRenewing(g, s.sessionsDir)).toBe(false);
		writeRenewStart({
			gardenId: g,
			token: "c".repeat(32),
			sessionsDir: s.sessionsDir,
			recordArmLocksDir: s.locksDir,
			expectedNative: N0,
			outline: OUTLINE,
			precondition: () => undefined,
		});
		expect(isRenewing(g, s.sessionsDir)).toBe(true);
	});
});
