/**
 * pi-durable-fresh-preflight (#129 W, L6) — the pre-mutation decision, beside the leaf.
 *
 * The four units are real files in a fixture package closure this file builds; the receive unit is
 * the compiled owner-join TEXT, read the way the bridge's emitted module carries it. The runtime
 * verdict is an input here (its own leaf has its own tests), so these cells only decide ordering and
 * the unit predicates. The bootstrap decoder's cap is read from its own module.
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { OMP_BOOTSTRAP_TASK_MAX_CHARS } from "../meta-bridge-omp.ts";
import {
	PI_DURABLE_FIRST_INPUT_MAX_CHARS,
	piDurableFreshPreflight,
	splitPiDurableModel,
} from "./pi-durable-fresh-preflight.ts";
import { type PiDurablePackageLayout, piDurableLayoutAt } from "./pi-durable-runtime.ts";

let root: string;
let layout: PiDurablePackageLayout;
beforeEach(() => {
	root = fs.mkdtempSync(path.join(os.tmpdir(), "pi-durable-preflight-"));
	layout = piDurableLayoutAt(root);
	for (const file of [layout.adapter, layout.bridgeEntry, layout.bootstrap]) {
		fs.mkdirSync(path.dirname(file), { recursive: true });
		fs.writeFileSync(file, "// unit\n");
	}
	fs.mkdirSync(path.dirname(layout.deliverability), { recursive: true });
	fs.writeFileSync(
		layout.deliverability,
		'export const SENDER_JOINED_RECEIVER_OWNER_KINDS = ["claude-code-hook", "pi-durable-host"];\n',
	);
});
afterEach(() => {
	fs.rmSync(root, { recursive: true, force: true });
});

const decide = (over: Partial<Parameters<typeof piDurableFreshPreflight>[0]> = {}) =>
	piDurableFreshPreflight({ model: "loopback/scripted", firstInput: "framing", layout, runtime: null, ...over });

describe("pi-durable fresh preflight", () => {
	it("[QK:PI-DURABLE-PREFLIGHT-MODEL-QUALIFIED] a model is <provider>/<model id> split at the FIRST slash; a model without either side is refused first", () => {
		expect(splitPiDurableModel("loopback/scripted")).toEqual({ provider: "loopback", model: "scripted" });
		expect(splitPiDurableModel("loopback/org/exact:v1")).toEqual({ provider: "loopback", model: "org/exact:v1" });
		for (const model of ["scripted", "/scripted", "loopback/"]) {
			expect(splitPiDurableModel(model), model).toBeNull();
			expect(decide({ model, runtime: "pi-durable-runtime-absent" }), model).toBe(
				"pi-durable-model-not-provider-qualified",
			);
		}
		expect(decide()).toBeNull();
	});

	it("[QK:PI-DURABLE-PREFLIGHT-FIRST-INPUT-CAP] the framed first input must fit the bootstrap payload cap, which is the decoder's own", () => {
		expect(PI_DURABLE_FIRST_INPUT_MAX_CHARS).toBe(OMP_BOOTSTRAP_TASK_MAX_CHARS);
		expect(decide({ firstInput: "x".repeat(PI_DURABLE_FIRST_INPUT_MAX_CHARS) })).toBeNull();
		expect(decide({ firstInput: "x".repeat(PI_DURABLE_FIRST_INPUT_MAX_CHARS + 1) })).toBe(
			"pi-durable-first-input-too-long",
		);
	});

	it("[QK:PI-DURABLE-PREFLIGHT-RUNTIME-FIRST] an incomplete package, then the runtime verdict, are answered before any unit — verbatim", () => {
		expect(decide({ layout: null })).toBe("pi-durable-package-incomplete");
		for (const reason of [
			"pi-durable-runtime-absent",
			"pi-durable-runtime-pin-drift",
			"pi-durable-runtime-modeldata-drift",
			"pi-durable-runtime-unverifiable",
		] as const) {
			fs.rmSync(layout.adapter);
			expect(decide({ runtime: reason }), reason).toBe(reason);
			fs.writeFileSync(layout.adapter, "// unit\n");
		}
	});

	it("[QK:PI-DURABLE-PREFLIGHT-FOUR-UNITS] each of the four units refuses under its OWN name, in repair order: birth, MCP hand, receive (the compiled owner join), visible identity", () => {
		fs.rmSync(layout.adapter);
		expect(decide()).toBe("pi-durable-birth-unit-missing");
		fs.writeFileSync(layout.adapter, "// unit\n");
		fs.rmSync(layout.bridgeEntry);
		expect(decide()).toBe("pi-durable-mcp-hand-missing");
		fs.writeFileSync(layout.bridgeEntry, "// unit\n");
		fs.writeFileSync(
			layout.deliverability,
			'export const SENDER_JOINED_RECEIVER_OWNER_KINDS = ["claude-code-hook"];\n',
		);
		expect(decide()).toBe("pi-durable-receive-unit-missing");
		fs.rmSync(layout.deliverability);
		expect(decide()).toBe("pi-durable-receive-unit-missing");
		fs.writeFileSync(layout.deliverability, 'export const SENDER_JOINED_RECEIVER_OWNER_KINDS = ["pi-durable-host"];\n');
		fs.rmSync(layout.bootstrap);
		expect(decide()).toBe("pi-durable-visible-identity-missing");
		fs.writeFileSync(layout.bootstrap, "// unit\n");
		expect(decide()).toBeNull();
	});

	it("the shipped closure of THIS checkout passes the unit half (built bridge required)", () => {
		const real = piDurableLayoutAt(path.resolve(import.meta.dirname, "..", ".."));
		expect(fs.existsSync(real.bridgeEntry), "run `pnpm run build-bridge` first").toBe(true);
		expect(
			piDurableFreshPreflight({ model: "loopback/scripted", firstInput: "f", layout: real, runtime: null }),
		).toBeNull();
	});
});
