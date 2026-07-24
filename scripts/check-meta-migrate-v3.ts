/**
 * check-meta-migrate-v3 — deterministic gate for the M1 operator command
 * (scripts/meta-bridge-migrate-v3.ts, #50 hard cut → H7 live cutover).
 *
 * NOT self-satisfying: every scenario drives the REAL CLI as a subprocess
 * (node --experimental-strip-types, the exact form run.sh dispatches from a dev
 * clone) over synthetic stores isolated via ENTWURF_META_SESSIONS_DIR /
 * ENTWURF_META_MAILBOX_DIR — the documented isolation seam. Fixture bodies are
 * hand-written JSON strings, so this gate needs NO import of the frozen legacy
 * readers (the meta-migration.ts allowlist stays two entries: the CLI + its
 * reader gate). Results are asserted with the PRODUCTION v3 reader
 * (parseMetaRecordV3) — acceptance by the very consumer the migration feeds.
 *
 * Covers the NEXT §6 fixture set + the disposition/rollback contract:
 *   - v1 → v3: field map (lastSeen→recordUpdatedAt, model null, delivery
 *     dropped) + receipts land in mailbox state (state-wins), byte-canonical
 *     output, backup keeps original bytes.
 *   - V3-already (mixed): v3 bytes untouched; re-run is a loud no-op that
 *     takes NO second backup (idempotence).
 *   - malformed / stray-key / half-migrated / body-filename drift / duplicate
 *     nativeSessionId: REFUSE with exit 1, the offending file named, ZERO
 *     writes, NO backup.
 *   - parentage disposition: non-null parentGardenId / isEntwurf=true refused
 *     without --drop-parentage; with the flag the drop is printed per file and
 *     the backup preserves the originals.
 *   - verify: pre-cut store fails AGGREGATED (×N, F8) naming the migrate verb
 *     and writes nothing; a migrated store certifies non-V3=0.
 *   - restore: store bytes return to the pre-migration originals, the current
 *     store survives as a `.pre-restore-` aside, the backup stays intact, and
 *     ONLY a real-directory timestamp sibling backup OF THIS store is accepted —
 *     a foreign look-alike, nested dir, forged suffix, or sibling symlink into a
 *     foreign tree is refused (a wrong path must never replace the authority).
 *   - backup completeness (S16/S17): the final backup name is claimed by an
 *     atomic rename AFTER the staged copy completes, so a mid-copy failure
 *     never leaves a half-backup under the trusted name; restore requires
 *     regular-file record entries and classifies the backup like a store
 *     (zero problems, ≥1 record) BEFORE the current store moves, and an
 *     uninspectable path names its real lstat cause.
 *   - prescriptions (R1): the pre-cut FAIL and the rollback line each name BOTH
 *     invocation forms — `./run.sh …` for a dev clone AND `entwurf …` for an
 *     installed package. The hosts that actually meet a pre-cut store are
 *     installed hosts where `./run.sh` is not typeable, and the rollback is
 *     printed at the one moment (mid-blackout) an untypeable command costs most.
 */

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { type MetaIdentity, parseMetaRecordV3, serializeMetaIdentity } from "../pi-extensions/lib/meta-session.ts";

const REPO = path.resolve(import.meta.dirname, "..");
const CLI = path.join(REPO, "scripts", "meta-bridge-migrate-v3.ts");

let passed = 0;
function ok(label: string, cond: boolean, detail = ""): void {
	assert.ok(cond, `${label}${detail ? `\n${detail}` : ""}`);
	console.log(`  ok    ${label}`);
	passed++;
}

interface CliResult {
	status: number;
	stdout: string;
	stderr: string;
}

function runCli(args: string[], env: { store: string; mailbox: string }): CliResult {
	const res = spawnSync(process.execPath, ["--experimental-strip-types", CLI, ...args], {
		cwd: REPO,
		encoding: "utf8",
		env: {
			...process.env,
			ENTWURF_META_SESSIONS_DIR: env.store,
			ENTWURF_META_MAILBOX_DIR: env.mailbox,
		},
	});
	if (res.error) throw res.error;
	return { status: res.status ?? -1, stdout: res.stdout, stderr: res.stderr };
}

const roots: string[] = [];
interface World {
	root: string;
	store: string;
	mailbox: string;
}

function makeWorld(files: Record<string, string>): World {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "entwurf-m1-gate-"));
	roots.push(root);
	const store = path.join(root, "store");
	const mailbox = path.join(root, "mailbox");
	fs.mkdirSync(store, { recursive: true });
	fs.mkdirSync(mailbox, { recursive: true });
	for (const [name, body] of Object.entries(files)) fs.writeFileSync(path.join(store, name), body);
	return { root, store, mailbox };
}

function backups(w: World): string[] {
	return fs.readdirSync(w.root).filter((n) => n.startsWith("store.v3-migration-backup-"));
}

function storeBytes(w: World): Map<string, string> {
	const map = new Map<string, string>();
	for (const f of fs.readdirSync(w.store).sort()) map.set(f, fs.readFileSync(path.join(w.store, f), "utf8"));
	return map;
}

// ── fixtures (synthetic paths; garden ids obey the SSOT grammar) ─────────────

const V1_GID = "20260101T000000-aaaa01";
const V1_BODY = JSON.stringify({
	schemaVersion: 1,
	gardenId: V1_GID,
	backend: "claude-code",
	nativeSessionId: "native-v1-0001",
	transcriptPath: "/synthetic/p1/transcript.jsonl",
	cwd: "/synthetic/p1",
	createdAt: "2026-01-01T00:00:00.000Z",
	lastSeen: "2026-01-02T03:04:05.000Z",
	delivery: {
		wakeMode: "self-fetch",
		deliveryLevel: "D6",
		lastEnqueuedAt: null,
		lastDeliveredAt: "2026-01-02T03:00:00.000Z",
		lastReadAt: "2026-01-02T03:04:05.000Z",
	},
});

const V2_GID = "20260302T000000-bbbb02";
function v2Body(overrides: Record<string, unknown> = {}): string {
	return JSON.stringify({
		schemaVersion: 2,
		gardenId: V2_GID,
		backend: "claude-code",
		nativeSessionId: "native-v2-0002",
		cwd: "/synthetic/p2",
		model: "claude-opus-4",
		transcriptPath: null,
		parentGardenId: null,
		isEntwurf: false,
		createdAt: "2026-03-02T00:00:00.000Z",
		recordUpdatedAt: "2026-03-02T01:00:00.000Z",
		...overrides,
	});
}

const V3_GID = "20260401T000000-cccc03";
const V3_IDENTITY: MetaIdentity = {
	schemaVersion: 3,
	gardenId: V3_GID,
	backend: "pi",
	nativeSessionId: "native-v3-0003",
	cwd: "/synthetic/p3",
	model: null,
	transcriptPath: null,
	createdAt: "2026-04-01T00:00:00.000Z",
	recordUpdatedAt: "2026-04-01T00:00:00.000Z",
};
const V3_BODY = serializeMetaIdentity(V3_IDENTITY);

// ── S0: absent store — loud no-op both verbs, nothing created ────────────────
{
	const w = makeWorld({});
	const absent = path.join(w.root, "absent-store");
	const env = { store: absent, mailbox: w.mailbox };
	const mig = runCli(["migrate"], env);
	ok(
		"S0 migrate on an absent store exits 0 as a loud no-op",
		mig.status === 0 && mig.stdout.includes("nothing to migrate"),
		mig.stdout + mig.stderr,
	);
	ok("S0 the no-op creates neither the store dir nor a backup", !fs.existsSync(absent) && backups(w).length === 0);
	const ver = runCli(["verify"], env);
	ok(
		"S0 verify on an absent store certifies vacuously (non-V3=0)",
		ver.status === 0 && ver.stdout.includes("non-V3=0"),
		ver.stdout + ver.stderr,
	);
}

// ── S1: v1 → v3 — field map, receipts to mailbox state, backup bytes ─────────
const s1 = makeWorld({ [`${V1_GID}.meta.json`]: V1_BODY });
{
	const env = { store: s1.store, mailbox: s1.mailbox };
	const mig = runCli(["migrate"], env);
	ok("S1 migrate exits 0 on a v1-only store", mig.status === 0, mig.stdout + mig.stderr);
	ok("S1 summary reports v1→v3 1", mig.stdout.includes("migrated: v1→v3 1, v2→v3 0"), mig.stdout);
	const migrated = fs.readFileSync(path.join(s1.store, `${V1_GID}.meta.json`), "utf8");
	const id = parseMetaRecordV3(migrated);
	ok(
		"S1 the migrated record satisfies the PRODUCTION v3 reader with the mapped fields",
		id.gardenId === V1_GID &&
			id.backend === "claude-code" &&
			id.nativeSessionId === "native-v1-0001" &&
			id.model === null &&
			id.transcriptPath === "/synthetic/p1/transcript.jsonl" &&
			id.recordUpdatedAt === "2026-01-02T03:04:05.000Z",
	);
	ok("S1 the migrated bytes are the canonical v3 serialization", migrated === serializeMetaIdentity(id));
	const state = JSON.parse(fs.readFileSync(path.join(s1.mailbox, V1_GID, "state.json"), "utf8"));
	ok(
		"S1 v1 delivery receipts migrated into mailbox state (state-wins fill)",
		state.lastReadAt === "2026-01-02T03:04:05.000Z" &&
			state.lastDeliveredAt === "2026-01-02T03:00:00.000Z" &&
			state.lastEnqueuedAt === null,
	);
	const b = backups(s1);
	ok("S1 exactly one backup dir was taken", b.length === 1, b.join(", "));
	ok(
		"S1 the backup preserves the ORIGINAL v1 bytes",
		fs.readFileSync(path.join(s1.root, b[0] as string, `${V1_GID}.meta.json`), "utf8") === V1_BODY,
	);
}

// ── S2/S3: mixed store — v3 bytes untouched; re-run no-op takes no backup ────
{
	const w = makeWorld({
		[`${V3_GID}.meta.json`]: V3_BODY,
		[`${V2_GID}.meta.json`]: v2Body(),
	});
	const env = { store: w.store, mailbox: w.mailbox };
	const mig = runCli(["migrate"], env);
	ok("S2 migrate exits 0 on a mixed (V3-already) store", mig.status === 0, mig.stdout + mig.stderr);
	ok(
		"S2 the pre-existing v3 record is byte-untouched",
		fs.readFileSync(path.join(w.store, `${V3_GID}.meta.json`), "utf8") === V3_BODY,
	);
	const v2Migrated = parseMetaRecordV3(fs.readFileSync(path.join(w.store, `${V2_GID}.meta.json`), "utf8"));
	ok(
		"S2 the v2 record migrated keeping its identity axes",
		v2Migrated.gardenId === V2_GID &&
			v2Migrated.model === "claude-opus-4" &&
			v2Migrated.recordUpdatedAt === "2026-03-02T01:00:00.000Z",
	);
	ok("S2 one backup dir exists after the first run", backups(w).length === 1);
	const rerun = runCli(["migrate"], env);
	ok(
		"S3 re-run is a loud no-op (idempotence)",
		rerun.status === 0 && rerun.stdout.includes("nothing to migrate"),
		rerun.stdout,
	);
	ok("S3 the no-op re-run took NO second backup", backups(w).length === 1);
}

// ── S4–S7 + S11: refusal preflight — exit 1, named file, zero writes ─────────
{
	const refusals: { name: string; files: Record<string, string>; needle: string }[] = [
		{
			name: "S4 malformed JSON",
			files: { "20260305T000000-eeee05.meta.json": "{ not json", [`${V2_GID}.meta.json`]: v2Body() },
			needle: "not valid JSON",
		},
		{
			name: "S5 stray key",
			files: {
				"20260305T000000-eeee05.meta.json": v2Body({ gardenId: "20260305T000000-eeee05", tmuxTarget: "psa:1.1" }),
			},
			needle: '"tmuxTarget"',
		},
		{
			name: "S6 half-migrated (stale v1 field on v2)",
			files: {
				"20260306T000000-ffff06.meta.json": v2Body({
					gardenId: "20260306T000000-ffff06",
					lastSeen: "2026-03-06T00:00:00.000Z",
				}),
			},
			needle: '"lastSeen"',
		},
		{
			name: "S7 body/filename drift",
			files: { "20260399T000000-abcd99.meta.json": v2Body({ gardenId: "20260307T000000-abcd07" }) },
			needle: "body/filename drift",
		},
		{
			name: "S11 duplicate nativeSessionId",
			files: {
				"20260308T000000-dddd08.meta.json": v2Body({
					gardenId: "20260308T000000-dddd08",
					nativeSessionId: "native-dup",
				}),
				"20260309T000000-dddd09.meta.json": v2Body({
					gardenId: "20260309T000000-dddd09",
					nativeSessionId: "native-dup",
				}),
			},
			needle: "duplicate nativeSessionId",
		},
	];
	for (const r of refusals) {
		const w = makeWorld(r.files);
		const env = { store: w.store, mailbox: w.mailbox };
		const before = storeBytes(w);
		const mig = runCli(["migrate"], env);
		ok(
			`${r.name}: migrate refuses with exit 1 naming the cause`,
			mig.status === 1 && mig.stderr.includes(r.needle),
			mig.stdout + mig.stderr,
		);
		ok(`${r.name}: the refusal says no backup was taken`, mig.stderr.includes("no backup taken"), mig.stderr);
		ok(
			`${r.name}: zero writes — every store file byte-identical, no backup dir`,
			backups(w).length === 0 &&
				[...before].every(([f, bytes]) => fs.readFileSync(path.join(w.store, f), "utf8") === bytes),
		);
	}
}

// ── S13 (M3): an unreadable entry is a problem, never an uncaught crash ──────
{
	const DIR_ENTRY = "20260312T000000-eeee12.meta.json";
	const w = makeWorld({ [`${V2_GID}.meta.json`]: v2Body() });
	fs.mkdirSync(path.join(w.store, DIR_ENTRY));
	const env = { store: w.store, mailbox: w.mailbox };
	const mig = runCli(["migrate"], env);
	ok(
		"S13 a directory-shaped .meta.json is classified `unreadable` and refused (no uncaught crash)",
		mig.status === 1 &&
			mig.stderr.includes("unreadable") &&
			mig.stderr.includes(DIR_ENTRY) &&
			mig.stderr.includes("no backup taken"),
		mig.stdout + mig.stderr,
	);
	ok(
		"S13 the refusal wrote nothing (v2 sibling byte-identical, no backup dir)",
		backups(w).length === 0 && fs.readFileSync(path.join(w.store, `${V2_GID}.meta.json`), "utf8") === v2Body(),
	);
	const ver = runCli(["verify"], env);
	ok(
		"S13 verify reports the same unreadable entry read-only",
		ver.status === 1 && ver.stderr.includes("unreadable") && ver.stderr.includes(DIR_ENTRY),
		ver.stdout + ver.stderr,
	);
}

// ── S14 (M2): a crash AFTER the backup prints the rollback prescription ──────
{
	const w = makeWorld({ [`${V1_GID}.meta.json`]: V1_BODY });
	// Plant the citizen's mailbox path as a regular FILE: the receipts migration's
	// mkdir fails AFTER the backup was taken — the exact window M2 covers. A file
	// blocker (not chmod) so the scenario holds even when the gate runs as root.
	fs.writeFileSync(path.join(w.mailbox, V1_GID), "not a directory");
	const env = { store: w.store, mailbox: w.mailbox };
	const mig = runCli(["migrate"], env);
	const b = backups(w);
	ok(
		"S14 a mid-write crash exits 1 and prints the restore prescription with the backup path",
		mig.status === 1 &&
			b.length === 1 &&
			mig.stderr.includes("FAIL mid-migration") &&
			mig.stderr.includes(`restore ${path.join(w.root, b[0] as string)}`),
		mig.stdout + mig.stderr,
	);
	ok(
		"S14 the prescription never swallows the cause (the fs error is still printed)",
		mig.stderr.includes("EEXIST") || mig.stderr.includes("ENOTDIR"),
		mig.stderr,
	);
	// R1: THIS command is the one an installed host runs (that is why the compiled
	// twin ships) — a rollback it cannot type is the M4 defect one level down.
	ok(
		"S14 the rollback prescription names BOTH invocation forms with the concrete backup path",
		mig.stderr.includes(`./run.sh meta-bridge-migrate-v3 restore ${path.join(w.root, b[0] as string)}`) &&
			mig.stderr.includes(`entwurf meta-bridge-migrate-v3 restore ${path.join(w.root, b[0] as string)}`),
		mig.stderr,
	);
	ok(
		"S14 crash-order held: the record is still v1 (receipts migrate before the record write)",
		fs.readFileSync(path.join(w.store, `${V1_GID}.meta.json`), "utf8") === V1_BODY,
	);
	// The printed prescription actually works: clear the blocker, restore, re-run.
	fs.rmSync(path.join(w.mailbox, V1_GID));
	const backupA = path.join(w.root, b[0] as string);
	const res = runCli(["restore", backupA], env);
	ok("S14 the prescribed restore succeeds once the cause is cleared", res.status === 0, res.stdout + res.stderr);
	// Drop the consumed backup before the re-run: stamp() has second resolution,
	// and a same-second re-run must not trip the backup-exists refusal.
	fs.rmSync(backupA, { recursive: true, force: true });
	const rerun = runCli(["migrate"], env);
	ok(
		"S14 the re-run completes the interrupted migration (v1→v3 1)",
		rerun.status === 0 && rerun.stdout.includes("v1→v3 1"),
		rerun.stdout + rerun.stderr,
	);
}

// ── S8: parentage disposition — refuse without the flag, loud drop with it ───
{
	const P1 = "20260310T000000-aaaa10";
	const P2 = "20260311T000000-bbbb11";
	const files = {
		[`${P1}.meta.json`]: v2Body({ gardenId: P1, nativeSessionId: "native-p1", parentGardenId: V1_GID }),
		[`${P2}.meta.json`]: v2Body({ gardenId: P2, nativeSessionId: "native-p2", isEntwurf: true }),
		[`${V2_GID}.meta.json`]: v2Body(),
	};
	const w = makeWorld(files);
	const env = { store: w.store, mailbox: w.mailbox };
	const before = storeBytes(w);
	const preVerify = runCli(["verify"], env);
	ok(
		"S8 verify pre-announces the parentage disposition (read-only probe names --drop-parentage)",
		preVerify.status === 1 &&
			preVerify.stderr.includes("2 v2 record(s) carry a non-null parentGardenId / isEntwurf=true") &&
			preVerify.stderr.includes("--drop-parentage"),
		preVerify.stdout + preVerify.stderr,
	);
	const refused = runCli(["migrate"], env);
	ok(
		"S8 non-null parentGardenId / isEntwurf=true refused without --drop-parentage, naming both files",
		refused.status === 1 && refused.stderr.includes(`${P1}.meta.json`) && refused.stderr.includes(`${P2}.meta.json`),
		refused.stdout + refused.stderr,
	);
	ok(
		"S8 the refusal names the dropped values and prescribes the flag",
		refused.stderr.includes(`parentGardenId="${V1_GID}"`) &&
			refused.stderr.includes("isEntwurf=true") &&
			refused.stderr.includes("--drop-parentage"),
		refused.stderr,
	);
	ok(
		"S8 the refusal wrote nothing (plain v2 sibling included), no backup",
		backups(w).length === 0 &&
			[...before].every(([f, bytes]) => fs.readFileSync(path.join(w.store, f), "utf8") === bytes),
	);
	const dropped = runCli(["migrate", "--drop-parentage"], env);
	ok(
		"S8 with --drop-parentage the migration completes",
		dropped.status === 0 && dropped.stdout.includes("v2→v3 3"),
		dropped.stdout + dropped.stderr,
	);
	ok(
		"S8 each dropped value is printed per file",
		dropped.stdout.includes(`dropped ${P1}.meta.json: parentGardenId="${V1_GID}"`) &&
			dropped.stdout.includes(`dropped ${P2}.meta.json:`),
		dropped.stdout,
	);
	ok(
		"S8 all three records now satisfy the production v3 reader",
		[P1, P2, V2_GID].every(
			(g) => parseMetaRecordV3(fs.readFileSync(path.join(w.store, `${g}.meta.json`), "utf8")).gardenId === g,
		),
	);
	const b = backups(w);
	ok(
		"S8 the backup preserves the original parentage-bearing bytes",
		b.length === 1 &&
			fs.readFileSync(path.join(w.root, b[0] as string, `${P1}.meta.json`), "utf8") === files[`${P1}.meta.json`],
	);
}

// ── S9: verify — aggregated pre-cut failure, zero writes; certifies after ────
{
	const w = makeWorld({
		[`${V1_GID}.meta.json`]: V1_BODY,
		[`${V2_GID}.meta.json`]: v2Body(),
		[`${V3_GID}.meta.json`]: V3_BODY,
	});
	const env = { store: w.store, mailbox: w.mailbox };
	const before = storeBytes(w);
	const ver = runCli(["verify"], env);
	ok(
		"S9 verify fails a pre-cut store with AGGREGATED counts naming the migrate verb",
		ver.status === 1 &&
			ver.stderr.includes("v1 record ×1") &&
			ver.stderr.includes("v2 record ×1") &&
			ver.stderr.includes("meta-bridge-migrate-v3 migrate"),
		ver.stdout + ver.stderr,
	);
	ok(
		"S9 a store without parentage values gets NO --drop-parentage note (the probe never cries wolf)",
		!ver.stderr.includes("--drop-parentage"),
		ver.stderr,
	);
	// R1: the host that meets a pre-cut store is an INSTALLED host with no
	// checkout — a `./run.sh …`-only prescription is not typeable there.
	ok(
		"S9 the pre-cut FAIL names BOTH invocation forms (dev clone + installed package)",
		ver.stderr.includes("./run.sh meta-bridge-migrate-v3 migrate") &&
			ver.stderr.includes("entwurf meta-bridge-migrate-v3 migrate"),
		ver.stderr,
	);
	ok(
		"S9 verify is read-only (bytes identical, no backup)",
		backups(w).length === 0 &&
			[...before].every(([f, bytes]) => fs.readFileSync(path.join(w.store, f), "utf8") === bytes),
	);
	const mig = runCli(["migrate"], env);
	ok("S9 migrate over the same store exits 0", mig.status === 0, mig.stdout + mig.stderr);
	const after = runCli(["verify"], env);
	ok(
		"S9 verify certifies the migrated store (non-V3=0)",
		after.status === 0 && after.stdout.includes("3 v3 record(s), non-V3=0"),
		after.stdout + after.stderr,
	);
}

// ── S10: restore — pre-migration bytes return; aside + backup both survive ───
{
	const b = backups(s1);
	const backupDir = path.join(s1.root, b[0] as string);
	const env = { store: s1.store, mailbox: s1.mailbox };
	const migratedBytes = fs.readFileSync(path.join(s1.store, `${V1_GID}.meta.json`), "utf8");
	const res = runCli(["restore", backupDir], env);
	ok("S10 restore exits 0", res.status === 0, res.stdout + res.stderr);
	ok(
		"S10 the store returned to the pre-migration original bytes",
		fs.readFileSync(path.join(s1.store, `${V1_GID}.meta.json`), "utf8") === V1_BODY,
	);
	const aside = fs.readdirSync(s1.root).filter((n) => n.startsWith("store.pre-restore-"));
	ok(
		"S10 the replaced (migrated) store survives as a .pre-restore- aside",
		aside.length === 1 &&
			fs.readFileSync(path.join(s1.root, aside[0] as string, `${V1_GID}.meta.json`), "utf8") === migratedBytes,
	);
	ok("S10 the backup stays intact after restore", fs.existsSync(path.join(backupDir, `${V1_GID}.meta.json`)));
	const missing = runCli(["restore", path.join(s1.root, "no-such-backup")], env);
	ok("S10 restore refuses a nonexistent backup dir", missing.status === 1, missing.stderr);
	const notBackup = runCli(["restore", s1.mailbox], env);
	ok(
		"S10 restore refuses a dir that is not this store's backup",
		notBackup.status === 1 && notBackup.stderr.includes("not a backup OF THIS store"),
		notBackup.stderr,
	);
}

// ── S15: restore is a REAL SIBLING backup — no foreign/nested/symlink ────────
// A name is not provenance. The leaf must be a real directory (not a symlink),
// be the sibling of THIS store, and carry the exact timestamp grammar stamp()
// emits. Otherwise a plausible path could replace the address authority with an
// unrelated tree mid-blackout.
{
	const w = makeWorld({ [`${V3_GID}.meta.json`]: V3_BODY });
	const env = { store: w.store, mailbox: w.mailbox };
	const storeBefore = storeBytes(w);

	// (a) a foreign look-alike: the name mimics a backup but it is NOT a sibling of
	//     THIS store — the exact `foreign.v3-migration-backup-<x>` GPT reproduced.
	const foreign = path.join(w.root, "foreign.v3-migration-backup-forged");
	fs.mkdirSync(foreign);
	fs.writeFileSync(
		path.join(foreign, "20260909T000000-fake09.meta.json"),
		V3_BODY.replace(V3_GID, "20260909T000000-fake09"),
	);
	const rf = runCli(["restore", foreign], env);
	ok(
		"S15 a foreign look-alike backup is refused (not this store's sibling)",
		rf.status === 1 && rf.stderr.includes("not a backup OF THIS store"),
		rf.stdout + rf.stderr,
	);

	// (b) a dir nested one level inside a correctly-named sibling backup.
	const realSibling = `${w.store}.v3-migration-backup-20260101T000000`;
	fs.mkdirSync(path.join(realSibling, "inner"), { recursive: true });
	const rn = runCli(["restore", path.join(realSibling, "inner")], env);
	ok(
		"S15 a dir nested inside a real backup is refused (one path segment only)",
		rn.status === 1 && rn.stderr.includes("not a backup OF THIS store"),
		rn.stdout + rn.stderr,
	);

	// (c) a sibling with the right prefix but a suffix stamp() never emits.
	const forgedSuffix = `${w.store}.v3-migration-backup-forged`;
	fs.mkdirSync(forgedSuffix);
	const rfs = runCli(["restore", forgedSuffix], env);
	ok(
		"S15 a sibling with a forged non-timestamp suffix is refused",
		rfs.status === 1 && rfs.stderr.includes("not a backup OF THIS store"),
		rfs.stdout + rfs.stderr,
	);

	// (d) the exact sibling+timestamp spelling is still not enough when its leaf is
	//     a symlink into the foreign tree. statSync followed this and reproduced the
	//     original authority replacement under a more convincing name.
	const symlinkSibling = `${w.store}.v3-migration-backup-20260101T000001`;
	fs.symlinkSync(foreign, symlinkSibling, "dir");
	const rsl = runCli(["restore", symlinkSibling], env);
	ok(
		"S15 a timestamp-shaped sibling symlink to a foreign tree is refused",
		rsl.status === 1 && rsl.stderr.includes("symlinks refused"),
		rsl.stdout + rsl.stderr,
	);

	ok(
		"S15 all four refusals wrote nothing — the store is byte-untouched, no aside taken",
		fs.readdirSync(w.root).every((n) => !n.startsWith("store.pre-restore-")) &&
			[...storeBefore].every(([f, bytes]) => fs.readFileSync(path.join(w.store, f), "utf8") === bytes),
	);

	// (e) the genuine real-directory sibling, filled to match its name, IS accepted
	//     — the guard admits the actual M1 shape, not just rejects the fakes.
	fs.writeFileSync(path.join(realSibling, `${V3_GID}.meta.json`), V3_BODY);
	const rok = runCli(["restore", realSibling], env);
	ok(
		"S15 the genuine real-directory timestamp sibling of THIS store is accepted",
		rok.status === 0 && rok.stdout.includes("restored:"),
		rok.stdout + rok.stderr,
	);
}

// ── S16: the backup NAME is provenance, its CONTENT must classify clean ──────
// GPT follow-up reproduction: a valid-name backup holding a malformed record
// restored with rc=0 and made that record the address authority. Restore now
// classifies the backup exactly as migrate classifies a store BEFORE the
// current store moves — zero problems, at least one record (v1/v2/v3 all
// legitimate: an M1 backup holds pre-cut bytes).
{
	const w = makeWorld({ [`${V3_GID}.meta.json`]: V3_BODY });
	const env = { store: w.store, mailbox: w.mailbox };
	const storeBefore = storeBytes(w);

	// (a) a malformed record under a perfect sibling+timestamp name
	const broken = `${w.store}.v3-migration-backup-20260102T000000`;
	fs.mkdirSync(broken);
	fs.writeFileSync(path.join(broken, "broken.meta.json"), "{ not json");
	const rb = runCli(["restore", broken], env);
	ok(
		"S16 a valid-name backup with a malformed record is refused naming the problem",
		rb.status === 1 && rb.stderr.includes("not valid JSON") && rb.stderr.includes("NOT touched"),
		rb.stdout + rb.stderr,
	);

	// (b) an empty dir under the backup name — migrate never takes an empty backup
	const empty = `${w.store}.v3-migration-backup-20260103T000000`;
	fs.mkdirSync(empty);
	const re = runCli(["restore", empty], env);
	ok(
		"S16 an empty dir under the backup name is refused (an M1 backup is never empty)",
		re.status === 1 && re.stderr.includes("no meta-record"),
		re.stdout + re.stderr,
	);

	// (c) body/filename drift inside the backup — same classifier, same refusal
	const drifted = `${w.store}.v3-migration-backup-20260104T000000`;
	fs.mkdirSync(drifted);
	fs.writeFileSync(path.join(drifted, "20260909T000000-fake09.meta.json"), V3_BODY);
	const rd = runCli(["restore", drifted], env);
	ok(
		"S16 a drifted record inside the backup is refused (classified like a store)",
		rd.status === 1 && rd.stderr.includes("body/filename drift"),
		rd.stdout + rd.stderr,
	);

	ok(
		"S16 every content refusal left the store byte-untouched with no aside",
		fs.readdirSync(w.root).every((n) => !n.startsWith("store.pre-restore-")) &&
			[...storeBefore].every(([f, bytes]) => fs.readFileSync(path.join(w.store, f), "utf8") === bytes),
	);

	// (d) an uninspectable path names the REAL cause — ENOTDIR is not "does not
	//     exist", and mid-blackout the operator steers by this line.
	const plainFile = path.join(w.root, "plain-file");
	fs.writeFileSync(plainFile, "x");
	const rl = runCli(["restore", path.join(plainFile, "child")], env);
	ok(
		"S16 an uninspectable backup path carries the real lstat cause (ENOTDIR)",
		rl.status === 1 && rl.stderr.includes("cannot inspect backup path") && rl.stderr.includes("ENOTDIR"),
		rl.stdout + rl.stderr,
	);

	// (e) a symlink RECORD inside a perfect-name backup is refused: classify
	//     reads THROUGH the link (it would validate the target's bytes) while
	//     the copy lands the link itself — the authority would dangle on a
	//     foreign path. migrate authors only regular files; the shape refuses.
	const linked = `${w.store}.v3-migration-backup-20260105T000000`;
	fs.mkdirSync(linked);
	const linkTarget = path.join(w.root, "elsewhere.json");
	fs.writeFileSync(linkTarget, V3_BODY);
	fs.symlinkSync(linkTarget, path.join(linked, `${V3_GID}.meta.json`));
	const rlk = runCli(["restore", linked], env);
	ok(
		"S16 a symlink record inside a perfect-name backup is refused (regular files only)",
		rlk.status === 1 &&
			rlk.stderr.includes("non-regular-file record entry") &&
			rlk.stderr.includes(`${V3_GID}.meta.json`) &&
			fs.readFileSync(path.join(w.store, `${V3_GID}.meta.json`), "utf8") === V3_BODY &&
			fs.readdirSync(w.root).every((n) => !n.startsWith("store.pre-restore-")),
		rlk.stdout + rlk.stderr,
	);
}

// ── S17: a backup copy that cannot complete never claims the final name ──────
// The copy lands in a `.partial-<pid>` staging leaf and only an atomic rename
// claims `<store>.v3-migration-backup-<ts>` — so the final name existing MEANS
// the backup completed. The failure is forced root-proof via Linux PATH_MAX:
// the store's own paths stay fully readable/writable, but the longer staging
// sibling's inner paths overflow 4096, so the copy dies exactly mid-backup.
{
	const w = makeWorld({});
	let parent = w.root;
	while (parent.length + 201 <= 4024) parent = path.join(parent, "d".repeat(200));
	const pad = 4024 - parent.length - 1;
	if (pad > 0) parent = path.join(parent, "d".repeat(pad));
	const deepStore = path.join(parent, "store");
	fs.mkdirSync(deepStore, { recursive: true });
	fs.writeFileSync(path.join(deepStore, `${V2_GID}.meta.json`), v2Body());
	const env = { store: deepStore, mailbox: w.mailbox };
	const mig = runCli(["migrate"], env);
	ok(
		"S17 a mid-copy backup failure refuses loudly with the cause (no uncaught crash)",
		mig.status === 1 && mig.stderr.includes("ENAMETOOLONG") && mig.stderr.includes("complete backup"),
		mig.stdout + mig.stderr,
	);
	const finalNamed = fs.readdirSync(parent).filter((n) => /^store\.v3-migration-backup-\d{8}T\d{6}$/.test(n));
	ok(
		"S17 no final-name backup exists after the failure (staging never got renamed)",
		finalNamed.length === 0,
		fs.readdirSync(parent).join(", "),
	);
	ok(
		"S17 the store is byte-untouched (the copy failed BEFORE any record rewrite)",
		fs.readFileSync(path.join(deepStore, `${V2_GID}.meta.json`), "utf8") === v2Body(),
	);

	// A staging leaf a hard crash could leave behind is refused by the restore
	// grammar — its tail is `<ts>.partial-<pid>`, not the exact timestamp.
	const leftover = `${deepStore}.v3-migration-backup-20260101T000000.partial-99999`;
	fs.mkdirSync(leftover);
	const rs = runCli(["restore", leftover], env);
	ok(
		"S17 a leftover staging leaf is refused by restore (not a final-name backup)",
		rs.status === 1 && rs.stderr.includes("not a backup OF THIS store"),
		rs.stdout + rs.stderr,
	);
}

// ── S12: argv contract ───────────────────────────────────────────────────────
{
	const w = makeWorld({});
	const env = { store: w.store, mailbox: w.mailbox };
	ok("S12 no verb → usage exit 2", runCli([], env).status === 2);
	ok("S12 unknown verb → usage exit 2", runCli(["prune"], env).status === 2);
	ok("S12 unknown migrate flag → usage exit 2", runCli(["migrate", "--force"], env).status === 2);
	ok("S12 restore without a backup dir → usage exit 2", runCli(["restore"], env).status === 2);
}

for (const root of roots) fs.rmSync(root, { recursive: true, force: true });
console.log(`[check-meta-migrate-v3] ${passed} assertions ok`);
