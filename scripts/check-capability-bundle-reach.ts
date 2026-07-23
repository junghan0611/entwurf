/**
 * check-capability-bundle-reach — the gate that check-entwurf-capabilities
 * structurally CANNOT be.
 *
 * `metaCapabilitiesFilePath()` does exactly one thing: compute a path relative to
 * its OWN file location (`import.meta.dirname`). Every existing capability gate
 * imports it as `../pi-extensions/lib/meta-session.ts` — i.e. runs it from the one
 * location where that relative arithmetic is correct — so the assertion
 * "the registry resolves" is a tautology there and can never fail.
 *
 * The package ships that module TWICE at two different depths:
 *   - `<root>/pi-extensions/lib/meta-session.ts`                     (source; `../../pi/` → `<root>/pi/`)
 *   - `<root>/mcp/entwurf-bridge/dist/pi-extensions/lib/meta-session.js` (bridge bundle, 3 levels deeper)
 * The second copy is the one the entwurf-bridge MCP server actually executes, so it
 * is the one that answers `entwurf_v2`. It never had a registry it could reach:
 * both branches land inside `mcp/entwurf-bridge/dist/` and neither file exists, so
 * every real send died `ENOENT ... dist/pi-extensions/entwurf-capabilities.json`
 * while `entwurf_self` / `entwurf_peers` (which never read the registry) stayed
 * green and hid it.
 *
 * So this gate does NOT import the module by a hardcoded source path. It DISCOVERS
 * every shipped copy and re-asks each one, from where it actually lives:
 *   - B1: discovery is non-vacuous (both known copies found; a moved/renamed emit
 *         must fail here rather than pass on an empty set),
 *   - B2: `metaCapabilitiesFilePath()` resolves to a file that EXISTS,
 *   - B3: the bytes it reaches are the shipped `pi/entwurf-capabilities.json`
 *         (reaching a stale/divergent copy is not reach),
 *   - B4: the live load seam `metaCapabilityFor()` returns for every
 *         META_BACKENDS_V2 backend without throwing — the real `entwurf_v2` path.
 *
 * Deterministic: filesystem + import only. No backend, no network, no API, no
 * record write. Safe in the `pnpm check` static floor.
 *
 * REQUIRES a built bridge (`pnpm run build-bridge`, which `prepare`/`prepack` run).
 * A missing dist is a FAILURE, never a skip — a gate that skips when the artifact
 * is absent reproduces exactly the blindness this gate exists to remove.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const REPO = path.join(import.meta.dirname, "..");

let passed = 0;
function ok(label: string, cond: boolean, detail?: string): void {
	assert.ok(cond, detail ? `${label}\n${detail}` : label);
	console.log(`  ok    ${label}`);
	passed++;
}

/** The registry the package ships — the single byte-source every copy must reach. */
const REGISTRY_SOURCE = path.join(REPO, "pi", "entwurf-capabilities.json");
const REGISTRY_BYTES = fs.readFileSync(REGISTRY_SOURCE, "utf8");

/**
 * Every shipped copy of the module, discovered under the `files` roots that carry
 * one (`pi-extensions/`, `mcp/`). Discovery, not a hardcoded list: a build that
 * moves or duplicates the emit must be re-asked at its new depth automatically.
 */
function discoverCopies(root: string, found: string[] = []): string[] {
	for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
		if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
		const full = path.join(root, entry.name);
		if (entry.isDirectory()) discoverCopies(full, found);
		else if (entry.name === "meta-session.ts" || entry.name === "meta-session.js") found.push(full);
	}
	return found;
}

const BRIDGE_DIST = path.join(REPO, "mcp", "entwurf-bridge", "dist");
ok(
	"bridge bundle is built (a missing dist is a failure, not a skip)",
	fs.existsSync(BRIDGE_DIST),
	`--- expected ---\n${BRIDGE_DIST}\nrun: pnpm run build-bridge`,
);

const copies = [...discoverCopies(path.join(REPO, "pi-extensions")), ...discoverCopies(path.join(REPO, "mcp"))].sort();

// B1 — discovery is non-vacuous. Both known-shipping copies must be present, so
// this gate cannot silently pass over an empty or truncated set.
const rel = (p: string) => path.relative(REPO, p);
for (const expected of [
	"pi-extensions/lib/meta-session.ts",
	"mcp/entwurf-bridge/dist/pi-extensions/lib/meta-session.js",
]) {
	ok(
		`B1: discovery found the shipped copy ${expected}`,
		copies.some((c) => rel(c) === expected),
		`--- discovered ---\n${copies.map(rel).join("\n") || "(none)"}`,
	);
}

// B2/B3/B4 — re-ask EVERY copy from where it actually lives.
for (const copy of copies) {
	const where = rel(copy);
	const mod = await import(pathToFileURL(copy).href);
	const resolved: string = mod.metaCapabilitiesFilePath();

	ok(
		`B2: ${where} resolves its registry to an existing file`,
		fs.existsSync(resolved),
		`--- resolved ---\n${resolved}\n--- shipped registry lives at ---\n${REGISTRY_SOURCE}`,
	);

	ok(
		`B3: ${where} reaches the shipped pi/entwurf-capabilities.json bytes`,
		fs.readFileSync(resolved, "utf8") === REGISTRY_BYTES,
		`--- resolved ---\n${resolved}`,
	);

	// B4 — the live seam the real entwurf_v2 send goes through. B2 proves a file is
	// there; this proves the load path actually returns instead of throwing.
	for (const backend of mod.META_BACKENDS_V2) {
		let threw: string | null = null;
		try {
			mod.metaCapabilityFor(backend);
		} catch (e) {
			threw = e instanceof Error ? e.message : String(e);
		}
		ok(
			`B4: ${where} metaCapabilityFor(${backend}) loads without throwing`,
			threw === null,
			threw ? `--- threw ---\n${threw}` : undefined,
		);
	}
}

console.log(`\ncheck-capability-bundle-reach: PASS (${passed} assertions)`);
