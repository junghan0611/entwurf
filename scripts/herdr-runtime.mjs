/**
 * herdr-runtime — the Entwurf-owned runtime the Herdr plugin installs against (#116 M3-b1/b2).
 *
 * THIS FILE IS THE ONE OWNER, AND IT SHIPS. Herdr's `plugin uninstall` deletes its managed checkout
 * and calls no cleanup hook, so anything that has to run AFTER that — retiring this runtime, reading
 * its journal, undoing what was activated — cannot live in `plugins/`. It lives in `scripts/`, which
 * `package.json.files` ships, and `plugins/herdr/lib/runtime-bootstrap.mjs` is a thin re-export of
 * this module. One schema, one certified reader, one inverse: a second copy under `plugins/` would
 * be the fork that lets an uninstall disagree with the install that preceded it.
 *
 * A Herdr user who has never heard of npm types one command. What has to exist afterwards is an
 * Entwurf runtime at an address that does not move, because Pi records the owner ROOT it was wired
 * with and a root that changes on every upgrade is a takeover, not an update. That address is
 * `$XDG_DATA_HOME/entwurf/herdr-plugin/runtime/active`, and it is a REAL DIRECTORY — never a
 * symlink whose canonicalisation would turn each version into a different owner root.
 *
 * WHAT IT DELIBERATELY DOES NOT DO: PUT ANYTHING ON PATH. An earlier cut exposed bare `entwurf` /
 * `entwurf-bridge` through an owned bin directory. There is no reason a fresh
 * `$XDG_DATA_HOME/…/bin` would be on a clean host's PATH, this module may not edit a shell profile,
 * and it may not write into a standard bin directory it does not own — so that exposure was
 * load-bearing on a condition nothing here can establish. It is retired. The scoped wiring one
 * slice above records ABSOLUTE commands under the stable active root instead; this module's whole
 * job is to make sure those commands exist and run.
 *
 * WHY THE TRANSACTION LOOKS LIKE THIS. Herdr runs `[[build]]` in a TEMPORARY checkout and only
 * afterwards re-reads the manifest, swaps the checkout and registers the plugin (measured
 * 2026-09-16 against herdr 0.9.0 at `c77af189`, `src/cli/plugin.rs:193-230`). So our work happens
 * BEFORE Herdr has committed anything, and Herdr's own rollback covers only its checkout. This
 * module therefore owns exactly one all-or-nothing step — replacing the active runtime — and
 * refuses to describe its success in Herdr's words. It writes `runtime-ready`. It never writes
 * `herdr-installed`, because at the moment it finishes, nobody knows whether Herdr will commit.
 *
 * OWNERSHIP IS PROVEN, NOT ASSUMED. The journal is a CERTIFIED reader's output: exact keys, exact
 * schema version, a phase from the closed set, and a `runtimeRoot` that is this host's stable
 * address. A journal that fails any of those grants no authority to delete or replace anything, and
 * neither does a missing one — a directory sitting at our address with no journal behind it belongs
 * to somebody else until proven otherwise, and this module refuses rather than renaming it away.
 *
 * DISK FACTS COME FROM lstat, AND THEY COME FIRST. `existsSync` follows links, so a dangling symlink
 * at our address reads as "absent" and a symlink to somebody else's tree reads as a directory we may
 * rename. Every one of the three runtime paths is therefore classified as `absent` / `real-dir` /
 * `symlink` / `other`, anything that is not absent-or-a-real-directory is a named refusal, and the
 * whole assessment happens BEFORE the first `mkdir` — a module that creates its own root and then
 * asks whether the root was its own has already answered the question with its own footprint.
 *
 * THE LAST GOOD RUNTIME IS NEVER THROWN AWAY. `active` beside `previous` does not mean `previous` is
 * garbage: it means a swap did not finish, and which of the two is usable is a question only
 * inspection answers. So `previous` is kept until `active` has been inspected as an installed
 * runtime, and when `active` turns out to be corrupt the backup is RESTORED over it. Deleting the
 * backup first and then failing to acquire a candidate is how a host ends a run with nothing usable
 * at all — measured on the first cut of this module, which did exactly that.
 *
 * A TORN SWAP IS A STATE, NOT A MYSTERY. `active → previous`, then `staging → active` is two
 * renames, and a process can die between them. So entry does not blindly clear leftovers: it reads
 * the combination of `active`/`staging`/`previous` against a certified journal and names what it
 * found. The one that matters most is `active` absent with a good `previous` — the crash window —
 * where the previous runtime is RESTORED first, so a candidate that then fails still leaves the
 * host with the runtime it had.
 *
 * WHY THE PACKAGE IS LOCKED TWICE, ON THE npm SOURCE. The exact `name@version` comes from the
 * checkout's own `package.json`; a sibling `runtime-lock.json` repeats it and adds the integrity npm
 * published. The two must agree, and the tarball's OWN sha512 must equal that integrity before
 * anything is installed. The journal records the expected integrity and the observed digest as
 * separate fields, because a digest computed from whatever arrived is a record of what happened —
 * calling it a pin would claim a check that only the comparison performs.
 *
 * WHY THERE IS A SECOND SOURCE, AND WHAT IT MAY NOT BECOME (#116 M3-b3). Requiring a published npm
 * version before a candidate can be installed makes every candidate a release. So the same lock
 * file carries a CLOSED discriminant, and its other branch packs the exact commit Herdr itself
 * checked out — `git+https://github.com/junghan0611/entwurf.git#<full sha>`, a literal remote and a
 * commit read from the checkout, with no URL, ref, env var or caller parameter anywhere in the path.
 * That branch is VERIFICATION-ONLY and it does not weaken the npm branch: there is no fallback
 * between them, the npm integrity comparison is untouched, and a source switch is refused rather
 * than inferred. What replaces the missing registry integrity is named where it happens — the
 * commit pins the tree, the digest records the bytes, and the installed-runtime verifier decides.
 *
 * THE PACK FORM IS PART OF THE CONTRACT. Measured 2026-09-16 (npm 11.16.0): `npm pack <git spec>`
 * runs `prepare` and NOT `prepack`, so the bridge is compiled and no global pnpm is needed, and the
 * tarball is byte-identical across three independent sandboxes including a `--depth 1` clone. `npm
 * pack <directory>` runs `prepack`, which calls `pnpm` and exits 127 on a clean host. Only the git
 * spec is built here; the directory form is structurally absent, not merely avoided.
 *
 * WHY npm's CACHE IS OURS. The acquisition names `npm_config_cache` explicitly, under the user's
 * XDG cache root, so a plugin install never writes into the operator's default npm cache. It also
 * installs with `--ignore-scripts`: a package we are placing on behalf of someone who did not ask
 * for npm must not run arbitrary install hooks in their HOME. The installed artifact therefore has
 * to work with its own scripts never run, which is why completeness is verified rather than assumed.
 *
 * WHAT THIS SLICE STILL DOES NOT DO. It does not touch the manifest, does not read Herdr
 * integration status, and does not activate or deactivate Pi or Claude Code — that is M3-b2. The
 * inverse here removes only what a certified journal proves, takes the runtime LAST among the
 * artifacts, and retires the journal after them because the ledger has to outlive what it
 * authorised.
 */

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** Journal format. Bump only with a reader that understands both. */
export const RUNTIME_SCHEMA_VERSION = 2;

/**
 * The two ways a runtime may be ACQUIRED, and they are a closed set (#116 M3-b3).
 *
 * `npm` is the production authority and its semantics are untouched: the lock names an exact
 * `name@version` plus the integrity npm published for it, and the tarball's own sha512 must equal
 * that integrity before anything is installed.
 *
 * `herdr-checkout` is the VERIFICATION-ONLY candidate carrier. A published npm version cannot be a
 * precondition for iterating on a candidate — that is a release step per candidate, which is the
 * churn this carrier exists to remove. It packs the exact commit Herdr itself just checked out, so
 * there is no URL, ref, env var or caller parameter anywhere in it: the identity is already on
 * disk. No registry integrity exists for such an artifact, so the anchor is the COMMIT, and the
 * safety is carried entirely by the final installed-runtime verifier and named refusals.
 */
export const ARTIFACT_KINDS = Object.freeze(["npm", "herdr-checkout"]);

/**
 * The ONE repository a checkout-sourced runtime may come from, as a literal. Herdr's own remote is
 * hardcoded `https://github.com/{owner}/{repo}.git` with no env override (measured 2026-09-16,
 * herdr `src/cli/plugin.rs:763` @ c77af189), so binding this side to the same literal keeps the
 * pair closed: nothing a caller says can point the acquisition at another tree.
 */
export const CHECKOUT_REPOSITORY = "junghan0611/entwurf";

/**
 * The exact key set an `artifactIdentity` carries, per kind AND per stage. Both halves are
 * load-bearing.
 *
 * PER KIND, because the two acquisitions are anchored by different facts and a union that merged
 * them would have to accept a null integrity or a null commit — a shape in which "we have not
 * observed this yet" and "this source has no such fact" are the same value.
 *
 * PER STAGE, because `installing` is written BEFORE an artifact exists. The requested shape has no
 * digest KEY at all rather than a null one: an absent key cannot be mistaken for an observation,
 * and each phase's certifier below names exactly which shape it will accept.
 *
 * `packageName`/`packageVersion` appear ONLY in the checkout-ready shape, and only as COMPLETENESS
 * evidence read off the artifact npm actually produced — what must still be sitting on disk for the
 * tree to be a usable runtime. They are never identity: two different commits can both call
 * themselves `0.21.0`, so identity for this kind is the commit and nothing else.
 */
export const ARTIFACT_KEYS = Object.freeze({
	npm: Object.freeze({
		requested: Object.freeze(["kind", "name", "version", "expectedIntegrity"]),
		ready: Object.freeze(["kind", "name", "version", "expectedIntegrity", "observedDigest"]),
	}),
	"herdr-checkout": Object.freeze({
		requested: Object.freeze(["kind", "repository", "commit"]),
		ready: Object.freeze(["kind", "repository", "commit", "packageName", "packageVersion", "observedDigest"]),
	}),
});

/**
 * The bins an installed runtime must carry for the scoped wiring above to have anything to name.
 * Measured need, not the package's whole `bin` map: `entwurf` is the operator command,
 * `entwurf-bridge` is what Pi and Claude wiring invoke, and `entwurf-statusline` is demanded by
 * `doctor-meta-bridge` (measured 2026-09-16: `FAIL statusline bin not on PATH: entwurf-statusline`).
 * The agy and Copilot helpers in the same `bin` map belong to harnesses outside this plugin's set P.
 * These are VERIFIED to exist and be executable; none of them is placed on PATH.
 */
export const REQUIRED_BINS = Object.freeze(["entwurf", "entwurf-bridge", "entwurf-statusline"]);

/**
 * The compiled entry an installed consumer must have. Measured in the 0.21.0 tarball; its presence
 * is what separates "npm put a directory there" from "the prebuilt server is installed".
 */
export const COMPILED_ENTRY = path.join("mcp", "entwurf-bridge", "dist", "mcp", "entwurf-bridge", "src", "index.js");

/**
 * Phases a journal may record. `herdr-installed` is DELIBERATELY absent — see the header.
 * `installing` is the incomplete-but-recoverable state entry reconciles.
 */
export const JOURNAL_PHASES = Object.freeze(["installing", "runtime-ready", "removing"]);

/**
 * The exact key set a certified journal carries. Extra or missing keys grant no authority.
 *
 * There is ONE identity field, and every consumer — this journal, `previousRuntime`, the torn-swap
 * carry, and the activation ledger one slice above — uses that same union through the same
 * certifier. A second string beside it ("source", "commit") would be a second authority that could
 * disagree with the first, on exactly the question the whole transaction is about.
 */
export const JOURNAL_KEYS = Object.freeze([
	"schemaVersion",
	"phase",
	"runtimeRoot",
	"artifactIdentity",
	"previousRuntime",
]);

/**
 * `previousRuntime` exists because writing the `installing` entry would otherwise OVERWRITE the only
 * record of what was running. A host that dies mid-install would then hold a backup directory and no
 * statement of what it contains — recoverable bytes with unrecoverable provenance. So the prior
 * ready entry's identity is carried forward for exactly as long as a backup can exist, and a
 * finished install sets it back to null because there is no longer a previous runtime to describe.
 * It is a READY identity or null: a backup that was never observed is not a backup anyone can name.
 */

/** How a path at one of our three addresses may look. Anything else is refused by name. */
export const PATH_KINDS = Object.freeze(["absent", "real-dir", "symlink", "other"]);

/** The lock file that sits beside the manifest. */
export const RUNTIME_LOCK_BASENAME = "runtime-lock.json";

/** A named refusal. Never a warning, never a silent default (AGENTS.md Hard Rule 15). */
export class RuntimeBootstrapError extends Error {
	constructor(code, detail) {
		super(`${code}: ${detail}`);
		this.name = "RuntimeBootstrapError";
		this.code = code;
		this.detail = detail;
	}
}

/** Every path this module may touch, derived from XDG only. No defaults invented elsewhere. */
export function resolveRuntimeLayout(env) {
	const home = env.HOME;
	const dataHome = env.XDG_DATA_HOME || (home ? path.join(home, ".local", "share") : null);
	const cacheHome = env.XDG_CACHE_HOME || (home ? path.join(home, ".cache") : null);
	if (!dataHome || !cacheHome) {
		throw new RuntimeBootstrapError(
			"runtime-xdg-root-unresolvable",
			"neither XDG_DATA_HOME/XDG_CACHE_HOME nor HOME is set, so there is no user root to own",
		);
	}
	const pluginRoot = path.join(dataHome, "entwurf", "herdr-plugin");
	const runtimeRoot = path.join(pluginRoot, "runtime");
	return Object.freeze({
		pluginRoot,
		runtimeRoot,
		activeDir: path.join(runtimeRoot, "active"),
		stagingDir: path.join(runtimeRoot, "staging"),
		previousDir: path.join(runtimeRoot, "previous"),
		journalPath: path.join(pluginRoot, "journal.json"),
		cacheDir: path.join(cacheHome, "entwurf", "herdr-plugin", "npm"),
	});
}

/** The package root this module ships in: `<root>/scripts/` is where it lives. */
export function defaultCheckoutRoot() {
	return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
}

/** `<root>/plugins/herdr` — where the manifest and the lock file live in a CHECKOUT. */
export function defaultPluginDir() {
	return path.join(defaultCheckoutRoot(), "plugins", "herdr");
}

/**
 * The ONE production package spec: the exact `name@version` of the checkout that carries this
 * plugin. Nothing here consults the environment or a flag.
 */
export function readCheckoutPackageSpec(checkoutRoot) {
	const manifestPath = path.join(checkoutRoot, "package.json");
	let parsed;
	try {
		parsed = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
	} catch (err) {
		throw new RuntimeBootstrapError("runtime-package-manifest-unreadable", `${manifestPath}: ${err.message}`);
	}
	const { name, version } = parsed;
	if (typeof name !== "string" || name.length === 0 || typeof version !== "string" || version.length === 0) {
		throw new RuntimeBootstrapError(
			"runtime-package-manifest-unreadable",
			`${manifestPath} carries no exact name/version pair`,
		);
	}
	return Object.freeze({ name, version });
}

/**
 * The plugin-owned lock, and it is a DISCRIMINATED UNION whose discriminant is committed.
 *
 * Which source a host acquires from may not be decided by an environment variable, a caller
 * argument or a fallback — all three would let the acquisition authority be chosen at runtime by
 * whoever is running, and a fallback in particular would turn "the registry is unreachable" into
 * "install something else instead" (AGENTS.md Hard Rule 5). So the selector is a field in a file
 * that travels in the checkout, and an unknown or absent `source` is a named refusal rather than a
 * default.
 *
 * `comment` is the one tolerated extra key: a lock is read by people too.
 */
export function readRuntimeLock(pluginDir) {
	const lockPath = path.join(pluginDir, RUNTIME_LOCK_BASENAME);
	let parsed;
	try {
		parsed = JSON.parse(fs.readFileSync(lockPath, "utf8"));
	} catch (err) {
		throw new RuntimeBootstrapError("runtime-lock-unreadable", `${lockPath}: ${err.message}`);
	}
	// Shape before fields. `JSON.parse` happily returns null, an array or a scalar, and reaching for
	// `.schemaVersion` on any of those leaks a native TypeError with no code — an unnamed crash where
	// the contract promises a named refusal, on the one file that says which package we install.
	if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
		throw new RuntimeBootstrapError(
			"runtime-lock-unreadable",
			`${lockPath} parsed to ${Array.isArray(parsed) ? "an array" : JSON.stringify(parsed)}, not an object`,
		);
	}
	if (parsed.schemaVersion !== RUNTIME_SCHEMA_VERSION) {
		throw new RuntimeBootstrapError(
			"runtime-lock-unreadable",
			`${lockPath} carries schemaVersion ${JSON.stringify(parsed.schemaVersion)}, not ${RUNTIME_SCHEMA_VERSION}`,
		);
	}
	if (!ARTIFACT_KINDS.includes(parsed.source)) {
		throw new RuntimeBootstrapError(
			"runtime-lock-source-unknown",
			`${lockPath} names source ${JSON.stringify(parsed.source)}; the closed set is ${JSON.stringify(ARTIFACT_KINDS)}`,
		);
	}
	const expected =
		parsed.source === "npm"
			? ["comment", "integrity", "name", "schemaVersion", "source", "version"]
			: ["comment", "repository", "schemaVersion", "source"];
	const keys = Object.keys(parsed)
		.filter((k) => k !== "comment")
		.sort();
	if (keys.join(",") !== expected.filter((k) => k !== "comment").join(",")) {
		throw new RuntimeBootstrapError(
			"runtime-lock-unreadable",
			`${lockPath} is a ${parsed.source} lock with key set ${keys.join(",")}`,
		);
	}
	if (parsed.source === "npm") {
		if (
			typeof parsed.name !== "string" ||
			typeof parsed.version !== "string" ||
			typeof parsed.integrity !== "string" ||
			!parsed.integrity.startsWith("sha512-")
		) {
			throw new RuntimeBootstrapError(
				"runtime-lock-unreadable",
				`${lockPath} is not an npm lock with an sha512 integrity`,
			);
		}
		return Object.freeze({ source: "npm", name: parsed.name, version: parsed.version, integrity: parsed.integrity });
	}
	if (parsed.repository !== CHECKOUT_REPOSITORY) {
		throw new RuntimeBootstrapError(
			"runtime-checkout-repository-foreign",
			`${lockPath} names repository ${JSON.stringify(parsed.repository)}; this plugin installs ${CHECKOUT_REPOSITORY} and nothing else`,
		);
	}
	return Object.freeze({ source: "herdr-checkout", repository: parsed.repository });
}

/** The npm lock and the checkout must name the SAME package, exactly. */
export function certifyLockCoherence(lock, checkoutSpec) {
	if (lock.name !== checkoutSpec.name || lock.version !== checkoutSpec.version) {
		throw new RuntimeBootstrapError(
			"runtime-lock-incoherent",
			`the lock names ${lock.name}@${lock.version} but this checkout is ${checkoutSpec.name}@${checkoutSpec.version}`,
		);
	}
	return Object.freeze({ name: lock.name, version: lock.version, integrity: lock.integrity });
}

/** A commit is forty lowercase hex characters. Anything else is not an anchor. */
const COMMIT_SHA = /^[0-9a-f]{40}$/;

/**
 * The canonical full SHA of the checkout this build is running inside.
 *
 * `HEAD^{commit}` is asked for deliberately: it resolves a tag or an annotated object down to the
 * commit, and `--verify` refuses an ambiguous or missing revision instead of echoing the argument
 * back. A shallow clone answers this exactly as a full one does (measured 2026-09-16 on a real
 * `--depth 1` checkout), which matters because Herdr's managed checkout IS shallow.
 */
export function resolveCheckoutCommit(checkoutRoot, { gitBin = "git", spawn = spawnSync } = {}) {
	const run = spawn(gitBin, ["-C", checkoutRoot, "rev-parse", "--verify", "HEAD^{commit}"], { encoding: "utf8" });
	if (run.error || run.status !== 0) {
		throw new RuntimeBootstrapError(
			"runtime-checkout-commit-unresolvable",
			`${gitBin} -C ${checkoutRoot} rev-parse: ${run.error ? run.error.message : `exit ${run.status}: ${(run.stderr || "").trim().slice(0, 200)}`}`,
		);
	}
	const commit = (run.stdout || "").trim();
	if (!COMMIT_SHA.test(commit)) {
		throw new RuntimeBootstrapError(
			"runtime-checkout-commit-unresolvable",
			`${checkoutRoot} resolved HEAD to ${JSON.stringify(commit)}, which is not a full 40-hex commit`,
		);
	}
	return commit;
}

/**
 * The identity a bootstrap is being ASKED for, derived from the committed lock and — for the
 * checkout source — from the checkout itself. Nothing consults the environment or a flag.
 */
export function requestedArtifactIdentity({ lock, checkoutRoot, resolveCommit = resolveCheckoutCommit }) {
	if (lock.source === "npm") {
		const locked = certifyLockCoherence(lock, readCheckoutPackageSpec(checkoutRoot));
		return certifyArtifactIdentity("requested artifact", {
			kind: "npm",
			name: locked.name,
			version: locked.version,
			expectedIntegrity: locked.integrity,
		});
	}
	return certifyArtifactIdentity("requested artifact", {
		kind: "herdr-checkout",
		repository: lock.repository,
		commit: resolveCommit(checkoutRoot),
	});
}

/** The fixed product remote. There is no other spelling, and no input reaches it. */
export function buildCheckoutRemote(repository) {
	return `git+https://github.com/${repository}.git`;
}

/**
 * `npm pack` argv for a checkout-sourced artifact, and the FORM is the contract.
 *
 * Measured 2026-09-16 on npm 11.16.0: packing a git spec runs `prepare` and NOT `prepack`, so the
 * compiled bridge is built and no global pnpm is needed. Packing the DIRECTORY instead runs
 * `prepack`, which calls `pnpm` and exits 127 on a clean host. Those are two different transactions,
 * and only this one may be the product's — a directory pack is structurally absent from this module.
 *
 * `--ignore-scripts` is deliberately NOT here. It belongs to the local-tarball install below; on a
 * pack it would skip `prepare` and produce a tarball with no compiled entry, which the installed
 * verifier then refuses by name (measured: `runtime-compiled-dist-missing`).
 */
export function buildCheckoutPackArgv(identity, packDestination) {
	return Object.freeze([
		"pack",
		`${buildCheckoutRemote(identity.repository)}#${identity.commit}`,
		"--json",
		"--pack-destination",
		packDestination,
		"--no-audit",
		"--no-fund",
	]);
}

/** `npm pack` argv for the exact spec, landing the artifact in OUR cache root. */
export function buildPackArgv(spec, packDestination) {
	return Object.freeze([
		"pack",
		`${spec.name}@${spec.version}`,
		"--json",
		"--pack-destination",
		packDestination,
		"--no-audit",
		"--no-fund",
	]);
}

/** `npm install` argv for a LOCAL tarball. `--ignore-scripts` is the load-bearing flag. */
export function buildInstallArgv(tarballPath, prefix) {
	return Object.freeze([
		"install",
		tarballPath,
		"--prefix",
		prefix,
		"--ignore-scripts",
		"--no-audit",
		"--no-fund",
		"--no-save",
	]);
}

/** The environment npm runs under: the operator's default cache is never the one we fill. */
export function npmEnvironment(env, cacheDir) {
	return Object.freeze({
		...env,
		npm_config_cache: cacheDir,
		npm_config_update_notifier: "false",
	});
}

function removeTree(target) {
	fs.rmSync(target, { recursive: true, force: true });
}

/** Journals are replaced, never patched in place: write beside, then rename. */
export function writeJournal(layout, entry) {
	if (!JOURNAL_PHASES.includes(entry.phase)) {
		throw new RuntimeBootstrapError("runtime-journal-phase-unknown", `phase ${JSON.stringify(entry.phase)}`);
	}
	// Certified on the way OUT as well as in. A journal only the writer can read is a journal that
	// strands the next process — including the teardown, which is the one that has no checkout left
	// to fall back on.
	certifyArtifactIdentity(
		"artifactIdentity",
		entry.artifactIdentity,
		entry.phase === "installing" ? "requested" : entry.phase === "runtime-ready" ? "ready" : "either",
	);
	if (entry.previousRuntime !== null) certifyArtifactIdentity("previousRuntime", entry.previousRuntime, "ready");
	fs.mkdirSync(layout.pluginRoot, { recursive: true });
	const body = `${JSON.stringify({ schemaVersion: RUNTIME_SCHEMA_VERSION, ...entry }, null, 2)}\n`;
	const tmp = `${layout.journalPath}.tmp`;
	fs.writeFileSync(tmp, body);
	fs.renameSync(tmp, layout.journalPath);
}

const SHA512 = /^sha512-[A-Za-z0-9+/]+={0,2}$/;
const SHA256 = /^sha256-[0-9a-f]{64}$/;

function isExactIdentity(value) {
	return typeof value === "string" && value.trim().length > 0 && value === value.trim();
}

/**
 * THE one certifier for an `artifactIdentity`, wherever it appears — journal entry, carried
 * `previousRuntime`, or activation ledger. Exact keys for the kind AND the stage; a shape that
 * belongs to the other kind, or to the other stage of its own kind, is a named refusal.
 *
 * @param stage `"requested"` | `"ready"` | `"either"` — which shapes the CALLER's position accepts.
 * @returns the frozen identity, so a certified value cannot be mutated after it was certified.
 */
export function certifyArtifactIdentity(where, value, stage = "either") {
	if (value === null || typeof value !== "object" || Array.isArray(value)) {
		throw new RuntimeBootstrapError(
			"runtime-artifact-identity-uncertified",
			`${where} is ${Array.isArray(value) ? "an array" : JSON.stringify(value)}, not an identity object`,
		);
	}
	if (!ARTIFACT_KINDS.includes(value.kind)) {
		throw new RuntimeBootstrapError(
			"runtime-artifact-identity-uncertified",
			`${where}.kind ${JSON.stringify(value.kind)} is outside ${JSON.stringify(ARTIFACT_KINDS)}`,
		);
	}
	const shapes = stage === "either" ? ["requested", "ready"] : [stage];
	const keys = Object.keys(value).sort().join(",");
	const matched = shapes.find((s) => keys === [...ARTIFACT_KEYS[value.kind][s]].sort().join(","));
	if (matched === undefined) {
		throw new RuntimeBootstrapError(
			"runtime-artifact-identity-uncertified",
			`${where} has key set ${keys}, which is not ${value.kind}'s ${shapes.join(" or ")} shape`,
		);
	}
	if (value.kind === "npm") {
		if (!isExactIdentity(value.name) || !isExactIdentity(value.version)) {
			throw new RuntimeBootstrapError(
				"runtime-artifact-identity-uncertified",
				`${where} carries no exact package identity`,
			);
		}
		if (!SHA512.test(value.expectedIntegrity)) {
			throw new RuntimeBootstrapError(
				"runtime-artifact-identity-uncertified",
				`${where}.expectedIntegrity ${JSON.stringify(value.expectedIntegrity)}`,
			);
		}
	} else {
		// The repo literal travels WITH the identity, and is re-checked wherever it is read: a journal
		// or ledger that names another repository describes an artifact this plugin may not have put
		// there, and inheriting it would make a foreign tree our own by transcription.
		if (value.repository !== CHECKOUT_REPOSITORY) {
			throw new RuntimeBootstrapError(
				"runtime-checkout-repository-foreign",
				`${where}.repository ${JSON.stringify(value.repository)} is not ${CHECKOUT_REPOSITORY}`,
			);
		}
		if (!COMMIT_SHA.test(value.commit)) {
			throw new RuntimeBootstrapError(
				"runtime-artifact-identity-uncertified",
				`${where}.commit ${JSON.stringify(value.commit)} is not a full 40-hex commit`,
			);
		}
		if (matched === "ready" && (!isExactIdentity(value.packageName) || !isExactIdentity(value.packageVersion))) {
			throw new RuntimeBootstrapError(
				"runtime-artifact-identity-uncertified",
				`${where} carries no exact package completeness pair`,
			);
		}
	}
	if (matched === "ready" && !SHA256.test(value.observedDigest)) {
		throw new RuntimeBootstrapError(
			"runtime-artifact-identity-uncertified",
			`${where}.observedDigest ${JSON.stringify(value.observedDigest)}`,
		);
	}
	return Object.freeze({ ...value });
}

/** Which stage a certified identity is at. Derived from its own key set, never stored twice. */
export function artifactStage(identity) {
	const keys = Object.keys(identity).sort().join(",");
	return keys === [...ARTIFACT_KEYS[identity.kind].ready].sort().join(",") ? "ready" : "requested";
}

/**
 * The ONE place that answers "what name@version must be sitting on disk for this identity". For npm
 * that is the identity itself; for a checkout it is the completeness pair observed off the artifact.
 * Every disk verification — bootstrap idempotence, recovery, activation — asks here, so there is no
 * second opinion to drift from.
 */
export function artifactCompleteness(identity) {
	if (artifactStage(identity) !== "ready") {
		throw new RuntimeBootstrapError(
			"runtime-artifact-identity-uncertified",
			`a requested ${identity.kind} identity has not observed a package yet, so it cannot say what is on disk`,
		);
	}
	return identity.kind === "npm"
		? Object.freeze({ name: identity.name, version: identity.version })
		: Object.freeze({ name: identity.packageName, version: identity.packageVersion });
}

/**
 * What the staging tree must hold, given what was asked for and what the acquisition observed.
 *
 * For npm the request itself is the answer — the registry spec IS the name@version. For a checkout
 * the artifact says what it is, and this pair is exactly what the next line checks against the
 * installed tree: an artifact whose metadata and whose installed tree disagree is refused there, by
 * `verifyInstalledRuntime`, and not smoothed over here.
 */
export function completenessOf(requested, acquired) {
	if (requested.kind === "npm") return Object.freeze({ name: requested.name, version: requested.version });
	if (!isExactIdentity(acquired?.packageName) || !isExactIdentity(acquired?.packageVersion)) {
		throw new RuntimeBootstrapError(
			"runtime-artifact-identity-uncertified",
			`a ${requested.kind} acquisition must report the packed package's exact name and version`,
		);
	}
	return Object.freeze({ name: acquired.packageName, version: acquired.packageVersion });
}

/** The READY identity of what just landed: the request, plus exactly what was observed about it. */
export function readyIdentity(requested, acquired) {
	const observed =
		requested.kind === "npm"
			? { ...requested, observedDigest: acquired.observedDigest }
			: {
					...requested,
					packageName: acquired.packageName,
					packageVersion: acquired.packageVersion,
					observedDigest: acquired.observedDigest,
				};
	return certifyArtifactIdentity("observed artifact", observed, "ready");
}

/**
 * Is a READY identity the artifact a REQUESTED identity is asking for?
 *
 * For a checkout the answer is the commit and ONLY the commit. A version string is not an identity
 * here: two commits can both call themselves `0.21.0`, so believing a version would let a stale
 * runtime satisfy a request for a new candidate — the exact silence this comparison exists to make
 * impossible.
 */
export function sameArtifactRequest(ready, requested) {
	if (ready.kind !== requested.kind) return false;
	if (ready.kind === "npm") {
		return (
			ready.name === requested.name &&
			ready.version === requested.version &&
			ready.expectedIntegrity === requested.expectedIntegrity
		);
	}
	return ready.repository === requested.repository && ready.commit === requested.commit;
}

/**
 * The CERTIFIED journal, or null when there is none. Nothing else in this module may read the
 * journal: an entry that cannot pass here — including a bare `null`, an array, a scalar, or a shape
 * that contradicts the writer state its own phase implies — grants no authority to delete, rename or
 * replace anything.
 */
export function readCertifiedJournal(layout) {
	let raw;
	try {
		raw = fs.readFileSync(layout.journalPath, "utf8");
	} catch (err) {
		if (err.code === "ENOENT") return null;
		throw new RuntimeBootstrapError("runtime-journal-uncertified", `${layout.journalPath}: ${err.message}`);
	}
	let parsed;
	try {
		parsed = JSON.parse(raw);
	} catch (err) {
		throw new RuntimeBootstrapError("runtime-journal-uncertified", `${layout.journalPath}: ${err.message}`);
	}
	if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
		throw new RuntimeBootstrapError(
			"runtime-journal-uncertified",
			`${layout.journalPath} parsed to ${Array.isArray(parsed) ? "an array" : JSON.stringify(parsed)}, not an object`,
		);
	}
	const keys = Object.keys(parsed).sort().join(",");
	if (keys !== [...JOURNAL_KEYS].sort().join(",")) {
		throw new RuntimeBootstrapError("runtime-journal-uncertified", `unexpected key set: ${keys}`);
	}
	if (parsed.schemaVersion !== RUNTIME_SCHEMA_VERSION) {
		throw new RuntimeBootstrapError("runtime-journal-uncertified", `schemaVersion ${parsed.schemaVersion}`);
	}
	if (!JOURNAL_PHASES.includes(parsed.phase)) {
		throw new RuntimeBootstrapError("runtime-journal-uncertified", `phase ${JSON.stringify(parsed.phase)}`);
	}
	// The identity shape a phase may carry IS the writer state that phase describes, and each phase
	// names its own: `installing` has asked for an artifact and not seen one, `runtime-ready` has
	// observed exactly one, and `removing` inherits whichever entry it left. That is why the stage is
	// passed in here rather than accepted loosely — a ready-shaped `installing` entry would claim an
	// observation that never happened, and a requested-shaped ready entry would name a runtime whose
	// bytes nobody looked at.
	certifyArtifactIdentity(
		"artifactIdentity",
		parsed.artifactIdentity,
		parsed.phase === "installing" ? "requested" : parsed.phase === "runtime-ready" ? "ready" : "either",
	);
	if (parsed.previousRuntime !== null) certifyArtifactIdentity("previousRuntime", parsed.previousRuntime, "ready");
	if (parsed.phase === "runtime-ready" && parsed.previousRuntime !== null) {
		throw new RuntimeBootstrapError(
			"runtime-journal-uncertified",
			"a ready entry describes a finished swap, so there is no previous runtime left to name",
		);
	}
	if (parsed.runtimeRoot !== layout.activeDir) {
		throw new RuntimeBootstrapError(
			"runtime-journal-foreign-root",
			`the journal names ${parsed.runtimeRoot}, which is not this host's stable ${layout.activeDir}`,
		);
	}
	return Object.freeze(parsed);
}

/**
 * The identity of a FINISHED runtime, for carrying across an install that may not finish. Only a
 * `runtime-ready` entry has one: an install that never observed an artifact has nothing to hand to
 * the next transaction, and inventing a shape for it would be a provenance claim nobody made.
 */
export function provenanceOf(journal) {
	if (journal === null || journal.phase !== "runtime-ready") return null;
	return journal.artifactIdentity;
}

/**
 * What a path at one of our addresses IS. `existsSync` follows links, so it answers "absent" for a
 * dangling symlink and "there" for a link into somebody else's tree — neither is a fact this module
 * can act on.
 */
export function classifyPath(target) {
	const stat = fs.lstatSync(target, { throwIfNoEntry: false });
	if (stat === undefined) return "absent";
	if (stat.isSymbolicLink()) return "symlink";
	if (stat.isDirectory()) return "real-dir";
	return "other";
}

/**
 * What the three runtime directories mean, given a certified journal. Reading only — this names a
 * state, it does not act on one. All eight presence combinations have a name.
 */
export function assessRuntimeState(layout, certified) {
	// The root itself is classified too: a symlinked `runtime/` makes `mkdir -p` fail with a bare
	// ENOENT, and an unnamed errno is not a refusal anyone can act on.
	const kinds = {
		runtimeRoot: classifyPath(layout.runtimeRoot),
		active: classifyPath(layout.activeDir),
		staging: classifyPath(layout.stagingDir),
		previous: classifyPath(layout.previousDir),
		// The cache is classified with the rest, because it is the fourth thing this module deletes
		// and a transaction that reclaims it has to have proven it was ours BEFORE the first removal.
		cache: classifyPath(layout.cacheDir),
	};
	const facts = {
		kinds: Object.freeze(kinds),
		active: kinds.active === "real-dir",
		staging: kinds.staging === "real-dir",
		previous: kinds.previous === "real-dir",
	};
	for (const [name, kind] of Object.entries(kinds)) {
		if (kind !== "absent" && kind !== "real-dir") {
			return Object.freeze({ state: "path-kind-refused", refused: `${name}=${kind}`, ...facts });
		}
	}
	const { active, staging, previous } = facts;
	if (certified === null) {
		if (active || staging || previous) return Object.freeze({ state: "unowned-residue", ...facts });
		// CACHE-ONLY residue gets its own name. A cache directory at our address with no journal behind
		// it is somebody else's — or the remains of a generation this host cut — and adopting it would
		// mean this module's first act on a strange host is deleting a tree it cannot prove it wrote.
		if (kinds.cache !== "absent") return Object.freeze({ state: "unowned-cache-residue", ...facts });
		return Object.freeze({ state: "clean", ...facts });
	}
	if (!active && !staging && !previous) return Object.freeze({ state: "owned-empty", ...facts });
	if (!active && !staging && previous) return Object.freeze({ state: "torn-swap", ...facts });
	if (!active && staging && !previous) return Object.freeze({ state: "abandoned-candidate", ...facts });
	if (!active && staging && previous) return Object.freeze({ state: "torn-swap-with-candidate", ...facts });
	if (active && !staging && !previous) return Object.freeze({ state: "settled", ...facts });
	if (active && !staging && previous) return Object.freeze({ state: "backup-pending", ...facts });
	if (active && staging && !previous) return Object.freeze({ state: "stale-candidate", ...facts });
	return Object.freeze({ state: "backup-pending-with-candidate", ...facts });
}

/**
 * INSPECT a tree as an installed package consumer, without demanding a particular version: the
 * package is there under the name we expect, the compiled entry is present, every required bin is
 * present and executable, and the shipped operator command runs. This is the question a recovery has
 * to answer about a directory whose version it does not yet know — "is what is sitting at the active
 * address a usable runtime at all?" — and it is why a backup is never deleted on the strength of a
 * sibling's mere existence.
 *
 * @returns `{ok: true, version}` or `{ok: false, code, detail}` — a verdict, not a throw.
 */
export function inspectInstalledRuntime(prefix, packageName) {
	const installedRoot = path.join(prefix, "node_modules", packageName);
	let installed;
	try {
		installed = JSON.parse(fs.readFileSync(path.join(installedRoot, "package.json"), "utf8"));
	} catch (err) {
		return {
			ok: false,
			code: "runtime-package-spec-mismatch",
			detail: `${installedRoot}/package.json: ${err.message}`,
		};
	}
	if (installed.name !== packageName || !isExactIdentity(installed.version)) {
		return {
			ok: false,
			code: "runtime-package-spec-mismatch",
			detail: `${installedRoot} holds ${JSON.stringify(installed.name)}@${JSON.stringify(installed.version)}`,
		};
	}
	if (!fs.existsSync(path.join(installedRoot, COMPILED_ENTRY))) {
		return { ok: false, code: "runtime-compiled-dist-missing", detail: path.join(installedRoot, COMPILED_ENTRY) };
	}
	for (const name of REQUIRED_BINS) {
		const bin = path.join(prefix, "node_modules", ".bin", name);
		try {
			fs.accessSync(bin, fs.constants.X_OK);
		} catch (err) {
			return { ok: false, code: "runtime-required-bin-missing", detail: `${bin}: ${err.message}` };
		}
	}
	const entwurf = path.join(prefix, "node_modules", ".bin", "entwurf");
	const run = spawnSync(entwurf, ["check-bridge"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
	if (run.status !== 0) {
		return {
			ok: false,
			code: "runtime-check-bridge-failed",
			detail: `${entwurf} check-bridge exited ${run.status}: ${(run.stderr || run.stdout || "").trim().slice(0, 400)}`,
		};
	}
	return { ok: true, version: installed.version };
}

/**
 * Verify a tree as the EXACT runtime asked for: everything `inspectInstalledRuntime` checks, plus
 * the version. Refusals are named and thrown, because this is the gate a candidate must pass before
 * it is allowed to become the active runtime.
 */
export function verifyInstalledRuntime(prefix, spec) {
	const seen = inspectInstalledRuntime(prefix, spec.name);
	if (!seen.ok) throw new RuntimeBootstrapError(seen.code, seen.detail);
	if (seen.version !== spec.version) {
		throw new RuntimeBootstrapError(
			"runtime-package-spec-mismatch",
			`asked for ${spec.name}@${spec.version}, the tree holds ${spec.name}@${seen.version}`,
		);
	}
	return Object.freeze({ name: spec.name, version: seen.version });
}

/** npm's own integrity format, computed from the bytes that actually arrived. */
export function integrityOfFile(file) {
	return `sha512-${createHash("sha512").update(fs.readFileSync(file)).digest("base64")}`;
}

/** A second, shorter record of the same bytes — what we observed, never a claim of a check. */
export function digestFile(file) {
	return `sha256-${createHash("sha256").update(fs.readFileSync(file)).digest("hex")}`;
}

/** `npm pack --json`'s one row, or a named refusal. The metadata is the ARTIFACT's own claim. */
function readPackedArtifact(packed, cacheDir, failureCode) {
	let row;
	try {
		row = JSON.parse(packed.stdout)[0];
	} catch (err) {
		throw new RuntimeBootstrapError(failureCode, `npm pack --json was unreadable: ${err.message}`);
	}
	if (
		row === undefined ||
		typeof row.filename !== "string" ||
		!isExactIdentity(row.name) ||
		!isExactIdentity(row.version)
	) {
		throw new RuntimeBootstrapError(
			failureCode,
			`npm pack --json carried no name/version/filename: ${packed.stdout.slice(0, 200)}`,
		);
	}
	return Object.freeze({
		tarball: path.join(cacheDir, path.basename(row.filename)),
		name: row.name,
		version: row.version,
	});
}

/** Install a local tarball into the staging prefix. `--ignore-scripts` is this call's flag. */
function installLocalTarball(tarball, prefix, npmEnv, npmBin, failureCode) {
	const installed = spawnSync(npmBin, buildInstallArgv(tarball, prefix), { encoding: "utf8", env: npmEnv });
	if (installed.status !== 0) {
		throw new RuntimeBootstrapError(
			failureCode,
			`npm install exited ${installed.status}: ${(installed.stderr || "").trim().slice(0, 400)}`,
		);
	}
}

/** npm acquisition: pack the exact spec into our cache, verify its bytes against the published integrity, install. */
export function npmAcquire({ identity, prefix, cacheDir, env, npmBin = "npm" }) {
	fs.mkdirSync(cacheDir, { recursive: true });
	const npmEnv = npmEnvironment(env, cacheDir);
	const spec = { name: identity.name, version: identity.version, integrity: identity.expectedIntegrity };
	const packed = spawnSync(npmBin, buildPackArgv(spec, cacheDir), { encoding: "utf8", env: npmEnv });
	if (packed.status !== 0) {
		throw new RuntimeBootstrapError(
			"runtime-acquire-failed",
			`npm pack exited ${packed.status}: ${(packed.stderr || "").trim().slice(0, 400)}`,
		);
	}
	const artifact = readPackedArtifact(packed, cacheDir, "runtime-acquire-failed");
	const observedIntegrity = integrityOfFile(artifact.tarball);
	if (observedIntegrity !== spec.integrity) {
		throw new RuntimeBootstrapError(
			"runtime-artifact-integrity-mismatch",
			`the lock expects ${spec.integrity} for ${spec.name}@${spec.version}, the tarball hashes to ${observedIntegrity}`,
		);
	}
	installLocalTarball(artifact.tarball, prefix, npmEnv, npmBin, "runtime-acquire-failed");
	return Object.freeze({ observedDigest: digestFile(artifact.tarball) });
}

/**
 * Checkout acquisition: pack the EXACT commit from the fixed remote, then install that tarball.
 *
 * There is no integrity to compare against, and this function does not pretend otherwise — a
 * registry publishes an integrity, a commit does not. What stands in its place is spelled out
 * rather than implied: the commit pins WHICH source tree was packed, the digest RECORDS the bytes
 * that arrived, and the caller's `verifyInstalledRuntime` decides whether what landed is a runtime
 * at all. A remote that cannot serve the commit, or a `prepare` that cannot build it, is
 * `runtime-checkout-source-unavailable` — never a fallback to some other source.
 */
export function checkoutAcquire({ identity, prefix, cacheDir, env, npmBin = "npm" }) {
	fs.mkdirSync(cacheDir, { recursive: true });
	const npmEnv = npmEnvironment(env, cacheDir);
	const packed = spawnSync(npmBin, buildCheckoutPackArgv(identity, cacheDir), { encoding: "utf8", env: npmEnv });
	if (packed.status !== 0) {
		throw new RuntimeBootstrapError(
			"runtime-checkout-source-unavailable",
			`npm pack ${buildCheckoutRemote(identity.repository)}#${identity.commit} exited ${packed.status}: ${(packed.stderr || "").trim().slice(0, 400)}`,
		);
	}
	const artifact = readPackedArtifact(packed, cacheDir, "runtime-checkout-source-unavailable");
	installLocalTarball(artifact.tarball, prefix, npmEnv, npmBin, "runtime-checkout-source-unavailable");
	// COMPLETENESS, not identity: what the artifact says it is, to be checked against the tree.
	return Object.freeze({
		observedDigest: digestFile(artifact.tarball),
		packageName: artifact.name,
		packageVersion: artifact.version,
	});
}

/** The dispatcher, on the identity's own discriminant. No environment, no fallback, no third branch. */
export function acquireArtifact(args) {
	return args.identity.kind === "npm" ? npmAcquire(args) : checkoutAcquire(args);
}

/**
 * The package name the tree at the ACTIVE address was installed as, according to the journal.
 *
 * An `installing` entry describes what we are reaching for, not what is standing there, so the
 * answer comes from the carried ready identity in that case. It is deliberately NOT taken from the
 * request: on a source switch the request may carry no package name at all, and answering with the
 * candidate's name would inspect the running runtime as if it were already the new one.
 */
function activePackageName(certified) {
	const ready =
		artifactStage(certified.artifactIdentity) === "ready" ? certified.artifactIdentity : certified.previousRuntime;
	if (ready === null) {
		throw new RuntimeBootstrapError(
			"runtime-owner-state-missing",
			`${certified.runtimeRoot} has a backup beside it but the journal carries no ready identity naming what that backup contains`,
		);
	}
	return artifactCompleteness(ready).name;
}

/**
 * Put the exact runtime at the stable address, or leave the last good one exactly as it was.
 *
 * @returns frozen `{phase, changed, recovered, journal}`
 */
export function bootstrapRuntime({
	env,
	lock,
	checkoutRoot = defaultCheckoutRoot(),
	acquire = acquireArtifact,
	resolveCommit = resolveCheckoutCommit,
}) {
	const requested = requestedArtifactIdentity({ lock, checkoutRoot, resolveCommit });
	const layout = resolveRuntimeLayout(env);

	// PRE-MUTATION, and that word is literal: not one directory is created before ownership and the
	// disk state have been decided. A module that mkdirs its own root first has answered "is this
	// ours?" with its own footprint.
	const certified = readCertifiedJournal(layout);
	const assessed = assessRuntimeState(layout, certified);
	if (assessed.state === "path-kind-refused") {
		throw new RuntimeBootstrapError(
			"runtime-path-kind-refused",
			`${layout.runtimeRoot} holds ${assessed.refused}; only an absent path or a real directory may stand at these addresses`,
		);
	}
	if (assessed.state === "unowned-residue") {
		throw new RuntimeBootstrapError(
			"runtime-owner-state-missing",
			`${layout.runtimeRoot} holds ${JSON.stringify(assessed.kinds)} with no certified journal behind it; refusing to move what we cannot prove is ours`,
		);
	}
	if (assessed.state === "unowned-cache-residue") {
		throw new RuntimeBootstrapError(
			"runtime-cache-unowned-residue",
			`${layout.cacheDir} exists with no certified journal behind it; this transaction reclaims only a cache its own journal proves it wrote`,
		);
	}

	fs.mkdirSync(layout.runtimeRoot, { recursive: true });

	// Recovery. The backup is the last good runtime until something proves otherwise, so it is never
	// dropped on the strength of a sibling merely existing.
	let recovered = null;
	let restored = false;
	switch (assessed.state) {
		case "torn-swap":
		case "torn-swap-with-candidate":
			removeTree(layout.stagingDir);
			fs.renameSync(layout.previousDir, layout.activeDir);
			recovered = assessed.state;
			restored = true;
			break;
		case "abandoned-candidate":
		case "stale-candidate":
			removeTree(layout.stagingDir);
			recovered = assessed.state;
			break;
		case "backup-pending":
		case "backup-pending-with-candidate": {
			removeTree(layout.stagingDir);
			// "Is the active tree a usable runtime at all?" — asked with the name the PREVIOUS ready
			// identity claims, because that is what the backup beside it was installed as. On a source
			// switch the requested identity may not even carry a package name.
			if (inspectInstalledRuntime(layout.activeDir, activePackageName(certified)).ok) {
				removeTree(layout.previousDir);
				recovered = "stale-backup";
			} else {
				removeTree(layout.activeDir);
				fs.renameSync(layout.previousDir, layout.activeDir);
				recovered = "corrupt-active-restored";
				restored = true;
			}
			break;
		}
		default:
			break;
	}

	// Reconcile journal against disk: only a `runtime-ready` journal for THIS exact spec, whose
	// active tree is still a REAL DIRECTORY that verifies, may be believed. A recovery just moved a
	// tree the journal does not describe, so a restore never takes this path.
	// IDENTITY, not version. `sameArtifactRequest` is the only comparison allowed here: for a
	// checkout-sourced runtime the anchor is the commit, so a journal that says `0.21.0` while the
	// request names a different commit is NOT this runtime, and skipping the install on the strength
	// of a matching version is how a host would keep serving the previous candidate while every
	// receipt above it claimed the new one.
	if (
		!restored &&
		certified !== null &&
		certified.phase === "runtime-ready" &&
		sameArtifactRequest(certified.artifactIdentity, requested) &&
		classifyPath(layout.activeDir) === "real-dir"
	) {
		try {
			verifyInstalledRuntime(layout.activeDir, artifactCompleteness(certified.artifactIdentity));
			return Object.freeze({ phase: "runtime-ready", changed: false, recovered, journal: certified });
		} catch {
			// fall through: the journal claimed a runtime the disk does not have.
		}
	}

	// Carry the last good provenance forward. Without this, writing `installing` would erase the only
	// statement of what the backup about to be created actually contains.
	const carried =
		certified === null
			? null
			: certified.phase === "runtime-ready"
				? provenanceOf(certified)
				: certified.previousRuntime;
	writeJournal(layout, {
		phase: "installing",
		runtimeRoot: layout.activeDir,
		artifactIdentity: requested,
		previousRuntime: carried,
	});

	// From here the journal above is this transaction's proof of ownership over the staging tree AND
	// the cache — which is why the cleanup below may reclaim both, and why it could not before the
	// write. What it may NOT touch is the journal itself, the backup, or the active runtime: those
	// are the retry authority and the last good runtime, and a failed candidate is not a reason to
	// have less than we started with.
	let acquired;
	try {
		fs.mkdirSync(layout.stagingDir, { recursive: true });
		acquired = acquire({ identity: requested, prefix: layout.stagingDir, cacheDir: layout.cacheDir, env });
		verifyInstalledRuntime(layout.stagingDir, completenessOf(requested, acquired));
	} catch (err) {
		removeTree(layout.stagingDir);
		// A half-fetched tarball left in the cache is the thing a retry would trip over: npm's own
		// cache entry may be incomplete, and OUR cache is the only place this transaction wrote.
		removeTree(layout.cacheDir);
		throw err;
	}

	let backedUp = false;
	try {
		if (classifyPath(layout.activeDir) === "real-dir") {
			fs.renameSync(layout.activeDir, layout.previousDir);
			backedUp = true;
		}
		fs.renameSync(layout.stagingDir, layout.activeDir);
	} catch (err) {
		removeTree(layout.stagingDir);
		if (backedUp) {
			removeTree(layout.activeDir);
			fs.renameSync(layout.previousDir, layout.activeDir);
		}
		throw new RuntimeBootstrapError("runtime-swap-failed", err.message);
	}
	removeTree(layout.previousDir);

	const journal = {
		phase: "runtime-ready",
		runtimeRoot: layout.activeDir,
		artifactIdentity: readyIdentity(requested, acquired),
		previousRuntime: null,
	};
	writeJournal(layout, journal);
	return Object.freeze({ phase: "runtime-ready", changed: true, recovered, journal });
}

/**
 * The inverse, provable-only. Every deletion authority is established BEFORE the first deletion, so
 * a refusal leaves the host — including the journal's bytes — exactly as it found it. The runtime
 * goes LAST among the artifacts, and the journal after them, because the ledger has to outlive what
 * it authorised. No public verb reaches this yet — that orchestration is M3-b2.
 */
export function removeOwnedRuntime({ env }) {
	const layout = resolveRuntimeLayout(env);
	const certified = readCertifiedJournal(layout);
	const assessed = assessRuntimeState(layout, certified);
	if (assessed.state === "path-kind-refused") {
		throw new RuntimeBootstrapError(
			"runtime-inverse-foreign-refused",
			`${layout.runtimeRoot} holds ${assessed.refused}; only an absent path or a real directory may stand at these addresses`,
		);
	}
	if (certified === null) {
		if (assessed.state === "unowned-residue") {
			throw new RuntimeBootstrapError(
				"runtime-inverse-foreign-refused",
				`${layout.runtimeRoot} holds ${JSON.stringify(assessed)} with no certified journal behind it`,
			);
		}
		// A CACHE with no journal behind it is refused here for the same reason the forward
		// transaction refuses it: the inverse's whole plan begins with that directory, and the two
		// sides of one ownership fact may not read it differently. An inverse that treated it as
		// "nothing of ours, report success" would be the half that quietly deletes it next time the
		// forward path is taught to be less careful.
		if (assessed.state === "unowned-cache-residue") {
			throw new RuntimeBootstrapError(
				"runtime-inverse-foreign-refused",
				`${layout.cacheDir} exists with no certified journal behind it; this inverse removes only what a journal proves it wrote`,
			);
		}
		return Object.freeze({ removed: Object.freeze([]), reason: "runtime-journal-absent" });
	}

	// PREFLIGHT: everything we are about to delete, decided before anything is deleted.
	const plan = [];
	if (fs.existsSync(layout.cacheDir)) plan.push({ what: "cache", target: layout.cacheDir });
	plan.push({ what: "runtime", target: layout.runtimeRoot });

	writeJournal(layout, { ...certified, phase: "removing" });
	const removed = [];
	for (const step of plan) {
		removeTree(step.target);
		removed.push(step.what);
	}
	fs.rmSync(layout.journalPath, { force: true });
	removed.push("journal");
	return Object.freeze({ removed: Object.freeze(removed), reason: null });
}
