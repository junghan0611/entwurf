// ACP plugin — billing carrier (engraving) loader (S2d-1c).
//
// The engraving is the OPERATOR surface for the Claude `_meta.systemPrompt`
// carrier — short, personal additions an operator wants attached to every ACP
// session's system prompt. It is NOT the bridge-identity / AGENTS / pi-base
// narrative: that rich context rides the first-user-message augment (augment.ts)
// because the system-prompt carrier MUST stay tiny.
//
// Why tiny (NEXT §S2-scout 핀1, oracle A — the most expensive hard-won rule):
// Anthropic subscription billing (Claude Code OAuth, 정액제) classifies a call by
// how close `_meta.systemPrompt` stays to the SDK-default shape. The moment the
// carrier materially exceeds that shape (e.g. by injecting AGENTS.md or the pi
// base prompt), the call is reclassified as metered "extra usage" → subscription
// users with no metered balance get HTTP 400. So this surface stays SHORT, and
// ships EMPTY by default (carrier absent) — operators opt in via the file or env.
//
// Stability contract (NEXT oracle C / 핀1): the rendered output MUST be a pure
// function of (template content on disk, backend, mcpServerNames). No clock /
// random / env-time. `bridgeConfigSignature` folds this string into its
// `appendSystemPrompt` slot — if the rendered carrier drifted turn-to-turn, the
// signature would drift and pi-shell-acp would rebuild the ACP session every
// turn. The default-path source is cached once for exactly this reason, so a
// resident's carrier never drifts mid-session. The env-override path instead
// re-reads on EVERY call: editing that file mid-session INTENTIONALLY drifts the
// rendered carrier → bridgeConfigSignature changes → the live session is judged
// incompatible and the next turn opens a fresh ACP session with the new carrier.
// That per-turn rebuild is the accepted cost of the A/B opt-in surface, never the
// shipped default (which stays cached precisely so a resident never rebuilds).

import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const DEFAULT_ENGRAVING_PATH = join(HERE, "prompts", "engraving.md");

export interface EngravingParams {
	/** Claude-only this cut; kept as a field so the `{{backend}}` token interpolates. */
	backend: string;
	/** MCP server names exposed to the session. SORTED before render for determinism. */
	mcpServerNames: readonly string[];
}

type CachedSource = { filePath: string; content: string };
let cached: CachedSource | null = null;

/** Point the loader at an alternate engraving file (A/B); bypasses the cache. */
function resolveEngravingPath(): string {
	const envPath = process.env.PI_SHELL_ACP_ENGRAVING_PATH?.trim();
	return envPath ? resolve(envPath) : DEFAULT_ENGRAVING_PATH;
}

function loadSource(filePath: string): string {
	// Env-override path → always re-read (A/B experimentation). Default path →
	// cache once so a mid-session operator edit cannot drift the carrier (and thus
	// bridgeConfigSignature) between turns of a resident.
	if (filePath !== DEFAULT_ENGRAVING_PATH) {
		return readFileSync(filePath, "utf8");
	}
	if (!cached || cached.filePath !== filePath) {
		cached = { filePath, content: readFileSync(filePath, "utf8") };
	}
	return cached.content;
}

function interpolate(template: string, params: EngravingParams): string {
	// Sort so a caller-side ordering difference can never drift the rendered text
	// (and therefore the config signature) — GPT c32a6c8 determinism guard.
	const names = [...params.mcpServerNames].sort();
	const mcpList = names.length > 0 ? names.join(", ") : "(none registered)";
	return template.replace(/\{\{backend\}\}/g, params.backend).replace(/\{\{mcp_servers\}\}/g, mcpList);
}

/**
 * The rendered engraving carrier, or null when the engraving file is empty,
 * whitespace-only, missing, or unreadable. Callers MUST treat null as "no
 * carrier configured" and omit `_meta.systemPrompt` entirely (and pass "" as the
 * `appendSystemPrompt` signature input) so subscription billing is never
 * reclassified. Absence is the normal, default state.
 */
export function loadEngraving(params: EngravingParams): string | null {
	const filePath = resolveEngravingPath();
	let source: string;
	try {
		source = loadSource(filePath);
	} catch {
		return null;
	}
	const rendered = interpolate(source, params).trim();
	return rendered.length === 0 ? null : rendered;
}
