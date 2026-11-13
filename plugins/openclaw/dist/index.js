/**
 * entwurf OpenClaw plugin entry (entwurf #160). Hand-written canonical source, not a build output. Registers the one send tool; all behavior is in
 * `core.js`. Registration shape follows the 11.3 lab probe that measured the tool ctx
 * ([측정] S1 M1: `contextVersion: 2`, factory + execute both carry agentId/sessionKey/sessionId).
 *
 * No receive path lives here (card §4): siblings reach this session through the entwurf core's
 * native-push adapter (`sessions.describe` + `chat.send queueMode:"steer"`), not through plugin
 * steer / next-turn / system-event hooks.
 */

import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import { executeSend, parsePluginConfig, TOOL_DESCRIPTION, TOOL_NAME, TOOL_PARAMETERS } from "./core.js";

export default definePluginEntry({
	id: "entwurf",
	name: "Entwurf",
	description: "Send to a garden sibling as this session's own record-backed citizen.",
	register(api) {
		const config = parsePluginConfig(api.pluginConfig);
		const run = (argv, opts) => api.runtime.system.runCommandWithTimeout(argv, opts);
		api.registerTool(
			{
				contextVersion: 2,
				create(ctx) {
					// The factory ctx is kept for execute only; it grants nothing until execute's commit point.
					return {
						name: TOOL_NAME,
						label: "Entwurf send",
						description: TOOL_DESCRIPTION,
						parameters: TOOL_PARAMETERS,
						async execute(_toolCallId, params) {
							return executeSend(config, ctx, params, run);
						},
					};
				},
			},
			{ name: TOOL_NAME },
		);
	},
});
