/**
 * control-send-receipt — the ONE place the control-socket's acceptance boundary is named,
 * on both ends of the wire (#120 P2).
 *
 * WHY A BOUNDARY AXIS AT ALL, AND WHY IT IS NOT THE ROUTE AXIS.
 * `SendFinalOutcome` (`entwurf-v2-send.ts`) answers WHICH LEG delivered — first socket,
 * re-resolved socket, mailbox — and it is what the release reducer keys on. It is an INTERNAL
 * route/release algebra and it is NOT the sender-visible delivery boundary: `sent` and
 * `fallback-sent` say a receiver accepted the bytes, and nothing whatever about what the receiver
 * then did with them. Answering "what happened to my message" with a route word is how
 * `control-socket → sent` came to mean four different things, one of which was
 * "queued behind ten steers and dropped when the operator hit ESC".
 *
 * `[측정 2026-09-22, pi-agent-core 0.87.0; 재측정 2026-09-23, 0.87.1 — 좌표 동일]` the receiver's two queues are independent and each is
 * `one-at-a-time` (`dist/agent.js:60-71,96-97,137-138`); steering is drained after every turn
 * (`dist/agent-loop.js:85,186`) while follow-ups are drained ONLY when the inner loop has ended
 * (`:191-197`). There is no global FIFO across them. So `steer` and `follow_up` are not two
 * spellings of one queue — they are two different promises about when, and a receipt that cannot
 * tell them apart cannot be used to reason about either.
 *
 * WHAT EACH BOUNDARY CLAIMS, EXACTLY:
 *   sent                        the receiver was idle and the message was accepted as a DIRECT
 *                               turn trigger. It is an accepted REQUEST, not proof that the model
 *                               saw it and not proof the turn completed.
 *   queued-steer                accepted into the receiver's in-process steering queue. Volatile
 *                               process memory: no durability, no ordering against the other
 *                               queue, and an abort clears it.
 *   queued-follow-up            accepted into the receiver's in-process follow-up queue. Same
 *                               volatility, and it waits for the inner loop to end — a steer that
 *                               arrives later still goes first.
 *   accepted-unknown-boundary   the receiver ACCEPTED (its RPC answered success) but did not name
 *                               a boundary this build understands. Version skew, not failure: the
 *                               message is gone from our hands either way, so this must never be
 *                               rendered as a failure to retry — and never as `sent`, which would
 *                               put back the exact false claim this axis exists to remove.
 *
 * NO LEGACY MAPPER LIVES HERE. The previous wire carried `delivered:true` plus a `deliveredAs`
 * producer nothing consumed; both are gone rather than translated. A new receiver answers an old
 * sender fine (it keys on `response.success` and ignores `data`), and an old receiver answers a
 * new sender as `accepted-unknown-boundary` — which is the honest name for it. A dual route would
 * be a second address for one fact.
 */

/** The closed boundary set, in the order a reader should learn them. */
export const ACCEPTANCE_BOUNDARIES = [
	"sent",
	"queued-steer",
	"queued-follow-up",
	// #163 S7, provisional names (final names at the wrap-up, never kept as aliases):
	// a busy ACP turn took the steer as input (not proof the model saw it; no tool is stopped) …
	"steer-in-turn",
	// … or the steer request left and whether the backend took it is unknown (never retried).
	"steer-unknown",
	"accepted-unknown-boundary",
] as const;

export type AcceptanceBoundary = (typeof ACCEPTANCE_BOUNDARIES)[number];

/** What a receiver can actually observe about itself. `accepted-unknown-boundary` is a READER's
 * verdict about an answer it could not classify, so a receiver may never produce it. */
export type ObservedBoundary = Exclude<AcceptanceBoundary, "accepted-unknown-boundary">;

/**
 * RECEIVER SIDE. The whole classification, from the two facts the receiver already has at the
 * moment it accepts: was it idle, and which queue did the caller ask for. Pure — it reads no
 * clock, no socket and no session, so the same inputs always name the same boundary.
 *
 * `idle` wins over `mode`: an idle receiver takes the message as a direct trigger and neither
 * queue is involved, which is why `mode` is meaningless there (`entwurf-control.ts` passes no
 * `deliverAs` on that branch).
 */
export function sendReceiptBoundary(input: { idle: boolean; mode: "steer" | "follow_up" }): ObservedBoundary {
	if (input.idle) return "sent";
	return input.mode === "follow_up" ? "queued-follow-up" : "queued-steer";
}

/** Is this an acceptance a receiver could have observed about itself? */
export function isObservedBoundary(value: unknown): value is ObservedBoundary {
	return (
		value === "sent" ||
		value === "queued-steer" ||
		value === "queued-follow-up" ||
		value === "steer-in-turn" ||
		value === "steer-unknown"
	);
}

/**
 * SENDER SIDE. Read the receiver's typed boundary off an RPC `data` payload.
 *
 * Anything this build does not recognise — a missing field, an older receiver's shape, a value
 * outside the set — is `accepted-unknown-boundary` and NOT an error: by the time `data` exists the
 * RPC has already answered success, so the message has been accepted. Inventing a failure here
 * would invite a retry that double-delivers, and answering `sent` would claim a direct injection
 * nobody reported.
 */
export function parseAcceptanceBoundary(data: unknown): AcceptanceBoundary {
	if (typeof data !== "object" || data === null) return "accepted-unknown-boundary";
	const value = (data as { boundary?: unknown }).boundary;
	return isObservedBoundary(value) ? value : "accepted-unknown-boundary";
}

/** How much of an unrecognised answer may be repeated back. A receiver's payload is untrusted
 * input from another process; a full object on a status line is an injection surface and an
 * unbounded one at that. */
const UNKNOWN_DIAGNOSTIC_MAX = 80;

/**
 * A BOUNDED, single-line description of an answer we could not classify — for the operator who has
 * to decide whether this is version skew or a broken peer. Returns `undefined` when there is
 * nothing worth saying, so a caller renders the bare boundary rather than an empty parenthesis.
 *
 * It describes the SHAPE and never trusts the content: the raw value is stringified, stripped of
 * newlines and truncated. Never the whole object.
 */
export function describeUnknownBoundary(data: unknown): string | undefined {
	if (typeof data !== "object" || data === null) return data === undefined ? undefined : `data: ${typeof data}`;
	const value = (data as { boundary?: unknown }).boundary;
	if (value === undefined) return "no boundary field";
	const raw = typeof value === "string" ? value : typeof value;
	const flat = raw.replace(/\s+/g, " ").trim();
	if (flat === "") return "empty boundary";
	return flat.length > UNKNOWN_DIAGNOSTIC_MAX ? `${flat.slice(0, UNKNOWN_DIAGNOSTIC_MAX)}…` : flat;
}

/**
 * #163 S7 — the reasons a receiver may give for `steer-unknown`, closed. A token outside this set is
 * read as `unrecognized`, never repeated (provisional, like the two boundary names).
 */
export const STEER_UNKNOWN_REASONS = [
	"timeout",
	"connection-closed",
	"request-rejected",
	"seam-threw",
	"answer-unrecognized",
] as const;
export type SteerUnknownReason = (typeof STEER_UNKNOWN_REASONS)[number];

/** How much of a receiver's free-text detail may reach a caller's status line. */
export const ACCEPTANCE_DETAIL_MAX = 120;

/**
 * What a receiver said BESIDE a `steer-*` boundary that the caller has to see (#163 S7, SOL D1):
 * why acceptance is unknown, or that the record of an injected steer did not land. Normalized at
 * the wire seam — closed tokens plus a bounded, single-line detail — so another process's payload
 * is never carried raw. Admission is unchanged: these ride a SUCCESS.
 */
export interface AcceptanceDiagnostic {
	/** `steer-unknown`: the receiver's reason, or `unrecognized`. */
	reason?: SteerUnknownReason | "unrecognized";
	/** `steer-in-turn`: the record did not land as `ok`. */
	record?: "skipped-binding-changed" | "failed" | "unrecognized";
	/** Bounded, single-line free text from the receiver. */
	detail?: string;
}

function boundDetail(value: unknown): string | undefined {
	if (typeof value !== "string") return undefined;
	// biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are what is stripped
	const flat = value.replace(/[\u0000-\u001f\u007f\s]+/g, " ").trim();
	if (flat === "") return undefined;
	return flat.length > ACCEPTANCE_DETAIL_MAX ? `${flat.slice(0, ACCEPTANCE_DETAIL_MAX)}…` : flat;
}

/** SENDER SIDE. Read the diagnostic beside a `steer-*` boundary; `undefined` when there is none. */
export function parseAcceptanceDiagnostic(
	boundary: AcceptanceBoundary,
	data: unknown,
): AcceptanceDiagnostic | undefined {
	if (typeof data !== "object" || data === null) return undefined;
	const d = data as { reason?: unknown; record?: unknown; detail?: unknown };
	if (boundary === "steer-unknown") {
		const reason = (STEER_UNKNOWN_REASONS as readonly unknown[]).includes(d.reason)
			? (d.reason as SteerUnknownReason)
			: "unrecognized";
		const detail = boundDetail(d.detail);
		return detail === undefined ? { reason } : { reason, detail };
	}
	if (boundary === "steer-in-turn") {
		if (d.record === "ok") return undefined;
		if (d.record === "skipped-binding-changed") return { record: "skipped-binding-changed" };
		if (typeof d.record === "string" && d.record.startsWith("failed:")) {
			const detail = boundDetail(d.record.slice("failed:".length));
			return detail === undefined ? { record: "failed" } : { record: "failed", detail };
		}
		return { record: "unrecognized" };
	}
	return undefined;
}

/** The caller-facing annotation for a diagnostic, e.g. ` (backend acceptance unknown: timeout …)`. */
export function renderAcceptanceDiagnostic(diagnostic: AcceptanceDiagnostic | undefined): string {
	if (diagnostic === undefined) return "";
	const detail = diagnostic.detail === undefined ? "" : ` — ${diagnostic.detail}`;
	if (diagnostic.reason !== undefined) {
		return ` (backend acceptance unknown: ${diagnostic.reason}${detail}; it may have been injected — do not resend blindly)`;
	}
	if (diagnostic.record === "skipped-binding-changed") return " (record skipped: the receiver's binding changed)";
	if (diagnostic.record === "failed") return ` (record failed${detail})`;
	if (diagnostic.record === "unrecognized") return " (record status unrecognized)";
	return "";
}
