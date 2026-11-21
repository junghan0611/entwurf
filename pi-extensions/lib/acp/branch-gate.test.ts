/**
 * #171 step 8 — the branch gate, against hand-built Pi branches.
 *
 * Oracle: the shapes themselves. Each refused branch is one where sending the delta would put an
 * input into a vendor session that holds another conversation, or leave one out; the gate has no
 * access to message text, so nothing here can pass by content.
 */

import { expect, it } from "vitest";
import { reuseBranchVerdict } from "./branch-gate.ts";

const T1 = "entwurf-turn:one";
const T2 = "entwurf-turn:two";

let seq = 0;
const entry = (type: string, extra: Record<string, unknown> = {}) => ({ type, id: `e${seq++}`, ...extra });
const user = (text: string) => entry("message", { message: { role: "user", content: text } });
const answer = (turnId: string | undefined, text = "ok", provider = "entwurf") =>
	entry("message", {
		message: { role: "assistant", provider, content: [{ type: "text", text }], responseId: turnId },
	});

it("[QK:ACP-BRANCH-GATE-EXACT-ANSWER] reuse needs the exact answer the session sealed as the last one on the branch", () => {
	// Control: the sealed answer, then inputs and entries that carry nothing to the vendor.
	expect(
		reuseBranchVerdict(T1, [
			user("first"),
			answer(T1),
			entry("model_change"),
			entry("message", { message: { role: "system", content: "" } }),
			user("second"),
			entry("custom_message", { customType: "entwurf", content: "mail" }),
			entry("custom"),
		]),
	).toEqual({ ok: true, inputs: ["second", "mail"] });

	// An input whose turn was refused: X never reached the vendor, so Y alone must not be sent.
	expect(reuseBranchVerdict(T1, [user("first"), answer(T1), user("X"), answer(T2, ""), user("Y")])).toMatchObject({
		ok: false,
		stop: "changed",
	});
	// Two answers to one input: Pi shows B, the vendor holds A. Same text, same parent, another turn.
	expect(reuseBranchVerdict(T1, [user("first"), answer(T2, "ok"), user("Y")])).toMatchObject({
		ok: false,
		stop: "changed",
	});
	// Nothing sealed, and an answer that carries no turn id: absence is not a match.
	expect(reuseBranchVerdict(undefined, [user("first"), answer(undefined), user("Y")])).toMatchObject({ ok: false });
	expect(reuseBranchVerdict("", [user("first"), answer(""), user("Y")])).toMatchObject({ ok: false });
	expect(reuseBranchVerdict(T1, [user("first")])).toMatchObject({ ok: false, stop: "changed" });
	expect(reuseBranchVerdict(T1, [])).toMatchObject({ ok: false, stop: "changed" });
});

it("[QK:ACP-BRANCH-GATE-NAMED-STOPS] what follows the last answer decides which stop is named", () => {
	expect(reuseBranchVerdict(T1, [user("a"), answer(T1), user("b"), answer(T1, "x", "openai")])).toMatchObject({
		ok: false,
		stop: "laterAnswer",
	});
	expect(
		reuseBranchVerdict(T1, [answer(T1), entry("message", { message: { role: "bashExecution", command: "ls" } })]),
	).toMatchObject({ ok: false, stop: "shellInput" });
	for (const after of [
		entry("message", { message: { role: "toolResult", toolName: "read" } }),
		entry("compaction", { summary: "s" }),
		entry("branch_summary", { summary: "s" }),
		entry("context_edit"),
		entry("something_new"),
		{ id: "no-type" },
		null,
	]) {
		expect(reuseBranchVerdict(T1, [answer(T1), after]), JSON.stringify(after)).toMatchObject({
			ok: false,
			stop: "changed",
		});
	}
});

it("[QK:ACP-BRANCH-GATE-INPUTS-IN-ORDER] the inputs after the pinned answer come back oldest first, a custom message as its content", () => {
	const blocks = [{ type: "text", text: "from a sibling" }];
	const verdict = reuseBranchVerdict(T1, [
		user("before"),
		answer(T1),
		user("X"),
		entry("custom_message", { customType: "entwurf", content: blocks }),
		entry("label"),
		user("Y"),
	]);
	expect(verdict).toEqual({ ok: true, inputs: ["X", blocks, "Y"] });
	expect(reuseBranchVerdict(T1, [user("before"), answer(T1)])).toEqual({ ok: true, inputs: [] });
});
