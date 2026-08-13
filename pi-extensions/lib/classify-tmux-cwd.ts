/**
 * classify-tmux-cwd — the ONE classification of a start directory that is about to be handed
 * to tmux as a `-c` value. Shared leaf of the resume and fresh launch compositions; it owns
 * the classification and NOTHING else — no hints (each consumer phrases its own: resume says
 * "recorded cwd", fresh says "requested cwd"), no argv, no tmux, no fallback directory.
 *
 * Every rule below is a MEASURED tmux 3.6a behaviour (2026-08-06, private server), and each
 * one is a way a launch would look successful while being wrong:
 *
 *   1. a NONEXISTENT `-c` is silent. tmux exits 0, opens the window, and the child falls back
 *      to `$HOME`. A launch whose directory has been deleted would therefore open a visible
 *      window in the wrong project and look successful. Nothing downstream can catch that:
 *      the launch receipt would be perfectly well-formed.
 *   2. `-c` is FORMAT-EXPANDED. `#{pane_id}` inside the value silently rewrote the path
 *      (`<dir>/#{pane_id}` → `<dir>/%0`), and a `#(…)` value was observed running its
 *      command. A path is data; tmux reads it as a format. So `#` is refused outright.
 *   3. whitespace is SAFE — argv is an array and nothing re-splits. A dir named `with space`
 *      arrived intact. So there is no quoting grammar here, and none is owed.
 *
 * That is the entire defence: one existence check and one character. No escaping layer, no
 * sanitiser, no trim, no realpath/symlink policy — a symlinked project dir is a normal thing
 * to work in, and a value is classified exactly as given.
 */

import { statSync } from "node:fs";
import path from "node:path";

/** Why a candidate `-c` value was refused. Four stable literals — both consuming
 * compositions widen their own reject unions with this type, so the strings are contract. */
export type TmuxCwdRejectReason = "cwd-not-absolute" | "cwd-format-token" | "cwd-missing" | "cwd-not-directory";

/**
 * Classify a candidate start directory. Split into separate reasons rather than one because
 * the operator's next move differs: an absolute-path bug is a caller defect, a missing
 * directory is a moved/deleted project, and a `#` is a path tmux would rewrite under us.
 */
export function classifyTmuxCwd(cwd: string): TmuxCwdRejectReason | null {
	if (!path.isAbsolute(cwd)) return "cwd-not-absolute";
	// tmux expands formats inside the `-c` VALUE. `#{…}` rewrote the path silently and `#(…)`
	// was observed executing; neither is something to escape our way out of.
	if (cwd.includes("#")) return "cwd-format-token";
	let st: ReturnType<typeof statSync>;
	try {
		st = statSync(cwd);
	} catch {
		// tmux would NOT report this — it opens the window and lands the child in $HOME.
		return "cwd-missing";
	}
	return st.isDirectory() ? null : "cwd-not-directory";
}
