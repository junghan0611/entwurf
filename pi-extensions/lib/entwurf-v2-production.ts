/**
 * entwurf-v2-production — 5d-2b: the ctx-free PRODUCTION assembly of `runEntwurfV2`'s deps.
 * `makeProductionEntwurfV2Deps(opts)` wires the real 5b decider IO seams + the three 5c
 * transport hands into one `EntwurfV2RunDeps` (`{decide, executor}`). It touches NO
 * `ExtensionContext`/`ExtensionAPI` — the wiring SITE (5d-3, entwurf-control.ts) builds the
 * `senderProvider` from `buildLocalSenderEnvelope(ctx)` and passes it in, so this module
 * stays in `lib/` with the rest of the gate-/smoke-testable v2 core.
 *
 * Three invariants this factory exists to guarantee (each gate-proven):
 *   - ONE lock domain (Q2/QB3). A single `release` closure bound to `lockDir` is the lock
 *     authority for EVERY hand: the decider's `releaseLock` and the control-send hand's
 *     `releaseLock`. (A third hand used to share it — the spawn watcher's `releaseFn`,
 *     whose own default would have released into the DEFAULT lock dir; that split-brain
 *     went with the transport, the single-authority rule did not.)
 *   - ONE mailbox sender (Q3). A single `makeProductionSendViaMailbox` instance is the
 *     top-level meta-mailbox hand AND the control-send dead-fallback's mailbox enqueue, so a
 *     direct send and a fallback send never drift in sender envelope / dirs.
 *   - ONE path set (Q5). `sessionsDir`/`mailboxDir`/`lockDir`/`controlSocketDir` are resolved
 *     ONCE and threaded to the decider, the dead-fallback resolver, and the enqueue, so the
 *     plan the decider plants and the plan the fallback plants address the same store.
 *
 * `resolveTarget` (QB1): a MISSING meta-record is a soft `bad-target` (identity:null); a
 * PRESENT-but-corrupt record fails LOUD (the read throws drift) — never matched by string.
 * "Corrupt" includes a record that does not hold its `nativeSessionId` alone (#52): the read
 * here is the ADDRESSABLE one, so the store-wide uniqueness half runs at this boundary and
 * nowhere cheaper. Absent stays soft; ambiguous never does.
 * `preProbeAddressConflict` (QB2): a single record-side `lstat` (NO connect) of the target's
 * canonical socket path; `indeterminate` (EACCES/unknown) fails loud rather than silently
 * claiming "no conflict". The decider's later `inspectSocket` probe is a SEPARATE step.
 */

import {
	type RpcClientOptions,
	type RpcCommand,
	type RpcResponse,
	sendRpcCommand as realSendRpc,
	type SenderEnvelope,
} from "./entwurf-control-rpc.ts";
import {
	type MailboxDeliverabilityResult,
	mailboxConversationalDeliverable,
	resolveMailboxReceiverFacts,
} from "./entwurf-deliverability.ts";
import { isOutOfSocketDomainGardenIdConflict } from "./entwurf-facts.ts";
import { isLivenessSupported } from "./entwurf-v2-contract.ts";
import {
	type DispatchDeciderDeps,
	type DispatchInput,
	decideDispatch,
	type TargetResolution,
} from "./entwurf-v2-decider.ts";
import {
	type AcquireLockResult,
	ENTWURF_V2_LOCK_DIR,
	type LockClaim,
	acquireLock as realAcquireLock,
	releaseLock as realReleaseLock,
} from "./entwurf-v2-lock.ts";
import { makeProductionSendViaMailbox } from "./entwurf-v2-mailbox.ts";
import { makeNativePushSend } from "./entwurf-v2-native-push.ts";
import type { DispatchExecutorDeps, EntwurfV2RunDeps } from "./entwurf-v2-runner.ts";
import {
	type ControlSocketPlan,
	type ControlSocketSendDeps,
	executeControlSocketSend,
	type MetaMailboxPlan,
	type RpcSendResult,
} from "./entwurf-v2-send.ts";
import { resolveDeadControlSendFallback } from "./entwurf-v2-send-fallback.ts";
import {
	defaultMetaMailboxDir,
	defaultMetaSessionsDir,
	type EnqueueMetaMessageOptions,
	type EnqueueMetaMessageResult,
	enqueueMetaMessage,
	type MetaIdentity,
	type MetaReceiverMarker,
	type MetaSenderMarker,
	metaCapabilityFor,
	metaRecordExistsByGardenId,
	readAddressableMetaIdentity,
	readMetaReceiverMarker,
	readMetaSenderMarker,
	requireBackend,
} from "./meta-session.ts";
import {
	type NativePushAdapter,
	type NativePushProbeResult,
	resolveNativePushAdapter as realResolveNativePushAdapter,
} from "./native-push/adapter.ts";
import {
	CONTROL_SOCKET_DIR,
	controlSocketPath,
	inspectControlSocketPath,
	inspectTargetControlSocket,
	isRecordLessSocketCandidate,
	type TargetSocketInspection,
} from "./socket-discovery.ts";
import { classifyConnectError, probeSocketLiveness, type SocketLiveness } from "./socket-probe.ts";

/**
 * The leaf IO the production factory calls. Every field defaults to the REAL fn; the 5d-2b
 * gate overrides them with spies to prove the wiring (shared closures, lockDir binding,
 * shared mailbox instance) WITHOUT a real socket/lock/meta-record. This is the only seam —
 * the factory's COMPOSITION (which closure goes to which hand) is never overridable.
 */
export interface ProductionEntwurfV2Seams {
	metaRecordExists: (gid: string, sessionsDir: string) => boolean;
	/** The ADDRESSABLE read (#52): the per-entry contract plus store-wide `nativeSessionId`
	 * uniqueness. This is a dispatch, so the id it returns is about to become an address —
	 * a duplicate here would direct-inject one native session under two garden ids. */
	readIdentity: (gid: string, sessionsDir: string) => MetaIdentity;
	/** Read the target's receiver presence marker (null = absent / dead owner / corrupt). The
	 * SE-2 2d-3 active-receiver source; the factory's `mailboxDeliverabilityFor` closure verifies
	 * its identity match. */
	readReceiverMarker: (gardenId: string) => MetaReceiverMarker | null;
	/** Read the sender marker keyed to a receiver's owner pid — the "which garden does this
	 * process serve NOW?" fact the #101 watch-owner join reads. Null = absent / dead owner /
	 * corrupt, which the join treats as a retired watch inside its scope. */
	readSenderMarker: (backend: string, ownerPid: number) => MetaSenderMarker | null;
	/** Record-side lstat of the EXACT target socket path (no connect) for the pre-probe conflict. */
	inspectPath: (socketPath: string) => Promise<TargetSocketInspection>;
	acquireLock: (gid: string, deps: { dir?: string }) => AcquireLockResult;
	releaseLock: (claim: LockClaim, deps: { dir?: string }) => unknown;
	inspectSocket: (gid: string, dir: string) => Promise<TargetSocketInspection>;
	probeSocket: (socketPath: string) => Promise<SocketLiveness>;
	classifyConnect: (code: string | undefined) => "dead" | "indeterminate";
	sendRpc: (socketPath: string, command: RpcCommand, options?: RpcClientOptions) => Promise<{ response: RpcResponse }>;
	enqueue: (opts: EnqueueMetaMessageOptions) => EnqueueMetaMessageResult;
	/** Resolve the native-push adapter for a backend id (봉인 4). The SAME resolver feeds the
	 * decider's `nativePushProbe` AND the executor's `sendNativePush`, so a single injected
	 * fake adapter drives both the probe (routing decision) and the send (delivery + retry).
	 * Default: the real registry resolver. */
	resolveNativePushAdapter: (backend: string) => NativePushAdapter;
}

export interface ProductionEntwurfV2Opts {
	/** Built at the wiring site from `buildLocalSenderEnvelope(ctx)`, decorated with its
	 * HONEST pi-session replyability (SE-1 2e-a: `replyable` reflects whether the canonical
	 * control socket actually exists, not a hardcoded true). ONE provider feeds the
	 * control-socket RPC sender AND the meta-mailbox body sender (they share the envelope). */
	senderProvider: () => SenderEnvelope | undefined;
	lockDir?: string;
	sessionsDir?: string;
	mailboxDir?: string;
	controlSocketDir?: string;
	/** Gate/smoke seam overrides — defaults are the real IO. */
	seams?: Partial<ProductionEntwurfV2Seams>;
}

/** Map a record-side socket inspection to the singleton (socketGids, symlinkedGids) the
 * `isOutOfSocketDomainGardenIdConflict` predicate consumes. `indeterminate` fails LOUD (QB2): an
 * unprovable conflict must NOT be folded to "no conflict" — that would silently allow an
 * unsupported-backend mailbox send onto a quarantined address. */
function conflictSetsFor(
	gid: string,
	inspection: TargetSocketInspection,
): { socketGids: ReadonlySet<string>; symlinkedGids: ReadonlySet<string> } {
	switch (inspection.kind) {
		case "absent":
			return { socketGids: new Set(), symlinkedGids: new Set() };
		case "socket-file":
			return { socketGids: new Set([gid]), symlinkedGids: new Set() };
		case "address-conflict":
			// symlink → the symlink axis; not-socket → a non-symlink `.sock` entry, same axis
			// the fact-provider's `socketGids` carries (NOT only real sockets).
			return inspection.reason === "symlink"
				? { socketGids: new Set(), symlinkedGids: new Set([gid]) }
				: { socketGids: new Set([gid]), symlinkedGids: new Set() };
		case "indeterminate":
			throw new Error(
				`entwurf-v2-production: cannot resolve target ${gid} — its control socket lstat is indeterminate (${inspection.error}); refusing to claim "no address conflict".`,
			);
	}
}

/**
 * Assemble the production `runEntwurfV2` deps. See the module header for the three wiring
 * invariants. The returned `{ decide, executor }` is exactly the shape `runEntwurfV2` joins.
 */
export function makeProductionEntwurfV2Deps(opts: ProductionEntwurfV2Opts): EntwurfV2RunDeps {
	// ── ONE path set (Q5): resolve every dir ONCE ─────────────────────────────
	const lockDir = opts.lockDir ?? ENTWURF_V2_LOCK_DIR;
	const sessionsDir = opts.sessionsDir ?? defaultMetaSessionsDir();
	const mailboxDir = opts.mailboxDir ?? defaultMetaMailboxDir();
	const controlSocketDir = opts.controlSocketDir ?? CONTROL_SOCKET_DIR;

	const s = opts.seams ?? {};
	const io: ProductionEntwurfV2Seams = {
		metaRecordExists: s.metaRecordExists ?? metaRecordExistsByGardenId,
		readIdentity: s.readIdentity ?? readAddressableMetaIdentity,
		readReceiverMarker: s.readReceiverMarker ?? ((gid: string) => readMetaReceiverMarker({ gardenId: gid })),
		readSenderMarker:
			s.readSenderMarker ??
			((backend: string, ownerPid: number) => readMetaSenderMarker({ backend: requireBackend(backend), ownerPid })),
		inspectPath: s.inspectPath ?? inspectControlSocketPath,
		acquireLock: s.acquireLock ?? realAcquireLock,
		releaseLock: s.releaseLock ?? realReleaseLock,
		inspectSocket: s.inspectSocket ?? inspectTargetControlSocket,
		probeSocket: s.probeSocket ?? probeSocketLiveness,
		classifyConnect: s.classifyConnect ?? classifyConnectError,
		sendRpc: s.sendRpc ?? realSendRpc,
		enqueue: s.enqueue ?? enqueueMetaMessage,
		resolveNativePushAdapter: s.resolveNativePushAdapter ?? realResolveNativePushAdapter,
	};

	// ── ONE lock domain (Q2/QB3): a single lockDir-bound release for ALL hands ─
	const acquire = (gid: string): AcquireLockResult => io.acquireLock(gid, { dir: lockDir });
	const release = (claim: LockClaim): void => {
		io.releaseLock(claim, { dir: lockDir });
	};

	// ── ONE mailbox sender (Q3): one instance for the hand AND the dead-fallback ─
	const sendViaMailbox = makeProductionSendViaMailbox({
		senderProvider: opts.senderProvider,
		enqueue: io.enqueue,
	});

	// ── ONE deliverability seam (SE-2 2d-3): wake-mode capability AND a live active-
	// receiver. The SAME closure is injected into the decider AND the dead-fallback, so a
	// direct send and a re-resolved fallback send can never drift to different deliverability
	// verdicts. recordBacked is true by construction — resolveTarget already proved the record
	// exists before any unsupported-backend mailbox route, and the closure is only consulted on
	// that route. A null / dead-owner / identity-mismatched marker is fail-closed to inactive
	// (SE-2): a reply to a terminated self-fetch citizen is rejected, not enqueued as mailbox
	// garbage.
	//
	// The two receiver facts come from the SHARED composition (#101 결함 B), never from one
	// value copied into both slots. `ownerAlive` is the marker↔identity match on a live owner;
	// `watchArmed` is the separate measurement that this owner is STILL serving this garden.
	// They were the same expression until a Claude session switch inside one pid left a retired
	// garden's marker reading as an armed doorbell and a real message rotted unread in its
	// mailbox. `entwurf_self` calls the same composition, so a citizen's own replyability can
	// never disagree with what dispatch decided about it. ──────────
	const mailboxDeliverabilityFor = (identity: MetaIdentity): MailboxDeliverabilityResult => {
		const wakeMode = metaCapabilityFor(identity.backend).wakeMode;
		const { ownerAlive, watchArmed } = resolveMailboxReceiverFacts(identity, {
			readReceiverMarker: io.readReceiverMarker,
			readSenderMarker: io.readSenderMarker,
		});
		return mailboxConversationalDeliverable({
			wakeMode,
			recordBacked: true,
			ownerAlive,
			watchArmed,
		});
	};

	// ── target resolution (QB1 + QB2) ─────────────────────────────────────────
	const resolveTarget = async (gid: string): Promise<TargetResolution> => {
		// MISSING record → not a citizen. A record-LESS, gid-shaped, NON-SYMLINK control
		// socket is still distinguished from a plain absent gid (#50 C4): the decider
		// rejects it as `record-less-socket` (a diagnostic state) instead of the
		// `bad-target` "absent" lie. This is PROBE-FREE — a single `inspectPath` lstat
		// (NO connect), the SAME seam the pre-probe conflict uses — and
		// `isRecordLessSocketCandidate` counts ONLY a confirmed non-symlink socket
		// (`socket-file`); symlink/absent/not-socket/indeterminate stay a plain
		// bad-target. PRESENT record → read (drift/corrupt throws = fail-loud).
		if (!io.metaRecordExists(gid, sessionsDir)) {
			const inspection = await io.inspectPath(controlSocketPath(gid, controlSocketDir));
			return {
				identity: null,
				preProbeAddressConflict: false,
				recordLessSocket: isRecordLessSocketCandidate(inspection),
			};
		}
		const identity = io.readIdentity(gid, sessionsDir);
		// This pre-probe conflict applies only OUTSIDE the control-socket capability domain.
		// An in-domain target's lstat/connect MUST run under the later per-target lock, so it
		// short-circuits here with no pre-lock IO. Otherwise an indeterminate lstat would be
		// stolen from the under-lock `inspectSocket → indeterminate-no-spawn` path.
		if (isLivenessSupported(identity.backend)) {
			return { identity, preProbeAddressConflict: false };
		}
		// Only a citizen outside the control-socket domain reaches this record-side lstat;
		// `indeterminate` fails loud (QB2 — never silently "no conflict").
		const inspection = await io.inspectPath(controlSocketPath(gid, controlSocketDir));
		const { socketGids, symlinkedGids } = conflictSetsFor(gid, inspection);
		const preProbeAddressConflict = isOutOfSocketDomainGardenIdConflict(
			identity.backend,
			gid,
			socketGids,
			symlinkedGids,
		);
		return { identity, preProbeAddressConflict };
	};

	const inspectSocket = (gid: string): Promise<TargetSocketInspection> => io.inspectSocket(gid, controlSocketDir);
	const probeSocket = (socketPath: string): Promise<SocketLiveness> => io.probeSocket(socketPath);

	// ── decider deps (5b) ─────────────────────────────────────────────────────
	const deciderDeps: DispatchDeciderDeps = {
		resolveTarget,
		acquireLock: acquire,
		releaseLock: release,
		inspectSocket,
		probeSocket,
		mailboxDeliverabilityFor,
		// 봉인 4: resolve the native-push adapter for this backend + probe the conversation.
		// Only reached on a nativePushSupported backend (the decider gates it), so the resolver
		// never throws for a non-native-push backend here.
		nativePushProbe: (identity: MetaIdentity): Promise<NativePushProbeResult> =>
			Promise.resolve(io.resolveNativePushAdapter(identity.backend).probe(identity.nativeSessionId)),
		mailboxDir,
		sessionsDir,
	};

	// ── control-send hand deps (5c-2): the dead-fallback shares resolveTarget /
	// inspect / probe / dirs with the decider; the mailbox enqueue is the SAME
	// `sendViaMailbox` instance; the release is the SAME `release` closure. ─────
	const controlSendDeps: ControlSocketSendDeps = {
		sendOverSocket: async (plan: ControlSocketPlan): Promise<RpcSendResult> => {
			const { response } = await io.sendRpc(plan.socketPath, {
				type: "send",
				message: plan.message,
				mode: plan.mode,
				wants_reply: plan.wantsReply,
				sender: opts.senderProvider(),
			});
			return { success: response.success, error: response.error };
		},
		classifyConnect: io.classifyConnect,
		releaseLock: release,
		deadFallback: (plan: ControlSocketPlan, lock: LockClaim) =>
			resolveDeadControlSendFallback(plan, lock, {
				resolveTarget,
				inspectSocket,
				probeSocket,
				mailboxDeliverabilityFor,
				mailboxDir,
				sessionsDir,
			}),
		sendViaMailbox,
	};

	// ── executor: the three transport hands, each pre-bound ───────────────────
	const executor: DispatchExecutorDeps = {
		sendControl: (plan, lock) => executeControlSocketSend(plan as ControlSocketPlan, lock, controlSendDeps),
		sendMailbox: (plan, _lock) => sendViaMailbox(plan as MetaMailboxPlan, _lock as LockClaim),
		// native-push (봉인 4): the SAME injected adapter resolver drives the executor send,
		// so the decider's probe and the delivery use one adapter. Lock-free (lock ignored).
		sendNativePush: makeNativePushSend({ resolveAdapter: io.resolveNativePushAdapter }),
	};

	return {
		decide: (input: DispatchInput) => decideDispatch(input, deciderDeps),
		executor,
	};
}
