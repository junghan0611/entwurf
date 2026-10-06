import { describe, expect, it } from "vitest";

import {
	type PdNativeRow,
	type PdNativeSubmissionRow,
	pdDoorbellSubmission,
	pdRootView,
	piExactDeliveryRow,
} from "../scripts/lib/pi-durable-fresh-live-receipts.ts";

// The oracles `smoke-pi-durable-fresh-live` judges a LIVE run with, proven on inline rows shaped like
// the ones that run measured (#129): Pi's `entwurf-message` custom rows, and the pd native store's
// `entries` / `submissions` columns with their JSON `record`. Ids and payloads are trimmed fixtures.
const PD = "20261006T223720-ba0c08";
const FIXTURE = "20261006T223708-99edfb";
const TOKEN = "PD-T2-N7ZXT9";

function senderInfo(sessionId: string, agent: string): string {
	return `<sender_info>${JSON.stringify({
		sessionId,
		agentId: `meta-session/${agent}`,
		cwd: "/tmp/entwurf-pd-fresh-x/scratch",
		timestamp: "2026-10-06T13:37:46.711Z",
		origin: "meta-session",
		replyable: true,
	})}</sender_info>`;
}
function piRow(content: string): unknown {
	return { type: "custom_message", customType: "entwurf-message", content, display: true };
}
const delivery = piRow(`${TOKEN}\n\n${senderInfo(PD, "pi-durable")}`);
// The fixture's own instruction names both the token and pd's id — the row the first oracle took.
const instruction = piRow(
	`Call entwurf_v2 exactly once with target "${PD}", intent "fire-and-forget", message "${TOKEN}".\n\n${senderInfo(FIXTURE, "claude-code")}`,
);

describe("Pi side: one exact delivery row", () => {
	it("[QK:PD-FRESH-LIVE-EXACT-DELIVERY-ROW] selects the exact payload from the expected sender, never the instruction that only mentions both", () => {
		const entries = [{ type: "message" }, instruction, piRow(`${TOKEN}`), delivery];
		expect(piExactDeliveryRow(entries, TOKEN, PD)).toEqual({ row: delivery, index: 3 });
		expect(piExactDeliveryRow([instruction], TOKEN, PD)).toBeNull();
	});

	it("[QK:PD-FRESH-LIVE-FOREIGN-SENDER-REFUSED] the same exact payload from another sender is no delivery", () => {
		const foreign = piRow(`${TOKEN}\n\n${senderInfo(FIXTURE, "claude-code")}`);
		expect(piExactDeliveryRow([foreign], TOKEN, PD)).toBeNull();
		expect(piExactDeliveryRow([foreign, delivery], TOKEN, PD)).toEqual({ row: delivery, index: 1 });
	});

	it("[QK:PD-FRESH-LIVE-PAYLOAD-DRIFT-REFUSED] a payload that only contains the token, or a second envelope, is refused", () => {
		const drift = piRow(`${TOKEN} extra\n\n${senderInfo(PD, "pi-durable")}`);
		const suffixed = piRow(`${TOKEN}\n\n${senderInfo(PD, "pi-durable")}\n`);
		const nested = piRow(`${TOKEN}\n\n${senderInfo(FIXTURE, "claude-code")}\n\n${senderInfo(PD, "pi-durable")}`);
		for (const row of [drift, suffixed, nested]) expect(piExactDeliveryRow([row], TOKEN, PD)).toBeNull();
	});

	it("[QK:PD-FRESH-LIVE-DUPLICATE-REFUSED] two exact rows are not one delivery", () => {
		expect(piExactDeliveryRow([delivery, delivery], TOKEN, PD)).toBeNull();
	});
});

const ROOT = 1;
const CHILD = 2;
function entry(id: number, conversation_id: number, kind: string, message: Record<string, unknown>): PdNativeRow {
	return {
		id,
		conversation_id,
		record: JSON.stringify({ model: [message], kind, id, conversationId: conversation_id }),
	};
}
function system(added: string[], removed: string[] = []): Record<string, unknown> {
	return {
		role: "system",
		content: "",
		toolsAdded: added.map((name) => ({ name, description: "", parameters: {} })),
		...(removed.length > 0 ? { toolsRemoved: removed.map((name) => ({ name })) } : {}),
	};
}
function assistant(calls: { id: string; name: string; arguments: Record<string, unknown> }[], model = "gpt-6.1-sol") {
	return {
		role: "assistant",
		content: calls.map((c) => ({ type: "toolCall", ...c })),
		provider: "openai-codex",
		model,
	};
}
function result(toolCallId: string, text: string, isError: boolean): Record<string, unknown> {
	return { role: "toolResult", toolCallId, content: [{ type: "text", text }], isError };
}

describe("pd side: the root conversation's own entries", () => {
	it("[QK:PD-FRESH-LIVE-ROOT-SCOPE] reads only the root conversation, in entry-id order", () => {
		const rows = [
			entry(11, ROOT, "pi.assistant", assistant([{ id: "c1", name: "entwurf_callback", arguments: {} }])),
			entry(10, ROOT, "pi.system", system(["read", "entwurf_callback"])),
			entry(12, CHILD, "pi.system", system(["child_only"], ["read"])),
			entry(13, CHILD, "pi.assistant", assistant([{ id: "k1", name: "bash", arguments: {} }], "other-model")),
			entry(14, ROOT, "pi.tool-result", result("c1", "entwurf_v2 control-socket → sent", false)),
		];
		expect(pdRootView(rows, ROOT)).toEqual({
			offering: ["read", "entwurf_callback"],
			models: ["openai-codex/gpt-6.1-sol"],
			calls: [
				{
					id: "c1",
					name: "entwurf_callback",
					arguments: {},
					result: { text: "entwurf_v2 control-socket → sent", isError: false },
				},
			],
		});
	});

	it("[QK:PD-FRESH-LIVE-OFFERING-APPLIED] applies each system message's removals before its additions, in order", () => {
		const rows = [
			entry(1, ROOT, "pi.system", system(["read", "write", "bash"])),
			entry(2, ROOT, "pi.system", system(["subagent"], ["write"])),
			entry(3, ROOT, "pi.system", system(["write"], ["bash"])),
		];
		expect(pdRootView(rows, ROOT).offering).toEqual(["read", "subagent", "write"]);
	});

	it("[QK:PD-FRESH-LIVE-CALL-RESULT-JOIN] joins each result to its call by id, keeps isError, and reads each message by its entry kind", () => {
		const rows = [
			entry(
				1,
				ROOT,
				"pi.assistant",
				assistant([
					{ id: "a", name: "entwurf_inbox_read", arguments: { gardenId: PD } },
					{ id: "b", name: "entwurf_v2", arguments: { target: FIXTURE, message: TOKEN } },
					{ id: "c", name: "entwurf_peers", arguments: {} },
				]),
			),
			entry(2, ROOT, "pi.tool-result", result("b", "entwurf_v2 control-socket → sent", true)),
			entry(3, ROOT, "pi.tool-result", result("a", "[entwurf inbox read ⟵]", false)),
			entry(4, ROOT, "pi.tool-result", result("unknown", "orphan", false)),
			// A message under the wrong entry kind is not that kind's evidence.
			entry(5, ROOT, "pi.user", assistant([{ id: "u", name: "entwurf_callback", arguments: {} }], "user-kind")),
			entry(6, ROOT, "pi.assistant", result("c", "wrong kind", false)),
		];
		const view = pdRootView(rows, ROOT);
		expect(view.models).toEqual(["openai-codex/gpt-6.1-sol"]);
		expect(view.calls.map((c) => [c.id, c.name, c.arguments, c.result])).toEqual([
			["a", "entwurf_inbox_read", { gardenId: PD }, { text: "[entwurf inbox read ⟵]", isError: false }],
			[
				"b",
				"entwurf_v2",
				{ target: FIXTURE, message: TOKEN },
				{ text: "entwurf_v2 control-socket → sent", isError: true },
			],
			["c", "entwurf_peers", {}, null],
		]);
	});
});

describe("pd side: the doorbell submission for one mailbox message", () => {
	const request = `entwurf-doorbell:${PD}:2026-10-06T13-37-35-446Z-b57c69.msg`;
	function submission(conversation_id: number, status: string, requestId: string): PdNativeSubmissionRow {
		return {
			conversation_id,
			status,
			record: JSON.stringify({ conversationId: conversation_id, requestId, type: "input", status }),
		};
	}
	const rows = [
		submission(ROOT, "done", `entwurf-first-input:${PD}`),
		submission(ROOT, "done", request),
		submission(CHILD, "running", `entwurf-doorbell:${PD}:other.msg`),
	];

	it("[QK:PD-FRESH-LIVE-DOORBELL-EXACT] finds exactly this request on the root, and nothing for another request or conversation", () => {
		expect(pdDoorbellSubmission(rows, ROOT, request)).toEqual({
			status: "done",
			record: { conversationId: ROOT, requestId: request, type: "input", status: "done" },
		});
		expect(pdDoorbellSubmission(rows, ROOT, `entwurf-doorbell:${PD}:other.msg`)).toBeNull();
		expect(pdDoorbellSubmission(rows, CHILD, request)).toBeNull();
		expect(pdDoorbellSubmission([...rows, submission(ROOT, "done", request)], ROOT, request)).toBeNull();
	});
});
