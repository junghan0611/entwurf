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
	scratch: string;
}

/** The payload the initial Pi forwards verbatim. It names only Codex's own steps. */
export function buildCodexInstruction(input: CodexInstructionInput): string {
	return (
		`${input.waitToken}\nThis is the addressed instruction from the initial Pi caller. Execute once, with no shell, ` +
		"terminal, screen inspection, or retry:\n" +
		`1. Call public mcp__entwurf_bridge__entwurf_fresh_call once with backend pi, model ${input.piModel}, cwd ${input.scratch}, ` +
		'NO placement, and task "After your automatic callback succeeds, answer ACK and stop. Do not open another sibling."\n' +
		"2. Stop and wait for the Pi callback delivered into this Codex thread. Accept only a callback whose body " +
		"repeats the exact nonce from your LAUNCH receipt and whose sender envelope names a garden id.\n" +
		`3. Only after that match, call public mcp__entwurf_bridge__entwurf_v2 once with target ${input.callerGid}, ` +
		"intent fire-and-forget, wants_reply false, and message:\n" +
		`${input.finalToken}\nPI_LAUNCH_NONCE=<exact launch nonce>\nPI_CALLBACK_NONCE=<same exact nonce>\n` +
		"PI_CALLBACK_FROM=<sender-envelope garden id>\nPI_SESSION_ID=<exact $session id from the LAUNCH receipt>\n" +
		"PI_WINDOW_ID=<exact @window id from the LAUNCH receipt>\nDo not claim completion in prose."
	);
}

export interface InitialPiPhaseOneInput {
	initialPiWaitToken: string;
	codexWaitToken: string;
	codexModel: string;
	scratch: string;
	codexInstruction: string;
}

/** One bounded forwarded payload; source arguments, not model prose, are its oracle. */
export function buildInitialPiPhaseOne(input: InitialPiPhaseOneInput): string {
	return (
		`${input.initialPiWaitToken}\nExecute this public-tool chain exactly once; do not use shell, terminal, screen text, or retries:\n` +
		`1. Call entwurf_fresh_call with backend codex, model ${input.codexModel}, cwd ${input.scratch}, NO placement, and task ` +
		`"After your required callback receipt, end the turn and wait passively for the addressed instruction containing ${input.codexWaitToken}. ` +
		`Do not call shell, sleep, terminal, or any tool to wait."\n` +
		"2. Stop and wait for the Codex callback. Accept only a callback carrying the exact nonce from the LAUNCH " +
		"receipt; take the Codex garden id only from its sender envelope.\n" +
		"3. Call entwurf_v2 once to that callback-derived Codex garden id with intent fire-and-forget, wants_reply false, " +
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
