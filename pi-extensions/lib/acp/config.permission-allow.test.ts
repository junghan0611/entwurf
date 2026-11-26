/**
 * #176 — an ACP permission allow rule must name the MCP server it widens.
 *
 * Oracle: the raw-acp rail0 receipt of 2026-11-26 against claude-agent-acp 0.112.0 (claude-agent-sdk
 * 0.3.331, Claude Code 2.1.331): with `mcp__*` in the allow list the runtime skipped the rule and wrote
 * "Wildcard tool name \"mcp__*\" is not supported in allow rules" into the agent's answer on a new, a
 * loaded and a resumed session; its validator's own examples of a valid rule are `mcp__puppeteer__*` and
 * `mcp__github__get_*`. Those strings are copied here, not derived from config.ts.
 */

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, expect, it } from "vitest";
import { readProviderSettingsFile, validatePermissionAllow } from "./config.ts";
import { DEFAULT_CLAUDE_PERMISSION_ALLOW } from "./tool-surface.ts";

const SKIPPED_BY_CLAUDE = ["mcp__*", "mcp__*__get_x", "mcp__entwurf*__*", "mcp__*bridge"];
const ACCEPTED_BY_CLAUDE = ["mcp__puppeteer__*", "mcp__github__get_*", "mcp__entwurf-bridge__*", "Read(*)", "Bash(*)"];

const root = mkdtempSync(join(tmpdir(), "acp-permission-allow-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

it("[QK:ACP-PERMISSION-ALLOW-NAMES-SERVER] a wildcard in the MCP server position is refused by name; a named server with a tool glob passes", () => {
	for (const rule of SKIPPED_BY_CLAUDE) {
		expect(() => validatePermissionAllow(["Read(*)", rule], "/x/settings.json"), rule).toThrow(
			`permissionAllow[1] ${JSON.stringify(rule)} puts a wildcard in the MCP server position`,
		);
	}
	expect(() => validatePermissionAllow(ACCEPTED_BY_CLAUDE, "/x/settings.json")).not.toThrow();
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
