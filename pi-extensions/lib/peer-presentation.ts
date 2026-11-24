/**
 * peer-presentation — what a HUMAN listing of the garden shows first, and what it leaves out (#173 P2).
 *
 * Two surfaces read the same facts and were drowning in them: the `entwurf resume` list and the text
 * of `entwurf_peers`. On a long-lived host most records are test rooms a LIVE gate left under the OS
 * temp directory, and the newest garden ids are not the citizens anyone is working with. This module
 * is the one place that decides, for those two surfaces only, which citizens are observed, in what
 * order they are shown and which are only counted.
 *
 * IT IS PRESENTATION AND NOTHING ELSE. Nothing here is an address, a liveness verdict or permission:
 * a hidden citizen is exactly as reachable as a shown one, by its garden id. `entwurf peer-facts`
 * passes no selector and is unchanged — every row, the provider's order, every observation.
 *
 * WHAT IT READS, AND HOW OFTEN. For each certified identity: its record cwd (at most one realpath),
 * and — unless it is an unpinned test room — the mtime of the ONE transcript file its current record
 * names (at most one stat; never the content, never a directory). The transcript path stays inside
 * this module; only a time crosses out.
 *
 * TEST ROOM = the record cwd is the OS temp directory or below it, compared on whole path
 * components (`/tmp-other` is not under `/tmp`). Both sides are resolved: a directory outside temp
 * that is a symlink into it is a test room, and a symlink inside temp that leads out is not. A cwd
 * that no longer exists cannot be resolved, so it is compared as written against the temp root both
 * as written and as resolved. A relative cwd is never a test room, and a temp root that is not
 * absolute or resolves to `/` switches the rule off: hiding less is the safe direction.
 *
 * ACTIVITY = that transcript mtime; where there is no such regular file, the record's own update
 * time; where that does not parse, unknown. It orders rows and bounds the picker's seven-day window.
 * An unknown time sorts last and is never hidden by the window.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { PeerPresentationSelector } from "./entwurf-fact-provider.ts";
import type { PeerFact } from "./entwurf-facts.ts";
import type { MetaIdentity } from "./meta-session.ts";
import type { ResumePin } from "./resume-picker-rows.ts";

/** The OS temp directory in both coordinates: as configured and as resolved. */
export interface TempRoots {
	lexical: string;
	real: string;
}

/** The temp roots to compare against, or `null` when the rule is off for this host. */
export function resolveTempRoots(tmpdir: string, realpath: (p: string) => string): TempRoots | null {
	if (!path.isAbsolute(tmpdir)) return null;
	const lexical = path.resolve(tmpdir);
	let real = lexical;
	try {
		real = realpath(lexical);
	} catch {
		// An unresolvable temp root is compared as written.
	}
	if (lexical === "/" || real === "/" || !path.isAbsolute(real)) return null;
	return { lexical, real };
}

function isAtOrUnder(candidate: string, root: string): boolean {
	return candidate === root || candidate.startsWith(`${root}/`);
}

/** Is this record cwd a test room? See TEST ROOM above. */
export function isTestRoomCwd(cwd: string, roots: TempRoots | null, realpath: (p: string) => string): boolean {
	if (roots === null || !path.isAbsolute(cwd)) return false;
	let resolved: string;
	try {
		resolved = realpath(cwd);
	} catch {
		const written = path.resolve(cwd);
		return isAtOrUnder(written, roots.lexical) || isAtOrUnder(written, roots.real);
	}
	return isAtOrUnder(resolved, roots.real);
}

/** What one stat says about a path: a regular file's mtime, or that it is not one. */
export type TranscriptStat = { isFile: boolean; mtimeMs: number } | null;

/** See ACTIVITY above. `statFile` returns `null` when the path cannot be stat'ed; it is asked at most once. */
export function activityMsOf(
	identity: Pick<MetaIdentity, "transcriptPath" | "recordUpdatedAt">,
	statFile: (file: string) => TranscriptStat,
): number | null {
	if (identity.transcriptPath !== null && path.isAbsolute(identity.transcriptPath)) {
		const stat = statFile(identity.transcriptPath);
		if (stat?.isFile === true && Number.isFinite(stat.mtimeMs)) return stat.mtimeMs;
	}
	const recorded = Date.parse(identity.recordUpdatedAt);
	return Number.isFinite(recorded) ? recorded : null;
}

/** The picker's window: seven days, inclusive at exactly seven. */
export const RECENT_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

/** Inside the window? An unknown time is not hidden; a time ahead of the clock is inside. */
export function isWithinWindow(activityMs: number | null, now: number, windowMs: number): boolean {
	return activityMs === null || now - activityMs <= windowMs;
}

/** An activity time as UTC text to the minute, or `unknown`. */
export function renderActivity(activityMs: number | null): string {
	if (activityMs === null) return "unknown";
	const date = new Date(activityMs);
	return Number.isNaN(date.getTime()) ? "unknown" : `${date.toISOString().slice(0, 16)}Z`;
}

export interface PeerHint {
	testRoom: boolean;
	/** `null` when unknown — and for an unpinned test room, whose transcript is never stat'ed. */
	activityMs: number | null;
}

/** What the selector hands back beside the facts. No path is in it. */
export interface PeerPresentation {
	/** The one clock reading every window decision of this listing uses. */
	now: number;
	hints: ReadonlyMap<string, PeerHint>;
	/** The resolved temp root the test-room rule used, or `null` when the rule is off. */
	tempRoot: string | null;
}

export interface PresentationIo {
	tmpdir(): string;
	realpath(p: string): string;
	statFile(file: string): TranscriptStat;
	now(): number;
}

export interface PeerPresentationOptions {
	/** Bookmarked garden ids: always observed, test room or not, whatever their age. */
	pinnedIds: ReadonlySet<string>;
	io: PresentationIo;
	/** When set, an unpinned citizen is observed only if its activity is inside this window. */
	observeWithinMs?: number;
}

/**
 * The selector both human surfaces hand to `listEntwurfFacts`. Observed: every bookmarked citizen,
 * and every other citizen that is not a test room (and, when a window is given, is inside it). An
 * UNPINNED test room costs one realpath and nothing else: no stat, no receiver observation.
 */
export function makePeerPresentationSelector(
	opts: PeerPresentationOptions,
): PeerPresentationSelector<PeerPresentation> {
	return {
		select(identities) {
			const now = opts.io.now();
			const roots = resolveTempRoots(opts.io.tmpdir(), opts.io.realpath);
			const hints = new Map<string, PeerHint>();
			const observe = new Set<string>();
			for (const identity of identities) {
				const pinned = opts.pinnedIds.has(identity.gardenId);
				const testRoom = isTestRoomCwd(identity.cwd, roots, opts.io.realpath);
				if (testRoom && !pinned) {
					hints.set(identity.gardenId, { testRoom: true, activityMs: null });
					continue;
				}
				const activityMs = activityMsOf(identity, opts.io.statFile);
				hints.set(identity.gardenId, { testRoom, activityMs });
				if (pinned || opts.observeWithinMs === undefined || isWithinWindow(activityMs, now, opts.observeWithinMs)) {
					observe.add(identity.gardenId);
				}
			}
			return { observe, finish: () => ({ now, hints, tempRoot: roots === null ? null : roots.real }) };
		},
	};
}

// ── entwurf_peers ────────────────────────────────────────────────────────────────────────────────

/** Observed running right now, by either axis the listing has. A fact for ordering, not a verdict. */
export function isObservedLive(peer: Pick<PeerFact, "liveness" | "receiver">): boolean {
	return peer.liveness === "alive" || peer.receiver === "active";
}

/** Why the caller's bookmarks were not used, as a closed set of words — never file content. */
export type BookmarkNote = { kind: "caller-directory-unknown" } | { kind: "unreadable"; code: string };

export interface PeersDisplayRow {
	peer: PeerFact;
	/** The bookmark's name as written in the file; the renderer encodes it. */
	bookmark: string | null;
	activityMs: number | null;
}

export interface PeersDisplayPlan {
	/** The rows to print, in print order: bookmarks (file order), observed live, activity, garden id. */
	rows: PeersDisplayRow[];
	/** Citizens that are neither shown nor test rooms: they did not fit the row budget. */
	outsideBudget: number;
	/** Unpinned test rooms: counted, never observed, never a row. */
	testRooms: number;
	tempRoot: string | null;
	bookmarksWithoutRecord: number;
	bookmarkNote: BookmarkNote | null;
}

/**
 * Choose and order the rows of the `entwurf_peers` text. Priority is bookmark (file order), then
 * observed live, then activity (newest first, unknown last), then garden id (newest first). The
 * budget is applied AFTER the order, so more bookmarks than rows push everything else out — this
 * never promises that a live citizen is shown.
 */
export function planPeersDisplay(
	peers: readonly PeerFact[],
	presentation: PeerPresentation,
	pins: readonly ResumePin[],
	limit: number,
	bookmarkNote: BookmarkNote | null = null,
): PeersDisplayPlan {
	const pinOrder = new Map<string, { name: string; index: number }>();
	for (const [index, pin] of pins.entries()) {
		if (!pinOrder.has(pin.gardenId)) pinOrder.set(pin.gardenId, { name: pin.name, index });
	}
	const seen = new Set<string>();
	const candidates: PeersDisplayRow[] = [];
	let testRooms = 0;
	for (const peer of peers) {
		seen.add(peer.gardenId);
		const hint = presentation.hints.get(peer.gardenId);
		const pin = pinOrder.get(peer.gardenId);
		if (hint?.testRoom === true && pin === undefined) {
			testRooms += 1;
			continue;
		}
		candidates.push({ peer, bookmark: pin === undefined ? null : pin.name, activityMs: hint?.activityMs ?? null });
	}
	candidates.sort((a, b) => {
		const pa = pinOrder.get(a.peer.gardenId)?.index;
		const pb = pinOrder.get(b.peer.gardenId)?.index;
		if (pa !== undefined || pb !== undefined) {
			if (pa === undefined) return 1;
			if (pb === undefined) return -1;
			return pa - pb;
		}
		const la = isObservedLive(a.peer);
		const lb = isObservedLive(b.peer);
		if (la !== lb) return la ? -1 : 1;
		if (a.activityMs !== b.activityMs) {
			if (a.activityMs === null) return 1;
			if (b.activityMs === null) return -1;
			return b.activityMs - a.activityMs;
		}
		return a.peer.gardenId < b.peer.gardenId ? 1 : a.peer.gardenId > b.peer.gardenId ? -1 : 0;
	});
	const rows = candidates.slice(0, Math.max(0, limit));
	return {
		rows,
		outsideBudget: candidates.length - rows.length,
		testRooms,
		tempRoot: presentation.tempRoot,
		bookmarksWithoutRecord: [...pinOrder.keys()].filter((gardenId) => !seen.has(gardenId)).length,
		bookmarkNote,
	};
}

const BOOKMARK_LABEL_MAX = 40;

/**
 * A bookmark name as ONE quoted token. The name is a person's free text read from a file, and this
 * text goes to a model: so no line break, control character, escape sequence, invisible or
 * direction-changing character leaves here as itself, and the length is bounded. Anything outside
 * the plain set is written as `\u{…}`, including the quote and the backslash.
 */
export function bookmarkLabel(name: string): string {
	const points = Array.from(name);
	const kept = points.slice(0, BOOKMARK_LABEL_MAX).map((ch) => {
		const code = ch.codePointAt(0) as number;
		const unsafe =
			code < 0x20 ||
			(code >= 0x7f && code <= 0x9f) ||
			ch === '"' ||
			ch === "\\" ||
			(code >= 0x200b && code <= 0x200f) ||
			(code >= 0x2028 && code <= 0x202e) ||
			(code >= 0x2060 && code <= 0x2069) ||
			code === 0xfeff ||
			(code >= 0xd800 && code <= 0xdfff);
		return unsafe ? `\\u{${code.toString(16)}}` : ch;
	});
	return `"${kept.join("")}${points.length > BOOKMARK_LABEL_MAX ? "…" : ""}"`;
}

// ── whose bookmarks an MCP caller's are ──────────────────────────────────────────────────────────

export type PeersCallerDirectory = { kind: "known"; cwd: string } | { kind: "unknown" };

/**
 * The directory whose `team.json` an `entwurf_peers` call reads.
 *
 * A bridge is its host's child and shares its directory — except under Codex, where the bridge is
 * the operator-owned app-server's child and that directory is the app-server's, not the caller's.
 * So: not a Codex bridge → this process's directory, and the caller's identity is never resolved.
 * A Codex bridge → the calling citizen's record cwd, resolved once; if that cannot be resolved the
 * answer is `unknown` and no bookmark file is read at all. The app-server's directory is never used:
 * a wrong bookmark would lift a test room into the list and push real rows out of the budget.
 */
export async function resolvePeersCallerDirectory(deps: {
	isCodexBridge: boolean;
	processCwd: () => string;
	/** The calling Codex citizen's record cwd, or `undefined` when the request names none. May throw. */
	codexCallerCwd: () => Promise<string | undefined>;
}): Promise<PeersCallerDirectory> {
	if (!deps.isCodexBridge) return { kind: "known", cwd: deps.processCwd() };
	try {
		const cwd = await deps.codexCallerCwd();
		return cwd === undefined ? { kind: "unknown" } : { kind: "known", cwd };
	} catch {
		return { kind: "unknown" };
	}
}

// ── the real observations ────────────────────────────────────────────────────────────────────────

/** This host's temp directory, realpath, one stat of a named file and the clock. */
export function productionPresentationIo(): PresentationIo {
	return {
		tmpdir: () => os.tmpdir(),
		realpath: (p) => fs.realpathSync(p),
		statFile: (file) => {
			try {
				const stat = fs.statSync(file);
				return { isFile: stat.isFile(), mtimeMs: stat.mtimeMs };
			} catch {
				return null;
			}
		},
		now: () => Date.now(),
	};
}
