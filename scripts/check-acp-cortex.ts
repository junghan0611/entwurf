// Deterministic gate for the Cortex (Snowflake Cortex Code) ACP backend — the
// first non-claude adapter on the rail (docs/acp-backend-rail.md §4/§6/§11-8).
// The cortex source lives in one `cortexAdapter` object (backend-adapter.ts) +
// its curated surface (models.ts) + the dual-HOME overlay (overlay.ts); the
// 결합 규칙 requires the gate to land WITH it, and §6 said EXTEND the
// `check-acp-*` family, so cortex's whole deterministic axis lives here.
//
// The contract under test is the CP0-measured one (v1.1.52, 2026-07-29), not
// PR #40's v1.1.8-era shape — the D-numbers refer to §11-8:
//   1. curated surface is the GLG-decided 4-row set, riding real registry bases;
//   2. `cortex-` prefix routes to cortexAdapter; prefix-strip recovers the
//      native id; the unprefixed claude ids are never claimed;
//   3. resolveLaunch NEVER pins `-m` — set-model is the single model authority;
//      `-c <connection>` rides settings/env; the CORTEX_ACP_COMMAND override
//      single-quotes metachar tokens;
//   4. enforceModel sends the NATIVE id through session/set_config_option
//      (CP0-M measured GO — same wire call as claude);
//   5. the dual-HOME overlay: isolated HOME layout, measured-minimum auth
//      passthrough (credential_cache — never the whole cache, never skills),
//      `autoUpdate:false` authored, the mcp.json projection with the
//      entwurf-bridge-only real-HOME restore (D9/D10), non-stdio fail-loud,
//      session-scoped dirs with exact rewrite + dead-pid sweep;
//   6. CORTEX_HOME ambient presence (empty string INCLUDED) refuses the spawn
//      (D3 — upstream consumers disagree about empty);
//   7. carrier-less augment (§9-4) — the operator engraving OVERRIDE rides the
//      first-user augment; a carrier backend (claude) never folds it in.
//
// [QK:*] labels mark the claims kill-qualified by scripts/mutants/acp-cortex.json
// under check-gate-qualification (assertion counts are never evidence).
//
// Two layers, mirroring the family convention:
//   - Layer A (direct strip-types imports): models.ts + overlay.ts + augment.ts
//     drive against INJECTED temp roots (Hard Rule 12: no operator dir touched).
//   - Layer B (compiled backend-adapter.js): backend-adapter.ts imports its
//     siblings with `.js` suffixes, which plain strip-types can't resolve — so
//     we tsc-emit the project to a temp dir and import the compiled artifact.
//     HOME is pointed at a sandbox BEFORE the compiled import so the module's
//     homedir()-derived roots land in the sandbox, never the operator home.

import { strict as assert } from "node:assert";
import { execFileSync } from "node:child_process";
import {
	existsSync,
	lstatSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	readlinkSync,
	rmdirSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { buildPiContextAugment } from "../pi-extensions/lib/acp/augment.ts";
import type { AcpMcpServer } from "../pi-extensions/lib/acp/config.ts";
import {
	CORTEX_MODEL_PREFIX,
	curatedClaudeModels,
	curatedCortexModels,
	SUPPORTED_CORTEX_MODEL_IDS,
} from "../pi-extensions/lib/acp/models.ts";
import {
	cortexOverlayScopeId,
	ensureCortexDualHomeOverlay,
	projectCortexMcpJson,
	sweepDeadCortexOverlays,
} from "../pi-extensions/lib/acp/overlay.ts";

// ---------------------------------------------------------------------------
// Layer A.1 — curated cortex surface (models.ts, real registry-derived)
// ---------------------------------------------------------------------------

assert.equal(CORTEX_MODEL_PREFIX, "cortex-", "cortex model prefix (routing authority) drifted");
assert.deepEqual(
	[...SUPPORTED_CORTEX_MODEL_IDS],
	["cortex-auto", "cortex-claude-opus-5", "cortex-claude-sonnet-5", "cortex-openai-gpt-5.4"],
	"supported cortex model id set drifted from the GLG-decided 4-row curation [QK:CORTEX-CURATED-FOUR-ROWS]",
);
for (const id of SUPPORTED_CORTEX_MODEL_IDS) {
	assert.ok(id.startsWith(CORTEX_MODEL_PREFIX), `cortex id ${id} must carry the reserved cortex- prefix`);
}

const cortexRows = curatedCortexModels();
const cortexRowIds = cortexRows.map((m) => m.id);
assert.deepEqual(cortexRowIds, [...SUPPORTED_CORTEX_MODEL_IDS], "curated cortex rows must match the supported id set");
// The two Claude rows ride their OWN registry bases (a fabricated row would
// drift from the pi-ai catalog); auto/gpt ride the sonnet base as a floor.
const claudeRows = curatedClaudeModels();
const sonnetBase = claudeRows.find((m) => m.id === "claude-sonnet-5");
const opusBase = claudeRows.find((m) => m.id === "claude-opus-5");
// Plain throw (not assert.ok): an asserts-function premise makes tsc report the
// downstream `base` const as circularly-typed (TS7022).
if (!sonnetBase || !opusBase) throw new Error("test premise: sonnet-5/opus-5 present in curated claude surface");
for (const row of cortexRows) {
	// Explicit annotation: node:assert's asserts-typed helpers otherwise make tsc
	// flag this flow-dependent const as circularly typed (TS7022).
	const base: (typeof claudeRows)[number] = row.id === "cortex-claude-opus-5" ? opusBase : sonnetBase;
	assert.equal(row.maxTokens, base.maxTokens, `${row.id} maxTokens must ride its registry base (real registry path)`);
	assert.deepEqual(row.cost, base.cost, `${row.id} cost must ride its registry base`);
	assert.equal(row.reasoning, base.reasoning, `${row.id} reasoning must ride its registry base`);
	assert.ok(row.contextWindow > 0, `${row.id} contextWindow must be positive`);
}

// ---------------------------------------------------------------------------
// Layer A.2 — dual-HOME overlay (overlay.ts, injected temp roots)
// ---------------------------------------------------------------------------

const enrichedServers: AcpMcpServer[] = [
	{
		name: "entwurf-bridge",
		command: "node",
		args: ["bridge.js"],
		env: [
			{ name: "PI_AGENT_ID", value: "entwurf/cortex-claude-sonnet-5" },
			{ name: "PI_SESSION_ID", value: "sess-1234" },
		],
	},
	{ name: "probe-mcp", command: "node", args: ["probe.js"], env: [{ name: "PROBE_FLAG", value: "1" }] },
];

{
	const root = mkdtempSync(join(tmpdir(), "entwurf-cortex-dualhome-"));
	const realHome = join(root, "real-home");
	const realSnowflake = join(realHome, ".snowflake");
	const overlaysRoot = join(root, "overlays");
	try {
		// Seed a fake operator ~/.snowflake — auth surfaces + operator state that
		// must stay hidden. config.toml is deliberately ABSENT (optional on the
		// measured host); credential_cache sits beside leak-prone cache siblings.
		const realCortexDir = join(realSnowflake, "cortex");
		mkdirSync(join(realCortexDir, "cache", "credential_cache"), { recursive: true });
		writeFileSync(join(realSnowflake, "connections.toml"), "[connections.dev]\naccount='x'\n", "utf8"); // AUTH
		writeFileSync(join(realCortexDir, "cache", "credential_cache", "token.json"), "{}\n", "utf8");
		mkdirSync(join(realCortexDir, "cache", "tool_outputs"), { recursive: true }); // operator work product — DENY
		writeFileSync(join(realCortexDir, "cache", "tip_history.json"), "{}\n", "utf8"); // DENY
		mkdirSync(join(realCortexDir, "skills"), { recursive: true }); // operator skills — DENY
		mkdirSync(join(realCortexDir, "conversations"), { recursive: true }); // operator transcripts — DENY
		writeFileSync(join(realCortexDir, "mcp.json"), '{"mcpServers":{"operator-ambient":{}}}\n', "utf8"); // DENY

		const overlay = ensureCortexDualHomeOverlay({
			scopeKey: "pi:sess-1234",
			mcpServers: enrichedServers,
			realHome,
			overlaysRoot,
			isPidAlive: () => true,
		});

		// Dual-HOME layout: HOME is overlay-owned; SNOWFLAKE_HOME sits INSIDE it,
		// so cortex's homedir() axis (CONFIG_DIRS, ~/.claude/skills) and its
		// snowflake axis are BOTH contained by one isolated home (D2).
		assert.equal(
			overlay.snowflakeHome,
			join(overlay.home, ".snowflake"),
			"SNOWFLAKE_HOME must sit inside the isolated HOME",
		);
		assert.ok(overlay.home.startsWith(overlaysRoot), "isolated HOME must live under the overlays root");
		const ovlCortex = join(overlay.snowflakeHome, "cortex");

		// Auth passthrough — connections.toml symlinked to the REAL file (never copied).
		const connLink = join(overlay.snowflakeHome, "connections.toml");
		assert.ok(lstatSync(connLink).isSymbolicLink(), "connections.toml must be a symlink (never a copy)");
		assert.equal(
			readlinkSync(connLink),
			join(realSnowflake, "connections.toml"),
			"connections.toml must point at the real file",
		);
		// config.toml is OPTIONAL — absent operator-side means absent overlay-side
		// (a dangling link would break cortex's TOML load).
		assert.ok(
			!existsSync(join(overlay.snowflakeHome, "config.toml")),
			"absent operator config.toml must not produce an overlay entry",
		);

		// D5/F — the measured-minimum auth surface: credential_cache alone rides
		// through; the whole `cache` is overlay-owned (a real dir), so operator
		// tool_outputs / tip_history never reach the child; skills and the
		// operator mcp.json are denied outright.
		assert.ok(
			!lstatSync(join(ovlCortex, "cache")).isSymbolicLink(),
			"cortex/cache must be overlay-owned (a real dir), NEVER a whole-cache symlink [QK:CORTEX-AUTH-NARROW-CREDENTIAL-CACHE]",
		);
		const credLink = join(ovlCortex, "cache", "credential_cache");
		assert.ok(
			lstatSync(credLink).isSymbolicLink() &&
				readlinkSync(credLink) === join(realCortexDir, "cache", "credential_cache"),
			"cortex/cache/credential_cache must symlink the real credential cache",
		);
		assert.ok(
			!existsSync(join(ovlCortex, "cache", "tool_outputs")) &&
				!existsSync(join(ovlCortex, "cache", "tip_history.json")),
			"operator cache work product (tool_outputs/tip_history) must be unreachable through the overlay",
		);
		assert.ok(!existsSync(join(ovlCortex, "skills")), "operator cortex/skills must be denied (no passthrough)");
		assert.ok(!existsSync(join(ovlCortex, "conversations")), "operator conversations must be denied");

		// D4 — the overlay authors autoUpdate:false (self-replacement off, not a pin).
		const settings = JSON.parse(readFileSync(join(ovlCortex, "settings.json"), "utf8"));
		assert.equal(
			settings.autoUpdate,
			false,
			"overlay cortex/settings.json must pin autoUpdate:false — launch-time self-update would swap the implementation mid-rail [QK:CORTEX-AUTOUPDATE-OFF]",
		);

		// D9 — the mcp.json projection IS the tool transport (cortex ignores the
		// wire mcpServers param). Exact-authored, operator entries never merged.
		const mcp = JSON.parse(readFileSync(join(ovlCortex, "mcp.json"), "utf8"));
		assert.deepEqual(
			Object.keys(mcp.mcpServers).sort(),
			["entwurf-bridge", "probe-mcp"],
			"mcp.json must carry EXACTLY the explicit servers (no ambient/operator merge)",
		);
		const bridgeEntry = mcp.mcpServers["entwurf-bridge"];
		assert.equal(bridgeEntry.type, "stdio", "projected entries must be stdio-typed");
		assert.deepEqual(bridgeEntry.args, ["bridge.js"], "projected args must be exact");
		assert.equal(bridgeEntry.env.PI_SESSION_ID, "sess-1234", "envelope PI_SESSION_ID must survive the projection");
		assert.equal(
			bridgeEntry.env.PI_AGENT_ID,
			"entwurf/cortex-claude-sonnet-5",
			"envelope PI_AGENT_ID must survive the projection",
		);
		// D10 — dual-HOME: the bridge child ALONE gets the real operator HOME
		// (garden store/socket axis); every other MCP child stays isolated.
		assert.equal(
			bridgeEntry.env.HOME,
			realHome,
			"the entwurf-bridge mcp.json entry must restore the REAL operator HOME (D10 dual-HOME) [QK:CORTEX-BRIDGE-DUAL-HOME]",
		);
		assert.equal(
			mcp.mcpServers["probe-mcp"].env.HOME,
			undefined,
			"a non-bridge MCP child must NOT receive the real HOME (isolation stays)",
		);
		assert.equal(mcp.mcpServers["probe-mcp"].env.PROBE_FLAG, "1", "declared server env must survive the projection");

		// D9 fail-loud — an entry the file cannot represent refuses the spawn
		// (silent drop would advertise a config the session does not have).
		assert.throws(
			() => projectCortexMcpJson([{ type: "http", name: "web-mcp", url: "https://x", headers: [] }], realHome),
			/cannot represent http/,
			"an http/sse server must fail loud BEFORE spawn — never silently dropped [QK:CORTEX-MCP-NON-STDIO-FAILLOUD]",
		);

		// config.toml present → linked (optional passthrough, positive half).
		writeFileSync(join(realSnowflake, "config.toml"), "default_connection_name='dev'\n", "utf8");
		const overlay2 = ensureCortexDualHomeOverlay({
			scopeKey: "pi:sess-1234",
			mcpServers: enrichedServers,
			realHome,
			overlaysRoot,
			isPidAlive: () => true,
		});
		assert.equal(overlay2.scopeDir, overlay.scopeDir, "same scope key must reuse the same scope dir");
		assert.ok(
			lstatSync(join(overlay2.snowflakeHome, "config.toml")).isSymbolicLink(),
			"present operator config.toml must be symlinked through",
		);

		// Session/child-scoped identity — two scope keys must NEVER share a dir
		// (a static shared overlay lets two residents overwrite one mcp.json).
		const overlayOther = ensureCortexDualHomeOverlay({
			scopeKey: "pi:sess-OTHER",
			mcpServers: enrichedServers,
			realHome,
			overlaysRoot,
			isPidAlive: () => true,
		});
		assert.notEqual(
			overlayOther.scopeDir,
			overlay.scopeDir,
			"different session keys must materialize DIFFERENT overlay dirs — a shared static overlay races envelopes/configs [QK:CORTEX-OVERLAY-SESSION-SCOPED]",
		);
		assert.ok(
			existsSync(join(overlay.snowflakeHome, "cortex", "mcp.json")),
			"materializing another session's overlay must not clobber a sibling scope dir",
		);

		// Exact rewrite — state a prior child wrote into the scope (conversations,
		// $HOME dotfiles) is discarded on the next spawn: memory containment.
		writeFileSync(join(overlay.snowflakeHome, "cortex", "leftover-conversation.json"), "{}\n", "utf8");
		mkdirSync(join(overlay.home, ".claude"), { recursive: true });
		const overlay3 = ensureCortexDualHomeOverlay({
			scopeKey: "pi:sess-1234",
			mcpServers: enrichedServers,
			realHome,
			overlaysRoot,
			isPidAlive: () => true,
		});
		assert.ok(
			!existsSync(join(overlay3.snowflakeHome, "cortex", "leftover-conversation.json")) &&
				!existsSync(join(overlay3.home, ".claude")),
			"a respawn must exact-rewrite the scope dir — prior child state (conversations/$HOME dotfiles) is contained, not inherited",
		);
		// …and the exact rewrite must not have followed auth symlinks (the real
		// credential cache survives its overlay link's deletion).
		assert.ok(
			existsSync(join(realCortexDir, "cache", "credential_cache", "token.json")),
			"exact rewrite must remove LINKS, never the real auth files behind them",
		);

		// Dead-pid sweep — a scope dir whose host process is gone is reclaimed
		// (process resources only); alive/foreign entries stay.
		const deadDir = join(overlaysRoot, cortexOverlayScopeId("pi:dead", 999_999));
		mkdirSync(deadDir, { recursive: true });
		const foreignDir = join(overlaysRoot, "not-a-scope-entry");
		mkdirSync(foreignDir, { recursive: true });
		sweepDeadCortexOverlays(overlaysRoot, (pid) => pid !== 999_999);
		assert.ok(!existsSync(deadDir), "a dead host pid's scope dir must be swept");
		assert.ok(existsSync(foreignDir), "entries off the scope-id grammar are never touched");
		assert.ok(existsSync(overlay3.scopeDir), "a live scope dir must survive the sweep");

		// realHome must be the parent-captured ABSOLUTE path (D10 recontract).
		assert.throws(
			() =>
				ensureCortexDualHomeOverlay({
					scopeKey: "pi:sess-rel",
					mcpServers: [],
					realHome: "relative/home",
					overlaysRoot,
					isPidAlive: () => true,
				}),
			/absolute realHome/,
			"a non-absolute realHome must refuse (the child must never re-derive it)",
		);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
}

// ---------------------------------------------------------------------------
// Layer A.3 — carrier-less augment (§9-4): the operator engraving override
// rides the FIRST-USER AUGMENT for cortex; claude (a carrier backend) never
// folds it in; no override → no engraving injected.
// ---------------------------------------------------------------------------

{
	const root = mkdtempSync(join(tmpdir(), "entwurf-cortex-augment-"));
	const engravingFile = join(root, "engraving.md");
	writeFileSync(engravingFile, "OPERATOR ENGRAVING backend={{backend}} mcp={{mcp_servers}}", "utf8");
	const savedEngravingEnv = process.env.ENTWURF_ACP_ENGRAVING_PATH;
	try {
		const augParams = { cwd: root, mcpServerNames: ["zebra", "alpha"], homeDir: root } as const;

		// (a) override set → cortex augment LEADS with the rendered engraving.
		process.env.ENTWURF_ACP_ENGRAVING_PATH = engravingFile;
		const cortexAug = buildPiContextAugment({ backend: "cortex", ...augParams });
		const rendered = "OPERATOR ENGRAVING backend=cortex mcp=alpha, zebra";
		assert.ok(
			cortexAug.startsWith(rendered),
			`carrier-less cortex augment must LEAD with the rendered operator engraving (got head: ${cortexAug.slice(0, 80)})`,
		);

		// (b) claude is a CARRIER backend → the override never enters its augment
		// (it rides claude's _meta.systemPrompt carrier via loadEngraving instead).
		const claudeAug = buildPiContextAugment({ backend: "claude", ...augParams });
		assert.ok(
			!claudeAug.includes("OPERATOR ENGRAVING"),
			"a carrier backend (claude) must NOT fold the operator engraving into its augment (it rides the _meta carrier)",
		);

		// (c) no override → the cortex augment carries NO engraving (the shipped
		// claude default is never injected into a carrier-less augment).
		delete process.env.ENTWURF_ACP_ENGRAVING_PATH;
		const cortexAugNoOverride = buildPiContextAugment({ backend: "cortex", ...augParams });
		assert.ok(
			!cortexAugNoOverride.includes("OPERATOR ENGRAVING"),
			"no override configured → carrier-less cortex augment carries no engraving (shipped default never injected)",
		);
		assert.ok(
			cortexAugNoOverride.includes("Backend: cortex."),
			"cortex augment still carries the bridge-identity section when no engraving override is set",
		);
	} finally {
		rmSync(root, { recursive: true, force: true });
		if (savedEngravingEnv === undefined) delete process.env.ENTWURF_ACP_ENGRAVING_PATH;
		else process.env.ENTWURF_ACP_ENGRAVING_PATH = savedEngravingEnv;
	}
}

// ---------------------------------------------------------------------------
// Layer B — adapter routing / launch / refusal / enforce (compiled artifact)
// ---------------------------------------------------------------------------

const TMP_EMIT = ".tmp-verify/acp-cortex";
rmSync(TMP_EMIT, { recursive: true, force: true });
// Sandbox + deterministic env axes for the whole compiled-layer run.
const savedHome = process.env.HOME;
const savedOverride = process.env.CORTEX_ACP_COMMAND;
const savedConnEnv = process.env.ENTWURF_ACP_CORTEX_CONNECTION;
const savedCortexHome = process.env.CORTEX_HOME;
const savedPiSessionId = process.env.PI_SESSION_ID;
delete process.env.CORTEX_ACP_COMMAND;
delete process.env.ENTWURF_ACP_CORTEX_CONNECTION;
delete process.env.CORTEX_HOME;
const sandboxHome = mkdtempSync(join(tmpdir(), "entwurf-cortex-adapter-home-"));
try {
	execFileSync("node_modules/.bin/tsc", ["--outDir", TMP_EMIT, "--rootDir", ".", "--noEmit", "false"], {
		stdio: "pipe",
	});
	// Point HOME at the sandbox BEFORE the compiled import: the module's
	// homedir()-derived roots (CORTEX_OVERLAYS_ROOT) bind at import time, so the
	// adapter's real ensureOverlay below writes ONLY under the sandbox
	// (Hard Rule 12 — offline verification never rewires the operator).
	process.env.HOME = sandboxHome;
	const adapterUrl = pathToFileURL(resolve(TMP_EMIT, "pi-extensions/lib/acp/backend-adapter.js")).href;
	const mod = (await import(adapterUrl)) as {
		cortexAdapter: {
			backend: string;
			routeModel: (id: string) => { nativeModelId: string } | undefined;
			resolveLaunch: (p: { cwd: string; modelId: string; nativeModelId: string; config: unknown }) => {
				command: string;
				args: string[];
			};
			ensureOverlay: (p: { cwd: string; modelId: string; nativeModelId: string; config: unknown }) => {
				envOverrides: Record<string, string>;
			};
			enforceModel: (p: {
				connection: unknown;
				acpSessionId: string;
				modelId: string;
				nativeModelId: string;
			}) => Promise<void>;
			configSignatureFields: (adapterSettings: unknown) => Record<string, unknown>;
		};
		resolveAcpBackendAdapter: (id: string) => { adapter: { backend: string }; nativeModelId: string };
		allCuratedModels: () => Array<{ id: string }>;
	};

	// (1) cortex curated models register through the real registry path —
	// allCuratedModels folds cortex rows in beside claude and self-validates that
	// every id routes to exactly one adapter (throws on 0/2+ matches). Its not
	// throwing IS the anti-collision proof; we also assert the rows are present.
	const registered = mod.allCuratedModels().map((m) => m.id);
	for (const want of [
		"claude-sonnet-5",
		"cortex-auto",
		"cortex-claude-opus-5",
		"cortex-claude-sonnet-5",
		"cortex-openai-gpt-5.4",
	]) {
		assert.ok(registered.includes(want), `allCuratedModels must register ${want} (got: ${registered.join(", ")})`);
	}

	// (2) the cortex- prefix routes to cortexAdapter; strip recovers the native id.
	const routedSonnet = mod.resolveAcpBackendAdapter("cortex-claude-sonnet-5");
	assert.equal(routedSonnet.adapter.backend, "cortex", "cortex-claude-sonnet-5 must route to the cortex adapter");
	assert.equal(routedSonnet.nativeModelId, "claude-sonnet-5", "prefix strip must recover the native model id");
	assert.equal(
		mod.resolveAcpBackendAdapter("claude-sonnet-5").adapter.backend,
		"claude",
		"the unprefixed claude id must still route to claude (prefix keeps the namespaces apart)",
	);
	assert.equal(
		mod.cortexAdapter.routeModel("claude-sonnet-5"),
		undefined,
		"cortex must NOT claim the unprefixed claude id",
	);

	// (3) resolveLaunch NEVER pins the model. set-model is the single model
	// authority (enforceModel below); a launch `-m` would be a second authority
	// that silently drifts from the per-turn enforcement.
	const launchSonnet = mod.cortexAdapter.resolveLaunch({
		cwd: process.cwd(),
		modelId: "cortex-claude-sonnet-5",
		nativeModelId: "claude-sonnet-5",
		config: { adapterSettings: { cortexConnection: null } },
	});
	assert.equal(launchSonnet.command, "cortex", "cortex launch command must be the `cortex` CLI (the ACP server)");
	assert.deepEqual(
		launchSonnet.args,
		["acp", "serve"],
		"cortex launch must be `acp serve` with NO -m — the model rides set-model, never a launch pin [QK:CORTEX-LAUNCH-NO-MODEL-PIN]",
	);

	// `-c <connection>` rides the resolved settings.
	const launchConn = mod.cortexAdapter.resolveLaunch({
		cwd: process.cwd(),
		modelId: "cortex-auto",
		nativeModelId: "auto",
		config: { adapterSettings: { cortexConnection: "XD00000" } },
	});
	assert.deepEqual(launchConn.args, ["acp", "serve", "-c", "XD00000"], "a pinned connection must ride -c");

	// (4) CORTEX_ACP_COMMAND override quoting — connection tokens with shell
	// metacharacters must be single-quoted into the `bash -lc` string.
	process.env.CORTEX_ACP_COMMAND = "my-cortex --debug";
	const launchOverride = mod.cortexAdapter.resolveLaunch({
		cwd: process.cwd(),
		modelId: "cortex-claude-sonnet-5",
		nativeModelId: "claude-sonnet-5",
		config: { adapterSettings: { cortexConnection: "danger; rm -rf" } },
	});
	assert.equal(launchOverride.command, "bash", "override path must run via bash");
	assert.equal(launchOverride.args[0], "-lc", "override path must use bash -lc");
	const overrideCmd = launchOverride.args[1];
	assert.ok(overrideCmd.startsWith("my-cortex --debug "), "override string must lead with the operator command");
	assert.ok(
		overrideCmd.includes("'danger; rm -rf'"),
		`override must single-quote the connection with metacharacters (got: ${overrideCmd})`,
	);
	assert.ok(!overrideCmd.includes("-m"), "the override path must not smuggle a -m model pin back in");
	// Single-quote inside a token is escaped as '\'' (POSIX-safe), never left bare.
	const launchQuote = mod.cortexAdapter.resolveLaunch({
		cwd: process.cwd(),
		modelId: "cortex-claude-sonnet-5",
		nativeModelId: "claude-sonnet-5",
		config: { adapterSettings: { cortexConnection: "o'brien" } },
	});
	assert.ok(
		launchQuote.args[1].includes(`'o'\\''brien'`),
		`override must POSIX-escape an embedded single quote (got: ${launchQuote.args[1]})`,
	);
	delete process.env.CORTEX_ACP_COMMAND;

	// (5) D3 — CORTEX_HOME ambient presence refuses the spawn, EMPTY STRING
	// INCLUDED: upstream's own resolver fallthroughs on empty while other
	// consumers treat set-but-empty as set; the adapter refuses the ambiguity.
	const overlayParams = {
		cwd: process.cwd(),
		modelId: "cortex-claude-sonnet-5",
		nativeModelId: "claude-sonnet-5",
		config: { mcpServers: enrichedServers, adapterSettings: { cortexConnection: null } },
	};
	process.env.CORTEX_HOME = "";
	assert.throws(
		() => mod.cortexAdapter.ensureOverlay(overlayParams),
		/CORTEX_HOME is present/,
		"an ambient CORTEX_HOME (even empty) must refuse the spawn — it bypasses SNOWFLAKE_HOME inside cortex [QK:CORTEX-HOME-PRESENCE-REFUSED]",
	);
	process.env.CORTEX_HOME = "/tmp/elsewhere";
	assert.throws(
		() => mod.cortexAdapter.ensureOverlay(overlayParams),
		/CORTEX_HOME is present/,
		"a set CORTEX_HOME must refuse the spawn",
	);
	delete process.env.CORTEX_HOME;

	// …and in the ambient-clean state the adapter materializes the session-scoped
	// overlay end to end: envOverrides carry the isolated HOME/SNOWFLAKE_HOME and
	// the projected mcp.json carries envelope + dual-HOME (all under the sandbox).
	process.env.PI_SESSION_ID = "gate-sess-42";
	const overlayResult = mod.cortexAdapter.ensureOverlay(overlayParams);
	const childHome = overlayResult.envOverrides.HOME;
	const childSnowflake = overlayResult.envOverrides.SNOWFLAKE_HOME;
	assert.ok(childHome && childSnowflake, "ensureOverlay must return HOME + SNOWFLAKE_HOME env overrides");
	assert.equal(
		childSnowflake,
		join(childHome, ".snowflake"),
		"SNOWFLAKE_HOME override must sit inside the HOME override",
	);
	assert.ok(
		childHome.startsWith(join(sandboxHome, ".pi", "agent", "cortex-overlays")),
		`the adapter overlay must land under <home>/.pi/agent/cortex-overlays (got: ${childHome})`,
	);
	const projected = JSON.parse(readFileSync(join(childSnowflake, "cortex", "mcp.json"), "utf8"));
	assert.equal(
		projected.mcpServers["entwurf-bridge"].env.PI_SESSION_ID,
		"gate-sess-42",
		"the adapter must envelope-enrich the projection with the live PI_SESSION_ID",
	);
	assert.equal(
		projected.mcpServers["entwurf-bridge"].env.PI_AGENT_ID,
		"entwurf/cortex-claude-sonnet-5",
		"the adapter must envelope-enrich the projection with PI_AGENT_ID = entwurf/<curated id>",
	);
	assert.equal(
		projected.mcpServers["entwurf-bridge"].env.HOME,
		sandboxHome,
		"the adapter must restore the parent-captured real HOME on the bridge entry (dual-HOME)",
	);
	delete process.env.PI_SESSION_ID;

	// (6) CP0-M — enforceModel sends the NATIVE id through the SAME wire call the
	// claude adapter makes (session/set_config_option, configId "model").
	const setCalls: Array<Record<string, unknown>> = [];
	await mod.cortexAdapter.enforceModel({
		connection: {
			setSessionConfigOption: async (p: Record<string, unknown>) => {
				setCalls.push(p);
			},
		},
		acpSessionId: "acp-1",
		modelId: "cortex-claude-sonnet-5",
		nativeModelId: "claude-sonnet-5",
	});
	assert.deepEqual(
		setCalls,
		[{ sessionId: "acp-1", configId: "model", value: "claude-sonnet-5" }],
		"cortex enforceModel must send the NATIVE id via session/set_config_option — the single model authority [QK:CORTEX-ENFORCE-SET-MODEL]",
	);
	await assert.rejects(
		mod.cortexAdapter.enforceModel({
			connection: {},
			acpSessionId: "acp-1",
			modelId: "cortex-auto",
			nativeModelId: "auto",
		}),
		/setSessionConfigOption unsupported/,
		"a connection without set_config_option must fail loud (a silent default would lie about the model)",
	);

	// (7) a connection change invalidates a reused session via the signature seam.
	assert.deepEqual(
		mod.cortexAdapter.configSignatureFields({ cortexConnection: "XD00000" }),
		{ cortexConnection: "XD00000" },
		"configSignatureFields must fold the connection id (reuse invalidation)",
	);
	assert.deepEqual(
		mod.cortexAdapter.configSignatureFields(undefined),
		{ cortexConnection: null },
		"no settings → null connection in the signature (stable shape)",
	);
} finally {
	rmSync(TMP_EMIT, { recursive: true, force: true });
	try {
		// The emit created `.tmp-verify/` as TMP_EMIT's parent. This gate runs inside
		// check-gate-qualification's PURITY-checked snapshot (the first tsc-emit gate
		// on a mutant lane), and the snapshot tree manifest walks ignored paths too —
		// a leftover empty parent dir reads as IMPURE drift. Remove it when empty;
		// a concurrent sibling gate's emit keeps it alive and the rmdir just fails.
		rmdirSync(".tmp-verify");
	} catch {
		// non-empty or already gone — fine either way
	}
	rmSync(sandboxHome, { recursive: true, force: true });
	if (savedHome === undefined) delete process.env.HOME;
	else process.env.HOME = savedHome;
	if (savedOverride === undefined) delete process.env.CORTEX_ACP_COMMAND;
	else process.env.CORTEX_ACP_COMMAND = savedOverride;
	if (savedConnEnv === undefined) delete process.env.ENTWURF_ACP_CORTEX_CONNECTION;
	else process.env.ENTWURF_ACP_CORTEX_CONNECTION = savedConnEnv;
	if (savedCortexHome === undefined) delete process.env.CORTEX_HOME;
	else process.env.CORTEX_HOME = savedCortexHome;
	if (savedPiSessionId === undefined) delete process.env.PI_SESSION_ID;
	else process.env.PI_SESSION_ID = savedPiSessionId;
}

console.log(
	`[check-acp-cortex] ok — 4-row curation (${cortexRowIds.join(", ")}) rides real registry bases and routes via the ` +
		`cortex- prefix; launch is \`cortex acp serve\` with NO -m (set-model is the single model authority, native id ` +
		`on the wire); CORTEX_HOME presence (empty included) refuses the spawn; the dual-HOME overlay isolates HOME + ` +
		`SNOWFLAKE_HOME per session, passes through only connections.toml/config.toml/credential_cache, authors ` +
		`autoUpdate:false, and projects the envelope-enriched explicit servers into cortex/mcp.json with the real HOME ` +
		`restored on entwurf-bridge alone (non-stdio fails loud); the carrier-less augment leads with the operator ` +
		`engraving override; CORTEX_ACP_COMMAND override single-quotes metachar tokens`,
);
