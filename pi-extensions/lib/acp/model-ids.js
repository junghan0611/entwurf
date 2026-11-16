// ACP plugin — the curated model IDs, and nothing else (#128).
//
// This leaf imports NOTHING. `models.ts` builds the registry rows from the pi-ai
// catalog; the launch seams (`fresh-call-dispatch.ts`, `resume-launch-identity.ts`)
// only need to know which IDs exist, and they ride the pi-free bridge closure, so
// they read the IDs here rather than load a vendor catalog to learn them.
//
// WHY `.js`: the same reason as `protocol.js`. Both the emit-capable root program
// (allowJs) and Node --experimental-strip-types resolve an explicit `.js` import
// literally to this file, so `models.ts` (root fence, `.js` specifiers) and the
// strip-types gates that load `models.ts` directly reach one SSOT. A `.ts` leaf
// would need a `.ts` specifier the root config cannot allow.
//
// WHY THE LAUNCH SEAMS ASK AT ALL. Pi's `--model` resolver falls back to a
// case-insensitive substring match among provider rows. The old multi-backend
// surface could silently match a retired Claude id to a Cortex row. Cortex is
// now disabled; exact membership remains the admission, with no substitution.

/** The single ACP provider id under which every curated row is registered. */
export const PROVIDER_ID = "entwurf";

// The curated Claude ids. Adding one here is a commitment to verify it across
// both axes (protocol smoke + agent interview) — do not extend casually.
export const SUPPORTED_ANTHROPIC_MODEL_IDS = /** @type {const} */ ([
	"claude-sonnet-5-5",
	"claude-opus-5-5",
	"claude-fable-5-2",
]);

/** The anchor model whose absence is a hard registry regression, not a soft skip. */
export const CURATED_ANCHOR_MODEL_ID = "claude-opus-5-5";

// These former IDs are retained only as historical refusal inputs. The prefix
// is reserved so a disabled Cortex request never falls through to Claude.
export const CORTEX_MODEL_PREFIX = "cortex-";
export const LEGACY_CORTEX_MODEL_IDS = /** @type {const} */ ([
	"cortex-auto",
	"cortex-claude-opus-5",
	"cortex-claude-sonnet-5",
	"cortex-openai-gpt-5.4",
]);

// Antigravity ACP (`agy acp`, #167). The reserved prefix marks a row the agy adapter owns; the
// native id behind it is the value agy's own `model` config option offers. `[측정 2026-11-16]`
// agy 1.5.9, Google AI Pro: the option lists these three among seven; the other four are not
// rows here (two carry no `thought_level` option, two are Claude models the Claude rail already
// drives). The prefix is `agy-`, not the `agy/` an early note on #167 used as an example: the one
// reserved prefix this file already had is `cortex-`, and a second slash inside `provider/id` is a
// parsing surface nothing here needs.
export const AGY_MODEL_PREFIX = "agy-";
export const SUPPORTED_AGY_NATIVE_MODEL_IDS = /** @type {const} */ ([
	"gemini-4-hydrogen",
	"gemini-4-argon",
	"gemini-3.8-flash",
]);

/** The curated agy ids as registered: prefix + native id. @type {readonly string[]} */
export const SUPPORTED_AGY_MODEL_IDS = SUPPORTED_AGY_NATIVE_MODEL_IDS.map((id) => `${AGY_MODEL_PREFIX}${id}`);

/**
 * Exact membership in the agy rows — what switches a launch to agy's tool-name dialect.
 * @param {string} model
 * @returns {boolean}
 */
export function isAgyAcpModelId(model) {
	return SUPPORTED_AGY_MODEL_IDS.includes(model);
}

/** @type {ReadonlySet<string>} */
const CURATED_ACP_MODEL_IDS = new Set([...SUPPORTED_ANTHROPIC_MODEL_IDS, ...SUPPORTED_AGY_MODEL_IDS]);

/**
 * Exact membership only — no trim, no case folding, no prefix.
 * @param {string} model
 * @returns {boolean}
 */
export function isCuratedAcpModelId(model) {
	return CURATED_ACP_MODEL_IDS.has(model);
}

/** The named refusal both launch seams answer with. */
export const ACP_MODEL_NOT_CURATED = /** @type {const} */ ("acp-model-not-curated");

export const ACP_MODEL_NOT_CURATED_HINT =
	`an ${PROVIDER_ID} model must be one exact curated ACP id (${[...CURATED_ACP_MODEL_IDS].join(", ")}); ` +
	"Cortex ACP is disabled; Pi may otherwise pick another row by substring, so nothing was opened and nothing is aliased or rewritten";

/** Carries `reason` so callers match a FIELD, never the wording. */
export class AcpModelNotCuratedError extends Error {
	/** @param {string} model */
	constructor(model) {
		super(`${ACP_MODEL_NOT_CURATED}: ${JSON.stringify(model)} is not an exact curated ${PROVIDER_ID} model id`);
		this.name = "AcpModelNotCuratedError";
		/** @readonly */
		this.reason = ACP_MODEL_NOT_CURATED;
		/** @readonly */
		this.model = model;
	}
}
