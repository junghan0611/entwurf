import type { AssistantMessage } from "@earendil-works/pi-ai";
import { convertToLlm, SessionManager } from "@earendil-works/pi-coding-agent";
import { expect, it } from "vitest";
import { lengthOmission } from "./length-omission.ts";
import { ACP_STOPS } from "./stop-texts.ts";

const answer = (over: Partial<AssistantMessage> = {}) =>
	({
		role: "assistant",
		provider: "entwurf",
		model: "model",
		responseId: "seal",
		stopReason: "length",
		content: [
			{ type: "thinking", thinking: "considering" },
			{ type: "text", text: "partial" },
		],
		...over,
	}) as AssistantMessage;
function setup(over: Partial<AssistantMessage> = {}, pastTool = false) {
	const pi = SessionManager.inMemory();
	if (pastTool)
		pi.appendMessage({
			role: "toolResult",
			toolCallId: "call",
			toolName: "tool",
			content: [],
			isError: false,
			timestamp: 0,
		});
	const input = pi.appendMessage({ role: "user", content: "same", timestamp: 1 });
	const id = pi.appendMessage(answer(over));
	const probe = (anchor = "seal") =>
		lengthOmission(pi, pi.getBranch(), anchor, "model", convertToLlm(pi.buildSessionContext().messages));
	return { pi, input, id, probe };
}
for (const [q, change] of [
	["[QK:ACP-LENGTH-THOUGHT]", "valid"],
	["[QK:ACP-LENGTH-ANCHOR]", "anchor"],
	["[QK:ACP-LENGTH-TARGET]", "target"],
	["[QK:ACP-LENGTH-NULL]", "replacement"],
	["[QK:ACP-LENGTH-PROVIDER]", "provider"],
	["[QK:ACP-LENGTH-MODEL]", "model"],
	["[QK:ACP-LENGTH-REASON]", "stop"],
	["[QK:ACP-LENGTH-OMISSION-IDENTITY]", "tool-call"],
	["[QK:ACP-LENGTH-TOOL-RESULT]", "tool-result"],
	["[QK:ACP-LENGTH-UNIQUE-SEAL]", "duplicate"],
] as const)
	it(q + " " + change, () => {
		const { pi, id, input, probe } = setup(
			change === "tool-call"
				? { content: [{ type: "toolCall", id: "call", name: "tool", arguments: {} }] }
				: change === "provider"
					? { provider: "other" }
					: change === "model"
						? { model: "other" }
						: change === "stop"
							? { stopReason: "stop" }
							: {},
			change === "tool-result",
		);
		if (change === "duplicate") pi.appendMessage(answer());
		pi.appendContextEdit(
			change === "target" ? input : change === "duplicate" ? pi.getLeafId()! : id,
			change === "replacement" ? { content: [{ type: "text", text: "replacement" }] } : null,
		);
		pi.appendCompaction("unkept", null, 1); // Even hidden malformed history cannot grant admission.
		expect(Boolean(probe(change === "anchor" ? "other" : "seal"))).toBe(change === "valid");
	});
for (const [q, change] of [
	["[QK:ACP-LENGTH-UNIQUE-ID]", "duplicate-id"],
	["[QK:ACP-LENGTH-SOURCE]", "source"],
	["[QK:ACP-LENGTH-CONTENTLESS]", "custom"],
	["[QK:ACP-LENGTH-CUSTOM-MESSAGE]", "visible-custom"],
	["[QK:ACP-LENGTH-KEPT]", "kept"],
	["[QK:ACP-LENGTH-UNKEPT]", "unkept"],
	["[QK:ACP-LENGTH-END]", "extra"],
	["[QK:ACP-LENGTH-WAIT-ERROR]", "wrong-wait"],
	["[QK:ACP-LENGTH-WAIT-ORDER]", "late-wait"],
	["[QK:ACP-LENGTH-PRELUDE-ORDER]", "no-input"],
	["[QK:ACP-LENGTH-PRELUDE-BOUNDARY]", "old-boundary"],
	["[QK:ACP-LENGTH-DELTA-ABORT]", "delta-abort"],
	["[QK:ACP-LENGTH-KEEP-ID]", "forward-keep"],
] as const)
	it(q + " " + change, () => {
		const pi = SessionManager.inMemory();
		if (change === "old-boundary") pi.appendCompaction("old", null, 0);
		const input = pi.appendMessage({ role: "user", content: "before", timestamp: 1 });
		if (change === "visible-custom") pi.appendCustomMessageEntry("visible", "message", true);
		const id = pi.appendMessage(answer());
		if (change === "custom") pi.appendCustomEntry("entwurf-acp-compaction", { source: "prelude" });
		pi.appendContextEdit(id, null);
		if (change !== "old-boundary") pi.appendCompaction("summary", change === "kept" ? input : null, 2);
		const user = () => pi.appendMessage({ role: "user", content: "new", timestamp: 3 });
		if (["late-wait", "old-boundary", "delta-abort"].includes(change)) user();
		if (change === "wrong-wait" || change === "late-wait")
			pi.appendMessage(
				answer({
					responseId: "wait",
					stopReason: "error",
					errorMessage: change === "late-wait" ? ACP_STOPS.lengthWait.text : "other",
				}),
			);
		if (["no-input", "old-boundary", "delta-abort"].includes(change))
			pi.appendMessage(
				answer({
					responseId: "fail",
					stopReason: change === "delta-abort" ? "aborted" : "error",
					errorMessage: change === "delta-abort" ? "aborted" : ACP_STOPS.vendorCompactFailed.text,
				}),
			);
		const next = user();
		const raw = structuredClone(pi.getBranch());
		const shown = structuredClone(convertToLlm(pi.buildSessionContext().messages));
		const projection = structuredClone(pi.buildSessionProjection());
		if (change === "duplicate-id") raw.push({ ...raw[0], type: "custom", id: input, customType: "meta" });
		if (change === "source") projection.entries[0].sourceEntry.id = "different-summary-id"; // same summary bytes, wrong provenance
		if (change === "kept" || change === "unkept") {
			const m = shown.find((m) => m.role === "user" && (change === "unkept" || m.content === "before"));
			if (m?.role !== "user") throw Error("missing projected message");
			m.content = "tampered";
		}
		if (change === "extra") shown.push({ role: "user", timestamp: 9, content: "extra" });
		if (change === "forward-keep") {
			const k = raw.find((e) => e.type === "compaction");
			if (!k) throw Error("missing K");
			k.firstKeptEntryId = next;
			const pk = projection.entries.find((e) => e.sourceEntry.type === "compaction");
			if (pk?.sourceEntry.type === "compaction") pk.sourceEntry.firstKeptEntryId = next;
		}
		const result = lengthOmission(
			{ getBranch: () => raw, getEntries: () => raw, getSessionId: () => "", buildSessionProjection: () => projection },
			raw,
			"seal",
			"model",
			shown,
		);
		expect(Boolean(result)).toBe(change === "custom");
	});

for (const [q, reason, stop] of [
	["[QK:ACP-LENGTH-PRELUDE-ERROR]", "error", "vendorCompactFailed"],
	["[QK:ACP-LENGTH-PRELUDE-ABORTED]", "aborted", "vendorCompactFailed"],
	["[QK:ACP-LENGTH-PRELUDE-UNKNOWN]", "error", "vendorCompactUnknown"],
	["[QK:ACP-LENGTH-PRELUDE-ABORTED-UNKNOWN]", "aborted", "vendorCompactUnknown"],
] as const)
	it(q + " a failed prelude does not use up its pending input", () => {
		const { pi, id, probe } = setup();
		pi.appendContextEdit(id, null);
		pi.appendMessage(answer({ responseId: "wait", stopReason: "error", errorMessage: ACP_STOPS.lengthWait.text }));
		pi.appendCompaction("earlier", null, 1);
		const latest = pi.appendCompaction("latest", null, 2);
		const first = pi.appendMessage({ role: "user", content: "first", timestamp: 5 });
		pi.appendMessage(answer({ responseId: "failure", stopReason: reason, errorMessage: ACP_STOPS[stop].text }));
		const next = pi.appendMessage({ role: "user", content: "next", timestamp: 6 });
		const proof = probe();
		expect(proof?.walk.inputs.map((i) => i.entryId)).toEqual([first, next]);
		expect(proof?.walk.compacted?.entryId).toBe(latest);
	});
