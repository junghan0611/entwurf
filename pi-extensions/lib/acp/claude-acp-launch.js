// entwurf-owned launcher for the Claude ACP backend (#72).
//
// WHY THIS FILE EXISTS — it is not a wrapper for its own sake.
//
// The vendor bin is named `claude-agent-acp`, and that name is not ours: any
// harness on the host that spawns the same package produces a process with the
// same name. On GLG's oracle host a janitor installed for a DIFFERENT harness
// (openclaw's acpx, upstream PR #245) selects `claude-agent-acp` by argv
// SUBSTRING and SIGTERMs anything older than 900s. entwurf's child is retained
// across turns, so its age is the age of the SESSION, not of a turn — every
// session older than 15 minutes was shot at every 5 minutes. Measured: 12 of 12
// anomalous terminations across two boots, pid- and timestamp-locked (receipts
// in `scripts/raw-acp-child-exit-measure/README.md` §ANSWERED).
//
// So this launcher does two things, and deliberately nothing else:
//
//   1. NAMESPACE. It carries a name that is ours, so a name-matching janitor
//      stops selecting our process. The vendor is `import`ed INTO this same
//      process — not spawned as a child. That distinction is what keeps this
//      inside #72's repair fence: with no child to restart, this cannot become
//      the supervisor/watcher/retry the issue forbids. Any variant that spawns
//      the vendor breaks the fence and must not be written.
//
//   2. OBSERVE A CAUGHT SIGNAL. The vendor's own handler turns SIGTERM/SIGINT
//      into `dispose(); process.exit(0)`, so by the time entwurf sees the child
//      end there is an exit code 0 and NO signal — a clean external kill and a
//      vendor fault are indistinguishable. Registering first lets us record
//      that a terminating signal was caught, before the vendor erases it.
//
// WHAT THIS COSTS, STATED SO NOBODY DISCOVERS IT LATER. Once the name split is
// in place, a host janitor that scans for the vendor name can no longer see
// entwurf's children AT ALL — including ones that genuinely leaked. If pi is
// SIGKILLed so `teardownChild` never runs, this adapter reparents to PID 1 and
// matches neither that janitor's name phase nor its orphan phase (which looks
// for a bare `claude`). That leak class now belongs to entwurf: after the split,
// we own our own cleanup story and cannot expect someone else's timer to cover
// it. This is a deliberate trade — being killed mid-turn is worse than leaking
// a process on an abnormal exit — but it is a trade, not a free win.
//
// ARGV IS NOT OURS TO TOUCH. The vendor reads `--cli` / `--version` /
// `--hide-claude-auth` from `process.argv`, and builds its own re-invocation
// command from `process.argv.slice(1)` for the terminal-auth advert. Under this
// launcher that advert becomes `node <this file> --cli auth login …`, which
// keeps working ONLY because we consume no flags and resolve the vendor
// ourselves. Never give this file an option of its own.

import { readFileSync, writeSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

/**
 * The one line entwurf's stderr drain looks for, matched as an EXACT full line.
 * A fixed enum, never interpolated from vendor text: the backend must be unable
 * to mistake vendor prose (which mentions signals) for our own observation.
 */
const SIGNAL_FRAME_PREFIX = "ENTWURF_ACP_LAUNCH_SIGNAL=";

/** Signals the vendor normalizes to exit 0, and which are therefore invisible downstream. */
const OBSERVED_SIGNALS = /** @type {const} */ (["SIGTERM", "SIGINT"]);

for (const signal of OBSERVED_SIGNALS) {
	process.on(signal, () => {
		// writeSync, not console.error: a handler may run while the process is
		// tearing down and an async write can be dropped.
		try {
			writeSync(2, `${SIGNAL_FRAME_PREFIX}${signal}\n`);
		} catch {
			// stderr already gone — the observation is best-effort, never fatal.
		}
		// THE SINK GUARD. Registering a handler SUPPRESSES node's default
		// termination. If we are still the only listener — the vendor has not
		// registered yet, or its import failed — this observer would make the
		// process immune to the very signal it is observing, including entwurf's
		// own teardown SIGTERM. Stand down and let the signal land for real.
		if (process.listenerCount(signal) === 1) {
			process.removeAllListeners(signal);
			process.kill(process.pid, signal);
		}
	});
}

// Resolution lives INSIDE the same try as the import so both failures speak with
// one voice: a missing package and a broken package are the same event to an
// operator reading stderr, and only one of them would otherwise be legible.
try {
	const require = createRequire(import.meta.url);
	const pkgJsonPath = require.resolve("@agentclientprotocol/claude-agent-acp/package.json");
	const pkgJson = JSON.parse(readFileSync(pkgJsonPath, "utf8"));
	const binPath = typeof pkgJson.bin === "string" ? pkgJson.bin : pkgJson.bin?.["claude-agent-acp"];
	if (!binPath) throw new Error("@agentclientprotocol/claude-agent-acp resolved but exposes no bin entry");
	// Same process, no argv touched. The vendor bin has no main-module guard, so
	// importing it starts the agent exactly as executing it would.
	await import(pathToFileURL(join(dirname(pkgJsonPath), binPath)).href);
} catch (err) {
	// Fail loud and DIE. No retry, no fallback: a launcher that survives its own
	// failure is the hidden supervisor #72 forbids.
	writeSync(2, `entwurf acp launcher: vendor import failed: ${err instanceof Error ? err.stack : String(err)}\n`);
	process.exit(1);
}
