import { readFileSync } from "node:fs";
import { resolve } from "node:path";
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

describe("ACP receipt version binding — measured (#171 V5, decision 10)", () => {
	const pins = (claude: string, agy: string) =>
		[
			"export const CLAUDE_ACP_AGENT = Object.freeze({",
			'\tname: "@agentclientprotocol/claude-agent-acp",',
			'\tfloor: "0.107.3",',
			`\tmeasured: "${claude}",`,
			"});",
			"export const AGY_ACP_AGENT = Object.freeze({",
			'\tname: "Antigravity ACP Server",',
			'\tfloor: "1.5.9",',
			`\tmeasured: "${agy}",`,
			"});",
		].join("\n");
	const root = resolve(import.meta.dirname, "../../..");
	const shipped = () =>
		checkReceiptVersions(
			readFileSync(resolve(root, "docs/acp-client-baseline.md"), "utf8"),
			JSON.parse(readFileSync(resolve(root, "package.json"), "utf8")),
			readFileSync(resolve(root, "pi-extensions/lib/acp/backend-adapter.ts"), "utf8"),
		);

	it("[QK:ACP-RECEIPT-CLAUDE-MEASURED] the Receipts Claude version is CLAUDE_ACP_AGENT.measured, exactly", () => {
		expect(checkReceiptVersions(doc("0.107.3", "1.5.12"), pkg, pins("0.107.3", "1.5.12")).claudeMeasured).toEqual([]);
		expect(checkReceiptVersions(doc("0.107.3", "1.5.12"), pkg, pins("0.107.4", "1.5.12")).claudeMeasured).not.toEqual(
			[],
		);
		expect(checkReceiptVersions(doc("0.107.3", "1.5.12"), pkg, adapter).claudeMeasured).not.toEqual([]);
		expect(shipped().claudeMeasured).toEqual([]);
	});

	it("[QK:ACP-RECEIPT-AGY-MEASURED] the Receipts agy version is AGY_ACP_AGENT.measured, exactly — above the floor is not enough", () => {
		expect(checkReceiptVersions(doc("0.107.3", "1.5.12"), pkg, pins("0.107.3", "1.5.12")).agyMeasured).toEqual([]);
		const newer = checkReceiptVersions(doc("0.107.3", "1.5.12"), pkg, pins("0.107.3", "1.5.13"));
		expect(newer.agy).toEqual([]);
		expect(newer.agyMeasured).not.toEqual([]);
		expect(checkReceiptVersions(doc("0.107.3", "1.5.12"), pkg, adapter).agyMeasured).not.toEqual([]);
		expect(shipped().agyMeasured).toEqual([]);
	});

	it("the shipped receipts, pin, floor and measured versions bind with no issue", () => {
		expect(shipped()).toEqual({ claude: [], agy: [], claudeMeasured: [], agyMeasured: [] });
	});
});
