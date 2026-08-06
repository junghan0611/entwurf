/**
 * check-entwurf-resume-args — deterministic gate for the resume-argv SSOT (`buildResumePiArgs`).
 *
 * The contract this gate holds changed with S1, and the change is the point: the builder used to
 * emit a HEADLESS child (`--mode json -p … <prompt>`) because its only caller was the detached
 * `spawn-bg` watcher. That transport was withdrawn, and the argv was MEASURED against the runtime
 * before the new consumer was written (2026-08-06, private tmux + fixture): dropped into a tmux
 * window, `-p` is pi's own "non-interactive mode" and the operator gets a JSON stream instead of a
 * session they can type into. The shape that actually reopens a visible citizen carries neither.
 *
 * So this gate pins the ONE shipped posture, and pins the absences as hard as the presences —
 * a re-introduced `-p` would still open a window, still stand a socket up, and still look green
 * to anything that only asserted `--entwurf-control`:
 *
 *   RESUMEARGS-CONTROL-FIRST     `--entwurf-control` leads, so the resumed session is addressable
 *   RESUMEARGS-NO-HEADLESS       no `--mode`, no `-p` — the window is interactive
 *   RESUMEARGS-NO-PROMPT-TAIL    no positional prompt — a resume runs no turn
 *   RESUMEARGS-EXT-ONCE-BEFORE-SESSION  bridge args exactly once, between control and --session
 *   RESUMEARGS-PROVIDER-OPTIONAL a recorded provider is emitted, an absent one emits no flag
 *   RESUMEARGS-SESSION-IS-FILE   `--session <abs path>`, never `--session-id` (which MINTS)
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

// The resume target is a session FILE (#50 C2), not a garden id: the record owns the address, so
// argv only has to name WHICH transcript to reopen.
const SESSION_FILE =
	"/home/op/.pi/agent/sessions/-home-op-repo/2026-06-13T09-10-00-000Z_019e8faa-04ea-7b73-bf2c-1465d525c2e8.jsonl";
// Production shape, measured: getEntwurfExplicitExtensions emits `-e <path>`, not `--extension`.
const EXT = ["-e", "/path/to/entwurf/index.ts"] as const;

function valueAfter(args: readonly string[], flag: string): string | undefined {
	const i = args.indexOf(flag);
	return i === -1 ? undefined : args[i + 1];
}

function main(): void {
	// ── The shipped posture, with a recorded ACP provider (the only shape whose ext args are
	//    non-empty — measured as `["-e", "<bridge>"]` on a real recorded provider=entwurf record).
	{
		const args = buildResumePiArgs({
			sessionFile: SESSION_FILE,
			explicitExtensionArgs: EXT,
			provider: "entwurf",
			model: "claude-sonnet-5",
		});

		// Assertion order is a contract, not a reading preference: each claim must be the FIRST
		// one a defect against it reaches, or a red would be reported under someone else's name.
		// The absences come first because a re-introduced headless prefix also displaces the
		// leading flag, and "the argv is headless again" is the truer diagnosis of that.
		ok(
			"[QK:RESUMEARGS-NO-HEADLESS] no --mode and no -p — `-p` is pi's non-interactive mode, so the headless prefix would open a window streaming JSON instead of a session the operator can use",
			!args.includes("--mode") && !args.includes("-p") && !args.includes("--print"),
		);
		ok(
			"[QK:RESUMEARGS-CONTROL-FIRST] --entwurf-control is the FIRST token — the resumed session stands its control socket up, which is the whole difference between a restored transcript and an addressable citizen",
			args[0] === "--entwurf-control",
		);
		ok(
			"[QK:RESUMEARGS-NO-PROMPT-TAIL] the argv ends at --model <m> with NO positional prompt — a resume reopens a conversation and runs no turn (measured: the transcript stayed byte-identical)",
			args[args.length - 2] === "--model" && args[args.length - 1] === "claude-sonnet-5",
		);
		ok(
			"no --no-extensions either: the one-shot posture that let `pi -p` exit is exactly what a resident resume must not emit",
			!args.includes("--no-extensions"),
		);

		// SESSION-IS-FILE precedes the ext-args claim because the ext claim is stated RELATIVE to
		// `--session`: if that flag were renamed, the positional assertion below would go red about
		// the extensions while the actual defect is the flag that MINTS a session.
		ok(
			"[QK:RESUMEARGS-SESSION-IS-FILE] the builder targets an exact FILE via --session and never --session-id, which would CREATE the id when missing and silently mint an empty session instead of resuming one",
			valueAfter(args, "--session") === SESSION_FILE && !args.includes("--session-id"),
		);
		ok(
			"[QK:RESUMEARGS-EXT-ONCE-BEFORE-SESSION] the bridge args appear EXACTLY once and sit between --entwurf-control and --session — dropping them re-opens the #29 'Unknown provider' footgun, and doubling them is a different broken argv",
			args.filter((a) => a === "-e").length === 1 &&
				args.indexOf("--entwurf-control") < args.indexOf("-e") &&
				args.indexOf("-e") < args.indexOf("--session"),
		);
		ok("a recorded provider is laid out as two tokens", valueAfter(args, "--provider") === "entwurf");
		ok("model is laid out as two tokens", valueAfter(args, "--model") === "claude-sonnet-5");
		ok(
			"the full measured argv is reproduced exactly",
			args.join(" ") ===
				`--entwurf-control -e /path/to/entwurf/index.ts --session ${SESSION_FILE} --provider entwurf --model claude-sonnet-5`,
		);
	}

	// ── The native shape: no recorded provider, no bridge. Measured as explicitExtensionArgs=[].
	for (const provider of [null, undefined] as const) {
		const args = buildResumePiArgs({
			sessionFile: SESSION_FILE,
			explicitExtensionArgs: [],
			provider,
			model: "gpt-5.6-terra",
		});
		ok(
			`[QK:RESUMEARGS-PROVIDER-OPTIONAL] provider=${provider}: NO --provider flag is emitted — an empty flag value would be a different citizen's launch, not a missing one`,
			!args.includes("--provider"),
		);
		ok(
			`provider=${provider}: the argv is exactly the four tokens the native shape needs`,
			args.join(" ") === `--entwurf-control --session ${SESSION_FILE} --model gpt-5.6-terra`,
		);
	}

	console.log(`\ncheck-entwurf-resume-args: ${passed} checks passed`);
}

main();
