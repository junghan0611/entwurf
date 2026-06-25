// ACP backend adapter rail — the PRODUCT seam by which a curated model id selects
// which ACP backend (claude / cortex / …) drives a turn. See docs/acp-backend-rail.md §9.
//
// This seam is DISTINCT from `AcpTurnDeps` (backend.ts), which is the test/runtime
// seam (fake spawn/connection/clock for the gates). The two are kept apart on
// purpose (GPT-agreed §9-2): merging them would make a fake-deps fixture look like
// a fake backend and force the adapter to carry clock/sessionDir/createConnection.
// The wiring is `defaultDeps(adapter)` — the turn loop in backend.ts stays
// backend-invariant; only these per-backend functions change with `adapter`.
//
// STATUS: Step A of the rail — interface + claudeAdapter + registry. backend.ts is
// not wired to it yet (Step B). `resolveClaudeLaunch` below intentionally mirrors
// backend.ts:resolveLaunch for now; Step B removes the backend.ts private copy and
// keeps only this adapter method (single source).
//
// Fence: imported by the root program with `.js` suffixes, same as the sibling
// lib/acp modules — no new strip-types fence.

import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

import type { AcpConnectionLike } from "./acp-client.js";
import type { ResolvedAcpConfig } from "./config.js";
import { loadEngraving } from "./engraving.js";
import { curatedClaudeModels, SUPPORTED_ANTHROPIC_MODEL_IDS } from "./models.js";
import { claudeLaunchEnvDefaults, ensureClaudeConfigOverlay } from "./overlay.js";
import { buildClaudeSessionMeta } from "./tool-surface.js";

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

/** loadCarrier input — enough to render the (optional) operator engraving carrier. */
export interface AcpCarrierParams {
	mcpServerNames: string[];
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

	/** Resolve the ACP server launch (command + args), honoring an env override. */
	resolveLaunch(params: AcpLaunchParams): AcpLaunchSpec;

	/** Static launch env defaults merged over process.env at spawn. */
	launchEnvDefaults(): Record<string, string>;

	/** Materialize the config overlay (auth passthrough + state hiding) and return
	 *  the env overrides to merge at spawn. A no-op backend returns { envOverrides: {} }. */
	ensureOverlay(): AcpOverlayResult;

	/** Render the optional short operator carrier (engraving). Kept SEPARATE from
	 *  buildSessionMeta so backend.ts can load it ONCE and fold the same value into
	 *  both the config signature and the session meta (they must agree). A carrier-
	 *  less backend (e.g. cortex) returns null WITHOUT calling loadEngraving, so it
	 *  never trips the shipped-engraving / appendSystemPrompt signature. */
	loadCarrier(params: AcpCarrierParams): string | null;

	/** Build the `_meta` handed to newSession. `undefined` → backend.ts omits the
	 *  `_meta` key entirely (carrier-less backend). Rich operator context rides the
	 *  first-user augment regardless, never this carrier. */
	buildSessionMeta(params: AcpSessionMetaParams, carrier: string | null): Record<string, unknown> | undefined;

	/** Enforce the requested model on the live ACP session. Single method absorbs
	 *  the per-backend difference (claude: session/set_config_option; cortex:
	 *  launch-time `-m` pin → no-op here). backend.ts wraps the call in withTimeout. */
	enforceModel(params: AcpEnforceModelParams): Promise<void>;

	/** Backend-specific fields folded into bridgeConfigSignature (reuse invalidation):
	 *  connection/profile/env-derived STABLE ids only — never raw env values / secrets.
	 *  `backend` + `nativeModelId` are added by backend.ts, not here. */
	configSignatureFields(config: ResolvedAcpConfig): Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// claude adapter — the first implementation (the rail's reference backend)
// ---------------------------------------------------------------------------

const SUPPORTED_CLAUDE_IDS: ReadonlySet<string> = new Set(SUPPORTED_ANTHROPIC_MODEL_IDS);

/** Resolve the claude-agent-acp launch — package bin (resolve), env override for debug.
 *  STEP A NOTE: mirrors backend.ts:resolveLaunch; Step B removes that private copy. */
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

	resolveLaunch() {
		return resolveClaudeLaunch();
	},

	launchEnvDefaults() {
		return claudeLaunchEnvDefaults();
	},

	ensureOverlay() {
		ensureClaudeConfigOverlay();
		// CLAUDE_CONFIG_DIR rides launchEnvDefaults(); the overlay materialization
		// itself contributes no extra spawn env.
		return { envOverrides: {} };
	},

	loadCarrier({ mcpServerNames }) {
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

	configSignatureFields() {
		// Claude folds no extra backend-specific fields beyond backend + nativeModelId
		// (which backend.ts adds). A future backend (cortex) returns its connection id here.
		return {};
	},
};

// ---------------------------------------------------------------------------
// Registry — modelId → adapter
// ---------------------------------------------------------------------------

/** Registered adapters. Order carries NO routing authority — routeModel decides.
 *  Step A: claude only. A second backend (cortex) appends here with a reserved
 *  `cortex-*` prefix, and the fail-fast below proves no two adapters claim one id. */
const ADAPTERS: readonly AcpBackendAdapter[] = [claudeAdapter];

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
