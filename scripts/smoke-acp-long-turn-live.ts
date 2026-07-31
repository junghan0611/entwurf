// 0.13.1 — LIVE acceptance for the prompt-lifecycle contract. OUT of `pnpm check`.
//
//   LIVE=1 ./run.sh smoke-acp-long-turn-live
//
// THE CLAIM THIS PAYS FOR. `check-acp-prompt-lifecycle` proves against fakes
// that a running prompt has no wall clock, and `check-probe-ordering` proves the
// source carries none. Neither can prove the whole stack — pi's runner, its
// retry policy, the real adapter, and a real model — lets a turn run past the
// number we deleted. This smoke does exactly that and nothing else: it drives
// ONE real turn whose tool work is deliberately longer than the retired 600s
// cutoff, and requires it to finish as ONE turn.
//
// Two facts are asserted together, because the old defect was their PRODUCT:
//
//   survives    the reply carries the nonce and the turn took LONGER than the
//               retired cutoff — a fixed wall clock would have killed it.
//   not replayed
//               the persisted transcript contains exactly ONE bootstrap notice
//               ("[acp: preparing claude session]"). The old failure mode
//               replayed the same full prompt from a COLD ACP session up to
//               `retry.maxRetries` times, so every replay re-announced that
//               bootstrap. One occurrence is the direct evidence that the answer
//               came from the original prompt.
//
// The work is split into several tool calls under the backend's own per-command
// tool cap rather than one huge wait, which is also the realistic shape of the
// turns that were being killed (continuous tool activity, no output for minutes).
//
// WHY THE WORK IS NOT `sleep` (measured 2026-07-30, first LIVE attempt). Asking
// for `sleep 240` produced a 22.9s turn with no nonce: the Claude backend's own
// Bash tool refuses a FOREGROUND `sleep` ("Foreground `sleep` is blocked; use
// Monitor with an until-loop"), so the model detached it, reported "Command
// running in background", said it would wait, and ended the turn. The tool work
// never happened, so nothing about the wall clock was measured. The blocking
// command below waits the same wall time without invoking `sleep`, which is the
// only reason the shape changed — the claim is unchanged.

import { strict as assert } from "node:assert";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { skipLive } from "./lib/live-skip.ts";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const MODEL = process.env.ENTWURF_ACP_LONG_TURN_MODEL?.trim() || "claude-sonnet-5";
const PROVIDER = "entwurf";

/** The cutoff this cut removed. The turn must outlive it. */
const RETIRED_CUTOFF_MS = 600_000;
/** Seconds per tool call — each stays under the backend's own per-command cap. */
const SLEEP_SECONDS = Number(process.env.ENTWURF_ACP_LONG_TURN_SLEEP_SECONDS) || 240;
/** How many sequential waits to ask for (3 × 240s = 720s > the retired cutoff). */
const SLEEP_ROUNDS = Number(process.env.ENTWURF_ACP_LONG_TURN_ROUNDS) || 3;
/** Harness bound for the WHOLE smoke — an observation horizon, not a turn contract. */
const SMOKE_HORIZON_MS = Number(process.env.ENTWURF_ACP_LONG_TURN_HORIZON_MS) || 2_400_000;

function fail(msg: string): never {
	console.error(`[smoke-acp-long-turn-live] FAIL: ${msg}`);
	process.exit(1);
}

if (process.env.LIVE !== "1") {
	skipLive("smoke-acp-long-turn-live", "set LIVE=1 to run the real long ACP turn.");
}

const nonce = `${process.pid.toString(36)}${Date.now().toString(36)}`;
const expected = `LONGTURN_OK_${nonce}`;
const sessionId = `long-turn-${nonce}`;

const scratch = mkdtempSync(join(tmpdir(), "entwurf-long-turn-"));
const sessionDir = mkdtempSync(join(tmpdir(), "entwurf-long-turn-sessions-"));
const startedAt = Date.now();
try {
	// Blocks for SLEEP_SECONDS in the FOREGROUND without invoking `sleep` (see the
	// header): select() with only a timeout is a plain wait, and the echo gives
	// each round a visible completion marker in the transcript.
	const waitCommand = `python3 -c "import select; select.select([], [], [], ${SLEEP_SECONDS})" && echo ROUND_COMPLETE`;

	const prompt =
		`Run exactly ${SLEEP_ROUNDS} shell commands with your shell tool, one at a time, waiting for each to print ` +
		`ROUND_COMPLETE before starting the next. Each command is exactly: ${waitCommand}\n\n` +
		`Each one blocks for about ${SLEEP_SECONDS} seconds, so give the shell tool a per-command limit of at least ` +
		`${(SLEEP_SECONDS + 60) * 1000} ms. Run every command in the FOREGROUND and wait for its output — do not ` +
		"detach it, do not run it in the background, do not poll for it, do not shorten it, and do not run them in " +
		`parallel. When all ${SLEEP_ROUNDS} have printed ROUND_COMPLETE, reply with exactly ${expected} and nothing else.`;

	const args = [
		"--no-extensions",
		"-e",
		REPO_ROOT,
		"--mode",
		"text",
		"--session-id",
		sessionId,
		"--session-dir",
		sessionDir,
		"-p",
		"--approve",
		"--provider",
		PROVIDER,
		"--model",
		MODEL,
		prompt,
	];

	console.error(`[smoke-acp-long-turn-live] repo:    ${REPO_ROOT}`);
	console.error(`[smoke-acp-long-turn-live] cwd:     ${scratch}`);
	console.error(`[smoke-acp-long-turn-live] model:   ${PROVIDER}/${MODEL}`);
	console.error(`[smoke-acp-long-turn-live] work:    ${SLEEP_ROUNDS} × ${SLEEP_SECONDS}s foreground wait`);
	console.error(`[smoke-acp-long-turn-live] expects: ${expected} after > ${RETIRED_CUTOFF_MS}ms`);

	const res = spawnSync("pi", args, { cwd: scratch, encoding: "utf8", timeout: SMOKE_HORIZON_MS, env: process.env });
	const elapsed = Date.now() - startedAt;

	const stdout = res.stdout ?? "";
	const stderr = res.stderr ?? "";
	const combined = `${stdout}\n${stderr}`;
	const tail = combined.split("\n").slice(-30).join("\n");

	if (res.error) {
		console.error(`[smoke-acp-long-turn-live] output tail:\n${tail}`);
		fail(`pi spawn failed after ${elapsed}ms: ${res.error.message}`);
	}
	if (res.status !== 0) {
		console.error(`[smoke-acp-long-turn-live] output tail:\n${tail}`);
		fail(`pi exited ${res.status} (signal=${res.signal ?? "none"}) after ${elapsed}ms`);
	}

	assert.ok(
		stdout.includes(expected),
		`the long turn did not deliver its nonce ${expected} after ${elapsed}ms (stdout tail: ${JSON.stringify(stdout.slice(-400))})`,
	);
	assert.ok(
		elapsed > RETIRED_CUTOFF_MS,
		`the turn finished in ${elapsed}ms — under the retired ${RETIRED_CUTOFF_MS}ms cutoff, so it proves nothing. ` +
			"Raise ENTWURF_ACP_LONG_TURN_ROUNDS / _SLEEP_SECONDS until the tool work outlasts the cutoff.",
	);

	// No cold replay: exactly one bootstrap in the persisted transcript.
	const jsonl = readdirSync(sessionDir, { recursive: true })
		.filter((f): f is string => typeof f === "string" && f.endsWith(".jsonl"))
		.map((f) => readFileSync(join(sessionDir, f), "utf8"))
		.join("\n");
	assert.ok(jsonl.length > 0, `no session JSONL under ${sessionDir} — cannot judge replay`);
	const bootstraps = jsonl.split("[acp: preparing claude session]").length - 1;
	assert.equal(
		bootstraps,
		1,
		`the transcript shows ${bootstraps} cold ACP bootstraps — a long turn must be answered by its ORIGINAL prompt, ` +
			"not replayed from a fresh session (that replay is what turned one long turn into four)",
	);
	// The DEFECT's own signatures, not the word "timeout" anywhere: the model
	// narrates its shell tool's per-command limit in this transcript, so a bare
	// /timeout/i would fail an otherwise perfect run on the assistant's own prose.
	// These three strings are what the old pairing actually emitted — the retired
	// cutoff's message, and pi's retry-exhaustion wording.
	const defectMarkers = [
		/prompt timed out after/i,
		/Aborted after \d+ retry attempts?/i,
		/\bretry attempt \d+/i,
	].filter((re) => re.test(combined));
	assert.equal(
		defectMarkers.length,
		0,
		`the run reported the retired cutoff or a pi retry — neither may happen to a healthy long turn ` +
			`(matched ${defectMarkers.join(", ")}; tail: ${JSON.stringify(tail)})`,
	);

	console.log("[smoke-acp-long-turn-live] PASS — a real ACP turn outlived the retired wall clock and answered once");
	console.log(`  model:    ${PROVIDER}/${MODEL}`);
	console.log(`  elapsed:  ${elapsed}ms (> retired cutoff ${RETIRED_CUTOFF_MS}ms)`);
	console.log(`  nonce:    ${expected} present in the assistant reply`);
	console.log("  replay:   exactly 1 cold ACP bootstrap in the persisted transcript");
	console.log("  retry:    no retry / timeout reported anywhere in the run");
} finally {
	for (const d of [scratch, sessionDir]) {
		try {
			rmSync(d, { recursive: true, force: true });
		} catch {
			// best-effort cleanup
		}
	}
}
