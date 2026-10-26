/** #154 current oracles: frozen C0 objects + independently reviewed literal amendments, never product output. */
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { bootBridgeAndListTools } from "../../test/helpers/fresh-call-fixtures.ts";
import { createPiDurableContact, PI_DURABLE_TOOL_SCHEMAS } from "../meta-bridge-pi-durable.ts";
import {
	ENTWURF_GUIDANCE_VERSION,
	ENTWURF_REJECT_HINTS,
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
	for (const layer of [reviewedR2, reviewedR3]) {
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
		expect(ENTWURF_GUIDANCE_VERSION.revision).toBe(originalRejectHints.introducedRevision);
	});

	it("[QK:GUIDANCE-REJECT-HINTS-ORIGINAL] every static reject hint is the exact pre-extraction C0 string for exactly the declared reasons", () => {
		expect(originalRejectHints.sourceSha).toBe("94d0594182cbd9cf0a5c90f4d299cda40d870b8f");
		expect(Object.keys(ENTWURF_REJECT_HINTS).sort()).toEqual(Object.keys(originalRejectHints.hints).sort());
		for (const [reason, text] of Object.entries(originalRejectHints.hints)) {
			const actual = (ENTWURF_REJECT_HINTS as Readonly<Record<string, string>>)[reason];
			expect(Buffer.from(actual)).toEqual(Buffer.from(text));
		}
		expect(Object.isFrozen(ENTWURF_REJECT_HINTS)).toBe(true);
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
			SOURCE.replace('"schemaVersion": 2', '"schemaVersion": 2, "schemaVersion": 2'),
		])
			expect(() => parseEntwurfGuidance(source)).toThrow(/duplicate object key/);
	});

	it("[QK:GUIDANCE-STRICT-SHAPE] malformed/unknown/missing data fail closed and values are never whitespace-normalized", () => {
		const invalidRevision = JSON.parse(SOURCE);
		invalidRevision.revision = 0;
		for (const source of [SOURCE + " trailing", JSON.stringify(invalidRevision)]) {
			expect(() => parseEntwurfGuidance(source)).toThrow();
		}
		for (const version of ["1", "3"]) {
			const source = SOURCE.replace('"schemaVersion": 2', `"schemaVersion": ${version}`);
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
		expect(ENTWURF_GUIDANCE_VERSION.schemaVersion).toBe(2);
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
