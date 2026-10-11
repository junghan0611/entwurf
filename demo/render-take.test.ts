// Offline fixtures for demo/render-take.ts (#138). Run: node --test demo/
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";
import { type CastEvent, isOnlyCsi, renderTake, trimRecorderTeardown } from "./render-take.ts";

const TEARDOWN: CastEvent = [6.0, "o", "\u001b[1;38r\u001b[H\u001b[J\u001b[?2004l\u001b[?1049l\u001b[?2031l"];
const NOTICE: CastEvent = [0, "o", "[detached (from session view)]\r\n"];
const EXIT: CastEvent = [0, "x", "0"];
const OPEN: CastEvent = [0.01, "o", "\u001b[?1049h\u001b[H\u001b[J"];

test("trims exactly the recorder teardown suffix", () => {
	const work: CastEvent = [1, "o", "3 notes.txt\r\n"];
	const r = trimRecorderTeardown([OPEN, work, TEARDOWN, NOTICE, EXIT]);
	assert.equal(r.trimmed, 3);
	assert.deepEqual(r.events, [OPEN, work]);
});

test("a subject's own mid-stream alt-screen exit is kept; only the true tail goes", () => {
	const subjectLeavesAlt: CastEvent = [1, "o", "pager done\u001b[?1049l"];
	const later: CastEvent = [1, "o", "the answer: 3 lines\r\n"];
	const subjectNotice: CastEvent = [1, "o", "[detached (from session other)]\r\n"];
	const events = [OPEN, subjectLeavesAlt, subjectNotice, later, TEARDOWN, NOTICE, EXIT];
	const r = trimRecorderTeardown(events);
	assert.equal(r.trimmed, 3);
	assert.deepEqual(r.events, [OPEN, subjectLeavesAlt, subjectNotice, later]);
});

test("a tmux tail with printable subject content is preserved whole", () => {
	for (const text of [
		"the answer\r\n" + TEARDOWN[2],
		"\u001b[?1049lthe answer",
		"\u001b[?1049l\u001b[32mok\u001b[0m",
	]) {
		const events: CastEvent[] = [OPEN, [1, "o", text], NOTICE, EXIT];
		assert.deepEqual(
			trimRecorderTeardown(events).events,
			events,
			"[QK:DEMO-TMUX-SUBJECT-TAIL] a mixed subject/teardown event is not recorder-only",
		);
	}
});

// The herdr client's exit event, byte-exact from S0 (herdr 0.9.3, s0b.cast tail, 204 bytes): mode restores only.
const HERDR_EXIT: CastEvent = [
	2.114,
	"o",
	"\u001b[<1u\u001b[?7h\u001b[?1004l\u001b[?2004l\u001b[?1006l\u001b[?1016l\u001b[?1015l\u001b[?1005l\u001b[?1003l\u001b[?1002l\u001b[?1000l\u001b[?9l\u001b[?1006l\u001b[?1015l\u001b[?1003l\u001b[?1002l\u001b[?1000l\u001b[?1049l\u001b[?2031l\u001b[?25h\u001b[0 qherdr: server shut down: server is shutting down\r\n",
];

test("trims exactly a herdr client's teardown-only exit event and names it", () => {
	assert.equal(Buffer.byteLength(HERDR_EXIT[2]), 204);
	const work: CastEvent = [1, "o", "3 notes.txt\r\n"];
	const r = trimRecorderTeardown([OPEN, work, HERDR_EXIT, [0.001, "x", "1"]]);
	assert.equal(r.trimmed, 2);
	assert.deepEqual(r.events, [OPEN, work]);
	assert.match(r.what ?? "", /herdr client exit/);
	assert.match(trimRecorderTeardown([OPEN, work, TEARDOWN, NOTICE, EXIT]).what ?? "", /tmux detach notice/);
});

test("a herdr shutdown line that is not a teardown-only exit event is kept whole", () => {
	const work: CastEvent = [1, "o", "work\r\n"];
	for (const tail of [
		// subject content in the same event as the exit (coordinator repro): the answer must not be dropped
		[[0.1, "o", "real subject answer: DEMO-ABC123: 3 lines\r\n\u001b[?1049lherdr: server shut down: done\r\n"]],
		// printable bytes after the mode restores, before the line
		[[0.1, "o", "\u001b[?1049lDEMO-ABC123herdr: server shut down: done\r\n"]],
		// an SGR-colored subject word between the restores
		[[0.1, "o", "\u001b[?1049l\u001b[32mok\u001b[0mherdr: server shut down: done\r\n"]],
		[work, [1, "o", "herdr: server shut down: server is shutting down\r\n"]], // no alt-screen exit
		[work, [1, "o", "herdr: server shut down: x\r\n\u001b[?1049l"]], // exit after the line
		[HERDR_EXIT, work], // not the tail
	] as CastEvent[][]) {
		const r = trimRecorderTeardown([OPEN, ...tail]);
		assert.equal(r.trimmed, 0);
		assert.equal(r.what, null);
		assert.deepEqual(r.events, [OPEN, ...tail]);
	}
});

test("isOnlyCsi accepts CSI sequences only, with intermediates and private markers", () => {
	assert.equal(isOnlyCsi(""), true);
	assert.equal(isOnlyCsi("\u001b[?1049l\u001b[<1u\u001b[0 q"), true);
	assert.equal(isOnlyCsi("\u001b[?1049lx"), false);
	assert.equal(isOnlyCsi("\u001b]8;;\u001b\\"), false); // OSC is not CSI
	assert.equal(isOnlyCsi("\u001b[?1049"), false); // unterminated
});

test("an unrecognized tail is not trimmed", () => {
	const work: CastEvent = [1, "o", "work\r\n"];
	for (const tail of [
		[work, NOTICE, EXIT], // notice without the teardown event before it
		[work, TEARDOWN, EXIT], // teardown without the notice
		[work, TEARDOWN, [0, "o", "[detached (from session view)] trailing\r\n"] as CastEvent, EXIT],
		[work],
	]) {
		const r = trimRecorderTeardown([OPEN, ...tail]);
		assert.equal(r.trimmed, 0);
		assert.deepEqual(r.events, [OPEN, ...tail]);
	}
});

// ── renderTake with a fake agg: last good stays last good ────────────────────
function fixtureTake(verdict: string, castExtra = ""): { root: string; takeDir: string } {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "render-take-test-"));
	const takeDir = path.join(root, "takes", "take-demo-1");
	fs.mkdirSync(takeDir, { recursive: true });
	const cast = `${[
		JSON.stringify({ version: 3, term: { cols: 80, rows: 24 } }),
		JSON.stringify(OPEN),
		JSON.stringify([1, "o", `hello${castExtra}\r\n`]),
		JSON.stringify(TEARDOWN),
		JSON.stringify(NOTICE),
		JSON.stringify(EXIT),
	].join("\n")}\n`;
	fs.writeFileSync(path.join(takeDir, "take.cast"), cast);
	const sha = createHash("sha256").update(cast).digest("hex");
	fs.writeFileSync(
		path.join(takeDir, "manifest.json"),
		JSON.stringify({ take: "take-demo", verdict, cast: { sha256: sha } }),
	);
	return { root, takeDir };
}
function fakeAgg(root: string, body: string): string {
	const bin = path.join(root, "fake-agg.sh");
	fs.writeFileSync(bin, `#!/bin/sh\n${body}\n`, { mode: 0o755 });
	return bin;
}
// A real minimal GIF (1x1, one frame) that ffprobe decodes; and two that only look like one.
const VALID_GIF = Buffer.from(
	"47494638396101000100800000ffffff00000021f90401000000002c00000000010001000002024401003b",
	"hex",
);
const BYTES_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "render-take-bytes-"));
function bytesFile(name: string, bytes: Buffer): string {
	const f = path.join(BYTES_DIR, name);
	fs.writeFileSync(f, bytes);
	return f;
}
const writes = (file: string) => `for a; do out="$a"; done; cp '${file}' "$out"`;
const WRITE_GIF = writes(bytesFile("valid.gif", VALID_GIF));
const HEADER_ONLY = writes(bytesFile("header-only.gif", Buffer.from("GIF89a", "latin1")));
const TRUNCATED = writes(bytesFile("truncated.gif", VALID_GIF.subarray(0, 20)));

test("a successful render promotes the GIF and writes the sidecar", () => {
	const { root, takeDir } = fixtureTake("live-pass");
	const r = renderTake({ takeDir, agg: fakeAgg(root, WRITE_GIF), aggArgs: [] });
	assert.equal(r.gif, path.join(root, "artifacts", "entwurf-demo.gif"));
	assert.equal(fs.readFileSync(r.gif, "latin1").slice(0, 6), "GIF89a");
	const side = JSON.parse(fs.readFileSync(r.sidecar, "utf8"));
	assert.equal(side.render.trimmedTailEvents, 3);
	assert.equal(side.render.gifSha256, r.sha256);
	assert.deepEqual(
		fs.readdirSync(path.dirname(r.gif)).filter((f) => f.endsWith(".tmp")),
		[],
	);
});

test("new renders preserve the original take's exact render input on success and failure", () => {
	const { root, takeDir } = fixtureTake("live-pass");
	try {
		const originalInput = path.join(takeDir, "take.render.cast");
		const originalBytes = Buffer.from("original approved agg input — never replace\n");
		fs.writeFileSync(originalInput, originalBytes);
		const observations: boolean[] = [];
		for (const body of [WRITE_GIF, "exit 1"]) {
			try {
				renderTake({ takeDir, agg: fakeAgg(root, body), aggArgs: [] });
			} catch (error) {
				assert.match(String(error), /render-take: agg failed/);
			}
			observations.push(fs.readFileSync(originalInput).equals(originalBytes));
		}
		assert.deepEqual(
			observations,
			[true, true],
			"[QK:DEMO-ORIGINAL-RENDER-INPUT] a new render must never overwrite the original take's agg input",
		);
	} finally {
		fs.rmSync(root, { recursive: true, force: true });
	}
});

test("a failing, non-GIF or undecodable agg output leaves the existing GIF and sidecar byte-identical", () => {
	const { root, takeDir } = fixtureTake("live-pass");
	const good = renderTake({ takeDir, agg: fakeAgg(root, WRITE_GIF), aggArgs: [] });
	const gifBefore = fs.readFileSync(good.gif);
	const sideBefore = fs.readFileSync(good.sidecar);
	for (const body of [
		"exit 1",
		'for a; do out="$a"; done; printf "not a gif" > "$out"',
		"exit 0",
		HEADER_ONLY, // exit 0, magic bytes right, not a GIF
		TRUNCATED, // a real GIF cut short
	]) {
		assert.throws(() => renderTake({ takeDir, agg: fakeAgg(root, body), aggArgs: [] }), /render-take: agg/);
		assert.deepEqual(fs.readFileSync(good.gif), gifBefore);
		assert.deepEqual(fs.readFileSync(good.sidecar), sideBefore);
		assert.deepEqual(
			fs.readdirSync(path.dirname(good.gif)).filter((f) => f.endsWith(".tmp")),
			[],
		);
	}
});

test("a non-live take renders only to the private FAILED path and refuses a named destination", () => {
	const { root, takeDir } = fixtureTake("failed");
	const published = path.join(root, "docs", "assets", "entwurf-demo.gif");
	fs.mkdirSync(path.dirname(published), { recursive: true });
	fs.writeFileSync(published, "GIF89a-published");
	assert.throws(
		() => renderTake({ takeDir, out: published, agg: fakeAgg(root, WRITE_GIF), aggArgs: [] }),
		/renders only to the private FAILED path/,
	);
	assert.equal(fs.readFileSync(published, "latin1"), "GIF89a-published");
	const r = renderTake({ takeDir, agg: fakeAgg(root, WRITE_GIF), aggArgs: [] });
	assert.equal(r.gif, path.join(root, "artifacts", "entwurf-demo.FAILED-take-demo-1.gif"));
});

test("a cast that is not the manifest's, or that carries an email, is refused before any render", () => {
	const { root, takeDir } = fixtureTake("live-pass");
	fs.appendFileSync(path.join(takeDir, "take.cast"), `${JSON.stringify([0, "o", "x"])}\n`);
	assert.throws(() => renderTake({ takeDir, agg: fakeAgg(root, WRITE_GIF), aggArgs: [] }), /cast sha256/);
	const leak = fixtureTake("live-pass", " someone@example.com");
	assert.throws(
		() => renderTake({ takeDir: leak.takeDir, agg: fakeAgg(leak.root, WRITE_GIF), aggArgs: [] }),
		/email address/,
	);
	assert.equal(fs.existsSync(path.join(leak.root, "artifacts")), false);
});

test("a destination that is not a .gif is refused before any output is written", () => {
	const { root, takeDir } = fixtureTake("live-pass");
	const oldGood = path.join(root, "old-good.bin");
	fs.writeFileSync(oldGood, "previous bytes");
	assert.throws(
		() => renderTake({ takeDir, out: oldGood, agg: fakeAgg(root, WRITE_GIF), aggArgs: [] }),
		/must end in \.gif/,
	);
	assert.equal(fs.readFileSync(oldGood, "utf8"), "previous bytes");
	assert.equal(fs.existsSync(path.join(takeDir, "take.render.cast")), false);
	assert.deepEqual(
		fs.readdirSync(root).filter((f) => f.endsWith(".tmp")),
		[],
	);
});
