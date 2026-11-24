/**
 * resume-cli — the operator's terminal entry to the same-id visible resume (#173): `entwurf resume
 * <garden-id>`.
 *
 * ONE LEAF, TWO ENTRIES. The MCP verb `entwurf_resume_call` and this command make the SAME three
 * calls — `visibleResume(target, makeVisibleResumeDeps(visibleResumeLaunch))`, then
 * `renderVisibleResume(result, { actor })` — and differ in one value: a human at a terminal has no
 * record-backed garden identity, so `actor` is null here. Null is attribution, not a refusal: the
 * receipt says `unattributed` and the verb decides from the target's record and live rail facts
 * alone, exactly as it does for an agent.
 *
 * WHAT THIS MODULE MUST NOT GROW. No second address grammar (the leaf's `target-invalid` is the one
 * answer to a malformed id, so the argv string reaches it untouched), no liveness question, no
 * record read, no launcher and no rail choice of its own. A live target, an unsupported backend and
 * an inconclusive owner end in the leaf's refusal; this entry never turns one into a send, a focus
 * or a fresh session. It submits no prompt because the leaf has no prompt input to hand one to.
 *
 * WHAT THIS MODULE OWNS: the argv shape, the order of the questions, which stream carries the text,
 * and the exit code. The exit code is read from the STRUCTURED result, never from the rendered
 * words, so a change of wording cannot move it.
 *
 * ORDER (the first that applies wins):
 *   1. argv is not exactly one garden id            → usage, exit 2
 *   2. this terminal has no launch context          → refused early, exit 4
 *   3. the leaf
 * Step 2 exists because the leaf answers "no tmux here" LAST — after the record read, the lock, the
 * liveness question and, for pi-durable, a reservation it must then withdraw. A human in a bare
 * terminal should hear it first, with nothing read, locked, reserved or launched. It asks only the
 * two questions the rails already ask, through their own predicates: `selectFreshCallRail(env)`
 * (inside herdr no tmux variable is required) and `readAnchor(env)` (both TMUX and TMUX_PANE). It is
 * an environment check, not evidence that the tmux session exists or that herdr is ready; the leaf
 * and its launcher still decide that, and may still refuse.
 *
 * EXIT CONTRACT:
 *   0 — launched, and the backend's own observation of the SAME garden id was positive. What that
 *       observation is differs by backend and is no more than this: pi — the control socket accepted
 *       a connection; Claude Code — a new owner in the opened pane re-armed the receiver marker;
 *       pi-durable — a child adopted this call's reservation (an adoption write, not readiness,
 *       liveness or recall). The receipt text names which one was seen.
 *   3 — launched, and that observation was not positive in the bounded wait (or could not be read).
 *       A window or tab was opened and stays visible; nothing was retried and nothing was closed.
 *   4 — refused: nothing was opened. The text names the reason — the leaf's, or the early
 *       launch-context one (`no-tmux-context` / `anchor-malformed`), after which nothing ran at all.
 *   5 — failed AT THE LAUNCH STEP. What was created and what remains is the recovery receipt in the
 *       text (none / unknown / closed / orphan-unreclaimed), and only that: a `none` recovery is not
 *       re-typed as a refusal here, and an `unknown` one is not rounded to either side.
 *   2 — usage: argv is not exactly one non-option argument. Nothing ran.
 *   1 — the leaf THREW instead of answering: its cause-rich record errors (no record for that id,
 *       a foreign or deleted transcript, no recorded model, an unreleased lock) are deliberately not
 *       re-typed into refusals there, and this entry does not classify them either. The message is
 *       printed as the leaf wrote it; whether anything was opened is whatever that message says.
 * A refusal and an unobserved launch are deliberately apart: only one of them left a window behind.
 */

import { ENTWURF_RESUME_LAUNCH_REJECT_HINTS } from "./agent-guidance.ts";
import {
	makeVisibleResumeDeps,
	renderVisibleResume,
	type VisibleResumeResult,
	visibleResume,
} from "./entwurf-v2-visible-resume.ts";
import { selectFreshCallRail } from "./fresh-call-dispatch.ts";
import { readAnchor } from "./mux-placement.ts";
import { visibleResumeLaunch } from "./visible-resume-launch.ts";

export const RESUME_CLI_EXIT = {
	resumed: 0,
	crashed: 1,
	usage: 2,
	unobserved: 3,
	refused: 4,
	launchFailed: 5,
} as const;

export type ResumeCliExitCode = (typeof RESUME_CLI_EXIT)[keyof typeof RESUME_CLI_EXIT];

/** The positive observation of each backend (pi / Claude Code / pi-durable, in that order). Every
 * other kind — and any kind added later — is not one, so an unknown observation can never exit 0. */
const OBSERVED_BACK: ReadonlySet<string> = new Set(["socket-alive", "receiver-armed", "adopted"]);

export function resumeCliExitCode(result: VisibleResumeResult): ResumeCliExitCode {
	if (result.ok) {
		return OBSERVED_BACK.has(result.observation.kind) ? RESUME_CLI_EXIT.resumed : RESUME_CLI_EXIT.unobserved;
	}
	return result.reason === "launch-failed" ? RESUME_CLI_EXIT.launchFailed : RESUME_CLI_EXIT.refused;
}

/** The seams: how a garden id becomes a resume result (production is the leaf itself), and the
 * environment the launch-context question is asked of (production is this process's own). */
export interface ResumeCliDeps {
	resume: (target: string) => Promise<VisibleResumeResult>;
	env: NodeJS.ProcessEnv;
}

/** The same leaf through the same launcher the MCP verb uses — the call both entries share. */
export function productionResumeCliDeps(): ResumeCliDeps {
	return {
		resume: (target) => visibleResume(target, makeVisibleResumeDeps(visibleResumeLaunch)),
		env: process.env,
	};
}

export type ResumeLaunchContextRefusal = "no-tmux-context" | "anchor-malformed";

/**
 * Can this terminal be the place a resume opens beside? Null when it can. The two existing
 * predicates only, in the rail root's own order: inside herdr the tmux anchor is never asked for.
 */
export function resumeLaunchContextRefusal(env: NodeJS.ProcessEnv): ResumeLaunchContextRefusal | null {
	if (selectFreshCallRail(env) === "herdr") return null;
	const anchor = readAnchor(env);
	return anchor.ok ? null : anchor.reason;
}

/** The early answer: same reason names and hint text the launch leaf would give at the very end. */
export function renderResumeLaunchContextRefusal(reason: ResumeLaunchContextRefusal): string {
	return (
		`entwurf resume refused: ${reason} — ${ENTWURF_RESUME_LAUNCH_REJECT_HINTS[reason]}. ` +
		`Nothing was read, locked or opened.`
	);
}

export interface ResumeCliOutcome {
	exitCode: ResumeCliExitCode;
	stdout: string;
	stderr: string;
}

export const RESUME_CLI_USAGE =
	"entwurf resume: takes exactly one garden id — see `entwurf help resume` (from a checkout's root: `./run.sh help resume`)";

/**
 * Reopen exactly the citizen `target` names and report it. The string is handed to the leaf as
 * given: every entry that ends in a resume — the direct id here, and a selection made in a list —
 * goes through this one function, so no entry can reopen a citizen the other would not.
 */
export async function resumeByGardenId(target: string, deps: ResumeCliDeps): Promise<ResumeCliOutcome> {
	const result = await deps.resume(target);
	// A terminal operator has no record-backed identity to attribute: null, never a made-up id.
	const rendered = renderVisibleResume(result, { actor: null });
	const exitCode = resumeCliExitCode(result);
	const text = `${rendered.text}\n`;
	// A receipt is the command's product (stdout); a refusal or a failed launch is a diagnostic.
	return result.ok ? { exitCode, stdout: text, stderr: "" } : { exitCode, stdout: "", stderr: text };
}

/** argv → outcome. `argv` is what follows `resume` on the command line. */
export async function runResumeCli(argv: readonly string[], deps: ResumeCliDeps): Promise<ResumeCliOutcome> {
	const target = argv[0];
	// Exactly one non-option argument. A dash word is a flag this command does not have, never a
	// garden id to look up.
	if (argv.length !== 1 || target === undefined || target.startsWith("-")) {
		return { exitCode: RESUME_CLI_EXIT.usage, stdout: "", stderr: `${RESUME_CLI_USAGE}\n` };
	}
	const refusal = resumeLaunchContextRefusal(deps.env);
	if (refusal !== null) {
		return {
			exitCode: RESUME_CLI_EXIT.refused,
			stdout: "",
			stderr: `${renderResumeLaunchContextRefusal(refusal)}\n`,
		};
	}
	try {
		return await resumeByGardenId(target, deps);
	} catch (err) {
		// Same shape as the MCP entry's catch: the leaf's own message, unclassified and unshortened.
		return {
			exitCode: RESUME_CLI_EXIT.crashed,
			stdout: "",
			stderr: `entwurf resume error: ${err instanceof Error ? err.message : String(err)}\n`,
		};
	}
}
