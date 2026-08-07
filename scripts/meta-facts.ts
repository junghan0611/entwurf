#!/usr/bin/env node
/**
 * meta-facts — owner-normalized, read-only projection of the meta-record store (#65).
 *
 * The one join a consumer cannot make anywhere else — `(gardenId, nativeSessionId,
 * transcriptPath)` — lives only in the meta-record store, and reading that store
 * correctly means carrying the whole certification contract (strict v3 keyset,
 * parse-before-uniqueness, no-winner duplicates, O_NOFOLLOW regular-file reads).
 * External consumers that copied it decayed the day the contract moved. This surface
 * makes THE owner emit the join: it is `listAllMetaIdentities` over the real store —
 * the same listing `entwurf_peers` trusts — serialized verbatim. No parallel parser,
 * no liveness, no socket paths, no transcript contents, no state, no watching.
 *
 * stdout (deterministic, 2-space indent, trailing newline):
 *   {
 *     "schemaVersion": 1,          // of THIS projection, not of the records
 *     "storeDir": "/abs/path",
 *     "citizens": [ <full verbatim strict 9-field v3 records, sorted by gardenId> ],
 *     "defects":  [ { "filename", "message" }, … sorted by filename ]
 *   }
 *
 * Defects ride IN-BAND: a readable store with uncertifiable entries is a fact to
 * report, not a failure of this command — the healthy citizens are still true, and
 * the defect list is exactly what `listAllMetaIdentities` refused and why (a rival
 * pair is refused on BOTH sides; a schema-invalid record can never quarantine a
 * healthy neighbour, because parse runs before uniqueness).
 *
 * EXIT CONTRACT — the verdict is the exit code (store-doctor precedent):
 *   0 — store readable; the JSON above is on stdout (defects, if any, in-band).
 *       A store that does not exist is a readable EMPTY store (ENOENT only).
 *   2 — usage error (bad argv).
 *   3 — the store could not be READ (EACCES/ENOTDIR/…). No JSON is emitted:
 *       an unreadable host must never look like an empty one.
 */

import { defaultMetaSessionsDir, listAllMetaIdentitiesDir } from "../pi-extensions/lib/meta-session.ts";

const arg = process.argv[2];
// A dash argv is a flag this command does not have, not a store directory — treating
// it as a path would answer `--help` with "empty store, exit 0", a silent wrong fact.
if (process.argv.length > 3 || (arg !== undefined && arg.startsWith("-"))) {
	console.error("usage: entwurf meta-facts [meta-sessions-dir]");
	process.exit(2);
}

let facts: ReturnType<typeof listAllMetaIdentitiesDir>;
try {
	facts = listAllMetaIdentitiesDir(arg ?? defaultMetaSessionsDir());
} catch (err) {
	console.error(`FAIL: ${err instanceof Error ? err.message : String(err)}`);
	process.exit(3); // see the EXIT CONTRACT above: 3 = unreadable store, never an empty one
}

process.stdout.write(
	`${JSON.stringify(
		{ schemaVersion: 1, storeDir: facts.dir, citizens: facts.identities, defects: facts.errors },
		null,
		2,
	)}\n`,
);
