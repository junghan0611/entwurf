#!/usr/bin/env node --experimental-strip-types
/**
 * Transcript-poison classification + invalidation smoke for issue #12.
 *
 * Verifies two things deterministically, without spawning a real ACP child
 * and without any Anthropic API call:
 *
 *   1. `isTranscriptPoisonError` classifies the known Anthropic 400
 *      transcript-validity surfaces — and only those surfaces.
 *      Transient/network/unknown-session errors must not match, so they
 *      never trigger persisted-record invalidation.
 *
 *   2. The persistence side-effect that the poison branch in
 *      `streamShellAcp` (index.ts) drives: when `closeBridgeSession(..., {
 *      invalidatePersisted: true })` runs against a sessionKey whose
 *      canonical cache file exists, the file is removed.
 *
 * The end-to-end live repro — a resumed claude-agent-acp child that hits
 * Anthropic with a poisoned transcript and gets the 400 back — requires a
 * local poisoned JSONL artifact plus one billable Claude turn and is
 * documented as a manual recipe in VERIFY.md §12.6 rather than wired here.
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { closeBridgeSession, isTranscriptPoisonError } from "../acp-bridge.ts";

const SESSION_CACHE_DIR = join(homedir(), ".pi", "agent", "cache", "pi-shell-acp", "sessions");

function persistedPath(sessionKey: string): string {
	const digest = createHash("sha256").update(sessionKey).digest("hex");
	return join(SESSION_CACHE_DIR, `${digest}.json`);
}

function fail(stage: string, message: string): never {
	console.error(`[poison-smoke] FAIL stage=${stage} ${message}`);
	process.exit(1);
}

async function main(): Promise<void> {
	// Step 1 — classifier. Two Anthropic transcript-validity 400 surfaces
	// match; everything else must not, especially adjacent 4xx errors that
	// happen to share substring fragments.
	const poisonCases: Array<unknown> = [
		// Surface 1: cache_control on empty text block (original #12 repro,
		// homeagent-config 2026-05-12).
		new Error("API Error: 400 messages.36.content.0.text: cache_control cannot be set for empty text blocks"),
		new Error(
			"Internal error: API Error: 400 messages.12.content.7.text: cache_control cannot be set for empty text blocks",
		),
		"cache_control cannot be set for empty text blocks",
		// Surface 2: empty user/text content block (demo-style synthetic
		// repro 2026-05-12).
		new Error("API Error: 400 messages: text content blocks must be non-empty"),
		new Error("Internal error: API Error: 400 messages: text content blocks must be non-empty"),
	];
	const nonPoisonCases: Array<unknown> = [
		new Error("network ECONNRESET"),
		new Error("session not found"),
		new Error("Internal error: API Error: 401 invalid x-api-key"),
		new Error("Internal error: API Error: 400 messages.1.role: invalid role"),
		// Adjacent-string negatives: prefix guard on surface 2 must prevent
		// false matches when "text content blocks must be non-empty" appears
		// in a non-400 / non-messages context.
		new Error("Internal error: API Error: 401 text content blocks must be non-empty"),
		new Error("local validation: text content blocks must be non-empty"),
		new Error("Internal error: API Error: 400 stream: text content blocks must be non-empty"),
		new Error(""),
		"plain string error",
		undefined,
		null,
		42,
	];

	for (const e of poisonCases) {
		if (!isTranscriptPoisonError(e)) {
			fail("classifier", `poison-shaped input did not match: ${describe(e)}`);
		}
	}
	for (const e of nonPoisonCases) {
		if (isTranscriptPoisonError(e)) {
			fail("classifier", `non-poison input incorrectly matched: ${describe(e)}`);
		}
	}
	console.error(`[poison-smoke] classifier: ok (${poisonCases.length} poison, ${nonPoisonCases.length} non-poison)`);

	// Step 2 — persistence invalidation side-effect.
	//
	// `closeBridgeSession` falls through to `deletePersistedSessionRecord`
	// when no in-memory session exists for the key and
	// `invalidatePersisted !== false`. This is the exact path the
	// prompt-error branch in `streamShellAcp` drives when
	// `isTranscriptPoisonError` classifies the failure and
	// `bootstrapPath !== "new"`.
	const testSessionKey = `pi:test-transcript-poison-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
	mkdirSync(SESSION_CACHE_DIR, { recursive: true });
	const recordPath = persistedPath(testSessionKey);

	// Minimal stub: only the file's existence and deletion are observable.
	// `parsePersistedSessionRecord` would reject this shape, but we never
	// read it back — `closeBridgeSession` calls `rmSync(..., { force:true })`
	// unconditionally on the canonical path.
	writeFileSync(recordPath, `${JSON.stringify({ marker: "transcript-poison-smoke", sessionKey: testSessionKey })}\n`);
	if (!existsSync(recordPath)) {
		fail("setup", `could not create stub persisted record at ${recordPath}`);
	}

	try {
		await closeBridgeSession(testSessionKey, { closeRemote: false, invalidatePersisted: true });
	} catch (err) {
		// Cleanup before reporting so a half-failed run doesn't leak the stub.
		rmSync(recordPath, { force: true });
		fail("close", `closeBridgeSession threw: ${err instanceof Error ? err.message : String(err)}`);
	}

	if (existsSync(recordPath)) {
		rmSync(recordPath, { force: true });
		fail("invalidate", `persisted record survived closeBridgeSession({ invalidatePersisted: true }) at ${recordPath}`);
	}
	console.error(`[poison-smoke] invalidate: ok (sessionKey=${testSessionKey})`);

	// Step 3 — confirm the inverse: invalidatePersisted=false must preserve.
	// This guards against accidental over-eager deletion if the poison
	// branch is ever miswired to always-true.
	writeFileSync(
		recordPath,
		`${JSON.stringify({ marker: "transcript-poison-smoke-inverse", sessionKey: testSessionKey })}\n`,
	);
	try {
		await closeBridgeSession(testSessionKey, { closeRemote: false, invalidatePersisted: false });
	} catch (err) {
		rmSync(recordPath, { force: true });
		fail("close-inverse", `closeBridgeSession threw: ${err instanceof Error ? err.message : String(err)}`);
	}
	if (!existsSync(recordPath)) {
		fail("preserve", "persisted record was deleted when invalidatePersisted=false");
	}
	rmSync(recordPath, { force: true });
	console.error("[poison-smoke] preserve: ok (invalidatePersisted=false leaves record intact)");

	console.error("[poison-smoke] PASS");
}

function describe(e: unknown): string {
	if (e instanceof Error) return `Error("${e.message}")`;
	if (e === null) return "null";
	if (e === undefined) return "undefined";
	return `${typeof e}(${String(e)})`;
}

main().catch((err) => {
	console.error(`[poison-smoke] unexpected error: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`);
	process.exit(1);
});
