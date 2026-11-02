/**
 * entwurf-v2-visible-resume — stand a dormant pi, pi-durable or Claude Code citizen back up in a window
 * (or herdr tab) the operator can see, under the same garden id, and say only what was actually observed.
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
 *   pi-durable   dormant = THIS process could reserve the session's directory D (#157 B3): the
 *                owner-fence claim's holder is proven dead, or it closed clean, and the record and
 *                its C4 location agree — decided by `reservePiDurableSession` inside its own
 *                record-arm then S_D holds, under the per-target lock this module already holds as
 *                the outer scope. The launched child adopts that one reservation from its closed
 *                context. Back = its adoption write: the claim carries this reservation's generation
 *                as its `adoptedFrom` — an adoption, never readiness, liveness or a turn.
 *
 * Every other backend is the leaf's named refusal. The argv is a fixed table per backend; the caller
 * supplies only the target.
 *
 * ── Where this sits ──
 *
 *   surface (entwurf-control.ts · mcp bridge index.ts)   composition root: supplies `launch`
 *     └─ entwurf-v2-visible-resume  (this file)          v2 leaves ONLY: lock, record, socket
 *          └─ deps.launch(argv, cwd)  ── INJECTED SEAM ──→ fresh-call-dispatch (shared rail choice)
 *                                                         ├→ mux-resume-call → placement leaf
 *                                                         └→ herdr-resume-call (inside herdr, pi only)
 *
 * The seam is what keeps `docs/mux-launch-rail.md` §11 intact in both directions: v2 never
 * imports mux, mux never imports entwurf core. This module cannot open a window; it can only
 * ask whoever wired it to. That is deliberate — it means the delivery fence stays exactly where
 * `check-mux-launch` scans for it. The herdr rail (#157 G1a) reaches it through the same seam and
 * the same fence: this module imports no herdr module either, and learns which rail ran only from
 * the `rail` its launch handle carries. A herdr launch is two mutations (tab create, then agent
 * start), so the seam may also answer with a failure AFTER something was created; that is its own
 * result, never a refusal that says no window was opened.
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
 * `launch` says tmux made a window (or, for pi or pi-durable inside herdr, herdr made a tab) and was
 * asked to start the runtime. `observation` says whether the citizen came back under the same id (pi:
 * its socket; pi-durable: a child's adoption of the reservation; Claude Code: its receiver marker).
 * Neither says the resumed citizen did anything. This verb submits no prompt. For pi a resume ran
 * no turn (measured 2026-08-06, pi only — the transcript stayed byte-identical); for Claude Code
 * the runtime's own activity after resume (its SessionStart hook re-arms the doorbell, and unread
 * mail may then wake a turn) is unmeasured, so this module claims no turn outcome either way.
 * The socket-only description in the observation section above is the pi half; the Claude Code
 * half reads the receiver marker and the record instead.
 */

import path from "node:path";
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
	defaultMetaMailboxDir,
	defaultMetaReceiversDir,
	defaultMetaSendersDir,
	defaultMetaSessionsDir,
	type MarkerOwnerVerdict,
	metaReceiverMarkerPath,
	parseMetaReceiverMarker,
	probePidExistence,
	processStartKey,
	readStoreRecordFile,
} from "./meta-session.ts";
import {
	observePiDurableReservation,
	PiDurableOwnerFenceError,
	type PiDurableReservation,
	type PiDurableReservationObservation,
	type PiDurableWrittenClaim,
	reservePiDurableSession,
	withdrawPiDurableReservation,
} from "./pi-durable-owner-fence.ts";
import {
	type ClaudeCodeLaunchIdentity,
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
 * `target-backend-unsupported` IS in here, and the line between it and those throws is worth
 * stating: asking to resume a Codex or agy citizen is not a defect at all. Nothing is corrupt, the
 * record is exactly right, and the operator has simply reached past a capability boundary — only
 * pi, pi-durable and Claude Code have a same-id resume. That deserves a named refusal a caller can act on, not
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

/** What the injected launcher gives back. Structural on purpose: naming mux's or herdr's types here
 * would be the import this split exists to avoid. `rail` says which one ran. */
export interface VisibleResumeTmuxLaunchHandle {
	rail: "tmux";
	serverPid: string;
	sessionId: string;
	windowId: string;
	windowIndex: string;
	paneId: string;
	panePid: string;
	runtimePath: string;
	cwd: string;
}

/** The herdr rail's handle (#157 G1a): what herdr was ASKED to start, the requested directory, and
 * herdr's VIEW coordinates. No tmux field is invented for it — it has no server pid, window or
 * resolved runtime path, and the pane pid the Claude Code observation joins on does not exist here. */
export interface VisibleResumeHerdrLaunchHandle {
	rail: "herdr";
	requestedKind: string;
	cwd: string;
	herdrAgentName: string;
	herdrWorkspaceId: string;
	herdrTabId: string;
	herdrPaneId: string;
	herdrTerminalId: string;
}

export type VisibleResumeLaunchHandle = VisibleResumeTmuxLaunchHandle | VisibleResumeHerdrLaunchHandle;

/** #157 B3: the herdr rail's pi-durable resume — ONE layout.apply, so herdr's layout reply is the whole
 * receipt: the launcher asked for, the requested directory and herdr's VIEW coordinates. No agent name
 * and no terminal id exist for it, which is why it carries its own rail tag: a pi resume handed one
 * fails loud rather than rendering fields it never had. */
export interface VisibleResumeHerdrLayoutLaunchHandle {
	rail: "herdr-layout";
	runtime: string;
	cwd: string;
	herdrWorkspaceId: string;
	herdrTabId: string;
	herdrPaneId: string;
}

/**
 * #157 B3: the pi-durable adopt launch projection (L3-A1 §1) — EXACTLY five names: the SDK's own
 * profile input carrying the reservation's raw profile, and the standard children of the
 * reservation's ONE meta root. A fixed projection of those two coordinates, never an env dictionary.
 */
export interface PiDurableAdoptEnv {
	PI_CODING_AGENT_DIR: string;
	ENTWURF_META_SESSIONS_DIR: string;
	ENTWURF_META_MAILBOX_DIR: string;
	ENTWURF_META_SENDERS_DIR: string;
	ENTWURF_META_RECEIVERS_DIR: string;
}

/** What the launch seam is asked to open. pi and Claude Code carry the record's argv only; a
 * pi-durable adoption also carries its fixed projection, and nothing else can. */
export type VisibleResumeLaunchInput =
	| { backend: "pi" | "claude-code"; cwd: string; runtimeArgs: readonly string[] }
	| { backend: "pi-durable"; cwd: string; runtimeArgs: readonly string[]; piDurableAdoptEnv: PiDurableAdoptEnv };

/** A launch that failed AFTER it created something (on herdr: after the tab create). The vendor's
 * own code when it gave one, what is out there now, and the created coordinates when the create reply
 * was read. Recovery is structural for the same reason the handles are. Only the herdr rail can fail
 * after a mutation today (tmux opens its window in one step), and `rail` says so rather than leaving
 * the renderer to assume it: `herdr-layout` is the pi-durable rail's ONE layout.apply (#157 B3), whose
 * classifier answers only none or unknown and which has no tab create step of its own. */
export interface VisibleResumeLaunchFailure {
	rail: "herdr" | "herdr-layout";
	vendorCode?: string;
	recovery:
		| { outcome: "none" }
		| { outcome: "unknown" }
		| { outcome: "closed"; paneId: string; terminalId: string }
		| { outcome: "orphan-unreclaimed"; paneId: string; reason: string };
	created?: { herdrWorkspaceId: string; herdrTabId: string; herdrPaneId: string; herdrTerminalId: string };
}

export type VisibleResumeLaunchOutcome =
	| { ok: true; handle: VisibleResumeLaunchHandle | VisibleResumeHerdrLayoutLaunchHandle }
	/** Refused before anything was created. */
	| { ok: false; reason: string; hint: string }
	| { ok: false; reason: string; hint: string; failure: VisibleResumeLaunchFailure };

/** Fact 1: tmux created a window — or, for pi or pi-durable inside herdr, herdr created a tab — and
 * was asked to start the citizen's runtime there. `cwd` is the REQUESTED start directory (what the placement owner
 * was told), the same kind of fact as `runtimePath` — not an observation of where the pane landed.
 * The Claude Code receipt is tmux-only: its observation joins the tmux pane pid. */
export type ResumeLaunchReceipt =
	| { backend: "pi"; targetGardenId: string; sessionFile: string; handle: VisibleResumeLaunchHandle }
	| {
			backend: "claude-code";
			targetGardenId: string;
			nativeSessionId: string;
			handle: VisibleResumeTmuxLaunchHandle;
	  }
	/** #157 B3: the reservation is part of the launch fact — the window or tab was opened FOR it. */
	| {
			backend: "pi-durable";
			targetGardenId: string;
			cwd: string;
			reservation: { generation: string; resource: string; ownerPid: number };
			handle: VisibleResumeTmuxLaunchHandle | VisibleResumeHerdrLayoutLaunchHandle;
	  };

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

/**
 * Fact 2 for pi-durable (#157 B3): what the reservation's D claim says, read by ONE bounded operation.
 * `adopted` is an adoption WRITE by some child (the claim carries this reservation's generation as its
 * `adoptedFrom`), not readiness, liveness, an attach or a turn; `not-yet-adopted` is still this
 * reservation when the wait ended; `reservation-lost` is any other claim the strict reader accepted;
 * `unobserved` is a claim that could not be read, with its named cause — never folded into lost.
 */
export type PiDurableAdoptionObservationReceipt =
	| { kind: "adopted"; waitedMs: number }
	| { kind: "not-yet-adopted"; waitedMs: number }
	| { kind: "reservation-lost"; waitedMs: number }
	| { kind: "unobserved"; reason: string; detail: string; waitedMs: number };

export type VisibleResumeResult =
	| {
			ok: true;
			launch: ResumeLaunchReceipt;
			observation: ResumeObservationReceipt | ReceiverObservationReceipt | PiDurableAdoptionObservationReceipt;
	  }
	| { ok: false; reason: VisibleResumeRejectReason; detail: string }
	/** The launch failed after it created something. Not a refusal: something may be open, so this is
	 * never rendered as "No window was opened". No observation runs after it. */
	| { ok: false; reason: "launch-failed"; detail: string; failure: VisibleResumeLaunchFailure };

export interface VisibleResumeDeps {
	acquireLock: (gardenId: string) => AcquireLockResult;
	releaseLock: (claim: LockClaim) => ReleaseResult;
	resolveIdentity: (gardenId: string) => LaunchIdentity;
	inspectSocket: (gardenId: string) => Promise<TargetSocketInspection>;
	probeSocket: (socketPath: string) => Promise<SocketLiveness>;
	/** The Claude Code dormancy proof and observation read this; pi never does. */
	inspectReceiver: (gardenId: string) => ReceiverInspection;
	/** The ONLY way this module reaches tmux or herdr. The surface supplies it; the herdr rail is
	 * asynchronous (its CLI runner must not block the caller's event loop), so this is awaited. */
	launch: (input: VisibleResumeLaunchInput) => VisibleResumeLaunchOutcome | Promise<VisibleResumeLaunchOutcome>;
	/** #157 B3, pi-durable only: reserve D for one child, record-arm then S_D, both released before
	 * this returns. The per-target lock this module holds stays the outer scope and is never retaken. */
	reservePiDurable: (gardenId: string) => Promise<PiDurableReservation>;
	/** Withdraw THIS process's own reservation, only once its launch is definitely none-created. */
	withdrawPiDurable: (reservation: PiDurableReservation) => Promise<void>;
	/** What the reservation's D claim says now: a read, never a watch. */
	observePiDurable: (reservation: PiDurableReservation) => PiDurableReservationObservation;
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
		// The four roots THIS process resolves now, handed to the reserve as given: a split shape is
		// the reserve's own named refusal, never merged here.
		reservePiDurable: (gid) =>
			reservePiDurableSession({
				gardenId: gid,
				roots: {
					sessionsDir: defaultMetaSessionsDir(),
					mailboxDir: defaultMetaMailboxDir(),
					sendersDir: defaultMetaSendersDir(),
					receiversDir: defaultMetaReceiversDir(),
				},
			}),
		withdrawPiDurable: (reservation) => withdrawPiDurableReservation(reservation),
		observePiDurable: (reservation) => observePiDurableReservation(reservation),
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
						`${targetGardenId} is a ${err.backend} citizen; only pi, pi-durable and Claude Code citizens can be reopened ` +
						`under the same garden id`,
				};
			}
			throw err;
		}

		if (identity.backend === "claude-code") return await resumeClaudeCode(targetGardenId, identity, deps);
		if (identity.backend === "pi-durable") return await resumePiDurable(targetGardenId, deps);

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
		const launched = await deps.launch({ backend: "pi", cwd: identity.cwd, runtimeArgs });
		if (!launched.ok) return launchNotLaunched(launched);
		// Only a pi-durable launch carries a layout handle (#157 B3). Handed to a pi resume, it is a
		// wiring defect, not an outcome: whatever was opened stays as it is and the lock is released.
		if (launched.handle.rail === "herdr-layout") {
			throw new Error(
				`entwurf-v2-visible-resume: the launcher handed a pi resume of ${targetGardenId} a herdr-layout handle — ` +
					`only a pi-durable resume launches through layout.apply. Nothing was observed or closed.`,
			);
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
 * A launch that did not become a launch, kept in its own shape. A refusal created nothing and is
 * `launch-refused`. A failure that carries what it created (herdr: after the tab create) is
 * `launch-failed`, with the vendor code, recovery and coordinates passed through untouched — folding
 * it into a refusal is what would print "No window was opened" over a tab that may be on screen.
 * Neither is retried, and neither is followed by an observation.
 */
function launchNotLaunched(
	launched: Extract<VisibleResumeLaunchOutcome, { ok: false }>,
	note = "",
): VisibleResumeResult {
	const detail = `${launched.reason} — ${launched.hint}${note}`;
	return "failure" in launched
		? { ok: false, reason: "launch-failed", detail, failure: launched.failure }
		: { ok: false, reason: "launch-refused", detail };
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

	const launched = await deps.launch({
		backend: "claude-code",
		cwd: current.cwd,
		runtimeArgs: ["--resume", current.nativeSessionId],
	});
	if (!launched.ok) return launchNotLaunched(launched);
	// The observation below joins the receiver marker's owner to the TMUX pane pid. The composition
	// refuses a Claude Code resume on every other rail before it creates anything, so a non-tmux handle
	// here is a wiring defect, not an outcome: it fails loud rather than watching for a pid that does
	// not exist. Whatever that launcher opened is left as it is; the lock is still released.
	if (launched.handle.rail !== "tmux") {
		throw new Error(
			`entwurf-v2-visible-resume: the launcher handed a Claude Code resume of ${targetGardenId} a ${launched.handle.rail} ` +
				`handle — its observation joins a tmux pane pid, which no other rail carries. Nothing was observed or closed.`,
		);
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
 * #157 B3: the adopt launch for ONE reservation — the managed verb with its closed context
 * `{v:1, gardenId, metaRoot, sourceGeneration}` (no session, cwd, profile, model, prompt, module,
 * nonce or callback rides it), the reservation's cwd, and the fixed five-name projection of its raw
 * profile and its meta root. Pure: it reads nothing and writes nothing.
 */
export function buildPiDurableAdoptLaunch(
	reservation: Pick<PiDurableReservation, "gardenId" | "metaRoot" | "generation" | "profile" | "cwd">,
): Extract<VisibleResumeLaunchInput, { backend: "pi-durable" }> {
	const { metaRoot } = reservation;
	const context = {
		v: 1,
		gardenId: reservation.gardenId,
		metaRoot,
		sourceGeneration: reservation.generation,
	};
	return {
		backend: "pi-durable",
		cwd: reservation.cwd,
		runtimeArgs: ["pi-durable", "--entwurf-adopt", JSON.stringify(context)],
		piDurableAdoptEnv: {
			PI_CODING_AGENT_DIR: reservation.profile,
			ENTWURF_META_SESSIONS_DIR: path.join(metaRoot, "meta-sessions"),
			ENTWURF_META_MAILBOX_DIR: path.join(metaRoot, "meta-mailbox"),
			ENTWURF_META_SENDERS_DIR: path.join(metaRoot, "meta-senders"),
			ENTWURF_META_RECEIVERS_DIR: path.join(metaRoot, "meta-receivers"),
		},
	};
}

/**
 * A reserve refusal this verb answers by name; every other fence refusal keeps its own cause. A live holder is not
 * an address (S3 joint review D4): a reservation's parent is a bridge waiting for a child, which entwurf_v2 cannot
 * reach, and any other live holder is a process this verb did not judge contact-ready — so neither answer tells the
 * caller to send. The branch reads the refusal's structured holder state, never its message.
 */
function piDurableReserveRefusal(targetGardenId: string, err: PiDurableOwnerFenceError): VisibleResumeResult | null {
	if (err.reason === "owner-live") {
		if (err.holderState === "reserved") {
			return {
				ok: false,
				reason: "target-live",
				detail:
					`${targetGardenId}'s pi-durable session is reserved for a child to adopt by a live process (${err.message}); ` +
					`while that reservation stays unadopted under that live process a resume of ${targetGardenId} refuses on it; ` +
					`nothing clears it automatically, a child that adopts it becomes its holder, and entwurf_v2 does not reach a reservation`,
			};
		}
		return {
			ok: false,
			reason: "target-live",
			detail:
				`${targetGardenId}'s pi-durable session is held by a live process (${err.message}); if that process is the ` +
				`running citizen, entwurf_v2 reaches it only through the rail its own dispatch decides`,
		};
	}
	if (err.reason === "owner-uncertain" || err.reason === "owner-other-host") {
		return {
			ok: false,
			reason: "target-indeterminate",
			detail:
				`the holder of ${targetGardenId}'s pi-durable session could not be proven gone on this host (${err.message}), ` +
				`and resuming a session that is still open would put two processes on one transcript`,
		};
	}
	return null;
}

const messageOf = (err: unknown): string => (err instanceof Error ? err.message : String(err));

/**
 * A reserve whose write committed and whose lock release then failed (S3 joint review D3). It says only what that
 * call wrote and what its holder implies; the release's own words say what it left. Nothing is withdrawn, retried
 * or repaired here.
 */
function piDurableReservedThenFailed(
	targetGardenId: string,
	err: PiDurableOwnerFenceError,
	written: PiDurableWrittenClaim,
): string {
	const residue =
		err.reason === "tx-release-failed"
			? `; if the transaction file that release named remains, that process ending does not remove it, and it fails closed until an operator removes it`
			: "";
	return (
		`entwurf-v2-visible-resume: the reserve of ${targetGardenId} WROTE its reservation of ${written.resource} at ` +
		`generation ${written.generation} for pid ${written.ownerPid}, then a lock release failed (${err.message}). ` +
		`Nothing was launched and nothing withdrew that reservation: while it stays unadopted under live pid ` +
		`${written.ownerPid}, a resume of ${targetGardenId} refuses, and nothing clears it automatically${residue}`
	);
}

/**
 * A withdrawal that failed (S3 joint review D1). Only what the failure itself records is stated: a write this call
 * made, or a transaction file the release left; any other failure leaves the claim's state unestablished here.
 */
function piDurableWithdrawFailed(
	targetGardenId: string,
	held: string,
	reservation: PiDurableReservation,
	err: unknown,
): string {
	const residue = `if that transaction file remains, this process ending does not remove it, and it fails closed until an operator removes it`;
	if (err instanceof PiDurableOwnerFenceError && err.written !== undefined) {
		return (
			` — this call wrote the withdrawal of ${held} (the claim back to the donor's ${err.written.state} row at ` +
			`generation ${err.written.generation}), then releasing its transaction failed (${err.message}); ${residue}`
		);
	}
	if (err instanceof PiDurableOwnerFenceError && err.reason === "tx-release-failed") {
		return (
			` — withdrawing ${held} FAILED at its transaction release (${err.message}); whether this call ` +
			`wrote anything is not recorded, and ${residue}`
		);
	}
	return (
		` — withdrawing ${held} FAILED (${messageOf(err)}); what its claim holds now is not established here: while it ` +
		`stays reserved, unadopted, under this live process (pid ${reservation.owner.pid}), a resume of ${targetGardenId} ` +
		`refuses`
	);
}

/**
 * The pi-durable half (#157 B3), still under the caller's per-target lock, which stays the outer
 * scope: the reserve takes record-arm then S_D itself and releases both before it returns, so before
 * any launch. A reserve that refuses on eligibility writes nothing; a reserve whose lock release fails AFTER its
 * write is named as such (its `written`), with the reservation it left. Neither opens anything.
 *
 * From the reservation on, this process holds D for one child, and what happens to that hold is
 * decided by the launch outcome alone (L3-A1 §6), never by a guess:
 *
 *   no launch request was made                         definitely none created → withdraw
 *   the seam refused (`ok:false`, no `failure`)        the seam's contract: refused before anything was
 *                                                      created (tmux: one of its named reasons; herdr:
 *                                                      decided before the layout write) → withdraw
 *   a failure whose recovery is `none`                 that rail's own none-created certainty → withdraw
 *   a failure whose recovery is anything else          something MAY exist → the reservation is KEPT
 *   the launcher threw                                 unknown, whatever its position → KEPT
 *   a launch                                           a child may adopt it → KEPT, then observed once
 *
 * A withdrawal that fails is reported with the refusal it followed and is never retried. A kept
 * reservation is said so in the answer: it names this process as its holder, and while it stays unadopted
 * under this live process a later resume of the same id refuses; nothing clears it automatically, and a
 * child that adopts it becomes its holder.
 */
async function resumePiDurable(targetGardenId: string, deps: VisibleResumeDeps): Promise<VisibleResumeResult> {
	let reservation: PiDurableReservation;
	try {
		reservation = await deps.reservePiDurable(targetGardenId);
	} catch (err) {
		if (err instanceof PiDurableOwnerFenceError) {
			const refused = piDurableReserveRefusal(targetGardenId, err);
			if (refused !== null) return refused;
			// A release that failed after the reservation was WRITTEN (S3 joint review D3): the reservation exists,
			// so the answer names it and what it blocks, beside the release's own cause; nothing launches or withdraws.
			if (err.written !== undefined) throw new Error(piDurableReservedThenFailed(targetGardenId, err, err.written));
		}
		throw err;
	}
	const held = `${targetGardenId}'s reservation of ${reservation.resource} at generation ${reservation.generation}`;
	const withdraw = async (): Promise<string> => {
		try {
			await deps.withdrawPiDurable(reservation);
			return ` — ${held} was withdrawn, since nothing was created`;
		} catch (err) {
			return piDurableWithdrawFailed(targetGardenId, held, reservation, err);
		}
	};
	const kept =
		` — ${held} was KEPT, because something may exist that can still adopt it; it names this process ` +
		`(pid ${reservation.owner.pid}) as its holder: while it stays unadopted under this live process a resume of ` +
		`${targetGardenId} refuses, nothing clears it automatically, and a child that adopts it becomes its holder`;

	let input: ReturnType<typeof buildPiDurableAdoptLaunch>;
	try {
		input = buildPiDurableAdoptLaunch(reservation);
	} catch (err) {
		throw new Error(`entwurf-v2-visible-resume: ${messageOf(err)}${await withdraw()}`);
	}
	let launched: VisibleResumeLaunchOutcome;
	try {
		launched = await deps.launch(input);
	} catch (err) {
		throw new Error(
			`entwurf-v2-visible-resume: the pi-durable launch of ${targetGardenId} threw: ${messageOf(err)}${kept}`,
		);
	}
	if (!launched.ok) {
		const noneCreated = !("failure" in launched) || launched.failure.recovery.outcome === "none";
		return launchNotLaunched(launched, noneCreated ? await withdraw() : kept);
	}
	// A herdr agent-start handle belongs to the pi rail only: a pi-durable resume launches through
	// tmux or ONE layout.apply. Handed one, it is a wiring defect; what was opened stays as it is.
	if (launched.handle.rail === "herdr") {
		throw new Error(
			`entwurf-v2-visible-resume: the launcher handed a pi-durable resume of ${targetGardenId} a herdr agent-start ` +
				`handle — nothing was observed or closed${kept}`,
		);
	}
	const observation = await observePiDurableAdoption(reservation, deps);
	return {
		ok: true,
		launch: {
			backend: "pi-durable",
			targetGardenId,
			cwd: reservation.cwd,
			reservation: {
				generation: reservation.generation,
				resource: reservation.resource,
				ownerPid: reservation.owner.pid,
			},
			handle: launched.handle,
		},
		observation,
	};
}

/**
 * ONE bounded operation, the pi-durable twin of `observeSameGidSocket` (#157 B3): read the
 * reservation's D claim until a child's adoption write carries its generation, the claim is lost or
 * unreadable, or the same fixed wait ends. Every read is the fence's strict reader; nothing here
 * writes, withdraws, retries or watches past the deadline. A read that throws past that reader stops
 * the wait as `unobserved` with its cause: the window is open, and the launch receipt must survive.
 */
export async function observePiDurableAdoption(
	reservation: PiDurableReservation,
	deps: Pick<VisibleResumeDeps, "observePiDurable" | "sleep" | "now">,
	timeoutMs: number = RESUME_OBSERVE_TIMEOUT_MS,
	intervalMs: number = RESUME_OBSERVE_INTERVAL_MS,
): Promise<PiDurableAdoptionObservationReceipt> {
	const started = deps.now();
	for (;;) {
		let seen: PiDurableReservationObservation;
		try {
			seen = deps.observePiDurable(reservation);
		} catch (err) {
			return { kind: "unobserved", reason: "observe-threw", detail: messageOf(err), waitedMs: deps.now() - started };
		}
		if (seen.class === "adopted") return { kind: "adopted", waitedMs: deps.now() - started };
		if (seen.class === "lost") return { kind: "reservation-lost", waitedMs: deps.now() - started };
		if (seen.class === "unobserved") {
			return { kind: "unobserved", reason: seen.reason, detail: seen.detail, waitedMs: deps.now() - started };
		}
		if (deps.now() - started >= timeoutMs) return { kind: "not-yet-adopted", waitedMs: deps.now() - started };
		await deps.sleep(intervalMs);
	}
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
		if (result.reason === "launch-failed") return renderLaunchFailed(result);
		return {
			text:
				`entwurf_resume_call rejected: ${result.reason} — ${REJECT_HINT[result.reason]}. ` +
				`${result.detail}. No window was opened.`,
			isError: true,
		};
	}
	// Who asked is recorded, and it is not authority: the verb decides from the target's record and
	// live rail facts alone, whoever the caller is.
	const actor =
		attribution.actor === null
			? `  actor:    unattributed (the caller has no record-backed garden identity)\n`
			: `  actor:    ${attribution.actor} (record-backed caller; attribution, not authority)\n`;
	// #157 B3: pi-durable has its own receipts (a reservation, an adoption), on either rail.
	if (result.launch.backend === "pi-durable") {
		return renderPiDurableResume(result.launch, result.observation as PiDurableAdoptionObservationReceipt, actor);
	}
	const h = result.launch.handle;
	// The herdr rail has its own coordinates and its own words; the tmux text below stays as it was.
	if (h.rail === "herdr") return renderHerdrPiResume(result, h, actor);
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

/**
 * The pi-durable resume (#157 B3), on tmux or on herdr's one layout.apply. Three facts kept apart: the
 * reservation this process holds, the LAUNCH that was asked to adopt it, and what the D claim said
 * after one bounded read. `adopted` says a child wrote its adoption — not that it is ready, alive,
 * attached, addressable or that anything was recalled; entwurf_peers is where its rail is read.
 */
function renderPiDurableResume(
	launch: Extract<ResumeLaunchReceipt, { backend: "pi-durable" }>,
	observation: PiDurableAdoptionObservationReceipt,
	actor: string,
): { text: string; isError: boolean } {
	const h = launch.handle;
	const place = h.rail === "tmux" ? "window" : "tab";
	const where =
		h.rail === "tmux"
			? `  runtime:  ${h.runtimePath} pi-durable --entwurf-adopt (requested start cwd ${h.cwd})\n` +
				`  window:   ${h.windowId} (index ${h.windowIndex}) in session ${h.sessionId}\n` +
				`  pane:     ${h.paneId} pid ${h.panePid}\n`
			: `  runtime:  ${h.runtime} pi-durable --entwurf-adopt (requested start cwd ${h.cwd})\n` +
				`  tab:      ${h.herdrTabId} in workspace ${h.herdrWorkspaceId} — a NEW tab from ONE layout.apply, opened without taking focus\n` +
				`  pane:     ${h.herdrPaneId} — herdr VIEW coordinates, not an address\n`;
	const r = launch.reservation;
	const heldBy = `this process (pid ${r.ownerPid})`;
	const observed =
		observation.kind === "adopted"
			? `OBSERVATION receipt: adopted — after ${observation.waitedMs}ms the claim of ${r.resource} carries generation ` +
				`${r.generation} as its adoptedFrom: a child process wrote its adoption of this reservation. That is not ` +
				`readiness, liveness, an attach, a turn or a recall — entwurf_peers shows whether its rail answers. This ` +
				`call submitted no prompt.`
			: observation.kind === "not-yet-adopted"
				? `OBSERVATION receipt: not-yet-adopted — after ${observation.waitedMs}ms the claim of ${r.resource} was still ` +
					`this reservation. The ${place} is open and visible; read it directly. The reservation stays held by ` +
					`${heldBy}: a child there can still adopt it and become its holder; while it stays unadopted under this live ` +
					`process a resume of ${launch.targetGardenId} refuses, and nothing clears it automatically. Nothing was ` +
					`retried, withdrawn or killed.`
				: observation.kind === "reservation-lost"
					? `OBSERVATION receipt: reservation-lost — after ${observation.waitedMs}ms the claim of ${r.resource} ` +
						`names neither this reservation nor an adoption of it (another owner, a reclaim or a withdrawal ` +
						`replaced it). The ${place} is open; read it directly. Nothing was retried or killed.`
					: `OBSERVATION receipt: unobserved — the claim of ${r.resource} could not be read after ` +
						`${observation.waitedMs}ms (${observation.reason}: ${observation.detail}). The ${place} is open and ` +
						`visible; nothing was retried, withdrawn or killed.`;
	return {
		text:
			`[entwurf resume call ↻${h.rail === "tmux" ? "" : " herdr"}]\n` +
			`  target:   ${launch.targetGardenId}\n` +
			`  backend:  pi-durable\n` +
			`  reserved: ${r.resource} at generation ${r.generation}, held by ${heldBy} for one child to adopt\n` +
			where +
			actor +
			`\n` +
			`LAUNCH receipt: ${h.rail === "tmux" ? "tmux created that window" : "herdr created that tab"} and was asked to ` +
			`start the managed entwurf pi-durable with the closed adopt context of the reservation above, its raw ` +
			`profile as PI_CODING_AGENT_DIR and its meta root's four ENTWURF_META_*_DIR children as its launch env, ` +
			`in the record's cwd.\n` +
			observed,
		isError: false,
	};
}

/**
 * The pi resume on the herdr rail (#157 G1a). Same two receipts, kept apart the same way; the
 * coordinates are herdr's VIEW of a tab, and herdr's own readiness or session report is not consulted
 * — the same-gid control socket is the observation on both rails.
 */
function renderHerdrPiResume(
	result: Extract<VisibleResumeResult, { ok: true }>,
	h: VisibleResumeHerdrLaunchHandle,
	actor: string,
): { text: string; isError: boolean } {
	if (result.launch.backend !== "pi") {
		throw new Error(
			"entwurf-v2-visible-resume: a herdr launch handle arrived on a non-pi resume — only pi has a herdr resume rail",
		);
	}
	const observation = result.observation as ResumeObservationReceipt;
	const observed = observation.kind === "socket-alive";
	return {
		text:
			`[entwurf resume call ↻ herdr]\n` +
			`  target:   ${result.launch.targetGardenId}\n` +
			`  session:  ${result.launch.sessionFile}\n` +
			`  runtime:  requested kind ${h.requestedKind} — herdr resolves the executable, we did not (requested start cwd ${h.cwd})\n` +
			`  tab:      ${h.herdrTabId} in workspace ${h.herdrWorkspaceId} — a NEW tab beside the caller's, opened without taking focus\n` +
			`  pane:     ${h.herdrPaneId} terminal ${h.herdrTerminalId} — herdr VIEW coordinates, not an address\n` +
			`  agent:    ${h.herdrAgentName} (herdr's name for this launch, random per call)\n` +
			actor +
			`\n` +
			`LAUNCH receipt: herdr created that tab and was asked to start pi on the transcript above.\n` +
			(observed
				? `OBSERVATION receipt: the control socket for ${result.launch.targetGardenId} answered after ` +
					`${observation.waitedMs}ms — that citizen is addressable again, and entwurf_v2 fire-and-forget ` +
					`now reaches it. No turn was run by this call. herdr's own agent status was not consulted.`
				: `OBSERVATION receipt: resume-unobserved — the control socket did not answer within ` +
					`${observation.waitedMs}ms. The tab is open and visible; read it directly. The lock was ` +
					`released, nothing was retried, and nothing was closed.`),
		isError: false,
	};
}

/**
 * A launch that failed after it created something. The header claims no more than the recovery
 * knows — the fresh herdr rail learned that the hard way: `none` means herdr declined by name before
 * making anything, `unknown` means no answer we can act on so a tab MAY exist, and anything else means
 * the tab was created and the recovery says whether its pane was closed. No observation ran, so this
 * says nothing about whether the citizen came back.
 */
function renderLaunchFailed(result: Extract<VisibleResumeResult, { reason: "launch-failed" }>): {
	text: string;
	isError: boolean;
} {
	const f = result.failure;
	const tabHeader =
		f.recovery.outcome === "none"
			? "entwurf_resume_call failed at the herdr tab create step"
			: f.recovery.outcome === "unknown"
				? "entwurf_resume_call failed at the herdr tab create step with an UNKNOWN outcome"
				: "entwurf_resume_call failed after the herdr tab was created";
	// #157 B3: the pi-durable rail asks herdr for ONE layout.apply. Its classifier answers only none or
	// unknown, so anything but none is UNKNOWN, and there is no tab create step to name.
	const layout = f.rail === "herdr-layout";
	const header = layout
		? `entwurf_resume_call failed at the herdr layout.apply step${f.recovery.outcome === "none" ? "" : " with an UNKNOWN outcome"}`
		: tabHeader;
	const code = f.vendorCode === undefined ? "" : ` [herdr: ${f.vendorCode}]`;
	const created =
		f.created === undefined
			? ""
			: `  created:  tab ${f.created.herdrTabId} in workspace ${f.created.herdrWorkspaceId}, pane ${f.created.herdrPaneId} ` +
				`terminal ${f.created.herdrTerminalId} — herdr VIEW coordinates, not an address\n`;
	const recovery =
		f.recovery.outcome === "none"
			? layout
				? "  recovery: none — the layout request was never written, or herdr declined it by name before making anything, so there is nothing to go look at\n"
				: "  recovery: none — herdr declined by name before making anything, so there is nothing to go look at\n"
			: f.recovery.outcome === "unknown"
				? "  recovery: UNKNOWN — we never got an answer we can act on, so a tab MAY exist that this call cannot name. Nothing was closed; check herdr\n"
				: f.recovery.outcome === "closed"
					? `  recovery: closed ${f.recovery.paneId} (its terminal still matched the create receipt; the new tab went with it unless something else had joined it)\n`
					: `  recovery: orphan-unreclaimed:${f.recovery.reason} (${f.recovery.paneId}) — this pane was NOT closed, on purpose\n`;
	return {
		text:
			`${header}: ${result.detail}.${code}\n` +
			created +
			recovery +
			`No observation was attempted, so this says nothing about whether the citizen came back — entwurf_peers ` +
			`shows whether its ${layout ? "rail" : "control socket"} answers. The lock was released and nothing was retried.`,
		isError: true,
	};
}
