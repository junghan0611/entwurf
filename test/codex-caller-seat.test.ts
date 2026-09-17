/**
 * codex-caller-seat unit cells — the title anchor and the pane count (#95 lane B C2).
 *
 * Every title string here is a MEASURED vendor shape, not invented prose:
 *
 *   - `tmp | 01a0a7f9-ed9c-7aa2-a4dd-b1a39...` — a live TUI's `#{pane_title}` on thinkpad
 *     with codex-cli 0.153.4 and `terminal_title = ["activity","project-name","thread-id"]`,
 *     idle (the `activity` item renders `None` and its segment is omitted entirely).
 *   - 29 leading chars + `...` — `status_surfaces.rs:892-894` + `:1027-1043` at rust-v0.153.4,
 *     unchanged at rust-v0.154.0 (`status_surfaces.rs:930-934`).
 *   - `<spinner> <anchor>` in ONE segment — `title_setup.rs:183-193`: the `activity` item joins
 *     its neighbour with a plain space, not ` | `, and `status_surfaces.rs:330-343` takes that
 *     neighbour from the last RENDERED item. That is the shape an operator list ending in
 *     `activity` produces once the TUI is working.
 *   - `thinkpad` — what tmux reports for every pane when the server has `allow-set-title off`
 *     (terra#1 2026-09-16 item 6).
 *
 * The behavioural oracle for the composition — which session a window actually lands in — is
 * the real-tmux cell in `check-mux-launch-tmux`; this file owns the decision, not the effect.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
	buildCodexCallerSeatArgs,
	CODEX_CALLER_SEAT_HINT,
	CODEX_TITLE_ITEM_MAX_CHARS,
	type CodexCallerSeatRun,
	codexTitleAnchors,
	resolveCodexCallerSeat,
	titleNamesThread,
	truncateTerminalTitlePart,
} from "../pi-extensions/lib/codex-caller-seat.ts";

const THREAD = "01a0a7f9-ed9c-7aa2-a4dd-b1a39c0d4e11";
const TRUNCATED = "01a0a7f9-ed9c-7aa2-a4dd-b1a39...";
const REPO_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const LEAF_SRC = fs.readFileSync(path.join(REPO_DIR, "pi-extensions/lib/codex-caller-seat.ts"), "utf8");

/** A `list-panes -a -F '#{pane_id}\t#{session_id}\t#{pane_title}'` answer. */
function listing(...panes: Array<[string, string, string]>): (args: string[]) => CodexCallerSeatRun {
	return (args) => {
		expect(args).toEqual(buildCodexCallerSeatArgs());
		return {
			status: 0,
			stdout: `${panes.map(([pane, session, title]) => `${pane}\t${session}\t${title}`).join("\n")}\n`,
			stderr: "",
		};
	};
}

describe("the anchor", () => {
	it("is the vendor's 29-char prefix plus '...', exactly 32 chars", () => {
		expect(truncateTerminalTitlePart(THREAD, CODEX_TITLE_ITEM_MAX_CHARS)).toBe(TRUNCATED);
		expect(TRUNCATED).toHaveLength(CODEX_TITLE_ITEM_MAX_CHARS);
		expect(TRUNCATED.slice(0, 29)).toBe(THREAD.slice(0, 29));
	});

	it("reproduces the vendor's short-value and tiny-ceiling branches", () => {
		// `graphemes.next().is_none()` — nothing to truncate, returned whole.
		expect(truncateTerminalTitlePart("short", CODEX_TITLE_ITEM_MAX_CHARS)).toBe("short");
		expect(truncateTerminalTitlePart("x".repeat(32), 32)).toBe("x".repeat(32));
		// `max_chars <= 3` — the head is returned WITHOUT an ellipsis that would not fit.
		expect(truncateTerminalTitlePart("abcdef", 3)).toBe("abc");
		expect(truncateTerminalTitlePart("abcdef", 0)).toBe("");
	});

	it("carries both forms: the truncation the vendor emits today, and the full id", () => {
		expect(codexTitleAnchors(THREAD)).toEqual([THREAD, TRUNCATED]);
	});

	it("collapses to ONE form when the id is short enough to be rendered whole", () => {
		// A vendor that stops truncating, or a shorter future id, must keep working here
		// without a second code path.
		expect(codexTitleAnchors("01a0a7f9")).toEqual(["01a0a7f9"]);
	});

	it("refuses an empty threadId rather than matching every pane", () => {
		expect(() => codexTitleAnchors("")).toThrow(/empty threadId/);
	});
});

describe("reading one title", () => {
	const anchors = codexTitleAnchors(THREAD);

	it("matches the measured idle title", () => {
		expect(titleNamesThread(`tmp | ${TRUNCATED}`, anchors)).toBe(true);
	});

	it("matches the full id, for the vendor that stops truncating", () => {
		expect(titleNamesThread(`tmp | ${THREAD}`, anchors)).toBe(true);
	});

	it("[QK:CODEX-SEAT-TOKEN-NOT-SEGMENT] matches through the ACTIVITY space separator, which ' | ' alone would miss", () => {
		// `title_setup.rs:183-193`: activity's neighbour is joined with a plain space, so this
		// whole string is ONE ` | ` segment. A segment-equality rule reads it as no match.
		expect(`Working ${TRUNCATED}`.split(" | ")).toHaveLength(1);
		expect(titleNamesThread(`Working ${TRUNCATED}`, anchors)).toBe(true);
		expect(titleNamesThread(`entwurf | Working ${TRUNCATED}`, anchors)).toBe(true);
	});

	it("matches inside the action-required title, which drops the spinner and joins with ' | '", () => {
		// `action_required_title.rs:5-24` — the prefix is its own segment and every item keeps
		// its own, so thread-id survives the blocked state.
		expect(titleNamesThread(`[ ! ] Action Required | entwurf | ${TRUNCATED}`, anchors)).toBe(true);
	});

	it("does not match a DIFFERENT thread that shares the id's leading bytes", () => {
		const neighbour = `${THREAD.slice(0, 20)}9999-999999999999`;
		expect(neighbour).not.toBe(THREAD);
		expect(titleNamesThread(`tmp | ${truncateTerminalTitlePart(neighbour, CODEX_TITLE_ITEM_MAX_CHARS)}`, anchors)).toBe(
			false,
		);
	});

	it("[QK:CODEX-SEAT-ANCHOR-PREFIX-LENGTH] does not match a prefix one char short or one char long", () => {
		expect(titleNamesThread(`tmp | ${THREAD.slice(0, 28)}...`, anchors)).toBe(false);
		expect(titleNamesThread(`tmp | ${THREAD.slice(0, 30)}...`, anchors)).toBe(false);
	});

	it("[QK:CODEX-SEAT-ANCHOR-ELLIPSIS] does not match the bare 29-char prefix — the vendor appends the ellipsis, and it is part of the token", () => {
		expect(titleNamesThread(`tmp | ${THREAD.slice(0, 29)}`, anchors)).toBe(false);
	});

	it("[QK:CODEX-SEAT-EXACT-TOKEN] does not match a token the anchor is merely a SUBSTRING of", () => {
		expect(titleNamesThread(`tmp | x${TRUNCATED}`, anchors)).toBe(false);
		expect(titleNamesThread(`tmp | ${TRUNCATED}x`, anchors)).toBe(false);
	});

	it("does not match the allow-set-title-off title", () => {
		expect(titleNamesThread("thinkpad", anchors)).toBe(false);
	});
});

describe("resolving the seat", () => {
	it("returns the ONE matching pane, labelled by its source", () => {
		const result = resolveCodexCallerSeat(
			THREAD,
			listing(
				["%3", "$0", "entwurf | some-other-thread"],
				["%8", "$2", `tmp | ${TRUNCATED}`],
				["%9", "$2", "thinkpad"],
			),
		);
		expect(result).toEqual({ ok: true, seat: { paneId: "%8", sessionId: "$2", source: "codex-title-anchor" } });
	});

	it("[QK:CODEX-SEAT-COUNTS-PANES] counts PANES, not tokens: one pane naming the thread twice is still one seat", () => {
		// An operator whose terminal_title also carries `thread-title` sees the full 36-char id
		// there while the thread is unnamed (`status_surfaces.rs:776-786`), beside our
		// truncated one. Same pane, same thread — not an ambiguity.
		const result = resolveCodexCallerSeat(THREAD, listing(["%8", "$2", `${THREAD} | tmp | ${TRUNCATED}`]));
		expect(result).toEqual({ ok: true, seat: { paneId: "%8", sessionId: "$2", source: "codex-title-anchor" } });
	});

	it("[QK:CODEX-SEAT-UNRESOLVED-NO-FALLBACK] rejects 0 matches rather than falling back to any seat", () => {
		const result = resolveCodexCallerSeat(THREAD, listing(["%3", "$0", "entwurf"], ["%9", "$1", "thinkpad"]));
		expect(result).toEqual({ ok: false, reason: "codex-caller-seat-unresolved" });
	});

	it("[QK:CODEX-SEAT-AMBIGUOUS-REJECTS] rejects 2+ matching panes rather than taking the first", () => {
		const result = resolveCodexCallerSeat(
			THREAD,
			listing(["%8", "$2", `tmp | ${TRUNCATED}`], ["%12", "$5", `tmp | ${TRUNCATED}`]),
		);
		expect(result).toEqual({ ok: false, reason: "codex-caller-seat-ambiguous" });
	});

	it("reads a title containing tabs whole instead of splitting it into a fourth column", () => {
		const result = resolveCodexCallerSeat(THREAD, listing(["%8", "$2", `tmp\t| ${TRUNCATED}`]));
		expect(result.ok).toBe(true);
	});

	it("treats a tmux failure as unresolved, never as an answer about the panes", () => {
		const result = resolveCodexCallerSeat(THREAD, () => ({ status: 1, stdout: "", stderr: "no server running" }));
		expect(result).toEqual({ ok: false, reason: "codex-caller-seat-unresolved" });
	});

	it("raises on a signalled call — that is no information about any pane", () => {
		expect(() => resolveCodexCallerSeat(THREAD, () => ({ status: null, stdout: "", stderr: "killed" }))).toThrow(
			/killed by a signal/,
		);
	});

	it("[QK:CODEX-SEAT-UNREADABLE-LINE-RAISES] raises on an unreadable pane line instead of silently dropping a possible second match", () => {
		expect(() =>
			resolveCodexCallerSeat(THREAD, () => ({
				status: 0,
				stdout: `%8\t$2\ttmp | ${TRUNCATED}\nbroken-line\n`,
				stderr: "",
			})),
		).toThrow(/cannot read/);
	});

	it("asks tmux for the WHOLE server: a Codex TUI need not share the caller's session", () => {
		expect(buildCodexCallerSeatArgs()).toEqual(["list-panes", "-a", "-F", "#{pane_id}\t#{session_id}\t#{pane_title}"]);
	});
});

describe("the fence", () => {
	it("[QK:CODEX-SEAT-IMPORTS-NOTHING] the leaf imports NOTHING, so a pane title can never reach identity, delivery or a record", () => {
		// Structural, and there is no runtime observation point for it: the claim is about what
		// this file COULD do, not what one call did. Same fence its two siblings hold
		// (`classify-tmux-cwd.ts`, `resolve-tmux-session.ts`) and the same reason — a title is a
		// forgeable placement input, so the module that reads one must not be able to address a
		// citizen, open a socket, or write a store. The injected runner is what keeps tmux out
		// of it too.
		expect(LEAF_SRC).not.toMatch(/^\s*import[\s{*]/m);
		expect(LEAF_SRC).not.toMatch(/\brequire\s*\(/);
		expect(LEAF_SRC).toMatch(/run: \(args: string\[\]\) => CodexCallerSeatRun/);
	});
});

describe("the repair text", () => {
	it("names the installer verb and the allow-set-title condition for the unresolved case", () => {
		const hint = CODEX_CALLER_SEAT_HINT["codex-caller-seat-unresolved"];
		expect(hint).toContain("entwurf install-codex-terminal-title");
		expect(hint).toContain("allow-set-title off");
	});

	it("tells the operator to close the duplicate rather than implying entwurf will pick", () => {
		expect(CODEX_CALLER_SEAT_HINT["codex-caller-seat-ambiguous"]).toMatch(/nothing is opened/i);
	});
});
