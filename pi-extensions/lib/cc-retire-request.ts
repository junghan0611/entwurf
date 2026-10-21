/**
 * cc-retire-request — the Node side of retiring ONE Claude Code citizen through the packaged pidfd
 * helper (#147 G3, core-side leaf).
 *
 * NOT an authorization boundary. The caller (a future core verb) owns every decision about WHETHER
 * this citizen may be retired: who asked, self-retire refusal, and the per-target lock. This leaf
 * takes no lock of its own, so a caller holding the target lock cannot deadlock against it. It
 * opens no public tool, reads no role or permission, and never reads a transcript, message body or
 * credential.
 *
 * What it adds over the helper is the binding check while the helper HOLDS the pidfd. The helper
 * pins a PROCESS; a Claude Code process can switch its native session in place (`/resume`,
 * `/clear`), after which the same pid is a different citizen. So the record, the receiver marker
 * and the sender marker the hook moves on every event are read once before the helper starts and
 * once more after it reports `ready` — the fd is held by then, so the pid the second read names
 * cannot have been reused. Only when that second read still names the same garden, native
 * session, binding and owner is `go` written; any other answer writes `cancel`. A switch that
 * commits AFTER the second read is not covered: nothing here claims to close that window.
 *
 * Signals: Node sends none to the target. The only signal Node sends is to its OWN helper child,
 * by ChildProcess handle, after the helper has gone silent past a fixed bound — and that child is
 * not yet reaped when it is sent, so its pid cannot have been reused.
 */

import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import type { ReceiverInspection } from "./entwurf-v2-visible-resume.ts";
import { inspectReceiverMarker } from "./entwurf-v2-visible-resume.ts";
import {
	type MetaIdentity,
	type MetaReceiverArmProvenance,
	type MetaSenderMarker,
	readAddressableMetaIdentity,
	readMetaSenderMarker,
} from "./meta-session.ts";

export const CC_RETIRE_HELPER_FILE = "cc-retire-pidfd.py";

/** The owner kind the Claude Code hook's receiver marker carries: `writeMetaReceiverMarker`'s
 * default (meta-session.ts), which the hook does not override. A marker naming any other owner is
 * another harness's process, never a Claude Code foreground owner. */
export const CC_RECEIVER_OWNER_KIND = "claude-code-cli";

/** The arm provenances the Claude Code hook writes. `extension-join` is Copilot's, not Claude's. */
export const CC_RECEIVER_ARM_PROVENANCES: readonly MetaReceiverArmProvenance[] = [
	"session-start",
	"cwd-changed",
	"file-changed",
];

/** Wall-clock bound on the whole helper exchange. The helper bounds itself (10 s for the control
 * frame, 5 s for the exit); this only catches a helper that stops talking. */
export const CC_RETIRE_HELPER_WALL_MS = 30_000;

/** At most this many stdout bytes are accepted from the helper; more is a protocol failure. */
const STDOUT_MAX = 4096;
const STDERR_MAX = 4096;

/**
 * The packaged helper: the fixed basename BESIDE this module, nowhere else. The canonical file is
 * `pi-extensions/lib/cc-retire-pidfd.py`, which is beside the source; `build-bridge.sh` byte-copies
 * it beside the emitted adapter in `mcp/entwurf-bridge/dist/pi-extensions/lib/`, so the same rule
 * holds at both depths (check-capability-bundle-reach asks the compiled copy from where it lives).
 * `null` when that entry is not a regular file — a packaging defect, refused by name; no parent
 * directory, environment path or download is ever consulted.
 */
export function ccRetireHelperPath(from: string = import.meta.dirname): string | null {
	const candidate = path.join(from, CC_RETIRE_HELPER_FILE);
	try {
		return fs.lstatSync(candidate).isFile() ? candidate : null;
	} catch {
		return null;
	}
}

/** The exact argv the helper is started with: isolated interpreter, the fixed file, two facts. */
export function ccRetireHelperArgv(helperPath: string, pid: number, startKey: string): string[] {
	return ["-I", "-S", helperPath, String(pid), startKey];
}

/** The record facts the caller authorised. A change in any of them between that decision and the
 * retirement is a different citizen state, so it refuses. */
export type CcRetireExpected = Pick<
	MetaIdentity,
	"gardenId" | "backend" | "nativeSessionId" | "createdAt" | "attachIncarnation"
>;

export interface CcRetireDeps {
	readRecord(gardenId: string): MetaIdentity;
	inspectReceiver(gardenId: string): ReceiverInspection;
	readSender(ownerPid: number): MetaSenderMarker | null;
	helperPath(): string | null;
	/** Start the helper with exactly `argv` (interpreter args included). */
	spawnHelper(argv: readonly string[]): ChildProcessWithoutNullStreams;
}

export function makeCcRetireDeps(overrides: Partial<CcRetireDeps> = {}): CcRetireDeps {
	return {
		readRecord: (gid) => readAddressableMetaIdentity(gid),
		inspectReceiver: (gid) => inspectReceiverMarker(gid),
		readSender: (ownerPid) => readMetaSenderMarker({ backend: "claude-code", ownerPid }),
		helperPath: () => ccRetireHelperPath(),
		spawnHelper: (argv) =>
			spawn("python3", [...argv], { stdio: ["pipe", "pipe", "pipe"], env: { PATH: process.env.PATH ?? "" } }),
		...overrides,
	};
}

/** Why the binding check refused. Each names the ONE fact that did not hold. */
export type CcRetireBindingRefusal =
	| "record-unreadable"
	| "target-not-claude-code"
	| "record-drifted"
	| "target-unbound"
	| "receiver-unreadable"
	| "receiver-absent"
	| "receiver-corrupt"
	| "receiver-drifted"
	| "receiver-unbound"
	| "receiver-foreign-owner"
	| "receiver-foreign-provenance"
	| "receiver-dead"
	| "receiver-uncertain"
	| "start-key-unsupported"
	| "sender-unreadable"
	| "sender-absent"
	| "sender-foreign-backend"
	| "sender-drifted";

export type CcRetireResult =
	/** SIGTERM was requested through the pidfd and THAT process's exit was observed. */
	| { outcome: "exited"; gardenId: string; pid: number }
	/** Nothing was signalled: refused before the helper held the fd, or the helper refused. */
	| { outcome: "refused"; reason: string; detail: string }
	/** The helper held the fd and sent nothing (cancel, drift after ready, already exited, …). */
	| { outcome: "not-signalled"; reason: string; detail: string }
	/** `go` was written: the signal may have been sent and its effect was not observed. Not retried. */
	| { outcome: "unknown"; reason: string; detail: string };

interface Owner {
	pid: number;
	startKey: string;
}

type BindingCheck = { ok: true; owner: Owner } | { ok: false; reason: CcRetireBindingRefusal; detail: string };

const LINUX_KEY = /^linux:[0-9]{1,20}$/;

function causeOf(err: unknown): string {
	return err instanceof Error ? err.message : String(err);
}

/**
 * One read of the three witnesses, compared against what the caller authorised and against each
 * other. `pinned` (the second read) also requires the SAME owner as the first, because the helper
 * is holding that process.
 */
export function checkCcRetireBinding(expected: CcRetireExpected, deps: CcRetireDeps, pinned?: Owner): BindingCheck {
	const gid = expected.gardenId;
	let record: MetaIdentity;
	try {
		record = deps.readRecord(gid);
	} catch (err) {
		return { ok: false, reason: "record-unreadable", detail: causeOf(err) };
	}
	if (record.backend !== "claude-code") {
		return { ok: false, reason: "target-not-claude-code", detail: `record backend is ${record.backend}` };
	}
	if (record.attachIncarnation === null) {
		return { ok: false, reason: "target-unbound", detail: "record carries no attachIncarnation" };
	}
	for (const key of ["gardenId", "backend", "nativeSessionId", "createdAt", "attachIncarnation"] as const) {
		if (record[key] !== expected[key]) {
			return { ok: false, reason: "record-drifted", detail: `record ${key} is not the one the caller authorised` };
		}
	}

	let inspection: ReceiverInspection;
	try {
		inspection = deps.inspectReceiver(gid);
	} catch (err) {
		return { ok: false, reason: "receiver-unreadable", detail: causeOf(err) };
	}
	if (inspection.kind === "absent") return { ok: false, reason: "receiver-absent", detail: "no receiver marker" };
	if (inspection.kind === "corrupt")
		return { ok: false, reason: "receiver-corrupt", detail: "receiver marker unreadable" };
	const marker = inspection.marker;
	if (
		marker.gardenId !== gid ||
		marker.backend !== "claude-code" ||
		marker.nativeSessionId !== record.nativeSessionId
	) {
		return {
			ok: false,
			reason: "receiver-drifted",
			detail: "receiver marker names another garden, backend or session",
		};
	}
	if (marker.ownerKind !== CC_RECEIVER_OWNER_KIND) {
		return { ok: false, reason: "receiver-foreign-owner", detail: `receiver owner kind is ${marker.ownerKind}` };
	}
	if (!(CC_RECEIVER_ARM_PROVENANCES as readonly string[]).includes(marker.armProvenance)) {
		return {
			ok: false,
			reason: "receiver-foreign-provenance",
			detail: `receiver arm provenance is ${marker.armProvenance}`,
		};
	}
	if (marker.attachIncarnation === null) {
		return { ok: false, reason: "receiver-unbound", detail: "receiver marker carries no attachIncarnation" };
	}
	if (marker.attachIncarnation !== record.attachIncarnation) {
		return { ok: false, reason: "receiver-drifted", detail: "receiver binding differs from the record's" };
	}
	if (inspection.owner === "dead")
		return { ok: false, reason: "receiver-dead", detail: `owner ${marker.ownerPid} is gone` };
	if (inspection.owner !== "live") {
		return { ok: false, reason: "receiver-uncertain", detail: `owner ${marker.ownerPid} cannot be proven live` };
	}
	if (!LINUX_KEY.test(marker.ownerStartKey)) {
		return { ok: false, reason: "start-key-unsupported", detail: "owner start key is not a linux:<starttime> key" };
	}
	if (pinned && (marker.ownerPid !== pinned.pid || marker.ownerStartKey !== pinned.startKey)) {
		return { ok: false, reason: "receiver-drifted", detail: "receiver owner is not the process the helper holds" };
	}

	let sender: MetaSenderMarker | null;
	try {
		sender = deps.readSender(marker.ownerPid);
	} catch (err) {
		return { ok: false, reason: "sender-unreadable", detail: causeOf(err) };
	}
	if (sender === null) {
		return { ok: false, reason: "sender-absent", detail: `no trusted sender marker for owner ${marker.ownerPid}` };
	}
	// The reader is keyed by backend directory but does not compare the body's backend with it.
	if (sender.backend !== "claude-code") {
		return { ok: false, reason: "sender-foreign-backend", detail: `sender marker backend is ${sender.backend}` };
	}
	if (
		sender.gardenId !== gid ||
		sender.nativeSessionId !== record.nativeSessionId ||
		sender.ownerPid !== marker.ownerPid ||
		sender.ownerStartKey !== marker.ownerStartKey
	) {
		return { ok: false, reason: "sender-drifted", detail: "the owner's sender marker now names another citizen" };
	}
	return { ok: true, owner: { pid: marker.ownerPid, startKey: marker.ownerStartKey } };
}

// --- helper protocol ---------------------------------------------------------------------------

type Line = Record<string, unknown>;

function exactKeys(line: Line, keys: readonly string[]): boolean {
	const own = Object.keys(line).sort();
	const want = [...keys].sort();
	return own.length === want.length && own.every((k, i) => k === want[i]);
}

/** Outcomes the helper may print and the exit code each must come with. */
const PRE_READY_OUTCOMES: Record<string, number> = { refused: 2, "already-exited": 3 };
const CANCEL_OUTCOMES: Record<string, number> = { cancelled: 3 };
const AFTER_GO_NO_SIGNAL: Record<string, number> = {
	"already-exited": 3,
	"observe-failed-before-signal": 3,
	refused: 2,
};
const AFTER_SIGNAL: Record<string, number> = { exited: 0, "exit-unobserved": 4, "observe-failed": 4 };

/**
 * The helper's terminal line, closed per outcome (its `finish(...)` calls in cc-retire-pidfd.py):
 * `refused` carries a `reason` and may carry an `errno` (name or number); `exit-unobserved` carries
 * `waitedS`; every other outcome carries nothing else. A missing, extra or mistyped key is not that
 * outcome. The refusal `reason` text is diagnostic and stays open — reported, never branched on.
 */
function terminalShapeOk(line: Line): boolean {
	switch (line.outcome) {
		case "refused": {
			const hasErrno = "errno" in line;
			if (hasErrno && typeof line.errno !== "string" && typeof line.errno !== "number") return false;
			return (
				exactKeys(line, hasErrno ? ["outcome", "reason", "errno"] : ["outcome", "reason"]) &&
				typeof line.reason === "string" &&
				line.reason.length > 0
			);
		}
		case "exit-unobserved":
			return exactKeys(line, ["outcome", "waitedS"]) && typeof line.waitedS === "number";
		default:
			return exactKeys(line, ["outcome"]);
	}
}

function outcomeLine(line: Line | undefined, allowed: Record<string, number>, code: number | null): string | null {
	if (!line || typeof line.outcome !== "string") return null;
	const want = allowed[line.outcome];
	if (want === undefined || want !== code) return null;
	if (!terminalShapeOk(line)) return null;
	return line.outcome;
}

export interface CcRetireOptions {
	signal?: AbortSignal;
	wallMs?: number;
}

/**
 * Retire `expected.gardenId` if, and only if, every witness still names the citizen the caller
 * authorised both before the helper starts and after it holds the pidfd.
 */
export async function requestCcRetire(
	expected: CcRetireExpected,
	deps: CcRetireDeps = makeCcRetireDeps(),
	opts: CcRetireOptions = {},
): Promise<CcRetireResult> {
	if (opts.signal?.aborted) return { outcome: "refused", reason: "aborted", detail: "aborted before any check" };
	const first = checkCcRetireBinding(expected, deps);
	if (!first.ok) return { outcome: "refused", reason: first.reason, detail: first.detail };
	const helperPath = deps.helperPath();
	if (helperPath === null) {
		return { outcome: "refused", reason: "helper-missing", detail: `packaged ${CC_RETIRE_HELPER_FILE} not found` };
	}
	if (opts.signal?.aborted)
		return { outcome: "refused", reason: "aborted", detail: "aborted before the helper started" };
	const owner = first.owner;
	const argv = ccRetireHelperArgv(helperPath, owner.pid, owner.startKey);

	return await new Promise<CcRetireResult>((resolve) => {
		let child: ChildProcessWithoutNullStreams;
		try {
			child = deps.spawnHelper(argv);
		} catch (err) {
			resolve({ outcome: "refused", reason: "helper-spawn-failed", detail: causeOf(err) });
			return;
		}
		const lines: Line[] = [];
		let buf = "";
		let stdoutBytes = 0;
		let stderr = "";
		let protocolError: string | null = null;
		/** What Node has written: nothing yet, cancel, or go. Decides how every ending is read. */
		let sent: "none" | "cancel" | "go" = "none";
		let cancelReason: { reason: string; detail: string } | null = null;
		let settled = false;
		let spawnError: string | null = null;
		let wallExpired = false;
		let abortedAfterGo = false;

		const finish = (result: CcRetireResult): void => {
			if (settled) return;
			settled = true;
			clearTimeout(wall);
			opts.signal?.removeEventListener("abort", onAbort);
			resolve(result);
		};
		const killOwnHelper = (): void => {
			if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
		};
		/** Terminal latch: once a protocol failure, the wall bound, an abort after go or the ending
		 * has been recorded, no frame — above all no `go` — is ever written. Killing the helper is
		 * cleanup; THIS is the guard. */
		const terminal = (): boolean => settled || protocolError !== null || wallExpired || abortedAfterGo;
		const write = (frame: "go" | "cancel"): void => {
			if (terminal() || sent !== "none") return;
			// Recorded BEFORE the write: a `go` whose write threw may still have reached the pipe.
			sent = frame;
			try {
				child.stdin.end(`${frame}\n`);
			} catch (err) {
				protocolError ??= `writing the ${frame} frame threw: ${causeOf(err)}`;
				killOwnHelper();
			}
		};
		const cancel = (reason: string, detail: string): void => {
			if (terminal() || sent !== "none") return;
			cancelReason = { reason, detail };
			write("cancel");
		};
		const onAbort = (): void => {
			if (sent === "none" && lines.length > 0)
				cancel("aborted-before-go", "the requester aborted while the fd was held");
			else if (sent === "none") {
				cancelReason = { reason: "aborted-before-go", detail: "the requester aborted before the helper was ready" };
				sent = "cancel";
				try {
					child.stdin.end();
				} catch (err) {
					protocolError ??= `closing the control pipe threw: ${causeOf(err)}`;
					killOwnHelper();
				}
			} else if (sent === "go") {
				abortedAfterGo = true;
				killOwnHelper();
			}
		};
		const wall = setTimeout(() => {
			wallExpired = true;
			killOwnHelper();
		}, opts.wallMs ?? CC_RETIRE_HELPER_WALL_MS);
		opts.signal?.addEventListener("abort", onAbort, { once: true });

		child.stdin.on("error", () => {
			// EPIPE: the helper ended first. Its exit and its lines are the evidence, not this.
		});
		child.on("error", (err) => {
			spawnError = causeOf(err);
			// No pid: the interpreter never started, so nothing can be held or signalled. Do not wait
			// for a `close` that a failed spawn is not obliged to deliver.
			if (child.pid === undefined) finish({ outcome: "refused", reason: "helper-spawn-failed", detail: spawnError });
		});
		child.stderr.on("data", (chunk: Buffer) => {
			if (stderr.length < STDERR_MAX) stderr += chunk.toString("utf8").slice(0, STDERR_MAX - stderr.length);
		});
		child.stdout.on("data", (chunk: Buffer) => {
			// After a protocol failure nothing further is read: a buffered `ready` behind a bad line
			// must not be acted on.
			if (protocolError !== null || settled) return;
			stdoutBytes += chunk.length;
			if (stdoutBytes > STDOUT_MAX) {
				protocolError ??= "helper printed more than the bounded output";
				killOwnHelper();
				return;
			}
			buf += chunk.toString("utf8");
			let nl = buf.indexOf("\n");
			while (nl >= 0) {
				const text = buf.slice(0, nl);
				buf = buf.slice(nl + 1);
				let line: Line;
				try {
					const parsed: unknown = JSON.parse(text);
					if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw new Error("not an object");
					line = parsed as Line;
				} catch {
					protocolError ??= `helper printed a non-JSON-object line: ${JSON.stringify(text.slice(0, 120))}`;
					killOwnHelper();
					return;
				}
				lines.push(line);
				onLine(line);
				if (protocolError !== null) return;
				nl = buf.indexOf("\n");
			}
		});

		const onLine = (line: Line): void => {
			if (lines.length !== 1 || !("phase" in line)) return;
			if (!exactKeys(line, ["phase", "pid"]) || line.phase !== "ready" || line.pid !== owner.pid) {
				protocolError ??= `first phase line is not ready for pid ${owner.pid}`;
				killOwnHelper();
				return;
			}
			if (sent !== "none") return; // aborted while starting: cancel already written
			if (opts.signal?.aborted) {
				cancel("aborted-before-go", "the requester aborted while the fd was held");
				return;
			}
			const second = checkCcRetireBinding(expected, deps, owner);
			if (!second.ok) {
				cancel(second.reason, second.detail);
				return;
			}
			write("go");
		};

		child.on("close", (code) => {
			// Incomplete trailing output is not a protocol the helper finished: never success.
			if (buf.length > 0)
				protocolError ??= `helper left incomplete trailing output: ${JSON.stringify(buf.slice(0, 120))}`;
			const helperDetail = (msg: string): string => (stderr ? `${msg}; helper stderr: ${stderr.trim()}` : msg);
			if (spawnError !== null && lines.length === 0) {
				finish({ outcome: "refused", reason: "helper-spawn-failed", detail: spawnError });
				return;
			}
			const ready = lines[0]?.phase === "ready";
			if (sent === "go") {
				const rest = lines.slice(1);
				const signalled = rest[0]?.phase === "signal-requested";
				if (protocolError === null && !wallExpired && !abortedAfterGo) {
					if (
						signalled &&
						rest.length === 2 &&
						exactKeys(rest[0] as Line, ["phase", "signal"]) &&
						(rest[0] as Line).signal === "SIGTERM"
					) {
						const out = outcomeLine(rest[1], AFTER_SIGNAL, code);
						if (out === "exited" && exactKeys(rest[1] as Line, ["outcome"])) {
							finish({ outcome: "exited", gardenId: expected.gardenId, pid: owner.pid });
							return;
						}
						if (out !== null && out !== "exited") {
							finish({ outcome: "unknown", reason: out, detail: helperDetail(`SIGTERM requested; ${out}`) });
							return;
						}
					}
					if (!signalled && rest.length === 1) {
						const out = outcomeLine(rest[0], AFTER_GO_NO_SIGNAL, code);
						if (out !== null) {
							const reason = out === "refused" ? `helper-refused:${String((rest[0] as Line).reason)}` : out;
							finish({ outcome: "not-signalled", reason, detail: helperDetail(`after go: ${reason}`) });
							return;
						}
					}
				}
				const why = abortedAfterGo
					? "aborted-after-go"
					: wallExpired
						? "helper-wall-timeout"
						: (protocolError ?? `helper ended with code ${code} after go without a valid outcome`);
				finish({
					outcome: "unknown",
					reason: abortedAfterGo ? "aborted-after-go" : wallExpired ? "helper-wall-timeout" : "helper-protocol",
					detail: helperDetail(`${why}${signalled ? " (signal-requested was reported)" : ""}`),
				});
				return;
			}
			// No go was written, so the helper cannot have signalled: every ending here is non-success.
			if (sent === "cancel" && cancelReason !== null) {
				const r: { reason: string; detail: string } = cancelReason;
				const confirmed = ready && lines.length === 2 && outcomeLine(lines[1], CANCEL_OUTCOMES, code) !== null;
				const eofConfirmed = !ready || (lines.length === 2 && lines[1]?.outcome === "cancelled-eof");
				finish({
					outcome: "not-signalled",
					reason: r.reason,
					detail: helperDetail(confirmed || eofConfirmed ? r.detail : `${r.detail}; helper ending not confirmed`),
				});
				return;
			}
			if (!ready && protocolError === null && lines.length === 1) {
				const out = outcomeLine(lines[0], PRE_READY_OUTCOMES, code);
				if (out === "refused") {
					finish({
						outcome: "refused",
						reason: `helper-refused:${String((lines[0] as Line).reason)}`,
						detail: helperDetail("helper refused before ready"),
					});
					return;
				}
				if (out === "already-exited") {
					finish({ outcome: "not-signalled", reason: "already-exited", detail: helperDetail("target exited") });
					return;
				}
			}
			finish({
				outcome: ready ? "not-signalled" : "refused",
				reason: wallExpired ? "helper-wall-timeout" : "helper-protocol",
				detail: helperDetail(protocolError ?? `helper ended with code ${code} before go`),
			});
		});
	});
}
