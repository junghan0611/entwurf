/**
 * entwurf-v2-spawn-production — the PRODUCTION `SpawnBgResumeDeps` factory for the 5c-3a
 * spawn-bg watcher (0.11 Stage 0 step 5c-3c). It wires the six injected IO seams the pure
 * watcher (`executeSpawnBgResume`) declares onto the real world: spawn a resume child as a
 * resident citizen, observe its control socket by CONNECTABILITY (not mere existence),
 * watch its exit, time the observe window, and kill on timeout. The watcher's release
 * policy is untouched — this module only supplies the IO.
 *
 * Every seam stays injectable (defaults = the real fns) so a DETERMINISTIC gate drives
 * spawnChild's argv, the exit/timeout/kill wiring, and the socket-alive verdict WITHOUT a
 * real pi spawn or socket — the heavy live path (a real `pi --entwurf-control` resident
 * child + a real unix-socket connect) is proven once by a separate opt-in smoke
 * (`smoke-entwurf-v2-spawn-live`), kept OUT of `pnpm check` so the every-commit loop stays
 * fast and deterministic (D5: chain = deterministic gate; live smoke = phase gate before 5d).
 *
 * The factory does NOT capture `plan` or `lock` (D3): `SpawnBgResumeDeps.spawnChild(plan)`
 * already takes the plan, and the lock is the watcher's authority — it flows to
 * `deps.releaseLock` from the watcher, never from here. A captured plan/lock would be a
 * second authority that could drift from the one the watcher holds.
 *
 * socket-alive = CONNECTABLE, never file-exists (GPT 5c-3c, Q5): inspect the EXACT
 * `plan.expectedSocketPath` (via the path-addressed `inspectControlSocketPath` — no gid
 * re-derivation), map to liveness through the shared `mapInspectionToLiveness`, then apply
 * `socketWatchVerdict`: a connectable socket is alive; a forged address (symlink / not a
 * socket) is rejected IMMEDIATELY (time does not heal a forged path → the watcher's backstop
 * kills and fail-closes to a retained lock); a dead/indeterminate socket keeps waiting (the
 * dormant citizen's stale socket file, or a stall, is "not up yet", not a failure).
 */

import { type ChildProcess, spawn } from "node:child_process";
import * as fs from "node:fs/promises";
import { getEntwurfExplicitExtensions, mirrorChildStderr, readSessionIdentity } from "./entwurf-core.ts";
import { buildResumePiArgs } from "./entwurf-resume-args.ts";
import type { LockClaim } from "./entwurf-v2-lock.ts";
import { releaseLock } from "./entwurf-v2-lock.ts";
import type { SpawnBgPlan, SpawnBgResumeDeps, SpawnedChild } from "./entwurf-v2-spawn.ts";
import { readMetaIdentityByGardenId } from "./meta-session.ts";
import { inspectControlSocketPath, type LstatLike, mapInspectionToLiveness } from "./socket-discovery.ts";
import { probeSocketLiveness, type SocketLiveness } from "./socket-probe.ts";

// ── socketWatchVerdict (pure — the R2 watch policy, gate-pinned) ──────────────
export type SocketWatchVerdict = "alive" | "wait" | "forged";

/**
 * Translate a mapped socket observation into the watcher's poll decision.
 *   - forged  — an address-conflict (symlink / not-a-socket). NOT a transient liveness
 *     state: time cannot turn a forged path into a live socket, so the poll must REJECT
 *     immediately (→ watcher backstop → kill → retained), never keep waiting.
 *   - alive   — a connectable socket. Resolve: the resumed citizen is up.
 *   - wait    — dead (the dormant citizen's stale/absent socket — "not up yet") or
 *     indeterminate (a stall). Keep polling until the socket connects, or the observe
 *     timeout / abort ends the wait.
 */
export function socketWatchVerdict(
	mapped: { liveness: SocketLiveness; socketPath: string } | { addressConflict: true },
): SocketWatchVerdict {
	if ("addressConflict" in mapped) return "forged";
	return mapped.liveness === "alive" ? "alive" : "wait";
}

// ── the spawned child handle (D4) ────────────────────────────────────────────
// A minimal structural view of the process the deps share. The real ChildProcess
// satisfies it; the gate fakes it. The watcher sees only `pid` (SpawnedChild); the
// production deps carry `proc` so awaitChildExit / killChild act on the SAME process.
export interface SpawnedProcHandle {
	pid?: number;
	kill(signal?: NodeJS.Signals | number): boolean;
	on(event: string, listener: (...args: unknown[]) => void): unknown;
	removeListener(event: string, listener: (...args: unknown[]) => void): unknown;
}

interface ProductionSpawnedChild extends SpawnedChild {
	proc: SpawnedProcHandle;
	/** Exit captured EAGERLY at proc creation (B2): the `exit` listener is installed the
	 * instant the proc exists, BEFORE the watcher's awaitChildExit runs, so a child that
	 * exits in the micro-gap between spawnChild resolving and awaitChildExit registering is
	 * never missed (which would pin the lock through timeout→kill→retained). Resolve-ONLY
	 * (never rejects) so it is safe to leave racing an abort in awaitChildExit. */
	exitPromise: Promise<number | null>;
}

/** Narrow a watcher-supplied SpawnedChild back to the production handle. A child that is
 * NOT one we spawned (no `proc` / `exitPromise`) is a mis-wire — fail loud, never no-op. */
function requireProductionChild(child: SpawnedChild): ProductionSpawnedChild {
	const c = child as Partial<ProductionSpawnedChild>;
	if (!c.proc || !c.exitPromise) {
		throw new Error("entwurf-v2-spawn-production: child handle has no proc/exitPromise (mis-wired SpawnBgResumeDeps).");
	}
	return c as ProductionSpawnedChild;
}

// ── launch identity (the spawnChild preamble, one injectable seam) ───────────
/** The launch-time facts buildResumePiArgs needs, resolved from the meta-record + the
 * recorded transcript (record authority, #50 C2/C3); the gate injects a fake so
 * spawnChild's argv is provable without a real session file. */
export interface LaunchIdentity {
	/** The EXACT session JSONL to resume — `pi --session <path>`. */
	sessionFile: string;
	cwd: string;
	explicitExtensionArgs: readonly string[];
	provider: string | null | undefined;
	model: string;
}

/**
 * Resolve launch identity for a resume. The TARGET is now resolved through the
 * meta-record (#50 C2): `gardenId → record.transcriptPath`. It used to be a global
 * header scan for a JSONL whose header id equalled the garden id — which only worked
 * while entwurf forced pi's session id to BE the garden id. With the record minting the
 * address, that scan cannot find anything (a citizen's header carries pi's own uuid), so
 * keeping it would not have been a "smaller change", it would have been a broken one.
 *
 * The record is also the AUTHORIZATION now (#50 C3). The old gates — `requireEntwurf`
 * (an `entwurf` tag in the session NAME, planted by a name mirror that no longer
 * exists) and the sessionId-bound resume-marker env — are deleted. Record-backed pi
 * citizens are all siblings (LOCKED PROTOCOL 6), so "this garden id names a pi citizen
 * with a recorded transcript" is the whole test, PLUS one integrity check: the resumed
 * file's header id must equal `record.nativeSessionId` (pi owns the transcript, the
 * record remembers whose it is — a mismatch means the transcriptPath is stale or
 * foreign, and resuming it would put a turn into a different being's session).
 *
 * Everything else is unchanged authority: readSessionIdentity (first model_change) for
 * provider/model/cwd, getEntwurfExplicitExtensions for bridge re-injection (#29 fail-fast).
 * Throws on anything that makes a resume impossible; each throw becomes the watcher's
 * `spawn-start-failed` (no child to watch → release), never a silent no-op.
 */
export function resolveResumeLaunchIdentity(plan: SpawnBgPlan): LaunchIdentity {
	const record = readMetaIdentityByGardenId(plan.sessionId);
	if (record.backend !== "pi") {
		throw new Error(
			`entwurf-v2-spawn-production: ${plan.sessionId} is a ${record.backend} citizen — spawn-bg resume is the pi rail.`,
		);
	}
	const sessionFile = record.transcriptPath;
	if (!sessionFile) {
		throw new Error(
			`entwurf-v2-spawn-production: ${plan.sessionId} has no recorded transcriptPath — ` +
				`the citizen never wrote a session file (no turn yet), so there is nothing to resume.`,
		);
	}
	const identity = readSessionIdentity(sessionFile);
	const resumeModel = identity?.modelId ?? null;
	if (!identity || !resumeModel) {
		throw new Error(`entwurf-v2-spawn-production: ${plan.sessionId} has no recorded model — cannot resume.`);
	}
	if (identity.sessionId !== record.nativeSessionId) {
		throw new Error(
			`entwurf-v2-spawn-production: ${plan.sessionId} transcript header id "${identity.sessionId ?? "(none)"}" ` +
				`does not match the record's nativeSessionId "${record.nativeSessionId}" — the recorded transcriptPath ` +
				`is stale or points at a foreign session file; refusing to resume another being's transcript.`,
		);
	}
	const explicitExtensions = getEntwurfExplicitExtensions(resumeModel, false, identity.provider);
	if (explicitExtensions.unresolvedAcpIntent) {
		throw new Error(
			`entwurf-v2-spawn-production: ${plan.sessionId} recorded provider=entwurf but the bridge ` +
				`extension could not be resolved — refusing to resume with an unknown provider (#29).`,
		);
	}
	if (!identity.cwd) {
		throw new Error(
			`entwurf-v2-spawn-production: ${plan.sessionId} header has no cwd (the cold-resume authority, #9).`,
		);
	}
	return {
		sessionFile,
		cwd: identity.cwd,
		explicitExtensionArgs: explicitExtensions.args,
		provider: explicitExtensions.provider ?? identity.provider,
		model: explicitExtensions.modelOverride ?? resumeModel,
	};
}

// ── the injectable seams (defaults = the real world) ─────────────────────────
export interface ProductionSpawnOpts {
	/** Poll interval for awaitSocketAlive's wait loop (ms). */
	pollIntervalMs?: number;
	/** Bounded wait, after a kill, for the resulting child-exited (the watcher's killGraceMs). */
	killGraceMs?: number;
	/** Connect-probe timeout for a socket-file inspection (ms). */
	probeTimeoutMs?: number;
	/** Resolve launch identity (default = resolveResumeLaunchIdentity). */
	resolveIdentity?: (plan: SpawnBgPlan) => LaunchIdentity;
	/** Spawn the resume child and return its handle (default = real `pi` spawn + unref +
	 * mirrorChildStderr). The child inherits this process's env untouched — the resume-marker
	 * env the factory used to plant died with the name-mirror guard it authorized (#50 C3).
	 * A throw becomes the watcher's spawn-start-failed. */
	spawnChild?: (cmd: string, args: readonly string[], cwd: string) => SpawnedProcHandle;
	/** lstat for socket inspection (default = fs.lstat). */
	lstatFn?: (p: string) => Promise<LstatLike>;
	/** Connect probe for a socket-file (default = probeSocketLiveness). */
	probeFn?: (socketPath: string) => Promise<SocketLiveness>;
	/** Release the held lock (default = the lock primitive's releaseLock). */
	releaseFn?: (lock: LockClaim) => void;
	/** Timer primitives (default = global setTimeout/clearTimeout) — injected so the gate
	 * proves scheduling + abort-clear deterministically. */
	setTimeoutFn?: (cb: () => void, ms: number) => ReturnType<typeof setTimeout>;
	clearTimeoutFn?: (t: ReturnType<typeof setTimeout>) => void;
}

const DEFAULT_POLL_INTERVAL_MS = 150;
const DEFAULT_KILL_GRACE_MS = 5_000;

/** The default spawnChild: a detached, unref'd `pi` resident child with stderr mirrored —
 * the same launch posture as the legacy worker, minus `--no-extensions` (the argv comes
 * from buildResumePiArgs v2-control). Detached so the resumed citizen survives this parent. */
function defaultSpawnChild(cmd: string, args: readonly string[], cwd: string): SpawnedProcHandle {
	const proc: ChildProcess = spawn(cmd, [...args], {
		cwd,
		shell: false,
		detached: true,
		stdio: ["ignore", "ignore", "pipe"],
	});
	proc.unref();
	mirrorChildStderr(proc);
	return proc;
}

/**
 * Build the production `SpawnBgResumeDeps` the 5c-3a watcher consumes. The factory captures
 * NO plan and NO lock (D3) — both flow through the watcher. Pass `opts` to inject fakes for
 * the deterministic gate; the defaults are the real IO.
 */
export function makeProductionSpawnBgResumeDeps(opts: ProductionSpawnOpts = {}): SpawnBgResumeDeps {
	const pollIntervalMs = opts.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
	const killGraceMs = opts.killGraceMs ?? DEFAULT_KILL_GRACE_MS;
	const resolveIdentity = opts.resolveIdentity ?? resolveResumeLaunchIdentity;
	const spawnChildFn = opts.spawnChild ?? defaultSpawnChild;
	const lstatFn = opts.lstatFn ?? ((p: string) => fs.lstat(p));
	const probeFn =
		opts.probeFn ?? ((socketPath: string) => probeSocketLiveness(socketPath, { timeoutMs: opts.probeTimeoutMs }));
	const releaseFn = opts.releaseFn ?? ((lock: LockClaim) => void releaseLock(lock));
	const setTimeoutFn = opts.setTimeoutFn ?? ((cb, ms) => setTimeout(cb, ms));
	const clearTimeoutFn = opts.clearTimeoutFn ?? ((t) => clearTimeout(t));

	// An abortable delay: resolves after `ms`, or rejects on abort (clearing the timer). Used
	// by both awaitTimeout (the observe/grace deadlines) and the socket poll's inter-poll sleep.
	const abortableDelay = (ms: number, signal: AbortSignal): Promise<void> =>
		new Promise<void>((resolve, reject) => {
			if (signal.aborted) {
				reject(new Error("aborted"));
				return;
			}
			const timer = setTimeoutFn(() => {
				signal.removeEventListener("abort", onAbort);
				resolve();
			}, ms);
			const onAbort = (): void => {
				clearTimeoutFn(timer);
				reject(new Error("aborted"));
			};
			signal.addEventListener("abort", onAbort, { once: true });
		});

	return {
		killGraceMs,

		spawnChild: async (plan: SpawnBgPlan): Promise<SpawnedChild> => {
			const identity = resolveIdentity(plan);
			const args = buildResumePiArgs({
				variant: "v2-control",
				sessionFile: identity.sessionFile,
				explicitExtensionArgs: identity.explicitExtensionArgs,
				provider: identity.provider,
				model: identity.model,
				prompt: plan.prompt,
				launchArgs: plan.launchArgs,
			});
			const proc = spawnChildFn("pi", args, identity.cwd);

			// B2: capture exit EAGERLY — the instant the proc exists, before we even await the
			// spawn — so a fast exit cannot slip through the gap before awaitChildExit. Resolve-
			// only (a signal kill reports null); it never rejects, so racing it against abort is safe.
			const exitPromise = new Promise<number | null>((resolve) => {
				proc.on("exit", (code: unknown) => resolve(typeof code === "number" ? code : null));
			});

			// B1: a started process is NOT guaranteed by `spawn()` returning — a spawn-time
			// failure (ENOENT pi / exec error) arrives as an `error` event, not a sync throw. Wait
			// for the `spawn` event to confirm a real start; an `error` before it rejects, which the
			// watcher turns into spawn-start-failed (release, nothing to watch) — NOT a silent
			// spawn-started that later stalls into a wrongful retained lock.
			await new Promise<void>((resolve, reject) => {
				const onSpawn = (): void => {
					cleanup();
					resolve();
				};
				const onError = (err: unknown): void => {
					cleanup();
					reject(err instanceof Error ? err : new Error(`spawn failed: ${String(err)}`));
				};
				const cleanup = (): void => {
					proc.removeListener("spawn", onSpawn);
					proc.removeListener("error", onError);
				};
				proc.on("spawn", onSpawn);
				proc.on("error", onError);
			});

			const child: ProductionSpawnedChild = { pid: proc.pid, proc, exitPromise };
			return child;
		},

		awaitSocketAlive: async (socketPath: string, signal: AbortSignal): Promise<void> => {
			// Poll the EXACT path (no gid re-derivation). Connectable → resolve; forged →
			// reject NOW; dead/indeterminate → wait one interval and re-poll, until abort.
			while (!signal.aborted) {
				const inspection = await inspectControlSocketPath(socketPath, lstatFn);
				const mapped = await mapInspectionToLiveness(inspection, probeFn);
				const verdict = socketWatchVerdict(mapped);
				if (verdict === "alive") return;
				if (verdict === "forged") {
					throw new Error(
						`entwurf-v2-spawn-production: forged control-socket address at ${socketPath} (never connected).`,
					);
				}
				// wait — sleep one interval, honoring abort (rejects → loop exits below).
				await abortableDelay(pollIntervalMs, signal);
			}
			throw new Error("entwurf-v2-spawn-production: awaitSocketAlive aborted before the socket became alive.");
		},

		awaitChildExit: (child: SpawnedChild, signal: AbortSignal): Promise<number | null> =>
			// Race the EAGER exitPromise (installed at spawn, so a fast exit is already captured —
			// B2) against abort. exitPromise is resolve-only, so the loser never surfaces as an
			// unhandled rejection; only the abort branch rejects.
			new Promise<number | null>((resolve, reject) => {
				const { exitPromise } = requireProductionChild(child);
				if (signal.aborted) {
					reject(new Error("aborted"));
					return;
				}
				const onAbort = (): void => reject(new Error("aborted"));
				signal.addEventListener("abort", onAbort, { once: true });
				exitPromise.then((code) => {
					signal.removeEventListener("abort", onAbort);
					resolve(code);
				});
			}),

		awaitTimeout: (ms: number, signal: AbortSignal): Promise<void> => abortableDelay(ms, signal),

		killChild: (child: SpawnedChild): void => {
			// SIGTERM only this slice — the watcher's killGrace then waits for the resulting
			// child-exited; if none arrives it returns lock-retained (a SIGKILL escalator is a
			// separate policy + smoke). Best-effort: the watcher catches a throw here.
			requireProductionChild(child).proc.kill("SIGTERM");
		},

		releaseLock: (lock: LockClaim): void => releaseFn(lock),
	};
}
