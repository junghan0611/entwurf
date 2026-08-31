/**
 * mux-fresh-call — open ONE visible sibling in the caller's own tmux session, hand it its first
 * task in the launch argv, and let it name itself back to the caller.
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
 *   - the value is classified by the shared `classify-tmux-cwd.ts` leaf BEFORE any mutation
 *     (same four stable reasons as resume; the measured tmux 3.6a facts live on that leaf).
 *     This module's hints phrase them as the REQUESTED cwd; resume's say RECORDED.
 *   - the receipt echoes what was REQUESTED, exactly as `runtimePath` does. It never reports
 *     `pane_current_path`: proving where the pane actually landed belongs to acceptance, not
 *     to the launch receipt.
 */

import { randomBytes } from "node:crypto";
import { classifyTmuxCwd, type TmuxCwdRejectReason } from "./classify-tmux-cwd.ts";
import {
	COPILOT_PREFLIGHT_HINT,
	type CopilotPreflightRejectReason,
	copilotFreshPreflight,
} from "./copilot-fresh-preflight.ts";
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
import { OMP_PREFLIGHT_HINT, type OmpPreflightRejectReason, ompFreshPreflight } from "./omp-fresh-preflight.ts";

/** The backends this rail can open. Fixed set, not a profile — a further one is a decision,
 * not a config entry. `copilot` was added by #82 RAIL 9 under the step 9 admission contract, and
 * `omp` by #87 Bundle C under the same one. The set is joined to the citizen backends by
 * `check-harness-admission-parity`: a harness that mints records but is missing HERE is not an
 * unwired convenience, it is a release blocker. */
export const FRESH_CALL_BACKENDS = ["pi", "claude-code", "copilot", "omp"] as const;
export type FreshCallBackend = (typeof FRESH_CALL_BACKENDS)[number];

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
};

/**
 * The callback tool NAME differs per backend and that is not cosmetic: native pi exposes the
 * capability directly (`entwurf_v2`), while an MCP-hosted session reaches it under whatever
 * name that harness composes. Naming the wrong one costs the whole first turn.
 *
 * `[측정]` Copilot CLI 1.0.80 composes `<mcpServerName>-<mcpToolName>` — NOT Claude Code's
 * `mcp__<server>__<tool>`. Read from two independent sessions' own event logs
 * (`~/.copilot/session-state/<id>/events.jsonl`): `assistant.message.toolRequests[].name` and
 * `tool.execution_start.toolName` both carry `entwurf-bridge-entwurf_v2`, with
 * `mcpServerName`/`mcpToolName` beside them as the parts. Derive-and-measure, never copy a
 * sibling's spelling (`docs/adding-a-harness.md` step 5).
 *
 * `[측정]` omp 18.0.0 is the sharpest case for that rule: it mints
 * `mcp__${sanitizedServerName}_${normalizedToolName}` with a sanitizer whose charset is
 * `[a-z_]` (`mcp/tool-bridge.ts:351-357`, `:396`), so the DIGIT IN `entwurf_v2` IS EATEN and the
 * hyphen in the server key becomes an underscore — the model-facing name is
 * `mcp__entwurf_bridge_entwurf_v`, not `..._entwurf_v2` and not Claude's double-underscore form.
 * Confirmed against a live tool dump of all seven bridge tools and a real session transcript
 * (`scripts/raw-omp-measure/README.md` "Tool-name dialect"). Unlike Copilot there is no second
 * permission dialect: omp's approval layer consults the same minted string (`source-audit.md`).
 */
export const FRESH_CALL_CALLBACK_TOOL: Record<FreshCallBackend, string> = {
	pi: "entwurf_v2",
	"claude-code": "mcp__entwurf-bridge__entwurf_v2",
	copilot: "entwurf-bridge-entwurf_v2",
	omp: "mcp__entwurf_bridge_entwurf_v",
};

/** Mirrors the `entwurf_v2` message bound. This is an INTERFACE cap for symmetry with the
 * delivery surface, not a claim that a task of this size was measured through tmux. An argv
 * that the OS refuses is a launch failure and fails loud — it never reads as a delivered task. */
export const TASK_MAX_CHARS = 16000;
export const MODEL_MAX_CHARS = 200;
const MODEL_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._/:[\]-]*$/;

/** A model is an explicit launch input, not ambient process state. The grammar admits canonical
 * pi provider/model ids, Claude model ids/aliases, and bracketed context variants, while refusing
 * whitespace and tmux control syntax. It is passed without a shell using each runtime's measured
 * CLI dialect: Pi takes `--model`, value; Claude Code takes `--model=value`. */
export function isSafeFreshCallModel(model: string): boolean {
	return model.length > 0 && model.length <= MODEL_MAX_CHARS && MODEL_PATTERN.test(model);
}

/**
 * Backend argv AFTER the runtime path. Both orders are MEASURED, and both were measured by
 * getting them wrong first (rail §6-a):
 *
 *   pi          — prompt BEFORE `--entwurf-control`, then `--model`, value as TWO tokens.
 *                 Flag-first submitted no message; Pi rejects the equals form for `--model`.
 *   claude-code — prompt, then `--allowedTools=` and `--model=` as ONE token each. The space form
 *                 for allowedTools is variadic and eats the prompt as an option value.
 *   copilot     — the managed VERB first, then the prompt as the value of `-i/--interactive`,
 *                 `--model`, value as two tokens, and the policy as the explicit `--yolo`
 *                 token. Measured from `copilot --help` (1.0.80).
 *   omp         — NO positional prompt at all. The task rides `--entwurf-bootstrap`, a fixed
 *                 flag the installed birth extension registers, then `--model`, value as two
 *                 tokens, then the policy as `--approval-mode`, `yolo`. `-p/--print` remains
 *                 the flag this argv must never carry — it processes a prompt and EXITS,
 *                 closing the window on a sibling that has to stay open to be delivered to.
 *
 * Both pi/claude failures looked identical from outside: window open, record and socket minted,
 * no turn.
 *
 * For pi and claude-code the equals form is NOT a permission guarantee — on the measured host
 * the tool was already permitted, so the option's effect was unobservable. What was observed is
 * that it does no harm to the argv. Permission stays a documented host precondition there.
 *
 * Copilot is the backend where the policy IS carried explicitly (step 9 clause 2), and three of
 * its argv facts are load-bearing:
 *
 *   - `copilot` is argv[0] of the RUNTIME `entwurf`, i.e. the managed verb — see
 *     `FRESH_CALL_RUNTIME`. Everything after it is forwarded byte-identical by
 *     `scripts/copilot-launch.sh`.
 *   - the prompt rides `--interactive`, never `-p/--prompt`: `-p` runs the prompt and EXITS,
 *     which would close the window on a sibling that is supposed to stay open and be delivered
 *     to. `--interactive <prompt>` is non-variadic, so the space form is safe here.
 *   - the policy token is `--yolo`, STATED HERE rather than left to the launcher: the launcher
 *     injects `--yolo` only when the argv names no policy, and step 9 clause 2 requires the
 *     fresh composition to state its model and permission policy explicitly, never to rely
 *     invisibly on someone else's default.
 *
 * `--yolo` is a GLG operator decision, not a drifted default. The first cut passed a
 * callback-only `--allow-tool=entwurf-bridge(entwurf_v2)` grant, and GLG's 2026-08-25 operator
 * LIVE measured the consequence: the fresh sibling's footer showed no `YOLO`, and every tool
 * its task needed stopped on a confirmation prompt, which made the sibling impractical to work
 * with. GLG then set the policy explicitly: a fresh Copilot sibling carries the same managed
 * `--yolo` profile a human-typed `entwurf copilot` gets. (Copilot 1.0.80 help: `--yolo` = all
 * tools + all paths + all URLs.) The permission GRAMMAR lesson from that first cut — Copilot's
 * `--allow-tool` takes `<mcp-server-name>(tool-name?)`, a different dialect from the
 * model-facing tool name — stays recorded in `docs/adding-a-harness.md` step 9's worked
 * example; it is a measured vendor fact even though this argv no longer uses it.
 *
 * OMP'S POLICY TOKEN IS THE ONE MOST EASILY ARGUED AWAY, SO READ THIS BEFORE DELETING IT.
 * `[측정]` omp 18.0.0's schema default for `tools.approvalMode` IS ALREADY `yolo`
 * (vendor doc `omp://approval-mode.md`; `omp config get tools.approvalMode` → `yolo` on the
 * acceptance host). So dropping `--approval-mode yolo` changes NOTHING observable: the callback
 * still fires, the LIVE smoke still passes, and the argv silently starts depending on a vendor
 * default and on whatever the operator's config happens to say. That is exactly the drift step 9
 * clause 2 forbids — "carry the chosen width as an explicit argv token rather than relying on a
 * launcher's injected default" — and the reason the width is stated here even though the host
 * would have granted it anyway. The width itself (task-wide, not callback-only) is a GLG
 * operator decision of 2026-08-30, taken with the Copilot measurement in hand: a callback-only
 * sibling names itself and then stops at the first tool its TASK needs. omp offers no argv
 * grammar for a narrower grant at all — `tools.approval.<tool>` is a config axis, not a flag —
 * so the honest choice was between `write` and `yolo`, and `yolo` matches what a human-typed
 * `omp` gets on this host. `--approval-mode` takes both the space and equals form (measured);
 * the space form is used for symmetry with `--model`.
 *
 * WHY OMP ALONE CARRIES NO PROMPT, AND WHY THAT IS A MEASUREMENT RATHER THAN A PREFERENCE.
 * `[LIVE 2026-08-30]` the first public fresh call at omp DID pass the full framing as a bare
 * positional. The window opened, the record minted (garden `20260830T181342-452167`), the
 * prompt arrived byte-identical as a user message at `09:13:42.413Z` — and the model answered
 * the literal text `ACK` with ZERO tool calls, because the callback tool did not exist yet.
 * `[source]` the interactive UI defers MCP discovery and only refreshes the tool list once
 * `discoverAndConnect()` settles (`sdk.ts:1847-1855`, `:1881-1905`), while the positional
 * `initialMessage` prompts immediately after `await mode.init()` (`main.ts:540-565`,
 * `595-610`). `[측정]` a `/tmp` observer on the same runtime: `turn_start` at +654ms with the
 * entwurf tools ABSENT, callback tool present only at +1484ms — the turn began ~830ms before
 * the tool it was told to call existed. No argv can close that gap, because the gap is a race
 * inside the host. So the composition hands omp a PAYLOAD instead of a turn, and the
 * in-process birth extension — which can see when the tool becomes callable — owns the first
 * two messages (`pi-extensions/meta-bridge-omp.ts`, "THE TWO-STAGE FRESH BOOTSTRAP").
 *
 * The flag is fixed and one-purpose ON PURPOSE. `[측정 2026-08-30]` a normal discovered
 * extension that registers a flag receives the operator's argv value byte-identical — quotes,
 * `$VAR`, backticks and a semicolon all survived a 137-byte JSON payload — because extensions
 * load before argv classification and the reparse writes the registered map
 * (`main.ts:1799-1810`, `cli/extension-flags.ts:36-43`). An env carrier or a temp file would
 * have needed its own quoting, its own lifetime and its own refusal rules; argv already owns
 * all three. This is deliberately NOT a general `--flag value` passthrough — an arbitrary
 * carrier would hand callers the launch-shaping power this rail exists to refuse.
 */
export function buildBackendArgs(
	backend: FreshCallBackend,
	composition: FreshCallComposition,
	model: string,
): string[] {
	switch (backend) {
		case "pi":
			return [composition.prompt, "--entwurf-control", "--model", model];
		case "claude-code":
			return [composition.prompt, `--allowedTools=${FRESH_CALL_CALLBACK_TOOL["claude-code"]}`, `--model=${model}`];
		case "copilot":
			return ["copilot", "--interactive", composition.prompt, "--model", model, "--yolo"];
		case "omp":
			return [`--${OMP_BOOTSTRAP_FLAG}`, composition.bootstrapPayload, "--model", model, "--approval-mode", "yolo"];
	}
}

/**
 * What a launch has to say, in the two shapes the four backends need. Three of them are
 * handed a first-turn PROMPT; omp is handed a bootstrap PAYLOAD its own installed extension
 * unpacks. Both are always built, because building one is cheap and a backend switch must
 * never be able to reach a field that was not composed.
 */
export interface FreshCallComposition {
	prompt: string;
	bootstrapPayload: string;
}

/**
 * The omp bootstrap flag, spelled WITHOUT dashes — the vendor's flag map is keyed by bare
 * name (`extensions/loader.ts:221-228`) and this composition adds the `--` itself.
 *
 * Held equal to the installed extension's own constant by
 * `test/omp-fresh-bootstrap.contract.test.ts`. The two copies exist because the extension
 * ships INSIDE the omp agent dir carrying only its own small closure and cannot import this
 * module; the gate is what keeps the duplication from becoming drift.
 */
export const OMP_BOOTSTRAP_FLAG = "entwurf-bootstrap";

/** Payload grammar version, matched exactly by the decoder. A bump means a stale installed
 * unit, which is the one thing `doctor-omp-bridge` exists to say out loud. */
export const OMP_BOOTSTRAP_VERSION = 1;

/**
 * The whole of what a fresh omp sibling is launched with.
 *
 * THREE FIELDS, CLOSED. The decoder refuses an unknown key, so this object is the entire
 * contract: who to call back, the nonce that proves it is this call, and the task that is
 * released only after that callback succeeds. There is no command here, no path, no env name
 * and no model — the model is already an explicit argv token, and a second copy of it inside
 * a payload would be a second place for it to disagree with the launch.
 */
export function buildOmpBootstrapPayload(params: { callerGardenId: string; nonce: string; task: string }): string {
	return JSON.stringify({
		v: OMP_BOOTSTRAP_VERSION,
		target: params.callerGardenId,
		nonce: params.nonce,
		task: params.task,
	});
}

/**
 * The first-turn framing. Order is the contract: the callback is the FIRST action and the task
 * follows it, so a sibling that gets stuck in the task has already told the caller who it is.
 *
 * The three prohibitions are not politeness. Each names a detour that was measured to produce a
 * confidently wrong answer or a wasted turn.
 */
export function buildFreshCallPrompt(params: {
	backend: FreshCallBackend;
	task: string;
	callerGardenId: string;
	nonce: string;
}): string {
	const tool = FRESH_CALL_CALLBACK_TOOL[params.backend];
	return [
		"You are a fresh visible citizen that entwurf opened in the operator's tmux session.",
		"",
		`FIRST ACTION, before reading files or anything else: call ${tool} with ` +
			`target=${params.callerGardenId}, intent=fire-and-forget, wants_reply=false, and ` +
			`message set to exactly ${params.nonce} — that string alone, nothing added.`,
		"That call is how the agent that opened you learns your address. Do not skip it, do not",
		"defer it until the task is done, and do not reword the message.",
		"",
		"Do not inspect environment variables, do not call entwurf_self, and do not start an MCP",
		"server yourself. Your own report of your identity is not the address anyone needs.",
		"",
		"After the tool receipt, carry out this task:",
		"",
		params.task,
	].join("\n");
}

/** A launch that was refused, or a placement that could not be established. Every value is a
 * NAMED refusal — this module has no fallback launch and no fallback directory. The cwd members
 * come from the shared classification leaf and their string values are stable contract. */
export type FreshCallRejectReason =
	| PlacementRejectReason
	| LaunchRejectReason
	| TmuxCwdRejectReason
	| CopilotPreflightRejectReason
	| OmpPreflightRejectReason
	| "caller-identity-unavailable"
	| "model-empty"
	| "model-invalid"
	| "task-empty"
	| "task-too-long";

/** Coordinates plus what was handed to tmux. Read `runtimePath` as "what we asked to start".
 * There is deliberately NO field here for the callback, the nonce's arrival, or the sibling's
 * garden id — see the module header. */
export interface FreshCallReceipt extends WindowHandle {
	backend: FreshCallBackend;
	model: string;
	/** The REQUESTED start directory — present only when the caller supplied one. The same kind
	 * of fact as `runtimePath`: what tmux was asked for, never an observation of where the pane
	 * landed. */
	cwd?: string;
	runtimePath: string;
	nonce: string;
}

export type FreshCallResult = { ok: true; receipt: FreshCallReceipt } | { ok: false; reason: FreshCallRejectReason };

/** Correlation tag only. Random, never derived from time, cwd or a peer listing — a nonce that
 * encoded any of those would invite exactly the guessing this rail exists to refuse. */
export function mintNonce(randomHex: () => string = defaultRandomHex): string {
	return `mux-fresh-call-${randomHex()}`;
}

function defaultRandomHex(): string {
	return randomBytes(12).toString("hex");
}

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
 * It is applied to all four backends because the leak is a property of tmux, not of a vendor. A
 * scrub only on the backend whose measurement surfaced it would encode the claim that the other
 * three are immune, which is false. It costs the legitimate case nothing: a carrier is only ever
 * authoritative when the process that owns it exported it ITSELF, and a fresh `pi` sibling does
 * exactly that after this argv has run. This is a fixed two-variable seam and deliberately NOT a
 * general env carrier — an arbitrary `-e` passthrough would hand callers the environment-shaping
 * power this rail exists to refuse.
 */
const SCRUBBED_INHERITED_ENV = ["PI_SESSION_ID=", "PI_AGENT_ID="] as const;

/** Launch argv: the leaf's detached-append shape, the identity scrub, optionally `-c` at the
 * resume-symmetric token position (after `-t`, before `-P -F`), the runtime, then the backend's
 * dialect. An omitted cwd adds no `-c` carrier at all. */
export function buildFreshCallArgs(
	placement: Placement,
	runtimePath: string,
	backendArgs: readonly string[],
	cwd?: string,
): string[] {
	assertSelector("session", placement.sessionId);
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
		"-t",
		`${placement.sessionId}:{end}`,
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
 */
export function freshCall(
	params: { backend: FreshCallBackend; model: string; task: string; cwd?: string; callerGardenId: string | null },
	env: NodeJS.ProcessEnv = process.env,
	nonce: string = mintNonce(),
): FreshCallResult {
	if (typeof params.callerGardenId !== "string" || params.callerGardenId.length === 0) {
		return { ok: false, reason: "caller-identity-unavailable" };
	}
	const model = params.model.trim();
	if (model.length === 0) return { ok: false, reason: "model-empty" };
	if (!isSafeFreshCallModel(model)) return { ok: false, reason: "model-invalid" };
	const task = params.task.trim();
	if (task.length === 0) return { ok: false, reason: "task-empty" };
	if (task.length > TASK_MAX_CHARS) return { ok: false, reason: "task-too-long" };
	// ONLY `undefined` and the exact empty string mean "no cwd". Everything else is the literal
	// value — deliberately untrimmed, so a whitespace-mangled path is refused loudly by the
	// classification below instead of being silently repaired into a different directory.
	const cwd = params.cwd === undefined || params.cwd === "" ? undefined : params.cwd;
	if (cwd !== undefined) {
		const badCwd = classifyTmuxCwd(cwd);
		if (badCwd) return { ok: false, reason: badCwd };
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

	const composition: FreshCallComposition = {
		prompt: buildFreshCallPrompt({
			backend: params.backend,
			task,
			callerGardenId: params.callerGardenId,
			nonce,
		}),
		bootstrapPayload: buildOmpBootstrapPayload({ callerGardenId: params.callerGardenId, nonce, task }),
	};
	const run = runTmux(
		buildFreshCallArgs(placement, runtimePath, buildBackendArgs(params.backend, composition, model), cwd),
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
			backend: params.backend,
			model,
			...(cwd === undefined ? {} : { cwd }),
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
			(r.cwd === undefined ? "" : `  cwd:      ${r.cwd} (requested start directory — not an observation)\n`) +
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
