/**
 * check-entwurf-v2-visible-resume — deterministic gate for the visible-resume composition
 * (`pi-extensions/lib/entwurf-v2-visible-resume.ts`).
 *
 * Every IO seam is injected, so this gate drives the whole state machine — including the timeout
 * branch — without a tmux, a lock file, a socket or a clock.
 *
 * Block order is deliberate: the REFUSALS run before the happy path. A defect that makes the
 * composition launch something it should have refused must be reported by the assertion that owns
 * that rule, not by whichever happy-path expectation happens to notice first.
 *
 *   V2RESUME-LIVE-REFUSED            an already-live citizen is refused, never reopened — that is
 *                                    also what stops two windows existing for one garden id
 *   V2RESUME-INDETERMINATE-NO-START  nothing is started when the probe cannot prove dormancy
 *   V2RESUME-CONFLICT-NO-START       a corrupt control-socket address starts nothing
 *   V2RESUME-LOCKED-NO-RESOLVE       a locked target refuses before identity is even read
 *   V2RESUME-NO-TRANSCRIPT-FAILS-LOUD a citizen with no transcript keeps the leaf's own cause and
 *                                    opens no window
 *   V2RESUME-LOCK-BEFORE-LIVENESS    the lock is taken BEFORE the liveness question is asked
 *   V2RESUME-IDENTITY-BEFORE-WINDOW  identity is resolved before the launcher is ever called
 *   V2RESUME-ARGV-FROM-RECORD        the launcher gets the record's cwd and the measured argv
 *   V2RESUME-OBSERVE-IS-BOUNDED-WAIT the observation WAITS (measured: the socket appeared ~2–4s
 *                                    after launch, so an immediate single probe would report a
 *                                    successful resume as unobserved)
 *   V2RESUME-RECEIPTS-SEPARATE       launch and observation are two objects, not one verdict
 *   V2RESUME-RENDER-SEPARATES        the rendered text keeps them apart by name
 *   V2RESUME-UNOBSERVED-IS-REAL      a timeout is ok:true + resume-unobserved: the window is real
 *   V2RESUME-TIMEOUT-RELEASES        …and the lock is released, the pane untouched, nothing retried
 *   V2RESUME-RELEASE-FAILURE-LOUD    a release that does not return "released" throws
 *   V2RESUME-NOT-PI-REFUSED          an out-of-domain backend is a NAMED refusal, not an error
 *   V2RESUME-NOT-PI-BY-FIELD         …matched on the error's reason FIELD, backend quoted from it
 *   V2RESUME-SHARED-ID-GRAMMAR       the address grammar is the session-id SSOT, not a local copy
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { AcquireLockResult, LockClaim, ReleaseResult } from "../pi-extensions/lib/entwurf-v2-lock.ts";
import {
	makeVisibleResumeDeps,
	observeSameGidSocket,
	RESUME_OBSERVE_INTERVAL_MS,
	RESUME_OBSERVE_TIMEOUT_MS,
	renderVisibleResume,
	type VisibleResumeDeps,
	type VisibleResumeResult,
	visibleResume,
} from "../pi-extensions/lib/entwurf-v2-visible-resume.ts";
import { type LaunchIdentity, ResumeBackendUnsupportedError } from "../pi-extensions/lib/resume-launch-identity.ts";
import type { TargetSocketInspection } from "../pi-extensions/lib/socket-discovery.ts";
import type { SocketLiveness } from "../pi-extensions/lib/socket-probe.ts";

let passed = 0;
function ok(label: string, cond: boolean): void {
	assert.ok(cond, label);
	console.log(`  ok    ${label}`);
	passed++;
}

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel: string): string => fs.readFileSync(path.join(ROOT, rel), "utf8");

const GID = "20260806T183749-145a26";
const SOCK = `/home/op/.pi/entwurf-control/${GID}.sock`;

const IDENTITY: LaunchIdentity = {
	sessionFile: "/home/op/.pi/agent/sessions/-p/2026-08-06T09-37-48-973Z_019fd66f.jsonl",
	cwd: "/home/op/project",
	explicitExtensionArgs: ["-e", "/opt/entwurf"],
	provider: "entwurf",
	model: "claude-sonnet-5",
};

const CLAIM: LockClaim = {
	gardenId: GID,
	pid: 4242,
	hostname: "h",
	createdAt: "2026-08-06T09:00:00.000Z",
	nonce: "n",
	owner: "entwurf_v2",
	lockPath: `/tmp/locks/${GID}.lock`,
};

interface Harness {
	deps: VisibleResumeDeps;
	trace: string[];
	readonly launches: number;
}

/** Records the ORDER of every seam, which is where most of this contract lives. */
function harness(opts: {
	livenessSequence: SocketLiveness[];
	inspectionKind?: TargetSocketInspection["kind"];
	acquire?: AcquireLockResult;
	release?: ReleaseResult;
	resolveIdentity?: () => LaunchIdentity;
	launchOk?: boolean;
}): Harness {
	const trace: string[] = [];
	let clock = 0;
	let probeIdx = 0;
	let launches = 0;
	const kind = opts.inspectionKind ?? "socket-file";
	const deps: VisibleResumeDeps = {
		acquireLock: (gid) => {
			trace.push(`acquireLock:${gid}`);
			return opts.acquire ?? { ok: true, claim: CLAIM };
		},
		releaseLock: () => {
			trace.push("releaseLock");
			return opts.release ?? "released";
		},
		resolveIdentity: (gid) => {
			trace.push(`resolveIdentity:${gid}`);
			return (opts.resolveIdentity ?? (() => IDENTITY))();
		},
		inspectSocket: async () => {
			trace.push("inspectSocket");
			return kind === "absent"
				? { kind: "absent", socketPath: SOCK }
				: kind === "address-conflict"
					? { kind: "address-conflict", socketPath: SOCK, reason: "symlink" }
					: kind === "indeterminate"
						? { kind: "indeterminate", socketPath: SOCK, error: "EACCES" }
						: { kind: "socket-file", socketPath: SOCK };
		},
		probeSocket: async () => {
			const value = opts.livenessSequence[Math.min(probeIdx, opts.livenessSequence.length - 1)] ?? "dead";
			probeIdx++;
			trace.push(`probeSocket:${value}`);
			return value;
		},
		launch: (input) => {
			launches++;
			trace.push(`launch:${input.cwd}:${input.runtimeArgs.join(" ")}`);
			return opts.launchOk === false
				? { ok: false, reason: "cwd-missing", hint: "the recorded cwd no longer exists" }
				: {
						ok: true,
						handle: {
							serverPid: "1",
							sessionId: "$0",
							windowId: "@9",
							windowIndex: "9",
							paneId: "%9",
							panePid: "999",
							runtimePath: "/usr/bin/pi",
							cwd: input.cwd,
						},
					};
		},
		sleep: async (ms) => {
			trace.push(`sleep:${ms}`);
			clock += ms;
		},
		now: () => clock,
	};
	return {
		deps,
		trace,
		get launches() {
			return launches;
		},
	};
}

async function main(): Promise<void> {
	// ══ REFUSALS FIRST — see the header note on block order ═════════════════════════

	// ── a malformed target ───────────────────────────────────────────────────────────
	{
		const h = harness({ livenessSequence: ["dead"] });
		const result = await visibleResume("../../etc/passwd", h.deps);
		ok(
			"a malformed garden id is refused BEFORE the lock — it names no citizen, so it never becomes a filesystem path",
			!result.ok && result.reason === "target-invalid" && h.trace.length === 0,
		);
	}

	// ── a locked target ──────────────────────────────────────────────────────────────
	{
		const h = harness({
			livenessSequence: ["dead"],
			acquire: {
				ok: false,
				conflict: { reason: "target-locked", lockPath: "/tmp/l", holder: null, detail: "held by pid 7" },
			},
		});
		const result = await visibleResume(GID, h.deps);
		ok(
			"[QK:V2RESUME-LOCKED-NO-RESOLVE] a locked target refuses without resolving identity, inspecting, or launching — the lock IS the gate, and reading a record behind someone else's lock is how two resumes race one transcript",
			!result.ok &&
				result.reason === "target-locked" &&
				h.launches === 0 &&
				!h.trace.some((t) => t.startsWith("resolveIdentity")),
		);
		ok("a failed acquire releases nothing — there is no claim to give back", !h.trace.includes("releaseLock"));
	}

	// ── an already-live citizen ──────────────────────────────────────────────────────
	{
		const h = harness({ livenessSequence: ["alive"] });
		const result = await visibleResume(GID, h.deps);
		ok(
			"[QK:V2RESUME-LIVE-REFUSED] a LIVE citizen is refused and no window is opened — it is addressed with entwurf_v2, and refusing here is also what stops two windows existing for one garden id",
			!result.ok && result.reason === "target-live" && h.launches === 0,
		);
		ok("the live refusal still releases the lock", h.trace.includes("releaseLock"));
		ok(
			"the live refusal points the caller at the verb that DOES work",
			!result.ok && /entwurf_v2 fire-and-forget/.test(result.detail),
		);
	}

	// ── an inconclusive probe ────────────────────────────────────────────────────────
	{
		const h = harness({ livenessSequence: ["indeterminate"] });
		const result = await visibleResume(GID, h.deps);
		ok(
			"[QK:V2RESUME-INDETERMINATE-NO-START] an inconclusive probe starts NOTHING — 'not provably dormant' is not 'dormant', and resuming a citizen that is actually running would put two processes on one transcript",
			!result.ok && result.reason === "target-indeterminate" && h.launches === 0,
		);
		ok("the indeterminate refusal releases the lock", h.trace.includes("releaseLock"));
	}

	// ── a corrupt address ────────────────────────────────────────────────────────────
	{
		const h = harness({ livenessSequence: ["dead"], inspectionKind: "address-conflict" });
		const result = await visibleResume(GID, h.deps);
		ok(
			"[QK:V2RESUME-CONFLICT-NO-START] a symlinked / non-socket control path is refused as an address conflict, unprobed and unlaunched — standing a citizen up behind a corrupt address would make the forgery addressable",
			!result.ok && result.reason === "target-address-conflict" && h.launches === 0,
		);
	}

	// ── an unresumable record: the leaf's cause-rich throw survives ──────────────────
	{
		const h = harness({
			livenessSequence: ["dead"],
			resolveIdentity: () => {
				throw new Error(
					"resume-launch-identity: has no recorded transcriptPath — the citizen never wrote a session file (no turn yet)",
				);
			},
		});
		let thrown: Error | null = null;
		await visibleResume(GID, h.deps).catch((err) => {
			thrown = err as Error;
		});
		ok(
			"[QK:V2RESUME-NO-TRANSCRIPT-FAILS-LOUD] a citizen with a socket but NO transcript (measured: a pi that never took a turn has both a record and a socket) fails LOUD with the leaf's own cause and opens no window — the cause is not re-typed into a reject enum, where the second copy is what goes stale",
			thrown !== null && /no recorded transcriptPath/.test(String(thrown)) && h.launches === 0,
		);
		ok("the lock is released even when identity resolution throws", h.trace.includes("releaseLock"));
	}

	// ── a citizen of a backend that has no same-id resume ────────────────────────────
	{
		const h = harness({
			livenessSequence: ["dead"],
			resolveIdentity: () => {
				throw new ResumeBackendUnsupportedError(GID, "claude-code");
			},
		});
		// The throw is CAUGHT here rather than allowed to escape: "this refusal was reported as a
		// raw error" is precisely the defect under test, and an uncaught throw would take the gate
		// down before this assertion could name it.
		const result = await visibleResume(GID, h.deps).catch(
			(err): VisibleResumeResult => ({
				ok: false,
				reason: "target-invalid",
				detail: `threw instead of refusing: ${err instanceof Error ? err.message : String(err)}`,
			}),
		);
		ok(
			"[QK:V2RESUME-NOT-PI-REFUSED] a claude-code / agy target is a NAMED refusal, not an error report: nothing is corrupt, the record is right, and the operator simply reached past a capability boundary — only pi stands a control socket up",
			!result.ok && result.reason === "target-not-pi" && h.launches === 0,
		);
		ok(
			"[QK:V2RESUME-NOT-PI-BY-FIELD] the refusal is matched on the error's own reason FIELD and its backend is quoted from the error, so no message string is parsed and the record is never read a second time to ask which backend it was",
			!result.ok &&
				/claude-code/.test(result.detail) &&
				h.trace.filter((t) => t.startsWith("resolveIdentity")).length === 1,
		);
		ok("the not-pi refusal releases the lock", h.trace.includes("releaseLock"));
	}

	// ── a refused launch ─────────────────────────────────────────────────────────────
	{
		const h = harness({ livenessSequence: ["dead"], launchOk: false });
		const result = await visibleResume(GID, h.deps);
		ok(
			"a refused launch is a named reject carrying the launcher's own reason and hint, and it is NOT retried",
			!result.ok && result.reason === "launch-refused" && /cwd-missing/.test(result.detail) && h.launches === 1,
		);
	}

	// ══ THE HAPPY PATH ══════════════════════════════════════════════════════════════
	{
		// dead at preflight, still dead on the first observation, alive on the second — the
		// measured shape: the window opens and the socket arrives a couple of seconds later.
		const h = harness({ livenessSequence: ["dead", "dead", "alive"] });
		const result = await visibleResume(GID, h.deps);

		ok(
			"[QK:V2RESUME-LOCK-BEFORE-LIVENESS] the lock is acquired BEFORE the liveness question — asked first, the answer could change under us while a competing resume passed its own dead check",
			h.trace[0] === `acquireLock:${GID}` && h.trace.indexOf("inspectSocket") > 0,
		);
		ok(
			"[QK:V2RESUME-IDENTITY-BEFORE-WINDOW] identity is resolved under the lock BEFORE the liveness question and long before the launcher — a record read after the preflight would mean the liveness answer applies to a citizen whose transcript has not been proven resumable yet, and any window would already be the wrong one",
			h.trace.indexOf(`resolveIdentity:${GID}`) < h.trace.indexOf("inspectSocket") &&
				h.trace.indexOf("inspectSocket") < h.trace.findIndex((t) => t.startsWith("launch:")),
		);
		ok(
			"[QK:V2RESUME-ARGV-FROM-RECORD] the launcher receives the RECORD's cwd and the measured interactive argv — no prompt, no --mode, no -p, and the bridge args exactly where the runtime accepted them",
			h.trace.includes(
				`launch:${IDENTITY.cwd}:--entwurf-control -e /opt/entwurf --session ${IDENTITY.sessionFile} --provider entwurf --model claude-sonnet-5`,
			),
		);
		ok(
			"[QK:V2RESUME-OBSERVE-IS-BOUNDED-WAIT] the observation SLEEPS and re-inspects rather than probing once — measured, the resumed socket appeared ~2–4s after the window opened, so a single immediate probe would have reported a successful resume as unobserved",
			result.ok &&
				result.observation.kind === "socket-alive" &&
				h.trace.filter((t) => t.startsWith("probeSocket")).length >= 3 &&
				h.trace.some((t) => t.startsWith("sleep:")),
		);
		ok("the launcher was called exactly once — a startup wait is not a retry loop", h.launches === 1);
		ok("the lock is released on the success path too", h.trace.filter((t) => t === "releaseLock").length === 1);
		ok(
			"[QK:V2RESUME-RECEIPTS-SEPARATE] launch and observation are two separate objects: the launch receipt carries the window handle and the transcript and says nothing about liveness, and only the observation says the citizen answered",
			result.ok &&
				result.launch.handle.windowId === "@9" &&
				result.launch.sessionFile === IDENTITY.sessionFile &&
				!("kind" in result.launch) &&
				result.observation.socketPath === SOCK,
		);
		const rendered = renderVisibleResume(result.ok ? result : result);
		ok(
			"[QK:V2RESUME-RENDER-SEPARATES] the rendered text keeps the two receipts apart BY NAME, so a reader can tell WHICH fact is missing when only one is there, and it refuses to claim a turn ran",
			rendered.text.includes("LAUNCH receipt") &&
				rendered.text.includes("OBSERVATION receipt") &&
				/No turn was run/.test(rendered.text) &&
				!rendered.isError,
		);
	}

	// ══ THE TIMEOUT BRANCH ══════════════════════════════════════════════════════════
	{
		const h = harness({ livenessSequence: ["dead"] });
		const result = await visibleResume(GID, h.deps);
		ok(
			"[QK:V2RESUME-UNOBSERVED-IS-REAL] a timeout is ok:true with observation=resume-unobserved — the window WAS opened and is left open, which is the same rule fresh-call already ships: a launch with no callback is a real outcome, not an error to retry",
			result.ok && result.observation.kind === "resume-unobserved",
		);
		ok(
			"[QK:V2RESUME-TIMEOUT-RELEASES] the timeout releases the lock, never relaunches, and never kills the pane — a retained lock on a visible artifact is the worse failure and would have to be cleared by hand on every slow host",
			h.trace.includes("releaseLock") && h.launches === 1 && !h.trace.some((t) => /kill|relaunch/.test(t)),
		);
		ok(
			"the observation stops AT the deadline rather than running forever",
			result.ok && result.observation.waitedMs >= RESUME_OBSERVE_TIMEOUT_MS,
		);
		const rendered = renderVisibleResume(result);
		ok(
			"the unobserved text tells the operator exactly what was and was not done: window open, lock released, nothing retried, nothing killed",
			/resume-unobserved/.test(rendered.text) && /nothing was retried/.test(rendered.text) && !rendered.isError,
		);
	}

	// ══ A FAILED RELEASE ════════════════════════════════════════════════════════════
	{
		const h = harness({ livenessSequence: ["dead", "alive"], release: "not-owned" });
		let thrown: Error | null = null;
		await visibleResume(GID, h.deps).catch((err) => {
			thrown = err as Error;
		});
		ok(
			'[QK:V2RESUME-RELEASE-FAILURE-LOUD] a release that does not return "released" THROWS — a lock this verb took and could not give back will refuse the next resume or dispatch, and folding it into a green receipt would send the operator looking at the wrong layer',
			thrown !== null && /instead of/.test(String(thrown)) && /clear it by hand/.test(String(thrown)),
		);
	}

	// ══ THE OBSERVATION HELPER, DRIVEN DIRECTLY ═════════════════════════════════════
	{
		let clock = 0;
		let calls = 0;
		const receipt = await observeSameGidSocket(
			GID,
			SOCK,
			{
				inspectSocket: async () => ({ kind: "socket-file", socketPath: SOCK }),
				probeSocket: async () => {
					calls++;
					return calls >= 5 ? "alive" : "dead";
				},
				sleep: async (ms) => {
					clock += ms;
				},
				now: () => clock,
			},
			10_000,
			500,
		);
		ok(
			"the observation returns as soon as the socket answers, and reports how long it actually waited — the number is evidence, not decoration",
			receipt.kind === "socket-alive" && receipt.waitedMs === 2000,
		);
	}

	// ══ CONSTANTS AND BOUNDARIES, ASSERTED ON SOURCE ════════════════════════════════
	{
		const SRC = read("pi-extensions/lib/entwurf-v2-visible-resume.ts");
		// CODE, not prose. The module explains at length why there is no watcher and no retry, so
		// scanning the raw file would forbid the explanation instead of the behaviour.
		const CODE = SRC.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
		ok(
			"the timeout and interval are product constants with no env knob — a tunable would make 'unobserved' mean different things on different hosts and the receipt would stop being comparable",
			RESUME_OBSERVE_TIMEOUT_MS === 30_000 && RESUME_OBSERVE_INTERVAL_MS === 500 && !/process\.env/.test(CODE),
		);
		ok(
			"[QK:V2RESUME-SHARED-ID-GRAMMAR] the address grammar comes from the session-id SSOT, not a local regex — this value becomes a lock path and a control-socket path a few lines later, and a second copy could drift into accepting an id the record or the socket filename would reject",
			/from "\.\/session-id\.js"/.test(CODE) &&
				/isValidSessionId\(targetGardenId\)/.test(CODE) &&
				!/\\d\{8\}T\\d\{6\}/.test(CODE),
		);
		ok(
			"the composition ships no watcher and no retry machinery: no interval timer, no child-process handling, no kill",
			!/setInterval|spawn|child_process|\.kill\(|SIGTERM/.test(CODE),
		);
		ok(
			"production deps wire the real lock, record leaf, socket inspection and probe, and take the launcher as an argument",
			typeof makeVisibleResumeDeps === "function" &&
				/makeVisibleResumeDeps\(\s*launch/.test(SRC) &&
				/resolveResumeLaunchIdentity/.test(SRC),
		);
	}

	console.log(`\ncheck-entwurf-v2-visible-resume: ${passed} checks passed`);
}

main().catch((err) => {
	console.error(`check-entwurf-v2-visible-resume: ${err instanceof Error ? err.message : String(err)}`);
	process.exit(1);
});
