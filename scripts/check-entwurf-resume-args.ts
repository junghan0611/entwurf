/**
 * check-entwurf-resume-args — deterministic gate for the 5c-3b resume-argv SSOT
 * (`buildResumePiArgs`). It pins the RESIDENT citizen launch shape so it cannot drift.
 * This gate once carried a second `legacy` one-shot variant as a contrast; that launcher
 * and its enum member were removed 2026-07-27, and the half of A1 that still ships is
 * asserted directly instead — a resumed citizen stands its control socket up and never
 * emits the one-shot `--no-extensions`:
 *
 *   2. v2-control carries `--entwurf-control` and NO `--no-extensions`.
 *   3. The headless prefix `--mode json -p` stays and the prompt is the final positional
 *      (the prompt-as-turn authority is unchanged in v2 — `-p` is NOT dropped).
 *   4. `explicitExtensionArgs` is preserved verbatim, exactly once
 *      (load-bearing for a recorded `provider=entwurf` resume; #29 footgun).
 *   5. `plan.launchArgs` (`--approve` / empty) ride as flags BEFORE the prompt.
 *   6. a null/undefined provider emits NO `--provider` flag; `--model <m>` and `<prompt>`
 *      are the last three tokens.
 *   7. the resident posture is exact: `--entwurf-control` present, `--no-extensions` never.
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
	// ── v2-control variant ──────────────────────────────────────────────────────────
	{
		const args = buildResumePiArgs({
			variant: "v2-control",
			sessionFile: SESSION_FILE,
			explicitExtensionArgs: EXT,
			provider: "entwurf",
			model: "claude-opus-5",
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
		ok("6 v2 model laid out", valueAfter(args, "--model") === "claude-opus-5");
		ok("6 v2 resumes by exact FILE (--session <abs path>)", valueAfter(args, "--session") === SESSION_FILE);
		ok(
			"6 v2 carries NO --session-id (a garden id would MINT a session, not resume one)",
			!args.includes("--session-id"),
		);
		ok(
			"6 v2 --model <m> <prompt> tail",
			args[args.length - 3] === "--model" &&
				args[args.length - 2] === "claude-opus-5" &&
				args[args.length - 1] === "resume now",
		);
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

	// ── 7. the resident posture is exact: the one-shot flag never reappears ───────────
	// The `legacy` variant was removed 2026-07-27, so the old cross-contamination pair is
	// gone. What must NOT rot is the A1 half that still ships: a resumed citizen stands its
	// control socket up, which means `--no-extensions` (the one-shot flag that let `pi -p`
	// exit) can never be emitted here again.
	{
		const v2 = buildResumePiArgs({
			sessionFile: SESSION_FILE,
			explicitExtensionArgs: EXT,
			provider: "entwurf",
			model: "m",
			prompt: "p",
			launchArgs: ["--approve"],
			variant: "v2-control",
		});
		ok("7 resident posture never emits the one-shot --no-extensions", !v2.includes("--no-extensions"));
		ok("7 resident posture stands the control socket up", v2.includes("--entwurf-control"));
	}

	console.log(`\ncheck-entwurf-resume-args: ${passed} checks passed`);
}

main();
