/**
 * #107 rail 2c: the production process adapter, proven beside it (T1).
 *
 * The child is a node fixture, never ssh: these cells say what the adapter does with A child (no
 * shell, separate streams, the bound and its cleanup), not what ssh does. ssh's own behavior and a
 * real host stay T3.
 */
import { describe, expect, it } from "vitest";
import { classifyRemoteReceipt } from "./remote-pair-send.ts";
import { processTransport } from "./remote-pair-transport.ts";

const node = process.execPath;

function alive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}

describe("the process transport", () => {
	it("[QK:REMOTE-TRANSPORT-NO-SHELL-SEPARATE-STREAMS] runs argv without a shell, writes stdin once, and keeps stdout, stderr and the exit code apart", async () => {
		const script =
			"let i='';process.stdin.on('data',d=>i+=d).on('end',()=>{" +
			"process.stdout.write(JSON.stringify({argv:process.argv.slice(1),stdin:i})+'\\n');" +
			"process.stderr.write('to-stderr');process.exit(3);})";
		const r = await processTransport.run([node, "-e", script, "$(echo injected)", "a b"], "claim-bytes", 10_000);
		expect(r.timedOut).toBe(false);
		expect(r.exitCode).toBe(3);
		expect(r.signal).toBeNull();
		expect(JSON.parse(r.stdout)).toEqual({ argv: ["$(echo injected)", "a b"], stdin: "claim-bytes" });
		expect(r.stderr).toBe("to-stderr");
	});

	it("[QK:REMOTE-TRANSPORT-TIMEOUT-REAPS-OWN-CHILD] at the bound it ends its own child, escalating past an ignored TERM, and reports a timeout the receipt reads as indeterminate", async () => {
		const script = "process.on('SIGTERM',()=>{});process.stdout.write(String(process.pid));setInterval(()=>{},1000);";
		const t0 = Date.now();
		const r = await processTransport.run([node, "-e", script], "", 300);
		const pid = Number(r.stdout);
		try {
			expect(r.timedOut).toBe(true);
			expect(r.signal).toBe("SIGKILL");
			expect(Number.isInteger(pid) && pid > 0).toBe(true);
			expect(alive(pid)).toBe(false);
			expect(Date.now() - t0).toBeLessThan(8000);
			expect(classifyRemoteReceipt(r).kind).toBe("remote-indeterminate");
		} finally {
			// The test owns this fixture child: never leave it behind, even when an assertion fails.
			if (Number.isInteger(pid) && pid > 0 && alive(pid)) process.kill(pid, "SIGKILL");
		}
	}, 15_000);

	it("[QK:REMOTE-TRANSPORT-HELD-PIPES-STILL-SETTLE] when a descendant still holds the pipes after the child is gone, the send settles as a timeout without touching that descendant", async () => {
		// The child starts a grandchild that inherits stdout/stderr, prints its pid, and lingers; the
		// grandchild ends itself after 20s so no sleeper outlives the test even if cleanup is skipped.
		const grandchild = "setTimeout(()=>process.exit(0),20000);setInterval(()=>{},1000);";
		const script =
			"const c=require('child_process').spawn(process.execPath,['-e'," +
			JSON.stringify(grandchild) +
			"],{stdio:['ignore','inherit','inherit']});" +
			"process.stdout.write(String(c.pid));setInterval(()=>{},1000);";
		const t0 = Date.now();
		const r = await processTransport.run([node, "-e", script], "", 300);
		const holder = Number(r.stdout);
		try {
			expect(r.timedOut).toBe(true);
			expect(Date.now() - t0).toBeLessThan(10_000);
			expect(classifyRemoteReceipt(r).kind).toBe("remote-indeterminate");
			// Not ours to end: the transport closed its own read ends and left the holder alone.
			expect(Number.isInteger(holder) && holder > 0 && alive(holder)).toBe(true);
		} finally {
			if (Number.isInteger(holder) && holder > 0 && alive(holder)) process.kill(holder, "SIGKILL");
		}
	}, 20_000);

	it("[QK:REMOTE-TRANSPORT-SPAWN-FAILURE-INDETERMINATE] a child that cannot start is reported, not thrown, and reads as indeterminate", async () => {
		const r = await processTransport.run(["/nonexistent/remote-pair-ssh"], "x", 5_000);
		expect(r.exitCode).toBeNull();
		expect(r.stderr).toMatch(/spawn failed/);
		expect(classifyRemoteReceipt(r)).toMatchObject({
			kind: "remote-indeterminate",
			why: expect.stringMatching(/did not start \(spawn failed\)/),
		});
	});
});
