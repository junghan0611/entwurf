// Which claude-agent-acp a run launches, and the ACP SDK on each side (#171 step 7). NOT a gate.
// Pure: reads package.json files only, spawns nothing. run.sh writes its output to provenance.json in
// every run directory, so a run on a prefix version carries the label beside its receipts.
//   node provenance.mjs [<prefix dir>]
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const read = (path) => (existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : null);

/** claude-agent-acp under one node_modules root, and the ACP SDK that copy resolves beside itself. */
function claudeAcpUnder(root) {
	const link = join(root, "node_modules/@agentclientprotocol/claude-agent-acp");
	if (!existsSync(join(link, "package.json"))) return null;
	const real = realpathSync(link);
	const pkg = read(join(real, "package.json"));
	// pnpm places a package's dependencies beside it in the same virtual-store node_modules.
	const sdk = read(join(dirname(real), "sdk/package.json"));
	return {
		version: pkg.version,
		sdkDeclared: pkg.dependencies?.["@agentclientprotocol/sdk"] ?? null,
		sdkResolved: sdk?.version ?? null,
	};
}

const prefix = process.argv[2];
const out = {
	claudeAcp: { source: prefix ? "prefix" : "repository", ...claudeAcpUnder(prefix ?? REPO) },
	pinnedClaudeAcp: claudeAcpUnder(REPO),
	// The SDK Entwurf's own ACP client is built against (the raw probes speak JSON-RPC directly).
	entwurfClientSdk: read(join(REPO, "node_modules/@agentclientprotocol/sdk/package.json"))?.version ?? null,
};
console.log(JSON.stringify(out, null, 2));
