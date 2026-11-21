// The end-of-run process scan (#171 step 7). NOT a gate. Pure /proc reads; the only action is SIGKILL
// of processes that carry this run's token. continuity.mjs uses it in-process at its end; run.sh runs it
// as a CLI after EVERY probe, including the legacy probes (rail0, agy, resume-unknown, experiments, z5)
// whose own leader-only kill is left untouched so their receipts stay comparable.
//
// The token is RAW171_SWEEP_TOKEN=<uuid>, set by run.sh in the probe's environment. Every probe passes
// process.env to its agents, so the agents and their descendants inherit it. (The name stays outside the
// /^(ANTHROPIC|CLAUDE|PI_|ENTWURF|GEMINI|GOOGLE)/ filter rail0 and agy record as `ambient`.)
//
//   node sweep.mjs <run-dir> <token>   prints {owned, foreign, ownedLeftAfterKill}; exit 0 only when both
//                                      lists are empty and nothing carrying the token is left after the
//                                      kill, 1 otherwise, 2 on usage
//
// `owned` carries the token wherever its cwd now is, and is SIGKILLed. `foreign` sits under the run
// directory without the token and is only reported. Either one fails the run.
import { readdirSync, readFileSync, readlinkSync } from "node:fs";
import { pathToFileURL } from "node:url";

export const TOKEN_NAME = "RAW171_SWEEP_TOKEN";
const pids = () => readdirSync("/proc").filter((p) => /^\d+$/.test(p) && Number(p) !== process.pid);
const carries = (pid, entry) => {
	try {
		return readFileSync(`/proc/${pid}/environ`, "latin1").split("\0").includes(entry);
	} catch {
		return false;
	}
};
const commOf = (pid) => {
	try {
		return readFileSync(`/proc/${pid}/comm`, "utf8").trim();
	} catch {
		return "?";
	}
};
/** Processes (other than this one) whose cwd is `runDir` or below it, as pids. */
export function underDir(runDir) {
	return pids().filter((p) => {
		try {
			const cwd = readlinkSync(`/proc/${p}/cwd`);
			return cwd === runDir || cwd.startsWith(`${runDir}/`);
		} catch {
			return false;
		}
	});
}
/** A clean sweep: nothing owned or foreign was found, and nothing carrying the token is left after the kill. */
export const swept = (r) => r.owned.length === 0 && r.foreign.length === 0 && r.ownedLeftAfterKill === 0;
/** Kill every token carrier, report foreign processes under the run directory. */
export async function sweep(runDir, token) {
	const entry = `${TOKEN_NAME}=${token}`;
	const carriers = () => pids().filter((p) => carries(p, entry));
	const owned = carriers().map((p) => `${p} ${commOf(p)}`);
	const foreign = underDir(runDir)
		.filter((p) => !carries(p, entry))
		.map((p) => `${p} ${commOf(p)}`);
	for (const p of owned) {
		try {
			process.kill(Number(p.split(" ")[0]), "SIGKILL");
		} catch {}
	}
	if (owned.length > 0) await new Promise((r) => setTimeout(r, 1000));
	return { owned, foreign, ownedLeftAfterKill: carriers().length };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	const [runDir, token] = process.argv.slice(2);
	if (!runDir?.startsWith("/") || !/^[0-9a-f-]{36}$/.test(token ?? "")) {
		console.error("usage: node sweep.mjs <absolute run-dir> <uuid token>");
		process.exit(2);
	}
	const r = await sweep(runDir, token);
	console.log(JSON.stringify(r));
	process.exit(swept(r) ? 0 : 1);
}
