// Tiny stdio MCP server used ONLY by smoke-acp-mcp-live (S2g LIVE 1).
//
// It exposes ONE tool — `probe_nonce` — that returns a per-run secret nonce
// supplied via the PROBE_NONCE env var. The smoke registers this server in a
// scratch `.pi/settings.json` under `entwurfProvider.mcpServers` and asks the
// ACP model to CALL the tool and echo the nonce. If the operator mcpServers
// passthrough (S2g) works, the ACP child spawns this server, the tool is visible
// in the session schema, and the model's reply carries the nonce. If passthrough
// is broken (the pre-S2g hardcoded `mcpServers:[]`), the tool never exists and
// the nonce cannot appear.
//
// Lives under the repo's scripts/fixtures/ so its `@modelcontextprotocol/sdk`
// import resolves against the repo node_modules even though the server is spawned
// (by the claude ACP child) with an arbitrary scratch cwd. Deliberately minimal:
// no identity / env coupling beyond PROBE_NONCE, so a failure isolates to "did
// the operator mcpServers reach newSession" — not to entwurf-bridge wiring.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

const server = new McpServer({ name: "probe", version: "0.0.1" });

server.tool(
	"probe_nonce",
	"Return this session's secret probe nonce. Call this when asked for the probe nonce.",
	{},
	async () => ({
		content: [{ type: "text", text: `PROBE_NONCE=${process.env.PROBE_NONCE ?? "MISSING"}` }],
	}),
);

const transport = new StdioServerTransport();
await server.connect(transport);
