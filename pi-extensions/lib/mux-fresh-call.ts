/**
 * mux-fresh-call — open ONE visible sibling in the caller's own tmux server (its own session by
 * default, or one named existing session on that server since #105), hand it its first task in
 * the launch argv, and let it name itself back to the caller. A Codex CALLER is the one measured
 * exception to "the caller's own session": it opens beside its own TUI pane, found by that
 * pane's terminal title (#95 lane B), never by a TUI guess.
 *
 * ── Why this is a third module and not a parameter on the leaf ──
 *
 * `mux-placement` owns place and only place; `mux-launch` owns "start the fixed official pi in
 * a window I placed" and refuses a command carrier (docs §11). Both stay that way. The carrier
 * lives HERE, one layer up, because the thing being carried is not a command in the shell sense
 * — it is a TASK plus the instruction that makes the new citizen announce itself. Putting it on
 * the leaf would make every future placement caller inherit a prompt argument it has no use for.
 *
 *   caller agent → fresh-call → fixed backend runtime + first-turn framing
 *   fresh-call   → placement leaf (unchanged, carrier-free)
 *   fresh-call  -X-> identity minting, delivery transport, task planning
 *
 * ── Invariants ──
 *
 *   1. The first turn does not MINT the garden id — record and socket exist from session start.
 *      It exists to SAY that id to the caller, who is the one who cannot see it. (rail §6-a)
 *   2. Correlation is what the DELIVERY layer stamps on the callback, never what the sibling
 *      says about itself — asked directly, a fresh cell answers with a uuidv7. (rail §6-b)
 *   3. The two receipts are separate objects and stay that way: `freshCall` returns tmux
 *      coordinates synchronously and nothing else; the correlation receipt arrives later on the
 *      caller's own inbound surface. Merging them would claim knowledge this module cannot have.
 *   4. A launch with no callback is a REAL outcome, not an error to retry. No watcher, no poll,
 *      no timeout supervisor. The window is visible; the operator can look.
 *
 * ── The optional REQUESTED cwd (issue #73) ──
 *
 * A fresh sibling starts wherever the caller happens to be — unless the caller names ONE
 * literal start directory. That input exists so a cross-repo fresh consultation never has to
 * ride `entwurf_resume_call` for a dormant record's recorded cwd: resume stays a continuity
 * verb, and placement pressure stays here. The rules are deliberately narrow:
 *
 *   - `undefined` and the exact empty string mean OMIT: no `-c` reaches tmux and the argv is
 *     byte-identical to the pre-#73 shape. Anything else is taken LITERALLY — no trim, no
 *     realpath, no project-name resolution, no store/peers/record lookup. The caller is the
 *     only cwd authority this module knows.
 *   - when a CODEX caller omits it, the surface supplies that citizen's own record cwd and it
 *     becomes an explicit `-c` (#95 lane C). This is not a second authority: it is the same
 *     caller, named more precisely, because a codex caller's PROCESS directory is the
 *     operator-owned app-server's rather than its own. Every other caller keeps the inherited
 *     directory and an unchanged argv.
 *   - the chosen value reaches codex TWICE, and that is one value with two carriers rather than
 *     two inputs: tmux `-c` places the pane, and codex `-C` places the THREAD, which a
 *     `--remote` attachment would otherwise take from the app-server (see `buildBackendArgs`).
 *   - the value is classified by the shared `classify-tmux-cwd.ts` leaf BEFORE any mutation
 *     (same four stable reasons as resume; the measured tmux 3.6a facts live on that leaf).
 *     This module's hints phrase them as the REQUESTED cwd; resume's say RECORDED.
 *   - the receipt echoes what was REQUESTED, exactly as `runtimePath` does. It never reports
 *     `pane_current_path`: proving where the pane actually landed belongs to acceptance, not
 *     to the launch receipt.
 *
 * ── The optional project seat (issue #105) ──
 *
 * A fresh sibling opens in the caller's own tmux session — unless the caller names ONE session
 * on the SAME server. That input exists because the operator's seats are per-project: a sibling
 * opened for the `org` project belongs in the `org` session, and before this the only way to
 * put it there was for the operator to move the window by hand. The rules are as narrow as the
 * cwd input's, and for the same reason:
 *
 *   - `undefined` means the caller's own session, and the argv is byte-identical to the
 *     pre-#105 shape. A named session is resolved to its native `$id` by the shared
 *     `resolve-tmux-session.ts` leaf and ONLY that id ever reaches `-t`.
 *   - a session that does not exist is `tmux-session-missing` and NOTHING is created — not the
 *     window, not the session. There is no `ifMissing` axis and no `new-session` verb anywhere
 *     in this product (GLG, 2026-09-07): the operator creates the seat and calls again. A name
 *     outside the leaf's grammar is the separate `tmux-session-name-invalid` — a different
 *     repair, because that name is a shape this rail does not address rather than a session
 *     that is absent. The leaf owns which shapes and why; part of that set tmux genuinely
 *     cannot resolve and part is a narrowing this rail chose, and it says which is which.
 *   - `-d` is what makes this safe to do to a session someone is looking at. `[측정]` without
 *     it, a `new-window` into another session changes THAT session's active window and steals
 *     the operator's focus. It was already fixed in this argv; #105 is where it became
 *     load-bearing.
 *   - the seat is ORTHOGONAL to the cwd. `[측정 ×2]` with `-c` omitted, a window opened into
 *     another session lands in the cwd of the process that ran `new-window` — not the target
 *     session's `session_path` and not its active pane. Neither input is ever inferred from
 *     the other.
 *   - the receipt echoes the REQUESTED name and carries the OBSERVED target `$id`, which is
 *     the session the window is actually in. It still reports no `pane_current_path`, and
 *     there is no "session created" field because nothing here creates one.
 */

import { callbackEnvAssignments } from "./callback-env.ts";
import { classifyTmuxCwd, type TmuxCwdRejectReason } from "./classify-tmux-cwd.ts";
import {
	CODEX_CALLER_SEAT_HINT,
	type CodexCallerSeatRejectReason,
	resolveCodexCallerSeat,
} from "./codex-caller-seat.ts";
import {
	CODEX_CALLER_PREFLIGHT_HINT,
	CODEX_LAUNCH_CWD_PREFLIGHT_HINT,
	CODEX_PREFLIGHT_HINT,
	type CodexCallerPreflightRejectReason,
	type CodexPreflightRejectReason,
	codexLaunchCwdFreshPreflight,
} from "./codex-fresh-preflight.ts";
import {
	COPILOT_PREFLIGHT_HINT,
	type CopilotPreflightRejectReason,
	copilotFreshPreflight,
} from "./copilot-fresh-preflight.ts";
import {
	buildOmpBootstrapPayload,
	composeBackendArgs,
	composeFreshCallPrompt,
	FRESH_CALL_BACKENDS,
	FRESH_CALL_CALLBACK_TOOL,
	FRESH_CALL_DELIVERY_TOOL,
	type FreshCallBackend,
	type FreshCallComposition,
	type FreshCallInputRejectReason,
	isSafeFreshCallModel,
	MODEL_MAX_CHARS,
	mintNonce,
	normalizeFreshCallInputs,
	OMP_BOOTSTRAP_FLAG,
	OMP_BOOTSTRAP_VERSION,
	TASK_MAX_CHARS,
} from "./fresh-call-composition.ts";
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
	type PlacementRejectReason,
	parseWindowFields,
	requireSameContext,
	runTmux,
	type WindowHandle,
} from "./mux-placement.ts";
import { resolveCodexDefaultSocketPath } from "./native-push/codex-ws-client.ts";
import { OMP_PREFLIGHT_HINT, type OmpPreflightRejectReason, ompFreshPreflight } from "./omp-fresh-preflight.ts";
import { classifyTmuxSessionName, resolveTmuxSessionId, type TmuxSessionRejectReason } from "./resolve-tmux-session.ts";

/**
 * THE COMPOSITION MOVED, THE RAIL DID NOT (#116 S2-a). Backend argv, the first-turn framing and
 * the nonce now live in `fresh-call-composition.ts`, which knows nothing about tmux, so the herdr
 * rail can reach them without importing this file and dragging placement behind it. They are
 * re-exported here unchanged: every existing caller, gate and mutant anchor that reads them from
 * this module keeps reading the same names.
 *
 * The two wrappers below are where this rail states what only it can state — the sentence that
 * says a sibling was opened in the operator's tmux session, and the Codex socket path. Both are
 * arguments to the leaf rather than knowledge inside it.
 */
export {
	buildOmpBootstrapPayload,
	FRESH_CALL_BACKENDS,
	FRESH_CALL_CALLBACK_TOOL,
	FRESH_CALL_DELIVERY_TOOL,
	type FreshCallBackend,
	type FreshCallComposition,
	isSafeFreshCallModel,
	MODEL_MAX_CHARS,
	mintNonce,
	OMP_BOOTSTRAP_FLAG,
	OMP_BOOTSTRAP_VERSION,
	TASK_MAX_CHARS,
};

/** What the tmux rail tells a sibling about where it woke up. The resume verb has no equivalent
 * because it composes no first turn at all; a herdr rail will pass its own sentence here. */
export const TMUX_FRESH_CALL_OPENING_LINE =
	"You are a fresh visible citizen that entwurf opened in the operator's tmux session.";

/** Backend argv for THIS rail: the neutral dialect, with the two Codex facts only a rail can
 * state — the socket resolved from the caller's env, and the directory this launch chose.
 *
 * `launchCwd` defaults to THIS process's own directory, which is what tmux gives a window opened
 * with no `-c` (`[측정 ×2]`, module header). The default is that inherited fact rather than a
 * convenience, so a caller that omits it still names the truth to codex. Both facts reach the
 * leaf lazily, because a host with no Codex home must still be able to open pi and claude
 * siblings — see `composeBackendArgs`. */
export function buildBackendArgs(
	backend: FreshCallBackend,
	composition: FreshCallComposition,
	model: string,
	env: NodeJS.ProcessEnv = process.env,
	launchCwd: string = process.cwd(),
): string[] {
	return composeBackendArgs(
		backend,
		composition,
		model,
		() => resolveCodexDefaultSocketPath(env),
		() => launchCwd,
	);
}

/** The first turn for THIS rail: the neutral framing under this rail's placement sentence. */
export function buildFreshCallPrompt(params: {
	backend: FreshCallBackend;
	task: string;
	callerGardenId: string;
	nonce: string;
}): string {
	return composeFreshCallPrompt({ ...params, openingLine: TMUX_FRESH_CALL_OPENING_LINE });
}

/**
 * The fixed runtime each backend resolves on PATH. Same reason `mux-launch` uses PATH rather
 * than a compiled-in location: the official binary is whatever the operator's environment gives
 * when they type the name.
 *
 * `copilot` resolves `entwurf`, NOT the vendor CLI, and that is the contract rather than a
 * convenience. Step 9 clause 1 requires ONE fixed MANAGED runtime path, and a bare `copilot`
 * is not one: it would start without the `COPILOT_CLI_ENABLED_FEATURE_FLAGS=EXTENSIONS` token
 * whose absence skips the extension scan SILENTLY, so the sibling would look launched and could
 * never be delivered to. `entwurf copilot` is the accepted managed invocation that owns that
 * flag, its recursion fence and its receiver precondition; fresh call reaches Copilot only
 * through it. The cost is named: a Copilot fresh call needs a current `entwurf` on PATH, the
 * way a pi fresh call needs `pi`.
 *
 * `omp` resolves the BARE vendor, and that difference is a measured one rather than an
 * inconsistency. Copilot needs a managed wrapper because the bare CLI starts without
 * `COPILOT_CLI_ENABLED_FEATURE_FLAGS=EXTENSIONS` and skips its extension scan silently — there
 * is a flag only a launcher can carry. omp has no such flag: it always scans its extensions
 * directory, and the one thing it needs beyond that (`tools.xdev: false`) lives in the operator
 * config, which is a PREFLIGHT fact and not something a launcher could supply. Inventing an
 * `entwurf omp` verb here would add a managed surface with nothing to manage.
 */
export const FRESH_CALL_RUNTIME: Record<FreshCallBackend, string> = {
	pi: "pi",
	"claude-code": "claude",
	copilot: "entwurf",
	omp: "omp",
	codex: "codex",
};

/** A launch that was refused, or a placement that could not be established. Every value is a
 * NAMED refusal — this module has no fallback launch and no fallback directory. The cwd members
 * come from the shared classification leaf and their string values are stable contract. */
export type FreshCallRejectReason =
	| FreshCallInputRejectReason
	| PlacementRejectReason
	| LaunchRejectReason
	| TmuxCwdRejectReason
	| TmuxSessionRejectReason
	| CopilotPreflightRejectReason
	| OmpPreflightRejectReason
	| CodexPreflightRejectReason
	| CodexCallerPreflightRejectReason
	| CodexCallerSeatRejectReason
	| "caller-identity-unavailable"
	| "model-empty"
	| "model-invalid"
	| "task-empty"
	| "task-too-long";

/** The optional project seat: ONE existing session on the caller's own tmux server, named
 * literally. An object rather than a bare string so the seat axis can never be confused with
 * the cwd axis at a call site — and so a future seat fact, if one is ever measured to be
 * needed, does not arrive as a second top-level parameter. */
export interface FreshCallPlacement {
	tmuxSession: string;
}

/** Which rule chose the start directory. Mirrors `FreshCallSeatSource` deliberately: one axis,
 * one NAMED source, and no third value that means "we worked it out". `codex-caller-record` is
 * the codex caller's own record cwd, consulted only when the caller requested none (#95 lane C).
 */
export type FreshCallCwdSource = "requested" | "codex-caller-record";

export type FreshCallSeatSource = "requested" | "codex-title-anchor";
export interface FreshCallSeat {
	tmuxSession: string;
	source: FreshCallSeatSource;
}

/**
 * WHICH RULE PICKS THE TARGET SESSION. Three in strict order, and the order is the contract:
 *
 *   1. an explicit `placement` — the expert override, and it wins over everything below.
 *   2. a CODEX CALLER with placement omitted — the sibling opens beside the caller's own TUI
 *      pane, found by the title anchor (#95 lane B). This one is NOT a named seat and is
 *      therefore not decided here: it resolves to a native `$id` with no name in between, so
 *      `freshCall` owns it directly (see the anchor step below) and this function answers
 *      `null` so the name grammar and the name→id lookup stay out of a path that has neither.
 *   3. anything else — the caller's own session, with no named seat at all.
 *
 * THE SEAT FOLLOWS THE CALLER, NEVER THE BACKEND BEING OPENED. #95 first shipped a fourth rule —
 * an omitted-placement Codex TARGET selected a fixed existing session named `codex`, where the
 * operator seated the app-server and their TUIs — and #95 D1 retired it (GLG, 2026-09-16). It
 * was a workaround for a mapping that did not exist yet: nothing could find the pane a Codex
 * caller was sitting in, so the operator was asked to keep every Codex in one known room. Rule 2
 * is that mapping, so the room is no longer load-bearing, and keeping it would have meant Codex
 * alone answering "where does a sibling open?" differently from every other backend. The
 * operator-owned app-server keeps its own seat wherever the operator puts it; Entwurf still
 * never creates, moves or supervises it.
 */
export function selectFreshCallSeat(placement: FreshCallPlacement | undefined): FreshCallSeat | null {
	if (placement !== undefined) return { tmuxSession: placement.tmuxSession, source: "requested" };
	return null;
}

/** Coordinates plus what was handed to tmux. Read `runtimePath` as "what we asked to start".
 * There is deliberately NO field here for the callback, the nonce's arrival, or the sibling's
 * garden id — see the module header. */
export interface FreshCallReceipt extends WindowHandle {
	backend: FreshCallBackend;
	model: string;
	/** The start directory this launch CHOSE — present only when one was chosen: the caller's
	 * requested cwd, or a codex caller's own record cwd when it requested none. The same kind of
	 * fact as `runtimePath`: what tmux was asked for, never an observation of where the pane
	 * landed. ABSENT means no directory was named at all and the pane inherits this process's —
	 * that inheritance is not invented into a receipt field here. */
	cwd?: string;
	/** Which rule chose `cwd`. Present exactly when `cwd` is. */
	cwdSource?: FreshCallCwdSource;
	/** The caller-REQUESTED session name. The RESOLVED target is the inherited `sessionId`, which
	 * is the session the window is actually in. Absent for `codex-title-anchor`, which has no
	 * name to echo: a caller's own pane was OBSERVED, not requested by name, and inventing one
	 * here would report a seat the caller never named. */
	tmuxSession?: string;
	/** Which rule selected the target session. Absent exactly when the caller's own session was
	 * used with no seat rule at all. */
	tmuxSessionSource?: FreshCallSeatSource;
	runtimePath: string;
	nonce: string;
}

export type FreshCallResult = { ok: true; receipt: FreshCallReceipt } | { ok: false; reason: FreshCallRejectReason };

/**
 * The pi identity carrier, scrubbed at the launch seam for EVERY backend (#87 Bundle C).
 *
 * `[측정]` 2026-08-30, private tmux server: a `new-window` pane inherits the tmux SERVER's
 * environment, not the caller's. A server started from a shell that exported `PI_SESSION_ID`
 * hands that value to every window it will ever open — the control run printed
 * `SID=[leaked-uuid]` in a pane the caller never touched. Nothing about the fresh call creates
 * that leak and nothing about it notices: the sibling's own MCP child would read the STALE pair
 * as its authoritative identity and call home as a citizen it is not (`mcp/entwurf-bridge/
 * src/index.ts:692-698` keeps the measured incident — a fresh cell answering with the uuidv7 it
 * found in the environment, confidently and wrong).
 *
 * `-e VAR=` sets the variable EMPTY rather than unsetting it, which tmux has no per-window form
 * for. That is sufficient and not a compromise: every reader of the carrier trims and tests
 * truthiness (`index.ts:212-217`), so empty and absent are the same answer by construction.
 *
 * It is applied to all five backends because the leak is a property of tmux, not of a vendor. A
 * scrub only on the backend whose measurement surfaced it would encode the claim that the other
 * four are immune, which is false. It costs the legitimate case nothing: a carrier is only ever
 * authoritative when the process that owns it exported it ITSELF, and a fresh `pi` sibling does
 * exactly that after this argv has run. This is a fixed seam and deliberately NOT a general env
 * carrier — an arbitrary `-e` passthrough would hand callers the environment-shaping power this
 * rail exists to refuse. Two more `-e` assignments ride beside the scrub: the callback pair
 * (`callback-env.ts`), launcher-computed, so the sibling's first action does not retype an
 * address out of prose.
 */
const SCRUBBED_INHERITED_ENV = ["PI_SESSION_ID=", "PI_AGENT_ID="] as const;

/** Launch argv: the leaf's detached-append shape, the identity scrub, optionally `-c` at the
 * resume-symmetric token position (after `-t`, before `-P -F`), the runtime, then the backend's
 * dialect. An omitted cwd adds no `-c` carrier at all.
 *
 * The first parameter is the TARGET session id, not the caller's placement. Since #105 those
 * are not always the same session, and taking a `Placement` here would invite exactly the
 * defect this signature prevents: copying the caller's own id into a cross-session launch. A
 * name never reaches this function — the seat is resolved to a native `$id` before it is
 * called, and `assertSelector` refuses anything that is not one. `-d` is not optional: without
 * it a window opened into another session steals that session's focus (measured). */
export function buildFreshCallArgs(
	targetSessionId: string,
	runtimePath: string,
	backendArgs: readonly string[],
	cwd: string | undefined,
	callback: { target: string; nonce: string },
): string[] {
	assertSelector("session", targetSessionId);
	assertLaunchTarget(runtimePath);
	if (cwd !== undefined) {
		const bad = classifyTmuxCwd(cwd);
		if (bad) throw new Error(`mux-fresh-call: refusing to build argv with an unusable cwd (${bad}): ${cwd}`);
	}
	return [
		"new-window",
		"-d",
		"-a",
		...SCRUBBED_INHERITED_ENV.flatMap((assignment) => ["-e", assignment]),
		...callbackEnvAssignments(callback).flatMap((assignment) => ["-e", assignment]),
		"-t",
		`${targetSessionId}:{end}`,
		...(cwd === undefined ? [] : ["-c", cwd]),
		"-P",
		"-F",
		APPEND_FORMAT,
		"--",
		runtimePath,
		...backendArgs,
	];
}

/**
 * Open the sibling. Order is the safety argument, same as `launchPi`: validate the caller's
 * identity and task, resolve and prove the runtime, re-read the caller's placement and refuse a
 * changed context — and only then mutate. Nothing above can leave a window behind.
 *
 * `callerGardenId` is supplied by the SURFACE that registered this tool, from its own
 * record-backed context. It is not a tool parameter and this module never derives, validates
 * against a store, or guesses it: an empty value is a named refusal, not a lookup.
 *
 * `callerNativeSessionId` is supplied by the same surface under the same rule, and its PRESENCE
 * is the whole signal: it is set exactly when the reconciled sender is a record-backed codex
 * citizen, and it carries that citizen's `nativeSessionId` (the `_meta.threadId` the vendor put
 * on this very request). This module never resolves it, never reads `_meta`, and never asks a
 * store who is calling — it only turns a thread id into a pane, and only for placement.
 *
 * `callerCwd` rides the same surface rule and the same condition: it is that codex citizen's
 * RECORD cwd, and it exists because a codex caller's process directory is NOT its own (the
 * bridge runs as a child of the operator-owned app-server, so the directory that process
 * reports is the app-server's — #95 lane C §2). It is consulted only when the caller requested
 * no cwd, so an
 * explicit request always wins, and this module never looks a cwd up, resolves it, or infers it
 * from a seat, a workspace map or a project name.
 */
export function freshCall(
	params: {
		backend: FreshCallBackend;
		model: string;
		task: string;
		cwd?: string;
		placement?: FreshCallPlacement;
		callerGardenId: string | null;
		callerNativeSessionId?: string;
		callerCwd?: string;
	},
	env: NodeJS.ProcessEnv = process.env,
	nonce: string = mintNonce(),
): FreshCallResult {
	// The caller-facing input contract lives in the composition leaf so BOTH rails answer a
	// mistyped model or an oversized task with the same words. Order, trimming and the
	// cwd-omission rule (`undefined` and the exact empty string, and nothing else, mean "no
	// cwd") are unchanged from when they lived here.
	const normalized = normalizeFreshCallInputs(params);
	if (!normalized.ok) return { ok: false, reason: normalized.reason };
	const { callerGardenId, model, task, cwd: requestedCwd } = normalized.inputs;
	// The caller's own record directory answers the SAME two-value emptiness rule the leaf
	// applies to a requested cwd, and is consulted ONLY second: an explicit request always wins,
	// and a caller that supplies neither leaves the pane to inherit this process's directory
	// exactly as before — a pi caller's argv is byte-identical, because its process directory IS
	// its own and a `-c` token would change nothing about where that window lands.
	const callerCwd = params.callerCwd === undefined || params.callerCwd === "" ? undefined : params.callerCwd;
	const chosenCwd: { value: string; source: FreshCallCwdSource } | undefined =
		requestedCwd !== undefined
			? { value: requestedCwd, source: "requested" }
			: callerCwd !== undefined
				? { value: callerCwd, source: "codex-caller-record" }
				: undefined;
	const cwd = chosenCwd?.value;
	// SEAM (#95 lane C): a caller-record directory is classified by the SAME shared leaf and
	// answers the same four `cwd-*` reasons, whose hint text says REQUESTED. When a codex
	// caller's recorded directory has since been deleted, the repair that hint points at is
	// still the right one — that directory does not exist — but the noun belongs to the caller
	// rather than to the request. Kept shared on purpose: doubling the reason set for a wording
	// difference would double the refusal contract two surfaces and one leaf already agree on.
	if (cwd !== undefined) {
		const badCwd = classifyTmuxCwd(cwd);
		if (badCwd) return { ok: false, reason: badCwd };
	}
	// The seat's NAME is classified here, beside the cwd and for the same reason: it is decidable
	// without tmux, so an unresolvable name is answered before anything else runs. Whether that
	// session EXISTS is a tmux question and is asked below, after the caller's own context is
	// proven — a name check that needed a live server would refuse for the wrong reason on a
	// host with no tmux at all. An explicit seat is an expert override and is reported as such; a
	// CODEX CALLER's own pane is deliberately not a name at all, so it is absent here and
	// resolved after the context proof below — see `selectFreshCallSeat` for the three-rule order.
	const selectedSeat = selectFreshCallSeat(params.placement);
	const seat = selectedSeat?.tmuxSession;
	if (seat !== undefined) {
		const badSeat = classifyTmuxSessionName(seat);
		if (badSeat) return { ok: false, reason: badSeat };
	}

	let runtimePath: string;
	try {
		runtimePath = resolveRuntimeOnPath(FRESH_CALL_RUNTIME[params.backend], env);
	} catch (err) {
		if (err instanceof LaunchPreconditionError) return { ok: false, reason: err.reason };
		throw err;
	}

	// Backend capability, still PRE-MUTATION (step 9 clause 3). It runs AFTER the runtime is
	// proven, because "entwurf is not on PATH" is the more fundamental answer — telling an
	// operator to run `entwurf install-copilot-bridge` when they have no `entwurf` at all sends
	// them to the wrong repair. It runs BEFORE placement for the reason this whole ordering
	// exists: a refusal here cannot leave a window behind, while the launcher's own equivalent
	// check (receiver only, manual `entwurf copilot`) necessarily runs after one is open.
	if (params.backend === "copilot") {
		const missing = copilotFreshPreflight(env);
		if (missing) return { ok: false, reason: missing };
	}
	if (params.backend === "omp") {
		const missing = ompFreshPreflight(env);
		if (missing) return { ok: false, reason: missing };
	}
	const inspected = inspectPlacement(env);
	if (!inspected.ok) return { ok: false, reason: inspected.reason };
	const placement = inspected.placement;
	requireSameContext("freshCall", placement, env);

	// The caller's own context is now proven, which is what makes the next lookup's exit code
	// readable as "that session is not here" rather than "there is no server". Only the resolved
	// native id continues; the name does not travel past this line. STILL PRE-MUTATION: an
	// absent seat refuses with no window anywhere.
	let targetSessionId = placement.sessionId;
	let anchoredSeat = false;
	if (seat !== undefined) {
		const resolved = resolveTmuxSessionId(seat, (args) => runTmux(args, env));
		if (!resolved.ok) return { ok: false, reason: resolved.reason };
		targetSessionId = resolved.sessionId;
	} else if (params.placement === undefined && params.callerNativeSessionId !== undefined) {
		// Rule 2: the caller is a codex citizen and named no seat, so the sibling belongs beside
		// the caller's own TUI. The pane is found by the title anchor and ONLY its `$session`
		// continues — a pane title is forgeable, so it may never become an address, a liveness
		// claim or a delivery input (Hard Rule 16). `params.placement` is re-read here rather
		// than inferred from `seat === undefined`: "an explicit seat always wins" is the one
		// invariant a later edit must not be able to lose by accident.
		// STILL PRE-MUTATION: 0 or 2+ matching panes refuse with no window anywhere and no
		// fallback to any other session.
		const anchor = resolveCodexCallerSeat(params.callerNativeSessionId, (args) => runTmux(args, env));
		if (!anchor.ok) return { ok: false, reason: anchor.reason };
		targetSessionId = anchor.seat.sessionId;
		anchoredSeat = true;
	}

	const composition: FreshCallComposition = {
		prompt: buildFreshCallPrompt({
			backend: params.backend,
			task,
			callerGardenId,
			nonce,
		}),
		bootstrapPayload: buildOmpBootstrapPayload({ callerGardenId, nonce, task }),
	};
	const backendArgs = buildBackendArgs(params.backend, composition, model, env, cwd);
	// THE LAUNCH-DIRECTORY NOTE, AND IT IS A DIAGNOSTIC RATHER THAN A GATE. `[측정 2026-09-16]` a
	// Codex sibling opened into a directory this Codex has no answer for stops on the vendor's
	// folder-consent screen: no first turn, no rollout, no callback. It is tempting to refuse
	// that, and refusing is the wrong product. The consent screen is SELF-REPAIRING when a human
	// is there — one answer and the vendor records the directory, so every later launch runs —
	// and an operator at the keyboard is exactly who a visible-first rail is built for. A refusal
	// would replace that one answer with "no window, go run codex yourself, then call again", and
	// it would have to be right about a decision this process cannot fully see (the vendor merges
	// system, managed and cloud layers around the file this leaf reads). So the launch proceeds
	// and says what it saw.
	//
	// The UNATTENDED case is not answered here and must not be: a gate with nobody at the keyboard
	// needs its precondition named before it spends a model turn, which is its own oracle's job —
	// `smoke-codex-fresh-live` asserts this same leaf up front, so a missing answer reads as a
	// named precondition instead of a callback timeout.
	//
	// The directory asked about is READ BACK off codex's own `-C` token rather than recomputed:
	// one resolution, one authority, and no way for the note to name a directory the thread will
	// not start in (this module is deliberately not allowed to resolve the inherited default a
	// second time — `FRESHCALL-CWD-CALLER-ONLY`).
	if (params.backend === "codex") {
		const at = backendArgs.indexOf("-C");
		const launchCwd = backendArgs[at + 1] ?? "";
		const unanswered = codexLaunchCwdFreshPreflight(env, launchCwd);
		if (unanswered) {
			console.error(
				`[fresh-call] ${unanswered}: ${launchCwd}\n` + `            ${CODEX_LAUNCH_CWD_PREFLIGHT_HINT[unanswered]}`,
			);
		}
	}
	const run = runTmux(
		buildFreshCallArgs(targetSessionId, runtimePath, backendArgs, cwd, {
			target: callerGardenId,
			nonce,
		}),
		env,
	);
	assertTmuxOk("new-window", run);

	let fields: ReturnType<typeof parseWindowFields>;
	try {
		fields = parseWindowFields(run.stdout);
	} catch (err) {
		// The window exists and its id is precisely what could not be read. Diffing the inventory
		// to find "the new one" is the guess this rail forbids everywhere else, so name the orphan.
		throw new Error(
			`mux-fresh-call: launched ${runtimePath} but could not read the window handle tmux printed — a window may ` +
				`be open in session ${targetSessionId} that this call cannot identify or close: ${
					err instanceof Error ? err.message : String(err)
				}`,
		);
	}

	return {
		ok: true,
		receipt: {
			serverPid: placement.serverPid,
			sessionId: targetSessionId,
			...fields,
			backend: params.backend,
			model,
			...(chosenCwd === undefined ? {} : { cwd: chosenCwd.value, cwdSource: chosenCwd.source }),
			...(selectedSeat === null
				? anchoredSeat
					? { tmuxSessionSource: "codex-title-anchor" as const }
					: {}
				: { tmuxSession: selectedSeat.tmuxSession, tmuxSessionSource: selectedSeat.source }),
			runtimePath,
			nonce,
		},
	};
}

/** Why each refusal happened, in the caller's terms. A reason a caller cannot act on is a reason
 * they will guess about. */
const REJECT_HINT: Record<FreshCallRejectReason, string> = {
	// The Copilot capability reasons keep their repair text on the leaf that decides them, so
	// the sentence an operator reads cannot drift away from the predicate that produced it.
	...COPILOT_PREFLIGHT_HINT,
	...OMP_PREFLIGHT_HINT,
	...CODEX_PREFLIGHT_HINT,
	...CODEX_CALLER_PREFLIGHT_HINT,
	...CODEX_CALLER_SEAT_HINT,
	"no-tmux-context": "this agent is not running inside tmux, so there is no session to open a sibling beside",
	"anchor-malformed": "TMUX_PANE is not a native pane id",
	"anchor-unresolved": "tmux resolved no pane for this agent's anchor",
	"anchor-mismatch": "tmux answered about a different pane than the one asked about",
	"caller-identity-unavailable":
		"this surface has no record-backed garden id for the caller, so the sibling would have no address to call back to",
	"cwd-not-absolute":
		"the requested cwd is not an absolute path (the value is taken literally — nothing trims or resolves it)",
	"cwd-format-token":
		"the requested cwd contains '#', which tmux expands as a format inside -c — it would silently rewrite the path or run a command",
	"cwd-missing":
		"the requested cwd does not exist; tmux would not report this, it would open the window in $HOME and look successful",
	"cwd-not-directory": "the requested cwd exists but is not a directory",
	"tmux-session-name-invalid":
		"the requested tmux session name is outside the shape this rail addresses (start with a letter or digit, then letters, digits, '_' or '-') — some other shapes tmux cannot resolve at all ('#' is expanded when the name is stored; '.' and ':' are its own pane/window separators inside a target; a name like '$0' loses to the session id '$0'), and the rest are declined to keep one narrow grammar, so rename the session or open one whose name fits",
	"tmux-session-missing":
		"no session with that exact name answers on this agent's tmux server (or that server stopped answering) — nothing was created, so open the session yourself and call again",
	"model-empty": "model is empty after trimming; fresh calls require an explicit model",
	"model-invalid": `model must be one ${MODEL_MAX_CHARS}-character argv-safe id/alias without whitespace or tmux syntax`,
	"task-empty": "task is empty after trimming",
	"task-too-long": `task exceeds ${TASK_MAX_CHARS} characters`,
	"runtime-unresolved": "the backend's runtime is not installed on PATH",
	"runtime-not-absolute": "the resolved runtime path is not absolute",
	"runtime-path-whitespace": "the resolved runtime path contains whitespace, which tmux would re-split",
	"runtime-missing": "nothing exists at the resolved runtime path",
	"runtime-not-regular-file": "the resolved runtime path is not a regular file",
	"runtime-not-executable": "the resolved runtime path is not executable",
};

/**
 * ONE renderer for both surfaces. Not a convenience: the two registrations are separate literals
 * (that is this repo's shape), so a shared renderer is what keeps the operator-visible answer
 * from drifting apart between native pi and the MCP bridge.
 *
 * The success text states the boundary out loud. A caller that reads "launched" and assumes
 * "delivered" is the exact confusion the two-receipt split exists to prevent, so the text refuses
 * to imply it.
 */
export function renderFreshCall(result: FreshCallResult): { text: string; isError: boolean } {
	if (!result.ok) {
		return {
			text: `entwurf_fresh_call rejected: ${result.reason} — ${REJECT_HINT[result.reason]}. No window was opened.`,
			isError: true,
		};
	}
	const r = result.receipt;
	return {
		text:
			`[entwurf fresh call →]\n` +
			`  backend:  ${r.backend} (${r.runtimePath})\n` +
			`  model:    ${r.model} (requested on the runtime CLI)\n` +
			(r.cwd === undefined
				? ""
				: r.cwdSource === "codex-caller-record"
					? `  cwd:      ${r.cwd} (the Codex caller's own record directory, used because no cwd was requested — not an observation)\n`
					: `  cwd:      ${r.cwd} (requested start directory — not an observation)\n`) +
			(r.tmuxSessionSource === undefined
				? ""
				: r.tmuxSessionSource === "codex-title-anchor"
					? `  seat:     ${r.sessionId} (the Codex caller's own pane, found by its thread-id terminal title — an OBSERVED session, not a requested name)\n`
					: `  seat:     ${r.tmuxSession} (requested tmux session, resolved to ${r.sessionId})\n`) +
			`  window:   ${r.windowId} (index ${r.windowIndex}) in session ${r.sessionId}\n` +
			`  pane:     ${r.paneId} pid ${r.panePid}\n` +
			`  nonce:    ${r.nonce}\n` +
			`\n` +
			`This is a LAUNCH receipt: tmux created that window and was asked to start the runtime with the model above. It does ` +
			`NOT mean the sibling is running, that its first turn ran, or that the task was delivered.\n` +
			`The sibling's garden id arrives separately — it calls entwurf_v2 back with the nonce above as its ` +
			`first action, and the sender envelope of THAT message is the address. Nothing is polling for it; ` +
			`if it never comes, the window is visible and can be read directly.`,
		isError: false,
	};
}
