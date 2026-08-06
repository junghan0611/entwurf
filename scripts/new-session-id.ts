/**
 * new-session-id — print one fresh garden-native sessionId and exit.
 *
 * NOT a launcher contract. #50 C2 retired the injection form
 * (`pi --session-id "$(./run.sh new-session-id)" --entwurf-control …`): pi mints its
 * own session id (a `uuidv7` is normal), `session_start` attaches that session to its
 * meta-record, and the RECORD mints the garden id and keys the control socket on it.
 * Injecting a garden-shaped id gives a session two address-shaped strings of which only
 * one is an address. Launch is plain `pi --entwurf-control` (README §Garden launcher).
 *
 * What survives is this: the operator-facing generator for the same id grammar the
 * record layer itself uses — one fresh id on stdout, for a caller that needs to mint a
 * token deliberately, never as a launch argument.
 *
 * The id is `generateSessionId()` from entwurf-core — the single SSOT for the
 * locked `YYYYMMDDTHHMMSS-[0-9a-f]{6}` grammar. Do NOT reimplement the format in
 * the shell (it would drift from the validator the resident guard enforces).
 *
 * Stdout is the id and nothing else (no trailing prose), so `$(…)` captures a
 * clean value. Errors go to stderr with a nonzero exit.
 */

import { generateSessionId } from "../pi-extensions/lib/entwurf-core.ts";

try {
	process.stdout.write(`${generateSessionId()}\n`);
} catch (err) {
	process.stderr.write(`new-session-id failed: ${err instanceof Error ? err.message : String(err)}\n`);
	process.exit(1);
}
