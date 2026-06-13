/**
 * check-entwurf-v2-mailbox — deterministic gate for the 5c-4 meta-mailbox SEND body
 * (`executeMetaMailboxSend` + the production `makeProductionSendViaMailbox` adapter). It
 * proves the ENQUEUE-ONLY wiring over an injected fake enqueue, with NO filesystem:
 *
 *   1. sender present + wantsReply=true  → body rendered via formatMetaMailboxBody with
 *      `wants reply: yes`; enqueue called EXACTLY once.
 *   2. sender present + wantsReply=false → body shows `wants reply: no` (plan.wantsReply
 *      is threaded — the deliberate divergence from legacy's hard-coded false).
 *   3. sender undefined → the RAW `plan.message` is enqueued (envelope-less fallback).
 *   4. enqueue opts are EXACTLY {gardenId: plan.targetGardenId, body, sessionsDir,
 *      mailboxDir} — the routing target is the plan's, never re-derived.
 *   5. enqueue throw PROPAGATES (it is NOT folded into {success:false}).
 *   6. a successful enqueue returns {success:true}.
 *   7. production adapter: returns Promise<{success:true}>, calls senderProvider, and
 *      NEVER touches `lock` — a poison LockClaim whose every access throws still resolves.
 *   8. production adapter threads the plan straight through to enqueue ONCE.
 *   9. source guard: the lib has NO release seam and NO routing seam (no releaseLock /
 *      inspect / probe / resolve) — a lock leak / re-route is structurally impossible.
 *
 * No real IO — the enqueue fake records its args so "enqueue once, with these exact
 * arguments, no routing, no release" is asserted structurally.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { LockClaim } from "../pi-extensions/lib/entwurf-v2-lock.ts";
import { executeMetaMailboxSend, makeProductionSendViaMailbox } from "../pi-extensions/lib/entwurf-v2-mailbox.ts";
import type { MetaMailboxPlan } from "../pi-extensions/lib/entwurf-v2-send.ts";
import type { MailboxSenderEnvelope } from "../pi-extensions/lib/meta-mailbox-body.ts";
import type { EnqueueMetaMessageOptions, EnqueueMetaMessageResult } from "../pi-extensions/lib/meta-session.ts";

let passed = 0;
function ok(label: string, cond: boolean): void {
	assert.ok(cond, label);
	console.log(`  ok    ${label}`);
	passed++;
}

const GID = "20260613T100000-aaaaaa";

const SENDER: MailboxSenderEnvelope = {
	sessionId: "20260613T120000-sender",
	agentId: "openai-codex/gpt-5.5",
	cwd: "/home/junghan/repos/gh/pi-shell-acp",
	timestamp: "2026-06-13T04:00:00.000Z",
	origin: "pi-session",
	replyable: true,
};

function mailboxPlan(over: Partial<MetaMailboxPlan> = {}): MetaMailboxPlan {
	return {
		transport: "meta-mailbox",
		action: "send",
		targetGardenId: GID,
		mailboxDir: "/fake/mailbox",
		sessionsDir: "/fake/sessions",
		wantsReply: false,
		message: "hello world",
		...over,
	};
}

// A fake enqueue that records every call. The result is a plausible EnqueueMetaMessageResult.
function recordingEnqueue(): {
	calls: EnqueueMetaMessageOptions[];
	fn: (opts: EnqueueMetaMessageOptions) => EnqueueMetaMessageResult;
} {
	const calls: EnqueueMetaMessageOptions[] = [];
	return {
		calls,
		fn: (opts: EnqueueMetaMessageOptions): EnqueueMetaMessageResult => {
			calls.push(opts);
			return {
				gardenId: opts.gardenId,
				recordPath: `/fake/records/${opts.gardenId}.json`,
				messagePath: `/fake/mailbox/${opts.gardenId}/m.msg`,
				signalPath: `/fake/mailbox/${opts.gardenId}/inbox.signal`,
			};
		},
	};
}

// ── 1. sender present + wantsReply=true → rendered body, enqueue once ────────
{
	const enq = recordingEnqueue();
	const plan = mailboxPlan({ wantsReply: true, message: "ping" });
	const res = executeMetaMailboxSend(plan, SENDER, { enqueue: enq.fn });
	ok("1: enqueue called exactly once", enq.calls.length === 1);
	ok("1: returns {success:true}", res.success === true);
	const body = enq.calls[0].body;
	ok(
		"1: body is the rendered envelope, not raw message",
		body !== plan.message && body.includes("[entwurf received ⟵]"),
	);
	ok("1: wantsReply=true → 'wants reply: yes' in body", body.includes("wants reply: yes"));
	ok("1: body carries the message", body.includes("ping"));
	ok("1: body carries the sender sessionId (replyable)", body.includes(SENDER.sessionId));
}

// ── 2. sender present + wantsReply=false → 'wants reply: no' ──────────────────
{
	const enq = recordingEnqueue();
	const res = executeMetaMailboxSend(mailboxPlan({ wantsReply: false }), SENDER, { enqueue: enq.fn });
	ok("2: returns {success:true}", res.success === true);
	ok("2: wantsReply=false → 'wants reply: no' in body", enq.calls[0].body.includes("wants reply: no"));
}

// ── 3. sender undefined → raw plan.message enqueued ──────────────────────────
{
	const enq = recordingEnqueue();
	const plan = mailboxPlan({ message: "raw body, no envelope" });
	executeMetaMailboxSend(plan, undefined, { enqueue: enq.fn });
	ok("3: envelope-less → raw plan.message is the body", enq.calls[0].body === plan.message);
	ok("3: no envelope header when sender absent", !enq.calls[0].body.includes("[entwurf received ⟵]"));
}

// ── 4. enqueue opts are EXACTLY the plan's fields (no re-derivation) ──────────
{
	const enq = recordingEnqueue();
	const plan = mailboxPlan({ targetGardenId: GID, mailboxDir: "/m/dir", sessionsDir: "/s/dir" });
	executeMetaMailboxSend(plan, SENDER, { enqueue: enq.fn });
	const opts = enq.calls[0];
	ok("4: gardenId === plan.targetGardenId", opts.gardenId === GID);
	ok("4: mailboxDir === plan.mailboxDir", opts.mailboxDir === "/m/dir");
	ok("4: sessionsDir === plan.sessionsDir", opts.sessionsDir === "/s/dir");
	ok(
		"4: opts keys are exactly {gardenId, body, sessionsDir, mailboxDir}",
		JSON.stringify(Object.keys(opts).sort()) === JSON.stringify(["body", "gardenId", "mailboxDir", "sessionsDir"]),
	);
}

// ── 5. enqueue throw PROPAGATES, not folded into success:false ───────────────
{
	const boom = new Error("citizen record gone");
	let thrown: unknown;
	try {
		executeMetaMailboxSend(mailboxPlan(), SENDER, {
			enqueue: () => {
				throw boom;
			},
		});
	} catch (e) {
		thrown = e;
	}
	ok("5: enqueue throw propagates (no success:false fold)", thrown === boom);
}

// ── 6. (covered by 1/2) success → {success:true} — explicit ──────────────────
{
	const enq = recordingEnqueue();
	const res = executeMetaMailboxSend(mailboxPlan(), SENDER, { enqueue: enq.fn });
	ok("6: successful enqueue → {success:true}", res.success === true && res.error === undefined);
}

// ── 7. production adapter: ignores lock entirely (poison LockClaim) ───────────
{
	const enq = recordingEnqueue();
	let senderProviderCalls = 0;
	const sendViaMailbox = makeProductionSendViaMailbox({
		senderProvider: () => {
			senderProviderCalls++;
			return SENDER;
		},
		enqueue: enq.fn,
	});
	// Any property access on this lock throws — proving the adapter never reads it.
	const poisonLock = new Proxy({} as LockClaim, {
		get() {
			throw new Error("mailbox enqueue must NOT touch the lock");
		},
	});
	const res = await sendViaMailbox(mailboxPlan(), poisonLock);
	ok("7: production adapter resolves {success:true}", res.success === true);
	ok("7: senderProvider consulted exactly once", senderProviderCalls === 1);
	ok("7: enqueue called once via adapter", enq.calls.length === 1);
	ok("7: lock never touched (poison getter never fired)", true);
}

// ── 8. production adapter threads the plan straight through ───────────────────
{
	const enq = recordingEnqueue();
	const sendViaMailbox = makeProductionSendViaMailbox({ senderProvider: () => undefined, enqueue: enq.fn });
	const plan = mailboxPlan({ targetGardenId: "20260613T200000-cccccc", message: "thread me" });
	await sendViaMailbox(plan, undefined as unknown as LockClaim);
	ok(
		"8: adapter enqueues the plan's target once",
		enq.calls.length === 1 && enq.calls[0].gardenId === plan.targetGardenId,
	);
	ok("8: envelope-less adapter sends raw message", enq.calls[0].body === plan.message);
}

// ── 8b. production adapter: an enqueue throw surfaces as a REJECTED promise ───
// The adapter is `async`, so a synchronous enqueue throw must become a rejection (not a
// sync throw) — the honest async-dep shape the send hand awaits.
{
	const boom = new Error("enqueue exploded");
	const sendViaMailbox = makeProductionSendViaMailbox({
		senderProvider: () => SENDER,
		enqueue: () => {
			throw boom;
		},
	});
	let rejected: unknown;
	await sendViaMailbox(mailboxPlan(), undefined as unknown as LockClaim).catch((e) => {
		rejected = e;
	});
	ok("8b: enqueue throw → rejected promise (not a sync throw)", rejected === boom);
}

// ── 9. source guard: NO release seam, NO routing seam ────────────────────────
{
	const libPath = fileURLToPath(new URL("../pi-extensions/lib/entwurf-v2-mailbox.ts", import.meta.url));
	const src = readFileSync(libPath, "utf8");
	// Strip block comments so the doc-prose ("release stays the hand's …") does not trip
	// the structural guard — we assert about CODE, not the rationale we wrote about it.
	const code = src.replace(/\/\*[\s\S]*?\*\//g, "");
	for (const forbidden of ["releaseLock", "inspectSocket", "probeSocket", "resolveDispatch", "resolveTarget"]) {
		ok(`9: lib code has no '${forbidden}' (no release / no routing seam)`, !code.includes(forbidden));
	}
}

console.log(`\ncheck-entwurf-v2-mailbox: ${passed} checks passed`);
