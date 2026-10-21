/**
 * meta-hook-bundle — the Claude Code hook bundle a gate stages, derived from the hook's OWN
 * import graph rather than from a hand-kept file list (#147 L2 B1).
 *
 * The installed bundle is the entry plus exactly the `lib/` files `meta-bridge-install.sh`
 * copies. A gate that hand-copies its own list can pass while the installer misses a file the
 * hook now imports — the false green this module exists to remove. So a staged bundle carries
 * the entry's import closure, and `installerCopiedLibFiles` reads what the installer actually
 * copies, for the gate to compare the two.
 *
 * SCOPE, deliberately narrow: only static `from "./…"` / `from "../…"` specifiers in DOUBLE
 * quotes — the one form the hook's closure (entry, meta-session, entwurf-v2-lock, session-id)
 * uses today. A side-effect `import "./x"`, a dynamic `import("./x")`, a `require`, or a
 * single-quoted specifier is NOT followed, so the comparison says nothing about them; this is
 * not a general module resolver and must not grow into one. `meta-session`'s win32 addon is
 * one such unfollowed load (`createRequire`, win32 only, outside the Linux/macOS bundle). The
 * independent proof that the closure is complete is the gate RUNNING the staged compiled hook.
 */

import { chmodSync, copyFileSync, mkdirSync, readFileSync } from "node:fs";
import * as path from "node:path";

const IMPORT_RE = /\bfrom\s+"(\.{1,2}\/[^"]+)"/g;

/**
 * The entry's relative-import closure, as paths relative to the entry's directory
 * (`lib/meta-session.ts`, …). The entry itself is not included.
 */
export function hookImportClosure(entryFile: string): string[] {
	const root = path.dirname(entryFile);
	const seen = new Set<string>();
	const visit = (file: string): void => {
		const source = readFileSync(file, "utf8");
		for (const match of source.matchAll(IMPORT_RE)) {
			const target = path.resolve(path.dirname(file), match[1] as string);
			const rel = path.relative(root, target);
			if (seen.has(rel)) continue;
			seen.add(rel);
			visit(target);
		}
	};
	visit(entryFile);
	return [...seen].sort();
}

/** The `lib/<name>` destinations `meta-bridge-install.sh` copies into the assembled plugin. */
export function installerCopiedLibFiles(installerText: string): string[] {
	const out = new Set<string>();
	for (const match of installerText.matchAll(/^cp\s.*"\$ASM\/\$PLUGIN\/lib\/([^"]+)"\s*$/gm)) {
		out.add(match[1] as string);
	}
	return [...out].sort();
}

/**
 * Stage entry + its import closure + the launcher under `root`, exactly as installed. `entryFile`
 * is the source (`pi-extensions/meta-bridge-hook.ts`) or the compiled entry
 * (`mcp/entwurf-bridge/dist/pi-extensions/meta-bridge-hook.js`); the closure follows whichever.
 */
export function stageMetaHookBundle(root: string, entryFile: string, launcher: string): string[] {
	const closure = hookImportClosure(entryFile);
	mkdirSync(path.join(root, "scripts"), { recursive: true });
	copyFileSync(entryFile, path.join(root, path.basename(entryFile)));
	for (const rel of closure) {
		mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
		copyFileSync(path.join(path.dirname(entryFile), rel), path.join(root, rel));
	}
	const staged = path.join(root, "scripts", "hook-launch.sh");
	copyFileSync(launcher, staged);
	chmodSync(staged, 0o755);
	return closure;
}
