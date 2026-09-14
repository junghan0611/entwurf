/**
 * herdr-placement — the PURE half of the placement evidence axis (#116 S1).
 *
 * WHAT THIS IS FOR. A citizen opened inside herdr is visible in one of herdr's panes.
 * That pane is an EPHEMERAL VIEW, never an address and never a liveness receipt
 * (AGENTS Hard Rule 16, `docs/mux-launch-rail.md` §7). It earns a column in
 * `entwurf_peers` for one reason: on a herdr host the operator's own question is
 * "which pane is that one in", and answering it by hand means reading two listings
 * side by side.
 *
 * WHY THIS JOIN IS EXACT EVIDENCE AND NOT A GUESS. §7 admitted exactly two forms of
 * exact placement evidence (our own launch receipt, and a peer's verifiable
 * self-report) and named the guesses it refuses: window title, cwd match, and time
 * proximity. This is a THIRD form and it belongs to neither the receipts nor the
 * guesses: herdr reports the native session id it was told by its own integration,
 * and `nativeSessionId` is unique across the whole meta-store (Hard Rule 7). Two
 * independently-owned facts meet on one unique key. Nothing here narrows candidates
 * by cwd, reads a title, or prefers the nearest timestamp. §7 was amended in the same
 * change that added this module; if the two ever disagree, §7 is the owning document.
 *
 * ONE READ, NO WATCHER. The observer performs exactly ONE `pane list` read for a
 * whole listing and never retries. herdr publishes no event that says "this pane's
 * `agent_session` is now settled" — measured on herdr 0.9.0: `pane.updated` is the
 * only event whose payload carries `agent_session` and plugin `[[events]]` refuses
 * that name, `events.subscribe` offers three pane kinds and none of them carry it,
 * and `pane.agent_detected` arrives BEFORE the session reference exists. A retry loop
 * around that gap is a discovery watcher, which §7 forbids by name. So a citizen
 * whose pane has not reported yet reads `none` on this pass and is simply asked again
 * next time.
 *
 * FACTS, NOT VERBS. Nothing here returns a transport, a target, or a suggestion. A
 * pane id must never reach dispatch: `entwurf_v2` resolves its rail from the record
 * and a live probe, and a placement that is one server restart from being false has
 * no business in that decision.
 */

import type { MetaIdentity } from "./meta-session.ts";

/**
 * Where a citizen was found, as OBSERVED for this listing. Four words, and the two
 * blank ones are deliberately distinct:
 *   `unobserved`  nobody looked — no herdr on this host, or the read failed. This is
 *                 the honest word for "not measured", never a quiet stand-in for the
 *                 next one, and it is what a host with no herdr always reads.
 *   `none`        herdr WAS read and this citizen is in none of its panes. A real
 *                 measurement with a negative result.
 *   `ambiguous`   two or more panes claim this citizen's native session id. herdr
 *                 shows it, but not in one place, so naming a pane would be a guess.
 *   `herdr-pane`  exactly one pane joined on the unique key.
 */
export type PlacementObservation =
	| { readonly kind: "unobserved" }
	| { readonly kind: "none" }
	| { readonly kind: "ambiguous" }
	| { readonly kind: "herdr-pane"; readonly paneId: string };

export const UNOBSERVED_PLACEMENT: PlacementObservation = { kind: "unobserved" };
export const NO_PLACEMENT: PlacementObservation = { kind: "none" };
export const AMBIGUOUS_PLACEMENT: PlacementObservation = { kind: "ambiguous" };

/**
 * The two shapes herdr reports a native session in, measured on herdr 0.9.0:
 *   `id`    claude — the vendor's own session uuid, byte-identical to our
 *           `nativeSessionId`.
 *   `path`  pi — the absolute path of the session JSONL. The uuid we key on is
 *           INSIDE that filename, so this arm needs the parse below.
 * Any other word is a herdr version we have not measured. It is skipped, never
 * coerced into one of these two.
 */
export type HerdrAgentSessionKind = "id" | "path";

/** One pane as herdr reported it, reduced to the fields this join reads. */
export interface HerdrPaneRow {
	readonly paneId: string;
	readonly sessionKind: HerdrAgentSessionKind | null;
	readonly sessionValue: string | null;
}

/**
 * A pi session filename, measured 2026-09-14 on pi 0.85.1:
 *
 *   2026-09-14T05-17-03-979Z_01a09e58-f06a-70e8-b14a-1f0f0c7f7c7d.jsonl
 *   └────────── start stamp ─────────┘ └──────── nativeSessionId ────────┘
 *
 * WHY THIS IS PINNED HERE AND NOT INFERRED. The uuid is the join key and it lives in
 * a VENDOR filename, so this rule depends on pi's naming and would break silently if
 * pi changed it. It is therefore strict on both ends — the name must end in `.jsonl`
 * and the tail after the last `_` must be a well-formed uuid — and a name that fails
 * either test yields no key at all rather than a substring that happens to look
 * plausible. A missed join reads `none`; a wrong join would attach a citizen to
 * someone else's pane.
 */
const PI_SESSION_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const PI_SESSION_SUFFIX = ".jsonl";

export function piNativeSessionIdFromPath(value: string): string | null {
	if (!value.endsWith(PI_SESSION_SUFFIX)) return null;
	const stem = value.slice(0, -PI_SESSION_SUFFIX.length);
	const base = stem.slice(stem.lastIndexOf("/") + 1);
	const cut = base.lastIndexOf("_");
	if (cut < 0) return null;
	const candidate = base.slice(cut + 1);
	return PI_SESSION_UUID.test(candidate) ? candidate : null;
}

/** The join key a pane carries, or `null` when it carries none we can read. */
export function joinKeyOf(row: HerdrPaneRow): string | null {
	if (row.sessionValue === null || row.sessionValue.length === 0) return null;
	switch (row.sessionKind) {
		case "id":
			return row.sessionValue;
		case "path":
			return piNativeSessionIdFromPath(row.sessionValue);
		default:
			// An unmeasured `kind`. Skipped on purpose: coercing it would invent a rule
			// for a herdr version nobody here has run.
			return null;
	}
}

/**
 * The join index for ONE listing. `ambiguous` is carried separately rather than
 * letting last-write-wins pick a pane, because "herdr shows this twice" and "herdr
 * shows this here" are different facts and only one of them is a placement.
 */
export interface HerdrPlacementIndex {
	readonly byNativeSessionId: ReadonlyMap<string, string>;
	readonly ambiguous: ReadonlySet<string>;
}

export function buildPlacementIndex(rows: readonly HerdrPaneRow[]): HerdrPlacementIndex {
	const byNativeSessionId = new Map<string, string>();
	const ambiguous = new Set<string>();
	for (const row of rows) {
		const key = joinKeyOf(row);
		if (key === null) continue;
		if (ambiguous.has(key)) continue;
		const seen = byNativeSessionId.get(key);
		if (seen !== undefined && seen !== row.paneId) {
			byNativeSessionId.delete(key);
			ambiguous.add(key);
			continue;
		}
		byNativeSessionId.set(key, row.paneId);
	}
	return { byNativeSessionId, ambiguous };
}

/**
 * Parse what `herdr pane list` printed. Returns `null` — "nobody looked" — for any
 * payload this does not recognise, because a herdr that answered in a shape we cannot
 * read has told us nothing, and reporting `none` for every citizen on that basis
 * would be a fabricated measurement. A row missing `pane_id` is the one hard error:
 * the whole payload is unreadable rather than partially trusted.
 */
export function parseHerdrPaneList(stdout: string): HerdrPaneRow[] | null {
	let raw: unknown;
	try {
		raw = JSON.parse(stdout);
	} catch {
		return null;
	}
	if (typeof raw !== "object" || raw === null) return null;
	const result = (raw as { result?: unknown }).result;
	if (typeof result !== "object" || result === null) return null;
	const panes = (result as { panes?: unknown }).panes;
	if (!Array.isArray(panes)) return null;
	const rows: HerdrPaneRow[] = [];
	for (const pane of panes) {
		if (typeof pane !== "object" || pane === null) return null;
		const paneId = (pane as { pane_id?: unknown }).pane_id;
		if (typeof paneId !== "string" || paneId.length === 0) return null;
		const session = (pane as { agent_session?: unknown }).agent_session;
		if (typeof session !== "object" || session === null) {
			rows.push({ paneId, sessionKind: null, sessionValue: null });
			continue;
		}
		const kind = (session as { kind?: unknown }).kind;
		const value = (session as { value?: unknown }).value;
		rows.push({
			paneId,
			sessionKind: kind === "id" || kind === "path" ? kind : null,
			sessionValue: typeof value === "string" ? value : null,
		});
	}
	return rows;
}

/**
 * The whole decision, for one citizen. A `null` index is the no-herdr host and every
 * citizen on it reads `unobserved` — which is why this takes the index rather than a
 * reader: the read happened once, above, and this stays pure.
 */
export function resolvePlacement(index: HerdrPlacementIndex | null, identity: MetaIdentity): PlacementObservation {
	if (index === null) return UNOBSERVED_PLACEMENT;
	if (index.ambiguous.has(identity.nativeSessionId)) return AMBIGUOUS_PLACEMENT;
	const paneId = index.byNativeSessionId.get(identity.nativeSessionId);
	return paneId === undefined ? NO_PLACEMENT : { kind: "herdr-pane", paneId };
}

/** Render one observation as the listing's column value. `herdr <pane>` says WHERE it
 * was seen and by WHOM, so a reader never mistakes the pane id for one of ours. */
export function renderPlacement(placement: PlacementObservation): string {
	return placement.kind === "herdr-pane" ? `herdr ${placement.paneId}` : placement.kind;
}
