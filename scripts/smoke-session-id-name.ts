/**
 * smoke-session-id-name — LIVE 3-turn substrate smoke for the Pi 0.78
 * `--session-id` + `--name` primitives, exercised through the pi-shell-acp
 * bridge but WITHOUT touching the Entwurf tool surface (Phase 3a).
 *
 * It dogfoods the locked identity helpers (generateSessionId / buildSessionName
 * / readSessionHeader / findSessionFilesById / analyzeSessionFileLike) against a
 * real `pi` process, proving the substrate the Entwurf rewrite will sit on:
 *
 *   T1 same-cwd turn 1 : header id == sessionId, header cwd == launch cwd,
 *                        session_info.name == the denote-style name (info layer).
 *   T2 same-cwd turn 2 : NO --name re-supplied → exactly one session file,
 *                        append-not-recreate (analyze turns grow), session name
 *                        unchanged (spawn-only name).
 *   T3 wrong-cwd turn  : same --session-id from a DIFFERENT cwd creates a SECOND
 *                        session with the same header id but a different header
 *                        cwd. Recorded as footgun EVIDENCE (not a failure) — this
 *                        is exactly what the 0.9.0 resume guard must prevent by
 *                        forcing child cwd to the saved header cwd.
 *
 * LIVE: spawns real `pi` turns (auth + tokens). Cheap sonnet `-p 'ok'`. Isolated
 * via a temp PI_CODING_AGENT_DIR so the real ~/.pi/agent is never touched.
 */

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PI_BIN = process.env.PI_BIN ?? "pi";

// Isolate session storage BEFORE importing entwurf-core (it computes
// SESSIONS_BASE at module load from PI_CODING_AGENT_DIR).
const agentDir = fs.mkdtempSync(path.join(os.tmpdir(), "psa-sidname-agent-"));
process.env.PI_CODING_AGENT_DIR = agentDir;
process.env.PI_ENTWURF_TARGETS_PATH = path.join(REPO_ROOT, "pi", "entwurf-targets.json");

const { generateSessionId, buildSessionName, readSessionHeader, findSessionFilesById, analyzeSessionFileLike } =
	await import("../pi-extensions/lib/entwurf-core.ts");

const cwd1 = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "psa-sidname-cwd1-")));
const cwd2 = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "psa-sidname-cwd2-")));

function cleanup() {
	for (const d of [agentDir, cwd1, cwd2]) {
		try {
			fs.rmSync(d, { recursive: true, force: true });
		} catch {
			/* best-effort */
		}
	}
}

/** Latest `session_info` name wins (matches pi's getSessionName). */
function readSessionInfoName(file: string): string | null {
	let name: string | null = null;
	for (const line of fs.readFileSync(file, "utf8").split("\n")) {
		const t = line.trim();
		if (!t) continue;
		try {
			const e = JSON.parse(t) as { type?: string; name?: unknown };
			if (e.type === "session_info" && typeof e.name === "string") name = e.name;
		} catch {
			/* skip */
		}
	}
	return name;
}

function runPiTurn(turnCwd: string, sessionId: string, name: string | null, prompt: string): void {
	const args = [
		"--no-extensions",
		"-e",
		REPO_ROOT,
		"--session-id",
		sessionId,
		"--provider",
		"pi-shell-acp",
		"--model",
		"claude-sonnet-4-6",
		"--mode",
		"json",
	];
	if (name !== null) args.splice(args.indexOf("--provider"), 0, "--name", name);
	args.push("-p", prompt);

	const res = spawnSync(PI_BIN, args, {
		cwd: turnCwd,
		encoding: "utf8",
		timeout: 180_000,
		env: { ...process.env, PI_CODING_AGENT_DIR: agentDir },
	});
	if (res.status !== 0) {
		const tail = `${res.stdout ?? ""}\n${res.stderr ?? ""}`.split("\n").slice(-12).join("\n");
		throw new Error(`pi turn failed (status=${res.status}, signal=${res.signal}) in ${turnCwd}:\n${tail}`);
	}
}

try {
	const sessionId = generateSessionId();
	const name = buildSessionName({
		sessionId,
		provider: "pi-shell-acp",
		model: "claude-sonnet-4-6",
		rawTitle: "substrate smoke session-id name",
		tags: ["entwurf", "smoke"],
	});
	console.log(`[smoke-session-id-name] sessionId=${sessionId}`);
	console.log(`[smoke-session-id-name] name=${name}`);

	// ---- T1: same-cwd turn 1 (spawn with --session-id + --name) ----
	runPiTurn(cwd1, sessionId, name, "ok");
	const afterT1 = findSessionFilesById(sessionId);
	assert.equal(afterT1.length, 1, `[T1] exactly one session file (got ${afterT1.length})`);
	const fileT1 = afterT1[0] as string;
	const headerT1 = readSessionHeader(fileT1);
	assert.equal(headerT1?.id, sessionId, "[T1] header id == sessionId");
	assert.equal(headerT1?.cwd, cwd1, `[T1] header cwd == launch cwd (${headerT1?.cwd} vs ${cwd1})`);
	assert.equal(readSessionInfoName(fileT1), name, "[T1] session_info.name == denote name (info layer, not header)");
	const turnsT1 = analyzeSessionFileLike(fileT1).turns;
	assert.ok(turnsT1 >= 1, `[T1] at least one assistant turn (got ${turnsT1})`);
	console.log(`[smoke-session-id-name] [T1] ok — file=${path.basename(fileT1)} turns=${turnsT1}`);

	// ---- T2: same-cwd turn 2, NO --name (append, spawn-only name) ----
	runPiTurn(cwd1, sessionId, null, "ok again");
	const afterT2 = findSessionFilesById(sessionId);
	assert.equal(afterT2.length, 1, `[T2] still exactly one session file — append, not recreate (got ${afterT2.length})`);
	assert.equal(afterT2[0], fileT1, "[T2] same session file path");
	const headerT2 = readSessionHeader(fileT1);
	assert.equal(headerT2?.id, sessionId, "[T2] header id unchanged");
	assert.equal(headerT2?.cwd, cwd1, "[T2] header cwd unchanged");
	assert.equal(readSessionInfoName(fileT1), name, "[T2] session name unchanged without --name (spawn-only)");
	const turnsT2 = analyzeSessionFileLike(fileT1).turns;
	assert.ok(turnsT2 > turnsT1, `[T2] turns grew ${turnsT1} → ${turnsT2} (appended to existing session)`);
	console.log(`[smoke-session-id-name] [T2] ok — append confirmed, turns=${turnsT2}`);

	// ---- T3: wrong-cwd turn, same --session-id (footgun EVIDENCE) ----
	runPiTurn(cwd2, sessionId, null, "ok");
	const afterT3 = findSessionFilesById(sessionId);
	assert.equal(
		afterT3.length,
		2,
		`[T3] same id from a different cwd created a SECOND session (footgun; got ${afterT3.length})`,
	);
	const cwds = afterT3.map((f) => readSessionHeader(f)?.cwd).sort();
	assert.deepEqual(cwds, [cwd1, cwd2].sort(), "[T3] the two sessions carry different header cwds");
	console.log(
		`[smoke-session-id-name] [T3] footgun evidence recorded — same sessionId now exists under 2 cwds ` +
			`(${cwd1}, ${cwd2}). 0.9.0 resume MUST force child cwd to the saved header cwd to avoid this.`,
	);

	console.log(
		"[smoke-session-id-name] PASS — substrate proven (append + spawn-only name + wrong-cwd footgun documented)",
	);
} finally {
	cleanup();
}
