#!/usr/bin/env node
/**
 * Generator of the SDK 1.3 SQLite goldens that `pi-durable-storage-migration.test.ts` migrates (#148 S1b).
 *
 * The CI test never installs or imports SDK 1.3: it restores these logical dumps into a fresh database and
 * opens it with the root SDK 1.4 only. This file is how the dumps were made, so they can be made again.
 *
 *   node generate.mjs --sdk13-root <abs dir of an installed @earendil-works/pi-durable 1.3.0 package> \
 *     --out <abs empty dir outside this repository>
 *
 * Writes `<out>/public/` (the two dumps and golden.manifest.json — copy those into this directory) and
 * `<out>/receipt.json` (realpaths, pids, start keys, file hashes: private, never committed).
 *
 * The parent imports no SDK. Each scenario runs in its own child process that imports only the 1.3
 * package named by --sdk13-root and the 1.3 chord/pi-ai beside it, through their published exports, so
 * no Node graph ever holds two SDK versions. No model, no network, no operator path: the child's HOME is
 * inside <out> and its cwd is /.
 *
 * Scenarios (public SDK 1.3 API only; no row is written by hand):
 *   close — a parent task waits on a leaf that is running when the Harness closes normally.
 *   kill  — the same tree, then the child process is SIGKILLed once while the leaf runs.
 * Both also hold one pending task whose kind no extension installs.
 *
 * After the writer is gone, the database file set is copied untouched to <out>/pristine/<scenario>/ (never
 * opened again), copied a second time to <out>/derived/<scenario>/, and only that derived copy is opened to
 * dump. A dump is the logical, recovered state; it is not the raw WAL nor a proof of crash recovery itself.
 */
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath, pathToFileURL } from "node:url";

const SDK_VERSION = "1.3.0";
const SCENARIOS = ["close", "kill"];
const STEP_MS = 15_000;
const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "../../../..");

const die = (message) => {
	process.stderr.write(`[pi-durable-sdk13-golden] ${message}\n`);
	process.exit(1);
};
const sha256 = (data) => createHash("sha256").update(data).digest("hex");

function args(argv) {
	const out = {};
	for (let i = 0; i < argv.length; i += 2) {
		const key = argv[i];
		const value = argv[i + 1];
		if (!key?.startsWith("--") || value === undefined) die(`bad argument list: ${argv.join(" ")}`);
		out[key.slice(2)] = value;
	}
	return out;
}

/** The published `import` target of `name`'s `subpath`, from the copy beside the 1.3 package. */
function exportOf(sdkRoot, name, subpath) {
	const dir = name === "pi-durable" ? sdkRoot : path.join(path.dirname(sdkRoot), name);
	const pkg = JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8"));
	if (pkg.name !== `@earendil-works/${name}` || pkg.version !== SDK_VERSION) {
		die(`${dir} is ${pkg.name}@${pkg.version}, not @earendil-works/${name}@${SDK_VERSION}`);
	}
	const target = pkg.exports?.[subpath]?.import;
	if (typeof target !== "string") die(`${pkg.name} exports no import target for ${subpath}`);
	return { file: fs.realpathSync(path.join(dir, target)), dir: fs.realpathSync(dir), version: pkg.version };
}

function sdkSet(sdkRoot) {
	return {
		durable: exportOf(sdkRoot, "pi-durable", "."),
		sqlite: exportOf(sdkRoot, "pi-durable", "./storage/sqlite/node"),
		context: exportOf(sdkRoot, "chord", "./context"),
		models: exportOf(sdkRoot, "pi-ai", "./models"),
	};
}

/** sha256 over every dist file of the package (sorted relative path + bytes); a content digest without paths. */
function distDigest(dir) {
	const files = [];
	const walk = (rel) => {
		for (const entry of fs.readdirSync(path.join(dir, rel), { withFileTypes: true })) {
			const next = path.join(rel, entry.name);
			if (entry.isDirectory()) walk(next);
			else if (entry.isFile()) files.push(next);
		}
	};
	walk("dist");
	files.sort();
	const hash = createHash("sha256");
	for (const file of files)
		hash
			.update(`${file}\0`)
			.update(fs.readFileSync(path.join(dir, file)))
			.update("\0");
	return { files: files.length, sha256: hash.digest("hex") };
}

// ---------------------------------------------------------------- child: one SDK 1.3 writer
async function seed(options) {
	const set = sdkSet(options["sdk13-root"]);
	const durable = await import(pathToFileURL(set.durable.file).href);
	const { openNodeSqliteStorage } = await import(pathToFileURL(set.sqlite.file).href);
	const { BACKGROUND_CONTEXT } = await import(pathToFileURL(set.context.file).href);
	const { createModels } = await import(pathToFileURL(set.models.file).href);
	const { createRegistry, defineExtension, defineTask, Harness } = durable;
	const context = BACKGROUND_CONTEXT;
	const emit = (event) => process.stdout.write(`${JSON.stringify(event)}\n`);
	const aborted = (runtime) =>
		runtime.commit(() => ({ status: "terminal", outcome: { status: "aborted", reason: "fixture" } }), context);

	let ready;
	const leafRunning = new Promise((resolve) => {
		ready = resolve;
	});
	const Leaf = defineTask({
		name: "fixture.leaf",
		version: 1,
		initial: () => ({ phase: "hold" }),
		phases: {
			// Holds its invocation until the runtime signal aborts it: the abort-aware public API.
			hold: async (_task, runtime) => {
				ready();
				await new Promise((_resolve, reject) => {
					if (runtime.signal.aborted) reject(runtime.signal.reason);
					runtime.signal.addEventListener("abort", () => reject(runtime.signal.reason), { once: true });
				});
			},
		},
		abort: async (_task, runtime) => aborted(runtime),
	});
	const Parent = defineTask({
		name: "fixture.parent",
		version: 1,
		initial: () => ({ phase: "spawn" }),
		phases: {
			spawn: async (task, runtime) => {
				await runtime.commit(async (tx) => {
					const child = await tx.createTask(Leaf, {}, { ownership: { kind: "task", taskId: task.id } });
					return { status: "waiting", checkpoint: { phase: "joined", child }, on: [child], policy: "allSettled" };
				}, context);
			},
			joined: async (_task, runtime) => {
				await runtime.commit(() => ({ status: "terminal", outcome: { status: "completed", result: null } }), context);
			},
		},
		abort: async (_task, runtime) => aborted(runtime),
	});
	// Never installed, so it stays pending: a row of a kind this process cannot run.
	const Unregistered = defineTask({
		name: "fixture.unregistered",
		version: 1,
		initial: () => ({ phase: "never" }),
		phases: { never: async () => {} },
		abort: async (_task, runtime) => aborted(runtime),
	});

	const registry = createRegistry();
	registry.install(defineExtension({ name: "fixture", tasks: [Parent, Leaf] }));
	let clock = 1_790_000_000_000;
	const reports = [];
	const harness = await Harness.open(
		await openNodeSqliteStorage(options.db),
		{ models: createModels(), registry, now: () => clock++, onReport: (error) => reports.push(String(error)) },
		context,
	);
	const root = await harness.root(context);
	await root.commit(async (tx) => {
		await tx.createTask(Parent, {}, { ownership: { kind: "conversation" } });
		await tx.createTask(Unregistered, {}, { ownership: { kind: "conversation" } });
	}, context);
	harness.resume();
	await Promise.race([
		leafRunning,
		new Promise((_resolve, reject) => setTimeout(() => reject(new Error("leaf never ran")), STEP_MS)),
	]);
	emit({ event: "leaf-running", pid: process.pid, versions: { durable: set.durable.version } });
	if (options.scenario === "kill") {
		setInterval(() => {}, 60_000); // held until the parent kills this process
		return;
	}
	const closed = await Promise.race([
		harness.close(context).then(() => "closed"),
		new Promise((resolve) => setTimeout(() => resolve("close-hang"), STEP_MS)),
	]);
	if (closed !== "closed") {
		emit({ event: "close-hang" });
		process.exit(3);
	}
	emit({ event: "closed", reports });
	process.exit(0);
}

// ---------------------------------------------------------------- parent: orchestrate, copy, dump
function startKey(pid) {
	const stat = fs.readFileSync(`/proc/${pid}/stat`, "utf8");
	return stat.slice(stat.lastIndexOf(")") + 2).split(" ")[19];
}

function runScenario(options, scenario, dir) {
	const home = path.join(options.out, "home");
	fs.mkdirSync(home, { recursive: true });
	fs.mkdirSync(dir, { recursive: true });
	const db = path.join(dir, "session.sqlite");
	const child = spawn(
		process.execPath,
		[
			fileURLToPath(import.meta.url),
			"--role",
			"seed",
			"--scenario",
			scenario,
			"--sdk13-root",
			options["sdk13-root"],
			"--db",
			db,
		],
		{ cwd: "/", env: { PATH: process.env.PATH ?? "", HOME: home, TMPDIR: home }, stdio: ["ignore", "pipe", "pipe"] },
	);
	const events = [];
	let stderr = "";
	let buffer = "";
	const receipt = { scenario, pid: child.pid, startKey: startKey(child.pid), events };
	return new Promise((resolve, reject) => {
		const timer = setTimeout(() => {
			child.kill("SIGKILL");
			reject(new Error(`${scenario}: no result within ${STEP_MS * 3} ms; stderr: ${stderr}`));
		}, STEP_MS * 3);
		child.stderr.on("data", (data) => {
			stderr += data;
		});
		child.stdout.on("data", (data) => {
			buffer += data;
			let newline = buffer.indexOf("\n");
			while (newline >= 0) {
				const event = JSON.parse(buffer.slice(0, newline));
				buffer = buffer.slice(newline + 1);
				events.push(event);
				if (scenario === "kill" && event.event === "leaf-running") {
					// The one test-owned target: this spawn handle's pid, with its start key unchanged.
					if (event.pid !== child.pid || startKey(child.pid) !== receipt.startKey) {
						child.kill("SIGKILL");
						reject(new Error("kill target does not match the spawned writer"));
						return;
					}
					receipt.killedAt = new Date().toISOString();
					child.kill("SIGKILL");
				}
				newline = buffer.indexOf("\n");
			}
		});
		child.on("exit", (code, signal) => {
			clearTimeout(timer);
			receipt.exit = { code, signal };
			receipt.stderr = stderr;
			receipt.writerGone = !fs.existsSync(`/proc/${child.pid}`) || startKey(child.pid) !== receipt.startKey;
			const expected = scenario === "kill" ? signal === "SIGKILL" : code === 0;
			if (!expected || !receipt.writerGone)
				reject(new Error(`${scenario}: writer ended ${JSON.stringify(receipt.exit)}; stderr: ${stderr}`));
			else resolve({ receipt, db });
		});
	});
}

function copySet(fromDir, toDir) {
	fs.mkdirSync(toDir, { recursive: true });
	const files = {};
	for (const name of fs.readdirSync(fromDir).sort()) {
		const bytes = fs.readFileSync(path.join(fromDir, name));
		fs.writeFileSync(path.join(toDir, name), bytes, { flag: "wx", mode: 0o400 });
		files[name] = { bytes: bytes.length, sha256: sha256(bytes) };
	}
	return files;
}

function literal(value) {
	if (value === null) return "NULL";
	if (typeof value === "bigint") return value.toString();
	// Integers arrive as bigint (setReadBigInts); a number is a REAL, and v1 declares no REAL column.
	if (typeof value === "number") throw new Error(`unsupported REAL value ${value}: the v1 schema has no REAL column`);
	if (typeof value === "string") return `'${value.replaceAll("'", "''")}'`;
	if (value instanceof Uint8Array) return `X'${Buffer.from(value).toString("hex")}'`;
	throw new Error(`unsupported SQLite value ${typeof value}`);
}

/** Logical dump: tables, then rows in rowid order, then indexes, each from sqlite_schema as stored. */
function dump(dbPath, scenario) {
	const db = new DatabaseSync(dbPath, { readOnly: true });
	try {
		const schema = db
			.prepare(
				"SELECT type, name, sql FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%' AND sql IS NOT NULL ORDER BY rowid",
			)
			.all();
		const lines = [
			`-- @earendil-works/pi-durable ${SDK_VERSION} SQLite storage, logical dump, scenario ${scenario}.`,
			"-- Generated by generate.mjs; provenance and hashes live in golden.manifest.json.",
			"BEGIN;",
		];
		for (const row of schema.filter((entry) => entry.type === "table")) lines.push(`${row.sql};`);
		for (const row of schema.filter((entry) => entry.type === "table")) {
			const statement = db.prepare(`SELECT * FROM "${row.name}" ORDER BY rowid`);
			statement.setReadBigInts(true);
			for (const record of statement.all()) {
				const columns = Object.keys(record);
				lines.push(
					`INSERT INTO "${row.name}" (${columns.map((c) => `"${c}"`).join(", ")}) VALUES (${columns.map((c) => literal(record[c])).join(", ")});`,
				);
			}
		}
		for (const row of schema.filter((entry) => entry.type !== "table")) lines.push(`${row.sql};`);
		lines.push("COMMIT;", "");
		const tasks = db.prepare("SELECT kind, status FROM tasks ORDER BY id").all();
		const version = db.prepare("SELECT version FROM durable_schema WHERE singleton = 1").get()?.version;
		return { sql: lines.join("\n"), tasks, version };
	} finally {
		db.close();
	}
}

async function generate(options) {
	for (const key of ["sdk13-root", "out"]) {
		if (!path.isAbsolute(options[key] ?? "")) die(`--${key} must be an absolute path`);
	}
	const out = fs.realpathSync(options.out);
	if (out === REPO || out.startsWith(`${REPO}${path.sep}`)) die("--out must be outside this repository");
	if (fs.readdirSync(out).length > 0) die("--out must be an empty directory");
	options.out = out;
	const set = sdkSet(options["sdk13-root"]);
	const digest = distDigest(set.durable.dir);
	const publicDir = path.join(out, "public");
	fs.mkdirSync(publicDir);
	const receipt = {
		generatedAt: new Date().toISOString(),
		node: process.version,
		generatorSha256: sha256(fs.readFileSync(fileURLToPath(import.meta.url))),
		sdk: set,
		distDigest: digest,
		scenarios: {},
	};
	const manifest = {
		schemaVersion: 1,
		subject:
			"pi-durable SQLite storage written by SDK 1.3.0 (schema version 1), restored by pi-durable-storage-migration.test.ts and opened by the root SDK",
		generator: "generate.mjs (run it with --sdk13-root and --out; see its header)",
		sdk: {
			package: "@earendil-works/pi-durable",
			version: SDK_VERSION,
			siblings: { "@earendil-works/chord": set.context.version, "@earendil-works/pi-ai": set.models.version },
			distDigest: digest,
		},
		scenarios: {},
	};
	const forbidden = [out, os.homedir(), REPO, os.userInfo().username].filter((s) => s.length > 2);
	for (const scenario of SCENARIOS) {
		const live = path.join(out, "live", scenario);
		const { receipt: run } = await runScenario(options, scenario, live);
		run.pristine = copySet(live, path.join(out, "pristine", scenario));
		run.derived = copySet(live, path.join(out, "derived", scenario));
		const derivedDb = path.join(out, "derived", scenario, "session.sqlite");
		fs.chmodSync(derivedDb, 0o600);
		for (const name of fs.readdirSync(path.dirname(derivedDb)))
			fs.chmodSync(path.join(path.dirname(derivedDb), name), 0o600);
		const { sql, tasks, version } = dump(derivedDb, scenario);
		const leak = forbidden.find((needle) => sql.includes(needle));
		if (leak !== undefined) die(`${scenario}: the dump carries a host-specific string; refusing to write it`);
		if (version !== 1) die(`${scenario}: SDK ${SDK_VERSION} wrote schema version ${version}, not 1`);
		const file = `sdk13-${scenario}.sql`;
		fs.writeFileSync(path.join(publicDir, file), sql);
		run.dump = { file, sha256: sha256(sql), tasks };
		receipt.scenarios[scenario] = run;
		manifest.scenarios[scenario] = { file, sha256: sha256(sql), schemaVersion: version, tasks };
	}
	// The pristine copies were never opened: re-hash them after every dump to prove it.
	for (const scenario of SCENARIOS) {
		const run = receipt.scenarios[scenario];
		const again = {};
		for (const name of Object.keys(run.pristine)) {
			const bytes = fs.readFileSync(path.join(out, "pristine", scenario, name));
			again[name] = { bytes: bytes.length, sha256: sha256(bytes) };
		}
		if (JSON.stringify(again) !== JSON.stringify(run.pristine))
			die(`${scenario}: a pristine copy changed after the dump`);
		run.pristineAfterDump = again;
	}
	fs.writeFileSync(path.join(publicDir, "golden.manifest.json"), `${JSON.stringify(manifest, null, "\t")}\n`);
	fs.writeFileSync(path.join(out, "receipt.json"), `${JSON.stringify(receipt, null, "\t")}\n`);
	process.stdout.write(`${JSON.stringify(manifest.scenarios, null, "\t")}\n`);
}

const options = args(process.argv.slice(2));
if (options.role === "seed") await seed(options);
else await generate(options);
