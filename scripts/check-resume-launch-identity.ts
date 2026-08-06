/**
 * check-resume-launch-identity — deterministic gate for `resume-launch-identity.ts`, the
 * record-authoritative leaf preserved when the visible-first cut deleted `spawn-bg` and every
 * caller it had.
 *
 * WHY A GATE FOR A CONSUMER-ZERO MODULE. Identity authority is a fail-closed risk class: this
 * leaf's whole job is deciding WHICH being a resume turn lands in. A preserved leaf whose only
 * guarantee is its own header comment is exactly the rot preservation was meant to prevent — it
 * would be re-adopted, months later, by a visible-resume composition that trusts prose. The cells
 * below are transplanted from the deleted `check-entwurf-v2-spawn-production` §9 (the plan
 * parameter became a bare garden id; nothing else about the identity contract changed), plus one
 * new cell for the #52 read the leaf's header claims and the deleted gate never isolated.
 *
 * What is certified, all through a temp `ENTWURF_META_SESSIONS_DIR` fixture store:
 *
 *   1. HAPPY — gardenId → record.transcriptPath → header id === record.nativeSessionId →
 *      LaunchIdentity carrying the header's own cwd/provider/model (#50 C2, #9).
 *   2. C3 INTEGRITY — a transcript whose header id is NOT this citizen's `nativeSessionId` is
 *      refused, never resumed. This is the one that keeps a turn out of another being's session.
 *   3. #52 ADDRESSABLE READ — a garden id that does not hold its `nativeSessionId` ALONE is
 *      refused. Two records sharing one native session would each pass their own per-record
 *      integrity check and resume one transcript twice under two per-garden-id locks, so the
 *      plain targeted read is not enough here and the leaf must not be "simplified" back to it.
 *   4. CAUSE FIDELITY — each impossible resume names ITS OWN cause: absent record, out-of-domain
 *      backend, no recorded transcript, recorded-but-missing file, no model, headerless file. The
 *      missing-file cell is a regression pin: before the existence check that case fell through
 *      `readSessionIdentity`'s ENOENT swallow and lied "no recorded model".
 *   4b. THE ONE EXPECTED REFUSAL — a backend with no same-id resume is not a defect at all: the
 *      record is fine and the operator reached past a capability boundary. It alone carries a
 *      TYPED reason (`target-not-pi`) so the visible-resume composition can match a FIELD instead
 *      of parsing a sentence or re-reading the record. Everything else here stays a bare throw.
 *   4c. ABSOLUTE TRANSCRIPT — a relative recorded path would resolve against the WINDOW's own cwd
 *      at launch, not against this process's, so it names a different file than the one checked
 *      here. Refused before anything opens.
 *   5. SSOT — the module header names THIS gate, so the preserved leaf cannot advertise a
 *      certification that does not exist.
 *
 * No spawn, no socket, no timer: the launch this identity feeds is deliberately not in scope.
 */

import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { serializeMetaIdentity, upsertMetaSession } from "../pi-extensions/lib/meta-session.ts";
import {
	ResumeBackendUnsupportedError,
	resolveResumeLaunchIdentity,
} from "../pi-extensions/lib/resume-launch-identity.ts";

let passed = 0;
function ok(label: string, cond: boolean): void {
	assert.ok(cond, label);
	console.log(`  ok    ${label}`);
	passed++;
}

const HERE = path.dirname(new URL(import.meta.url).pathname);
const REPO = path.join(HERE, "..");
const LEAF_SRC = path.join(REPO, "pi-extensions/lib/resume-launch-identity.ts");

function main(): void {
	const world = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "resume-launch-id-"));
	const storeDir = path.join(world, "meta-sessions");
	fs.mkdirSync(storeDir, { recursive: true });
	const prevStore = process.env.ENTWURF_META_SESSIONS_DIR;
	process.env.ENTWURF_META_SESSIONS_DIR = storeDir;
	try {
		const cwd = path.join(world, "repo");
		fs.mkdirSync(cwd, { recursive: true });
		const sessionLine = (id: string) => `${JSON.stringify({ type: "session", id, cwd })}\n`;
		const modelLine = `${JSON.stringify({ type: "model_change", provider: "openai-codex", modelId: "gpt-5.4" })}\n`;
		const writeTranscript = (name: string, content: string): string => {
			const p = path.join(world, name);
			fs.writeFileSync(p, content);
			return p;
		};
		const mintRecord = (nativeSessionId: string, transcriptPath: string | null, backend = "pi"): string =>
			upsertMetaSession({
				input: { backend: backend as "pi", nativeSessionId, cwd, model: "gpt-5.4", transcriptPath },
				dir: storeDir,
			}).record.gardenId;
		const rejects = (gid: string, needle: string, label: string): void => {
			let msg = "";
			try {
				resolveResumeLaunchIdentity(gid);
			} catch (e) {
				msg = e instanceof Error ? e.message : String(e);
			}
			ok(label, msg.includes(needle));
		};

		// ── 1. HAPPY ──────────────────────────────────────────────────────────────
		const nativeOk = "0199aaaa-1111-4222-8333-444455556666";
		const fileOk = writeTranscript("own.jsonl", sessionLine(nativeOk) + modelLine);
		const gidOk = mintRecord(nativeOk, fileOk);
		const launch = resolveResumeLaunchIdentity(gidOk);
		ok("1: record-backed resume resolves the recorded transcript", launch.sessionFile === fileOk);
		ok("1: resume cwd = transcript header authority (#9 cold-resume)", launch.cwd === cwd);
		ok(
			"1: resume model/provider = first model_change",
			launch.model === "gpt-5.4" && launch.provider === "openai-codex",
		);
		// (No arity/shape assertion here on purpose: "the garden id is the only input" is carried
		// by the type system and by every cell below actually resolving through the record.
		// A `fn.length === 1` check would be a claim whose mutant could only be synthetic.)

		// ── 2. C3 INTEGRITY — header id must be THIS citizen's ────────────────────
		const nativeMine = "0199bbbb-1111-4222-8333-444455556666";
		const foreignFile = writeTranscript(
			"foreign.jsonl",
			sessionLine("0199cccc-9999-4999-8999-999999999999") + modelLine,
		);
		const gidForeign = mintRecord(nativeMine, foreignFile);
		rejects(
			gidForeign,
			"does not match the record's nativeSessionId",
			"2: header ≠ nativeSessionId → refused, never resumed (C3) [QK:RESUME-ID-HEADER-INTEGRITY]",
		);

		// ── 4. CAUSE FIDELITY ─────────────────────────────────────────────────────
		rejects("20260101T000000-facade", "not a garden citizen", "4: recordless gid → not a citizen");

		const gidClaude = mintRecord("claude-native-1", null, "claude-code");
		rejects(
			gidClaude,
			"is a claude-code citizen",
			"4: out-of-domain citizen → refused as a capability-domain miss, not as citizen rank",
		);
		// This one refusal is EXPECTED, not a defect: the record is perfectly good and the operator
		// has reached past a capability boundary. So it is the only failure here that carries a
		// typed `reason` a caller can match on a FIELD — the visible-resume composition turns it
		// into `target-not-pi`, and if it degraded to a bare Error that caller would either parse
		// this sentence or read the record a second time to ask which backend it was.
		{
			let caught: Error | null = null;
			try {
				resolveResumeLaunchIdentity(gidClaude);
			} catch (err) {
				caught = err as Error;
			}
			ok(
				"4: the backend miss is a TYPED refusal carrying reason + backend, not a bare Error [QK:RESUME-ID-BACKEND-TYPED-REFUSAL]",
				caught instanceof ResumeBackendUnsupportedError &&
					caught.reason === "target-not-pi" &&
					caught.backend === "claude-code",
			);
		}

		// A RELATIVE recorded path passes existsSync here whenever this process happens to sit in
		// the right directory, but the launch resolves `--session` inside the window's own
		// `-c <record cwd>`. Two directories, two files, one receipt that looks correct — so the
		// leaf refuses before anything opens rather than resuming an unknown transcript.
		{
			const nativeRel = "0199ffff-1111-4222-8333-444455556666";
			writeTranscript("relative.jsonl", sessionLine(nativeRel) + modelLine);
			const gidRel = mintRecord(nativeRel, "relative.jsonl");
			rejects(
				gidRel,
				"RELATIVE transcriptPath",
				"4: a relative recorded transcriptPath → refused before launch, because --session would resolve against the WINDOW's cwd, not this one [QK:RESUME-ID-SESSION-ABSOLUTE]",
			);
		}

		const gidNoFile = mintRecord("0199dddd-1111-4222-8333-444455556666", null);
		rejects(gidNoFile, "no recorded transcriptPath", "4: transcriptPath null → nothing to resume");

		// Regression pin (F7): before the existsSync guard this fell through readSessionIdentity's
		// ENOENT swallow and reported "no recorded model" — a true refusal naming a false cause,
		// which sends an operator to look for a model setting instead of a deleted transcript.
		const gidGhost = mintRecord("0199abcd-1111-4222-8333-444455556666", path.join(world, "never-written.jsonl"));
		rejects(
			gidGhost,
			"does not exist on disk",
			"4: recorded transcript missing on disk → refused as MISSING, not as no-model [QK:RESUME-ID-MISSING-TRANSCRIPT-CAUSE]",
		);

		const nativeNoModel = "0199eeee-1111-4222-8333-444455556666";
		const fileNoModel = writeTranscript("no-model.jsonl", sessionLine(nativeNoModel));
		const gidNoModel = mintRecord(nativeNoModel, fileNoModel);
		rejects(gidNoModel, "no recorded model", "4: no model_change → refused (model preservation)");

		// A headerless transcript has an UNDEFINED header id, which can never equal the record's
		// nativeSessionId — so the integrity check catches it and says "(none)" rather than
		// resuming a file whose ownership was never stated.
		const nativeNoHeader = "0199ffff-1111-4222-8333-444455556666";
		const fileNoHeader = writeTranscript("no-header.jsonl", modelLine);
		const gidNoHeader = mintRecord(nativeNoHeader, fileNoHeader);
		rejects(gidNoHeader, '"(none)"', "4: headerless transcript → refused as (none), never resumed");

		// ── 3. #52 ADDRESSABLE READ ───────────────────────────────────────────────
		// Planted LAST so the duplicate cannot disturb the cells above: a store-wide uniqueness
		// scan sees every record, and `upsertMetaSession` would attach to the existing garden id
		// rather than mint a rival, so the rival record is written directly.
		const rivalGid = "20260301T120009-a1b2c3";
		fs.writeFileSync(
			path.join(storeDir, `${rivalGid}.meta.json`),
			serializeMetaIdentity({
				schemaVersion: 3,
				gardenId: rivalGid,
				backend: "pi",
				nativeSessionId: nativeOk, // the SAME native session as gidOk
				cwd,
				model: "gpt-5.4",
				transcriptPath: fileOk,
				createdAt: "2026-03-01T12:00:00.000Z",
				recordUpdatedAt: "2026-03-01T12:30:00.000Z",
			}),
		);
		// The happy-path id resolved a moment ago; the ONLY thing that changed is a second record
		// claiming its native session. If this leaf used the plain targeted read, that resolve
		// would still succeed and two garden ids would resume one transcript under two locks.
		rejects(
			gidOk,
			"must be unique",
			"3: a garden id that no longer holds its nativeSessionId alone → refused by the ADDRESSABLE read [QK:RESUME-ID-ADDRESSABLE-READ]",
		);
		rejects(
			rivalGid,
			"must be unique",
			"3: …refused from EITHER side of the pair (neither rival is silently preferred)",
		);
	} finally {
		if (prevStore === undefined) delete process.env.ENTWURF_META_SESSIONS_DIR;
		else process.env.ENTWURF_META_SESSIONS_DIR = prevStore;
		fs.rmSync(world, { recursive: true, force: true });
	}

	// ── 5. SSOT — the leaf's header must name the gate that actually certifies it ──
	{
		const src = fs.readFileSync(LEAF_SRC, "utf8");
		ok(
			"5: the leaf's header names check-resume-launch-identity (no certification it does not have) [QK:RESUME-ID-GATE-SSOT]",
			src.includes("`check-resume-launch-identity`"),
		);
		// The preservation is deliberate and stated: a reader who finds an uncalled export must
		// be able to tell "kept on purpose, for the visible lane" from "forgotten".
		ok("5: the leaf states it is preserved with no consumer, on purpose", /no consumer in the shipped tree/.test(src));
	}

	console.log(`\ncheck-resume-launch-identity: ${passed} checks passed`);
}

main();
