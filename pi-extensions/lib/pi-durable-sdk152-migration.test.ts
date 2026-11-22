/**
 * pi-durable-sdk152-migration (#172) — a session SDK 1.5.2 left mid-run, opened by the root SDK 1.6.
 *
 * SDK 1.6.0 keeps the SQLite schema at version 2 and every document version, and versions two task kinds higher:
 * pi.generation 2 → 3 and pi.tool 3 → 4. It migrates an older task in memory when it reads one and stores the new
 * version only when it writes that task; SDK 1.5.2 blocks a task newer than its definition as `task_too_old`. That
 * is the upgrade and rollback boundary of every durable session the carrier opened on SDK 1.5.
 *
 * The subject is the root SDK's storage open, Harness open, read, first write and resumed run. The oracles are
 * Node's own SQLite reading the file before and after, and SDK 1.5.2's own reading of the same pristine file,
 * recorded at generation (fixtures/pi-durable-sdk152/: two logical dumps of one root conversation SDK 1.5.2 wrote
 * through its public API with pi-ai's faux model — a refused manual compaction, then a turn whose tool call and a
 * second compaction hold — one closed normally, one SIGKILLed; and a manifest). The task versions this file expects
 * of a 1.6 write are written here by hand (inherited: dist/harness/{generation,tool}.js of 1.6.0).
 *
 * CI never installs or imports SDK 1.5.2. The manifest's rollback receipts (SDK 1.5.2 reopened its pristine file,
 * the file a 1.6 open that started no scheduling left and the file a 1.6 abort left; in the file a resumed 1.6 run
 * left it kept the pending compaction and blocked the pending pi.generation as `task_too_old`) are generation-time
 * measurements on the SDK pair the manifest names. This file certifies only that its own run leaves each file's
 * stored projection (schema version, document versions, each task's kind, version and status) as those receipts
 * were taken on; it reproduces no database byte for byte and reruns no SDK 1.5.2.
 *
 * Conformance of SDK-owned behavior against independent oracles, not a new Entwurf contract: there is no local
 * subject to mutate and no kill-power claim. What the carrier shows of such a session is the carrier test's.
 */
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { createModels, fauxAssistantMessage, fauxProvider } from "@earendil-works/pi-ai";
import {
	createRegistry,
	defineExtension,
	defineTool,
	Harness,
	type HarnessInspection,
	LiveDoc,
} from "@earendil-works/pi-durable";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
import { obj } from "@earendil-works/pi-schema";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const FIXTURES = path.join(import.meta.dirname, "fixtures", "pi-durable-sdk152");
type Json = Record<string, unknown>;
type Stored = {
	schemaVersion: number;
	documents: Record<string, number[]>;
	tasks: { kind: string; version: number; status: string }[];
};
type Task = { kind: string; version: number; state: string; migrates?: boolean; reason?: string };
type Reopened = { tasks: Task[] };
type Scenario = {
	file: string;
	sha256: string;
	stored: Stored;
	live152: Json;
	tasks152: Task[];
	rollback: {
		pristineReopenedBy152: { changedTables: string[] };
		readOnly160: { changedTables: string[]; reopenedBy152: Reopened };
		abort160: { storedAfter: Stored; reopenedBy152: Reopened };
		resume160: { tasksAfter: Task[]; storedAfter: Stored; reopenedBy152: Reopened };
	};
};
const manifest = JSON.parse(fs.readFileSync(path.join(FIXTURES, "golden.manifest.json"), "utf8")) as {
	sdk: { package: string; version: string };
	rollbackSdk: { package: string; version: string };
	scenarios: Record<string, Scenario>;
};
const SCENARIOS = Object.entries(manifest.scenarios);
/** What the held run left of each live task, per scenario: a close hands its running tasks back, a kill cannot. */
const HELD = { close: "pending", kill: "running" } as const;
/** SDK 1.5.2's definition versions (inherited: dist/harness/{live,generation,tool,compaction}.js of 1.5.2). */
const VERSION_152: Record<string, number> = { "pi.live": 3, "pi.generation": 2, "pi.tool": 3, "pi.compaction": 1 };
/** SDK 1.6.0's (inherited: dist/harness/{generation,tool}.js of 1.6.0): the two task kinds it versions higher. */
const VERSION_160: Record<string, number> = { ...VERSION_152, "pi.generation": 3, "pi.tool": 4 };
const SUMMARY_PROMPT = "You are a context summarization assistant";
const TOOL = "sdk152_hold";
const sha256 = (data: string): string => createHash("sha256").update(data).digest("hex");

let root: string;
beforeEach(() => {
	root = fs.mkdtempSync(path.join(os.tmpdir(), "pi-durable-sdk152-migration-"));
});
afterEach(() => {
	fs.rmSync(root, { recursive: true, force: true });
});

/** A fresh database holding exactly one golden: the dump runs once into a file no other trial sees. */
function materialize(scenario: Scenario, name: string): string {
	const sql = fs.readFileSync(path.join(FIXTURES, scenario.file), "utf8");
	const file = path.join(root, `${name}.sqlite`);
	const db = new DatabaseSync(file);
	try {
		db.exec(sql);
	} finally {
		db.close();
	}
	return file;
}

function read<T>(file: string, query: (db: DatabaseSync) => T): T {
	const db = new DatabaseSync(file, { readOnly: true });
	try {
		return query(db);
	} finally {
		db.close();
	}
}

/** Every user table's rows, in rowid order, with integers kept exact. */
function rows(file: string): Record<string, unknown[]> {
	return read(file, (db) => {
		const tables = db
			.prepare("SELECT name FROM sqlite_schema WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
			.all() as { name: string }[];
		const out: Record<string, unknown[]> = {};
		for (const { name } of tables) {
			const statement = db.prepare(`SELECT * FROM "${name}" ORDER BY rowid`);
			statement.setReadBigInts(true);
			out[name] = statement.all();
		}
		return out;
	});
}

/** The same reading as the generator's: per document kind its revision versions, per task its stored version. */
function stored(file: string): Stored {
	return read(file, (db) => ({
		schemaVersion: (db.prepare("SELECT version FROM durable_schema WHERE singleton = 1").get() as { version: number })
			.version,
		documents: Object.fromEntries(
			(
				db
					.prepare(
						"SELECT json_extract(d.record, '$.kind') AS kind, group_concat(DISTINCT r.version) AS versions FROM documents d JOIN document_revisions r ON r.document_id = d.id GROUP BY d.kind ORDER BY d.kind",
					)
					.all() as { kind: string; versions: string | number }[]
			).map((row) => [
				row.kind,
				String(row.versions)
					.split(",")
					.map(Number)
					.sort((a, b) => a - b),
			]),
		),
		tasks: (
			db
				.prepare(
					"SELECT json_extract(record, '$.kind') AS kind, json_extract(record, '$.version') AS version, status FROM tasks ORDER BY id",
				)
				.all() as Stored["tasks"]
		).map((row) => ({ ...row })),
	}));
}

const tasksOf = (inspection: HarnessInspection): Task[] =>
	inspection.tasks.map(({ record, state }) => ({
		kind: record.kind,
		version: record.version,
		state: state.kind,
		...("migrates" in state ? { migrates: state.migrates } : {}),
		...("reason" in state ? { reason: state.reason } : {}),
	}));

/**
 * The root SDK opened the way the generator's 1.6 probe opened it: the fixture tool, its settings, and a faux model
 * that holds every request until it is aborted, telling the two kinds of request apart.
 */
async function openHarness(file: string) {
	const faux = fauxProvider({ provider: "faux", models: [{ id: "scripted" }] });
	const models = createModels();
	models.setProvider(faux.provider);
	const held = { summary: () => {}, generation: () => {} };
	const bothHeld = Promise.all([
		new Promise<void>((resolve) => {
			held.summary = resolve;
		}),
		new Promise<void>((resolve) => {
			held.generation = resolve;
		}),
	]);
	faux.setResponses(
		Array.from({ length: 16 }, () => async (transcript, options) => {
			if (String(transcript.messages?.[0]?.content ?? "").startsWith(SUMMARY_PROMPT)) held.summary();
			else held.generation();
			await new Promise<void>((resolve) => {
				if (options?.signal?.aborted) resolve();
				else options?.signal?.addEventListener("abort", () => resolve(), { once: true });
			});
			return fauxAssistantMessage("", { stopReason: "aborted", errorMessage: "SDK152-TEST-ABORTED" });
		}),
	);
	const registry = createRegistry();
	registry.install(
		defineExtension({
			name: "sdk152-fixture",
			tools: [
				defineTool({
					name: TOOL,
					description: "Holds until its invocation is aborted.",
					parameters: obj({}),
					execute: async () => {
						throw new Error("the held tool never runs again in this file");
					},
				}),
			],
		}),
	);
	let clock = 1_800_000_100_000;
	const reports: unknown[] = [];
	const harness = await Harness.open(
		await openNodeSqliteStorage(file),
		{
			models,
			registry,
			now: () => clock++,
			settings: { compaction: { keepRecentTokens: 1 } },
			onReport: (report) => reports.push(report),
		},
		BACKGROUND_CONTEXT,
	);
	return { harness, reports, faux, bothHeld };
}

/** Which tables a step rewrote, by exact row text. */
function changedTables(before: Record<string, unknown[]>, after: Record<string, unknown[]>): string[] {
	const text = (table: unknown[] | undefined) =>
		JSON.stringify(table, (_key, value) => (typeof value === "bigint" ? `${value}n` : value));
	return Object.keys(after).filter((table) => text(after[table]) !== text(before[table]));
}

describe("SDK 1.5.2 mid-run goldens", () => {
	it("golden fixture: each dump is the bytes its manifest hashes, written by SDK 1.5.2 mid-run at schema version 2", () => {
		expect(manifest.sdk).toMatchObject({ package: "@earendil-works/pi-durable", version: "1.5.2" });
		expect(manifest.rollbackSdk).toMatchObject({ package: "@earendil-works/pi-durable", version: "1.6.0" });
		expect(SCENARIOS.map(([name]) => name).sort()).toEqual(["close", "kill"]);
		for (const [name, scenario] of SCENARIOS) {
			expect(sha256(fs.readFileSync(path.join(FIXTURES, scenario.file), "utf8")), name).toBe(scenario.sha256);
			const file = materialize(scenario, `${name}-golden`);
			expect(stored(file), name).toEqual(scenario.stored);
			// What this golden exists for: a held run whose generation and tool call are stored at SDK 1.5.2's versions,
			// the two SDK 1.6.0 versions higher, beside a compaction that also holds.
			const held = HELD[name as keyof typeof HELD];
			expect(scenario.stored.schemaVersion, name).toBe(2);
			expect(scenario.stored.documents["pi.live"], name).toEqual([VERSION_152["pi.live"]]);
			expect(
				scenario.stored.tasks.filter((task) => task.status !== "terminal"),
				name,
			).toEqual([
				{ kind: "pi.generation", version: VERSION_152["pi.generation"], status: "waiting" },
				{ kind: "pi.tool", version: VERSION_152["pi.tool"], status: held },
				{ kind: "pi.compaction", version: VERSION_152["pi.compaction"], status: held },
			]);
			expect(scenario.live152, name).toMatchObject({
				compactionFailure: { trigger: "manual", error: "Summarization failed: SDK152-COMPACTION-REFUSED" },
				compactions: [{ trigger: "manual", blocking: false }],
				tools: [{ name: TOOL, status: "running" }],
			});
		}
	});
});

describe.each(SCENARIOS)("the root SDK on the SDK 1.5.2 %s golden", (name, scenario) => {
	it("SDK conformance: a storage open keeps schema version 2 and every row", async () => {
		const file = materialize(scenario, name);
		const before = rows(file);
		const storage = await openNodeSqliteStorage(file);
		await storage.close(BACKGROUND_CONTEXT);
		expect(rows(file)).toEqual(before);
		expect(stored(file).schemaVersion).toBe(2);
	});

	it("SDK conformance: a Harness open reads pi.live as SDK 1.5.2 read it and offers the held tool call for migration", async () => {
		const file = materialize(scenario, name);
		const { harness, reports, faux } = await openHarness(file);
		try {
			const conversation = await harness.root(BACKGROUND_CONTEXT);
			expect(await harness.snapshot(LiveDoc, conversation.id, BACKGROUND_CONTEXT)).toEqual(scenario.live152);
			// SDK 1.5.2 read the same three tasks; only the one whose definition is newer here migrates.
			const tasks = tasksOf(await harness.inspect(BACKGROUND_CONTEXT));
			expect(tasks).toEqual([
				{ kind: "pi.tool", version: 3, state: "pending", migrates: 3 < VERSION_160["pi.tool"] },
				{ kind: "pi.compaction", version: 1, state: "pending", migrates: 1 < VERSION_160["pi.compaction"] },
				{ kind: "pi.generation", version: 2, state: "waiting" },
			]);
			expect(tasks.map((task) => ({ ...task, migrates: undefined }))).toEqual(
				scenario.tasks152.map((task) => ({ ...task, migrates: undefined })),
			);
		} finally {
			await harness.close(BACKGROUND_CONTEXT);
		}
		expect(reports).toEqual([]);
		expect(faux.state.callCount).toBe(0);
	});

	it("rollback boundary: a Harness open that reads without starting scheduling stores no new version and rewrites only what SDK 1.5.2's own open rewrote", async () => {
		const file = materialize(scenario, name);
		const before = rows(file);
		const versions = stored(file);
		const { harness, faux } = await openHarness(file);
		try {
			const conversation = await harness.root(BACKGROUND_CONTEXT);
			await harness.snapshot(LiveDoc, conversation.id, BACKGROUND_CONTEXT);
			await harness.inspect(BACKGROUND_CONTEXT);
		} finally {
			await harness.close(BACKGROUND_CONTEXT);
		}
		const changed = changedTables(before, rows(file));
		// The control is SDK 1.5.2 opening the same pristine file: a crash leaves recovery for any open to write.
		expect(changed).toEqual(scenario.rollback.pristineReopenedBy152.changedTables);
		expect(changed).toEqual(name === "kill" ? ["durable_metadata", "tasks"] : []);
		expect(stored(file)).toEqual({
			...versions,
			tasks: versions.tasks.map((task) => ({ ...task, status: expect.any(String) })),
		});
		expect(faux.state.callCount).toBe(0);
		// Generation receipt, on the same stored state: SDK 1.5.2 reopened such a file and read its own three tasks.
		expect(scenario.rollback.readOnly160).toEqual({
			changedTables: changed,
			reopenedBy152: { tasks: scenario.tasks152 },
		});
	});

	it("rollback boundary: the first 1.6 write stores the held generation at version 3 and its tool call at version 4, and ends every task", async () => {
		const file = materialize(scenario, name);
		const { harness, reports, faux } = await openHarness(file);
		try {
			const conversation = await harness.root(BACKGROUND_CONTEXT);
			await conversation.abort(BACKGROUND_CONTEXT);
			expect(tasksOf(await harness.inspect(BACKGROUND_CONTEXT))).toEqual([]);
		} finally {
			await harness.close(BACKGROUND_CONTEXT);
		}
		expect(reports).toEqual([]);
		expect(faux.state.callCount).toBe(0);

		const after = stored(file);
		// By hand: the documents and the two tasks that had already ended stay as SDK 1.5.2 stored them; the three
		// held tasks end, each at the version of the SDK that wrote it again.
		expect(after).toEqual({
			...scenario.stored,
			tasks: scenario.stored.tasks.map((task) =>
				task.status === "terminal" ? task : { kind: task.kind, version: VERSION_160[task.kind], status: "terminal" },
			),
		});
		// Generation receipt, taken on this stored state: with no task left, SDK 1.5.2 reopened the file.
		expect(scenario.rollback.abort160).toEqual({ storedAfter: after, reopenedBy152: { tasks: [] } });
	});

	it("rollback boundary: a run 1.6 resumed leaves a pending generation at version 3, the task SDK 1.5.2 blocked as task_too_old at generation", async () => {
		const file = materialize(scenario, name);
		const { harness, reports, bothHeld } = await openHarness(file);
		let running: Task[] = [];
		try {
			await harness.root(BACKGROUND_CONTEXT);
			harness.resume();
			await bothHeld;
			running = tasksOf(await harness.inspect(BACKGROUND_CONTEXT));
		} finally {
			await harness.close(BACKGROUND_CONTEXT);
		}
		expect(reports).toEqual([]);
		// The interrupted tool call ended, and the run asked the model again under a new generation task.
		expect(running).toEqual([
			{ kind: "pi.compaction", version: 1, state: "running" },
			{ kind: "pi.generation", version: VERSION_160["pi.generation"], state: "running" },
		]);
		const after = stored(file);
		expect(after.schemaVersion).toBe(2);
		expect(after.documents).toEqual(scenario.stored.documents);
		expect(after.tasks.filter((task) => task.status !== "terminal")).toEqual([
			{ kind: "pi.compaction", version: 1, status: "pending" },
			{ kind: "pi.generation", version: VERSION_160["pi.generation"], status: "pending" },
		]);
		expect(after.tasks).toContainEqual({ kind: "pi.tool", version: VERSION_160["pi.tool"], status: "terminal" });
		// Generation receipt, taken on this stored state: SDK 1.5.2 opened the file, kept the compaction it knows and
		// blocked the generation whose version is newer than its definition.
		const receipt = scenario.rollback.resume160;
		expect(receipt.tasksAfter).toEqual(running);
		expect(receipt.storedAfter).toEqual(after);
		expect(receipt.reopenedBy152).toEqual({
			tasks: [
				{ kind: "pi.compaction", version: 1, state: "pending", migrates: false },
				{ kind: "pi.generation", version: VERSION_160["pi.generation"], state: "blocked", reason: "task_too_old" },
			],
		});
		expect(VERSION_152["pi.generation"]).toBeLessThan(VERSION_160["pi.generation"]);
	});
});
