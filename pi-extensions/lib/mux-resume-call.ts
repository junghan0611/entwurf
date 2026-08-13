/**
 * mux-resume-call — open ONE window in the caller's own tmux session at a cwd this module did
 * not choose, and hand it argv this module did not author.
 *
 * ── Why this is a module and not a parameter on fresh-call ──
 *
 * `mux-fresh-call` carries a TASK to a runtime it names, and starts the sibling wherever the
 * caller happens to be unless the caller REQUESTS one literal start directory (#73). A resume
 * carries neither a task nor a caller choice: the argv comes from the record (`entwurf-v2-
 * visible-resume` builds it) and the cwd comes from the record too — it is the directory the
 * citizen's own transcript header remembers, never something the caller picks. Those are
 * different inputs with a different risk, so they get a different module rather than a fourth
 * parameter on a composition whose contract is "identity is an OUTPUT".
 *
 *   visible-resume composition → resume-call → placement leaf (unchanged, carrier-free)
 *   resume-call               -X-> garden identity, records, locks, delivery
 *
 * This module never learns which citizen it is reopening. It sees a cwd and an argv tail.
 *
 * ── The cwd is the whole reason this module owns its own tmux argv ──
 *
 * `mux-placement`'s `buildAppendArgs` deliberately emits no `-c` ("default shell only"), and it
 * stays that way — a resume must not widen the leaf's grammar for the three other callers. So
 * the `-c` SHAPE lives here, while the classification of the value lives in the shared
 * `classify-tmux-cwd.ts` leaf (fresh-call hands tmux the same flag, and a twin copy of the
 * measured rules would rot apart on the next tmux hazard). The measured tmux 3.6a facts —
 * a nonexistent `-c` silently lands the child in `$HOME`, `#` is format-expanded, whitespace
 * is safe — are documented on that leaf. `|` is fine too: the cwd never enters the `-F` row
 * (see `APPEND_FORMAT` below).
 *
 * What stays HERE is the phrasing: this module's hints say "recorded cwd", because a resume's
 * directory comes from the record — fresh-call's say "requested cwd" for the same reasons.
 *
 * ── What the receipt does NOT say ──
 *
 * The handle carries the shared `APPEND_FORMAT` fields only — native ids and decimals. The cwd
 * is reported as what tmux was ASKED for, exactly as `runtimePath` is: `-P -F` prints its row
 * BEFORE the child has chdir'd (measured — `#{pane_current_path}` in that row still reports the
 * client's cwd), so a start-path field there would be a free-form path that is also racy. Proving
 * where the pane actually landed is a separate query against the stable pane id, and it belongs
 * to acceptance, not to the product's launch receipt.
 */

import { classifyTmuxCwd, type TmuxCwdRejectReason } from "./classify-tmux-cwd.ts";
import {
	assertLaunchTarget,
	LaunchPreconditionError,
	type LaunchRejectReason,
	resolveRuntimeOnPath,
} from "./mux-launch.ts";
import {
	APPEND_FORMAT,
	assertSelector,
	assertTmuxOk,
	inspectPlacement,
	type Placement,
	type PlacementRejectReason,
	parseWindowFields,
	requireSameContext,
	runTmux,
	type WindowHandle,
} from "./mux-placement.ts";

/** The fixed runtime a resume reopens. Only pi stands a control socket up, so only pi has a
 * same-id resume at all — the backend boundary is enforced upstream by
 * `resolveResumeLaunchIdentity`, and this constant is the mux half of the same fact. */
export const RESUME_CALL_RUNTIME = "pi";

/** Why a resume window could not be opened. Every value is a NAMED refusal; this module has no
 * fallback launch and no fallback directory. The cwd members come from the shared classification
 * leaf and their string values are stable contract. */
export type ResumeCallRejectReason = PlacementRejectReason | LaunchRejectReason | TmuxCwdRejectReason;

/** Coordinates plus what was handed to tmux. `cwd` is the REQUESTED start directory — the same
 * kind of fact as `runtimePath`, namely what tmux was asked for, not an observation. */
export interface ResumeCallReceipt extends WindowHandle {
	runtimePath: string;
	cwd: string;
}

export type ResumeCallResult = { ok: true; receipt: ResumeCallReceipt } | { ok: false; reason: ResumeCallRejectReason };

/**
 * Launch argv: the leaf's detached-append shape plus `-c`, the runtime, then the caller's flags.
 * `--` is what keeps tmux from reading the runtime or its flags as tmux options.
 */
export function buildResumeCallArgs(
	placement: Placement,
	cwd: string,
	runtimePath: string,
	runtimeArgs: readonly string[],
): string[] {
	assertSelector("session", placement.sessionId);
	assertLaunchTarget(runtimePath);
	const bad = classifyTmuxCwd(cwd);
	if (bad) throw new Error(`mux-resume-call: refusing to build argv with an unusable cwd (${bad}): ${cwd}`);
	return [
		"new-window",
		"-d",
		"-a",
		"-t",
		`${placement.sessionId}:{end}`,
		"-c",
		cwd,
		"-P",
		"-F",
		APPEND_FORMAT,
		"--",
		runtimePath,
		...runtimeArgs,
	];
}

/**
 * Open the window. Order is the safety argument, same as `freshCall`: classify the cwd, resolve
 * and prove the runtime, re-read the caller's placement and refuse a changed context — and only
 * then mutate. Nothing above can leave a window behind.
 *
 * `runtimeArgs` is passed through untouched. This module does not know what `--session` means.
 */
export function resumeCall(
	params: { cwd: string; runtimeArgs: readonly string[] },
	env: NodeJS.ProcessEnv = process.env,
): ResumeCallResult {
	const badCwd = classifyTmuxCwd(params.cwd);
	if (badCwd) return { ok: false, reason: badCwd };

	let runtimePath: string;
	try {
		runtimePath = resolveRuntimeOnPath(RESUME_CALL_RUNTIME, env);
	} catch (err) {
		if (err instanceof LaunchPreconditionError) return { ok: false, reason: err.reason };
		throw err;
	}

	const inspected = inspectPlacement(env);
	if (!inspected.ok) return { ok: false, reason: inspected.reason };
	const placement = inspected.placement;
	requireSameContext("resumeCall", placement, env);

	const run = runTmux(buildResumeCallArgs(placement, params.cwd, runtimePath, params.runtimeArgs), env);
	assertTmuxOk("new-window", run);

	let fields: ReturnType<typeof parseWindowFields>;
	try {
		fields = parseWindowFields(run.stdout);
	} catch (err) {
		// The window exists and its id is precisely what could not be read. Diffing the inventory
		// to find "the new one" is the guess this rail forbids everywhere else, so name the orphan.
		throw new Error(
			`mux-resume-call: launched ${runtimePath} but could not read the window handle tmux printed — a window may ` +
				`be open in session ${placement.sessionId} that this call cannot identify or close: ${
					err instanceof Error ? err.message : String(err)
				}`,
		);
	}

	return {
		ok: true,
		receipt: {
			serverPid: placement.serverPid,
			sessionId: placement.sessionId,
			...fields,
			runtimePath,
			cwd: params.cwd,
		},
	};
}

/** Why each refusal happened, in the caller's terms. A reason a caller cannot act on is a reason
 * they will guess about. */
export const RESUME_CALL_REJECT_HINT: Record<ResumeCallRejectReason, string> = {
	"no-tmux-context": "this agent is not running inside tmux, so there is no session to reopen the citizen in",
	"anchor-malformed": "TMUX_PANE is not a native pane id",
	"anchor-unresolved": "tmux resolved no pane for this agent's anchor",
	"anchor-mismatch": "tmux answered about a different pane than the one asked about",
	"cwd-not-absolute": "the recorded cwd is not an absolute path",
	"cwd-format-token":
		"the recorded cwd contains '#', which tmux expands as a format inside -c — it would silently rewrite the path or run a command",
	"cwd-missing":
		"the recorded cwd no longer exists; tmux would not report this, it would open the window in $HOME and look successful",
	"cwd-not-directory": "the recorded cwd exists but is not a directory",
	"runtime-unresolved": "pi is not installed on PATH",
	"runtime-not-absolute": "the resolved runtime path is not absolute",
	"runtime-path-whitespace": "the resolved runtime path contains whitespace, which tmux would re-split",
	"runtime-missing": "nothing exists at the resolved runtime path",
	"runtime-not-regular-file": "the resolved runtime path is not a regular file",
	"runtime-not-executable": "the resolved runtime path is not executable",
};
