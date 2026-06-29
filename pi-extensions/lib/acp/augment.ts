// ACP plugin — first-user-message context augment + entwurf de-dup (S2d-1c).
//
// The rich context the ACP-side agent needs — bridge identity, the
// task-execution stance, pi's base intro + tool surface, the operator's
// `~/AGENTS.md`, the project's `cwd/AGENTS.md`, date + cwd — is delivered as a
// text block PREPENDED to the first prompt of a `bootstrapPath="new"` session,
// NOT via `_meta.systemPrompt`.
//
// Why first-user-message and not the carrier (NEXT §S2-scout 핀1, oracle A):
// growing `_meta.systemPrompt` materially past the SDK-default size reclassifies a
// subscription call as metered → HTTP 400. A long FIRST USER MESSAGE is
// structurally identical to any other user prompt and does not touch billing
// classification, so the rich context rides here while engraving.ts keeps the
// carrier tiny (a small non-empty string whose real job is replacing the preset
// to strip auto-memory, not carrying context).
//
// once-only (NEXT §S2d gate ②, GPT c32a6c8): this augment is prepended to the
// `new` prompt ONLY. `new` happens exactly once per ACP session lifecycle
// (subsequent turns are `reuse` delta-only; an incompatible drift opens a
// genuinely new ACP session that correctly gets the augment again). The augment
// is prepended at the WIRE level (to the AcpTextBlock[]), never mutated into the
// pi Context, so `contextMessageSignatures(context)` never sees it — that is what
// keeps the augment out of the reuse-compat signature with no extra bookkeeping.
//
// Entwurf de-dup: when an entwurf-spawned task is the first user message,
// `enrichTaskWithProjectContext` (entwurf-core.ts) has already prepended a
// `<project-context path="${cwd}/AGENTS.md">` block carrying the cwd AGENTS.md.
// Augmenting that prompt with the SAME cwd AGENTS.md section would duplicate it,
// so we drop only the cwd-AGENTS section and keep the rest of the augment.

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { ENTWURF_PROJECT_CONTEXT_OPEN_TAG } from "../../../protocol.js";
import type { AcpTextBlock } from "./context.js";

const MAX_AUGMENT_BYTES = 50 * 1024;

export interface PiContextAugmentParams {
	/** Claude-only this cut; kept as a field so the narrative names the backend. */
	backend: string;
	cwd: string;
	mcpServerNames: readonly string[];
	emacsAgentSocket?: string;
	/** Home dir to read `~/AGENTS.md` from. Defaults to os.homedir() (gate seam). */
	homeDir?: string;
}

/**
 * Build the augment text to prepend to the first user message of a NEW ACP
 * session. Day-granularity date so two prompts on the same calendar day produce
 * the same augment. Truncated to 50KB. Pure w.r.t. (cwd, backend, sorted
 * mcpServerNames, AGENTS.md contents, calendar day).
 */
export function buildPiContextAugment(params: PiContextAugmentParams): string {
	const names = [...params.mcpServerNames].sort();
	const mcpList = names.length > 0 ? names.join(", ") : "(none registered)";

	const sections: string[] = [];

	// Bridge identity + caller-side sibling stance. The closing line is a
	// caller-perspective statement: when THIS session throws an entwurf, the peer
	// on the other end is a sibling, not a worker.
	sections.push(
		[
			"You are operating through entwurf, an ACP bridge between pi (the harness) and the underlying model.",
			`Backend: ${params.backend}.`,
			`Connected MCP servers: ${mcpList}.`,
			"When entwurf is invoked, you do not spawn workers — you summon sibling agents through this bridge.",
		].join("\n"),
	);

	// Receiver-side task-execution stance. A SEPARATE paragraph so the caller
	// stance above does not bleed into how incoming tasks are read.
	sections.push(
		"A task is a task: execute what you receive, regardless of transport (spawn/resume/send) or source (GLG or sibling). The only thing you do not do on your own is forward your task to another sibling — if you cannot or should not do it, say so to GLG instead.",
	);

	sections.push(
		[
			"You are an expert coding assistant operating inside pi, a coding agent harness.",
			"You help users by reading files, executing commands, editing code, and writing new files.",
			"",
			"Tool surface:",
			"- Treat the actual callable function/tool schema exposed in this session as the source of truth.",
			"- Do not assume a tool exists only because this context or AGENTS.md mentions it.",
			"- Pi-level work generally includes reading files, running shell commands, editing files, and writing files; concrete tool names differ by backend.",
			"- Native pi may expose read/bash/edit/write; Claude ACP may expose Read/Bash/Edit/Write/Skill; Codex ACP may expose exec_command/apply_patch/write_stdin/update_plan.",
			"- MCP/custom tools are usable only when they appear in the actual tool schema for this session.",
		].join("\n"),
	);

	if (params.emacsAgentSocket) {
		sections.push(
			[
				"Emacs integration:",
				`- Agent Emacs socket: ${params.emacsAgentSocket}`,
				'- When using emacsclient from shell/Bash, prefer `emacsclient -s "$PI_EMACS_AGENT_SOCKET" --eval ...`.',
				"- Do not hardcode `-s server` unless the user explicitly asks for that socket.",
			].join("\n"),
		);
	}

	const projectContextParts: string[] = [];
	const homeBase = params.homeDir ?? homedir();
	const homeAgents = join(homeBase, "AGENTS.md");
	const cwdAgents = join(params.cwd, "AGENTS.md");

	if (existsSync(homeAgents)) {
		const content = readAgents(homeAgents);
		if (content) projectContextParts.push(`## ${homeAgents}\n\n${content}`);
	}
	if (existsSync(cwdAgents) && cwdAgents !== homeAgents) {
		const content = readAgents(cwdAgents);
		if (content) projectContextParts.push(`## ${cwdAgents}\n\n${content}`);
	}

	if (projectContextParts.length > 0) {
		sections.push(
			["# Project Context", "", "Project-specific instructions and guidelines:", "", ...projectContextParts].join("\n"),
		);
	}

	const currentDate = new Intl.DateTimeFormat("en-CA", {
		timeZone: "Asia/Seoul",
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
	}).format(new Date());
	sections.push([`Current date: ${currentDate}`, `Current working directory: ${params.cwd}`].join("\n"));

	return truncateAugment(sections.join("\n\n"));
}

function readAgents(filePath: string): string {
	try {
		return readFileSync(filePath, "utf8").trim();
	} catch (error) {
		throw new Error(
			`Failed to read AGENTS.md at ${filePath}: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
}

function truncateAugment(text: string): string {
	if (Buffer.byteLength(text, "utf8") <= MAX_AUGMENT_BYTES) return text;
	const marker = `\n\n[entwurf: context augment truncated to ${MAX_AUGMENT_BYTES} bytes; read AGENTS.md files directly if more detail is needed.]`;
	const markerBytes = Buffer.byteLength(marker, "utf8");
	let end = text.length;
	while (end > 0 && Buffer.byteLength(text.slice(0, end), "utf8") + markerBytes > MAX_AUGMENT_BYTES) {
		end = Math.max(0, end - 1024);
	}
	while (end < text.length && Buffer.byteLength(text.slice(0, end + 1), "utf8") + markerBytes <= MAX_AUGMENT_BYTES) {
		end++;
	}
	return `${text.slice(0, end).trimEnd()}${marker}`;
}

/** trimEnd + a trailing blank line so the augment block reads as its own unit. */
function ensurePromptSeparator(text: string): string {
	const trimmed = text.trimEnd();
	return trimmed.length > 0 ? `${trimmed}\n\n` : trimmed;
}

/**
 * The exact opening tag `enrichTaskWithProjectContext` emits for THIS cwd. The
 * path is included so the check cannot false-match a project-context block for a
 * different directory.
 */
function entwurfCwdContextOpenTag(cwd: string): string {
	return `${ENTWURF_PROJECT_CONTEXT_OPEN_TAG} path="${join(cwd, "AGENTS.md")}">`;
}

/**
 * True when the prompt we are about to send already carries the entwurf
 * project-context block for this cwd (so the augment's cwd-AGENTS section would
 * duplicate it). In this cut the `new` prompt is the whole flattened transcript,
 * so the marker can sit anywhere inside it — `includes`, not `startsWith`.
 */
export function promptCarriesEntwurfCwdContext(promptText: string, cwd: string): boolean {
	return promptText.includes(entwurfCwdContextOpenTag(cwd));
}

/**
 * Remove ONLY the `## ${cwd}/AGENTS.md` subsection from the augment, keeping the
 * bridge narrative, pi base, home AGENTS.md, and date/cwd. If dropping it leaves
 * the "# Project Context" section with no remaining subsection, drop the empty
 * header too. Ported verbatim from 0.11.0 acp-bridge.ts.
 */
export function removeCwdAgentsSectionFromAugment(text: string, cwd: string): string {
	const heading = `## ${join(cwd, "AGENTS.md")}\n\n`;
	const start = text.indexOf(heading);
	if (start < 0) return text;

	const afterHeading = start + heading.length;
	const nextProjectHeading = text.indexOf("\n\n## ", afterHeading);
	const currentDateSection = text.indexOf("\n\nCurrent date:", afterHeading);
	const candidates = [nextProjectHeading, currentDateSection].filter((idx) => idx >= 0);
	const end = candidates.length > 0 ? Math.min(...candidates) : text.length;
	let result = `${text.slice(0, start).trimEnd()}${text.slice(end)}`;

	const projectHeader = "# Project Context\n\nProject-specific instructions and guidelines:";
	const projectStart = result.indexOf(projectHeader);
	if (projectStart >= 0) {
		const projectEnd = result.indexOf("\n\nCurrent date:", projectStart + projectHeader.length);
		const projectBody =
			projectEnd >= 0
				? result.slice(projectStart + projectHeader.length, projectEnd)
				: result.slice(projectStart + projectHeader.length);
		if (!projectBody.includes("\n## ")) {
			result =
				projectEnd >= 0
					? `${result.slice(0, projectStart).trimEnd()}${result.slice(projectEnd)}`
					: result.slice(0, projectStart).trimEnd();
		}
	}

	return result.trim();
}

/**
 * Prepend the first-user-message augment to a `new` session's prompt blocks.
 *
 * De-dup: if `promptBlocks` already carry the entwurf project-context for this
 * cwd, the augment's cwd-AGENTS section is dropped first. The pi Context is NEVER
 * touched — the augment lives only on the wire, so it stays out of
 * `contextMessageSignatures`. A whitespace-only augment is omitted entirely.
 */
export function prependNewPromptAugment(promptBlocks: AcpTextBlock[], params: PiContextAugmentParams): AcpTextBlock[] {
	const promptText = promptBlocks.map((b) => b.text).join("\n");
	let augment = buildPiContextAugment(params);
	if (promptCarriesEntwurfCwdContext(promptText, params.cwd)) {
		augment = removeCwdAgentsSectionFromAugment(augment, params.cwd);
	}
	const separated = ensurePromptSeparator(augment);
	if (!separated) return promptBlocks;
	return [{ type: "text", text: separated }, ...promptBlocks];
}
