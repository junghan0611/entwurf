/**
 * pi-durable-runtime (#129 W, #130) — the installed carrier and SDK-set verifier, beside the leaf.
 *
 * The oracle is the filesystem and Node's own package resolution on a tiny package tree this file
 * builds: a pin naming one carrier file, a license and an SDK set; the carrier bytes, resolver and
 * relocation files; and `node_modules` packages whose package.json versions are the declared or a
 * drifted one. Every refusal is made by a real filesystem operation (remove, rewrite, nest a
 * different version), never by editing the facts object. One case imports the COMPILED module from
 * this checkout's bridge closure to prove the package root resolves from the deeper depth too, so
 * like `entwurf-control.test.ts` this file needs a built bridge.
 *
 * The last block reads the three checkout gates as SOURCE for the signal and connect safety they
 * carry inside themselves; it runs no gate and spawns nothing (see its own note).
 */
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { operatorPiDurableSnapshot, operatorSnapshotUnchanged } from "../../scripts/lib/pi-durable-operator-guard.ts";
import {
	checkPiDurableRuntime,
	inspectPiDurableRuntime,
	type PiDurablePackageLayout,
	piDurableLayoutAt,
	piDurablePackageLayout,
	runPiDurableRuntimeCli,
} from "./pi-durable-runtime.ts";

const sha256 = (data: string | Buffer): string => createHash("sha256").update(data).digest("hex");
const VERSION = "1.0.4";
const RUNTIME_BYTES = "export const openDurable = () => {};\n";
const LICENSE_BYTES = "MIT License\n";

let root: string;
beforeEach(() => {
	root = fs.mkdtempSync(path.join(os.tmpdir(), "pi-durable-runtime-test-"));
});
afterEach(() => {
	fs.rmSync(root, { recursive: true, force: true });
});

/** A package manifest at `dir`, with optional dependencies. */
function manifest(dir: string, name: string, version: string, dependencies: Record<string, string> = {}): void {
	fs.mkdirSync(dir, { recursive: true });
	fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name, version, dependencies }));
}

/** A complete installed package at `<root>/<under>`: pin, carrier, resolver, relocation, and the SDK
 * set in its own node_modules unless `shared` hoists it to the parent tree (same-version sharing). */
function installed(options: { under?: string; shared?: boolean } = {}): PiDurablePackageLayout {
	const pkg = path.join(root, options.under ?? "consumer/node_modules/entwurf");
	const layout = piDurableLayoutAt(pkg);
	fs.mkdirSync(layout.overlayDir, { recursive: true });
	fs.mkdirSync(layout.carrierDir, { recursive: true });
	fs.writeFileSync(path.join(layout.carrierDir, "runtime.js"), RUNTIME_BYTES);
	fs.writeFileSync(path.join(layout.carrierDir, "LICENSE"), LICENSE_BYTES);
	fs.writeFileSync(layout.resolver, "");
	fs.writeFileSync(layout.relocation, "");
	fs.writeFileSync(
		path.join(layout.overlayDir, "upstream-pin.json"),
		JSON.stringify({
			carrier: {
				license: { sha256: sha256(LICENSE_BYTES) },
				files: [{ name: "runtime.js", sha256: sha256(RUNTIME_BYTES) }],
			},
			sdk: {
				members: { "@earendil-works/pi-ai": VERSION, "@earendil-works/pi-durable": VERSION },
				direct: { "proper-lockfile": "4.1.2" },
			},
		}),
	);
	const modules = options.shared ? path.join(root, "consumer", "node_modules") : path.join(pkg, "node_modules");
	manifest(path.join(modules, "@earendil-works", "pi-ai"), "@earendil-works/pi-ai", VERSION);
	manifest(path.join(modules, "@earendil-works", "pi-durable"), "@earendil-works/pi-durable", VERSION, {
		"@earendil-works/pi-ai": `^${VERSION}`,
		diff: "8.0.4",
	});
	manifest(path.join(modules, "proper-lockfile"), "proper-lockfile", "4.1.2");
	return layout;
}

const verdictOf = (layout: PiDurablePackageLayout) => {
	const checked = checkPiDurableRuntime(layout);
	return checked.ok ? "verified" : `${checked.reason}: ${checked.detail}`;
};

describe("pi-durable carrier — verified where the package is installed, read-only", () => {
	it("[QK:PI-DURABLE-RUNTIME-VERIFIED] a complete package whose carrier, resolver and SDK set are the pin verifies; the answer is its own resolver and every physical edge", () => {
		const layout = installed();
		const checked = checkPiDurableRuntime(layout);
		expect(checked.ok).toBe(true);
		if (!checked.ok) return;
		expect(checked.resolver).toBe(layout.resolver);
		expect(checked.edges.map((e) => `${e.from}>${e.to}@${e.got}`).sort()).toEqual([
			"@earendil-works/pi-durable>@earendil-works/pi-ai@1.0.4",
			"carrier>@earendil-works/pi-ai@1.0.4",
			"carrier>@earendil-works/pi-durable@1.0.4",
			"carrier>proper-lockfile@4.1.2",
		]);
	});

	it("[QK:PI-DURABLE-RUNTIME-PACKAGE-INCOMPLETE] a missing carrier file, license, resolver or relocation — or no pin next to the code — is an incomplete package, named", () => {
		const layout = installed();
		for (const file of [
			path.join(layout.carrierDir, "runtime.js"),
			path.join(layout.carrierDir, "LICENSE"),
			layout.resolver,
			layout.relocation,
		]) {
			const bytes = fs.readFileSync(file);
			fs.rmSync(file);
			expect(verdictOf(layout)).toBe(`pi-durable-package-incomplete: missing ${path.relative(layout.root, file)}`);
			fs.writeFileSync(file, bytes);
		}
		expect(verdictOf(layout)).toBe("verified");
		const none = checkPiDurableRuntime(null);
		expect(none.ok ? "" : none.reason).toBe("pi-durable-package-incomplete");
	});

	it("[QK:PI-DURABLE-RUNTIME-CARRIER-DRIFT] one changed byte in a carrier file or its license is carrier drift, named", () => {
		const layout = installed();
		fs.writeFileSync(path.join(layout.carrierDir, "runtime.js"), RUNTIME_BYTES.replace("{}", "{ }"));
		expect(verdictOf(layout)).toBe("pi-durable-carrier-drift: changed pi/pi-durable/carrier/runtime.js");
		fs.writeFileSync(path.join(layout.carrierDir, "runtime.js"), RUNTIME_BYTES);
		fs.appendFileSync(path.join(layout.carrierDir, "LICENSE"), "\n");
		expect(verdictOf(layout)).toBe("pi-durable-carrier-drift: changed pi/pi-durable/carrier/LICENSE");
	});

	it("[QK:PI-DURABLE-RUNTIME-SDK-ABSENT] a declared member or direct dependency that does not resolve from the carrier is absent, named by its edge", () => {
		const layout = installed();
		fs.rmSync(path.join(layout.root, "node_modules", "proper-lockfile"), { recursive: true });
		expect(verdictOf(layout)).toBe("pi-durable-sdk-absent: carrier → proper-lockfile wants 4.1.2, resolves nothing");
		const second = installed({ under: "second/node_modules/entwurf" });
		fs.rmSync(path.join(second.root, "node_modules", "@earendil-works", "pi-ai"), { recursive: true });
		expect(verdictOf(second)).toBe(
			"pi-durable-sdk-absent: carrier → @earendil-works/pi-ai wants 1.0.4, resolves nothing",
		);
	});

	it("[QK:PI-DURABLE-RUNTIME-SDK-MISMATCH] a physical edge bound to another version — the carrier's own, or a member's nested copy — is a mismatch naming that edge, whatever semver the member declares", () => {
		const layout = installed();
		const nested = path.join(
			layout.root,
			"node_modules",
			"@earendil-works",
			"pi-durable",
			"node_modules",
			"@earendil-works",
			"pi-ai",
		);
		manifest(nested, "@earendil-works/pi-ai", "1.0.3");
		expect(verdictOf(layout)).toBe(
			`pi-durable-sdk-mismatch: @earendil-works/pi-durable → @earendil-works/pi-ai wants 1.0.4, binds 1.0.3 at ${fs.realpathSync(nested)}`,
		);
		fs.rmSync(path.join(layout.root, "node_modules", "@earendil-works", "pi-durable", "node_modules"), {
			recursive: true,
		});
		manifest(path.join(layout.root, "node_modules", "@earendil-works", "pi-ai"), "@earendil-works/pi-ai", "1.0.5");
		expect(verdictOf(layout)).toMatch(
			/^pi-durable-sdk-mismatch: carrier → @earendil-works\/pi-ai wants 1\.0\.4, binds 1\.0\.5 at /,
		);
	});

	it("[QK:PI-DURABLE-RUNTIME-REACHABLE-CLOSURE] a member copy reached only through another member's nested copy is walked too: a third-depth edge bound to another version is a mismatch naming it, while a same-version third-depth copy verifies", () => {
		const layout = installed();
		const modules = path.join(layout.root, "node_modules", "@earendil-works");
		// pi-ai now declares pi-telemetry; the carrier's own pi-ai and its telemetry are the pin.
		manifest(path.join(modules, "pi-ai"), "@earendil-works/pi-ai", VERSION, {
			"@earendil-works/pi-telemetry": `^${VERSION}`,
		});
		manifest(path.join(modules, "pi-telemetry"), "@earendil-works/pi-telemetry", VERSION);
		const pin = path.join(layout.overlayDir, "upstream-pin.json");
		const declared = JSON.parse(fs.readFileSync(pin, "utf8"));
		declared.sdk.members["@earendil-works/pi-telemetry"] = VERSION;
		fs.writeFileSync(pin, JSON.stringify(declared));
		expect(verdictOf(layout)).toBe("verified");
		// pi-durable carries its OWN same-version pi-ai copy, whose telemetry is one patch behind.
		const nestedAi = path.join(modules, "pi-durable", "node_modules", "@earendil-works", "pi-ai");
		manifest(nestedAi, "@earendil-works/pi-ai", VERSION, { "@earendil-works/pi-telemetry": `^${VERSION}` });
		const nestedTelemetry = path.join(nestedAi, "node_modules", "@earendil-works", "pi-telemetry");
		manifest(nestedTelemetry, "@earendil-works/pi-telemetry", "1.0.3");
		expect(verdictOf(layout)).toBe(
			`pi-durable-sdk-mismatch: @earendil-works/pi-ai → @earendil-works/pi-telemetry wants 1.0.4, binds 1.0.3 at ${fs.realpathSync(nestedTelemetry)}`,
		);
		manifest(nestedTelemetry, "@earendil-works/pi-telemetry", VERSION);
		expect(verdictOf(layout)).toBe("verified");
	});

	it("[QK:PI-DURABLE-RUNTIME-PACKAGE-IDENTITY] an edge that lands on a package naming itself otherwise is a mismatch even at the pinned version", () => {
		const layout = installed();
		const ai = path.join(layout.root, "node_modules", "@earendil-works", "pi-ai");
		manifest(ai, "wrong-package-with-same-version", VERSION);
		expect(verdictOf(layout)).toBe(
			`pi-durable-sdk-mismatch: carrier → @earendil-works/pi-ai wants 1.0.4, binds wrong-package-with-same-version@1.0.4 at ${fs.realpathSync(ai)}`,
		);
	});

	it("[QK:PI-DURABLE-RUNTIME-SHARED-WALKED-ONCE] one physical copy is walked once: a copy reached by two paths adds its own edges once, and a member cycle terminates", () => {
		const layout = installed();
		const modules = path.join(layout.root, "node_modules", "@earendil-works");
		const pin = path.join(layout.overlayDir, "upstream-pin.json");
		const declared = JSON.parse(fs.readFileSync(pin, "utf8"));
		declared.sdk.members["@earendil-works/pi-telemetry"] = VERSION;
		fs.writeFileSync(pin, JSON.stringify(declared));
		manifest(path.join(modules, "pi-telemetry"), "@earendil-works/pi-telemetry", VERSION);
		// A diamond first (no cycle): pi-ai is reached from the carrier AND from pi-durable.
		manifest(path.join(modules, "pi-ai"), "@earendil-works/pi-ai", VERSION, {
			"@earendil-works/pi-telemetry": `^${VERSION}`,
		});
		const diamond = checkPiDurableRuntime(layout);
		expect(diamond.ok && diamond.edges.map((e) => `${e.from}>${e.to}`).sort()).toEqual([
			"@earendil-works/pi-ai>@earendil-works/pi-telemetry",
			"@earendil-works/pi-durable>@earendil-works/pi-ai",
			"carrier>@earendil-works/pi-ai",
			"carrier>@earendil-works/pi-durable",
			"carrier>@earendil-works/pi-telemetry",
			"carrier>proper-lockfile",
		]);
		// Then a cycle: pi-ai also depends on pi-durable, which depends on pi-ai.
		manifest(path.join(modules, "pi-ai"), "@earendil-works/pi-ai", VERSION, {
			"@earendil-works/pi-durable": `^${VERSION}`,
			"@earendil-works/pi-telemetry": `^${VERSION}`,
		});
		const cycle = checkPiDurableRuntime(layout);
		expect(cycle.ok && cycle.edges.length).toBe(7);
	});

	it("[QK:PI-DURABLE-RUNTIME-SHARED-COPY-PASSES] a same-version copy hoisted to the consumer and shared, or a same-version duplicate nested beside it, is an ordinary layout: it verifies", () => {
		const shared = installed({ shared: true });
		expect(verdictOf(shared)).toBe("verified");
		const atShared = checkPiDurableRuntime(shared);
		expect(atShared.ok && atShared.edges.find((e) => e.to === "@earendil-works/pi-ai")?.at).toBe(
			fs.realpathSync(path.join(root, "consumer", "node_modules", "@earendil-works", "pi-ai")),
		);
		manifest(
			path.join(
				root,
				"consumer",
				"node_modules",
				"@earendil-works",
				"pi-durable",
				"node_modules",
				"@earendil-works",
				"pi-ai",
			),
			"@earendil-works/pi-ai",
			VERSION,
		);
		expect(verdictOf(shared)).toBe("verified");
	});

	it("[QK:PI-DURABLE-RUNTIME-READ-ONLY] verifying writes nothing anywhere in the package or its dependency tree", () => {
		const layout = installed();
		const snapshot = (dir: string): string[] =>
			fs
				.readdirSync(dir, { recursive: true, withFileTypes: true })
				.map((e) => {
					const at = path.join(e.parentPath, e.name);
					return `${path.relative(root, at)} ${e.isFile() ? `${fs.statSync(at).mtimeMs} ${sha256(fs.readFileSync(at))}` : "dir"}`;
				})
				.sort();
		const before = snapshot(root);
		inspectPiDurableRuntime(layout);
		checkPiDurableRuntime(layout);
		expect(snapshot(root)).toEqual(before);
	});

	it("[QK:PI-DURABLE-RUNTIME-CHECKOUT-CARRIER] this checkout's committed carrier is complete and carries exactly the pinned bytes (the SDK edges are check-pi-runtime-version's, against the development install)", () => {
		const layout = piDurablePackageLayout();
		expect(layout).not.toBeNull();
		const facts = inspectPiDurableRuntime(layout as PiDurablePackageLayout);
		expect(facts.missing).toEqual([]);
		expect(facts.drifted).toEqual([]);
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
		expect(fs.existsSync(source?.carrierDir ?? "")).toBe(true);
	});
});

describe("pi-durable carrier — the launcher/setup CLI", () => {
	const capture = () => {
		const out = { stdout: [] as string[], stderr: [] as string[] };
		return { out, sink: { stdout: (l: string) => out.stdout.push(l), stderr: (l: string) => out.stderr.push(l) } };
	};

	it("[QK:PI-DURABLE-RUNTIME-CLI-EXITS] resolve prints the verified carrier resolver and exits 0, and exits 3 for every refusal, named first; there is no absent/SKIP code", () => {
		const layout = installed();
		const ok = capture();
		expect(runPiDurableRuntimeCli(["resolve"], layout, ok.sink)).toBe(0);
		expect(ok.out.stdout).toEqual([layout.resolver]);
		fs.rmSync(path.join(layout.root, "node_modules", "@earendil-works", "pi-durable"), { recursive: true });
		const absent = capture();
		expect(runPiDurableRuntimeCli(["resolve"], layout, absent.sink)).toBe(3);
		expect(absent.out.stderr[0]).toMatch(/^pi-durable-sdk-absent: carrier → @earendil-works\/pi-durable /);
		const incomplete = capture();
		expect(runPiDurableRuntimeCli(["resolve"], null, incomplete.sink)).toBe(3);
		expect(incomplete.out.stderr[0]).toMatch(/^pi-durable-package-incomplete: /);
		expect(runPiDurableRuntimeCli([], layout, capture().sink)).toBe(2);
	});
});

describe("pi-durable checkout gates — the coarse operator registration guard", () => {
	it("[QK:PI-DURABLE-GATE-OPERATOR-GUARD-INVARIANT] existing pi-durable registrations are not a red; a changed byte under the same name, a new registration or a new session entry is, and the snapshot changes nothing", () => {
		const agent = path.join(root, "agent");
		const write = (rel: string, body: string) => {
			fs.mkdirSync(path.dirname(path.join(agent, rel)), { recursive: true });
			fs.writeFileSync(path.join(agent, rel), body);
		};
		write("meta-sessions/20261006T080634-a269da.meta.json", JSON.stringify({ backend: "pi-durable", gardenId: "a" }));
		write("meta-sessions/20261006T080635-b1b1b1.meta.json", JSON.stringify({ backend: "claude-code", gardenId: "b" }));
		write("meta-receivers/20261006T080634-a269da.json", JSON.stringify({ backend: "pi-durable" }));
		write("meta-senders/pi-durable/4242.json", JSON.stringify({ pid: 4242 }));
		write("experimental/durable-sessions/cwdhash/1791337129868-e36907a0/session.sqlite", "SQLite format 3\u0000");
		const tree = () =>
			fs
				.readdirSync(agent, { recursive: true, withFileTypes: true })
				.map((e) => path.join(e.parentPath, e.name))
				.map(
					(f) => `${f} ${fs.statSync(f).isFile() ? `${fs.statSync(f).mtimeMs} ${sha256(fs.readFileSync(f))}` : "dir"}`,
				)
				.sort();
		const files = tree();
		const before = operatorPiDurableSnapshot(agent);
		expect(Object.keys(before.records)).toEqual(["20261006T080634-a269da.meta.json"]);
		expect(before.durableSessions).toEqual(["cwdhash", "cwdhash/1791337129868-e36907a0"]);
		expect(operatorSnapshotUnchanged(before, operatorPiDurableSnapshot(agent))).toBe(true);
		expect(tree()).toEqual(files);
		// A non-durable record changing is outside the subject.
		write("meta-sessions/20261006T080635-b1b1b1.meta.json", JSON.stringify({ backend: "claude-code", gardenId: "c" }));
		expect(operatorSnapshotUnchanged(before, operatorPiDurableSnapshot(agent))).toBe(true);
		const cases: [string, () => void, () => void][] = [
			[
				"same-name record bytes",
				() =>
					write(
						"meta-sessions/20261006T080634-a269da.meta.json",
						JSON.stringify({ backend: "pi-durable", gardenId: "z" }),
					),
				() =>
					write(
						"meta-sessions/20261006T080634-a269da.meta.json",
						JSON.stringify({ backend: "pi-durable", gardenId: "a" }),
					),
			],
			[
				"same-name sender bytes",
				() => write("meta-senders/pi-durable/4242.json", JSON.stringify({ pid: 4243 })),
				() => write("meta-senders/pi-durable/4242.json", JSON.stringify({ pid: 4242 })),
			],
			[
				"a new receiver",
				() => write("meta-receivers/20261007T000000-cccccc.json", JSON.stringify({ backend: "pi-durable" })),
				() => fs.rmSync(path.join(agent, "meta-receivers/20261007T000000-cccccc.json")),
			],
			[
				"a new durable session entry",
				() => fs.mkdirSync(path.join(agent, "experimental/durable-sessions/cwdhash/new-session")),
				() => fs.rmSync(path.join(agent, "experimental/durable-sessions/cwdhash/new-session"), { recursive: true }),
			],
		];
		for (const [label, change, undo] of cases) {
			change();
			expect(operatorSnapshotUnchanged(before, operatorPiDurableSnapshot(agent)), label).toBe(false);
			undo();
			expect(operatorSnapshotUnchanged(before, operatorPiDurableSnapshot(agent)), `${label} undone`).toBe(true);
		}
	});

	it("[QK:PI-DURABLE-GATE-OPERATOR-GUARD-WIRED] SOURCE check: each checkout gate snapshots before it spawns and judges only before == after, with no emptiness precondition on the operator", () => {
		for (const gate of ["check-pi-durable-contact.ts", "check-pi-durable-send.ts", "check-pi-durable-receive.ts"]) {
			const text = fs.readFileSync(path.join(GATE_DIR, gate), "utf8");
			expect(text.split("const operatorBefore = operatorPiDurableSnapshot(operatorAgent);").length - 1, gate).toBe(1);
			expect(
				text.split("operatorSnapshotUnchanged(operatorBefore, operatorPiDurableSnapshot(operatorAgent))").length - 1,
				gate,
			).toBe(1);
			expect(text.indexOf("const operatorBefore"), gate).toBeLessThan(text.indexOf("fs.mkdtempSync("));
			expect(text, gate).not.toMatch(/before\.durable\w*\.length === 0|!before\.senders/);
		}
	});
});

// ---------------------------------------------------------------------------
// The checkout gates' own signal and connect safety — SOURCE extraction, never a gate run
// ---------------------------------------------------------------------------

/**
 * The send and receive gates signal and close only what they own, and those contracts live INSIDE
 * the gates, which open the real durable app and so cannot run in the floor. Like the checkout-carrier
^ * case above, these cases read the gates as SOURCE: each cuts exact segments (every start boundary
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
