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

export class ManifestError extends Error {}

function requireExactKeys(obj: Record<string, unknown>, keys: string[], where: string): void {
	for (const k of Object.keys(obj)) {
		if (!keys.includes(k)) throw new ManifestError(`${where}: unknown key \`${k}\``);
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
		requireExactKeys(rec, MUTANT_KEYS, where);
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
		});
	}
	return { schemaVersion: 1, lane: doc.lane, mutants };
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

/**
 * Sweep stale snapshot dirs left by a SIGKILLed/powered-off run. Only dirs whose
 * recorded runner pid is dead are removed; a dir with no runner.json is removed only
 * once it is old (another runner may be mid-mkdtemp). Residue is inert tmp garbage —
 * the real checkout was never written — so this is tidiness, not recovery.
 */
export function sweepStaleSnapshots(tmpRoot: string): string[] {
	const swept: string[] = [];
	let entries: string[];
	try {
		entries = fs.readdirSync(tmpRoot);
	} catch {
		return swept;
	}
	for (const name of entries) {
		if (!name.startsWith(SNAPSHOT_PREFIX)) continue;
		const dir = path.join(tmpRoot, name);
		const marker = path.join(dir, "runner.json");
		let dead = false;
		try {
			const rec = JSON.parse(fs.readFileSync(marker, "utf8")) as { pid?: number };
			if (typeof rec.pid !== "number") dead = true;
			else if (rec.pid !== process.pid) {
				try {
					process.kill(rec.pid, 0);
				} catch {
					dead = true;
				}
			}
		} catch {
			try {
				dead = Date.now() - fs.statSync(dir).mtimeMs > 60_000;
			} catch {
				continue;
			}
		}
		if (dead) {
			fs.rmSync(dir, { recursive: true, force: true });
			swept.push(dir);
		}
	}
	return swept;
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
	fs.writeFileSync(path.join(baseDir, "runner.json"), JSON.stringify({ pid: process.pid, startedAt: Date.now() }));
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
 * Content manifest of the snapshot tree — path+mode+sha256 for files, target for
 * symlinks, bare entries for dirs — excluding .git and node_modules. Porcelain alone
 * misses ignored-path writes; this does not (hardening #4).
 */
export function computeTreeManifest(repoDir: string): string {
	const lines: string[] = [];
	const walk = (rel: string): void => {
		const abs = path.join(repoDir, rel);
		for (const name of fs.readdirSync(abs).sort()) {
			if (rel === "" && (name === ".git" || name === "node_modules")) continue;
			const childRel = rel === "" ? name : `${rel}/${name}`;
			const st = fs.lstatSync(path.join(repoDir, childRel));
			if (st.isSymbolicLink()) {
				lines.push(`${childRel}\0link\0${fs.readlinkSync(path.join(repoDir, childRel))}`);
			} else if (st.isDirectory()) {
				lines.push(`${childRel}\0dir`);
				walk(childRel);
			} else if (st.isFile()) {
				const sha = createHash("sha256")
					.update(fs.readFileSync(path.join(repoDir, childRel)))
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

function countOccurrences(haystack: string, needle: string): number {
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

	for (const [key, groupMutants] of groups) {
		const gate = JSON.parse(key) as string[];
		const groupTimeout = Math.max(...groupMutants.map((m) => m.timeoutSeconds));
		const group: GroupResult = { gate, control: "skipped", mutants: [] };
		results.push(group);

		const pre = await runOnce(gate, groupTimeout);
		const controlPreOk = !pre.timedOut && pre.exitCode === 0;
		log(
			`  control-pre ${gate.join(" ")}: ${controlPreOk ? "green" : `RED (exit=${pre.exitCode} timedOut=${pre.timedOut})`} in ${pre.seconds.toFixed(1)}s`,
		);
		if (!controlPreOk) {
			logControlOutput(pre.output, log);
			group.control = "pre-red";
			for (const m of groupMutants) {
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
					detail: "control-pre red — no kill can be claimed against a baseline-red gate",
				});
			}
			continue;
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
			try {
				run = await runOnce(m.gate, m.timeoutSeconds);
			} finally {
				fs.writeFileSync(subjectAbs, originalBytes);
			}
			const restoredOk = sha256File(subjectAbs) === originalSha;
			const verdict = classifyMutantRun({
				controlPreOk: true,
				matchCount: 1,
				timedOut: run.timedOut,
				exitCode: run.exitCode,
				signatureOnFailureLine: signatureAttributedToFailure(run.output, m.signature, run.failedTitles),
				restoredOk,
			});
			if (!restoredOk) groupImpure = true;
			group.mutants.push({
				claim: m.claim,
				verdict,
				seconds: run.seconds,
				subjectSha256: originalSha,
				detail:
					`exit=${run.exitCode} timedOut=${run.timedOut} signature=${m.signature}` +
					` attribution=${describeAttribution(run.failedTitles)}`,
			});
			log(
				`  claim ${m.claim}: ${verdict} in ${run.seconds.toFixed(1)}s (subject ${m.subject} sha256=${originalSha.slice(0, 12)}…)`,
			);
			if (!restoredOk) break; // contaminated snapshot — stop the group
		}

		if (groupImpure) {
			group.control = "post-red";
			continue;
		}
		const post = await runOnce(gate, groupTimeout);
		const controlPostOk = !post.timedOut && post.exitCode === 0;
		group.control = controlPostOk ? "ok" : "post-red";
		log(
			`  control-post ${gate.join(" ")}: ${controlPostOk ? "green" : `RED (exit=${post.exitCode} timedOut=${post.timedOut}) — restore contamination or gate state leak`} in ${post.seconds.toFixed(1)}s`,
		);
		if (!controlPostOk) logControlOutput(post.output, log);
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
