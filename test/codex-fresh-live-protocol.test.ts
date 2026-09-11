import { describe, expect, it } from "vitest";

import {
	buildCodexInstruction,
	buildInitialPiPhaseOne,
	buildInitialPiPhaseTwo,
	reportSender,
	runCleanupStages,
	selectReport,
	selectReportByBackend,
} from "../scripts/lib/codex-fresh-live-protocol.ts";
import { launchReceiptWindows } from "../scripts/lib/launch-receipt-windows.ts";

/**
 * The deterministic half of the second measured Codex first-admission LIVE failure. Nothing
 * here spends a model turn: the failure was in what the fixture WROTE and in how it picked a
 * report out of its own mailbox, and both are text.
 */

const CALLER = "20260911T131734-4774a0";
const CODEX_GID = "20260911T131751-e99496";
const PI_GID = "20260911T131736-13e39b";
const REPORT_TOKEN = "PI-REPORTS-CODEX-ADDRESSED-YH3TQ4S6";
const OUTBOUND_TOKEN = "CODEX-REPORTS-PI-LAUNCH-00D0G76S";

const codexInstruction = buildCodexInstruction({
	waitToken: "CODEX-WAIT-ABC123",
	outboundPiToken: OUTBOUND_TOKEN,
	finalToken: "CODEX-PI-FINAL-XYZ789",
	callerGid: CALLER,
	piModel: "openai-codex/gpt-5.6-luna",
	scratch: "/tmp/fixture",
});

function body(sender: string, text: string): string {
	return `[entwurf received ⟵]\n  from:     x\n  session:  ${sender} (replyable)\n────────\n${text}\n`;
}

describe("codex fresh-live protocol", () => {
	it("[QK:CODEX-LIVE-PHASE-SEPARATION] never puts the report token in the same message as the forwarded payload", () => {
		const phaseOne = buildInitialPiPhaseOne({
			initialPiWaitToken: "INITIAL-PI-WAIT-O1ZV68XX",
			codexWaitToken: "CODEX-WAIT-ABC123",
			launchToken: "PI-REPORTS-CODEX-LAUNCH-FJKF8RE7",
			callerGid: CALLER,
			codexModel: "gpt-5.6-luna",
			scratch: "/tmp/fixture",
			codexInstruction,
		});
		// The measured failure: the Codex sibling received the Pi's LAST step because it sat
		// after the interpolated payload, and emitted the Pi's token itself. A token that has
		// never been transmitted cannot be emitted by the wrong citizen, so phase one must not
		// carry it — in any form, including the stem the smoke generates it from.
		expect(phaseOne).not.toContain(REPORT_TOKEN);
		expect(phaseOne).not.toContain("PI-REPORTS-CODEX-ADDRESSED");
		expect(phaseOne).not.toContain("CODEX_ADDRESSED_RECEIPT");
		// The forwarded payload is the TAIL: nothing follows it to be copied by accident.
		expect(phaseOne.endsWith(codexInstruction)).toBe(true);
		// ...and the Pi is told to stop after forwarding.
		expect(phaseOne).toMatch(/STOP\. Send nothing else/);

		// Phase two carries the token for the first time, and carries no work for anyone else.
		const phaseTwo = buildInitialPiPhaseTwo({ reportToken: REPORT_TOKEN, callerGid: CALLER });
		expect(phaseTwo).toContain(REPORT_TOKEN);
		expect(phaseTwo).not.toContain(codexInstruction);
		expect(phaseTwo).not.toContain(OUTBOUND_TOKEN);
		expect(phaseTwo).not.toContain("CODEX-WAIT-ABC123");
		expect(phaseTwo).not.toContain("entwurf_fresh_call");
		expect(phaseTwo).toMatch(/Do not contact Codex/);
	});

	it("[QK:CODEX-LIVE-CODEX-TASK-WAITS-INNER-TOKEN] gives fresh Codex the token that begins its later addressed payload", () => {
		const phaseOne = buildInitialPiPhaseOne({
			initialPiWaitToken: "INITIAL-PI-WAIT-OUTER123",
			codexWaitToken: "CODEX-WAIT-INNER456",
			launchToken: "PI-REPORTS-CODEX-LAUNCH-ABC789",
			callerGid: CALLER,
			codexModel: "gpt-5.6-luna",
			scratch: "/tmp/fixture",
			codexInstruction: buildCodexInstruction({
				waitToken: "CODEX-WAIT-INNER456",
				outboundPiToken: OUTBOUND_TOKEN,
				finalToken: "CODEX-PI-FINAL-XYZ789",
				callerGid: CALLER,
				piModel: "openai-codex/gpt-5.6-luna",
				scratch: "/tmp/fixture",
			}),
		});
		const taskLine = phaseOne.split("\n").find((line) => line.includes("required callback receipt"));
		expect(taskLine).toContain("CODEX-WAIT-INNER456");
		expect(taskLine).not.toContain("INITIAL-PI-WAIT-OUTER123");
		expect(phaseOne.startsWith("INITIAL-PI-WAIT-OUTER123\n")).toBe(true);
	});

	it("[QK:CODEX-LIVE-REPORT-SENDER-FILTER] skips a matching token from the wrong sender and takes the right one", () => {
		// Exactly the measured shape: the Codex citizen emitted the Pi's token first.
		const wrong = body(CODEX_GID, `${REPORT_TOKEN}\nCODEX_CALLBACK_FROM=20260911T131821-619d36`);
		const right = body(PI_GID, `${REPORT_TOKEN}\nCODEX_CALLBACK_FROM=${CODEX_GID}`);
		expect(selectReport([wrong], REPORT_TOKEN, PI_GID)).toBeNull();
		// The wrong one arriving FIRST must not end the wait — the right one is still selected.
		expect(selectReport([wrong, right], REPORT_TOKEN, PI_GID)).toBe(right);
		expect(reportSender(right)).toBe(PI_GID);
	});

	it("[QK:CODEX-LIVE-BACKEND-FILTER] refuses a Pi sender for the first Codex report", () => {
		const fromPi = body(PI_GID, `${OUTBOUND_TOKEN}\nPI_WINDOW_ID=@348`);
		const fromCodex = body(CODEX_GID, `${OUTBOUND_TOKEN}\nPI_WINDOW_ID=@348`);
		const isCodex = (gardenId: string): boolean => gardenId === CODEX_GID;
		expect(selectReportByBackend([fromPi], OUTBOUND_TOKEN, isCodex)).toBeNull();
		expect(selectReportByBackend([fromPi, fromCodex], OUTBOUND_TOKEN, isCodex)).toEqual({
			body: fromCodex,
			sender: CODEX_GID,
		});
	});

	it("[QK:CODEX-LIVE-CLEANUP-FAILSAFE] runs window and fixture cleanup after recovery throws", async () => {
		const ran: string[] = [];
		const failures = await runCleanupStages([
			{
				label: "recovery",
				run: () => {
					ran.push("recovery");
					throw new Error("broken receipt reader");
				},
			},
			{
				label: "window",
				run: () => {
					ran.push("window");
					return ["one close refused"];
				},
			},
			{
				label: "fixture",
				run: () => {
					ran.push("fixture");
				},
			},
		]);
		expect(ran).toEqual(["recovery", "window", "fixture"]);
		expect(failures).toEqual(["recovery: threw: broken receipt reader", "window: one close refused"]);
	});

	it("[QK:CODEX-LIVE-RECOVERY-FROM-INBOX] finds the outbound window in a report already delivered", () => {
		// The handle was never lost: the Codex sibling travelled the whole launch receipt to the
		// fixture before the assertion that failed. Recovery reads that body — which is why it
		// can run on EVERY exit, not only on a wait that timed out.
		const delivered = body(
			CODEX_GID,
			`${OUTBOUND_TOKEN}\nPI_WINDOW_ID=@348\nPI_LAUNCH_RECEIPT=[entwurf fresh call →]\n  backend:  pi (/x/pi)\n  window:   @348 (index 11) in session $150\n  pane:     %348 pid 95914\n`,
		);
		expect(launchReceiptWindows(delivered, "pi")).toEqual(["@348"]);
		// A Codex receipt in the same mailbox is not mistaken for the Pi one.
		expect(launchReceiptWindows(delivered, "codex")).toEqual([]);
	});
});
