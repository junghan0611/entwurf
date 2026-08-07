/**
 * claude-launcher-fence — the shared fail-closed protection for the operator's real `claude`
 * launcher, owed by BOTH mux LIVE smokes (issue #67).
 *
 * The observed incident: a Claude child launched with the operator's real HOME but a fixture
 * `XDG_DATA_HOME` self-updated INTO the fixture tree and rewrote the real launcher (the
 * `~/.local/bin/claude` install shim) to point at `<fixture>/claude/versions/<v>`. Fixture
 * teardown then deleted that tree and left the operator's launcher dangling. This module owns
 * the three protections the smokes share, so neither carries its own copy:
 *
 *   1. PREFLIGHT (`snapshotClaudeLauncher`) — fail-closed. Before any Claude-capable child
 *      starts, resolve the actual absolute launcher from the exact child PATH, require it and
 *      its symlink/realpath-resolved target to be present, regular, executable and OUTSIDE the
 *      fixture cleanup root, and capture enough identity/content evidence (kind, link text,
 *      resolved path, content hash) to prove "unchanged" later. Any doubt throws — a smoke that
 *      cannot pin the launcher's identity must not launch the child that could destroy it.
 *   2. INTEGRITY ORACLE (`verifyClaudeLauncher`) — on success AND on every failure teardown,
 *      before fixture removal, re-derive the same facts and report every mismatch by name.
 *   3. CLEANUP GUARD (`launcherReferencesFixture`) — the one question that decides whether
 *      `rm -rf <fixture>` is destructive: does the launcher, or what it currently resolves to,
 *      live inside the fixture root? If yes, the smoke must BLOCK its own cleanup loudly and
 *      leave the tree in place rather than dangle the operator's launcher.
 *
 * It also owns the env repair that removes the incident's trigger: `restoreOriginalXdg` gives a
 * real-HOME Claude cell EXACT operator-env parity on the four XDG roots — each variable restored
 * to its original value if it was set, and DELETED if it was originally absent. Filling a
 * canonical default for an absent variable would be a guess about how the runtime reads its
 * config; parity, not widening, is the contract. That parity covers the four PERSISTENT
 * CONFIG/DATA/STATE/CACHE roots only: `XDG_RUNTIME_DIR` deliberately remains the smokes' private
 * fixture runtime surface, so this is not a claim of total operator-env parity.
 *
 * This is a scripts-side harness module. It never inspects or alters anything unless the caller
 * hands it an environment and a fixture root, and it must stay out of shipped production source.
 */

import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

/** The four XDG roots a real-HOME Claude cell must see with exact operator parity. */
export const CLAUDE_CELL_XDG_VARS = ["XDG_CONFIG_HOME", "XDG_DATA_HOME", "XDG_STATE_HOME", "XDG_CACHE_HOME"] as const;

/** Original presence/value of each XDG root: a string if it was set (even empty), null if absent. */
export type OriginalXdg = Record<string, string | null>;

/** Capture the four XDG roots BEFORE any fixture redirect touches the environment. */
export function snapshotOriginalXdg(env: NodeJS.ProcessEnv): OriginalXdg {
	const out: OriginalXdg = {};
	for (const name of CLAUDE_CELL_XDG_VARS) out[name] = env[name] ?? null;
	return out;
}

/**
 * Restore EXACT original presence/value of the four XDG roots on a cell env. An originally
 * absent variable is deleted, never filled with a canonical default — parity, not a guess.
 */
export function restoreOriginalXdg(env: NodeJS.ProcessEnv, originals: OriginalXdg): NodeJS.ProcessEnv {
	for (const name of CLAUDE_CELL_XDG_VARS) {
		const original = originals[name];
		if (original === null || original === undefined) delete env[name];
		else env[name] = original;
	}
	return env;
}

/** Everything the preflight pinned, and the oracle later re-derives. */
export interface ClaudeLauncherSnapshot {
	/** Absolute launcher path selected from the exact child PATH. */
	launcherPath: string;
	/** What the launcher IS at its own path: a symlink or a regular file. */
	kind: "symlink" | "file";
	/** Raw readlink text when the launcher is a symlink, else null. */
	linkText: string | null;
	/** Fully realpath-resolved target the launcher executes. */
	resolvedPath: string;
	/** sha256 of the resolved target's content — the one axis that catches a same-path, same-link in-place rewrite. */
	sha256: string;
	/** Realpath of the fixture cleanup root the launcher must stay outside of. */
	fixtureRoot: string;
}

function isInside(parent: string, p: string): boolean {
	const rel = path.relative(parent, p);
	return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
}

function sha256File(file: string): string {
	return createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function isExecutableFile(p: string): boolean {
	try {
		if (!fs.statSync(p).isFile()) return false;
		fs.accessSync(p, fs.constants.X_OK);
		return true;
	} catch {
		return false;
	}
}

/**
 * Resolve `cmd` the way the child's exec will: first PATH entry holding an executable file.
 * Returns the joined candidate path (not yet symlink-resolved), or null when nothing matches.
 */
export function resolveFromPath(cmd: string, env: NodeJS.ProcessEnv): string | null {
	for (const dir of (env.PATH ?? "").split(path.delimiter)) {
		if (!dir) continue;
		const candidate = path.join(dir, cmd);
		if (isExecutableFile(candidate)) return candidate;
	}
	return null;
}

/**
 * FAIL-CLOSED PREFLIGHT. Pin the launcher's identity before any Claude-capable child starts,
 * or throw. Every refusal names itself: a smoke that cannot prove the launcher is a real,
 * executable, fixture-independent file must not launch the child that could rewrite it.
 */
export function snapshotClaudeLauncher(opts: { env: NodeJS.ProcessEnv; fixtureRoot: string }): ClaudeLauncherSnapshot {
	const fixtureRoot = fs.realpathSync(opts.fixtureRoot);
	const launcherPath = resolveFromPath("claude", opts.env);
	if (!launcherPath) {
		throw new Error(
			"claude-launcher-fence: fail-closed — no executable `claude` on the exact child PATH, so the launcher's identity cannot be pinned before launch",
		);
	}
	if (!path.isAbsolute(launcherPath)) {
		throw new Error(
			`claude-launcher-fence: fail-closed — \`claude\` resolved through a relative PATH entry (${launcherPath}); a cwd-dependent launcher cannot be pinned`,
		);
	}
	if (isInside(fixtureRoot, launcherPath)) {
		throw new Error(
			`claude-launcher-fence: fail-closed — the selected launcher ${launcherPath} is INSIDE the fixture cleanup root ${fixtureRoot}`,
		);
	}
	const lst = fs.lstatSync(launcherPath);
	const kind: ClaudeLauncherSnapshot["kind"] = lst.isSymbolicLink() ? "symlink" : "file";
	if (kind === "file" && !lst.isFile()) {
		throw new Error(
			`claude-launcher-fence: fail-closed — the launcher ${launcherPath} is neither a regular file nor a symlink`,
		);
	}
	const linkText = kind === "symlink" ? fs.readlinkSync(launcherPath) : null;
	let resolvedPath: string;
	try {
		resolvedPath = fs.realpathSync(launcherPath);
	} catch (err) {
		throw new Error(
			`claude-launcher-fence: fail-closed — the launcher ${launcherPath} does not resolve to a real target: ${
				err instanceof Error ? err.message : String(err)
			}`,
		);
	}
	if (!isExecutableFile(resolvedPath)) {
		throw new Error(
			`claude-launcher-fence: fail-closed — the launcher's resolved target ${resolvedPath} is not a regular executable file`,
		);
	}
	if (isInside(fixtureRoot, resolvedPath)) {
		throw new Error(
			`claude-launcher-fence: fail-closed — the launcher's resolved target ${resolvedPath} is INSIDE the fixture cleanup root ${fixtureRoot}`,
		);
	}
	return {
		launcherPath,
		kind,
		linkText,
		resolvedPath,
		sha256: sha256File(resolvedPath),
		fixtureRoot,
	};
}

/**
 * INTEGRITY ORACLE. Re-derive every pinned fact and return one problem string per mismatch —
 * empty means the launcher, its link, its resolved target and that target's content are all
 * exactly as the preflight saw them, and the target is still a regular executable. Runs on the
 * success path AND on every failure teardown, BEFORE fixture removal.
 */
export function verifyClaudeLauncher(snapshot: ClaudeLauncherSnapshot): string[] {
	const problems: string[] = [];
	let lst: fs.Stats;
	try {
		lst = fs.lstatSync(snapshot.launcherPath);
	} catch {
		problems.push(`the launcher ${snapshot.launcherPath} no longer exists`);
		return problems;
	}
	const kindNow: ClaudeLauncherSnapshot["kind"] = lst.isSymbolicLink() ? "symlink" : "file";
	if (kindNow !== snapshot.kind) {
		problems.push(`the launcher changed kind: was ${snapshot.kind}, is now ${kindNow}`);
	}
	if (kindNow === "symlink") {
		// A raced-away link is an INTEGRITY PROBLEM, never an exception that could mask the run
		// error this oracle runs alongside.
		let linkNow: string | null = null;
		try {
			linkNow = fs.readlinkSync(snapshot.launcherPath);
		} catch (err) {
			problems.push(
				`the launcher's link text could not be re-read: ${err instanceof Error ? err.message : String(err)}`,
			);
		}
		if (linkNow !== null && linkNow !== snapshot.linkText) {
			problems.push(`the launcher's link text changed: was ${snapshot.linkText ?? "(none)"}, is now ${linkNow}`);
		}
	}
	let resolvedNow: string | null = null;
	try {
		resolvedNow = fs.realpathSync(snapshot.launcherPath);
	} catch {
		problems.push(`the launcher ${snapshot.launcherPath} no longer resolves to a real target`);
	}
	if (resolvedNow !== null) {
		if (resolvedNow !== snapshot.resolvedPath) {
			problems.push(`the launcher's resolved target moved: was ${snapshot.resolvedPath}, is now ${resolvedNow}`);
		}
		if (!isExecutableFile(resolvedNow)) {
			problems.push(`the launcher's resolved target ${resolvedNow} is no longer a regular executable file`);
		} else {
			try {
				if (sha256File(resolvedNow) !== snapshot.sha256) {
					problems.push(`the launcher's resolved target ${resolvedNow} changed content (sha256 mismatch)`);
				}
			} catch (err) {
				problems.push(
					`the launcher's resolved target ${resolvedNow} could not be hashed: ${err instanceof Error ? err.message : String(err)}`,
				);
			}
		}
		if (isInside(snapshot.fixtureRoot, resolvedNow)) {
			problems.push(
				`the launcher's resolved target ${resolvedNow} now lies INSIDE the fixture cleanup root ${snapshot.fixtureRoot}`,
			);
		}
	}
	return problems;
}

/** What the cleanup guard could prove, stated honestly: a KNOWN fixture reference and an
 * UNPROVABLE state both block removal, but each is named as itself in `problems`. */
export interface LauncherCleanupVerdict {
	/** True only when removal is PROVEN safe: the launcher demonstrably does not reference the fixture. */
	safeToRemove: boolean;
	/** Named reasons removal is blocked — a fixture reference, or a syscall that left safety unproven. */
	problems: string[];
}

/**
 * CLEANUP GUARD. Decides whether `rm -rf <fixture>` is destructive: does the launcher, its
 * current link target, or its current resolved path lie inside the fixture cleanup root — the
 * exact state in which removal would dangle the operator's launcher? FAIL-CLOSED on uncertainty:
 * a readlink/lstat/realpath error blocks removal with a "not proven safe" problem rather than
 * being laundered into either a false "references fixture" or a false all-clear. A launcher that
 * is missing ENTIRELY is safe to clean around — nothing is left for removal to sever, and the
 * integrity oracle reports that damage by name.
 */
export function assessLauncherCleanup(snapshot: ClaudeLauncherSnapshot): LauncherCleanupVerdict {
	if (isInside(snapshot.fixtureRoot, snapshot.launcherPath)) {
		return {
			safeToRemove: false,
			problems: [`the launcher ${snapshot.launcherPath} itself lies inside the fixture cleanup root`],
		};
	}
	let lst: fs.Stats;
	try {
		lst = fs.lstatSync(snapshot.launcherPath);
	} catch (err) {
		if ((err as NodeJS.ErrnoException).code === "ENOENT") return { safeToRemove: true, problems: [] };
		return {
			safeToRemove: false,
			problems: [
				`the launcher ${snapshot.launcherPath} could not be inspected (${
					err instanceof Error ? err.message : String(err)
				}) — removal is not proven safe`,
			],
		};
	}
	if (lst.isSymbolicLink()) {
		let hop: string;
		try {
			hop = path.resolve(path.dirname(snapshot.launcherPath), fs.readlinkSync(snapshot.launcherPath));
		} catch (err) {
			return {
				safeToRemove: false,
				problems: [
					`the launcher's link text could not be read (${
						err instanceof Error ? err.message : String(err)
					}) — removal is not proven safe`,
				],
			};
		}
		if (isInside(snapshot.fixtureRoot, hop)) {
			return {
				safeToRemove: false,
				problems: [`the launcher's link target ${hop} lies inside the fixture cleanup root`],
			};
		}
	}
	try {
		const resolved = fs.realpathSync(snapshot.launcherPath);
		if (isInside(snapshot.fixtureRoot, resolved)) {
			return {
				safeToRemove: false,
				problems: [`the launcher's resolved target ${resolved} lies inside the fixture cleanup root`],
			};
		}
	} catch (err) {
		// A dangling or unresolvable chain: the first hop above was proven outside the fixture, but
		// the FULL chain was not — fail closed rather than guess.
		return {
			safeToRemove: false,
			problems: [
				`the launcher ${snapshot.launcherPath} could not be fully resolved (${
					err instanceof Error ? err.message : String(err)
				}) — removal is not proven safe`,
			],
		};
	}
	return { safeToRemove: true, problems: [] };
}
