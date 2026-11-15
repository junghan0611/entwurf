/**
 * #163 S8: one prompt's record of the ACP child's own compactions — the pure collector.
 *
 * Oracle frames. Each test says which of these it uses:
 *   C2 (measured, claude-agent-acp 0.107.0 with `clientCapabilities.session.compaction = {}`,
 *   `/tmp/ff08d4-next/s8-probe-raw/cell-C2-r1.ndjson`):
 *     compaction_update {compactionId, status:"in_progress"}
 *     compaction_update {compactionId, status:"completed", summary:[{text}]}
 *     compaction_update {compactionId, status:"completed"}            (repeat, no summary)
 *     usage_update {used: 3669, size: 1000000}
 *   SYNTHETIC (not measured; shapes read from context-compaction.js:202-325): failed + error,
 *   cancelled, chunk-only summary, terminal-only, two compactions in one prompt, used 0.
 * The summary text here is a marker, not the measured 1,491-character summary.
 */
import { describe, expect, it } from "vitest";
import { AcpCompactionCollector, type AcpCompactionRecord, isCompactCommand } from "./compaction-record.ts";

const ID = "e54b9562-d1a0-462c-be49-88001e838e0c";
const SUMMARY = "1. Primary Request and Intent:\n   - SUMMARY-MARK-8812 한글 ✓\n";

function inProgress(id = ID) {
	return { sessionUpdate: "compaction_update", compactionId: id, status: "in_progress" };
}
function completed(id = ID, summary?: string) {
	return {
		sessionUpdate: "compaction_update",
		compactionId: id,
		status: "completed",
		...(summary !== undefined ? { summary: [{ type: "text", text: summary }] } : {}),
	};
}
function chunk(text: string, id = ID) {
	return { sessionUpdate: "compaction_summary_chunk", compactionId: id, content: { type: "text", text } };
}

/** A collector on a clock the test moves by 1000 ms per tick. */
function world(opts: { collect?: boolean; compact?: boolean; carried?: number } = {}) {
	let t = Date.UTC(2026, 10, 15, 6, 0, 0);
	const lines: string[] = [];
	const c = new AcpCompactionCollector({
		collect: opts.collect ?? true,
		promptWasCompactCommand: opts.compact ?? false,
		carried: opts.carried,
		now: () => {
			t += 1000;
			return t;
		},
		emitLine: (text) => lines.push(text),
	});
	c.windowOpen = true;
	return { c, lines };
}

/** The measured C2 sequence. */
function c2(c: AcpCompactionCollector) {
	c.onUsage(17884);
	c.onUpdate(inProgress());
	c.onUpdate(completed(ID, SUMMARY));
	c.onUpdate(completed(ID));
	c.onUsage(3669);
}

describe("ACP compaction record — the collector (#163 S8)", () => {
	it("[QK:ACP-COMPACT-RECORD-ONCE] the measured C2 sequence — start, terminal with summary, a repeated terminal — gives one record; a later terminal only fills what is empty", () => {
		const { c } = world();
		c2(c);
		const records = c.close();
		expect(records).toHaveLength(1);
		expect(records[0]).toMatchObject({ compactionId: ID, status: "completed", summary: SUMMARY });
		const late = world();
		late.c.onUpdate(inProgress());
		late.c.onUpdate(completed(ID));
		late.c.onUpdate({ ...completed(ID, "LATE"), status: "failed", error: "late" });
		const [r] = late.c.close();
		expect(r.status).toBe("completed");
		expect(r.summary).toBe("LATE");
		expect(r.error).toBeUndefined();
	});

	it("[QK:ACP-COMPACT-RECORD-SAME-SHAPE] a compaction in a /compact prompt and one in an ordinary prompt leave the same shape; only the observed command flag differs", () => {
		const a = world({ compact: false });
		c2(a.c);
		const b = world({ compact: true });
		c2(b.c);
		const [ra] = a.c.close();
		const [rb] = b.c.close();
		expect(Object.keys(ra).sort()).toEqual(Object.keys(rb).sort());
		expect([ra.promptWasCompactCommand, rb.promptWasCompactCommand]).toEqual([false, true]);
		const { promptWasCompactCommand: _a, ...restA } = ra;
		const { promptWasCompactCommand: _b, ...restB } = rb;
		expect(restA).toEqual(restB);
		expect(isCompactCommand("/compact")).toBe(true);
		expect(isCompactCommand("  /compact keep the API notes ")).toBe(true);
		expect(isCompactCommand("/compactly")).toBe(false);
		expect(isCompactCommand("please /compact")).toBe(false);
	});

	it("[QK:ACP-COMPACT-STATUS-HONEST] failed and cancelled are the adapter's own; no terminal is unterminated, never cancelled; a first completed is not rewritten", () => {
		const failed = world();
		failed.c.onUpdate(inProgress());
		failed.c.onUpdate({ ...completed(), status: "failed", error: "Conversation too short\nto compact" });
		const cancelled = world();
		cancelled.c.onUpdate(inProgress());
		cancelled.c.onUpdate({ ...completed(), status: "cancelled" });
		const open = world();
		open.c.onUpdate(inProgress());
		const kept = world();
		kept.c.onUpdate(inProgress());
		kept.c.onUpdate(completed(ID, SUMMARY));
		kept.c.onUpdate({ ...completed(), status: "cancelled" });
		const [f] = failed.c.close();
		const [x] = cancelled.c.close();
		const [u] = open.c.close();
		const [k] = kept.c.close();
		expect([f.status, f.error, f.summary]).toEqual(["failed", "Conversation too short to compact", undefined]);
		expect([x.status, x.summary]).toEqual(["cancelled", undefined]);
		expect([u.status, u.endedObservedAt, u.observedIntervalMs]).toEqual(["unterminated", null, null]);
		expect(k.status).toBe("completed");
	});

	it("[QK:ACP-COMPACT-PROVENANCE] observed values carry their source and time; terminal-only has no start; 0 after is null; two compactions keep their own after", () => {
		const { c } = world({ carried: 900_000 });
		c.onUpdate(completed("A")); // terminal-only, before taken from the carried value
		c.onUpdate(inProgress("B")); // B starts before any usage: A's after is decided as none
		c.onUpdate(completed("B"));
		c.onUsage(0); // the adapter's fallback when it had no post count
		c.onUpdate(inProgress("C"));
		c.onUpdate(completed("C"));
		c.onUsage(4000);
		const [a, b, cc] = c.close();
		expect(a.tokensBefore).toEqual({ value: 900_000, source: "carried", observedAt: null });
		expect([a.startedObservedAt, a.observedIntervalMs, a.tokensAfter]).toEqual([null, null, null]);
		expect(b.tokensAfter).toBeNull();
		expect(typeof b.observedIntervalMs).toBe("number");
		expect(cc.tokensAfter).toMatchObject({ value: 4000, source: "usage_update" });
		expect(typeof cc.tokensAfter?.observedAt).toBe("string");
		const measured = world();
		c2(measured.c);
		const [m] = measured.c.close();
		expect(m.tokensBefore).toMatchObject({ value: 17884, source: "usage_update" });
		expect(m.tokensAfter).toMatchObject({ value: 3669, source: "usage_update" });
		expect(m.observedIntervalMs).toBe(1000);
	});

	it("[QK:ACP-COMPACT-SUMMARY-ASSEMBLY] terminal summary wins and chunks are not added to it; chunks alone are joined verbatim; neither leaves no summary; each says its source", () => {
		const both = world();
		both.c.onUpdate(inProgress());
		both.c.onUpdate(chunk("1. Primary"));
		both.c.onUpdate(chunk(" Request\n"));
		both.c.onUpdate(completed(ID, SUMMARY));
		const chunksOnly = world();
		chunksOnly.c.onUpdate(inProgress());
		chunksOnly.c.onUpdate(chunk("1. Primary"));
		chunksOnly.c.onUpdate(chunk(" Request\n한글 ✓\n"));
		chunksOnly.c.onUpdate(completed(ID));
		const terminal = world();
		terminal.c.onUpdate(inProgress());
		terminal.c.onUpdate(completed(ID, SUMMARY));
		const none = world();
		none.c.onUpdate(inProgress());
		none.c.onUpdate(completed(ID));
		const big = world();
		const large = `${"요약 line\n".repeat(12_000)}END`;
		big.c.onUpdate(inProgress());
		big.c.onUpdate(completed(ID, large));
		const pick = (r: AcpCompactionRecord) => [r.summary, r.summarySource, r.summaryChars];
		expect(pick(both.c.close()[0])).toEqual([SUMMARY, "terminal", SUMMARY.length]);
		const joined = "1. Primary Request\n한글 ✓\n";
		expect(pick(chunksOnly.c.close()[0])).toEqual([joined, "chunks", joined.length]);
		expect(pick(terminal.c.close()[0])).toEqual([SUMMARY, "terminal", SUMMARY.length]);
		expect(pick(none.c.close()[0])).toEqual([undefined, undefined, undefined]);
		expect(pick(big.c.close()[0])).toEqual([large, "terminal", large.length]);
	});

	it("[QK:ACP-COMPACT-LINE-FROM-UPDATE] the line waits for `after`: none at the terminal, one at the next usage carrying the record's own after; 0 decides at once; a window close still says it", () => {
		const m = world();
		m.c.onUsage(17884);
		m.c.onUpdate(inProgress());
		m.c.onUpdate(completed(ID, SUMMARY));
		m.c.onUpdate(completed(ID));
		expect(m.lines).toEqual([]);
		m.c.onUsage(3669);
		expect(m.lines).toEqual(["compaction completed 18k→4k, 1.0s observed"]);
		const [rec] = m.c.close();
		expect(rec.tokensAfter?.value).toBe(3669);
		expect(m.lines).toHaveLength(1);

		const zero = world();
		zero.c.onUsage(17884);
		zero.c.onUpdate(inProgress());
		zero.c.onUpdate(completed(ID));
		zero.c.onUsage(0);
		expect(zero.lines).toEqual(["compaction completed from 18k, 1.0s observed"]);
		zero.c.onUsage(3669);
		expect(zero.lines).toHaveLength(1);
		expect(zero.c.close()[0].tokensAfter).toBeNull();

		const closing = world({ compact: true });
		closing.c.onUpdate(inProgress());
		closing.c.onUpdate(completed(ID));
		expect(closing.lines).toEqual([]);
		closing.c.close();
		expect(closing.lines).toEqual(["compaction completed, 1.0s observed, after /compact"]);

		const next = world();
		next.c.onUsage(17884);
		next.c.onUpdate(completed("A"));
		next.c.onUpdate(inProgress("B"));
		expect(next.lines).toEqual(["compaction completed from 18k"]);
		for (const line of [...m.lines, ...zero.lines, ...closing.lines, ...next.lines]) {
			expect(line).not.toContain("SUMMARY-MARK");
			expect(line.length).toBeLessThan(120);
		}
	});

	it("out of scope (collect: false) the line still goes out but no record is returned", () => {
		const w = world({ collect: false });
		c2(w.c);
		expect(w.c.close()).toEqual([]);
		expect(w.lines).toHaveLength(1);
		expect(w.c.observedCount).toBe(1);
	});
});
