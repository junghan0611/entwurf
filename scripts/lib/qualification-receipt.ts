/**
 * qualification-receipt — the PARTIAL group receipt of #124 (P1).
 *
 * `check-gate-qualification.ts --group <exact argv JSON> --receipt <path>` runs ONE
 * exact-argv group through the unchanged control→mutant→restore→control body and
 * writes what it observed here. A receipt is a MEASUREMENT of one group on one
 * candidate. It is never a qualification pass: the full body stays the only thing
 * that prints `[gate-qualification] ok`, and this module owns no verdict about any
 * group it did not run.
 *
 * What a receipt fingerprints, and what it does NOT prove:
 *   - candidate: origin HEAD + work-surface content sha, sealed before/after.
 *   - core (C0), conservative and whole: the runner files, all of run.sh, all of
 *     package.json (version included), the lock, the tsconfig/vitest config, the node
 *     version and binary, and the node_modules tree. Splitting any of these is later,
 *     separately proved work.
 *   - node_modules: a content+mode+symlink-target tree hash (links are NOT followed;
 *     measured 2026-09-29 on oracle: every link resolves inside the tree). The Vitest
 *     cache under `node_modules/.vite` is written by gates during a run, so it is
 *     excluded from the identity hash by name and its drift is reported separately.
 *     That cache can steer Vitest's test ordering — a NAMED environment risk, not a
 *     proof of equivalence.
 *   - declared inputs: every subject, signatureSource and argv file operand of the
 *     group. Declared, not audited: a gate that reads a file by path outside this set
 *     is invisible here, so no carry may be derived from these alone.
 *     A declared path that is absolute, normalizes outside the repo, or whose parent
 *     directory resolves (realpath) outside it is recorded as `outside-repo` and never
 *     read; a symlink is recorded by its target, never
 *     followed — so bytes reached THROUGH a declared symlink are not fingerprinted.
 *   - NOT covered at all: host tools the gates spawn (bash, git, python3, tmux, …),
 *     kernel/tmp state, and inter-group leaks the full serial body would expose.
 *
 * `receiptSha256` detects accidental corruption only. Anyone can recompute it, so it
 * cannot tell a runner-written receipt from a hand-written one.
 */

import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import {
	createRepoSnapshot,
	type MutantSpec,
	originHead,
	originWorkSurfaceSha,
	qualifyMutants,
	reportPassed,
} from "./mutation-qualify.ts";

export const RECEIPT_SCHEMA = "entwurf.qualification-group-receipt/v0";
export const RECEIPT_LABEL = "PARTIAL/local — one exact-argv group, not a qualification pass";

/** C0 as files on the work surface; missing ones are recorded as missing, never skipped. */
export const CORE_FILES = [
	"scripts/check-gate-qualification.ts",
	"scripts/qualification-oracle.ts",
	"scripts/lib/mutation-qualify.ts",
	"scripts/lib/qualification-artifact.ts",
	"scripts/lib/qualification-collection.ts",
	"scripts/lib/qualification-gh.ts",
	"scripts/lib/qualification-ledger.ts",
	"scripts/lib/qualification-oracle-core.ts",
	"scripts/lib/qualification-receipt.ts",
	"scripts/lib/qualification-release.ts",
	"scripts/lib/qualification-acceptance.ts",
	"scripts/lib/reclaim-on-exit.ts",
	"run.sh",
	"package.json",
	"pnpm-lock.yaml",
	"pnpm-workspace.yaml",
	"tsconfig.json",
	"scripts/tsconfig.json",
	"vitest.config.ts",
];

/** Excluded from the node_modules identity hash by name; see the header. */
export const NODE_MODULES_EXCLUDED = [".vite"];

// ── argv ────────────────────────────────────────────────────────────────────

export type QualificationArgs =
	| { mode: "full" }
	| { mode: "manifests-only" }
	| { mode: "attribution-self-test" }
	| { mode: "group"; group: string[]; receiptPath: string }
	| { mode: "compose"; receipts: string[]; expectPath?: string; ledgerOut?: string }
	| { mode: "groups"; groups: string[][] | "all"; collectDir: string };

export class QualificationArgsError extends Error {}

/**
 * Parse the qualification entry's own argv (process.argv.slice(2)). Refuses, before
 * anything runs: an unknown flag, a repeated flag, a missing value, `--group` without
 * `--receipt` or the reverse, and a group flag combined with a head-only mode.
 */
export function parseQualificationArgs(argv: string[]): QualificationArgs {
	const seen = new Set<string>();
	let group: string[] | undefined;
	let receiptPath: string | undefined;
	let receipts: string[] | undefined;
	let expectPath: string | undefined;
	let ledgerOut: string | undefined;
	let groups: string[][] | "all" | undefined;
	let collectDir: string | undefined;
	for (let i = 0; i < argv.length; i++) {
		const flag = argv[i];
		if (seen.has(flag)) throw new QualificationArgsError(`repeated flag ${flag}`);
		seen.add(flag);
		if (flag === "--manifests-only" || flag === "--attribution-self-test") continue;
		if (flag === "--group" || flag === "--receipt") {
			const value = argv[++i];
			if (value === undefined || value.startsWith("--")) throw new QualificationArgsError(`${flag} needs a value`);
			if (flag === "--group") {
				let parsed: unknown;
				try {
					parsed = JSON.parse(value);
				} catch {
					throw new QualificationArgsError(`--group must be the exact gate argv as a JSON array, got: ${value}`);
				}
				if (!Array.isArray(parsed) || parsed.length === 0 || !parsed.every((a) => typeof a === "string" && a !== "")) {
					throw new QualificationArgsError(
						`--group must be a non-empty JSON array of non-empty strings, got: ${value}`,
					);
				}
				group = parsed;
			} else {
				receiptPath = value;
			}
			continue;
		}
		if (flag === "--compose") {
			receipts = [];
			while (i + 1 < argv.length && !argv[i + 1].startsWith("--")) receipts.push(argv[++i]);
			if (receipts.length === 0) throw new QualificationArgsError("--compose needs at least one receipt file");
			continue;
		}
		if (flag === "--groups" || flag === "--collect") {
			const value = argv[++i];
			if (value === undefined || value.startsWith("--")) throw new QualificationArgsError(`${flag} needs a value`);
			if (flag === "--collect") {
				collectDir = value;
				continue;
			}
			if (value === "all") {
				// Every exact argv of the committed manifests, in manifest order — resolved after
				// the head has validated them (see check-gate-qualification.ts Phase 2m).
				groups = "all";
				continue;
			}
			let parsed: unknown;
			try {
				parsed = JSON.parse(value);
			} catch {
				throw new QualificationArgsError(
					`--groups must be "all" or a JSON array of exact gate argv arrays, got: ${value}`,
				);
			}
			const isArgv = (a: unknown): a is string[] =>
				Array.isArray(a) && a.length > 0 && a.every((x) => typeof x === "string" && x !== "");
			if (!Array.isArray(parsed) || !parsed.every(isArgv)) {
				throw new QualificationArgsError(`--groups must be a JSON array of non-empty argv arrays, got: ${value}`);
			}
			if (parsed.length === 0) throw new QualificationArgsError("--groups is empty — nothing to collect");
			const keys = parsed.map((a) => JSON.stringify(a));
			const dup = keys.find((k, j) => keys.indexOf(k) !== j);
			if (dup) throw new QualificationArgsError(`--groups repeats ${dup}`);
			groups = parsed;
			continue;
		}
		if (flag === "--expect" || flag === "--ledger-out") {
			const value = argv[++i];
			if (value === undefined || value.startsWith("--")) throw new QualificationArgsError(`${flag} needs a value`);
			if (flag === "--expect") expectPath = value;
			else ledgerOut = value;
			continue;
		}
		throw new QualificationArgsError(`unknown argument ${flag}`);
	}
	if (groups !== undefined || collectDir !== undefined) {
		const other = [...seen].filter((f) => !["--groups", "--collect"].includes(f));
		if (other.length > 0) throw new QualificationArgsError(`--groups cannot combine with ${other.join(" ")}`);
		if (groups === undefined) throw new QualificationArgsError("--collect needs --groups");
		if (collectDir === undefined) throw new QualificationArgsError("--groups needs --collect");
		return { mode: "groups", groups, collectDir };
	}
	if ((expectPath !== undefined || ledgerOut !== undefined) && receipts === undefined) {
		throw new QualificationArgsError("--expect/--ledger-out need --compose");
	}
	if (receipts !== undefined) {
		const other = [...seen].filter((f) => !["--compose", "--expect", "--ledger-out"].includes(f));
		if (other.length > 0) throw new QualificationArgsError(`--compose cannot combine with ${other.join(" ")}`);
		return { mode: "compose", receipts, expectPath, ledgerOut };
	}
	const heads = ["--manifests-only", "--attribution-self-test"].filter((f) => seen.has(f));
	if (heads.length > 1) throw new QualificationArgsError(`${heads.join(" and ")} are exclusive`);
	if (group !== undefined || receiptPath !== undefined) {
		if (heads.length > 0) throw new QualificationArgsError(`--group/--receipt cannot combine with ${heads[0]}`);
		if (group === undefined) throw new QualificationArgsError("--receipt needs --group");
		if (receiptPath === undefined) throw new QualificationArgsError("--group needs --receipt");
		return { mode: "group", group, receiptPath };
	}
	if (heads[0] === "--manifests-only") return { mode: "manifests-only" };
	if (heads[0] === "--attribution-self-test") return { mode: "attribution-self-test" };
	return { mode: "full" };
}

/**
 * A receipt path must be absolute, must not exist yet, and its parent must be an
 * existing directory OUTSIDE the repo (a receipt inside the checkout would move the
 * very work-surface seal it records).
 */
export function checkReceiptPath(receiptPath: string, repoDir: string): void {
	if (!path.isAbsolute(receiptPath)) throw new QualificationArgsError(`--receipt must be absolute: ${receiptPath}`);
	if (fs.existsSync(receiptPath) || isDanglingLink(receiptPath)) {
		throw new QualificationArgsError(`--receipt already exists, refusing to overwrite: ${receiptPath}`);
	}
	const parent = path.dirname(receiptPath);
	let parentReal: string;
	try {
		parentReal = fs.realpathSync(parent);
	} catch {
		throw new QualificationArgsError(`--receipt parent directory does not exist: ${parent}`);
	}
	if (!fs.statSync(parentReal).isDirectory())
		throw new QualificationArgsError(`--receipt parent is not a directory: ${parent}`);
	const repoReal = fs.realpathSync(repoDir);
	if (parentReal === repoReal || parentReal.startsWith(repoReal + path.sep)) {
		throw new QualificationArgsError(`--receipt must live outside the repo: ${receiptPath}`);
	}
}

function isDanglingLink(p: string): boolean {
	try {
		return fs.lstatSync(p).isSymbolicLink();
	} catch {
		return false;
	}
}

// ── fingerprints ────────────────────────────────────────────────────────────

export function sha256(data: string | Buffer): string {
	return createHash("sha256").update(data).digest("hex");
}

/** path → sha256 of a regular file, `link:<target>` for a symlink, `missing` when absent. */
export function fileFingerprints(repoDir: string, rels: string[]): Record<string, string> {
	const out: Record<string, string> = {};
	const repoReal = fs.realpathSync(repoDir);
	for (const rel of [...new Set(rels)].sort()) {
		const norm = path.normalize(rel);
		if (path.isAbsolute(rel) || norm === ".." || norm.startsWith(`..${path.sep}`)) {
			out[rel] = "outside-repo";
			continue;
		}
		const abs = path.join(repoDir, rel);
		// Lexical containment is not enough: a symlinked DIRECTORY on the way (`linkdir ->
		// /elsewhere`) would let lstat/readFileSync of `linkdir/x` read bytes outside the
		// repo. The parent's realpath must stay inside the repo's realpath; only the final
		// component may be a link, and that one is recorded by target, never followed.
		let parentReal: string;
		try {
			parentReal = fs.realpathSync(path.dirname(abs));
		} catch {
			out[rel] = "missing";
			continue;
		}
		if (parentReal !== repoReal && !parentReal.startsWith(repoReal + path.sep)) {
			out[rel] = "outside-repo";
			continue;
		}
		let st: fs.Stats;
		try {
			st = fs.lstatSync(abs);
		} catch {
			out[rel] = "missing";
			continue;
		}
		if (st.isSymbolicLink()) out[rel] = `link:${fs.readlinkSync(abs)}`;
		else if (st.isFile()) out[rel] = sha256(fs.readFileSync(abs));
		else out[rel] = "special";
	}
	return out;
}

export interface TreeFingerprint {
	sha256: string;
	files: number;
	links: number;
	/** Entry lines, kept only to diff two fingerprints of the same tree. */
	lines: string[];
}

/** Content+mode+link-target hash of a tree; symlinks are recorded, never followed. */
export function treeFingerprint(root: string, excludeTop: string[] = []): TreeFingerprint {
	const lines: string[] = [];
	let files = 0;
	let links = 0;
	const walk = (rel: string): void => {
		const entries = fs.readdirSync(path.join(root, rel)).sort();
		for (const name of entries) {
			if (rel === "" && excludeTop.includes(name)) continue;
			const r = rel === "" ? name : `${rel}/${name}`;
			const abs = path.join(root, r);
			const st = fs.lstatSync(abs);
			if (st.isSymbolicLink()) {
				lines.push(`${r}\0link\0${fs.readlinkSync(abs)}`);
				links++;
			} else if (st.isDirectory()) {
				lines.push(`${r}\0dir`);
				walk(r);
			} else if (st.isFile()) {
				lines.push(`${r}\0${(st.mode & 0o777).toString(8)}\0${sha256(fs.readFileSync(abs))}`);
				files++;
			} else {
				lines.push(`${r}\0special`);
			}
		}
	};
	walk("");
	return { sha256: sha256(lines.join("\n")), files, links, lines };
}

/** Paths whose entry differs between two fingerprints of the same tree (added, removed or changed). */
export function treeDrift(before: TreeFingerprint, after: TreeFingerprint): string[] {
	const key = (line: string): string => line.split("\0")[0];
	const a = new Map(before.lines.map((l) => [key(l), l]));
	const b = new Map(after.lines.map((l) => [key(l), l]));
	const out = new Set<string>();
	for (const [k, l] of a) if (b.get(k) !== l) out.add(k);
	for (const k of b.keys()) if (!a.has(k)) out.add(k);
	return [...out].sort();
}

export interface NodeModulesFingerprint {
	present: boolean;
	sha256: string | null;
	excluded: string[];
	files: number;
	links: number;
}

export function nodeModulesFingerprint(repoDir: string): {
	summary: NodeModulesFingerprint;
	full: TreeFingerprint | null;
} {
	const root = path.join(repoDir, "node_modules");
	if (!fs.existsSync(root)) {
		return {
			summary: { present: false, sha256: null, excluded: NODE_MODULES_EXCLUDED, files: 0, links: 0 },
			full: null,
		};
	}
	const idFp = treeFingerprint(root, NODE_MODULES_EXCLUDED);
	return {
		summary: {
			present: true,
			sha256: idFp.sha256,
			excluded: NODE_MODULES_EXCLUDED,
			files: idFp.files,
			links: idFp.links,
		},
		full: treeFingerprint(root),
	};
}

let nodeRuntimeMemo: { version: string; execPath: string; execSha256: string } | undefined;

/** The running node — version, resolved binary path and its sha (hashed once per process). */
export function nodeRuntime(): { version: string; execPath: string; execSha256: string } {
	if (!nodeRuntimeMemo) {
		const execPath = fs.realpathSync(process.execPath);
		nodeRuntimeMemo = { version: process.version, execPath, execSha256: sha256(fs.readFileSync(execPath)) };
	}
	return nodeRuntimeMemo;
}

/** Canonical (sorted-key) JSON, so a hash does not depend on property insertion order. */
export function canonicalJson(value: unknown): string {
	if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
	if (value !== null && typeof value === "object") {
		const obj = value as Record<string, unknown>;
		return `{${Object.keys(obj)
			.sort()
			.filter((k) => obj[k] !== undefined)
			.map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`)
			.join(",")}}`;
	}
	return JSON.stringify(value);
}

// ── write ───────────────────────────────────────────────────────────────────

/** Attach `receiptSha256` (over the canonical body without it) — corruption detection only. */
export function sealReceipt<T extends object>(body: T): T & { receiptSha256: string } {
	return { ...body, receiptSha256: sha256(canonicalJson(body)) };
}

/**
 * Write once, atomically, never over an existing file: the bytes go to a sibling temp
 * file (O_EXCL), are fully written (writeFileSync on the fd loops over short writes)
 * and fsynced, then hard-linked to the final name — `link` fails with EEXIST instead
 * of replacing whatever appeared there meanwhile. The temp file is removed on every
 * path, including a failed write.
 */
export function writeReceiptExclusive(receiptPath: string, receipt: object): void {
	const tmp = `${receiptPath}.tmp-${process.pid}`;
	const fd = fs.openSync(tmp, "wx", 0o600);
	try {
		try {
			fs.writeFileSync(fd, `${JSON.stringify(receipt, null, "\t")}\n`);
			fs.fsyncSync(fd);
		} finally {
			fs.closeSync(fd);
		}
		fs.linkSync(tmp, receiptPath);
	} finally {
		fs.rmSync(tmp, { force: true });
	}
}

/** A group's DECLARED inputs: every subject, signatureSource and argv file operand. */
export function declaredInputPaths(repoDir: string, groupSpecs: MutantSpec[], gate: string[]): string[] {
	return [
		...groupSpecs.flatMap((m) => [m.subject, m.signatureSource]),
		...gate.filter((a) => !a.startsWith("-") && fs.existsSync(path.join(repoDir, a))),
	];
}

/** The one hash a receipt and a current candidate compare for C0. */
export function coreSha256(core: { files: Record<string, string>; node: unknown; nodeModules: unknown }): string {
	return sha256(canonicalJson(core));
}

// ── one group, measured ─────────────────────────────────────────────────────

export interface GroupReceiptOptions {
	repoDir: string;
	/** The validated committed mutant set, in manifest order. */
	selected: MutantSpec[];
	/** Exact gate argv; must equal at least one spec's gate. */
	gate: string[];
	receiptPath: string;
	log: (line: string) => void;
	logError: (line: string) => void;
	/** Snapshot tmp root (tests); defaults to the OS tmp dir. */
	tmpRoot?: string;
}

/**
 * Run the mutants whose gate argv equals `gate` exactly, in manifest order, through
 * the unchanged qualifyMutants state machine on a fresh snapshot, and write the
 * receipt. A red is written like a green; `passed` is reportPassed AND a stable seal.
 * An exception inside the body propagates and writes nothing — it is not an
 * observation. Refuses before any snapshot when the argv names no committed group.
 */
export async function runGroupReceipt(
	opts: GroupReceiptOptions,
): Promise<{ passed: boolean; receiptSha256: string; sealStable: boolean }> {
	const { repoDir, selected, gate } = opts;
	const groupKey = JSON.stringify(gate);
	const groupSpecs = selected.filter((m) => JSON.stringify(m.gate) === groupKey);
	if (groupSpecs.length === 0) {
		throw new Error(`--group ${groupKey} names no exact gate argv in the committed manifests — nothing was run`);
	}
	const startedAt = new Date();
	const headBefore = originHead(repoDir);
	const workSurfaceBefore = originWorkSurfaceSha(repoDir);
	const coreFilesBefore = fileFingerprints(repoDir, CORE_FILES);
	const nmBefore = nodeModulesFingerprint(repoDir);
	const node = nodeRuntime();
	const declaredInputs = declaredInputPaths(repoDir, groupSpecs, gate);
	const inputsBefore = fileFingerprints(repoDir, declaredInputs);

	const snap = createRepoSnapshot(repoDir, opts.tmpRoot);
	opts.log(
		`[gate-qualification --group] PARTIAL: ${groupSpecs.length}/${selected.length} mutants of ${groupKey}; snapshot ${snap.repoDir} (origin HEAD ${headBefore.slice(0, 12)})`,
	);
	let report: Awaited<ReturnType<typeof qualifyMutants>>;
	try {
		report = await qualifyMutants(snap, groupSpecs, opts.log);
	} finally {
		fs.rmSync(snap.baseDir, { recursive: true, force: true });
	}

	const headAfter = originHead(repoDir);
	const workSurfaceAfter = originWorkSurfaceSha(repoDir);
	const coreFilesAfter = fileFingerprints(repoDir, CORE_FILES);
	const nmAfter = nodeModulesFingerprint(repoDir);
	const inputsAfter = fileFingerprints(repoDir, declaredInputs);
	const sealStable =
		headAfter === headBefore &&
		workSurfaceAfter === workSurfaceBefore &&
		canonicalJson(coreFilesAfter) === canonicalJson(coreFilesBefore) &&
		nmAfter.summary.sha256 === nmBefore.summary.sha256 &&
		canonicalJson(inputsAfter) === canonicalJson(inputsBefore);
	const groupResult = report.groups[0];
	const passed = reportPassed(report) && sealStable;
	const core = { files: coreFilesBefore, node, nodeModules: nmBefore.summary };
	const receipt = sealReceipt({
		schema: RECEIPT_SCHEMA,
		label: RECEIPT_LABEL,
		startedAt: startedAt.toISOString(),
		elapsedSeconds: (Date.now() - startedAt.getTime()) / 1000,
		candidate: { head: headBefore, workSurfaceSha256: workSurfaceBefore },
		core: { ...core, sha256: coreSha256(core) },
		group: {
			gate,
			// Run order, not sorted: mutants run sequentially and may leak state into each other.
			specSetSha256: sha256(canonicalJson(groupSpecs)),
			claims: groupSpecs.map((m) => m.claim),
			declaredInputs: inputsBefore,
		},
		manifestSet: {
			claimCount: selected.length,
			claims: selected.map((m) => m.claim).sort(),
		},
		result: {
			passed,
			control: groupResult.control,
			mutants: groupResult.mutants,
			treeClean: report.treeClean,
			porcelainClean: report.porcelainClean,
		},
		seal: {
			stable: sealStable,
			headAfter,
			workSurfaceAfterSha256: workSurfaceAfter,
			coreFilesChanged: Object.keys(coreFilesBefore).filter((k) => coreFilesBefore[k] !== coreFilesAfter[k]),
			nodeModulesIdentityAfter: nmAfter.summary.sha256,
			nodeModulesExcludedDrift:
				nmBefore.full && nmAfter.full
					? treeDrift(nmBefore.full, nmAfter.full).filter((p) =>
							nmBefore.summary.excluded.some((x) => p === x || p.startsWith(`${x}/`)),
						)
					: [],
			declaredInputsChanged: Object.keys(inputsBefore).filter((k) => inputsBefore[k] !== inputsAfter[k]),
		},
		notCovered: [
			"undeclared inputs a gate reads by path or spawns (declared inputs are subjects + signatureSources + argv files only)",
			"bytes reached through a declared symlink (recorded by target, not followed)",
			"host tools spawned by gates (bash, git, python3, tmux, …) and kernel/tmp state",
			"state leaks between this group and groups that did not run with it",
			`node_modules paths excluded from identity by name (${nmBefore.summary.excluded.join(", ")}); drift listed in seal`,
			"receiptSha256 detects corruption only; it cannot distinguish a runner-written receipt from a hand-written one",
		],
	});
	writeReceiptExclusive(opts.receiptPath, receipt);
	opts.log(
		`[gate-qualification --group] receipt: ${opts.receiptPath} (receiptSha256 ${receipt.receiptSha256.slice(0, 12)}…)`,
	);
	for (const m of groupResult.mutants) {
		if (m.verdict !== "KILLED")
			opts.logError(`[gate-qualification --group] NOT KILLED: ${m.claim} → ${m.verdict} (${m.detail})`);
	}
	if (!sealStable) opts.logError("[gate-qualification --group] SEAL MOVED during the run — see receipt.seal");
	const killed = groupResult.mutants.filter((m) => m.verdict === "KILLED").length;
	opts.log(
		`[gate-qualification --group] PARTIAL ${passed ? "group-green" : "group-RED"}: ${killed}/${groupSpecs.length} killed, control ${groupResult.control}; ${selected.length - groupSpecs.length} committed mutants NOT run`,
	);
	return { passed, receiptSha256: receipt.receiptSha256, sealStable };
}
