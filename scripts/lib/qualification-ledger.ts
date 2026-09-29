/**
 * qualification-ledger — compose PARTIAL group receipts into one candidate ledger (#124 P2).
 *
 * The composer is PURE: `composeLedger(receipts, current)` reads no file and runs no
 * gate. It answers one question per exact-argv group of the CURRENT committed manifest
 * set: what does the evidence on hand say about this group on THIS candidate?
 *
 *   (a) MEASURED               the newest receipt matching the current candidate exactly
 *                              (HEAD, work surface, C0, group spec set, claims, manifest
 *                              claim set, declared-input fingerprints) passed.
 *   (e) FAIL                   that newest exact-match receipt is red. Unresolved.
 *   (c) INHERITED-UNVERIFIED   no exact match, but a passing receipt for the same spec
 *                              set and claims exists on other bytes. Its mismatches are
 *                              listed; nothing is concluded from them.
 *   (d) UNRUN / INVALIDATED    no receipt, or only receipts whose spec set/claims moved,
 *                              or only red receipts on other bytes.
 *   (b) CARRIED                defined, never populated: a carry needs an audited
 *                              dependency projection and none exists. There is no code
 *                              path that promotes (c) to (b).
 *
 * A red on the current candidate is superseded only by a NEWER exact-match
 * re-measurement; the red stays in the group's history either way. A green that follows
 * a red on identical bytes is a nondeterminism signal and is flagged.
 *
 * Verdict (local — `FULL-GREEN` and `RISK-ACCEPTED` are not producible here):
 *   RED            a current FAIL (incl. tie), an invalid receipt, or an input list mismatch.
 *   NOT-QUALIFIED  no RISK can be proposed: dirty candidate, the runner's own group
 *                  (`check-gate-manifests`) not exact-MEASURED, a c-input group (declared
 *                  input moved), or a group whose newest receipt is red and not re-measured.
 *   RISK-PENDING   only named risks remain (c-core, UNRUN, flags incl. content-identical);
 *                  it proposes, never accepts, and authorizes no release.
 *   COMPOSITE-GREEN every group exact-MEASURED, no flag: "each group measured in its own
 *                  snapshot on these bytes" — NOT the serial full body.
 *
 * `receiptSha256` is re-derived to catch corruption; it cannot tell a runner-written
 * receipt from a hand-written one, and the ledger says so.
 */

import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import type { MutantSpec } from "./mutation-qualify.ts";
import { originHead, originWorkSurfaceSha } from "./mutation-qualify.ts";
import {
	CORE_FILES,
	canonicalJson,
	coreSha256,
	declaredInputPaths,
	fileFingerprints,
	nodeModulesFingerprint,
	nodeRuntime,
	RECEIPT_LABEL,
	RECEIPT_SCHEMA,
	sha256,
} from "./qualification-receipt.ts";

export const LEDGER_SCHEMA = "entwurf.qualification-ledger/v0";

export type GroupState = "MEASURED" | "CARRIED" | "INHERITED-UNVERIFIED" | "UNRUN" | "FAIL";
/**
 * What a LOCAL ledger may say. `FULL-GREEN` (the serial body at an exact SHA) and
 * `RISK-ACCEPTED` (a procedural human decision, not machine-authenticated) are deliberately NOT in this type:
 * no local composition can produce them.
 */
export type LedgerVerdict = "RED" | "NOT-QUALIFIED" | "RISK-PENDING" | "COMPOSITE-GREEN";
export type Provenance = "exact" | "content-identical";
export type InvalidCode =
	| "R-PARSE"
	| "R-SCHEMA"
	| "R-SHAPE"
	| "R-DIGEST"
	| "R-RESULT-INCONSISTENT"
	| "R-UNKNOWN-GROUP"
	| "R-DUPLICATE";

export interface CurrentGroup {
	gate: string[];
	claims: string[];
	specSetSha256: string;
	declaredInputs: Record<string, string>;
}

export interface CurrentCandidate {
	head: string;
	workSurfaceSha256: string;
	coreSha256: string;
	/** `git status --porcelain` empty: the work surface IS the committed tree. */
	porcelainClean: boolean;
	/** The group that proves the runner itself; it must be exact-MEASURED for any RISK proposal. */
	coreGroupGate: string[];
	/** CORE_FILES content fingerprints — the part of C0 anyone can recompute from the tree. */
	coreFiles?: Record<string, string>;
	/** Sorted claim ids of the whole committed set. */
	manifestClaims: string[];
	/** In manifest (= qualification run) order. */
	groups: CurrentGroup[];
}

/** A receipt as read from disk: its source name and raw text. Parsing happens in the composer. */
export interface LoadedReceipt {
	source: string;
	text: string;
	/**
	 * Explicit order key (higher = newer). When every receipt of a group carries one, it —
	 * not the receipt's own `startedAt` clock — decides order and ties. A release chain
	 * sets it from first-parent position, because clocks of different runs are not trusted.
	 */
	seq?: number;
}

/** One line of an explicit expected-input list (`sha256sum` format: `<sha256>  <path>`). */
export interface ExpectedInput {
	source: string;
	sha256: string;
}

interface ReceiptMutant {
	claim: string;
	verdict: string;
}

interface Receipt {
	schema: string;
	label: string;
	startedAt: string;
	candidate: { head: string; workSurfaceSha256: string };
	core: { sha256: string };
	group: { gate: string[]; specSetSha256: string; claims: string[]; declaredInputs: Record<string, string> };
	manifestSet: { claimCount: number; claims: string[] };
	result: { passed: boolean; control: string; mutants: ReceiptMutant[]; treeClean: boolean; porcelainClean: boolean };
	seal: { stable: boolean; nodeModulesExcludedDrift: string[] };
	receiptSha256: string;
}

export interface HistoryEntry {
	source: string;
	receiptSha256: string;
	startedAt: string;
	passed: boolean;
	/** Empty = exact match with the current candidate. */
	mismatch: string[];
}

export interface GroupLedger {
	gate: string[];
	claims: string[];
	state: GroupState;
	/** For MEASURED/FAIL: how the deciding receipt matched this candidate. */
	provenance: Provenance | null;
	/** For INHERITED-UNVERIFIED: c-core (only environment/surface moved) or c-input (a declared input moved). */
	inheritKind: "c-core" | "c-input" | null;
	flags: string[];
	reasons: string[];
	/** The receipt that decided the state, if any. */
	decidedBy: string | null;
	history: HistoryEntry[];
}

export interface Ledger {
	schema: string;
	candidate: { head: string; workSurfaceSha256: string; coreSha256: string; porcelainClean: boolean };
	verdict: LedgerVerdict;
	/** Why no RISK can even be proposed (verdict NOT-QUALIFIED). */
	blockers: string[];
	/** Named risks a RISK-PENDING ledger asks a human to accept or reject. Listing is not accepting. */
	risks: string[];
	/** Every input file with its digest. `local-file` is the only provenance this stage can state. */
	inputs: { source: string; sha256: string; provenance: "local-file" }[];
	inputErrors: string[];
	counts: {
		groups: Record<GroupState, number> & { total: number };
		claims: Record<GroupState, number> & { total: number };
		invalid: number;
	};
	groups: GroupLedger[];
	invalid: { source: string; code: InvalidCode; detail: string }[];
	notCovered: string[];
	summary: string[];
}

export const LEDGER_NOT_COVERED = [
	"COMPOSITE-GREEN is per-group snapshots on identical bytes, not the serial full body: inter-group order and state leaks are not exercised",
	"(b) CARRIED is never populated: no audited dependency projection exists",
	"undeclared inputs a gate reads by path or spawns; host tools; kernel/tmp state",
	"node_modules/.vite is excluded from identity by name; a group whose run drifted it is flagged cache-drift",
	"receiptSha256 detects corruption only; a hand-written receipt with a recomputed digest is indistinguishable",
];

// ── receipt validation (pure) ───────────────────────────────────────────────

const isStr = (v: unknown): v is string => typeof v === "string";
const isStrArr = (v: unknown): v is string[] => Array.isArray(v) && v.every(isStr);
const isObj = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);
const isStrRecord = (v: unknown): v is Record<string, string> => isObj(v) && Object.values(v).every(isStr);

function shapeError(r: Record<string, unknown>): string | null {
	const g = r.group;
	const res = r.result;
	const c = r.candidate;
	const seal = r.seal;
	const ms = r.manifestSet;
	if (!isStr(r.startedAt) || Number.isNaN(Date.parse(r.startedAt))) return "startedAt";
	if (!isObj(c) || !isStr(c.head) || !isStr(c.workSurfaceSha256)) return "candidate";
	if (!isObj(r.core) || !isStr(r.core.sha256)) return "core.sha256";
	if (
		!isObj(g) ||
		!isStrArr(g.gate) ||
		!isStr(g.specSetSha256) ||
		!isStrArr(g.claims) ||
		!isStrRecord(g.declaredInputs)
	) {
		return "group";
	}
	if (!isObj(ms) || !isStrArr(ms.claims)) return "manifestSet";
	if (
		!isObj(res) ||
		typeof res.passed !== "boolean" ||
		!isStr(res.control) ||
		typeof res.treeClean !== "boolean" ||
		typeof res.porcelainClean !== "boolean" ||
		!Array.isArray(res.mutants) ||
		!res.mutants.every((m) => isObj(m) && isStr(m.claim) && isStr(m.verdict))
	) {
		return "result";
	}
	if (!isObj(seal) || typeof seal.stable !== "boolean" || !isStrArr(seal.nodeModulesExcludedDrift)) return "seal";
	if (!isStr(r.receiptSha256)) return "receiptSha256";
	return null;
}

type Checked = { ok: true; receipt: Receipt } | { ok: false; code: InvalidCode; detail: string };

/** Validate one receipt on its own terms — no knowledge of the current candidate. */
export function checkReceipt(text: string): Checked {
	let raw: unknown;
	try {
		raw = JSON.parse(text);
	} catch (err) {
		return { ok: false, code: "R-PARSE", detail: err instanceof Error ? err.message : String(err) };
	}
	if (!isObj(raw)) return { ok: false, code: "R-PARSE", detail: "not a JSON object" };
	if (raw.schema !== RECEIPT_SCHEMA || raw.label !== RECEIPT_LABEL) {
		return { ok: false, code: "R-SCHEMA", detail: `schema=${String(raw.schema)} label=${String(raw.label)}` };
	}
	const bad = shapeError(raw);
	if (bad) return { ok: false, code: "R-SHAPE", detail: `missing or mistyped: ${bad}` };
	const { receiptSha256, ...body } = raw;
	if (sha256(canonicalJson(body)) !== receiptSha256) {
		return { ok: false, code: "R-DIGEST", detail: "receiptSha256 does not match the canonical body" };
	}
	const r = raw as unknown as Receipt;
	const mutantClaims = r.result.mutants.map((m) => m.claim);
	if (JSON.stringify(mutantClaims) !== JSON.stringify(r.group.claims)) {
		return { ok: false, code: "R-RESULT-INCONSISTENT", detail: "result.mutants claims differ from group.claims" };
	}
	const recomputed =
		r.result.mutants.length > 0 &&
		r.result.mutants.every((m) => m.verdict === "KILLED") &&
		r.result.control === "ok" &&
		r.result.treeClean &&
		r.result.porcelainClean &&
		r.seal.stable;
	if (recomputed !== r.result.passed) {
		return {
			ok: false,
			code: "R-RESULT-INCONSISTENT",
			detail: `result.passed=${r.result.passed} but verdicts/control/purity/seal say ${recomputed}`,
		};
	}
	return { ok: true, receipt: r };
}

// ── composition (pure) ──────────────────────────────────────────────────────

const UNRESOLVED_INPUT = (v: string): boolean =>
	v === "missing" || v === "outside-repo" || v === "special" || v.startsWith("link:");

function mismatchAgainst(r: Receipt, cur: CurrentCandidate, g: CurrentGroup): string[] {
	const out: string[] = [];
	if (r.candidate.head !== cur.head) out.push("head");
	if (r.candidate.workSurfaceSha256 !== cur.workSurfaceSha256) out.push("workSurface");
	if (r.core.sha256 !== cur.coreSha256) out.push("core");
	if (r.group.specSetSha256 !== g.specSetSha256) out.push("specSet");
	if (JSON.stringify(r.group.claims) !== JSON.stringify(g.claims)) out.push("claims");
	if (JSON.stringify([...r.manifestSet.claims].sort()) !== JSON.stringify(cur.manifestClaims)) out.push("manifestSet");
	const keys = new Set([...Object.keys(r.group.declaredInputs), ...Object.keys(g.declaredInputs)]);
	for (const k of [...keys].sort()) {
		if (r.group.declaredInputs[k] !== g.declaredInputs[k]) out.push(`declaredInput:${k}`);
	}
	return out;
}

const STATES: GroupState[] = ["MEASURED", "CARRIED", "INHERITED-UNVERIFIED", "UNRUN", "FAIL"];

/**
 * `ledgerPath`: where the caller writes the full ledger JSON. Only then may the console
 * summary compress the UNRUN list (count + first 5 + that path); without it, a
 * RISK-PENDING summary lists every unrun group, because a risk someone is asked to weigh
 * must be readable in full. FAIL, BLOCKER, INVALID, INPUT and the other RISK lines are
 * never compressed. `ledger.risks` and `ledger.groups` always hold everything.
 *
 * `expected` is optional for a LOCAL composition. The offline composite oracle
 * (qualification-oracle-core → composeRelease) passes none: its declared input list is each
 * collection's own `attempted[].sha256` (checkCollectionData) under the GitHub artifact
 * digest (admitArtifact), and an ancestor run it was not given leaves its groups UNRUN, a
 * release-mode blocker. It is not the release oracle: verify-exact-ci.sh stays the strict
 * exact-SHA full-body gate until #124 P3.
 */
export function composeLedger(
	loaded: LoadedReceipt[],
	cur: CurrentCandidate,
	expected?: ExpectedInput[],
	opts: {
		ledgerPath?: string;
		/** `release`: an UNRUN group is a blocker, and every `required` group must be exact-MEASURED. */
		mode?: "local" | "release";
		required?: string[][];
	} = {},
): Ledger {
	const invalid: Ledger["invalid"] = [];
	const byGroup = new Map<string, { source: string; r: Receipt; seq?: number }[]>();
	for (const g of cur.groups) byGroup.set(JSON.stringify(g.gate), []);
	const seen = new Set<string>();
	for (const l of loaded) {
		const c = checkReceipt(l.text);
		if (!c.ok) {
			invalid.push({ source: l.source, code: c.code, detail: c.detail });
			continue;
		}
		if (seen.has(c.receipt.receiptSha256)) {
			invalid.push({
				source: l.source,
				code: "R-DUPLICATE",
				detail: `receiptSha256 ${c.receipt.receiptSha256} already counted`,
			});
			continue;
		}
		seen.add(c.receipt.receiptSha256);
		const bucket = byGroup.get(JSON.stringify(c.receipt.group.gate));
		if (!bucket) {
			invalid.push({
				source: l.source,
				code: "R-UNKNOWN-GROUP",
				detail: `${JSON.stringify(c.receipt.group.gate)} is not an exact gate argv of the current manifest set`,
			});
			continue;
		}
		bucket.push({ source: l.source, r: c.receipt, seq: l.seq });
	}

	const groups: GroupLedger[] = cur.groups.map((g) => {
		const entries = (byGroup.get(JSON.stringify(g.gate)) ?? [])
			.slice()
			.sort((x, y) =>
				x.seq !== undefined && y.seq !== undefined
					? x.seq - y.seq
					: Date.parse(x.r.startedAt) - Date.parse(y.r.startedAt),
			);
		const orderOf = (e: { r: Receipt; seq?: number }): number => e.seq ?? Date.parse(e.r.startedAt);
		const history: HistoryEntry[] = entries.map(({ source, r }) => ({
			source,
			receiptSha256: r.receiptSha256,
			startedAt: r.startedAt,
			passed: r.result.passed,
			mismatch: mismatchAgainst(r, cur, g),
		}));
		const flags: string[] = [];
		const unresolved = Object.entries(g.declaredInputs).filter(([, v]) => UNRESOLVED_INPUT(v));
		if (unresolved.length > 0) flags.push(`input-unresolved:${unresolved.map(([k, v]) => `${k}=${v}`).join(",")}`);

		// Exact match first. Only when there is none, and only on a CLEAN candidate, may a
		// receipt whose sole difference is `head` stand in: the snapshot re-inits git
		// (mutation-qualify.ts createRepoSnapshot), so no gate can see origin history, and a
		// clean porcelain means the surface IS the committed tree. That is a LOCAL
		// content-identity statement, flagged, and it can never make a ledger green.
		const exactIdx = entries.map((_, i) => i).filter((i) => history[i].mismatch.length === 0);
		const contentIdx = cur.porcelainClean
			? entries.map((_, i) => i).filter((i) => history[i].mismatch.length === 1 && history[i].mismatch[0] === "head")
			: [];
		const provenance: Provenance | null =
			exactIdx.length > 0 ? "exact" : contentIdx.length > 0 ? "content-identical" : null;
		if (provenance) {
			const matching = (provenance === "exact" ? exactIdx : contentIdx).map((i) => entries[i]);
			const newest = matching[matching.length - 1];
			if (provenance === "content-identical") {
				flags.push(`content-identical(head ${newest.r.candidate.head.slice(0, 12)}→${cur.head.slice(0, 12)})`);
			}
			// Two matches at the SAME newest instant that disagree cannot be ordered;
			// picking one would be arbitrary, so the group stays an unresolved FAIL.
			const tied = matching.filter((e) => orderOf(e) === orderOf(newest));
			const base = { gate: g.gate, claims: g.claims, provenance, inheritKind: null, flags, history };
			if (tied.some((e) => e.r.result.passed !== newest.r.result.passed)) {
				return {
					...base,
					state: "FAIL",
					reasons: [`tie: ${tied.length} matching receipts at ${newest.r.startedAt} disagree`],
					decidedBy: null,
				};
			}
			const redBefore = matching.slice(0, -1).some((e) => !e.r.result.passed);
			// Tied receipts that agree on `passed` may still differ elsewhere; the drift flag is
			// taken over ALL of them so no tie-break decides it. Other per-receipt differences
			// among agreeing ties (decidedBy, reasons) remain a future-risk: decidedBy names
			// the last in input order.
			if (tied.some((e) => e.r.seal.nodeModulesExcludedDrift.length > 0)) flags.push("cache-drift");
			if (newest.r.result.passed) {
				if (redBefore) flags.push("red-then-green-same-candidate");
				return {
					...base,
					state: "MEASURED",
					reasons: redBefore ? ["an earlier red on these bytes is superseded but kept in history"] : [],
					decidedBy: newest.r.receiptSha256,
				};
			}
			const notKilled = newest.r.result.mutants
				.filter((m) => m.verdict !== "KILLED")
				.map((m) => `${m.claim}=${m.verdict}`);
			const why = [
				...notKilled,
				...(newest.r.result.control !== "ok" ? [`control=${newest.r.result.control}`] : []),
				...(!newest.r.result.treeClean || !newest.r.result.porcelainClean ? ["snapshot impure"] : []),
				...(!newest.r.seal.stable ? ["seal moved during the run"] : []),
			];
			return { ...base, state: "FAIL", reasons: why, decidedBy: newest.r.receiptSha256 };
		}

		const inheritable = entries
			.map((e, i) => ({ e, h: history[i] }))
			.filter(({ e, h }) => e.r.result.passed && !h.mismatch.includes("specSet") && !h.mismatch.includes("claims"));
		if (inheritable.length > 0) {
			const { e, h } = inheritable[inheritable.length - 1];
			const inheritKind = h.mismatch.some((m) => m.startsWith("declaredInput:")) ? "c-input" : "c-core";
			return {
				gate: g.gate,
				claims: g.claims,
				state: "INHERITED-UNVERIFIED",
				provenance: null,
				inheritKind,
				flags,
				reasons: [`passed on other bytes; differs in: ${h.mismatch.join(", ")}`],
				decidedBy: e.r.receiptSha256,
				history,
			};
		}
		const reasons =
			entries.length === 0
				? ["no receipt"]
				: [
						`no usable receipt: ${history.map((h) => `${h.passed ? "green" : "red"}[${h.mismatch.join(",")}]`).join("; ")}`,
					];
		return {
			gate: g.gate,
			claims: g.claims,
			state: "UNRUN",
			provenance: null,
			inheritKind: null,
			flags,
			reasons,
			decidedBy: null,
			history,
		};
	});

	const zero = (): Record<GroupState, number> & { total: number } =>
		Object.assign(Object.fromEntries(STATES.map((s) => [s, 0])) as Record<GroupState, number>, { total: 0 });
	const gCounts = zero();
	const cCounts = zero();
	for (const g of groups) {
		gCounts[g.state]++;
		gCounts.total++;
		cCounts[g.state] += g.claims.length;
		cCounts.total += g.claims.length;
	}
	const flagged = groups.filter((g) => g.flags.length > 0);
	const label = (g: GroupLedger): string => g.gate.join(" ");

	// Inputs: every file is listed with its digest. An explicit expected list turns a
	// missing, extra or altered input into RED — evidence that vanished is not UNRUN.
	const inputs = loaded.map((l) => ({ source: l.source, sha256: sha256(l.text), provenance: "local-file" as const }));
	const inputErrors: string[] = [];
	if (expected) {
		const have = new Map(inputs.map((i) => [i.source, i.sha256]));
		const want = new Map(expected.map((e) => [e.source, e.sha256]));
		for (const [src, sha] of want) {
			if (!have.has(src)) inputErrors.push(`input-missing: ${src}`);
			else if (have.get(src) !== sha) inputErrors.push(`input-digest: ${src} is ${have.get(src)}, expected ${sha}`);
		}
		for (const src of have.keys()) if (!want.has(src)) inputErrors.push(`input-unexpected: ${src}`);
	}

	// Blockers: states under which no RISK may even be proposed. The minimum a proposal
	// needs is the runner's own group exact-MEASURED on these bytes, every red re-measured,
	// every group whose declared inputs moved re-measured, and a committed (clean) candidate.
	const blockers: string[] = [];
	if (!cur.porcelainClean) blockers.push("candidate-dirty: uncommitted changes, not a release candidate");
	const coreGroup = groups.find((g) => JSON.stringify(g.gate) === JSON.stringify(cur.coreGroupGate));
	if (!coreGroup || coreGroup.state !== "MEASURED" || coreGroup.provenance !== "exact") {
		blockers.push(`core-group-not-measured: ${cur.coreGroupGate.join(" ")} must be exact-MEASURED on these bytes`);
	}
	for (const g of groups) {
		if (g.state === "INHERITED-UNVERIFIED" && g.inheritKind === "c-input") {
			blockers.push(`c-input: ${label(g)} — a declared input changed since its last pass; re-measure it`);
		}
		const newest = g.history[g.history.length - 1];
		if ((g.state === "UNRUN" || g.state === "INHERITED-UNVERIFIED") && newest && !newest.passed) {
			blockers.push(`red-unremeasured: ${label(g)} — its newest receipt is red; re-measure it`);
		}
		if (opts.mode === "release" && g.state === "UNRUN") {
			blockers.push(`unrun (release): ${label(g)} — no usable pass receipt in the chain; measure it`);
		}
	}
	for (const argv of opts.required ?? []) {
		const g = groups.find((x) => JSON.stringify(x.gate) === JSON.stringify(argv));
		if (!g || g.state !== "MEASURED" || g.provenance !== "exact") {
			blockers.push(`required-not-measured: ${argv.join(" ")} must be exact-MEASURED on these bytes`);
		}
	}
	const risks = [
		...groups
			.filter((g) => g.state === "INHERITED-UNVERIFIED" && g.inheritKind === "c-core")
			.map((g) => `c-core: ${label(g)} (${g.reasons[0]})`),
		...groups.filter((g) => g.state === "UNRUN").map((g) => `unrun: ${label(g)} (${g.claims.length} claims)`),
		...flagged.map((g) => `flag: ${label(g)}: ${g.flags.join("; ")}`),
	];

	// RED: an unresolved failure on these bytes, or evidence that cannot be read or is
	// not the evidence declared. Fail-closed; nothing here is a risk to accept.
	const verdict: LedgerVerdict =
		gCounts.FAIL > 0 || invalid.length > 0 || inputErrors.length > 0
			? "RED"
			: blockers.length > 0
				? "NOT-QUALIFIED"
				: gCounts.MEASURED === gCounts.total && gCounts.total > 0 && flagged.length === 0
					? "COMPOSITE-GREEN"
					: "RISK-PENDING";

	const summary = [
		`[qualification-ledger] ${verdict} on ${cur.head.slice(0, 12)}${cur.porcelainClean ? "" : " (dirty)"} surface ${cur.workSurfaceSha256.slice(0, 12)} core ${cur.coreSha256.slice(0, 12)}`,
		`  groups ${gCounts.total}: MEASURED ${gCounts.MEASURED}, CARRIED ${gCounts.CARRIED}, INHERITED-UNVERIFIED ${gCounts["INHERITED-UNVERIFIED"]}, UNRUN ${gCounts.UNRUN}, FAIL ${gCounts.FAIL}`,
		`  claims ${cCounts.total}: MEASURED ${cCounts.MEASURED}, INHERITED-UNVERIFIED ${cCounts["INHERITED-UNVERIFIED"]}, UNRUN ${cCounts.UNRUN}, FAIL ${cCounts.FAIL}; invalid receipts ${invalid.length}`,
		...groups.filter((g) => g.state === "FAIL").map((g) => `  FAIL ${label(g)}: ${g.reasons.join("; ")}`),
		...invalid.map((i) => `  INVALID ${i.source}: ${i.code} ${i.detail}`),
		...inputErrors.map((e) => `  INPUT ${e}`),
		...blockers.map((b) => `  BLOCKER ${b}`),
		...summarizeRisks(risks, verdict, opts.ledgerPath),
		verdict === "COMPOSITE-GREEN"
			? `  ${cCounts.MEASURED}/${cCounts.total} claims measured on these bytes (per-group snapshots, not the serial full body)`
			: verdict === "RISK-PENDING"
				? "  RISK-PENDING: named risks above await a human decision; this ledger accepts nothing and authorizes no release"
				: verdict === "NOT-QUALIFIED"
					? "  NOT-QUALIFIED: no risk can be proposed until the blockers above are measured away"
					: "  RED: an unresolved failure, or evidence that is unreadable or not the evidence declared",
	];

	return {
		schema: LEDGER_SCHEMA,
		candidate: {
			head: cur.head,
			workSurfaceSha256: cur.workSurfaceSha256,
			coreSha256: cur.coreSha256,
			porcelainClean: cur.porcelainClean,
		},
		verdict,
		blockers,
		risks,
		inputs,
		inputErrors,
		counts: { groups: gCounts, claims: cCounts, invalid: invalid.length },
		groups,
		invalid,
		notCovered: LEDGER_NOT_COVERED,
		summary,
	};
}

const UNRUN_SHOWN = 5;

function summarizeRisks(risks: string[], verdict: LedgerVerdict, ledgerPath: string | undefined): string[] {
	const unrun = risks.filter((r) => r.startsWith("unrun: "));
	const other = risks.filter((r) => !r.startsWith("unrun: ")).map((r) => `  RISK ${r}`);
	const mustBeFull = verdict === "RISK-PENDING" && ledgerPath === undefined;
	if (mustBeFull || unrun.length <= UNRUN_SHOWN) return [...other, ...unrun.map((r) => `  RISK ${r}`)];
	const where = ledgerPath ? `full list: ${ledgerPath}` : "full list: pass --ledger-out";
	return [
		...other,
		`  RISK unrun: ${unrun.length} groups — first ${UNRUN_SHOWN}: ${unrun
			.slice(0, UNRUN_SHOWN)
			.map((r) => r.slice("unrun: ".length))
			.join("; ")}; ${where}`,
	];
}

// ── impure edges ────────────────────────────────────────────────────────────

export function loadReceipt(file: string): LoadedReceipt {
	return { source: file, text: fs.readFileSync(file, "utf8") };
}

/** The current candidate, computed with the SAME functions the receipt producer uses. */
export const CORE_GROUP_GATE = ["bash", "run.sh", "check-gate-manifests"];

/** Parse a `sha256sum`-format list (`<64 hex>  <path>` per line); anything else throws. */
export function parseExpectedList(text: string): ExpectedInput[] {
	return text
		.split("\n")
		.filter((l) => l.trim() !== "")
		.map((l, i) => {
			const m = /^([0-9a-f]{64}) [ *](.+)$/.exec(l);
			if (!m) throw new Error(`expected-input list line ${i + 1} is not \`<sha256>  <path>\`: ${l}`);
			return { sha256: m[1], source: m[2] };
		});
}

/**
 * A candidate's CONTENT projection: everything recomputable from the tree itself (head,
 * surface, porcelain, CORE_FILES, manifest, groups). It deliberately has no `coreSha256`:
 * the node/node_modules part of C0 belongs to the environment that ran the gates, and
 * whoever holds only the tree must not fill it in.
 */
export type ContentCandidate = Omit<CurrentCandidate, "coreSha256">;

export function contentCandidate(
	repoDir: string,
	selected: MutantSpec[],
	coreGroupGate: string[] = CORE_GROUP_GATE,
): ContentCandidate {
	const order: string[] = [];
	const specs = new Map<string, MutantSpec[]>();
	for (const m of selected) {
		const k = JSON.stringify(m.gate);
		if (!specs.has(k)) {
			specs.set(k, []);
			order.push(k);
		}
		specs.get(k)?.push(m);
	}
	return {
		head: originHead(repoDir),
		workSurfaceSha256: originWorkSurfaceSha(repoDir),
		coreFiles: fileFingerprints(repoDir, CORE_FILES),
		porcelainClean: spawnSync("git", ["-C", repoDir, "status", "--porcelain"], { encoding: "utf8" }).stdout === "",
		coreGroupGate,
		manifestClaims: selected.map((m) => m.claim).sort(),
		groups: order.map((k) => {
			const gs = specs.get(k) ?? [];
			const gate = JSON.parse(k) as string[];
			return {
				gate,
				claims: gs.map((m) => m.claim),
				specSetSha256: sha256(canonicalJson(gs)),
				declaredInputs: fileFingerprints(repoDir, declaredInputPaths(repoDir, gs, gate)),
			};
		}),
	};
}

/** The full local candidate: the content projection plus THIS host's node/node_modules C0. */
export function currentCandidate(
	repoDir: string,
	selected: MutantSpec[],
	coreGroupGate: string[] = CORE_GROUP_GATE,
): CurrentCandidate {
	const content = contentCandidate(repoDir, selected, coreGroupGate);
	const core = {
		files: content.coreFiles ?? {},
		node: nodeRuntime(),
		nodeModules: nodeModulesFingerprint(repoDir).summary,
	};
	return { ...content, coreSha256: coreSha256(core) };
}
