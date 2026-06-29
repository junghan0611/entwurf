/**
 * check-package-source-routing — deterministic gate for #29 (package-installed
 * Entwurf ACP routing). No backend, no spawn, no API cost.
 *
 * Pins resolveExplicitExtensionSpec()'s package-source → install-root mapping and
 * the fail-fast routing contract, exercised through the two public routing
 * surfaces the spawn/resume paths actually call:
 *
 *   - getRegistryRouting(target, isRemote)            — spawn path
 *   - getEntwurfExplicitExtensions(model, isRemote, recordedProvider) — resume path
 *
 * The original bug: a `git:` / `npm:` Pi settings package source returned null,
 * so `provider=entwurf` spawned a `--no-extensions` child that died with
 * `Unknown provider "entwurf"`. This gate covers the install matrix:
 *
 *   local path / git user / npm user (+ version spec) / install-missing /
 *   project-scope (unseen → unresolved) / no-source, across local + remote,
 *   plus the self-root fallback property and the resume fail-fast signal.
 *
 * Self-root note: for LOCAL entwurf resolution the parent module's own path
 * is a valid bridge root, so local resolution always succeeds even when settings
 * has no source — that IS the desired "local always works" property. Fail-fast is
 * therefore asserted on the REMOTE path, where a local self-root cannot cross SSH.
 *
 * Env-isolation: PI_CODING_AGENT_DIR / PI_SETTINGS_PATH are set to temp paths
 * before the resolver is imported (directly or in the subprocess env-check), so
 * the module-level AGENT_DIR / PI_SETTINGS_PATH consts capture them. The real
 * ~/.pi/agent is never read or written; os.homedir() is only used to build the
 * EXPECTED remote path string (proving the local override does not leak remote).
 */

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import type { ResolvedTarget } from "../pi-extensions/lib/entwurf-core.ts";

// --- Isolated agent dir (must be set BEFORE importing entwurf-core) ----------
const tmpAgent = fs.mkdtempSync(path.join(os.tmpdir(), "psa-route-"));
process.env.PI_CODING_AGENT_DIR = tmpAgent;
delete process.env.ENTWURF_ACP_FOR_CODEX; // control wantsCodexBridge per-case

// Dynamic import so the resolver's AGENT_DIR / PI_SETTINGS_PATH consts capture
// the env above. A static import would evaluate them against the real ~/.pi.
const core = await import("../pi-extensions/lib/entwurf-core.ts");
const { getRegistryRouting, getEntwurfExplicitExtensions, EntwurfRoutingError } = core;

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SETTINGS_PATH = path.join(tmpAgent, "settings.json");
const REMOTE_AGENT = path.posix.join(os.homedir(), ".pi", "agent");

let passed = 0;
function check(label: string, fn: () => void): void {
	fn();
	passed += 1;
	console.log(`[check-package-source-routing] ${label}: ok`);
}

// --- Fixture helpers ---------------------------------------------------------
function setSource(source: string | null): void {
	const packages = source ? [source] : [];
	fs.writeFileSync(SETTINGS_PATH, JSON.stringify({ packages }, null, 2));
}

function makeInstallDir(...segs: string[]): string {
	const dir = path.join(tmpAgent, ...segs);
	fs.mkdirSync(dir, { recursive: true });
	return dir;
}

function rmInstall(...segs: string[]): void {
	fs.rmSync(path.join(tmpAgent, ...segs), { recursive: true, force: true });
}

const ACP: ResolvedTarget = { provider: "entwurf", model: "claude-sonnet-4-6", explicitOnly: false };
const eArg = (r: { args: string[] }): string | undefined => {
	const i = r.args.indexOf("-e");
	return i >= 0 ? r.args[i + 1] : undefined;
};

// =============================================================================
// LOCAL spawn (getRegistryRouting, isRemote=false)
// =============================================================================

// 1. Local path package source resolves to <agentDir>/<source>.
check("local-path source resolves to agentDir-relative root", () => {
	const root = makeInstallDir("local-pkgs", "entwurf");
	setSource("local-pkgs/entwurf");
	const r = getRegistryRouting(ACP, false);
	assert.equal(r.provider, "entwurf");
	assert.equal(eArg(r), root);
});

// 2. git: user source → <agentDir>/git/<host>/<path>.
check("git: source resolves to agentDir/git/<host>/<path>", () => {
	const root = makeInstallDir("git", "github.com", "junghan0611", "entwurf");
	setSource("git:github.com/junghan0611/entwurf");
	const r = getRegistryRouting(ACP, false);
	assert.equal(eArg(r), root);
});

// 3. npm: user source → <agentDir>/npm/node_modules/<name>.
check("npm: source resolves to agentDir/npm/node_modules/<name>", () => {
	const root = makeInstallDir("npm", "node_modules", "@junghanacs", "entwurf");
	setSource("npm:@junghanacs/entwurf");
	const r = getRegistryRouting(ACP, false);
	assert.equal(eArg(r), root);
});

// 4. npm: source WITH a version spec — root keys on the bare name, version stripped.
check("npm: source with @version strips the version from the install root", () => {
	const root = makeInstallDir("npm", "node_modules", "@junghanacs", "entwurf");
	setSource("npm:@junghanacs/entwurf@0.8.0");
	const r = getRegistryRouting(ACP, false);
	assert.equal(eArg(r), root);
});

// 5. Self-root fallback — settings source absent, but LOCAL resolution still
//    succeeds via the loaded module's own root (the "local always works" property).
check("local self-root fallback resolves when settings has no source", () => {
	rmInstall("git");
	rmInstall("npm");
	rmInstall("local-pkgs");
	setSource(null);
	const r = getRegistryRouting(ACP, false);
	assert.equal(eArg(r), REPO_ROOT, "self-root should be the entwurf-core package root");
});

// 6. Native provider passes through untouched — no bridge, no throw.
check("native provider target passes through with no -e and no throw", () => {
	setSource(null);
	const r = getRegistryRouting({ provider: "openai-codex", model: "gpt-5.4", explicitOnly: false }, false);
	assert.equal(r.provider, "openai-codex");
	assert.equal(eArg(r), undefined);
});

// =============================================================================
// REMOTE spawn (getRegistryRouting, isRemote=true) — self-root excluded
// =============================================================================

// 7. git: remote → remotePath uses the plain ~/.pi/agent layout, NOT the local
//    PI_CODING_AGENT_DIR override (no local-env leak into the SSH path).
check("git: remote resolves to ~/.pi/agent/git/... (no local-env leak)", () => {
	makeInstallDir("git", "github.com", "junghan0611", "entwurf"); // local mirror gates existence
	setSource("git:github.com/junghan0611/entwurf");
	const r = getRegistryRouting(ACP, true);
	assert.equal(eArg(r), path.posix.join(REMOTE_AGENT, "git", "github.com", "junghan0611", "entwurf"));
});

// 8. npm: remote with version → ~/.pi/agent/npm/node_modules/<name>.
check("npm: remote with @version resolves to ~/.pi/agent/npm/node_modules/<name>", () => {
	makeInstallDir("npm", "node_modules", "@junghanacs", "entwurf");
	setSource("npm:@junghanacs/entwurf@0.8.0");
	const r = getRegistryRouting(ACP, true);
	assert.equal(eArg(r), path.posix.join(REMOTE_AGENT, "npm", "node_modules", "@junghanacs", "entwurf"));
});

// 9. Install dir missing, remote → fail-fast (EntwurfRoutingError), NOT warn-and-spawn.
check("remote git: with missing install dir throws EntwurfRoutingError", () => {
	rmInstall("git");
	setSource("git:github.com/junghan0611/entwurf");
	assert.throws(() => getRegistryRouting(ACP, true), EntwurfRoutingError);
});

// 10. No source in settings, remote → fail-fast.
check("remote with no settings source throws EntwurfRoutingError", () => {
	setSource(null);
	assert.throws(() => getRegistryRouting(ACP, true), EntwurfRoutingError);
});

// 10b. PI_SETTINGS_PATH override must be honored independently from
//      PI_CODING_AGENT_DIR/settings.json. This is run in a subprocess because
//      entwurf-core captures the env at module import time.
check("PI_SETTINGS_PATH env override is honored", () => {
	const agent = fs.mkdtempSync(path.join(os.tmpdir(), "psa-route-settings-"));
	try {
		const root = path.join(agent, "git", "github.com", "junghan0611", "entwurf");
		fs.mkdirSync(root, { recursive: true });
		const settingsPath = path.join(agent, "custom-settings.json");
		fs.writeFileSync(settingsPath, JSON.stringify({ packages: ["git:github.com/junghan0611/entwurf"] }));
		const out = execFileSync(
			process.execPath,
			["--experimental-strip-types", path.join(REPO_ROOT, "scripts", "resolve-acp-bridge.ts"), "remote"],
			{
				env: { ...process.env, PI_CODING_AGENT_DIR: agent, PI_SETTINGS_PATH: settingsPath },
				encoding: "utf8",
			},
		);
		assert.equal(out, path.posix.join(REMOTE_AGENT, "git", "github.com", "junghan0611", "entwurf"));
	} finally {
		fs.rmSync(agent, { recursive: true, force: true });
	}
});

// 11. Project-scope (-l) sources live in cwd/.pi, never user settings.json, so the
//     resolver never sees them — they resolve to nothing and fail-fast on remote
//     rather than silently emitting Unknown provider.
check("project-scope source (unseen in user settings) fails fast on remote", () => {
	// A project install would record under ./.pi; user settings stays empty.
	setSource(null);
	assert.throws(() => getRegistryRouting(ACP, true), EntwurfRoutingError);
});

// =============================================================================
// RESUME path (getEntwurfExplicitExtensions) — unresolvedAcpIntent signal
// =============================================================================

// 12. recorded provider=entwurf + remote + no source → unresolvedAcpIntent
//     (resume callers fail-fast; no -e injected).
check("resume recorded entwurf + remote + no source → unresolvedAcpIntent", () => {
	setSource(null);
	const r = getEntwurfExplicitExtensions("claude-sonnet-4-6", true, "entwurf");
	assert.equal(r.unresolvedAcpIntent, true);
	assert.equal(eArg(r), undefined);
	assert.ok(r.warnings.length > 0, "should warn about the unresolved bridge");
});

// 13. recorded provider=entwurf + LOCAL → self-root resolves, no fail-fast.
check("resume recorded entwurf + local resolves via self-root", () => {
	setSource(null);
	const r = getEntwurfExplicitExtensions("claude-sonnet-4-6", false, "entwurf");
	assert.ok(!r.unresolvedAcpIntent, "local self-root should resolve");
	assert.equal(eArg(r), REPO_ROOT);
	assert.equal(r.provider, "entwurf");
});

// 14. opt-in Codex-via-ACP + remote + no source → unresolvedAcpIntent (fail-fast).
check("resume Codex-via-ACP opt-in + remote + no source → unresolvedAcpIntent", () => {
	setSource(null);
	process.env.ENTWURF_ACP_FOR_CODEX = "1";
	try {
		const r = getEntwurfExplicitExtensions("gpt-5.4", true, undefined);
		assert.equal(r.unresolvedAcpIntent, true);
	} finally {
		delete process.env.ENTWURF_ACP_FOR_CODEX;
	}
});

// 15. Claude-only heuristic (no recorded ACP signal) stays warning-only — NOT
//     fail-fast — because the legacy pi-claude-code-use bridge may exist.
check("resume Claude-only heuristic + remote + no source stays warning-only", () => {
	setSource(null);
	const r = getEntwurfExplicitExtensions("claude-sonnet-4-6", true, undefined);
	assert.ok(!r.unresolvedAcpIntent, "Claude heuristic must not fail-fast");
	assert.ok(r.warnings.length > 0, "should warn");
	assert.equal(eArg(r), undefined);
});

// --- Cleanup + summary -------------------------------------------------------
fs.rmSync(tmpAgent, { recursive: true, force: true });
console.log(`[check-package-source-routing] ${passed} assertions ok`);
