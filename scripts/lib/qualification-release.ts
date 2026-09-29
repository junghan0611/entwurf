/**
 * qualification-release — compose a RELEASE ledger from CI collections along a
 * first-parent chain (#124 step 2). PURE: no network, no git, no fs. The caller hands
 * in what it has already fetched and verified elsewhere; this function never claims its
 * inputs came from anywhere in particular, and it produces no acceptance class.
 *
 * Inputs:
 *   - finalSha and firstParent (`git rev-list --first-parent finalSha`, finalSha first);
 *   - runs: one entry per CI run attempt — runId, runAttempt, headSha, and the unpacked
 *     collection files (name → bytes);
 *   - independent: the candidate recomputed by the caller from the final tree ITSELF
 *     (surface, groups, manifest claims, CORE_FILES fingerprints). Its node/node_modules
 *     part cannot be recomputed off the CI runner and is not used;
 *   - operatorDeclared: extra groups a human requires to be measured on the final SHA.
 *
 * Contract errors (any → RED): a run that is not CI provenance (runId/runAttempt not
 * digits), a headSha off the first-parent chain, the same (runId, runAttempt) twice, a
 * collection whose own runId/runAttempt/head disagree with the run, no collection at the
 * final SHA, an incomplete final collection, or a final candidate the independent
 * recomputation contradicts.
 *
 * Per SHA only the newest (runId, then runAttempt) run counts; older ones are listed as
 * superseded. An incomplete ancestor collection is excluded from the basis with its
 * reason. Order across runs is first-parent position, then collection index — never a
 * clock. Release blockers on top of the local ones: every group needs a usable pass
 * receipt somewhere in the chain (UNRUN blocks), and the runner group, every group whose
 * newest receipt in the chain is red, and every operator-declared group must be
 * exact-MEASURED on the final SHA. A red on an ancestor that the final SHA re-measured
 * green stays in history and contributes no FAIL.
 */

import { type Collection, checkCollectionData, mapReader } from "./qualification-collection.ts";
import {
	type ContentCandidate,
	type CurrentCandidate,
	composeLedger,
	type Ledger,
	type LoadedReceipt,
} from "./qualification-ledger.ts";
import { canonicalJson } from "./qualification-receipt.ts";

export interface CiRun {
	runId: string;
	runAttempt: string;
	headSha: string;
	files: Record<string, Buffer>;
}

export interface ReleaseInput {
	finalSha: string;
	firstParent: string[];
	runs: CiRun[];
	/** The final tree's content projection — no C0 environment part (see ContentCandidate). */
	independent: ContentCandidate;
	operatorDeclared: string[][];
}

export interface RunRef {
	runId: string;
	runAttempt: string;
	headSha: string;
}

export interface ReleaseLedger extends Ledger {
	release: {
		finalSha: string;
		contractErrors: string[];
		crossCheck: string[];
		used: RunRef[];
		excluded: (RunRef & { reason: string })[];
		required: string[][];
		denominator: {
			groups: number;
			claims: number;
			measuredOnFinal: { groups: number; claims: number; list: string[] };
			inheritedCore: { gate: string; from: RunRef | null; reason: string }[];
			flagged: string[];
			unrun: number;
			fail: number;
		};
		/** What this ledger can and cannot vouch for. */
		provenance: string[];
	};
}

const DIGITS = /^[0-9]+$/;
const refOf = (r: CiRun): RunRef => ({ runId: r.runId, runAttempt: r.runAttempt, headSha: r.headSha });
const newer = (a: CiRun, b: CiRun): boolean =>
	BigInt(a.runId) !== BigInt(b.runId) ? BigInt(a.runId) > BigInt(b.runId) : BigInt(a.runAttempt) > BigInt(b.runAttempt);

/** Content fields a CI-claimed candidate must share with the independent recomputation. */
export function crossCheckCandidate(claimed: CurrentCandidate, independent: ContentCandidate): string[] {
	const out: string[] = [];
	if (claimed.head !== independent.head) out.push(`head: CI ${claimed.head} vs tree ${independent.head}`);
	if (claimed.workSurfaceSha256 !== independent.workSurfaceSha256) out.push("workSurface");
	if (canonicalJson(claimed.manifestClaims) !== canonicalJson(independent.manifestClaims)) out.push("manifestClaims");
	if (canonicalJson(claimed.groups) !== canonicalJson(independent.groups)) out.push("groups");
	if (!claimed.coreFiles || !independent.coreFiles) out.push("coreFiles: missing on one side");
	else if (canonicalJson(claimed.coreFiles) !== canonicalJson(independent.coreFiles)) out.push("coreFiles");
	return out;
}

export function composeRelease(input: ReleaseInput): ReleaseLedger {
	const contractErrors: string[] = [];
	const excluded: ReleaseLedger["release"]["excluded"] = [];
	const chainPos = new Map(input.firstParent.map((sha, i) => [sha, i]));
	if (input.firstParent[0] !== input.finalSha) contractErrors.push("firstParent must start with finalSha");

	// 1. Admission: provenance shape, chain membership, uniqueness, collection integrity.
	const seenAttempt = new Set<string>();
	const admitted: { run: CiRun; collection: Collection; complete: boolean; errors: string[] }[] = [];
	for (const run of input.runs) {
		const tag = `run ${run.runId}#${run.runAttempt}@${run.headSha.slice(0, 12)}`;
		if (!DIGITS.test(run.runId) || !DIGITS.test(run.runAttempt)) {
			contractErrors.push(`${tag}: runId/runAttempt are not CI provenance`);
			continue;
		}
		const key = `${run.runId}#${run.runAttempt}`;
		if (seenAttempt.has(key)) {
			contractErrors.push(`${tag}: the same run attempt is supplied twice`);
			continue;
		}
		seenAttempt.add(key);
		if (!chainPos.has(run.headSha)) {
			contractErrors.push(`${tag}: headSha is not on the first-parent chain of ${input.finalSha.slice(0, 12)}`);
			continue;
		}
		const { errors, collection } = checkCollectionData(mapReader(run.files), Object.keys(run.files).sort());
		if (!collection) {
			contractErrors.push(`${tag}: ${errors.join("; ")}`);
			continue;
		}
		if (collection.runId !== run.runId || collection.runAttempt !== run.runAttempt) {
			contractErrors.push(`${tag}: the collection records run ${collection.runId}#${collection.runAttempt}`);
			continue;
		}
		if (collection.candidate.head !== run.headSha) {
			contractErrors.push(`${tag}: the collection measured head ${collection.candidate.head}`);
			continue;
		}
		admitted.push({ run, collection, complete: errors.length === 0, errors });
	}

	// 2. One run per SHA: the newest attempt wins; the rest are superseded, never mixed in.
	const perSha = new Map<string, (typeof admitted)[number]>();
	for (const a of admitted) {
		const cur = perSha.get(a.run.headSha);
		if (!cur || newer(a.run, cur.run)) {
			if (cur) excluded.push({ ...refOf(cur.run), reason: `superseded by run ${a.run.runId}#${a.run.runAttempt}` });
			perSha.set(a.run.headSha, a);
		} else {
			excluded.push({ ...refOf(a.run), reason: `superseded by run ${cur.run.runId}#${cur.run.runAttempt}` });
		}
	}
	const finalEntry = perSha.get(input.finalSha);
	if (!finalEntry) contractErrors.push(`no CI collection at the final SHA ${input.finalSha.slice(0, 12)}`);
	else if (!finalEntry.complete)
		contractErrors.push(`final-SHA collection incomplete: ${finalEntry.errors.join("; ")}`);
	const used: (typeof admitted)[number][] = [];
	for (const [sha, a] of perSha) {
		if (sha !== input.finalSha && !a.complete) {
			excluded.push({ ...refOf(a.run), reason: `incomplete ancestor collection, not a basis: ${a.errors.join("; ")}` });
			continue;
		}
		used.push(a);
	}

	// 3. The final candidate: content from the independent recomputation, C0 environment
	//    part (node, node_modules) as the final run witnessed it.
	const crossCheck = finalEntry ? crossCheckCandidate(finalEntry.collection.candidate, input.independent) : [];
	const current: CurrentCandidate = {
		...input.independent,
		head: input.finalSha,
		// porcelainClean stays the INDEPENDENT candidate's own: a clean final tree is the
		// oracle's to produce and prove, never this function's to assume.
		coreSha256: finalEntry ? finalEntry.collection.candidate.coreSha256 : "unwitnessed",
	};

	// 4. Receipts in chain order (older first-parent position first), collection index next.
	const maxPos = input.firstParent.length;
	const loaded: LoadedReceipt[] = [];
	const receiptRun = new Map<string, RunRef>();
	const finalSources = new Set<string>();
	for (const a of used) {
		const base = (maxPos - (chainPos.get(a.run.headSha) ?? maxPos)) * 1_000_000;
		a.collection.attempted.forEach((att, i) => {
			if (att.outcome !== "receipt-written" || !att.file) return;
			const bytes = a.run.files[att.file];
			if (!bytes) return;
			if (a.run.headSha === input.finalSha) finalSources.add(`run ${a.run.runId}#${a.run.runAttempt}/${att.file}`);
			loaded.push({
				source: `run ${a.run.runId}#${a.run.runAttempt}/${att.file}`,
				text: bytes.toString("utf8"),
				seq: base + i,
			});
			try {
				receiptRun.set(JSON.parse(bytes.toString("utf8")).receiptSha256, refOf(a.run));
			} catch {
				// unparseable: composeLedger reports it as INVALID
			}
		});
	}

	// 5. The required set on the final SHA: runner, every group whose newest receipt among
	//    the ANCESTOR runs is red (the section that broke — computed before the final run,
	//    so re-measuring it green does not erase the requirement), operator-declared.
	const newestPassed = new Map<string, boolean>();
	for (const l of [...loaded].filter((x) => !finalSources.has(x.source)).sort((x, y) => (x.seq ?? 0) - (y.seq ?? 0))) {
		try {
			const r = JSON.parse(l.text);
			newestPassed.set(JSON.stringify(r.group.gate), r.result.passed === true);
		} catch {
			// INVALID, reported by composeLedger
		}
	}
	const requiredKeys = new Set<string>([JSON.stringify(input.independent.coreGroupGate)]);
	for (const [k, passed] of newestPassed) if (!passed) requiredKeys.add(k);
	for (const argv of input.operatorDeclared) requiredKeys.add(JSON.stringify(argv));
	const required = [...requiredKeys].map((k) => JSON.parse(k) as string[]);

	const ledger = composeLedger(loaded, current, undefined, { mode: "release", required });
	const red = contractErrors.length > 0 || crossCheck.length > 0;
	const verdict = red ? "RED" : ledger.verdict;
	const summary = [
		...(red ? [`[qualification-release] RED on ${input.finalSha.slice(0, 12)}`] : []),
		...contractErrors.map((e) => `  CONTRACT ${e}`),
		...crossCheck.map((e) => `  CROSS-CHECK ${e}: the CI-claimed candidate contradicts the final tree`),
		...excluded.map((e) => `  EXCLUDED run ${e.runId}#${e.runAttempt}@${e.headSha.slice(0, 12)}: ${e.reason}`),
		...ledger.summary,
	];
	const measured = ledger.groups.filter((g) => g.state === "MEASURED" && g.provenance === "exact");
	return {
		...ledger,
		verdict,
		summary,
		release: {
			finalSha: input.finalSha,
			contractErrors,
			crossCheck,
			used: used.map((a) => refOf(a.run)),
			excluded,
			required,
			denominator: {
				groups: ledger.counts.groups.total,
				claims: ledger.counts.claims.total,
				measuredOnFinal: {
					groups: measured.length,
					claims: measured.reduce((n, g) => n + g.claims.length, 0),
					list: measured.map((g) => g.gate.join(" ")),
				},
				inheritedCore: ledger.groups
					.filter((g) => g.state === "INHERITED-UNVERIFIED" && g.inheritKind === "c-core")
					.map((g) => ({
						gate: g.gate.join(" "),
						from: (g.decidedBy && receiptRun.get(g.decidedBy)) || null,
						reason: g.reasons[0],
					})),
				flagged: ledger.groups
					.filter((g) => g.flags.length > 0)
					.map((g) => `${g.gate.join(" ")}: ${g.flags.join("; ")}`),
				unrun: ledger.counts.groups.UNRUN,
				fail: ledger.counts.groups.FAIL,
			},
			provenance: [
				"inputs are whatever the caller supplied; this function does not fetch or authenticate them",
				"node/node_modules identity is the final run's own witness, not recomputed here",
				"no acceptance class is produced: RISK-PENDING awaits a human decision",
			],
		},
	};
}
