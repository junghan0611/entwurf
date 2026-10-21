/**
 * resume-launch-identity — the RECORD-AUTHORITATIVE half of a visible same-id resume: garden id →
 * the meta-record → which native session is this citizen's, and where it lives.
 *
 * It began as the preamble of the retired `spawn-bg` watcher (garden id → the meta-record → the
 * transcript that record claims → the provider/model/cwd that transcript's own header carries).
 * None of that is about being hidden or visible; it is the answer to "which being is this, and
 * which conversation is theirs". `entwurf-v2-visible-resume` is its consumer, and
 * `check-resume-launch-identity` holds the record-integrity rules below — the transcript header id
 * must equal `record.nativeSessionId`, an addressable read (#52) rather than a plain targeted one,
 * a recorded ACP provider must resolve its bridge.
 *
 * The domain is pi and claude-code (#147 L2). Both own their transcript and re-attach to the same
 * record when their native session reopens; this leaf only names that session. For pi it reads
 * the transcript header (the launch needs its provider/model/cwd). For claude-code it reads no
 * transcript at all — the vendor owns it, and `claude --resume <id>` needs nothing from it — and
 * checks only that the recorded path is an absolute file that still exists. Every other backend
 * is a named refusal: native-push citizens have no resume authority (AGENTS Hard Rule 10), and a
 * durable host is not reopened through Entwurf.
 *
 * It takes a bare garden id, not a plan: the plan type it used to destructure belonged to
 * the removed transport, and the identity question never needed the rest of it.
 */

import { existsSync, statSync } from "node:fs";
import path from "node:path";
import { AcpModelNotCuratedError, isCuratedAcpModelId, PROVIDER_ID } from "./acp/model-ids.js";
import { getEntwurfExplicitExtensions, readSessionIdentity } from "./entwurf-core.ts";
import { readAddressableMetaIdentity } from "./meta-session.ts";

/** The backends with a visible same-id resume. A closed set: nothing outside it is reopened. */
export const RESUME_BACKENDS = ["pi", "claude-code"] as const;
export type ResumeBackend = (typeof RESUME_BACKENDS)[number];

/**
 * One of the TWO expected refusals on this leaf: the target is a citizen of a backend that has no
 * same-id resume at all. The other is `AcpModelNotCuratedError` (#128, `acp/model-ids.js`).
 *
 * Everything else this function throws is a defect in the record, the transcript or the
 * environment — a stale path, a foreign session file, an unrecorded model, an unresolvable
 * bridge — and those keep their bare cause-rich `Error`, because a caller cannot act on them
 * except by looking. A Claude Code or agy garden id is different in kind: nothing is broken,
 * the operator simply asked a capability boundary to do something it does not cover, and the
 * honest answer is a named refusal rather than an error report about a store that is fine. Since
 * #147 L2 the boundary is `RESUME_BACKENDS`; a Codex, agy, Copilot, OMP or pi-durable garden id is
 * this refusal.
 *
 * It carries a `reason` so the caller matches on a FIELD. Parsing the message string would make
 * the wording load-bearing, and re-reading the record to ask "was it pi?" would read an address
 * twice and could answer differently the second time.
 */
export class ResumeBackendUnsupportedError extends Error {
	readonly reason = "target-backend-unsupported" as const;
	readonly backend: string;
	constructor(gardenId: string, backend: string) {
		super(
			`resume-launch-identity: ${gardenId} is a ${backend} citizen — same-id resume is a host-adapter relaunch ` +
				`capability, and its domain is ${RESUME_BACKENDS.join(" and ")}. ` +
				`This is a capability boundary, not citizen rank.`,
		);
		this.name = "ResumeBackendUnsupportedError";
		this.backend = backend;
	}
}

/** The launch-time facts `buildResumePiArgs` needs, resolved from the meta-record + the
 * recorded transcript (record authority, #50 C2/C3). */
export interface PiLaunchIdentity {
	backend: "pi";
	/** The EXACT session JSONL to resume — `pi --session <path>`. */
	sessionFile: string;
	cwd: string;
	explicitExtensionArgs: readonly string[];
	provider: string | null | undefined;
	model: string;
}

/**
 * A Claude Code citizen's launch facts, all from the record. `nativeSessionId` is the argument of
 * `claude --resume`; `createdAt` is carried so the observation can confirm the SAME record came
 * back, not merely a record under the same garden id. `attachIncarnation` is the record's arm
 * binding (#147 L2 B1), compared with the receiver marker's copy — `null` is carried as null,
 * never filled. No model or permission flag is here: a resume does not restore the options a
 * session was once started with.
 */
export interface ClaudeCodeLaunchIdentity {
	backend: "claude-code";
	nativeSessionId: string;
	cwd: string;
	createdAt: string;
	attachIncarnation: string | null;
}

export type LaunchIdentity = PiLaunchIdentity | ClaudeCodeLaunchIdentity;

/**
 * Claude Code's session id grammar: a lowercase UUID. The value becomes an argv token after
 * `--resume`, so anything else — a leading `-`, whitespace, a path — is refused as a bad record
 * rather than handed to the vendor CLI as something it would parse differently.
 */
const CLAUDE_SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** A claude-code record → its resume facts. Throws, with its own cause, on a record that cannot be resumed. */
function resolveClaudeCodeLaunchIdentity(
	gardenId: string,
	record: {
		nativeSessionId: string;
		cwd: string;
		transcriptPath: string | null;
		createdAt: string;
		attachIncarnation: string | null;
	},
): ClaudeCodeLaunchIdentity {
	if (!CLAUDE_SESSION_ID.test(record.nativeSessionId)) {
		throw new Error(
			`resume-launch-identity: ${gardenId} records nativeSessionId ${JSON.stringify(record.nativeSessionId)}, ` +
				`which is not a Claude Code session id (lowercase UUID) — refusing to hand it to claude --resume.`,
		);
	}
	const transcript = record.transcriptPath;
	if (!transcript || !path.isAbsolute(transcript)) {
		throw new Error(
			`resume-launch-identity: ${gardenId} records no absolute transcriptPath (${JSON.stringify(transcript)}) — ` +
				`the birth hook writes one for every Claude Code session, so this record cannot name a session to resume.`,
		);
	}
	let isFile = false;
	try {
		isFile = statSync(transcript).isFile();
	} catch {
		isFile = false;
	}
	if (!isFile) {
		throw new Error(
			`resume-launch-identity: ${gardenId} recorded transcriptPath "${transcript}" is not a file on disk — ` +
				`the session's transcript is gone, so claude --resume would open nothing.`,
		);
	}
	if (!path.isAbsolute(record.cwd)) {
		throw new Error(`resume-launch-identity: ${gardenId} records a relative cwd ${JSON.stringify(record.cwd)}.`);
	}
	return {
		backend: "claude-code",
		nativeSessionId: record.nativeSessionId,
		cwd: record.cwd,
		createdAt: record.createdAt,
		attachIncarnation: record.attachIncarnation,
	};
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
 * That check is per-record, and per-record is not enough: the v2 lock domain is keyed on
 * GARDEN ID, so two records sharing one `nativeSessionId` would each pass their own
 * integrity check and resume the SAME transcript concurrently under two different locks.
 * Hence {@link readAddressableMetaIdentity} rather than the plain targeted read (#52) —
 * a resume is exactly the moment a record stops being data and becomes an address.
 *
 * Everything else is unchanged authority: readSessionIdentity (first model_change) for
 * provider/model/cwd, getEntwurfExplicitExtensions for bridge re-injection (#29 fail-fast).
 * Throws on anything that makes a resume impossible — a stale/foreign transcript, a
 * deleted session file, an unrecorded model, an unresolvable ACP bridge. Every throw
 * names its own cause; none of them degrades into a silent no-op.
 */
export function resolveResumeLaunchIdentity(gardenId: string): LaunchIdentity {
	const record = readAddressableMetaIdentity(gardenId);
	if (record.backend === "claude-code") return resolveClaudeCodeLaunchIdentity(gardenId, record);
	if (record.backend !== "pi") {
		throw new ResumeBackendUnsupportedError(gardenId, record.backend);
	}
	const sessionFile = record.transcriptPath;
	if (!sessionFile) {
		throw new Error(
			`resume-launch-identity: ${gardenId} has no recorded transcriptPath — ` +
				`the citizen never wrote a session file (no turn yet), so there is nothing to resume.`,
		);
	}
	// A recorded path is only a resume target while it names ONE file from everywhere. The record
	// schema types transcriptPath as a nullable string and does not require an absolute path, and
	// `existsSync` below would happily resolve a relative one against THIS process's cwd — while
	// the launch resolves `--session <relative>` inside the window's own `-c <record cwd>`. Those
	// are two different files whenever the two directories differ, and the resume would open the
	// wrong transcript with a receipt that looks correct. This is a bad record, not an expected
	// refusal, so it throws with its own cause like every other integrity failure here.
	if (!path.isAbsolute(sessionFile)) {
		throw new Error(
			`resume-launch-identity: ${gardenId} recorded a RELATIVE transcriptPath ${JSON.stringify(sessionFile)} — ` +
				`a resume resolves --session inside the window's own working directory, so a relative path would name a ` +
				`different file than the one checked here; refusing rather than resuming an unknown transcript.`,
		);
	}
	// A recorded path is only a resume target while the file is actually on disk.
	// Without this check a missing transcript falls through readSessionIdentity's
	// ENOENT swallow and surfaces as "no recorded model" — the wrong cause (F7):
	// the transcript was deleted, or the record carries a phantom path minted
	// before birth guarded on file existence.
	if (!existsSync(sessionFile)) {
		throw new Error(
			`resume-launch-identity: ${gardenId} recorded transcriptPath "${sessionFile}" ` +
				`does not exist on disk — the transcript was deleted, or the record carries a phantom ` +
				`path from a pre-guard birth; nothing to resume.`,
		);
	}
	const identity = readSessionIdentity(sessionFile);
	const resumeModel = identity?.modelId ?? null;
	if (!identity || !resumeModel) {
		throw new Error(`resume-launch-identity: ${gardenId} has no recorded model — cannot resume.`);
	}
	if (identity.sessionId !== record.nativeSessionId) {
		throw new Error(
			`resume-launch-identity: ${gardenId} transcript header id "${identity.sessionId ?? "(none)"}" ` +
				`does not match the record's nativeSessionId "${record.nativeSessionId}" — the recorded transcriptPath ` +
				`is stale or points at a foreign session file; refusing to resume another being's transcript.`,
		);
	}
	const explicitExtensions = getEntwurfExplicitExtensions(resumeModel, false, identity.provider);
	if (explicitExtensions.unresolvedAcpIntent) {
		throw new Error(
			`resume-launch-identity: ${gardenId} recorded provider=entwurf but the bridge ` +
				`extension could not be resolved — refusing to resume with an unknown provider (#29).`,
		);
	}
	if (!identity.cwd) {
		throw new Error(`resume-launch-identity: ${gardenId} header has no cwd (the cold-resume authority, #9).`);
	}
	// #128: the pair checked is the one the launch will EMIT, not the recorded provider alone —
	// `getEntwurfExplicitExtensions` also routes a bare Claude model id to `entwurf`. Under that
	// provider Pi resolves `--model` by substring, so a retired `claude-sonnet-5` would reopen on
	// `cortex-claude-sonnet-5`. The record and transcript stay as they are; the resume is refused.
	const provider = explicitExtensions.provider ?? identity.provider;
	const model = explicitExtensions.modelOverride ?? resumeModel;
	if (provider === PROVIDER_ID && !isCuratedAcpModelId(model)) throw new AcpModelNotCuratedError(model);
	return {
		backend: "pi",
		sessionFile,
		cwd: identity.cwd,
		explicitExtensionArgs: explicitExtensions.args,
		provider,
		model,
	};
}
