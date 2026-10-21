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

console.log(`\ncheck-capability-bundle-reach: PASS (${passed} assertions)`);
