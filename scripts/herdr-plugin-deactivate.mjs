#!/usr/bin/env node
/**
 * herdr-plugin-deactivate — the explicit teardown of a Herdr-plugin activation (#116 M3-b2).
 *
 * This is the verb Herdr will never call. `herdr plugin uninstall` removes its managed checkout and
 * has no cleanup hook, so the harness wiring and the stable runtime are RETAINED, not cleaned — and
 * the operator needs one command, shipped in the package rather than in the deleted checkout, that
 * takes them back.
 *
 * EVERY IMPORT IS STATIC AND AT THE TOP. This process deletes the runtime it is executing from.
 * Measured on Linux: already-loaded modules and open descriptors survive that, but a lazy `import()`
 * afterwards fails with ERR_MODULE_NOT_FOUND — which would strand a host with its runtime gone, its
 * ledger unretired, and nothing left to run the rest. So nothing here is loaded late, and the gate
 * asserts there is no dynamic import to defer.
 *
 * PREFLIGHT EVERY AUTHORITY, THEN MUTATE. The ledger, the resolved roots, and BOTH component
 * inverses are asked read-only first. Only when all of them are green does the first byte change.
 * A component that then fails stops the run with the runtime and the ledger intact, because the
 * ledger is the retry authority and a teardown that deletes its own record of what is left is one
 * nobody can resume.
 */

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
	certifyPhaseForInverse,
	certifyRootsAgainstLedger,
	componentStates,
	ledgerBody,
	piStatePaths,
	planDeactivation,
	readCertifiedLedger,
	resolveActivationLayout,
	resolveComponentRoots,
	writeLedger,
} from "./herdr-activation.mjs";
import { removeOwnedRuntime, resolveRuntimeLayout } from "./herdr-runtime.mjs";

const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function run(command, args, env) {
	return spawnSync(command, args, { encoding: "utf8", env, stdio: ["ignore", "pipe", "pipe"] });
}

function fail(code, detail) {
	process.stderr.write(`[herdr-plugin-deactivate] ${code}: ${detail}\n`);
	process.exit(1);
}

export function deactivate(env) {
	const activation = resolveActivationLayout(env);
	const runtime = resolveRuntimeLayout(env);
	const roots = resolveComponentRoots(env);

	const ledger = readCertifiedLedger(activation);
	if (ledger === null) {
		process.stdout.write("[herdr-plugin-deactivate] no certified activation ledger — nothing to undo\n");
		return 0;
	}
	certifyRootsAgainstLedger(ledger, roots, runtime.activeDir);
	certifyPhaseForInverse(ledger);
	// On a RETRY the plan is what is LEFT: a component already recorded `removed` is skipped, because
	// its inverse has no ownership state to be admitted by any more and re-running it is a permanent
	// refusal — which is exactly how a half-finished teardown used to become unfinishable.
	const steps = planDeactivation(ledger);
	const states = componentStates(ledger);
	const piState = piStatePaths(env);

	// ── PREFLIGHT: every remaining authority, zero writes ────────────────────
	const preflights = [];
	if (steps.includes("claude-code")) {
		preflights.push([
			"claude-code",
			run(
				"python3",
				[path.join(PACKAGE_ROOT, "scripts", "meta-bridge-state.py"), "preflight-uninstall", "--repo", PACKAGE_ROOT],
				env,
			),
		]);
	}
	if (steps.includes("pi")) {
		const agentSettings = path.join(roots.piAgentDir.path, "settings.json");
		preflights.push([
			"pi-package",
			run(
				"python3",
				[
					path.join(PACKAGE_ROOT, "scripts", "register-pi-package.py"),
					agentSettings,
					PACKAGE_ROOT,
					"--scope",
					"user",
					"--state",
					piState.packageState,
					"--remove",
					"--preflight",
				],
				env,
			),
		]);
		preflights.push([
			"pi-provider",
			run(
				"python3",
				[
					path.join(PACKAGE_ROOT, "scripts", "register-pi-provider.py"),
					"remove",
					agentSettings,
					PACKAGE_ROOT,
					"--scope",
					"user",
					"--state",
					piState.providerState,
					"--preflight",
				],
				env,
			),
		]);
	}
	const refused = preflights.filter(([, r]) => r.status !== 0);
	if (refused.length > 0) {
		for (const [name, r] of refused) {
			process.stderr.write(`  ${name}: ${(r.stderr || r.stdout || "").trim().split("\n").pop()}\n`);
		}
		fail("deactivate-preflight-refused", `${refused.map(([n]) => n).join(", ")} — zero bytes changed`);
	}
	process.stdout.write(
		`[herdr-plugin-deactivate] preflight-all ok (${preflights.length === 0 ? "nothing left to undo" : preflights.map(([n]) => n).join(", ")})\n`,
	);

	// ── MUTATE: retry authority is written BEFORE each step, checkpointed after ──
	// The identity is carried through the teardown unchanged, from the ledger's own record. A
	// teardown does not re-decide which artifact it was: it removes what the ledger says was
	// activated, so rewriting that field mid-inverse could only ever make the record less true.
	const checkpoint = () =>
		writeLedger(
			activation,
			ledgerBody({
				phase: "deactivating",
				runtimeRoot: runtime.activeDir,
				artifactIdentity: ledger.artifactIdentity,
				roots,
				states,
			}),
		);
	checkpoint();

	const done = [];
	for (const step of steps) {
		if (step === "claude-code" || step === "pi") {
			const verb = step === "pi" ? "remove-user-scope" : "uninstall-meta-bridge";
			const r = run("bash", [path.join(PACKAGE_ROOT, "run.sh"), verb], env);
			if (r.status !== 0) {
				process.stderr.write(`${(r.stderr || r.stdout || "").trim()}\n`);
				fail(
					"deactivate-component-failed",
					`${step} inverse failed — runtime and ledger preserved as retry authority (${done.length} component(s) already removed and recorded)`,
				);
			}
			states[step] = "removed";
			checkpoint();
			done.push(step);
		} else if (step === "runtime") {
			// Past this line the code that wrote this file is gone from disk. Everything below is
			// already loaded; nothing is imported.
			removeOwnedRuntime({ env });
			done.push(step);
		} else if (step === "ledger") {
			fs.rmSync(activation.ledgerPath, { force: true });
			done.push(step);
		}
	}
	process.stdout.write(`[herdr-plugin-deactivate] done: ${done.join(" -> ")}\n`);
	return 0;
}

function sameFile(a, b) {
	try {
		return fs.realpathSync(a) === fs.realpathSync(b);
	} catch {
		return false;
	}
}

if (process.argv[1] && sameFile(process.argv[1], fileURLToPath(import.meta.url))) {
	try {
		process.exit(deactivate(process.env));
	} catch (err) {
		fail(err.code ?? "deactivate-failed", err.detail ?? err.message);
	}
}
