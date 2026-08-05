/**
 * mux-launch — T1-a: open ONE visible window in the caller's own tmux session and start the
 * fixed official `pi` in it. Nothing after that.
 *
 * This is deliberately a SECOND module rather than a fourth verb on `mux-placement`. The
 * placement leaf owns place and only place (`docs/mux-launch-rail.md` §11): a command
 * parameter there would be the carrier that leaf refuses to have, and the deterministic gate
 * pins `appendWindow`'s argv as exactly the no-carrier shape. So the composition lives here,
 * on top of the leaf's grammar, binding and failure discipline, and the leaf stays deletable.
 *
 * The import lines this module must never cross (docs §11, asserted by check-mux-launch):
 *
 *   entwurf-v2 contract/decider/runner/production  -X-> mux-launch
 *   mux-launch                                     -X-> entwurf core
 *
 * T1-a is launch, NOT delegation. This module does not wait for a garden identity, does not
 * read the meta-record store, does not send a task, and has no idea what `entwurf_v2` is.
 * The separate fresh-call composition reuses its precondition helpers but owns first-turn
 * framing and callback correlation itself — see `docs/mux-launch-rail.md` §6-a and §11.
 *
 * ── What the receipt means, and what it deliberately does NOT ──
 *
 * A `PiLaunch` states two things: the ids tmux reported when it created the window, and the
 * absolute runtime path we handed it. It does NOT claim pi is running.
 *
 * That restraint is measured, not modest. `new-window … -- /nonexistent/bin/nope` exits 0,
 * prints a perfectly well-formed handle, and the window is STILL LISTED on an immediate
 * re-read — 10/10 trials on tmux 3.6a, indistinguishable from a good launch at that instant.
 * The window dies milliseconds later, through the same `remain-on-exit off` path
 * `CloseOutcome.already-gone` already describes. So a post-launch presence check would prove
 * nothing while making the receipt LOOK verified, which is worse than not checking: it is the
 * rc=0 trap of T0-a wearing a different hat. This module refuses to perform one.
 *
 * What can honestly be done is to delete the failure class BEFORE a window exists, and that
 * is what `assertLaunchTarget` does — the same precondition discipline
 * `scripts/lib/probe-cli-target.ts` applies to the ACP CLI target: absolute, present, regular
 * file, executable. A refusal is a NAMED reason on an unopened window, never a fallback.
 *
 * ── Cleanup, and why the contract is thin by construction ──
 *
 * There is exactly ONE mutation in this module: a single `new-window`. Everything after it is
 * pure parsing. That is the cleanup design — not a compensating transaction, but a shape with
 * almost nothing to compensate. The one residue: if tmux reports a handle this module cannot
 * parse, the window exists and its id is precisely the thing we failed to read, so there is no
 * honest target to close. That case fails loud and NAMES the orphan rather than killing a
 * window picked by inventory diffing, which is the guess this rail forbids everywhere else.
 *
 * ── The whitespace precondition is not hygiene ──
 *
 * Measured on tmux 3.6a: a single argv element containing a space is RE-SPLIT by tmux, so a
 * runtime at `/tmp/x y/pi` is launched as `/tmp/x` with the argument `y/pi` and the window
 * dies instantly. `--` stops tmux from running the target through a shell (verified: an
 * argument of `x; touch <file>` created no file), but it does not stop that re-split. So the
 * path is checked for whitespace before it is handed over.
 */

import { accessSync, constants as fsConstants, statSync } from "node:fs";
import { delimiter, isAbsolute, join } from "node:path";
import {
	APPEND_FORMAT,
	assertSelector,
	assertTmuxOk,
	type Placement,
	parseWindowFields,
	requireSameContext,
	runTmux,
	type WindowHandle,
} from "./mux-placement.ts";

/** The official runtime this rail opens. FIXED: there is no command carrier, and adding one
 * is a separate ownership decision (docs §11), not a parameter. */
export const PI_RUNTIME_COMMAND = "pi";

/**
 * Why a launch was refused BEFORE any window was opened. Each is a named refusal, never a
 * fallback — a caller that cannot start the official runtime must not be handed a window.
 *
 *   `runtime-unresolved`        no `PI_RUNTIME_COMMAND` on PATH (or no usable PATH)
 *   `runtime-not-absolute`      a relative target would resolve against the pane's cwd
 *   `runtime-path-whitespace`   tmux re-splits a spaced argv element (measured)
 *   `runtime-missing`           nothing at that path
 *   `runtime-not-regular-file`  a directory/special file cannot be the runtime
 *   `runtime-not-executable`    exec would fail after the window already existed
 */
export type LaunchRejectReason =
	| "runtime-unresolved"
	| "runtime-not-absolute"
	| "runtime-path-whitespace"
	| "runtime-missing"
	| "runtime-not-regular-file"
	| "runtime-not-executable";

/** A named precondition failure. Callers surface `reason`; they never soften it into a
 * fallback launch of something else. */
export class LaunchPreconditionError extends Error {
	readonly reason: LaunchRejectReason;
	constructor(reason: LaunchRejectReason, message: string) {
		super(message);
		this.name = "LaunchPreconditionError";
		this.reason = reason;
	}
}

/** Any ASCII or Unicode whitespace — the tmux re-split hazard is about the space character,
 * but a tab or newline in an argv element is no more launchable and no less a surprise. */
const WHITESPACE = /\s/;

/**
 * The five preconditions, in the order a failure would otherwise bite. Absolute first
 * (everything after it is meaningless for a relative path), whitespace before the filesystem
 * questions (a re-split path's stat is about the wrong file), then present → regular →
 * executable, exactly as `probe-cli-target.ts` orders them.
 */
export function assertLaunchTarget(runtimePath: string): void {
	if (!isAbsolute(runtimePath)) {
		throw new LaunchPreconditionError(
			"runtime-not-absolute",
			`mux-launch: runtime target ${JSON.stringify(runtimePath)} is not absolute — tmux would resolve it against ` +
				"the new pane's cwd, so which binary started would depend on where the window happened to open",
		);
	}
	if (WHITESPACE.test(runtimePath)) {
		throw new LaunchPreconditionError(
			"runtime-path-whitespace",
			`mux-launch: runtime target ${JSON.stringify(runtimePath)} contains whitespace — tmux RE-SPLITS a single ` +
				"argv element on spaces (measured, 3.6a), so this would launch a truncated path with the remainder as " +
				"an argument and the window would die instantly",
		);
	}
	let stat: ReturnType<typeof statSync>;
	try {
		stat = statSync(runtimePath);
	} catch {
		throw new LaunchPreconditionError(
			"runtime-missing",
			`mux-launch: runtime target ${runtimePath} does not exist — refusing before a window is opened onto a ` +
				"runtime that cannot start",
		);
	}
	if (!stat.isFile()) {
		throw new LaunchPreconditionError(
			"runtime-not-regular-file",
			`mux-launch: runtime target ${runtimePath} is not a regular file — a directory or special file cannot be ` +
				"the official runtime",
		);
	}
	try {
		accessSync(runtimePath, fsConstants.X_OK);
	} catch {
		throw new LaunchPreconditionError(
			"runtime-not-executable",
			`mux-launch: runtime target ${runtimePath} is not executable (X_OK) — exec would fail after the window ` +
				"already existed, which is exactly the state this precondition exists to prevent",
		);
	}
}

/**
 * Find the official runtime on the caller's PATH and prove it launchable.
 *
 * PATH rather than a compiled-in location because the official `pi` is whatever the operator's
 * environment resolves — pinning a path here would silently launch a different install than
 * the one the operator gets by typing `pi`. Resolving it to an ABSOLUTE path (rather than
 * handing tmux the bare word) is what makes the preconditions mean anything: a bare `pi`
 * would be re-resolved inside the pane, after the window exists, against an environment this
 * module never checked.
 *
 * Empty PATH entries are skipped rather than treated as cwd — the historical POSIX reading of
 * `::` is a cwd search, and a launch that depends on where the caller stood is the drift this
 * rail refuses.
 */
export function resolveRuntimeOnPath(command: string, env: NodeJS.ProcessEnv = process.env): string {
	const raw = env.PATH;
	const entries = typeof raw === "string" ? raw.split(delimiter).filter((p) => p.length > 0) : [];
	for (const dir of entries) {
		if (!isAbsolute(dir)) continue;
		const candidate = join(dir, command);
		try {
			if (!statSync(candidate).isFile()) continue;
			accessSync(candidate, fsConstants.X_OK);
		} catch {
			continue;
		}
		assertLaunchTarget(candidate);
		return candidate;
	}
	throw new LaunchPreconditionError(
		"runtime-unresolved",
		`mux-launch: no executable ${JSON.stringify(command)} on PATH — refusing to open a window for a ` +
			"runtime that is not installed",
	);
}

/**
 * T1-a's own resolution: the fixed official `pi`. Kept as a named function rather than a call
 * site with a constant because the launch contract is "this rail opens `pi`", and a caller that
 * could pass a command would be the carrier this module refuses to have (docs §11). The
 * generic form above exists only so a SEPARATE composition can apply the SAME preconditions to
 * its own fixed runtime — not so this one becomes parameterised.
 */
export function resolvePiRuntime(env: NodeJS.ProcessEnv = process.env): string {
	return resolveRuntimeOnPath(PI_RUNTIME_COMMAND, env);
}

/**
 * The launch argv. Identical to the leaf's append shape — detached, appended at `{end}`,
 * addressed by session id, printing the same handle format — with exactly one addition: the
 * fixed runtime after `--`.
 *
 * `-d` is kept. "Visible" in T1-a means the window is a real window in the operator's own
 * session rather than a headless child; it does not mean stealing the caller's focus. Moving
 * focus is a different verb with a different owner, and the leaf's acceptance already pins
 * "focus unchanged" as a property worth having.
 *
 * `--` is what stops tmux from handing the target to a shell (measured: an argument of
 * `x; touch <file>` created no file). The selector and the runtime are both validated before
 * this returns, so nothing unvalidated ever reaches tmux's parser.
 */
export function buildLaunchArgs(sessionId: string, runtimePath: string): string[] {
	assertSelector("session", sessionId);
	assertLaunchTarget(runtimePath);
	return ["new-window", "-d", "-a", "-t", `${sessionId}:{end}`, "-P", "-F", APPEND_FORMAT, "--", runtimePath];
}

/**
 * What T1-a returns: the window handle tmux reported, plus the runtime path that was handed
 * to it. `panePid` is the launched process itself — measured: with `--`, tmux execs the target
 * directly and no shell wrapper survives in the pane.
 *
 * Read `runtimePath` as "what we asked tmux to start", not "what is running". See the module
 * header: no synchronous check can tell those apart, so this type does not pretend to.
 */
export interface PiLaunch extends WindowHandle {
	runtimePath: string;
}

/**
 * Open one window in the caller's own session and start the fixed official `pi` in it.
 *
 * Order matters and is the whole safety argument: resolve and prove the runtime FIRST, then
 * re-read the caller's placement and refuse a changed context (the leaf's binding), and only
 * then mutate. A precondition failure therefore never leaves a window behind, because no
 * window has been opened yet.
 *
 * Responsibility ends at the returned ids. No identity, no delivery, no supervision.
 */
export function launchPi(placement: Placement, env: NodeJS.ProcessEnv = process.env): PiLaunch {
	const runtimePath = resolvePiRuntime(env);
	requireSameContext("launchPi", placement, env);
	const run = runTmux(buildLaunchArgs(placement.sessionId, runtimePath), env);
	assertTmuxOk("new-window", run);
	let fields: ReturnType<typeof parseWindowFields>;
	try {
		fields = parseWindowFields(run.stdout);
	} catch (err) {
		// The window exists and its id is exactly what we failed to read. Diffing the inventory
		// to find "the new one" is the guess this rail forbids, so name the orphan instead of
		// killing a window chosen by inference.
		throw new Error(
			`mux-launch: launched ${runtimePath} but could not read the window handle tmux printed — a window may be ` +
				`open in session ${placement.sessionId} that this call cannot identify or close: ${
					err instanceof Error ? err.message : String(err)
				}`,
		);
	}
	return { serverPid: placement.serverPid, sessionId: placement.sessionId, ...fields, runtimePath };
}
