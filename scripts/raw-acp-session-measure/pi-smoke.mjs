// #171 step 9 — a real Pi resident over a real vendor ACP agent, inside the run sandbox. NOT a gate.
//
//   LIVE=1 scripts/raw-acp-session-measure/run.sh pi-smoke <out-dir> [claude|agy]
//
// What the deterministic gates assume and cannot observe (their Pi host is a fake): that a real Pi
// stores an Entwurf answer with its `responseId` and hands that stored message back to the provider,
// so a second turn reuses the live vendor session; that a failed or aborted answer is stored with its
// `responseId` and diagnostics; that a Pi which quit and reopened its session resumes the SAME vendor
// session and the vendor recalls it; and that a second Pi on that session stops on the holder lease.
//
// Every step is recorded as an observation in summary.json (`steps[].notices`, `.text`, `.stop`), and
// `checks` says which expectations held. A check that is false is a result, not a probe failure: the
// probe exits 0 whenever it ran to the end, 3 when Pi itself could not be driven.
//
// The sandbox and the Pi driver: pi-host.mjs.
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { RUN } from "./common.mjs";
import {
	AGENT,
	backend,
	launch,
	leases,
	MODEL,
	mtimeBefore,
	mtimes,
	records,
	steps,
	storedAnswers,
	TURN_MS,
} from "./pi-host.mjs";

const word = `KESTREL-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
const summary = { backend, model: MODEL, word, steps, checks: {}, run: {} };
let status = 0;
try {
	// --- one Pi: birth, reuse, an answered cancel, the turn after it
	const a = launch();
	const state = await a.command({ type: "get_state" });
	const sessionFile = state.data?.sessionFile ?? null;
	summary.run.sessionFile = sessionFile;
	const t1 = await a.turn("birth", `Remember this codeword for later: ${word}. Reply with exactly: OK`);
	const afterBirth = records();
	const t2 = await a.turn("reuse", "What is the codeword I gave you? Reply with the codeword alone.");
	const t3 = await a.turn(
		"abort",
		"Write the numbers from 1 to 400, one per line, with a short sentence about each number.",
		4_000,
	);
	const t4 = await a.turn("after-abort", "Reply with the codeword alone once more.");
	// Pi's own compaction (decision 16-1): the summary turn, then the next input on the same vendor session.
	const compacted = await a
		.command({ type: "compact" }, TURN_MS)
		.catch((error) => ({ success: false, error: String(error) }));
	summary.run.compact = {
		success: compacted.success === true,
		error: compacted.error ?? null,
		firstKept: compacted.data?.firstKeptEntryId ?? null,
	};
	const t4c = await a.turn("after-compaction", "Reply with the codeword alone, one last time.");
	const leasesWhileAlive = leases();
	const beforeQuit = records();
	summary.run.quit1 = await a.quit();
	summary.run.leasesAfterQuit = leases();
	// What is left of each lease's agent process group, when a lease stayed.
	summary.run.groupsAfterQuit = summary.run.leasesAfterQuit.map((f) => {
		const lease = JSON.parse(readFileSync(join(AGENT, "entwurf-acp-holders", f), "utf8"));
		const ps = spawnSync("ps", ["-eo", "pid,ppid,pgid,stat,etimes,args"], { encoding: "utf8" }).stdout;
		return ps
			.split("\n")
			.filter((l) => l.trim().split(/\s+/)[2] === String(lease.child?.pid))
			.map((l) => l.slice(0, 220));
	});

	// --- the same Pi session reopened: resume, and a second Pi on it
	const b = launch(sessionFile);
	const t5 = await b.turn("resume", "What is the codeword I gave you at the start? Reply with the codeword alone.");
	const afterResume = records();
	const c = launch(sessionFile);
	const t6 = await c.turn("second-pi", "Reply with exactly: SECOND");
	summary.run.quit3 = await c.quit();
	const t7 = await b.turn("holder-continues", "Reply with exactly: STILL-HERE");
	summary.run.quit2 = await b.quit();
	summary.run.leasesAtEnd = leases();

	// --- what Pi stored
	const stored = sessionFile ? storedAnswers(sessionFile) : [];
	summary.run.storedAnswers = stored;
	const ids = (rs) => rs.map((r) => r.acpSessionId);
	summary.run.acpSessionIds = {
		afterBirth: ids(afterBirth),
		beforeQuit: ids(beforeQuit),
		afterResume: ids(afterResume),
	};
	summary.run.leasesWhileAlive = leasesWhileAlive;
	const said = (step, part) => step.notices.some((n) => n.includes(part));
	summary.checks = {
		birthDone: t1.stopReason === "stop",
		reuseDone: t2.stopReason === "stop" && t2.text.includes(word),
		reuseSaidReusing: said(t2, "reusing live session") && !said(t2, "preparing"),
		abortSealedAborted: t3.stopReason === "aborted",
		afterAbortDone: t4.stopReason === "stop" && t4.text.includes(word),
		compactionKeptSession: summary.run.compact.success && t4c.stopReason === "stop" && t4c.text.includes(word),
		oneRecordOneId: new Set([...ids(afterBirth), ...ids(beforeQuit), ...ids(afterResume)]).size === 1,
		leaseHeldWhileAlive: leasesWhileAlive.length === 1,
		leaseReleasedOnQuit: summary.run.leasesAfterQuit.length === 0,
		resumeDone: t5.stopReason === "stop" && t5.text.includes(word),
		resumeSaidResuming: said(t5, "resuming") && !said(t5, "reusing"),
		secondPiStopped:
			t6.stopReason === "error" && /another Pi|holds|holder/i.test(`${t6.errorMessage} ${t6.notices.join(" ")}`),
		holderContinues: t7.stopReason === "stop" && t7.text.includes("STILL-HERE"),
		everyStoredAnswerHasResponseId: stored.length > 0 && stored.every((s) => typeof s.responseId === "string"),
		abortedAnswerStored: stored.some((s) => s.stopReason === "aborted" && typeof s.responseId === "string"),
	};
} catch (error) {
	summary.run.fatal = String(error?.stack ?? error);
	status = 3;
}
summary.run.mtimeBefore = mtimeBefore;
summary.run.mtimeAfter = mtimes();
writeFileSync(join(RUN, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`);
console.log(JSON.stringify({ status, checks: summary.checks, fatal: summary.run.fatal ?? null }, null, 2));
process.exit(status);
