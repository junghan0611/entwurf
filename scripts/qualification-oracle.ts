/**
 * qualification-oracle — launcher for the exact-SHA composite release oracle (#124 P1).
 *
 * It JUDGES NOTHING. It clones the target SHA cleanly, then runs THAT SHA's own
 * `scripts/lib/qualification-oracle-core.ts` inside the clone and relays its output and
 * exit code. The operator's checkout — possibly dirty or stale — never evaluates a SHA
 * with its own bytes.
 *
 *   1. tripwire the origin checkout: HEAD, porcelain, work-surface content hash;
 *   2. `git clone --no-hardlinks --no-checkout <origin> <tmp>`; `checkout --detach <sha>`;
 *      the clone must be exactly <sha> and clean, its surface stable across two reads;
 *   3. no core source at <sha> → ABORT oracle-source-missing (every SHA before the core
 *      landed, 8d508d3 included, is judged this way — by design, not by accident);
 *   4. run `node --experimental-strip-types <clone>/scripts/lib/qualification-oracle-core.ts`
 *      with cwd = the clone;
 *   5. ALWAYS (child failure, child signal, our own SIGINT/SIGTERM): remove the clone, then
 *      re-read the origin tripwire. A moved origin overrides any child result with ABORT.
 *
 * Nothing here writes the origin's .git, worktree or index (no `worktree add`).
 */

import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { originHead, originWorkSurfaceSha } from "./lib/mutation-qualify.ts";
import { ORACLE_CORE_PATH, parseOracleArgs } from "./lib/qualification-oracle-core.ts";
import { checkReceiptPath } from "./lib/qualification-receipt.ts";

const SELF_REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function tripwire(dir: string): string {
	const porcelain = spawnSync("git", ["-C", dir, "status", "--porcelain"], { encoding: "utf8" }).stdout;
	return JSON.stringify({ head: originHead(dir), porcelain, surface: originWorkSurfaceSha(dir) });
}

export function launch(argv: string[], log = console.log, logError = console.error): number {
	let origin: string;
	let sha: string;
	let ledgerOut: string | undefined;
	try {
		const args = parseOracleArgs(argv, true);
		origin = path.resolve(args.origin ?? SELF_REPO);
		sha = args.sha;
		ledgerOut = args.ledgerOut;
		if (ledgerOut) checkReceiptPath(ledgerOut, origin);
	} catch (err) {
		logError(`[qualification-oracle] ABORT: ${err instanceof Error ? err.message : String(err)}`);
		return 2;
	}
	const passArgs = argv.filter((_, i) => argv[i] !== "--origin" && argv[i - 1] !== "--origin");

	let interrupted: NodeJS.Signals | null = null;
	const onSignal = (sig: NodeJS.Signals) => {
		interrupted = sig;
	};
	process.on("SIGINT", onSignal);
	process.on("SIGTERM", onSignal);
	const before = tripwire(origin);
	const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "entwurf-oracle-clone-"));
	const clone = path.join(tmp, "repo");
	let code = 2;
	try {
		const git = (...a: string[]) => spawnSync("git", a, { encoding: "utf8" });
		if (git("clone", "-q", "--no-hardlinks", "--no-checkout", origin, clone).status !== 0) {
			logError("[qualification-oracle] ABORT clone-failed");
			return 2;
		}
		if (git("-C", clone, "-c", "advice.detachedHead=false", "checkout", "-q", "--detach", sha).status !== 0) {
			logError(`[qualification-oracle] ABORT sha-unknown: ${sha} is not in ${origin}`);
			return 2;
		}
		const head = git("-C", clone, "rev-parse", "HEAD").stdout.trim();
		const clean = git("-C", clone, "status", "--porcelain").stdout === "";
		const s1 = originWorkSurfaceSha(clone);
		const s2 = originWorkSurfaceSha(clone);
		if (head !== sha || !clean || s1 !== s2) {
			logError(
				`[qualification-oracle] ABORT clone-not-exact: head ${head}, clean ${clean}, surface stable ${s1 === s2}`,
			);
			return 2;
		}
		if (!fs.existsSync(path.join(clone, ORACLE_CORE_PATH))) {
			logError(`[qualification-oracle] ABORT oracle-source-missing: ${sha} does not carry ${ORACLE_CORE_PATH}`);
			return 2;
		}
		const child = spawnSync(process.execPath, ["--experimental-strip-types", ORACLE_CORE_PATH, ...passArgs], {
			cwd: clone,
			encoding: "utf8",
			maxBuffer: 64 * 1024 * 1024,
		});
		if (child.stdout) log(child.stdout.replace(/\n$/, ""));
		if (child.stderr) logError(child.stderr.replace(/\n$/, ""));
		code = child.status === null ? 2 : child.status;
		if (child.signal) {
			logError(`[qualification-oracle] ABORT the oracle core ended by ${child.signal}`);
			code = 2;
		}
	} finally {
		fs.rmSync(tmp, { recursive: true, force: true });
		process.off("SIGINT", onSignal);
		process.off("SIGTERM", onSignal);
		let after = "";
		try {
			after = tripwire(origin);
		} catch (err) {
			after = `unreadable: ${err instanceof Error ? err.message : String(err)}`;
		}
		if (after !== before) {
			logError("[qualification-oracle] ABORT origin-moved: the origin checkout changed while the oracle ran");
			code = 2;
		}
		if (interrupted) {
			logError(`[qualification-oracle] ABORT interrupted by ${interrupted}`);
			code = 2;
		}
	}
	return code;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	process.exit(launch(process.argv.slice(2)));
}
