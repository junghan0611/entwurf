/**
 * qualification-collection — run several exact-argv groups in one process and record
 * what was attempted (#124 step 1).
 *
 * `check-gate-qualification.ts --groups '<JSON array of argv>' --collect <dir>` runs the
 * head once, then each requested group in order, each through runGroupReceipt on its
 * own fresh snapshot. The collection is an inventory, NOT a verdict:
 *
 *   - a group that goes red (SURVIVED, WRONG-REASON, STALE, HANG, control-red, impure
 *     snapshot) still writes its receipt, and the tail keeps running — the next group
 *     gets a fresh snapshot, so that contamination stays inside the red group;
 *   - a runner crash (an exception in the body), an origin seal that moved during a
 *     group, or a receipt whose candidate differs from the one the collection started on
 *     (bytes moved BETWEEN groups) STOPS the collection: the candidate is no longer the
 *     one being measured, or the runner itself is broken. The rest are `not-attempted`;
 *   - `collection.json` is rewritten atomically after every group, so a process that dies
 *     mid-run leaves an honest, incomplete inventory behind rather than nothing.
 *
 * `complete` means only "every requested group wrote a receipt". Whether those receipts
 * qualify anything is the ledger's question, never this file's.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type { MutantSpec } from "./mutation-qualify.ts";
import { type CurrentCandidate, checkReceipt, currentCandidate } from "./qualification-ledger.ts";
import { canonicalJson, runGroupReceipt, sha256 } from "./qualification-receipt.ts";

export const COLLECTION_SCHEMA = "entwurf.qualification-collection/v0";
export const COLLECTION_LABEL = "collection — an inventory of attempted groups, not a verdict";
export const COLLECTION_FILE = "collection.json";

export type AttemptOutcome = "receipt-written" | "runner-crash" | "not-attempted";

export interface Attempt {
	argv: string[];
	outcome: AttemptOutcome;
	/** Receipt file name inside the collection dir, when one was written. */
	file: string | null;
	sha256: string | null;
	detail: string | null;
}

export interface Collection {
	schema: string;
	label: string;
	/** GITHUB_RUN_ID / GITHUB_RUN_ATTEMPT exactly as the environment gave them; null off CI. */
	runId: string | null;
	runAttempt: string | null;
	startedAt: string;
	finishedAt: string | null;
	requested: string[][];
	manifestClaimsSha256: string;
	candidate: CurrentCandidate;
	attempted: Attempt[];
	stoppedBy: null | "runner-crash" | "seal-moved" | "candidate-drift";
	complete: boolean;
}

/** `--groups all`: every exact gate argv of the committed set, once, in manifest order. */
export function allGroupArgv(selected: MutantSpec[]): string[][] {
	const seen = new Set<string>();
	const out: string[][] = [];
	for (const m of selected) {
		const k = JSON.stringify(m.gate);
		if (!seen.has(k)) {
			seen.add(k);
			out.push(m.gate);
		}
	}
	return out;
}

/** Refuse, before any snapshot: an empty list, a duplicated argv, or one no committed group has. */
export function checkRequestedGroups(requested: string[][], selected: MutantSpec[]): void {
	if (requested.length === 0) throw new Error("--groups is empty — nothing to collect");
	const known = new Set(selected.map((m) => JSON.stringify(m.gate)));
	const seen = new Set<string>();
	for (const argv of requested) {
		const k = JSON.stringify(argv);
		if (seen.has(k)) throw new Error(`--groups repeats ${k}`);
		seen.add(k);
		if (!known.has(k)) throw new Error(`--groups names ${k}, which is no exact gate argv of the committed manifests`);
	}
}

/** `gNNN.json` for attempt index NNN — the ONLY file name a collection may declare. */
export function receiptFileName(index: number): string {
	return `g${String(index).padStart(3, "0")}.json`;
}

/**
 * Every way a receipt differs from the candidate its collection started on, for its own
 * group: head, surface, C0, manifest claim set, spec set, claims, declared inputs. Empty =
 * this receipt measured the collection's candidate. Shared by the collector (stop) and
 * checkCollection (re-read), so the two cannot disagree.
 */
export function candidateDrift(receiptText: string, c: Pick<Collection, "candidate">, argv: string[]): string[] {
	const checked = checkReceipt(receiptText);
	if (!checked.ok) return [`receipt ${checked.code}: ${checked.detail}`];
	const r = checked.receipt;
	const cur = c.candidate;
	const g = cur.groups.find((x) => JSON.stringify(x.gate) === JSON.stringify(argv));
	if (!g) return [`argv ${JSON.stringify(argv)} is not a group of the collection's candidate`];
	const out: string[] = [];
	if (JSON.stringify(r.group.gate) !== JSON.stringify(argv)) out.push("gate");
	if (r.candidate.head !== cur.head) out.push("head");
	if (r.candidate.workSurfaceSha256 !== cur.workSurfaceSha256) out.push("workSurface");
	if (r.core.sha256 !== cur.coreSha256) out.push("core");
	if (JSON.stringify([...r.manifestSet.claims].sort()) !== JSON.stringify(cur.manifestClaims)) out.push("manifestSet");
	if (r.group.specSetSha256 !== g.specSetSha256) out.push("specSet");
	if (JSON.stringify(r.group.claims) !== JSON.stringify(g.claims)) out.push("claims");
	if (canonicalJson(r.group.declaredInputs) !== canonicalJson(g.declaredInputs)) out.push("declaredInputs");
	return out;
}

const O_NOFOLLOW_FLAG = typeof fs.constants.O_NOFOLLOW === "number" ? fs.constants.O_NOFOLLOW : 0;
const O_NONBLOCK_FLAG = typeof fs.constants.O_NONBLOCK === "number" ? fs.constants.O_NONBLOCK : 0;

/**
 * Read one entry of a collection dir by BASENAME only, deciding its kind on the very
 * descriptor that is read (pattern of meta-session.ts readStoreRecordFile): a symlink at
 * the name fails the open (ELOOP), a fifo does not block (O_NONBLOCK), and fstat refuses
 * anything that is not a regular file. A name with a separator never reaches the fs.
 */
function readEntry(dir: string, name: string): { ok: true; bytes: Buffer } | { ok: false; why: string } {
	if (name !== path.basename(name) || name === "." || name === "..") return { ok: false, why: "not a basename" };
	if (O_NOFOLLOW_FLAG === 0) return { ok: false, why: "platform has no O_NOFOLLOW" };
	let fd: number;
	try {
		fd = fs.openSync(path.join(dir, name), fs.constants.O_RDONLY | O_NOFOLLOW_FLAG | O_NONBLOCK_FLAG);
	} catch (err) {
		return { ok: false, why: (err as NodeJS.ErrnoException).code ?? String(err) };
	}
	try {
		if (!fs.fstatSync(fd).isFile()) return { ok: false, why: "not a regular file" };
		return { ok: true, bytes: fs.readFileSync(fd) };
	} finally {
		fs.closeSync(fd);
	}
}

function writeCollection(dir: string, c: Collection): void {
	const file = path.join(dir, COLLECTION_FILE);
	const tmp = `${file}.tmp-${process.pid}`;
	const fd = fs.openSync(tmp, "wx", 0o600);
	try {
		fs.writeFileSync(fd, `${JSON.stringify(c, null, "\t")}\n`);
		fs.fsyncSync(fd);
	} finally {
		fs.closeSync(fd);
	}
	fs.renameSync(tmp, file);
}

export interface CollectOptions {
	repoDir: string;
	selected: MutantSpec[];
	requested: string[][];
	/** Must not exist yet; its parent must. Created 0700. */
	collectDir: string;
	log: (line: string) => void;
	logError: (line: string) => void;
	tmpRoot?: string;
	coreGroupGate?: string[];
	env?: NodeJS.ProcessEnv;
	/** Test seam only: runs before group i starts (the self-test moves origin bytes here). */
	beforeGroup?: (index: number) => void;
}

export async function collectGroups(opts: CollectOptions): Promise<Collection> {
	checkRequestedGroups(opts.requested, opts.selected);
	fs.mkdirSync(opts.collectDir, { mode: 0o700 });
	const env = opts.env ?? process.env;
	const c: Collection = {
		schema: COLLECTION_SCHEMA,
		label: COLLECTION_LABEL,
		runId: env.GITHUB_RUN_ID ?? null,
		runAttempt: env.GITHUB_RUN_ATTEMPT ?? null,
		startedAt: new Date().toISOString(),
		finishedAt: null,
		requested: opts.requested,
		manifestClaimsSha256: sha256(canonicalJson(opts.selected.map((m) => m.claim).sort())),
		candidate: currentCandidate(opts.repoDir, opts.selected, opts.coreGroupGate),
		attempted: opts.requested.map((argv) => ({
			argv,
			outcome: "not-attempted",
			file: null,
			sha256: null,
			detail: null,
		})),
		stoppedBy: null,
		complete: false,
	};
	writeCollection(opts.collectDir, c);

	for (let i = 0; i < opts.requested.length; i++) {
		opts.beforeGroup?.(i);
		const argv = opts.requested[i];
		const file = receiptFileName(i);
		const receiptPath = path.join(opts.collectDir, file);
		try {
			const r = await runGroupReceipt({
				repoDir: opts.repoDir,
				selected: opts.selected,
				gate: argv,
				receiptPath,
				log: opts.log,
				logError: opts.logError,
				tmpRoot: opts.tmpRoot,
			});
			c.attempted[i] = {
				argv,
				outcome: "receipt-written",
				file,
				sha256: sha256(fs.readFileSync(receiptPath)),
				detail: r.passed ? "group-green" : "group-RED",
			};
			if (!r.sealStable) c.stoppedBy = "seal-moved";
			else {
				const drift = candidateDrift(fs.readFileSync(receiptPath, "utf8"), c, argv);
				if (drift.length > 0) {
					c.attempted[i].detail = `${c.attempted[i].detail}; candidate drift: ${drift.join(", ")}`;
					c.stoppedBy = "candidate-drift";
				}
			}
		} catch (err) {
			c.attempted[i] = {
				argv,
				outcome: "runner-crash",
				file: null,
				sha256: null,
				detail: err instanceof Error ? err.message : String(err),
			};
			c.stoppedBy = "runner-crash";
		}
		writeCollection(opts.collectDir, c);
		if (c.stoppedBy) {
			opts.logError(`[gate-qualification --groups] STOP after ${JSON.stringify(argv)}: ${c.stoppedBy}`);
			break;
		}
	}
	c.complete = c.stoppedBy === null && c.attempted.every((a) => a.outcome === "receipt-written");
	c.finishedAt = new Date().toISOString();
	writeCollection(opts.collectDir, c);
	return c;
}

const isStringArray = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === "string");
const isStringRecord = (v: unknown): boolean =>
	v !== null && typeof v === "object" && !Array.isArray(v) && Object.values(v).every((x) => typeof x === "string");

/** Deep shape of a collection's `candidate` — every field candidateDrift reads, so a malformed one is reported, not thrown. */
export function candidateShapeOk(v: unknown): boolean {
	if (v === null || typeof v !== "object" || Array.isArray(v)) return false;
	const c = v as Record<string, unknown>;
	return (
		typeof c.head === "string" &&
		typeof c.workSurfaceSha256 === "string" &&
		typeof c.coreSha256 === "string" &&
		(c.coreFiles === undefined || isStringRecord(c.coreFiles)) &&
		isStringArray(c.manifestClaims) &&
		Array.isArray(c.groups) &&
		c.groups.every((g) => {
			if (g === null || typeof g !== "object" || Array.isArray(g)) return false;
			const x = g as Record<string, unknown>;
			return (
				isStringArray(x.gate) &&
				(x.gate as string[]).length > 0 &&
				isStringArray(x.claims) &&
				typeof x.specSetSha256 === "string" &&
				isStringRecord(x.declaredInputs)
			);
		})
	);
}

/**
 * Read a collection dir back and name every way it is not a complete, intact inventory
 * of ONE candidate. Nothing outside `dir` is ever opened: receipt names must be exactly
 * `gNNN.json` for their own index, entries are read by basename with O_NOFOLLOW and
 * checked regular on the descriptor, and a malformed collection.json is reported, never
 * thrown. Empty result = intact AND complete.
 */
export function checkCollection(dir: string): string[] {
	let dirStat: fs.Stats;
	try {
		dirStat = fs.lstatSync(dir);
	} catch (err) {
		return [`collection-unreadable: ${(err as NodeJS.ErrnoException).code ?? String(err)}`];
	}
	if (!dirStat.isDirectory()) return ["collection-unreadable: the collection path is not a real directory"];
	return checkCollectionData((name) => readEntry(dir, name), fs.readdirSync(dir).sort()).errors;
}

export type EntryReader = (name: string) => { ok: true; bytes: Buffer } | { ok: false; why: string };

/** A reader over an in-memory name→bytes map (e.g. an unpacked artifact): basenames only, no fs. */
export function mapReader(files: Record<string, Buffer>): EntryReader {
	return (name) => {
		if (name !== path.basename(name) || name === "." || name === "..") return { ok: false, why: "not a basename" };
		return Object.hasOwn(files, name) ? { ok: true, bytes: files[name] } : { ok: false, why: "ENOENT" };
	};
}

/**
 * The pure core of checkCollection: judge a collection from a reader and the list of
 * entry names present. Returns the errors (empty = intact AND complete) and the parsed
 * collection when its shape is sound.
 */
export function checkCollectionData(
	read: EntryReader,
	names: string[],
): { errors: string[]; collection: Collection | null } {
	const raw = read(COLLECTION_FILE);
	if (!raw.ok) return { errors: [`collection-unreadable: ${COLLECTION_FILE} ${raw.why}`], collection: null };
	let c: Collection;
	try {
		c = JSON.parse(raw.bytes.toString("utf8"));
	} catch (err) {
		return { errors: [`collection-unreadable: ${err instanceof Error ? err.message : String(err)}`], collection: null };
	}
	const isArgv = (a: unknown): a is string[] =>
		Array.isArray(a) && a.length > 0 && a.every((x) => typeof x === "string");
	const shapeOk =
		c !== null &&
		typeof c === "object" &&
		Array.isArray(c.requested) &&
		c.requested.every(isArgv) &&
		Array.isArray(c.attempted) &&
		c.attempted.every(
			(a) =>
				a !== null &&
				typeof a === "object" &&
				isArgv(a.argv) &&
				["receipt-written", "runner-crash", "not-attempted"].includes(a.outcome) &&
				(a.file === null || typeof a.file === "string") &&
				(a.sha256 === null || typeof a.sha256 === "string"),
		) &&
		typeof c.complete === "boolean" &&
		(c.stoppedBy === null || typeof c.stoppedBy === "string") &&
		c.attempted.every((a) => a.detail === null || typeof a.detail === "string") &&
		candidateShapeOk(c.candidate);
	if (!shapeOk) {
		return { errors: ["collection-shape: collection.json is missing or mistyping a required field"], collection: null };
	}
	const errors: string[] = [];
	if (c.schema !== COLLECTION_SCHEMA) errors.push(`collection-schema: ${String(c.schema)}`);
	if (
		c.attempted.length !== c.requested.length ||
		c.attempted.some((a, i) => JSON.stringify(a.argv) !== JSON.stringify(c.requested[i]))
	) {
		errors.push("collection-order: attempted does not follow requested");
	}
	c.attempted.forEach((a, i) => {
		const label = JSON.stringify(a.argv);
		if (a.outcome !== "receipt-written") {
			errors.push(`collection-incomplete: ${label} ${a.outcome}${a.detail ? ` (${a.detail})` : ""}`);
			return;
		}
		if (a.file !== receiptFileName(i)) {
			errors.push(`collection-file-name: ${label} declares ${JSON.stringify(a.file)}, expected ${receiptFileName(i)}`);
			return;
		}
		const got = read(a.file);
		if (!got.ok) {
			errors.push(
				`${got.why === "ENOENT" ? "collection-missing" : "collection-not-regular"}: ${label} ${a.file} (${got.why})`,
			);
			return;
		}
		if (sha256(got.bytes) !== a.sha256) {
			errors.push(`collection-altered: ${label} ${a.file}`);
			return;
		}
		const drift = candidateDrift(got.bytes.toString("utf8"), c, a.argv);
		if (drift.length > 0) errors.push(`collection-candidate-drift: ${label} ${a.file} differs in ${drift.join(", ")}`);
	});
	const declared = new Set([COLLECTION_FILE, ...c.attempted.flatMap((a) => (a.file ? [a.file] : []))]);
	for (const f of names) if (!declared.has(f)) errors.push(`collection-extra: ${f}`);
	if (c.stoppedBy) errors.push(`collection-stopped: ${c.stoppedBy}`);
	if (!c.complete && errors.length === 0) errors.push("collection-incomplete: complete=false");
	return { errors, collection: c };
}
