/**
 * activation-evidence — the READ-ONLY gatherer for the activation block and for the D3=C
 * runtime-bin fallback (#116 A3/A4).
 *
 * IT READS. That is the whole reason it is not in `capability-report.mjs`: it stats files and it
 * dynamic-imports one module. It still writes nothing, creates nothing, installs nothing and
 * configures nothing, and every failure it can have carries a name.
 *
 * WHOSE READER READS THE LEDGER, AND WHY IT IS NOT OURS.
 * `[측정]` `plugins/herdr/lib/build.mjs:70,113` resolve the activation verb INSIDE the installed
 * package (`<active>/node_modules/<pkg>/scripts/herdr-plugin-activate.mjs`) and the manifest says
 * why: "activate A through the INSTALLED package. Never through this checkout — Herdr deletes it
 * on uninstall". So the ledger's WRITER is the installed runtime's copy of
 * `scripts/herdr-activation.mjs`. `[측정]` `package.json` `files` ships `scripts/` and NOT
 * `plugins/`, so the pane and the writer are two different artifacts that can carry two different
 * `ACTIVATION_SCHEMA_VERSION`s. A checkout-side parser would therefore report a NEWER installed
 * runtime's ledger as `activation-ledger-uncertified` on a perfectly healthy host — a false red of
 * exactly the family this pane exists to stop telling. So the reader we call is the writer's own.
 *
 * WHERE IT LOOKS IS THE WRITER'S ANSWER, NOT OURS. `[측정]` `scripts/herdr-activation.mjs:85-96`
 * puts the ledger under XDG **state**; `scripts/herdr-runtime.mjs:221-242` installs the runtime
 * under XDG **data**. Those are two different roots on every host, so the ledger's address comes
 * from the writer's own `resolveActivationLayout(env)` and never from the runtime layout. That is
 * not the same crossing as the one above: LOCATION is a pure function of the environment and is not
 * schema-versioned, while CERTIFICATION is — which is exactly why the first may be answered by the
 * checkout's copy of the contract and the second may not. Measured before this split existed: with
 * the ledger addressed at the runtime's data root, a correctly activated host found no file, the
 * writer's reader answered `null`, and the pane died on that null before drawing one block.
 *
 * AND THE CIRCLE IS BROKEN BY DERIVATION, NOT BY A SECOND READER. Locating that reader must not
 * require reading the ledger first. It does not: the stable active root comes from
 * `resolveRuntimeLayout(env)`, which is a pure function of XDG/HOME, and the package directory
 * name comes from the plugin's own committed `runtime-lock.json` — the declared acquisition
 * authority, not a caller input and not a ledger field. `ledger.runtimeRoot` is therefore never a
 * LOCATOR here; it is a CROSS-CHECK against the root we derived independently, and a disagreement
 * is a named red rather than a silent follow.
 *
 * THE STATE MACHINE, AND EVERY ARM IS NAMED:
 *   activation-env-root-unresolvable a user root a layout needs could not be resolved — with HOME
 *                                   unset, each of XDG_DATA_HOME, XDG_CACHE_HOME and
 *                                   XDG_STATE_HOME has to stand on its own, and the thrown detail
 *                                   names which one did not. Red: we cannot say where to look.
 *   absent                          no ledger AND no runtime — a host that never activated. NOT red.
 *   activation-ledger-missing       a runtime stands there and no ledger describes it (a partial
 *                                   install, a finished teardown, or a file removed under us). Red,
 *                                   and NOT a crash. Decided BEFORE the reader hunt: the address is
 *                                   a pure function of the environment, so no installed artifact is
 *                                   needed to know nothing was ever written here.
 *   activation-reader-unavailable   a ledger EXISTS but the installed reader is missing, will not
 *                                   import, or carries no `readCertifiedLedger` export. Red: we
 *                                   hold a receipt we cannot read.
 *   activation-ledger-uncertified   the reader itself refused the body. Red, with its reason.
 *   activation-runtime-root-mismatch certified, but it describes a runtime root that is not the one
 *                                   this host derives. Red: the receipt is about somewhere else.
 *   runtime-bin-missing             certified, aligned and `active`, but `node_modules/.bin/entwurf`
 *                                   is absent or not executable. Red: the promise is gone.
 *   ledger + activation-phase-not-active  certified and aligned, but the phase is `activating` or
 *                                   `deactivating`. NOT red — it is a true install-time receipt and
 *                                   is reported as one — but it carries NO fallback binary. An
 *                                   add-only record written mid-transaction says what was wired, not
 *                                   what is standing there now, and only `active` claims both.
 *   ledger                          certified, aligned, `active`, and the bin is executable. Only
 *                                   here does a fallback binary exist.
 * There is no arm that throws past the caller and none that returns undefined. A crash and a silent
 * skip are the two outcomes this leaf may not have.
 */

import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

/**
 * Where a host's runtime and ledger live, from the environment alone — and from TWO contracts,
 * because they are two different roots. The runtime tree is the runtime layout's; the ledger is the
 * writer's, asked of the writer's own resolver so this leaf owns no copy of that decision.
 */
export function deriveRoots(env, { runtimeModule, activationModule }) {
	const layout = runtimeModule.resolveRuntimeLayout(env);
	const activation = activationModule.resolveActivationLayout(env);
	return Object.freeze({
		activeDir: layout.activeDir,
		ledgerPath: activation.ledgerPath,
	});
}

/** Is this path a real, executable regular file? A dangling symlink is not "present". */
function isExecutableFile(p) {
	try {
		if (!fs.statSync(p).isFile()) return false;
		fs.accessSync(p, fs.constants.X_OK);
		return true;
	} catch {
		return false;
	}
}

const exists = (p) => fs.existsSync(p);

/**
 * Gather the activation evidence for this host.
 *
 * @param env        the process environment (the ONLY input that decides where we look)
 * @param deps.runtimeModule     the checkout's `scripts/herdr-runtime.mjs` (layout + lock reader)
 * @param deps.activationModule  the checkout's `scripts/herdr-activation.mjs`, asked WHERE the
 *                               ledger lives and nothing else — its body is certified by the
 *                               installed runtime's copy, never by this one
 * @param deps.pluginDir      the checkout plugin dir holding `runtime-lock.json`
 * @param deps.importModule   seam for the dynamic import, so a gate can drive every arm
 */
export async function gatherActivationEvidence(env, deps) {
	const { runtimeModule, activationModule, pluginDir, importModule = (u) => import(u) } = deps;
	// Both resolvers refuse an environment with no user root, by design. That refusal is a fact
	// about the host and this surface has to be able to SAY it; letting it throw past the caller
	// replaced four blocks with an unhandled rejection.
	let roots;
	try {
		roots = deriveRoots(env, { runtimeModule, activationModule });
	} catch (err) {
		return Object.freeze({
			kind: "error",
			code: "activation-env-root-unresolvable",
			detail: err?.detail ?? err?.message ?? String(err),
			derivedRuntimeRoot: null,
			runtimeBin: null,
		});
	}
	const ledgerPresent = exists(roots.ledgerPath);
	const runtimePresent = exists(roots.activeDir);

	// A host that never activated. Not an error, and it must not be dressed as one.
	if (!ledgerPresent && !runtimePresent) {
		return Object.freeze({
			kind: "absent",
			code: "activation-absent",
			detail: `no ledger at ${roots.ledgerPath} and no runtime at ${roots.activeDir}`,
			derivedRuntimeRoot: roots.activeDir,
			runtimeBin: null,
		});
	}

	// A MISSING LEDGER IS DECIDED HERE, BEFORE ANY READER IS LOOKED FOR. Its address is a pure
	// function of the environment, so "nothing ever wrote a receipt here" needs no installed
	// artifact to establish — and deciding it after the reader hunt would answer a host whose only
	// real fact is an absent ledger with `activation-reader-unavailable`, which names a repair
	// (reinstall the runtime) that is not the one it needs.
	if (!ledgerPresent) {
		return Object.freeze({
			kind: "error",
			code: "activation-ledger-missing",
			detail: `a runtime stands at ${roots.activeDir} but no ledger at ${roots.ledgerPath} describes it`,
			derivedRuntimeRoot: roots.activeDir,
			runtimeBin: null,
		});
	}

	// The package directory name comes from the committed lock — the plugin's declared acquisition
	// authority. Never from the ledger (that would be the circle) and never from a caller.
	let packageName;
	try {
		packageName = runtimeModule.readRuntimeLock(pluginDir).name;
	} catch (err) {
		return Object.freeze({
			kind: "error",
			code: "activation-reader-unavailable",
			detail: `runtime lock unreadable, so the installed reader cannot be located: ${err?.message ?? String(err)}`,
			derivedRuntimeRoot: roots.activeDir,
			runtimeBin: null,
		});
	}

	const readerPath = path.join(roots.activeDir, "node_modules", packageName, "scripts", "herdr-activation.mjs");
	let reader;
	try {
		if (!fs.statSync(readerPath).isFile()) throw new Error(`${readerPath} is not a regular file`);
		reader = await importModule(pathToFileURL(readerPath).href);
	} catch (err) {
		return Object.freeze({
			kind: "error",
			code: "activation-reader-unavailable",
			detail: `${readerPath}: ${err?.message ?? String(err)}`,
			derivedRuntimeRoot: roots.activeDir,
			runtimeBin: null,
		});
	}

	// AN IMPORT THAT SUCCEEDS IS NOT A READER. A module can load perfectly and carry none of the
	// export this leaf calls — a partial or mismatched install, exactly the shape the arm above
	// exists for. Without this check that is a TypeError raised inside the certification try, and
	// it would be filed as "the writer's reader refused this body" when no body was ever read:
	// two different repairs behind one name.
	if (typeof reader.readCertifiedLedger !== "function") {
		return Object.freeze({
			kind: "error",
			code: "activation-reader-unavailable",
			detail: `${readerPath} imported, but it exports no \`readCertifiedLedger\` function`,
			derivedRuntimeRoot: roots.activeDir,
			runtimeBin: null,
		});
	}

	let ledger;
	try {
		ledger = reader.readCertifiedLedger({ stateRoot: path.dirname(roots.ledgerPath), ledgerPath: roots.ledgerPath });
	} catch (err) {
		return Object.freeze({
			kind: "error",
			code: "activation-ledger-uncertified",
			detail: `${roots.ledgerPath}: ${err?.detail ?? err?.message ?? String(err)}`,
			derivedRuntimeRoot: roots.activeDir,
			runtimeBin: null,
		});
	}

	// THE SAME ANSWER, AS A BACKSTOP. The reader returns `null` for a ledger that is gone
	// (herdr-activation.mjs:159-162). The arm above already decided the ordinary case; what is left
	// here is the race — a ledger removed between that check and this read — and reading through
	// the null is what turned this leaf's one job into a stack trace. No deterministic cell can
	// stage that race, so this guard is carried by the contract rather than by a mutant.
	if (ledger === null) {
		return Object.freeze({
			kind: "error",
			code: "activation-ledger-missing",
			detail: `a runtime stands at ${roots.activeDir} but no ledger at ${roots.ledgerPath} describes it`,
			derivedRuntimeRoot: roots.activeDir,
			runtimeBin: null,
		});
	}

	// CROSS-CHECK, not a locator: the ledger says which root it describes, and we already know
	// which root this host has. Following the ledger's answer instead would let a receipt about
	// another tree point this pane at a binary nobody on this host installed.
	if (ledger.runtimeRoot !== roots.activeDir) {
		return Object.freeze({
			kind: "error",
			code: "activation-runtime-root-mismatch",
			detail: `the certified ledger describes ${ledger.runtimeRoot}, but this host derives ${roots.activeDir}`,
			derivedRuntimeRoot: roots.activeDir,
			runtimeBin: null,
		});
	}

	// PHASE DECIDES WHETHER THIS RECEIPT MAY BE SPENT. `activating` never checkpointed and
	// `deactivating` is a teardown in flight; both are certified, both are true, and neither is a
	// statement that a runtime is standing there ready to answer. The block still reports them —
	// refusing to render a true receipt would be its own kind of silence — but no binary comes out.
	if (ledger.phase !== "active") {
		return Object.freeze({
			kind: "ledger",
			code: "activation-phase-not-active",
			detail: `the ledger's phase is \`${ledger.phase}\`, so it records wiring in flight rather than a runtime standing ready; only \`active\` supplies a fallback binary`,
			ledger,
			derivedRuntimeRoot: roots.activeDir,
			runtimeBin: null,
		});
	}

	const bin = path.join(roots.activeDir, "node_modules", ".bin", "entwurf");
	if (!isExecutableFile(bin)) {
		return Object.freeze({
			kind: "error",
			code: "runtime-bin-missing",
			detail: `${bin} is absent or not executable, so the certified runtime cannot answer`,
			derivedRuntimeRoot: roots.activeDir,
			runtimeBin: null,
		});
	}

	return Object.freeze({
		kind: "ledger",
		code: null,
		detail: null,
		ledger,
		derivedRuntimeRoot: roots.activeDir,
		runtimeBin: bin,
	});
}
