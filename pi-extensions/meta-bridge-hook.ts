/**
 * meta-bridge-hook — the Claude Code native-session entry shell (1.0.0 step 4).
 *
 * THE load-bearing hook. Shipped inside a plugin bundle whose `hooks/hooks.json`
 * wires it to `SessionStart` (and `CwdChanged` / `UserPromptSubmit`). Because a
 * plugin's hooks load at STARTUP (a bare skill's load only on invocation, after
 * SessionStart has passed), this fires on every native Claude Code open and makes
 * that session a garden citizen WITHOUT any pi JSONL of its own:
 *
 *   stdin {session_id, transcript_path, cwd}  (Claude hook envelope)
 *     -> upsertMetaSession(claude-code)        idempotent create/attach the record
 *        -> gardenId                           the session's garden address
 *     -> arm watchPath <mailbox>/<gardenId>/inbox.signal   idle-wake doorbell
 *     -> stdout hookSpecificOutput.watchPaths  (SessionStart / CwdChanged only)
 *
 * The record is keyed/looked-up by `native_session_id` (THE authority,
 * scanIdentityByNativeId); the idle-wake mailbox is keyed by GARDEN id — that is the
 * whole point of the meta-bridge over the raw per-session prototype: one garden
 * address a sender can target, decoupled from the backend's native id grammar.
 *
 * FAILURE POLICY (decided, see NEXT.md step 4): the runtime hook is
 * BEST-EFFORT + LOG. It never screams into the user's terminal and never blocks
 * startup — on any error it appends a line to `<pi-agent-dir>/meta-bridge-hook.log`
 * and emits an empty `{}` (no arm). The fail-LOUD surface is the doctor
 * (step 5), which reads that log + the meta-record dir to catch a silent miss.
 *
 * watchPaths can be emitted only from SessionStart / CwdChanged / FileChanged, so
 * a UserPromptSubmit fire does a degraded RECORD backfill (upsert) but cannot
 * re-arm the idle watch — the record's address is restored, the wake is not.
 *
 * LAUNCH: never invoked directly by Claude. `hooks.json` declares the EXEC form
 * (`command` = `<plugin-root>/scripts/hook-launch.sh`, `args` = [node, this file]),
 * and the launcher `exec`s that argv — so this process inherits the launcher's pid
 * and its parent is Claude itself. See hook-launch.sh for why the launcher is the
 * fail-loud that an older Claude's silent `args` drop otherwise denies us.
 *
 * Run (dev clone): `<node> <plugin-root>/meta-bridge-hook.ts` (Node 24 strips types).
 * Run (installed):  `<node> <plugin-root>/meta-bridge-hook.js` — the tsc-emitted
 * closure (build-bridge → dist), because Node REFUSES strip-types on a `.ts` below
 * node_modules (ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING). The installer picks
 * the artifact by layout (0.12.5), mirroring start.sh / store-doctor.
 * Imports `./lib/meta-session.ts` (+ `./lib/session-id.js`); `rewriteRelativeImportExtensions`
 * rewrites that to `./lib/meta-session.js` in the emitted closure. The installer
 * copies the lib dir alongside this file so `${CLAUDE_PLUGIN_ROOT}` self-locates it.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import {
	defaultMetaMailboxDir,
	defaultMetaSessionsDir,
	type MetaReceiverArmProvenance,
	upsertMetaSession,
	writeMetaReceiverMarker,
	writeMetaSenderMarker,
} from "./lib/meta-session.ts";

/**
 * Append a best-effort diagnostic line; swallow even its own failure (never throw
 * from the hook). Every line carries a LEVEL token so the doctor — the fail-loud
 * surface — can mechanically tell a silent miss from routine noise:
 *   - ERROR: this session did NOT become a garden citizen (or lost its wake).
 *            The doctor must treat a recent ERROR as a failure (blocker #2).
 *   - WARN : the session registered, but something nearby is off (a corrupt
 *            neighbour record skipped during scan, or a degraded UserPromptSubmit
 *            backfill — note a degraded SessionStart/CwdChanged is ERROR, since
 *            those are the events that actually establish/refresh citizenship).
 *   - INFO : normal create/attach/arm.
 * The token sits right after the ISO timestamp, so ` ERROR ` is a clean grep.
 */
type LogLevel = "INFO" | "WARN" | "ERROR";
function logLine(level: LogLevel, message: string): void {
	try {
		// dirname(meta-sessions) == the pi agent dir — no extra resolver export needed.
		const file = path.join(path.dirname(defaultMetaSessionsDir()), "meta-bridge-hook.log");
		fs.mkdirSync(path.dirname(file), { recursive: true });
		fs.appendFileSync(file, `${new Date().toISOString()} ${level} ${message}\n`);
	} catch {
		/* logging is best-effort; a broken log must not break the session */
	}
}

/** Emit a hook response on stdout and exit 0. `{}` means "did nothing, do not block startup". */
function emit(payload: Record<string, unknown>): never {
	process.stdout.write(`${JSON.stringify(payload)}\n`);
	process.exit(0);
}

/**
 * Map the hook event to a receiver-marker arm provenance. ONLY the genuinely
 * arm-capable events map; any other (a future/unknown hook event) returns null so we
 * never mint an "active receiver" presence we cannot back — fail-closed, not an
 * optimistic session-start. UserPromptSubmit never reaches here (it early-returns
 * before the arm block).
 */
function armProvenanceFor(eventName: string): MetaReceiverArmProvenance | null {
	if (eventName === "SessionStart") return "session-start";
	if (eventName === "CwdChanged") return "cwd-changed";
	if (eventName === "FileChanged") return "file-changed";
	return null;
}

/**
 * Set by `hook-launch.sh` immediately before it `exec`s this payload. It carries no
 * identity — only the fact that the authorized launch path was actually taken.
 */
const META_HOOK_LAUNCH_ENV = "ENTWURF_META_HOOK_LAUNCH";
const META_HOOK_LAUNCH_TOKEN = "hook-launch/v1";

/**
 * Resolve the native host pid: under the EXEC-FORM launch contract it is simply
 * this process's parent — but only once we know the exec-form launch path was taken.
 *
 * There is no `$PPID` carrier and no ancestry walk any more, and their removal is
 * a narrowing of trust, not a loosening of it. Those existed to survive a shell
 * that Claude chose and a command string Claude assembled — under that regime the
 * parent could be Claude OR a retained `/bin/bash -c` wrapper, so a configured
 * number had to be cross-checked against the real process tree.
 *
 * The exec form removes the shell from the path entirely (#51 B2, 2026-07-22:
 * `args` elements arrive verbatim, a literal `${HOME}` is never expanded, and the
 * hook's parent is the Claude process). `hook-launch.sh` then `exec`s this payload,
 * which preserves the pid, so the parent stays Claude on every POSIX host —
 * structurally, not conditionally. Two gates hold that chain up:
 *   - `check-hook-launch-topology` drives the shipped launcher for real and
 *     asserts the payload's parent is the process that exec'd the launcher;
 *   - `doctor-meta-bridge` requires the INSTALLED manifest to equal the shipped
 *     template (modulo the two baked values), so a hand-edit back to shell form is
 *     RED before it can reach this code.
 *
 * Two things the form cannot guarantee are still checked here, and both fail CLOSED.
 *
 * 1. LAUNCH PROVENANCE. `process.ppid` is only the Claude owner when this hook was
 *    reached through `hook-launch.sh`. The case that breaks it is the upgrade
 *    mismatch: an already-open Claude session holds the OLD cached hook command, so
 *    after a reinstall it invokes this NEW hook through the OLD shell form, where the
 *    parent may be a retained wrapper. The retired `$PPID` carrier used to fail closed
 *    there merely by being absent, and removing it without a replacement reopened the
 *    hole (cross-review, 2026-07-22). The launcher therefore stamps an explicit token;
 *    no token means we do not know what our parent is, so we claim nothing.
 * 2. A PLAUSIBLE LIVE PARENT. A reparented orphan (ppid 0/1) is not an owner, and
 *    minting a marker for init would be exactly the "blind ancestor" false-positive
 *    the old ancestry walk existed to prevent.
 *
 * Failing closed costs only reply-addressability, and the doctor sees the ERROR. The
 * opposite — a marker keyed to a transient wrapper — is a lie a sender acts on.
 */
function resolveMetaHookOwnerPid(): number | null {
	if (process.env[META_HOOK_LAUNCH_ENV] !== META_HOOK_LAUNCH_TOKEN) return null;
	const ownerPid = process.ppid;
	if (!Number.isSafeInteger(ownerPid) || ownerPid <= 1) return null;
	return ownerPid;
}

function main(): void {
	let raw: string;
	try {
		raw = fs.readFileSync(0, "utf8"); // fd 0 = stdin (the Claude hook envelope)
	} catch (err) {
		logLine("ERROR", `stdin read failed: ${err instanceof Error ? err.message : String(err)}`);
		emit({});
	}

	let env: Record<string, unknown>;
	try {
		const parsed = JSON.parse(raw);
		if (typeof parsed !== "object" || parsed === null) throw new Error("envelope is not an object");
		env = parsed as Record<string, unknown>;
	} catch (err) {
		logLine("ERROR", `envelope parse failed: ${err instanceof Error ? err.message : String(err)}`);
		emit({});
	}

	const sessionId = typeof env.session_id === "string" ? env.session_id : "";
	const transcriptPath = typeof env.transcript_path === "string" ? env.transcript_path : "";
	// cwd: prefer the envelope's, fall back to the process cwd (the hook runs in the session's cwd).
	const cwd = typeof env.cwd === "string" && env.cwd.length > 0 ? env.cwd : process.cwd();
	const modelEnvelope = env.model;
	const model =
		typeof modelEnvelope === "object" &&
		modelEnvelope !== null &&
		typeof (modelEnvelope as { id?: unknown }).id === "string"
			? (modelEnvelope as { id: string }).id
			: typeof env.model_id === "string"
				? env.model_id
				: undefined;
	const eventName = typeof env.hook_event_name === "string" ? env.hook_event_name : "SessionStart";

	if (!sessionId || !transcriptPath) {
		// A degraded envelope: cannot mint an honest reference record. Log + no-op
		// rather than write a half-record or guess a transcript path. LEVEL depends
		// on the event: a degraded SessionStart / CwdChanged means the session FAILED
		// to become (or refresh) a garden citizen — that is the silent registration
		// miss the doctor must catch (blocker #2), so ERROR. UserPromptSubmit only
		// ever does a best-effort record backfill, so a degraded one is just WARN.
		const degradedLevel = eventName === "UserPromptSubmit" ? "WARN" : "ERROR";
		logLine(
			degradedLevel,
			`degraded envelope (event=${eventName}, session_id=${sessionId ? "set" : "MISSING"}, transcript_path=${transcriptPath ? "set" : "MISSING"})`,
		);
		emit({});
	}

	let gardenId: string;
	try {
		const result = upsertMetaSession({
			input: { backend: "claude-code", nativeSessionId: sessionId, transcriptPath, cwd, model },
			onSkip: (filename, e) => logLine("WARN", `scan skipped ${filename}: ${e.message}`),
		});
		gardenId = result.record.gardenId;
		logLine("INFO", `${result.action} record ${path.basename(result.path)} (event=${eventName}, native=${sessionId})`);
	} catch (err) {
		// Best-effort: a broken record store must surface via the doctor, not by
		// breaking the user's session open. Log and continue with no arm. This is
		// the silent-registration-miss (blocker #2): the session opened fine but is
		// NOT a garden citizen — the doctor catches it via this ERROR line.
		logLine(
			"ERROR",
			`upsert failed (event=${eventName}, native=${sessionId}): ${err instanceof Error ? err.message : String(err)}`,
		);
		emit({});
	}

	// Sender marker, keyed by the shared Claude Code owner pid: the user-scope
	// MCP child (same Claude owner; the exec form leaves no hook shell wrapper) reads
	// it at entwurf_v2 send time to promote this
	// session from anonymous external-mcp to a REPLYABLE meta-session sender —
	// process ancestry, not cwd inference (same repo + multiple sessions would be
	// ambiguous). Best-effort: a failed marker only costs reply-addressability
	// (WARN), it does not break the session or the receiver path.
	//
	// SE-1/SE-2 owner join: under the exec-form launch contract the owner IS this
	// hook's parent — Claude execs `hook-launch.sh`, which `exec`s this payload and
	// so hands it the same pid whose parent is Claude. No shell is involved on any
	// host, so there is no wrapper to mistake for the owner and nothing to carry in
	// an env var. Missing launcher provenance or an implausible parent yields no marker.
	const ownerPid = resolveMetaHookOwnerPid();
	if (ownerPid !== null) {
		try {
			writeMetaSenderMarker({ backend: "claude-code", gardenId, nativeSessionId: sessionId, cwd, ownerPid });
			logLine("INFO", `sender marker ${ownerPid} -> ${gardenId} (event=${eventName})`);
		} catch (err) {
			logLine(
				"WARN",
				`sender marker write failed (event=${eventName}, pid=${ownerPid}, garden=${gardenId}): ${err instanceof Error ? err.message : String(err)}`,
			);
		}
	} else {
		logLine(
			"ERROR",
			process.env[META_HOOK_LAUNCH_ENV] !== META_HOOK_LAUNCH_TOKEN
				? `exec-launch provenance missing (${META_HOOK_LAUNCH_ENV}); this hook was NOT reached through hook-launch.sh, so its parent is not a trustworthy owner — an already-open Claude session still holding the OLD cached command does this. Reinstall the meta-bridge and RESTART that session. sender/receiver identity not armed (event=${eventName}, garden=${gardenId})`
				: `no plausible native owner: parent pid ${process.ppid} is not a live owner (reparented orphan?); sender/receiver identity not armed (event=${eventName}, garden=${gardenId})`,
		);
	}

	// watchPaths is emittable only from SessionStart / CwdChanged / FileChanged.
	// UserPromptSubmit reaches here only to backfill the record above; it must NOT
	// claim to arm a watch it cannot (decided).
	if (eventName === "UserPromptSubmit") {
		emit({});
	}

	try {
		const mailbox = path.join(defaultMetaMailboxDir(), gardenId);
		fs.mkdirSync(mailbox, { recursive: true });
		const signal = path.join(mailbox, "inbox.signal");
		if (!fs.existsSync(signal)) fs.writeFileSync(signal, "", { mode: 0o600 });
		logLine("INFO", `armed watch ${signal}`);
		// Receiver presence marker (SE-2): written on the arm-capable hook path that
		// emits watchPaths, keyed by garden id with the Claude owner pid this hook's
		// exec-form parent gives it — the same single owner as the sender marker, on
		// every host, because no shell exists on the launch path to sit in between.
		// It records that a LIVE owner reached the watch-arm emit; it is not proof the
		// host ack'd the watch registration. This is what lets a sender
		// tell a live receiver from a terminated one whose record still lingers.
		// Best-effort: a failed/skipped marker only costs deliverability detection
		// (WARN), it does not break the arm. An unknown event maps to null provenance →
		// no marker (fail-closed: never claim an active receiver we cannot back).
		const armProvenance = armProvenanceFor(eventName);
		if (armProvenance === null) {
			logLine("WARN", `receiver marker skipped — non-arm event ${eventName} (garden=${gardenId})`);
		} else if (ownerPid !== null) {
			try {
				writeMetaReceiverMarker({
					gardenId,
					backend: "claude-code",
					nativeSessionId: sessionId,
					ownerPid,
					armProvenance,
				});
				logLine("INFO", `receiver marker ${gardenId} owner=${ownerPid} arm=${eventName}`);
			} catch (err) {
				logLine(
					"WARN",
					`receiver marker write failed (event=${eventName}, garden=${gardenId}): ${err instanceof Error ? err.message : String(err)}`,
				);
			}
		} else {
			// Keep this ERROR after `INFO armed watch`: the hook-log doctor's recovery
			// rule treats a later arm as recovery, but an armed file watch without a live
			// owner marker is still not a deliverable garden receiver.
			logLine("ERROR", `receiver marker skipped — no validated Claude owner (event=${eventName}, garden=${gardenId})`);
		}
		emit({
			hookSpecificOutput: {
				hookEventName: eventName,
				watchPaths: [signal],
			},
		});
	} catch (err) {
		logLine(
			"ERROR",
			`arm failed (event=${eventName}, garden=${gardenId}): ${err instanceof Error ? err.message : String(err)}`,
		);
		emit({}); // record landed; only the arm failed — the doctor will flag the missing watch.
	}
}

main();
