// ACP backend adapter rail — the PRODUCT seam by which a curated model id selects
// which ACP backend (claude / future backend / …) drives a turn. See the adapter contract in
// docs/acp-backend-rail.md.
//
// This seam is DISTINCT from `AcpTurnDeps` (backend.ts), which is the test/runtime
// seam (fake spawn/connection/clock for the gates). Merging them would make a
// fake-deps fixture look like
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

import { createRequire } from "node:module";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";

import type { AcpConnectionLike, AcpPromptResponse } from "./acp-client.js";
import { enrichMcpServersWithEnvelope, type ResolvedAcpConfig } from "./config.js";
import { loadEngraving } from "./engraving.js";
import {
	CORTEX_MODEL_PREFIX,
	curatedClaudeModels,
	curatedCortexModels,
	SUPPORTED_ANTHROPIC_MODEL_IDS,
	SUPPORTED_CORTEX_MODEL_IDS,
} from "./models.js";
import { claudeLaunchEnvDefaults, ensureClaudeConfigOverlay, ensureCortexDualHomeOverlay } from "./overlay.js";
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
 *  here; backend.ts never inspects config. Same shape as AcpLaunchParams plus the
 *  session key (overlay and launch are distinct phases, so they keep distinct names). */
export interface AcpOverlayParams {
	cwd: string;
	modelId: string;
	nativeModelId: string;
	config: ResolvedAcpConfig;
	/** The AUTHORITATIVE per-session key backend.ts already computed
	 *  (resolveSessionKey: opts.sessionId → PI_SESSION_ID → cwd). A session-scoped
	 *  overlay MUST scope on this value, never on an ambient re-derivation — the
	 *  re-derived form drops `opts.sessionId`, so two sessions in one process/cwd
	 *  would alias one overlay (GPT review 2026-07-29, cortex P0-1). */
	sessionKey: string;
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

/**
 * ONE turn's usage, as a backend that has MEASURED its own semantics reports it.
 *
 * Four TURN-DELTA token counts and nothing else. Deliberately NOT carried here:
 *
 *   - a cost. ACP's `PromptResponse` has no cost field at all (read at
 *     @agentclientprotocol/sdk `schema/types.gen.d.ts`, `PromptResponse` =
 *     stopReason + usage? + _meta; `Usage` = the token counts + _meta). Claude
 *     reports a SESSION-CUMULATIVE ESTIMATED cost on a different wire entirely
 *     — the `usage_update` notification (read at claude-agent-acp
 *     `dist/acp-agent.js:2673-2689`, `cost.amount = message.total_cost_usd`).
 *     ESTIMATED is the vendor's own word, not a hedge of ours: claude-agent-sdk
 *     `sdk.d.ts:4538` documents `total_cost_usd` as a "Cumulative estimated
 *     cost" and "An estimate, not a billing statement".
 *     Declaring a `cumulativeCostUsd` field here would be a carrier that does
 *     not exist; the cost axis is sealed from the observed notification against
 *     the BridgeSession baseline instead (backend.ts).
 *   - `totalTokens`. pi reads that field as CONTEXT OCCUPANCY, not as a turn
 *     total (`calculateContextTokens(usage) = usage.totalTokens || input +
 *     output + cacheRead + cacheWrite`, read at pi-coding-agent
 *     `dist/core/compaction/compaction.js:86-88`), and it drives the context
 *     gauge and auto-compaction. Occupancy arrives on `usage_update.used`;
 *     writing this turn's partition sum there would collapse both.
 */
export interface AcpTurnEvidence {
	tokens: {
		input: number;
		output: number;
		cacheRead: number;
		cacheWrite: number;
	};
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

	/** Extract THIS turn's usage from this backend's own ACP prompt response.
	 *
	 *  Two distinct absences, and the difference is load-bearing:
	 *
	 *    METHOD ABSENT    this backend has no MEASURED usage semantics. Permanent,
	 *                     static, and unforgeable — the backend simply does not
	 *                     implement it (cortex). backend.ts then seals NOTHING:
	 *                     no token projection, no cost baseline, no diff. That is
	 *                     what keeps this lane's accounting out of a backend whose
	 *                     `usage` meaning nobody has measured.
	 *    RETURNS undefined  this backend HAS the semantics, but THIS response
	 *                     carried no usage. Transient. The cost baseline is HELD
	 *                     (not zeroed, not rebased) so the amount lands in the next
	 *                     adjacent diff and the session total stays exact.
	 *
	 *  A capability FLAG would have collapsed those two axes into one boolean and
	 *  could drift from the actual behaviour (declared ≠ actual — the failure mode
	 *  assertExcludeToolsHonored already exists to stop). Method presence plus the
	 *  return value cannot desync.
	 *
	 *  STATELESS by contract: extract only. The adjacent-turn diff needs session
	 *  state, and session state lives in BridgeSession — never in an adapter. */
	extractTurnUsage?(response: AcpPromptResponse): AcpTurnEvidence | undefined;
}

// ---------------------------------------------------------------------------
// claude adapter — the first implementation (the rail's reference backend)
// ---------------------------------------------------------------------------

const SUPPORTED_CLAUDE_IDS: ReadonlySet<string> = new Set(SUPPORTED_ANTHROPIC_MODEL_IDS);

/**
 * Resolve the claude launch — an ENTWURF-OWNED launcher, or the env override for debug.
 * This is the single source for the claude launch spec; backend.ts holds no private copy.
 *
 * The default no longer names the vendor bin directly. `claude-acp-launch.js`
 * imports it in-process; that file's header carries the reason (#72: a janitor
 * for another harness selects `claude-agent-acp` by argv substring and SIGTERMs
 * it by age, and the vendor's own handler erases the signal into exit 0).
 *
 * `CLAUDE_AGENT_ACP_COMMAND` is an EXPLICIT operator override and is deliberately
 * NOT routed through the launcher: an operator who names their own command owns
 * the result, including the loss of the name split and the signal observation.
 */
function resolveClaudeLaunch(): AcpLaunchSpec {
	const override = process.env.CLAUDE_AGENT_ACP_COMMAND?.trim();
	if (override) return { command: "bash", args: ["-lc", override] };
	// Resolved here (not inside the launcher's own directory lookup) so a missing
	// vendor package still fails at launch resolution, where it always failed.
	const require = createRequire(import.meta.url);
	require.resolve("@agentclientprotocol/claude-agent-acp/package.json");
	const launcher = fileURLToPath(new URL("./claude-acp-launch.js", import.meta.url));
	return { command: process.execPath, args: [launcher] };
}

export const claudeAdapter: AcpBackendAdapter = {
	backend: "claude",

	// Claude owns its UNPREFIXED curated ids only (rail “Adapter contract”). The native id
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

	/**
	 * MEASURED (2026-09-01, #93): for claude-agent-acp, `PromptResponse.usage` is a
	 * TURN DELTA, not the session total its own field comments claim.
	 * `session.accumulatedUsage` is reset to four zeros when a turn is ACTIVATED
	 * (read at `dist/acp-agent.js:1347-1352`) and `sessionUsage(session)` reads
	 * exactly those accumulators back out (read at `:2680-2691`). That measurement
	 * is what this method asserts on this backend's behalf — and precisely why the
	 * common turn loop must not read the field itself: upstream's own type says
	 * "across all turns/session" per field while the outer comment says "for this
	 * turn", so the shape alone settles nothing.
	 *
	 * The four counts are DISJOINT (Anthropic bills cache reads and cache creation
	 * separately from `input_tokens`), so pi's four usage fields take them
	 * one-to-one with no arithmetic here.
	 */
	extractTurnUsage(response) {
		const usage = response?.usage;
		// No usage on THIS response — transient. The caller HOLDS its baseline.
		if (!usage || typeof usage !== "object") return undefined;
		const count = (value: unknown): number => (typeof value === "number" && Number.isFinite(value) ? value : 0);
		return {
			tokens: {
				input: count(usage.inputTokens),
				output: count(usage.outputTokens),
				cacheRead: count(usage.cachedReadTokens),
				cacheWrite: count(usage.cachedWriteTokens),
			},
		};
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
// rail (docs/acp-backend-rail.md, “Shipped adapters”). It adds ZERO to the common layer:
// everything cortex-specific lives here + models.ts + overlay.ts + the gates.
// ---------------------------------------------------------------------------

const SUPPORTED_CORTEX_IDS: ReadonlySet<string> = new Set(SUPPORTED_CORTEX_MODEL_IDS);

/** Cortex's OWN settings: a Snowflake connection name, or null. Opaque to
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

	// Cortex owns the reserved `cortex-` prefix (rail “Adapter contract”). routeModel strips it to the
	// native id: `cortex-auto` → "auto", `cortex-claude-sonnet-5` → "claude-sonnet-5".
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
	// `*-acp` npm package, unlike claude). `-c <conn>` appended when a connection
	// is pinned. NO `-m`: the model is enforced per-turn via
	// session/set_config_option (enforceModel below, CP0-M measured GO) and a
	// launch pin would be a SECOND model authority that drifts from it.
	// CORTEX_ACP_COMMAND override runs via `bash -lc` with the selection flags
	// appended so the bridge's choice wins (later yargs args override earlier ones).
	resolveLaunch({ config }) {
		const settings = config.adapterSettings as CortexAdapterSettings | undefined;
		const connection = settings?.cortexConnection?.trim() || undefined;
		const selectionArgs: string[] = [];
		if (connection) selectionArgs.push("-c", connection);
		const override = process.env.CORTEX_ACP_COMMAND?.trim();
		if (override) {
			const command = selectionArgs.length > 0 ? `${override} ${selectionArgs.map(shellQuote).join(" ")}` : override;
			return { command: "bash", args: ["-lc", command] };
		}
		return { command: "cortex", args: ["acp", "serve", ...selectionArgs] };
	},

	// The overlay location is SESSION-SCOPED (never static), so the spawn env
	// rides ensureOverlay(...).envOverrides; there is no static launch env. The
	// v1.1.8-era CORTEX_DISABLE_AUTO_APPLY_PROFILES knob was retired with the
	// dual-HOME redesign: profiles now live inside the overlay-owned isolated
	// home (empty by construction), and the knob is unmeasured on v1.1.52.
	launchEnvDefaults() {
		return {};
	},

	// Dual-HOME containment (CP0 D2/D3/D9/D10 — see the overlay module header):
	// refuse an ambient CORTEX_HOME outright, then materialize the session-scoped
	// isolated HOME with auth symlinks, `autoUpdate:false`, and the mcp.json
	// projection of the envelope-enriched explicit servers (cortex ignores the
	// wire mcpServers param, so this file IS how tools reach a cortex session).
	ensureOverlay({ modelId, config, sessionKey }) {
		// D3 — presence refusal, empty string included: upstream's resolver treats
		// a set-but-empty CORTEX_HOME differently from unset, and one ambient value
		// would silently bypass SNOWFLAKE_HOME (the probe's CLAUDE_CODE_EXECUTABLE
		// precondition is the same family). Refuse the ambiguity; never pick a side.
		if ("CORTEX_HOME" in process.env) {
			throw new Error(
				"entwurf: CORTEX_HOME is present in the environment (empty string included) — it overrides " +
					"SNOWFLAKE_HOME inside cortex and would bypass the dual-HOME overlay entirely (CP0 D3). " +
					"Unset it to run a cortex ACP turn.",
			);
		}
		// The scope authority is the AUTHORITATIVE params.sessionKey backend.ts
		// computed — never an ambient re-derivation, which would drop opts.sessionId
		// and alias two same-process/cwd sessions onto one overlay (P0-1). The
		// envelope below still reads PI_SESSION_ID: that is the identity CARRIER for
		// the bridge child (the same source the turn loop's wire enrichment uses),
		// a different axis from overlay-dir scoping.
		const piSessionId = process.env.PI_SESSION_ID?.trim() || undefined;
		const enriched = enrichMcpServersWithEnvelope(config.mcpServers, { modelId, piSessionId });
		const overlay = ensureCortexDualHomeOverlay({
			scopeKey: sessionKey,
			mcpServers: enriched,
			realHome: homedir(),
		});
		return { envOverrides: { HOME: overlay.home, SNOWFLAKE_HOME: overlay.snowflakeHome } };
	},

	// System-prompt-carrier-less (ACP rail “Cortex Code audit”): Cortex ACP exposes no
	// `_meta.systemPrompt` and has no developer_instructions / GEMINI_SYSTEM_MD
	// equivalent. (It does READ `_meta` — a caller-session-id seam, measured but
	// unexplored and deliberately not part of this contract.) loadCarrier returns
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

	// Per-turn enforcement via session/set_config_option — the SAME wire call the
	// claude adapter makes, measured live against cortex v1.1.52 (CP0-M): the
	// option id is "model", accepted values are the NATIVE ids (`auto`,
	// `claude-sonnet-5`, `openai-gpt-5.4`, …), and a value cortex no longer
	// serves fails loud BEFORE the prompt (`Unsupported model: …`). PR #40's
	// launch-time `-m` pin was retired for this: set-model is the single model
	// authority (resolveLaunch never passes `-m`), and "auto" is set explicitly
	// rather than treated as an unspoken default.
	async enforceModel({ connection, acpSessionId, nativeModelId, modelId }) {
		const setConfig = connection.setSessionConfigOption;
		if (typeof setConfig !== "function") {
			throw new Error(`setSessionConfigOption unsupported — cannot enforce model ${modelId}`);
		}
		await setConfig.call(connection, { sessionId: acpSessionId, configId: "model", value: nativeModelId });
	},

	// A connection change must invalidate a reused session (rail: Adapter contract). Flat,
	// sorted-stable primitive map; reads ONLY the opaque adapterSettings. `backend`
	// + `nativeModelId` are added by backend.ts.
	configSignatureFields(adapterSettings) {
		const settings = adapterSettings as CortexAdapterSettings | undefined;
		return { cortexConnection: settings?.cortexConnection ?? null };
	},

	// NO extractTurnUsage — a DELIBERATE, permanent absence, not an omission to be
	// filled in later by symmetry with claude. Nobody has measured what cortex's
	// ACP `usage` (and its usage_update cost, if it sends one) MEAN: whether the
	// token counts are a turn delta or a session total, and against which price
	// table. Until that measurement exists, the honest report is no report:
	// backend.ts seals nothing for a backend without this method, so cortex's
	// emitted usage is byte-identical to what it was before #93. Implementing this
	// with a guess would mint exactly the silent misaccounting #93 exists to end.
};

const ADAPTERS: readonly AcpBackendAdapter[] = [claudeAdapter, cortexAdapter];

/**
 * Resolve the backend adapter that owns `modelId`.
 *
 * Routing fail-fast contract (rail “Adapter contract”):
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
 *  Registration-time fail-fast (rail “Adapter contract”): every curated id must route to EXACTLY
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
