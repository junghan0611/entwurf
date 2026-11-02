/**
 * mux-resume-call — open ONE window in the caller's own tmux session at a cwd this module did
 * not choose, start the backend's FIXED runtime there, and hand it argv this module did not author.
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
 * This module never learns which citizen it is reopening. It sees a backend, a cwd and an argv
 * tail; the backend only selects a runtime from a closed table (#147 L2).
 *
 * ── Tmux only, and said so inside herdr ──
 *
 * This is the tmux rail. A caller inside herdr (`HERDR_ENV=1`, herdr's own marker, read for its
 * exact value as `fresh-call-dispatch` does) is refused by name before anything else: herdr owns
 * placement there, and an ambient `TMUX` that happens to be set would otherwise put the window in
 * a session the operator is not looking at. Since #157 G1a the shared rail root (`fresh-call-dispatch`)
 * hands a resume inside herdr to the separate herdr rail (`herdr-resume-call.ts`) and never reaches
 * this leaf there;
 * this guard stays so that a direct caller still cannot open a tmux window from inside herdr. No
 * fallback in either direction.
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

import { ENTWURF_RESUME_LAUNCH_REJECT_HINTS } from "./agent-guidance.ts";
import { classifyTmuxCwd, type TmuxCwdRejectReason } from "./classify-tmux-cwd.ts";
import {
	assertLaunchTarget,
	LaunchPreconditionError,
	type LaunchRejectReason,
	resolveRuntimeOnPath,
	SCRUBBED_INHERITED_ENV,
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

/** The fixed runtime each resumable backend reopens with. A closed table, not a command input: the
 * backend boundary is enforced upstream by `resolveResumeLaunchIdentity`, and this is the mux half
 * of the same fact. */
export const RESUME_CALL_RUNTIME = { pi: "pi", "claude-code": "claude" } as const;
export type ResumeCallBackend = keyof typeof RESUME_CALL_RUNTIME;

/**
 * #157 B3: a pi-durable resume reopens through the MANAGED verb, exactly as its fresh call does —
 * `entwurf pi-durable` verifies this package's carrier and its SDK set before anything runs, and the
 * durable app is never started bare. It is its own entry (`resumePiDurableCall`) rather than a row of
 * the table above, because it is the one resume whose launch also carries an environment.
 */
export const RESUME_CALL_PI_DURABLE_RUNTIME = "entwurf";

/**
 * The pi-durable adopt launch projection (#157 B3, L3-A1 §1): EXACTLY these five names, each read by
 * name and emitted in this order — the SDK's own profile input, and the standard children of ONE meta
 * root. It is a fixed projection of two coordinates the caller derived, not an environment dictionary:
 * no other name can be expressed through it. The launched child checks the four roots it actually
 * received against its closed adopt context, and its raw profile against the reservation, before
 * anything opens, so a value this module mangled would refuse there rather than open something else.
 */
export interface ResumeCallPiDurableAdoptEnv {
	readonly PI_CODING_AGENT_DIR: string;
	readonly ENTWURF_META_SESSIONS_DIR: string;
	readonly ENTWURF_META_MAILBOX_DIR: string;
	readonly ENTWURF_META_SENDERS_DIR: string;
	readonly ENTWURF_META_RECEIVERS_DIR: string;
}

/** The five `NAME=value` assignments, in the fixed order, or none. Every value must be an absolute
 * path: a relative one would resolve against whatever directory the child starts in. */
function adoptEnvAssignments(adoptEnv: ResumeCallPiDurableAdoptEnv | undefined): string[] {
	if (adoptEnv === undefined) return [];
	const pairs: readonly (readonly [string, string])[] = [
		["PI_CODING_AGENT_DIR", adoptEnv.PI_CODING_AGENT_DIR],
		["ENTWURF_META_SESSIONS_DIR", adoptEnv.ENTWURF_META_SESSIONS_DIR],
		["ENTWURF_META_MAILBOX_DIR", adoptEnv.ENTWURF_META_MAILBOX_DIR],
		["ENTWURF_META_SENDERS_DIR", adoptEnv.ENTWURF_META_SENDERS_DIR],
		["ENTWURF_META_RECEIVERS_DIR", adoptEnv.ENTWURF_META_RECEIVERS_DIR],
	];
	for (const [name, value] of pairs) {
		if (typeof value !== "string" || !value.startsWith("/")) {
			throw new Error(`mux-resume-call: refusing to build argv with a non-absolute ${name}: ${JSON.stringify(value)}`);
		}
	}
	return pairs.map(([name, value]) => `${name}=${value}`);
}

/** Why a resume window could not be opened. Every value is a NAMED refusal; this module has no
 * fallback launch and no fallback directory. The cwd members come from the shared classification
 * leaf and their string values are stable contract. */
export type ResumeCallRejectReason =
	| PlacementRejectReason
	| LaunchRejectReason
	| TmuxCwdRejectReason
	| "herdr-resume-unsupported";

/** Coordinates plus what was handed to tmux. `cwd` is the REQUESTED start directory — the same
 * kind of fact as `runtimePath`, namely what tmux was asked for, not an observation. */
export interface ResumeCallReceipt extends WindowHandle {
	runtimePath: string;
	cwd: string;
}

export type ResumeCallResult = { ok: true; receipt: ResumeCallReceipt } | { ok: false; reason: ResumeCallRejectReason };

/**
 * Launch argv: the leaf's detached-append shape, the fixed identity scrub (`SCRUBBED_INHERITED_ENV`,
 * the same two assignments every fresh window carries), for a pi-durable adoption the five fixed
 * projection assignments after it (#157 B3), `-c`, the runtime, then the caller's flags.
 * `--` is what keeps tmux from reading the runtime or its flags as tmux options. The scrub is not a
 * carrier: it only empties identity a tmux server may have inherited, and a resumed Claude Code
 * (which, unlike pi, never re-exports its own) would otherwise present a stale one to its bridge.
 */
export function buildResumeCallArgs(
	placement: Placement,
	cwd: string,
	runtimePath: string,
	runtimeArgs: readonly string[],
	adoptEnv?: ResumeCallPiDurableAdoptEnv,
): string[] {
	assertSelector("session", placement.sessionId);
	assertLaunchTarget(runtimePath);
	const bad = classifyTmuxCwd(cwd);
	if (bad) throw new Error(`mux-resume-call: refusing to build argv with an unusable cwd (${bad}): ${cwd}`);
	const adoptAssignments = adoptEnvAssignments(adoptEnv);
	return [
		"new-window",
		"-d",
		"-a",
		...SCRUBBED_INHERITED_ENV.flatMap((assignment) => ["-e", assignment]),
		...adoptAssignments.flatMap((assignment) => ["-e", assignment]),
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
	params: { backend: ResumeCallBackend; cwd: string; runtimeArgs: readonly string[] },
	env: NodeJS.ProcessEnv = process.env,
): ResumeCallResult {
	return openResumeWindow(RESUME_CALL_RUNTIME[params.backend], params, undefined, env);
}

/**
 * #157 B3: the pi-durable resume window. The same order, refusals and receipt as `resumeCall` — the
 * runtime is the managed `entwurf`, and the window additionally carries the fixed adopt projection.
 * `runtimeArgs` (the managed verb and its closed adopt context) is passed through untouched; this
 * module never decodes it.
 */
export function resumePiDurableCall(
	params: { cwd: string; runtimeArgs: readonly string[]; adoptEnv: ResumeCallPiDurableAdoptEnv },
	env: NodeJS.ProcessEnv = process.env,
): ResumeCallResult {
	return openResumeWindow(RESUME_CALL_PI_DURABLE_RUNTIME, params, params.adoptEnv, env);
}

function openResumeWindow(
	runtime: string,
	params: { cwd: string; runtimeArgs: readonly string[] },
	adoptEnv: ResumeCallPiDurableAdoptEnv | undefined,
	env: NodeJS.ProcessEnv,
): ResumeCallResult {
	if (env.HERDR_ENV === "1") return { ok: false, reason: "herdr-resume-unsupported" };
	const badCwd = classifyTmuxCwd(params.cwd);
	if (badCwd) return { ok: false, reason: badCwd };

	let runtimePath: string;
	try {
		runtimePath = resolveRuntimeOnPath(runtime, env);
	} catch (err) {
		if (err instanceof LaunchPreconditionError) return { ok: false, reason: err.reason };
		throw err;
	}

	const inspected = inspectPlacement(env);
	if (!inspected.ok) return { ok: false, reason: inspected.reason };
	const placement = inspected.placement;
	requireSameContext("resumeCall", placement, env);

	const run = runTmux(buildResumeCallArgs(placement, params.cwd, runtimePath, params.runtimeArgs, adoptEnv), env);
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
 * they will guess about. The text is authored in root ENTWURF.json (#154 C1-D); each
 * key is bound explicitly so the reason union stays exhaustive here. */
export const RESUME_CALL_REJECT_HINT: Record<ResumeCallRejectReason, string> = {
	"no-tmux-context": ENTWURF_RESUME_LAUNCH_REJECT_HINTS["no-tmux-context"],
	"anchor-malformed": ENTWURF_RESUME_LAUNCH_REJECT_HINTS["anchor-malformed"],
	"anchor-unresolved": ENTWURF_RESUME_LAUNCH_REJECT_HINTS["anchor-unresolved"],
	"anchor-mismatch": ENTWURF_RESUME_LAUNCH_REJECT_HINTS["anchor-mismatch"],
	"cwd-not-absolute": ENTWURF_RESUME_LAUNCH_REJECT_HINTS["cwd-not-absolute"],
	"cwd-format-token": ENTWURF_RESUME_LAUNCH_REJECT_HINTS["cwd-format-token"],
	"cwd-missing": ENTWURF_RESUME_LAUNCH_REJECT_HINTS["cwd-missing"],
	"cwd-not-directory": ENTWURF_RESUME_LAUNCH_REJECT_HINTS["cwd-not-directory"],
	"herdr-resume-unsupported": ENTWURF_RESUME_LAUNCH_REJECT_HINTS["herdr-resume-unsupported"],
	"runtime-unresolved": ENTWURF_RESUME_LAUNCH_REJECT_HINTS["runtime-unresolved"],
	"runtime-not-absolute": ENTWURF_RESUME_LAUNCH_REJECT_HINTS["runtime-not-absolute"],
	"runtime-path-whitespace": ENTWURF_RESUME_LAUNCH_REJECT_HINTS["runtime-path-whitespace"],
	"runtime-missing": ENTWURF_RESUME_LAUNCH_REJECT_HINTS["runtime-missing"],
	"runtime-not-regular-file": ENTWURF_RESUME_LAUNCH_REJECT_HINTS["runtime-not-regular-file"],
	"runtime-not-executable": ENTWURF_RESUME_LAUNCH_REJECT_HINTS["runtime-not-executable"],
};
