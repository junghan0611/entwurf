/**
 * meta-bridge-hook-copilot — the GitHub Copilot CLI native-session BIRTH entry (#82).
 *
 * WHAT THIS IS, AND WHAT IT DELIBERATELY IS NOT
 *
 * It mints, then names the minted citizen as this host's SENDER:
 *
 *   stdin {sessionId|session_id, cwd}   (Copilot hook envelope, either shape)
 *     -> upsertMetaSession(copilot)     idempotent create/attach the record
 *        -> gardenId                    the session's garden address
 *     -> writeMetaSenderMarker(ppid)    who-sent join for this host's MCP children
 *
 * No receiver marker, no mailbox arm, no watchPaths. That remains this BIRTH unit's
 * product contract, not a global claim that Copilot cannot wake. On 2026-08-23 the
 * bundled first-party extension surface demonstrated idle wake through stdio JSON-RPC
 * and `session.send()`, but its lifecycle/liveness/dispatch admission has not landed.
 * A receiver marker written HERE would therefore claim a managed product receipt this
 * birth payload neither owns nor proves.
 *
 * THE SENDER MARKER IS A DIFFERENT FACT, AND THIS UNIT USED TO CONFLATE THEM. Until
 * #82 RAIL 5b this file wrote no marker of EITHER kind, and gave the doorbell's
 * absence as the reason for both. That reasoning is only valid for the receiver:
 *
 *   receiver marker = "a live session is ARMED to be woken"  -> needs a doorbell
 *   sender  marker  = "who owns this MCP child process"      -> needs a shared parent
 *
 * `lib/meta-sender-identity.ts` states the sender join in one line — the hook writes a
 * marker keyed by ITS parent pid, the bridge child looks one up under its own parent,
 * and that shared ancestor IS the join key. Nothing in it consults a doorbell. So a
 * Copilot citizen with the MCP hand installed could read (`entwurf_peers`) but never
 * send: the bridge held the owner pid and found no marker to look up. Writing one is
 * what closes that, and it changes exactly one thing for the receiver of a message —
 * it learns WHO sent it.
 *
 * IT DOES NOT MAKE THIS CITIZEN REPLYABLE, and must never be described as if it did.
 * `mcp/entwurf-bridge/src/index.ts` picks the reply rail from `nativePushSupported`;
 * copilot is not native-push, so it lands in the self-fetch domain, where `replyable`
 * comes from a RECEIVER marker this backend correctly does not write. `replyable:
 * false` with a real garden identity is the honest answer here, not a gap to close.
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
import {
	defaultMetaSessionsDir,
	isPlausibleOwnerPid,
	upsertMetaSession,
	writeMetaSenderMarker,
} from "./lib/meta-session.ts";

/**
 * The launch-provenance handshake, held as LOCAL literals on purpose.
 *
 * The Claude payload declares the same pair privately, and `check-meta-receiver-marker`
 * asserts the literal is present in THAT source — so hoisting the two strings into a
 * shared module would drag a sibling rail's production file and its gate into this lane
 * for no behavioral gain (PM decision, 2026-08-21).
 *
 * This is not an unguarded copy. The value already exists on both sides of a shell/TS
 * boundary anyway (`copilot-hook-launch.sh` exports it), and `check-copilot-birth-hook`
 * fires the REAL assembled launcher, so a drift between the two spellings shows up as a
 * refused marker in that gate rather than as a silent mismatch.
 */
const META_HOOK_LAUNCH_ENV = "ENTWURF_META_HOOK_LAUNCH";
const META_HOOK_LAUNCH_TOKEN = "hook-launch/v1";

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

/**
 * Which pid does a sender marker written here belong to — or NONE.
 *
 * `copilot-hook-launch.sh` `exec`s this payload, so on the shipped path this process IS
 * the launcher and its parent is the Copilot host that ran the hook. Two things that
 * form cannot promise are asked anyway, and both fail CLOSED:
 *
 *   1. LAUNCH PROVENANCE. `process.ppid` only names the Copilot host when this payload
 *      was reached THROUGH the shipped launcher. A session still holding an older cached
 *      hook command, or a hand-run of the entry file, has some other parent — so the
 *      launcher stamps a token and this reads it. No token, no claim.
 *   2. A PLAUSIBLE LIVE PARENT. `isPlausibleOwnerPid` is the predicate shared with every
 *      marker writer, reader and the generation cut. A marker naming init outlives every
 *      process that could refute it, and one such leftover once blocked a host's
 *      fresh-cut until it was deleted by hand (#53 A).
 *
 * Failing closed costs only who-sent, which this backend did not have five minutes ago,
 * and the doctor reads the WARN. Claiming a transient wrapper as the owner would instead
 * attribute a citizen's messages to a pid that never sent them.
 *
 * MEASUREMENT STATE OF THE JOIN ITSELF. `[측정]` Closed end to end on Copilot CLI 1.0.80,
 * 2026-08-21, through the PRODUCTION events this unit wires: a live session's marker owner
 * was the running Copilot native process, that same pid was the parent of the running
 * entwurf MCP child, and a send from that session arrived carrying its own garden id with
 * `origin: "meta-session"`. Marker owner == native host == MCP child's parent is therefore
 * an observed fact on this backend, not an assumption inherited from the other two.
 *
 * The claim is still BOUNDED, and the bound is the vendor version: one CLI release is not a
 * promise about the next, and this join is the only thing standing between a marker and the
 * child that must find it. That is why the success line below prints the owner pid — it
 * keeps the join re-checkable from the log alone, with no probe to re-run.
 */
/**
 * Arm who-sent for this host's MCP children, or say in the log why it could not be.
 *
 * BEST-EFFORT + LOG, exactly like the mint above it: a Copilot turn must never be broken
 * or spammed by our bookkeeping, so nothing here throws and nothing reaches the terminal.
 * The three outcomes get three distinct tokens because they need three different fixes,
 * and the doctor greps this log:
 *
 *   `sender marker <pid> -> <gid>`  armed. The pid is printed because it is the join key
 *                                   AND the production-event measurement that is still
 *                                   open (see resolveCopilotHookOwnerPid).
 *   `sender-marker-refused`         we declined to claim an owner: no launch provenance
 *                                   (reinstall + restart that session) or an implausible
 *                                   parent (a reparented orphan). Not an error — a
 *                                   fail-closed answer, so WARN.
 *   `sender-marker-failed`          we tried and the write itself broke (permissions, a
 *                                   full disk, a refused owner pid). ERROR.
 *
 * Either non-success costs only who-sent: the citizen still exists, still appears in
 * `entwurf_peers`, and can still be addressed BY others. Only its own outbound sends fall
 * back to the bridge's default refusal.
 */
function writeCopilotSenderMarker(gardenId: string, envelope: CopilotBirthEnvelope): void {
	const ownerPid = resolveCopilotHookOwnerPid();
	if (ownerPid === null) {
		logLine(
			"WARN",
			process.env[META_HOOK_LAUNCH_ENV] !== META_HOOK_LAUNCH_TOKEN
				? `sender-marker-refused garden=${gardenId}: exec-launch provenance missing (${META_HOOK_LAUNCH_ENV}); this hook was NOT reached through copilot-hook-launch.sh, so its parent is not a trustworthy owner. Reinstall the Copilot bridge and RESTART that session. This citizen exists but cannot send (event=${envelope.eventLabel})`
				: `sender-marker-refused garden=${gardenId}: parent pid ${process.ppid} is not a plausible owner (reparented orphan?); this citizen exists but cannot send (event=${envelope.eventLabel})`,
		);
		return;
	}
	try {
		writeMetaSenderMarker({
			backend: "copilot",
			gardenId,
			nativeSessionId: envelope.sessionId,
			cwd: envelope.cwd,
			ownerPid,
		});
		logLine("INFO", `sender marker ${ownerPid} -> ${gardenId} (event=${envelope.eventLabel})`);
	} catch (err) {
		logLine(
			"ERROR",
			`sender-marker-failed pid=${ownerPid} garden=${gardenId}: ${err instanceof Error ? err.message : String(err)}`,
		);
	}
}

function resolveCopilotHookOwnerPid(): number | null {
	if (process.env[META_HOOK_LAUNCH_ENV] !== META_HOOK_LAUNCH_TOKEN) return null;
	const ownerPid = process.ppid;
	if (!isPlausibleOwnerPid(ownerPid)) return null;
	return ownerPid;
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
		// RECORD AUTHORITY FIRST: the marker is only a pid->garden hint that the record
		// must vouch for, so it is written INSIDE the success branch. A marker minted
		// after a failed upsert would name a garden id with no record behind it — the
		// resolver would read it, find nothing, and report "names nobody" for a citizen
		// whose real failure was the mint. Same order as the agy writer.
		writeCopilotSenderMarker(result.record.gardenId, envelope);
	} catch (err) {
		logLine(
			"ERROR",
			`upsert failed (event=${envelope.eventLabel}, native=${envelope.sessionId}): ${err instanceof Error ? err.message : String(err)}`,
		);
	}
	emit();
}

main();
