/**
 * meta-bridge-hook-codex — the OpenAI Codex native-session BIRTH entry (#95).
 *
 * WHAT THIS IS, AND WHAT IT DELIBERATELY IS NOT
 *
 *   stdin {session_id, transcript_path, cwd, hook_event_name, model, source}
 *     -> readCodexBirthEnvelope()      strict validation, or REFUSAL
 *     -> performCodexBirth()           idempotent create/attach of ONE v3 record
 *        -> gardenId                   the session's garden address
 *     -> `{}` on stdout, exit 0        always, on every path
 *
 * That is the whole unit. It writes NO pid marker, NO sender marker and NO receiver
 * marker, and each omission has its own reason:
 *
 *   1. NO PID MARKER OF ANY KIND, because on this backend the parent pid is not an
 *      identity. `[host]` Measured 2026-09-08 (scripts/raw-codex-measure/README.md,
 *      S1b-B): two different TUI windows, two different `session_id`s, and ONE ppid
 *      shared by every hook process AND every MCP child of BOTH — the app-server, not
 *      the TUI. Neither TUI pid appears in the chain at all. So the Claude/Copilot
 *      "shared ancestor is the join key" trick does not merely lack evidence here, it
 *      is measurably WRONG: a marker keyed to that pid would name one of two citizens
 *      arbitrarily and attribute the other's messages to it. Codex's request-scoped
 *      identity rides `_meta.threadId` on the MCP request instead; that is a separate
 *      leaf (`lib/meta-sender-identity.ts`), and it needs nothing from this file.
 *   2. NO RECEIVER MARKER, because a receiver marker is a claim that a LIVE process
 *      holds a watch. `[source]` Codex has no filesystem-wake vocabulary at all —
 *      `watchPaths`/`FileChanged`/`asyncRewake` appear nowhere in its workspace except
 *      in a Claude-hooks importer that SKIPS any hook carrying them. Codex receive is
 *      native-push and ack-only; nothing about it is armed from here.
 *
 * IDENTITY IS ON THE WIRE, SO NOTHING IS GUESSED. `[host]` The measured 0.153.4
 * `SessionStart` envelope, verbatim:
 *
 *   {"session_id":"01a08147-fbad-78d2-b266-e058f322125e",
 *    "transcript_path":"<CODEX_HOME>/sessions/2026/09/08/rollout-…-01a08147-….jsonl",
 *    "cwd":"/home/junghan/repos/gh/entwurf",
 *    "hook_event_name":"SessionStart",
 *    "model":"gpt-6-astra",
 *    "permission_mode":"default",
 *    "source":"startup"}
 *
 * and `[host]` D3 of the same measurement pinned the join: the hook's `session_id`,
 * the app-server's `thread/loaded/list` `threadId`, and the MCP request's
 * `_meta.threadId` are ONE string. Two threads were opened and both matched. That is
 * why this unit stores `session_id` as `nativeSessionId` with no transformation — the
 * send rail (`codex queue --thread <threadId>`) reads that field back verbatim.
 *
 * WHY VALIDATION IS STRICT AND NOT TOLERANT. Every other birth entry in this repo
 * accepts a partially-known envelope because its vendor gave it one (Copilot carries
 * no transcript and no model; omp's shape varies by mode). Codex gives all five axes
 * on every SessionStart, so a MISSING or non-absolute one is not a thin envelope — it
 * is an envelope this unit did not come from, and minting a citizen from it would
 * write a record no live thread can be joined back to. The refusal is cheap and the
 * log names the exact field; a wrong record is neither.
 *
 * THE EVENT NAME IS THE WHOLE TOP-LEVEL PREDICATE, and it is vendor-authoritative.
 * `[source]` A spawned agent does not raise `SessionStart` — it raises `SubagentStart`,
 * and every other subagent source returns before dispatch. `[host]` Measured: exactly
 * ONE `SessionStart` per session, while `SubagentStart` fires per child AND CARRIES THE
 * PARENT'S `session_id` beside its own `agent_id`. So a tolerant reader keyed on
 * `session_id` alone would mint the parent's identity again from a child's event.
 * Hence: `hook_event_name` must be exactly `SessionStart`, and any `agent_id` /
 * `agent_type` key is a refusal even if the event name says otherwise.
 *
 * BIRTH IS ON THE FIRST TURN, NOT AT WINDOW OPEN. `[source]` Session construction only
 * QUEUES the source; `[host]` a TUI sat fully open and idle for ~47s with the hook log
 * EMPTY, then `SessionStart` fired 1.6s after the first prompt. A Codex citizen is born
 * when it is first spoken to. The doctor must therefore read "installed, zero records"
 * as NOT-YET, never as a failure — and never as proof either.
 *
 * FAILURE POLICY, inherited from the Claude/Copilot units: BEST-EFFORT + LOG. Never
 * scream into the operator's terminal, never block the turn. On any error, append a
 * level-tagged line to `<pi-agent-dir>/meta-bridge-hook.log` and exit 0 with `{}` on
 * stdout. The fail-loud surface is the doctor, which reads that log. The four outcomes
 * carry four distinct grep tokens because they need four different fixes:
 *
 *   `birth-mint`      a new citizen exists. INFO.
 *   `birth-attach`    an existing citizen was re-seen (resume/clear/compact). INFO.
 *   `birth-refused`   the envelope was not a trustworthy SessionStart. ERROR — this
 *                     session did NOT become a citizen.
 *   `birth-failed`    the envelope was fine and the STORE write broke. ERROR.
 *
 * LAUNCH: never invoked directly by Codex. `[source]` Codex's `command` handler is a
 * SHELL STRING with no exec-form argv variant anywhere in the enum, so entwurf's
 * "no shell-form fallback" rule has no counterpart to bind to here. The declaration in
 * `$CODEX_HOME/hooks.json` therefore names ONE fixed absolute single-quoted launcher,
 * published operator-owned by `scripts/codex-birth-install.sh`, and that launcher `exec`s
 * `node --experimental-strip-types` over a COPY of this file plus its lib closure.
 * Nothing about identity travels in argv or in the environment, so the launcher has no
 * provenance token to stamp (the Claude/Copilot `ENTWURF_META_HOOK_LAUNCH` handshake
 * exists to license a `process.ppid` read, and reason 1 above is why this unit never
 * performs one).
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { defaultMetaSessionsDir, type MetaIdentity, upsertMetaSession } from "./lib/meta-session.ts";
import { resolveCodexDefaultSocketPath, setCodexThreadName } from "./lib/native-push/codex-ws-client.ts";

/** `[source]` `SessionStartSource::{Startup,Resume,Clear,Compact}` — the complete
 * 4-valued matcher input for this event (`hooks/src/events/session_start.rs:25-38`).
 * All four are real births of the same thread id: `Resumed→Resume`, `New|Forked→Startup`,
 * `Cleared→Clear` (`core/src/session/session.rs:1600-1606`), and the upsert is
 * idempotent, so a resume ATTACHES rather than minting a second citizen. */
const CODEX_SESSION_START_SOURCES = ["startup", "resume", "clear", "compact"] as const;
type CodexSessionStartSource = (typeof CODEX_SESSION_START_SOURCES)[number];

/** The one event that means "a top-level thread exists and has spoken once". */
const CODEX_BIRTH_EVENT = "SessionStart";

/** A `session_id` travels into a record filename join key and, later, into the exact
 * vendor argv `codex queue --thread <threadId>`. Whitespace or control bytes there
 * would either truncate the field or smuggle argv structure, so the token is bounded
 * at the boundary rather than at each consumer. The measured value is a 36-char UUID;
 * the bound is deliberately looser than that, because the SHAPE of the id is the
 * vendor's business and only its usability as one token is ours. */
const MAX_THREAD_ID_LEN = 200;

type LogLevel = "INFO" | "WARN" | "ERROR";

/** Append a best-effort diagnostic line; swallow even its own failure. Same log file
 * and same LEVEL vocabulary as the Claude/Copilot units, so one doctor grep covers all
 * three. The `[codex]` tag is what makes this unit's lines separable. */
function logLine(level: LogLevel, message: string): void {
	try {
		const file = path.join(path.dirname(defaultMetaSessionsDir()), "meta-bridge-hook.log");
		fs.mkdirSync(path.dirname(file), { recursive: true });
		fs.appendFileSync(file, `${new Date().toISOString()} ${level} [codex] ${message}\n`);
	} catch {
		/* logging is best-effort; a broken log must not break the session */
	}
}

/**
 * The measured envelope, reduced to exactly the five axes birth consumes.
 *
 * `threadId` is named for what the string IS across the whole rail — hook `session_id`
 * == app-server `threadId` == MCP `_meta.threadId` (measured D3) — rather than for the
 * wire key it arrived under. Every downstream consumer wants the threadId spelling.
 */
export interface CodexBirthEnvelope {
	threadId: string;
	cwd: string;
	transcriptPath: string;
	/** `null` only when the vendor sent an explicit JSON null; never a guess. */
	model: string | null;
	source: CodexSessionStartSource;
}

export interface CodexBirthRefusal {
	refusal: string;
}

function isAbsolutePosix(value: string): boolean {
	return value.startsWith("/");
}

/**
 * Validate a `SessionStart` envelope, or refuse with the exact reason.
 *
 * STRICT ON EVERY AXIS THE VENDOR ALWAYS SENDS, and the refusal messages are written to
 * be read in a log by somebody who cannot re-run the session. Unknown EXTRA keys are
 * tolerated on purpose (`permission_mode` is already one, and a vendor minor may add
 * more); an extra key cannot corrupt an identity, whereas a missing one can.
 *
 * `path.isAbsolute` is not used for the two path axes: it is platform-dependent, and
 * this unit only ever runs from a POSIX declaration (`$CODEX_HOME/hooks.json`). A
 * Windows-shaped absolute path arriving here would mean the envelope came from
 * somewhere this unit was never installed, which is precisely a refusal.
 */
export function readCodexBirthEnvelope(env: Record<string, unknown>): CodexBirthEnvelope | CodexBirthRefusal {
	// 1. The event predicate, first and hardest. `SubagentStart` carries the PARENT's
	//    session_id, so a reader that checked identity before the event name would mint
	//    the parent again from a child's event.
	if (env.hook_event_name !== CODEX_BIRTH_EVENT) {
		return {
			refusal: `hook_event_name is not exactly "${CODEX_BIRTH_EVENT}" (got ${JSON.stringify(env.hook_event_name)}) — only a top-level thread's own start event may mint a citizen`,
		};
	}
	// 2. Belt AND braces on the subagent case: these two keys exist only on the
	//    SubagentStart/Stop envelopes, so their presence beside a SessionStart name
	//    means the envelope was assembled by something other than the vendor.
	for (const key of ["agent_id", "agent_type"] as const) {
		if (env[key] !== undefined) {
			return {
				refusal: `a subagent key (${key}) is present on a ${CODEX_BIRTH_EVENT} envelope — a spawned agent raises SubagentStart and must never become a citizen`,
			};
		}
	}
	// 3. The join key.
	if (typeof env.session_id !== "string" || env.session_id.length === 0) {
		return { refusal: "session_id missing or not a non-empty string" };
	}
	const threadId = env.session_id;
	if (threadId.length > MAX_THREAD_ID_LEN) {
		return { refusal: `session_id is longer than ${MAX_THREAD_ID_LEN} characters` };
	}
	if (/[^\x21-\x7e]/.test(threadId)) {
		return {
			refusal:
				"session_id carries whitespace, control or non-ASCII bytes — it must be one printable token (it becomes the `codex queue --thread` argv value)",
		};
	}
	// 4. The two absolute paths. `cwd` has NO process.cwd() fallback: the record is the
	//    only thing this unit writes, and a guessed cwd is a fact nothing later corrects.
	if (typeof env.cwd !== "string" || env.cwd.length === 0) {
		return { refusal: "cwd missing or not a non-empty string" };
	}
	if (!isAbsolutePosix(env.cwd)) {
		return { refusal: `cwd is not an absolute POSIX path (got ${JSON.stringify(env.cwd)})` };
	}
	if (typeof env.transcript_path !== "string" || env.transcript_path.length === 0) {
		return { refusal: "transcript_path missing or not a non-empty string" };
	}
	if (!isAbsolutePosix(env.transcript_path)) {
		return { refusal: `transcript_path is not an absolute POSIX path (got ${JSON.stringify(env.transcript_path)})` };
	}
	// 5. `model` is the one nullable axis: the record schema admits null, and an
	// explicit vendor null is a fact ("unknown"), while an absent key or wrong TYPE
	// is a refusal. The measured SessionStart always carries the key; silently mapping
	// its disappearance to null would hide a vendor envelope regression.
	if (!("model" in env)) {
		return { refusal: "model key is missing — Codex SessionStart must carry it explicitly (string or null)" };
	}
	let model: string | null = null;
	if (env.model !== null) {
		if (typeof env.model !== "string" || env.model.length === 0) {
			return { refusal: `model is present but not a non-empty string or null (got ${JSON.stringify(env.model)})` };
		}
		model = env.model;
	}
	// 6. The 4-valued source. Refusing an unknown value is how a vendor minor that adds
	//    a fifth source surfaces here as a named log line instead of as a silent mint.
	if (typeof env.source !== "string" || !CODEX_SESSION_START_SOURCES.includes(env.source as CodexSessionStartSource)) {
		return {
			refusal: `source is not one of ${CODEX_SESSION_START_SOURCES.join("|")} (got ${JSON.stringify(env.source)})`,
		};
	}
	return {
		threadId,
		cwd: env.cwd,
		transcriptPath: env.transcript_path,
		model,
		source: env.source as CodexSessionStartSource,
	};
}

export interface CodexBirthResult {
	action: "create" | "attach";
	gardenId: string;
	recordPath: string;
	record: MetaIdentity;
}

/**
 * Create or attach the ONE record this thread owns, and return the outcome.
 *
 * Exported ahead of `main()` on purpose: a caller that already holds a validated
 * envelope (a gate, or the post-birth `thread/name/set` step that names the thread
 * after its garden id) must be able to reach the gardenId and the create/attach action
 * WITHOUT re-reading stdin — stdin is consumed exactly once, by the hook process.
 * This function performs no logging and no process exit; both belong to `main()`.
 *
 * Both nullable axes are supplied, never omitted: Codex sends them on every
 * SessionStart, so passing `undefined` (the store's "keep existing value" intent) would
 * make a re-attach silently preserve a stale model after `/model`, or a stale transcript
 * path after a compact. A fresh envelope's values are always the newer truth.
 */
export function performCodexBirth(envelope: CodexBirthEnvelope, opts: { dir?: string } = {}): CodexBirthResult {
	const result = upsertMetaSession({
		input: {
			backend: "codex",
			nativeSessionId: envelope.threadId,
			cwd: envelope.cwd,
			model: envelope.model,
			transcriptPath: envelope.transcriptPath,
		},
		dir: opts.dir,
	});
	return {
		action: result.action,
		gardenId: result.record.gardenId,
		recordPath: result.path,
		record: result.record,
	};
}

/** Emit the neutral hook response and leave. `{}` claims nothing: Codex's SessionStart
 * output schema is all-optional, and this unit has no context to inject and no decision
 * to make about the turn. */
function emit(): never {
	fs.writeSync(1, "{}\n");
	process.exit(0);
}

async function main(): Promise<void> {
	let raw: string;
	try {
		raw = fs.readFileSync(0, "utf8"); // fd 0 = stdin (the Codex hook envelope)
	} catch (err) {
		logLine("ERROR", `birth-refused stdin read failed: ${err instanceof Error ? err.message : String(err)}`);
		emit();
	}

	let env: Record<string, unknown>;
	try {
		const parsed = JSON.parse(raw);
		if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
			throw new Error("envelope is not a JSON object");
		}
		env = parsed as Record<string, unknown>;
	} catch (err) {
		logLine("ERROR", `birth-refused envelope parse failed: ${err instanceof Error ? err.message : String(err)}`);
		emit();
	}

	const envelope = readCodexBirthEnvelope(env);
	if ("refusal" in envelope) {
		// A record keyed to a guess would be a citizen no live thread can be joined back
		// to, so refuse — and make it ERROR, because this session did NOT become a garden
		// citizen. The key list is printed because the fix depends on WHICH envelope this
		// actually was (a SubagentStart, a hand-run, or a vendor schema change).
		logLine("ERROR", `birth-refused ${envelope.refusal} (keys=${Object.keys(env).sort().join(",")})`);
		emit();
	}

	let born: CodexBirthResult;
	try {
		born = performCodexBirth(envelope);
		logLine(
			"INFO",
			born.action === "create"
				? `birth-mint ${born.gardenId} record=${path.basename(born.recordPath)} thread=${envelope.threadId} source=${envelope.source} model=${envelope.model ?? "null"}`
				: `birth-attach ${born.gardenId} record=${path.basename(born.recordPath)} thread=${envelope.threadId} source=${envelope.source} model=${envelope.model ?? "null"}`,
		);
	} catch (err) {
		logLine(
			"ERROR",
			`birth-failed thread=${envelope.threadId} source=${envelope.source}: ${err instanceof Error ? err.message : String(err)}`,
		);
		emit();
	}
	try {
		await setCodexThreadName(resolveCodexDefaultSocketPath(process.env), envelope.threadId, born.gardenId);
		logLine("INFO", `title-set ${born.gardenId} thread=${envelope.threadId}`);
	} catch (err) {
		logLine(
			"WARN",
			`title-unavailable ${born.gardenId} thread=${envelope.threadId}: ${err instanceof Error ? err.message : String(err)}`,
		);
	}
	emit();
}

// RUN ONLY AS THE HOOK PROCESS. `main()` consumes stdin and calls `process.exit`, so a
// gate (or the post-birth `thread/name/set` step) that imports `performCodexBirth` must
// not trigger it. `import.meta.main` is NOT used for this: it landed in Node 24.2.0 and
// the package floor is major 24, so on a 24.0/24.1 host it would be `undefined` — the
// guard would read falsy and the hook would silently mint nothing on every session,
// which is exactly the failure this file exists to prevent. An argv comparison works on
// every supported Node.
const invokedDirectly = (() => {
	const entry = process.argv[1];
	if (typeof entry !== "string" || entry.length === 0) return false;
	try {
		return fs.realpathSync(entry) === fs.realpathSync(import.meta.filename);
	} catch {
		return false;
	}
})();
if (invokedDirectly) void main();
