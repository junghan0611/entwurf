import { defineExtension,                   section } from "@earendil-works/pi-durable";
import { getAgentDir } from "entwurf-pi-dist:config.js";
import { loadProjectContextFiles } from "entwurf-pi-dist:core/resource-loader.js";
                                                                      
import { loadSkills,            } from "entwurf-pi-dist:core/skills.js";
import { buildSystemPromptSections } from "entwurf-pi-dist:core/system-prompt.js";
import { bashToolSystemPromptContribution } from "entwurf-pi-dist:core/tools/bash.js";
import { editToolSystemPromptContribution } from "entwurf-pi-dist:core/tools/edit.js";
import { readToolSystemPromptContribution } from "entwurf-pi-dist:core/tools/read.js";
import { writeToolSystemPromptContribution } from "entwurf-pi-dist:core/tools/write.js";

const CONTRIBUTIONS = {
	read: readToolSystemPromptContribution,
	bash: bashToolSystemPromptContribution,
	edit: editToolSystemPromptContribution,
	write: writeToolSystemPromptContribution,
};

/** pi's section order; `buildSystemPromptSections()` omits the ones without content. */
const KEYS = ["preamble", "tools", "rules", "docs", "project_context", "skills", "cwd"]         ;

/**
 * pi's system prompt as one extension: the sections of `buildSystemPromptSections()` for the request's tools and the
 * conversation's directory. Context files and skills load once per directory, like pi at startup.
 */
export function createPiPrompt(settings                 , fallbackCwd        ) {
	const resources = new Map                                                                                ();
	const load = (cwd        ) => {
		let found = resources.get(cwd);
		if (found === undefined) {
			const agentDir = getAgentDir();
			found = {
				contextFiles: loadProjectContextFiles({ cwd, agentDir }),
				skills: loadSkills({ cwd, agentDir, skillPaths: settings.getSkillPaths(), includeDefaults: true }).skills,
			};
			resources.set(cwd, found);
		}
		return found;
	};
	// The sections of one request render from one build.
	const built = new WeakMap                                     ();
	const build = (input             )                         => {
		let sections = built.get(input);
		if (sections === undefined) {
			sections = buildSections(input);
			built.set(input, sections);
		}
		return sections;
	};
	const buildSections = (input             )                         => {
		const cwd = input.env?.cwd ?? input.agent.cwd ?? fallbackCwd;
		const selectedTools = input.agent.tools.map((tool) => tool.name);
		const snippets                         = {};
		const guidelines                           = {};
		for (const name of selectedTools) {
			const contribution = CONTRIBUTIONS[name                              ];
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
