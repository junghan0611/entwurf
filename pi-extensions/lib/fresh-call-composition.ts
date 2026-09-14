/**
 * FRESH-CALL COMPOSITION — the part of opening a sibling that is the same wherever the
 * sibling is placed.
 *
 * WHY THIS FILE EXISTS (#116 S2-a). A herdr rail opens the same five-backend dialect, hands the
 * same first-turn framing and mints the same correlation nonce as the tmux rail — but it places
 * the sibling with `pane split` + `agent start` rather than `new-window`, and it cannot inherit
 * one line of tmux placement to get there. Leaving this composition inside `mux-fresh-call.ts`
 * would have forced the herdr module to import that file, and that file imports tmux placement,
 * the launch preflights and the Codex socket resolver. One import would have dragged the whole
 * tmux rail behind it.
 *
 * SO THE FENCE IS THE POINT: this leaf imports NOTHING from `mux-*` or `entwurf-*`. Only the
 * Node standard library. Anything a rail owns arrives as an explicit argument — the opening
 * sentence that says where the sibling was placed, and the Codex socket path. Both are injected
 * rather than resolved here, because resolving either one would re-open the coupling this file
 * exists to close.
 *
 * WHAT DELIBERATELY STAYED BEHIND in `mux-fresh-call.ts`: placement, seat selection, runtime
 * proof, the mutation-order safety argument, and the receipt type. None of those are shared —
 * a herdr coordinate is not a tmux coordinate, herdr abandons pre-mutation runtime proof
 * (#116 D1), and its two-step launch breaks the ordering argument outright.
 */

import { randomBytes } from "node:crypto";

/** The backends this rail can open. Fixed set, not a profile — a further one is a decision,
 * not a config entry. `copilot` was added by #82 RAIL 9, `omp` by #87 Bundle C, and `codex`
 * by #95 after its system birth and app-server rails were measured. The set is joined to the
 * citizen backends by `check-harness-admission-parity`: a harness that mints records but is
 * missing HERE is not an unwired convenience, it is a release blocker. */
export const FRESH_CALL_BACKENDS = ["pi", "claude-code", "copilot", "omp", "codex"] as const;
export type FreshCallBackend = (typeof FRESH_CALL_BACKENDS)[number];

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
	codex: "mcp__entwurf_bridge__entwurf_v2",
};

/**
 * What a launch has to say, in the two shapes the five backends need. Four of them are
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
 * THE CODEX SOCKET IS INJECTED, NOT RESOLVED HERE, and that is the one seam #116 S2-a had to
 * open. `resolveCodexDefaultSocketPath` lives in `native-push/codex-ws-client.ts`, which imports
 * `entwurf-v2-contract` — importing it would have put a delivery-contract module inside the leaf
 * that is supposed to know nothing about delivery. The alternative, re-deriving the path here,
 * would have been a silent second copy of a vendor coordinate. So the caller passes a THUNK: it
 * is evaluated only inside the codex arm, exactly as the inline call was, so a missing HOME still
 * fails only for codex and never for pi.
 */
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
export function composeBackendArgs(
	backend: FreshCallBackend,
	composition: FreshCallComposition,
	model: string,
	resolveCodexSocketPath: () => string,
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
		case "codex":
			return [
				"--remote",
				`unix://${resolveCodexSocketPath()}`,
				"--model",
				model,
				"--dangerously-bypass-approvals-and-sandbox",
				composition.prompt,
			];
	}
}

/**
 * PLACEMENT SENTENCE. The first line names where the sibling was opened, and only the RAIL knows
 * that — "the operator's tmux session" is true of a `new-window` launch and false of a herdr
 * pane. It is therefore supplied by the caller rather than composed here. Everything BELOW that
 * line is rail-independent and stays the contract: the callback is the first action, the task
 * follows it, and the three prohibitions are measured rather than polite.
 */
/**
 * The first-turn framing. Order is the contract: the callback is the FIRST action and the task
 * follows it, so a sibling that gets stuck in the task has already told the caller who it is.
 *
 * The three prohibitions are not politeness. Each names a detour that was measured to produce a
 * confidently wrong answer or a wasted turn.
 */
export function composeFreshCallPrompt(params: {
	backend: FreshCallBackend;
	task: string;
	callerGardenId: string;
	nonce: string;
	/** The rail's own first sentence — see `PLACEMENT SENTENCE` above. Empty is a crash, not a
	 * default: a sibling told nothing about where it is would be told something false by silence. */
	openingLine: string;
}): string {
	const tool = FRESH_CALL_CALLBACK_TOOL[params.backend];
	if (params.openingLine.length === 0) {
		throw new Error("fresh-call composition: openingLine is empty — the rail must state where it placed the sibling");
	}
	return [
		params.openingLine,
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

/** Correlation tag only. Random, never derived from time, cwd or a peer listing — a nonce that
 * encoded any of those would invite exactly the guessing this rail exists to refuse. */
export function mintNonce(randomHex: () => string = defaultRandomHex): string {
	return `mux-fresh-call-${randomHex()}`;
}

function defaultRandomHex(): string {
	return randomBytes(12).toString("hex");
}
