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
 * WHY THE PACKAGE IS LOCKED TWICE. The exact `name@version` comes from the checkout's own
 * `package.json`; a sibling `runtime-lock.json` repeats it and adds the integrity npm published.
 * The two must agree, and the tarball's OWN sha512 must equal that integrity before anything is
 * installed. The journal records the expected integrity and the observed digest as separate fields,
 * because a digest computed from whatever arrived is a record of what happened — calling it a pin
 * would claim a check that only the comparison performs.
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
export const RUNTIME_SCHEMA_VERSION = 1;

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

/** The exact key set a certified journal carries. Extra or missing keys grant no authority. */
export const JOURNAL_KEYS = Object.freeze([
	"schemaVersion",
	"phase",
	"runtimeRoot",
	"packageName",
	"packageVersion",
	"expectedIntegrity",
	"observedDigest",
	"previousRuntime",
]);

/**
 * `previousRuntime` exists because writing the `installing` entry would otherwise OVERWRITE the only
 * record of what was running. A host that dies mid-install would then hold a backup directory and no
 * statement of what it contains — recoverable bytes with unrecoverable provenance. So the prior
 * ready entry's provenance is carried forward for exactly as long as a backup can exist, and a
 * finished install sets it back to null because there is no longer a previous runtime to describe.
 */
export const PROVENANCE_KEYS = Object.freeze(["packageName", "packageVersion", "expectedIntegrity", "observedDigest"]);

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

/** The plugin-owned lock: exact package plus the integrity npm published for it. */
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
	if (
		parsed.schemaVersion !== RUNTIME_SCHEMA_VERSION ||
		typeof parsed.name !== "string" ||
		typeof parsed.version !== "string" ||
		typeof parsed.integrity !== "string" ||
		!parsed.integrity.startsWith("sha512-")
	) {
		throw new RuntimeBootstrapError("runtime-lock-unreadable", `${lockPath} is not a v1 lock with an sha512 integrity`);
	}
	return Object.freeze({ name: parsed.name, version: parsed.version, integrity: parsed.integrity });
}

/** The lock and the checkout must name the SAME package, exactly. */
export function certifyLockCoherence(lock, checkoutSpec) {
	if (lock.name !== checkoutSpec.name || lock.version !== checkoutSpec.version) {
		throw new RuntimeBootstrapError(
			"runtime-lock-incoherent",
			`the lock names ${lock.name}@${lock.version} but this checkout is ${checkoutSpec.name}@${checkoutSpec.version}`,
		);
	}
	return Object.freeze({ name: lock.name, version: lock.version, integrity: lock.integrity });
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

function certifyProvenance(where, value) {
	if (value === null) return null;
	if (typeof value !== "object" || Array.isArray(value)) {
		throw new RuntimeBootstrapError("runtime-journal-uncertified", `${where} is neither null nor an object`);
	}
	const keys = Object.keys(value).sort().join(",");
	if (keys !== [...PROVENANCE_KEYS].sort().join(",")) {
		throw new RuntimeBootstrapError("runtime-journal-uncertified", `${where} key set: ${keys}`);
	}
	if (!isExactIdentity(value.packageName) || !isExactIdentity(value.packageVersion)) {
		throw new RuntimeBootstrapError("runtime-journal-uncertified", `${where} carries no exact package identity`);
	}
	if (!SHA512.test(value.expectedIntegrity) || !SHA256.test(value.observedDigest)) {
		throw new RuntimeBootstrapError("runtime-journal-uncertified", `${where} integrity/digest are not well formed`);
	}
	return Object.freeze({ ...value });
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
	if (!isExactIdentity(parsed.packageName) || !isExactIdentity(parsed.packageVersion)) {
		throw new RuntimeBootstrapError("runtime-journal-uncertified", "packageName/packageVersion are not exact strings");
	}
	if (!SHA512.test(parsed.expectedIntegrity)) {
		throw new RuntimeBootstrapError(
			"runtime-journal-uncertified",
			`expectedIntegrity ${JSON.stringify(parsed.expectedIntegrity)}`,
		);
	}
	// The digest a phase may carry is exactly the writer state that phase describes: `installing` has
	// not seen an artifact yet, `runtime-ready` has, and `removing` inherits from whichever it left.
	if (parsed.phase === "installing" && parsed.observedDigest !== null) {
		throw new RuntimeBootstrapError("runtime-journal-uncertified", "an installing entry cannot already have a digest");
	}
	if (parsed.phase === "runtime-ready" && !SHA256.test(parsed.observedDigest)) {
		throw new RuntimeBootstrapError(
			"runtime-journal-uncertified",
			`a ready entry needs an observed digest, got ${JSON.stringify(parsed.observedDigest)}`,
		);
	}
	if (parsed.phase === "removing" && parsed.observedDigest !== null && !SHA256.test(parsed.observedDigest)) {
		throw new RuntimeBootstrapError(
			"runtime-journal-uncertified",
			`removing digest ${JSON.stringify(parsed.observedDigest)}`,
		);
	}
	certifyProvenance("previousRuntime", parsed.previousRuntime);
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

/** The provenance of a finished runtime, for carrying across an install that may not finish. */
export function provenanceOf(journal) {
	if (journal === null) return null;
	return Object.freeze({
		packageName: journal.packageName,
		packageVersion: journal.packageVersion,
		expectedIntegrity: journal.expectedIntegrity,
		observedDigest: journal.observedDigest,
	});
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
		return Object.freeze({ state: active || staging || previous ? "unowned-residue" : "clean", ...facts });
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

/** Production acquisition: pack the exact spec into our cache, verify its bytes, then install it. */
export function npmAcquire({ spec, prefix, cacheDir, env, npmBin = "npm" }) {
	fs.mkdirSync(cacheDir, { recursive: true });
	const npmEnv = npmEnvironment(env, cacheDir);
	const packed = spawnSync(npmBin, buildPackArgv(spec, cacheDir), { encoding: "utf8", env: npmEnv });
	if (packed.status !== 0) {
		throw new RuntimeBootstrapError(
			"runtime-acquire-failed",
			`npm pack exited ${packed.status}: ${(packed.stderr || "").trim().slice(0, 400)}`,
		);
	}
	let filename;
	try {
		filename = JSON.parse(packed.stdout)[0].filename;
	} catch (err) {
		throw new RuntimeBootstrapError("runtime-acquire-failed", `npm pack --json was unreadable: ${err.message}`);
	}
	const tarball = path.join(cacheDir, path.basename(filename));
	const observedIntegrity = integrityOfFile(tarball);
	if (observedIntegrity !== spec.integrity) {
		throw new RuntimeBootstrapError(
			"runtime-artifact-integrity-mismatch",
			`the lock expects ${spec.integrity} for ${spec.name}@${spec.version}, the tarball hashes to ${observedIntegrity}`,
		);
	}
	const installed = spawnSync(npmBin, buildInstallArgv(tarball, prefix), { encoding: "utf8", env: npmEnv });
	if (installed.status !== 0) {
		throw new RuntimeBootstrapError(
			"runtime-acquire-failed",
			`npm install exited ${installed.status}: ${(installed.stderr || "").trim().slice(0, 400)}`,
		);
	}
	return Object.freeze({ observedDigest: digestFile(tarball) });
}

/**
 * Put the exact runtime at the stable address, or leave the last good one exactly as it was.
 *
 * @returns frozen `{phase, changed, recovered, journal}`
 */
export function bootstrapRuntime({ env, spec, lock, acquire = npmAcquire }) {
	const locked = certifyLockCoherence(lock, spec);
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
			if (inspectInstalledRuntime(layout.activeDir, locked.name).ok) {
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
	if (
		!restored &&
		certified !== null &&
		certified.phase === "runtime-ready" &&
		certified.packageName === locked.name &&
		certified.packageVersion === locked.version &&
		classifyPath(layout.activeDir) === "real-dir"
	) {
		try {
			verifyInstalledRuntime(layout.activeDir, locked);
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
		packageName: locked.name,
		packageVersion: locked.version,
		expectedIntegrity: locked.integrity,
		observedDigest: null,
		previousRuntime: carried,
	});

	let observedDigest;
	try {
		fs.mkdirSync(layout.stagingDir, { recursive: true });
		({ observedDigest } = acquire({ spec: locked, prefix: layout.stagingDir, cacheDir: layout.cacheDir, env }));
		verifyInstalledRuntime(layout.stagingDir, locked);
	} catch (err) {
		removeTree(layout.stagingDir);
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
		packageName: locked.name,
		packageVersion: locked.version,
		expectedIntegrity: locked.integrity,
		observedDigest,
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
