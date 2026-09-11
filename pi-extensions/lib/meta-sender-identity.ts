/**
 * meta-sender-identity — WHO is calling this MCP child?
 *
 * A native backend (Claude Code, agy) spawns the entwurf-bridge MCP server as a child of the
 * same process that runs its session hook. The hook writes a sender marker keyed by ITS parent
 * pid; the child looks a marker up under its own parent. That shared ancestor is the join key —
 * NOT cwd (one repo can hold many sessions) and not a wire field (neither host carries one).
 *
 * Measured 2026-07-13 on both backends: hook.ppid == bridge.ppid == the native host pid, same
 * start-key. Later, the same Claude Code version produced both that direct join and a retained
 * `/bin/bash -c` command-hook wrapper; ordinary shell tests did not reproduce the difference, so
 * its trigger inside Claude's spawn path stayed unknown — and that is why the shell form was
 * abandoned rather than patched. The plugin now declares the EXEC form, which puts no shell on
 * the launch path at all (#51 B2, 2026-07-22), so the hook's parent IS Claude structurally and
 * the marker is written under plain `process.ppid`. The extra `parentPid(ppid)` read candidate
 * remains compatibility for an MCP host wrapper; the hook never writes a blind grandparent
 * marker because that may be the long-lived login shell.
 *
 * Three guards make a marker an IDENTITY rather than a hint, and a candidate is only trusted
 * after ALL of them pass:
 *   0. a PLAUSIBLE owner (isPlausibleOwnerPid, shared with both writers and the generation cut):
 *      pid <= 1 cannot own a session, and guard 1 cannot catch it — for as long as the host
 *      is up, init IS still the very process the marker named. This is a rule about the
 *      marker's CLAIM, not about the owner's state, which is why it is asked first and is
 *      not opt-out (#53 A).
 *   1. pid + start-key (readMetaSenderMarker): the owner is still the very process that wrote it,
 *      so a dead session's pid, reused by something else, cannot inherit its garden-id.
 *   2. the backing meta-record: the record store is the authority — a marker whose record was
 *      deleted, or whose backend/nativeSessionId drifted from it, names nobody. A record that
 *      EXISTS but cannot be read (a previous-generation record, a corrupt body) is a THROW instead
 *      (EntwurfSenderRecordUnreadableError): the cause is knowable, so folding it into
 *      "names nobody" would misreport the failure and hide the fresh-cut pointer (F10).
 *
 * Every candidate is collected and validated BEFORE one is chosen. A first-match loop would make
 * the answer depend on which pid or backend happened to be read first; here lookup order carries
 * no meaning, and two live identities are a refusal rather than a race.
 *
 * A SECOND RAIL LIVES BELOW THE MARKER RAIL, and it does not share this one's join key.
 * Codex names its caller on EVERY `tools/call` (`_meta.threadId` plus an
 * `x-codex-turn-metadata.{session_id,thread_id}` block), and its parent pid cannot separate
 * citizens at all: in the delivery-capable launch mode every hook and every MCP child of N
 * live threads resolves to the ONE app-server pid, so a pid marker would be one marker for N
 * citizens — exactly what the store's `nativeSessionId` uniqueness forbids (measured
 * 2026-09-08, `scripts/raw-codex-measure/README.md` S1b-C/S1b-D). So the codex resolver is
 * REQUEST-scoped, not process-scoped: see {@link resolveCodexRequestSenderIdentity}. The two
 * rails never merge — `codex` is deliberately absent from {@link META_SENDER_BACKENDS}, since
 * a backend listed there is one whose hook writes a pid marker, and codex birth writes none.
 */

import {
	defaultMetaSessionsDir,
	describe,
	isPlausibleOwnerPid,
	listAllMetaIdentities,
	type MetaBackend,
	type MetaIdentity,
	type MetaSenderMarker,
	makeStoreRecordReader,
	metaRecordExistsByGardenId,
	parentPid,
	readActiveStoreEntries,
	readMetaIdentityByGardenId,
	readMetaSenderMarker,
} from "./meta-session.ts";
import { type NativePushAdapter, resolveNativePushAdapter } from "./native-push/adapter.ts";

/** Every native backend that mints a garden-id from its own hook and writes a sender marker.
 *
 * WRITER AND READER OPEN TOGETHER OR NOT AT ALL. A backend listed here whose hook writes no
 * marker costs one wasted directory read; a backend whose hook writes a marker but is absent
 * here is INVISIBLE — the bridge holds the owner pid, never looks in that directory, and the
 * citizen's sends are refused as anonymous for a reason nothing in the log names. That was
 * exactly the #46 defect on agy, and copilot joined the list only once its own hook wrote one
 * (#82 RAIL 5b). Membership says a marker may EXIST, never that a reply can land: the reply
 * rail is chosen from `nativePushSupported` at the bridge, not from this list. */
export const META_SENDER_BACKENDS: readonly MetaBackend[] = ["claude-code", "antigravity", "copilot", "omp"];

/** A marker that passed BOTH guards, together with the record that vouches for it. */
export interface TrustedMetaSender {
	marker: MetaSenderMarker;
	identity: MetaIdentity;
}

/**
 * Two live native sessions claim this MCP process as their own. We can SEE both identities but
 * cannot say which one is calling, so we send under neither. Choosing by lookup order, backend
 * priority, or recency would attribute a message to a citizen that did not write it; falling back
 * to anonymous would hide an identity we already hold. Both are the SE-1 shape — a layer answering
 * "yes" where the truth is unknown — so this is a hard refusal, not a warning.
 *
 * WHAT THIS CAN AND CANNOT SEE. It fires only when the candidate pids yield MORE THAN ONE marker
 * FILE naming different citizens — two backends on one pid, or the two candidate pids naming
 * different citizens. It CANNOT see two conversations of the same backend racing under one host
 * pid: they share the single marker path `<senders>/<backend>/<pid>.json`, so the later hook write
 * overwrites the earlier one and only one identity is ever on disk. That case is guarded by a
 * runtime invariant instead (a native host serializes its model invocations), not by this error —
 * do not read a green resolver as proof that same-process concurrency is safe.
 */
export class EntwurfSenderIdentityAmbiguityError extends Error {
	readonly gardenIds: string[];
	constructor(gardenIds: string[]) {
		super(
			"entwurf-bridge refused: ambiguous sender identity. This MCP process's owner pid carries live, " +
				`record-backed sender markers for MORE than one garden citizen (${gardenIds.join(", ")}), so which ` +
				"one is calling cannot be determined. A send under the wrong identity is worse than no send — one " +
				"native host process appears to be driving several sessions at once. Report it; do not work around it.",
		);
		this.name = "EntwurfSenderIdentityAmbiguityError";
		this.gardenIds = gardenIds;
	}
}

/**
 * A live sender marker names a garden citizen whose record file EXISTS but cannot be READ
 * (a record from a previous generation, or a corrupt body). This is a hard stop, never a
 * downgrade: the caller has an identity — it is just unreadable — so resolving to
 * anonymous/"no marker" would report a false cause and prescribe a useless fix (re-opening
 * the session re-mints the same unreadable state; observed live as F10). The quoted cause
 * carries the record reader's own message, which names the fresh-cut verb.
 */
export class EntwurfSenderRecordUnreadableError extends Error {
	readonly gardenId: string;
	constructor(marker: MetaSenderMarker, cause: Error) {
		super(
			`entwurf-bridge refused: this process's sender marker is live and names garden id ` +
				`${marker.gardenId} (backend ${marker.backend}, owner pid ${marker.ownerPid}), but that ` +
				`citizen's meta-record cannot be read: ${cause.message} ` +
				`This is NOT a missing-marker problem — re-opening the session will not fix it; ` +
				`the record itself must become readable first.`,
		);
		this.name = "EntwurfSenderRecordUnreadableError";
		this.gardenId = marker.gardenId;
	}
}

/** The record store is the authority; the marker is only a pid→garden hint it must agree with.
 * Three distinct outcomes, never collapsed (F10): a DELETED record → null (the marker names
 * nobody); a record that EXISTS but cannot be read → throw EntwurfSenderRecordUnreadableError
 * (the cause is knowable and nameable — swallowing it reported "no marker", the wrong cause);
 * a readable record whose backend/nativeSessionId drifted from the marker → null (stale hint). */
function trustMarker(marker: MetaSenderMarker): TrustedMetaSender | null {
	if (!metaRecordExistsByGardenId(marker.gardenId)) return null;
	let identity: MetaIdentity;
	try {
		identity = readMetaIdentityByGardenId(marker.gardenId);
	} catch (err) {
		throw new EntwurfSenderRecordUnreadableError(marker, err instanceof Error ? err : new Error(String(err)));
	}
	if (identity.backend !== marker.backend || identity.nativeSessionId !== marker.nativeSessionId) return null;
	return { marker, identity };
}

export interface ResolveTrustedMetaSenderOptions {
	/** Explicit marker file (explicit wiring / gates). Wins over the pid scan, same validation. */
	markerPath?: string;
	/** Candidate owner pids. Defaults to this process's parent and one step above it. */
	ownerPids?: number[];
	/** Marker root (gates isolate it; production reads the ENTWURF_META_SENDERS_DIR SSOT). */
	sendersDir?: string;
}

/**
 * Resolve the ONE identity that owns this MCP process, or refuse.
 *
 * 0 trusted → null (the bridge then refuses the send by default, #50 C4 — anonymous
 *   goes out only under the explicit ENTWURF_BRIDGE_ALLOW_ANONYMOUS_SENDER=1 hatch).
 * 1 trusted → that identity.
 * 2+ distinct → throw EntwurfSenderIdentityAmbiguityError.
 * a marker whose record exists but cannot be read → throw EntwurfSenderRecordUnreadableError
 *   (a previous-generation/corrupt record is a knowable cause, never folded into "no marker" — F10).
 *
 * Markers that agree on the SAME garden-id are not a conflict: an older release wrote a marker for
 * the parent AND the grandparent, and both can still sit on disk pointing at one citizen.
 */
export function resolveTrustedMetaSenderIdentity(opts: ResolveTrustedMetaSenderOptions = {}): TrustedMetaSender | null {
	const markers: MetaSenderMarker[] = [];
	if (opts.markerPath) {
		const marker = readMetaSenderMarker({ markerPath: opts.markerPath });
		if (marker) markers.push(marker);
	} else {
		// The candidate filter asks the same question the marker readers ask — CAN this
		// pid own a session — so it uses the same predicate rather than a second `> 0`
		// literal. The default set is only the bridge's parent and grandparent, so init
		// enters it just when the native host itself was reparented (a detached/daemonized
		// Claude): narrow, but reachable, and a candidate that cannot be an owner has no
		// business reaching the read at all (#53 A).
		const ownerPids = (opts.ownerPids ?? [process.ppid, parentPid(process.ppid) ?? 0]).filter(isPlausibleOwnerPid);
		for (const ownerPid of [...new Set(ownerPids)]) {
			for (const backend of META_SENDER_BACKENDS) {
				const marker = readMetaSenderMarker({ backend, ownerPid, sendersDir: opts.sendersDir });
				if (marker) markers.push(marker);
			}
		}
	}

	const byGardenId = new Map<string, TrustedMetaSender>();
	for (const marker of markers) {
		const trusted = trustMarker(marker);
		if (trusted) byGardenId.set(trusted.identity.gardenId, trusted);
	}

	const distinct = [...byGardenId.values()];
	if (distinct.length === 0) return null;
	if (distinct.length > 1) throw new EntwurfSenderIdentityAmbiguityError(distinct.map((t) => t.identity.gardenId));
	return distinct[0];
}

/**
 * Can a reply to THIS native-push citizen actually land? Only an adapter probe can say: a reply is
 * a direct injection into a live app-server conversation, and the route is re-discovered on every
 * probe. This is the `replyable` fact for a native-push sender — it must never be inferred from the
 * mailbox axis, which such a backend has no part in (보정①).
 *
 * ERROR POLICY (deliberate, and the reason this is not a `try { … } catch { return false }`): the
 * adapter already expresses every OPERATIONAL outcome as a value — `dead` (no host) and
 * `indeterminate` (host up, no port served it). So a THROW out of here is never a fact about the
 * citizen; it is a defect — an unresolvable adapter for a backend we just confirmed is native-push
 * (a registry bug), or a probe runner that could not run at all (a wiring bug). Folding those into
 * `replyable:false` would tell the receiver a lie about this sender AND bury the defect, which is
 * exactly the Crash-Don't-Warn shape this lane exists to remove. Let them propagate.
 */
export async function probeNativeSenderAlive(
	identity: Pick<MetaIdentity, "backend" | "nativeSessionId">,
	deps: { resolveAdapter?: (id: string) => Pick<NativePushAdapter, "probe"> } = {},
): Promise<boolean> {
	const resolveAdapter = deps.resolveAdapter ?? resolveNativePushAdapter;
	const probe = await resolveAdapter(identity.backend).probe(identity.nativeSessionId);
	return probe.status === "alive";
}

// ─────────────────────────────────────────────────────────────────────────────
// REQUEST-SCOPED SENDER IDENTITY — codex
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The provenance label the MANAGED codex MCP entry carries (`ENTWURF_BRIDGE_NATIVE_HOST=codex`
 * under `[mcp_servers.entwurf-bridge]` in the codex config the entwurf config writer owns).
 *
 * It is an OWNERSHIP/DRIFT atom, not authentication: any process able to write that config, or
 * to set that env on a child, can spell it. What it buys is the thing a codex bridge child
 * genuinely cannot observe otherwise — that THIS child was launched from an entwurf-managed
 * entry, so the request-scoped rail below is admitted deliberately rather than by sniffing.
 * The value travels to this resolver as an EXPLICIT ARGUMENT: nothing here reads the
 * environment, and in particular nothing here reads `ENTWURF_BRIDGE_EXTERNAL_AGENT_ID`, which
 * is the omp root-policy label with its own policy attached (`applyOmpBridgeChildRootPolicy`)
 * and must never double as a codex admission.
 */
export const CODEX_BRIDGE_PROVENANCE_LABEL = "codex";

/**
 * `clientInfo.name` every codex MCP client sends, and it is a FIXED VENDOR LITERAL —
 * `Implementation::new("codex-mcp-client", CARGO_PKG_VERSION).with_title("Codex")`
 * (`codex-mcp/src/rmcp_client.rs:1035-1039`, read at 0.153.4). `initialize` carries no
 * identity at all and is byte-identical between two children of two different threads, so this
 * name is a HOST-KIND gate and never an identity: it says "the peer on this stdio is a codex
 * client", which is precisely as much as startup can honestly say.
 */
export const CODEX_MCP_CLIENT_NAME = "codex-mcp-client";

/** The `_meta` member carrying the vendor turn-metadata block (`core/src/mcp_tool_call.rs`
 * `build_mcp_tool_call_request_meta`, :1238-1263). A dash-cased key, hence the string form. */
const CODEX_TURN_METADATA_KEY = "x-codex-turn-metadata";

/**
 * The codex caller's identity metadata is PRESENT but does not hold together: a `threadId` that
 * is not a nonempty string, a missing/foreign turn-metadata block, or three ids that disagree.
 *
 * WHY THIS IS LOUD AND NOT `null`. `null` on this rail means "no identity claim reached me" —
 * the bridge then refuses the send as anonymous, and the prescription is "open the session
 * through the installed codex birth hook". A HALF claim is a different fact with a different
 * cause (a vendor `_meta` shape that moved, or something imitating the codex client), and both
 * ids exist precisely so neither has to be trusted alone: `threadId` and
 * `x-codex-turn-metadata.session_id` are built by two different vendor call sites, and the
 * hook's `session_id` is byte-identical to both (measured 2026-09-08, S1b-D/D3). Selecting a
 * record from one field while its corroborator is absent or disagrees would address a citizen on
 * an unverified id — the SE-1 shape — so the disagreement is reported instead.
 */
export class EntwurfCodexIdentityMetadataError extends Error {
	constructor(reason: string) {
		super(
			"entwurf-bridge refused: this codex tool call carries identity metadata that does not hold " +
				`together — ${reason} A codex caller names itself on every call with THREE ids that must be one ` +
				`string: \`_meta.threadId\`, \`_meta.${CODEX_TURN_METADATA_KEY}.session_id\` and \`.thread_id\`. ` +
				"Selecting a garden citizen from a partial or self-contradicting claim would send under an " +
				"identity nothing vouched for. Report it; do not work around it — if the vendor `_meta` shape " +
				"moved, the measurement in scripts/raw-codex-measure/README.md (S1b-D) must be re-taken.",
		);
		this.name = "EntwurfCodexIdentityMetadataError";
	}
}

/**
 * The codex `threadId` selected exactly one V3 record — and that record is NOT a codex citizen.
 *
 * This is corruption of the native→garden mapping, never a miss: the store says some other
 * backend's session carries this exact native id. Returning `null` would report "no record for
 * this thread" and prescribe re-opening the session, which would mint a SECOND record for the
 * same `nativeSessionId` and turn a readable defect into the duplicate the certification
 * refuses. Sending under the foreign citizen is worse still — it would attribute a codex
 * caller's message to a claude-code/agy/pi session.
 */
export class EntwurfCodexIdentityBackendError extends Error {
	readonly gardenId: string;
	constructor(identity: MetaIdentity) {
		super(
			`entwurf-bridge refused: codex thread ${identity.nativeSessionId} selected meta-record ` +
				`${identity.gardenId}, but that citizen's backend is "${identity.backend}", not "codex". One ` +
				"native id is bound to one backend for the life of the record, so this store cannot say who the " +
				"caller is — and neither re-opening the codex session nor sending under the foreign citizen is a " +
				"fix. The record must be corrected (a fresh generation) before this thread can send.",
		);
		this.name = "EntwurfCodexIdentityBackendError";
		this.gardenId = identity.gardenId;
	}
}

/** A JSON OBJECT, as a narrowing guard — `typeof value === "object"` alone admits `null` and
 * arrays, and every codex identity field is read through a member access that both would
 * survive silently (`[]._meta` is `undefined`, not a type error). */
function isJsonObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** What the resolver is handed. Every field is UNKNOWN on purpose: three of them come off the
 * wire (an MCP peer may send any JSON) and the fourth is a config-written label, so none of
 * them may be typed as trusted at the boundary. */
export interface ResolveCodexRequestSenderOptions {
	/** The managed-entry provenance, supplied EXPLICITLY by the bridge (never read here). */
	provenance?: unknown;
	/** The peer's `initialize` `clientInfo` — a host-kind gate, never an identity. */
	clientInfo?: unknown;
	/** THIS request's `params._meta`. Per-call, because identity on codex is per-call. */
	requestMeta?: unknown;
	/** Record store override (gates isolate it; production reads the SSOT default). */
	sessionsDir?: string;
}

/**
 * The one codex caller a request names, as the RECORD describes it.
 *
 * `identity` is the whole answer: gardenId, cwd, model, transcriptPath and backend all come from
 * the record, never from the wire. `_meta` carries a `workspaces` map and a `model` field, and
 * both are IGNORED here — a caller that can name its own cwd/model can relabel a citizen by
 * asking, which is a write disguised as a read. `threadId` is retained only because it is the
 * SELECTOR that was proven equal to `identity.nativeSessionId`; it adds no new authority.
 */
export interface CodexRequestSender {
	identity: MetaIdentity;
	/** The wire id that selected the record; `=== identity.nativeSessionId` by construction. */
	threadId: string;
	/** The provenance that admitted this rail — always the codex label past the gate. */
	provenance: typeof CODEX_BRIDGE_PROVENANCE_LABEL;
}

/**
 * Read the caller's thread id out of ONE request, or refuse.
 *
 * `null` — this is not an admitted codex identity claim at all: no managed provenance, a peer
 * that is not the codex client, no `_meta` object, or an `_meta` with no `threadId` member
 * (`tools/list`, `initialize`, a non-turn call). All four are ordinary and carry no defect.
 *
 * THROWS {@link EntwurfCodexIdentityMetadataError} — a claim exists and is broken. The line
 * between the two is the PRESENCE of `threadId`: absent is a call that never claimed identity,
 * present-but-unusable is a claim that failed, and collapsing them would report "no identity"
 * for a caller that named itself.
 *
 * Pure: no fs, no env, no clock. The store lookup is the next function's job on purpose — this
 * half is the wire contract and can be pinned without a store at all.
 */
export function readCodexRequestThreadId(
	opts: Pick<ResolveCodexRequestSenderOptions, "provenance" | "clientInfo" | "requestMeta">,
): string | null {
	if (opts.provenance !== CODEX_BRIDGE_PROVENANCE_LABEL) return null;
	if (!isJsonObject(opts.clientInfo) || opts.clientInfo.name !== CODEX_MCP_CLIENT_NAME) return null;
	const meta = opts.requestMeta;
	if (!isJsonObject(meta)) return null;
	if (!("threadId" in meta)) return null;

	const threadId = meta.threadId;
	if (typeof threadId !== "string" || threadId.length === 0) {
		throw new EntwurfCodexIdentityMetadataError(
			`\`_meta.threadId\` is present but is not a nonempty string (got ${describe(threadId)}).`,
		);
	}
	const turn = meta[CODEX_TURN_METADATA_KEY];
	if (!isJsonObject(turn)) {
		throw new EntwurfCodexIdentityMetadataError(
			`\`_meta.threadId\` names ${threadId} but \`_meta.${CODEX_TURN_METADATA_KEY}\` is ${describe(turn)}, not an ` +
				"object, so the second, independently-built id that corroborates it is missing.",
		);
	}
	const sessionId = turn.session_id;
	const turnThreadId = turn.thread_id;
	if (typeof sessionId !== "string" || sessionId.length === 0) {
		throw new EntwurfCodexIdentityMetadataError(
			`\`_meta.${CODEX_TURN_METADATA_KEY}.session_id\` is not a nonempty string (got ${describe(sessionId)}) — ` +
				"that field is the one the birth hook also sees, so without it nothing joins the wire to a record.",
		);
	}
	if (typeof turnThreadId !== "string" || turnThreadId.length === 0) {
		throw new EntwurfCodexIdentityMetadataError(
			`\`_meta.${CODEX_TURN_METADATA_KEY}.thread_id\` is not a nonempty string (got ${describe(turnThreadId)}).`,
		);
	}
	if (sessionId !== threadId || turnThreadId !== threadId) {
		throw new EntwurfCodexIdentityMetadataError(
			`the three ids disagree (threadId=${threadId}, session_id=${sessionId}, thread_id=${turnThreadId}); ` +
				"on a healthy codex turn they are one byte-identical string.",
		);
	}
	return threadId;
}

/**
 * Resolve the ONE codex citizen a request names, or refuse.
 *
 * `null` — no admitted claim ({@link readCodexRequestThreadId}), or no record holds that
 * `nativeSessionId`. The second case is the ordinary pre-birth window: codex birth is
 * first-turn, not window-open, so a thread whose hook has not minted a record yet simply has no
 * citizen, and the bridge's default anonymous refusal already names the fix.
 *
 * THROWS — every knowable defect, unfolded: a broken claim
 * ({@link EntwurfCodexIdentityMetadataError}), a foreign-backend record
 * ({@link EntwurfCodexIdentityBackendError}), or a store that cannot be certified
 * (`MetaRecordError` from the strict listing — an unreadable/previous-generation record
 * anywhere in the store, a duplicated `nativeSessionId`, or a store this process cannot read).
 *
 * THE LOOKUP IS THE STRICT STORE-WIDE LISTING, NOT A NARROW SCAN. `nativeSessionId` → garden id
 * is the store's own authority (there is no index, by design), and the same reason
 * `upsertMetaSession` certifies the WHOLE store before writing applies to a read that turns an
 * id into an ADDRESS: a narrow "find my thread" pass would answer happily beside a duplicate,
 * drifted or symlinked neighbour that the doctor refuses, so the runtime would hold the weaker
 * contract exactly where a message gets attributed. `mode: "strict"` is what makes an
 * unreadable record a refusal instead of an invisible one — a duplicate of THIS thread's id
 * would otherwise be dropped from `identities` and read as "no record".
 */
export function resolveCodexRequestSenderIdentity(
	opts: ResolveCodexRequestSenderOptions = {},
): CodexRequestSender | null {
	const threadId = readCodexRequestThreadId(opts);
	if (threadId === null) return null;

	const dir = opts.sessionsDir ?? defaultMetaSessionsDir();
	const { identities } = listAllMetaIdentities(readActiveStoreEntries(dir), makeStoreRecordReader(dir), {
		mode: "strict",
	});
	const identity = identities.find((record) => record.nativeSessionId === threadId);
	if (!identity) return null;
	if (identity.backend !== "codex") throw new EntwurfCodexIdentityBackendError(identity);
	return { identity, threadId, provenance: CODEX_BRIDGE_PROVENANCE_LABEL };
}

/**
 * The three rails an entwurf-bridge child can learn WHO is calling from. Named as a type so a
 * reconciliation can report which rails spoke without any of them being privileged by position.
 */
export type SenderIdentityRail = "pi-session" | "meta-sender-marker" | "codex-request";

/** One rail's answer: the address it names (a pi session id, or a garden id). */
export interface SenderIdentityClaim {
	rail: SenderIdentityRail;
	id: string;
}

/** One address, plus every rail that named it. Rails are sorted and de-duplicated, so this
 * answer never depends on the order the caller collected its claims in. */
export interface ReconciledSenderIdentity {
	id: string;
	rails: SenderIdentityRail[];
}

/**
 * Two rails claim this MCP process for DIFFERENT addresses. Sibling of
 * {@link EntwurfSenderIdentityAmbiguityError} and deliberately not the same error: that one is
 * about two pid MARKERS on one owner pid, while this is about rails that do not even share a
 * join key — a planted `PI_SESSION_ID` in a native host's environment, a pid marker inherited
 * from a host whose child we are not, a codex `_meta` naming a thread while a marker names
 * someone else. Which is right is unknowable here, and both are visible, so neither is used.
 */
export class EntwurfSenderIdentityConflictError extends Error {
	readonly claims: SenderIdentityClaim[];
	constructor(claims: readonly SenderIdentityClaim[]) {
		super(
			"entwurf-bridge refused: conflicting sender identity. This MCP process holds authoritative " +
				`identity claims from more than one rail, naming DIFFERENT addresses (${claims
					.map((claim) => `${claim.rail}=${claim.id}`)
					.join(", ")}), so which one is calling cannot be determined. A send under the wrong identity ` +
				"is worse than no send. Report it; do not work around it.",
		);
		this.name = "EntwurfSenderIdentityConflictError";
		this.claims = [...claims];
	}
}

/**
 * Fold every rail's answer into ONE address, or refuse.
 *
 * 0 claims → `null` (anonymous; the bridge's default refusal owns that outcome).
 * 1+ claims that AGREE on the id → that address, carrying every rail that named it. Agreement is
 *   the normal shape of an overlap, not a conflict: a codex citizen's request-scoped claim and a
 *   pid marker for the same garden id are two views of one identity.
 * claims that DISAGREE → throw {@link EntwurfSenderIdentityConflictError}.
 *
 * Every claim is collected and compared BEFORE one is chosen — the same rule the marker rail
 * holds one layer up. A rail-priority order would answer even when the truth is unknown, which
 * is the failure this exists to prevent, so callers must pass ALL rails they resolved rather
 * than short-circuiting on the first one that answered.
 */
export function reconcileSenderIdentityClaims(claims: readonly SenderIdentityClaim[]): ReconciledSenderIdentity | null {
	if (claims.length === 0) return null;
	const ids = new Set(claims.map((claim) => claim.id));
	if (ids.size > 1) throw new EntwurfSenderIdentityConflictError(claims);
	const [id] = ids;
	return {
		id,
		rails: [...new Set(claims.map((claim) => claim.rail))].sort(),
	};
}
