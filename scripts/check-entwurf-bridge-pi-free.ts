// check-entwurf-bridge-pi-free (0.12.1 A-gate, static half)
//
// INVARIANT: the entwurf-bridge MCP server must boot WITHOUT any pi package
// (`@earendil-works/pi-*`). entwurf is a harness-neutral npm package; pi is one
// optional adapter lane, not a boot dependency. A plain `npm install
// @junghanacs/entwurf` (no pi peers) must still stand `entwurf-bridge` up and
// answer MCP `tools/list`.
//
// This gate is the STATIC half of that contract: it walks the EAGER static
// value-import closure of the bridge entry (`mcp/entwurf-bridge/src/index.ts`)
// and fails if any reachable module statically value-imports `@earendil-works/*`.
//
// "Eager static value-import" is the precise boundary (GPT-agreed):
//   - `import type …`               → erased by strip-types        → NOT followed
//   - `import { type A, type B }`    → all-type, erased            → NOT followed
//   - `import { type A, b }`         → has a value binding, kept    → followed
//   - `import x` / `import * as x`   → value                        → followed
//   - `import "x"` (side-effect)     → value                        → followed
//   - `export { a } from "x"`        → value re-export              → followed
//   - `export type { a } from "x"`   → type re-export, erased       → NOT followed
//   - `await import("x")` (dynamic)  → INTENDED lazy boundary       → NOT followed
//
// The dynamic-import exemption is deliberate: B-2 makes the pi-coding-agent
// `preflight` a lazy `await import("./entwurf-preflight.ts")`, so it is allowed to
// pull pi at runtime behind that lazy edge. The branch that used to reach it — the
// owned-outcome resume verdict — is gone, which makes the exemption WIDER than its
// current need, not narrower: nothing on the v2 dispatch path pulls pi now. The
// runtime boot smoke (separate half) is the final authority that
// peers/self/list/mailbox-deliver come up pi-free.

import { existsSync, readFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";

const REPO = resolve(import.meta.dirname, "..");
const ENTRY = resolve(REPO, "mcp/entwurf-bridge/src/index.ts");
const PI_SPECIFIER = /^@earendil-works\/pi-(ai|coding-agent|tui)(\/|$)/;

/** Strip line + block comments so a commented-out import never registers. */
function stripComments(src: string): string {
	return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

/** Is every named binding in a `{ … }` clause a `type` binding? (→ import erased) */
function allNamedAreType(clause: string): boolean {
	const parts = clause
		.split(",")
		.map((p) => p.trim())
		.filter(Boolean);
	if (parts.length === 0) return false; // `import {} from` is odd; treat as value.
	return parts.every((p) => /^type\s/.test(p));
}

/**
 * Return the runtime-loaded (non-type, non-dynamic) module specifiers of `src`.
 * Only static `import …`/`export … from` whose effect survives strip-types.
 */
function runtimeSpecifiers(src: string): string[] {
	const clean = stripComments(src);
	const specs: string[] = [];
	// import … from "spec"  |  import "spec"
	const importRe = /\bimport\b([^"'`;]*?)\bfrom\b\s*["'`]([^"'`]+)["'`]|\bimport\s*["'`]([^"'`]+)["'`]/g;
	for (let m = importRe.exec(clean); m !== null; m = importRe.exec(clean)) {
		const sideEffect = m[3];
		if (sideEffect) {
			specs.push(sideEffect);
			continue;
		}
		const clause = (m[1] ?? "").trim();
		const spec = m[2];
		if (/^type\b/.test(clause)) continue; // `import type …`
		const braced = clause.match(/\{([^}]*)\}/);
		// A pure `{ … }` clause (no default/namespace) that is all-type is erased.
		if (braced && !/^[A-Za-z0-9_$]/.test(clause) && allNamedAreType(braced[1])) continue;
		specs.push(spec);
	}
	// export … from "spec"  (value re-export);  export type … from → skip
	const reexportRe = /\bexport\b([^"'`;]*?)\bfrom\b\s*["'`]([^"'`]+)["'`]/g;
	for (let m = reexportRe.exec(clean); m !== null; m = reexportRe.exec(clean)) {
		const clause = (m[1] ?? "").trim();
		const spec = m[2];
		if (/^type\b/.test(clause)) continue; // `export type … from`
		const braced = clause.match(/\{([^}]*)\}/);
		if (braced && allNamedAreType(braced[1])) continue;
		specs.push(spec);
	}
	return specs;
}

/** Resolve a relative specifier to an on-disk source file, or null if external. */
function resolveLocal(fromFile: string, spec: string): string | null {
	if (!spec.startsWith(".")) return null; // bare/external — handled by caller
	const base = resolve(dirname(fromFile), spec);
	const candidates = [
		base,
		`${base}.ts`,
		`${base}.js`,
		`${base}.mjs`,
		resolve(base, "index.ts"),
		resolve(base, "index.js"),
	];
	for (const c of candidates) if (existsSync(c)) return c;
	return null;
}

// BFS over the eager static value-import closure.
const visited = new Set<string>();
const violations: Array<{ chain: string[]; specifier: string }> = [];
const queue: Array<{ file: string; chain: string[] }> = [{ file: ENTRY, chain: [relative(REPO, ENTRY)] }];

while (queue.length > 0) {
	const { file, chain } = queue.shift()!;
	if (visited.has(file)) continue;
	visited.add(file);
	let src: string;
	try {
		src = readFileSync(file, "utf8");
	} catch {
		continue;
	}
	for (const spec of runtimeSpecifiers(src)) {
		if (PI_SPECIFIER.test(spec)) {
			violations.push({ chain, specifier: spec });
			continue;
		}
		const local = resolveLocal(file, spec);
		if (local && !visited.has(local)) {
			queue.push({ file: local, chain: [...chain, relative(REPO, local)] });
		}
	}
}

if (violations.length > 0) {
	console.error("[check-entwurf-bridge-pi-free] FAIL: bridge boot closure statically value-imports pi:");
	for (const v of violations) {
		console.error(`  - ${v.specifier}`);
		console.error(`      via ${v.chain.join(" -> ")}`);
	}
	console.error(
		"\n  The entwurf-bridge MCP server must boot pi-free. Move the pi value-import behind a\n" +
			"  type-only import, a pi-side module the bridge does not reach, or a lazy `await import()`.",
	);
	process.exit(1);
}

console.log(
	`[check-entwurf-bridge-pi-free] ok — bridge boot closure is pi-free (${visited.size} modules walked, no static @earendil-works/pi-* value-import)`,
);
