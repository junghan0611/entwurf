#!/usr/bin/env node
/**
 * emit-pi-durable-carrier — the MAINTAINER's one path from upstream source to the pi-durable
 * carrier (#130). An operator never runs it: an installed package carries the emitted JS and reads
 * no upstream source.
 *
 *   node scripts/emit-pi-durable-carrier.ts --source <git repository holding the pinned commit> --write
 *   node scripts/emit-pi-durable-carrier.ts --source <git repository holding the pinned commit> --check
 *
 * Inputs, and nothing else: the pinned commit's OBJECTS (each declared file and the license, read as
 * `<commit>:<path>` — never a worktree, so the repository's checkout state cannot enter), the packaged
 * overlay patch, and this Node's `stripTypeScriptTypes` in strip mode (upstream runs these exact
 * sources under Node's strip-only TypeScript). The patch is applied by git's own engine to a private
 * scratch copy; the base blob and the patched result must carry the blob ids the patch's `index` line
 * names. Each stripped file is then relocated by pi/pi-durable/carrier-relocation.mjs, and the targets
 * the six files import must equal the pin's declared `distTargets` exactly.
 *
 * `--write` emits pi/pi-durable/carrier/{<files>,LICENSE} and fills the pin's generated fields
 * (source blob ids, emitted sha256s, the Node version). `--check` re-emits in memory and compares:
 * equal is the rebuild acceptance; any difference, another Node version, or an undeclared file in the
 * carrier directory is a named FAIL. `--check` without a source holding the commit is a named SKIP —
 * an unavailable observation, never rebuild acceptance. Read-only against the source repository.
 *
 * Exit: 0 written / equal, 1 named refusal or drift, 2 usage, 97 skip (no source).
 */

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import * as os from "node:os";
import * as path from "node:path";
import { relocateCarrierSource } from "../pi/pi-durable/carrier-relocation.mjs";
import { skipLive } from "./lib/live-skip.ts";

const ROOT = path.resolve(import.meta.dirname, "..");
const DURABLE = path.join(ROOT, "pi", "pi-durable");
const PIN_PATH = path.join(DURABLE, "overlay", "upstream-pin.json");
const CARRIER_DIR = path.join(DURABLE, "carrier");
const LICENSE_NAME = "LICENSE";
const EMITTER_TOOL = "node:module.stripTypeScriptTypes";
const EMITTER_MODE = "strip";
const GIT_TIMEOUT_MS = 30_000;

interface CarrierFile {
	name: string;
	source: string;
	patched: boolean;
	blob: string;
	sha256: string;
}

interface CarrierPin {
	schemaVersion: number;
	commit: string;
	patches: string[];
	carrier: {
		emitter: { tool: string; mode: string; node: string };
		license: { source: string; blob: string; sha256: string };
		files: CarrierFile[];
		distTargets: string[];
	};
}

class Refusal extends Error {}
const refuse = (reason: string, detail: string): Refusal => new Refusal(`${reason}: ${detail}`);

const sha256 = (data: Buffer): string => createHash("sha256").update(data).digest("hex");
/** git's blob id, computed here so no object is ever written into the source repository. */
const blobId = (data: Buffer): string =>
	createHash("sha1")
		.update(Buffer.concat([Buffer.from(`blob ${data.length}\0`), data]))
		.digest("hex");

/** The environment every git child gets: no inherited repository, index or work-tree redirection. */
function gitEnv(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
	const env: NodeJS.ProcessEnv = { GIT_OPTIONAL_LOCKS: "0", ...extra };
	for (const [key, value] of Object.entries(process.env)) {
		if (!key.startsWith("GIT_") && env[key] === undefined) env[key] = value;
	}
	return env;
}

/** Every read of the source repository: `--no-replace-objects`, so a `refs/replace/*` entry (or a
 * replacement reached through alternates) can never stand in for a pinned object. */
export function sourceGitArgs(source: string, args: readonly string[]): string[] {
	return ["--no-replace-objects", "-C", source, ...args];
}

/** One pinned object's bytes, `<commit>:<path>`, as the source repository stores it. */
export function readSourceObject(source: string, rev: string): Buffer {
	return git(source, ["cat-file", "blob", rev]);
}

function git(source: string, args: string[]): Buffer {
	const run = spawnSync("git", sourceGitArgs(source, args), {
		env: gitEnv(),
		maxBuffer: 64 * 1024 * 1024,
		timeout: GIT_TIMEOUT_MS,
	});
	if (run.status !== 0) {
		throw refuse(
			"carrier-source-unreadable",
			`git ${args.join(" ")} in ${source}: ${run.stderr?.toString().trim() || run.error?.message || `status ${run.status}`}`,
		);
	}
	return run.stdout;
}

function readPin(): CarrierPin {
	const pin = JSON.parse(fs.readFileSync(PIN_PATH, "utf8")) as CarrierPin;
	if (pin.schemaVersion !== 2 || !/^[0-9a-f]{40}$/.test(pin.commit) || pin.patches?.length !== 1) {
		throw refuse("carrier-pin-malformed", `${PIN_PATH}: schemaVersion 2, a full commit and one patch are required`);
	}
	if (pin.carrier.emitter.tool !== EMITTER_TOOL || pin.carrier.emitter.mode !== EMITTER_MODE) {
		throw refuse(
			"carrier-pin-malformed",
			`the emitter is ${EMITTER_TOOL} in ${EMITTER_MODE} mode, not ${JSON.stringify(pin.carrier.emitter)}`,
		);
	}
	if (pin.carrier.files.filter((f) => f.patched).length !== 1) {
		throw refuse("carrier-pin-malformed", "exactly one carrier file carries the overlay patch");
	}
	return pin;
}

/** The overlay patch's one file and the two blob ids its `index` line names. */
function readPatch(pin: CarrierPin): { bytes: Buffer; file: string; base: string; result: string } {
	const bytes = fs.readFileSync(path.join(DURABLE, "overlay", pin.patches[0]));
	const text = bytes.toString("utf8");
	const files = [...text.matchAll(/^diff --git a\/(\S+) b\/(\S+)$/gm)];
	const index = [...text.matchAll(/^index ([0-9a-f]+)\.\.([0-9a-f]+) 100644$/gm)];
	if (files.length !== 1 || files[0][1] !== files[0][2] || index.length !== 1) {
		throw refuse("carrier-patch-shape", `${pin.patches[0]} must change exactly one existing file`);
	}
	return { bytes, file: files[0][1], base: index[0][1], result: index[0][2] };
}

/** `base` with the patch applied by git, in a private scratch tree outside any repository. */
function applyPatch(file: string, base: Buffer, patch: Buffer): Buffer {
	const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "pi-durable-carrier-"));
	try {
		const target = path.join(scratch, file);
		fs.mkdirSync(path.dirname(target), { recursive: true });
		fs.writeFileSync(target, base);
		const patchFile = path.join(scratch, "overlay.patch");
		fs.writeFileSync(patchFile, patch);
		const run = spawnSync("git", ["apply", "--whitespace=nowarn", "overlay.patch"], {
			cwd: scratch,
			env: gitEnv({ GIT_CEILING_DIRECTORIES: path.dirname(scratch) }),
			timeout: GIT_TIMEOUT_MS,
		});
		if (run.status !== 0) {
			throw refuse("carrier-patch-rejected", run.stderr?.toString().trim() || `git apply status ${run.status}`);
		}
		return fs.readFileSync(target);
	} finally {
		fs.rmSync(scratch, { recursive: true, force: true });
	}
}

interface Emission {
	files: Map<string, Buffer>;
	generated: {
		node: string;
		license: { blob: string; sha256: string };
		files: Map<string, { blob: string; sha256: string }>;
	};
}

function emit(source: string, pin: CarrierPin): Emission {
	if (git(source, ["cat-file", "-t", pin.commit]).toString().trim() !== "commit") {
		throw refuse("carrier-source-unreadable", `${pin.commit} is not a commit in ${source}`);
	}
	const patch = readPatch(pin);
	const names = pin.carrier.files.map((f) => f.name);
	const targets = pin.carrier.distTargets;
	if (new Set(targets).size !== targets.length) throw refuse("carrier-pin-malformed", "distTargets repeats a path");
	const files = new Map<string, Buffer>();
	const generatedFiles = new Map<string, { blob: string; sha256: string }>();
	const used = new Set<string>();
	for (const declared of pin.carrier.files) {
		const original = readSourceObject(source, `${pin.commit}:${declared.source}`);
		const blob = blobId(original);
		let text = original;
		if (declared.patched) {
			if (declared.source !== patch.file || !blob.startsWith(patch.base)) {
				throw refuse(
					"carrier-patch-base",
					`the patch changes ${patch.file} from ${patch.base}; ${declared.source} is ${blob}`,
				);
			}
			text = applyPatch(declared.source, original, patch.bytes);
			if (!blobId(text).startsWith(patch.result)) {
				throw refuse(
					"carrier-patch-result",
					`patched ${declared.source} is ${blobId(text)}, the patch names ${patch.result}`,
				);
			}
		}
		const stripped = stripTypeScriptTypes(text.toString("utf8"), { mode: EMITTER_MODE });
		const relocated = relocateCarrierSource(declared.name, stripped, { siblings: names, targets });
		for (const target of relocated.used) used.add(target);
		const bytes = Buffer.from(relocated.code, "utf8");
		files.set(declared.name, bytes);
		generatedFiles.set(declared.name, { blob, sha256: sha256(bytes) });
	}
	const unused = targets.filter((t) => !used.has(t));
	if (unused.length > 0) throw refuse("carrier-targets-differ", `declared but not imported: ${unused.join(", ")}`);
	const license = readSourceObject(source, `${pin.commit}:${pin.carrier.license.source}`);
	files.set(LICENSE_NAME, license);
	return {
		files,
		generated: {
			node: process.version,
			license: { blob: blobId(license), sha256: sha256(license) },
			files: generatedFiles,
		},
	};
}

/** Files in the carrier directory that the pin does not declare. */
function undeclared(pin: CarrierPin): string[] {
	const declared = new Set([...pin.carrier.files.map((f) => f.name), LICENSE_NAME]);
	const present = fs.existsSync(CARRIER_DIR) ? fs.readdirSync(CARRIER_DIR) : [];
	return present.filter((name) => !declared.has(name)).sort();
}

function write(pin: CarrierPin, emission: Emission): void {
	const extra = undeclared(pin);
	if (extra.length > 0) throw refuse("carrier-undeclared-file", `remove ${extra.join(", ")} from ${CARRIER_DIR} first`);
	fs.mkdirSync(CARRIER_DIR, { recursive: true });
	for (const [name, bytes] of emission.files) fs.writeFileSync(path.join(CARRIER_DIR, name), bytes);
	pin.carrier.emitter.node = emission.generated.node;
	pin.carrier.license.blob = emission.generated.license.blob;
	pin.carrier.license.sha256 = emission.generated.license.sha256;
	for (const file of pin.carrier.files) Object.assign(file, emission.generated.files.get(file.name));
	fs.writeFileSync(PIN_PATH, formatPin(pin));
}

/** The pin as the repository formatter leaves it (biome, tabs, width 120): JSON.stringify, with an array
 * of strings that fits on its line written inline. Values are compared field by field, never as text. */
function formatPin(pin: CarrierPin): string {
	const text = JSON.stringify(pin, null, "\t").replace(
		/^(\t*)("[^"\n]+": )\[\n((?:\t+"[^"\n]*",?\n)+)\t*\]/gm,
		(block: string, indent: string, key: string, items: string) => {
			const inline = `${key}[${items
				.trim()
				.split(/,?\n\t*/)
				.join(", ")}]`;
			return indent.length * 2 + inline.length + 1 <= 120 ? `${indent}${inline}` : block;
		},
	);
	return `${text}\n`;
}

/** Every difference between the committed carrier + pin and a fresh emission. */
function compare(pin: CarrierPin, emission: Emission): string[] {
	const drift: string[] = [];
	if (pin.carrier.emitter.node !== emission.generated.node) {
		drift.push(
			`carrier-emitter-node-mismatch: the carrier was emitted by Node ${pin.carrier.emitter.node || "(none)"}, this is ${emission.generated.node}`,
		);
	}
	const license = emission.generated.license;
	if (pin.carrier.license.blob !== license.blob || pin.carrier.license.sha256 !== license.sha256) {
		drift.push(`carrier-pin-drift: license is ${license.blob}/${license.sha256}`);
	}
	for (const file of pin.carrier.files) {
		const want = emission.generated.files.get(file.name);
		if (file.blob !== want?.blob || file.sha256 !== want?.sha256) {
			drift.push(
				`carrier-pin-drift: ${file.name} pin records ${file.blob}/${file.sha256}, emission is ${want?.blob}/${want?.sha256}`,
			);
		}
	}
	for (const [name, bytes] of emission.files) {
		const onDisk = path.join(CARRIER_DIR, name);
		if (!fs.existsSync(onDisk)) drift.push(`carrier-file-missing: ${name}`);
		else if (!fs.readFileSync(onDisk).equals(bytes))
			drift.push(`carrier-file-drift: ${name} differs from its emission`);
	}
	for (const name of undeclared(pin)) drift.push(`carrier-undeclared-file: ${name}`);
	return drift;
}

function main(argv: readonly string[]): number {
	const sourceAt = argv.indexOf("--source");
	const source = sourceAt === -1 ? undefined : argv[sourceAt + 1];
	const mode = argv.includes("--write") ? "write" : argv.includes("--check") ? "check" : undefined;
	if (mode === undefined || argv.length !== (source === undefined ? 1 : 3) || (sourceAt !== -1 && !source)) {
		console.error(
			"usage: emit-pi-durable-carrier.ts --source <git repository holding the pinned commit> (--write | --check)",
		);
		return 2;
	}
	const pin = readPin();
	if (mode === "check") {
		const held =
			source !== undefined &&
			spawnSync("git", sourceGitArgs(source, ["cat-file", "-e", `${pin.commit}^{commit}`]), {
				env: gitEnv(),
				timeout: GIT_TIMEOUT_MS,
			}).status === 0;
		if (!held) {
			skipLive(
				"emit-pi-durable-carrier --check",
				`no --source repository holding ${pin.commit} — the rebuild was NOT checked; pass a clone of ${(pin as { repository?: string }).repository ?? "upstream"} that contains it`,
			);
		}
	}
	if (source === undefined) {
		console.error("emit-pi-durable-carrier --write needs --source");
		return 2;
	}
	const emission = emit(path.resolve(source), pin);
	if (mode === "write") {
		write(pin, emission);
		console.log(
			`[emit-pi-durable-carrier] wrote ${emission.files.size} files to ${path.relative(ROOT, CARRIER_DIR)} from ${pin.commit} (${emission.generated.node})`,
		);
		return 0;
	}
	const drift = compare(pin, emission);
	if (drift.length > 0) {
		for (const line of drift) console.error(`[emit-pi-durable-carrier] ${line}`);
		return 1;
	}
	console.log(
		`[emit-pi-durable-carrier] ok — the carrier is the emission of ${pin.commit} (${emission.generated.node})`,
	);
	return 0;
}

// Run only when this file is the process entry (argv realpath, as the shipped entries decide it);
// the beside test imports the source-read seam above without emitting anything.
const invokedDirectly = (() => {
	const entry = process.argv[1];
	if (typeof entry !== "string" || entry.length === 0) return false;
	try {
		return fs.realpathSync(entry) === fs.realpathSync(import.meta.filename);
	} catch {
		// Bounded environment probe: an entry that cannot be resolved is not this file.
		return false;
	}
})();
if (invokedDirectly) {
	try {
		process.exitCode = main(process.argv.slice(2));
	} catch (error) {
		if (!(error instanceof Refusal) && !(error instanceof Error && "reason" in error)) throw error;
		console.error(`[emit-pi-durable-carrier] ${error.message}`);
		process.exitCode = 1;
	}
}
