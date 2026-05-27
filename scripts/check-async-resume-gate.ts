/**
 * check-async-resume-gate — deterministic gate for the MCP `entwurf_resume`
 * mode resolution (Phase B Step 3).
 *
 * Pins the asymmetric-mitsein discriminator:
 *
 *   - explicit `mode` wins (after the reject check)
 *   - omitted `mode` auto-resolves: async if replyable, sync if external
 *   - explicit `mode="async"` + non-replyable sender → reject with the
 *     canonical `ENTWURF_RESUME_ASYNC_REJECT_REASON` text. Mirrors
 *     entwurf_send's `wants_reply=true` rejection at line 344 of the MCP
 *     module.
 *
 * Why this gate exists: the Phase B Step 3 invariant is that the MCP
 * surface MUST NOT use a static `default: "async"` schema. A static default
 * would silently reject every external MCP host turn while claiming
 * "default async" in the schema description — exact UX inversion the
 * regression repair closes. This gate locks the conditional-default
 * resolution into a deterministic test so future edits cannot reintroduce
 * the inversion without surfacing here first.
 *
 * Coverage: 6 cases × {effectiveMode, rejectReason} assertions.
 *
 *   1. external sender + mode omitted             → sync, no reject
 *   2. external sender + mode="sync"              → sync, no reject
 *   3. external sender + mode="async"             → async, REJECT
 *   4. replyable sender + mode omitted            → async, no reject
 *   5. replyable sender + mode="sync"             → sync, no reject
 *   6. replyable sender + mode="async"            → async, no reject
 *
 * Plus 2 invariants:
 *
 *   7. reject reason mentions "replyable" and "PI_SESSION_ID" (so callers
 *      reading the error know what to fix)
 *   8. handler does not silently downgrade — explicit async + external
 *      MUST emit a rejectReason; the helper returning `{ mode: "sync" }`
 *      from this branch would be a regression.
 *
 * No process spawn, no socket touch, no API cost.
 */

import assert from "node:assert/strict";

import {
	ENTWURF_RESUME_ASYNC_CWD_REJECT_REASON,
	ENTWURF_RESUME_ASYNC_REJECT_REASON,
	type ResumeModeSenderEnvelope,
	resolveEntwurfResumeMode,
} from "../mcp/pi-tools-bridge/src/resume-mode.ts";

const external: ResumeModeSenderEnvelope = { replyable: false };
const replyable: ResumeModeSenderEnvelope = { replyable: true };

let pass = 0;
const fail: string[] = [];

function check(name: string, fn: () => void): void {
	try {
		fn();
		pass += 1;
		process.stdout.write(`[check-async-resume-gate] ${name}: ok\n`);
	} catch (err) {
		fail.push(`${name}: ${(err as Error).message}`);
	}
}

// ─── 6 resolution cases ──────────────────────────────────────────────────

check("1. external + mode omitted → sync, no reject", () => {
	const r = resolveEntwurfResumeMode(external, undefined);
	assert.equal(r.mode, "sync", `expected sync, got ${r.mode}`);
	assert.equal(r.rejectReason, null, `expected null rejectReason, got: ${r.rejectReason}`);
});

check("2. external + mode='sync' → sync, no reject", () => {
	const r = resolveEntwurfResumeMode(external, "sync");
	assert.equal(r.mode, "sync");
	assert.equal(r.rejectReason, null);
});

check("3. external + mode='async' → async + REJECT", () => {
	const r = resolveEntwurfResumeMode(external, "async");
	assert.equal(r.mode, "async", "mode field still reports the explicit ask");
	assert.equal(
		r.rejectReason,
		ENTWURF_RESUME_ASYNC_REJECT_REASON,
		"rejectReason must be the canonical text — exact match",
	);
});

check("4. replyable + mode omitted → async, no reject (default behavior)", () => {
	const r = resolveEntwurfResumeMode(replyable, undefined);
	assert.equal(r.mode, "async", `pi-shell-acp Claude default — got ${r.mode}`);
	assert.equal(r.rejectReason, null);
});

check("5. replyable + mode='sync' → sync, no reject", () => {
	const r = resolveEntwurfResumeMode(replyable, "sync");
	assert.equal(r.mode, "sync");
	assert.equal(r.rejectReason, null);
});

check("6. replyable + mode='async' → async, no reject (explicit + replyable)", () => {
	const r = resolveEntwurfResumeMode(replyable, "async");
	assert.equal(r.mode, "async");
	assert.equal(r.rejectReason, null);
});

// ─── 2 reject-shape invariants ───────────────────────────────────────────

check("7. reject reason names the missing env vars + replyable", () => {
	assert.match(
		ENTWURF_RESUME_ASYNC_REJECT_REASON,
		/replyable/i,
		"reject reason must mention 'replyable' so the caller knows the criterion",
	);
	assert.match(
		ENTWURF_RESUME_ASYNC_REJECT_REASON,
		/PI_SESSION_ID/,
		"reject reason must name PI_SESSION_ID env so the caller knows what to wire",
	);
	assert.match(
		ENTWURF_RESUME_ASYNC_REJECT_REASON,
		/PI_AGENT_ID/,
		"reject reason must name PI_AGENT_ID env so the caller knows what to wire",
	);
});

check("8. no silent downgrade — explicit async + non-replyable MUST surface rejectReason", () => {
	// Regression guard: if a future edit changes the helper to silently
	// downgrade explicit async to sync on external hosts, this assertion
	// fires because rejectReason would become null while mode flips to sync.
	// The contract is: surface the reject, do not pretend the caller's
	// explicit ask was honored.
	const r = resolveEntwurfResumeMode(external, "async");
	assert.notEqual(r.rejectReason, null, "rejectReason MUST NOT be null when explicit async hits non-replyable");
	assert.equal(r.mode, "async", "mode reports the explicit ask verbatim (the handler decides what to do)");
});

// ─── 1 sender shape invariant ────────────────────────────────────────────

check("9. sender envelope { replyable: undefined } resolves as non-replyable", () => {
	// Defensive: if buildSendSenderEnvelope ever forgets to set replyable
	// explicitly, the auto-resolution must NOT silently grant async. Only
	// `replyable === true` enables async default; anything else routes to
	// the safe sync path.
	const undef = { replyable: undefined as boolean | undefined };
	const r = resolveEntwurfResumeMode(undef, undefined);
	assert.equal(r.mode, "sync", "missing replyable defaults to sync");
	assert.equal(r.rejectReason, null);

	const explicitAsync = resolveEntwurfResumeMode(undef, "async");
	assert.equal(explicitAsync.rejectReason, ENTWURF_RESUME_ASYNC_REJECT_REASON);
});

// ─── 3 cwd silent-ignore guard cases ─────────────────────────────────────

check("10. replyable + mode='async' + cwd → REJECT (silent-ignore guard)", () => {
	// The async launcher uses the saved session header cwd as authority (#9);
	// accepting cwd here while the launcher ignores it would mislead the
	// caller. Surface that as an explicit error.
	const r = resolveEntwurfResumeMode(replyable, "async", "/some/override/path");
	assert.equal(r.mode, "async");
	assert.equal(
		r.rejectReason,
		ENTWURF_RESUME_ASYNC_CWD_REJECT_REASON,
		"rejectReason must be the canonical cwd-async-conflict text",
	);
});

check("11. replyable + mode omitted + cwd → REJECT (auto-async still rejects cwd)", () => {
	// Conditional default lands on async for a replyable caller; cwd guard
	// then fires. This is the practical scenario for pi-shell-acp Claude
	// callers who absent-mindedly pass cwd.
	const r = resolveEntwurfResumeMode(replyable, undefined, "/foo");
	assert.equal(r.mode, "async");
	assert.equal(r.rejectReason, ENTWURF_RESUME_ASYNC_CWD_REJECT_REASON);
});

check("12. replyable + mode='sync' + cwd → sync, no reject (cwd is sync-only)", () => {
	// The cwd override is a debug/migration escape hatch on the sync path
	// only — see #9. Sync path must allow it.
	const r = resolveEntwurfResumeMode(replyable, "sync", "/foo");
	assert.equal(r.mode, "sync");
	assert.equal(r.rejectReason, null);
});

check("13. external + mode='sync' + cwd → sync, no reject", () => {
	// External MCP hosts may also use cwd on the sync path.
	const r = resolveEntwurfResumeMode(external, "sync", "/foo");
	assert.equal(r.mode, "sync");
	assert.equal(r.rejectReason, null);
});

check("14. external + mode omitted + cwd → sync (auto), no reject", () => {
	// Auto-sync for external + cwd present is fine because cwd is sync-only.
	const r = resolveEntwurfResumeMode(external, undefined, "/foo");
	assert.equal(r.mode, "sync");
	assert.equal(r.rejectReason, null);
});

check("15. cwd reject reason names sync-only + #9", () => {
	assert.match(ENTWURF_RESUME_ASYNC_CWD_REJECT_REASON, /sync-only/i);
	assert.match(ENTWURF_RESUME_ASYNC_CWD_REJECT_REASON, /#9/);
	// And the two reject reasons must be distinct so callers can tell which
	// guard fired.
	assert.notEqual(ENTWURF_RESUME_ASYNC_CWD_REJECT_REASON, ENTWURF_RESUME_ASYNC_REJECT_REASON);
});

check("16. replyable guard fires BEFORE cwd guard when both could apply", () => {
	// Order of checks: if a non-replyable caller asks for explicit async
	// WITH cwd, the more fundamental wiring break (replyable) should
	// surface, not the cwd detail. Otherwise the caller would fix cwd,
	// retry, and hit replyable next — two round trips for one bug.
	const r = resolveEntwurfResumeMode(external, "async", "/foo");
	assert.equal(r.rejectReason, ENTWURF_RESUME_ASYNC_REJECT_REASON, "replyable check must come first");
});

// ─── Summary ─────────────────────────────────────────────────────────────

if (fail.length > 0) {
	for (const f of fail) process.stderr.write(`[check-async-resume-gate] FAIL ${f}\n`);
	process.exit(1);
}
process.stdout.write(`[check-async-resume-gate] ${pass} assertions ok\n`);
