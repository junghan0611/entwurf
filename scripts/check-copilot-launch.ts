/**
 * check-copilot-launch — deterministic gate for the MANAGED Copilot launch
 * (`entwurf copilot`, #82 RAIL 7). Hermetic: no GitHub Copilot CLI, no network, no
 * model turn, no write outside its own temp root.
 *
 * WHAT IS UNDER TEST is a process replacement, so the oracle is a FAKE VENDOR: a real
 * executable placed on a sandbox PATH that reports the argv, environment, pid and cwd it
 * was actually handed, then exits with a status this gate chooses. Everything below is
 * asserted from that report — never from reading the launcher's source. The launcher is
 * driven through its PUBLIC address (`run.sh copilot`), because the dispatcher's own
 * argv handling is part of the contract: the verb must not reach the vendor.
 *
 * WHY THE SANDBOX IS TOTAL. HOME, XDG_DATA_HOME and PATH are all redirected, so the
 * receiver install-state, the extensions root and the resolved binary are the fixture's
 * and never the operator's. The fake vendor is installed under the REAL name `copilot`
 * on that sandbox PATH — there is no "which command stands in for the vendor" switch,
 * because a production env seam that can redirect an exec is an authority and not a test
 * convenience. What the launcher resolves here is what it resolves anywhere: the first
 * `copilot` on PATH.
 */

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

let passed = 0;
function ok(label: string, cond: boolean): void {
	assert.ok(cond, label);
	console.log(`  ok    ${label}`);
	passed++;
}

const root = mkdtempSync(path.join(tmpdir(), "entwurf-copilot-launch."));
try {
	const home = path.join(root, "home");
	const xdg = path.join(root, "xdg");
	const bin = path.join(root, "bin");
	const unitDir = path.join(home, ".copilot", "extensions", "entwurf-receive");
	const stateDir = path.join(xdg, "entwurf", "copilot-receive");
	const stateFile = path.join(stateDir, "install-state.json");
	for (const d of [bin, unitDir, stateDir]) mkdirSync(d, { recursive: true });

	// The fake vendor. `printf '%s\n'` per element keeps empty strings and embedded
	// spaces visible as themselves, which is the only way to assert byte preservation.
	const vendor = path.join(bin, "copilot");
	writeFileSync(
		vendor,
		`#!/usr/bin/env bash
echo "CWD=$PWD"
echo "PID=$$"
echo "FLAG=[\${COPILOT_CLI_ENABLED_FEATURE_FLAGS-<unset>}]"
for a in "$@"; do printf 'ARG<%s>\\n' "$a"; done
exit "\${FAKE_COPILOT_EXIT:-0}"
`,
	);
	chmodSync(vendor, 0o755);
	writeFileSync(path.join(unitDir, "extension.mjs"), "// fixture\n");

	const goodState = JSON.stringify({ schemaVersion: 1, unit: "entwurf-receive", path: unitDir });
	const writeState = (body: string): void => writeFileSync(stateFile, body);
	writeState(goodState);

	interface Run {
		status: number | null;
		out: string;
		args: string[];
		flag: string;
		cwd: string;
		pid: string;
	}
	// A PATH with no `copilot` anywhere on it — built by dropping every real PATH entry that
	// actually holds one, rather than by emptying PATH (the launcher still needs python3,
	// readlink and friends). This is how "the vendor is missing" is expressed now that the
	// gate cannot simply point the launcher at a name that does not exist.
	const pathWithoutVendor = (process.env.PATH ?? "")
		.split(":")
		.filter((d) => d !== "" && !existsSync(path.join(d, "copilot")))
		.join(":");

	function launch(args: string[], extraEnv: Record<string, string> = {}, cwd = root): Run {
		const r = spawnSync("bash", [path.join(REPO, "run.sh"), "copilot", ...args], {
			cwd,
			encoding: "utf8",
			env: {
				...process.env,
				HOME: home,
				XDG_DATA_HOME: xdg,
				PATH: `${bin}:${process.env.PATH ?? ""}`,
				COPILOT_CLI_ENABLED_FEATURE_FLAGS: undefined as unknown as string,
				ENTWURF_COPILOT_LAUNCH_ACTIVE: undefined as unknown as string,
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
			flag: /^FLAG=\[([\s\S]*)\]$/m.exec(out)?.[1] ?? "<no-launch>",
			cwd: /^CWD=(.*)$/m.exec(out)?.[1] ?? "",
			pid: /^PID=(.*)$/m.exec(out)?.[1] ?? "",
		};
	}

	// ── 1. the promise is refused unless the receiver behind it exists ──────────
	// Setting the scan flag is a PROMISE of a doorbell. Making it while no unit is
	// installed produces a session that looks managed and can never be delivered to.
	{
		rmSync(stateFile);
		const r = launch([]);
		ok(
			"[QK:COPILOT-LAUNCH-REQUIRES-RECEIVER] with no receiver install-state the launch REFUSES, names the exact repair, and never reaches the vendor",
			r.status !== 0 && r.out.includes("entwurf install-copilot-receive") && r.flag === "<no-launch>",
		);
		writeState(goodState);
	}
	{
		// A state file naming a different extensions root than this environment scans means
		// the CLI would read a directory nobody installed into — a green artifact check with
		// an inert session behind it.
		//
		// The decoy is a COMPLETE, VALID unit at the wrong place, on purpose. Pointing at a
		// path that merely does not exist would be caught by the directory check further
		// down, and this cell would pass even with the path-equality guard removed — the
		// assertion would be over-determined and the claim untested.
		const decoy = path.join(root, "other-extensions-root", "entwurf-receive");
		mkdirSync(decoy, { recursive: true });
		writeFileSync(path.join(decoy, "extension.mjs"), "// decoy\n");
		writeState(JSON.stringify({ schemaVersion: 1, unit: "entwurf-receive", path: decoy }));
		const r = launch([]);
		ok(
			"[QK:COPILOT-LAUNCH-REFUSES-PATH-MISMATCH] an install-state pointing at a different extensions root refuses instead of launching",
			r.status !== 0 && r.flag === "<no-launch>" && r.out.includes("entwurf install-copilot-receive"),
		);
		writeState(goodState);
	}
	{
		writeState("{ not json");
		const r = launch([]);
		ok(
			"an unreadable install-state refuses rather than guessing (over-determined: the empty-path guard catches it too, so this carries no claim of its own)",
			r.status !== 0 && r.flag === "<no-launch>",
		);
		writeState(goodState);
	}

	// ── 2. the flag this whole surface exists to set ────────────────────────────
	{
		const r = launch([]);
		ok(
			"[QK:COPILOT-LAUNCH-SETS-EXTENSIONS-TOKEN] the vendor is launched with the EXTENSIONS scan token — the flag no installer can set, because it belongs to a launch",
			r.status === 0 && r.flag === "EXTENSIONS",
		);
	}
	{
		// The operator's own tokens are theirs: kept, in order, deduplicated, with blank
		// fields dropped and EXTENSIONS appended exactly once.
		const r = launch([], { COPILOT_CLI_ENABLED_FEATURE_FLAGS: " FOO ,,BAR,FOO," });
		const already = launch([], { COPILOT_CLI_ENABLED_FEATURE_FLAGS: "EXTENSIONS,ZED" });
		ok(
			`[QK:COPILOT-LAUNCH-PRESERVES-OPERATOR-TOKENS] existing feature-flag tokens survive in order, deduplicated, and EXTENSIONS is added exactly once (got "${r.flag}" / "${already.flag}")`,
			r.flag === "FOO,BAR,EXTENSIONS" && already.flag === "EXTENSIONS,ZED",
		);
	}

	// ── 3. injected defaults, and the terminator that stops them ────────────────
	{
		const r = launch([]);
		ok(
			`[QK:COPILOT-LAUNCH-INJECTS-MANAGED-PROFILE] a bare managed launch adds --model auto and --yolo, and nothing else (got ${JSON.stringify(r.args)})`,
			JSON.stringify(r.args) === JSON.stringify(["--model", "auto", "--yolo"]),
		);
	}
	{
		const r = launch(["-p", "hi", "--", "--yolo", "", "a b"]);
		ok(
			`[QK:COPILOT-LAUNCH-DEFAULTS-BEFORE-TERMINATOR] defaults land BEFORE the first literal --, and everything after it crosses untouched (got ${JSON.stringify(r.args)})`,
			JSON.stringify(r.args) === JSON.stringify(["-p", "hi", "--model", "auto", "--yolo", "--", "--yolo", "", "a b"]),
		);
	}
	{
		// The `--yolo` AFTER the terminator in the case above is data, not policy: if the
		// scan read past the terminator it would have suppressed the injected one.
		const r = launch(["--", "--allow-all"]);
		ok(
			"[QK:COPILOT-LAUNCH-TERMINATOR-IS-NOT-POLICY] a policy-looking token after the terminator is data — it does not suppress the managed default",
			r.args.includes("--yolo") && r.args.indexOf("--yolo") < r.args.indexOf("--"),
		);
	}
	{
		const weird = ["", " ", "a\tb", "--not-a-flag=x y"];
		const r = launch(weird);
		ok(
			`[QK:COPILOT-LAUNCH-PRESERVES-ARGV-BYTES] every operator argument crosses byte-identical, empties and whitespace included (got ${JSON.stringify(r.args)})`,
			JSON.stringify(r.args.slice(0, weird.length)) === JSON.stringify(weird),
		);
	}

	// ── 4. explicit permission / surface policy wins over the managed default ───
	// Measured against GitHub Copilot CLI 1.0.80 `--help`. The narrowing flags are in this
	// set on purpose: appending `--yolo` (all tools + paths + URLs) beside an operator's
	// `--allow-url=…` would silently widen exactly what they were narrowing.
	{
		const overrides = [
			"--yolo",
			"--allow-all",
			"--allow-all-tools",
			"--allow-all-paths",
			"--allow-all-urls",
			"--allow-tool",
			"--deny-tool",
			"--allow-url",
			"--deny-url",
			"--available-tools",
			"--excluded-tools",
		];
		const suppressed = overrides.every((flag) => {
			const split = launch([flag, "value"]);
			const joined = launch([`${flag}=value`]);
			return (
				split.args.filter((a) => a === "--yolo").length === (flag === "--yolo" ? 1 : 0) &&
				!joined.args.includes("--yolo")
			);
		});
		ok(
			`[QK:COPILOT-LAUNCH-NO-DEFAULT-OVER-EXPLICIT-POLICY] any of the ${overrides.length} explicit permission/surface policy flags, in either --flag value or --flag=value form, suppresses the injected --yolo`,
			suppressed,
		);
	}
	{
		// The two deliberate NON-members. `--allow-all-mcp-server-instructions` is prompt
		// content, not authorization, and shares a prefix with a real override — exact
		// matching is what keeps them apart. `--autopilot` is a mode.
		const mcp = launch(["--allow-all-mcp-server-instructions"]);
		const auto = launch(["--autopilot"]);
		ok(
			"[QK:COPILOT-LAUNCH-PREFIX-IS-NOT-POLICY] --allow-all-mcp-server-instructions and --autopilot are NOT permission policy, so the managed default still applies",
			mcp.args.includes("--yolo") && auto.args.includes("--yolo"),
		);
	}
	{
		const split = launch(["--model", "gpt-5.4"]);
		const joined = launch(["--model=gpt-5.4"]);
		ok(
			`[QK:COPILOT-LAUNCH-KEEPS-OPERATOR-MODEL] an explicit --model is never overridden by the injected default, in either form (got ${JSON.stringify(split.args)} / ${JSON.stringify(joined.args)})`,
			split.args.includes("gpt-5.4") &&
				!split.args.includes("auto") &&
				joined.args.includes("--model=gpt-5.4") &&
				!joined.args.includes("auto"),
		);
	}

	// ── 5. it becomes the vendor; it does not supervise one ────────────────────
	{
		const sub = path.join(root, "elsewhere-cwd");
		mkdirSync(sub, { recursive: true });
		const r = launch([], {}, sub);
		ok(
			"[QK:COPILOT-LAUNCH-KEEPS-CALLER-CWD] the vendor starts in the caller's own directory — the launch is not a repo-scoped subshell",
			r.cwd === sub,
		);
	}
	{
		// exec, not fork: run.sh replaces itself with the leaf and the leaf with the vendor,
		// so the vendor IS the process the operator's shell is waiting on. A supervising
		// parent would show a different pid here and would own the tty.
		const r = spawnSync("bash", ["-c", `echo "SHELL_PID=$$"; exec bash "${path.join(REPO, "run.sh")}" copilot`], {
			cwd: root,
			encoding: "utf8",
			env: {
				...process.env,
				HOME: home,
				XDG_DATA_HOME: xdg,
				PATH: `${bin}:${process.env.PATH ?? ""}`,
				COPILOT_CLI_ENABLED_FEATURE_FLAGS: undefined as unknown as string,
				ENTWURF_COPILOT_LAUNCH_ACTIVE: undefined as unknown as string,
			},
		});
		const shellPid = /^SHELL_PID=(\d+)$/m.exec(r.stdout ?? "")?.[1];
		const vendorPid = /^PID=(\d+)$/m.exec(r.stdout ?? "")?.[1];
		ok(
			`[QK:COPILOT-LAUNCH-EXECS-NOT-FORKS] the vendor inherits the caller's own process, not a child of it (shell ${shellPid} === vendor ${vendorPid})`,
			Boolean(shellPid) && shellPid === vendorPid,
		);
	}

	{
		const r = launch([], { FAKE_COPILOT_EXIT: "7" });
		ok("[QK:COPILOT-LAUNCH-PASSES-EXIT-STATUS] the vendor's exit status is the launch's exit status", r.status === 7);
	}

	// ── 6. the loop that would hang a terminal ─────────────────────────────────
	{
		// A `copilot` earlier on PATH that calls `entwurf copilot` back would spin forever,
		// and the symptom would be a hung terminal rather than an error. The fixture is the
		// real accident shape: a SHADOWING `copilot`, in a directory ahead of the fake
		// vendor's, whose body re-enters the managed launch.
		const loopBin = path.join(root, "loop-bin");
		mkdirSync(loopBin, { recursive: true });
		const loopy = path.join(loopBin, "copilot");
		writeFileSync(loopy, `#!/usr/bin/env bash\nexec bash "${path.join(REPO, "run.sh")}" copilot "$@"\n`);
		chmodSync(loopy, 0o755);
		// The claim is asserted against the FENCE itself — a launch entered with the
		// sentinel already set — not against a live loop. Asserting it by spinning one up
		// would mean the mutation that removes the fence hangs the gate instead of failing
		// a cell, and a hang is red for the wrong reason.
		const fenced = launch([], { ENTWURF_COPILOT_LAUNCH_ACTIVE: "1" });
		ok(
			"[QK:COPILOT-LAUNCH-REFUSES-RECURSION] a launch entered from inside its own exec chain is refused, and never reaches the vendor",
			fenced.status !== 0 && fenced.flag === "<no-launch>" && /recursive managed launch/.test(fenced.out),
		);
		const r = launch([], { PATH: `${loopBin}:${bin}:${process.env.PATH ?? ""}` });
		ok(
			"end to end, a PATH entry that resolves back into the managed launch terminates with a refusal instead of spinning",
			r.status !== 0 && /recursive managed launch|launch loop/.test(r.out),
		);
	}
	{
		const r = launch([], { PATH: pathWithoutVendor });
		ok(
			"[QK:COPILOT-LAUNCH-REFUSES-ABSENT-VENDOR] a missing vendor executable is named as missing, not silently skipped",
			r.status !== 0 && r.out.includes("executable found on PATH"),
		);
	}

	console.log(`\n[check-copilot-launch] PASS (${passed} assertions)`);
} finally {
	rmSync(root, { recursive: true, force: true });
}
