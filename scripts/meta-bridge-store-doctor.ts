#!/usr/bin/env node
/**
 * meta-bridge-store-doctor — fail-loud certification of the ACTIVE meta-record store.
 *
 * The store is the authority for native→garden lookup, so the doctor asks EXACTLY
 * the question every identity writer asks: `certifyActiveStore` in meta-session.ts
 * (regular files, live schema, body↔filename agreement, globally unique
 * nativeSessionId). One contract, one code path — a store this doctor certifies is
 * a store the runtime will write to, and one it refuses is one no writer may touch.
 * Two implementations of "is this store ok" would drift, and the weaker one always
 * wins at runtime.
 *
 * It never prunes, repairs or picks a winner: the operator archives the generation.
 *
 * EXIT CONTRACT — the verdict is the exit code, not a string a caller has to guess:
 *   0 — certified. Every `.meta.json` passes; the runtime may write here.
 *   1 — CERTIFICATION defects. The prescription is the fresh-cut verb.
 *   2 — usage error (bad argv).
 *   3 — the store could not be READ (EACCES on it or an ancestor, ENOTDIR, …). A
 *       different prescription entirely: repair access/path. A fresh-cut CANNOT fix this
 *       and would fail on the same errno, so a caller must never print that advice here.
 * Callers branch on the code (`run.sh preflight_v3_store`, `meta-bridge-install.sh`);
 * before this split, both ended their refusal with "archive the generation with
 * fresh-cut" no matter the cause, which sent the operator — or an agent reading the last
 * line — at a command guaranteed to fail (2026-07-25 fresh-eyes review).
 */

import {
	type ActiveStoreCertification,
	activeStoreRefusal,
	certifyActiveStoreDir,
	defaultMetaSessionsDir,
} from "../pi-extensions/lib/meta-session.ts";

// Optional dir argv (doctor wrappers pass one); default = THE live store, the
// same env+default resolution every runtime surface uses — so the install
// preflight and a bare doctor run certify the store production will read.
const dir = process.argv[2] ?? defaultMetaSessionsDir();
if (process.argv.length > 3) {
	console.error("usage: node --experimental-strip-types scripts/meta-bridge-store-doctor.ts [meta-sessions-dir]");
	process.exit(2);
}

// A store that cannot be READ is a different verdict from a store full of defects, and it
// earns a different sentence: there is nothing to archive, and a fresh-cut would fail on
// the same errno. Say that plainly instead of letting an uncaught stack stand in for a
// verdict — or, worse, prescribing a cut that cannot help.
let cert: ActiveStoreCertification & { dir: string };
try {
	cert = certifyActiveStoreDir(dir);
} catch (err) {
	console.error(`FAIL: ${err instanceof Error ? err.message : String(err)}`);
	console.error(
		"This is an ACCESS problem, not a generation problem — archiving the generation cannot fix it. " +
			"Repair the store path's ownership/permissions (or point ENTWURF_META_SESSIONS_DIR at the intended " +
			"store), then re-run.",
	);
	process.exit(3); // see the EXIT CONTRACT above: 3 = unreadable store, NOT a defect list
}

if (cert.defects.length > 0) {
	// Per-entry causes first (the preflight shows the head of this list, and counts
	// these `FAIL` lines), then the count + prescription ONCE. `shown = 0` keeps the
	// summary from repeating every cause a second time — on a large previous
	// generation that doubled the wall.
	for (const defect of cert.defects) console.error(`FAIL: ${defect.filename}: ${defect.message}`);
	console.error(activeStoreRefusal(cert, 0));
	process.exit(1);
}

console.log(
	`meta-store scan ok: ${cert.scanned} record(s) certified in ${cert.dir} ` +
		"(regular files, live schema, no body/filename drift, unique nativeSessionId)",
);
