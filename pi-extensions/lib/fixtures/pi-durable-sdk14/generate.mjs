#!/usr/bin/env node
/**
 * Generator of the SDK 1.4 SQLite goldens that `pi-durable-sdk14-migration.test.ts` opens with the root SDK 1.5
 * (#155), and of the rollback receipts that test cannot make itself because CI never imports SDK 1.4.
 *
 *   node generate.mjs --sdk14-root <abs dir of an installed @earendil-works/pi-durable 1.4.0 package> \
 *     --sdk15-root <abs dir of an installed @earendil-works/pi-durable 1.5.0 package> \
 *     --out <abs empty dir outside this repository>
 *
 * Writes `<out>/public/` (the two dumps and golden.manifest.json — copy those into this directory) and
 * `<out>/receipt.json` (realpaths, pids, start keys, file hashes, reports: private, never committed).
 *
 * The parent imports no SDK. Every SDK step runs in its own child process that imports exactly one SDK version,
 * the package named by --sdk14-root or --sdk15-root and the chord/pi-ai of that same version beside it, through
 * their published exports, so no Node graph ever holds two SDK versions. The model is pi-ai's own faux provider:
 * no network, no credential, no operator path. A child's HOME is inside <out>, its cwd is /, and its environment
 * is PATH, HOME and TMPDIR only.
 *
 * The SDK 1.4 writer (public SDK 1.4 API only; no row is written by hand) runs one root conversation:
 *   1. one answered turn;
 *   2. a manual compaction whose summarization the model refuses, which leaves `pi.live.compactionFailure`;
 *   3. a second turn whose tool call holds, and a second manual compaction whose summarization holds, so the run,
 *      its running tool slot and the running compaction status are all in `pi.live` (version 1, which names a
 *      compaction's trigger `reason` and stores no `run.turns`), beside a pi.generation (version 1) and a pi.tool
 *      (version 2) task;
 * and then either closes the Harness normally (scenario `close`) or is SIGKILLed once (scenario `kill`).
 *
 * After the writer is gone, its database file set is copied untouched to <out>/pristine/<scenario>/ and never opened
 * again. Every other step works on its own copy of that pristine set:
 *   derived/   dumped (node:sqlite, read-only) into the public logical dump the CI test restores;
 *   restored/  opened by SDK 1.4 and read: what the SDK 1.4 reader makes of the pristine file (the rollback target),
 *              and which tables its own open rewrites (crash recovery, so the 1.5 rewrites below have a control);
 *   read15/    opened by SDK 1.5 and read only, then by SDK 1.4 again: whether a read-only 1.5 open is reversible;
 *   write15/   opened by SDK 1.5, which aborts the held run, then by SDK 1.4 again: the newer-version refusal.
 * The pristine hashes are taken again at the end to show none of these steps touched them.
 */
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath, pathToFileURL } from "node:url";

const VERSIONS = { 14: "1.4.0", 15: "1.5.0" };
const SCENARIOS = ["close", "kill"];
const STEP_MS = 15_000;
const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "../../../..");
// The 1.4 summarization request's system prompt opens with this (SDK 1.4 harness/compaction.ts).
const SUMMARY_PROMPT = "You are a context summarization assistant";
const TOOL = "sdk14_hold";

const die = (message) => {
	process.stderr.write(`[pi-durable-sdk14-golden] ${message}\n`);
	process.exit(1);
};
const sha256 = (data) => createHash("sha256").update(data).digest("hex");
const messageOf = (error) => (error instanceof Error ? error.message : String(error));
/** A report argument as JSON can carry it: an error by its message, an object with its `error` field so. */
const plain = (value) =>
	value instanceof Error
		? value.message
		: value?.error instanceof Error
			? { ...value, error: value.error.message }
			: value;

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

/** The published `import` target of `name`'s `subpath`, from the copy beside the pi-durable package. */
function exportOf(sdkRoot, version, name, subpath) {
	const dir = name === "pi-durable" ? sdkRoot : path.join(path.dirname(sdkRoot), name);
	const pkg = JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8"));
	if (pkg.name !== `@earendil-works/${name}` || pkg.version !== version) {
		die(`${dir} is ${pkg.name}@${pkg.version}, not @earendil-works/${name}@${version}`);
	}
	const target = pkg.exports?.[subpath]?.import;
	if (typeof target !== "string") die(`${pkg.name} exports no import target for ${subpath}`);
	return { file: fs.realpathSync(path.join(dir, target)), dir: fs.realpathSync(dir), version: pkg.version };
}

function sdkSet(sdkRoot, version) {
	return {
		durable: exportOf(sdkRoot, version, "pi-durable", "."),
		sqlite: exportOf(sdkRoot, version, "pi-durable", "./storage/sqlite/node"),
		context: exportOf(sdkRoot, version, "chord", "./context"),
		ai: exportOf(sdkRoot, version, "pi-ai", "."),
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

// ---------------------------------------------------------------- children: one SDK version each
/** The SDK of one version, its faux model and the fixture extension, as both child roles open a Harness. */
async function load(options) {
	const version = VERSIONS[options.sdk];
	if (version === undefined) die(`unknown --sdk ${options.sdk}`);
	const set = sdkSet(options["sdk-root"], version);
	const durable = await import(pathToFileURL(set.durable.file).href);
	const { openNodeSqliteStorage } = await import(pathToFileURL(set.sqlite.file).href);
	const { BACKGROUND_CONTEXT } = await import(pathToFileURL(set.context.file).href);
	const ai = await import(pathToFileURL(set.ai.file).href);
	const context = BACKGROUND_CONTEXT;
	const emit = (event) => process.stdout.write(`${JSON.stringify(event)}\n`);
	const faux = ai.fauxProvider({ provider: "faux", models: [{ id: "scripted" }] });
	const models = ai.createModels();
	models.setProvider(faux.provider);
	const reports = [];
	const tool = { holding: () => {} };
	const extension = durable.defineExtension({
		name: "sdk14-fixture",
		tools: [
			durable.defineTool({
				name: TOOL,
				description: "Holds until its invocation is aborted.",
				parameters: { type: "object", properties: {} },
				execute: async (_args, _api, invocation) => {
					tool.holding();
					await abortOf(invocation.abortSignal);
					throw invocation.abortSignal.reason ?? new Error("aborted");
				},
			}),
		],
	});
	const registry = durable.createRegistry();
	registry.install(extension);
	const open = async (db, clock) =>
		durable.Harness.open(
			await openNodeSqliteStorage(db),
			{
				models,
				registry,
				now: () => clock++,
				// A one-token recent tail: the first answered turn already has something to compact.
				settings: { compaction: { keepRecentTokens: 1 } },
				// SDK 1.4 reports (error, info); SDK 1.5 reports one Report whose `error` is the cause.
				onReport: (...reported) => reports.push(reported.map(plain)),
			},
			context,
		);
	return { set, durable, ai, context, emit, faux, tool, reports, open };
}

/** Resolves once `signal` aborts; never, without one (the caller's own step timeout then reports a hang). */
function abortOf(signal) {
	return new Promise((resolve) => {
		if (signal === undefined) return;
		if (signal.aborted) resolve();
		else signal.addEventListener("abort", () => resolve(), { once: true });
	});
}

function within(label, promise) {
	return Promise.race([
		promise,
		new Promise((_resolve, reject) =>
			setTimeout(() => reject(new Error(`${label}: no result within ${STEP_MS} ms`)), STEP_MS),
		),
	]);
}

/** Live tasks as the Harness inspects them, without their inputs or checkpoints. */
const tasksOf = (inspection) =>
	inspection.tasks.map(({ record, state }) => ({
		kind: record.kind,
		version: record.version,
		state: state.kind,
		...(state.migrates === undefined ? {} : { migrates: state.migrates }),
		...(state.reason === undefined ? {} : { reason: state.reason }),
	}));

async function seed(options) {
	const { set, durable, ai, context, emit, faux, tool, reports, open } = await load(options);
	if (set.durable.version !== VERSIONS[14]) die("the writer is SDK 1.4 only");
	const timestamp = 1_800_000_000_000;
	let stage = "answer";
	let summaryHolding;
	const summaryHeld = new Promise((resolve) => {
		summaryHolding = resolve;
	});
	const toolHeld = new Promise((resolve) => {
		tool.holding = resolve;
	});
	const reply = async (transcript, streamOptions) => {
		if (String(transcript.messages?.[0]?.content ?? "").startsWith(SUMMARY_PROMPT)) {
			if (stage === "refuse") {
				return ai.fauxAssistantMessage("", {
					stopReason: "error",
					errorMessage: "SDK14-COMPACTION-REFUSED",
					timestamp,
				});
			}
			summaryHolding();
			await abortOf(streamOptions?.signal);
			return ai.fauxAssistantMessage("", { stopReason: "aborted", errorMessage: "SDK14-SUMMARY-ABORTED", timestamp });
		}
		if (stage === "answer") return ai.fauxAssistantMessage("SDK14-ANSWER", { timestamp });
		return ai.fauxAssistantMessage(ai.fauxToolCall(TOOL, {}, { id: "sdk14-call" }), {
			stopReason: "toolUse",
			timestamp,
		});
	};
	faux.setResponses(Array.from({ length: 16 }, () => reply));

	const harness = await open(options.db, 1_800_000_000_000);
	const root = await harness.root(context, { agent: { model: { provider: "faux", modelId: "scripted" } } });
	const first = await root.submit({ type: "input", content: "SDK14-HELLO", requestId: "sdk14:1" }, context);
	const answered = await within("first answer", first.wait(context));
	if (answered.status !== "done") die(`the first turn ended ${JSON.stringify(answered)}`);

	stage = "refuse";
	const refused = await root.compact(undefined, context);
	await within("refused compaction", harness.waitForTask(refused, context));
	const afterRefusal = await harness.snapshot(durable.LiveDoc, root.id, context);
	if (afterRefusal?.compactionFailure?.reason !== "manual") {
		die(`the refused compaction left ${JSON.stringify(afterRefusal)}`);
	}

	stage = "hold";
	await root.submit({ type: "input", content: "SDK14-HOLD", requestId: "sdk14:2" }, context);
	await within("tool hold", toolHeld);
	await root.compact(undefined, context);
	await within("summary hold", summaryHeld);
	const live = await harness.snapshot(durable.LiveDoc, root.id, context);
	emit({
		event: "holding",
		pid: process.pid,
		versions: { durable: set.durable.version },
		live,
		tasks: tasksOf(await harness.inspect(context)),
	});
	if (options.scenario === "kill") {
		setInterval(() => {}, 60_000); // held until the parent kills this process
		return;
	}
	try {
		await within("close", harness.close(context));
	} catch (error) {
		emit({ event: "close-hang", error: messageOf(error) });
		process.exit(3);
	}
	emit({ event: "closed", reports, modelCalls: faux.state.callCount });
	process.exit(0);
}

/**
 * Open a copy, read `pi.live` and the live tasks, optionally abort the root conversation (`--action abort`, SDK 1.5
 * only: its first write), and close. A refusal is the result, not a failure: it names the step and the message.
 */
async function probe(options) {
	let step = "import";
	try {
		const { durable, context, emit, reports, open } = await load(options);
		step = "open";
		const harness = await open(options.db, 1_800_000_100_000);
		step = "root";
		const root = await harness.root(context);
		step = "snapshot";
		const live = await harness.snapshot(durable.LiveDoc, root.id, context);
		step = "inspect";
		const tasks = tasksOf(await harness.inspect(context));
		const result = { event: "probe", ok: true, live, tasks };
		if (options.action === "abort") {
			step = "abort";
			await within("abort", root.abort(context));
			step = "snapshot after abort";
			result.liveAfterAbort = await harness.snapshot(durable.LiveDoc, root.id, context);
			step = "inspect after abort";
			result.tasksAfterAbort = tasksOf(await harness.inspect(context));
		}
		step = "close";
		await within("close", harness.close(context));
		emit({ ...result, reports });
	} catch (error) {
		process.stdout.write(`${JSON.stringify({ event: "probe", ok: false, step, error: messageOf(error) })}\n`);
	}
	process.exit(0);
}

// ---------------------------------------------------------------- parent: orchestrate, copy, dump
function startKey(pid) {
	const stat = fs.readFileSync(`/proc/${pid}/stat`, "utf8");
	return stat.slice(stat.lastIndexOf(")") + 2).split(" ")[19];
}

/** One child: `extra` are its role arguments. `onEvent` may return "kill" to SIGKILL the verified spawn handle. */
function runChild(options, extra, onEvent = () => undefined) {
	const home = path.join(options.out, "home");
	fs.mkdirSync(home, { recursive: true });
	const child = spawn(process.execPath, [fileURLToPath(import.meta.url), ...extra], {
		cwd: "/",
		env: { PATH: process.env.PATH ?? "", HOME: home, TMPDIR: home },
		stdio: ["ignore", "pipe", "pipe"],
	});
	const events = [];
	let stderr = "";
	let buffer = "";
	const receipt = { argv: extra, pid: child.pid, startKey: startKey(child.pid), events };
	return new Promise((resolve, reject) => {
		const timer = setTimeout(() => {
			child.kill("SIGKILL");
			reject(new Error(`${extra.join(" ")}: no result within ${STEP_MS * 4} ms; stderr: ${stderr}`));
		}, STEP_MS * 4);
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
				if (onEvent(event) === "kill") {
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
			resolve(receipt);
		});
	});
}

async function runSeed(options, scenario, dir) {
	fs.mkdirSync(dir, { recursive: true });
	const db = path.join(dir, "session.sqlite");
	const argv = [
		"--role",
		"seed",
		"--sdk",
		"14",
		"--sdk-root",
		options["sdk14-root"],
		"--scenario",
		scenario,
		"--db",
		db,
	];
	const receipt = await runChild(options, argv, (event) =>
		scenario === "kill" && event.event === "holding" ? "kill" : undefined,
	);
	const expected = scenario === "kill" ? receipt.exit.signal === "SIGKILL" : receipt.exit.code === 0;
	if (!expected || !receipt.writerGone) {
		die(`${scenario}: writer ended ${JSON.stringify(receipt.exit)}; stderr: ${receipt.stderr}`);
	}
	const holding = receipt.events.find((event) => event.event === "holding");
	if (holding === undefined) die(`${scenario}: the writer never reached the held turn`);
	return { receipt, holding };
}

async function runProbe(options, sdk, db, action = "read") {
	const argv = [
		"--role",
		"probe",
		"--sdk",
		sdk,
		"--sdk-root",
		options[`sdk${sdk}-root`],
		"--db",
		db,
		"--action",
		action,
	];
	const receipt = await runChild(options, argv);
	const result = receipt.events.find((event) => event.event === "probe");
	if (receipt.exit.code !== 0 || result === undefined) {
		die(`probe ${sdk} ${action} ${db}: ${JSON.stringify(receipt.exit)}; stderr: ${receipt.stderr}`);
	}
	return { receipt, result };
}

function copySet(fromDir, toDir, mode) {
	fs.mkdirSync(toDir, { recursive: true });
	const files = {};
	for (const name of fs.readdirSync(fromDir).sort()) {
		const bytes = fs.readFileSync(path.join(fromDir, name));
		fs.writeFileSync(path.join(toDir, name), bytes, { flag: "wx", mode });
		files[name] = { bytes: bytes.length, sha256: sha256(bytes) };
	}
	return files;
}

/** A writable copy of the pristine set, for one SDK open. */
function workingCopy(out, scenario, name) {
	const dir = path.join(out, name, scenario);
	copySet(path.join(out, "pristine", scenario), dir, 0o600);
	return path.join(dir, "session.sqlite");
}

function literal(value) {
	if (value === null) return "NULL";
	if (typeof value === "bigint") return value.toString();
	// Integers arrive as bigint (setReadBigInts); a number is a REAL, and v2 declares no REAL column.
	if (typeof value === "number") throw new Error(`unsupported REAL value ${value}: the v2 schema has no REAL column`);
	if (typeof value === "string") return `'${value.replaceAll("'", "''")}'`;
	if (value instanceof Uint8Array) return `X'${Buffer.from(value).toString("hex")}'`;
	throw new Error(`unsupported SQLite value ${typeof value}`);
}

function readOnly(dbPath, query) {
	const db = new DatabaseSync(dbPath, { readOnly: true });
	try {
		return query(db);
	} finally {
		db.close();
	}
}

/** Every user table's rows in rowid order, integers exact, as one comparable string per table. */
function logicalRows(dbPath) {
	return readOnly(dbPath, (db) => {
		const tables = db
			.prepare("SELECT name FROM sqlite_schema WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
			.all();
		const out = {};
		for (const { name } of tables) {
			const statement = db.prepare(`SELECT * FROM "${name}" ORDER BY rowid`);
			statement.setReadBigInts(true);
			out[name] = JSON.stringify(statement.all(), (_key, value) => (typeof value === "bigint" ? `${value}n` : value));
		}
		return out;
	});
}

/** Per document kind, the stored revision versions; per live task, its kind, stored version and status. */
function storedVersions(dbPath) {
	return readOnly(dbPath, (db) => ({
		schemaVersion: db.prepare("SELECT version FROM durable_schema WHERE singleton = 1").get()?.version,
		documents: Object.fromEntries(
			db
				.prepare(
					"SELECT json_extract(d.record, '$.kind') AS kind, group_concat(DISTINCT r.version) AS versions FROM documents d JOIN document_revisions r ON r.document_id = d.id GROUP BY d.kind ORDER BY d.kind",
				)
				.all()
				.map((row) => [row.kind, String(row.versions).split(",").map(Number).sort()]),
		),
		tasks: db
			.prepare(
				"SELECT json_extract(record, '$.kind') AS kind, json_extract(record, '$.version') AS version, status FROM tasks ORDER BY id",
			)
			.all()
			.map((row) => ({ ...row })),
	}));
}

/** Logical dump: tables, then rows in rowid order, then indexes, each from sqlite_schema as stored. */
function dump(dbPath, scenario) {
	return readOnly(dbPath, (db) => {
		const schema = db
			.prepare(
				"SELECT type, name, sql FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%' AND sql IS NOT NULL ORDER BY rowid",
			)
			.all();
		const lines = [
			`-- @earendil-works/pi-durable ${VERSIONS[14]} SQLite storage, logical dump, scenario ${scenario}.`,
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
		return lines.join("\n");
	});
}

/** Tab-indented JSON with each array of scalars on one line when it fits, as the repository's formatter keeps it. */
function formatJson(value) {
	const scalar = String.raw`(?:"(?:[^"\\\n]|\\.)*"|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null)`;
	const array = new RegExp(String.raw`^([^\n]*)\[\n\s*(${scalar}(?:,\n\s*${scalar})*)\n\s*\]`, "gm");
	return `${JSON.stringify(value, null, "\t").replace(array, (whole, head, body) => {
		const line = `${head}[${body.split(/,\n\s*/).join(", ")}]`;
		return line.replace(/\t/g, "  ").length <= 120 ? line : whole;
	})}\n`;
}

const changedTables = (before, after) =>
	Object.keys({ ...before, ...after }).filter((name) => before[name] !== after[name]);

async function generate(options) {
	for (const key of ["sdk14-root", "sdk15-root", "out"]) {
		if (!path.isAbsolute(options[key] ?? "")) die(`--${key} must be an absolute path`);
	}
	const out = fs.realpathSync(options.out);
	if (out === REPO || out.startsWith(`${REPO}${path.sep}`)) die("--out must be outside this repository");
	if (fs.readdirSync(out).length > 0) die("--out must be an empty directory");
	options.out = out;
	const sets = { 14: sdkSet(options["sdk14-root"], VERSIONS[14]), 15: sdkSet(options["sdk15-root"], VERSIONS[15]) };
	const digests = { 14: distDigest(sets[14].durable.dir), 15: distDigest(sets[15].durable.dir) };
	const publicDir = path.join(out, "public");
	fs.mkdirSync(publicDir);
	const receipt = {
		generatedAt: new Date().toISOString(),
		node: process.version,
		generatorSha256: sha256(fs.readFileSync(fileURLToPath(import.meta.url))),
		sdk: sets,
		distDigest: digests,
		scenarios: {},
	};
	const sdkOf = (version) => ({
		package: "@earendil-works/pi-durable",
		version: VERSIONS[version],
		siblings: {
			"@earendil-works/chord": sets[version].context.version,
			"@earendil-works/pi-ai": sets[version].ai.version,
		},
		distDigest: digests[version],
	});
	const manifest = {
		schemaVersion: 1,
		subject:
			"pi-durable SQLite storage written by SDK 1.4.0 mid-run (pi.live version 1, pi.generation version 1, pi.tool version 2), restored by pi-durable-sdk14-migration.test.ts and opened by the root SDK 1.5",
		generator: "generate.mjs (run it with --sdk14-root, --sdk15-root and --out; see its header)",
		sdk: sdkOf(14),
		// Generation-time only: the SDK that made the rollback receipts below. CI reads the receipts, never this SDK.
		rollbackSdk: sdkOf(15),
		scenarios: {},
	};
	const forbidden = [out, os.homedir(), REPO, os.userInfo().username].filter((s) => s.length > 2);
	for (const scenario of SCENARIOS) {
		const live = path.join(out, "live", scenario);
		const { receipt: run, holding } = await runSeed(options, scenario, live);
		run.pristine = copySet(live, path.join(out, "pristine", scenario), 0o400);
		const derived = workingCopy(out, scenario, "derived");
		const sql = dump(derived, scenario);
		const stored = storedVersions(derived);
		if (sql.length === 0 || forbidden.some((needle) => sql.includes(needle))) {
			die(`${scenario}: the dump is empty or carries a host-specific string; refusing to write it`);
		}
		if (stored.schemaVersion !== 2)
			die(`${scenario}: SDK ${VERSIONS[14]} wrote schema version ${stored.schemaVersion}, not 2`);

		// The 1.4 reader on its own pristine file: the state a rollback returns to, and what its own open rewrites.
		const restoredDb = workingCopy(out, scenario, "restored");
		const beforeRestore = logicalRows(restoredDb);
		const restored = await runProbe(options, "14", restoredDb);
		if (!restored.result.ok)
			die(`${scenario}: SDK 1.4 refused its own pristine file: ${JSON.stringify(restored.result)}`);
		const restoreChanged = changedTables(beforeRestore, logicalRows(restoredDb));
		const live14 = restored.result.live;
		if (live14?.compactionFailure?.reason !== "manual" || live14.run === undefined || "turns" in live14.run) {
			die(`${scenario}: the 1.4 pi.live is not the mid-run state this golden needs: ${JSON.stringify(live14)}`);
		}

		// A read-only SDK 1.5 open, then SDK 1.4 on the same file.
		const read15Db = workingCopy(out, scenario, "read15");
		const beforeRead = logicalRows(read15Db);
		const read15 = await runProbe(options, "15", read15Db);
		const readChanged = changedTables(beforeRead, logicalRows(read15Db));
		const read15By14 = await runProbe(options, "14", read15Db);

		// The first SDK 1.5 write (an abort of the held run), then SDK 1.4 on the same file.
		const write15Db = workingCopy(out, scenario, "write15");
		const write15 = await runProbe(options, "15", write15Db, "abort");
		const written = storedVersions(write15Db);
		const write15By14 = await runProbe(options, "14", write15Db);
		if (write15By14.result.ok)
			die(`${scenario}: SDK 1.4 opened the file SDK 1.5 wrote: ${JSON.stringify(write15By14.result)}`);

		const file = `sdk14-${scenario}.sql`;
		fs.writeFileSync(path.join(publicDir, file), sql);
		Object.assign(run, {
			holding,
			dump: { file, sha256: sha256(sql), stored },
			probes: { restored, read15, read15By14, write15, write15By14 },
		});
		receipt.scenarios[scenario] = run;
		manifest.scenarios[scenario] = {
			file,
			sha256: sha256(sql),
			stored,
			// SDK 1.4's own reading of its pristine file (the oracle the 1.5 reading is compared with).
			live14,
			tasks14: restored.result.tasks,
			rollback: {
				readOnly15: {
					changedTables: readChanged,
					reopenedBy14: read15By14.result.ok || { step: read15By14.result.step, error: read15By14.result.error },
				},
				write15: {
					action: "abort",
					storedAfter: written,
					reopenedBy14: { step: write15By14.result.step, error: write15By14.result.error },
				},
				pristineReopenedBy14: { changedTables: restoreChanged },
			},
		};
	}
	// The pristine copies were never opened: re-hash them after every probe to prove it.
	for (const scenario of SCENARIOS) {
		const run = receipt.scenarios[scenario];
		const again = {};
		for (const name of Object.keys(run.pristine)) {
			const bytes = fs.readFileSync(path.join(out, "pristine", scenario, name));
			again[name] = { bytes: bytes.length, sha256: sha256(bytes) };
		}
		if (JSON.stringify(again) !== JSON.stringify(run.pristine))
			die(`${scenario}: a pristine copy changed after the probes`);
		run.pristineAfterProbes = again;
	}
	const text = formatJson(manifest);
	if (forbidden.some((needle) => text.includes(needle)))
		die("the manifest carries a host-specific string; refusing to write it");
	fs.writeFileSync(path.join(publicDir, "golden.manifest.json"), text);
	fs.writeFileSync(path.join(out, "receipt.json"), `${JSON.stringify(receipt, null, "\t")}\n`);
	process.stdout.write(`${JSON.stringify(manifest.scenarios, null, "\t")}\n`);
}

const options = args(process.argv.slice(2));
if (options.role === "seed") await seed(options);
else if (options.role === "probe") await probe(options);
else await generate(options);
