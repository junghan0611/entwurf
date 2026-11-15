/**
 * acp-steer-seam — the one process-global seam between the control socket and a busy ACP turn
 * (#163 S7 design §2.3).
 *
 * Direction follows the ACP Boundary table (AGENTS.md): the ACP plugin REGISTERS a capability, and
 * the control socket (the peer protocol) only LOOKS IT UP. Control never imports ACP internals; it
 * imports this module, which holds no ACP state. The seam is a function on `globalThis` under one
 * `Symbol.for` key, because the control extension and the ACP provider are separate extension
 * modules in one Pi process.
 *
 * Ownership rules:
 *  - registration happens once, after the provider registered; a DIFFERENT object already under the
 *    key is a named error (`acp-steer-seam-duplicate`) — two backend module instances would each own
 *    a different window map, and silently replacing one would make control consult the wrong map;
 *    registering the SAME object again is a no-op;
 *  - lookup distinguishes absent (native Pi, or ACP not loaded: the queue path as before) from a
 *    present value of the wrong shape, which is a configuration error the caller refuses by name.
 */

/** What one busy-steer attempt came to (#163 S7 design §2.3). */
export type AcpSteerEffect =
	/** No request was sent. */
	| { effect: "not-sent"; reason: "no-busy-window" | "steering-unsupported" | "no-steer-method" }
	/** One request; the backend said there is no running turn and pushed nothing. */
	| { effect: "prompt-required" }
	/** One request; the running turn took it as input. */
	| { effect: "injected" }
	/** One request; whether the backend took it is unknown. Never retried, never re-queued. */
	| { effect: "unknown"; reason: "timeout" | "connection-closed" | "answer-unrecognized"; detail: string };

export interface AcpSteerSeamV1 {
	readonly version: 1;
	steerBusy(piSessionId: string, text: string): Promise<AcpSteerEffect>;
}

export const ACP_STEER_SEAM_KEY: unique symbol = Symbol.for("entwurf.acp.steer.v1") as never;

type SeamHost = { [ACP_STEER_SEAM_KEY]?: unknown };

/** Register the seam. Same object again: no-op. A different object already there: throws by name. */
export function registerAcpSteerSeam(seam: AcpSteerSeamV1, host: object = globalThis): void {
	const h = host as SeamHost;
	const existing = h[ACP_STEER_SEAM_KEY];
	if (existing === seam) return;
	if (existing !== undefined) {
		throw new Error(
			"acp-steer-seam-duplicate: another ACP steer seam is already registered in this process; two backend instances would each own a different busy-window map",
		);
	}
	h[ACP_STEER_SEAM_KEY] = seam;
}

export type AcpSteerSeamLookup =
	| { kind: "absent" }
	| { kind: "invalid"; detail: string }
	| { kind: "ok"; seam: AcpSteerSeamV1 };

/** Look the seam up. Absent is ordinary; a value of the wrong shape is a configuration error. */
export function lookupAcpSteerSeam(host: object = globalThis): AcpSteerSeamLookup {
	const value = (host as SeamHost)[ACP_STEER_SEAM_KEY];
	if (value === undefined) return { kind: "absent" };
	const v = value as Partial<AcpSteerSeamV1> | null;
	if (v === null || typeof v !== "object" || v.version !== 1 || typeof v.steerBusy !== "function") {
		return { kind: "invalid", detail: "acp-steer-seam-invalid: the registered ACP steer seam is not a version-1 seam" };
	}
	return { kind: "ok", seam: v as AcpSteerSeamV1 };
}
