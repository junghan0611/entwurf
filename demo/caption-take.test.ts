// Offline fixtures for demo/caption-take.ts timing (#138). Run: node --test 'demo/**/*.test.ts'
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";
import { captionTake, gifTimeAt, gifTimes, segments, snapToFrame } from "./caption-take.ts";
import { type CastEvent, renderTake } from "./render-take.ts";

const ev = (dt: number): CastEvent => [dt, "o", "x"];

test("gif time caps each idle gap and divides by speed", () => {
	assert.deepEqual(gifTimes([ev(0.5), ev(10), ev(1)], 2, 1), [0.5, 2.5, 3.5]);
	assert.deepEqual(gifTimes([ev(0.5), ev(10), ev(1)], 2, 2), [0.25, 1.25, 1.75]);
});

test("an instant maps to the GIF time of the first event at or after it", () => {
	const events = [ev(1), ev(10), ev(1)]; // absolute: start+1, start+11, start+12
	const times = gifTimes(events, 2, 1); // 1, 3, 4
	const start = 1000;
	assert.equal(gifTimeAt(start, events, times, 1000_500), 1); // before the first event
	assert.equal(gifTimeAt(start, events, times, 1005_000), 3); // inside the idle gap → the event after it
	assert.equal(gifTimeAt(start, events, times, 1011_000), 3); // exactly on an event
	assert.equal(gifTimeAt(start, events, times, 1099_000), 4); // after the last → the end
});

test("captions snap to the frame grid within a small slack, never far earlier", () => {
	const frames = [0, 1.0, 2.03, 29.48];
	assert.equal(snapToFrame(2.05, frames), 2.03);
	assert.equal(snapToFrame(29.5, frames), 29.48);
	assert.equal(snapToFrame(10, frames), 29.48); // the next frame, not an earlier one
	const segs = segments(
		[
			{ at: "2026-10-11T00:00:00.000Z", why: "a" },
			{ at: "2026-10-11T00:00:05.000Z", why: "b" },
		],
		(ms) => (ms - Date.parse("2026-10-11T00:00:00.000Z")) / 1000,
		9,
		frames,
	);
	assert.deepEqual(segs, [
		{ from: 0, to: 29.48, text: "a" },
		{ from: 29.48, to: 9, text: "b" },
	]);
});

// ── pairing and last-good for captionTake (coordinator review 2026-10-11) ────
const VALID_GIF = Buffer.from(
	"47494638396101000100800000ffffff00000021f90401000000002c00000000010001000002024401003b",
	"hex",
);
function bin(root: string, name: string, body: string): string {
	const f = path.join(root, name);
	fs.writeFileSync(f, `#!/bin/sh\n${body}\n`, { mode: 0o755 });
	return f;
}
function take(root: string, id: string, token: string, extra = ""): string {
	const takeDir = path.join(root, "takes", id);
	fs.mkdirSync(takeDir, { recursive: true });
	const cast = `${[
		JSON.stringify({ version: 3, term: { cols: 80, rows: 24 }, timestamp: 1791710000 }),
		JSON.stringify([0.1, "o", `hello ${id}${extra}\r\n`]),
	].join("\n")}\n`;
	fs.writeFileSync(path.join(takeDir, "take.cast"), cast);
	const manifest = {
		take: "take-demo",
		verdict: "live-pass",
		token,
		startedAt: "2026-10-11T00:00:00.000Z",
		stage: "SOURCE (fixture)",
		viewport: "80x24",
		versions: { gitHead: "0000000fixture" },
		cast: { sha256: createHash("sha256").update(cast).digest("hex") },
		views: [{ at: "2026-10-11T00:00:00.000Z", why: `scene of ${id}` }],
		measuredModels: { pi: ["fixture/model"] },
	};
	fs.writeFileSync(path.join(takeDir, "manifest.json"), JSON.stringify(manifest));
	return takeDir;
}
function setup() {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "caption-take-test-"));
	const validFile = path.join(root, "valid.gif");
	fs.writeFileSync(validFile, VALID_GIF);
	const copyValid = bin(root, "cp-valid.sh", `for a; do out="$a"; done; cp '${validFile}' "$out"`);
	const truncated = path.join(root, "truncated.gif");
	fs.writeFileSync(truncated, VALID_GIF.subarray(0, 20));
	const copyTruncated = bin(root, "cp-trunc.sh", `for a; do out="$a"; done; cp '${truncated}' "$out"`);
	const a = take(root, "a", "DEMO-AAAAAA");
	const rendered = renderTake({ takeDir: a, agg: copyValid, aggArgs: ["--idle-time-limit", "2", "--speed", "1"] });
	return { root, a, rendered, copyValid, copyTruncated, font: validFile };
}

test("captioning writes a separate decodable GIF and a sidecar naming its input", () => {
	const { a, rendered, copyValid, font } = setup();
	const r = captionTake({ takeDir: a, input: rendered.gif, ffmpeg: copyValid, font });
	assert.equal(r.gif, rendered.gif.replace(/\.gif$/, ".captioned.gif"));
	const side = JSON.parse(fs.readFileSync(r.sidecar, "utf8"));
	assert.equal(side.caption.fromSha256, rendered.sha256);
	assert.equal(side.caption.gifSha256, r.sha256);
	assert.match(side.caption.header, /measured models: pi fixture\/model/);
});

test("take A's labels never land on take B's render", () => {
	const { root, rendered, copyValid, font } = setup();
	const b = take(root, "b", "DEMO-BBBBBB");
	assert.throws(
		() => captionTake({ takeDir: b, input: rendered.gif, ffmpeg: copyValid, font }),
		/not this take's render — take\.cast sha256|differs/,
	);
	// same take name and token, different cast bytes: still not this take's render
	const c = take(root, "c", "DEMO-AAAAAA", " other bytes");
	assert.throws(
		() => captionTake({ takeDir: c, input: rendered.gif, ffmpeg: copyValid, font }),
		/not this take's render/,
	);
	assert.equal(fs.existsSync(rendered.gif.replace(/\.gif$/, ".captioned.gif")), false);
});

test("a cast edited after the render is refused", () => {
	const { a, rendered, copyValid, font } = setup();
	fs.appendFileSync(path.join(a, "take.cast"), `${JSON.stringify([0.1, "o", "late"])}\n`);
	assert.throws(() => captionTake({ takeDir: a, input: rendered.gif, ffmpeg: copyValid, font }), /take\.cast sha256/);
});

test("an undecodable caption output leaves the previous captioned GIF and sidecar byte-identical", () => {
	const { a, rendered, copyValid, copyTruncated, font } = setup();
	const good = captionTake({ takeDir: a, input: rendered.gif, ffmpeg: copyValid, font });
	const gifBefore = fs.readFileSync(good.gif);
	const sideBefore = fs.readFileSync(good.sidecar);
	for (const ffmpeg of [copyTruncated, bin(path.dirname(rendered.gif), "fail.sh", "exit 1")]) {
		assert.throws(
			() => captionTake({ takeDir: a, input: rendered.gif, ffmpeg, font }),
			/caption-take: (output|ffmpeg)/,
		);
		assert.deepEqual(fs.readFileSync(good.gif), gifBefore);
		assert.deepEqual(fs.readFileSync(good.sidecar), sideBefore);
		assert.deepEqual(
			fs.readdirSync(path.dirname(good.gif)).filter((f) => f.includes(".tmp")),
			[],
		);
	}
	assert.throws(
		() => captionTake({ takeDir: a, input: good.gif, ffmpeg: copyValid, font }),
		/must be a rendered \.gif/,
	);
});
