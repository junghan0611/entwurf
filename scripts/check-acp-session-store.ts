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
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Context } from "@earendil-works/pi-ai";
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
	appendSystemPrompt: "",
	mcpServers: [],
	settingSources: [],
});

// ---------------------------------------------------------------------------
// 1) signature — pure/stable, carrier drift changes it
// ---------------------------------------------------------------------------
{
	const sig0 = bridgeConfigSignature(baseInput());
	assert.equal(sig0, bridgeConfigSignature(baseInput()), "signature is deterministic");
	// Array copies do not affect equality (same content).
	assert.equal(bridgeConfigSignature({ ...baseInput(), mcpServers: [] }), sig0, "empty mcpServers stable");
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
// 2) contextMessageSignatures — role + content shape
// ---------------------------------------------------------------------------
{
	const ctx: Context = {
		messages: [
			{ role: "user", content: "hello", timestamp: 0 },
			{
				role: "assistant",
				content: [{ type: "text", text: "hi" }],
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
				stopReason: "stop",
				timestamp: 0,
			},
			{ role: "user", content: [{ type: "image", data: "X", mimeType: "image/png" }], timestamp: 0 },
		],
	};
	const sigs = contextMessageSignatures(ctx);
	assert.deepEqual(
		sigs,
		["user:text:hello", "assistant:text:hi", "user:image:image/png"],
		"per-message role:content signatures",
	);
	// image signature carries the mimeType, never raw data.
	assert.ok(!sigs[2].includes("X"), "image signature excludes raw data");
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
		assert.match(
			readFileSync(sessionRecordPath("sess/key 1", dir), "utf8"),
			/"provider": "pi-shell-acp"/,
			"json written",
		);
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
	"[check-acp-session-store] ok — signature (pure, carrier/model drift detected), contextMessageSignatures " +
		"(role:content, no raw image), hasPrefix/isCompatible (prefix-only, cwd/model/sig/edited drift → incompatible), " +
		"decideBootstrap matrix (turn-scoped→always new, process reuse/resume/load/new, incompatible→invalidate, " +
		"live model mismatch→throw), record build (injected clock) + parse validate + temp-dir roundtrip, " +
		"resolveLifecyclePolicy (exact --entwurf-control → process-scoped incl. with -p; -p/interactive/look-alike → turn-scoped)",
);
