// Offline fixtures for demo/lib/claude-native-work.ts and take-recorder's pure helpers (#138).
// Run: node --test 'demo/**/*.test.ts'
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";
import { reclaimOnExit } from "../../scripts/lib/reclaim-on-exit.ts";
import {
	acpSessionRecordPath,
	claudeNativeView,
	claudeProjectSlug,
	isApprovedCcAlias,
	isNativeModelOfAlias,
	judgeClaudeCodeReceive,
	judgeClaudeNativeWork,
	resolveAcpTranscript,
} from "./claude-native-work.ts";
import { notesExpectation } from "./pi-durable-work.ts";
import { openRouterOverride, piInbound, stripIdentityEnv } from "./take-recorder.ts";

const SID = "6f1c0d6e-0000-4000-8000-000000000001";
const CWD = "/tmp/entwurf-demo-AbC123";
const exp = notesExpectation("DEMO-AB3DEF");

function rows(result: { text: string; isError?: boolean } | null, opts: { sid?: string; cwd?: string } = {}) {
	const base = { sessionId: opts.sid ?? SID, cwd: opts.cwd ?? CWD };
	const out: unknown[] = [
		{ ...base, type: "user", message: { role: "user", content: "DEMO-AB3DEF: please run wc -l notes.txt" } },
		{
			...base,
			type: "assistant",
			message: {
				model: "claude-sonnet-5",
				content: [
					{
						type: "tool_use",
						id: "toolu_1",
						name: "Bash",
						input: { command: "wc -l notes.txt && head -n 1 notes.txt" },
					},
				],
			},
		},
	];
	if (result)
		out.push({
			...base,
			type: "user",
			message: {
				role: "user",
				content: [
					{ type: "tool_result", tool_use_id: "toolu_1", content: result.text, is_error: result.isError === true },
				],
			},
		});
	return out;
}
const oks = (v: { ok: boolean }[]) => v.map((x) => x.ok);

test("GOOD: Claude's own Bash joined to its result, in this session and cwd", () => {
	const view = claudeNativeView(rows({ text: "3 notes.txt\nthe record is the address\n" }));
	assert.deepEqual(view.models, ["claude-sonnet-5"]);
	assert.deepEqual(oks(judgeClaudeNativeWork(view, SID, CWD, exp)), [true, true, true]);
});

test("an errored, missing or wrong Bash result is not the work", () => {
	for (const r of [
		{ text: "wc: notes.txt: No such file or directory", isError: true },
		{ text: "4 notes.txt\nthe record is the address\n" },
		{ text: "3 notes.txt\na launch receipt is not delivery\n" },
		null,
	]) {
		const view = claudeNativeView(rows(r));
		assert.deepEqual(oks(judgeClaudeNativeWork(view, SID, CWD, exp)), [true, true, false], JSON.stringify(r));
	}
});

test("another session or another cwd is not this sibling's transcript", () => {
	const good = { text: "3 notes.txt\nthe record is the address\n" };
	assert.equal(judgeClaudeNativeWork(claudeNativeView(rows(good, { sid: "other" })), SID, CWD, exp)[0]?.ok, false);
	assert.equal(judgeClaudeNativeWork(claudeNativeView(rows(good, { cwd: "/home/x" })), SID, CWD, exp)[0]?.ok, false);
});

test("a missing or mixed cwd, or no observed model, is a missing measurement, not a pass", () => {
	const good = { text: "3 notes.txt\nthe record is the address\n" };
	const noCwd = claudeNativeView(
		rows(good).map((r) => {
			const { cwd: _drop, ...rest } = r as Record<string, unknown>;
			return rest;
		}),
	);
	assert.deepEqual(noCwd.cwds, []);
	assert.equal(judgeClaudeNativeWork(noCwd, SID, CWD, exp)[0]?.ok, false);
	const mixed = claudeNativeView([...rows(good), { sessionId: SID, cwd: "/elsewhere", type: "user" }]);
	assert.equal(judgeClaudeNativeWork(mixed, SID, CWD, exp)[0]?.ok, false);
	const noModel = claudeNativeView(
		rows(good).map((r) => {
			const row = r as { type?: string; message?: Record<string, unknown> };
			if (row.type !== "assistant") return r;
			const { model: _drop, ...message } = row.message ?? {};
			return { ...row, message };
		}),
	);
	assert.deepEqual(noModel.models, []);
	assert.equal(judgeClaudeNativeWork(noModel, SID, CWD, exp)[1]?.ok, false);
});

// A record in session-store's real shape (SessionRecord, session-store.ts:100-110).
function cacheRecord(key: string, over: Record<string, unknown> = {}) {
	return {
		version: 1,
		provider: "entwurf",
		sessionKey: key,
		acpSessionId: SID,
		cwd: CWD,
		modelId: "claude-sonnet-5",
		bridgeConfigSignature: "sig",
		contextMessageSignatures: [],
		updatedAt: "2026-10-11T00:00:00.000Z",
		...over,
	};
}
function cacheDirs() {
	// Registered for exit, so a red assertion or signal cannot leave the synthetic root behind.
	const root = reclaimOnExit(fs.mkdtempSync(path.join(os.tmpdir(), "acp-cache-test-")));
	const cache = path.join(root, "cache");
	fs.mkdirSync(cache);
	return { root, cache, overlay: path.join(root, "overlay") };
}
const KEYS = ["pi:native-uuid", "pi:20261011T182501-439756"];
const EXPECT = { cwd: CWD, modelId: "claude-sonnet-5" };

test("the sibling's own cache record resolves to a transcript inside its project dir", () => {
	const d = cacheDirs();
	const key = KEYS[1] as string;
	assert.equal(
		path.basename(acpSessionRecordPath(key, d.cache)),
		`${createHash("sha256").update(key).digest("hex")}.json`,
	);
	fs.writeFileSync(acpSessionRecordPath(key, d.cache), JSON.stringify(cacheRecord(key)));
	const r = resolveAcpTranscript(KEYS, EXPECT, d);
	assert.equal(r.ok, true);
	assert.equal(r.ok && r.jsonl, path.join(d.overlay, "projects", claudeProjectSlug(CWD), `${SID}.jsonl`));
	assert.equal(claudeProjectSlug("/tmp/entwurf-demo-AbC123"), "-tmp-entwurf-demo-AbC123");
});

test("a malformed, foreign, traversal or ambiguous record stops before any path is built — and is never deleted", () => {
	const key = KEYS[1] as string;
	const cases: Array<[string, unknown]> = [
		["corrupt", "{ corrupt"],
		["traversal id", cacheRecord(key, { acpSessionId: "../../not-this-scene" })],
		["non-v4 id", cacheRecord(key, { acpSessionId: "6f1c0d6e-0000-1000-8000-000000000001" })],
		["other key", cacheRecord("pi:someone-else")],
		["other cwd", cacheRecord(key, { cwd: "/home/x" })],
		["other model", cacheRecord(key, { modelId: "claude-opus-5" })],
		["id only", { acpSessionId: SID }],
	];
	for (const [what, body] of cases) {
		const d = cacheDirs();
		const file = acpSessionRecordPath(key, d.cache);
		const text = typeof body === "string" ? body : JSON.stringify(body);
		fs.writeFileSync(file, text);
		const r = resolveAcpTranscript(KEYS, EXPECT, d);
		assert.equal(r.ok, false, what);
		assert.equal(fs.readFileSync(file, "utf8"), text, `${what}: the record is untouched`);
	}
	// two valid candidates are ambiguous, not "the first one"
	const d = cacheDirs();
	for (const k of KEYS) fs.writeFileSync(acpSessionRecordPath(k, d.cache), JSON.stringify(cacheRecord(k)));
	const r = resolveAcpTranscript(KEYS, EXPECT, d);
	assert.equal(r.ok, false);
	assert.match(r.ok ? "" : r.reason, /2 candidate records/);
});

test("take-recorder strips this shell's identity carriers and parses inbound envelopes", () => {
	const env = stripIdentityEnv({
		HOME: "/home/x",
		TMUX: "s",
		TMUX_PANE: "%1",
		PI_SESSION_ID: "g",
		ENTWURF_CALLBACK_TARGET: "t",
		ENTWURF_CALLBACK_NONCE: "n",
		ENTWURF_META_SENDER_MARKER: "m",
		CLAUDECODE: "1",
		CLAUDE_CODE_SESSION_ID: "c",
		CLAUDE_CODE_MESSAGING_TOKEN: "session-scoped",
		CLAUDE_CODE_OAUTH_TOKEN: "dummy-oauth",
	});
	assert.deepEqual(Object.keys(env).sort(), ["CLAUDE_CODE_OAUTH_TOKEN", "HOME"]);
	assert.equal(env.CLAUDE_CODE_OAUTH_TOKEN, "dummy-oauth");
	assert.equal(openRouterOverride({ OPENAI_BASE_URL: "https://openrouter.ai/api/v1" }), "OPENAI_BASE_URL");
	assert.equal(openRouterOverride({ OPENAI_BASE_URL: "https://chatgpt.com/backend-api" }), null);
	const entries = [
		{
			type: "custom_message",
			customType: "entwurf-message",
			content: 'hi\n\n<sender_info>{"sessionId":"G1"}</sender_info>',
		},
		{ type: "custom_message", customType: "entwurf-message", content: "no envelope" },
	];
	assert.deepEqual(piInbound(entries), [{ index: 0, payload: "hi", sender: "G1" }]);
});

// ── native Claude Code receive/reply and model family (take-pi-cc) ──────────
const OWN = "20261011T200000-aaaaaa";
const CALLER = "20261011T195959-bbbbbb";
const BOUNDARY = /^entwurf_v2 control-socket → (sent|queued-steer|queued-follow-up|accepted-unknown-boundary)/;
function ccRows(over: { readGid?: string; v2Target?: string; v2Text?: string; v2Error?: boolean } = {}) {
	const use = (id: string, name: string, input: Record<string, unknown>) => ({
		type: "assistant",
		sessionId: SID,
		cwd: CWD,
		message: { model: "claude-sonnet-5", content: [{ type: "tool_use", id, name, input }] },
	});
	const res = (id: string, text: string, isError = false) => ({
		type: "user",
		sessionId: SID,
		cwd: CWD,
		message: { content: [{ type: "tool_result", tool_use_id: id, content: text, is_error: isError }] },
	});
	return [
		use("t1", "mcp__entwurf-bridge__entwurf_inbox_read", { gardenId: over.readGid ?? OWN }),
		res("t1", "[entwurf inbox read ⟵] messages: 1"),
		use("t2", "mcp__entwurf-bridge__entwurf_v2", { target: over.v2Target ?? CALLER, message: "DEMO-AB3DEF: 3 lines" }),
		res("t2", over.v2Text ?? "entwurf_v2 control-socket → sent", over.v2Error === true),
	];
}

test("GOOD: Claude Code drained its own inbox and its reply settled on the caller's control socket", () => {
	assert.deepEqual(oks(judgeClaudeCodeReceive(ccRows(), OWN, CALLER, BOUNDARY)), [true, true]);
});

test("another inbox, another target, an error or a non-control-socket answer is not the receive/reply", () => {
	assert.equal(judgeClaudeCodeReceive(ccRows({ readGid: CALLER }), OWN, CALLER, BOUNDARY)[0]?.ok, false);
	assert.equal(judgeClaudeCodeReceive(ccRows({ v2Target: "someone" }), OWN, CALLER, BOUNDARY)[1]?.ok, false);
	assert.equal(judgeClaudeCodeReceive(ccRows({ v2Error: true }), OWN, CALLER, BOUNDARY)[1]?.ok, false);
	assert.equal(
		judgeClaudeCodeReceive(ccRows({ v2Text: "entwurf_v2 meta-mailbox → enqueued (x.msg)" }), OWN, CALLER, BOUNDARY)[1]
			?.ok,
		false,
	);
});

test("the CC selector is an approved alias; an observed native id is judged only for that alias's family", () => {
	assert.equal(isApprovedCcAlias("sonnet"), true);
	for (const a of ["opus", "fable", "claude-sonnet-5", "toString", "__proto__", ""])
		assert.equal(isApprovedCcAlias(a), false, a);
	for (const m of ["claude-sonnet-5", "claude-sonnet-5-20261001", "claude-sonnet-4-5"])
		assert.equal(isNativeModelOfAlias("sonnet", m), true, m);
	for (const m of [
		"claude-opus-5",
		"claude-fable-5-1",
		"claude-sonnet",
		"claude-sonnet-5-extended",
		"x-claude-sonnet-5",
		"sonnet",
	])
		assert.equal(isNativeModelOfAlias("sonnet", m), false, m);
});
