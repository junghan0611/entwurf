/**
 * socket-probe — single source of truth for control-socket liveness.
 *
 * Why this is a shared lib (not a per-file copy): the entwurf-control
 * extension (`pi-extensions/entwurf-control.ts`) AND the MCP bridge
 * (`mcp/entwurf-bridge/src/index.ts`) both probe `~/.pi/entwurf-control/*.sock`.
 * They used to carry independent `isSocketAlive` copies. If only one side
 * learned the three-valued classification the two probes would diverge — the
 * bridge routes a timeout target one way (mailbox fallback) while the
 * extension's GC reclaims the same socket. Both now consume this module so the
 * liveness semantics are identical on every surface. (0.11 Stage 0 step 4
 * plans a probe lib extraction anyway; this is its first slice.)
 *
 * Three-valued, not boolean — the F3 fix. A connect probe can mean three
 * different things, and collapsing them to a boolean is what let
 * `gcStaleSockets` permanently unlink a *live* socket that merely stalled
 * under load (→ every later probe sees it as dormant → live-session resume =
 * identity split). The cure: never destroy a socket we do not understand.
 *   - alive          → a listener accepted the connection (positive proof)
 *   - dead           → ECONNREFUSED / ENOENT only (positive proof of absence)
 *   - indeterminate  → timeout, EACCES, or any other/unknown error
 *                      (no proof either way — keep the file, hide from listing)
 */

import * as net from "node:net";

export type SocketLiveness = "alive" | "dead" | "indeterminate";

export const DEFAULT_PROBE_TIMEOUT_MS = 300;

/**
 * Pure classification of a connect-time error code into liveness. Only the two
 * codes that unambiguously mean "no live listener at this path" are dead:
 * ECONNREFUSED (socket file exists, nothing listening) and ENOENT (no socket
 * file). EVERYTHING else — EACCES, ETIMEDOUT, an undefined code, an unknown
 * code — is indeterminate. The default direction matters: when we don't know,
 * we do not destroy. (동결결정: "ECONNREFUSED/ENOENT만 dead", taken literally.)
 */
export function classifyConnectError(code: string | undefined): "dead" | "indeterminate" {
	return code === "ECONNREFUSED" || code === "ENOENT" ? "dead" : "indeterminate";
}

/**
 * GC policy: a stale-socket sweep may reclaim ONLY a demonstrably dead socket.
 * An indeterminate probe (timeout / unknown error) must survive the sweep —
 * reclaiming it is exactly the F3 live-session split. Alive obviously survives.
 */
export function shouldUnlinkOnGc(liveness: SocketLiveness): boolean {
	return liveness === "dead";
}

/**
 * Probe a control socket and classify it. Positive connect → alive; a
 * connect-time error is routed through `classifyConnectError`; a connect that
 * neither connects nor errors within `timeoutMs` → indeterminate (the load
 * stall case F3 is about — never coerced to dead).
 */
export async function probeSocketLiveness(
	socketPath: string,
	opts: { timeoutMs?: number } = {},
): Promise<SocketLiveness> {
	const timeoutMs = opts.timeoutMs ?? DEFAULT_PROBE_TIMEOUT_MS;
	return await new Promise<SocketLiveness>((resolve) => {
		const socket = net.createConnection(socketPath);
		const timer = setTimeout(() => {
			socket.destroy();
			resolve("indeterminate");
		}, timeoutMs);
		const settle = (liveness: SocketLiveness) => {
			clearTimeout(timer);
			socket.removeAllListeners();
			resolve(liveness);
		};
		socket.once("connect", () => {
			socket.end();
			settle("alive");
		});
		socket.once("error", (err: NodeJS.ErrnoException) => {
			settle(classifyConnectError(err.code));
		});
	});
}
