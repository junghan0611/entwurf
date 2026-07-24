#!/usr/bin/env node
/**
 * meta-bridge-migrate-v3 — the M1 one-shot schema-migration OPERATOR command
 * (#50 hard cut, LOCKED PROTOCOL 7). Every V3-only rejection surface (parse,
 * birth, peers, self, v2, inbox, store-doctor) names this verb as the fix; this
 * file is where that name stops being a forward reference.
 *
 * Three verbs, one authority order:
 *   migrate [--drop-parentage]
 *     classify → REFUSE before any write on a store outside the record-entry
 *     domain (non-regular-file entry / malformed / stray-key / half-migrated /
 *     body-filename drift / duplicate nativeSessionId) → backup the WHOLE
 *     store dir to a sibling
 *     `<store>.v3-migration-backup-<ts>/` (staged copy + atomic rename — the
 *     final name exists only once the copy COMPLETED; a failed copy leaves at
 *     most a `.partial-` leaf the restore grammar refuses) → rewrite every
 *     v1/v2 record as v3 (atomic tmp+rename per file) → re-verify from disk
 *     (non-V3=0). Idempotent: a v3-only store is a loud no-op, NO backup.
 *   verify
 *     read-only certification: exit 0 iff every `.meta.json` parses as strict
 *     v3, agrees with its filename, and no nativeSessionId is claimed twice.
 *     Pre-cut records fail as an AGGREGATED count (F8: never 181 identical
 *     lines), naming the migrate verb.
 *   restore <backup-dir>
 *     rollback: move the current store aside to `<store>.pre-restore-<ts>/`
 *     (nothing is destroyed), then copy the M1 backup back. Only a real
 *     directory that is a SIBLING backup OF THIS store is accepted — exactly
 *     `<resolved-store>.v3-migration-backup-<YYYYMMDDTHHMMSS>` (one path segment,
 *     never a symlink); a foreign, nested, forged-suffix, or look-alike is refused,
 *     because copying an
 *     unrelated tree over the address authority is a manual `cp`, not a verb.
 *     The name alone is still not enough: the backup must CLASSIFY clean under
 *     the ONE record-entry domain classifyStore holds for every verb (regular
 *     files only, fully readable, zero problems, ≥1 record — v1/v2/v3 all
 *     legitimate) before the current store moves; a perfect name over
 *     unreadable, linked, or empty bytes is refused, store untouched. The
 *     shared domain is the invariant: migrate accepted ⇒ the backup migrate
 *     printed is a backup restore accepts.
 *     Scope is the
 *     STORE only: mailbox receipt state is deliberately NOT rolled back — the
 *     v1 receipt migration is state-wins and idempotent, so a post-restore
 *     re-run refills the same null fields and never overwrites a value.
 *
 * Field mapping (information-preserving; the backup keeps original bytes):
 *   v1 → v3: delivery receipts migrate FIRST into mailbox state
 *     (migrateV1DeliveryReceipts, state-wins — crash between the two leaves the
 *     record v1 and the re-run re-migrates, so no receipt is lost), then
 *     `lastSeen` → `recordUpdatedAt`, `model` → null, `delivery{}` dropped.
 *   v2 → v3: `parentGardenId` + `isEntwurf` dropped. A NON-NULL parentGardenId
 *     or isEntwurf=true is a value the operator must consciously discard (#50:
 *     Call ≠ parentage, no species boolean — LOCKED PROTOCOL 5/6): migrate
 *     REFUSES it before any write unless `--drop-parentage` is passed, and with
 *     the flag it prints every dropped value per file.
 *
 * Store resolution is env+default only (defaultMetaSessionsDir /
 * defaultMetaMailboxDir) — no dir argv. The runbook targets THE live store;
 * gates isolate via ENTWURF_META_SESSIONS_DIR / ENTWURF_META_MAILBOX_DIR, the
 * documented isolation seam ("격리는 store에").
 *
 * This is one of the two allowlisted importers of the frozen legacy readers
 * (check-meta-migration-readers gate e) — the single door back into v3
 * production for a pre-cut record.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import {
	type MetaIdentityV2,
	type MetaRecord,
	parseMetaRecordV1,
	parseMetaRecordV2,
} from "../pi-extensions/lib/meta-migration.ts";
import {
	defaultMetaMailboxDir,
	defaultMetaSessionsDir,
	describe,
	M1_MIGRATE_COMMAND,
	M1_MIGRATE_COMMAND_INSTALLED,
	M1_PRESCRIPTION,
	type MetaIdentity,
	migrateV1DeliveryReceipts,
	parseMetaRecordV3,
	serializeMetaIdentity,
} from "../pi-extensions/lib/meta-session.ts";

/** The restore verb spelled from each migrate SSOT — the two invocation forms of the rollback. */
const M1_RESTORE_COMMAND = `${M1_MIGRATE_COMMAND.replace(/ migrate$/, "")} restore`;
const M1_RESTORE_COMMAND_INSTALLED = `${M1_MIGRATE_COMMAND_INSTALLED.replace(/ migrate$/, "")} restore`;

/**
 * The rollback prescription for a concrete backup dir, naming BOTH invocation
 * forms — the same contract `M1_PRESCRIPTION` carries for the migrate verb.
 * THIS command is the one an installed host runs (that is why the compiled twin
 * ships), so printing only `./run.sh …` here would hand an operator mid-blackout
 * a command that host cannot type. Keeps `restore <dir>` as a literal substring
 * in both halves, so a gate asserting the prescribed path still matches.
 */
function restorePrescription(backupDir: string): string {
	return (
		`\`${M1_RESTORE_COMMAND} ${backupDir}\` ` +
		`(from an installed package: \`${M1_RESTORE_COMMAND_INSTALLED} ${backupDir}\`)`
	);
}

function usage(code: number): never {
	console.error(
		[
			"usage: node --experimental-strip-types scripts/meta-bridge-migrate-v3.ts <verb> [args]",
			`       (dev clone: \`${M1_MIGRATE_COMMAND.replace(/ migrate$/, "")} <verb>\` · installed package: ` +
				`\`${M1_MIGRATE_COMMAND_INSTALLED.replace(/ migrate$/, "")} <verb>\` — the M1 one-shot migration)`,
			"",
			"  migrate [--drop-parentage]  backup the store, rewrite every v1/v2 record as v3, re-verify non-V3=0.",
			"                              Refuses BEFORE any write: a store with malformed/drifted/duplicate or",
			"                              non-regular-file records, or a v2 record carrying non-null parentGardenId /",
			"                              isEntwurf=true without the flag.",
			"  verify                      read-only: exit 0 iff every record is strict v3 (non-V3=0).",
			"  restore <backup-dir>        rollback: verify the backup is THIS store's fully readable, non-empty",
			"                              `.v3-migration-backup-<ts>` sibling, then move the current store aside",
			"                              (<store>.pre-restore-<ts>/) and copy the M1 backup back.",
			"",
			"store   = ENTWURF_META_SESSIONS_DIR || <PI_CODING_AGENT_DIR|~/.pi/agent>/meta-sessions",
			"mailbox = ENTWURF_META_MAILBOX_DIR  || <PI_CODING_AGENT_DIR|~/.pi/agent>/meta-mailbox (v1 receipts land here)",
		].join("\n"),
	);
	process.exit(code);
}

/** Denote-style local timestamp for backup/aside dir names. */
function stamp(now: Date = new Date()): string {
	const p = (n: number, w = 2) => String(n).padStart(w, "0");
	return `${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}T${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}`;
}

/** tmp-file + rename so a crash never leaves a half-written record (mirrors the store's atomic write). */
function atomicWrite(file: string, content: string): void {
	const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
	fs.writeFileSync(tmp, content, { mode: 0o600 });
	fs.renameSync(tmp, file);
}

interface ClassifiedRecord {
	filename: string;
	raw: string;
	version: 1 | 2 | 3;
	v1?: MetaRecord;
	v2?: MetaIdentityV2;
	v3?: MetaIdentity;
}

interface StoreProblem {
	filename: string;
	message: string;
}

interface Classification {
	records: ClassifiedRecord[];
	problems: StoreProblem[];
	counts: { v1: number; v2: number; v3: number };
}

/**
 * Read + classify every `.meta.json` in the store. The record-entry domain is
 * regular files only (lstat-checked BEFORE the read — a symlink would classify
 * by its target's bytes while a byte copy lands the link), then schemaVersion
 * picks the ONE parser a body must satisfy (a record is legible to exactly one
 * schema — the strayness invariant), then filename agreement and
 * nativeSessionId uniqueness hold across ALL versions. Anything else is a
 * problem the migration refuses to write over — M1 migrates a readable store;
 * it never repairs a corrupt one. This function is the SINGLE rule-site for
 * every verb, store and backup alike: that is what makes "migrate accepted ⇒
 * the backup migrate printed restores" a theorem instead of a hope.
 */
function classifyStore(dir: string): Classification {
	const records: ClassifiedRecord[] = [];
	const problems: StoreProblem[] = [];
	const counts = { v1: 0, v2: 0, v3: 0 };
	if (!fs.existsSync(dir)) return { records, problems, counts };

	for (const filename of fs.readdirSync(dir).sort()) {
		if (!filename.endsWith(".meta.json")) continue;
		// The record-entry DOMAIN is regular files only, held HERE so every verb
		// (verify, migrate preflight, post-write disk verification, restore backup
		// classification) applies the same rule — a per-verb guard drifts, and the
		// drift broke the machine sentence "migrate accepted ⇒ its backup
		// restores" once already: migrate followed a symlink record while restore
		// refused it, so M1 authored a backup its own rollback verb rejected.
		let entryStat: fs.Stats;
		try {
			entryStat = fs.lstatSync(path.join(dir, filename));
		} catch (err) {
			problems.push({ filename, message: `unreadable: ${err instanceof Error ? err.message : String(err)}` });
			continue;
		}
		if (!entryStat.isFile()) {
			const kind = entryStat.isSymbolicLink() ? "symlink" : entryStat.isDirectory() ? "directory" : "special file";
			problems.push({
				filename,
				message: `not a regular file (got ${kind}) — the record domain is regular files only, for store and backup alike`,
			});
			continue;
		}
		// The read itself is classification input, not a precondition: an
		// unreadable file or a raced-away one is a PROBLEM this surface reports
		// and refuses over — never an uncaught crash (M3: "classify → REFUSE"
		// has no crash branch).
		let raw: string;
		try {
			raw = fs.readFileSync(path.join(dir, filename), "utf8");
		} catch (err) {
			problems.push({ filename, message: `unreadable: ${err instanceof Error ? err.message : String(err)}` });
			continue;
		}
		let body: unknown;
		try {
			body = JSON.parse(raw);
		} catch (err) {
			problems.push({ filename, message: `not valid JSON: ${err instanceof Error ? err.message : String(err)}` });
			continue;
		}
		if (typeof body !== "object" || body === null || Array.isArray(body)) {
			problems.push({ filename, message: `record must be a JSON object (got ${describe(body)})` });
			continue;
		}
		const version = (body as Record<string, unknown>).schemaVersion;
		let record: ClassifiedRecord;
		try {
			if (version === 1) {
				record = { filename, raw, version: 1, v1: parseMetaRecordV1(raw) };
			} else if (version === 2) {
				record = { filename, raw, version: 2, v2: parseMetaRecordV2(raw) };
			} else if (version === 3) {
				record = { filename, raw, version: 3, v3: parseMetaRecordV3(raw) };
			} else {
				problems.push({ filename, message: `unsupported schemaVersion (got ${describe(version)}) — not v1/v2/v3` });
				continue;
			}
		} catch (err) {
			problems.push({ filename, message: err instanceof Error ? err.message : String(err) });
			continue;
		}
		const gardenId = (record.v1 ?? record.v2 ?? record.v3)?.gardenId as string;
		if (filename !== `${gardenId}.meta.json`) {
			problems.push({
				filename,
				message: `body/filename drift — body gardenId=${gardenId}, expected filename ${gardenId}.meta.json. The body is the authority; this file is corrupt.`,
			});
			continue;
		}
		counts[`v${record.version}` as "v1" | "v2" | "v3"] += 1;
		records.push(record);
	}

	const nativeToFiles = new Map<string, string[]>();
	for (const r of records) {
		const nativeSessionId = (r.v1 ?? r.v2 ?? r.v3)?.nativeSessionId as string;
		const files = nativeToFiles.get(nativeSessionId) ?? [];
		files.push(r.filename);
		nativeToFiles.set(nativeSessionId, files);
	}
	for (const [nativeSessionId, files] of nativeToFiles.entries()) {
		if (files.length > 1) {
			problems.push({
				filename: files.join(", "),
				message: `duplicate nativeSessionId ${JSON.stringify(nativeSessionId)} — authority ambiguity; the operator must resolve which record survives before migrating`,
			});
		}
	}
	return { records, problems, counts };
}

function printProblems(problems: StoreProblem[]): void {
	for (const p of problems) console.error(`FAIL ${p.filename}: ${p.message}`);
}

/** A v2 record whose retired axes carry a VALUE (the disposition --drop-parentage governs). */
function parentageBearing(records: ClassifiedRecord[]): ClassifiedRecord[] {
	return records.filter((r) => r.v2 && (r.v2.parentGardenId !== null || r.v2.isEntwurf === true));
}

function toV3(record: ClassifiedRecord): MetaIdentity {
	if (record.v1) {
		const v1 = record.v1;
		return {
			schemaVersion: 3,
			gardenId: v1.gardenId,
			backend: v1.backend,
			nativeSessionId: v1.nativeSessionId,
			cwd: v1.cwd,
			model: null,
			transcriptPath: v1.transcriptPath,
			createdAt: v1.createdAt,
			recordUpdatedAt: v1.lastSeen,
		};
	}
	const v2 = record.v2 as MetaIdentityV2;
	return {
		schemaVersion: 3,
		gardenId: v2.gardenId,
		backend: v2.backend,
		nativeSessionId: v2.nativeSessionId,
		cwd: v2.cwd,
		model: v2.model,
		transcriptPath: v2.transcriptPath,
		createdAt: v2.createdAt,
		recordUpdatedAt: v2.recordUpdatedAt,
	};
}

function cmdVerify(storeDir: string): number {
	const { records, problems, counts } = classifyStore(storeDir);
	const total = counts.v1 + counts.v2 + counts.v3;
	if (problems.length === 0 && counts.v1 === 0 && counts.v2 === 0) {
		console.log(`verify ok: ${total} v3 record(s), non-V3=0 (${storeDir})`);
		return 0;
	}
	console.error(`verify FAIL: ${storeDir} is not a clean v3-only store`);
	if (counts.v1 > 0) console.error(`FAIL pre-cut v1 record ×${counts.v1} — migrate with ${M1_PRESCRIPTION}`);
	if (counts.v2 > 0) console.error(`FAIL pre-cut v2 record ×${counts.v2} — migrate with ${M1_PRESCRIPTION}`);
	printProblems(problems);
	// Pre-quiesce honesty: say NOW whether migrate will demand --drop-parentage,
	// so the operator learns it from the read-only probe, not mid-blackout.
	const bearing = parentageBearing(records);
	if (bearing.length > 0) {
		console.error(
			`note: ${bearing.length} v2 record(s) carry a non-null parentGardenId / isEntwurf=true — migrate will refuse without --drop-parentage`,
		);
	}
	console.error(`verify: ${counts.v3} v3 / ${counts.v2} v2 / ${counts.v1} v1 / ${problems.length} problem(s)`);
	return 1;
}

function cmdMigrate(storeDir: string, mailboxDir: string, dropParentage: boolean): number {
	const { records, problems, counts } = classifyStore(storeDir);
	console.log(`meta-bridge migrate-v3 (M1): store ${storeDir}`);
	console.log(`classified: ${counts.v3} v3 / ${counts.v2} v2 / ${counts.v1} v1 / ${problems.length} problem(s)`);

	if (problems.length > 0) {
		printProblems(problems);
		console.error(
			"REFUSE: the store has records the migration cannot fully read — nothing was written, no backup taken. " +
				"Fix or remove them first (store-doctor names each one), then re-run.",
		);
		return 1;
	}

	const preCut = records.filter((r) => r.version !== 3);
	if (preCut.length === 0) {
		console.log(`store already v3-only (${counts.v3} record(s)); nothing to migrate — no backup taken.`);
		return 0;
	}

	const bearing = parentageBearing(records);
	if (bearing.length > 0 && !dropParentage) {
		for (const r of bearing) {
			const v2 = r.v2 as MetaIdentityV2;
			console.error(
				`REFUSE ${r.filename}: parentGardenId=${v2.parentGardenId === null ? "null" : `"${v2.parentGardenId}"`} isEntwurf=${v2.isEntwurf} — ` +
					"v3 has no parentage/species axis (#50: a call is not parentage; no isEntwurf species boolean).",
			);
		}
		console.error(
			`REFUSE: ${bearing.length} record(s) carry values the v3 schema drops. Nothing was written, no backup taken. ` +
				"Re-run with --drop-parentage to discard them; the pre-migration backup will keep the original bytes.",
		);
		return 1;
	}

	const backupDir = `${storeDir}.v3-migration-backup-${stamp()}`;
	if (fs.existsSync(backupDir)) {
		console.error(`REFUSE: backup dir already exists: ${backupDir} — wait a second and re-run.`);
		return 1;
	}
	// The final timestamp name is the restore verb's trust anchor: "this name
	// exists" must mean "this backup is COMPLETE". So the copy lands in a
	// staging leaf first and only an atomic rename claims the final name — a
	// crash or ENOSPC mid-copy leaves at most a `.partial-` leaf the restore
	// grammar refuses, never a plausible half-backup under the trusted name.
	const stagingDir = `${backupDir}.partial-${process.pid}`;
	try {
		fs.cpSync(storeDir, stagingDir, { recursive: true });
		fs.renameSync(stagingDir, backupDir);
	} catch (err) {
		try {
			// Best-effort: the partial leaf may hold the very bytes that filled the
			// disk; if even this fails, the restore grammar refuses the leaf anyway.
			fs.rmSync(stagingDir, { recursive: true, force: true });
		} catch {
			// the refusal below must still print — never crash inside the cleanup
		}
		console.error(err instanceof Error ? (err.stack ?? err.message) : String(err));
		console.error(
			"REFUSE: could not take a complete backup — nothing was written to the store and no final-name " +
				"backup exists. Fix the cause above and re-run.",
		);
		return 1;
	}
	console.log(`backup: ${backupDir} (${records.length} record(s))`);

	// Once writing starts, EVERY exit path must name the rollback (M2): a raw
	// stack trace mid-blackout with no prescription is exactly when the operator
	// needs one most. The catch re-prints the error and the restore command; it
	// never swallows the cause.
	let receiptsMigrated = 0;
	try {
		for (const r of preCut) {
			if (r.v1) {
				// Crash-order: receipts BEFORE the record rewrite. If we die between the
				// two the record is still v1 and the re-run re-migrates (state-wins merge
				// is idempotent) — the reverse order would lose the receipt permanently.
				const state = migrateV1DeliveryReceipts({ gardenId: r.v1.gardenId, delivery: r.v1.delivery, mailboxDir });
				if (state !== null) {
					receiptsMigrated += 1;
					console.log(`  receipts → mailbox state: ${r.v1.gardenId}`);
				}
			}
			if (r.v2 && (r.v2.parentGardenId !== null || r.v2.isEntwurf === true)) {
				console.log(
					`  dropped ${r.filename}: parentGardenId=${r.v2.parentGardenId === null ? "null" : `"${r.v2.parentGardenId}"`} isEntwurf=${r.v2.isEntwurf} (preserved in backup)`,
				);
			}
			atomicWrite(path.join(storeDir, r.filename), serializeMetaIdentity(toV3(r)));
		}

		// Verify from DISK, not from memory — the certification is what a fresh
		// reader sees, and its failure names the rollback path.
		const after = classifyStore(storeDir);
		const nonV3 = after.counts.v1 + after.counts.v2 + after.problems.length;
		if (nonV3 > 0) {
			printProblems(after.problems);
			console.error(
				`verify FAIL after migration: ${after.counts.v1} v1 / ${after.counts.v2} v2 / ${after.problems.length} problem(s) remain. ` +
					`The backup is intact — roll back with ${restorePrescription(backupDir)}.`,
			);
			return 1;
		}
		console.log(
			`migrated: v1→v3 ${counts.v1}, v2→v3 ${counts.v2}, kept v3 ${counts.v3}` +
				(receiptsMigrated > 0 ? ` (${receiptsMigrated} v1 receipt set(s) → mailbox state)` : ""),
		);
		console.log(`verify: non-V3=0 (${after.counts.v3} record(s))`);
		console.log(`rollback (if needed): ${restorePrescription(backupDir)}`);
		return 0;
	} catch (err) {
		console.error(err instanceof Error ? (err.stack ?? err.message) : String(err));
		console.error(
			`FAIL mid-migration: the store may hold a mix of migrated and pre-cut records. ` +
				`The backup is intact — roll back with ${restorePrescription(backupDir)}, fix the cause above, re-run.`,
		);
		return 1;
	}
}

function cmdRestore(storeDir: string, backupArg: string): number {
	const backupDir = path.resolve(backupArg);
	let backupStat: fs.Stats;
	try {
		// M1 creates a real sibling directory. statSync would follow a sibling
		// symlink into an unrelated tree and let that tree replace the address
		// authority; lstat keeps the leaf itself inside the trust decision.
		backupStat = fs.lstatSync(backupDir);
	} catch (err) {
		// EACCES / ENOTDIR / EIO are NOT "does not exist" — mid-blackout the
		// operator steers by this line, so the refusal carries the real cause.
		const cause = err instanceof Error ? err.message : String(err);
		console.error(`REFUSE: cannot inspect backup path ${backupDir}: ${cause}`);
		return 1;
	}
	if (!backupStat.isDirectory()) {
		console.error(`REFUSE: backup path is not a real directory (symlinks refused): ${backupDir}`);
		return 1;
	}
	// A backup migrate took is a real-directory SIBLING of THIS store, named
	// `<resolved-store>.v3-migration-backup-<YYYYMMDDTHHMMSS>` — one segment.
	// A bare `.v3-migration-backup-` substring is not enough: a look-alike under
	// another store (`foreign.v3-migration-backup-x`) or nested inside a backup
	// (`store.v3-migration-backup-x/inner`) would sail through and replace the
	// address authority with an unrelated tree. Restoring anything else is a
	// manual `cp`, not this verb. (To restore a backup taken of a DIFFERENT store,
	// point ENTWURF_META_SESSIONS_DIR at that store — then this backup is ITS
	// sibling and the check passes honestly.)
	const expectedPrefix = `${path.resolve(storeDir)}.v3-migration-backup-`;
	const tail = backupDir.startsWith(expectedPrefix) ? backupDir.slice(expectedPrefix.length) : null;
	if (tail === null || !/^\d{8}T\d{6}$/.test(tail)) {
		console.error(
			`REFUSE: ${backupDir} is not a backup OF THIS store. An M1 backup is a sibling named exactly ` +
				`\`${expectedPrefix}<YYYYMMDDTHHMMSS>\` (one segment) — a foreign, nested, or look-alike dir is refused. ` +
				"To roll a different store back, point ENTWURF_META_SESSIONS_DIR at it; copying an arbitrary " +
				"dir over the address authority is a manual `cp`, not a verb.",
		);
		return 1;
	}
	if (backupDir === path.resolve(storeDir)) {
		console.error(`REFUSE: backup dir IS the store dir: ${backupDir}`);
		return 1;
	}
	// The name proves provenance, not completeness: staging+rename means migrate
	// never leaves a half-copy under the final name, but a manual cp or a damaged
	// disk still can. This verb puts the backup in AUTHORITY, so classify it
	// with the SAME classifyStore migrate uses — one record-entry domain
	// (regular files only, fully readable, no drift/duplicates), which is what
	// makes the machine sentence hold: a store migrate ACCEPTED classifies
	// clean, its backup is a byte copy, so the backup migrate PRINTED is a
	// backup this verb accepts. v1/v2/v3 are all legitimate (the backup holds
	// pre-cut bytes), but a problem record or an empty dir is not an M1 backup
	// (migrate refuses those stores and never backs up an empty one). No extra
	// guard lives here — a second rule-site is where the last drift came from.
	const backupClass = classifyStore(backupDir);
	const backupRecords = backupClass.counts.v1 + backupClass.counts.v2 + backupClass.counts.v3;
	if (backupClass.problems.length > 0) {
		printProblems(backupClass.problems);
		console.error(
			`REFUSE: ${backupDir} is not a completely readable M1 backup (${backupClass.problems.length} problem(s) above) — ` +
				"the current store was NOT touched. A backup this verb cannot fully read must never become the " +
				"address authority; recover the intended bytes manually before retrying.",
		);
		return 1;
	}
	if (backupRecords === 0) {
		console.error(
			`REFUSE: ${backupDir} holds no meta-record — migrate backs a store up only when it has records to ` +
				"migrate, so an empty dir under the backup name is not an M1 backup. The current store was NOT touched.",
		);
		return 1;
	}
	let asideDir: string | null = null;
	if (fs.existsSync(storeDir)) {
		asideDir = `${storeDir}.pre-restore-${stamp()}`;
		if (fs.existsSync(asideDir)) {
			console.error(`REFUSE: aside dir already exists: ${asideDir} — wait a second and re-run.`);
			return 1;
		}
		fs.renameSync(storeDir, asideDir);
		console.log(`current store moved aside (nothing destroyed): ${asideDir}`);
	}
	// Same M2 contract as migrate: once the store moved aside, every exit path
	// must say where the data lives — the aside holds the replaced store, the
	// backup is untouched, so a failed copy destroys nothing.
	try {
		fs.cpSync(backupDir, storeDir, { recursive: true });
	} catch (err) {
		console.error(err instanceof Error ? (err.stack ?? err.message) : String(err));
		console.error(
			`FAIL mid-restore: the copy from the backup did not complete. Nothing is lost — ` +
				`the backup is untouched (${backupDir})` +
				(asideDir === null ? "." : ` and the replaced store sits at ${asideDir}.`) +
				" Fix the cause above and re-run the same restore.",
		);
		return 1;
	}
	const restored = fs.readdirSync(storeDir).filter((f) => f.endsWith(".meta.json")).length;
	console.log(`restored: ${backupDir} → ${storeDir} (${restored} record(s); the backup stays intact)`);
	return 0;
}

const args = process.argv.slice(2);
const verb = args[0];
if (verb === "-h" || verb === "--help") usage(0);
if (!verb) usage(2);

const storeDir = defaultMetaSessionsDir();

if (verb === "migrate") {
	let dropParentage = false;
	for (const a of args.slice(1)) {
		if (a === "--drop-parentage") dropParentage = true;
		else usage(2);
	}
	process.exit(cmdMigrate(storeDir, defaultMetaMailboxDir(), dropParentage));
} else if (verb === "verify") {
	if (args.length > 1) usage(2);
	process.exit(cmdVerify(storeDir));
} else if (verb === "restore") {
	const backupArg = args[1];
	if (!backupArg || args.length > 2) usage(2);
	process.exit(cmdRestore(storeDir, backupArg));
} else {
	usage(2);
}
