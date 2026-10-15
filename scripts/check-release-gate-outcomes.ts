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
//      gate never lists;
//   8. the moved check-gate-qualification stays reachable as the schedule/dispatch
//      drift diagnostic it is since #144 (never a push, never release_gate), that
//      diagnostic runs over the FULL floor, and the exact-SHA release oracle takes
//      only a push run as its witness, refuses every required job that did not
//      conclude success, and never reports the qualification body;
//   9. every gate a committed mutant NAMES also runs inside `check:full` (or says
//      in its own prose why it deliberately does not) — a gate reachable only
//      through qualification's control-pre puts a whole defect class behind the
//      28-minute body;
//  10. the CI push trigger is filtered to BRANCH refs, so pushing a release tag
//      does not rebuild a SHA its branch run already built.
//
// Cells 5-6 SPAWN the real subcommands rather than reasoning about them: the
// whole defect was an assumption about what a step would do, so an assumption is
// exactly what this gate must not make. They are cheap — each smoke declines
// before it does any work.
//
// Pure + subprocess, no network/model — IN pnpm run check:full.

import { strict as assert } from "node:assert";
import { execFileSync, spawnSync } from "node:child_process";
import {
	existsSync,
	globSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	realpathSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
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
			`SKIP code, not 0 — got exit ${viaWrapper.code}. The wrapper is a skip surface of its own (cortex and matrix ` +
			"both decline before their .ts is ever reached), so fixing only the TypeScript " +
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
//    second backend, the spawn substrate, and native resume. (spawn-live was
//    deleted with its transport in the visible-first cut; the incident is kept
//    verbatim because it is what this rule was derived from.)
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
		"smoke-codex-native-push-live": ["VERIFY.md", "Aggregate release-gate does not own a loaded Codex thread"],
		"smoke-acp-ordering-probe-live": ["docs/acp-backend-rail.md", "opt-in paired observation"],
		// Cortex needs an external Snowflake connection the HOST owns, so an aggregate
		// that required it would block every cut taken without that account. Excluded —
		// NOT waived: its direct call stays required for a Cortex-rail cut, and running
		// it without the connection still reports protocol SKIP rather than a pass.
		"smoke-acp-cortex-live": ["VERIFY.md", "The release aggregate does not re-certify Cortex"],
		// #116 C4: first evidence precedes promotion. The herdr rail's LIVE acceptance exists and
		// runs on demand, but a rail whose first real acceptance run is days old has not earned a
		// place in the aggregate that blocks every cut — and herdr is an OPTIONAL rail, so a cut
		// on a host without it would block for a capability the product does not require.
		"smoke-herdr-fresh-call-live": ["VERIFY.md", "The release aggregate does not yet require the herdr rail"],
		// #116 M3-b3, same rail and the same reason: the plugin build smoke drives a REAL
		// `herdr plugin install` over the network. herdr is optional, so an aggregate that required it
		// would block a cut on a host that does not have the rail at all. Its first LIVE acceptance
		// landed 2026-09-16 (5 assertions, 0 skipped) — one run is evidence the axis works, not the run
		// history that earns a place in the gate blocking every cut. On-demand, with the exclusion
		// stated where an operator reads it.
		"smoke-herdr-plugin-build-live": ["VERIFY.md", "The release aggregate does not require the plugin build smoke"],
		// #118 홉 1, third on the same rail and for the same two reasons: herdr is OPTIONAL, so an
		// aggregate that required this would block a cut on a host that does not have the rail at
		// all; and first evidence precedes promotion — this smoke's acceptance runs are hours old,
		// which is evidence the axis works rather than the run history that earns a place in the
		// gate blocking every cut. It also needs a Docker daemon and the public network, neither of
		// which the aggregate owns. On-demand, with the exclusion stated where an operator reads it.
		"smoke-herdr-raw-install-live": ["VERIFY.md", "The plugin's FIRST USER PATH is its own on-demand axis"],
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
				"how cortex (the second shipped backend) and claude-native-resume went unrun for releases. " +
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
//    check-gate-qualification left the default check chains (operator
//    inner-loop cost, 2026-08 subtraction), and #132/#133 moved it off
//    release_gate. #144 took it off every push and out of release acceptance: the
//    whole body is a drift diagnostic that runs only on the weekly schedule or a
//    `qualify=true` dispatch, and the release oracle reads only the push run's four
//    required jobs. That is a gate/release contract: the step must stay REACHABLE on
//    exactly those triggers, and must not silently return to the default chain, to
//    release_gate, to a push, or to the release skill as an automatic dispatch.
//
//    TWO claims, because each is an independent contract. 8a is REACHABILITY
//    (absent from the default chain, from release_gate, from push and from the
//    release skill; present exactly once in CI under its two triggers). 8b is what
//    that diagnostic runs over (the FULL floor, before it), added by #70. Each
//    carries its own replant — one mutant must never stand in for another.
// ===========================================================================
{
	// The default chain is tiered (#70): `check` (core) and `check:full` compose the
	// named group scripts, so the reachability scan covers EVERY check* script —
	// qualification sneaking into any group re-doubles the closure floor.
	const pkgScripts = (
		JSON.parse(readFileSync(join(REPO_DIR, "package.json"), "utf8")) as { scripts: Record<string, string> }
	).scripts;
	const pkgCheck = Object.entries(pkgScripts)
		.filter(([name]) => name === "check" || name.startsWith("check:"))
		.map(([, body]) => body)
		.join(" && ");
	const ciYml = readFileSync(join(REPO_DIR, ".github/workflows/ci.yml"), "utf8");
	const ciHits = ciYml.split("- run: ./run.sh check-gate-qualification").length - 1;
	const runShQ = readFileSync(join(REPO_DIR, "run.sh"), "utf8");
	const qualGateBody = runShQ.slice(runShQ.indexOf("release_gate() {"), runShQ.indexOf("# 5. Summary"));
	const invocations = qualGateBody.split('bash "$self" check-gate-qualification').length - 1;
	const qualStepAt = ciYml.indexOf("- run: ./run.sh check-gate-qualification");
	const qualIf = qualStepAt === -1 ? "" : (ciYml.slice(qualStepAt).split("\n")[1] ?? "").trim();
	const releaseSkill = readFileSync(join(REPO_DIR, ".claude/skills/entwurf-release/SKILL.md"), "utf8");

	// One claim token, one assert (the qualification runner requires the exact-once
	// signature); each broken axis names itself in the joined message.
	const holes: string[] = [];
	if (pkgCheck.includes("check-gate-qualification"))
		holes.push(
			"package.json's default `check` chain contains check-gate-qualification again (doubles every closure floor)",
		);
	if (ciHits !== 1) holes.push(`the CI check job runs check-gate-qualification ${ciHits}x (need exactly once)`);
	if (invocations !== 0)
		holes.push(
			`release_gate invokes check-gate-qualification ${invocations}x (need none: the body is a schedule/dispatch diagnostic, #144)`,
		);
	if (
		qualGateBody.includes("PASS  check-gate-qualification") ||
		qualGateBody.includes("FAIL  check-gate-qualification")
	)
		holes.push("release_gate still counts a check-gate-qualification MUST row");
	if (qualIf !== "if: github.event_name == 'schedule' || inputs.qualify == true")
		holes.push(
			`the CI qualification step's trigger is \`${qualIf}\` (need the schedule or a qualify=true dispatch only)`,
		);
	if (ciYml.includes("qualify-decide")) holes.push("ci.yml still carries the retired push qualification filter step");
	if (releaseSkill.includes("-f qualify=true"))
		holes.push("the release skill still dispatches the qualification body (it is not release evidence, #144)");
	assert.ok(
		holes.length === 0,
		"[QK:QUALIFICATION-SCHEDULING-REACHABLE] check-gate-qualification left the default check chains " +
			"deliberately, so it must stay REACHABLE on the triggers that own it now — exactly once in the CI check " +
			"job, on the weekly schedule or a qualify=true dispatch only — and absent from the default chain, from " +
			`release_gate, from every push and from the release skill. Broken: ${holes.join("; ")}`,
	);

	// 8b. WHAT the CI qualification step runs over — its own claim, not a branch
	//     folded into the one above. #70 split the deterministic floor into tiers:
	//     the diagnostic body on top of the ≤60s core would re-plant mutants over a
	//     floor no candidate ships on. This is ONE contract with one condition —
	//     the full floor is present in the CI check job AND qualification follows
	//     it — because a floor that is absent and a floor that runs afterwards
	//     break the same promise identically. The committed replant qualifies the
	//     downgrade/omission axis (the tier rename downgrading CI back to core);
	//     ordering stays directly asserted here and has no incident-earned mutant.
	const ciFloorAt = ciYml.indexOf("- run: pnpm run check:full");
	const ciQualAt = ciYml.indexOf("- run: ./run.sh check-gate-qualification");
	assert.ok(
		ciFloorAt !== -1 && ciQualAt > ciFloorAt,
		"[QK:CI-FULL-FLOOR-QUALIFIED] the CI check job owns the FULL deterministic floor (#70): it must run " +
			"`pnpm run check:full` — not the ≤60s core — and check-gate-qualification must come AFTER it, so the " +
			"diagnostic body (schedule or dispatch) re-plants over the floor a candidate actually ships on. The committed replant qualifies the " +
			"downgrade/omission axis; ordering is directly asserted by this same oracle. " +
			`Broken: check:full at index ${ciFloorAt}, qualification at index ${ciQualAt}.`,
	);
}

// ===========================================================================
// 8c'. The release oracle, driven, not read (#144). The shipped verify-exact-ci.sh
//      runs unmodified in verify mode with a PATH holding only bash, python3 and a
//      fake `gh`, so the mocked boundary is the external CLI and the script gains
//      no input of its own (a RUN_JSON seam in the shipped script would be a way to
//      launder release evidence past gh). The fake logs every call first, admits
//      only the four argv shapes verify mode sends, and refuses anything else with
//      its own code and marker. THREE claims, asserted in this order so each
//      mutant dies on its own:
//        - the witness is a PUSH run: the one `run list` call carries
//          `--event push` and a jq keeping only push runs of this SHA. That is the
//          argv the script SENDS; the fake does not evaluate the jq, and GitHub's
//          own filtering is not observed here;
//        - every required job that did not conclude success is refused by name
//          (absent, failure, skipped, cancelled, null);
//        - the qualification body is not a release axis: the oracle passes whether
//          the check job's body step is skipped, absent or green, and never prints
//          it.
//      `wait` mode and newest-run choice are outside this cell. The four job names
//      are this gate's own literals, never read from the script. Each negative
//      cell changes one fact and nothing else.
// ===========================================================================
{
	const oracle = join(REPO_DIR, ".claude/skills/entwurf-release/scripts/verify-exact-ci.sh");
	const required = ["check", "install-surface", "artifact-consumer", "macos-install-surface"];
	const qualStep = "Run ./run.sh check-gate-qualification";
	const sha = "0123456789abcdef0123456789abcdef01234567";
	const unexpected = "UNEXPECTED-GH-ARGV";
	const tmp = mkdtempSync(join(tmpdir(), "entwurf-exact-ci-"));
	const bin = join(tmp, "bin");
	const resolve = (tool: string) =>
		realpathSync(execFileSync("bash", ["-c", `command -v ${tool}`], { encoding: "utf8" }).trim());
	const wrong: string[] = [];
	const wrongWitness: string[] = [];
	const wrongNoBody: string[] = [];
	try {
		mkdirSync(bin);
		mkdirSync(join(tmp, "home"));
		symlinkSync(resolve("bash"), join(bin, "bash"));
		symlinkSync(resolve("python3"), join(bin, "python3"));
		const runList = `run list --repo fixture/entwurf --workflow ci.yml --commit ${sha} --event push --limit 10 --json databaseId,headSha,createdAt,event --jq`;
		const pushOnlyJq = `map(select(.headSha == "${sha}" and .event == "push")) | sort_by(.createdAt) | reverse | .[0].databaseId // empty`;
		writeFileSync(
			join(bin, "gh"),
			[
				`#!${join(bin, "bash")}`,
				'd="${0%/*}/.."',
				`printf '%s\\n' "$*" >> "$d/gh.log"`,
				'case "$*" in',
				'  "auth status") exit 0 ;;',
				"  \"repo view --json nameWithOwner --jq .nameWithOwner\") printf 'fixture/entwurf\\n'; exit 0 ;;",
				'  "run view 4242 --repo fixture/entwurf --json databaseId,headSha,status,conclusion,url,event,jobs")',
				`    printf '%s\\n' "$(<"$d/run.json")"; exit 0 ;;`,
				"esac",
				`if [ "$#" -eq 16 ] && [ "\${*:1:15}" = "${runList}" ]; then printf '4242\\n'; exit 0; fi`,
				`printf '${unexpected}: %s\\n' "$*" >&2`,
				"exit 86",
				"",
			].join("\n"),
			{ mode: 0o755 },
		);
		// The check job carries the body step the way a push run renders it since #144:
		// present and skipped. The no-body cells below vary only that step.
		const job = (name: string, body: string | null = "skipped") => ({
			name,
			status: "completed",
			conclusion: "success" as string | null,
			steps: name === "check" && body !== null ? [{ name: qualStep, status: "completed", conclusion: body }] : [],
		});
		const drive = (jobs: ReturnType<typeof job>[]) => {
			writeFileSync(
				join(tmp, "run.json"),
				JSON.stringify({
					databaseId: 4242,
					headSha: sha,
					status: "completed",
					conclusion: "success",
					url: "https://example.invalid/runs/4242",
					event: "push",
					jobs,
				}),
			);
			rmSync(join(tmp, "gh.log"), { force: true });
			const r = spawnSync(join(bin, "bash"), [oracle, sha, "verify"], {
				encoding: "utf8",
				env: { PATH: bin, HOME: join(tmp, "home") },
				timeout: 20_000,
			});
			// No log means no call reached the fake; the cell names that through its own fields.
			const log = existsSync(join(tmp, "gh.log")) ? readFileSync(join(tmp, "gh.log"), "utf8") : "";
			return { ...r, log };
		};

		const control = drive(required.map((name) => job(name)));
		const passLines = [
			`exact-ci: PASS sha=${sha} run=4242 event=push`,
			...required.map((name) => `exact-ci: job ${name}=success`),
			"exact-ci: qualification BODY is not a release axis (#144)",
		];
		const calls = control.log.trim().split("\n");
		const listCalls = calls.filter((call) => call.startsWith("run list "));
		if (listCalls.length !== 1 || listCalls[0] !== `${runList} ${pushOnlyJq}`)
			wrongWitness.push(`run list calls: ${JSON.stringify(listCalls)}`);
		if (
			control.status !== 0 ||
			passLines.some((line) => !control.stdout.includes(line)) ||
			control.stderr.includes(unexpected) ||
			calls.length !== 4 ||
			calls.some((call) => call.startsWith("run watch"))
		)
			wrong.push(`control: status=${control.status}, out=${control.stdout.trim()}, err=${control.stderr.trim()}`);

		for (const name of required) {
			for (const state of ["absent", "failure", "skipped", "cancelled", "null"]) {
				const jobs = required.map((n) => job(n)).filter((j) => state !== "absent" || j.name !== name);
				for (const j of jobs) if (j.name === name) j.conclusion = state === "null" ? null : state;
				const shown = state === "absent" || state === "null" ? "None" : `'${state}'`;
				const diagnostic = `job '${name}' conclusion=${shown}, expected 'success'`;
				const r = drive(jobs);
				if (
					r.status === 0 ||
					!r.stderr.includes("ABORT: exact-SHA CI contract failed:") ||
					!r.stderr.includes(diagnostic) ||
					r.stdout.includes("exact-ci: PASS") ||
					r.stderr.includes(unexpected)
				)
					wrong.push(`${name}=${state}: status=${r.status}, want "${diagnostic}", err=${r.stderr.trim()}`);
			}
		}

		// The body step skipped (the control), absent, or green: the oracle passes on
		// the four jobs alone and its output never names the body.
		const bodyCells: [string, { status: number | null; stdout: string }][] = [["skipped", control]];
		bodyCells.push(["absent", drive(required.map((name) => job(name, null)))]);
		bodyCells.push(["success", drive(required.map((name) => job(name, "success")))]);
		for (const [body, r] of bodyCells) {
			if (r.status !== 0 || !r.stdout.includes("exact-ci: PASS") || r.stdout.includes("check-gate-qualification"))
				wrongNoBody.push(`body step ${body}: status=${r.status}, out=${r.stdout.trim()}`);
		}
	} finally {
		rmSync(tmp, { recursive: true, force: true });
	}
	assert.ok(
		wrongWitness.length === 0,
		"[QK:RELEASE-WITNESS-IS-PUSH-RUN] the exact-SHA CI oracle must ask for the PUSH run of this SHA only: one " +
			"`run list` call carrying `--event push` and a jq that keeps only push runs at this headSha. A " +
			"workflow_dispatch run is the optional qualification diagnostic, never release evidence; admitted, a " +
			`running or red dispatch would become the run judged. Broken: ${wrongWitness.join("; ")}`,
	);
	assert.ok(
		wrong.length === 0,
		"[QK:RELEASE-ORACLE-REFUSES-NON-SUCCESS-JOB] the exact-SHA CI oracle must accept a run whose four required " +
			"jobs concluded success and refuse it, naming the job, when any one of them is absent, failed, skipped, " +
			"cancelled or unconcluded -- a release SHA is certified only by success, never by the absence of failure. " +
			`Broken:\n  ${wrong.join("\n  ")}`,
	);
	assert.ok(
		wrongNoBody.length === 0,
		"[QK:RELEASE-ORACLE-CLAIMS-NO-BODY] the qualification body is not a release axis (#144): the exact-SHA CI " +
			"oracle must pass on the four required jobs whether the check job's body step is skipped, absent or green, " +
			"and must never print it, since a PASS that names the body would read as kill-power evidence the release " +
			`did not measure. Broken:\n  ${wrongNoBody.join("\n  ")}`,
	);
}

// ===========================================================================
// 9. Every gate a mutant manifest NAMES runs inside `pnpm run check:full`
//
//    The measurement behind this (#99 B-3/B-4): across 549 CI runs the mutant-
//    EXECUTION half of qualification never once produced a SURVIVED / WRONG-REASON /
//    MUTANT-STALE / HANG. What it did catch twice was a gate that was already red on a
//    clean tree — CONTROL-PRE — and that class is caught 5.4 minutes earlier, and for
//    free, by any gate the deterministic floor already runs. So a mutant-named gate
//    that sits OUTSIDE `check:full` is the one place where a baseline break can only
//    be found by paying the 28-minute body. `check-omp-birth-hook` was exactly that
//    gate, reachable in the whole repo only through qualification's control-pre.
//
//    The exclusion arm is not a loophole: `scripts/check-setup-qualification.sh` is a
//    mutation-attribution oracle the manifests invoke DIRECTLY and its own header says
//    it is deliberately outside every tier. Like cell 7, the excuse is checked against
//    the text an operator can read, never against a list only this gate believes in.
//
//    ONE PREMISE, stated because it is invisible from here: the script-path join below
//    ignores MODE FLAGS in a gate argv. The `--attribution-self-test` gate therefore
//    counts as covered by the `check-gate-manifests` arm only because
//    `checkVitestAttribution()` runs UNCONDITIONALLY, before that flag is read
//    (`scripts/check-gate-qualification.ts`). Move that call behind a flag and this
//    cell stays green while saying something false.
// ===========================================================================
{
	const pkg = JSON.parse(readFileSync(join(REPO_DIR, "package.json"), "utf8")) as { scripts: Record<string, string> };
	// The floor is composed (#70): `check:full` names group scripts, and a group script
	// may name further ones. Expand transitively rather than hard-coding the tier list.
	const expand = (name: string, seen: Set<string>): string => {
		if (seen.has(name)) return "";
		seen.add(name);
		const body = pkg.scripts[name] ?? "";
		let out = body;
		for (const ref of body.matchAll(/pnpm run ([\w:.-]+)/g)) out += ` ${expand(ref[1], seen)}`;
		const elapsed = /check-elapsed\.sh\s+[\w:.-]+\s+(.+)$/.exec(body);
		if (elapsed) for (const g of elapsed[1].trim().split(/\s+/)) out += ` ${expand(g, seen)}`;
		return out;
	};
	const floorText = expand("check:full", new Set());
	const floorSubcommands = new Set([...floorText.matchAll(/\.\/run\.sh ([\w:.-]+)/g)].map((m) => m[1]));

	// run.sh case arms, so a gate invoked by SCRIPT PATH can be joined to the floor
	// subcommand that runs that same script.
	const arms = new Map<string, string>();
	{
		let names: string[] = [];
		let body: string[] = [];
		for (const line of readFileSync(join(REPO_DIR, "run.sh"), "utf8").split("\n")) {
			const head = /^ {2}([\w|:.-]+)\)$/.exec(line);
			if (head) {
				names = head[1].split("|");
				body = [];
				continue;
			}
			if (line === "    ;;") {
				for (const n of names) arms.set(n, body.join("\n"));
				names = [];
				continue;
			}
			if (names.length > 0) body.push(line);
		}
	}

	const gates = new Map<string, string[]>();
	for (const rel of globSync("scripts/mutants/*.json", { cwd: REPO_DIR }).sort()) {
		const doc = JSON.parse(readFileSync(join(REPO_DIR, rel), "utf8")) as { mutants: Array<{ gate: string[] }> };
		for (const m of doc.mutants) gates.set(m.gate.join(" "), m.gate);
	}
	assert.ok(gates.size >= 40, `expected the committed mutant gate set, found ${gates.size} distinct gate argvs`);

	// argv → the file that states, in prose an operator reads, why it is outside the floor.
	const DOCUMENTED_OUTSIDE: Record<string, [file: string, sentence: string]> = {
		"bash scripts/check-setup-qualification.sh": [
			"scripts/check-setup-qualification.sh",
			"run.sh subcommand and NOT in any check tier",
		],
	};

	const unreached: string[] = [];
	for (const [key, argv] of gates) {
		if (argv[0] === "bash" && argv[1] === "run.sh") {
			if (!floorSubcommands.has(argv[2])) unreached.push(`${key} — run.sh ${argv[2]} is in no check:full group`);
			continue;
		}
		const scriptPath = argv.find((t) => /^scripts\/.+\.(sh|ts|py)$/.test(t));
		if (scriptPath !== undefined && [...floorSubcommands].some((sub) => (arms.get(sub) ?? "").includes(scriptPath))) {
			continue;
		}
		const excused = DOCUMENTED_OUTSIDE[key];
		if (excused === undefined) {
			unreached.push(`${key} — no check:full subcommand invokes ${scriptPath ?? "(no script path in its argv)"}`);
			continue;
		}
		const [file, sentence] = excused;
		if (!readFileSync(join(REPO_DIR, file), "utf8").includes(sentence)) {
			unreached.push(`${key} claims a documented exclusion, but ${file} no longer says "${sentence}"`);
		}
	}
	assert.ok(
		unreached.length === 0,
		"[QK:MUTANT-GATES-INSIDE-FULL-FLOOR] every gate a committed mutant names must also run inside `pnpm run " +
			"check:full`, or state its exclusion where an operator reads it. A gate reachable ONLY through " +
			"qualification's control-pre makes the 28-minute mutant body the only thing that can notice it going red on " +
			"a clean tree — the one CI class that body has actually caught, and the one the 5.4-minute floor catches for " +
			`free everywhere else. Unreached: ${unreached.join("; ")}`,
	);
}

// ===========================================================================
// 10. A TAG push rebuilds nothing
//
//     Measured over this repo's whole history (#99 B-1): 66 of 66 semver tag-push runs
//     rebuilt a SHA some other run had already built, and no tag run ever reported a
//     fact its branch run did not — the single non-green one failed at the same step as
//     its main run, two seconds later. That is 28% of a release window's runner minutes
//     buying a badge on a ref. The exact-SHA evidence a release quotes is the BRANCH
//     run, which is also the run `entwurf-release` land mode reports.
//
//     So `on.push` must carry a REF FILTER that selects branches. `branches:` alone is
//     what makes a tag push create no run at all; a `tags:` key would put them back.
// ===========================================================================
{
	const ciYml = readFileSync(join(REPO_DIR, ".github/workflows/ci.yml"), "utf8");
	const onAt = ciYml.indexOf("\non:\n");
	const envAt = ciYml.indexOf("\nenv:\n");
	assert.ok(onAt !== -1 && envAt > onAt, "located the workflow `on:` block");
	const onLines = ciYml.slice(onAt, envAt).split("\n");
	const pushAt = onLines.findIndex((l) => /^ {2}push:\s*$/.test(l));
	const nextKeyAt = onLines.findIndex((l, i) => i > pushAt && /^ {2}\S/.test(l));
	const pushBody = onLines
		.slice(pushAt + 1, nextKeyAt === -1 ? undefined : nextKeyAt)
		.filter((l) => l.trim() !== "" && !/^\s*#/.test(l));
	const gaps: string[] = [];
	if (pushAt === -1) gaps.push("the `on:` block has no `push:` trigger");
	if (!pushBody.some((l) => /^ {4}branches(-ignore)?:/.test(l)))
		gaps.push(`the push trigger carries no branch ref filter (body: ${JSON.stringify(pushBody)})`);
	if (pushBody.some((l) => /^ {4}tags(-ignore)?:/.test(l)))
		gaps.push("the push trigger names tags — a tag push would create a second run for a SHA already built");
	assert.ok(
		gaps.length === 0,
		"[QK:CI-TAG-PUSH-NOT-REBUILT] the CI `push` trigger must be filtered to BRANCH refs, so pushing a release tag " +
			"creates no run: 66/66 semver tag runs in this repo's history rebuilt an already-built SHA and none ever " +
			"reported a fact its branch run had not, while costing 28% of a release window's runner minutes. Dropping " +
			`the filter does not add evidence, it duplicates it. Broken: ${gaps.join("; ")}`,
	);
}

// ===========================================================================
// The integrated mux lifecycle is a MUST, and the focused fresh-call LIVE is not
//
// Two LIVE smokes now cover the mux rail and they are NOT interchangeable:
// `smoke-mux-fresh-call-live` drives the composition from SOURCE and is on-demand,
// while `smoke-mux-lifecycle-live` enters through the real MCP surface and follows a
// citizen through resume and recall. A cut that ran only the focused one would be
// green about the axis nobody proved. So the MUST wiring is pinned here, exactly
// once, together with the doc sentence that keeps the two apart for an operator.
// ===========================================================================
{
	const runSh = readFileSync(join(REPO_DIR, "run.sh"), "utf8");
	const gateBody = runSh.slice(runSh.indexOf("release_gate() {"), runSh.indexOf("# 5. Summary"));
	const verify = readFileSync(join(REPO_DIR, "VERIFY.md"), "utf8");
	const mustSteps = gateBody.split("\n").filter((l) => l.includes('"$self" smoke-mux-lifecycle-live'));
	const gaps: string[] = [];
	if (mustSteps.length !== 1)
		gaps.push(`release_gate runs smoke-mux-lifecycle-live ${mustSteps.length}x (need exactly one MUST step)`);
	if (mustSteps.length === 1 && !mustSteps[0]?.includes("run_live_step"))
		gaps.push("the lifecycle step does not go through run_live_step, so its SKIP would not reach the classifier");
	if (!verify.includes("Fresh-call LIVE is on-demand, not part of `release-gate`"))
		gaps.push("VERIFY.md no longer excuses the focused fresh-call LIVE from the aggregate");
	if (!verify.includes("smoke-mux-lifecycle-live"))
		gaps.push("VERIFY.md does not name the integrated lifecycle MUST at all");
	assert.ok(
		gaps.length === 0,
		"[QK:MUX-LIFECYCLE-IS-RELEASE-MUST] the integrated mux lifecycle LIVE must be a release-gate MUST exactly once " +
			"and go through run_live_step (so a missing prerequisite is a SKIP the cut refuses, never a silent pass), " +
			"while the focused fresh-call LIVE stays on-demand and VERIFY keeps the two distinguishable — a cut that " +
			`ran only the source-level smoke would be green about the surface no one entered. Broken: ${gaps.join("; ")}`,
	);
}

// ===========================================================================
// Codex first admission is a MUST; the loaded-thread probe remains on-demand
//
// The old native-push smoke consumes a thread the operator loaded in an attached
// TUI, so the aggregate cannot own its prerequisite. The first-admission smoke
// instead owns all three visible windows in the Pi -> Codex -> Pi chain and takes
// only an explicit app-server PID as seat authority. The new gate must not silently
// pull the old loaded-thread probe into release-gate, and keeping the old exclusion
// must not excuse the new end-to-end acceptance.
// ===========================================================================
{
	const runSh = readFileSync(join(REPO_DIR, "run.sh"), "utf8");
	const gateBody = runSh.slice(runSh.indexOf("release_gate() {"), runSh.indexOf("# 5. Summary"));
	const verify = readFileSync(join(REPO_DIR, "VERIFY.md"), "utf8");
	const admissionSteps = gateBody.split("\n").filter((line) => line.includes('"$self" smoke-codex-fresh-live'));
	const loadedThreadSteps = gateBody
		.split("\n")
		.filter((line) => line.includes('"$self" smoke-codex-native-push-live'));
	const gaps: string[] = [];
	if (admissionSteps.length !== 1) {
		gaps.push(`release_gate runs smoke-codex-fresh-live ${admissionSteps.length}x (need exactly one MUST step)`);
	}
	if (admissionSteps.length === 1 && !admissionSteps[0]?.includes("run_live_step")) {
		gaps.push("smoke-codex-fresh-live does not go through run_live_step, so LIVE=1/SKIP cannot reach --cut");
	}
	if (loadedThreadSteps.length !== 0) {
		gaps.push(`release_gate runs the operator-thread smoke ${loadedThreadSteps.length}x (need zero)`);
	}
	if (!verify.includes("Aggregate release-gate does not own a loaded Codex thread")) {
		gaps.push("VERIFY.md no longer states why smoke-codex-native-push-live remains on-demand");
	}
	if (!runSh.includes("ENTWURF_CODEX_APP_SERVER_PID")) {
		gaps.push("run.sh no longer names the explicit operator-owned app-server PID prerequisite");
	}
	assert.ok(
		gaps.length === 0,
		"[QK:CODEX-FIRST-ADMISSION-IS-RELEASE-MUST] the fresh Codex acceptance must run exactly once through " +
			"run_live_step, while the loaded-thread native-push smoke stays excluded for its documented operator-owned " +
			`prerequisite. Broken: ${gaps.join("; ")}`,
	);
}

// ===========================================================================
// A MUST step's ABSENT operator input is a SKIP; a WRONG one is a FAIL
//
// The step above is a MUST that takes three values only the operator can give.
// `[측정 2026-09-23]` all three were `ok()` assertions, and `ok()` throws, so
// their absence exited as FAIL — while `release_gate()` supplies none of them.
// The step therefore declined as a FAILURE inside every aggregate on every host,
// and 0.25.0's candidate receipt (`MUST PASS=23 FAIL=1`, `cut: BLOCKED (MUST
// FAIL)`) carries a prose classification of that red, and reading it as a floor
// would require a per-cut exception. The release skill says "Do not waive a MUST
// failure without diagnosing and explicitly classifying the failing axis", and
// classifying is what that record does -- but a contract that manufactures the same
// red every cut invites the exception rather than earning a floor. (The cut stayed
// BLOCKED; nothing was approved.)
//
// This cell pins the repaired boundary in BOTH directions, because either half
// alone is a different defect: make absence a FAIL and the exception comes back;
// make a wrong answer a SKIP and a dead pid or a foreign process buys silence.
// It is deliberately separate from the claim above — that one owns WHERE the step
// is wired, this one owns WHAT its outcome means — so one mutant cannot satisfy
// both, and it reads the smoke with comments stripped so a promise in prose
// cannot stand in for the arm that actually executes.
// ===========================================================================
{
	const SMOKE = "scripts/smoke-codex-fresh-live.ts";
	const smokeRaw = readFileSync(join(REPO_DIR, SMOKE), "utf8");
	// Comments are where this exact defect hid for a release: the old skip line
	// NAMED all three env vars while only LIVE=1 could produce a skip.
	const smoke = smokeRaw
		.replace(/\/\*[\s\S]*?\*\//g, "")
		.split("\n")
		.map((line) => line.replace(/(^|\s)\/\/.*$/, ""))
		.join("\n");
	const verify = readFileSync(join(REPO_DIR, "VERIFY.md"), "utf8");
	const skill = readFileSync(join(REPO_DIR, ".claude/skills/entwurf-release/SKILL.md"), "utf8");
	const TRIPLE = ["ENTWURF_CODEX_APP_SERVER_PID", "ENTWURF_CODEX_FRESH_MODEL", "ENTWURF_CODEX_FRESH_PI_MODEL"] as const;
	const broken: string[] = [];

	// (a) Absence must reach `skipLive`, and the GUARD that routes it there is part of
	//     the claim — not just the presence of a skipLive call somewhere nearby. A
	//     dead arm behind a constant-false condition would satisfy "there is a skip"
	//     while every absent input fell through to the assertions below and threw,
	//     which is precisely the pre-repair behaviour. So the emptiness test, the
	//     guard and the arm are pinned as one contiguous shape, and nothing may
	//     assert in between.
	const absenceArm = smoke.match(
		/const absentInputs\s*=\s*OPERATOR_INPUTS\.filter\(([^\n]*?)===\s*""\);\s*if \(absentInputs\.length > 0\) \{\s*skipLive\(([\s\S]{0,1400}?)\n\t\}/,
	);
	if (absenceArm === null) {
		broken.push(
			`${SMOKE}: the absent-operator-input arm is not the contiguous shape ` +
				'`absentInputs = OPERATOR_INPUTS.filter(... === "")` -> `if (absentInputs.length > 0)` -> `skipLive(` — ' +
				"an unset prerequisite would fall through to an assertion and exit as FAIL again",
		);
	} else if (!absenceArm[2]?.includes("absentInputs")) {
		broken.push(`${SMOKE}: the skipLive arm does not report WHICH operator inputs were absent`);
	}
	for (const name of TRIPLE) {
		if (!new RegExp(`\\[\\s*"${name}"`).test(smoke)) {
			broken.push(`${SMOKE}: ${name} is not in the declared operator-input set, so its absence is unclassified`);
		}
	}

	// (c) The reproducible green must be WRITTEN DOWN where a cut is taken from,
	//     or "supply the triple" is folklore. VERIFY owns the acceptance condition;
	//     the release skill owns the command an operator actually types at P5.
	const p5 = skill.slice(skill.indexOf("## P5."), skill.indexOf("## P6."));
	for (const name of TRIPLE) {
		if (!p5.includes(name)) {
			broken.push(`.claude/skills/entwurf-release/SKILL.md P5: the release-gate invocation does not carry ${name}`);
		}
	}
	if (!verify.includes("`release-gate --cut` inherits that triple")) {
		broken.push(
			"VERIFY.md no longer states that the aggregate cut inherits the operator-supplied Codex triple — " +
				"without that sentence a cut host cannot know why the MUST step skipped",
		);
	}

	// (d) The policy half is unchanged: a MUST SKIP still blocks a cut. Asked of the
	//     SHARED shell authority rather than re-implemented here, so this cell cannot
	//     drift from the truth table the protocol owns. Reclassifying an absent
	//     prerequisite as SKIP is only honest while that answer stays NO.
	const cutReleasable = (failc: number, skipc: number, cut: number): boolean =>
		inShell(`if entwurf_release_releasable ${failc} ${skipc} ${cut}; then echo YES; else echo NO; fi`) === "YES";
	if (cutReleasable(0, 1, 1) !== false) {
		broken.push("a MUST SKIP no longer blocks --cut, so classifying an absent prerequisite as SKIP would hide it");
	}
	if (cutReleasable(0, 1, 0) !== true) {
		broken.push("a MUST SKIP now blocks the unattended diagnostic run, which was never the contract");
	}

	assert.ok(
		broken.length === 0,
		"[QK:CODEX-OPERATOR-PREREQ-ABSENT-SKIPS] a MUST step that takes operator-supplied inputs must DECLINE when they " +
			"are absent — protocol SKIP naming each missing one — while `--cut` keeps refusing that SKIP and the cut " +
			"invocation that supplies the triple is written in VERIFY and the release skill. Absence classified as FAIL " +
			"is what made this step red inside every cut and would require a per-cut exception. " +
			`Broken: ${broken.join("; ")}`,
	);

	// The MIRROR claim, and its own token: a value the operator DID supply stays a
	// FAIL when it is wrong. Kept apart from the arm above because softening this
	// direction is the opposite defect and must not be killable by the same mutant —
	// a dead pid, a foreign process or an app-server in the gate's own session would
	// otherwise buy silence instead of a red.
	const softened: string[] = [];
	if (!/ok\(\s*\n?\s*"ENTWURF_CODEX_APP_SERVER_PID explicitly names/.test(smoke)) {
		softened.push(
			`${SMOKE}: the pid grammar is no longer an ok() assertion — a malformed operator answer must FAIL, not decline`,
		);
	}
	// A model env asserted non-empty would put absence back behind a throw, making
	// the decline arm above dead code. One direction repaired at the cost of the
	// other is not the boundary.
	if (/ok\([^)]*ENTWURF_CODEX_FRESH_(?:PI_)?MODEL[^)]*length\s*>\s*0/.test(smoke)) {
		softened.push(`${SMOKE}: a model env is still asserted non-empty, which re-classifies its absence as FAIL`);
	}
	assert.ok(
		softened.length === 0,
		"[QK:CODEX-OPERATOR-PREREQ-WRONG-FAILS] the same step must still FAIL on an operator input that is PRESENT and " +
			"wrong. Declining there would let a dead pid or a non-Codex process pass as a missing prerequisite, and a " +
			`cut would read silence as acceptance. Broken: ${softened.join("; ")}`,
	);

	// A THIRD claim, because this one is about a different subject: not what the smoke
	// does with an input, but WHERE the release operator's input comes from.
	//
	// `[측정 2026-09-23]` the first cut of the P5 instructions above derived the pid with
	// `pgrep -f 'codex.*app-server' | head -1`. That is exactly the inference the step
	// refuses, written into the page an operator follows — and worse than a stale
	// sentence, because a host can hold more than one app-server and `head -1` picks an
	// arbitrary one, which the smoke would then dutifully verify as "the operator's
	// answer". A no-inference rule that the operating instructions violate is enforced
	// nowhere. So provenance is pinned in the skill itself: each value is STATED, the
	// three `:` guards refuse an unset or empty one before any LIVE cost, and no process
	// search or command substitution may manufacture them.
	const provenance: string[] = [];
	const SKILL_REL = ".claude/skills/entwurf-release/SKILL.md";
	for (const forbidden of ["pgrep", "pidof", "ps -", "$(pgrep"]) {
		if (p5.includes(forbidden)) {
			provenance.push(
				`${SKILL_REL} P5: builds an operator input with \`${forbidden}\` — the pid is stated, never searched for`,
			);
		}
	}
	for (const name of ["CODEX_APP_SERVER_PID", "CODEX_FRESH_MODEL", "CODEX_FRESH_PI_MODEL"]) {
		// `: "${VAR:?...}"` — an explicit required-parameter guard. Anything weaker
		// (a default via `:-`, or no guard) lets a forgotten export reach a LIVE run.
		if (!new RegExp(`: "\\$\\{${name}:\\?[^"]+}"`).test(p5)) {
			provenance.push(`${SKILL_REL} P5: ${name} has no \`: "\${${name}:?…}"\` required-value guard`);
		}
		if (new RegExp(`${name}=\\$\\(`).test(p5)) {
			provenance.push(`${SKILL_REL} P5: ${name} is assigned from a command substitution rather than stated`);
		}
	}
	assert.ok(
		provenance.length === 0,
		"[QK:CODEX-OPERATOR-PREREQ-STATED-NOT-SEARCHED] the release instructions must make the operator STATE each Codex " +
			"input and guard it with an explicit required-value check, never derive one by process search or command " +
			"substitution. A page that infers the app-server pid teaches the very inference the gate refuses, and picks an " +
			`arbitrary process when a host runs several. Broken: ${provenance.join("; ")}`,
	);
}

// ===========================================================================
// The operator's CONFIGURED bridge invocation is proven BEFORE the cost-bearing LIVE tier
//
// `check-bridge` boots the launcher this checkout SHIPS. It cannot speak for the string
// pi's provider actually execs, and only that second one reaches a live ACP session.
// 2026-08-19 measured the difference at full price: a relocated `~/.local/bin/entwurf-bridge`
// symlink into a pnpm cmd-shim (basedir derived from $0, so not relocatable) exited 127, the
// bundled bridge never booted, and the model had no `mcp__entwurf-bridge__*` tool — while
// `command -v` answered yes throughout. #81 had already built the leaf that settles this in
// under a second, and doctor-pi-provider consumes it; it was simply never a step, so the
// verdict surfaced sixteen LIVE steps later at smoke-acp-bundled-mcp-live.
// Pinned here because the step is CHEAP and therefore easy to drop again "to speed the gate up":
// its whole value is the position, so both the position and the classifier arm are asserted.
// run_step, not run_live_step — this doctor is not LIVE-gated and never emits 97, so a SKIP arm
// would describe a prerequisite it cannot have.
// ===========================================================================
{
	const runSh = readFileSync(join(REPO_DIR, "run.sh"), "utf8");
	const gateBody = runSh.slice(runSh.indexOf("release_gate() {"), runSh.indexOf("# 5. Summary"));
	const verify = readFileSync(join(REPO_DIR, "VERIFY.md"), "utf8");
	const STEP =
		'run_step "doctor-pi-provider (#81: the operator\'s CONFIGURED bridge invocation actually boots)" gate bash "$self" doctor-pi-provider';
	const doctorSteps = gateBody.split("\n").filter((l) => l.includes('"$self" doctor-pi-provider'));
	const gaps: string[] = [];
	if (doctorSteps.length !== 1)
		gaps.push(`release_gate runs doctor-pi-provider ${doctorSteps.length}x (need exactly one MUST step)`);
	if (doctorSteps.length === 1 && doctorSteps[0]?.trim() !== STEP)
		gaps.push(`the doctor step is not the exact pinned invocation (got: ${doctorSteps[0]?.trim()})`);
	if (doctorSteps.length === 1 && doctorSteps[0]?.includes("run_live_step"))
		gaps.push("the doctor step goes through run_live_step, inventing a SKIP arm for a doctor that never emits 97");
	// Position is the point: a cheap probe scheduled after the expensive tier proves nothing new.
	const doctorAt = gateBody.indexOf('"$self" doctor-pi-provider');
	// Anchored on the step KEYWORD, not the bare name: prose above this step already discusses
	// smoke-acp-bundled-mcp-live by name, and a needle that a comment can satisfy would drag the
	// boundary backwards and fail an ordering that is actually fine.
	const firstLiveAt = gateBody.indexOf('run_live_step "smoke-acp-');
	if (doctorAt >= 0 && firstLiveAt >= 0 && doctorAt > firstLiveAt)
		gaps.push("the doctor step runs AFTER the ACP LIVE tier — the fail-fast position that motivates it is gone");
	if (!verify.includes("doctor-pi-provider"))
		gaps.push("VERIFY.md does not name doctor-pi-provider in the MUST tier at all");
	if (!verify.includes("the invocation the operator's pi provider actually EXECS"))
		gaps.push("VERIFY.md no longer states WHICH invocation this step proves (ships vs execs)");
	assert.ok(
		gaps.length === 0,
		"[QK:PI-DOCTOR-IS-RELEASE-MUST] the operator's configured bridge invocation must be booted as a release-gate " +
			"MUST exactly once, through run_step (no SKIP arm — this doctor never emits 97), positioned BEFORE the ACP " +
			"LIVE tier, with VERIFY naming it and keeping 'what this checkout ships' apart from 'what the provider execs' " +
			"— drop any of those and the #81 127-class defect goes back to costing sixteen LIVE steps to discover. " +
			`Broken: ${gaps.join("; ")}`,
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
		"check-gate-qualification stays reachable only as the schedule/dispatch drift diagnostic (absent from the " +
		"default chain, from release_gate, from every push and from the release skill; exactly once in CI) over the " +
		"FULL floor, which runs before it, while the exact-SHA release oracle, driven through a fake gh, asks only for " +
		"the push run, refuses every required job that did not conclude success, and passes without ever naming the " +
		"qualification body; and " +
		"every gate a committed mutant names is itself inside check:full or states its exclusion in prose an operator " +
		"reads; and the CI push trigger is filtered to branch refs, so a release tag creates no duplicate run; and " +
		"Pi -> visible Codex -> visible Pi first-admission callback/addressed/outbound acceptance is a release MUST " +
		"while the operator-loaded-thread Codex native-push probe remains excluded; and the operator's CONFIGURED " +
		"bridge invocation is booted exactly once " +
		"through run_step, before the ACP LIVE tier",
);
