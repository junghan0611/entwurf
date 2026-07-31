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
// signature would drift and entwurf would rebuild the ACP session every
// turn. The default-path source is cached once for exactly this reason, so a
// resident's carrier never drifts mid-session. The env-override path instead
// re-reads on EVERY call: editing that file mid-session INTENTIONALLY drifts the
// rendered carrier → bridgeConfigSignature changes → the live session is judged
// incompatible and the next turn opens a fresh ACP session with the new carrier.
// That per-turn rebuild is the accepted cost of the A/B opt-in surface, never the
// shipped default (which stays cached precisely so a resident never rebuilds).
//
// A-JOIN (measured LIVE 2026-07-31, 0.64.0 adapter, fresh Claude ACP): the model's
// system prompt arrived as
//   `You are a Claude agent, built on Anthropic's Claude Agent SDK.# Engraving Here`
// A string-form `_meta.systemPrompt` replaces the `claude_code` preset, but the
// SDK still PREFIXES its own fixed identity sentence and joins the two with
// NOTHING — so the operator's heading was swallowed into the tail of the SDK's
// sentence. The boundary therefore belongs to the CARRIER, and it cannot be
// delegated to engraving.md: the render is trimmed (below), so a leading blank
// line in the markdown is eaten before it ever reaches the wire.

import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const DEFAULT_ENGRAVING_PATH = join(HERE, "prompts", "engraving.md");

/**
 * The carrier's LEADING boundary — the one the Claude Agent SDK does not supply
 * (see A-JOIN above). A constant, never derived from the template, so the render
 * stays a pure function of (template, backend, mcpServerNames) and the operator's
 * file whitespace can never drift `bridgeConfigSignature`. One blank line is the
 * whole lever: it puts the carrier's first line at the start of its own block
 * instead of at the end of the SDK's fixed sentence.
 */
export const CARRIER_LEAD_SEPARATOR = "\n\n";

export interface EngravingParams {
	/** Always "claude" in practice — a system-prompt-carrier-less backend (cortex)
	 *  returns null from `loadCarrier` WITHOUT calling this loader, so claudeAdapter is
	 *  its only caller. Kept as a field so the `{{backend}}` token interpolates. */
	backend: string;
	/** MCP server names exposed to the session. SORTED before render for determinism. */
	mcpServerNames: readonly string[];
}

type CachedSource = { filePath: string; content: string };
let cached: CachedSource | null = null;

/** Point the loader at an alternate engraving file (A/B); bypasses the cache. */
function resolveEngravingPath(): string {
	const envPath = process.env.ENTWURF_ACP_ENGRAVING_PATH?.trim();
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
 * Render one template into a wire-ready carrier, or `""` when the template has no
 * body (the caller turns that into the opt-out / fail-loud branches).
 *
 * The ORDER here is the A-join fix. Trim first: the operator template's own
 * leading/trailing whitespace must not reach the wire (it would drift
 * bridgeConfigSignature) and the emptiness test must see the BODY — a
 * separator-only string is an opt-out, not a carrier. Then attach OUR boundary,
 * which is what the SDK's fixed sentence has nothing of.
 */
function renderCarrier(source: string, params: EngravingParams): string {
	const body = interpolate(source, params).trim();
	if (body.length === 0) return "";
	return `${CARRIER_LEAD_SEPARATOR}${body}`;
}

/**
 * The rendered engraving carrier, or null when an ENV-OVERRIDE engraving file
 * (`ENTWURF_ACP_ENGRAVING_PATH`) is empty, whitespace-only, missing, or
 * unreadable — that null is the operator opt-out. The SHIPPED default, by
 * contrast, IS the auto-memory containment lever (its non-empty carrier replaces
 * the claude_code preset, stripping the auto-memory advertisement) and MUST be
 * present + non-empty: if the shipped default is missing/unpackaged/empty this
 * THROWS (fail-loud, Detour C) rather than silently shipping with the carrier
 * strip off. To opt the carrier out, point the env override at an empty file.
 * Callers MUST treat null as "no carrier configured" and omit `_meta.systemPrompt`
 * entirely (passing "" as the `appendSystemPrompt` signature input) so
 * subscription billing is never reclassified.
 *
 * A non-null carrier always LEADS with `CARRIER_LEAD_SEPARATOR`, and callers must
 * pass it on BYTE-FOR-BYTE: the same string feeds `bridgeConfigSignature`
 * (`appendSystemPrompt`) and the wire (`_meta.systemPrompt`), so normalizing it at
 * either hop both re-opens the A-join and makes reuse key on a string that was
 * never sent.
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
				`entwurf: shipped engraving carrier unreadable at ${filePath} — it is the auto-memory ` +
					`containment lever; refusing to proceed with containment silently degraded. (${(err as Error).message})`,
			);
		}
		return null;
	}
	const rendered = renderCarrier(source, params);
	if (rendered.length === 0) {
		if (isShippedDefault) {
			throw new Error(
				`entwurf: shipped engraving carrier at ${filePath} is empty — it is the auto-memory ` +
					`containment lever; refusing to proceed with the carrier strip silently off. ` +
					`(opt out via an empty ENTWURF_ACP_ENGRAVING_PATH file instead)`,
			);
		}
		return null;
	}
	return rendered;
}
