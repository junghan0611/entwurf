/**
 * #163 S7: the control-socket `send` decision (design v2.1 §2.4), proven beside the module.
 *
 * The production subject is `deliverControlSend`, the one place the guards and their order live;
 * `entwurf-control.ts` only calls it. (The extension-level `entwurf-control.test.ts` needs the
 * compiled bridge and is not the oracle for this table.) Oracles are spies on the two effects —
 * `sendMessage` (the Pi queue) and `appendEntry` (the record) — the receipt the module answers, and
 * the seam calls. The seam is a deferred fake, so the state between the await's two sides is set by
 * the test, as a binding swap, a close or a compaction would set it.
 */
import { describe, expect, it } from "vitest";
import type { AcpSteerEffect, AcpSteerSeamLookup } from "./acp-steer-seam.ts";
import { type CompactionGuard, createCompactionGuard, noteCompactionBefore } from "./compaction-send-guard.ts";
import { type ControlSendDeps, deliverControlSend } from "./control-steer.ts";

type Binding = { nativeSessionId: string };

function world(
	over: { idle?: boolean; seam?: "absent" | "invalid" | ((text: string) => Promise<AcpSteerEffect>) } = {},
) {
	const state = {
		idle: over.idle ?? false,
		binding: { nativeSessionId: "N-A" } as Binding | null,
		context: { name: "ctx-A" } as object | null,
		closing: false,
		sessionId: "N-A",
		compaction: createCompactionGuard() as CompactionGuard,
	};
	const sent: Array<{ content: string; options: unknown }> = [];
	const entries: Array<{ type: string; data: unknown }> = [];
	const steers: string[] = [];
	const responses: Array<{ success: boolean; data?: unknown; error?: string }> = [];
	let appendThrows: Error | undefined;
	const seam = over.seam ?? (async () => ({ effect: "injected" }) as AcpSteerEffect);
	const deps: ControlSendDeps<Binding, object> = {
		isIdle: () => state.idle,
		hasAgentSignal: () => !state.idle,
		get compaction() {
			return state.compaction;
		},
		binding: () => state.binding,
		context: () => state.context,
		closing: () => state.closing,
		sessionId: () => state.sessionId,
		lookupSeam: (): AcpSteerSeamLookup =>
			seam === "absent"
				? { kind: "absent" }
				: seam === "invalid"
					? { kind: "invalid", detail: "acp-steer-seam-invalid: test" }
					: {
							kind: "ok",
							seam: {
								version: 1,
								steerBusy: (_id, text) => {
									steers.push(text);
									return seam(text);
								},
								hasOpenWindow: () => true,
							},
						},
		sendMessage: (m, o) => sent.push({ content: m.content, options: o }),
		appendEntry: (type, data) => {
			if (appendThrows) throw appendThrows;
			entries.push({ type, data });
		},
		customType: "entwurf-message",
		now: () => "2026-11-15T05:00:00.000Z",
		respond: (success, data, error) => responses.push({ success, data, error }),
	};
	const send = (mode: "steer" | "follow_up" = "steer") =>
		deliverControlSend({ content: "MSG+sender", message: "MSG", wantsReply: true, mode }, deps);
	return {
		state,
		sent,
		entries,
		steers,
		responses,
		send,
		failAppend: (e: Error) => {
			appendThrows = e;
		},
	};
}

/** A seam whose answer the test releases after changing state between the await's two sides. */
function deferredSeam() {
	let answer: (e: AcpSteerEffect) => void = () => {};
	let called: () => void = () => {};
	const reached = new Promise<void>((r) => (called = r));
	const seam = (_text: string) =>
		new Promise<AcpSteerEffect>((res) => {
			answer = res;
			called();
		});
	return { seam, reached, answer: (e: AcpSteerEffect) => answer(e) };
}

describe("deliverControlSend — busy steer through the ACP seam", () => {
	it("[QK:CONTROL-STEER-INJECTED-SKIPS-QUEUE] an injected steer is not queued; it is recorded once as a plain entry and answered steer-in-turn", async () => {
		const w = world();
		await w.send();
		expect(w.steers).toEqual(["MSG+sender"]);
		expect(w.sent).toEqual([]);
		expect(w.entries).toEqual([
			{
				type: "entwurf-steer-in-turn",
				data: { text: "MSG", sender: null, at: "2026-11-15T05:00:00.000Z", wantsReply: true },
			},
		]);
		expect(w.responses).toEqual([
			{ success: true, data: { boundary: "steer-in-turn", record: "ok", wants_reply: true }, error: undefined },
		]);
	});

	it("[QK:CONTROL-STEER-FALLBACK-QUEUES] only not-sent and prompt-required fall back: one steer queue entry and the queue receipt", async () => {
		const effects: AcpSteerEffect[] = [
			{ effect: "not-sent", reason: "no-busy-window" },
			{ effect: "not-sent", reason: "steering-unsupported" },
			{ effect: "not-sent", reason: "no-steer-method" },
			{ effect: "prompt-required" },
		];
		for (const e of effects) {
			const w = world({ seam: async () => e });
			await w.send();
			expect(w.sent).toEqual([{ content: "MSG+sender", options: { triggerTurn: true, deliverAs: "steer" } }]);
			expect(w.entries).toEqual([]);
			expect(w.responses[0]).toMatchObject({ success: true, data: { boundary: "queued-steer" } });
		}
	});

	it("[QK:CONTROL-FOLLOWUP-NEVER-INJECTS] follow_up never consults the seam and keeps its queue", async () => {
		const w = world();
		await w.send("follow_up");
		expect(w.steers).toEqual([]);
		expect(w.sent).toEqual([{ content: "MSG+sender", options: { triggerTurn: true, deliverAs: "followUp" } }]);
		expect(w.responses[0]).toMatchObject({ success: true, data: { boundary: "queued-follow-up" } });
	});

	it("without a seam (native Pi) and for an idle receiver the old path is unchanged; a wrong-shaped seam is refused with nothing queued", async () => {
		const native = world({ seam: "absent" });
		await native.send();
		expect(native.sent).toEqual([{ content: "MSG+sender", options: { triggerTurn: true, deliverAs: "steer" } }]);
		const idle = world({ idle: true });
		await idle.send();
		expect(idle.steers).toEqual([]);
		expect(idle.sent).toEqual([{ content: "MSG+sender", options: { triggerTurn: true } }]);
		expect(idle.responses[0]).toMatchObject({ data: { boundary: "sent" } });
		const bad = world({ seam: "invalid" });
		await bad.send();
		expect(bad.sent).toEqual([]);
		expect(bad.responses).toEqual([{ success: false, data: undefined, error: "acp-steer-seam-invalid: test" }]);
	});

	it("[QK:CONTROL-STEER-UNKNOWN-NEVER-REQUEUES] an unknown outcome is never queued, recorded or retried", async () => {
		for (const reason of ["timeout", "connection-closed", "request-rejected", "answer-unrecognized"] as const) {
			const w = world({ seam: async () => ({ effect: "unknown", reason, detail: "d" }) });
			await w.send();
			expect(w.sent).toEqual([]);
			expect(w.entries).toEqual([]);
			expect(w.steers).toHaveLength(1);
			expect(w.responses).toEqual([
				{
					success: true,
					data: { boundary: "steer-unknown", reason, detail: "d", wants_reply: true },
					error: undefined,
				},
			]);
		}
	});

	it("[QK:CONTROL-STEER-SEAM-THREW-NAMED] a seam that throws is answered steer-unknown seam-threw — not connection-closed — with nothing queued or recorded", async () => {
		const w = world({
			seam: async () => {
				throw new Error("seam bug");
			},
		});
		await w.send();
		expect([w.sent, w.entries]).toEqual([[], []]);
		expect(w.responses).toEqual([
			{
				success: true,
				data: { boundary: "steer-unknown", reason: "seam-threw", detail: "seam bug", wants_reply: true },
				error: undefined,
			},
		]);
	});

	it("[QK:CONTROL-STEER-RECORD-FAILURE-IS-DIAGNOSTIC] a record failure after injection is a receipt diagnostic — not a failure, not a queue entry, not a second try", async () => {
		const f = world();
		f.failAppend(new Error("session file is read-only"));
		await f.send();
		expect(f.steers).toHaveLength(1);
		expect(f.sent).toEqual([]);
		expect(f.responses).toEqual([
			{
				success: true,
				data: { boundary: "steer-in-turn", record: "failed:session file is read-only", wants_reply: true },
				error: undefined,
			},
		]);
	});
});

describe("deliverControlSend — what the await changes (design §2.4, v2.1)", () => {
	async function changedDuringAwait(change: (w: ReturnType<typeof world>) => void, effect: AcpSteerEffect) {
		const d = deferredSeam();
		const w = world({ seam: d.seam });
		const pending = w.send();
		await d.reached;
		change(w);
		d.answer(effect);
		await pending;
		return w;
	}
	const SKIPPED = {
		success: true,
		data: { boundary: "steer-in-turn", record: "skipped-binding-changed", wants_reply: true },
		error: undefined,
	};
	const STALE = { success: false, data: undefined, error: "target-stale" };

	it("[QK:CONTROL-STEER-AFTER-AWAIT-BOUND] a binding swap during the await: nothing reaches the new target — injected is answered skipped-binding-changed, a fallback is target-stale", async () => {
		const swap = (w: ReturnType<typeof world>) => {
			w.state.binding = { nativeSessionId: "N-B" };
		};
		const inj = await changedDuringAwait(swap, { effect: "injected" });
		expect([inj.sent, inj.entries, inj.responses]).toEqual([[], [], [SKIPPED]]);
		const fb = await changedDuringAwait(swap, { effect: "prompt-required" });
		expect([fb.sent, fb.entries, fb.responses]).toEqual([[], [], [STALE]]);
		// SOL O2: the same binding object, but the context or the native session id moved on.
		for (const drift of [
			(w: ReturnType<typeof world>) => {
				w.state.context = { name: "ctx-B" };
			},
			(w: ReturnType<typeof world>) => {
				w.state.sessionId = "N-B";
			},
		]) {
			const i = await changedDuringAwait(drift, { effect: "injected" });
			expect([i.sent, i.entries, i.responses]).toEqual([[], [], [SKIPPED]]);
			const f = await changedDuringAwait(drift, { effect: "prompt-required" });
			expect([f.sent, f.entries, f.responses]).toEqual([[], [], [STALE]]);
		}
	});

	it("[QK:CONTROL-STEER-AFTER-AWAIT-CLOSING] a close or retire during the await: the same — no queue, no record on a session that is going away", async () => {
		const close = (w: ReturnType<typeof world>) => {
			w.state.closing = true;
		};
		const inj = await changedDuringAwait(close, { effect: "injected" });
		expect([inj.sent, inj.entries, inj.responses]).toEqual([[], [], [SKIPPED]]);
		const fb = await changedDuringAwait(close, { effect: "not-sent", reason: "no-busy-window" });
		expect([fb.sent, fb.entries, fb.responses]).toEqual([[], [], [STALE]]);
	});

	it("[QK:CONTROL-STEER-AFTER-AWAIT-COMPACTING] same binding, a compaction began during the await: injected is still recorded once; a fallback is refused with the guard's own reason and nothing queued", async () => {
		const inj = deferredSeam();
		const a = world({ seam: inj.seam });
		const p1 = a.send();
		await inj.reached;
		noteCompactionBefore(a.state.compaction);
		inj.answer({ effect: "injected" });
		await p1;
		expect(a.entries).toHaveLength(1);
		expect(a.responses[0]).toMatchObject({ success: true, data: { boundary: "steer-in-turn", record: "ok" } });

		const fb = deferredSeam();
		const b = world({ seam: fb.seam });
		const p2 = b.send();
		await fb.reached;
		noteCompactionBefore(b.state.compaction);
		fb.answer({ effect: "prompt-required" });
		await p2;
		expect(b.sent).toEqual([]);
		expect(b.responses).toEqual([{ success: false, data: undefined, error: "compacting" }]);
	});

	it("[QK:CONTROL-STEER-AFTER-AWAIT-IDLE] same binding, the turn ended during the await: the fallback re-reads idle and sends a direct trigger answered sent — not steer options with a queued-steer receipt", async () => {
		const d = deferredSeam();
		const w = world({ seam: d.seam });
		const pending = w.send();
		await d.reached;
		w.state.idle = true;
		d.answer({ effect: "prompt-required" });
		await pending;
		expect(w.sent).toEqual([{ content: "MSG+sender", options: { triggerTurn: true } }]);
		expect(w.responses[0]).toMatchObject({ success: true, data: { boundary: "sent" } });
	});
});
