/**
 * resume-cli — the operator's terminal entry to the same-id visible resume (#173 C2), proven beside
 * the module.
 *
 * The leaf's own contract (record authority, lock order, dormancy proofs, the two receipts) is
 * `entwurf-v2-visible-resume.test.ts`'s and is not repeated here. What this entry adds is small and
 * is everything this file measures: the argv shape, an unchanged target, no attribution, the stream
 * and the exit code. No tmux, no record store and no process is touched: the one seam (`resume`) is
 * a recording fake, and the production wiring is read from source.
 *
 * Each claim is its own test title, because `run_vitest` attributes a mutant kill from the failed
 * TEST TITLE:
 *
 *   RESUMECLI-TARGET-PASSTHROUGH   the argv string reaches the leaf unchanged, exactly once
 *   RESUMECLI-USAGE-RUNS-NOTHING   any argv that is not exactly one non-flag word is exit 2 and
 *                                  never reaches the leaf
 *   RESUMECLI-EXIT-FROM-RESULT     the exit code is read from the structured result: positive
 *                                  same-id observation 0, launched without it 3, refused 4, failed
 *                                  at the launch step 5 whatever its recovery says
 *   RESUMECLI-UNKNOWN-OBSERVATION  an observation kind this entry does not know is never exit 0
 *   RESUMECLI-UNATTRIBUTED         the receipt is rendered with no actor — never an invented id
 *   RESUMECLI-REFUSAL-ON-STDERR    a refusal is a diagnostic on stderr with an empty stdout; a
 *                                  receipt is the product on stdout
 *   RESUMECLI-THROW-IS-EXIT-ONE    a leaf throw is printed as written and is exit 1, not a refusal
 *   RESUMECLI-SHARED-LEAF          production is the leaf through the shared launcher, and this
 *                                  module imports no launcher, rail leaf or record store of its own
 *   RESUMECLI-CONTEXT-BEFORE-LEAF  a terminal with no launch context is refused early by name,
 *                                  with the leaf never called; a usage error still wins over it
 *   RESUMECLI-CONTEXT-HERDR        inside herdr no tmux variable is asked for
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { VisibleResumeResult } from "./entwurf-v2-visible-resume.ts";
import {
	RESUME_CLI_EXIT,
	RESUME_CLI_USAGE,
	type ResumeCliDeps,
	resumeCliExitCode,
	runResumeCli,
} from "./resume-cli.ts";

// The label is the contract, so it travels as expect's message.
function ok(label: string, cond: boolean): void {
	expect(cond, label).toBe(true);
}

const GID = "20261124T120000-abc123";
const HANDLE = {
	rail: "tmux" as const,
	serverPid: "4242",
	sessionId: "$0",
	windowId: "@7",
	windowIndex: "7",
	paneId: "%9",
	panePid: "4300",
	runtimePath: "/bin/pi",
	cwd: "/project",
};
const PI_LAUNCH = { backend: "pi" as const, targetGardenId: GID, sessionFile: "/s/a.jsonl", handle: HANDLE };
const CC_LAUNCH = { backend: "claude-code" as const, targetGardenId: GID, nativeSessionId: "native-1", handle: HANDLE };
const PD_LAUNCH = {
	backend: "pi-durable" as const,
	targetGardenId: GID,
	cwd: "/project",
	reservation: { generation: "g1", resource: "r1", ownerPid: 4301 },
	handle: HANDLE,
};

const BACK_PI: VisibleResumeResult = {
	ok: true,
	launch: PI_LAUNCH,
	observation: { kind: "socket-alive", socketPath: "/sock", waitedMs: 12 },
};
const UNOBSERVED_PI: VisibleResumeResult = {
	ok: true,
	launch: PI_LAUNCH,
	observation: { kind: "resume-unobserved", socketPath: "/sock", waitedMs: 5000 },
};
const REFUSED_LIVE: VisibleResumeResult = { ok: false, reason: "target-live", detail: "the socket answered" };
const LAUNCH_FAILED: VisibleResumeResult = {
	ok: false,
	reason: "launch-failed",
	detail: "the tab was created and the agent start failed",
	failure: { rail: "herdr", recovery: { outcome: "unknown" } },
};

/** Every recovery the leaf preserves for a failed launch. `none` created nothing and `unknown` may
 * have: neither is this entry's to re-type, so all four are the launch-step failure code. */
const LAUNCH_FAILED_ANY_RECOVERY: VisibleResumeResult[] = [
	{ ok: false, reason: "launch-failed", detail: "d", failure: { rail: "herdr", recovery: { outcome: "none" } } },
	{
		ok: false,
		reason: "launch-failed",
		detail: "d",
		failure: { rail: "herdr-layout", recovery: { outcome: "none" } },
	},
	LAUNCH_FAILED,
	{
		ok: false,
		reason: "launch-failed",
		detail: "d",
		failure: { rail: "herdr", recovery: { outcome: "closed", paneId: "p1", terminalId: "t1" } },
	},
	{
		ok: false,
		reason: "launch-failed",
		detail: "d",
		failure: { rail: "herdr", recovery: { outcome: "orphan-unreclaimed", paneId: "p1", reason: "terminal-mismatch" } },
	},
];

/** A terminal inside tmux: both variables, a native pane id. */
const IN_TMUX: NodeJS.ProcessEnv = { TMUX: "/tmp/tmux-1000/default,4242,0", TMUX_PANE: "%1" };

/** A recording fake of the leaf seam, in the given environment. The leaf is where the lock, the
 * reservation and the launch live, so zero calls here is zero of each; the real launcher's own
 * side effects are the leaf tests' subject, not this fake's. */
function recording(
	result: VisibleResumeResult | Error,
	env: NodeJS.ProcessEnv = IN_TMUX,
): { deps: ResumeCliDeps; seen: string[] } {
	const seen: string[] = [];
	return {
		seen,
		deps: {
			env,
			resume: async (target) => {
				seen.push(target);
				if (result instanceof Error) throw result;
				return result;
			},
		},
	};
}

describe("entwurf resume <garden-id>", () => {
	it("[QK:RESUMECLI-TARGET-PASSTHROUGH] the argv string reaches the leaf unchanged and exactly once — a trimmed, lowercased, defaulted or substituted id would reopen a citizen the operator did not name", async () => {
		const odd = " 20261124T120000-ABC123 ";
		const plain = recording(BACK_PI);
		const untouched = recording(REFUSED_LIVE);
		await runResumeCli([GID], plain.deps);
		await runResumeCli([odd], untouched.deps);
		ok(
			"the id is handed over as typed",
			JSON.stringify(plain.seen) === JSON.stringify([GID]) && JSON.stringify(untouched.seen) === JSON.stringify([odd]),
		);
	});

	it("[QK:RESUMECLI-USAGE-RUNS-NOTHING] an argv that is not exactly one non-flag word is exit 2 with the usage line and never reaches the leaf — no argv, two words, and a dash word that would otherwise be looked up as an id", async () => {
		const shapes: string[][] = [[], [GID, GID], ["--help"], ["-x"], [GID, "--now"], ["--", GID]];
		const outcomes = [];
		const leaf = recording(BACK_PI);
		for (const argv of shapes) outcomes.push(await runResumeCli(argv, leaf.deps));
		ok(
			"every shape is a usage refusal that ran nothing",
			leaf.seen.length === 0 &&
				outcomes.every(
					(o) => o.exitCode === RESUME_CLI_EXIT.usage && o.stdout === "" && o.stderr === `${RESUME_CLI_USAGE}\n`,
				),
		);
	});

	it("[QK:RESUMECLI-EXIT-FROM-RESULT] the exit code separates the four outcomes an operator acts on differently: launched with the backend's positive same-id observation 0, launched without it 3, refused with nothing opened 4, and failed at the launch step 5 for EVERY recovery the leaf preserves — a `none` recovery is not re-typed as a refusal and an `unknown` one is not rounded either way", () => {
		const observedBack: VisibleResumeResult[] = [
			BACK_PI,
			{ ok: true, launch: CC_LAUNCH, observation: { kind: "receiver-armed", ownerPid: 4300, waitedMs: 30 } },
			{ ok: true, launch: PD_LAUNCH, observation: { kind: "adopted", waitedMs: 40 } },
		];
		const openedOnly: VisibleResumeResult[] = [
			UNOBSERVED_PI,
			{ ok: true, launch: CC_LAUNCH, observation: { kind: "resume-unobserved", waitedMs: 5000 } },
			{ ok: true, launch: CC_LAUNCH, observation: { kind: "record-unreadable", cause: "EACCES", waitedMs: 9 } },
			{ ok: true, launch: CC_LAUNCH, observation: { kind: "pane-process-unread", cause: "no child", waitedMs: 0 } },
			{ ok: true, launch: PD_LAUNCH, observation: { kind: "not-yet-adopted", waitedMs: 5000 } },
			{ ok: true, launch: PD_LAUNCH, observation: { kind: "reservation-lost", waitedMs: 80 } },
			{ ok: true, launch: PD_LAUNCH, observation: { kind: "unobserved", reason: "r", detail: "d", waitedMs: 80 } },
		];
		const refused: VisibleResumeResult[] = [
			REFUSED_LIVE,
			{ ok: false, reason: "target-invalid", detail: "d" },
			{ ok: false, reason: "target-backend-unsupported", detail: "d" },
			{ ok: false, reason: "target-locked", detail: "d" },
			{ ok: false, reason: "launch-refused", detail: "no-tmux-context" },
		];
		ok(
			"four outcomes, four codes, and no two share one",
			observedBack.every((r) => resumeCliExitCode(r) === 0) &&
				openedOnly.every((r) => resumeCliExitCode(r) === 3) &&
				refused.every((r) => resumeCliExitCode(r) === 4) &&
				LAUNCH_FAILED_ANY_RECOVERY.every((r) => resumeCliExitCode(r) === 5) &&
				new Set(Object.values(RESUME_CLI_EXIT)).size === Object.values(RESUME_CLI_EXIT).length,
		);
	});

	it("[QK:RESUMECLI-UNKNOWN-OBSERVATION] an observation kind this entry was never taught is NOT reported as a return — exit 0 is a closed list of positive facts, so a kind added to the leaf later cannot become a false `the citizen is back`", () => {
		const future = {
			ok: true,
			launch: PI_LAUNCH,
			observation: { kind: "some-later-kind", waitedMs: 1 },
		} as unknown as VisibleResumeResult;
		ok("an unknown kind is opened-but-unobserved", resumeCliExitCode(future) === RESUME_CLI_EXIT.unobserved);
	});

	it("[QK:RESUMECLI-UNATTRIBUTED] the receipt carries no actor: a terminal operator has no record-backed garden identity, so the receipt says unattributed rather than naming an id this entry made up or read from the environment", async () => {
		const out = await runResumeCli([GID], recording(BACK_PI).deps);
		ok(
			"unattributed, and no record-backed-caller line",
			out.stdout.includes("  actor:    unattributed") && !out.stdout.includes("record-backed caller"),
		);
	});

	it("[QK:RESUMECLI-REFUSAL-ON-STDERR] a refusal and a failed launch are diagnostics on stderr with an EMPTY stdout, and a receipt is the product on stdout with an empty stderr — a script reading stdout never mistakes a refusal for a receipt", async () => {
		const back = await runResumeCli([GID], recording(BACK_PI).deps);
		const opened = await runResumeCli([GID], recording(UNOBSERVED_PI).deps);
		const refusedOut = await runResumeCli([GID], recording(REFUSED_LIVE).deps);
		const failed = await runResumeCli([GID], recording(LAUNCH_FAILED).deps);
		ok(
			"streams follow the result, and the refusal keeps the leaf's reason and its nothing-opened sentence",
			back.exitCode === 0 &&
				back.stderr === "" &&
				back.stdout.includes(`  target:   ${GID}`) &&
				back.stdout.endsWith("\n") &&
				opened.exitCode === 3 &&
				opened.stderr === "" &&
				opened.stdout.includes("resume-unobserved") &&
				refusedOut.exitCode === 4 &&
				refusedOut.stdout === "" &&
				refusedOut.stderr.includes("target-live") &&
				refusedOut.stderr.includes("No window was opened.") &&
				failed.exitCode === 5 &&
				failed.stdout === "" &&
				failed.stderr.length > 0 &&
				!failed.stderr.includes("No window was opened."),
		);
	});

	it("[QK:RESUMECLI-THROW-IS-EXIT-ONE] a leaf throw is exit 1 with the leaf's own message on stderr — its cause-rich record errors are deliberately not refusals there, and this entry does not re-type them into `nothing was opened`", async () => {
		const message = 'no meta-record for garden id "20261124T120000-abc123" under /store';
		const out = await runResumeCli([GID], recording(new Error(message)).deps);
		ok(
			"exit 1, the message as written, nothing on stdout",
			out.exitCode === RESUME_CLI_EXIT.crashed &&
				out.stdout === "" &&
				out.stderr === `entwurf resume error: ${message}\n`,
		);
	});

	it("[QK:RESUMECLI-SHARED-LEAF] production reaches the leaf through the launcher the MCP verb uses, and this module imports no rail and no record store — a second launcher, rail choice or record read here would be a second resume", () => {
		const here = path.dirname(fileURLToPath(import.meta.url));
		const src = fs.readFileSync(path.join(here, "resume-cli.ts"), "utf8");
		const entry = fs.readFileSync(path.join(here, "..", "..", "scripts", "resume.ts"), "utf8");
		const imports = [...src.matchAll(/from\s+"([^"]+)"/g)].map((m) => m[1]);
		const entryImports = [...entry.matchAll(/from\s+"([^"]+)"/g)].map((m) => m[1]);
		ok(
			"the exact import sets and the one production call",
			JSON.stringify([...imports].sort()) ===
				JSON.stringify([
					"./agent-guidance.ts",
					"./entwurf-v2-visible-resume.ts",
					"./fresh-call-dispatch.ts",
					"./mux-placement.ts",
					"./visible-resume-launch.ts",
				]) &&
				// The two rail modules are here for their PREDICATES alone: no launcher, lock or record reader.
				src.includes('\nimport { selectFreshCallRail } from "./fresh-call-dispatch.ts";\n') &&
				src.includes('\nimport { readAnchor } from "./mux-placement.ts";\n') &&
				src.includes('\nimport { visibleResumeLaunch } from "./visible-resume-launch.ts";\n') &&
				/resume: \(target\) => visibleResume\(target, makeVisibleResumeDeps\(visibleResumeLaunch\)\)/.test(src) &&
				/renderVisibleResume\(result, \{ actor: null \}\)/.test(src) &&
				JSON.stringify(entryImports) === JSON.stringify(["../pi-extensions/lib/resume-cli.ts"]) &&
				/runResumeCli\(process\.argv\.slice\(2\), productionResumeCliDeps\(\)\)/.test(entry),
		);
	});

	it("[QK:RESUMECLI-CONTEXT-BEFORE-LEAF] a terminal with no launch context is refused early and by name with the leaf never called — the leaf would say the same thing only after reading the record, taking the lock and, for pi-durable, writing a reservation it must then withdraw; a usage error still wins over it", async () => {
		const TMUX = "/tmp/tmux-1000/default,4242,0";
		const bare = recording(BACK_PI, {});
		const halfTmux = recording(BACK_PI, { TMUX });
		const emptyPane = recording(BACK_PI, { TMUX, TMUX_PANE: "" });
		const badPane = recording(BACK_PI, { TMUX, TMUX_PANE: "1" });
		const notHerdr = recording(BACK_PI, { HERDR_ENV: "true" });
		const outBare = await runResumeCli([GID], bare.deps);
		const outHalf = await runResumeCli([GID], halfTmux.deps);
		const outEmpty = await runResumeCli([GID], emptyPane.deps);
		const outBad = await runResumeCli([GID], badPane.deps);
		const outNotHerdr = await runResumeCli([GID], notHerdr.deps);
		const usageFirst = await runResumeCli([], bare.deps);
		const noTmux = (o: typeof outBare): boolean =>
			o.exitCode === RESUME_CLI_EXIT.refused &&
			o.stdout === "" &&
			o.stderr.startsWith("entwurf resume refused: no-tmux-context — ") &&
			o.stderr.endsWith("Nothing was read, locked or opened.\n");
		ok(
			"no leaf call in any refused environment, the two reasons stay apart, and usage is asked first",
			[bare, halfTmux, emptyPane, badPane, notHerdr].every((r) => r.seen.length === 0) &&
				noTmux(outBare) &&
				noTmux(outHalf) &&
				noTmux(outEmpty) &&
				noTmux(outNotHerdr) &&
				outBad.exitCode === RESUME_CLI_EXIT.refused &&
				outBad.stdout === "" &&
				outBad.stderr.startsWith("entwurf resume refused: anchor-malformed — ") &&
				usageFirst.exitCode === RESUME_CLI_EXIT.usage,
		);
	});

	it("[QK:RESUMECLI-CONTEXT-HERDR] inside herdr the tmux anchor is not asked for: exactly `HERDR_ENV=1` with no tmux variable reaches the leaf, because the rail root will launch the herdr resume there and a tmux requirement would refuse every resume inside herdr", async () => {
		const herdr = recording(BACK_PI, { HERDR_ENV: "1" });
		const out = await runResumeCli([GID], herdr.deps);
		ok(
			"the leaf was called once with the id and its receipt came back",
			JSON.stringify(herdr.seen) === JSON.stringify([GID]) && out.exitCode === RESUME_CLI_EXIT.resumed,
		);
	});
});
