// Deterministic gate for the S2a ACP SDK dependency surface.
//
// Pins the ACP runtime deps to the current behavior-oracle versions and locks
// the peer-resolution that makes the Claude ACP adapter satisfiable:
//
//   @agentclientprotocol/sdk              1.3.0    wire SDK (acp-bridge import source)
//   @agentclientprotocol/claude-agent-acp 0.61.0   Claude adapter (spawn binary)
//   @anthropic-ai/sdk                     0.100.1  peer-resolution pin ONLY (see below)
//
// The anthropic SDK is NOT an API client / auth surface here. It is a direct
// dep solely to satisfy @anthropic-ai/claude-agent-sdk@0.3.217's peer floor
// (>=0.93.0); drop it and the tree resolves a stale 0.91.1 so the peer goes
// unmet — a failure that would only surface at the first raw turn. The
// lockfile proves the same shape. Source-level import / API-client
// instantiation / credential use stays forbidden — asserted in layer (4).
// (GPT hard constraint 2, revised 2026-06-18: direct dep allowed ONLY as an
// exact peer-resolution pin; source-level use remains forbidden.)
//
// Layers:
//   (1)  package.json exact pins for all three deps;
//   (2)  pnpm-lock peer-resolution lock (adapter + claude-agent-sdk → 0.100.1);
//   (2b) runtime peer-resolution probe (claude-agent-sdk context → 0.100.1);
//   (3)  @agentclientprotocol/sdk value-export surface (silent-rename gate);
//   (4)  no tracked source imports the anthropic SDK or builds an API client.

import { strict as assert } from "node:assert";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";

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
	"@agentclientprotocol/sdk": "1.3.0",
	"@agentclientprotocol/claude-agent-acp": "0.61.0",
	[ANTHROPIC_SDK]: "0.100.1",
};
for (const [name, ver] of Object.entries(PINS)) {
	assert.equal(
		deps[name],
		ver,
		`package.json dependencies["${name}"] must be exact "${ver}" (got "${deps[name]}") — S2a pins the current oracle versions`,
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
	/@agentclientprotocol\/claude-agent-acp@0\.61\.0\(@anthropic-ai\/sdk@0\.100\.1/,
	"pnpm-lock: claude-agent-acp@0.61.0 must peer-resolve @anthropic-ai/sdk@0.100.1 (peer-pin), not the stale 0.91.1",
);
assert.match(
	lock,
	/@anthropic-ai\/claude-agent-sdk@0\.3\.217\(@anthropic-ai\/sdk@0\.100\.1/,
	"pnpm-lock: claude-agent-sdk@0.3.217 must peer-resolve @anthropic-ai/sdk@0.100.1 — else its >=0.93.0 peer floor is unmet",
);

// ---------------------------------------------------------------------------
// (2b) runtime peer-resolution probe — the actual Node resolver, not lock text.
//      Layer (2) freezes the publish/install floor; this probes that the
//      claude-agent-sdk → @anthropic-ai/sdk peer edge really resolves to
//      0.100.1 in a live module graph. Two different failures, both needed.
//      Note: a top-level/adapter-context resolve of the anthropic SDK may see
//      0.91.1 (pi's own transitive) — that is normal. The edge that must be
//      0.100.1 is the one *inside* claude-agent-sdk's context.
// ---------------------------------------------------------------------------
const pkgInfoFromEntry = (entryPath: string): { name: string; version: string; dir: string } => {
	// A `<pkg>/package.json` subpath resolve can fail under "exports"; walk up
	// from the resolved entry to the nearest package.json instead.
	let dir = dirname(entryPath);
	for (;;) {
		try {
			const pj = JSON.parse(readFileSync(resolve(dir, "package.json"), "utf8")) as {
				name?: string;
				version?: string;
			};
			if (pj.name && pj.version) return { name: pj.name, version: pj.version, dir };
		} catch {
			// no package.json here (or unreadable) — keep walking up.
		}
		const parent = dirname(dir);
		if (parent === dir) throw new Error(`no package.json found walking up from ${entryPath}`);
		dir = parent;
	}
};

const rootRequire = createRequire(resolve(repoRoot, "package.json"));
const adapterPkgJson = rootRequire.resolve("@agentclientprotocol/claude-agent-acp/package.json");
const adapterRequire = createRequire(adapterPkgJson);
const casEntry = adapterRequire.resolve("@anthropic-ai/claude-agent-sdk");
const casInfo = pkgInfoFromEntry(casEntry);
assert.equal(
	casInfo.version,
	"0.3.217",
	`@anthropic-ai/claude-agent-sdk must runtime-resolve to 0.3.217 from the adapter context (got ${casInfo.version})`,
);
const casRequire = createRequire(resolve(casInfo.dir, "package.json"));
const sdkEntry = casRequire.resolve(ANTHROPIC_SDK);
const sdkInfo = pkgInfoFromEntry(sdkEntry);
assert.equal(
	sdkInfo.version,
	"0.100.1",
	`${ANTHROPIC_SDK} must peer-resolve to 0.100.1 from the claude-agent-sdk context (got ${sdkInfo.version}) — a 0.91.1 here means the >=0.93.0 peer is unmet and the raw turn would break`,
);

// ---------------------------------------------------------------------------
// (2c) adapter-context wire-SDK + MCP-SDK runtime resolve — the ACP dep bump's
//      real fault surface. Lock text (layer 2) freezes the publish floor; these probe
//      the LIVE module graph the adapter actually traverses: the adapter must SEE
//      the same wire SDK the backend imports at root (1.3.0), and claude-agent-sdk
//      must SEE its declared MCP peer (1.29.x). Cheap edges, both newly relevant
//      after the 0.54→0.61 / 1.1→1.3 bump.
// ---------------------------------------------------------------------------
const wireEntry = adapterRequire.resolve("@agentclientprotocol/sdk");
const wireInfo = pkgInfoFromEntry(wireEntry);
assert.equal(
	wireInfo.version,
	"1.3.0",
	`@agentclientprotocol/sdk must runtime-resolve to 1.3.0 from the adapter context (got ${wireInfo.version}) — the adapter and the backend must share one wire SDK`,
);
// @modelcontextprotocol/sdk gates its bare specifier behind "exports", so a
// require.resolve of the package ROOT throws (no resolvable entry) — resolve a
// real SUBPATH instead and walk up to its package.json.
//
// This used to read the repo's own hoisted copy and justify it with "pnpm
// hoists ONE mcp instance". That is true of today's lockfile, which is exactly
// why it asserted nothing: the read never traversed the edge it claimed to
// verify, so a nested @modelcontextprotocol/sdk under claude-agent-sdk would
// leave this gate GREEN while the adapter loaded a peer no gate had seen. A
// probe whose subject is "whatever the root happens to hoist" is a coincidence,
// not a check. Resolve FROM the claude-agent-sdk context so the assertion binds
// the real adapter → claude-agent-sdk → MCP edge, the same way the anthropic
// SDK peer above is bound.
const mcpEntry = casRequire.resolve("@modelcontextprotocol/sdk/server/index.js");
const mcpInfo = pkgInfoFromEntry(mcpEntry);
assert.ok(
	mcpInfo.version.startsWith("1.29."),
	`@modelcontextprotocol/sdk must runtime-resolve to 1.29.x from the claude-agent-sdk context (got ${mcpInfo.version}) — claude-agent-sdk 0.3.217 declares a ^1.29.0 peer`,
);

// ---------------------------------------------------------------------------
// (3) @agentclientprotocol/sdk value-export surface (silent-rename gate)
//     The ACP bridge imports these from the wire SDK; a silent upstream
//     rename would not fail typecheck (type-only erasure) but would break the
//     raw turn. Assert the *value* exports exist at runtime.
// ---------------------------------------------------------------------------
// These are the value imports the real ACP code uses: the connectAcpClient
// adapter (acp-client.ts) drives `client` + the `AGENT_METHODS`/`CLIENT_METHODS`
// method tables; the backend + raw-turn smoke value-import `ndJsonStream` (the
// stdio transport) and `PROTOCOL_VERSION`. The deprecated `ClientSideConnection`
// is no longer used, so it is no longer gated. (Per GPT: gate only the value
// imports the real code uses — type-only imports are erased.)
const acpSdk = (await import("@agentclientprotocol/sdk")) as Record<string, unknown>;
for (const sym of ["client", "ndJsonStream", "PROTOCOL_VERSION", "AGENT_METHODS", "CLIENT_METHODS"]) {
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
	.filter(Boolean)
	// `git ls-files` still names an UNSTAGED deletion (same contract as
	// check-install-surface / the run.sh floor sweeps): a release-surface
	// migration deletes tracked files before the commit workflow stages them;
	// absence cannot import the SDK and must not crash this read-only sweep.
	.filter((f) => existsSync(resolve(repoRoot, f)));

// Specifier-shaped: any module binding to the anthropic SDK, in any of the
// forms a source file could reach it — static `from`, `export ... from`,
// side-effect `import "X"`, dynamic `import("X")`, and `require("X")`.
const spec = `["']${ANTHROPIC_SDK.replace("/", "\\/")}["']`;
const specifierPatterns: ReadonlyArray<{ re: RegExp; kind: string }> = [
	{ re: new RegExp(String.raw`\bfrom\s+${spec}`), kind: `import/export from ${ANTHROPIC_SDK}` },
	{ re: new RegExp(String.raw`^\s*import\s+${spec}`), kind: `side-effect import ${ANTHROPIC_SDK}` },
	{ re: new RegExp(String.raw`\bimport\(\s*${spec}\s*\)`), kind: `dynamic import(${ANTHROPIC_SDK})` },
	{ re: new RegExp(String.raw`\brequire\(\s*${spec}\s*\)`), kind: `require(${ANTHROPIC_SDK})` },
];
const clientRe = new RegExp(String.raw`\bnew\s+${API_CLIENT_CLASS}\s*\(`);

const offenders: string[] = [];
for (const f of tracked) {
	const src = read(f);
	for (const line of src.split("\n")) {
		for (const { re, kind } of specifierPatterns) {
			if (re.test(line)) offenders.push(`${f}: ${kind}`);
		}
		if (clientRe.test(line)) offenders.push(`${f}: new ${API_CLIENT_CLASS}() API client`);
	}
}
assert.equal(
	offenders.length,
	0,
	`${ANTHROPIC_SDK} is a peer-resolution pin ONLY — no source import / API client allowed:\n  ${offenders.join("\n  ")}`,
);

console.log("[check-acp-sdk-surface] ACP dep pins + peer-resolution lock + wire-SDK export surface + no-client-use ok");
