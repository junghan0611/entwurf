/**
 * openclaw-send — the claim entry an OpenClaw plugin tool hands one outbound message to
 * (#160 S2 card §3). OpenClaw → sibling.
 *
 * The plugin tool runs inside the Gateway, where OpenClaw fills its ctx with (agentId, sessionKey)
 * (S1 M1 [측정]). Its stdio MCP children carry no session identity at all (M4 [측정]), so the MCP
 * hand cannot name the caller; the plugin instead serializes one strict claim and runs the fixed
 * entry `entwurf openclaw-send --decl <abs>` with the claim on stdin. This module is that entry's
 * decision half: parse the claim, check it against the operator's scope declaration, join it to
 * exactly one V3 record, build the record-backed sender envelope, and hand it to the existing v2
 * dispatch. Nothing here writes a record, resolves a rail, or retries.
 *
 * Trust model (card §3, same wording as remote-pair): the claim is NOT authentication. Any process
 * of the same OS account can run the entry and claim any declared (scope, sessionKey). The
 * declaration is a scope limit; the record is the identity. Ambient carriers (`PI_SESSION_ID`,
 * `PI_AGENT_ID`, sender markers) are never consulted.
 *
 * who-sent ≠ replyable (adding-a-harness.md step 6(c)): the envelope names the record's garden id;
 * `replyable` is the receive rail's own probe answer for that record, supplied by the caller.
 *
 * Backend literal boundary (S3 flip): the record backend `openclaw` is not yet a member of
 * `MetaCitizenBackend`. {@link OPENCLAW_BACKEND} is therefore typed `string` and the record view
 * below is structural. At the flip it becomes `"openclaw" satisfies MetaCitizenBackend`.
 */

import type { SenderEnvelope } from "./entwurf-control-rpc.ts";
import type { EntwurfV2SurfaceRendered, SurfaceEntwurfV2Params } from "./entwurf-v2-surface.ts";
import type { MailboxSenderEnvelope } from "./meta-mailbox-body.ts";
import { requireGardenId } from "./meta-session.ts";
import {
	composeOpenclawNativeSessionId,
	type OpenclawCitizensDeclaration,
	requireOpenclawAgentId,
	requireOpenclawScope,
	requireOpenclawSessionKey,
	selectOpenclawScope,
} from "./openclaw-citizens.ts";

/** S3 flip boundary: becomes `"openclaw" satisfies MetaCitizenBackend`. */
export const OPENCLAW_BACKEND: string = "openclaw";

export const OPENCLAW_CLAIM_VERSION = 1;
const MESSAGE_CAP = 16000;

/** What the plugin writes to stdin — exactly these keys. */
export interface OpenclawClaim {
	scope: string;
	agentId: string;
	sessionKey: string;
	target: string;
	message: string;
	wantsReply: boolean;
}

/** The record fields this join reads. A `MetaIdentity` is assignable to it. */
export interface OpenclawRecordView {
	gardenId: string;
	backend: string;
	nativeSessionId: string;
	cwd: string;
}

export type OpenclawSendRejectReason = "openclaw-scope-not-declared" | "openclaw-sender-not-citizen";

export type OpenclawSendReceipt =
	| { kind: "rejected"; reason: OpenclawSendRejectReason; detail: string }
	| { kind: "dispatched"; isError: boolean; text: string }
	| { kind: "invalid"; detail: string };

export interface OpenclawSendDeps {
	/** The certified store's identities, read at the moment of use. */
	listIdentities: () => readonly OpenclawRecordView[];
	/** The receive rail's probe answer for THIS record (native-push: probe alive and not paused). */
	replyable: (record: OpenclawRecordView) => Promise<boolean>;
	dispatch: (params: SurfaceEntwurfV2Params, sender: SenderEnvelope) => Promise<EntwurfV2SurfaceRendered>;
	now?: () => Date;
}

export class OpenclawClaimError extends Error {}

/** Every Unicode control character: a header field is rendered unescaped into the body header. */
const CONTROL_CHAR = /\p{Cc}/u;

export function parseOpenclawClaim(text: string): OpenclawClaim {
	const what = "openclaw claim";
	let raw: unknown;
	try {
		raw = JSON.parse(text);
	} catch (err) {
		throw new OpenclawClaimError(`${what}: not JSON (${err instanceof Error ? err.message : String(err)})`);
	}
	if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
		throw new OpenclawClaimError(`${what}: must be a JSON object`);
	}
	const obj = raw as Record<string, unknown>;
	const want = ["agentId", "message", "scope", "sessionKey", "target", "v", "wantsReply"];
	const got = Object.keys(obj).sort();
	if (got.length !== want.length || got.some((k, i) => k !== want[i])) {
		throw new OpenclawClaimError(`${what}: keys must be exactly ${want.join(", ")} (got ${got.join(", ")})`);
	}
	if (obj.v !== OPENCLAW_CLAIM_VERSION) {
		throw new OpenclawClaimError(`${what}: "v" must be ${OPENCLAW_CLAIM_VERSION} (got ${JSON.stringify(obj.v)})`);
	}
	if (typeof obj.message !== "string" || obj.message.length === 0) {
		throw new OpenclawClaimError(`${what}: "message" must be a non-empty string`);
	}
	if (obj.message.length > MESSAGE_CAP) {
		throw new OpenclawClaimError(`${what}: "message" exceeds ${MESSAGE_CAP} chars`);
	}
	if (typeof obj.wantsReply !== "boolean") {
		throw new OpenclawClaimError(`${what}: "wantsReply" must be a boolean`);
	}
	try {
		const agentId = requireOpenclawAgentId(obj.agentId, `${what}.agentId`);
		const claim: OpenclawClaim = {
			scope: requireOpenclawScope(obj.scope, `${what}.scope`),
			agentId,
			sessionKey: requireOpenclawSessionKey(obj.sessionKey, agentId, `${what}.sessionKey`),
			target: requireGardenId(obj.target),
			message: obj.message,
			wantsReply: obj.wantsReply,
		};
		// The grammars above already refuse these; checked again here because they are rendered.
		for (const k of ["scope", "agentId", "sessionKey"] as const) {
			if (CONTROL_CHAR.test(claim[k])) throw new OpenclawClaimError(`${what}: "${k}" has a control character`);
		}
		return claim;
	} catch (err) {
		if (err instanceof OpenclawClaimError) throw err;
		throw new OpenclawClaimError(err instanceof Error ? err.message : String(err));
	}
}

/**
 * The one record this claim names, or a refusal. Exactly one `openclaw` record must carry the
 * composed native id; none or several is `openclaw-sender-not-citizen`. A record of another
 * backend carrying that id is also not this citizen.
 */
export function joinOpenclawSender(
	claim: OpenclawClaim,
	identities: readonly OpenclawRecordView[],
): { record: OpenclawRecordView } | { reason: "openclaw-sender-not-citizen"; detail: string } {
	const nativeSessionId = composeOpenclawNativeSessionId(claim.scope, claim.agentId, claim.sessionKey);
	const hits = identities.filter((r) => r.nativeSessionId === nativeSessionId);
	const own = hits.filter((r) => r.backend === OPENCLAW_BACKEND);
	if (own.length === 1 && hits.length === 1) return { record: own[0] };
	const detail =
		hits.length === 0
			? `no record carries ${nativeSessionId}; birth it first (entwurf openclaw-birth)`
			: `${hits.length} record(s) carry ${nativeSessionId} (${hits.map((r) => `${r.gardenId}/${r.backend}`).join(", ")})`;
	return { reason: "openclaw-sender-not-citizen", detail };
}

export function buildOpenclawSenderEnvelope(
	record: OpenclawRecordView,
	replyable: boolean,
	now: Date,
): SenderEnvelope & MailboxSenderEnvelope {
	return {
		sessionId: record.gardenId,
		agentId: `meta-session/${record.backend}`,
		cwd: record.cwd,
		timestamp: now.toISOString(),
		origin: "meta-session",
		replyable,
	};
}

/** Scope → record join → envelope → the existing v2 dispatch. */
export async function receiveOpenclawClaim(
	claim: OpenclawClaim,
	decl: OpenclawCitizensDeclaration,
	deps: OpenclawSendDeps,
): Promise<OpenclawSendReceipt> {
	const scoped = selectOpenclawScope(decl, claim.scope, claim.agentId, claim.sessionKey);
	if (!("gateway" in scoped)) return { kind: "rejected", ...scoped };
	const joined = joinOpenclawSender(claim, deps.listIdentities());
	if (!("record" in joined)) return { kind: "rejected", ...joined };
	const replyable = await deps.replyable(joined.record);
	const sender = buildOpenclawSenderEnvelope(joined.record, replyable, (deps.now ?? (() => new Date()))());
	const rendered = await deps.dispatch(
		{ target: claim.target, intent: "fire-and-forget", message: claim.message, wants_reply: claim.wantsReply },
		sender,
	);
	return { kind: "dispatched", isError: rendered.isError, text: rendered.text };
}

/**
 * The entry's exit contract (card §3; remote-pair numbers and meanings): 0 dispatched clean,
 * 4 dispatched with a reported error, 3 scope/record refusal, 2 invalid. 1 (an uncaught throw)
 * carries no receipt and is not produced here.
 */
export function openclawSendExitCode(receipt: OpenclawSendReceipt): 0 | 2 | 3 | 4 {
	switch (receipt.kind) {
		case "invalid":
			return 2;
		case "rejected":
			return 3;
		case "dispatched":
			return receipt.isError ? 4 : 0;
	}
}
