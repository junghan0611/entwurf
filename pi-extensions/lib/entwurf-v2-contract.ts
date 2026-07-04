/**
 * entwurf-v2-contract — the FROZEN contract surface for the unified `entwurf_v2`
 * verb (0.11 Stage 0 step 4-pre / 동결결정 10). PURE pi-FREE core: the
 * intent×liveness decision table + the reject taxonomy + a pure resolver.
 * NO runtime dispatch, NO spawn/send, NO I/O — step 5 wires this to transports.
 * The pi-ai TypeBox REPRESENTATION of this contract lives in the separate
 * `entwurf-v2-contract-schema.ts` (0.12.1 B-1) so this module — which the
 * harness-neutral MCP bridge reaches at boot — carries no pi dependency.
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
// Backends whose SOCKET liveness predicate is DEFINED — the pi control-socket
// domain ONLY (connect + RPC `get_info`, entwurf-control.ts). It stays ["pi"].
// claude-code (self-fetch, no socket) has no liveness predicate at all → `unsupported`.
// codex/antigravity are direct-inject; antigravity's liveness IS measured, but by the
// SEPARATE native-push adapter rail (a live app-server conversation probe), NOT this
// pi-socket domain — so it must NEVER be added here. Adding it would pull agy into the
// pi socket table (inspectSocket/probeSocket are socket-only); the fact layer keeps
// reporting agy `unsupported` = "outside the pi-socket liveness domain", NOT
// unreachable (the native-push rail measures it — entwurf-v2-decider.ts). Widening
// THIS set is a deliberate future decision (Stage 1+), gated by a REAL pi-shaped
// control-socket predicate — never by silently mapping sessions to dead/indeterminate
// (R1 핵심). check-entwurf-facts pins this == ["pi"] and asserts the native-push
// domain is disjoint from it.
export const LIVENESS_DOMAIN_BACKENDS = ["pi"] as const;
export type LivenessDomainBackend = (typeof LIVENESS_DOMAIN_BACKENDS)[number];

export function isLivenessSupported(backend: string): boolean {
	return (LIVENESS_DOMAIN_BACKENDS as readonly string[]).includes(backend);
}

// ── Native-push backend domain (봉인 2/4) ───────────────────────────────────
// A backend whose liveness is measured by the SEPARATE native-push adapter rail (a
// live app-server conversation probe — antigravity's LS gRPC), NOT the pi control
// socket. This domain is DISJOINT from LIVENESS_DOMAIN_BACKENDS (pi socket): an agy
// session is `unsupported` at the pi-socket FACT level (entwurf_peers) yet fully
// measured + deliverable on the native-push axis. The two are separate rails on
// purpose — check-entwurf-facts pins both sets and asserts their intersection is ∅
// (a backend can never be in both a socket-liveness domain and a native-push domain).
export const NATIVE_PUSH_BACKENDS = ["antigravity"] as const;
export type NativePushBackend = (typeof NATIVE_PUSH_BACKENDS)[number];

export function nativePushSupported(backend: string): boolean {
	return (NATIVE_PUSH_BACKENDS as readonly string[]).includes(backend);
}

// NativePushLiveness = the 3-value liveness the native-push adapter probe yields.
// The SAME three values as SocketLiveness, reused so there is ONE 3-value liveness
// vocabulary — but these are NOT socket-bound (봉인 2: "주석만 socket-전용 오독 정정"):
// the value is a live-app-server-conversation probe result (agentapi
// get-conversation-metadata answered = alive; no live port served the conv = dead;
// probe error/ambiguity = indeterminate). All three are valid FactLiveness values, so
// a native-push receipt stamps observedLiveness ∈ {alive, dead, indeterminate}.
export type NativePushLiveness = SocketLiveness;

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
	"native-push-target-dead", // 봉인 1: fire-and-forget to a native-push (agy) target whose adapter probe found NO live conversation. Post-probe; observedLiveness = dead. NOT `backend-liveness-unsupported` — a native-push backend IS measured, so that name would be a lie.
	"native-push-probe-indeterminate", // 봉인 1: fire-and-forget to a native-push target whose adapter probe was inconclusive (agy alive but no port served the conv, or a probe error). Post-probe; observedLiveness = indeterminate. Never spawns, never coerced to dead.
	"native-push-no-resume-authority", // 봉인 1: owned-outcome to a native-push target (any liveness — single, state-independent). A native-push backend has no resume/spawn authority (there is no pi-child to own), so the caller cannot own its completion; use fire-and-forget. Post-probe; observedLiveness = the measured value.
	"bad-target", // R2: absent/typo garden-id (no existing citizen); spawn-new out of v2 scope
	"untrusted-fail-fast", // 동결결정 5: controlled launch into an untrusted cwd
	"socket-only-no-resume-authority", // A1: a record-less socket-only endpoint resolved to a resume verdict (owned-outcome × dormant), but spawn-bg cannot open into it — no trusted cwd/resume authority. Post-probe guard reject (NOT pre-probe, NOT a table resolver cell): the in-domain probe ran and measured the liveness, then `allowResume:false` refused the resume. Carries the honest measured FactLiveness (non-null), unlike the pre-probe `bad-target` it replaces here — a live/addressable socket-only citizen must NEVER be mislabeled absent.
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
 *
 * NOTE this predicate FREEZES the 1B ordering into the contract: classifying
 * `untrusted-fail-fast` as post-probe (non-null required) encodes "preflight runs
 * AFTER the probe". Moving preflight back ahead of the probe would make its
 * observedLiveness un-measured (null) and reopen this predicate + the enum split.
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
// RESOLVER_ not TABLE_. The remaining taxonomy members are produced by stages
// OTHER than the resolver: `bad-target` (target resolution) and `target-locked`
// (lockfile) run BEFORE the resolver, while `untrusted-fail-fast` is decided
// AFTER it — preflight runs only behind a resume verdict (1B), so it is a LATER
// stage, not an earlier one. All three are pre-claimed in the enum so bucket B
// does not reopen it.
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
// `native-push` (봉인 1) = direct injection into a LIVE native app-server conversation
// (antigravity `agentapi send-message`). Like meta-mailbox it is a fire-and-forget
// send arm (ack-only), but it requires a live-probe (NATIVE_PUSH_DISPATCH_TABLE),
// where meta-mailbox is liveness-free. It is NOT a mailbox enqueue and NOT a pi socket
// send — it is its own rail.
export const ENTWURF_V2_TRANSPORTS = [
	"control-socket",
	"spawn-bg",
	"tmux-live",
	"meta-mailbox",
	"native-push",
] as const;
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
	| { action: "send"; transport: "control-socket" | "meta-mailbox" | "native-push"; ownership: "ack-only" }
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
// SEPARATE from the in-domain 6-cell DISPATCH_TABLE (Fable (i)): a backend with no
// pi-socket liveness predicate never enters the liveness-keyed table. Instead the
// domain guard routes it here, keyed on intent alone. Reaches here: claude-code
// (self-fetch mailbox) and codex (no adapter yet). Does NOT reach here: antigravity —
// the decider intercepts a native-push backend in its own rail BEFORE this mailbox
// mini-table (entwurf-v2-decider.ts), so agy is `unsupported` at the fact level yet
// never falls through to a mailbox it does not have. The cells, keyed on intent alone:
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

// The reject branch on its own — `makeRejectReceipt` returns exactly this (NOT the
// widened `EntwurfV2Receipt`), so a consumer that mints a reject keeps the precise
// type without a cast (the 5b decider's `DispatchDecision` reject branch carries it
// directly). A type-only precision alias over the union above; discriminant unchanged.
export type EntwurfV2RejectReceipt = Extract<EntwurfV2Receipt, { ok: false }>;

/**
 * The ONLY sanctioned way to mint a reject receipt (？6 enforcement). A pure
 * predicate (`rejectObservedLivenessWellFormed`) cannot force a caller to consult
 * it — 5b could hand-assemble `{ok:false, reason:"bad-target",
 * observedLiveness:"indeterminate"}`, which the blanket `FactLiveness | null`
 * schema accepts. This constructor THROWS on a well-formedness violation, so
 * every reject path (resolveDispatch's own mints below + the 5b stages that
 * produce bad-target / target-locked / target-address-conflict / untrusted-
 * fail-fast) routes through one chokepoint and the bypass surface is zero. 5b
 * MUST build rejects with this, never by object literal.
 */
export function makeRejectReceipt(
	reason: EntwurfV2RejectReason,
	observedLiveness: FactLiveness | null,
): EntwurfV2RejectReceipt {
	if (!rejectObservedLivenessWellFormed(reason, observedLiveness)) {
		throw new Error(
			`entwurf_v2: ill-formed reject receipt — reason '${reason}' requires ${
				isPreProbeReject(reason) ? "observedLiveness=null (pre-probe)" : "a non-null observedLiveness (post-probe)"
			}, got ${JSON.stringify(observedLiveness)}.`,
		);
	}
	return { ok: false, reason, observedLiveness };
}

/**
 * PURE dispatch decision over already-resolved facts. Before reaching here the
 * caller has resolved the target (→ `bad-target` if no existing citizen) and, for
 * an in-domain backend, acquired the per-gid lock (→ `target-locked`) and probed
 * liveness UNDER that lock. This function only decides the liveness-routed
 * verdict. preflight (→ `untrusted-fail-fast`) is NOT a precondition here: per 1B
 * it runs only AFTER this resolver returns a resume verdict (the sole branch that
 * launches a child into a target cwd), so a send/mailbox verdict never touches it.
 * Do NOT reintroduce a global pre-resolver preflight — that re-breaks F-mailbox.
 *
 * Two facts in: `liveness` (the 4-value FactLiveness) and `mailboxDeliverable`
 * (F-mailbox — a SEPARATE axis from liveness, NOT a column of either table, NOT
 * an entwurf_peers row field; step 5's target/capability/presence layer supplies it
 * via the required mailboxDeliverabilityFor seam — wake-mode capability AND a live
 * active-receiver (SE-2 2d-3) — and unknown deliverability MUST be passed as false =
 * fail-closed). The deliverable
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
			return makeRejectReceipt(mboxCell.reason, liveness);
		}
		// fire-and-forget allow cell, gated by the separate deliverability fact.
		if (!mailboxDeliverable) {
			return makeRejectReceipt("mailbox-undeliverable", liveness);
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
		return makeRejectReceipt(cell.reason, liveness);
	}
	return {
		ok: true,
		action: cell.action,
		transport: cell.transport,
		ownership: cell.ownership,
		observedLiveness: liveness,
	};
}

// ── The native-push dispatch table (봉인 1/2/4) ─────────────────────────────
// A THIRD table, distinct from both the pi 6-cell DISPATCH_TABLE and the unsupported
// mailbox mini-table. Keyed intent × NativePushLiveness (NOT intent-only): a
// native-push backend (antigravity) IS measured by its adapter probe, so the
// send/reject decision depends on the probed liveness. The decider intercepts a
// native-push backend in its own rail (nativePushSupported → probe → this table)
// BEFORE the unsupported branch, so agy never falls through to a mailbox it lacks.
//
//   fire-and-forget × alive         → native-push send (the ONE allow cell)
//   fire-and-forget × dead          → reject native-push-target-dead
//   fire-and-forget × indeterminate → reject native-push-probe-indeterminate
//   owned-outcome  × *              → reject native-push-no-resume-authority (state-
//                                     independent: no pi-child to own; `backend-
//                                     liveness-unsupported` is NOT reused — false name).
export const NATIVE_PUSH_DISPATCH_TABLE: Record<EntwurfIntent, Record<NativePushLiveness, DispatchVerdict>> = {
	"fire-and-forget": {
		alive: { action: "send", transport: "native-push", ownership: "ack-only" },
		dead: { action: "reject", reason: "native-push-target-dead" },
		indeterminate: { action: "reject", reason: "native-push-probe-indeterminate" },
	},
	"owned-outcome": {
		alive: { action: "reject", reason: "native-push-no-resume-authority" },
		dead: { action: "reject", reason: "native-push-no-resume-authority" },
		indeterminate: { action: "reject", reason: "native-push-no-resume-authority" },
	},
};

// The reasons the native-push resolver emits — a THIRD post-probe reject set, parallel
// to RESOLVER_REJECT_REASONS (pi/mailbox). All post-probe: resolveNativePushDispatch
// always has a real probed liveness in hand, so observedLiveness is non-null. None may
// be pre-probe (they are never in PRE_PROBE_REJECT_REASONS).
export const NATIVE_PUSH_REJECT_REASONS = [
	"native-push-target-dead",
	"native-push-probe-indeterminate",
	"native-push-no-resume-authority",
] as const satisfies readonly EntwurfV2RejectReason[];

/**
 * PURE native-push dispatch decision (봉인 4). Given the caller intent and the adapter
 * probe's 3-value liveness, mint the receipt from NATIVE_PUSH_DISPATCH_TABLE. Mirrors
 * resolveDispatch's shape; observedLiveness is ALWAYS the probed value (non-null,
 * post-probe). The decider calls this only AFTER nativePushSupported(backend) gates the
 * backend and the adapter probe returns a liveness — it never touches the pi socket
 * table or the mailbox mini-table (those are other domains). No IO here (the probe is
 * the decider's injected dep); this only maps (intent, liveness) → verdict.
 */
export function resolveNativePushDispatch(intent: EntwurfIntent, liveness: NativePushLiveness): EntwurfV2Receipt {
	const cell = NATIVE_PUSH_DISPATCH_TABLE[intent][liveness];
	if (cell.action === "reject") {
		return makeRejectReceipt(cell.reason, liveness);
	}
	return {
		ok: true,
		action: cell.action,
		transport: cell.transport,
		ownership: cell.ownership,
		observedLiveness: liveness,
	};
}

// ── TypeBox schemas ────────────────────────────────────────────────────────
// MOVED to `entwurf-v2-contract-schema.ts` (0.12.1 B-1): the pi-ai TypeBox
// builders (StringEnum/Type) are a pi-lane dependency, so they cannot live in
// this pi-free core — the MCP bridge reaches this module at boot and must stay
// harness-neutral (check-entwurf-bridge-pi-free). The schemas import the
// constants/types above; pi-side consumers import the schemas from there.
