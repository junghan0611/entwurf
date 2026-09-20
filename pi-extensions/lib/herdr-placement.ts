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
 * guesses: herdr reports the native session id its OWN OFFICIAL integration told it,
 * and `nativeSessionId` is unique across the whole meta-store (Hard Rule 7). Two
 * independently-owned facts meet on one unique key. Nothing here narrows candidates
 * by cwd, reads a title, or prefers the nearest timestamp. §7 was amended in the same
 * change that added this module; if the two ever disagree, §7 is the owning document.
 *
 * THE TWO AXES ARE NOT EQUALLY EXACT, AND THE DIFFERENCE IS NAMED. On the claude axis
 * the reported value IS the key, byte for byte. On the pi axis it is a session FILE
 * PATH, and the key is recovered from that filename by a strict conversion measured on
 * pi 0.86.0 — a VENDOR FLOOR, not a key equality. Calling both "a unique-key join"
 * would hide which one can drift when a vendor renames a file. The conversion is
 * deliberately strict at both ends so that drift lands as a missed join, never a wrong
 * one, and a listing that declined to read anything says so (see `declinedReports`).
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
 *           INSIDE that filename, so this arm needs the conversion below.
 * Any other word is a herdr version we have not measured. It is declined, never
 * coerced into one of these two.
 */
export type HerdrAgentSessionKind = "id" | "path";

/** One pane as herdr reported it, reduced to the fields this join reads. The
 * `agent`/`source` pair is carried, not discarded: it is what makes a row an
 * OFFICIAL integration report rather than any report (see `OFFICIAL_REPORTS`). */
export interface HerdrPaneRow {
	readonly paneId: string;
	readonly agent: string | null;
	readonly sessionSource: string | null;
	readonly sessionKind: HerdrAgentSessionKind | null;
	readonly sessionValue: string | null;
}

/**
 * The OFFICIAL integration reports this join accepts, and nothing else.
 *
 * WHY THIS TABLE EXISTS. herdr accepts a session reference from any integration,
 * including one a user wrote (`integrations.mdx:65-90 @ c77af189`), and the row
 * carries who reported it in `agent_session.agent` / `.source`. Reading only
 * `kind`/`value` would have let a third party's report stand in for the placement
 * owner's own — and "the placement owner reported it" is the entire reason
 * `docs/mux-launch-rail.md` §7 admits this as exact evidence. So the triple is
 * pinned: source, agent, AND the shape that source is measured to emit. A row that
 * misses any leg carries no key.
 *
 * `backend` is the meta-record backend this report may speak for. It is checked at
 * resolve time so a claude-reported pane can never be handed to a pi citizen whose
 * native id happens to collide.
 */
const OFFICIAL_REPORTS: Readonly<
	Record<string, { readonly agent: string; readonly kind: HerdrAgentSessionKind; readonly backend: string }>
> = {
	"herdr:claude": { agent: "claude", kind: "id", backend: "claude-code" },
	"herdr:pi": { agent: "pi", kind: "path", backend: "pi" },
};

/**
 * A pi session filename, measured 2026-09-20 on pi 0.86.0:
 *
 *   2026-09-20T00-35-44-197Z_01a0bc3d-87c4-738e-b391-265c8ba5a1b0.jsonl
 *   └────────── start stamp ─────────┘ └──────── nativeSessionId ────────┘
 *
 * `[측정 2026-09-20]` that is a REAL file a sandboxed pi 0.86.0 wrote, and its own
 * `{"type":"session"}` header carries `id: 01a0bc3d-87c4-738e-b391-265c8ba5a1b0` —
 * the exact string `piNativeSessionIdFromPath` recovers from the name. The layout was
 * re-measured rather than carried: pi 0.86.0 rewrote session-manager.ts (+269 −141
 * over v0.85.1), but every line that BUILDS a name is byte-unchanged
 * (`${fileTimestamp}_${this.sessionId}.jsonl`, session-manager.ts:991/1527/1703); the
 * only diff in that file's `.jsonl` lines is a lambda parameter rename on the READER
 * side. A source read alone would not have settled it, so the real file is the receipt.
 *
 * WHY THIS IS PINNED HERE AND NOT INFERRED. The uuid is the join key and it lives in
 * a VENDOR filename, so this rule depends on pi's naming and would break silently if
 * pi changed it. **Vendor floor: pi 0.86.0, measured 2026-09-20** — whether that layout
 * is a vendor contract or a convention is NOT measured, so this is the one place in the
 * axis that can drift under us. It is therefore strict on both ends — the name must end
 * in `.jsonl` and the tail after the last `_` must be a well-formed uuid — and a name
 * that fails either test yields no key at all rather than a substring that happens to
 * look plausible. Drift then lands as a DECLINED report (the citizen reads `unobserved`,
 * not `none`), never as a wrong join onto someone else's pane.
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

/** What one pane contributes to the join: the key and the backend the reporting
 * integration speaks for. `null` means this row carries nothing we may read. */
export interface HerdrJoinEntry {
	readonly nativeSessionId: string;
	readonly backend: string;
}

export function joinKeyOf(row: HerdrPaneRow): HerdrJoinEntry | null {
	if (row.sessionSource === null) return null;
	const official = OFFICIAL_REPORTS[row.sessionSource];
	// An unmeasured source — a herdr version we have not run, or a third-party
	// integration. Declined on purpose: coercing it would invent a rule, and the
	// whole exact-evidence argument rests on WHO reported.
	if (official === undefined) return null;
	if (row.agent !== official.agent) return null;
	if (row.sessionKind !== official.kind) return null;
	if (row.sessionValue === null || row.sessionValue.length === 0) return null;
	const nativeSessionId = official.kind === "id" ? row.sessionValue : piNativeSessionIdFromPath(row.sessionValue);
	return nativeSessionId === null ? null : { nativeSessionId, backend: official.backend };
}

/**
 * The join index for ONE listing.
 *
 * `ambiguous` is carried separately rather than letting last-write-wins pick a pane,
 * because "herdr shows this twice" and "herdr shows this here" are different facts and
 * only one of them is a placement.
 *
 * `declinedReports` is what makes a non-join honest. A pane that carried a session
 * report we refused to read (unofficial source, wrong agent, wrong shape, unparsable
 * value) might have BEEN the citizen we are now failing to find — we declined to look,
 * we did not look and find nothing. So while any row was declined, a non-join reads
 * `unobserved` rather than `none`. A bare shell pane with no report at all is not a
 * decline: there was nothing there to read.
 */
export interface HerdrPlacementIndex {
	readonly byNativeSessionId: ReadonlyMap<string, HerdrJoinEntry & { readonly paneId: string }>;
	readonly ambiguous: ReadonlySet<string>;
	readonly declinedReports: number;
}

export function buildPlacementIndex(rows: readonly HerdrPaneRow[]): HerdrPlacementIndex {
	const byNativeSessionId = new Map<string, HerdrJoinEntry & { paneId: string }>();
	const ambiguous = new Set<string>();
	let declinedReports = 0;
	for (const row of rows) {
		const entry = joinKeyOf(row);
		if (entry === null) {
			// Only a row that actually CARRIED a report counts as declined.
			if (row.sessionSource !== null || row.sessionValue !== null) declinedReports++;
			continue;
		}
		const key = entry.nativeSessionId;
		if (ambiguous.has(key)) continue;
		const seen = byNativeSessionId.get(key);
		if (seen !== undefined && seen.paneId !== row.paneId) {
			byNativeSessionId.delete(key);
			ambiguous.add(key);
			continue;
		}
		byNativeSessionId.set(key, { ...entry, paneId: row.paneId });
	}
	return { byNativeSessionId, ambiguous, declinedReports };
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
			rows.push({ paneId, agent: null, sessionSource: null, sessionKind: null, sessionValue: null });
			continue;
		}
		const agent = (session as { agent?: unknown }).agent;
		const source = (session as { source?: unknown }).source;
		const kind = (session as { kind?: unknown }).kind;
		const value = (session as { value?: unknown }).value;
		rows.push({
			paneId,
			agent: typeof agent === "string" ? agent : null,
			sessionSource: typeof source === "string" ? source : null,
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
	const entry = index.byNativeSessionId.get(identity.nativeSessionId);
	if (entry !== undefined) {
		// The reporting integration must speak for THIS citizen's backend. A pi
		// integration reporting an id that collides with a claude-code record is a
		// contradiction, not a placement, and we decline to claim either way.
		return entry.backend === identity.backend ? { kind: "herdr-pane", paneId: entry.paneId } : UNOBSERVED_PLACEMENT;
	}
	// No join. `none` is only honest when the read was COMPLETE — if any report was
	// declined, the thing we did not read might have been this one.
	return index.declinedReports > 0 ? UNOBSERVED_PLACEMENT : NO_PLACEMENT;
}

/** Render one observation as the listing's column value. `herdr <pane>` says WHERE it
 * was seen and by WHOM, so a reader never mistakes the pane id for one of ours. */
export function renderPlacement(placement: PlacementObservation): string {
	return placement.kind === "herdr-pane" ? `herdr ${placement.paneId}` : placement.kind;
}
