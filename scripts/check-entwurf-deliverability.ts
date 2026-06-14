/**
 * check-entwurf-deliverability — deterministic gate for the conversational-mailbox
 * deliverability predicate (SE-1/SE-2 slice 2c). This is the predicate the enqueue
 * sites (v1 fallback, MCP v1, pi-native v1, v2 decider/send-fallback) must consult in
 * slice 2d before writing a .msg, so a reply never rots in a dead session's mailbox
 * (SE-2) and is never enqueued for a backend that has no mailbox drain (SE-1, pi).
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
