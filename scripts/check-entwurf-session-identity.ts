/**
 * check-entwurf-session-identity — deterministic gate for the locked garden
 * session identity & name grammar (NEXT.md "Locked — session identity & name
 * grammar"). No backend, no API, no spawn. Pure-string + synthetic-fs.
 *
 * Locks the convention HARD (per GLG: "우리가 잡은 규약은 싹 잡혀야돼"):
 *   - T-grammar    sessionId validator + build/parse round-trip (incl. `.`-bearing
 *                  registry models gpt-5.5 / gemini-3.1-pro-preview).
 *   - T-titleSlug  raw title → canonical slug (sanitize, not reject); `_`/`__`
 *                  destroyed; unicode dropped; empty → untitled.
 *   - T-registry   provider/model is an EXACT registry tuple; invented or dotted
 *                  non-tuples (claude-opus-4.8) are refused.
 *   - T-no-logic   title/tags vary, sessionId stays stable; name is info only.
 *   - T-model-immut name model mirrors recorded model; drift is detectable for
 *                  corrupt-metadata fail-fast.
 *   - T-identity   readSessionIdentity: first model_change is the model authority;
 *                  drift fail-fast; the session NAME is pi's and is never read
 *                  (#50 C3 — the old name-mirror/`requireEntwurf` refusals are
 *                  asserted GONE, not just untested).
 *
 * The header-scan lookup (T-collision), the transcript analyzer, and the remote
 * scope-lock died with the header-scan world (#50 C3) — the meta-record resolves
 * a garden id to its transcript now (see check-entwurf-v2-spawn-production §9).
 *
 * Registry + sessions base are isolated to a temp dir BEFORE the module computes
 * its load-time paths, so the real ~/.pi/agent is never touched.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// Isolate env BEFORE importing the module (entwurf-core computes AGENT_DIR /
// ENTWURF_TARGETS_PATH at module load). Dynamic import after the env is set.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "psa-session-identity-"));
process.env.PI_CODING_AGENT_DIR = tmp;
process.env.ENTWURF_TARGETS_PATH = path.join(REPO_ROOT, "pi", "entwurf-targets.json");

const {
	isValidSessionId,
	generateSessionId,
	formatSessionTimestamp,
	slugifyTitle,
	isKnownProviderModel,
	buildSessionName,
	computeResidentStatusLabel,
	parseSessionName,
	isEntwurfSessionName,
	readSessionIdentity,
} = await import("../pi-extensions/lib/entwurf-core.ts");

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

	// ---- T-titleSlug ----
	eq(slugifyTitle("Review substrate smoke / --name 검증"), "review-substrate-smoke-name", "GPT slug example");
	eq(slugifyTitle("a__b"), "a-b", "double underscore → single hyphen");
	eq(slugifyTitle("Hello_World"), "hello-world", "underscore → hyphen, lowercased");
	eq(slugifyTitle("  ...!!!  "), "untitled", "punctuation-only → untitled");
	eq(slugifyTitle(""), "untitled", "empty → untitled");
	eq(slugifyTitle(undefined), "untitled", "undefined → untitled");
	eq(slugifyTitle("검증만"), "untitled", "all-unicode → untitled");
	eq(slugifyTitle("-leading-and-trailing-"), "leading-and-trailing", "trim hyphens");
	ok(!slugifyTitle("any__thing_here").includes("_"), "slug never contains underscore");

	// ---- T-registry: exact tuple, no regex invention ----
	ok(isKnownProviderModel("entwurf", "claude-opus-4-8"), "known opus tuple");
	ok(isKnownProviderModel("openai-codex", "gpt-5.5"), "known dotted tuple (gpt-5.5)");
	ok(isKnownProviderModel("entwurf", "gemini-3.1-pro-preview"), "known dotted+hyphen tuple");
	ok(!isKnownProviderModel("entwurf", "claude-opus-4.8"), "dotted opus is NOT a tuple (hyphen canonical)");
	ok(!isKnownProviderModel("entwurf", "claude-opus-9-9"), "invented model rejected");
	ok(!isKnownProviderModel("totally", "made-up"), "invented provider rejected");

	// ---- T-grammar: build/parse round-trip ----
	const cases = [
		{ p: "entwurf", m: "claude-opus-4-8", title: "Review substrate smoke", tags: ["entwurf", "review"] },
		{ p: "openai-codex", m: "gpt-5.5", title: "async resume check", tags: ["entwurf", "smoke"] },
		{ p: "entwurf", m: "gemini-3.1-pro-preview", title: "vision team", tags: ["entwurf"] },
		{ p: "entwurf", m: "claude-sonnet-5", title: "manual session", tags: [] as string[] },
	];
	for (const c of cases) {
		const sid = generateSessionId(new Date(2026, 5, 3, 19, 12, 45));
		const name = buildSessionName({ sessionId: sid, provider: c.p, model: c.m, rawTitle: c.title, tags: c.tags });
		const parsed = parseSessionName(name);
		if (!parsed) assert.fail(`parse failed: ${name}`);
		eq(parsed.sessionId, sid, `round-trip sessionId (${c.m})`);
		eq(parsed.provider, c.p, `round-trip provider (${c.m})`);
		eq(parsed.model, c.m, `round-trip model survives (${c.m})`);
		eq(parsed.titleSlug, slugifyTitle(c.title), `round-trip titleSlug (${c.m})`);
		assert.deepEqual(parsed.tags, c.tags, `round-trip tags (${c.m})`);
		n++;
		eq(isEntwurfSessionName(name), c.tags.includes("entwurf"), `entwurf-tag detection (${c.m})`);
	}

	// concrete canonical example pinned to NEXT.md
	eq(
		buildSessionName({
			sessionId: "20260603T191245-a3f09c",
			provider: "entwurf",
			model: "claude-opus-4-8",
			rawTitle: "Review substrate smoke",
			tags: ["entwurf", "review"],
		}),
		"20260603T191245-a3f09c==entwurf/claude-opus-4-8--review-substrate-smoke__entwurf_review",
		"canonical NEXT.md example",
	);

	// ---- builder fail-fast (corrupt metadata never reaches --name) ----
	throws(
		() => buildSessionName({ sessionId: "bad", provider: "entwurf", model: "claude-opus-4-8" }),
		"invalid sessionId",
	);
	throws(
		() => buildSessionName({ sessionId: "20260603T191245-a3f09c", provider: "entwurf", model: "invented-9" }),
		"unknown tuple",
	);
	throws(
		() => buildSessionName({ sessionId: "20260603T191245-a3f09c", provider: "entwurf", model: "claude-opus-4.8" }),
		"dotted opus (non-tuple)",
	);
	throws(
		() =>
			buildSessionName({
				sessionId: "20260603T191245-a3f09c",
				provider: "entwurf",
				model: "claude-opus-4-8",
				tags: ["Bad_Tag"],
			}),
		"invalid tag charset",
	);
	throws(
		() =>
			buildSessionName({
				sessionId: "20260603T191245-a3f09c",
				provider: "entwurf",
				model: "claude-opus-4-8",
				tags: ["UPPER"],
			}),
		"uppercase tag",
	);

	// ---- parser negatives ----
	eq(parseSessionName("no-separators-here"), null, "no == → null");
	eq(parseSessionName("20260603T191245-a3f09c==entwurf/claude-opus-4-8"), null, "no -- (no title) → null");
	eq(parseSessionName("badid==entwurf/claude-opus-4-8--title"), null, "bad sessionId → null");
	eq(parseSessionName("20260603T191245-a3f09c==noslash--title"), null, "no / → null");
	eq(parseSessionName("20260603T191245-a3f09c==p/m--title__Bad"), null, "bad tag charset → null");
	// canonical-only titleSlug: non-slug titles must not parse (the builder could
	// never emit them, so accepting them would break the build↔parse contract).
	eq(
		parseSessionName("20260603T191245-a3f09c==entwurf/claude-opus-4-8--Bad Title__entwurf"),
		null,
		"space/uppercase title → null",
	);
	eq(parseSessionName("20260603T191245-a3f09c==entwurf/claude-opus-4-8--검증__entwurf"), null, "unicode title → null");
	eq(
		parseSessionName("20260603T191245-a3f09c==entwurf/claude-opus-4-8--a__b__entwurf"),
		null,
		"raw __ delimiter smuggle → null",
	);
	eq(
		parseSessionName("20260603T191245-a3f09c==entwurf/claude-opus-4-8---leading__entwurf"),
		null,
		"leading-hyphen title → null",
	);

	// ---- T-no-logic: title/tags vary, sessionId stable ----
	const sid2 = "20260603T191245-deadbe";
	const nameA = buildSessionName({
		sessionId: sid2,
		provider: "entwurf",
		model: "claude-opus-4-8",
		rawTitle: "first title",
		tags: ["entwurf"],
	});
	const nameB = buildSessionName({
		sessionId: sid2,
		provider: "entwurf",
		model: "claude-opus-4-8",
		rawTitle: "COMPLETELY different / 다른 제목",
		tags: ["entwurf", "phase1", "review"],
	});
	const pA = parseSessionName(nameA);
	const pB = parseSessionName(nameB);
	if (!pA || !pB) assert.fail("no-logic parse failed");
	eq(pA.sessionId, pB.sessionId, "sessionId stable across title/tag change");
	ok(nameA !== nameB, "names differ but identity is the same");

	// ---- T-model-immut: name model is an integrity mirror ----
	const recorded = "claude-opus-4-8";
	const goodName = buildSessionName({
		sessionId: sid2,
		provider: "entwurf",
		model: recorded,
		rawTitle: "x",
		tags: ["entwurf"],
	});
	eq(parseSessionName(goodName)?.model, recorded, "name model mirrors recorded model");
	const driftName = "20260603T191245-deadbe==entwurf/claude-sonnet-5--x__entwurf";
	ok(parseSessionName(driftName)?.model !== recorded, "model drift is detectable for fail-fast");

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
	const mismatchName = buildSessionName({
		sessionId: idC,
		provider: "entwurf",
		model: "claude-opus-4-8",
		rawTitle: "x",
		tags: ["entwurf"],
	});
	fs.writeFileSync(fileC, sessionLine(idC, "/identity/c") + mc("openai-codex", "gpt-5.5") + infoLine(mismatchName));
	noThrow(() => readSessionIdentity(fileC), "identity: name provider/model disagreement is pi's business — no throw");
	eq(readSessionIdentity(fileC)?.modelId, "gpt-5.5", "identity: model still resolves from first model_change");

	// 4. same for a name carrying a different sessionId than the header: the name
	//    is display/search metadata owned by pi; entwurf reads only header + model_change.
	const idD = "20260603T220000-4444dd";
	const fileD = path.join(idDir, `2026-06-03T22-00-00-000Z_${idD}.jsonl`);
	const wrongIdName = buildSessionName({
		sessionId: "20260603T220000-9999ff",
		provider: "openai-codex",
		model: "gpt-5.5",
		rawTitle: "x",
		tags: ["entwurf"],
	});
	fs.writeFileSync(fileD, sessionLine(idD, "/identity/d") + mc("openai-codex", "gpt-5.5") + infoLine(wrongIdName));
	noThrow(() => readSessionIdentity(fileD), "identity: name sessionId disagreement is pi's business — no throw");
	eq(readSessionIdentity(fileD)?.sessionId, idD, "identity: sessionId resolves from the header, never the name");

	// 5. clean session (matching name + single model_change) → identity, no throw.
	const idE = "20260603T220000-5555ee";
	const fileE = path.join(idDir, `2026-06-03T22-00-00-000Z_${idE}.jsonl`);
	const cleanName = buildSessionName({
		sessionId: idE,
		provider: "entwurf",
		model: "claude-sonnet-5",
		rawTitle: "clean resume",
		tags: ["entwurf", "async"],
	});
	fs.writeFileSync(
		fileE,
		sessionLine(idE, "/identity/e") +
			mc("entwurf", "claude-sonnet-5") +
			infoLine(cleanName) +
			msg({ content: "ok", model: "claude-sonnet-5", provider: "entwurf" }),
	);
	noThrow(() => readSessionIdentity(fileE), "identity: clean session does not throw");
	const recE = readSessionIdentity(fileE);
	eq(recE?.provider, "entwurf", "identity(clean): provider");
	eq(recE?.modelId, "claude-sonnet-5", "identity(clean): modelId mirrors name");

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
