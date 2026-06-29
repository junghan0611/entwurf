// ACP plugin — Claude config overlay materializer (S2b).
//
// claude-agent-acp's SettingsManager loads the operator's `~/.claude/settings.json`
// DIRECTLY (CLAUDE_CONFIG_DIR is the only knob that redirects that read). So the
// operator's native `permissions.defaultMode` ("auto"), hooks, plugins, and
// per-cwd memory/projects state would otherwise leak into entwurf ACP
// sessions. The overlay redirects SettingsManager at a pi-owned directory whose
// `settings.json` WE author (minimal, `hooks:{}`), while keeping exactly the
// operator entries a backend needs (credentials, caches, built-in skills)
// reachable through a TIGHT symlink whitelist — nothing else.
//
// Scope (NEXT §스코프 / §S2-scout 핀3): Claude-only on this lane. Codex/Gemini
// overlays (CODEX_HOME / admin.toml) are 0.11.0 behavior-oracle territory and
// out of scope — the bridge backends are not in v2 yet.
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
import { join } from "node:path";

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
 *   - `permissions.defaultMode: "default"` neutralizes the operator's native
 *     "auto"; combined with the explicit `tools`/`permissionAllow` surface,
 *     "default" auto-passes every tool we expose without prompts.
 *   - `autoMemoryEnabled: false` — SDK opt-out for auto-memory (defense in
 *     depth; the tiny non-empty engraving/preset replacement is the primary
 *     write-containment lever for Claude ACP).
 *   - `hooks: {}` — configured-but-empty (NOT absent): inherits no operator
 *     hook (mailbox absence by design) while keeping the compaction turn honest.
 */
export function overlaySettingsJson(): string {
	return `${JSON.stringify(
		{
			permissions: { defaultMode: "default" },
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
