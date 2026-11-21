// #171 step 9 — a prompt whose outcome is unknown, then the same Pi session reopened. NOT a gate.
//
//   LIVE=1 scripts/raw-acp-session-measure/run.sh pi-unknown <out-dir> claude|agy
//
// A real Pi resident sends prompt X; once X is seen on the wire to the agent, the agent's process
// group (this run's own, named by the holder lease) is killed. Pi is quit and reopened on the same
// session and sends Y. Observed: what Pi stored for X, what the record names as dispatched, and what
// the reopened Pi put on the wire: `session/resume` of the recorded id and no `session/new`, and
// whether the prompt carries X again (agy: resend) or Y alone (Claude: skip).
//
// The wire is read by wire-tee.mjs, placed in front of the agent: for agy as an `agy` first on PATH
// (production's own arguments reach the real one), for Claude through `CLAUDE_AGENT_ACP_COMMAND`
// around production's own launcher. That override is the operator's seam, so this run does not
// measure the launcher's name split or signal observation; pi-smoke measures the unwrapped launch.
import { chmodSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { REPO, RUN } from "./common.mjs";
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
} from "./pi-host.mjs";

const WIRE = join(RUN, "wire");
const TEE = join(REPO, "scripts/raw-acp-session-measure/wire-tee.mjs");
mkdirSync(WIRE, { recursive: true });
const q = (s) => `'${String(s).replaceAll("'", "'\\''")}'`;
let env;
if (backend === "agy") {
	const bin = join(RUN, "bin");
	mkdirSync(bin, { recursive: true });
	const real = process.env.ENTWURF_AGY_BIN;
	if (!real) throw new Error("ENTWURF_AGY_BIN is not set (use run.sh)");
	writeFileSync(join(bin, "agy"), `#!/bin/sh\nexec ${q(process.execPath)} ${q(TEE)} ${q(WIRE)} ${q(real)} "$@"\n`);
	chmodSync(join(bin, "agy"), 0o755);
	env = { PATH: `${bin}:${process.env.PATH}` };
} else {
	const launcher = join(REPO, "pi-extensions/lib/acp/claude-acp-launch.js");
	env = {
		CLAUDE_AGENT_ACP_COMMAND: `exec ${q(process.execPath)} ${q(TEE)} ${q(WIRE)} ${q(process.execPath)} ${q(launcher)}`,
	};
}

/** Every request Entwurf wrote, per agent process, in the order the agents were started. */
const wire = () =>
	readdirSync(WIRE)
		.map((f) => ({ f, born: statSync(join(WIRE, f)).birthtimeMs }))
		.sort((a, b) => a.born - b.born)
		.map(({ f }) => f)
		.map((f) => ({
			file: f,
			requests: readFileSync(join(WIRE, f), "utf8")
				.split("\n")
				.filter(Boolean)
				.map((l) => {
					try {
						return JSON.parse(l);
					} catch {
						return { unparsed: l.slice(0, 80) };
					}
				}),
		}));
const promptText = (r) => (r.params?.prompt ?? []).map((b) => b.text ?? "").join("\n");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const tag = Math.random().toString(36).slice(2, 8).toUpperCase();
const X = `XMARK-${tag}`;
const Y = `YMARK-${tag}`;
const summary = { backend, model: MODEL, x: X, y: Y, steps, checks: {}, run: {} };
let status = 0;
try {
	const a = launch(undefined, env);
	const sessionFile = (await a.command({ type: "get_state" })).data?.sessionFile ?? null;
	summary.run.sessionFile = sessionFile;
	const t1 = await a.turn("birth", "Reply with exactly: OK");
	const idAtBirth = records()[0]?.acpSessionId ?? null;
	// --- X: seen on the wire, then the agent is gone
	const t2 = await a.turn(
		"unknown",
		`This request is labelled ${X}. Write the numbers from 1 to 400, one per line, with a short sentence about each number.`,
		undefined,
		async () => {
			const until = Date.now() + 60_000;
			const sent = () =>
				wire().some((w) => w.requests.some((r) => r.method === "session/prompt" && promptText(r).includes(X)));
			while (!sent()) {
				if (Date.now() > until) throw new Error("X was not seen on the wire within 60s");
				await sleep(100);
			}
			summary.run.xSeenOnWire = true;
			await sleep(1_500);
			const held = leases();
			const lease = JSON.parse(readFileSync(join(AGENT, "entwurf-acp-holders", held[0]), "utf8"));
			summary.run.killedGroup = lease.child?.pid ?? null;
			summary.run.recordAtKill = records()[0] ?? null;
			process.kill(-lease.child.pid, "SIGKILL");
		},
	);
	await sleep(1_000);
	summary.run.recordAfterKill = records()[0] ?? null;
	summary.run.leasesAfterKill = leases();
	summary.run.quit1 = await a.quit();
	summary.run.leasesAfterQuit = leases();
	const agentsBefore = wire().length;

	// --- the same Pi session reopened: Y
	const b = launch(sessionFile, env);
	const ask = `This request is labelled ${Y}. Reply with exactly: ${Y}`;
	const t3 = await b.turn("reopen", ask);
	// A stop that tells the operator about the held input is itself an answer; the request is made again.
	let t4 = null;
	if (t3.stopReason !== "stop") t4 = await b.turn("reopen-again", ask);
	summary.run.recordAfterReopen = records()[0] ?? null;
	summary.run.quit2 = await b.quit();
	summary.run.leasesAtEnd = leases();

	const w = wire();
	summary.run.wire = w.map((x) => ({
		file: x.file,
		requests: x.requests.map((r) => ({
			method: r.method ?? null,
			sessionId: r.params?.sessionId ?? null,
			hasX: r.method === "session/prompt" ? promptText(r).includes(X) : undefined,
			hasY: r.method === "session/prompt" ? promptText(r).includes(Y) : undefined,
		})),
	}));
	const later = w.slice(agentsBefore).flatMap((x) => x.requests);
	const laterPrompts = later.filter((r) => r.method === "session/prompt");
	const stored = sessionFile ? storedAnswers(sessionFile) : [];
	summary.run.storedAnswers = stored;
	const last = t4 ?? t3;
	const marker = summary.run.recordAtKill?.pendingDispatch ?? null;
	const after = summary.run.recordAfterKill;
	summary.checks = {
		birthDone: t1.stopReason === "stop",
		xSeenOnWire: summary.run.xSeenOnWire === true,
		markerStoodAtKill: typeof marker?.turnId === "string" && Array.isArray(marker?.inputEntryIds),
		unknownStoredAsError: t2.stopReason === "error" && typeof t2.responseId === "string" && t2.diagnostics.length > 0,
		unknownTurnIdIsTheMarker: marker?.turnId === t2.responseId,
		recordStillNamesDispatch:
			after?.pendingDispatch?.turnId === marker?.turnId ||
			(after?.unsealed ?? []).some((d) => d.turnId === marker?.turnId),
		reopenResumedRecordedId:
			later.some((r) => /^session\/(resume|load)$/.test(r.method ?? "") && r.params?.sessionId === idAtBirth) &&
			!later.some((r) => r.method === "session/new"),
		oneSessionNew: w.flatMap((x) => x.requests).filter((r) => r.method === "session/new").length === 1,
		oneVendorId: new Set([idAtBirth, after?.acpSessionId, summary.run.recordAfterReopen?.acpSessionId]).size === 1,
		wireSelection:
			backend === "agy"
				? laterPrompts.length === 1 &&
					promptText(laterPrompts[0]).includes(X) &&
					promptText(laterPrompts[0]).includes(Y)
				: laterPrompts.length === 1 &&
					!promptText(laterPrompts[0]).includes(X) &&
					promptText(laterPrompts[0]).includes(Y),
		reopenAnswered: last.stopReason === "stop" && last.text.includes(Y),
		skipStopFirst: t4 !== null,
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
