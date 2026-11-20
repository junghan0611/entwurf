import { describe, expect, it } from "vitest";
import { checkReceiptVersions } from "./receipt-versions.ts";

const pkg = { dependencies: { "@agentclientprotocol/claude-agent-acp": "0.107.3" } };
const adapter = 'export const AGY_ACP_AGENT = Object.freeze({ name: "Antigravity ACP Server", floor: "1.5.9" });';
const doc = (claude: string, agy: string) =>
	`# X\n\n## Receipts\n\nAll dated 2026-11-20, claude-agent-acp ${claude} (model)\nand agy ${agy} (model).\n\nOld: claude-agent-acp 0.1.0 agy 0.1.0`;

describe("ACP receipt version binding", () => {
	it("binds the unique first-paragraph Claude version to the exact package pin", () => {
		expect(checkReceiptVersions(doc("0.107.3", "1.5.12"), pkg, adapter).claude).toEqual([]);
		expect(checkReceiptVersions(doc("0.107.2", "1.5.12"), pkg, adapter).claude).not.toEqual([]);
		expect(checkReceiptVersions(doc("0.107.3-beta", "1.5.12"), pkg, adapter).claude).not.toEqual([]);
		expect(
			checkReceiptVersions(
				`${doc("0.107.3", "1.5.12").replace(" (model)", " claude-agent-acp 0.107.3 (model)")}`,
				pkg,
				adapter,
			).claude,
		).not.toEqual([]);
		expect(checkReceiptVersions("no header", pkg, adapter).claude).not.toEqual([]);
		for (const prefix of ["^", "~"]) {
			expect(
				checkReceiptVersions(
					doc("0.107.3", "1.5.12"),
					{ dependencies: { "@agentclientprotocol/claude-agent-acp": `${prefix}0.107.3` } },
					adapter,
				).claude,
			).not.toEqual([]);
		}
	});
	it("[QK:ACP-RECEIPT-AGY-NUMERIC] compares agy versions numerically rather than lexically", () => {
		expect(checkReceiptVersions(doc("0.107.3", "1.5.12"), pkg, adapter).agy).toEqual([]);
		expect(checkReceiptVersions(doc("0.107.3", "1.5.8"), pkg, adapter).agy).not.toEqual([]);
	});
	it("refuses a missing or ambiguous agy header and floor", () => {
		expect(checkReceiptVersions(doc("0.107.3", "1.5.9"), pkg, adapter).agy).toEqual([]);
		expect(checkReceiptVersions(doc("0.107.3", "1.5.12"), pkg, adapter).agy).toEqual([]);
		expect(checkReceiptVersions(doc("0.107.3", "1.5.8"), pkg, adapter).agy).not.toEqual([]);
		expect(checkReceiptVersions(doc("0.107.3", "1.4.99"), pkg, adapter).agy).not.toEqual([]);
		expect(checkReceiptVersions(doc("0.107.3", "1.5.12"), pkg, "").agy).not.toEqual([]);
		expect(checkReceiptVersions(doc("0.107.3", "1.5.12"), pkg, `${adapter}\n${adapter}`).agy).not.toEqual([]);
		expect(
			checkReceiptVersions(doc("0.107.3", "1.5.12").replace("and agy 1.5.12", "and no agy"), pkg, adapter).agy,
		).not.toEqual([]);
		expect(
			checkReceiptVersions(
				doc("0.107.3", "1.5.12").replace("and agy 1.5.12", "and agy 1.5.12 agy 1.5.12"),
				pkg,
				adapter,
			).agy,
		).not.toEqual([]);
	});
});
