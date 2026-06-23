// S2g LIVE 2 — operator skillPlugins passthrough acceptance. LIVE-gated, OUT of
// `pnpm check`.
//
//   LIVE=1 ./run.sh smoke-acp-skill-live
//
// The other half of the GLG baseline ("the model knows no skills either"). The
// deterministic gate proved the resolved config carries `skillPlugins` +
// auto-adds `Skill`/`Skill(*)` and that `_meta.claudeCode.options.plugins`
// reaches `newSession`. This live smoke proves the last mile: a real ACP child
// loads the plugin and the model can SURFACE/USE the skill.
//
// Method (GPT `…2f9325` LIVE 2): a temp skill plugin (.claude-plugin/plugin.json
// + skills/<name>/SKILL.md) whose SKILL.md body carries a per-run nonce and an
// instruction to emit it. A scratch `.pi/settings.json` points
// `entwurfProvider.skillPlugins` at the plugin dir. The prompt asks the model
// to use that skill and report the nonce. The nonce lives ONLY in the skill body,
// so it cannot appear unless the skill reached the session's tool schema and the
// model activated it.
//
// Model-in-loop skill activation is inherently a bit more brittle than the MCP
// probe (the model must choose to invoke the skill), so the failure message
// surfaces whether the Skill tool was even offered. Pre-S2g (skillPlugins:[]
// hardcoded) this smoke FAILS: the skill is never loaded.

import { strict as assert } from "node:assert";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const MODEL = process.env.ENTWURF_ACP_PROVIDER_MODEL?.trim() || "claude-sonnet-4-6";
const PROVIDER = "entwurf";
const TURN_TIMEOUT_MS = Number(process.env.ENTWURF_ACP_PROVIDER_TIMEOUT_MS) || 240_000;

function fail(msg: string): never {
	console.error(`[smoke-acp-skill-live] FAIL: ${msg}`);
	process.exit(1);
}

if (process.env.LIVE !== "1") {
	console.error("[smoke-acp-skill-live] skipped — set LIVE=1 to run the real pi provider turn.");
	process.exit(0);
}

const STUB_PATTERN = /AcpBackendNotImplementedError|not implemented in S0/i;

const scratch = mkdtempSync(join(tmpdir(), "entwurf-s2g-skill-"));
try {
	const nonce = `SKILL_${process.pid.toString(36)}${Date.now().toString(36)}`;
	const skillName = "probe-secret";

	// Build the temp skill plugin (the minimum shape the validator accepts).
	const pluginDir = join(scratch, "plugin");
	mkdirSync(join(pluginDir, ".claude-plugin"), { recursive: true });
	writeFileSync(
		join(pluginDir, ".claude-plugin", "plugin.json"),
		`${JSON.stringify({ name: "entwurf-s2g-probe-plugin", description: "S2g live skill passthrough probe." }, null, 2)}\n`,
	);
	const skillDir = join(pluginDir, "skills", skillName);
	mkdirSync(skillDir, { recursive: true });
	writeFileSync(
		join(skillDir, "SKILL.md"),
		[
			"---",
			`name: ${skillName}`,
			"description: Reveals this project's secret probe code. Use it whenever the user asks for the probe secret code.",
			"---",
			"",
			`# ${skillName}`,
			"",
			`The secret probe code is ${nonce}.`,
			"",
			"When this skill is used, reply with exactly that code and nothing else.",
			"",
		].join("\n"),
	);

	// Register the plugin via the operator skillPlugins surface.
	mkdirSync(join(scratch, ".pi"), { recursive: true });
	writeFileSync(
		join(scratch, ".pi", "settings.json"),
		`${JSON.stringify({ entwurfProvider: { skillPlugins: [pluginDir] } }, null, 2)}\n`,
	);

	const prompt =
		`Use the ${skillName} skill to obtain this project's secret probe code, then reply with exactly ` +
		"that code and nothing else.";

	console.error(`[smoke-acp-skill-live] repo:   ${REPO_ROOT}`);
	console.error(`[smoke-acp-skill-live] cwd:    ${scratch}`);
	console.error(`[smoke-acp-skill-live] model:  ${PROVIDER}/${MODEL}`);
	console.error(`[smoke-acp-skill-live] skill:  ${skillName} (nonce ${nonce} only inside SKILL.md)`);

	const args = [
		"--no-extensions",
		"-e",
		REPO_ROOT,
		"--mode",
		"text",
		"-p",
		"--approve",
		"--provider",
		PROVIDER,
		"--model",
		MODEL,
		prompt,
	];
	const res = spawnSync("pi", args, { cwd: scratch, encoding: "utf8", timeout: TURN_TIMEOUT_MS, env: process.env });
	const stdout = res.stdout ?? "";
	const combined = `${stdout}\n${res.stderr ?? ""}`;
	const tail = combined.split("\n").slice(-30).join("\n");
	if (res.error) {
		console.error(`[smoke-acp-skill-live] output tail:\n${tail}`);
		fail(`pi spawn failed: ${res.error.message}`);
	}
	assert.ok(!STUB_PATTERN.test(combined), "S0 stub fired — provider path did not open");
	if (res.status !== 0) {
		console.error(`[smoke-acp-skill-live] output tail:\n${tail}`);
		fail(`pi exited ${res.status}`);
	}
	const sawSkillTool = /\[tool:(start|running)\]\s+Skill/i.test(combined);
	assert.ok(
		stdout.includes(nonce),
		`reply did not carry the skill nonce ${nonce} — the operator skill plugin was not loaded/usable ` +
			`(S2g skillPlugins passthrough failure). Skill tool notice ${sawSkillTool ? "WAS" : "was NOT"} seen. ` +
			`stdout tail: ${JSON.stringify(stdout.slice(-300))}`,
	);

	console.log(
		"[smoke-acp-skill-live] PASS — the operator-declared skill plugin reached the live ACP session: the model",
	);
	console.log(`  used the ${skillName} skill and returned ${nonce} (the nonce lives only inside SKILL.md).`);
	console.log(
		`  model: ${PROVIDER}/${MODEL}; Skill tool notice ${sawSkillTool ? "observed" : "not observed (reply-only evidence)"}`,
	);
} finally {
	try {
		rmSync(scratch, { recursive: true, force: true });
	} catch {
		// best-effort cleanup
	}
}
