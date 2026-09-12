import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
	buildCodexInstruction,
	buildInitialPiPhaseOne,
	reportSender,
	runCleanupStages,
	selectReport,
} from "../scripts/lib/codex-fresh-live-protocol.ts";
import {
	assertExactSourceToolCalls,
	assertSourceCallScopes,
	codexCallbackSenders,
	codexSourceToolReceipts,
	codexThreadIsTerminal,
	mailboxCallbacks,
	parseJsonLines,
	parseMetaMailboxBody,
	piCallbackSenders,
	piSourceToolReceipts,
	resolveSourceTranscriptPath,
	selectExactSourceToolReceipt,
	sourceCleanupWindows,
	validateFinalMailboxBody,
} from "../scripts/lib/codex-fresh-source-receipts.ts";
import { launchReceiptWindows } from "../scripts/lib/launch-receipt-windows.ts";

const CALLER = "20260911T131734-4774a0";
const CODEX_GID = "20260911T131751-e99496";
const PI_GID = "20260911T131736-13e39b";
const REPORT_TOKEN = "CODEX-PI-FINAL-YH3TQ4S6";
const RAW_RECEIPT =
	"[entwurf fresh call →]\n  backend:  codex (/x/codex)\n  window:   @348 (index 11) in session $150\n  pane:     %348 pid 95914\n  nonce:    mux-fresh-call-abcdef123456\n";
const failedRolloutProjection = JSON.parse(
	readFileSync(new URL("./fixtures/codex-fresh-failed-rollout-projection.json", import.meta.url), "utf8"),
) as { provenance: { label: string }; thread: unknown };

const codexInstruction = buildCodexInstruction({
	waitToken: "CODEX-WAIT-ABC123",
	finalToken: "CODEX-PI-FINAL-XYZ789",
	callerGid: CALLER,
	piModel: "openai-codex/gpt-5.6-luna",
	scratch: "/tmp/fixture",
});

function body(sender: string, payload: string): string {
	return (
		"[entwurf received ⟵]\n" +
		"  from:        fixture/model @ /tmp/fixture\n" +
		`  session:     ${sender} (replyable — reply via entwurf_v2 to this sessionId, intent=fire-and-forget)\n` +
		"  at:          2026-09-12 20:35:11 KST\n" +
		"  wants reply: no\n" +
		"────────────────────────────────────────\n" +
		`${payload}\n`
	);
}

function piCall(
	id = "call-1",
	args: Record<string, unknown> = { backend: "codex" },
	name = "entwurf_fresh_call",
): unknown {
	return {
		type: "message",
		message: { role: "assistant", content: [{ type: "toolCall", id, name, arguments: args }] },
	};
}

function piResult(id = "call-1", isError: unknown = false, toolName = "entwurf_fresh_call"): unknown {
	return {
		type: "message",
		message: { role: "toolResult", toolCallId: id, toolName, isError, content: [{ type: "text", text: RAW_RECEIPT }] },
	};
}

function senderInfo(sessionId: string): string {
	return `<sender_info>${JSON.stringify({ sessionId, origin: "meta-session" })}</sender_info>`;
}

function codexMcp(
	status: "inProgress" | "completed" | "failed",
	overrides: Record<string, unknown> = {},
): Record<string, unknown> {
	return {
		type: "mcpToolCall",
		id: "mcp-1",
		server: "entwurf-bridge",
		tool: "entwurf_fresh_call",
		status,
		arguments: { backend: "pi" },
		result: status === "completed" ? { content: [{ type: "text", text: RAW_RECEIPT }] } : null,
		error: status === "failed" ? { message: "vendor failed" } : null,
		...overrides,
	};
}

describe("codex fresh-live protocol", () => {
	it("[QK:CODEX-LIVE-PHASE-SEPARATION] forwards one bounded payload and asks for no model launch report", () => {
		const phaseOne = buildInitialPiPhaseOne({
			initialPiWaitToken: "INITIAL-PI-WAIT-O1ZV68XX",
			codexWaitToken: "CODEX-WAIT-ABC123",
			codexModel: "gpt-5.6-luna",
			scratch: "/tmp/fixture",
			codexInstruction,
		});
		expect(phaseOne).toContain(
			`----- BEGIN MESSAGE FOR THE CODEX SIBLING -----\n${codexInstruction}\n----- END MESSAGE FOR THE CODEX SIBLING -----`,
		);
		expect(phaseOne).toContain("generated sender_info after END are not part of the message");
		expect(phaseOne).not.toContain("PI-REPORTS-CODEX-LAUNCH");
		expect(phaseOne).not.toContain("CODEX_ADDRESSED_RECEIPT");
		expect(phaseOne).toMatch(/Then STOP\. Send nothing else/);
		expect(phaseOne).toContain("wants_reply false");
	});

	it("[QK:CODEX-LIVE-HOME-PLACEMENT-OMITTED] exercises both default-placement legs", () => {
		const phaseOne = buildInitialPiPhaseOne({
			initialPiWaitToken: "INITIAL-PI-WAIT-OUTER123",
			codexWaitToken: "CODEX-WAIT-INNER456",
			codexModel: "gpt-5.6-sol",
			scratch: "/tmp/fixture",
			codexInstruction,
		});
		expect(phaseOne).toMatch(/backend codex, model gpt-5\.6-sol, cwd \/tmp\/fixture, NO placement/);
		expect(codexInstruction).toMatch(/backend pi, model openai-codex\/gpt-5\.6-luna, cwd \/tmp\/fixture, NO placement/);
		expect(phaseOne).not.toContain("tmuxSession");
	});

	it("[QK:CODEX-LIVE-CODEX-TASK-WAITS-INNER-TOKEN] gives fresh Codex its later addressed token", () => {
		const phaseOne = buildInitialPiPhaseOne({
			initialPiWaitToken: "INITIAL-PI-WAIT-OUTER123",
			codexWaitToken: "CODEX-WAIT-INNER456",
			codexModel: "gpt-5.6-luna",
			scratch: "/tmp/fixture",
			codexInstruction: buildCodexInstruction({
				waitToken: "CODEX-WAIT-INNER456",
				finalToken: "CODEX-PI-FINAL-XYZ789",
				callerGid: CALLER,
				piModel: "openai-codex/gpt-5.6-luna",
				scratch: "/tmp/fixture",
			}),
		});
		const taskLine = phaseOne.split("\n").find((line) => line.includes("required callback receipt"));
		expect(taskLine).toContain("CODEX-WAIT-INNER456");
		expect(taskLine).toContain("end the turn and wait passively");
		expect(taskLine).not.toContain("INITIAL-PI-WAIT-OUTER123");
	});

	it("[QK:CODEX-LIVE-REPORT-TOKEN-EXACT] refuses the measured one-character token truncation", () => {
		const truncated = body(CODEX_GID, "CODEX-PI-FINAL-YH3TQ4S\nPI_WINDOW_ID=@348");
		expect(selectReport([truncated], REPORT_TOKEN, CODEX_GID)).toBeNull();
	});

	it("[QK:CODEX-LIVE-REPORT-SENDER-FILTER] requires one exact final sender", () => {
		const wrong = body(PI_GID, `${REPORT_TOKEN}\nPI_WINDOW_ID=@348`);
		const right = body(CODEX_GID, `${REPORT_TOKEN}\nPI_WINDOW_ID=@348`);
		expect(selectReport([wrong], REPORT_TOKEN, CODEX_GID)).toBeNull();
		expect(selectReport([wrong, right], REPORT_TOKEN, CODEX_GID)).toBe(right);
		expect(() => selectReport([right, right], REPORT_TOKEN, CODEX_GID)).toThrow(/duplicate exact mailbox reports/);
		expect(reportSender(right)).toBe(CODEX_GID);
	});

	it("[QK:CODEX-LIVE-SOURCE-JOIN] joins exact Pi call/result identity and arguments", () => {
		expect(piSourceToolReceipts([piCall(), piResult()])).toEqual([
			{
				toolName: "entwurf_fresh_call",
				arguments: { backend: "codex" },
				text: RAW_RECEIPT,
				status: "completed",
				isError: false,
			},
		]);
		expect(() => piSourceToolReceipts([piCall(), piResult("call-1", false, "entwurf_v2")])).toThrow(
			/Pi tool name drift/,
		);
		const drifted = piSourceToolReceipts([piCall(), piResult()]);
		expect(() =>
			selectExactSourceToolReceipt(
				drifted,
				"entwurf_fresh_call",
				{ backend: "codex", placement: { tmuxSession: "codex" } },
				"fresh",
			),
		).toThrow(/source tool arguments differ/);
		// Measured failed wire: initial Pi copied the fixture's generated sender_info after the
		// intended payload. Exact source arguments reject it; the BEGIN/END prompt prevents it.
		const copiedOuterEnvelope = piSourceToolReceipts([
			piCall(
				"v2",
				{
					target: CODEX_GID,
					intent: "fire-and-forget",
					wants_reply: false,
					message: `${codexInstruction}\n\n${senderInfo(CALLER)}`,
				},
				"entwurf_v2",
			),
			piResult("v2", false, "entwurf_v2"),
		]);
		expect(() =>
			selectExactSourceToolReceipt(
				copiedOuterEnvelope,
				"entwurf_v2",
				{ target: CODEX_GID, intent: "fire-and-forget", wants_reply: false, message: codexInstruction },
				"forward",
			),
		).toThrow(/source tool arguments differ/);
	});

	it("[QK:CODEX-LIVE-SOURCE-ERROR-REJECT] requires explicit Pi false and rejects failures", () => {
		const failed = piSourceToolReceipts([piCall(), piResult("call-1", true)]);
		expect(() => selectExactSourceToolReceipt(failed, "entwurf_fresh_call", { backend: "codex" }, "fresh")).toThrow(
			/exact source tool result failed/,
		);
		const missing = piResult() as { message: { isError?: unknown } };
		delete missing.message.isError;
		expect(() => piSourceToolReceipts([piCall(), missing])).toThrow(/explicit boolean isError/);
		expect(() => piSourceToolReceipts([piCall(), piResult("call-1", null)])).toThrow(/explicit boolean isError/);
		expect(() => piSourceToolReceipts([piCall(), piResult("call-1", "false")])).toThrow(/explicit boolean isError/);
	});

	it("[QK:CODEX-LIVE-SOURCE-UNMATCHED-REJECT] rejects malformed or unmatched Pi rows", () => {
		expect(() => piSourceToolReceipts([piResult("missing")])).toThrow(/unmatched Pi toolResult/);
		expect(() =>
			piSourceToolReceipts([
				{ type: "message", message: { role: "assistant", content: [{ type: "toolCall", name: "x" }] } },
			]),
		).toThrow(/malformed Pi toolCall/);
	});

	it("[QK:CODEX-LIVE-JSONL-COMPLETE-ERROR] distinguishes a partial final append from complete corruption", () => {
		expect(() => parseJsonLines('{"ok":1}\n{bad}\n')).toThrow(/invalid complete JSONL row 2/);
		expect(() => parseJsonLines('{"ok":1}\n{bad}')).toThrow(/invalid complete JSONL row 2/);
		expect(parseJsonLines('{"ok":1}\n{"pending"')).toEqual([{ ok: 1 }]);
	});

	it("[QK:CODEX-LIVE-SOURCE-JOIN-UNIQUE] retains pending calls and final-audits exact once", () => {
		const pending = piSourceToolReceipts([piCall()]);
		expect(pending[0]?.status).toBe("pending");
		expect(selectExactSourceToolReceipt(pending, "entwurf_fresh_call", { backend: "codex" }, "fresh")).toBeNull();
		const completedPlusPending = piSourceToolReceipts([piCall("call-1"), piResult("call-1"), piCall("call-2")]);
		expect(() =>
			selectExactSourceToolReceipt(completedPlusPending, "entwurf_fresh_call", { backend: "codex" }, "fresh"),
		).toThrow(/duplicate source tool calls/);
		expect(() =>
			assertExactSourceToolCalls(
				completedPlusPending,
				[{ toolName: "entwurf_fresh_call", arguments: { backend: "codex" } }],
				"final",
			),
		).toThrow(/source call count differs/);
	});

	it("[QK:CODEX-LIVE-RAW-CALLBACK-REQUIRED] requires one terminal Pi sender envelope", () => {
		const nonce = "mux-fresh-call-abcdef123456";
		const callback = {
			type: "custom_message",
			customType: "entwurf-message",
			content: `${nonce}\n\n${senderInfo(CODEX_GID)}`,
		};
		expect(piCallbackSenders([callback], nonce)).toEqual([CODEX_GID]);
		expect(piCallbackSenders([{ ...callback, content: `${callback.content}suffix` }], nonce)).toEqual([]);
		expect(piCallbackSenders([{ ...callback, content: `${nonce}x\n\n${senderInfo(CODEX_GID)}` }], nonce)).toEqual([]);
	});

	it("[QK:CODEX-LIVE-OUTER-FRAME-EXACT] preserves every mailbox payload byte under one anchored frame", () => {
		const nonce = "mux-fresh-call-abcdef123456";
		const exactMailbox = body(CODEX_GID, nonce);
		expect(mailboxCallbacks([exactMailbox], nonce)).toEqual([{ body: exactMailbox, sender: CODEX_GID }]);
		expect(mailboxCallbacks([body(CODEX_GID, `${nonce} `)], nonce)).toEqual([]);
		expect(mailboxCallbacks([body(CODEX_GID, `${nonce}\n\n${senderInfo(PI_GID)}`)], nonce)).toEqual([]);
		expect(parseMetaMailboxBody(body(CODEX_GID, `${nonce}\n`))?.payload).toBe(`${nonce}\n`);
		expect(parseMetaMailboxBody(`prefix\n  session:     ${CODEX_GID}\n────────\n${nonce}\n`)).toBeNull();
	});

	it("[QK:CODEX-LIVE-FINAL-DIAGNOSTIC-VERDICT] never logs token+sender selection as exact payload acceptance", () => {
		const candidate = body(CODEX_GID, `${REPORT_TOKEN}\nWRONG`);
		expect(selectReport([candidate], REPORT_TOKEN, CODEX_GID)).toBe(candidate);
		expect(validateFinalMailboxBody(candidate, CODEX_GID, `${REPORT_TOKEN}\nRIGHT`)).toMatchObject({
			accepted: false,
			reason: "rejected: payload differs from source-call argument",
		});
	});

	it("[QK:CODEX-LIVE-CODEX-PENDING] waits for vendor inProgress and rejects terminal failed", () => {
		const pendingThread = { turns: [{ status: "inProgress", items: [codexMcp("inProgress")] }] };
		const pending = codexSourceToolReceipts(pendingThread);
		expect(codexThreadIsTerminal(pendingThread)).toBe(false);
		expect(codexThreadIsTerminal({ turns: [{ status: "completed", items: [codexMcp("completed")] }] })).toBe(true);
		expect(pending[0]?.status).toBe("pending");
		expect(selectExactSourceToolReceipt(pending, "entwurf_fresh_call", { backend: "pi" }, "codex fresh")).toBeNull();
		const failed = codexSourceToolReceipts({ turns: [{ items: [codexMcp("failed")] }] });
		expect(() => selectExactSourceToolReceipt(failed, "entwurf_fresh_call", { backend: "pi" }, "codex fresh")).toThrow(
			/exact source tool result failed/,
		);
	});

	it("[QK:CODEX-LIVE-TURN-TERMINAL-EXACT] requires known completed Codex turn state and items", () => {
		expect(() => codexThreadIsTerminal({ turns: [{ items: [] }] })).toThrow(/unknown Codex turn status/);
		expect(() => codexThreadIsTerminal({ turns: [{ status: "future", items: [] }] })).toThrow(
			/unknown Codex turn status/,
		);
		expect(() => codexThreadIsTerminal({ turns: [{ status: "completed" }] })).toThrow(
			/malformed Codex thread\/read items/,
		);
		expect(() => codexThreadIsTerminal({ turns: [{ status: "failed", items: [] }] })).toThrow(/not completed/);
		expect(() => codexThreadIsTerminal({ turns: [{ status: "interrupted", items: [] }] })).toThrow(/not completed/);
	});

	it("[QK:CODEX-LIVE-CODEX-SOURCE] accepts only Entwurf MCP items and one real-shaped callback block", () => {
		const nonce = "mux-fresh-call-abcdef123456";
		const callbackText = body(PI_GID, nonce);
		const completedThread = {
			turns: [
				{
					items: [
						codexMcp("completed", { id: "impostor", server: "other-server" }),
						codexMcp("completed"),
						{ type: "userMessage", content: [{ type: "text", text: callbackText }] },
					],
				},
			],
		};
		expect(codexSourceToolReceipts(completedThread)).toHaveLength(1);
		expect(codexSourceToolReceipts(completedThread)[0]?.status).toBe("completed");
		expect(codexCallbackSenders(completedThread, nonce)).toEqual([PI_GID]);
		const extraBlock = {
			turns: [
				{
					items: [
						{
							type: "userMessage",
							content: [
								{ type: "text", text: callbackText },
								{ type: "text", text: "x" },
							],
						},
					],
				},
			],
		};
		expect(codexCallbackSenders(extraBlock, nonce)).toEqual([]);
		expect(failedRolloutProjection.provenance.label).toBe(
			"vendor-source-derived projection from preserved rollout; not captured thread/read",
		);
		expect(codexSourceToolReceipts(failedRolloutProjection.thread)[0]).toMatchObject({
			toolName: "entwurf_fresh_call",
			status: "completed",
		});
		expect(codexCallbackSenders(failedRolloutProjection.thread, "mux-fresh-call-6337a6477bcd6f39ef16eece")).toEqual([
			"20260912T203507-929a81",
		]);
	});

	it("[QK:CODEX-LIVE-SOURCE-ROLE-AUDIT] rejects wrong-axis and late extra source calls", () => {
		const right = piSourceToolReceipts([
			piCall("a", { target: CALLER }, "entwurf_v2"),
			piResult("a", false, "entwurf_v2"),
		]);
		assertSourceCallScopes(right, "entwurf_v2", "target", [CALLER], "roles");
		expect(() => assertSourceCallScopes(right, "entwurf_v2", "target", [CODEX_GID], "roles")).toThrow(
			/unexpected target/,
		);
		expect(() =>
			assertExactSourceToolCalls(right, [{ toolName: "entwurf_v2", arguments: { target: CODEX_GID } }], "final"),
		).toThrow(/unexpected source call/);
	});

	it("[QK:CODEX-LIVE-CLEANUP-FAILSAFE] runs later cleanup after recovery throws", async () => {
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
			{ label: "fixture", run: () => void ran.push("fixture") },
		]);
		expect(ran).toEqual(["recovery", "window", "fixture"]);
		expect(failures).toEqual(["recovery: threw: broken receipt reader", "window: one close refused"]);
	});

	it("[QK:CODEX-LIVE-SOURCE-PATH-RE-RESOLVED] re-reads a record that carries no transcript path yet", () => {
		// Measured cause of one 300s red: the record gained transcriptPath 34s AFTER callback
		// correlation, so a one-shot read made every later source observation permanently empty.
		let recorded: string | null | undefined;
		let reads = 0;
		const readRecordPath = (): string | null | undefined => {
			reads++;
			return recorded;
		};
		expect(resolveSourceTranscriptPath("", readRecordPath)).toBe("");
		recorded = "/abs/session/one.jsonl";
		expect(resolveSourceTranscriptPath("", readRecordPath)).toBe("/abs/session/one.jsonl");
		expect(reads).toBe(2);
		// A resolved path is authority, so it is never re-read — and null reads like absent.
		expect(
			resolveSourceTranscriptPath("/abs/session/one.jsonl", () => {
				throw new Error("a cached path must not re-read its record");
			}),
		).toBe("/abs/session/one.jsonl");
		expect(resolveSourceTranscriptPath("", () => null)).toBe("");
		// A reader that throws is fail-loud: only "no path yet" is pending.
		expect(() =>
			resolveSourceTranscriptPath("", () => {
				throw new Error("unreadable record");
			}),
		).toThrow(/unreadable record/);
		// The smoke reads its source path through that leaf, not through a frozen snapshot.
		const smokeSource = readFileSync(new URL("../scripts/smoke-codex-fresh-live.ts", import.meta.url), "utf8");
		expect(smokeSource).toContain("resolveSourceTranscriptPath(initialPiTranscript");
		expect(smokeSource).toContain(
			"initial Pi record still carries no transcriptPath; no unverified child window killed",
		);
	});

	it("[QK:CODEX-LIVE-EVIDENCE-RECORD-PATH] uses the record owner's .meta.json filename helper", () => {
		const smokeSource = readFileSync(new URL("../scripts/smoke-codex-fresh-live.ts", import.meta.url), "utf8");
		expect(smokeSource.match(/metaRecordFilename\(initialPiIdentity\)/g)).toHaveLength(2);
		expect(smokeSource).toContain("metaRecordFilename(codexIdentity)");
		expect(smokeSource).toContain("metaRecordFilename(outboundPiIdentity)");
		expect(smokeSource).not.toMatch(/initialPiGid\}\.json/);
	});

	it("[QK:CODEX-LIVE-EVIDENCE-RECOVERY-FAILSAFE] creates raw snapshot before optional source recovery", () => {
		const smokeSource = readFileSync(new URL("../scripts/smoke-codex-fresh-live.ts", import.meta.url), "utf8");
		const preserve = smokeSource.slice(
			smokeSource.indexOf("async function preservePreCleanupEvidence"),
			smokeSource.indexOf("function cleanupFixture"),
		);
		expect(preserve.indexOf("fs.mkdirSync(snapshot")).toBeLessThan(preserve.indexOf("recoverCodexThreadAuthority()"));
		expect(preserve).toContain("try {\n\t\trecoverCodexThreadAuthority();");
		expect(preserve).toContain("optional identity recovery");
		expect(preserve).toContain("missing expected evidence source");
	});

	it("[QK:CODEX-LIVE-RECOVERY-SOURCE-ONLY] derives cleanup handles only after a source call/result join", () => {
		const forgedReport = { type: "custom_message", customType: "entwurf-message", content: RAW_RECEIPT };
		const forgedSource = piSourceToolReceipts([forgedReport]);
		expect(forgedSource).toEqual([]);
		expect(sourceCleanupWindows(forgedSource)).toEqual([]);
		const joined = piSourceToolReceipts([piCall(), piResult()]);
		expect(sourceCleanupWindows(joined)).toEqual(["@348"]);
		expect(launchReceiptWindows(joined[0]?.text ?? "", "codex")).toEqual(["@348"]);
		const smokeSource = readFileSync(new URL("../scripts/smoke-codex-fresh-live.ts", import.meta.url), "utf8");
		expect(smokeSource).toContain("sourceCleanupWindows(piSourceToolReceipts(readInitialPiEntries()))");
		expect(smokeSource).not.toContain("seenInbox.flatMap");
	});
});
