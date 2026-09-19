/**
 * check-pi-launch — deterministic gate for the MANAGED pi launch (`entwurf pi`, #118 홉 2).
 * Hermetic: no real pi, no network, no model turn, no write outside its own temp root.
 *
 * SAME ORACLE AS check-copilot-launch, and deliberately the same one: the subject is a
 * process REPLACEMENT, so the truth is a FAKE VENDOR — a real executable named `pi` on a
 * sandbox PATH that reports the argv, environment and pid it was actually handed. Nothing
 * below is asserted by reading the launcher's source, and the launcher is driven through
 * its PUBLIC address (`run.sh pi`) because the dispatcher's own argv handling is part of
 * the contract. Reusing that harness shape rather than importing it is the honest split:
 * the two launchers share a posture, not a body, and a shared fixture would have to grow a
 * vendor-name parameter that neither production path has.
 *
 * WHY THE PRECONDITION SET IS EMPTY, measured rather than assumed. `entwurf copilot` checks
 * six receiver-state facts before it execs, because setting its flag is a PROMISE of a
 * doorbell that may not exist. `entwurf pi` promises nothing pi does not already own: on a
 * host where the entwurf extension is not registered, `pi --entwurf-control` refuses itself
 * with `Error: Unknown option: --entwurf-control` and exit 1 (measured, pi 0.85.1). A
 * pre-check here would duplicate that refusal and go stale the day pi renames it.
 *
 * WHY ONE RECURSION FENCE AND NOT TWO. The sentinel closes the only real loop — a PATH
 * executable named `pi` that shells back to `entwurf pi`. Copilot's second fence (resolve
 * the binary, refuse our own entrypoints) closes a case that is NOT a loop here, and the
 * cell below measures that rather than asserting it: a PATH `pi` symlinked to run.sh is
 * exec'd as `run.sh --entwurf-control …`, an unknown verb this dispatcher already refuses.
 *
 * WHY THE FLAG IS ADDED AND NEVER DEDUPLICATED. `pit`/`pius`-style operator wrappers already
 * pass `--entwurf-control`; passing it twice was measured byte-identical to passing it once
 * (pi 0.85.1, extension registered). The launcher therefore injects exactly ONE and leaves
 * the operator's copies alone — an argv scan would be code earning nothing.
 */

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
	chmodSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const RUN_SH = path.join(REPO, "run.sh");

let passed = 0;
function ok(label: string, cond: boolean, detail = ""): void {
	assert.ok(cond, detail ? `${label}\n${detail}` : label);
	console.log(`  ok    ${label}`);
	passed++;
}

// ── the flag SSOT, read as text ──────────────────────────────────────────────
// The shell cannot import a TypeScript constant, so the launcher spells the flag as a
// literal and this gate is what keeps the two in step. The SSOT is the constant; every
// argv-composing site below must carry exactly its value.
const storeSrc = readFileSync(path.join(REPO, "pi-extensions", "lib", "acp", "session-store.ts"), "utf8");
const flagMatch = /export const ENTWURF_CONTROL_FLAG = "([^"]+)";/.exec(storeSrc);
assert.ok(flagMatch, "ENTWURF_CONTROL_FLAG is not declared in pi-extensions/lib/acp/session-store.ts");
const FLAG = flagMatch[1];

const root = mkdtempSync(path.join(tmpdir(), "entwurf-pi-launch."));
try {
	const bin = path.join(root, "bin");
	mkdirSync(bin, { recursive: true });

	// The fake vendor, installed under the REAL name `pi`. There is no "which command
	// stands in for the vendor" switch: a production env seam that can redirect an exec is
	// an authority, not a test convenience.
	const vendor = path.join(bin, "pi");
	writeFileSync(
		vendor,
		`#!/usr/bin/env bash
echo "PID=$$"
echo "SENTINEL=[\${ENTWURF_PI_LAUNCH_ACTIVE-<unset>}]"
for a in "$@"; do printf 'ARG<%s>\\n' "$a"; done
exit "\${FAKE_PI_EXIT:-0}"
`,
	);
	chmodSync(vendor, 0o755);

	// A PATH with no `pi` anywhere on it — built by dropping every real entry that holds
	// one, rather than by emptying PATH (the launcher still needs bash and friends).
	const pathWithoutVendor = (process.env.PATH ?? "")
		.split(":")
		.filter((d) => d !== "" && !existsSync(path.join(d, "pi")))
		.join(":");

	interface Run {
		status: number | null;
		out: string;
		args: string[];
		sentinel: string;
		pid: string;
	}
	function launch(args: string[], extraEnv: Record<string, string> = {}, withVendor = true): Run {
		const r = spawnSync("bash", [RUN_SH, "pi", ...args], {
			cwd: root,
			encoding: "utf8",
			env: {
				...process.env,
				PATH: withVendor ? `${bin}:${pathWithoutVendor}` : pathWithoutVendor,
				ENTWURF_PI_LAUNCH_ACTIVE: undefined as unknown as string,
				FAKE_PI_EXIT: undefined as unknown as string,
				...extraEnv,
			},
		});
		const out = `${r.stdout ?? ""}${r.stderr ?? ""}`;
		const argv: string[] = [];
		for (const line of out.split("\n")) {
			const m = /^ARG<([\s\S]*)>$/.exec(line);
			if (m) argv.push(m[1]);
		}
		return {
			status: r.status,
			out,
			args: argv,
			sentinel: /^SENTINEL=\[(.*)\]$/m.exec(out)?.[1] ?? "<no-launch>",
			pid: /^PID=(.*)$/m.exec(out)?.[1] ?? "",
		};
	}

	// ── 1. the flag literal agrees with its SSOT, everywhere argv is composed ──
	{
		// CODE only. The branch explains itself at length and quotes the flag four times in
		// prose; a literal check that read those goes green on a launcher whose actual exec
		// line carries a typo — measured, and it is why the comments are dropped first.
		const branch = /^ {2}pi\)$[\s\S]*?^ {4};;$/m.exec(readFileSync(RUN_SH, "utf8"))?.[0] ?? "";
		const launcher = branch
			.split("\n")
			.filter((line) => !/^\s*#/.test(line))
			.join("\n");
		// Deliberately narrow: this cell owns the LITERAL and nothing else. Asserting the
		// whole exec line here would swallow every other claim below — a mutation of the
		// argv order, the quoting or the exec itself would all die on this assertion first,
		// and each mutant is supposed to name exactly one broken thing. The token boundary
		// is what makes a near-miss like `--entwurf-controll` a failure rather than a
		// substring hit.
		ok(
			"[QK:PILAUNCH-FLAG-SSOT] the run.sh launcher spells the flag exactly as ENTWURF_CONTROL_FLAG declares it — the shell cannot import the constant, so the literal is checked as a whole token",
			new RegExp(`(^|\\s)${FLAG.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(\\s|$)`, "m").test(launcher),
			`FLAG=${FLAG}\n--- launcher branch, comments dropped ---\n${launcher}`,
		);
		// The other sites that COMPOSE argv with this flag. Prose and diagnostics are not
		// listed: they cannot break a launch, and sweeping them would make this a spell
		// checker. A new argv-composing site that spells the flag differently is caught by
		// its own gate; what this cell owns is that these agree with the constant TODAY.
		const argvSites = [
			"pi-extensions/lib/entwurf-resume-args.ts",
			"pi-extensions/lib/fresh-call-composition.ts",
			"scripts/smoke-acp-v2-send-live.ts",
			"scripts/smoke-acp-session-reuse-live.ts",
			"scripts/smoke-resident-garden-guard.sh",
		];
		const disagreeing = argvSites.filter((rel) => !readFileSync(path.join(REPO, rel), "utf8").includes(FLAG));
		ok(
			`[QK:PILAUNCH-FLAG-SITES] every argv-composing site carries the same literal (${argvSites.length} + this launcher)`,
			disagreeing.length === 0,
			`sites missing ${FLAG}: ${disagreeing.join(", ")}`,
		);
	}

	// ── 2. the dispatcher verb must not reach the vendor ──────────────────────
	{
		const r = launch(["--model", "x"]);
		ok(
			"[QK:PILAUNCH-VERB-DROPPED] the dispatcher verb never reaches the vendor — without the shift, `pi` arrives as a prompt argument",
			r.status === 0 && !r.args.includes("pi"),
			`argv: ${JSON.stringify(r.args)}`,
		);
		ok(
			"[QK:PILAUNCH-FLAG-FIRST] the injected flag is the FIRST token, so the control socket is stood up before anything the operator asked for",
			r.args[0] === FLAG,
			`argv: ${JSON.stringify(r.args)}`,
		);
		ok(
			"[QK:PILAUNCH-NOTHING-ELSE-INJECTED] the launcher adds the flag and NOTHING else — operator taste is not a launcher decision (Rule 9)",
			JSON.stringify(r.args) === JSON.stringify([FLAG, "--model", "x"]),
			`argv: ${JSON.stringify(r.args)}`,
		);
	}

	// ── 3. operator argv crosses byte-identical ───────────────────────────────
	{
		const operator = ["--model", "a b", "", "-", "--", "한글 인자", "  spaced  "];
		const r = launch(operator);
		ok(
			"[QK:PILAUNCH-ARGV-BYTES] every operator element crosses byte-identical — empty strings, embedded spaces, a bare dash, the terminator and non-ASCII",
			JSON.stringify(r.args) === JSON.stringify([FLAG, ...operator]),
			`expected: ${JSON.stringify([FLAG, ...operator])}\nactual:   ${JSON.stringify(r.args)}`,
		);
	}

	// ── 4. the flag is ADDED, never deduplicated ──────────────────────────────
	{
		const r = launch([FLAG, "--model", "x"]);
		ok(
			"[QK:PILAUNCH-FLAG-NOT-DEDUPED] an operator who already passes the flag gets it twice, because pi was measured to eat the duplicate and a scan would earn nothing",
			JSON.stringify(r.args) === JSON.stringify([FLAG, FLAG, "--model", "x"]),
			`argv: ${JSON.stringify(r.args)}`,
		);
	}

	// ── 5. the vendor's exit status is this command's exit status ─────────────
	// THIS CELL CARRIES NO MUTANT, and the reason is measured rather than conceded: run.sh
	// is `set -euo pipefail` (run.sh:14), so every mutation that stops the vendor status
	// from reaching the caller also stops `exec` from replacing the process. The non-exec
	// form still exits 7, because set -e aborts before a planted `exit 0` can run. A mutant
	// that kills two claims is not an attributable mutant, so this stands on its assertion
	// alone until that coupling changes.
	// Asserted BEFORE the pid cell on purpose: dropping `exec` for a plain call still
	// propagates the status, while running the vendor and then exiting 0 breaks both. With
	// the status checked first each of those two mutations lands on exactly one claim.
	{
		const r = launch([], { FAKE_PI_EXIT: "7" });
		ok(
			"[QK:PILAUNCH-EXIT-PASSTHROUGH] the vendor's exit status is the launch's exit status",
			r.status === 7,
			`status=${r.status}`,
		);
	}

	// ── 6. exec, not fork: the pid survives ───────────────────────────────────
	{
		const r = spawnSync("bash", ["-c", `echo "SHELL_PID=$$"; exec bash "${RUN_SH}" pi`], {
			cwd: root,
			encoding: "utf8",
			env: {
				...process.env,
				PATH: `${bin}:${pathWithoutVendor}`,
				ENTWURF_PI_LAUNCH_ACTIVE: undefined as unknown as string,
			},
		});
		const shellPid = /^SHELL_PID=(\d+)$/m.exec(r.stdout ?? "")?.[1];
		const vendorPid = /^PID=(\d+)$/m.exec(r.stdout ?? "")?.[1];
		ok(
			"[QK:PILAUNCH-EXEC-KEEPS-PID] the vendor REPLACES this process — a fork would leave run.sh as a parent that supervises nothing",
			Boolean(shellPid) && shellPid === vendorPid,
			`shell=${shellPid} vendor=${vendorPid}`,
		);
	}

	// ── 7. an absent vendor is a NAMED refusal, never a quiet success ─────────
	{
		const r = launch([], {}, false);
		ok(
			"[QK:PILAUNCH-VENDOR-ABSENT] with no `pi` on PATH the launch refuses by name and non-zero, and never reports success",
			r.status !== 0 && r.out.includes("no 'pi' executable found on PATH") && r.pid === "",
			`status=${r.status}\n${r.out}`,
		);
	}

	// ── 8. the recursion fence, and the sentinel that carries it ──────────────
	{
		const armed = launch([]);
		ok(
			"[QK:PILAUNCH-SENTINEL-EXPORTED] the sentinel is EXPORTED, so a PATH `pi` that shells back here sees it on re-entry",
			armed.sentinel === "1",
			`sentinel=${armed.sentinel}`,
		);
		const r = launch([], { ENTWURF_PI_LAUNCH_ACTIVE: "1" });
		ok(
			"[QK:PILAUNCH-RECURSION-FENCE] a re-entered launch refuses by name instead of spinning forever behind a hung terminal",
			r.status !== 0 && r.out.includes("recursive managed launch detected") && r.pid === "",
			`status=${r.status}\n${r.out}`,
		);
	}

	// ── 9. the case copilot's SECOND fence covers, measured here instead ───────
	{
		const loopBin = path.join(root, "loopbin");
		mkdirSync(loopBin, { recursive: true });
		symlinkSync(RUN_SH, path.join(loopBin, "pi"));
		const r = spawnSync("bash", [RUN_SH, "pi"], {
			cwd: root,
			encoding: "utf8",
			timeout: 30_000,
			env: {
				...process.env,
				PATH: `${loopBin}:${pathWithoutVendor}`,
				ENTWURF_PI_LAUNCH_ACTIVE: undefined as unknown as string,
			},
		});
		ok(
			"[QK:PILAUNCH-SYMLINK-NOT-A-LOOP] a PATH `pi` symlinked to run.sh is exec'd as an unknown verb and fails closed — this is why the second fence copilot carries is not needed here",
			r.status !== 0 && r.signal === null,
			`status=${r.status} signal=${r.signal}`,
		);
	}

	console.log(`\ncheck-pi-launch: ${passed} checks passed`);
} finally {
	rmSync(root, { recursive: true, force: true });
}
