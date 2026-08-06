/**
 * inventory-verification-surface — Phase 0 of issue #62 (vitest adoption).
 *
 * The issue's own measurements shifted with the glob used; this script FIXES the
 * denominator. Review (2026-08-07) found the first cut mis-measured the migration
 * itself, so the denominator is now BOTH verification axes together:
 *
 *   legacy axis     scripts/  (hand-built gates, lib, mutants, fixtures)
 *   framework axis  test/ + vitest.config.ts  (vitest-managed lanes)
 *
 * both from `git ls-files --cached --others --exclude-standard` (tracked plus
 * untracked-non-ignored — the same work surface qualification hashes), so moving a
 * gate from scripts/ into test/ moves lines BETWEEN axes and the combined total
 * stays honest: migration is not subtraction unless the combined number drops.
 *
 * PRIMARY classification is the issue's own six semantic classes, decided by the
 * first matching rule below (re-derivable; narrow explicit overrides carry a
 * reason and are printed). `unclassified` is asserted to be ZERO — a file no rule
 * reaches is a loud error, never a silent bucket:
 *
 *   1 real-live             name *-live.* OR gates on LIVE=1 (needs real
 *                           accounts/models/tmux; smoke-*-install-state is NOT
 *                           live — it matches rule 2 first by name)
 *   2 package-install       name carries pack|install (tarball/install surface)
 *   3 hermetic-integration  spawns a subprocess, stands a local server, or is a
 *                           .sh gate — real processes, no external accounts
 *   4 source-topology       reads product source as text WITHOUT importing it
 *   5 behavioral-contract   imports and executes product code, with fs/fixtures
 *                           or auxiliary source reads
 *   6 pure-unit             imports and executes product code, no fs, no text
 *                           reads, no processes
 *
 * The SECONDARY style axis (imports-product / source-text / subprocess / mixed /
 * shell / other) is the issue's measurement table, kept for continuity with the
 * recorded e405d64 baseline snapshot — style describes HOW a gate is written,
 * the six classes describe WHAT it proves.
 *
 * A test/*.test.ts file is classified together with the ./helpers/* bodies it
 * imports: the helper is part of how that lane earns its green (a bridge boot
 * hidden in a helper still makes the lane an integration lane).
 *
 * Plus the mutant inventory per lane, split by whether the mutant's SUBJECT is
 * product code or the verification surface itself (scripts/).
 *
 * Read-only and not a gate: it never writes; its one assertion (unclassified=0)
 * exists so the classification cannot silently rot. Phase 1–4 decisions cite this
 * one reproducible table instead of ad-hoc greps.
 */

import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function git(args: string[]): string {
	return execFileSync("git", args, { cwd: REPO_DIR, encoding: "utf8" });
}

function listWorkSurface(pathspec: string[]): string[] {
	return [
		...new Set(
			git(["ls-files", "--cached", "--others", "--exclude-standard", "--", ...pathspec])
				.split("\n")
				.filter((f) => f.length > 0 && fs.existsSync(path.join(REPO_DIR, f))),
		),
	].sort();
}

const legacyFiles = listWorkSurface(["scripts/"]);
const frameworkFiles = listWorkSurface(["test/", "vitest.config.ts"]);

function countLines(rel: string): number {
	const body = fs.readFileSync(path.join(REPO_DIR, rel), "utf8");
	if (body.length === 0) return 0;
	return body.split("\n").length - (body.endsWith("\n") ? 1 : 0);
}

// ── rule predicates (printed, so every number is re-derivable) ───────────────
const H_IMPORTS = /(?:from\s+["']|import\(\s*["'])(?:\.\.\/)+(?:pi-extensions|mcp)\//;
const H_TEXT = /readFileSync[^\n]*(?:pi-extensions|mcp\/|\.ts["'`]|SOURCE|SRC)|\bread\(["'](?:pi-extensions|mcp)\//;
const H_PROC = /\b(?:spawn|spawnSync|execFile|execFileSync|execSync|fork)\s*\(|subprocess\.(?:run|Popen|check_)/;
const H_NET = /\b(?:http|net)\.createServer|\.listen\(/;
const H_FS = /from\s+["']node:fs["']|require\(["']node:fs["']\)/;
const H_LIVE = /process\.env\.LIVE|\bLIVE=1\b/;

type SemanticClass =
	| "real-live"
	| "package-install"
	| "hermetic-integration"
	| "source-topology"
	| "behavioral-contract"
	| "pure-unit";

/** Narrow explicit overrides for files the mechanical rules cannot reach. Every
 * entry carries its reason and is printed with the table — extending this map is
 * a reviewed decision, not a default. */
const CLASS_OVERRIDES: Record<string, { cls: SemanticClass; reason: string }> = {
	// These three read repo files through paths assembled at runtime, so the
	// H_TEXT line-level heuristic cannot see them; each is a structure-over-text
	// gate with no product execution.
	"scripts/check-entwurf-bridge-pi-free.ts": {
		cls: "source-topology",
		reason: "walks the bridge's static value-import closure as text to forbid @earendil-works imports",
	},
	"scripts/check-shell-quote.ts": {
		cls: "source-topology",
		reason: "reads the shellQuote() implementation sites as text and cross-checks the POSIX escape contract",
	},
	"scripts/check-mux-parent-artifact.ts": {
		cls: "source-topology",
		reason: "asserts the scrubbed parent-transcript fixture's recorded shape — an artifact contract, no product run",
	},
};

type Style = "imports-product" | "source-text" | "subprocess" | "mixed" | "shell" | "other";

interface Row {
	file: string;
	axis: "legacy" | "framework";
	lines: number;
	cls: SemanticClass;
	overridden: boolean;
	style: Style;
}

/** A test file is judged together with the ./helpers/ bodies it imports. */
function effectiveBody(rel: string): string {
	let body = fs.readFileSync(path.join(REPO_DIR, rel), "utf8");
	if (rel.startsWith("test/") && rel.endsWith(".test.ts")) {
		for (const m of body.matchAll(/from\s+["']\.\/(helpers\/[^"']+?)(?:\.ts)?["']/g)) {
			const helper = path.join(REPO_DIR, "test", `${m[1]}.ts`.replace(/\.ts\.ts$/, ".ts"));
			if (fs.existsSync(helper)) body += `\n${fs.readFileSync(helper, "utf8")}`;
		}
	}
	return body;
}

function classify(rel: string, axis: "legacy" | "framework"): Row {
	const lines = countLines(rel);
	const isShell = rel.endsWith(".sh");
	const body = isShell ? fs.readFileSync(path.join(REPO_DIR, rel), "utf8") : effectiveBody(rel);
	const base = path.basename(rel);

	const style: Style = (() => {
		if (isShell) return "shell";
		const axes = [H_IMPORTS.test(body), H_TEXT.test(body), H_PROC.test(body)];
		const n = axes.filter(Boolean).length;
		if (n >= 2) return "mixed";
		if (axes[0]) return "imports-product";
		if (axes[1]) return "source-text";
		if (axes[2]) return "subprocess";
		return "other";
	})();

	const override = CLASS_OVERRIDES[rel];
	const cls: SemanticClass | null = override
		? override.cls
		: /-live\.(ts|sh)$/.test(base) || H_LIVE.test(body)
			? "real-live"
			: /pack|install/.test(base)
				? "package-install"
				: isShell || H_PROC.test(body) || H_NET.test(body)
					? "hermetic-integration"
					: H_TEXT.test(body) && !H_IMPORTS.test(body)
						? "source-topology"
						: H_IMPORTS.test(body) && (H_TEXT.test(body) || H_FS.test(body))
							? "behavioral-contract"
							: H_IMPORTS.test(body)
								? "pure-unit"
								: null;
	if (cls === null) {
		throw new Error(
			`unclassified gate: ${rel} — no rule reaches it; extend the rules or add a reasoned CLASS_OVERRIDES entry`,
		);
	}
	return { file: rel, axis, lines, cls, overridden: Boolean(override), style };
}

// ── buckets ──────────────────────────────────────────────────────────────────
const legacyGates = legacyFiles.filter((f) => /^scripts\/(check-|smoke-)/.test(f));
const frameworkGates = frameworkFiles.filter((f) => /^test\/.*\.test\.ts$/.test(f));
const lib = legacyFiles.filter((f) => f.startsWith("scripts/lib/"));
const mutantManifests = legacyFiles.filter((f) => f.startsWith("scripts/mutants/") && f.endsWith(".json"));
const fixtures = legacyFiles.filter((f) => f.startsWith("scripts/fixtures/"));
const legacyOther = legacyFiles.filter(
	(f) => !legacyGates.includes(f) && !lib.includes(f) && !mutantManifests.includes(f) && !fixtures.includes(f),
);
const frameworkSupport = frameworkFiles.filter((f) => !frameworkGates.includes(f));

const rows: Row[] = [
	...legacyGates.map((f) => classify(f, "legacy")),
	...frameworkGates.map((f) => classify(f, "framework")),
];

function sum(rs: Row[]): number {
	return rs.reduce((a, r) => a + r.lines, 0);
}
function total(files: string[]): number {
	return files.reduce((a, f) => a + countLines(f), 0);
}

const head = git(["rev-parse", "--short", "HEAD"]).trim();
console.log(`inventory-verification-surface — work surface (tracked + untracked-non-ignored) @ HEAD ${head}`);
console.log(`
rule predicates (re-derive any number from these):
  H_IMPORTS  ${H_IMPORTS}
  H_TEXT     ${H_TEXT}
  H_PROC     ${H_PROC}
  H_NET      ${H_NET}
  H_FS       ${H_FS}
  H_LIVE     ${H_LIVE}
semantic classes, first match wins: override → real-live (name -live | H_LIVE) →
  package-install (name pack|install) → hermetic-integration (.sh | H_PROC | H_NET) →
  source-topology (H_TEXT ∧ ¬H_IMPORTS) → behavioral-contract (H_IMPORTS ∧ (H_TEXT ∨ H_FS)) →
  pure-unit (H_IMPORTS) → ERROR (unclassified is asserted zero)
test/*.test.ts is classified together with the ./helpers/* bodies it imports.
`);

const legacyTotal = total(legacyFiles);
const frameworkTotal = total(frameworkFiles);
console.log(`legacy axis (scripts/):            ${legacyFiles.length} files, ${legacyTotal} lines`);
console.log(
	`  gates (check-*/smoke-*):         ${legacyGates.length} files, ${sum(rows.filter((r) => r.axis === "legacy"))} lines`,
);
console.log(`  scripts/lib/:                    ${lib.length} files, ${total(lib)} lines`);
console.log(`  scripts/mutants/:                ${mutantManifests.length} manifests`);
console.log(`  scripts/fixtures/:               ${fixtures.length} files`);
console.log(`  other:                           ${legacyOther.length} files, ${total(legacyOther)} lines`);
console.log(`framework axis (test/ + vitest.config.ts): ${frameworkFiles.length} files, ${frameworkTotal} lines`);
console.log(
	`  vitest lanes (test/**/*.test.ts):  ${frameworkGates.length} files, ${sum(rows.filter((r) => r.axis === "framework"))} lines`,
);
console.log(`  helpers/config:                    ${frameworkSupport.length} files, ${total(frameworkSupport)} lines`);
console.log(
	`COMBINED verification total:       ${legacyFiles.length + frameworkFiles.length} files, ${legacyTotal + frameworkTotal} lines`,
);
console.log("  (migration moves lines between axes; only a drop in THIS number is subtraction)");

console.log("\nsemantic class breakdown (all gates, both axes):");
const classes: SemanticClass[] = [
	"pure-unit",
	"behavioral-contract",
	"source-topology",
	"hermetic-integration",
	"package-install",
	"real-live",
];
for (const c of classes) {
	const rs = rows.filter((r) => r.cls === c);
	console.log(`  ${c.padEnd(21)} ${String(rs.length).padStart(3)} files ${String(sum(rs)).padStart(7)} lines`);
}
console.log(`  ${"unclassified".padEnd(21)}   0 files       0 lines (asserted: the classifier throws otherwise)`);

console.log("\nstyle axis (secondary, e405d64-baseline continuity):");
const styles: Style[] = ["imports-product", "source-text", "subprocess", "mixed", "shell", "other"];
for (const s of styles) {
	const rs = rows.filter((r) => r.style === s);
	console.log(`  ${s.padEnd(21)} ${String(rs.length).padStart(3)} files ${String(sum(rs)).padStart(7)} lines`);
}

const overridden = rows.filter((r) => r.overridden);
if (overridden.length > 0) {
	console.log("\nexplicit overrides in effect (each is a reviewed decision):");
	for (const r of overridden) console.log(`  ${r.file} → ${r.cls} (${CLASS_OVERRIDES[r.file].reason})`);
}

// ── mutant inventory ─────────────────────────────────────────────────────────
interface MutantEntry {
	subject: string;
}
let totalMutants = 0;
let infraMutants = 0;
console.log("\nmutant lanes (subject=scripts/* counts as verification-infra):");
for (const manifest of mutantManifests) {
	const parsed = JSON.parse(fs.readFileSync(path.join(REPO_DIR, manifest), "utf8")) as {
		lane: string;
		mutants: MutantEntry[];
	};
	const infra = parsed.mutants.filter((m) => m.subject.startsWith("scripts/")).length;
	totalMutants += parsed.mutants.length;
	infraMutants += infra;
	console.log(
		`  ${parsed.lane.padEnd(24)} ${String(parsed.mutants.length).padStart(3)} mutants  (${infra} infra-subject)`,
	);
}
console.log(`  ${"TOTAL".padEnd(24)} ${String(totalMutants).padStart(3)} mutants  (${infraMutants} infra-subject)`);

console.log("\nper-gate table (axis, class, style, lines):");
for (const r of rows) {
	console.log(
		`  ${r.axis.padEnd(9)} ${r.cls.padEnd(21)} ${r.style.padEnd(16)} ${String(r.lines).padStart(6)}  ${r.file}${r.overridden ? "  [override]" : ""}`,
	);
}
