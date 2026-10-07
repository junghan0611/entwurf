/**
 * mutation-qualify — the gate-qualification runner core (kill-proof discipline).
 *
 * A gate is a test only if re-planting a closed defect makes that gate fail, for the
 * exact reason it claims to guard. This module carries the minimal machinery to prove
 * that automatically: declarative mutant manifests (one mutant = one closed defect,
 * hand-written, never generated), an isolated SNAPSHOT repo the mutation runs in (the
 * real checkout is never written), and a pure verdict classifier the self-test can
 * exhaust as a truth table.
 *
 * Boundaries (agreed 2026-07-27, GLG+GPT design review — do not widen):
 *   - NOT a general mutation platform: no AST operators, no generated mutants, no
 *     kill-ratio scoring. Mutants are committed regression memorials only.
 *   - Mutation NEVER touches the real checkout. Everything — apply, gate run,
 *     restore — happens inside a temp snapshot replicating tracked+untracked files;
 *     the caller verifies the origin HEAD + work-surface CONTENT hash are identical
 *     before/after (porcelain text alone misses byte drift in already-modified files).
 *   - Every unique gate command gets an unmutated CONTROL run before and after its
 *     mutants (a gate already red at baseline can produce only fake KILLEDs).
 *   - Bounded: each gate run has a hard timeout and its process GROUP is killed.
 *   - Evidence is claim IDs + killed mutant IDs, never assertion counts.
 *   - The snapshot is SOURCE-ONLY. An ignored build output a gate consumes (#125: the
 *     compiled entwurf-bridge a pi citizen registers) enters only through a mutant's
 *     `build` declaration, and only for that gate's group: the snapshot builds it from its
 *     OWN bytes before the control, again after every mutation (so the gate judges the
 *     output of the source it is handed), and again from the restored bytes before the
 *     post-control, which must reproduce the baseline output exactly. A build red is never
 *     a kill, a gate that writes into the output voids its run, and the output is removed
 *     when the group ends — no other group ever sees it, and no origin artifact is copied.
 */

import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

// ── verdicts ────────────────────────────────────────────────────────────────

export type MutantVerdict =
	| "KILLED" // bounded nonzero exit + the claim token on a failure line
	| "SURVIVED" // gate stayed green with the defect planted
	| "WRONG-REASON" // gate went red, but not at the claimed assertion
	| "HANG" // gate exceeded its bound; process group killed
	| "MUTANT-STALE" // find matched 0 times — production drifted; re-derive the mutant
	| "MULTI-MATCH" // find matched >1 — refuse before writing anything
	| "CONTROL-RED" // the unmutated CONTROL failed; no KILLED can be claimed
	| "IMPURE"; // restore/containment failed; evidence is contaminated

export interface MutantRunFacts {
	controlPreOk: boolean;
	matchCount: number;
	timedOut: boolean;
	/** child exit code; null when the child was killed (timeout). */
	exitCode: number | null;
	signatureOnFailureLine: boolean;
	restoredOk: boolean;
}

/**
 * The pure verdict mapping. Order is load-bearing and mirrored by the self-test
 * truth table: control validity first, then match integrity, then purity, then the
 * bounded-run outcome. `restoredOk` outranks the run outcome — a KILLED whose
 * restore failed is contaminated evidence, not a kill.
 */
export function classifyMutantRun(f: MutantRunFacts): MutantVerdict {
	if (!f.controlPreOk) return "CONTROL-RED";
	if (f.matchCount === 0) return "MUTANT-STALE";
	if (f.matchCount > 1) return "MULTI-MATCH";
	if (!f.restoredOk) return "IMPURE";
	if (f.timedOut) return "HANG";
	// A null exit outside our own timeout is a SIGNAL CRASH, not a bounded nonzero exit
	// — even with the claim token somewhere in the output it proves nothing about the
	// gate's assertion, so it can never be rounded up to KILLED (P0-2, 2026-07-27).
	if (f.exitCode === null) return "WRONG-REASON";
	if (f.exitCode === 0) return "SURVIVED";
	return f.signatureOnFailureLine ? "KILLED" : "WRONG-REASON";
}

/**
 * The claim token counts only on a FAILURE line. Gate labels print on success too
 * (`  ok    <label>`), so a mutation that trips a LATER assertion would otherwise
 * read its own passing ok-line as the kill signature.
 */
export function signatureOnFailureLine(output: string, token: string): boolean {
	return output.split("\n").some((line) => line.includes(token) && !/^\s*ok\b/.test(line));
}

/** run_vitest prints this line when the runner asked it for a structured report.
 * Its PRESENCE — not the report's readability — is what declares the lane structured. */
export const VITEST_STRUCTURED_MARKER = "__ENTWURF_VITEST_JSON__";

/**
 * What a gate run said about WHICH tests failed.
 *
 * - `"legacy"`: no structured marker — a hand-built node:assert/shell gate whose
 *   `ok`-line oracle is unchanged.
 * - `"unreadable"`: the marker was printed but the report is missing or malformed.
 *   This NEVER falls back to token scanning: a structured lane that lost its report
 *   has no attribution at all, so the mutant is WRONG-REASON, not KILLED.
 * - a title array: the exact `fullName` of every FAILED test.
 */
export type FailedTestTitles = "legacy" | "unreadable" | string[];

/** Read the failed-test titles a vitest gate wrote, if it declared itself structured. */
export function readVitestFailedTitles(output: string, reportPath: string | null): FailedTestTitles {
	if (!output.split("\n").some((line) => line.trim() === VITEST_STRUCTURED_MARKER)) return "legacy";
	if (!reportPath) return "unreadable";
	let raw: string;
	try {
		raw = fs.readFileSync(reportPath, "utf8");
	} catch {
		return "unreadable";
	}
	let report: {
		testResults?: Array<{ assertionResults?: Array<{ status?: string; fullName?: string; title?: string }> }>;
	};
	try {
		report = JSON.parse(raw);
	} catch {
		return "unreadable";
	}
	if (!Array.isArray(report.testResults)) return "unreadable";
	const titles: string[] = [];
	for (const suite of report.testResults) {
		for (const assertion of suite.assertionResults ?? []) {
			if (assertion.status !== "failed") continue;
			titles.push(assertion.fullName ?? assertion.title ?? "");
		}
	}
	return titles;
}

/**
 * Attribute a kill to its claim. A Vitest failure's CODE FRAME quotes the source lines
 * around the assertion — including an adjacent PASSING test's `it("[QK:…]" …)` title —
 * so scanning output lines would certify a claim whose test never failed (measured:
 * issue #62 review). Structured lanes therefore read only the failed-test title set.
 */
export function signatureAttributedToFailure(output: string, token: string, failed: FailedTestTitles): boolean {
	if (failed === "legacy") return signatureOnFailureLine(output, token);
	if (failed === "unreadable") return false;
	return failed.some((title) => title.includes(token));
}

/** One legible word for the report line, so a WRONG-REASON says WHY it could not attribute. */
export function describeAttribution(failed: FailedTestTitles): string {
	if (failed === "legacy") return "failure-line";
	if (failed === "unreadable") return "vitest-structured-but-unreadable";
	return `vitest-failed-titles(${failed.length})`;
}

// ── manifest schema (fail-loud, exact keys) ─────────────────────────────────

export interface MutantSpec {
	/** Stable claim id, ^[A-Z][A-Z0-9]*(-[A-Z0-9]+)*$, globally unique across manifests. */
	claim: string;
	title: string;
	/** Repo-relative production subject. Must be tracked in the ORIGIN git index. */
	subject: string;
	/** Exact source lines (joined by \n); must occur exactly once in the subject. */
	find: string[];
	/** The defect-restoring replacement lines (joined by \n); must differ from find. */
	replace: string[];
	/** Gate argv (no shell string), run with cwd = snapshot repo root. */
	gate: string[];
	timeoutSeconds: number;
	/** Always `[QK:<claim>]`; must appear exactly once in signatureSource. */
	signature: string;
	/** Repo-relative gate source file that owns the claim token. */
	signatureSource: string;
	/** Optional: an ignored build output this mutant's gate consumes (see the module header). */
	build?: MutantBuild;
}

/**
 * A build whose OUTPUT a gate group consumes. Never a subject: the output is ignored, so
 * the snapshot does not carry it, and a gate requiring it would be CONTROL-RED in every
 * run. Every mutant of one gate declares the same build or none.
 */
export interface MutantBuild {
	/** Build argv (no shell string), run with cwd = snapshot repo root, fenced and bounded like a gate. */
	argv: string[];
	/** Repo-relative directory the build writes; absent from the work surface, removed after the group. */
	output: string;
}

export interface MutantManifest {
	schemaVersion: 1;
	lane: string;
	mutants: MutantSpec[];
}

const CLAIM_RE = /^[A-Z][A-Z0-9]*(-[A-Z0-9]+)*$/;
const MANIFEST_KEYS = ["schemaVersion", "lane", "mutants"];
const MUTANT_KEYS = [
	"claim",
	"title",
	"subject",
	"find",
	"replace",
	"gate",
	"timeoutSeconds",
	"signature",
	"signatureSource",
];
const OPTIONAL_MUTANT_KEYS = ["build"];
const BUILD_KEYS = ["argv", "output"];

export class ManifestError extends Error {}

function requireExactKeys(obj: Record<string, unknown>, keys: string[], where: string, optional: string[] = []): void {
	for (const k of Object.keys(obj)) {
		if (!keys.includes(k) && !optional.includes(k)) throw new ManifestError(`${where}: unknown key \`${k}\``);
	}
	for (const k of keys) {
		if (!(k in obj)) throw new ManifestError(`${where}: missing key \`${k}\``);
	}
}

function requireLines(v: unknown, where: string): string[] {
	if (!Array.isArray(v) || v.length === 0 || !v.every((s) => typeof s === "string")) {
		throw new ManifestError(`${where}: must be a non-empty array of strings`);
	}
	return v as string[];
}

/** Validate one manifest document; throws ManifestError with the exact defect. */
export function validateManifest(raw: unknown, name: string): MutantManifest {
	if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
		throw new ManifestError(`${name}: manifest must be a JSON object`);
	}
	const doc = raw as Record<string, unknown>;
	requireExactKeys(doc, MANIFEST_KEYS, name);
	if (doc.schemaVersion !== 1) throw new ManifestError(`${name}: unknown schemaVersion ${String(doc.schemaVersion)}`);
	if (typeof doc.lane !== "string" || doc.lane.length === 0) throw new ManifestError(`${name}: lane must be a string`);
	if (!Array.isArray(doc.mutants) || doc.mutants.length === 0) {
		throw new ManifestError(`${name}: mutants must be a non-empty array`);
	}
	const mutants: MutantSpec[] = [];
	for (const [i, m] of doc.mutants.entries()) {
		const where = `${name} mutants[${i}]`;
		if (typeof m !== "object" || m === null) throw new ManifestError(`${where}: must be an object`);
		const rec = m as Record<string, unknown>;
		requireExactKeys(rec, MUTANT_KEYS, where, OPTIONAL_MUTANT_KEYS);
		if (typeof rec.claim !== "string" || !CLAIM_RE.test(rec.claim)) {
			throw new ManifestError(`${where}: claim must match ${CLAIM_RE}`);
		}
		if (typeof rec.title !== "string" || rec.title.length === 0) throw new ManifestError(`${where}: title required`);
		const subject = rec.subject;
		if (typeof subject !== "string" || subject.length === 0) throw new ManifestError(`${where}: subject required`);
		if (path.isAbsolute(subject) || subject.split(/[\\/]/).includes("..")) {
			throw new ManifestError(`${where}: subject must be repo-relative without \`..\` (got ${subject})`);
		}
		if (subject === "node_modules" || subject.startsWith("node_modules/")) {
			throw new ManifestError(`${where}: subject may not live under node_modules (a shared dependency symlink)`);
		}
		const find = requireLines(rec.find, `${where}.find`);
		const replace = requireLines(rec.replace, `${where}.replace`);
		if (find.join("\n") === replace.join("\n")) throw new ManifestError(`${where}: replace must differ from find`);
		const gate = requireLines(rec.gate, `${where}.gate`);
		if (
			typeof rec.timeoutSeconds !== "number" ||
			!Number.isInteger(rec.timeoutSeconds) ||
			rec.timeoutSeconds < 1 ||
			rec.timeoutSeconds > 600
		) {
			throw new ManifestError(`${where}: timeoutSeconds must be an integer in 1..600`);
		}
		const expectedSig = `[QK:${rec.claim}]`;
		if (rec.signature !== expectedSig) {
			throw new ManifestError(`${where}: signature must be exactly ${expectedSig} (got ${String(rec.signature)})`);
		}
		const sigSrc = rec.signatureSource;
		if (typeof sigSrc !== "string" || path.isAbsolute(sigSrc) || sigSrc.split(/[\\/]/).includes("..")) {
			throw new ManifestError(`${where}: signatureSource must be a repo-relative path`);
		}
		const build = "build" in rec ? validateBuild(rec.build, `${where}.build`) : undefined;
		mutants.push({
			claim: rec.claim,
			title: rec.title,
			subject,
			find,
			replace,
			gate,
			timeoutSeconds: rec.timeoutSeconds,
			signature: expectedSig,
			signatureSource: sigSrc,
			...(build ? { build } : {}),
		});
	}
	return { schemaVersion: 1, lane: doc.lane, mutants };
}

function validateBuild(raw: unknown, where: string): MutantBuild {
	if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
		throw new ManifestError(`${where}: must be an object`);
	}
	const rec = raw as Record<string, unknown>;
	requireExactKeys(rec, BUILD_KEYS, where);
	const argv = requireLines(rec.argv, `${where}.argv`);
	const output = rec.output;
	if (
		typeof output !== "string" ||
		path.isAbsolute(output) ||
		output.split("/").some((seg) => seg === "" || seg === "." || seg === "..") ||
		output.includes("\\")
	) {
		throw new ManifestError(`${where}: output must be a normalized repo-relative directory (got ${String(output)})`);
	}
	const top = output.split("/")[0];
	if (top === "node_modules" || top === ".git") {
		throw new ManifestError(`${where}: output may not live under ${top}`);
	}
	return { argv, output };
}

/**
 * The one build a gate group declares, or none. A group is keyed by its exact gate argv;
 * two mutants of it declaring different builds (or one declaring none) would hand the same
 * gate different inputs depending on run order, so the set is refused — at manifest time and
 * again at run time, because the self-test injects specs directly.
 */
export function groupBuild(specs: MutantSpec[]): MutantBuild | undefined {
	const first = JSON.stringify(specs[0]?.build ?? null);
	for (const m of specs) {
		const mine = JSON.stringify(m.build ?? null);
		if (mine !== first) {
			throw new ManifestError(
				`gate ${JSON.stringify(m.gate)} mixes build declarations (${first} vs ${mine} at ${m.claim}) — every mutant of one gate declares the same build or none`,
			);
		}
	}
	return specs[0]?.build;
}

export interface OriginChecks {
	/** claim → true when the subject is tracked in the origin index. */
	subjectTracked: (subject: string) => boolean;
	/** true when the path is a REGULAR non-symlink file whose realpath stays inside the origin. */
	regularContainedFile: (file: string) => boolean;
	/** true when the path is on the origin work surface (tracked or untracked-non-ignored). */
	onWorkSurface: (file: string) => boolean;
	/** how many times a token occurs in the origin bytes of a file (0 when unreadable). */
	tokenCount: (file: string, token: string) => number;
}

/**
 * Cross-manifest validation against the ORIGIN repo: global claim uniqueness,
 * subject tracked in the origin git index (hardening #3 — "happens to exist in the
 * snapshot" is not the contract), subject AND signatureSource lstat-regular
 * non-symlink with realpath containment (P0-1 — a tracked SYMLINK subject would let
 * the snapshot's read/write follow it OUT of the sandbox), and the claim token
 * present exactly once in its declared gate source. signatureSource is checked
 * against the WORK SURFACE (tracked ∪ untracked-non-ignored — exactly the snapshot
 * replication set) rather than the index alone, so a brand-new gate file can carry
 * its own claims before its first commit.
 */
export function validateManifestSet(manifests: MutantManifest[], origin: OriginChecks): MutantSpec[] {
	const all: MutantSpec[] = [];
	const seen = new Map<string, string>();
	for (const man of manifests) {
		for (const m of man.mutants) {
			const prior = seen.get(m.claim);
			if (prior !== undefined) {
				throw new ManifestError(`duplicate claim ${m.claim} (lanes ${prior} and ${man.lane})`);
			}
			seen.set(m.claim, man.lane);
			if (!origin.subjectTracked(m.subject)) {
				throw new ManifestError(`${m.claim}: subject ${m.subject} is not tracked in the origin git index`);
			}
			if (!origin.regularContainedFile(m.subject)) {
				throw new ManifestError(
					`${m.claim}: subject ${m.subject} is not a regular non-symlink file inside the origin (symlink-escape guard)`,
				);
			}
			if (!origin.onWorkSurface(m.signatureSource)) {
				throw new ManifestError(`${m.claim}: signatureSource ${m.signatureSource} is not on the origin work surface`);
			}
			if (!origin.regularContainedFile(m.signatureSource)) {
				throw new ManifestError(
					`${m.claim}: signatureSource ${m.signatureSource} is not a regular non-symlink file inside the origin`,
				);
			}
			const n = origin.tokenCount(m.signatureSource, m.signature);
			if (n !== 1) {
				throw new ManifestError(
					`${m.claim}: token ${m.signature} occurs ${n}× in ${m.signatureSource} (need exactly 1)`,
				);
			}
			all.push(m);
		}
	}
	const byGate = new Map<string, MutantSpec[]>();
	for (const m of all) {
		const key = JSON.stringify(m.gate);
		byGate.set(key, [...(byGate.get(key) ?? []), m]);
	}
	for (const specs of byGate.values()) groupBuild(specs);
	return all;
}

// ── snapshot repo ───────────────────────────────────────────────────────────

const SNAPSHOT_PREFIX = "entwurf-qualify-";

const SNAPSHOT_GIT_ENV = {
	GIT_CONFIG_GLOBAL: "/dev/null",
	GIT_CONFIG_SYSTEM: "/dev/null",
	GIT_CONFIG_NOSYSTEM: "1",
	GIT_AUTHOR_NAME: "entwurf-qualify",
	GIT_AUTHOR_EMAIL: "qualify@localhost",
	GIT_COMMITTER_NAME: "entwurf-qualify",
	GIT_COMMITTER_EMAIL: "qualify@localhost",
};

function gitIn(dir: string, args: string[]): string {
	const r = spawnSync("git", ["-C", dir, ...args], {
		encoding: "utf8",
		env: { ...process.env, ...SNAPSHOT_GIT_ENV },
		maxBuffer: 64 * 1024 * 1024,
	});
	if (r.status !== 0) {
		throw new Error(`git ${args.join(" ")} failed in ${dir}: ${r.stderr || r.stdout}`);
	}
	return r.stdout;
}

export interface Snapshot {
	baseDir: string;
	repoDir: string;
	fileCount: number;
}

/**
 * Replicate the origin working surface (tracked + untracked, ignored excluded) into
 * an isolated snapshot repo with its own git baseline, so gates that consult
 * `git status --porcelain` keep their purity checks, and the runner can assert the
 * whole snapshot tree afterward. node_modules is shared via a dependency symlink,
 * created after the baseline commit and excluded from git — it can never be a
 * mutation subject (schema refuses it), and the selected qualification children
 * treat that shared dependency tree as read-only and never run a package manager.
 */
export function createRepoSnapshot(originDir: string, tmpRoot: string = os.tmpdir()): Snapshot {
	const baseDir = fs.mkdtempSync(path.join(tmpRoot, SNAPSHOT_PREFIX));
	fs.chmodSync(baseDir, 0o700);
	const repoDir = path.join(baseDir, "repo");
	fs.mkdirSync(repoDir, { mode: 0o700 });

	const listOut = gitIn(originDir, ["ls-files", "-z", "--cached", "--others", "--exclude-standard"]);
	const files = [...new Set(listOut.split("\0").filter((f) => f.length > 0))];
	let copied = 0;
	for (const rel of files) {
		const src = path.join(originDir, rel);
		let st: fs.Stats;
		try {
			st = fs.lstatSync(src);
		} catch {
			continue; // tracked in index but deleted from the worktree — the worktree is authority
		}
		const dst = path.join(repoDir, rel);
		fs.mkdirSync(path.dirname(dst), { recursive: true });
		if (st.isSymbolicLink()) {
			fs.symlinkSync(fs.readlinkSync(src), dst);
		} else if (st.isFile()) {
			fs.copyFileSync(src, dst);
			fs.chmodSync(dst, st.mode & 0o777);
		} else {
			throw new Error(`refusing to snapshot special file ${rel} (mode ${st.mode.toString(8)})`);
		}
		copied++;
	}

	gitIn(repoDir, ["init", "-q"]);
	gitIn(repoDir, ["add", "-A"]);
	gitIn(repoDir, ["-c", "commit.gpgsign=false", "commit", "-q", "-m", "qualification baseline"]);

	// node_modules AFTER the baseline commit, git-excluded (hardening #2).
	const originModules = path.join(originDir, "node_modules");
	if (fs.existsSync(originModules)) {
		fs.symlinkSync(originModules, path.join(repoDir, "node_modules"));
		fs.appendFileSync(path.join(repoDir, ".git", "info", "exclude"), "node_modules\n");
	}
	return { baseDir, repoDir, fileCount: copied };
}

/**
 * The one snapshot lifecycle every real run uses (full body and each group): create
 * exactly one snapshot, run, then remove exactly the `baseDir` this call created. It
 * never lists `tmpRoot` and never removes a root it did not create here: a prior run's
 * snapshot is that run's evidence, whatever its process state, and deleting it is the
 * operator's decision, never the qualifier's. `tmpRoot` is passed only by self-test
 * fixtures; real runs leave it undefined (the OS tmp dir).
 */
export async function withOwnSnapshot<T>(
	originDir: string,
	tmpRoot: string | undefined,
	run: (snap: Snapshot) => Promise<T>,
): Promise<T> {
	const snap = createRepoSnapshot(originDir, tmpRoot);
	try {
		return await run(snap);
	} finally {
		fs.rmSync(snap.baseDir, { recursive: true, force: true });
	}
}

/**
 * Content manifest of the snapshot tree — path+mode+sha256 for files, target for
 * symlinks, bare entries for dirs — excluding .git and node_modules. Porcelain alone
 * misses ignored-path writes; this does not (hardening #4).
 */
export function computeTreeManifest(repoDir: string): string {
	return digestTree(repoDir, [".git", "node_modules"]);
}

/** The same content manifest over any directory, skipping the named top-level entries. */
function digestTree(root: string, skipAtRoot: readonly string[]): string {
	const lines: string[] = [];
	const walk = (rel: string): void => {
		const abs = path.join(root, rel);
		for (const name of fs.readdirSync(abs).sort()) {
			if (rel === "" && skipAtRoot.includes(name)) continue;
			const childRel = rel === "" ? name : `${rel}/${name}`;
			const st = fs.lstatSync(path.join(root, childRel));
			if (st.isSymbolicLink()) {
				lines.push(`${childRel}\0link\0${fs.readlinkSync(path.join(root, childRel))}`);
			} else if (st.isDirectory()) {
				lines.push(`${childRel}\0dir`);
				walk(childRel);
			} else if (st.isFile()) {
				const sha = createHash("sha256")
					.update(fs.readFileSync(path.join(root, childRel)))
					.digest("hex");
				lines.push(`${childRel}\0${(st.mode & 0o777).toString(8)}\0${sha}`);
			} else {
				lines.push(`${childRel}\0special`);
			}
		}
	};
	walk("");
	return createHash("sha256").update(lines.join("\n")).digest("hex");
}

// ── declared build output (source-only snapshot, #125) ──────────────────────

/**
 * Absolute path of a group's declared build output, refused unless it is ABSENT from the
 * snapshot: the snapshot is the work surface, so a present output would be source bytes the
 * build (and the end-of-group removal) would overwrite. Every existing ancestor must be a
 * real directory inside the snapshot, so neither the build nor the removal can follow a link out,
 * and the parent must already exist: a build that created source-tree directories would leave
 * them behind after the removal.
 */
function declaredBuildOutput(repoDir: string, build: MutantBuild): string {
	const abs = path.join(repoDir, build.output);
	const rel = path.relative(repoDir, abs);
	if (rel === "" || rel.startsWith("..") || path.isAbsolute(rel)) {
		throw new Error(`declared build output ${build.output} is not inside the snapshot — refusing`);
	}
	if (fs.existsSync(abs) || isLink(abs)) {
		throw new Error(
			`declared build output ${build.output} already exists in the snapshot — it is on the work surface, so building or removing it would touch source bytes; refusing`,
		);
	}
	const repoReal = fs.realpathSync(repoDir) + path.sep;
	for (let dir = path.dirname(abs); dir !== repoDir; dir = path.dirname(dir)) {
		if (isLink(dir) || (fs.existsSync(dir) && !(fs.realpathSync(dir) + path.sep).startsWith(repoReal))) {
			throw new Error(`declared build output ${build.output} has an ancestor that leaves the snapshot — refusing`);
		}
	}
	if (!fs.existsSync(path.dirname(abs)) || !fs.lstatSync(path.dirname(abs)).isDirectory()) {
		throw new Error(`declared build output ${build.output} has no parent directory in the snapshot — refusing`);
	}
	return abs;
}

function isLink(p: string): boolean {
	try {
		return fs.lstatSync(p).isSymbolicLink();
	} catch {
		return false;
	}
}

/** Content digest of the build output, or null when it is not a real directory (a build that wrote nothing there). */
function buildOutputDigest(abs: string): string | null {
	try {
		if (!fs.lstatSync(abs).isDirectory()) return null;
	} catch {
		return null;
	}
	return digestTree(abs, []);
}

// ── bounded gate execution ──────────────────────────────────────────────────

export interface GateRunResult {
	exitCode: number | null;
	timedOut: boolean;
	output: string;
	seconds: number;
	/** Structured failed-test attribution; `"legacy"` for every non-vitest gate. */
	failedTitles: FailedTestTitles;
}

const OUTPUT_CAP = 4 * 1024 * 1024;

/** Env prefixes the outer fence strips so a gate child starts from a neutral host. */
const STRIP_ENV_PREFIXES = ["ENTWURF_", "AGY_", "PI_SESSION_ID", "PI_AGENT_ID"];

/** Where a vitest-backed gate writes its machine report for this one invocation. */
function vitestReportPath(invocationDir: string): string {
	return path.join(invocationDir, "vitest-report.json");
}

function fencedEnv(invocationDir: string): NodeJS.ProcessEnv {
	const env: NodeJS.ProcessEnv = {};
	for (const [k, v] of Object.entries(process.env)) {
		if (STRIP_ENV_PREFIXES.some((p) => k === p || k.startsWith(p))) continue;
		env[k] = v;
	}
	// A vitest-backed gate writes its machine report HERE, inside the per-invocation dir
	// (outside the snapshot repo, so the work-surface purity hash never sees it). The
	// report is a FILE and not stdout on purpose: `output` merges stdout+stderr, so one
	// vite warning ahead of the JSON would break the parse and silently downgrade a real
	// kill to WRONG-REASON. Legacy gates ignore the variable.
	env.ENTWURF_MUTATION_VITEST_REPORT = vitestReportPath(invocationDir);
	for (const d of ["home", "xdg-data", "xdg-config", "xdg-cache", "xdg-state"]) {
		fs.mkdirSync(path.join(invocationDir, d), { recursive: true });
	}
	env.HOME = path.join(invocationDir, "home");
	// TMPDIR is deliberately INHERITED, not fenced into the invocation dir: gates carry
	// their own mkdtemp+cleanup discipline, and a unix-socket cell (meta-identity's
	// socket-shaped record) must bind under the ~108-byte sun_path limit — an invocation
	// -nested TMPDIR pushed it over and turned the CONTROL red for a runner-side reason.
	env.XDG_DATA_HOME = path.join(invocationDir, "xdg-data");
	env.XDG_CONFIG_HOME = path.join(invocationDir, "xdg-config");
	env.XDG_CACHE_HOME = path.join(invocationDir, "xdg-cache");
	env.XDG_STATE_HOME = path.join(invocationDir, "xdg-state");
	return env;
}

/**
 * Run one gate bounded: detached (its own process group), fenced HOME/XDG in a FRESH
 * per-invocation directory (hardening #1; TMPDIR is inherited — see fencedEnv),
 * SIGKILL to the whole group on timeout. The invocation dir lives OUTSIDE the
 * snapshot repo tree and is removed by the caller after the run.
 */
export function runGateBounded(opts: {
	cwd: string;
	argv: string[];
	timeoutSeconds: number;
	invocationDir: string;
}): Promise<GateRunResult> {
	const started = Date.now();
	return new Promise((resolve, reject) => {
		const child = spawn(opts.argv[0], opts.argv.slice(1), {
			cwd: opts.cwd,
			env: fencedEnv(opts.invocationDir),
			detached: true,
			stdio: ["ignore", "pipe", "pipe"],
		});
		let output = "";
		let timedOut = false;
		const append = (chunk: Buffer): void => {
			if (output.length < OUTPUT_CAP) output += chunk.toString("utf8");
		};
		child.stdout.on("data", append);
		child.stderr.on("data", append);
		const timer = setTimeout(() => {
			timedOut = true;
			try {
				process.kill(-child.pid!, "SIGKILL");
			} catch {
				// group already gone
			}
		}, opts.timeoutSeconds * 1000);
		child.on("error", (err) => {
			clearTimeout(timer);
			reject(err);
		});
		child.on("close", (code) => {
			clearTimeout(timer);
			// Read the report BEFORE the caller removes the invocation dir.
			const failedTitles = readVitestFailedTitles(output, vitestReportPath(opts.invocationDir));
			resolve({ exitCode: code, timedOut, output, failedTitles, seconds: (Date.now() - started) / 1000 });
		});
	});
}

// ── orchestration: CONTROL → mutants → RESTORE → CONTROL per gate group ─────

export interface MutantResult {
	claim: string;
	verdict: MutantVerdict;
	seconds: number;
	subjectSha256: string;
	detail: string;
}

export interface GroupResult {
	gate: string[];
	control: "ok" | "pre-red" | "post-red" | "skipped";
	mutants: MutantResult[];
}

export interface QualifyReport {
	groups: GroupResult[];
	treeClean: boolean;
	porcelainClean: boolean;
}

export function reportPassed(report: QualifyReport): boolean {
	return (
		report.treeClean &&
		report.porcelainClean &&
		report.groups.every((g) => g.control === "ok" && g.mutants.every((m) => m.verdict === "KILLED"))
	);
}

function sha256File(file: string): string {
	return createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

export function countOccurrences(haystack: string, needle: string): number {
	let count = 0;
	let at = haystack.indexOf(needle);
	while (at !== -1) {
		count++;
		at = haystack.indexOf(needle, at + needle.length);
	}
	return count;
}

/** Tail of a red control run's captured output that gets echoed into the log. */
const CONTROL_TAIL_LINES = 40;

/**
 * Echo a RED control run's captured output. Without this the runner reports the
 * verdict (`RED (exit=1 …)`) and DROPS the reason it already holds, which makes a
 * CONTROL-RED that only reproduces on one host — a CI runner, say — undiagnosable
 * from its log: the same single line no matter how often it is re-run. A bounded
 * tail is enough, because a gate names its failure on the way out. Silence is a
 * finding too, so an empty capture is reported as empty rather than skipped.
 */
function logControlOutput(output: string, log: (line: string) => void): void {
	const body = output.replace(/\s+$/, "");
	if (body === "") {
		log("    │ (the control run produced no output — the failure is upstream of the gate's own reporting)");
		return;
	}
	const lines = body.split("\n");
	const dropped = Math.max(0, lines.length - CONTROL_TAIL_LINES);
	if (dropped > 0) log(`    │ … ${dropped} earlier line(s) omitted`);
	for (const line of lines.slice(-CONTROL_TAIL_LINES)) log(`    │ ${line}`);
}

/**
 * Run every mutant grouped by its gate command, with the control-mutant-restore-
 * control state machine. A red CONTROL-PRE aborts the whole group (every mutant
 * reports CONTROL-RED — a baseline-red gate can only produce fake kills); a failed
 * restore or a red CONTROL-POST marks the group IMPURE. The caller compares tree
 * manifests around the whole run.
 */
export async function qualifyMutants(
	snapshot: Snapshot,
	mutants: MutantSpec[],
	log: (line: string) => void,
): Promise<QualifyReport> {
	const preTree = computeTreeManifest(snapshot.repoDir);
	const groups = new Map<string, MutantSpec[]>();
	for (const m of mutants) {
		const key = JSON.stringify(m.gate);
		const list = groups.get(key) ?? [];
		list.push(m);
		groups.set(key, list);
	}
	// Every group's declaration is judged before the first gate runs, so a bad one late in the
	// set refuses the run up front instead of discarding an hour of earlier groups.
	for (const specs of groups.values()) {
		const build = groupBuild(specs);
		if (build) declaredBuildOutput(snapshot.repoDir, build);
	}

	const results: GroupResult[] = [];
	let invocationSeq = 0;
	const runOnce = async (argv: string[], timeoutSeconds: number): Promise<GateRunResult> => {
		const invocationDir = path.join(snapshot.baseDir, `invocation-${invocationSeq++}`);
		fs.mkdirSync(invocationDir, { mode: 0o700 });
		try {
			return await runGateBounded({ cwd: snapshot.repoDir, argv, timeoutSeconds, invocationDir });
		} finally {
			fs.rmSync(invocationDir, { recursive: true, force: true });
		}
	};

	const markControlRed = (group: GroupResult, specs: MutantSpec[], detail: string): void => {
		group.control = "pre-red";
		for (const m of specs) {
			group.mutants.push({
				claim: m.claim,
				verdict: classifyMutantRun({
					controlPreOk: false,
					matchCount: 1,
					timedOut: false,
					exitCode: null,
					signatureOnFailureLine: false,
					restoredOk: true,
				}),
				seconds: 0,
				subjectSha256: "",
				detail,
			});
		}
	};

	// The declared output, made from the snapshot's CURRENT bytes. Removed first, so the digest
	// sees this build's output alone, whatever the build script does about stale files. Green only
	// when the build exited 0 and left a real directory at the declared path; `digest` is null otherwise.
	const buildOutput = async (
		build: MutantBuild,
		outputAbs: string,
		timeoutSeconds: number,
	): Promise<{ run: GateRunResult; digest: string | null }> => {
		fs.rmSync(outputAbs, { recursive: true, force: true });
		const run = await runOnce(build.argv, timeoutSeconds);
		return { run, digest: !run.timedOut && run.exitCode === 0 ? buildOutputDigest(outputAbs) : null };
	};

	const runGroup = async (
		gate: string[],
		groupMutants: MutantSpec[],
		groupTimeout: number,
		group: GroupResult,
		build: MutantBuild | undefined,
		outputAbs: string | null,
	): Promise<void> => {
		let baseline: string | null = null;
		if (build && outputAbs) {
			const b = await buildOutput(build, outputAbs, groupTimeout);
			log(
				`  build ${build.argv.join(" ")} → ${build.output}: ${b.digest ? "built" : `RED (exit=${b.run.exitCode} timedOut=${b.run.timedOut})`} in ${b.run.seconds.toFixed(1)}s`,
			);
			if (!b.digest) {
				logControlOutput(b.run.output, log);
				markControlRed(
					group,
					groupMutants,
					"declared build red at baseline — the gate's input could not be made from the snapshot's own bytes",
				);
				return;
			}
			baseline = b.digest;
		}
		// A gate that writes into its declared build output would judge the next run against
		// bytes no build produced: every gate run below is bracketed by an output digest.
		const wroteOutput = (expected: string | null): boolean =>
			outputAbs !== null && buildOutputDigest(outputAbs) !== expected;

		const pre = await runOnce(gate, groupTimeout);
		const preWrote = wroteOutput(baseline);
		const controlPreOk = !pre.timedOut && pre.exitCode === 0 && !preWrote;
		log(
			`  control-pre ${gate.join(" ")}: ${controlPreOk ? "green" : preWrote ? "RED (the gate wrote into its declared build output)" : `RED (exit=${pre.exitCode} timedOut=${pre.timedOut})`} in ${pre.seconds.toFixed(1)}s`,
		);
		if (!controlPreOk) {
			logControlOutput(pre.output, log);
			markControlRed(group, groupMutants, "control-pre red — no kill can be claimed against a baseline-red gate");
			return;
		}

		let groupImpure = false;
		for (const m of groupMutants) {
			const subjectAbs = path.join(snapshot.repoDir, m.subject);
			// P0-1 runtime guard, IN ADDITION to the manifest-time origin check: the
			// snapshot preserves tracked symlinks, and readFileSync/writeFileSync FOLLOW
			// them — a symlink subject would mutate whatever it points at, potentially
			// OUTSIDE the snapshot. Refuse before reading a byte; also pin realpath
			// containment so no path component smuggles the write out. This path is
			// reachable without validateManifestSet (the self-test injects specs
			// directly), so the guard must live here, not only in validation.
			const subjectStat = fs.lstatSync(subjectAbs);
			if (!subjectStat.isFile() || subjectStat.isSymbolicLink()) {
				throw new Error(
					`subject ${m.subject} is not a regular non-symlink file in the snapshot — refusing to mutate (symlink-escape guard)`,
				);
			}
			const repoReal = fs.realpathSync(snapshot.repoDir) + path.sep;
			if (!fs.realpathSync(subjectAbs).startsWith(repoReal)) {
				throw new Error(`subject ${m.subject} resolves outside the snapshot repo — refusing to mutate`);
			}
			const originalBytes = fs.readFileSync(subjectAbs);
			const originalSha = createHash("sha256").update(originalBytes).digest("hex");
			const source = originalBytes.toString("utf8");
			const find = m.find.join("\n");
			const matchCount = countOccurrences(source, find);
			if (matchCount !== 1) {
				const verdict = classifyMutantRun({
					controlPreOk: true,
					matchCount,
					timedOut: false,
					exitCode: null,
					signatureOnFailureLine: false,
					restoredOk: true,
				});
				group.mutants.push({
					claim: m.claim,
					verdict,
					seconds: 0,
					subjectSha256: originalSha,
					detail: `find matched ${matchCount}× in ${m.subject} — nothing was written`,
				});
				log(`  claim ${m.claim}: ${verdict} (find matched ${matchCount}×)`);
				continue;
			}

			// A function replacement keeps the declared bytes literal: with a string
			// second argument, String.replace interprets `$&`/`$'`/"$`"/`$$` as
			// substitution patterns, so a replacement carrying one (bash `$$`, ANSI-C
			// `$'…'`) would silently plant DIFFERENT bytes than the manifest declares.
			fs.writeFileSync(
				subjectAbs,
				source.replace(find, () => m.replace.join("\n")),
			);
			let run: GateRunResult;
			let buildRed = false;
			let outputWritten = false;
			try {
				if (build && outputAbs) {
					// Rebuilt from the MUTATED bytes: the gate judges the output of the source it is handed.
					const b = await buildOutput(build, outputAbs, m.timeoutSeconds);
					if (b.digest === null) {
						buildRed = true;
						run = b.run;
					} else {
						run = await runOnce(m.gate, m.timeoutSeconds);
						outputWritten = wroteOutput(b.digest);
					}
				} else {
					run = await runOnce(m.gate, m.timeoutSeconds);
				}
			} finally {
				fs.writeFileSync(subjectAbs, originalBytes);
			}
			const restoredOk = sha256File(subjectAbs) === originalSha && !outputWritten;
			const verdict = classifyMutantRun({
				controlPreOk: true,
				matchCount: 1,
				timedOut: run.timedOut,
				// A build that exited 0 without leaving its declared output is a build red too.
				exitCode: buildRed && run.exitCode === 0 ? 1 : run.exitCode,
				// A build red is never a kill, whatever the build printed: the gate did not run.
				signatureOnFailureLine: !buildRed && signatureAttributedToFailure(run.output, m.signature, run.failedTitles),
				restoredOk,
			});
			if (!restoredOk) groupImpure = true;
			group.mutants.push({
				claim: m.claim,
				verdict,
				seconds: run.seconds,
				subjectSha256: originalSha,
				detail: buildRed
					? `declared build red under the mutation (exit=${run.exitCode} timedOut=${run.timedOut}) — the gate did not run`
					: `exit=${run.exitCode} timedOut=${run.timedOut} signature=${m.signature}` +
						` attribution=${describeAttribution(run.failedTitles)}` +
						(outputWritten ? " — the gate wrote into its declared build output" : ""),
			});
			log(
				`  claim ${m.claim}: ${verdict} in ${run.seconds.toFixed(1)}s (subject ${m.subject} sha256=${originalSha.slice(0, 12)}…)${buildRed ? " [build red]" : ""}${outputWritten ? " [gate wrote build output]" : ""}`,
			);
			if (!restoredOk) break; // contaminated snapshot — stop the group
		}

		if (groupImpure) {
			group.control = "post-red";
			return;
		}
		if (build && outputAbs) {
			// From the RESTORED bytes the build must reproduce its baseline output exactly.
			const b = await buildOutput(build, outputAbs, groupTimeout);
			if (b.digest !== baseline) {
				group.control = "post-red";
				log(
					`  control-post build ${build.argv.join(" ")}: RED (exit=${b.run.exitCode} timedOut=${b.run.timedOut}) — the restored bytes did not rebuild the baseline output`,
				);
				logControlOutput(b.run.output, log);
				return;
			}
		}
		const post = await runOnce(gate, groupTimeout);
		const postWrote = wroteOutput(baseline);
		const controlPostOk = !post.timedOut && post.exitCode === 0 && !postWrote;
		group.control = controlPostOk ? "ok" : "post-red";
		log(
			`  control-post ${gate.join(" ")}: ${controlPostOk ? "green" : postWrote ? "RED (the gate wrote into its declared build output)" : `RED (exit=${post.exitCode} timedOut=${post.timedOut}) — restore contamination or gate state leak`} in ${post.seconds.toFixed(1)}s`,
		);
		if (!controlPostOk) logControlOutput(post.output, log);
	};

	for (const [key, groupMutants] of groups) {
		const gate = JSON.parse(key) as string[];
		const groupTimeout = Math.max(...groupMutants.map((m) => m.timeoutSeconds));
		const build = groupBuild(groupMutants);
		const outputAbs = build ? declaredBuildOutput(snapshot.repoDir, build) : null;
		const group: GroupResult = { gate, control: "skipped", mutants: [] };
		results.push(group);
		try {
			await runGroup(gate, groupMutants, groupTimeout, group, build, outputAbs);
		} finally {
			// The output is this group's alone: removed whatever happened, so no later group — and
			// not the post-run tree manifest — ever sees it. declaredBuildOutput pinned its ancestors.
			if (outputAbs) fs.rmSync(outputAbs, { recursive: true, force: true });
		}
	}

	const postTree = computeTreeManifest(snapshot.repoDir);
	const porcelain = gitIn(snapshot.repoDir, ["status", "--porcelain"]).trim();
	return { groups: results, treeClean: postTree === preTree, porcelainClean: porcelain === "" };
}

// ── origin repo helpers ─────────────────────────────────────────────────────

export function originHead(originDir: string): string {
	return gitIn(originDir, ["rev-parse", "HEAD"]).trim();
}

/**
 * Content hash of the origin WORK SURFACE — every tracked or untracked-non-ignored
 * path with its type, mode, and content sha (symlinks by target). `git status
 * --porcelain` alone cannot see a byte change inside a file that was ALREADY
 * modified (same ` M` row, same porcelain text), so a tripwire built on it would
 * miss exactly the write it exists to catch (P1-5). This one does not.
 */
export function originWorkSurfaceSha(originDir: string): string {
	const listOut = gitIn(originDir, ["ls-files", "-z", "--cached", "--others", "--exclude-standard"]);
	const files = [...new Set(listOut.split("\0").filter((f) => f.length > 0))].sort();
	const lines: string[] = [];
	for (const rel of files) {
		const abs = path.join(originDir, rel);
		let st: fs.Stats;
		try {
			st = fs.lstatSync(abs);
		} catch {
			lines.push(`${rel}\0missing`);
			continue;
		}
		if (st.isSymbolicLink()) {
			lines.push(`${rel}\0link\0${fs.readlinkSync(abs)}`);
		} else if (st.isFile()) {
			const sha = createHash("sha256").update(fs.readFileSync(abs)).digest("hex");
			lines.push(`${rel}\0${(st.mode & 0o777).toString(8)}\0${sha}`);
		} else {
			lines.push(`${rel}\0special`);
		}
	}
	return createHash("sha256").update(lines.join("\n")).digest("hex");
}

export function makeOriginChecks(originDir: string): OriginChecks {
	return {
		subjectTracked: (subject: string): boolean => {
			const r = spawnSync("git", ["-C", originDir, "ls-files", "--error-unmatch", "--", subject], {
				stdio: "ignore",
				env: { ...process.env, ...SNAPSHOT_GIT_ENV },
			});
			return r.status === 0;
		},
		regularContainedFile: (file: string): boolean => {
			try {
				const abs = path.join(originDir, file);
				const st = fs.lstatSync(abs);
				if (!st.isFile() || st.isSymbolicLink()) return false;
				return fs.realpathSync(abs).startsWith(fs.realpathSync(originDir) + path.sep);
			} catch {
				return false;
			}
		},
		onWorkSurface: (file: string): boolean => {
			const r = spawnSync(
				"git",
				["-C", originDir, "ls-files", "-z", "--cached", "--others", "--exclude-standard", "--", file],
				{ encoding: "utf8", env: { ...process.env, ...SNAPSHOT_GIT_ENV } },
			);
			return (
				r.status === 0 &&
				r.stdout
					.split("\0")
					.filter((f) => f.length > 0)
					.includes(file)
			);
		},
		tokenCount: (file: string, token: string): number => {
			try {
				return countOccurrences(fs.readFileSync(path.join(originDir, file), "utf8"), token);
			} catch {
				return 0;
			}
		},
	};
}
