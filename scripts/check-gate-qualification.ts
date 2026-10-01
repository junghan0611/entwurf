/**
 * check-gate-qualification — kill-proof qualification of the shipped gates.
 *
 * TWO ENTRYPOINTS, ONE FILE. `--manifests-only` (shipped as `run.sh
 * check-gate-manifests`) stops after the HEAD — the runner self-test plus the real
 * manifests' validation and lane inventory — having executed ZERO committed mutants
 * from `scripts/mutants/` and having made NO snapshot of this repo. (The self-test
 * does execute its own SYNTHETIC fixture mutants, in fixture repos under tmp.) The default
 * entrypoint is unchanged: it runs the same head first and then the body. The head
 * is separable because of what it has actually caught: across 549 CI runs the
 * qualification step went red five times, and three of those died in the head in
 * 4-5 seconds, before a single mutant gate was invoked (#99 B-3). The head costs
 * ~20s (measured 2026-09-29 on oracle, after the #124 group-receipt and ledger
 * fixture cells; ~12s before them), so it belongs in the deterministic floor every push already pays for; the
 * body's contract — which mutants run, how they are classified, what it prints —
 * is untouched by the split.
 *
 * Two phases, in a fixed order:
 *
 *   1. RUNNER SELF-TEST. The runner is itself a SUT: a qualification harness that
 *      rounds a wrong-reason red up to KILLED, or misses a zero-match, is a test bug
 *      of exactly the class it exists to close. So before any real manifest runs,
 *      the pure classifier is exhausted as a truth table and the whole pipeline is
 *      driven over a synthetic fixture repo through every negative: malformed
 *      manifest, duplicate claim, path escape, untracked subject, zero-match,
 *      multi-match, SURVIVED, WRONG-REASON, HANG (with a real grandchild kill on
 *      the process group), CONTROL-PRE red (the fake-KILLED hole), a state-poisoning
 *      gate (CONTROL-POST red), and a stray write (tree-manifest impurity).
 *
 *   2. REAL MANIFESTS. `scripts/mutants/*.json` are validated (exact schema, global
 *      claim uniqueness, subject tracked in the ORIGIN index, claim token exactly
 *      once in its gate source), then run in an isolated snapshot repo under the
 *      control-mutant-restore-control state machine. The real checkout is never
 *      written; its HEAD + work-surface content hash are asserted identical
 *      before/after (P1-5 — porcelain text alone misses byte changes in already-
 *      modified files).
 *
 * No tiers: the committed mutant set is one tier — every run executes every mutant,
 * one command, one truth, no advisory lane. Runtime is recorded when this runs on a
 * frozen candidate; if the set ever outgrows its budget, re-open the fast/full split
 * from the design record instead of silently skipping mutants.
 *
 * Evidence: claim IDs + killed mutant IDs, never assertion counts.
 */

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import {
	classifyMutantRun,
	countOccurrences,
	createRepoSnapshot,
	ManifestError,
	type MutantManifest,
	type MutantSpec,
	makeOriginChecks,
	originHead,
	originWorkSurfaceSha,
	qualifyMutants,
	readVitestFailedTitles,
	reportPassed,
	runGateBounded,
	signatureAttributedToFailure,
	signatureOnFailureLine,
	sweepStaleSnapshots,
	validateManifest,
	validateManifestSet,
} from "./lib/mutation-qualify.ts";
import { ACCEPTANCE_SCHEMA, checkAcceptanceRecord, RECORD_CONSISTENT } from "./lib/qualification-acceptance.ts";
import {
	type ApiArtifact,
	type ArtifactInput,
	admitArtifact,
	artifactName,
	selectArtifact,
} from "./lib/qualification-artifact.ts";
import {
	allGroupArgv,
	checkCollection,
	checkCollectionData,
	checkRequestedGroups,
	collectGroups,
	mapReader,
} from "./lib/qualification-collection.ts";
import {
	ancestorRunEvidence,
	COMPOSITE_JOB,
	finalRunEvidence,
	type GhApi,
	REQUIRED_JOBS,
} from "./lib/qualification-gh.ts";
import {
	composeLedger,
	contentCandidate,
	currentCandidate,
	loadReceipt,
	parseExpectedList,
} from "./lib/qualification-ledger.ts";
import {
	checkDeclared,
	decisionDigest,
	type GitRunner,
	parseOracleArgs,
	runOracle,
	selfCheck,
} from "./lib/qualification-oracle-core.ts";
import {
	CORE_FILES,
	canonicalJson,
	checkReceiptPath,
	fileFingerprints,
	parseQualificationArgs,
	runGroupReceipt,
	sealReceipt,
	sha256,
	writeReceiptExclusive,
} from "./lib/qualification-receipt.ts";
import { type CiRun, composeRelease, type ReleaseInput } from "./lib/qualification-release.ts";
import { reclaimOnExit } from "./lib/reclaim-on-exit.ts";
import { launch } from "./qualification-oracle.ts";

const REPO_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MUTANTS_DIR = path.join(REPO_DIR, "scripts", "mutants");

/**
 * Refused before anything runs: an unknown/repeated flag, or a malformed `--group`
 * (#124 P1 — one exact-argv group, PARTIAL receipt; see qualification-receipt.ts).
 */
const ARGS = parseQualificationArgs(process.argv.slice(2));
if (ARGS.mode === "group") checkReceiptPath(ARGS.receiptPath, REPO_DIR);
if (ARGS.mode === "compose" && ARGS.ledgerOut !== undefined) checkReceiptPath(ARGS.ledgerOut, REPO_DIR);
if (ARGS.mode === "groups") checkReceiptPath(ARGS.collectDir, REPO_DIR);

/** Head-only mode: validate, count, and stop — no mutant is executed, no repo snapshot is made. */
const MANIFESTS_ONLY = ARGS.mode === "manifests-only";
const SURFACE = MANIFESTS_ONLY ? "check-gate-manifests" : "gate-qualification";

let passed = 0;
function ok(label: string, cond: boolean): void {
	assert.ok(cond, label);
	console.log(`  ok    ${label}`);
	passed++;
}

function throws(label: string, fn: () => void, naming: string): void {
	try {
		fn();
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		assert.ok(msg.includes(naming), `${label} — error should name \`${naming}\`, got: ${msg}`);
		console.log(`  ok    ${label}`);
		passed++;
		return;
	}
	assert.fail(`${label} — expected a loud refusal, got silence`);
}

/**
 * Vitest attribution, proved on the MEASURED false-positive shape (issue #62 review).
 *
 * Vitest prints a code frame around the failing assertion, and that frame quotes the
 * neighbouring source lines — including an adjacent PASSING test's `it("[QK:…]" …)`
 * title. Measured verbatim on vitest 4.1.9:
 *
 *     ×  [QK:B] fails on its first body line
 *     4|  it("[QK:A] one-liner that passes", () => expect(1).toBe(1));
 *     5|  it("[QK:B] fails on its first body line", () => {
 *
 * The legacy `ok`-line oracle answers TRUE for [QK:A] there — a mutant claiming A
 * would be certified KILLED by a red that belongs to B. The structured oracle reads
 * only the failed-test title set, so it must answer FALSE for A and TRUE for B.
 *
 * The cell is discriminating in BOTH directions: it asserts that the legacy scanner
 * really does say TRUE on this input, so the negative is not vacuous.
 */
function checkVitestAttribution(): void {
	// Declared ONCE as a literal: the manifest's exact-once signature rule counts
	// occurrences of this token in signatureSource, so every other use goes through
	// the binding.
	const claimed = "[QK:VITEST-FAILED-TITLE-ATTRIBUTION]";
	const actualFailure = "[QK:ADJACENT-ACTUAL-FAILURE]";
	const codeFrame = [
		"__ENTWURF_VITEST_JSON__",
		` ×  ${actualFailure} fails on its first body line`,
		`      4|  it("${claimed} one-liner that passes", () => expect(1).toBe(1));`,
		`      5|  it("${actualFailure} fails on its first body line", () => {`,
	].join("\n");
	const report = JSON.stringify({
		testResults: [
			{
				assertionResults: [
					{ status: "passed", fullName: `frame probe ${claimed} one-liner that passes` },
					{ status: "failed", fullName: `frame probe ${actualFailure} fails on its first body line` },
				],
			},
		],
	});

	const dir = reclaimOnExit(fs.mkdtempSync(path.join(os.tmpdir(), "entwurf-attribution-selftest-")));
	const reportPath = path.join(dir, "vitest-report.json");
	try {
		fs.writeFileSync(reportPath, report);
		const titles = readVitestFailedTitles(codeFrame, reportPath);

		ok(
			"attribution self-test is not vacuous — the legacy failure-line oracle really does certify the adjacent PASSING claim on this measured code frame",
			signatureOnFailureLine(codeFrame, claimed),
		);
		ok(
			`${claimed} Vitest attribution reads only structured failed-test titles — an adjacent passing QK quoted by the failing code frame cannot certify the mutant`,
			!signatureAttributedToFailure(codeFrame, claimed, titles) &&
				signatureAttributedToFailure(codeFrame, actualFailure, titles),
		);
		ok(
			"a structured lane whose report is missing is UNREADABLE, never a silent fallback to token scanning",
			readVitestFailedTitles(codeFrame, path.join(dir, "absent.json")) === "unreadable" &&
				!signatureAttributedToFailure(codeFrame, actualFailure, "unreadable"),
		);
		ok(
			"a gate that printed no marker keeps the legacy failure-line oracle unchanged",
			readVitestFailedTitles("  not ok 1 boom [QK:LEGACY]", reportPath) === "legacy" &&
				signatureAttributedToFailure("  not ok 1 boom [QK:LEGACY]", "[QK:LEGACY]", "legacy"),
		);
	} finally {
		fs.rmSync(dir, { recursive: true, force: true });
	}
}

checkVitestAttribution();
if (ARGS.mode === "attribution-self-test") {
	console.log(`[gate-qualification] attribution self-test: ${passed} checks passed`);
	process.exit(0);
}

// ═══ Phase 0c — every qualification source is part of C0 (#124) ════════════
//
// A qualification source whose bytes can change without moving the receipt core seal,
// the c-core decision or the CI core witness is an unseen judge. CORE_FILES is a
// hand-written list, so membership is checked against the work surface, first.
{
	const listed = spawnSync("git", ["-C", REPO_DIR, "ls-files", "-z", "--cached", "--others", "--exclude-standard"], {
		encoding: "utf8",
	});
	assert.equal(listed.status, 0, "git ls-files failed");
	const sources = listed.stdout
		.split("\0")
		.filter((f) => /^scripts\/(lib\/)?qualification-[^/]+\.ts$/.test(f))
		.sort();
	const missing = sources.filter((f) => !CORE_FILES.includes(f));
	ok(
		`[QK:CORE-FILES-COVER-QUALIFICATION] C0: every qualification source the regex finds on the work surface is in CORE_FILES (${sources.length} found${missing.length > 0 ? `; missing ${missing.join(", ")}` : ""})`,
		sources.includes("scripts/lib/qualification-acceptance.ts") &&
			sources.includes("scripts/qualification-oracle.ts") &&
			missing.length === 0,
	);
}

// ═══ Phase 1a — the pure classifier, exhausted as a truth table ═════════════

{
	const base: import("./lib/mutation-qualify.ts").MutantRunFacts = {
		controlPreOk: true,
		matchCount: 1,
		timedOut: false,
		exitCode: 1,
		signatureOnFailureLine: true,
		restoredOk: true,
	};
	const rows: [string, Partial<typeof base>, string][] = [
		["nonzero + signature on a failure line", {}, "KILLED"],
		["control-pre red outranks everything", { controlPreOk: false, exitCode: 0 }, "CONTROL-RED"],
		["zero-match is stale production drift, never a kill", { matchCount: 0 }, "MUTANT-STALE"],
		["multi-match refuses before writing", { matchCount: 2 }, "MULTI-MATCH"],
		["failed restore outranks the run outcome (a dirty kill is not a kill)", { restoredOk: false }, "IMPURE"],
		["timeout is HANG, its own class", { timedOut: true, exitCode: null }, "HANG"],
		["exit 0 with the defect planted is SURVIVED", { exitCode: 0, signatureOnFailureLine: false }, "SURVIVED"],
		[
			"nonzero WITHOUT the claimed signature is WRONG-REASON, never rounded up",
			{ signatureOnFailureLine: false },
			"WRONG-REASON",
		],
		[
			"a SIGNAL CRASH (exit null outside our timeout) is WRONG-REASON even with the token present — not a bounded kill",
			{ exitCode: null },
			"WRONG-REASON",
		],
	];
	for (const [why, patch, want] of rows) {
		ok(`classifier: ${why} → ${want}`, classifyMutantRun({ ...base, ...patch }) === want);
	}
	ok(
		"signature: a token on an `ok` line does NOT count (a later-assertion red must not self-certify)",
		signatureOnFailureLine("  ok    something [QK:X] fine\nFAIL: other reason", "[QK:X]") === false,
	);
	ok(
		"signature: a token on a FAIL line counts",
		signatureOnFailureLine("  ok    unrelated\nFAIL: broken [QK:X] here", "[QK:X]") === true,
	);
	ok(
		"signature: an assertion-error line counts (TS gates print the label via AssertionError)",
		signatureOnFailureLine("AssertionError [ERR_ASSERTION]: label [QK:X]", "[QK:X]") === true,
	);

	// Exhaustive truth table (#57 runner qualification): EVERY fact combination — 2
	// control × 3 match classes × 2 timeout × 3 exit classes × 2 signature × 2 restore
	// = 144 rows. The named rows above document each verdict; this loop closes the rest
	// of the space. Two independent assertions per row: the precedence oracle (restated
	// here as full per-verdict conditions), and — standalone, because it is the verdict
	// the whole gate exists to guard — KILLED iff its full 7-way conjunction, so no
	// dropped guard or reordering can round any other row up to a kill.
	{
		let rows = 0;
		for (const controlPreOk of [true, false]) {
			for (const matchCount of [0, 1, 2]) {
				for (const timedOut of [false, true]) {
					for (const exitCode of [null, 0, 1]) {
						for (const sig of [true, false]) {
							for (const restoredOk of [true, false]) {
								const facts = {
									controlPreOk,
									matchCount,
									timedOut,
									exitCode,
									signatureOnFailureLine: sig,
									restoredOk,
								};
								const got = classifyMutantRun(facts);
								const killedIff =
									controlPreOk &&
									matchCount === 1 &&
									restoredOk &&
									!timedOut &&
									exitCode !== null &&
									exitCode !== 0 &&
									sig;
								assert.equal(
									got === "KILLED",
									killedIff,
									`classifier truth table: KILLED must hold iff its full conjunction — row ${JSON.stringify(facts)} → ${got}`,
								);
								const expected = !controlPreOk
									? "CONTROL-RED"
									: matchCount === 0
										? "MUTANT-STALE"
										: matchCount > 1
											? "MULTI-MATCH"
											: !restoredOk
												? "IMPURE"
												: timedOut
													? "HANG"
													: exitCode === null
														? "WRONG-REASON"
														: exitCode === 0
															? "SURVIVED"
															: sig
																? "KILLED"
																: "WRONG-REASON";
								assert.equal(
									got,
									expected,
									`classifier truth table: row ${JSON.stringify(facts)} → ${got}, oracle says ${expected}`,
								);
								rows++;
							}
						}
					}
				}
			}
		}
		ok(
			"classifier: exhaustive truth table — all 144 fact rows match the oracle, KILLED iff its conjunction",
			rows === 144,
		);
	}
}

// ═══ Phase 1b — manifest validation negatives (before any snapshot work) ════

{
	const good = {
		schemaVersion: 1,
		lane: "test",
		mutants: [
			{
				claim: "SELFTEST-KILL",
				title: "t",
				subject: "subject.txt",
				find: ["original-line"],
				replace: ["defect-line"],
				gate: ["bash", "gates/kill.sh"],
				timeoutSeconds: 10,
				signature: "[QK:SELFTEST-KILL]",
				signatureSource: "gates/kill.sh",
			},
		],
	};
	ok("manifest: a well-formed manifest validates", validateManifest(good, "good").mutants.length === 1);
	throws(
		"manifest: an unknown key is refused loudly",
		() => validateManifest({ ...good, extra: 1 }, "m"),
		"unknown key",
	);
	throws(
		"manifest: a missing field is refused loudly",
		() => validateManifest({ schemaVersion: 1, lane: "x" }, "m"),
		"missing key",
	);
	throws(
		"manifest: a wrong schemaVersion is refused",
		() => validateManifest({ ...good, schemaVersion: 2 }, "m"),
		"schemaVersion",
	);
	const mutate = (patch: Record<string, unknown>): unknown => ({
		...good,
		mutants: [{ ...good.mutants[0], ...patch }],
	});
	throws(
		"manifest: an absolute subject path is refused",
		() => validateManifest(mutate({ subject: "/etc/passwd" }), "m"),
		"repo-relative",
	);
	throws(
		"manifest: a `..` subject escape is refused",
		() => validateManifest(mutate({ subject: "../outside.txt" }), "m"),
		"repo-relative",
	);
	throws(
		"manifest: a node_modules subject is refused (shared dependency symlink)",
		() => validateManifest(mutate({ subject: "node_modules/x.js" }), "m"),
		"node_modules",
	);
	throws(
		"manifest: replace identical to find is refused",
		() => validateManifest(mutate({ replace: ["original-line"] }), "m"),
		"differ",
	);
	throws(
		"manifest: a signature that is not [QK:<claim>] is refused",
		() => validateManifest(mutate({ signature: "[QK:OTHER]" }), "m"),
		"signature must be exactly",
	);
	throws(
		"manifest: a wrong-typed timeout is refused",
		() => validateManifest(mutate({ timeoutSeconds: "10" }), "m"),
		"timeoutSeconds",
	);
	throws(
		"manifest: an out-of-range timeout is refused",
		() => validateManifest(mutate({ timeoutSeconds: 0 }), "m"),
		"timeoutSeconds",
	);
	throws(
		"manifest: a shell-string gate is refused (argv array only)",
		() => validateManifest(mutate({ gate: "bash gates/kill.sh" }), "m"),
		"non-empty array",
	);

	const man = validateManifest(good, "a") as MutantManifest;
	const dupSet = [man, validateManifest({ ...good, lane: "other" }, "b")];
	const permissiveOrigin = {
		subjectTracked: () => true,
		regularContainedFile: () => true,
		onWorkSurface: () => true,
		tokenCount: () => 1,
	};
	throws(
		"manifest set: a duplicate claim across manifests is refused",
		() => validateManifestSet(dupSet, permissiveOrigin),
		"duplicate claim",
	);
	throws(
		"manifest set: a subject NOT tracked in the origin index is refused",
		() => validateManifestSet([man], { ...permissiveOrigin, subjectTracked: () => false }),
		"not tracked",
	);
	throws(
		"manifest set: a claim token absent from its gate source is refused",
		() => validateManifestSet([man], { ...permissiveOrigin, tokenCount: () => 0 }),
		"occurs 0",
	);
	throws(
		"manifest set: a claim token duplicated in its gate source is refused",
		() => validateManifestSet([man], { ...permissiveOrigin, tokenCount: () => 2 }),
		"occurs 2",
	);
	// P0-1: tracked is not enough — a tracked SYMLINK subject would let the snapshot's
	// read/write follow it OUT of the sandbox. Both paths must be lstat-regular.
	throws(
		"manifest set: a subject that is not a regular non-symlink file is refused (P0-1)",
		() => validateManifestSet([man], { ...permissiveOrigin, regularContainedFile: (f: string) => f !== "subject.txt" }),
		"symlink-escape guard",
	);
	throws(
		"manifest set: a signatureSource off the origin work surface is refused",
		() => validateManifestSet([man], { ...permissiveOrigin, onWorkSurface: () => false }),
		"not on the origin work surface",
	);
	throws(
		"manifest set: a symlink signatureSource is refused",
		() =>
			validateManifestSet([man], { ...permissiveOrigin, regularContainedFile: (f: string) => f !== "gates/kill.sh" }),
		"signatureSource gates/kill.sh is not a regular",
	);

	// A declared build output (#125): optional, exact keys, a normalized repo-relative
	// directory outside node_modules/.git, and one declaration per gate group.
	const build = { argv: ["bash", "build.sh"], output: "out" };
	ok(
		"manifest: a declared build validates and rides the spec",
		JSON.stringify(validateManifest(mutate({ build }), "m").mutants[0].build) === JSON.stringify(build),
	);
	ok("manifest: a spec without a build carries no build key", !("build" in man.mutants[0]));
	throws(
		"manifest: an unknown build key is refused",
		() => validateManifest(mutate({ build: { ...build, env: {} } }), "m"),
		"unknown key",
	);
	throws(
		"manifest: a shell-string build is refused (argv array only)",
		() => validateManifest(mutate({ build: { ...build, argv: "bash build.sh" } }), "m"),
		"non-empty array",
	);
	for (const output of ["../out", "/tmp/out", "out/../x", "./out", "out/", "node_modules/x", ".git/x"]) {
		throws(
			`manifest: a build output ${JSON.stringify(output)} is refused`,
			() => validateManifest(mutate({ build: { ...build, output } }), "m"),
			"output",
		);
	}
	const withBuild = validateManifest(
		{
			...good,
			lane: "built",
			mutants: [{ ...good.mutants[0], claim: "SELFTEST-BUILT", signature: "[QK:SELFTEST-BUILT]", build }],
		},
		"c",
	);
	throws(
		"[QK:QUALIFY-BUILD-GROUP-CONSISTENT] manifest set: one gate whose mutants declare different builds (here: one none) is refused — the same gate would be handed different inputs by run order",
		() => validateManifestSet([man, withBuild], permissiveOrigin),
		"mixes build declarations",
	);
}

// ═══ Phase 1c — the pipeline over a synthetic fixture repo ══════════════════

function buildFixtureOrigin(): { dir: string; externalTarget: string } {
	const dir = reclaimOnExit(fs.mkdtempSync(path.join(os.tmpdir(), "entwurf-qualify-fixture-")));
	// A file OUTSIDE the fixture repo, reachable only through a tracked symlink — the
	// P0-1 escape shape: mutating `linked.txt` would write THIS file.
	const externalDir = reclaimOnExit(fs.mkdtempSync(path.join(os.tmpdir(), "entwurf-qualify-external-")));
	const externalTarget = path.join(externalDir, "external-target.txt");
	fs.writeFileSync(externalTarget, "original-line outside the sandbox\n");
	const write = (rel: string, body: string, mode = 0o644): void => {
		const p = path.join(dir, rel);
		fs.mkdirSync(path.dirname(p), { recursive: true });
		fs.writeFileSync(p, body);
		fs.chmodSync(p, mode);
	};
	write("subject.txt", "alpha\noriginal-line\nomega\n");
	write("double.txt", "dup-line\ndup-line\n");
	// Each fixture gate reads the subject and goes red IFF the planted defect is present.
	write(
		"gates/kill.sh",
		'#!/usr/bin/env bash\nif grep -q defect-line subject.txt; then echo "FAIL: planted defect detected [QK:SELFTEST-KILL]" >&2; exit 1; fi\nexit 0\n',
		0o755,
	);
	write("gates/survive.sh", "#!/usr/bin/env bash\nexit 0\n", 0o755);
	write(
		"gates/wrong.sh",
		'#!/usr/bin/env bash\nif grep -q defect-line subject.txt; then echo "FAIL: some other assertion tripped [QK:SELFTEST-OTHER]" >&2; exit 1; fi\nexit 0\n',
		0o755,
	);
	write(
		"gates/hang.sh",
		'#!/usr/bin/env bash\nif grep -q defect-line subject.txt; then sleep 300 & echo $! > "$HOME/grandchild.pid"; sleep 300; fi\nexit 0\n',
		0o755,
	);
	write("gates/red.sh", '#!/usr/bin/env bash\necho "FAIL: baseline is red [QK:SELFTEST-PRERED]" >&2\nexit 1\n', 0o755);
	write(
		"gates/stray.sh",
		'#!/usr/bin/env bash\nif grep -q defect-line subject.txt; then echo stray > stray-file.txt; echo "FAIL: planted defect detected [QK:SELFTEST-STRAY]" >&2; exit 1; fi\nexit 0\n',
		0o755,
	);
	write(
		"gates/poison.sh",
		'#!/usr/bin/env bash\nif [ -f poison.marker ]; then echo "FAIL: poisoned state [QK:SELFTEST-POISON]" >&2; exit 1; fi\nif grep -q defect-line subject.txt; then touch poison.marker; echo "FAIL: planted defect detected [QK:SELFTEST-POISON]" >&2; exit 1; fi\nexit 0\n',
		0o755,
	);
	// Red IFF the literal `$&` replacement text landed byte-for-byte: an interpreting
	// String.replace would write the matched line back instead, this grep would miss,
	// and the mutant would SURVIVE — so KILLED proves the replacement stayed literal.
	write(
		"gates/dollar.sh",
		"#!/usr/bin/env bash\nif grep -qF 'dollar-$&-defect' subject.txt; then echo \"FAIL: literal replacement landed [QK:SELFTEST-DOLLAR]\" >&2; exit 1; fi\nexit 0\n",
		0o755,
	);
	write("untracked.txt", "present on disk but never git-added\n");
	fs.symlinkSync(externalTarget, path.join(dir, "linked.txt"));
	const git = (...args: string[]): void => {
		const r = spawnSync("git", ["-C", dir, ...args], {
			stdio: "ignore",
			env: {
				...process.env,
				GIT_CONFIG_GLOBAL: "/dev/null",
				GIT_CONFIG_SYSTEM: "/dev/null",
				GIT_AUTHOR_NAME: "fx",
				GIT_AUTHOR_EMAIL: "fx@localhost",
				GIT_COMMITTER_NAME: "fx",
				GIT_COMMITTER_EMAIL: "fx@localhost",
			},
		});
		assert.equal(r.status, 0, `fixture git ${args.join(" ")} failed`);
	};
	git("init", "-q");
	git("add", "subject.txt", "double.txt", "gates", "linked.txt");
	git("-c", "commit.gpgsign=false", "commit", "-q", "-m", "fixture");
	return { dir, externalTarget };
}

function fixtureSpec(patch: Partial<MutantSpec>): MutantSpec {
	return {
		claim: "SELFTEST-KILL",
		title: "fixture",
		subject: "subject.txt",
		find: ["original-line"],
		replace: ["defect-line"],
		gate: ["bash", "gates/kill.sh"],
		timeoutSeconds: 30,
		signature: "[QK:SELFTEST-KILL]",
		signatureSource: "gates/kill.sh",
		...patch,
	};
}

const quiet = (): void => {};

{
	const { dir: fixtureOrigin, externalTarget } = buildFixtureOrigin();
	try {
		const checks = makeOriginChecks(fixtureOrigin);
		ok("origin checks: a tracked subject is recognized", checks.subjectTracked("subject.txt") === true);
		ok(
			"origin checks: a file present on disk but NOT in the index is refused (hardening #3)",
			checks.subjectTracked("untracked.txt") === false,
		);
		ok(
			"origin checks: token counting reads the origin bytes",
			checks.tokenCount("gates/kill.sh", "[QK:SELFTEST-KILL]") === 1,
		);
		// P0-1 against a REAL tracked symlink (not an injected fake): the lstat check
		// must refuse it even though `git ls-files --error-unmatch` calls it tracked.
		ok(
			"origin checks: a TRACKED SYMLINK is refused by the regular-file check (real lstat)",
			checks.subjectTracked("linked.txt") === true && checks.regularContainedFile("linked.txt") === false,
		);
		ok(
			"origin checks: a regular tracked file passes the regular-file check",
			checks.regularContainedFile("subject.txt") === true,
		);
		ok(
			"origin checks: the work surface includes untracked-non-ignored files (a new gate before its first commit)",
			checks.onWorkSurface("untracked.txt") === true && checks.onWorkSurface("absent-file.txt") === false,
		);
		throws(
			"manifest set: a REAL tracked-symlink subject is refused end-to-end (external escape shape)",
			() =>
				validateManifestSet(
					[{ schemaVersion: 1, lane: "escape", mutants: [fixtureSpec({ subject: "linked.txt" })] }],
					checks,
				),
			"symlink-escape guard",
		);

		const snap = createRepoSnapshot(fixtureOrigin);
		try {
			ok(
				"snapshot: replicates only the git surface (untracked.txt IS listed by --others, so it rides too)",
				fs.existsSync(path.join(snap.repoDir, "untracked.txt")),
			);
			ok("snapshot: base dir is mode 0700", (fs.statSync(snap.baseDir).mode & 0o777) === 0o700);
			ok(
				"snapshot: executable modes survive the copy",
				(fs.statSync(path.join(snap.repoDir, "gates/kill.sh")).mode & 0o111) !== 0,
			);
			ok(
				"snapshot: has its own git baseline (porcelain clean)",
				spawnSync("git", ["-C", snap.repoDir, "status", "--porcelain"], {
					encoding: "utf8",
					env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null" },
				}).stdout.trim() === "",
			);

			// KILLED positive + zero-match + multi-match + SURVIVED + WRONG-REASON in one report.
			const report = await qualifyMutants(
				snap,
				[
					fixtureSpec({}),
					fixtureSpec({ claim: "SELFTEST-STALE", signature: "[QK:SELFTEST-STALE]", find: ["never-present-line"] }),
					fixtureSpec({
						claim: "SELFTEST-MULTI",
						signature: "[QK:SELFTEST-MULTI]",
						subject: "double.txt",
						find: ["dup-line"],
						replace: ["defect-line"],
					}),
					fixtureSpec({
						claim: "SELFTEST-SURVIVE",
						signature: "[QK:SELFTEST-SURVIVE]",
						gate: ["bash", "gates/survive.sh"],
					}),
					fixtureSpec({ claim: "SELFTEST-WRONG", signature: "[QK:SELFTEST-WRONG]", gate: ["bash", "gates/wrong.sh"] }),
					fixtureSpec({
						claim: "SELFTEST-DOLLAR",
						signature: "[QK:SELFTEST-DOLLAR]",
						replace: ["dollar-$&-defect"],
						gate: ["bash", "gates/dollar.sh"],
					}),
				],
				quiet,
			);
			const byClaim = new Map(report.groups.flatMap((g) => g.mutants).map((m) => [m.claim, m.verdict]));
			ok(
				"pipeline: a planted defect the gate catches with its own token → KILLED",
				byClaim.get("SELFTEST-KILL") === "KILLED",
			);
			ok(
				"pipeline: a find that no longer matches → MUTANT-STALE (red, never vacuous-killed)",
				byClaim.get("SELFTEST-STALE") === "MUTANT-STALE",
			);
			ok(
				"pipeline: a find matching twice → MULTI-MATCH (nothing written)",
				byClaim.get("SELFTEST-MULTI") === "MULTI-MATCH",
			);
			ok("pipeline: a gate green under the defect → SURVIVED", byClaim.get("SELFTEST-SURVIVE") === "SURVIVED");
			ok(
				"pipeline: a gate red at ANOTHER claim's token → WRONG-REASON, never rounded up to KILLED",
				byClaim.get("SELFTEST-WRONG") === "WRONG-REASON",
			);
			ok(
				"pipeline: the multi-match subject was never written",
				fs.readFileSync(path.join(snap.repoDir, "double.txt"), "utf8") === "dup-line\ndup-line\n",
			);
			ok(
				"pipeline: a replacement carrying `$&` lands LITERALLY (String.replace patterns are inert) → KILLED",
				byClaim.get("SELFTEST-DOLLAR") === "KILLED",
			);
			ok("pipeline: the snapshot tree stayed clean across restores", report.treeClean && report.porcelainClean);
			ok("pipeline: a report with non-KILLED verdicts does not pass", reportPassed(report) === false);

			// HANG: bounded, restore still happens, and the whole report stays honest.
			const hangReport = await qualifyMutants(
				snap,
				[
					fixtureSpec({
						claim: "SELFTEST-HANG",
						signature: "[QK:SELFTEST-HANG]",
						gate: ["bash", "gates/hang.sh"],
						timeoutSeconds: 2,
					}),
				],
				quiet,
			);
			const hang = hangReport.groups[0].mutants[0];
			ok("pipeline: a hanging gate is classified HANG within its bound", hang.verdict === "HANG" && hang.seconds < 30);
			ok(
				"pipeline: the subject is restored even when the gate hung (finally-path restore)",
				fs.readFileSync(path.join(snap.repoDir, "subject.txt"), "utf8") === "alpha\noriginal-line\nomega\n",
			);

			// CONTROL-PRE red: the fake-KILLED hole — a baseline-red gate must abort its group.
			const preRed = await qualifyMutants(
				snap,
				[fixtureSpec({ claim: "SELFTEST-PRERED", signature: "[QK:SELFTEST-PRERED]", gate: ["bash", "gates/red.sh"] })],
				quiet,
			);
			ok(
				"pipeline: a baseline-red gate → group pre-red, mutant CONTROL-RED (no fake KILLED)",
				preRed.groups[0].control === "pre-red" && preRed.groups[0].mutants[0].verdict === "CONTROL-RED",
			);
			ok("pipeline: a control-red report does not pass", reportPassed(preRed) === false);

			// Stray write: mutant kills, but the tree manifest catches the impurity.
			const stray = await qualifyMutants(
				snap,
				[fixtureSpec({ claim: "SELFTEST-STRAY", signature: "[QK:SELFTEST-STRAY]", gate: ["bash", "gates/stray.sh"] })],
				quiet,
			);
			ok(
				"pipeline: a gate that wrote a stray file into the tree → treeClean=false (porcelain-invisible writes included)",
				stray.treeClean === false,
			);
			ok(
				"pipeline: an impure-tree report does not pass even with a KILLED mutant",
				stray.groups[0].mutants[0].verdict === "KILLED" && reportPassed(stray) === false,
			);
			fs.rmSync(path.join(snap.repoDir, "stray-file.txt"), { force: true });

			// State poison: mutant kills but leaves state that turns CONTROL-POST red.
			const poison = await qualifyMutants(
				snap,
				[
					fixtureSpec({
						claim: "SELFTEST-POISON",
						signature: "[QK:SELFTEST-POISON]",
						gate: ["bash", "gates/poison.sh"],
					}),
				],
				quiet,
			);
			ok(
				"pipeline: state leaked by a mutant run turns CONTROL-POST red (group impure)",
				poison.groups[0].control === "post-red",
			);
			ok("pipeline: a post-red report does not pass", reportPassed(poison) === false);
			fs.rmSync(path.join(snap.repoDir, "poison.marker"), { force: true });

			// P0-1 RUNTIME guard: the self-test injects specs directly (bypassing
			// validateManifestSet), so the escape must ALSO be stopped at the moment of
			// mutation — refused before a byte is read, external target untouched.
			const externalBefore = fs.readFileSync(externalTarget, "utf8");
			await assert.rejects(
				qualifyMutants(
					snap,
					[
						fixtureSpec({
							claim: "SELFTEST-ESCAPE",
							signature: "[QK:SELFTEST-ESCAPE]",
							subject: "linked.txt",
							gate: ["bash", "gates/survive.sh"],
						}),
					],
					quiet,
				),
				/symlink-escape guard/,
				"a tracked-symlink subject must be refused at mutation time, loudly",
			);
			ok(
				"pipeline: the symlink-escape refusal left the EXTERNAL target byte-identical (no write followed the link)",
				fs.readFileSync(externalTarget, "utf8") === externalBefore,
			);
		} finally {
			fs.rmSync(snap.baseDir, { recursive: true, force: true });
		}

		// P1-5: the origin tripwire hashes the WORK SURFACE CONTENT, not `status
		// --porcelain` text — a porcelain-based tripwire cannot see a byte change inside
		// a file that was ALREADY modified (same ` M` row before and after). Prove the
		// discriminating power on exactly that shape: modify → hash moves; modify the
		// BYTES AGAIN (porcelain text identical) → hash moves again; restore → hash back.
		{
			const subjectPath = path.join(fixtureOrigin, "subject.txt");
			const pristine = fs.readFileSync(subjectPath);
			const h0 = originWorkSurfaceSha(fixtureOrigin);
			fs.writeFileSync(subjectPath, "alpha\nmodified-once\nomega\n");
			const h1 = originWorkSurfaceSha(fixtureOrigin);
			fs.writeFileSync(subjectPath, "alpha\nmodified-twice\nomega\n");
			const h2 = originWorkSurfaceSha(fixtureOrigin);
			fs.writeFileSync(subjectPath, pristine);
			const h3 = originWorkSurfaceSha(fixtureOrigin);
			ok("tripwire: a first modification moves the work-surface hash", h1 !== h0);
			ok(
				"tripwire: a byte change INSIDE an already-modified file moves the hash again (porcelain would not see it)",
				h2 !== h1,
			);
			ok("tripwire: restoring the bytes restores the hash (content-derived, not time-derived)", h3 === h0);
		}

		// pgroup kill: the grandchild really dies on this host (hardening #6, Linux axis).
		{
			const invocationDir = reclaimOnExit(fs.mkdtempSync(path.join(os.tmpdir(), "entwurf-qualify-pgk-")));
			const pidFile = path.join(invocationDir, "grandchild.pid");
			const script = path.join(invocationDir, "spawner.sh");
			fs.writeFileSync(script, `#!/usr/bin/env bash\nsleep 300 & echo $! > ${JSON.stringify(pidFile)}\nwait\n`);
			fs.chmodSync(script, 0o755);
			const run = await runGateBounded({
				cwd: invocationDir,
				argv: ["bash", script],
				timeoutSeconds: 2,
				invocationDir,
			});
			ok("pgroup: the spawner timed out as expected", run.timedOut === true);
			const grandchild = Number(fs.readFileSync(pidFile, "utf8").trim());
			let dead = false;
			for (let i = 0; i < 20 && !dead; i++) {
				try {
					process.kill(grandchild, 0);
					await new Promise((r) => setTimeout(r, 50));
				} catch {
					dead = true;
				}
			}
			ok(`pgroup: the GRANDCHILD (pid ${grandchild}) is dead after the group SIGKILL`, dead);
			fs.rmSync(invocationDir, { recursive: true, force: true });
		}

		// Stale-snapshot sweep: dead-pid residue is reclaimed, a live runner's dir survives.
		{
			const tmpRoot = reclaimOnExit(fs.mkdtempSync(path.join(os.tmpdir(), "entwurf-qualify-sweep-")));
			const deadDir = path.join(tmpRoot, "entwurf-qualify-dead1");
			fs.mkdirSync(deadDir);
			fs.writeFileSync(path.join(deadDir, "runner.json"), JSON.stringify({ pid: 999_999_999, startedAt: 0 }));
			const liveDir = path.join(tmpRoot, "entwurf-qualify-live1");
			fs.mkdirSync(liveDir);
			fs.writeFileSync(path.join(liveDir, "runner.json"), JSON.stringify({ pid: process.pid, startedAt: Date.now() }));
			const swept = sweepStaleSnapshots(tmpRoot);
			ok("sweep: a dead-pid snapshot dir is reclaimed", swept.includes(deadDir) && !fs.existsSync(deadDir));
			ok("sweep: a live runner's snapshot dir survives", fs.existsSync(liveDir));
			fs.rmSync(tmpRoot, { recursive: true, force: true });
		}
	} finally {
		fs.rmSync(fixtureOrigin, { recursive: true, force: true });
		fs.rmSync(path.dirname(externalTarget), { recursive: true, force: true });
	}
}

// ═══ Phase 1c-b — a declared build output over a source-only fixture (#125) ═══
//
// The snapshot replicates the work surface only, so an IGNORED build output a gate consumes
// (the compiled entwurf-bridge) is absent, and such a gate is CONTROL-RED in every run. A
// mutant may declare that build instead. Each cell is a discriminating negative: a runner
// that skipped the rebuild after a mutation, read a build red as a kill, let one group's
// output reach another, or ignored a gate writing into the output flips exactly one of them.

function buildDeclaredOutputFixture(): string {
	const dir = reclaimOnExit(fs.mkdtempSync(path.join(os.tmpdir(), "entwurf-qualify-build-")));
	const write = (rel: string, body: string): void => {
		const p = path.join(dir, rel);
		fs.mkdirSync(path.dirname(p), { recursive: true });
		fs.writeFileSync(p, body);
	};
	write(".gitignore", "out/\n");
	write("src.txt", "alpha\noriginal-line\nomega\n");
	write("tracked-out/keep.txt", "a tracked directory is source, never a build output\n");
	// The build prints the build-red mutant's own token on its FAILURE line on purpose: a
	// runner that read build output as gate output would call the broken build a kill.
	write(
		"build.sh",
		'set -e\nrm -rf out\nmkdir -p out\nif grep -q break-build src.txt; then echo "FAIL: build broke [QK:SELFTEST-BUILD-RED]" >&2; exit 1; fi\ncp src.txt out/built.txt\n',
	);
	// Reads ONLY the build output: it can see the planted defect only if the runner rebuilt.
	write(
		"gates/built.sh",
		'if [ ! -f out/built.txt ]; then echo "FAIL: build output missing" >&2; exit 1; fi\nif grep -q defect-line out/built.txt; then echo "FAIL: built defect [QK:SELFTEST-BUILD-KILL]" >&2; exit 1; fi\nexit 0\n',
	);
	write(
		"gates/writer.sh",
		'if [ ! -f out/built.txt ]; then exit 1; fi\nif grep -q defect-line out/built.txt; then echo stray > out/stray.txt; echo "FAIL: built defect [QK:SELFTEST-BUILD-WRITER]" >&2; exit 1; fi\nexit 0\n',
	);
	write(
		"gates/no-output.sh",
		'if [ -e out ]; then echo "FAIL: a build output leaked out of its group" >&2; exit 1; fi\nexit 0\n',
	);
	const git = (...args: string[]): void => {
		const r = spawnSync("git", ["-C", dir, ...args], {
			stdio: "ignore",
			env: {
				...process.env,
				GIT_CONFIG_GLOBAL: "/dev/null",
				GIT_CONFIG_SYSTEM: "/dev/null",
				GIT_AUTHOR_NAME: "fx",
				GIT_AUTHOR_EMAIL: "fx@localhost",
				GIT_COMMITTER_NAME: "fx",
				GIT_COMMITTER_EMAIL: "fx@localhost",
			},
		});
		assert.equal(r.status, 0, `fixture git ${args.join(" ")} failed`);
	};
	git("init", "-q");
	git("add", "-A");
	git("-c", "commit.gpgsign=false", "commit", "-q", "-m", "fixture");
	return dir;
}

{
	const origin = buildDeclaredOutputFixture();
	const build = { argv: ["bash", "build.sh"], output: "out" };
	const spec = (patch: Partial<MutantSpec>): MutantSpec => ({
		claim: "SELFTEST-BUILD-KILL",
		title: "fixture",
		subject: "src.txt",
		find: ["original-line"],
		replace: ["defect-line"],
		gate: ["bash", "gates/built.sh"],
		timeoutSeconds: 30,
		signature: "[QK:SELFTEST-BUILD-KILL]",
		signatureSource: "gates/built.sh",
		build,
		...patch,
	});
	const snap = createRepoSnapshot(origin);
	try {
		ok(
			"build fixture: the snapshot is source-only — the ignored output is not replicated",
			!fs.existsSync(path.join(snap.repoDir, "out")),
		);
		const report = await qualifyMutants(
			snap,
			[
				// No declaration, same script: the #125 shape — the gate needs an output nobody built.
				// It runs FIRST, so its verdict never depends on whether an earlier group cleaned up.
				spec({
					claim: "SELFTEST-BUILD-UNDECLARED",
					signature: "[QK:SELFTEST-BUILD-UNDECLARED]",
					gate: ["bash", "gates/built.sh", "undeclared"],
					build: undefined,
				}),
				spec({}),
				spec({
					claim: "SELFTEST-BUILD-RED",
					signature: "[QK:SELFTEST-BUILD-RED]",
					replace: ["break-build"],
				}),
				spec({
					claim: "SELFTEST-NO-LEAK",
					signature: "[QK:SELFTEST-NO-LEAK]",
					gate: ["bash", "gates/no-output.sh"],
					build: undefined,
				}),
			],
			quiet,
		);
		const byClaim = new Map(report.groups.flatMap((g) => g.mutants.map((m) => [m.claim, { g, m }] as const)));
		ok(
			"[QK:QUALIFY-BUILD-TRACKS-MUTATION] a gate that reads ONLY the declared build output kills a mutant planted in the build's SOURCE — the runner rebuilt from the mutated bytes, and the restored bytes rebuilt the baseline (control-post green)",
			byClaim.get("SELFTEST-BUILD-KILL")?.m.verdict === "KILLED" &&
				byClaim.get("SELFTEST-BUILD-KILL")?.g.control === "ok",
		);
		ok(
			"[QK:QUALIFY-BUILD-RED-NOT-A-KILL] a mutation that breaks the build is never a kill, even when the build prints the claim token on its failure line — the gate did not run",
			byClaim.get("SELFTEST-BUILD-RED")?.m.verdict === "WRONG-REASON" &&
				(byClaim.get("SELFTEST-BUILD-RED")?.m.detail ?? "").includes("declared build red"),
		);
		ok(
			"[QK:QUALIFY-BUILD-SCOPED-TO-GROUP] the declared output belongs to its group alone — a later group never sees it, it is gone when the run ends, and the snapshot tree and porcelain are exactly as before",
			byClaim.get("SELFTEST-NO-LEAK")?.g.control === "ok" &&
				!fs.existsSync(path.join(snap.repoDir, "out")) &&
				report.treeClean &&
				report.porcelainClean,
		);
		ok(
			"build fixture: a gate that needs an output its group did not declare is CONTROL-RED (the #125 qualification shape)",
			byClaim.get("SELFTEST-BUILD-UNDECLARED")?.m.verdict === "CONTROL-RED",
		);

		const writer = await qualifyMutants(
			snap,
			[
				spec({
					claim: "SELFTEST-BUILD-WRITER",
					signature: "[QK:SELFTEST-BUILD-WRITER]",
					gate: ["bash", "gates/writer.sh"],
					signatureSource: "gates/writer.sh",
				}),
			],
			quiet,
		);
		ok(
			"[QK:QUALIFY-BUILD-OUTPUT-GUARDED] a gate that writes into its declared build output voids its own run — IMPURE, never KILLED, and the group is post-red",
			writer.groups[0].mutants[0].verdict === "IMPURE" && writer.groups[0].control === "post-red",
		);
		ok("build fixture: an impure-output report does not pass", reportPassed(writer) === false);

		const baselineRed = await qualifyMutants(
			snap,
			[spec({ build: { argv: ["bash", "-c", "exit 3"], output: "out" } })],
			quiet,
		);
		ok(
			"build fixture: a build red at baseline voids the group — pre-red, every mutant CONTROL-RED",
			baselineRed.groups[0].control === "pre-red" && baselineRed.groups[0].mutants[0].verdict === "CONTROL-RED",
		);
		await assert.rejects(
			qualifyMutants(snap, [spec({ build: { argv: ["bash", "build.sh"], output: "tracked-out" } })], quiet),
			/already exists in the snapshot/,
			"a declared output that is on the work surface must be refused before anything runs",
		);
		ok(
			"build fixture: a declared output that is on the work surface is refused before anything runs, and its source bytes are untouched",
			fs.existsSync(path.join(snap.repoDir, "tracked-out", "keep.txt")),
		);
		await assert.rejects(
			qualifyMutants(snap, [spec({ build: { argv: ["bash", "build.sh"], output: "absent-parent/out" } })], quiet),
			/no parent directory in the snapshot/,
			"a declared output whose parent the snapshot lacks must be refused — the build would leave that directory behind",
		);
		ok(
			"build fixture: a declared output whose parent is absent is refused before anything runs, and nothing was created",
			!fs.existsSync(path.join(snap.repoDir, "absent-parent")),
		);
		// A build that never cleans its output (append-only) still reproduces its baseline: the
		// runner removes the output before every build, so the contract does not rest on the script.
		const appending = await qualifyMutants(
			snap,
			[
				spec({
					gate: ["bash", "gates/built.sh", "appending"],
					build: {
						argv: ["bash", "-c", "mkdir -p out && cp src.txt out/built.txt && echo run >> out/append.log"],
						output: "out",
					},
				}),
			],
			quiet,
		);
		ok(
			"build fixture: a build that does not clean its own output still kills and reproduces its baseline (control ok, tree clean)",
			appending.groups[0].mutants[0].verdict === "KILLED" &&
				appending.groups[0].control === "ok" &&
				appending.treeClean,
		);
	} finally {
		fs.rmSync(snap.baseDir, { recursive: true, force: true });
		fs.rmSync(origin, { recursive: true, force: true });
	}
}

// ═══ Phase 1c-g — the PARTIAL group receipt over the fixture (#124 P1) ═════
//
// `--group` is a mixed CLI/process surface (argv, snapshot, gate children, a file
// written outside the repo), so its proof rides this self-test next to the pipeline
// cells it reuses instead of a separate Vitest lane. Every cell below runs in the
// head, so `check-gate-manifests` pins it on every floor run.

{
	const refuse = (argv: string[], naming: string): void =>
		throws(
			`group args: ${JSON.stringify(argv)} is refused before anything runs`,
			() => parseQualificationArgs(argv),
			naming,
		);
	const g = '["bash","gates/kill.sh"]';
	ok("group args: no argument is the unchanged full body", parseQualificationArgs([]).mode === "full");
	ok(
		"group args: --manifests-only alone is the head",
		parseQualificationArgs(["--manifests-only"]).mode === "manifests-only",
	);
	const parsedGroup = parseQualificationArgs(["--group", g, "--receipt", "/x/r.json"]);
	ok(
		"group args: --group/--receipt parse to the exact argv and path",
		parsedGroup.mode === "group" &&
			JSON.stringify(parsedGroup.group) === g.replace(/ /g, "") &&
			parsedGroup.receiptPath === "/x/r.json",
	);
	refuse(["--bogus"], "unknown argument");
	refuse(["--manifests-only", "--manifests-only"], "repeated flag");
	refuse(["--group", g], "--group needs --receipt");
	refuse(["--receipt", "/x/r.json"], "--receipt needs --group");
	refuse(["--receipt"], "needs a value");
	refuse(["--group", g, "--receipt", "/x/r.json", "--manifests-only"], "cannot combine");
	refuse(["--manifests-only", "--attribution-self-test"], "exclusive");
	refuse(["--group", "check-x", "--receipt", "/x/r.json"], "JSON array");
	refuse(["--group", "[]", "--receipt", "/x/r.json"], "non-empty JSON array");
	refuse(["--compose"], "at least one receipt file");
	refuse(["--expect", "/x/e.txt"], "need --compose");
	refuse(["--compose", "/x/r.json", "--manifests-only"], "--compose cannot combine");
	refuse(["--compose", "/x/r.json", "--group", g, "--receipt", "/x/q.json"], "--compose cannot combine");
	const parsedCompose = parseQualificationArgs(["--compose", "/a.json", "/b.json", "--expect", "/e.txt"]);
	ok(
		"compose args: --compose takes the files up to the next flag, --expect its list",
		parsedCompose.mode === "compose" &&
			JSON.stringify(parsedCompose.receipts) === '["/a.json","/b.json"]' &&
			parsedCompose.expectPath === "/e.txt",
	);

	const tmpRoot = reclaimOnExit(fs.mkdtempSync(path.join(os.tmpdir(), "entwurf-receipt-selftest-")));
	const { dir: origin, externalTarget } = buildFixtureOrigin();
	try {
		const out = (name: string): string => path.join(tmpRoot, name);
		fs.writeFileSync(out("exists.json"), "keep\n");
		throws("receipt path: relative is refused", () => checkReceiptPath("r.json", origin), "must be absolute");
		throws(
			"receipt path: an existing file is refused, never overwritten",
			() => checkReceiptPath(out("exists.json"), origin),
			"refusing to overwrite",
		);
		throws(
			"receipt path: inside the repo is refused (it would move the seal it records)",
			() => checkReceiptPath(path.join(origin, "r.json"), origin),
			"outside the repo",
		);
		throws(
			"receipt path: a missing parent is refused",
			() => checkReceiptPath(out("nope/r.json"), origin),
			"parent directory does not exist",
		);

		writeReceiptExclusive(out("w.json"), { a: 1 });
		ok(
			"receipt write: bytes land whole, mode 600, no temp left",
			JSON.parse(fs.readFileSync(out("w.json"), "utf8")).a === 1 &&
				(fs.statSync(out("w.json")).mode & 0o777) === 0o600 &&
				fs.readdirSync(tmpRoot).every((f) => !f.includes(".tmp-")),
		);
		throws(
			"receipt write: a second write to the same path fails",
			() => writeReceiptExclusive(out("w.json"), { a: 2 }),
			"EEXIST",
		);
		ok(
			"receipt write: the first receipt survives the refused second write, no temp left",
			JSON.parse(fs.readFileSync(out("w.json"), "utf8")).a === 1 &&
				fs.readdirSync(tmpRoot).every((f) => !f.includes(".tmp-")),
		);
		throws(
			"receipt write: a body that cannot serialize writes nothing",
			() => writeReceiptExclusive(out("bad.json"), { n: 1n }),
			"BigInt",
		);
		ok(
			"receipt write: the failed write left neither the receipt nor its temp",
			!fs.existsSync(out("bad.json")) && fs.readdirSync(tmpRoot).every((f) => !f.includes(".tmp-")),
		);

		// An intermediate DIRECTORY symlink out of the repo: lexically `linkdir/…` is inside,
		// but its bytes live next to externalTarget. Must be refused by realpath, not read.
		fs.symlinkSync(path.dirname(externalTarget), path.join(origin, "linkdir"));
		const fp = fileFingerprints(origin, [
			"../escape.txt",
			"/etc/hostname",
			"linkdir/external-target.txt",
			"linked.txt",
			"subject.txt",
			"absent.txt",
		]);
		ok(
			"fingerprints: a path outside the repo is marked, never read",
			fp["../escape.txt"] === "outside-repo" && fp["/etc/hostname"] === "outside-repo",
		);
		ok(
			"[QK:RECEIPT-PARENT-REALPATH-CONTAINED] fingerprints: a file reached through an intermediate directory symlink out of the repo is `outside-repo`, not hashed",
			fp["linkdir/external-target.txt"] === "outside-repo",
		);
		fs.rmSync(path.join(origin, "linkdir"));
		ok(
			"fingerprints: a symlink is recorded by target, not followed; absent is `missing`",
			fp["linked.txt"] === `link:${externalTarget}` &&
				fp["absent.txt"] === "missing" &&
				/^[0-9a-f]{64}$/.test(fp["subject.txt"]),
		);

		// The self-test's own gate scripts, as the committed set the group is chosen from.
		const selectedFx = [
			fixtureSpec({}),
			fixtureSpec({
				claim: "SELFTEST-SURVIVE",
				gate: ["bash", "gates/survive.sh"],
				signature: "[QK:SELFTEST-SURVIVE]",
			}),
		];
		const runFx = (gate: string[], name: string) =>
			runGroupReceipt({
				repoDir: origin,
				selected: selectedFx,
				gate,
				receiptPath: out(name),
				log: quiet,
				logError: quiet,
				tmpRoot,
			});
		const snapshotsLeft = (): string[] => fs.readdirSync(tmpRoot).filter((f) => f.startsWith("entwurf-qualify-"));
		const readReceipt = (name: string) => JSON.parse(fs.readFileSync(out(name), "utf8"));

		const green = await runFx(["bash", "gates/kill.sh"], "green.json");
		const gr = readReceipt("green.json");
		ok(
			"group run: a killing group writes a green PARTIAL receipt of exactly its claims",
			green.passed &&
				gr.result.passed === true &&
				gr.label.startsWith("PARTIAL") &&
				JSON.stringify(gr.group.claims) === '["SELFTEST-KILL"]' &&
				gr.result.mutants[0].verdict === "KILLED" &&
				gr.manifestSet.claimCount === 2 &&
				gr.seal.stable === true &&
				gr.receiptSha256 === green.receiptSha256,
		);
		ok("group run: the snapshot is reclaimed", snapshotsLeft().length === 0);

		const red = await runFx(["bash", "gates/survive.sh"], "red.json");
		const rr = readReceipt("red.json");
		ok(
			"group run: a SURVIVED mutant is still written — red receipt, passed false",
			red.passed === false && rr.result.passed === false && rr.result.mutants[0].verdict === "SURVIVED",
		);

		let refused = "";
		try {
			await runFx(["bash", "gates/nope.sh"], "none.json");
		} catch (err) {
			refused = err instanceof Error ? err.message : String(err);
		}
		ok(
			"group run: an argv naming no committed group refuses with no receipt and no snapshot",
			refused.includes("names no exact gate argv") && !fs.existsSync(out("none.json")) && snapshotsLeft().length === 0,
		);

		// SEAL MOVED: a gate that kills its mutant for the claimed reason but ALSO writes
		// the ORIGIN (by absolute path — the fence does not stop it). The kill is real;
		// the receipt must still be red because the candidate it describes moved.
		fs.writeFileSync(
			path.join(origin, "gates/mover.sh"),
			`#!/usr/bin/env bash\nif grep -q defect-line subject.txt; then echo moved >> ${JSON.stringify(path.join(origin, "subject.txt"))}; echo "FAIL: planted defect detected [QK:SELFTEST-MOVER]" >&2; exit 1; fi\nexit 0\n`,
		);
		const moverSpec = fixtureSpec({
			claim: "SELFTEST-MOVER",
			gate: ["bash", "gates/mover.sh"],
			signature: "[QK:SELFTEST-MOVER]",
			signatureSource: "gates/mover.sh",
		});
		const moved = await runGroupReceipt({
			repoDir: origin,
			selected: [moverSpec],
			gate: moverSpec.gate,
			receiptPath: out("moved.json"),
			log: quiet,
			logError: quiet,
			tmpRoot,
		});
		const mr = readReceipt("moved.json");
		ok(
			"[QK:RECEIPT-SEAL-MOVED-IS-RED] group run: an origin write during the run returns cleanly with seal.stable false and passed false",
			moved.passed === false &&
				mr.result.mutants[0].verdict === "KILLED" &&
				mr.seal.stable === false &&
				mr.seal.workSurfaceAfterSha256 !== mr.candidate.workSurfaceSha256 &&
				JSON.stringify(mr.seal.declaredInputsChanged) === '["subject.txt"]' &&
				snapshotsLeft().length === 0,
		);
	} finally {
		fs.rmSync(origin, { recursive: true, force: true });
		fs.rmSync(path.dirname(externalTarget), { recursive: true, force: true });
		fs.rmSync(tmpRoot, { recursive: true, force: true });
	}
}

const refuseArgs = (argv: string[], naming: string): void =>
	throws(`args: ${JSON.stringify(argv)} is refused before anything runs`, () => parseQualificationArgs(argv), naming);

// ═══ Phase 1c-m — several groups, one collection (#124 step 1) ════════════
//
// The production collectGroups over a fixture origin: a red group in the middle does not
// stop the tail; a runner crash and a moved origin seal DO stop it, leaving the rest
// `not-attempted`; and checkCollection names a missing, altered or undeclared file.

{
	const tmpRoot = reclaimOnExit(fs.mkdtempSync(path.join(os.tmpdir(), "entwurf-collect-selftest-")));
	const { dir: origin, externalTarget } = buildFixtureOrigin();
	try {
		fs.writeFileSync(path.join(origin, "tail.txt"), "tail-ok\n");
		fs.writeFileSync(
			path.join(origin, "gates/tail.sh"),
			'#!/usr/bin/env bash\nif grep -q tail-bad tail.txt; then echo "FAIL: tail defect [QK:SELFTEST-TAIL]" >&2; exit 1; fi\nexit 0\n',
			{ mode: 0o755 },
		);
		fs.writeFileSync(
			path.join(origin, "gates/mover.sh"),
			`#!/usr/bin/env bash\nif grep -q defect-line subject.txt; then echo moved >> ${JSON.stringify(path.join(origin, "subject.txt"))}; echo "FAIL: planted defect detected [QK:SELFTEST-MOVER]" >&2; exit 1; fi\nexit 0\n`,
			{ mode: 0o755 },
		);
		const sA = fixtureSpec({});
		const sB = fixtureSpec({
			claim: "SELFTEST-SURVIVE",
			gate: ["bash", "gates/survive.sh"],
			signature: "[QK:SELFTEST-SURVIVE]",
		});
		const sC = fixtureSpec({
			claim: "SELFTEST-TAIL",
			subject: "tail.txt",
			find: ["tail-ok"],
			replace: ["tail-bad"],
			gate: ["bash", "gates/tail.sh"],
			signature: "[QK:SELFTEST-TAIL]",
			signatureSource: "gates/tail.sh",
		});
		// A tracked SYMLINK subject: the runtime symlink-escape guard throws inside the body.
		const sCrash = fixtureSpec({
			claim: "SELFTEST-CRASH",
			subject: "linked.txt",
			gate: ["bash", "gates/kill.sh", "crash"],
		});
		const sMover = fixtureSpec({
			claim: "SELFTEST-MOVER",
			gate: ["bash", "gates/mover.sh"],
			signature: "[QK:SELFTEST-MOVER]",
			signatureSource: "gates/mover.sh",
		});
		const all = [sA, sB, sC, sCrash, sMover];
		const collect = (name: string, requested: MutantSpec[], beforeGroup?: (i: number) => void) =>
			collectGroups({
				beforeGroup,
				repoDir: origin,
				selected: all,
				requested: requested.map((m) => m.gate),
				collectDir: path.join(tmpRoot, name),
				log: quiet,
				logError: quiet,
				tmpRoot,
				coreGroupGate: sA.gate,
				env: { GITHUB_RUN_ID: "123", GITHUB_RUN_ATTEMPT: "2" },
			});
		const receiptOf = (dir: string, file: string | null) =>
			JSON.parse(fs.readFileSync(path.join(tmpRoot, dir, file ?? ""), "utf8"));

		const abc = await collect("abc", [sA, sB, sC]);
		ok(
			"[QK:COLLECT-RED-DOES-NOT-STOP] collect: green / red / green — the red middle does not stop the tail; collection COMPLETE and intact",
			abc.complete &&
				abc.stoppedBy === null &&
				JSON.stringify(abc.attempted.map((a) => a.outcome)) ===
					'["receipt-written","receipt-written","receipt-written"]' &&
				JSON.stringify(abc.attempted.map((a) => a.detail)) === '["group-green","group-RED","group-green"]' &&
				checkCollection(path.join(tmpRoot, "abc")).length === 0,
		);
		const rA = receiptOf("abc", abc.attempted[0].file);
		const rB = receiptOf("abc", abc.attempted[1].file);
		const rC = receiptOf("abc", abc.attempted[2].file);
		ok(
			"collect: each group ran control→mutant→control on its OWN clean snapshot, claims attributed",
			[rA, rC].every(
				(r) =>
					r.result.control === "ok" &&
					r.result.treeClean &&
					r.result.porcelainClean &&
					r.seal.stable &&
					r.result.mutants[0].verdict === "KILLED",
			) &&
				rB.result.control === "ok" &&
				rB.result.mutants[0].verdict === "SURVIVED" &&
				fs.readdirSync(tmpRoot).every((f) => !f.startsWith("entwurf-qualify-")),
		);
		ok(
			"collect: runId/runAttempt recorded exactly as the environment gave them; requested order kept",
			abc.runId === "123" &&
				abc.runAttempt === "2" &&
				JSON.stringify(abc.requested) === JSON.stringify([sA.gate, sB.gate, sC.gate]),
		);

		const variant = (name: string, mutate: (dir: string) => void): string[] => {
			const dir = path.join(tmpRoot, name);
			fs.cpSync(path.join(tmpRoot, "abc"), dir, { recursive: true });
			mutate(dir);
			return checkCollection(dir);
		};
		const missing = variant("missing", (d) => fs.rmSync(path.join(d, "g002.json")));
		const extra = variant("extra", (d) => fs.writeFileSync(path.join(d, "stray.json"), "{}"));
		const altered = variant("altered", (d) => fs.appendFileSync(path.join(d, "g000.json"), " "));
		ok(
			"[QK:COLLECT-UNDECLARED-FILE-NAMED] collect: a missing, an undeclared and an altered receipt file are each named",
			missing.some((e) => e.startsWith("collection-missing:")) &&
				extra.some((e) => e === "collection-extra: stray.json") &&
				altered.some((e) => e.startsWith("collection-altered:")),
		);

		const crash = await collect("crash", [sA, sCrash, sC]);
		const crashCheck = checkCollection(path.join(tmpRoot, "crash"));
		ok(
			"collect: a runner crash STOPS the collection — the rest not-attempted, INCOMPLETE on disk",
			crash.stoppedBy === "runner-crash" &&
				!crash.complete &&
				JSON.stringify(crash.attempted.map((a) => a.outcome)) ===
					'["receipt-written","runner-crash","not-attempted"]' &&
				crash.attempted[1].detail?.includes("symlink") === true &&
				crashCheck.some((e) => e.startsWith("collection-incomplete:")) &&
				crashCheck.includes("collection-stopped: runner-crash"),
		);

		const moved = await collect("moved", [sMover, sA]);
		ok(
			"[QK:COLLECT-SEAL-MOVED-STOPS] collect: an origin seal that moved STOPS the collection after writing that red receipt",
			moved.stoppedBy === "seal-moved" &&
				!moved.complete &&
				JSON.stringify(moved.attempted.map((a) => a.outcome)) === '["receipt-written","not-attempted"]' &&
				receiptOf("moved", moved.attempted[0].file).seal.stable === false,
		);

		// D1 — bytes move BETWEEN groups (each group alone is seal-stable): the collection must
		// stop, and a collection assembled from two candidates must never read as intact.
		const drift = await collect("drift", [sA, sC], (i) => {
			if (i === 1) fs.appendFileSync(path.join(origin, "untracked.txt"), "moved between groups\n");
		});
		ok(
			"[QK:COLLECT-CANDIDATE-DRIFT-STOPS] collect: origin bytes moved between two seal-stable groups → STOP candidate-drift, INCOMPLETE",
			drift.stoppedBy === "candidate-drift" &&
				!drift.complete &&
				drift.attempted[1].outcome === "receipt-written" &&
				(drift.attempted[1].detail ?? "").includes("candidate drift: workSurface") &&
				checkCollection(path.join(tmpRoot, "drift")).some((e) => e.startsWith("collection-candidate-drift:")),
		);
		const assembled = path.join(tmpRoot, "assembled");
		fs.cpSync(path.join(tmpRoot, "abc"), assembled, { recursive: true });
		fs.copyFileSync(path.join(tmpRoot, "drift", "g001.json"), path.join(assembled, "g002.json"));
		const assembledC = JSON.parse(fs.readFileSync(path.join(assembled, "collection.json"), "utf8"));
		assembledC.attempted[2].sha256 = createHash("sha256")
			.update(fs.readFileSync(path.join(assembled, "g002.json")))
			.digest("hex");
		fs.writeFileSync(path.join(assembled, "collection.json"), JSON.stringify(assembledC));
		const assembledCheck = checkCollection(path.join(tmpRoot, "assembled"));
		ok(
			"collect: a collection assembled from two REAL receipts of different candidates (digests re-declared) is named drift, never intact",
			assembledCheck.some((e) => e.startsWith("collection-candidate-drift:") && e.includes("g002.json")) &&
				!assembledCheck.some((e) => e.startsWith("collection-altered:")),
		);

		// D2 — collection.json is data: its file names never steer a read outside the dir.
		const sentinel = path.join(tmpRoot, "outside.json");
		fs.copyFileSync(path.join(tmpRoot, "abc", "g000.json"), sentinel);
		const sentinelSha = createHash("sha256").update(fs.readFileSync(sentinel)).digest("hex");
		fs.chmodSync(sentinel, 0o000); // were it ever opened, the error would be EACCES, not the name refusal
		const redirect = (name: string, file: string, prep?: (dir: string) => void): string[] => {
			const dir = path.join(tmpRoot, name);
			fs.cpSync(path.join(tmpRoot, "abc"), dir, { recursive: true });
			const cj = JSON.parse(fs.readFileSync(path.join(dir, "collection.json"), "utf8"));
			cj.attempted[0].file = file;
			cj.attempted[0].sha256 = sentinelSha;
			fs.writeFileSync(path.join(dir, "collection.json"), JSON.stringify(cj));
			prep?.(dir);
			return checkCollection(dir);
		};
		const dotdot = redirect("esc-dotdot", "../outside.json");
		const absolute = redirect("esc-abs", sentinel);
		ok(
			"[QK:COLLECT-FILE-NAME-CONFINED] collect: a `../` or absolute receipt name is refused BY NAME — the outside sentinel is never opened",
			dotdot.some((e) => e.startsWith("collection-file-name:")) &&
				absolute.some((e) => e.startsWith("collection-file-name:")) &&
				![...dotdot, ...absolute].some((e) => e.includes("EACCES")),
		);
		fs.chmodSync(sentinel, 0o600);
		const linked = redirect("esc-link", "g000.json", (dir) => {
			fs.rmSync(path.join(dir, "g000.json"));
			fs.symlinkSync(sentinel, path.join(dir, "g000.json"));
		});
		const shapeDir = path.join(tmpRoot, "bad-shape");
		fs.cpSync(path.join(tmpRoot, "abc"), shapeDir, { recursive: true });
		fs.writeFileSync(path.join(shapeDir, "collection.json"), JSON.stringify({ attempted: "x" }));
		// Nested shape: a well-formed top level whose candidate groups are malformed must be
		// reported as shape, never thrown out of candidateDrift.
		const nestedShape = (name: string, groups: unknown): string[] => {
			const dir = path.join(tmpRoot, name);
			fs.cpSync(path.join(tmpRoot, "abc"), dir, { recursive: true });
			const cj = JSON.parse(fs.readFileSync(path.join(dir, "collection.json"), "utf8"));
			cj.candidate.groups = groups;
			fs.writeFileSync(path.join(dir, "collection.json"), JSON.stringify(cj));
			return checkCollection(dir);
		};
		const shapeNull = nestedShape("shape-null", [null]);
		const shapeGate = nestedShape("shape-gate", [{ gate: "x" }]);
		ok(
			"collect: a symlinked receipt is refused on the descriptor (ELOOP); a malformed collection.json is reported, never thrown",
			linked.some((e) => e.startsWith("collection-not-regular:") && e.includes("ELOOP")) &&
				JSON.stringify(shapeNull) ===
					'["collection-shape: collection.json is missing or mistyping a required field"]' &&
				JSON.stringify(shapeGate) ===
					'["collection-shape: collection.json is missing or mistyping a required field"]' &&
				JSON.stringify(checkCollection(shapeDir)) ===
					'["collection-shape: collection.json is missing or mistyping a required field"]',
		);

		throws("collect: an empty request is refused", () => checkRequestedGroups([], all), "is empty");
		throws("collect: a repeated argv is refused", () => checkRequestedGroups([sA.gate, sA.gate], all), "repeats");
		throws(
			"collect: an argv no committed group has is refused",
			() => checkRequestedGroups([["bash", "gates/nope.sh"]], all),
			"no exact gate argv",
		);
		let exists = "";
		try {
			await collect("abc", [sA]);
		} catch (err) {
			exists = err instanceof Error ? err.message : String(err);
		}
		ok("collect: an existing collection dir is refused, never reused", exists.includes("EEXIST"));
		refuseArgs(["--groups", "[]", "--collect", "/x/c"], "is empty");
		refuseArgs(["--groups", '[["a"],["a"]]', "--collect", "/x/c"], "repeats");
		refuseArgs(["--groups", '["a"]', "--collect", "/x/c"], "non-empty argv arrays");
		refuseArgs(["--groups", '[["a"]]'], "--groups needs --collect");
		refuseArgs(["--collect", "/x/c"], "--collect needs --groups");
		refuseArgs(["--groups", '[["a"]]', "--collect", "/x/c", "--manifests-only"], "--groups cannot combine");
	} finally {
		fs.rmSync(origin, { recursive: true, force: true });
		fs.rmSync(path.dirname(externalTarget), { recursive: true, force: true });
		fs.rmSync(tmpRoot, { recursive: true, force: true });
	}
}

// ═══ Phase 1c-l — the composite ledger over REAL fixture receipts (#124 P2) ═
//
// A late failure, end to end: receipts are written by runGroupReceipt on a fixture
// origin (never hand-built), a gate is fixed, the ledger is re-composed on the new
// bytes, the fixture is committed (dirty → clean, same content), and the ledger is
// re-composed again. Then the pure negatives, each derived from one of those real
// receipts. These live in the head for the same reason as Phase 1c-g (mixed process
// surface; `test/**` is not on the public vitest door, run.sh check_tests_beside_behavior).

{
	const tmpRoot = reclaimOnExit(fs.mkdtempSync(path.join(os.tmpdir(), "entwurf-ledger-selftest-")));
	const { dir: origin, externalTarget } = buildFixtureOrigin();
	try {
		const wr = (rel: string, body: string): void => fs.writeFileSync(path.join(origin, rel), body, { mode: 0o755 });
		wr("late.txt", "late-ok\n");
		wr("tail.txt", "tail-ok\n");
		// The late gate starts WEAK — it passes whatever late.txt says, so its mutant survives.
		wr("gates/late.sh", "#!/usr/bin/env bash\n# [QK:SELFTEST-LATE]\nexit 0\n");
		wr(
			"gates/tail.sh",
			'#!/usr/bin/env bash\nif grep -q tail-bad tail.txt; then echo "FAIL: tail defect [QK:SELFTEST-TAIL]" >&2; exit 1; fi\nexit 0\n',
		);
		const specA = fixtureSpec({});
		const specB = fixtureSpec({
			claim: "SELFTEST-LATE",
			subject: "late.txt",
			find: ["late-ok"],
			replace: ["late-bad"],
			gate: ["bash", "gates/late.sh"],
			signature: "[QK:SELFTEST-LATE]",
			signatureSource: "gates/late.sh",
		});
		const specC = fixtureSpec({
			claim: "SELFTEST-TAIL",
			subject: "tail.txt",
			find: ["tail-ok"],
			replace: ["tail-bad"],
			gate: ["bash", "gates/tail.sh"],
			signature: "[QK:SELFTEST-TAIL]",
			signatureSource: "gates/tail.sh",
		});
		const set = [specA, specB, specC];
		// The fixture's "runner group" (the role check-gate-manifests plays for real) is A.
		const current = () => currentCandidate(origin, set, specA.gate);
		let seq = 0;
		const measure = async (spec: MutantSpec): Promise<string> => {
			const file = path.join(tmpRoot, `r${seq++}.json`);
			await runGroupReceipt({
				repoDir: origin,
				selected: set,
				gate: spec.gate,
				receiptPath: file,
				log: quiet,
				logError: quiet,
				tmpRoot,
			});
			return file;
		};
		const compose = (files: string[], cur = current()) => composeLedger(files.map(loadReceipt), cur);
		const group = (l: ReturnType<typeof compose>, spec: MutantSpec) =>
			l.groups.find((g) => JSON.stringify(g.gate) === JSON.stringify(spec.gate));
		const hasBlocker = (l: ReturnType<typeof compose>, prefix: string) => l.blockers.some((b) => b.startsWith(prefix));

		// X1 (dirty): A green, B red (the late failure), C never run.
		const rA1 = await measure(specA);
		const rB1 = await measure(specB);
		const x1 = compose([rA1, rB1]);
		ok(
			"ledger X1: measured green, late red, unrun tail → RED; nothing CARRIED",
			x1.verdict === "RED" &&
				group(x1, specA)?.state === "MEASURED" &&
				group(x1, specB)?.state === "FAIL" &&
				group(x1, specC)?.state === "UNRUN" &&
				x1.counts.groups.CARRIED === 0 &&
				x1.summary.some((s) => s.includes("FAIL bash gates/late.sh") && s.includes("SELFTEST-LATE=SURVIVED")),
		);

		// The local fix: the late gate now detects its defect. New bytes → X2 (still dirty).
		wr(
			"gates/late.sh",
			'#!/usr/bin/env bash\nif grep -q late-bad late.txt; then echo "FAIL: late defect [QK:SELFTEST-LATE]" >&2; exit 1; fi\nexit 0\n',
		);
		const x2 = compose([rA1, rB1]);
		ok(
			"ledger X2 before rerun: A only c-core INHERITED, B's old red not current → NOT-QUALIFIED (dirty, runner group, red-unremeasured)",
			x2.verdict === "NOT-QUALIFIED" &&
				group(x2, specA)?.state === "INHERITED-UNVERIFIED" &&
				group(x2, specA)?.inheritKind === "c-core" &&
				group(x2, specB)?.state === "UNRUN" &&
				group(x2, specB)?.history[0].passed === false &&
				hasBlocker(x2, "candidate-dirty") &&
				hasBlocker(x2, "core-group-not-measured") &&
				hasBlocker(x2, "red-unremeasured: bash gates/late.sh"),
		);

		// Re-measure the fixed section, the never-run tail, then the runner group — not from 1.
		const rB2 = await measure(specB);
		const rC2 = await measure(specC);
		const rA2 = await measure(specA);
		const x2c = compose([rA1, rB1, rB2, rC2, rA2]);
		ok(
			"ledger X2 all exact-MEASURED but dirty → NOT-QUALIFIED with only the dirty blocker; B keeps its red in history",
			x2c.verdict === "NOT-QUALIFIED" &&
				x2c.counts.groups.MEASURED === 3 &&
				x2c.blockers.length === 1 &&
				hasBlocker(x2c, "candidate-dirty") &&
				(group(x2c, specB)?.history.filter((h) => !h.passed).length ?? 0) === 1,
		);

		// Commit the fixture: same content, new HEAD, clean porcelain → Y.
		const surfaceX2 = current().workSurfaceSha256;
		const headX2 = current().head;
		for (const args of [
			["add", "-A"],
			["-c", "commit.gpgsign=false", "commit", "-q", "-m", "fixture: late fix"],
		]) {
			const r = spawnSync("git", ["-C", origin, ...args], {
				stdio: "ignore",
				env: {
					...process.env,
					GIT_CONFIG_GLOBAL: "/dev/null",
					GIT_CONFIG_SYSTEM: "/dev/null",
					GIT_AUTHOR_NAME: "fx",
					GIT_AUTHOR_EMAIL: "fx@localhost",
					GIT_COMMITTER_NAME: "fx",
					GIT_COMMITTER_EMAIL: "fx@localhost",
				},
			});
			assert.equal(r.status, 0, `fixture git ${args.join(" ")} failed`);
		}
		const y = current();
		ok(
			"ledger commit: the same content committed keeps the work surface, moves HEAD, and is clean",
			y.workSurfaceSha256 === surfaceX2 && y.head !== headX2 && y.porcelainClean,
		);
		const y1 = compose([rA1, rB1, rB2, rC2, rA2], y);
		ok(
			"ledger Y from pre-commit receipts: content-identical provenance only, flagged; runner group not exact → NOT-QUALIFIED",
			y1.verdict === "NOT-QUALIFIED" &&
				y1.groups.every((g) => g.state === "MEASURED" && g.provenance === "content-identical") &&
				y1.groups.every((g) => g.flags.some((f) => f.startsWith("content-identical(head "))) &&
				y1.blockers.length === 1 &&
				hasBlocker(y1, "core-group-not-measured"),
		);
		const rA3 = await measure(specA);
		const y2 = compose([rA1, rB1, rB2, rC2, rA2, rA3], y);
		ok(
			"[QK:LEDGER-FLAG-BLOCKS-GREEN] ledger Y with the runner group exact but B/C content-identical → RISK-PENDING, never green",
			y2.verdict === "RISK-PENDING" &&
				group(y2, specA)?.provenance === "exact" &&
				y2.risks.filter((r) => r.includes("content-identical(head ")).length === 2 &&
				y2.summary.some((s) => s.includes("accepts nothing and authorizes no release")),
		);
		const rB3 = await measure(specB);
		const rC3 = await measure(specC);
		const y3 = compose([rA1, rB1, rB2, rC2, rA2, rA3, rB3, rC3], y);
		ok(
			"ledger Y all exact-MEASURED on the committed bytes → COMPOSITE-GREEN, labelled per-group (not the serial body)",
			y3.verdict === "COMPOSITE-GREEN" &&
				y3.groups.every((g) => g.provenance === "exact") &&
				y3.counts.claims.MEASURED === 3 &&
				y3.summary.some((s) => s.includes("not the serial full body")),
		);

		// ── pure negatives, each derived from a REAL receipt; `cur` is clean Y ──
		const cur = y;
		const text = (f: string): string => fs.readFileSync(f, "utf8");
		const reseal = (f: string, patch: (r: Record<string, unknown>) => void): string => {
			const { receiptSha256: _drop, ...body } = JSON.parse(text(f));
			patch(body);
			return JSON.stringify(sealReceipt(body));
		};
		const green = [rA3, rB3, rC3].map((f) => ({ source: f, text: text(f) }));
		const withA = (a: string) => [{ source: "forged", text: a }, green[1], green[2]];
		const invalidCode = (l: ReturnType<typeof composeLedger>) => l.invalid.map((i) => i.code);
		const all: ReturnType<typeof composeLedger>[] = [x1, x2, x2c, y1, y2, y3];
		const keep = (l: ReturnType<typeof composeLedger>) => {
			all.push(l);
			return l;
		};

		const dup = keep(composeLedger([...green, green[0]], cur));
		ok(
			"[QK:LEDGER-INVALID-BLOCKS-GREEN] ledger: a duplicated receipt beside all-exact-MEASURED groups is RED (fail-closed), never green",
			JSON.stringify(invalidCode(dup)) === '["R-DUPLICATE"]' &&
				dup.verdict === "RED" &&
				dup.counts.groups.MEASURED === 3,
		);
		const withBroken = keep(composeLedger([...green, { source: "broken", text: "{" }], cur));
		ok(
			"ledger: one broken receipt beside all-MEASURED groups → RED, the INVALID line kept",
			withBroken.verdict === "RED" && withBroken.summary.some((s) => s.startsWith("  INVALID broken: R-PARSE")),
		);
		const bad = keep(
			composeLedger(
				[
					{ source: "p", text: "{" },
					{
						source: "s",
						text: reseal(rA3, (b) => {
							b.schema = "other";
						}),
					},
					{
						source: "h",
						text: reseal(rA3, (b) => {
							delete b.result;
						}),
					},
					{ source: "d", text: text(rA3).replace('"verdict": "KILLED"', '"verdict": "SURVIVED"') },
				],
				cur,
			),
		);
		ok(
			"[QK:LEDGER-DIGEST-CHECKED] ledger: parse/schema/shape/digest failures are INVALID and count for nothing",
			JSON.stringify(invalidCode(bad)) === '["R-PARSE","R-SCHEMA","R-SHAPE","R-DIGEST"]' &&
				bad.counts.groups.UNRUN === 3 &&
				bad.verdict === "RED",
		);
		const forgedPass = reseal(rB1, (b) => {
			(b.result as { passed: boolean }).passed = true;
		});
		const dropped = reseal(rA3, (b) => {
			(b.result as { mutants: unknown[] }).mutants = [];
		});
		const unknown = reseal(rA3, (b) => {
			(b.group as { gate: string[] }).gate = ["bash", "gates/nope.sh"];
		});
		// A receipt whose seal moved but still claims passed: the candidate it measured
		// was not stable, so it can never count as a pass.
		const sealMovedPass = reseal(rA3, (b) => {
			(b.seal as { stable: boolean }).stable = false;
		});
		const inc = keep(
			composeLedger(
				[
					{ source: "fp", text: forgedPass },
					{ source: "dr", text: dropped },
					{ source: "uk", text: unknown },
					{ source: "sm", text: sealMovedPass },
				],
				cur,
			),
		);
		ok(
			"[QK:LEDGER-SEAL-IN-PASS-RECOMPUTE] ledger: a red re-labelled passed, mutants dropped, an unknown argv, a moved seal still claiming passed — all INVALID, never green",
			JSON.stringify(invalidCode(inc)) ===
				'["R-RESULT-INCONSISTENT","R-RESULT-INCONSISTENT","R-UNKNOWN-GROUP","R-RESULT-INCONSISTENT"]' &&
				inc.counts.groups.MEASURED === 0 &&
				inc.verdict === "RED",
		);
		const earlierRed = reseal(rA3, (b) => {
			const r = b.result as { passed: boolean; mutants: { verdict: string }[] };
			r.mutants[0].verdict = "SURVIVED";
			r.passed = false;
			b.startedAt = "2000-01-01T00:00:00.000Z";
		});
		const flaky = keep(composeLedger([...withA(earlierRed), green[0]], cur));
		ok(
			"ledger: red then green on identical bytes → MEASURED but flagged, RISK-PENDING (nondeterminism blocks green)",
			flaky.verdict === "RISK-PENDING" &&
				flaky.groups[0].state === "MEASURED" &&
				flaky.groups[0].flags.includes("red-then-green-same-candidate") &&
				flaky.groups[0].history.length === 2,
		);
		const aStarted = JSON.parse(text(rA3)).startedAt as string;
		const tieRed = reseal(rA3, (b) => {
			const r = b.result as { passed: boolean; mutants: { verdict: string }[] };
			r.mutants[0].verdict = "SURVIVED";
			r.passed = false;
			b.startedAt = aStarted;
		});
		const tie = keep(composeLedger([...withA(tieRed), green[0]], cur));
		ok(
			"ledger: two matching receipts at the same instant that disagree → FAIL `tie`, never an arbitrary pick",
			tie.verdict === "RED" && tie.groups[0].state === "FAIL" && tie.groups[0].reasons[0].startsWith("tie:"),
		);
		const drift = reseal(rA3, (b) => {
			(b.seal as { nodeModulesExcludedDrift: string[] }).nodeModulesExcludedDrift = [".vite/vitest/x/results.json"];
		});
		const dr = keep(composeLedger(withA(drift), cur));
		ok(
			"ledger: observed .vite drift flags cache-drift → RISK-PENDING, not green",
			dr.verdict === "RISK-PENDING" && dr.groups[0].state === "MEASURED" && dr.groups[0].flags.includes("cache-drift"),
		);

		// Seam 1 negatives: content identity needs a CLEAN candidate and the same environment.
		const dirtyY = keep(composeLedger([rA2, rB2, rC2].map(loadReceipt), { ...cur, porcelainClean: false }));
		ok(
			"ledger: same surface, different HEAD, but a DIRTY candidate → no content-identical, c-core INHERITED, NOT-QUALIFIED",
			dirtyY.verdict === "NOT-QUALIFIED" &&
				dirtyY.groups.every((g) => g.state === "INHERITED-UNVERIFIED" && g.inheritKind === "c-core") &&
				dirtyY.groups.every((g) => g.provenance === null) &&
				hasBlocker(dirtyY, "candidate-dirty"),
		);
		const nodeMoved = keep(composeLedger(green, { ...cur, coreSha256: "0".repeat(64) }));
		ok(
			"ledger: a different node/node_modules/C0 identity → every group c-core INHERITED, never CARRIED, NOT-QUALIFIED",
			nodeMoved.verdict === "NOT-QUALIFIED" &&
				nodeMoved.groups.every((g) => g.inheritKind === "c-core" && g.reasons[0].includes("core")) &&
				nodeMoved.counts.groups.CARRIED === 0,
		);
		// Seam 4: c-input must be re-measured; c-core/UNRUN are only named risks.
		const inputMoved = keep(
			composeLedger(green, {
				...cur,
				groups: cur.groups.map((g, i) =>
					i === 1 ? { ...g, declaredInputs: { ...g.declaredInputs, "gates/late.sh": "0".repeat(64) } } : g,
				),
			}),
		);
		ok(
			"ledger: a declared input moved (c-input) → blocker `re-measure`, NOT-QUALIFIED, not a risk to accept",
			inputMoved.verdict === "NOT-QUALIFIED" &&
				inputMoved.groups[1].inheritKind === "c-input" &&
				hasBlocker(inputMoved, "c-input: bash gates/late.sh"),
		);
		const surfaceOnlyB = reseal(rB3, (b) => {
			(b.candidate as { workSurfaceSha256: string }).workSurfaceSha256 = "0".repeat(64);
		});
		const riskOnly = keep(composeLedger([green[0], { source: "b-core", text: surfaceOnlyB }], cur));
		ok(
			"ledger: runner group exact, B only c-core, C unrun → RISK-PENDING listing exactly those risks",
			riskOnly.verdict === "RISK-PENDING" &&
				riskOnly.blockers.length === 0 &&
				riskOnly.risks.some((r) => r.startsWith("c-core: bash gates/late.sh")) &&
				riskOnly.risks.some((r) => r.startsWith("unrun: bash gates/tail.sh")),
		);
		const unresolved = keep(
			composeLedger(green, {
				...cur,
				groups: cur.groups.map((g, i) =>
					i === 0 ? { ...g, declaredInputs: { ...g.declaredInputs, "x.txt": "outside-repo" } } : g,
				),
			}),
		);
		ok(
			"ledger: an unresolved declared input (outside-repo/missing/link) can never be MEASURED-green",
			unresolved.verdict !== "COMPOSITE-GREEN" && unresolved.groups[0].state !== "MEASURED",
		);
		const specMoved = keep(
			composeLedger(green, {
				...cur,
				groups: cur.groups.map((g, i) => (i === 2 ? { ...g, specSetSha256: "0".repeat(64) } : g)),
			}),
		);
		ok(
			"ledger: a changed spec set INVALIDATES that group (UNRUN), not INHERITED; the others stay MEASURED",
			specMoved.groups[2].state === "UNRUN" &&
				specMoved.groups[0].state === "MEASURED" &&
				specMoved.verdict === "RISK-PENDING",
		);

		// Seam 2: an explicit input list is fail-closed.
		const listOf = (xs: { source: string; text: string }[]) =>
			xs.map((x) => `${createHash("sha256").update(x.text).digest("hex")}  ${x.source}`).join("\n");
		const expectOk = keep(composeLedger(green, cur, parseExpectedList(listOf(green))));
		const expectMissing = keep(composeLedger(green.slice(0, 2), cur, parseExpectedList(listOf(green))));
		const expectExtra = keep(composeLedger(green, cur, parseExpectedList(listOf(green.slice(0, 2)))));
		const expectDigest = keep(
			composeLedger(green, cur, parseExpectedList(listOf(green).replace(/^[0-9a-f]{64}/, "0".repeat(64)))),
		);
		ok(
			"ledger inputs: the declared list matches → no input error; missing / unexpected / altered input → RED",
			expectOk.verdict === "COMPOSITE-GREEN" &&
				expectOk.inputErrors.length === 0 &&
				expectOk.inputs.every((i) => i.provenance === "local-file") &&
				expectMissing.verdict === "RED" &&
				expectMissing.inputErrors.some((e) => e.startsWith("input-missing:")) &&
				expectExtra.verdict === "RED" &&
				expectExtra.inputErrors.some((e) => e.startsWith("input-unexpected:")) &&
				expectDigest.verdict === "RED" &&
				expectDigest.inputErrors.some((e) => e.startsWith("input-digest:")),
		);
		throws(
			"ledger inputs: a malformed expected-input line is refused",
			() => parseExpectedList("not-a-digest  x.json"),
			"is not `<sha256>  <path>`",
		);
		// Display: the UNRUN list may be compressed on the console only when the full ledger
		// is written somewhere; a RISK-PENDING without that path prints everything.
		const wide = {
			...cur,
			groups: [
				...cur.groups,
				...Array.from({ length: 7 }, (_, i) => ({
					gate: ["bash", `gates/fake-${i}.sh`],
					claims: [`FAKE-${i}`],
					specSetSha256: "0".repeat(64),
					declaredInputs: {},
				})),
			],
		};
		const wideFull = keep(composeLedger([green[0]], wide));
		const wideShort = keep(composeLedger([green[0]], wide, undefined, { ledgerPath: "/tmp/x-ledger.json" }));
		const unrunLines = (l: ReturnType<typeof composeLedger>) => l.summary.filter((s) => s.startsWith("  RISK unrun:"));
		ok(
			"ledger display: 9 unrun groups print in full without a ledger path, as one counted line naming it with one; nothing drops from risks/groups",
			wideFull.verdict === "RISK-PENDING" &&
				unrunLines(wideFull).length === 9 &&
				unrunLines(wideShort).length === 1 &&
				unrunLines(wideShort)[0].includes("9 groups") &&
				unrunLines(wideShort)[0].includes("full list: /tmp/x-ledger.json") &&
				wideShort.risks.filter((r) => r.startsWith("unrun: ")).length === 9 &&
				wideShort.groups.filter((g) => g.state === "UNRUN").length === 9,
		);
		ok(
			"ledger: no local composition above is FULL-GREEN or RISK-ACCEPTED, and CARRIED is never populated",
			all.every(
				(l) =>
					["RED", "NOT-QUALIFIED", "RISK-PENDING", "COMPOSITE-GREEN"].includes(l.verdict) &&
					l.counts.groups.CARRIED === 0 &&
					!l.summary.some((s) => /FULL-GREEN|RISK-ACCEPTED|\b788\/788\b/.test(s)),
			),
		);
	} finally {
		fs.rmSync(origin, { recursive: true, force: true });
		fs.rmSync(path.dirname(externalTarget), { recursive: true, force: true });
		fs.rmSync(tmpRoot, { recursive: true, force: true });
	}
}

// ═══ Phase 1c-r — the RELEASE composition over real CI-shaped collections (#124 step 2) ═
//
// Fixture origin committed twice (X1, then the late fix X2) on one first-parent chain.
// Collections are written by the production collectGroups with CI-shaped run ids; the
// pure composeRelease is then fed those files. Negatives derive from the same files.

{
	const tmpRoot = reclaimOnExit(fs.mkdtempSync(path.join(os.tmpdir(), "entwurf-release-selftest-")));
	const { dir: origin, externalTarget } = buildFixtureOrigin();
	try {
		const gitFx = (...args: string[]): string => {
			const r = spawnSync("git", ["-C", origin, ...args], {
				encoding: "utf8",
				env: {
					...process.env,
					GIT_CONFIG_GLOBAL: "/dev/null",
					GIT_CONFIG_SYSTEM: "/dev/null",
					GIT_AUTHOR_NAME: "fx",
					GIT_AUTHOR_EMAIL: "fx@localhost",
					GIT_COMMITTER_NAME: "fx",
					GIT_COMMITTER_EMAIL: "fx@localhost",
				},
			});
			assert.equal(r.status, 0, `fixture git ${args.join(" ")} failed: ${r.stderr}`);
			return r.stdout.trim();
		};
		const commit = (msg: string): string => {
			gitFx("add", "-A");
			gitFx("-c", "commit.gpgsign=false", "commit", "-q", "-m", msg);
			return gitFx("rev-parse", "HEAD");
		};
		const wr = (rel: string, body: string): void => fs.writeFileSync(path.join(origin, rel), body, { mode: 0o755 });
		wr("late.txt", "late-ok\n");
		wr("tail.txt", "tail-ok\n");
		wr("gates/late.sh", "#!/usr/bin/env bash\n# [QK:SELFTEST-LATE]\nexit 0\n");
		wr(
			"gates/tail.sh",
			'#!/usr/bin/env bash\nif grep -q tail-bad tail.txt; then echo "FAIL: tail defect [QK:SELFTEST-TAIL]" >&2; exit 1; fi\nexit 0\n',
		);
		const sA = fixtureSpec({});
		const sB = fixtureSpec({
			claim: "SELFTEST-LATE",
			subject: "late.txt",
			find: ["late-ok"],
			replace: ["late-bad"],
			gate: ["bash", "gates/late.sh"],
			signature: "[QK:SELFTEST-LATE]",
			signatureSource: "gates/late.sh",
		});
		const tailLike = (claim: string, extra: string[]) =>
			fixtureSpec({
				claim,
				subject: "tail.txt",
				find: ["tail-ok"],
				replace: ["tail-bad"],
				gate: ["bash", "gates/tail.sh", ...extra],
				signature: "[QK:SELFTEST-TAIL]",
				signatureSource: "gates/tail.sh",
			});
		const sC = tailLike("SELFTEST-TAIL", []);
		const sD = tailLike("SELFTEST-TAIL-D", ["d"]);
		const set = [sA, sB, sC, sD];
		const collectRun = async (name: string, runId: string, requested: MutantSpec[]) => {
			const dir = path.join(tmpRoot, name);
			await collectGroups({
				repoDir: origin,
				selected: set,
				requested: requested.map((m) => m.gate),
				collectDir: dir,
				log: quiet,
				logError: quiet,
				tmpRoot,
				coreGroupGate: sA.gate,
				env: { GITHUB_RUN_ID: runId, GITHUB_RUN_ATTEMPT: "1" },
			});
			return dir;
		};
		const asRun = (dir: string, headSha: string, runId: string, runAttempt = "1"): CiRun => ({
			runId,
			runAttempt,
			headSha,
			files: Object.fromEntries(fs.readdirSync(dir).map((f) => [f, fs.readFileSync(path.join(dir, f))])),
		});
		const editCollection = (run: CiRun, patch: (c: Record<string, any>) => void): CiRun => {
			const c = JSON.parse(run.files["collection.json"].toString("utf8"));
			patch(c);
			return { ...run, files: { ...run.files, "collection.json": Buffer.from(JSON.stringify(c)) } };
		};

		// X1: the late gate is weak → B red. Two CI runs at X1 (one without D).
		const x1 = commit("X1");
		const d100 = await collectRun("r100", "100", [sA, sB, sC, sD]);
		const d101 = await collectRun("r101", "101", [sA, sB, sC]);
		const firstParentX1 = gitFx("rev-list", "--first-parent", "HEAD").split("\n");
		const independentX1 = currentCandidate(origin, set, sA.gate);
		// X2: the late fix, committed. Run 200 re-measures runner + the red group; 201 only the runner.
		wr(
			"gates/late.sh",
			'#!/usr/bin/env bash\nif grep -q late-bad late.txt; then echo "FAIL: late defect [QK:SELFTEST-LATE]" >&2; exit 1; fi\nexit 0\n',
		);
		const x2 = commit("X2 late fix");
		const d200 = await collectRun("r200", "200", [sA, sB]);
		const d201 = await collectRun("r201", "201", [sA]);
		const d202 = await collectRun("r202", "202", [sA, sB, sC, sD]);
		const firstParent = gitFx("rev-list", "--first-parent", "HEAD").split("\n");
		const independent = currentCandidate(origin, set, sA.gate);
		const r100 = asRun(d100, x1, "100");
		const r101 = asRun(d101, x1, "101");
		const r200 = asRun(d200, x2, "200");
		const r201 = asRun(d201, x2, "201");
		const r202 = asRun(d202, x2, "202");
		const release = (runs: CiRun[], over: Partial<ReleaseInput> = {}) =>
			composeRelease({ finalSha: x2, firstParent, runs, independent, operatorDeclared: [], ...over });
		const groupOf = (l: ReturnType<typeof composeRelease>, s: MutantSpec) =>
			l.groups.find((g) => JSON.stringify(g.gate) === JSON.stringify(s.gate));
		const verdicts: string[] = [];
		const seen = (l: ReturnType<typeof composeRelease>) => {
			verdicts.push(l.verdict);
			return l;
		};

		// 680-shaped: red at X1, fixed and re-measured at X2; C and D only inherited.
		const good = seen(release([r100, r200]));
		ok(
			"[QK:RELEASE-RED-REMEASURED-CLEARS] release 680: ancestor red re-measured green on the final SHA → FAIL 0, red kept in history, C/D c-core → RISK-PENDING",
			good.verdict === "RISK-PENDING" &&
				good.counts.groups.FAIL === 0 &&
				groupOf(good, sB)?.state === "MEASURED" &&
				groupOf(good, sB)?.provenance === "exact" &&
				(groupOf(good, sB)?.history.some((h) => !h.passed) ?? false) &&
				groupOf(good, sC)?.inheritKind === "c-core" &&
				good.release.required.length === 2 &&
				good.release.denominator.measuredOnFinal.groups === 2 &&
				good.release.denominator.inheritedCore.every((i) => i.from?.runId === "100") &&
				good.release.denominator.groups === 4,
		);
		const notRemeasured = seen(release([r100, r201]));
		ok(
			"release: the newest red (X1) NOT re-measured on the final SHA → required-not-measured, NOT-QUALIFIED",
			notRemeasured.verdict === "NOT-QUALIFIED" &&
				notRemeasured.blockers.some((b) => b.startsWith("required-not-measured: bash gates/late.sh")),
		);
		const skipped = seen(release([r101, r200]));
		ok(
			"[QK:RELEASE-UNRUN-BLOCKS] release: a group with no pass receipt anywhere in the chain (D skipped) → NOT-QUALIFIED",
			skipped.verdict === "NOT-QUALIFIED" &&
				skipped.blockers.some((b) => b.startsWith("unrun (release): bash gates/tail.sh d")),
		);
		const specNow = "0".repeat(64);
		const specDrift = seen(
			release([r100, editCollection(r200, (c) => (c.candidate.groups[2].specSetSha256 = specNow))], {
				independent: {
					...independent,
					groups: independent.groups.map((g, i) => (i === 2 ? { ...g, specSetSha256: specNow } : g)),
				},
			}),
		);
		ok(
			"release: C's spec set changed since its only pass → C UNRUN, NOT-QUALIFIED (re-measure)",
			specDrift.verdict === "NOT-QUALIFIED" && groupOf(specDrift, sC)?.state === "UNRUN",
		);
		const dupAttempt = seen(release([r100, r200, r200]));
		const r200b = editCollection({ ...r200, runAttempt: "2" }, (c) => {
			c.runAttempt = "2";
		});
		// Both input orders: the newer attempt must win by (runId, runAttempt), not by position.
		const retried = seen(release([r100, r200b, r200]));
		const retriedRev = seen(release([r100, r200, r200b]));
		ok(
			"[QK:RELEASE-NEWEST-ATTEMPT-WINS] release: the same run attempt twice → RED; a newer runAttempt supersedes the older in either input order, which is listed, never mixed",
			dupAttempt.verdict === "RED" &&
				dupAttempt.release.contractErrors.some((e) => e.includes("supplied twice")) &&
				[retried, retriedRev].every(
					(l) =>
						l.verdict === "RISK-PENDING" &&
						l.release.used.some((u) => u.runId === "200" && u.runAttempt === "2") &&
						l.release.excluded.some(
							(e) => e.runId === "200" && e.runAttempt === "1" && e.reason.startsWith("superseded"),
						),
				),
		);
		const noFinal = seen(release([r100]));
		const incompleteFinal = seen(
			release([
				r100,
				{ ...r200, files: Object.fromEntries(Object.entries(r200.files).filter(([f]) => f !== "g001.json")) },
			]),
		);
		const incompleteAncestor = seen(
			release([
				{ ...r100, files: Object.fromEntries(Object.entries(r100.files).filter(([f]) => f !== "g003.json")) },
				r200,
			]),
		);
		ok(
			"[QK:RELEASE-FINAL-COLLECTION-REQUIRED] release: no final-SHA collection → RED; an incomplete final collection → RED",
			noFinal.verdict === "RED" &&
				noFinal.release.contractErrors.some((e) => e.startsWith("no CI collection at the final SHA")) &&
				incompleteFinal.verdict === "RED" &&
				incompleteFinal.release.contractErrors.some((e) => e.startsWith("final-SHA collection incomplete")),
		);
		ok(
			"release: an incomplete ANCESTOR collection is excluded from the basis with its reason (its groups fall to UNRUN)",
			incompleteAncestor.verdict === "NOT-QUALIFIED" &&
				incompleteAncestor.release.excluded.some(
					(e) => e.runId === "100" && e.reason.startsWith("incomplete ancestor"),
				),
		);
		const offChain = seen(release([r100, r200, { ...r201, headSha: "f".repeat(40) }]));
		const local = seen(release([r100, { ...r200, runId: "local" }]));
		const lies = seen(release([r100, editCollection(r200, (c) => (c.runId = "999"))]));
		ok(
			"[QK:RELEASE-INPUT-CONTRACT] release: a run off the first-parent chain, a non-CI run id, a collection naming another run → each RED",
			offChain.verdict === "RED" &&
				offChain.release.contractErrors.some((e) => e.includes("not on the first-parent chain")) &&
				local.verdict === "RED" &&
				local.release.contractErrors.some((e) => e.includes("not CI provenance")) &&
				lies.verdict === "RED" &&
				lies.release.contractErrors.some((e) => e.includes("the collection records run 999")),
		);
		const crossed = seen(release([r100, r200], { independent: { ...independent, workSurfaceSha256: "0".repeat(64) } }));
		const coreFileCrossed = seen(
			release([r100, r200], {
				independent: { ...independent, coreFiles: { ...independent.coreFiles, "run.sh": "0".repeat(64) } },
			}),
		);
		ok(
			"[QK:RELEASE-CANDIDATE-CROSS-CHECKED] release: a CI-claimed surface or CORE_FILES the final tree contradicts → RED CROSS-CHECK",
			crossed.verdict === "RED" &&
				crossed.release.crossCheck.includes("workSurface") &&
				coreFileCrossed.verdict === "RED" &&
				coreFileCrossed.release.crossCheck.includes("coreFiles"),
		);
		// Environment drift: the ancestor run's runner had another node/node_modules. Rewrite
		// its core witness consistently (receipts resealed, digests re-declared) — the
		// ancestor stays a valid basis, and its groups inherit only as c-core with `core` named.
		const otherCore = "e".repeat(64);
		const rewriteCore = (run: CiRun): CiRun => {
			const c = JSON.parse(run.files["collection.json"].toString("utf8"));
			c.candidate.coreSha256 = otherCore;
			const files: Record<string, Buffer> = {};
			for (const a of c.attempted) {
				const { receiptSha256: _d, ...body } = JSON.parse(run.files[a.file].toString("utf8"));
				body.core.sha256 = otherCore;
				const text = Buffer.from(JSON.stringify(sealReceipt(body)));
				files[a.file] = text;
				a.sha256 = createHash("sha256").update(text).digest("hex");
			}
			files["collection.json"] = Buffer.from(JSON.stringify(c));
			return { ...run, files };
		};
		const envDrift = seen(release([rewriteCore(r100), r200]));
		ok(
			"release: an ancestor from a different runner environment → its groups c-core with `core` in the reason; RISK-PENDING, never green",
			envDrift.verdict === "RISK-PENDING" &&
				envDrift.release.denominator.inheritedCore.length === 2 &&
				envDrift.release.denominator.inheritedCore.every((i) => i.reason.includes("core")),
		);
		// F1 (#124 review): the pure composer must not invent a clean candidate. Same runs, same
		// CI witness, same surface — only the independent candidate's porcelain differs.
		const greenAll = seen(release([r100, r202]));
		const dirtyGreen = seen(release([r100, r202], { independent: { ...independent, porcelainClean: false } }));
		ok(
			"[QK:RELEASE-DIRTY-NOT-INVENTED] release: every group exact-MEASURED is COMPOSITE-GREEN only on a clean candidate; the same evidence on a dirty one → NOT-QUALIFIED candidate-dirty",
			greenAll.verdict === "COMPOSITE-GREEN" &&
				dirtyGreen.verdict === "NOT-QUALIFIED" &&
				dirtyGreen.blockers.some((b) => b.startsWith("candidate-dirty")),
		);
		// F2 (#124 review): a COMPLETE collection is an inventory. Its red middle group makes the
		// composition RED, and the tail measured after that failure is kept as evidence.
		const atX1 = seen(
			composeRelease({
				finalSha: x1,
				firstParent: firstParentX1,
				runs: [r100],
				independent: independentX1,
				operatorDeclared: [],
			}),
		);
		ok(
			"[QK:RELEASE-COMPLETE-RED-IS-RED] release: a COMPLETE collection with a red middle group and green tail → RED, B FAIL, C/D MEASURED — collection completion is never a verdict",
			checkCollectionData(mapReader(r100.files), Object.keys(r100.files).sort()).errors.length === 0 &&
				atX1.verdict === "RED" &&
				groupOf(atX1, sB)?.state === "FAIL" &&
				groupOf(atX1, sC)?.state === "MEASURED" &&
				groupOf(atX1, sD)?.state === "MEASURED",
		);
		const declared = seen(release([r100, r200], { operatorDeclared: [sC.gate] }));
		ok(
			"release: an operator-declared group must be exact-MEASURED on the final SHA → NOT-QUALIFIED until it is",
			declared.verdict === "NOT-QUALIFIED" &&
				declared.blockers.some((b) => b.startsWith("required-not-measured: bash gates/tail.sh")),
		);

		// ── the acceptance RECORD over these real ledgers (#124 P2) ──
		// A consistent record is a bookkeeping fact about bytes, never an acceptance: the
		// positive is `good` (real X1→X2 receipts); each negative isolates ONE guard.
		type RL = ReturnType<typeof composeRelease>;
		const recordFor = (l: RL, over: Record<string, unknown> = {}) => ({
			schema: ACCEPTANCE_SCHEMA,
			finalSha: l.release.finalSha,
			ledgerSha256: sha256(canonicalJson(l)),
			risks: [...l.risks],
			required: l.release.required,
			utterance: "C/D c-core 위험을 알고 받아들인다",
			acceptedOn: "2026-09-29",
			transcribedBy: "claudecode/opus (test fixture)",
			...over,
		});
		const accepted = checkAcceptanceRecord(good, recordFor(good));
		ok(
			"acceptance: a record naming the real RISK-PENDING ledger exactly → RECORD-CONSISTENT (statement not authenticated), never an acceptance class",
			accepted.outcome === RECORD_CONSISTENT &&
				accepted.errors.length === 0 &&
				good.risks.length >= 2 &&
				good.candidate.head === x2 &&
				!String(accepted.outcome).includes("ACCEPTED") &&
				!String(accepted.outcome).includes("GREEN"),
		);
		const refused = (l: RL, rec: unknown, naming: string) => {
			const r = checkAcceptanceRecord(l, rec);
			return r.outcome === "REFUSED" && r.errors.some((e) => e.includes(naming));
		};
		const onlyVerdict: RL = { ...good, verdict: "NOT-QUALIFIED" };
		ok(
			"[QK:ACCEPT-ONLY-RISK-PENDING] acceptance: the real ledger with ONLY its verdict set to NOT-QUALIFIED (digest consistent) → REFUSED; real RED and real COMPOSITE-GREEN → REFUSED",
			refused(onlyVerdict, recordFor(onlyVerdict), "not RISK-PENDING") &&
				checkAcceptanceRecord(onlyVerdict, recordFor(onlyVerdict)).errors.length === 1 &&
				refused(noFinal, recordFor(noFinal), "not RISK-PENDING") &&
				refused(greenAll, recordFor(greenAll), "not RISK-PENDING") &&
				refused(notRemeasured, recordFor(notRemeasured), "not RISK-PENDING"),
		);
		const cIdx = good.groups.findIndex((g) => JSON.stringify(g.gate) === JSON.stringify(sC.gate));
		const cRisk = good.risks.findIndex((r) => r.startsWith(`c-core: ${sC.gate.join(" ")} `));
		const forgedUnrun: RL = {
			...good,
			groups: good.groups.map((g, i) =>
				i === cIdx ? { ...g, state: "UNRUN" as const, inheritKind: null, reasons: [] } : g,
			),
			risks: good.risks.map((r, i) =>
				i === cRisk ? `unrun: ${sC.gate.join(" ")} (${good.groups[cIdx].claims.length} claims)` : r,
			),
		};
		const forgedDirty: RL = { ...good, candidate: { ...good.candidate, porcelainClean: false } };
		ok(
			"[QK:ACCEPT-REFUSAL-REDERIVED] acceptance: a RISK-PENDING ledger with its blockers stripped — an UNRUN group, or a dirty candidate (risks/digest/record consistent) → REFUSED from its own groups and candidate",
			cIdx >= 0 &&
				cRisk >= 0 &&
				refused(forgedUnrun, recordFor(forgedUnrun), "UNRUN") &&
				checkAcceptanceRecord(forgedUnrun, recordFor(forgedUnrun)).errors.length === 1 &&
				refused(forgedDirty, recordFor(forgedDirty), "dirty") &&
				checkAcceptanceRecord(forgedDirty, recordFor(forgedDirty)).errors.length === 1,
		);
		const moreSummary: RL = { ...good, summary: [...good.summary, "  a line added after the record was written"] };
		ok(
			"[QK:ACCEPT-DIGEST-RECOMPUTED] acceptance: one summary line added to the ledger after the record named it → REFUSED on the recomputed digest alone",
			refused(moreSummary, recordFor(good), "recomputed digest") &&
				checkAcceptanceRecord(moreSummary, recordFor(good)).errors.length === 1,
		);
		const reordered = recordFor(good, { risks: [...good.risks].reverse() });
		ok(
			"[QK:ACCEPT-RISKS-EXACT] acceptance: the ledger's risks in another order → REFUSED (order is part of what was accepted)",
			good.risks[0] !== good.risks[good.risks.length - 1] &&
				refused(good, reordered, "order and duplicates") &&
				checkAcceptanceRecord(good, reordered).errors.length === 1,
		);
		const dropped: RL = { ...good, risks: good.risks.slice(1) };
		ok(
			"[QK:ACCEPT-RISKS-REDERIVED] acceptance: a ledger whose risk list drops one its own groups imply (record and digest consistent with it) → REFUSED",
			refused(dropped, recordFor(dropped), "its own groups imply") &&
				checkAcceptanceRecord(dropped, recordFor(dropped)).errors.length === 1,
		);
		ok(
			"[QK:ACCEPT-DATE-REAL] acceptance: a date-shaped but unreal acceptedOn (2026-02-30) → REFUSED",
			refused(good, recordFor(good, { acceptedOn: "2026-02-30" }), "not a real date") &&
				checkAcceptanceRecord(good, recordFor(good, { acceptedOn: "2026-02-28" })).outcome === RECORD_CONSISTENT,
		);
		ok(
			"acceptance: an authentication-shaped key, a missing key, another final SHA, other required groups, a blank utterance, a bad date shape → each REFUSED",
			refused(good, { ...recordFor(good), authenticated: true }, "keys must be exactly") &&
				refused(good, (({ transcribedBy: _t, ...rest }) => rest)(recordFor(good)), "keys must be exactly") &&
				refused(good, recordFor(good, { finalSha: x1 }), "final SHA") &&
				refused(good, recordFor(good, { required: [sA.gate] }), "required groups") &&
				refused(good, recordFor(good, { utterance: "  " }), "utterance") &&
				refused(good, recordFor(good, { acceptedOn: "2026-9-29" }), "YYYY-MM-DD") &&
				refused(good, null, "not an object"),
		);
		ok(
			"release: no composition produced an acceptance class — only RED / NOT-QUALIFIED / RISK-PENDING / COMPOSITE-GREEN",
			verdicts.every((v) => ["RED", "NOT-QUALIFIED", "RISK-PENDING", "COMPOSITE-GREEN"].includes(v)),
		);
	} finally {
		fs.rmSync(origin, { recursive: true, force: true });
		fs.rmSync(path.dirname(externalTarget), { recursive: true, force: true });
		fs.rmSync(tmpRoot, { recursive: true, force: true });
	}
}

// ═══ Phase 1c-a — admitting ONE CI collection artifact, offline (#124 stage 3a) ═
//
// A real fixture collection, zipped by the host's own Python zipfile (fixture only — the
// module reads zips with Node's built-in zlib), fed with injected GitHub-shaped artifact
// metadata. Every refusal is a named error; nothing is extracted to disk.

{
	const tmpRoot = reclaimOnExit(fs.mkdtempSync(path.join(os.tmpdir(), "entwurf-artifact-selftest-")));
	const { dir: origin, externalTarget } = buildFixtureOrigin();
	try {
		const sA = fixtureSpec({});
		const collDir = path.join(tmpRoot, "r300");
		await collectGroups({
			repoDir: origin,
			selected: [sA],
			requested: [sA.gate],
			collectDir: collDir,
			log: quiet,
			logError: quiet,
			tmpRoot,
			coreGroupGate: sA.gate,
			env: { GITHUB_RUN_ID: "300", GITHUB_RUN_ATTEMPT: "1" },
		});
		const head = spawnSync("git", ["-C", origin, "rev-parse", "HEAD"], { encoding: "utf8" }).stdout.trim();
		const good: Record<string, Buffer> = Object.fromEntries(
			fs.readdirSync(collDir).map((f) => [f, fs.readFileSync(path.join(collDir, f))]),
		);
		type Entry = { name: string; data: Buffer; kind?: "symlink" | "dir" };
		// Zip with the host's Python zipfile: names, symlinks, directories and duplicates exactly as given.
		const zipOf = (entries: Entry[]): Buffer => {
			const spec = entries.map((e) => ({ name: e.name, data: e.data.toString("base64"), kind: e.kind ?? "file" }));
			const r = spawnSync(
				"python3",
				[
					"-c",
					[
						"import sys, json, base64, io, zipfile, warnings",
						"warnings.simplefilter('ignore')",
						"out = io.BytesIO()",
						"with zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED) as z:",
						"    for e in json.load(sys.stdin):",
						"        i = zipfile.ZipInfo(e['name']); i.create_system = 3",
						"        i.external_attr = {'symlink': 0o120777, 'dir': 0o040755}.get(e['kind'], 0o100644) << 16",
						"        i.compress_type = zipfile.ZIP_DEFLATED",
						"        z.writestr(i, base64.b64decode(e['data']))",
						"sys.stdout.write(base64.b64encode(out.getvalue()).decode())",
					].join("\n"),
				],
				{ input: JSON.stringify(spec), encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
			);
			assert.equal(r.status, 0, `fixture zip failed: ${r.stderr}`);
			return Buffer.from(r.stdout, "base64");
		};
		const entriesOf = (files: Record<string, Buffer>): Entry[] =>
			Object.entries(files).map(([name, data]) => ({ name, data }));
		const meta = (zip: Buffer, over: Partial<ApiArtifact> = {}): ApiArtifact => ({
			id: 1,
			name: artifactName("300", "1"),
			digest: `sha256:${createHash("sha256").update(zip).digest("hex")}`,
			expired: false,
			workflow_run: { id: 300, head_sha: head },
			...over,
		});
		const admit = (zip: Buffer, over: Partial<ArtifactInput> = {}, metaOver: Partial<ApiArtifact> = {}) =>
			admitArtifact({ runId: "300", runAttempt: "1", headSha: head, artifact: meta(zip, metaOver), zip, ...over });
		const goodZip = zipOf(entriesOf(good));
		const cur = currentCandidate(origin, [sA], sA.gate);

		const ok0 = admit(goodZip, { independentCoreFiles: cur.coreFiles });
		ok(
			"artifact: a real collection zipped, its digest recorded → admitted with no error; node/node_modules labelled a CI witness",
			ok0.errors.length === 0 && ok0.collection?.runId === "300" && ok0.witness.includes("CI-witnessed"),
		);
		const sel0 = selectArtifact([], "300", "1");
		const sel2 = selectArtifact([meta(goodZip), meta(goodZip, { id: 2 })], "300", "1");
		ok(
			"[QK:ARTIFACT-SELECT-EXACTLY-ONE] artifact: zero or two artifacts with the run's name are each refused, never picked from",
			!sel0.ok &&
				sel0.errors[0].startsWith("artifact-select: 0") &&
				!sel2.ok &&
				sel2.errors[0].startsWith("artifact-select: 2"),
		);
		const digestBad = admit(goodZip, {}, { digest: `sha256:${"0".repeat(64)}` });
		const expired = admit(goodZip, {}, { expired: true });
		const otherRun = admit(goodZip, {}, { workflow_run: { id: 301, head_sha: head } });
		const otherHead = admit(goodZip, {}, { workflow_run: { id: 300, head_sha: "f".repeat(40) } });
		ok(
			"[QK:ARTIFACT-DIGEST-CHECKED] artifact: a digest that is not the zip's sha256, an expired artifact, another run, another SHA → each named",
			digestBad.errors.some((e) => e.startsWith("artifact-digest:")) &&
				expired.errors.includes("artifact-expired: the evidence is gone") &&
				otherRun.errors.some((e) => e.startsWith("artifact-run:")) &&
				otherHead.errors.some((e) => e.startsWith("artifact-head:")) &&
				[digestBad, expired, otherRun, otherHead].every((r) => r.files === null),
		);
		const withEntry = (extra: Entry) => admit(zipOf([...entriesOf(good), extra]));
		const dotdot = withEntry({ name: "../g001.json", data: good["g000.json"] });
		const absolute = withEntry({ name: "/g001.json", data: good["g000.json"] });
		const link = withEntry({ name: "g001.json", data: Buffer.from("/etc/passwd"), kind: "symlink" });
		const dir = withEntry({ name: "g001.json/", data: Buffer.alloc(0), kind: "dir" });
		const dup = withEntry({ name: "g000.json", data: good["g000.json"] });
		const stray = withEntry({ name: "notes.txt", data: Buffer.from("x") });
		const big = withEntry({ name: "g001.json", data: Buffer.alloc(9 * 1024 * 1024) });
		ok(
			"[QK:ARTIFACT-ZIP-CONFINED] artifact: `../`, absolute, symlink, directory, duplicate, foreign-named and oversize entries → each a named zip error",
			dotdot.errors.some((e) => e.startsWith('zip-name: "../g001.json"')) &&
				absolute.errors.some((e) => e.startsWith('zip-name: "/g001.json"')) &&
				link.errors.includes('zip-symlink: "g001.json"') &&
				dir.errors.includes('zip-directory: "g001.json/"') &&
				dup.errors.includes('zip-duplicate: "g000.json"') &&
				stray.errors.some((e) => e.startsWith('zip-name: "notes.txt"')) &&
				big.errors.some((e) => e.startsWith('zip-oversize: "g001.json"')) &&
				[dotdot, absolute, link, dir, dup, stray, big].every((r) => r.files === null),
		);
		// Structure: a byte-level mutator over a real zip (host Python, fixture only). Each
		// mutated archive gets its digest re-declared, so only the reader can refuse it.
		const mutateZip = (zip: Buffer, op: string, arg = 0): Buffer => {
			const r = spawnSync(
				"python3",
				[
					"-c",
					[
						"import sys, base64, struct",
						"b = bytearray(base64.b64decode(sys.stdin.read())); op = sys.argv[1]; arg = int(sys.argv[2])",
						"e = b.rfind(b'PK\\x05\\x06')",
						"if op == 'count': struct.pack_into('<HH', b, e + 8, arg, arg)",
						"elif op == 'trailing': b += b'X' * arg",
						"elif op == 'comment': struct.pack_into('<H', b, e + 20, arg)",
						"elif op == 'disk': struct.pack_into('<H', b, e + 4, arg)",
						"elif op == 'drop-first-central':",
						"    n, size, off = struct.unpack_from('<HII', b, e + 10)",
						"    nl, xl, cl = struct.unpack_from('<HHH', b, off + 28); rec = 46 + nl + xl + cl",
						"    del b[off:off + rec]; e -= rec",
						"    struct.pack_into('<HHII', b, e + 8, n - 1, n - 1, size - rec, off)",
						"sys.stdout.write(base64.b64encode(bytes(b)).decode())",
					].join("\n"),
					op,
					String(arg),
				],
				{ input: zip.toString("base64"), encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
			);
			assert.equal(r.status, 0, `fixture zip mutation ${op} failed: ${r.stderr}`);
			return Buffer.from(r.stdout, "base64");
		};
		const withStray = zipOf([...entriesOf(good), { name: "notes.txt", data: Buffer.from("stray") }]);
		const strayFirst = zipOf([{ name: "notes.txt", data: Buffer.from("stray") }, ...entriesOf(good)]);
		const lowCount = admit(mutateZip(withStray, "count", Object.keys(good).length));
		const trailing = admit(mutateZip(goodZip, "trailing", 7));
		const commentLie = admit(mutateZip(goodZip, "comment", 5));
		const multiDisk = admit(mutateZip(goodZip, "disk", 1));
		const hiddenLocal = admit(mutateZip(strayFirst, "drop-first-central"));
		const huge = admit(Buffer.alloc(81 * 1024 * 1024));
		const fmt = (r: ReturnType<typeof admit>, text: string) =>
			r.files === null && r.errors.length === 1 && r.errors[0].startsWith("zip-") && r.errors[0].includes(text);
		ok(
			"[QK:ARTIFACT-ZIP-STRUCTURE] artifact: a lowered EOCD entry count hiding a listed entry, trailing bytes, a lying comment length, a multi-disk EOCD, an unlisted local entry, an 81MiB archive → each refused by structure before any content",
			fmt(lowCount, "not covered by its entry count") &&
				fmt(trailing, "does not end the archive") &&
				fmt(commentLie, "does not end the archive") &&
				fmt(multiDisk, "multi-disk") &&
				fmt(hiddenLocal, "unlisted bytes") &&
				fmt(huge, "zip-oversize: archive"),
		);
		// Independent observation only (not a safety proof): the host's Python zipfile lists
		// the same names our reader admits for the well-formed archive.
		const pyNames = spawnSync(
			"python3",
			[
				"-c",
				"import sys, io, zipfile, base64, json; print(json.dumps(sorted(zipfile.ZipFile(io.BytesIO(base64.b64decode(sys.stdin.read()))).namelist()), separators=(',', ':')))",
			],
			{ input: goodZip.toString("base64"), encoding: "utf8" },
		);
		ok(
			"artifact: Python zipfile (observation, not proof) lists the same names our reader admits for the real collection zip",
			pyNames.status === 0 && pyNames.stdout.trim() === JSON.stringify(Object.keys(ok0.files ?? {}).sort()),
		);
		const coreWithout = (patch: (core: Record<string, unknown>) => void) => {
			const { receiptSha256: _d, ...body } = JSON.parse(good["g000.json"].toString("utf8"));
			patch(body.core);
			const text = Buffer.from(JSON.stringify(sealReceipt(body)));
			const c = JSON.parse(good["collection.json"].toString("utf8"));
			c.attempted[0].sha256 = createHash("sha256").update(text).digest("hex");
			return admit(zipOf(entriesOf({ ...good, "g000.json": text, "collection.json": Buffer.from(JSON.stringify(c)) })));
		};
		const noNode = coreWithout((core) => {
			delete core.node;
		});
		const nmFields = coreWithout((core) => {
			delete (core.nodeModules as Record<string, unknown>).files;
		});
		ok(
			"[QK:ARTIFACT-CORE-SHAPE] artifact: a receipt whose core lacks node identity, or whose nodeModules lacks a field → core-shape, never a CI witness",
			noNode.errors.includes("core-shape: g000.json core.node") &&
				nmFields.errors.includes("core-shape: g000.json core.nodeModules") &&
				noNode.files === null &&
				nmFields.files === null,
		);
		const undeclared = withEntry({ name: "g007.json", data: good["g000.json"] });
		const missing = admit(zipOf(entriesOf(good).filter((e) => e.name !== "g000.json")));
		ok(
			"artifact: an allowed-looking but undeclared receipt, and a declared receipt missing from the zip → collection errors",
			undeclared.errors.includes("collection-extra: g007.json") &&
				missing.errors.some((e) => e.startsWith("collection-missing:")),
		);
		const attempt2 = admitArtifact({
			runId: "300",
			runAttempt: "2",
			headSha: head,
			artifact: { ...meta(goodZip), name: artifactName("300", "2") },
			zip: goodZip,
		});
		ok(
			"artifact: an artifact for attempt 2 whose collection records attempt 1 → collection-run mismatch",
			attempt2.errors.some((e) => e.startsWith("collection-run: records 300#1")),
		);
		// core.files edited, core.sha256 left as it was, receipt resealed and re-declared: only
		// recomputing the core from its own parts can see it.
		const tampered = (() => {
			const { receiptSha256: _d, ...body } = JSON.parse(good["g000.json"].toString("utf8"));
			body.core.files = { ...body.core.files, "run.sh": "0".repeat(64) };
			const text = Buffer.from(JSON.stringify(sealReceipt(body)));
			const c = JSON.parse(good["collection.json"].toString("utf8"));
			c.attempted[0].sha256 = createHash("sha256").update(text).digest("hex");
			return { ...good, "g000.json": text, "collection.json": Buffer.from(JSON.stringify(c)) };
		})();
		const coreBad = admit(zipOf(entriesOf(tampered)));
		const filesBad = admit(goodZip, {
			independentCoreFiles: { ...(cur.coreFiles ?? {}), "run.sh": "0".repeat(64) },
		});
		ok(
			"[QK:ARTIFACT-CORE-RECOMPUTED] artifact: core.sha256 not the hash of its own parts, or CORE_FILES unlike the final tree → named core errors",
			coreBad.errors.some((e) => e.startsWith("core-inconsistent: g000.json")) &&
				filesBad.errors.some((e) => e.startsWith("core-files-mismatch: g000.json")),
		);
	} finally {
		fs.rmSync(origin, { recursive: true, force: true });
		fs.rmSync(path.dirname(externalTarget), { recursive: true, force: true });
		fs.rmSync(tmpRoot, { recursive: true, force: true });
	}
}

// ═══ Phase 1c-h — the GitHub API boundary over injected fixtures (#124 stage 3b) ═
//
// No network: a GhApi built from a path→value map. The collection, its receipt and its
// zip are real (production collectGroups + the host's Python zipfile); the run, job and
// artifact metadata are GitHub-shaped fixtures. Real GitHub zip layout: UNOBSERVED.

{
	const tmpRoot = reclaimOnExit(fs.mkdtempSync(path.join(os.tmpdir(), "entwurf-gh-selftest-")));
	const { dir: origin, externalTarget } = buildFixtureOrigin();
	try {
		const sA = fixtureSpec({});
		const repo = "owner/entwurf";
		const collDir = path.join(tmpRoot, "r400");
		await collectGroups({
			repoDir: origin,
			selected: [sA],
			requested: [sA.gate],
			collectDir: collDir,
			log: quiet,
			logError: quiet,
			tmpRoot,
			coreGroupGate: sA.gate,
			env: { GITHUB_RUN_ID: "400", GITHUB_RUN_ATTEMPT: "1" },
		});
		const sha = spawnSync("git", ["-C", origin, "rev-parse", "HEAD"], { encoding: "utf8" }).stdout.trim();
		const cur = currentCandidate(origin, [sA], sA.gate);
		const zr = spawnSync(
			"python3",
			[
				"-c",
				"import sys, os, io, zipfile, base64\nd = sys.argv[1]; out = io.BytesIO()\nwith zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED) as z:\n    for n in sorted(os.listdir(d)): z.write(os.path.join(d, n), n)\nsys.stdout.write(base64.b64encode(out.getvalue()).decode())",
				collDir,
			],
			{ encoding: "utf8" },
		);
		assert.equal(zr.status, 0, `fixture zip failed: ${zr.stderr}`);
		const zip = Buffer.from(zr.stdout, "base64");
		const digest = `sha256:${createHash("sha256").update(zip).digest("hex")}`;
		type Run = Record<string, unknown>;
		const baseRun = (over: Run = {}): Run => ({
			id: 400,
			run_attempt: 1,
			head_sha: sha,
			event: "workflow_dispatch",
			status: "completed",
			conclusion: "success",
			path: ".github/workflows/ci.yml",
			head_repository: { full_name: repo },
			...over,
		});
		const goodJobs = (
			patch: (
				jobs: { name: string; conclusion: string; steps: { name: string; conclusion: string }[] }[],
			) => void = () => {},
		) => {
			const jobs = ["check", "install-surface", "artifact-consumer", "macos-install-surface"].map((name) => ({
				name,
				conclusion: "success",
				steps:
					name === "check"
						? [
								{ name: "collect qualification receipts (not a verdict)", conclusion: "success" },
								{ name: "upload qualification collection", conclusion: "success" },
							]
						: [],
			}));
			patch(jobs);
			return { jobs };
		};
		const mockApi = (opts: {
			runs?: Run[];
			jobs?: Record<string, unknown>;
			artifacts?: Record<string, unknown>;
		}): GhApi => {
			const runs = opts.runs ?? [baseRun()];
			const table: Record<string, unknown> = {
				[`repos/${repo}/actions/runs?head_sha=${sha}&per_page=100`]: { workflow_runs: runs },
			};
			for (const r of runs) {
				table[`repos/${repo}/actions/runs/${r.id}/attempts/${r.run_attempt}/jobs?per_page=100`] =
					opts.jobs?.[String(r.id)] ?? goodJobs();
				table[`repos/${repo}/actions/runs/${r.id}/artifacts?per_page=100`] = opts.artifacts?.[String(r.id)] ?? {
					artifacts: [
						{
							id: 9,
							name: artifactName(String(r.id), String(r.run_attempt)),
							digest,
							expired: false,
							workflow_run: { id: r.id, head_sha: sha },
						},
					],
				};
			}
			return {
				json: (p: string) => {
					if (!(p in table)) throw new Error(`mock: no fixture for ${p}`);
					return table[p];
				},
				bytes: (p: string) => {
					if (p !== `repos/${repo}/actions/artifacts/9/zip`) throw new Error(`mock: no bytes for ${p}`);
					return zip;
				},
			};
		};
		const final = (api: GhApi) => finalRunEvidence(api, repo, sha, cur.coreFiles ?? {});
		const has = (r: { errors: string[] }, prefix: string) => r.errors.some((e) => e.startsWith(prefix));

		const good = final(mockApi({}));
		ok(
			"gh: the newest ci.yml dispatch run, four required jobs, the collect + upload steps and a digest-true zip → admitted, run 400#1",
			good.errors.length === 0 && good.runId === "400" && good.runAttempt === "1" && good.collection?.runId === "400",
		);
		const fork = final(mockApi({ runs: [baseRun({ head_repository: { full_name: "someone/fork" } })] }));
		const otherWf = final(mockApi({ runs: [baseRun({ path: ".github/workflows/other.yml" })] }));
		const pr = final(mockApi({ runs: [baseRun({ event: "pull_request" })] }));
		const failed = final(mockApi({ runs: [baseRun({ conclusion: "failure" })] }));
		ok(
			"[QK:GH-PROVENANCE-BOUNDARY] gh: a fork's run, another workflow's run, a pull_request run, a failed run → each refused by name",
			has(fork, "run-repository:") &&
				has(otherWf, "run-missing:") &&
				has(pr, "run-event: pull_request") &&
				has(failed, "run-conclusion: failure"),
		);
		// The newer run 401 has every job and step green but no artifact: it is still the one
		// judged (refused for its own missing artifact), independent of the step checks.
		const newerBare = final(
			mockApi({
				runs: [baseRun(), baseRun({ id: 401, event: "push" })],
				artifacts: { 401: { artifacts: [] } },
			}),
		);
		ok(
			"[QK:GH-NEWEST-RUN-ONLY] gh: a newer run at the SHA is the one judged — refused for its own missing artifact, never a fallback to the older collecting run",
			has(newerBare, "artifact-select: 0 artifacts named qualification-collection-401-1") && newerBare.runId === "401",
		);
		const skipped = final(mockApi({ jobs: { 400: goodJobs((j) => (j[1].conclusion = "skipped")) } }));
		const collectFailed = final(mockApi({ jobs: { 400: goodJobs((j) => (j[0].steps[0].conclusion = "failure")) } }));
		const noUpload = final(mockApi({ jobs: { 400: goodJobs((j) => j[0].steps.pop()) } }));
		ok(
			"[QK:GH-COLLECT-STEPS-REQUIRED] gh: a skipped required job, a failed collect step, a missing upload step → each named; step success is a precondition, never a verdict",
			has(skipped, "required-job: install-surface concluded skipped") &&
				has(collectFailed, 'composite-step: "collect qualification receipts (not a verdict)" concluded failure') &&
				has(noUpload, 'composite-step: no step named "upload qualification collection"'),
		);
		const attempt2 = final(
			mockApi({
				runs: [baseRun({ run_attempt: 2 })],
				artifacts: {
					400: {
						artifacts: [
							{
								id: 9,
								name: artifactName("400", "1"),
								digest,
								expired: false,
								workflow_run: { id: 400, head_sha: sha },
							},
						],
					},
				},
			}),
		);
		ok(
			"[QK:GH-ATTEMPT-NO-FALLBACK] gh: attempt 2 has no artifact while attempt 1 does → refused by name, never read",
			has(attempt2, "artifact-attempt: attempt 2 has no artifact") && attempt2.files === null,
		);
		const badDigest = final(
			mockApi({
				artifacts: {
					400: {
						artifacts: [
							{
								id: 9,
								name: artifactName("400", "1"),
								digest: `sha256:${"0".repeat(64)}`,
								expired: false,
								workflow_run: { id: 400, head_sha: sha },
							},
						],
					},
				},
			}),
		);
		ok(
			"gh: the artifact's recorded digest is checked against the downloaded zip bytes",
			has(badDigest, "artifact-digest:"),
		);
		// A NEWER run at the ancestor SHA that ATTEMPTED a collection and failed must not be
		// papered over by the older green one; a newer run that never attempted (a push or
		// schedule run: collect step absent or skipped, no artifact) is not a collection and
		// does not displace it.
		const ancNewerFailed = ancestorRunEvidence(
			mockApi({
				runs: [baseRun(), baseRun({ id: 401, conclusion: "failure" })],
				jobs: { 401: goodJobs((j) => (j[0].steps[0].conclusion = "failure")) },
			}),
			repo,
			sha,
			"400",
		);
		const ancNewerNoAttempt = ancestorRunEvidence(
			mockApi({
				runs: [baseRun(), baseRun({ id: 402, event: "push" })],
				jobs: {
					402: goodJobs((j) => {
						j[0].steps = [
							{ name: "collect qualification receipts (not a verdict)", conclusion: "skipped" },
							{ name: "upload qualification collection", conclusion: "skipped" },
						];
					}),
				},
				artifacts: { 402: { artifacts: [] } },
			}),
			repo,
			sha,
			"400",
		);
		ok(
			"[QK:GH-NEWER-FAILED-COLLECTION-NOT-PAPERED] gh: a newer run that attempted a collection and failed rejects the older green ancestor; a newer run that never attempted one does not",
			has(ancNewerFailed, "run-newer-collection-failed: run 401") && ancNewerNoAttempt.errors.length === 0,
		);
		const ancOk = ancestorRunEvidence(mockApi({}), repo, sha, "400");
		const ancOld = ancestorRunEvidence(mockApi({ runs: [baseRun(), baseRun({ id: 401 })] }), repo, sha, "400");
		ok(
			"gh: an ancestor run is admitted only while no newer run at that SHA also collected",
			ancOk.errors.length === 0 && has(ancOld, "run-not-newest: run 401"),
		);
		ok(
			"gh: --groups all parses to the literal, and resolves to every exact argv once in manifest order",
			(() => {
				const a = parseQualificationArgs(["--groups", "all", "--collect", "/x/c"]);
				const specs = [
					sA,
					fixtureSpec({ claim: "X2" }),
					fixtureSpec({ claim: "X3", gate: ["bash", "gates/survive.sh"] }),
				];
				return (
					a.mode === "groups" &&
					a.groups === "all" &&
					JSON.stringify(allGroupArgv(specs)) === JSON.stringify([sA.gate, ["bash", "gates/survive.sh"]])
				);
			})(),
		);
	} finally {
		fs.rmSync(origin, { recursive: true, force: true });
		fs.rmSync(path.dirname(externalTarget), { recursive: true, force: true });
		fs.rmSync(tmpRoot, { recursive: true, force: true });
	}
}

// ═══ Phase 1c-ci — the CI surface of the composite collection, pinned statically (#124) ═
//
// ci.yml is read as text. The collection must live INSIDE the check job, after the body,
// dispatch-only, with its input carried by env; the required jobs, the unnamed body step
// and the single herdr install must stay exactly as the release oracle and the herdr
// supply gate expect.

{
	// GitHub expression text, assembled so no JS string literal carries `${{`.
	const gh = (expr: string): string => `$${"{{"} ${expr} }}`;
	const ci = fs.readFileSync(path.join(REPO_DIR, ".github/workflows/ci.yml"), "utf8");
	const count = (needle: string) => ci.split(needle).length - 1;
	const jobsAt = ci.indexOf("\njobs:\n");
	const jobNames = [...ci.slice(jobsAt).matchAll(/^ {2}([a-z][a-z0-9-]*):\s*$/gm)].map((m) => m[1]);
	const checkStart = ci.indexOf("\n  check:\n");
	const checkEnd = ci.indexOf("\n  install-surface:\n");
	const body = ci.indexOf("      - run: ./run.sh check-gate-qualification\n");
	const collectAt = ci.indexOf("      - name: collect qualification receipts (not a verdict)\n");
	const uploadAt = ci.indexOf("      - name: upload qualification collection\n");
	const stepText = (at: number) =>
		ci.slice(
			at,
			ci.indexOf("\n      - ", at + 1) === -1 ? checkEnd : Math.min(ci.indexOf("\n      - ", at + 1), checkEnd),
		);
	const collect = stepText(collectAt);
	const upload = stepText(uploadAt);
	const dispatchOnly = (t: string) =>
		/\n {8}if: github\.event_name == 'workflow_dispatch' && inputs\.composite_groups != ''/.test(t);
	const runLine = /\n {8}run: (.*)/.exec(collect)?.[1] ?? "";
	const nameLine = /\n {10}name: (.*)/.exec(upload)?.[1] ?? "";
	ok(
		"[QK:CI-COMPOSITE-STEPS-PINNED] ci.yml: required jobs unchanged, body exactly once, herdr installed once, and the collect + upload steps sit inside check after the body, dispatch-only, input via env, artifact named per run attempt",
		JSON.stringify(jobNames) === JSON.stringify(REQUIRED_JOBS) &&
			count("- run: ./run.sh check-gate-qualification") === 1 &&
			count("./scripts/install-herdr-ci.sh") === 1 &&
			count("- name: collect qualification receipts (not a verdict)") === 1 &&
			count("- name: upload qualification collection") === 1 &&
			checkStart !== -1 &&
			body > checkStart &&
			collectAt > body &&
			uploadAt > collectAt &&
			uploadAt < checkEnd &&
			dispatchOnly(collect) &&
			dispatchOnly(upload) &&
			collect.includes(`\n        env:\n          COMPOSITE_GROUPS: ${gh("inputs.composite_groups")}`) &&
			runLine ===
				'node --experimental-strip-types scripts/check-gate-qualification.ts --groups "$COMPOSITE_GROUPS" --collect "$RUNNER_TEMP/qualification-collection"' &&
			!runLine.includes(gh("").slice(0, 3)) &&
			upload.includes("uses: actions/upload-artifact@v4") &&
			nameLine === `qualification-collection-${gh("github.run_id")}-${gh("github.run_attempt")}` &&
			artifactName(gh("github.run_id"), gh("github.run_attempt")) === nameLine &&
			COMPOSITE_JOB === "check" &&
			/\n {6}composite_groups:\n(?: {8}.*\n)*? {8}type: string\n {8}default: ''\n/.test(ci),
	);
}

// ═══ Phase 1c-o — the exact-SHA oracle: core over mocks, launcher over synthetic repos (#124 P1) ═
//
// The core's decision path runs in-process against an injected GhApi (no network, no
// ghCli). The launcher's clone boundary runs against TEMPORARY synthetic git repositories
// whose commits are test data only; their "oracle core" is a stub that prints a marker and
// emits NO qualification class, so this proves which bytes ran, never a verdict.

{
	const tmpRoot = reclaimOnExit(fs.mkdtempSync(path.join(os.tmpdir(), "entwurf-oracle-selftest-")));
	const { dir: origin, externalTarget } = buildFixtureOrigin();
	const fxEnv = {
		...process.env,
		GIT_CONFIG_GLOBAL: "/dev/null",
		GIT_CONFIG_SYSTEM: "/dev/null",
		GIT_AUTHOR_NAME: "fx",
		GIT_AUTHOR_EMAIL: "fx@localhost",
		GIT_COMMITTER_NAME: "fx",
		GIT_COMMITTER_EMAIL: "fx@localhost",
	};
	const gitAt = (dir: string, ...args: string[]): string => {
		const r = spawnSync("git", ["-C", dir, ...args], { encoding: "utf8", env: fxEnv });
		assert.equal(r.status, 0, `fixture git ${args.join(" ")} failed: ${r.stderr}`);
		return r.stdout.trim();
	};
	const commitAll = (dir: string, msg: string): string => {
		gitAt(dir, "add", "-A");
		gitAt(dir, "-c", "commit.gpgsign=false", "commit", "-q", "-m", msg);
		return gitAt(dir, "rev-parse", "HEAD");
	};
	try {
		// ── parser, self-check, content projection ──
		const S = "a".repeat(40);
		const T = "b".repeat(40);
		const refuseO = (argv: string[], naming: string) =>
			throws(`oracle args: ${JSON.stringify(argv)} is refused`, () => parseOracleArgs(argv), naming);
		const base = ["--sha", S, "--repo", "o/r", "--final-run", "10"];
		refuseO([...base, "--ancestor-run", `${T}:5`, "--ancestor-run", `${T}:6`], "repeats SHA");
		refuseO([...base, "--ancestor-run", `${T}:5`, "--ancestor-run", `${"c".repeat(40)}:5`], "repeats run");
		refuseO([...base, "--ancestor-run", `${S}:5`], "final SHA cannot also be an ancestor");
		refuseO([...base, "--ancestor-run", `${T}:10`], "final run cannot also be an ancestor run");
		refuseO(["--sha", "abc", "--repo", "o/r", "--final-run", "1"], "full 40-hex SHA");
		refuseO([...base, "--origin", "/x"], "unknown argument --origin");
		refuseO([...base, "--self-check-only"], "unknown argument --self-check-only");
		refuseO(["--sha", S], "are required");
		refuseO([...base, "--require-group", "bash run.sh x"], "JSON argv array");
		refuseO([...base, "--require-group", "[]"], "non-empty JSON array");
		refuseO([...base, "--require-group", '["bash", 1]'], "non-empty JSON array");
		refuseO([...base, "--require-group", '["a"]', "--require-group", '["a"]'], "repeats");
		ok(
			"oracle args: --require-group is repeatable, parsed as exact argv, order kept",
			JSON.stringify(
				parseOracleArgs([...base, "--require-group", '["b","x"]', "--require-group", '["a"]']).declared,
			) === JSON.stringify([["b", "x"], ["a"]]) && parseOracleArgs(base).declared.length === 0,
		);
		const gatesKnown = [{ gate: ["bash", "gates/a.sh"] }, { gate: ["bash", "gates/b.sh"] }];
		ok(
			"oracle core: a declared group must be EXACTLY a group gate of the tree — prefix, trailing space, unknown → each refused",
			checkDeclared([["bash", "gates/a.sh"]], gatesKnown).length === 0 &&
				checkDeclared([["bash"]], gatesKnown).length === 1 &&
				checkDeclared([["bash", "gates/a.sh "]], gatesKnown).length === 1 &&
				checkDeclared([["bash", "gates/c.sh"]], gatesKnown)[0].startsWith("require-group-unknown"),
		);
		const fakeGit =
			(head: string, porcelain: string): GitRunner =>
			(args) =>
				args[0] === "rev-parse" ? { status: 0, stdout: `${head}\n` } : { status: 0, stdout: porcelain };
		ok(
			"[QK:ORACLE-SELF-CHECK] oracle core: a checkout at another SHA, or a dirty one, refuses itself; the exact clean SHA passes",
			selfCheck(fakeGit(T, ""), S).some((e) => e.includes(`not ${S}`)) &&
				selfCheck(fakeGit(S, " M x\n"), S).includes("self-check: this checkout is not clean") &&
				selfCheck(fakeGit(S, ""), S).length === 0,
		);

		// ── runOracle over an injected GhApi ──
		const sA = fixtureSpec({});
		const sB = fixtureSpec({
			claim: "SELFTEST-SURVIVE",
			gate: ["bash", "gates/survive.sh"],
			signature: "[QK:SELFTEST-SURVIVE]",
		});
		const sha0 = commitAll(origin, "oracle fixture base");
		const collectAt = async (name: string, runId: string, set: MutantSpec[]) => {
			const dir = path.join(tmpRoot, name);
			await collectGroups({
				repoDir: origin,
				selected: set,
				requested: set.map((m) => m.gate),
				collectDir: dir,
				log: quiet,
				logError: quiet,
				tmpRoot,
				coreGroupGate: sA.gate,
				env: { GITHUB_RUN_ID: runId, GITHUB_RUN_ATTEMPT: "1" },
			});
			const z = spawnSync(
				"python3",
				[
					"-c",
					"import sys, os, io, zipfile, base64\nd = sys.argv[1]; out = io.BytesIO()\nwith zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED) as z:\n    for n in sorted(os.listdir(d)): z.write(os.path.join(d, n), n)\nsys.stdout.write(base64.b64encode(out.getvalue()).decode())",
					dir,
				],
				{ encoding: "utf8" },
			);
			assert.equal(z.status, 0, `fixture zip failed: ${z.stderr}`);
			return Buffer.from(z.stdout, "base64");
		};
		const zipA = await collectAt("r500", "500", [sA]);
		const zipAB = await collectAt("r501", "501", [sA, sB]);
		const repo = "owner/entwurf";
		const apiFor = (runId: number, zip: Buffer): GhApi => {
			const run = {
				id: runId,
				run_attempt: 1,
				head_sha: sha0,
				event: "workflow_dispatch",
				status: "completed",
				conclusion: "success",
				path: ".github/workflows/ci.yml",
				head_repository: { full_name: repo },
			};
			const jobs = ["check", "install-surface", "artifact-consumer", "macos-install-surface"].map((name) => ({
				name,
				conclusion: "success",
				steps:
					name === "check"
						? [
								{ name: "collect qualification receipts (not a verdict)", conclusion: "success" },
								{ name: "upload qualification collection", conclusion: "success" },
							]
						: [],
			}));
			const digest = `sha256:${createHash("sha256").update(zip).digest("hex")}`;
			return {
				json: (p: string) => {
					if (p.startsWith(`repos/${repo}/actions/runs?head_sha=`)) {
						return { workflow_runs: p.includes(sha0) ? [run] : [] };
					}
					if (p === `repos/${repo}/actions/runs/${runId}/attempts/1/jobs?per_page=100`) return { jobs };
					if (p === `repos/${repo}/actions/runs/${runId}/artifacts?per_page=100`) {
						return {
							artifacts: [
								{
									id: 9,
									name: artifactName(String(runId), "1"),
									digest,
									expired: false,
									workflow_run: { id: runId, head_sha: sha0 },
								},
							],
						};
					}
					throw new Error(`mock: no fixture for ${p}`);
				},
				bytes: (p: string) => {
					if (p !== `repos/${repo}/actions/artifacts/9/zip`) throw new Error(`mock: no bytes for ${p}`);
					return zip;
				},
			};
		};
		const firstParent = gitAt(origin, "rev-list", "--first-parent", sha0).split("\n");
		const oracleAt = (
			dir: string,
			set: MutantSpec[],
			api: GhApi,
			over: Partial<Parameters<typeof runOracle>[0]> = {},
		) =>
			runOracle({
				api,
				repo,
				sha: sha0,
				finalRunId: String((api as unknown as { runId?: number }).runId ?? 500),
				ancestors: [],
				independent: contentCandidate(dir, set, sA.gate),
				firstParent,
				operatorDeclared: [],
				...over,
			});
		const content = contentCandidate(origin, [sA], sA.gate);
		ok(
			"oracle core: the content projection carries no C0 environment part (no coreSha256, no node/node_modules)",
			!("coreSha256" in content) && JSON.stringify(content).indexOf("nodeModules") === -1 && content.porcelainClean,
		);
		const green1 = oracleAt(origin, [sA], apiFor(500, zipA));
		const green2 = oracleAt(origin, [sA], apiFor(500, zipA));
		// Two clones in two different places, same CI inputs → the same decision digest.
		const cloneA = path.join(tmpRoot, "clone-a");
		const cloneB = path.join(tmpRoot, "elsewhere", "clone-b");
		fs.mkdirSync(path.dirname(cloneB), { recursive: true });
		for (const c of [cloneA, cloneB]) {
			const r = spawnSync("git", ["clone", "-q", "--no-hardlinks", origin, c], { env: fxEnv });
			assert.equal(r.status, 0, "fixture clone failed");
		}
		const atA = oracleAt(cloneA, [sA], apiFor(500, zipA));
		const atB = oracleAt(cloneB, [sA], apiFor(500, zipA));
		ok(
			"[QK:ORACLE-DIGEST-MACHINE-INDEPENDENT] oracle core: COMPOSITE-GREEN, and the ledger digest is identical across repeats and across two clone locations",
			green1.ledger.verdict === "COMPOSITE-GREEN" &&
				green1.ledgerSha256 === green2.ledgerSha256 &&
				atA.ledgerSha256 === green1.ledgerSha256 &&
				atB.ledgerSha256 === green1.ledgerSha256 &&
				/^[0-9a-f]{64}$/.test(green1.ledgerSha256),
		);
		ok(
			"oracle core: the digest the oracle prints is the one an acceptance record is checked against (sha256 of the canonical ledger)",
			decisionDigest(green1.ledger) === sha256(canonicalJson(green1.ledger)) &&
				green1.ledgerSha256 === sha256(canonicalJson(green1.ledger)),
		);
		const pinned = oracleAt(origin, [sA], apiFor(500, zipA), { finalRunId: "499" });
		ok(
			"[QK:ORACLE-FINAL-RUN-PINNED] oracle core: the newest run is not the pinned one → RED final-run-pinned-mismatch, nothing composed from it",
			pinned.ledger.verdict === "RED" && pinned.oracleErrors.some((e) => e.startsWith("final-run-pinned-mismatch")),
		);
		const unknownAncestor = oracleAt(origin, [sA], apiFor(500, zipA), {
			ancestors: [{ sha: "c".repeat(40), runId: "777" }],
		});
		const surfaceDrift = runOracle({
			api: apiFor(500, zipA),
			repo,
			sha: sha0,
			finalRunId: "500",
			ancestors: [],
			independent: { ...content, workSurfaceSha256: "0".repeat(64) },
			firstParent,
			operatorDeclared: [],
		});
		const redTail = runOracle({
			api: apiFor(501, zipAB),
			repo,
			sha: sha0,
			finalRunId: "501",
			ancestors: [],
			independent: contentCandidate(origin, [sA, sB], sA.gate),
			firstParent,
			operatorDeclared: [],
		});
		ok(
			"oracle core: an unknown ancestor run → RED; a CI-claimed surface the tree contradicts → RED; a COMPLETE final collection with a red group → RED",
			unknownAncestor.ledger.verdict === "RED" &&
				unknownAncestor.oracleErrors.some((e) => e.includes("run-missing: 777")) &&
				surfaceDrift.ledger.verdict === "RED" &&
				surfaceDrift.ledger.release.crossCheck.includes("workSurface") &&
				redTail.ledger.verdict === "RED" &&
				redTail.oracleErrors.length === 0,
		);

		const declaredB = oracleAt(origin, [sA], apiFor(500, zipA), { operatorDeclared: [sB.gate] });
		ok(
			"[QK:ORACLE-DECLARED-REQUIRED] oracle core: a declared group reaches the release composer — in required, and NOT-QUALIFIED required-not-measured while the final run did not measure it",
			green1.ledger.release.required.length === 1 &&
				declaredB.ledger.verdict === "NOT-QUALIFIED" &&
				declaredB.ledger.release.required.some((g) => JSON.stringify(g) === JSON.stringify(sB.gate)) &&
				declaredB.ledger.blockers.some(
					(b) => b === `required-not-measured: ${sB.gate.join(" ")} must be exact-MEASURED on these bytes`,
				),
		);

		// ── the launcher over synthetic repositories (test data) ──
		const synth = path.join(tmpRoot, "synth-origin");
		fs.mkdirSync(synth);
		gitAt(synth, "init", "-q");
		fs.writeFileSync(path.join(synth, "README"), "synthetic\n");
		const noCore = commitAll(synth, "no oracle core");
		const nonce = createHash("sha256").update(`${process.pid}-${Date.now()}`).digest("hex").slice(0, 12);
		fs.mkdirSync(path.join(synth, "scripts", "lib"), { recursive: true });
		fs.writeFileSync(
			path.join(synth, "scripts", "lib", "qualification-oracle-core.ts"),
			[
				'import { execFileSync } from "node:child_process";',
				'const head = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();',
				`console.log("STUB-MARKER-${nonce} cwd=" + process.cwd() + " head=" + head);`,
				"process.exit(7);",
				"",
			].join("\n"),
		);
		const withStub = commitAll(synth, "stub oracle core (test data, no qualification class)");
		fs.writeFileSync(
			path.join(synth, "scripts", "lib", "qualification-oracle-core.ts"),
			[
				'import { execFileSync } from "node:child_process";',
				'import { writeFileSync } from "node:fs";',
				'const origin = execFileSync("git", ["remote", "get-url", "origin"], { encoding: "utf8" }).trim();',
				'writeFileSync(origin + "/tampered.txt", "x");',
				"process.exit(0);",
				"",
			].join("\n"),
		);
		const tamper = commitAll(synth, "stub that writes the origin (test data)");
		fs.writeFileSync(path.join(synth, "dirty-untracked.txt"), "operator's uncommitted work\n");
		const cloneDirs = () => fs.readdirSync(os.tmpdir()).filter((f) => f.startsWith("entwurf-oracle-clone-")).length;
		const run = (sha: string, extra: string[] = []) => {
			const out: string[] = [];
			const err: string[] = [];
			const code = launch(
				["--sha", sha, "--repo", "o/r", "--final-run", "1", "--origin", synth, ...extra],
				(l) => out.push(l),
				(l) => err.push(l),
			);
			return { code, out: out.join("\n"), err: err.join("\n") };
		};
		const clonesBefore = cloneDirs();
		const missing = run(noCore);
		ok(
			"[QK:ORACLE-SOURCE-MISSING] launcher: a SHA that does not carry the oracle core → ABORT oracle-source-missing (the 8d508d3 shape), exit 2",
			missing.code === 2 && missing.err.includes("oracle-source-missing"),
		);
		const porcelainBefore = gitAt(synth, "status", "--porcelain");
		const stub = run(withStub);
		const marker = new RegExp(`STUB-MARKER-${nonce} cwd=(\\S+) head=([0-9a-f]{40})`).exec(stub.out);
		ok(
			"[QK:ORACLE-RUNS-TARGET-BYTES] launcher: the TARGET SHA's own core runs inside a clean clone (not the dirty origin), its exit code relayed; clone removed, origin untouched",
			stub.code === 7 &&
				marker !== null &&
				marker[2] === withStub &&
				path.resolve(marker[1]) !== path.resolve(synth) &&
				!fs.existsSync(marker[1]) &&
				gitAt(synth, "status", "--porcelain") === porcelainBefore &&
				cloneDirs() === clonesBefore,
		);
		const moved = run(tamper);
		ok(
			"[QK:ORACLE-ORIGIN-TRIPWIRE] launcher: a core that writes the origin while it runs → ABORT origin-moved, overriding its own exit 0",
			moved.code === 2 && moved.err.includes("origin-moved") && fs.existsSync(path.join(synth, "tampered.txt")),
		);
		fs.rmSync(path.join(synth, "tampered.txt"));
		const inside = run(withStub, ["--ledger-out", path.join(synth, "ledger.json")]);
		ok(
			"launcher: a --ledger-out inside the origin repo is refused before anything is cloned",
			inside.code === 2 && inside.err.includes("outside the repo") && !stub.out.includes("ledger"),
		);
	} finally {
		fs.rmSync(origin, { recursive: true, force: true });
		fs.rmSync(path.dirname(externalTarget), { recursive: true, force: true });
		fs.rmSync(tmpRoot, { recursive: true, force: true });
	}
}

console.log(`\n[${SURFACE}] self-test: ${passed} checks passed`);

// ═══ Phase 1d — the real manifests, VALIDATED but not yet run ═══════════════
//
// The HEAD ends here. Everything above and in this block is pure reading and
// checking: no mutant from `scripts/mutants/` is executed and no snapshot of THIS
// repo exists yet. `--manifests-only` returns from exactly this point.

let selected: MutantSpec[];
let manifestCount: number;
{
	const manifests: MutantManifest[] = fs
		.readdirSync(MUTANTS_DIR)
		.filter((f) => f.endsWith(".json"))
		.sort()
		.map((f) => {
			let raw: unknown;
			try {
				raw = JSON.parse(fs.readFileSync(path.join(MUTANTS_DIR, f), "utf8"));
			} catch (err) {
				throw new ManifestError(`${f}: not valid JSON — ${err instanceof Error ? err.message : String(err)}`);
			}
			return validateManifest(raw, f);
		});
	// Vacuous-green guard (matrix-style table integrity): an emptied mutants dir or a
	// manifest lost in a merge must name itself here — "0/0 killed" is not a pass.
	// Extend this inventory and the manifests TOGETHER, never silently.
	const EXPECTED_LANE_MUTANTS: Record<string, number> = {
		"acp-backend-preflight": 1,
		"acp-augment": 10,
		"acp-cortex": 14,
		"acp-launch-namespace": 2,
		"acp-overlay": 1,
		"acp-prompt-lifecycle": 15,
		"acp-stop-reason": 6,
		"acp-stream-hooks": 10,
		"acp-usage-accounting": 12,
		"agy-permission": 6,
		"bridge-boot-resume": 5,
		"bridge-command-boot": 12,
		"capability-cache": 3,
		"codex-app-server-launch": 9,
		"codex-caller-seat": 28,
		"control-send-receipt": 19,
		"codex-native": 81,
		"compaction-send-guard": 7,
		"control-socket-disconnect": 4,
		"copilot-birth": 19,
		"copilot-launch": 14,
		"pi-launch": 9,
		"pi-floor": 1,
		"pi-bridge-sender": 4,
		"pi-mcp-bridge": 2,
		"pi-mcp-register": 3,
		"copilot-receive": 20,
		"entwurf-peers": 1,
		"fresh-call-dispatch": 11,
		"fresh-cut": 3,
		"gate-qualification": 7,
		"herdr-placement": 13,
		"herdr-plugin": 25,
		"herdr-plugin-profile": 14,
		"herdr-activation": 25,
		"herdr-plugin-build": 13,
		"herdr-runtime-bootstrap": 31,
		"herdr-fresh-call": 38,
		"herdr-supply": 11,
		"meta-facts": 4,
		"peer-facts": 8,
		"meta-hook-session-switch": 17,
		"meta-identity": 4,
		"meta-retire": 4,
		"mux-boundary": 16,
		"mux-fresh-call": 59,
		"mux-launcher-fence": 8,
		"mux-parent-artifact": 3,
		"pack-install": 3,
		"pi-package-ownership": 8,
		"qualification-ledger": 42,
		"mux-resume-call": 10,
		"omp-birth": 13,
		"omp-fresh": 24,
		"omp-receive": 11,
		"probe-ordering": 1,
		"release-gate": 22,
		"retired-sent-surface": 2,
		"resume-args": 6,
		"resume-launch-identity": 6,
		"self-address": 8,
		"setup-verdict": 14,
		"source-install": 2,
		"typing-call-fence": 1,
		"v2-surface": 13,
		"v2-visible-resume": 17,
	};
	const laneTally: Record<string, number> = {};
	for (const man of manifests) laneTally[man.lane] = (laneTally[man.lane] ?? 0) + man.mutants.length;
	try {
		assert.deepEqual(laneTally, EXPECTED_LANE_MUTANTS);
	} catch {
		assert.fail(
			"[QK:LANE-INVENTORY-DECLARED] the mutant lane inventory drifted from the declared contract — extend " +
				"EXPECTED_LANE_MUTANTS and the manifests together, never silently. A lane that lost its manifest in a " +
				"merge, or gained mutants nobody declared, would otherwise pass as `n/n killed` over whatever set " +
				`happened to be on disk. declared=${JSON.stringify(EXPECTED_LANE_MUTANTS)} onDisk=${JSON.stringify(laneTally)}`,
		);
	}
	try {
		selected = validateManifestSet(manifests, makeOriginChecks(REPO_DIR));
	} catch (err) {
		assert.fail(
			"[QK:MANIFEST-SET-INTEGRITY-REFUSED] the committed manifest set broke its cross-manifest contract (global " +
				"claim uniqueness, subject tracked + lstat-regular in the ORIGIN index, signatureSource on the origin work " +
				"surface, claim token present exactly once in its gate source). Every one of those is what makes a KILLED " +
				"verdict mean something, so the set is refused rather than run. Refusal: " +
				(err instanceof Error ? err.message : String(err)),
		);
	}
	// FIND MATCHES ITS SUBJECT, EXACTLY ONCE — the body's own precondition, hoisted into the head.
	// `validateManifestSet` above proves the subject is TRACKED; it never opens it. So a change
	// that edits a subject line a mutant quotes leaves the whole deterministic floor green and
	// dies an hour later in CI or the release gate as MUTANT-STALE. That is exactly how the
	// 0.23.2 pi bump landed: `pack_install_leaked_pi`'s pin regex moved 0.85.1 → 0.86.0 in
	// run.sh, `scripts/mutants/pack-install.json` kept quoting the old line, and two claims came
	// back NOT KILLED after ~50 minutes of mutant execution. The check costs one read per
	// mutant and uses `countOccurrences` — the SAME function the body applies at
	// mutation-qualify.ts:743 — so head and body cannot disagree about what "matches" means.
	// This is a STALENESS check, not a kill-proof: it says the mutant still has a subject to
	// corrupt, never that corrupting it is caught. That remains the body's verdict.
	const stale: string[] = [];
	for (const man of manifests) {
		for (const m of man.mutants) {
			const subjectAbs = path.join(REPO_DIR, m.subject);
			let source: string;
			try {
				source = fs.readFileSync(subjectAbs, "utf8");
			} catch (err) {
				stale.push(`${man.lane}/${m.claim}: subject ${m.subject} unreadable (${(err as Error).message})`);
				continue;
			}
			const n = countOccurrences(source, m.find.join("\n"));
			if (n !== 1) stale.push(`${man.lane}/${m.claim}: find matched ${n}× in ${m.subject} (expected exactly 1)`);
		}
	}
	assert.deepEqual(
		stale,
		[],
		"[QK:MUTANT-FIND-MATCHES-SUBJECT] every mutant's `find` must match its subject exactly once. A find that " +
			"matches 0× is a mutant whose production line moved out from under it — the body can write nothing, the " +
			"verdict is MUTANT-STALE, and the claim is silently unproven; a find that matches 2+× cannot say WHICH " +
			"occurrence it corrupts. Either way the manifest and the source have to move together. Found:\n" +
			stale.join("\n"),
	);

	manifestCount = manifests.length;
	console.log(`[${SURFACE}] ${selected.length} mutants across ${manifestCount} lanes (no tiers — full set every run)`);
}

if (MANIFESTS_ONLY) {
	console.log(
		`[check-gate-manifests] ok — runner self-test green, ${selected.length} committed mutants across ` +
			`${manifestCount} lanes validated against the origin index, every one of their \`find\` strings still ` +
			"matching its subject exactly once, and the lane inventory matching its declared " +
			"contract. ZERO committed mutants were executed and this repo was never snapshotted (the " +
			"self-test ran only its synthetic fixture mutants, in tmp fixture repos): the body " +
			"(check-gate-qualification) owns the committed set, unchanged.",
	);
	process.exit(0);
}

// ═══ Phase 2c — LOCAL composite ledger over explicit receipt files (#124) ═════
//
// Runs after the full head (self-test + committed manifests validated), then composes
// the given receipts against THIS candidate. It executes no mutant and accepts no risk.
// `--expect` is optional HERE; the offline composite oracle declares its inputs through each
// collection's receipt digests under the artifact digest instead (qualification-ledger.ts).
// Exit: 0 COMPOSITE-GREEN, 1 RED, 3 RISK-PENDING, 4 NOT-QUALIFIED. The ledger it can
// write is a report; FULL-GREEN and RISK-ACCEPTED are not local verdicts.

if (ARGS.mode === "compose") {
	const expected = ARGS.expectPath ? parseExpectedList(fs.readFileSync(ARGS.expectPath, "utf8")) : undefined;
	const loaded = ARGS.receipts.map((f) => {
		try {
			return loadReceipt(f);
		} catch (err) {
			// An unreadable input is not skipped: it enters as an unparseable receipt (RED).
			return { source: f, text: `unreadable: ${err instanceof Error ? err.message : String(err)}` };
		}
	});
	const ledger = composeLedger(loaded, currentCandidate(REPO_DIR, selected), expected, {
		ledgerPath: ARGS.ledgerOut,
	});
	for (const line of ledger.summary) console.log(line);
	if (ARGS.ledgerOut) {
		writeReceiptExclusive(ARGS.ledgerOut, ledger);
		console.log(`[qualification-ledger] written: ${ARGS.ledgerOut}`);
	}
	const exitFor = { "COMPOSITE-GREEN": 0, RED: 1, "RISK-PENDING": 3, "NOT-QUALIFIED": 4 } as const;
	process.exit(exitFor[ledger.verdict]);
}

// ═══ Phase 2m — several exact-argv groups, one collection (#124 step 1) ═════
//
// Head once (above), then each requested group on its own fresh snapshot. Exit 0 means
// only that the collection is COMPLETE — every requested group wrote a receipt, red ones
// included. It is an inventory, never a verdict: compose it with --compose.

if (ARGS.mode === "groups") {
	const requested = ARGS.groups === "all" ? allGroupArgv(selected) : ARGS.groups;
	checkRequestedGroups(requested, selected);
	sweepStaleSnapshots(os.tmpdir());
	const c = await collectGroups({
		repoDir: REPO_DIR,
		selected,
		requested,
		collectDir: ARGS.collectDir,
		log: (line) => console.log(line),
		logError: (line) => console.error(line),
	});
	const problems = checkCollection(ARGS.collectDir);
	for (const p of problems) console.error(`[gate-qualification --groups] ${p}`);
	const red = c.attempted.filter((a) => a.detail === "group-RED").length;
	console.log(
		`[gate-qualification --groups] collection ${c.complete ? "COMPLETE" : "INCOMPLETE"} (not a verdict): ` +
			`${c.attempted.filter((a) => a.outcome === "receipt-written").length}/${c.requested.length} receipts written, ` +
			`${red} red; ${ARGS.collectDir}/collection.json`,
	);
	process.exit(c.complete && problems.length === 0 ? 0 : 1);
}

// ═══ Phase 2g — ONE exact-argv group, PARTIAL receipt (#124 P1) ════════════
//
// Same head, same snapshot, same qualifyMutants state machine — restricted to the
// mutants whose gate argv equals `--group` exactly, in manifest order. A red is a
// measurement too: the receipt is written first, then the exit is nonzero. An
// exception inside the body writes nothing (it is not an observation). This never
// prints `[gate-qualification] ok` and never claims the full set.

if (ARGS.mode === "group") {
	sweepStaleSnapshots(os.tmpdir());
	const { passed: groupPassed } = await runGroupReceipt({
		repoDir: REPO_DIR,
		selected,
		gate: ARGS.group,
		receiptPath: ARGS.receiptPath,
		log: (line) => console.log(line),
		logError: (line) => console.error(line),
	});
	process.exit(groupPassed ? 0 : 1);
}

// ═══ Phase 2 — the real manifests against a snapshot of THIS repo ═══════════

{
	const headBefore = originHead(REPO_DIR);
	const workSurfaceBefore = originWorkSurfaceSha(REPO_DIR);

	sweepStaleSnapshots(os.tmpdir());
	const snap = createRepoSnapshot(REPO_DIR);
	console.log(
		`[gate-qualification] snapshot: ${snap.repoDir} (${snap.fileCount} files, origin HEAD ${headBefore.slice(0, 12)})`,
	);
	let report: Awaited<ReturnType<typeof qualifyMutants>>;
	try {
		report = await qualifyMutants(snap, selected, (line) => console.log(line));
	} finally {
		fs.rmSync(snap.baseDir, { recursive: true, force: true });
	}

	// Tripwire, not recovery: the runner never writes the origin, so any drift here is
	// an outside writer racing the qualification — evidence cannot be attributed.
	assert.equal(originHead(REPO_DIR), headBefore, "origin HEAD changed during qualification");
	assert.equal(
		originWorkSurfaceSha(REPO_DIR),
		workSurfaceBefore,
		"origin work surface changed during qualification (content hash, not porcelain text)",
	);
	console.log("[gate-qualification] origin checkout: HEAD + work-surface content hash identical before/after");

	const killed = report.groups.flatMap((g) => g.mutants).filter((m) => m.verdict === "KILLED");
	const failed = report.groups.flatMap((g) => g.mutants).filter((m) => m.verdict !== "KILLED");
	const controlRed = report.groups.filter((g) => g.control !== "ok");
	if (!report.treeClean || !report.porcelainClean) {
		console.error(
			`[gate-qualification] IMPURE: snapshot tree drifted (treeClean=${report.treeClean} porcelainClean=${report.porcelainClean})`,
		);
	}
	for (const g of controlRed) {
		console.error(`[gate-qualification] CONTROL ${g.control}: ${g.gate.join(" ")}`);
	}
	for (const m of failed) {
		console.error(`[gate-qualification] NOT KILLED: ${m.claim} → ${m.verdict} (${m.detail})`);
	}
	console.log(
		`\n[gate-qualification] qualified claims: ${killed.length}/${selected.length} killed — ${killed.map((m) => m.claim).join(", ")}`,
	);
	assert.ok(reportPassed(report), "gate qualification failed — see NOT KILLED / CONTROL lines above");
}

console.log("[gate-qualification] ok");
