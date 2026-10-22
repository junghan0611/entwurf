/**
 * pi-durable carrier (#130, #141) — the relocation grammar the maintainer emitter applies and the
 * resolver accepts (pi/pi-durable/carrier-relocation.mjs), the committed carrier against its pin and
 * against a fresh emission of the owned source (pi/pi-durable/src), that source's own typecheck fence,
 * and the carrier's task footer (#134).
 *
 * No install and no upstream source. The footer is observed in ONE child that loads the committed
 * carrier through its own resolver, with a sandboxed HOME and agent directory and no model: the real
 * carrier runtime opened and closed — once fresh, once continued after one native background task was
 * committed into its session through the SDK's public `Conversation.commit` — and the carrier TUI's
 * badge and layout drawn by the published renderer on a fake terminal. Its independent oracle for the zero-task screen is the pinned upstream
 * layout (tui.ts at the pinned commit), rebuilt here. The installed-consumer load and the physical SDK
 * edges are a package proof (check-pack-install); a real terminal is the visible TTY observation.
 *
 * The 1.2 contacts (#141 S1-B3) are observed in a second child that drives the real bootstrap with a faux
 * model and the SDK's own storage failing on demand: tool output the model reads, a Session that fails
 * and closes itself, the receiver that retires with it, and a failed compaction kept on screen.
 *
 * The stream transport and the reference compaction policy (#143) are observed in a third child that drives the
 * real bootstrap against a loopback WebSocket server through the published Codex Responses provider: the frames that
 * server receives decide.
 */

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
	CARRIER_SCHEME,
	codingAgentDistFrom,
	readCarrierDeclaration,
	relocateCarrierSource,
	resolveCarrierSpecifier,
} from "../../pi/pi-durable/carrier-relocation.mjs";
import {
	compareCarrier,
	emitCarrier,
	emitterNodeDrift,
	readPin,
	readSourceObject,
} from "../../scripts/emit-pi-durable-carrier.ts";

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const DURABLE = path.join(ROOT, "pi", "pi-durable");
const PIN = path.join(DURABLE, "overlay", "upstream-pin.json");

const declared = { siblings: ["runtime.js", "tui.js"], targets: ["core/model-runtime.js", "config.js"] };
const reasonOf = (fn: () => unknown): string | undefined => {
	try {
		fn();
	} catch (error) {
		return (error as { reason?: string }).reason;
	}
	return undefined;
};

describe("relocateCarrierSource", () => {
	it("[QK:PI-DURABLE-CARRIER-RELOCATION-TWO-RULES] siblings become .js, ../../ internals take the reserved scheme, bare stays", () => {
		const code = [
			'import { ModelRuntime } from "../../core/model-runtime.ts";',
			"import {",
			"\tagentOf,",
			'} from "./runtime.ts";',
			'import { Harness } from "@earendil-works/pi-durable";',
			'import "node:path";',
			"",
		].join("\n");
		const out = relocateCarrierSource("tui.js", code, declared);
		expect(out.code).toBe(
			[
				`import { ModelRuntime } from "${CARRIER_SCHEME}core/model-runtime.js";`,
				"import {",
				"\tagentOf,",
				'} from "./runtime.js";',
				'import { Harness } from "@earendil-works/pi-durable";',
				'import "node:path";',
				"",
			].join("\n"),
		);
		expect(out.used).toEqual(["core/model-runtime.js"]);
	});

	it("[QK:PI-DURABLE-CARRIER-RELOCATION-REFUSES] an undeclared sibling or target, another relative path, a dynamic or unrecognized import", () => {
		const one = (code: string) => reasonOf(() => relocateCarrierSource("tui.js", code, declared));
		expect(one('import { x } from "./main.ts";\n')).toBe("carrier-relocation-unknown-sibling");
		expect(one('import { x } from "../../core/skills.ts";\n')).toBe("carrier-relocation-unknown-target");
		expect(one('import { x } from "../core/model-runtime.ts";\n')).toBe("carrier-relocation-unknown-relative");
		expect(one('import { x } from "/abs/model-runtime.ts";\n')).toBe("carrier-relocation-unknown-relative");
		expect(one(`import { x } from "${CARRIER_SCHEME}config.js";\n`)).toBe("carrier-relocation-unknown-relative");
		expect(one('const m = await import("../../config.ts");\n')).toBe("carrier-relocation-unrecognized-import");
		expect(one("import { x } from '../../config.ts';\n")).toBe("carrier-relocation-unrecognized-import");
	});
});

describe("resolveCarrierSpecifier", () => {
	let dist: string;
	let carrierDirUrl: string;
	beforeEach(() => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), "pi-durable-carrier-test-"));
		dist = path.join(root, "pi-coding-agent", "dist");
		fs.mkdirSync(path.join(dist, "core"), { recursive: true });
		fs.writeFileSync(path.join(dist, "core", "model-runtime.js"), "");
		carrierDirUrl = pathToFileURL(path.join(root, "entwurf", "pi", "pi-durable", "carrier")).href + "/";
	});
	afterEach(() => {
		fs.rmSync(path.dirname(path.dirname(dist)), { recursive: true, force: true });
	});
	const ask = (specifier: string, parent: string | undefined) =>
		resolveCarrierSpecifier(specifier, parent, {
			carrierDirUrl,
			files: declared.siblings,
			targets: declared.targets,
			dist: () => dist,
		});

	it("[QK:PI-DURABLE-CARRIER-RESOLVE-DECLARED] a declared carrier file asking for a declared target gets that file under the physical dist", () => {
		expect(ask(`${CARRIER_SCHEME}core/model-runtime.js`, `${carrierDirUrl}runtime.js`)).toBe(
			pathToFileURL(path.join(dist, "core", "model-runtime.js")).href,
		);
	});

	it("[QK:PI-DURABLE-CARRIER-RESOLVE-REFUSES] another origin, an undeclared or escaping target, a missing file", () => {
		const reason = (specifier: string, parent: string | undefined) => reasonOf(() => ask(specifier, parent));
		const target = `${CARRIER_SCHEME}core/model-runtime.js`;
		expect(reason(target, undefined)).toBe("pi-durable-carrier-specifier-origin");
		expect(reason(target, `${carrierDirUrl}main.js`)).toBe("pi-durable-carrier-specifier-origin");
		expect(reason(target, `${carrierDirUrl}nested/runtime.js`)).toBe("pi-durable-carrier-specifier-origin");
		expect(reason(target, pathToFileURL(path.join(ROOT, "pi", "pi-durable", "bootstrap.mjs")).href)).toBe(
			"pi-durable-carrier-specifier-origin",
		);
		expect(reason(`${CARRIER_SCHEME}core/skills.js`, `${carrierDirUrl}runtime.js`)).toBe(
			"pi-durable-carrier-specifier-unknown",
		);
		expect(reason(`${CARRIER_SCHEME}../../package.json`, `${carrierDirUrl}runtime.js`)).toBe(
			"pi-durable-carrier-specifier-unknown",
		);
		expect(reason(`${CARRIER_SCHEME}config.js`, `${carrierDirUrl}runtime.js`)).toBe(
			"pi-durable-carrier-target-missing",
		);
	});

	it("[QK:PI-DURABLE-CARRIER-HOST-ROOT] the dist is the parent of the root export only when that root is pi-coding-agent", () => {
		const root = path.dirname(dist);
		const entry = pathToFileURL(path.join(dist, "index.js")).href;
		expect(reasonOf(() => codingAgentDistFrom(entry))).toBe("pi-durable-carrier-host-root");
		fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ name: "@earendil-works/pi-ai" }));
		expect(reasonOf(() => codingAgentDistFrom(entry))).toBe("pi-durable-carrier-host-root");
		fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ name: "@earendil-works/pi-coding-agent" }));
		expect(codingAgentDistFrom(entry)).toBe(dist);
		expect(reasonOf(() => codingAgentDistFrom(pathToFileURL(path.join(dist, "core", "model-runtime.js")).href))).toBe(
			"pi-durable-carrier-host-root",
		);
	});
});

describe("the committed carrier", () => {
	const pin = JSON.parse(fs.readFileSync(PIN, "utf8"));

	it("[QK:PI-DURABLE-CARRIER-PIN-MATCHES] the carrier directory holds exactly the pinned files with the pinned bytes", () => {
		const { files, targets } = readCarrierDeclaration(PIN);
		expect(fs.readdirSync(path.join(DURABLE, "carrier")).sort()).toEqual([...files, "LICENSE"].sort());
		const digest = (name: string) =>
			createHash("sha256")
				.update(fs.readFileSync(path.join(DURABLE, "carrier", name)))
				.digest("hex");
		for (const file of pin.carrier.files) expect(digest(file.name), file.name).toBe(file.sha256);
		expect(digest("LICENSE")).toBe(pin.carrier.license.sha256);
		const used = new Set<string>();
		for (const name of files) {
			const code = fs.readFileSync(path.join(DURABLE, "carrier", name), "utf8");
			for (const m of code.matchAll(new RegExp(`"${CARRIER_SCHEME}([^"]+)"`, "g"))) used.add(m[1]);
			expect(code, name).not.toMatch(/from\s*"\.{1,2}\/[^"]*\.ts"/);
		}
		expect([...used].sort()).toEqual([...targets].sort());
	});

	it("[QK:PI-DURABLE-CARRIER-PIN-MALFORMED] a pin without a plain carrier declaration is refused by name", () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-durable-carrier-pin-"));
		try {
			const bad = path.join(dir, "upstream-pin.json");
			const write = (carrier: unknown) => fs.writeFileSync(bad, JSON.stringify({ ...pin, carrier }));
			write({ ...pin.carrier, files: [{ name: "../escape.js" }] });
			expect(reasonOf(() => readCarrierDeclaration(bad))).toBe("pi-durable-carrier-pin-malformed");
			// No slash, still not a plain carrier .js name: only the plain-name rule refuses it
			// (the slash rule above would also catch `../escape.js`, so it cannot tell them apart).
			write({ ...pin.carrier, files: [{ name: "escape.mjs" }] });
			expect(reasonOf(() => readCarrierDeclaration(bad))).toBe("pi-durable-carrier-pin-malformed");
			write({ ...pin.carrier, distTargets: ["core/../../x.js"] });
			expect(reasonOf(() => readCarrierDeclaration(bad))).toBe("pi-durable-carrier-pin-malformed");
			write(undefined);
			expect(reasonOf(() => readCarrierDeclaration(bad))).toBe("pi-durable-carrier-pin-malformed");
		} finally {
			fs.rmSync(dir, { recursive: true, force: true });
		}
	});
});

describe("the maintainer emitter's source reads", () => {
	it("[QK:PI-DURABLE-CARRIER-EMIT-NO-REPLACE] a refs/replace entry never stands in for a pinned object", () => {
		const repo = fs.mkdtempSync(path.join(os.tmpdir(), "pi-durable-carrier-replace-"));
		try {
			const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith("GIT_")));
			const git = (args: string[], input?: string) => {
				const run = spawnSync("git", ["-C", repo, ...args], { env, input });
				expect(run.status, `git ${args.join(" ")}: ${run.stderr}`).toBe(0);
				return run.stdout.toString().trim();
			};
			git(["init", "-q", "--bare"]);
			// Plumbing only: no commit hook runs and no identity config is read.
			const pinned = git(["hash-object", "-w", "--stdin"], "pinned\n");
			const tree = git(["mktree"], `100644 blob ${pinned}\tLICENSE\n`);
			const commit = spawnSync("git", ["-C", repo, "commit-tree", tree, "-m", "pin"], {
				env: {
					...env,
					GIT_AUTHOR_NAME: "t",
					GIT_AUTHOR_EMAIL: "t@t",
					GIT_COMMITTER_NAME: "t",
					GIT_COMMITTER_EMAIL: "t@t",
				},
			})
				.stdout.toString()
				.trim();
			git(["replace", pinned, git(["hash-object", "-w", "--stdin"], "replaced\n")]);
			// Control: the fixture really does replace the object for a plain read.
			expect(git(["cat-file", "blob", `${commit}:LICENSE`])).toBe("replaced");
			expect(readSourceObject(repo, `${commit}:LICENSE`).toString()).toBe("pinned\n");
		} finally {
			fs.rmSync(repo, { recursive: true, force: true });
		}
	});
});

describe("the maintainer emitter (#141): the carrier is the emission of the owned source", () => {
	const reasonOf = (fn: () => unknown): string | undefined => {
		try {
			fn();
		} catch (error) {
			return (error as Error).message.split(":")[0];
		}
		return undefined;
	};

	it("[QK:PI-DURABLE-CARRIER-EMIT-SOURCE-EQUAL] a fresh emission of pi/pi-durable/src is the committed carrier, byte for byte, with the pin's blob ids and digests; a missing source refuses", () => {
		const pin = readPin();
		const emission = emitCarrier(pin);
		expect(compareCarrier(pin, emission)).toEqual([]);
		// The emission's own bytes against the committed files, not only through the pin's digests.
		for (const [name, bytes] of emission.files) {
			expect(bytes.equals(fs.readFileSync(path.join(DURABLE, "carrier", name))), name).toBe(true);
		}
		expect([...emission.files.keys()].sort()).toEqual([...pin.carrier.files.map((f) => f.name), "LICENSE"].sort());
		// The source is in this repository: an absent file is a named refusal, never a skipped rebuild.
		const absent = structuredClone(pin);
		absent.carrier.files[0].source = "pi/pi-durable/src/experimental/durable/absent.ts";
		expect(reasonOf(() => emitCarrier(absent))).toBe("carrier-source-missing");
	});

	it("[QK:PI-DURABLE-CARRIER-EMIT-NODE-EXACT] the emitter identity is an exact Node version, kept apart from the byte comparison", () => {
		expect(emitterNodeDrift("v24.18.1", "v24.18.1")).toBeUndefined();
		for (const running of ["v24.18.0", "v24.19.0", "v25.0.0", "24.18.1"]) {
			expect(emitterNodeDrift("v24.18.1", running), running).toMatch(/^carrier-emitter-node-mismatch: /);
		}
		expect(emitterNodeDrift("", "v24.18.1")).toMatch(/^carrier-emitter-node-mismatch: /);
	});

	it("this host runs the pinned emitter Node — a named skip elsewhere, red under ENTWURF_REQUIRE_EMITTER_NODE=1 (the CI check job)", (context) => {
		const pinned = readPin().carrier.emitter.node;
		const drift = emitterNodeDrift(pinned, process.version);
		if (drift !== undefined && process.env.ENTWURF_REQUIRE_EMITTER_NODE !== "1") {
			context.skip(`${drift}: the bytes above were compared, the emitter identity was not — no rebuild PASS here`);
		}
		expect(drift).toBeUndefined();
	});
});

describe("the owned source's typecheck fence (pi/pi-durable/tsconfig.json)", () => {
	interface FenceRun {
		status: number | null;
		output: string;
		roots: string[];
		resolutions: { spec: string; from: string; to: string | null }[];
	}
	let fence: FenceRun;

	beforeAll(() => {
		const run = spawnSync(
			process.execPath,
			[
				path.join(ROOT, "node_modules", "typescript", "bin", "tsc"),
				"-p",
				"pi/pi-durable/tsconfig.json",
				"--noEmit",
				"--pretty",
				"false",
				"--explainFiles",
				"--traceResolution",
			],
			{ cwd: ROOT, encoding: "utf8", maxBuffer: 512 * 1024 * 1024, timeout: 120_000 },
		);
		const output = `${run.stdout}${run.stderr}`;
		const lines = output.split("\n");
		// explainFiles: a file line, then its indented reasons. A ROOT file is one an include pattern matched.
		const roots: string[] = [];
		for (const [at, line] of lines.entries()) {
			if (/^\s+Matched by include pattern /.test(line)) {
				let i = at - 1;
				while (i >= 0 && /^\s/.test(lines[i])) i--;
				roots.push(lines[i]);
			}
		}
		// traceResolution: each relative specifier the owned files ask for, paired with its outcome.
		const resolutions: FenceRun["resolutions"] = [];
		let asking: { spec: string; from: string } | undefined;
		for (const line of lines) {
			const ask = /^======== Resolving module '([^']+)' from '([^']+)'\. ========$/.exec(line);
			if (ask) {
				asking = { spec: ask[1], from: ask[2] };
				continue;
			}
			const done = /^======== Module name '([^']+)' was (?:successfully resolved to '([^']+)'|not resolved)/.exec(line);
			if (done && asking?.spec === done[1]) {
				if (asking.spec.startsWith("../../") && asking.from.includes("/pi/pi-durable/src/")) {
					resolutions.push({ ...asking, to: done[2] ?? null });
				}
				asking = undefined;
			}
		}
		fence = { status: run.status, output, roots: [...new Set(roots)].sort(), resolutions };
	}, 150_000);

	it("[QK:PI-DURABLE-SOURCE-FENCE-RESOLVES] the fence's roots are exactly the six owned files, and every ../../ internal they import is the INSTALLED pi-coding-agent's published declaration for a declared distTarget", () => {
		const pin = readPin();
		expect(fence.status, fence.output.slice(-4000)).toBe(0);
		expect(fence.roots).toEqual(pin.carrier.files.map((f) => f.source).sort());
		const dist = fs.realpathSync(path.join(ROOT, "node_modules", "@earendil-works", "pi-coding-agent", "dist"));
		const want = new Set<string>(
			pin.carrier.distTargets.map((t: string) => path.join(dist, t.replace(/\.js$/, ".d.ts"))),
		);
		const got = new Set<string>();
		for (const r of fence.resolutions) {
			expect(r.to, `${r.spec} from ${r.from}`).not.toBeNull();
			const real = fs.realpathSync(r.to ?? "");
			expect(want.has(real), `${r.spec} from ${r.from} resolved to ${real}`).toBe(true);
			got.add(real);
		}
		expect([...got].sort()).toEqual([...want].sort());
	});
});

describe("the package file list (#141): JS-only for the pi-durable app", () => {
	/**
	 * npm's packlist with no lifecycle script (no prepack, so no pnpm, no install, no build) and a sandboxed
	 * HOME, cache and userconfig: it reads package.json `files` and the tree, and writes nothing here.
	 * check-pack keeps the same tripwire on the floor over the prepacked tarball.
	 */
	function packlist(): string[] {
		const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "pi-durable-packlist-"));
		try {
			const userconfig = path.join(sandbox, "npmrc");
			fs.writeFileSync(userconfig, "");
			const run = spawnSync("npm", ["pack", "--dry-run", "--json", "--ignore-scripts"], {
				cwd: ROOT,
				encoding: "utf8",
				timeout: 60_000,
				env: {
					PATH: process.env.PATH ?? "",
					HOME: path.join(sandbox, "home"),
					npm_config_cache: path.join(sandbox, "cache"),
					npm_config_userconfig: userconfig,
					npm_config_offline: "true",
					npm_config_update_notifier: "false",
					npm_config_fund: "false",
					npm_config_audit: "false",
				},
			});
			expect(run.status, run.stderr).toBe(0);
			const packed = JSON.parse(run.stdout) as { files: { path: string }[] }[];
			expect(packed).toHaveLength(1);
			return packed[0].files.map((f) => f.path);
		} finally {
			fs.rmSync(sandbox, { recursive: true, force: true });
		}
	}

	it("[QK:PI-DURABLE-SOURCE-NOT-SHIPPED] npm's own file list for this package ships the emitted carrier and its LICENSE, never the owned source, its fence or the retired patch", () => {
		const files = packlist();
		const pin = readPin();
		for (const name of [...pin.carrier.files.map((f) => f.name), "LICENSE"]) {
			expect(files, name).toContain(`pi/pi-durable/carrier/${name}`);
		}
		expect(files).toContain("pi/pi-durable/overlay/upstream-pin.json");
		const source = /^pi\/pi-durable\/(src\/|tsconfig\.json$|overlay\/runtime-contacts\.patch$)/;
		expect(files.filter((f) => source.test(f))).toEqual([]);
	});

	it("[QK:PI-DURABLE-TEST-FIXTURES-NOT-SHIPPED] the tree holds test fixtures under pi-extensions/**/fixtures/, and npm's own file list for this package ships none of them while it ships pi-extensions/", () => {
		const fixtures = fs
			.globSync("pi-extensions/**/fixtures/**", { cwd: ROOT })
			.filter((f) => fs.statSync(path.join(ROOT, f)).isFile());
		expect(fixtures.length, "no fixture in the tree: this check would prove nothing").toBeGreaterThan(0);
		const files = packlist();
		expect(
			files.some((f) => f.startsWith("pi-extensions/")),
			"pi-extensions/ itself ships",
		).toBe(true);
		const shipped = new Set(files);
		expect(fixtures.filter((f) => shipped.has(f))).toEqual([]);
		expect(files.filter((f) => /^pi-extensions\/(.+\/)?fixtures\//.test(f))).toEqual([]);
	});
});

/**
 * The child's program: a plain string, so nothing in it is transformed by the test runner. It runs with
 * the carrier resolver preloaded and the repository as its directory, and prints one JSON report.
 */
const FOOTER_ORACLE = String.raw`
const { readdirSync, statSync } = await import("node:fs");
const { join } = await import("node:path");
const { BACKGROUND_CONTEXT: context } = await import("@earendil-works/chord/context");
const { createRegistry, Harness } = await import("@earendil-works/pi-durable");
const { openNodeSqliteStorage } = await import("@earendil-works/pi-durable/storage/sqlite/node");
const carrier = new URL("./pi/pi-durable/carrier/", "file://" + process.cwd() + "/").href;
const { TaskBadge, describeTask, durableLayout } = await import(carrier + "tui.js");
const { openDurable } = await import(carrier + "runtime.js");
const { Container, ScrollView, Text, TruncatedText, TuiAltScreen, VStack } = await import("@earendil-works/pi-tui");
const dist = new URL(".", import.meta.resolve("@earendil-works/pi-coding-agent")).href;
(await import(dist + "modes/interactive/theme/theme.js")).initTheme();
const { ModelRuntime } = await import(dist + "core/model-runtime.js");
const strip = (s) => s.replace(/\x1b\[[0-9;?]*[ -\/]*[@-~]/g, "").replace(/\x1b\][^\x07\x1b]*(\x07|\x1b\\)/g, "");
const project = process.env.ORACLE_PROJECT;

// A native task that holds until its invocation is cancelled; created background, it is a live
// background node for as long as the session is open.
const Hold = {
	definition: {
		name: "footer-oracle.hold",
		version: 1,
		initial: () => ({ phase: "hold" }),
		phases: {
			async hold(_task, runtime) {
				await new Promise((resolve) => runtime.signal.addEventListener("abort", resolve, { once: true }));
			},
		},
		async abort(_task, runtime, ctx) {
			await runtime.commit(() => ({ status: "terminal", outcome: { status: "aborted" } }), ctx);
		},
	},
};
const extension = { name: "footer-oracle", tasks: [Hold] };

const fresh = await openDurable({ cwd: project, extensions: [extension] });
const seen = (d) => ({ observed: d.view.current().tasks !== undefined, panel: d.view.current().tasksPanel });
const runtime = { opened: seen(fresh) };
await fresh.controller.toggleTasks();
runtime.hidden = seen(fresh);
await fresh.controller.toggleTasks();
runtime.shown = seen(fresh);
await fresh.close();

// One background task committed into that session through the SDK's public commit, then the session
// continued by the carrier: its graph and its badge, then both again with the panel hidden.
const sessions = (dir) => readdirSync(dir).flatMap((name) => {
	const at = join(dir, name);
	return statSync(at).isDirectory() ? sessions(at) : name === "session.sqlite" ? [at] : [];
});
const databases = sessions(process.env.PI_CODING_AGENT_DIR);
const registry = createRegistry();
registry.install(extension);
const seeding = await Harness.open(await openNodeSqliteStorage(databases[0]), { models: await ModelRuntime.create(), registry }, context);
await (await seeding.root(context, {})).commit((tx) => tx.createTask(Hold, {}, { ownership: { kind: "conversation" }, background: true }), context);
await seeding.close(context);
const continued = await openDurable({ cwd: project, continueSession: true, extensions: [extension] });
const live = () => {
	const view = continued.view.current();
	const badge = new TaskBadge();
	badge.set(view.tasks);
	return {
		panel: view.tasksPanel,
		nodes: Object.values(view.tasks?.tasks ?? {}).map((n) => ({ kind: n.kind, background: n.background, status: n.state.status })),
		badge: badge.render(40).map(strip),
	};
};
runtime.native = { databases: databases.length, shown: live() };
await continued.controller.toggleTasks();
runtime.native.hidden = live();
await continued.close();

const node = (id, kind, background, state, abortRequested = false) =>
	({ id: String(id), kind, conversationId: 1, background, abortRequested, state, conversations: [] });
const graph = (nodes) => ({ tasks: Object.fromEntries(nodes.map((n) => [n.id, n])) });
const running = { status: "running", phase: "run" };
const asleep = { status: "sleeping", phase: "backoff", until: Number(process.env.ORACLE_WAKE) };
const backgrounds = (n) => graph(Array.from({ length: n }, (_, i) => node(i + 1, "kind-" + i, true, running)));
const cases = {
	absent: undefined,
	none: graph([]),
	foregroundOnly: graph([node(1, "pi.generation", false, running), node(2, "pi.tool", false, running)]),
	one: graph([node(7, "agent-config.bash-background", true, running)]),
	mixed: graph([
		node(1, "pi.generation", false, running),
		node(2, "agent-config.bash-background", true, running),
		node(3, "x.other", true, { status: "waiting", phase: "p", on: ["9"], policy: "allSettled" }),
		node(4, "y.other", true, { status: "completing", outcome: "interrupted" }),
		node(5, "z.other", true, running, true),
		node(6, "w.other", true, { status: "pending", phase: "p" }),
	]),
	many: backgrounds(12),
	sleeping: graph([
		node(1, "pi.generation", false, asleep),
		node(2, "x.sleeper", true, asleep),
		node(3, "x.other", true, { status: "waiting", phase: "p", on: ["9"], policy: "allSettled" }),
		node(4, "y.sleeper", true, asleep, true),
	]),
};
const badge = {};
for (const [name, value] of Object.entries(cases)) {
	const b = new TaskBadge();
	b.set(value);
	badge[name] = { count: b.count, widths: Object.fromEntries([1, 2, 3, 4, 6, 10, 12, 80].map((w) => [w, b.render(w).map(strip)])) };
}
// The tasks panel's lines: a sleeping task's wake time on this child's fixed zone, and every reason the SDK gives
// for a task it cannot run, beside the same task unblocked.
const parked = node(20, "x.parked", true, { status: "pending", phase: "p" });
const panel = {
	sleeping: describeTask(node(8, "pi.generation", false, asleep)),
	blocked: Object.fromEntries(
		["missing_task", "task_too_old", "migration_failed", "restart_limit"].map((r) => [r, describeTask({ ...parked, blocked: r })]),
	),
	unblocked: describeTask(parked),
};

const terminal = (dims) => ({
	start() {}, stop() {}, async drainInput() {}, write() {},
	get columns() { return dims.cols; }, get rows() { return dims.rows; }, get kittyProtocolActive() { return false; },
	moveBy() {}, hideCursor() {}, showCursor() {}, clearLine() {}, clearFromCursor() {}, clearScreen() {},
	setTitle() {}, setProgress() {}, setStatus() {},
});
const editorStandIn = { render: (w) => ["EDTOP----", "EDTXT", "EDBOT----"].map((l) => l.slice(0, w)), invalidate() {} };
function parts() {
	const chat = new Container();
	for (let i = 0; i < 30; i++) chat.addChild(new Text("chat line " + i, 1, 0));
	const content = new Container();
	content.addChild(chat);
	const tasks = new Container();
	for (const l of ["Tasks (2 live, /tasks to hide)", "  x #1: running"]) tasks.addChild(new TruncatedText(l, 1, 0));
	const footer = new Container();
	footer.addChild(new Text("stats  /home/user/some/long/cwd", 1, 0));
	footer.addChild(new Text("main · provider/model · keys", 1, 0));
	const dock = [
		{ component: tasks, shrink: 1, minSize: 0 },
		{ component: new Container(), shrink: 1, minSize: 0 },
		{ component: new Container(), shrink: 1, minSize: 0 },
		{ component: editorStandIn, shrink: 1, minSize: 3 },
		{ component: footer, shrink: 1, minSize: 0 },
	];
	return { transcript: new ScrollView(content, { follow: "end", primary: true, overscroll: "chain" }), dock };
}
// The pinned upstream screen (tui.ts at the pinned commit): no badge, the transcript always shown.
function upstreamRoot() {
	const p = parts();
	return new VStack([
		{ component: p.transcript, basis: 0, grow: 1, shrink: 1, minSize: 1 },
		{ component: new VStack(p.dock), basis: "auto", grow: 0, shrink: 1, minSize: 1 },
	]);
}
function screen(dims, root) {
	const ui = new TuiAltScreen(terminal(dims), false, undefined, { mouse: false });
	ui.setLayoutRoot(root);
	return ui;
}
function draw(ui) {
	ui.stopped = false;
	ui.altScreenActive = true;
	ui.doRender();
	return ui.previousScreen.map(strip);
}
const marked = (lines) => lines.some((l) => l.includes("⏳") || l.trim().startsWith("*"));
const upstream = (rows, cols) => draw(screen({ rows, cols }, upstreamRoot())).join("\n");
const candidate = (count) => {
	const b = new TaskBadge();
	b.set(backgrounds(count));
	const p = parts();
	return { badge: b, root: durableLayout(p.transcript, b, p.dock) };
};

const cells = [];
for (const count of [0, 1, 2, 12]) {
	for (let rows = 1; rows <= 8; rows++) {
		for (let cols = 1; cols <= 12; cols++) {
			const lines = draw(screen({ rows, cols }, candidate(count).root));
			cells.push({ count, rows, cols, marked: marked(lines), upstream: lines.join("\n") === upstream(rows, cols) });
		}
	}
}
const transitions = [];
for (const rows of [1, 2, 3, 5]) {
	for (const cols of [1, 2, 3, 12]) {
		const c = candidate(2);
		const ui = screen({ rows, cols }, c.root);
		for (const count of [2, 1, 0, 2]) {
			c.badge.set(backgrounds(count));
			const lines = draw(ui);
			transitions.push({ rows, cols, count, marked: marked(lines), upstream: lines.join("\n") === upstream(rows, cols) });
		}
	}
}
const resize = [];
{
	const dims = { rows: 8, cols: 12 };
	const ui = screen(dims, candidate(2).root);
	for (const [rows, cols] of [[8, 12], [2, 3], [1, 1], [5, 12], [3, 2], [1, 12], [40, 120], [4, 4]]) {
		dims.rows = rows;
		dims.cols = cols;
		resize.push({ rows, cols, marked: marked(draw(ui)) });
	}
}
console.log(JSON.stringify({ runtime, badge, panel, cells, transitions, resize }));
`;

interface NativeView {
	panel: boolean;
	nodes: { kind: string; background: boolean; status: string }[];
	badge: string[];
}

interface FooterReport {
	runtime: Record<"opened" | "hidden" | "shown", { observed: boolean; panel: boolean }> & {
		native: { databases: number; shown: NativeView; hidden: NativeView };
	};
	badge: Record<string, { count: number; widths: Record<string, string[]> }>;
	panel: { sleeping: string; blocked: Record<string, string>; unblocked: string };
	cells: { count: number; rows: number; cols: number; marked: boolean; upstream: boolean }[];
	transitions: { rows: number; cols: number; count: number; marked: boolean; upstream: boolean }[];
	resize: { rows: number; cols: number; marked: boolean }[];
}

/** A sleeping task's wake time: 2027-03-04 05:06:07 in Asia/Seoul, the previous day in UTC. */
const WAKE = 1_804_104_367_000;

describe("the carrier's task footer (#134), observed through the carrier resolver", () => {
	let report: FooterReport;

	beforeAll(() => {
		const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "pi-durable-footer-"));
		try {
			const project = path.join(sandbox, "project");
			fs.mkdirSync(project);
			const run = spawnSync(
				process.execPath,
				["--import", path.join(DURABLE, "carrier-resolver.mjs"), "--input-type=module", "-e", FOOTER_ORACLE],
				{
					cwd: ROOT,
					encoding: "utf8",
					timeout: 60_000,
					env: {
						PATH: process.env.PATH ?? "",
						HOME: path.join(sandbox, "home"),
						PI_CODING_AGENT_DIR: path.join(sandbox, "home", ".pi", "agent"),
						PI_OFFLINE: "1",
						ORACLE_PROJECT: project,
						ORACLE_WAKE: String(WAKE),
						TZ: "Asia/Seoul",
					},
				},
			);
			expect(run.status, run.stderr).toBe(0);
			report = JSON.parse(run.stdout.trim().split("\n").at(-1) ?? "");
		} finally {
			fs.rmSync(sandbox, { recursive: true, force: true });
		}
	}, 90_000);

	it("[QK:PI-DURABLE-FOOTER-GRAPH-LIFETIME] the real carrier runtime observes the task graph from open to close, a committed native background task included; /tasks toggles only the panel", () => {
		const both = (panel: boolean) => ({ observed: true, panel });
		const { native, ...fresh } = report.runtime;
		expect(fresh).toEqual({ opened: both(true), hidden: both(false), shown: both(true) });
		expect(native.databases).toBe(1);
		for (const [view, panel] of [
			[native.shown, true],
			[native.hidden, false],
		] as const) {
			expect(view.panel).toBe(panel);
			expect(view.nodes).toHaveLength(1);
			expect(view.nodes[0]).toMatchObject({ kind: "footer-oracle.hold", background: true });
			expect(["pending", "running"]).toContain(view.nodes[0]?.status);
		}
	});

	it("[QK:PI-DURABLE-FOOTER-BADGE-COUNT] the badge counts live background tasks of any kind, names the ones not running, and draws nothing without one", () => {
		for (const name of ["absent", "none", "foregroundOnly"]) {
			expect(report.badge[name]?.count, name).toBe(0);
			for (const lines of Object.values(report.badge[name]?.widths ?? {})) expect(lines, name).toEqual([]);
		}
		expect(report.badge.one?.count).toBe(1);
		expect(report.badge.one?.widths["80"]).toEqual([" ⏳ 1 task"]);
		expect(report.badge.mixed?.count).toBe(5);
		expect(report.badge.mixed?.widths["80"]).toEqual([" ⏳ 5 tasks (1 aborting, 1 completing, 1 waiting, 1 pending)"]);
		expect(report.badge.many?.count).toBe(12);
		// The same badge over the carrier's own graph of a committed native background task, panel shown and
		// hidden. A recovered task reads `pending` until it runs again, and the badge says so.
		for (const view of [report.runtime.native.shown, report.runtime.native.hidden]) {
			const pending = view.nodes[0]?.status === "pending" ? " (1 pending)" : "";
			expect(view.badge).toEqual([` ⏳ 1 task${pending}`]);
		}
	});

	it("[QK:PI-DURABLE-FOOTER-BADGE-WIDTH] a narrower terminal drops detail, then words, down to one ASCII cell; the padding goes first", () => {
		expect(report.badge.mixed?.widths).toEqual({
			"1": ["*"],
			"2": ["*5"],
			"3": ["⏳5"],
			"4": ["⏳ 5"],
			"6": [" ⏳ 5"],
			"10": ["⏳ 5 tasks"],
			"12": [" ⏳ 5 tasks"],
			"80": [" ⏳ 5 tasks (1 aborting, 1 completing, 1 waiting, 1 pending)"],
		});
		expect(report.badge.many?.widths["2"]).toEqual(["*+"]);
		expect(report.badge.many?.widths["3"]).toEqual(["*12"]);
	});

	it("[QK:PI-DURABLE-TASK-SLEEPING-COUNTED] the badge names a sleeping background task as sleeping; an aborting one stays aborting", () => {
		expect(report.badge.sleeping?.count).toBe(3);
		expect(report.badge.sleeping?.widths["80"]).toEqual([" ⏳ 3 tasks (1 aborting, 1 waiting, 1 sleeping)"]);
	});

	it("[QK:PI-DURABLE-TASK-SLEEPING-SHOWN] a sleeping task's panel line says when it wakes, in local wall-clock time", () => {
		// The child runs on Asia/Seoul; its wall clock is read again here by Intl, never by the carrier's formatter.
		const wake = new Intl.DateTimeFormat("sv-SE", {
			timeZone: "Asia/Seoul",
			year: "numeric",
			month: "2-digit",
			day: "2-digit",
			hour: "2-digit",
			minute: "2-digit",
			second: "2-digit",
			hourCycle: "h23",
		}).format(WAKE);
		expect(wake).toBe("2027-03-04 05:06:07");
		expect(report.panel.sleeping).toBe(`pi.generation #8: sleeping backoff until ${wake}`);
	});

	it("[QK:PI-DURABLE-TASK-BLOCKED-SHOWN] a task that cannot run is marked blocked on its panel line, for each of the four reasons, and an unblocked one is not", () => {
		const reasons = ["missing_task", "task_too_old", "migration_failed", "restart_limit"];
		expect(Object.keys(report.panel.blocked)).toEqual(reasons);
		for (const reason of reasons)
			expect(report.panel.blocked[reason], reason).toMatch(
				/^x\.parked #20: pending p \[background, blocked:[a-z_]+\]$/,
			);
		expect(report.panel.unblocked).toBe("x.parked #20: pending p [background]");
	});

	it("[QK:PI-DURABLE-TASK-BLOCKED-REASON] the blocked mark is the SDK's own reason, verbatim, each one its own", () => {
		expect(report.panel.blocked).toEqual({
			missing_task: "x.parked #20: pending p [background, blocked:missing_task]",
			task_too_old: "x.parked #20: pending p [background, blocked:task_too_old]",
			migration_failed: "x.parked #20: pending p [background, blocked:migration_failed]",
			restart_limit: "x.parked #20: pending p [background, blocked:restart_limit]",
		});
	});

	it("[QK:PI-DURABLE-FOOTER-BADGE-PROTECTED] with live background tasks the badge is on screen at every positive size, through count changes and resizes", () => {
		const live = report.cells.filter((c) => c.count > 0);
		expect(live).toHaveLength(3 * 8 * 12);
		expect(live.filter((c) => !c.marked)).toEqual([]);
		expect(report.transitions.filter((t) => t.count > 0 && !t.marked)).toEqual([]);
		expect(report.resize).toHaveLength(8);
		expect(report.resize.filter((r) => !r.marked)).toEqual([]);
	});

	it("[QK:PI-DURABLE-FOOTER-ZERO-UPSTREAM] with no live background task the screen is the pinned upstream screen, also after the last task leaves", () => {
		const idle = report.cells.filter((c) => c.count === 0);
		expect(idle).toHaveLength(8 * 12);
		expect(idle.filter((c) => !c.upstream || c.marked)).toEqual([]);
		const left = report.transitions.filter((t) => t.count === 0);
		expect(left).toHaveLength(16);
		expect(left.filter((t) => !t.upstream)).toEqual([]);
	});
});

/**
 * #141 S1-B3, the application on the 1.2 SDK: ONE child drives the real bootstrap (`main` and
 * `openDurableCitizen`), the committed carrier through its resolver, the compiled contact, the SDK's own
 * node:sqlite storage and a faux model, with a sandboxed HOME and agent directory and a stub bridge — no
 * network, no vendor turn, no host store. The faux provider is registered on every `ModelRuntime` the
 * carrier creates; a storage failure is the SDK's own `SqliteStorage.commit` rejecting once when armed.
 * Nothing waits forever: every wait is bounded and recorded, so one broken contact fails its own claim.
 */
const APP_ORACLE = String.raw`
const fs = await import("node:fs");
const path = await import("node:path");
const { fauxAssistantMessage, fauxProvider, fauxToolCall } = await import("@earendil-works/pi-ai");
const { openNodeSqliteStorage } = await import("@earendil-works/pi-durable/storage/sqlite/node");
const { BACKGROUND_CONTEXT: context } = await import("@earendil-works/chord/context");
const repo = "file://" + process.cwd() + "/";
const { durableNotices } = await import(new URL("./pi/pi-durable/carrier/tui.js", repo).href);
const { main, openDurableCitizen } = await import(new URL("./pi/pi-durable/bootstrap.mjs", repo).href);
const { PI_DURABLE_TOOL_SCHEMAS } = await import(new URL("./mcp/entwurf-bridge/dist/pi-extensions/meta-bridge-pi-durable.js", repo).href);
const dist = new URL(".", import.meta.resolve("@earendil-works/pi-coding-agent")).href;
const { ModelRuntime } = await import(dist + "core/model-runtime.js");
const sandbox = process.env.ORACLE_SANDBOX;
const report = { waits: {} };

// "small" has a window a long input crosses the SDK's blocking compaction threshold on (pi's default reserve).
const faux = fauxProvider({ provider: "faux", models: [{ id: "scripted" }, { id: "small", contextWindow: 60000 }] });
const create = ModelRuntime.create.bind(ModelRuntime);
ModelRuntime.create = async (...args) => {
	const runtime = await create(...args);
	runtime.registerNativeProvider(faux.provider);
	return runtime;
};

const probe = await openNodeSqliteStorage(path.join(sandbox, "probe.sqlite"));
const storageProto = Object.getPrototypeOf(probe);
if (storageProto === Object.prototype || !Object.hasOwn(storageProto, "commit")) throw new Error("storage commit is not a class method");
const commit = storageProto.commit;
let armed = false;
storageProto.commit = function (...args) {
	if (armed) {
		armed = false;
		return Promise.reject(new Error("S1B3-INJECTED-STORAGE-FAILURE"));
	}
	return commit.apply(this, args);
};
await probe.close(context);

const roots = (name) => {
	const base = path.join(sandbox, "meta-" + name);
	const dirs = { sessionsDir: path.join(base, "sessions"), sendersDir: path.join(base, "senders"), mailboxDir: path.join(base, "mailbox"), receiversDir: path.join(base, "receivers") };
	for (const dir of Object.values(dirs)) fs.mkdirSync(dir, { recursive: true });
	return { ...dirs, env: {}, connect: async () => ({
		pid: 4242,
		listTools: async () => Object.entries(PI_DURABLE_TOOL_SCHEMAS).map(([name, inputSchema]) => ({ name, inputSchema })),
		callTool: async (name) => ({ text: name + " ok", isError: false }),
		close: async () => {},
	}) };
};
const project = (name) => {
	const dir = path.join(sandbox, "project-" + name);
	fs.mkdirSync(dir, { recursive: true });
	return dir;
};
const until = async (what, predicate, ms = 15000) => {
	const end = Date.now() + ms;
	while (!predicate()) {
		if (Date.now() > end) {
			report.waits[what] = "timed out";
			return false;
		}
		await new Promise((resolve) => setTimeout(resolve, 10));
	}
	report.waits[what] = "met";
	return true;
};
const textOf = (message) => (Array.isArray(message?.content) ? message.content.map((block) => block.text ?? "").join("") : message?.content);
const idle = (view) => (view.conversation.docs["pi.live"] ?? {}).run === undefined;
const answered = (view, text) => idle(view) && view.conversation.entries.some((entry) => entry.kind === "pi.assistant" && textOf(entry.model?.[0]) === text);
const lines = (view) => durableNotices(view).map((line) => line.level + ": " + line.message);
const fresh = { model: { provider: "faux", model: "scripted" } };

// 1. What the model reads from a tool: a subagent call, and an operator module's tool through the bootstrap's own
//    --native-module ingress.
{
	const nativeModule = path.join(sandbox, "echo.extension.mjs");
	fs.writeFileSync(nativeModule, 'export default { name: "s1b3-native", tools: [{ name: "native_echo", description: "echo", parameters: { type: "object", properties: {} }, execute: async () => ({ output: [{ type: "text", text: "NATIVE-OUTPUT-S1B3" }] }) }] };\n');
	faux.setResponses([
		fauxAssistantMessage(fauxToolCall("subagent", { task: "answer the child task" }), { stopReason: "toolUse" }),
		fauxAssistantMessage("CHILD-ANSWER-S1B3"),
		fauxAssistantMessage(fauxToolCall("native_echo", {}), { stopReason: "toolUse" }),
		fauxAssistantMessage("ALL-DONE-S1B3"),
	]);
	const cwd = process.cwd();
	process.chdir(project("output"));
	try {
		await main(["--provider", "faux", "--model", "scripted", "--width", "task-wide", "--native-module", nativeModule], {
			loadTui: async () => ({
				runDurableTui: async (source, controller) => {
					await controller.submit("delegate, then echo", "steer");
					await until("output turn", () => answered(source.current(), "ALL-DONE-S1B3"));
					report.output = source.current().conversation.entries
						.filter((entry) => entry.kind === "pi.tool-result")
						.map((entry) => ({ tool: entry.model?.[0]?.toolName, text: textOf(entry.model?.[0]) }));
				},
			}),
			contact: roots("output"),
		});
	} finally {
		process.chdir(cwd);
	}
}

// 2. The Session fails under a tool that ignores its abort, so its join holds and closed cannot settle yet.
{
	let release;
	const held = new Promise((resolve) => {
		release = resolve;
	});
	const hold = { state: "idle" };
	const extension = { name: "s1b3-fatal", tools: [{
		name: "hold_and_fail",
		description: "fail the storage, then hold, ignoring abort",
		parameters: { type: "object", properties: {} },
		execute: async (_args, api, ctx) => {
			hold.state = "holding";
			armed = true;
			await api.details({ step: "armed" }, ctx).catch(() => {});
			await held;
			hold.state = "released";
			return { output: [{ type: "text", text: "released" }] };
		},
	}] };
	faux.setResponses([fauxAssistantMessage(fauxToolCall("hold_and_fail", {}), { stopReason: "toolUse" })]);
	const citizen = await openDurableCitizen({ ...fresh, cwd: project("fatal"), extensions: [extension], contact: roots("fatal") });
	const marker = citizen.attachment.receiverMarkerPath;
	const fatal = { markerBefore: fs.existsSync(marker), receiverBefore: citizen.contact.receiver().status, failedCalls: 0, lateFailedCalls: 0 };
	citizen.durable.onFailed(() => fatal.failedCalls++);
	try {
		await citizen.durable.controller.submit("go", "steer");
		await until("hold", () => hold.state === "holding");
		await until("failure cause", () => citizen.durable.view.current().failure?.error !== undefined, 5000);
		// Subscribed after the failure: told at once, and only once.
		citizen.durable.onFailed(() => fatal.lateFailedCalls++);
		await new Promise((resolve) => setImmediate(resolve));
		const view = citizen.durable.view.current();
		Object.assign(fatal, {
			failure: view.failure ?? null,
			holdAtFailure: hold.state,
			receiver: citizen.contact.receiver(),
			markerAfter: fs.existsSync(marker),
			lines: lines(view),
		});
		const calls = faux.state.callCount;
		const before = view.notices.length;
		await citizen.durable.controller.submit("after the failure", "steer");
		await until("refusal", () => citizen.durable.view.current().notices.length > before, 5000);
		fatal.refusal = { notices: citizen.durable.view.current().notices.slice(before).map((n) => n.level + ": " + n.message), modelCalls: faux.state.callCount - calls, holdAtRefusal: hold.state };
	} finally {
		release();
		fatal.close = await citizen.close().then(() => "ok", (error) => String(error));
	}
	report.fatal = fatal;
}

// 2b. The Session fails before the contact attaches (the bootstrap's own open seam, the carrier's openDurable): the
//     doorbell it arms is retired before attach returns, and no receiver marker is left for a sender to read.
{
	const { openDurable } = await import(new URL("./pi/pi-durable/carrier/runtime.js", repo).href);
	let release;
	const held = new Promise((resolve) => {
		release = resolve;
	});
	const hold = { state: "idle" };
	const extension = { name: "s1b3-early", tools: [{
		name: "hold_and_fail",
		description: "fail the storage, then hold, ignoring abort",
		parameters: { type: "object", properties: {} },
		execute: async (_args, api, ctx) => {
			hold.state = "holding";
			armed = true;
			await api.details({ step: "armed" }, ctx).catch(() => {});
			await held;
			hold.state = "released";
			return { output: [{ type: "text", text: "released" }] };
		},
	}] };
	faux.setResponses([fauxAssistantMessage(fauxToolCall("hold_and_fail", {}), { stopReason: "toolUse" })]);
	const early = {};
	let citizen;
	try {
		citizen = await openDurableCitizen({
			...fresh,
			cwd: project("early"),
			extensions: [extension],
			contact: roots("early"),
			open: async (options) => {
				const durable = await openDurable(options);
				await durable.controller.submit("go", "steer");
				await until("early failure", () => durable.view.current().failure?.error !== undefined, 5000);
				early.holdAtAttach = hold.state;
				return durable;
			},
		});
		Object.assign(early, {
			receiver: citizen.contact.receiver(),
			receiverMarkerPath: citizen.attachment.receiverMarkerPath,
			receiverMarkers: fs.readdirSync(path.join(sandbox, "meta-early", "receivers")),
		});
	} catch (error) {
		early.error = String(error);
	} finally {
		release();
		early.close = citizen === undefined ? "no citizen" : await citizen.close().then(() => "ok", (error) => String(error));
	}
	report.early = early;
}

// 3. Control: the same wiring closed by the host is no failure, and its receiver retires as closed.
{
	const citizen = await openDurableCitizen({ ...fresh, cwd: project("normal"), contact: roots("normal") });
	let failedCalls = 0;
	citizen.durable.onFailed(() => failedCalls++);
	await citizen.close();
	await new Promise((resolve) => setImmediate(resolve));
	report.normal = { failure: citizen.durable.view.current().failure ?? null, failedCalls, receiver: citizen.contact.receiver().reason };
}

// 4. A compaction whose summarization fails, kept on screen as the conversation keeps it. First the SDK's own
//    threshold compaction, which a long input past the blocking threshold makes the turn wait for: the turn ends
//    without asking the model. Then the operator's /compact, which also has its own notice.
{
	// Only the summarization request is refused.
	const answer = (text) => (transcript) =>
		String(transcript.messages?.[0]?.content ?? "").startsWith("You are a context summarization assistant")
			? fauxAssistantMessage("", { stopReason: "error", errorMessage: "S1B3-COMPACTION-REFUSED" })
			: fauxAssistantMessage(text);
	faux.setResponses([answer("HELLO-S1B3"), answer("unused"), answer("unused"), answer("unused")]);
	const citizen = await openDurableCitizen({ model: { provider: "faux", model: "small" }, cwd: project("compaction"), contact: roots("compaction") });
	const failure = () => (citizen.durable.view.current().conversation.docs["pi.live"] ?? {}).compactionFailure;
	const notices = () => citizen.durable.view.current().notices.map((n) => n.level + ": " + n.message);
	try {
		const { view, controller } = citizen.durable;
		await controller.submit("hi", "steer");
		await until("first answer", () => answered(view.current(), "HELLO-S1B3"));
		const calls = faux.state.callCount;
		await controller.submit("x".repeat(200000), "steer");
		await until("threshold compaction failure", () => idle(view.current()) && failure() !== undefined, 5000);
		const threshold = { failure: failure() ?? null, lines: lines(view.current()), notices: notices(), modelCalls: faux.state.callCount - calls };
		await controller.compact(undefined);
		await until("manual compaction failure", () => failure()?.reason === "manual", 5000);
		await until("manual compaction notice", () => view.current().notices.some((n) => n.message.startsWith("Compaction ")), 5000);
		report.compaction = { threshold, manual: { failure: failure() ?? null, lines: lines(view.current()) } };
	} finally {
		await citizen.close();
	}
}

// 5. --resume (#143 C): two sessions of one directory, then the list, the chosen one reopened as it was saved, and
//    a cancelled or refused choice that opens nothing. Only the choice (pick) and the TUI loop are seams; the list,
//    the chosen session's open and its record are the app's own.
{
	const cwd = project("resume");
	const contact = roots("resume");
	const lockfile = (await import("proper-lockfile")).default;
	const turnIn = async (text, answer) => {
		faux.setResponses([fauxAssistantMessage(answer)]);
		const citizen = await openDurableCitizen({ ...fresh, cwd, contact });
		try {
			await citizen.durable.controller.submit(text, "steer");
			await until("resume: " + text, () => answered(citizen.durable.view.current(), answer));
			return { id: citizen.durable.view.current().session.id, gardenId: citizen.attachment.gardenId };
		} finally {
			await citizen.close();
		}
	};
	const older = await turnIn("OLDER-MARK", "OLDER-ACK");
	const newer = await turnIn("NEWER-MARK", "NEWER-ACK");
	const sessionsRoot = path.join(process.env.PI_CODING_AGENT_DIR, "experimental", "durable-sessions");
	const root = fs.readdirSync(sessionsRoot).map((dir) => path.join(sessionsRoot, dir)).find((dir) => fs.existsSync(path.join(dir, older.id)));
	const state = () => ({
		sessions: fs.readdirSync(root).sort(),
		records: fs.readdirSync(contact.sessionsDir).filter((name) => name.endsWith(".meta.json")).length,
	});
	const seen = [];
	const fakeTui = async () => ({
		runDurableTui: async (source) => {
			const view = source.current();
			seen.push({
				id: view.session.id,
				labels: view.conversations.map((summary) => summary.label),
				users: view.conversation.entries.filter((entry) => entry.kind === "pi.user").map((entry) => textOf(entry.model?.[0])),
			});
		},
	});
	const reasonOf = async (run) => {
		try {
			await run();
			return "returned";
		} catch (error) {
			return error.reason ?? String(error);
		}
	};
	const resume = { older, newer };
	const here = process.cwd();
	process.chdir(cwd);
	try {
		resume.before = state();
		await main(["--resume"], {
			loadTui: fakeTui,
			contact,
			pick: async (title, items) => {
				resume.offered = { title, items };
				return older.id;
			},
		});
		resume.chosen = { seen: seen.splice(0), after: state() };
		resume.cancelled = {
			reason: await reasonOf(() => main(["--resume"], { loadTui: fakeTui, contact, pick: async () => undefined })),
			seen: seen.splice(0),
			after: state(),
		};
		const release = await lockfile.lock(path.join(root, older.id), { realpath: false });
		try {
			let marked;
			const reason = await reasonOf(() =>
				main(["--resume"], {
					loadTui: fakeTui,
					contact,
					pick: async (title, items) => {
						marked = items.find((item) => item.value === older.id)?.description;
						return older.id;
					},
				}),
			);
			resume.elsewhere = { reason, marked, seen: seen.splice(0) };
		} finally {
			await release();
		}
		resume.noTerminal = { reason: await reasonOf(() => main(["--resume"], { loadTui: fakeTui, contact })), seen: seen.splice(0) };
		resume.withContinue = await reasonOf(() => main(["--resume", "--continue"], { loadTui: fakeTui, contact }));
		resume.withModel = await reasonOf(() => main(["--resume", "--provider", "faux"], { loadTui: fakeTui, contact }));
		resume.after = state();
	} finally {
		process.chdir(here);
	}
	process.chdir(project("resume-empty"));
	try {
		resume.empty = await reasonOf(() => main(["--resume"], { loadTui: fakeTui, contact: roots("resume-empty"), pick: async () => older.id }));
	} finally {
		process.chdir(here);
	}
	// A session whose files cannot be read is an error, never an absent session. A link to itself fails stat with
	// ELOOP for any user, root included: once for a listed session's database, once for a session named to open.
	{
		const { createHash } = await import("node:crypto");
		const broken = project("resume-broken");
		const brokenRoot = path.join(sessionsRoot, createHash("sha256").update(fs.realpathSync(broken)).digest("hex").slice(0, 24));
		const listed = path.join(brokenRoot, "0000000000001-00000000-0000-0000-0000-000000000001");
		fs.mkdirSync(listed, { recursive: true });
		fs.symlinkSync("session.sqlite", path.join(listed, "session.sqlite"));
		const named = "0000000000002-00000000-0000-0000-0000-000000000002";
		fs.symlinkSync(named, path.join(brokenRoot, named));
		process.chdir(broken);
		try {
			resume.unreadable = {
				list: await reasonOf(() => main(["--resume"], { loadTui: fakeTui, contact: roots("resume-broken"), pick: async () => undefined })),
				// A citizen this probe does open is closed, so a defect that opens one still lets the oracle end.
				open: await reasonOf(async () => (await openDurableCitizen({ cwd: broken, contact: roots("resume-broken"), session: named })).close()),
				seen: seen.splice(0),
			};
		} finally {
			process.chdir(here);
		}
	}
	report.resume = resume;
}

console.log(JSON.stringify(report));
`;

interface ResumeState {
	sessions: string[];
	records: number;
}

interface ResumeSeen {
	id: string;
	labels: string[];
	users: string[];
}

interface AppReport {
	waits: Record<string, "met" | "timed out">;
	output?: { tool: string; text: string }[];
	fatal: {
		markerBefore: boolean;
		receiverBefore: string;
		failedCalls: number;
		lateFailedCalls: number;
		failure?: { error?: string } | null;
		holdAtFailure?: string;
		receiver?: { status: string; reason?: string; detail?: string };
		markerAfter?: boolean;
		lines?: string[];
		refusal?: { notices: string[]; modelCalls: number; holdAtRefusal: string };
		close: string;
	};
	early: {
		holdAtAttach?: string;
		receiver?: { status: string; reason?: string; detail?: string };
		receiverMarkerPath?: string | null;
		receiverMarkers?: string[];
		error?: string;
		close: string;
	};
	normal: { failure: unknown; failedCalls: number; receiver: string };
	compaction: {
		threshold: {
			failure: { reason: string; error: string } | null;
			lines: string[];
			notices: string[];
			modelCalls: number;
		};
		manual: { failure: { reason: string; error: string } | null; lines: string[] };
	};
	resume: {
		older: { id: string; gardenId: string };
		newer: { id: string; gardenId: string };
		before: ResumeState;
		offered?: { title: string; items: { value: string; label: string; description: string }[] };
		chosen: { seen: ResumeSeen[]; after: ResumeState };
		cancelled: { reason: string; seen: ResumeSeen[]; after: ResumeState };
		elsewhere: { reason: string; marked?: string; seen: ResumeSeen[] };
		noTerminal: { reason: string; seen: ResumeSeen[] };
		withContinue: string;
		withModel: string;
		after: ResumeState;
		empty: string;
		unreadable: { list: string; open: string; seen: ResumeSeen[] };
	};
}

describe("the carrier on the 1.2 SDK, driven through the real bootstrap (#141)", () => {
	let report: AppReport;

	beforeAll(() => {
		const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "pi-durable-app-"));
		try {
			const agent = path.join(sandbox, "home", ".pi", "agent");
			fs.mkdirSync(agent, { recursive: true });
			// No retry, so a refused summarization fails the compaction at once; a short kept window, so it is asked.
			fs.writeFileSync(
				path.join(agent, "settings.json"),
				`${JSON.stringify({ retry: { enabled: false }, compaction: { keepRecentTokens: 1 } })}\n`,
			);
			const run = spawnSync(
				process.execPath,
				["--import", path.join(DURABLE, "carrier-resolver.mjs"), "--input-type=module", "-e", APP_ORACLE],
				{
					cwd: ROOT,
					encoding: "utf8",
					timeout: 120_000,
					env: {
						PATH: process.env.PATH ?? "",
						HOME: path.join(sandbox, "home"),
						PI_CODING_AGENT_DIR: agent,
						PI_OFFLINE: "1",
						ORACLE_SANDBOX: sandbox,
					},
				},
			);
			expect(run.status, run.stderr).toBe(0);
			report = JSON.parse(run.stdout.trim().split("\n").at(-1) ?? "");
		} finally {
			fs.rmSync(sandbox, { recursive: true, force: true });
		}
	}, 150_000);

	it("[QK:PI-DURABLE-SUBAGENT-OUTPUT-MODEL-VISIBLE] a subagent's answer is what the parent model reads: the committed pi.tool-result carries the child's text", () => {
		expect(report.waits["output turn"]).toBe("met");
		expect(report.output?.find((result) => result.tool === "subagent")).toEqual({
			tool: "subagent",
			text: "CHILD-ANSWER-S1B3",
		});
	});

	it("an operator module's tool reaches the model through the bootstrap's --native-module ingress with its `output`", () => {
		expect(report.output?.find((result) => result.tool === "native_echo")).toEqual({
			tool: "native_echo",
			text: "NATIVE-OUTPUT-S1B3",
		});
	});

	it("[QK:PI-DURABLE-FATAL-SESSION-VIEW] a Session that fails and closes itself is a failure in the view at once, with the cause the Harness reported, while a tool ignoring its abort still holds the Session's close", () => {
		expect(report.fatal.failure).toEqual({ error: "S1B3-INJECTED-STORAGE-FAILURE" });
		expect(report.fatal.holdAtFailure).toBe("holding");
		expect(report.fatal.failedCalls).toBe(1);
		expect(report.fatal.lateFailedCalls).toBe(1);
		expect(report.fatal.close).toBe("ok");
	});

	it("[QK:PI-DURABLE-FATAL-SESSION-SHOWN] the TUI shows a failed session first, by its reported cause, above every notice", () => {
		expect(report.fatal.lines?.[0]).toBe(
			"error: Session failed: S1B3-INJECTED-STORAGE-FAILURE. It takes no more input, and a tool still running may take a while to stop. Close this session, then reopen it with --continue.",
		);
	});

	it("[QK:PI-DURABLE-FATAL-SUBMIT-REFUSED] input to a failed session is refused by name and asks the model nothing", () => {
		expect(report.fatal.refusal?.notices).toContain(
			"error: The session failed and takes no input. Close it, then reopen it with --continue.",
		);
		expect(report.fatal.refusal?.modelCalls).toBe(0);
		expect(report.fatal.refusal?.holdAtRefusal).toBe("holding");
	});

	it("[QK:PI-DURABLE-RECEIVER-RETIRE-ON-FATAL] the receiver retires as session-failed when the Session fails, its marker removed, before any doorbell and while the Session's close is still held — and when the Session failed before the contact attached, before attach returns, with no marker left", () => {
		expect(report.fatal.markerBefore).toBe(true);
		expect(report.fatal.receiverBefore).toBe("armed");
		expect(report.fatal.receiver).toMatchObject({ status: "retired", reason: "session-failed" });
		expect(report.fatal.markerAfter).toBe(false);
		expect(report.fatal.holdAtFailure).toBe("holding");
		expect(report.early).toMatchObject({
			holdAtAttach: "holding",
			receiver: { status: "retired", reason: "session-failed" },
			receiverMarkerPath: null,
			receiverMarkers: [],
			close: "ok",
		});
		expect(report.early.error).toBeUndefined();
	});

	it("[QK:PI-DURABLE-SELF-CLOSE-NOT-FAILURE] a session the host closes is no failure: nothing reports one and the receiver retires as closed", () => {
		expect(report.normal).toEqual({ failure: null, failedCalls: 0, receiver: "closed" });
	});

	it("[QK:PI-DURABLE-COMPACTION-FAILURE-SHOWN] a failed compaction stays on screen by reason and error, kept as the conversation keeps it: the SDK's own threshold compaction a turn waited for, and the manual one beside its own notice", () => {
		expect(report.waits["threshold compaction failure"]).toBe("met");
		expect(report.compaction.threshold.failure).toMatchObject({
			reason: "threshold",
			error: "Summarization failed: S1B3-COMPACTION-REFUSED",
		});
		expect(report.compaction.threshold.modelCalls).toBe(1);
		// The turn that waited reports its own missing answer; the compaction's failure is the conversation's to show.
		expect(report.compaction.threshold.notices).toEqual([
			'error: No answer: model_error "Compaction failed: Summarization failed: S1B3-COMPACTION-REFUSED"',
		]);
		expect(report.compaction.threshold.lines).toEqual([
			"error: Compaction failed (threshold): Summarization failed: S1B3-COMPACTION-REFUSED",
			'error: No answer: model_error "Compaction failed: Summarization failed: S1B3-COMPACTION-REFUSED"',
		]);
		expect(report.compaction.manual.failure).toMatchObject({
			reason: "manual",
			error: "Summarization failed: S1B3-COMPACTION-REFUSED",
		});
		// The conversation keeps one compaction failure, now the manual one; the notices keep the earlier turn's.
		expect(report.compaction.manual.lines).toEqual([
			"error: Compaction failed (manual): Summarization failed: S1B3-COMPACTION-REFUSED",
			'error: No answer: model_error "Compaction failed: Summarization failed: S1B3-COMPACTION-REFUSED"',
			"error: Compaction failed: Summarization failed: S1B3-COMPACTION-REFUSED",
		]);
	});

	it("--resume lists this directory's sessions most recently written first, by what their files and records already say", () => {
		const { older, newer, offered } = report.resume;
		expect(report.waits["resume: OLDER-MARK"]).toBe("met");
		expect(report.waits["resume: NEWER-MARK"]).toBe("met");
		expect(older.id < newer.id).toBe(true);
		expect(offered?.items.map((item) => item.value)).toEqual([newer.id, older.id]);
		for (const [item, session] of [
			[offered?.items[0], newer],
			[offered?.items[1], older],
		] as const) {
			expect(Object.keys(item ?? {}).sort()).toEqual(["description", "label", "value"]);
			expect(item?.label).toMatch(new RegExp(`^\\d{4}-\\d{2}-\\d{2} \\d{2}:\\d{2}  ${session.gardenId}$`));
			expect(item?.description).toMatch(new RegExp(`^last write \\d{4}-\\d{2}-\\d{2} \\d{2}:\\d{2} · ${session.id}$`));
		}
	});

	it("[QK:PI-DURABLE-RESUME-OPENS-CHOSEN] --resume reopens the chosen session as it was saved, under its own garden id: not the newest, not a new one", () => {
		const { older, before, chosen } = report.resume;
		expect(chosen.seen).toHaveLength(1);
		expect(chosen.seen[0]?.id).toBe(older.id);
		expect(chosen.seen[0]?.users).toEqual(["OLDER-MARK"]);
		expect(chosen.seen[0]?.labels[0]).toContain(older.gardenId);
		expect(chosen.after).toEqual(before);
	});

	it("[QK:PI-DURABLE-RESUME-CANCEL-OPENS-NOTHING] a cancelled --resume opens nothing: no session, no record, no lock, no fallback to another session", () => {
		const { before, cancelled } = report.resume;
		expect(cancelled.reason).toBe("returned");
		expect(cancelled.seen).toEqual([]);
		expect(cancelled.after).toEqual(before);
	});

	it("--resume refuses by name and opens nothing: a session open elsewhere, no terminal, no session, and --continue or a new session's argument beside it", () => {
		const { older, before, elsewhere, noTerminal } = report.resume;
		expect(elsewhere.reason).toBe("session-open-elsewhere");
		expect(elsewhere.marked).toBe(`last write ${elsewhere.marked?.slice(11, 27)} · ${older.id} · open elsewhere`);
		expect(elsewhere.seen).toEqual([]);
		expect(noTerminal).toEqual({ reason: "resume-needs-terminal", seen: [] });
		expect(report.resume.withContinue).toBe("resume-continue-exclusive");
		expect(report.resume.withModel).toBe("fresh-only-argument-with-resume");
		expect(report.resume.empty).toBe("resume-no-session");
		expect(report.resume.after).toEqual(before);
	});

	it("--resume reads a session it cannot stat as an error, not as an absent session or file", () => {
		const { unreadable } = report.resume;
		expect(unreadable.list).toContain("ELOOP");
		expect(unreadable.open).toContain("ELOOP");
		expect(unreadable.seen).toEqual([]);
	});
});

/**
 * #143 A, the stream transport on the wire: ONE child opens the real bootstrap (`openDurableCitizen`), whose carrier
 * runtime builds its Harness settings with the owned `createHarnessSettings`, against a 127.0.0.1 WebSocket server
 * standing in for the Codex Responses endpoint. The model is the operator's documented models.json route (a custom
 * provider on `openai-codex-responses`, an unsigned token carrying only an account id), so the request goes through
 * the native Harness and the published pi-ai provider unpatched. The server is the independent oracle: it records
 * every frame it receives — connection, `previous_response_id`, the raw `input` items — and answers each one normally,
 * so a run that never continues still completes. The same server shows when a summary is asked for relative to the
 * turn, which is how the reference app's compaction without background work is observed (#143 B). No vendor, no
 * credential, no host store; every wait is bounded and recorded, and a step that is never observed is a diagnostic
 * of its own, not a wire verdict.
 */
const WIRE_ORACLE = String.raw`
const fs = await import("node:fs");
const http = await import("node:http");
const path = await import("node:path");
const { WebSocketServer } = await import("ws");
const repo = "file://" + process.cwd() + "/";
const { openDurableCitizen } = await import(new URL("./pi/pi-durable/bootstrap.mjs", repo).href);
const { createHarnessSettings } = await import(new URL("./pi/pi-durable/carrier/harness-setup.js", repo).href);
const { PI_DURABLE_TOOL_SCHEMAS } = await import(new URL("./mcp/entwurf-bridge/dist/pi-extensions/meta-bridge-pi-durable.js", repo).href);
const dist = new URL(".", import.meta.resolve("@earendil-works/pi-coding-agent")).href;
const { SettingsManager } = await import(dist + "core/settings-manager.js");
const sandbox = process.env.ORACLE_SANDBOX;
const agentDir = process.env.PI_CODING_AGENT_DIR;
const NONCE = "WIRE-NOTE-NONCE-143";
const CALL_ID = "call_wire_read";
const MARKERS = ["READ-NOTE", "TURN-TWO", "AFTER-COMPACTION-ONE", "AFTER-COMPACTION-TWO", "CLOSE-AFTER", "AFTER-RECONNECT-ONE", "AFTER-RECONNECT-TWO", "BELOW-BLOCKING", "PAST-BLOCKING", "OVERFLOW-ONCE"];
const report = { waits: {}, forwarded: {}, frames: [], closes: [], unexpected: [], errors: [], policy: {}, nonce: NONCE, callId: CALL_ID };

// 1. What the owned settings hand the Harness: the operator's transport, read at every use.
{
	const transportOf = (settings) => createHarnessSettings(SettingsManager.inMemory(settings)).stream.transport;
	report.forwarded.unset = transportOf({});
	report.forwarded.websocket = transportOf({ transport: "websocket" });
	report.forwarded.sse = transportOf({ transport: "sse" });
	const manager = SettingsManager.inMemory({ transport: "websocket-cached" });
	const settings = createHarnessSettings(manager);
	const before = settings.stream.transport;
	manager.setTransport("websocket");
	report.forwarded.changed = [before, settings.stream.transport];
}
// ...and pi's own compaction settings, which carry no background policy (#146), also read at every use.
{
	const compactionOf = (settings) => createHarnessSettings(SettingsManager.inMemory(settings)).compaction;
	const manager = SettingsManager.inMemory({ compaction: { enabled: false } });
	const settings = createHarnessSettings(manager);
	const before = settings.compaction.enabled;
	manager.setCompactionEnabled(true);
	report.compactionSettings = {
		pi: SettingsManager.inMemory({}).getCompactionSettings(),
		unset: compactionOf({}),
		chosen: compactionOf({ compaction: { enabled: false, reserveTokens: 1234, keepRecentTokens: 567 } }),
		changed: [before, settings.compaction.enabled],
	};
}

// 2. The loopback Responses endpoint. Every answer is chosen from the frame alone, so a full and a delta request get
//    the same reply.
let phase = "startup";
let connections = 0;
let responses = 0;
const usage = { input_tokens: 10, output_tokens: 2, total_tokens: 12, input_tokens_details: { cached_tokens: 0 } };
const textOf = (item) => {
	if (item?.role !== "user") return "";
	return typeof item.content === "string" ? item.content : (item.content ?? []).map((part) => part.text ?? "").join("");
};
const send = (sock, event) => sock.send(JSON.stringify(event));
// The report keeps every frame's items, with long text cut to its head and length: the long inputs below would not
// fit the parent's output buffer whole, and every marker and nonce sits at the head.
const shorten = (value) =>
	typeof value === "string"
		? value.length > 2000 ? value.slice(0, 200) + "…[+" + (value.length - 200) + " chars]" : value
		: Array.isArray(value)
			? value.map(shorten)
			: value !== null && typeof value === "object"
				? Object.fromEntries(Object.entries(value).map(([key, item]) => [key, shorten(item)]))
				: value;
const answerText = (sock, text) => {
	const id = "resp_" + ++responses;
	const item = { type: "message", id: "msg_" + responses, role: "assistant", status: "completed", content: [{ type: "output_text", text, annotations: [] }] };
	send(sock, { type: "response.created", response: { id, status: "in_progress" } });
	send(sock, { type: "response.output_item.added", output_index: 0, item: { ...item, status: "in_progress", content: [] } });
	send(sock, { type: "response.output_text.delta", output_index: 0, content_index: 0, item_id: item.id, delta: text });
	send(sock, { type: "response.output_item.done", output_index: 0, item });
	send(sock, { type: "response.completed", response: { id, status: "completed", output: [item], usage } });
	return id;
};
const answerRead = (sock) => {
	const id = "resp_" + ++responses;
	const args = JSON.stringify({ path: "note.txt" });
	const item = { type: "function_call", id: "fc_" + responses, call_id: CALL_ID, name: "read", arguments: args, status: "completed" };
	send(sock, { type: "response.created", response: { id, status: "in_progress" } });
	send(sock, { type: "response.output_item.added", output_index: 0, item: { ...item, arguments: "", status: "in_progress" } });
	send(sock, { type: "response.function_call_arguments.delta", output_index: 0, item_id: item.id, delta: args });
	send(sock, { type: "response.function_call_arguments.done", output_index: 0, item_id: item.id, arguments: args });
	send(sock, { type: "response.output_item.done", output_index: 0, item });
	send(sock, { type: "response.completed", response: { id, status: "completed", output: [item], usage } });
	return id;
};
// A context overflow as the Responses API reports one, after the response started (so no transport fallback).
const refused = new Set();
// The background summary of the policy-below turn, held on the wire until the fixture releases it, so the turn's own
// answer can be observed while its summary is still unanswered.
let heldSummary;
const refuseOverflow = (sock) => {
	const id = "resp_" + ++responses;
	send(sock, { type: "response.created", response: { id, status: "in_progress" } });
	send(sock, { type: "response.failed", response: { id, status: "failed", error: { code: "context_length_exceeded", message: "Your input exceeds the context window of this model." } } });
	return id;
};
const server = http.createServer((req, res) => {
	report.unexpected.push(req.method + " " + req.url);
	res.writeHead(500, { "content-type": "application/json" });
	res.end(JSON.stringify({ error: { message: "wire oracle: only the WebSocket endpoint answers" } }));
});
const wss = new WebSocketServer({ server });
wss.on("connection", (sock) => {
	const conn = ++connections;
	sock.on("close", () => report.closes.push(conn));
	sock.on("message", (raw) => {
		try {
			const text = String(raw);
			const body = JSON.parse(text);
			const input = Array.isArray(body.input) ? body.input : [];
			const said = textOf(input.findLast((item) => item?.role === "user"));
			const marker = MARKERS.find((m) => said.includes(m));
			const frame = {
				phase,
				conn,
				bytes: Buffer.byteLength(text, "utf8"),
				type: body.type,
				prev: body.previous_response_id ?? null,
				summary: String(body.instructions ?? "").startsWith("You are a context summarization assistant"),
				input: shorten(input),
			};
			if (frame.summary && phase === "policy-below") {
				frame.held = true;
				heldSummary = () => {
					frame.response = answerText(sock, "WIRE-SUMMARY");
				};
			} else if (frame.summary) frame.response = answerText(sock, "WIRE-SUMMARY");
			else if (marker === "OVERFLOW-ONCE" && !refused.has(marker)) {
				refused.add(marker);
				frame.refused = true;
				frame.response = refuseOverflow(sock);
			} else if (input.at(-1)?.type === "function_call_output") frame.response = answerText(sock, "READ-DONE");
			else if (marker === "READ-NOTE") frame.response = answerRead(sock);
			else frame.response = answerText(sock, "ACK " + (marker ?? "UNKNOWN"));
			report.frames.push(frame);
			if (marker === "CLOSE-AFTER" && !frame.summary) sock.close(1000, "wire-oracle-close");
		} catch (error) {
			report.errors.push("server: " + String(error));
		}
	});
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const port = server.address().port;
const b64 = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
const token = b64({ alg: "none" }) + "." + b64({ "https://api.openai.com/auth": { chatgpt_account_id: "wire-oracle" } }) + ".unsigned";
fs.writeFileSync(
	path.join(agentDir, "models.json"),
	JSON.stringify({ providers: { "wire-codex": { baseUrl: "http://127.0.0.1:" + port, api: "openai-codex-responses", apiKey: token, models: [{ id: "wire", reasoning: false, contextWindow: 200000, maxTokens: 8192 }, { id: "small", reasoning: false, contextWindow: 60000, maxTokens: 8192 }] } } }) + "\n",
);

const roots = (name) => {
	const base = path.join(sandbox, "meta-" + name);
	const dirs = { sessionsDir: path.join(base, "sessions"), sendersDir: path.join(base, "senders"), mailboxDir: path.join(base, "mailbox"), receiversDir: path.join(base, "receivers") };
	for (const dir of Object.values(dirs)) fs.mkdirSync(dir, { recursive: true });
	return { ...dirs, env: {}, connect: async () => ({
		pid: 4343,
		listTools: async () => Object.entries(PI_DURABLE_TOOL_SCHEMAS).map(([name, inputSchema]) => ({ name, inputSchema })),
		callTool: async (name) => ({ text: name + " ok", isError: false }),
		close: async () => {},
	}) };
};
const project = (name, settings) => {
	const dir = path.join(sandbox, "project-" + name);
	fs.mkdirSync(dir, { recursive: true });
	fs.writeFileSync(path.join(dir, "note.txt"), NONCE + "\n");
	if (settings !== undefined) {
		fs.mkdirSync(path.join(dir, ".pi"), { recursive: true });
		fs.writeFileSync(path.join(dir, ".pi", "settings.json"), JSON.stringify(settings) + "\n");
	}
	return dir;
};
const until = async (what, predicate, ms = 15000) => {
	const end = Date.now() + ms;
	while (!predicate()) {
		if (Date.now() > end) {
			report.waits[what] = "timed out";
			return false;
		}
		await new Promise((resolve) => setTimeout(resolve, 10));
	}
	report.waits[what] = "met";
	return true;
};
const assistantText = (message) => (Array.isArray(message?.content) ? message.content.map((block) => block.text ?? "").join("") : message?.content);
const idle = (view) => (view.conversation.docs["pi.live"] ?? {}).run === undefined;
const answered = (view, text) => idle(view) && view.conversation.entries.some((entry) => entry.kind === "pi.assistant" && assistantText(entry.model?.[0]) === text);
const model = { provider: "wire-codex", model: "wire" };
const turn = async (citizen, what, text, expected) => {
	await citizen.durable.controller.submit(text, "steer");
	return until(what, () => answered(citizen.durable.view.current(), expected));
};

// 3. The default transport: a read round, a following turn, a placed compaction, a server-closed connection.
try {
	phase = "auto";
	const citizen = await openDurableCitizen({ model, cwd: project("auto"), contact: roots("auto") });
	try {
		const { view, controller } = citizen.durable;
		if (await turn(citizen, "auto: read round", "READ-NOTE: read note.txt", "READ-DONE")) {
			await turn(citizen, "auto: second turn", "TURN-TWO", "ACK TURN-TWO");
		}
		phase = "compaction";
		await controller.compact(undefined);
		const placed = await until("compaction placed", () => idle(view.current()) && view.current().conversation.entries.some((entry) => entry.kind === "pi.compaction"));
		report.compactionPlaced = placed;
		phase = "after-compaction";
		if (await turn(citizen, "after compaction: first turn", "AFTER-COMPACTION-ONE", "ACK AFTER-COMPACTION-ONE")) {
			await turn(citizen, "after compaction: second turn", "AFTER-COMPACTION-TWO", "ACK AFTER-COMPACTION-TWO");
		}
		phase = "close";
		if (await turn(citizen, "close: turn", "CLOSE-AFTER", "ACK CLOSE-AFTER")) {
			const closing = report.frames.findLast((frame) => frame.phase === "close" && !frame.summary)?.conn;
			await until("close: server observed the close", () => closing !== undefined && report.closes.includes(closing));
		}
		phase = "after-reconnect";
		if (await turn(citizen, "after reconnect: first turn", "AFTER-RECONNECT-ONE", "ACK AFTER-RECONNECT-ONE")) {
			await turn(citizen, "after reconnect: second turn", "AFTER-RECONNECT-TWO", "ACK AFTER-RECONNECT-TWO");
		}
	} finally {
		await citizen.close();
	}

	// 4. The control: the operator chose the plain WebSocket transport for this project.
	phase = "websocket";
	const control = await openDurableCitizen({ model, cwd: project("websocket", { transport: "websocket" }), contact: roots("websocket") });
	try {
		if (await turn(control, "websocket: read round", "READ-NOTE: read note.txt", "READ-DONE")) {
			await turn(control, "websocket: second turn", "TURN-TWO", "ACK TURN-TWO");
		}
	} finally {
		await control.close();
	}

	// 5. The SDK's own compaction policy (#146), on a 60000-token window with pi's default reserve (blocking above 43616
	//    tokens; the SDK's default background policy starts 32768 below that). The SDK estimates a context from the
	//    last answer's usage plus the text after it, so each input's length decides which threshold it crosses.
	const small = await openDurableCitizen({ model: { provider: "wire-codex", model: "small" }, cwd: project("policy"), contact: roots("policy") });
	try {
		const { view } = small.durable;
		const live = () => view.current().conversation.docs["pi.live"] ?? {};
		const summaries = () => report.frames.filter((frame) => frame.summary && frame.phase.startsWith("policy-")).length;
		const compactions = () => view.current().conversation.entries.filter((entry) => entry.kind === "pi.compaction").map((entry) => entry.data?.reason ?? null);
		// A finished turn first: the SDK compacts only when a prefix before the kept tail exists (selectCut), so without
		// one the next turn would ask for no summary whatever the background policy.
		phase = "policy-warmup";
		const warmed = await turn(small, "policy: warmup turn", "TURN-TWO", "ACK TURN-TWO");
		const kinds = view.current().conversation.entries.map((entry) => entry.kind);
		report.policy.seed = { users: kinds.filter((kind) => kind === "pi.user").length, assistants: kinds.filter((kind) => kind === "pi.assistant").length };
		phase = "policy-below";
		if (warmed && (await turn(small, "policy: past background, below blocking", "BELOW-BLOCKING " + "b".repeat(80000), "ACK BELOW-BLOCKING"))) {
			// The turn has answered. The SDK's background summary rides its own connection and can reach the wire after
			// that answer, so while such a compaction is running, wait for its request to be held (none runs when the
			// background policy is off, and then nothing is waited for).
			if ((live().compactions ?? []).some((status) => !status.blocking)) {
				await until("policy: background summary held", () => typeof heldSummary === "function");
			}
			// Observed after the turn's answer and before the held summary is answered.
			report.policy.answered = {
				held: typeof heldSummary === "function",
				running: (live().compactions ?? []).map((status) => ({ reason: status.reason, blocking: status.blocking })),
				compactions: compactions(),
			};
		}
		heldSummary?.();
		heldSummary = undefined;
		// Fixture settling only, before the next phase: let the SDK place the released summary.
		if (report.policy.answered?.held) {
			await until("policy: background placed", () => live().compactions === undefined && compactions().length > 0);
			report.policy.below = { summaries: summaries(), compactions: compactions(), running: live().compactions ?? null, failure: live().compactionFailure ?? null };
		}
		phase = "policy-blocking";
		if (await turn(small, "policy: past blocking", "PAST-BLOCKING " + "c".repeat(200000), "ACK PAST-BLOCKING")) {
			report.policy.blocking = { compactions: compactions() };
		}
		phase = "policy-overflow";
		if (await turn(small, "policy: refused overflow", "OVERFLOW-ONCE", "ACK OVERFLOW-ONCE")) {
			report.policy.overflow = { compactions: compactions() };
		}
	} finally {
		await small.close();
	}
} catch (error) {
	report.errors.push("child: " + String(error?.stack ?? error));
}
for (const sock of wss.clients) sock.terminate();
await new Promise((resolve) => wss.close(resolve));
await new Promise((resolve) => server.close(resolve));
console.log(JSON.stringify(report));
process.exit(0);
`;

interface WireFrame {
	phase: string;
	conn: number;
	bytes: number;
	type: string;
	prev: string | null;
	summary: boolean;
	refused?: boolean;
	held?: boolean;
	input: Record<string, unknown>[];
	response: string;
}

interface WireReport {
	waits: Record<string, "met" | "timed out">;
	forwarded: {
		unset?: string;
		websocket?: string;
		sse?: string;
		changed?: string[];
	};
	compactionSettings?: {
		pi: Record<string, unknown>;
		unset: Record<string, unknown>;
		chosen: Record<string, unknown>;
		changed: boolean[];
	};
	frames: WireFrame[];
	closes: number[];
	unexpected: string[];
	errors: string[];
	compactionPlaced?: boolean;
	policy: {
		seed?: { users: number; assistants: number };
		answered?: { held: boolean; running: { reason: string; blocking: boolean }[]; compactions: (string | null)[] };
		below?: { summaries: number; compactions: (string | null)[]; running: unknown; failure: unknown };
		blocking?: { compactions: (string | null)[] };
		overflow?: { compactions: (string | null)[] };
	};
	nonce: string;
	callId: string;
}

const userTextOf = (item: Record<string, unknown> | undefined): string => {
	if (item?.role !== "user") return "";
	const content = item.content;
	return typeof content === "string"
		? content
		: Array.isArray(content)
			? content.map((part: { text?: string }) => part.text ?? "").join("")
			: "";
};

describe("the stream transport on the wire, through the real bootstrap (#143)", () => {
	let run: { status: number | null; signal: string | null; stderr: string };
	let report: WireReport | undefined;
	const main = (phase: string): WireFrame[] => (report?.frames ?? []).filter((f) => f.phase === phase && !f.summary);

	beforeAll(() => {
		const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "pi-durable-wire-"));
		try {
			const home = path.join(sandbox, "home");
			const agent = path.join(home, ".pi", "agent");
			fs.mkdirSync(agent, { recursive: true });
			// No agent retry, so a broken request is not hidden by another; a short kept window, so /compact has a prefix to summarize.
			fs.writeFileSync(
				path.join(agent, "settings.json"),
				`${JSON.stringify({ retry: { enabled: false }, compaction: { keepRecentTokens: 1 } })}\n`,
			);
			const child = spawnSync(
				process.execPath,
				["--import", path.join(DURABLE, "carrier-resolver.mjs"), "--input-type=module", "-e", WIRE_ORACLE],
				{
					cwd: ROOT,
					encoding: "utf8",
					timeout: 120_000,
					env: {
						PATH: process.env.PATH ?? "",
						HOME: home,
						PI_CODING_AGENT_DIR: agent,
						XDG_CONFIG_HOME: path.join(home, ".config"),
						XDG_CACHE_HOME: path.join(home, ".cache"),
						XDG_DATA_HOME: path.join(home, ".local", "share"),
						XDG_STATE_HOME: path.join(home, ".local", "state"),
						PI_OFFLINE: "1",
						ORACLE_SANDBOX: sandbox,
					},
				},
			);
			run = { status: child.status, signal: child.signal, stderr: child.stderr };
			const last = child.stdout.trim().split("\n").at(-1) ?? "";
			report = last.startsWith("{") ? (JSON.parse(last) as WireReport) : undefined;
		} finally {
			fs.rmSync(sandbox, { recursive: true, force: true });
		}
	}, 150_000);

	it("the wire child runs to its end: every step observed, no stray HTTP request, no server or child error", () => {
		expect({ status: run.status, signal: run.signal }, run.stderr).toEqual({ status: 0, signal: null });
		expect(report, run.stderr).toBeDefined();
		expect(report?.errors).toEqual([]);
		expect(report?.unexpected).toEqual([]);
		expect(Object.entries(report?.waits ?? {}).filter(([, state]) => state !== "met")).toEqual([]);
	});

	it("[QK:PI-DURABLE-STREAM-TRANSPORT-FORWARDED] the owned Harness settings carry the operator's transport, not a fixed one, and read it again at every use", () => {
		expect(report?.forwarded).toEqual({
			unset: "auto",
			websocket: "websocket",
			sse: "sse",
			changed: ["websocket-cached", "websocket"],
		});
	});

	it("[QK:PI-DURABLE-STREAM-TRANSPORT-WIRE] on the default transport a tool round and the next turn continue the previous response with only their new input; the operator's plain WebSocket sends everything every time", () => {
		const [first, tool, next] = main("auto");
		expect(main("auto")).toHaveLength(3);
		expect(first?.prev).toBeNull();
		expect(userTextOf(first?.input.at(-1))).toContain("READ-NOTE");
		expect(tool?.prev).toBe(first?.response);
		expect(tool?.input).toHaveLength(1);
		expect(tool?.input[0]).toMatchObject({ type: "function_call_output", call_id: report?.callId });
		expect(JSON.stringify(tool?.input[0]?.output)).toContain(report?.nonce);
		expect(next?.prev).toBe(tool?.response);
		expect(next?.input).toHaveLength(1);
		expect(userTextOf(next?.input[0])).toContain("TURN-TWO");
		expect(new Set([first?.conn, tool?.conn, next?.conn]).size).toBe(1);

		const control = main("websocket");
		expect(control).toHaveLength(3);
		expect(control.map((f) => f.prev)).toEqual([null, null, null]);
		expect(control[1]?.input.some((item) => item.type === "function_call_output")).toBe(true);
		expect(control[1]?.input.length ?? 0).toBeGreaterThan(1);
		expect(userTextOf(control[2]?.input.at(-1))).toContain("TURN-TWO");
	});

	it("after a placed compaction the next request starts over in full and the one after continues it; the summary rides its own uncached connection", () => {
		const auto = main("auto");
		const continued = ["auto", "compaction", "after-compaction", "close", "after-reconnect"];
		const summaries = (report?.frames ?? []).filter((f) => f.summary && continued.includes(f.phase));
		const [full, delta] = main("after-compaction");
		expect(report?.compactionPlaced).toBe(true);
		expect(summaries).toHaveLength(1);
		expect(summaries[0]?.phase).toBe("compaction");
		expect(summaries[0]?.prev).toBeNull();
		expect(summaries[0]?.conn).not.toBe(auto.at(-1)?.conn);
		expect(full?.conn).toBe(auto.at(-1)?.conn);
		expect(full?.prev).toBeNull();
		expect(full?.input.some((item) => userTextOf(item).includes("WIRE-SUMMARY"))).toBe(true);
		expect(delta?.prev).toBe(full?.response);
		expect(delta?.input).toHaveLength(1);
		expect(userTextOf(delta?.input[0])).toContain("AFTER-COMPACTION-TWO");
	});

	it("after the server closes the connection the next request starts over in full on a new one and the one after continues it", () => {
		const [closing] = main("close");
		const [full, delta] = main("after-reconnect");
		expect(main("close")).toHaveLength(1);
		expect(report?.closes).toContain(closing?.conn);
		expect(full?.conn).not.toBe(closing?.conn);
		expect(full?.prev).toBeNull();
		expect(delta?.conn).toBe(full?.conn);
		expect(delta?.prev).toBe(full?.response);
		expect(delta?.input).toHaveLength(1);
		expect(userTextOf(delta?.input[0])).toContain("AFTER-RECONNECT-TWO");
	});

	it("the owned Harness compaction settings are pi's own, with no background policy of the app's, read again at every use", () => {
		const compaction = report?.compactionSettings;
		expect(compaction?.unset).toEqual(compaction?.pi);
		expect(compaction?.chosen).toEqual({ enabled: false, reserveTokens: 1234, keepRecentTokens: 567 });
		expect(compaction?.unset).not.toHaveProperty("backgroundTokens");
		expect(compaction?.changed).toEqual([false, true]);
	});

	it("[QK:PI-DURABLE-COMPACTION-SDK-BACKGROUND] past the SDK's background threshold the turn answers while its summary is still unanswered beside it; past the blocking threshold it waits for the summary and then asks with it", () => {
		// The turn below has a finished turn before it, so a summary has something to summarize.
		expect(report?.policy.seed).toEqual({ users: 1, assistants: 1 });
		expect((report?.frames ?? []).filter((f) => f.phase === "policy-warmup").map((f) => f.summary)).toEqual([false]);
		// Below blocking: one summary request and one turn request. The summary is held on the wire, and the turn has
		// answered with the background compaction still running and nothing placed: the turn did not wait for it.
		const below = (report?.frames ?? []).filter((f) => f.phase === "policy-below");
		expect(below.filter((f) => f.summary).map((f) => f.held)).toEqual([true]);
		const asked = below.filter((f) => !f.summary);
		expect(asked).toHaveLength(1);
		expect(asked[0]?.input.some((item) => userTextOf(item).includes("WIRE-SUMMARY"))).toBe(false);
		expect(userTextOf(asked[0]?.input.at(-1))).toContain("BELOW-BLOCKING");
		expect(report?.policy.answered).toEqual({
			held: true,
			running: [{ reason: "threshold", blocking: false }],
			compactions: [],
		});
		// Released, the SDK places that summary.
		expect(report?.policy.below).toEqual({ summaries: 1, compactions: ["threshold"], running: null, failure: null });
		const blocking = (report?.frames ?? []).filter((f) => f.phase === "policy-blocking");
		expect(blocking.map((f) => f.summary)).toEqual([true, false]);
		expect(blocking[1]?.input.some((item) => userTextOf(item).includes("WIRE-SUMMARY"))).toBe(true);
		expect(userTextOf(blocking[1]?.input.at(-1))).toContain("PAST-BLOCKING");
		expect(report?.policy.blocking?.compactions).toEqual(["threshold"]);
	});

	it("a refused context overflow is compacted by the SDK and the turn is asked again with the summary", () => {
		const overflow = (report?.frames ?? []).filter((f) => f.phase === "policy-overflow");
		expect(overflow.map((f) => (f.summary ? "summary" : f.refused ? "refused" : "asked"))).toEqual([
			"refused",
			"summary",
			"asked",
		]);
		expect(overflow[2]?.input.some((item) => userTextOf(item).includes("WIRE-SUMMARY"))).toBe(true);
		// The view starts at the latest summary, so the placed overflow compaction is the one it shows.
		expect(report?.policy.overflow?.compactions).toEqual(["overflow"]);
	});
});

/**
 * The skills the owned prompt lists, as pi resolves the `skills` setting: each scope's relative entries against its
 * own directory, the project's against the session directory's `.pi`, the global ones against the agent directory.
 * ONE child loads the committed carrier's prompt through its resolver and renders its `skills` section for a request
 * offering `read`, with a sandboxed HOME, XDG roots and agent directory and no model, Harness or network. The oracle is
 * the fixture layout: a decoy where a relative entry read against the conversation's directory would land.
 */
const SKILLS_ORACLE = String.raw`
const repo = "file://" + process.cwd() + "/";
const { createPiPrompt } = await import(new URL("./pi/pi-durable/carrier/prompt.js", repo).href);
const dist = new URL(".", import.meta.resolve("@earendil-works/pi-coding-agent")).href;
const { SettingsManager } = await import(dist + "core/settings-manager.js");
const cwd = process.env.SKILLS_PROJECT;
const extension = createPiPrompt(SettingsManager.create(cwd, process.env.PI_CODING_AGENT_DIR), cwd);
const skills = extension.sections.find((entry) => entry.key === "skills");
const text = skills.render({ agent: { tools: [{ name: "read" }], cwd }, env: undefined }) ?? "";
const listed = [...text.matchAll(/<name>([^<]*)<\/name>\s*<description>([^<]*)<\/description>/g)];
console.log(JSON.stringify({ skills: Object.fromEntries(listed.map((match) => [match[1], match[2]])) }));
`;

describe("the owned prompt's skills, read as pi reads the skills setting", () => {
	let report: { skills: Record<string, string> } | undefined;
	let run: { status: number | null; stderr: string };

	beforeAll(() => {
		const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "pi-durable-skills-"));
		try {
			const home = path.join(sandbox, "home");
			const agent = path.join(home, ".pi", "agent");
			const project = path.join(sandbox, "work", "project");
			const skill = (dir: string, name: string, description = `${name} fixture`): void => {
				fs.mkdirSync(path.join(dir, name), { recursive: true });
				fs.writeFileSync(
					path.join(dir, name, "SKILL.md"),
					`---\nname: ${name}\ndescription: ${description}\n---\n\n${name}\n`,
				);
			};
			// The project's entry is read against <project>/.pi; against the project directory it would be the decoy.
			skill(path.join(project, ".claude", "skills"), "project-skill");
			skill(path.join(sandbox, "work", ".claude", "skills"), "wrong-base-decoy");
			// The global entry is read against the agent directory; against the project directory it names nothing.
			skill(path.join(agent, "extra-skills"), "global-skill");
			skill(path.join(sandbox, "absolute-skills"), "absolute-skill");
			// One name in both scopes: the project's is listed, as pi resolves the project scope first.
			skill(path.join(project, ".claude", "skills"), "same-name-skill", "the project copy");
			skill(path.join(agent, "extra-skills"), "same-name-skill", "the global copy");
			fs.mkdirSync(path.join(project, ".pi"), { recursive: true });
			fs.writeFileSync(
				path.join(project, ".pi", "settings.json"),
				`${JSON.stringify({ skills: ["../.claude/skills", path.join(sandbox, "absolute-skills")] })}\n`,
			);
			fs.writeFileSync(path.join(agent, "settings.json"), `${JSON.stringify({ skills: ["extra-skills"] })}\n`);
			const child = spawnSync(
				process.execPath,
				["--import", path.join(DURABLE, "carrier-resolver.mjs"), "--input-type=module", "-e", SKILLS_ORACLE],
				{
					cwd: ROOT,
					encoding: "utf8",
					timeout: 60_000,
					env: {
						PATH: process.env.PATH ?? "",
						HOME: home,
						PI_CODING_AGENT_DIR: agent,
						XDG_CONFIG_HOME: path.join(home, ".config"),
						XDG_CACHE_HOME: path.join(home, ".cache"),
						XDG_DATA_HOME: path.join(home, ".local", "share"),
						XDG_STATE_HOME: path.join(home, ".local", "state"),
						PI_OFFLINE: "1",
						SKILLS_PROJECT: project,
					},
				},
			);
			run = { status: child.status, stderr: child.stderr };
			const last = child.stdout.trim().split("\n").at(-1) ?? "";
			report = last.startsWith("{") ? (JSON.parse(last) as { skills: Record<string, string> }) : undefined;
		} finally {
			fs.rmSync(sandbox, { recursive: true, force: true });
		}
	}, 90_000);

	it("[QK:PI-DURABLE-PROMPT-SKILL-SCOPE-BASE] a relative project entry is read against the project's .pi and a relative global one against the agent directory; both scopes are listed, the project's first, an absolute entry as before, and nothing from where the entry would land read against the conversation's directory", () => {
		expect(run.status, run.stderr).toBe(0);
		expect(report?.skills).toEqual({
			"absolute-skill": "absolute-skill fixture",
			"global-skill": "global-skill fixture",
			"project-skill": "project-skill fixture",
			"same-name-skill": "the project copy",
		});
	});
});
