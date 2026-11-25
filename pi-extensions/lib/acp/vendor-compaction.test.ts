/**
 * #175 A1 — what a turn asks of the vendor after a Pi compaction, and how it reads the answer.
 *
 * Oracles: Pi's own SessionManager builds every branch (the compaction entries, their ids and the
 * tree moves are Pi's), and the GLG decisions of 2026-11-25 (D-3 symmetric (α); retry on the next
 * call) fix the verdict table. The wire and the record are proved in backend.thinking.test.ts.
 */

import type { AssistantMessage } from "@earendil-works/pi-ai";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { expect, it } from "vitest";
import { walkDelta } from "./branch-gate.ts";
import type { VendorCompaction } from "./session-store.ts";
import {
	judgeVendorCompaction,
	noShrinkDiagnostic,
	planVendorCompaction,
	VendorCompactionEvidence,
} from "./vendor-compaction.ts";

const T0 = "entwurf-turn:anchor";

function answer(responseId: string, totalTokens: number, stopReason: "stop" | "error" = "stop"): AssistantMessage {
	return {
		role: "assistant",
		content: [{ type: "text", text: "ok" }],
		api: "entwurf",
		provider: "entwurf",
		model: "claude-sonnet-5-5",
		usage: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason,
		responseId,
		timestamp: 1,
	};
}

function passed(branch: unknown[]) {
	const walk = walkDelta(T0, branch);
	if (!walk.ok) throw new Error(`walk stopped: ${walk.why}`);
	return walk;
}

const slot = (compactionEntryId: string, state: "sent" | "done", acpSessionId = "ACP-1"): VendorCompaction => ({
	compactionEntryId,
	acpSessionId,
	state,
	...(state === "done" ? { effect: "confirmed" as const } : {}),
});

it("[QK:ACP-VENDOR-COMPACT-PLAN] the latest compaction after the anchor is asked for unless done holds for it on this vendor session; a record without the slot asks once more (reader skew); no compaction asks nothing", () => {
	const pi = SessionManager.inMemory();
	pi.appendMessage({ role: "user", content: "seed", timestamp: 0 });
	pi.appendMessage(answer(T0, 120_000));
	const plain = passed([...pi.getBranch()]);
	expect(planVendorCompaction(plain, undefined, "ACP-1")).toEqual({ ask: false });
	const c1 = pi.appendCompaction("SUM-1", null, 10);
	const c2 = pi.appendCompaction("SUM-2", null, 10);
	pi.appendMessage({ role: "user", content: "next", timestamp: 2 });
	const walk = passed([...pi.getBranch()]);
	const asked = { ask: true, compactionEntryId: c2, anchorUsedTokens: 120_000 };
	// No slot: what an older reader leaves after it rewrote the record. One more request goes out.
	expect(planVendorCompaction(walk, undefined, "ACP-1")).toEqual(asked);
	expect(planVendorCompaction(walk, slot(c2, "sent"), "ACP-1")).toEqual(asked);
	expect(planVendorCompaction(walk, slot(c1, "done"), "ACP-1")).toEqual(asked);
	expect(planVendorCompaction(walk, slot(c2, "done", "ACP-OTHER"), "ACP-1")).toEqual(asked);
	expect(planVendorCompaction(walk, slot(c2, "done"), "ACP-1")).toEqual({ ask: false });
	// A compaction entry that names no id cannot key a request.
	const branch = [...pi.getBranch()].map((e) => ((e as { id: string }).id === c2 ? { ...e, id: undefined } : e));
	expect(planVendorCompaction(passed(branch), undefined, "ACP-1")).toEqual({
		ask: "stop",
		why: "a compaction entry without an id",
	});
	// An anchor whose answer reported no occupancy gives the diagnostic nothing to compare with.
	const bare = SessionManager.inMemory();
	bare.appendMessage({ role: "user", content: "seed", timestamp: 0 });
	bare.appendMessage(answer(T0, 0));
	const c3 = bare.appendCompaction("SUM", null, 10);
	expect(planVendorCompaction(passed([...bare.getBranch()]), undefined, "ACP-1")).toEqual({
		ask: true,
		compactionEntryId: c3,
		anchorUsedTokens: undefined,
	});
});

it("[QK:ACP-VENDOR-COMPACT-SINGLE-SLOT] one slot, not a lifetime ledger: after the slot moves to a later boundary, a Pi branch back to the earlier one asks for it again", () => {
	const pi = SessionManager.inMemory();
	pi.appendMessage({ role: "user", content: "seed", timestamp: 0 });
	// Pi keeps the anchor in both compactions, so no input after it is compacted away.
	const anchorId = pi.appendMessage(answer(T0, 120_000));
	const c1 = pi.appendCompaction("SUM-1", anchorId, 10);
	pi.appendMessage({ role: "user", content: "first", timestamp: 2 });
	// The input after C1 never got an answer (its turn failed), so the anchor stays before C1.
	const failedId = pi.appendMessage(answer("entwurf-turn:failed", 0, "error"));
	const c2 = pi.appendCompaction("SUM-2", anchorId, 10);
	pi.appendMessage({ role: "user", content: "second", timestamp: 3 });
	expect(planVendorCompaction(passed([...pi.getBranch()]), undefined, "ACP-1")).toMatchObject({
		ask: true,
		compactionEntryId: c2,
	});
	// Done for C2. The operator moves the Pi tree back to before C2 and continues from there.
	pi.branch(failedId);
	pi.appendMessage({ role: "user", content: "other way", timestamp: 4 });
	expect(planVendorCompaction(passed([...pi.getBranch()]), slot(c2, "done"), "ACP-1")).toMatchObject({
		ask: true,
		compactionEntryId: c1,
	});
});

it("[QK:ACP-VENDOR-COMPACT-VERDICT] end_turn is the command's end: a completed report confirms, none leaves it unconfirmed, a conflicting one is unknown; other answers fail with the session kept; no reason, or an unknown one, is unknown with the session closed", () => {
	const ev = (...frames: Array<[string, string]>) => {
		const e = new VendorCompactionEvidence();
		for (const [id, status] of frames) e.onUpdate({ sessionUpdate: "compaction_update", compactionId: id, status });
		// Not evidence: another kind of update, and a summary chunk.
		e.onUpdate({ sessionUpdate: "usage_update", used: 10 });
		e.onUpdate({ sessionUpdate: "compaction_summary_chunk", compactionId: "z", content: { type: "text", text: "x" } });
		return e;
	};
	expect(judgeVendorCompaction("end_turn", ev(["a", "in_progress"], ["a", "completed"], ["a", "completed"]))).toEqual({
		kind: "done",
		effect: "confirmed",
	});
	expect(judgeVendorCompaction("end_turn", ev())).toEqual({ kind: "done", effect: "unconfirmed" });
	for (const status of ["failed", "cancelled"]) {
		expect(judgeVendorCompaction("end_turn", ev(["a", "in_progress"], ["a", status]))).toEqual({
			kind: "unknown",
			why: `the agent reported its compaction ${status}`,
			answered: true,
		});
	}
	// A later `completed` does not repair a `failed`.
	expect(judgeVendorCompaction("end_turn", ev(["a", "failed"], ["a", "completed"])).kind).toBe("unknown");
	// A completed one beside one that failed is still a conflict.
	expect(judgeVendorCompaction("end_turn", ev(["a", "completed"], ["b", "failed"])).kind).toBe("unknown");
	expect(judgeVendorCompaction("end_turn", ev(["a", "in_progress"]))).toEqual({
		kind: "unknown",
		why: "the agent's compaction started and did not end",
		answered: true,
	});
	for (const reason of ["cancelled", "refusal", "max_tokens", "max_turn_requests"]) {
		expect(judgeVendorCompaction(reason, ev(["a", "completed"]))).toEqual({
			kind: "failed",
			why: `the agent ended its compaction request with ${reason}`,
		});
	}
	expect(judgeVendorCompaction("something-new", ev())).toMatchObject({ kind: "unknown", answered: false });
	expect(judgeVendorCompaction(undefined, ev())).toMatchObject({ kind: "unknown", answered: false });
});

it("[QK:ACP-VENDOR-COMPACT-NO-SHRINK] the no-shrink line needs the anchor's occupancy and a report, and shows at 90% of it or more", () => {
	expect(noShrinkDiagnostic(100_000, 90_000)).toContain("used 90000 tokens of the 100000 before");
	expect(noShrinkDiagnostic(100_000, 89_999)).toBeNull();
	expect(noShrinkDiagnostic(undefined, 95_000)).toBeNull();
	expect(noShrinkDiagnostic(100_000, undefined)).toBeNull();
});

it("[QK:ACP-VENDOR-COMPACT-CONFLICT-STICKY] two different terminals for one compaction stay a conflict in either order; the same terminal repeated is one report", () => {
	const ev = (...frames: Array<[string, string]>) => {
		const e = new VendorCompactionEvidence();
		for (const [id, status] of frames) e.onUpdate({ sessionUpdate: "compaction_update", compactionId: id, status });
		return e;
	};
	for (const later of ["failed", "cancelled"]) {
		expect(judgeVendorCompaction("end_turn", ev(["a", "in_progress"], ["a", "completed"], ["a", later]))).toEqual({
			kind: "unknown",
			why: `the agent reported its compaction completed, then ${later}`,
			answered: true,
		});
		// The reverse order is the same conflict.
		expect(judgeVendorCompaction("end_turn", ev(["a", "in_progress"], ["a", later], ["a", "completed"]))).toEqual({
			kind: "unknown",
			why: `the agent reported its compaction ${later}, then completed`,
			answered: true,
		});
		// Repeats after the conflict do not clear it.
		expect(
			judgeVendorCompaction("end_turn", ev(["a", "completed"], ["a", later], ["a", "completed"], ["a", "completed"]))
				.kind,
		).toBe("unknown");
	}
	// Measured (d3): Claude sends `completed` twice for one compaction. One report, confirmed.
	expect(judgeVendorCompaction("end_turn", ev(["a", "in_progress"], ["a", "completed"], ["a", "completed"]))).toEqual({
		kind: "done",
		effect: "confirmed",
	});
});
