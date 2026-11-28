/**
 * program-status — what this terminal's citizen is doing, as an OSC 7501 program status (#178).
 *
 * A Herdr Core terminal (and any terminal that answers the OSC 7501 query) shows a program's own report of its state;
 * nothing else does it for a program. Pi's interactive mode reports through `ProgramStatusReporter`, which reads
 * AgentSession events that pi-durable does not emit, so the durable TUI reports through the same pi-tui
 * `ProcessTerminal.setProgramStatus`, from the SDK's own `pi.live` document of the ROOT conversation.
 *
 * ONE REPORTER PER TERMINAL, THE ROOT CITIZEN'S. The status follows the root conversation's run state whichever
 * conversation is on screen: looking at a subagent does not turn a running root idle.
 *
 * THE VIEW HOLDS THREE FACTS, NOT THE DOCUMENT. `rootRunOf` keeps whether a run is live, whether a compaction is
 * live, and the recorded run failure's task and reason code. A streaming answer, a failure's free-text detail and
 * every other field of `pi.live` never reach the view, so no later reader of it can pass them on.
 *
 * ONLY WHAT A FACT SAYS. Each status comes from one of those facts, and nothing else is reported:
 *
 *   the session failed and closed itself           error, "session failed"
 *   the root watch stopped after a value           clear (a status nobody updates any more is not stated)
 *   a compaction is live                           working, "Compacting context"
 *   a run is live                                  working
 *   a run was seen live and has ended:
 *     no failure, or the failure it started with   done (SDK 1.6.1 keeps an earlier run's failure through a reset or
 *                                                  `afterFailedRun: "continue"` run, and an answer does not clear it)
 *     a new failure: aborted, reset or             idle (the user's own stop, a fresh start, or a continue with
 *     nothing_to_answer                            nothing owed: no request was sent, so nothing failed)
 *     a new failure of a known reason              error, that reason code
 *     a new failure of any other reason            error, "run failed"
 *   no run seen live, and a failure of another task
 *   than the last value carried                    the same three lines: a run started and failed between two values
 *   no run seen live, and the failure the last
 *   value carried is gone                          done (the SDK removes a failure when a later commit starts a run, so
 *                                                  a run started, answered and ended between two values)
 *   no run seen ending since this TUI started      idle (a past run's failure is not announced again)
 *   no root fact yet                               nothing
 *
 * A run that starts and ends between two values of the root watch is never seen live (a Herdr Core showed idle beside
 * the screen's error for a run with no usable provider, #178 L-12; that this was the cause is read from this source,
 * not measured). A run that fails unseen is reported by its failure, and one that answers unseen after a failure by
 * that failure going away. A run that answers unseen with no failure on record before it leaves no trace, and the
 * status stays what it was: that under-reports. One case is told wrong, and no value can tell it right: a run
 * that fails, the next run it starts in the same commit, and that run's answer, all folded into one value, leave only
 * the first run's failure, which reads as how the last run ended. `blocked` is never reported: pi-durable has no permission or
 * question dialog to wait on. No prompt, answer, error text, path or session name is ever part of a report. A view
 * only: nothing in Entwurf reads it as placement, liveness or a delivery input.
 */

import type { LiveState, RunFailureReason, TaskId } from "@earendil-works/pi-durable";
import type { ProgramStatus } from "@earendil-works/pi-tui";

/** The `app` name every report carries: a stable program name, as the protocol asks. */
export const PROGRAM_STATUS_APP = "pi-durable";

/** The root conversation's run state, as much of `pi.live` as a program status reads. */
export interface RootRun {
	readonly running: boolean;
	readonly compacting: boolean;
	readonly failure?: { readonly taskId: TaskId; readonly reason: RunFailureReason };
}

/** The three facts of one root `pi.live`; a root without one (it never ran) has none of them. */
export function rootRunOf(live: LiveState | undefined): RootRun {
	const state = live ?? {};
	const failure = state.runFailure;
	return {
		running: state.run !== undefined,
		compacting: (state.compactions?.length ?? 0) > 0,
		...(failure === undefined ? {} : { failure: { taskId: failure.taskId, reason: failure.reason } }),
	};
}

/** One root fact: the root's run state (absent before the root watch's first value, or after it stopped), and the
 * session's own failure. */
export interface RootFact {
	readonly run: RootRun | undefined;
	readonly failed: boolean;
}

/** What the mapper remembers between two root facts. */
export interface RootStatusMemory {
	/** A root fact arrived since the start or the last clear. */
	readonly seen: boolean;
	/** The last fact had a live run. */
	readonly running: boolean;
	/**
	 * The failure on record beside the live run: always an earlier run's, since a run's own failure is recorded only in
	 * the commit that ends it. Read from every value with a live run, because SDK 1.6.1 ends a failed run and starts
	 * the next one in one commit, so the watch never sees a value without a run between them.
	 */
	readonly inherited?: TaskId;
	/** The task of the failure the last fact carried, live run or not: a failure of another task is a new one. */
	readonly failureSeen?: TaskId;
	/** What the last settled run left. */
	readonly resting: ProgramStatus;
}

export const INITIAL_ROOT_STATUS_MEMORY: RootStatusMemory = {
	seen: false,
	running: false,
	resting: { state: "idle", app: PROGRAM_STATUS_APP },
};

/**
 * The reasons a run ends without an answer that are not a failure: the user's own stop, a fresh start, and a
 * continue the model owed no answer to (`nothing_to_answer`: no request was sent). ONE LIST, TWO READERS: the status
 * reads such a run idle, and the screen's notices (`durableNotices`) draw no error line for it, so the terminal and
 * the screen never state the same fact differently.
 */
export const RESTING_REASONS: readonly string[] = ["aborted", "reset", "nothing_to_answer"];
/** SDK 1.6.1's `RunFailureReason`s that are reported by name; any other value reads "run failed". */
const KNOWN_REASONS: readonly string[] = [
	"model_error",
	"no_model",
	"faulted",
	"orphaned",
	"interrupted",
	"restart_limit",
	"turn_limit",
];

function settled(run: RootRun, inherited: TaskId | undefined): ProgramStatus {
	const failure = run.failure;
	if (failure === undefined || failure.taskId === inherited) return { state: "done", app: PROGRAM_STATUS_APP };
	if (RESTING_REASONS.includes(failure.reason)) return { state: "idle", app: PROGRAM_STATUS_APP };
	const message = KNOWN_REASONS.includes(failure.reason) ? failure.reason : "run failed";
	return { state: "error", app: PROGRAM_STATUS_APP, message };
}

/** The status for one root fact, and what to remember for the next. */
export function rootProgramStatus(
	fact: RootFact,
	memory: RootStatusMemory,
): { status: ProgramStatus | undefined; memory: RootStatusMemory } {
	if (fact.failed) {
		return { status: { state: "error", app: PROGRAM_STATUS_APP, message: "session failed" }, memory };
	}
	const run = fact.run;
	if (run === undefined) {
		if (!memory.seen) return { status: undefined, memory };
		return { status: { state: "clear" }, memory: INITIAL_ROOT_STATUS_MEMORY };
	}
	const inherited = run.running ? run.failure?.taskId : undefined;
	const resting = !run.running && memory.running ? settled(run, memory.inherited) : memory.resting;
	// A run that started and failed between two values was never seen live: the failure of another task than the last
	// value carried is all that tells it. The first value's failure is a past run's and stays unannounced.
	const failureSeen = run.failure?.taskId;
	const idleBefore = memory.seen && !memory.running && !run.running;
	const unseen = idleBefore && failureSeen !== undefined && failureSeen !== memory.failureSeen;
	// The failure the last value carried is gone and no run is live: a later commit started a run, and it answered.
	const answeredUnseen = idleBefore && memory.failureSeen !== undefined && failureSeen === undefined;
	const next: RootStatusMemory = {
		seen: true,
		running: run.running,
		...(inherited === undefined ? {} : { inherited }),
		...(failureSeen === undefined ? {} : { failureSeen }),
		resting: unseen || answeredUnseen ? settled(run, undefined) : resting,
	};
	if (run.compacting) {
		return { status: { state: "working", app: PROGRAM_STATUS_APP, message: "Compacting context" }, memory: next };
	}
	if (run.running) return { status: { state: "working", app: PROGRAM_STATUS_APP }, memory: next };
	return { status: next.resting, memory: next };
}

/** The root fact of one view: the ROOT conversation's run state, never the shown one's, and the session's failure. */
export function rootStatusFact(view: { readonly rootRun?: RootRun; readonly failure?: object }): RootFact {
	return { run: view.rootRun, failed: view.failure !== undefined };
}

/**
 * Reports each root fact to a terminal, once per change: the same status twice is written once. The terminal's
 * `setProgramStatus` keeps the latest one and writes it only where the terminal confirmed support; its `stop()` clears
 * it. This sink never writes to stdout itself.
 */
export class RootStatusSink {
	readonly #setProgramStatus: (status: ProgramStatus) => void;
	#memory: RootStatusMemory = INITIAL_ROOT_STATUS_MEMORY;
	#last: string | undefined;

	constructor(setProgramStatus: (status: ProgramStatus) => void) {
		this.#setProgramStatus = setProgramStatus;
	}

	apply(fact: RootFact): void {
		const { status, memory } = rootProgramStatus(fact, this.#memory);
		this.#memory = memory;
		if (status === undefined) return;
		const key = JSON.stringify(status);
		if (key === this.#last) return;
		this.#last = key;
		this.#setProgramStatus(status);
	}
}
