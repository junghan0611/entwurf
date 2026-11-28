/**
 * resume-picker — the list an operator narrows and chooses from (#173 C3), proven beside the module.
 *
 * No tty: the terminal is a recording fake of `PickerIo`, driven with the text a terminal sends and
 * with timers the test fires by hand. Width claims are about ordinary Hangul / CJK text; grapheme
 * clusters and emoji sequences are not claimed. Each claim is its own test title, because
 * `run_vitest` attributes a mutant kill from the failed TEST TITLE:
 *
 *   RESUMEPICK-ENTER-RETURNS-CURSOR-ID  Enter returns the id under the cursor, and nothing else does
 *   RESUMEPICK-ESC-CANCELS              Esc (after its short wait) and Ctrl-C return `cancelled`
 *   RESUMEPICK-TOO-SMALL-NO-ENTER       below the minimum size Enter chooses nothing, a cancel still
 *                                       leaves, and growing back finds the same row under the cursor
 *   RESUMEPICK-FRAME-INVARIANT          at every size that fits, the cursor's row is drawn with its
 *                                       whole garden id, the Enter sentence is whole, and the frame
 *                                       stays inside the terminal
 *   RESUMEPICK-MARKED-PASTE-NO-CHOICE   a marked (bracketed) paste makes no choice: it is search
 *                                       text. An unmarked paste is only MITIGATED — an Enter sharing
 *                                       its read with other keys is dropped. Known residual risk,
 *                                       accepted by GLG 2026-11-24 and recorded by its own test
 *                                       below: an unmarked paste split across reads CAN choose
 *   RESUMEPICK-SPLIT-SEQUENCE           an escape sequence or paste marker split across reads is
 *                                       still one sequence, not an Esc and typed text
 *   RESUMEPICK-RESTORE-EVERY-EXIT       the terminal is given back exactly once on a selection, a
 *                                       cancel, a write error, a closed input and a signal — only
 *                                       what was switched on, and before the signal is passed on
 *   RESUMEPICK-UNKNOWN-SEQUENCE-INERT   an escape sequence the picker does not know is skipped whole
 *   RESUMEPICK-WIDE-CELLS               a line is cut by terminal cells, so a Korean name never
 *                                       overflows the width or is split
 *   RESUMEPICK-SCROLL-KEEPS-CURSOR      with hundreds of rows the cursor's row stays in the window
 *   RESUMEPICK-SCREEN-SAYS-ENTER        the frame states what Enter does on this rail, the filter and
 *                                       how to lift it, and shows the chosen row's directory
 *   RESUMEPICK-CTRL-ALT-JK-MOVE         Ctrl-J / Alt-J move down and Ctrl-K / Alt-K move up beside the
 *                                       arrows (#176); a line feed is Ctrl-J, never Enter, so only a
 *                                       carriage return chooses, and the keys line names what acts
 *   RESUMEPICK-ESC-OR-ALT-BY-WAIT       the short wait alone tells Esc from Alt-J/K: a letter within it
 *                                       (same read or the next) moves and never cancels; an ESC that
 *                                       nothing follows cancels and is never taken as a move
 *   RESUMEPICK-ESC-WAIT-50              that wait is 50 ms, pinned here as a literal and not read back
 *                                       from the production constant
 *   RESUMEPICK-PASTED-LF-NO-MOVE        a line feed sharing its read with typed text is a pasted line
 *                                       break and moves nothing; line feeds on their own still move
 *   RESUMEPICK-BOOKMARK-NAME-FIRST      a bookmarked row starts with `*` and its name, before the whole
 *                                       id; a cut name ends in `~` and the selected line has it whole
 *                                       where the width allows
 *   RESUMEPICK-SELECTED-LINE-FITS       a name the selected line cannot hold whole is cut there with
 *                                       `~` inside its brackets; the id stays whole and the directory
 *                                       keeps its end
 *   RESUMEPICK-PLACEMENT-SELECTED-LINE  at every width the selected line says where the row's terminal
 *                                       is, in peer-facts' word — whole, or cut with `~` — beside the
 *                                       whole id and a readable directory (#178)
 *   RESUMEPICK-SELECTED-UNOBSERVED-OMITTED  `unobserved` names no place: the selected line draws no
 *                                       ` at ` for it and keeps no cells for it
 *   RESUMEPICK-SELECTED-NAME-BEFORE-PLACEMENT  a bookmark's name keeps its five cells before the
 *                                       placement word takes any, at the minimum size too
 *   RESUMEPICK-PLACEMENT-COLUMN         a wide terminal draws the placement word as a column right after
 *                                       the activity time, `~`-capped, at one position on every row and
 *                                       filter
 *   RESUMEPICK-PLACEMENT-COLUMN-WHOLE   that column is whole or absent, never a fragment; a narrow
 *                                       terminal's rows are what they were
 *   RESUMEPICK-PLACEMENT-COLUMN-ONLY-WHEN-PLACED  a listing with no real place — only `none`,
 *                                       `ambiguous` and `unobserved` — draws no column
 *   RESUMEPICK-PLACEMENT-COLUMN-SCOPE   the column answers for the rows of the directory scope shown: a
 *                                       sibling the default view hides adds none, and typing moves none
 *   RESUMEPICK-PLACEMENT-COLUMN-BLANK-UNOBSERVED  in a drawn column an `unobserved` row's cell is blank
 *   RESUMEPICK-SECTION-RULER            a section title is a rule across the whole width, never
 *                                       shaped like a row
 *   RESUMEPICK-WHOLE-OR-NOTHING         after the facts, the activity time, placement, model and
 *                                       directory are each drawn whole or not at all (a path may keep its
 *                                       end; a placement word past its column's cap ends in `~`)
 *   RESUMEPICK-EMPTY-SAYS-NEXT          with no row to draw the screen says what is empty and which
 *                                       keys bring rows back, and Enter says and does nothing
 *   RESUMEPICK-EMPTY-MIN-KEYS           at the minimum size the one body line keeps those keys
 *   RESUMEPICK-NARROW-KEEPS-NAME        in a narrow terminal a bookmarked row keeps its whole name next
 *                                       to its whole id; facts, then backend, are drawn only where
 *                                       they fit whole; only a name past the column's cap is cut (`~`)
 *   RESUMEPICK-COLOR-BY-ROLE            with colour on, each piece is coloured by what it is — bookmark,
 *                                       id, fact state, title — the cursor's row is one reverse bar,
 *                                       and stripped of colour every other line is the plain line (the
 *                                       cursor's is the plain line padded with spaces to the width)
 *   RESUMEPICK-NO-COLOR-PLAIN           with colour off the terminal receives no colour or emphasis
 *                                       code at all; `>`, `*` and the rules still say it all
 */

import { describe, expect, it } from "vitest";
import type { PeerFact } from "./entwurf-facts.ts";
import {
	createPickerDecoder,
	displayWidth,
	fitToWidth,
	INITIAL_PICKER_STATE,
	keysOfOneRead,
	PICKER_ESC_WAIT_MS,
	PICKER_MIN_SIZE,
	type PickerIo,
	type PickerKey,
	type PickerSize,
	type PickerState,
	pickerBodyHeight,
	pickerFits,
	renderPickerFrame,
	runResumePicker,
	settlePickerState,
	stepPicker,
	styleFrame,
} from "./resume-picker.ts";
import { buildResumeListing, resumeRowText, visibleResumeRows } from "./resume-picker-rows.ts";

// The label is the contract, so it travels as expect's message.
function ok(label: string, cond: boolean): void {
	expect(cond, label).toBe(true);
}

const HERE = "/work/project";

function fact(n: number, over: Partial<PeerFact> = {}): PeerFact {
	const stamp = String(n).padStart(6, "0");
	return {
		gardenId: `20261101T${stamp}-${stamp.replace(/\d/g, (d) => "abcdef0123"[Number(d)] as string)}`,
		backend: "pi",
		nativeSessionId: `native-${n}`,
		cwd: HERE,
		model: "provider/model-a",
		createdAt: "2026-11-01T00:00:00.000Z",
		// Larger n is newer, so row order is n descending.
		recordUpdatedAt: `2026-11-01T00:00:00.${String(n).padStart(3, "0")}Z`,
		liveness: "dead",
		receiver: "n/a",
		transcript: "exists",
		placement: { kind: "unobserved" },
		...over,
	} as PeerFact;
}

const THREE = [fact(1), fact(2), fact(3)];
/** A running pi-durable, a dormant pi and a dormant Claude Code citizen: one of each fact state. */
const THREE_SHAPES = [
	fact(1, { backend: "pi-durable", model: null, liveness: "unsupported", receiver: "active" }),
	fact(2),
	fact(3, { backend: "claude-code", model: null, liveness: "unsupported", receiver: "inactive" }),
];
const LISTING = buildResumeListing(THREE, HERE, []);
const ORDER = visibleResumeRows(LISTING, INITIAL_PICKER_STATE).map((r) => r.gardenId);
const ROOMY: PickerSize = { columns: 100, rows: 20 };
/** The keys line, written out here rather than read from the module: the wide one where it fits,
 * else the compact one, which must fit the narrowest terminal the list is drawn in. */
const KEYS_FULL = "Esc: open nothing | Up/Down, Ctrl-J/K, Alt-J/K, PgUp/PgDn: move | type to narrow";
const KEYS_COMPACT = "Esc: open nothing | Up/Down, Ctrl/Alt-J/K: move | type to narrow";
const keysAt = (columns: number): string => (columns >= KEYS_FULL.length ? KEYS_FULL : KEYS_COMPACT);

interface Faults {
	/** The index of the write that throws. */
	failWriteAt?: number;
	reraiseThrows?: boolean;
}

/** A recording terminal. Nothing happens on its own: input, resize, signals, errors and timers are
 * all delivered by the test. */
function terminal(size: PickerSize = ROOMY, faults: Faults = {}, color = true) {
	const calls: string[] = [];
	const written: string[] = [];
	let input: ((chunk: string) => void) | null = null;
	let resize: (() => void) | null = null;
	let signal: ((s: string) => void) | null = null;
	let error: ((err: Error) => void) | null = null;
	let timer: (() => void) | null = null;
	let current = size;
	let writes = 0;
	const io: PickerIo = {
		setRawMode: (on) => {
			calls.push(`raw:${on}`);
		},
		onInput: (listener) => {
			input = listener;
			return () => {
				input = null;
			};
		},
		onResize: (listener) => {
			resize = listener;
			return () => {
				resize = null;
			};
		},
		onSignal: (listener) => {
			signal = listener;
			return () => {
				signal = null;
			};
		},
		onError: (listener) => {
			error = listener;
			return () => {
				error = null;
			};
		},
		setTimer: (fn, ms) => {
			calls.push(`timer:${ms}`);
			timer = fn;
			return () => {
				timer = null;
			};
		},
		afterFlush: (fn) => {
			calls.push("flushed");
			fn();
		},
		reraise: (s) => {
			calls.push(`reraise:${s}`);
			if (faults.reraiseThrows === true) throw new Error("ESRCH");
		},
		write: (text) => {
			if (writes++ === faults.failWriteAt) throw new Error("EIO: write failed");
			written.push(text);
			if (text.includes("\x1b[?1049h")) calls.push("screen:on");
			if (text.includes("\x1b[?1049l")) calls.push("screen:off");
			if (text.includes("\x1b[?2004h")) calls.push("paste:on");
			if (text.includes("\x1b[?2004l")) calls.push("paste:off");
		},
		size: () => current,
		color,
	};
	return {
		io,
		calls,
		written,
		send: (chunk: string) => input?.(chunk),
		resize: (next: PickerSize) => {
			current = next;
			resize?.();
		},
		signal: (s: string) => signal?.(s),
		error: (err: Error) => error?.(err),
		/** Let the pending Esc wait run out. Returns whether a timer was waiting. */
		fireTimer: (): boolean => {
			const fn = timer;
			timer = null;
			fn?.();
			return fn !== null;
		},
		listening: () => input !== null || resize !== null || signal !== null || error !== null || timer !== null,
		/** The last frame painted, as plain text lines. */
		screen: (): string[] => stripEscapes(written[written.length - 1] ?? "").split("\r\n"),
	};
}

/** A painted frame without its escape codes: ESC, `[`, parameter bytes, one letter. Written as a
 * scan, because a control character has no place in a regular expression. */
function stripEscapes(text: string): string {
	let out = "";
	for (let i = 0; i < text.length; i++) {
		if (text[i] === "\x1b" && text[i + 1] === "[") {
			i += 2;
			while (i < text.length && /[0-9;?]/.test(text[i] as string)) i++;
			continue;
		}
		out += text[i];
	}
	return out;
}

/** Does `text` carry a colour or emphasis code (CSI … m)? A scan for the same reason as above. */
const hasSgr = (text: string): boolean =>
	text
		.split("\x1b[")
		.slice(1)
		.some((rest) => /^[0-9;]*m/.test(rest));

const count = (calls: string[], what: string): number => calls.filter((c) => c === what).length;
/** Raw mode, the alternate screen and bracketed paste each switched on once and off once, and
 * nothing still attached. */
const restoredOnce = (t: ReturnType<typeof terminal>): boolean =>
	["raw:true", "raw:false", "screen:on", "screen:off", "paste:on", "paste:off"].every((c) => count(t.calls, c) === 1) &&
	!t.listening();
const settled = async <T>(p: Promise<T>): Promise<string> =>
	p.then(
		(v) => `resolved:${JSON.stringify(v)}`,
		(err: Error) => `rejected:${err.message}`,
	);
/** All keys one read decodes to, through a fresh decoder. */
const decodeOnce = (chunk: string): PickerKey[] => createPickerDecoder().feed(chunk);

describe("the entwurf resume picker", () => {
	it("[QK:RESUMEPICK-ENTER-RETURNS-CURSOR-ID] Enter returns the garden id under the cursor — the first row untouched, the row arrowed to, the row left after narrowing — and Enter on an empty list returns nothing at all", async () => {
		const first = terminal();
		const pFirst = runResumePicker(LISTING, "tmux", first.io);
		first.send("\r");
		const moved = terminal();
		const pMoved = runResumePicker(LISTING, "tmux", moved.io);
		moved.send("\x1b[B");
		moved.send("\x1b[B");
		moved.send("\x1b[A");
		moved.send("\r");
		const narrowed = terminal();
		const pNarrowed = runResumePicker(LISTING, "tmux", narrowed.io);
		narrowed.send(`${ORDER[2]}`);
		narrowed.send("\r");
		const empty = terminal();
		let emptySettled = false;
		const pEmpty = runResumePicker(LISTING, "tmux", empty.io).then((r) => {
			emptySettled = true;
			return r;
		});
		empty.send("no-such-row");
		empty.send("\r");
		await Promise.resolve();
		const stillOpen = !emptySettled;
		empty.send("\x03");
		ok(
			"the id is the cursor's, and an empty list has nothing to choose",
			JSON.stringify(await pFirst) === JSON.stringify({ kind: "selected", gardenId: ORDER[0] }) &&
				JSON.stringify(await pMoved) === JSON.stringify({ kind: "selected", gardenId: ORDER[1] }) &&
				JSON.stringify(await pNarrowed) === JSON.stringify({ kind: "selected", gardenId: ORDER[2] }) &&
				stillOpen &&
				(await pEmpty).kind === "cancelled",
		);
	});

	it("[QK:RESUMEPICK-ESC-CANCELS] Esc and Ctrl-C both end the list as `cancelled` with no garden id, even with the cursor resting on a row — Esc once its short wait has shown it was not the start of a sequence, Ctrl-C at once", async () => {
		const esc = terminal();
		let escSettled = false;
		const pEsc = runResumePicker(LISTING, "tmux", esc.io).then((r) => {
			escSettled = true;
			return r;
		});
		esc.send("\x1b[B");
		esc.send("\x1b");
		await Promise.resolve();
		const waited = !escSettled && esc.calls.includes(`timer:${PICKER_ESC_WAIT_MS}`);
		esc.fireTimer();
		const ctrlC = terminal();
		const pCtrlC = runResumePicker(LISTING, "tmux", ctrlC.io);
		ctrlC.send("\x03");
		ok(
			"cancelled is the whole result, and a lone Esc waits before it is one",
			waited &&
				JSON.stringify(await pEsc) === JSON.stringify({ kind: "cancelled" }) &&
				JSON.stringify(await pCtrlC) === JSON.stringify({ kind: "cancelled" }),
		);
	});

	it("[QK:RESUMEPICK-TOO-SMALL-NO-ENTER] in a terminal too small to show the row under the cursor and the sentence that says what Enter does, Enter chooses nothing: the screen says the terminal is too small, only a cancel leaves, and when the terminal grows back the same row is under the cursor and Enter chooses it", async () => {
		const tooShort: PickerSize = { columns: 100, rows: PICKER_MIN_SIZE.rows - 1 };
		const tooNarrow: PickerSize = { columns: PICKER_MIN_SIZE.columns - 1, rows: 30 };
		const t = terminal();
		let done = false;
		const p = runResumePicker(LISTING, "tmux", t.io).then((r) => {
			done = true;
			return r;
		});
		t.send("\x1b[B");
		t.resize(tooShort);
		const shortScreen = t.screen();
		t.send("\r");
		t.send("\x1b[B");
		t.send("zzz");
		await Promise.resolve();
		const enterIgnoredShort = !done;
		t.resize(tooNarrow);
		const narrowScreen = t.screen();
		t.send("\r");
		await Promise.resolve();
		const enterIgnoredNarrow = !done;
		t.resize(ROOMY);
		const back = t.screen();
		t.send("\r");
		const chosen = await p;
		const leaving = terminal(tooShort);
		const pLeaving = runResumePicker(LISTING, "tmux", leaving.io);
		leaving.send("\x03");
		ok(
			"no choice while too small, state untouched, and the same row afterwards",
			!pickerFits(tooShort) &&
				!pickerFits(tooNarrow) &&
				pickerFits(PICKER_MIN_SIZE) &&
				shortScreen[0] ===
					`terminal too small: the list needs ${PICKER_MIN_SIZE.columns}x${PICKER_MIN_SIZE.rows}, this is 100x${tooShort.rows}` &&
				shortScreen[1] === "Enter does nothing here. Esc: open nothing" &&
				shortScreen.length === 2 &&
				(narrowScreen[0] ?? "").startsWith("terminal too small: ") &&
				narrowScreen.every((line) => displayWidth(line) <= tooNarrow.columns) &&
				enterIgnoredShort &&
				enterIgnoredNarrow &&
				back.some((line) => line.startsWith(`> ${ORDER[1]}`)) &&
				back[2] === "search: " &&
				JSON.stringify(chosen) === JSON.stringify({ kind: "selected", gardenId: ORDER[1] }) &&
				(await pLeaving).kind === "cancelled",
		);
	});

	it("[QK:RESUMEPICK-FRAME-INVARIANT] at every terminal size that fits, wherever the cursor is, the frame stays inside the terminal, the row under the cursor is drawn with its whole garden id, the line below the list names that same id and its directory, and the sentence that says what Enter does is whole", () => {
		const many = buildResumeListing(
			[...Array.from({ length: 120 }, (_, i) => fact(i + 1)), fact(500, { cwd: "/work/far/away/project" })],
			HERE,
			[
				{ gardenId: fact(500).gardenId, name: "먼곳의형제" },
				{ gardenId: fact(7).gardenId, name: "가까운형제" },
			],
		);
		const rows = visibleResumeRows(many, INITIAL_PICKER_STATE);
		const broken: string[] = [];
		for (const columns of [PICKER_MIN_SIZE.columns, PICKER_MIN_SIZE.columns + 1, 79, 80, 81, 120, 200]) {
			for (const height of [PICKER_MIN_SIZE.rows, 9, 10, 24, 50, 200]) {
				const size: PickerSize = { columns, rows: height };
				for (const cursor of [0, 1, 2, 3, 60, rows.length - 2, rows.length - 1]) {
					const state = settlePickerState({ ...INITIAL_PICKER_STATE, cursor }, rows, pickerBodyHeight(size));
					const frame = renderPickerFrame(many, state, size, "tmux");
					const id = rows[state.cursor]?.gardenId ?? "\u0000";
					const cwd = rows[state.cursor]?.cwd ?? "\u0000";
					// The directory whole, or its end after "..." when the line is too short for it.
					const where = (frame.lines[height - 4] ?? "").split("  in ")[1] ?? "";
					const namesDirectory =
						where === cwd || (where.startsWith("...") && where.length > 3 && cwd.endsWith(where.slice(3)));
					const good =
						frame.lines.length === height &&
						frame.lines.every((line) => displayWidth(line) <= columns) &&
						frame.cursorLine >= 3 &&
						frame.cursorLine < height - 4 &&
						(frame.lines[frame.cursorLine] ?? "").startsWith("> ") &&
						(frame.lines[frame.cursorLine] ?? "").includes(id) &&
						(frame.lines[height - 4] ?? "").startsWith(`selected: ${id}  `) &&
						namesDirectory &&
						frame.lines[height - 2] === "Enter: reopen in a new tmux window beside this one" &&
						frame.lines[height - 1] === keysAt(columns);
					if (!good) broken.push(`${columns}x${height} cursor ${cursor}`);
				}
			}
		}
		ok(`no size or cursor position breaks the frame (broken: ${broken.slice(0, 5).join("; ")})`, broken.length === 0);
	});

	it("[QK:RESUMEPICK-MARKED-PASTE-NO-CHOICE] a marked paste makes no choice: bracketed paste is switched on and off with the screen and text between its markers is search text whose line breaks are spaces. An unmarked paste is only mitigated — an Enter that shares its read with any other key is dropped — and an Enter arriving alone still chooses", async () => {
		const marked = terminal();
		let markedDone = false;
		const pMarked = runResumePicker(LISTING, "tmux", marked.io).then((r) => {
			markedDone = true;
			return r;
		});
		marked.send("\x1b[200~model-a\r\nprovider\n\x1b[201~");
		await Promise.resolve();
		const markedOpen = !markedDone;
		const markedSearch = marked.screen()[2];
		marked.send("\x03");
		const unmarked = terminal();
		let unmarkedDone = false;
		const pUnmarked = runResumePicker(LISTING, "tmux", unmarked.io).then((r) => {
			unmarkedDone = true;
			return r;
		});
		unmarked.send("pro\rvider\r");
		unmarked.send("\x1b[B\r");
		await Promise.resolve();
		const unmarkedOpen = !unmarkedDone;
		const unmarkedSearch = unmarked.screen()[2];
		unmarked.send("\r");
		ok(
			"no choice from a paste, the text kept as a search, and a lone Enter still chooses",
			markedOpen &&
				markedSearch === "search: model-a  provider " &&
				(await pMarked).kind === "cancelled" &&
				unmarkedOpen &&
				unmarkedSearch === "search: provider" &&
				JSON.stringify(await pUnmarked) === JSON.stringify({ kind: "selected", gardenId: ORDER[1] }) &&
				JSON.stringify(decodeOnce("\x1b[200~a\rb\x1b[201~\r")) ===
					JSON.stringify([{ kind: "text", text: "a b" }, { kind: "enter" }]) &&
				JSON.stringify(keysOfOneRead(decodeOnce("\x1b[200~a\rb\x1b[201~\r"))) ===
					JSON.stringify([{ kind: "text", text: "a b" }]) &&
				JSON.stringify(keysOfOneRead([{ kind: "enter" }])) === JSON.stringify([{ kind: "enter" }]) &&
				count(marked.calls, "paste:on") === 1 &&
				count(marked.calls, "paste:off") === 1,
		);
	});

	it("KNOWN RESIDUAL RISK, recorded as it behaves (accepted by GLG, 2026-11-24): where a terminal ignores bracketed paste and delivers a pasted text and its trailing line break in two reads, the second read is an Enter on its own and chooses the row the text narrowed to — nothing in the picker can tell it from a typed Enter", async () => {
		const t = terminal();
		const p = runResumePicker(LISTING, "tmux", t.io);
		t.send(`${ORDER[2]}`);
		t.send("\r");
		ok(
			"this is a choice today; if it stops being one, the header's risk note is out of date",
			JSON.stringify(await p) === JSON.stringify({ kind: "selected", gardenId: ORDER[2] }),
		);
	});

	it("[QK:RESUMEPICK-SPLIT-SEQUENCE] an escape sequence or a paste marker that a terminal delivers in pieces is still one sequence: an arrow split after ESC moves the cursor instead of cancelling, a split paste marker still opens and closes a paste, and only an ESC with nothing after it in time is the Esc key", () => {
		const arrow = createPickerDecoder();
		const a1 = arrow.feed("\x1b");
		const arrowPending = arrow.pending();
		const a2 = arrow.feed("[B");
		const csi = createPickerDecoder();
		const c1 = csi.feed("x\x1b[");
		const c2 = csi.feed("1");
		const c3 = csi.feed("5~y");
		const paste = createPickerDecoder();
		const p1 = paste.feed("\x1b[20");
		const p2 = paste.feed("0~one\r");
		const pasteNotPending = !paste.pending();
		const p3 = paste.feed("two\x1b[2");
		const p4 = paste.feed("01~");
		const p5 = paste.feed("\r");
		const lone = createPickerDecoder();
		const l1 = lone.feed("\x1b");
		const l2 = lone.flush();
		const dropped = createPickerDecoder();
		dropped.feed("\x1b[1");
		const d2 = dropped.flush();
		const d3 = dropped.feed("\r");
		ok(
			"joined across reads; a lone ESC is Esc only after the wait; an unfinished sequence is dropped by it",
			a1.length === 0 &&
				arrowPending &&
				JSON.stringify(a2) === JSON.stringify([{ kind: "down" }]) &&
				JSON.stringify(c1) === JSON.stringify([{ kind: "text", text: "x" }]) &&
				c2.length === 0 &&
				JSON.stringify(c3) === JSON.stringify([{ kind: "text", text: "y" }]) &&
				p1.length === 0 &&
				JSON.stringify(p2) === JSON.stringify([{ kind: "text", text: "one " }]) &&
				pasteNotPending &&
				JSON.stringify(p3) === JSON.stringify([{ kind: "text", text: "two" }]) &&
				p4.length === 0 &&
				JSON.stringify(p5) === JSON.stringify([{ kind: "enter" }]) &&
				l1.length === 0 &&
				JSON.stringify(l2) === JSON.stringify([{ kind: "cancel" }]) &&
				d2.length === 0 &&
				JSON.stringify(d3) === JSON.stringify([{ kind: "enter" }]),
		);
	});

	it("[QK:RESUMEPICK-RESTORE-EVERY-EXIT] the terminal is given back exactly once on every way out — a selection, a cancel, a write that fails mid-session, the input closing, and a terminating signal — undoing only what was switched on; a signal is passed on only after the restore was written, and a failure to pass it on is reported rather than lost", async () => {
		const selected = terminal();
		const pSelected = runResumePicker(LISTING, "tmux", selected.io);
		selected.send("\r");
		await pSelected;
		const cancelled = terminal();
		const pCancelled = runResumePicker(LISTING, "tmux", cancelled.io);
		cancelled.send("\x03");
		await pCancelled;
		// Writes: 0 screen on, 1 paste on, 2 first paint, 3 the repaint after a key — which fails.
		const broken = terminal(ROOMY, { failWriteAt: 3 });
		const pBroken = settled(runResumePicker(LISTING, "tmux", broken.io));
		broken.send("x");
		const closed = terminal();
		const pClosed = settled(runResumePicker(LISTING, "tmux", closed.io));
		closed.error(new Error("the terminal's input closed (end of input on stdin)"));
		const signalled = terminal();
		const pSignalled = settled(runResumePicker(LISTING, "tmux", signalled.io));
		signalled.signal("SIGINT");
		const lost = terminal(ROOMY, { reraiseThrows: true });
		const pLost = settled(runResumePicker(LISTING, "tmux", lost.io));
		lost.signal("SIGTERM");
		// The screen could not even be entered: raw mode was on, the screen and paste never were.
		const stillborn = terminal(ROOMY, { failWriteAt: 0 });
		const pStillborn = settled(runResumePicker(LISTING, "tmux", stillborn.io));
		const order = (t: ReturnType<typeof terminal>, a: string, b: string): boolean =>
			t.calls.indexOf(a) >= 0 && t.calls.indexOf(a) < t.calls.indexOf(b);
		ok(
			"one restore per exit, errors and signals surface as rejections, and restore is flushed before the re-raise",
			restoredOnce(selected) &&
				restoredOnce(cancelled) &&
				restoredOnce(broken) &&
				(await pBroken) === "rejected:EIO: write failed" &&
				restoredOnce(closed) &&
				(await pClosed) === "rejected:the terminal's input closed (end of input on stdin)" &&
				restoredOnce(signalled) &&
				(await pSignalled) === "rejected:interrupted by SIGINT" &&
				order(signalled, "raw:false", "flushed") &&
				order(signalled, "screen:off", "flushed") &&
				order(signalled, "flushed", "reraise:SIGINT") &&
				restoredOnce(lost) &&
				(await pLost) === "rejected:interrupted by SIGTERM; passing it on failed: ESRCH" &&
				(await pStillborn) === "rejected:EIO: write failed" &&
				count(stillborn.calls, "raw:true") === 1 &&
				count(stillborn.calls, "raw:false") === 1 &&
				count(stillborn.calls, "screen:off") === 0 &&
				count(stillborn.calls, "paste:off") === 0 &&
				!stillborn.listening(),
		);
	});

	it("[QK:RESUMEPICK-UNKNOWN-SEQUENCE-INERT] an escape sequence this picker does not know — a function key, a mouse report, an Alt chord — is skipped whole: it does not cancel the list and none of its bytes are typed into the search", () => {
		ok(
			"nothing from an unknown sequence, and known keys around text keep their order",
			decodeOnce("\x1b[15~").length === 0 &&
				decodeOnce("\x1b[<0;10;5M").length === 0 &&
				decodeOnce("\x1bOP").length === 0 &&
				decodeOnce("\x1bx").length === 0 &&
				JSON.stringify(decodeOnce("a\x1b[15~b")) ===
					JSON.stringify([
						{ kind: "text", text: "a" },
						{ kind: "text", text: "b" },
					]) &&
				JSON.stringify(decodeOnce("a\x1b[Bb\x7f")) ===
					JSON.stringify([
						{ kind: "text", text: "a" },
						{ kind: "down" },
						{ kind: "text", text: "b" },
						{ kind: "backspace" },
					]),
		);
	});

	it("[QK:RESUMEPICK-WIDE-CELLS] width is counted in terminal cells for Hangul and CJK text: a Korean bookmark name takes two cells a character, a line is cut so it never exceeds the terminal's columns with a wide character at the edge dropped rather than split, and an 80-column frame of a pinned sibling from another directory is exactly the lines written here", () => {
		const far = fact(1, {
			cwd: "/home/operator/repos/other-project",
			backend: "claude-code",
			model: null,
			liveness: "unsupported",
			receiver: "inactive",
		});
		const pinned = buildResumeListing([far, fact(2)], HERE, [{ gardenId: far.gardenId, name: "운영코디-실무담당" }]);
		const frame = renderPickerFrame(pinned, INITIAL_PICKER_STATE, { columns: 80, rows: 10 }, "tmux").lines;
		const typed = stepPicker(INITIAL_PICKER_STATE, { kind: "text", text: "운영" }, pinned, ROOMY);
		const erased = typed.kind === "continue" ? stepPicker(typed.state, { kind: "backspace" }, pinned, ROOMY) : typed;
		ok(
			"cells, not code units, and the literal frame",
			displayWidth("운영코디") === 8 &&
				displayWidth("abc") === 3 &&
				displayWidth("a운b") === 4 &&
				fitToWidth("운영코디", 5) === "운영" &&
				fitToWidth("a운영", 4) === "a운" &&
				fitToWidth("ab\x1b[2Jcd", 10) === "ab[2Jcd" &&
				JSON.stringify(frame) ===
					JSON.stringify([
						"entwurf resume - 2 of 2 shown",
						"directory: /work/project  (Ctrl-A: all directories)",
						"search: ",
						`== Bookmarked, other directories ${"=".repeat(47)}`,
						"> * 운영코디-실무담당  20261101T000001-aaaaab  claude-code  receiver inactive",
						`== This directory ${"=".repeat(62)}`,
						"selected: 20261101T000001-aaaaab  [운영코디-실무담당]  in ...repos/other-project",
						"",
						"Enter: reopen in a new tmux window beside this one",
						KEYS_FULL,
					]) &&
				typed.kind === "continue" &&
				visibleResumeRows(pinned, typed.state).length === 1 &&
				erased.kind === "continue" &&
				erased.state.query === "운",
		);
	});

	it("[QK:RESUMEPICK-SCROLL-KEEPS-CURSOR] with hundreds of rows the row under the cursor is always inside the drawn window — after paging down, jumping to the end, coming back up, and after the terminal shrinks", () => {
		const many = buildResumeListing(
			Array.from({ length: 660 }, (_, i) => fact(i + 1)),
			HERE,
			[],
		);
		const rows = visibleResumeRows(many, INITIAL_PICKER_STATE);
		const big: PickerSize = { columns: 120, rows: 30 };
		const small: PickerSize = { columns: 120, rows: 9 };
		const inWindow = (state: PickerState, size: PickerSize): boolean => {
			const frame = renderPickerFrame(many, state, size, "tmux");
			const cursorRow = rows[state.cursor];
			return (
				frame.cursorLine >= 0 &&
				frame.lines.length <= size.rows &&
				cursorRow !== undefined &&
				(frame.lines[frame.cursorLine] ?? "").includes(cursorRow.gardenId)
			);
		};
		let state = settlePickerState(INITIAL_PICKER_STATE, rows, pickerBodyHeight(big));
		const seen: boolean[] = [inWindow(state, big)];
		const press = (kind: "page-down" | "end" | "up" | "home" | "down", size: PickerSize): void => {
			const step = stepPicker(state, { kind }, many, size);
			if (step.kind === "continue") state = step.state;
			seen.push(inWindow(state, size));
		};
		press("page-down", big);
		press("page-down", big);
		const afterTwoPages = state.cursor;
		press("end", big);
		const atEnd = state.cursor;
		press("down", big);
		const pastEnd = state.cursor;
		press("up", big);
		// The terminal shrinks under a cursor near the end: the same state must settle into view.
		state = settlePickerState(state, rows, pickerBodyHeight(small));
		const keptCursor = state.cursor;
		seen.push(inWindow(state, small));
		press("home", small);
		ok(
			"always in view, never past the ends, the page is the body height, and a resize keeps the row",
			seen.every((v) => v) &&
				afterTwoPages === 2 * pickerBodyHeight(big) &&
				atEnd === 659 &&
				pastEnd === 659 &&
				keptCursor === 658 &&
				state.cursor === 0 &&
				state.top === 0,
		);
	});

	it("[QK:RESUMEPICK-SCREEN-SAYS-ENTER] the frame says in words what Enter will do on this rail — there is no confirmation line — and shows the directory filter with the key that lifts it, the sections, the chosen row's directory, and what is not listed", () => {
		const listing = buildResumeListing(
			[
				fact(1),
				fact(2, { cwd: "/work/other" }),
				fact(3, { backend: "codex", liveness: "unsupported" }),
				fact(4, { cwd: "/work/other", backend: "codex", liveness: "unsupported" }),
			],
			HERE,
			[
				{ gardenId: fact(2).gardenId, name: "Far" },
				{ gardenId: "20260101T000000-000000", name: "Gone" },
			],
		);
		const size: PickerSize = { columns: 140, rows: 20 };
		const tmux = renderPickerFrame(listing, INITIAL_PICKER_STATE, size, "tmux").lines;
		const herdr = renderPickerFrame(listing, INITIAL_PICKER_STATE, size, "herdr").lines;
		const all = renderPickerFrame(listing, { ...INITIAL_PICKER_STATE, allDirectories: true }, size, "tmux").lines;
		const at = (lines: string[], fromEnd: number): string => lines[lines.length - fromEnd] ?? "";
		ok(
			"the action, the filter, the sections, the chosen directory and the uncounted are all on screen",
			at(tmux, 2) === "Enter: reopen in a new tmux window beside this one" &&
				at(herdr, 2) === "Enter: reopen in a new herdr tab" &&
				at(tmux, 1) === KEYS_FULL &&
				tmux[1] === `directory: ${HERE}  (Ctrl-A: all directories)` &&
				all[1] === "all directories  (Ctrl-A: this directory only)" &&
				tmux.some((l) => l.startsWith("== Bookmarked, other directories ==")) &&
				tmux.some((l) => l.startsWith("== This directory ==")) &&
				tmux.includes(
					`> * Far  ${fact(2).gardenId}  pi  socket dead  2026-11-01T00:00Z  provider/model-a  /work/other`,
				) &&
				at(tmux, 4) === `selected: ${fact(2).gardenId}  [Far]  in /work/other` &&
				at(tmux, 3) === "1 citizen of other backends is not listed (codex 1) | 1 bookmark has no record here" &&
				at(all, 3) === "2 citizens of other backends are not listed (codex 2) | 1 bookmark has no record here" &&
				tmux[0] === "entwurf resume - 2 of 2 shown",
		);
	});
	it("[QK:RESUMEPICK-CTRL-ALT-JK-MOVE] Ctrl-J and Alt-J move down, Ctrl-K and Alt-K move up, beside the arrows and Ctrl-N / Ctrl-P (#176); a line feed is Ctrl-J and never chooses, so only a carriage return is Enter; and every key the keys line names acts as named", async () => {
		const moveTo = async (keys: string[]): Promise<unknown> => {
			const t = terminal();
			const p = runResumePicker(LISTING, "tmux", t.io);
			for (const key of keys) t.send(key);
			t.send("\r");
			return p;
		};
		const lf = terminal();
		let lfDone = false;
		const pLf = runResumePicker(LISTING, "tmux", lf.io).then((r) => {
			lfDone = true;
			return r;
		});
		lf.send("\n");
		lf.send("\n");
		lf.send("\n");
		await Promise.resolve();
		const lfOpen = !lfDone;
		const lfCursorRow = lf.screen().find((line) => line.startsWith("> ")) ?? "";
		lf.send("\r");
		const at = (n: number): string => JSON.stringify({ kind: "selected", gardenId: ORDER[n] });
		ok(
			"each named key moves the way it says, a line feed moves and opens nothing, and CR chooses",
			JSON.stringify(decodeOnce("\n")) === JSON.stringify([{ kind: "down", lineFeed: true }]) &&
				JSON.stringify(decodeOnce("\x0b")) === JSON.stringify([{ kind: "up" }]) &&
				JSON.stringify(decodeOnce("\x1bj")) === JSON.stringify([{ kind: "down" }]) &&
				JSON.stringify(decodeOnce("\x1bk")) === JSON.stringify([{ kind: "up" }]) &&
				JSON.stringify(decodeOnce("\r")) === JSON.stringify([{ kind: "enter" }]) &&
				JSON.stringify(await moveTo(["\n"])) === at(1) &&
				JSON.stringify(await moveTo(["\x1bj", "\x1bj"])) === at(2) &&
				JSON.stringify(await moveTo(["\n", "\n", "\x0b"])) === at(1) &&
				JSON.stringify(await moveTo(["\x1bj", "\x1bj", "\x1bk"])) === at(1) &&
				JSON.stringify(await moveTo(["\x1b[B", "\x0e", "\x10"])) === at(1) &&
				JSON.stringify(await moveTo(["\x1b[6~", "\x1b[5~"])) === at(0) &&
				lfOpen &&
				lfCursorRow.includes(ORDER[2] as string) &&
				JSON.stringify(await pLf) === at(2),
		);
	});

	it("[QK:RESUMEPICK-ESC-OR-ALT-BY-WAIT] the short wait alone tells Esc from Alt-J/K: an ESC whose letter arrives within the wait — in the same read or in the next one — moves and never cancels, an ESC that nothing follows within the wait cancels and is never taken as a move, and a letter after that cancel finds no list", async () => {
		const split = terminal();
		let splitDone = false;
		const pSplit = runResumePicker(LISTING, "tmux", split.io).then((r) => {
			splitDone = true;
			return r;
		});
		split.send("\x1b");
		const waitArmed = split.calls.includes(`timer:${PICKER_ESC_WAIT_MS}`);
		split.send("j");
		await Promise.resolve();
		const notCancelled = !splitDone;
		const noWaitLeft = !split.fireTimer();
		const splitSearch = split.screen()[2];
		split.send("\r");
		const lone = terminal();
		const pLone = runResumePicker(LISTING, "tmux", lone.io);
		lone.send("\x1b[B");
		lone.send("\x1b");
		lone.fireTimer();
		const loneResult = await pLone;
		const writesAfterCancel = lone.written.length;
		lone.send("j");
		lone.send("\r");
		ok(
			"a letter inside the wait binds to the ESC; an ESC alone is Esc; nothing acts after it",
			waitArmed &&
				notCancelled &&
				noWaitLeft &&
				splitSearch === "search: " &&
				JSON.stringify(await pSplit) === JSON.stringify({ kind: "selected", gardenId: ORDER[1] }) &&
				JSON.stringify(loneResult) === JSON.stringify({ kind: "cancelled" }) &&
				lone.written.length === writesAfterCancel &&
				!lone.listening(),
		);
	});

	it("[QK:RESUMEPICK-ESC-WAIT-50] the wait that tells Esc from Alt-J/K is 50 ms, pinned here as a literal rather than read back from the production constant: a longer wait delays every Esc, a shorter one splits an Alt-J a terminal sent in two reads", () => {
		const t = terminal();
		void runResumePicker(LISTING, "tmux", t.io);
		t.send("\x1b");
		const armed = t.calls.filter((call) => call.startsWith("timer:"));
		t.fireTimer();
		ok("one wait of exactly 50 ms is armed for a lone ESC", JSON.stringify(armed) === JSON.stringify(["timer:50"]));
	});

	it("[QK:RESUMEPICK-PASTED-LF-NO-MOVE] a line feed that shares its read with typed text is a pasted line break from a terminal that did not mark the paste: it moves nothing and chooses nothing, while line feeds with no text beside them — Ctrl-J held down — still move", async () => {
		const t = terminal();
		let done = false;
		const p = runResumePicker(LISTING, "tmux", t.io).then((r) => {
			done = true;
			return r;
		});
		t.send("pro\nvider\n");
		await Promise.resolve();
		const open = !done;
		const search = t.screen()[2];
		const cursorRow = t.screen().find((line) => line.startsWith("> ")) ?? "";
		t.send("\r");
		ok(
			"pasted line breaks are dropped beside text, and Ctrl-J alone in a read still moves",
			JSON.stringify(keysOfOneRead(decodeOnce("ab\ncd\n"))) ===
				JSON.stringify([
					{ kind: "text", text: "ab" },
					{ kind: "text", text: "cd" },
				]) &&
				JSON.stringify(keysOfOneRead(decodeOnce("\n\n"))) ===
					JSON.stringify([
						{ kind: "down", lineFeed: true },
						{ kind: "down", lineFeed: true },
					]) &&
				JSON.stringify(keysOfOneRead(decodeOnce("x\x1b[B"))) ===
					JSON.stringify([{ kind: "text", text: "x" }, { kind: "down" }]) &&
				open &&
				search === "search: provider" &&
				cursorRow.includes(ORDER[0] as string) &&
				JSON.stringify(await p) === JSON.stringify({ kind: "selected", gardenId: ORDER[0] }),
		);
	});
	/** Rows shaped like the operator's own list on 2026-11-26 07:59 (#176 comment 7177191854): Korean
	 * and ASCII bookmark names, three backends, the facts words it showed, and a model long enough
	 * to be cut. */
	const SCREEN_LIKE = buildResumeListing(
		[
			fact(1, { backend: "pi-durable", model: null, liveness: "unsupported", receiver: "active" }),
			fact(2, { backend: "claude-code", model: null, liveness: "unsupported", receiver: "inactive" }),
			fact(3, { model: "openai-codex/gpt-6-terra" }),
			fact(4, {
				backend: "pi-durable",
				model: null,
				liveness: "unsupported",
				receiver: "active",
				cwd: "/home/operator/repos/nixos-config",
			}),
			fact(5, { backend: "claude-code", model: null, liveness: "unsupported", receiver: "none" }),
			fact(6, { model: "openai-codex/gpt-6-terra" }),
			fact(7, { cwd: "/home/operator/repos/elsewhere-project", model: "provider/model-b" }),
		],
		HERE,
		[
			{ gardenId: fact(1).gardenId, name: "운영코디" },
			{ gardenId: fact(2).gardenId, name: "ACP 담당-ff0" },
			{ gardenId: fact(3).gardenId, name: "실무코디-TERRA" },
			{ gardenId: fact(4).gardenId, name: "NIXOS-CODI" },
		],
	);
	const WIDTHS = Array.from({ length: 140 - PICKER_MIN_SIZE.columns + 1 }, (_, i) => PICKER_MIN_SIZE.columns + i);
	const allRows = (cursor = 0): PickerState => ({ ...INITIAL_PICKER_STATE, allDirectories: true, cursor });

	it("[QK:RESUMEPICK-BOOKMARK-NAME-FIRST] a bookmarked row starts with `*` and its name, before its whole garden id, backend and facts; an unbookmarked row has no mark; a name too long for its column ends in `~` and the selected line carries it whole where the width allows, at the minimum size too for a name that fits; and where no name fits the row keeps its `*`", () => {
		const at = (columns: number, cursor = 0): string[] =>
			renderPickerFrame(SCREEN_LIKE, allRows(cursor), { columns, rows: 20 }, "tmux").lines;
		const wide = at(120);
		const screenWidth = at(92, 2);
		const narrow = at(64);
		const pinnedRow = (lines: string[], n: number): string => lines.find((l) => l.includes(fact(n).gardenId)) ?? "";
		ok(
			"name first and readable without colour, the id whole, the cut marked, the selected line whole",
			pinnedRow(wide, 1).startsWith(`> * 운영코디        ${fact(1).gardenId}  pi-durable   receiver active`) &&
				pinnedRow(wide, 2).startsWith(`  * ACP 담당-ff0    ${fact(2).gardenId}  claude-code`) &&
				pinnedRow(wide, 3).startsWith(`  * 실무코디-TERRA  ${fact(3).gardenId}  pi `) &&
				pinnedRow(wide, 5).startsWith(`  ${fact(5).gardenId}  claude-code  receiver none`) &&
				pinnedRow(at(90), 3).startsWith(`  * 실무코디-TERRA  ${fact(3).gardenId}`) &&
				pinnedRow(at(72), 3).startsWith(`  * 실무코디-TERRA  ${fact(3).gardenId}`) &&
				screenWidth.includes(`selected: ${fact(3).gardenId}  [실무코디-TERRA]  in ${HERE}`) &&
				pinnedRow(narrow, 1).startsWith(`> * 운영코디        ${fact(1).gardenId}  receiver active`) &&
				narrow.some((l) => l.startsWith(`selected: ${fact(1).gardenId}  [운영코디]  in `)) &&
				WIDTHS.every((columns) =>
					visibleResumeRows(SCREEN_LIKE, allRows()).every((row) => {
						const line = pinnedRow(at(columns), Number(row.gardenId.slice(9, 15)));
						return row.pin === null
							? line.includes(`${row.gardenId}  ${row.backend}`) && line.includes(row.facts)
							: new RegExp(`^[> ] \\* ${row.pin} +${row.gardenId}`).test(line);
					}),
				),
		);
	});

	it("[QK:RESUMEPICK-SELECTED-LINE-FITS] a bookmark name the selected line cannot hold whole beside the id and a readable directory is cut there with `~` inside its brackets; the garden id is always whole, the closing bracket stays, and the directory keeps its end after `...` — at the minimum size too; a wide terminal carries the same name whole", () => {
		const long = "한".repeat(20);
		const listing = buildResumeListing([fact(1), fact(2, { cwd: "/home/operator/repos/elsewhere-project" })], HERE, [
			{ gardenId: fact(1).gardenId, name: long },
			{ gardenId: fact(2).gardenId, name: long },
		]);
		const selectedAt = (size: PickerSize, cursor: number): string =>
			renderPickerFrame(listing, { ...INITIAL_PICKER_STATE, allDirectories: true, cursor }, size, "tmux").lines.find(
				(l) => l.startsWith("selected: "),
			) ?? "";
		const here = selectedAt(PICKER_MIN_SIZE, 0);
		const elsewhere = selectedAt(PICKER_MIN_SIZE, 1);
		const cut = selectedAt({ columns: 80, rows: 10 }, 0);
		const wide = selectedAt({ columns: 140, rows: 10 }, 1);
		const minRow =
			renderPickerFrame(
				listing,
				{ ...INITIAL_PICKER_STATE, allDirectories: true },
				{ columns: PICKER_MIN_SIZE.columns, rows: 12 },
				"tmux",
			).lines.find((l) => l.includes(fact(1).gardenId) && !l.startsWith("selected: ")) ?? "";
		ok(
			"the id whole, the name cut and marked inside its brackets, the directory's end kept, all in the width",
			here === `selected: ${fact(1).gardenId}  [${"한".repeat(7)}~]  in ...oject` &&
				elsewhere === `selected: ${fact(2).gardenId}  [${"한".repeat(7)}~]  in ...oject` &&
				minRow.startsWith(`> * ${"한".repeat(11)}~`) &&
				cut === `selected: ${fact(1).gardenId}  [${"한".repeat(15)}~]  in ...oject` &&
				displayWidth(here) <= PICKER_MIN_SIZE.columns &&
				displayWidth(elsewhere) <= PICKER_MIN_SIZE.columns &&
				displayWidth(cut) <= 80 &&
				wide === `selected: ${fact(2).gardenId}  [${long}]  in /home/operator/repos/elsewhere-project`,
		);
	});

	it("[QK:RESUMEPICK-NARROW-KEEPS-NAME] in a narrow terminal a bookmarked row keeps its whole Korean name beside its whole garden id; its facts and then its backend are drawn only where they still fit whole, so they give way before the name is ever cut; only a name longer than the column's cap is cut, and then with `~`; an unbookmarked row still keeps its backend and facts", () => {
		const at = (columns: number): string[] =>
			renderPickerFrame(SCREEN_LIKE, allRows(), { columns, rows: 20 }, "tmux").lines;
		const row = (lines: string[], n: number): string => lines.find((l) => l.includes(fact(n).gardenId)) ?? "";
		const long = buildResumeListing([fact(1)], HERE, [
			{ gardenId: fact(1).gardenId, name: "아주아주긴이름의북마크형제입니다" },
		]);
		const longRow = renderPickerFrame(long, INITIAL_PICKER_STATE, { columns: 64, rows: 10 }, "tmux").lines[4] ?? "";
		ok(
			"the name outranks the backend and the facts; the id is never cut; the cap alone cuts a name",
			row(at(64), 3) === `  * 실무코디-TERRA  ${fact(3).gardenId}  socket dead` &&
				row(at(64), 2) === `  * ACP 담당-ff0    ${fact(2).gardenId}  receiver inactive` &&
				row(at(72), 3) === `  * 실무코디-TERRA  ${fact(3).gardenId}  socket dead` &&
				row(at(80), 3) === `  * 실무코디-TERRA  ${fact(3).gardenId}  pi           socket dead` &&
				row(at(64), 5) === `  ${fact(5).gardenId}  claude-code  receiver none` &&
				longRow === `> * 아주아주긴이름의북마크~   ${fact(1).gardenId}  pi`,
		);
	});

	it("[QK:RESUMEPICK-SECTION-RULER] a section title is a rule across the whole width of the terminal — `== title ===…` — so it is never read as a row: no title line starts the way a row does, and no row line starts the way a title does", () => {
		const broken: string[] = [];
		for (const columns of [PICKER_MIN_SIZE.columns, 80, 92, 140]) {
			const frame = renderPickerFrame(SCREEN_LIKE, allRows(), { columns, rows: 20 }, "tmux");
			const body = frame.lines.slice(3, frame.lines.length - 4).filter((l) => l.length > 0);
			const titles = body.filter((l) => l.startsWith("== "));
			const rows = body.filter((l) => !l.startsWith("== "));
			const good =
				titles.length === 4 &&
				titles.every((l) => l.length === columns && /^== [A-Z][a-z, ]+ =+$/.test(l)) &&
				rows.every((l) => l.startsWith("> ") || l.startsWith("  ")) &&
				titles.map((l) => l.replace(/^== | =+$/g, "")).join("|") ===
					"Bookmarked, this directory|Bookmarked, other directories|This directory|Other directories";
			if (!good) broken.push(`${columns}`);
		}
		ok(`every title is a full-width rule (broken at: ${broken.join(", ")})`, broken.length === 0);
	});

	it("[QK:RESUMEPICK-WHOLE-OR-NOTHING] after a row's facts, its activity time, placement, model and directory are each drawn whole or not at all — never the `2026-11-` or one-letter fragment the 07:59 screen showed; a directory too long for what is left keeps its end after `...`", () => {
		const broken: string[] = [];
		for (const columns of WIDTHS) {
			const frame = renderPickerFrame(SCREEN_LIKE, allRows(), { columns, rows: 20 }, "tmux");
			for (const row of visibleResumeRows(SCREEN_LIKE, allRows())) {
				const text = resumeRowText(row);
				const line = frame.lines.find((l) => l.includes(row.gardenId)) ?? "";
				const facts = text.facts.join(", ");
				const tail = line.slice(line.indexOf(facts) + facts.length).trim();
				const pieces = tail.length === 0 ? [] : tail.split(/ {2,}/);
				const whole = pieces.every(
					(piece) =>
						piece === text.activity ||
						piece === text.placement ||
						piece === text.model ||
						piece === text.cwd ||
						(text.cwd !== null && piece.startsWith("...") && piece.length > 3 && text.cwd.endsWith(piece.slice(3))),
				);
				if (!whole || displayWidth(line) > columns) broken.push(`${columns}: ${line}`);
			}
		}
		const at140 = renderPickerFrame(SCREEN_LIKE, allRows(), { columns: 140, rows: 20 }, "tmux").lines;
		ok(
			`no fragment at any width (first broken: ${broken.slice(0, 2).join(" / ")})`,
			broken.length === 0 &&
				at140.some((l) =>
					l.endsWith(`socket dead        2026-11-01T00:00Z  provider/model-b  /home/operator/repos/elsewhere-project`),
				),
		);
	});

	/** One citizen in each place a placement owner can report, plus the three blank words (#178): a
	 * bookmarked Claude Code in a long wide-character tmux session from a wide-character directory, a
	 * pi-durable in a Herdr Core terminal, a herdr pane, and `none`, `ambiguous` and `unobserved`. The
	 * words are written out here, never read back from the module that renders them. `WIDE` is a width
	 * fixture, not prose: a Hangul syllable takes two terminal cells, as a real session name may. */
	const WIDE = "가";
	const LONG_SESSION = `${WIDE.repeat(14)}-work`;
	const WIDE_CWD = `/home/operator/repos/${WIDE.repeat(5)}/elsewhere-project`;
	const PLACED_FACTS = [
		fact(1, {
			backend: "pi-durable",
			model: null,
			liveness: "unsupported",
			receiver: "active",
			placement: { kind: "hc-terminal", coreId: "c0", coreName: "oracle", terminal: "t1x" } as never,
		}),
		fact(2, {
			backend: "claude-code",
			model: null,
			liveness: "unsupported",
			receiver: "active",
			cwd: WIDE_CWD,
			placement: { kind: "tmux-pane", paneId: "%7", session: LONG_SESSION, window: "12" } as never,
		}),
		fact(3, { placement: { kind: "herdr-pane", paneId: "w1-p2" } as never }),
		fact(4, { placement: { kind: "none" } as never }),
		fact(5, {
			backend: "claude-code",
			model: null,
			liveness: "unsupported",
			receiver: "active",
			placement: { kind: "ambiguous" } as never,
		}),
		fact(6),
	];
	const PLACED_PINS = [{ gardenId: fact(2).gardenId, name: "long-bookmark-name" }];
	const PLACED = buildResumeListing(PLACED_FACTS, HERE, PLACED_PINS);
	const PLACE_WORD: Record<number, string> = {
		1: "hc oracle/t1x",
		2: `tmux ${LONG_SESSION}:12`,
		3: "herdr w1-p2",
		4: "none",
		5: "ambiguous",
		6: "unobserved",
	};
	/** The selected line of a frame drawn with every directory shown. */
	const selectedLine = (listing: typeof PLACED, columns: number, cursor: number): string =>
		renderPickerFrame(listing, allRows(cursor), { columns, rows: 16 }, "tmux").lines.find((l) =>
			l.startsWith("selected: "),
		) ?? "";

	it("[QK:RESUMEPICK-PLACEMENT-SELECTED-LINE] at every width the list is drawn in, the selected line says where the row's terminal is in peer-facts' own word — a place, none or ambiguous — whole, or cut with `~` to no fewer than five cells, after the whole garden id and before a directory that keeps at least eight cells or all of a shorter one; a bookmarked row in a long wide-character tmux session from a wide-character directory fits too (#178)", () => {
		const broken: string[] = [];
		const order = visibleResumeRows(PLACED, allRows()).map((r) => Number(r.gardenId.slice(9, 15)));
		for (const columns of WIDTHS) {
			for (const [cursor, n] of order.entries()) {
				const word = PLACE_WORD[n] as string;
				if (word === "unobserved") continue;
				const line =
					renderPickerFrame(PLACED, allRows(cursor), { columns, rows: 16 }, "tmux").lines.find((l) =>
						l.startsWith("selected: "),
					) ?? "";
				const m = /^selected: (\S+)(?: {2}\[[^\]]*\])? {2}at (.*?) {2}in (.*)$/.exec(line);
				const cwd = (PLACED_FACTS[n - 1] as PeerFact).cwd;
				const place = m?.[2] ?? "";
				const dir = m?.[3] ?? "";
				const good =
					m !== null &&
					m[1] === fact(n).gardenId &&
					(place === word ||
						(place.endsWith("~") && word.startsWith(place.slice(0, -1)) && displayWidth(place) >= 5)) &&
					(dir === cwd || (dir.startsWith("...") && cwd.endsWith(dir.slice(3)))) &&
					displayWidth(dir) >= Math.min(8, displayWidth(cwd)) &&
					displayWidth(line) <= columns;
				if (!good) broken.push(`${columns}/${n}: ${line}`);
			}
		}
		const sel = (columns: number, cursor: number): string => selectedLine(PLACED, columns, cursor);
		ok(
			`the place on the selected line at every width (first broken: ${broken.slice(0, 2).join(" / ")})`,
			broken.length === 0 &&
				sel(64, 0) === `selected: ${fact(2).gardenId}  [long~]  at tmux~  in ...oject` &&
				sel(64, 5) === `selected: ${fact(1).gardenId}  at hc oracle/t1x  in ...roject` &&
				sel(64, 4) === `selected: ${fact(3).gardenId}  at herdr w1-p2  in .../project` &&
				sel(64, 2) === `selected: ${fact(5).gardenId}  at ambiguous  in ${HERE}` &&
				sel(64, 3) === `selected: ${fact(4).gardenId}  at none  in ${HERE}` &&
				sel(140, 0) ===
					`selected: ${fact(2).gardenId}  [long-bookmark-name]  at tmux ${LONG_SESSION}:12  in ...pos/${WIDE.repeat(5)}/elsewhere-project`,
		);
	});

	/** The same six citizens with five of them bookmarked under one short wide-character name (eight cells), in the
	 * order herdr, none, ambiguous, unobserved, hc; the tmux one is left unbookmarked. */
	const NAME = "운영코디";
	const NAMED = buildResumeListing(
		PLACED_FACTS,
		HERE,
		[3, 4, 5, 6, 1].map((n) => ({ gardenId: fact(n).gardenId, name: NAME })),
	);

	it("[QK:RESUMEPICK-SELECTED-UNOBSERVED-OMITTED] `unobserved` names no place, so the selected line draws no ` at ` for it and keeps no cells for it: at the minimum size a bookmarked row keeps its whole name and an unbookmarked one its whole directory, and a wide terminal adds nothing (#178)", () => {
		const everywhere = WIDTHS.every(
			(columns) =>
				!selectedLine(PLACED, columns, 1).includes(" at ") && !selectedLine(NAMED, columns, 3).includes(" at "),
		);
		ok(
			"no place, no ` at `, no cells kept",
			everywhere &&
				selectedLine(PLACED, 64, 1) === `selected: ${fact(6).gardenId}  in ${HERE}` &&
				selectedLine(PLACED, 140, 1) === `selected: ${fact(6).gardenId}  in ${HERE}` &&
				selectedLine(NAMED, 64, 3) === `selected: ${fact(6).gardenId}  [${NAME}]  in ${HERE}`,
		);
	});

	it("[QK:RESUMEPICK-SELECTED-NAME-BEFORE-PLACEMENT] on the selected line a bookmark's name keeps five cells (all of a shorter name) before the placement word takes any: at the minimum size a bookmarked row in a herdr pane, with no place, ambiguous or in a Herdr Core terminal still shows its name, cut with `~`, beside a placement word of at least five cells; with room for both, both are whole (#178)", () => {
		const named = WIDTHS.every((columns) =>
			[0, 1, 2, 4].every((cursor) =>
				/^selected: \S+ {2}\[운영(코디|코~|~)\] {2}at /.test(selectedLine(NAMED, columns, cursor)),
			),
		);
		ok(
			"the name first, then the place, all within the width",
			named &&
				selectedLine(NAMED, 64, 0) === `selected: ${fact(3).gardenId}  [운영~]  at herd~  in ...oject` &&
				selectedLine(NAMED, 64, 1) === `selected: ${fact(4).gardenId}  [운영~]  at none  in ...roject` &&
				selectedLine(NAMED, 64, 2) === `selected: ${fact(5).gardenId}  [운영~]  at ambi~  in ...oject` &&
				selectedLine(NAMED, 64, 4) === `selected: ${fact(1).gardenId}  [운영~]  at hc o~  in ...oject` &&
				[0, 1, 2, 4].every((cursor) => displayWidth(selectedLine(NAMED, 64, cursor)) === 64) &&
				selectedLine(NAMED, 80, 0) === `selected: ${fact(3).gardenId}  [${NAME}]  at herdr w1-p2  in ${HERE}` &&
				selectedLine(NAMED, 80, 4) === `selected: ${fact(1).gardenId}  [${NAME}]  at hc oracle/t1x  in ${HERE}`,
		);
	});

	const UNPLACED = buildResumeListing(
		PLACED_FACTS.map((f) => ({ ...f, placement: { kind: "unobserved" } }) as PeerFact),
		HERE,
		PLACED_PINS,
	);
	/** The body's row lines (no section titles) of a frame drawn with every directory shown. */
	const bodyRows = (listing: typeof PLACED, columns: number, query = ""): string[] => {
		const lines = renderPickerFrame(listing, { ...allRows(), query }, { columns, rows: 16 }, "tmux").lines;
		return lines.slice(3, lines.length - 4).filter((l) => l.length > 0 && !l.startsWith("== "));
	};
	const plainRows = (lines: string[]): string[] => lines.filter((l) => !l.startsWith("> * ") && !l.startsWith("  * "));

	it("[QK:RESUMEPICK-PLACEMENT-COLUMN] a wide terminal draws the placement word as its own column right after the activity time — a word past the column's 24-cell cap ends in `~` — starting at one cell on every row of a kind, whether or not a search narrows the list (#178)", () => {
		const startCell = (line: string, word: string): number => displayWidth(line.slice(0, line.indexOf(word)));
		const broken: string[] = [];
		for (const columns of [100, 120, 140]) {
			const starts = new Set<number>();
			for (const line of plainRows(bodyRows(PLACED, columns))) {
				const word = PLACE_WORD[Number(line.slice(2 + 9, 2 + 15))] as string;
				// The `unobserved` row's cell is blank (RESUMEPICK-PLACEMENT-COLUMN-BLANK-UNOBSERVED); its time still
				// starts where every other row's does.
				const drawn = word === "unobserved" ? "2026-11-01T00:00Z" : `2026-11-01T00:00Z  ${word}`;
				if (!line.includes(drawn)) broken.push(`${columns}: ${line}`);
				starts.add(startCell(line, drawn));
			}
			const narrowed = plainRows(bodyRows(PLACED, columns, "pi-durable"));
			const one = narrowed[0] ?? "";
			if (
				starts.size !== 1 ||
				narrowed.length !== 1 ||
				!starts.has(startCell(one, "2026-11-01T00:00Z  hc oracle/t1x"))
			) {
				broken.push(`${columns}: columns moved`);
			}
		}
		const pinned140 = bodyRows(PLACED, 140).find((l) => l.includes(fact(2).gardenId)) ?? "";
		ok(
			`one column after the activity time, at one cell, capped with \`~\` (first broken: ${broken.slice(0, 2).join(" / ")})`,
			broken.length === 0 && pinned140.includes(`2026-11-01T00:00Z  tmux ${WIDE.repeat(9)}~  `),
		);
	});

	it("[QK:RESUMEPICK-PLACEMENT-COLUMN-WHOLE] the placement column is drawn whole or not at all: where the activity time fits and the column does not, a row ends at its activity time; at every width what follows the facts is whole (the activity time, the placement word or its capped form, the model, a directory or its end); and a terminal too narrow for the activity time draws its rows exactly as a listing with no placement would (#178)", () => {
		const broken: string[] = [];
		for (const columns of WIDTHS) {
			for (const line of bodyRows(PLACED, columns)) {
				if (!line.includes("2026-11-01T00:00Z")) continue;
				const at = line.indexOf("20261101T");
				const n = Number(line.slice(at + 9, at + 15));
				const f = PLACED_FACTS[n - 1] as PeerFact;
				const word = PLACE_WORD[n] as string;
				const pieces = line.slice(line.indexOf("2026-11-01T00:00Z")).split(/ {2,}/).slice(1);
				const whole = pieces.every(
					(piece) =>
						piece === word ||
						(piece.endsWith("~") && word.startsWith(piece.slice(0, -1)) && displayWidth(piece) === 24) ||
						piece === f.model ||
						piece === f.cwd ||
						(piece.startsWith("...") && f.cwd.endsWith(piece.slice(3))),
				);
				if (!whole) broken.push(`${columns}: ${line}`);
			}
		}
		// A plain row needs 99 cells for the 24-cell column; at 90 its activity time fits and the column does not.
		const between = plainRows(bodyRows(PLACED, 90));
		const narrow = bodyRows(PLACED, 64);
		ok(
			`whole or absent, never a fragment (first broken: ${broken.slice(0, 2).join(" / ")})`,
			broken.length === 0 &&
				between.length === 5 &&
				between.every((l) => l.endsWith("2026-11-01T00:00Z")) &&
				JSON.stringify(narrow) === JSON.stringify(bodyRows(UNPLACED, 64)) &&
				!narrow.some((l) => Object.values(PLACE_WORD).some((w) => l.includes(w))),
		);
	});

	/** Nobody in a real place: one `none`, one `ambiguous`, the rest `unobserved`. */
	const NOWHERE = buildResumeListing(
		PLACED_FACTS.map(
			(f, i) => ({ ...f, placement: { kind: ["none", "ambiguous"][i - 3] ?? "unobserved" } }) as PeerFact,
		),
		HERE,
		[],
	);

	it("[QK:RESUMEPICK-PLACEMENT-COLUMN-ONLY-WHEN-PLACED] a listing in which no row has a real place — every row `none`, `ambiguous` or `unobserved` — draws no placement column at any width, so its rows keep the model and directory they had; the selected line still says `at none` and `at ambiguous` (#178)", () => {
		const words = / {2}(none|ambiguous|unobserved)( {2}|$)/;
		const broken = WIDTHS.filter(
			(columns) =>
				bodyRows(NOWHERE, columns).some((l) => words.test(l)) || bodyRows(UNPLACED, columns).some((l) => words.test(l)),
		);
		ok(
			`no column when nobody is in a real place (drawn at: ${broken.slice(0, 3).join(", ")})`,
			broken.length === 0 &&
				bodyRows(NOWHERE, 100).filter((l) => l.endsWith("2026-11-01T00:00Z  provider/model-a")).length === 3 &&
				selectedLine(NOWHERE, 64, 2) === `selected: ${fact(4).gardenId}  at none  in ${HERE}` &&
				selectedLine(NOWHERE, 64, 1) === `selected: ${fact(5).gardenId}  at ambiguous  in ${HERE}`,
		);
	});

	it("[QK:RESUMEPICK-PLACEMENT-COLUMN-SCOPE] the placement column answers for the rows of the directory scope shown: a placed sibling in another directory adds no column to the default view, whose rows keep their model; Ctrl-A brings that sibling and the column; and what is typed in the search never moves it (#178)", () => {
		const scoped = buildResumeListing(
			[
				fact(1),
				fact(2),
				fact(3, { cwd: "/work/other", placement: { kind: "herdr-pane", paneId: "w1-p2" } as never }),
				fact(4, { cwd: "/work/other", backend: "claude-code" }),
			],
			HERE,
			[],
		);
		const rows = (allDirectories: boolean, query = ""): string[] => {
			const lines = renderPickerFrame(
				scoped,
				{ ...INITIAL_PICKER_STATE, allDirectories, query },
				{ columns: 110, rows: 16 },
				"tmux",
			).lines;
			return lines.slice(3, lines.length - 4).filter((l) => l.length > 0 && !l.startsWith("== "));
		};
		const blank = `2026-11-01T00:00Z${" ".repeat(2 + "herdr w1-p2".length + 2)}provider/model-a`;
		ok(
			"no column from a hidden sibling, one with it shown, the same one while typing",
			rows(false).length === 2 &&
				rows(false).every((l) => l.endsWith("2026-11-01T00:00Z  provider/model-a")) &&
				rows(true).length === 4 &&
				rows(true).some((l) => l.includes("2026-11-01T00:00Z  herdr w1-p2  provider/model-a")) &&
				rows(true).filter((l) => l.includes(blank)).length === 3 &&
				rows(true, "claude").length === 1 &&
				(rows(true, "claude")[0] ?? "").includes(blank),
		);
	});

	it("[QK:RESUMEPICK-PLACEMENT-COLUMN-BLANK-UNOBSERVED] in a drawn placement column a row nobody looked for has a blank cell, never the word `unobserved`: its model still starts where every other row's does (#178)", () => {
		const rows = plainRows(bodyRows(PLACED, 120));
		const unobserved = rows.find((l) => l.includes(fact(6).gardenId)) ?? "";
		const herdr = rows.find((l) => l.includes(fact(3).gardenId)) ?? "";
		ok(
			"a blank cell as wide as the column, and no row says unobserved",
			unobserved.endsWith(`2026-11-01T00:00Z${" ".repeat(2 + 24 + 2)}provider/model-a`) &&
				herdr.endsWith(`2026-11-01T00:00Z  herdr w1-p2${" ".repeat(24 - "herdr w1-p2".length + 2)}provider/model-a`) &&
				displayWidth(unobserved) === displayWidth(herdr) &&
				WIDTHS.every((columns) => !bodyRows(PLACED, columns).some((l) => l.includes("unobserved"))),
		);
	});

	it("[QK:RESUMEPICK-EMPTY-SAYS-NEXT] when no row is drawn the body says what is empty and which keys bring rows back, the Enter line says Enter has nothing to reopen, Enter chooses nothing, and Esc still leaves with nothing opened", async () => {
		const typed = renderPickerFrame(LISTING, { ...INITIAL_PICKER_STATE, query: "zzz" }, ROOMY, "tmux").lines;
		const typedAll = renderPickerFrame(
			LISTING,
			{ ...INITIAL_PICKER_STATE, query: "zzz", allDirectories: true },
			ROOMY,
			"herdr",
		).lines;
		const nothingHere = renderPickerFrame(
			buildResumeListing([fact(1, { cwd: "/work/other" })], HERE, []),
			INITIAL_PICKER_STATE,
			ROOMY,
			"tmux",
		).lines;
		const t = terminal();
		let done = false;
		const p = runResumePicker(LISTING, "tmux", t.io).then((r) => {
			done = true;
			return r;
		});
		t.send("zzz");
		t.send("\r");
		await Promise.resolve();
		const stillOpen = !done;
		t.send("\x1b");
		t.fireTimer();
		ok(
			"the empty screen names the way back, and neither Enter nor Esc opens anything",
			typed[3] === '  nothing matches "zzz"' &&
				typed[4] === "  Backspace or Ctrl-U to widen, Ctrl-A: all directories" &&
				typed[typed.length - 2] === "Enter: nothing to reopen while no row is listed" &&
				typed[typed.length - 4] === "" &&
				typedAll[4] === "  Backspace or Ctrl-U to widen" &&
				typedAll[typedAll.length - 2] === "Enter: nothing to reopen while no row is listed" &&
				nothingHere[3] === "  no sibling to list in this directory" &&
				nothingHere[4] === "  Ctrl-A: all directories" &&
				stillOpen &&
				JSON.stringify(await p) === JSON.stringify({ kind: "cancelled" }),
		);
	});

	it("[QK:RESUMEPICK-EMPTY-MIN-KEYS] at the minimum size the body has one line, and with no row to draw that line names the keys that bring rows back rather than what is empty: the search line still shows what was typed and the Enter line says no row is listed", () => {
		const MIN = PICKER_MIN_SIZE;
		const smallest = renderPickerFrame(LISTING, { ...INITIAL_PICKER_STATE, query: "zzz" }, MIN, "tmux").lines;
		const smallestAll = renderPickerFrame(
			LISTING,
			{ ...INITIAL_PICKER_STATE, query: "zzz", allDirectories: true },
			MIN,
			"tmux",
		).lines;
		const smallestNothingHere = renderPickerFrame(
			buildResumeListing([fact(1, { cwd: "/work/other" })], HERE, []),
			INITIAL_PICKER_STATE,
			MIN,
			"tmux",
		).lines;
		ok(
			"at 64x8 the one empty line is the way back",
			MIN.columns === 64 &&
				MIN.rows === 8 &&
				smallest.length === 8 &&
				smallest[2] === "search: zzz" &&
				smallest[3] === "  Backspace or Ctrl-U to widen, Ctrl-A: all directories" &&
				smallest[6] === "Enter: nothing to reopen while no row is listed" &&
				smallestAll[3] === "  Backspace or Ctrl-U to widen" &&
				smallestNothingHere[3] === "  Ctrl-A: all directories",
		);
	});

	it("[QK:RESUMEPICK-COLOR-BY-ROLE] with colour on, each piece is coloured by what it is in the terminal's own colours — bookmark mark and name, garden id, a fact by whether it says running, not running or not known, a section title — the cursor's row is one reverse-video bar across the width, and every other line stripped of colour is exactly the plain line, while the cursor's is the plain line followed by the spaces that carry the bar to the width", () => {
		const listing = buildResumeListing(
			[
				...THREE_SHAPES,
				fact(9, { backend: "claude-code", model: null, liveness: "unsupported", receiver: "unobserved" }),
			],
			HERE,
			[{ gardenId: fact(1).gardenId, name: "운영코디" }],
		);
		// Rows: the bookmark, then 9, 3, 2 by recency; the cursor rests on 3.
		const state = { ...INITIAL_PICKER_STATE, cursor: 2 };
		const frame = renderPickerFrame(listing, state, { columns: 120, rows: 14 }, "tmux");
		const styled = styleFrame(frame, 120);
		const row = (n: number): string => styled.find((l) => l.includes(fact(n).gardenId)) ?? "";
		const cursorText = frame.lines[frame.cursorLine] ?? "";
		ok(
			"colour by role, a full-width bar for the cursor, and nothing but colour (and the bar's spaces) added",
			row(1).startsWith("  \x1b[35m* \x1b[0m\x1b[35m운영코디\x1b[0m  \x1b[36m") &&
				row(1).includes(`\x1b[32mreceiver active\x1b[0m`) &&
				row(9).includes(`\x1b[33mreceiver unobserved\x1b[0m`) &&
				row(2).includes("pi           socket dead") &&
				styled.some((l) => l.includes("\x1b[1;34mBookmarked, this directory\x1b[0m")) &&
				(styled[frame.cursorLine] ?? "") ===
					`\x1b[1;7m${cursorText}${" ".repeat(120 - displayWidth(cursorText))}\x1b[0m` &&
				styled.every((l, i) => i === frame.cursorLine || stripEscapes(l) === frame.lines[i]) &&
				styled.every((l) => displayWidth(stripEscapes(l)) <= 120),
		);
	});

	it("[QK:RESUMEPICK-NO-COLOR-PLAIN] with colour off (NO_COLOR) the terminal receives no colour or emphasis code at all — only the screen's own control — and the frame still says everything: `>` on the cursor's row, `*` on a bookmark, a rule for each section", async () => {
		const listing = buildResumeListing(THREE_SHAPES, HERE, [{ gardenId: fact(1).gardenId, name: "운영코디" }]);
		const plain = terminal(ROOMY, {}, false);
		const pPlain = runResumePicker(listing, "tmux", plain.io);
		plain.send("\x1b[B");
		const plainScreen = plain.screen();
		plain.send("\x03");
		await pPlain;
		const coloured = terminal(ROOMY, {}, true);
		const pColoured = runResumePicker(listing, "tmux", coloured.io);
		coloured.send("\x03");
		await pColoured;
		ok(
			"no SGR without colour, the marks and rules still drawn; with colour, SGR is there",
			plain.written.every((w) => !hasSgr(w)) &&
				plainScreen.some((l) => l.startsWith(`> ${fact(3).gardenId}`)) &&
				plainScreen.some((l) => l.startsWith(`  * 운영코디  ${fact(1).gardenId}`)) &&
				plainScreen.some((l) => l.startsWith("== Bookmarked, this directory ==")) &&
				coloured.written.some((w) => hasSgr(w)),
		);
	});
});
