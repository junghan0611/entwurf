/**
 * resume-launch-identity — the RECORD-AUTHORITATIVE half of resuming a pi citizen,
 * kept after the visible-first cut removed everything that used to call it.
 *
 * It was the preamble of the `spawn-bg` watcher's `spawnChild` (entwurf-v2-spawn-production.ts,
 * deleted with that transport): garden id → the meta-record → the transcript that record
 * claims → the provider/model/cwd that transcript's own header carries. None of that is
 * about being hidden or visible. It is the answer to "which being is this, and which
 * conversation is theirs", and it is the same answer a VISIBLE resume will need.
 *
 * So this leaf is preserved deliberately, with no consumer in the shipped tree today.
 * `check-resume-launch-identity` holds its contract so the record-integrity rules below —
 * the transcript header id must equal `record.nativeSessionId`, an addressable read
 * (#52) rather than a plain targeted one, a recorded ACP provider must resolve its
 * bridge — cannot rot while they wait.
 *
 * It takes a bare garden id, not a plan: the plan type it used to destructure belonged to
 * the removed transport, and the identity question never needed the rest of it.
 */

import { existsSync } from "node:fs";
import { getEntwurfExplicitExtensions, readSessionIdentity } from "./entwurf-core.ts";
import { readAddressableMetaIdentity } from "./meta-session.ts";

/** The launch-time facts `buildResumePiArgs` needs, resolved from the meta-record + the
 * recorded transcript (record authority, #50 C2/C3). */
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
	if (record.backend !== "pi") {
		throw new Error(
			`resume-launch-identity: ${gardenId} is a ${record.backend} citizen — ` +
				`resume is a host-adapter relaunch capability, and its domain currently contains backend pi only. ` +
				`This is a capability boundary, not the control-socket rail and not citizen rank.`,
		);
	}
	const sessionFile = record.transcriptPath;
	if (!sessionFile) {
		throw new Error(
			`resume-launch-identity: ${gardenId} has no recorded transcriptPath — ` +
				`the citizen never wrote a session file (no turn yet), so there is nothing to resume.`,
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
	return {
		sessionFile,
		cwd: identity.cwd,
		explicitExtensionArgs: explicitExtensions.args,
		provider: explicitExtensions.provider ?? identity.provider,
		model: explicitExtensions.modelOverride ?? resumeModel,
	};
}
