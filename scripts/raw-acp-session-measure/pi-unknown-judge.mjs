// #171 step 9 — the oracle of pi-unknown, over what a run left behind. NOT a gate.
//
//   node scripts/raw-acp-session-measure/pi-unknown-judge.mjs <run-dir>
//   node scripts/raw-acp-session-measure/pi-unknown-judge.mjs --self-test <run-dir that passes>
//
// `--self-test` changes one fact of the run's wire per copy (load for resume, Y before the attach, X on
// another session, a second new, the wrong selection) and exits 1 if any copy still passes.
//
// Reads summary.json (the three record snapshots and the two labels), the wire logs under `wire/` and
// the Pi session file, and nothing of the probe's own bookkeeping. Prints the checks; exits 0 only
// when every one holds, 1 otherwise, 2 when the run cannot be read. `observations` are not judged.
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";

const lines = (file) =>
	readFileSync(file, "utf8")
		.split("\n")
		.filter(Boolean)
		.map((l) => {
			try {
				return JSON.parse(l);
			} catch {
				return { unparsed: true };
			}
		});
const promptText = (r) => (r.params?.prompt ?? []).map((b) => b.text ?? "").join("\n");
const textOf = (content) =>
	(Array.isArray(content) ? content : []).filter((b) => b.type === "text" && !b.textSignature).map((b) => b.text);

/** The session file as the run wrote it, or the same file under a run directory that was moved. */
function sessionFileIn(runDir, recorded) {
	if (existsSync(recorded)) return recorded;
	const at = recorded.indexOf("/home/.pi/");
	return at < 0 ? recorded : join(runDir, recorded.slice(at));
}

export function judgeUnknownRun(runDir) {
	const summary = JSON.parse(readFileSync(join(runDir, "summary.json"), "utf8"));
	const { backend, x, y } = summary;
	const { recordAtKill, recordAfterKill, recordAfterReopen } = summary.run;
	const wireDir = join(runDir, "wire");
	// One log per agent process, in the order the agents were started.
	const agents = readdirSync(wireDir)
		.map((f) => ({ f, born: statSync(join(wireDir, f)).birthtimeMs }))
		.sort((a, b) => a.born - b.born)
		.map(({ f }) => lines(join(wireDir, f)));
	const entries = lines(sessionFileIn(runDir, summary.run.sessionFile)).filter((e) => e.type === "message");
	const users = entries.filter((e) => e.message?.role === "user");
	const answers = entries.filter((e) => e.message?.role === "assistant" && e.message?.provider === "entwurf");

	const isPrompt = (r) => r.method === "session/prompt";
	const xAgent = agents.findIndex((a) => a.some((r) => isPrompt(r) && promptText(r).includes(x)));
	const first = xAgent < 0 ? [] : agents.slice(0, xAgent + 1).flat();
	const later = xAgent < 0 ? [] : agents.slice(xAgent + 1).flat();
	// The id the vendor gave at birth, as Entwurf then used it on the wire.
	const bornId = first.find((r) => typeof r.params?.sessionId === "string")?.params.sessionId ?? null;
	const laterPrompts = later.filter(isPrompt);
	const resumes = later.filter((r) => r.method === "session/resume");
	// Order inside one agent's log is the order Entwurf wrote the requests in.
	const xLog = xAgent < 0 ? [] : agents[xAgent];
	const xAt = xLog.findIndex((r) => isPrompt(r) && promptText(r).includes(x));
	const newAt = xLog.findIndex((r) => r.method === "session/new");
	const yLog = agents.slice(xAgent + 1).find((a) => a.some((r) => isPrompt(r) && promptText(r).includes(y))) ?? [];
	const yAt = yLog.findIndex((r) => isPrompt(r) && promptText(r).includes(y));
	const resumeAt = yLog.findIndex((r) => r.method === "session/resume");
	const marker = recordAtKill?.pendingDispatch ?? null;
	const xEntries = users.filter((e) => textOf(e.message.content).join("\n").includes(x)).map((e) => e.id);
	const unknown = answers.find((e) => e.message.responseId === marker?.turnId);
	const unknownAt = answers.indexOf(unknown);
	const saysUnknown = (d) => d?.type === "entwurf_acp_prompt_unknown" || d?.details?.outcomeUnknown === true;
	const last = answers.at(-1)?.message;

	const checks = {
		birthDone: answers[0]?.message.stopReason === "stop",
		xSentOnce: first.filter((r) => isPrompt(r) && promptText(r).includes(x)).length === 1,
		// X went to the session that was born in the same agent, after its birth.
		xOnBornSession:
			bornId !== null &&
			newAt >= 0 &&
			newAt < xAt &&
			xLog[xAt]?.params?.sessionId === bornId &&
			first.filter(isPrompt).every((r) => r.params?.sessionId === bornId),
		markerStoodAtKill: typeof marker?.turnId === "string" && Array.isArray(marker?.inputEntryIds),
		markerNamesTheXEntry: xEntries.length === 1 && isDeepStrictEqual(marker?.inputEntryIds, xEntries),
		unknownAnswerStored:
			unknown?.message.stopReason === "error" && (unknown.message.diagnostics ?? []).some(saysUnknown),
		recordStillNamesDispatch:
			typeof marker?.turnId === "string" &&
			(recordAfterKill?.pendingDispatch?.turnId === marker.turnId ||
				(recordAfterKill?.unsealed ?? []).some((d) => d.turnId === marker.turnId)),
		reopenResumedRecordedId:
			bornId !== null &&
			resumes.length === 1 &&
			resumes[0].params?.sessionId === bornId &&
			// The attach comes before Y, in the agent that was sent Y.
			resumeAt >= 0 &&
			resumeAt < yAt &&
			!later.some((r) => r.method === "session/new" || r.method === "session/load"),
		oneSessionNew: agents.flat().filter((r) => r.method === "session/new").length === 1,
		oneVendorId:
			bornId !== null &&
			[recordAtKill, recordAfterKill, recordAfterReopen].every((record) => record?.acpSessionId === bornId),
		wireSelection:
			laterPrompts.length === 1 &&
			laterPrompts[0].params?.sessionId === bornId &&
			promptText(laterPrompts[0]).includes(y) &&
			promptText(laterPrompts[0]).includes(x) === (backend === "agy"),
		reopenAnswered: last?.stopReason === "stop" && textOf(last.content).join("").includes(y),
	};
	const observations = {
		// A stop that told the operator about the held input before Y went out (the untold variant).
		answersAfterUnknown: unknownAt < 0 ? null : answers.length - 1 - unknownAt,
		unknownDiagnostics: (unknown?.message.diagnostics ?? []).map((d) => d.type),
		bornId,
		markerTurnId: marker?.turnId ?? null,
		markerInputEntryIds: marker?.inputEntryIds ?? null,
	};
	return { backend, checks, observations, ok: Object.values(checks).every((v) => v === true) };
}

/**
 * The oracle against itself: copies of a run that passes, each with one fact of its wire changed, must fail.
 * Returns the names of the copies that still passed (none, when the oracle holds).
 */
export function selfTest(runDir) {
	if (!judgeUnknownRun(runDir).ok) throw new Error("the run itself does not pass");
	const summary = JSON.parse(readFileSync(join(runDir, "summary.json"), "utf8"));
	const sessionFile = sessionFileIn(runDir, summary.run.sessionFile);
	const names = readdirSync(join(runDir, "wire"))
		.map((f) => ({ f, born: statSync(join(runDir, "wire", f)).birthtimeMs }))
		.sort((a, b) => a.born - b.born)
		.map(({ f }) => f);
	const logs = names.map((f) => lines(join(runDir, "wire", f)));
	const has = (r, label) => r.method === "session/prompt" && promptText(r).includes(label);
	const xLog = logs.findIndex((log) => log.some((r) => has(r, summary.x)));
	const yLog = logs.findIndex((log, i) => i > xLog && log.some((r) => has(r, summary.y)));
	const cases = {
		"load instead of resume": (copy) => {
			for (const r of copy[yLog]) if (r.method === "session/resume") r.method = "session/load";
		},
		"Y before the attach": (copy) => {
			const log = copy[yLog];
			const resume = log.findIndex((r) => r.method === "session/resume");
			const prompt = log.findIndex((r) => has(r, summary.y));
			[log[resume], log[prompt]] = [log[prompt], log[resume]];
		},
		"X on another session": (copy) => {
			copy[xLog].find((r) => has(r, summary.x)).params.sessionId = "00000000-0000-4000-8000-000000000000";
		},
		"a second session/new": (copy) => {
			copy[yLog].unshift({ method: "session/new", params: {} });
		},
		"X sent again by Claude, or withheld by agy": (copy) => {
			const prompt = copy[yLog].find((r) => has(r, summary.y));
			const block = prompt.params.prompt.find((b) => typeof b.text === "string");
			block.text = block.text.includes(summary.x) ? block.text.replaceAll(summary.x, "") : `${summary.x} ${block.text}`;
		},
	};
	const passed = [];
	// Control: an unchanged copy must pass, or a failing copy would prove nothing about its change.
	const CONTROL = "unchanged copy";
	for (const [name, change] of [[CONTROL, () => {}], ...Object.entries(cases)]) {
		const copy = structuredClone(logs);
		change(copy);
		const dir = mkdtempSync(join(tmpdir(), "pi-unknown-judge-"));
		try {
			mkdirSync(join(dir, "wire"));
			// Written oldest first, so the copies keep the order of the agents.
			copy.forEach((log, i) => {
				writeFileSync(join(dir, "wire", `wire-${i}.ndjson`), log.map((r) => JSON.stringify(r)).join("\n"));
				const until = Date.now() + 15;
				while (Date.now() < until);
			});
			writeFileSync(join(dir, "summary.json"), JSON.stringify({ ...summary, run: { ...summary.run, sessionFile } }));
			const ok = judgeUnknownRun(dir).ok;
			if (name === CONTROL && !ok) throw new Error("an unchanged copy of the run does not pass");
			if (name !== CONTROL && ok) passed.push(name);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	}
	return passed;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	if (process.argv[2] === "--self-test") {
		let passed;
		try {
			passed = selfTest(process.argv[3]);
		} catch (error) {
			console.error(`[pi-unknown-judge] self-test cannot run: ${error?.message ?? error}`);
			process.exit(2);
		}
		console.log(JSON.stringify({ changedCopiesThatStillPassed: passed }));
		process.exit(passed.length === 0 ? 0 : 1);
	}
	let verdict;
	try {
		verdict = judgeUnknownRun(process.argv[2]);
	} catch (error) {
		console.error(`[pi-unknown-judge] cannot read the run: ${error?.message ?? error}`);
		process.exit(2);
	}
	console.log(JSON.stringify(verdict, null, 2));
	process.exit(verdict.ok ? 0 : 1);
}
