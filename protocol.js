/**
 * Shared wire-format constants for entwurf surfaces that must agree
 * across the root bridge and pi-extension / MCP helper code.
 *
 * Keep this file dependency-free. Single source for both runtime paths:
 *   - tsc-emit path: typechecked under root tsconfig.json (allowJs: true)
 *     and copied through to the .tmp-verify directories by tsc emit.
 *   - Node --experimental-strip-types path (mcp bridges): resolves explicit
 *     .js imports literally to this file on disk.
 *
 * Why .js and not .ts: strip-types does not substitute .ts source for a
 * literal .js import specifier, and the root config cannot enable
 * allowImportingTsExtensions without losing tsc emit (which check-models
 * relies on). Authoring as .js side-steps the whole drift surface.
 */

/**
 * Opening marker for the project-context block inserted by entwurf's
 * `enrichTaskWithProjectContext`. The ACP bridge uses the same marker to
 * detect entwurf-spawned first prompts and remove only the duplicate cwd
 * AGENTS.md section from its own pi-context augment.
 */
export const ENTWURF_PROJECT_CONTEXT_OPEN_TAG = "<project-context";

/**
 * Sender-side UI echo custom message type for successful entwurf_v2 send calls.
 * The bridge emits it, the control renderer draws it, and the provider-level
 * context filter removes it before LLM conversion. Keep as one SSOT: a typo
 * here otherwise becomes a silent UI/context split.
 */
export const ENTWURF_SENT_MESSAGE_TYPE = "entwurf-sent";
