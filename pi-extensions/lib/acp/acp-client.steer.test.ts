/**
 * #163 S7: the ONE steer request — params, the answer's three readings, and the answer bound.
 *
 * Oracles are the adapter's measured wire frames, copied here as literals (adapter probe raw
 * `/tmp/ff08d4-next/issue163-probe-raw/cell-{A,C}.ndjson`, claude-agent-acp 0.107.0, 2026-11-15):
 *   steer-sent   {"sessionId":…,"prompt":[{"type":"text","text":…}],"_meta":{"steering":{"idleBehavior":"promptRequired"}}}
 *   steer-answer {"outcome":"injected"}                                  (cell A, busy prompt)
 *   steer-answer {"outcome":"promptRequired","reason":"noRunningTurn"}   (cell C, idle)
 * The connection is a scripted fake; nothing spawns an adapter or reaches a network.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { ACP_STEER_ANSWER_TIMEOUT_MS, type AcpSteerParams, requestAcpSteer } from "./acp-client.ts";

const CELL_A_INJECTED = { outcome: "injected" };
const CELL_C_PROMPT_REQUIRED = { outcome: "promptRequired", reason: "noRunningTurn" };

function fake(answer: () => Promise<unknown>) {
	const sent: AcpSteerParams[] = [];
	const cancel = vi.fn();
	const close = vi.fn();
	return {
		sent,
		cancel,
		close,
		conn: {
			steer: (params: AcpSteerParams) => {
				sent.push(params);
				return answer();
			},
			cancel,
			close,
		},
	};
}

afterEach(() => {
	vi.useRealTimers();
});

describe("requestAcpSteer", () => {
	it("[QK:ACP-STEER-PROMPT-REQUIRED-ALWAYS] every steer carries idleBehavior promptRequired, so an idle backend never starts a detached turn", async () => {
		const f = fake(async () => CELL_A_INJECTED);
		await requestAcpSteer(f.conn, "7ff058c3-5911-4575-98cf-700827632bd1", "MARKER 512e2ddf");
		expect(f.sent).toEqual([
			{
				sessionId: "7ff058c3-5911-4575-98cf-700827632bd1",
				prompt: [{ type: "text", text: "MARKER 512e2ddf" }],
				_meta: { steering: { idleBehavior: "promptRequired" } },
			},
		]);
	});

	it("[QK:ACP-STEER-INJECTED-SHAPE] the two measured answers read as injected and promptRequired, exactly one request each", async () => {
		const a = fake(async () => CELL_A_INJECTED);
		expect(await requestAcpSteer(a.conn, "s", "t")).toEqual({ kind: "injected" });
		const c = fake(async () => CELL_C_PROMPT_REQUIRED);
		expect(await requestAcpSteer(c.conn, "s", "t")).toEqual({ kind: "promptRequired" });
		expect(a.sent).toHaveLength(1);
		expect(c.sent).toHaveLength(1);
	});

	it("[QK:ACP-STEER-ANSWER-FENCED] startedNewTurn, an unknown outcome and a non-object answer are unrecognized — a value, never a throw and never injected", async () => {
		for (const answer of [{ outcome: "startedNewTurn" }, { outcome: "queued" }, null, "injected", [CELL_A_INJECTED]]) {
			const f = fake(async () => answer);
			const r = await requestAcpSteer(f.conn, "s", "t");
			expect(r.kind).toBe("unrecognized");
		}
		const err = fake(async () => {
			throw new Error("Session not found");
		});
		expect(await requestAcpSteer(err.conn, "s", "t")).toEqual({ kind: "rejected", detail: "Session not found" });
	});

	it("[QK:ACP-STEER-TIMEOUT-LATE-QUIET] with no answer the call settles as timeout at the bound; a late answer changes nothing, and the prompt is never cancelled or torn down", async () => {
		vi.useFakeTimers();
		let lateResolve: (v: unknown) => void = () => {};
		const late = fake(() => new Promise((res) => (lateResolve = res)));
		let result: unknown;
		void requestAcpSteer(late.conn, "s", "t").then((r) => (result = r));
		await vi.advanceTimersByTimeAsync(ACP_STEER_ANSWER_TIMEOUT_MS - 1);
		expect(result).toBeUndefined();
		await vi.advanceTimersByTimeAsync(1);
		expect(result).toMatchObject({ kind: "timeout" });
		lateResolve(CELL_A_INJECTED);
		await vi.advanceTimersByTimeAsync(10);
		expect(result).toMatchObject({ kind: "timeout" });
		expect(late.sent).toHaveLength(1);
		expect(late.cancel).not.toHaveBeenCalled();
		expect(late.close).not.toHaveBeenCalled();
	});

	it("[QK:ACP-STEER-LATE-REJECT-QUIET] a rejection that arrives after the bound is swallowed — no unhandled rejection, no second outcome, no cancel or teardown", async () => {
		vi.useFakeTimers();
		const unhandled: unknown[] = [];
		const onUnhandled = (reason: unknown) => unhandled.push(reason);
		process.on("unhandledRejection", onUnhandled);
		try {
			let lateReject: (e: unknown) => void = () => {};
			const rej = fake(() => new Promise((_res, reject) => (lateReject = reject)));
			let r2: unknown;
			void requestAcpSteer(rej.conn, "s", "t").then((r) => (r2 = r));
			await vi.advanceTimersByTimeAsync(ACP_STEER_ANSWER_TIMEOUT_MS);
			expect(r2).toMatchObject({ kind: "timeout" });
			lateReject(new Error("connection closed"));
			await vi.advanceTimersByTimeAsync(10);
			vi.useRealTimers();
			await new Promise((res) => setImmediate(res));
			await new Promise((res) => setImmediate(res));
			expect(r2).toMatchObject({ kind: "timeout" });
			expect(unhandled).toEqual([]);
			expect(rej.cancel).not.toHaveBeenCalled();
			expect(rej.close).not.toHaveBeenCalled();
		} finally {
			process.off("unhandledRejection", onUnhandled);
		}
	});

	it("a connection without a steer method is refused by name before anything is sent", async () => {
		await expect(requestAcpSteer({}, "s", "t")).rejects.toThrow(/has no steer method/);
	});
});
