// ACP plugin — billing carrier (engraving) loader (S2d-1c).
//
// The engraving is the OPERATOR surface for the Claude `_meta.systemPrompt`
// carrier — short, personal additions an operator wants attached to every ACP
// session's system prompt. It is NOT the bridge-identity / AGENTS / pi-base
// narrative: that rich context rides the first-user-message augment (augment.ts)
// because the system-prompt carrier MUST stay tiny.
//
// Why a SMALL but NON-EMPTY default (the v1 memory-containment lever, restored):
// shipping a non-empty string here makes claude-agent-acp REPLACE its
// `claude_code` preset with this string (acp-agent.js: string-form
// `_meta.systemPrompt` → full preset replacement). That replacement strips the
// preset's auto-memory section, so the ACP model never learns it has a per-session
// memory store — the containment the operator baseline depends on. An EMPTY
// carrier keeps the preset and re-leaks auto-memory (the model writes memory/*.md
// via Write): that regression is exactly what a non-empty default fixes.
//
// Billing axis is SIZE, not SHAPE (NEXT §S2-scout 핀1, oracle A): Anthropic
// subscription billing (Claude Code OAuth, 정액제) reclassifies a call as metered
// "extra usage" — HTTP 400 for users with no metered balance — when the carrier
// materially GROWS past the SDK-default size (e.g. by injecting AGENTS.md or the
// pi base prompt). A tiny placeholder string is shape-deviant yet v1-production-
// safe, so the rule is keep the carrier SHORT, never "absent". Rich context still
// rides the first-user-message augment (augment.ts), never this carrier.
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
 * The rendered engraving carrier, or null when an ENV-OVERRIDE engraving file
 * (`PI_SHELL_ACP_ENGRAVING_PATH`) is empty, whitespace-only, missing, or
 * unreadable — that null is the operator opt-out. The SHIPPED default, by
 * contrast, IS the auto-memory containment lever (its non-empty carrier replaces
 * the claude_code preset, stripping the auto-memory advertisement) and MUST be
 * present + non-empty: if the shipped default is missing/unpackaged/empty this
 * THROWS (fail-loud, Detour C) rather than silently shipping with the carrier
 * strip off. To opt the carrier out, point the env override at an empty file.
 * Callers MUST treat null as "no carrier configured" and omit `_meta.systemPrompt`
 * entirely (passing "" as the `appendSystemPrompt` signature input) so
 * subscription billing is never reclassified.
 */
export function loadEngraving(params: EngravingParams): string | null {
	const filePath = resolveEngravingPath();
	const isShippedDefault = filePath === DEFAULT_ENGRAVING_PATH;
	let source: string;
	try {
		source = loadSource(filePath);
	} catch (err) {
		if (isShippedDefault) {
			throw new Error(
				`pi-shell-acp: shipped engraving carrier unreadable at ${filePath} — it is the auto-memory ` +
					`containment lever; refusing to proceed with containment silently degraded. (${(err as Error).message})`,
			);
		}
		return null;
	}
	const rendered = interpolate(source, params).trim();
	if (rendered.length === 0) {
		if (isShippedDefault) {
			throw new Error(
				`pi-shell-acp: shipped engraving carrier at ${filePath} is empty — it is the auto-memory ` +
					`containment lever; refusing to proceed with the carrier strip silently off. ` +
					`(opt out via an empty PI_SHELL_ACP_ENGRAVING_PATH file instead)`,
			);
		}
		return null;
	}
	return rendered;
}
