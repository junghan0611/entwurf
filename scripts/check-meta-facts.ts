/**
 * check-meta-facts — deterministic gate for the #65 owner-normalized store
 * projection (`entwurf meta-facts` / scripts/meta-facts.ts).
 *
 * Drives the REAL CLI as a subprocess against sandboxed fixture stores (never the
 * live store; every path is an explicit mkdtemp dir). What it proves:
 *
 *   - the join is the FULL verbatim strict 9-field v3 record — gardenId,
 *     nativeSessionId AND transcriptPath cross together, sorted by gardenId;
 *   - drift / symlink / invalid-UTF-8 entries become in-band defects with exit 0,
 *     and a symlinked record's target bytes are never followed into the join;
 *   - the projection carries the owner's listing semantics, not a copy: a
 *     schema-invalid rival is dropped by parse BEFORE the uniqueness pass and can
 *     never quarantine a healthy citizen; a true duplicate pair loses BOTH sides;
 *   - output is byte-deterministic across runs;
 *   - a missing store is a readable EMPTY store (exit 0), an unreadable store is
 *     exit 3 with NO JSON (never mistakable for empty), bad argv is exit 2;
 *   - the surface is reachable: run.sh dispatches it and the bridge build emits
 *     its compiled twin (the installed-host fence).
 *
 * The gate spawns the CLI rather than importing its pieces because the exit code
 * and stdout bytes ARE the contract a consumer holds. Every [QK:MF-*] token
 * appears exactly once, on the assertion that fails for that claim.
 */

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
	type MetaCitizenBackend,
	type MetaIdentity,
	serializeMetaIdentity,
} from "../pi-extensions/lib/meta-session.ts";

let passed = 0;
function ok(label: string, cond: boolean): void {
	assert.ok(cond, label);
	console.log(`  ok    ${label}`);
	passed++;
}

const GID_A = "20260611T111111-aaaaaa";
const GID_B = "20260611T222222-bbbbbb";
const GID_C = "20260611T333333-cccccc";

function record(gardenId: string, over: Partial<MetaIdentity> = {}): string {
	const backend: MetaCitizenBackend = "pi";
	return serializeMetaIdentity({
		schemaVersion: 3,
		gardenId,
		backend,
		nativeSessionId: `n-${gardenId}`,
		cwd: "/x",
		model: "provider/model",
		transcriptPath: `/t/${gardenId}.jsonl`,
		createdAt: "2026-06-11T00:00:00.000Z",
		recordUpdatedAt: "2026-06-11T00:00:00.000Z",
		...over,
	});
}

function store(files: Record<string, string | Buffer>): string {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "entwurf-meta-facts-"));
	for (const [name, body] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), body);
	return dir;
}

interface CliRun {
	status: number | null;
	stdout: string;
	stderr: string;
}

function cli(args: string[], env: Record<string, string> = {}): CliRun {
	const res = spawnSync(process.execPath, ["--experimental-strip-types", "scripts/meta-facts.ts", ...args], {
		encoding: "utf8",
		env: { ...process.env, ...env },
	});
	return { status: res.status, stdout: res.stdout ?? "", stderr: res.stderr ?? "" };
}

interface Projection {
	schemaVersion: number;
	storeDir: string;
	citizens: MetaIdentity[];
	defects: { filename: string; message: string }[];
}

function parseProjection(run: CliRun, label: string): Projection {
	assert.equal(run.status, 0, `${label}: exit 0 (stderr: ${run.stderr})`);
	return JSON.parse(run.stdout) as Projection;
}

// ── full verbatim join, sorted, deterministic ───────────────────────────────
{
	const dir = store({
		[`${GID_B}.meta.json`]: record(GID_B),
		[`${GID_A}.meta.json`]: record(GID_A, { model: null, transcriptPath: null }),
	});
	const run = cli([dir]);
	const facts = parseProjection(run, "valid store");
	ok(
		"projection declares schemaVersion 1 and the resolved storeDir",
		facts.schemaVersion === 1 && facts.storeDir === path.resolve(dir),
	);
	assert.deepEqual(
		facts.citizens,
		[
			{
				schemaVersion: 3,
				gardenId: GID_A,
				backend: "pi",
				nativeSessionId: `n-${GID_A}`,
				cwd: "/x",
				model: null,
				transcriptPath: null,
				createdAt: "2026-06-11T00:00:00.000Z",
				recordUpdatedAt: "2026-06-11T00:00:00.000Z",
			},
			{
				schemaVersion: 3,
				gardenId: GID_B,
				backend: "pi",
				nativeSessionId: `n-${GID_B}`,
				cwd: "/x",
				model: "provider/model",
				transcriptPath: `/t/${GID_B}.jsonl`,
				createdAt: "2026-06-11T00:00:00.000Z",
				recordUpdatedAt: "2026-06-11T00:00:00.000Z",
			},
		],
		"[QK:MF-FULL-V3-JOIN] citizens are the full verbatim 9-field v3 records, sorted by gardenId",
	);
	console.log("  ok    citizens are the full verbatim 9-field v3 records, sorted by gardenId");
	passed++;
	ok("valid store has no defects", facts.defects.length === 0);
	const again = cli([dir]);
	ok("two runs over one store are byte-identical", again.status === 0 && again.stdout === run.stdout);
	// default-dir resolution rides the same env override every runtime surface uses
	const viaEnv = cli([], { ENTWURF_META_SESSIONS_DIR: dir });
	ok(
		"no argv resolves the store through ENTWURF_META_SESSIONS_DIR",
		viaEnv.status === 0 && viaEnv.stdout === run.stdout,
	);
}

// ── drift / symlink / invalid UTF-8 are in-band defects, exit 0 ─────────────
{
	const outside = fs.mkdtempSync(path.join(os.tmpdir(), "entwurf-meta-facts-outside-"));
	fs.writeFileSync(path.join(outside, "foreign.meta.json"), record(GID_C));
	const dir = store({
		[`${GID_A}.meta.json`]: record(GID_A),
		[`${GID_B}.meta.json`]: record(GID_C), // body gid ≠ filename → drift
		"20260611T444444-dddddd.meta.json": Buffer.from([0xff, 0xfe, 0x00, 0x7b]), // invalid UTF-8
	});
	fs.symlinkSync(path.join(outside, "foreign.meta.json"), path.join(dir, "20260611T555555-eeeeee.meta.json"));
	const facts = parseProjection(cli([dir]), "defective store");
	ok(
		"[QK:MF-DEFECTS-IN-BAND] drift + symlink + invalid UTF-8 are in-band defects and the store still answers exit 0",
		facts.defects.length === 3 && facts.citizens.length === 1 && facts.citizens[0]?.gardenId === GID_A,
	);
	ok(
		"a symlinked record's target bytes are never followed into the join",
		!facts.citizens.some((c) => c.gardenId === GID_C) &&
			facts.defects.some((d) => d.message.includes("not a regular file")),
	);
	ok(
		"drift and invalid-UTF-8 defects carry their own causes",
		facts.defects.some((d) => d.message.includes("drift")) &&
			facts.defects.some((d) => d.message.includes("not valid JSON")),
	);
}

// ── parse-before-uniqueness: a schema-invalid rival never quarantines ───────
{
	const rival = record(GID_B, { nativeSessionId: `n-${GID_A}` }).replace('"schemaVersion": 3', '"schemaVersion": 2');
	const dir = store({
		[`${GID_A}.meta.json`]: record(GID_A),
		[`${GID_B}.meta.json`]: rival,
	});
	const facts = parseProjection(cli([dir]), "invalid rival");
	ok(
		"a schema-invalid rival is a defect and the healthy citizen stays listed",
		facts.citizens.length === 1 &&
			facts.citizens[0]?.gardenId === GID_A &&
			facts.defects.length === 1 &&
			facts.defects[0]?.filename === `${GID_B}.meta.json`,
	);
}

// ── no-winner duplicates: both rivals leave the join ────────────────────────
{
	const dir = store({
		[`${GID_A}.meta.json`]: record(GID_A, { nativeSessionId: "n-shared" }),
		[`${GID_B}.meta.json`]: record(GID_B, { nativeSessionId: "n-shared" }),
		[`${GID_C}.meta.json`]: record(GID_C),
	});
	const facts = parseProjection(cli([dir]), "duplicate pair");
	ok(
		"a duplicate nativeSessionId pair loses BOTH sides; the unrelated citizen keeps listing",
		facts.citizens.length === 1 && facts.citizens[0]?.gardenId === GID_C && facts.defects.length === 2,
	);
}

// ── missing store = readable EMPTY store ────────────────────────────────────
{
	const gone = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "entwurf-meta-facts-")), "never-created");
	const facts = parseProjection(cli([gone]), "missing store");
	ok(
		"a store that does not exist is a readable empty store (ENOENT only)",
		facts.citizens.length === 0 && facts.defects.length === 0,
	);
}

// ── unreadable store = exit 3, NO JSON ──────────────────────────────────────
{
	const base = fs.mkdtempSync(path.join(os.tmpdir(), "entwurf-meta-facts-"));
	const file = path.join(base, "not-a-dir");
	fs.writeFileSync(file, "plain file");
	const run = cli([path.join(file, "store")]); // ENOTDIR: the path runs THROUGH a regular file
	ok(
		"[QK:MF-EXIT-UNREADABLE] an unreadable store is exit 3 with no JSON — never mistakable for an empty one",
		run.status === 3 && run.stdout === "" && run.stderr.includes("FAIL"),
	);
}

// ── usage ───────────────────────────────────────────────────────────────────
{
	ok("[QK:MF-USAGE] two positional args are a usage error (exit 2)", cli(["/a", "/b"]).status === 2);
	ok("a dash argv is a usage error, not a store directory", cli(["--help"]).status === 2);
}

// ── reachability: dispatch + compiled twin ──────────────────────────────────
{
	const runSh = fs.readFileSync("run.sh", "utf8");
	ok(
		"run.sh dispatches the meta-facts operator verb through run_ts",
		/^ {2}meta-facts\)$/m.test(runSh) && runSh.includes("run_ts scripts/meta-facts.ts"),
	);
	const build = fs.readFileSync("mcp/entwurf-bridge/tsconfig.build.json", "utf8");
	ok(
		"the bridge build emits the compiled twin an installed host needs",
		build.includes('"../../scripts/meta-facts.ts"'),
	);
}

console.log(`check-meta-facts: ${passed} checks passed`);
