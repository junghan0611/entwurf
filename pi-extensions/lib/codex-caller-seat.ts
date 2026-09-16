/**
 * codex-caller-seat — the ONE resolution of a Codex caller's `threadId` into the tmux pane its
 * TUI is sitting in. Narrow leaf of the fresh-call composition (#95 lane B); it owns the title
 * anchor and the pane count and NOTHING else — it never runs tmux (the runner is injected),
 * never phrases a placement decision, never reads a record, and has no fallback seat.
 *
 * Same shape and same discipline as `resolve-tmux-session.ts` and `classify-tmux-cwd.ts`: this
 * file imports nothing at all, not even a node builtin, so it stays deletable on its own and
 * cannot acquire an opinion about mux, entwurf, identity or delivery. The injected runner is
 * matched STRUCTURALLY to `mux-placement.TmuxRun` rather than by a type import, for the same
 * reason.
 *
 * ── WHAT THIS IS NOT ──
 *
 * A pane title is OPERATOR-WRITABLE and forgeable: any process in any pane can emit the same
 * OSC 0 string. So this leaf's answer is a PLACEMENT INPUT and nothing else — the `$session`
 * it returns may only reach a `-t` target. Identity, delivery and liveness keep the record +
 * `_meta` join they already have (AGENTS.md Hard Rule 16). Nothing here reads screen text,
 * sends keys, or infers that a citizen is alive.
 *
 * ── THE ANCHOR, AND WHY IT IS NOT THE BARE UUID ──
 *
 * With `thread-id` in `[tui].terminal_title` (the `entwurf install-codex-terminal-title` atom)
 * the vendor renders the thread UUID into the terminal title — but TRUNCATED. `[측정]
 * 2026-09-16, thinkpad, codex-cli 0.153.4: a live TUI's `#{pane_title}` read back
 * `tmp | 01a0a7f9-ed9c-7aa2-a4dd-b1a39...`, not the 36-char id. Source at `rust-v0.153.4`:
 * `codex-rs/tui/src/chatwidget/status_surfaces.rs:892-894` renders `TerminalTitleItem::SessionId`
 * through `truncate_terminal_title_part(value, 32)`, and `:1027-1043` keeps 29 graphemes and
 * appends `...`. So the anchor set is TWO strings: the truncated form the vendor emits today,
 * and the full id — accepted so that a vendor which later stops truncating passes unchanged
 * rather than silently resolving nothing.
 *
 * `[측정]` 29 leading chars of a thread UUID are ASCII (`01a09ec6-e6de-7643-8571-f3261`, 29
 * code points, 29 bytes — terra#1 2026-09-16 item 8), so counting code points here and
 * graphemes there is the same count for every id this rail will ever see.
 *
 * `[측정]` `rust-v0.154.0` is unchanged on all three axes — the `thread-id` item
 * (`title_setup.rs:81-83`), the 32-char truncation (`status_surfaces.rs:930-934`) and the
 * ` | ` separator (`title_setup.rs:187-195`) — so this anchor is not pinned to one release.
 *
 * ── WHY TOKENS AND NOT ` | ` SEGMENTS ──
 *
 * The obvious rule is "one ` | `-separated segment equals the anchor". It has a vendor hole.
 * `title_setup.rs:183-193 separator_from_previous` joins adjacent items with ` | ` EXCEPT when
 * either side is the `activity` item (`Spinner`, `title_setup.rs:47-48`), which gets a plain
 * space — and `status_surfaces.rs:330-343` computes that `previous` from the last RENDERED
 * item, skipping any that resolved to `None`. So on a host whose operator list ends in
 * `activity`, the installed atom appends `thread-id` right after it and a WORKING TUI renders
 * `<spinner text> 01a0a7f9-…`: one segment, two values. Splitting each segment on a space and
 * comparing TOKENS closes that hole and cannot open a new one — a false positive would need
 * some other title item to render a string byte-identical to this thread's own id.
 *
 * ── WHY THE COUNT IS OVER PANES, NOT TOKENS ──
 *
 * One pane can legitimately show the same thread twice: an operator whose `terminal_title` also
 * carries `thread-title` sees the full 36-char id there whenever the thread is unnamed
 * (`status_surfaces.rs:776-786`), beside our truncated one. Two tokens, one pane, one thread —
 * not an ambiguity. Ambiguity is TWO PANES claiming the same thread, and that is refused
 * because picking either would seat a sibling by guess.
 */

/** Why a Codex caller's seat could not be resolved. Two stable literals — the consuming
 * composition widens its own reject union with this type, so the strings are contract. */
export type CodexCallerSeatRejectReason = "codex-caller-seat-unresolved" | "codex-caller-seat-ambiguous";

/** The repair text for each refusal, owned by the leaf that decides it so the sentence an
 * operator reads cannot drift away from the predicate that produced it (the same rule the
 * Copilot/OMP/Codex preflight hints follow). */
export const CODEX_CALLER_SEAT_HINT: Record<CodexCallerSeatRejectReason, string> = {
	"codex-caller-seat-unresolved":
		"no pane on this agent's own tmux server shows this Codex thread in its title, so there is no caller seat to open a sibling beside — the TUI may be on another tmux server or outside tmux entirely, its config may not carry `thread-id` in [tui].terminal_title (run `entwurf install-codex-terminal-title`, then `entwurf doctor-codex-terminal-title`), or that server may have `allow-set-title off`, which replaces every pane title with the hostname and hides the id [측정 2026-09-16]",
	"codex-caller-seat-ambiguous":
		"more than one pane on this agent's own tmux server shows this Codex thread in its title, so which one is the caller cannot be decided — nothing is opened rather than guessing a seat; close the stale duplicate and call again",
};

/** What the injected runner returns. Structurally identical to `mux-placement.TmuxRun`; kept as
 * its own declaration so this leaf imports nothing. */
export interface CodexCallerSeatRun {
	status: number | null;
	stdout: string;
	stderr: string;
}

/** The pane a Codex caller is sitting in. `sessionId` is the only member a placement may use;
 * `paneId` travels for receipts and diagnosis, never as an address. */
export interface CodexCallerSeat {
	paneId: string;
	sessionId: string;
	source: "codex-title-anchor";
}

export type CodexCallerSeatResult =
	| { ok: true; seat: CodexCallerSeat }
	| { ok: false; reason: CodexCallerSeatRejectReason };

/** The vendor's per-item ceiling for `thread-id` (`status_surfaces.rs:892-894`). */
export const CODEX_TITLE_ITEM_MAX_CHARS = 32;

/** The two separators a rendered title can put between items: ` | ` for an ordinary pair, and a
 * bare space when either neighbour is the `activity` indicator (`title_setup.rs:183-193`). */
const TITLE_SEGMENT_SEPARATOR = " | ";
const TITLE_TOKEN_SEPARATOR = " ";

/**
 * The vendor's `truncate_terminal_title_part`, reproduced (`status_surfaces.rs:1027-1043`).
 * Code points stand in for graphemes — measured identical for every thread id (see header).
 */
export function truncateTerminalTitlePart(value: string, maxChars: number): string {
	const chars = [...value];
	if (chars.length <= maxChars || maxChars <= 3) return chars.slice(0, maxChars).join("");
	return `${chars.slice(0, maxChars - 3).join("")}...`;
}

/**
 * Every string a title may legitimately carry for this thread. The truncated form is what the
 * vendor emits today; the full id is accepted so a future vendor that stops truncating keeps
 * working without a code change here.
 */
export function codexTitleAnchors(threadId: string): string[] {
	if (threadId.length === 0) {
		throw new Error("codex-caller-seat: refusing to build an anchor for an empty threadId");
	}
	const truncated = truncateTerminalTitlePart(threadId, CODEX_TITLE_ITEM_MAX_CHARS);
	return truncated === threadId ? [threadId] : [threadId, truncated];
}

/** Does this ONE pane title name the thread? Segment first, then token — see the header for the
 * `activity`-adjacency hole a segment-only rule leaves open. */
export function titleNamesThread(title: string, anchors: readonly string[]): boolean {
	for (const segment of title.split(TITLE_SEGMENT_SEPARATOR)) {
		for (const token of segment.split(TITLE_TOKEN_SEPARATOR)) {
			if (anchors.includes(token)) return true;
		}
	}
	return false;
}

/**
 * The lookup argv. `-a` is the whole server because a Codex TUI is not required to be in the
 * caller's own session — that asymmetry is exactly what this leaf exists to remove. The three
 * fields are tab-separated so a title containing spaces (a project name, the spinner text)
 * cannot be read as a new column.
 */
export function buildCodexCallerSeatArgs(): string[] {
	return ["list-panes", "-a", "-F", "#{pane_id}\t#{session_id}\t#{pane_title}"];
}

/** One `list-panes` line back into its three fields, or `null` when it is not one. The title
 * takes EVERYTHING after the second tab: splitting on every tab would truncate a title that
 * ever carried one. */
function parsePaneLine(line: string): { paneId: string; sessionId: string; title: string } | null {
	const firstTab = line.indexOf("\t");
	if (firstTab < 0) return null;
	const secondTab = line.indexOf("\t", firstTab + 1);
	if (secondTab < 0) return null;
	const paneId = line.slice(0, firstTab);
	const sessionId = line.slice(firstTab + 1, secondTab);
	if (paneId.length === 0 || sessionId.length === 0) return null;
	return { paneId, sessionId, title: line.slice(secondTab + 1) };
}

/**
 * Resolve the pane a Codex caller's thread is displayed in, on whatever server the runner's
 * environment names.
 *
 * ONE BOUNDED IMPRECISION, STATED RATHER THAN LAUNDERED (the same one
 * `resolve-tmux-session.ts` carries): rc≠0 also covers "no server running on this socket". This
 * leaf reads every rc≠0 as `codex-caller-seat-unresolved`, so a server that died between the
 * caller's context proof and this lookup is reported under the narrower word. That is safe —
 * both readings are refusals that mutate nothing, and the hint above names both — and it is
 * preferred over matching tmux's own stderr text, which would pin this leaf to one vendor
 * version's wording.
 */
export function resolveCodexCallerSeat(
	threadId: string,
	run: (args: string[]) => CodexCallerSeatRun,
): CodexCallerSeatResult {
	const anchors = codexTitleAnchors(threadId);
	const result = run(buildCodexCallerSeatArgs());
	// A signalled call is not tmux answering — it carries no information about any pane at all,
	// so it must never be read as "the caller's TUI is not here".
	if (result.status === null) {
		throw new Error(`codex-caller-seat: the pane listing was killed by a signal: ${result.stderr.trim()}`);
	}
	if (result.status !== 0) return { ok: false, reason: "codex-caller-seat-unresolved" };

	const matches: CodexCallerSeat[] = [];
	for (const line of result.stdout.split("\n")) {
		if (line.length === 0) continue;
		const pane = parsePaneLine(line);
		// A line this leaf cannot read is NOT a pane it may skip quietly: the listing is the
		// whole evidence base for "exactly one", and a dropped line could be the second match
		// that should have refused.
		if (pane === null) {
			throw new Error(`codex-caller-seat: tmux printed a pane line this leaf cannot read: ${JSON.stringify(line)}`);
		}
		if (titleNamesThread(pane.title, anchors)) {
			matches.push({ paneId: pane.paneId, sessionId: pane.sessionId, source: "codex-title-anchor" });
		}
	}
	if (matches.length === 0) return { ok: false, reason: "codex-caller-seat-unresolved" };
	if (matches.length > 1) return { ok: false, reason: "codex-caller-seat-ambiguous" };
	return { ok: true, seat: matches[0] };
}
