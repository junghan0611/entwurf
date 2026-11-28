/**
 * placement-compose — several placement owners, one column (#178).
 *
 * Pure. Each owner (herdr, the lister's tmux server, an operator-named Herdr Core) answers for one
 * citizen with its own `PlacementObservation`; an owner that was not read, or could not look for
 * this citizen, answers `unobserved`. This module folds those answers and holds the meaning of the
 * two blank words:
 *
 *   a place      exactly one owner saw the citizen
 *   ambiguous    any owner said so, or two owners saw it in different places
 *   none         EVERY owner that could hold it was read in this listing and none of them has it
 *   unobserved   anything else — at least one owner did not look
 *
 * `none` therefore still means "read, and not there". A lister that can read only one owner cannot
 * say it, and prints `unobserved`; that is the honest word, and it is the common one.
 *
 * FACTS, NOT VERBS. Nothing here is an address, a liveness answer or an authority, and no send or
 * launch path imports it.
 */

import {
	AMBIGUOUS_PLACEMENT,
	NO_PLACEMENT,
	type PlacementObservation,
	UNOBSERVED_PLACEMENT,
} from "./herdr-placement.ts";

/** A stable key for a sighting, or null for a blank word. Two owners never share a key. */
export function placementLocationKey(placement: PlacementObservation): string | null {
	if (placement.kind === "herdr-pane") return `herdr\0${placement.paneId}`;
	if (placement.kind === "tmux-pane") return `tmux\0${placement.paneId}`;
	if (placement.kind === "hc-terminal") return `hc\0${placement.coreId}\0${placement.terminal}`;
	return null;
}

/** Fold every owner's answer for ONE citizen. `owners` is all the owners that could hold it. */
export function composePlacement(owners: readonly PlacementObservation[]): PlacementObservation {
	let seen: PlacementObservation | null = null;
	let everyOwnerSaysNone = owners.length > 0;
	for (const answer of owners) {
		if (answer.kind === "ambiguous") return AMBIGUOUS_PLACEMENT;
		if (answer.kind !== "none") everyOwnerSaysNone = false;
		if (placementLocationKey(answer) === null) continue;
		if (seen !== null && placementLocationKey(seen) !== placementLocationKey(answer)) return AMBIGUOUS_PLACEMENT;
		seen = answer;
	}
	if (seen !== null) return seen;
	return everyOwnerSaysNone ? NO_PLACEMENT : UNOBSERVED_PLACEMENT;
}

/**
 * The owner-process join both tmux and hc use: a citizen is where the terminal whose own process is
 * its ACTIVE receiver owner is. Claude Code only (decision G-P2) — no other backend has a verified
 * owner-pid source, so its rows are never claimed and are not `none` either.
 */
export function resolveOwnerPidPlacement<T>(
	index: { readonly byPid: ReadonlyMap<number, T>; readonly ambiguous: ReadonlySet<number> } | null,
	backend: string,
	activeOwnerPid: number | null,
	place: (hit: T) => PlacementObservation,
): PlacementObservation {
	if (index === null) return UNOBSERVED_PLACEMENT;
	if (backend !== "claude-code") return UNOBSERVED_PLACEMENT;
	// No active owner: there is no key to look up, so nothing was measured about this citizen.
	if (activeOwnerPid === null) return UNOBSERVED_PLACEMENT;
	if (index.ambiguous.has(activeOwnerPid)) return AMBIGUOUS_PLACEMENT;
	const hit = index.byPid.get(activeOwnerPid);
	return hit === undefined ? NO_PLACEMENT : place(hit);
}

/**
 * One terminal runs one process, so two citizens shown in the SAME pid-joined place are two claims
 * on one owner process — and only one of them can be what it serves now. Neither is named: both
 * read `ambiguous`. A second line of defence behind the active-owner rule; herdr panes are joined on
 * a session id, not a pid, and are left alone.
 */
export function ambiguateSharedOwnerPlacements<R extends { readonly placement: PlacementObservation }>(
	rows: readonly R[],
): R[] {
	const claims = new Map<string, number>();
	for (const row of rows) {
		if (row.placement.kind !== "tmux-pane" && row.placement.kind !== "hc-terminal") continue;
		const key = placementLocationKey(row.placement) as string;
		claims.set(key, (claims.get(key) ?? 0) + 1);
	}
	return rows.map((row) => {
		if (row.placement.kind !== "tmux-pane" && row.placement.kind !== "hc-terminal") return row;
		return (claims.get(placementLocationKey(row.placement) as string) ?? 0) > 1
			? { ...row, placement: AMBIGUOUS_PLACEMENT }
			: row;
	});
}
