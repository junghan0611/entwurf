// ACP plugin — Claude config overlay materializer (S2b).
//
// claude-agent-acp's SettingsManager loads the operator's `~/.claude/settings.json`
// DIRECTLY (CLAUDE_CONFIG_DIR is the only knob that redirects that read). So the
// operator's native `permissions.defaultMode` (whatever its current value), hooks,
// plugins, and per-cwd memory/projects state would otherwise leak into entwurf ACP
// sessions. The overlay redirects SettingsManager at a pi-owned directory whose
// `settings.json` WE author (minimal, `hooks:{}`), while keeping exactly the
// operator entries a backend needs (credentials, caches, built-in skills)
// reachable through a TIGHT symlink whitelist — nothing else.
//
// Scope (NEXT §스코프 / §S2-scout 핀3): the block above describes the CLAUDE
// overlay — `ensureClaudeConfigOverlay` and its symlink whitelist are written for
// claude-agent-acp's config surface alone. A second backend brings its OWN
// materializer, and cortex did: `ensureCortexDualHomeOverlay` (+ projectCortexMcpJson /
// sweepDeadCortexOverlays / cortexOverlayScopeId) lives further down this file with its
// own D-number rationale — an isolated HOME rather than a redirect knob, because cortex
// has no CLAUDE_CONFIG_DIR equivalent (ACP rail Cortex audit D2). The two share the module, never the
// strategy. Codex/Gemini overlays (CODEX_HOME / admin.toml) remain behavior-oracle
// territory and are out of scope here.
//
// Two deliberate divergences from the literal 0.11.0 illustrative comment block
// (the 0.11.0 CODE already does both — only its top doc-comment drew projects/
// as a symlink): `projects/` and `sessions/` are overlay-PRIVATE empty dirs, not
// symlinks, so the operator's real ~/.claude/{projects,sessions} is never read
// or written from an ACP session (this also closes the per-cwd MEMORY.md
// auto-load leak: the binary finds an empty tree and injects nothing).
//
// `hooks:{}` is load-bearing, not cosmetic: the Claude SDK distinguishes an
// ABSENT hooks key from a configured-but-empty map during organic compaction
// (the absent shape made a compacting turn emit a meta summary instead of
// answering — 0.11.0 LIVE probe). Keeping it `{}` inherits NO operator hook —
// which is exactly the "mailbox absence by design" the plugin commits to
// (no meta-bridge hook on this child's settings surface → no mailbox).

import { createHash } from "node:crypto";
import {
	existsSync,
	lstatSync,
	mkdirSync,
	readdirSync,
	readlinkSync,
	rmSync,
	symlinkSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, win32 } from "node:path";

import type { AcpMcpServer } from "./config.js";

/** Operator's real Claude config dir — the symlink-passthrough SOURCE. */
export const CLAUDE_REAL_CONFIG_DIR = join(homedir(), ".claude");

/** pi-owned overlay dir — the CLAUDE_CONFIG_DIR target for ACP child spawns. */
export const CLAUDE_CONFIG_OVERLAY_DIR = join(homedir(), ".pi", "agent", "claude-config-overlay");

/**
 * Operator `~/.claude/` entries exposed to the ACP child via symlink. Anything
 * NOT here is intentionally hidden: CLAUDE.md, hooks, agents, plugins,
 * settings.local.json (personal env / PAT), sessions/projects data, command
 * history, todos — none leak into the model context, hook surface, or env.
 *
 * Limited to: backend auth (`.credentials.json`); the binary's runtime caches +
 * telemetry (cache, debug, session-env, stats-cache.json, statsig, telemetry);
 * the bridge's own scratch surface (shell-snapshots); and built-in
 * (non-operator-defined) skill content (skills). `plugins` is deliberately out —
 * plugin enablement is operator-personal; the plugin set is injected per-session
 * via `_meta.claudeCode.options.plugins`, not filesystem inheritance.
 */
export const OVERLAY_PASSTHROUGH: ReadonlySet<string> = new Set([
	".credentials.json",
	"cache",
	"debug",
	"session-env",
	"shell-snapshots",
	"skills",
	"stats-cache.json",
	"statsig",
	"telemetry",
]);

/**
 * Directories owned by the overlay itself (empty trees). The binary
 * auto-creates and writes per-cwd state under these; an empty overlay-scoped
 * tree keeps operator data at ~/.claude/{projects,sessions} unread/unwritten.
 * Memory containment is NOT provided by this directory shape alone: if the
 * backend preset advertises project memory, Claude can still write overlay-local
 * projects/<cwd>/memory files. The engraving carrier's tiny non-empty preset
 * replacement strips that advertisement; the empty tree is read-isolation and
 * defense-in-depth, not the primary write-containment lever.
 */
export const OVERLAY_EMPTY_DIRS: ReadonlySet<string> = new Set(["projects", "sessions"]);

/**
 * Entries the binary creates INSIDE whatever CLAUDE_CONFIG_DIR it is pointed at
 * (feature cache, `.claude.json` backups). They have no operator-side
 * counterpart, so the cleanup pass preserves real files/dirs here but tears down
 * any STALE symlink (a migration artifact from earlier overlay code that linked
 * every entry). `settings.json` is overlay-authored but listed for symmetry so
 * the cleanup loop never nukes it.
 */
export const OVERLAY_BINARY_OWNED: ReadonlySet<string> = new Set([".claude.json", "backups", "settings.json"]);

/**
 * Minimal overlay settings.json. Only fields with a reason to pin:
 *   - `permissions.defaultMode: "bypassPermissions"` is deliberate unattended
 *     ACP operation: a tool call must never suspend a model turn on an interactive
 *     permission prompt. This does not widen the callable surface — explicit
 *     `tools`/`disallowedTools` still shape it, and `permissionAllow` still rides
 *     the inline Claude settings — or bypass backend authentication.
 *   - `autoMemoryEnabled: false` — SDK opt-out for auto-memory (defense in
 *     depth; the tiny non-empty engraving/preset replacement is the primary
 *     write-containment lever for Claude ACP).
 *   - `hooks: {}` — configured-but-empty (NOT absent): inherits no operator
 *     hook (mailbox absence by design) while keeping the compaction turn honest.
 */
export function overlaySettingsJson(): string {
	return `${JSON.stringify(
		{
			permissions: { defaultMode: "bypassPermissions" },
			autoMemoryEnabled: false,
			hooks: {},
		},
		null,
		2,
	)}\n`;
}

/**
 * The launch-env override an ACP child spawn must carry to redirect
 * SettingsManager at the overlay. Pure — merge into the child's `env`.
 */
export function claudeLaunchEnvDefaults(overlayDir: string = CLAUDE_CONFIG_OVERLAY_DIR): { CLAUDE_CONFIG_DIR: string } {
	return { CLAUDE_CONFIG_DIR: overlayDir };
}

/**
 * Materialize / refresh the Claude config overlay. Idempotent: keeps correct
 * symlinks, replaces wrong ones, removes stale entries cleanly. Safe to call on
 * every ACP session bootstrap.
 */
export function ensureClaudeConfigOverlay(
	realDir: string = CLAUDE_REAL_CONFIG_DIR,
	overlayDir: string = CLAUDE_CONFIG_OVERLAY_DIR,
): void {
	mkdirSync(overlayDir, { recursive: true });

	// settings.json — always (cheap unconditional rewrite keeps the override in
	// place even if a prior process or operator edited it).
	writeFileSync(join(overlayDir, "settings.json"), overlaySettingsJson(), "utf8");

	// Empty dirs — overlay-owned; replace any prior symlink with a real dir.
	for (const entry of OVERLAY_EMPTY_DIRS) {
		const overlayPath = join(overlayDir, entry);
		try {
			const existing = lstatSync(overlayPath);
			if (existing.isSymbolicLink() || !existing.isDirectory()) {
				rmSync(overlayPath, { recursive: true, force: true });
				mkdirSync(overlayPath, { recursive: true });
			}
		} catch {
			mkdirSync(overlayPath, { recursive: true });
		}
	}

	// Symlink passthrough — only whitelisted entries that exist in realDir.
	if (existsSync(realDir)) {
		for (const entry of OVERLAY_PASSTHROUGH) {
			const realPath = join(realDir, entry);
			const overlayPath = join(overlayDir, entry);

			if (!existsSync(realPath)) {
				// Not present operator-side — remove any stale overlay copy.
				try {
					lstatSync(overlayPath);
					rmSync(overlayPath, { recursive: true, force: true });
				} catch {
					// Doesn't exist — fine.
				}
				continue;
			}

			try {
				const existing = lstatSync(overlayPath);
				if (existing.isSymbolicLink()) {
					if (readlinkSync(overlayPath) === realPath) continue;
					unlinkSync(overlayPath);
				} else {
					rmSync(overlayPath, { recursive: true, force: true });
				}
			} catch {
				// Doesn't exist — fall through to symlink.
			}

			try {
				symlinkSync(realPath, overlayPath);
			} catch (error) {
				console.error(
					`[entwurf:claude-overlay] symlink failed for ${entry}: ${error instanceof Error ? error.message : String(error)}`,
				);
			}
		}
	}

	// Stale cleanup — remove anything off the current allowlist. Binary-owned
	// entries are preserved when real (binary authored them inside the overlay)
	// but torn down when a stale symlink points at operator data.
	for (const entry of readdirSync(overlayDir)) {
		if (OVERLAY_PASSTHROUGH.has(entry)) continue;
		if (OVERLAY_EMPTY_DIRS.has(entry)) continue;
		const overlayPath = join(overlayDir, entry);

		if (OVERLAY_BINARY_OWNED.has(entry)) {
			try {
				const stat = lstatSync(overlayPath);
				if (stat.isSymbolicLink()) rmSync(overlayPath, { force: true });
			} catch {
				// Doesn't exist — fine; binary creates it on first launch.
			}
			continue;
		}

		try {
			rmSync(overlayPath, { recursive: true, force: true });
		} catch {
			// Best-effort; a stuck stale entry is annoying but not fatal.
		}
	}
}

// ============================================================================
// Cortex dual-HOME overlay — the as-measured containment for `cortex acp serve`
// (CP0 audit 2026-07-29, Cortex Code v1.1.52; docs/acp-backend-rail.md “Cortex Code audit”).
// ============================================================================
//
// Why this is NOT the claude-shaped `SNOWFLAKE_HOME`-only overlay PR #40 shipped
// (each point is a measured defect, not a preference — Cortex audit D-numbers):
//
//   - D2: cortex reads `CONFIG_DIRS = [".claude", ".cortex"]` at `homedir()` and
//     `~/.claude/skills` — a SNOWFLAKE_HOME redirect cannot move that axis. An
//     overlay session carrying only auth symlinks still advertised the
//     operator's 42 `~/.claude/skills` entries. Cortex has no
//     `CLAUDE_CONFIG_DIR`-equivalent redirect knob (string occurs 0 times in the
//     binary), so the only containment that closes the leak is an ISOLATED HOME:
//     measured global-scope skill count 0, hook trace 0, bundled/project surface
//     intact. Scope note: `homedir()`-anchored *operator-global* state is what
//     the isolation closes; explicit cwd PROJECT scope (`<cwd>/.claude/*`) is
//     retained by contract — a sibling working in a repo sees that repo's
//     declared project surface.
//   - D3: `CORTEX_HOME` beats `SNOWFLAKE_HOME` in cortex's own resolver, so one
//     ambient operator variable would silently bypass the whole overlay. The
//     adapter REFUSES to spawn when `CORTEX_HOME` is present at all (empty
//     string included) — same presence-refusal family as the ordering probe's
//     `CLAUDE_CODE_EXECUTABLE` precondition (backend-adapter.ts).
//   - D9: cortex ACP `newSession` reads only `cwd` and `_meta` — the wire
//     `mcpServers` param the backend-invariant turn loop passes is IGNORED. The
//     explicit `entwurfProvider.mcpServers` (envelope-enriched) are therefore
//     PROJECTED into the overlay-private `$SNOWFLAKE_HOME/cortex/mcp.json` (the
//     door `cortex mcp add` writes). Exact-author every spawn; an entry type the
//     file cannot represent fails loud BEFORE spawn (no silent drop).
//   - D10: an isolated HOME also cuts `~/.pi/agent` (garden store, sockets,
//     spawn surface) off the bundled entwurf-bridge — tools reach the model but
//     see an EMPTY garden. Dual-HOME closes it: the `entwurf-bridge` mcp.json
//     entry ALONE gets `HOME=<real operator home>` restored; every other MCP
//     child stays in the isolated home. The real home is captured by the parent
//     as an absolute path BEFORE spawn — never re-derived inside the child.
//   - D4: cortex self-updates on launch by default, and `acp serve` accepts no
//     `--no-auto-update` (the global flag position boots a TUI with exit 0 —
//     protocol corruption, not a server). The one remaining door is the overlay
//     writing `"autoUpdate": false` into its own `cortex/settings.json`. That is
//     a mid-turn self-replacement OFF switch, not a version pin.
//   - D5/F: auth passthrough is the measured MINIMUM: `connections.toml`,
//     `config.toml` (optional — absent on the measured host),
//     `cortex/cache/credential_cache` (auth succeeded with exactly this set).
//     The WHOLE `cortex/cache` leaks operator tool_outputs/tip history; operator
//     `cortex/skills` and operator `cortex/mcp.json` are denied outright.
//     Symlink-through only — entwurf never copies/parses/mediates the Snowflake
//     credential (AGENTS §ACP Plugin Boundary, Hard Rule 9).
//
// The overlay is SESSION/CHILD-SCOPED, never a static shared dir: two residents
// with different envelopes/configs would race one mcp.json. Scope id =
// `<host pid>-<sha256(scopeKey) 12 hex>`; the scope dir is torn down and
// exact-rewritten on every spawn (the prior child for the key is already dead —
// backend.ts tears it down before a "new" decision spawns), which is also the
// memory containment: nothing cortex wrote into the isolated home survives into
// the next session. Scope dirs whose host pid is gone are swept opportunistically.

/** Root under which per-session cortex dual-HOME overlays are materialized. */
export const CORTEX_OVERLAYS_ROOT = join(homedir(), ".pi", "agent", "cortex-overlays");

/** The name of the ONE mcp.json entry whose child gets the real operator HOME
 *  restored (D10 dual-HOME). Everything else stays in the isolated home. */
export const CORTEX_DUAL_HOME_BRIDGE_SERVER = "entwurf-bridge";

export interface CortexOverlayParams {
	/** Session/child scope discriminator (PI_SESSION_ID, else a cwd-derived key).
	 *  Identity for overlay-dir separation only — never an address authority. */
	scopeKey: string;
	/** Normalized + envelope-enriched MCP servers to project into mcp.json. */
	mcpServers: readonly AcpMcpServer[];
	/** Absolute real operator HOME captured by the parent BEFORE spawn (D10). */
	realHome: string;
	/** Real snowflake home (auth source). Defaults to `<realHome>/.snowflake`. */
	realSnowflakeHome?: string;
	/** Overlay root override (tests). Defaults to CORTEX_OVERLAYS_ROOT. */
	overlaysRoot?: string;
	/** pid-liveness probe override (tests) for the dead-scope sweep. */
	isPidAlive?: (pid: number) => boolean;
}

export interface CortexOverlayResult {
	/** Isolated HOME for the cortex child (spawn env HOME). */
	home: string;
	/** Isolated snowflake home (spawn env SNOWFLAKE_HOME) = `<home>/.snowflake`. */
	snowflakeHome: string;
	/** The scope dir owning both (for diagnostics/teardown). */
	scopeDir: string;
}

/** Deterministic per-(host process, session key) overlay dir name. */
export function cortexOverlayScopeId(scopeKey: string, pid: number = process.pid): string {
	const digest = createHash("sha256").update(scopeKey).digest("hex").slice(0, 12);
	return `${pid}-${digest}`;
}

/** Overlay-authored `$SNOWFLAKE_HOME/cortex/settings.json` — D4's one door. */
export function cortexOverlaySettingsJson(): string {
	return `${JSON.stringify({ autoUpdate: false }, null, "\t")}\n`;
}

/**
 * Project the (envelope-enriched) explicit server list into cortex's
 * `$SNOWFLAKE_HOME/cortex/mcp.json` shape (D9). Only stdio entries are measured
 * through this door — an http/sse entry fails loud BEFORE spawn rather than
 * being silently dropped. The `entwurf-bridge` entry alone carries
 * `HOME=<realHome>` (D10); a bridge-declared HOME env is overridden, not merged.
 */
export function projectCortexMcpJson(servers: readonly AcpMcpServer[], realHome: string): string {
	const out: Record<string, { type: "stdio"; command: string; args: string[]; env: Record<string, string> }> = {};
	for (const server of servers) {
		if ("type" in server && (server.type === "http" || server.type === "sse")) {
			throw new Error(
				`entwurf: cortex mcp.json projection cannot represent ${server.type} server ` +
					`${JSON.stringify(server.name)} — only stdio entries are measured through ` +
					`$SNOWFLAKE_HOME/cortex/mcp.json (CP0 D9). Remove it from entwurfProvider.mcpServers ` +
					`for cortex models or front it with a stdio bridge.`,
			);
		}
		const stdio = server as { name: string; command: string; args: string[]; env: { name: string; value: string }[] };
		const env: Record<string, string> = {};
		for (const kv of stdio.env) env[kv.name] = kv.value;
		if (stdio.name === CORTEX_DUAL_HOME_BRIDGE_SERVER) env.HOME = realHome;
		out[stdio.name] = { type: "stdio", command: stdio.command, args: [...stdio.args], env };
	}
	return `${JSON.stringify({ mcpServers: out }, null, "\t")}\n`;
}

function cortexPidAlive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		// EPERM = alive but not ours; anything else (ESRCH) = gone.
		return (error as NodeJS.ErrnoException).code === "EPERM";
	}
}

/**
 * Opportunistic GC of overlay scope dirs whose HOST pid is gone (process
 * resources only — the overlay holds no records/transcripts worth preserving;
 * conversations state is contained BY DESIGN, Hard Rule 8 does not apply to it).
 * Entries not matching the scope-id grammar are left alone.
 */
export function sweepDeadCortexOverlays(
	overlaysRoot: string,
	isPidAlive: (pid: number) => boolean = cortexPidAlive,
): void {
	let entries: string[];
	try {
		entries = readdirSync(overlaysRoot);
	} catch {
		return; // root absent — nothing to sweep
	}
	for (const entry of entries) {
		const match = /^(\d+)-[0-9a-f]{12}$/.exec(entry);
		if (!match) continue;
		const pid = Number(match[1]);
		if (pid === process.pid) continue;
		if (isPidAlive(pid)) continue;
		try {
			rmSync(join(overlaysRoot, entry), { recursive: true, force: true });
		} catch {
			// Best-effort GC; a stuck dir is retried on the next spawn.
		}
	}
}

/** Symlink `realPath` at `overlayPath` when the operator actually has it.
 *  The scope dir is freshly rebuilt by the caller, so no stale-link repair. */
function cortexLinkIfExists(realPath: string, overlayPath: string): void {
	if (!existsSync(realPath)) return;
	try {
		symlinkSync(realPath, overlayPath);
	} catch (error) {
		console.error(
			`[entwurf:cortex-overlay] symlink failed for ${overlayPath}: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
}

/**
 * Materialize the session-scoped cortex dual-HOME overlay: tear down the scope
 * dir and exact-rewrite it (auth symlinks + authored settings.json/mcp.json).
 * Returns the isolated HOME/SNOWFLAKE_HOME the spawn env must carry.
 */
export function ensureCortexDualHomeOverlay(params: CortexOverlayParams): CortexOverlayResult {
	// Absoluteness is judged in BOTH path flavors so the guard states the contract
	// ("the parent captured an absolute HOME") instead of the host it happens to run
	// on. This asserts nothing about native-Windows support; it only stops a POSIX
	// host from silently accepting a drive/UNC path as "relative".
	if (!params.realHome || !(isAbsolute(params.realHome) || win32.isAbsolute(params.realHome))) {
		throw new Error(
			`entwurf: cortex dual-HOME overlay requires an absolute realHome captured by the parent (got ${JSON.stringify(params.realHome)})`,
		);
	}
	const overlaysRoot = params.overlaysRoot ?? CORTEX_OVERLAYS_ROOT;
	const realSnowflake = params.realSnowflakeHome ?? join(params.realHome, ".snowflake");
	sweepDeadCortexOverlays(overlaysRoot, params.isPidAlive ?? cortexPidAlive);

	const scopeDir = join(overlaysRoot, cortexOverlayScopeId(params.scopeKey));
	// Exact rewrite (never merge): the prior child for this scope key is already
	// torn down (backend.ts closes it before a "new" decision spawns), so
	// everything it wrote — conversations, logs, $HOME dotfiles — is discarded
	// here. rmSync does not follow symlinks, so the real auth files are untouched.
	rmSync(scopeDir, { recursive: true, force: true });

	const home = join(scopeDir, "home");
	const snowflakeHome = join(home, ".snowflake");
	const cortexDir = join(snowflakeHome, "cortex");
	mkdirSync(join(cortexDir, "cache"), { recursive: true });

	// D5/F — measured-minimum auth passthrough (symlink-through only).
	cortexLinkIfExists(join(realSnowflake, "connections.toml"), join(snowflakeHome, "connections.toml"));
	cortexLinkIfExists(join(realSnowflake, "config.toml"), join(snowflakeHome, "config.toml"));
	cortexLinkIfExists(
		join(realSnowflake, "cortex", "cache", "credential_cache"),
		join(cortexDir, "cache", "credential_cache"),
	);

	// D4 — runtime self-replacement off; D9 — explicit-server projection.
	writeFileSync(join(cortexDir, "settings.json"), cortexOverlaySettingsJson(), "utf8");
	writeFileSync(join(cortexDir, "mcp.json"), projectCortexMcpJson(params.mcpServers, params.realHome), "utf8");

	return { home, snowflakeHome, scopeDir };
}

// ============================================================================
// Antigravity gemini-dir overlay — the as-measured containment for `agy acp` (#167)
// ============================================================================
//
// `agy acp` takes its whole state root as an ARGUMENT, not an env knob: `--gemini-dir <absolute>`
// moves config/, brain/, conversations/, logs, skills, MCP config and hooks together.
// `[측정 2026-11-16]` agy 1.5.9: pointed at an empty absolute directory it created that tree itself
// and answered `session/new` with `-32000 Authentication required`; with ONE operator file linked
// in — `antigravity-cli/antigravity-oauth-token` — the same call succeeded on the operator's
// subscription tier. Nothing else crosses from the operator's agy state: its skills link, MCP
// config, hooks, brain and conversation history stay unread and unwritten. The one other thing
// linked in is what the operator NAMED in entwurf's own settings — the skills of the global
// `entwurfProvider.skillPlugins` (see `resolveAgySkillLinks`).
//
// The link policy is the Claude overlay's: re-established on every bootstrap; a correct symlink is
// kept, anything else at that path — a wrong link, or a regular file a vendor rename left behind —
// is replaced by the link. Whether agy's token refresh writes through the link or renames over it is
// NOT measured; the replacement is what keeps a renamed copy from outliving the next bootstrap.

/** Operator's real agy state root — the symlink-passthrough SOURCE. */
export const AGY_REAL_GEMINI_DIR = join(homedir(), ".gemini");

/** pi-owned overlay dir — the `--gemini-dir` target for agy ACP child spawns. */
export const AGY_GEMINI_OVERLAY_DIR = join(homedir(), ".pi", "agent", "agy-gemini-overlay");

/** agy's own subdirectory under the gemini dir (its `--app-data-dir` default). */
export const AGY_APP_DATA_DIRNAME = "antigravity-cli";

/** The one entry of the operator's agy state exposed to the agy ACP child, relative to the
 *  app-data dir. Skill links are a separate seat with a separate source (the operator's setting). */
export const AGY_OVERLAY_PASSTHROUGH: ReadonlySet<string> = new Set(["antigravity-oauth-token"]);

/** The named refusal for an overlay path that is not a real directory of its own. */
export const ACP_AGY_OVERLAY_NOT_A_DIRECTORY = "acp-agy-overlay-not-a-directory";

/** Where agy discovers global skills under the gemini dir: `config/skills/<name>/SKILL.md`. */
export const AGY_CONFIG_DIRNAME = "config";
export const AGY_SKILLS_DIRNAME = "skills";

/** The named refusal for a skill name the overlay cannot give exactly one source. */
export const ACP_AGY_SKILL_NAME_COLLISION = "acp-agy-skill-name-collision";

/**
 * The skill links one bootstrap owes the overlay: name → source directory, for every
 * `<plugin>/skills/<name>` that holds a `SKILL.md`, over the operator-named plugin directories and
 * nothing else. `[측정 2026-11-16]` agy 1.5.9 lists a skill whose directory — or a symlink to it —
 * sits at `<gemini-dir>/config/skills/<name>`, under the flags this adapter launches with. Two
 * plugins offering one name refuse: agy would list one of them and nothing says which.
 */
export function resolveAgySkillLinks(skillPlugins: readonly string[]): Map<string, string> {
	const links = new Map<string, string>();
	for (const plugin of skillPlugins) {
		const skillsDir = join(plugin, AGY_SKILLS_DIRNAME);
		if (!existsSync(skillsDir)) continue;
		for (const name of readdirSync(skillsDir).sort()) {
			const source = join(skillsDir, name);
			if (!existsSync(join(source, "SKILL.md"))) continue;
			const taken = links.get(name);
			if (taken !== undefined) {
				throw new Error(
					`entwurf: ${ACP_AGY_SKILL_NAME_COLLISION} — the skill ${JSON.stringify(name)} is offered by both ${taken} and ${source}. ` +
						`The agy ACP overlay links one directory per skill name; nothing was linked or removed. Rename or remove one of them.`,
				);
			}
			links.set(name, source);
		}
	}
	return links;
}

function isSymlink(path: string): boolean {
	try {
		return lstatSync(path).isSymbolicLink();
	} catch {
		return false;
	}
}

/**
 * Refuse an overlay path that exists as anything but a real directory. A symlink there would make
 * every write below land in whatever it points at: with the overlay (or its app-data dir) linked to
 * the operator's own state, the passthrough step would delete the operator's token and link it to
 * itself, and the sweep would delete the operator's own symlinks. Absent is fine — it is created.
 */
function assertAgyOverlayDirectory(path: string): void {
	let stat: ReturnType<typeof lstatSync>;
	try {
		stat = lstatSync(path);
	} catch (err) {
		if ((err as NodeJS.ErrnoException).code === "ENOENT") return;
		throw err;
	}
	if (stat.isSymbolicLink() || !stat.isDirectory()) {
		throw new Error(
			`entwurf: ${ACP_AGY_OVERLAY_NOT_A_DIRECTORY} — ${path} is ${stat.isSymbolicLink() ? "a symlink" : "not a directory"}. ` +
				`The agy ACP overlay must be a directory of its own; nothing was linked or removed. Remove that entry and start the turn again.`,
		);
	}
}

/**
 * Materialize / refresh the agy gemini-dir overlay. Idempotent; safe on every ACP bootstrap, and
 * safe for two agy children that share it (both bootstraps converge on the same link).
 *
 * Order: the two overlay directories are proven real directories BEFORE anything is created, linked
 * or removed; then any symlink directly under them that is not the passthrough is removed, so a link
 * nobody on the allowlist made cannot point the child at operator data; then the passthrough link is
 * (re-)established. Everything else in the overlay is agy's own and is left alone.
 *
 * Skills (`skillPlugins`, the operator's GLOBAL setting): each resolved skill is linked at
 * `config/skills/<name>`, and a symlink there that this call did not ask for is removed — so an
 * emptied setting retracts every link. A real directory in that seat is not ours and is never
 * removed; one standing where a link is owed refuses. The seat's two directories are proven real
 * with the rest, unless `config` is itself a foreign link the sweep below is about to remove.
 */
export function ensureAgyGeminiOverlay(
	realDir: string = AGY_REAL_GEMINI_DIR,
	overlayDir: string = AGY_GEMINI_OVERLAY_DIR,
	skillPlugins: readonly string[] = [],
): void {
	const realAppData = join(realDir, AGY_APP_DATA_DIRNAME);
	const overlayAppData = join(overlayDir, AGY_APP_DATA_DIRNAME);
	const overlayConfig = join(overlayDir, AGY_CONFIG_DIRNAME);
	const overlaySkills = join(overlayConfig, AGY_SKILLS_DIRNAME);
	const guarded = isSymlink(overlayConfig) ? [] : [overlayConfig, overlaySkills];
	for (const dir of [overlayDir, overlayAppData, ...guarded]) assertAgyOverlayDirectory(dir);
	const skillLinks = resolveAgySkillLinks(skillPlugins);
	mkdirSync(overlayAppData, { recursive: true });

	for (const dir of [overlayDir, overlayAppData]) {
		for (const entry of readdirSync(dir)) {
			if (dir === overlayAppData && AGY_OVERLAY_PASSTHROUGH.has(entry)) continue;
			const path = join(dir, entry);
			let isForeignLink: boolean;
			try {
				isForeignLink = lstatSync(path).isSymbolicLink();
			} catch (err) {
				// agy creates and removes its own files here while it runs (sqlite journals among
				// them); an entry gone between the listing and the stat is not ours to judge.
				if ((err as NodeJS.ErrnoException).code === "ENOENT") continue;
				throw err;
			}
			if (isForeignLink) rmSync(path, { force: true });
		}
	}

	for (const entry of AGY_OVERLAY_PASSTHROUGH) {
		const realPath = join(realAppData, entry);
		const overlayPath = join(overlayAppData, entry);
		let existing: ReturnType<typeof lstatSync> | undefined;
		try {
			existing = lstatSync(overlayPath);
		} catch {
			existing = undefined;
		}
		if (!existsSync(realPath)) {
			// Not present operator-side — no credential to pass; drop any stale overlay copy.
			if (existing) rmSync(overlayPath, { recursive: true, force: true });
			continue;
		}
		if (existing?.isSymbolicLink() && readlinkSync(overlayPath) === realPath) continue;
		if (existing) rmSync(overlayPath, { recursive: true, force: true });
		try {
			symlinkSync(realPath, overlayPath);
		} catch (err) {
			// Another agy bootstrap linked it between the removal and here. The same link is the
			// outcome this call wanted; anything else at the path is not.
			if ((err as NodeJS.ErrnoException).code !== "EEXIST" || readlinkSync(overlayPath) !== realPath) throw err;
		}
	}

	if (skillLinks.size > 0) mkdirSync(overlaySkills, { recursive: true });
	if (!existsSync(overlaySkills)) return;
	for (const entry of readdirSync(overlaySkills)) {
		const path = join(overlaySkills, entry);
		if (!isSymlink(path)) continue;
		if (skillLinks.get(entry) !== readlinkSync(path)) rmSync(path, { force: true });
	}
	for (const [name, source] of skillLinks) {
		const path = join(overlaySkills, name);
		if (isSymlink(path)) continue;
		try {
			symlinkSync(source, path);
		} catch (err) {
			const sameLink =
				(err as NodeJS.ErrnoException).code === "EEXIST" && isSymlink(path) && readlinkSync(path) === source;
			if (sameLink) continue;
			if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
			throw new Error(
				`entwurf: ${ACP_AGY_SKILL_NAME_COLLISION} — ${path} already exists and is not a link this overlay made, so the skill at ${source} cannot be linked there. ` +
					`Remove that entry and start the turn again.`,
			);
		}
	}
}
