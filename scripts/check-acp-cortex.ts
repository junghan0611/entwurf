// Deterministic gate for the Cortex (Snowflake Cortex Code) ACP backend — the
// first non-claude adapter on the rail (docs/acp-backend-rail.md §4/§6/§9). The
// cortex source landed as one `cortexAdapter` object in backend-adapter.ts +
// its curated surface in models.ts + its config overlay in overlay.ts; the
// 결합 규칙 requires the gate to land WITH it. §6 said EXTEND the same
// `check-acp-*` family, so cortex's whole deterministic axis lives here rather
// than being smeared across the claude-focused gates.
//
// Covered (the port spec's assertion list):
//   1. cortex curated models register through the REAL registry path —
//      allCuratedModels() (compiled backend-adapter.js) folds the cortex rows in
//      alongside claude WITHOUT throwing, i.e. every cortex id routes to exactly
//      one adapter and collides with none;
//   2. the `cortex-` prefix routes to cortexAdapter (routeModel / the resolver);
//   3. prefix-strip recovers the native `-m` (cortex-claude-sonnet-4-6 → claude-sonnet-4-6)
//      and resolveLaunch emits `-m <native>`;
//   4. cortex-auto yields NO `-m` (Cortex picks its own default);
//   5. overlay auth-through — connections.toml / config.toml / credential cache
//      symlinked (never copied), operator state hidden, launch env redirects
//      SNOWFLAKE_HOME (Hard Rule #8: no cred copy/proxy);
//   6. CORTEX_ACP_COMMAND override quoting — operator connection/model tokens
//      with shell metacharacters are single-quoted into the `bash -lc` string.
//   7. carrier-less augment (§9-4) — cortex has no `_meta.systemPrompt`, so the
//      operator engraving OVERRIDE rides the first-user augment: it LEADS the
//      cortex augment with {{backend}}/{{mcp_servers}} substituted, a carrier
//      backend (claude) never folds it in, and no-override → no engraving in the
//      augment (the shipped claude default is never injected).
//
// Two layers, mirroring the family convention:
//   - Layer A (direct strip-types imports): models.ts + overlay.ts + augment.ts
//     are strip-types-safe (node builtins / @earendil-works/pi-ai/compat).
//   - Layer B (compiled backend-adapter.js): backend-adapter.ts imports its
//     siblings with `.js` suffixes, which plain strip-types can't resolve — so
//     we tsc-emit the project to a temp dir and import the compiled artifact
//     (same resolution as check-acp-provider-surface / -session-reuse).

import { strict as assert } from "node:assert";
import { execFileSync } from "node:child_process";
import { lstatSync, mkdirSync, mkdtempSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { buildPiContextAugment } from "../pi-extensions/lib/acp/augment.ts";
import {
	CORTEX_MODEL_PREFIX,
	curatedClaudeModels,
	curatedCortexModels,
	SUPPORTED_CORTEX_MODEL_IDS,
} from "../pi-extensions/lib/acp/models.ts";
import { cortexLaunchEnvDefaults, ensureCortexConfigOverlay } from "../pi-extensions/lib/acp/overlay.ts";

// ---------------------------------------------------------------------------
// Layer A.1 — curated cortex surface (models.ts, real registry-derived)
// ---------------------------------------------------------------------------

assert.equal(CORTEX_MODEL_PREFIX, "cortex-", "cortex model prefix (routing authority) drifted");
assert.deepEqual(
	[...SUPPORTED_CORTEX_MODEL_IDS],
	["cortex-auto", "cortex-claude-opus-4-6", "cortex-claude-haiku-4-5", "cortex-claude-sonnet-4-6", "cortex-openai-gpt-5.2"],
	"supported cortex model id set drifted",
);
for (const id of SUPPORTED_CORTEX_MODEL_IDS) {
	assert.ok(id.startsWith(CORTEX_MODEL_PREFIX), `cortex id ${id} must carry the reserved cortex- prefix`);
}

const cortexRows = curatedCortexModels();
const cortexRowIds = cortexRows.map((m) => m.id);
assert.deepEqual(cortexRowIds, [...SUPPORTED_CORTEX_MODEL_IDS], "curated cortex rows must match the supported id set");
// The rows are derived from the claude-sonnet-5 registry entry (Cortex's default
// family is Claude): reasoning/cost/maxTokens ride the real registry base, so a
// fabricated/hardcoded row would drift from it. This proves the "real registry
// path" (curatedCortexModels calls requireRegistryModel → pi-ai catalog).
const claudeBase = curatedClaudeModels().find((m) => m.id === "claude-sonnet-5");
assert.ok(claudeBase, "test premise: claude-sonnet-5 present in curated claude surface");
for (const row of cortexRows) {
	assert.equal(
		row.maxTokens,
		claudeBase.maxTokens,
		`${row.id} maxTokens must ride the registry base (real registry path)`,
	);
	assert.deepEqual(row.cost, claudeBase.cost, `${row.id} cost must ride the registry base`);
	assert.equal(row.reasoning, claudeBase.reasoning, `${row.id} reasoning must ride the registry base`);
	assert.ok(row.contextWindow > 0, `${row.id} contextWindow must be positive`);
}

// ---------------------------------------------------------------------------
// Layer A.2 — cortex config overlay auth-through (overlay.ts, temp dirs)
// ---------------------------------------------------------------------------

{
	const root = mkdtempSync(join(tmpdir(), "entwurf-cortex-overlay-"));
	const realHome = join(root, "real-snowflake");
	const overlayHome = join(root, "overlay");
	const overlayCortexDir = join(overlayHome, "cortex");
	try {
		// Seed a fake operator ~/.snowflake — auth surfaces + operator state.
		mkdirSync(realHome, { recursive: true });
		writeFileSync(join(realHome, "connections.toml"), "[connections.dev]\naccount='x'\n", "utf8"); // AUTH
		writeFileSync(join(realHome, "config.toml"), "default_connection_name='dev'\n", "utf8");
		const realCortexDir = join(realHome, "cortex");
		mkdirSync(join(realCortexDir, "cache"), { recursive: true }); // AUTH token cache
		mkdirSync(join(realCortexDir, "skills"), { recursive: true });
		mkdirSync(join(realCortexDir, "conversations"), { recursive: true }); // operator state — hidden
		mkdirSync(join(realCortexDir, "memory"), { recursive: true }); // operator state — hidden
		writeFileSync(join(realCortexDir, "mcp.json"), '{"mcpServers":{}}\n', "utf8"); // operator state — hidden

		// Pre-seed a STALE symlink to operator state (a migration artifact): mcp.json
		// linked through must be torn down.
		mkdirSync(overlayCortexDir, { recursive: true });
		symlinkSync(join(realCortexDir, "mcp.json"), join(overlayCortexDir, "mcp.json"));

		ensureCortexConfigOverlay(realHome, overlayHome, overlayCortexDir);

		// Auth passthrough — symlinks pointing at the REAL operator files, never copies.
		for (const [entry, base, real] of [
			["connections.toml", overlayHome, realHome],
			["config.toml", overlayHome, realHome],
			["cache", overlayCortexDir, realCortexDir],
			["skills", overlayCortexDir, realCortexDir],
		] as const) {
			const overlayPath = join(base, entry);
			const st = lstatSync(overlayPath);
			assert.ok(st.isSymbolicLink(), `cortex overlay ${entry} must be a symlink (auth-through, not a copy)`);
			assert.equal(
				readlinkSync(overlayPath),
				join(real, entry),
				`cortex overlay ${entry} must point at the operator's real path (no credential copy)`,
			);
		}

		// Hard Rule #8: connections.toml is passed through as a LINK, never materialized
		// as a regular file the bridge authored (that would be a credential copy).
		assert.ok(
			!lstatSync(join(overlayHome, "connections.toml")).isFile() ||
				lstatSync(join(overlayHome, "connections.toml")).isSymbolicLink(),
			"connections.toml must not be a bridge-authored regular file (no credential copy/proxy)",
		);

		// Operator state swept into overlay-private empty real dirs (not symlinks).
		for (const entry of ["conversations", "memory", "profiles", "logs"]) {
			const st = lstatSync(join(overlayCortexDir, entry));
			assert.ok(
				st.isDirectory() && !st.isSymbolicLink(),
				`cortex overlay ${entry} must be an overlay-private real dir (operator state not read)`,
			);
		}

		// Stale operator-state symlink (mcp.json) torn down — operator MCP config hidden.
		assert.throws(
			() => lstatSync(join(overlayCortexDir, "mcp.json")),
			"stale mcp.json symlink to operator state must be removed (operator MCP config hidden)",
		);

		// Launch env redirects the Snowflake home + pins profile auto-apply OFF.
		assert.deepEqual(
			cortexLaunchEnvDefaults(overlayHome),
			{ SNOWFLAKE_HOME: overlayHome, CORTEX_DISABLE_AUTO_APPLY_PROFILES: "1" },
			"cortexLaunchEnvDefaults must redirect SNOWFLAKE_HOME + disable profile auto-apply",
		);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
}

// ---------------------------------------------------------------------------
// Layer A.3 — carrier-less augment (augment.ts, temp engraving file)
// ---------------------------------------------------------------------------
//
// Cortex is carrier-less: loadCarrier()→null / buildSessionMeta()→undefined
// (§9-4), so the operator engraving must ride the FIRST-USER augment instead of
// a `_meta.systemPrompt`. This is the one genuinely new cortex behavior and it
// shipped in augment.ts (CARRIER_LESS_BACKENDS + loadCarrierlessOperatorEngraving);
// the 결합 규칙 (source + gate land together) puts its deterministic assertion
// HERE, on the cortex axis. Locks: (a) an operator engraving OVERRIDE
// (ENTWURF_ACP_ENGRAVING_PATH) LEADS the cortex augment with {{backend}} /
// {{mcp_servers}} substituted; (b) claude (a carrier backend) NEVER folds that
// override into its augment (the override rides the claude _meta carrier, not the
// augment); (c) no override configured → the cortex augment carries NO engraving
// (the shipped claude default is never injected into a carrier-less augment).
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
// Layer B — adapter routing / launch (compiled backend-adapter.js)
// ---------------------------------------------------------------------------

const TMP_EMIT = ".tmp-verify/acp-cortex";
rmSync(TMP_EMIT, { recursive: true, force: true });
// Keep the cortex-specific env axes deterministic across the run.
const savedOverride = process.env.CORTEX_ACP_COMMAND;
const savedConnEnv = process.env.ENTWURF_ACP_CORTEX_CONNECTION;
delete process.env.CORTEX_ACP_COMMAND;
delete process.env.ENTWURF_ACP_CORTEX_CONNECTION;
try {
	execFileSync("node_modules/.bin/tsc", ["--outDir", TMP_EMIT, "--rootDir", ".", "--noEmit", "false"], {
		stdio: "pipe",
	});
	const adapterUrl = pathToFileURL(resolve(TMP_EMIT, "pi-extensions/lib/acp/backend-adapter.js")).href;
	const mod = (await import(adapterUrl)) as {
		cortexAdapter: {
			backend: string;
			routeModel: (id: string) => { nativeModelId: string } | undefined;
			resolveLaunch: (p: { cwd: string; modelId: string; nativeModelId: string; config: unknown }) => {
				command: string;
				args: string[];
			};
		};
		resolveAcpBackendAdapter: (id: string) => { adapter: { backend: string }; nativeModelId: string };
		allCuratedModels: () => Array<{ id: string }>;
	};

	// (1) cortex curated models register through the real registry path —
	// allCuratedModels folds cortex rows in beside claude and self-validates that
	// every id routes to exactly one adapter (throws on 0/2+ matches). Its not
	// throwing IS the registration proof; we also assert the rows are present.
	const registered = mod.allCuratedModels().map((m) => m.id);
	for (const want of ["claude-sonnet-5", "cortex-auto", "cortex-claude-sonnet-4-6"]) {
		assert.ok(registered.includes(want), `allCuratedModels must register ${want} (got: ${registered.join(", ")})`);
	}

	// (2) the cortex- prefix routes to cortexAdapter (via the shared resolver).
	const routedSonnet = mod.resolveAcpBackendAdapter("cortex-claude-sonnet-4-6");
	assert.equal(routedSonnet.adapter.backend, "cortex", "cortex-claude-sonnet-4-6 must route to the cortex adapter");
	// (3) prefix-strip recovers the native -m.
	assert.equal(routedSonnet.nativeModelId, "claude-sonnet-4-6", "prefix strip must recover the native model id");
	assert.equal(
		mod.cortexAdapter.routeModel("cortex-claude-sonnet-4-6")?.nativeModelId,
		"claude-sonnet-4-6",
		"cortexAdapter.routeModel must strip the prefix",
	);
	assert.equal(
		mod.cortexAdapter.routeModel("claude-sonnet-5"),
		undefined,
		"cortex must NOT claim the unprefixed claude id",
	);

	// resolveLaunch emits `cortex acp serve -m <native>` for a concrete model.
	const launchSonnet = mod.cortexAdapter.resolveLaunch({
		cwd: process.cwd(),
		modelId: "cortex-claude-sonnet-4-6",
		nativeModelId: "claude-sonnet-4-6",
		config: { adapterSettings: { cortexConnection: null } },
	});
	assert.equal(launchSonnet.command, "cortex", "cortex launch command must be the `cortex` CLI (the ACP server)");
	assert.deepEqual(
		launchSonnet.args,
		["acp", "serve", "-m", "claude-sonnet-4-6"],
		"cortex launch must emit `acp serve -m <native>` for a concrete model",
	);

	// (4) cortex-auto → native "auto" → NO `-m` (Cortex picks its own default).
	const routedAuto = mod.resolveAcpBackendAdapter("cortex-auto");
	assert.equal(routedAuto.adapter.backend, "cortex", "cortex-auto must route to the cortex adapter");
	assert.equal(routedAuto.nativeModelId, "auto", "cortex-auto native id must be `auto`");
	const launchAuto = mod.cortexAdapter.resolveLaunch({
		cwd: process.cwd(),
		modelId: "cortex-auto",
		nativeModelId: "auto",
		config: { adapterSettings: { cortexConnection: null } },
	});
	assert.deepEqual(launchAuto.args, ["acp", "serve"], "cortex-auto must emit NO -m (backend default)");
	assert.ok(!launchAuto.args.includes("-m"), "cortex-auto must not pass -m");

	// (6) CORTEX_ACP_COMMAND override quoting — connection/model tokens with shell
	// metacharacters must be single-quoted into the `bash -lc` string so they
	// cannot be reinterpreted by the shell.
	process.env.CORTEX_ACP_COMMAND = "my-cortex --debug";
	const launchOverride = mod.cortexAdapter.resolveLaunch({
		cwd: process.cwd(),
		modelId: "cortex-claude-sonnet-4-6",
		nativeModelId: "claude-sonnet-4-6",
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
	assert.ok(
		overrideCmd.includes("'-m'") && overrideCmd.includes("'claude-sonnet-4-6'"),
		"override must append quoted selection flags",
	);
	// Single-quote inside a token is escaped as '\'' (POSIX-safe), never left bare.
	const launchQuote = mod.cortexAdapter.resolveLaunch({
		cwd: process.cwd(),
		modelId: "cortex-claude-sonnet-4-6",
		nativeModelId: "claude-sonnet-4-6",
		config: { adapterSettings: { cortexConnection: "o'brien" } },
	});
	assert.ok(
		launchQuote.args[1].includes(`'o'\\''brien'`),
		`override must POSIX-escape an embedded single quote (got: ${launchQuote.args[1]})`,
	);
} finally {
	rmSync(TMP_EMIT, { recursive: true, force: true });
	if (savedOverride === undefined) delete process.env.CORTEX_ACP_COMMAND;
	else process.env.CORTEX_ACP_COMMAND = savedOverride;
	if (savedConnEnv === undefined) delete process.env.ENTWURF_ACP_CORTEX_CONNECTION;
	else process.env.ENTWURF_ACP_CORTEX_CONNECTION = savedConnEnv;
}

console.log(
	`[check-acp-cortex] ok — cortex curated rows (${cortexRowIds.join(", ")}) register through the real registry path; ` +
		`the cortex- prefix routes to cortexAdapter, prefix-strip recovers the native -m (cortex-auto → no -m); ` +
		`the config overlay symlinks auth (connections/config/cache/skills) through without copying and hides operator ` +
		`state; the carrier-less cortex augment leads with the operator engraving override (claude never does) and ` +
		`carries none when unset; CORTEX_ACP_COMMAND override single-quotes connection/model tokens`,
);
