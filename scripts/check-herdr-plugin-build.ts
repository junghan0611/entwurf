/**
 * check-herdr-plugin-build — deterministic gate for the #116 M3-b3 build runner
 * (`plugins/herdr/lib/build.mjs`): the ONE thing Herdr's `[[build]]` calls, and the order in which
 * it composes integration status → profile → runtime → activation.
 *
 * WHAT IS REAL HERE AND WHAT IS A SEAM. There is no fake `herdr` binary in this repo and this gate
 * does not introduce one (same reason `check-mux-placement` has no fake tmux: a stand-in authors the
 * contract before anything is measured). The listing therefore arrives through the runner's OWN
 * `spawn` seam as a STRING — exactly the shape the measured 0.9.0 binary emits — and one cell drives
 * the REAL binary when the host has it, with a named SKIP when it does not.
 *
 * WHERE THE WRITERS ARE PROVEN, AND WHY NOT HERE. The bytes a two-stage `{pi}` → `{pi, claude-code}`
 * reinstall actually produces — Pi reconciled identically, Claude wired exactly once at the absolute
 * command, OpenCode untouched — are `check-herdr-activation`'s `HAC-TWO-STAGE-ADD-ONLY`, which
 * drives the real Pi writers. THIS gate proves the RUNNER: which backends it hands down, how many
 * times, that nothing outside `A` is ever named, and that the verb it calls is the INSTALLED one.
 * Duplicating the writer proof here would mean two places to keep true and one of them would rot.
 *
 * WHAT NEEDS THE NETWORK LIVES ELSEWHERE. A real checkout acquisition packs a git spec, which npm
 * builds by installing devDependencies from the registry. That is not a deterministic surface, so
 * the real `herdr plugin install` → real `npm pack git+https://…#<sha>` journey (with the product
 * argv redirected to a local bare clone through git `insteadOf`, and the remote-commit
 * available/unavailable pair) is `smoke-herdr-plugin-build-live`. Neither gate stands in for the
 * other, and this paragraph is where that boundary is named rather than implied.
 *
 * Each [QK:HPB-*] token appears exactly once, on the assertion that fails for that claim.
 */

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import * as HERDR_RAILS from "./herdr-rails.mjs";
import { reclaimOnExit } from "./lib/reclaim-on-exit.ts";
import { treeDigest } from "./lib/tree-digest.ts";

let passed = 0;
function ok(label: string, cond: boolean): void {
	assert.ok(cond, label);
	console.log(`  ok    ${label}`);
	passed++;
}

const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const PLUGIN_DIR = path.join(REPO, "plugins", "herdr");
const RUNNER = path.join(PLUGIN_DIR, "lib", "build.mjs");
const MANIFEST = path.join(PLUGIN_DIR, "herdr-plugin.toml");
const PACKAGE = "@junghanacs/entwurf";
const COMPILED_ENTRY = path.join("mcp", "entwurf-bridge", "dist", "mcp", "entwurf-bridge", "src", "index.js");
const COMMIT_A = "a".repeat(40);
const COMMIT_B = "b".repeat(40);

interface SpawnResult {
	status: number | null;
	stdout: string;
	stderr: string;
	error?: Error;
}
interface AcquireArgs {
	identity: Record<string, string>;
	prefix: string;
	cacheDir: string;
	env: NodeJS.ProcessEnv;
}
interface Runner {
	PLUGIN_DIR: string;
	certifyActivationPlan: (
		env: NodeJS.ProcessEnv,
		args: { lock: Record<string, string>; checkoutRoot: string; requested: string[]; resolveCommit?: () => string },
	) => { requested: Record<string, string>; disposition: string };
	CHECKOUT_ROOT: string;
	ACTIVATE_ENTRY: string;
	buildStatusArgv: () => string[];
	readIntegrationListing: (env: NodeJS.ProcessEnv, deps?: Record<string, unknown>) => string;
	resolveActivationEntry: (activeDir: string, packageName: string) => string;
	runBuild: (env: NodeJS.ProcessEnv, deps?: Record<string, unknown>) => number;
}
interface Profile {
	activate: string[];
	skip: { backend: string }[];
	observedOtherAtoms: string[];
}

const activation = (await import(pathToFileURL(path.join(REPO, "scripts", "herdr-activation.mjs")).href)) as {
	writeLedger: (layout: { stateRoot: string; ledgerPath: string }, entry: Record<string, unknown>) => void;
	ledgerBody: (args: Record<string, unknown>) => Record<string, unknown>;
	resolveActivationLayout: (env: NodeJS.ProcessEnv) => { stateRoot: string; ledgerPath: string };
	resolveComponentRoots: (env: NodeJS.ProcessEnv) => Record<string, { path: string; source: string }>;
};

const runner = (await import(pathToFileURL(RUNNER).href)) as Runner;
const { ACTIVATE_ENTRY, buildStatusArgv, readIntegrationListing, resolveActivationEntry, runBuild } = runner;
const profileLeaf = (await import(pathToFileURL(path.join(PLUGIN_DIR, "lib", "integration-profile.mjs")).href)) as {
	buildActivationProfile: (listing: string) => Profile;
};
const progressLeaf = (await import(pathToFileURL(path.join(PLUGIN_DIR, "lib", "build-progress.mjs")).href)) as {
	createProgressReporter: (deps: {
		openTty?: () => number;
		writeTty?: (fd: number, line: string) => void;
		closeTty?: (fd: number) => void;
		mirror?: (line: string) => void;
	}) => { live: boolean; step: (t: string) => void; done: (t: string) => void; close: () => void };
};

/** A listing in the exact prose shape measured on herdr 0.9.0 (#116 `issuecomment-5690462527`). */
function listing(rows: Record<string, string>): string {
	const all: Record<string, string> = {
		pi: "not installed (/home/u/.pi)",
		claude: "not installed (/home/u/.claude)",
		opencode: "current (v3) (/home/u/.config/opencode)",
		...rows,
	};
	return `${Object.entries(all)
		.map(([atom, state]) => `${atom}: ${state}`)
		.join("\n")}\n`;
}

function world(tag: string): NodeJS.ProcessEnv {
	const home = reclaimOnExit(fs.mkdtempSync(path.join(os.tmpdir(), `entwurf-hpb-${tag}-`)));
	return {
		HOME: home,
		XDG_DATA_HOME: path.join(home, "data"),
		XDG_CACHE_HOME: path.join(home, "cache"),
		XDG_STATE_HOME: path.join(home, "state"),
		PATH: process.env.PATH,
	};
}

function activeDirOf(env: NodeJS.ProcessEnv): string {
	return path.join(env.XDG_DATA_HOME as string, "entwurf", "herdr-plugin", "runtime", "active");
}
function journalPathOf(env: NodeJS.ProcessEnv): string {
	return path.join(env.XDG_DATA_HOME as string, "entwurf", "herdr-plugin", "journal.json");
}

/** A named refusal's code, or null when the call did not refuse. */
function refusalOf(fn: () => unknown): string | null {
	try {
		fn();
		return null;
	} catch (err) {
		return (err as { code?: string }).code ?? `unnamed:${String(err)}`;
	}
}

/** A checkout the npm branch's coherence check can read a name@version from. */
function fixtureCheckoutRoot(): string {
	const root = reclaimOnExit(fs.mkdtempSync(path.join(os.tmpdir(), "entwurf-hpb-checkout-")));
	fs.writeFileSync(path.join(root, "package.json"), `${JSON.stringify({ name: PACKAGE, version: "0.21.0" })}\n`);
	return root;
}

/** Every file under a root, relative and sorted — the zero-write oracle. */
function tree(root: string): string[] {
	const rows: string[] = [];
	const walk = (dir: string): void => {
		if (!fs.existsSync(dir)) return;
		for (const e of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
			const abs = path.join(dir, e.name);
			if (e.isDirectory()) walk(abs);
			else rows.push(path.relative(root, abs));
		}
	};
	walk(root);
	return rows;
}

/**
 * The fixture ARTIFACT: what an acquisition puts in the staging prefix. `activate` decides what the
 * installed package's activation verb is — absent, incapable (exits 0 on an empty request), or a
 * faithful recorder that refuses an empty request by name and logs the argv it was given.
 */
function fixtureAcquire(opts: { activate: "absent" | "incapable" | "recorder"; log?: string; fail?: boolean }) {
	return ({ identity, prefix }: AcquireArgs) => {
		const version = identity.version ?? "0.21.0";
		const root = path.join(prefix, "node_modules", PACKAGE);
		fs.mkdirSync(path.join(root, path.dirname(COMPILED_ENTRY)), { recursive: true });
		fs.writeFileSync(path.join(root, "package.json"), `${JSON.stringify({ name: PACKAGE, version })}\n`);
		fs.writeFileSync(path.join(root, COMPILED_ENTRY), "// compiled entry fixture\n");
		const bin = path.join(prefix, "node_modules", ".bin");
		fs.mkdirSync(bin, { recursive: true });
		for (const name of ["entwurf", "entwurf-bridge", "entwurf-statusline"]) {
			fs.writeFileSync(path.join(bin, name), "#!/bin/sh\nexit 0\n");
			fs.chmodSync(path.join(bin, name), 0o755);
		}
		if (opts.activate !== "absent") {
			const entry = path.join(root, ACTIVATE_ENTRY);
			fs.mkdirSync(path.dirname(entry), { recursive: true });
			const body =
				opts.activate === "incapable"
					? ["process.exit(0);"]
					: [
							"import fs from 'node:fs';",
							"const argv = process.argv.slice(2);",
							"if (argv.length === 0) {",
							"  process.stderr.write('[stub] activation-backend-outside-p: name at least one backend\\n');",
							"  process.exit(1);",
							"}",
							`fs.appendFileSync(${JSON.stringify(opts.log ?? "/dev/null")}, argv.join(',') + '\\n');`,
							`process.exit(${opts.fail ? 7 : 0});`,
						];
			fs.writeFileSync(entry, `${body.join("\n")}\n`);
		}
		return {
			observedDigest: `sha256-${createHash("sha256")
				.update(identity.commit ?? "x")
				.digest("hex")}`,
			packageName: PACKAGE,
			packageVersion: version,
		};
	};
}

/**
 * Drive the runner with the listing arriving through its own spawn seam. Every OTHER spawn — the
 * capability probe and the activation call — goes to the real `spawnSync`, because those are the
 * calls this gate is actually about.
 */
const HERDR_STUB = "herdr-stub";
function drive(
	env: NodeJS.ProcessEnv,
	text: string | { error: string } | { status: number; stderr: string },
	deps: Record<string, unknown> = {},
): { code: number | null; refusal: string | null; out: string; progress: string[] } {
	let out = "";
	// The operator's terminal is a SEAM here, never the real `/dev/tty`: a gate that narrated into
	// whatever terminal happened to be running it would be writing outside its own sandbox.
	const progressLines: string[] = [];
	const progress = {
		live: false,
		step: (text: string) => progressLines.push(text),
		done: (text: string) => progressLines.push(`done: ${text}`),
		note: (text: string) => progressLines.push(`note: ${text}`),
		close: () => {},
	};
	const spawn = (bin: string, argv: string[], opts: unknown): SpawnResult => {
		if (bin === HERDR_STUB) {
			if (typeof text === "string") return { status: 0, stdout: text, stderr: "" };
			if ("error" in text) return { status: null, stdout: "", stderr: "", error: new Error(text.error) };
			return { status: text.status, stdout: "", stderr: text.stderr };
		}
		return spawnSync(bin, argv, opts as Record<string, never>) as unknown as SpawnResult;
	};
	try {
		const code = runBuild(env, {
			herdrBin: HERDR_STUB,
			spawn,
			write: (t: string) => (out += t),
			progress,
			...deps,
		});
		return { code, refusal: null, out, progress: progressLines };
	} catch (err) {
		return {
			code: null,
			refusal: (err as { code?: string }).code ?? `not-a-HerdrBuildError:${String(err)}`,
			out,
			progress: progressLines,
		};
	}
}

// ── 1. the manifest names exactly one runner, and nothing else grew ────────────
{
	const manifest = fs.readFileSync(MANIFEST, "utf8");
	const buildSections = (manifest.match(/^\[\[build\]\]$/gm) ?? []).length;
	const commandLines = manifest
		.split("\n")
		.filter((l) => l.startsWith("command ="))
		.map((l) => l.trim());
	const shipped = (JSON.parse(fs.readFileSync(path.join(REPO, "package.json"), "utf8")) as { files: string[] }).files;
	const forbidden = ["[[startup]]", "[[events]]", "[[actions]]", "[[link_handlers]]"].filter((s) =>
		manifest.includes(`\n${s}`),
	);
	ok(
		"[QK:HPB-MANIFEST-ONE-RUNNER] Herdr's `[[build]]` calls exactly ONE command — `node lib/build.mjs`, argv not a " +
			"shell string — and the runner is a CHECKOUT file that the npm package deliberately does not ship, because a " +
			"build only ever runs in a checkout while everything that must outlive Herdr's uninstall lives under " +
			"`scripts/`. The sections this plugin refuses are still absent: a startup hook would volunteer on every " +
			`server start and an event hook is exactly where a watcher would grow (build-sections=${buildSections} commands=${JSON.stringify(commandLines)} forbidden=${JSON.stringify(forbidden)} plugins-shipped=${shipped.some((f) => f.startsWith("plugins"))})`,
		buildSections === 1 &&
			commandLines.includes('command = ["node", "lib/build.mjs"]') &&
			commandLines.length === 2 &&
			forbidden.length === 0 &&
			fs.existsSync(RUNNER) &&
			!shipped.some((f) => f.startsWith("plugins")) &&
			shipped.includes("scripts/"),
	);
}

// ── 2. no herdr, or a herdr that cannot answer, is a named refusal ─────────────
{
	const missingEnv = world("no-binary");
	const missing = drive(missingEnv, { error: "spawn herdr ENOENT" });
	const failedEnv = world("status-failed");
	const failed = drive(failedEnv, { status: 2, stderr: "usage: herdr integration status [--outdated-only]" });
	const residue = [...tree(missingEnv.HOME as string), ...tree(failedEnv.HOME as string)];
	ok(
		"[QK:HPB-BINARY-REQUIRED] a missing `herdr` and a `herdr integration status` that exits non-zero are two " +
			"different named refusals, and neither invents a listing — status exits 0 in every state it can describe " +
			"(measured on 0.9.0), so a non-zero exit is not a verdict about any harness: it means we do not have the " +
			"listing, and an empty stand-in would read as 'nothing is integrated' and quietly activate nothing while " +
			`reporting success (missing=${missing.refusal} failed=${failed.refusal} argv=${JSON.stringify(buildStatusArgv())} residue=${JSON.stringify(residue)})`,
		missing.refusal === "herdr-build-binary-missing" &&
			failed.refusal === "herdr-build-status-unavailable" &&
			JSON.stringify(buildStatusArgv()) === JSON.stringify(["integration", "status"]) &&
			residue.length === 0,
	);
}

// ── 3. a selected atom Herdr cannot serve fails BEFORE any runtime work ────────
{
	const cells: Record<string, { refusal: string | null; residue: number }> = {};
	const failRows: Record<string, Record<string, string>> = {
		outdated: { pi: "outdated (legacy < v8) (/home/u/.pi)" },
		"needs-repair": { pi: "needs repair (v8) (/home/u/.pi)" },
		malformed: { pi: "current (v8" },
		duplicate: {},
	};
	for (const [tag, rows] of Object.entries(failRows)) {
		const env = world(`fail-${tag}`);
		const text =
			tag === "duplicate" ? `${listing({ pi: "current (v8) (/home/u/.pi)" })}pi: current (v8) (/x)\n` : listing(rows);
		const r = drive(env, text, { acquire: fixtureAcquire({ activate: "recorder" }), resolveCommit: () => COMMIT_A });
		cells[tag] = { refusal: r.refusal, residue: tree(env.HOME as string).length };
	}
	const verdicts = Object.entries(cells).map(([k, v]) => `${k}=${v.refusal}/${v.residue}`);
	ok(
		"[QK:HPB-SELECTED-FAIL-BEFORE-BOOTSTRAP] `outdated`, `needs repair`, a malformed row and a duplicate " +
			"declaration for a SELECTED atom each fail by name before one byte of runtime work — and `outdated " +
			"(legacy < vN)` is exactly the catch-all an empty or unreadable integration file produces (measured), so " +
			"treating it as absence would install a runtime for a harness whose integration cannot run it. The refusal " +
			`arrives with the runtime address still untouched (${verdicts.join(" ")})`,
		cells.outdated.refusal === "herdr-build-selected-integration-unusable" &&
			cells["needs-repair"].refusal === "herdr-build-selected-integration-unusable" &&
			cells.malformed.refusal === "herdr-status-row-malformed" &&
			cells.duplicate.refusal === "herdr-status-row-duplicate" &&
			Object.values(cells).every((v) => v.residue === 0),
	);
}

// ── 4. nothing integrated is a clean exit 0 that writes nothing ────────────────
{
	const env = world("empty-a");
	const r = drive(env, listing({}), {
		acquire: fixtureAcquire({ activate: "recorder" }),
		resolveCommit: () => COMMIT_A,
	});
	const profile = profileLeaf.buildActivationProfile(listing({}));
	ok(
		"[QK:HPB-EMPTY-A-ZERO-WRITE] a host where neither Pi nor Claude is integrated gets exit 0 and ZERO writes — no " +
			"runtime, no wiring and above all no removal. A Herdr user in that state asked for nothing; a plugin that " +
			"tore something down, or installed a runtime for nobody, would be acting on an absence. OpenCode is reported " +
			`as observed and never planned (code=${r.code} residue=${JSON.stringify(tree(env.HOME as string))} activate=${JSON.stringify(profile.activate)} observed=${JSON.stringify(profile.observedOtherAtoms)} out=${JSON.stringify(r.out.trim())})`,
		r.code === 0 &&
			tree(env.HOME as string).length === 0 &&
			profile.activate.length === 0 &&
			profile.observedOtherAtoms.includes("opencode") &&
			r.out.includes("nothing to activate") &&
			r.out.includes("opencode"),
	);
}

// ── 5. the activation verb is the INSTALLED one, and it must be capable ────────
{
	const absentEnv = world("entry-absent");
	const absent = drive(absentEnv, listing({ pi: "current (v8) (/home/u/.pi)" }), {
		acquire: fixtureAcquire({ activate: "absent" }),
		resolveCommit: () => COMMIT_A,
	});
	const incapableEnv = world("entry-incapable");
	const incapable = drive(incapableEnv, listing({ pi: "current (v8) (/home/u/.pi)" }), {
		acquire: fixtureAcquire({ activate: "incapable" }),
		resolveCommit: () => COMMIT_A,
	});
	const okEnv = world("entry-ok");
	const log = path.join(okEnv.HOME as string, "argv.log");
	const good = drive(okEnv, listing({ pi: "current (v8) (/home/u/.pi)" }), {
		acquire: fixtureAcquire({ activate: "recorder", log }),
		resolveCommit: () => COMMIT_A,
	});
	const failEnv = world("entry-fails");
	const failed = drive(failEnv, listing({ pi: "current (v8) (/home/u/.pi)" }), {
		acquire: fixtureAcquire({ activate: "recorder", log: path.join(failEnv.HOME as string, "argv.log"), fail: true }),
		resolveCommit: () => COMMIT_A,
	});
	const resolved = resolveActivationEntry(activeDirOf(okEnv), PACKAGE);
	const source = fs.readFileSync(RUNNER, "utf8");
	const namesCheckoutVerb = /CHECKOUT_ROOT[^\n]*herdr-plugin-activate|PACKAGE_ROOT/.test(source);
	ok(
		"[QK:HPB-INSTALLED-ENTRY-ONLY] the activation verb is resolved UNDER the stable runtime that was just " +
			"installed — never in this checkout, which Herdr deletes on uninstall while calling no cleanup hook, so a " +
			"checkout-side activation would be undoable only by code that is about to vanish and would prove nothing " +
			"about the artifact just placed. An absent entry and one that exits 0 on an empty request are separate named " +
			"refusals: the capability probe's evidence IS the named refusal, and a file that succeeds on an empty " +
			`request is not this verb (absent=${absent.refusal} incapable=${incapable.refusal} ok=${good.code}/logged=${fs.readFileSync(log, "utf8").trim().length > 0} entry-under-runtime=${resolved.startsWith(activeDirOf(okEnv))} component-failure=${failed.refusal} checkout-verb-referenced=${namesCheckoutVerb})`,
		absent.refusal === "herdr-build-activation-entry-missing" &&
			incapable.refusal === "herdr-build-activation-entry-incapable" &&
			good.code === 0 &&
			fs.readFileSync(log, "utf8").trim().length > 0 &&
			resolved === path.join(activeDirOf(okEnv), "node_modules", PACKAGE, ACTIVATE_ENTRY) &&
			failed.refusal === "herdr-build-activation-failed" &&
			!namesCheckoutVerb,
	);
}

// ── 6. the two-stage journey, as the RUNNER composes it ────────────────────────
{
	const env = world("two-stage");
	const log = path.join(env.HOME as string, "argv.log");
	let acquisitions = 0;
	const counted = (args: AcquireArgs) => {
		acquisitions++;
		return fixtureAcquire({ activate: "recorder", log })(args);
	};
	const stage1 = drive(env, listing({ pi: "current (v8) (/home/u/.pi)" }), {
		acquire: counted,
		resolveCommit: () => COMMIT_A,
	});
	const stage2 = drive(env, listing({ pi: "current (v8) (/home/u/.pi)", claude: "current (v5) (/home/u/.claude)" }), {
		acquire: counted,
		resolveCommit: () => COMMIT_A,
	});
	const stage3 = drive(env, listing({ pi: "current (v8) (/home/u/.pi)", claude: "current (v5) (/home/u/.claude)" }), {
		acquire: counted,
		resolveCommit: () => COMMIT_B,
	});
	const calls = fs.readFileSync(log, "utf8").trim().split("\n");
	const journal = JSON.parse(fs.readFileSync(journalPathOf(env), "utf8")) as {
		artifactIdentity: { kind: string; version: string };
	};
	ok(
		"[QK:HPB-SEQUENTIAL-TWO-STAGE] the sequence a real operator performs, as the runner composes it: `{pi}` first, " +
			"then `{pi, claude-code}` after they integrated Claude Code, then the same exact npm lock again. " +
			"The locked artifact acquires once while the widened set is still reconciled on each reinstall. " +
			"OpenCode is present in every listing and appears in NO activation argv — the bytes those activations write " +
			"are `check-herdr-activation`'s HAC-TWO-STAGE-ADD-ONLY, which drives the real Pi writers; what this cell owns " +
			`is what the runner hands down (codes=${stage1.code}/${stage2.code}/${stage3.code} acquisitions=${acquisitions} calls=${JSON.stringify(calls)} identity=${journal.artifactIdentity.kind}@${journal.artifactIdentity.version})`,
		stage1.code === 0 &&
			stage2.code === 0 &&
			stage3.code === 0 &&
			acquisitions === 1 &&
			JSON.stringify(calls) === JSON.stringify(["pi", "pi,claude-code", "pi,claude-code"]) &&
			!calls.some((c) => c.includes("opencode")) &&
			journal.artifactIdentity.kind === "npm" &&
			journal.artifactIdentity.version === "0.25.0",
	);
}

// ── 6a. the authority check happens BEFORE any runtime work ───────────────────
{
	const IDENTITY = (seed: string) => ({
		kind: "npm",
		name: PACKAGE,
		version: "0.25.0",
		expectedIntegrity:
			"sha512-6Cm5qFZiR8OtqSszcfv/bhxhFlLL0dmeBOnBp3wnnL5JOI6e68anEG3SUuUXKK7CuCaM4S+ft7H8vgVKw4vDhg==",
		observedDigest: `sha256-${createHash("sha256").update(seed).digest("hex")}`,
	});
	/** A host that already has a runtime at commit A and a ledger that says so. */
	const seeded = (tag: string, backends: string[]): NodeJS.ProcessEnv => {
		const env = world(tag);
		const log = path.join(env.HOME as string, "argv.log");
		drive(env, listing({ pi: "current (v8) (/home/u/.pi)" }), {
			acquire: fixtureAcquire({ activate: "recorder", log }),
			resolveCommit: () => COMMIT_A,
		});
		const states: Record<string, string> = {};
		for (const b of backends) states[b] = "active";
		const artifactIdentity = (
			JSON.parse(fs.readFileSync(journalPathOf(env), "utf8")) as {
				artifactIdentity: Record<string, unknown>;
			}
		).artifactIdentity;
		activation.writeLedger(
			activation.resolveActivationLayout(env),
			activation.ledgerBody({
				phase: "active",
				runtimeRoot: activeDirOf(env),
				artifactIdentity,
				roots: activation.resolveComponentRoots(env),
				states,
			}),
		);
		return env;
	};
	// CONTENT, mode and topology — not a list of names. A same-length in-place edit passes a
	// path/size comparison, and "this refusal changed nothing" is exactly the claim such an edit
	// would falsify.
	const snapshot = (env: NodeJS.ProcessEnv) => ({
		runtime: treeDigest(activeDirOf(env)),
		journal: fs.readFileSync(journalPathOf(env), "utf8"),
		ledger: fs.readFileSync(activation.resolveActivationLayout(env).ledgerPath, "utf8"),
		cache: treeDigest(path.join(env.XDG_CACHE_HOME as string, "entwurf", "herdr-plugin", "npm")),
		activations: fs.readFileSync(path.join(env.HOME as string, "argv.log"), "utf8"),
	});
	const unchanged = (env: NodeJS.ProcessEnv, before: ReturnType<typeof snapshot>) =>
		JSON.stringify(snapshot(env)) === JSON.stringify(before);

	// THE ORACLE'S OWN PROOF, in the cell whose whole claim rests on it. The first cut of this
	// oracle compared sorted paths and sizes and called that byte-identical; a same-length in-place
	// edit — the shape an in-place rewrite actually has — passed it. So: an identical copy must
	// digest the same, and flipping ONE byte without changing any length must digest differently,
	// along with a mode change and an emptied (rather than removed) directory.
	const oracleRoot = reclaimOnExit(fs.mkdtempSync(path.join(os.tmpdir(), "entwurf-hpb-oracle-")));
	fs.mkdirSync(path.join(oracleRoot, "nested", "deep"), { recursive: true });
	fs.writeFileSync(path.join(oracleRoot, "nested", "deep", "a.txt"), "AAAA");
	fs.writeFileSync(path.join(oracleRoot, "nested", "b.sh"), "#!/bin/sh\nexit 0\n");
	fs.chmodSync(path.join(oracleRoot, "nested", "b.sh"), 0o755);
	const oracleBase = treeDigest(oracleRoot);
	const oracleCopy = reclaimOnExit(fs.mkdtempSync(path.join(os.tmpdir(), "entwurf-hpb-oracle-copy-")));
	fs.cpSync(oracleRoot, oracleCopy, { recursive: true });
	const sameTree = treeDigest(oracleCopy) === oracleBase;
	fs.writeFileSync(path.join(oracleRoot, "nested", "deep", "a.txt"), "AAAB"); // SAME length
	const sameLengthEditSeen = treeDigest(oracleRoot) !== oracleBase;
	fs.writeFileSync(path.join(oracleRoot, "nested", "deep", "a.txt"), "AAAA");
	const restored = treeDigest(oracleRoot) === oracleBase;
	fs.chmodSync(path.join(oracleRoot, "nested", "b.sh"), 0o644);
	const modeSeen = treeDigest(oracleRoot) !== oracleBase;
	fs.chmodSync(path.join(oracleRoot, "nested", "b.sh"), 0o755);
	fs.rmSync(path.join(oracleRoot, "nested", "deep", "a.txt"));
	const emptiedDirSeen = treeDigest(oracleRoot) !== oracleBase;
	const oracleHonest = sameTree && sameLengthEditSeen && restored && modeSeen && emptiedDirSeen;

	// (a) a SOURCE switch: the committed lock would name checkout over the active npm runtime.
	// (a) is asked of the SHARED authority directly: the runner reads its lock from the committed
	// file, and this gate does not add a seam that would let any caller choose the source.
	const src = seeded("plan-source", ["pi"]);
	const srcBefore = snapshot(src);
	const srcRefusal = refusalOf(() =>
		runner.certifyActivationPlan(src, {
			lock: { source: "herdr-checkout", repository: "junghan0611/entwurf" },
			checkoutRoot: fixtureCheckoutRoot(),
			requested: ["pi"],
			resolveCommit: () => COMMIT_A,
		}),
	);
	const srcUnchanged = unchanged(src, srcBefore);

	// (b) a new commit whose request DROPS a backend the ledger holds.
	const drop = seeded("plan-drop", ["pi", "claude-code"]);
	const dropBefore = snapshot(drop);
	let dropAcquired = 0;
	const dropDrive = drive(drop, listing({ pi: "current (v8) (/home/u/.pi)" }), {
		acquire: (args: AcquireArgs) => {
			dropAcquired++;
			return fixtureAcquire({ activate: "recorder", log: path.join(drop.HOME as string, "argv.log") })(args);
		},
		readRuntimeLock: () => ({
			source: "npm",
			name: PACKAGE,
			version: "0.25.0",
			integrity: "sha512-AR2VCui7JjK3w56rQSDs3AuAJMMuiXCNWH7HB52SQ3E/7p0oPhcxD+fb6Gdzi0VcBnheqxPzvJHMPQQcdYtNiw==",
		}),
		resolveCommit: () => COMMIT_B,
	});

	// (c) the ledger and the runtime already disagree — nobody rebound an earlier replacement.
	const torn = seeded("plan-torn", ["pi"]);
	const tornLedger = activation.resolveActivationLayout(torn).ledgerPath;
	fs.writeFileSync(
		tornLedger,
		`${JSON.stringify(
			{
				...(JSON.parse(fs.readFileSync(tornLedger, "utf8")) as Record<string, unknown>),
				artifactIdentity: {
					...IDENTITY(COMMIT_B),
					expectedIntegrity:
						"sha512-AR2VCui7JjK3w56rQSDs3AuAJMMuiXCNWH7HB52SQ3E/7p0oPhcxD+fb6Gdzi0VcBnheqxPzvJHMPQQcdYtNiw==",
				},
			},
			null,
			2,
		)}\n`,
	);
	const tornBefore = snapshot(torn);
	let tornAcquired = 0;
	const tornDrive = drive(torn, listing({ pi: "current (v8) (/home/u/.pi)" }), {
		acquire: (args: AcquireArgs) => {
			tornAcquired++;
			return fixtureAcquire({ activate: "recorder", log: path.join(torn.HOME as string, "argv.log") })(args);
		},
		resolveCommit: () => COMMIT_A,
	});

	// (d) the LEGAL case still passes: same exact npm source and lock, request covers the ledger.
	// The authority is asked on the PRE-install state, which is the only state it is ever asked about.
	const legal = seeded("plan-legal", ["pi"]);
	const legalPlan = runner.certifyActivationPlan(legal, {
		lock: { source: "npm", name: PACKAGE, version: "0.25.0", integrity: IDENTITY("x").expectedIntegrity },
		checkoutRoot: REPO,
		requested: ["pi"],
	});
	const legalDrive = drive(legal, listing({ pi: "current (v8) (/home/u/.pi)" }), {
		acquire: fixtureAcquire({ activate: "recorder", log: path.join(legal.HOME as string, "argv.log") }),
		resolveCommit: () => COMMIT_B,
	});

	ok(
		"[QK:HPB-PRE-BOOTSTRAP-AUTHORITY] the activation authority is asked BEFORE any runtime work, through the SAME " +
			"shipped functions the installed verb runs: a source switch, a request that drops an activated " +
			"backend, and a ledger that already disagrees with the runtime standing there are each refused with the " +
			"runtime tree, its journal, our cache, the ledger and the activation log ALL byte-identical and the " +
			"acquisition never called. The first cut bootstrapped first and let the installed verb refuse afterwards, " +
			"which left the stable root holding an artifact no record accounted for while the run reported failure — and " +
			"the harness wiring names that root, not the version, so it resolved to those bytes anyway. " +
			"UNCHANGED here means content + mode + topology, hashed: this cell proves its own oracle, because the first " +
			"cut of it compared paths and sizes and a same-length in-place edit walked straight through " +
			`(oracle-honest=${oracleHonest}/same-tree=${sameTree}/same-length-edit-seen=${sameLengthEditSeen}/mode-seen=${modeSeen}/emptied-dir-seen=${emptiedDirSeen} source=${srcRefusal}/unchanged=${srcUnchanged} dropped=${dropDrive.refusal}/acquired=${dropAcquired}/unchanged=${unchanged(drop, dropBefore)} torn=${tornDrive.refusal}/acquired=${tornAcquired}/unchanged=${unchanged(torn, tornBefore)} legal=${legalDrive.code}/${legalPlan.disposition})`,
		oracleHonest &&
			srcRefusal === "activation-artifact-source-drifted" &&
			srcUnchanged &&
			dropDrive.refusal === "activation-rebind-refused" &&
			dropAcquired === 0 &&
			unchanged(drop, dropBefore) &&
			tornDrive.refusal === "activation-runtime-ledger-mismatch" &&
			tornAcquired === 0 &&
			unchanged(torn, tornBefore) &&
			legalDrive.code === 0 &&
			legalPlan.disposition === "match",
	);
}

// ── 6b. what landed must be what the authority admitted ───────────────────────
{
	const env = world("d1-d2-drift");
	const log = path.join(env.HOME as string, "argv.log");
	const commits = [COMMIT_A, COMMIT_B, COMMIT_B];
	let call = 0;
	const moving = () => commits[Math.min(call++, commits.length - 1)] as string;
	// Candidate source is a closed, retained branch. This test seam does not expose a caller input:
	// production `runBuild` reads only the committed lock, while the gate drives the branch whose
	// identity can move between D1 and D2.
	const drifted = drive(env, listing({ pi: "current (v8) (/home/u/.pi)" }), {
		acquire: fixtureAcquire({ activate: "recorder", log }),
		readRuntimeLock: () => ({ source: "herdr-checkout", repository: "junghan0611/entwurf" }),
		resolveCommit: moving,
	});
	const journal = JSON.parse(fs.readFileSync(journalPathOf(env), "utf8")) as { artifactIdentity: { commit: string } };
	const activated = fs.existsSync(log) ? fs.readFileSync(log, "utf8").trim() : "";
	ok(
		"[QK:HPB-BOOTSTRAP-IDENTITY-EXACT] the artifact that lands must be EXACTLY the one the authority check admitted: " +
			"when the candidate source moves between the judgement and the install, the run refuses by name instead of handing the " +
			"installed activation verb a different artifact than the one this build was cleared to place — the verb would " +
			"then re-judge, and pass or fail on a question nobody asked. The refusal is honest about what did happen: the " +
			`runtime was replaced, and NO activation ran (refusal=${drifted.refusal} landed=${journal.artifactIdentity.commit.slice(0, 8)} admitted=${COMMIT_A.slice(0, 8)} activations=${JSON.stringify(activated)})`,
		drifted.refusal === "herdr-build-artifact-drifted" &&
			journal.artifactIdentity.commit === COMMIT_B &&
			activated === "",
	);
}

// ── 7. the runner claims nothing about Herdr's own commit ──────────────────────
{
	const env = world("post-build-gap");
	const log = path.join(env.HOME as string, "argv.log");
	const rows = { pi: "current (v8) (/home/u/.pi)" };
	const first = drive(env, listing(rows), {
		acquire: fixtureAcquire({ activate: "recorder", log }),
		resolveCommit: () => COMMIT_A,
	});
	const journalAfter = fs.readFileSync(journalPathOf(env), "utf8");
	const runtimeAfter = tree(activeDirOf(env));
	// Herdr's own commit now FAILS: it reclaims its temp checkout and leaves its registry on the
	// previous entry. Nothing of ours is called — there is no cleanup hook — so the runtime and the
	// activation we performed simply remain. The next successful install must reconcile them.
	const second = drive(env, listing(rows), {
		acquire: fixtureAcquire({ activate: "recorder", log }),
		resolveCommit: () => COMMIT_A,
	});
	const calls = fs.readFileSync(log, "utf8").trim().split("\n");
	const journalPreserved = fs.readFileSync(journalPathOf(env), "utf8") === journalAfter;
	ok(
		"[QK:HPB-POST-BUILD-GAP] Herdr commits its checkout and registry only AFTER a successful build, so this runner " +
			"records `runtime-ready` and says NOTHING about Herdr's registry: when Herdr's own commit then fails, the " +
			"runtime and the activation it performed REMAIN — Herdr has no cleanup hook to call — and the next " +
			"successful install reconciles them rather than duplicating them. This is a NAMED GAP, not an atomic " +
			`transaction, and the receipt above it must not say otherwise (first=${first.code} second=${second.code} journal-preserved=${journalPreserved} runtime=${runtimeAfter.length} calls=${JSON.stringify(calls)} out=${JSON.stringify(second.out.trim().split("\n")[0])})`,
		first.code === 0 &&
			second.code === 0 &&
			journalPreserved &&
			runtimeAfter.length > 0 &&
			JSON.stringify(calls) === JSON.stringify(["pi", "pi"]) &&
			!/herdr-installed|registered|registry/i.test(first.out) &&
			second.out.includes("already exact"),
	);
}

// ── 8. the REAL binary's listing, when this host has one ───────────────────────
{
	const probe = spawnSync("herdr", ["--version"], { encoding: "utf8" });
	if (probe.error || probe.status !== 0) {
		if (process.env.ENTWURF_REQUIRE_HERDR === "1") {
			assert.fail(
				"[QK:HPB-REAL-STATUS-PARSES] ENTWURF_REQUIRE_HERDR=1 and no usable `herdr` on PATH: absence is optional, " +
					`broken is not (${probe.error ? probe.error.message : `exit ${probe.status}`})`,
			);
		}
		console.log(
			"  skip  [QK:HPB-REAL-STATUS-PARSES] no `herdr` on PATH — herdr is an optional rail, so this cell reports a " +
				"named SKIP rather than a silent pass (set ENTWURF_REQUIRE_HERDR=1 to make absence red)",
		);
	} else {
		const env = world("real-status");
		const status = spawnSync("herdr", [...buildStatusArgv()], {
			encoding: "utf8",
			env: { ...env, XDG_CONFIG_HOME: path.join(env.HOME as string, "config") },
		});
		const text = readIntegrationListing(
			{ ...env, XDG_CONFIG_HOME: path.join(env.HOME as string, "config") },
			{ herdrBin: "herdr" },
		);
		const profile = profileLeaf.buildActivationProfile(text);
		const rows = text.trim().split("\n").length;
		ok(
			"[QK:HPB-REAL-STATUS-PARSES] the REAL binary's `integration status` answers with no server running and its " +
				"prose parses through the production profile leaf on this host — that serverless read is the whole reason " +
				"a build can ask Herdr what is integrated before Herdr has committed anything, and the grammar this " +
				`plugin parses is the grammar the shipped binary emits (version=${(probe.stdout || "").trim()} exit=${status.status} rows=${rows} activate=${JSON.stringify(profile.activate)} observed=${JSON.stringify(profile.observedOtherAtoms)})`,
			status.status === 0 && rows >= 2 && Array.isArray(profile.activate),
		);
	}
}

// ── 10. the operator is told what is happening, on a channel herdr does not eat ─
{
	const env = world("progress-sequence");
	const full = drive(env, listing({ pi: "current (v8) (/home/u/.pi)", claude: "current (v8) (/home/u/.claude)" }), {
		acquire: fixtureAcquire({ activate: "recorder", log: path.join(env.HOME as string, "argv.log") }),
		resolveCommit: () => COMMIT_A,
	});
	const idle = drive(world("progress-idle"), listing({}));
	const longStep = full.progress[2] ?? "";
	ok(
		"[QK:HPB-PROGRESS-NAMED-SEQUENCE] a build narrates the five steps IN ORDER and names the long one — herdr pipes " +
			"both of this process's streams into a buffer it DISCARDS on success (`src/cli/plugin.rs:1328-1373` @ c77af189), " +
			"so an operator who has just answered the install prompt sees nothing at all through a multi-minute registry fetch " +
			"and reads it as a hang. The sequence is reported, not logged: each step names the work about to start, the " +
			"acquisition step says out loud that silence is expected and which source it is reaching for, and a run with " +
			"nothing to activate takes exactly ONE step and then closes — it must not narrate work it never did. " +
			"Pinning all six positions is also what keeps a usage NOTE out of the sequence: a note is not an outcome, " +
			"and one read as a seventh step says the install is still going " +
			`(full=${JSON.stringify(full.progress)} idle=${JSON.stringify(idle.progress)})`,
		full.code === 0 &&
			full.progress.length >= 6 &&
			full.progress[0].includes("integration status") &&
			full.progress[1].includes("pi, claude-code") &&
			longStep.includes("long step") &&
			longStep.includes("@junghanacs/entwurf@0.25.0") &&
			full.progress[3].includes("what landed") &&
			full.progress[4].includes("wiring pi, claude-code") &&
			full.progress[5].startsWith("done: ") &&
			idle.code === 0 &&
			idle.progress.length === 2 &&
			idle.progress[1].startsWith("done: nothing to activate"),
	);
}

// ── 10a. the install says how to USE what it just wired ────────────────────────
{
	const env = world("progress-usage-note");
	const full = drive(env, listing({ pi: "current (v8) (/home/u/.pi)", claude: "current (v8) (/home/u/.claude)" }), {
		acquire: fixtureAcquire({ activate: "recorder", log: path.join(env.HOME as string, "argv.log") }),
		resolveCommit: () => COMMIT_A,
	});
	const piOnly = drive(world("progress-usage-note-pi"), listing({ pi: "current (v8) (/home/u/.pi)" }), {
		acquire: fixtureAcquire({ activate: "recorder", log: path.join(world("unused").HOME as string, "argv.log") }),
		resolveCommit: () => COMMIT_A,
	});
	const notesOf = (r: { progress: string[] }) => r.progress.filter((line) => line.startsWith("note: "));
	ok(
		"[QK:HPB-INSTALL-USAGE-NOTE] a green install ends by saying how to USE each backend it just wired, one line " +
			"each, and only for the backends it actually activated. `[관측: GLG, 날것 PC, 2026-09-17]` the two wirings " +
			"feel opposite from the operator's chair and neither is guessable: claude-code gets an MCP server so an " +
			"ordinary `claude` has the tools, while pi gets a USER-SCOPE package registration that loads in every pi " +
			"session on the host and is STILL not a citizen until it is started with --entwurf-control. Green install, " +
			"`pi` starts, nothing there — indistinguishable from an install that did nothing. The note names the FLAG " +
			`and not a launcher, because what goes on a host's PATH is the operator's call (both=${JSON.stringify(notesOf(full))} pi-only=${JSON.stringify(notesOf(piOnly))})`,
		notesOf(full).length === 4 &&
			notesOf(full)[0].includes("pi: ") &&
			notesOf(full)[0].includes("--entwurf-control") &&
			notesOf(full)[2].includes("claude-code: ") &&
			notesOf(full)[2].includes("MCP") &&
			notesOf(piOnly).length === 2 &&
			notesOf(piOnly)[0].includes("--entwurf-control") &&
			notesOf(piOnly).every((line) => line.includes("pi: ")),
	);
	// `[관측: GLG, 날것 PC, 2026-09-17]` "일단 정확한 모델명을 모른다" — the note that says a backend is
	// wired is not usable until the operator can name a model for it, and the two harnesses spell
	// them differently enough that guessing fails. One example each, scoped to what was activated.
	ok(
		`[QK:HPB-USAGE-NOTE-NAMES-A-MODEL] each activated backend also gets ONE example model id in its own grammar — provider-qualified for pi, the vendor id for claude-code — and a backend that was not activated gets neither (both=${JSON.stringify(notesOf(full))} pi-only=${JSON.stringify(notesOf(piOnly))})`,
		((): boolean => {
			// The token INSIDE the backticks, not a substring of the line: `anthropic/claude-sonnet-5`
			// contains `claude-sonnet-5`, so a containment test cannot tell the two grammars apart —
			// which is the whole claim.
			const idIn = (lines: string[], backend: string): string | null => {
				const line = lines.find((l) => l.startsWith(`note: ${backend}: `) && l.includes("model string looks like"));
				return line === undefined ? null : (/`([^`]+)`/.exec(line)?.[1] ?? null);
			};
			const piId = idIn(notesOf(full), "pi");
			const claudeId = idIn(notesOf(full), "claude-code");
			return (
				// Compared against the SHARED leaf, not a literal copied into this gate: the install
				// narration and the status pane's RAILS block now read one declaration
				// (`scripts/herdr-rails.mjs`, #116 A7), and a gate holding its own third copy would
				// be the very drift that leaf exists to stop. The GRAMMAR assertions stay literal —
				// provider-qualified vs bare vendor id is the fact, and it must not become whatever
				// the leaf happens to say.
				piId === HERDR_RAILS.MODEL_SYNTAX_EXAMPLE.pi &&
				piId.includes("/") &&
				claudeId === HERDR_RAILS.MODEL_SYNTAX_EXAMPLE["claude-code"] &&
				!claudeId.includes("/") &&
				idIn(notesOf(piOnly), "pi") === HERDR_RAILS.MODEL_SYNTAX_EXAMPLE.pi &&
				idIn(notesOf(piOnly), "claude-code") === null
			);
		})(),
	);
}

// ── 11. no terminal is an ordinary state, and the trail survives either way ─────
{
	const tty: string[] = [];
	const mirrored: string[] = [];
	let closed = 0;
	const live = progressLeaf.createProgressReporter({
		openTty: () => 7,
		writeTty: (fd: number, line: string) => tty.push(`${fd}:${line}`),
		closeTty: () => {
			closed += 1;
		},
		mirror: (line: string) => mirrored.push(line),
	});
	live.step("one");
	live.done("two");
	live.close();
	live.close();

	const blindMirror: string[] = [];
	const blind = progressLeaf.createProgressReporter({
		openTty: () => {
			throw new Error("ENXIO: no controlling terminal");
		},
		writeTty: () => {
			throw new Error("must never be called without a terminal");
		},
		closeTty: () => {
			throw new Error("must never be called without a terminal");
		},
		mirror: (line: string) => blindMirror.push(line),
	});
	blind.step("one");
	blind.close();

	ok(
		"[QK:HPB-PROGRESS-TTY-OPTIONAL] the progress channel is the operator's terminal when there is one and NOTHING " +
			"when there is not — a CI runner, a pipe or a daemon has no `/dev/tty`, and a build that failed for want of a " +
			"terminal would be the narration breaking the install it exists to explain. Every line is mirrored to stderr " +
			"either way, which costs nothing on success (herdr drops it) and is the trail in front of the error on failure. " +
			`The descriptor is closed once, and closing twice is not an error (tty=${JSON.stringify(tty)} mirrored=${JSON.stringify(mirrored)} closed=${closed} blind-live=${blind.live} blind-mirrored=${JSON.stringify(blindMirror)})`,
		live.live === true &&
			tty.length === 2 &&
			tty[0] === "7:[entwurf 1/5] one\n" &&
			tty[1] === "7:[entwurf done] two\n" &&
			mirrored.length === 2 &&
			mirrored[0] === "[entwurf 1/5] one\n" &&
			closed === 1 &&
			blind.live === false &&
			blindMirror.length === 1 &&
			blindMirror[0] === "[entwurf 1/5] one\n",
	);
}

console.log(`\ncheck-herdr-plugin-build: ${passed} assertions passed`);
