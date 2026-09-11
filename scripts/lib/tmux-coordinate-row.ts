/**
 * tmux-coordinate-row — parse ONE positional TSV row out of `tmux display-message -p`.
 *
 * WHY THIS EXISTS, measured. The Codex first-admission LIVE asked tmux for four coordinates in
 * one row and split the result with `.trim().split("\t")`. On tmux 3.6a `#{server_pid}` answers
 * with an EMPTY string, so the row arrived as `"\t$150\t@342\t%342\n"` — and `.trim()` ate the
 * leading tab along with the newline. Every field then shifted one place left: the session id
 * was read as the server pid, the window id as the session id, and the pane id vanished. The
 * gate failed, which was right, but it failed at the wrong coordinate and blamed the host for a
 * field the format never filled.
 *
 * So two rules, and the second one is the reason this is a separate leaf:
 *
 *   1. Exactly ONE terminal newline is removed — `\n` or `\r\n`, and only at the end. Anything
 *      else (an embedded newline, a second trailing one) means the row is not the single line
 *      the caller asked for, and is refused rather than silently reshaped.
 *   2. EMPTY FIELDS ARE KEPT, leading and trailing alike. A format key that answers with
 *      nothing must fail at its own position — "the server pid is empty" is a fact the caller
 *      can act on; "everything after it moved" is a fact nobody can.
 *
 * The field COUNT is the caller's contract, so it is passed in and enforced here: a row with
 * more or fewer columns than the format asked for is malformed, never truncated to fit.
 */

export class TmuxRowError extends Error {}

/**
 * @param raw the exact stdout of a single `display-message -p` invocation
 * @param fieldCount how many `\t`-separated fields the caller's format string asked for
 */
export function parseTmuxRow(raw: string, fieldCount: number): string[] {
	if (!Number.isInteger(fieldCount) || fieldCount < 1) {
		throw new TmuxRowError(`fieldCount must be a positive integer, got ${String(fieldCount)}`);
	}
	let line = raw;
	if (line.endsWith("\r\n")) line = line.slice(0, -2);
	else if (line.endsWith("\n")) line = line.slice(0, -1);
	if (line.includes("\n") || line.includes("\r")) {
		throw new TmuxRowError(
			`tmux answered with more than one line (${JSON.stringify(raw)}); a positional row must be exactly one`,
		);
	}
	const fields = line.split("\t");
	if (fields.length !== fieldCount) {
		throw new TmuxRowError(
			`tmux answered ${fields.length} field(s), the format asked for ${fieldCount} (${JSON.stringify(raw)})`,
		);
	}
	return fields;
}

/**
 * The server pid key that actually answers. `[host]` measured on tmux 3.6a: `#{pid}` returns
 * 5772, the same pid the `$TMUX` tuple carries, while `#{server_pid}` returns an empty string.
 * Pinned as one literal so the LIVE inspector and its deterministic oracle cannot drift apart.
 */
export const TMUX_COORDINATE_FORMAT = "#{pid}\t#{session_id}\t#{window_id}\t#{pane_id}";
export const TMUX_COORDINATE_FIELDS = 4;
