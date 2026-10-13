#!/usr/bin/env node
/**
 * emit-pi-durable-carrier — the MAINTAINER's one path from the owned pi-durable source to the carrier
 * (#130, #141). An operator never runs it: an installed package carries the emitted JS and reads no
 * TypeScript.
 *
 *   node scripts/emit-pi-durable-carrier.ts --check
 *   node scripts/emit-pi-durable-carrier.ts --write
 *   node scripts/emit-pi-durable-carrier.ts --origin <git repository holding origin.commit>
 *
 * Inputs, and nothing else: the in-repo source the pin's `carrier.files[].source` and
 * `carrier.license.source` name (pi/pi-durable/src, Entwurf's canonical thin composition), and this
 * Node's `stripTypeScriptTypes` in strip mode. Each stripped file is relocated by
 * pi/pi-durable/carrier-relocation.mjs, and the targets the files import must equal the pin's declared
 * `distTargets` exactly. A missing source file is a named refusal, never a skipped rebuild.
 *
 * `--check` re-emits in memory and compares. The byte proof (carrier == relocate(strip(source)), with the
 * pin's blob ids and digests) is unconditional. The emitter's Node identity is a separate fact: under
 * another Node the bytes are still compared, but equal bytes are NOT a rebuild PASS — the identity is a
 * named SKIP, red under ENTWURF_REQUIRE_EMITTER_NODE=1 (the CI check job, which runs the pinned Node).
 * `--write` emits pi/pi-durable/carrier/{<files>,LICENSE} and fills the pin's generated fields (source blob
 * ids, emitted sha256s, the Node version), printing every generated field it changes. `--origin` is
 * provenance only: it checks the frozen `origin` record against the upstream objects it names, read as
 * `<commit>:<path>` with `--no-replace-objects`; it never feeds a rebuild.
 *
 * Exit: 0 written / equal / origin matches, 1 named refusal or drift, 2 usage, 97 skip (Node identity
 * unverified, or no repository holding the origin commit).
 */

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import * as path from "node:path";
import { relocateCarrierSource } from "../pi/pi-durable/carrier-relocation.mjs";
import { skipLive } from "./lib/live-skip.ts";

const ROOT = path.resolve(import.meta.dirname, "..");
const DURABLE = path.join(ROOT, "pi", "pi-durable");
const PIN_PATH = path.join(DURABLE, "overlay", "upstream-pin.json");
const CARRIER_DIR = path.join(DURABLE, "carrier");
const SOURCE_ROOT = "pi/pi-durable/src/";
const LICENSE_NAME = "LICENSE";
const EMITTER_TOOL = "node:module.stripTypeScriptTypes";
const EMITTER_MODE = "strip";
const GIT_TIMEOUT_MS = 30_000;

interface CarrierFile {
	name: string;
	source: string;
	blob: string;
	sha256: string;
}

export interface CarrierPin {
	schemaVersion: number;
	origin: {
		repository: string;
		tag: string;
		commit: string;
		license: { path: string; blob: string };
		files: { path: string; blob: string }[];
	};
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
/** git's blob id, computed here so no object is ever written into any repository. */
const blobId = (data: Buffer): string =>
	createHash("sha1")
		.update(Buffer.concat([Buffer.from(`blob ${data.length}\0`), data]))
		.digest("hex");

/** The environment every git child gets: no inherited repository, index or work-tree redirection. */
function gitEnv(): NodeJS.ProcessEnv {
	const env: NodeJS.ProcessEnv = { GIT_OPTIONAL_LOCKS: "0" };
	for (const [key, value] of Object.entries(process.env)) {
		if (!key.startsWith("GIT_") && env[key] === undefined) env[key] = value;
	}
	return env;
}

/** Every read of the origin repository: `--no-replace-objects`, so a `refs/replace/*` entry (or a
 * replacement reached through alternates) can never stand in for a recorded object. */
export function sourceGitArgs(source: string, args: readonly string[]): string[] {
	return ["--no-replace-objects", "-C", source, ...args];
}

/** One recorded object's bytes, `<commit>:<path>`, as the origin repository stores it. */
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
			"carrier-origin-unreadable",
			`git ${args.join(" ")} in ${source}: ${run.stderr?.toString().trim() || run.error?.message || `status ${run.status}`}`,
		);
	}
	return run.stdout;
}

/** A pin-declared source path: a plain relative file under pi/pi-durable/src. */
const ownedSource = (rel: unknown): rel is string =>
	typeof rel === "string" && rel.startsWith(SOURCE_ROOT) && !rel.split("/").includes("..") && !rel.includes("\\");

export function readPin(file = PIN_PATH): CarrierPin {
	const pin = JSON.parse(fs.readFileSync(file, "utf8")) as CarrierPin;
	if (pin.schemaVersion !== 3 || !/^[0-9a-f]{40}$/.test(pin.origin?.commit ?? "")) {
		throw refuse("carrier-pin-malformed", `${file}: schemaVersion 3 with a full origin commit is required`);
	}
	if (pin.carrier.emitter.tool !== EMITTER_TOOL || pin.carrier.emitter.mode !== EMITTER_MODE) {
		throw refuse(
			"carrier-pin-malformed",
			`the emitter is ${EMITTER_TOOL} in ${EMITTER_MODE} mode, not ${JSON.stringify(pin.carrier.emitter)}`,
		);
	}
	const sources = [...pin.carrier.files.map((f) => f.source), pin.carrier.license.source];
	const outside = sources.filter((s) => !ownedSource(s));
	if (outside.length > 0) {
		throw refuse("carrier-pin-malformed", `carrier sources must be files under ${SOURCE_ROOT}: ${outside.join(", ")}`);
	}
	return pin;
}

/** An owned source file's bytes. Absent or not a regular file is a named refusal: the source is in this
 * repository, so there is no "unavailable source" to skip over. */
function readOwnedSource(rel: string): Buffer {
	const at = path.join(ROOT, rel);
	let regular = false;
	try {
		regular = fs.lstatSync(at).isFile();
	} catch {
		// Bounded environment probe: an absent path is the refusal below.
	}
	if (!regular) throw refuse("carrier-source-missing", `${rel} is not a regular file in this checkout`);
	return fs.readFileSync(at);
}

export interface Emission {
	files: Map<string, Buffer>;
	generated: {
		node: string;
		license: { blob: string; sha256: string };
		files: Map<string, { blob: string; sha256: string }>;
	};
}

export function emitCarrier(pin: CarrierPin, read: (rel: string) => Buffer = readOwnedSource): Emission {
	const names = pin.carrier.files.map((f) => f.name);
	const targets = pin.carrier.distTargets;
	if (new Set(targets).size !== targets.length) throw refuse("carrier-pin-malformed", "distTargets repeats a path");
	const files = new Map<string, Buffer>();
	const generatedFiles = new Map<string, { blob: string; sha256: string }>();
	const used = new Set<string>();
	for (const declared of pin.carrier.files) {
		const source = read(declared.source);
		const stripped = stripTypeScriptTypes(source.toString("utf8"), { mode: EMITTER_MODE });
		const relocated = relocateCarrierSource(declared.name, stripped, { siblings: names, targets });
		for (const target of relocated.used) used.add(target);
		const bytes = Buffer.from(relocated.code, "utf8");
		files.set(declared.name, bytes);
		generatedFiles.set(declared.name, { blob: blobId(source), sha256: sha256(bytes) });
	}
	const unused = targets.filter((t) => !used.has(t));
	if (unused.length > 0) throw refuse("carrier-targets-differ", `declared but not imported: ${unused.join(", ")}`);
	const license = read(pin.carrier.license.source);
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
function undeclared(pin: CarrierPin, carrierDir: string): string[] {
	const declared = new Set([...pin.carrier.files.map((f) => f.name), LICENSE_NAME]);
	const present = fs.existsSync(carrierDir) ? fs.readdirSync(carrierDir) : [];
	return present.filter((name) => !declared.has(name)).sort();
}

/** The pin's generated fields as `field value` pairs, for a write that names what it changed. */
function generatedFields(pin: CarrierPin): Map<string, string> {
	const fields = new Map<string, string>([
		["carrier.emitter.node", pin.carrier.emitter.node],
		["carrier.license.blob", pin.carrier.license.blob],
		["carrier.license.sha256", pin.carrier.license.sha256],
	]);
	for (const f of pin.carrier.files) {
		fields.set(`${f.name} blob`, f.blob);
		fields.set(`${f.name} sha256`, f.sha256);
	}
	return fields;
}

function write(pin: CarrierPin, emission: Emission): string[] {
	const extra = undeclared(pin, CARRIER_DIR);
	if (extra.length > 0) throw refuse("carrier-undeclared-file", `remove ${extra.join(", ")} from ${CARRIER_DIR} first`);
	const before = generatedFields(pin);
	fs.mkdirSync(CARRIER_DIR, { recursive: true });
	for (const [name, bytes] of emission.files) fs.writeFileSync(path.join(CARRIER_DIR, name), bytes);
	pin.carrier.emitter.node = emission.generated.node;
	pin.carrier.license.blob = emission.generated.license.blob;
	pin.carrier.license.sha256 = emission.generated.license.sha256;
	for (const file of pin.carrier.files) Object.assign(file, emission.generated.files.get(file.name));
	fs.writeFileSync(PIN_PATH, formatPin(pin));
	const changed: string[] = [];
	for (const [field, value] of generatedFields(pin)) {
		if (before.get(field) !== value) changed.push(`${field}: ${before.get(field) || "(none)"} -> ${value}`);
	}
	return changed;
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

/** Every byte difference between the committed carrier + pin and a fresh emission. The Node that emitted
 * is not one of them: that is emitterNodeDrift's fact, kept apart so it can never be read as bytes. */
export function compareCarrier(pin: CarrierPin, emission: Emission, carrierDir = CARRIER_DIR): string[] {
	const drift: string[] = [];
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
		const onDisk = path.join(carrierDir, name);
		if (!fs.existsSync(onDisk)) drift.push(`carrier-file-missing: ${name}`);
		else if (!fs.readFileSync(onDisk).equals(bytes))
			drift.push(`carrier-file-drift: ${name} differs from its emission`);
	}
	for (const name of undeclared(pin, carrierDir)) drift.push(`carrier-undeclared-file: ${name}`);
	return drift;
}

/** The emitter identity: the carrier's recorded Node against the one running now, exactly. */
export function emitterNodeDrift(pinned: string, running: string): string | undefined {
	if (pinned !== running) {
		return `carrier-emitter-node-mismatch: the carrier was emitted by Node ${pinned || "(none)"}, this is ${running}`;
	}
	return undefined;
}

/** The frozen origin record against the upstream objects it names. Provenance, never rebuild input. */
function checkOrigin(repo: string, pin: CarrierPin): string[] {
	const { origin } = pin;
	if (git(repo, ["cat-file", "-t", origin.commit]).toString().trim() !== "commit") {
		throw refuse("carrier-origin-unreadable", `${origin.commit} is not a commit in ${repo}`);
	}
	const drift: string[] = [];
	for (const recorded of [...origin.files, origin.license]) {
		const blob = blobId(readSourceObject(repo, `${origin.commit}:${recorded.path}`));
		if (blob !== recorded.blob) {
			drift.push(
				`carrier-origin-drift: ${recorded.path} is ${blob} at ${origin.commit}, the pin records ${recorded.blob}`,
			);
		}
	}
	return drift;
}

function main(argv: readonly string[]): number {
	const mode = argv[0];
	const repo = argv[1];
	if (
		!((mode === "--check" || mode === "--write") && argv.length === 1) &&
		!(mode === "--origin" && argv.length === 2 && repo)
	) {
		console.error(
			"usage: emit-pi-durable-carrier.ts (--check | --write | --origin <git repository holding origin.commit>)",
		);
		return 2;
	}
	const pin = readPin();
	if (mode === "--origin") {
		const held =
			spawnSync("git", sourceGitArgs(path.resolve(repo), ["cat-file", "-e", `${pin.origin.commit}^{commit}`]), {
				env: gitEnv(),
				timeout: GIT_TIMEOUT_MS,
			}).status === 0;
		if (!held) {
			skipLive(
				"emit-pi-durable-carrier --origin",
				`${repo} does not hold ${pin.origin.commit} — provenance was NOT checked; pass a clone of ${pin.origin.repository} that contains it`,
			);
		}
		const drift = checkOrigin(path.resolve(repo), pin);
		if (drift.length > 0) {
			for (const line of drift) console.error(`[emit-pi-durable-carrier] ${line}`);
			return 1;
		}
		console.log(
			`[emit-pi-durable-carrier] origin ok — ${pin.origin.files.length} files and the license are the recorded objects of ${pin.origin.commit} (provenance only, not a rebuild)`,
		);
		return 0;
	}
	const emission = emitCarrier(pin);
	if (mode === "--write") {
		const changed = write(pin, emission);
		for (const line of changed) console.error(`[emit-pi-durable-carrier] changed ${line}`);
		console.log(
			`[emit-pi-durable-carrier] wrote ${emission.files.size} files to ${path.relative(ROOT, CARRIER_DIR)} from ${SOURCE_ROOT} (${emission.generated.node}); ${changed.length} generated field(s) changed`,
		);
		return 0;
	}
	const drift = compareCarrier(pin, emission);
	if (drift.length > 0) {
		for (const line of drift) console.error(`[emit-pi-durable-carrier] ${line}`);
		return 1;
	}
	const node = emitterNodeDrift(pin.carrier.emitter.node, emission.generated.node);
	if (node !== undefined) {
		if (process.env.ENTWURF_REQUIRE_EMITTER_NODE === "1") {
			console.error(`[emit-pi-durable-carrier] ${node} (ENTWURF_REQUIRE_EMITTER_NODE=1)`);
			return 1;
		}
		skipLive(
			"emit-pi-durable-carrier --check",
			`the carrier bytes equal their emission from ${SOURCE_ROOT}, but ${node} — the emitter identity was NOT checked, so this is no rebuild PASS; run it under ${pin.carrier.emitter.node}`,
		);
	}
	console.log(
		`[emit-pi-durable-carrier] ok — the carrier is the emission of ${SOURCE_ROOT} (${emission.generated.node})`,
	);
	return 0;
}

// Run only when this file is the process entry (argv realpath, as the shipped entries decide it);
// the beside test imports the seams above without emitting anything.
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
