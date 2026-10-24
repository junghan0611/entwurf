import { describe, expect, it } from "vitest";

import { assertBootstrapOrder } from "../scripts/lib/codex-fresh-source-receipts.ts";
import {
	type PdNativeRow,
	type PdNativeSubmissionRow,
	pdDoorbellSubmission,
	pdRootView,
	pdSourceToolReceipts,
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
					callOrdinal: 11,
					resultOrdinal: 14,
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

/**
 * pd's bootstrap ORDER, as a hand-written table over native rows. `[GLG 직접, 2026-10-24]` a fresh
 * sibling may check its caller with the read-only listing, then calls back, then works — so the smoke
 * no longer asks for a literal first callback. Rows go through the real `pdRootView` and its entry-id
 * ordinals; every expected verdict is a literal written here, not recomputed by the leaf under test.
 */
describe("pd side: the root bootstrap order", () => {
	const PD_EXPECT = { peersArguments: {}, callback: { toolName: "entwurf_callback", arguments: {} } };
	const OK = "entwurf_v2 control-socket → sent";
	let next = 100;
	/** One assistant row with one call, then its result row. */
	function step(id: string, name: string, args: Record<string, unknown> = {}, isError = false): PdNativeRow[] {
		const call = entry(next++, ROOT, "pi.assistant", assistant([{ id, name, arguments: args }]));
		const res = entry(next++, ROOT, "pi.tool-result", result(id, OK, isError));
		return [call, res];
	}
	const work = (): PdNativeRow[] => step("i", "entwurf_inbox_read", { gardenId: PD });
	function verdict(rows: PdNativeRow[]): string {
		try {
			const rest = assertBootstrapOrder(pdSourceToolReceipts(pdRootView(rows, ROOT).calls), PD_EXPECT, "pd");
			return `accept rest=${rest.map((r) => r.toolName).join(",")}`;
		} catch (error) {
			return (error as Error).message.split("\n")[0] as string;
		}
	}

	it("[QK:PD-FRESH-LIVE-BOOTSTRAP-ORDER] zero, one or several successful exact peers checks before ONE successful zero-argument callback are accepted; everything else is refused by name", () => {
		const table: Record<string, string> = {
			"callback → work": verdict([...step("c", "entwurf_callback"), ...work()]),
			"peers → callback → work": verdict([...step("p", "entwurf_peers"), ...step("c", "entwurf_callback"), ...work()]),
			"peers → peers → callback → work": verdict([
				...step("p1", "entwurf_peers"),
				...step("p2", "entwurf_peers"),
				...step("c", "entwurf_callback"),
				...work(),
			]),
			"callback → peers (late)": verdict([...step("c", "entwurf_callback"), ...step("p", "entwurf_peers"), ...work()]),
			"failed peers": verdict([...step("p", "entwurf_peers", {}, true), ...step("c", "entwurf_callback"), ...work()]),
			"peers with arguments": verdict([
				...step("p", "entwurf_peers", { limit: 5 }),
				...step("c", "entwurf_callback"),
				...work(),
			]),
			"pending callback": verdict([
				entry(next++, ROOT, "pi.assistant", assistant([{ id: "c", name: "entwurf_callback", arguments: {} }])),
			]),
			"callback with arguments": verdict([...step("c", "entwurf_callback", { target: FIXTURE }), ...work()]),
			"duplicate callback": verdict([...step("c1", "entwurf_callback"), ...step("c2", "entwurf_callback"), ...work()]),
			"work before callback": verdict([...work(), ...step("c", "entwurf_callback")]),
			"peers + callback in one row": verdict([
				entry(
					next++,
					ROOT,
					"pi.assistant",
					assistant([
						{ id: "p", name: "entwurf_peers", arguments: {} },
						{ id: "c", name: "entwurf_callback", arguments: {} },
					]),
				),
				entry(next++, ROOT, "pi.tool-result", result("p", OK, false)),
				entry(next++, ROOT, "pi.tool-result", result("c", OK, false)),
				...work(),
			]),
		};
		expect(table).toEqual({
			"callback → work": "accept rest=entwurf_inbox_read",
			"peers → callback → work": "accept rest=entwurf_inbox_read",
			"peers → peers → callback → work": "accept rest=entwurf_inbox_read",
			"callback → peers (late)": "pd: entwurf_peers after the callback — the check is offered only before it",
			"failed peers": "pd: pre-callback entwurf_peers failed",
			"peers with arguments": "pd: pre-callback entwurf_peers arguments differ",
			"pending callback": "pd: the callback remained pending",
			"callback with arguments": `pd: unexpected pre-callback call entwurf_callback {"target":"${FIXTURE}"} — only the read-only entwurf_peers check may precede entwurf_callback {}`,
			"duplicate callback": "pd: duplicate callback entwurf_callback",
			"work before callback": `pd: unexpected pre-callback call entwurf_inbox_read {"gardenId":"${PD}"} — only the read-only entwurf_peers check may precede entwurf_callback {}`,
			"peers + callback in one row": "pd: entwurf_callback was called before the entwurf_peers result was recorded",
		});
	});
});
