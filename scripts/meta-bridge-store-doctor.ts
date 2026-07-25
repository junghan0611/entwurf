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
 */

import {
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

const cert = certifyActiveStoreDir(dir);

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
