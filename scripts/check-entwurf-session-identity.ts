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
	buildGardenSessionName,
	assertGardenNativeSessionId,
	computeResidentStatusLabel,
	RESIDENT_SESSION_TAG,
	parseSessionName,
	isEntwurfSessionName,
	findSessionFileById,
	findSessionFilesById,
	assertSessionIdAvailableForSpawn,
	createGardenSessionFile,
	removeUnadoptedGardenSessionFile,
	GARDEN_SESSION_FILE_VERSION,
	readSessionHeader,
	readSessionIdentity,
	analyzeSessionFileLike,
	assertLocalOnlyEntwurf,
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

	// ---- T-gnew: createGardenSessionFile (the /gnew writer) is fail-closed ----
	// The /gnew in-process birth path pre-creates an EMPTY garden session file that
	// ctx.switchSession() adopts. switchSession→SessionManager.open() reads the
	// header id BEFORE session_start, so a VALID garden header is the only thing
	// keeping the backend/bridge identity off a uuid (setSessionFile silently
	// re-mints a uuid on an empty/invalid header). Lock the writer's guarantees.
	const gnewCwd = "/home/fake/gnew";
	const gnewDir = path.join(sessionsBase, "--home-fake-gnew--");
	const fixedNow = new Date(2026, 5, 4, 9, 30, 0);

	// happy path: header is exactly {type:session, version:3, id:<garden>, cwd}
	const gnew1 = createGardenSessionFile({ cwd: gnewCwd, sessionDir: gnewDir, now: fixedNow });
	ok(isValidSessionId(gnew1.sessionId), "gnew: created id is garden-native");
	ok(fs.existsSync(gnew1.sessionFile), "gnew: session file written");
	ok(gnew1.sessionFile.endsWith(`_${gnew1.sessionId}.jsonl`), "gnew: filename carries the garden id (pi convention)");
	eq(path.dirname(gnew1.sessionFile), gnewDir, "gnew: file lands in the live sessionDir (not recomputed from cwd)");
	const gnew1Header = JSON.parse(fs.readFileSync(gnew1.sessionFile, "utf8").split("\n", 1)[0] ?? "{}");
	eq(gnew1Header.type, "session", "gnew: header type is session");
	eq(gnew1Header.version, GARDEN_SESSION_FILE_VERSION, "gnew: header version pinned to pi CURRENT_SESSION_VERSION");
	eq(gnew1Header.id, gnew1.sessionId, "gnew: header id IS the garden id (no uuid)");
	eq(gnew1Header.cwd, gnewCwd, "gnew: header cwd recorded");
	eq(gnew1Header.timestamp, fixedNow.toISOString(), "gnew: header timestamp recorded (read-back asserts it)");
	eq(readSessionHeader(gnew1.sessionFile)?.id, gnew1.sessionId, "gnew: readSessionHeader resolves the garden id");
	// the file must be header-ONLY (an empty session switchSession can adopt cleanly)
	eq(
		fs
			.readFileSync(gnew1.sessionFile, "utf8")
			.split("\n")
			.filter((l) => l.trim()).length,
		1,
		"gnew: file is header-only (empty session)",
	);
	// discoverable as itself; never a uuid anywhere
	eq(findSessionFileById(gnew1.sessionId), gnew1.sessionFile, "gnew: header-scan discovery finds the new session");

	// collision: an id already on disk is refused (would APPEND, not create) and
	// must NOT fall back to a uuid — the writer throws and writes nothing new.
	const beforeCollision = findSessionFilesById(gnew1.sessionId).length;
	throws(
		() => createGardenSessionFile({ cwd: gnewCwd, sessionDir: gnewDir, sessionId: gnew1.sessionId, now: fixedNow }),
		"gnew: collision (existing id) refused — no uuid fallback",
	);
	eq(findSessionFilesById(gnew1.sessionId).length, beforeCollision, "gnew: collision left no extra file");

	// wx: a different header already at the EXACT target path is refused too (the
	// in-flight same-ms collision the header scan can miss). Pre-place a foreign
	// header at the deterministic path, then a same-(id,now) call must throw EEXIST.
	const wxId = "20260604T093000-abcd12";
	const wxNow = new Date(2026, 5, 4, 9, 30, 0);
	const wxPath = path.join(gnewDir, `${wxNow.toISOString().replace(/[:.]/g, "-")}_${wxId}.jsonl`);
	fs.writeFileSync(wxPath, `${JSON.stringify({ type: "session", id: "20260604T093000-ffffff", cwd: "/x" })}\n`);
	throws(
		() => createGardenSessionFile({ cwd: gnewCwd, sessionDir: gnewDir, sessionId: wxId, now: wxNow }),
		"gnew: wx refuses to overwrite a pre-existing file at the target path",
	);
	// the foreign file is untouched (header id unchanged) — writer never clobbered it
	eq(readSessionHeader(wxPath)?.id, "20260604T093000-ffffff", "gnew: wx-refused write left the existing file intact");

	// invalid inputs are refused (crash-don't-warn)
	throws(
		() => createGardenSessionFile({ cwd: "relative/path", sessionDir: gnewDir }),
		"gnew: non-absolute cwd refused",
	);
	throws(() => createGardenSessionFile({ cwd: gnewCwd, sessionDir: "" }), "gnew: empty sessionDir refused");
	throws(
		() => createGardenSessionFile({ cwd: gnewCwd, sessionDir: "relative/sessions" }),
		"gnew: non-absolute sessionDir refused",
	);
	throws(
		() => createGardenSessionFile({ cwd: gnewCwd, sessionDir: gnewDir, sessionId: "not-a-garden-id" }),
		"gnew: invalid sessionId refused",
	);

	// ---- T-gnew-cleanup: removeUnadoptedGardenSessionFile is guarded ----
	// header-only + matching id → removed (orphan from a cancelled/failed switch)
	const orphan = createGardenSessionFile({ cwd: gnewCwd, sessionDir: gnewDir, now: new Date(2026, 5, 4, 9, 31, 0) });
	removeUnadoptedGardenSessionFile(orphan.sessionFile, orphan.sessionId);
	ok(!fs.existsSync(orphan.sessionFile), "gnew-cleanup: header-only orphan with matching id removed");

	// gained a second entry (adopted/active session) → NOT removed
	const adopted = createGardenSessionFile({ cwd: gnewCwd, sessionDir: gnewDir, now: new Date(2026, 5, 4, 9, 32, 0) });
	fs.appendFileSync(adopted.sessionFile, `${JSON.stringify({ type: "user_message" })}\n`);
	removeUnadoptedGardenSessionFile(adopted.sessionFile, adopted.sessionId);
	ok(
		fs.existsSync(adopted.sessionFile),
		"gnew-cleanup: a session with entries is kept (never delete an active session)",
	);

	// header id differs from the expected id → NOT removed (not ours / re-minted)
	const foreign = createGardenSessionFile({ cwd: gnewCwd, sessionDir: gnewDir, now: new Date(2026, 5, 4, 9, 33, 0) });
	removeUnadoptedGardenSessionFile(foreign.sessionFile, "20260604T093300-000000");
	ok(fs.existsSync(foreign.sessionFile), "gnew-cleanup: file with a different header id is left untouched");

	// ---- analyzeSessionFileLike: streamed, bounded, semantics preserved ----
	const msg = (m: Record<string, unknown>) =>
		`${JSON.stringify({ type: "message", message: { role: "assistant", ...m } })}\n`;
	const analyzeFile = path.join(dir, "analyze-semantics.jsonl");
	fs.writeFileSync(
		analyzeFile,
		`${JSON.stringify({ type: "session", id: "20260603T210000-aaaaaa", cwd: "/a" })}\n` +
			`${JSON.stringify({ type: "message", message: { role: "user", content: "hi" } })}\n` + // non-assistant: not counted
			msg({ content: "first", model: "m1", provider: "p1", stopReason: "end_turn", usage: { cost: { total: 0.01 } } }) +
			"{ this is not valid json\n" + // malformed: skipped
			msg({
				content: "second",
				model: "claude-opus-4-8",
				provider: "pi-shell-acp",
				stopReason: "tool_use",
				errorMessage: "oops",
				usage: { cost: { total: 0.02 } },
			}),
	);
	const a1 = analyzeSessionFileLike(analyzeFile);
	eq(a1.turns, 2, "analyze: only assistant turns counted (user + malformed skipped)");
	eq(a1.lastAssistantText, "second", "analyze: last-wins assistant text");
	eq(a1.lastModel, "claude-opus-4-8", "analyze: last-wins model");
	eq(a1.lastProvider, "pi-shell-acp", "analyze: last-wins provider");
	eq(a1.lastStopReason, "tool_use", "analyze: last-wins stopReason");
	eq(a1.lastError, "oops", "analyze: last error captured");
	eq(Math.round(a1.cost * 100) / 100, 0.03, "analyze: cost accumulated");

	// bounded streaming: a single line > chunk size (incl. multibyte) spanning
	// several reads must reassemble correctly and not corrupt the trailing turn.
	const bigBody = `한${"a".repeat(300 * 1024)}글`; // > 64KB chunk, multibyte at both ends
	const bigFile = path.join(dir, "analyze-big.jsonl");
	fs.writeFileSync(
		bigFile,
		`${JSON.stringify({ type: "session", id: "20260603T210000-bbbbbb", cwd: "/b" })}\n` +
			msg({ content: bigBody, model: "m-big", provider: "p-big", usage: { cost: { total: 1 } } }) +
			msg({ content: "final", model: "claude-sonnet-4-6", provider: "pi-shell-acp", usage: { cost: { total: 0.5 } } }),
	);
	const a2 = analyzeSessionFileLike(bigFile);
	eq(a2.turns, 2, "analyze(big): turns correct across chunk boundaries");
	eq(a2.lastAssistantText, "final", "analyze(big): trailing turn intact after multi-chunk line");
	eq(a2.lastModel, "claude-sonnet-4-6", "analyze(big): trailing model intact");
	eq(Math.round(a2.cost * 100) / 100, 1.5, "analyze(big): cost summed across large line");

	// ---- T-identity: resume identity authority = FIRST model_change ----
	// (NEXT.md "Authority separation": model authority is the first model_change,
	// NOT the last assistant message's model. Drift / corrupt name mirror fail-fast.)
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
			msg({ content: "drifted", model: "claude-opus-4-8", provider: "pi-shell-acp" }),
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
		sessionLine(idB, "/identity/b") + mc("pi-shell-acp", "claude-opus-4-8") + mc("openai-codex", "gpt-5.5"),
	);
	throws(() => readSessionIdentity(fileB), "identity: later model_change drift → fail-fast");

	// 3. session name provider/model mirror disagrees with first model_change → corrupt.
	const idC = "20260603T220000-3333cc";
	const fileC = path.join(idDir, `2026-06-03T22-00-00-000Z_${idC}.jsonl`);
	const mismatchName = buildSessionName({
		sessionId: idC,
		provider: "pi-shell-acp",
		model: "claude-opus-4-8",
		rawTitle: "x",
		tags: ["entwurf"],
	});
	fs.writeFileSync(fileC, sessionLine(idC, "/identity/c") + mc("openai-codex", "gpt-5.5") + infoLine(mismatchName));
	throws(() => readSessionIdentity(fileC), "identity: name provider/model mirror mismatch → fail-fast");

	// 4. session name sessionId mirror disagrees with header id → corrupt.
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
	throws(() => readSessionIdentity(fileD), "identity: name sessionId mirror mismatch → fail-fast");

	// 5. clean session (matching name + single model_change) → identity, no throw.
	const idE = "20260603T220000-5555ee";
	const fileE = path.join(idDir, `2026-06-03T22-00-00-000Z_${idE}.jsonl`);
	const cleanName = buildSessionName({
		sessionId: idE,
		provider: "pi-shell-acp",
		model: "claude-sonnet-4-6",
		rawTitle: "clean resume",
		tags: ["entwurf", "async"],
	});
	fs.writeFileSync(
		fileE,
		sessionLine(idE, "/identity/e") +
			mc("pi-shell-acp", "claude-sonnet-4-6") +
			infoLine(cleanName) +
			msg({ content: "ok", model: "claude-sonnet-4-6", provider: "pi-shell-acp" }),
	);
	noThrow(() => readSessionIdentity(fileE), "identity: clean session does not throw");
	const recE = readSessionIdentity(fileE);
	eq(recE?.provider, "pi-shell-acp", "identity(clean): provider");
	eq(recE?.modelId, "claude-sonnet-4-6", "identity(clean): modelId mirrors name");

	// 6. no model_change → null (caller refuses with its own no-recorded-model result).
	const idF = "20260603T220000-6666ff";
	const fileF = path.join(idDir, `2026-06-03T22-00-00-000Z_${idF}.jsonl`);
	fs.writeFileSync(
		fileF,
		sessionLine(idF, "/identity/f") + msg({ content: "no model_change", model: "x", provider: "y" }),
	);
	eq(readSessionIdentity(fileF), null, "identity: no model_change → null");

	// ---- T-require-entwurf: resume path only accepts genuine Entwurf sessions ----
	// (locked 0.9.0 rule: entwurf 여부 = name tag 중 'entwurf' 존재; no compatibility.)
	// G1. model_change but NO session_info name → not an Entwurf session.
	throws(
		() => readSessionIdentity(fileA, { requireEntwurf: true }),
		"requireEntwurf: no session_info name → fail-fast",
	);

	// G2. session_info name present but non-canonical → not an Entwurf session.
	const idG = "20260603T230000-7777aa";
	const fileG = path.join(idDir, `2026-06-03T23-00-00-000Z_${idG}.jsonl`);
	fs.writeFileSync(
		fileG,
		sessionLine(idG, "/identity/g") + mc("pi-shell-acp", "claude-opus-4-8") + infoLine("not a canonical name"),
	);
	throws(
		() => readSessionIdentity(fileG, { requireEntwurf: true }),
		"requireEntwurf: non-canonical session name → fail-fast",
	);
	noThrow(() => readSessionIdentity(fileG), "requireEntwurf off: non-canonical name is ignored (general path)");

	// G3. canonical name that MIRRORS correctly but has NO entwurf tag → general pi session.
	const idH = "20260603T230000-8888bb";
	const fileH = path.join(idDir, `2026-06-03T23-00-00-000Z_${idH}.jsonl`);
	const noTagName = buildSessionName({
		sessionId: idH,
		provider: "pi-shell-acp",
		model: "claude-opus-4-8",
		rawTitle: "general session",
		tags: [],
	});
	fs.writeFileSync(
		fileH,
		sessionLine(idH, "/identity/h") + mc("pi-shell-acp", "claude-opus-4-8") + infoLine(noTagName),
	);
	throws(
		() => readSessionIdentity(fileH, { requireEntwurf: true }),
		"requireEntwurf: canonical name without 'entwurf' tag → fail-fast",
	);
	noThrow(() => readSessionIdentity(fileH), "requireEntwurf off: no-tag canonical name passes (general path)");

	// G4. canonical name WITH the entwurf tag (fileE from above) → accepted.
	noThrow(
		() => readSessionIdentity(fileE, { requireEntwurf: true }),
		"requireEntwurf: canonical __entwurf name → accepted",
	);
	eq(
		readSessionIdentity(fileE, { requireEntwurf: true })?.modelId,
		"claude-sonnet-4-6",
		"requireEntwurf: accepted Entwurf session returns first-model_change identity",
	);

	// ========================================================================
	// T-resident: top-level --entwurf-control garden session (0.9.0)
	//   - assertGardenNativeSessionId: uuid → throw, garden → pass (immediate
	//     enforcement; uuidv7 from a raw launch has no back-compat path).
	//   - buildGardenSessionName: registry-FREE (native deepseek passes where
	//     buildSessionName would throw); `entwurf` tag FORBIDDEN; round-trips.
	//   - computeResidentStatusLabel: 🪛 ready before file, 🪛 <id> after.
	//   - resident `control` name must NOT be resumable as an Entwurf child.
	// ========================================================================

	// assertGardenNativeSessionId — the immediate-enforcement guard core.
	noThrow(() => assertGardenNativeSessionId("20260604T083632-f9c3b3"), "garden id passes the resident guard");
	throws(
		() => assertGardenNativeSessionId("019e8faa-04ea-7b73-bf2c-1465d525c2e8"),
		"uuidv7 id rejected by resident guard (no back-compat)",
	);
	throws(() => assertGardenNativeSessionId(undefined), "missing id rejected by resident guard");
	throws(() => assertGardenNativeSessionId("20260604T083632-f9c3"), "short-suffix id rejected by resident guard");

	const residentSid = "20260604T083632-aa11bb";

	// buildGardenSessionName is registry-FREE: a native model absent from the
	// Entwurf target registry (deepseek/deepseek-v4-pro) must pass here, while the
	// child builder buildSessionName refuses it.
	throws(
		() => buildSessionName({ sessionId: residentSid, provider: "deepseek", model: "deepseek-v4-pro" }),
		"buildSessionName (child) refuses a non-registry native model",
	);
	noThrow(
		() =>
			buildGardenSessionName({
				sessionId: residentSid,
				provider: "deepseek",
				model: "deepseek-v4-pro",
				rawTitle: "home",
				tags: [RESIDENT_SESSION_TAG],
			}),
		"buildGardenSessionName accepts a non-registry native model",
	);

	const residentName = buildGardenSessionName({
		sessionId: residentSid,
		provider: "deepseek",
		model: "deepseek-v4-pro",
		rawTitle: "pi-shell-acp",
		tags: [RESIDENT_SESSION_TAG],
	});
	eq(residentName, `${residentSid}==deepseek/deepseek-v4-pro--pi-shell-acp__control`, "resident garden name shape");
	const residentParsed = parseSessionName(residentName);
	if (!residentParsed) assert.fail(`resident name did not parse: ${residentName}`);
	eq(residentParsed.provider, "deepseek", "resident name parses provider");
	eq(residentParsed.model, "deepseek-v4-pro", "resident name parses model");
	eq(residentParsed.tags.join(","), "control", "resident name carries the control tag");
	ok(!isEntwurfSessionName(residentName), "resident control name is NOT an Entwurf session name");

	// The `entwurf` tag is FORBIDDEN on a resident name — that tag is the
	// entwurf_resume marker; a resident session must never be resumable as a child.
	throws(
		() =>
			buildGardenSessionName({
				sessionId: residentSid,
				provider: "deepseek",
				model: "deepseek-v4-pro",
				tags: ["entwurf"],
			}),
		"buildGardenSessionName forbids the entwurf tag",
	);

	// Regression guard for the closed blocker: a resident `control` session on
	// disk must be REFUSED by readSessionIdentity(requireEntwurf) — it is not an
	// Entwurf child and entwurf_resume must not open it.
	const fileResident = path.join(tmp, "resident-control.jsonl");
	fs.writeFileSync(
		fileResident,
		sessionLine(residentSid, "/identity/resident") + mc("deepseek", "deepseek-v4-pro") + infoLine(residentName),
	);
	throws(
		() => readSessionIdentity(fileResident, { requireEntwurf: true }),
		"requireEntwurf: resident control session is NOT resumable as an Entwurf child",
	);
	noThrow(
		() => readSessionIdentity(fileResident),
		"general path: resident control session reads fine (registry-free mirror)",
	);

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

	// ---- T-local-only: remote/SSH entwurf is fail-fast in 0.9.0 (#11) ----
	// CHANGELOG/BASELINE classify remote fail-fast as a 0.9.0 breaking change.
	// Lock it so a later remote revival cannot silently re-enable a non-local host
	// (header scan + collision pre-check are local-filesystem only).
	noThrow(() => assertLocalOnlyEntwurf("local"), "local host passes");
	noThrow(() => assertLocalOnlyEntwurf(undefined), "undefined host (defaults local) passes");
	throws(() => assertLocalOnlyEntwurf("oracle"), "non-local host 'oracle' fails fast");
	throws(() => assertLocalOnlyEntwurf("user@host"), "ssh-style host 'user@host' fails fast");

	console.log(`[check-entwurf-session-identity] ${n} assertions ok`);
} finally {
	fs.rmSync(tmp, { recursive: true, force: true });
}
