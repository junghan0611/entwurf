/**
 * #160 S3 step 7: the pure leaf of the OpenClaw fresh candidate. Literal oracles only. Composition
 * wiring (FRESH_CALL_BACKENDS, framing, mux launch, surfaces, admission parity, LIVE smoke) is the
 * flip bundle and S4, and (a)–(d) stay unmeasured — the preflight refuses on (a) by name.
 */
import { describe, expect, it } from "vitest";
import { parseOpenclawCitizensDeclaration } from "./openclaw-citizens.ts";
import {
	openclawFreshKey,
	openclawFreshPreflight,
	openclawSessionsCreateParams,
	openclawTuiLaunch,
	parseOpenclawManagedArgv,
} from "./openclaw-fresh.ts";

const NONCE = "mux-fresh-call-0123456789abcdef01234567";
const CALLER = "20261015T085719-9fc008";
const BOOT = JSON.stringify({ v: 1, target: CALLER, nonce: NONCE, task: "do x" });
const ARGV = ["--scope", "lab", "--model", "openai/gpt-6-luna", "--width", "agent-policy", "--entwurf-bootstrap", BOOT];

const DECL = parseOpenclawCitizensDeclaration(
	JSON.stringify({
		version: 1,
		gateways: [{ scope: "lab", url: "ws://127.0.0.1:18811" }],
		allow: [],
		freshKeyPrefix: { scope: "lab", agentId: "main", prefix: "agent:main:entwurf-" },
	}),
);

describe("parseOpenclawManagedArgv", () => {
	it("reads the one fixed shape, model split at the first /", () => {
		expect(parseOpenclawManagedArgv(ARGV)).toEqual({
			scope: "lab",
			provider: "openai",
			model: "gpt-6-luna",
			width: "agent-policy",
			bootstrap: { target: CALLER, nonce: NONCE, task: "do x" },
		});
		const reordered = [...ARGV.slice(6), ...ARGV.slice(0, 6)];
		expect(parseOpenclawManagedArgv(reordered).scope).toBe("lab");
	});

	const swap = (flag: string, value: string) => {
		const a = [...ARGV];
		a[a.indexOf(flag) + 1] = value;
		return a;
	};
	it.each([
		["width omitted", ARGV.slice(0, 4).concat(ARGV.slice(6))],
		["extra token", [...ARGV, "--yolo"]],
		["duplicate flag", ["--scope", "lab", ...ARGV.slice(2, 6), "--scope", "lab"]],
		["unknown flag", ["--cmd", "sh", ...ARGV.slice(2)]],
		["unknown width", swap("--width", "task-wide")],
		["model without provider", swap("--model", "gpt-6-luna")],
		["bad scope", swap("--scope", "a:b")],
		[
			"bootstrap extra key",
			swap("--entwurf-bootstrap", JSON.stringify({ v: 1, target: CALLER, nonce: NONCE, task: "t", cmd: "x" })),
		],
		[
			"bootstrap bad nonce",
			swap("--entwurf-bootstrap", JSON.stringify({ v: 1, target: CALLER, nonce: "n", task: "t" })),
		],
		[
			"bootstrap bad target",
			swap("--entwurf-bootstrap", JSON.stringify({ v: 1, target: "x", nonce: NONCE, task: "t" })),
		],
		[
			"bootstrap oversize task",
			swap("--entwurf-bootstrap", JSON.stringify({ v: 1, target: CALLER, nonce: NONCE, task: "x".repeat(16001) })),
		],
	])("refuses %s", (_n, argv) => {
		expect(() => parseOpenclawManagedArgv(argv)).toThrow();
	});
});

describe("fresh key, create params, TUI argv", () => {
	it("derives a new key under the declared prefix", () => {
		expect(openclawFreshKey(DECL, "lab", NONCE)).toBe("agent:main:entwurf-0123456789abcdef01234567");
		expect(() => openclawFreshKey(DECL, "oracle", NONCE)).toThrow(/openclaw-fresh-prefix-not-declared/);
	});
	it("create carries key, a nonce label and the explicit model", () => {
		expect(openclawSessionsCreateParams("agent:main:entwurf-01", NONCE, "openai", "gpt-6-luna")).toEqual({
			key: "agent:main:entwurf-01",
			label: "entwurf-0123456789abcdef01234567",
			model: "openai/gpt-6-luna",
		});
	});
	it("the TUI opens exactly that key, the framing one argv word, the declared config its only env", () => {
		expect(
			openclawTuiLaunch("openclaw", "agent:main:entwurf-01", "line1\nline2", { configPath: "/lab/oc.json" }),
		).toEqual({
			argv: ["openclaw", "tui", "--session", "agent:main:entwurf-01", "--message", "line1\nline2"],
			env: { OPENCLAW_CONFIG_PATH: "/lab/oc.json" },
		});
		expect(openclawTuiLaunch("openclaw", "agent:main:entwurf-01", "m", {}).env).toEqual({});
	});
});

describe("openclawFreshPreflight", () => {
	const ok = {
		firstInput: "x",
		decl: DECL,
		scope: "lab",
		gatewayReachable: true,
		keyAbsent: true,
		pluginLoaded: true,
		tuiBinding: "proven" as const,
		visibleIdentity: "present" as const,
	};
	it("passes only when every fact holds", () => {
		expect(openclawFreshPreflight(ok)).toBeNull();
	});
	it.each([
		["first input", { firstInput: "x".repeat(16001) }, "openclaw-first-input-too-long"],
		["no declaration", { decl: null }, "openclaw-scope-not-declared"],
		["undeclared scope", { scope: "oracle" }, "openclaw-scope-not-declared"],
		[
			"no fresh prefix",
			{
				decl: parseOpenclawCitizensDeclaration(
					JSON.stringify({
						version: 1,
						gateways: [{ scope: "lab", url: "ws://127.0.0.1:18811" }],
						allow: [{ scope: "lab", agentId: "main", sessionKey: "agent:main:s1" }],
					}),
				),
			},
			"openclaw-fresh-prefix-not-declared",
		],
		["gateway", { gatewayReachable: false }, "openclaw-gateway-unreachable"],
		["key already exists (create would adopt)", { keyAbsent: false }, "openclaw-fresh-key-exists"],
		["plugin", { pluginLoaded: false }, "openclaw-plugin-not-loaded"],
		["TUI binding (D1) unproven", { tuiBinding: "unproven" as const }, "openclaw-tui-binding-unproven"],
		[
			"visible identity (a) unmeasured",
			{ visibleIdentity: "unmeasured" as const },
			"openclaw-visible-identity-unmeasured",
		],
	])("refuses %s by name", (_n, over, reason) => {
		expect(openclawFreshPreflight({ ...ok, ...over })).toBe(reason);
	});
});
