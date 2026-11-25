/**
 * resume-picker — the list an operator narrows and chooses from in `entwurf resume` (#173 C3).
 *
 * No external tool: this is a public package, and an `entwurf resume` that needed a picker binary
 * would be dead on every host that lacks it. Node builtins only, and no import of them here either
 * — the terminal arrives as an injected `PickerIo`, so the whole thing runs in a test with no tty.
 *
 * WHAT IT IS. A way to pick ONE garden id, or none. It reads nothing but the listing it is handed
 * and the keys the operator presses: no record, no socket, no lock, no launch. Esc and Ctrl-C return
 * `cancelled`. Anything else that ends the picker is a thrown error, which is neither of those.
 *
 * ENTER IS THE ONLY KEY THAT CHOOSES, and Enter is a carriage return (CR: what the Enter key sends
 * in raw mode, through tmux too). A line feed (LF) is Ctrl-J, which MOVES DOWN (#176): a path that
 * sent LF for Enter would move the cursor and open nothing, never the other way round. There is no
 * confirmation line, so the choice is guarded where it is made:
 *   - the screen says in words what Enter will do, and Enter is honoured only while the whole frame
 *     fits — the row under the cursor with its full garden id, and that sentence. In a terminal too
 *     small for it the list says so, Enter does nothing, and only a cancel leaves;
 *   - a MARKED paste does not choose. Bracketed paste is switched on, so a paste arrives between
 *     markers and its line breaks become spaces in the search;
 *   - an UNMARKED paste is only mitigated: an Enter that arrives in the same read as any other key
 *     is dropped, and so is a line feed that arrives in the same read as typed text (a pasted line
 *     break, not a Ctrl-J). That is a same-read mitigation, not proof of intent — it cannot tell
 *     who pressed an Enter that arrives alone.
 * KNOWN RESIDUAL RISK (accepted by GLG, 2026-11-24): if a terminal ignores bracketed paste AND
 * delivers a pasted text and its trailing line break in separate reads, that line break is an Enter
 * on its own and DOES choose the row the pasted text narrowed to. Nothing here can tell that Enter
 * from a typed one. The beside test records this behaviour as it is.
 *
 * THE TERMINAL IS GIVEN BACK ON EVERY EXIT. Raw mode, the alternate screen, the hidden cursor and
 * bracketed paste are undone by one `restore` that a selection, a cancel, an error and a signal all
 * reach, exactly once, and that undoes only what was actually switched on. A signal restores first,
 * waits for that to be written, and only then is passed on.
 *
 * WIDTH IS MEASURED IN CELLS, not code units: bookmark names here are Korean, and a wide character
 * takes two cells. A line is cut to the terminal's width by cell count so a long row never wraps
 * and pushes the frame out of step. The measure covers ordinary Hangul and CJK text and fullwidth
 * forms; grapheme clusters and emoji sequences are not modelled. Every character this module itself
 * prints is ASCII, so the frame's own width does not depend on how a terminal draws a symbol.
 */

import {
	hiddenResumeCounts,
	type ResumeListing,
	type ResumeRow,
	type ResumeRowSection,
	type ResumeRowText,
	resumeRowText,
	unlistedResumeCounts,
	visibleResumeRows,
} from "./resume-picker-rows.ts";

// ── cell width ─────────────────────────────────────────────────────────────────────────────────

/** Terminal cells one code point takes: 0 for combining marks and controls, 2 for East Asian wide
 * and fullwidth forms (Hangul, kana, CJK ideographs, fullwidth ASCII, common emoji), else 1. */
export function codePointWidth(cp: number): 0 | 1 | 2 {
	if (cp < 0x20 || (cp >= 0x7f && cp < 0xa0)) return 0;
	if ((cp >= 0x0300 && cp <= 0x036f) || (cp >= 0x200b && cp <= 0x200f) || (cp >= 0xfe00 && cp <= 0xfe0f)) return 0;
	if (
		(cp >= 0x1100 && cp <= 0x115f) ||
		(cp >= 0x2e80 && cp <= 0x303e) ||
		(cp >= 0x3041 && cp <= 0x33ff) ||
		(cp >= 0x3400 && cp <= 0x4dbf) ||
		(cp >= 0x4e00 && cp <= 0x9fff) ||
		(cp >= 0xa000 && cp <= 0xa4cf) ||
		(cp >= 0xa960 && cp <= 0xa97f) ||
		(cp >= 0xac00 && cp <= 0xd7a3) ||
		(cp >= 0xf900 && cp <= 0xfaff) ||
		(cp >= 0xfe30 && cp <= 0xfe4f) ||
		(cp >= 0xff00 && cp <= 0xff60) ||
		(cp >= 0xffe0 && cp <= 0xffe6) ||
		(cp >= 0x1f300 && cp <= 0x1f64f) ||
		(cp >= 0x1f900 && cp <= 0x1f9ff) ||
		(cp >= 0x20000 && cp <= 0x3fffd)
	) {
		return 2;
	}
	return 1;
}

export function displayWidth(text: string): number {
	let width = 0;
	for (const ch of text) width += codePointWidth(ch.codePointAt(0) ?? 0);
	return width;
}

/** Cut `text` to at most `cells` cells. A wide character that would straddle the edge is dropped,
 * never split, and control characters are removed so a row cannot move the cursor. */
export function fitToWidth(text: string, cells: number): string {
	let out = "";
	let width = 0;
	for (const ch of text) {
		const cp = ch.codePointAt(0) ?? 0;
		if (cp < 0x20 || (cp >= 0x7f && cp < 0xa0)) continue;
		const w = codePointWidth(cp);
		if (width + w > cells) break;
		out += ch;
		width += w;
	}
	return out;
}

// ── keys ───────────────────────────────────────────────────────────────────────────────────────

export type PickerKey =
	| { kind: "text"; text: string }
	| { kind: "up" | "down" | "page-up" | "page-down" | "home" | "end" }
	/** Ctrl-J. A move down like any other, except that a line feed sharing its read with typed text
	 * is a pasted line break and is dropped (`keysOfOneRead`). */
	| { kind: "down"; lineFeed: true }
	| { kind: "backspace" | "clear" | "toggle-directories" | "enter" | "cancel" };

const ESC = "\x1b";
const PASTE_START = `${ESC}[200~`;
const PASTE_END = `${ESC}[201~`;

const SEQUENCES: readonly [string, PickerKey["kind"]][] = [
	// Alt-J / Alt-K arrive as ESC and the letter (#176). Every other Alt chord is skipped whole.
	[`${ESC}j`, "down"],
	[`${ESC}k`, "up"],
	[`${ESC}[A`, "up"],
	[`${ESC}OA`, "up"],
	[`${ESC}[B`, "down"],
	[`${ESC}OB`, "down"],
	[`${ESC}[5~`, "page-up"],
	[`${ESC}[6~`, "page-down"],
	[`${ESC}[H`, "home"],
	[`${ESC}OH`, "home"],
	[`${ESC}[1~`, "home"],
	[`${ESC}[F`, "end"],
	[`${ESC}OF`, "end"],
	[`${ESC}[4~`, "end"],
];

const SIMPLE_KEYS: Readonly<Record<string, PickerKey>> = {
	"\r": { kind: "enter" },
	// Ctrl-J is a line feed and Ctrl-K a vertical tab: down and up (#176), beside Ctrl-N / Ctrl-P.
	"\n": { kind: "down", lineFeed: true },
	"\x0b": { kind: "up" },
	"\x03": { kind: "cancel" },
	"\x07": { kind: "cancel" },
	"\x7f": { kind: "backspace" },
	"\x08": { kind: "backspace" },
	"\x15": { kind: "clear" },
	"\x01": { kind: "toggle-directories" },
	"\x10": { kind: "up" },
	"\x0e": { kind: "down" },
};

/** Pasted text as search text: a line break or a tab is a space, any other control byte is gone.
 * Nothing in a paste is a key. */
function pasteAsText(text: string): string {
	let out = "";
	for (const ch of text) {
		const cp = ch.codePointAt(0) ?? 0;
		if (ch === "\r" || ch === "\n" || ch === "\t") out += " ";
		else if (cp >= 0x20 && cp !== 0x7f) out += ch;
	}
	return out;
}

/** How much of an escape sequence `rest` (which starts with ESC) holds: a known key, a complete
 * sequence to skip, or an unfinished one that the next read may complete. */
function readEscape(
	rest: string,
): { kind: "key"; key: PickerKey["kind"]; length: number } | { kind: "skip"; length: number } | { kind: "unfinished" } {
	if (rest.length === 1) return { kind: "unfinished" };
	const known = SEQUENCES.find(([seq]) => rest.startsWith(seq));
	if (known !== undefined) return { kind: "key", key: known[1], length: known[0].length };
	if (rest[1] === "[") {
		// CSI: parameter bytes 0–?, intermediate bytes space–/, then one final byte @–~.
		const csi = /^[0-9:;<=>?]*[ -/]*[@-~]/.exec(rest.slice(2));
		if (csi !== null) return { kind: "skip", length: 2 + csi[0].length };
		return /^[0-9:;<=>?]*[ -/]*$/.test(rest.slice(2)) ? { kind: "unfinished" } : { kind: "skip", length: 2 };
	}
	// SS3 takes one more byte; ESC plus any other character is an Alt chord that is not a key here.
	if (rest[1] === "O") return rest.length >= 3 ? { kind: "skip", length: 3 } : { kind: "unfinished" };
	return { kind: "skip", length: 2 };
}

/**
 * Terminal input → keys, across reads. A terminal may split an escape sequence or a paste marker
 * between two reads, so the unfinished tail is kept and joined to the next one.
 *
 *   - An escape sequence this picker knows is its key; one it does not is skipped WHOLE, so no tail
 *     of it is ever typed into the search.
 *   - Between the bracketed-paste markers everything is search text and nothing is a key.
 *   - A lone ESC cannot be told from the start of a split sequence until time passes: `feed` keeps
 *     it, and `flush` — called by the runner after a short wait with no further input — turns a kept
 *     lone ESC into the Esc key and drops any other unfinished sequence. That wait is the whole rule
 *     between Esc and Alt-J/K (#176): a letter that arrives within it — in the same read or the next —
 *     binds to the ESC and moves; an ESC nothing follows within it is Esc, and after that cancel a
 *     late letter has no list left to act on.
 */
export interface PickerDecoder {
	feed(chunk: string): PickerKey[];
	flush(): PickerKey[];
	/** Is an unfinished escape sequence being held, so that `flush` is owed? */
	pending(): boolean;
}

export function createPickerDecoder(): PickerDecoder {
	let carry = "";
	let pasting = false;
	return {
		pending: () => !pasting && carry.length > 0,
		flush: () => {
			if (pasting) return [];
			const held = carry;
			carry = "";
			return held === ESC ? [{ kind: "cancel" }] : [];
		},
		feed: (chunk) => {
			const data = carry + chunk;
			carry = "";
			const keys: PickerKey[] = [];
			let text = "";
			const flushText = (): void => {
				if (text.length > 0) keys.push({ kind: "text", text });
				text = "";
			};
			let i = 0;
			while (i < data.length) {
				const rest = data.slice(i);
				if (pasting) {
					const end = rest.indexOf(PASTE_END);
					if (end >= 0) {
						text += pasteAsText(rest.slice(0, end));
						pasting = false;
						i += end + PASTE_END.length;
						continue;
					}
					// The end marker may be split across reads: hold the longest tail that could begin it.
					let hold = 0;
					for (let n = Math.min(PASTE_END.length - 1, rest.length); n > 0; n--) {
						if (PASTE_END.startsWith(rest.slice(rest.length - n))) {
							hold = n;
							break;
						}
					}
					text += pasteAsText(rest.slice(0, rest.length - hold));
					carry = rest.slice(rest.length - hold);
					break;
				}
				if (rest[0] === ESC) {
					if (rest.startsWith(PASTE_START)) {
						pasting = true;
						i += PASTE_START.length;
						continue;
					}
					if (PASTE_START.startsWith(rest)) {
						flushText();
						carry = rest;
						break;
					}
					const seq = readEscape(rest);
					if (seq.kind === "unfinished") {
						flushText();
						carry = rest;
						break;
					}
					flushText();
					if (seq.kind === "key") keys.push({ kind: seq.key } as PickerKey);
					i += seq.length;
					continue;
				}
				const ch = rest[0] as string;
				const key = SIMPLE_KEYS[ch];
				if (key !== undefined) {
					flushText();
					keys.push(key);
				} else if (ch >= " ") {
					text += ch;
				}
				// Any other control byte is not a key here and is dropped.
				i += 1;
			}
			flushText();
			return keys;
		},
	};
}

/**
 * The keys of ONE read that may act. An Enter that shares its read with any other key is dropped:
 * text with line breaks arriving at once is most likely a paste from a terminal that did not mark
 * it. Dropping errs toward opening nothing — the operator presses Enter again. For the same reason
 * a line feed that shares its read with typed text is a pasted line break, not Ctrl-J, and moves
 * nothing; line feeds with no text beside them (Ctrl-J held down) still move. A same-read
 * mitigation, not proof of intent: this looks at one read only, and a carriage return delivered in
 * a read of its own is an Enter (see KNOWN RESIDUAL RISK in the module header).
 */
export function keysOfOneRead(keys: readonly PickerKey[]): PickerKey[] {
	const withText = keys.some((key) => key.kind === "text");
	return keys.filter((key) => {
		if (key.kind === "enter") return keys.length === 1;
		return !(withText && "lineFeed" in key);
	});
}

// ── state ──────────────────────────────────────────────────────────────────────────────────────

export interface PickerState {
	query: string;
	allDirectories: boolean;
	/** Index into the visible ROWS (section headers are not selectable). */
	cursor: number;
	/** Index of the first frame item drawn in the body. */
	top: number;
}

export const INITIAL_PICKER_STATE: PickerState = { query: "", allDirectories: false, cursor: 0, top: 0 };

export type PickerItem = { kind: "header"; text: string } | { kind: "row"; row: ResumeRow; index: number };

const SECTION_TITLE: Record<ResumeRowSection, string> = {
	"pin-here": "Bookmarked, this directory",
	"pin-elsewhere": "Bookmarked, other directories",
	here: "This directory",
	elsewhere: "Other directories",
};

/** The body as drawn: a header before each section's first row, then that section's rows. */
export function pickerItems(rows: readonly ResumeRow[]): PickerItem[] {
	const items: PickerItem[] = [];
	let section: ResumeRowSection | null = null;
	for (const [index, row] of rows.entries()) {
		if (row.section !== section) {
			section = row.section;
			items.push({ kind: "header", text: SECTION_TITLE[section] });
		}
		items.push({ kind: "row", row, index });
	}
	return items;
}

export interface PickerSize {
	columns: number;
	rows: number;
}

/** Lines above the body (title, filter, search) and below it (selected, notes, Enter, keys). */
const HEAD_LINES = 3;
const FOOT_LINES = 4;

/** The smallest terminal the list is usable in: one body line, and wide enough for a row's marker,
 * full garden id, backend and facts (59 cells), for the sentence that says what Enter does and for
 * the compact line of keys (64 cells) — none of them cut. */
export const PICKER_MIN_SIZE: PickerSize = { columns: 64, rows: HEAD_LINES + 1 + FOOT_LINES };

export function pickerFits(size: PickerSize): boolean {
	return size.columns >= PICKER_MIN_SIZE.columns && size.rows >= PICKER_MIN_SIZE.rows;
}

/** How many body lines fit. Only meaningful while `pickerFits`; never less than one. */
export function pickerBodyHeight(size: PickerSize): number {
	return Math.max(1, size.rows - HEAD_LINES - FOOT_LINES);
}

/** Keep the cursor inside the rows that exist, and the window around the cursor (and around the
 * header just above it, when that fits). Called after every change of state, list or size. */
export function settlePickerState(state: PickerState, rows: readonly ResumeRow[], bodyHeight: number): PickerState {
	const cursor = rows.length === 0 ? 0 : Math.min(Math.max(state.cursor, 0), rows.length - 1);
	const items = pickerItems(rows);
	const at = items.findIndex((item) => item.kind === "row" && item.index === cursor);
	let top = Math.min(Math.max(state.top, 0), Math.max(0, items.length - bodyHeight));
	if (at >= 0) {
		const first = at > 0 && items[at - 1]?.kind === "header" && bodyHeight > 1 ? at - 1 : at;
		if (first < top) top = first;
		if (at >= top + bodyHeight) top = at - bodyHeight + 1;
	}
	return { ...state, cursor, top };
}

export type PickerStep =
	| { kind: "continue"; state: PickerState }
	| { kind: "selected"; gardenId: string }
	| { kind: "cancelled" };

/**
 * One key. While the terminal is too small for the frame, nothing but a cancel acts: Enter cannot
 * choose a row the operator cannot read, and the state is left as it was so the same row is under
 * the cursor when the terminal grows back. Narrowing or lifting the directory filter puts the cursor
 * on the first row, because the row it was on may no longer be there. Enter on an empty list does
 * nothing.
 */
export function stepPicker(state: PickerState, key: PickerKey, listing: ResumeListing, size: PickerSize): PickerStep {
	if (key.kind === "cancel") return { kind: "cancelled" };
	if (!pickerFits(size)) return { kind: "continue", state };
	const bodyHeight = pickerBodyHeight(size);
	const rowsNow = visibleResumeRows(listing, state);
	const settle = (next: PickerState): PickerStep => ({
		kind: "continue",
		state: settlePickerState(next, visibleResumeRows(listing, next), bodyHeight),
	});
	switch (key.kind) {
		case "enter": {
			const row = rowsNow[state.cursor];
			return row === undefined ? { kind: "continue", state } : { kind: "selected", gardenId: row.gardenId };
		}
		case "text":
			return settle({ ...state, query: state.query + key.text, cursor: 0, top: 0 });
		case "backspace":
			return settle({ ...state, query: [...state.query].slice(0, -1).join(""), cursor: 0, top: 0 });
		case "clear":
			return settle({ ...state, query: "", cursor: 0, top: 0 });
		case "toggle-directories":
			return settle({ ...state, allDirectories: !state.allDirectories, cursor: 0, top: 0 });
		case "up":
			return settle({ ...state, cursor: state.cursor - 1 });
		case "down":
			return settle({ ...state, cursor: state.cursor + 1 });
		case "page-up":
			return settle({ ...state, cursor: state.cursor - bodyHeight });
		case "page-down":
			return settle({ ...state, cursor: state.cursor + bodyHeight });
		case "home":
			return settle({ ...state, cursor: 0 });
		case "end":
			return settle({ ...state, cursor: rowsNow.length - 1 });
	}
}

// ── frame ──────────────────────────────────────────────────────────────────────────────────────

/** Where a chosen citizen will be reopened — said on screen because Enter asks nothing further. */
export type PickerRail = "tmux" | "herdr";

const ENTER_LINE: Record<PickerRail, string> = {
	tmux: "Enter: reopen in a new tmux window beside this one",
	herdr: "Enter: reopen in a new herdr tab",
};

/** The keys that move and the key that leaves, always whole: the full line where it fits, else the
 * compact one, which is exactly as wide as the narrowest terminal the list is drawn in. Every key
 * named here acts as named; PgUp/PgDn, Home/End and Ctrl-N/P act in both. */
const KEYS_LINE_FULL = "Esc: open nothing | Up/Down, Ctrl-J/K, Alt-J/K, PgUp/PgDn: move | type to narrow";
const KEYS_LINE_COMPACT = "Esc: open nothing | Up/Down, Ctrl/Alt-J/K: move | type to narrow";

export function keysLine(columns: number): string {
	return columns >= KEYS_LINE_FULL.length ? KEYS_LINE_FULL : KEYS_LINE_COMPACT;
}

/** What a piece of a line is. The frame is laid out as pieces so the runner can emphasise each by
 * what it is; a plain line — what a test reads — is the pieces' text joined. */
export type PickerRole =
	| "plain"
	| "dim"
	| "title"
	| "rule"
	| "header"
	| "cursor"
	| "pin"
	| "id"
	| "backend"
	| "fact"
	| "activity"
	| "model"
	| "cwd"
	| "key";

export interface PickerSpan {
	text: string;
	role: PickerRole;
}

const span = (text: string, role: PickerRole = "plain"): PickerSpan => ({ text, role });

/** Cut pieces to at most `cells` cells, in order: a piece that does not fit whole is cut by
 * `fitToWidth` and nothing after it is kept. */
export function fitSpans(spans: readonly PickerSpan[], cells: number): PickerSpan[] {
	const out: PickerSpan[] = [];
	let left = cells;
	for (const piece of spans) {
		const text = fitToWidth(piece.text, left);
		if (text.length > 0) out.push({ text, role: piece.role });
		left -= displayWidth(text);
		if (displayWidth(text) < displayWidth(piece.text)) break;
	}
	return out;
}

const joinSpans = (spans: readonly PickerSpan[]): string => spans.map((piece) => piece.text).join("");

/** `text` followed by spaces up to `cells` cells (never cut here). */
function padCells(text: string, cells: number): string {
	return text + " ".repeat(Math.max(0, cells - displayWidth(text)));
}

/** A name in at most `cells` cells: whole, or cut with `~` as its last cell so a cut is never read
 * as the whole name. The selected line below the list always carries it whole. */
function cutName(name: string, cells: number): string {
	return displayWidth(name) <= cells ? name : `${fitToWidth(name, cells - 1)}~`;
}

/** The END of `text` in at most `cells` cells, after `...`: the tail of a path is the part that
 * tells two directories apart. */
function cutPathStart(text: string, cells: number): string {
	const chars = [...text];
	let out = "";
	let used = 3;
	for (let i = chars.length - 1; i >= 0; i--) {
		const cell = displayWidth(chars[i] as string);
		if (used + cell > cells) break;
		out = chars[i] + out;
		used += cell;
	}
	return `...${out}`;
}

function widest(texts: readonly string[]): number {
	let width = 0;
	for (const text of texts) width = Math.max(width, displayWidth(text));
	return width;
}

const GAP = "  ";
/** The most cells a bookmark name takes, and the fewest worth drawing — below that the row keeps
 * only its `*` and the selected line names it. */
const NAME_MAX_CELLS = 24;
const NAME_MIN_CELLS = 5;
/** The fewest cells a cut path is drawn in; below that it is left to the selected line. */
const PATH_MIN_CELLS = 8;

/** Column widths for one kind of row — bookmarked or not — in a terminal `columns` wide. */
interface RowColumns {
	pinned: boolean;
	/** Cells of the bookmark name; 0 when this kind carries none or no cell is left for one. */
	name: number;
	id: number;
	backend: number;
	facts: number;
	/** Cells of the activity time; 0 when it does not fit whole, and then nothing after it is drawn. */
	activity: number;
}

/**
 * Where each field of a row goes (#176). The bookmark mark and name come first, then what must
 * never be cut — the whole garden id, the backend and the facts, which the minimum size guarantees —
 * then the activity time, the model and the directory, each drawn whole or not at all (a cut path
 * keeps its end). A bookmarked row is found by its name and kept in bookmark order, so its name
 * takes room before its activity time does; an unbookmarked row is ordered and found by its time,
 * which comes right after its facts. Widths are measured over EVERY row of the listing, so the columns stay put
 * while the operator narrows, scrolls or lifts the filter, and the id, backend, facts and activity
 * columns are as wide for a bookmarked row as for any other.
 */
function rowColumns(texts: readonly ResumeRowText[], pinned: boolean, columns: number): RowColumns {
	const id = widest(texts.map((t) => t.gardenId));
	const backend = widest(texts.map((t) => t.backend));
	const facts = widest(texts.map((t) => t.facts.join(", ")));
	const activityCells = widest(texts.map((t) => t.activity));
	const nameFull = pinned ? Math.min(NAME_MAX_CELLS, widest(texts.map((t) => t.pin ?? ""))) : 0;
	// A listing with no bookmark draws no bookmark column at all.
	if (pinned && nameFull === 0) return { pinned, name: 0, id, backend, facts, activity: 0 };
	let room = columns - (2 + (pinned ? 2 : 0) + id + GAP.length + backend + GAP.length + facts);
	let name = Math.min(nameFull, Math.max(0, room - GAP.length));
	if (name < Math.min(nameFull, NAME_MIN_CELLS)) name = 0;
	if (name > 0) room -= name + GAP.length;
	const activity = room >= GAP.length + activityCells ? activityCells : 0;
	return { pinned, name, id, backend, facts, activity };
}

/** One row as pieces: `> ` on the cursor's row, `* ` and the name on a bookmarked one. */
function rowSpans(text: ResumeRowText, cols: RowColumns, cursor: boolean, columns: number): PickerSpan[] {
	const out: PickerSpan[] = [span(cursor ? "> " : "  ", "cursor")];
	if (cols.pinned) {
		out.push(span("* ", "pin"));
		if (cols.name > 0) out.push(span(padCells(cutName(text.pin ?? "", cols.name), cols.name), "pin"), span(GAP));
	}
	out.push(
		span(padCells(text.gardenId, cols.id), "id"),
		span(GAP),
		span(padCells(text.backend, cols.backend), "backend"),
	);
	out.push(span(GAP));
	for (const [i, fact] of text.facts.entries()) {
		if (i > 0) out.push(span(", "));
		out.push(span(fact, "fact"));
	}
	out.push(span(" ".repeat(Math.max(0, cols.facts - displayWidth(text.facts.join(", "))))));
	if (cols.activity > 0) {
		out.push(span(GAP), span(padCells(text.activity, cols.activity), "activity"));
		let used = displayWidth(joinSpans(out));
		if (text.model !== null && used + GAP.length + displayWidth(text.model) <= columns) {
			out.push(span(GAP), span(text.model, "model"));
			used += GAP.length + displayWidth(text.model);
		}
		if (text.cwd !== null) {
			const room = columns - used - GAP.length;
			if (displayWidth(text.cwd) <= room) out.push(span(GAP), span(text.cwd, "cwd"));
			else if (room >= PATH_MIN_CELLS) out.push(span(GAP), span(cutPathStart(text.cwd, room), "cwd"));
		}
	}
	// No padding after the last field: a row ends where its text does.
	while (out.length > 0 && (out[out.length - 1] as PickerSpan).text.trim() === "") out.pop();
	const last = out[out.length - 1];
	if (last !== undefined) out[out.length - 1] = { ...last, text: last.text.trimEnd() };
	return out;
}

/** A section title: a rule across the whole width, so it can never be read as a row. */
function headerSpans(title: string, columns: number): PickerSpan[] {
	const head = `== ${title} `;
	return [
		span("== ", "rule"),
		span(title, "header"),
		span(" "),
		span("=".repeat(Math.max(2, columns - displayWidth(head))), "rule"),
	];
}

/** The frame of a terminal too small for the list: what is wrong, and the one key that still acts. */
export function tooSmallLines(size: PickerSize): string[] {
	const fit = (line: string): string => fitToWidth(line, Math.max(1, size.columns));
	return [
		fit(
			`terminal too small: the list needs ${PICKER_MIN_SIZE.columns}x${PICKER_MIN_SIZE.rows}, this is ${size.columns}x${size.rows}`,
		),
		fit("Enter does nothing here. Esc: open nothing"),
	].slice(0, Math.max(1, size.rows));
}

/** What the body says when no row is drawn — what is empty, then the keys that would bring rows
 * back. Opening nothing is the only thing Enter can do here. */
function emptyLines(query: string, allDirectories: boolean): string[] {
	const allKey = allDirectories ? [] : ["Ctrl-A: all directories"];
	return query.trim().length > 0
		? [`  nothing matches "${query}"`, `  ${["Backspace or Ctrl-U to widen", ...allKey].join(", ")}`]
		: [`  no sibling to list${allDirectories ? "" : " in this directory"}`, ...allKey.map((key) => `  ${key}`)];
}

const DIRECTORY_KEY = "  (Ctrl-A: all directories)";

/** A path in `cells` cells: whole, else its end after `...` while that leaves enough to read. */
function fitPath(path: string, cells: number): string {
	return displayWidth(path) <= cells || cells < PATH_MIN_CELLS ? path : cutPathStart(path, cells);
}

const ENTER_LINE_EMPTY = "Enter: nothing to reopen while no row is listed";

/**
 * The whole frame as lines, each already cut to the terminal's width, and never more lines than the
 * terminal has. `lines` are plain text and `spans` the same lines as pieces that say what each part
 * is. `cursorLine` is the index of the line holding the row under the cursor, or -1 when no row is
 * drawn — which is also when Enter chooses nothing. No escape codes here: how a piece is emphasised
 * is the runner's business, and plain lines are what a test reads.
 */
export function renderPickerFrame(
	listing: ResumeListing,
	state: PickerState,
	size: PickerSize,
	rail: PickerRail,
): { lines: string[]; spans: PickerSpan[][]; cursorLine: number } {
	if (!pickerFits(size)) {
		const lines = tooSmallLines(size);
		return { lines, spans: lines.map((line) => [span(line)]), cursorLine: -1 };
	}
	const rows = visibleResumeRows(listing, state);
	const total = visibleResumeRows(listing, { allDirectories: state.allDirectories, query: "" }).length;
	const items = pickerItems(rows);
	const bodyHeight = pickerBodyHeight(size);
	const fit = (pieces: readonly PickerSpan[]): PickerSpan[] => fitSpans(pieces, size.columns);
	const texts = listing.rows.map(resumeRowText);
	const pinnedCols = rowColumns(texts, true, size.columns);
	const plainCols = rowColumns(texts, false, size.columns);

	// The key that lifts the filter is the line's point; a long path gives up its start instead.
	const directoryRoom = size.columns - displayWidth("directory: ") - displayWidth(DIRECTORY_KEY);
	const out: PickerSpan[][] = [
		fit([span("entwurf resume", "title"), span(` - ${rows.length} of ${total} shown`)]),
		fit(
			state.allDirectories
				? [span("all directories"), span("  (Ctrl-A: this directory only)", "dim")]
				: [span("directory: ", "dim"), span(fitPath(listing.callerCwd, directoryRoom)), span(DIRECTORY_KEY, "dim")],
		),
		fit([span("search: ", "dim"), span(state.query)]),
	];
	let cursorLine = -1;
	const body = items.slice(state.top, state.top + bodyHeight);
	for (const item of body) {
		if (item.kind === "header") {
			out.push(fit(headerSpans(item.text, size.columns)));
		} else {
			const cursor = item.index === state.cursor;
			if (cursor) cursorLine = out.length;
			const text = resumeRowText(item.row);
			out.push(fit(rowSpans(text, text.pin === null ? plainCols : pinnedCols, cursor, size.columns)));
		}
	}
	if (rows.length === 0) {
		for (const line of emptyLines(state.query, state.allDirectories)) {
			if (out.length < HEAD_LINES + bodyHeight) out.push(fit([span(line, "dim")]));
		}
	}
	// The body always takes its full height, so the four lines below stay where they are.
	while (out.length < HEAD_LINES + bodyHeight) out.push([]);

	// The row under the cursor again, on a line of its own and whole as far as the width allows: its
	// id, its bookmark name, and its directory — what tells two siblings apart when a narrow
	// terminal has cut the row.
	const selected = rows[state.cursor];
	if (selected === undefined) {
		out.push([]);
	} else {
		const head = [
			span("selected: ", "dim"),
			span(selected.gardenId, "id"),
			...(selected.pin === null ? [] : [span("  ["), span(selected.pin, "pin"), span("]")]),
			span("  in ", "dim"),
		];
		out.push(fit([...head, span(fitPath(selected.cwd, size.columns - displayWidth(joinSpans(head))), "cwd")]));
	}

	const unlisted = unlistedResumeCounts(listing, state.allDirectories);
	const notes: string[] = [];
	// First on the line, because a narrow terminal cuts the line's end: what this list left out. It
	// states the display rule and nothing about what such a citizen can do.
	const hidden = hiddenResumeCounts(listing, state.allDirectories);
	const hiddenParts = [
		...(hidden.older > 0 ? [`${hidden.older} older than 7 days`] : []),
		...(hidden["test-room"] > 0 ? [`${hidden["test-room"]} test ${hidden["test-room"] === 1 ? "room" : "rooms"}`] : []),
	];
	if (hiddenParts.length > 0) notes.push(`not shown: ${hiddenParts.join(", ")}`);
	if (unlisted.length > 0) {
		const sum = unlisted.reduce((n, [, count]) => n + count, 0);
		notes.push(
			`${sum} ${sum === 1 ? "citizen" : "citizens"} of other backends ${sum === 1 ? "is" : "are"} not listed (${unlisted.map(([backend, count]) => `${backend} ${count}`).join(", ")})`,
		);
	}
	const ghosts = listing.pinsWithoutRecord.length;
	if (ghosts > 0) notes.push(`${ghosts} ${ghosts === 1 ? "bookmark has" : "bookmarks have"} no record here`);
	out.push(fit([span(notes.join(" | "), "dim")]));
	out.push(fit([span(rows.length === 0 ? ENTER_LINE_EMPTY : ENTER_LINE[rail], "key")]));
	out.push(fit([span(keysLine(size.columns), "key")]));
	return { lines: out.map(joinSpans), spans: out, cursorLine };
}

// ── colour ─────────────────────────────────────────────────────────────────────────────────────

/**
 * How each piece is emphasised when colour is allowed (#176). Only the terminal's own sixteen colours
 * and reverse video: they follow whatever theme the terminal has — light or dark, Dracula or not —
 * so nothing here assumes a background, and no theme or setting is read. Under a Dracula terminal
 * the ids are its cyan, bookmarks its pink, section titles its purple. Colour only repeats what the
 * text already says; with it off the frame reads the same.
 */
const ROLE_SGR: Record<PickerRole, string> = {
	plain: "",
	dim: "90",
	title: "1",
	rule: "90",
	header: "1;34",
	cursor: "1",
	pin: "35",
	id: "36",
	backend: "",
	fact: "",
	activity: "90",
	model: "90",
	cwd: "",
	key: "",
};

/** A fact word's colour says only which of three it is — running, not running, or not known —
 * never whether the citizen can be reopened (the leaf decides that). */
function factSgr(fact: string): string {
	const word = fact.slice(fact.lastIndexOf(" ") + 1);
	if (word === "alive" || word === "active") return "32";
	if (word === "dead" || word === "inactive" || word === "none") return "";
	return "33";
}

const sgr = (codes: string, text: string): string => (codes === "" ? text : `${ESC}[${codes}m${text}${ESC}[0m`);

/**
 * The frame's lines with colour: each piece by what it is, and the cursor's row in reverse video
 * across the whole width so it reads as one bar. Escape codes take no cells, so the lines still fit
 * exactly where the plain ones did; stripped of them, each line is the plain line.
 */
export function styleFrame(frame: { spans: PickerSpan[][]; cursorLine: number }, columns: number): string[] {
	return frame.spans.map((pieces, i) => {
		if (i === frame.cursorLine) {
			const text = joinSpans(pieces);
			return sgr("1;7", text + " ".repeat(Math.max(0, columns - displayWidth(text))));
		}
		return pieces
			.map((piece) =>
				// Blank pieces carry no code: nothing to see, and fewer bytes per frame.
				piece.text.trim() === ""
					? piece.text
					: sgr(piece.role === "fact" ? factSgr(piece.text) : ROLE_SGR[piece.role], piece.text),
			)
			.join("");
	});
}

// ── runner ─────────────────────────────────────────────────────────────────────────────────────

/** The terminal, as much of it as the picker needs. Production wires stdin/stderr/process. */
export interface PickerIo {
	setRawMode(on: boolean): void;
	/** Write to the screen. May throw; a failure reported later arrives through `onError`. */
	write(text: string): void;
	/** Start receiving input, already decoded to text; returns the function that stops it. */
	onInput(listener: (chunk: string) => void): () => void;
	/** Start receiving size changes; returns the function that stops it. */
	onResize(listener: () => void): () => void;
	/** Start receiving terminating signals; returns the function that stops it. */
	onSignal(listener: (signal: string) => void): () => void;
	/** Start receiving failures of the terminal itself — input closed or failed, the screen failed, a
	 * write reported an error after the fact; returns the function that stops it. */
	onError(listener: (err: Error) => void): () => void;
	/** Call `fn` once after `ms`; returns the function that cancels it. */
	setTimer(fn: () => void, ms: number): () => void;
	/** Call `fn` once everything written so far has left this process. */
	afterFlush(fn: () => void): void;
	/** Pass a received signal on, after the terminal was restored. */
	reraise(signal: string): void;
	size(): PickerSize;
	/** May the frame be drawn in colour? False draws it with no colour or emphasis at all (NO_COLOR):
	 * the `>` of the cursor's row, the `*` of a bookmark and the section rules carry it alone. */
	readonly color: boolean;
}

export type PickerResult = { kind: "selected"; gardenId: string } | { kind: "cancelled" };

const SCREEN_ON = `${ESC}[?1049h${ESC}[?25l`;
const SCREEN_OFF = `${ESC}[?25h${ESC}[?1049l`;
const PASTE_ON = `${ESC}[?2004h`;
const PASTE_OFF = `${ESC}[?2004l`;

/** How long a lone ESC waits to become the Esc key. Longer than a terminal takes to deliver the
 * rest of a sequence it split, short enough that Esc feels immediate. */
export const PICKER_ESC_WAIT_MS = 50;

function paint(io: PickerIo, listing: ResumeListing, state: PickerState, rail: PickerRail): void {
	const size = io.size();
	const frame = renderPickerFrame(listing, state, size, rail);
	const drawn = io.color ? styleFrame(frame, size.columns) : frame.lines;
	// Home, then each line followed by erase-to-end-of-line, then erase everything below: one write,
	// so a resize or a shorter list leaves no stale row behind.
	io.write(`${ESC}[H${drawn.join(`${ESC}[K\r\n`)}${ESC}[K${ESC}[J`);
}

/**
 * Run the list until the operator chooses or cancels. Resolves with the choice; rejects when the
 * terminal fails or a signal arrives. Whichever it is, `restore` has run exactly once before this
 * function's promise settles.
 */
export function runResumePicker(listing: ResumeListing, rail: PickerRail, io: PickerIo): Promise<PickerResult> {
	return new Promise<PickerResult>((resolve, reject) => {
		let state = INITIAL_PICKER_STATE;
		const decoder = createPickerDecoder();
		let restored = false;
		let rawOn = false;
		let screenOn = false;
		let pasteOn = false;
		let cancelEscTimer: (() => void) | null = null;
		const stops: (() => void)[] = [];

		const restore = (): void => {
			if (restored) return;
			restored = true;
			try {
				cancelEscTimer?.();
			} catch {
				// A timer that will not cancel fires into a restored picker and is ignored there.
			}
			for (const stop of stops) {
				try {
					stop();
				} catch {
					// A listener that will not detach must not keep the terminal in raw mode.
				}
			}
			// Undo only what was switched on, and attempt each step even if an earlier one throws: a
			// terminal left in raw mode or on the alternate screen is what this function exists to prevent.
			const undo = (pasteOn ? PASTE_OFF : "") + (screenOn ? SCREEN_OFF : "");
			try {
				if (undo.length > 0) io.write(undo);
			} catch {
				// The screen could not be written to; raw mode is still undone below.
			}
			try {
				if (rawOn) io.setRawMode(false);
			} catch {
				// Nothing further can be done to this terminal from here.
			}
		};
		const finish = (result: PickerResult): void => {
			restore();
			resolve(result);
		};
		const fail = (err: unknown): void => {
			restore();
			reject(err instanceof Error ? err : new Error(String(err)));
		};
		const repaint = (): void => {
			state = settlePickerState(state, visibleResumeRows(listing, state), pickerBodyHeight(io.size()));
			paint(io, listing, state, rail);
		};
		/** Apply the keys of one read. Returns false once the picker has ended. */
		const apply = (keys: readonly PickerKey[]): boolean => {
			for (const key of keysOfOneRead(keys)) {
				const step = stepPicker(state, key, listing, io.size());
				if (step.kind !== "continue") {
					finish(step);
					return false;
				}
				state = step.state;
			}
			return true;
		};

		try {
			io.setRawMode(true);
			rawOn = true;
			io.write(SCREEN_ON);
			screenOn = true;
			io.write(PASTE_ON);
			pasteOn = true;
			stops.push(
				io.onSignal((signal) => {
					if (restored) return;
					// Give the terminal back first, let that reach it, and only then let the signal do what
					// it was sent to do.
					restore();
					const interrupted = (extra = ""): Error => new Error(`interrupted by ${signal}${extra}`);
					try {
						io.afterFlush(() => {
							try {
								io.reraise(signal);
								reject(interrupted());
							} catch (err) {
								reject(interrupted(`; passing it on failed: ${err instanceof Error ? err.message : String(err)}`));
							}
						});
					} catch (err) {
						reject(interrupted(`; passing it on failed: ${err instanceof Error ? err.message : String(err)}`));
					}
				}),
			);
			stops.push(
				io.onError((err) => {
					if (!restored) fail(err);
				}),
			);
			stops.push(
				io.onResize(() => {
					if (restored) return;
					try {
						repaint();
					} catch (err) {
						fail(err);
					}
				}),
			);
			stops.push(
				io.onInput((chunk) => {
					if (restored) return;
					try {
						cancelEscTimer?.();
						cancelEscTimer = null;
						if (!apply(decoder.feed(chunk))) return;
						if (decoder.pending()) {
							cancelEscTimer = io.setTimer(() => {
								cancelEscTimer = null;
								if (restored) return;
								try {
									if (apply(decoder.flush())) paint(io, listing, state, rail);
								} catch (err) {
									fail(err);
								}
							}, PICKER_ESC_WAIT_MS);
						}
						paint(io, listing, state, rail);
					} catch (err) {
						fail(err);
					}
				}),
			);
			repaint();
		} catch (err) {
			fail(err);
		}
	});
}
