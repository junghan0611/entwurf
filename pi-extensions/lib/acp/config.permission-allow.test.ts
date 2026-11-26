/**
 * #176 — an ACP permission allow rule the bundled Claude runtime would skip fails to load.
 *
 * Oracle: the raw-acp rail0 receipt of 2026-11-26 against claude-agent-acp 0.112.0 (claude-agent-sdk
 * 0.3.331, Claude Code 2.1.331), where `mcp__*` was skipped with "Wildcard tool name \"mcp__*\" is not
 * supported in allow rules" written into the agent's answer; and the runtime's allow verdicts, read in
 * sdk.mjs (`d9`, `Hc`, `lx`) and run by the #176 reviewer on the extracted branches (2026-11-26). The
 * verdicts below are copied as literals, not derived from config.ts.
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
];
/** Skipped by the runtime as "MCP rules do not support patterns in parentheses". */
const MCP_PATTERN_SKIPPED = ["mcp__bridge(*)", "mcp__bridge__get(*)", "mcp__entwurf-bridge__*(x)"];
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
];

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
