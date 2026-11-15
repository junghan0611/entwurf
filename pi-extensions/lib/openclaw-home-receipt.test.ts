/**
 * #160 S6 §7: the landlord-home release MUST judges one candidate-attributed receipt. Proven beside
 * the judge with literal receipts written here (never built by the module under test).
 */
import { describe, expect, it } from "vitest";
import { judgeOpenclawHomeReceipt, OPENCLAW_HOME_RECEIPT_ROWS } from "./openclaw-home-receipt.ts";

const HEAD = "f13c3e99265bdd26855a060db2d028866d79d6ff";
const TARGET = "lab/main/agent:main:entwurf-desk#20261113T164129-222657";

function receipt(over: Record<string, unknown> = {}, rowOver: Record<string, unknown> = {}) {
	const rows: Record<string, unknown> = {};
	for (const name of OPENCLAW_HOME_RECEIPT_ROWS) {
		rows[name] = { target: TARGET, result: "pass", evidence: `lab receipt for ${name}` };
	}
	return { v: 1, candidate: { head: HEAD }, target: TARGET, rows: { ...rows, ...rowOver }, ...over };
}

describe("judgeOpenclawHomeReceipt", () => {
	it("a complete receipt for this candidate and this home passes", () => {
		expect(judgeOpenclawHomeReceipt(receipt(), HEAD)).toEqual({ ok: true, target: TARGET });
	});

	it("[QK:OPENCLAW-HOME-RECEIPT-REFUSES] an empty receipt, another candidate and a row naming another target are each refused by name", () => {
		const empty = judgeOpenclawHomeReceipt({}, HEAD);
		expect(empty.ok).toBe(false);
		const other = judgeOpenclawHomeReceipt(receipt({ candidate: { head: "0".repeat(40) } }), HEAD);
		expect(other).toMatchObject({ ok: false });
		expect(!other.ok && other.problems.join("\n")).toMatch(/is another candidate/);
		const mismatch = judgeOpenclawHomeReceipt(
			receipt(
				{},
				{ consume: { target: "lab/main/agent:main:other#20261113T164129-222657", result: "pass", evidence: "e" } },
			),
			HEAD,
		);
		expect(!mismatch.ok && mismatch.problems.join("\n")).toMatch(/rows\.consume: names another target/);
	});

	it.each([
		[
			"a row not passing",
			receipt({}, { reply: { target: TARGET, result: "unmeasured", evidence: "e" } }),
			/rows\.reply: result is unmeasured/,
		],
		[
			"a row without evidence",
			receipt({}, { close: { target: TARGET, result: "pass", evidence: " " } }),
			/rows\.close: carries no evidence/,
		],
		[
			"a missing row",
			(() => {
				const r = receipt();
				delete (r.rows as Record<string, unknown>).resources;
				return r;
			})(),
			/missing resources/,
		],
		["a stray row", receipt({}, { fresh: { target: TARGET, result: "pass", evidence: "e" } }), /stray fresh/],
		["a null row", receipt({}, { open: null }), /rows\.open: must be an object/],
		["a short head", receipt({ candidate: { head: "f13c3e99" } }), /full 40-hex commit/],
		["a bad target", receipt({ target: "lab/main/main#x" }), /receipt\.target/],
		["another version", receipt({ v: 2 }), /receipt\.v: must be 1/],
		["not an object", [] as unknown, /must be a JSON object/],
	])("refuses %s", (_n, raw, pattern) => {
		const v = judgeOpenclawHomeReceipt(raw, HEAD);
		expect(v.ok).toBe(false);
		expect(!v.ok && v.problems.join("\n")).toMatch(pattern);
	});
});
