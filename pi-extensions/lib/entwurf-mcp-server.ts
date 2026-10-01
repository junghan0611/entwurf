/**
 * entwurf-mcp-server — how a pi citizen hands its Entwurf verbs to Pi's built-in MCP (#125).
 *
 * WHY THE VERBS ARE NOT NATIVE TOOLS ANY MORE. Pi 0.99 ships MCP as a built-in extension
 * (`builtin:mcp`): it spawns stdio servers, owns their lifecycle, and closes them on
 * `session_shutdown`. The same compiled `entwurf-bridge` every other harness already reaches is
 * therefore the one surface a pi session needs too — the five hand-written `registerTool` copies
 * that duplicated it are gone, and so is the drift they invited. Pi, not Entwurf, supervises the
 * child: nothing here starts, restarts or stops a process.
 *
 * WHAT THIS MODULE DECIDES, AND NOTHING ELSE:
 *   - the server NAME. `entwurf-bridge` is the key every other host already uses. Pi sanitizes it
 *     into the call name, so a pi model calls `mcp__entwurf_bridge__<verb>` (`[측정 2026-10-01,
 *     pi 0.99.2]` `extensions/mcp/tools.ts:82-90`: everything outside `[A-Za-z0-9_]` becomes `_`).
 *     The key itself is unchanged. It is a call-name prefix, never an address: the record is the
 *     only address axis.
 *   - the ENTRY. The COMPILED bridge (`scripts/build-bridge.sh` output) that a packaged consumer
 *     receives next to `pi-extensions/`. There is no TypeScript fallback: a missing build is a
 *     named failure, not a silent switch to a different artifact.
 *   - the IDENTITY carrier. `PI_SESSION_ID` / `PI_AGENT_ID` are passed EXPLICITLY in the server
 *     config from the record this session was just born with. Pi merges a stdio child's env as
 *     `{...process.env, ...config.env}`, so the explicit value wins over whatever the process
 *     happens to carry — the carrier is the record-established identity by construction, not by
 *     the timing of an ambient export.
 *   - the EXPOSURE. `direct`: the verbs are declared to the model like built-in tools. Two bridge
 *     tools have no use on a pi host and are hidden: `entwurf_inbox_read` drains a caller-supplied
 *     mailbox (a pi citizen has no mailbox), and `entwurf_register_native` binds a NATIVE harness
 *     session (a pi citizen is born by this extension).
 *
 * A same-namespace entry in the operator's or a trusted project's `mcp.json` — `entwurf-bridge` or
 * `entwurf_bridge`, which Pi folds to one namespace — replaces this registration by Pi's own
 * precedence, and `/mcp` says so. That is the operator's choice and
 * Pi's contract; this module does not scan config, fight it, or add a second owner.
 */

import * as path from "node:path";
import type { McpServerConfig } from "@earendil-works/pi-coding-agent";

/** The built-in MCP server key. Pi sanitizes it into the call name (`mcp__entwurf_bridge__<verb>`); never an address. */
export const ENTWURF_MCP_SERVER_NAME = "entwurf-bridge";

/** Bridge tools with no use on a pi host (see the module header). */
export const ENTWURF_MCP_HIDDEN_TOOLS = ["entwurf_inbox_read", "entwurf_register_native"] as const;

/**
 * The compiled bridge entry, resolved from the directory of the extension file that loads it.
 * Checkout and packaged install share this layout: `pi-extensions/` beside `mcp/entwurf-bridge/dist/`.
 */
export function entwurfBridgeCompiledEntry(extensionDir: string): string {
	return path.resolve(extensionDir, "..", "mcp", "entwurf-bridge", "dist", "mcp", "entwurf-bridge", "src", "index.js");
}

export interface EntwurfMcpServerInput {
	/** The record gardenId this session was just born with. */
	gardenId: string;
	/** `<provider>/<model>` of the live session, when known. */
	agentId: string | undefined;
	/** Absolute path of the compiled bridge entry. */
	compiledEntry: string;
	/** The node binary running pi. */
	nodePath: string;
}

/** The one server config a born pi citizen registers. Pure: no IO, no env reads. */
export function buildEntwurfMcpServerConfig(input: EntwurfMcpServerInput): McpServerConfig {
	if (!input.gardenId) throw new Error("entwurf-mcp-server: a server config needs the born record's gardenId");
	return {
		command: input.nodePath,
		args: [input.compiledEntry],
		env: { PI_SESSION_ID: input.gardenId, ...(input.agentId ? { PI_AGENT_ID: input.agentId } : {}) },
		exposure: "direct",
		toolExposure: Object.fromEntries(ENTWURF_MCP_HIDDEN_TOOLS.map((tool) => [tool, "hidden"])),
	};
}
