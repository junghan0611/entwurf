/**
 * check-herdr-runtime-bootstrap — deterministic gate for the #116 M3-b1 runtime leaf
 * (`plugins/herdr/lib/runtime-bootstrap.mjs`): acquiring, verifying and replacing the
 * Entwurf-owned runtime the Herdr plugin installs against.
 *
 * WHAT THIS GATE PROVES AND WHAT IT DOES NOT. `acquire` is a FUNCTION seam, so the transaction here
 * is driven against a fixture package this gate materialises: a real `package.json`, a real
 * compiled entry, and real executable bins. That makes the transaction hermetic — no network, no
 * npm — but it means the `check-bridge` cell proves only that an installed tree's own bin is
 * executed and its exit code decides the verdict. It does NOT prove that the real Entwurf package
 * boots. THE ACTUAL PACKAGE PROOF LIVES IN `check-pack-install`, which packs this checkout, installs
 * the tarball into a fresh temp project, and runs this module's own `verifyInstalledRuntime` against
 * that installed tree. Neither gate stands in for the other, and this header is where the boundary
 * is named rather than implied.
 *
 * WHY THE SANDBOX IS THE WHOLE POINT. Every root this module may touch comes from XDG, so the gate
 * hands it a mkdtemp HOME with XDG_DATA_HOME/XDG_CACHE_HOME inside it and then asserts that nothing
 * appeared anywhere else under that HOME. A module that owns a user's data root has to prove the
 * boundary, not describe it.
 *
 * ORDER IS LOAD-BEARING. Each [QK:HRB-*] token appears exactly once, on the assertion that fails
 * for that claim, and the cells are ordered so that a mutant of one claim cannot trip an earlier
 * claim's assertion first.
 */

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { reclaimOnExit } from "./lib/reclaim-on-exit.ts";

let passed = 0;
function ok(label: string, cond: boolean): void {
	assert.ok(cond, label);
	console.log(`  ok    ${label}`);
	passed++;
}

const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const PLUGIN_DIR = path.join(REPO, "plugins", "herdr");
/** The ONE owner — under `scripts/`, which the npm tarball ships. */
const LEAF = path.join(REPO, "scripts", "herdr-runtime.mjs");
/** The plugin-side file, which must be a thin re-export of exactly that. */
const PLUGIN_REEXPORT = path.join(PLUGIN_DIR, "lib", "runtime-bootstrap.mjs");

interface Spec {
	name: string;
	version: string;
	integrity?: string;
}
interface ArtifactIdentity {
	kind: string;
	name?: string;
	version?: string;
	expectedIntegrity?: string;
	repository?: string;
	commit?: string;
	packageName?: string;
	packageVersion?: string;
	observedDigest?: string;
}
interface Lock {
	source: string;
	name?: string;
	version?: string;
	integrity?: string;
	repository?: string;
}
interface Journal {
	schemaVersion: number;
	phase: string;
	runtimeRoot: string;
	artifactIdentity: ArtifactIdentity;
	previousRuntime: ArtifactIdentity | null;
}
interface BootstrapResult {
	phase: string;
	changed: boolean;
	recovered: string | null;
	journal: Journal;
}
interface Layout {
	pluginRoot: string;
	runtimeRoot: string;
	activeDir: string;
	stagingDir: string;
	previousDir: string;
	journalPath: string;
	cacheDir: string;
}
interface AcquireArgs {
	identity: ArtifactIdentity;
	prefix: string;
	cacheDir: string;
	env: NodeJS.ProcessEnv;
}
interface AcquireResult {
	observedDigest: string;
	packageName?: string;
	packageVersion?: string;
}
interface SpawnLike {
	status: number | null;
	stdout: string;
	stderr: string;
	error?: Error;
}
interface Assessed {
	state: string;
	refused?: string;
	kinds: Record<string, string>;
	active: boolean;
	staging: boolean;
	previous: boolean;
}
interface Leaf {
	REQUIRED_BINS: string[];
	COMPILED_ENTRY: string;
	JOURNAL_PHASES: string[];
	JOURNAL_KEYS: string[];
	RUNTIME_SCHEMA_VERSION: number;
	ARTIFACT_KINDS: string[];
	ARTIFACT_KEYS: Record<string, { requested: string[]; ready: string[] }>;
	CHECKOUT_REPOSITORY: string;
	resolveRuntimeLayout: (env: NodeJS.ProcessEnv) => Layout;
	readCheckoutPackageSpec: (root: string) => Spec;
	readRuntimeLock: (pluginDir: string) => Lock;
	certifyLockCoherence: (lock: Spec, spec: Spec) => Spec;
	certifyArtifactIdentity: (where: string, value: unknown, stage?: string) => ArtifactIdentity;
	artifactStage: (identity: ArtifactIdentity) => string;
	artifactCompleteness: (identity: ArtifactIdentity) => Spec;
	sameArtifactRequest: (ready: ArtifactIdentity, requested: ArtifactIdentity) => boolean;
	requestedArtifactIdentity: (args: {
		lock: Lock;
		checkoutRoot: string;
		resolveCommit?: (root: string) => string;
	}) => ArtifactIdentity;
	resolveCheckoutCommit: (
		root: string,
		deps?: { gitBin?: string; spawn?: (bin: string, argv: string[], opts: unknown) => SpawnLike },
	) => string;
	buildCheckoutRemote: (repository: string) => string;
	buildCheckoutPackArgv: (identity: ArtifactIdentity, dest: string) => string[];
	checkoutAcquire: (args: AcquireArgs & { npmBin?: string }) => AcquireResult;
	assessRuntimeState: (layout: Layout, certified: Journal | null) => Assessed;
	readCertifiedJournal: (layout: Layout) => Journal | null;
	buildPackArgv: (spec: Spec, dest: string) => string[];
	buildInstallArgv: (tarball: string, prefix: string) => string[];
	npmEnvironment: (env: NodeJS.ProcessEnv, cacheDir: string) => NodeJS.ProcessEnv;
	integrityOfFile: (file: string) => string;
	classifyPath: (target: string) => string;
	inspectInstalledRuntime: (prefix: string, packageName: string) => { ok: boolean; version?: string; code?: string };
	writeJournal: (layout: Layout, entry: Record<string, unknown>) => void;
	bootstrapRuntime: (args: {
		env: NodeJS.ProcessEnv;
		lock: Lock;
		checkoutRoot?: string;
		acquire?: unknown;
		resolveCommit?: (root: string) => string;
	}) => BootstrapResult;
	removeOwnedRuntime: (args: { env: NodeJS.ProcessEnv }) => { removed: string[]; reason: string | null };
}

const leaf = (await import(pathToFileURL(LEAF).href)) as Leaf;
const {
	REQUIRED_BINS,
	COMPILED_ENTRY,
	JOURNAL_PHASES,
	JOURNAL_KEYS,
	ARTIFACT_KINDS,
	ARTIFACT_KEYS,
	CHECKOUT_REPOSITORY,
	resolveRuntimeLayout,
	readCheckoutPackageSpec,
	assessRuntimeState,
	readCertifiedJournal,
	buildPackArgv,
	buildInstallArgv,
	buildCheckoutRemote,
	buildCheckoutPackArgv,
	checkoutAcquire,
	certifyArtifactIdentity,
	artifactStage,
	artifactCompleteness,
	sameArtifactRequest,
	requestedArtifactIdentity,
	resolveCheckoutCommit,
	npmEnvironment,
	readRuntimeLock,
	classifyPath,
	inspectInstalledRuntime,
	writeJournal,
	bootstrapRuntime,
	removeOwnedRuntime,
} = leaf;

function world(tag: string): NodeJS.ProcessEnv {
	const home = reclaimOnExit(fs.mkdtempSync(path.join(os.tmpdir(), `entwurf-hrb-${tag}-`)));
	return {
		HOME: home,
		XDG_DATA_HOME: path.join(home, "data"),
		XDG_CACHE_HOME: path.join(home, "cache"),
		PATH: process.env.PATH,
	};
}

const PACKAGE = "@junghanacs/entwurf";
const LOCK_A: Lock = { source: "npm", name: PACKAGE, version: "0.21.0", integrity: "sha512-fixtureA" };
const LOCK_B: Lock = { source: "npm", name: PACKAGE, version: "0.22.0", integrity: "sha512-fixtureB" };
/** The committed candidate lock's shape: a source and the repo literal, and nothing else. */
const CHECKOUT_LOCK: Lock = { source: "herdr-checkout", repository: "junghan0611/entwurf" };
const COMMIT_A = "1".repeat(40);
const COMMIT_B = "2".repeat(40);

/**
 * A fixture CHECKOUT — the thing an npm lock must be coherent with, and the thing a checkout-sourced
 * identity reads its commit from. Written per lock so the two sources can be driven side by side.
 */
function fixtureCheckout(lock: Lock): string {
	const root = reclaimOnExit(fs.mkdtempSync(path.join(os.tmpdir(), "entwurf-hrb-checkout-")));
	fs.writeFileSync(
		path.join(root, "package.json"),
		`${JSON.stringify({ name: lock.name ?? PACKAGE, version: lock.version ?? "0.21.0" }, null, 2)}\n`,
	);
	return root;
}

/** Materialise a fixture package into `prefix` the way npm would, and return an observed digest. */
function fixtureAcquire(
	opts: {
		version?: string;
		name?: string;
		dist?: boolean;
		exitCode?: number;
		omitBin?: string;
		unexecutableBin?: string;
	} = {},
) {
	return ({ identity, prefix }: AcquireArgs): AcquireResult => {
		const version = opts.version ?? identity.version ?? "0.21.0";
		const name = opts.name ?? identity.name ?? PACKAGE;
		const root = path.join(prefix, "node_modules", name);
		fs.mkdirSync(root, { recursive: true });
		fs.writeFileSync(path.join(root, "package.json"), `${JSON.stringify({ name, version }, null, 2)}\n`);
		if (opts.dist !== false) {
			fs.mkdirSync(path.join(root, path.dirname(COMPILED_ENTRY)), { recursive: true });
			fs.writeFileSync(path.join(root, COMPILED_ENTRY), "// compiled entry fixture\n");
		}
		const binDir = path.join(prefix, "node_modules", ".bin");
		fs.mkdirSync(binDir, { recursive: true });
		for (const name of REQUIRED_BINS) {
			if (name === opts.omitBin) continue;
			const p = path.join(binDir, name);
			fs.writeFileSync(p, `#!/bin/sh\nexit ${name === "entwurf" ? (opts.exitCode ?? 0) : 0}\n`);
			fs.chmodSync(p, name === opts.unexecutableBin ? 0o644 : 0o755);
		}
		// A well-formed digest: the certified reader checks the SHAPE of an identity, not its truth.
		// The completeness pair rides along because a checkout-sourced acquisition is the thing that
		// OBSERVES what it packed — for npm the request already said it.
		return {
			observedDigest: `sha256-${createHash("sha256").update(`${name}@${version}`).digest("hex")}`,
			packageName: name,
			packageVersion: version,
		};
	};
}

/** Every file under a root, relative and sorted — the byte-identity comparison this gate needs. */
function treeDigest(root: string): string {
	if (!fs.existsSync(root)) return "<absent>";
	const rows: string[] = [];
	const walk = (dir: string): void => {
		for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
			const abs = path.join(dir, entry.name);
			if (entry.isDirectory()) walk(abs);
			else rows.push(`${path.relative(root, abs)}:${fs.readFileSync(abs).length}`);
		}
	};
	walk(root);
	return rows.join("|");
}

function refusal(fn: () => unknown): string | null {
	try {
		fn();
		return null;
	} catch (err) {
		return (err as { code?: string }).code ?? `not-a-RuntimeBootstrapError:${String(err)}`;
	}
}

/**
 * One bootstrap against a fixture checkout. The npm locks get a checkout whose `package.json`
 * agrees with them (that coherence is a contract of its own); a checkout lock gets a fixed commit
 * seam, because this gate proves the transaction, and `git` itself is proven in its own cell.
 */
function install(
	env: NodeJS.ProcessEnv,
	lock: Lock = LOCK_A,
	acquire = fixtureAcquire(),
	commit: string = COMMIT_A,
): BootstrapResult {
	return bootstrapRuntime({ env, lock, checkoutRoot: fixtureCheckout(lock), acquire, resolveCommit: () => commit });
}

// ── 1. the shipped owner is the only implementation ────────────────────────────
{
	const shipped = (JSON.parse(fs.readFileSync(path.join(REPO, "package.json"), "utf8")) as { files: string[] }).files;
	const reexport = fs.readFileSync(PLUGIN_REEXPORT, "utf8");
	const code = reexport
		.replace(/\/\*[\s\S]*?\*\//g, "")
		.split("\n")
		.map((l) => l.trim())
		.filter((l) => l.length > 0);
	const owner = (await import(pathToFileURL(LEAF).href)) as Record<string, unknown>;
	const thin = (await import(pathToFileURL(PLUGIN_REEXPORT).href)) as Record<string, unknown>;
	const surfaces = JSON.stringify(Object.keys(owner).sort()) === JSON.stringify(Object.keys(thin).sort());
	ok(
		"[QK:HRB-ONE-SHIPPED-OWNER] the implementation lives under `scripts/` — which `package.json.files` ships — and " +
			"the plugin-side file is a re-export and NOTHING else: Herdr's `plugin uninstall` deletes the checkout this " +
			"plugin sits in and calls no cleanup hook, so the code that retires the runtime and undoes an activation has " +
			"to outlive that deletion, and a second copy would let an uninstall read back a schema a different " +
			`implementation wrote (scripts-shipped=${shipped.includes("scripts/")} plugins-shipped=${shipped.some((f) => f.startsWith("plugins"))} reexport-lines=${code.length} surfaces-identical=${surfaces})`,
		shipped.includes("scripts/") &&
			!shipped.some((f) => f.startsWith("plugins")) &&
			code.length === 1 &&
			code[0] === 'export * from "../../../scripts/herdr-runtime.mjs";' &&
			surfaces &&
			Object.keys(owner).length > 0,
	);
}

// ── 2. the address the wiring will name is a real directory and it does not move ─
{
	const env = world("address");
	const layout = resolveRuntimeLayout(env);
	// The installs are CAUGHT. An active address that stopped being a real directory does not fail
	// here as a wrong lstat — the NEXT install refuses the path kind first, and an uncaught refusal
	// would end this cell before the claim it violates is judged, red with nobody's name on it.
	const refusalOf = (run: () => void): string | null => {
		try {
			run();
			return null;
		} catch (err) {
			return `${(err as { code?: string }).code ?? "unknown"}: ${(err as Error).message}`;
		}
	};
	const firstRefusal = refusalOf(() => install(env));
	const first = fs.lstatSync(layout.activeDir, { throwIfNoEntry: false }) ?? null;
	const secondRefusal = refusalOf(() => install(env, LOCK_B));
	const second = fs.lstatSync(layout.activeDir, { throwIfNoEntry: false }) ?? null;
	ok(
		"[QK:HRB-STABLE-ADDRESS] the runtime address is a REAL DIRECTORY at $XDG_DATA_HOME/entwurf/herdr-plugin/" +
			"runtime/active and it is the same path after a version change — the scoped wiring one slice above records " +
			"ABSOLUTE commands under this root, and Pi records the owner root it was wired with, so a symlink whose " +
			"canonicalisation resolves to a per-version directory makes every upgrade look like a different owner " +
			`taking that root over (active=${path.relative(env.HOME as string, layout.activeDir)} ` +
			`symlink=${first?.isSymbolicLink()}/${second?.isSymbolicLink()} ` +
			`refusals=${JSON.stringify([firstRefusal, secondRefusal])})`,
		layout.activeDir === path.join(env.XDG_DATA_HOME as string, "entwurf", "herdr-plugin", "runtime", "active") &&
			firstRefusal === null &&
			secondRefusal === null &&
			first !== null &&
			second !== null &&
			first.isDirectory() &&
			!first.isSymbolicLink() &&
			second.isDirectory() &&
			!second.isSymbolicLink(),
	);
}

// ── 3. nothing is created before the judgement ─────────────────────────────────
{
	const env = world("premutation");
	const layout = resolveRuntimeLayout(env);
	// A host whose journal cannot be certified: the refusal must happen with the runtime root still
	// absent, because a module that mkdirs its own root first has answered "is this ours?" with its
	// own footprint.
	fs.mkdirSync(layout.pluginRoot, { recursive: true });
	fs.writeFileSync(layout.journalPath, "{ this is not json\n");
	const code = refusal(() => install(env));
	ok(
		"[QK:HRB-PRE-MUTATION-ORDER] ownership is decided BEFORE the first mkdir — the runtime root is still absent " +
			"after a refusal, because a module that creates its own root and then asks whether the root was its own has " +
			"already made the answer yes; every later ownership question on that host would then be answered by this " +
			`module's own footprint (refusal=${code} runtimeRoot-after=${classifyPath(layout.runtimeRoot)})`,
		code === "runtime-journal-uncertified" && classifyPath(layout.runtimeRoot) === "absent",
	);
}

// ── 4. disk facts come from lstat, and a link is never a directory ─────────────
{
	const dangling = world("dangling");
	const danglingLayout = resolveRuntimeLayout(dangling);
	fs.mkdirSync(danglingLayout.runtimeRoot, { recursive: true });
	fs.symlinkSync(path.join(dangling.HOME as string, "nothing-here"), danglingLayout.activeDir);
	const existsSaysAbsent = !fs.existsSync(danglingLayout.activeDir);
	const danglingCode = refusal(() => install(dangling));

	const linkedRoot = world("linked-root");
	const linkedLayout = resolveRuntimeLayout(linkedRoot);
	fs.mkdirSync(path.dirname(linkedLayout.runtimeRoot), { recursive: true });
	fs.symlinkSync(path.join(linkedRoot.HOME as string, "elsewhere"), linkedLayout.runtimeRoot);
	const linkedCode = refusal(() => install(linkedRoot));

	const linkedActive = world("linked-active");
	const linkedActiveLayout = resolveRuntimeLayout(linkedActive);
	fs.mkdirSync(path.join(linkedActive.HOME as string, "someone-elses-tree"), { recursive: true });
	fs.mkdirSync(linkedActiveLayout.runtimeRoot, { recursive: true });
	fs.symlinkSync(path.join(linkedActive.HOME as string, "someone-elses-tree"), linkedActiveLayout.activeDir);
	const linkedActiveCode = refusal(() => install(linkedActive));

	ok(
		"[QK:HRB-PATH-KIND-LSTAT] every runtime path is classified with lstat, and only `absent` or `real-dir` is " +
			"allowed to stand there — `existsSync` answers 'absent' for a dangling symlink and 'there' for a link into " +
			"somebody else's tree, so a module that trusts it will rename away a stranger's directory while believing it " +
			"found nothing, and will mkdir through a symlinked root and fail with a bare errno instead of a refusal " +
			`(dangling=${danglingCode}/existsSync-said-absent=${existsSaysAbsent} linked-root=${linkedCode} linked-active=${linkedActiveCode})`,
		existsSaysAbsent &&
			danglingCode === "runtime-path-kind-refused" &&
			linkedCode === "runtime-path-kind-refused" &&
			linkedActiveCode === "runtime-path-kind-refused",
	);
}

// ── 5. the exact package, or a named refusal ───────────────────────────────────
{
	const wrongVersion = refusal(() => install(world("wrong-version"), LOCK_A, fixtureAcquire({ version: "0.0.1" })));
	const noDist = refusal(() => install(world("no-dist"), LOCK_A, fixtureAcquire({ dist: false })));
	const badBridge = refusal(() => install(world("bad-bridge"), LOCK_A, fixtureAcquire({ exitCode: 3 })));
	ok(
		"[QK:HRB-EXACT-ARTIFACT] the tree that becomes the runtime must BE the exact name@version asked for, carry the " +
			"compiled entry, and answer `check-bridge` — each failure named separately. A runtime whose version is " +
			"whatever the registry felt like serving is an unpinned supply chain, and a directory npm created is not " +
			`yet a package that runs (${wrongVersion} / ${noDist} / ${badBridge})`,
		wrongVersion === "runtime-package-spec-mismatch" &&
			noDist === "runtime-compiled-dist-missing" &&
			badBridge === "runtime-check-bridge-failed",
	);
}

// ── 6. an incomplete runtime is never `runtime-ready` ──────────────────────────
{
	const missing = refusal(() =>
		install(world("bin-missing"), LOCK_A, fixtureAcquire({ omitBin: "entwurf-statusline" })),
	);
	const unexecutable = refusal(() =>
		install(world("bin-unexecutable"), LOCK_A, fixtureAcquire({ unexecutableBin: "entwurf-bridge" })),
	);
	ok(
		"[QK:HRB-RUNTIME-COMPLETE] every required bin must be present AND executable before a runtime is called ready — " +
			"the install runs with `--ignore-scripts`, so the chmod a package's own postinstall would have done never " +
			"happened, and the scoped wiring above names these as absolute commands: one that is missing or not " +
			`executable is a harness whose configured command does not run (missing=${missing} unexecutable=${unexecutable} required=${JSON.stringify(REQUIRED_BINS)})`,
		missing === "runtime-required-bin-missing" && unexecutable === "runtime-required-bin-missing",
	);
}

// ── 7. the lock's SHAPE is named before any field is read ──────────────────────
{
	const dir = reclaimOnExit(fs.mkdtempSync(path.join(os.tmpdir(), "entwurf-hrb-lock-")));
	const read = (body: string): string | null => {
		fs.writeFileSync(path.join(dir, "runtime-lock.json"), body);
		return refusal(() => readRuntimeLock(dir));
	};
	const cells: Record<string, string | null> = {
		"json-null": read("null"),
		array: read("[]"),
		string: read('"0.21.0"'),
		number: read("42"),
		truncated: read("{ not json"),
	};
	const verdicts = Object.entries(cells).map(([k, v]) => `${k}=${v}`);
	ok(
		"[QK:HRB-LOCK-SHAPE-NAMED] the lock's shape is checked before any field is read — `JSON.parse` returns null, an " +
			"array and a scalar just as happily as an object, and reaching for `.schemaVersion` on one of those leaks a " +
			"native TypeError with no code. This is the one file that says WHICH package gets installed, so an unnamed " +
			`crash there is the worst place in this module to lose a refusal's name (${verdicts.join(" ")})`,
		Object.values(cells).every((v) => v === "runtime-lock-unreadable"),
	);
}

// ── 8. the npm artifact is locked, and that lock agrees with the checkout ──────
{
	const drifted = fixtureCheckout({ ...LOCK_A, version: "9.9.9" });
	const incoherent = refusal(() =>
		bootstrapRuntime({ env: world("incoherent"), lock: LOCK_A, checkoutRoot: drifted, acquire: fixtureAcquire() }),
	);
	const env = world("provenance");
	const result = install(env);
	const identity = result.journal.artifactIdentity;
	ok(
		"[QK:HRB-ARTIFACT-LOCK] an npm-sourced lock names the exact package and the integrity npm published for it, and " +
			"it must agree with the checkout's own package.json — a lock that drifts from the checkout installs a version " +
			"nobody here reviewed. The ready identity keeps `expectedIntegrity` and `observedDigest` as SEPARATE fields: a " +
			"digest computed from whatever arrived records what happened, and calling it a pin would claim a check only " +
			`the comparison performs (incoherent=${incoherent} identity=${JSON.stringify(identity)})`,
		incoherent === "runtime-lock-incoherent" &&
			identity.kind === "npm" &&
			identity.expectedIntegrity === LOCK_A.integrity &&
			identity.observedDigest !== identity.expectedIntegrity &&
			typeof identity.observedDigest === "string",
	);
}

// ── 8a. the COMMITTED lock is coherent with this checkout, whichever source it names ──
{
	const lock = readRuntimeLock(PLUGIN_DIR);
	const checkout = readCheckoutPackageSpec(REPO);
	const requested = requestedArtifactIdentity({
		lock,
		checkoutRoot: REPO,
		resolveCommit: () => COMMIT_A,
	});
	const npmCoherent = lock.source !== "npm" || (lock.name === checkout.name && lock.version === checkout.version);
	const dir = reclaimOnExit(fs.mkdtempSync(path.join(os.tmpdir(), "entwurf-hrb-source-")));
	const read = (body: unknown): string | null => {
		fs.writeFileSync(path.join(dir, "runtime-lock.json"), `${JSON.stringify(body)}\n`);
		return refusal(() => readRuntimeLock(dir));
	};
	const cells: Record<string, string | null> = {
		"no-source": read({ schemaVersion: 2, name: PACKAGE, version: "0.21.0", integrity: "sha512-x" }),
		"unknown-source": read({ schemaVersion: 2, source: "github-release", repository: CHECKOUT_REPOSITORY }),
		"npm-keys-on-checkout": read({
			schemaVersion: 2,
			source: "herdr-checkout",
			repository: CHECKOUT_REPOSITORY,
			integrity: "sha512-x",
		}),
		"v1-lock": read({ schemaVersion: 1, name: PACKAGE, version: "0.21.0", integrity: "sha512-x" }),
	};
	const verdicts = Object.entries(cells).map(([k, v]) => `${k}=${v}`);
	ok(
		"[QK:HRB-LOCK-SOURCE-CLOSED] the lock's `source` is a CLOSED discriminant, the committed lock resolves to a " +
			"requested identity of exactly that kind, and an absent source, an unknown source, one source wearing the " +
			"other's keys, and a previous schema version are each refused by name — which source a host acquires from may " +
			"not be decided by an environment variable, a caller flag or a fallback, because all three let whoever is " +
			"running choose the acquisition authority, and a fallback in particular would turn an unreachable source into " +
			`'install something else instead' (source=${lock.source} kinds=${JSON.stringify(ARTIFACT_KINDS)} requested=${JSON.stringify(requested)} npm-coherent=${npmCoherent} ${verdicts.join(" ")})`,
		ARTIFACT_KINDS.includes(lock.source) &&
			requested.kind === lock.source &&
			artifactStage(requested) === "requested" &&
			npmCoherent &&
			cells["no-source"] === "runtime-lock-source-unknown" &&
			cells["unknown-source"] === "runtime-lock-source-unknown" &&
			cells["npm-keys-on-checkout"] === "runtime-lock-unreadable" &&
			cells["v1-lock"] === "runtime-lock-unreadable",
	);
}

// ── 8b. the repository is a literal on both sides of the wire ──────────────────
{
	const dir = reclaimOnExit(fs.mkdtempSync(path.join(os.tmpdir(), "entwurf-hrb-repo-")));
	fs.writeFileSync(
		path.join(dir, "runtime-lock.json"),
		`${JSON.stringify({ schemaVersion: 2, source: "herdr-checkout", repository: "someone/else" })}\n`,
	);
	const lockRepo = refusal(() => readRuntimeLock(dir));
	const identityRepo = refusal(() =>
		certifyArtifactIdentity("borrowed", { kind: "herdr-checkout", repository: "someone/else", commit: COMMIT_A }),
	);
	ok(
		"[QK:HRB-CHECKOUT-REPO-LITERAL] a repository that is not this plugin's is refused where the LOCK is read AND " +
			"wherever an identity is read back — journal, carried previous runtime, activation ledger — so a strange tree " +
			"cannot become ours by being transcribed into a record. Herdr's own remote is a hardcoded " +
			"`https://github.com/{owner}/{repo}.git` with no override (measured, `src/cli/plugin.rs:763`), and binding " +
			`this side to the same literal is what keeps the pair closed (lock=${lockRepo} identity=${identityRepo})`,
		lockRepo === "runtime-checkout-repository-foreign" && identityRepo === "runtime-checkout-repository-foreign",
	);
}

// ── 9. npm fills OUR cache, never the operator's ───────────────────────────────
{
	const env = world("cache");
	const layout = resolveRuntimeLayout(env);
	const hostile = { ...env, npm_config_cache: path.join(env.HOME as string, ".npm") };
	const pinned = npmEnvironment(hostile, layout.cacheDir);
	install(env);
	const strayRoots = fs
		.readdirSync(env.HOME as string)
		.filter((e) => e !== "data" && e !== "cache")
		.sort();
	ok(
		"[QK:HRB-OWNED-NPM-CACHE] the acquisition environment pins `npm_config_cache` to the Entwurf-owned XDG cache " +
			"and an inherited operator cache setting cannot win — a plugin install that fills the user's default npm " +
			"cache has written megabytes into a root it was never given, and an inverse cannot tell those bytes from " +
			"the ones the operator's own installs put there. The transaction itself also creates NOTHING under HOME " +
			`outside the two XDG roots (pinned=${pinned.npm_config_cache === layout.cacheDir} stray=${JSON.stringify(strayRoots)})`,
		pinned.npm_config_cache === layout.cacheDir &&
			layout.cacheDir === path.join(env.XDG_CACHE_HOME as string, "entwurf", "herdr-plugin", "npm") &&
			strayRoots.length === 0,
	);
}

// ── 10. nothing this plugin installs may run install scripts ───────────────────
{
	const installArgv = buildInstallArgv("/tmp/pkg.tgz", "/tmp/prefix");
	const packArgv = buildPackArgv({ name: PACKAGE, version: "0.21.0" }, "/tmp/cache");
	ok(
		"[QK:HRB-INSTALL-SCRIPTS-OFF] the install argv carries `--ignore-scripts`, and the artifact is a LOCAL tarball " +
			"packed at an exact spec with `--json` so its filename and bytes can be checked before use — a Herdr user " +
			"who typed one plugin command did not ask to run a package's arbitrary postinstall hook in their own HOME, " +
			`and never saw an npm prompt to decline (install=${JSON.stringify(installArgv)} pack=${JSON.stringify(packArgv)})`,
		installArgv.includes("--ignore-scripts") &&
			installArgv[1] === "/tmp/pkg.tgz" &&
			installArgv.includes("--no-save") &&
			packArgv[1] === `${PACKAGE}@0.21.0` &&
			packArgv.includes("--json"),
	);
}

// ── 11. nothing at our address is moved without proof that it is ours ──────────
{
	const env = world("unowned");
	const layout = resolveRuntimeLayout(env);
	fs.mkdirSync(layout.activeDir, { recursive: true });
	fs.writeFileSync(path.join(layout.activeDir, "SOMEBODY-ELSES-FILE"), "not ours\n");
	const before = treeDigest(layout.activeDir);
	const unowned = refusal(() => install(env));
	const after = treeDigest(layout.activeDir);

	const foreign = world("foreign-root");
	const foreignLayout = resolveRuntimeLayout(foreign);
	install(foreign);
	const stolen = { ...(readCertifiedJournal(foreignLayout) as Journal), runtimeRoot: "/somewhere/else/active" };
	fs.writeFileSync(foreignLayout.journalPath, `${JSON.stringify(stolen)}\n`);
	const foreignRoot = refusal(() => readCertifiedJournal(foreignLayout));
	ok(
		"[QK:HRB-OWNER-STATE-CERTIFIED] a directory at our address with no certified journal behind it is somebody " +
			"else's until proven otherwise, and a journal naming a DIFFERENT root proves nothing about this host — the " +
			"journal is the only thing that makes these directories ours to rename away, and a refusal must leave the " +
			`bytes it refused to touch exactly as it found them (unowned=${unowned} preserved=${before === after} foreign-root=${foreignRoot})`,
		unowned === "runtime-owner-state-missing" && before === after && foreignRoot === "runtime-journal-foreign-root",
	);
}

// ── 12. the journal's SHAPE is certified, phase by phase ───────────────────────
{
	const env = world("journal-shape");
	const layout = resolveRuntimeLayout(env);
	install(env);
	const good = readCertifiedJournal(layout) as Journal;
	const write = (body: unknown): string | null => {
		fs.writeFileSync(layout.journalPath, `${JSON.stringify(body)}\n`);
		return refusal(() => readCertifiedJournal(layout));
	};
	const cells: Record<string, string | null> = {
		"json-null": write(null),
		array: write([good]),
		scalar: write("runtime-ready"),
		"missing-key": write({ schemaVersion: 2, phase: "runtime-ready" }),
		"extra-key": write({ ...good, source: "npm" }),
		"wrong-schema": write({ ...good, schemaVersion: 1 }),
	};
	const verdicts = Object.entries(cells).map(([k, v]) => `${k}=${v}`);
	ok(
		"[QK:HRB-JOURNAL-SHAPE-CERTIFIED] a bare `null`, an array, a scalar, a missing key, an EXTRA key beside the one " +
			"identity field, and a previous schema version are ALL refused by one name — `JSON.parse` returning something " +
			"is not the same as a journal, an entry that is accepted becomes authority to delete a user's directories, " +
			"and a second identity-ish field beside `artifactIdentity` would be a second authority that could disagree " +
			`with the first (${verdicts.join(" ")} keys=${JSON.stringify(JOURNAL_KEYS)})`,
		Object.values(cells).every((v) => v === "runtime-journal-uncertified"),
	);
}

// ── 13. a failing candidate leaves the previous runtime exactly as it was ──────
{
	const env = world("rollback");
	const layout = resolveRuntimeLayout(env);
	install(env);
	const before = treeDigest(layout.activeDir);
	const code = refusal(() => install(env, LOCK_B, fixtureAcquire({ exitCode: 9 })));
	const after = treeDigest(layout.activeDir);
	ok(
		"[QK:HRB-FAILED-CANDIDATE-PRESERVES-ACTIVE] a candidate that fails verification leaves the running runtime " +
			"byte-identical and leaves no staging or backup directory behind — the failure mode this prevents is the " +
			"worst one available here: a host whose wiring names an address that was emptied on behalf of an upgrade " +
			`that never arrived (refusal=${code} identical=${before === after} staging=${fs.existsSync(layout.stagingDir)} previous=${fs.existsSync(layout.previousDir)})`,
		code === "runtime-check-bridge-failed" &&
			before === after &&
			before !== "<absent>" &&
			!fs.existsSync(layout.stagingDir) &&
			!fs.existsSync(layout.previousDir),
	);
}

// ── 14. the last good runtime is never lost ────────────────────────────────────
{
	// (a) the crash window itself: active renamed away, staging not yet renamed in.
	const torn = world("torn");
	const tornLayout = resolveRuntimeLayout(torn);
	install(torn);
	const tornGood = treeDigest(tornLayout.activeDir);
	fs.renameSync(tornLayout.activeDir, tornLayout.previousDir);
	const tornState = assessRuntimeState(tornLayout, readCertifiedJournal(tornLayout)).state;
	const tornCode = refusal(() => install(torn, LOCK_B, fixtureAcquire({ exitCode: 9 })));
	const tornAfter = treeDigest(tornLayout.activeDir);

	// (b) the one the coordinator measured: active is CORRUPT and previous is the last good copy.
	const corrupt = world("corrupt-active");
	const corruptLayout = resolveRuntimeLayout(corrupt);
	install(corrupt);
	fs.cpSync(corruptLayout.activeDir, corruptLayout.previousDir, { recursive: true });
	fs.rmSync(path.join(corruptLayout.activeDir, "node_modules", PACKAGE, "package.json"));
	const corruptState = assessRuntimeState(corruptLayout, readCertifiedJournal(corruptLayout)).state;
	const corruptCode = refusal(() => install(corrupt, LOCK_B, fixtureAcquire({ exitCode: 9 })));
	const corruptRescued = inspectInstalledRuntime(corruptLayout.activeDir, PACKAGE).ok;

	// (c) all three present, active corrupt: the candidate is dropped, the backup still wins.
	const three = world("three-corrupt");
	const threeLayout = resolveRuntimeLayout(three);
	install(three);
	fs.cpSync(threeLayout.activeDir, threeLayout.previousDir, { recursive: true });
	fs.mkdirSync(path.join(threeLayout.stagingDir, "half"), { recursive: true });
	fs.rmSync(path.join(threeLayout.activeDir, "node_modules", PACKAGE, "package.json"));
	const threeState = assessRuntimeState(threeLayout, readCertifiedJournal(threeLayout)).state;
	refusal(() => install(three, LOCK_B, fixtureAcquire({ exitCode: 9 })));
	const threeRescued = inspectInstalledRuntime(threeLayout.activeDir, PACKAGE).ok;

	ok(
		"[QK:HRB-LAST-GOOD-NEVER-LOST] a backup is the last good runtime until inspection says otherwise, so it is " +
			"restored when the active tree is missing OR corrupt and it is never dropped merely because a sibling " +
			"directory exists — measured on the first cut of this module: with a corrupt active beside a good previous " +
			"it deleted the backup first, then failed to acquire a candidate, and the host ended the run with zero " +
			`usable runtimes at the address its wiring names (torn=${tornState}/${tornCode}/restored=${tornAfter === tornGood} corrupt=${corruptState}/${corruptCode}/rescued=${corruptRescued} three=${threeState}/rescued=${threeRescued})`,
		tornState === "torn-swap" &&
			tornCode === "runtime-check-bridge-failed" &&
			tornAfter === tornGood &&
			tornGood !== "<absent>" &&
			corruptState === "backup-pending" &&
			corruptCode === "runtime-check-bridge-failed" &&
			corruptRescued &&
			threeState === "backup-pending-with-candidate" &&
			threeRescued,
	);
}

// ── 15. all eight presence combinations have a name, and none leaves residue ───
{
	const cases: { tag: string; arrange: (l: Layout) => void; expect: string }[] = [
		{ tag: "000", arrange: (l) => fs.rmSync(l.activeDir, { recursive: true }), expect: "owned-empty" },
		{ tag: "001", arrange: (l) => fs.renameSync(l.activeDir, l.previousDir), expect: "torn-swap" },
		{
			tag: "010",
			arrange: (l) => {
				fs.mkdirSync(path.join(l.stagingDir, "half"), { recursive: true });
				fs.rmSync(l.activeDir, { recursive: true });
			},
			expect: "abandoned-candidate",
		},
		{
			tag: "011",
			arrange: (l) => {
				fs.renameSync(l.activeDir, l.previousDir);
				fs.mkdirSync(path.join(l.stagingDir, "half"), { recursive: true });
			},
			expect: "torn-swap-with-candidate",
		},
		{ tag: "100", arrange: () => {}, expect: "settled" },
		{
			tag: "101",
			arrange: (l) => fs.cpSync(l.activeDir, l.previousDir, { recursive: true }),
			expect: "backup-pending",
		},
		{
			tag: "110",
			arrange: (l) => fs.mkdirSync(path.join(l.stagingDir, "half"), { recursive: true }),
			expect: "stale-candidate",
		},
		{
			tag: "111",
			arrange: (l) => {
				fs.cpSync(l.activeDir, l.previousDir, { recursive: true });
				fs.mkdirSync(path.join(l.stagingDir, "half"), { recursive: true });
			},
			expect: "backup-pending-with-candidate",
		},
	];
	const rows: string[] = [];
	let allClean = true;
	for (const c of cases) {
		const env = world(`combo-${c.tag}`);
		const layout = resolveRuntimeLayout(env);
		install(env);
		c.arrange(layout);
		const assessed = assessRuntimeState(layout, readCertifiedJournal(layout));
		install(env);
		const residue = fs.existsSync(layout.stagingDir) || fs.existsSync(layout.previousDir);
		rows.push(`${c.tag}=${assessed.state}${residue ? "/RESIDUE" : ""}`);
		if (assessed.state !== c.expect || residue) allClean = false;
	}
	ok(
		"[QK:HRB-ALL-STATES-NAMED] every one of the eight active/staging/previous combinations has its own name and " +
			"none of them survives the next install — an unnamed combination is a branch nobody decided, which is how a " +
			"half-written candidate silently becomes the next runtime and how a host that repaired itself becomes " +
			`indistinguishable from one that never broke (${rows.join(" ")})`,
		allClean && rows.length === 8,
	);
}

// ── 16. the provenance of the runtime being replaced is carried, not overwritten ─
{
	const env = world("provenance-carry");
	const layout = resolveRuntimeLayout(env);
	const first = install(env);
	const acquireDies = () => {
		throw new Error("the process died during acquisition");
	};
	refusal(() => install(env, LOCK_B, acquireDies));
	const torn = readCertifiedJournal(layout);
	// `artifactStage` reads the KEYS off what it is handed, so asking it about a provenance that is
	// missing throws a TypeError from inside the condition — the gate would die on the exact input
	// this claim exists to refuse, and the red would carry someone else's name. Absence is a stage
	// answer here, and the assertion judges it.
	const stageOf = (identity: unknown): string | null =>
		identity !== null && typeof identity === "object" ? artifactStage(identity as ArtifactIdentity) : null;
	ok(
		"[QK:HRB-PROVENANCE-CARRIED] writing the `installing` entry carries the finished runtime's provenance into " +
			"`previousRuntime` instead of overwriting it — a host that dies mid-install otherwise holds a backup " +
			"directory and no statement of what is in it, which is recoverable bytes with unrecoverable provenance; a " +
			`finished install sets it back to null because there is then no previous runtime to describe (ready.previous=${JSON.stringify(first.journal.previousRuntime)} torn.phase=${torn?.phase} torn.identity=${JSON.stringify(torn?.artifactIdentity)} torn.previous=${JSON.stringify(torn?.previousRuntime)})`,
		first.journal.previousRuntime === null &&
			torn?.phase === "installing" &&
			stageOf(torn.artifactIdentity) === "requested" &&
			torn.artifactIdentity.version === LOCK_B.version &&
			stageOf(torn.previousRuntime) === "ready" &&
			torn.previousRuntime?.version === LOCK_A.version &&
			torn.previousRuntime?.observedDigest === first.journal.artifactIdentity.observedDigest,
	);
}

// ── 17. the same exact runtime is not acquired twice ───────────────────────────
{
	const env = world("idempotent");
	let calls = 0;
	const counted = (args: AcquireArgs) => {
		calls++;
		return fixtureAcquire()(args);
	};
	const first = install(env, LOCK_A, counted);
	const second = install(env, LOCK_A, counted);
	ok(
		"[QK:HRB-IDEMPOTENT-REINSTALL] a reinstall of the SAME exact spec over a journal-and-disk-backed runtime " +
			"acquires nothing and replaces nothing — Herdr's own reinstall is the explicit refresh trigger this product " +
			"depends on, so the common case is a plugin reinstall on a host that already has the right runtime, and a " +
			`transaction that re-downloads and re-swaps there makes the safe operation the expensive one (calls=${calls} changed=${first.changed}/${second.changed})`,
		first.changed === true && second.changed === false && calls === 1,
	);
}

// ── 18. a journal the disk does not back is not believed ───────────────────────
{
	const env = world("reconcile");
	const layout = resolveRuntimeLayout(env);
	install(env);
	fs.rmSync(path.join(layout.activeDir, "node_modules", PACKAGE, "package.json"));
	const journalBefore = readCertifiedJournal(layout);
	const repaired = install(env);
	ok(
		"[QK:HRB-JOURNAL-MUST-MATCH-DISK] a `runtime-ready` journal is believed only while the active tree still " +
			"verifies — the journal is a record of an intention that completed, not evidence that the bytes are still " +
			"there, and the reconciliation that makes an externally-damaged install recoverable is exactly this " +
			`re-verification; trusting the record alone turns one bad state into a permanent one (before=${journalBefore?.phase} changed=${repaired.changed})`,
		journalBefore?.phase === "runtime-ready" &&
			repaired.changed === true &&
			fs.existsSync(path.join(layout.activeDir, "node_modules", PACKAGE, "package.json")),
	);
}

// ── 19. the inverse removes only what it can prove, runtime last ───────────────
{
	const foreign = world("inverse-foreign");
	const foreignLayout = resolveRuntimeLayout(foreign);
	fs.mkdirSync(foreignLayout.activeDir, { recursive: true });
	fs.writeFileSync(path.join(foreignLayout.activeDir, "SOMEBODY-ELSES-FILE"), "not ours\n");
	const beforeForeign = treeDigest(foreignLayout.activeDir);
	const refused = refusal(() => removeOwnedRuntime({ env: foreign }));
	const afterForeign = treeDigest(foreignLayout.activeDir);

	const clean = world("inverse-clean");
	const cleanLayout = resolveRuntimeLayout(clean);
	install(clean);
	fs.mkdirSync(cleanLayout.cacheDir, { recursive: true });
	fs.writeFileSync(path.join(cleanLayout.cacheDir, "tarball.tgz"), "cached\n");
	const result = removeOwnedRuntime({ env: clean });
	ok(
		"[QK:HRB-INVERSE-STATE-BACKED] the inverse establishes every deletion authority BEFORE the first deletion, " +
			"refuses an address it cannot prove is ours without touching a byte, and removes cache → runtime → journal " +
			"so the ledger outlives what it authorised — Herdr has no cleanup hook (measured: the plugin manifest has " +
			"six sections and none of them is an uninstall), so this is the only inverse that will ever run, and one " +
			`that deletes as it checks leaves a host half-removed with nothing recording where it stopped (refusal=${refused} untouched=${beforeForeign === afterForeign} removed=${JSON.stringify(result.removed)})`,
		refused === "runtime-inverse-foreign-refused" &&
			beforeForeign === afterForeign &&
			JSON.stringify(result.removed) === JSON.stringify(["cache", "runtime", "journal"]) &&
			!fs.existsSync(cleanLayout.runtimeRoot) &&
			!fs.existsSync(cleanLayout.journalPath) &&
			!fs.existsSync(cleanLayout.cacheDir),
	);
}

// ── 20. this slice never claims Herdr's commit ─────────────────────────────────
{
	const env = world("no-claim");
	const layout = resolveRuntimeLayout(env);
	const result = install(env);
	const rejected = refusal(() => writeJournal(layout, { phase: "herdr-installed" }));
	ok(
		"[QK:HRB-NO-HERDR-CLAIM] success is recorded as `runtime-ready` and `herdr-installed` is not a phase this " +
			"module can write — `[[build]]` finishes BEFORE Herdr re-reads the manifest, swaps its checkout and " +
			"registers the plugin, so at the moment this transaction succeeds nobody knows whether Herdr will commit; " +
			"a journal that says the plugin is installed would be a claim about a step that had not run, and the next " +
			`install would reconcile against a lie (phase=${result.phase} phases=${JSON.stringify(JOURNAL_PHASES)} rejected=${rejected})`,
		result.phase === "runtime-ready" &&
			!JOURNAL_PHASES.includes("herdr-installed") &&
			rejected === "runtime-journal-phase-unknown",
	);
}

// ── 21. one identity union, exact per kind AND per stage ──────────────────────
{
	const readyNpm = {
		kind: "npm",
		name: PACKAGE,
		version: "0.21.0",
		expectedIntegrity: "sha512-x",
		observedDigest: `sha256-${"a".repeat(64)}`,
	};
	const readyCheckout = {
		kind: "herdr-checkout",
		repository: CHECKOUT_REPOSITORY,
		commit: COMMIT_A,
		packageName: PACKAGE,
		packageVersion: "0.21.0",
		observedDigest: `sha256-${"b".repeat(64)}`,
	};
	const cells: Record<string, string | null> = {
		"npm-ready-as-requested": refusal(() => certifyArtifactIdentity("x", readyNpm, "requested")),
		"npm-requested-as-ready": refusal(() =>
			certifyArtifactIdentity(
				"x",
				{ kind: "npm", name: PACKAGE, version: "0.21.0", expectedIntegrity: "sha512-x" },
				"ready",
			),
		),
		"checkout-keys-on-npm": refusal(() =>
			certifyArtifactIdentity("x", { ...readyNpm, repository: CHECKOUT_REPOSITORY }, "ready"),
		),
		"npm-keys-on-checkout": refusal(() => certifyArtifactIdentity("x", { ...readyCheckout, name: PACKAGE }, "ready")),
		"unknown-kind": refusal(() => certifyArtifactIdentity("x", { ...readyNpm, kind: "github-release" }, "ready")),
		"short-commit": refusal(() => certifyArtifactIdentity("x", { ...readyCheckout, commit: "abc" }, "ready")),
		"uppercase-commit": refusal(() =>
			certifyArtifactIdentity("x", { ...readyCheckout, commit: COMMIT_A.toUpperCase().replace(/1/g, "A") }, "ready"),
		),
		"blank-completeness": refusal(() =>
			certifyArtifactIdentity("x", { ...readyCheckout, packageVersion: "  " }, "ready"),
		),
		"bad-digest": refusal(() =>
			certifyArtifactIdentity("x", { ...readyCheckout, observedDigest: "sha256-nope" }, "ready"),
		),
		nullish: refusal(() => certifyArtifactIdentity("x", null, "ready")),
	};
	const accepted =
		JSON.stringify(ARTIFACT_KEYS.npm) ===
			JSON.stringify({
				requested: ["kind", "name", "version", "expectedIntegrity"],
				ready: ["kind", "name", "version", "expectedIntegrity", "observedDigest"],
			}) &&
		JSON.stringify(ARTIFACT_KEYS["herdr-checkout"]) ===
			JSON.stringify({
				requested: ["kind", "repository", "commit"],
				ready: ["kind", "repository", "commit", "packageName", "packageVersion", "observedDigest"],
			}) &&
		certifyArtifactIdentity("x", readyNpm, "ready").kind === "npm" &&
		certifyArtifactIdentity("x", readyCheckout, "ready").kind === "herdr-checkout" &&
		artifactStage(readyCheckout) === "ready" &&
		artifactCompleteness(readyCheckout).version === "0.21.0" &&
		artifactCompleteness(readyNpm).name === PACKAGE;
	const completenessOfRequested = refusal(() =>
		artifactCompleteness({ kind: "herdr-checkout", repository: CHECKOUT_REPOSITORY, commit: COMMIT_A }),
	);
	const verdicts = Object.entries(cells).map(([k, v]) => `${k}=${v}`);
	ok(
		"[QK:HRB-ARTIFACT-IDENTITY-EXACT] one identity union, with an EXACT key set per kind and per stage: a ready " +
			"shape where a request belongs, a request where a ready belongs, either kind wearing the other's keys, an " +
			"unknown kind, a short or upper-case commit, a blank completeness pair and a malformed digest are each " +
			"refused — a union that merged the two sources would have to accept a null integrity or a null commit, in " +
			"which 'not observed yet' and 'this source has no such fact' become the same value, and a REQUESTED identity " +
			`must not be able to answer what is on disk at all (${verdicts.join(" ")} accepted=${accepted} completeness-of-requested=${completenessOfRequested})`,
		Object.values(cells).every((v) => v === "runtime-artifact-identity-uncertified") &&
			accepted &&
			completenessOfRequested === "runtime-artifact-identity-uncertified",
	);
}

// ── 22. for a checkout, the COMMIT decides — never the version ────────────────
{
	const env = world("commit-decides");
	let calls = 0;
	const counted = (args: AcquireArgs) => {
		calls++;
		return fixtureAcquire()(args);
	};
	const first = install(env, CHECKOUT_LOCK, counted, COMMIT_A);
	const again = install(env, CHECKOUT_LOCK, counted, COMMIT_A);
	// SAME package version, DIFFERENT commit: the fixture package is 0.21.0 in both runs.
	const rebuilt = install(env, CHECKOUT_LOCK, counted, COMMIT_B);
	const identity = rebuilt.journal.artifactIdentity;
	const sameVersionDifferentCommit = !sameArtifactRequest(first.journal.artifactIdentity, {
		kind: "herdr-checkout",
		repository: CHECKOUT_REPOSITORY,
		commit: COMMIT_B,
	});
	const crossSource = !sameArtifactRequest(rebuilt.journal.artifactIdentity, {
		kind: "npm",
		name: PACKAGE,
		version: "0.21.0",
		expectedIntegrity: "sha512-fixtureA",
	});
	ok(
		"[QK:HRB-IDENTITY-COMMIT-DECIDES] a checkout-sourced runtime is identified by its COMMIT: the same commit twice " +
			"acquires nothing, and a NEW commit carrying the same package version is reinstalled rather than skipped — " +
			"two commits can both call themselves 0.21.0, so a version comparison would let the previous candidate keep " +
			"serving while every receipt above it named the new one, which is the silence this whole lane exists to " +
			`prevent; a different SOURCE is never the same artifact either (calls=${calls} changed=${first.changed}/${again.changed}/${rebuilt.changed} commit=${identity.commit?.slice(0, 8)} version=${identity.packageVersion} distinct=${sameVersionDifferentCommit} cross-source=${crossSource})`,
		calls === 2 &&
			first.changed === true &&
			again.changed === false &&
			rebuilt.changed === true &&
			identity.kind === "herdr-checkout" &&
			identity.commit === COMMIT_B &&
			identity.packageVersion === "0.21.0" &&
			identity.repository === CHECKOUT_REPOSITORY &&
			sameVersionDifferentCommit &&
			crossSource,
	);
}

// ── 23. the commit is read from the checkout, canonically ─────────────────────
{
	let asked: string[] = [];
	const git = (result: Partial<SpawnLike>) => ({
		spawn: (_bin: string, argv: string[]): SpawnLike => {
			asked = argv;
			return { status: 0, stdout: "", stderr: "", ...result } as SpawnLike;
		},
	});
	const resolved = resolveCheckoutCommit("/checkout", git({ stdout: `${COMMIT_A}\n` }));
	const short = refusal(() => resolveCheckoutCommit("/checkout", git({ stdout: "abc1234\n" })));
	const empty = refusal(() => resolveCheckoutCommit("/checkout", git({ stdout: "\n" })));
	const failed = refusal(() =>
		resolveCheckoutCommit("/checkout", git({ status: 128, stderr: "not a git repository" })),
	);
	const missing = refusal(() =>
		resolveCheckoutCommit("/checkout", {
			spawn: () => ({ status: null, stdout: "", stderr: "", error: new Error("spawn git ENOENT") }),
		}),
	);
	ok(
		"[QK:HRB-CHECKOUT-COMMIT-CANONICAL] the candidate's commit comes from the checkout itself via " +
			"`rev-parse --verify HEAD^{commit}` — `--verify` refuses an ambiguous or missing revision instead of echoing " +
			"the argument back, and `^{commit}` resolves a tag down to the commit, so what lands in the identity is a " +
			"full 40-hex commit or a named refusal. A shallow clone answers this exactly as a full one does, which is " +
			`what makes Herdr's own managed checkout usable (argv=${JSON.stringify(asked)} resolved=${resolved.slice(0, 8)} short=${short} empty=${empty} failed=${failed} missing=${missing})`,
		JSON.stringify(asked) === JSON.stringify(["-C", "/checkout", "rev-parse", "--verify", "HEAD^{commit}"]) &&
			resolved === COMMIT_A &&
			short === "runtime-checkout-commit-unresolvable" &&
			empty === "runtime-checkout-commit-unresolvable" &&
			failed === "runtime-checkout-commit-unresolvable" &&
			missing === "runtime-checkout-commit-unresolvable",
	);
}

// ── 24. the product pack argv is the fixed remote at that commit, and no other form ──
{
	const identity = { kind: "herdr-checkout", repository: CHECKOUT_REPOSITORY, commit: COMMIT_A };
	const argv = buildCheckoutPackArgv(identity, "/tmp/cache");
	const source = fs.readFileSync(LEAF, "utf8");
	const packLiterals = (source.match(/"pack",/g) ?? []).length;
	ok(
		"[QK:HRB-CHECKOUT-ARGV-FIXED] the only checkout acquisition is `npm pack git+https://github.com/" +
			"junghan0611/entwurf.git#<full sha>` — a fixed remote, a full commit, `--json`, our own pack destination, and " +
			"NO `--ignore-scripts`, because on a git spec npm runs `prepare` (which compiles the bridge) and not " +
			"`prepack`; measured 2026-09-16 on npm 11.16.0, where the same command produced a byte-identical tarball " +
			"across three sandboxes including a shallow clone. The DIRECTORY form is structurally absent: it runs " +
			"`prepack`, which calls pnpm and exits 127 on a clean host, so this module builds exactly two pack argvs and " +
			`neither of them is a path (argv=${JSON.stringify(argv)} pack-literals=${packLiterals})`,
		JSON.stringify(argv) ===
			JSON.stringify([
				"pack",
				`git+https://github.com/${CHECKOUT_REPOSITORY}.git#${COMMIT_A}`,
				"--json",
				"--pack-destination",
				"/tmp/cache",
				"--no-audit",
				"--no-fund",
			]) &&
			buildCheckoutRemote(CHECKOUT_REPOSITORY) === `git+https://github.com/${CHECKOUT_REPOSITORY}.git` &&
			!argv.includes("--ignore-scripts") &&
			packLiterals === 2,
	);
}

// ── 25. a source that cannot serve the commit is named, never substituted ─────
{
	const bin = reclaimOnExit(fs.mkdtempSync(path.join(os.tmpdir(), "entwurf-hrb-npm-")));
	const fakeNpm = (body: string): string => {
		const p = path.join(bin, `npm-${createHash("sha256").update(body).digest("hex").slice(0, 8)}`);
		fs.writeFileSync(p, `#!/bin/sh\n${body}\n`);
		fs.chmodSync(p, 0o755);
		return p;
	};
	const env = world("source-unavailable");
	const layout = resolveRuntimeLayout(env);
	const identity = certifyArtifactIdentity(
		"x",
		{ kind: "herdr-checkout", repository: CHECKOUT_REPOSITORY, commit: COMMIT_A },
		"requested",
	);
	const args = { identity, prefix: path.join(env.HOME as string, "prefix"), cacheDir: layout.cacheDir, env };
	const remoteRefused = refusal(() =>
		checkoutAcquire({ ...args, npmBin: fakeNpm('echo "Could not read from remote repository" >&2; exit 128') }),
	);
	const noJson = refusal(() => checkoutAcquire({ ...args, npmBin: fakeNpm('echo "[]"; exit 0') }));
	const prefixUntouched = classifyPath(args.prefix);
	ok(
		"[QK:HRB-SOURCE-UNAVAILABLE-NAMED] a remote that cannot serve the commit, and a pack whose `--json` carries no " +
			"artifact, are ONE named refusal — `runtime-checkout-source-unavailable` — and nothing is installed in their " +
			"place. This is the branch where a fallback would be most tempting and most wrong: 'the commit is not there, " +
			"so install a registry version instead' would silently substitute an artifact nobody asked for, on the one " +
			`path whose entire purpose is verifying a specific commit (remote=${remoteRefused} no-json=${noJson} prefix=${prefixUntouched})`,
		remoteRefused === "runtime-checkout-source-unavailable" &&
			noJson === "runtime-checkout-source-unavailable" &&
			prefixUntouched === "absent",
	);
}

// ── 26. a cache we cannot prove is ours is not adopted ────────────────────────
{
	const env = world("cache-unowned");
	const layout = resolveRuntimeLayout(env);
	fs.mkdirSync(layout.cacheDir, { recursive: true });
	fs.writeFileSync(path.join(layout.cacheDir, "someone-elses.tgz"), "not ours\n");
	const before = treeDigest(layout.cacheDir);
	const refused = refusal(() => install(env));
	const after = treeDigest(layout.cacheDir);
	const assessed = assessRuntimeState(layout, null);
	ok(
		"[QK:HRB-CACHE-UNOWNED-REFUSED] a cache directory at our address with NO certified journal behind it is refused " +
			"by name and left byte-identical — the cache is the fourth thing this module deletes, and a transaction whose " +
			"first act on a strange host is reclaiming a tree it cannot prove it wrote has adopted somebody else's bytes " +
			`in order to tidy them away (state=${assessed.state} refusal=${refused} untouched=${before === after})`,
		assessed.state === "unowned-cache-residue" &&
			refused === "runtime-cache-unowned-residue" &&
			before === after &&
			before !== "<absent>",
	);
}

// ── 26a. the INVERSE reads that same ownership fact the same way ──────────────
{
	const env = world("inverse-cache-unowned");
	const layout = resolveRuntimeLayout(env);
	fs.mkdirSync(layout.cacheDir, { recursive: true });
	fs.writeFileSync(path.join(layout.cacheDir, "someone-elses.tgz"), "not ours\n");
	const before = treeDigest(layout.cacheDir);
	const refused = refusal(() => removeOwnedRuntime({ env }));
	const after = treeDigest(layout.cacheDir);
	ok(
		"[QK:HRB-INVERSE-CACHE-UNOWNED] the inverse refuses a journal-less cache by name, with its bytes untouched — the " +
			"forward transaction already refuses that exact state, and one ownership fact read two different ways is how " +
			"the careless side eventually deletes what the careful side would not: the inverse's plan BEGINS with this " +
			`directory, so 'nothing of ours, report success' is the wrong answer to give about it (refusal=${refused} untouched=${before === after})`,
		refused === "runtime-inverse-foreign-refused" && before === after && before !== "<absent>",
	);
}

// ── 27. a failed acquisition reclaims what IT wrote, and a retry is green ─────
{
	const env = world("cache-reclaim");
	const layout = resolveRuntimeLayout(env);
	install(env, CHECKOUT_LOCK, fixtureAcquire(), COMMIT_A);
	const goodTree = treeDigest(layout.activeDir);
	const goodJournal = readCertifiedJournal(layout) as Journal;
	const halfFetched = (args: AcquireArgs): AcquireResult => {
		fs.mkdirSync(args.cacheDir, { recursive: true });
		fs.writeFileSync(path.join(args.cacheDir, "half.tgz"), "truncated\n");
		throw new Error("the remote hung up mid-pack");
	};
	const code = refusal(() => install(env, CHECKOUT_LOCK, halfFetched, COMMIT_B));
	const afterFailure = {
		staging: classifyPath(layout.stagingDir),
		cache: classifyPath(layout.cacheDir),
		previous: classifyPath(layout.previousDir),
		active: treeDigest(layout.activeDir),
		journal: readCertifiedJournal(layout) as Journal,
	};
	const retry = install(env, CHECKOUT_LOCK, fixtureAcquire(), COMMIT_B);
	ok(
		"[QK:HRB-CACHE-FAILED-ACQUIRE-RECLAIMED] a failed acquisition reclaims the staging tree AND the cache this " +
			"transaction filled — its own `installing` journal is what proves both are ours — while the journal itself, " +
			"the backup and the last good runtime are preserved, so the retry that follows is green rather than tripping " +
			"over a truncated tarball nobody owns. The authority order is the point: the cache may be reclaimed only " +
			`AFTER the write that claims it, never before (refusal=${code} staging=${afterFailure.staging} cache=${afterFailure.cache} previous=${afterFailure.previous} active-preserved=${afterFailure.active === goodTree} journal=${afterFailure.journal.phase} retry=${retry.changed}/${retry.journal.artifactIdentity.commit?.slice(0, 8)})`,
		code !== null &&
			afterFailure.staging === "absent" &&
			afterFailure.cache === "absent" &&
			afterFailure.previous === "absent" &&
			afterFailure.active === goodTree &&
			goodTree !== "<absent>" &&
			afterFailure.journal.phase === "installing" &&
			afterFailure.journal.previousRuntime?.commit === COMMIT_A &&
			afterFailure.journal.previousRuntime?.observedDigest === goodJournal.artifactIdentity.observedDigest &&
			retry.changed === true &&
			retry.journal.phase === "runtime-ready" &&
			retry.journal.artifactIdentity.commit === COMMIT_B,
	);
}

// ── 28. OUR OWN lifecycle scripts may not write to the stdout this rail parses ─
{
	// `[측정 2026-09-17, oracle, npm 11.16.0 / node 24.18.1]` the checkout branch reads
	// `npm pack --json`'s STDOUT, and npm forwards a lifecycle script's stdout into that same
	// stream. Packing the product's own GitHub git spec runs `prepare` in a tree that has NO
	// `.git` — GitHub serves a codeload tarball rather than a clone — where husky v9 writes
	// `.git can't be found` with `p.stdout.write` (`husky/bin.js`), so the JSON arrives with
	// that sentence in front of it. Measured against the real remote at `ee535a17`: exit 0, a
	// perfectly good 13,017,411-byte tarball, and stdout beginning `.git can't be found`.
	// On the operator's clean host that became
	// `runtime-checkout-source-unavailable: npm pack --json was unreadable: Unexpected token '.'`.
	//
	// THE REFUSAL WAS RIGHT AND THE DEFECT WAS OURS, which is why this cell reads OUR
	// `package.json` instead of loosening the parser. Neither existing axis could see it: the
	// deterministic cells above drive a fake npm that emits clean JSON, and the LIVE gate
	// redirects the product remote to a local bare mirror through git's `insteadOf`
	// (`smoke-herdr-plugin-build-live.ts`) — a `file://` spec IS cloned, `.git` therefore
	// exists, and husky stays silent. The substitution removed the condition under test.
	const pkgScripts = (
		JSON.parse(fs.readFileSync(path.join(REPO, "package.json"), "utf8")) as { scripts: Record<string, string> }
	).scripts;
	const prepare = pkgScripts.prepare ?? "";
	const commands = prepare
		.split(/;|&&/)
		.map((part) =>
			part
				.trim()
				.replace(/\|\|\s*true$/, "")
				.trim(),
		)
		.filter((part) => part.length > 0);
	const polluting = commands.filter((command) => !/1>&2$/.test(command));
	ok(
		"[QK:HRB-PREPARE-STDOUT-CLEAN] every command in this package's `prepare` routes its STDOUT to stderr — npm " +
			"merges lifecycle stdout into the `npm pack --json` stream this rail parses, so one chatty script in our own " +
			"package turns a perfectly good artifact into `runtime-checkout-source-unavailable` on every clean host. " +
			"`2>/dev/null` is NOT this check and never was: husky writes its diagnostics to stdout, so silencing stderr " +
			"left the one stream that mattered wide open (measured 2026-09-17 against the real GitHub remote). Diagnostics " +
			`still reach the operator — they go to stderr, which npm does not parse (prepare=${JSON.stringify(prepare)} polluting=${JSON.stringify(polluting)})`,
		commands.length > 0 && polluting.length === 0,
	);
}

console.log(`\ncheck-herdr-runtime-bootstrap: ${passed} assertions passed`);
