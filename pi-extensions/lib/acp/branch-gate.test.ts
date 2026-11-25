/**
 * #171 step 8 — the delta proof, against hand-built Pi branches.
 *
 * Oracle: the shapes themselves. Each refused branch is one where sending the delta would put an
 * input into a vendor session that holds another conversation, send one twice, or leave one out.
 * Nothing here can pass by message text: the walk is anchored on a turn id, a dispatch is known by
 * the entry ids its marker named, and "told" is read only from evidence stored with an answer.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { convertToLlm, SessionManager } from "@earendil-works/pi-coding-agent";
import { expect, it } from "vitest";
import {
	ACP_PROMPT_REJECTION_DIAGNOSTIC_TYPE,
	ACP_PROMPT_UNKNOWN_DIAGNOSTIC,
	ACP_SKIP_NOTICE_DIAGNOSTIC,
	compactionSummaryText,
	contextCarries,
	type DeltaWalk,
	selectDelta,
	walkDelta,
} from "./branch-gate.ts";

const T1 = "entwurf-turn:one";
const T2 = "entwurf-turn:two";
const T3 = "entwurf-turn:three";

let seq = 0;
const entry = (type: string, extra: Record<string, unknown> = {}) => ({ type, id: `e${seq++}`, ...extra });
const user = (text: string, id?: string) =>
	entry("message", { ...(id ? { id } : {}), message: { role: "user", content: text } });
const answer = (turnId: string | undefined, text = "ok", provider = "entwurf") =>
	entry("message", {
		message: { role: "assistant", provider, content: [{ type: "text", text }], responseId: turnId, stopReason: "stop" },
	});
const failed = (turnId: string | undefined, stopReason: "error" | "aborted", diagnostics: unknown[] = []) =>
	entry("message", {
		message: { role: "assistant", provider: "entwurf", content: [], responseId: turnId, stopReason, diagnostics },
	});
const unknownStamp = { type: ACP_PROMPT_UNKNOWN_DIAGNOSTIC, error: { message: "raw" } };
const rejectionStamp = (outcomeUnknown: boolean) => ({
	type: ACP_PROMPT_REJECTION_DIAGNOSTIC_TYPE,
	details: outcomeUnknown ? { outcomeUnknown: true } : {},
});
const skipNotice = (...turnIds: string[]) => ({ type: ACP_SKIP_NOTICE_DIAGNOSTIC, details: { turnIds } });

function walked(anchor: string | undefined, branch: unknown[]): Extract<DeltaWalk, { ok: true }> {
	const walk = walkDelta(anchor, branch);
	if (!walk.ok) throw new Error(`walk stopped: ${walk.stop} (${walk.why})`);
	return walk;
}
const texts = (inputs: readonly { content: unknown }[]) => inputs.map((input) => input.content);

it("[QK:ACP-BRANCH-GATE-EXACT-ANSWER] the walk needs the exact answer the session sealed, and passes only failed turns of ours on the way to it", () => {
	// Control: the sealed answer, then inputs and entries that carry nothing to the vendor.
	const ok = walked(T1, [user("a"), answer(T1), entry("model_change"), user("b"), entry("custom"), user("c")]);
	expect(texts(ok.inputs)).toEqual(["b", "c"]);
	expect(ok.anchor).toMatchObject({ responseId: T1 });
	// Nothing sealed, an empty id, another answer, an answer without an id: each stops.
	expect(walkDelta(undefined, [user("a"), answer(T1), user("b")])).toMatchObject({ ok: false, stop: "changed" });
	expect(walkDelta("", [user("a"), answer(""), user("b")])).toMatchObject({ ok: false, stop: "changed" });
	expect(walkDelta(T1, [user("a"), answer(T2), user("b")])).toMatchObject({ ok: false, stop: "changed" });
	expect(walkDelta(T1, [user("a"), answer(undefined), user("b")])).toMatchObject({ ok: false, stop: "changed" });
	// A completed answer after the anchor is a turn this session did not give: the walk never passes it.
	expect(walkDelta(T1, [user("a"), answer(T1), user("b"), answer(T2), user("c")])).toMatchObject({
		ok: false,
		stop: "changed",
	});
	// A failed or aborted turn of ours after the anchor is passed, and kept in its place.
	const past = walked(T1, [user("a"), answer(T1), user("b"), failed(T2, "error"), user("c"), failed(T3, "aborted")]);
	expect(past.items.map((item) => item.kind)).toEqual(["input", "failed", "input", "failed"]);
	// The anchor is found by id even when its own turn ended as an error the session answered (a refusal).
	expect(texts(walked(T2, [user("a"), answer(T1), user("b"), failed(T2, "error"), user("c")]).inputs)).toEqual(["c"]);
	// No anchor on the branch at all.
	expect(walkDelta(T1, [user("a"), user("b")])).toMatchObject({ ok: false, stop: "changed" });
});

it("[QK:ACP-BRANCH-GATE-NAMED-STOPS] what follows the last answer decides which stop is named", () => {
	const after = (...entries: unknown[]) => walkDelta(T1, [user("a"), answer(T1), ...entries]);
	expect(after(entry("message", { message: { role: "bashExecution", command: "ls" } }), user("b"))).toMatchObject({
		ok: false,
		stop: "shellInput",
	});
	expect(after(user("b"), answer(T2, "other", "anthropic"), user("c"))).toMatchObject({
		ok: false,
		stop: "laterAnswer",
	});
	expect(after(entry("compaction", {}), user("b"))).toMatchObject({ ok: false, stop: "changed" });
	expect(after(entry("branch_summary", { summary: "s" }), user("b"))).toMatchObject({ ok: false, stop: "changed" });
	expect(after(entry("context_edit", { targetId: "e1", replacement: null }), user("b"))).toMatchObject({
		ok: false,
		stop: "changed",
	});
	expect(after(entry("message", { message: { role: "toolResult" } }))).toMatchObject({ ok: false, stop: "changed" });
	expect(after({ id: "no-type" })).toMatchObject({ ok: false, stop: "changed" });
	// An input the marker could not name is not an input.
	expect(after({ type: "message", message: { role: "user", content: "b" } })).toMatchObject({
		ok: false,
		stop: "changed",
	});
	expect(after({ type: "custom_message", content: "mail" })).toMatchObject({ ok: false, stop: "changed" });
});

it("[QK:ACP-BRANCH-GATE-INPUTS-IN-ORDER] the inputs after the anchor come back oldest first with their entry ids, a custom message as its content", () => {
	const walk = walked(T1, [
		user("a"),
		answer(T1),
		user("b", "id-b"),
		entry("custom_message", { id: "id-mail", customType: "entwurf", content: "mail" }),
		entry("message", { message: { role: "system", content: "tools" } }),
		user("c", "id-c"),
	]);
	expect(walk.inputs).toEqual([
		{ kind: "input", entryId: "id-b", content: "b", extension: false },
		{ kind: "input", entryId: "id-mail", content: "mail", extension: true },
		{ kind: "input", entryId: "id-c", content: "c", extension: false },
	]);
});

it("[QK:ACP-DELTA-UNKNOWN-BY-ENTRY-ID] an input is held back only when a marker named its entry id: the place of a failed turn says nothing", () => {
	// anchor, X (typed; its turn stopped before any dispatch), F (that stop), Y (typed and dispatched;
	// outcome unknown), U (that stop, saying so), Z (typed now).
	const branch = [
		user("seed"),
		answer(T1),
		user("X", "id-x"),
		failed(T2, "error"),
		user("Y", "id-y"),
		failed(T3, "error", [unknownStamp]),
		user("Z", "id-z"),
	];
	const walk = walked(T1, branch);
	const unknown = [{ turnId: T3, inputEntryIds: ["id-y"] }];
	// skip: X was never sent and goes now; Y may be held by the agent and is not sent twice.
	const skip = selectDelta(walk, unknown, "skip");
	if (!skip.ok) throw new Error(skip.why);
	expect(texts(skip.send)).toEqual(["X", "Z"]);
	expect(texts(skip.held)).toEqual(["Y"]);
	expect(skip.untold).toEqual([]);
	// The marker named both inputs of one prompt: both are held, though a failed turn stands between them.
	const both = selectDelta(walk, [{ turnId: T3, inputEntryIds: ["id-x", "id-y"] }], "skip");
	if (!both.ok) throw new Error(both.why);
	expect(texts(both.send)).toEqual(["Z"]);
	expect(texts(both.held)).toEqual(["X", "Y"]);
	// No marker: every failed turn stopped before a dispatch, and everything is sent.
	const none = selectDelta(walk, [], "skip");
	if (!none.ok) throw new Error(none.why);
	expect(texts(none.send)).toEqual(["X", "Y", "Z"]);
	expect(none.held).toEqual([]);
	// resend: an agent that keeps nothing of an unanswered prompt is sent every input again, in order.
	const resend = selectDelta(walk, unknown, "resend");
	if (!resend.ok) throw new Error(resend.why);
	expect(texts(resend.send)).toEqual(["X", "Y", "Z"]);
	expect(resend.held).toEqual([]);
	// An input the session was sent that is no longer after the anchor: another branch. Both policies stop.
	for (const policy of ["skip", "resend"] as const) {
		expect(selectDelta(walk, [{ turnId: T3, inputEntryIds: ["id-gone"] }], policy)).toMatchObject({
			ok: false,
			stop: "changed",
		});
	}
});

it("[QK:ACP-DELTA-TOLD-NEEDS-EVIDENCE] a held input counts as told only by evidence stored with an answer on the branch", () => {
	const unknown = [{ turnId: T2, inputEntryIds: ["id-y"] }];
	const untold = (...after: unknown[]) => {
		const selection = selectDelta(walked(T1, [user("seed"), answer(T1), user("Y", "id-y"), ...after]), unknown, "skip");
		if (!selection.ok) throw new Error(selection.why);
		return selection.untold;
	};
	// The marker alone, with no answer stored for the turn (a crash): not told.
	expect(untold()).toEqual([T2]);
	// The turn's own failed answer without the stamp, or an abort: not told.
	expect(untold(failed(T2, "error"))).toEqual([T2]);
	expect(untold(failed(T2, "aborted", [unknownStamp]))).toEqual([T2]);
	expect(untold(failed(T2, "error", [rejectionStamp(false)]))).toEqual([T2]);
	// Another turn's stamp does not speak for this dispatch.
	expect(untold(failed(T3, "error", [unknownStamp]))).toEqual([T2]);
	expect(untold(failed(T3, "error", [skipNotice("entwurf-turn:else")]))).toEqual([T2]);
	// Told: the turn's own answer carrying the unknown stamp, or a rejection stamped as unknown.
	expect(untold(failed(T2, "error", [unknownStamp]))).toEqual([]);
	expect(untold(failed(T2, "error", [rejectionStamp(true)]))).toEqual([]);
	// Told: a later stop whose notice names this dispatch.
	expect(untold(failed(T2, "aborted"), user("Z", "id-z"), failed(T3, "error", [skipNotice(T2)]))).toEqual([]);
});

it("[QK:ACP-DELTA-CONTEXT-CARRIES] the context must hold exactly the walked inputs after the very answer the session gave last", () => {
	const blocksOf = (content: unknown) => (typeof content === "string" ? [{ type: "text", text: content }] : undefined);
	const anchorMessage = { role: "assistant", content: [{ type: "text", text: "ok" }], responseId: T1 };
	const walk = walked(T1, [
		user("seed"),
		answer(T1),
		user("X", "id-x"),
		failed(T2, "error", [unknownStamp]),
		user("Y", "id-y"),
	]);
	const carries = (messages: unknown[]) => contextCarries(walk, messages, T1, blocksOf, isDeepStrictEqual);
	const u = (text: string) => ({ role: "user", content: text });
	const failedMessage = { role: "assistant", stopReason: "error", responseId: T2, content: [] };
	// Control: with the failed answer in the context, and without it. Positions are the inputs' own.
	expect(carries([u("seed"), anchorMessage, u("X"), failedMessage, u("Y")])).toEqual({ ok: true, positions: [2, 4] });
	expect(carries([u("seed"), anchorMessage, u("X"), u("Y")])).toEqual({ ok: true, positions: [2, 3] });
	// A system message between them is Pi's own and is passed.
	expect(carries([u("seed"), anchorMessage, u("X"), { role: "system", content: "s" }, u("Y")])).toMatchObject({
		ok: true,
	});
	// Dropped, replaced, added, reordered.
	expect(carries([u("seed"), anchorMessage, u("Y")]).ok).toBe(false);
	expect(carries([u("seed"), anchorMessage, u("X"), u("Z")]).ok).toBe(false);
	expect(carries([u("seed"), anchorMessage, u("W"), u("X"), u("Y")]).ok).toBe(false);
	expect(carries([u("seed"), anchorMessage, u("Y"), u("X")]).ok).toBe(false);
	// An input that is not text only is never compared as equal.
	expect(carries([u("seed"), anchorMessage, u("X"), { role: "user", content: [{ type: "image" }] }]).ok).toBe(false);
	// Another failed answer in the place of ours is not ours.
	expect(carries([u("seed"), anchorMessage, u("X"), { ...failedMessage, responseId: T3 }, u("Y")]).ok).toBe(false);
	// The anchor is the answer with the sealed turn id. Equal content under another id, or under none, is not it.
	expect(carries([u("seed"), { ...anchorMessage, responseId: T3 }, u("X"), u("Y")]).ok).toBe(false);
	expect(carries([u("seed"), { ...anchorMessage, responseId: undefined }, u("X"), u("Y")]).ok).toBe(false);
	expect(carries([u("seed"), { role: "assistant", content: anchorMessage.content }, u("X"), u("Y")]).ok).toBe(false);
	// No answer before the inputs at all.
	expect(carries([u("X"), u("Y")]).ok).toBe(false);
});

it("[QK:ACP-DELTA-COMPACTION-PASSED] a Pi compaction after the last answer is passed: what stands before the inputs is the answer where Pi kept it and that compaction's summary where it did not", () => {
	const blocksOf = (content: unknown) => {
		if (typeof content === "string") return [{ type: "text", text: content }];
		return Array.isArray(content) ? content : undefined;
	};
	// Branch and context are Pi's own: its session manager appends, compacts and projects.
	const project = (keep: "answer" | "input" | "nothing") => {
		const session = SessionManager.inMemory();
		session.appendMessage({ role: "user", content: "seed", timestamp: 0 });
		const answerId = session.appendMessage({
			role: "assistant",
			content: [{ type: "text", text: "ok" }],
			api: "entwurf",
			provider: "entwurf",
			model: "m",
			usage: {
				input: 0,
				output: 0,
				cacheRead: 0,
				cacheWrite: 0,
				totalTokens: 0,
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
			},
			stopReason: "stop",
			responseId: T1,
			timestamp: 1,
		} as never);
		const inputId = session.appendMessage({ role: "user", content: "X", timestamp: 2 });
		const oldId = session.appendCompaction("OLD", answerId, 10);
		const sumId = session.appendCompaction("SUM", keep === "answer" ? answerId : keep === "input" ? inputId : null, 10);
		session.appendMessage({ role: "user", content: "Y", timestamp: 3 });
		return {
			oldId,
			sumId,
			branch: session.getBranch() as unknown[],
			context: convertToLlm(session.buildSessionContext().messages) as unknown[],
		};
	};
	const carries = (branch: unknown[], context: unknown[]) =>
		contextCarries(walked(T1, branch), context, T1, blocksOf, isDeepStrictEqual);
	const keptAnswer = project("answer");
	const keptInput = project("input");
	expect(keptAnswer.context.map((m) => (m as { role: string }).role)).toEqual(["user", "assistant", "user", "user"]);
	expect(keptInput.context.map((m) => (m as { role: string }).role)).toEqual(["user", "user", "user"]);
	// #175: the boundary is the LATEST compaction after the anchor, named by its own entry id.
	expect(walked(T1, keptAnswer.branch).compacted).toEqual({
		summary: "SUM",
		anchorKept: true,
		entryId: keptAnswer.sumId,
	});
	expect(walked(T1, keptInput.branch).compacted).toEqual({
		summary: "SUM",
		anchorKept: false,
		entryId: keptInput.sumId,
	});
	expect(keptAnswer.sumId).not.toBe(keptAnswer.oldId);
	// Control: each branch with its own projection.
	expect(carries(keptAnswer.branch, keptAnswer.context)).toEqual({ ok: true, positions: [2, 3] });
	expect(carries(keptInput.branch, keptInput.context)).toEqual({ ok: true, positions: [1, 2] });
	// The two are not interchangeable: a summary where Pi kept the answer, an answer where it did not.
	expect(carries(keptAnswer.branch, keptInput.context).ok).toBe(false);
	expect(carries(keptInput.branch, keptAnswer.context).ok).toBe(false);
	// An input Pi compacted away is in no context: the walk stops, whatever a context shows.
	expect(walkDelta(T1, project("nothing").branch)).toMatchObject({ ok: false, stop: "changed" });
	// The head must be that compaction's summary, alone at the start.
	const head = (summary: string) => ({
		role: "user",
		content: [{ type: "text", text: compactionSummaryText(summary) }],
	});
	const u = (text: string) => ({ role: "user", content: text });
	expect(carries(keptInput.branch, [head("SUM"), u("X"), u("Y")]).ok).toBe(true);
	expect(carries(keptInput.branch, [head("OLD"), u("X"), u("Y")]).ok).toBe(false);
	expect(carries(keptInput.branch, [u("SUM"), u("X"), u("Y")]).ok).toBe(false);
	expect(carries(keptInput.branch, [u("earlier"), head("SUM"), u("X"), u("Y")]).ok).toBe(false);
	expect(carries(keptInput.branch, [head("SUM"), u("Y")]).ok).toBe(false);
	// Without a compaction on the branch a user message is never a head.
	const plain = walked(T1, [user("seed"), answer(T1), user("X", "id-x")]);
	expect(contextCarries(plain, [head("SUM"), u("X")], T1, blocksOf, isDeepStrictEqual).ok).toBe(false);
	// The head text is Pi's own, which the package does not export.
	const source = readFileSync(
		join(process.cwd(), "node_modules/@earendil-works/pi-coding-agent/dist/core/messages.js"),
		"utf8",
	);
	const constant = (name: string) => new RegExp(`export const ${name} = \`([^\`]*)\`;`).exec(source)?.[1];
	expect(compactionSummaryText("S")).toBe(
		`${constant("COMPACTION_SUMMARY_PREFIX")}S${constant("COMPACTION_SUMMARY_SUFFIX")}`,
	);
});
