/**
 * compaction-record — one prompt's record of the ACP child's own compactions (#163 S8).
 *
 * Design: /tmp/ff08d4-next/s8-design.v5-final.md + v5.1/v5.2 addenda (GLG-approved 2026-11-15).
 * With the client capability `session.compaction` declared, claude-agent-acp 0.107.0 reports a
 * compaction as `compaction_update {compactionId, status}` (+ `summary` on the terminal, or
 * `compaction_summary_chunk` stream) and the occupancy around it as `usage_update.used`
 * (measured: probe cell C2). It does NOT give a non-AIR client the cause, pre/post tokens or the
 * duration (`context-compaction.js:318-321`), so this record states what Entwurf OBSERVED, with
 * where and when, and null where nothing was observed. Nothing here is a backend-reported figure
 * unless named so.
 *
 * The record is information, not context: it is written as a plain custom entry by the provider
 * and is never read back into a model context, a prompt or a backend session (AGENTS Rule 9).
 *
 * Pure: no IO, no clock of its own (the caller passes `now`), and the display line goes out
 * through the caller's `emitLine`.
 */

export const ACP_COMPACTION_ENTRY_TYPE = "entwurf-acp-compaction";

export type AcpCompactionStatus = "completed" | "failed" | "cancelled" | "unterminated";

export interface ObservedTokens {
	value: number;
	/** `usage_update`: seen in this prompt. `carried`: the previous turn's last occupancy. */
	source: "usage_update" | "carried";
	/** When it was observed; null for a carried value whose observation time is not kept. */
	observedAt: string | null;
}

export interface AcpCompactionRecord {
	v: 1;
	compactionId: string;
	/** The adapter's own terminal status; `unterminated` means only that no terminal was observed. */
	status: AcpCompactionStatus;
	/** Observed fact: the first block of this prompt's user delta was a `/compact` command. Not a cause. */
	promptWasCompactCommand: boolean;
	/** #175: `prelude` when the prompt was Entwurf's own lone `/compact`, sent before this turn's input
	 *  after a Pi compaction. Absent for a compaction inside the turn's own prompt. */
	source?: "prelude";
	startedObservedAt: string | null;
	endedObservedAt: string | null;
	/** Receipt interval between the two, not a backend-reported duration. */
	observedIntervalMs: number | null;
	/** The last occupancy observed before this compaction's first update. */
	tokensBefore: ObservedTokens | null;
	/** The first non-zero `usage_update.used` after this compaction's terminal and before the next
	 * compaction's first update — the adapter's report right after compacting. It is not the next
	 * turn's occupancy or budget (probe C1/C2, n=2: the next prompt reported ~15k more). */
	tokensAfter: ObservedTokens | null;
	error?: string;
	summary?: string;
	/** `terminal`: the terminal update's summary (possibly the cleaned hook text). `chunks`: the
	 * streamed raw API text. No normalisation either way. */
	summarySource?: "terminal" | "chunks";
	summaryChars?: number;
}

const ERROR_MAX = 200;

function boundLine(value: unknown): string | undefined {
	if (typeof value !== "string") return undefined;
	// biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are what is stripped
	const flat = value.replace(/[\u0000-\u001f\u007f\s]+/g, " ").trim();
	if (!flat) return undefined;
	return flat.length > ERROR_MAX ? `${flat.slice(0, ERROR_MAX)}…` : flat;
}

function formatTokens(n: number): string {
	if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
	if (n >= 1_000) return `${Math.round(n / 1_000)}k`;
	return String(n);
}

function formatInterval(ms: number): string {
	const s = ms / 1000;
	if (s < 60) return `${s.toFixed(1)}s`;
	const m = Math.floor(s / 60);
	return `${m}m${Math.round(s - m * 60)}s`;
}

interface Pending {
	compactionId: string;
	status?: "completed" | "failed" | "cancelled";
	startedMs: number | null;
	endedMs: number | null;
	tokensBefore: ObservedTokens | null;
	tokensAfter: ObservedTokens | null;
	afterDecided: boolean;
	lineEmitted: boolean;
	error?: string;
	terminalSummary?: string;
	chunks: string[];
}

export interface AcpCompactionCollectorOptions {
	/** False for a turn outside the record's scope (Pi summary turn, `cwd:` key): lines only. */
	collect: boolean;
	promptWasCompactCommand: boolean;
	/** #175: stamped on every record of this collector (Entwurf's own `/compact` before a turn's input). */
	source?: "prelude";
	/** The previous turn's last occupancy, if any. */
	carried?: number;
	now: () => number;
	emitLine: (text: string) => void;
}

/** True when the first block of a prompt's user delta is the `/compact` command (args allowed). */
export function isCompactCommand(text: string | undefined): boolean {
	return typeof text === "string" && /^\/compact(\s|$)/.test(text.trim());
}

export class AcpCompactionCollector {
	readonly collect: boolean;
	/** Open only while this prompt is on the wire (the S7 prompt window). */
	windowOpen = false;
	private readonly opts: AcpCompactionCollectorOptions;
	private readonly byId = new Map<string, Pending>();
	private readonly order: string[] = [];
	private lastOccupancy: ObservedTokens | null;
	/** The compaction whose `tokensAfter` is still being waited for. */
	private awaitingAfter: Pending | undefined;
	private closed = false;

	constructor(opts: AcpCompactionCollectorOptions) {
		this.opts = opts;
		this.collect = opts.collect;
		this.lastOccupancy =
			typeof opts.carried === "number" && opts.carried > 0
				? { value: opts.carried, source: "carried", observedAt: null }
				: null;
	}

	/** How many compactions this prompt saw (recorded or not). */
	get observedCount(): number {
		return this.order.length;
	}

	private iso(ms: number): string {
		return new Date(ms).toISOString();
	}

	/** A `usage_update.used` observed in this prompt. */
	onUsage(used: number): void {
		if (this.closed) return;
		const at = this.opts.now();
		const pending = this.awaitingAfter;
		if (pending) {
			// The first report after the terminal decides `after`; a 0 is the adapter's fallback when
			// it had no post-compaction count (acp-agent.js:3150-3155), so it decides `after = null`.
			pending.tokensAfter = used > 0 ? { value: used, source: "usage_update", observedAt: this.iso(at) } : null;
			this.decideAfter(pending);
		}
		if (used > 0) this.lastOccupancy = { value: used, source: "usage_update", observedAt: this.iso(at) };
	}

	/** A `compaction_update` or `compaction_summary_chunk` that arrived inside the window. */
	onUpdate(update: Record<string, unknown>): void {
		if (this.closed) return;
		const id = update.compactionId;
		if (typeof id !== "string" || !id) return;
		const at = this.opts.now();
		let p = this.byId.get(id);
		if (!p) {
			// A new compaction: the one still waiting for its `after` gets none.
			if (this.awaitingAfter && this.awaitingAfter.compactionId !== id) {
				this.awaitingAfter.tokensAfter = null;
				this.decideAfter(this.awaitingAfter);
			}
			p = {
				compactionId: id,
				startedMs: null,
				endedMs: null,
				tokensBefore: this.lastOccupancy,
				tokensAfter: null,
				afterDecided: false,
				lineEmitted: false,
				chunks: [],
			};
			this.byId.set(id, p);
			this.order.push(id);
		}
		if (update.sessionUpdate === "compaction_summary_chunk") {
			const content = update.content as { type?: unknown; text?: unknown } | undefined;
			if (content && typeof content.text === "string") p.chunks.push(content.text);
			return;
		}
		const status = update.status;
		if (status === "in_progress") {
			if (p.startedMs === null && p.status === undefined) p.startedMs = at;
			return;
		}
		if (status !== "completed" && status !== "failed" && status !== "cancelled") return;
		if (p.status === undefined) {
			// The first terminal decides the status; later terminals only fill empty fields.
			p.status = status;
			p.endedMs = at;
			this.awaitingAfter = p;
		}
		if (p.terminalSummary === undefined) {
			const summary = update.summary as Array<{ text?: unknown }> | undefined;
			if (Array.isArray(summary)) {
				const text = summary.map((b) => (typeof b?.text === "string" ? b.text : "")).join("");
				if (text) p.terminalSummary = text;
			}
		}
		if (p.error === undefined) {
			const error = boundLine(update.error);
			if (error) p.error = error;
		}
	}

	private decideAfter(p: Pending): void {
		if (p.afterDecided) return;
		p.afterDecided = true;
		if (this.awaitingAfter === p) this.awaitingAfter = undefined;
		this.emit(p);
	}

	private emit(p: Pending): void {
		if (p.lineEmitted) return;
		p.lineEmitted = true;
		const status = p.status ?? "unterminated";
		const parts = [`compaction ${status}`];
		const before = p.tokensBefore ? formatTokens(p.tokensBefore.value) : undefined;
		const after = p.tokensAfter ? formatTokens(p.tokensAfter.value) : undefined;
		if (before && after) parts.push(`${before}→${after}`);
		else if (before) parts.push(`from ${before}`);
		else if (after) parts.push(`to ${after}`);
		const interval = this.interval(p);
		let line = parts.join(" ");
		if (interval !== null) line += `, ${formatInterval(interval)} observed`;
		if (this.opts.promptWasCompactCommand) line += ", after /compact";
		this.opts.emitLine(line);
	}

	private interval(p: Pending): number | null {
		return p.startedMs !== null && p.endedMs !== null ? Math.max(0, p.endedMs - p.startedMs) : null;
	}

	/**
	 * The prompt window closed: lines still owed go out now (before the stream's terminal event),
	 * and the records are returned — none when this turn is outside the record's scope.
	 */
	close(): AcpCompactionRecord[] {
		if (this.closed) return [];
		this.closed = true;
		this.windowOpen = false;
		for (const id of this.order) {
			const p = this.byId.get(id);
			if (p && !p.lineEmitted) {
				if (p.status !== undefined) p.afterDecided = true;
				this.emit(p);
			}
		}
		if (!this.collect) return [];
		return this.order.map((id) => this.toRecord(this.byId.get(id) as Pending));
	}

	private toRecord(p: Pending): AcpCompactionRecord {
		const status: AcpCompactionStatus = p.status ?? "unterminated";
		const record: AcpCompactionRecord = {
			v: 1,
			compactionId: p.compactionId,
			status,
			promptWasCompactCommand: this.opts.promptWasCompactCommand,
			...(this.opts.source === undefined ? {} : { source: this.opts.source }),
			startedObservedAt: p.startedMs === null ? null : this.iso(p.startedMs),
			endedObservedAt: p.endedMs === null ? null : this.iso(p.endedMs),
			observedIntervalMs: this.interval(p),
			tokensBefore: p.tokensBefore,
			tokensAfter: p.tokensAfter,
		};
		if (status === "failed" && p.error) record.error = p.error;
		if (status === "completed") {
			const chunked = p.chunks.join("");
			const summary = p.terminalSummary ?? (chunked || undefined);
			if (summary !== undefined) {
				record.summary = summary;
				record.summarySource = p.terminalSummary !== undefined ? "terminal" : "chunks";
				record.summaryChars = summary.length;
			}
		}
		return record;
	}
}
