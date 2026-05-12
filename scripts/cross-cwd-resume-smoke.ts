#!/usr/bin/env node --experimental-strip-types
/**
 * Cross-cwd fact-recall smoke for `entwurf_resume` (issue #9).
 *
 * Old `verify-resume` ran turn1 and turn2 inside the same `cd "$project_dir"`,
 * so the pi-shell-acp bridge saw the same cwd both times and the cwd-mismatch
 * branch of `isPersistedSessionCompatible` (acp-bridge.ts) was never exercised.
 * The regression that hit the demo flow needed cwd(turn1) != cwd(turn2): the
 * resumer's process.cwd() flowed into the bridge's persistence params and
 * silently invalidated the Scene 1 record, causing `newSession` fallback and
 * total backend memory loss.
 *
 * This script reproduces that shape end-to-end at the entwurf API layer (no
 * LLM-driven MCP plumbing, no tmux):
 *
 *   1. process.chdir($PROJECT_DIR) then runEntwurfSync({ cwd: $PROJECT_DIR })
 *      to spawn a sibling that plants a unique sentinel token.
 *   2. process.chdir($OTHER_DIR) then runEntwurfResumeSync(taskId, ..., { cwd: undefined })
 *      — the exact MCP-resume call shape. options.cwd is intentionally
 *      undefined so the fix's `readSessionHeader(sessionFile)?.cwd` fallback
 *      is what aligns the child spawn cwd with the original.
 *   3. Read the appended assistant turn from the saved JSONL and assert the
 *      sentinel was recalled. The model never sees the sentinel in its system
 *      prompt — recall is only possible through ACP-side transcript hydration
 *      keyed off the bridge's `pi:<sessionId>` -> `acpSessionId` mapping.
 *
 * Exit 0 = recalled, 1 = not recalled (regression present), 2 = setup failure.
 *
 * Cost: two short claude-sonnet-4-6 turns (~few cents). Acceptable for an
 * explicit verify-gate; not for tight CI.
 */
import fs from "node:fs";
import path from "node:path";

import { analyzeSessionFileLike, runEntwurfResumeSync, runEntwurfSync } from "../pi-extensions/lib/entwurf-core.ts";

interface CliArgs {
	projectDir: string;
	otherDir: string;
	model: string;
	sentinel: string;
}

function parseArgs(argv: string[]): CliArgs {
	const args: Record<string, string> = {};
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		if (!a) continue;
		if (a === "--project-dir" || a === "--other-dir" || a === "--model" || a === "--sentinel") {
			const v = argv[i + 1];
			if (!v) {
				console.error(`[cross-cwd-resume] missing value for ${a}`);
				process.exit(2);
			}
			args[a.slice(2)] = v;
			i++;
		}
	}
	const projectDir = args["project-dir"];
	const otherDir = args["other-dir"];
	if (!projectDir || !otherDir) {
		console.error(
			"usage: cross-cwd-resume-smoke.ts --project-dir <dir> --other-dir <dir> [--model <id>] [--sentinel <token>]",
		);
		process.exit(2);
	}
	return {
		projectDir: path.resolve(projectDir),
		otherDir: path.resolve(otherDir),
		model: args["model"] ?? "claude-sonnet-4-6",
		sentinel: args["sentinel"] ?? `cross-cwd-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
	};
}

function fail(stage: string, message: string, extra?: string): never {
	console.error(`[cross-cwd-resume] FAIL stage=${stage} ${message}`);
	if (extra) console.error(extra);
	process.exit(1);
}

async function main(): Promise<void> {
	const args = parseArgs(process.argv.slice(2));

	if (!fs.existsSync(args.projectDir)) fail("setup", `project-dir does not exist: ${args.projectDir}`);
	if (!fs.existsSync(args.otherDir)) fail("setup", `other-dir does not exist: ${args.otherDir}`);
	if (path.resolve(args.projectDir) === path.resolve(args.otherDir)) {
		fail("setup", "project-dir and other-dir must differ — that is the entire point of this gate");
	}

	console.error(`[cross-cwd-resume] project-dir: ${args.projectDir}`);
	console.error(`[cross-cwd-resume] other-dir:   ${args.otherDir}`);
	console.error(`[cross-cwd-resume] model:       ${args.model}`);
	console.error(`[cross-cwd-resume] sentinel:    ${args.sentinel}`);

	// Step 1 — spawn sibling at project-dir cwd.
	process.chdir(args.projectDir);
	console.error(`[cross-cwd-resume] step1: runEntwurfSync (cwd=${process.cwd()})`);
	const spawn = await runEntwurfSync(
		`You are a sibling for a recorded resume gate. Remember exactly this single fact: my favorite token is "${args.sentinel}". ` +
			`Reply with just the word READY. No tool calls. No exploration.`,
		{
			cwd: args.projectDir,
			host: "local",
			provider: "pi-shell-acp",
			model: args.model,
		},
	);
	if (spawn.exitCode !== 0 || !spawn.sessionFile) {
		fail("spawn", `runEntwurfSync rc=${spawn.exitCode} error=${spawn.error ?? "n/a"}`, spawn.output);
	}
	console.error(
		`[cross-cwd-resume] step1 ok: taskId=${spawn.taskId} turns=${spawn.turns} sessionFile=${spawn.sessionFile}`,
	);

	const beforeAnalysis = analyzeSessionFileLike(spawn.sessionFile);
	if (!beforeAnalysis.lastAssistantText || !beforeAnalysis.lastAssistantText.includes("READY")) {
		fail(
			"spawn-assert",
			`spawn assistant text did not include READY (got: ${beforeAnalysis.lastAssistantText?.slice(0, 200) ?? "null"})`,
		);
	}

	// Step 2 — resume from other-dir cwd. options.cwd intentionally undefined.
	// This is the MCP entwurf_resume shape: the resumer process is unrelated to
	// the original spawn process, so no in-process `info.cwd` exists.
	process.chdir(args.otherDir);
	console.error(`[cross-cwd-resume] step2: runEntwurfResumeSync (cwd=${process.cwd()}, options.cwd=undefined)`);
	const resume = await runEntwurfResumeSync(
		spawn.taskId,
		"Recall test. No tool calls. Reply with the exact token sentence: `token=<value>`. One line only.",
		{
			host: "local",
			// cwd intentionally undefined — the fix reads it from session header.
		},
	);
	if (resume.exitCode !== 0) {
		fail("resume", `runEntwurfResumeSync rc=${resume.exitCode} error=${resume.error ?? "n/a"}`, resume.output);
	}
	console.error(`[cross-cwd-resume] step2 ok: turns=${resume.turns} cost=${resume.cost}`);

	// Step 3 — assert recall.
	const afterAnalysis = analyzeSessionFileLike(spawn.sessionFile);
	const lastText = afterAnalysis.lastAssistantText ?? "";
	console.error(`[cross-cwd-resume] step3: last assistant text:\n  ${lastText.slice(0, 300)}`);

	if (!lastText.includes(args.sentinel)) {
		fail(
			"recall",
			`sentinel "${args.sentinel}" was NOT recalled. The bridge cwd-mismatch regression is present, or the fix did not apply.`,
			`Last assistant text:\n${lastText}`,
		);
	}

	console.error(`[cross-cwd-resume] PASS — sentinel recalled across cwd boundary.`);
}

main().catch((err) => {
	console.error(`[cross-cwd-resume] FAIL stage=exception ${err instanceof Error ? err.stack : String(err)}`);
	process.exit(1);
});
