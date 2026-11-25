/**
 * resume-picker-rows — what the `entwurf resume` list SHOWS (#173 C3). Pure: facts in, rows out.
 *
 * The list is a way to find a garden id, and nothing more. A row being here is not evidence that
 * the citizen can be reopened: the leaf decides that when one is chosen, from the record and the
 * live rail facts it reads then. So this module never filters by liveness, never ranks by it and
 * never invents a word for it — a live citizen is listed, and choosing it ends in the leaf's
 * refusal.
 *
 * WHAT IT READS. `PeerFact` rows exactly as `listEntwurfFacts` produced them (the provider is not
 * re-run, re-joined or re-ordered at the fact level), the directory the operator typed the command
 * in, bookmark pins and the presentation hints (test room, activity time). Of a fact it reads
 * identity, cwd, model, the record's update time and the two liveness-side observations; it does NOT read `placement` — a pane is a view, and this list
 * neither shows nor decides anything from one. `unsupported`, `unobserved` and `unknown` are
 * printed as the provider's own words, never translated into dead, inactive or eligible.
 *
 * PINS ARE BOOKMARKS. A pin joins a fact row on the GARDEN ID and on nothing else; it carries a
 * name for the eye and an order. A pin whose id has no record makes no row — a bookmark cannot
 * create an address candidate — and is only counted. A pinned citizen of another directory is
 * shown in its own section with its path, because the default view is filtered by directory and a
 * bookmark that silently vanished there would be worse than none.
 *
 * WHAT IS NOT LISTED. Citizens of a backend with no same-id resume are left out of the rows and
 * counted by backend. That set is a PRESENTATION choice mirrored from the leaf, not eligibility:
 * naming such an id directly still reaches the leaf, which refuses it by name.
 */

import type { PeerFact } from "./entwurf-facts.ts";
import { isWithinWindow, type PeerPresentation, RECENT_WINDOW_MS, renderActivity } from "./peer-presentation.ts";

/** A bookmark: an id to float to the top and the name the operator knows it by. */
export interface ResumePin {
	gardenId: string;
	name: string;
}

/** The backends whose citizens are shown as rows — the ones the leaf can reopen under the same id.
 * Mirrored for display only; the leaf's own answer is the authority (see the beside test). */
export const RESUME_LISTED_BACKENDS: readonly string[] = ["pi", "pi-durable", "claude-code"];

export type ResumeRowSection = "pin-here" | "pin-elsewhere" | "here" | "elsewhere";

export interface ResumeRow {
	gardenId: string;
	backend: string;
	cwd: string;
	model: string | null;
	/** The liveness-side facts, in the provider's words. */
	facts: string;
	/** When this citizen was last active (its transcript's mtime, else its record's update time), or
	 * `null` when neither is known. The order of the unpinned rows and the time a row prints. */
	activityMs: number | null;
	/** The bookmark's name, when this citizen is pinned. */
	pin: string | null;
	section: ResumeRowSection;
}

export interface ResumeListing {
	callerCwd: string;
	/** Every listed-backend citizen, in display order: pins here, pins elsewhere, here, elsewhere. */
	rows: ResumeRow[];
	/** Citizens of other backends, not rows: their backend and whether they are of this directory. */
	unlisted: { backend: string; here: boolean }[];
	/** Pins whose garden id has no record on this host. Counted and named, never a candidate. */
	pinsWithoutRecord: ResumePin[];
	/** Unbookmarked listed-backend citizens left out of the rows (#173 P2), and why. Presentation
	 * only: naming such an id directly reaches the leaf exactly as before. */
	hidden: { reason: ResumeHiddenReason; here: boolean }[];
}

/** `test-room`: the record cwd is under the OS temp directory. `older`: quiet for more than seven days. */
export type ResumeHiddenReason = "test-room" | "older";

/** The two observations a reader uses to guess whether a citizen is running — printed, not judged. */
export function describeFacts(fact: Pick<PeerFact, "liveness" | "receiver">): string {
	const parts: string[] = [];
	// `unsupported` / `n/a` mean the axis does not apply to this backend, so the axis is not shown
	// for it; when neither applies the provider's own word is kept rather than left blank.
	if (fact.liveness !== "unsupported") parts.push(`socket ${fact.liveness}`);
	if (fact.receiver !== "n/a") parts.push(`receiver ${fact.receiver}`);
	return parts.length > 0 ? parts.join(", ") : `liveness ${fact.liveness}`;
}

/** Most recently active first, an unknown time last; the id breaks a tie so the order is total and stable. */
function byRecency(a: ResumeRow, b: ResumeRow): number {
	if (a.activityMs !== b.activityMs) {
		if (a.activityMs === null) return 1;
		if (b.activityMs === null) return -1;
		return b.activityMs - a.activityMs;
	}
	return a.gardenId < b.gardenId ? 1 : a.gardenId > b.gardenId ? -1 : 0;
}

export function buildResumeListing(
	facts: readonly PeerFact[],
	callerCwd: string,
	pins: readonly ResumePin[],
	/** The #173 P2 hints. `null` hides nothing and reads each row's activity from its record. */
	presentation: PeerPresentation | null = null,
): ResumeListing {
	// First pin wins when a bookmark file names one id twice; its position is that first one.
	const pinOrder = new Map<string, { name: string; index: number }>();
	for (const [index, pin] of pins.entries()) {
		if (!pinOrder.has(pin.gardenId)) pinOrder.set(pin.gardenId, { name: pin.name, index });
	}

	const rows: ResumeRow[] = [];
	const unlisted: ResumeListing["unlisted"] = [];
	const hidden: ResumeListing["hidden"] = [];
	const seen = new Set<string>();
	for (const fact of facts) {
		seen.add(fact.gardenId);
		const here = fact.cwd === callerCwd;
		if (!RESUME_LISTED_BACKENDS.includes(fact.backend)) {
			unlisted.push({ backend: fact.backend, here });
			continue;
		}
		const pin = pinOrder.get(fact.gardenId);
		const hint = presentation?.hints.get(fact.gardenId);
		const recorded = Date.parse(fact.recordUpdatedAt);
		const activityMs = hint === undefined ? (Number.isFinite(recorded) ? recorded : null) : hint.activityMs;
		// A bookmark is shown whatever its directory or age. Everything else is shown only when it is
		// not a test room and was active inside the window, measured against the listing's one clock.
		if (pin === undefined && presentation !== null) {
			if (hint?.testRoom === true) {
				hidden.push({ reason: "test-room", here });
				continue;
			}
			if (!isWithinWindow(activityMs, presentation.now, RECENT_WINDOW_MS)) {
				hidden.push({ reason: "older", here });
				continue;
			}
		}
		rows.push({
			gardenId: fact.gardenId,
			backend: fact.backend,
			cwd: fact.cwd,
			model: fact.model,
			facts: describeFacts(fact),
			activityMs,
			pin: pin === undefined ? null : pin.name,
			section: pin === undefined ? (here ? "here" : "elsewhere") : here ? "pin-here" : "pin-elsewhere",
		});
	}

	const SECTION_ORDER: readonly ResumeRowSection[] = ["pin-here", "pin-elsewhere", "here", "elsewhere"];
	rows.sort((a, b) => {
		if (a.section !== b.section) return SECTION_ORDER.indexOf(a.section) - SECTION_ORDER.indexOf(b.section);
		if (a.pin !== null && b.pin !== null) {
			return (pinOrder.get(a.gardenId)?.index ?? 0) - (pinOrder.get(b.gardenId)?.index ?? 0);
		}
		return byRecency(a, b);
	});

	const pinsWithoutRecord = [...pinOrder.entries()]
		.filter(([gardenId]) => !seen.has(gardenId))
		.map(([gardenId, pin]) => ({ gardenId, name: pin.name }));

	return { callerCwd, rows, unlisted, pinsWithoutRecord, hidden };
}

/** How many unbookmarked citizens of the current scope the list left out, by reason. */
export function hiddenResumeCounts(
	listing: ResumeListing,
	allDirectories: boolean,
): Record<ResumeHiddenReason, number> {
	const counts: Record<ResumeHiddenReason, number> = { older: 0, "test-room": 0 };
	for (const h of listing.hidden) {
		if (!allDirectories && !h.here) continue;
		counts[h.reason] += 1;
	}
	return counts;
}

export interface ResumeView {
	/** False is the default view: this directory's citizens, plus every pin. */
	allDirectories: boolean;
	/** What the operator has typed. Whitespace-separated words, all of which must appear. */
	query: string;
}

/** Everything a row can be found by — what is printed, and nothing that is not. */
function haystack(row: ResumeRow): string {
	return [row.gardenId, row.backend, row.model ?? "", row.facts, row.cwd, row.pin ?? ""].join(" ").toLowerCase();
}

/** The rows the operator sees now. Narrowing only hides rows; it never reorders them. */
export function visibleResumeRows(listing: ResumeListing, view: ResumeView): ResumeRow[] {
	const words = view.query
		.toLowerCase()
		.split(/\s+/)
		.filter((w) => w.length > 0);
	return listing.rows.filter((row) => {
		if (row.section === "elsewhere" && !view.allDirectories) return false;
		const text = haystack(row);
		return words.every((w) => text.includes(w));
	});
}

/** The not-listed citizens of the current scope, by backend, most numerous first. */
export function unlistedResumeCounts(listing: ResumeListing, allDirectories: boolean): [string, number][] {
	const counts = new Map<string, number>();
	for (const u of listing.unlisted) {
		if (!allDirectories && !u.here) continue;
		counts.set(u.backend, (counts.get(u.backend) ?? 0) + 1);
	}
	return [...counts.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
}

/** What one row prints, field by field. Where each field sits, how wide its column is and what a
 * narrow terminal leaves out are the picker's to decide (#176); the words are decided here. */
export interface ResumeRowText {
	gardenId: string;
	backend: string;
	/** The liveness-side facts, one entry per axis, in the provider's words (`describeFacts`). */
	facts: string[];
	/** The activity time the row is ordered by, in UTC, or `unknown`. */
	activity: string;
	model: string | null;
	/** The bookmark's name, when this citizen is pinned. */
	pin: string | null;
	/** The directory, only where it is not the operator's own: a pin from elsewhere always carries
	 * its path, and so does every row of the all-directories view. */
	cwd: string | null;
}

export function resumeRowText(row: ResumeRow): ResumeRowText {
	const elsewhere = row.section === "pin-elsewhere" || row.section === "elsewhere";
	return {
		gardenId: row.gardenId,
		backend: row.backend,
		facts: row.facts.split(", "),
		activity: renderActivity(row.activityMs),
		model: row.model,
		pin: row.pin,
		cwd: elsewhere ? row.cwd : null,
	};
}
