// Deterministic gate for the S2d-1b-1 session store / signature / bootstrap
// decision. Pure + temp-dir record I/O — IN pnpm check. No child, no spawn.
//
// Locks the GPT 73b44d 1b-1 invariants:
//   ① model-lock is a fail-loud throw in the pure decision (live mismatch).
//   ② prefix-compat: only a prefix history reuses; mismatch/edited/compaction → new.
//   ③ carrier drift (appendSystemPrompt) → signature change → incompatible.
//   ④ bootstrapPath ⟂ lifecyclePolicy: turn-scoped is ALWAYS new (no in-memory
//      reuse, no persisted resume/load in the first cut).

import { strict as assert } from "node:assert";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Context } from "@earendil-works/pi-ai";

const sha256 = (v: string) => createHash("sha256").update(v).digest("hex");
const isSha256Hex = (v: string) => /^[0-9a-f]{64}$/.test(v);

import {
	type BridgeConfigInput,
	bridgeConfigSignature,
	buildSessionRecord,
	contextMessageSignatures,
	decideBootstrap,
	deleteSessionRecord,
	ENTWURF_CONTROL_FLAG,
	type ExistingSession,
	hasPrefix,
	isCompatible,
	parseSessionRecord,
	readSessionRecord,
	resolveLifecyclePolicy,
	SESSION_RECORD_PROVIDER,
	SESSION_RECORD_VERSION,
	type SessionCompatFacts,
	SessionModelLockedError,
	type SessionRecord,
	sessionRecordPath,
	writeSessionRecord,
} from "../pi-extensions/lib/acp/session-store.ts";

const baseInput = (): BridgeConfigInput => ({
	backend: "claude",
	modelId: "claude-sonnet-4-6",
	nativeModelId: "claude-sonnet-4-6",
	appendSystemPrompt: "",
	mcpServersHash: "deadbeef",
	settingSources: [],
	strictMcpConfig: true,
	tools: ["Read", "Bash", "Edit", "Write"],
	skillPlugins: [],
	permissionAllow: ["Read(*)", "Bash(*)", "Edit(*)", "Write(*)", "mcp__*"],
	disallowedTools: [],
});

// ---------------------------------------------------------------------------
// 1) signature — pure/stable, carrier drift changes it, sha256 digest (no raw)
// ---------------------------------------------------------------------------
{
	const sig0 = bridgeConfigSignature(baseInput());
	assert.ok(isSha256Hex(sig0), "config signature is a sha256 digest (no raw carrier text on disk)");
	assert.ok(!sig0.includes("claude-sonnet-4-6"), "config signature is a digest — never embeds the raw modelId/carrier");
	assert.equal(sig0, bridgeConfigSignature(baseInput()), "signature is deterministic");
	// Array copies do not affect equality (same content).
	assert.equal(bridgeConfigSignature({ ...baseInput(), settingSources: [] }), sig0, "empty settingSources stable");
	// S2g: mcpServers hash drift → different signature (not just a name change).
	assert.notEqual(
		bridgeConfigSignature({ ...baseInput(), mcpServersHash: "cafef00d" }),
		sig0,
		"mcpServers hash drift changes the signature",
	);
	// S2g: tool-surface / skillPlugins drift → different signature.
	assert.notEqual(
		bridgeConfigSignature({ ...baseInput(), skillPlugins: ["/abs/plugin"] }),
		sig0,
		"skillPlugins drift changes the signature",
	);
	// Carrier (appendSystemPrompt) drift → different signature → incompatible (③).
	assert.notEqual(
		bridgeConfigSignature({ ...baseInput(), appendSystemPrompt: "ENGRAVED" }),
		bridgeConfigSignature(baseInput()),
		"carrier drift changes the signature",
	);
	// Model drift → different signature.
	assert.notEqual(
		bridgeConfigSignature({ ...baseInput(), modelId: "claude-opus-4-8" }),
		bridgeConfigSignature(baseInput()),
		"model drift changes the signature",
	);
}

// ---------------------------------------------------------------------------
// 2) contextMessageSignatures — sha256(role:content), no raw text, toolResult
//    folds in toolName/isError (GPT c617cb hardening)
// ---------------------------------------------------------------------------
{
	const assistant = (text: string) =>
		({
			role: "assistant" as const,
			content: [{ type: "text" as const, text }],
			api: "x",
			provider: "x",
			model: "x",
			usage: {
				input: 0,
				output: 0,
				cacheRead: 0,
				cacheWrite: 0,
				totalTokens: 0,
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
			},
			stopReason: "stop" as const,
			timestamp: 0,
		}) satisfies Context["messages"][number];
	const ctx: Context = {
		messages: [
			{ role: "user", content: "hello", timestamp: 0 },
			assistant("hi"),
			{ role: "user", content: [{ type: "image", data: "RAWIMAGEBYTES", mimeType: "image/png" }], timestamp: 0 },
		],
	};
	const sigs = contextMessageSignatures(ctx);
	// every entry is a sha256 digest of the pre-hash role:content form.
	assert.ok(sigs.every(isSha256Hex), "every message signature is a sha256 digest");
	assert.deepEqual(
		sigs,
		[sha256("user:text:hello"), sha256("assistant:text:hi"), sha256("user:image:image/png")],
		"per-message sha256(role:content) signatures",
	);
	// digest never embeds raw image data or raw user text.
	assert.ok(
		!sigs.some((s) => s.includes("RAWIMAGEBYTES") || s.includes("hello")),
		"signatures are digests — no raw image data or prompt text on disk",
	);
	// deterministic across calls.
	assert.deepEqual(contextMessageSignatures(ctx), sigs, "contextMessageSignatures is deterministic");

	// toolResult folds in toolName + isError → same text, different tool/flag = different sig.
	const trContent = [{ type: "text" as const, text: "out" }];
	const trBase: Context = {
		messages: [
			{ role: "toolResult", toolCallId: "t1", toolName: "bash", isError: false, content: trContent, timestamp: 0 },
		],
	};
	const trErr: Context = {
		messages: [
			{ role: "toolResult", toolCallId: "t1", toolName: "bash", isError: true, content: trContent, timestamp: 0 },
		],
	};
	const trOther: Context = {
		messages: [
			{ role: "toolResult", toolCallId: "t1", toolName: "edit", isError: false, content: trContent, timestamp: 0 },
		],
	};
	assert.notEqual(
		contextMessageSignatures(trBase)[0],
		contextMessageSignatures(trErr)[0],
		"toolResult isError flips the signature",
	);
	assert.notEqual(
		contextMessageSignatures(trBase)[0],
		contextMessageSignatures(trOther)[0],
		"toolResult toolName changes the signature",
	);
}

// ---------------------------------------------------------------------------
// 3) hasPrefix / isCompatible
// ---------------------------------------------------------------------------
{
	assert.ok(hasPrefix(["a", "b"], ["a", "b", "c"]), "shorter prefix matches");
	assert.ok(hasPrefix(["a", "b"], ["a", "b"]), "equal is a prefix");
	assert.ok(hasPrefix([], ["a"]), "empty is a prefix");
	assert.ok(!hasPrefix(["a", "b", "c"], ["a", "b"]), "longer existing is NOT a prefix");
	assert.ok(!hasPrefix(["a", "x"], ["a", "b", "c"]), "divergent history breaks the prefix");

	const facts = (over: Partial<SessionCompatFacts> = {}): SessionCompatFacts => ({
		cwd: "/w",
		modelId: "claude-sonnet-4-6",
		bridgeConfigSignature: bridgeConfigSignature(baseInput()),
		contextMessageSignatures: ["user:text:a"],
		...over,
	});
	const params = facts({ contextMessageSignatures: ["user:text:a", "assistant:text:b"] });
	assert.ok(isCompatible(facts(), params), "prefix history + same cfg → compatible");
	assert.ok(!isCompatible(facts({ cwd: "/other" }), params), "cwd drift → incompatible");
	assert.ok(!isCompatible(facts({ modelId: "claude-opus-4-8" }), params), "model drift → incompatible");
	assert.ok(!isCompatible(facts({ bridgeConfigSignature: "different" }), params), "signature drift → incompatible");
	assert.ok(
		!isCompatible(facts({ contextMessageSignatures: ["user:text:EDITED"] }), params),
		"edited history → prefix break → incompatible",
	);
}

// ---------------------------------------------------------------------------
// 4) decideBootstrap matrix
// ---------------------------------------------------------------------------
{
	const sig = bridgeConfigSignature(baseInput());
	const compatFacts: SessionCompatFacts = {
		cwd: "/w",
		modelId: "claude-sonnet-4-6",
		bridgeConfigSignature: sig,
		contextMessageSignatures: ["user:text:a"],
	};
	const params = (policy: "process-scoped" | "turn-scoped") => ({
		...compatFacts,
		contextMessageSignatures: ["user:text:a", "assistant:text:b", "user:text:c"],
		lifecyclePolicy: policy,
	});
	const aliveCompat: ExistingSession = { ...compatFacts, alive: true };
	const persistedCompat: SessionRecord = buildSessionRecord(
		{ sessionKey: "k", acpSessionId: "acp-123", ...compatFacts },
		"2026-06-18T00:00:00Z",
	);

	// turn-scoped: ALWAYS new, even with a compatible existing AND persisted (④).
	assert.deepEqual(
		decideBootstrap(params("turn-scoped"), {
			existing: aliveCompat,
			persisted: persistedCompat,
			capabilities: { resumeSession: true, loadSession: true },
		}).path,
		"new",
		"turn-scoped one-shot is always new",
	);

	// process-scoped + alive compatible existing → reuse.
	assert.equal(
		decideBootstrap(params("process-scoped"), { existing: aliveCompat }).path,
		"reuse",
		"compatible alive → reuse",
	);

	// process-scoped + persisted compatible + resume capability → resume.
	{
		const d = decideBootstrap(params("process-scoped"), {
			persisted: persistedCompat,
			capabilities: { resumeSession: true, loadSession: false },
		});
		assert.equal(d.path, "resume", "persisted compatible + resume cap → resume");
		assert.equal(d.acpSessionId, "acp-123", "resume carries the persisted acpSessionId");
	}

	// process-scoped + persisted compatible + only load capability → load.
	assert.equal(
		decideBootstrap(params("process-scoped"), {
			persisted: persistedCompat,
			capabilities: { resumeSession: false, loadSession: true },
		}).path,
		"load",
		"persisted compatible + load cap → load",
	);

	// process-scoped + persisted compatible + NO capability → new.
	assert.equal(
		decideBootstrap(params("process-scoped"), {
			persisted: persistedCompat,
			capabilities: { resumeSession: false, loadSession: false },
		}).path,
		"new",
		"persisted compatible but no resume/load capability → new",
	);

	// process-scoped + alive INCOMPATIBLE existing → new + invalidatePersisted,
	// and the persisted record is NOT trusted even if itself compatible.
	{
		const incompatAlive: ExistingSession = {
			...compatFacts,
			bridgeConfigSignature: "drifted",
			alive: true,
		};
		const d = decideBootstrap(params("process-scoped"), { existing: incompatAlive, persisted: persistedCompat });
		assert.equal(d.path, "new", "incompatible existing → new");
		assert.equal(d.invalidatePersisted, true, "incompatible existing also invalidates persisted");
	}

	// process-scoped + persisted incompatible (no existing) → new + invalidate.
	{
		const incompatPersisted: SessionRecord = { ...persistedCompat, bridgeConfigSignature: "drifted" };
		const d = decideBootstrap(params("process-scoped"), { persisted: incompatPersisted });
		assert.equal(d.path, "new", "incompatible persisted → new");
		assert.equal(d.invalidatePersisted, true, "incompatible persisted is invalidated");
	}

	// process-scoped + nothing → new.
	assert.equal(decideBootstrap(params("process-scoped"), {}).path, "new", "no source → new");

	// model-lock: live existing with a different model → fail-loud throw (①).
	assert.throws(
		() =>
			decideBootstrap(params("process-scoped"), {
				existing: { ...aliveCompat, modelId: "claude-opus-4-8" },
			}),
		SessionModelLockedError,
		"live model mismatch throws SessionModelLockedError",
	);
}

// ---------------------------------------------------------------------------
// 5) record build (pure) + parse validate + roundtrip in a temp dir
// ---------------------------------------------------------------------------
{
	const facts: SessionCompatFacts = {
		cwd: "/w",
		modelId: "claude-sonnet-4-6",
		bridgeConfigSignature: bridgeConfigSignature(baseInput()),
		contextMessageSignatures: ["user:text:a"],
	};
	const rec = buildSessionRecord({ sessionKey: "sess/key 1", acpSessionId: "acp-9", ...facts }, "2026-06-18T01:02:03Z");
	assert.equal(rec.version, SESSION_RECORD_VERSION);
	assert.equal(rec.provider, SESSION_RECORD_PROVIDER);
	assert.equal(rec.updatedAt, "2026-06-18T01:02:03Z", "updatedAt is the injected clock (pure build)");

	const dir = mkdtempSync(join(tmpdir(), "acp-session-store-"));
	try {
		writeSessionRecord(rec, dir);
		const read = readSessionRecord("sess/key 1", dir);
		assert.deepEqual(read, rec, "write→read roundtrip preserves the record");
		// sessionKey with a slash/space is encoded into a single safe filename.
		assert.ok(sessionRecordPath("sess/key 1", dir).endsWith(".json"), "record path is a .json file");
		assert.ok(!sessionRecordPath("sess/key 1", dir).includes("/key 1"), "sessionKey is encoded, not a path segment");

		// Unknown key → undefined.
		assert.equal(readSessionRecord("missing", dir), undefined, "missing record → undefined");

		// Corrupt file → undefined AND deleted.
		const corruptPath = sessionRecordPath("corrupt", dir);
		writeFileSync(corruptPath, "{ not json");
		assert.equal(readSessionRecord("corrupt", dir), undefined, "corrupt JSON → undefined");
		assert.ok(!existsSync(corruptPath), "corrupt record is DELETED on read, not left on disk");

		// Wrong version/provider/sessionKey → parse rejects.
		assert.equal(parseSessionRecord({ ...rec, version: 999 }, rec.sessionKey), undefined, "wrong version rejected");
		assert.equal(
			parseSessionRecord({ ...rec, provider: "other" }, rec.sessionKey),
			undefined,
			"wrong provider rejected",
		);
		assert.equal(parseSessionRecord(rec, "different-key"), undefined, "sessionKey mismatch rejected");
		assert.equal(
			parseSessionRecord({ ...rec, acpSessionId: "" }, rec.sessionKey),
			undefined,
			"empty acpSessionId rejected",
		);

		// delete removes the file.
		deleteSessionRecord("sess/key 1", dir);
		assert.equal(readSessionRecord("sess/key 1", dir), undefined, "deleted record → undefined");
		// On-disk JSON is pretty + has a provider field (sanity that it really wrote).
		writeSessionRecord(rec, dir);
		assert.match(readFileSync(sessionRecordPath("sess/key 1", dir), "utf8"), /"provider": "entwurf"/, "json written");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

// ---------------------------------------------------------------------------
// 6) resolveLifecyclePolicy — only exact --entwurf-control is process-scoped
// ---------------------------------------------------------------------------
{
	// A resident may ALSO carry -p (fire a first prompt, then stay alive) — it
	// must still be process-scoped. Keying on -p (candidate B) would kill it.
	const residentWithP = resolveLifecyclePolicy(["pi", ENTWURF_CONTROL_FLAG, "-p", "hi"]);
	assert.equal(residentWithP, "process-scoped", "resident with -p is still process-scoped (B trap)");
	assert.equal(resolveLifecyclePolicy(["pi", ENTWURF_CONTROL_FLAG]), "process-scoped", "resident → process-scoped");
	// pi -p one-shot and plain interactive are turn-scoped (S2c hang-safe).
	assert.equal(resolveLifecyclePolicy(["pi", "-p", "hi"]), "turn-scoped", "pi -p one-shot → turn-scoped");
	assert.equal(resolveLifecyclePolicy(["pi"]), "turn-scoped", "interactive → turn-scoped (conservative)");
	// Exact token only — a substring/look-alike flag must NOT qualify.
	assert.equal(
		resolveLifecyclePolicy(["pi", "--not-entwurf-control"]),
		"turn-scoped",
		"look-alike flag is not the exact token → turn-scoped",
	);
}

console.log(
	"[check-acp-session-store] ok — signature (pure sha256 digest, carrier/model drift detected, no raw on disk), " +
		"contextMessageSignatures (sha256(role:content), no raw text, toolResult folds toolName/isError), " +
		"hasPrefix/isCompatible (prefix-only, cwd/model/sig/edited drift → incompatible), " +
		"decideBootstrap matrix (turn-scoped→always new, process reuse/resume/load/new, incompatible→invalidate, " +
		"live model mismatch→throw), record build (injected clock) + parse validate + temp-dir roundtrip, " +
		"resolveLifecyclePolicy (exact --entwurf-control → process-scoped incl. with -p; -p/interactive/look-alike → turn-scoped)",
);
