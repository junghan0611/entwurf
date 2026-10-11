// Offline fixtures for demo/lib/pi-durable-work.ts (#138). Run: node --test demo/
import assert from "node:assert/strict";
import { test } from "node:test";
import type { PdToolCall } from "../../scripts/lib/pi-durable-fresh-live-receipts.ts";
import { carriesResult, judgePdWork, judgePiReceipt, notesExpectation, workQuestion } from "./pi-durable-work.ts";

const PI = "20261011T182453-ab4d16";
const exp = notesExpectation("DEMO-E4A4B8");
const GOOD_REPLY = "DEMO-E4A4B8: notes.txt has 3 lines. First line: the record is the address";

function call(name: string, args: Record<string, unknown>, text: string, isError = false): PdToolCall {
	return { id: `${name}-${Math.random()}`, name, arguments: args, result: { text, isError } };
}
function goodCalls(): PdToolCall[] {
	return [
		call("entwurf_callback", {}, "entwurf_v2 control-socket → sent"),
		call("entwurf_inbox_read", { gardenId: "pd" }, "[entwurf inbox read ⟵] ..."),
		call("bash", { command: "wc -l notes.txt && head -n 1 notes.txt" }, "3 notes.txt\nthe record is the address\n"),
		call("entwurf_v2", { target: PI, message: GOOD_REPLY }, "entwurf_v2 control-socket → sent"),
	];
}
const okAll = (vs: { ok: boolean }[]) => vs.every((v) => v.ok);

test("GOOD: the saved take's shape passes", () => {
	assert.equal(okAll(judgePdWork(goodCalls(), PI, exp)), true);
});

test("a native bash error is not work, even when the reply claims the result", () => {
	const calls = goodCalls();
	calls[2] = call("bash", { command: "wc -l notes.txt" }, "wc: notes.txt: No such file or directory", true);
	const v = judgePdWork(calls, PI, exp);
	assert.equal(v[0]?.ok, false);
	assert.equal(v[1]?.ok, true);
});

test("a wrong result fails both the native output and the reply", () => {
	const calls = goodCalls();
	calls[2] = call("bash", {}, "4 notes.txt\na launch receipt is not delivery\n");
	calls[3] = call(
		"entwurf_v2",
		{ target: PI, message: "DEMO-E4A4B8: notes.txt has 4 lines." },
		"entwurf_v2 control-socket → sent",
	);
	const v = judgePdWork(calls, PI, exp);
	assert.deepEqual(
		v.map((x) => x.ok),
		[false, false],
	);
});

test("a reply that carries only the token, or did not settle, is not the result travelling back", () => {
	const tokenOnly = goodCalls();
	tokenOnly[3] = call("entwurf_v2", { target: PI, message: "DEMO-E4A4B8 done" }, "entwurf_v2 control-socket → sent");
	assert.equal(judgePdWork(tokenOnly, PI, exp)[1]?.ok, false);
	const errored = goodCalls();
	errored[3] = call("entwurf_v2", { target: PI, message: GOOD_REPLY }, "rejected: dormant", true);
	assert.equal(judgePdWork(errored, PI, exp)[1]?.ok, false);
	const otherTarget = goodCalls();
	otherTarget[3] = call(
		"entwurf_v2",
		{ target: "someone-else", message: GOOD_REPLY },
		"entwurf_v2 control-socket → sent",
	);
	assert.equal(judgePdWork(otherTarget, PI, exp)[1]?.ok, false);
});

function assistant(text: string): unknown {
	return { type: "message", message: { role: "assistant", content: [{ type: "text", text }], stopReason: "stop" } };
}

test("pi side: reply payload and pi's closing answer must both carry the result", () => {
	const entries = [
		assistant("Sibling launched."),
		{ type: "custom_message" },
		assistant("DEMO-E4A4B8: 3 lines; first line: the record is the address"),
	];
	const good = judgePiReceipt({ index: 1, payload: GOOD_REPLY }, entries, exp);
	assert.equal(okAll(good), true);
	const wrongAnswer = [entries[0], entries[1], assistant("Done — the sibling replied.")];
	assert.deepEqual(
		judgePiReceipt({ index: 1, payload: GOOD_REPLY }, wrongAnswer, exp).map((v) => v.ok),
		[true, false],
	);
	// an answer BEFORE the reply row does not count
	const early = [assistant("DEMO-E4A4B8: 3 lines; first line: the record is the address"), { type: "custom_message" }];
	assert.deepEqual(
		judgePiReceipt({ index: 1, payload: GOOD_REPLY }, early, exp).map((v) => v.ok),
		[true, false],
	);
	assert.deepEqual(
		judgePiReceipt(null, entries, exp).map((v) => v.ok),
		[false, false],
	);
});

// ── coordinator review 2026-10-11: a count must be a declared count, the closing answer a completed row ──
test("correct first line + wrong count fails everywhere, whether or not the token holds the expected digit", () => {
	for (const token of ["DEMO-AB3DEF", "DEMO-ABCDEF"]) {
		const e = notesExpectation(token);
		const wrong = `${token}: notes.txt has 4 lines. First line: the record is the address`;
		const calls = goodCalls();
		calls[3] = call("entwurf_v2", { target: PI, message: wrong }, "entwurf_v2 control-socket → sent");
		assert.equal(judgePdWork(calls, PI, e)[1]?.ok, false, token);
		const entries = [{ type: "custom_message" }, assistant(`${token}: 4 lines; first line: the record is the address`)];
		assert.deepEqual(
			judgePiReceipt({ index: 0, payload: wrong }, entries, e).map((v) => v.ok),
			[false, false],
			token,
		);
	}
});

test("a reply that names no count, or two different counts, does not state the count", () => {
	const e = notesExpectation("DEMO-AB3DEF");
	const noCount = "DEMO-AB3DEF: first line: the record is the address";
	const twoCounts = "DEMO-AB3DEF: 3 lines (or 4 lines). First line: the record is the address";
	for (const m of [noCount, twoCounts]) {
		const calls = goodCalls();
		calls[3] = call("entwurf_v2", { target: PI, message: m }, "entwurf_v2 control-socket → sent");
		assert.equal(judgePdWork(calls, PI, e)[1]?.ok, false, m);
	}
});

test("bash must print the fixture's count line itself; a 3 elsewhere in the output is not the count", () => {
	const wrongCount = goodCalls();
	wrongCount[2] = call("bash", {}, "4 notes.txt\nthe record is the address\n");
	assert.equal(judgePdWork(wrongCount, PI, exp)[0]?.ok, false);
	const noCountLine = goodCalls();
	noCountLine[2] = call("bash", {}, "the record is the address\nTook 3.0s\n");
	assert.equal(judgePdWork(noCountLine, PI, exp)[0]?.ok, false);
});

test("an interim tool-use row with the right text does not stand in for a wrong closing answer", () => {
	const interim = {
		type: "message",
		message: {
			role: "assistant",
			content: [{ type: "text", text: "DEMO-E4A4B8: 3 lines; first line: the record is the address" }],
			stopReason: "toolUse",
		},
	};
	const entries = [{ type: "custom_message" }, interim, assistant("Done — the sibling replied.")];
	assert.deepEqual(
		judgePiReceipt({ index: 0, payload: GOOD_REPLY }, entries, exp).map((v) => v.ok),
		[true, false],
	);
	const noToken = [{ type: "custom_message" }, assistant("3 lines; first line: the record is the address")];
	assert.deepEqual(
		judgePiReceipt({ index: 0, payload: GOOD_REPLY }, noToken, exp).map((v) => v.ok),
		[true, false],
	);
	// the LAST completed row is the closing answer: a right answer followed by a wrong one fails
	const rightThenWrong = [
		{ type: "custom_message" },
		assistant("DEMO-E4A4B8: 3 lines; first line: the record is the address"),
		assistant("Correction: DEMO-E4A4B8 has 4 lines."),
	];
	assert.equal(judgePiReceipt({ index: 0, payload: GOOD_REPLY }, rightThenWrong, exp)[1]?.ok, false);
});

// ── coordinator decision 2026-10-11 (ACP take 1): `N notes.txt` is wc's own declared count, nothing looser ──
test("a declared count is `N lines` or wc's `N notes.txt`, every one equal to the fixture's, standing alone", () => {
	const e = notesExpectation("DEMO-AB3DEF");
	const accept = [
		"DEMO-AB3DEF: 3 notes.txt; the record is the address", // the actual ACP reply shape
		"DEMO-AB3DEF: 3 lines. First line: the record is the address",
		"DEMO-AB3DEF: notes.txt has 3 lines (wc: 3 notes.txt); first line: the record is the address",
	];
	const refuse = [
		"DEMO-AB3DEF: 4 notes.txt; the record is the address", // wrong count, right line
		"DEMO-AB3DEF: 4 lines; the record is the address",
		"DEMO-AB3DEF: the record is the address", // only the token's digit
		"DEMO-AB3DEF: 3 lines (4 notes.txt); the record is the address", // mixed 3 and 4
		"DEMO-AB3DEF: 3.5 lines; the record is the address", // decimal
		"DEMO-AB3DEF: 14 lines; the record is the address",
		"DEMO-AB3DEF: 33 notes.txt; the record is the address",
		"DEMO-AB3DEF: took 3.0s; the record is the address", // a duration is not a count
		"DEMO-AB3DEF: 3 lines; a launch receipt is not delivery", // right count, wrong first line
	];
	for (const t of accept) assert.equal(carriesResult(t, e), true, t);
	for (const t of refuse) assert.equal(carriesResult(t, e), false, t);
	assert.match(workQuestion("DEMO-AB3DEF"), /^DEMO-AB3DEF: .*"N lines".*first line/);
});
