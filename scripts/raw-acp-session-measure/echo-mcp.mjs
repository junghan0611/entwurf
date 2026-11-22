// Minimal stdio MCP server for U24 (#171 step 7). NOT a gate. One tool, `echo_probe`, returns its
// `text` argument unchanged; a vendor that applies a changed `mcpServers` on resume can call it.
// Hand-written newline-delimited JSON-RPC so it needs no dependency from the run directory.
import { createInterface } from "node:readline";

const send = (message) => process.stdout.write(`${JSON.stringify(message)}\n`);
const TOOL = {
	name: "echo_probe",
	description: "Returns the given text unchanged.",
	inputSchema: { type: "object", properties: { text: { type: "string" } }, required: ["text"] },
};

createInterface({ input: process.stdin }).on("line", (line) => {
	let m;
	try {
		m = JSON.parse(line);
	} catch {
		return;
	}
	if (m.id === undefined) return; // notifications need no answer
	if (m.method === "initialize")
		send({
			jsonrpc: "2.0",
			id: m.id,
			result: {
				protocolVersion: m.params?.protocolVersion ?? "2025-06-18",
				capabilities: { tools: {} },
				serverInfo: { name: "entwurf-171-echo", version: "0" },
			},
		});
	else if (m.method === "tools/list") send({ jsonrpc: "2.0", id: m.id, result: { tools: [TOOL] } });
	else if (m.method === "tools/call" && m.params?.name === "echo_probe")
		send({
			jsonrpc: "2.0",
			id: m.id,
			result: { content: [{ type: "text", text: String(m.params?.arguments?.text ?? "") }] },
		});
	else if (m.method === "ping") send({ jsonrpc: "2.0", id: m.id, result: {} });
	else send({ jsonrpc: "2.0", id: m.id, error: { code: -32601, message: `echo-mcp: ${m.method} not supported` } });
});
