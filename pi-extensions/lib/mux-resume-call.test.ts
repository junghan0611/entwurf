/**
 * mux-resume-call — the tmux half of the pi-durable same-id resume (#157 B3), proven beside the module.
 *
 * The rest of this leaf's contract (the measured cwd rules, the carrier-free argv, the closed runtime
 * table, the herdr refusal, the import set) stays in `scripts/check-mux-resume-call.ts`, which this
 * file does not repeat. What is new is one launch: the MANAGED `entwurf pi-durable` with the fixed
 * five-name adopt projection riding the window's environment. Same scope discipline as that gate: no
 * fake tmux — only what is decidable before tmux is asked anything.
 *
 * Each claim is its own test title, because `run_vitest` attributes a mutant kill from the failed
 * TEST TITLE (run.sh:104-113):
 *
 *   MUXRESUME-PD-ADOPT-ENV           a pi-durable window carries exactly the identity scrub and then
 *                                    the five adopt names, in their fixed order; every other resume
 *                                    window still carries the scrub alone
 *   MUXRESUME-PD-ADOPT-ABSOLUTE      a projection value that is not an absolute path never reaches tmux
 *   MUXRESUME-PD-MANAGED-RUNTIME     the runtime is the managed `entwurf`, resolved on PATH like every
 *                                    other runtime, and the closed per-backend table is untouched
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { Placement } from "./mux-placement.ts";
import {
	buildResumeCallArgs,
	RESUME_CALL_PI_DURABLE_RUNTIME,
	RESUME_CALL_RUNTIME,
	type ResumeCallPiDurableAdoptEnv,
	resumeCall,
	resumePiDurableCall,
} from "./mux-resume-call.ts";

// The label is the contract, so it travels as expect's message.
function ok(label: string, cond: boolean): void {
	expect(cond, label).toBe(true);
}

const PLACEMENT: Placement = {
	serverPid: "4242",
	sessionId: "$0",
	windowId: "@1",
	windowIndex: "1",
	paneId: "%1",
	panePid: "4243",
};
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "mux-resume-call-pd-"));
const PROJECT = path.join(TMP, "project");
fs.mkdirSync(PROJECT);
// `assertLaunchTarget` proves the runtime is real before argv is built.
const BIN = path.join(TMP, "bin");
fs.mkdirSync(BIN);
const ENTWURF = path.join(BIN, "entwurf");
fs.writeFileSync(ENTWURF, "#!/bin/sh\nexit 0\n", { mode: 0o755 });
// A PATH that resolves `pi` but not `entwurf`.
const PI_ONLY = path.join(TMP, "pi-only");
fs.mkdirSync(PI_ONLY);
fs.writeFileSync(path.join(PI_ONLY, "pi"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });

const ADOPT_ENV: ResumeCallPiDurableAdoptEnv = {
	PI_CODING_AGENT_DIR: "/home/op/profiles/../profiles/pd/",
	ENTWURF_META_SESSIONS_DIR: "/home/op/meta/meta-sessions",
	ENTWURF_META_MAILBOX_DIR: "/home/op/meta/meta-mailbox",
	ENTWURF_META_SENDERS_DIR: "/home/op/meta/meta-senders",
	ENTWURF_META_RECEIVERS_DIR: "/home/op/meta/meta-receivers",
};
const PD_ARGS = ["pi-durable", "--entwurf-adopt", '{"v":1}'] as const;

/** The `-e` assignments of the TMUX half only — everything after `--` belongs to the runtime. */
function tmuxEnv(args: readonly string[]): string[] {
	const prefix = args.slice(0, args.indexOf("--"));
	return prefix.flatMap((token, at) => (token === "-e" ? [prefix[at + 1] ?? ""] : []));
}

describe("the pi-durable resume window (#157 B3)", () => {
	it("[QK:MUXRESUME-PD-ADOPT-ENV] a pi-durable window carries exactly the identity scrub and then the five adopt names, in their fixed order, with the raw values; every other resume window still carries the scrub alone", () => {
		const pd = buildResumeCallArgs(PLACEMENT, PROJECT, ENTWURF, PD_ARGS, ADOPT_ENV);
		const plain = buildResumeCallArgs(PLACEMENT, PROJECT, ENTWURF, PD_ARGS);
		ok(
			"scrub, then PI_CODING_AGENT_DIR (raw, trailing slash kept) and the four meta roots",
			JSON.stringify(tmuxEnv(pd)) ===
				JSON.stringify([
					"PI_SESSION_ID=",
					"PI_AGENT_ID=",
					"PI_CODING_AGENT_DIR=/home/op/profiles/../profiles/pd/",
					"ENTWURF_META_SESSIONS_DIR=/home/op/meta/meta-sessions",
					"ENTWURF_META_MAILBOX_DIR=/home/op/meta/meta-mailbox",
					"ENTWURF_META_SENDERS_DIR=/home/op/meta/meta-senders",
					"ENTWURF_META_RECEIVERS_DIR=/home/op/meta/meta-receivers",
				]),
		);
		ok(
			"without a projection: the scrub alone; with one: the same -c, runtime and argv after `--`",
			JSON.stringify(tmuxEnv(plain)) === JSON.stringify(["PI_SESSION_ID=", "PI_AGENT_ID="]) &&
				pd[pd.indexOf("-c") + 1] === PROJECT &&
				JSON.stringify(pd.slice(pd.indexOf("--"))) === JSON.stringify(plain.slice(plain.indexOf("--"))) &&
				JSON.stringify(pd.slice(pd.indexOf("--") + 1)) === JSON.stringify([ENTWURF, ...PD_ARGS]),
		);
	});

	it("[QK:MUXRESUME-PD-ADOPT-ABSOLUTE] a projection value that is not an absolute path is refused before tmux could be asked — it would resolve against wherever the child starts", () => {
		const refused = (name: keyof ResumeCallPiDurableAdoptEnv, value: string): boolean => {
			try {
				buildResumeCallArgs(PLACEMENT, PROJECT, ENTWURF, PD_ARGS, { ...ADOPT_ENV, [name]: value });
				return false;
			} catch (err) {
				return err instanceof Error && err.message.includes(name);
			}
		};
		ok(
			"a relative profile, a relative meta root and an empty value each throw by name",
			refused("PI_CODING_AGENT_DIR", "profiles/pd") &&
				refused("ENTWURF_META_RECEIVERS_DIR", "meta/meta-receivers") &&
				refused("ENTWURF_META_SESSIONS_DIR", ""),
		);
	});

	it("[QK:MUXRESUME-PD-MANAGED-RUNTIME] the pi-durable runtime is the managed `entwurf`, resolved on PATH like every other runtime — a PATH with only `pi` refuses it — and the closed per-backend table is untouched", () => {
		const piOnly = resumePiDurableCall({ cwd: PROJECT, runtimeArgs: PD_ARGS, adoptEnv: ADOPT_ENV }, { PATH: PI_ONLY });
		const piResume = resumeCall({ backend: "pi", cwd: PROJECT, runtimeArgs: [] }, { PATH: PI_ONLY });
		const resolved = resumePiDurableCall({ cwd: PROJECT, runtimeArgs: PD_ARGS, adoptEnv: ADOPT_ENV }, { PATH: BIN });
		const inHerdr = resumePiDurableCall(
			{ cwd: PROJECT, runtimeArgs: PD_ARGS, adoptEnv: ADOPT_ENV },
			{ HERDR_ENV: "1", PATH: BIN },
		);
		ok(
			"entwurf, unresolved where only pi is; past the runtime with entwurf on PATH (no tmux here); refused inside herdr",
			RESUME_CALL_PI_DURABLE_RUNTIME === "entwurf" &&
				JSON.stringify(RESUME_CALL_RUNTIME) === JSON.stringify({ pi: "pi", "claude-code": "claude" }) &&
				!piOnly.ok &&
				piOnly.reason === "runtime-unresolved" &&
				!piResume.ok &&
				piResume.reason === "no-tmux-context" &&
				!resolved.ok &&
				resolved.reason === "no-tmux-context" &&
				!inHerdr.ok &&
				inHerdr.reason === "herdr-resume-unsupported",
		);
	});
});
