/**
 * #160 S5 SOL D1: the production native-push runner's deadline, proven beside the runner with a
 * real child process. The child is harmless and bounded on its own: it ignores SIGTERM, prints one
 * line, records each start in a temp file, and exits 0 by itself after a few seconds. Nothing here
 * touches a vendor CLI, a Gateway, the operator store or the network (Hard Rule 12).
 *
 * Oracle: wall-clock time and the exit code the caller sees, against the runner's declared bound
 * (timeoutMs + NATIVE_PUSH_TIMEOUT_OVERRUN_MS) — not the runner's own bookkeeping.
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { NATIVE_PUSH_KILL_GRACE_MS, NATIVE_PUSH_TIMEOUT_OVERRUN_MS, realNativePushRunner } from "./adapter.ts";
import { OPENCLAW_RUNNER_OVERRUN_MS } from "./openclaw-gateway.ts";

let dir: string;
beforeEach(() => {
	dir = fs.mkdtempSync(path.join(os.tmpdir(), "native-push-runner-"));
});
afterEach(() => {
	fs.rmSync(dir, { recursive: true, force: true });
});

/** Ignores SIGTERM, appends one start line to `starts`, prints `{"status":"started"}`, exits 0 after `exitAfterMs`. */
function stubbornChild(starts: string, exitAfterMs: number): string[] {
	const script = `process.on("SIGTERM", () => {});
require("node:fs").appendFileSync(${JSON.stringify(starts)}, "start\\n");
process.stdout.write(JSON.stringify({ status: "started" }));
setTimeout(() => process.exit(0), ${exitAfterMs});`;
	return [process.execPath, "-e", script];
}

describe("realNativePushRunner deadline", () => {
	it("[QK:NATIVE-PUSH-RUNNER-HARD-DEADLINE] a child that ignores SIGTERM and later exits 0 is reported 124 within the declared bound, run once", async () => {
		const starts = path.join(dir, "starts");
		const timeoutMs = 300;
		// The child would exit 0 on its own well after the bound; only the runner's SIGKILL ends it sooner.
		const exitAfterMs = timeoutMs + NATIVE_PUSH_KILL_GRACE_MS + 3000;
		const t0 = performance.now();
		const r = await realNativePushRunner.exec(stubbornChild(starts, exitAfterMs), { timeoutMs });
		const elapsed = performance.now() - t0;
		expect(r.code).toBe(124);
		// Lower edge: the runner waited for its deadline. Upper edge: the declared overrun plus
		// scheduling slack, and well short of the child's own exit.
		expect(elapsed).toBeGreaterThanOrEqual(timeoutMs);
		expect(elapsed).toBeLessThan(timeoutMs + NATIVE_PUSH_TIMEOUT_OVERRUN_MS + 1000);
		expect(elapsed).toBeLessThan(exitAfterMs);
		expect(fs.readFileSync(starts, "utf8")).toBe("start\n");
	});

	it("a child that finishes inside its deadline keeps its own exit code and output", async () => {
		const starts = path.join(dir, "starts");
		const r = await realNativePushRunner.exec(stubbornChild(starts, 50), { timeoutMs: 5000 });
		expect(r).toEqual({ code: 0, stdout: '{"status":"started"}', stderr: "" });
	});

	it("the OpenClaw budget counts the runner's overrun it cannot import", () => {
		expect(OPENCLAW_RUNNER_OVERRUN_MS).toBe(NATIVE_PUSH_TIMEOUT_OVERRUN_MS);
	});

	it("a program that cannot be spawned is 127, not a timeout", async () => {
		const r = await realNativePushRunner.exec([path.join(dir, "absent-program")], { timeoutMs: 5000 });
		expect(r.code).toBe(127);
	});
});
