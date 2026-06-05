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
 * scanByNativeId); the idle-wake mailbox is keyed by GARDEN id — that is the
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
 * Run: `<node> --experimental-strip-types <plugin-root>/meta-bridge-hook.ts`.
 * Imports `./lib/meta-session.ts` (+ `./lib/session-id.js`); the installer copies
 * that lib dir alongside this file so `${CLAUDE_PLUGIN_ROOT}` self-locates it.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { defaultMetaMailboxDir, defaultMetaSessionsDir, upsertMetaSession } from "./lib/meta-session.ts";

/** Append a best-effort diagnostic line; swallow even its own failure (never throw from the hook). */
function logLine(message: string): void {
	try {
		// dirname(meta-sessions) == the pi agent dir — no extra resolver export needed.
		const file = path.join(path.dirname(defaultMetaSessionsDir()), "meta-bridge-hook.log");
		fs.mkdirSync(path.dirname(file), { recursive: true });
		fs.appendFileSync(file, `${new Date().toISOString()} ${message}\n`);
	} catch {
		/* logging is best-effort; a broken log must not break the session */
	}
}

/** Emit a hook response on stdout and exit 0. `{}` means "did nothing, do not block startup". */
function emit(payload: Record<string, unknown>): never {
	process.stdout.write(`${JSON.stringify(payload)}\n`);
	process.exit(0);
}

function main(): void {
	let raw: string;
	try {
		raw = fs.readFileSync(0, "utf8"); // fd 0 = stdin (the Claude hook envelope)
	} catch (err) {
		logLine(`stdin read failed: ${err instanceof Error ? err.message : String(err)}`);
		emit({});
	}

	let env: Record<string, unknown>;
	try {
		const parsed = JSON.parse(raw);
		if (typeof parsed !== "object" || parsed === null) throw new Error("envelope is not an object");
		env = parsed as Record<string, unknown>;
	} catch (err) {
		logLine(`envelope parse failed: ${err instanceof Error ? err.message : String(err)}`);
		emit({});
	}

	const sessionId = typeof env.session_id === "string" ? env.session_id : "";
	const transcriptPath = typeof env.transcript_path === "string" ? env.transcript_path : "";
	// cwd: prefer the envelope's, fall back to the process cwd (the hook runs in the session's cwd).
	const cwd = typeof env.cwd === "string" && env.cwd.length > 0 ? env.cwd : process.cwd();
	const eventName = typeof env.hook_event_name === "string" ? env.hook_event_name : "SessionStart";

	if (!sessionId || !transcriptPath) {
		// A degraded envelope: cannot mint an honest reference record. Log + no-op
		// rather than write a half-record or guess a transcript path.
		logLine(
			`degraded envelope (event=${eventName}, session_id=${sessionId ? "set" : "MISSING"}, transcript_path=${transcriptPath ? "set" : "MISSING"})`,
		);
		emit({});
	}

	let gardenId: string;
	try {
		const result = upsertMetaSession({
			input: { backend: "claude-code", nativeSessionId: sessionId, transcriptPath, cwd },
			onSkip: (filename, e) => logLine(`scan skipped ${filename}: ${e.message}`),
		});
		gardenId = result.record.gardenId;
		logLine(`${result.action} record ${path.basename(result.path)} (event=${eventName}, native=${sessionId})`);
	} catch (err) {
		// Best-effort: a broken record store must surface via the doctor, not by
		// breaking the user's session open. Log and continue with no arm.
		logLine(
			`upsert failed (event=${eventName}, native=${sessionId}): ${err instanceof Error ? err.message : String(err)}`,
		);
		emit({});
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
		logLine(`armed watch ${signal}`);
		emit({
			hookSpecificOutput: {
				hookEventName: eventName,
				watchPaths: [signal],
			},
		});
	} catch (err) {
		logLine(`arm failed (event=${eventName}, garden=${gardenId}): ${err instanceof Error ? err.message : String(err)}`);
		emit({}); // record landed; only the arm failed — the doctor will flag the missing watch.
	}
}

main();
