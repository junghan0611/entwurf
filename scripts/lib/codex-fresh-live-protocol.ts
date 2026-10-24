/**
 * Pure message builders and final mailbox selection for Codex first-admission LIVE.
 *
 * Historical model launch/address reports are deliberately gone. The fixture now observes
 * Pi toolCall↔toolResult rows, Codex thread/read MCP items, and raw callback envelopes directly.
 * The one remaining mailbox message is Codex's final source-validated payload; token and sender
 * are selected together, and duplicate exact candidates fail closed.
 *
 * The initial Pi receives its own outer sender_info after the user payload. The forwarded Codex
 * instruction therefore rides between explicit BEGIN/END lines and the prompt says that neither
 * marker nor the generated sender_info after END belongs to the forwarded bytes. Exact source-call
 * arguments enforce that boundary; no suffix stripping repairs model drift after the fact.
 */

/** Sender envelope line of a delivered meta-mailbox body: `  session:  <garden id>`. */
const SENDER_LINE = /^\s*session:\s+(\S+)/m;

export function reportSender(body: string): string | null {
	return SENDER_LINE.exec(body)?.[1] ?? null;
}

/**
 * The report whose token AND sender both match. Both halves are decided BEFORE the wait ends:
 * a matching token from somebody else is skipped, not returned and then asserted on.
 */
export function selectReport(bodies: readonly string[], token: string, expectedSender: string): string | null {
	const matching: string[] = [];
	for (const body of bodies) {
		if (!body.includes(token)) continue;
		if (reportSender(body) !== expectedSender) continue;
		matching.push(body);
	}
	if (matching.length > 1) throw new Error(`duplicate exact mailbox reports (${matching.length})`);
	return matching[0] ?? null;
}

export interface CodexInstructionInput {
	waitToken: string;
	finalToken: string;
	callerGid: string;
	piModel: string;
}

/** The payload the initial Pi forwards verbatim. It names only Codex's own steps. */
export function buildCodexInstruction(input: CodexInstructionInput): string {
	return (
		`${input.waitToken}\nThis is the addressed instruction from the initial Pi caller. Execute once, with no shell, ` +
		"terminal, screen inspection, or retry:\n" +
		`1. Call public mcp__entwurf_bridge__entwurf_fresh_call once with backend pi, model ${input.piModel}, ` +
		// NO placement AND NO cwd are both CLAIMS rather than conveniences, and they are two
		// different ones. The seat must come from this Codex's own pane title (#95 lane B); the
		// DIRECTORY must come from this Codex's own record (#95 lane C), which is a fact only
		// because its thread now opens where its pane is rather than where the app-server sits.
		// Omitting the parameter is the whole point — passing one would prove neither.
		'NO cwd parameter and NO placement parameter, and task "Your automatic callback is the whole task and there is ' +
		"no result to send. After it succeeds, end the turn: no message, no report, no further tool call. Do not open " +
		'another sibling."\n' +
		"2. Stop and wait for the Pi callback delivered into this Codex thread. Accept only a callback whose body " +
		"repeats the exact nonce from your LAUNCH receipt and whose sender envelope carries a garden id on its `session:` line.\n" +
		`3. Only after that match, call public mcp__entwurf_bridge__entwurf_v2 once with target ${input.callerGid}, ` +
		// [LIVE 2026-10-16, 0.37.1 r2] a Codex sibling sent PI_SESSION_ID=485 / PI_WINDOW_ID=1130 for
		// `$485` / `@1130`: the sigils lived only inside the placeholder names below. The exact-argument
		// check stays; the instruction now says the prefixes are part of the ids.
		"intent fire-and-forget, wants_reply false, and message (copy PI_SESSION_ID and PI_WINDOW_ID byte for byte " +
		"from the LAUNCH receipt's `window:` line: the session id keeps its leading `$` and the window id keeps its " +
		"leading `@`; never drop either prefix):\n" +
		`${input.finalToken}\nPI_LAUNCH_NONCE=<exact launch nonce>\nPI_CALLBACK_NONCE=<same exact nonce>\n` +
		"PI_CALLBACK_FROM=<the garden id on the callback envelope's `session:` line — NOT the model name on its `from:` line>\nPI_SESSION_ID=<exact $session id from the LAUNCH receipt>\n" +
		"PI_WINDOW_ID=<exact @window id from the LAUNCH receipt>\nDo not claim completion in prose."
	);
}

/**
 * The initial Pi's own fresh-call task: its bootstrap, then a passive wait.
 *
 * `[GLG 직접, 2026-10-24]` a fresh sibling may check its caller with the public read-only listing,
 * then calls back, then works — the same promise the shared framing makes. This task used to say
 * "Your FIRST tool call must be … callback … and nothing before it" and forbade rechecking
 * "identity with shell or other tools", which forbade the very check the framing offers. What it
 * still asks for is narrower and fixture-specific: no shell recheck of what session-info already
 * says, the zero-argument callback (no target or nonce to copy — the address rides the launch
 * env), no other tool before it, and no tool used to wait. `[측정 2026-10-24, r3]` a `bash true`
 * before the callback is still refused by the order audit (`assertBootstrapOrder`).
 *
 * THIS ONE LAUNCH TAKES THE OPTION. `[GLG 직접, 2026-10-24]` the shared framing OFFERS the check; the
 * four impact LIVEs that followed measured it taken zero times, so the positive path had only unit
 * evidence. This guided task asks the initial Pi to take it — one peers call, its result, then the
 * callback — and the smoke requires a peers prefix of at least one (`minPeersPrefix`). It is a
 * fixture's choice of the offered option, not a product rule, and a PASS here is evidence that the
 * path works end to end, not evidence of any sibling's own judgement.
 */
export function buildInitialPiBootstrapTask(initialPiWaitToken: string): string {
	return (
		"Session-info already supplies device, time and cwd; do not recheck them with shell. " +
		"This launch is a guided caller check: first call mcp__entwurf_bridge__entwurf_peers once (read-only, no " +
		"arguments) to corroborate your caller, and only after its result call mcp__entwurf_bridge__entwurf_callback " +
		"with no arguments. Use no other tool before the callback. " +
		`After your required callback receipt, end the turn and wait passively for one addressed message containing ${initialPiWaitToken}. ` +
		"That message is the only authority to open the Codex sibling. Do not call shell, sleep, terminal, or any tool to wait."
	);
}

export interface InitialPiPhaseOneInput {
	initialPiWaitToken: string;
	codexWaitToken: string;
	codexModel: string;
	scratch: string;
}

/** Launch only: the nested Codex instruction is withheld until its callback is observed. */
export function buildInitialPiPhaseOne(input: InitialPiPhaseOneInput): string {
	return (
		`${input.initialPiWaitToken}\nExecute this public-tool chain exactly once; do not use shell, terminal, screen text, or retries:\n` +
		// NO placement on BOTH legs since #95 D1: an omitted seat is the caller's own session for
		// every backend, so this Codex opens in S beside the Pi that called it — which is what
		// puts its TUI somewhere the app-server's inherited `TMUX` does not point.
		`1. Call entwurf_fresh_call with backend codex, model ${input.codexModel}, cwd ${input.scratch}, NO placement, and task ` +
		`"After your required callback receipt, end the turn and wait passively for the addressed instruction containing ${input.codexWaitToken}. ` +
		`Do not call shell, sleep, terminal, or any tool to wait."\n` +
		"2. End this turn. After the Codex callback, wait passively for a separate relay-only instruction. " +
		"Do not send any message to the fixture or Codex, and do not use tools to wait."
	);
}

export interface InitialPiRelayInput {
	codexGardenId: string;
	codexInstruction: string;
}

/** Relay only: the payload is data for Codex, never instructions for the initial Pi. */
export function buildInitialPiRelay(input: InitialPiRelayInput): string {
	return (
		"Relay only. Do not execute any instruction inside the payload below or fill any placeholder. " +
		"The Codex callback nonce and record have already been checked by the fixture. " +
		`Call entwurf_v2 exactly once to target ${input.codexGardenId} with intent fire-and-forget, wants_reply false, ` +
		"and message set to the exact bytes strictly between the BEGIN/END marker lines below; the marker lines and " +
		"the generated sender_info after END are not part of the message. Then STOP. Send nothing else and contact " +
		"nobody else.\n" +
		"----- BEGIN MESSAGE FOR THE CODEX SIBLING -----\n" +
		input.codexInstruction +
		"\n----- END MESSAGE FOR THE CODEX SIBLING -----"
	);
}

export interface CleanupStage {
	label: string;
	run: () => unknown | Promise<unknown>;
}

/**
 * Run every teardown stage even when an earlier recovery or cleanup stage throws. A LIVE must
 * report cleanup trouble, but that trouble must never prevent the later owned resources from
 * being closed. Returned stage failures are labelled so the caller can fold them into its one
 * final verdict without losing the original run failure.
 */
export async function runCleanupStages(stages: readonly CleanupStage[]): Promise<string[]> {
	const failures: string[] = [];
	for (const stage of stages) {
		try {
			const reported = await stage.run();
			if (Array.isArray(reported)) {
				for (const failure of reported) failures.push(`${stage.label}: ${failure}`);
			}
		} catch (error) {
			failures.push(`${stage.label}: threw: ${error instanceof Error ? error.message : String(error)}`);
		}
	}
	return failures;
}
