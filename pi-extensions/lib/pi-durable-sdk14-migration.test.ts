/**
 * pi-durable-sdk14-migration (#155) — a session SDK 1.4.0 left mid-run, opened by the root SDK 1.5.
 *
 * SDK 1.5 keeps the SQLite schema at version 2 and versions documents and tasks instead: pi.live 1 → 3 (a
 * compaction's `reason` is now `trigger`; `run.turns` is new), pi.generation 1 → 2, pi.tool 2 → 3. It migrates an
 * older document or task in memory when it reads one and stores the new version only when it writes it; SDK 1.4
 * refuses a document newer than it knows. That is the upgrade and rollback boundary of every durable session the
 * carrier opened before #155.
 *
 * The subject is the root SDK's storage open, Harness open, read and first write. The oracles are Node's own SQLite
 * reading the file before and after, and SDK 1.4's own reading of the same pristine file, recorded at generation
 * (fixtures/pi-durable-sdk14/: two logical dumps of one root conversation SDK 1.4.0 wrote through its public API
 * with pi-ai's faux model — a refused manual compaction, then a turn whose tool call and a second compaction hold —
 * one closed normally, one SIGKILLed; and a manifest). The 1.5 shape this file expects of that reading is the 1.4
 * reading renamed by hand from SDK 1.5's LiveDoc `migrate` (inherited: harness/live.ts of 1.5.0), never a 1.5 output.
 *
 * CI never installs or imports SDK 1.4. The manifest's rollback receipts (SDK 1.4 reopened its pristine file and
 * the file a read-only 1.5 open left; it refused the file the first 1.5 write left, at its first pi.live read) are
 * generation-time measurements on the SDK pair the manifest names. This file certifies only that its own 1.5 run
 * leaves each file in the stored state those receipts were taken on.
 *
 * Conformance of SDK-owned behavior against independent oracles, not a new Entwurf contract: there is no local
 * subject to mutate and no kill-power claim. What the carrier shows of a migrated session is the carrier test's.
 */
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { createModels, fauxProvider } from "@earendil-works/pi-ai";
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

const FIXTURES = path.join(import.meta.dirname, "fixtures", "pi-durable-sdk14");
type Json = Record<string, unknown>;
type Stored = {
	schemaVersion: number;
	documents: Record<string, number[]>;
	tasks: { kind: string; version: number; status: string }[];
};
type Scenario = {
	file: string;
	sha256: string;
	stored: Stored;
	live14: Json;
	rollback: {
		readOnly15: { changedTables: string[]; reopenedBy14: true | { step: string; error: string } };
		write15: { action: string; storedAfter: Stored; reopenedBy14: { step: string; error: string } };
		pristineReopenedBy14: { changedTables: string[] };
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
/** SDK 1.5.0's definition versions (inherited: harness/{live,generation,tool,compaction}.ts of 1.5.0). */
const VERSION_15: Record<string, number> = { "pi.live": 3, "pi.generation": 2, "pi.tool": 3, "pi.compaction": 1 };
const TOOL = "sdk14_hold";
const sha256 = (data: string): string => createHash("sha256").update(data).digest("hex");

let root: string;
beforeEach(() => {
	root = fs.mkdtempSync(path.join(os.tmpdir(), "pi-durable-sdk14-migration-"));
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

const liveDocumentId = (file: string): number =>
	read(
		file,
		(db) =>
			(db.prepare("SELECT id FROM documents WHERE json_extract(record, '$.kind') = 'pi.live'").get() as { id: number })
				.id,
	);

/** SDK 1.5's LiveDoc migration of a version 1 value, by hand: `reason` → `trigger`; a run without turns counts 0. */
function as15(live: Json): Json {
	const rename = (value: Json): Json =>
		Object.fromEntries(Object.entries(value).map(([key, field]) => [key === "reason" ? "trigger" : key, field]));
	const { run, compactions, compactionFailure } = live as {
		run?: Json;
		compactions?: Json[];
		compactionFailure?: Json;
	};
	return {
		...live,
		...(run === undefined ? {} : { run: { ...run, turns: 0 } }),
		...(compactions === undefined ? {} : { compactions: compactions.map(rename) }),
		...(compactionFailure === undefined ? {} : { compactionFailure: rename(compactionFailure) }),
	};
}

const tasksOf = (inspection: HarnessInspection) =>
	inspection.tasks.map(({ record, state }) => ({
		kind: record.kind,
		version: record.version,
		state: state.kind,
		...("migrates" in state ? { migrates: state.migrates } : {}),
	}));

/** The root SDK opened the way the generator's 1.5 probe opened it: faux model, the fixture tool, its settings. */
async function openHarness(file: string) {
	const faux = fauxProvider({ provider: "faux", models: [{ id: "scripted" }] });
	const models = createModels();
	models.setProvider(faux.provider);
	const registry = createRegistry();
	registry.install(
		defineExtension({
			name: "sdk14-fixture",
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
	return { harness, reports, faux };
}

describe("SDK 1.4 mid-run goldens", () => {
	it("golden fixture: each dump is the bytes its manifest hashes, written by SDK 1.4.0 mid-run at schema version 2", () => {
		expect(manifest.sdk).toMatchObject({ package: "@earendil-works/pi-durable", version: "1.4.0" });
		expect(manifest.rollbackSdk).toMatchObject({ package: "@earendil-works/pi-durable", version: "1.5.0" });
		expect(SCENARIOS.map(([name]) => name).sort()).toEqual(["close", "kill"]);
		for (const [name, scenario] of SCENARIOS) {
			expect(sha256(fs.readFileSync(path.join(FIXTURES, scenario.file), "utf8")), name).toBe(scenario.sha256);
			const file = materialize(scenario, `${name}-golden`);
			expect(stored(file), name).toEqual(scenario.stored);
			// What this golden exists for: every document still at its SDK 1.4 version, and a held run's tasks at the
			// versions SDK 1.5 migrates (a generation at 1, its tool call at 2) beside a compaction that also holds.
			const held = HELD[name as keyof typeof HELD];
			expect(scenario.stored.schemaVersion, name).toBe(2);
			expect(new Set(Object.values(scenario.stored.documents).flat()), name).toEqual(new Set([1]));
			expect(
				scenario.stored.tasks.filter((task) => task.status !== "terminal"),
				name,
			).toEqual([
				{ kind: "pi.generation", version: 1, status: "waiting" },
				{ kind: "pi.tool", version: 2, status: held },
				{ kind: "pi.compaction", version: 1, status: held },
			]);
			// SDK 1.4's reading of its own pristine file: version 1 names the trigger `reason` and counts no turns.
			expect(scenario.live14, name).toMatchObject({
				compactionFailure: { reason: "manual", error: "Summarization failed: SDK14-COMPACTION-REFUSED" },
				compactions: [{ reason: "manual", blocking: false }],
				tools: [{ name: TOOL, status: "running" }],
			});
			expect(scenario.live14.run, name).not.toHaveProperty("turns");
		}
	});
});

describe.each(SCENARIOS)("root SDK 1.5 on the SDK 1.4 %s golden", (name, scenario) => {
	it("SDK conformance: a storage open keeps schema version 2 and every row", async () => {
		const file = materialize(scenario, name);
		const before = rows(file);
		const storage = await openNodeSqliteStorage(file);
		await storage.close(BACKGROUND_CONTEXT);
		expect(rows(file)).toEqual(before);
		expect(stored(file).schemaVersion).toBe(2);
	});

	it("SDK conformance: a Harness open reads pi.live as SDK 1.4 read it, in the 1.5 shape, and offers the held tasks for migration", async () => {
		const file = materialize(scenario, name);
		const { harness, reports, faux } = await openHarness(file);
		try {
			const conversation = await harness.root(BACKGROUND_CONTEXT);
			const live = (await harness.snapshot(LiveDoc, conversation.id, BACKGROUND_CONTEXT)) as Json | undefined;
			expect(live).toEqual(as15(scenario.live14));
			expect(live).not.toHaveProperty("compactionFailure.reason");
			// Every held task is the scheduler's to run again; one stored older than SDK 1.5's definition migrates.
			const tasks = tasksOf(await harness.inspect(BACKGROUND_CONTEXT));
			expect(tasks).toEqual([
				{ kind: "pi.tool", version: 2, state: "pending", migrates: 2 < VERSION_15["pi.tool"] },
				{ kind: "pi.compaction", version: 1, state: "pending", migrates: 1 < VERSION_15["pi.compaction"] },
				{ kind: "pi.generation", version: 1, state: "waiting" },
			]);
		} finally {
			await harness.close(BACKGROUND_CONTEXT);
		}
		expect(reports).toEqual([]);
		expect(faux.state.callCount).toBe(0);
	});

	it("rollback boundary: a read-only Harness open stores no new version and rewrites only what SDK 1.4's own open rewrote", async () => {
		const file = materialize(scenario, name);
		const before = rows(file);
		const versions = stored(file);
		const { harness } = await openHarness(file);
		try {
			const conversation = await harness.root(BACKGROUND_CONTEXT);
			await harness.snapshot(LiveDoc, conversation.id, BACKGROUND_CONTEXT);
			await harness.inspect(BACKGROUND_CONTEXT);
		} finally {
			await harness.close(BACKGROUND_CONTEXT);
		}
		const after = rows(file);
		const text = (table: unknown[] | undefined) =>
			JSON.stringify(table, (_key, value) => (typeof value === "bigint" ? `${value}n` : value));
		const changed = Object.keys(after).filter((table) => text(after[table]) !== text(before[table]));
		// The control is SDK 1.4 opening the same pristine file: a crash leaves recovery for any open to write.
		expect(changed).toEqual(scenario.rollback.pristineReopenedBy14.changedTables);
		expect(changed).not.toContain("documents");
		expect(changed).not.toContain("document_revisions");
		expect(stored(file)).toEqual({
			...versions,
			tasks: versions.tasks.map((task) => ({ ...task, status: expect.any(String) })),
		});
		// Generation receipt, on the same stored state: SDK 1.4 reopened such a file.
		expect(scenario.rollback.readOnly15).toEqual({ changedTables: changed, reopenedBy14: true });
	});

	it("rollback boundary: the first 1.5 write stores pi.live at version 3, the file SDK 1.4 refused at generation", async () => {
		const file = materialize(scenario, name);
		const { harness, reports, faux } = await openHarness(file);
		let live: Json | undefined;
		try {
			const conversation = await harness.root(BACKGROUND_CONTEXT);
			await conversation.abort(BACKGROUND_CONTEXT);
			live = (await harness.snapshot(LiveDoc, conversation.id, BACKGROUND_CONTEXT)) as Json | undefined;
			expect(tasksOf(await harness.inspect(BACKGROUND_CONTEXT))).toEqual([]);
		} finally {
			await harness.close(BACKGROUND_CONTEXT);
		}
		// An explicit abort ends the held run as aborted; the earlier refused compaction stays on record.
		const run = scenario.live14.run as Json;
		expect(live).toEqual({
			compactionFailure: as15(scenario.live14).compactionFailure,
			runFailure: { taskId: run.taskId, inputs: run.inputs, reason: "aborted" },
		});
		expect(reports).toEqual([]);
		expect(faux.state.callCount).toBe(0);

		const after = stored(file);
		expect(after.documents["pi.live"]).toEqual([VERSION_15["pi.live"]]);
		expect(after).toEqual(scenario.rollback.write15.storedAfter);
		// Generation receipt, on this stored state: SDK 1.4 opened the Harness and refused the first pi.live read with
		// its newer-version message for exactly this document and these two versions.
		const [version14] = scenario.stored.documents["pi.live"];
		expect(scenario.rollback.write15.reopenedBy14).toEqual({
			step: "snapshot",
			error: `Document ${liveDocumentId(file)} (pi.live) has newer version ${after.documents["pi.live"][0]} than ${version14}`,
		});
	});
});
