/**
 * vendor-compaction — #175 A1: after a Pi compaction, the vendor session compacts itself too.
 *
 * Pi's compaction changes only what Pi shows a provider (#171 decision 16); the vendor session keeps
 * everything it holds and its occupancy keeps growing. So before the first input after a Pi compaction
 * boundary, the same vendor session (resumed or reused, under the same lease) is sent one prompt whose
 * only block is the adapter's `compactCommand`. The vendor compacts its own transcript: Pi's summary is
 * never sent and no transcript is rebuilt (AGENTS Rule 9), and the vendor session id does not change.
 *
 * This file is pure: what to ask, and how to read the answer. backend.ts owns the wire and the record.
 *
 * Decisions this encodes (GLG, #175 2026-11-25):
 *   - D-3, symmetric (α): `end_turn` is the command's end for every backend. A Claude report of a
 *     completed compaction inside that prompt makes the effect `confirmed`; none makes it
 *     `unconfirmed` (agy never reports one). A conflicting report (a failed or cancelled compaction, or
 *     one that started and never ended) is not accepted.
 *   - A request that was not accepted is asked again on the next provider call, whatever started it;
 *     never twice within one call. A compaction may therefore run twice.
 */

import type { DeltaWalk } from "./branch-gate.js";
import type { VendorCompaction } from "./session-store.js";

/** What a turn asks of the vendor before its input. */
export type VendorCompactionPlan =
	| { ask: false }
	| {
			ask: true;
			/** The latest Pi compaction entry after the anchor: the boundary this request is for. */
			compactionEntryId: string;
			/** The anchor answer's stored `usage.totalTokens` (the vendor's occupancy when it last
			 *  answered), for the no-shrink diagnostic; undefined when it is absent or 0. */
			anchorUsedTokens: number | undefined;
	  }
	/** A compaction entry that names no id cannot key a request: the turn stops, nothing is sent. */
	| { ask: "stop"; why: string };

/**
 * Plan from a walk that passed. The slot suppresses only when it is `done` for this very boundary on
 * this very vendor session; any other value it holds (an older boundary, another vendor id, a `sent`)
 * is simply not a match — never a reason to refuse the turn.
 */
export function planVendorCompaction(
	walk: Extract<DeltaWalk, { ok: true }>,
	slot: VendorCompaction | undefined,
	acpSessionId: string,
): VendorCompactionPlan {
	if (!walk.compacted) return { ask: false };
	const compactionEntryId = walk.compacted.entryId;
	if (compactionEntryId === undefined) return { ask: "stop", why: "a compaction entry without an id" };
	if (slot?.state === "done" && slot.compactionEntryId === compactionEntryId && slot.acpSessionId === acpSessionId) {
		return { ask: false };
	}
	const total = (walk.anchor as { usage?: { totalTokens?: unknown } } | undefined)?.usage?.totalTokens;
	return {
		ask: true,
		compactionEntryId,
		anchorUsedTokens: typeof total === "number" && Number.isFinite(total) && total > 0 ? total : undefined,
	};
}

/**
 * The compaction reports one `/compact` prompt carried, by id: started, and its terminal. The same
 * terminal repeated is one report (Claude sends `completed` twice, measured d3); two different
 * terminals for one id are a conflict that stays, whatever their order (D-3: fail closed). This is
 * the dispatch verdict only: the display record keeps its own first-terminal rule (compaction-record.ts).
 */
export class VendorCompactionEvidence {
	private readonly started = new Set<string>();
	private readonly terminal = new Map<string, string>();
	private conflicting: string | undefined;

	/** A `compaction_update` inside the prompt window (anything else is not evidence). */
	onUpdate(update: Record<string, unknown>): void {
		if (update.sessionUpdate !== "compaction_update") return;
		const id = update.compactionId;
		if (typeof id !== "string" || id === "") return;
		const status = update.status;
		if (status === "in_progress") this.started.add(id);
		else if (typeof status === "string") {
			const first = this.terminal.get(id);
			if (first === undefined) this.terminal.set(id, status);
			else if (first !== status) this.conflicting ??= `the agent reported its compaction ${first}, then ${status}`;
		}
	}

	/** `confirmed`, `none` (no report at all) or the conflict that refuses the answer. */
	read(): { kind: "confirmed" } | { kind: "none" } | { kind: "conflict"; why: string } {
		if (this.conflicting !== undefined) return { kind: "conflict", why: this.conflicting };
		for (const [id, status] of this.terminal) {
			if (status !== "completed") return { kind: "conflict", why: `the agent reported its compaction ${status}` };
			this.started.delete(id);
		}
		if (this.started.size > 0) return { kind: "conflict", why: "the agent's compaction started and did not end" };
		return this.terminal.size > 0 ? { kind: "confirmed" } : { kind: "none" };
	}
}

/** How one `/compact` prompt ended, read with what its window carried. */
export type VendorCompactionVerdict =
	| { kind: "done"; effect: "confirmed" | "unconfirmed" }
	/** The agent answered and said it did not complete: the session is kept. */
	| { kind: "failed"; why: string }
	/** No accepted outcome. `answered`: the agent ended the prompt (its session is kept); otherwise the
	 *  session cannot be trusted and is closed. */
	| { kind: "unknown"; why: string; answered: boolean };

const ANSWERED_NOT_DONE: ReadonlySet<string> = new Set(["cancelled", "refusal", "max_tokens", "max_turn_requests"]);

export function judgeVendorCompaction(
	stopReason: unknown,
	evidence: VendorCompactionEvidence,
): VendorCompactionVerdict {
	if (stopReason === "end_turn") {
		const read = evidence.read();
		if (read.kind === "conflict") return { kind: "unknown", why: read.why, answered: true };
		return { kind: "done", effect: read.kind === "confirmed" ? "confirmed" : "unconfirmed" };
	}
	if (typeof stopReason === "string" && ANSWERED_NOT_DONE.has(stopReason)) {
		return { kind: "failed", why: `the agent ended its compaction request with ${stopReason}` };
	}
	return {
		kind: "unknown",
		why:
			typeof stopReason === "string"
				? "the agent ended its compaction request with an unrecognized reason"
				: "the agent ended its compaction request without a stop reason",
		answered: false,
	};
}

/** The no-shrink line: diagnostic only (no retry, no stop, no state change); null when not shown. */
export function noShrinkDiagnostic(anchorUsedTokens: number | undefined, firstUsed: number | undefined): string | null {
	if (anchorUsedTokens === undefined || typeof firstUsed !== "number") return null;
	if (firstUsed < 0.9 * anchorUsedTokens) return null;
	return `[acp] vendor compaction: the first answer after it used ${firstUsed} tokens of the ${anchorUsedTokens} before; no shrink observed (effect unconfirmed)\n`;
}
