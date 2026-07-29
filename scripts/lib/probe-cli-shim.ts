// §11-7-c B-name-snapshot seam — the PRODUCER half (docs/acp-backend-rail.md).
//
// The consumer half (probe-cli-target.ts preconditions, the event-log doors, the
// classifier ladder) was built and mutant-qualified first; this is the instrument
// it was specified against. The shim sits at CLAUDE_CODE_EXECUTABLE, spawns the
// REAL CLI the runner resolved, and tees the stream-json stdout so the CLI's own
// per-turn `system`/`init` tool-NAME set becomes an oracle that does not depend on
// model compliance (§11-7-b measured that stimulus tuning cannot reach delta-B).
//
// What it must NOT be is a second copy of upstream launch semantics. The runner
// already refused an ambient override, resolved the target through upstream
// `claudeCliPath()`, and asserted the native branch (absolute ∧ no script suffix ∧
// regular file ∧ X_OK). So the shim RESOLVES NOTHING: it execs exactly the path it
// was handed and reports that path plus its content hash, which is the fact the
// classifier verifies against the roster (§11-7-c condition 5 — a managed-policy
// env swap of the target can then never promote, it becomes a NAMED structural
// finding instead of an anonymous no-snapshot).
//
// Three properties are load-bearing and each one is a place this could silently
// lie, so each is stated here and proved by the fake-CLI matrix in
// check-probe-cli-shim:
//
//   1. BYTE TRANSPARENCY. Every byte that arrives is written downstream unchanged
//      and in order. The NDJSON scanning is a SIDE observation over a bounded
//      buffer — it never reframes, re-encodes, or re-chunks the stream. Line
//      splitting is done on BYTES (0x0a), never on a decoded string, so a chunk
//      boundary inside a multi-byte UTF-8 sequence cannot corrupt the passthrough
//      or the framing.
//
//   2. THE SNAPSHOT APPEND HAPPENS INSIDE THE DOWNSTREAM WRITE CALLBACK. §11-7-c
//      condition 6 makes the snapshot timestamp an INTERVAL — full line received ↔
//      handed downstream — whose END has ONE SSOT: the event's own envelope
//      `tsMs`. Appending inside the callback is what makes the single clock read
//      that stamps the line BE the callback moment; the payload therefore carries
//      only `receivedAtMs`, and the door holds `receivedAtMs ≤ tsMs`. Like the
//      fixture's write-callback timing, this PLACEMENT is review-pinned rather
//      than mutant-proven (the honesty carve-out recorded in §11-7-c).
//
//   3. THE SCRUB IS AN EXACT ALLOWLIST. `SHIM_SCRUB_ENV_VARS` (the single source
//      in probe-cli-target.ts) leaves the child env otherwise byte-identical. A
//      prefix scrub would delete operator env this probe has no claim on, and
//      NOT scrubbing CLAUDE_CODE_EXECUTABLE would re-propagate the override to
//      grandchildren — recursion, or a sub-agent measured through a second shim.
//
// It is ARGV-AGNOSTIC on purpose: `claudeCliPath()` has a second consumer
// (`claude auth logout`, acp-agent.js:841), so an invocation that is not a
// stream-json turn must be pure passthrough whose only log line is the boot
// marker. Nothing about argv, env, auth, or prompt bodies is ever logged — the
// only payload that leaves this process is the allowlisted init fields (tools,
// mcp_servers status, model) plus an ordinal and timings.

import { spawn } from "node:child_process";
import { appendFileSync, writeSync } from "node:fs";
import { constants as osConstants } from "node:os";
import { hashFileSha256, PROBE_SHIM_ENV, SHIM_SCRUB_ENV_VARS } from "./probe-cli-target.ts";
import { appendProbeEvent, PROBE_EVENTS } from "./probe-event-log.ts";

const NEWLINE = 0x0a;

/** Bound on the in-memory NDJSON framing buffer (§11-7-c condition 3: "a bounded
 *  in-memory line buffer"). A single stream-json line larger than this cannot be
 *  parsed without letting a hostile or pathological stream drive this process's
 *  memory, so the PARSE is skipped — the BYTES still pass through untouched,
 *  because passthrough never depends on the scanner. The contract consequence of
 *  a skipped parse is fail-closed by construction: a skipped init line yields
 *  zero bound candidates and a skipped prompt frame yields zero anchors, both of
 *  which are NAMED reading violations in the classifier, never a quiet promotion.
 *  16 MiB is ~500x the largest init line this seam has measured (a ~30 KB name
 *  set), so reaching it means the stream stopped being stream-json. */
export const SHIM_MAX_LINE_BYTES = 16 * 1024 * 1024;

/** Signals forwarded to the child and then RE-RAISED on ourselves, so the parent's
 *  wait status carries the child's real (code, signal) instead of the shim's. */
const FORWARDED_SIGNALS: readonly NodeJS.Signals[] = ["SIGTERM", "SIGINT"];

/** Zero-length flush barrier. `write()`'s callback fires only after every queued
 *  chunk has reached the OS, so this is how the shim proves it lost no forwarded
 *  byte to `process.exit()`, which truncates pending async writes on a pipe. */
const FLUSH_BARRIER = Buffer.alloc(0);

interface InitSnapshotPayload {
	tools: string[];
	receivedAtMs: number;
	mcpServers?: Array<{ name: string; status: string }>;
	model?: string;
}

/** Byte-level NDJSON line framing over a buffer bounded in BOTH dimensions.
 *
 *  Splitting on bytes rather than on a decoded string is not a micro-optimisation:
 *  a chunk boundary can fall inside a multi-byte UTF-8 sequence, and decoding each
 *  chunk independently would produce replacement characters that corrupt the line
 *  the parser then judges. Only COMPLETE lines are decoded.
 *
 *  The partial line lives in ONE buffer that grows geometrically to a hard cap —
 *  not in an array of per-chunk pieces (adversarial review 2026-07-29). A piece
 *  list is bounded in BYTES and unbounded in OBJECTS: a peer writing one byte at a
 *  time reaches the byte cap holding sixteen million Buffer headers plus the array
 *  indexing them, so "a bounded in-memory line buffer" would have been false
 *  exactly where it mattered — under a hostile stream. One buffer makes the bound
 *  O(cap) in both dimensions, and the copy it costs is paid only by lines that
 *  actually span reads: a line whole inside its chunk is handed to the parser as a
 *  VIEW, with no copy and nothing retained. */
const INITIAL_LINE_CAPACITY = 64 * 1024;
/** Above this a completed line's buffer is released instead of kept for reuse —
 *  one big line must not leave the instrument holding that much for a whole turn. */
const RETAINED_LINE_CAPACITY = 1024 * 1024;

export class NdjsonLineScanner {
	private buffer: Buffer = Buffer.alloc(0);
	private length = 0;
	private overflowed = false;
	/** Lines whose parse was skipped because they exceeded the buffer bound. */
	overflowCount = 0;
	/** Allocations the CURRENT partial line has cost — the object half of the
	 *  framing bound, made observable. Geometric growth keeps it logarithmic in the
	 *  line's length however many reads it arrived in; per-read retention (a piece
	 *  list, or a buffer regrown to the exact size each time) makes it linear in the
	 *  number of reads, which is the bound a one-byte-at-a-time peer walks through. */
	retainedAllocations = 0;

	feed(chunk: Buffer, onLine: (line: Buffer) => void): void {
		let start = 0;
		for (;;) {
			const nl = chunk.indexOf(NEWLINE, start);
			if (nl === -1) {
				this.absorb(chunk.subarray(start));
				return;
			}
			const piece = chunk.subarray(start, nl);
			if (this.length === 0 && !this.overflowed) {
				if (piece.length > SHIM_MAX_LINE_BYTES) this.overflowCount += 1;
				else if (piece.length > 0) onLine(piece);
			} else {
				this.absorb(piece);
				if (this.overflowed) this.overflowCount += 1;
				else onLine(this.buffer.subarray(0, this.length));
			}
			this.reset();
			start = nl + 1;
		}
	}

	/** Stream end. A line still OVER the bound when the stream closed never met a
	 *  newline, so `feed` never counted it; without this the skip diagnostic would
	 *  under-report exactly the unterminated-oversized shape. */
	finalize(): void {
		if (this.overflowed) this.overflowCount += 1;
		this.reset();
	}

	private absorb(slice: Buffer): void {
		if (this.overflowed || slice.length === 0) return;
		const needed = this.length + slice.length;
		if (needed > SHIM_MAX_LINE_BYTES) {
			this.overflowed = true;
			this.buffer = Buffer.alloc(0);
			this.length = 0;
			return;
		}
		if (needed > this.buffer.length) {
			let capacity = Math.max(this.buffer.length, INITIAL_LINE_CAPACITY);
			while (capacity < needed) capacity *= 2;
			const grown = Buffer.allocUnsafe(Math.min(capacity, SHIM_MAX_LINE_BYTES));
			this.retainedAllocations += 1;
			this.buffer.copy(grown, 0, 0, this.length);
			this.buffer = grown;
		}
		slice.copy(this.buffer, this.length);
		this.length = needed;
	}

	private reset(): void {
		this.length = 0;
		this.overflowed = false;
		this.retainedAllocations = 0;
		if (this.buffer.length > RETAINED_LINE_CAPACITY) this.buffer = Buffer.alloc(0);
	}
}

function parseJsonObject(line: Buffer): Record<string, unknown> | undefined {
	try {
		const parsed: unknown = JSON.parse(line.toString("utf8"));
		if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return undefined;
		return parsed as Record<string, unknown>;
	} catch {
		return undefined;
	}
}

/** A stream-json INPUT frame carrying a turn's prompt.
 *
 *  Measured, not assumed (claude-agent-sdk 0.3.219): the SDK writes NDJSON to the
 *  CLI's stdin from two places — control traffic (`{"type":"control_request"…}` /
 *  `control_response`) and `streamInput`, which serializes each user message as
 *  `{"type":"user",…}`. Counting every stdin line would therefore count the
 *  initialize handshake as prompts and blow the exactly-one binding on every run;
 *  the prompt axis is the `user` frames alone. */
function isPromptFrame(line: Buffer): boolean {
	return parseJsonObject(line)?.type === "user";
}

/** The §11-7-c oracle line: `SDKSystemMessage` with `subtype: 'init'`, which
 *  sdk.d.ts:4412 defines as carrying `tools: string[]` and
 *  `mcp_servers: {name,status}[]`, re-emitted per turn (acp-agent.js:1573-1587).
 *
 *  `tools` must be a real array of strings or this returns nothing. An init line
 *  whose name set is missing or mistyped would otherwise be reported as an EMPTY
 *  name set — and an empty set is exactly what the B-name-snapshot ladder reads as
 *  ABSENCE of the measured id. Fabricating an absence claim out of a malformed
 *  line is the one failure this instrument must never have, so the line simply
 *  does not become a candidate and the run fails closed on cardinality. */
function initSnapshotOf(line: Buffer, receivedAtMs: number): InitSnapshotPayload | undefined {
	const obj = parseJsonObject(line);
	if (obj === undefined || obj.type !== "system" || obj.subtype !== "init") return undefined;
	if (!Array.isArray(obj.tools) || !obj.tools.every((t) => typeof t === "string")) return undefined;
	const payload: InitSnapshotPayload = { tools: obj.tools as string[], receivedAtMs };
	if (Array.isArray(obj.mcp_servers)) {
		// Allowlist entries whose two fields are ALREADY strings rather than
		// coercing: `String(someObject)` would put "[object Object]" into the
		// evidence log as though the CLI had reported it. This fact never promotes
		// anything, which is all the more reason not to manufacture it.
		payload.mcpServers = obj.mcp_servers
			.filter((entry): entry is { name: string; status: string } => {
				if (typeof entry !== "object" || entry === null) return false;
				const fields = entry as Record<string, unknown>;
				return typeof fields.name === "string" && typeof fields.status === "string";
			})
			.map((entry) => ({ name: entry.name, status: entry.status }));
	}
	if (typeof obj.model === "string") payload.model = obj.model;
	return payload;
}

function abort(message: string, code: number): never {
	// writeSync, not process.stderr.write. Node documents stream writes to a pipe
	// as synchronous on Linux, so the truncation this avoids is latent here rather
	// than live — but the NAMED-failure contract should not rest on a
	// platform-specific guarantee about the one path that reports why the
	// instrument could not run (adversarial review 2026-07-29). Partial writes are
	// looped because write(2) may accept fewer bytes than offered.
	const bytes = Buffer.from(`[probe-cli-shim] ${message}\n`, "utf8");
	let written = 0;
	while (written < bytes.length) {
		try {
			written += writeSync(2, bytes, written, bytes.length - written);
		} catch {
			break; // stderr is gone; the exit status still carries the fact
		}
	}
	process.exit(code);
}

/** One errno→status mapping for BOTH ways the target can be unusable — unreadable
 *  at hash time and unspawnable at exec time. Shell conventions (127 not-found,
 *  126 not-executable) keep the status readable to whatever launched us, and using
 *  the same mapping on both paths means the operator reads one story about the
 *  target rather than two unrelated numbers. */
function exitStatusForErrno(code: string | undefined): number {
	if (code === "ENOENT") return 127;
	if (code === "EACCES") return 126;
	return 70;
}

function requiredShimEnv(name: string): string {
	const value = process.env[name];
	// The shim is probe-only: the runner sets all three vars together, so a
	// missing one means this binary was reached by something other than the probe
	// (a stale CLAUDE_CODE_EXECUTABLE in an operator shell, say). Failing loud
	// beats silently exec-ing a target we cannot name in the log.
	if (typeof value !== "string" || value.length === 0) {
		abort(`missing required env ${name} — this shim is probe-only and its runner sets ${name}`, 70);
	}
	return value;
}

export function runProbeCliShim(): void {
	const targetPath = requiredShimEnv(PROBE_SHIM_ENV.target);
	const eventLog = requiredShimEnv(PROBE_SHIM_ENV.eventLog);
	const runId = requiredShimEnv(PROBE_SHIM_ENV.runId);

	const emit = (event: (typeof PROBE_EVENTS)[keyof typeof PROBE_EVENTS], payload: Record<string, unknown>): void => {
		appendProbeEvent(eventLog, runId, event, payload);
	};

	// Boot marker FIRST — before the spawn can fail. §11-7-c condition 7 makes a
	// missing boot marker on an armed roster a NAMED structural finding
	// (`snapshot-instrument-absent` / `snapshot-topology`), which is precisely how
	// a managed-policy env application that replaced the shim inside the ACP child
	// becomes visible instead of looking like "the CLI just did not re-emit init".
	// The hash is taken HERE, by the process that actually execs it, because the
	// classifier verifies this report against the roster's expected identity.
	//
	// A target that cannot be READ has no knowable identity, so there is no boot
	// marker to write: emitting one with a placeholder hash would be fabricating
	// exactly the fact condition 5 has the classifier verify. The absence is the
	// honest report, and the consumer already names it (`snapshot-instrument-absent`
	// → structural, P0), so this exits before the spawn rather than guessing.
	let targetSha256: string;
	try {
		targetSha256 = hashFileSha256(targetPath);
	} catch (err) {
		const code = (err as NodeJS.ErrnoException).code;
		abort(`cannot read exec target ${targetPath}: ${code ?? (err as Error).message}`, exitStatusForErrno(code));
	}
	emit(PROBE_EVENTS.shimBoot, { targetPath, targetSha256 });

	// Exact-allowlist scrub (§11-7-c condition 4). Every other variable keeps its
	// key AND its value byte-for-byte: under the runner's ambient-override refusal
	// there is no prior operator value to restore, so deletion IS preservation.
	const childEnv: NodeJS.ProcessEnv = { ...process.env };
	for (const name of SHIM_SCRUB_ENV_VARS) delete childEnv[name];

	// Same argv, same cwd (inherited — passing an explicit cwd would be a second
	// copy of a fact we already hold), no shell. stderr is `inherit` rather than a
	// copied pipe: handing the child our own fd 2 is exact passthrough with no
	// buffering, no reordering, and nothing lost at exit, and the SDK reads a
	// stderr tail for its own diagnostics.
	const child = spawn(targetPath, process.argv.slice(2), {
		env: childEnv,
		stdio: ["pipe", "pipe", "inherit"],
		windowsHide: true,
	});
	const childStdin = child.stdin;
	const childStdout = child.stdout;
	if (childStdin === null || childStdout === null) abort("child stdio pipes were not created", 70);

	const stdinScanner = new NdjsonLineScanner();
	const stdoutScanner = new NdjsonLineScanner();
	let promptOrdinal = 0;
	let finished = false;

	// A closed downstream (the SDK gave up, the CLI died) is not this process's
	// error to raise — it must not become an unhandled 'error' crash that changes
	// the exit status the parent observes. But IGNORING it is not enough: the
	// backpressure path parks the source until a 'drain' a dead stream will never
	// emit, so a bare ignore turns a closed consumer into a HUNG instrument holding
	// a live CLI open (adversarial review 2026-07-29). Losing stdout means the turn
	// cannot be delivered at all, so unpark the source and tear the child down.
	childStdin.on("error", (): void => {});
	process.stdout.on("error", (): void => {
		childStdout.resume();
		if (!finished) child.kill("SIGTERM");
	});

	// --- stdin: SDK → shim → real CLI -------------------------------------
	// The prompt anchor is stamped in the DOWNSTREAM write callback, i.e. when the
	// bytes completing the frame reached the CLI's stdin — "fully passed to the
	// CLI's stdin", not "we saw a newline". Only a successful callback stamps: an
	// errored write must never claim a hand-off that did not happen (the same
	// discipline the fixture applies to the wire marker).
	process.stdin.on("data", (chunk: Buffer) => {
		const ordinals: number[] = [];
		stdinScanner.feed(chunk, (line) => {
			if (isPromptFrame(line)) ordinals.push(++promptOrdinal);
		});
		const flushed = childStdin.write(chunk, (err) => {
			if (err) return;
			for (const ordinal of ordinals) emit(PROBE_EVENTS.shimPromptForwarded, { ordinal });
		});
		// Backpressure: stop READING upstream while the child's stdin is full,
		// instead of letting Node's writable queue grow without bound.
		if (!flushed) {
			process.stdin.pause();
			childStdin.once("drain", () => process.stdin.resume());
		}
	});
	process.stdin.on("end", () => {
		stdinScanner.finalize();
		childStdin.end();
	});

	// --- stdout: real CLI → shim → SDK ------------------------------------
	// ONE clock read per chunk is the receive stamp for every line that COMPLETES
	// in that chunk: the line became whole when its newline arrived, which is this
	// moment. The snapshot event is appended INSIDE the downstream write callback
	// so the envelope `tsMs` the log door stamps IS the hand-off moment — the
	// interval's single-SSOT end (§11-7-c condition 6).
	childStdout.on("data", (chunk: Buffer) => {
		const receivedAtMs = Date.now();
		const snapshots: InitSnapshotPayload[] = [];
		stdoutScanner.feed(chunk, (line) => {
			const snapshot = initSnapshotOf(line, receivedAtMs);
			if (snapshot !== undefined) snapshots.push(snapshot);
		});
		const flushed = process.stdout.write(chunk, (err) => {
			if (err) return;
			for (const snapshot of snapshots) emit(PROBE_EVENTS.shimInitSnapshot, { ...snapshot });
		});
		if (!flushed) {
			childStdout.pause();
			process.stdout.once("drain", () => childStdout.resume());
		}
	});

	// --- lifecycle --------------------------------------------------------
	const writeOverflowDiagnostic = (): void => {
		const total = stdinScanner.overflowCount + stdoutScanner.overflowCount;
		if (total === 0) return;
		// Deliberately NOT an event in the shared log: the log's vocabulary is a
		// closed contract the classifier judges on, and an unknown marker name is
		// MALFORMED at the door. This sidecar is forensics only — the contract
		// consequence of a skipped parse is already fail-closed (zero anchors or
		// zero candidates, both NAMED readings).
		try {
			appendFileSync(
				`${eventLog}.shim-diag`,
				`${JSON.stringify({
					runId,
					pid: process.pid,
					stdinLineParseSkipped: stdinScanner.overflowCount,
					stdoutLineParseSkipped: stdoutScanner.overflowCount,
					maxLineBytes: SHIM_MAX_LINE_BYTES,
				})}\n`,
				"utf8",
			);
		} catch {
			// A diagnostic that cannot be written must not change the exit status.
		}
	};

	const reRaise = (signal: NodeJS.Signals): void => {
		// Restore the default disposition before signalling ourselves, or our own
		// forwarding handler would swallow it and the parent would read a plain
		// exit where the child actually died on a signal.
		for (const forwarded of FORWARDED_SIGNALS) process.removeAllListeners(forwarded);
		process.stdin.destroy();
		process.kill(process.pid, signal);
		// Only reached if this signal is ignored or blocked for us; do not hang.
		const number = osConstants.signals[signal as keyof typeof osConstants.signals] ?? 0;
		setTimeout(() => process.exit(number > 0 ? 128 + number : 1), 200);
	};

	const finish = (code: number | null, signal: NodeJS.Signals | null): void => {
		if (finished) return;
		finished = true;
		writeOverflowDiagnostic();
		process.stdout.write(FLUSH_BARRIER, () => {
			if (signal !== null) {
				reRaise(signal);
				return;
			}
			process.exit(code ?? 0);
		});
	};

	childStdout.on("end", () => stdoutScanner.finalize());
	child.on("error", (err: NodeJS.ErrnoException) => {
		// ENOENT/EACCES are NAMED here rather than swallowed: the runner already
		// asserted the target is a present, executable regular file, so reaching
		// this means the target moved under the pair — a fact the operator needs
		// in plain words. Shell conventions for the two cases keep the exit status
		// readable to whatever spawned us.
		abort(`cannot execute ${targetPath}: ${err.code ?? err.message}`, exitStatusForErrno(err.code));
	});
	for (const signal of FORWARDED_SIGNALS) {
		process.on(signal, () => {
			if (!finished) child.kill(signal);
		});
	}
	// 'close' rather than 'exit': it fires after the child's stdio streams are
	// closed, so every byte the CLI wrote has already been scanned and forwarded.
	child.on("close", (code, signal) => finish(code, signal));
}
