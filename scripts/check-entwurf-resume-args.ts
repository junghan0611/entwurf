/**
 * check-entwurf-resume-args — deterministic gate for the 5c-3b resume-argv SSOT
 * (`buildResumePiArgs`). It pins the load-bearing A1 difference between the legacy one-shot
 * worker and the v2 spawn-bg RESIDENT citizen so the two launch shapes can never drift:
 *
 *   1. legacy carries `--no-extensions` and NO `--entwurf-control`.
 *   2. v2-control carries `--entwurf-control` and NO `--no-extensions`.
 *   3. BOTH keep the headless prefix `--mode json -p` and run the prompt as the final
 *      positional (the prompt-as-turn authority is unchanged in v2 — `-p` is NOT dropped).
 *   4. `explicitExtensionArgs` is preserved verbatim, exactly once, in BOTH variants
 *      (load-bearing for a recorded `provider=entwurf` resume; #29 footgun).
 *   5. v2-control includes `plan.launchArgs` (`--approve` / empty) as flags BEFORE the
 *      prompt; legacy ignores launchArgs entirely.
 *   6. provider/model identity is laid out identically in both; a null/undefined provider
 *      emits NO `--provider` flag; `--model <m>` and `<prompt>` are the last three tokens.
 *   7. no cross-contamination: the legacy-only and v2-only flags never leak into the other.
 *
 * Pure string assembly — no IO, no spawn.
 */

import assert from "node:assert/strict";
import { buildResumePiArgs } from "../pi-extensions/lib/entwurf-resume-args.ts";

let passed = 0;
function ok(label: string, cond: boolean): void {
	assert.ok(cond, label);
	console.log(`  ok    ${label}`);
	passed++;
}

// The resume target is a session FILE now (#50 C2), not a garden id: the record owns
// the address, so argv only has to name WHICH transcript to reopen. An absolute path
// is the production shape (record.transcriptPath).
const SESSION_FILE =
	"/home/op/.pi/agent/sessions/-home-op-repo/2026-06-13T09-10-00-000Z_019e8faa-04ea-7b73-bf2c-1465d525c2e8.jsonl";
// Real production shape: getEntwurfExplicitExtensions emits `-e <path>` (entwurf-core.ts),
// NOT `--extension`. The builder spreads verbatim, but the fixture mirrors production so the
// "preserved exactly once" assertion exercises the token the launcher actually passes.
const EXT = ["-e", "/path/to/entwurf/index.ts"] as const;

// index of token `flag`'s VALUE (the token right after it), or -1 if the flag is absent.
function valueAfter(args: readonly string[], flag: string): string | undefined {
	const i = args.indexOf(flag);
	return i === -1 ? undefined : args[i + 1];
}

function main(): void {
	// ── legacy variant ──────────────────────────────────────────────────────────────
	{
		const args = buildResumePiArgs({
			variant: "legacy",
			sessionFile: SESSION_FILE,
			explicitExtensionArgs: EXT,
			provider: "entwurf",
			model: "claude-opus-4-8",
			prompt: "continue the task",
		});
		ok("1 legacy has --no-extensions", args.includes("--no-extensions"));
		ok("1 legacy has NO --entwurf-control", !args.includes("--entwurf-control"));
		ok("3 legacy headless prefix --mode json -p", args[0] === "--mode" && args[1] === "json" && args[2] === "-p");
		ok("3 legacy prompt is the final positional", args[args.length - 1] === "continue the task");
		ok("4 legacy keeps ext args exactly once", args.filter((a) => a === "-e").length === 1);
		ok("6 legacy provider laid out", valueAfter(args, "--provider") === "entwurf");
		ok("6 legacy model laid out", valueAfter(args, "--model") === "claude-opus-4-8");
		ok("6 legacy resumes by exact FILE (--session <abs path>)", valueAfter(args, "--session") === SESSION_FILE);
		ok("6 legacy carries NO --session-id (the id is pi's own now)", !args.includes("--session-id"));
		// model + prompt are the last three tokens: --model <m> <prompt>
		ok(
			"6 legacy --model <m> <prompt> tail",
			args[args.length - 3] === "--model" &&
				args[args.length - 2] === "claude-opus-4-8" &&
				args[args.length - 1] === "continue the task",
		);
	}

	// ── v2-control variant ──────────────────────────────────────────────────────────
	{
		const args = buildResumePiArgs({
			variant: "v2-control",
			sessionFile: SESSION_FILE,
			explicitExtensionArgs: EXT,
			provider: "entwurf",
			model: "claude-opus-4-8",
			prompt: "resume now",
			launchArgs: ["--approve"],
		});
		ok("2 v2 has --entwurf-control", args.includes("--entwurf-control"));
		ok("2 v2 has NO --no-extensions", !args.includes("--no-extensions"));
		ok("3 v2 keeps -p (prompt-as-turn NOT dropped)", args.includes("-p"));
		ok("3 v2 headless prefix --mode json -p", args[0] === "--mode" && args[1] === "json" && args[2] === "-p");
		ok("3 v2 prompt is the final positional", args[args.length - 1] === "resume now");
		ok("4 v2 keeps ext args exactly once", args.filter((a) => a === "-e").length === 1);
		ok("5 v2 includes launchArgs --approve", args.includes("--approve"));
		ok("5 v2 --approve is before the prompt", args.indexOf("--approve") < args.length - 1);
		ok("6 v2 provider laid out", valueAfter(args, "--provider") === "entwurf");
		ok("6 v2 model laid out", valueAfter(args, "--model") === "claude-opus-4-8");
		ok("6 v2 resumes by exact FILE (--session <abs path>)", valueAfter(args, "--session") === SESSION_FILE);
		ok(
			"6 v2 carries NO --session-id (a garden id would MINT a session, not resume one)",
			!args.includes("--session-id"),
		);
		ok(
			"6 v2 --model <m> <prompt> tail",
			args[args.length - 3] === "--model" &&
				args[args.length - 2] === "claude-opus-4-8" &&
				args[args.length - 1] === "resume now",
		);
	}

	// ── 5. legacy IGNORES launchArgs (no --approve leaks in) ──────────────────────────
	{
		const args = buildResumePiArgs({
			variant: "legacy",
			sessionFile: SESSION_FILE,
			explicitExtensionArgs: [],
			provider: null,
			model: "m",
			prompt: "p",
			launchArgs: ["--approve"], // present in input but legacy must ignore it
		});
		ok("5 legacy ignores launchArgs (no --approve)", !args.includes("--approve"));
	}

	// ── 6. null/undefined provider emits NO --provider flag ───────────────────────────
	for (const provider of [null, undefined] as const) {
		const args = buildResumePiArgs({
			variant: "v2-control",
			sessionFile: SESSION_FILE,
			explicitExtensionArgs: [],
			provider,
			model: "m",
			prompt: "p",
			launchArgs: [],
		});
		ok(`6 provider=${provider}: no --provider flag`, !args.includes("--provider"));
		ok(`6 provider=${provider}: --model <m> <prompt> still tail`, args.slice(-3).join(" ") === "--model m p");
	}

	// ── 7. no cross-contamination across variants over the same identity ──────────────
	{
		const base = {
			sessionFile: SESSION_FILE,
			explicitExtensionArgs: EXT,
			provider: "entwurf",
			model: "m",
			prompt: "p",
			launchArgs: ["--approve"],
		} as const;
		const legacy = buildResumePiArgs({ ...base, variant: "legacy" });
		const v2 = buildResumePiArgs({ ...base, variant: "v2-control" });
		ok("7 legacy-only flag absent from v2", !v2.includes("--no-extensions"));
		ok("7 v2-only flag absent from legacy", !legacy.includes("--entwurf-control") && !legacy.includes("--approve"));
	}

	console.log(`\ncheck-entwurf-resume-args: ${passed} checks passed`);
}

main();
