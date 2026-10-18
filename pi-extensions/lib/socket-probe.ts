/**
 * socket-probe — single source of truth for control-socket liveness.
 *
 * Why this is a shared lib (not a per-file copy): every surface that asks
 * "is this control socket live?" must answer identically. The entwurf-control
 * extension (`pi-extensions/entwurf-control.ts`, GC) and the v2 dispatch/listing
 * path (`socket-discovery.ts` → `entwurf-fact-provider.ts`, and the production
 * decider deps) used to carry independent `isSocketAlive` copies. If only one
 * side learned the three-valued classification the two probes would diverge —
 * dispatch routes a timeout target one way while GC reclaims the same socket.
 * All of them consume this module instead. (The bridge no longer probes at all:
 * its socket-scan lane went with #50 C4, so it reaches liveness only through
 * the fact provider.)
 *
 * Three-valued, not boolean — the F3 fix. A connect probe can mean three
 * different things, and collapsing them to a boolean is what let
 * `gcStaleSockets` permanently unlink a *live* socket that merely stalled
 * under load (→ every later probe sees it as dormant → live-session resume =
 * identity split). The cure: never destroy a socket we do not understand.
 *   - alive          → a listener accepted the connection (positive proof)
 *   - dead           → ECONNREFUSED / ENOENT only (positive proof of absence)
 *   - indeterminate  → timeout, EACCES, or any other/unknown error
 *                      (no proof either way — keep the file, never destroy it)
 *
 * This module owns ONE policy, `shouldUnlinkOnGc` (GC reclaims dead only). The
 * old listing policy (`shouldListAsLive`) left with its last consumer in #50 C4:
 * `indeterminate` is now carried all the way to the surface as a fact, not
 * hidden — `entwurf_peers` shows it and the v2 decider rejects on it by name.
 */

import * as net from "node:net";
import { win32Native } from "./win32-native.js";

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
	if (process.platform === "win32") return await probePipeLiveness(socketPath, timeoutMs);
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

/**
 * The Windows probe (#78): the control address is a named pipe, and a connect alone would
 * talk to whoever holds the name. The addon connects within one deadline and refuses a pipe
 * whose owner is not this token's expected owner (`EPERM`) before any byte. Only `ENOENT`
 * (no instance) is dead; a refused owner, a busy pipe past the deadline and every Win32
 * failure stay indeterminate. A missing or drifted addon is not a liveness fact: that
 * refusal throws.
 */
async function probePipeLiveness(pipeName: string, timeoutMs: number): Promise<SocketLiveness> {
	const native = win32Native();
	try {
		await native.pipeProbe(pipeName, Math.max(0, Math.floor(timeoutMs)));
		return "alive";
	} catch (err) {
		return classifyConnectError((err as { code?: string }).code);
	}
}
