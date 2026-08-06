/**
 * entwurf-v2-contract — the FROZEN contract surface for the unified `entwurf_v2`
 * verb (0.11 Stage 0 step 4-pre / 동결결정 10). PURE pi-FREE core: the
 * intent×liveness decision table + the reject taxonomy + a pure resolver.
 * NO runtime dispatch, NO spawn/send, NO I/O — step 5 wires this to transports.
 * The pi-ai TypeBox REPRESENTATION of this contract lives in the separate
 * `entwurf-v2-contract-schema.ts` (0.12.1 B-1) so this module — which the
 * harness-neutral MCP bridge reaches at boot — carries no pi dependency.
 *
 * Why a frozen contract BEFORE the fact-provider (step 4): the legacy 3-verb
 * surface (`entwurf`/`entwurf_resume`/`entwurf_send`) was still live when this
 * was written, and building discovery first would have baked verb-routing into
 * the fact layer, taking `entwurf_peers` wrong (동결결정 10 순서 근거). So the
 * SHAPE is locked here; the facts read it; dispatch computes from facts at call
 * time (step 5). Those v1 verbs were REMOVED in the 0.12 cutover — the ordering
 * argument is history, but the layering it produced is the live design.
 *
 * Source-verified invariants folded in (Opus 실측 + GPT 보정 + Fable R1-R5, 2026-06-11):
 *  - F1: caller intent is DECLARED in the input, so the contract a caller
 *    receives is deterministic — never computed from liveness at call time. One
 *    intent remains: `fire-and-forget` (the ack is the end of the contract). The
 *    second intent, `owned-outcome`, is GONE — see the visible-first note below.
 *
 * ── Visible-first subtraction (2026-08-06, GLG) ────────────────────────────
 * `owned-outcome` and the `spawn-bg` transport are removed from this contract, not
 * deprecated. The only resume this verb ever had launched a DETACHED, window-less
 * `pi` child; under the visible-first operating rule a citizen the operator cannot
 * see must not be started at all, and a reachable hidden path is worse than a
 * temporary absence of the capability. So the subtraction is a hard cut: the intent
 * leaves the enum, the transport leaves the table, and an old caller fails schema
 * validation rather than meeting a polite reject string.
 *
 * What this leaves behind, deliberately: a DORMANT in-domain citizen is currently
 * unreachable (`fire-and-forget` × dormant has always rejected). Visible same-id
 * resume is a SEPARATE lifecycle capability — a distinct verb over the mux launch
 * lane, not an intent on this delivery verb — and it is not implemented here. The
 * leaves it will need (record-authoritative launch identity, the resume argv
 * builder, the per-target lock, socket inspection) are preserved and still shipped.
 *
 * READ THE SCOPE EXACTLY. Background execution is not judged impossible and is not forbidden
 * forever. It is retired NOW so that no hidden bypass exists while visible-first governance is
 * being established. A future background lifecycle may be added back as an explicitly
 * authorized, FIRST-CLASS capability with its own verb and its own receipts. What it must never
 * be again is what it was here: an automatic fallback, or a hidden branch inside visible resume
 * or `entwurf_v2`. The shape is what was removed, not the idea of a detached process.
 *  - R1: liveness is defined PER CAPABILITY DOMAIN. The control-socket domain
 *    currently contains backend `pi`; claude-code is self-fetch with no socket,
 *    so its socket liveness is `unsupported`, NOT folded into dead/indeterminate.
 *    This is transport capability, not identity rank: every target is first a
 *    record citizen. `unsupported` is a 4th FACT value, not a 4th table column.
 *  - R2: `target` is the garden-id of an EXISTING citizen. spawn-new is out of
 *    v2 scope — fresh creation now has the separate `entwurf_fresh_call` surface,
 *    never a fallback inside this resolver. Absent/typo gid = `bad-target` (so F6
 *    "오타 gid가 신규 spawn 사고 막기" holds automatically).
 *  - N1/F3: an `indeterminate` target is never launched into. N2: `fire-and-forget`
 *    to a `dormant` target is "reject for now" (mailbox-wake lacks a reply-correlation
 *    id in the substrate; an additive extension later, not a permanent no).
 *  - Q2: every cell is a SINGLE verdict — no "default", no escape hatch (a
 *    "default reject" would re-admit the call-time nondeterminism F1 closes).
 *  - F-mailbox: a `fire-and-forget` to an `unsupported` citizen (claude-code etc.)
 *    is NOT a reject — the 0.10.0 meta-bridge mailbox delivers without liveness.
 *    `unsupported` is the "no liveness predicate" fact, not a delivery verdict; so
 *    ff+unsupported routes to the `meta-mailbox` transport, gated by a SEPARATE
 *    `mailboxDeliverable` fact (NOT a column of the 3-cell table — Fable (i)).
 *
 * The decision table here is a constant; `check-entwurf-v2-contract` asserts it
 * exhaustively + proves the "table cell ↔ receipt" round-trip. THAT round-trip
 * is the machine proof of F6 "결정표가 코드로 강제됨" — the executable contract,
 * not prose.
 */

import type { SocketLiveness } from "./socket-probe.ts";

// ── Caller-declared intent (F1) ────────────────────────────────────────────
// The outcome contract is an INPUT, not an inference. `fire-and-forget` = the
// RPC ack is the end of the contract (entwurf-control.ts:29-37).
//
// This enum has ONE member on purpose. It kept a second — `owned-outcome`, whose
// only allow cell launched a hidden detached child — until the visible-first cut
// (header). A one-member enum is not a smell here: the axis is real (a caller
// still declares its outcome contract), and the value that is gone is gone from
// the wire, so an old caller is refused by schema validation instead of being
// quietly re-routed.
export const ENTWURF_INTENTS = ["fire-and-forget"] as const;
export type EntwurfIntent = (typeof ENTWURF_INTENTS)[number];

// ── Liveness axes ──────────────────────────────────────────────────────────
// FactLiveness (R1/R3b) = what `entwurf_peers` exposes: the 3 socket-probe
// values PLUS `unsupported` (predicate undefined for this backend). Four values.
export const FACT_LIVENESSES = ["alive", "dead", "indeterminate", "unsupported"] as const;
export type FactLiveness = SocketLiveness | "unsupported";

// DispatchLiveness = the in-domain routing axis the table is keyed on. The
// socket result maps: alive→live (send), dead→dormant (unreachable since the
// visible-first cut), indeterminate→indeterminate (never dispatched into).
// `unsupported` is NOT here — it is handled by the domain guard before the table
// is consulted. The axis keeps all three values because they are FACTS about a
// target; only the verdicts behind two of them changed.
export const DISPATCH_LIVENESSES = ["live", "dormant", "indeterminate"] as const;
export type DispatchLiveness = (typeof DISPATCH_LIVENESSES)[number];

// ── Backend liveness domain (R1 + F4) ──────────────────────────────────────
// Backends whose SOCKET liveness predicate is DEFINED. The control-socket
// capability domain currently contains `pi` (connect + RPC `get_info`).
// claude-code (self-fetch, no socket) has no liveness predicate at all → `unsupported`.
// codex/antigravity are direct-inject; antigravity's liveness IS measured, but by the
// SEPARATE native-push adapter rail (a live app-server conversation probe), NOT this
// pi-socket domain — so it must NEVER be added here. Adding it would pull agy into the
// control-socket table (inspectSocket/probeSocket are socket-only); the fact layer keeps
// reporting agy `unsupported` = "outside the control-socket liveness domain", NOT
// unreachable (the native-push rail measures it — entwurf-v2-decider.ts). Widening
// THIS set is a deliberate future decision, gated by a real compatible
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
// live app-server conversation probe — antigravity's LS gRPC), NOT a control
// socket. This domain is DISJOINT from LIVENESS_DOMAIN_BACKENDS: an agy session
// is `unsupported` on the socket FACT axis (entwurf_peers) yet fully
// measured + deliverable on the native-push axis. The two are separate rails on
// purpose — check-entwurf-facts pins both sets and asserts their intersection is ∅
// (a backend can never be in both domains).
export const NATIVE_PUSH_BACKENDS = ["antigravity"] as const;
export type NativePushBackend = (typeof NATIVE_PUSH_BACKENDS)[number];

export function nativePushSupported(backend: string): backend is NativePushBackend {
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
	// The name is inherited vocabulary and stays a frozen wire string: with the spawn
	// transport gone there is nothing left to spawn, but the RULE it names is intact —
	// an in-domain target whose probe was inconclusive is never dispatched into. Renaming
	// a public reject string is its own contract cut, not a side effect of this one.
	"indeterminate-no-spawn", // N1/F3: never dispatch into an indeterminate target
	"dormant-fire-forget-unsupported", // N2: fire-and-forget to a dormant target — reject for now
	"mailbox-undeliverable", // F-mailbox: fire-and-forget to an unsupported citizen whose mailbox is not deliverable (fail-closed; future pi-backend non-drainable mailbox)
	"native-push-target-dead", // 봉인 1: fire-and-forget to a native-push (agy) target whose adapter probe found NO live conversation. Post-probe; observedLiveness = dead.
	"native-push-probe-indeterminate", // 봉인 1: fire-and-forget to a native-push target whose adapter probe was inconclusive (agy alive but no port served the conv, or a probe error). Post-probe; observedLiveness = indeterminate. Never coerced to dead.
	"bad-target", // R2: absent/typo garden-id (no existing citizen); fresh creation out of v2 scope
	"record-less-socket", // #50 C4: a gid-shaped non-symlink control socket exists but NO meta-record claims it. The record is the sole address authority (목표 ②), so a bare socket is not an addressable citizen — it is a diagnostic state, refused for EVERY intent before any lock/probe (pre-probe, observedLiveness=null). NOT `bad-target`: something real answers to this gid, and mislabeling it absent would hide the very state the reject exists to surface.
	"target-locked", // R5 pre-claim for bucket B F2 per-gid lockfile conflict
	"target-address-conflict", // F3: a quarantined citizen (garden-id-socket-conflict / symlinked socket) — the gid resolves to two different receivers (record vs socket), so dispatch refuses to pick. The ONLY in-band honest channel for a dispatch-level identity-split (the listing diagnostic channel is not visible to a v2 caller, who only gets a receipt). Pre-resolver, like bad-target/target-locked — NOT a RESOLVER_REJECT_REASONS member.
] as const;
export type EntwurfV2RejectReason = (typeof ENTWURF_V2_REJECT_REASONS)[number];

// ── Pre-probe reject reasons (？6 — observedLiveness = null) ────────────────
// These four rejects are decided BEFORE any liveness probe runs, so there is no
// honest 4-value FactLiveness to stamp: `bad-target` (no citizen/backend),
// `target-locked` (5a lock conflict, before lstat/connect), `target-address-conflict`
// (address-subject conflict → probing is forbidden), `record-less-socket` (#50 C4:
// no record ⇒ not a citizen ⇒ no in-domain probe ever runs — the presence hint is
// a single lstat, not a liveness measurement). `indeterminate` means an
// in-domain probe was inconclusive (≠ "not looked yet"); `unsupported` means the
// backend has no predicate (≠ "pre-probe"). So a pre-probe reject's
// observedLiveness is `null`, NOT one of the four values. Every OTHER reject —
// the RESOLVER_REJECT_REASONS (3, post-probe) and the native-push set (2, also
// post-probe) — carries a non-null FactLiveness, as does every success. (The
// visible-first cut removed the one post-probe reject that was NOT a resolver
// member: `untrusted-fail-fast`, which only ever fired behind a resume verdict.)
// This null/non-null split is REASON-DEPENDENT, so the receipt
// schema (which allows null on every reject branch) cannot enforce it alone — the
// semantic fixture in `check-entwurf-v2-contract` does, via `isPreProbeReject` /
// `rejectObservedLivenessWellFormed` below (the SSOT 5b mints against).
export const PRE_PROBE_REJECT_REASONS = [
	"bad-target",
	"target-locked",
	"target-address-conflict",
	"record-less-socket",
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
 * (pre-probe with a stamped value) and `{ok:false, reason:"dormant-fire-forget-unsupported",
 * observedLiveness:null}` (post-probe with no value) — both reason-dependent, so
 * unreachable by the schema's blanket `FactLiveness | null`.
 */
export function rejectObservedLivenessWellFormed(
	reason: EntwurfV2RejectReason,
	observedLiveness: FactLiveness | null,
): boolean {
	return isPreProbeReject(reason) ? observedLiveness === null : observedLiveness !== null;
}

// Reasons the RESOLVER emits — the in-domain 3-cell table cells PLUS the
// unsupported domain-guard mini-table (mailbox-undeliverable for a fail-closed
// fire-and-forget). NOT just the table (the F-mailbox mini-table emits one of
// these), hence RESOLVER_ not TABLE_. The remaining taxonomy members are produced
// by stages BEFORE the resolver: `bad-target` (target resolution) and
// `target-locked` (lockfile). Both are pre-claimed in the enum so bucket B does
// not reopen it. There is no longer any AFTER-the-resolver reject: the one that
// existed, `untrusted-fail-fast`, fired only behind the removed resume verdict.
export const RESOLVER_REJECT_REASONS = [
	"indeterminate-no-spawn",
	"dormant-fire-forget-unsupported",
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
//
// This list contains DELIVERY outcomes only. A mux may launch a live runtime, but
// its session handle is neither a receipt transport nor address authority. Once
// that runtime becomes a record-backed citizen, delivery still uses one of the
// rails below. `spawn-bg` — the detached, window-less resume child — was removed
// with `owned-outcome` (header): every remaining transport delivers to a citizen
// that is already running, so this verb no longer starts a process at all.
export const ENTWURF_V2_TRANSPORTS = ["control-socket", "meta-mailbox", "native-push"] as const;
export type EntwurfV2Transport = (typeof ENTWURF_V2_TRANSPORTS)[number];

// Allow-branch facets (exported so the schema↔types gate asserts every enum).
// Both are single-valued since the cut: the only `resume`/`owned` verdict was the
// spawn-bg cell. They stay as enums because they are the receipt's own vocabulary
// and a future visible-resume verb would speak them again.
export const ENTWURF_V2_ACTIONS = ["send"] as const;
export const ENTWURF_V2_OWNERSHIPS = ["ack-only"] as const;
// Delivery mode of the message to the target (how it is injected) — steer =
// interrupt the current turn, follow_up = queue after it. A SEPARATE axis from
// both the intent/ownership axis (F1) and the liveness-routing axis. The removed
// v1 `entwurf_send` carried the same steer|follow_up surface, so this axis is
// inherited vocabulary, not a second live delivery verb.
export const ENTWURF_V2_MODES = ["steer", "follow_up"] as const;

export type DispatchVerdict =
	| { action: "send"; transport: "control-socket" | "meta-mailbox" | "native-push"; ownership: "ack-only" }
	| { action: "reject"; reason: EntwurfV2RejectReason };

// ── The FROZEN decision table ──────────────────────────────────────────────
// intent × dispatch-liveness → exactly one verdict (Q2). THREE cells since the
// visible-first cut, of which exactly ONE allows: fire-and-forget+live = send.
// The other two reject. The reject cells are honest "지금은 없음" locks (N2).
// They were written while the legacy 3-verb surface still covered those flows;
// that surface is GONE, so a reject cell is a real absence with no fallback verb
// behind it — reopening one takes a new contract, never a quiet re-admission.
//
// The `dormant` cell is the one that now carries the whole cost of the cut: an
// in-domain citizen that is not running cannot be reached by ANY intent. That is
// the intended fail-closed state, not an oversight — the resume that used to
// answer here was hidden, and a visible replacement is a separate capability.
export const DISPATCH_TABLE: Record<EntwurfIntent, Record<DispatchLiveness, DispatchVerdict>> = {
	"fire-and-forget": {
		live: { action: "send", transport: "control-socket", ownership: "ack-only" },
		dormant: { action: "reject", reason: "dormant-fire-forget-unsupported" },
		indeterminate: { action: "reject", reason: "indeterminate-no-spawn" },
	},
};

// ── The unsupported-backend mailbox mini-table (F-mailbox) ─────────────────
// SEPARATE from the in-domain 3-cell DISPATCH_TABLE (Fable (i)): a backend with no
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
//
// N2 asymmetry (명문화 — without this the two tables read as contradictory):
//   fire-and-forget+dormant-PI = reject  vs  fire-and-forget+unsupported-CITIZEN = mailbox.
//   The axis is NOT which backend a citizen runs, and this cell grants no backend a
//   privilege. It is one question asked of both: does an ACTIVE RECEIVER actually drain
//   the mailbox this message would land in? A self-fetch citizen reaches this allow cell
//   only through the separate `mailboxDeliverable` fact, which IS that receiver check —
//   when nobody drains, this very cell rejects as `mailbox-undeliverable`. An in-domain
//   `dormant` pi has no drainer at all: its mailbox reader was the running session, and
//   the session is confirmed not running, so an enqueue would be a silent pileup no one
//   ever reads. Same rule, two answers. (It reads as a backend split only if you skip
//   the deliverability fact — which is exactly what makes claude-code look privileged.)
export const UNSUPPORTED_DISPATCH_TABLE: Record<EntwurfIntent, DispatchVerdict> = {
	"fire-and-forget": { action: "send", transport: "meta-mailbox", ownership: "ack-only" },
};

// ── Dispatch receipt (R3) ──────────────────────────────────────────────────
// Carries `observedLiveness` + the transport/action so `check-entwurf-v2-contract`
// can assert a "table cell ↔ receipt" round-trip — the machine proof of F6.
export type EntwurfV2Receipt =
	| {
			ok: true;
			action: "send";
			transport: EntwurfV2Transport;
			ownership: "ack-only";
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
 * produce bad-target / target-locked / target-address-conflict / record-less-socket)
 * routes through one chokepoint and the bypass surface is zero. 5b MUST build
 * rejects with this, never by object literal.
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
 * liveness UNDER that lock. This function only decides the liveness-routed verdict.
 * There is NO trust preflight anywhere on this path: it existed solely to guard the
 * resume verdict that launched a child into a target cwd, and that verdict is gone.
 * Do NOT reintroduce a global pre-resolver preflight — that re-breaks F-mailbox,
 * and this verb no longer launches anything into any cwd.
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
 * UNSUPPORTED_DISPATCH_TABLE (mailbox mini-table), never the 3-cell table.
 * No send, no I/O — step 5 executes the chosen transport.
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
	const cell: DispatchVerdict = DISPATCH_TABLE[intent][dispatchLivenessOf(liveness)];
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
//
// The `owned-outcome` row is gone with the intent (header). It had rejected on every
// liveness with `native-push-no-resume-authority` — a real fact about this rail that
// simply has no caller left to tell, since no caller can declare that intent.
export const NATIVE_PUSH_DISPATCH_TABLE: Record<EntwurfIntent, Record<NativePushLiveness, DispatchVerdict>> = {
	"fire-and-forget": {
		alive: { action: "send", transport: "native-push", ownership: "ack-only" },
		dead: { action: "reject", reason: "native-push-target-dead" },
		indeterminate: { action: "reject", reason: "native-push-probe-indeterminate" },
	},
};

// The reasons the native-push resolver emits — a THIRD post-probe reject set, parallel
// to RESOLVER_REJECT_REASONS (pi/mailbox). All post-probe: resolveNativePushDispatch
// always has a real probed liveness in hand, so observedLiveness is non-null. None may
// be pre-probe (they are never in PRE_PROBE_REJECT_REASONS).
export const NATIVE_PUSH_REJECT_REASONS = [
	"native-push-target-dead",
	"native-push-probe-indeterminate",
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
