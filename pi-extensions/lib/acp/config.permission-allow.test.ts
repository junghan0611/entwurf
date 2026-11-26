/**
 * #176 — an ACP permission allow rule the bundled Claude runtime would skip fails to load.
 *
 * Oracle: the raw-acp rail0 receipt of 2026-11-26 against claude-agent-acp 0.112.0 (claude-agent-sdk
 * 0.3.331, Claude Code 2.1.331), where `mcp__*` was skipped with "Wildcard tool name \"mcp__*\" is not
 * supported in allow rules" written into the agent's answer; and the runtime's allow verdicts, from its
 * own functions (`Mk`, `a4`, `Hc`, `d9` and `lx`'s allow branches) cut out of sdk.mjs and run on each row
 * (`[측정 2026-11-26]` ~/.local/share/entwurf-lab/176/v2/allow-oracle.log, 34 of 34 agreeing; first run by
 * the #176 reviewer). The verdicts below are copied as literals, not derived from config.ts.
 */

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, expect, it } from "vitest";
import { readProviderSettingsFile, validatePermissionAllow } from "./config.ts";
import { DEFAULT_CLAUDE_PERMISSION_ALLOW } from "./tool-surface.ts";

/** Skipped by the runtime as "Wildcard tool name … is not supported in allow rules". */
const WILDCARD_SKIPPED = [
	"mcp__*",
	"mcp__*__get_x",
	"mcp__entwurf*__*",
	"mcp__*bridge",
	"mcp____*",
	"Read*",
	"*",
	" mcp__entwurf-bridge__*",
	"Read\\(*\\)",
	"(*)",
];
/** Skipped by the runtime as "MCP rules do not support patterns in parentheses". */
const MCP_PATTERN_SKIPPED = [
	"mcp__bridge(*)",
	"mcp__bridge__get(*)",
	"mcp__entwurf-bridge__*(x)",
	"mcp__*__get(x)",
	"mcp__x__y\\\\(a)",
	"mcp__x(y)(z)",
];
/** Accepted by the runtime. */
const ACCEPTED_BY_CLAUDE = [
	"mcp__puppeteer__*",
	"mcp__github__get_*",
	"mcp__entwurf-bridge__*",
	"mcp__entwurf-bridge",
	"Read(*)",
	"Bash(*)",
	"Bash(npm *)",
	"Edit(*)",
	"Write(*)",
	"mcp__bridge__get\\(x\\)",
	"mcp__bridge__get*\\(x\\)",
	"Read(a(b))",
];
/** Empty, malformed or empty-parenthesis rules: the runtime refuses them for other reasons; not judged here. */
const LEFT_TO_RUNTIME = ["", "()", "mcp__bridge__get(", "mcp__bridge__get()", "Read*()", "mcp__x__y(a)b"];

const root = mkdtempSync(join(tmpdir(), "acp-permission-allow-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

it("[QK:ACP-PERMISSION-ALLOW-NAMES-SERVER] a wildcard outside the tool position of a literal MCP server is refused by name; a named server with a tool glob passes", () => {
	for (const rule of WILDCARD_SKIPPED) {
		expect(() => validatePermissionAllow(["Read(*)", rule], "/x/settings.json"), rule).toThrow(
			`permissionAllow[1] ${JSON.stringify(rule)} puts a wildcard outside the tool position`,
		);
	}
	expect(() => validatePermissionAllow(ACCEPTED_BY_CLAUDE, "/x/settings.json")).not.toThrow();
});

it("[QK:ACP-PERMISSION-ALLOW-MCP-NO-PATTERN] an MCP rule with a (pattern) is refused by name, naming the server-wide rule", () => {
	for (const rule of MCP_PATTERN_SKIPPED) {
		expect(() => validatePermissionAllow([rule], "/x/settings.json"), rule).toThrow(
			`permissionAllow[0] ${JSON.stringify(rule)} gives an MCP rule a (pattern)`,
		);
	}
	expect(() => validatePermissionAllow(["mcp__bridge__get(*)"], "/x/settings.json")).toThrow('"mcp__bridge__*"');
	// A wildcard server is not offered back as the fix: the example names a server.
	expect(() => validatePermissionAllow(["mcp__*__get(x)"], "/x/settings.json")).toThrow(
		'for example "mcp__entwurf-bridge__*" for every tool of one named server',
	);
});

it("[QK:ACP-PERMISSION-ALLOW-RUNTIME-PARSE] parentheses are read as the runtime reads them: an escaped one is part of the name, and a malformed or empty rule is left to the runtime", () => {
	for (const rule of LEFT_TO_RUNTIME)
		expect(() => validatePermissionAllow([rule], "/x/settings.json"), rule).not.toThrow();
	expect(() => validatePermissionAllow(["mcp__bridge__get\\(x\\)"], "/x/settings.json")).not.toThrow();
	expect(() => validatePermissionAllow(["Read\\(*\\)"], "/x/settings.json")).toThrow(
		"puts a wildcard outside the tool position",
	);
	expect(() => validatePermissionAllow(["mcp__x__y\\\\(a)"], "/x/settings.json")).toThrow(
		"gives an MCP rule a (pattern)",
	);
});

it("[QK:ACP-PERMISSION-ALLOW-DEFAULT-NAMED] the default allow list names the entwurf-bridge server and passes the check", () => {
	expect(DEFAULT_CLAUDE_PERMISSION_ALLOW).toContain("mcp__entwurf-bridge__*");
	expect(DEFAULT_CLAUDE_PERMISSION_ALLOW).not.toContain("mcp__*");
	expect(() => validatePermissionAllow(DEFAULT_CLAUDE_PERMISSION_ALLOW, "default")).not.toThrow();
});

it("[QK:ACP-PERMISSION-ALLOW-READ-REFUSES] a settings file carrying mcp__* fails to load, naming the file and the fix", () => {
	const file = join(root, "settings.json");
	writeFileSync(file, JSON.stringify({ entwurfProvider: { permissionAllow: ["Read(*)", "mcp__*"] } }));
	expect(() => readProviderSettingsFile(file)).toThrow(`${file}: invalid entwurfProvider settings: permissionAllow[1]`);
	expect(() => readProviderSettingsFile(file)).toThrow('"mcp__entwurf-bridge__*"');
	writeFileSync(file, JSON.stringify({ entwurfProvider: { permissionAllow: ["Read(*)", "mcp__entwurf-bridge__*"] } }));
	expect(readProviderSettingsFile(file).settings.permissionAllow).toEqual(["Read(*)", "mcp__entwurf-bridge__*"]);
});
