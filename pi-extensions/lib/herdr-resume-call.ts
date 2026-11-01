/**
 * herdr-resume-call — reopen ONE dormant pi citizen's own transcript in a new herdr tab, from inside
 * herdr (#157 G1a).
 *
 * WHAT THIS IS. The herdr half of `entwurf_resume_call`, and only its LAUNCH. The v2 composition
 * (`entwurf-v2-visible-resume.ts`) owns everything that makes a resume a resume: the record, the
 * per-gid lock, the dormancy proof and the same-gid control-socket observation. It reaches this
 * module through the injected launch seam the bridge composes (`mcp/entwurf-bridge/src/index.ts`),
 * exactly as it reaches the tmux leaf `mux-resume-call.ts`; which of the two runs is chosen by the
 * shared rail root (`dispatchResumeLaunch` in `fresh-call-dispatch.ts`), not by the bridge and not
 * here — so this file never sees an address, never reads a record and never decides whether the
 * citizen came back.
 *
 * PI ONLY. A Claude Code resume proves its return by joining the receiver marker's owner pid to the
 * tmux pane pid it opened, and no herdr coordinate has been measured to carry that pid. So a Claude
 * Code target is a named pre-mutation refusal here and, like every refusal on a herdr rail, it never
 * falls back to tmux: a window somewhere the operator is not looking is worse than a refusal.
 *
 * WHAT IS REUSED AND WHAT IS NOT. Every herdr protocol primitive comes from `herdr-fresh-call.ts`:
 * the context, the cwd classification, the caller-pane read, the tab-create reply parser, the start
 * argv and its reply parser, the argv echo check, herdr's error code and the conditional reclaim.
 * The fresh tab-create BUILDER is not reused, because it carries the fresh callback env by contract
 * and a resume has no callback, no nonce, no task, no prompt and no model of its own — the runtime
 * argv is the record's, built on the v2 side. Borrowing that builder would mean faking a callback for
 * a sibling nobody is waiting on. No other fresh-specific stage is reused either: no birth framing
 * and no settle witness.
 *
 * THE ORDER IS THE FRESH RAIL'S, FOR THE SAME REASON. `tab create` and `agent start` are two
 * mutations, so everything decidable is decided before the first: context, backend, cwd, control
 * characters in the runtime argv, and the read-only question of which workspace the caller is in.
 * Every failure after the tab create carries a recovery that says what is out there; none of them
 * says that nothing was opened.
 *
 * WHAT THE RECEIPT IS NOT. A successful `agent start` is a LAUNCH: herdr made a tab and was asked to
 * start pi on that transcript there. herdr's readiness and its `agent_session` are herdr's view of
 * the pane, not garden addressability, so this module does not wait for either. The same-gid control
 * socket the v2 side waits for afterwards is the only observation that says the citizen is back.
 */

import { spawn as spawnChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import {
	argvMatchesRequest,
	buildHerdrAgentStartArgs,
	buildHerdrPaneGetArgs,
	classifyHerdrCwd,
	containsControlChar,
	createHerdrRunner,
	HERDR_AGENT_KIND,
	type HerdrFreshCallRejectReason,
	type HerdrLaunchFailureReason,
	type HerdrRecovery,
	type HerdrRun,
	parseHerdrAgentStartResponse,
	parseHerdrPaneGetResponse,
	parseHerdrTabCreateResponse,
	readHerdrErrorCode,
	reclaim,
	resolveHerdrContext,
	type SpawnFn,
} from "./herdr-fresh-call.ts";

/** Why a herdr resume launch was refused BEFORE anything was created. The context, caller-pane and
 * cwd words are the fresh rail's own, so an operator learns one word per herdr fact. */
export type HerdrResumeRejectReason =
	| Extract<
			HerdrFreshCallRejectReason,
			| "herdr-context-missing"
			| "herdr-caller-pane-missing"
			| "herdr-caller-pane-get-failed"
			| "herdr-caller-pane-unparsable"
			| "herdr-caller-pane-drift"
			| "herdr-caller-workspace-missing"
			| "herdr-argv-control-character"
			| "cwd-not-absolute"
			| "cwd-missing"
			| "cwd-not-directory"
	  >
	/** Not the fresh rail's `herdr-backend-unsupported`: that word's hint promises pi AND claude-code,
	 * and on this verb the herdr rail opens pi only. */
	| "herdr-resume-backend-unsupported";

/** Why a launch that had already reached the tab create failed. The fresh rail's words, minus
 * `herdr-agent-start-vanished`, which names a settle witness this rail does not run, plus one word of
 * this rail's own: `herdr-tab-create-workspace-drift`, a create reply that agrees with itself but
 * names another workspace than the caller's one this call asked for. */
export type HerdrResumeLaunchFailureReason =
	| Exclude<HerdrLaunchFailureReason, "herdr-agent-start-vanished">
	| "herdr-tab-create-workspace-drift";

/** herdr's coordinates for the tab this call created — known only once the create reply was read.
 * VIEWS, not addresses: `[측정 2026-09-14]` a pane id is not stable for the life of a sibling. */
export interface HerdrResumeCreated {
	readonly herdrWorkspaceId: string;
	readonly herdrTabId: string;
	/** The new tab's INITIAL pane — where pi was started, and the only thing this rail may close. */
	readonly herdrPaneId: string;
	readonly herdrTerminalId: string;
}

/**
 * The launch receipt: what herdr was asked to start, at which requested directory, and where the view
 * is. ABSENT BY CONTRACT, as on the fresh rail: any garden or native session id (the address is the
 * record's, and the v2 side already holds it), screen text, `agent_status`, `interactive_ready` and
 * `agent_session`. There is no witness field because there is no settle stage.
 */
export interface HerdrResumeReceipt extends HerdrResumeCreated {
	/** The kind herdr was ASKED for — not proof that the runtime exists (see `HERDR_AGENT_KIND`). */
	readonly requestedKind: string;
	/** The REQUESTED start directory, the record's — not an observation of where the pane landed. */
	readonly cwd: string;
	readonly herdrAgentName: string;
}

export type HerdrResumeCallResult =
	| { readonly ok: true; readonly receipt: HerdrResumeReceipt }
	| { readonly ok: false; readonly reason: HerdrResumeRejectReason }
	| {
			readonly ok: false;
			readonly reason: HerdrResumeLaunchFailureReason;
			/** herdr's own error code when it gave one — quoted, never retyped. */
			readonly herdrErrorCode?: string;
			readonly recovery: HerdrRecovery;
			/** Present exactly when the create reply was read, so the operator is told WHICH tab. */
			readonly created?: HerdrResumeCreated;
	  };

/**
 * The agent name herdr will know this launch by: `entwurf-resume-` plus 16 random hex, 31 characters.
 * `[file:line @ c77af189]` `src/app/agents.rs:15-20` requires `[a-z][a-z0-9_-]{0,31}`. It is random
 * per call, not derived from the session or the citizen: this module never learns either, and a name
 * an operator could read an address into is the promotion this rail refuses.
 */
export function mintHerdrResumeAgentName(): string {
	return `entwurf-resume-${randomBytes(8).toString("hex")}`;
}

/**
 * `tab create` for a resume: the fresh rail's placement policy — a NEW tab in the caller's own
 * workspace, named explicitly, without taking focus — and its fixed identity scrub, with NO callback
 * env. The scrub is the reason the tmux resume leaf carries one too: a pi that inherits a stale
 * `PI_SESSION_ID` would attach as the citizen that env names instead of the one its transcript
 * belongs to. `--cwd` is always present because a resume always has the record's directory.
 */
export function buildHerdrResumeTabCreateArgs(params: { workspaceId: string; cwd: string }): string[] {
	return [
		"tab",
		"create",
		"--workspace",
		params.workspaceId,
		"--no-focus",
		"--cwd",
		params.cwd,
		"--env",
		"PI_SESSION_ID=",
		"--env",
		"PI_AGENT_ID=",
	];
}

/**
 * Open pi on the record's transcript in a new herdr tab.
 *
 * `makeRun` receives the herdr binary the context names and returns the one way this call talks to
 * herdr; production passes `createHerdrRunner`, a test passes a table. It is called only after the
 * context resolved, so a refusal for a missing context never builds a runner.
 */
export async function herdrResumeCall(
	params: { readonly backend: string; readonly cwd: string; readonly runtimeArgs: readonly string[] },
	makeRun: (bin: string) => HerdrRun,
	env: NodeJS.ProcessEnv,
	agentName: string = mintHerdrResumeAgentName(),
): Promise<HerdrResumeCallResult> {
	const context = resolveHerdrContext(env);
	if (!context.ok) {
		if (context.reason === "herdr-context-missing" || context.reason === "herdr-caller-pane-missing") {
			return { ok: false, reason: context.reason };
		}
		// Crash, don't warn: a context refusal this rail has no word for is drift in the shared
		// primitive, not something to rename into the nearest reason.
		throw new Error(`herdr-resume-call: the herdr context refused as ${context.reason}, which this rail does not name`);
	}

	// Pi only, before anything is read or created — see the module header.
	if (params.backend !== "pi") return { ok: false, reason: "herdr-resume-backend-unsupported" };

	const badCwd = classifyHerdrCwd(params.cwd);
	if (badCwd !== null) return { ok: false, reason: badCwd };
	// herdr refuses ANY control character in an agent argument; it is checked while it is still free.
	if (params.runtimeArgs.some(containsControlChar)) return { ok: false, reason: "herdr-argv-control-character" };

	const run = makeRun(context.context.bin);
	// Which workspace is the caller in? herdr's own answer about the caller's own pane, read and bound
	// exactly as the fresh rail binds it. A read creates nothing, so every failure here is a refusal.
	const callerPaneRun = await run(buildHerdrPaneGetArgs(context.context.callerPaneId));
	if (callerPaneRun.status !== 0) return { ok: false, reason: "herdr-caller-pane-get-failed" };
	const callerPane = parseHerdrPaneGetResponse(callerPaneRun.stdout);
	if (callerPane === null) return { ok: false, reason: "herdr-caller-pane-unparsable" };
	if (callerPane.paneId !== context.context.callerPaneId) return { ok: false, reason: "herdr-caller-pane-drift" };
	if (callerPane.workspaceId === undefined) return { ok: false, reason: "herdr-caller-workspace-missing" };

	// ── everything above this line leaves nothing behind ──────────────────────────────────
	const tabRun = await run(buildHerdrResumeTabCreateArgs({ workspaceId: callerPane.workspaceId, cwd: params.cwd }));
	if (tabRun.status !== 0) {
		// herdr's own envelope means herdr answered and declined before making a tab; no envelope
		// means our runner's own timeout/kill/spawn failure, after which a tab may well exist.
		const code = readHerdrErrorCode(tabRun.stderr);
		return {
			ok: false,
			reason: "herdr-tab-create-failed",
			...(code === undefined ? {} : { herdrErrorCode: code }),
			recovery: code === undefined ? { outcome: "unknown" } : { outcome: "none" },
		};
	}
	const tab = parseHerdrTabCreateResponse(tabRun.stdout);
	if (tab === null) return { ok: false, reason: "herdr-tab-create-unparsable", recovery: { outcome: "unknown" } };
	const pane = tab.rootPane;
	// Every coordinate below comes from the reply that CREATED the tab: it is the one the reclaim is
	// bound to, so the coordinates an operator reads and the pane this rail may close are the same.
	const created: HerdrResumeCreated = {
		herdrWorkspaceId: tab.workspaceId,
		herdrTabId: tab.tabId,
		herdrPaneId: pane.paneId,
		herdrTerminalId: pane.terminalId,
	};
	// The tab must be where this call ASKED for it: the caller's own workspace. The shared parser
	// proves the reply agrees with itself (tab and root pane name one workspace), not that it agrees
	// with the request — a coherent reply about another workspace would start pi where the operator
	// is not looking, under a receipt that reads as a launch. So it is a named failure, reclaimed.
	if (tab.workspaceId !== callerPane.workspaceId) {
		return { ok: false, reason: "herdr-tab-create-workspace-drift", recovery: await reclaim(pane, run), created };
	}
	// Occupancy is TWO facts, as the shared reclaim reads them (`decideConditionalClose`): herdr naming
	// an agent in the pane, and herdr holding that agent's session. An agent whose session has not been
	// reported yet is still somebody in the pane, so either fact stops the start.
	if (pane.agent !== undefined || pane.hasAgentSession) {
		return { ok: false, reason: "herdr-tab-root-pane-occupied", recovery: await reclaim(pane, run), created };
	}

	const startRun = await run(
		buildHerdrAgentStartArgs({
			agentName,
			kind: HERDR_AGENT_KIND.pi,
			paneId: pane.paneId,
			backendArgs: params.runtimeArgs,
		}),
	);
	if (startRun.status !== 0) {
		const code = readHerdrErrorCode(startRun.stderr);
		return {
			ok: false,
			reason: "herdr-agent-start-failed",
			...(code === undefined ? {} : { herdrErrorCode: code }),
			recovery: await reclaim(pane, run),
			created,
		};
	}
	const started = parseHerdrAgentStartResponse(startRun.stdout);
	if (started === null) {
		return { ok: false, reason: "herdr-agent-start-unparsable", recovery: await reclaim(pane, run), created };
	}
	if (
		started.pane.paneId !== pane.paneId ||
		started.pane.terminalId !== pane.terminalId ||
		(started.pane.tabId !== undefined && started.pane.tabId !== tab.tabId)
	) {
		return { ok: false, reason: "herdr-agent-start-pane-drift", recovery: await reclaim(pane, run), created };
	}
	// The argv IS the record's transcript, provider and model. A pi started with anything else is a
	// citizen this call did not ask for, and nothing downstream would reveal it.
	if (!argvMatchesRequest(started.argv, "pi", params.runtimeArgs)) {
		return { ok: false, reason: "herdr-agent-start-argv-drift", recovery: await reclaim(pane, run), created };
	}

	return {
		ok: true,
		receipt: { ...created, requestedKind: HERDR_AGENT_KIND.pi, cwd: params.cwd, herdrAgentName: agentName },
	};
}

/** Why each outcome happened, in the caller's terms. Code-owned like every herdr rail hint; root
 * ENTWURF.json does not carry them. */
export const HERDR_RESUME_HINT: Readonly<Record<HerdrResumeRejectReason | HerdrResumeLaunchFailureReason, string>> = {
	"herdr-context-missing":
		"HERDR_ENV/HERDR_BIN_PATH are absent, so this process cannot reach herdr and this rail does not exist here; nothing was sent to tmux instead",
	"herdr-caller-pane-missing":
		"herdr did not give this process a HERDR_PANE_ID, so there is no way to ask herdr which workspace this caller is in",
	"herdr-caller-pane-get-failed":
		"herdr would not report this process's own pane — run `herdr pane get $HERDR_PANE_ID` to see what it says",
	"herdr-caller-pane-unparsable": "herdr's reply about this process's own pane could not be read",
	"herdr-caller-pane-drift":
		"herdr answered about a different pane than HERDR_PANE_ID names, so its workspace says nothing about where this caller is",
	"herdr-caller-workspace-missing":
		"herdr reported this process's pane with no workspace, and guessing one would reopen the citizen wherever the operator is looking",
	"herdr-resume-backend-unsupported":
		"inside herdr, same-id resume reopens pi only — a Claude Code resume proves its return through a tmux pane pid this rail does not have; nothing was sent to tmux instead",
	"herdr-argv-control-character":
		"the recorded runtime argv holds a control character, which herdr refuses in an agent argument",
	"cwd-not-absolute": "the recorded start directory is not an absolute path",
	"cwd-missing": "the recorded start directory no longer exists",
	"cwd-not-directory": "the recorded start path is not a directory",
	"herdr-tab-create-failed": "the tab create did not succeed — read the recovery line for whether anything exists",
	"herdr-tab-create-unparsable": "herdr's tab reply could not be read, so a tab may exist that this call cannot name",
	"herdr-tab-create-workspace-drift":
		"herdr created the tab in a different workspace than the caller's own one this call asked for, so pi was not started there",
	"herdr-tab-root-pane-occupied": "the new tab's initial pane already holds an agent, so pi was not started into it",
	"herdr-agent-start-failed": "herdr did not report pi as started in the tab that was just created",
	"herdr-agent-start-unparsable": "herdr's start reply could not be read",
	"herdr-agent-start-pane-drift": "herdr reported a different pane, terminal or tab than the one it just created",
	"herdr-agent-start-argv-drift": "herdr echoed an argv that is not the recorded one this call asked it to start",
};

/**
 * What the v2 launch seam receives. Structural on purpose, as the tmux leaf's own result is: naming
 * v2's types here would import entwurf core into a herdr rail.
 *
 *   ok        a herdr handle — `rail: "herdr"` plus the receipt, nothing tmux-shaped invented
 *   reject    reason + hint, and nothing was created
 *   failure   reason + hint + what is out there: the rail, herdr's code, the recovery, the created tab
 */
export type HerdrResumeLaunchOutcome =
	| { readonly ok: true; readonly handle: { readonly rail: "herdr" } & HerdrResumeReceipt }
	| { readonly ok: false; readonly reason: string; readonly hint: string }
	| {
			readonly ok: false;
			readonly reason: string;
			readonly hint: string;
			readonly failure: {
				readonly rail: "herdr";
				readonly vendorCode?: string;
				readonly recovery: HerdrRecovery;
				readonly created?: HerdrResumeCreated;
			};
	  };

export function herdrResumeLaunchOutcome(result: HerdrResumeCallResult): HerdrResumeLaunchOutcome {
	if (result.ok) return { ok: true, handle: { rail: "herdr", ...result.receipt } };
	const hint = HERDR_RESUME_HINT[result.reason];
	if (!("recovery" in result)) return { ok: false, reason: result.reason, hint };
	return {
		ok: false,
		reason: result.reason,
		hint,
		failure: {
			rail: "herdr",
			...(result.herdrErrorCode === undefined ? {} : { vendorCode: result.herdrErrorCode }),
			recovery: result.recovery,
			...(result.created === undefined ? {} : { created: result.created }),
		},
	};
}

/** The production herdr launch the shared rail root (`dispatchResumeLaunch`) returns to the v2 seam
 * when this process is inside herdr. */
export async function launchHerdrResume(
	input: { readonly backend: string; readonly cwd: string; readonly runtimeArgs: readonly string[] },
	env: NodeJS.ProcessEnv,
	spawn: SpawnFn = spawnChildProcess as SpawnFn,
): Promise<HerdrResumeLaunchOutcome> {
	return herdrResumeLaunchOutcome(await herdrResumeCall(input, (bin) => createHerdrRunner(bin, env, spawn), env));
}
