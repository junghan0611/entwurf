import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
	type BootstrapParams,
	buildSessionRecord,
	decideBootstrap,
	parseSessionRecord,
	readSessionRecord,
	recordIsBehind,
	type SealedSessionRecord,
	sessionRecordPath,
	standingRecordVerdict,
	writeSessionRecord,
} from "./session-store.ts";

const record = buildSessionRecord(
	{
		sessionKey: "test",
		acpSessionId: "acp",
		cwd: "/fixture",
		modelId: "model",
		bridgeConfigSignature: "sig",
		contextMessageSignatures: [],
	},
	"2026-11-20T00:00:00Z",
);

it("[QK:ACP-ORACLE-L15-INVALID] invalid JSON and invalid schema are named and preserved", () => {
	const dir = mkdtempSync(join(tmpdir(), "acp-l15-"));
	try {
		const file = sessionRecordPath("test", dir);
		for (const text of ["{bad", JSON.stringify({ ...record, provider: "wrong" })]) {
			writeFileSync(file, text);
			expect(readSessionRecord("test", dir)).toEqual({ status: "invalid" });
			expect(readFileSync(file, "utf8")).toBe(text);
		}
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

it("[QK:ACP-ORACLE-L15-UNREADABLE] missing and unreadable records are distinguished without mutation", () => {
	const dir = mkdtempSync(join(tmpdir(), "acp-l15-"));
	try {
		expect(readSessionRecord("test", dir)).toEqual({ status: "missing" });
		const path = sessionRecordPath("test", dir);
		mkdirSync(path);
		writeFileSync(join(path, "keep"), "evidence");
		expect(readSessionRecord("test", dir)).toMatchObject({ status: "unreadable", code: "EISDIR" });
		expect(readFileSync(join(path, "keep"), "utf8")).toBe("evidence");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

it("[QK:ACP-ORACLE-L15-ATOMIC] replace occurs via same-directory rename, never overwriting a symlink target", () => {
	const dir = mkdtempSync(join(tmpdir(), "acp-l15-"));
	try {
		const path = sessionRecordPath("test", dir);
		const original = join(dir, "original");
		writeFileSync(original, "untouched");
		symlinkSync(original, path);
		writeSessionRecord(record, dir);
		expect(readFileSync(original, "utf8")).toBe("untouched");
		expect(readSessionRecord("test", dir)).toEqual({ status: "found", record });
		rmSync(path);
		mkdirSync(path);
		writeFileSync(join(path, "keep"), "unchanged");
		expect(() => writeSessionRecord(record, dir)).toThrow();
		expect(readFileSync(join(path, "keep"), "utf8")).toBe("unchanged");
		expect(readdirSync(dir).filter((name) => name.endsWith(".tmp"))).toEqual([]);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

it("[QK:ACP-ORACLE-L15-AGENT-DIR] default record path follows Pi's configured agent directory", () => {
	const dir = mkdtempSync(join(tmpdir(), "acp-l15-"));
	const previous = process.env.PI_CODING_AGENT_DIR;
	try {
		process.env.PI_CODING_AGENT_DIR = join(dir, "profile");
		expect(sessionRecordPath("test")).toBe(
			sessionRecordPath("test", join(dir, "profile", "cache", "entwurf", "sessions")),
		);
	} finally {
		if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
		else process.env.PI_CODING_AGENT_DIR = previous;
		rmSync(dir, { recursive: true, force: true });
	}
});

// --- #171 L16: the dispatch marker in the record -------------------------------------------------

it("[QK:ACP-L16-OUTDATED] a record written before the marker existed reads as outdated, stays, and is never attached", () => {
	const dir = mkdtempSync(join(tmpdir(), "acp-l16-"));
	try {
		const { pendingDispatch: _absent, ...withoutField } = record;
		const path = sessionRecordPath("test", dir);
		const v1 = JSON.stringify({ ...withoutField, version: 1 });
		writeFileSync(path, v1);
		expect(readSessionRecord("test", dir)).toEqual({ status: "outdated" });
		expect(readFileSync(path, "utf8")).toBe(v1);
		// Not evidence that nothing is pending, and not a record: it carries no marker to stop on and no session to attach.
		expect(standingRecordVerdict({ status: "outdated" })).toEqual({ kind: "continue" });
		// A current-version record that omits the field is not read as sealed either.
		writeFileSync(path, JSON.stringify(withoutField));
		expect(readSessionRecord("test", dir)).toEqual({ status: "invalid" });
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

it("a marker round-trips only when its range ends at its own signature count", () => {
	const marked = buildSessionRecord(
		{ ...record, pendingDispatch: { start: 1, count: 2, contextMessageSignatures: ["s0", "s1", "s2"] } },
		record.updatedAt,
	);
	expect(parseSessionRecord(JSON.parse(JSON.stringify(marked)), "test")).toEqual(marked);
	expect(standingRecordVerdict({ status: "found", record: marked })).toEqual({
		kind: "stop",
		acpSessionId: "acp",
		marker: { start: 1, count: 2, contextMessageSignatures: ["s0", "s1", "s2"] },
	});
	for (const pendingDispatch of [
		{ start: 1, count: 1, contextMessageSignatures: ["s0", "s1", "s2"] },
		{ start: -1, count: 4, contextMessageSignatures: ["s0", "s1", "s2"] },
		{ start: 0.5, count: 2.5, contextMessageSignatures: ["s0", "s1", "s2"] },
		{ start: 0, count: 1, contextMessageSignatures: [1] },
		"pending",
	]) {
		expect(parseSessionRecord({ ...marked, pendingDispatch }, "test")).toBeUndefined();
	}
	expect(standingRecordVerdict({ status: "found", record })).toEqual({ kind: "continue" });
	expect(standingRecordVerdict({ status: "unreadable", code: "EACCES" })).toEqual({ kind: "refuse", code: "EACCES" });
});

describe("a sealed record against the transcript after it (#171 L16 rule 6, R12)", () => {
	const roles = (tail: string) => ["system", "user", ...tail.split(" ").map((r) => (r === "A" ? "assistant" : "user"))];
	const sigs = (n: number) => Array.from({ length: n }, (_, i) => `sig-${i}`);
	const sealed: SealedSessionRecord = { ...record, contextMessageSignatures: sigs(2), pendingDispatch: null };
	const params = (tail: string): BootstrapParams => {
		const messageRoles = roles(tail);
		return {
			cwd: record.cwd,
			modelId: record.modelId,
			bridgeConfigSignature: record.bridgeConfigSignature,
			contextMessageSignatures: sigs(messageRoles.length),
			lifecyclePolicy: "process-scoped",
			messageRoles,
		};
	};

	it("[QK:ACP-L16-RECORD-BEHIND] is behind when a user message is followed by an assistant, and current otherwise", () => {
		// The tail as R12 measured it after a record of 2 signatures: A is the sealed turn's own answer.
		const cells: Array<[string, string]> = [
			["A U", "resume"], // one turn, one input; also an answered cancel, A(aborted)
			["A U U", "resume"], // steering or follow-ups queued together
			["U", "resume"], // after max_tokens Pi omits the cut answer
			["A A U", "resume"], // a custom steer answered twice
			["A U A U", "new"], // a turn ran that the record never sealed
			["A U A U A U", "new"], // R11: a record of one turn against four
		];
		for (const [tail, path] of cells) {
			const messageRoles = roles(tail);
			expect(recordIsBehind(2, messageRoles), tail).toBe(path === "new");
			const decision = decideBootstrap(params(tail), {
				persisted: sealed,
				capabilities: { resumeSession: true, loadSession: false },
			});
			expect(decision.path, tail).toBe(path);
			if (path === "new") expect(decision).toMatchObject({ invalidatePersisted: true, reason: "persisted_behind" });
		}
	});
});
