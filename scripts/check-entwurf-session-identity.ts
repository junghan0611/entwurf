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
 *   - T-collision  header-scan lookup is the authority (filename glob is only an
 *                  index); spawn pre-check throws on a duplicate header id in ANY
 *                  cwd dir (the wrong-cwd footgun).
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
process.env.PI_ENTWURF_TARGETS_PATH = path.join(REPO_ROOT, "pi", "entwurf-targets.json");

const {
	isValidSessionId,
	generateSessionId,
	formatSessionTimestamp,
	slugifyTitle,
	isKnownProviderModel,
	buildSessionName,
	parseSessionName,
	isEntwurfSessionName,
	findSessionFileById,
	findSessionFilesById,
	assertSessionIdAvailableForSpawn,
	readSessionHeader,
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
	ok(isKnownProviderModel("pi-shell-acp", "claude-opus-4-8"), "known opus tuple");
	ok(isKnownProviderModel("openai-codex", "gpt-5.5"), "known dotted tuple (gpt-5.5)");
	ok(isKnownProviderModel("pi-shell-acp", "gemini-3.1-pro-preview"), "known dotted+hyphen tuple");
	ok(!isKnownProviderModel("pi-shell-acp", "claude-opus-4.8"), "dotted opus is NOT a tuple (hyphen canonical)");
	ok(!isKnownProviderModel("pi-shell-acp", "claude-opus-9-9"), "invented model rejected");
	ok(!isKnownProviderModel("totally", "made-up"), "invented provider rejected");

	// ---- T-grammar: build/parse round-trip ----
	const cases = [
		{ p: "pi-shell-acp", m: "claude-opus-4-8", title: "Review substrate smoke", tags: ["entwurf", "review"] },
		{ p: "openai-codex", m: "gpt-5.5", title: "async resume check", tags: ["entwurf", "smoke"] },
		{ p: "pi-shell-acp", m: "gemini-3.1-pro-preview", title: "vision team", tags: ["entwurf"] },
		{ p: "pi-shell-acp", m: "claude-sonnet-4-6", title: "manual session", tags: [] as string[] },
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
			provider: "pi-shell-acp",
			model: "claude-opus-4-8",
			rawTitle: "Review substrate smoke",
			tags: ["entwurf", "review"],
		}),
		"20260603T191245-a3f09c==pi-shell-acp/claude-opus-4-8--review-substrate-smoke__entwurf_review",
		"canonical NEXT.md example",
	);

	// ---- builder fail-fast (corrupt metadata never reaches --name) ----
	throws(
		() => buildSessionName({ sessionId: "bad", provider: "pi-shell-acp", model: "claude-opus-4-8" }),
		"invalid sessionId",
	);
	throws(
		() => buildSessionName({ sessionId: "20260603T191245-a3f09c", provider: "pi-shell-acp", model: "invented-9" }),
		"unknown tuple",
	);
	throws(
		() => buildSessionName({ sessionId: "20260603T191245-a3f09c", provider: "pi-shell-acp", model: "claude-opus-4.8" }),
		"dotted opus (non-tuple)",
	);
	throws(
		() =>
			buildSessionName({
				sessionId: "20260603T191245-a3f09c",
				provider: "pi-shell-acp",
				model: "claude-opus-4-8",
				tags: ["Bad_Tag"],
			}),
		"invalid tag charset",
	);
	throws(
		() =>
			buildSessionName({
				sessionId: "20260603T191245-a3f09c",
				provider: "pi-shell-acp",
				model: "claude-opus-4-8",
				tags: ["UPPER"],
			}),
		"uppercase tag",
	);

	// ---- parser negatives ----
	eq(parseSessionName("no-separators-here"), null, "no == → null");
	eq(parseSessionName("20260603T191245-a3f09c==pi-shell-acp/claude-opus-4-8"), null, "no -- (no title) → null");
	eq(parseSessionName("badid==pi-shell-acp/claude-opus-4-8--title"), null, "bad sessionId → null");
	eq(parseSessionName("20260603T191245-a3f09c==noslash--title"), null, "no / → null");
	eq(parseSessionName("20260603T191245-a3f09c==p/m--title__Bad"), null, "bad tag charset → null");
	// canonical-only titleSlug: non-slug titles must not parse (the builder could
	// never emit them, so accepting them would break the build↔parse contract).
	eq(
		parseSessionName("20260603T191245-a3f09c==pi-shell-acp/claude-opus-4-8--Bad Title__entwurf"),
		null,
		"space/uppercase title → null",
	);
	eq(
		parseSessionName("20260603T191245-a3f09c==pi-shell-acp/claude-opus-4-8--검증__entwurf"),
		null,
		"unicode title → null",
	);
	eq(
		parseSessionName("20260603T191245-a3f09c==pi-shell-acp/claude-opus-4-8--a__b__entwurf"),
		null,
		"raw __ delimiter smuggle → null",
	);
	eq(
		parseSessionName("20260603T191245-a3f09c==pi-shell-acp/claude-opus-4-8---leading__entwurf"),
		null,
		"leading-hyphen title → null",
	);

	// ---- T-no-logic: title/tags vary, sessionId stable ----
	const sid2 = "20260603T191245-deadbe";
	const nameA = buildSessionName({
		sessionId: sid2,
		provider: "pi-shell-acp",
		model: "claude-opus-4-8",
		rawTitle: "first title",
		tags: ["entwurf"],
	});
	const nameB = buildSessionName({
		sessionId: sid2,
		provider: "pi-shell-acp",
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
		provider: "pi-shell-acp",
		model: recorded,
		rawTitle: "x",
		tags: ["entwurf"],
	});
	eq(parseSessionName(goodName)?.model, recorded, "name model mirrors recorded model");
	const driftName = "20260603T191245-deadbe==pi-shell-acp/claude-sonnet-4-6--x__entwurf";
	ok(parseSessionName(driftName)?.model !== recorded, "model drift is detectable for fail-fast");

	// ---- T-collision: header scan is authority; spawn pre-check ----
	const sessionsBase = path.join(tmp, "sessions");
	const dir = path.join(sessionsBase, "--home-fake-cwd--");
	fs.mkdirSync(dir, { recursive: true });
	const existingId = "20260603T200000-abc123";
	const existingFile = path.join(dir, `2026-06-03T11-00-00-000Z_${existingId}.jsonl`);
	fs.writeFileSync(
		existingFile,
		`${JSON.stringify({ type: "session", id: existingId, cwd: "/home/fake/cwd" })}\n${JSON.stringify({ type: "user_message" })}\n`,
	);

	eq(findSessionFileById(existingId), existingFile, "findSessionFileById resolves by header");
	eq(findSessionFileById("20260603T200000-bbbbbb"), null, "unknown (valid, absent) id → null");

	// readSessionHeader must be bounded to the first line. Session transcripts can
	// be multi-MB; header-scan lookup must not read/split the whole JSONL body.
	const largeBodyId = "20260603T200000-b0d1ee";
	const largeBodyFile = path.join(dir, `2026-06-03T11-00-00-000Z_${largeBodyId}.jsonl`);
	fs.writeFileSync(
		largeBodyFile,
		`${JSON.stringify({ type: "session", id: largeBodyId, cwd: "/large" })}\n${"x".repeat(1024 * 1024)}`,
	);
	eq(readSessionHeader(largeBodyFile)?.id, largeBodyId, "readSessionHeader reads header from large transcript prefix");
	eq(findSessionFileById(largeBodyId), largeBodyFile, "large transcript header scan stays bounded and authoritative");

	throws(() => assertSessionIdAvailableForSpawn(existingId), "collision pre-check throws on existing id (any cwd)");
	noThrow(() => assertSessionIdAvailableForSpawn("20260603T200000-fed210"), "fresh id passes pre-check");

	// header is the authority: filename carries the id but header disagrees → no match
	const dir2 = path.join(sessionsBase, "--other-cwd--");
	fs.mkdirSync(dir2, { recursive: true });
	const spoofId = "20260603T200000-5900fa";
	const spoofFile = path.join(dir2, `2026-06-03T11-00-00-000Z_${spoofId}.jsonl`);
	fs.writeFileSync(spoofFile, `${JSON.stringify({ type: "session", id: "20260603T200000-d1ffe7", cwd: "/x" })}\n`);
	eq(findSessionFileById(spoofId), null, "filename match but header mismatch → not found (header authority)");

	// header authority (positive): filename does NOT carry the id, header does → found.
	const headerOnlyId = "20260603T200000-c0ffee";
	const renamedFile = path.join(dir2, "renamed-without-id.jsonl");
	fs.writeFileSync(renamedFile, `${JSON.stringify({ type: "session", id: headerOnlyId, cwd: "/y" })}\n`);
	eq(findSessionFileById(headerOnlyId), renamedFile, "header id found even when filename omits it (header authority)");

	// duplicate header id across two cwd dirs → ambiguous → fail-fast everywhere.
	const dupId = "20260603T200000-dddddd";
	fs.writeFileSync(
		path.join(dir, `2026-06-03T11-00-00-000Z_${dupId}.jsonl`),
		`${JSON.stringify({ type: "session", id: dupId, cwd: "/home/fake/cwd" })}\n`,
	);
	fs.writeFileSync(
		path.join(dir2, `2026-06-03T11-00-00-000Z_${dupId}.jsonl`),
		`${JSON.stringify({ type: "session", id: dupId, cwd: "/x" })}\n`,
	);
	eq(findSessionFilesById(dupId).length, 2, "findSessionFilesById returns all duplicates");
	throws(() => findSessionFileById(dupId), "findSessionFileById throws on ambiguous duplicate");
	throws(() => assertSessionIdAvailableForSpawn(dupId), "spawn pre-check throws on duplicate id");

	console.log(`[check-entwurf-session-identity] ${n} assertions ok`);
} finally {
	fs.rmSync(tmp, { recursive: true, force: true });
}
