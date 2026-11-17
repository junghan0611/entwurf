/**
 * entwurf-control — the registered before-switch / before-fork admission (#151 b3; C1.4c D2·D3,
 * C1.4e D2, C1.4j).
 *
 * Production subject: the REAL registered handlers, loaded with Pi's REAL loader into a throwaway
 * store (test/helpers/entwurf-control-admission-harness.mjs). Oracle: what each handler RETURNS —
 * Pi cancels only on a returned `{cancel: true}`; a throw is logged and the switch carries on
 * (runner.js 821-846). Pi's runner and an actual switch are not exercised here.
 */
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..");
const HARNESS = path.join(REPO, "test", "helpers", "entwurf-control-admission-harness.mjs");
const EXTENSION = path.join(HERE, "entwurf-control.ts");

type Result = { returned: unknown } | { threw: string };
interface HarnessOut {
	errors: string[];
	clean: { newSwitch: Result[]; resume: Result[] };
	reserved: { resume: Result[]; stillPlain: Result[] };
	renewing: { newSwitch: Result[]; fork: Result[] };
	notifyFails: Result[];
	notifyFailureLines: string[];
	bothFail: Result[];
	scopes: { newSwitch: Result[]; fork: Result[]; resume: Result[] };
	defect: Result[];
	notices: string[];
}
const CANCEL = [{ returned: { cancel: true } }];
const PASS = [{ returned: null }];

let root = "";
let out: HarnessOut;
beforeAll(() => {
	root = fs.mkdtempSync(path.join(os.tmpdir(), "ea-"));
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

describe("before-switch admission (#151 b3)", () => {
	it("the harness ran the real handlers without an unexpected error", () => {
		expect(out.errors).toEqual([]);
	});

	it("[QK:RENEW-B3-GUARD-CLEAN-PASSES] with nothing mid-/renew and nothing claimed, a new switch and an ordinary resume pass", () => {
		expect(out.clean.newSwitch).toEqual(PASS);
		expect(out.clean.resume).toEqual(PASS);
	});

	it("[QK:RENEW-B3-GUARD-RESUME-RESERVED] a resume to a file of another garden's reserved next chapter is cancelled; an ordinary one still passes", () => {
		expect(out.reserved.resume).toEqual(CANCEL);
		expect(out.reserved.stillPlain).toEqual(PASS);
	});

	it("[QK:RENEW-B3-GUARD-RENEWING-CANCELS] while this garden is mid-/renew, a new switch and a fork are cancelled", () => {
		expect(out.renewing.newSwitch).toEqual(CANCEL);
		expect(out.renewing.fork).toEqual(CANCEL);
		expect(out.notices.some((n) => n.includes("renew-in-progress"))).toBe(true);
	});

	it("[QK:RENEW-B3-GUARD-NOTICE-FAILS-STILL-CANCELS] a notice that throws does not undo the returned cancel", () => {
		expect(out.notifyFails).toEqual(CANCEL);
	});

	it("[QK:RENEW-B3-GUARD-NOTICE-FAILURE-LOGGED] a notice's own failure is said once on stderr; with stderr failing too, the cancel stands and nothing throws", () => {
		expect(out.notifyFailureLines).toHaveLength(1);
		expect(out.notifyFailureLines[0]).toMatch(/notice of a cancelled session switch failed: harness: notify failed/);
		expect(out.bothFail).toEqual(CANCEL);
	});

	it("[QK:RENEW-B3-GUARD-SCOPES] with no resident garden a /new and a fork do not read the store, while a resume's target protection still does", () => {
		expect(out.scopes.newSwitch).toEqual(PASS);
		expect(out.scopes.fork).toEqual(PASS);
		expect(out.scopes.resume).toEqual(CANCEL);
	});

	it("[QK:RENEW-B3-GUARD-ERROR-CANCELS] an error inside the decision (a store defect) is a returned cancel, never a throw", () => {
		expect(out.defect).toEqual(CANCEL);
		expect(out.notices.some((n) => n.includes("renew-admission-error"))).toBe(true);
	});
});
