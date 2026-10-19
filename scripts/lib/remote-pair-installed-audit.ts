/**
 * The acceptance primitive of `check-remote-pair-installed`'s checkout-invisibility cell (#107 rail 3),
 * as a pure function over resolve-hook logs so it can be proven on tiny synthetic files
 * (test/remote-pair-installed-audit.test.ts). Each log line is one URL a subject process resolved.
 * A `file:` URL counts and is judged by its REAL path; anything else (node: builtins) is ignored.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

/** Every file the logs name that is NOT inside `root` (both compared by real path), and how many file URLs were read. */
export function filesOutsideRoot(logFiles: readonly string[], root: string): { total: number; outside: string[] } {
	const realRoot = fs.realpathSync(root);
	const out = new Set<string>();
	let total = 0;
	for (const f of logFiles) {
		for (const url of fs.readFileSync(f, "utf8").split("\n").filter(Boolean)) {
			if (!url.startsWith("file:")) continue;
			total++;
			const real = fs.realpathSync(fileURLToPath(url));
			if (real !== realRoot && !real.startsWith(`${realRoot}${path.sep}`)) out.add(real);
		}
	}
	return { total, outside: [...out].sort() };
}
