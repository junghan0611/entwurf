// ACP plugin — curated model surface: Claude rows, and the Antigravity ACP rows (#167) at the
// end of this file. Cortex ACP is disabled.
//
// entwurf is an ACP *plugin* on the v2 core, NOT a general-purpose
// Anthropic provider. It deliberately does not expose the full pi-ai model
// registry — the surface is curated to the ids the plugin commits to driving
// through a real ACP backend.
//
// The unprefixed Claude IDs and the `agy-` prefixed Antigravity IDs are registered. Historical
// Cortex IDs are reserved refusal inputs; native citizens are independent of this provider.

// pi 0.80 migration: the standalone root `getModels()` moved to the deprecated
// `@earendil-works/pi-ai/compat` entrypoint (the global-API churn). We import it
// from `/compat` directly.
//
// Why `/compat` and NOT the 0.80 provider-factory subpath (the pi-ai
// providers/anthropic subpath): this file is loaded by pi's
// EXTENSION loader (pi-coding-agent `core/extensions/loader.ts`), whose jiti
// alias map resolves FOUR pi-ai specifiers for extensions — the bare root,
// `/compat`, `/oauth`, and (since pi 0.81) `/providers/all`. Other `providers/*`
// subpaths are NOT in that map: jiti prefix-matches the bare
// `@earendil-works/pi-ai` alias and appends the remainder, yielding the
// unresolvable `…/dist/compat.js/providers/anthropic` (verified live: extension
// load crash, invisible to static typecheck which resolves against node_modules
// `exports`). So `/compat` remains the SINGLE sanctioned extension entrypoint
// this repo uses for the old global model-catalog API, and the SINGLE allowlisted exception in
// `run.sh check-pi-import-surface`. `getModels` here is compat's deprecated
// re-export of `getBuiltinModels`. When pi removes compat we migrate to whatever
// the loader then exposes.
import { getModels } from "@earendil-works/pi-ai/compat";
import {
	AGY_MODEL_PREFIX,
	CURATED_ANCHOR_MODEL_ID,
	SUPPORTED_AGY_NATIVE_MODEL_IDS,
	SUPPORTED_ANTHROPIC_MODEL_IDS,
} from "./model-ids.js";

// The provider id and the curated ID lists live in the dependency-free
// `model-ids.js` leaf, shared with the launch seams (#128); this file is the only
// one that loads the upstream catalog to turn them into registry rows.
export {
	AGY_MODEL_PREFIX,
	CORTEX_MODEL_PREFIX,
	CURATED_ANCHOR_MODEL_ID,
	LEGACY_CORTEX_MODEL_IDS,
	PROVIDER_ID,
	SUPPORTED_AGY_NATIVE_MODEL_IDS,
	SUPPORTED_ANTHROPIC_MODEL_IDS,
} from "./model-ids.js";

// #26 auth-boundary sentinel. `pi.registerProvider` requires an apiKey when a
// provider defines custom models, but the ACP plugin consumes NO key: backend
// auth belongs to the operator's own Claude CLI child process (AGENTS
// §Operating boundaries — trust invariants). This lowercase+hyphen literal
// satisfies pi's auth-present check WITHOUT being read as an ENV reference. An
// ALL-CAPS value like "ANTHROPIC_API_KEY" would (a) trip pi's legacy-env
// deprecation and (b) falsely present the plugin as Anthropic-key dependent,
// failing preflight when the var is unset. Do NOT change to "$ANTHROPIC_API_KEY"
// — that silences the warning but keeps the wrong auth-boundary shape. The
// check-auth-boundary gate pins this.
export const ENTWURF_ACP_NO_AUTH_SENTINEL = "entwurf-no-auth";

// Anthropic's registry reports 1M for Sonnet 5.5, Opus 5.5 and Fable 5.1, and the
// entwurf surface exposes the full 1M for all three. Sonnet 5's 1M window was the
// whole point of the 0.12.3 bump — it is the compact-free long-context floor the
// earlier 200K Sonnet cap could not provide. We still clamp to a 1M ceiling so a
// future registry value can't silently inflate the surface past what we verify.
const CLAUDE_CONTEXT_DEFAULT = 1_000_000;

// `getModels("anthropic")` reads the static builtin model catalog only — no env
// read, no credential access, no network — preserving the #26 auth-boundary
// invariant: the curated surface consumes no key.
const ANTHROPIC_MODELS_ALL = getModels("anthropic");
type RegistryModel = (typeof ANTHROPIC_MODELS_ALL)[number];

function requireRegistryModel(models: readonly RegistryModel[], id: string): RegistryModel {
	const model = models.find((m) => m.id === id);
	// Crash, don't warn (AGENTS): a missing anchor is a genuine pi-ai metadata
	// regression and must fail the curated surface up front rather than be
	// papered over with a fabricated row.
	if (!model) throw new Error(`entwurf: required Claude model missing from pi-ai registry: ${id}`);
	return model;
}

function claudeContextWindow(model: { id: string; contextWindow: number }): number {
	return Math.min(model.contextWindow, CLAUDE_CONTEXT_DEFAULT);
}

// Cortex ACP is disabled; its former IDs are refusal inputs, not model rows.

/**
 * What an ACP row declares it can take as input: text only. The rail delivers pi's transcript as
 * ACP text blocks; an image becomes the marker `[image omitted: <mime>]` (`context.ts`), and no
 * other path carries image bytes to the backend. pi's catalog lists the Anthropic models as
 * `["text", "image"]` — true of the model behind the API, not of this transport — so copying it
 * would advertise a capability the rail does not deliver (#142 landing review). A backend gains
 * `image` here only together with a real image path and its proof.
 */
const ACP_ROW_INPUT: ("text" | "image")[] = ["text"];

/** The retired Cortex adapter contributes no supported model rows. */
export function curatedCortexModels(): [] {
	return [];
}

/**
 * The effort values claude-agent-acp offers on its `effort` config option (category
 * `thought_level`). `[측정 2026-11-13]` 0.106.0, authenticated, no prompt (#142): the option lists
 * `default, low, medium, high, xhigh, max`; `high → low → max` each read back on one live session and
 * `minimal` was refused `-32602`. `default` is the vendor's own choice, so no pi level maps to it.
 */
export const CLAUDE_ACP_EFFORT_VALUES = ["low", "medium", "high", "xhigh", "max"] as const;

type ThinkingLevelMap = NonNullable<RegistryModel["thinkingLevelMap"]>;

/**
 * The pi `thinkingLevelMap` an ACP Claude row registers (#142). pi's documented model seam: the
 * value is what the provider sends for each pi level, `null` marks a level unsupported, and xhigh/max
 * appear only when mapped (`getSupportedThinkingLevels`). Each supported pi level maps to the effort
 * value of the same name. `off` and `minimal` have no effort value, so they are `null` and never
 * offered; a level the registry already marks unsupported for this model stays unsupported, and
 * xhigh/max stay hidden where the registry does not map them. Nothing here is a model catalog: the
 * registry decides which levels the model has, this decides which of them ACP can carry.
 */
export function claudeAcpThinkingLevelMap(registry: RegistryModel["thinkingLevelMap"]): ThinkingLevelMap {
	const map: ThinkingLevelMap = { off: null, minimal: null };
	for (const level of CLAUDE_ACP_EFFORT_VALUES) {
		const declared = registry?.[level];
		const unmapped = declared === undefined && (level === "xhigh" || level === "max");
		map[level] = declared === null || unmapped ? null : level;
	}
	return map;
}

/**
 * The curated Claude model rows handed to `pi.registerProvider({ models })`.
 * Fail-loud if the anchor is absent from the pi-ai registry.
 */
export function curatedClaudeModels() {
	const supported = new Set<string>(SUPPORTED_ANTHROPIC_MODEL_IDS);
	requireRegistryModel(ANTHROPIC_MODELS_ALL, CURATED_ANCHOR_MODEL_ID);
	return ANTHROPIC_MODELS_ALL.filter((m) => supported.has(m.id)).map((m) => ({
		id: m.id,
		name: m.name,
		reasoning: m.reasoning,
		thinkingLevelMap: claudeAcpThinkingLevelMap(m.thinkingLevelMap),
		input: [...ACP_ROW_INPUT],
		cost: m.cost,
		contextWindow: claudeContextWindow(m),
		maxTokens: m.maxTokens,
	}));
}

// ---------------------------------------------------------------------------
// Antigravity ACP rows (#167)
// ---------------------------------------------------------------------------

/**
 * The `thought_level` values `agy acp` offers, per native model. `[측정 2026-11-16]` agy 1.5.9,
 * authenticated, no prompt: setting each model and reading the answer's `thought_level` option gave
 * `low, medium, high` for Argon and Flash and `low, medium, high, xhigh` for Hydrogen. The vendor
 * default is `medium`; no pi level maps to "whatever the vendor picked".
 */
export const AGY_THOUGHT_LEVELS: Readonly<Record<(typeof SUPPORTED_AGY_NATIVE_MODEL_IDS)[number], readonly string[]>> =
	Object.freeze({
		"gemini-4-hydrogen": Object.freeze(["low", "medium", "high", "xhigh"]),
		"gemini-4-argon": Object.freeze(["low", "medium", "high"]),
		"gemini-3.8-flash": Object.freeze(["low", "medium", "high"]),
	});

/** The names agy's own `model` option gives these rows (same measurement). */
const AGY_MODEL_NAMES: Readonly<Record<(typeof SUPPORTED_AGY_NATIVE_MODEL_IDS)[number], string>> = Object.freeze({
	"gemini-4-hydrogen": "Gemini 4 Hydrogen",
	"gemini-4-argon": "Gemini 4 Argon",
	"gemini-3.8-flash": "Gemini 3.8 Flash",
});

/**
 * The window agy reports as `usage_update.size`. `[측정 2026-11-16]` one prompt on each of the three
 * models answered `size: 1048576`. It is a measured wire value, not a catalog row.
 */
export const AGY_CONTEXT_WINDOW = 1_048_576;

/**
 * pi requires an output cap on a row; this rail sends none to agy and reads none back, so the value
 * limits nothing on the wire. It is an entwurf-declared number, NOT a measured vendor limit.
 */
export const AGY_ROW_MAX_TOKENS = 32_768;

/** The pi `thinkingLevelMap` of one agy row: each offered `thought_level` under the pi level of the
 *  same name, everything else `null` (never offered). */
export function agyThinkingLevelMap(nativeModelId: (typeof SUPPORTED_AGY_NATIVE_MODEL_IDS)[number]): ThinkingLevelMap {
	const offered = new Set(AGY_THOUGHT_LEVELS[nativeModelId]);
	const map: ThinkingLevelMap = { off: null, minimal: null };
	for (const level of ["low", "medium", "high", "xhigh", "max"] as const) {
		map[level] = offered.has(level) ? level : null;
	}
	return map;
}

/**
 * The curated Antigravity ACP rows. Built from the measured wire values above, never from pi's
 * catalog: the subscription's models are whatever `agy acp` offers, and the price is zero because
 * the wire carries no cost and nothing here prices a subscription turn.
 */
export function curatedAgyModels() {
	return SUPPORTED_AGY_NATIVE_MODEL_IDS.map((nativeModelId) => ({
		id: `${AGY_MODEL_PREFIX}${nativeModelId}`,
		name: `${AGY_MODEL_NAMES[nativeModelId]} (agy ACP)`,
		reasoning: true,
		thinkingLevelMap: agyThinkingLevelMap(nativeModelId),
		input: [...ACP_ROW_INPUT],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: AGY_CONTEXT_WINDOW,
		maxTokens: AGY_ROW_MAX_TOKENS,
	}));
}
