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
	it("[QK:PI-DURABLE-SOURCE-NOT-SHIPPED] npm's own file list for this package ships the emitted carrier and its LICENSE, never the owned source, its fence or the retired patch", () => {
		// npm's packlist with no lifecycle script (no prepack, so no pnpm, no install, no build) and a
		// sandboxed HOME, cache and userconfig: it reads package.json `files` and the tree, and writes
		// nothing here. check-pack keeps the same tripwire on the floor over the prepacked tarball.
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
			const files = packed[0].files.map((f) => f.path);
			const pin = readPin();
			for (const name of [...pin.carrier.files.map((f) => f.name), "LICENSE"]) {
				expect(files, name).toContain(`pi/pi-durable/carrier/${name}`);
			}
			expect(files).toContain("pi/pi-durable/overlay/upstream-pin.json");
			const source = /^pi\/pi-durable\/(src\/|tsconfig\.json$|overlay\/runtime-contacts\.patch$)/;
			expect(files.filter((f) => source.test(f))).toEqual([]);
		} finally {
			fs.rmSync(sandbox, { recursive: true, force: true });
		}
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
const { TaskBadge, durableLayout } = await import(carrier + "tui.js");
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
};
const badge = {};
for (const [name, value] of Object.entries(cases)) {
	const b = new TaskBadge();
	b.set(value);
	badge[name] = { count: b.count, widths: Object.fromEntries([1, 2, 3, 4, 6, 10, 12, 80].map((w) => [w, b.render(w).map(strip)])) };
}

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
console.log(JSON.stringify({ runtime, badge, cells, transitions, resize }));
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
	cells: { count: number; rows: number; cols: number; marked: boolean; upstream: boolean }[];
	transitions: { rows: number; cols: number; count: number; marked: boolean; upstream: boolean }[];
	resize: { rows: number; cols: number; marked: boolean }[];
}

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

// "small" has a window a long input crosses the SDK's background compaction threshold on (its default policy).
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
//    background compaction, started by a long input past its threshold while the turn goes on: nothing but the
//    conversation records that failure. Then the operator's /compact, which also has its own notice.
{
	// Only the summarization request is refused, whichever order the SDK sends the two in.
	const answer = (text) => (transcript) =>
		String(transcript.messages?.[0]?.content ?? "").startsWith("You are a context summarization assistant")
			? fauxAssistantMessage("", { stopReason: "error", errorMessage: "S1B3-COMPACTION-REFUSED" })
			: fauxAssistantMessage(text);
	// Slots 2 and 3 are the long turn and its background summarization, in either order: both answer the same text.
	faux.setResponses([answer("HELLO-S1B3"), answer("AFTER-LONG-S1B3"), answer("AFTER-LONG-S1B3"), answer("unused")]);
	const citizen = await openDurableCitizen({ model: { provider: "faux", model: "small" }, cwd: project("compaction"), contact: roots("compaction") });
	const failure = () => (citizen.durable.view.current().conversation.docs["pi.live"] ?? {}).compactionFailure;
	const notices = () => citizen.durable.view.current().notices.map((n) => n.level + ": " + n.message);
	try {
		const { view, controller } = citizen.durable;
		await controller.submit("hi", "steer");
		await until("first answer", () => answered(view.current(), "HELLO-S1B3"));
		await controller.submit("x".repeat(60000), "steer");
		await until("long answer", () => answered(view.current(), "AFTER-LONG-S1B3"));
		await until("background compaction failure", () => failure() !== undefined, 5000);
		const background = { failure: failure() ?? null, lines: lines(view.current()), notices: notices() };
		await controller.compact(undefined);
		await until("manual compaction failure", () => failure()?.reason === "manual", 5000);
		await until("manual compaction notice", () => view.current().notices.some((n) => n.message.startsWith("Compaction ")), 5000);
		report.compaction = { background, manual: { failure: failure() ?? null, lines: lines(view.current()) } };
	} finally {
		await citizen.close();
	}
}

console.log(JSON.stringify(report));
`;

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
		background: { failure: { reason: string; error: string } | null; lines: string[]; notices: string[] };
		manual: { failure: { reason: string; error: string } | null; lines: string[] };
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

	it("[QK:PI-DURABLE-COMPACTION-FAILURE-SHOWN] a failed compaction stays on screen by reason and error, kept as the conversation keeps it: the SDK's own background compaction, which nothing else reports, and the manual one beside its own notice", () => {
		expect(report.waits["long answer"]).toBe("met");
		expect(report.compaction.background.failure).toMatchObject({
			reason: "threshold",
			error: "Summarization failed: S1B3-COMPACTION-REFUSED",
		});
		expect(report.compaction.background.notices).toEqual([]);
		expect(report.compaction.background.lines).toEqual([
			"error: Compaction failed (threshold): Summarization failed: S1B3-COMPACTION-REFUSED",
		]);
		expect(report.compaction.manual.failure).toMatchObject({
			reason: "manual",
			error: "Summarization failed: S1B3-COMPACTION-REFUSED",
		});
		expect(report.compaction.manual.lines).toEqual([
			"error: Compaction failed (manual): Summarization failed: S1B3-COMPACTION-REFUSED",
			"error: Compaction failed: Summarization failed: S1B3-COMPACTION-REFUSED",
		]);
	});
});
