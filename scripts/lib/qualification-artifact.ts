/**
 * qualification-artifact — admit ONE CI collection artifact without the network
 * (#124 stage 3a). The caller injects the artifact metadata GitHub returned and the raw
 * zip bytes it downloaded; this module never fetches, never extracts to disk, and never
 * uses `gh run download` output (an extracted tree carries no artifact digest).
 *
 *   selectArtifact      exactly one artifact named for (runId, runAttempt), else RED.
 *   admitArtifact       metadata (name, run, head SHA, not expired) + digest = sha256 of
 *                       the zip bytes + zip containment + collection completeness + the
 *                       collection's own run/attempt/head + core self-consistency.
 *   readZipEntries      a minimal central-directory reader over Node's built-in zlib:
 *                       stored or deflated entries only, no zip64, no encryption; every
 *                       entry name must be a declared collection basename; symlinks,
 *                       directories, duplicates and oversize are refused BY NAME.
 *   checkCoreConsistency each receipt's core.sha256 is recomputed from its own
 *                       {files, node, nodeModules}; all receipts and the collection agree;
 *                       optionally core.files must equal an independent CORE_FILES
 *                       recomputation. node/node_modules stay a CI WITNESS — nothing here
 *                       hashes the operator host's node_modules as if it were the runner's.
 *
 * Every error is a named string; an empty list is the only admission. None of this is a
 * verdict — composeRelease decides that, and only over admitted collections.
 */

import { createHash } from "node:crypto";
import * as zlib from "node:zlib";
import { type Collection, checkCollectionData, mapReader } from "./qualification-collection.ts";
import { canonicalJson, coreSha256 } from "./qualification-receipt.ts";

export const ENTRY_NAME = /^(collection\.json|g[0-9]{3}\.json)$/;
export const MAX_ENTRY_BYTES = 8 * 1024 * 1024;
export const MAX_TOTAL_BYTES = 64 * 1024 * 1024;
/** Whole-archive cap, checked before a single byte is parsed or inflated. */
export const MAX_ZIP_BYTES = 80 * 1024 * 1024;

/** The fields of a GitHub `actions/runs/{id}/artifacts` item this module reads. */
export interface ApiArtifact {
	id: number;
	name: string;
	digest: string | null;
	expired: boolean;
	workflow_run: { id: number; head_sha: string } | null;
}

export function artifactName(runId: string, runAttempt: string): string {
	return `qualification-collection-${runId}-${runAttempt}`;
}

export function selectArtifact(
	list: ApiArtifact[],
	runId: string,
	runAttempt: string,
): { ok: true; artifact: ApiArtifact } | { ok: false; errors: string[] } {
	const name = artifactName(runId, runAttempt);
	const hits = list.filter((a) => a.name === name);
	if (hits.length !== 1)
		return { ok: false, errors: [`artifact-select: ${hits.length} artifacts named ${name}, need exactly 1`] };
	return { ok: true, artifact: hits[0] };
}

// ── zip ─────────────────────────────────────────────────────────────────────

const EOCD = 0x06054b50;
const CEN = 0x02014b50;
const LOC = 0x04034b50;

const DESC = 0x08074b50;
const ZIP64_LOCATOR = 0x07064b50;

interface CentralEntry {
	name: string;
	madeBy: number;
	flags: number;
	method: number;
	crc: number;
	csize: number;
	usize: number;
	extAttr: number;
	locOff: number;
}

/**
 * Read every entry of a zip held in memory, refusing anything a collection may not
 * contain. Structure first, content second — nothing is inflated until the whole archive
 * is proven to be exactly its listed entries:
 *   1. the archive is at most MAX_ZIP_BYTES (checked before any parsing);
 *   2. the EOCD record ends the archive exactly (its comment length included), is single
 *      disk, and is not zip64;
 *   3. the central directory ends at the EOCD and is consumed EXACTLY by its entry count
 *      (a lowered count cannot hide a listed entry);
 *   4. the local records tile [0, cdOff) with no gap and no overlap (an unlisted local
 *      entry or smuggled bytes cannot hide either). A data descriptor (flag bit 3) is
 *      accepted in its two standard forms only and must agree with the central record;
 *      any other layout is refused by name rather than loosened to pass.
 */
export function readZipEntries(zip: Buffer): { files: Record<string, Buffer>; errors: string[] } {
	const files: Record<string, Buffer> = {};
	const fail = (e: string) => ({ files, errors: [e] });
	if (zip.length > MAX_ZIP_BYTES) return fail(`zip-oversize: archive (${zip.length} bytes)`);
	if (zip.length < 22) return fail("zip-format: too short for an end-of-central-directory record");

	let eocd = -1;
	let sawSignature = false;
	for (let i = zip.length - 22; i >= Math.max(0, zip.length - 22 - 0xffff); i--) {
		if (zip.readUInt32LE(i) !== EOCD) continue;
		sawSignature = true;
		if (i + 22 + zip.readUInt16LE(i + 20) === zip.length) {
			eocd = i;
			break;
		}
	}
	if (eocd < 0) {
		return fail(
			sawSignature
				? "zip-format: the end-of-central-directory record does not end the archive (trailing bytes or comment length)"
				: "zip-format: no end-of-central-directory record",
		);
	}
	const diskNo = zip.readUInt16LE(eocd + 4);
	const cdDisk = zip.readUInt16LE(eocd + 6);
	const onDisk = zip.readUInt16LE(eocd + 8);
	const count = zip.readUInt16LE(eocd + 10);
	const cdSize = zip.readUInt32LE(eocd + 12);
	const cdOff = zip.readUInt32LE(eocd + 16);
	if (count === 0xffff || cdSize === 0xffffffff || cdOff === 0xffffffff)
		return fail("zip-format: zip64 is not accepted");
	if (eocd >= 20 && zip.readUInt32LE(eocd - 20) === ZIP64_LOCATOR) return fail("zip-format: zip64 is not accepted");
	if (diskNo !== 0 || cdDisk !== 0 || onDisk !== count) return fail("zip-format: multi-disk archives are not accepted");
	if (cdOff + cdSize !== eocd)
		return fail("zip-format: the central directory does not end at the end-of-central-directory record");

	const entries: CentralEntry[] = [];
	let p = cdOff;
	for (let n = 0; n < count; n++) {
		if (p + 46 > eocd || zip.readUInt32LE(p) !== CEN)
			return fail(`zip-format: central directory entry ${n} is malformed`);
		const nameLen = zip.readUInt16LE(p + 28);
		const extraLen = zip.readUInt16LE(p + 30);
		const commentLen = zip.readUInt16LE(p + 32);
		if (p + 46 + nameLen + extraLen + commentLen > eocd)
			return fail(`zip-format: central directory entry ${n} overruns`);
		entries.push({
			name: zip.subarray(p + 46, p + 46 + nameLen).toString("utf8"),
			madeBy: zip.readUInt16LE(p + 4) >> 8,
			flags: zip.readUInt16LE(p + 8),
			method: zip.readUInt16LE(p + 10),
			crc: zip.readUInt32LE(p + 16),
			csize: zip.readUInt32LE(p + 20),
			usize: zip.readUInt32LE(p + 24),
			extAttr: zip.readUInt32LE(p + 38),
			locOff: zip.readUInt32LE(p + 42),
		});
		p += 46 + nameLen + extraLen + commentLen;
	}
	if (p !== cdOff + cdSize) {
		return fail(`zip-format: the central directory has ${cdOff + cdSize - p} bytes not covered by its entry count`);
	}

	// Local records must tile [0, cdOff) exactly.
	const spans: { start: number; end: number; dataStart: number; e: CentralEntry }[] = [];
	for (const e of entries) {
		const label = JSON.stringify(e.name);
		if (e.locOff + 30 > cdOff || zip.readUInt32LE(e.locOff) !== LOC)
			return fail(`zip-format: ${label} local header missing`);
		const lNameLen = zip.readUInt16LE(e.locOff + 26);
		const lExtraLen = zip.readUInt16LE(e.locOff + 28);
		if (zip.subarray(e.locOff + 30, e.locOff + 30 + lNameLen).toString("utf8") !== e.name) {
			return fail(`zip-format: ${label} local name differs from the central directory`);
		}
		const dataStart = e.locOff + 30 + lNameLen + lExtraLen;
		let end = dataStart + e.csize;
		if (e.flags & 8) {
			const signed = end + 16 <= cdOff && zip.readUInt32LE(end) === DESC;
			const d = signed ? end + 4 : end;
			if (d + 12 > cdOff) return fail(`zip-format: ${label} data descriptor out of bounds`);
			if (zip.readUInt32LE(d) !== e.crc || zip.readUInt32LE(d + 4) !== e.csize || zip.readUInt32LE(d + 8) !== e.usize) {
				return fail(`zip-format: ${label} data descriptor disagrees with the central directory`);
			}
			end = d + 12;
		}
		if (end > cdOff) return fail(`zip-format: ${label} data out of bounds`);
		spans.push({ start: e.locOff, end, dataStart, e });
	}
	spans.sort((x, y) => x.start - y.start);
	let cursor = 0;
	for (const s of spans) {
		if (s.start !== cursor) return fail("zip-format: unlisted bytes between local entries (a gap or an overlap)");
		cursor = s.end;
	}
	if (cursor !== cdOff) return fail("zip-format: unlisted bytes before the central directory");

	// Content, entry by entry.
	const errors: string[] = [];
	let total = 0;
	for (const { e, dataStart } of spans) {
		const label = JSON.stringify(e.name);
		const unixMode = e.madeBy === 3 ? e.extAttr >>> 16 : 0;
		if ((unixMode & 0o170000) === 0o120000) {
			errors.push(`zip-symlink: ${label}`);
			continue;
		}
		if (e.name.endsWith("/") || (unixMode & 0o170000) === 0o040000) {
			errors.push(`zip-directory: ${label}`);
			continue;
		}
		if (!ENTRY_NAME.test(e.name)) {
			errors.push(`zip-name: ${label} is not collection.json or gNNN.json`);
			continue;
		}
		if (Object.hasOwn(files, e.name)) {
			errors.push(`zip-duplicate: ${label}`);
			continue;
		}
		if (e.flags & 1) {
			errors.push(`zip-encrypted: ${label}`);
			continue;
		}
		total += e.usize;
		if (e.usize > MAX_ENTRY_BYTES || e.csize > MAX_ENTRY_BYTES || total > MAX_TOTAL_BYTES) {
			errors.push(`zip-oversize: ${label} (${e.usize} bytes)`);
			continue;
		}
		const raw = zip.subarray(dataStart, dataStart + e.csize);
		let data: Buffer;
		try {
			if (e.method === 0) data = Buffer.from(raw);
			else if (e.method === 8) data = zlib.inflateRawSync(raw, { maxOutputLength: Math.max(1, e.usize) });
			else {
				errors.push(`zip-method: ${label} uses method ${e.method}`);
				continue;
			}
		} catch (err) {
			errors.push(`zip-inflate: ${label} ${err instanceof Error ? err.message : String(err)}`);
			continue;
		}
		if (data.length !== e.usize || zlib.crc32(data) !== e.crc) {
			errors.push(`zip-crc: ${label} size or CRC does not match its header`);
			continue;
		}
		files[e.name] = data;
	}
	return { files, errors };
}

// ── core self-consistency ───────────────────────────────────────────────────

const isObj = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);

/** The C0 fields a receipt must carry before its core can be recomputed or witnessed. */
export function coreShapeError(core: unknown): string | null {
	if (!isObj(core)) return "core is not an object";
	if (!isObj(core.files) || !Object.values(core.files).every((v) => typeof v === "string")) return "core.files";
	const node = core.node;
	if (
		!isObj(node) ||
		typeof node.version !== "string" ||
		typeof node.execPath !== "string" ||
		typeof node.execSha256 !== "string"
	) {
		return "core.node";
	}
	const nm = core.nodeModules;
	if (
		!isObj(nm) ||
		typeof nm.present !== "boolean" ||
		!(nm.sha256 === null || typeof nm.sha256 === "string") ||
		!Array.isArray(nm.excluded) ||
		!nm.excluded.every((x) => typeof x === "string") ||
		typeof nm.files !== "number" ||
		typeof nm.links !== "number"
	) {
		return "core.nodeModules";
	}
	if (typeof core.sha256 !== "string") return "core.sha256";
	return null;
}

export function checkCoreConsistency(
	files: Record<string, Buffer>,
	collection: Collection,
	independentCoreFiles?: Record<string, string>,
): string[] {
	const errors: string[] = [];
	const shas = new Set<string>();
	for (const a of collection.attempted) {
		if (a.outcome !== "receipt-written" || !a.file || !files[a.file]) continue;
		let core: { files: Record<string, string>; node: unknown; nodeModules: unknown; sha256: string };
		try {
			core = JSON.parse(files[a.file].toString("utf8")).core;
		} catch {
			errors.push(`core-unreadable: ${a.file}`);
			continue;
		}
		const shapeErr = coreShapeError(core);
		if (shapeErr) {
			errors.push(`core-shape: ${a.file} ${shapeErr}`);
			continue;
		}
		const recomputed = coreSha256({ files: core.files, node: core.node, nodeModules: core.nodeModules });
		if (recomputed !== core.sha256)
			errors.push(`core-inconsistent: ${a.file} core.sha256 is not the hash of its own parts`);
		shas.add(recomputed);
		if (independentCoreFiles && canonicalJson(core.files) !== canonicalJson(independentCoreFiles)) {
			errors.push(`core-files-mismatch: ${a.file} CORE_FILES differ from the independent recomputation`);
		}
	}
	if (shas.size > 1) errors.push("core-split: receipts of one collection disagree on C0");
	const [only] = [...shas];
	if (only && only !== collection.candidate.coreSha256) {
		errors.push("core-collection-mismatch: the collection's candidate C0 is not its receipts' C0");
	}
	return errors;
}

// ── admission ───────────────────────────────────────────────────────────────

export interface ArtifactInput {
	runId: string;
	runAttempt: string;
	headSha: string;
	artifact: ApiArtifact;
	zip: Buffer;
	/** Present for the FINAL SHA only: CORE_FILES recomputed from the final tree. */
	independentCoreFiles?: Record<string, string>;
}

export function admitArtifact(input: ArtifactInput): {
	errors: string[];
	files: Record<string, Buffer> | null;
	collection: Collection | null;
	/** How node/node_modules are known: only as the run's own witness. */
	witness: string;
} {
	const errors: string[] = [];
	const a = input.artifact;
	const tag = `run ${input.runId}#${input.runAttempt}`;
	const witness = `node/node_modules: CI-witnessed by ${tag}, not recomputed here`;
	if (a.name !== artifactName(input.runId, input.runAttempt)) errors.push(`artifact-name: ${a.name}`);
	if (!a.workflow_run || String(a.workflow_run.id) !== input.runId) errors.push(`artifact-run: not produced by ${tag}`);
	if (!a.workflow_run || a.workflow_run.head_sha !== input.headSha)
		errors.push("artifact-head: not produced at this SHA");
	if (a.expired) errors.push("artifact-expired: the evidence is gone");
	const zipSha = createHash("sha256").update(input.zip).digest("hex");
	if (a.digest !== `sha256:${zipSha}`)
		errors.push(`artifact-digest: zip sha256 ${zipSha} vs recorded ${String(a.digest)}`);
	if (errors.length > 0) return { errors, files: null, collection: null, witness };

	const z = readZipEntries(input.zip);
	if (z.errors.length > 0) return { errors: z.errors, files: null, collection: null, witness };
	const { errors: cErrors, collection } = checkCollectionData(mapReader(z.files), Object.keys(z.files).sort());
	errors.push(...cErrors);
	if (!collection) return { errors, files: null, collection: null, witness };
	if (collection.runId !== input.runId || collection.runAttempt !== input.runAttempt) {
		errors.push(`collection-run: records ${collection.runId}#${collection.runAttempt}, artifact is ${tag}`);
	}
	if (collection.candidate.head !== input.headSha) errors.push("collection-head: measured another SHA");
	errors.push(...checkCoreConsistency(z.files, collection, input.independentCoreFiles));
	return { errors, files: errors.length === 0 ? z.files : null, collection, witness };
}
