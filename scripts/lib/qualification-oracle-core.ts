/**
 * qualification-oracle-core — the exact-SHA composite release oracle, as the TARGET SHA's
 * own code (#124 P1). It runs inside a clean detached clone of that SHA made by the
 * launcher (`scripts/qualification-oracle.ts`); the operator's checkout never judges a SHA
 * with its own bytes.
 *
 *   selfCheck        the checkout it runs in IS the SHA it was asked about, and is clean —
 *                    run directly (without the launcher) it still cannot impersonate a SHA.
 *   runOracle        GitHub evidence (injected GhApi) → admitted collections → composeRelease.
 *                    The final run must be the one the caller pinned (the run the exact-CI
 *                    oracle already chose). Admission errors are kept as RED reasons.
 *   decisionDigest   sha256 over the canonical ledger: machine-independent by construction
 *                    (every source is a run/file label, never a host path).
 *
 * What it does NOT prove: that the GhApi answers are GitHub's. `ghCli` is the only networked
 * implementation and the provenance boundary; the pure composer never vouches for inputs.
 * No mode of this CLI skips the verdict — exit 0 means COMPOSITE-GREEN and nothing else.
 */

import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { type MutantSpec, makeOriginChecks, validateManifest, validateManifestSet } from "./mutation-qualify.ts";
import { ancestorRunEvidence, finalRunEvidence, type GhApi, ghCli, type RunEvidence } from "./qualification-gh.ts";
import { type ContentCandidate, contentCandidate, type Ledger } from "./qualification-ledger.ts";
import { canonicalJson, checkReceiptPath, sha256, writeReceiptExclusive } from "./qualification-receipt.ts";
import { type CiRun, composeRelease, type ReleaseLedger } from "./qualification-release.ts";

export const ORACLE_CORE_PATH = "scripts/lib/qualification-oracle-core.ts";
const SHA = /^[0-9a-f]{40}$/;
const RUN = /^[0-9]+$/;
const REPO = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

export interface OracleArgs {
	sha: string;
	repo: string;
	finalRun: string;
	ancestors: { sha: string; runId: string }[];
	/** `--require-group`: exact gate argv a human requires exact-MEASURED on the final SHA. */
	declared: string[][];
	ledgerOut?: string;
	/** Launcher only: the repository to clone (defaults to the launcher's own checkout). */
	origin?: string;
}

export class OracleArgsError extends Error {}

/** Strict: unknown/repeated flags, malformed values, duplicate or final-SHA ancestors are refused. */
export function parseOracleArgs(argv: string[], allowOrigin = false): OracleArgs {
	const seen = new Set<string>();
	const out: Partial<OracleArgs> & { ancestors: { sha: string; runId: string }[]; declared: string[][] } = {
		ancestors: [],
		declared: [],
	};
	for (let i = 0; i < argv.length; i++) {
		const flag = argv[i];
		const value = argv[i + 1];
		const need = (): string => {
			if (value === undefined || value.startsWith("--")) throw new OracleArgsError(`${flag} needs a value`);
			i++;
			return value;
		};
		if (flag !== "--ancestor-run" && flag !== "--require-group") {
			if (seen.has(flag)) throw new OracleArgsError(`repeated flag ${flag}`);
			seen.add(flag);
		}
		if (flag === "--sha") {
			const v = need();
			if (!SHA.test(v)) throw new OracleArgsError(`--sha must be a full 40-hex SHA: ${v}`);
			out.sha = v;
		} else if (flag === "--repo") {
			const v = need();
			if (!REPO.test(v)) throw new OracleArgsError(`--repo must be owner/name: ${v}`);
			out.repo = v;
		} else if (flag === "--final-run") {
			const v = need();
			if (!RUN.test(v)) throw new OracleArgsError(`--final-run must be a numeric run id: ${v}`);
			out.finalRun = v;
		} else if (flag === "--ancestor-run") {
			const v = need();
			const m = /^([0-9a-f]{40}):([0-9]+)$/.exec(v);
			if (!m) throw new OracleArgsError(`--ancestor-run must be <40-hex sha>:<run id>: ${v}`);
			if (out.ancestors.some((a) => a.sha === m[1])) throw new OracleArgsError(`--ancestor-run repeats SHA ${m[1]}`);
			if (out.ancestors.some((a) => a.runId === m[2])) throw new OracleArgsError(`--ancestor-run repeats run ${m[2]}`);
			out.ancestors.push({ sha: m[1], runId: m[2] });
		} else if (flag === "--require-group") {
			const v = need();
			let argv: unknown;
			try {
				argv = JSON.parse(v);
			} catch {
				throw new OracleArgsError(`--require-group must be a JSON argv array: ${v}`);
			}
			if (!Array.isArray(argv) || argv.length === 0 || !argv.every((a) => typeof a === "string" && a !== "")) {
				throw new OracleArgsError(`--require-group must be a non-empty JSON array of non-empty strings: ${v}`);
			}
			if (out.declared.some((d) => JSON.stringify(d) === JSON.stringify(argv)))
				throw new OracleArgsError(`--require-group repeats ${v}`);
			out.declared.push(argv as string[]);
		} else if (flag === "--ledger-out") {
			out.ledgerOut = need();
		} else if (flag === "--origin" && allowOrigin) {
			out.origin = need();
		} else {
			throw new OracleArgsError(`unknown argument ${flag}`);
		}
	}
	if (!out.sha || !out.repo || !out.finalRun) throw new OracleArgsError("--sha, --repo and --final-run are required");
	if (out.ancestors.some((a) => a.sha === out.sha))
		throw new OracleArgsError("the final SHA cannot also be an ancestor");
	if (out.ancestors.some((a) => a.runId === out.finalRun))
		throw new OracleArgsError("the final run cannot also be an ancestor run");
	return out as OracleArgs;
}

export type GitRunner = (args: string[]) => { status: number; stdout: string };
export const gitIn =
	(dir: string): GitRunner =>
	(args) => {
		const r = spawnSync("git", ["-C", dir, ...args], { encoding: "utf8" });
		return { status: r.status ?? 1, stdout: r.stdout ?? "" };
	};

/** The checkout IS `sha` and is clean. Injected git so the refusals are testable without a repo. */
export function selfCheck(git: GitRunner, sha: string): string[] {
	const errors: string[] = [];
	const head = git(["rev-parse", "HEAD"]);
	if (head.status !== 0 || head.stdout.trim() !== sha) {
		errors.push(`self-check: this checkout is at ${head.stdout.trim() || "?"}, not ${sha}`);
	}
	const st = git(["status", "--porcelain"]);
	if (st.status !== 0 || st.stdout !== "") errors.push("self-check: this checkout is not clean");
	return errors;
}

/**
 * Every declared argv must be EXACTLY one of this tree's group gates — no prefix, no
 * whitespace folding, no affected-set inference. An unknown argv is a caller error.
 */
export function checkDeclared(declared: string[][], groups: { gate: string[] }[]): string[] {
	const known = new Set(groups.map((g) => JSON.stringify(g.gate)));
	return declared
		.filter((d) => !known.has(JSON.stringify(d)))
		.map((d) => `require-group-unknown: ${JSON.stringify(d)} is not a group gate of this tree`);
}

/** The committed mutant set of THIS checkout, validated against its own index. */
export function loadSelected(repoDir: string): MutantSpec[] {
	const dir = path.join(repoDir, "scripts", "mutants");
	const manifests = fs
		.readdirSync(dir)
		.filter((f) => f.endsWith(".json"))
		.sort()
		.map((f) => validateManifest(JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")), f));
	return validateManifestSet(manifests, makeOriginChecks(repoDir));
}

export interface OracleResult {
	ledger: ReleaseLedger;
	/** sha256 of the canonical ledger — the digest a human acceptance must name. */
	ledgerSha256: string;
	oracleErrors: string[];
	provenance: string[];
}

export function decisionDigest(ledger: Ledger): string {
	return sha256(canonicalJson(ledger));
}

export function runOracle(input: {
	api: GhApi;
	repo: string;
	sha: string;
	finalRunId: string;
	ancestors: { sha: string; runId: string }[];
	independent: ContentCandidate;
	firstParent: string[];
	operatorDeclared: string[][];
}): OracleResult {
	const oracleErrors: string[] = [];
	const runs: CiRun[] = [];
	const take = (ev: RunEvidence, sha: string, label: string) => {
		for (const e of ev.errors) oracleErrors.push(`${label}: ${e}`);
		if (ev.errors.length === 0 && ev.files && ev.runId && ev.runAttempt) {
			runs.push({ runId: ev.runId, runAttempt: ev.runAttempt, headSha: sha, files: ev.files });
		}
	};
	const final = finalRunEvidence(input.api, input.repo, input.sha, input.independent.coreFiles ?? {});
	if (final.runId !== null && final.runId !== input.finalRunId) {
		oracleErrors.push(
			`final-run-pinned-mismatch: the newest run at the SHA is ${final.runId}, the caller pinned ${input.finalRunId}`,
		);
	} else take(final, input.sha, `final run ${input.finalRunId}`);
	for (const a of input.ancestors)
		take(ancestorRunEvidence(input.api, input.repo, a.sha, a.runId), a.sha, `ancestor run ${a.runId}`);

	const composed = composeRelease({
		finalSha: input.sha,
		firstParent: input.firstParent,
		runs,
		independent: input.independent,
		operatorDeclared: input.operatorDeclared,
	});
	const ledger: ReleaseLedger =
		oracleErrors.length === 0
			? composed
			: {
					...composed,
					verdict: "RED",
					summary: [
						`[qualification-oracle] RED on ${input.sha.slice(0, 12)}: evidence refused before composition`,
						...oracleErrors.map((e) => `  ORACLE ${e}`),
						...composed.summary,
					],
				};
	return {
		ledger,
		ledgerSha256: decisionDigest(ledger),
		oracleErrors,
		provenance: [
			"GitHub run/job/artifact records are read through the injected GhApi; only ghCli touches the network",
			"the pure composer does not prove where its inputs came from",
			"node/node_modules C0 is the final run's own witness; this tree's CORE_FILES are recomputed here",
		],
	};
}

const EXIT = { "COMPOSITE-GREEN": 0, RED: 1, "RISK-PENDING": 3, "NOT-QUALIFIED": 4 } as const;

/** In-clone CLI. Exit: 0 COMPOSITE-GREEN, 1 RED, 3 RISK-PENDING, 4 NOT-QUALIFIED, 2 ABORT. */
export function main(argv: string[], repoDir: string, api: GhApi = ghCli()): number {
	let args: OracleArgs;
	try {
		args = parseOracleArgs(argv);
	} catch (err) {
		console.error(`[qualification-oracle] ABORT: ${err instanceof Error ? err.message : String(err)}`);
		return 2;
	}
	const git = gitIn(repoDir);
	const self = selfCheck(git, args.sha);
	if (self.length > 0) {
		for (const e of self) console.error(`[qualification-oracle] ABORT ${e}`);
		return 2;
	}
	if (args.ledgerOut) checkReceiptPath(args.ledgerOut, repoDir);
	const selected = loadSelected(repoDir);
	const independent = contentCandidate(repoDir, selected);
	const unknown = checkDeclared(args.declared, independent.groups);
	if (unknown.length > 0) {
		for (const e of unknown) console.error(`[qualification-oracle] ABORT ${e}`);
		return 2;
	}
	const firstParent = git(["rev-list", "--first-parent", args.sha]).stdout.trim().split("\n");
	const result = runOracle({
		api,
		repo: args.repo,
		sha: args.sha,
		finalRunId: args.finalRun,
		ancestors: args.ancestors,
		independent,
		firstParent,
		operatorDeclared: args.declared,
	});
	const after = selfCheck(git, args.sha);
	if (after.length > 0) {
		for (const e of after) console.error(`[qualification-oracle] ABORT (after) ${e}`);
		return 2;
	}
	for (const line of result.ledger.summary) console.log(line);
	for (const p of result.provenance) console.log(`  PROVENANCE ${p}`);
	console.log(`[qualification-oracle] ledger sha256 ${result.ledgerSha256}`);
	if (args.ledgerOut) writeReceiptExclusive(args.ledgerOut, { ...result, schema: "entwurf.qualification-oracle/v0" });
	return EXIT[result.ledger.verdict];
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	process.exit(main(process.argv.slice(2), process.cwd()));
}
