/** Pi core-side request adapter, not a public tool or authorization boundary.
 * The caller supplies a CERTIFIED MetaIdentity and owns authorization, self-retire refusal,
 * target locking and record freshness. No second lock, record scan or receiver admission
 * implementation lives here. The receiver owns generation/TUI/idle/pending validation.
 */
import * as os from "node:os";
import type { RetireResult } from "./control-retire.js";
import { controlSocketPathIn, defaultControlSocketDir } from "./control-socket-path.js";
import { type RpcRetireCommand, sendRpcCommand } from "./entwurf-control-rpc.ts";
import type { MetaIdentity } from "./meta-session.js";
import { SESSION_ID_RE } from "./session-id.js";

type ReceiverRefusal = Extract<RetireResult, { boundary: "refused" }>["reason"];
const RECEIVER_REFUSALS: readonly ReceiverRefusal[] = [
	"target-closing",
	"target-stale",
	"target-context-unavailable",
	"target-non-tui",
	"target-busy",
	"target-pending",
];

export type PiRetireRequestResult =
	| { boundary: "shutdown-requested" }
	| { boundary: "refused"; phase: "preflight"; reason: "target-backend-unsupported" | "target-identity-mismatch" }
	| { boundary: "refused"; phase: "receiver"; reason: ReceiverRefusal }
	| { boundary: "unknown"; reason: "malformed-response" | "transport-error" | "shutdown-call-failed" };

function object(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
	const actual = Object.keys(value);
	return actual.length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

/** Closed wire combinations only. A malformed answer AFTER sending cannot prove no action.
 * SDK request acceptance is not exit, persistence/flush, or no-further-model-activity evidence.
 */
export function parsePiRetireResponse(response: unknown): PiRetireRequestResult {
	const malformed: PiRetireRequestResult = { boundary: "unknown", reason: "malformed-response" };
	if (!object(response) || response.type !== "response" || response.command !== "retire") return malformed;
	if (Object.keys(response).some((key) => !["type", "command", "success", "data", "error", "id"].includes(key))) {
		return malformed;
	}
	if (Object.hasOwn(response, "id") && typeof response.id !== "string") return malformed;
	const data = response.data;
	if (!object(data)) return malformed;
	if (response.success === true && data.boundary === "shutdown-requested") {
		if (!exactKeys(data, ["boundary"]) || Object.hasOwn(response, "error")) return malformed;
		return { boundary: "shutdown-requested" };
	}
	if (response.success !== false || !exactKeys(data, ["boundary", "reason"]) || response.error !== data.reason) {
		return malformed;
	}
	if (data.boundary === "refused" && RECEIVER_REFUSALS.includes(data.reason as ReceiverRefusal)) {
		return { boundary: "refused", phase: "receiver", reason: data.reason as ReceiverRefusal };
	}
	if (data.boundary === "unknown" && data.reason === "shutdown-call-failed") {
		return { boundary: "unknown", reason: "shutdown-call-failed" };
	}
	return malformed;
}

export interface PiRetireRequestOptions {
	/** Internal composition root's existing socket directory; never a target-supplied path. */
	controlSocketDir?: string;
	/** Bounds this ONE transport request; a timeout never starts a retry/fallback. */
	timeoutMs?: number;
	/** Existing RPC seam, injectable for deterministic wire-result tests. */
	sendRpc?: (
		socketPath: string,
		command: RpcRetireCommand,
		options: { timeout: number },
	) => Promise<{ response: unknown }>;
}

export async function requestPiRetire(
	target: MetaIdentity,
	expected: { gardenId: string; nativeSessionId: string },
	options: PiRetireRequestOptions = {},
): Promise<PiRetireRequestResult> {
	if (target.backend !== "pi") {
		return { boundary: "refused", phase: "preflight", reason: "target-backend-unsupported" };
	}
	if (
		target.gardenId !== expected.gardenId ||
		target.nativeSessionId !== expected.nativeSessionId ||
		!SESSION_ID_RE.test(target.gardenId) ||
		target.nativeSessionId.length === 0
	) {
		return { boundary: "refused", phase: "preflight", reason: "target-identity-mismatch" };
	}
	const socketPath = controlSocketPathIn(
		options.controlSocketDir ?? defaultControlSocketDir(os.homedir()),
		target.gardenId,
	);
	try {
		const { response } = await (options.sendRpc ?? sendRpcCommand)(
			socketPath,
			{ type: "retire", gardenId: target.gardenId, nativeSessionId: target.nativeSessionId },
			{ timeout: options.timeoutMs ?? 5000 },
		);
		return parsePiRetireResponse(response);
	} catch {
		// The RPC API does not expose whether bytes were written. Even connection errors
		// are conservatively unknown here; do not infer a safe pre-send refusal or retry.
		return { boundary: "unknown", reason: "transport-error" };
	}
}
