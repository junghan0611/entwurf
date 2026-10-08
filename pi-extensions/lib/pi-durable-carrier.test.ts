/**
 * pi-durable carrier (#130) — the relocation grammar the maintainer emitter applies and the resolver
 * accepts (pi/pi-durable/carrier-relocation.mjs), the committed carrier against its pin, the emitter's
 * patch-section contract, and the carrier's task footer (#134).
 *
 * No install and no upstream source. The footer is observed in ONE child that loads the committed
 * carrier through its own resolver, with a sandboxed HOME and agent directory and no model: the real
 * carrier runtime opened and closed — once fresh, once continued after one native background task was
 * committed into its session through the SDK's public `Conversation.commit` — and the carrier TUI's
 * badge and layout drawn by the published renderer on a fake terminal. Its independent oracle for the zero-task screen is the pinned upstream
 * layout (tui.ts at the pinned commit), rebuilt here. The installed-consumer load and the physical SDK
 * edges are a package proof (check-pack-install); a real terminal is the visible TTY observation.
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
import { patchSections, readSourceObject } from "../../scripts/emit-pi-durable-carrier.ts";

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

describe("the maintainer emitter's patch sections (#134)", () => {
	const section = (file: string, base = "1111111", result = "2222222") =>
		[
			`diff --git a/${file} b/${file}`,
			`index ${base}..${result} 100644`,
			`--- a/${file}`,
			`+++ b/${file}`,
			"@@ -1 +1 @@",
			"-a",
			"+b",
			"",
		].join("\n");
	const reasonOf = (fn: () => unknown): string | undefined => {
		try {
			fn();
		} catch (error) {
			return (error as Error).message.split(":")[0];
		}
		return undefined;
	};

	it("[QK:PI-DURABLE-CARRIER-PATCH-SECTIONS] the one patch holds exactly one section per file the pin declares patched, and no other", () => {
		const pin = JSON.parse(fs.readFileSync(PIN, "utf8"));
		const patched = pin.carrier.files
			.filter((f: { patched: boolean }) => f.patched)
			.map((f: { source: string }) => f.source);
		const committed = fs.readFileSync(path.join(DURABLE, "overlay", pin.patches[0]), "utf8");
		const sections = patchSections(committed, patched);
		expect([...sections.keys()].sort()).toEqual([...patched].sort());
		for (const declared of pin.carrier.files.filter((f: { patched: boolean }) => f.patched)) {
			expect(declared.blob.startsWith(sections.get(declared.source)?.base ?? "-"), declared.name).toBe(true);
		}
		const two = section("x/a.ts") + section("x/b.ts", "3333333", "4444444");
		expect(patchSections(two, ["x/a.ts", "x/b.ts"]).get("x/b.ts")?.base).toBe("3333333");
		for (const [text, files] of [
			[two, ["x/a.ts"]], // a section for a file the pin does not declare patched
			[section("x/a.ts"), ["x/a.ts", "x/b.ts"]], // a declared file without its section
			[section("x/a.ts") + section("x/a.ts"), ["x/a.ts"]], // one file in two sections
			[`junk\n${section("x/a.ts")}`, ["x/a.ts"]], // bytes before the first section
		] as const) {
			expect(reasonOf(() => patchSections(text, files))).toBe("carrier-patch-shape");
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
