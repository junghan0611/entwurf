import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { buildSessionRecord, readSessionRecord, sessionRecordPath, writeSessionRecord } from "./session-store.ts";

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
