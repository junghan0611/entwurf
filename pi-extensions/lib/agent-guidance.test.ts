/** #154 current oracles: frozen C0 objects + explicit literal amendments (review provenance per layer), never product output. */
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { bootBridgeAndListTools } from "../../test/helpers/fresh-call-fixtures.ts";
import { createPiDurableContact, PI_DURABLE_TOOL_SCHEMAS } from "../meta-bridge-pi-durable.ts";
import {
	ENTWURF_DELIVERY_RESULT_CLAUSES,
	ENTWURF_FRESH_LAUNCH_REJECT_HINTS,
	ENTWURF_GUIDANCE_VERSION,
	ENTWURF_REJECT_HINTS,
	ENTWURF_RESUME_LAUNCH_REJECT_HINTS,
	ENTWURF_RESUME_REJECT_HINTS,
	ENTWURF_SLOTTED_REJECT_HINTS,
	ENTWURF_TOOL_GUIDANCE,
	parseEntwurfGuidance,
} from "./agent-guidance.ts";

const ROOT = path.resolve(import.meta.dirname, "../..");
const SOURCE = fs.readFileSync(path.join(ROOT, "ENTWURF.json"), "utf8");
interface OriginalTool {
	name: keyof typeof ENTWURF_TOOL_GUIDANCE;
	description: string;
	parameters: { field: string; text: string }[];
}
const original = JSON.parse(
	fs.readFileSync(new URL("./fixtures/agent-guidance/metadata-before-94d0594.json", import.meta.url), "utf8"),
) as {
	sourceSha: string;
	mcp: OriginalTool[];
	durable: OriginalTool[];
	schemas: Record<string, unknown>;
};
interface ToolSchema {
	properties: Record<string, { description: string }>;
}
interface RuntimeTool {
	name: OriginalTool["name"];
	description: string;
	inputSchema: ToolSchema;
}
const originalRuntime: RuntimeTool[] = JSON.parse(
	fs.readFileSync(new URL("./fixtures/agent-guidance/mcp-tools-before-94d0594.json", import.meta.url), "utf8"),
);

interface ReviewedAmendmentLayer {
	revision: number;
	amendments: {
		key: ["tools", OriginalTool["name"], "descriptions" | "parameters", string];
		old: string;
		new: string;
	}[];
}
const reviewedR2 = JSON.parse(
	fs.readFileSync(new URL("./fixtures/agent-guidance/amendments-revision-2.json", import.meta.url), "utf8"),
) as ReviewedAmendmentLayer;
const reviewedR3 = JSON.parse(
	fs.readFileSync(new URL("./fixtures/agent-guidance/amendments-revision-3.json", import.meta.url), "utf8"),
) as ReviewedAmendmentLayer & { previousRevision: number };
// Revision 4 adds a family rather than amending a tools leaf: its C0 hint text is its own oracle.
const originalRejectHints = JSON.parse(
	fs.readFileSync(new URL("./fixtures/agent-guidance/reject-hints-before-94d0594.json", import.meta.url), "utf8"),
) as { sourceSha: string; previousRevision: number; introducedRevision: number; hints: Record<string, string> };
// Revision 5 adds the visible-resume family the same way; its C0 hint text is its own oracle too.
const originalResumeRejectHints = JSON.parse(
	fs.readFileSync(
		new URL("./fixtures/agent-guidance/resume-reject-hints-before-94d0594.json", import.meta.url),
		"utf8",
	),
) as { sourceSha: string; previousRevision: number; introducedRevision: number; hints: Record<string, string> };
// Revision 6 is the first reviewed literal layer on a reject-hint leaf, typed apart from the tools layers.
const reviewedR6 = JSON.parse(
	fs.readFileSync(new URL("./fixtures/agent-guidance/amendments-revision-6.json", import.meta.url), "utf8"),
) as {
	previousRevision: number;
	revision: number;
	amendments: { key: ["rejectHints", string]; old: string; new: string }[];
};
// Revision 7 adds the two tmux launch-stage families; their C0 hint text is its own oracle, per verb.
const originalLaunchRejectHints = JSON.parse(
	fs.readFileSync(
		new URL("./fixtures/agent-guidance/launch-reject-hints-before-94d0594.json", import.meta.url),
		"utf8",
	),
) as {
	sourceSha: string;
	previousRevision: number;
	introducedRevision: number;
	fresh: Record<string, string>;
	resume: Record<string, string>;
};
// Revision 8 adds the delivery-result clauses; C0 does not inventory their modules, so the oracle is
// two independent extractions from the 94d0594 blobs that agreed byte-for-byte.
const originalDeliveryResultClauses = JSON.parse(
	fs.readFileSync(
		new URL("./fixtures/agent-guidance/delivery-result-clauses-before-94d0594.json", import.meta.url),
		"utf8",
	),
) as {
	sourceSha: string;
	sourceBlobSha256: Record<string, string>;
	previousRevision: number;
	introducedRevision: number;
	clauses: Record<string, string>;
};
// Revision 9 adds the record-less-socket hint's text on either side of its one code-owned slot; the
// C0 item records it as segments around that slot, so the oracle is those segments joined plus the
// C0 template, agreed byte-for-byte by two independent extractions before the product JSON was edited.
const originalSlottedRejectHints = JSON.parse(
	fs.readFileSync(
		new URL("./fixtures/agent-guidance/record-less-socket-hint-before-94d0594.json", import.meta.url),
		"utf8",
	),
) as {
	sourceSha: string;
	sourceBlobSha256: Record<string, string>;
	c0Item: string;
	previousRevision: number;
	introducedRevision: number;
	slot: string;
	template: string;
	segments: Record<string, Record<string, string>>;
};

const amendmentsR10 = JSON.parse(
	fs.readFileSync(new URL("./fixtures/agent-guidance/amendments-revision-10.json", import.meta.url), "utf8"),
) as {
	previousRevision: number;
	revision: number;
	amendments: {
		key: ["rejectHints" | "resumeRejectHints" | "deliveryResultClauses", string];
		old: string;
		new: string;
	}[];
};

type ToolAmendment = ReviewedAmendmentLayer["amendments"][number];
const reviewedR11 = JSON.parse(
	fs.readFileSync(new URL("./fixtures/agent-guidance/amendments-revision-11.json", import.meta.url), "utf8"),
) as {
	previousRevision: number;
	revision: number;
	amendments: (ToolAmendment | { key: ["rejectHints" | "resumeRejectHints", string]; old: string; new: string })[];
};
const reviewedToolsR11: ReviewedAmendmentLayer = {
	revision: reviewedR11.revision,
	amendments: reviewedR11.amendments.filter((a): a is ToolAmendment => a.key[0] === "tools"),
};

// Revision 10 was recorded before the Fable wording discussion. Its old values and provenance
// remain intact; revision 11 applies that discussion's separate five-leaf amendment afterward.
function applyR10(family: string, expected: Record<string, string>): void {
	expect(amendmentsR10.amendments).toHaveLength(3);
	expect(amendmentsR10.amendments.map((a) => a.key.join(".")).sort()).toEqual([
		"deliveryResultClauses.dirty-lock",
		"rejectHints.native-push-probe-indeterminate",
		"resumeRejectHints.target-invalid",
	]);
	for (const amendment of amendmentsR10.amendments) {
		if (amendment.key[0] !== family) continue;
		const key = amendment.key[1];
		expect(expected[key]).toBe(amendment.old);
		expect(amendment.new).not.toBe(amendment.old);
		expected[key] = amendment.new;
	}
}

function applyR11(family: string, expected: Record<string, string>): void {
	expect(reviewedR11.amendments).toHaveLength(5);
	expect(reviewedR11.amendments.map((a) => a.key.join(".")).sort()).toEqual([
		"rejectHints.native-push-target-dead",
		"resumeRejectHints.target-receiver-absent",
		"resumeRejectHints.target-receiver-unbound",
		"tools.entwurf_register_native.descriptions.mcp",
		"tools.entwurf_v2.descriptions.mcp",
	]);
	for (const amendment of reviewedR11.amendments) {
		if (amendment.key[0] === "tools" || amendment.key[0] !== family) continue;
		const key = amendment.key[1];
		expect(expected[key]).toBe(amendment.old);
		expect(amendment.new).not.toBe(amendment.old);
		expected[key] = amendment.new;
	}
}

// Only description leaves may change. Full schemas/annotations/order come from immutable C0,
// while reviewed literals were selected independently before the product JSON was amended.
function currentExpectations() {
	const metadata = structuredClone(original);
	const runtime = structuredClone(originalRuntime);
	expect(reviewedR2.revision).toBe(2);
	expect(reviewedR2.amendments).toHaveLength(13);
	expect(reviewedR3.previousRevision).toBe(reviewedR2.revision);
	expect(reviewedR3.revision).toBe(3);
	expect(reviewedR3.amendments).toHaveLength(1);
	expect(reviewedR3.amendments[0].key).toEqual(["tools", "entwurf_v2", "parameters", "intent"]);
	const declaredKeys = new Set<string>();
	expect(reviewedToolsR11.amendments).toHaveLength(2);
	for (const layer of [reviewedR2, reviewedR3, reviewedToolsR11]) {
		expect(new Set(layer.amendments.map((a) => a.key.join("."))).size).toBe(layer.amendments.length);
		for (const amendment of layer.amendments) {
			const [root, name, family, field] = amendment.key;
			expect(root).toBe("tools");
			expect(amendment.new).not.toBe(amendment.old);
			declaredKeys.add(amendment.key.join("."));
			const mcp = runtime.find((tool) => tool.name === name)!;
			if (family === "descriptions") {
				expect(["mcp", "durable"]).toContain(field);
				const expected = metadata[field as "mcp" | "durable"].find((tool) => tool.name === name)!;
				expect(expected.description).toBe(amendment.old);
				expected.description = amendment.new;
				if (field === "mcp") {
					expect(mcp.description).toBe(amendment.old);
					mcp.description = amendment.new;
				}
			} else {
				expect(family).toBe("parameters");
				expect(name).toBe("entwurf_v2");
				for (const rail of ["mcp", "durable"] as const) {
					const parameter = metadata[rail]
						.find((tool) => tool.name === name)!
						.parameters.find((p) => p.field === field)!;
					expect(parameter.text).toBe(amendment.old);
					parameter.text = amendment.new;
				}
				const schema = metadata.schemas[name] as ToolSchema;
				for (const expected of [mcp.inputSchema, schema]) {
					expect(expected.properties[field].description).toBe(amendment.old);
					expected.properties[field].description = amendment.new;
				}
			}
		}
	}
	expect(declaredKeys.size).toBe(13);
	return { metadata, runtime, declaredKeys };
}

describe("root product guidance — frozen originals plus reviewed current amendments", () => {
	it("[QK:GUIDANCE-REVIEWED-REVISION] the actual loaded payload revision equals the independently reviewed revision", () => {
		expect(reviewedR3.revision).toBe(3);
		expect(originalRejectHints.previousRevision).toBe(reviewedR3.revision);
		expect(originalRejectHints.introducedRevision).toBe(4);
		expect(originalResumeRejectHints.previousRevision).toBe(originalRejectHints.introducedRevision);
		expect(originalResumeRejectHints.introducedRevision).toBe(5);
		expect(reviewedR6.previousRevision).toBe(originalResumeRejectHints.introducedRevision);
		expect(reviewedR6.revision).toBe(6);
		expect(originalLaunchRejectHints.previousRevision).toBe(reviewedR6.revision);
		expect(originalLaunchRejectHints.introducedRevision).toBe(7);
		expect(originalDeliveryResultClauses.previousRevision).toBe(originalLaunchRejectHints.introducedRevision);
		expect(originalDeliveryResultClauses.introducedRevision).toBe(8);
		expect(originalSlottedRejectHints.previousRevision).toBe(originalDeliveryResultClauses.introducedRevision);
		expect(originalSlottedRejectHints.introducedRevision).toBe(9);
		expect(amendmentsR10.previousRevision).toBe(originalSlottedRejectHints.introducedRevision);
		expect(amendmentsR10.revision).toBe(10);
		expect(reviewedR11.previousRevision).toBe(amendmentsR10.revision);
		expect(reviewedR11.revision).toBe(11);
		expect(ENTWURF_GUIDANCE_VERSION.revision).toBe(reviewedR11.revision);
	});

	it("[QK:GUIDANCE-REJECT-HINTS-ORIGINAL] every static reject hint matches C0 plus the declared revision-6, revision-10 and reviewed revision-11 amendments", () => {
		expect(originalRejectHints.sourceSha).toBe("94d0594182cbd9cf0a5c90f4d299cda40d870b8f");
		const expected = structuredClone(originalRejectHints.hints);
		expect(reviewedR6.amendments).toHaveLength(1);
		for (const amendment of reviewedR6.amendments) {
			const [family, reason] = amendment.key;
			expect(family).toBe("rejectHints");
			expect(Object.keys(originalRejectHints.hints)).toContain(reason);
			expect(amendment.old).toBe(originalRejectHints.hints[reason]);
			expect(amendment.new).not.toBe(amendment.old);
			expected[reason] = amendment.new;
		}
		applyR10("rejectHints", expected);
		applyR11("rejectHints", expected);
		expect(Object.keys(ENTWURF_REJECT_HINTS).sort()).toEqual(Object.keys(expected).sort());
		for (const [reason, text] of Object.entries(expected)) {
			const actual = (ENTWURF_REJECT_HINTS as Readonly<Record<string, string>>)[reason];
			expect(Buffer.from(actual)).toEqual(Buffer.from(text));
		}
		const changed = Object.keys(expected).filter((reason) => expected[reason] !== originalRejectHints.hints[reason]);
		expect(changed).toEqual(["native-push-target-dead", "native-push-probe-indeterminate", "native-push-paused"]);
		expect(Object.keys(expected).filter((reason) => !changed.includes(reason))).toHaveLength(2);
		expect(Object.isFrozen(ENTWURF_REJECT_HINTS)).toBe(true);
	});

	it("[QK:GUIDANCE-RESUME-REJECT-HINTS-ORIGINAL] every static visible-resume reject hint matches C0 plus the declared revision-10 and reviewed revision-11 amendments", () => {
		expect(originalResumeRejectHints.sourceSha).toBe("94d0594182cbd9cf0a5c90f4d299cda40d870b8f");
		const expected = structuredClone(originalResumeRejectHints.hints);
		applyR10("resumeRejectHints", expected);
		applyR11("resumeRejectHints", expected);
		expect(Object.keys(ENTWURF_RESUME_REJECT_HINTS).sort()).toEqual(Object.keys(expected).sort());
		for (const [reason, text] of Object.entries(expected)) {
			const actual = (ENTWURF_RESUME_REJECT_HINTS as Readonly<Record<string, string>>)[reason];
			expect(Buffer.from(actual)).toEqual(Buffer.from(text));
		}
		expect(Object.isFrozen(ENTWURF_RESUME_REJECT_HINTS)).toBe(true);
	});

	it("[QK:GUIDANCE-LAUNCH-REJECT-HINTS-ORIGINAL] every static tmux launch-stage hint is the exact pre-extraction C0 string, per verb, with no cross-verb dedupe", () => {
		expect(originalLaunchRejectHints.sourceSha).toBe("94d0594182cbd9cf0a5c90f4d299cda40d870b8f");
		for (const [actualFamily, expected] of [
			[ENTWURF_FRESH_LAUNCH_REJECT_HINTS, originalLaunchRejectHints.fresh],
			[ENTWURF_RESUME_LAUNCH_REJECT_HINTS, originalLaunchRejectHints.resume],
		] as const) {
			expect(Object.keys(actualFamily).sort()).toEqual(Object.keys(expected).sort());
			for (const [reason, text] of Object.entries(expected)) {
				const actual = (actualFamily as Readonly<Record<string, string>>)[reason];
				expect(Buffer.from(actual)).toEqual(Buffer.from(text));
			}
			expect(Object.isFrozen(actualFamily)).toBe(true);
		}
		// Two verbs, two records: the shared keys keep each verb's own text even where it matches.
		const fresh = originalLaunchRejectHints.fresh;
		const resume = originalLaunchRejectHints.resume;
		const shared = Object.keys(fresh).filter((reason) => reason in resume);
		expect(shared.filter((reason) => fresh[reason] === resume[reason])).toHaveLength(8);
		expect(shared.filter((reason) => fresh[reason] !== resume[reason])).toHaveLength(6);
		expect(Object.keys(fresh).filter((reason) => !(reason in resume))).toHaveLength(5);
		expect(Object.keys(resume).filter((reason) => !(reason in fresh))).toEqual(["herdr-resume-unsupported"]);
		expect(ENTWURF_FRESH_LAUNCH_REJECT_HINTS).not.toBe(ENTWURF_RESUME_LAUNCH_REJECT_HINTS);
	});

	it("[QK:GUIDANCE-DELIVERY-RESULT-CLAUSES-ORIGINAL] every static delivery-result clause matches the 94d0594 source blob plus the declared pre-release revision-10 amendment", () => {
		expect(originalDeliveryResultClauses.sourceSha).toBe("94d0594182cbd9cf0a5c90f4d299cda40d870b8f");
		expect(Object.keys(originalDeliveryResultClauses.sourceBlobSha256).sort()).toEqual([
			"entwurf-v2-surface.ts",
			"remote-pair-send.ts",
		]);
		const expected = structuredClone(originalDeliveryResultClauses.clauses);
		applyR10("deliveryResultClauses", expected);
		expect(Object.keys(ENTWURF_DELIVERY_RESULT_CLAUSES).sort()).toEqual(Object.keys(expected).sort());
		for (const [key, text] of Object.entries(expected)) {
			const actual = (ENTWURF_DELIVERY_RESULT_CLAUSES as Readonly<Record<string, string>>)[key];
			expect(Buffer.from(actual)).toEqual(Buffer.from(text));
		}
		expect(Object.isFrozen(ENTWURF_DELIVERY_RESULT_CLAUSES)).toBe(true);
	});

	it("[QK:GUIDANCE-SLOTTED-REJECT-HINTS-ORIGINAL] the record-less-socket hint's text on either side of its slot is the exact C0 segment text of 94d0594, and rejoined around the slot it is the C0 template", () => {
		expect(originalSlottedRejectHints.sourceSha).toBe("94d0594182cbd9cf0a5c90f4d299cda40d870b8f");
		expect(Object.keys(originalSlottedRejectHints.sourceBlobSha256)).toEqual(["entwurf-v2-surface.ts"]);
		expect(originalSlottedRejectHints.c0Item).toBe("pi-extensions/lib/entwurf-v2-surface.ts:116:7192");
		expect(originalSlottedRejectHints.slot).toBe("FRESH_CUT_PRESCRIPTION");
		const slotted: Readonly<Record<string, Readonly<Record<string, string>>>> = ENTWURF_SLOTTED_REJECT_HINTS;
		expect(Object.keys(slotted)).toEqual(Object.keys(originalSlottedRejectHints.segments));
		for (const [reason, segments] of Object.entries(originalSlottedRejectHints.segments)) {
			expect(Object.keys(slotted[reason])).toEqual(Object.keys(segments));
			for (const [key, text] of Object.entries(segments)) {
				expect(Buffer.from(slotted[reason][key])).toEqual(Buffer.from(text));
			}
			expect(Object.isFrozen(slotted[reason])).toBe(true);
		}
		const h = ENTWURF_SLOTTED_REJECT_HINTS["record-less-socket"];
		const rejoined = `${h.beforeFreshCutPrescription}\${${originalSlottedRejectHints.slot}}${h.afterFreshCutPrescription}`;
		expect(Buffer.from(rejoined)).toEqual(Buffer.from(originalSlottedRejectHints.template));
		expect(Object.isFrozen(ENTWURF_SLOTTED_REJECT_HINTS)).toBe(true);
	});

	it("[QK:GUIDANCE-READER-LEAF-IMPORTS] the reader is a node:fs-only leaf in every static and dynamic import form, so the launch compositions that read it gain no entwurf/mux dependency", () => {
		const src = fs.readFileSync(new URL("./agent-guidance.ts", import.meta.url), "utf8");
		const specifiers = [
			...src.matchAll(/^\s*(?:import|export)\s[^;]*?\sfrom\s+["']([^"']+)["']/gm),
			...src.matchAll(/^\s*import\s+["']([^"']+)["']/gm),
		].map((m) => m[1]);
		expect(specifiers).toEqual(["node:fs"]);
		expect(src).not.toMatch(/\bimport\s*\(|\brequire\s*\(/);
	});

	it("[QK:GUIDANCE-CURRENT-DECODED-BYTES] every current string is exact and only declared amendments differ from originals", () => {
		expect(original.sourceSha).toBe("94d0594182cbd9cf0a5c90f4d299cda40d870b8f");
		const { metadata, declaredKeys } = currentExpectations();
		const changed = new Set<string>();
		const allKeys = new Set<string>();
		for (const rail of ["mcp", "durable"] as const) {
			for (const tool of original[rail]) {
				const expected = metadata[rail].find((entry) => entry.name === tool.name)!;
				const actual = ENTWURF_TOOL_GUIDANCE[tool.name];
				const description = (actual.descriptions as Readonly<Record<string, string>>)[rail];
				allKeys.add(`tools.${tool.name}.descriptions.${rail}`);
				expect(Buffer.from(description)).toEqual(Buffer.from(expected.description));
				if (description !== tool.description) changed.add(`tools.${tool.name}.descriptions.${rail}`);
				for (const p of tool.parameters) {
					allKeys.add(`tools.${tool.name}.parameters.${p.field}`);
					const text = (actual.parameters as Readonly<Record<string, string>>)[p.field];
					expect(Buffer.from(text)).toEqual(
						Buffer.from(expected.parameters.find((entry) => entry.field === p.field)!.text),
					);
					if (text !== p.text) changed.add(`tools.${tool.name}.parameters.${p.field}`);
				}
			}
		}
		expect([...changed].sort()).toEqual([...declaredKeys].sort());
		expect(allKeys.size).toBe(34);
		expect(changed.size).toBe(13);
		expect([...allKeys].filter((key) => !changed.has(key))).toHaveLength(21);
	});

	it("[QK:GUIDANCE-RUNTIME-REVIEWED-FIELDS] actual tools/list matches reviewed descriptions with original full structures/schema/annotations and no metadata", async () => {
		const actual = await bootBridgeAndListTools();
		expect(actual).toEqual(currentExpectations().runtime);
		const serialized = JSON.stringify(actual);
		for (const metadata of Object.values(parseEntwurfGuidance(SOURCE)._about))
			expect(serialized).not.toContain(metadata);
	});

	it("[QK:GUIDANCE-DURABLE-REVIEWED-FIELDS] actual native contact has reviewed descriptions and original full schemas except declared description leaves", async () => {
		const { metadata } = currentExpectations();
		const contact = createPiDurableContact({ bridgeEntry: path.join(os.tmpdir(), "entwurf-guidance-no-attach.js") });
		for (const expected of metadata.durable) {
			const actual = contact.extension.tools.find((tool) => tool.name === expected.name);
			expect(actual?.description).toBe(expected.description);
			expect(actual?.parameters).toEqual(metadata.schemas[expected.name]);
		}
		expect(PI_DURABLE_TOOL_SCHEMAS).toEqual(metadata.schemas);
		await contact.close();
	});
});

describe("strict fixed-source guidance reader", () => {
	it("[QK:GUIDANCE-DUPLICATE-DECODED-KEYS] duplicate raw/nested/escaped object keys reject rather than silently accepting the last", () => {
		for (const source of [
			'{"revision":1,"revision":2}',
			'{"revision":1,"\\u0072evision":2}',
			'{"outer":[{"x":"first","x":"last"}]}',
			SOURCE.replace('"schemaVersion": 6', '"schemaVersion": 6, "schemaVersion": 6'),
		])
			expect(() => parseEntwurfGuidance(source)).toThrow(/duplicate object key/);
	});

	it("[QK:GUIDANCE-STRICT-SHAPE] malformed/unknown/missing data fail closed and values are never whitespace-normalized", () => {
		const invalidRevision = JSON.parse(SOURCE);
		invalidRevision.revision = 0;
		for (const source of [SOURCE + " trailing", JSON.stringify(invalidRevision)]) {
			expect(() => parseEntwurfGuidance(source)).toThrow();
		}
		for (const version of ["5", "7"]) {
			const source = SOURCE.replace('"schemaVersion": 6', `"schemaVersion": ${version}`);
			expect(source).not.toBe(SOURCE);
			expect(() => parseEntwurfGuidance(source)).toThrow(/unsupported schemaVersion/);
		}
		const noHints = JSON.parse(SOURCE);
		delete noHints.rejectHints;
		const missingHint = JSON.parse(SOURCE);
		delete missingHint.rejectHints["native-push-paused"];
		const unknownHint = JSON.parse(SOURCE);
		unknownHint.rejectHints["record-less-socket"] = "slot-bearing text stays code-owned";
		for (const data of [noHints, missingHint, unknownHint])
			expect(() => parseEntwurfGuidance(JSON.stringify(data))).toThrow(/keys must be exactly/);
		const emptyHint = JSON.parse(SOURCE);
		emptyHint.rejectHints["native-push-paused"] = "";
		expect(() => parseEntwurfGuidance(JSON.stringify(emptyHint))).toThrow(/non-empty string/);
		const arrayHints = JSON.parse(SOURCE);
		arrayHints.rejectHints = Object.values(arrayHints.rejectHints);
		expect(() => parseEntwurfGuidance(JSON.stringify(arrayHints))).toThrow(/expected an object/);
		const noResumeHints = JSON.parse(SOURCE);
		delete noResumeHints.resumeRejectHints;
		const missingResumeHint = JSON.parse(SOURCE);
		delete missingResumeHint.resumeRejectHints["launch-refused"];
		const unknownResumeHint = JSON.parse(SOURCE);
		unknownResumeHint.resumeRejectHints["acp-model-not-curated"] = "the shared ACP hint stays code-owned";
		for (const data of [noResumeHints, missingResumeHint, unknownResumeHint])
			expect(() => parseEntwurfGuidance(JSON.stringify(data))).toThrow(/keys must be exactly/);
		const emptyResumeHint = JSON.parse(SOURCE);
		emptyResumeHint.resumeRejectHints["launch-refused"] = "";
		expect(() => parseEntwurfGuidance(JSON.stringify(emptyResumeHint))).toThrow(/non-empty string/);
		const arrayResumeHints = JSON.parse(SOURCE);
		arrayResumeHints.resumeRejectHints = Object.values(arrayResumeHints.resumeRejectHints);
		expect(() => parseEntwurfGuidance(JSON.stringify(arrayResumeHints))).toThrow(/expected an object/);
		for (const family of ["freshLaunchRejectHints", "resumeLaunchRejectHints"] as const) {
			const noFamily = JSON.parse(SOURCE);
			delete noFamily[family];
			const missingLaunchHint = JSON.parse(SOURCE);
			delete missingLaunchHint[family]["runtime-missing"];
			const unknownLaunchHint = JSON.parse(SOURCE);
			unknownLaunchHint[family]["task-too-long"] = "slot-bearing text stays code-owned";
			for (const data of [noFamily, missingLaunchHint, unknownLaunchHint])
				expect(() => parseEntwurfGuidance(JSON.stringify(data))).toThrow(/keys must be exactly/);
			const emptyLaunchHint = JSON.parse(SOURCE);
			emptyLaunchHint[family]["runtime-missing"] = "";
			expect(() => parseEntwurfGuidance(JSON.stringify(emptyLaunchHint))).toThrow(/non-empty string/);
		}
		const noClauses = JSON.parse(SOURCE);
		delete noClauses.deliveryResultClauses;
		const missingClause = JSON.parse(SOURCE);
		delete missingClause.deliveryResultClauses["dirty-lock"];
		const unknownClause = JSON.parse(SOURCE);
		unknownClause.deliveryResultClauses["record-less-socket"] = "slot-bearing text stays code-owned";
		for (const data of [noClauses, missingClause, unknownClause])
			expect(() => parseEntwurfGuidance(JSON.stringify(data))).toThrow(/keys must be exactly/);
		const emptyClause = JSON.parse(SOURCE);
		emptyClause.deliveryResultClauses["dirty-lock"] = "";
		expect(() => parseEntwurfGuidance(JSON.stringify(emptyClause))).toThrow(/non-empty string/);
		const noSlotted = JSON.parse(SOURCE);
		delete noSlotted.slottedRejectHints;
		const missingSlottedReason = JSON.parse(SOURCE);
		delete missingSlottedReason.slottedRejectHints["record-less-socket"];
		const extraSlottedReason = JSON.parse(SOURCE);
		extraSlottedReason.slottedRejectHints["model-invalid"] = "slot-bearing text stays code-owned";
		const missingSegment = JSON.parse(SOURCE);
		delete missingSegment.slottedRejectHints["record-less-socket"].afterFreshCutPrescription;
		const thirdSegment = JSON.parse(SOURCE);
		thirdSegment.slottedRejectHints["record-less-socket"].betweenFreshCutPrescription = "undeclared";
		for (const data of [noSlotted, missingSlottedReason, extraSlottedReason, missingSegment, thirdSegment])
			expect(() => parseEntwurfGuidance(JSON.stringify(data))).toThrow(/keys must be exactly/);
		const emptySegment = JSON.parse(SOURCE);
		emptySegment.slottedRejectHints["record-less-socket"].beforeFreshCutPrescription = "";
		expect(() => parseEntwurfGuidance(JSON.stringify(emptySegment))).toThrow(/non-empty string/);
		const stringSlotted = JSON.parse(SOURCE);
		stringSlotted.slottedRejectHints["record-less-socket"] = "a joined string with the slot spelled inside";
		expect(() => parseEntwurfGuidance(JSON.stringify(stringSlotted))).toThrow(/expected an object/);
		const missing = JSON.parse(SOURCE);
		delete missing.tools.entwurf_v2.parameters.mode;
		expect(() => parseEntwurfGuidance(JSON.stringify(missing))).toThrow(/keys must be exactly/);
		const unknown = JSON.parse(SOURCE);
		unknown.tools.entwurf_v2.parameters.override = "not allowed";
		expect(() => parseEntwurfGuidance(JSON.stringify(unknown))).toThrow(/keys must be exactly/);
		const exact = JSON.parse(SOURCE);
		exact.tools.entwurf_v2.parameters.message = '  x\n\t"{,}:" \\ unicode → 한글  ';
		expect(parseEntwurfGuidance(JSON.stringify(exact)).tools.entwurf_v2.parameters.message).toBe(
			exact.tools.entwurf_v2.parameters.message,
		);
		expect(Object.isFrozen(ENTWURF_TOOL_GUIDANCE.entwurf_v2.parameters)).toBe(true);
	});

	it("[QK:GUIDANCE-INDEPENDENT-REVISION] metadata/history edits do not require a payload revision or mirror package release versions", () => {
		const changed = JSON.parse(SOURCE);
		changed.history.unshift({ ...changed.history[0], change: "History-only clarification" });
		expect(parseEntwurfGuidance(JSON.stringify(changed)).revision).toBe(ENTWURF_GUIDANCE_VERSION.revision);
		expect(ENTWURF_GUIDANCE_VERSION.schemaVersion).toBe(6);
	});

	it("[QK:GUIDANCE-FIXED-MODULE-ROOT] cwd/HOME/env decoys cannot replace the module's packaged source, whose loaded payload is immutable", () => {
		const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "entwurf-guidance-root-"));
		try {
			const lib = path.join(fixture, "package/pi-extensions/lib");
			const home = path.join(fixture, "home");
			fs.mkdirSync(lib, { recursive: true });
			fs.mkdirSync(home);
			const module = path.join(lib, "agent-guidance.ts");
			const json = path.join(fixture, "package/ENTWURF.json");
			fs.copyFileSync(new URL("./agent-guidance.ts", import.meta.url), module);
			fs.writeFileSync(json, SOURCE);
			fs.writeFileSync(path.join(home, "ENTWURF.json"), "not JSON");
			const script = `const m = await import(${JSON.stringify(pathToFileURL(module).href)}); console.log(JSON.stringify(m.ENTWURF_TOOL_GUIDANCE));`;
			const child = spawnSync(process.execPath, ["--input-type=module", "-e", script], {
				cwd: home,
				env: { HOME: home, ENTWURF_GUIDANCE_PATH: path.join(home, "ENTWURF.json"), TMPDIR: "/tmp" },
				encoding: "utf8",
				timeout: 10_000,
			});
			expect(child.status, child.stderr).toBe(0);
			expect(JSON.parse(child.stdout)).toEqual(ENTWURF_TOOL_GUIDANCE);
			fs.unlinkSync(json);
			const missing = spawnSync(process.execPath, ["--input-type=module", "-e", script], {
				cwd: home,
				env: { HOME: home },
				encoding: "utf8",
				timeout: 10_000,
			});
			expect(missing.status).not.toBe(0);
			expect(missing.stderr).toContain("ENOENT");
		} finally {
			fs.rmSync(fixture, { recursive: true, force: true });
		}
	});
});
