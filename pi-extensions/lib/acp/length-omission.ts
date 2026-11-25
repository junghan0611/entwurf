import { isDeepStrictEqual as equal } from "node:util";
import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import type { AcpSessionReader } from "../acp-host-facts.js";
import { CONTENTLESS, compactionSummaryText, type DeltaItem, type DeltaWalk } from "./branch-gate.js";
import { textInputBlocks } from "./context.js";
import { ACP_STOPS } from "./stop-texts.js";

type Walk = Extract<DeltaWalk, { ok: true }>;
const object = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null;
/** A null edit alone grants nothing. Join the sealed answer, edit target, projected entries and
 * actual provider messages before choosing any input by its raw entry id. No projected text is sent. */
export function lengthOmission(
	reader: AcpSessionReader | undefined,
	raw: unknown[],
	anchor: string | undefined,
	model: string,
	shown: readonly unknown[],
): { walk: Walk; carried: { ok: true; positions: number[] } } | undefined {
	if (!anchor || !reader?.buildSessionProjection || !raw.every((x) => object(x) && typeof x.id === "string")) return;
	const entries = raw as SessionEntry[];
	const branch = entries.filter((e) => !CONTENTLESS.has(e.type));
	const cuts = branch.filter(
		(e) => e.type === "message" && e.message.role === "assistant" && e.message.responseId === anchor,
	);
	if (cuts.length !== 1) return;
	const a = cuts[0];
	if (a.type !== "message") return;
	const i = branch.indexOf(a);
	const edit = branch[i + 1];
	if (edit?.type !== "context_edit") return; // The shared edit check below binds its target to a.id.
	const byId = new Map(entries.map((e) => [e.id, e]));
	if (byId.size !== entries.length) return;
	const omitted = new Set<string>();
	for (const [n, e] of branch.entries()) {
		if (e.type === "context_edit") {
			const p = branch[n - 1];
			if (p?.type !== "message" || e.targetId !== p.id || e.replacement !== null) return;
			const m = p.message;
			if (
				m.role !== "assistant" ||
				m.provider !== "entwurf" ||
				m.model !== model ||
				m.stopReason !== "length" ||
				!m.content.every((b) => b.type === "text" || b.type === "thinking")
			)
				return;
			omitted.add(p.id);
		} else if (e.type === "message") {
			if (!["system", "user", "assistant"].includes(e.message.role)) return;
		} else if (e.type !== "compaction") return;
	}
	let compacted: Walk["compacted"];
	const items: DeltaItem[] = [];
	const inputs: Walk["inputs"] = [];
	let pendingInput = false;
	for (const e of branch.slice(i + 2)) {
		if (e.type === "compaction") {
			if (inputs.length) return;
			const kept = byId.get(e.firstKeptEntryId);
			if (!kept || entries.indexOf(kept) > entries.indexOf(e)) return;
			compacted = { entryId: e.id, summary: e.summary, anchorKept: entries.indexOf(kept) <= entries.indexOf(a) };
			items.push({ kind: "compaction", summary: e.summary, entryId: e.id, firstKeptEntryId: e.firstKeptEntryId });
			continue;
		}
		if (e.type !== "message") return;
		const m = e.message;
		if (
			!pendingInput &&
			m.role === "assistant" &&
			m.provider === "entwurf" &&
			m.model === model &&
			m.stopReason === "error" &&
			m.errorMessage === ACP_STOPS.lengthWait.text
		) {
			continue;
		}
		if (
			m.role === "assistant" &&
			compacted &&
			pendingInput &&
			m.model === model &&
			m.provider === "entwurf" &&
			(m.stopReason === "error" || m.stopReason === "aborted") &&
			(m.errorMessage === ACP_STOPS.vendorCompactFailed.text || m.errorMessage === ACP_STOPS.vendorCompactUnknown.text)
		)
			continue;
		if (m.role !== "user") return;
		const blocks = textInputBlocks([m.content]);
		if (!blocks) return;
		pendingInput ||= blocks.length > 0;
		const input = { entryId: e.id, content: m.content, extension: false };
		inputs.push(input);
		items.push({ kind: "input", ...input });
	}
	const positions: number[] = [];
	let at = 0;
	const projection = reader.buildSessionProjection();
	// Pi may prepend the system message outside the projected history.
	if (object(shown[0]) && shown[0].role === "system" && projection.messages[0]?.role !== "system") at++;
	for (const { sourceEntry: e, messages } of projection.entries) {
		if (!equal(byId.get(e.id), e) || (omitted.has(e.id) && messages.length)) return;
		for (const m of messages) {
			const actual = shown[at];
			if (e.type === "compaction" && m.role === "compactionSummary") {
				if (
					m.summary !== e.summary ||
					!object(actual) ||
					actual.role !== "user" ||
					!equal(actual.content, [{ type: "text", text: compactionSummaryText(e.summary) }])
				)
					return;
			} else if (e.type === "compaction" && m.role === "system") {
				if (!equal(m, e.systemMessage) || !equal(actual, m)) return;
			} else if (e.type !== "message" || !equal(m, e.message) || !equal(actual, m)) return;
			if (inputs[positions.length]?.entryId === e.id) positions.push(at);
			at++;
		}
	}
	if (at !== shown.length || positions.length !== inputs.length) return;
	return {
		walk: {
			ok: true,
			anchor: a.message,
			items,
			inputs,
			...(compacted ? { compacted } : {}),
		},
		carried: { ok: true, positions },
	};
}
