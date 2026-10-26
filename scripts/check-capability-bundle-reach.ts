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
 *         META_CITIZEN_BACKENDS backend without throwing — the real `entwurf_v2` path.
 *
 *   - C (#147 L2 B1): the compiled Claude Code hook's static `from` closure equals what
 *         the installer copies, and the hook staged with only that closure runs.
 *   - D (#147 G3): the compiled Claude Code retire adapter resolves its helper beside itself,
 *         byte-identical to pi-extensions/lib/cc-retire-pidfd.py.
 *   - F (#154): the fixed guidance carrier has the canonical Root bytes, and its emitted
 *         reader exports that Root's version/tools (plain JSON expected data, not a source reader).
 *
 * Deterministic: filesystem, import, and ONE shipped-hook child process (C2) that writes a
 * record into its own private store under a private HOME and XDG roots. No backend, vendor
 * CLI, model, network or API. Safe in the `pnpm check` static floor.
 *
 * REQUIRES a built bridge (`pnpm run build-bridge`, which `prepare`/`prepack` run).
 * A missing dist is a FAILURE, never a skip — a gate that skips when the artifact
 * is absent reproduces exactly the blindness this gate exists to remove.
 */

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { hookImportClosure, installerCopiedLibFiles, stageMetaHookBundle } from "./lib/meta-hook-bundle.ts";
import { reclaimOnExit } from "./lib/reclaim-on-exit.ts";

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
	for (const backend of mod.META_CITIZEN_BACKENDS) {
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

// C — the COMPILED Claude Code hook bundle reaches its whole closure (#147 L2 B1). Moved here from
// check-meta-hook-session-switch, whose source-only qualification snapshot has no dist: this gate
// already requires the built bundle, so the emission proof sits with the dist consumer. Scope is
// the static double-quoted `from` imports scripts/lib/meta-hook-bundle.ts follows; the staged RUN
// is the independent proof that nothing outside them is needed.
{
	const DIST_HOOK = path.join(BRIDGE_DIST, "pi-extensions", "meta-bridge-hook.js");
	ok(
		"C0: the compiled hook entry exists (a missing dist is a failure, not a skip)",
		fs.existsSync(DIST_HOOK),
		`--- expected ---\n${DIST_HOOK}\nrun: pnpm run build-bridge`,
	);
	const installerCopies = installerCopiedLibFiles(
		fs.readFileSync(path.join(REPO, "scripts", "meta-bridge-install.sh"), "utf8"),
	);
	const distClosure = hookImportClosure(DIST_HOOK)
		.map((rel) => path.basename(rel))
		.map((base) => (base === "session-id.js" ? base : base.replace(/\.(ts|js)$/, ".$LIB_EXT")))
		.sort();
	ok(
		"C1: the installer copies exactly the compiled hook's static `from` import closure [QK:BUNDLE-REACH-COMPILED-HOOK-CLOSURE]",
		distClosure.includes("entwurf-v2-lock.$LIB_EXT") && JSON.stringify(distClosure) === JSON.stringify(installerCopies),
		`--- compiled closure ---\n${distClosure.join("\n")}\n--- installer copies ---\n${installerCopies.join("\n")}`,
	);
	// Stage the compiled entry with ONLY that closure and run it the way Claude does: the shipped
	// manifest's exec argv through the shipped launcher, every meta root sandboxed, provenance never
	// inherited. A record on disk means the compiled closure loaded end to end.
	const PLUGIN_SRC = path.join(REPO, "pi", "meta-bridge", "entwurf-meta-receive");
	const leaf =
		(
			JSON.parse(fs.readFileSync(path.join(PLUGIN_SRC, "hooks", "hooks.json"), "utf8")) as {
				hooks: Record<string, Array<{ hooks: Array<{ command?: string; args?: string[] }> }>>;
			}
		).hooks.SessionStart?.[0]?.hooks[0] ?? {};
	const root = reclaimOnExit(fs.mkdtempSync(path.join(os.tmpdir(), "psa-bundle-reach-jshook-")));
	const agent = reclaimOnExit(fs.mkdtempSync(path.join(os.tmpdir(), "psa-bundle-reach-jsagent-")));
	stageMetaHookBundle(root, DIST_HOOK, path.join(PLUGIN_SRC, "scripts", "hook-launch.sh"));
	const el = (v: string) =>
		v
			.replace("__NODE_BIN__", process.execPath)
			.replaceAll("${CLAUDE_PLUGIN_ROOT}", root)
			.replace("__HOOK_ENTRY__", "meta-bridge-hook.js");
	// Hard Rule 12: the child's HOME and every writable XDG root are private too, not only the
	// meta roots — a hook that resolved anything through HOME/XDG must land inside `agent`.
	const priv = (name: string) => {
		const dir = path.join(agent, name);
		fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
		return dir;
	};
	const env: NodeJS.ProcessEnv = {
		...process.env,
		HOME: priv("home"),
		XDG_CONFIG_HOME: priv("xdg-config"),
		XDG_CACHE_HOME: priv("xdg-cache"),
		XDG_DATA_HOME: priv("xdg-data"),
		XDG_STATE_HOME: priv("xdg-state"),
		XDG_RUNTIME_DIR: priv("xdg-runtime"),
		CLAUDE_PLUGIN_ROOT: root,
		PI_CODING_AGENT_DIR: agent,
		ENTWURF_META_SESSIONS_DIR: path.join(agent, "meta-sessions"),
		ENTWURF_META_SENDERS_DIR: path.join(agent, "meta-senders"),
		ENTWURF_META_RECEIVERS_DIR: path.join(agent, "meta-receivers"),
		ENTWURF_META_MAILBOX_DIR: path.join(agent, "meta-mailbox"),
	};
	delete env.ENTWURF_META_HOOK_LAUNCH;
	const run = spawnSync(el(leaf.command ?? ""), (leaf.args ?? []).map(el), {
		encoding: "utf8",
		input: JSON.stringify({
			hook_event_name: "SessionStart",
			session_id: "c0c0c0c0-compiled-closure",
			transcript_path: path.join(agent, "c0c0c0c0.jsonl"),
			cwd: agent,
			source: "startup",
		}),
		env,
	});
	const sessions = path.join(agent, "meta-sessions");
	ok(
		"C2: the compiled hook, staged with only that closure, runs to a written record [QK:BUNDLE-REACH-COMPILED-HOOK-RUNS]",
		run.status === 0 && fs.existsSync(sessions) && fs.readdirSync(sessions).some((n) => n.endsWith(".meta.json")),
		`--- exit ${run.status} ---\n${run.stderr}`,
	);
}

// D — the COMPILED Claude Code retire adapter reaches its helper from where it lives (#147 G3).
// `ccRetireHelperPath()` resolves a fixed basename beside its own module, which is a tautology from
// source; only the emitted copy can say whether build-bridge.sh put the bytes next to it. Import and
// path only — nothing is spawned or signalled.
{
	const DIST_ADAPTER = path.join(BRIDGE_DIST, "pi-extensions", "lib", "cc-retire-request.js");
	const HELPER_SOURCE = path.join(REPO, "pi-extensions", "lib", "cc-retire-pidfd.py");
	ok(
		"D0: the compiled retire adapter exists (a missing dist is a failure, not a skip)",
		fs.existsSync(DIST_ADAPTER),
		`--- expected ---\n${DIST_ADAPTER}\nrun: pnpm run build-bridge`,
	);
	const adapter = await import(pathToFileURL(DIST_ADAPTER).href);
	const resolved: string | null = adapter.ccRetireHelperPath();
	ok(
		"D1: the compiled adapter resolves the helper beside itself, byte-identical to the canonical source [QK:BUNDLE-REACH-CC-RETIRE-HELPER]",
		resolved === path.join(path.dirname(DIST_ADAPTER), "cc-retire-pidfd.py") &&
			fs.readFileSync(resolved).equals(fs.readFileSync(HELPER_SOURCE)),
		`--- resolved ---\n${resolved}\n--- canonical ---\n${HELPER_SOURCE}`,
	);
}

// E — ask the actual emitted Pi request adapter, not its source-path test import.
// Pure parsing only: no socket, SDK lifecycle, model, or operator state is touched.
{
	const entry = path.join(BRIDGE_DIST, "pi-extensions", "lib", "pi-retire-request.js");
	ok("E0: the compiled Pi retire adapter exists (missing emission is not a skip)", fs.existsSync(entry));
	const adapter = await import(pathToFileURL(entry).href);
	const response = { type: "response", command: "retire", success: true, data: { boundary: "shutdown-requested" } };
	const accepted = adapter.parsePiRetireResponse(response);
	const rejected = adapter.parsePiRetireResponse({ ...response, command: "send" });
	ok(
		"E1: the shipped Pi adapter loads, accepts a requested reply, and rejects a foreign command as unknown [QK:BUNDLE-REACH-PI-RETIRE-ADAPTER]",
		accepted.boundary === "shutdown-requested" &&
			rejected.boundary === "unknown" &&
			rejected.reason === "malformed-response",
	);
}

// F — one guidance carrier/current-reader contract, rooted in canonical authored bytes (#154).
// Presence/type are preconditions. A stale carrier skips the reader import, so byte divergence
// fails the intended assertion rather than being hidden by parsing or an incidental import error.
{
	const carrier = path.join(BRIDGE_DIST, "ENTWURF.json");
	const reader = path.join(BRIDGE_DIST, "pi-extensions", "lib", "agent-guidance.js");
	for (const file of [carrier, reader]) {
		const stat = fs.lstatSync(file, { throwIfNoEntry: false });
		ok(
			`F0: the compiled guidance file is regular and non-symlink: ${rel(file)}`,
			stat !== undefined && stat.isFile() && !stat.isSymbolicLink(),
		);
	}
	const rootBytes = fs.readFileSync(path.join(REPO, "ENTWURF.json"));
	const root = JSON.parse(rootBytes.toString("utf8"));
	const sameBytes = fs.readFileSync(carrier).equals(rootBytes);
	const loaded = sameBytes ? await import(pathToFileURL(reader).href) : undefined;
	ok(
		"F1: the fixed guidance carrier has canonical Root bytes and its reader exports the current version/tools [QK:BUNDLE-REACH-GUIDANCE-CARRIER]",
		sameBytes &&
			isDeepStrictEqual(loaded?.ENTWURF_GUIDANCE_VERSION, {
				schemaVersion: root.schemaVersion,
				revision: root.revision,
			}) &&
			isDeepStrictEqual(loaded?.ENTWURF_TOOL_GUIDANCE, root.tools),
	);
}

console.log(`\ncheck-capability-bundle-reach: PASS (${passed} assertions)`);
