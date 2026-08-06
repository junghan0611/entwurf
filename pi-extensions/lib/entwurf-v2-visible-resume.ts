/**
 * entwurf-v2-visible-resume — stand a dormant pi citizen back up in a window the operator can
 * see, under the same garden id, and say only what was actually observed.
 *
 * ── Where this sits ──
 *
 *   surface (entwurf-control.ts · mcp bridge index.ts)   composition root: supplies `launch`
 *     └─ entwurf-v2-visible-resume  (this file)          v2 leaves ONLY: lock, record, socket
 *          └─ deps.launch(argv, cwd)  ── INJECTED SEAM ──→ mux-resume-call → placement leaf
 *
 * The seam is what keeps `docs/mux-launch-rail.md` §11 intact in both directions: v2 never
 * imports mux, mux never imports entwurf core. This module cannot open a window; it can only
 * ask whoever wired it to. That is deliberate — it means the delivery fence stays exactly where
 * `check-mux-launch` scans for it.
 *
 * ── Why a resume is structurally SMALLER than a fresh call on identity, and LARGER on the lock ──
 *
 * `mux-fresh-call` mints no identity: the sibling calls back and its envelope IS the address.
 * A resume already knows the address — that is what "same-id" means — so there is no nonce, no
 * callback, and no correlation receipt. What it gains instead is the lock: two visible resumes
 * of one garden id would put two processes on one transcript, and `entwurf_v2`'s in-domain
 * dispatch takes the SAME per-gid lock, so a resume and a live send serialise against each other
 * for free. The lock is consistency, not defence — there is no watcher behind it.
 *
 * ── The observation is a startup wait, not supervision ──
 *
 * Measured 2026-08-06: the resumed control socket appeared ~2s (ACP) and ~4s (native) after the
 * window opened. A single immediate probe would therefore have observed `dead` and reported a
 * successful resume as unobserved. So the observation is ONE bounded operation with a short
 * interval, and everything that would make it supervision is deliberately absent:
 *
 *   - no relaunch, ever. A refused or dead launch is a result, not a retry trigger.
 *   - no pane watcher. Until the deadline this module looks at ONE thing: the socket.
 *   - no env knob on the timeout. A tunable would make "unobserved" mean different things on
 *     different hosts, and the receipt would stop being comparable.
 *
 * On timeout the lock is RELEASED and the window is LEFT OPEN. That is the same rule fresh-call
 * already ships ("a launch with no callback is a real outcome"): the window is visible, the
 * operator can look, and a retained lock on a visible artifact is the worse failure — it would
 * have to be cleared by hand on every slow host.
 *
 * ── Two receipts, never merged ──
 *
 * `launch` says tmux made a window and was asked to start pi. `observation` says whether the
 * citizen's socket came back under the same id. Neither says the resumed citizen did anything:
 * a resume runs no turn (measured — the transcript stayed byte-identical), so there is no turn
 * outcome for this module to claim.
 */

import { buildResumePiArgs } from "./entwurf-resume-args.ts";
import {
	type AcquireLockResult,
	ENTWURF_V2_LOCK_DIR,
	type LockClaim,
	type ReleaseResult,
	acquireLock as realAcquireLock,
	releaseLock as realReleaseLock,
} from "./entwurf-v2-lock.ts";
import {
	type LaunchIdentity,
	ResumeBackendUnsupportedError,
	resolveResumeLaunchIdentity,
} from "./resume-launch-identity.ts";
import { isValidSessionId } from "./session-id.js";
import {
	CONTROL_SOCKET_DIR,
	inspectTargetControlSocket,
	mapInspectionToLiveness,
	type TargetSocketInspection,
} from "./socket-discovery.ts";
import { probeSocketLiveness, type SocketLiveness } from "./socket-probe.ts";

/** How long ONE observation operation waits for the resumed citizen's socket. Fixed on purpose:
 * see the module header on why this is not an env knob. */
export const RESUME_OBSERVE_TIMEOUT_MS = 30_000;
/** How often that one operation re-inspects. Short enough that a 2s startup is reported as the
 * success it is, long enough that a 30s wait is ~60 lstats and not a spin. */
export const RESUME_OBSERVE_INTERVAL_MS = 500;

/**
 * The narrow set of EXPECTED refusals. Record, store, transcript and model integrity are NOT in
 * here: `resolveResumeLaunchIdentity` already throws a cause-rich error for each of those
 * ("stale or foreign transcript", "relative transcriptPath", "no recorded model", "unresolvable
 * ACP bridge", …), and copying those causes into an enum would duplicate a truth that already
 * fails loud — the second copy is what goes stale.
 *
 * `target-not-pi` IS in here, and the line between it and those throws is worth stating: asking
 * to resume a Claude Code or agy citizen is not a defect at all. Nothing is corrupt, the record
 * is exactly right, and the operator has simply reached past a capability boundary — only pi
 * stands a control socket up, so only pi has a same-id resume. That deserves a named refusal a
 * caller can act on, not an error report about a store that is fine.
 */
export type VisibleResumeRejectReason =
	| "target-invalid"
	| "target-not-pi"
	| "target-locked"
	| "target-live"
	| "target-indeterminate"
	| "target-address-conflict"
	| "launch-refused";

/** What the injected launcher gives back. Structural on purpose: naming mux's types here would
 * be the import this split exists to avoid. */
export interface VisibleResumeLaunchHandle {
	serverPid: string;
	sessionId: string;
	windowId: string;
	windowIndex: string;
	paneId: string;
	panePid: string;
	runtimePath: string;
	cwd: string;
}

export type VisibleResumeLaunchOutcome =
	| { ok: true; handle: VisibleResumeLaunchHandle }
	| { ok: false; reason: string; hint: string };

/** Fact 1: tmux created a window and was asked to start pi there. `cwd` is the REQUESTED start
 * directory (what tmux was told), the same kind of fact as `runtimePath` — not an observation of
 * where the pane landed. */
export interface ResumeLaunchReceipt {
	targetGardenId: string;
	sessionFile: string;
	handle: VisibleResumeLaunchHandle;
}

/** Fact 2: the citizen's control socket came back under the SAME garden id, or it did not. This
 * is the only fact in this module that says a citizen is back. */
export interface ResumeObservationReceipt {
	kind: "socket-alive" | "resume-unobserved";
	socketPath: string;
	waitedMs: number;
}

export type VisibleResumeResult =
	| { ok: true; launch: ResumeLaunchReceipt; observation: ResumeObservationReceipt }
	| { ok: false; reason: VisibleResumeRejectReason; detail: string };

export interface VisibleResumeDeps {
	acquireLock: (gardenId: string) => AcquireLockResult;
	releaseLock: (claim: LockClaim) => ReleaseResult;
	resolveIdentity: (gardenId: string) => LaunchIdentity;
	inspectSocket: (gardenId: string) => Promise<TargetSocketInspection>;
	probeSocket: (socketPath: string) => Promise<SocketLiveness>;
	/** The ONLY way this module reaches tmux. The surface supplies it. */
	launch: (input: { cwd: string; runtimeArgs: readonly string[] }) => VisibleResumeLaunchOutcome;
	sleep: (ms: number) => Promise<void>;
	now: () => number;
}

/** Production wiring for everything except the launch seam — the surface owns that, because it
 * is the only layer allowed to know both halves. */
export function makeVisibleResumeDeps(
	launch: VisibleResumeDeps["launch"],
	overrides: Partial<VisibleResumeDeps> = {},
): VisibleResumeDeps {
	return {
		acquireLock: (gid) => realAcquireLock(gid, { dir: ENTWURF_V2_LOCK_DIR }),
		releaseLock: (claim) => realReleaseLock(claim, { dir: ENTWURF_V2_LOCK_DIR }),
		resolveIdentity: resolveResumeLaunchIdentity,
		inspectSocket: (gid) => inspectTargetControlSocket(gid, CONTROL_SOCKET_DIR),
		probeSocket: (socketPath) => probeSocketLiveness(socketPath),
		launch,
		sleep: (ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
		now: () => Date.now(),
		...overrides,
	};
}

/**
 * Reopen `targetGardenId` in a visible window.
 *
 * Order is the safety argument. The lock is taken FIRST, before the liveness question, so the
 * answer cannot change under us between reading it and acting on it — a competing resume would
 * otherwise pass its own `dead` check while ours was launching. Identity is resolved under that
 * lock and BEFORE any window opens, so a citizen with no transcript (measured: a pi that never
 * took a turn has a socket and a record but no transcriptPath) fails loud with its own cause and
 * leaves nothing behind.
 */
export async function visibleResume(targetGardenId: string, deps: VisibleResumeDeps): Promise<VisibleResumeResult> {
	// The address grammar is `session-id.js`'s, not a local copy. The socket filename, the lock
	// path and the record key are all keyed on that SAME id, so a second regex here could drift
	// into accepting an id one of those three would reject — and this value becomes a lock path
	// and a socket path a few lines down.
	if (!isValidSessionId(targetGardenId)) {
		return {
			ok: false,
			reason: "target-invalid",
			detail: `${JSON.stringify(targetGardenId)} is not a garden id (YYYYMMDDTHHMMSS-xxxxxx)`,
		};
	}

	const acquired = deps.acquireLock(targetGardenId);
	if (!acquired.ok) {
		return { ok: false, reason: "target-locked", detail: acquired.conflict.detail };
	}
	const claim = acquired.claim;

	let released = false;
	/** Release exactly once, and never let a failed release read as success. A lock this module
	 * took and could not give back is a fact the operator has to know about — the next resume or
	 * send against that citizen will be refused, and silence would send them looking at the wrong
	 * layer. */
	const release = (): void => {
		if (released) return;
		released = true;
		const outcome = deps.releaseLock(claim);
		if (outcome !== "released") {
			throw new Error(
				`entwurf-v2-visible-resume: attempted to release the lock for ${targetGardenId}; the release returned ` +
					`"${outcome}" instead of "released" (${claim.lockPath}) — the per-gid lock may still be held; clear ` +
					`it by hand before resuming or dispatching to that citizen again.`,
			);
		}
	};

	try {
		// Record authority, under the lock, before any window. Every failure here is a cause-rich
		// throw from the leaf (foreign transcript, relative or deleted session file, no recorded
		// model, unresolvable bridge) and is deliberately NOT re-typed into a reject — with ONE
		// exception, matched on the error's own `reason` FIELD rather than its wording: a citizen
		// of a backend that has no same-id resume. That is a capability boundary, not a defect, so
		// it is a named refusal. The record is not read a second time to ask which backend it was;
		// the error already carries it.
		let identity: LaunchIdentity;
		try {
			identity = deps.resolveIdentity(targetGardenId);
		} catch (err) {
			if (err instanceof ResumeBackendUnsupportedError) {
				return {
					ok: false,
					reason: err.reason,
					detail:
						`${targetGardenId} is a ${err.backend} citizen; only pi citizens stand a control socket up, ` +
						`so only they can be reopened under the same garden id`,
				};
			}
			throw err;
		}

		// Liveness preflight, still under the lock. A live citizen is addressed with
		// `entwurf_v2 fire-and-forget`, not reopened — and refusing here is also what stops two
		// windows existing for one garden id.
		const inspection = await deps.inspectSocket(targetGardenId);
		const mapped = await mapInspectionToLiveness(inspection, deps.probeSocket);
		if ("addressConflict" in mapped) {
			return {
				ok: false,
				reason: "target-address-conflict",
				detail:
					`the control-socket path for ${targetGardenId} is a symlink or not a socket — that address is ` +
					`corrupt, and resuming would stand a citizen up behind it`,
			};
		}
		if (mapped.liveness === "alive") {
			return {
				ok: false,
				reason: "target-live",
				detail: `${targetGardenId} is already live at ${mapped.socketPath} — send to it with entwurf_v2 fire-and-forget instead`,
			};
		}
		if (mapped.liveness === "indeterminate") {
			return {
				ok: false,
				reason: "target-indeterminate",
				detail:
					`the control-socket probe for ${targetGardenId} was inconclusive — it is not provably dormant, ` +
					`and resuming a citizen that is actually running would put two processes on one transcript`,
			};
		}

		const runtimeArgs = buildResumePiArgs({
			sessionFile: identity.sessionFile,
			explicitExtensionArgs: identity.explicitExtensionArgs,
			provider: identity.provider,
			model: identity.model,
		});
		const launched = deps.launch({ cwd: identity.cwd, runtimeArgs });
		if (!launched.ok) {
			return { ok: false, reason: "launch-refused", detail: `${launched.reason} — ${launched.hint}` };
		}

		const observation = await observeSameGidSocket(targetGardenId, mapped.socketPath, deps);
		return {
			ok: true,
			launch: { targetGardenId, sessionFile: identity.sessionFile, handle: launched.handle },
			observation,
		};
	} finally {
		release();
	}
}

/**
 * ONE bounded operation: wait for the SAME garden id's control socket to answer. Alive is the
 * only early exit — an inspection that comes back absent, corrupt or inconclusive during startup
 * is a normal intermediate state, not a verdict, so it is simply not-yet.
 */
export async function observeSameGidSocket(
	targetGardenId: string,
	socketPath: string,
	deps: Pick<VisibleResumeDeps, "inspectSocket" | "probeSocket" | "sleep" | "now">,
	timeoutMs: number = RESUME_OBSERVE_TIMEOUT_MS,
	intervalMs: number = RESUME_OBSERVE_INTERVAL_MS,
): Promise<ResumeObservationReceipt> {
	const started = deps.now();
	for (;;) {
		const inspection = await deps.inspectSocket(targetGardenId);
		const mapped = await mapInspectionToLiveness(inspection, deps.probeSocket);
		if (!("addressConflict" in mapped) && mapped.liveness === "alive") {
			return { kind: "socket-alive", socketPath: mapped.socketPath, waitedMs: deps.now() - started };
		}
		if (deps.now() - started >= timeoutMs) {
			return { kind: "resume-unobserved", socketPath, waitedMs: deps.now() - started };
		}
		await deps.sleep(intervalMs);
	}
}

const REJECT_HINT: Record<VisibleResumeRejectReason, string> = {
	"target-invalid": "no citizen has that id; discover targets with entwurf_peers",
	"target-not-pi": "that citizen's backend has no same-id resume — reach it with entwurf_v2, or open a fresh sibling",
	"target-locked": "another resume or dispatch holds this citizen's lock right now",
	"target-live": "that citizen is already running — this verb only reopens dormant ones",
	"target-indeterminate": "the socket probe could not prove the citizen is dormant, so nothing was started",
	"target-address-conflict": "that citizen's control-socket path is corrupt",
	"launch-refused": "tmux was never asked to open a window",
};

/**
 * ONE renderer for both surfaces — the same reason `mux-fresh-call` has one: the two
 * registrations are separate literals, and a shared renderer is what keeps the operator-visible
 * answer from drifting apart between native pi and the MCP bridge.
 *
 * The success text keeps the two receipts visibly apart, including in the good case. A reader
 * who sees "window opened" and "socket alive" as one sentence has been told the resume worked;
 * a reader who sees them as two facts can tell which one is missing when only one is there.
 */
export function renderVisibleResume(result: VisibleResumeResult): { text: string; isError: boolean } {
	if (!result.ok) {
		return {
			text:
				`entwurf_resume_call rejected: ${result.reason} — ${REJECT_HINT[result.reason]}. ` +
				`${result.detail}. No window was opened.`,
			isError: true,
		};
	}
	const h = result.launch.handle;
	const observed = result.observation.kind === "socket-alive";
	return {
		text:
			`[entwurf resume call ↻]\n` +
			`  target:   ${result.launch.targetGardenId}\n` +
			`  session:  ${result.launch.sessionFile}\n` +
			`  runtime:  ${h.runtimePath} (requested start cwd ${h.cwd})\n` +
			`  window:   ${h.windowId} (index ${h.windowIndex}) in session ${h.sessionId}\n` +
			`  pane:     ${h.paneId} pid ${h.panePid}\n` +
			`\n` +
			`LAUNCH receipt: tmux created that window and was asked to start pi on the transcript above.\n` +
			(observed
				? `OBSERVATION receipt: the control socket for ${result.launch.targetGardenId} answered after ` +
					`${result.observation.waitedMs}ms — that citizen is addressable again, and entwurf_v2 fire-and-forget ` +
					`now reaches it. No turn was run by this call.`
				: `OBSERVATION receipt: resume-unobserved — the control socket did not answer within ` +
					`${result.observation.waitedMs}ms. The window is open and visible; read it directly. The lock was ` +
					`released, nothing was retried, and nothing was killed.`),
		isError: false,
	};
}
