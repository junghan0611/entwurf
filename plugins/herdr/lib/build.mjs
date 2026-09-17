#!/usr/bin/env node
/**
 * The plugin's ONE build runner — what Herdr's `[[build]]` calls, and the only thing it calls
 * (#116 M3-b3 E).
 *
 * WHAT IT COMPOSES, IN THIS ORDER, AND WHY THE ORDER IS THE CONTRACT:
 *   1. read Herdr's own `integration status` — the source of set H, prose only, exit 0 always;
 *   2. hand that listing to the pure profile leaf, which yields `A = E ∩ H ∩ P`;
 *   2b. ask the ACTIVATION AUTHORITY before touching anything — see `certifyActivationPlan` below;
 *   3. a selected atom Herdr calls `outdated` / `needs repair`, or a row that is malformed, is a
 *      NAMED FAILURE HERE — before any runtime work. Those are not absence: `outdated (legacy < vN)`
 *      is also what an empty or unreadable integration file looks like (measured 2026-09-16), so
 *      treating it as "skip" would install a runtime for a harness whose integration cannot run it;
 *   4. `A` empty is a clean exit 0 that writes NOTHING — no runtime, no wiring, and above all no
 *      removal. A Herdr user who has neither Pi nor Claude integrated asked for nothing, and a
 *      plugin that tore something down on that basis would be acting on an absence;
 *   5. bootstrap the Entwurf-owned runtime for the committed lock source;
 *   6. activate `A` THROUGH THE INSTALLED PACKAGE, never through this checkout.
 *
 * WHY STEP 6 MAY NOT FALL BACK TO THE CHECKOUT. Herdr deletes this checkout on uninstall and calls
 * no cleanup hook. An activation performed by checkout code would be undoable only by code that is
 * about to vanish — and, worse, it would prove nothing about the artifact just installed. So the
 * activation entry is resolved UNDER the stable active runtime, its absence is a named refusal, and
 * its capability is probed with a zero-write call whose named refusal is the evidence: if the
 * installed verb cannot even refuse an empty backend list by name, it is not the verb we think it is.
 *
 * WHY THIS FILE DOES NOT SHIP. A build runs in the checkout, always, so this belongs to the
 * checkout half of the plugin. Everything that must outlive the checkout — the runtime owner, the
 * ledger, the teardown — lives in `scripts/` and is imported from there. Nothing is duplicated.
 *
 * WHAT IT REFUSES TO CLAIM. Herdr runs `[[build]]` BEFORE it commits the checkout and registers the
 * plugin (measured, `src/cli/plugin.rs:193-230` @ c77af189). A successful run here therefore proves
 * a runtime and an activation exist — not that Herdr finished installing. If Herdr's own commit
 * then fails, the previous registration stands and the activation it authorised REMAINS; the next
 * successful install reconciles it. That gap is named, not papered over, and it is why nothing here
 * writes a word about Herdr's registry.
 */

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
	certifyArtifactForForward,
	certifyLedgerDescribesRuntime,
	certifyPhaseForForward,
	certifyRootsAgainstLedger,
	readCertifiedLedger,
	resolveActivationLayout,
	resolveComponentRoots,
	runtimeIdentityOnDisk,
} from "../../../scripts/herdr-activation.mjs";
import {
	artifactCompleteness,
	bootstrapRuntime,
	readCertifiedJournal,
	readRuntimeLock,
	requestedArtifactIdentity,
	resolveRuntimeLayout,
	sameArtifactRequest,
} from "../../../scripts/herdr-runtime.mjs";
import { createProgressReporter } from "./build-progress.mjs";
import { buildActivationProfile } from "./integration-profile.mjs";

/** `plugins/herdr` — the manifest root, which is also Herdr's build cwd. */
export const PLUGIN_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
/** The checkout this build is running inside: the identity of a checkout-sourced runtime. */
export const CHECKOUT_ROOT = path.resolve(PLUGIN_DIR, "..", "..");
/** Where the activation verb lives INSIDE an installed package. Never resolved in the checkout. */
export const ACTIVATE_ENTRY = path.join("scripts", "herdr-plugin-activate.mjs");

/** A named refusal. Never a warning, never a partial success (AGENTS.md Hard Rule 15). */
export class HerdrBuildError extends Error {
	constructor(code, detail) {
		super(`${code}: ${detail}`);
		this.name = "HerdrBuildError";
		this.code = code;
		this.detail = detail;
	}
}

/** The one Herdr call this runner makes. Read-only, and it needs no server. */
export function buildStatusArgv() {
	return Object.freeze(["integration", "status"]);
}

/**
 * Herdr's integration listing, or a named refusal telling the two failures apart: no binary at all,
 * versus a binary that could not answer. `integration status` exits 0 in every state it can
 * describe (measured 2026-09-16 against 0.9.0), so a non-zero exit is not a verdict about a
 * harness — it means we do not have a listing, and inventing an empty one would read as "nothing is
 * integrated" and quietly activate nothing.
 */
export function readIntegrationListing(env, { herdrBin = "herdr", spawn = spawnSync } = {}) {
	const run = spawn(herdrBin, [...buildStatusArgv()], { encoding: "utf8", env });
	if (run.error) {
		throw new HerdrBuildError(
			"herdr-build-binary-missing",
			`${herdrBin} ${buildStatusArgv().join(" ")}: ${run.error.message}`,
		);
	}
	if (run.status !== 0) {
		throw new HerdrBuildError(
			"herdr-build-status-unavailable",
			`${herdrBin} ${buildStatusArgv().join(" ")} exited ${run.status}: ${(run.stderr || run.stdout || "").trim().slice(0, 300)}`,
		);
	}
	return run.stdout ?? "";
}

/** The activation verb of the INSTALLED runtime, as a real file, or a named refusal. */
export function resolveActivationEntry(activeDir, packageName) {
	const entry = path.join(activeDir, "node_modules", packageName, ACTIVATE_ENTRY);
	const stat = fs.lstatSync(entry, { throwIfNoEntry: false });
	if (stat === undefined || !stat.isFile()) {
		throw new HerdrBuildError(
			"herdr-build-activation-entry-missing",
			`${entry} is ${stat === undefined ? "absent" : "not a regular file"}; the installed runtime carries no activation verb`,
		);
	}
	return entry;
}

/**
 * Probe that the installed entry IS the activation verb, without writing a byte: called with no
 * backends it must refuse, non-zero, by the name its own contract promises. A file that exits 0 on
 * an empty request is not this verb — and that exact shape has bitten this package before, when a
 * main-module guard compared unresolved paths and every call silently exited 0.
 */
export function certifyActivationCapability(entry, env, { spawn = spawnSync, nodeBin = process.execPath } = {}) {
	const probe = spawn(nodeBin, [entry], { encoding: "utf8", env });
	const said = `${probe.stdout ?? ""}${probe.stderr ?? ""}`;
	if (probe.error || probe.status === 0 || !said.includes("activation-backend-outside-p")) {
		throw new HerdrBuildError(
			"herdr-build-activation-entry-incapable",
			`${entry} did not refuse an empty backend list by name (status=${probe.status}${probe.error ? ` error=${probe.error.message}` : ""}): ${said.trim().slice(0, 200)}`,
		);
	}
}

/**
 * What the long step is actually reaching for, in the operator's words. The `kind` discriminant
 * is the same one the acquisition dispatches on, so this cannot describe a source we would not use.
 */
function describeRequest(requested) {
	return requested.kind === "npm"
		? `${requested.name}@${requested.version} from npm`
		: `${requested.repository}#${requested.commit.slice(0, 8)} (git)`;
}

/** One line per selected atom Herdr cannot serve, for the operator who has to fix it. */
function describeEntries(entries) {
	return entries.map((e) => `${e.atom}→${e.backend} ${e.state} (${e.reason})`).join("; ");
}

/**
 * THE AUTHORITY CHECK THAT HAS TO HAPPEN BEFORE ANY RUNTIME WORK (#116 M3-b3 B1).
 *
 * The first cut of this runner bootstrapped first and let the INSTALLED activation verb refuse a
 * source switch or an illegal rebind afterwards. That produced a state nobody asked for: the stable
 * root already holding the new artifact, the ledger still naming the old one, and a non-zero exit —
 * a false failed state in which the harness wiring, which names the root rather than the version,
 * silently resolves to bytes no record accounts for. A refusal has to leave the host as it was
 * found, so every one of these questions is asked while nothing has been touched.
 *
 * IT IS NOT A SECOND IMPLEMENTATION. Every judgement here comes from the shipped activation owner —
 * the same `certifyRootsAgainstLedger`, `certifyPhaseForForward` and `certifyArtifactForForward` the
 * installed verb runs — imported, not restated. The one thing this position may ask that the
 * post-bootstrap verb may not is `certifyLedgerDescribesRuntime`: afterwards, "ledger names the old
 * artifact while the runtime is the new one" is the normal mid-rebind state.
 *
 * @returns frozen `{requested, current, ledger, disposition}` — `disposition` is `fresh` | `match` |
 *          `rebind`, and `rebind` is an INTENT, not a mutation.
 */
export function certifyActivationPlan(env, { lock, checkoutRoot, requested: requestedBackends, resolveCommit }) {
	const runtime = resolveRuntimeLayout(env);
	const activation = resolveActivationLayout(env);
	const roots = resolveComponentRoots(env);
	const requested =
		resolveCommit === undefined
			? requestedArtifactIdentity({ lock, checkoutRoot })
			: requestedArtifactIdentity({ lock, checkoutRoot, resolveCommit });
	const current = runtimeIdentityOnDisk(readCertifiedJournal(runtime));
	const ledger = readCertifiedLedger(activation);
	if (ledger !== null) {
		certifyRootsAgainstLedger(ledger, roots, runtime.activeDir);
		certifyPhaseForForward(ledger, requestedBackends);
		// Consistency of what is ALREADY there, before judging the change to it.
		certifyLedgerDescribesRuntime(ledger, current);
	}
	const disposition = certifyArtifactForForward(ledger, requested, requestedBackends);
	return Object.freeze({ requested, current, ledger, disposition });
}

/**
 * How to actually USE what was just wired, one line per activated backend.
 *
 * WHY THIS IS NOT DECORATION. The two backends are wired in ways that feel opposite from the
 * outside and neither is guessable. Claude Code gets an MCP server, so an ordinary `claude` picks
 * the tools up with nothing added. Pi gets a USER-SCOPE package registration, so the extension
 * loads in every pi session on the host — and yet a plain `pi` is still not a citizen, because
 * citizenship is argv-gated on purpose (a pi that minted a record and a socket merely by starting
 * would be deciding something the operator never asked for). `[관측: GLG, 날것 PC, 2026-09-17]`
 * from the operator's chair that difference is invisible: the install says green, `pi` starts, and
 * nothing is there. So the install says which sentence applies to which harness, once, at the end.
 *
 * It states the flag, not a launcher: what a host puts on its PATH is the operator's call and this
 * plugin writes nothing there.
 */
function usageNotes(activated) {
	const notes = [];
	if (activated.includes("pi")) {
		notes.push(
			"pi: start it as `pi --entwurf-control` to be a garden citizen — a plain `pi` loads this " +
				"extension but has no garden id, no control socket and no entwurf tools.",
		);
	}
	if (activated.includes("claude-code")) {
		notes.push("claude-code: nothing to add — an ordinary `claude` picks up the entwurf tools through MCP.");
	}
	return notes;
}

/**
 * The whole build, as one function so the gate can drive it with seams instead of a subprocess.
 *
 * @returns 0 on success or on a clean nothing-to-do; every other outcome throws a named refusal.
 */
export function runBuild(env, deps = {}) {
	const progress = deps.progress ?? createProgressReporter();
	try {
		return runBuildReported(env, deps, progress);
	} finally {
		progress.close();
	}
}

/**
 * The build proper, with the operator's progress channel already open.
 *
 * THE NARRATION IS NOT THE CONTRACT. Every `progress.step` here is a sentence about work that is
 * about to happen; not one of them decides anything, and removing them all would leave the same
 * install. They exist because herdr captures and then DISCARDS this process's streams on success
 * (`build-progress.mjs` header), so without them the operator watches a blank terminal through a
 * multi-minute `npm pack` and reasonably concludes it hung.
 */
function runBuildReported(env, deps, progress) {
	const write = deps.write ?? ((text) => process.stdout.write(text));
	const spawn = deps.spawn ?? spawnSync;
	const nodeBin = deps.nodeBin ?? process.execPath;

	progress.step("reading herdr's integration status");
	const listing = readIntegrationListing(env, deps);
	const profile = buildActivationProfile(listing);
	if (profile.fail.length > 0) {
		throw new HerdrBuildError(
			"herdr-build-selected-integration-unusable",
			`${describeEntries(profile.fail)} — Herdr cannot run these integrations, so no runtime was installed`,
		);
	}
	if (profile.activate.length === 0) {
		progress.done(`nothing to activate: ${describeEntries(profile.skip) || "no supported atom present"}`);
		write(
			`[herdr-plugin-build] nothing to activate: ${describeEntries(profile.skip) || "no supported atom present"}` +
				`${profile.observedOtherAtoms.length > 0 ? ` (observed, never planned: ${profile.observedOtherAtoms.join(",")})` : ""}\n`,
		);
		return 0;
	}

	const lock = readRuntimeLock(PLUGIN_DIR);

	// D1 — read-only authority, BEFORE the first byte of runtime work. A refusal here leaves the
	// runtime, its journal, our cache, the ledger and both harnesses' bytes exactly as found.
	progress.step(`planning activation for ${profile.activate.join(", ")}`);
	const plan = certifyActivationPlan(env, {
		lock,
		checkoutRoot: CHECKOUT_ROOT,
		requested: profile.activate,
		resolveCommit: deps.resolveCommit,
	});

	progress.step(
		`fetching and installing the Entwurf runtime from ${describeRequest(plan.requested)} — this is the long step ` +
			"(npm packs the source; expect minutes of silence)",
	);
	const bootstrapArgs = { env, lock, checkoutRoot: CHECKOUT_ROOT };
	if (deps.acquire !== undefined) bootstrapArgs.acquire = deps.acquire;
	if (deps.resolveCommit !== undefined) bootstrapArgs.resolveCommit = deps.resolveCommit;
	const result = bootstrapRuntime(bootstrapArgs);
	const layout = resolveRuntimeLayout(env);

	// D2 — what landed must be exactly what D1 was admitted for. Anything else means the source
	// moved under us between the judgement and the install, and the installed verb below would then
	// be re-judging a different artifact than the one this build was cleared to place.
	if (!sameArtifactRequest(result.journal.artifactIdentity, plan.requested)) {
		throw new HerdrBuildError(
			"herdr-build-artifact-drifted",
			`this build was admitted for ${JSON.stringify(plan.requested)} but the runtime that landed is ` +
				`${JSON.stringify(result.journal.artifactIdentity)}`,
		);
	}
	const completeness = artifactCompleteness(result.journal.artifactIdentity);
	write(
		`[herdr-plugin-build] runtime ${result.phase}${result.changed ? " (replaced)" : " (already exact)"}` +
			`${result.recovered ? ` after ${result.recovered}` : ""}: ${completeness.name}@${completeness.version} from ${lock.source} at ${layout.activeDir} (${plan.disposition})\n`,
	);

	progress.step(`checking what landed: ${completeness.name}@${completeness.version} and its activation verb`);
	const entry = resolveActivationEntry(layout.activeDir, completeness.name);
	certifyActivationCapability(entry, env, { spawn, nodeBin });
	progress.step(`wiring ${profile.activate.join(", ")} through the installed package`);
	const activated = spawn(nodeBin, [entry, ...profile.activate], {
		encoding: "utf8",
		env,
		stdio: ["ignore", "pipe", "pipe"],
	});
	if (activated.stdout) write(activated.stdout);
	if (activated.status !== 0) {
		throw new HerdrBuildError(
			"herdr-build-activation-failed",
			`${entry} ${profile.activate.join(" ")} exited ${activated.status}: ${(activated.stderr || "").trim().slice(0, 400)}`,
		);
	}
	write(
		`[herdr-plugin-build] activated ${profile.activate.join(",")} through the INSTALLED package` +
			`${profile.skip.length > 0 ? `; skipped ${describeEntries(profile.skip)}` : ""}` +
			`${profile.observedOtherAtoms.length > 0 ? `; observed, never planned: ${profile.observedOtherAtoms.join(",")}` : ""}\n`,
	);
	progress.done(
		`${completeness.name}@${completeness.version} active at ${layout.activeDir}; ${profile.activate.join(", ")} wired`,
	);
	for (const line of usageNotes(profile.activate)) progress.note(line);
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
		process.exit(runBuild(process.env));
	} catch (err) {
		process.stderr.write(`[herdr-plugin-build] ${err.code ?? "herdr-build-failed"}: ${err.detail ?? err.message}\n`);
		process.exit(1);
	}
}
