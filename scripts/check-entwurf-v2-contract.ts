/**
 * check-entwurf-v2-contract — deterministic gate for 0.11 Stage 0 step 4-pre:
 * the FROZEN entwurf_v2 contract (동결결정 10 + 버킷 B F1/F4/F6 + Fable R1-R5).
 *
 * This gate IS the executable proof F6 demands ("산문 금지"): the intent×liveness
 * decision table is a constant, and the "table cell ↔ dispatch receipt"
 * round-trip is asserted exhaustively — so the contract is enforced by code, not
 * by prose. Pure; no backend, no socket, no API.
 *
 * Proves:
 *   - R1 domain guard: only pi is in the liveness domain; claude-code / codex /
 *     antigravity are `unsupported` — NEVER folded into dead/indeterminate.
 *   - the 6-cell table is exhaustive and every cell is a SINGLE verdict (Q2):
 *     exactly two allow cells (ff+live=send, owned+dormant=resume), four reject.
 *   - N1/F3: an indeterminate target never spawns (both intents reject it).
 *   - Q2/F1: owned-outcome + live = reject (owned-live-no-autosend), not auto-send.
 *   - F-mailbox: an `unsupported` citizen routes through a SEPARATE intent-keyed
 *     mailbox mini-table (NOT the 6-cell table): ff+deliverable → meta-mailbox/
 *     ack-only, ff+undeliverable → mailbox-undeliverable (fail-closed),
 *     owned → backend-liveness-unsupported. Deliverability is a 2nd fact ignored
 *     in-domain (pi). The N2 asymmetry (dormant-pi reject vs unsupported mailbox)
 *     is pinned side-by-side.
 *   - R3: resolveDispatch round-trip — receipt.observedLiveness === input AND
 *     action/transport/ownership/reason === the table cell, every (intent × liveness).
 *   - R5: taxonomy covers the table reasons + pre-claims bad-target /
 *     untrusted-fail-fast / target-locked (so bucket B F2 won't reopen it), and
 *     is PRE-DISPATCH only (no send-fail-fallback member).
 *   - schema ↔ types drift guard: the TypeBox input/receipt property keysets and
 *     the StringEnum members match the hand-written contract constants.
 */

import assert from "node:assert/strict";
import {
	DISPATCH_LIVENESSES,
	DISPATCH_TABLE,
	type DispatchLiveness,
	dispatchLivenessOf,
	ENTWURF_INTENTS,
	ENTWURF_V2_ACTIONS,
	ENTWURF_V2_MODES,
	ENTWURF_V2_OWNERSHIPS,
	ENTWURF_V2_REJECT_REASONS,
	ENTWURF_V2_TRANSPORTS,
	EntwurfV2InputSchema,
	EntwurfV2ReceiptRejectSchema,
	EntwurfV2ReceiptSchema,
	EntwurfV2ReceiptSuccessSchema,
	FACT_LIVENESSES,
	type FactLiveness,
	factLivenessOf,
	isLivenessSupported,
	RESOLVER_REJECT_REASONS,
	resolveDispatch,
	UNSUPPORTED_DISPATCH_TABLE,
} from "../pi-extensions/lib/entwurf-v2-contract.ts";
import { SESSION_ID_RE } from "../pi-extensions/lib/session-id.js";
import type { SocketLiveness } from "../pi-extensions/lib/socket-probe.ts";

let passed = 0;
function ok(label: string, cond: boolean): void {
	assert.ok(cond, label);
	console.log(`  ok    ${label}`);
	passed++;
}
function eq(label: string, actual: unknown, expected: unknown): void {
	assert.deepStrictEqual(actual, expected, label);
	console.log(`  ok    ${label}`);
	passed++;
}

// Pull the literal members out of a StringEnum / Optional(StringEnum) schema,
// whichever shape typebox emits — so the schema↔const drift guard is real.
function enumValues(schema: unknown): string[] {
	const s = schema as { enum?: unknown[]; anyOf?: { const?: unknown }[] };
	if (Array.isArray(s?.enum)) return s.enum.map(String);
	if (Array.isArray(s?.anyOf)) return s.anyOf.map((m) => String(m.const));
	return [];
}

const SOCKET_LIVENESSES = ["alive", "dead", "indeterminate"] as const;

// ── R1: backend liveness domain — only pi, others unsupported ──────────────
eq("domain: pi is supported", isLivenessSupported("pi"), true);
eq("domain: claude-code unsupported (self-fetch, no socket)", isLivenessSupported("claude-code"), false);
eq("domain: codex unsupported (no probe surface yet)", isLivenessSupported("codex"), false);
eq("domain: antigravity unsupported", isLivenessSupported("antigravity"), false);

// ── R1: factLivenessOf — out-of-domain → unsupported, never dead/indeterminate ──
eq("fact: pi+alive → alive", factLivenessOf("pi", "alive"), "alive");
eq("fact: pi+dead → dead", factLivenessOf("pi", "dead"), "dead");
eq("fact: pi+indeterminate → indeterminate", factLivenessOf("pi", "indeterminate"), "indeterminate");
eq("fact: pi+no-probe → indeterminate (no proof, never coerced to dead)", factLivenessOf("pi", null), "indeterminate");
eq("fact: claude-code → unsupported (NOT folded into dead, R1)", factLivenessOf("claude-code", "alive"), "unsupported");
eq("fact: codex+no-probe → unsupported (NOT indeterminate)", factLivenessOf("codex", null), "unsupported");

// ── dispatchLivenessOf: socket result → routing axis ───────────────────────
eq("dispatch-liveness: alive → live", dispatchLivenessOf("alive"), "live");
eq("dispatch-liveness: dead → dormant", dispatchLivenessOf("dead"), "dormant");
eq("dispatch-liveness: indeterminate → indeterminate", dispatchLivenessOf("indeterminate"), "indeterminate");

// ── 6-cell table: exhaustive + single verdict per cell (Q2) ────────────────
let allowCells = 0;
let rejectCells = 0;
for (const intent of ENTWURF_INTENTS) {
	for (const dl of DISPATCH_LIVENESSES) {
		const cell = DISPATCH_TABLE[intent]?.[dl as DispatchLiveness];
		ok(`table[${intent}][${dl}] present`, cell != null);
		if (cell.action === "reject") {
			rejectCells++;
			ok(
				`table[${intent}][${dl}] reject = single verdict (reason, no transport)`,
				"reason" in cell && !("transport" in cell),
			);
			ok(
				`table[${intent}][${dl}] reason in taxonomy`,
				(ENTWURF_V2_REJECT_REASONS as readonly string[]).includes(cell.reason),
			);
		} else {
			allowCells++;
			ok(
				`table[${intent}][${dl}] allow = single verdict (transport+ownership, no reason)`,
				"transport" in cell && "ownership" in cell && !("reason" in cell),
			);
		}
	}
}
eq("table has 6 cells (2 intents × 3 liveness)", allowCells + rejectCells, 6);
eq("v2-initial: exactly 2 allow cells", allowCells, 2);
eq("v2-initial: exactly 4 reject cells", rejectCells, 4);

// the two allow cells are exactly the intended ones
eq("allow: fire-and-forget+live = send/control-socket/ack-only", DISPATCH_TABLE["fire-and-forget"].live, {
	action: "send",
	transport: "control-socket",
	ownership: "ack-only",
});
eq("allow: owned-outcome+dormant = resume/spawn-bg/owned", DISPATCH_TABLE["owned-outcome"].dormant, {
	action: "resume",
	transport: "spawn-bg",
	ownership: "owned",
});

// ── N1/F3: indeterminate never spawns (both intents reject) ────────────────
for (const intent of ENTWURF_INTENTS) {
	const cell = DISPATCH_TABLE[intent].indeterminate;
	eq(`N1: ${intent}+indeterminate = reject(indeterminate-no-spawn)`, cell, {
		action: "reject",
		reason: "indeterminate-no-spawn",
	});
}

// ── N2: fire-and-forget+dormant = reject-for-now ───────────────────────────
eq("N2: fire-and-forget+dormant = reject(dormant-fire-forget-unsupported)", DISPATCH_TABLE["fire-and-forget"].dormant, {
	action: "reject",
	reason: "dormant-fire-forget-unsupported",
});

// ── Q2/F1: owned-outcome+live = reject, never auto-send ────────────────────
eq("Q2: owned-outcome+live = reject(owned-live-no-autosend)", DISPATCH_TABLE["owned-outcome"].live, {
	action: "reject",
	reason: "owned-live-no-autosend",
});

// ── R3: resolveDispatch round-trip — table cell ↔ receipt, every cell ──────
// In-domain (pi) liveness is authoritative; the F-mailbox deliverability fact is
// IGNORED here, so the verdict is identical for deliverable true/false.
for (const intent of ENTWURF_INTENTS) {
	for (const sl of SOCKET_LIVENESSES as readonly SocketLiveness[]) {
		const cell = DISPATCH_TABLE[intent][dispatchLivenessOf(sl)];
		for (const deliverable of [true, false]) {
			const receipt = resolveDispatch(intent, sl, deliverable);
			ok(
				`round-trip ${intent}/${sl} (deliverable=${deliverable}): observedLiveness === input`,
				receipt.observedLiveness === sl,
			);
			if (cell.action === "reject") {
				ok(
					`round-trip ${intent}/${sl} (deliverable=${deliverable}): receipt reject matches cell`,
					receipt.ok === false && receipt.reason === cell.reason,
				);
			} else {
				ok(
					`round-trip ${intent}/${sl} (deliverable=${deliverable}): receipt allow matches cell`,
					receipt.ok === true &&
						receipt.action === cell.action &&
						receipt.transport === cell.transport &&
						receipt.ownership === cell.ownership,
				);
			}
		}
	}
}

// ── F-mailbox: unsupported mailbox mini-table — SEPARATE from the 6-cell table ──
// The unsupported domain-guard routes through UNSUPPORTED_DISPATCH_TABLE (intent-
// keyed), NOT the liveness table. Two cells, each a single verdict (Q2).
eq("mini-table: 2 cells (one per intent)", Object.keys(UNSUPPORTED_DISPATCH_TABLE).length, 2);
eq(
	"mini-table[fire-and-forget] = send/meta-mailbox/ack-only (deliverable path)",
	UNSUPPORTED_DISPATCH_TABLE["fire-and-forget"],
	{
		action: "send",
		transport: "meta-mailbox",
		ownership: "ack-only",
	},
);
eq("mini-table[owned-outcome] = reject(backend-liveness-unsupported)", UNSUPPORTED_DISPATCH_TABLE["owned-outcome"], {
	action: "reject",
	reason: "backend-liveness-unsupported",
});

// ── F-mailbox: resolveDispatch over the deliverability axis ────────────────
// fire-and-forget + deliverable → meta-mailbox send (NOT reject); ack-only +
// observedLiveness stays `unsupported` (transport says it went to the mailbox).
eq(
	"F-mailbox: ff+unsupported+deliverable → send/meta-mailbox/ack-only",
	resolveDispatch("fire-and-forget", "unsupported" as FactLiveness, true),
	{
		ok: true,
		action: "send",
		transport: "meta-mailbox",
		ownership: "ack-only",
		observedLiveness: "unsupported",
	},
);
// fail-closed: unknown/undeliverable → mailbox-undeliverable (distinct reason,
// NOT backend-liveness-unsupported — that would be a lie; the backend has no
// liveness predicate but ff does not need one, the mailbox does).
eq(
	"F-mailbox: ff+unsupported+UNdeliverable → reject(mailbox-undeliverable)",
	resolveDispatch("fire-and-forget", "unsupported" as FactLiveness, false),
	{
		ok: false,
		reason: "mailbox-undeliverable",
		observedLiveness: "unsupported",
	},
);
// owned-outcome+unsupported still rejects regardless of deliverability — a
// self-fetch backend has no real liveness for the caller to own (point 3).
for (const deliverable of [true, false]) {
	eq(
		`F-mailbox: owned+unsupported (deliverable=${deliverable}) → reject(backend-liveness-unsupported)`,
		resolveDispatch("owned-outcome", "unsupported" as FactLiveness, deliverable),
		{
			ok: false,
			reason: "backend-liveness-unsupported",
			observedLiveness: "unsupported",
		},
	);
}

// ── N2 asymmetry — the two tables are NOT contradictory ────────────────────
// fire-and-forget+dormant-PI = reject (confirmed not-running → enqueue is silent
// pileup) vs fire-and-forget+unsupported-CITIZEN = mailbox (unknown liveness,
// best-effort doorbell is the honest most). Asserted side-by-side so the gate
// pins the intended asymmetry, not an accident.
ok(
	"N2: ff+dormant-pi rejects but ff+unsupported-deliverable sends to mailbox (intended asymmetry)",
	resolveDispatch("fire-and-forget", "dead" as FactLiveness, true).ok === false &&
		resolveDispatch("fire-and-forget", "unsupported" as FactLiveness, true).ok === true,
);

// ── F-mailbox: transport + taxonomy members present ────────────────────────
ok(
	"transport: meta-mailbox present (F-mailbox liveness-free delivery)",
	(ENTWURF_V2_TRANSPORTS as readonly string[]).includes("meta-mailbox"),
);
// guardrail enforced by code (NEXT.md "6칸표에 mailbox 굽지 말 것"): meta-mailbox
// lives ONLY in the unsupported mini-table, never in an in-domain liveness cell.
for (const intent of ENTWURF_INTENTS) {
	for (const dl of DISPATCH_LIVENESSES) {
		const cell = DISPATCH_TABLE[intent][dl as DispatchLiveness];
		ok(
			`guard: DISPATCH_TABLE[${intent}][${dl}] is NOT meta-mailbox (mailbox stays out of the 6-cell table)`,
			cell.action === "reject" || cell.transport !== "meta-mailbox",
		);
	}
}
ok(
	"taxonomy: mailbox-undeliverable present (F-mailbox fail-closed; pre-claimed for pi-backend future-risk)",
	(ENTWURF_V2_REJECT_REASONS as readonly string[]).includes("mailbox-undeliverable"),
);
ok(
	"taxonomy: mailbox-undeliverable is a resolver reason (in RESOLVER_REJECT_REASONS)",
	(RESOLVER_REJECT_REASONS as readonly string[]).includes("mailbox-undeliverable"),
);

// ── R5: taxonomy coverage + pre-claims + pre-dispatch scope ────────────────
for (const r of RESOLVER_REJECT_REASONS) {
	ok(`taxonomy: resolver reason '${r}' is in the enum`, (ENTWURF_V2_REJECT_REASONS as readonly string[]).includes(r));
}
for (const pre of ["bad-target", "untrusted-fail-fast", "target-locked"]) {
	ok(
		`taxonomy: pre-claim '${pre}' present (R5 — bucket B won't reopen)`,
		(ENTWURF_V2_REJECT_REASONS as readonly string[]).includes(pre),
	);
}
eq("taxonomy: no duplicate reasons", new Set(ENTWURF_V2_REJECT_REASONS).size, ENTWURF_V2_REJECT_REASONS.length);
ok(
	"taxonomy: pre-dispatch only (no send-fail-fallback member)",
	!ENTWURF_V2_REJECT_REASONS.some((r) => /fallback|transport-fail|send-fail/.test(r)),
);

// ── schema ↔ types drift guard (structural; no @sinclair/value) ────────────
function literalConst(schema: unknown): unknown {
	return (schema as { const?: unknown }).const;
}

// input: keys + R2/F6 garden-id pattern (executable, not prose) + every enum.
eq("input schema keys", Object.keys(EntwurfV2InputSchema.properties), ["target", "intent", "mode", "wantsReply"]);
eq(
	"input.target pattern === SESSION_ID_RE (R2/F6 — typo gid fails schema, never spawns)",
	(EntwurfV2InputSchema.properties.target as { pattern?: string }).pattern,
	SESSION_ID_RE.source,
);
eq("input.intent enum === ENTWURF_INTENTS", enumValues(EntwurfV2InputSchema.properties.intent), [...ENTWURF_INTENTS]);
eq(
	"input.mode enum === ENTWURF_V2_MODES (delivery mode, not ownership)",
	enumValues(EntwurfV2InputSchema.properties.mode),
	[...ENTWURF_V2_MODES],
);

// receipt: a DISCRIMINATED union (anyOf of 2 branches) — proves a flat illegal
// receipt {ok:true, reason:...} cannot validate. success carries the allow
// facets and NO reason; reject carries reason and NONE of the allow facets.
const receiptBranches = (EntwurfV2ReceiptSchema as { anyOf?: unknown[] }).anyOf ?? [];
eq("receipt schema is a 2-branch union (not flat optionals)", receiptBranches.length, 2);

const succ = EntwurfV2ReceiptSuccessSchema.properties;
eq("receipt.success keys", Object.keys(succ), ["ok", "action", "transport", "ownership", "observedLiveness"]);
eq("receipt.success ok literal === true", literalConst(succ.ok), true);
ok("receipt.success has NO reason (illegal {ok:true,reason} excluded)", !("reason" in succ));
eq("receipt.success.action enum === ENTWURF_V2_ACTIONS", enumValues(succ.action), [...ENTWURF_V2_ACTIONS]);
eq("receipt.success.transport enum === ENTWURF_V2_TRANSPORTS", enumValues(succ.transport), [...ENTWURF_V2_TRANSPORTS]);
eq("receipt.success.ownership enum === ENTWURF_V2_OWNERSHIPS", enumValues(succ.ownership), [...ENTWURF_V2_OWNERSHIPS]);
eq("receipt.success.observedLiveness enum === FACT_LIVENESSES (4)", enumValues(succ.observedLiveness), [
	...FACT_LIVENESSES,
]);

const rej = EntwurfV2ReceiptRejectSchema.properties;
eq("receipt.reject keys", Object.keys(rej), ["ok", "reason", "observedLiveness"]);
eq("receipt.reject ok literal === false", literalConst(rej.ok), false);
ok(
	"receipt.reject has NO allow facets (illegal {ok:false,action} excluded)",
	!("action" in rej) && !("transport" in rej) && !("ownership" in rej),
);
eq("receipt.reject.reason enum === ENTWURF_V2_REJECT_REASONS", enumValues(rej.reason), [...ENTWURF_V2_REJECT_REASONS]);
eq("receipt.reject.observedLiveness enum === FACT_LIVENESSES (4)", enumValues(rej.observedLiveness), [
	...FACT_LIVENESSES,
]);

// exactness — additionalProperties:false makes the schema reject extra keys at
// the JSON-Schema level (not merely by declared-property convention). Without
// it, {ok:true, ..., reason:"bad-target"} would validate against the success
// branch (default additionalProperties=true).
function additionalProps(schema: unknown): unknown {
	return (schema as { additionalProperties?: unknown }).additionalProperties;
}
eq("input schema is exact (additionalProperties:false)", additionalProps(EntwurfV2InputSchema), false);
eq(
	"receipt.success is exact (additionalProperties:false — stray reason rejected)",
	additionalProps(EntwurfV2ReceiptSuccessSchema),
	false,
);
eq(
	"receipt.reject is exact (additionalProperties:false — stray allow facet rejected)",
	additionalProps(EntwurfV2ReceiptRejectSchema),
	false,
);

console.log(`\ncheck-entwurf-v2-contract: ${passed} assertions passed`);
