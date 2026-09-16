/**
 * tree-digest — one deterministic digest of a whole directory tree, for gates that claim a tree is
 * UNCHANGED.
 *
 * WHY THIS EXISTS. Two #116 M3-b3 oracles compared a sorted list of relative paths (one of them with
 * sizes) and called the result "byte-identical". A same-length content edit passes both — which is
 * precisely the shape a refusal-must-not-mutate claim needs to catch, because a transaction that
 * rewrites a file in place rarely changes its length. So the digest here reads the actual bytes.
 *
 * WHAT IS IN IT: every entry's relative path, its node TYPE, and for a regular file its permission
 * bits, its size and its whole content; for a symlink its target; for a directory its own entry
 * count, so an emptied directory and a removed one are different facts. That makes the honest claim
 * "content + mode + topology", which is what the callers now say.
 *
 * FRAMING IS LENGTH-PREFIXED. A digest built by concatenating names cannot tell `a/b` + `c` from
 * `a` + `b/c`; every field is therefore written as `label:<byteLength>:<bytes>\0`, so no boundary
 * between two fields can be spelled by the contents of one.
 *
 * MEMORY IS BOUNDED. A runtime tree here is hundreds of megabytes, so files are hashed in 64 KiB
 * chunks through one reused buffer rather than read whole. No `sha256sum`, no shell: a gate that
 * shells out to hash acquires a dependency the hosts it runs on do not owe it.
 */

import { createHash, type Hash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const CHUNK_BYTES = 64 * 1024;

function field(hash: Hash, label: string, value: string | number): void {
	const bytes = Buffer.from(String(value), "utf8");
	hash.update(`${label}:${bytes.length}:`);
	hash.update(bytes);
	hash.update("\0");
}

function hashFileContent(hash: Hash, file: string): void {
	const fd = fs.openSync(file, "r");
	try {
		const buf = Buffer.allocUnsafe(CHUNK_BYTES);
		let read = fs.readSync(fd, buf, 0, CHUNK_BYTES, null);
		while (read > 0) {
			hash.update(buf.subarray(0, read));
			read = fs.readSync(fd, buf, 0, CHUNK_BYTES, null);
		}
	} finally {
		fs.closeSync(fd);
	}
	hash.update("\0");
}

/**
 * The digest of `root`, or the literal `"absent"` when nothing is there.
 *
 * @returns `sha256-<hex>` over content + mode + topology, or `absent`.
 */
export function treeDigest(root: string): string {
	const top = fs.lstatSync(root, { throwIfNoEntry: false });
	if (top === undefined) return "absent";
	const hash = createHash("sha256");
	if (!top.isDirectory()) {
		field(hash, top.isSymbolicLink() ? "root-symlink" : "root-nondir", path.basename(root));
		if (top.isSymbolicLink()) field(hash, "target", fs.readlinkSync(root));
		else if (top.isFile()) hashFileContent(hash, root);
		return `sha256-${hash.digest("hex")}`;
	}
	const walk = (dir: string): void => {
		const entries = fs
			.readdirSync(dir, { withFileTypes: true })
			.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
		field(hash, "dir", path.relative(root, dir) || ".");
		field(hash, "entries", entries.length);
		for (const entry of entries) {
			const abs = path.join(dir, entry.name);
			const rel = path.relative(root, abs);
			if (entry.isSymbolicLink()) {
				field(hash, "symlink", rel);
				field(hash, "target", fs.readlinkSync(abs));
			} else if (entry.isDirectory()) {
				field(hash, "subdir", rel);
			} else if (entry.isFile()) {
				const stat = fs.statSync(abs);
				field(hash, "file", rel);
				field(hash, "mode", (stat.mode & 0o7777).toString(8));
				field(hash, "size", stat.size);
				hashFileContent(hash, abs);
			} else {
				field(hash, "other", rel);
			}
		}
		for (const entry of entries) {
			if (entry.isDirectory() && !entry.isSymbolicLink()) walk(path.join(dir, entry.name));
		}
	};
	walk(root);
	return `sha256-${hash.digest("hex")}`;
}
