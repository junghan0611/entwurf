// Source-only CLI/asset fixtures: no model, real capture, publication or operator state.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";

const REPO = path.resolve(import.meta.dirname, "..");
function fixture(): { root: string; env: NodeJS.ProcessEnv; calls: string } {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "demo-maintenance-test-"));
	const bin = path.join(root, "bin");
	fs.mkdirSync(bin);
	const calls = path.join(root, "calls");
	for (const name of ["pi", "claude", "herdr", "tmux", "asciinema", "agg", "ffprobe", "gifsicle", "sleep"]) {
		fs.writeFileSync(path.join(bin, name), '#!/bin/sh\nprintf "%s\\n" "$0" >> "$DEMO_TEST_CALLS"\nexit 81\n', {
			mode: 0o755,
		});
	}
	const env: NodeJS.ProcessEnv = {
		...process.env,
		PATH: `${bin}${path.delimiter}${process.env.PATH ?? ""}`,
		DEMO_TEST_CALLS: calls,
	};
	for (const key of Object.keys(env))
		if (
			key.startsWith("ENTWURF_") ||
			key.startsWith("HERDR_") ||
			key.endsWith("BASE_URL") ||
			["LIVE", "TMUX", "TMUX_PANE", "PI_SESSION_ID", "PI_AGENT_ID", "CLAUDECODE"].includes(key)
		)
			delete env[key];
	for (const key of [
		"HOME",
		"PI_CODING_AGENT_DIR",
		"XDG_CONFIG_HOME",
		"XDG_DATA_HOME",
		"XDG_STATE_HOME",
		"XDG_CACHE_HOME",
		"XDG_RUNTIME_DIR",
	]) {
		const dir = path.join(root, key);
		fs.mkdirSync(dir, { mode: 0o700 });
		env[key] = dir;
	}
	// Keep every writable take/temporary root inside the fixture, even if LIVE admission regresses.
	for (const key of ["ENTWURF_DEMO_OUT", "TMPDIR"]) {
		const dir = path.join(root, key);
		fs.mkdirSync(dir, { mode: 0o700 });
		env[key] = dir;
	}
	return { root, env, calls };
}

function archivedRefusal(file: string): { exit: number | null; calls: boolean; unchanged: boolean } {
	const f = fixture();
	try {
		fs.mkdirSync(path.join(f.root, "demo"));
		fs.mkdirSync(path.join(f.root, "docs", "assets"), { recursive: true });
		const asset = path.join(f.root, "docs", "assets", "entwurf-demo.gif");
		fs.writeFileSync(asset, "approved fixture pixels");
		const script = path.join(f.root, "demo", file);
		fs.copyFileSync(path.join(REPO, "demo", file), script);
		const run = spawnSync("bash", [script], { env: { ...f.env, LIVE: "1" }, encoding: "utf8", timeout: 5000 });
		return {
			exit: run.status,
			calls: fs.existsSync(f.calls),
			unchanged: fs.readFileSync(asset, "utf8") === "approved fixture pixels",
		};
	} finally {
		fs.rmSync(f.root, { recursive: true, force: true });
	}
}

test("archived baseline refuses before any command or asset write, even LIVE=1", () => {
	assert.deepEqual(
		archivedRefusal("demo-baseline.sh"),
		{ exit: 2, calls: false, unchanged: true },
		"[QK:DEMO-BASELINE-ARCHIVED] the retired baseline must not reach models or published assets",
	);
});
test("archived peer scene refuses before any command or asset write, even LIVE=1", () => {
	assert.deepEqual(
		archivedRefusal("demo.sh"),
		{ exit: 2, calls: false, unchanged: true },
		"[QK:DEMO-PEER-ARCHIVED] the retired peer scene must not reach models or published assets",
	);
});

const TAKE_FILES = ["take-herdr-pi-cc.ts", "take-pi-cc.ts", "take-pi-acp.ts", "take-pi-durable.ts"];
const WRITABLE_ROOTS = [
	"HOME",
	"PI_CODING_AGENT_DIR",
	"XDG_CONFIG_HOME",
	"XDG_DATA_HOME",
	"XDG_STATE_HOME",
	"XDG_CACHE_HOME",
	"XDG_RUNTIME_DIR",
	"ENTWURF_DEMO_OUT",
	"TMPDIR",
];
function writableContents(env: NodeJS.ProcessEnv): Record<string, string[]> {
	return Object.fromEntries(WRITABLE_ROOTS.map((key) => [key, fs.readdirSync(env[key] as string).sort()]));
}
function spawnTake(file: string, env: NodeJS.ProcessEnv): number | null {
	return spawnSync(process.execPath, [path.join(REPO, "demo", file)], { env, encoding: "utf8", timeout: 10000 }).status;
}

test("all four source takes with approved defaults refuse missing LIVE before tools", () => {
	const f = fixture();
	try {
		const exits = TAKE_FILES.map((file) => spawnTake(file, f.env));
		assert.deepEqual(
			{ exits, calls: fs.existsSync(f.calls) },
			{ exits: [97, 97, 97, 97], calls: false },
			"[QK:DEMO-LIVE-OPT-IN] every scene must refuse before preflight when LIVE is absent",
		);
	} finally {
		fs.rmSync(f.root, { recursive: true, force: true });
	}
});

test("missing LIVE leaves all take, temporary and home/XDG roots empty", () => {
	const f = fixture();
	try {
		const before = writableContents(f.env);
		assert.ok(Object.values(before).every((entries) => entries.length === 0));
		for (const file of TAKE_FILES) spawnTake(file, f.env);
		assert.deepEqual(
			writableContents(f.env),
			before,
			"[QK:DEMO-NO-EARLY-RESOURCES] missing LIVE must not allocate a Take/fence or write home/XDG state",
		);
	} finally {
		fs.rmSync(f.root, { recursive: true, force: true });
	}
});

test("every scene refuses a non-approved selector or OpenRouter redirect before LIVE, tools or writes", () => {
	for (const [override, expected] of [
		[{ ENTWURF_DEMO_PI_MODEL: "not-an-approved-selector" }, [2, 2, 2, 2]],
		[{ ENTWURF_DEMO_PD_MODEL: "not-an-approved-selector" }, [97, 97, 97, 2]],
		[{ ANTHROPIC_BASE_URL: "https://openrouter.ai/api" }, [2, 2, 2, 2]],
	] as const) {
		const f = fixture();
		try {
			const before = writableContents(f.env);
			const exits = TAKE_FILES.map((file) => spawnTake(file, { ...f.env, ...override }));
			assert.deepEqual(
				{ override, exits, calls: fs.existsSync(f.calls), roots: writableContents(f.env) },
				{ override, exits: [...expected], calls: false, roots: before },
				"[QK:DEMO-RAIL-POLICY] every LIVE scene runs only on its approved selectors and never through OpenRouter",
			);
		} finally {
			fs.rmSync(f.root, { recursive: true, force: true });
		}
	}
});

test("published pixels match their tracked original provenance", () => {
	const provenance = JSON.parse(
		fs.readFileSync(path.join(REPO, "demo", "herdr-pi-cc-20261011.provenance.json"), "utf8"),
	);
	const bytes = fs.readFileSync(path.join(REPO, "docs", "assets", "entwurf-demo.gif"));
	assert.deepEqual(
		{ sha256: createHash("sha256").update(bytes).digest("hex"), bytes: bytes.length },
		{ sha256: provenance.gif.sha256, bytes: provenance.gif.bytes },
		"[QK:DEMO-PUBLISHED-PROVENANCE] the published original must match its declared bytes, not a retake",
	);
});

test("npm dry-pack excludes maintainer TypeScript, including non-test helpers", () => {
	const f = fixture();
	try {
		const run = spawnSync("npm", ["pack", "--dry-run", "--ignore-scripts", "--json"], {
			cwd: REPO,
			env: f.env,
			encoding: "utf8",
			timeout: 30000,
		});
		assert.equal(run.status, 0, `dry-pack failed: ${run.stderr}`);
		const files = (JSON.parse(run.stdout) as Array<{ files: Array<{ path: string }> }>)[0]?.files ?? [];
		assert.equal(
			files.some((file) => /^demo\/.*\.ts$/.test(file.path)),
			false,
			"[QK:DEMO-PACK-SOURCE-ONLY] demo TS is checkout tooling, never an installed entrypoint",
		);
	} finally {
		fs.rmSync(f.root, { recursive: true, force: true });
	}
});

test("live-pass rendering cannot write the publication directory or its parent aliases", async () => {
	// Copy only this standalone subject into an isolated fixture, NOT a development checkout.
	// Even an intentionally broken guard can only overwrite fixture pixels, never the approved GIF.
	const f = fixture();
	try {
		const demo = path.join(f.root, "demo");
		const assets = path.join(f.root, "docs", "assets");
		fs.mkdirSync(demo);
		fs.mkdirSync(assets, { recursive: true });
		fs.copyFileSync(path.join(REPO, "demo", "render-take.ts"), path.join(demo, "render-take.ts"));
		const subject = await import(pathToFileURL(path.join(demo, "render-take.ts")).href);
		const take = path.join(f.root, "take");
		fs.mkdirSync(take);
		const cast = '{"version":3}\n[0,"o","fixture only"]\n';
		fs.writeFileSync(path.join(take, "take.cast"), cast);
		fs.writeFileSync(
			path.join(take, "manifest.json"),
			JSON.stringify({
				take: "take-fixture",
				verdict: "live-pass",
				cast: { sha256: createHash("sha256").update(cast).digest("hex") },
			}),
		);
		const agg = path.join(f.root, "fake-agg");
		const probe = path.join(f.root, "fake-ffprobe");
		fs.writeFileSync(agg, '#!/bin/sh\nfor x do out="$x"; done\nprintf "GIF89afixture" > "$out"\n', { mode: 0o755 });
		fs.writeFileSync(
			probe,
			'#!/bin/sh\nprintf \'{"streams":[{"codec_name":"gif","width":1,"height":1,"nb_read_frames":1}]}\\n\'\n',
			{ mode: 0o755 },
		);
		const asset = path.join(assets, "entwurf-demo.gif");
		fs.writeFileSync(asset, "approved fixture pixels");
		fs.symlinkSync(assets, path.join(f.root, "alias"));
		const reasons: boolean[] = [];
		for (const out of [
			asset,
			path.join(f.root, "alias", "entwurf-demo.gif"),
			path.join(f.root, "alias", "new-dir", "other.gif"),
		]) {
			try {
				subject.renderTake({ takeDir: take, out, agg, ffprobe: probe });
				reasons.push(false);
			} catch (error) {
				reasons.push(error instanceof Error && error.message.includes("publication destination"));
			}
		}
		assert.deepEqual(
			{ reasons, unchanged: fs.readFileSync(asset, "utf8") === "approved fixture pixels" },
			{ reasons: [true, true, true], unchanged: true },
			"[QK:DEMO-PUBLICATION-DESTINATION] render must refuse before writes, including aliases/nonexistent descendants",
		);
	} finally {
		fs.rmSync(f.root, { recursive: true, force: true });
	}
});
