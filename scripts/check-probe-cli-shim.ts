// Deterministic gate for the §11-7-c B-name-snapshot PRODUCER — the CLI shim
// (docs/acp-backend-rail.md §11-7-c, condition 5: "Byte-transparency,
// backpressure, and exit/signal propagation are proved by a fake-CLI
// deterministic gate"). THIS is that gate.
//
// The shim is an instrument that sits on the production spawn path of a LIVE,
// paid turn. Everything it can silently get wrong is a way to either destroy the
// turn it is measuring or — far worse — to FABRICATE the absence reading the
// B-name-snapshot ladder promotes. So the matrix below is organised by what a
// defect would buy:
//
//   FABRICATED EVIDENCE — an init line whose `tools` is missing or mistyped must
//   never be reported as an EMPTY name set, because an empty set is exactly what
//   the ladder reads as "the measured id was absent". A shim that defaults to []
//   manufactures the finding. Likewise the boot report must carry the REAL target
//   identity: the classifier verifies it against the roster, and a fabricated
//   hash would let a swapped binary vote.
//
//   DESTROYED TURN — byte transparency, exit status, signal disposition, stderr,
//   stdin EOF and backpressure. A wrapper that mangles a multi-byte character,
//   swallows a signal, or reports exit 0 for a crash turns a measurement into an
//   incident, and the operator would be debugging the CLI instead of the shim.
//
//   LEAKED OPERATOR STATE — the scrub is an EXACT allowlist, and nothing about
//   argv, env, auth or prompt bodies may reach the shared log.
//
// Everything here runs against FAKE CLIs — small executables written into a temp
// dir and pointed at by PROBE_SHIM_TARGET. No API, no network, no cost. The
// subject is driven as a REAL PROCESS (spawned exactly the way the SDK spawns
// the native branch: no shell, piped stdio, inherited cwd), because half of what
// this gate proves is process semantics that a unit call cannot reach.
//
// Kill-proof: scripts/mutants/probe-ordering.json carries one exact-once mutant
// per [QK:...] signature below. THREE properties are SOURCE-pinned rather than
// behaviour-pinned, and §12 states the measurement that sent each one there —
// this is the same carve-out §11-7-c already records for the fixture's and the
// shim's write-callback timing, not a softer bar invented here. The two callback
// PLACEMENTS cannot be separated from a placement just outside the callback by
// timing, because the shim pauses its source under backpressure and thereby
// couples the read to the write; the log door's `receivedAtMs ≤ tsMs` rule bounds
// them at runtime. The source of the PAUSE is pinned because peak RSS was
// measured and refused as a discriminator (numbers in §12).

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NdjsonLineScanner, SHIM_MAX_LINE_BYTES } from "./lib/probe-cli-shim.ts";
import { hashFileSha256, PROBE_SHIM_ENV, SDK_SCRIPT_SUFFIXES, SHIM_SCRUB_ENV_VARS } from "./lib/probe-cli-target.ts";
import { PROBE_EVENTS, type ProbeEvent, readProbeEvents } from "./lib/probe-event-log.ts";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SHIM_LAUNCHER = join(REPO_ROOT, "scripts", "fixtures", "probe-cli-shim");
const SHIM_SRC = readFileSync(join(REPO_ROOT, "scripts", "lib", "probe-cli-shim.ts"), "utf8");
const LAUNCHER_SRC = readFileSync(SHIM_LAUNCHER, "utf8");

const TMP = mkdtempSync(join(tmpdir(), "probe-cli-shim-"));
process.on("exit", () => rmSync(TMP, { recursive: true, force: true }));

const sha256 = (buf: Buffer): string => createHash("sha256").update(buf).digest("hex");

// ---------------------------------------------------------------------------
// Fake CLIs — the stimulus side of the matrix.
// ---------------------------------------------------------------------------

// Every fake exits either NATURALLY (event loop drains only after pending pipe
// writes flush) or from inside a write callback. A bare `process.exit()` after a
// write truncates it on a pipe, which would make this gate flaky in exactly the
// dimension it is measuring — byte completeness.
function fakeCli(name: string, body: string): string {
	const path = join(TMP, name);
	writeFileSync(path, `#!/usr/bin/env node\n${body}`);
	chmodSync(path, 0o755);
	return path;
}

/** Byte mirror: whatever arrives on stdin leaves on stdout, unchanged. The
 *  transparency probe — the bytes cross the shim TWICE (stdin scan, stdout scan),
 *  so a reframe on either side shows up as a hash mismatch. */
const MIRROR_CLI = fakeCli("mirror-cli", `process.stdin.on("data", (c) => process.stdout.write(c));\n`);

/** The same mirror, but it ANNOUNCES itself first. Without a readiness signal a
 *  planted chunk boundary is FICTION: the gate's two writes land in the CLI's
 *  stdin pipe while Node is still booting (~40 ms), so the CLI's first read
 *  returns them coalesced and the split never reaches the shim's stdout path at
 *  all. That is exactly how the byte-transparency claim stayed green with a
 *  string-decoding shim planted — gate qualification called it WRONG-REASON and
 *  that is what exposed the vacuous test (2026-07-29). */
const READY_MARKER = "READY\n";
const SPLIT_MIRROR_CLI = fakeCli(
	"split-mirror-cli",
	`process.stdout.write(${JSON.stringify(READY_MARKER)});
process.stdin.on("data", (c) => process.stdout.write(c));
`,
);

/** A stream-json CLI shaped like the real one: a BOOT init emitted before any
 *  input is read, then a per-turn init + result for each `type:"user"` frame
 *  (acp-agent.js:1573-1587 — the SDK re-emits init per turn, which is the
 *  attribution §11-7-c binds to). */
const STREAM_CLI = fakeCli(
	"stream-cli",
	`const line = (o) => process.stdout.write(JSON.stringify(o) + "\\n");
line({ type: "system", subtype: "init", tools: ["BOOT_ONLY"], mcp_servers: [], model: "fake" });
let buf = "";
process.stdin.on("data", (c) => {
	buf += c.toString("utf8");
	let i;
	while ((i = buf.indexOf("\\n")) >= 0) {
		const raw = buf.slice(0, i);
		buf = buf.slice(i + 1);
		let o;
		try { o = JSON.parse(raw); } catch { continue; }
		if (o.type !== "user") continue;
		line({ type: "system", subtype: "init", tools: ["mcp__probe__probe_nonce", "Bash"],
			mcp_servers: [{ name: "probe", status: "connected" }], model: "fake" });
		line({ type: "result", subtype: "success" });
	}
});
`,
);

/** Init lines the shim must REFUSE to turn into snapshots: no `tools` at all, and
 *  a `tools` that is not an array of strings. Reporting either as an empty name
 *  set would fabricate the very absence the ladder promotes. */
const BAD_INIT_CLI = fakeCli(
	"bad-init-cli",
	`const line = (o) => process.stdout.write(JSON.stringify(o) + "\\n");
line({ type: "system", subtype: "init", mcp_servers: [], model: "fake" });
line({ type: "system", subtype: "init", tools: "not-an-array" });
line({ type: "system", subtype: "init", tools: ["ok", 7] });
line({ type: "result", subtype: "success" });
process.stdin.on("data", () => {});
`,
);

/** Reports its own launch facts so the gate can compare argv / cwd / env against
 *  what the shim was given. Not stream-json — this is also the argv-agnostic
 *  consumer (`claude auth logout` is the real one). */
const REPORT_CLI = fakeCli(
	"report-cli",
	`process.stdout.write(JSON.stringify({ argv: process.argv.slice(2), cwd: process.cwd(), env: process.env }) + "\\n");
process.stdout.write("not json at all\\n");
`,
);

const EXIT_CLI = fakeCli("exit-cli", `process.exit(Number(process.argv[2] || 0));\n`);

const SELF_SIGNAL_CLI = fakeCli(
	"self-signal-cli",
	`process.stdout.write("about to die\\n", () => process.kill(process.pid, process.argv[2]));\n`,
);

/** Writes a marker, then waits. Default SIGTERM disposition — no handler — so an
 *  inbound signal that reaches it kills it by that signal. */
const SLEEPER_CLI = fakeCli(
	"sleeper-cli",
	`process.stdout.write("up\\n");
setInterval(() => {}, 1000);
`,
);

const STDERR_CLI = fakeCli(
	"stderr-cli",
	`process.stderr.write("diagnostic tail from the CLI\\n");
process.stdout.write("out\\n", () => process.exit(3));
`,
);

/** One line larger than the shim's framing bound, followed by a perfectly good
 *  init line. The oversized line must lose its PARSE, never its BYTES, and the
 *  init line after it must still bind. */
// Derived from the shim's own cap, never hardcoded: if the bound moves, this
// stimulus has to move with it or the test quietly stops crossing it.
const OVERSIZED_LINE_BYTES = SHIM_MAX_LINE_BYTES + 1024;
const BIG_LINE_CLI = fakeCli(
	"big-line-cli",
	`process.stdout.write("x".repeat(${OVERSIZED_LINE_BYTES}) + "\\n");
process.stdout.write(JSON.stringify({ type: "system", subtype: "init", tools: ["AFTER_BIG"], mcp_servers: [] }) + "\\n");
process.stdin.on("data", () => {});
`,
);

/** Reads its stdin SLOWLY — parks the stream, drains later — so the shim's write
 *  to the child's stdin returns false and the stdin backpressure path is real.
 *  Echoes everything so the gate can check completeness, and exits on EOF so the
 *  stdin-EOF propagation is checked with it. */
const SLOW_READER_CLI = fakeCli(
	"slow-reader-cli",
	`const seen = [];
process.stdin.on("data", (c) => seen.push(c));
process.stdin.pause();
setTimeout(() => process.stdin.resume(), 300);
process.stdin.on("end", () => process.stdout.write(Buffer.concat(seen)));
`,
);

/** An oversized line that never meets a newline before EOF — the case a scanner
 *  counting only at newline boundaries under-reports. */
const UNTERMINATED_BIG_CLI = fakeCli(
	"unterminated-big-cli",
	`process.stdout.write("q".repeat(${OVERSIZED_LINE_BYTES}));
process.stdin.on("data", () => {});
`,
);

/** Floods stdout so the downstream reader's backpressure is real. Sized well past
 *  any pipe buffer AND past Node's baseline heap noise, because "bytes all
 *  arrived" alone cannot separate a shim that PAUSES its source from one that
 *  queues the whole flood in memory — both deliver every byte. The peak-RSS
 *  reading below is what makes the bound observable. */
const FLOOD_BYTES = 8 * 1024 * 1024;
const FLOOD_CLI = fakeCli(
	"flood-cli",
	`const chunk = "y".repeat(64 * 1024) + "\\n";
let written = 0;
const pump = () => {
	while (written < ${FLOOD_BYTES}) {
		written += chunk.length;
		if (!process.stdout.write(chunk)) { process.stdout.once("drain", pump); return; }
	}
	process.stdout.write(JSON.stringify({ type: "system", subtype: "init", tools: ["AFTER_FLOOD"], mcp_servers: [] }) + "\\n");
};
pump();
`,
);

// ---------------------------------------------------------------------------
// Driving the subject as a real process.
// ---------------------------------------------------------------------------

interface ShimRun {
	stdout: Buffer;
	stderr: string;
	code: number | null;
	signal: NodeJS.Signals | null;
	events: ProbeEvent[];
	malformed: string[];
	sequenceViolations: string[];
	logPath: string;
	diagPath: string;
	/** Wall-clock the run took, so "ended promptly" is a measurable claim rather
	 *  than an absence of complaint. */
	elapsedMs: number;
	/** Exactly the env the SHIM was launched with — the expectation the child's env
	 *  is compared against, so "every other variable identical" is a claim about
	 *  the whole object rather than about a hand-picked sample. */
	launchEnv: NodeJS.ProcessEnv;
}

let runSeq = 0;

async function runShim(opts: {
	target: string;
	argv?: string[];
	stdin?: Buffer[];
	/** Env deltas applied on top of the probe trio; `undefined` DELETES a key. */
	env?: Record<string, string | undefined>;
	/** Hold the downstream reader paused this long, to make write backpressure real. */
	holdReadsMs?: number;
	/** Signal to send to the SHIM once it has produced its first stdout byte. */
	signalShim?: NodeJS.Signals;
	/** Destroy our READ end after the first chunk — the SDK giving up mid-turn. */
	dropReaderAfterFirstChunk?: boolean;
	/** Hard kill after this long. Lower it where a HANG is the defect under test,
	 *  so a hung mutant fails fast instead of dragging the whole qualification. */
	guardMs?: number;
	/** Wait for the child's first stdout byte before writing stdin — the ordering a
	 *  real turn has, where the boot init is received before the prompt is sent. */
	waitForOutput?: boolean;
	/** Delay between stdin chunks, so the OS delivers them as SEPARATE reads. Without
	 *  it a pipe coalesces back-to-back writes and a chunk-boundary defect can hide. */
	stdinGapMs?: number;
	cwd?: string;
}): Promise<ShimRun> {
	const id = ++runSeq;
	const logPath = join(TMP, `events-${id}.ndjson`);
	const env: NodeJS.ProcessEnv = {
		...process.env,
		[PROBE_SHIM_ENV.target]: opts.target,
		[PROBE_SHIM_ENV.eventLog]: logPath,
		[PROBE_SHIM_ENV.runId]: `shim-run-${id}`,
	};
	for (const [key, value] of Object.entries(opts.env ?? {})) {
		if (value === undefined) delete env[key];
		else env[key] = value;
	}

	const child = spawn(SHIM_LAUNCHER, opts.argv ?? [], {
		env,
		cwd: opts.cwd ?? REPO_ROOT,
		stdio: ["pipe", "pipe", "pipe"],
	});
	const out: Buffer[] = [];
	let err = "";
	let sawOutput = false;
	let resolveFirst: (() => void) | undefined;
	const firstOutput = new Promise<void>((res) => {
		resolveFirst = res;
	});

	child.stdout.on("data", (chunk: Buffer) => {
		out.push(chunk);
		if (!sawOutput) {
			sawOutput = true;
			resolveFirst?.();
			if (opts.signalShim) child.kill(opts.signalShim);
			if (opts.dropReaderAfterFirstChunk) child.stdout.destroy();
		}
	});
	if (opts.holdReadsMs !== undefined) {
		child.stdout.pause();
		setTimeout(() => child.stdout.resume(), opts.holdReadsMs);
	}
	child.stderr.on("data", (chunk: Buffer) => {
		err += chunk.toString("utf8");
	});

	const closed = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((res) => {
		child.on("close", (code, signal) => res({ code, signal }));
	});

	if (opts.waitForOutput) await Promise.race([firstOutput, closed]);
	for (const chunk of opts.stdin ?? []) {
		child.stdin.write(chunk);
		if (opts.stdinGapMs) await new Promise((res) => setTimeout(res, opts.stdinGapMs));
	}
	child.stdin.end();

	const startedAtMs = Date.now();
	const guard = setTimeout(() => child.kill("SIGKILL"), opts.guardMs ?? 30_000);
	const { code, signal } = await closed;
	clearTimeout(guard);
	const elapsedMs = Date.now() - startedAtMs;

	const parsed = readProbeEvents(logPath);
	return {
		stdout: Buffer.concat(out),
		stderr: err,
		code,
		signal,
		events: parsed.events,
		malformed: parsed.malformed,
		sequenceViolations: parsed.sequenceViolations,
		logPath,
		diagPath: `${logPath}.shim-diag`,
		elapsedMs,
		launchEnv: env,
	};
}

const named = (run: ShimRun, event: string): ProbeEvent[] => run.events.filter((e) => e.event === event);
const ndjson = (obj: unknown): Buffer => Buffer.from(`${JSON.stringify(obj)}\n`, "utf8");
const USER_FRAME = ndjson({ type: "user", message: { role: "user", content: "probe prompt body SECRET-PROMPT-TEXT" } });
const CONTROL_FRAME = ndjson({ type: "control_request", request_id: "r1", request: { subtype: "initialize" } });

// ===========================================================================
// 1) The launcher sits on the SDK's native spawn branch
// ===========================================================================
{
	assert.ok(
		existsSync(SHIM_LAUNCHER) &&
			SDK_SCRIPT_SUFFIXES.every((suffix) => !SHIM_LAUNCHER.endsWith(suffix)) &&
			(statSync(SHIM_LAUNCHER).mode & 0o111) !== 0 &&
			LAUNCHER_SRC.startsWith("#!/usr/bin/env node\n"),
		"the shim launcher is extensionless, executable, and shebang-led — a script suffix would move it onto the SDK's " +
			"`node|bun <path>` branch, which is NOT the branch the probe's target asserts [QK:SHIM-NATIVE-BRANCH-LAUNCHER]",
	);
	// The launcher must stay a launcher: behaviour belongs in the .ts SSOT, which
	// is the only half tsc/biome/mutants can reach.
	assert.ok(
		LAUNCHER_SRC.includes('import { runProbeCliShim } from "../lib/probe-cli-shim.ts";') &&
			LAUNCHER_SRC.includes("runProbeCliShim();"),
		"the extensionless launcher only delegates to the typechecked .ts implementation",
	);
}

// ===========================================================================
// 2) Byte transparency — adversarial framing must not reach the wire
// ===========================================================================
{
	// Mid-UTF8 splits, CRLF framing, an unterminated final line, and a line far
	// past any chunk size. Every one of these is a place a string-decoding
	// passthrough silently corrupts bytes (replacement characters) or a naive
	// line-reassembler re-frames the stream.
	const payload = Buffer.concat([
		Buffer.from('{"type":"user","message":"한글과 이모지 🌙🚀 그리고 ünïcödé"}\n', "utf8"),
		Buffer.from('{"type":"other","crlf":true}\r\n', "utf8"),
		Buffer.from(`{"type":"filler","big":"${"z".repeat(300_000)}"}\n`, "utf8"),
		Buffer.from('{"type":"unterminated","newline":false}', "utf8"),
	]);
	// Split at 7 bytes — coprime with everything, so multi-byte sequences and the
	// CRLF pair both land across chunk boundaries.
	const chunks: Buffer[] = [];
	for (let i = 0; i < payload.length; i += 7) chunks.push(payload.subarray(i, i + 7));

	// THE decisive run first, so a defect dies at its own signature: a pipe
	// coalesces back-to-back writes, so the bulk run below may never deliver the
	// boundary it planted. Here the two halves of one multi-byte character are
	// written with a gap wide enough that the OS delivers two separate reads —
	// this is what separates a byte-forwarding shim from a string-decoding one,
	// which turns the split character into U+FFFD and moves the hash.
	const multiByte = Buffer.from('{"t":"한 🌙"}\n', "utf8");
	// Derive the cut rather than hardcoding an offset: the first CONTINUATION byte
	// (10xxxxxx) is by definition inside a multi-byte sequence, so this stays a
	// real mid-character split no matter how the payload above is edited.
	const cut = multiByte.findIndex((byte) => (byte & 0xc0) === 0x80);
	assert.ok(cut > 0, "the payload really carries a multi-byte sequence to split");
	const split = await runShim({
		target: SPLIT_MIRROR_CLI,
		stdin: [multiByte.subarray(0, cut), multiByte.subarray(cut)],
		stdinGapMs: 25,
		waitForOutput: true,
	});
	const ready = Buffer.from(READY_MARKER, "utf8");
	assert.ok(
		split.stdout.subarray(0, ready.length).equals(ready) && split.stdout.length > ready.length,
		"the split mirror announced itself and only THEN received the halves — the boundary was planted against a " +
			"running reader, not against a pipe buffer filling while Node booted",
	);
	assert.equal(
		sha256(split.stdout.subarray(ready.length)),
		sha256(multiByte),
		"a chunk boundary INSIDE a multi-byte UTF-8 sequence, delivered as two separate reads, still crosses the shim " +
			"byte-for-byte — the scanner frames on bytes and only complete lines are ever decoded " +
			"[QK:SHIM-BYTE-TRANSPARENCY]",
	);

	// Bulk framing, on top: CRLF pairs, a 300 KB line, and a final line with no
	// newline at all — the shapes a naive line-reassembler re-frames.
	const bulk = await runShim({ target: MIRROR_CLI, stdin: chunks });
	assert.equal(bulk.code, 0, "the mirror CLI exits cleanly through the shim");
	assert.equal(
		sha256(bulk.stdout),
		sha256(payload),
		"bulk framing survives: CRLF, a 300 KB line and an unterminated final line all cross both scan sides unchanged",
	);
	assert.deepEqual(
		[bulk.malformed, bulk.sequenceViolations],
		[[], []],
		"the shim's own events clear both log doors on a transparency run",
	);
}

// ===========================================================================
// 3) The ordinal anchor counts PROMPT frames, not stdin lines
// ===========================================================================
{
	const run = await runShim({
		target: STREAM_CLI,
		stdin: [CONTROL_FRAME, USER_FRAME],
		waitForOutput: true,
	});
	const forwarded = named(run, PROBE_EVENTS.shimPromptForwarded);
	assert.ok(
		forwarded.length === 1 && forwarded[0].ordinal === 1,
		"the control-request frame is NOT a prompt: the SDK writes initialize control traffic on the same stdin, so " +
			'counting lines would blow the exactly-one binding on every run — only `type:"user"` frames take an ' +
			"ordinal [QK:SHIM-PROMPT-ORDINAL-USER-FRAMES-ONLY]",
	);

	// The boot init was RECEIVED before the prompt frame was forwarded, so it is a
	// legal non-candidate; the per-turn init is the one that binds. This is the
	// receive-axis binding the consumer half enforces — proved here end to end.
	const snapshots = named(run, PROBE_EVENTS.shimInitSnapshot);
	const anchorMs = forwarded[0].tsMs;
	const candidates = snapshots.filter((s) => (s.receivedAtMs as number) > anchorMs);
	assert.ok(
		snapshots.length === 2 &&
			(snapshots[0].tools as string[]).includes("BOOT_ONLY") &&
			candidates.length === 1 &&
			(candidates[0].tools as string[]).includes("mcp__probe__probe_nonce"),
		"both init lines are recorded, and exactly the per-turn one is RECEIVED after the prompt anchor",
	);
	assert.ok(
		snapshots.every((s) => (s.receivedAtMs as number) <= s.tsMs),
		"the snapshot interval is sane on every line: receive stamp never after the envelope stamp",
	);
}

// ===========================================================================
// 4) A malformed init is NOT an empty name set
// ===========================================================================
{
	const run = await runShim({ target: BAD_INIT_CLI, stdin: [USER_FRAME] });
	assert.equal(
		named(run, PROBE_EVENTS.shimInitSnapshot).length,
		0,
		"an init line with no `tools`, a non-array `tools`, or a `tools` holding a non-string yields NO snapshot: " +
			"reporting it as an EMPTY name set would FABRICATE the absence reading the B-name-snapshot ladder promotes " +
			"[QK:SHIM-INIT-REQUIRES-STRING-TOOL-ARRAY]",
	);
}

// ===========================================================================
// 5) Boot identity — the fact the classifier verifies against the roster
// ===========================================================================
{
	const run = await runShim({ target: STREAM_CLI, stdin: [USER_FRAME], waitForOutput: true });
	const boots = named(run, PROBE_EVENTS.shimBoot);
	assert.ok(
		boots.length === 1 && boots[0].targetPath === STREAM_CLI && boots[0].targetSha256 === hashFileSha256(STREAM_CLI),
		"the shim boots exactly once and reports the REAL path + content hash of what it exec'd — condition 5 has the " +
			"classifier verify this against the roster's expected identity, so a fabricated or omitted hash would let a " +
			"swapped binary vote in the pair [QK:SHIM-BOOT-TARGET-IDENTITY]",
	);
	assert.ok(
		boots[0].seq < named(run, PROBE_EVENTS.shimInitSnapshot)[0].seq,
		"the boot marker is appended before any snapshot — a spawn that dies still leaves the instrument's presence",
	);
}

// ===========================================================================
// 6) argv / cwd fidelity, the exact-allowlist scrub, and argv-agnostic passthrough
// ===========================================================================
{
	const decoyEnv = {
		PROBE_KEEP_ME: "operator-owned-value",
		ENTWURF_SHIM_DECOY: "another-operator-value",
		CLAUDE_CODE_EXECUTABLE: SHIM_LAUNCHER,
	};
	const argv = ["auth", "logout", "--flag=value with spaces", "-x"];
	const cwd = join(TMP, "session-cwd");
	mkdirSync(cwd, { recursive: true });

	const run = await runShim({ target: REPORT_CLI, argv, cwd, env: decoyEnv });
	assert.equal(run.code, 0, "the report CLI exits cleanly through the shim");
	const reported = JSON.parse(run.stdout.toString("utf8").split("\n")[0]) as {
		argv: string[];
		cwd: string;
		env: Record<string, string>;
	};

	assert.deepEqual(reported.argv, argv, "argv reaches the real CLI unchanged, including a value carrying spaces");
	assert.equal(reported.cwd, cwd, "the child inherits the shim's cwd — a relative target would resolve against it");

	for (const scrubbed of SHIM_SCRUB_ENV_VARS) {
		assert.ok(
			!Object.hasOwn(reported.env, scrubbed),
			`${scrubbed} is removed from the child env — leaving CLAUDE_CODE_EXECUTABLE would re-propagate the override ` +
				"to grandchildren (recursion, or a sub-agent measured through a second shim)",
		);
	}
	// "Every OTHER variable is identical" is a claim about the whole object, so it
	// is checked as one: build the expectation from the env the shim was launched
	// with, remove exactly the allowlist, and compare the child's entire env to it.
	// A sampled comparison (two decoys + PATH) stayed green while an implementation
	// deleted, say, HOME — the gate was weaker than the sentence it was defending
	// (adversarial review 2026-07-29).
	const expectedChildEnv: Record<string, string | undefined> = { ...run.launchEnv };
	for (const scrubbed of SHIM_SCRUB_ENV_VARS) delete expectedChildEnv[scrubbed];
	assert.deepEqual(
		reported.env,
		expectedChildEnv,
		"the child's env is the launch env MINUS exactly the allowlist and nothing else — every remaining key and value " +
			"byte-identical. A prefix scrub would eat the PROBE_-shaped operator variable this probe has no claim on, and " +
			"an incidental deletion anywhere else would move this too [QK:SHIM-SCRUB-EXACT-ALLOWLIST]",
	);

	// The `claude auth logout` consumer: not a stream-json turn, so the only line
	// the shim may log is its boot marker.
	assert.ok(
		run.events.length === 1 && run.events[0].event === PROBE_EVENTS.shimBoot,
		"an invocation that is not a stream-json turn is PURE passthrough — `claudeCliPath()` has a second consumer " +
			"(claude auth logout), and the shim must assume nothing about its argv [QK:SHIM-ARGV-AGNOSTIC-PASSTHROUGH]",
	);
}

// ===========================================================================
// 7) Nothing about argv, env, or the prompt body reaches the log
// ===========================================================================
{
	const secretArg = "--secret-argv-token-9f3a";
	const secretEnv = "SECRET-ENV-VALUE-4c7b";
	const run = await runShim({
		target: STREAM_CLI,
		argv: [secretArg],
		stdin: [USER_FRAME],
		env: { ENTWURF_SHIM_SECRET: secretEnv },
		waitForOutput: true,
	});
	const logText = readFileSync(run.logPath, "utf8");
	assert.ok(
		!logText.includes(secretArg) &&
			!logText.includes(secretEnv) &&
			!logText.includes("SECRET-PROMPT-TEXT") &&
			!logText.includes("ENTWURF_SHIM_SECRET"),
		"the shared log carries no argv, no env name or value, and no prompt body — only the allowlisted init fields, " +
			"an ordinal, and timings [QK:SHIM-LOG-PRIVACY]",
	);
}

// ===========================================================================
// 8) Exit status, signal disposition, stderr
// ===========================================================================
{
	const nonzero = await runShim({ target: EXIT_CLI, argv: ["42"] });
	assert.ok(
		nonzero.code === 42 && nonzero.signal === null,
		"a nonzero CLI exit reaches the parent as the SAME code — a wrapper that reports 0 turns a crash into a " +
			"measurement [QK:SHIM-EXIT-CODE-FIDELITY]",
	);

	const signalled = await runShim({ target: SELF_SIGNAL_CLI, argv: ["SIGKILL"] });
	assert.ok(
		signalled.signal === "SIGKILL" && signalled.code === null,
		"a CLI that dies on a signal makes the SHIM die on that same signal: the parent's wait status must carry the " +
			"child's real disposition, not a synthesised 128+n exit code [QK:SHIM-SIGNAL-RERAISE]",
	);

	const inbound = await runShim({ target: SLEEPER_CLI, signalShim: "SIGTERM" });
	assert.ok(
		inbound.signal === "SIGTERM",
		"a signal sent to the shim is forwarded to the child, whose death then re-raises it here — otherwise the ACP " +
			"child's teardown would leave the real CLI orphaned [QK:SHIM-INBOUND-SIGNAL-FORWARDED]",
	);

	const stderrRun = await runShim({ target: STDERR_CLI });
	assert.ok(
		stderrRun.stderr.includes("diagnostic tail from the CLI") &&
			stderrRun.stdout.toString("utf8") === "out\n" &&
			stderrRun.code === 3,
		"stderr passes through untouched (the SDK reads a stderr tail for its own diagnostics) and does not leak into stdout",
	);
}

// ===========================================================================
// 9) Spawn failures are NAMED, not swallowed
// ===========================================================================
{
	const missing = await runShim({ target: join(TMP, "no-such-cli") });
	assert.ok(
		missing.code === 127 &&
			missing.stderr.includes("ENOENT") &&
			missing.stderr.includes("[probe-cli-shim] cannot read exec target"),
		"a target that vanished under the pair fails loud with the shell convention for not-found — the runner asserted " +
			"it was present, so reaching this is a fact the operator needs in words, on ONE errno mapping shared by the " +
			"unreadable-at-hash and unspawnable-at-exec paths [QK:SHIM-SPAWN-ERROR-NAMED]",
	);
	assert.equal(
		named(missing, PROBE_EVENTS.shimBoot).length,
		0,
		"a target with no readable content has no knowable identity, so NO boot marker is written: a placeholder hash " +
			"would fabricate the very fact condition 5 has the classifier verify, and the absence is already named " +
			"upstream as snapshot-instrument-absent",
	);

	const noexec = join(TMP, "not-executable-cli");
	writeFileSync(noexec, "#!/bin/sh\nexit 0\n");
	chmodSync(noexec, 0o644);
	const denied = await runShim({ target: noexec });
	assert.ok(
		denied.code === 126 && denied.stderr.includes("EACCES") && denied.stderr.includes("cannot execute"),
		"a readable but non-executable target hashes fine and then fails at the spawn — EACCES as 126",
	);
	assert.equal(
		named(denied, PROBE_EVENTS.shimBoot).length,
		1,
		"that path DID know the identity, so the boot marker landed before the failed spawn — the instrument's presence " +
			"is recorded even when the CLI never ran",
	);
}

// ===========================================================================
// 10) The framing buffer is bounded, and a skipped parse never costs bytes
// ===========================================================================
{
	const run = await runShim({ target: BIG_LINE_CLI, stdin: [USER_FRAME] });
	const expected = Buffer.concat([
		Buffer.from("x".repeat(OVERSIZED_LINE_BYTES), "utf8"),
		Buffer.from("\n", "utf8"),
		ndjson({ type: "system", subtype: "init", tools: ["AFTER_BIG"], mcp_servers: [] }),
	]);
	const snapshots = named(run, PROBE_EVENTS.shimInitSnapshot);
	assert.ok(
		run.code === 0 &&
			sha256(run.stdout) === sha256(expected) &&
			snapshots.length === 1 &&
			(snapshots[0].tools as string[])[0] === "AFTER_BIG" &&
			existsSync(run.diagPath),
		"a line past the framing bound loses its PARSE, never its BYTES: the oversized line is forwarded verbatim, the " +
			"scanner recovers at the next newline so the following init still binds, and the skip is recorded in a " +
			"forensic sidecar rather than as an unknown marker the log door would call MALFORMED " +
			"[QK:SHIM-OVERSIZED-LINE-PARSE-SKIP]",
	);
	const diag = JSON.parse(readFileSync(run.diagPath, "utf8").trim()) as Record<string, unknown>;
	assert.ok(
		diag.stdoutLineParseSkipped === 1 && diag.stdinLineParseSkipped === 0,
		"the sidecar names WHICH side skipped, so a missing snapshot is diagnosable as a bound hit rather than silence",
	);
}

// ===========================================================================
// 10b) The framing bound holds in OBJECTS, not just bytes
// ===========================================================================
{
	// A peer that writes one byte at a time reaches the byte cap having caused one
	// retention per read. That is the shape a piece-list scanner walks straight
	// through while still passing every byte-cap assertion above, so the object
	// cost is measured here directly on the scanner.
	const scanner = new NdjsonLineScanner();
	const lineBytes = 256 * 1024;
	const one = Buffer.alloc(1, 0x61);
	let framed: Buffer | undefined;
	for (let i = 0; i < lineBytes; i += 1) scanner.feed(one, () => {});
	scanner.feed(Buffer.from("\n", "utf8"), (line) => {
		framed = Buffer.from(line);
	});
	assert.ok(
		framed !== undefined && framed.length === lineBytes,
		"a line delivered one byte at a time is still framed whole and intact",
	);
	// Re-run to read the counter at its peak: geometric growth over 256 KiB from a
	// 64 KiB floor is a handful of allocations; per-read retention would be 262144.
	const counted = new NdjsonLineScanner();
	for (let i = 0; i < lineBytes; i += 1) counted.feed(one, () => {});
	assert.ok(
		counted.retainedAllocations > 0 && counted.retainedAllocations <= 32,
		`framing a ${lineBytes / 1024} KiB line out of ${lineBytes} single-byte reads cost ` +
			`${counted.retainedAllocations} allocations — the bound is a bound on OBJECTS as well as bytes, or a hostile ` +
			"stream reaches the byte cap holding millions of buffer headers and the 'bounded in-memory line buffer' " +
			"claim is false exactly where it matters [QK:SHIM-FRAMING-BOUNDED-IN-OBJECTS]",
	);
}

// ===========================================================================
// 11) Backpressure: a slow reader costs latency, never bytes
// ===========================================================================
{
	const run = await runShim({ target: FLOOD_CLI, holdReadsMs: 300 });
	const tail = ndjson({ type: "system", subtype: "init", tools: ["AFTER_FLOOD"], mcp_servers: [] });
	// The flood writes whole 64 KiB+1 chunks until it has passed FLOOD_BYTES, so
	// the exact length is the first multiple of the chunk size at or above it —
	// derived here rather than hardcoded, and every byte of it is accounted for.
	const chunkBytes = 64 * 1024 + 1;
	const floodBytes = Math.ceil(FLOOD_BYTES / chunkBytes) * chunkBytes;
	assert.equal(run.code, 0, "the flooding CLI exits cleanly through a stalled reader");
	assert.ok(
		run.stdout.length === floodBytes + tail.length &&
			run.stdout.subarray(floodBytes).equals(tail) &&
			named(run, PROBE_EVENTS.shimInitSnapshot).length === 1,
		"a downstream reader that stalls for 300 ms costs latency, never bytes: every flooded byte still arrives, in " +
			"order, and the init line written after the stall still binds",
	);
}

// ===========================================================================
// 11b) stdin backpressure and EOF, and a downstream that dies mid-turn
// ===========================================================================
{
	// The CLI parks its stdin for 300 ms, so the shim's write to the child returns
	// false and the stdin-side pause/resume path actually runs. CP2 asked for stdin
	// EOF and backpressure together, and they are one story: the shim must hold the
	// upstream, resume on drain, and then still close the child's stdin so the CLI
	// sees EOF and exits.
	const payload = Buffer.alloc(2 * 1024 * 1024, 0x6b);
	const chunks: Buffer[] = [];
	for (let i = 0; i < payload.length; i += 64 * 1024) chunks.push(payload.subarray(i, i + 64 * 1024));
	const slow = await runShim({ target: SLOW_READER_CLI, stdin: chunks });
	assert.ok(
		slow.code === 0 && sha256(slow.stdout) === sha256(payload),
		"a CLI that parks its stdin gets every byte anyway, and stdin EOF still propagates so it exits — the shim holds " +
			"its upstream under child-stdin backpressure instead of dropping or queueing without bound",
	);

	// The SDK giving up mid-turn: our read end dies while the CLI is still
	// flooding. The shim can no longer deliver anything, so it must TEAR DOWN
	// rather than park its source waiting for a 'drain' that a dead stream will
	// never emit — a bare error-ignore turns a closed consumer into a hung
	// instrument holding a live CLI open (adversarial review 2026-07-29).
	const dropped = await runShim({ target: FLOOD_CLI, dropReaderAfterFirstChunk: true, guardMs: 8_000 });
	assert.ok(
		dropped.elapsedMs < 4_000,
		`the shim took ${dropped.elapsedMs} ms to end after its downstream reader vanished. Measured dispositions: ` +
			"tearing down on the error ends it in ~0.2 s, while merely IGNORING the error parks the source on a drain " +
			"that can never arrive and it survives until something kills it — with the real CLI still alive behind it. " +
			"Promptness is the discriminator; the exit disposition is not, because the ignore path can also die of its " +
			"own unhandled error [QK:SHIM-DOWNSTREAM-DEATH-TEARS-DOWN]",
	);
}

// ===========================================================================
// 11c) An oversized line with no terminator is still reported
// ===========================================================================
{
	const run = await runShim({ target: UNTERMINATED_BIG_CLI, stdin: [USER_FRAME] });
	const expected = Buffer.alloc(OVERSIZED_LINE_BYTES, 0x71);
	assert.ok(
		run.code === 0 && sha256(run.stdout) === sha256(expected),
		"an oversized UNTERMINATED line still crosses byte-for-byte",
	);
	const diag = existsSync(run.diagPath)
		? (JSON.parse(readFileSync(run.diagPath, "utf8").trim()) as Record<string, unknown>)
		: undefined;
	assert.ok(
		diag !== undefined && diag.stdoutLineParseSkipped === 1,
		"a line that blew the framing bound and then hit EOF WITHOUT a newline is still counted: the scanner finalises at " +
			"stream end, so the skip diagnostic cannot silently under-report the one shape that never meets a newline " +
			"[QK:SHIM-OVERSIZE-COUNTED-AT-EOF]",
	);
}

// ===========================================================================
// 12) Source pins — properties no cheap behaviour here can separate
// ===========================================================================
{
	// WHY the source of the pause is pinned instead of measured: byte completeness
	// above cannot tell a shim that pauses its SOURCE from one that queues the
	// whole transcript, because both deliver every byte. Peak RSS was tried as the
	// discriminator and REFUSED on measurement — against an 8x larger flood the
	// pausing form read 173–217 MiB and the queueing form 243–252 MiB on this host,
	// overlapping ranges dominated by GC timing rather than by held data. Shipping
	// that as a threshold would have bought a flaky gate, not a proof.
	assert.ok(
		SHIM_SRC.includes(
			"		if (!flushed) {\n" +
				"			childStdout.pause();\n" +
				'			process.stdout.once("drain", () => childStdout.resume());\n' +
				"		}",
		),
		"under write backpressure on STDOUT the shim stops READING the CLI rather than letting the writable queue grow — " +
			"peak memory is then set by the pipe buffers, not by the transcript size, which is what keeps an instrument " +
			"on a live turn from becoming a memory hazard [QK:SHIM-STDOUT-BACKPRESSURE-PAUSES-SOURCE]",
	);
	assert.ok(
		SHIM_SRC.includes(
			"		if (!flushed) {\n" +
				"			process.stdin.pause();\n" +
				'			childStdin.once("drain", () => process.stdin.resume());\n' +
				"		}",
		),
		"the SAME discipline holds on the stdin side: a CLI slow to read its input must park the SDK's stream, not be " +
			"absorbed into this process's memory. 11b proves the bytes and the EOF survive it; which side does the " +
			"parking is what is pinned here [QK:SHIM-STDIN-BACKPRESSURE-PAUSES-SOURCE]",
	);
	assert.ok(
		SHIM_SRC.includes(
			"const flushed = process.stdout.write(chunk, (err) => {\n" +
				"\t\t\tif (err) return;\n" +
				"\t\t\tfor (const snapshot of snapshots) emit(PROBE_EVENTS.shimInitSnapshot, { ...snapshot });\n" +
				"\t\t});",
		),
		"the snapshot append lives INSIDE the downstream write callback, so the one clock read that stamps the event IS " +
			"the hand-off moment — the interval's single-SSOT end (§11-7-c condition 6). Timing cannot separate this " +
			"placement from one just outside the callback, because the shim pauses its source under backpressure and " +
			"couples the read to the write, so the shape is pinned here [QK:SHIM-SNAPSHOT-IN-WRITE-CALLBACK]",
	);
	assert.ok(
		SHIM_SRC.includes(
			"const flushed = childStdin.write(chunk, (err) => {\n" +
				"\t\t\tif (err) return;\n" +
				"\t\t\tfor (const ordinal of ordinals) emit(PROBE_EVENTS.shimPromptForwarded, { ordinal });\n" +
				"\t\t});",
		),
		"the prompt anchor is stamped inside the CHILD-STDIN write callback — 'fully passed to the CLI's stdin', not " +
			"'we saw a newline'; and an errored write never stamps a hand-off that did not happen " +
			"[QK:SHIM-PROMPT-IN-WRITE-CALLBACK]",
	);
	assert.ok(
		SHIM_SRC.includes('stdio: ["pipe", "pipe", "inherit"],') && !/\bshell\s*:/.test(SHIM_SRC),
		"the shim spawns with no shell and hands the child its own fd 2 — exact stderr passthrough, no buffering",
	);
}

console.log("[check-probe-cli-shim] OK — §11-7-c producer matrix green (fake CLIs only, no API)");
