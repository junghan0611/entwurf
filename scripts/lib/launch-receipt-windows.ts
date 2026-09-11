/**
 * The one parser that turns a LAUNCH receipt back into the tmux window handle it named.
 *
 * It exists for ONE job: when a travelling receipt never arrives, the visible window a
 * sibling opened would be orphaned, because cleanup only ever kills handles the smoke
 * recorded. The handle is still written down — in the caller's own transcript and in the
 * Codex thread's own tool-call result — so recovery reads it from there instead of
 * scanning tmux inventory or guessing.
 *
 * WHY THIS IS LINE-ORIENTED AND NOT A CHARACTER WINDOW. `renderFreshCall` writes one block
 * whose `backend:` and `window:` lines are separated by a VARIABLE number of optional lines
 * (cwd, seat). A character bound between them is a guess about how long those lines are, and
 * the guess was already nearly spent: `[측정]` a rendered receipt carrying both cwd and seat
 * spans 344 escaped characters, against the 400-character bound this replaced. A longer
 * project path would have silently recovered NOTHING. The boundary here is the receipt's own
 * line structure, which does not have a length.
 *
 * Transcripts and tool results carry the receipt JSON-escaped, so a line ends at a real
 * newline OR at a literal backslash-n. Both are separators.
 *
 * It stays anchored on the receipt: a `window:` line with no `backend:` line before it is
 * not a window this run opened, and a receipt for the OTHER backend is never mistaken for
 * this one's.
 */
const LINE = /\r?\n|\\n/;
const BACKEND_LINE = /^\s*backend:\s+([a-z-]+)\b/;
const WINDOW_LINE = /^\s*window:\s+(@\d+)\b/;

export function launchReceiptWindows(text: string, backend: string): string[] {
	const found: string[] = [];
	let open: string | null = null;
	for (const line of text.split(LINE)) {
		const backendLine = BACKEND_LINE.exec(line);
		if (backendLine !== null) {
			open = backendLine[1] ?? null;
			continue;
		}
		const windowLine = WINDOW_LINE.exec(line);
		if (windowLine === null) continue;
		if (open === backend) found.push(windowLine[1] as string);
		// One receipt names one window: close the block so a later stray line cannot inherit
		// this backend.
		open = null;
	}
	return found;
}
