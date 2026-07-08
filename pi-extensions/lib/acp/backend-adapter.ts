// ACP backend adapter rail — the PRODUCT seam by which a curated model id selects
// which ACP backend (claude / future backend / …) drives a turn. See docs/acp-backend-rail.md §9.
//
// This seam is DISTINCT from `AcpTurnDeps` (backend.ts), which is the test/runtime
// seam (fake spawn/connection/clock for the gates). The two are kept apart on
// purpose (GPT-agreed §9-2): merging them would make a fake-deps fixture look like
// a fake backend and force the adapter to carry clock/sessionDir/createConnection.
// The wiring is `defaultDeps(adapter)` — the turn loop in backend.ts stays
// backend-invariant; only these per-backend functions change with `adapter`.
//
// STATUS: Step A+B done — backend.ts is wired to this rail. The turn loop in
// backend.ts delegates every per-backend step through the resolved adapter
// (resolveLaunch/ensureOverlay/loadCarrier/buildSessionMeta/enforceModel/
// launchEnvDefaults); there is no private resolveLaunch copy in backend.ts.
// `resolveClaudeLaunch` below is the single source for the claude launch spec.
//
// Fence: imported by the root program with `.js` suffixes, same as the sibling
// lib/acp modules — no new strip-types fence.

import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

import type { AcpConnectionLike } from "./acp-client.js";
import type { ResolvedAcpConfig } from "./config.js";
import { loadEngraving } from "./engraving.js";
import {
	CORTEX_MODEL_PREFIX,
	curatedClaudeModels,
	curatedCortexModels,
	SUPPORTED_ANTHROPIC_MODEL_IDS,
	SUPPORTED_CORTEX_MODEL_IDS,
} from "./models.js";
import {
	claudeLaunchEnvDefaults,
	cortexLaunchEnvDefaults,
	ensureClaudeConfigOverlay,
	ensureCortexConfigOverlay,
} from "./overlay.js";
import { buildClaudeSessionMeta } from "./tool-surface.js";

// POSIX-safe single-quote wrapper for shell arg interpolation. Byte-for-byte
// identical to the reference in entwurf-core.ts; PARITY-PINNED by
// scripts/check-shell-quote.ts (SOURCE_SITES). Used only by the cortex override
// path below, where operator-configured connection/model tokens are appended to
// an operator `bash -lc` string — quoting keeps a connection name with shell
// metacharacters from being reinterpreted by the shell.
function shellQuote(value: string): string {
	return `'${value.replace(/'/g, `'\\''`)}'`;
}

// ---------------------------------------------------------------------------
// Shared shapes
// ---------------------------------------------------------------------------

/** Launch spec for the ACP server child process. */
export interface AcpLaunchSpec {
	command: string;
	args: string[];
}

/** A curated provider model row (the shape pi.registerProvider({ models }) takes). */
export type AcpModelRow = ReturnType<typeof curatedClaudeModels>[number];

/** routeModel result — the backend-native model id with the curation prefix stripped. */
export interface AcpRoutedModel {
	nativeModelId: string;
}

/** resolveLaunch input — native (prefix-stripped) model id + resolved operator config. */
export interface AcpLaunchParams {
	cwd: string;
	modelId: string;
	nativeModelId: string;
	config: ResolvedAcpConfig;
}

/** loadCarrier input — the mcp server names plus the resolved config (so a backend
 *  whose carrier depends on its own `config.adapterSettings` can read it). backend.ts
 *  still never inspects config — it just passes it through. */
export interface AcpCarrierParams {
	mcpServerNames: string[];
	config: ResolvedAcpConfig;
}

/** ensureOverlay input — cwd + (native) model id + the resolved config. A backend
 *  whose overlay/env depends on its OWN settings reads them off `config.adapterSettings`
 *  here; backend.ts never inspects config. Same shape as AcpLaunchParams (overlay and
 *  launch are distinct phases, so they keep distinct names). */
export interface AcpOverlayParams {
	cwd: string;
	modelId: string;
	nativeModelId: string;
	config: ResolvedAcpConfig;
}

/** buildSessionMeta input — mirrors the newSession `_meta` inputs. */
export interface AcpSessionMetaParams {
	modelId: string;
	nativeModelId: string;
	config: ResolvedAcpConfig;
}

/** enforceModel input — the live connection + acp session + native id. */
export interface AcpEnforceModelParams {
	connection: AcpConnectionLike;
	acpSessionId: string;
	modelId: string;
	nativeModelId: string;
}

/** ensureOverlay result — env overrides backend.ts merges into the spawn env. */
export interface AcpOverlayResult {
	envOverrides: Record<string, string>;
}

/** resolveAdapterSettings input — the RAW (untyped) `entwurfProvider` blocks plus
 *  their file paths. This is the ONE seam by which a backend reads its OWN settings
 *  (e.g. a connection id, a profile/tenant, a state-home path) WITHOUT those
 *  backend-specific keys ever touching the common ResolvedAcpConfig (fat-bridge
 *  regression). `mergedBlock` is
 *  the project-over-global merge (project keys win); the per-file blocks + paths are
 *  for error attribution. A backend with no own settings returns `undefined`. */
export interface AcpAdapterSettingsParams {
	globalBlock: Record<string, unknown>;
	projectBlock: Record<string, unknown>;
	mergedBlock: Record<string, unknown>;
	globalPath: string;
	projectPath: string;
}

// ---------------------------------------------------------------------------
// The adapter interface
// ---------------------------------------------------------------------------

export interface AcpBackendAdapter {
	/** Discriminator. backend.ts stores this on BridgeSession/configSig so reuse
	 *  and diagnostics never re-parse the model-id string. */
	readonly backend: string;

	/** Does this adapter own `modelId`? If so, return the backend-native id (prefix
	 *  stripped); else undefined. Returning the native id here (vs a bare boolean)
	 *  keeps the registry from leaning on adapter order and gives resolveLaunch /
	 *  enforceModel the value they must actually send to the backend. */
	routeModel(modelId: string): AcpRoutedModel | undefined;

	/** Curated model rows this backend contributes to the single `entwurf` provider. */
	curatedModels(): AcpModelRow[];

	/** Parse this backend's OWN settings from the raw entwurfProvider blocks, returning
	 *  an opaque value config.ts stores on `ResolvedAcpConfig.adapterSettings`. backend.ts
	 *  NEVER inspects the result; only this adapter's other methods read it (casting their
	 *  own type back). A backend with no own settings returns `undefined`. This keeps the
	 *  common config free of backend-named fields (see AcpAdapterSettingsParams). */
	resolveAdapterSettings(params: AcpAdapterSettingsParams): unknown;

	/** Resolve the ACP server launch (command + args), honoring an env override. */
	resolveLaunch(params: AcpLaunchParams): AcpLaunchSpec;

	/** Static launch env defaults merged over process.env at spawn. */
	launchEnvDefaults(): Record<string, string>;

	/** Materialize the config overlay (auth passthrough + state hiding) and return
	 *  the env overrides to merge at spawn. A no-op backend returns { envOverrides: {} }.
	 *  Receives the resolved config so a settings-dependent overlay can read its own
	 *  `config.adapterSettings`; settings-derived spawn env rides the returned
	 *  `envOverrides` (launchEnvDefaults stays static). */
	ensureOverlay(params: AcpOverlayParams): AcpOverlayResult;

	/** Render the optional short operator carrier (engraving). Kept SEPARATE from
	 *  buildSessionMeta so backend.ts can load it ONCE and fold the same value into
	 *  both the config signature and the session meta (they must agree). A carrier-
	 *  less backend returns null WITHOUT calling loadEngraving, so it never trips the
	 *  shipped-engraving / appendSystemPrompt signature. */
	loadCarrier(params: AcpCarrierParams): string | null;

	/** Build the `_meta` handed to newSession. `undefined` → backend.ts omits the
	 *  `_meta` key entirely (carrier-less backend). Rich operator context rides the
	 *  first-user augment regardless, never this carrier. */
	buildSessionMeta(params: AcpSessionMetaParams, carrier: string | null): Record<string, unknown> | undefined;

	/** Enforce the requested model on the live ACP session. Single method absorbs
	 *  the per-backend difference (claude: per-turn session/set_config_option; a
	 *  launch-pinned backend: no-op here). backend.ts wraps the call in withTimeout. */
	enforceModel(params: AcpEnforceModelParams): Promise<void>;

	/** Backend-specific fields folded into bridgeConfigSignature (reuse invalidation):
	 *  connection/profile/env-derived STABLE ids only — never raw env values / secrets.
	 *  Reads ONLY this backend's opaque `adapterSettings` (NOT the whole config), so the
	 *  signature contract can never accidentally fold a common field. MUST be a flat,
	 *  sorted-stable primitive map (JSON.stringify determinism — no nested objects /
	 *  non-deterministic order). `backend` + `nativeModelId` are added by backend.ts. */
	configSignatureFields(adapterSettings: unknown): Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// claude adapter — the first implementation (the rail's reference backend)
// ---------------------------------------------------------------------------

const SUPPORTED_CLAUDE_IDS: ReadonlySet<string> = new Set(SUPPORTED_ANTHROPIC_MODEL_IDS);

/** Resolve the claude-agent-acp launch — package bin (resolve), env override for debug.
 *  This is the single source for the claude launch spec; backend.ts holds no private copy. */
function resolveClaudeLaunch(): AcpLaunchSpec {
	const override = process.env.CLAUDE_AGENT_ACP_COMMAND?.trim();
	if (override) return { command: "bash", args: ["-lc", override] };
	const require = createRequire(import.meta.url);
	const pkgJsonPath = require.resolve("@agentclientprotocol/claude-agent-acp/package.json");
	const pkgJson = JSON.parse(readFileSync(pkgJsonPath, "utf8")) as { bin?: string | Record<string, string> };
	const binPath = typeof pkgJson.bin === "string" ? pkgJson.bin : pkgJson.bin?.["claude-agent-acp"];
	if (!binPath) throw new Error("@agentclientprotocol/claude-agent-acp resolved but exposes no bin entry");
	return { command: process.execPath, args: [join(dirname(pkgJsonPath), binPath)] };
}

export const claudeAdapter: AcpBackendAdapter = {
	backend: "claude",

	// Claude owns its UNPREFIXED curated ids only (GPT-agreed §9-1). The native id
	// equals the curated id — claude carries no curation prefix to strip.
	routeModel(modelId) {
		return SUPPORTED_CLAUDE_IDS.has(modelId) ? { nativeModelId: modelId } : undefined;
	},

	curatedModels() {
		return curatedClaudeModels();
	},

	// Claude carries no backend-specific settings — its entire surface is common
	// config (tools/permissions/settingSources/…). undefined → config.adapterSettings
	// is undefined and no claude method reads it.
	resolveAdapterSettings() {
		return undefined;
	},

	resolveLaunch() {
		return resolveClaudeLaunch();
	},

	launchEnvDefaults() {
		return claudeLaunchEnvDefaults();
	},

	ensureOverlay() {
		// Claude's overlay is constant (no settings dependence), so it ignores params.
		ensureClaudeConfigOverlay();
		// CLAUDE_CONFIG_DIR rides launchEnvDefaults(); the overlay materialization
		// itself contributes no extra spawn env.
		return { envOverrides: {} };
	},

	loadCarrier({ mcpServerNames }) {
		// Claude's carrier is the shipped engraving — it does not read config.
		return loadEngraving({ backend: "claude", mcpServerNames });
	},

	buildSessionMeta({ nativeModelId, config }, carrier) {
		// buildClaudeSessionMeta always returns an object (it only omits the
		// systemPrompt KEY when carrier is absent), so claude never yields undefined.
		return buildClaudeSessionMeta(
			{
				modelId: nativeModelId,
				tools: config.tools,
				permissionAllow: config.permissionAllow,
				disallowedTools: config.disallowedTools,
				settingSources: config.settingSources,
				strictMcpConfig: config.strictMcpConfig,
				skillPlugins: config.skillPlugins,
			},
			carrier ?? undefined,
		);
	},

	async enforceModel({ connection, acpSessionId, nativeModelId, modelId }) {
		const setConfig = connection.setSessionConfigOption;
		if (typeof setConfig !== "function") {
			throw new Error(`setSessionConfigOption unsupported — cannot enforce model ${modelId}`);
		}
		await setConfig.call(connection, { sessionId: acpSessionId, configId: "model", value: nativeModelId });
	},

	configSignatureFields(_adapterSettings) {
		// Claude folds no extra backend-specific fields beyond backend + nativeModelId
		// (which backend.ts adds). A future backend reads its own stable id off
		// `_adapterSettings` here.
		return {};
	},
};

// ---------------------------------------------------------------------------
// Registry — modelId → adapter
// ---------------------------------------------------------------------------

/** Registered adapters. Order carries NO routing authority — routeModel decides.
 *  claude (unprefixed ids) + cortex (the `cortex-` prefix). A further backend
 *  appends here with its own reserved prefix; the fail-fast below proves no two
 *  adapters claim one id. */
// ---------------------------------------------------------------------------
// cortex adapter — Snowflake Cortex Code, the first non-claude backend on the
// rail (docs/acp-backend-rail.md §4/§6). It adds ZERO to the common layer:
// everything cortex-specific lives here + models.ts + overlay.ts + the gates.
// ---------------------------------------------------------------------------

const SUPPORTED_CORTEX_IDS: ReadonlySet<string> = new Set(SUPPORTED_CORTEX_MODEL_IDS);

/** Cortex's OWN settings (§10 B): a Snowflake connection name, or null. Opaque to
 *  config.ts / backend.ts — only cortexAdapter reads it (casting back). */
export interface CortexAdapterSettings {
	cortexConnection: string | null;
}

/** The env var an operator sets to pin a Snowflake connection per-shell without
 *  editing settings.json. Wins over `entwurfProvider.cortexConnection`. The
 *  ENTWURF_ACP_* convention (PR #40's legacy PI_SHELL_ACP* cortex-connection var renamed). */
export const CORTEX_CONNECTION_ENV = "ENTWURF_ACP_CORTEX_CONNECTION";

export const cortexAdapter: AcpBackendAdapter = {
	backend: "cortex",

	// Cortex owns the reserved `cortex-` prefix (§9-1). routeModel strips it to the
	// native id: `cortex-auto` → "auto", `cortex-claude-sonnet-4-6` → "claude-sonnet-4-6".
	routeModel(modelId) {
		if (!SUPPORTED_CORTEX_IDS.has(modelId)) return undefined;
		return { nativeModelId: modelId.slice(CORTEX_MODEL_PREFIX.length) };
	},

	curatedModels() {
		return curatedCortexModels();
	},

	// Cortex's ONLY own setting is the connection name. env override wins over
	// settings (per-shell pin); empty/whitespace → null (Cortex falls back to its
	// own default connection). A non-string settings value fails loud.
	resolveAdapterSettings({ mergedBlock, projectBlock, globalPath, projectPath }): CortexAdapterSettings {
		const raw = mergedBlock.cortexConnection;
		if (raw !== undefined && typeof raw !== "string") {
			const offending = projectBlock.cortexConnection !== undefined ? projectPath : globalPath;
			throw new Error(`${offending}: invalid entwurfProvider settings: cortexConnection must be a string`);
		}
		const envConn = process.env[CORTEX_CONNECTION_ENV]?.trim();
		const settingsConn = raw?.trim();
		const cortexConnection = envConn || settingsConn || null;
		return { cortexConnection };
	},

	// `cortex acp serve` resolved from PATH (the CLI itself IS the ACP server — no
	// `*-acp` npm package, unlike claude). `-c <conn>` / `-m <native>` appended;
	// `auto` emits no `-m` (Cortex picks its own default). CORTEX_ACP_COMMAND
	// override runs via `bash -lc` with the selection flags appended so the
	// bridge's choice wins (later yargs args override earlier ones).
	resolveLaunch({ nativeModelId, config }) {
		const settings = config.adapterSettings as CortexAdapterSettings | undefined;
		const connection = settings?.cortexConnection?.trim() || undefined;
		const nativeModel = nativeModelId && nativeModelId !== "auto" ? nativeModelId : undefined;
		const selectionArgs: string[] = [];
		if (connection) selectionArgs.push("-c", connection);
		if (nativeModel) selectionArgs.push("-m", nativeModel);
		const override = process.env.CORTEX_ACP_COMMAND?.trim();
		if (override) {
			const command = selectionArgs.length > 0 ? `${override} ${selectionArgs.map(shellQuote).join(" ")}` : override;
			return { command: "bash", args: ["-lc", command] };
		}
		return { command: "cortex", args: ["acp", "serve", ...selectionArgs] };
	},

	launchEnvDefaults() {
		return cortexLaunchEnvDefaults();
	},

	ensureOverlay() {
		// SNOWFLAKE_HOME rides launchEnvDefaults(); the overlay materialization
		// contributes no extra spawn env (mirrors claude's CLAUDE_CONFIG_DIR shape).
		ensureCortexConfigOverlay();
		return { envOverrides: {} };
	},

	// Carrier-less (§9-4): Cortex ACP exposes no `_meta.systemPrompt` and has no
	// developer_instructions / GEMINI_SYSTEM_MD equivalent. loadCarrier returns
	// null WITHOUT calling loadEngraving, so the cortex turn never touches the
	// shipped-engraving / appendSystemPrompt signature; buildSessionMeta returns
	// undefined so backend.ts omits the `_meta` key entirely. The operator
	// engraving instead rides the first-user augment (augment.ts).
	loadCarrier() {
		return null;
	},

	buildSessionMeta() {
		return undefined;
	},

	// Launch-pinned: the native model is fixed by `cortex acp serve -m` at spawn.
	// Cortex exposes its model surface via session config options keyed by
	// cortex-native ids, NOT the spec-baseline set-model the bridge calls for
	// claude — and it would reject the pi-prefixed curated id. No-op here (§9-6).
	async enforceModel() {
		return;
	},

	// A connection change must invalidate a reused session (§4/§7). Flat,
	// sorted-stable primitive map; reads ONLY the opaque adapterSettings. `backend`
	// + `nativeModelId` are added by backend.ts.
	configSignatureFields(adapterSettings) {
		const settings = adapterSettings as CortexAdapterSettings | undefined;
		return { cortexConnection: settings?.cortexConnection ?? null };
	},
};

const ADAPTERS: readonly AcpBackendAdapter[] = [claudeAdapter, cortexAdapter];

/**
 * Resolve the backend adapter that owns `modelId`.
 *
 * GPT-agreed §9-1 fail-fast contract:
 *  - 0 matches  → throw (unknown model — no silent default).
 *  - 2+ matches → throw (prefix collision — a startup-visible registry bug).
 *
 * The thrown native id is recovered from the single matching adapter's routeModel,
 * so callers get `{ adapter, nativeModelId }` and never re-parse the id string.
 */
export function resolveAcpBackendAdapter(modelId: string): { adapter: AcpBackendAdapter; nativeModelId: string } {
	const matches: Array<{ adapter: AcpBackendAdapter; nativeModelId: string }> = [];
	for (const adapter of ADAPTERS) {
		const routed = adapter.routeModel(modelId);
		if (routed) matches.push({ adapter, nativeModelId: routed.nativeModelId });
	}
	if (matches.length === 0) {
		throw new Error(`entwurf: no ACP backend adapter owns model id ${JSON.stringify(modelId)}`);
	}
	if (matches.length > 1) {
		const owners = matches.map((m) => m.adapter.backend).join(", ");
		throw new Error(`entwurf: model id ${JSON.stringify(modelId)} is claimed by multiple adapters (${owners})`);
	}
	return matches[0];
}

/** Every curated model row across all registered adapters — for provider registration.
 *  GPT-agreed §9-6 registration-time fail-fast: every curated id must route to EXACTLY
 *  one adapter and no id may be duplicated across adapters. Catching it here means a
 *  prefix-collision / duplicate surfaces at provider registration, not mid-turn. */
export function allCuratedModels(): AcpModelRow[] {
	const rows = ADAPTERS.flatMap((adapter) => adapter.curatedModels());
	const seen = new Set<string>();
	for (const row of rows) {
		if (seen.has(row.id)) {
			throw new Error(`entwurf: duplicate curated model id across ACP backend adapters: ${row.id}`);
		}
		seen.add(row.id);
		// Throws on 0 matches (unowned) or 2+ matches (prefix collision).
		resolveAcpBackendAdapter(row.id);
	}
	return rows;
}
