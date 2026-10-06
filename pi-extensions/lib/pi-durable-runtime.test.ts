/**
 * pi-durable-runtime (#129 W, L3) — the fixed locator and the pin verifier, beside the leaf.
 *
 * The oracle is git itself on a tiny fixture this file builds: a repository with one commit (the
 * "pin"), an overlay patch taken from `git diff --binary` of one edit, a git-ignored model-data
 * directory, and a pin JSON naming all of it. Every drift case is made by a real git or filesystem
 * operation, never by editing the facts object. One case imports the COMPILED module from this
 * checkout's bridge closure to prove the package root resolves from the deeper depth too, so like
 * `entwurf-control.test.ts` this file needs a built bridge.
 *
 * The last block reads the three checkout gates as SOURCE for the signal and connect safety they
 * carry inside themselves; it runs no gate and spawns nothing (see its own note).
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	checkPiDurableRuntime,
	inspectPiDurableRuntime,
	PI_DURABLE_RESOLVER_RELATIVE,
	type PiDurablePackageLayout,
	piDurableLayoutAt,
	piDurablePackageLayout,
	piDurableRuntimeDir,
	piDurableRuntimeVerdict,
	readPiDurablePin,
	runPiDurableRuntimeCli,
} from "./pi-durable-runtime.ts";

const sha256 = (data: string | Buffer): string => createHash("sha256").update(data).digest("hex");
const DATA = path.join("packages", "ai", "src", "providers", "data");

let root: string;
beforeEach(() => {
	root = fs.mkdtempSync(path.join(os.tmpdir(), "pi-durable-runtime-"));
});
afterEach(() => {
	fs.rmSync(root, { recursive: true, force: true });
});

/** git with no operator configuration: no global/system config, hooks or signing can reach it. */
function git(cwd: string, ...args: string[]): string {
	return gitBytes(cwd, ...args).toString();
}
function gitBytes(cwd: string, ...args: string[]): Buffer {
	const run = spawnSync("git", ["-C", cwd, ...args], {
		env: {
			PATH: process.env.PATH ?? "",
			HOME: root,
			GIT_CONFIG_GLOBAL: "/dev/null",
			GIT_CONFIG_NOSYSTEM: "1",
			GIT_AUTHOR_NAME: "fixture",
			GIT_AUTHOR_EMAIL: "fixture@example.invalid",
			GIT_COMMITTER_NAME: "fixture",
			GIT_COMMITTER_EMAIL: "fixture@example.invalid",
		},
	});
	if (run.status !== 0) throw new Error(`git ${args.join(" ")}: ${run.stderr}`);
	return run.stdout as Buffer;
}

/** A pinned runtime at `runtimeDir` plus the overlay that describes it. Returns the overlay dir. */
/** The tracked file the overlay edits: one line by default; the blank-context body gives the patch
 * blank context lines, as the real overlay patch has. */
const ONE_LINE = { pin: "export const v = 1;\n", overlay: "export const v = 2; // overlay\n" };
const BLANK_CONTEXT = {
	pin: "export const a = 0;\n\nexport const v = 1;\n\nexport const z = 0;\n",
	overlay: "export const a = 0;\n\nexport const v = 2; // overlay\n\nexport const z = 0;\n",
};
function provision(runtimeDir: string, body: { pin: string; overlay: string } = ONE_LINE): string {
	fs.mkdirSync(path.join(runtimeDir, path.dirname(PI_DURABLE_RESOLVER_RELATIVE)), { recursive: true });
	git(runtimeDir, "init", "-q");
	fs.writeFileSync(path.join(runtimeDir, "runtime.ts"), body.pin);
	fs.writeFileSync(path.join(runtimeDir, PI_DURABLE_RESOLVER_RELATIVE), "// resolver\n");
	fs.writeFileSync(path.join(runtimeDir, ".gitignore"), `${DATA}/\n`);
	git(runtimeDir, "add", "-A");
	git(runtimeDir, "commit", "-q", "-m", "pin");
	const commit = git(runtimeDir, "rev-parse", "HEAD").trim();
	fs.writeFileSync(path.join(runtimeDir, "runtime.ts"), body.overlay);
	// The packaged patch's shape: git's default output, captured with no configuration, at 8-hex `index` lines.
	const patch = gitBytes(runtimeDir, "-c", "core.abbrev=8", "diff", "--binary");
	fs.mkdirSync(path.join(runtimeDir, DATA), { recursive: true });
	fs.writeFileSync(path.join(runtimeDir, DATA, "models.json"), '{"m":1}\n');
	fs.writeFileSync(path.join(runtimeDir, DATA, ".manifest.json"), '{"manifest":1}\n');
	const overlay = path.join(root, "overlay");
	fs.mkdirSync(overlay, { recursive: true });
	fs.writeFileSync(path.join(overlay, "runtime-contacts.patch"), patch);
	fs.writeFileSync(
		path.join(overlay, "upstream-pin.json"),
		JSON.stringify({
			schemaVersion: 1,
			commit,
			patches: ["runtime-contacts.patch"],
			modelData: {
				path: DATA,
				files: 1,
				aggregateSha256: sha256(`${sha256('{"m":1}\n')}  models.json\n`),
				manifestSha256: sha256('{"manifest":1}\n'),
			},
		}),
	);
	return overlay;
}

/** The runtime at the FIXED locator of a sandbox data home, and a layout whose overlay names it. */
function hostWithRuntime(body: { pin: string; overlay: string } = ONE_LINE): {
	env: NodeJS.ProcessEnv;
	runtimeDir: string;
	layout: PiDurablePackageLayout;
} {
	const xdg = path.join(root, "xdg-data");
	const runtimeDir = path.join(xdg, "entwurf", "pi-durable", "runtime");
	const overlayDir = provision(runtimeDir, body);
	return {
		env: { HOME: path.join(root, "home"), XDG_DATA_HOME: xdg },
		runtimeDir,
		layout: { ...piDurableLayoutAt(root), overlayDir },
	};
}

const verdictOf = (fx: ReturnType<typeof hostWithRuntime>) => {
	const checked = checkPiDurableRuntime(fx.env, fx.layout);
	return checked.ok ? null : checked.reason;
};

describe("pi-durable runtime — the one fixed place", () => {
	it("[QK:PI-DURABLE-RUNTIME-LOCATOR-FIXED] the runtime lives under an absolute XDG_DATA_HOME, else ~/.local/share; a relative XDG_DATA_HOME is ignored, and no Entwurf variable moves it", () => {
		expect(piDurableRuntimeDir({ XDG_DATA_HOME: "/x/data", HOME: "/home/op" })).toBe(
			"/x/data/entwurf/pi-durable/runtime",
		);
		expect(piDurableRuntimeDir({ XDG_DATA_HOME: "rel/data", HOME: "/home/op" })).toBe(
			"/home/op/.local/share/entwurf/pi-durable/runtime",
		);
		expect(piDurableRuntimeDir({ HOME: "/home/op" })).toBe("/home/op/.local/share/entwurf/pi-durable/runtime");
		expect(piDurableRuntimeDir({})).toBeNull();
		expect(
			piDurableRuntimeDir({ HOME: "/home/op", ENTWURF_PI_DURABLE_RUNTIME: "/somewhere/else", ENTWURF_DIR: "/e" }),
		).toBe("/home/op/.local/share/entwurf/pi-durable/runtime");
	});

	it("[QK:PI-DURABLE-PACKAGE-LAYOUT-BOTH-DEPTHS] the package root is found from the source depth and the compiled depth, and nowhere else", async () => {
		const pkg = path.join(root, "pkg");
		fs.mkdirSync(path.join(pkg, "pi", "pi-durable", "overlay"), { recursive: true });
		fs.writeFileSync(path.join(pkg, "pi", "pi-durable", "overlay", "upstream-pin.json"), "{}");
		expect(piDurablePackageLayout(path.join(pkg, "pi-extensions", "lib"))?.root).toBe(pkg);
		expect(piDurablePackageLayout(path.join(pkg, "mcp", "entwurf-bridge", "dist", "pi-extensions", "lib"))?.root).toBe(
			pkg,
		);
		expect(piDurablePackageLayout(path.join(root, "elsewhere", "a", "b"))).toBeNull();
		// The real thing: this checkout's source module and its compiled twin name ONE root.
		const source = piDurablePackageLayout();
		expect(source).not.toBeNull();
		const compiledFile = path.join(
			source?.root ?? "",
			"mcp",
			"entwurf-bridge",
			"dist",
			"pi-extensions",
			"lib",
			"pi-durable-runtime.js",
		);
		expect(fs.existsSync(compiledFile), "the compiled module exists — run `pnpm run build-bridge` first").toBe(true);
		const compiled = (await import(compiledFile)) as { piDurablePackageLayout: () => PiDurablePackageLayout | null };
		expect(compiled.piDurablePackageLayout()).toEqual(source);
		expect(fs.existsSync(source?.overlayDir ?? "")).toBe(true);
	});
});

describe("pi-durable runtime — verified against the pin, read-only", () => {
	it("[QK:PI-DURABLE-RUNTIME-PIN-VERIFIED] a checkout at the pin with exactly the overlay patch and the pinned model data verifies, and the resolver path is inside it", () => {
		const fx = hostWithRuntime();
		const checked = checkPiDurableRuntime(fx.env, fx.layout);
		expect(checked).toEqual({
			ok: true,
			runtimeDir: fx.runtimeDir,
			resolver: path.join(fx.runtimeDir, PI_DURABLE_RESOLVER_RELATIVE),
		});
	});

	it("[QK:PI-DURABLE-RUNTIME-ABSENT] nothing at the fixed place is absence, not drift", () => {
		const fx = hostWithRuntime();
		fs.rmSync(fx.runtimeDir, { recursive: true, force: true });
		expect(verdictOf(fx)).toBe("pi-durable-runtime-absent");
	});

	it("[QK:PI-DURABLE-RUNTIME-UNVERIFIABLE] a directory git cannot read as a checkout is refused as unverifiable", () => {
		const fx = hostWithRuntime();
		fs.rmSync(path.join(fx.runtimeDir, ".git"), { recursive: true, force: true });
		expect(verdictOf(fx)).toBe("pi-durable-runtime-unverifiable");
	});

	it("[QK:PI-DURABLE-RUNTIME-PIN-DRIFT] a moved HEAD, a patch that differs, or a missing resolver is pin drift", () => {
		const moved = hostWithRuntime();
		git(moved.runtimeDir, "commit", "-q", "-am", "moved");
		expect(verdictOf(moved)).toBe("pi-durable-runtime-pin-drift");
		fs.rmSync(root, { recursive: true, force: true });
		fs.mkdirSync(root);
		const edited = hostWithRuntime();
		fs.appendFileSync(path.join(edited.runtimeDir, "runtime.ts"), "// one more line\n");
		expect(verdictOf(edited)).toBe("pi-durable-runtime-pin-drift");
		fs.rmSync(root, { recursive: true, force: true });
		fs.mkdirSync(root);
		const noResolver = hostWithRuntime();
		fs.rmSync(path.join(noResolver.runtimeDir, PI_DURABLE_RESOLVER_RELATIVE));
		expect(verdictOf(noResolver)).toBe("pi-durable-runtime-pin-drift");
	});

	it("[QK:PI-DURABLE-RUNTIME-UNTRACKED-DRIFT] a non-ignored untracked file is pin drift, while git-ignored model data is not", () => {
		const fx = hostWithRuntime();
		fs.writeFileSync(path.join(fx.runtimeDir, "stray.ts"), "export {};\n");
		expect(verdictOf(fx)).toBe("pi-durable-runtime-pin-drift");
		fs.rmSync(path.join(fx.runtimeDir, "stray.ts"));
		expect(verdictOf(fx)).toBeNull();
	});

	it("[QK:PI-DURABLE-RUNTIME-MODELDATA-DRIFT] model data that is not the pinned bytes — changed, extra, or without its manifest — is its own refusal", () => {
		const fx = hostWithRuntime();
		const models = path.join(fx.runtimeDir, DATA, "models.json");
		fs.writeFileSync(models, '{"m":2}\n');
		expect(verdictOf(fx)).toBe("pi-durable-runtime-modeldata-drift");
		fs.writeFileSync(models, '{"m":1}\n');
		fs.writeFileSync(path.join(fx.runtimeDir, DATA, "extra.json"), "{}\n");
		expect(verdictOf(fx)).toBe("pi-durable-runtime-modeldata-drift");
		fs.rmSync(path.join(fx.runtimeDir, DATA, "extra.json"));
		fs.rmSync(path.join(fx.runtimeDir, DATA, ".manifest.json"));
		expect(verdictOf(fx)).toBe("pi-durable-runtime-modeldata-drift");
	});

	it("[QK:PI-DURABLE-RUNTIME-READ-ONLY] verifying never rewrites the operator checkout's index, even when its stat cache is stale", () => {
		const fx = hostWithRuntime();
		const index = path.join(fx.runtimeDir, ".git", "index");
		// A content-identical rewrite moves mtime: a plain `git diff` would refresh the index here.
		const tracked = path.join(fx.runtimeDir, PI_DURABLE_RESOLVER_RELATIVE);
		const future = new Date(Date.now() + 5_000);
		fs.utimesSync(tracked, future, future);
		const before = sha256(fs.readFileSync(index));
		const statBefore = fs.statSync(index).mtimeMs;
		expect(verdictOf(fx)).toBeNull();
		expect(sha256(fs.readFileSync(index))).toBe(before);
		expect(fs.statSync(index).mtimeMs).toBe(statBefore);
	});

	it("[QK:PI-DURABLE-RUNTIME-STAGED-DRIFT] a staged change — an edit to another tracked file, or a new file — is pin drift although the worktree-vs-index diff still equals the patch, and the operator's index bytes are left as they were", () => {
		const other = hostWithRuntime();
		fs.appendFileSync(path.join(other.runtimeDir, PI_DURABLE_RESOLVER_RELATIVE), "// staged edit\n");
		git(other.runtimeDir, "add", PI_DURABLE_RESOLVER_RELATIVE);
		const otherIndex = sha256(fs.readFileSync(path.join(other.runtimeDir, ".git", "index")));
		expect(inspectPiDurableRuntime(other.runtimeDir, other.layout.overlayDir).diffEqualsPatch).toBe(true);
		expect(verdictOf(other)).toBe("pi-durable-runtime-pin-drift");
		expect(sha256(fs.readFileSync(path.join(other.runtimeDir, ".git", "index")))).toBe(otherIndex);
		fs.rmSync(root, { recursive: true, force: true });
		fs.mkdirSync(root);
		const added = hostWithRuntime();
		fs.writeFileSync(path.join(added.runtimeDir, "staged.ts"), "export {};\n");
		git(added.runtimeDir, "add", "staged.ts");
		const addedIndex = sha256(fs.readFileSync(path.join(added.runtimeDir, ".git", "index")));
		const facts = inspectPiDurableRuntime(added.runtimeDir, added.layout.overlayDir);
		expect(facts.diffEqualsPatch).toBe(true);
		expect(facts.untracked).toBe("");
		expect(verdictOf(added)).toBe("pi-durable-runtime-pin-drift");
		expect(sha256(fs.readFileSync(path.join(added.runtimeDir, ".git", "index")))).toBe(addedIndex);
	});

	it("[QK:PI-DURABLE-RUNTIME-CONFIG-NEUTRAL] the runtime's own git configuration cannot move the verdict: a pinned checkout whose config sets core.abbrev=12, diff.noprefix and color.ui=always still verifies", () => {
		const fx = hostWithRuntime();
		git(fx.runtimeDir, "config", "core.abbrev", "12");
		git(fx.runtimeDir, "config", "diff.noprefix", "true");
		git(fx.runtimeDir, "config", "color.ui", "always");
		expect(verdictOf(fx)).toBeNull();
		// diff.suppressBlankEmpty drops the space git prints before an EMPTY context line. The one-line body
		// has no context at all, so this cell uses a body whose patch carries blank context lines.
		fs.rmSync(root, { recursive: true, force: true });
		fs.mkdirSync(root);
		const blank = hostWithRuntime(BLANK_CONTEXT);
		expect(readPiDurablePin(blank.layout.overlayDir).patchBytes.includes("\n \n")).toBe(true);
		expect(verdictOf(blank)).toBeNull();
		git(blank.runtimeDir, "config", "diff.suppressBlankEmpty", "true");
		expect(verdictOf(blank)).toBeNull();
	});

	it("[QK:PI-DURABLE-RUNTIME-GATES-CONSUME-INDEX-TERM] SOURCE check, not a gate run: every checkout gate assertion that reads the tracked-overlay diff also requires index == HEAD, the term a staged change turns false", () => {
		// The independent fact first: a staged change leaves the diff equal to the patch and turns ONLY
		// indexMatchesHead false — so a gate condition without that term certifies a tree it never saw.
		const fx = hostWithRuntime();
		fs.writeFileSync(path.join(fx.runtimeDir, "staged.ts"), "export {};\n");
		git(fx.runtimeDir, "add", "staged.ts");
		const facts = inspectPiDurableRuntime(fx.runtimeDir, fx.layout.overlayDir);
		expect([facts.diffEqualsPatch, facts.untracked, facts.indexMatchesHead]).toEqual([true, "", false]);
		// Then each gate's EXECUTABLE condition: the second argument of every `ok(` call whose condition
		// reads facts.diffEqualsPatch (labels and comment lines excluded) must also conjoin the index term.
		const repo = path.resolve(import.meta.dirname, "..", "..");
		for (const gate of ["check-pi-durable-contact.ts", "check-pi-durable-send.ts", "check-pi-durable-receive.ts"]) {
			const code = fs
				.readFileSync(path.join(repo, "scripts", gate), "utf8")
				.split("\n")
				.filter((line) => !/^\s*(\/\/|\/\*|\*)/.test(line))
				.join("\n");
			const conditions = [...code.matchAll(/^ok\(\n\t(?:`[^`]*`|"[^"]*"),\n([\s\S]*?)\n\);$/gm)]
				.map((m) => m[1] as string)
				.filter((cond) => cond.includes("facts.diffEqualsPatch"));
			expect(conditions.length, gate).toBeGreaterThan(0);
			for (const cond of conditions) {
				expect(cond, gate).not.toContain("||");
				expect(cond, gate).toMatch(/(^|&&)\s*facts\.indexMatchesHead\s*&&/);
			}
		}
	});

	it("the verdict is the facts' — the same verifier the three checkout gates read", () => {
		const fx = hostWithRuntime();
		const { pin } = readPiDurablePin(fx.layout.overlayDir);
		const facts = inspectPiDurableRuntime(fx.runtimeDir, fx.layout.overlayDir);
		expect(facts.head).toBe(pin.commit);
		expect(facts.diffEqualsPatch).toBe(true);
		expect(piDurableRuntimeVerdict(facts, pin)).toBeNull();
	});
});

describe("pi-durable runtime — the launcher/setup CLI", () => {
	const capture = () => {
		const out = { stdout: [] as string[], stderr: [] as string[] };
		return { out, sink: { stdout: (l: string) => out.stdout.push(l), stderr: (l: string) => out.stderr.push(l) } };
	};

	it("[QK:PI-DURABLE-RUNTIME-CLI-EXITS] resolve prints the verified resolver and exits 0, exits 4 for an absent runtime (setup SKIP) and 3 for every other refusal, each named", () => {
		const fx = hostWithRuntime();
		const ok = capture();
		expect(runPiDurableRuntimeCli(["resolve"], fx.env, fx.layout, ok.sink)).toBe(0);
		expect(ok.out.stdout).toEqual([path.join(fx.runtimeDir, PI_DURABLE_RESOLVER_RELATIVE)]);
		fs.writeFileSync(path.join(fx.runtimeDir, "stray.ts"), "export {};\n");
		const drift = capture();
		expect(runPiDurableRuntimeCli(["resolve"], fx.env, fx.layout, drift.sink)).toBe(3);
		expect(drift.out.stderr[0]).toMatch(/^pi-durable-runtime-pin-drift \(/);
		fs.rmSync(fx.runtimeDir, { recursive: true, force: true });
		const absent = capture();
		expect(runPiDurableRuntimeCli(["resolve"], fx.env, fx.layout, absent.sink)).toBe(4);
		expect(absent.out.stderr[0]).toMatch(/^pi-durable-runtime-absent \(/);
		const incomplete = capture();
		expect(runPiDurableRuntimeCli(["resolve"], fx.env, null, incomplete.sink)).toBe(3);
		expect(incomplete.out.stderr[0]).toMatch(/^pi-durable-package-incomplete: /);
		expect(runPiDurableRuntimeCli([], fx.env, fx.layout, capture().sink)).toBe(2);
	});
});

// ---------------------------------------------------------------------------
// The checkout gates' own signal and connect safety — SOURCE extraction, never a gate run
// ---------------------------------------------------------------------------

/**
 * The send and receive gates signal and close only what they own, and those contracts live INSIDE
 * the gates, which open the real durable app and so cannot run in the floor. Like the index-term
 * case above, these cases read the gates as SOURCE: each cuts exact segments (every start boundary
 * must occur exactly once), strips their types with Node's own `stripTypeScriptTypes`, and runs them
 * as a function whose only `fs` is a scripted /proc world and whose only `process` is a kill spy.
 * Nothing is spawned, no /proc is read and no signal is sent; a gate is never imported and its main
 * never starts. Every cell's expected facts are written here, never derived from the segment.
 */
const GATE_DIR = path.join(path.resolve(import.meta.dirname, "..", ".."), "scripts");
const SEND_GATE = "check-pi-durable-send.ts";
const PROC_STAT_START = "function procStat(pid: number): { ppid: number; start: string } | null {\n";
const FIXTURE_BRIDGE = "/entwurf/mcp/entwurf-bridge/dist/mcp/entwurf-bridge/src/index.js";

/** One exact gate segment from `start` to the first `end` after it (`end` included unless told). */
function gateSegment(gate: string, start: string, end: string, includeEnd = true): string {
	const text = fs.readFileSync(path.join(GATE_DIR, gate), "utf8");
	expect(text.split(start).length - 1, `${gate}: start boundary ${JSON.stringify(start)}`).toBe(1);
	const at = text.indexOf(start);
	const stop = text.indexOf(end, at + start.length);
	expect(stop, `${gate}: end boundary ${JSON.stringify(end)}`).toBeGreaterThan(at);
	return text.slice(at, includeEnd ? stop + end.length : stop);
}

/** The segment with its types stripped, as a function of exactly `params`; nothing else is in scope. */
function segmentFunction(params: string[], body: string, asynchronous = false): (...args: unknown[]) => unknown {
	const source = `${asynchronous ? "async " : ""}function segment(${params.join(", ")}) {\n${body}\n}`;
	const js = stripTypeScriptTypes(source, { mode: "strip" });
	return new Function(`"use strict";\n${js}\nreturn segment;`)() as (...args: unknown[]) => unknown;
}

interface ProcPhase {
	/** This phase answers reads up to and including this count of reads of the pid. */
	upto?: number;
	stat: { ppid: number; start: string; state?: string } | null;
	argv?: string[];
	io?: { rchar: number; syscr: number };
}

/** A scripted /proc and a kill spy: a pid's incarnation changes after its N-th read or when redefined. */
function procWorld(initial: Record<number, ProcPhase[]>) {
	const procs = new Map<number, { phases: ProcPhase[]; reads: number }>();
	const dead = new Set<number>();
	const signals: [number, string][] = [];
	const define = (pid: number, phases: ProcPhase[]): void => {
		dead.delete(pid);
		procs.set(pid, { phases, reads: 0 });
	};
	for (const [pid, phases] of Object.entries(initial)) define(Number(pid), phases);
	const phaseAt = (pid: number, counted: boolean): ProcPhase | null => {
		const proc = procs.get(pid);
		if (proc === undefined || dead.has(pid)) return null;
		if (counted) proc.reads++;
		return proc.phases.find((p) => proc.reads <= (p.upto ?? Number.POSITIVE_INFINITY)) ?? null;
	};
	return {
		signals,
		define,
		fs: {
			readFileSync(file: string): string {
				const m = /^\/proc\/(\d+)\/(stat|cmdline|io)$/.exec(file);
				if (m === null) throw new Error(`proc world: unexpected read ${file}`);
				const phase = phaseAt(Number(m[1]), true);
				if (phase === null || phase.stat === null) {
					throw Object.assign(new Error(`ENOENT: ${file}`), { code: "ENOENT" });
				}
				const { ppid, start, state } = phase.stat;
				if (m[2] === "stat")
					return `${m[1]} (node) ${state ?? "S"} ${ppid} ${Array(17).fill("0").join(" ")} ${start} 0 0\n`;
				if (m[2] === "cmdline") return `${(phase.argv ?? []).join("\0")}\0`;
				return `rchar: ${phase.io?.rchar ?? 0}\nwchar: 0\nsyscr: ${phase.io?.syscr ?? 0}\nsyscw: 0\n`;
			},
			readdirSync(dir: string): string[] {
				if (dir !== "/proc") throw new Error(`proc world: unexpected readdir ${dir}`);
				const live = [...procs.keys()].filter((p) => !dead.has(p)).sort((a, b) => a - b);
				return ["self", ...live.map(String)];
			},
		},
		process: {
			kill(pid: number, signal: string): boolean {
				signals.push([pid, signal]);
				if (phaseAt(pid, false)?.stat) dead.add(pid);
				return true;
			},
		},
	};
}

interface OwnedEntry {
	pid: number;
	start: string;
	what: string;
}
interface OwnershipSurface {
	own(pid: number, what: string): OwnedEntry;
	observeBridges(host: OwnedEntry): unknown;
	reapAll(): Promise<string[]>;
	owned: OwnedEntry[];
	childrenObserved: Set<unknown>;
	observationNotes: string[];
}

/** The send gate's ownership join and reaper (procStat … reapAll), bound to one scripted world. */
function sendOwnership(world: ReturnType<typeof procWorld>): OwnershipSurface {
	const body = gateSegment(SEND_GATE, PROC_STAT_START, "\treturn problems;\n}\n");
	const run = segmentFunction(
		["fs", "process", "bridgeEntry", "REAP_TIMEOUT_MS"],
		`${body}\nreturn { own, observeBridges, reapAll, owned, childrenObserved, observationNotes };`,
	);
	return run(world.fs, world.process, FIXTURE_BRIDGE, 100) as OwnershipSurface;
}

const stableProc = (ppid: number, start: string, argv?: string[]): ProcPhase[] => [
	{ stat: { ppid, start }, ...(argv ? { argv } : {}) },
];
const bridgeArgv = ["node", FIXTURE_BRIDGE];
const replacement: ProcPhase = { stat: { ppid: 1, start: "2999" }, argv: ["foreign"] };
const drifted = (pid: number, host: number) =>
	`child ${pid} of host ${host} changed or vanished while it was qualified`;
const unobserved = (host: number) => `host ${host} exited before its children were observed`;

/** Own host 100 (and optionally the target owner 50), observe it once, then reap everything owned. */
async function ownershipCell(world: ReturnType<typeof procWorld>, withTargetOwner = false) {
	const gate = sendOwnership(world);
	if (withTargetOwner) gate.own(50, "target-owner");
	const host = gate.own(100, "host");
	gate.observeBridges(host);
	const observed = gate.childrenObserved.has(host);
	await gate.reapAll();
	return {
		observed,
		owned: gate.owned.map(({ pid, start, what }) => ({ pid, start, what })),
		notes: [...gate.observationNotes],
		signals: world.signals,
	};
}

describe("pi-durable checkout gates — their own signal and connect safety, read as SOURCE", () => {
	it("[QK:PI-DURABLE-GATE-SEND-OWNS-QUALIFIED-START] the send gate owns a bridge only under the {ppid, start} it read before AND after the argv, with its host unchanged around the scan — a child replaced at any read, a vanished child or a drifted host is never owned or signalled, and every other owned process is still reaped", async () => {
		const stable = procWorld({ 100: stableProc(10, "1000"), 200: stableProc(100, "2000", bridgeArgv) });
		expect(await ownershipCell(stable)).toEqual({
			observed: true,
			owned: [
				{ pid: 100, start: "1000", what: "host" },
				{ pid: 200, start: "2000", what: "bridge" },
			],
			notes: [],
			signals: [
				[200, "SIGTERM"],
				[100, "SIGTERM"],
			],
		});
		// Replaced between the PPID read and the read after the argv.
		const reread = procWorld({
			100: stableProc(10, "1000"),
			200: [{ upto: 2, stat: { ppid: 100, start: "2000" }, argv: bridgeArgv }, replacement],
		});
		expect(await ownershipCell(reread)).toEqual({
			observed: false,
			owned: [{ pid: 100, start: "1000", what: "host" }],
			notes: [drifted(200, 100)],
			signals: [[100, "SIGTERM"]],
		});
		// Stable through qualification, replaced right after it: owned under the QUALIFYING start, so
		// the replacement is never signalled.
		const registration = procWorld({
			100: stableProc(10, "1000"),
			200: [{ upto: 3, stat: { ppid: 100, start: "2000" }, argv: bridgeArgv }, replacement],
		});
		expect(await ownershipCell(registration)).toEqual({
			observed: true,
			owned: [
				{ pid: 100, start: "1000", what: "host" },
				{ pid: 200, start: "2000", what: "bridge" },
			],
			notes: [],
			signals: [[100, "SIGTERM"]],
		});
		// The host's identity changes during its own child scan; the target owner is still reaped.
		const hostDrift = procWorld({
			50: stableProc(10, "500"),
			100: [{ upto: 3, stat: { ppid: 10, start: "1000" } }, { stat: { ppid: 10, start: "1999" } }],
			200: stableProc(100, "2000", bridgeArgv),
		});
		expect(await ownershipCell(hostDrift, true)).toEqual({
			observed: false,
			owned: [
				{ pid: 50, start: "500", what: "target-owner" },
				{ pid: 100, start: "1000", what: "host" },
			],
			notes: ["host 100 changed identity during its child scan", unobserved(100)],
			signals: [[50, "SIGTERM"]],
		});
		// The child vanishes right after its PPID read.
		const missing = procWorld({
			100: stableProc(10, "1000"),
			200: [{ upto: 1, stat: { ppid: 100, start: "2000" }, argv: bridgeArgv }, { stat: null }],
		});
		expect(await ownershipCell(missing)).toEqual({
			observed: false,
			owned: [{ pid: 100, start: "1000", what: "host" }],
			notes: [drifted(200, 100)],
			signals: [[100, "SIGTERM"]],
		});
	});

	it("[QK:PI-DURABLE-GATE-SEND-OBSERVED-BY-IDENTITY] the send gate records complete observation for the exact owned host (pid AND start), so a later host that reuses the pid and exits unobserved is reported, never inheriting its predecessor's observation", async () => {
		const world = procWorld({ 100: stableProc(10, "1000") });
		const gate = sendOwnership(world);
		const first = gate.own(100, "host");
		gate.observeBridges(first);
		expect(gate.childrenObserved.has(first)).toBe(true);
		world.define(100, stableProc(10, "1100"));
		gate.own(100, "host");
		world.define(100, [{ stat: null }]);
		await gate.reapAll();
		expect(gate.owned.map(({ pid, start }) => [pid, start])).toEqual([
			[100, "1000"],
			[100, "1100"],
		]);
		expect(gate.observationNotes).toEqual([unobserved(100)]);
		expect(world.signals).toEqual([]);
	});

	it("[QK:PI-DURABLE-GATE-SEND-S3-START-RECHECKED] the send gate's SIGKILL of the paused bridge re-reads its start key immediately before the signal: a process that replaced it, or its absence, after the counter and state reads is a named GAP with no signal, while the earlier identity check still fails first", () => {
		const site = (world: ReturnType<typeof procWorld>) => {
			const body = [
				gateSegment(SEND_GATE, PROC_STAT_START, "\n}\n"),
				gateSegment(SEND_GATE, "interface IoSnapshot {\n", "\treturn snapshot;\n}\n"),
				gateSegment(SEND_GATE, "function procState(pid: number): string | null {\n", "\n}\n"),
				gateSegment(
					SEND_GATE,
					'\tconst afterHostKill = ioSnapshot(bridge1, "afterHostKill");\n',
					'\tprocess.kill(bridge1.pid, "SIGKILL");\n',
				),
			].join("");
			const run = segmentFunction(
				["fs", "process", "bridge1"],
				`${body}\nreturn { bridgeStateAtRead, taken: ioSnapshots.length };`,
			);
			type SiteResult = { bridgeStateAtRead: string | null; taken: number };
			let thrown: string | null = null;
			let out: SiteResult | null = null;
			try {
				out = run(world.fs, world.process, { pid: 300, start: "3000", what: "bridge", stopped: true }) as SiteResult;
			} catch (error) {
				thrown = (error as Error).message;
			}
			return { thrown, stateAtRead: out?.bridgeStateAtRead ?? null, kills: world.signals };
		};
		const paused = { ppid: 1, start: "3000", state: "T" };
		const io = { rchar: 2282725, syscr: 499 };
		const gap = "GAP: bridge1 300 is not the observed process immediately before its SIGKILL";
		expect(site(procWorld({ 300: [{ stat: paused, io }] }))).toEqual({
			thrown: null,
			stateAtRead: "T",
			kills: [[300, "SIGKILL"]],
		});
		expect(site(procWorld({ 300: [{ stat: { ppid: 1, start: "3999", state: "S" }, io }] }))).toEqual({
			thrown: "GAP: bridge 300 is no longer the observed process at afterHostKill",
			stateAtRead: null,
			kills: [],
		});
		// Reads 1-3 are the IO identity check, the IO read and the state read; the 4th is the re-check.
		expect(
			site(
				procWorld({
					300: [
						{ upto: 3, stat: paused, io },
						{ stat: { ppid: 1, start: "3999", state: "S" }, io },
					],
				}),
			),
		).toEqual({ thrown: gap, stateAtRead: null, kills: [] });
		expect(site(procWorld({ 300: [{ upto: 3, stat: paused, io }, { stat: null }] }))).toEqual({
			thrown: gap,
			stateAtRead: null,
			kills: [],
		});
	});

	it("[QK:PI-DURABLE-GATE-RECEIVE-CONNECT-CLOSES] the receive gate's failed sending-bridge connect closes the transport once and rethrows the connect error itself; a failing close rides beside it in an ordered AggregateError; a successful connect closes nothing", async () => {
		const body = gateSegment(
			"check-pi-durable-receive.ts",
			'\tconst client = new Client({ name: LABEL, version: "1" });\n',
			"\tconst sendingPid = transport.pid;\n",
			false,
		);
		const site = segmentFunction(["Client", "transport", "LABEL"], body, true);
		const cell = async (connectFails: boolean, closeFails: boolean) => {
			const connectError = new Error("connect failed");
			const closeError = new Error("close failed");
			let closes = 0;
			const transport = {
				async close() {
					closes++;
					if (closeFails) throw closeError;
				},
			};
			class Client {
				async connect() {
					if (connectFails) throw connectError;
				}
			}
			try {
				await site(Client, transport, "pi-durable-runtime.test");
				return { outcome: "resolved", closes };
			} catch (thrown) {
				const order =
					thrown instanceof AggregateError
						? thrown.errors.map((e) => (e === connectError ? "connect" : e === closeError ? "close" : "other"))
						: null;
				return { outcome: thrown === connectError ? "connect-error" : "other-error", order, closes };
			}
		};
		expect(await cell(true, false)).toEqual({ outcome: "connect-error", order: null, closes: 1 });
		expect(await cell(true, true)).toEqual({ outcome: "other-error", order: ["connect", "close"], closes: 1 });
		expect(await cell(false, false)).toEqual({ outcome: "resolved", closes: 0 });
	});
});
