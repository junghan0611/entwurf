import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	appendRetirementEvent,
	RETIREMENTS_DIR_NAME,
	RetirementEventError,
	type RetirementOutcomeEvent,
	type RetirementRequestedEvent,
	retirementEventFile,
	retirementsDirBesideSessions,
	serializeRetirementEvent,
} from "./retirement-event.ts";

// The five fd primitives the append uses are spies that pass through to the real `node:fs` by
// default. A test overrides one only to observe exact flags or to inject a primitive failure; no
// production IO seam exists for this.
const io = vi.hoisted(() => ({
	openSync: vi.fn(),
	fstatSync: vi.fn(),
	writeSync: vi.fn(),
	fsyncSync: vi.fn(),
	closeSync: vi.fn(),
}));
vi.mock("node:fs", async (importOriginal) => {
	const actual = await importOriginal<typeof import("node:fs")>();
	const wrapped = { ...actual, ...io };
	return { ...wrapped, default: wrapped };
});
const realFs = await vi.importActual<typeof import("node:fs")>("node:fs");
function passThrough(): void {
	for (const key of Object.keys(io) as (keyof typeof io)[]) {
		io[key].mockReset();
		io[key].mockImplementation(realFs[key] as never);
	}
}
beforeEach(passThrough);
afterEach(passThrough);

const { O_WRONLY, O_APPEND, O_CREAT, O_NOFOLLOW, O_NONBLOCK } = realFs.constants;
const EXPECTED_FLAGS = O_WRONLY | O_APPEND | O_CREAT | O_NOFOLLOW | O_NONBLOCK;

const target = "20261022T060000-abcdef";
const actor = "20261022T050000-123456";
const requested: RetirementRequestedEvent = {
	v: 1,
	kind: "retirement-requested",
	eventId: "0123456789abcdef0123456789abcdef",
	at: "2026-10-21T21:00:00.000Z",
	actorGardenId: actor,
	targetGardenId: target,
	targetBackend: "claude-code",
};
const outcome: RetirementOutcomeEvent = {
	...requested,
	kind: "retirement-outcome",
	at: "2026-10-21T21:00:01.000Z",
	outcome: { status: "exited", reason: null },
};

const owned: string[] = [];
function ownDir(): string {
	const root = fs.mkdtempSync(path.join(tmpdir(), "retirement-event-"));
	owned.push(root);
	return root;
}
afterEach(() => {
	for (const root of owned.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

const FAKE_FD = 4242;
/** Fake fd primitives for one append: a regular single-link file whose write/fsync/close can fail. */
function fakePrimitives(
	patch: { write?: (length: number) => number; fsync?: () => void; close?: () => void } = {},
): string[] {
	passThrough();
	const calls: string[] = [];
	io.openSync.mockImplementation(() => {
		calls.push("open");
		return FAKE_FD;
	});
	io.fstatSync.mockImplementation(() => {
		calls.push("fstat");
		return { isFile: () => true, nlink: 1 };
	});
	io.writeSync.mockImplementation((_fd: number, _buf: Buffer, _offset: number, length: number) => {
		calls.push("write");
		return patch.write ? patch.write(length) : length;
	});
	io.fsyncSync.mockImplementation(() => {
		calls.push("fsync");
		patch.fsync?.();
	});
	io.closeSync.mockImplementation(() => {
		calls.push("close");
		patch.close?.();
	});
	return calls;
}

describe("retirement event append leaf (own temp dirs only)", () => {
	it("[QK:RETIRE-EVENT-CLOSED-KEYS] serializes the closed v1 keyset in canonical order and nothing else", () => {
		expect(serializeRetirementEvent(requested).toString("utf8")).toBe(
			`{"v":1,"kind":"retirement-requested","eventId":"0123456789abcdef0123456789abcdef","at":"2026-10-21T21:00:00.000Z","actorGardenId":"${actor}","targetGardenId":"${target}","targetBackend":"claude-code"}\n`,
		);
		const line = JSON.parse(serializeRetirementEvent(outcome).toString("utf8"));
		expect(Object.keys(line)).toEqual([
			"v",
			"kind",
			"eventId",
			"at",
			"actorGardenId",
			"targetGardenId",
			"targetBackend",
			"outcome",
		]);
		expect(line.outcome).toEqual({ status: "exited", reason: null });
	});

	it("[QK:RETIRE-EVENT-FORBIDDEN] identity, process, liveness, release and free-text fields are refused", () => {
		for (const key of ["pid", "startKey", "nativeSessionId", "cwd", "liveness", "model", "message", "release"]) {
			expect(() => serializeRetirementEvent({ ...requested, [key]: "x" } as never)).toThrow(/keyset is closed/);
			expect(() =>
				serializeRetirementEvent({ ...outcome, outcome: { ...outcome.outcome, [key]: "x" } } as never),
			).toThrow(/keyset is closed/);
		}
		expect(() => serializeRetirementEvent({ ...requested, outcome: outcome.outcome } as never)).toThrow(
			/keyset is closed/,
		);
		const { actorGardenId: _a, ...noActor } = requested;
		expect(() => serializeRetirementEvent(noActor as never)).toThrow(/missing \[actorGardenId\]/);
		const { targetGardenId: _t, ...noTarget } = requested;
		expect(() => serializeRetirementEvent(noTarget as never)).toThrow(/missing \[targetGardenId\]/);
		const bad = (patch: object) => () => serializeRetirementEvent({ ...outcome, ...patch } as never);
		expect(bad({ outcome: { status: "exited", reason: "pidfd send failed: EPERM" } })).toThrow(/short lowercase token/);
		expect(bad({ outcome: { status: "exited", reason: "퇴근" } })).toThrow(/short lowercase token/);
		expect(bad({ outcome: { status: "terminated", reason: null } })).toThrow(/not a claude-code outcome/);
		expect(bad({ targetBackend: "codex" })).toThrow(/unsupported targetBackend/);
		expect(bad({ actorGardenId: "not-a-gid" })).toThrow(/actorGardenId/);
		expect(bad({ eventId: "ABC" })).toThrow(/eventId/);
		expect(bad({ at: "2026-10-21 21:00" })).toThrow(/toISOString/);
		expect(bad({ v: 2 })).toThrow(/version/);
	});

	it("[QK:RETIRE-EVENT-INSTANT] `at` must round-trip through Date#toISOString, not only match its shape", () => {
		for (const at of ["2026-02-30T00:00:00.000Z", "2026-10-21T24:00:00.000Z", "2026-13-01T00:00:00.000Z"]) {
			expect(() => serializeRetirementEvent({ ...requested, at })).toThrow(/valid Date#toISOString/);
		}
		expect(() => serializeRetirementEvent({ ...requested, at: "2028-02-29T23:59:59.999Z" })).not.toThrow();
	});

	it("[QK:RETIRE-EVENT-BACKEND-DOMAIN] a status from the other backend's domain never becomes a line", () => {
		const as = (targetBackend: "pi" | "claude-code", status: string) => () =>
			serializeRetirementEvent({ ...outcome, targetBackend, outcome: { status, reason: null } } as never);
		for (const status of ["shutdown-requested", "refused", "unknown"]) expect(as("pi", status)).not.toThrow();
		for (const status of ["exited", "refused", "not-signalled", "unknown"]) {
			expect(as("claude-code", status)).not.toThrow();
		}
		expect(as("pi", "exited")).toThrow(/not a pi outcome/);
		expect(as("pi", "not-signalled")).toThrow(/not a pi outcome/);
		expect(as("claude-code", "shutdown-requested")).toThrow(/not a claude-code outcome/);
	});

	it("[QK:RETIRE-EVENT-SNAPSHOT] only plain data properties are read, once; the written line is built fresh", () => {
		const withProto = Object.assign(Object.create({ toJSON: () => ({ pid: 1 }) }), requested);
		expect(() => serializeRetirementEvent(withProto)).toThrow(/plain object/);
		expect(() =>
			serializeRetirementEvent({ ...outcome, outcome: Object.assign(Object.create({ x: 1 }), outcome.outcome) }),
		).toThrow(/outcome summary must be a plain object/);
		let reads = 0;
		const accessor = { ...requested } as Record<string, unknown>;
		Object.defineProperty(accessor, "actorGardenId", {
			enumerable: true,
			get: () => (reads++ === 0 ? actor : "20261022T000000-ffffff"),
		});
		expect(() => serializeRetirementEvent(accessor as never)).toThrow(/actorGardenId must be a data property/);
		expect(reads).toBe(0);
		const symbolKeyed = { ...requested, [Symbol("pid")]: 1 };
		expect(() => serializeRetirementEvent(symbolKeyed)).toThrow(/symbol keys/);
		const hidden = { ...requested };
		Object.defineProperty(hidden, "pid", { value: 1, enumerable: false });
		expect(() => serializeRetirementEvent(hidden)).toThrow(/not allowed \[pid\]/);
		const ownToJSON = { ...requested, toJSON: () => ({}) };
		expect(() => serializeRetirementEvent(ownToJSON as never)).toThrow(/not allowed \[toJSON\]/);
		const nullProto = Object.assign(Object.create(null), requested);
		expect(serializeRetirementEvent(nullProto).equals(serializeRetirementEvent(requested))).toBe(true);
	});

	it("[QK:RETIRE-EVENT-APPEND] appends exactly the serialized bytes and preserves the existing prefix", () => {
		const dir = path.join(ownDir(), RETIREMENTS_DIR_NAME);
		const file = retirementEventFile(dir, target);
		fs.mkdirSync(dir, { mode: 0o700 });
		const prefix = Buffer.from('{"prior":"한글 바이트 ☃"}\n', "utf8");
		fs.writeFileSync(file, prefix, { mode: 0o600 });
		const first = appendRetirementEvent(dir, requested);
		const second = appendRetirementEvent(dir, outcome);
		const a = serializeRetirementEvent(requested);
		const b = serializeRetirementEvent(outcome);
		expect(first.bytes).toBe(a.length);
		expect(second.bytes).toBe(b.length);
		const bytes = fs.readFileSync(file);
		expect(bytes.length).toBe(prefix.length + a.length + b.length);
		expect(bytes.subarray(0, prefix.length).equals(prefix)).toBe(true);
		expect(bytes.equals(Buffer.concat([prefix, a, b]))).toBe(true);
	});

	it("[QK:RETIRE-EVENT-CREATE] creates a 0700 directory and a 0600 file named by the target gid", () => {
		const dir = path.join(ownDir(), RETIREMENTS_DIR_NAME);
		appendRetirementEvent(dir, requested);
		expect(fs.statSync(dir).mode & 0o777).toBe(0o700);
		const file = path.join(dir, `${target}.jsonl`);
		expect(fs.statSync(file).mode & 0o777).toBe(0o600);
		expect(fs.readFileSync(file).equals(serializeRetirementEvent(requested))).toBe(true);
		expect(fs.readdirSync(dir)).toEqual([`${target}.jsonl`]);
	});

	it("[QK:RETIRE-EVENT-NOFOLLOW] a final-component symlink fails and its target bytes stay unchanged", () => {
		const root = ownDir();
		const dir = path.join(root, RETIREMENTS_DIR_NAME);
		fs.mkdirSync(dir);
		const victim = path.join(root, "victim.txt");
		fs.writeFileSync(victim, "untouched\n");
		fs.symlinkSync(victim, retirementEventFile(dir, target));
		expect(() => appendRetirementEvent(dir, requested)).toThrow();
		expect(fs.readFileSync(victim, "utf8")).toBe("untouched\n");
	});

	it("[QK:RETIRE-EVENT-NONREGULAR] directory, FIFO and hardlinked entries fail closed without blocking", () => {
		const root = ownDir();
		const dir = path.join(root, RETIREMENTS_DIR_NAME);
		fs.mkdirSync(dir);
		const file = retirementEventFile(dir, target);
		fs.mkdirSync(file);
		expect(() => appendRetirementEvent(dir, requested)).toThrow();
		fs.rmdirSync(file);
		// No silent skip: Linux is the certified axis, so a host without `mkfifo` fails here.
		execFileSync("mkfifo", [file], { stdio: "ignore" });
		// A blocking open of a reader-less FIFO would hang; the guard turns that into a throw, and the
		// flags are asserted OUTSIDE the toThrow so a missing O_NONBLOCK cannot pass as a refusal.
		const observed: number[] = [];
		io.openSync.mockImplementation((p: string, flags: number, mode: number) => {
			observed.push(flags);
			if ((flags & O_NONBLOCK) === 0) throw new Error("test guard: blocking FIFO open attempted");
			return realFs.openSync(p, flags, mode);
		});
		expect(() => appendRetirementEvent(dir, requested)).toThrow();
		expect(observed).toEqual([EXPECTED_FLAGS]);
		passThrough();
		fs.rmSync(file);
		const other = path.join(root, "other.jsonl");
		fs.writeFileSync(other, "outside\n");
		fs.linkSync(other, file);
		expect(() => appendRetirementEvent(dir, requested)).toThrow(/2 links/);
		expect(fs.readFileSync(other, "utf8")).toBe("outside\n");
	});

	it("[QK:RETIRE-EVENT-ONE-SNAPSHOT] the file is routed by the validated snapshot, never by re-reading the event", () => {
		const dir = path.join(ownDir(), RETIREMENTS_DIR_NAME);
		const other = "20261022T070000-fedcba";
		let gets = 0;
		const proxy = new Proxy(
			{ ...requested },
			{
				get(t, key, receiver) {
					gets++;
					return key === "targetGardenId" ? other : Reflect.get(t, key, receiver);
				},
			},
		);
		appendRetirementEvent(dir, proxy);
		expect(gets).toBe(0);
		const written = JSON.parse(fs.readFileSync(retirementEventFile(dir, target), "utf8"));
		expect(written.targetGardenId).toBe(target);
		expect(fs.existsSync(retirementEventFile(dir, other))).toBe(false);
		expect(fs.readdirSync(dir)).toEqual([`${target}.jsonl`]);
	});

	it("[QK:RETIRE-EVENT-PRIMITIVES] exact flags and mode, then fstat → ONE write of the exact bytes → ONE fsync → ONE close", () => {
		const dir = path.join(ownDir(), RETIREMENTS_DIR_NAME);
		const calls = fakePrimitives();
		const result = appendRetirementEvent(dir, outcome);
		const bytes = serializeRetirementEvent(outcome);
		expect(calls).toEqual(["open", "fstat", "write", "fsync", "close"]);
		expect(io.openSync.mock.calls).toEqual([[retirementEventFile(dir, target), EXPECTED_FLAGS, 0o600]]);
		expect(io.fstatSync.mock.calls).toEqual([[FAKE_FD]]);
		expect(io.writeSync).toHaveBeenCalledTimes(1);
		const [fd, buf, offset, length] = io.writeSync.mock.calls[0];
		expect(fd).toBe(FAKE_FD);
		expect(Buffer.isBuffer(buf) && buf.equals(bytes)).toBe(true);
		expect([offset, length]).toEqual([0, bytes.length]);
		expect(io.fsyncSync.mock.calls).toEqual([[FAKE_FD]]);
		expect(io.closeSync.mock.calls).toEqual([[FAKE_FD]]);
		expect(result).toEqual({ bytes: bytes.length });
	});

	it("[QK:RETIRE-EVENT-FAILURE-MATRIX] each primitive failure throws once, closes once and is never retried", () => {
		const dir = path.join(ownDir(), RETIREMENTS_DIR_NAME);
		const run = () => {
			try {
				appendRetirementEvent(dir, requested);
			} catch (error) {
				return error;
			}
			throw new Error("append unexpectedly succeeded");
		};
		const short = fakePrimitives({ write: (length) => length - 1 });
		expect(String(run())).toMatch(/short write/);
		expect(short).toEqual(["open", "fstat", "write", "close"]);

		const writeError = new Error("EIO on write");
		const onWrite = fakePrimitives({
			write: () => {
				throw writeError;
			},
		});
		expect(run()).toBe(writeError);
		expect(onWrite).toEqual(["open", "fstat", "write", "close"]);

		const fsyncError = new Error("EIO on fsync");
		const onFsync = fakePrimitives({
			fsync: () => {
				throw fsyncError;
			},
		});
		expect(run()).toBe(fsyncError);
		expect(onFsync).toEqual(["open", "fstat", "write", "fsync", "close"]);

		// The bytes may already be in the file when close fails; nothing here infers otherwise.
		const closeError = new Error("EIO on close");
		const onClose = fakePrimitives({
			close: () => {
				throw closeError;
			},
		});
		expect(run()).toBe(closeError);
		expect(onClose).toEqual(["open", "fstat", "write", "fsync", "close"]);
	});

	it("[QK:RETIRE-EVENT-FD-KIND] an opened fd that is not a regular file is refused before any write", () => {
		const dir = path.join(ownDir(), RETIREMENTS_DIR_NAME);
		const calls = fakePrimitives();
		io.fstatSync.mockImplementation(() => {
			calls.push("fstat");
			return { isFile: () => false, nlink: 1 };
		});
		let caught: unknown;
		try {
			appendRetirementEvent(dir, requested);
		} catch (error) {
			caught = error;
		}
		expect(caught).toBeInstanceOf(RetirementEventError);
		expect(String(caught)).toMatch(/is not a regular file/);
		expect(calls).toEqual(["open", "fstat", "close"]);
		expect(io.writeSync).not.toHaveBeenCalled();
		expect(io.fsyncSync).not.toHaveBeenCalled();
		expect(io.closeSync.mock.calls).toEqual([[FAKE_FD]]);
	});

	it("[QK:RETIRE-EVENT-DIR] a symlinked or non-directory sidecar directory is refused", () => {
		const root = ownDir();
		const real = path.join(root, "elsewhere");
		fs.mkdirSync(real);
		const dir = path.join(root, RETIREMENTS_DIR_NAME);
		fs.symlinkSync(real, dir);
		expect(() => appendRetirementEvent(dir, requested)).toThrow(/not a real directory/);
		expect(fs.readdirSync(real)).toEqual([]);
		fs.rmSync(dir);
		fs.writeFileSync(dir, "");
		expect(() => appendRetirementEvent(dir, requested)).toThrow(/not a real directory/);
	});

	it("[QK:RETIRE-EVENT-PATH] the directory is a pure sibling of a fixed absolute sessions dir", () => {
		expect(retirementsDirBesideSessions("/x/agent/meta-sessions")).toBe("/x/agent/meta-retirements");
		expect(retirementsDirBesideSessions("/x/agent/meta-sessions/")).toBe("/x/agent/meta-retirements");
		expect(() => retirementsDirBesideSessions("meta-sessions")).toThrow(/absolute/);
		expect(() => retirementEventFile("relative", target)).toThrow(/absolute/);
		expect(() => retirementEventFile("/x", "../escape")).toThrow(/garden id/);
	});

	it("[QK:RETIRE-EVENT-NO-AMBIENT] the leaf reads no environment or home directory and starts no process", () => {
		const source = fs.readFileSync(new URL("./retirement-event.ts", import.meta.url), "utf8");
		expect(source).not.toMatch(/process\.env|homedir|child_process|node:os|spawn|exec/);
	});
});
