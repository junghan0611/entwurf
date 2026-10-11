// Offline fixtures for Take.registerTeardown and the recorder's end (#138). Run: node --test 'demo/**/*.test.ts'
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";
import { Take } from "./take-recorder.ts";

const REPO = path.resolve(import.meta.dirname, "..", "..");

test("a registered teardown runs once, before the verdict; a throwing one is a failed step, not a crash", async () => {
	const out = fs.mkdtempSync(path.join(os.tmpdir(), "take-recorder-test-"));
	const saved = process.env.ENTWURF_DEMO_OUT;
	process.env.ENTWURF_DEMO_OUT = out;
	try {
		const take = new Take({ label: "take-hook-test", repo: REPO, cols: 80, rows: 24 });
		let calls = 0;
		take.registerTeardown(() => {
			calls++;
			take.step("owned resource gone", true);
		});
		take.registerTeardown(() => {
			throw new Error("boom");
		});
		assert.equal(await take.finish(true, {}), false);
		assert.equal(calls, 1);
		const manifest = JSON.parse(fs.readFileSync(path.join(take.takeDir, "manifest.json"), "utf8"));
		assert.equal(manifest.verdict, "failed");
		assert.deepEqual(
			manifest.assertions.map((a: { assertion: string; ok: boolean }) => [a.assertion, a.ok]),
			[
				["owned resource gone", true],
				["owned teardown", false],
				["the recording ran until the take ended and the recorder stopped cleanly (no cut, no signal, exit 0)", false],
			],
		);
		fs.rmSync(take.scratchRoot, { recursive: true, force: true });

		const plain = new Take({ label: "take-hook-none", repo: REPO, cols: 80, rows: 24 });
		assert.equal(await plain.finish(true, {}), false);
		fs.rmSync(plain.scratchRoot, { recursive: true, force: true });
	} finally {
		if (saved === undefined) delete process.env.ENTWURF_DEMO_OUT;
		else process.env.ENTWURF_DEMO_OUT = saved;
		fs.rmSync(out, { recursive: true, force: true });
	}
});

test("a take without a recorder cannot certify live-pass independently of teardown fixtures", async () => {
	const out = fs.mkdtempSync(path.join(os.tmpdir(), "take-recorder-missing-test-"));
	const saved = process.env.ENTWURF_DEMO_OUT;
	process.env.ENTWURF_DEMO_OUT = out;
	const take = new Take({ label: "take-no-recorder", repo: REPO, cols: 80, rows: 24 });
	try {
		assert.equal(
			await take.finish(true, {}),
			false,
			"[QK:DEMO-RECORDING-REQUIRED] absent recorder cannot certify a live take",
		);
	} finally {
		if (saved === undefined) delete process.env.ENTWURF_DEMO_OUT;
		else process.env.ENTWURF_DEMO_OUT = saved;
		fs.rmSync(take.scratchRoot, { recursive: true, force: true });
		fs.rmSync(out, { recursive: true, force: true });
	}
});

/**
 * A stand-in `asciinema` with the measured 3.2.0 contract: it runs --command, writes the command's status as the
 * cast's "x" event, and itself exits 0 whatever the command did. Put first on PATH before the Take is built.
 */
function fakeRecorderPath(dir: string): string {
	const bin = path.join(dir, "bin");
	fs.mkdirSync(bin);
	fs.writeFileSync(
		path.join(bin, "asciinema"),
		[
			"#!/bin/sh",
			'while [ $# -gt 0 ]; do case "$1" in --command) cmd="$2"; shift 2;; --window-size) shift 2;;',
			'  rec|--overwrite|--quiet|--headless) shift;; *) cast="$1"; shift;; esac; done',
			'printf \'{"version":3}\\n\' > "$cast"',
			'sh -c "$cmd"; st=$?',
			'printf \'[0.1, "x", "%s"]\\n\' "$st" >> "$cast"',
			"exit 0",
			"",
		].join("\n"),
		{ mode: 0o755 },
	);
	return `${bin}${path.delimiter}${process.env.PATH ?? ""}`;
}

async function withFakeRecorder(body: (out: string) => Promise<void>): Promise<void> {
	const out = fs.mkdtempSync(path.join(os.tmpdir(), "take-recorder-test-"));
	const saved = { out: process.env.ENTWURF_DEMO_OUT, path: process.env.PATH };
	process.env.ENTWURF_DEMO_OUT = out;
	process.env.PATH = fakeRecorderPath(out);
	try {
		await body(out);
	} finally {
		if (saved.out === undefined) delete process.env.ENTWURF_DEMO_OUT;
		else process.env.ENTWURF_DEMO_OUT = saved.out;
		process.env.PATH = saved.path;
		fs.rmSync(out, { recursive: true, force: true });
	}
}

test("a recorder that ends while the take runs cuts the capture: the next wait stops, and no green", async () => {
	await withFakeRecorder(async () => {
		const take = new Take({ label: "take-rec-early", repo: REPO, cols: 80, rows: 24 });
		take.startRecorder("exit 3");
		assert.equal(await take.until("the subject", 5000, () => null), null);
		assert.equal(await take.finish(true, {}), false);
		const manifest = JSON.parse(fs.readFileSync(path.join(take.takeDir, "manifest.json"), "utf8"));
		assert.equal(manifest.verdict, "failed");
		assert.equal(manifest.recording.end.duringFinish, false);
		assert.deepEqual(
			manifest.assertions.map((a: { assertion: string; ok: boolean }) => [a.assertion, a.ok]),
			[
				["the recording is intact while waiting for the subject", false],
				["the recording ran until the take ended and the recorder stopped cleanly (no cut, no signal, exit 0)", false],
			],
		);
		assert.match(fs.readFileSync(take.castPath, "utf8"), /"x", "3"/);
		fs.rmSync(take.scratchRoot, { recursive: true, force: true });
	});
});

test("a view that ends because the take's own teardown stopped it is a clean capture, hook run once", async () => {
	await withFakeRecorder(async (out) => {
		const take = new Take({ label: "take-rec-owned", repo: REPO, cols: 80, rows: 24 });
		const stop = path.join(out, "stop");
		// like the herdr client: it runs until its server stops, then exits 1
		take.startRecorder(`while [ ! -e ${stop} ]; do sleep 0.05; done; exit 1`);
		let calls = 0;
		take.registerTeardown(() => {
			calls++;
			fs.writeFileSync(stop, "");
		});
		assert.equal(await take.until("the subject", 5000, () => (calls === 0 ? true : null)), true);
		assert.equal(await take.finish(true, {}), true);
		assert.equal(calls, 1);
		const manifest = JSON.parse(fs.readFileSync(path.join(take.takeDir, "manifest.json"), "utf8"));
		assert.equal(manifest.verdict, "live-pass");
		assert.equal(manifest.recording.end.duringFinish, true);
		assert.equal(manifest.recording.cutByTimeout, false);
		assert.match(fs.readFileSync(take.castPath, "utf8"), /"x", "1"/);
		fs.rmSync(take.scratchRoot, { recursive: true, force: true });
	});
});
