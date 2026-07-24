/**
 * check-entwurf-session-identity — deterministic gate for the record-era session
 * identity contract. No backend, no API, no spawn. Pure-string + synthetic-fs.
 *
 *   - T-grammar    the garden-id grammar (session-id.js SSOT): validator +
 *                  generator uniqueness + timestamp format. This is the RECORD's
 *                  gardenId shape now, not pi's session id.
 *   - T-identity   readSessionIdentity: first model_change is the model authority;
 *                  drift fail-fast; the session NAME is pi's and is never read
 *                  (#50 C3 — the old name-mirror/`requireEntwurf` refusals are
 *                  asserted GONE, not just untested).
 *   - T-resident   the 🪛 status label (model-lock lifecycle signal).
 *
 * What died here (#50 C3): the whole name grammar (T-titleSlug / T-registry /
 * build-parse round-trip / T-no-logic / T-model-immut — the name is pi's and no
 * code assembles or parses one), the header-scan lookup (T-collision), the
 * transcript analyzer, and the remote scope-lock. The meta-record resolves a
 * garden id to its transcript now (see check-entwurf-v2-spawn-production §9).
 *
 * The sessions base is isolated to a temp dir BEFORE the module computes its
 * load-time paths, so the real ~/.pi/agent is never touched.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Isolate env BEFORE importing the module (entwurf-core computes AGENT_DIR at
// module load). Dynamic import after the env is set.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "psa-session-identity-"));
process.env.PI_CODING_AGENT_DIR = tmp;

const { isValidSessionId, generateSessionId, formatSessionTimestamp, computeResidentStatusLabel, readSessionIdentity } =
	await import("../pi-extensions/lib/entwurf-core.ts");

let n = 0;
const ok = (cond: unknown, msg: string) => {
	assert.ok(cond, msg);
	n++;
};
const eq = (a: unknown, b: unknown, msg: string) => {
	assert.equal(a, b, msg);
	n++;
};
const throws = (fn: () => void, label: string) => {
	let threw = false;
	try {
		fn();
	} catch {
		threw = true;
	}
	assert.ok(threw, `expected throw: ${label}`);
	n++;
};
const noThrow = (fn: () => void, label: string) => {
	try {
		fn();
	} catch (e) {
		assert.fail(`unexpected throw (${label}): ${e instanceof Error ? e.message : String(e)}`);
	}
	n++;
};

try {
	// ---- T-grammar: sessionId validator ----
	ok(isValidSessionId("20260603T191245-a3f09c"), "valid sessionId");
	ok(!isValidSessionId("20260603T191245-a3f8"), "4-hex suffix rejected");
	ok(!isValidSessionId("20260603T191245-A3F09C"), "uppercase hex rejected");
	ok(!isValidSessionId("20260603191245-a3f09c"), "missing T rejected");
	ok(!isValidSessionId("20260603T191245_a3f09c"), "underscore separator rejected");
	ok(!isValidSessionId("x20260603T191245-a3f09c"), "leading slop rejected");
	ok(!isValidSessionId("20260603T191245-a3f09c "), "trailing space rejected");
	ok(!isValidSessionId(123 as unknown), "non-string rejected");

	// generateSessionId: format + uniqueness (same-second parallel spawn safety)
	const ids = Array.from({ length: 256 }, () => generateSessionId());
	ok(
		ids.every((id) => isValidSessionId(id)),
		"all generated ids valid",
	);
	eq(new Set(ids).size, 256, "256 generated ids unique (6-hex suffix)");
	eq(formatSessionTimestamp(new Date(2026, 5, 3, 19, 12, 45)), "20260603T191245", "timestamp value (local)");

	// ---- T-identity: resume identity authority = FIRST model_change ----
	const sessionsBase = path.join(tmp, "sessions");
	const msg = (m: Record<string, unknown>) =>
		`${JSON.stringify({ type: "message", message: { role: "assistant", ...m } })}\n`;
	// (NEXT.md "Authority separation": model authority is the first model_change,
	// NOT the last assistant message's model. Drift fail-fast. The session NAME is
	// pi's — #50 C3 removed the name-mirror integrity throws, asserted below.)
	const idDir = path.join(sessionsBase, "--identity-cwd--");
	fs.mkdirSync(idDir, { recursive: true });
	const mc = (provider: string, modelId: string) => `${JSON.stringify({ type: "model_change", provider, modelId })}\n`;
	const sessionLine = (id: string, cwd: string) => `${JSON.stringify({ type: "session", id, cwd })}\n`;
	const infoLine = (name: string) => `${JSON.stringify({ type: "session_info", name })}\n`;

	// 1. first model_change = A, later ASSISTANT message reports model B →
	//    identity follows the first model_change (A), never the assistant message.
	const idA = "20260603T220000-1111aa";
	const fileA = path.join(idDir, `2026-06-03T22-00-00-000Z_${idA}.jsonl`);
	fs.writeFileSync(
		fileA,
		sessionLine(idA, "/identity/a") +
			mc("openai-codex", "gpt-5.5") +
			msg({ content: "drifted", model: "claude-opus-4-8", provider: "entwurf" }),
	);
	const recA = readSessionIdentity(fileA);
	eq(recA?.provider, "openai-codex", "identity: provider = first model_change (not assistant message)");
	eq(recA?.modelId, "gpt-5.5", "identity: modelId = first model_change (not assistant message)");
	eq(recA?.cwd, "/identity/a", "identity: cwd from header");

	// 2. later model_change differs from the first → drift fail-fast.
	const idB = "20260603T220000-2222bb";
	const fileB = path.join(idDir, `2026-06-03T22-00-00-000Z_${idB}.jsonl`);
	fs.writeFileSync(
		fileB,
		sessionLine(idB, "/identity/b") + mc("entwurf", "claude-opus-4-8") + mc("openai-codex", "gpt-5.5"),
	);
	throws(() => readSessionIdentity(fileB), "identity: later model_change drift → fail-fast");

	// 3. the session NAME is pi's (LOCKED PROTOCOL 2, #50 C3): a name whose
	//    provider/model disagrees with the first model_change is NOT entwurf's to
	//    judge — identity must resolve from the transcript alone, no throw.
	const idC = "20260603T220000-3333cc";
	const fileC = path.join(idDir, `2026-06-03T22-00-00-000Z_${idC}.jsonl`);
	const mismatchName = `${idC}==entwurf/claude-opus-4-8--x__entwurf`;
	fs.writeFileSync(fileC, sessionLine(idC, "/identity/c") + mc("openai-codex", "gpt-5.5") + infoLine(mismatchName));
	noThrow(() => readSessionIdentity(fileC), "identity: name provider/model disagreement is pi's business — no throw");
	eq(readSessionIdentity(fileC)?.modelId, "gpt-5.5", "identity: model still resolves from first model_change");

	// 4. same for a name carrying a different sessionId than the header: the name
	//    is display/search metadata owned by pi; entwurf reads only header + model_change.
	const idD = "20260603T220000-4444dd";
	const fileD = path.join(idDir, `2026-06-03T22-00-00-000Z_${idD}.jsonl`);
	const wrongIdName = "20260603T220000-9999ff==openai-codex/gpt-5.5--x__entwurf";
	fs.writeFileSync(fileD, sessionLine(idD, "/identity/d") + mc("openai-codex", "gpt-5.5") + infoLine(wrongIdName));
	noThrow(() => readSessionIdentity(fileD), "identity: name sessionId disagreement is pi's business — no throw");
	eq(readSessionIdentity(fileD)?.sessionId, idD, "identity: sessionId resolves from the header, never the name");

	// 5. clean session (a name present + single model_change) → identity, no throw.
	const idE = "20260603T220000-5555ee";
	const fileE = path.join(idDir, `2026-06-03T22-00-00-000Z_${idE}.jsonl`);
	fs.writeFileSync(
		fileE,
		sessionLine(idE, "/identity/e") +
			mc("entwurf", "claude-sonnet-5") +
			infoLine("whatever pi named it") +
			msg({ content: "ok", model: "claude-sonnet-5", provider: "entwurf" }),
	);
	noThrow(() => readSessionIdentity(fileE), "identity: clean session does not throw");
	const recE = readSessionIdentity(fileE);
	eq(recE?.provider, "entwurf", "identity(clean): provider");
	eq(recE?.modelId, "claude-sonnet-5", "identity(clean): modelId from first model_change");

	// 6. no model_change → null (caller refuses with its own no-recorded-model result).
	const idF = "20260603T220000-6666ff";
	const fileF = path.join(idDir, `2026-06-03T22-00-00-000Z_${idF}.jsonl`);
	fs.writeFileSync(
		fileF,
		sessionLine(idF, "/identity/f") + msg({ content: "no model_change", model: "x", provider: "y" }),
	);
	eq(readSessionIdentity(fileF), null, "identity: no model_change → null");

	// ---- T-name-blind: the reader takes NO options and never reads the name (#50 C3) ----
	// The old `requireEntwurf` name-tag authorization (0.9.0 "entwurf 여부 = name tag")
	// is deleted, not just unused: resume authorization is record existence
	// (readMetaIdentityByGardenId) + the header-id ↔ record.nativeSessionId integrity
	// check in resolveResumeLaunchIdentity. A session with no name, a non-canonical
	// name, or no `entwurf` tag resolves identity exactly like any other pi session.
	const idG = "20260603T230000-7777aa";
	const fileG = path.join(idDir, `2026-06-03T23-00-00-000Z_${idG}.jsonl`);
	fs.writeFileSync(
		fileG,
		sessionLine(idG, "/identity/g") + mc("entwurf", "claude-opus-4-8") + infoLine("not a canonical name"),
	);
	noThrow(() => readSessionIdentity(fileG), "name-blind: non-canonical name resolves like any pi session");
	eq(readSessionIdentity(fileG)?.modelId, "claude-opus-4-8", "name-blind: identity from model_change only");
	eq(readSessionIdentity.length, 1, "name-blind: readSessionIdentity takes exactly one arg (no opts, compiler-pinned)");

	// ========================================================================
	// T-resident: the resident --entwurf-control session (#50 C2/C3)
	//
	// What used to live here — the garden-id guard (assertGardenNativeSessionId),
	// the resident NAME builder (buildGardenSessionName + the `control` tag, its
	// registry-free contract and its `entwurf`-tag refusal), and later the
	// `requireEntwurf` reader option (C3) — is deleted, not relocated. All of it
	// enforced "pi's session id IS the garden address", which the meta-record now
	// owns; the address is minted by the record and the socket is keyed on it
	// (smoke-pi-attach). The status label is what survives, because it was never
	// about the id GRAMMAR — it signals the model-lock lifecycle.
	// ========================================================================

	const residentSid = "20260604T083632-aa11bb";

	// computeResidentStatusLabel — 🪛 lifecycle signal (no "entwurf" text).
	eq(
		computeResidentStatusLabel({ sessionId: residentSid, sessionFileExists: false }),
		"🪛 ready",
		"status label before first turn (no file) = 🪛 ready",
	);
	eq(
		computeResidentStatusLabel({ sessionId: residentSid, sessionFileExists: true }),
		`🪛 ${residentSid}`,
		"status label after first turn (file exists) = 🪛 <gardenId>",
	);
	ok(
		!computeResidentStatusLabel({ sessionId: residentSid, sessionFileExists: true }).includes("entwurf"),
		"status label never contains the word 'entwurf'",
	);

	// (T-local-only died with assertLocalOnlyEntwurf — #50 C3: its whole rationale
	// was the local-FS header scan; the record store replaced that lookup and the
	// remote question belongs to #11's own design, not a leftover guard.)

	console.log(`[check-entwurf-session-identity] ${n} assertions ok`);
} finally {
	fs.rmSync(tmp, { recursive: true, force: true });
}
