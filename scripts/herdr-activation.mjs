/**
 * herdr-activation — the ledger that records which harnesses this plugin activated, and the plan
 * that undoes it (#116 M3-b2).
 *
 * THIS FILE SHIPS, AND THAT IS THE POINT. Herdr's `plugin uninstall` deletes its managed checkout
 * and calls no cleanup hook, so everything needed to undo an activation has to be inside the npm
 * package, beside `herdr-runtime.mjs` and using its journal API rather than a second copy of it.
 *
 * ACTIVATION IS ADD-ONLY. The plugin re-evaluates `H ∩ P` on every reinstall, so `{pi}` may become
 * `{pi, claude-code}`. It may not become `{}` by the same route: a harness disappearing from Herdr's
 * integration status is not a request to tear down wiring the operator still depends on. Removal is
 * an explicit verb, and only the explicit verb.
 *
 * ROOTS ARE RESOLVED ONCE AND RECORDED. `PI_CODING_AGENT_DIR` and `CLAUDE_CONFIG_DIR` each decide
 * WHERE a component's bytes live, and the same override has to hold for the status read, the
 * install and the eventual removal. Recording the resolved value — and refusing when a later run
 * resolves a different one — is what stops an activation from being undone against the wrong host.
 *
 * PREFLIGHT-ALL OR NOTHING. A multi-component teardown that starts mutating on a promise it never
 * checked is how a Claude failure strands a Pi half. Every inverse here is asked read-only first;
 * the first mutation happens only after all of them are green.
 *
 * NOTHING IS IMPORTED LATE. The deactivate path deletes the runtime it is executing from. Measured
 * on Linux: already-loaded modules and open descriptors survive that, but a lazy `import()`
 * afterwards fails with ERR_MODULE_NOT_FOUND. So every module this path needs is a top-level static
 * import, and the gate proves there is no dynamic import to defer.
 */

import fs from "node:fs";
import path from "node:path";
import { artifactStage, certifyArtifactIdentity, sameArtifactRequest } from "./herdr-runtime.mjs";

/** Ledger format. Bump only with a reader that understands both. */
export const ACTIVATION_SCHEMA_VERSION = 2;

/** Set P, frozen. The ledger may never name anything else. */
export const ACTIVATABLE_BACKENDS = Object.freeze(["pi", "claude-code"]);

/** The exact key set a certified ledger carries. */
export const LEDGER_KEYS = Object.freeze([
	"schemaVersion",
	"phase",
	"runtimeRoot",
	"artifactIdentity",
	"piAgentDir",
	"claudeConfigDir",
	"claudeUserConfig",
	"activatedBackends",
	"components",
]);

/** The exact key set a component record carries. `state` is a value from a closed set, never prose. */
export const COMPONENT_KEYS = Object.freeze(["backend", "state"]);

/**
 * The transaction's own progress, written BEFORE each mutation and checkpointed after it.
 *
 * Without this the first cut had a hole with a receipt: a Claude inverse that succeeded and a Pi
 * inverse that then failed left the ledger saying Claude was still active, so the retry ran Claude's
 * preflight against a state file its own first run had already removed — and refused forever. A
 * transaction that cannot say how far it got is not retryable, it is just re-runnable until the
 * first partial failure.
 */
export const LEDGER_PHASES = Object.freeze(["activating", "active", "deactivating"]);

/** What a component row may say about itself. A closed set, so a reader can reason about it. */
export const COMPONENT_STATES = Object.freeze(["pending", "active", "removed"]);

/** Which component states each phase permits. A phase that contradicts its rows is not certified. */
const PHASE_ALLOWS = Object.freeze({
	activating: Object.freeze(["pending", "active"]),
	active: Object.freeze(["active"]),
	deactivating: Object.freeze(["active", "removed"]),
});

export class ActivationError extends Error {
	constructor(code, detail) {
		super(`${code}: ${detail}`);
		this.name = "ActivationError";
		this.code = code;
		this.detail = detail;
	}
}

/** Where the ledger lives: XDG state, beside nothing else of ours. */
export function resolveActivationLayout(env) {
	const home = env.HOME;
	const stateHome = env.XDG_STATE_HOME || (home ? path.join(home, ".local", "state") : null);
	if (!stateHome) {
		throw new ActivationError(
			"activation-xdg-root-unresolvable",
			"neither XDG_STATE_HOME nor HOME is set, so there is no user state root to own",
		);
	}
	const stateRoot = path.join(stateHome, "entwurf", "herdr-plugin");
	return Object.freeze({ stateRoot, ledgerPath: path.join(stateRoot, "activation.json") });
}

/**
 * Where each harness's bytes actually go. Recorded so a later run cannot undo an activation against
 * a different host, and carrying WHICH answer it was — an override or the default — because those
 * two are indistinguishable once only the path survives.
 */
export function resolveComponentRoots(env) {
	const home = env.HOME;
	if (!home) throw new ActivationError("activation-xdg-root-unresolvable", "HOME is unset");
	const piOverride = env.PI_CODING_AGENT_DIR;
	const claudeOverride = env.CLAUDE_CONFIG_DIR;
	return Object.freeze({
		piAgentDir: Object.freeze({
			path: piOverride || path.join(home, ".pi", "agent"),
			source: piOverride ? "PI_CODING_AGENT_DIR" : "default",
		}),
		claudeConfigDir: Object.freeze({
			path: claudeOverride || path.join(home, ".claude"),
			source: claudeOverride ? "CLAUDE_CONFIG_DIR" : "default",
		}),
		// The THIRD root, and the one a `CLAUDE_CONFIG_DIR`-only record silently misses: Claude's
		// user-scope MCP lives in `$HOME/.claude.json`, which the state owner derives from HOME and
		// NOT from the override (`meta-bridge-state.py` claude_root_config_path). Measured by Terra:
		// same XDG, same CLAUDE_CONFIG_DIR, HOME moved — the preflight went green and the MCP entry
		// stayed behind in the old HOME. A ledger that claims to know every component root has to
		// record this one too, or its teardown is aimed at two thirds of the install.
		claudeUserConfig: Object.freeze({ path: path.join(home, ".claude.json"), source: "HOME" }),
	});
}

function certifyRoot(where, value) {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		throw new ActivationError("activation-ledger-uncertified", `${where} is not an object`);
	}
	if (Object.keys(value).sort().join(",") !== "path,source") {
		throw new ActivationError("activation-ledger-uncertified", `${where} key set: ${Object.keys(value).sort()}`);
	}
	if (typeof value.path !== "string" || !path.isAbsolute(value.path)) {
		throw new ActivationError("activation-ledger-uncertified", `${where}.path is not an absolute path`);
	}
	if (typeof value.source !== "string" || value.source.length === 0) {
		throw new ActivationError("activation-ledger-uncertified", `${where}.source is not a name`);
	}
}

/** Ledgers are replaced, never patched: write beside, then rename. */
export function writeLedger(layout, entry) {
	fs.mkdirSync(layout.stateRoot, { recursive: true });
	const body = `${JSON.stringify({ schemaVersion: ACTIVATION_SCHEMA_VERSION, ...entry }, null, 2)}\n`;
	const tmp = `${layout.ledgerPath}.tmp`;
	fs.writeFileSync(tmp, body);
	fs.renameSync(tmp, layout.ledgerPath);
}

/**
 * The CERTIFIED ledger, or null. Nothing else may read it: an entry that cannot pass here grants no
 * authority to undo anything, and "roughly the right shape" is how a teardown ends up aimed at a
 * host it was never describing.
 */
export function readCertifiedLedger(layout) {
	let raw;
	try {
		raw = fs.readFileSync(layout.ledgerPath, "utf8");
	} catch (err) {
		if (err.code === "ENOENT") return null;
		throw new ActivationError("activation-ledger-uncertified", `${layout.ledgerPath}: ${err.message}`);
	}
	let parsed;
	try {
		parsed = JSON.parse(raw);
	} catch (err) {
		throw new ActivationError("activation-ledger-uncertified", `${layout.ledgerPath}: ${err.message}`);
	}
	if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
		throw new ActivationError("activation-ledger-uncertified", `${layout.ledgerPath} is not a JSON object`);
	}
	if (Object.keys(parsed).sort().join(",") !== [...LEDGER_KEYS].sort().join(",")) {
		throw new ActivationError("activation-ledger-uncertified", `key set: ${Object.keys(parsed).sort()}`);
	}
	if (parsed.schemaVersion !== ACTIVATION_SCHEMA_VERSION) {
		throw new ActivationError("activation-ledger-uncertified", `schemaVersion ${parsed.schemaVersion}`);
	}
	if (typeof parsed.runtimeRoot !== "string" || !path.isAbsolute(parsed.runtimeRoot)) {
		throw new ActivationError("activation-ledger-uncertified", "runtimeRoot is not an absolute path");
	}
	// The SAME union and the SAME certifier the runtime journal uses — imported, not re-implemented.
	// A ledger that recorded the artifact in its own words could disagree with the journal about
	// which runtime the wiring below it names, and nothing would be able to say which one was right.
	// A READY shape only: the ledger describes an activation against an artifact that was observed.
	try {
		certifyArtifactIdentity("artifactIdentity", parsed.artifactIdentity, "ready");
	} catch (err) {
		throw new ActivationError("activation-ledger-uncertified", `artifactIdentity: ${err.detail ?? err.message}`);
	}
	certifyRoot("piAgentDir", parsed.piAgentDir);
	certifyRoot("claudeConfigDir", parsed.claudeConfigDir);
	certifyRoot("claudeUserConfig", parsed.claudeUserConfig);
	if (!LEDGER_PHASES.includes(parsed.phase)) {
		throw new ActivationError("activation-ledger-uncertified", `phase ${JSON.stringify(parsed.phase)}`);
	}
	if (!Array.isArray(parsed.activatedBackends) || !Array.isArray(parsed.components)) {
		throw new ActivationError("activation-ledger-uncertified", "activatedBackends/components are not arrays");
	}
	for (const backend of parsed.activatedBackends) {
		if (!ACTIVATABLE_BACKENDS.includes(backend)) {
			throw new ActivationError("activation-ledger-backend-outside-p", `${JSON.stringify(backend)}`);
		}
	}
	// CANONICAL: P's own order, no duplicates. Two spellings of the same set would be two ledgers
	// that mean the same thing and compare differently, and every later decision compares them.
	const canonical = ACTIVATABLE_BACKENDS.filter((b) => parsed.activatedBackends.includes(b));
	if (parsed.activatedBackends.join(",") !== canonical.join(",")) {
		throw new ActivationError(
			"activation-ledger-uncertified",
			`activatedBackends is not canonical/unique: ${JSON.stringify(parsed.activatedBackends)}`,
		);
	}
	const seen = new Set();
	for (const component of parsed.components) {
		if (typeof component !== "object" || component === null || Array.isArray(component)) {
			throw new ActivationError("activation-ledger-uncertified", "a component is not an object");
		}
		if (Object.keys(component).sort().join(",") !== [...COMPONENT_KEYS].sort().join(",")) {
			throw new ActivationError("activation-ledger-uncertified", `component key set: ${Object.keys(component).sort()}`);
		}
		if (!ACTIVATABLE_BACKENDS.includes(component.backend)) {
			throw new ActivationError("activation-ledger-backend-outside-p", `${JSON.stringify(component.backend)}`);
		}
		if (seen.has(component.backend)) {
			throw new ActivationError("activation-ledger-uncertified", `duplicate component ${component.backend}`);
		}
		seen.add(component.backend);
		if (!COMPONENT_STATES.includes(component.state)) {
			throw new ActivationError("activation-ledger-uncertified", `component state ${JSON.stringify(component.state)}`);
		}
		if (!PHASE_ALLOWS[parsed.phase].includes(component.state)) {
			throw new ActivationError(
				"activation-ledger-phase-contradiction",
				`phase ${parsed.phase} does not allow component ${component.backend} in state ${component.state}`,
			);
		}
	}
	// EXACTLY the backends it claims: no component without a backend, no backend without a row.
	if (canonical.join(",") !== ACTIVATABLE_BACKENDS.filter((b) => seen.has(b)).join(",")) {
		throw new ActivationError(
			"activation-ledger-uncertified",
			`activatedBackends ${JSON.stringify(parsed.activatedBackends)} and components ${JSON.stringify([...seen])} disagree`,
		);
	}
	return Object.freeze(parsed);
}

/**
 * Refuse before the first byte when the ledger and this host's environment disagree about where a
 * component's bytes live. An activation recorded under an override and re-run without it is not the
 * same host, and treating it as one is how an inverse edits somebody else's config.
 */
export function certifyRootsAgainstLedger(ledger, roots, runtimeRoot) {
	if (ledger === null) return;
	const mismatches = [];
	if (ledger.runtimeRoot !== runtimeRoot) mismatches.push(`runtimeRoot ${ledger.runtimeRoot} != ${runtimeRoot}`);
	// BOTH halves: an activation recorded under an explicit override and re-run where the same path
	// happens to be the default is not the same host decision, and the next upgrade of either side
	// moves only one of them.
	for (const name of ["piAgentDir", "claudeConfigDir", "claudeUserConfig"]) {
		for (const field of ["path", "source"]) {
			if (ledger[name][field] !== roots[name][field]) {
				mismatches.push(`${name}.${field} ${ledger[name][field]} != ${roots[name][field]}`);
			}
		}
	}
	if (mismatches.length > 0) {
		throw new ActivationError("activation-roots-drifted", mismatches.join("; "));
	}
}

/**
 * Which ledger phases each verb may act on, and why the other ones are refused.
 *
 * A forward run over a `deactivating` ledger would re-wire components a teardown is midway through
 * removing, and the teardown's own record of where it stopped would be gone. A teardown over an
 * `activating` ledger would skip the components still `pending` — they are not `active`, so the plan
 * has no step for them — and then delete the runtime, leaving partial wiring that names an address
 * with nothing at it. Both are refused by name and told which verb to run instead.
 */
export function certifyPhaseForForward(ledger, requested) {
	if (ledger === null) return;
	if (ledger.phase === "deactivating") {
		throw new ActivationError(
			"activation-phase-refused",
			"this ledger is mid-teardown; finish or retry `herdr-plugin-deactivate` before activating again",
		);
	}
	if (ledger.phase === "activating") {
		// A retry is welcome — that is what the phase is for — but only for the SAME work. A request
		// that drops a backend left `pending` would strand it: half-wired, and no longer in any record.
		const abandoned = ledger.components
			.filter((c) => c.state === "pending" && !requested.includes(c.backend))
			.map((c) => c.backend);
		if (abandoned.length > 0) {
			// The advice names a path that EXISTS. "deactivate first" would not: the inverse refuses an
			// `activating` ledger for its own reason (it has no step for a pending component and would
			// remove the runtime their half-written wiring names), so telling an operator to run it
			// here would hand them a loop between two refusals.
			throw new ActivationError(
				"activation-phase-refused",
				`a previous activation left ${abandoned.join(", ")} pending; retry this verb with every pending backend ` +
					`included (${[...new Set([...requested, ...abandoned])].sort().join(" ")}), or repair that activation by hand first`,
			);
		}
	}
}

/**
 * Does the ledger describe the runtime that is ACTUALLY standing at the root right now?
 *
 * This is the pre-change consistency question, and it is asked BEFORE anything is installed (#116
 * M3-b3 B1). If the ledger names one artifact and the journal says a different one is at the
 * address, then some earlier run replaced the bytes without rebinding the record — and a build that
 * proceeded would be layering a third artifact on top of a disagreement it did not cause and cannot
 * resolve. That refusal has to happen while the host is still exactly as it was found.
 *
 * IT MUST NOT BE ASKED AFTER A BOOTSTRAP. Once the swap has happened, "ledger names the old
 * artifact, runtime is the new one" is the NORMAL mid-rebind state — the very state the single
 * atomic checkpoint exists to close. So this function has exactly one caller position: the
 * read-only authority check that runs before the runtime is touched.
 *
 * @param current the READY identity describing what is at the active root, or null when nothing does.
 */
export function certifyLedgerDescribesRuntime(ledger, current) {
	if (ledger === null) return;
	if (current === null) {
		throw new ActivationError(
			"activation-runtime-ledger-mismatch",
			`this ledger records an activation against ${JSON.stringify(ledger.artifactIdentity)} but no certified journal ` +
				`describes what is standing at ${ledger.runtimeRoot}; run \`herdr-plugin-deactivate\` (or repair that runtime) ` +
				"before installing over a state nothing accounts for",
		);
	}
	if (!sameArtifactRequest(ledger.artifactIdentity, current)) {
		throw new ActivationError(
			"activation-runtime-ledger-mismatch",
			`the ledger was recorded against ${JSON.stringify(ledger.artifactIdentity)} while the runtime at ` +
				`${ledger.runtimeRoot} is ${JSON.stringify(current)} — an earlier run replaced the bytes without rebinding ` +
				"the record, and this build may not stack a third artifact on that disagreement",
		);
	}
}

/**
 * The READY identity that describes what is at the active root, or null when nothing does.
 *
 * A `runtime-ready` journal describes itself. An `installing` or `removing` entry describes an
 * intention, so what is actually standing there is the carried `previousRuntime` — which is exactly
 * why that field is carried at all.
 */
export function runtimeIdentityOnDisk(journal) {
	if (journal === null) return null;
	if (journal.phase === "runtime-ready") return journal.artifactIdentity;
	if (artifactStage(journal.artifactIdentity) === "ready" && journal.previousRuntime === null) {
		return journal.artifactIdentity;
	}
	return journal.previousRuntime;
}

/**
 * Does the ledger already describe the artifact this activation is being pointed at — and if not,
 * may this run REBIND it (#116 M3-b3 C)?
 *
 * The question exists because the runtime address is stable while the artifact at it is not. A
 * reinstall can legitimately replace the bytes under the same root: same source, new commit. The
 * wiring does not change (it names the root, not the version), but the ledger's claim about WHICH
 * artifact it activated does, and a ledger that keeps naming the previous commit is a teardown and
 * a doctor aimed at an artifact that is no longer there.
 *
 * ONE function, TWO call positions, and that is deliberate. Before a bootstrap the `target` is the
 * identity this build INTENDS to install (a requested shape); after a bootstrap it is the identity
 * now standing at the root (a ready shape). `sameArtifactRequest` reads only the anchor fields both
 * shapes carry — kind plus commit, or kind plus name/version/integrity — so the same gate answers
 * the same question at both points, and a build cannot be admitted by one and refused by the other.
 *
 * WHAT IS REFUSED, AND WHY EACH ONE:
 *   - a SOURCE change (npm ⇄ herdr-checkout) is not a reinstall, it is a different acquisition
 *     authority taking over an existing activation. It needs the operator's explicit teardown, not
 *     an inference made mid-build.
 *   - a ledger that is not `active` is a transaction somebody else is in the middle of. Rebinding
 *     over it would overwrite the only record of how far that run got.
 *   - a component that is not `active` is half-wired; rebinding would relabel it as belonging to the
 *     new artifact without anyone having pointed it there.
 *   - a request that DROPS a backend the ledger holds would leave that backend's wiring attached to
 *     an artifact no record names. Add-only is preserved by requiring a superset, not by silently
 *     rebinding the rest.
 *
 * @returns `"fresh"` (no ledger) | `"match"` (already this artifact) | `"rebind"` (legal, and the
 *          caller must perform it in ONE atomic ledger write before any mutation).
 */
export function certifyArtifactForForward(ledger, target, requested) {
	if (ledger === null) return "fresh";
	if (sameArtifactRequest(ledger.artifactIdentity, target)) return "match";
	if (ledger.artifactIdentity.kind !== target.kind) {
		throw new ActivationError(
			"activation-artifact-source-drifted",
			`this activation was recorded against a ${ledger.artifactIdentity.kind} artifact and the one it is being ` +
				`pointed at for ${ledger.runtimeRoot} is ${target.kind}; run \`herdr-plugin-deactivate\` and activate again ` +
				"rather than letting one acquisition source inherit the other's activation",
		);
	}
	if (ledger.phase !== "active") {
		throw new ActivationError(
			"activation-rebind-refused",
			`the artifact this activation would name is changing but the ledger is ${ledger.phase}; finish or retry that ` +
				"transaction first — rebinding over it would discard its record of how far it got",
		);
	}
	const unsettled = ledger.components.filter((c) => c.state !== "active").map((c) => `${c.backend}=${c.state}`);
	if (unsettled.length > 0) {
		throw new ActivationError(
			"activation-rebind-refused",
			`the artifact this activation would name is changing but ${unsettled.join(", ")} is not active; a half-wired ` +
				"component may not be relabelled as belonging to the new artifact",
		);
	}
	const dropped = ledger.activatedBackends.filter((b) => !requested.includes(b));
	if (dropped.length > 0) {
		throw new ActivationError(
			"activation-rebind-refused",
			`the artifact this activation would name is changing but this request omits ${dropped.join(", ")}, whose wiring ` +
				`names that same root; retry with every activated backend included (${[...new Set([...requested, ...ledger.activatedBackends])].sort().join(" ")})`,
		);
	}
	return "rebind";
}

export function certifyPhaseForInverse(ledger) {
	if (ledger === null) return;
	if (ledger.phase === "activating") {
		throw new ActivationError(
			"activation-phase-refused",
			"this ledger is mid-activation with components still pending; retry or repair the activation first — " +
				"tearing down now would skip them and then remove the runtime their wiring names",
		);
	}
}

/**
 * What an activation should do, given what is already recorded. ADD-ONLY: a backend the ledger
 * already holds is reconciled, a new one in `H ∩ P` is added, and one that has DISAPPEARED from the
 * request is left exactly where it is. Anything outside P never enters the plan at all.
 */
export function planActivation({ ledger, requested }) {
	const outside = requested.filter((b) => !ACTIVATABLE_BACKENDS.includes(b));
	if (outside.length > 0) {
		throw new ActivationError("activation-backend-outside-p", `${JSON.stringify(outside)}`);
	}
	const already = ledger === null ? [] : ledger.activatedBackends;
	const reconcile = ACTIVATABLE_BACKENDS.filter((b) => already.includes(b) && requested.includes(b));
	const add = ACTIVATABLE_BACKENDS.filter((b) => !already.includes(b) && requested.includes(b));
	const retained = ACTIVATABLE_BACKENDS.filter((b) => already.includes(b) && !requested.includes(b));
	return Object.freeze({
		reconcile: Object.freeze(reconcile),
		add: Object.freeze(add),
		// NOT "remove". A harness that left H is not a request to tear down wiring.
		retained: Object.freeze(retained),
		resulting: Object.freeze(ACTIVATABLE_BACKENDS.filter((b) => already.includes(b) || requested.includes(b))),
	});
}

/**
 * `$XDG_DATA_HOME/entwurf`, resolved the SAME way `run.sh` and the runtime owner resolve it. The
 * first cut used `env.XDG_DATA_HOME || ""`, which on a host with XDG unset built a path rooted at
 * `/entwurf/...` while every writer used `$HOME/.local/share/entwurf` — a preflight that looked at
 * a file nobody writes and passed for the wrong reason.
 */
export function resolveEntwurfDataRoot(env) {
	const home = env.HOME;
	const dataHome = env.XDG_DATA_HOME || (home ? path.join(home, ".local", "share") : null);
	if (!dataHome) {
		throw new ActivationError("activation-xdg-root-unresolvable", "neither XDG_DATA_HOME nor HOME is set");
	}
	return path.join(dataHome, "entwurf");
}

/** The two Pi ownership records the inverse is admitted by. */
export function piStatePaths(env) {
	const root = resolveEntwurfDataRoot(env);
	return Object.freeze({
		packageState: path.join(root, "pi-package", "install-state.json"),
		providerState: path.join(root, "pi-provider", "install-state.json"),
	});
}

/** A component row, in the one shape the certifier accepts. */
export function componentRow(backend, state) {
	return Object.freeze({ backend, state });
}

/** A whole ledger body, canonical by construction. */
export function ledgerBody({ phase, runtimeRoot, artifactIdentity, roots, states }) {
	const backends = ACTIVATABLE_BACKENDS.filter((b) => Object.hasOwn(states, b));
	return {
		phase,
		runtimeRoot,
		artifactIdentity,
		piAgentDir: roots.piAgentDir,
		claudeConfigDir: roots.claudeConfigDir,
		claudeUserConfig: roots.claudeUserConfig,
		activatedBackends: backends,
		components: backends.map((b) => componentRow(b, states[b])),
	};
}

/** The component states a ledger currently records, as a plain map. */
export function componentStates(ledger) {
	const states = {};
	if (ledger !== null) for (const c of ledger.components) states[c.backend] = c.state;
	return states;
}

/**
 * The order a teardown must follow, and — on a RETRY — what is left of it. A component already
 * recorded `removed` is skipped rather than re-run: its inverse has no state left to be admitted by,
 * so re-running it is a permanent refusal, which is exactly how the first cut got stuck.
 */
export function planDeactivation(ledger) {
	if (ledger === null) {
		throw new ActivationError("activation-ledger-absent", "there is no certified activation to undo");
	}
	const states = componentStates(ledger);
	const steps = [];
	// Components first, most-dependent last: both harnesses' wiring NAMES the runtime, so they must
	// be gone before the thing they name.
	for (const backend of ["claude-code", "pi"]) {
		if (states[backend] === "active") steps.push(backend);
	}
	steps.push("runtime");
	// The ledger is the retry authority, so it is retired after everything it authorised.
	steps.push("ledger");
	return Object.freeze(steps);
}
