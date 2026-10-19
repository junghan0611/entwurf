/**
 * remote-pair-transport — the production process adapter behind #107's `RemoteTransport` (rail 2c).
 *
 * One child per send: `spawn(argv[0], argv.slice(1))` with no shell, stdin written once and closed,
 * stdout and stderr captured separately. On the bound it signals ITS OWN child only (TERM, then KILL
 * after a short grace); if the pipes are still held after one more grace, it closes its own read ends
 * and settles as a timeout rather than waiting for a close that may never come. It is not a process manager: it tracks no
 * other process, scans nothing, and never retries. Classification belongs to
 * `classifyRemoteReceipt`; this module only reports what the child did.
 */

import { spawn } from "node:child_process";
import type { RemoteTransport, RemoteTransportResult } from "./remote-pair-send.ts";

const CAPTURE_CAP = 64 * 1024;
const KILL_GRACE_MS = 2000;
const FINAL_GRACE_MS = 2000;

function capped(chunks: Buffer[], size: { n: number }, chunk: Buffer): void {
	if (size.n >= CAPTURE_CAP) return;
	const room = CAPTURE_CAP - size.n;
	const piece = chunk.length > room ? chunk.subarray(0, room) : chunk;
	chunks.push(piece);
	size.n += piece.length;
}

export const processTransport: RemoteTransport = {
	run(argv, stdin, timeoutMs): Promise<RemoteTransportResult> {
		return new Promise((resolve) => {
			const out: Buffer[] = [];
			const err: Buffer[] = [];
			const outN = { n: 0 };
			const errN = { n: 0 };
			let timedOut = false;
			let spawnError: string | null = null;
			let settled = false;
			const child = spawn(argv[0], argv.slice(1), { shell: false, stdio: ["pipe", "pipe", "pipe"] });
			let killTimer: NodeJS.Timeout | undefined;
			let finalTimer: NodeJS.Timeout | undefined;
			const settle = (code: number | null, signal: NodeJS.Signals | null): void => {
				if (settled) return;
				settled = true;
				clearTimeout(bound);
				if (killTimer) clearTimeout(killTimer);
				if (finalTimer) clearTimeout(finalTimer);
				const stderr = Buffer.concat(err).toString("utf8");
				resolve({
					exitCode: spawnError ? null : code,
					signal: spawnError ? null : signal,
					timedOut,
					stdout: Buffer.concat(out).toString("utf8"),
					stderr: spawnError ? `spawn failed: ${spawnError}${stderr ? `\n${stderr}` : ""}` : stderr,
				});
			};
			const bound = setTimeout(() => {
				timedOut = true;
				child.kill("SIGTERM");
				killTimer = setTimeout(() => {
					child.kill("SIGKILL");
					// Something else may still hold our stdout/stderr pipes (an inherited descendant,
					// an ssh ControlMaster). We do not chase it: after one more grace we close OUR read
					// ends and settle as a timeout, which the receipt reads as indeterminate.
					finalTimer = setTimeout(() => {
						child.stdout.destroy();
						child.stderr.destroy();
						settle(child.exitCode, child.signalCode);
					}, FINAL_GRACE_MS);
				}, KILL_GRACE_MS);
			}, timeoutMs);
			child.stdout.on("data", (c: Buffer) => capped(out, outN, c));
			child.stderr.on("data", (c: Buffer) => capped(err, errN, c));
			child.on("error", (e) => {
				spawnError = e.message;
			});
			// A child that exits before reading stdin closes the pipe; that is its outcome, not ours.
			child.stdin.on("error", () => {});
			child.on("close", (code, signal) => settle(code, signal));
			child.stdin.end(stdin);
		});
	},
};
