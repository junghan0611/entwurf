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
} from "./resume-picker.ts";
import { buildResumeListing, visibleResumeRows } from "./resume-picker-rows.ts";

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
const LISTING = buildResumeListing(THREE, HERE, []);
const ORDER = visibleResumeRows(LISTING, INITIAL_PICKER_STATE).map((r) => r.gardenId);
const ROOMY: PickerSize = { columns: 100, rows: 20 };

interface Faults {
	/** The index of the write that throws. */
	failWriteAt?: number;
	reraiseThrows?: boolean;
}

/** A recording terminal. Nothing happens on its own: input, resize, signals, errors and timers are
 * all delivered by the test. */
function terminal(size: PickerSize = ROOMY, faults: Faults = {}) {
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
					const good =
						frame.lines.length === height &&
						frame.lines.every((line) => displayWidth(line) <= columns) &&
						frame.cursorLine >= 3 &&
						frame.cursorLine < height - 4 &&
						(frame.lines[frame.cursorLine] ?? "").startsWith(`> ${id}`) &&
						(frame.lines[height - 4] ?? "").startsWith(`selected: ${id}  in /work/`) &&
						frame.lines[height - 2] === "Enter: reopen in a new tmux window beside this one" &&
						frame.lines[height - 1] === "Esc: open nothing | Up/Down, PgUp/PgDn: move | type to narrow";
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
						"-- Bookmarked, other directories",
						"> 20261101T000001-aaaaab  claude-code  receiver inactive     [운영코디-실무담당]",
						"-- This directory",
						"selected: 20261101T000001-aaaaab  in /home/operator/repos/other-project  [운영코",
						"",
						"Enter: reopen in a new tmux window beside this one",
						"Esc: open nothing | Up/Down, PgUp/PgDn: move | type to narrow",
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
				at(tmux, 1) === "Esc: open nothing | Up/Down, PgUp/PgDn: move | type to narrow" &&
				tmux[1] === `directory: ${HERE}  (Ctrl-A: all directories)` &&
				all[1] === "all directories  (Ctrl-A: this directory only)" &&
				tmux.includes("-- Bookmarked, other directories") &&
				tmux.includes("-- This directory") &&
				tmux.some((l) => l.includes("[Far]  2026-11-01T00:00  provider/model-a  /work/other")) &&
				at(tmux, 4) === `selected: ${fact(2).gardenId}  in /work/other  [Far]` &&
				at(tmux, 3) === "1 citizen of other backends is not listed (codex 1) | 1 bookmark has no record here" &&
				at(all, 3) === "2 citizens of other backends are not listed (codex 2) | 1 bookmark has no record here" &&
				tmux[0] === "entwurf resume - 2 of 2 shown",
		);
	});
});
