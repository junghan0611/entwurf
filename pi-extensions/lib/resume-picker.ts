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
 * ENTER IS THE ONLY KEY THAT CHOOSES. There is no confirmation line, so
 * the choice is guarded where it is made:
 *   - the screen says in words what Enter will do, and Enter is honoured only while the whole frame
 *     fits — the row under the cursor with its full garden id, and that sentence. In a terminal too
 *     small for it the list says so, Enter does nothing, and only a cancel leaves;
 *   - a MARKED paste does not choose. Bracketed paste is switched on, so a paste arrives between
 *     markers and its line breaks become spaces in the search;
 *   - an UNMARKED paste is only mitigated: an Enter that arrives in the same read as any other key
 *     is dropped. That is a same-read mitigation, not proof of intent — it cannot tell who pressed
 *     an Enter that arrives alone.
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
	renderResumeRow,
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
	| { kind: "backspace" | "clear" | "toggle-directories" | "enter" | "cancel" };

const ESC = "\x1b";
const PASTE_START = `${ESC}[200~`;
const PASTE_END = `${ESC}[201~`;

const SEQUENCES: readonly [string, PickerKey["kind"]][] = [
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

const SIMPLE_KEYS: Readonly<Record<string, PickerKey["kind"]>> = {
	"\r": "enter",
	"\n": "enter",
	"\x03": "cancel",
	"\x07": "cancel",
	"\x7f": "backspace",
	"\x08": "backspace",
	"\x15": "clear",
	"\x01": "toggle-directories",
	"\x10": "up",
	"\x0e": "down",
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
	// SS3 takes one more byte; ESC plus any other character is an Alt-chord, which is not a key here.
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
 *     lone ESC into the Esc key and drops any other unfinished sequence.
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
				const kind = SIMPLE_KEYS[ch];
				if (kind !== undefined) {
					flushText();
					keys.push({ kind } as PickerKey);
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
 * it. Dropping errs toward opening nothing — the operator presses Enter again. A same-read
 * mitigation, not proof of intent: this looks at one read only, and a line break delivered in a
 * read of its own is an Enter (see KNOWN RESIDUAL RISK in the module header).
 */
export function keysOfOneRead(keys: readonly PickerKey[]): PickerKey[] {
	return keys.length > 1 ? keys.filter((key) => key.kind !== "enter") : [...keys];
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
 * the line of keys (61 cells) — none of them cut. */
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

const KEYS_LINE = "Esc: open nothing | Up/Down, PgUp/PgDn: move | type to narrow";

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

/**
 * The whole frame as plain lines, each already cut to the terminal's width, and never more lines
 * than the terminal has. `cursorLine` is the index of the line holding the row under the cursor, or
 * -1 when no row is drawn — which is also when Enter chooses nothing. No escape codes here: how a
 * line is emphasised is the runner's business, and plain lines are what a test reads.
 */
export function renderPickerFrame(
	listing: ResumeListing,
	state: PickerState,
	size: PickerSize,
	rail: PickerRail,
): { lines: string[]; cursorLine: number } {
	if (!pickerFits(size)) return { lines: tooSmallLines(size), cursorLine: -1 };
	const rows = visibleResumeRows(listing, state);
	const total = visibleResumeRows(listing, { allDirectories: state.allDirectories, query: "" }).length;
	const items = pickerItems(rows);
	const bodyHeight = pickerBodyHeight(size);
	const fit = (line: string): string => fitToWidth(line, size.columns);

	const lines: string[] = [
		fit(`entwurf resume - ${rows.length} of ${total} shown`),
		fit(
			state.allDirectories
				? "all directories  (Ctrl-A: this directory only)"
				: `directory: ${listing.callerCwd}  (Ctrl-A: all directories)`,
		),
		fit(`search: ${state.query}`),
	];
	let cursorLine = -1;
	const body = items.slice(state.top, state.top + bodyHeight);
	for (const item of body) {
		if (item.kind === "header") {
			lines.push(fit(`-- ${item.text}`));
		} else {
			if (item.index === state.cursor) cursorLine = lines.length;
			lines.push(fit(`${item.index === state.cursor ? "> " : "  "}${renderResumeRow(item.row)}`));
		}
	}
	if (rows.length === 0) lines.push(fit("  (nothing matches)"));
	// The body always takes its full height, so the four lines below stay where they are.
	while (lines.length < HEAD_LINES + bodyHeight) lines.push("");

	// The row under the cursor again, on a line of its own: a row's directory sits at its far end
	// and is the first thing a narrow terminal cuts, and it is what tells two siblings apart.
	const selected = rows[state.cursor];
	lines.push(
		selected === undefined
			? ""
			: fit(`selected: ${selected.gardenId}  in ${selected.cwd}${selected.pin === null ? "" : `  [${selected.pin}]`}`),
	);

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
	lines.push(fit(notes.join(" | ")));
	lines.push(fit(ENTER_LINE[rail]));
	lines.push(fit(KEYS_LINE));
	return { lines, cursorLine };
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
	const { lines, cursorLine } = renderPickerFrame(listing, state, io.size(), rail);
	// Home, then each line followed by erase-to-end-of-line, then erase everything below: one write,
	// so a resize or a shorter list leaves no stale row behind.
	const drawn = lines.map((line, i) => (i === cursorLine ? `${ESC}[7m${line}${ESC}[0m` : line)).join(`${ESC}[K\r\n`);
	io.write(`${ESC}[H${drawn}${ESC}[K${ESC}[J`);
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
