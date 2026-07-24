#!/usr/bin/env node
/**
 * meta-bridge-prune — LISTING-ONLY hygiene surface for the meta-session store.
 *
 * 1.0.0 policy (GLG + GPT힣, 2026-06-06): list candidates, NEVER delete. The
 * store is the native→garden lookup authority, so this surface is deliberately
 * conservative:
 *   - orphan (transcript gone) / stale (recordUpdatedAt older than ttl) are
 *     SUGGESTED for manual prune with the exact rm command printed — but removed
 *     by no one here. transcript-gone is a strong abandonment signal, not proof; a
 *     backend path migration / cleanup / config-dir change can also vacate it. A
 *     NULL transcriptPath (v2 nullable-at-birth, e.g. pi) is "unknown", NOT gone —
 *     never orphan on null; only a non-empty string path that no longer exists.
 *   - corrupt JSON / body↔filename drift / duplicate nativeSessionId are
 *     AMBIGUOUS / manual-only: the operator decides which authority survives.
 *     Never blindly rm a duplicate pair.
 * No --apply in 1.0.0. The script prints, the operator removes. doctor stays the
 * fail-loud surface (store-doctor reds on corrupt/duplicate/drift); prune is the
 * separate janitor LISTING that keeps a green store from silently bloating with
 * transcript-gone records — which doctor intentionally does NOT fail on.
 */

import fs from "node:fs";
import path from "node:path";
import { defaultMetaSessionsDir, type MetaIdentity, parseMetaIdentity } from "../pi-extensions/lib/meta-session.ts";

/** POSIX single-quote a path so the printed rm command survives spaces/specials. */
function shellQuote(s: string): string {
	return `'${s.replace(/'/g, "'\\''")}'`;
}

function usage(code: number): never {
	console.error(
		"usage: node --experimental-strip-types scripts/meta-bridge-prune.ts [meta-sessions-dir] [--ttl-days N]",
	);
	process.exit(code);
}

let dirArg: string | undefined;
let ttlDays = 30;
for (let i = 2; i < process.argv.length; i++) {
	const a = process.argv[i];
	if (a === "--ttl-days") {
		const v = process.argv[++i];
		const n = Number(v);
		if (!Number.isFinite(n) || n < 0) usage(2);
		ttlDays = n;
	} else if (a.startsWith("--ttl-days=")) {
		const n = Number(a.slice("--ttl-days=".length));
		if (!Number.isFinite(n) || n < 0) usage(2);
		ttlDays = n;
	} else if (a === "-h" || a === "--help") {
		usage(0);
	} else if (a.startsWith("-")) {
		console.error(`unknown flag: ${a}`);
		usage(2);
	} else if (dirArg === undefined) {
		dirArg = a;
	} else {
		usage(2);
	}
}

const dir = dirArg ?? defaultMetaSessionsDir();
const ttlMs = ttlDays * 24 * 60 * 60 * 1000;
const now = Date.now();

console.log("meta-bridge prune candidates");
console.log(`store: ${dir}`);
console.log(`ttl: ${ttlDays}d (stale threshold)`);
console.log("");

if (!fs.existsSync(dir)) {
	console.log(`store does not exist yet (0 records).`);
	console.log("");
	console.log("No files removed.");
	process.exit(0);
}

interface Good {
	file: string;
	gardenId: string;
	backend: string;
	nativeSessionId: string;
	transcriptPath: string | null;
	recordUpdatedAt: string;
}

const goodByNative = new Map<string, Good[]>();
const ambiguous: string[] = [];
let scanned = 0;

for (const filename of fs.readdirSync(dir).sort()) {
	if (!filename.endsWith(".meta.json")) continue;
	scanned += 1;
	const file = path.join(dir, filename);
	// V3-only (#50 hard cut): a pre-cut (v1/v2) record fails parse and lands in
	// the corrupt/manual-only bucket until the M1 operator command migrates it.
	let id: MetaIdentity;
	try {
		id = parseMetaIdentity(fs.readFileSync(file, "utf8"));
	} catch (err) {
		ambiguous.push(`${filename}: corrupt — ${err instanceof Error ? err.message : String(err)}`);
		continue;
	}
	const expectedFilename = `${id.gardenId}.meta.json`;
	if (filename !== expectedFilename) {
		ambiguous.push(`${filename}: body/filename drift — body gardenId=${id.gardenId}, expected ${expectedFilename}`);
		continue;
	}
	const list = goodByNative.get(id.nativeSessionId) ?? [];
	list.push({
		file: filename,
		gardenId: id.gardenId,
		backend: id.backend,
		nativeSessionId: id.nativeSessionId,
		transcriptPath: id.transcriptPath,
		recordUpdatedAt: id.recordUpdatedAt,
	});
	goodByNative.set(id.nativeSessionId, list);
}

const orphan: Good[] = [];
const stale: Good[] = [];
let keep = 0;

for (const [nativeSessionId, list] of goodByNative.entries()) {
	if (list.length > 1) {
		// Authority ambiguity — operator must choose which survives. Never auto-pick.
		ambiguous.push(
			`duplicate nativeSessionId ${JSON.stringify(nativeSessionId)} in ${list.map((g) => g.file).join(", ")} — manual-only, do not blindly remove`,
		);
		continue;
	}
	const g = list[0];
	// G2 (3D-4): null transcriptPath is NOT orphan. v2 (pi nullable-at-birth) leaves
	// it null = "unknown / not yet known", which is not "the file went away". Orphan
	// is ONLY a non-empty string path that no longer exists on disk. A null path
	// falls through to the recordUpdatedAt staleness check like any live record.
	const tp = g.transcriptPath;
	if (typeof tp === "string" && tp !== "" && !fs.existsSync(tp)) {
		orphan.push(g);
		continue;
	}
	// recordUpdatedAt is only proven a non-empty string by the parser, not a real
	// date. KEEP means live + RECENT; an unparseable recordUpdatedAt cannot prove
	// recency, so it is not a silent keep — it goes manual-only like any defect.
	const updatedMs = Date.parse(g.recordUpdatedAt);
	if (!Number.isFinite(updatedMs)) {
		ambiguous.push(
			`${g.file}: unparseable recordUpdatedAt ${JSON.stringify(g.recordUpdatedAt)} — cannot prove recent, manual-only`,
		);
		continue;
	}
	if (now - updatedMs > ttlMs) stale.push(g);
	else keep += 1;
}

const ageDays = (iso: string): string => {
	const ms = now - Date.parse(iso);
	if (!Number.isFinite(ms)) return "?";
	return String(Math.floor(ms / (24 * 60 * 60 * 1000)));
};

console.log(`ORPHAN transcript-gone (${orphan.length}):`);
for (const g of orphan) {
	console.log(`- ${g.gardenId} ${g.backend} native=${g.nativeSessionId} transcript=${g.transcriptPath ?? "(null)"}`);
}
console.log("");

console.log(`STALE recordUpdatedAt>${ttlDays}d (${stale.length}):`);
for (const g of stale) {
	console.log(`- ${g.gardenId} ${g.backend} recordUpdatedAt=${g.recordUpdatedAt} age=${ageDays(g.recordUpdatedAt)}d`);
}
console.log("");

console.log(`AMBIGUOUS manual-only (${ambiguous.length}):`);
for (const reason of ambiguous) {
	console.log(`- ${reason}`);
}
console.log("");

console.log(`KEEP (live/recent): ${keep} record(s)`);
console.log(`scanned: ${scanned} record(s)`);
console.log("");

console.log("No files removed.");
const removable = [...orphan, ...stale];
if (removable.length > 0) {
	console.log("To prune an orphan/stale candidate, inspect it then remove its file manually:");
	for (const g of removable) {
		console.log(`  rm -- ${shellQuote(path.join(dir, `${g.gardenId}.meta.json`))}`);
	}
}
if (ambiguous.length > 0) {
	console.log("AMBIGUOUS records are NOT listed as rm commands — inspect each and decide which authority survives.");
}

process.exit(0);
