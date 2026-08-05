// Deterministic gate for the release-gate STEP OUTCOME protocol (P1).
//
// THE DEFECT THIS OWNS. The aggregate release gate documented — in run.sh's own
// usage, README, and VERIFY — that a cut needs `LIVE=1` and `SKIP=0`. Nothing
// enforced it. Exit authority read the FAIL counter alone, so
// `./run.sh release-gate <dir>` returned 0 while printing 14 SKIPs and the words
// "all green". And a step that WAS invoked could decline a prerequisite and exit
// 0 — Cortex without `ENTWURF_ACP_CORTEX_CONNECTION` is the measured case — which
// the aggregate counted as PASS. Both holes are the same shape: a skip that
// cannot be told apart from an acceptance, which means a release summary cannot
// prove the calls it claims.
//
// WHAT THIS GATE PINS, in the order the cells run (the order is load-bearing:
// each mutant must die on ITS claim, so a cell that would fire first on another
// cell's mutation is deliberately kept narrow):
//   1. the protocol is ONE number, agreed across the shell and TS halves;
//   2. the classifier never rounds a skip up to a pass;
//   3. `--cut` refuses a MUST skip while a bare diagnostic run does not, AND the
//      refusal names its cause — a step that RAN AND BROKE is a different fact
//      from one that NEVER RAN, and the counters are never fudged to carry it;
//   4. no LIVE smoke still carries the pre-P1 exit-0 skip shape;
//   5. a real smoke invoked with LIVE unset propagates the protocol code out
//      through run_ts (the "direct LIVE!=1" case);
//   6. a run.sh wrapper that declines its own prerequisite does the same (the
//      "internal prerequisite" case, Cortex being the one that was measured).
//   7. every LIVE smoke is either wired into the aggregate or excluded for a
//      reason the docs actually state — the protocol cannot vouch for a step the
//      gate never lists.
//
// Cells 5-6 SPAWN the real subcommands rather than reasoning about them: the
// whole defect was an assumption about what a step would do, so an assumption is
// exactly what this gate must not make. They are cheap — each smoke declines
// before it does any work.
//
// Pure + subprocess, no network/model — IN pnpm check.

import { strict as assert } from "node:assert";
import { execFileSync } from "node:child_process";
import { globSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import { LIVE_SKIP_EXIT, LIVE_SKIP_MARKER } from "./lib/live-skip.ts";

const REPO_DIR = fileURLToPath(new URL("..", import.meta.url));
const SHELL_LIB = "scripts/lib/step-outcome.sh";

/** Run a snippet with the shell half sourced; returns trimmed stdout. */
function inShell(snippet: string): string {
	return execFileSync("bash", ["-c", `. "${SHELL_LIB}"; ${snippet}`], {
		cwd: REPO_DIR,
		encoding: "utf8",
		timeout: 20_000,
	}).trim();
}

/** Invoke a real run.sh subcommand; returns its exit code + combined output. */
function runSubcommand(sub: string, env: Record<string, string | undefined>): { code: number; output: string } {
	const childEnv: Record<string, string> = {};
	for (const [k, v] of Object.entries({ ...process.env, ...env })) {
		if (v !== undefined) childEnv[k] = v;
	}
	try {
		const out = execFileSync("bash", ["run.sh", sub], {
			cwd: REPO_DIR,
			encoding: "utf8",
			timeout: 120_000,
			env: childEnv,
			stdio: ["ignore", "pipe", "pipe"],
		});
		return { code: 0, output: out };
	} catch (err) {
		const e = err as { status?: number | null; stdout?: string; stderr?: string };
		return { code: e.status ?? -1, output: `${e.stdout ?? ""}${e.stderr ?? ""}` };
	}
}

// ===========================================================================
// 1) ONE protocol, two languages. A drifted constant does not degrade
//    gracefully — it silently reclassifies every skip in the aggregate.
// ===========================================================================
{
	const shellValue = inShell('echo "$ENTWURF_STEP_SKIP_EXIT"');
	assert.equal(
		shellValue,
		String(LIVE_SKIP_EXIT),
		`[QK:SKIP-EXIT-ONE-PROTOCOL] ${SHELL_LIB} and scripts/lib/live-skip.ts must name the SAME skip exit code. ` +
			"The smokes exit with the TS constant and the aggregate classifies with the shell one, so a drift between " +
			"them turns every honest skip into a FAIL (or, the other way, into a PASS) with nothing in the summary " +
			`saying so. shell=${shellValue} ts=${LIVE_SKIP_EXIT}`,
	);
	// The code must also stay clear of the ranges that already mean something
	// else, or a dependency's unrelated verdict reads as a skip.
	assert.ok(
		LIVE_SKIP_EXIT > 4 && LIVE_SKIP_EXIT < 126,
		"the skip code must avoid the per-tool contract band (0..4) and the shell's signal band (126+)",
	);
}

// ===========================================================================
// 2) The classifier. A skip is its own outcome, never rounded up or down.
// ===========================================================================
{
	const table: Array<[string, string]> = [
		["0", "PASS"],
		[String(LIVE_SKIP_EXIT), "SKIP"],
		["1", "FAIL"],
		["2", "FAIL"],
		["127", "FAIL"],
		["137", "FAIL"],
	];
	for (const [code, expected] of table) {
		const got = inShell(`entwurf_step_outcome ${code}`);
		assert.equal(
			got,
			expected,
			`[QK:STEP-OUTCOME-SKIP-NOT-PASS] exit ${code} must classify as ${expected}, got ${got}. A skip rounded up to ` +
				"PASS is exactly the pre-P1 defect: the aggregate then reports acceptance for a step that told it, in the " +
				"only channel it has, that it never ran. A skip rounded down to FAIL is the mirror error and makes the " +
				"unattended diagnostic unusable.",
		);
	}
}

// ===========================================================================
// 3) Cut authority. `--cut` is the executable half of "a CUT needs SKIP=0";
//    without it the diagnostic must stay green so an unattended run is usable.
// ===========================================================================
{
	const releasable = (failc: number, skipc: number, cut: number): boolean =>
		inShell(`if entwurf_release_releasable ${failc} ${skipc} ${cut}; then echo YES; else echo NO; fi`) === "YES";

	assert.ok(releasable(0, 0, 1), "a cut with no failures and no skips is releasable");
	assert.ok(!releasable(1, 0, 1), "a failure blocks a cut");
	assert.ok(!releasable(1, 0, 0), "a failure blocks the diagnostic too — FAIL was always blocking");
	assert.ok(
		releasable(0, 3, 0),
		"a DIAGNOSTIC run with skips stays exit 0 — an unattended `./run.sh release-gate` must remain runnable, and " +
			"turning it red was never the ask",
	);
	assert.ok(
		!releasable(0, 3, 1),
		"[QK:CUT-REFUSES-SKIP] `--cut` must refuse a MUST SKIP. This is the whole point: the release procedure said " +
			'"a CUT needs LIVE=1, SKIP=0" in prose while the code returned 0 with 14 skips, so a summary could be quoted ' +
			"as acceptance for calls that never happened. It also removes the need for a separate LIVE assertion — with " +
			"LIVE unset every LIVE-gated step skips, and the skip count is what blocks.",
	);

	// …and the refusal must SAY WHICH of the two it is. A blocked cut caused by a
	// broken call and one caused by an absent prerequisite need different actions
	// from whoever reads the record, and the counters must not be fudged to carry
	// that (a synthesized FAIL=1 for a policy block erases the distinction).
	const verdict = (failc: number, skipc: number, cut: number): string =>
		inShell(`entwurf_release_verdict ${failc} ${skipc} ${cut}`);

	assert.equal(verdict(0, 0, 1), "cut: OK", "a clean cut says so in one token");
	assert.equal(
		verdict(0, 3, 0),
		"cut: n/a (diagnostic, 3 SKIP)",
		"a diagnostic run names its skips without claiming a cut",
	);
	assert.equal(verdict(0, 0, 0), "cut: n/a (diagnostic)", "a clean diagnostic run still does not claim a cut");
	assert.equal(
		verdict(1, 0, 1),
		"cut: BLOCKED (MUST FAIL)",
		"a step that RAN AND BROKE must be named as a failure — that is a defect to fix",
	);
	assert.equal(
		verdict(0, 3, 1),
		"cut: BLOCKED (MUST SKIP)",
		"[QK:CUT-VERDICT-NAMES-CAUSE] a cut blocked ONLY by skips must say so in its own token, distinct from a failure " +
			"block. An operator (and the P5 release record) reads two different actions out of these: a MUST FAIL is a " +
			"broken call to fix, a MUST SKIP is a prerequisite to supply. Collapsing them into one string — or worse, " +
			"synthesizing FAIL=1 for the policy block — throws away the exact distinction this protocol was built to make.",
	);
	assert.equal(
		verdict(2, 5, 1),
		"cut: BLOCKED (MUST FAIL)",
		"when both are present the FAILURE is the headline — a broken call outranks a missing prerequisite",
	);
}

// ===========================================================================
// 4) No LIVE smoke still carries the pre-P1 skip shape (static, all of them).
//    A future smoke that hand-rolls `exit 0` on a skip re-opens the hole for
//    one lane only, which is precisely how this survived so long.
// ===========================================================================
{
	const smokes = globSync("scripts/smoke-*live*.ts", { cwd: REPO_DIR }).sort();
	assert.ok(smokes.length >= 15, `expected the LIVE smoke family, found ${smokes.length}`);
	let liveGated = 0;
	for (const rel of smokes) {
		const src = readFileSync(join(REPO_DIR, rel), "utf8");
		if (!src.includes("process.env.LIVE")) continue; // gated in run.sh instead (cell 6 owns that surface)
		liveGated++;
		// ONE assertion, three ways to fail it: no protocol import, or either of
		// the two pre-P1 shapes (exit 0 / bare return) still inside the LIVE gate.
		// Kept as one so the claim owns every way a smoke can go back to being
		// indistinguishable from success — a split would let a mutation die on an
		// unclaimed sibling assertion instead of here.
		const importsProtocol = src.includes('from "./lib/live-skip.ts"');
		const exitsZero = /LIVE !== "1"[\s\S]{0,400}?process\.exit\(0\)/.test(src);
		const bareReturns = /LIVE !== "1"[\s\S]{0,400}?\n\t+return;/.test(src);
		assert.ok(
			importsProtocol && !exitsZero && !bareReturns,
			`[QK:NO-SMOKE-SKIPS-WITH-ZERO] ${basename(rel)} gates on LIVE but does not decline through skipLive ` +
				`(importsProtocol=${importsProtocol} exitsZero=${exitsZero} bareReturns=${bareReturns}). Every LIVE smoke ` +
				"must take the one protocol exit — a hand-rolled `process.exit(0)` or bare `return` is indistinguishable " +
				"from success, which is exactly what let the aggregate count a never-run step as PASS.",
		);
	}
	assert.ok(liveGated >= 15, `expected most LIVE smokes to gate on LIVE, got ${liveGated}`);
}

// ===========================================================================
// 5) REAL propagation — the direct `LIVE!=1` case, end to end through run_ts.
//    Static source pins cannot see a transport that swallows the code.
// ===========================================================================
{
	const { code, output } = runSubcommand("smoke-acp-raw-turn-live", { LIVE: undefined });
	assert.equal(
		code,
		LIVE_SKIP_EXIT,
		`[QK:LIVE-SKIP-IS-PROTOCOL-EXIT] a LIVE smoke invoked with LIVE unset must leave the protocol's SKIP code on ` +
			`the process, all the way out through run_ts — got exit ${code}. Exit 0 here is the original defect: the ` +
			`aggregate cannot tell "I declined" from "I passed", so it reports acceptance. Output: ` +
			`${JSON.stringify(output.slice(-300))}`,
	);
	assert.ok(
		output.includes(LIVE_SKIP_MARKER),
		`the skip must also be readable by a human in the log — ${LIVE_SKIP_MARKER} names the missing prerequisite so an ` +
			"operator who hits a red --cut run knows what to supply. Output: " +
			JSON.stringify(output.slice(-300)),
	);
}

// ===========================================================================
// 6) REAL propagation — a run.sh WRAPPER declining its own prerequisite. This
//    is the second skip surface: some smokes never reach their .ts file at all.
// ===========================================================================
{
	const viaWrapper = runSubcommand("smoke-acp-cortex-live", { LIVE: undefined });
	assert.equal(
		viaWrapper.code,
		LIVE_SKIP_EXIT,
		`[QK:WRAPPER-SKIP-IS-PROTOCOL-EXIT] a run.sh smoke WRAPPER that declines a prerequisite must return the protocol ` +
			`SKIP code, not 0 — got exit ${viaWrapper.code}. The wrapper is a skip surface of its own (cortex, matrix, ` +
			"spawn-live and spawn-resume all decline before their .ts is ever reached), so fixing only the TypeScript " +
			`half would leave the aggregate counting those as PASS. Output: ${JSON.stringify(viaWrapper.output.slice(-300))}`,
	);

	// The measured Cortex cell: LIVE IS set, but the connection the adapter needs
	// is not. Which branch declines (the wrapper's `cortex` PATH check or the
	// smoke's own connection check) depends on the host; the OUTCOME must not.
	const missingPrereq = runSubcommand("smoke-acp-cortex-live", {
		LIVE: "1",
		ENTWURF_ACP_CORTEX_CONNECTION: undefined,
	});
	assert.equal(
		missingPrereq.code,
		LIVE_SKIP_EXIT,
		"LIVE=1 with no ENTWURF_ACP_CORTEX_CONNECTION must be a SKIP, not a PASS — this is the exact cell that made a " +
			"cortex-less host look like cortex acceptance. Output: " +
			JSON.stringify(missingPrereq.output.slice(-300)),
	);
}

// ===========================================================================
// 7) NO SILENT AGGREGATE OMISSION. The protocol tells the truth about the steps
//    the gate RUNS; it says nothing about steps the gate never lists. Three LIVE
//    smokes (cortex, spawn-live, claude-native-resume) sat outside the aggregate
//    with no stated reason until 2026-07-31, so a green cut was silent about the
//    second backend, the spawn substrate, and native resume.
//
//    So: every LIVE smoke is either WIRED into release_gate or EXCLUDED for a
//    reason an operator can read in the docs. The exclusion half is checked
//    against the doc text, not against a list in this file — an exclusion that
//    only this gate believes in is how the omission would come back.
// ===========================================================================
{
	const runSh = readFileSync(join(REPO_DIR, "run.sh"), "utf8");
	const gateBody = runSh.slice(runSh.indexOf("release_gate() {"), runSh.indexOf("# 5. Summary"));
	assert.ok(gateBody.length > 1000, "located the release_gate body");

	// name → the sentence in the docs that carries its exclusion, and where.
	const DOCUMENTED_EXCLUSIONS: Record<string, [file: string, sentence: string]> = {
		"smoke-acp-long-turn-live": ["VERIFY.md", "on-demand, not part of `release-gate`"],
		"smoke-mux-fresh-call-live": ["VERIFY.md", "Fresh-call LIVE is on-demand, not part of `release-gate`"],
		"smoke-agy-native-push-live": ["VERIFY.md", "Aggregate release-gate does not own an agy conversation id"],
		"smoke-acp-ordering-probe-live": ["docs/acp-backend-rail.md", "opt-in paired observation"],
		// Cortex needs an external Snowflake connection the HOST owns, so an aggregate
		// that required it would block every cut taken without that account. Excluded —
		// NOT waived: its direct call stays required for a Cortex-rail cut, and running
		// it without the connection still reports protocol SKIP rather than a pass.
		"smoke-acp-cortex-live": ["VERIFY.md", "The 0.13.1 aggregate does not re-certify Cortex"],
	};

	const allLive = globSync("scripts/smoke-*live*.{ts,sh}", { cwd: REPO_DIR })
		.map((p) => basename(p).replace(/\.(ts|sh)$/, ""))
		.sort();
	assert.ok(allLive.length >= 18, `expected the full LIVE smoke family, found ${allLive.length}`);

	for (const name of allLive) {
		const wired = gateBody.includes(`"$self" ${name}\n`) || gateBody.includes(`"$self" ${name} `);
		const excused = DOCUMENTED_EXCLUSIONS[name];
		if (wired) {
			assert.ok(!excused, `${name} is both wired and excused — pick one`);
			continue;
		}
		assert.ok(
			excused,
			`[QK:NO-SILENT-AGGREGATE-OMISSION] ${name} is neither wired into release_gate nor excluded in the docs. ` +
				"A LIVE smoke that exists but is never listed makes a green cut silent about the axis it covers — exactly " +
				"how cortex (the second shipped backend), spawn-live and claude-native-resume went unrun for releases. " +
				"Wire it, or state the exclusion where an operator reads it.",
		);
		const [file, sentence] = excused as [string, string];
		assert.ok(
			readFileSync(join(REPO_DIR, file), "utf8").includes(sentence),
			`${name} claims a documented exclusion, but ${file} no longer says "${sentence}" — an exclusion only this ` +
				"gate believes in is not documented",
		);
	}
}

// ===========================================================================
// 8. qualification scheduling topology — the subtraction has its own oracle.
//    check-gate-qualification left the default `pnpm check` chain (operator
//    inner-loop cost, 2026-08 subtraction). That move is a gate/release
//    contract: the step must stay REACHABLE on the axes that now own it — the
//    CI check job on every push and release_gate as its own MUST step — and
//    must not silently return to the default chain. Without this cell,
//    deleting the release_gate qualification block or the CI line leaves every
//    focused gate green while a cut quietly loses its discriminating-power
//    step.
// ===========================================================================
{
	const pkgCheck = (
		JSON.parse(readFileSync(join(REPO_DIR, "package.json"), "utf8")) as { scripts: Record<string, string> }
	).scripts.check;
	const ciYml = readFileSync(join(REPO_DIR, ".github/workflows/ci.yml"), "utf8");
	const ciHits = ciYml.split("- run: ./run.sh check-gate-qualification").length - 1;
	const runShQ = readFileSync(join(REPO_DIR, "run.sh"), "utf8");
	const qualGateBody = runShQ.slice(runShQ.indexOf("release_gate() {"), runShQ.indexOf("# 5. Summary"));
	const invocations = qualGateBody.split('bash "$self" check-gate-qualification').length - 1;
	const verifyDoc = readFileSync(join(REPO_DIR, "VERIFY.md"), "utf8");

	// One claim token, one assert (the qualification runner requires the exact-once
	// signature); each broken axis names itself in the joined message.
	const holes: string[] = [];
	if (pkgCheck.includes("check-gate-qualification"))
		holes.push(
			"package.json's default `check` chain contains check-gate-qualification again (doubles every closure floor)",
		);
	if (ciHits !== 1) holes.push(`the CI check job runs check-gate-qualification ${ciHits}x (need exactly once)`);
	if (ciHits === 1 && ciYml.indexOf("- run: pnpm check") > ciYml.indexOf("- run: ./run.sh check-gate-qualification"))
		holes.push("CI runs qualification before the pnpm check step it qualifies");
	if (invocations !== 1)
		holes.push(`release_gate invokes check-gate-qualification ${invocations}x (need exactly one MUST step)`);
	if (
		!qualGateBody.includes('results+=("PASS  check-gate-qualification")') ||
		!qualGateBody.includes('results+=("FAIL  check-gate-qualification")')
	)
		holes.push("the release_gate qualification step does not wire PASS/FAIL into the MUST counters");
	if (!verifyDoc.includes("in the CI `check` job on every push, and as a release-gate MUST step"))
		holes.push("VERIFY.md no longer names the owners of the moved qualification step");
	assert.ok(
		holes.length === 0,
		"[QK:QUALIFICATION-SCHEDULING-REACHABLE] check-gate-qualification left the default `pnpm check` chain " +
			"deliberately, so it must stay REACHABLE on the axes that own it now — absent from the default chain, " +
			"exactly once in the CI check job after pnpm check, exactly once as a release_gate MUST step with its " +
			`outcome wired, and named in VERIFY. Broken: ${holes.join("; ")}`,
	);
}

console.log(
	"[check-release-gate-outcomes] ok — STEP OUTCOME protocol: one skip exit code shared by the shell and TS halves " +
		`(${LIVE_SKIP_EXIT}, clear of the per-tool 0..4 and shell 126+ bands), classifier maps 0→PASS / skip→SKIP / ` +
		"everything else→FAIL (never rounding a skip up), `--cut` refuses a MUST SKIP while a bare diagnostic run stays " +
		"exit 0, no LIVE smoke still carries the pre-P1 exit-0 skip shape, and both real skip surfaces were INVOKED and " +
		"observed to propagate the code: a smoke with LIVE unset (through run_ts, with its operator-readable marker) and " +
		"a run.sh wrapper declining its own prerequisite (including the measured LIVE=1 no-cortex-connection cell); and every " +
		"LIVE smoke is either wired into release_gate or excluded by a sentence the docs still carry; and the moved " +
		"check-gate-qualification stays reachable on its owners (absent from the default chain, exactly once in CI, " +
		"exactly once as a release-gate MUST step)",
);
