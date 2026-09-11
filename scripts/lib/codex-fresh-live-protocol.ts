/**
 * codex-fresh-live-protocol — the message builders and report filters of the Codex
 * first-admission LIVE, as pure functions a deterministic gate can hold.
 *
 * WHY THIS IS A LEAF NOW, measured. The first real run failed with the right assertion for
 * the wrong reason: the fixture handed the initial Pi ONE message that carried, in one body,
 * the Pi's own numbered steps AND — interpolated in the middle of them — the whole payload
 * the Pi was supposed to forward to Codex. The step that came after the interpolation was
 * still there, so what Codex received (its own transcript, 2026-09-11T04:18:12.215Z) ended
 * with the Pi's LAST step, including the token only the Pi was ever supposed to emit. Codex
 * did exactly what the text said, and the observer then saw the Pi's report arrive from the
 * Codex citizen.
 *
 * A BEGIN/END marker would not have fixed it: the payload was already the last interpolated
 * block, and the model still copied what followed. So the separation here is TEMPORAL and by
 * CARRIER, not typographic:
 *
 *   phase 1  fixture → initial Pi: launch, callback-correlate, and forward the inner payload.
 *            The inner payload is the LAST thing in the message, after an explicit "send
 *            exactly the remainder" boundary, and NOTHING follows it — least of all the token
 *            of a later report. Then the Pi stops.
 *   phase 2  fixture → the SAME initial Pi, a second addressed message, sent only after the
 *            observer already holds Codex's own launch report. It carries the report token
 *            for the first time and asks for facts the Pi already has. It carries no inner
 *            Codex payload and no execution instruction for anybody else.
 *
 * A token that has never been transmitted cannot be emitted by the wrong citizen, and a
 * citizen that was told to stop cannot be mid-forward when the token finally appears.
 *
 * The filters exist for the same reason: `find(body => body.includes(token))` accepts the
 * FIRST body carrying a token and only then asserts who sent it, so a wrong sender ends the
 * wait and fails the run. Selection here is by token AND sender — identity first, assertion
 * after.
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
	for (const body of bodies) {
		if (!body.includes(token)) continue;
		if (reportSender(body) !== expectedSender) continue;
		return body;
	}
	return null;
}

/**
 * The FIRST report from a citizen whose garden id is not known yet — Codex's own launch
 * report. The token narrows the candidates; `isExpectedBackend` decides acceptance, so a
 * body carrying the right token from a Pi sibling is skipped rather than adopted as the
 * Codex address.
 */
export function selectReportByBackend(
	bodies: readonly string[],
	token: string,
	isExpectedBackend: (gardenId: string) => boolean,
): { body: string; sender: string } | null {
	for (const body of bodies) {
		if (!body.includes(token)) continue;
		const sender = reportSender(body);
		if (sender === null || !isExpectedBackend(sender)) continue;
		return { body, sender };
	}
	return null;
}

export interface CodexInstructionInput {
	waitToken: string;
	outboundPiToken: string;
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
		'and task "After your automatic callback succeeds, answer ACK and stop. Do not open another sibling."\n' +
		"2. From its LAUNCH receipt copy the exact nonce, session id, and stable window id. Immediately call public " +
		`mcp__entwurf_bridge__entwurf_v2 once to target ${input.callerGid} with:\n${input.outboundPiToken}\n` +
		"PI_LAUNCH_NONCE=<exact nonce>\nPI_SESSION_ID=<exact $session id>\nPI_WINDOW_ID=<exact @window id>\n" +
		"PI_LAUNCH_RECEIPT=<the launch receipt>\n" +
		"3. Stop and wait for the Pi callback delivered into this Codex thread. Accept only a callback whose body " +
		"repeats that exact nonce and whose sender envelope names a garden id.\n" +
		`4. Only after that match, call public mcp__entwurf_bridge__entwurf_v2 once to target ${input.callerGid} with:\n` +
		`${input.finalToken}\nPI_LAUNCH_NONCE=<same exact nonce>\nPI_CALLBACK_NONCE=<same exact nonce>\n` +
		"PI_CALLBACK_FROM=<sender-envelope garden id>\nPI_SESSION_ID=<same exact $session id>\n" +
		"PI_WINDOW_ID=<same exact @window id>\nDo not claim completion in prose."
	);
}

export interface InitialPiPhaseOneInput {
	initialPiWaitToken: string;
	codexWaitToken: string;
	launchToken: string;
	callerGid: string;
	codexModel: string;
	scratch: string;
	codexInstruction: string;
}

/**
 * Phase 1. The forwarded payload is the tail of the message and the boundary says so; there
 * is nothing after it to copy by accident, and no token of a later phase exists yet.
 */
export function buildInitialPiPhaseOne(input: InitialPiPhaseOneInput): string {
	return (
		`${input.initialPiWaitToken}\nExecute this public-tool chain exactly once; do not use shell, terminal, screen text, or retries:\n` +
		`1. Call entwurf_fresh_call with backend codex, model ${input.codexModel}, cwd ${input.scratch}, and task ` +
		`"After your required callback receipt, wait for the addressed instruction containing ${input.codexWaitToken}."\n` +
		`2. Immediately call entwurf_v2 to target ${input.callerGid} with:\n${input.launchToken}\n` +
		"CODEX_LAUNCH_NONCE=<exact nonce from the LAUNCH receipt>\nCODEX_SESSION_ID=<exact $session id>\n" +
		"CODEX_WINDOW_ID=<exact @window id>\nCODEX_LAUNCH_RECEIPT=<the full launch receipt>\n" +
		"3. Stop and wait for the Codex callback. Accept only a callback carrying that exact nonce; take the Codex " +
		"garden id only from its sender envelope.\n" +
		"4. Call entwurf_v2 once to that callback-derived Codex garden id. Keep the exact receipt that call returns, " +
		"and keep the callback nonce and garden id — you will be asked for all three later.\n" +
		"5. After that call returns, STOP. Send nothing else and contact nobody else; a second addressed message " +
		"will tell you what to report.\n" +
		"THE MESSAGE TO SEND IN STEP 4 IS EVERYTHING BELOW THIS LINE, VERBATIM AND COMPLETE. It ends where this " +
		"message ends, and nothing after it belongs to you.\n" +
		"----- BEGIN MESSAGE FOR THE CODEX SIBLING -----\n" +
		input.codexInstruction
	);
}

export interface InitialPiPhaseTwoInput {
	reportToken: string;
	callerGid: string;
}

/**
 * Phase 2. Sent only once Codex's own report is already in hand, so this token has never
 * crossed a wire before. It asks for facts the Pi already holds and forbids further contact.
 */
export function buildInitialPiPhaseTwo(input: InitialPiPhaseTwoInput): string {
	return (
		"This is the second addressed message. You have already opened the Codex sibling, correlated its callback, " +
		"and sent it your addressed message. Do not contact Codex or anybody else again, and do not repeat any " +
		"earlier step.\n" +
		`Report what you already have: call entwurf_v2 once to target ${input.callerGid} with:\n${input.reportToken}\n` +
		"CODEX_CALLBACK_NONCE=<the exact launch nonce the Codex callback repeated>\n" +
		"CODEX_CALLBACK_FROM=<the Codex garden id from that callback's sender envelope>\n" +
		"CODEX_ADDRESSED_RECEIPT=<the exact entwurf_v2 receipt your addressed call to Codex returned>\n" +
		"Then stop."
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
