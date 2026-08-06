/**
 * fresh-call provider-conversion contract — Cell 2 of the vitest pilot (issue #62).
 *
 * The issue's open question, closed by observation: is the schema a host sees on
 * tools/list the same schema that rides in the ACTUAL request body after provider
 * conversion? The original defect reproduced on the former; this cell proves the
 * latter on the pi lane.
 *
 * Method (pi-mono's own pattern for this defect class): stand up a local HTTP
 * server, point pi-ai's REAL anthropic-messages conversion at it via
 * `model.baseUrl`, prompt once with the REAL captured `entwurf_fresh_call` tool
 * definition, and read the tool schema out of the request body that was actually
 * sent. Hermetic: fake key, loopback only, no real account, no model turn — the
 * server answers 400 and the turn is expected to fail; the request BYTES are the
 * subject.
 */

import * as http from "node:http";
import type { AddressInfo } from "node:net";
import { stream } from "@earendil-works/pi-ai/api/anthropic-messages";
import { RRegex } from "rregex";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { capturePiToolDefinitions, type PiToolDefinition, requireTool } from "./helpers/fresh-call-fixtures.ts";

interface CapturedBody {
	tools?: Array<{
		name?: string;
		description?: string;
		input_schema?: {
			properties?: Record<string, Record<string, unknown>>;
			required?: string[];
		};
	}>;
}

let server: http.Server;
let baseUrl: string;
let captured: CapturedBody | null = null;
let freshDef: PiToolDefinition;

beforeAll(async () => {
	freshDef = requireTool(await capturePiToolDefinitions(), "entwurf_fresh_call");

	server = http.createServer((req, res) => {
		let body = "";
		req.on("data", (d: Buffer) => {
			body += d.toString();
		});
		req.on("end", () => {
			try {
				captured = JSON.parse(body) as CapturedBody;
			} catch {
				captured = null;
			}
			res.writeHead(400, { "content-type": "application/json" });
			res.end(JSON.stringify({ type: "error", error: { type: "invalid_request_error", message: "capture-only" } }));
		});
	});
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

	// Drive the REAL conversion path. The turn itself is expected to error (the
	// capture server refuses everything); the request body is the observation.
	const events = stream(
		{
			id: "claude-sonnet-5",
			name: "capture",
			api: "anthropic-messages",
			provider: "anthropic",
			baseUrl,
			reasoning: false,
			input: ["text"],
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
			contextWindow: 200000,
			maxTokens: 8192,
		},
		{
			messages: [{ role: "user", content: "ping", timestamp: Date.now() }],
			tools: [{ name: freshDef.name, description: freshDef.description, parameters: freshDef.parameters as never }],
		},
		{ apiKey: "entwurf-capture-not-a-key", maxRetries: 0 },
	);
	for await (const _event of events) {
		// drain; the final event carries the (expected) error
	}
});

afterAll(async () => {
	await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("provider conversion — the schema that actually rides the wire", () => {
	it("[QK:FRESHCALL-MODEL-PATTERN-PROVIDER-VALID] the model pattern in the REAL anthropic-messages request body is the registered TypeBox pattern verbatim and compiles under a Rust-regex-family engine", () => {
		expect(captured, "the conversion path must have sent a request body").not.toBeNull();
		const tool = captured?.tools?.find((t) => t.name === "entwurf_fresh_call");
		expect(tool, "the fresh-call tool definition must ride the request body").toBeDefined();
		const model = tool?.input_schema?.properties?.model;
		expect(model, "input_schema.properties.model must survive conversion").toBeDefined();
		expect(tool?.input_schema?.required).toContain("model");

		const registered = freshDef.parameters.properties?.model?.pattern;
		expect(typeof registered).toBe("string");
		expect(model?.pattern, "conversion must not rewrite the pattern").toBe(registered);

		expect(() => new RRegex(model?.pattern as string), `wire pattern ${JSON.stringify(model?.pattern)}`).not.toThrow();
	});

	it("description and the other declared bounds survive conversion untouched", () => {
		const tool = captured?.tools?.find((t) => t.name === "entwurf_fresh_call");
		expect(tool?.description).toBe(freshDef.description);
		const model = tool?.input_schema?.properties?.model;
		expect(model?.minLength).toBe(1);
		expect(model?.maxLength).toBe(200);
		expect(Object.keys(tool?.input_schema?.properties ?? {}).sort()).toEqual(["backend", "model", "task"]);
	});
});
