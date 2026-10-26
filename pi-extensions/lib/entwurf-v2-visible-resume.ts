/**
 * entwurf-v2-visible-resume — stand a dormant pi or Claude Code citizen back up in a window the
 * operator can see, under the same garden id, and say only what was actually observed.
 *
 * ── Two backends, one shape (#147 L2) ──
 *
 * Both own their transcript and re-attach to their record when the same native session reopens.
 * What differs is the rail each one proves itself on, so the dormancy proof and the observation are
 * per backend and nothing else is:
 *
 *   pi           dormant = its control socket is dead; back = that socket answers again.
 *   claude-code  dormant = the LAST VALIDATED owner the Entwurf hook armed for this session is
 *                proven gone: the receiver marker names an owner `classifyMarkerOwner` calls DEAD,
 *                AND the record re-read after that verdict still carries the same non-null
 *                `attachIncarnation` the marker copied (#147 L2 B1) — so no arm-capable attach
 *                committed after that owner's. An absent, unreadable, mismatched, live,
 *                inconclusive or unbound marker proves nothing and refuses. A process that holds
 *                the session without a committed hook attach (hooks disabled, a record-arm lock
 *                timeout, a store write failure, a launch after the re-read) is invisible to this
 *                proof. Back = a NEW live owner, in the pane this call opened, re-armed the marker
 *                for the same session with a fresh binding the current record also carries (same
 *                createdAt). The old marker read again is never success.
 *
 * Every other backend is the leaf's named refusal. The argv is a fixed table per backend; the caller
 * supplies only the target.
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
 * `launch` says tmux made a window and was asked to start the runtime. `observation` says whether
 * the citizen came back under the same id (pi: its socket; Claude Code: its receiver marker).
 * Neither says the resumed citizen did anything. This verb submits no prompt. For pi a resume ran
 * no turn (measured 2026-08-06, pi only — the transcript stayed byte-identical); for Claude Code
 * the runtime's own activity after resume (its SessionStart hook re-arms the doorbell, and unread
 * mail may then wake a turn) is unmeasured, so this module claims no turn outcome either way.
 * The socket-only description in the observation section above is the pi half; the Claude Code
 * half reads the receiver marker and the record instead.
 */

import { ACP_MODEL_NOT_CURATED_HINT, AcpModelNotCuratedError } from "./acp/model-ids.js";
import { ENTWURF_RESUME_REJECT_HINTS } from "./agent-guidance.ts";
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
	classifyMarkerOwner,
	type MarkerOwnerVerdict,
	metaReceiverMarkerPath,
	parseMetaReceiverMarker,
	probePidExistence,
	processStartKey,
	readStoreRecordFile,
} from "./meta-session.ts";
import {
	type ClaudeCodeLaunchIdentity,
	type LaunchIdentity,
	type ResumeBackend,
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
 * `target-backend-unsupported` IS in here, and the line between it and those throws is worth
 * stating: asking to resume a Codex or agy citizen is not a defect at all. Nothing is corrupt, the
 * record is exactly right, and the operator has simply reached past a capability boundary — only
 * pi and Claude Code have a same-id resume. That deserves a named refusal a caller can act on, not
 * an error report about a store that is fine. The four `target-receiver-*` reasons are the Claude
 * Code dormancy proof failing: nothing on disk proves the citizen is not running.
 */
export type VisibleResumeRejectReason =
	| "target-invalid"
	| "target-backend-unsupported"
	| "acp-model-not-curated"
	| "target-locked"
	| "target-live"
	| "target-receiver-absent"
	| "target-receiver-corrupt"
	| "target-receiver-mismatch"
	| "target-receiver-unbound"
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

/** Fact 1: tmux created a window and was asked to start the citizen's runtime there. `cwd` is the
 * REQUESTED start directory (what tmux was told), the same kind of fact as `runtimePath` — not an
 * observation of where the pane landed. */
export type ResumeLaunchReceipt =
	| { backend: "pi"; targetGardenId: string; sessionFile: string; handle: VisibleResumeLaunchHandle }
	| { backend: "claude-code"; targetGardenId: string; nativeSessionId: string; handle: VisibleResumeLaunchHandle };

/** Fact 2: the citizen's control socket came back under the SAME garden id, or it did not. This
 * is the only fact in this module that says a citizen is back. */
export interface ResumeObservationReceipt {
	kind: "socket-alive" | "resume-unobserved";
	socketPath: string;
	waitedMs: number;
}

/** Fact 2 for Claude Code: a NEW live owner in the opened pane re-armed the receiver marker for the
 * same native session with a fresh binding the current record carries, or that was not seen in
 * time, or the record could not be read (a store defect, reported at once with its cause — the
 * window stays open). The pid is the new owner's, read from the marker and joined to the pane
 * this call opened; it is evidence, not an address. */
export type ReceiverObservationReceipt =
	| { kind: "receiver-armed"; ownerPid: number; waitedMs: number }
	| { kind: "resume-unobserved"; waitedMs: number }
	| { kind: "record-unreadable"; cause: string; waitedMs: number };

/** What the receiver marker under a garden id says, read raw and judged by the shared owner rule. */
export type ReceiverInspection =
	| { kind: "absent" }
	| { kind: "corrupt" }
	| {
			kind: "marker";
			marker: {
				gardenId: string;
				backend: string;
				nativeSessionId: string;
				ownerPid: number;
				ownerStartKey: string;
				attachIncarnation: string | null;
				/** Already parsed from the same fd; exposed for callers that must join the owner's domain
				 * (#147 G3 retire). The resume verdict does not read them. */
				ownerKind: string;
				armProvenance: string;
			};
			owner: MarkerOwnerVerdict;
	  };

export type VisibleResumeResult =
	| { ok: true; launch: ResumeLaunchReceipt; observation: ResumeObservationReceipt | ReceiverObservationReceipt }
	| { ok: false; reason: VisibleResumeRejectReason; detail: string };

export interface VisibleResumeDeps {
	acquireLock: (gardenId: string) => AcquireLockResult;
	releaseLock: (claim: LockClaim) => ReleaseResult;
	resolveIdentity: (gardenId: string) => LaunchIdentity;
	inspectSocket: (gardenId: string) => Promise<TargetSocketInspection>;
	probeSocket: (socketPath: string) => Promise<SocketLiveness>;
	/** The Claude Code dormancy proof and observation read this; pi never does. */
	inspectReceiver: (gardenId: string) => ReceiverInspection;
	/** The ONLY way this module reaches tmux. The surface supplies it. */
	launch: (input: {
		backend: ResumeBackend;
		cwd: string;
		runtimeArgs: readonly string[];
	}) => VisibleResumeLaunchOutcome;
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
		inspectReceiver: (gid) => inspectReceiverMarker(gid),
		launch,
		sleep: (ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
		now: () => Date.now(),
		...overrides,
	};
}

/**
 * The receiver marker under `gardenId`, read RAW (no owner verification inside the reader — the
 * path reader's `null` folds absent, corrupt and dead into one answer, and only "dead" may permit
 * a resume) and judged by `classifyMarkerOwner`, the one place a dead verdict is produced. The
 * bytes come from `readStoreRecordFile` — `O_NOFOLLOW` open, `fstat` kind and read on that one fd
 * (#147 L2 D3) — so a symlink or a non-regular entry is corrupt and never followed, with no
 * window between classifying the entry and reading it. `ENOENT` alone is absent.
 */
export function inspectReceiverMarker(gardenId: string, receiversDir?: string): ReceiverInspection {
	const markerPath = metaReceiverMarkerPath(gardenId, receiversDir);
	let bytes: string;
	try {
		bytes = readStoreRecordFile(markerPath);
	} catch (err) {
		if ((err as { code?: unknown }).code === "ENOENT") return { kind: "absent" };
		return { kind: "corrupt" };
	}
	let marker: ReturnType<typeof parseMetaReceiverMarker>;
	try {
		marker = parseMetaReceiverMarker(bytes);
	} catch {
		return { kind: "corrupt" };
	}
	if (marker === null) return { kind: "corrupt" };
	const owner = classifyMarkerOwner(marker.ownerStartKey, {
		currentStartKey: processStartKey(marker.ownerPid),
		pidExists: probePidExistence(marker.ownerPid),
	});
	return {
		kind: "marker",
		marker: {
			gardenId: marker.gardenId,
			backend: marker.backend,
			nativeSessionId: marker.nativeSessionId,
			ownerPid: marker.ownerPid,
			ownerStartKey: marker.ownerStartKey,
			attachIncarnation: marker.attachIncarnation,
			ownerKind: marker.ownerKind,
			armProvenance: marker.armProvenance,
		},
		owner,
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
			// #128: the recorded model is not an exact curated ACP id, so Pi would pick another row
			// by substring. Same shape as `target-backend-unsupported`: a named refusal matched on its FIELD.
			if (err instanceof AcpModelNotCuratedError) {
				return {
					ok: false,
					reason: err.reason,
					detail: `${targetGardenId} would launch model ${JSON.stringify(err.model)} under the entwurf provider (the resolved launch pair, which may differ from the recorded provider)`,
				};
			}
			if (err instanceof ResumeBackendUnsupportedError) {
				return {
					ok: false,
					reason: err.reason,
					detail:
						`${targetGardenId} is a ${err.backend} citizen; only pi and Claude Code citizens can be reopened ` +
						`under the same garden id`,
				};
			}
			throw err;
		}

		if (identity.backend === "claude-code") return await resumeClaudeCode(targetGardenId, identity, deps);

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
		const launched = deps.launch({ backend: "pi", cwd: identity.cwd, runtimeArgs });
		if (!launched.ok) {
			return { ok: false, reason: "launch-refused", detail: `${launched.reason} — ${launched.hint}` };
		}

		const observation = await observeSameGidSocket(targetGardenId, mapped.socketPath, deps);
		return {
			ok: true,
			launch: { backend: "pi", targetGardenId, sessionFile: identity.sessionFile, handle: launched.handle },
			observation,
		};
	} finally {
		release();
	}
}

/**
 * The Claude Code half, still under the caller's lock. Dormancy needs a DEAD owner verdict on the
 * receiver marker AND the binding: the record re-read AFTER that verdict must still name the same
 * session and createdAt, and carry the same non-null `attachIncarnation` the marker copied. An
 * absent marker (never armed, or retired when its process switched session), an unreadable one,
 * one that names another session, a live owner, an inconclusive one and an unbound one each refuse
 * by name, with no window. The re-read catches every attach whose atomic record write committed
 * before it; a launch or attach that begins after it is not predicted. The launch uses the
 * re-read record (its cwd), never the first read. The marker and the record are never removed or
 * rewritten here — they are evidence, not something this verb may clear.
 */
async function resumeClaudeCode(
	targetGardenId: string,
	identity: ClaudeCodeLaunchIdentity,
	deps: VisibleResumeDeps,
): Promise<VisibleResumeResult> {
	const before = deps.inspectReceiver(targetGardenId);
	if (before.kind === "absent") {
		return {
			ok: false,
			reason: "target-receiver-absent",
			detail: `no receiver marker names ${targetGardenId}, so nothing proves its Claude Code process is gone`,
		};
	}
	if (before.kind === "corrupt") {
		return {
			ok: false,
			reason: "target-receiver-corrupt",
			detail: `the receiver marker for ${targetGardenId} is not a readable regular marker, so its owner cannot be judged`,
		};
	}
	const marker = before.marker;
	if (
		marker.gardenId !== targetGardenId ||
		marker.backend !== "claude-code" ||
		marker.nativeSessionId !== identity.nativeSessionId
	) {
		return {
			ok: false,
			reason: "target-receiver-mismatch",
			detail:
				`the receiver marker for ${targetGardenId} names ${marker.backend}/${marker.nativeSessionId}, not the ` +
				`record's claude-code/${identity.nativeSessionId}`,
		};
	}
	if (before.owner === "live") {
		return {
			ok: false,
			reason: "target-live",
			detail: `${targetGardenId}'s Claude Code process (pid ${marker.ownerPid}) is still running — send to it with entwurf_v2 fire-and-forget instead`,
		};
	}
	if (before.owner !== "dead") {
		return {
			ok: false,
			reason: "target-indeterminate",
			detail:
				`the receiver marker's owner (pid ${marker.ownerPid}) for ${targetGardenId} could not be proven gone, ` +
				`and resuming a session that is still open would put two processes on one transcript`,
		};
	}

	// The binding, read AFTER the dead verdict. A store or record defect here throws, exactly as
	// the first read does: no window exists yet.
	const current = deps.resolveIdentity(targetGardenId);
	if (
		current.backend !== "claude-code" ||
		current.nativeSessionId !== identity.nativeSessionId ||
		current.createdAt !== identity.createdAt
	) {
		return {
			ok: false,
			reason: "target-receiver-unbound",
			detail: `the record under ${targetGardenId} changed between the two reads, so the dead marker cannot be bound to it`,
		};
	}
	if (current.attachIncarnation === null || marker.attachIncarnation === null) {
		return {
			ok: false,
			reason: "target-receiver-unbound",
			detail:
				`no arm binding was observed for ${targetGardenId} (record ${current.attachIncarnation === null ? "has none" : "has one"}, ` +
				`marker ${marker.attachIncarnation === null ? "has none" : "has one"}), so the dead owner is not proven to be the last attach`,
		};
	}
	if (current.attachIncarnation !== marker.attachIncarnation) {
		return {
			ok: false,
			reason: "target-receiver-unbound",
			detail:
				`the record of ${targetGardenId} carries a later arm binding than its receiver marker — an attach committed ` +
				`after the dead owner's, and its process is not proven gone`,
		};
	}

	const launched = deps.launch({
		backend: "claude-code",
		cwd: current.cwd,
		runtimeArgs: ["--resume", current.nativeSessionId],
	});
	if (!launched.ok) {
		return { ok: false, reason: "launch-refused", detail: `${launched.reason} — ${launched.hint}` };
	}
	const observation = await observeReceiverReattached(
		targetGardenId,
		current,
		{ ownerPid: marker.ownerPid, ownerStartKey: marker.ownerStartKey, attachIncarnation: current.attachIncarnation },
		launched.handle.panePid,
		deps,
	);
	return {
		ok: true,
		launch: {
			backend: "claude-code",
			targetGardenId,
			nativeSessionId: current.nativeSessionId,
			handle: launched.handle,
		},
		observation,
	};
}

/**
 * ONE bounded operation, the Claude Code twin of `observeSameGidSocket`: wait for a NEW live owner
 * — in the pane this call opened (`panePid`), a join, not an address — to re-arm this garden id's
 * receiver marker for the same native session with a fresh binding the current record carries
 * (same createdAt). The dead marker read again is never success: the owner must differ from the one
 * the dormancy proof judged dead, and the binding from the one it bound. A marker armed by some
 * other process is simply not-yet, and ends as `resume-unobserved`. A record or store defect is not
 * a startup state: it stops the wait at once as `record-unreadable`, with its cause.
 */
export async function observeReceiverReattached(
	targetGardenId: string,
	identity: ClaudeCodeLaunchIdentity,
	previous: { ownerPid: number; ownerStartKey: string; attachIncarnation: string },
	panePid: string,
	deps: Pick<VisibleResumeDeps, "inspectReceiver" | "resolveIdentity" | "sleep" | "now">,
	timeoutMs: number = RESUME_OBSERVE_TIMEOUT_MS,
	intervalMs: number = RESUME_OBSERVE_INTERVAL_MS,
): Promise<ReceiverObservationReceipt> {
	const started = deps.now();
	for (;;) {
		const seen = deps.inspectReceiver(targetGardenId);
		if (
			seen.kind === "marker" &&
			seen.owner === "live" &&
			seen.marker.gardenId === targetGardenId &&
			seen.marker.backend === "claude-code" &&
			seen.marker.nativeSessionId === identity.nativeSessionId &&
			String(seen.marker.ownerPid) === panePid &&
			(seen.marker.ownerPid !== previous.ownerPid || seen.marker.ownerStartKey !== previous.ownerStartKey) &&
			seen.marker.attachIncarnation !== null &&
			seen.marker.attachIncarnation !== previous.attachIncarnation
		) {
			let current: LaunchIdentity;
			try {
				current = deps.resolveIdentity(targetGardenId);
			} catch (err) {
				return {
					kind: "record-unreadable",
					cause: err instanceof Error ? err.message : String(err),
					waitedMs: deps.now() - started,
				};
			}
			if (
				current.backend === "claude-code" &&
				current.nativeSessionId === identity.nativeSessionId &&
				current.createdAt === identity.createdAt &&
				current.attachIncarnation === seen.marker.attachIncarnation
			) {
				return { kind: "receiver-armed", ownerPid: seen.marker.ownerPid, waitedMs: deps.now() - started };
			}
		}
		if (deps.now() - started >= timeoutMs) {
			return { kind: "resume-unobserved", waitedMs: deps.now() - started };
		}
		await deps.sleep(intervalMs);
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

// The static record/liveness hint text is authored in root ENTWURF.json (#154 C1-C); the reasons,
// this total table and the renderer stay here. acp-model-not-curated keeps the shared ACP constant,
// and the launch-stage mux hints folded into `detail` stay behind the mux import fence.
const REJECT_HINT: Record<VisibleResumeRejectReason, string> = {
	"target-invalid": ENTWURF_RESUME_REJECT_HINTS["target-invalid"],
	"target-backend-unsupported": ENTWURF_RESUME_REJECT_HINTS["target-backend-unsupported"],
	"acp-model-not-curated": ACP_MODEL_NOT_CURATED_HINT,
	"target-locked": ENTWURF_RESUME_REJECT_HINTS["target-locked"],
	"target-live": ENTWURF_RESUME_REJECT_HINTS["target-live"],
	"target-indeterminate": ENTWURF_RESUME_REJECT_HINTS["target-indeterminate"],
	"target-receiver-absent": ENTWURF_RESUME_REJECT_HINTS["target-receiver-absent"],
	"target-receiver-corrupt": ENTWURF_RESUME_REJECT_HINTS["target-receiver-corrupt"],
	"target-receiver-mismatch": ENTWURF_RESUME_REJECT_HINTS["target-receiver-mismatch"],
	"target-receiver-unbound": ENTWURF_RESUME_REJECT_HINTS["target-receiver-unbound"],
	"target-address-conflict": ENTWURF_RESUME_REJECT_HINTS["target-address-conflict"],
	"launch-refused": ENTWURF_RESUME_REJECT_HINTS["launch-refused"],
};

/**
 * ONE renderer — the same reason `mux-fresh-call` has one: it keeps the operator-visible answer
 * out of the registration literal. (Since #125 the MCP bridge is the only registration; the
 * native pi copy it once had to agree with is retired.)
 *
 * The success text keeps the two receipts visibly apart, including in the good case. A reader
 * who sees "window opened" and "socket alive" as one sentence has been told the resume worked;
 * a reader who sees them as two facts can tell which one is missing when only one is there.
 */
export function renderVisibleResume(
	result: VisibleResumeResult,
	attribution: { actor: string | null } = { actor: null },
): { text: string; isError: boolean } {
	if (!result.ok) {
		return {
			text:
				`entwurf_resume_call rejected: ${result.reason} — ${REJECT_HINT[result.reason]}. ` +
				`${result.detail}. No window was opened.`,
			isError: true,
		};
	}
	const h = result.launch.handle;
	// Who asked is recorded, and it is not authority: the verb decides from the target's record and
	// live rail facts alone, whoever the caller is.
	const actor =
		attribution.actor === null
			? `  actor:    unattributed (the caller has no record-backed garden identity)\n`
			: `  actor:    ${attribution.actor} (record-backed caller; attribution, not authority)\n`;
	const window =
		`  runtime:  ${h.runtimePath} (requested start cwd ${h.cwd})\n` +
		`  window:   ${h.windowId} (index ${h.windowIndex}) in session ${h.sessionId}\n` +
		`  pane:     ${h.paneId} pid ${h.panePid}\n`;
	if (result.launch.backend === "claude-code") {
		const observation = result.observation as ReceiverObservationReceipt;
		return {
			text:
				`[entwurf resume call ↻]\n` +
				`  target:   ${result.launch.targetGardenId}\n` +
				`  backend:  claude-code\n` +
				`  session:  ${result.launch.nativeSessionId}\n` +
				window +
				actor +
				`\n` +
				`LAUNCH receipt: tmux created that window and was asked to start claude --resume on the session above.\n` +
				(observation.kind === "receiver-armed"
					? `OBSERVATION receipt: receiver-armed — a NEW live Claude Code process in the window this call opened ` +
						`(pid ${observation.ownerPid}) re-armed the receiver marker of ${result.launch.targetGardenId} for the ` +
						`same session after ${observation.waitedMs}ms, with a fresh arm binding the record also carries ` +
						`(same createdAt). entwurf_v2 fire-and-forget now reaches its mailbox. This call submitted no ` +
						`prompt; the runtime's own activity after resume (e.g. a doorbell on unread mail) is unmeasured.`
					: observation.kind === "record-unreadable"
						? `OBSERVATION receipt: record-unreadable — the record of ${result.launch.targetGardenId} could not be ` +
							`read after ${observation.waitedMs}ms: ${observation.cause}. The window is open and visible; the ` +
							`lock was released, nothing was retried, and nothing was killed.`
						: `OBSERVATION receipt: resume-unobserved — no new live receiver marker from the window this call ` +
							`opened, bound to the record, appeared within ${observation.waitedMs}ms. The window is open and ` +
							`visible; read it directly. The lock was released, nothing was retried, and nothing was killed.`),
			isError: false,
		};
	}
	const observation = result.observation as ResumeObservationReceipt;
	const observed = observation.kind === "socket-alive";
	return {
		text:
			`[entwurf resume call ↻]\n` +
			`  target:   ${result.launch.targetGardenId}\n` +
			`  session:  ${result.launch.sessionFile}\n` +
			window +
			actor +
			`\n` +
			`LAUNCH receipt: tmux created that window and was asked to start pi on the transcript above.\n` +
			(observed
				? `OBSERVATION receipt: the control socket for ${result.launch.targetGardenId} answered after ` +
					`${observation.waitedMs}ms — that citizen is addressable again, and entwurf_v2 fire-and-forget ` +
					`now reaches it. No turn was run by this call.`
				: `OBSERVATION receipt: resume-unobserved — the control socket did not answer within ` +
					`${observation.waitedMs}ms. The window is open and visible; read it directly. The lock was ` +
					`released, nothing was retried, and nothing was killed.`),
		isError: false,
	};
}
