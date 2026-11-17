/**
 * entwurf-control — the ordinary turn_end record refresh, as the /renew writer will meet it (#151 b1).
 *
 * The production subject is the REAL registered turn_end handler, loaded with Pi's REAL loader into a
 * throwaway store (test/helpers/entwurf-control-refresh-harness.mjs). Oracles: the store on disk,
 * the handler's stderr lines and the status calls it makes. Pi's own stale-ctx behaviour and a LIVE
 * session replacement are not exercised; this pins what the handler reads and writes.
 */
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..");
const HARNESS = path.join(REPO, "test", "helpers", "entwurf-control-refresh-harness.mjs");
const EXTENSION = path.join(HERE, "entwurf-control.ts");

interface HarnessOut {
	errors: string[];
	bridgeMissing: number;
	gardenId: string | null;
	readsEventSession: { n1Records: number; n0Transcript: string | null };
	lockBusy: { elapsedMs: number; lines: string[]; recordUnchanged: boolean };
	afterShutdownStatus: string[];
	otherFailure: string[];
}

let root = "";
let out: HarnessOut;
beforeAll(() => {
	// Short root: the control socket path has a ~107-byte ceiling.
	root = fs.mkdtempSync(path.join(os.tmpdir(), "ef-"));
	const home = path.join(root, "h");
	const cwd = path.join(root, "c");
	fs.mkdirSync(cwd, { recursive: true });
	const result = spawnSync(process.execPath, [HARNESS, EXTENSION, cwd], {
		cwd: REPO,
		encoding: "utf8",
		timeout: 30_000,
		env: { PATH: process.env.PATH, HOME: home, PI_CODING_AGENT_DIR: path.join(home, ".pi", "agent") },
	});
	if (result.status !== 0) throw new Error(`harness exited ${result.status}: ${result.stdout}\n${result.stderr}`);
	out = JSON.parse(result.stdout.trim().split("\n").at(-1) as string) as HarnessOut;
});
afterAll(() => {
	if (root) fs.rmSync(root, { recursive: true, force: true });
});

describe("the turn_end refresh (#151 b1)", () => {
	it("the harness ran the real handlers without an unexpected error", () => {
		expect(out.errors).toEqual([]);
		expect(out.gardenId).toMatch(/^\d{8}T\d{6}-[0-9a-f]{6}$/);
	});

	it("[QK:RENEW-B1-REFRESH-READS-EVENT-SESSION] a refresh whose session is replaced while it waits writes as the session it fired for", () => {
		// The event belonged to N0: its record takes N0's transcript, and no record is minted for N1.
		expect(out.readsEventSession.n1Records).toBe(0);
		expect(out.readsEventSession.n0Transcript).toMatch(/n0\.jsonl$/);
	});

	it("[QK:RENEW-B1-REFRESH-BUSY-IS-NAMED-SKIP] a held record-arm lock is the one named skip and the record does not move", () => {
		expect(out.lockBusy.recordUnchanged).toBe(true);
		expect(out.lockBusy.lines).toHaveLength(1);
		expect(out.lockBusy.lines[0]).toMatch(/^\[entwurf-control\] record-arm lock busy — this refresh skipped: /);
	});

	it("[QK:RENEW-B1-REFRESH-ONCE-DOES-NOT-WAIT] the refresh makes one attempt at a held lock — it does not hold the session for the 2 s bound session_start uses", () => {
		expect(out.lockBusy.elapsedMs).toBeLessThan(1_000);
	});

	it("[QK:RENEW-B1-REFRESH-OTHER-FAILURE-NOT-SKIP] any other refresh failure is reported as that failure, never as the busy skip", () => {
		expect(out.otherFailure).toHaveLength(1);
		expect(out.otherFailure[0]).toMatch(/^\[entwurf-control\] meta-record refresh failed: /);
		expect(out.otherFailure[0]).not.toMatch(/lock busy/);
	});

	it("[QK:RENEW-B1-REFRESH-STALE-WRITES-NO-STATE] a refresh still waiting at session_shutdown writes no status for the session that left", () => {
		expect(out.afterShutdownStatus).toEqual([]);
	});
});
