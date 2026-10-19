/**
 * remote-pair-receive — the RECEIVING half of #107's one declared remote pair (rail 1).
 *
 * The host that owns the target record runs this once per SSH call. It reads one JSON claim
 * from stdin, checks it against the operator-written pair declaration, and hands a matching
 * claim to the existing v2 dispatch. The record, owner and deliverability checks stay the
 * dispatch's own: nothing here writes a mailbox, resolves a rail, or retries.
 *
 * Trust model (GLG, #107 D3 (a)): the boundary is the same operator's SSH account. The pair
 * check is a SCOPE limit, not authentication: a claim whose `from`/`target` is not the declared
 * pair is refused before any mutation. It does not detect that same account sending the
 * declared gid falsely; nothing here claims to.
 *
 * Sender: the stdin claim is the only sender input. Ambient carriers (`PI_SESSION_ID`,
 * `PI_AGENT_ID`, sender markers) in the SSH environment are never consulted, so this module
 * does not import the authoritative-sender resolver at all.
 *
 * Interim display (rail 2 owns the final one): the envelope rides the existing
 * `external-mcp` / non-replyable origin, so the receiver sees a non-local, non-replyable
 * sender rather than a live reply hint. The agentId names the declared route.
 */

import type { SenderEnvelope } from "./entwurf-control-rpc.ts";
import type { EntwurfV2SurfaceRendered, SurfaceEntwurfV2Params } from "./entwurf-v2-surface.ts";
import { requireGardenId } from "./meta-session.ts";

/** One operator-declared pair, as written on the RECEIVING host. */
export interface RemotePairDeclaration {
	/** The sender's garden id on the other host. */
	remoteGardenId: string;
	/** The SSH alias this host uses to reach it (route label; never an identity). */
	ssh: string;
	/** The garden id on THIS host the remote sender may address. */
	localGardenId: string;
}

/** What the sending host writes to stdin. */
export interface RemoteClaim {
	from: string;
	fromAgentId: string;
	/** A path on the SENDING host. Shown, never checked here. */
	fromCwd: string;
	target: string;
	message: string;
	wantsReply: boolean;
}

export type RemotePairRejectReason = "remote-pair-from-mismatch" | "remote-pair-target-mismatch";

export type RemoteReceiveReceipt =
	| { kind: "rejected"; reason: RemotePairRejectReason; detail: string }
	| { kind: "dispatched"; isError: boolean; text: string };

export interface RemoteReceiveDeps {
	dispatch: (params: SurfaceEntwurfV2Params, sender: SenderEnvelope) => Promise<EntwurfV2SurfaceRendered>;
	now?: () => Date;
}

const MESSAGE_CAP = 16000;

/** Every Unicode control character (the class herdr-fresh-call.ts refuses). A header field is
 * rendered unescaped into the body's `[entwurf received]` block, so a newline in one could forge a
 * `session:` or `wants reply:` line. The message body keeps its newlines. */
const CONTROL_CHAR = /\p{Cc}/u;

export class RemotePairInputError extends Error {}

function parseObject(text: string, what: string): Record<string, unknown> {
	let raw: unknown;
	try {
		raw = JSON.parse(text);
	} catch (err) {
		throw new RemotePairInputError(`${what}: not JSON (${err instanceof Error ? err.message : String(err)})`);
	}
	if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
		throw new RemotePairInputError(`${what}: must be a JSON object`);
	}
	return raw as Record<string, unknown>;
}

function requireExactKeys(obj: Record<string, unknown>, keys: readonly string[], what: string): void {
	const got = Object.keys(obj).sort();
	const want = [...keys].sort();
	if (got.length !== want.length || got.some((k, i) => k !== want[i])) {
		throw new RemotePairInputError(`${what}: keys must be exactly ${want.join(", ")} (got ${got.join(", ")})`);
	}
}

function requireString(obj: Record<string, unknown>, key: string, what: string): string {
	const v = obj[key];
	if (typeof v !== "string" || v.length === 0) {
		throw new RemotePairInputError(`${what}: "${key}" must be a non-empty string`);
	}
	return v;
}

/** A field that lands in the rendered sender header: non-empty and free of control characters. */
function requireHeaderString(obj: Record<string, unknown>, key: string, what: string): string {
	const v = requireString(obj, key, what);
	if (CONTROL_CHAR.test(v)) {
		throw new RemotePairInputError(`${what}: "${key}" must not contain control characters`);
	}
	return v;
}

export function parseRemotePairDeclaration(text: string): RemotePairDeclaration {
	const what = "remote pair declaration";
	const obj = parseObject(text, what);
	requireExactKeys(obj, ["remoteGardenId", "ssh", "localGardenId"], what);
	return {
		remoteGardenId: requireGardenId(obj.remoteGardenId),
		ssh: requireHeaderString(obj, "ssh", what),
		localGardenId: requireGardenId(obj.localGardenId),
	};
}

export function parseRemoteClaim(text: string): RemoteClaim {
	const what = "remote claim";
	const obj = parseObject(text, what);
	requireExactKeys(obj, ["from", "fromAgentId", "fromCwd", "target", "message", "wantsReply"], what);
	const message = requireString(obj, "message", what);
	if (message.length > MESSAGE_CAP) {
		throw new RemotePairInputError(`${what}: "message" exceeds ${MESSAGE_CAP} chars`);
	}
	if (typeof obj.wantsReply !== "boolean") {
		throw new RemotePairInputError(`${what}: "wantsReply" must be a boolean`);
	}
	return {
		from: requireGardenId(obj.from),
		fromAgentId: requireHeaderString(obj, "fromAgentId", what),
		fromCwd: requireHeaderString(obj, "fromCwd", what),
		target: requireGardenId(obj.target),
		message,
		wantsReply: obj.wantsReply,
	};
}

/** The scope check. Null = inside the declared pair. */
export function checkRemotePair(
	claim: RemoteClaim,
	decl: RemotePairDeclaration,
): { reason: RemotePairRejectReason; detail: string } | null {
	if (claim.from !== decl.remoteGardenId) {
		return {
			reason: "remote-pair-from-mismatch",
			detail: `from ${claim.from} is not the declared remote ${decl.remoteGardenId}`,
		};
	}
	if (claim.target !== decl.localGardenId) {
		return {
			reason: "remote-pair-target-mismatch",
			detail: `target ${claim.target} is not the declared local ${decl.localGardenId}`,
		};
	}
	return null;
}

export function buildRemoteSenderEnvelope(claim: RemoteClaim, decl: RemotePairDeclaration, now: Date): SenderEnvelope {
	return {
		sessionId: claim.from,
		agentId: `remote via ${decl.ssh}: ${claim.fromAgentId}`,
		cwd: claim.fromCwd,
		timestamp: now.toISOString(),
		origin: "external-mcp",
		replyable: false,
	};
}

export async function receiveRemoteClaim(
	claim: RemoteClaim,
	decl: RemotePairDeclaration,
	deps: RemoteReceiveDeps,
): Promise<RemoteReceiveReceipt> {
	const mismatch = checkRemotePair(claim, decl);
	if (mismatch) return { kind: "rejected", ...mismatch };
	const sender = buildRemoteSenderEnvelope(claim, decl, (deps.now ?? (() => new Date()))());
	const rendered = await deps.dispatch(
		{ target: claim.target, intent: "fire-and-forget", message: claim.message, wants_reply: claim.wantsReply },
		sender,
	);
	return { kind: "dispatched", isError: rendered.isError, text: rendered.text };
}
