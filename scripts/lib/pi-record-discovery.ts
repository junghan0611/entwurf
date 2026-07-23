/**
 * pi-record-discovery — shared LIVE-smoke helper: discover the resident's
 * SELF-BIRTHED citizen record.
 *
 * Post-#50-C2 the record mints the address at session_start and the control
 * socket is keyed on the RECORD gardenId — `--session-id` injection is gone, so
 * a smoke cannot know the address up front. It must read it the way every peer
 * does: from the record. Poll an (isolated) store dir until a `backend:"pi"` V3
 * record appears and return its gardenId, or null on timeout.
 *
 * The store dir a caller passes MUST be smoke-isolated (ENTWURF_META_SESSIONS_DIR
 * pointed at a temp dir on the spawned resident): discovery in the live store
 * would race other citizens, and a non-isolated resident would mint smoke
 * garbage into the operator's store — the exact mixed-store hazard M1 exists to
 * clean up (observed live 2026-07-23: two `cwd=/tmp` V3 records from pre-rewrite
 * runs of the acp socket smokes).
 */

import * as fsp from "node:fs/promises";
import * as path from "node:path";

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function waitForPiRecord(storeDir: string, timeoutMs: number, pollMs = 100): Promise<string | null> {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		const entries = await fsp.readdir(storeDir).catch(() => [] as string[]);
		for (const f of entries) {
			if (!f.endsWith(".meta.json")) continue;
			try {
				const raw = JSON.parse(await fsp.readFile(path.join(storeDir, f), "utf8"));
				if (raw.backend === "pi" && raw.schemaVersion === 3 && typeof raw.gardenId === "string") {
					return raw.gardenId;
				}
			} catch {
				// half-written record mid-poll — retry
			}
		}
		await sleep(pollMs);
	}
	return null;
}
