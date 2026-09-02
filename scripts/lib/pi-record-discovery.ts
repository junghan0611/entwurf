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

import { existsSync } from "node:fs";
import * as fsp from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * pi's own cross-process locks. `FileAuthStorageBackend` (pi `dist/core/auth-storage.js`) guards
 * `auth.json` AND `models-store.json` with `proper-lockfile`, and every boot reads through it, so
 * these two directories are the ones a killed resident can leave behind.
 */
const PI_LOCK_PATHS = ["auth.json.lock", "models-store.json.lock"].map((name) =>
	path.join(os.homedir(), ".pi", "agent", name),
);

/**
 * The bound a LIVE smoke must give a `pi` boot — and the reason it is NOT "how long a boot takes".
 *
 * MEASURED 2026-09-03 on the release host, in the smokes' own spawn shape:
 *  - an undisturbed boot → V3 record is **1008–1212ms across 80 consecutive boots** (5.1–5.4s under
 *    4× CPU oversubscription), so a bound in the tens of seconds is not about boot cost;
 *  - pi reads its auth/models store under a `proper-lockfile` lock whose stale window is
 *    `staleMs = 30_000` (pi `dist/core/auth-storage.js`), and a contender that finds the lock held
 *    retries for exactly that long before taking it over;
 *  - SIGTERM lands inside that window often enough to matter — sweeping 24 kill offsets across a
 *    boot left `~/.pi/agent/models-store.json.lock` orphaned once (at +375ms), because the signal
 *    ends the process before `proper-lockfile`'s release ever runs;
 *  - with such an orphan present, the very next boot measured **30_148ms** (and 1_114ms immediately
 *    after, once the stale takeover had cleared it).
 *
 * So a 30_000 bound is the single worst value available: it expires 148ms INSIDE the takeover, and
 * the record lands just after the smoke has stopped looking — an empty stderr, a live child, and no
 * record in any store. That is what blocked two of the three 0.17.0 `--cut` runs on C1b, while
 * `smoke-entwurf-chain-live` — same two-resident dance, 45_000 — passed all three. This constant is
 * that value, shared so no smoke sits on the cliff again. Raise it if pi's `staleMs` ever grows;
 * it must stay strictly greater than that window plus a boot.
 */
export const PI_BOOT_TIMEOUT_MS = 45_000;

/**
 * Which pi locks are on disk right now, for a failure diagnostic — a boot that overran its bound
 * while one of these exists overran it for a NAMED reason, not a mysterious one. Read-only: a lock
 * is arbitrated by pi's own stale protocol and must never be deleted by a smoke, because a live
 * holder and an orphan look identical from here.
 */
export function describePiLockResidue(): string {
	const present = PI_LOCK_PATHS.filter((lock) => existsSync(lock));
	if (present.length === 0) return "none held (so a boot overrun here is not the pi lock-stale window)";
	return `${present.join(", ")} — a boot contending with this waits out pi's ${30_000}ms stale window before taking over`;
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
