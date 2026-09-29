/**
 * qualification-acceptance — check that a written risk-acceptance RECORD is consistent with
 * the RISK-PENDING release ledger it names (#124 P2). PURE: no network, no fs, no git.
 *
 * What it checks: the record's shape, that the ledger is RISK-PENDING and carries no
 * refusal state, that the record's digest is the ledger's canonical digest recomputed
 * HERE, that final SHA / required groups / the exact risk list (order and duplicates
 * included) match, and that the ledger's risk list is what its own groups imply
 * (re-derived here, independently of the composer).
 *
 * What it does NOT check, and never claims:
 *   - that the utterance is genuine, or who said it. `transcribedBy` names who wrote the
 *     record down; it is not an authenticator, and a file is not a person.
 *   - that the ledger is TRUE. A matching digest says the record names these ledger bytes;
 *     it says nothing about whether the evidence behind them is what it claims.
 *
 * Hence the only non-refusal outcome is RECORD-CONSISTENT (statement not authenticated).
 * A release-class acceptance is not produced here: this module has no such output.
 */

import type { GroupLedger } from "./qualification-ledger.ts";
import { canonicalJson, sha256 } from "./qualification-receipt.ts";
import type { ReleaseLedger } from "./qualification-release.ts";

export const ACCEPTANCE_SCHEMA = "entwurf.qualification-risk-acceptance/v0";
export const RECORD_CONSISTENT = "RECORD-CONSISTENT (statement not authenticated)";

export interface AcceptanceRecord {
	schema: typeof ACCEPTANCE_SCHEMA;
	finalSha: string;
	ledgerSha256: string;
	risks: string[];
	required: string[][];
	/** GLG's words, verbatim. Not normalized, not verified. */
	utterance: string;
	/** YYYY-MM-DD (KST), a real calendar date. */
	acceptedOn: string;
	/** Who wrote the record down. Not an authenticator. */
	transcribedBy: string;
}

export interface AcceptanceCheck {
	outcome: typeof RECORD_CONSISTENT | "REFUSED";
	errors: string[];
}

const KEYS = ["acceptedOn", "finalSha", "ledgerSha256", "required", "risks", "schema", "transcribedBy", "utterance"];
const isStr = (v: unknown): v is string => typeof v === "string";
const isStrArr = (v: unknown): v is string[] => Array.isArray(v) && v.every(isStr);

/** A real calendar date, not only a date-shaped string (2026-02-30 is refused). */
export function isRealDate(s: string): boolean {
	const m = /^([0-9]{4})-([0-9]{2})-([0-9]{2})$/.exec(s);
	if (!m) return false;
	const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
	return d.toISOString().slice(0, 10) === s;
}

/** The risks a ledger's own groups imply — derived here, not read from `ledger.risks`. */
export function rederiveRisks(groups: GroupLedger[]): string[] {
	const out: string[] = [];
	for (const g of groups) {
		const gate = g.gate.join(" ");
		if (g.state === "INHERITED-UNVERIFIED" && g.inheritKind === "c-core") out.push(`c-core: ${gate} (${g.reasons[0]})`);
		if (g.state === "UNRUN") out.push(`unrun: ${gate} (${g.claims.length} claims)`);
		if (g.flags.length > 0) out.push(`flag: ${gate}: ${g.flags.join("; ")}`);
	}
	return out;
}

const multiset = (xs: string[]): string => canonicalJson([...xs].sort());

/**
 * The refusal states a RISK-PENDING release ledger cannot carry, derived here from its
 * groups, candidate and required list — not read from its own `blockers`.
 */
export function rederiveRefusals(ledger: ReleaseLedger): string[] {
	const out: string[] = [];
	const exact = new Set(
		ledger.groups.filter((g) => g.state === "MEASURED" && g.provenance === "exact").map((g) => JSON.stringify(g.gate)),
	);
	for (const g of ledger.groups) {
		if (g.state === "UNRUN" || g.state === "FAIL") out.push(`${g.state}: ${g.gate.join(" ")}`);
		if (g.state === "INHERITED-UNVERIFIED" && g.inheritKind === "c-input") out.push(`c-input: ${g.gate.join(" ")}`);
	}
	for (const argv of ledger.release.required) {
		if (!exact.has(JSON.stringify(argv))) out.push(`required-not-exact: ${argv.join(" ")}`);
	}
	if (!ledger.candidate.porcelainClean) out.push("candidate dirty");
	return out;
}

export function checkAcceptanceRecord(ledger: ReleaseLedger, record: unknown): AcceptanceCheck {
	const errors: string[] = [];
	const refuse = (): AcceptanceCheck => ({ outcome: "REFUSED", errors });
	if (record === null || typeof record !== "object" || Array.isArray(record)) {
		errors.push("record: not an object");
		return refuse();
	}
	const r = record as Record<string, unknown>;
	const keys = Object.keys(r).sort();
	if (canonicalJson(keys) !== canonicalJson(KEYS)) {
		errors.push(`record: keys must be exactly ${KEYS.join(", ")}; got ${keys.join(", ")}`);
		return refuse();
	}
	if (r.schema !== ACCEPTANCE_SCHEMA) errors.push(`record: schema must be ${ACCEPTANCE_SCHEMA}`);
	if (!isStr(r.finalSha) || !/^[0-9a-f]{40}$/.test(r.finalSha)) errors.push("record: finalSha must be 40-hex");
	if (!isStr(r.ledgerSha256) || !/^[0-9a-f]{64}$/.test(r.ledgerSha256))
		errors.push("record: ledgerSha256 must be 64-hex");
	if (!isStrArr(r.risks)) errors.push("record: risks must be a string array");
	if (!Array.isArray(r.required) || !r.required.every(isStrArr)) errors.push("record: required must be argv arrays");
	if (!isStr(r.utterance) || r.utterance.trim() === "") errors.push("record: utterance must be non-empty");
	if (!isStr(r.transcribedBy) || r.transcribedBy.trim() === "") errors.push("record: transcribedBy must be non-empty");
	if (!isStr(r.acceptedOn) || !/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(r.acceptedOn)) {
		errors.push("record: acceptedOn must be YYYY-MM-DD");
	} else if (!isRealDate(r.acceptedOn)) {
		errors.push(`record: acceptedOn ${r.acceptedOn} is not a real date`);
	}
	if (errors.length > 0) return refuse();
	const rec = r as unknown as AcceptanceRecord;

	// The ledger: only a RISK-PENDING one is something a human can be asked about.
	if (ledger.verdict !== "RISK-PENDING") errors.push(`ledger: verdict is ${ledger.verdict}, not RISK-PENDING`);
	if (ledger.risks.length === 0) errors.push("ledger: RISK-PENDING with no named risk");
	if (ledger.blockers.length > 0) errors.push(`ledger: blockers present (${ledger.blockers.length})`);
	if (ledger.invalid.length > 0 || ledger.inputErrors.length > 0) errors.push("ledger: invalid or unexpected inputs");
	if (ledger.counts.groups.FAIL > 0) errors.push("ledger: a FAIL group is present");
	if (ledger.release.contractErrors.length > 0 || ledger.release.crossCheck.length > 0)
		errors.push("ledger: release contract or cross-check errors present");
	const refusals = rederiveRefusals(ledger);
	if (refusals.length > 0) errors.push(`ledger: refusal state in its own groups/candidate: ${refusals.join("; ")}`);
	if (multiset(rederiveRisks(ledger.groups)) !== multiset(ledger.risks))
		errors.push("ledger: its risk list is not what its own groups imply");

	// The record names exactly these ledger bytes and this decision.
	if (sha256(canonicalJson(ledger)) !== rec.ledgerSha256)
		errors.push("record: ledgerSha256 is not the recomputed digest of this ledger");
	if (rec.finalSha !== ledger.release.finalSha || rec.finalSha !== ledger.candidate.head)
		errors.push("record: finalSha is not this ledger's final SHA");
	if (canonicalJson(rec.risks) !== canonicalJson(ledger.risks))
		errors.push("record: risks are not exactly the ledger's risks (order and duplicates included)");
	if (canonicalJson(rec.required) !== canonicalJson(ledger.release.required))
		errors.push("record: required groups are not exactly the ledger's");

	return errors.length > 0 ? refuse() : { outcome: RECORD_CONSISTENT, errors };
}
