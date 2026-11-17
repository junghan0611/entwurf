/**
 * entwurf-control — a confirmed /renew carried out end to end through the REAL registered handler
 * (#151 b3-2; C1.2 §2, C1.4·a·b·d, C1.4j/k/l).
 *
 * Production subject: entwurf-control's /renew handler, its before-switch guard and its session_start
 * re-bind, with lib/renew-transition.ts and the b2 writer, loaded with Pi's REAL loader into a
 * throwaway store (test/helpers/entwurf-control-transition-harness.mjs). The command ctx's newSession
 * is a stub that follows the SDK's order; the new chapter's file is a real JSONL file and the control
 * socket is the extension's own. Oracles: the store on disk, the new file's bytes, the leaving
 * original's mode, the v2 lock file and the handlers' returned values. Pi's own runner, a real model
 * and ACP are not exercised here (those are the isolated-Pi measurement).
 */
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..");
const HARNESS = path.join(REPO, "test", "helpers", "entwurf-control-transition-harness.mjs");
const EXTENSION = path.join(HERE, "entwurf-control.ts");
const N0 = "01900000-0000-7000-8000-0000000151a0";
const N1 = "01900000-0000-7000-8000-0000000151a1";

type Result = { returned: unknown } | { threw: string };
interface Attempt {
	results: Result[];
	lines: string[];
}
interface Run {
	errors: string[];
	gardenBefore: string | null;
	body: string;
	outsideDuringFlight?: Result[];
	ownSwitchAdmission?: Result[];
	record: {
		gardenId: string;
		nativeSessionId: string;
		renewing: { from: string; to: string | null } | null;
		chapters: string[];
		outlineBody: string | null;
		outlineFor: string | null;
	} | null;
	newFile: string | null;
	recordCount: number;
	leavingOriginalMode: number;
	targetLockLeft: boolean | null;
	resultLines: string[];
	afterStop: Attempt;
	escapedAfter: Attempt | null;
	newSessionCalls?: number;
}

const root = fs.mkdtempSync(path.join(os.tmpdir(), "et-"));
const runs: Record<string, Run> = {};
function harness(scenario: string): Run {
	const base = path.join(root, scenario);
	const home = path.join(base, "h");
	const cwd = path.join(base, "c");
	fs.mkdirSync(cwd, { recursive: true });
	const result = spawnSync(process.execPath, [HARNESS, EXTENSION, cwd], {
		cwd: REPO,
		encoding: "utf8",
		timeout: 60_000,
		env: {
			PATH: process.env.PATH,
			HOME: home,
			PI_CODING_AGENT_DIR: path.join(home, ".pi", "agent"),
			SCENARIO: scenario,
		},
	});
	if (result.status !== 0)
		throw new Error(`harness(${scenario}) exited ${result.status}: ${result.stdout}\n${result.stderr}`);
	return JSON.parse(result.stdout.trim().split("\n").at(-1) as string) as Run;
}
// Seven child processes in sequence: the default 10 s hook limit was measured too short under load.
beforeAll(() => {
	for (const s of ["commit", "cancel", "double", "mismatch", "token", "escaped", "concurrent"]) runs[s] = harness(s);
}, 180_000);
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

/** The user messages of a JSONL file whose text is exactly `body`. */
function bodyCount(file: string, body: string): number {
	return file
		.split("\n")
		.filter((l) => l.trim() !== "")
		.map((l) => JSON.parse(l) as { type?: string; message?: { role?: string; content?: { text?: string }[] } })
		.filter((e) => e.type === "message" && e.message?.role === "user")
		.filter((e) => (e.message?.content ?? []).map((c) => c.text ?? "").join("") === body).length;
}

describe("a confirmed /renew, end to end (#151 b3-2)", () => {
	it("every harness run ran the real handlers without an unexpected error", () => {
		for (const r of Object.values(runs)) expect(r.errors).toEqual([]);
	});

	it("[QK:RENEW-B32-SAME-GARDEN-AND-LINEAGE] the commit keeps the garden, moves the current chapter to the new one and records the leaving chapter and the agreed outline", () => {
		const r = runs.commit;
		expect(r.record).toEqual({
			gardenId: r.gardenBefore,
			nativeSessionId: N1,
			renewing: null,
			chapters: [N0],
			outlineBody: r.body,
			outlineFor: N1,
		});
	});

	it("[QK:RENEW-B32-REBIND-NO-NEW-BIRTH] the new chapter re-binds the same garden — its listener answers for it, so the commit lands — and no second record is minted", () => {
		expect(runs.commit.recordCount).toBe(1);
		expect(runs.commit.record?.nativeSessionId).toBe(N1);
		expect(runs.commit.resultLines.some((l) => l.includes("goes on in a new chapter"))).toBe(true);
	});

	it("[QK:RENEW-B32-NEW-FILE-CARRIES-BODY-ONCE] the new chapter's file names the new chapter and carries the agreed body exactly once", () => {
		const r = runs.commit;
		expect(r.newFile).not.toBeNull();
		const header = JSON.parse((r.newFile as string).split("\n")[0] as string) as { type: string; id: string };
		expect(header).toMatchObject({ type: "session", id: N1 });
		expect(bodyCount(r.newFile as string, r.body)).toBe(1);
	});

	it("[QK:RENEW-B32-OWN-SWITCH-ONLY] while the transition is in flight only its own switch passes; a switch from outside its permit's context is cancelled", () => {
		expect(runs.commit.ownSwitchAdmission).toEqual([{ returned: null }]);
		expect(runs.commit.outsideDuringFlight).toEqual([{ returned: { cancel: true } }]);
	});

	it("[QK:RENEW-B32-W2-AND-LOCK] the commit takes only the write bits off the leaving original and releases the garden's v2 lock", () => {
		expect(runs.commit.leavingOriginalMode & 0o222).toBe(0);
		expect(runs.commit.leavingOriginalMode & 0o444).toBe(0o444);
		expect(runs.commit.targetLockLeft).toBe(false);
	});

	it("[QK:RENEW-B32-CANCEL-CLEARS-WHEN-OBSERVED] a switch cancelled after admission, with the old chapter observed live, clears the K1 mark and is named by what was observed", () => {
		const r = runs.cancel;
		expect(r.record).toMatchObject({ nativeSessionId: N0, renewing: null, chapters: [] });
		expect(
			r.resultLines.some((l) => l.includes("renew-switch-cancelled-after-admission") && l.includes("K1 mark cleared")),
		).toBe(true);
		expect(r.targetLockLeft).toBe(false);
	});

	it("[QK:RENEW-B32-DOUBLE-BODY-NO-COMMIT] a new file carrying the agreed body twice is not committed; the record stays mid-/renew with its reservation", () => {
		const r = runs.double;
		expect(r.record).toMatchObject({ nativeSessionId: N0, renewing: { from: N0, to: N1 }, chapters: [] });
		expect(r.resultLines.some((l) => l.includes("renew-new-file-unverified") && l.includes("2 times"))).toBe(true);
		expect(r.leavingOriginalMode & 0o200).toBe(0o200);
	});

	it("[QK:RENEW-B32-COMMIT-SETTLES-FLIGHT] after a commit the flight is gone: an ordinary switch passes again", () => {
		expect(runs.commit.afterStop).toEqual({ results: [{ returned: null }], lines: [] });
	});

	it("[QK:RENEW-B32-STOPPED-FLIGHT-HELD] a transition that stopped unsettled keeps its flight: a later switch is refused as not admitted, not merely by the record", () => {
		expect(runs.double.afterStop.results).toEqual([{ returned: { cancel: true } }]);
		expect(runs.double.afterStop.lines.some((l) => l.includes("renew-switch-not-admitted"))).toBe(true);
	});

	it("[QK:RENEW-B32-STOPPED-PERMIT-CLOSED] when Pi cancels before the guard and the listener does not answer, the mark stays and the unused permit is closed: a continuation inside its context cannot pass", () => {
		const r = runs.escaped;
		expect(r.record).toMatchObject({ nativeSessionId: N0, renewing: { from: N0, to: null }, chapters: [] });
		expect(r.resultLines.some((l) => l.includes("renew-switch-cancelled-before-admission"))).toBe(true);
		expect(r.resultLines.some((l) => l.includes("K1 mark cleared"))).toBe(false);
		expect(r.resultLines.some((l) => l.includes("this Pi still holds the attempt (local, not the record)"))).toBe(true);
		expect(r.escapedAfter?.results).toEqual([{ returned: { cancel: true } }]);
		expect(r.escapedAfter?.lines.some((l) => l.includes("renew-switch-not-admitted"))).toBe(true);
	});

	it("[QK:RENEW-B32-FLIGHT-CLAIM-ATOMIC] of two confirmed effects that both entered before either claimed the flight, one carries the transition through and the other is refused without touching it", () => {
		const r = runs.concurrent;
		expect(r.record).toMatchObject({ nativeSessionId: N1, renewing: null, chapters: [N0] });
		expect(r.newSessionCalls).toBe(1);
		expect(r.resultLines.filter((l) => l.includes("renew-flight-exists")).length).toBe(1);
		expect(r.resultLines.filter((l) => l.includes("goes on in a new chapter")).length).toBe(1);
		expect(r.resultLines.some((l) => l.includes("target-locked"))).toBe(false);
	});

	it("[QK:RENEW-B32-MISMATCH-NO-BIRTH] a session that starts during the flight but is not the reserved chapter gets no address and no new garden; the transition does not commit", () => {
		const r = runs.mismatch;
		expect(r.recordCount).toBe(1);
		expect(r.record).toMatchObject({ nativeSessionId: N0, renewing: { from: N0, to: N1 }, chapters: [] });
		expect(r.resultLines.some((l) => l.includes("renew-flight-session-mismatch"))).toBe(true);
		expect(r.resultLines.some((l) => l.includes("renew-new-session-mismatch"))).toBe(true);
	});

	it("[QK:RENEW-B32-REBIND-NEEDS-TOKEN] the reserved chapter re-binds only under this renew's token; otherwise it gets no address and the transition stops on the listener", () => {
		const r = runs.token;
		expect(r.recordCount).toBe(1);
		expect(r.record).toMatchObject({ nativeSessionId: N0, renewing: { from: N0, to: N1 }, chapters: [] });
		expect(r.resultLines.some((l) => l.includes("/renew re-bind refused"))).toBe(true);
		expect(r.resultLines.some((l) => l.includes("renew-listener-not-bound"))).toBe(true);
	});
});
