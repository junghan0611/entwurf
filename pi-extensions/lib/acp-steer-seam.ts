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
 *  - registration happens once, after the provider registered; registering the SAME object again
 *    is a no-op;
 *  - a DIFFERENT object already under the key is refused by name (`acp-steer-seam-duplicate`) while
 *    the old seam reports an open busy window, or when the old value is not a version-1 seam: two
 *    backend module instances would each own a different window map, and replacing one under a
 *    prompt in flight would make control consult the wrong map;
 *  - a DIFFERENT object replaces an old seam that reports NO open window (a reload of the extension,
 *    ff08d4 2026-11-15). Nothing is lost: an old prompt that starts later cannot be found through
 *    the new seam, so its steer reads `no-busy-window` and takes the Pi queue — never a false
 *    success, never a double delivery. The real Pi `/reload` path is NOT measured;
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
	/** Whether this backend instance has any prompt in flight (a busy window open). */
	hasOpenWindow(): boolean;
}

export const ACP_STEER_SEAM_KEY: unique symbol = Symbol.for("entwurf.acp.steer.v1") as never;

type SeamHost = { [ACP_STEER_SEAM_KEY]?: unknown };

/**
 * Register the seam. Same object again: no-op. A different object replaces an old seam only when
 * the old one reports no open window; a busy or broken old value throws by name.
 */
export function registerAcpSteerSeam(seam: AcpSteerSeamV1, host: object = globalThis): void {
	const h = host as SeamHost;
	const existing = h[ACP_STEER_SEAM_KEY];
	if (existing === seam) return;
	if (existing !== undefined) {
		const old = readSeam(existing);
		if (old === null) throw duplicate("the registered value is not a version-1 seam");
		if (reportsOpenWindow(old)) throw duplicate("its backend has a prompt in flight");
	}
	h[ACP_STEER_SEAM_KEY] = seam;
}

function duplicate(why: string): Error {
	return new Error(
		`acp-steer-seam-duplicate: another ACP steer seam is already registered in this process and ${why}; two backend instances would each own a different busy-window map`,
	);
}

/** An old seam that cannot answer is treated as busy: refusing is the safe side. */
function reportsOpenWindow(old: AcpSteerSeamV1): boolean {
	try {
		return old.hasOpenWindow() !== false;
	} catch {
		return true;
	}
}

function readSeam(value: unknown): AcpSteerSeamV1 | null {
	const v = value as Partial<AcpSteerSeamV1> | null;
	if (
		v === null ||
		typeof v !== "object" ||
		v.version !== 1 ||
		typeof v.steerBusy !== "function" ||
		typeof v.hasOpenWindow !== "function"
	) {
		return null;
	}
	return v as AcpSteerSeamV1;
}

export type AcpSteerSeamLookup =
	| { kind: "absent" }
	| { kind: "invalid"; detail: string }
	| { kind: "ok"; seam: AcpSteerSeamV1 };

/** Look the seam up. Absent is ordinary; a value of the wrong shape is a configuration error. */
export function lookupAcpSteerSeam(host: object = globalThis): AcpSteerSeamLookup {
	const value = (host as SeamHost)[ACP_STEER_SEAM_KEY];
	if (value === undefined) return { kind: "absent" };
	const seam = readSeam(value);
	if (seam === null) {
		return { kind: "invalid", detail: "acp-steer-seam-invalid: the registered ACP steer seam is not a version-1 seam" };
	}
	return { kind: "ok", seam };
}
