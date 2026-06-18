// Deterministic gate for the S2a ACP SDK dependency surface.
//
// Pins the ACP runtime deps to the 0.11.0 behavior-oracle versions and locks
// the peer-resolution that makes the Claude ACP adapter satisfiable:
//
//   @agentclientprotocol/sdk              0.22.1   wire SDK (acp-bridge import source)
//   @agentclientprotocol/claude-agent-acp 0.39.0   Claude adapter (spawn binary)
//   @anthropic-ai/sdk                     0.100.1  peer-resolution pin ONLY (see below)
//
// The anthropic SDK is NOT an API client / auth surface here. It is a direct
// dep solely to satisfy @anthropic-ai/claude-agent-sdk@0.3.156's peer floor
// (>=0.93.0); drop it and the tree resolves a stale 0.91.1 so the peer goes
// unmet — a failure that would only surface at the first raw turn. 0.11.0's
// lockfile proves the same shape. Source-level import / API-client
// instantiation / credential use stays forbidden — asserted in layer (4).
// (GPT hard constraint 2, revised 2026-06-18: direct dep allowed ONLY as an
// exact peer-resolution pin; source-level use remains forbidden.)
//
// Layers:
//   (1) package.json exact pins for all three deps;
//   (2) pnpm-lock peer-resolution lock (adapter + claude-agent-sdk → 0.100.1);
//   (3) @agentclientprotocol/sdk value-export surface (silent-rename gate);
//   (4) no tracked source imports the anthropic SDK or builds an API client.

import { strict as assert } from "node:assert";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Split literals so this gate's own regexes never self-match in layer (4).
const ANTHROPIC_SDK = `@anthropic-ai/${"sdk"}`;
const API_CLIENT_CLASS = `${"Anthropic"}`;

const repoRoot = resolve(import.meta.dirname, "..");
const read = (p: string): string => readFileSync(resolve(repoRoot, p), "utf8");

// ---------------------------------------------------------------------------
// (1) package.json — exact pins (no caret/range; S2a freezes the oracle set)
// ---------------------------------------------------------------------------
const pkg = JSON.parse(read("package.json")) as { dependencies?: Record<string, string> };
const deps = pkg.dependencies ?? {};
const PINS: Record<string, string> = {
	"@agentclientprotocol/sdk": "0.22.1",
	"@agentclientprotocol/claude-agent-acp": "0.39.0",
	[ANTHROPIC_SDK]: "0.100.1",
};
for (const [name, ver] of Object.entries(PINS)) {
	assert.equal(
		deps[name],
		ver,
		`package.json dependencies["${name}"] must be exact "${ver}" (got "${deps[name]}") — S2a pins the 0.11.0 oracle versions`,
	);
}

// ---------------------------------------------------------------------------
// (2) pnpm-lock — peer-resolution lock
//     The adapter and claude-agent-sdk MUST peer-resolve the anthropic SDK to
//     0.100.1; a 0.91.1 resolution means the >=0.93.0 peer is unmet (the bug
//     this whole pin exists to prevent).
// ---------------------------------------------------------------------------
const lock = read("pnpm-lock.yaml");
assert.match(
	lock,
	/@agentclientprotocol\/claude-agent-acp@0\.39\.0\(@anthropic-ai\/sdk@0\.100\.1/,
	"pnpm-lock: claude-agent-acp@0.39.0 must peer-resolve @anthropic-ai/sdk@0.100.1 (peer-pin), not the stale 0.91.1",
);
assert.match(
	lock,
	/@anthropic-ai\/claude-agent-sdk@0\.3\.156\(@anthropic-ai\/sdk@0\.100\.1/,
	"pnpm-lock: claude-agent-sdk@0.3.156 must peer-resolve @anthropic-ai/sdk@0.100.1 — else its >=0.93.0 peer floor is unmet",
);

// ---------------------------------------------------------------------------
// (3) @agentclientprotocol/sdk value-export surface (silent-rename gate)
//     The 0.11.0 acp-bridge imports these from the wire SDK; a silent upstream
//     rename would not fail typecheck (type-only erasure) but would break the
//     raw turn. Assert the *value* exports exist at runtime.
// ---------------------------------------------------------------------------
const acpSdk = (await import("@agentclientprotocol/sdk")) as Record<string, unknown>;
for (const sym of ["ClientSideConnection", "PROTOCOL_VERSION"]) {
	assert.ok(
		sym in acpSdk,
		`@agentclientprotocol/sdk lost value export "${sym}" — silent upstream rename; the raw ACP turn would break`,
	);
}

// ---------------------------------------------------------------------------
// (4) no source-level anthropic SDK import / API client
//     peer-pin only. The credential boundary (AGENTS §Operating boundaries)
//     forbids the bridge from importing the SDK or instantiating an API client.
//     Line-based: only real `import ... from` / `require(...)` statements count,
//     so this gate's own split-literal regexes above are never offenders.
// ---------------------------------------------------------------------------
const tracked = execFileSync("git", ["ls-files", "*.ts", "*.js", "*.mjs", "*.cjs"], {
	cwd: repoRoot,
	encoding: "utf8",
})
	.split("\n")
	.filter(Boolean);

const importRe = new RegExp(String.raw`^\s*import\b[^\n]*\bfrom\s+["']${ANTHROPIC_SDK.replace("/", "\\/")}["']`);
const requireRe = new RegExp(String.raw`\brequire\(\s*["']${ANTHROPIC_SDK.replace("/", "\\/")}["']\s*\)`);
const clientRe = new RegExp(String.raw`\bnew\s+${API_CLIENT_CLASS}\s*\(`);

const offenders: string[] = [];
for (const f of tracked) {
	const src = read(f);
	for (const line of src.split("\n")) {
		if (importRe.test(line)) offenders.push(`${f}: direct ${ANTHROPIC_SDK} import`);
		if (requireRe.test(line)) offenders.push(`${f}: direct ${ANTHROPIC_SDK} require()`);
		if (clientRe.test(line)) offenders.push(`${f}: new ${API_CLIENT_CLASS}() API client`);
	}
}
assert.equal(
	offenders.length,
	0,
	`${ANTHROPIC_SDK} is a peer-resolution pin ONLY — no source import / API client allowed:\n  ${offenders.join("\n  ")}`,
);

console.log("[check-acp-sdk-surface] ACP dep pins + peer-resolution lock + wire-SDK export surface + no-client-use ok");
