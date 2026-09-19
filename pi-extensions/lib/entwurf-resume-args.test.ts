/**
 * entwurf-resume-args — the resume-argv SSOT (`buildResumePiArgs`), proven beside the
 * builder it pins (#119 V3, slice 2).
 *
 * MIGRATED from scripts/check-entwurf-resume-args.ts. Every QK label is kept verbatim AND
 * each one is now its own test title, which is not cosmetic: this lane carries six mutants,
 * and `run_vitest` attributes a kill from the failed TEST TITLE (run.sh:104-113). A QK that
 * lived only in an assertion message would leave every mutant unattributed.
 *
 * The contract this gate holds changed with S1, and the change is the point: the builder used
 * to emit a HEADLESS child (`--mode json -p … <prompt>`) because its only caller was the
 * detached `spawn-bg` watcher. That transport was withdrawn, and the argv was MEASURED against
 * the runtime before the new consumer was written (2026-08-06, private tmux + fixture): dropped
 * into a tmux window, `-p` is pi's own "non-interactive mode" and the operator gets a JSON
 * stream instead of a session they can type into. The shape that actually reopens a visible
 * citizen carries neither.
 *
 * So this pins the ONE shipped posture, and pins the ABSENCES as hard as the presences — a
 * re-introduced `-p` would still open a window, still stand a socket up, and still look green
 * to anything that only asserted `--entwurf-control`.
 *
 * Pure string assembly — no IO, no spawn.
 */

import { describe, expect, it } from "vitest";

import { buildResumePiArgs } from "./entwurf-resume-args.ts";

// The resume target is a session FILE (#50 C2), not a garden id: the record owns the address,
// so argv only has to name WHICH transcript to reopen.
const SESSION_FILE =
	"/home/op/.pi/agent/sessions/-home-op-repo/2026-06-13T09-10-00-000Z_019e8faa-04ea-7b73-bf2c-1465d525c2e8.jsonl";
// Production shape, measured: getEntwurfExplicitExtensions emits `-e <path>`, not `--extension`.
const EXT = ["-e", "/path/to/entwurf/index.ts"] as const;

function valueAfter(args: readonly string[], flag: string): string | undefined {
	const i = args.indexOf(flag);
	return i === -1 ? undefined : args[i + 1];
}

/** The shipped posture with a recorded ACP provider — the only shape whose ext args are
 * non-empty, measured as `["-e", "<bridge>"]` on a real recorded provider=entwurf record. */
function acpShape(): string[] {
	return buildResumePiArgs({
		sessionFile: SESSION_FILE,
		explicitExtensionArgs: EXT,
		provider: "entwurf",
		model: "claude-sonnet-5",
	});
}

describe("the shipped posture, with a recorded ACP provider", () => {
	// Order was a contract in the hand-built gate and stays one here: the absences come first
	// because a re-introduced headless prefix ALSO displaces the leading flag, and "the argv is
	// headless again" is the truer diagnosis of that.
	it("[QK:RESUMEARGS-NO-HEADLESS] no --mode and no -p — `-p` is pi's non-interactive mode, so the headless prefix would open a window streaming JSON instead of a session the operator can use", () => {
		const args = acpShape();
		expect(args).not.toContain("--mode");
		expect(args).not.toContain("-p");
		expect(args).not.toContain("--print");
	});

	it("[QK:RESUMEARGS-CONTROL-FIRST] --entwurf-control is the FIRST token — the resumed session stands its control socket up, which is the whole difference between a restored transcript and an addressable citizen", () => {
		expect(acpShape()[0]).toBe("--entwurf-control");
	});

	it("[QK:RESUMEARGS-NO-PROMPT-TAIL] the argv ends at --model <m> with NO positional prompt — a resume reopens a conversation and runs no turn (measured: the transcript stayed byte-identical)", () => {
		const args = acpShape();
		expect(args[args.length - 2]).toBe("--model");
		expect(args[args.length - 1]).toBe("claude-sonnet-5");
	});

	it("no --no-extensions either: the one-shot posture that let `pi -p` exit is exactly what a resident resume must not emit", () => {
		expect(acpShape()).not.toContain("--no-extensions");
	});

	// SESSION-IS-FILE precedes the ext-args claim because the ext claim is stated RELATIVE to
	// `--session`: if that flag were renamed, the positional assertion below would go red about
	// the extensions while the actual defect is the flag that MINTS a session.
	it("[QK:RESUMEARGS-SESSION-IS-FILE] the builder targets an exact FILE via --session and never --session-id, which would CREATE the id when missing and silently mint an empty session instead of resuming one", () => {
		const args = acpShape();
		expect(valueAfter(args, "--session")).toBe(SESSION_FILE);
		expect(args).not.toContain("--session-id");
	});

	it("[QK:RESUMEARGS-EXT-ONCE-BEFORE-SESSION] the bridge args appear EXACTLY once and sit between --entwurf-control and --session — dropping them re-opens the #29 'Unknown provider' footgun, and doubling them is a different broken argv", () => {
		const args = acpShape();
		expect(args.filter((a) => a === "-e").length).toBe(1);
		expect(args.indexOf("--entwurf-control")).toBeLessThan(args.indexOf("-e"));
		expect(args.indexOf("-e")).toBeLessThan(args.indexOf("--session"));
	});

	it("a recorded provider is laid out as two tokens", () => {
		expect(valueAfter(acpShape(), "--provider")).toBe("entwurf");
	});

	it("model is laid out as two tokens", () => {
		expect(valueAfter(acpShape(), "--model")).toBe("claude-sonnet-5");
	});

	it("the full measured argv is reproduced exactly", () => {
		expect(acpShape().join(" ")).toBe(
			`--entwurf-control -e /path/to/entwurf/index.ts --session ${SESSION_FILE} --provider entwurf --model claude-sonnet-5`,
		);
	});
});

// The native shape: no recorded provider, no bridge. Measured as explicitExtensionArgs=[].
describe("the native shape, with no recorded provider", () => {
	it("[QK:RESUMEARGS-PROVIDER-OPTIONAL] provider=null/undefined: NO --provider flag is emitted — an empty flag value would be a different citizen's launch, not a missing one", () => {
		for (const provider of [null, undefined] as const) {
			const args = buildResumePiArgs({
				sessionFile: SESSION_FILE,
				explicitExtensionArgs: [],
				provider,
				model: "gpt-5.6-terra",
			});
			expect(args, `provider=${provider}`).not.toContain("--provider");
		}
	});

	it("the argv is exactly the four tokens the native shape needs", () => {
		for (const provider of [null, undefined] as const) {
			const args = buildResumePiArgs({
				sessionFile: SESSION_FILE,
				explicitExtensionArgs: [],
				provider,
				model: "gpt-5.6-terra",
			});
			expect(args.join(" "), `provider=${provider}`).toBe(
				`--entwurf-control --session ${SESSION_FILE} --model gpt-5.6-terra`,
			);
		}
	});
});
