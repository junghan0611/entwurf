/**
 * smoke-entwurf-v2-spawn-resume-live — the 0.11.0 (A) acceptance gate: a REAL `pi` child is
 * spawned by the production spawn-bg resume path, stands its control socket up as a resident,
 * runs the resume turn, and the lock is released exactly once. This is the evidence the whole
 * 0.11.0 "spawn-bg resident lifecycle" headline rests on — every other gate proves a SLICE
 * (the deterministic decider table, the matrix-live transport sentinel, the spawn-live OS
 * substrate watcher), but none has ever watched a real child pi resume and DO a model turn.
 * 5c-3c deferred that proof to "5d"; 5d's matrix-live built only the control/mailbox/guard
 * cells. This smoke closes that acceptance debt — and it is the gate v1 deprecation (0.12)
 * is predicated on: until a real spawn-bg resume is seen LIVE, there is no honest ground to
 * turn the v1 entwurf surface off.
 *
 * The FULL loop (no synthetic stand-in, record authority — #50 C2/C3):
 *   1. seed a REAL dormant pi session: a one-shot `pi --mode json -p --no-extensions` (NO
 *      --session-id / --name — pi owns its id and name, LOCKED PROTOCOL 2) writes a saved
 *      session JSONL into the REAL `~/.pi/agent/sessions`. No control socket survives the
 *      one-shot → the citizen-to-be is DORMANT.
 *   2. mint the `backend=pi` meta-record in a temp store from the SEED's OWN identity:
 *      nativeSessionId = the seed's JSONL header id, transcriptPath = the seed file. The
 *      record's gardenId is the citizen's address; resolveResumeLaunchIdentity resolves the
 *      transcript from the record and verifies header id === nativeSessionId (C3).
 *   3. drive the production `runEntwurfV2({intent:"owned-outcome"})` → the decider routes a
 *      dormant in-domain pi citizen to spawn-bg resume (DISPATCH_TABLE owned-outcome×dormant) →
 *      the production spawn factory launches a REAL detached `pi --entwurf-control` resume child.
 *   4. assert: result = executed/spawn-bg/socket-alive/released; the lock was released EXACTLY
 *      once (release-seam counter) and no lock file remains; the resident pid is alive and its
 *      socket is connectable.
 *   5. assert the child actually WORKED: poll the same session JSONL for the resume USER nonce
 *      (the turn was injected) and then the assistant OK nonce (the model actually replied) —
 *      socket-alive alone would prove "process up", not "resumed and did a turn".
 *
 * model-in-loop is IN here (unlike matrix-live, which is a transport/lock sentinel): the
 * assistant nonce is the whole point — a resume that stands a socket up but never produces a
 * model turn is not a resumed citizen. So this is LIVE-only and OUT of `pnpm check`; honest
 * SKIP when LIVE!=1 (a release-gate that hard-fails without auth/model is unrunnable
 * unattended — skip is CI safety, NOT an acceptance PASS).
 *   ENTWURF_LIVE_TARGET   = "<provider>/<model>"  (default "openai-codex/gpt-5.4")
 *   ENTWURF_SPAWN_RESUME_ASSISTANT_TIMEOUT_MS  (default 180000)
 *   LIVE=1 ./run.sh smoke-entwurf-v2-spawn-resume-live
 *
 * Automation seams: the resident child is reaped (SIGTERM→socket-gone poll→SIGKILL) and its
 * real control socket removed in `finally`; the ONE seed session file is deleted on a clean
 * pass (never the whole real sessions dir) and PRESERVED with its path printed on failure,
 * alongside the temp world / gid / lock path / pi seed stderr tail.
 */

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import * as fsp from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import type { SenderEnvelope } from "../pi-extensions/lib/entwurf-control-rpc.ts";
import { readSessionIdentity } from "../pi-extensions/lib/entwurf-core.ts";
import { type LockClaim, lockPathFor, releaseLock as realReleaseLock } from "../pi-extensions/lib/entwurf-v2-lock.ts";
import { makeProductionEntwurfV2Deps } from "../pi-extensions/lib/entwurf-v2-production.ts";
import type { EntwurfV2RunResult } from "../pi-extensions/lib/entwurf-v2-runner.ts";
import { runEntwurfV2 } from "../pi-extensions/lib/entwurf-v2-runner.ts";
import { resolveResumeLaunchIdentity } from "../pi-extensions/lib/entwurf-v2-spawn-production.ts";
import { upsertMetaSession } from "../pi-extensions/lib/meta-session.ts";
import { controlSocketPath } from "../pi-extensions/lib/socket-discovery.ts";

// pi owns the canonical control-socket dir; the resume child opens its socket HERE and the
// decider's expectedSocketPath is built from the SAME dir — they must coincide (a fresh gid
// keeps us off any live session's path; cleanup only ever touches our own gid's socket).
const REAL_CONTROL_DIR = path.join(os.homedir(), ".pi", "entwurf-control");
const SOCKET_SUFFIX = ".sock";
// Release-gate topology: repo-under-test, not deployment smoke. The spawned
// resident must load this checkout's extension, independent of global pi packages.
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const REPO_EXTENSION_ARGS = ["--no-extensions", "-e", REPO_ROOT] as const;

const SEED_TIMEOUT_MS = 120_000; // F5: a real seed model turn can be slow.
const OBSERVE_TIMEOUT_MS = 30_000; // spawn-bg watcher's socket-alive observe window.
const SEED_IDENTITY_POLL_MS = 10_000; // GPT pin: defend against seed file flush/rename timing.
const USER_TURN_TIMEOUT_MS = 60_000;
const ASSISTANT_TURN_TIMEOUT_MS = (() => {
	const n = Number(process.env.ENTWURF_SPAWN_RESUME_ASSISTANT_TIMEOUT_MS);
	return Number.isFinite(n) && n > 0 ? n : 180_000;
})();
const POLL_MS = 250;

let passed = 0;
const artifacts: Record<string, string> = {};

function ok(label: string, cond: boolean): void {
	if (!cond) throw new Error(`SMOKE FAIL: ${label}`);
	console.log(`  ok    ${label}`);
	passed++;
}

function resolveTarget(): { provider: string; model: string } {
	const combined = process.env.ENTWURF_LIVE_TARGET?.trim();
	if (combined) {
		const slash = combined.indexOf("/");
		if (slash <= 0 || slash === combined.length - 1) {
			throw new Error(`ENTWURF_LIVE_TARGET must be "<provider>/<model>", got: ${JSON.stringify(combined)}`);
		}
		return { provider: combined.slice(0, slash), model: combined.slice(slash + 1) };
	}
	return {
		provider: process.env.ENTWURF_LIVE_PROVIDER?.trim() || "openai-codex",
		model: process.env.ENTWURF_LIVE_MODEL?.trim() || "gpt-5.4",
	};
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

function pidAlive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}

// Tear the detached resident down for real: SIGTERM, wait for both the pid to die AND the
// socket to disappear, then a SIGKILL backstop. The child is detached (no ChildProcess handle),
// so liveness is observed via `kill(pid, 0)` + the socket file, not an `exit` event.
async function terminateResident(pid: number, sockPath: string, graceMs = 3_000): Promise<void> {
	try {
		process.kill(pid, "SIGTERM");
	} catch {
		return; // already gone
	}
	const deadline = Date.now() + graceMs;
	while (Date.now() < deadline) {
		if (!pidAlive(pid) && !existsSync(sockPath)) return;
		await sleep(POLL_MS);
	}
	try {
		process.kill(pid, "SIGKILL");
	} catch {
		// already gone
	}
}

// Where pi's one-shot seed lands its session JSONL: the REAL agent sessions base,
// under the cwd-encoded dir for our unique temp cwd. The encoding is pi's layout
// ("--" + cwd with "/"→"-" + "--"); the temp cwd is unique to this run, so the
// dir contains ONLY our seed and removing it on success can touch nothing else.
function seedSessionDirFor(cwd: string): string {
	const encoded = `--${cwd.replace(/^\//, "").replace(/\//g, "-")}--`;
	return path.join(os.homedir(), ".pi", "agent", "sessions", encoded);
}

// The seed's own identity: header line of the one .jsonl pi wrote for our cwd.
// A local helper, not an entwurf-core import — the header-scan lookup died with
// C3; this reads pi's file for SEEDING purposes only (the production resume path
// never scans, it follows record.transcriptPath).
function readSeedHeader(file: string): { id?: string; cwd?: string } | null {
	try {
		const first = readFileSync(file, "utf8").split("\n", 1)[0]?.trim();
		if (!first) return null;
		const entry = JSON.parse(first) as { type?: string; id?: unknown; cwd?: unknown };
		if (entry.type !== "session") return null;
		return {
			id: typeof entry.id === "string" && entry.id ? entry.id : undefined,
			cwd: typeof entry.cwd === "string" && entry.cwd ? entry.cwd : undefined,
		};
	} catch {
		return null;
	}
}

function smokeSender(gardenId: string, cwd: string): SenderEnvelope {
	return {
		sessionId: gardenId,
		agentId: "smoke/spawn-resume-live",
		cwd,
		timestamp: new Date(0).toISOString(),
		origin: "pi-session",
		replyable: false,
	};
}

// Read the session JSONL and search ONLY the lines appended after the seed (append-only rigor:
// the resume nonces are unique so a whole-file scan would also be correct, but slicing past the
// seed line count proves the turn was added by the RESUME, not pre-existing). JSON-parse each
// line and match on the stringified entry — never assume a type/role shape (GPT pin 7).
async function pollForNonce(
	sessionFile: string,
	seedLineCount: number,
	needle: string,
	timeoutMs: number,
): Promise<boolean> {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		const lines = readFileSync(sessionFile, "utf8")
			.split("\n")
			.filter((l) => l.trim());
		for (const line of lines.slice(seedLineCount)) {
			let entry: unknown;
			try {
				entry = JSON.parse(line);
			} catch {
				continue;
			}
			if (JSON.stringify(entry).includes(needle)) return true;
		}
		await sleep(POLL_MS);
	}
	return false;
}

async function main(): Promise<void> {
	if (process.env.LIVE !== "1") {
		console.log(
			"[smoke-entwurf-v2-spawn-resume-live] skipped — set LIVE=1 to run (spawns a real pi child + opens a real socket).",
		);
		return;
	}

	const { provider, model } = resolveTarget();
	// ACP override is OUT of scope for 0.11.0 (A): `--no-extensions --provider entwurf` is a
	// broken combination, and this smoke proves spawn-bg resident lifecycle, not backend equality.
	if (provider === "entwurf") {
		throw new Error(
			"spawn-resume-live: provider=entwurf is out of scope for 0.11.0 (A) — use a native target (e.g. openai-codex/gpt-5.4).",
		);
	}
	console.log(`[smoke-entwurf-v2-spawn-resume-live] target = ${provider}/${model}`);

	// ── temp world (META store / mailbox / locks are temp; pi's SESSION JSONL is REAL) ──
	const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), "v2resume-"));
	const sessionsDir = path.join(tmp, "meta-sessions");
	const mailboxDir = path.join(tmp, "mailbox");
	const lockDir = path.join(tmp, "locks");
	for (const d of [sessionsDir, mailboxDir, lockDir]) await fsp.mkdir(d, { recursive: true });
	process.env.ENTWURF_META_SESSIONS_DIR = sessionsDir;
	process.env.ENTWURF_META_MAILBOX_DIR = mailboxDir;

	let gid = "";
	let seedFile: string | null = null;
	let childPid: number | null = null;
	let seedStderrTail = "";
	let succeeded = false;

	// ── release-seam wrapper (F2): the production factory builds ONE shared `release` closure
	// from `seams.releaseLock` and injects it into the decider AND the spawn watcher's releaseFn,
	// so this single wrapper counts the spawn-bg release too. Production code is unchanged. ──
	let releaseCount = 0;
	const releasedGids: string[] = [];

	try {
		// ── 1. seed a REAL dormant pi session (one-shot; pi owns id + name — no
		//       --session-id / --name, LOCKED PROTOCOL 2) ──
		const nonce = `${process.pid.toString(36)}${Date.now().toString(36)}`;
		artifacts["nonce"] = nonce;
		const seedArgs = [
			"--mode",
			"json",
			"-p",
			"--no-extensions",
			"--approve",
			"--provider",
			provider,
			"--model",
			model,
			`Reply exactly SEED_READY_${nonce} and nothing else.`,
		];
		const seed = spawnSync("pi", seedArgs, { cwd: tmp, encoding: "utf8", timeout: SEED_TIMEOUT_MS, env: process.env });
		seedStderrTail = `${seed.stdout ?? ""}\n${seed.stderr ?? ""}`.split("\n").slice(-12).join("\n");
		ok("seed pi one-shot exited 0", seed.status === 0);

		// ── 2. discover the seed's OWN identity (file + header id) and mint the record ──
		// The temp cwd is unique to this run, so pi's cwd-encoded session dir holds
		// exactly our seed. Poll briefly: the JSONL flush/rename can lag process exit.
		const seedDir = seedSessionDirFor(tmp);
		artifacts["seedDir"] = seedDir;
		let seedHeaderId: string | undefined;
		let identity: ReturnType<typeof readSessionIdentity> = null;
		{
			const deadline = Date.now() + SEED_IDENTITY_POLL_MS;
			while (Date.now() < deadline) {
				let jsonls: string[] = [];
				try {
					jsonls = (await fsp.readdir(seedDir)).filter((f) => f.endsWith(".jsonl"));
				} catch {
					/* dir not created yet */
				}
				if (jsonls.length === 1) {
					const file = path.join(seedDir, jsonls[0]);
					const header = readSeedHeader(file);
					const id = readSessionIdentity(file);
					if (header?.id && id?.modelId && id.provider && id.cwd) {
						seedFile = file;
						seedHeaderId = header.id;
						identity = id;
						break;
					}
				} else if (jsonls.length > 1) {
					throw new Error(`seed dir ${seedDir} holds ${jsonls.length} sessions — expected exactly the one seed.`);
				}
				await sleep(POLL_MS);
			}
		}
		artifacts["seedFile"] = seedFile ?? "(none)";
		ok("seed session file discovered under the seed cwd dir", seedFile !== null);
		ok("seed header carries pi's own session id", typeof seedHeaderId === "string" && seedHeaderId.length > 0);
		ok("seed recorded a resumable identity", identity !== null);
		ok("seed header cwd === temp cwd (cold-resume authority, #9)", identity?.cwd === tmp);
		ok("seed recorded provider matches the target", identity?.provider === provider);
		ok("seed recorded modelId matches the target", identity?.modelId === model);
		ok("seed header id === readSessionIdentity id (one reader, one truth)", identity?.sessionId === seedHeaderId);

		// The record is minted FROM the seed's identity: nativeSessionId = pi's own
		// header id, transcriptPath = the seed file (what a real turn_end records).
		// Its gardenId is the citizen's address — never pi's session id (#50 C2).
		const minted = upsertMetaSession({
			input: {
				backend: "pi",
				nativeSessionId: seedHeaderId as string,
				cwd: tmp,
				model,
				transcriptPath: seedFile,
			},
			dir: sessionsDir,
		});
		gid = minted.record.gardenId;
		artifacts["gid"] = gid;
		const sockPath = path.join(REAL_CONTROL_DIR, `${gid}${SOCKET_SUFFIX}`);
		artifacts["socket"] = sockPath;
		artifacts["lock"] = lockPathFor(gid, lockDir);
		ok("record gardenId is not pi's session id (record mints the address)", gid !== seedHeaderId);
		ok("fresh gid has no pre-existing control socket", !existsSync(controlSocketPath(gid, REAL_CONTROL_DIR)));

		// resume-time append boundary: count seed lines so the nonce poll scans ONLY the resume.
		const seedLineCount = readFileSync(seedFile as string, "utf8")
			.split("\n")
			.filter((l) => l.trim()).length;

		// dormant precondition: the one-shot left NO live control socket behind.
		ok("seed left no live control socket (citizen is dormant)", !existsSync(sockPath));

		// ── 4. drive the production owned-outcome resume → real spawn-bg child ──
		const prodDeps = makeProductionEntwurfV2Deps({
			senderProvider: () => smokeSender(gid, tmp),
			sessionsDir,
			mailboxDir,
			lockDir,
			controlSocketDir: REAL_CONTROL_DIR,
			prefixRoots: [tmp], // F4: preflight allow for a resume into the temp cwd.
			observeTimeoutMs: OBSERVE_TIMEOUT_MS,
			seams: {
				releaseLock: (claim: LockClaim, deps: { dir?: string }) => {
					releaseCount++;
					releasedGids.push(claim.gardenId);
					return realReleaseLock(claim, deps);
				},
				spawnOverrides: {
					resolveIdentity: (plan) => {
						const launch = resolveResumeLaunchIdentity(plan);
						return {
							...launch,
							explicitExtensionArgs: [...REPO_EXTENSION_ARGS, ...launch.explicitExtensionArgs],
						};
					},
				},
			},
		});

		const userNeedle = `V2_SPAWN_RESUME_USER_${nonce}`;
		const okNeedle = `V2_SPAWN_RESUME_OK_${nonce}`;
		// `pollForNonce` scans the stringified entry regardless of role, so the USER prompt must NOT
		// contain the contiguous okNeedle — otherwise the assistant poll passes the instant the user
		// turn is appended (a false "model replied", GPT blocker 1). Ask the model to CONCATENATE the
		// two parts with no separator so only a real assistant turn yields the contiguous okNeedle.
		const resumeMessage =
			`${userNeedle}\n` +
			`Reply with exactly these two parts concatenated, no separator and nothing else: ` +
			`the literal "V2_SPAWN_RESUME_OK_" then "${nonce}".`;
		ok("resume prompt does not contain the contiguous assistant OK nonce", !resumeMessage.includes(okNeedle));
		const result: EntwurfV2RunResult = await runEntwurfV2(
			{ target: gid, intent: "owned-outcome", message: resumeMessage },
			prodDeps,
		);

		// ── result PASS = executed / spawn-bg / socket-alive / released (F5 + GPT pin 4) ──
		ok(
			"owned-outcome on a dormant pi citizen executed a spawn-bg resume",
			result.kind === "executed" && result.transport === "spawn-bg",
		);
		if (result.kind !== "executed" || result.outcome.transport !== "spawn-bg") {
			throw new Error("spawn-resume-live: result was not an executed spawn-bg outcome (see asserts above).");
		}
		const sb = result.outcome.result;
		// GPT blocker 2: capture any available pid BEFORE the socket-alive narrowing throws — a
		// `lock-retained` outcome carries `diagnostic.pid` of a child the watcher killed but could
		// not confirm dead, so a fail-path throw must still hand the finally a pid to reap.
		const maybePid =
			"pid" in sb && typeof sb.pid === "number"
				? sb.pid
				: sb.kind === "lock-retained" && typeof sb.diagnostic.pid === "number"
					? sb.diagnostic.pid
					: null;
		if (maybePid !== null && maybePid > 0) {
			childPid = maybePid;
			artifacts["childPid"] = String(maybePid);
		}
		ok(
			"spawn-bg observed socket-alive (resident lifecycle, not child-exited/lock-retained)",
			sb.kind === "socket-alive",
		);
		if (sb.kind !== "socket-alive") {
			throw new Error(`spawn-resume-live: spawn-bg result was ${sb.kind}, not socket-alive.`);
		}
		ok("spawn-bg released the lock on socket-alive", sb.released === true);
		const pid = sb.pid;
		ok("resident pid is a real live pid", typeof pid === "number" && pid > 0);

		// release accounting (F2): exactly one release, for THIS gid, and no lock file remains.
		ok("lock released exactly once", releaseCount === 1);
		ok("the single release was for the target gid", releasedGids.length === 1 && releasedGids[0] === gid);
		ok("no lock file remains for the target", !existsSync(lockPathFor(gid, lockDir)));

		// resident "still standing" re-check (GPT pin 4): pid alive AND socket connectable-present.
		ok("resident pid is still alive after the watcher returned", childPid !== null && pidAlive(childPid));
		ok("resident control socket is present at the canonical path", existsSync(sockPath));

		// ── 5. the child actually resumed AND did a model turn (the acceptance core) ──
		const userSeen = await pollForNonce(seedFile as string, seedLineCount, userNeedle, USER_TURN_TIMEOUT_MS);
		ok("resume USER nonce appended to the session (the turn was injected)", userSeen);
		const okSeen = await pollForNonce(seedFile as string, seedLineCount, okNeedle, ASSISTANT_TURN_TIMEOUT_MS);
		ok("resume ASSISTANT OK nonce appended (the model actually replied — real work)", okSeen);

		succeeded = true;
		console.log(
			`\nsmoke-entwurf-v2-spawn-resume-live: ${passed} checks passed (real pi resume + model turn + lock release)`,
		);
	} catch (err) {
		console.error("\n[smoke-entwurf-v2-spawn-resume-live] FAILED — diagnostic artifacts:");
		for (const [k, v] of Object.entries(artifacts)) console.error(`  ${k} = ${v}`);
		console.error(`  releaseCount = ${releaseCount}  releasedGids = ${JSON.stringify(releasedGids)}`);
		if (seedStderrTail.trim())
			console.error(`  seed pi stdout/stderr (tail):\n${seedStderrTail.replace(/^/gm, "    ")}`);
		throw err;
	} finally {
		// reap the detached resident + its real socket (always — even on a clean pass).
		if (childPid !== null && gid) {
			await terminateResident(childPid, path.join(REAL_CONTROL_DIR, `${gid}${SOCKET_SUFFIX}`)).catch(() => {});
		}
		if (gid) {
			await fsp.rm(path.join(REAL_CONTROL_DIR, `${gid}${SOCKET_SUFFIX}`), { force: true }).catch(() => {});
		}
		if (succeeded) {
			// delete ONLY the one seed session file we created (never the real sessions dir).
			if (seedFile) {
				await fsp.rm(seedFile, { force: true }).catch(() => {});
				// pi nests the seed under a cwd-hash subdir keyed by our unique temp cwd, so removing
				// it IF-empty leaves no litter and can never touch another session (rmdir refuses a
				// non-empty dir — belt for a surprise sibling file).
				await fsp.rmdir(path.dirname(seedFile)).catch(() => {});
			}
			await fsp.rm(tmp, { recursive: true, force: true }).catch(() => {});
		} else {
			console.error(`[smoke-entwurf-v2-spawn-resume-live] temp world preserved for inspection: ${tmp}`);
			if (seedFile) console.error(`[smoke-entwurf-v2-spawn-resume-live] seed session PRESERVED: ${seedFile}`);
		}
	}
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
