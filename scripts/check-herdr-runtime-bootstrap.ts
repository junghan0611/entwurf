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
const LEAF = path.join(PLUGIN_DIR, "lib", "runtime-bootstrap.mjs");

interface Spec {
	name: string;
	version: string;
	integrity?: string;
}
interface Provenance {
	packageName: string;
	packageVersion: string;
	expectedIntegrity: string;
	observedDigest: string;
}
interface Journal {
	schemaVersion: number;
	phase: string;
	runtimeRoot: string;
	packageName: string;
	packageVersion: string;
	expectedIntegrity: string | null;
	observedDigest: string | null;
	previousRuntime: Provenance | null;
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
	spec: Spec;
	prefix: string;
	cacheDir: string;
	env: NodeJS.ProcessEnv;
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
	resolveRuntimeLayout: (env: NodeJS.ProcessEnv) => Layout;
	readCheckoutPackageSpec: (root: string) => Spec;
	readRuntimeLock: (pluginDir: string) => Spec & { integrity: string };
	certifyLockCoherence: (lock: Spec, spec: Spec) => Spec;
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
		spec: Spec;
		lock: Spec & { integrity: string };
		acquire?: unknown;
	}) => BootstrapResult;
	removeOwnedRuntime: (args: { env: NodeJS.ProcessEnv }) => { removed: string[]; reason: string | null };
}

const leaf = (await import(pathToFileURL(LEAF).href)) as Leaf;
const {
	REQUIRED_BINS,
	COMPILED_ENTRY,
	JOURNAL_PHASES,
	JOURNAL_KEYS,
	resolveRuntimeLayout,
	readCheckoutPackageSpec,
	assessRuntimeState,
	readCertifiedJournal,
	buildPackArgv,
	buildInstallArgv,
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

const LOCK_A = { name: "@junghanacs/entwurf", version: "0.21.0", integrity: "sha512-fixtureA" };
const LOCK_B = { name: "@junghanacs/entwurf", version: "0.22.0", integrity: "sha512-fixtureB" };

/** Materialise a fixture package into `prefix` the way npm would, and return an observed digest. */
function fixtureAcquire(
	opts: { version?: string; dist?: boolean; exitCode?: number; omitBin?: string; unexecutableBin?: string } = {},
) {
	return ({ spec, prefix }: AcquireArgs) => {
		const version = opts.version ?? spec.version;
		const root = path.join(prefix, "node_modules", spec.name);
		fs.mkdirSync(root, { recursive: true });
		fs.writeFileSync(path.join(root, "package.json"), `${JSON.stringify({ name: spec.name, version }, null, 2)}\n`);
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
		// a well-formed digest: the certified reader checks the SHAPE of provenance, not its truth
		return { observedDigest: `sha256-${createHash("sha256").update(version).digest("hex")}` };
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

function install(env: NodeJS.ProcessEnv, lock = LOCK_A, acquire = fixtureAcquire()): BootstrapResult {
	return bootstrapRuntime({ env, spec: { name: lock.name, version: lock.version }, lock, acquire });
}

// ── 1. the address the wiring will name is a real directory and it does not move ─
{
	const env = world("address");
	const layout = resolveRuntimeLayout(env);
	install(env);
	const first = fs.lstatSync(layout.activeDir);
	install(env, LOCK_B);
	const second = fs.lstatSync(layout.activeDir);
	ok(
		"[QK:HRB-STABLE-ADDRESS] the runtime address is a REAL DIRECTORY at $XDG_DATA_HOME/entwurf/herdr-plugin/" +
			"runtime/active and it is the same path after a version change — the scoped wiring one slice above records " +
			"ABSOLUTE commands under this root, and Pi records the owner root it was wired with, so a symlink whose " +
			"canonicalisation resolves to a per-version directory makes every upgrade look like a different owner " +
			`taking that root over (active=${path.relative(env.HOME as string, layout.activeDir)} symlink=${first.isSymbolicLink()}/${second.isSymbolicLink()})`,
		layout.activeDir === path.join(env.XDG_DATA_HOME as string, "entwurf", "herdr-plugin", "runtime", "active") &&
			first.isDirectory() &&
			!first.isSymbolicLink() &&
			second.isDirectory() &&
			!second.isSymbolicLink(),
	);
}

// ── 2. nothing is created before the judgement ─────────────────────────────────
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

// ── 3. disk facts come from lstat, and a link is never a directory ─────────────
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

// ── 4. the exact package, or a named refusal ───────────────────────────────────
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

// ── 5. an incomplete runtime is never `runtime-ready` ──────────────────────────
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

// ── 6. the lock's SHAPE is named before any field is read ──────────────────────
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

// ── 7. the artifact is locked, and the lock agrees with the checkout ───────────
{
	const lock = readRuntimeLock(PLUGIN_DIR);
	const checkout = readCheckoutPackageSpec(REPO);
	const incoherent = refusal(() =>
		bootstrapRuntime({
			env: world("incoherent"),
			spec: { name: lock.name, version: "9.9.9" },
			lock,
			acquire: fixtureAcquire(),
		}),
	);
	const env = world("provenance");
	const result = install(env);
	ok(
		"[QK:HRB-ARTIFACT-LOCK] the plugin-owned lock names the exact package and the integrity npm published for it, " +
			"and it must agree with this checkout's own package.json — a lock that drifts from the checkout installs a " +
			"version nobody here reviewed. The journal keeps `expectedIntegrity` and `observedDigest` as SEPARATE " +
			"fields: a digest computed from whatever arrived records what happened, and calling it a pin would claim a " +
			`check only the comparison performs (lock=${lock.name}@${lock.version} checkout=${checkout.name}@${checkout.version} incoherent=${incoherent})`,
		lock.name === checkout.name &&
			lock.version === checkout.version &&
			lock.integrity.startsWith("sha512-") &&
			incoherent === "runtime-lock-incoherent" &&
			result.journal.expectedIntegrity === LOCK_A.integrity &&
			result.journal.observedDigest !== result.journal.expectedIntegrity &&
			typeof result.journal.observedDigest === "string",
	);
}

// ── 8. npm fills OUR cache, never the operator's ───────────────────────────────
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

// ── 9. nothing this plugin installs may run install scripts ────────────────────
{
	const installArgv = buildInstallArgv("/tmp/pkg.tgz", "/tmp/prefix");
	const packArgv = buildPackArgv(LOCK_A, "/tmp/cache");
	ok(
		"[QK:HRB-INSTALL-SCRIPTS-OFF] the install argv carries `--ignore-scripts`, and the artifact is a LOCAL tarball " +
			"packed at an exact spec with `--json` so its filename and bytes can be checked before use — a Herdr user " +
			"who typed one plugin command did not ask to run a package's arbitrary postinstall hook in their own HOME, " +
			`and never saw an npm prompt to decline (install=${JSON.stringify(installArgv)} pack=${JSON.stringify(packArgv)})`,
		installArgv.includes("--ignore-scripts") &&
			installArgv[1] === "/tmp/pkg.tgz" &&
			installArgv.includes("--no-save") &&
			packArgv[1] === `${LOCK_A.name}@${LOCK_A.version}` &&
			packArgv.includes("--json"),
	);
}

// ── 10. nothing at our address is moved without proof that it is ours ──────────
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

// ── 11. the journal's SHAPE is certified, phase by phase ───────────────────────
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
		"missing-key": write({ schemaVersion: 1, phase: "runtime-ready" }),
		"installing-with-digest": write({ ...good, phase: "installing" }),
		"ready-without-digest": write({ ...good, observedDigest: null }),
		"blank-identity": write({ ...good, packageVersion: "   " }),
		"bogus-integrity": write({ ...good, expectedIntegrity: "not-a-hash" }),
	};
	const verdicts = Object.entries(cells).map(([k, v]) => `${k}=${v}`);
	ok(
		"[QK:HRB-JOURNAL-SHAPE-CERTIFIED] a bare `null`, an array, a scalar, a wrong key set, a blank package identity, " +
			"a malformed integrity, and any entry whose digest contradicts the writer state its own phase implies are " +
			"ALL refused by one name — `JSON.parse` returning something is not the same as a journal, and an entry that " +
			"is accepted becomes authority to delete a user's directories, so 'roughly the right shape' is the widest " +
			`hole this module could have (${verdicts.join(" ")})`,
		Object.values(cells).every((v) => v === "runtime-journal-uncertified"),
	);
}

// ── 12. a failing candidate leaves the previous runtime exactly as it was ──────
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

// ── 13. the last good runtime is never lost ────────────────────────────────────
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
	fs.rmSync(path.join(corruptLayout.activeDir, "node_modules", LOCK_A.name, "package.json"));
	const corruptState = assessRuntimeState(corruptLayout, readCertifiedJournal(corruptLayout)).state;
	const corruptCode = refusal(() => install(corrupt, LOCK_B, fixtureAcquire({ exitCode: 9 })));
	const corruptRescued = inspectInstalledRuntime(corruptLayout.activeDir, LOCK_A.name).ok;

	// (c) all three present, active corrupt: the candidate is dropped, the backup still wins.
	const three = world("three-corrupt");
	const threeLayout = resolveRuntimeLayout(three);
	install(three);
	fs.cpSync(threeLayout.activeDir, threeLayout.previousDir, { recursive: true });
	fs.mkdirSync(path.join(threeLayout.stagingDir, "half"), { recursive: true });
	fs.rmSync(path.join(threeLayout.activeDir, "node_modules", LOCK_A.name, "package.json"));
	const threeState = assessRuntimeState(threeLayout, readCertifiedJournal(threeLayout)).state;
	refusal(() => install(three, LOCK_B, fixtureAcquire({ exitCode: 9 })));
	const threeRescued = inspectInstalledRuntime(threeLayout.activeDir, LOCK_A.name).ok;

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

// ── 14. all eight presence combinations have a name, and none leaves residue ───
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

// ── 15. the provenance of the runtime being replaced is carried, not overwritten ─
{
	const env = world("provenance-carry");
	const layout = resolveRuntimeLayout(env);
	const first = install(env);
	const acquireDies = () => {
		throw new Error("the process died during acquisition");
	};
	refusal(() => install(env, LOCK_B, acquireDies));
	const torn = readCertifiedJournal(layout);
	ok(
		"[QK:HRB-PROVENANCE-CARRIED] writing the `installing` entry carries the finished runtime's provenance into " +
			"`previousRuntime` instead of overwriting it — a host that dies mid-install otherwise holds a backup " +
			"directory and no statement of what is in it, which is recoverable bytes with unrecoverable provenance; a " +
			`finished install sets it back to null because there is then no previous runtime to describe (ready.previous=${JSON.stringify(first.journal.previousRuntime)} torn.phase=${torn?.phase} torn.previous=${JSON.stringify(torn?.previousRuntime?.packageVersion)} torn.package=${torn?.packageVersion})`,
		first.journal.previousRuntime === null &&
			torn?.phase === "installing" &&
			torn.packageVersion === LOCK_B.version &&
			torn.previousRuntime?.packageVersion === LOCK_A.version &&
			torn.previousRuntime?.observedDigest === first.journal.observedDigest,
	);
}

// ── 16. the same exact runtime is not acquired twice ───────────────────────────
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

// ── 17. a journal the disk does not back is not believed ───────────────────────
{
	const env = world("reconcile");
	const layout = resolveRuntimeLayout(env);
	install(env);
	fs.rmSync(path.join(layout.activeDir, "node_modules", LOCK_A.name, "package.json"));
	const journalBefore = readCertifiedJournal(layout);
	const repaired = install(env);
	ok(
		"[QK:HRB-JOURNAL-MUST-MATCH-DISK] a `runtime-ready` journal is believed only while the active tree still " +
			"verifies — the journal is a record of an intention that completed, not evidence that the bytes are still " +
			"there, and the reconciliation that makes an externally-damaged install recoverable is exactly this " +
			`re-verification; trusting the record alone turns one bad state into a permanent one (before=${journalBefore?.phase} changed=${repaired.changed})`,
		journalBefore?.phase === "runtime-ready" &&
			repaired.changed === true &&
			fs.existsSync(path.join(layout.activeDir, "node_modules", LOCK_A.name, "package.json")),
	);
}

// ── 18. the inverse removes only what it can prove, runtime last ───────────────
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

// ── 19. this slice never claims Herdr's commit ─────────────────────────────────
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

console.log(`\ncheck-herdr-runtime-bootstrap: ${passed} assertions passed`);
