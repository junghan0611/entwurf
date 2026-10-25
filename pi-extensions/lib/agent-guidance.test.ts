/** #154 preservation oracles: expectations are verbatim C0 originals, never this JSON. */
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { bootBridgeAndListTools } from "../../test/helpers/fresh-call-fixtures.ts";
import { createPiDurableContact, PI_DURABLE_TOOL_SCHEMAS } from "../meta-bridge-pi-durable.ts";
import { ENTWURF_GUIDANCE_VERSION, ENTWURF_TOOL_GUIDANCE, parseEntwurfGuidance } from "./agent-guidance.ts";

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
const originalRuntime: unknown = JSON.parse(
	fs.readFileSync(new URL("./fixtures/agent-guidance/mcp-tools-before-94d0594.json", import.meta.url), "utf8"),
);

describe("root product guidance — independent preservation", () => {
	it("[QK:GUIDANCE-ORIGINAL-DECODED-BYTES] every extracted original string is byte-identical without trim/reflow/source normalization", () => {
		expect(original.sourceSha).toBe("94d0594182cbd9cf0a5c90f4d299cda40d870b8f");
		for (const rail of ["mcp", "durable"] as const) {
			for (const tool of original[rail]) {
				const actual = ENTWURF_TOOL_GUIDANCE[tool.name];
				const description = (actual.descriptions as Readonly<Record<string, string>>)[rail];
				expect(Buffer.from(description)).toEqual(Buffer.from(tool.description));
				for (const p of tool.parameters) {
					expect(Buffer.from((actual.parameters as Readonly<Record<string, string>>)[p.field])).toEqual(
						Buffer.from(p.text),
					);
				}
			}
		}
	});

	it("[QK:GUIDANCE-RUNTIME-ORIGINAL-FIELDS] actual tools/list preserves complete pre-extraction fields/schema/annotations and emits no metadata", async () => {
		const actual = await bootBridgeAndListTools();
		expect(actual).toEqual(originalRuntime);
		const serialized = JSON.stringify(actual);
		for (const metadata of Object.values(parseEntwurfGuidance(SOURCE)._about))
			expect(serialized).not.toContain(metadata);
	});

	it("[QK:GUIDANCE-DURABLE-ORIGINAL-FIELDS] actual native contact tool descriptions and complete schemas preserve their independent originals", async () => {
		const contact = createPiDurableContact({ bridgeEntry: path.join(os.tmpdir(), "entwurf-guidance-no-attach.js") });
		for (const expected of original.durable) {
			const actual = contact.extension.tools.find((tool) => tool.name === expected.name);
			expect(actual?.description).toBe(expected.description);
			expect(actual?.parameters).toEqual(original.schemas[expected.name]);
		}
		expect(PI_DURABLE_TOOL_SCHEMAS).toEqual(original.schemas);
		await contact.close();
	});
});

describe("strict fixed-source guidance reader", () => {
	it("[QK:GUIDANCE-DUPLICATE-DECODED-KEYS] duplicate raw/nested/escaped object keys reject rather than silently accepting the last", () => {
		for (const source of [
			'{"revision":1,"revision":2}',
			'{"revision":1,"\\u0072evision":2}',
			'{"outer":[{"x":"first","x":"last"}]}',
			SOURCE.replace('"schemaVersion": 1', '"schemaVersion": 1, "schemaVersion": 1'),
		])
			expect(() => parseEntwurfGuidance(source)).toThrow(/duplicate object key/);
	});

	it("[QK:GUIDANCE-STRICT-SHAPE] malformed/unknown/missing data fail closed and values are never whitespace-normalized", () => {
		for (const source of [
			SOURCE + " trailing",
			SOURCE.replace('"schemaVersion": 1', '"schemaVersion": 2'),
			SOURCE.replace('"revision": 1', '"revision": 0'),
		]) {
			expect(() => parseEntwurfGuidance(source)).toThrow();
		}
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
		expect(ENTWURF_GUIDANCE_VERSION.schemaVersion).toBe(1);
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
