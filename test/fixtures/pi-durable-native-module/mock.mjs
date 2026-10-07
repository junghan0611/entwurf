// Synthetic development fixture for the pi-durable `--native-module` ingress (#130 P2). It is NOT an
// env-loader and never ships: no dotenv, no file read, no credential, no import beyond node:*.
//
// Its top-level evaluation is its initialization: it sets one synthetic, non-identity value, awaits
// one turn of the event loop (initialization is not a single tick), and, only when a test names a
// receipt file, appends one `init` line there. Its default export is a native durable Extension with
// one tool and a plain JSON schema.
import { appendFileSync } from "node:fs";

process.env.MOCK_NATIVE_MARK = "mock-native-mark-0f5c";
await new Promise((resolve) => setImmediate(resolve));
if (process.env.MOCK_NATIVE_RECEIPT) appendFileSync(process.env.MOCK_NATIVE_RECEIPT, "init\n");

export default {
	name: "mock-native",
	tools: [
		{
			name: "mock_native_echo",
			description: "Synthetic fixture tool: answers its text with a mock: prefix.",
			parameters: {
				type: "object",
				properties: { text: { type: "string" } },
				required: ["text"],
				additionalProperties: false,
			},
			async execute(args) {
				return { content: [{ type: "text", text: `mock:${args.text}` }] };
			},
		},
	],
};
