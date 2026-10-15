import { isAbsolute, join, resolve } from "node:path";
import { defineExtension, type PromptInput, section } from "@earendil-works/pi-durable";
import { CONFIG_DIR_NAME, getAgentDir } from "../../config.ts";
import { loadProjectContextFiles } from "../../core/resource-loader.ts";
import type { SettingsManager } from "../../core/settings-manager.ts";
import { loadSkills, type Skill } from "../../core/skills.ts";
import { buildSystemPromptSections } from "../../core/system-prompt.ts";
import { bashToolSystemPromptContribution } from "../../core/tools/bash.ts";
import { editToolSystemPromptContribution } from "../../core/tools/edit.ts";
import { readToolSystemPromptContribution } from "../../core/tools/read.ts";
import { writeToolSystemPromptContribution } from "../../core/tools/write.ts";

const CONTRIBUTIONS = {
	read: readToolSystemPromptContribution,
	bash: bashToolSystemPromptContribution,
	edit: editToolSystemPromptContribution,
	write: writeToolSystemPromptContribution,
};

/** pi's section order; `buildSystemPromptSections()` omits the ones without content. */
const KEYS = ["preamble", "tools", "rules", "docs", "project_context", "skills", "cwd"] as const;

/** An entry pi reads as a pattern, not a path: an override or a glob. */
const PATTERN = /^[!+-]|[*?]/u;

/**
 * The `skills` setting with each scope's relative entries read against that scope's own directory, as pi resolves
 * them: the project's against the session directory's `.pi`, the global ones against the agent directory, the
 * project's first. Read against the conversation's directory, a relative entry names another place. Absolute, `~`
 * and pattern entries go on unchanged.
 */
function scopedSkillPaths(settings: SettingsManager, agentDir: string, projectCwd: string): string[] {
	const against = (entries: readonly string[] | undefined, base: string): string[] =>
		(entries ?? []).map((entry) => {
			const path = entry.trim();
			return path === "" || isAbsolute(path) || path === "~" || path.startsWith("~/") || PATTERN.test(path)
				? entry
				: resolve(base, path);
		});
	return [
		...against(settings.getProjectSettings().skills, join(projectCwd, CONFIG_DIR_NAME)),
		...against(settings.getGlobalSettings().skills, agentDir),
	];
}

/**
 * pi's system prompt as one extension: the sections of `buildSystemPromptSections()` for the request's tools and the
 * conversation's directory. Context files and skills load once per directory, like pi at startup.
 */
export function createPiPrompt(settings: SettingsManager, fallbackCwd: string) {
	const resources = new Map<string, { contextFiles: { path: string; content: string }[]; skills: Skill[] }>();
	const load = (cwd: string) => {
		let found = resources.get(cwd);
		if (found === undefined) {
			const agentDir = getAgentDir();
			found = {
				contextFiles: loadProjectContextFiles({ cwd, agentDir }),
				skills: loadSkills({
					cwd,
					agentDir,
					skillPaths: scopedSkillPaths(settings, agentDir, fallbackCwd),
					includeDefaults: true,
				}).skills,
			};
			resources.set(cwd, found);
		}
		return found;
	};
	// The sections of one request render from one build.
	const built = new WeakMap<PromptInput, Record<string, string>>();
	const build = (input: PromptInput): Record<string, string> => {
		let sections = built.get(input);
		if (sections === undefined) {
			sections = buildSections(input);
			built.set(input, sections);
		}
		return sections;
	};
	const buildSections = (input: PromptInput): Record<string, string> => {
		const cwd = input.env?.cwd ?? input.agent.cwd ?? fallbackCwd;
		const selectedTools = input.agent.tools.map((tool) => tool.name);
		const snippets: Record<string, string> = {};
		const guidelines: Record<string, string[]> = {};
		for (const name of selectedTools) {
			const contribution = CONTRIBUTIONS[name as keyof typeof CONTRIBUTIONS];
			if (contribution === undefined) continue;
			snippets[name] = contribution.snippet;
			guidelines[name] = [...contribution.guidelines];
		}
		return buildSystemPromptSections({
			cwd,
			selectedTools,
			toolSnippets: snippets,
			toolGuidelines: guidelines,
			...load(cwd),
		});
	};
	return defineExtension({
		name: "pi-prompt",
		// The built sections carry their own tags.
		sections: KEYS.map((key) => section(key, (input) => build(input)[key], { tag: false })),
	});
}
