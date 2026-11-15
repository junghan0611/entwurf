/**
 * compaction-writer — the one place an ACP compaction record is written into the host session
 * (#163 S8). The provider's `message_end` handler takes the records of the prompt that just ended
 * (`takeAcpCompactionRecords`) and passes them here.
 *
 * Each record becomes one plain custom entry (`ACP_COMPACTION_ENTRY_TYPE`). A plain custom entry
 * is kept in the session file and is outside Pi's model-context projection, so the summary it
 * carries is information, not context (AGENTS Rule 9: backend-reported compaction facts and
 * summaries may be preserved as out-of-context host-session metadata for observability only).
 * Nothing in Entwurf reads these entries back.
 *
 * Losing a record never fails the turn (the model's work is done; replaying it would be worse).
 * A loss is made visible instead: a UI warning when there is a UI, and one stderr line always —
 * neither carries the summary.
 */

import { ACP_COMPACTION_ENTRY_TYPE, type AcpCompactionRecord, type AcpCompactionStatus } from "./compaction-record.js";

export interface TakenAcpCompactionRecords {
	records: AcpCompactionRecord[];
	/** Records the backend had to drop since the last take of this session (never taken). */
	droppedBefore: Array<{ compactionId: string; status: AcpCompactionStatus }>;
}

export interface CompactionWriterDeps {
	appendEntry(customType: string, data: unknown): void;
	/** Present only when the host has a UI. */
	notify?: (message: string) => void;
	stderr(line: string): void;
	now(): string;
}

function describe(lost: Array<{ compactionId: string; status: AcpCompactionStatus }>): string {
	return lost.map((r) => `${r.compactionId.slice(0, 8)}/${r.status}`).join(", ");
}

/** Write the taken records; report what could not be kept. Never throws. */
export function writeAcpCompactionRecords(taken: TakenAcpCompactionRecords, deps: CompactionWriterDeps): void {
	const lost = [...taken.droppedBefore];
	for (const record of taken.records) {
		try {
			deps.appendEntry(ACP_COMPACTION_ENTRY_TYPE, { ...record, recordedAt: deps.now() });
		} catch {
			lost.push({ compactionId: record.compactionId, status: record.status });
		}
	}
	if (lost.length === 0) return;
	const message = `entwurf: ${lost.length} ACP compaction record(s) were not saved (${describe(lost)})`;
	try {
		deps.notify?.(message);
	} catch {
		// The stderr line below still says it.
	}
	deps.stderr(`[acp] ${message}\n`);
}
