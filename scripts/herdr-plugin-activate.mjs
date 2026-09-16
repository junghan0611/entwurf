#!/usr/bin/env node
/**
 * herdr-plugin-activate — the forward half of a Herdr-plugin activation (#116 M3-b2).
 *
 * WHAT IT TAKES, AND WHY THAT IS ALL. Exactly a subset of `{pi, claude-code}`, and nothing else: no
 * path, no command, no backend name this lane has not agreed to support. The stable runtime address
 * is DERIVED here from XDG and handed down; the Pi and Claude writers accept a named root only when
 * it is that same derived one. A verb that took a directory would be a way to point every pi session
 * and every Claude MCP call at an executable of the caller's choosing.
 *
 * WHICH BACKENDS is M3-b3's question. This verb does not read Herdr's integration status; it is
 * handed the answer. That keeps `H ∩ P` in one place — the profile leaf — instead of two.
 *
 * ADD-ONLY. A reinstall reconciles what is already active and adds what is newly requested. A
 * backend absent from THIS request is retained, because a harness leaving Herdr's integration list
 * is not a request to tear down wiring the operator still uses. Removal is the explicit verb.
 *
 * THE LEDGER IS WRITTEN BEFORE THE MUTATION, NOT AFTER. Each selected component is recorded
 * `pending` before anything is touched and checkpointed `active` the moment its writer returns, so a
 * run that dies halfway leaves a record of exactly how far it got. A transaction that only writes
 * its result at the end is not retryable — it is re-runnable until the first partial failure.
 */

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
	ACTIVATABLE_BACKENDS,
	ActivationError,
	certifyPhaseForForward,
	certifyRootsAgainstLedger,
	componentStates,
	ledgerBody,
	planActivation,
	readCertifiedLedger,
	resolveActivationLayout,
	resolveComponentRoots,
	resolveEntwurfDataRoot,
	writeLedger,
} from "./herdr-activation.mjs";
import { readCertifiedJournal, resolveRuntimeLayout, verifyInstalledRuntime } from "./herdr-runtime.mjs";

const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function run(command, args, env) {
	return spawnSync(command, args, { encoding: "utf8", env, stdio: ["ignore", "pipe", "pipe"] });
}

/** The only input: a subset of P, parsed from argv and refused if it is anything else. */
export function parseBackends(argv) {
	const requested = [];
	for (const arg of argv) {
		if (!ACTIVATABLE_BACKENDS.includes(arg)) {
			throw new ActivationError(
				"activation-backend-outside-p",
				`${JSON.stringify(arg)} — this verb takes a subset of ${JSON.stringify(ACTIVATABLE_BACKENDS)} and nothing else`,
			);
		}
		if (!requested.includes(arg)) requested.push(arg);
	}
	if (requested.length === 0) {
		throw new ActivationError("activation-backend-outside-p", "name at least one backend to activate");
	}
	return ACTIVATABLE_BACKENDS.filter((b) => requested.includes(b));
}

export function activate(env, requested) {
	const activation = resolveActivationLayout(env);
	const runtime = resolveRuntimeLayout(env);
	const roots = resolveComponentRoots(env);

	// 1. the runtime must be certified ready AND actually be a runtime on disk.
	const journal = readCertifiedJournal(runtime);
	if (journal === null || journal.phase !== "runtime-ready") {
		throw new ActivationError(
			"activation-runtime-not-ready",
			`${runtime.activeDir} has no certified runtime-ready journal behind it`,
		);
	}
	// The EXACT name AND version the journal certifies, not merely "a usable tree of that name": a
	// runtime the journal says is 0.21.0 while the disk holds something else is two different answers
	// to the question the wiring is about to be pointed at.
	try {
		verifyInstalledRuntime(runtime.activeDir, { name: journal.packageName, version: journal.packageVersion });
	} catch (err) {
		throw new ActivationError("activation-runtime-not-ready", `${err.code ?? "unknown"}: ${err.detail ?? err.message}`);
	}

	// 2. the existing ledger, and the roots it was recorded against.
	const ledger = readCertifiedLedger(activation);
	certifyRootsAgainstLedger(ledger, roots, runtime.activeDir);
	certifyPhaseForForward(ledger, requested);
	const plan = planActivation({ ledger, requested });
	const selected = [...plan.reconcile, ...plan.add];

	// 3. preflight EVERY selected component before the first byte.
	const preflights = [];
	if (selected.includes("claude-code")) {
		preflights.push([
			"claude-code",
			// The mode rides the ARGV, because that is what the state owner reads. The env var is the
			// installer script's channel; passing only that preflights the DEFAULT mode and then
			// installs the plugin one — a green check of work nobody is going to do.
			run(
				"python3",
				[
					path.join(PACKAGE_ROOT, "scripts", "meta-bridge-state.py"),
					"preflight-install",
					"--repo",
					PACKAGE_ROOT,
					"--plugin-runtime",
					runtime.activeDir,
				],
				{ ...env, ENTWURF_PLUGIN_RUNTIME: runtime.activeDir },
			),
		]);
	}
	if (selected.includes("pi")) {
		const agentSettings = path.join(roots.piAgentDir.path, "settings.json");
		const dataRoot = resolveEntwurfDataRoot(env);
		// BOTH halves. The user-scope citizen is a package registration and a provider key with
		// SEPARATE ownership records, and a foreign or corrupt package state refuses independently —
		// preflighting only the provider would let the first ledger write land on a host the package
		// writer was always going to refuse.
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
					path.join(dataRoot, "pi-package", "install-state.json"),
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
					"install",
					agentSettings,
					PACKAGE_ROOT,
					"--scope",
					"user",
					"--state",
					path.join(
						env.XDG_DATA_HOME ?? path.join(env.HOME, ".local", "share"),
						"entwurf",
						"pi-provider",
						"install-state.json",
					),
					"--plugin-runtime",
					runtime.activeDir,
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
		throw new ActivationError(
			"activation-preflight-refused",
			`${refused.map(([n]) => n).join(", ")} — zero bytes changed`,
		);
	}

	// 4. record the intention, THEN mutate, checkpointing each component as it lands.
	const states = componentStates(ledger);
	for (const backend of selected) if (states[backend] !== "active") states[backend] = "pending";
	const checkpoint = (phase) =>
		writeLedger(activation, ledgerBody({ phase, runtimeRoot: runtime.activeDir, roots, states }));
	checkpoint("activating");

	for (const backend of selected) {
		const r =
			backend === "pi"
				? run(
						"bash",
						[path.join(PACKAGE_ROOT, "run.sh"), "install-user-scope", "--plugin-runtime", runtime.activeDir],
						env,
					)
				: run("bash", [path.join(PACKAGE_ROOT, "scripts", "meta-bridge-install.sh")], {
						...env,
						ENTWURF_PLUGIN_RUNTIME: runtime.activeDir,
					});
		if (r.status !== 0) {
			process.stderr.write(`${(r.stderr || r.stdout || "").trim()}\n`);
			throw new ActivationError(
				"activation-component-failed",
				`${backend} — the ledger records how far this got and is the retry authority`,
			);
		}
		states[backend] = "active";
		checkpoint("activating");
	}
	checkpoint("active");

	process.stdout.write(
		`[herdr-plugin-activate] active: ${Object.keys(states).join(", ")} (runtime ${runtime.activeDir}, ` +
			`pi=${roots.piAgentDir.source}, claude=${roots.claudeConfigDir.source}` +
			`${plan.retained.length > 0 ? `, retained ${plan.retained.join(",")}` : ""})\n`,
	);
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
		process.exit(activate(process.env, parseBackends(process.argv.slice(2))));
	} catch (err) {
		process.stderr.write(`[herdr-plugin-activate] ${err.code ?? "activation-failed"}: ${err.detail ?? err.message}\n`);
		process.exit(1);
	}
}
