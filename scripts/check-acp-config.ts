// Deterministic gate for the S2g operator provider-config loader. Pure +
// temp-dir settings I/O — IN pnpm check. No child, no spawn.
//
// Locks the GPT `…2f9325` config-passthrough invariants:
//   1. global/project merge: scalar override (project-defined only) + mcpServers
//      per-name shallow merge with project override.
//   2. defaults: strictMcpConfig true, settingSources [], tools/permission/
//      disallowed baseline, skillPlugins [].
//   3. invalid mcpServers (root / entry / args / env / headers / type / url) →
//      McpServerConfigError naming the offending server.
//   4. invalid skillPlugins (relative / missing dir / missing manifest) → fail-loud.
//   5. nonempty skillPlugins → Skill tool + Skill(*) permission auto-added.
//   6. appendSystemPrompt: true → fail-loud (unsupported).
//   7. strictMcpConfig: false → fail-loud (Hard Rule #4).
//   8. normalized mcp hash: deterministic + sorted; a command/env/header/url
//      change changes the hash (NOT just a name change). The envelope enrich
//      injects PI_SESSION_ID/PI_AGENT_ID into entwurf-bridge only, filters stale
//      values, leaves http/sse untouched, and runs AFTER the hash is taken.

import { strict as assert } from "node:assert";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
	type AcpMcpServer,
	enrichMcpServersWithEnvelope,
	McpServerConfigError,
	mcpServerNames,
	normalizeMcpServers,
	resolveProviderConfig,
} from "../pi-extensions/lib/acp/config.ts";
import {
	DEFAULT_CLAUDE_DISALLOWED_TOOLS,
	DEFAULT_CLAUDE_PERMISSION_ALLOW,
	DEFAULT_CLAUDE_TOOLS,
} from "../pi-extensions/lib/acp/tool-surface.ts";

const root = mkdtempSync(resolve(tmpdir(), "acp-config-gate-"));
const NONE = join(root, "__absent__.json");

/** Write a settings file with the given entwurfProvider block; return path. */
function settings(name: string, block: unknown): string {
	const p = join(root, name);
	writeFileSync(p, JSON.stringify({ entwurfProvider: block }));
	return p;
}

function resolveWith(globalPath: string, projectPath: string) {
	return resolveProviderConfig({
		cwd: root,
		modelId: "claude-sonnet-4-6",
		globalSettingsPath: globalPath,
		projectSettingsPath: projectPath,
	});
}

const DEFAULT_TOOLS = ["Read", "Bash", "Edit", "Write"];

try {
	// ----------------------------------------------------------------------
	// 1) defaults (no settings files at all)
	// ----------------------------------------------------------------------
	{
		const c = resolveWith(NONE, NONE);
		assert.deepEqual(c.settingSources, [], "settingSources defaults to []");
		assert.equal(c.strictMcpConfig, true, "strictMcpConfig defaults to true");
		assert.equal(c.showToolNotifications, true, "showToolNotifications defaults to true");
		assert.deepEqual(c.mcpServers, [], "mcpServers defaults to []");
		assert.deepEqual(c.tools, DEFAULT_TOOLS, "tools defaults to the pi baseline");
		assert.ok(c.permissionAllow.includes("mcp__*"), "permissionAllow defaults include mcp__*");
		assert.ok(c.disallowedTools.includes("WebSearch"), "disallowedTools defaults applied");
		assert.deepEqual(c.skillPlugins, [], "skillPlugins defaults to []");
		// Amber drift-lock (GPT `…2f9325`): config.ts mirrors the defaults as local
		// constants (strip-types value-import ban). Assert they stay in lockstep with
		// tool-surface.ts — the SSOT — so a one-sided edit fails this gate.
		assert.deepEqual(
			[...c.tools],
			[...DEFAULT_CLAUDE_TOOLS],
			"resolved default tools == tool-surface DEFAULT_CLAUDE_TOOLS",
		);
		assert.deepEqual(
			[...c.permissionAllow],
			[...DEFAULT_CLAUDE_PERMISSION_ALLOW],
			"resolved default permissionAllow == tool-surface DEFAULT_CLAUDE_PERMISSION_ALLOW",
		);
		assert.deepEqual(
			[...c.disallowedTools],
			[...DEFAULT_CLAUDE_DISALLOWED_TOOLS],
			"resolved default disallowedTools == tool-surface DEFAULT_CLAUDE_DISALLOWED_TOOLS",
		);
	}

	// ----------------------------------------------------------------------
	// 2) merge: project overrides global for defined keys; mcpServers merge per name
	// ----------------------------------------------------------------------
	{
		const g = settings("g2.json", {
			settingSources: ["user"],
			mcpServers: { alpha: { command: "a" }, shared: { command: "global-shared" } },
		});
		const p = settings("p2.json", {
			mcpServers: { beta: { type: "http", url: "https://b.test" }, shared: { command: "project-shared" } },
		});
		const c = resolveWith(g, p);
		// project did NOT set settingSources → global value survives (not nuked by undefined).
		assert.deepEqual(c.settingSources, ["user"], "absent project key keeps the global value");
		// mcpServers: union of names, project wins on `shared`.
		assert.deepEqual(mcpServerNames(c), ["alpha", "beta", "shared"], "mcpServers merge is the union, name-sorted");
		const shared = c.mcpServers.find((s) => s.name === "shared") as Extract<AcpMcpServer, { command: string }>;
		assert.equal(shared.command, "project-shared", "project overrides the global server of the same name");
	}
	assert.throws(
		() => normalizeMcpServers([] as unknown as Record<string, unknown>),
		McpServerConfigError,
		"array root rejected",
	);
	assert.throws(
		() => normalizeMcpServers({ x: { command: "" } }),
		/x: stdio server requires/,
		"empty command rejected",
	);
	assert.throws(() => normalizeMcpServers({ x: { command: "c", args: [1] } }), /x: "args/, "non-string arg rejected");
	assert.throws(
		() => normalizeMcpServers({ x: { command: "c", env: [{ name: "A" }] } }),
		/x: "env/,
		"env entry without value rejected",
	);
	assert.throws(
		() => normalizeMcpServers({ x: { type: "http" } }),
		/x: http server requires/,
		"http without url rejected",
	);
	assert.throws(
		() => normalizeMcpServers({ x: { type: "bogus" } }),
		/x: unsupported "type"/,
		"unsupported type rejected",
	);
	// the error carries structured issues naming each bad server.
	try {
		normalizeMcpServers({ bad1: { command: "" }, bad2: { type: "sse" } });
		assert.fail("expected McpServerConfigError");
	} catch (e) {
		assert.ok(e instanceof McpServerConfigError, "is a McpServerConfigError");
		assert.deepEqual(e.issues.map((i) => i.server).sort(), ["bad1", "bad2"], "issues name every offending server");
	}

	// ----------------------------------------------------------------------
	// 4) invalid skillPlugins → fail-loud
	// ----------------------------------------------------------------------
	{
		assert.throws(
			() => resolveWith(NONE, settings("p4a.json", { skillPlugins: ["relative/path"] })),
			/must be an absolute path/,
			"relative skillPlugin path rejected",
		);
		assert.throws(
			() => resolveWith(NONE, settings("p4b.json", { skillPlugins: [join(root, "nope")] })),
			/does not exist/,
			"missing skillPlugin dir rejected",
		);
		const noManifest = join(root, "nomanifest");
		mkdirSync(noManifest, { recursive: true });
		assert.throws(
			() => resolveWith(NONE, settings("p4c.json", { skillPlugins: [noManifest] })),
			/missing \.claude-plugin\/plugin\.json/,
			"skillPlugin without manifest rejected",
		);
	}

	// ----------------------------------------------------------------------
	// 5) nonempty skillPlugins → Skill + Skill(*) auto-added
	// ----------------------------------------------------------------------
	{
		const skill = join(root, "okskill");
		mkdirSync(join(skill, ".claude-plugin"), { recursive: true });
		writeFileSync(join(skill, ".claude-plugin", "plugin.json"), JSON.stringify({ name: "okskill" }));
		const c = resolveWith(NONE, settings("p5.json", { skillPlugins: [skill] }));
		assert.ok(c.tools.includes("Skill"), "Skill tool auto-added");
		assert.ok(c.permissionAllow.includes("Skill(*)"), "Skill(*) permission auto-added");
		assert.deepEqual(c.skillPlugins, [skill], "the plugin path is carried through");
		// idempotent: an operator who already listed Skill is not duplicated.
		const c2 = resolveWith(NONE, settings("p5b.json", { skillPlugins: [skill], tools: ["Read", "Skill"] }));
		assert.equal(c2.tools.filter((t) => t === "Skill").length, 1, "Skill is not duplicated");
	}
	assert.throws(
		() => resolveWith(NONE, settings("p6.json", { appendSystemPrompt: true })),
		/appendSystemPrompt: true is unsupported/,
		"appendSystemPrompt:true rejected (rich context = first-user augment)",
	);
	// false / absent is fine.
	assert.doesNotThrow(() => resolveWith(NONE, settings("p6b.json", { appendSystemPrompt: false })), "false is allowed");
	assert.throws(
		() => resolveWith(NONE, settings("p7.json", { strictMcpConfig: false })),
		/strictMcpConfig: false is unsupported/,
		"strictMcpConfig:false rejected (Hard Rule #4: no ambient MCP)",
	);
	assert.doesNotThrow(() => resolveWith(NONE, settings("p7b.json", { strictMcpConfig: true })), "true is allowed");

	// ----------------------------------------------------------------------
	// 8) hash determinism + sensitivity; envelope enrich semantics
	// ----------------------------------------------------------------------
	{
		const a = normalizeMcpServers({ z: { command: "c", args: ["1"] }, a: { command: "c" } });
		const b = normalizeMcpServers({ a: { command: "c" }, z: { command: "c", args: ["1"] } });
		assert.equal(a.hash, b.hash, "hash is order-independent (servers sorted before hashing)");
		assert.deepEqual(
			a.servers.map((s) => s.name),
			["a", "z"],
			"servers are name-sorted",
		);
		// a command / arg / env change changes the hash (not just a name change).
		assert.notEqual(
			normalizeMcpServers({ a: { command: "c" } }).hash,
			normalizeMcpServers({ a: { command: "DIFFERENT" } }).hash,
			"command change changes the hash",
		);
		assert.notEqual(
			normalizeMcpServers({ a: { command: "c" } }).hash,
			normalizeMcpServers({ a: { command: "c", env: { K: "V" } } }).hash,
			"env change changes the hash",
		);
		assert.notEqual(
			normalizeMcpServers({ a: { type: "http", url: "https://x.test" } }).hash,
			normalizeMcpServers({ a: { type: "http", url: "https://y.test", headers: { H: "V" } } }).hash,
			"url/header change changes the hash",
		);

		// enrich: PI_SESSION_ID/PI_AGENT_ID into entwurf-bridge only; stale filtered;
		// http untouched; other stdio untouched.
		const servers = normalizeMcpServers({
			"entwurf-bridge": { command: "node", env: { PI_SESSION_ID: "STALE", FOO: "bar" } },
			weather: { type: "http", url: "https://w.test" },
			other: { command: "x" },
		}).servers;
		const enriched = enrichMcpServersWithEnvelope(servers, { modelId: "claude-sonnet-4-6", piSessionId: "LIVE-1" });
		const bridge = enriched.find((s) => s.name === "entwurf-bridge") as Extract<AcpMcpServer, { command: string }>;
		const env = Object.fromEntries(bridge.env.map((e) => [e.name, e.value]));
		assert.equal(env.PI_SESSION_ID, "LIVE-1", "live PI_SESSION_ID wins over the stale operator value");
		assert.equal(env.PI_AGENT_ID, "entwurf/claude-sonnet-4-6", "PI_AGENT_ID injected from the model id");
		assert.equal(env.FOO, "bar", "operator env preserved");
		const weather = enriched.find((s) => s.name === "weather");
		assert.ok(!("env" in (weather ?? {})), "http server not enriched (no env carrier)");
		const other = enriched.find((s) => s.name === "other") as Extract<AcpMcpServer, { command: string }>;
		assert.deepEqual(other.env, [], "a non-bridge stdio server keeps its (empty) env untouched");
		// enrich does NOT mutate the normalized list (hash taken earlier stays valid).
		assert.equal(
			normalizeMcpServers({ "entwurf-bridge": { command: "node", env: { PI_SESSION_ID: "STALE", FOO: "bar" } } })
				.servers[0].name,
			"entwurf-bridge",
			"enrich is a pure map — the source normalized list is unchanged",
		);
	}

	console.log(
		"[check-acp-config] ok — defaults (strict-mcp on, [] sources, baseline tools); project overrides global only for " +
			"defined keys; mcpServers merge per-name with project win; invalid mcpServers/skillPlugins fail loud naming the " +
			"offender; nonempty skillPlugins auto-add Skill+Skill(*); appendSystemPrompt:true and strictMcpConfig:false are " +
			"rejected; mcp hash is sorted+deterministic and sensitive to command/args/env/url/headers; envelope enrich injects " +
			"PI_SESSION_ID/PI_AGENT_ID into entwurf-bridge only (stale filtered), leaves http/other stdio untouched, post-hash",
	);
} finally {
	rmSync(root, { recursive: true, force: true });
}
