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
 * Two guards make a marker an IDENTITY rather than a hint, and a candidate is only trusted after
 * BOTH pass:
 *   1. pid + start-key (readMetaSenderMarker): the owner is still the very process that wrote it,
 *      so a dead session's pid, reused by something else, cannot inherit its garden-id.
 *   2. the backing meta-record: the record store is the authority — a marker whose record was
 *      deleted, or whose backend/nativeSessionId drifted from it, names nobody. A record that
 *      EXISTS but cannot be read (a pre-cut v1/v2 record, a corrupt body) is a THROW instead
 *      (EntwurfSenderRecordUnreadableError): the cause is knowable, so folding it into
 *      "names nobody" would misreport the failure and hide the M1 migration pointer (F10).
 *
 * Every candidate is collected and validated BEFORE one is chosen. A first-match loop would make
 * the answer depend on which pid or backend happened to be read first; here lookup order carries
 * no meaning, and two live identities are a refusal rather than a race.
 */

import {
	type MetaBackend,
	type MetaIdentity,
	type MetaSenderMarker,
	metaRecordExistsByGardenId,
	parentPid,
	readMetaIdentityByGardenId,
	readMetaSenderMarker,
} from "./meta-session.ts";
import { type NativePushAdapter, resolveNativePushAdapter } from "./native-push/adapter.ts";

/** Every native backend that mints a garden-id from its own hook and writes a sender marker. */
export const META_SENDER_BACKENDS: readonly MetaBackend[] = ["claude-code", "antigravity"];

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
 * (a pre-cut v1/v2 record awaiting M1 migration, or a corrupt body). This is a hard stop,
 * never a downgrade: the caller has an identity — it is just unreadable — so resolving to
 * anonymous/"no marker" would report a false cause and prescribe a useless fix (re-opening
 * the session re-mints the same unreadable state; observed live as F10). The quoted cause
 * carries the record reader's own message, which names the M1 command for a pre-cut record.
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
 *   (a pre-cut/corrupt record is a knowable cause, never folded into "no marker" — F10).
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
		const ownerPids = (opts.ownerPids ?? [process.ppid, parentPid(process.ppid) ?? 0]).filter(
			(p): p is number => typeof p === "number" && p > 0,
		);
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
