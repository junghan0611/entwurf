/**
 * #160 S6 §7 / S6.5 amendment: the landlord-home release MUST judges one candidate-attributed receipt.
 * Proven beside the judge with literal receipts written here. The row inventory is this file's own
 * literal (review O2): the module's exported list is never used to build the expectation, so a row
 * dropped from production makes the literal receipt carry a stray row and fail.
 */
import { describe, expect, it } from "vitest";
import { judgeOpenclawHomeReceipt, type OpenclawHomeReceiptContext } from "./openclaw-home-receipt.ts";

const ROWS = [
	"open",
	"address",
	"consume",
	"reply",
	"close",
	"refusal",
	"compactReset",
	"visibility",
	"modelPolicy",
	"sendScope",
	"resources",
];
const HEAD = "f13c3e99265bdd26855a060db2d028866d79d6ff";
const COMMITTED = Date.parse("2026-11-15T01:00:00.000Z");
const TARGET = "lab/main/agent:main:entwurf-desk#20261113T164129-222657";
const DIGEST = "a".repeat(64);
/** The files the receipt points at, by path. */
const FILES: Record<string, string> = Object.fromEntries(ROWS.map((r) => [`/lab/receipts/${r}.txt`, DIGEST]));

const ctx = (over: Partial<OpenclawHomeReceiptContext> = {}): OpenclawHomeReceiptContext => ({
	candidateHead: HEAD,
	candidateCommittedAtMs: COMMITTED,
	nowMs: Date.parse("2026-11-15T04:00:00.000Z"),
	expectedTarget: TARGET,
	digestOf: (p) => FILES[p] ?? null,
	...over,
});

function receipt(over: Record<string, unknown> = {}, rowOver: Record<string, unknown> = {}) {
	const rows: Record<string, unknown> = {};
	for (const name of ROWS)
		rows[name] = { result: "pass", evidence: { path: `/lab/receipts/${name}.txt`, sha256: DIGEST } };
	return {
		v: 1,
		candidate: { head: HEAD },
		measuredAt: "2026-11-15T03:00:00.000Z",
		config: { scope: "lab", gatewayUrl: "ws://127.0.0.1:18811", bin: true, openclawVersion: "2026.11.3" },
		target: TARGET,
		rows: { ...rows, ...rowOver },
		...over,
	};
}

const problems = (raw: unknown, c = ctx()) => {
	const v = judgeOpenclawHomeReceipt(raw, c);
	return v.ok ? "" : v.problems.join("\n");
};

describe("judgeOpenclawHomeReceipt", () => {
	it("[QK:OPENCLAW-HOME-RECEIPT-ROW-INVENTORY] a complete receipt over this file's literal eleven rows passes, so a row dropped or added in production is caught", () => {
		expect(judgeOpenclawHomeReceipt(receipt(), ctx())).toEqual({ ok: true, target: TARGET });
	});

	it("[QK:OPENCLAW-HOME-RECEIPT-REFUSES] an empty receipt and another candidate's are each refused by name", () => {
		expect(problems({})).toMatch(/receipt: keys must be v, candidate, measuredAt, config, target, rows/);
		expect(problems(receipt({ candidate: { head: "0".repeat(40) } }))).toMatch(/is another candidate/);
	});

	it("[QK:OPENCLAW-HOME-RECEIPT-STRICT-KEYS] an unknown key at any level — candidate, config, row, evidence — is refused, never ignored", () => {
		expect(problems(receipt({ candidate: { head: HEAD, unmeasured: true } }))).toMatch(
			/receipt\.candidate: keys must be head \(missing none; stray unmeasured\)/,
		);
		expect(
			problems(
				receipt({
					config: {
						scope: "lab",
						gatewayUrl: "ws://127.0.0.1:18811",
						bin: true,
						openclawVersion: "2026.11.3",
						host: "x",
					},
				}),
			),
		).toMatch(/receipt\.config: .*stray host/);
		expect(
			problems(
				receipt(
					{},
					{
						consume: {
							result: "pass",
							evidence: { path: "/lab/receipts/consume.txt", sha256: DIGEST },
							unmeasured: true,
						},
					},
				),
			),
		).toMatch(/receipt\.rows\.consume: .*stray unmeasured/);
		expect(
			problems(
				receipt(
					{},
					{ reply: { result: "pass", evidence: { path: "/lab/receipts/reply.txt", sha256: DIGEST, note: "x" } } },
				),
			),
		).toMatch(/receipt\.rows\.reply\.evidence: .*stray note/);
	});

	it("[QK:OPENCLAW-HOME-RECEIPT-CONFIG] the configuration is required and bound to the target's scope", () => {
		const r = receipt();
		delete (r as Record<string, unknown>).config;
		expect(problems(r)).toMatch(/receipt\.config: must be an object/);
		expect(
			problems(
				receipt({
					config: { scope: "oracle", gatewayUrl: "ws://127.0.0.1:18811", bin: true, openclawVersion: "2026.11.3" },
				}),
			),
		).toMatch(/receipt\.config\.scope: oracle is not the target's scope lab/);
		expect(
			problems(receipt({ config: { scope: "lab", gatewayUrl: "http://x", bin: "yes", openclawVersion: "latest" } })),
		).toMatch(/gatewayUrl: must be a ws: or wss: URL[\s\S]*bin: must be a boolean[\s\S]*openclawVersion: must be/);
	});

	it("[QK:OPENCLAW-HOME-RECEIPT-EVIDENCE-DIGEST] a pass row's evidence must be a readable file with exactly the stated sha256", () => {
		expect(
			problems(
				receipt({}, { open: { result: "pass", evidence: { path: "/lab/receipts/open.txt", sha256: "b".repeat(64) } } }),
			),
		).toMatch(/rows\.open\.evidence: \/lab\/receipts\/open\.txt does not have sha256/);
		expect(
			problems(receipt({}, { open: { result: "pass", evidence: { path: "/lab/receipts/gone.txt", sha256: DIGEST } } })),
		).toMatch(/rows\.open\.evidence: \/lab\/receipts\/gone\.txt cannot be read/);
		expect(problems(receipt({}, { open: { result: "pass", evidence: "free text" } }))).toMatch(
			/rows\.open\.evidence: must be \{path, sha256\}/,
		);
	});

	it("[QK:OPENCLAW-HOME-RECEIPT-MEASURED-AFTER-COMMIT] a measurement taken at or before the candidate's commit is refused", () => {
		expect(problems(receipt({ measuredAt: "2026-11-15T01:00:00.000Z" }))).toMatch(
			/is not after the candidate's commit/,
		);
		expect(problems(receipt({ measuredAt: "2026-11-14T12:00:00.000Z" }))).toMatch(
			/is not after the candidate's commit/,
		);
		expect(problems(receipt({ measuredAt: "yesterday" }))).toMatch(/must be an ISO-8601 UTC time/);
	});

	it("[QK:OPENCLAW-HOME-RECEIPT-UNMEASURED-ALLOWLIST] only compactReset may be unmeasured, and only with a reason; resources, modelPolicy and every other row must pass", () => {
		expect(
			judgeOpenclawHomeReceipt(
				receipt(
					{},
					{
						compactReset: {
							result: "unmeasured",
							reason: "consumption after the vendor's compaction was not observed",
						},
					},
				),
				ctx(),
			),
		).toMatchObject({ ok: true });
		expect(problems(receipt({}, { resources: { result: "unmeasured", reason: "residue not observed" } }))).toMatch(
			/rows\.resources: may not be unmeasured/,
		);
		expect(
			problems(receipt({}, { modelPolicy: { result: "unmeasured", reason: "effective policy not observed" } })),
		).toMatch(/rows\.modelPolicy: may not be unmeasured/);
		expect(problems(receipt({}, { consume: { result: "unmeasured", reason: "r" } }))).toMatch(
			/rows\.consume: may not be unmeasured/,
		);
		expect(problems(receipt({}, { compactReset: { result: "unmeasured", reason: " " } }))).toMatch(
			/rows\.compactReset: unmeasured needs a reason/,
		);
		expect(problems(receipt({}, { visibility: { result: "fail", evidence: {} } }))).toMatch(
			/rows\.visibility: result is fail, not pass or unmeasured/,
		);
	});

	it("[QK:OPENCLAW-HOME-RECEIPT-NOT-FUTURE] a measurement time beyond the judging clock plus five minutes is refused; within the skew it stands", () => {
		expect(problems(receipt({ measuredAt: "2099-01-01T00:00:00.000Z" }))).toMatch(/is in the future/);
		expect(problems(receipt({ measuredAt: "2026-11-15T04:06:00.000Z" }))).toMatch(/is in the future/);
		expect(judgeOpenclawHomeReceipt(receipt({ measuredAt: "2026-11-15T04:04:00.000Z" }), ctx())).toMatchObject({
			ok: true,
		});
	});

	it("[QK:OPENCLAW-HOME-RECEIPT-EXPECTED-TARGET] a receipt naming another home throughout is refused against the operator's expected target", () => {
		const other = "lab/main/agent:main:other#20261113T164129-222657";
		expect(problems(receipt({ target: other }))).toMatch(/is not the expected home lab\/main\/agent:main:entwurf-desk/);
	});

	it.each([
		[
			"a missing row",
			(() => {
				const r = receipt();
				delete (r.rows as Record<string, unknown>).resources;
				return r;
			})(),
			/missing resources/,
		],
		["a stray row", receipt({}, { fresh: { result: "unmeasured", reason: "r" } }), /stray fresh/],
		["a null row", receipt({}, { open: null }), /rows\.open: must be an object/],
		["a short head", receipt({ candidate: { head: "f13c3e99" } }), /full 40-hex commit/],
		["a bad target", receipt({ target: "lab/main/main#x" }), /receipt\.target: must be/],
		["another version", receipt({ v: 2 }), /receipt\.v: must be 1/],
		["not an object", [] as unknown, /must be a JSON object/],
	])("refuses %s", (_n, raw, pattern) => {
		expect(problems(raw)).toMatch(pattern);
	});
});
