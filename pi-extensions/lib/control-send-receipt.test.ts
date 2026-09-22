/**
 * control-send-receipt — the acceptance boundary, proven beside the leaf that names it (#120 P2).
 *
 * The subject is a pure classifier, so every cell here is inputs → one name. What the cells are
 * really defending is the SEPARATION: an idle receiver's `sent` and a busy receiver's
 * `queued-*` are different promises (`[측정 pi-agent-core 0.87.0]` `dist/agent-loop.js:186` drains
 * steering every turn, `:191-197` drains follow-ups only when the inner loop ends, and the two
 * queues in `dist/agent.js:96-97,137-138` have no FIFO between them), and an answer we could not
 * classify is an ACCEPTANCE we could not name — never a failure and never `sent`.
 *
 * No IO, no clock, no socket: the leaf reaches for none of them, which is the whole reason it can
 * be the one classifier both ends of the wire share.
 */

import { describe, expect, it } from "vitest";
import {
	ACCEPTANCE_BOUNDARIES,
	type AcceptanceBoundary,
	describeUnknownBoundary,
	isObservedBoundary,
	parseAcceptanceBoundary,
	sendReceiptBoundary,
} from "./control-send-receipt.ts";

describe("control-send-receipt", () => {
	it("[QK:SEND-RECEIPT-IDLE-IS-SENT] an idle receiver's acceptance is `sent`, whichever mode was asked for", () => {
		// `idle` wins over `mode` because neither queue is involved on that branch — the receiver
		// passes no `deliverAs` at all. A receipt that let `mode` decide here would report a queue
		// that was never touched, and `sent` would stop meaning "accepted as a direct trigger".
		expect(sendReceiptBoundary({ idle: true, mode: "steer" }), "idle+steer is a direct trigger").toBe("sent");
		expect(sendReceiptBoundary({ idle: true, mode: "follow_up" }), "idle+follow_up is a direct trigger").toBe("sent");
	});

	it("[QK:SEND-RECEIPT-BUSY-STEER-IS-QUEUED] a busy receiver asked for steer reports `queued-steer`, not `sent`", () => {
		// The one that produced #120: the sender saw `sent` while the message sat in a queue it
		// shares with nothing, ahead of nothing, for 78 minutes.
		expect(sendReceiptBoundary({ idle: false, mode: "steer" })).toBe("queued-steer");
	});

	it("[QK:SEND-RECEIPT-BUSY-FOLLOWUP-IS-QUEUED] a busy receiver asked for follow_up reports `queued-follow-up`, a DIFFERENT name from steer", () => {
		// Two names, because they are two promises: a steer that arrives later is still drained
		// first. Collapsing them into one `queued` would erase the only fact that explains a
		// reorder after the fact.
		expect(sendReceiptBoundary({ idle: false, mode: "follow_up" })).toBe("queued-follow-up");
		expect(sendReceiptBoundary({ idle: false, mode: "follow_up" })).not.toBe(
			sendReceiptBoundary({ idle: false, mode: "steer" }),
		);
	});

	it("[QK:SEND-RECEIPT-UNKNOWN-IS-ACCEPTED-NOT-SENT] an unclassifiable answer is `accepted-unknown-boundary` — never `sent`, never a failure", () => {
		// Every one of these arrives AFTER the RPC answered success, so the message is already out
		// of our hands. Answering `sent` would re-assert the false claim; throwing or returning a
		// failure would invite a retry that double-delivers.
		const unknowns: unknown[] = [
			undefined,
			null,
			{},
			{ boundary: undefined },
			{ boundary: "delivered" },
			{ boundary: "direct" },
			{ boundary: "followUp" },
			{ boundary: 7 },
			{ delivered: true, deliveredAs: "steer" },
			"sent",
		];
		for (const data of unknowns) {
			expect(parseAcceptanceBoundary(data), `${JSON.stringify(data)} must not be claimed as a known boundary`).toBe(
				"accepted-unknown-boundary",
			);
		}
		// And the three real ones still round-trip, so the arm above is a classifier and not a
		// blanket refusal.
		for (const boundary of ["sent", "queued-steer", "queued-follow-up"] as const) {
			expect(parseAcceptanceBoundary({ boundary })).toBe(boundary);
		}
	});

	it("a receiver may never produce the reader's own verdict", () => {
		// `accepted-unknown-boundary` describes OUR failure to classify an answer. A receiver that
		// emitted it would be reporting our confusion as its own state.
		expect(isObservedBoundary("accepted-unknown-boundary")).toBe(false);
		const produced: AcceptanceBoundary[] = [
			sendReceiptBoundary({ idle: true, mode: "steer" }),
			sendReceiptBoundary({ idle: false, mode: "steer" }),
			sendReceiptBoundary({ idle: false, mode: "follow_up" }),
		];
		expect(new Set(produced).size, "the three observable boundaries are distinct").toBe(3);
		expect(ACCEPTANCE_BOUNDARIES.length, "the set is closed at four").toBe(4);
	});

	it("the unknown diagnostic is bounded and single-line — a peer's payload is untrusted input", () => {
		// It exists so an operator can tell version skew from a broken peer. It is NOT a place to
		// repeat another process's object back onto a status line.
		expect(describeUnknownBoundary({ boundary: "sent-ish" })).toBe("sent-ish");
		expect(describeUnknownBoundary({})).toBe("no boundary field");
		expect(describeUnknownBoundary({ boundary: "" })).toBe("empty boundary");
		expect(describeUnknownBoundary(undefined)).toBeUndefined();
		const long = describeUnknownBoundary({ boundary: `${"x".repeat(500)}\nsecond line` });
		expect(long?.length ?? 0, "truncated").toBeLessThanOrEqual(81);
		expect(long ?? "", "no newline reaches a status line").not.toContain("\n");
		expect(describeUnknownBoundary({ boundary: { nested: "object" } }), "shape, never content").toBe("object");
	});
});
