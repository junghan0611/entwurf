/**
 * pi-durable-storage-migration (#148 S1b) — a database SDK 1.3.0 wrote, opened by the root SDK.
 *
 * The carrier opens every durable session through `openNodeSqliteStorage` (pi/pi-durable/src/
 * experimental/durable/runtime.ts). SDK 1.4.0 migrates that storage from schema version 1 to 2 on open,
 * rebuilding the task table to admit the `sleeping` status. That a migrated file no longer opens under 1.3
 * is inherited from the 1.4.0 CHANGELOG and 1.3's own runner source, not certified here: CI never imports 1.3.
 * This file is the migration-only half of that contract: it never opens a Harness, so no task runs and
 * no row is replayed. What a Harness then does with the migrated tasks is a separate claim.
 *
 * The subject is the root SDK's storage open. The oracle is Node's own SQLite reading the file before
 * and after that open, against goldens SDK 1.3.0 wrote through its public API (fixtures/pi-durable-sdk13/:
 * two logical dumps, one per writer scenario, and a manifest holding their hashes). CI never installs or
 * imports SDK 1.3: each case restores a dump into a fresh database, so no trial opens a shared file.
 *
 * This is a conformance test of SDK-owned behavior against an independent SQLite oracle, not a new
 * Entwurf contract: Entwurf owns no line of the migration, so there is no local subject to mutate and no
 * kill-power claim here. It does not replace the SDK-pin and version-set coherence qualification, and it
 * says nothing about a Harness, an app resume or a rollback.
 */
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const FIXTURES = path.join(import.meta.dirname, "fixtures", "pi-durable-sdk13");
type Scenario = { file: string; sha256: string; schemaVersion: number; tasks: { kind: string; status: string }[] };
const manifest = JSON.parse(fs.readFileSync(path.join(FIXTURES, "golden.manifest.json"), "utf8")) as {
	sdk: { package: string; version: string };
	scenarios: Record<string, Scenario>;
};
const SCENARIOS = Object.entries(manifest.scenarios);
const TASK_INDEXES = [
	"tasks_by_abort_requested",
	"tasks_by_background",
	"tasks_by_conversation",
	"tasks_by_kind",
	"tasks_by_status",
];

/** The lowest task id in both goldens (the waiting parent). */
const FIRST_TASK = 7;
const sha256 = (data: string): string => createHash("sha256").update(data).digest("hex");

let root: string;
beforeEach(() => {
	root = fs.mkdtempSync(path.join(os.tmpdir(), "pi-durable-storage-migration-"));
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
function rows(db: DatabaseSync): Record<string, unknown[]> {
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
}

const schemaOf = (db: DatabaseSync) =>
	db
		.prepare("SELECT type, name, tbl_name, sql FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name")
		.all() as {
		type: string;
		name: string;
		tbl_name: string;
		sql: string;
	}[];
const versionOf = (db: DatabaseSync) =>
	(db.prepare("SELECT version FROM durable_schema WHERE singleton = 1").get() as { version: number }).version;

async function openAndClose(file: string): Promise<void> {
	const storage = await openNodeSqliteStorage(file);
	await storage.close(BACKGROUND_CONTEXT);
}

describe("SDK 1.3 goldens", () => {
	it("golden fixture: each dump is the bytes its manifest hashes, written by SDK 1.3.0 at schema version 1", () => {
		expect(manifest.sdk).toMatchObject({ package: "@earendil-works/pi-durable", version: "1.3.0" });
		expect(SCENARIOS.map(([name]) => name).sort()).toEqual(["close", "kill"]);
		for (const [name, scenario] of SCENARIOS) {
			expect(sha256(fs.readFileSync(path.join(FIXTURES, scenario.file), "utf8")), name).toBe(scenario.sha256);
			expect(scenario.schemaVersion, name).toBe(1);
			const file = materialize(scenario, `${name}-golden`);
			read(file, (db) => {
				expect(versionOf(db)).toBe(1);
				expect(db.prepare("SELECT kind, status FROM tasks ORDER BY id").all()).toEqual(scenario.tasks);
				expect(db.prepare("SELECT min(id) AS id FROM tasks").get()).toEqual({ id: FIRST_TASK });
				// The live statuses this migration has to carry: a join, an unrunnable kind, a cut-off leaf.
				expect(scenario.tasks.map((task) => task.status)).toEqual(["waiting", "pending", "running"]);
			});
		}
	});
});

describe.each(SCENARIOS)("root SDK storage open on the SDK 1.3 %s golden", (name, scenario) => {
	it("SDK conformance: moves the schema to version 2 and keeps every row and every other table", async () => {
		const file = materialize(scenario, name);
		const before = read(file, (db) => ({ rows: rows(db), schema: schemaOf(db), version: versionOf(db) }));
		expect(before.version).toBe(1);

		await openAndClose(file);

		const after = read(file, (db) => ({
			rows: rows(db),
			schema: schemaOf(db),
			version: versionOf(db),
			integrity: db.prepare("PRAGMA integrity_check").all(),
		}));
		expect(after.version).toBe(2);
		// Every table but the version row is unchanged row for row, the rebuilt task table included.
		const { durable_schema: schemaRowsBefore, ...dataBefore } = before.rows;
		const { durable_schema: schemaRowsAfter, ...dataAfter } = after.rows;
		expect(dataAfter).toEqual(dataBefore);
		expect(schemaRowsBefore).toEqual([{ singleton: 1n, version: 1n }]);
		expect(schemaRowsAfter).toEqual([{ singleton: 1n, version: 2n }]);
		expect(after.integrity).toEqual([{ integrity_check: "ok" }]);

		// Only the task table and its own indexes were rebuilt; no temporary table is left behind.
		const changed = after.schema.filter(
			(entry) => !before.schema.some((old) => old.name === entry.name && old.sql === entry.sql),
		);
		expect(changed.map((entry) => entry.name)).toEqual(["tasks"]);
		expect(after.schema.map((entry) => entry.name).sort()).toEqual(before.schema.map((entry) => entry.name).sort());
		expect(
			after.schema
				.filter((entry) => entry.type === "index" && entry.tbl_name === "tasks")
				.map((entry) => entry.name)
				.sort(),
		).toEqual(TASK_INDEXES);
	});

	it("SDK conformance: the golden's v1 task table refuses the sleeping status (the control for the case below)", () => {
		const db = new DatabaseSync(materialize(scenario, `${name}-v1`));
		try {
			expect(() => db.prepare(`UPDATE tasks SET status = 'sleeping' WHERE id = ${FIRST_TASK}`).run()).toThrow(
				/CHECK constraint failed/,
			);
		} finally {
			db.close();
		}
	});

	it("SDK conformance: the rebuilt task table admits sleeping and keeps every other constraint of the v1 table", async () => {
		const file = materialize(scenario, name);
		await openAndClose(file);
		const db = new DatabaseSync(file);
		const row = () => db.prepare(`SELECT * FROM tasks WHERE id = ${FIRST_TASK}`).get();
		try {
			const original = row();
			db.exec("BEGIN");
			db.prepare(`UPDATE tasks SET status = 'sleeping' WHERE id = ${FIRST_TASK}`).run();
			const sleeping = row();
			expect(sleeping).toEqual({ ...original, status: "sleeping" });
			// Each refusal is SQLite's own, read against no SDK source; after each one the transaction is still
			// open and the row is exactly what the admitted update left.
			const refused: [string, RegExp][] = [
				["status = 'dozing'", /CHECK constraint failed/],
				["abort_requested = 2", /CHECK constraint failed/],
				["background = 2", /CHECK constraint failed/],
				["background = 'a'", /cannot store TEXT value in INTEGER column/],
				["record = 'x'", /CHECK constraint failed/],
				["kind = NULL", /NOT NULL constraint failed/],
			];
			for (const [assignment, refusal] of refused) {
				expect(() => db.prepare(`UPDATE tasks SET ${assignment} WHERE id = ${FIRST_TASK}`).run(), assignment).toThrow(
					refusal,
				);
				expect(db.isTransaction, assignment).toBe(true);
				expect(row(), assignment).toEqual(sleeping);
			}
			db.exec("ROLLBACK");
			expect(row()).toEqual(original);
		} finally {
			db.close();
		}
	});

	it("SDK conformance: opening an already migrated file again changes no row and no schema", async () => {
		const file = materialize(scenario, name);
		await openAndClose(file);
		const once = read(file, (db) => ({ rows: rows(db), schema: schemaOf(db) }));
		await openAndClose(file);
		expect(read(file, (db) => ({ rows: rows(db), schema: schemaOf(db) }))).toEqual(once);
	});

	it("SDK conformance: a schema version newer than the SDK's is refused by name and leaves schema and rows as they were", async () => {
		const file = materialize(scenario, name);
		const db = new DatabaseSync(file);
		try {
			db.prepare("UPDATE durable_schema SET version = 3 WHERE singleton = 1").run();
		} finally {
			db.close();
		}
		const before = read(file, (reader) => ({ rows: rows(reader), schema: schemaOf(reader) }));

		await expect(openNodeSqliteStorage(file)).rejects.toThrow(
			// The 1.4 refusal comes from chord's migration runner, which dropped 1.3's "Durable " prefix.
			"SQLite schema version 3 is newer than supported version 2",
		);

		// Logical state only. chord's open sets `PRAGMA journal_mode = WAL` before it migrates, so even a refused
		// open may rewrite the file header; bytes, sidecars and whether the refused open releases its handle are
		// not certified here (the app's own release on failure is a separate, actual-runtime measurement).
		expect(read(file, (reader) => ({ rows: rows(reader), schema: schemaOf(reader) }))).toEqual(before);
	});
});
