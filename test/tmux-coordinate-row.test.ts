import { describe, expect, it } from "vitest";

import {
	parseTmuxRow,
	TMUX_COORDINATE_FIELDS,
	TMUX_COORDINATE_FORMAT,
	TmuxRowError,
} from "../scripts/lib/tmux-coordinate-row.ts";

/**
 * The deterministic half of a failure the Codex first-admission LIVE actually produced: four
 * coordinates asked for in one row, `#{server_pid}` answered empty on tmux 3.6a, and a
 * `.trim().split("\t")` shifted every later field one place left. The gate went red — at the
 * wrong coordinate, blaming the host for a field the format never filled.
 *
 * No tmux and no model here: the row is the input, so the parse is the whole subject.
 */
describe("tmux coordinate row", () => {
	it("[QK:TMUX-COORDINATE-FORMAT-PID] asks for the server pid key that actually answers", () => {
		// `[host]` measured on tmux 3.6a: `#{pid}` → 5772 (the same pid the $TMUX tuple carries),
		// `#{server_pid}` → "". Pinned as a literal so the LIVE inspector and this oracle cannot
		// drift apart, and so a silent return to the empty key is a red here rather than a
		// confusing coordinate in a metered LIVE run.
		expect(TMUX_COORDINATE_FORMAT).toBe("#{pid}\t#{session_id}\t#{window_id}\t#{pane_id}");
		expect(TMUX_COORDINATE_FORMAT).not.toContain("server_pid");
		expect(TMUX_COORDINATE_FIELDS).toBe(4);
		expect(TMUX_COORDINATE_FORMAT.split("\t")).toHaveLength(TMUX_COORDINATE_FIELDS);
	});

	it("[QK:TMUX-COORDINATE-ROW-NO-SHIFT] keeps an empty leading field at its own position", () => {
		// The measured row, verbatim: an empty first field, then the three that did answer.
		const measured = "\t$150\t@342\t%342\n";
		expect(parseTmuxRow(measured, 4)).toEqual(["", "$150", "@342", "%342"]);
		// The shape the old parse produced — session id read as the server pid — must NOT be
		// reachable any more. This is the assertion the LIVE failure was missing.
		expect(parseTmuxRow(measured, 4)[0]).not.toBe("$150");
		// A trailing empty field survives too: `split` alone would keep it, `trim` would not.
		expect(parseTmuxRow("5772\t$150\t@342\t\n", 4)).toEqual(["5772", "$150", "@342", ""]);
		// ...and a fully-answered row is unchanged.
		expect(parseTmuxRow("5772\t$150\t@342\t%342\n", 4)).toEqual(["5772", "$150", "@342", "%342"]);
		expect(parseTmuxRow("5772\t$150\t@342\t%342\r\n", 4)).toEqual(["5772", "$150", "@342", "%342"]);
		expect(parseTmuxRow("5772\t$150\t@342\t%342", 4)).toEqual(["5772", "$150", "@342", "%342"]);
	});

	it("refuses a row that is not the single line the caller asked for", () => {
		// Two lines: whatever this is, it is not one coordinate row, and reshaping it to fit
		// would be the same class of guess that caused the original failure.
		expect(() => parseTmuxRow("5772\t$150\t@342\t%342\n\n", 4)).toThrow(TmuxRowError);
		expect(() => parseTmuxRow("5772\t$150\n@342\t%342\n", 4)).toThrow(TmuxRowError);
		expect(() => parseTmuxRow("5772\t$150\t@342\t%342\rmore\n", 4)).toThrow(TmuxRowError);
	});

	it("refuses a field count the format did not ask for", () => {
		expect(() => parseTmuxRow("5772\t$150\t@342\n", 4)).toThrow(/answered 3 field\(s\), the format asked for 4/);
		expect(() => parseTmuxRow("5772\t$150\t@342\t%342\textra\n", 4)).toThrow(/answered 5 field\(s\)/);
		expect(() => parseTmuxRow("5772\t$150\t@342\t%342\n", 0)).toThrow(/fieldCount must be a positive integer/);
	});
});
