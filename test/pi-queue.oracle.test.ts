/**
 * pi-queue.oracle — what a pi receiver ACTUALLY does with a queued message (#120 P2).
 *
 * THE SUBJECT IS NOT OURS, AND THAT IS THE POINT. Entwurf's control-socket `send` hands the body
 * to `pi.sendMessage` and the receiver's own agent decides everything after that. Every sentence
 * the receipt and `DELIVERY.md` now make about `queued-steer` / `queued-follow-up` — the ordering,
 * the volatility, the absence of a FIFO between the two queues — is a claim about pi, so it is
 * proven against the INSTALLED `@earendil-works/pi-agent-core`, pinned exactly in devDependencies,
 * and not against a re-implementation of it here. A re-implementation would agree with our prose
 * by construction and tell us nothing.
 *
 * ZERO MODEL, ZERO NETWORK, ZERO CHILD PROCESS. The only injected part is the stream function: it
 * returns a deferred on its first call, which is how a receiver is held "busy" deterministically,
 * and records the messages each turn was actually given. Nothing else is faked — the queues, the
 * drain points and the loop are the shipped ones.
 *
 * MUTANT EXEMPTION, STATED: these four claims have no committed mutant because their SUBJECT is an
 * external package. A mutant would have to edit `node_modules`, which the qualification runner
 * neither snapshots nor restores, and mutating our own source could not make a claim about pi's
 * behaviour fail for the right reason. The pin is what keeps the claims honest: if pi's queues
 * change, this file goes red on the version bump that introduces the change (P4's lane).
 */

import { Agent } from "@earendil-works/pi-agent-core";
import { describe, expect, it } from "vitest";

/** A stream answer the loop accepts: an async-iterable that yields nothing plus a `result()`. */
function answer(text: string) {
	const message = { role: "assistant" as const, content: [{ type: "text" as const, text }] };
	return {
		async *[Symbol.asyncIterator]() {
			// no partial events — `result()` alone is a complete answer to this loop
		},
		async result() {
			return message;
		},
	};
}

interface Harness {
	agent: Agent;
	/** The user-visible text handed to each turn, in the order the turns happened. */
	turns: string[][];
	/** Release the first (held) turn. */
	release: () => void;
	/** Resolves once the first stream call is actually in flight. */
	busy: Promise<void>;
}

/**
 * A real `Agent` whose first turn is HELD open, so "the receiver is busy" is a fact rather than a
 * timing hope. Later turns answer immediately.
 */
function harness(): Harness {
	const turns: string[][] = [];
	let release: () => void = () => {};
	const held = new Promise<void>((resolve) => {
		release = resolve;
	});
	let announceBusy: () => void = () => {};
	const busy = new Promise<void>((resolve) => {
		announceBusy = resolve;
	});
	let call = 0;

	const agent = new Agent({
		streamFn: (async (_model: unknown, context: any) => {
			call += 1;
			// Record only what a USER put in this turn — the assistant's own answers are echoed
			// back in the context and would drown the ordering we are measuring.
			turns.push(
				(context?.messages ?? [])
					.filter((m: any) => m?.role === "user")
					.map((m: any) => (typeof m.content === "string" ? m.content : JSON.stringify(m.content))),
			);
			if (call === 1) {
				announceBusy();
				await held;
			}
			return answer(`turn ${call}`);
		}) as any,
		getApiKey: () => "not-used",
	});
	return { agent, turns, release, busy };
}

/** A user message in the shape the vendor's `AgentMessage` union requires. */
function user(content: string) {
	return { role: "user" as const, content, timestamp: Date.now() };
}

/** What a turn was handed, as one flat string — enough to ask "which message arrived when". */
const flat = (turn: string[] | undefined): string => (turn ?? []).join(" | ");

describe("a pi receiver's queues, measured on the installed pi-agent-core", () => {
	it("[QK:PI-QUEUE-STEER-STARVES-FOLLOWUP] a steer queued LAST is delivered BEFORE a follow_up queued first — the two queues have no FIFO between them", async () => {
		// This is #120's whole mechanism. The operator sent follow-ups, then steers; the steers
		// were processed first and the follow-ups waited ~78 minutes. If a receipt cannot tell the
		// two queues apart, nothing about that sequence is explicable after the fact.
		const h = harness();
		const run = h.agent.prompt("first");
		await h.busy;
		h.agent.followUp(user("F1"));
		h.agent.steer(user("S1"));
		h.agent.steer(user("S2"));
		h.release();
		await run;
		await h.agent.waitForIdle();

		const afterFirst = h.turns.slice(1).map(flat).join(" >> ");
		const s1 = afterFirst.indexOf("S1");
		const f1 = afterFirst.indexOf("F1");
		expect(s1, `S1 must have been delivered (turns: ${afterFirst})`).toBeGreaterThanOrEqual(0);
		expect(f1, `F1 must have been delivered (turns: ${afterFirst})`).toBeGreaterThanOrEqual(0);
		expect(s1, "a LATER steer overtakes an EARLIER follow_up").toBeLessThan(f1);
	});

	it("[QK:PI-QUEUE-ONE-AT-A-TIME] both queues default to `one-at-a-time`, so a receipt may not promise batch semantics", async () => {
		const h = harness();
		expect(h.agent.steeringMode, "steering default").toBe("one-at-a-time");
		expect(h.agent.followUpMode, "follow-up default").toBe("one-at-a-time");
	});

	it("[QK:PI-QUEUE-NO-MIDFLIGHT-MERGE] a message queued while a turn is in flight does NOT join that turn — `steer` is not an interrupt", async () => {
		// The prose this kills: "steer = interrupt the current turn". The in-flight turn's payload
		// is already fixed; a steer waits for it to end, which is why a long tool call can sit on
		// a steer for as long as it likes.
		const h = harness();
		const run = h.agent.prompt("first");
		await h.busy;
		h.agent.steer(user("MIDFLIGHT"));
		h.release();
		await run;
		await h.agent.waitForIdle();

		expect(flat(h.turns[0]), "the turn that was already running never saw it").not.toContain("MIDFLIGHT");
		expect(h.turns.length, "it arrived as a LATER turn instead").toBeGreaterThan(1);
		expect(h.turns.slice(1).map(flat).join(" >> ")).toContain("MIDFLIGHT");
	});

	it("[QK:PI-QUEUE-ABORT-DROPS-QUEUED] clearing the queues drops what is waiting, silently and with no receipt — queued is process memory, not durability", async () => {
		// The receiver's abort path (`clearAllQueues`) is reachable from an ESC in the TUI. The
		// sender was told `queued-*` and there is nothing left to deliver and nothing that says so.
		// This is why `DELIVERY.md` no longer lets `queued` imply durable.
		const h = harness();
		const run = h.agent.prompt("first");
		await h.busy;
		h.agent.steer(user("DOOMED-S"));
		h.agent.followUp(user("DOOMED-F"));
		expect(h.agent.hasQueuedMessages(), "both are queued before the abort").toBe(true);
		h.agent.clearAllQueues();
		expect(h.agent.hasQueuedMessages(), "and gone after it").toBe(false);
		h.release();
		await run;
		await h.agent.waitForIdle();

		const everything = h.turns.map(flat).join(" >> ");
		expect(everything, "neither ever reaches a turn").not.toContain("DOOMED-S");
		expect(everything).not.toContain("DOOMED-F");
	});
});
