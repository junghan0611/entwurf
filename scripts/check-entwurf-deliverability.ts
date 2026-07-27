/**
 * check-entwurf-deliverability — deterministic gate for the conversational-mailbox
 * deliverability predicate (SE-1/SE-2 slice 2c). This is the predicate an enqueue site
 * must consult in slice 2d before writing a .msg, so a reply never rots in a dead
 * session's mailbox (SE-2) and is never enqueued for a backend that has no mailbox drain
 * (SE-1, pi). The SHIPPED sites are the v2 decider and its send-fallback re-resolve; the
 * v1 fallback / MCP v1 / pi-native v1 sites were removed in the 0.12 cutover.
 *
 * Proves:
 *   - computeMetaReceiverActive: the shared atom — active ⟺ recordBacked ∧ ownerAlive ∧
 *     watchArmed; every axis required, undefined treated as false (fail-closed), each
 *     failure names its own cause.
 *   - mailboxConversationalDeliverable: deliverable ⟺ wakeMode "self-fetch" AND active.
 *     KEY ROWS — direct-inject (pi) is refused even when the receiver looks active
 *     (SE-1: no mailbox drain), and a self-fetch receiver with a dead owner / unarmed
 *     watch is refused (SE-2: would rot as garbage).
 *   - WIRING: the self-addressability predicate shares this exact atom (one source of
 *     truth for "active receiver"), so self-reply and target-enqueue cannot drift.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import {
	computeMetaReceiverActive,
	mailboxConversationalDeliverable,
	type NativePushDeliverabilityFacts,
	nativePushDeliverable,
	receiverMarkerMatchesIdentity,
} from "../pi-extensions/lib/entwurf-deliverability.ts";

let passed = 0;
function ok(label: string, cond: boolean): void {
	assert.ok(cond, label);
	console.log(`  ok    ${label}`);
	passed++;
}

const REPO_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// ── computeMetaReceiverActive: the shared atom ──────────────────────────────
ok(
	"active ⟺ recordBacked ∧ ownerAlive ∧ watchArmed",
	computeMetaReceiverActive({ recordBacked: true, ownerAlive: true, watchArmed: true }).active === true,
);
ok(
	"no backing record → inactive",
	computeMetaReceiverActive({ recordBacked: false, ownerAlive: true, watchArmed: true }).active === false,
);
ok(
	"owner dead → inactive",
	computeMetaReceiverActive({ recordBacked: true, ownerAlive: false, watchArmed: true }).active === false,
);
ok(
	"watch unarmed → inactive",
	computeMetaReceiverActive({ recordBacked: true, ownerAlive: true, watchArmed: false }).active === false,
);
ok("undefined axes → fail-closed inactive", computeMetaReceiverActive({ recordBacked: true }).active === false);
// each failure names its own cause (no conflation)
ok(
	"owner-dead reason mentions start-key",
	/start-key/.test(computeMetaReceiverActive({ recordBacked: true, ownerAlive: false, watchArmed: true }).reason),
);
ok(
	"watch-unarmed reason mentions doorbell",
	/doorbell/.test(computeMetaReceiverActive({ recordBacked: true, ownerAlive: true, watchArmed: false }).reason),
);

// ── mailboxConversationalDeliverable: the enqueue gate ──────────────────────
const D = (f: Parameters<typeof mailboxConversationalDeliverable>[0]) =>
	mailboxConversationalDeliverable(f).deliverable;

ok(
	"self-fetch + active → deliverable",
	D({ wakeMode: "self-fetch", recordBacked: true, ownerAlive: true, watchArmed: true }) === true,
);
// SE-1 KEY ROW: a direct-inject backend (pi) has no mailbox drain — refuse even when
// the receiver otherwise looks fully active.
ok(
	"direct-inject (pi) + active → NOT deliverable (no mailbox drain — SE-1)",
	D({ wakeMode: "direct-inject", recordBacked: true, ownerAlive: true, watchArmed: true }) === false,
);
// SE-2 KEY ROWS: self-fetch but the receiver is gone / never armed.
ok(
	"self-fetch + owner-dead → NOT deliverable (terminated session — SE-2)",
	D({ wakeMode: "self-fetch", recordBacked: true, ownerAlive: false, watchArmed: true }) === false,
);
ok(
	"self-fetch + watch-unarmed → NOT deliverable (no doorbell wake — SE-2)",
	D({ wakeMode: "self-fetch", recordBacked: true, ownerAlive: true, watchArmed: false }) === false,
);
ok(
	"self-fetch + no record → NOT deliverable",
	D({ wakeMode: "self-fetch", recordBacked: false, ownerAlive: true, watchArmed: true }) === false,
);
ok("unset wakeMode → NOT deliverable", D({ recordBacked: true, ownerAlive: true, watchArmed: true }) === false);
ok(
	"unknown wakeMode string → fail-closed NOT deliverable",
	D({ wakeMode: "direct-inject-future", recordBacked: true, ownerAlive: true, watchArmed: true }) === false,
);
// reasons distinguish the wake-mode refusal from the receiver-inactive refusal
ok(
	"direct-inject refusal reason names wake mode",
	/wake mode/.test(
		mailboxConversationalDeliverable({
			wakeMode: "direct-inject",
			recordBacked: true,
			ownerAlive: true,
			watchArmed: true,
		}).reason,
	),
);
ok(
	"self-fetch inactive refusal reason names the receiver",
	/receiver inactive/.test(
		mailboxConversationalDeliverable({
			wakeMode: "self-fetch",
			recordBacked: true,
			ownerAlive: false,
			watchArmed: true,
		}).reason,
	),
);

// ── receiverMarkerMatchesIdentity: the marker ↔ identity SSOT (SE-2 2d-3) ───
// A present marker only raises a receiver to active when it agrees with the record on
// garden/backend/native id. The v2 production deliverability seam and the MCP bridge's
// entwurf_self both route through this one helper, so presence-only false-positives are
// closed on every shipped path — and there is no second implementation to drift from since
// entwurf-mailbox-guard.ts (production importers: 0) was deleted 2026-07-27.
const ID = { gardenId: "20260612T100000-aaaaaa", backend: "claude-code", nativeSessionId: "n-1" };
ok(
	"marker matches identity on all three axes → true",
	receiverMarkerMatchesIdentity(
		{ gardenId: ID.gardenId, backend: ID.backend, nativeSessionId: ID.nativeSessionId },
		ID,
	),
);
ok(
	"garden id drift → false (foreign marker)",
	!receiverMarkerMatchesIdentity({ ...ID, gardenId: "20260612T999999-bbbbbb" }, ID),
);
ok("backend drift → false", !receiverMarkerMatchesIdentity({ ...ID, backend: "pi" }, ID));
ok(
	"native session id drift → false (stale/recycled marker)",
	!receiverMarkerMatchesIdentity({ ...ID, nativeSessionId: "n-2" }, ID),
);
ok("null marker → false (fail-closed)", !receiverMarkerMatchesIdentity(null, ID));
ok("undefined marker → false (fail-closed)", !receiverMarkerMatchesIdentity(undefined, ID));

// ── nativePushDeliverable: the SEPARATE native-push axis (봉인 6) ────────────
// deliverable ⟺ recordBacked ∧ probeAlive. Distinct axis from the mailbox gate: it
// must NOT depend on watchArmed (the mailbox-only atom), so a native-push target's
// deliverability is unaffected by any watch/ownerAlive signal.
const NP = (f: Parameters<typeof nativePushDeliverable>[0]) => nativePushDeliverable(f).deliverable;

ok("native-push: record backed + probe alive → deliverable", NP({ recordBacked: true, probeAlive: true }) === true);
ok(
	"native-push: no record → NOT deliverable (record-less native id)",
	NP({ recordBacked: false, probeAlive: true }) === false,
);
ok(
	"native-push: probe not alive → NOT deliverable (no live conversation)",
	NP({ recordBacked: true, probeAlive: false }) === false,
);
ok("native-push: undefined axes → fail-closed inactive", NP({ recordBacked: true }) === false);
ok("native-push: both undefined → fail-closed inactive", NP({}) === false);
// axis separation (보정①): the native-push predicate has NO watchArmed/ownerAlive
// concept — its shape carries only recordBacked/probeAlive, so a mailbox liveness
// fact cannot be smuggled into it.
ok(
	"native-push: reason distinguishes record-less from dead-probe",
	nativePushDeliverable({ recordBacked: false, probeAlive: true }).reason !==
		nativePushDeliverable({ recordBacked: true, probeAlive: false }).reason,
);
// Type-level guard: the fact keyset is EXACTLY recordBacked|probeAlive — if a future
// edit added `watchArmed`/`ownerAlive` (the mailbox atom fields), this stops compiling,
// so the mailbox atom can never be smuggled into the native-push axis (보정①).
type NativePushFactKeys = keyof NativePushDeliverabilityFacts;
const _nativePushKeysGuard: NativePushFactKeys extends "recordBacked" | "probeAlive" ? true : never = true;
void _nativePushKeysGuard;

// ── WIRING: self-addressability shares the SAME atom ────────────────────────
const selfSrc = readFileSync(path.join(REPO_DIR, "pi-extensions", "lib", "entwurf-self-address.ts"), "utf8");
ok(
	"entwurf-self-address imports computeMetaReceiverActive from the deliverability lib",
	/computeMetaReceiverActive/.test(selfSrc) && /entwurf-deliverability\.ts/.test(selfSrc),
);
ok(
	"entwurf-self-address calls computeMetaReceiverActive (no duplicated conjunction)",
	/computeMetaReceiverActive\s*\(/.test(selfSrc),
);

console.log(`\ncheck-entwurf-deliverability: ${passed} checks passed`);
