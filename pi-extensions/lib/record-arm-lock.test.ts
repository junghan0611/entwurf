/**
 * record-arm-lock — the one record-arm lock hold (#151 b1/b2): its synchronous-write contract.
 *
 * Production subject: `withRecordArmLock`. Oracle: the lock file on disk and the thrown error. The
 * hold's other outcomes (busy, primitive throw, release faults, the claim held across the write)
 * are pinned through the pi birth in pi-citizen-birth.test.ts.
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { withRecordArmLock } from "./record-arm-lock.ts";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "ral-"));
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));
const GARDEN = "20261117T000000-0b2b2b";

describe("record-arm lock hold (#151 b2)", () => {
	it("[QK:RENEW-B2-LOCKED-WRITE-SYNC] a write that returns a promise is an error with the lock released, never a write the hold vouches for", () => {
		const dir = path.join(root, "locks");
		const asyncWrite = (async () => ({ path: "x" })) as unknown as () => { path: string };
		expect(() => withRecordArmLock(GARDEN, dir, "once", asyncWrite, { describeWritten: (w) => w.path })).toThrow(
			/must be synchronous/,
		);
		expect(fs.existsSync(path.join(dir, `${GARDEN}.lock`))).toBe(false);
	});
});
