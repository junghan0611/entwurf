/**
 * check-claude-launch — deterministic gate for the Claude Code launch (`entwurf claude`, #157 stage 4).
 * Hermetic: no real Claude Code, no network, no model turn, no write outside its own temp root. Linux
 * only: the fake vendor reads its own environment from /proc/$$/environ (it runs in the Linux check job).
 *
 * SAME ORACLE AS check-pi-launch and check-copilot-launch: the subject is a process REPLACEMENT, so
 * the truth is a FAKE VENDOR — a real executable named `claude` on a sandbox PATH that reports the
 * argv, cwd, environment and pid it was actually handed. Nothing below is asserted by reading the
 * launcher's source, and the launcher is driven through its PUBLIC address (`run.sh claude`),
 * because the dispatcher's own argv handling — the help preflight included — is part of the contract.
 *
 * WHAT THE LAUNCH PROMISES, AND WHAT IT DOES NOT. It is a spelling: the vendor's argv, cwd, exit
 * status and signal are Claude Code's own, and `--help` is Claude Code's help, not an Entwurf page.
 * It adds nothing to the argv. Its only environment changes are the recursion sentinel and the
 * REMOVAL of an inherited PI_SESSION_ID/PI_AGENT_ID pair, which is another citizen's identity. It
 * does not promise a garden citizen: that comes from the meta-bridge plugin and hooks `setup`
 * installed, which this launch neither checks nor supplies, so nothing here models them.
 *
 * WHY TWO RECURSION FENCES WHEN PI HAS ONE. pi's single fence rests on the flag it injects: a PATH
 * `pi` symlinked to run.sh re-enters as the unknown verb `--entwurf-control`. This launch injects
 * nothing, so the same symlink would re-enter with the operator's argv as the VERB. The resolved-path
 * fence refuses that, and the cell measuring it hands the loop an EMPTY argv on purpose: with the
 * fence mutated away, the re-entry prints the root page and exits 0 instead of running any verb.
 *
 * TWO CELLS CARRY NO MUTANT, and the reason is measured coupling rather than a gap. run.sh is
 * `set -euo pipefail`, so dropping `exec` still propagates a non-zero vendor status (set -e exits
 * with it) and turns a vendor death by signal into a status of 128+n. The mutation that breaks the
 * exit or signal claim is therefore the one that breaks the pid claim, and the pid cell is asserted
 * first so that mutant lands on exactly one QK. The exit and signal cells stand on their assertions.
 */

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
	chmodSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	realpathSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const RUN_SH = path.join(REPO, "run.sh");
const SENTINEL = "ENTWURF_CLAUDE_LAUNCH_ACTIVE";
/** The variables bash itself maintains across a script and an exec — not the launcher's choice. */
const BASH_OWNED = new Set(["SHLVL", "_", "PWD", "OLDPWD"]);

let passed = 0;
function ok(label: string, cond: boolean, detail = ""): void {
	assert.ok(cond, detail ? `${label}\n${detail}` : label);
	console.log(`  ok    ${label}`);
	passed++;
}

const root = mkdtempSync(path.join(tmpdir(), "entwurf-claude-launch."));
try {
	const bin = path.join(root, "bin");
	const work = path.join(root, "work");
	mkdirSync(bin, { recursive: true });
	mkdirSync(work, { recursive: true });
	const envDump = path.join(root, "vendor.environ");

	// The fake vendor, installed under the REAL name `claude`. It reports what exec handed it: its
	// own initial environment is read from the kernel (/proc/$$/environ), not from its shell's view,
	// so bash's own bookkeeping inside the fake is not mistaken for the launcher's.
	const vendor = path.join(bin, "claude");
	writeFileSync(
		vendor,
		`#!/usr/bin/env bash
echo "PID=$$"
echo "CWD=$(pwd -P)"
echo "SENTINEL=[\${${SENTINEL}-<unset>}]"
cat "/proc/$$/environ" >"$FAKE_CLAUDE_ENV_OUT"
for a in "$@"; do printf 'ARG<%s>\\n' "$a"; done
if [ -n "\${FAKE_CLAUDE_SIGNAL:-}" ]; then kill -s "$FAKE_CLAUDE_SIGNAL" "$$"; sleep 5; fi
exit "\${FAKE_CLAUDE_EXIT:-0}"
`,
	);
	chmodSync(vendor, 0o755);

	// TOTAL sandbox, as the sibling launch gates: the launcher writes nothing, but it EXECS a vendor.
	const sandboxEnv = {
		HOME: path.join(root, "home"),
		XDG_DATA_HOME: path.join(root, "xdg", "data"),
		XDG_CONFIG_HOME: path.join(root, "xdg", "config"),
		XDG_STATE_HOME: path.join(root, "xdg", "state"),
		XDG_CACHE_HOME: path.join(root, "xdg", "cache"),
		XDG_RUNTIME_DIR: path.join(root, "xdg", "runtime"),
		PI_CODING_AGENT_DIR: path.join(root, "pi-agent"),
		CLAUDE_CONFIG_DIR: path.join(root, "claude-config"),
	};
	for (const d of Object.values(sandboxEnv)) mkdirSync(d, { recursive: true });

	// A PATH with no `claude` anywhere on it: every real entry that holds one is dropped, rather than
	// emptying PATH (the launcher still needs bash, dirname and readlink).
	const pathWithoutVendor = (process.env.PATH ?? "")
		.split(":")
		.filter((d) => d !== "" && !existsSync(path.join(d, "claude")))
		.join(":");

	/**
	 * Every bash this gate starts gets a NON-SOCKET stdin. Node's default stdin is a socketpair, and
	 * bash reads `-c` with a socket on stdin as a remote shell and sources the system bashrc — measured
	 * here on NixOS, where that re-runs set-environment and resets PATH, dropping the sandbox bin
	 * (S4CLI-F01-BASHC-REMOTE-SHELL-R1). The sibling gates never see it because they pass the
	 * operator's whole environment; this one builds its environment from scratch to compare it.
	 */
	const STDIO: ["ignore", "pipe", "pipe"] = ["ignore", "pipe", "pipe"];

	/** The caller's whole environment, built explicitly so the vendor's can be compared to it. */
	function callerEnv(pathValue: string, extra: Record<string, string> = {}): Record<string, string> {
		return { ...sandboxEnv, PATH: pathValue, LANG: "C.UTF-8", FAKE_CLAUDE_ENV_OUT: envDump, ...extra };
	}

	interface Run {
		status: number | null;
		signal: NodeJS.Signals | null;
		out: string;
		args: string[];
		sentinel: string;
		pid: string;
		cwd: string;
		env: Map<string, string> | null;
	}
	function launch(args: string[], env: Record<string, string>, cwd = work): Run {
		rmSync(envDump, { force: true });
		const r = spawnSync("bash", [RUN_SH, "claude", ...args], {
			cwd,
			encoding: "utf8",
			env,
			timeout: 30_000,
			stdio: STDIO,
		});
		const out = `${r.stdout ?? ""}${r.stderr ?? ""}`;
		const argv: string[] = [];
		for (const line of out.split("\n")) {
			const m = /^ARG<([\s\S]*)>$/.exec(line);
			if (m) argv.push(m[1] as string);
		}
		let vendorEnv: Map<string, string> | null = null;
		if (existsSync(envDump)) {
			vendorEnv = new Map();
			for (const entry of readFileSync(envDump, "utf8").split("\0")) {
				if (entry === "") continue;
				const eq = entry.indexOf("=");
				vendorEnv.set(entry.slice(0, eq), entry.slice(eq + 1));
			}
		}
		return {
			status: r.status,
			signal: r.signal,
			out,
			args: argv,
			sentinel: /^SENTINEL=\[(.*)\]$/m.exec(out)?.[1] ?? "<no-launch>",
			pid: /^PID=(.*)$/m.exec(out)?.[1] ?? "",
			cwd: /^CWD=(.*)$/m.exec(out)?.[1] ?? "",
			env: vendorEnv,
		};
	}
	const withVendor = `${bin}:${pathWithoutVendor}`;

	// ── 1. the dispatcher verb must not reach the vendor ────────────────────────
	{
		const r = launch(["--model", "x"], callerEnv(withVendor));
		ok(
			"[QK:CLAUDELAUNCH-VERB-DROPPED] the dispatcher verb never reaches the vendor — without the shift, `claude` arrives as a prompt argument",
			r.status === 0 && r.pid !== "" && !r.args.includes("claude"),
			`status=${r.status} argv=${JSON.stringify(r.args)}\n${r.out}`,
		);
	}

	// ── 2. operator argv crosses byte-identical, and nothing is added to it ─────
	{
		const operator = ["--model", "a b", "", "-", "--", "한글 인자", "  spaced  ", "--help"];
		const r = launch(operator, callerEnv(withVendor));
		ok(
			"[QK:CLAUDELAUNCH-ARGV-UNTOUCHED] the vendor's argv IS the operator's, element for element — empty strings, spaces, a bare dash, the terminator, non-ASCII and a trailing --help — with nothing injected",
			r.status === 0 && JSON.stringify(r.args) === JSON.stringify(operator),
			`expected: ${JSON.stringify(operator)}\nactual:   ${JSON.stringify(r.args)}`,
		);
	}

	// ── 3. the vendor's own help, never an Entwurf page in its place ───────────
	{
		const bad = (["--help", "-h"] as const).flatMap((flag) => {
			const r = launch([flag], callerEnv(withVendor));
			return r.status === 0 && r.pid !== "" && JSON.stringify(r.args) === JSON.stringify([flag])
				? []
				: [`${flag}: status=${r.status} argv=${JSON.stringify(r.args)} out=${JSON.stringify(r.out.slice(0, 160))}`];
		});
		ok(
			"[QK:CLAUDELAUNCH-VENDOR-HELP] `entwurf claude --help` and `-h` reach Claude Code itself — the help preflight lets this verb through instead of answering with the command's description",
			bad.length === 0,
			bad.join("\n"),
		);
	}

	// ── 4. the caller's directory is the vendor's ───────────────────────────────
	{
		const r = launch([], callerEnv(withVendor));
		ok(
			"[QK:CLAUDELAUNCH-CWD-KEPT] the vendor starts in the caller's directory, not the package's — Claude Code keys its project and session to that directory",
			r.status === 0 && r.cwd === realpathSync(work),
			`expected=${realpathSync(work)} actual=${r.cwd}`,
		);
	}

	// ── 5–7. the environment: a sentinel added, a foreign identity removed, nothing else ──
	{
		const caller = callerEnv(withVendor, { PI_SESSION_ID: "foreign-garden", PI_AGENT_ID: "pi-agent-fixture" });
		const r = launch([], caller);
		ok(
			"[QK:CLAUDELAUNCH-SENTINEL-EXPORTED] the sentinel is EXPORTED, so a PATH `claude` that shells back to `entwurf claude` sees it on re-entry",
			r.sentinel === "1",
			`sentinel=${r.sentinel}`,
		);
		ok(
			"[QK:CLAUDELAUNCH-CARRIERS-SCRUBBED] an inherited PI_SESSION_ID/PI_AGENT_ID pair is another citizen's identity and BOTH are gone from the vendor's environment — absent, not emptied",
			r.env !== null && !r.env.has("PI_SESSION_ID") && !r.env.has("PI_AGENT_ID"),
			`vendor env keys: ${JSON.stringify(r.env === null ? null : [...r.env.keys()].filter((k) => k.startsWith("PI_")))}`,
		);
		const expected = new Map(Object.entries(caller));
		expected.delete("PI_SESSION_ID");
		expected.delete("PI_AGENT_ID");
		expected.set(SENTINEL, "1");
		const diff: string[] = [];
		const actual = r.env ?? new Map<string, string>();
		for (const [k, v] of expected)
			if (actual.get(k) !== v) diff.push(`expected ${k}=${JSON.stringify(v)}, got ${JSON.stringify(actual.get(k))}`);
		for (const [k, v] of actual)
			if (!expected.has(k) && !BASH_OWNED.has(k)) diff.push(`added ${k}=${JSON.stringify(v)}`);
		ok(
			`[QK:CLAUDELAUNCH-ENV-EXACT] beyond those two changes the vendor's environment IS the caller's (${expected.size} variables; ${[...BASH_OWNED].join(", ")} are bash's own) — no auth, model, permission or settings variable is decided here`,
			r.env !== null && diff.length === 0,
			diff.join("\n"),
		);
	}

	// ── 8. the vendor's exit status is this command's exit status (no mutant: see header) ──
	{
		const r = launch([], callerEnv(withVendor, { FAKE_CLAUDE_EXIT: "7" }));
		ok(
			"[QK:CLAUDELAUNCH-EXIT-PASSTHROUGH] the vendor's exit status is the launch's exit status",
			r.status === 7,
			`status=${r.status}`,
		);
	}

	// ── 9. exec, not fork: the pid survives ─────────────────────────────────────
	{
		const r = spawnSync("bash", ["-c", `echo "SHELL_PID=$$"; exec bash "${RUN_SH}" claude`], {
			cwd: work,
			encoding: "utf8",
			env: callerEnv(withVendor),
			timeout: 30_000,
			stdio: STDIO,
		});
		const shellPid = /^SHELL_PID=(\d+)$/m.exec(r.stdout ?? "")?.[1];
		const vendorPid = /^PID=(\d+)$/m.exec(r.stdout ?? "")?.[1];
		ok(
			"[QK:CLAUDELAUNCH-EXEC-KEEPS-PID] the vendor REPLACES this process — a fork would leave run.sh as a parent that owns nothing, between Claude Code and the terminal",
			Boolean(shellPid) && shellPid === vendorPid,
			`shell=${shellPid} vendor=${vendorPid}`,
		);
	}

	// ── 10. a vendor death by signal is the caller's to see (no mutant: see header) ──
	{
		const r = launch([], callerEnv(withVendor, { FAKE_CLAUDE_SIGNAL: "TERM" }));
		ok(
			"[QK:CLAUDELAUNCH-SIGNAL-PASSTHROUGH] a vendor killed by a signal is reported as that signal, not as a shell's 128+n status",
			r.status === null && r.signal === "SIGTERM",
			`status=${r.status} signal=${r.signal}`,
		);
	}

	// ── 11. an absent vendor is a NAMED refusal, never a quiet success ──────────
	{
		const r = launch([], callerEnv(pathWithoutVendor));
		ok(
			"[QK:CLAUDELAUNCH-VENDOR-ABSENT] with no `claude` on PATH the launch refuses by name and non-zero, and runs nothing",
			r.status === 1 && r.out.includes("no 'claude' executable found on PATH") && r.pid === "",
			`status=${r.status}\n${r.out}`,
		);
	}

	// ── 12. a PATH hit that is not a regular file is refused before exec ────────
	{
		const fifoBin = path.join(root, "fifobin");
		mkdirSync(fifoBin, { recursive: true });
		const made = spawnSync("mkfifo", [path.join(fifoBin, "claude")], { encoding: "utf8" });
		assert.equal(made.status, 0, `mkfifo failed: ${made.stderr}`);
		chmodSync(path.join(fifoBin, "claude"), 0o755);
		const r = launch([], callerEnv(`${fifoBin}:${pathWithoutVendor}`));
		ok(
			"[QK:CLAUDELAUNCH-NOT-REGULAR] an executable PATH `claude` that is not a regular file (a FIFO) is refused by name, not handed to exec",
			r.status === 1 && r.out.includes("is not an executable regular file") && r.pid === "",
			`status=${r.status}\n${r.out}`,
		);
	}

	// ── 13. the sentinel fence ──────────────────────────────────────────────────
	{
		const r = launch([], callerEnv(withVendor, { [SENTINEL]: "1" }));
		ok(
			"[QK:CLAUDELAUNCH-RECURSION-FENCE] a re-entered launch refuses by name instead of spinning behind a hung terminal",
			r.status === 1 && r.out.includes("recursive managed launch detected") && r.pid === "",
			`status=${r.status}\n${r.out}`,
		);
	}

	// ── 14. the resolved-path fence: a PATH `claude` that IS run.sh ─────────────
	{
		// Two hops, the first relative, so the walk itself is exercised: loop/claude -> ../hop/claude
		// -> run.sh. The argv is EMPTY on purpose (see header): without this fence the re-entry would
		// print the root page and exit 0, never run a verb.
		const loopBin = path.join(root, "loop");
		const hop = path.join(root, "hop");
		mkdirSync(loopBin, { recursive: true });
		mkdirSync(hop, { recursive: true });
		symlinkSync(RUN_SH, path.join(hop, "claude"));
		symlinkSync(path.join("..", "hop", "claude"), path.join(loopBin, "claude"));
		const r = launch([], callerEnv(`${loopBin}:${pathWithoutVendor}`));
		ok(
			"[QK:CLAUDELAUNCH-SELF-EXEC-FENCE] a PATH `claude` that resolves through symlinks to this run.sh is refused by name — with nothing injected, re-entry would make the operator's argv an entwurf verb",
			r.status === 1 && r.out.includes(`resolves to entwurf's own '${realpathSync(RUN_SH)}'`) && r.pid === "",
			`status=${r.status}\n${r.out.slice(0, 400)}`,
		);
	}

	console.log(`\ncheck-claude-launch: ${passed} checks passed`);
} finally {
	rmSync(root, { recursive: true, force: true });
}
