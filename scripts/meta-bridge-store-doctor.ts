#!/usr/bin/env node
/**
 * meta-bridge-store-doctor — fail-loud full scan for meta-session records.
 *
 * The store is the authority for native→garden lookup. Doctor must therefore
 * refuse corrupt records, duplicate nativeSessionId authorities, and body ↔
 * filename drift instead of auto-pruning or silently picking one.
 */

import fs from "node:fs";
import path from "node:path";
import { parseMetaIdentity } from "../pi-extensions/lib/meta-session.ts";

const dir = process.argv[2];
if (!dir) {
	console.error("usage: node --experimental-strip-types scripts/meta-bridge-store-doctor.ts <meta-sessions-dir>");
	process.exit(2);
}

const failures: string[] = [];
const nativeToFiles = new Map<string, string[]>();
let scanned = 0;

if (!fs.existsSync(dir)) {
	console.log(`meta-store scan ok: ${dir} does not exist yet (0 records)`);
	process.exit(0);
}

for (const filename of fs.readdirSync(dir).sort()) {
	if (!filename.endsWith(".meta.json")) continue;
	scanned += 1;
	const file = path.join(dir, filename);
	try {
		// dual-read (3D-4 commit1): parseMetaIdentity reads v1 AND v2 and normalizes,
		// so doctor's gardenId/nativeSessionId checks survive the v2 cut.
		const id = parseMetaIdentity(fs.readFileSync(file, "utf8"));
		const expectedFilename = `${id.gardenId}.meta.json`;
		if (filename !== expectedFilename) {
			failures.push(
				`${filename}: body/filename drift — body gardenId=${id.gardenId}, expected filename ${expectedFilename}`,
			);
		}
		const files = nativeToFiles.get(id.nativeSessionId) ?? [];
		files.push(filename);
		nativeToFiles.set(id.nativeSessionId, files);
	} catch (err) {
		failures.push(`${filename}: ${err instanceof Error ? err.message : String(err)}`);
	}
}

for (const [nativeSessionId, files] of nativeToFiles.entries()) {
	if (files.length > 1) {
		failures.push(
			`duplicate nativeSessionId ${JSON.stringify(nativeSessionId)} in ${files.join(", ")} — authority ambiguity; prune manually`,
		);
	}
}

if (failures.length > 0) {
	for (const failure of failures) console.error(`FAIL: ${failure}`);
	process.exit(1);
}

console.log(`meta-store scan ok: ${scanned} record(s) scanned, no corrupt/duplicate/drift records`);
