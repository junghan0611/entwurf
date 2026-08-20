/**
 * meta-bridge-hook-copilot — the GitHub Copilot CLI native-session BIRTH entry (#82).
 *
 * WHAT THIS IS, AND WHAT IT DELIBERATELY IS NOT
 *
 * It mints. That is all it does:
 *
 *   stdin {sessionId|session_id, cwd}   (Copilot hook envelope, either shape)
 *     -> upsertMetaSession(copilot)     idempotent create/attach the record
 *        -> gardenId                    the session's garden address
 *
 * No sender marker, no receiver marker, no mailbox arm, no watchPaths. That is not
 * an unfinished half of the Claude unit — it is the whole measured shape of this
 * backend (2026-08-20, Copilot CLI 1.0.80): the shipped bundle has no `FileChanged`,
 * no `asyncRewake` and no `watchPaths`, so there is no doorbell to arm and nothing
 * for a receiver marker to vouch for. Birth and delivery are separate admissions;
 * this file is birth. A marker written here would claim a receiver that cannot exist.
 *
 * WHY A SECOND ENTRY FILE. `meta-bridge-hook.ts` hardcodes `backend: "claude-code"`
 * at mint and then does the marker/watch work above, and two gates pin that unit to
 * Claude's exec form and its four PascalCase events. Copilot's schema has no `args`
 * key at all, its exec form is a single `exec` string and its events are camelCase,
 * so the two units cannot share a manifest — and once the manifests are separate,
 * sharing an entry would only buy a runtime branch that the gates would then have to
 * unpick. The shared half lives where it belongs: `lib/meta-session.ts`.
 *
 * BIRTH IS ON THE FIRST PROMPT, NOT AT SESSION OPEN. Measured: opening the TUI
 * registers a session and fires NO hook (11:17:19.920Z registration, three idle
 * minutes, zero hook lines, `Session: 0 AIC used`). The first prompt then fires
 * `userPromptSubmitted` (11:20:29.476Z) -> `sessionStart` (11:20:32.102Z). Both are
 * wired to this entry and the upsert is idempotent, so the earlier of the two mints
 * and the later attaches. Do not describe a Copilot citizen as born when its window
 * opens; it is born when it is first spoken to.
 *
 * ENVELOPE SHAPE — TWO ACCEPTED, ON PURPOSE. Copilot ships a Claude-compat envelope
 * translator: a Claude-form hook declaration receives `{hook_event_name, session_id,
 * cwd, ...}` (measured), while its native declarations carry `{sessionId, timestamp,
 * cwd, source, ...}`. This unit declares the NATIVE form, and which of the two shapes
 * a native declaration puts on stdin was not measured. Reading both is not sloppiness
 * about which is true — it is refusing to bet a citizen's existence on an unmeasured
 * key name when the two shapes are trivially distinguishable and the log line records
 * which one actually arrived. That log line is how the doctor turns the guess into a
 * measurement on the first real session.
 *
 * FAILURE POLICY, inherited from the Claude unit: BEST-EFFORT + LOG. Never scream
 * into the operator's terminal, never block the turn. On any error, append a level-
 * tagged line to `<pi-agent-dir>/meta-bridge-hook.log` and exit 0 with `{}` on
 * stdout. The fail-loud surface is the doctor, which reads that log.
 *
 * LAUNCH: never invoked directly by Copilot. `hooks/hooks.json` declares
 * `exec: <baked abspath of scripts/copilot-hook-launch.sh>` and that launcher `exec`s
 * this payload. See copilot-hook-launch.sh for why it cannot be the Claude launcher.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { defaultMetaSessionsDir, upsertMetaSession } from "./lib/meta-session.ts";

type LogLevel = "INFO" | "WARN" | "ERROR";

/** Append a best-effort diagnostic line; swallow even its own failure. Same log file
 * and same LEVEL vocabulary as the Claude unit, so one doctor grep covers both. */
function logLine(level: LogLevel, message: string): void {
	try {
		const file = path.join(path.dirname(defaultMetaSessionsDir()), "meta-bridge-hook.log");
		fs.mkdirSync(path.dirname(file), { recursive: true });
		fs.appendFileSync(file, `${new Date().toISOString()} ${level} [copilot] ${message}\n`);
	} catch {
		/* logging is best-effort; a broken log must not break the session */
	}
}

/** Emit the neutral hook response and leave. Copilot has no watchPaths to arm, so
 * there is never anything else to say. */
function emit(): never {
	process.stdout.write("{}\n");
	process.exit(0);
}

/**
 * The envelope's two accepted shapes, reduced to the two fields birth needs. The
 * event label is diagnostic only — mint does not branch on it, because both wired
 * events mean the same thing here (the session exists and has spoken once).
 */
interface CopilotBirthEnvelope {
	sessionId: string;
	cwd: string;
	/** Which shape actually arrived — recorded so the doctor can retire the guess. */
	shape: "copilot-native" | "claude-compat" | "agreeing-both";
	eventLabel: string;
}

/**
 * Reduce either envelope shape to the two fields birth needs, or refuse.
 *
 * ACCEPTING TWO SHAPES IS NOT THE SAME AS PREFERRING ONE. `sessionId ?? session_id`
 * would silently pick a winner when the two disagree, and a disagreement is exactly
 * the case worth refusing: it means the compat translator produced two different
 * identities for one session, or something hand-built the envelope. A record minted
 * from the loser would be a citizen no live session can be joined back to. So both
 * present + equal is fine (`agreeing-both`); both present + different is a REFUSAL
 * (cross-review, terra, 2026-08-20).
 *
 * `cwd` has NO process.cwd() fallback, unlike the Claude entry. There the hook runs
 * in the session's own cwd, so the fallback is the same value by another route; here
 * the record is the ONLY thing this unit ever writes and a guessed cwd would be a
 * fact nothing later can correct. Both measured Copilot shapes carry `cwd`.
 */
export function readBirthEnvelope(env: Record<string, unknown>): CopilotBirthEnvelope | { refusal: string } {
	const nativeRaw = env.sessionId;
	const compatRaw = env.session_id;
	const native = typeof nativeRaw === "string" ? nativeRaw : "";
	const compat = typeof compatRaw === "string" ? compatRaw : "";
	if (nativeRaw !== undefined && native.length === 0)
		return { refusal: "sessionId present but not a non-empty string" };
	if (compatRaw !== undefined && compat.length === 0)
		return { refusal: "session_id present but not a non-empty string" };
	if (native && compat && native !== compat) {
		return { refusal: `sessionId and session_id disagree (${native} vs ${compat})` };
	}
	const sessionId = native || compat;
	if (!sessionId) return { refusal: "no sessionId/session_id" };
	const shape = native && compat ? "agreeing-both" : native ? "copilot-native" : "claude-compat";
	if (typeof env.cwd !== "string" || env.cwd.length === 0) return { refusal: "cwd missing or not a non-empty string" };
	const cwd = env.cwd;
	const eventLabel =
		typeof env.hook_event_name === "string" && env.hook_event_name.length > 0
			? env.hook_event_name
			: typeof env.source === "string" && env.source.length > 0
				? `native(source=${env.source})`
				: "unlabeled";
	return { sessionId, cwd, shape, eventLabel };
}

function main(): void {
	let raw: string;
	try {
		raw = fs.readFileSync(0, "utf8"); // fd 0 = stdin (the Copilot hook envelope)
	} catch (err) {
		logLine("ERROR", `stdin read failed: ${err instanceof Error ? err.message : String(err)}`);
		emit();
	}

	let env: Record<string, unknown>;
	try {
		const parsed = JSON.parse(raw);
		if (typeof parsed !== "object" || parsed === null) throw new Error("envelope is not an object");
		env = parsed as Record<string, unknown>;
	} catch (err) {
		logLine("ERROR", `envelope parse failed: ${err instanceof Error ? err.message : String(err)}`);
		emit();
	}

	const envelope = readBirthEnvelope(env);
	if ("refusal" in envelope) {
		// A record keyed to a guess would be a citizen nobody can join back to a real
		// session, so refuse — and make it ERROR, because this session did NOT become a
		// garden citizen. The doctor reads this line.
		logLine("ERROR", `degraded envelope: ${envelope.refusal} (keys=${Object.keys(env).sort().join(",")})`);
		emit();
	}

	try {
		// transcriptPath and model are omitted, not guessed: Copilot's envelope carries
		// neither, and both axes are nullable at mint by design.
		const result = upsertMetaSession({
			input: { backend: "copilot", nativeSessionId: envelope.sessionId, cwd: envelope.cwd },
		});
		logLine(
			"INFO",
			`${result.action} record ${path.basename(result.path)} (event=${envelope.eventLabel}, shape=${envelope.shape}, native=${envelope.sessionId})`,
		);
	} catch (err) {
		logLine(
			"ERROR",
			`upsert failed (event=${envelope.eventLabel}, native=${envelope.sessionId}): ${err instanceof Error ? err.message : String(err)}`,
		);
	}
	emit();
}

main();
