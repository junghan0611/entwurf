// ACP plugin — curated Claude model surface (S0 loader/fence slice).
//
// entwurf is an ACP *plugin* on the v2 core, NOT a general-purpose
// Anthropic provider. It deliberately does not expose the full pi-ai model
// registry — the surface is curated to the Claude anchor the plugin commits to
// driving through a real ACP backend (the backend lands in S2; S0 only stands
// the provider/model surface up).
//
// Claude-first scope (NEXT §스코프): Codex is already a native garden citizen
// and Gemini / major tools use native, so the curated surface is Claude-only on
// this lane. A second governed backend would EXTEND this set — it does not change
// the pattern.

// pi 0.80 migration: the standalone root `getModels()` moved to the deprecated
// `@earendil-works/pi-ai/compat` entrypoint (the global-API churn). We import it
// from `/compat` directly.
//
// Why `/compat` and NOT the 0.80 provider-factory subpath (the pi-ai
// providers/anthropic subpath): this file is loaded by pi's
// EXTENSION loader (pi-coding-agent `core/extensions/loader.ts`), whose jiti
// alias map resolves ONLY three pi-ai specifiers for extensions — the bare root,
// `/compat`, and `/oauth` — all to `ai/dist/compat.js`. A `providers/*` subpath
// is NOT in that map: jiti prefix-matches the bare `@earendil-works/pi-ai` alias
// and appends the remainder, yielding the unresolvable
// `…/dist/compat.js/providers/anthropic` (verified live: extension load crash,
// invisible to static typecheck which resolves against node_modules `exports`).
// So `/compat` is the SINGLE sanctioned extension entrypoint for the old global
// model-catalog API, and the SINGLE allowlisted exception in
// `run.sh check-pi-import-surface`. `getModels` here is compat's deprecated
// re-export of `getBuiltinModels`. When pi removes compat we migrate to whatever
// the loader then exposes.
import { getModels } from "@earendil-works/pi-ai/compat";

/** Provider id — current pre-rename surface; S1 renames this load-bearing id to `entwurf`. */
export const PROVIDER_ID = "entwurf";

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

// The curated Claude ids. Adding one here is a commitment to verify it across
// both axes (protocol smoke + agent interview) — do not extend casually.
// Exported so the claude backend adapter (backend-adapter.ts) can answer
// `routeModel` without re-deriving the set from curatedClaudeModels().
export const SUPPORTED_ANTHROPIC_MODEL_IDS = ["claude-sonnet-4-6", "claude-opus-4-8"] as const;

/** The anchor model whose absence is a hard registry regression, not a soft skip. */
export const CURATED_ANCHOR_MODEL_ID = "claude-opus-4-8";

// Anthropic's registry reports 1M for Claude 4.6+ models, but the public
// entwurf surface deliberately distinguishes Sonnet vs Opus: Sonnet stays
// at 200K, Opus surfaces at 1M. (The 0.11.0 ENTWURF_ACP_CLAUDE_CONTEXT env
// override is a behavior-oracle nicety deferred past S0 — the loader/fence
// slice only needs the anchor present and registered.)
const CLAUDE_CONTEXT_DEFAULT = 1_000_000;
const CLAUDE_SONNET_DEFAULT = 200_000;

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
	const cap = model.id === "claude-sonnet-4-6" ? CLAUDE_SONNET_DEFAULT : CLAUDE_CONTEXT_DEFAULT;
	return Math.min(model.contextWindow, cap);
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
		input: m.input,
		cost: m.cost,
		contextWindow: claudeContextWindow(m),
		maxTokens: m.maxTokens,
	}));
}
