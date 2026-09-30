/**
 * entwurf-control — the born pi citizen hands its verbs to Pi's built-in MCP (#125).
 *
 * The production subject is the REAL extension (`entwurf-control.ts`) loaded by Pi's REAL public
 * loader and driven through its own session_start: record birth, the control socket and the
 * `registerMcpServer` call are the shipped code, and the registration lands in Pi's own runtime
 * registry. Only the session context is a stub (no model, no network, no child process of Pi's).
 *
 * The independent oracle is the RECORD FILE the store holds for that native session, read by the
 * harness from disk — not anything the extension reports about itself.
 *
 * Process isolation is load-bearing: the extension derives its control-socket dir from HOME at module
 * load and births into PI_CODING_AGENT_DIR, so it runs in a child with a throwaway HOME / agent dir and
 * NO inherited identity carrier. Running it in this worker would birth into the invoking operator's
 * store.
 *
 * Requires the compiled bridge (`pnpm run build-bridge`): the registration refuses by name when the
 * compiled entry is missing, and that refusal would be the red here — there is no TS fallback to hide it.
 *
 * What this does NOT prove: that Pi's built-in MCP spawns the child with this env, the names a model
 * sees, or the new-session transition. `check-pi-mcp-bridge` observes those end to end.
 */
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..");
const HARNESS = path.join(REPO, "test", "helpers", "entwurf-control-birth-harness.mjs");
const EXTENSION = path.join(HERE, "entwurf-control.ts");

interface Registration {
	name: string;
	config: {
		command?: string;
		args?: string[];
		env?: Record<string, string>;
		exposure?: string;
		toolExposure?: Record<string, string>;
		cwd?: string;
	};
}
interface HarnessOut {
	afterFactory: Registration[];
	afterStart: Registration[];
	afterShutdown: Registration[];
	envAfterStart: { PI_SESSION_ID: string | null; PI_AGENT_ID: string | null };
	records: Array<{ gardenId: string; backend: string }>;
	order: Array<{ what: string; envAtRegister?: string | null }>;
	errors: string[];
	execPath: string;
}

const roots: string[] = [];
function runHarness(ui: "ok" | "throws"): HarnessOut {
	// Short on purpose: the control socket lives at <HOME>/.pi/entwurf-control/<gardenId>.sock and a
	// unix socket path has a ~107-byte ceiling (a long TMPDIR plus a long prefix hit it: listen EINVAL).
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "ec-"));
	roots.push(root);
	const home = path.join(root, "h");
	const cwd = path.join(root, "c");
	fs.mkdirSync(cwd, { recursive: true });
	const result = spawnSync(process.execPath, [HARNESS, EXTENSION, cwd, ui], {
		cwd: REPO,
		encoding: "utf8",
		timeout: 20_000,
		env: { PATH: process.env.PATH, HOME: home, PI_CODING_AGENT_DIR: path.join(home, ".pi", "agent") },
	});
	if (result.status !== 0) throw new Error(`harness exited ${result.status}: ${result.stdout}\n${result.stderr}`);
	return JSON.parse(result.stdout.trim().split("\n").at(-1) as string) as HarnessOut;
}

let ok: HarnessOut;
let throwing: HarnessOut;
beforeAll(() => {
	ok = runHarness("ok");
	throwing = runHarness("throws");
});
afterAll(() => {
	for (const root of roots) fs.rmSync(root, { recursive: true, force: true });
});

describe("entwurf-control registers the compiled bridge with the born identity", () => {
	it("[QK:PI-MCP-REGISTER-AFTER-BIRTH] nothing is registered at load; session_start registers exactly one entwurf-bridge server whose explicit PI_SESSION_ID is the gardenId of the record the store holds for this session", () => {
		expect(ok.errors).toEqual([]);
		expect(ok.afterFactory).toEqual([]);
		expect(ok.records).toHaveLength(1);
		const [record] = ok.records;
		expect(record?.backend).toBe("pi");
		expect(ok.afterStart.map((s) => s.name)).toEqual(["entwurf-bridge"]);
		expect(ok.afterStart[0]?.config.env?.PI_SESSION_ID).toBe(record?.gardenId);
		expect(ok.afterStart[0]?.config.env?.PI_AGENT_ID).toBe("gate/entwurf-control-test");
		// The ambient carrier agrees — it is what this pi process's own children read.
		expect(ok.envAfterStart.PI_SESSION_ID).toBe(record?.gardenId);
	});

	it("[QK:PI-MCP-IDENTITY-BEFORE-UI] identity is carried before any status rendering — with a UI that throws, the handler fails loud and the carrier and the registration are already in place", () => {
		// Ordering on the healthy run: the registry sees the registration before the status line,
		// and the ambient carrier is already the born id at that moment.
		const registerAt = ok.order.findIndex((e) => e.what === "register");
		const statusAt = ok.order.findIndex((e) => e.what === "status");
		expect(registerAt).toBeGreaterThanOrEqual(0);
		expect(statusAt).toBeGreaterThan(registerAt);
		expect(ok.order[registerAt]?.envAtRegister).toBe(ok.records[0]?.gardenId);
		// The throwing UI: the failure surfaces (no swallow) and identity survived it.
		expect(throwing.errors.some((e) => e.includes("theme unavailable"))).toBe(true);
		expect(throwing.records).toHaveLength(1);
		expect(throwing.afterStart[0]?.config.env?.PI_SESSION_ID).toBe(throwing.records[0]?.gardenId);
		expect(throwing.envAfterStart.PI_SESSION_ID).toBe(throwing.records[0]?.gardenId);
	});

	it("[QK:PI-MCP-EXPOSURE] the server runs the compiled bridge with pi's own node, declares the verbs directly, hides exactly the two host-irrelevant tools, and pins no cwd so Pi starts it in the session's own directory", () => {
		const config = ok.afterStart[0]?.config;
		expect(config?.command).toBe(ok.execPath);
		expect(config?.args).toHaveLength(1);
		expect(config?.args?.[0]).toBe(
			path.join(REPO, "mcp", "entwurf-bridge", "dist", "mcp", "entwurf-bridge", "src", "index.js"),
		);
		expect(config?.exposure).toBe("direct");
		expect(config?.toolExposure).toEqual({ entwurf_inbox_read: "hidden", entwurf_register_native: "hidden" });
		expect(config && "cwd" in config).toBe(false);
	});

	it("shutdown leaves the registration to Pi — the built-in MCP owns the child's lifecycle, so there is no unregister to race it", () => {
		expect(ok.afterShutdown.map((s) => s.name)).toEqual(["entwurf-bridge"]);
		expect(ok.errors.filter((e) => e.startsWith("shutdown:"))).toEqual([]);
	});
});
