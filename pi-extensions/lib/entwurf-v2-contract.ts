/**
 * entwurf-v2-contract — the FROZEN contract surface for the unified `entwurf_v2`
 * verb (0.11 Stage 0 step 4-pre / 동결결정 10). PURE: TypeBox schemas + the
 * intent×liveness decision table + the reject taxonomy + a pure resolver.
 * NO runtime dispatch, NO spawn/send, NO I/O — step 5 wires this to transports.
 *
 * Why a frozen contract BEFORE the fact-provider (step 4): with the legacy
 * 3-verb surface (`entwurf`/`entwurf_resume`/`entwurf_send`) still live, building
 * discovery first bakes verb-routing into the fact layer and `entwurf_peers`
 * goes wrong (동결결정 10 순서 근거). So the SHAPE is locked here; the facts read
 * it; dispatch computes from facts at call time (step 5). The legacy 3-verb
 * surface is untouched — this is purely additive (동결결정 10 scope A).
 *
 * Source-verified invariants folded in (Opus 실측 + GPT 보정 + Fable R1-R5, 2026-06-11):
 *  - F1: caller intent is DECLARED in the input, so the contract a caller
 *    receives is deterministic — never computed from liveness at call time.
 *    `owned-outcome` (caller owns completion) ≠ `fire-and-forget` (ack only).
 *  - R1: the liveness predicate is defined PER-BACKEND. Only pi (direct-inject,
 *    control-socket) has one initially; claude-code is self-fetch with no socket,
 *    so its liveness is `unsupported`, NOT folded into dead/indeterminate — that
 *    fold is the identity-split trap. `unsupported` is a 4th FACT value, not a
 *    4th dispatch column: an out-of-domain backend rejects before the table.
 *  - R2: `target` is the garden-id of an EXISTING citizen. spawn-new is out of
 *    v2 scope (legacy `entwurf` keeps it; additive later). Absent/typo gid =
 *    `bad-target` (so F6 "오타 gid가 신규 spawn 사고 막기" holds automatically).
 *  - N1/F3: an `indeterminate` target never spawns. N2: `fire-and-forget` to a
 *    `dormant` target is "reject for now" (mailbox-wake lacks a reply-correlation
 *    id in the substrate; an additive extension later, not a permanent no).
 *  - Q2: every cell is a SINGLE verdict — no "default", no escape hatch (a
 *    "default reject" would re-admit the call-time nondeterminism F1 closes).
 *  - F-mailbox: a `fire-and-forget` to an `unsupported` citizen (claude-code etc.)
 *    is NOT a reject — the 0.10.0 meta-bridge mailbox delivers without liveness.
 *    `unsupported` is the "no liveness predicate" fact, not a delivery verdict; so
 *    ff+unsupported routes to the `meta-mailbox` transport, gated by a SEPARATE
 *    `mailboxDeliverable` fact (NOT a column of the 6-cell table — Fable (i)).
 *    owned-outcome+unsupported still rejects (self-fetch needs real liveness).
 *
 * The decision table here is a constant; `check-entwurf-v2-contract` asserts it
 * exhaustively + proves the "table cell ↔ receipt" round-trip. THAT round-trip
 * is the machine proof of F6 "결정표가 코드로 강제됨" — the executable contract,
 * not prose.
 */

import { StringEnum, Type } from "@earendil-works/pi-ai";
import { SESSION_ID_RE } from "./session-id.js";
import type { SocketLiveness } from "./socket-probe.ts";

// ── Caller-declared intent (F1) ────────────────────────────────────────────
// The outcome contract is an INPUT, not an inference. `fire-and-forget` = the
// RPC ack is the end of the contract (entwurf-control.ts:29-37). `owned-outcome`
// = the caller owns the dispatched session's completion.
export const ENTWURF_INTENTS = ["fire-and-forget", "owned-outcome"] as const;
export type EntwurfIntent = (typeof ENTWURF_INTENTS)[number];

// ── Liveness axes ──────────────────────────────────────────────────────────
// FactLiveness (R1/R3b) = what `entwurf_peers` exposes: the 3 socket-probe
// values PLUS `unsupported` (predicate undefined for this backend). Four values.
export const FACT_LIVENESSES = ["alive", "dead", "indeterminate", "unsupported"] as const;
export type FactLiveness = SocketLiveness | "unsupported";

// DispatchLiveness = the in-domain routing axis the table is keyed on. The
// socket result maps: alive→live (send), dead→dormant (resume from disk),
// indeterminate→indeterminate (never spawn). `unsupported` is NOT here — it is
// handled by the domain guard before the table is consulted.
export const DISPATCH_LIVENESSES = ["live", "dormant", "indeterminate"] as const;
export type DispatchLiveness = (typeof DISPATCH_LIVENESSES)[number];

// ── Backend liveness domain (R1 + F4) ──────────────────────────────────────
// Backends whose liveness predicate is DEFINED. Initial = pi only (control-socket
// connect + RPC `get_info`, entwurf-control.ts). claude-code (self-fetch, no
// socket) and codex/antigravity (direct-inject without a probe surface yet) are
// OUT of domain → `unsupported`. Widening this set is a deliberate future
// decision (Stage 1+), gated by a REAL liveness predicate for that backend —
// never by silently mapping its sessions to dead/indeterminate (R1 핵심).
export const LIVENESS_DOMAIN_BACKENDS = ["pi"] as const;
export type LivenessDomainBackend = (typeof LIVENESS_DOMAIN_BACKENDS)[number];

export function isLivenessSupported(backend: string): boolean {
	return (LIVENESS_DOMAIN_BACKENDS as readonly string[]).includes(backend);
}

/**
 * Compose the 4-value FACT liveness from a backend and its socket probe.
 * Out-of-domain backend → `unsupported` (NOT dead/indeterminate, R1). An
 * in-domain backend with no probe result yet → `indeterminate` (no proof → the
 * table will refuse to spawn; we never coerce absence of proof into `dead`).
 */
export function factLivenessOf(backend: string, socket: SocketLiveness | null): FactLiveness {
	if (!isLivenessSupported(backend)) return "unsupported";
	return socket ?? "indeterminate";
}

/** Map an in-domain socket-probe result to the table's routing axis. */
export function dispatchLivenessOf(socket: SocketLiveness): DispatchLiveness {
	return socket === "alive" ? "live" : socket === "dead" ? "dormant" : "indeterminate";
}

// ── Reject taxonomy (R5) ───────────────────────────────────────────────────
// SCOPE: these are PRE-DISPATCH reject reasons — decided before any transport is
// attempted. A post-dispatch "send-fail fallback" (transport failed after the
// verdict) is a SEPARATE axis (bucket B) and must NOT be merged into this enum.
export const ENTWURF_V2_REJECT_REASONS = [
	"indeterminate-no-spawn", // N1/F3: never spawn an indeterminate target
	"dormant-fire-forget-unsupported", // N2: fire-and-forget to a dormant target — reject for now
	"owned-live-no-autosend", // Q2/F1: owned-outcome to a live target is not an auto-send
	"backend-liveness-unsupported", // R1: backend has no liveness predicate (e.g. claude-code) — owned-outcome only
	"mailbox-undeliverable", // F-mailbox: fire-and-forget to an unsupported citizen whose mailbox is not deliverable (fail-closed; future pi-backend non-drainable mailbox)
	"bad-target", // R2: absent/typo garden-id (no existing citizen); spawn-new out of v2 scope
	"untrusted-fail-fast", // 동결결정 5: controlled launch into an untrusted cwd
	"target-locked", // R5 pre-claim for bucket B F2 per-gid lockfile conflict
	"target-address-conflict", // F3: a quarantined citizen (garden-id-socket-conflict / symlinked socket) — the gid resolves to two different receivers (record vs socket), so dispatch refuses to pick. The ONLY in-band honest channel for a dispatch-level identity-split (the listing diagnostic channel is not visible to a v2 caller, who only gets a receipt). Pre-resolver, like bad-target/target-locked — NOT a RESOLVER_REJECT_REASONS member.
] as const;
export type EntwurfV2RejectReason = (typeof ENTWURF_V2_REJECT_REASONS)[number];

// ── Pre-probe reject reasons (？6 — observedLiveness = null) ────────────────
// These three rejects are decided BEFORE any liveness probe runs, so there is no
// honest 4-value FactLiveness to stamp: `bad-target` (no citizen/backend),
// `target-locked` (5a lock conflict, before lstat/connect), `target-address-conflict`
// (address-subject conflict → probing is forbidden). `indeterminate` means an
// in-domain probe was inconclusive (≠ "not looked yet"); `unsupported` means the
// backend has no predicate (≠ "pre-probe"). So a pre-probe reject's
// observedLiveness is `null`, NOT one of the four values. Every OTHER reject —
// the RESOLVER_REJECT_REASONS (5, post-probe) plus `untrusted-fail-fast` (1B: it
// now runs AFTER the lock+probe, only on a resume verdict, so its observedLiveness
// is the honest measured `dormant`) — carries a non-null FactLiveness, as does
// every success. This null/non-null split is REASON-DEPENDENT, so the receipt
// schema (which allows null on every reject branch) cannot enforce it alone — the
// semantic fixture in `check-entwurf-v2-contract` does, via `isPreProbeReject` /
// `rejectObservedLivenessWellFormed` below (the SSOT 5b mints against).
export const PRE_PROBE_REJECT_REASONS = [
	"bad-target",
	"target-locked",
	"target-address-conflict",
] as const satisfies readonly EntwurfV2RejectReason[];
export type PreProbeRejectReason = (typeof PRE_PROBE_REJECT_REASONS)[number];

export function isPreProbeReject(reason: EntwurfV2RejectReason): reason is PreProbeRejectReason {
	return (PRE_PROBE_REJECT_REASONS as readonly string[]).includes(reason);
}

/**
 * The ？6 well-formedness rule for a reject receipt's `observedLiveness`, made a
 * pure SSOT predicate so 5b mints against it and the gate proves it: a pre-probe
 * reject MUST carry `null`; every other reject MUST carry a non-null FactLiveness.
 * Catches the illegal `{ok:false, reason:"bad-target", observedLiveness:"indeterminate"}`
 * (pre-probe with a stamped value) and `{ok:false, reason:"owned-live-no-autosend",
 * observedLiveness:null}` (post-probe with no value) — both reason-dependent, so
 * unreachable by the schema's blanket `FactLiveness | null`.
 */
export function rejectObservedLivenessWellFormed(
	reason: EntwurfV2RejectReason,
	observedLiveness: FactLiveness | null,
): boolean {
	return isPreProbeReject(reason) ? observedLiveness === null : observedLiveness !== null;
}

// Reasons the RESOLVER emits — the in-domain 6-cell table cells PLUS the
// unsupported domain-guard mini-table (backend-liveness-unsupported for
// owned-outcome, mailbox-undeliverable for a fail-closed fire-and-forget). NOT
// just the 6-cell table (the F-mailbox mini-table emits two of these), hence
// RESOLVER_ not TABLE_. The remaining taxonomy members (bad-target,
// untrusted-fail-fast, target-locked) are produced by the EARLIER stages (target
// resolution / preflight / lockfile) that run before the resolver — pre-claimed
// in the enum so bucket B does not reopen it.
export const RESOLVER_REJECT_REASONS = [
	"indeterminate-no-spawn",
	"dormant-fire-forget-unsupported",
	"owned-live-no-autosend",
	"backend-liveness-unsupported",
	"mailbox-undeliverable",
] as const satisfies readonly EntwurfV2RejectReason[];

// ── Transport + verdict ────────────────────────────────────────────────────
// `meta-mailbox` (F-mailbox) = liveness-free delivery via the 0.10.0 meta-bridge
// mailbox + doorbell. The ack is "enqueued + doorbell rung", NOT a read and NOT a
// turn injection — so `mode` (steer/follow_up) is meaningless on this transport.
export const ENTWURF_V2_TRANSPORTS = ["control-socket", "spawn-bg", "tmux-live", "meta-mailbox"] as const;
export type EntwurfV2Transport = (typeof ENTWURF_V2_TRANSPORTS)[number];

// Allow-branch facets (exported so the schema↔types gate asserts every enum).
export const ENTWURF_V2_ACTIONS = ["send", "resume"] as const;
export const ENTWURF_V2_OWNERSHIPS = ["ack-only", "owned"] as const;
// Delivery mode of the message to the target (how it is injected) — steer =
// interrupt the current turn, follow_up = queue after it. A SEPARATE axis from
// both the intent/ownership axis (F1) and the liveness-routing axis; the legacy
// entwurf_send carries the same steer|follow_up surface.
export const ENTWURF_V2_MODES = ["steer", "follow_up"] as const;

export type DispatchVerdict =
	| { action: "send"; transport: "control-socket" | "meta-mailbox"; ownership: "ack-only" }
	| { action: "resume"; transport: "spawn-bg" | "tmux-live"; ownership: "owned" }
	| { action: "reject"; reason: EntwurfV2RejectReason };

// ── The FROZEN decision table ──────────────────────────────────────────────
// intent × dispatch-liveness → exactly one verdict (Q2). v2-initial ALLOWS
// exactly two cells (fire-and-forget+live = send; owned-outcome+dormant =
// resume); the other four reject. The reject cells are honest "지금은 없음"
// locks (N2) — the legacy 3-verb surface still covers those flows unchanged.
export const DISPATCH_TABLE: Record<EntwurfIntent, Record<DispatchLiveness, DispatchVerdict>> = {
	"fire-and-forget": {
		live: { action: "send", transport: "control-socket", ownership: "ack-only" },
		dormant: { action: "reject", reason: "dormant-fire-forget-unsupported" },
		indeterminate: { action: "reject", reason: "indeterminate-no-spawn" },
	},
	"owned-outcome": {
		// wants_reply is etiquette, not ownership — owned+live never auto-sends (Q2/F1).
		live: { action: "reject", reason: "owned-live-no-autosend" },
		dormant: { action: "resume", transport: "spawn-bg", ownership: "owned" },
		indeterminate: { action: "reject", reason: "indeterminate-no-spawn" },
	},
};

// ── The unsupported-backend mailbox mini-table (F-mailbox) ─────────────────
// SEPARATE from the in-domain 6-cell DISPATCH_TABLE (Fable (i)): an `unsupported`
// backend (claude-code self-fetch, codex/agy without a probe surface) has NO
// liveness predicate, so it never enters the liveness-keyed table. Instead the
// domain guard routes it here, keyed on intent alone:
//  - fire-and-forget needs no liveness — the 0.10.0 meta-bridge mailbox delivers
//    to any DELIVERABLE citizen. This cell is the deliverable path; resolveDispatch
//    downgrades it to `mailbox-undeliverable` when the separate mailboxDeliverable
//    fact is false (fail-closed). The ack is enqueue+doorbell, NOT read, and
//    observedLiveness stays `unsupported` — the receipt's `meta-mailbox` transport
//    is what says "this went to the mailbox".
//  - owned-outcome has no real liveness to own on a self-fetch backend → reject.
//
// N2 asymmetry (명문화 — without this the two tables read as contradictory):
//   fire-and-forget+dormant-PI = reject  vs  fire-and-forget+unsupported-CITIZEN = mailbox.
//   In-domain `dormant` is a CONFIRMED not-running pi, so enqueuing would be a
//   silent pileup (resume is the honest place). `unsupported` is UNKNOWN liveness
//   on a backend we cannot probe, so a best-effort mailbox doorbell is the most we
//   can honestly offer — there is nothing to resume into.
export const UNSUPPORTED_DISPATCH_TABLE: Record<EntwurfIntent, DispatchVerdict> = {
	"fire-and-forget": { action: "send", transport: "meta-mailbox", ownership: "ack-only" },
	"owned-outcome": { action: "reject", reason: "backend-liveness-unsupported" },
};

// ── Dispatch receipt (R3) ──────────────────────────────────────────────────
// Carries `observedLiveness` + the transport/action so `check-entwurf-v2-contract`
// can assert a "table cell ↔ receipt" round-trip — the machine proof of F6.
export type EntwurfV2Receipt =
	| {
			ok: true;
			action: "send" | "resume";
			transport: EntwurfV2Transport;
			ownership: "ack-only" | "owned";
			observedLiveness: FactLiveness;
	  }
	// observedLiveness is `FactLiveness | null` (？6): null for the pre-probe
	// rejects (PRE_PROBE_REJECT_REASONS — no honest value to stamp before a probe),
	// non-null for every other reject. The split is reason-dependent, enforced by
	// `rejectObservedLivenessWellFormed`, not by this union alone.
	| { ok: false; reason: EntwurfV2RejectReason; observedLiveness: FactLiveness | null };

/**
 * PURE dispatch decision over already-resolved facts. The caller resolves the
 * target (→ `bad-target` if no existing citizen), runs preflight (→
 * `untrusted-fail-fast`), and acquires the per-gid lock (→ `target-locked`)
 * BEFORE reaching here; this function only decides the liveness-routed verdict.
 *
 * Two facts in: `liveness` (the 4-value FactLiveness) and `mailboxDeliverable`
 * (F-mailbox — a SEPARATE axis from liveness, NOT a column of either table, NOT
 * an entwurf_peers row field; step 5's target/capability layer supplies it, and
 * unknown deliverability MUST be passed as false = fail-closed). The deliverable
 * fact is consulted ONLY on the `unsupported` mailbox path; for an in-domain (pi)
 * backend the liveness-routed table is authoritative and the flag is ignored.
 *
 * R1 domain guard runs first: an `unsupported` liveness is routed through the
 * UNSUPPORTED_DISPATCH_TABLE (mailbox mini-table), never the 6-cell table.
 * No spawn, no send, no I/O — step 5 executes the chosen transport.
 */
export function resolveDispatch(
	intent: EntwurfIntent,
	liveness: FactLiveness,
	mailboxDeliverable: boolean,
): EntwurfV2Receipt {
	if (liveness === "unsupported") {
		// R1 domain guard → the mailbox mini-table (intent-keyed), NOT the 6-cell table.
		const mboxCell = UNSUPPORTED_DISPATCH_TABLE[intent];
		if (mboxCell.action === "reject") {
			return { ok: false, reason: mboxCell.reason, observedLiveness: liveness };
		}
		// fire-and-forget allow cell, gated by the separate deliverability fact.
		if (!mailboxDeliverable) {
			return { ok: false, reason: "mailbox-undeliverable", observedLiveness: liveness };
		}
		return {
			ok: true,
			action: mboxCell.action,
			transport: mboxCell.transport,
			ownership: mboxCell.ownership,
			observedLiveness: liveness,
		};
	}
	// liveness is now narrowed to SocketLiveness; deliverability does not apply.
	const cell = DISPATCH_TABLE[intent][dispatchLivenessOf(liveness)];
	if (cell.action === "reject") {
		return { ok: false, reason: cell.reason, observedLiveness: liveness };
	}
	return {
		ok: true,
		action: cell.action,
		transport: cell.transport,
		ownership: cell.ownership,
		observedLiveness: liveness,
	};
}

// ── TypeBox schemas (for step 5 MCP tool params + the gate's structural assert) ──
// StringEnum (typebox 1.x) inside Type.Object (typebox 0.34) — same mix the
// existing entwurf tools use (entwurf-control.ts:92-95). The logic types above
// are hand-written unions, NOT `Static<>` inferences, so the 0.34/1.x widening
// caveat does not touch them; the gate keeps schema ↔ types in lockstep.
export const EntwurfV2InputSchema = Type.Object(
	{
		// R2/F6 executable: the garden-id shape is enforced by pattern, not prose —
		// a malformed/typo gid fails the schema (→ bad-target) and can never reach a
		// spawn. SSOT regex = SESSION_ID_RE (pi-extensions/lib/session-id.js).
		target: Type.String({
			pattern: SESSION_ID_RE.source,
			description:
				"garden-id of an EXISTING citizen (pattern-enforced). spawn-new is out of v2 scope (legacy entwurf keeps it); a malformed/typo gid is bad-target.",
		}),
		intent: StringEnum(ENTWURF_INTENTS, {
			description:
				"caller's declared outcome contract (F1): fire-and-forget = ack only, owned-outcome = caller owns completion.",
		}),
		mode: Type.Optional(
			StringEnum(ENTWURF_V2_MODES, {
				description:
					"delivery mode (steer = interrupt current turn, follow_up = queue) — NOT the ownership axis (F1) nor liveness routing. MEANINGLESS on the meta-mailbox transport (F-mailbox): a mailbox ack is enqueue+doorbell, not a turn injection, so steer/follow_up does not apply when the verdict transport is meta-mailbox.",
			}),
		),
		wantsReply: Type.Optional(
			Type.Boolean({
				description: "conversation etiquette only — NOT ownership; never triggers an auto-send (Q2).",
			}),
		),
		// `additionalProperties: false` — a frozen contract input is exact; an unknown
		// key is a caller error, not silently ignored.
	},
	{ additionalProperties: false },
);

// Receipt = a DISCRIMINATED union on `ok` (R3/F6) — NOT one flat object with
// optionals. Each branch is EXACT (`additionalProperties: false`): without it,
// JSON Schema's default admits extra keys, so an illegal receipt like
// {ok:true, ..., reason:"bad-target"} would validate against the success branch.
// With it, success carries action/transport/ownership and rejects a stray reason;
// reject carries reason and rejects any allow facet — the branches are mutually
// exclusive at the schema level, not merely by declared-property convention.
export const EntwurfV2ReceiptSuccessSchema = Type.Object(
	{
		ok: Type.Literal(true),
		action: StringEnum(ENTWURF_V2_ACTIONS),
		transport: StringEnum(ENTWURF_V2_TRANSPORTS),
		ownership: StringEnum(ENTWURF_V2_OWNERSHIPS),
		observedLiveness: StringEnum(FACT_LIVENESSES, {
			description: "the 4-value fact liveness the verdict was computed from (R1/R3).",
		}),
	},
	{ additionalProperties: false },
);

export const EntwurfV2ReceiptRejectSchema = Type.Object(
	{
		ok: Type.Literal(false),
		reason: StringEnum(ENTWURF_V2_REJECT_REASONS),
		// ？6: required-nullable, NOT optional — a reject branch ALWAYS carries the
		// key, and it is `null` for the pre-probe rejects (PRE_PROBE_REJECT_REASONS)
		// and a real FactLiveness otherwise. Optional would lose the "key always
		// present, value may be null" shape and weaken the discriminated union; the
		// reason-dependent null/non-null rule is enforced semantically (the gate's
		// rejectObservedLivenessWellFormed fixture), not by this blanket union.
		observedLiveness: Type.Union([StringEnum(FACT_LIVENESSES), Type.Null()], {
			description:
				"the 4-value fact liveness the reject was computed from (R1/R3); null for the pre-probe rejects (bad-target / target-locked / target-address-conflict) where no probe ran.",
		}),
	},
	{ additionalProperties: false },
);

export const EntwurfV2ReceiptSchema = Type.Union([EntwurfV2ReceiptSuccessSchema, EntwurfV2ReceiptRejectSchema]);
