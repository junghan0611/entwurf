/**
 * check-entwurf-self-address — deterministic gate for the self-addressability
 * honesty predicate (SE-1/SE-2 slice 1). Guards the bug where the MCP bridge and
 * pi-native claim `replyable: true` purely from env presence: a pi session with no
 * --entwurf-control socket, or a meta citizen whose owner exited / whose idle-watch
 * was never armed, all advertised replyable while delivery silently failed (SE-1).
 *
 * Proves:
 *   - PURE truth table (computeSelfAddressability, facts injected): pi replyable ⟺
 *     socketAlive; meta replyable ⟺ recordBacked ∧ ownerAlive ∧ watchArmed; external
 *     never replyable. socketState alive/expected/none is its own assertable field.
 *   - The two REGRESSION-PROOF rows the lock requires (record-present, not all-absent):
 *       (b) meta record present + owner-dead (start-key mismatch) → false
 *       (c) meta record present + watch-unarmed → false
 *     These stay meaningful after slice 3 mints pi/meta records, where an
 *     "everything absent → false" row would silently go green.
 *   - SOURCE GUARD (the regression this gate exists for): buildStrictPiSenderEnvelope
 *     no longer hardcodes `replyable: true` in its pi-session envelope — it derives
 *     replyable from computeSelfAddressability over a real existsSync socket probe;
 *     entwurf_self renders the socket as alive vs expected (no synthesized path lie).
 *
 * v1/v2 contract (pin so it is not later misread): the slice-1 goal is "neither
 * surface CLAIMS a false replyable", NOT "both surfaces reject". v1 entwurf_send
 * rejects wants_reply=true from a non-replyable sender (no reply address); v2
 * entwurf_v2 passes wants_reply through as an etiquette payload and surfaces the
 * envelope's honest replyable:false. Both stop lying about replyability; only v1 also
 * hard-rejects. They share ONE builder, so the honesty fix lands in both at once.
 *
 * Slice boundary: meta-self's watchArmed FACT is wired from the slice-2 meta-receiver
 * presence marker; the predicate already demands it here (fail-closed). Slices 1 and
 * 2 close in the same release block — do NOT claim slice 1 green standalone. The
 * pi-NATIVE surface (entwurf-control.ts senderProvider/fallback) still hardcodes
 * replyable:true and is closed in slice 2 along with its source guards
 * (check-entwurf-v2-surface, check-entwurf-send-mailbox-fallback) and
 * smoke-meta-sender-identity.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import {
	computeSelfAddressability,
	type SelfAddressabilityFacts,
	type SocketState,
} from "../pi-extensions/lib/entwurf-self-address.ts";

let passed = 0;
function ok(label: string, cond: boolean): void {
	assert.ok(cond, label);
	console.log(`  ok    ${label}`);
	passed++;
}

const REPO_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// ── PURE truth table ────────────────────────────────────────────────────────
function row(facts: SelfAddressabilityFacts): { replyable: boolean; socketState: SocketState } {
	const r = computeSelfAddressability(facts);
	return { replyable: r.replyable, socketState: r.socketState };
}

// pi-session axis: replyable ⟺ a live control socket.
{
	const alive = row({ origin: "pi-session", socketAlive: true, socketPathComputable: true });
	ok("pi + socket alive → replyable", alive.replyable === true);
	ok("pi + socket alive → socketState alive", alive.socketState === "alive");

	// SE-1 CORE: a pi session with PI_SESSION_ID but NO --entwurf-control socket.
	const expected = row({ origin: "pi-session", socketAlive: false, socketPathComputable: true });
	ok("pi + socket absent (path computable) → NOT replyable", expected.replyable === false);
	ok("pi + socket absent → socketState expected (not a synthesized 'alive' lie)", expected.socketState === "expected");

	// No session id at all → cannot even compute a path. Distinct from 'expected'.
	const none = row({ origin: "pi-session", socketAlive: false, socketPathComputable: false });
	ok("pi + no session id → NOT replyable", none.replyable === false);
	ok("pi + no session id → socketState none", none.socketState === "none");
}

// meta-session axis: 3-conjunct deliverability (recordBacked ∧ ownerAlive ∧ watchArmed).
{
	const full = row({ origin: "meta-session", recordBacked: true, ownerAlive: true, watchArmed: true });
	ok("meta + record + owner-alive + watch-armed → replyable", full.replyable === true);

	// (b) REGRESSION-PROOF row: record PRESENT but owner dead.
	const ownerDead = row({ origin: "meta-session", recordBacked: true, ownerAlive: false, watchArmed: true });
	ok("meta + record present + owner-dead (start-key mismatch) → NOT replyable", ownerDead.replyable === false);

	// (c) REGRESSION-PROOF row: record + owner present but watch never armed.
	const watchUnarmed = row({ origin: "meta-session", recordBacked: true, ownerAlive: true, watchArmed: false });
	ok("meta + record present + owner-alive + watch-unarmed → NOT replyable", watchUnarmed.replyable === false);

	// not backed by a record at all → false (the all-absent baseline; weakest row).
	const unbacked = row({ origin: "meta-session", recordBacked: false, ownerAlive: false, watchArmed: false });
	ok("meta + no backing record → NOT replyable", unbacked.replyable === false);

	// fail-closed on missing axes (undefined treated as false, never optimistic).
	const partial = row({ origin: "meta-session", recordBacked: true });
	ok("meta + record but undefined owner/watch → fail-closed NOT replyable", partial.replyable === false);
}

// external-mcp: never replyable.
{
	const ext = row({ origin: "external-mcp" });
	ok("external-mcp → NOT replyable", ext.replyable === false);
	ok("external-mcp → socketState none", ext.socketState === "none");
}

// ── SOURCE GUARD: the MCP builders consume the predicate, no hardcoded lie ────
const indexPath = path.join(REPO_DIR, "mcp", "pi-tools-bridge", "src", "index.ts");
const src = readFileSync(indexPath, "utf8");

/** Extract a top-level `function NAME(...) { ... }` body by brace-counting. */
function functionBody(name: string): string {
	const sig = `function ${name}(`;
	const at = src.indexOf(sig);
	assert.ok(at >= 0, `${name} present in MCP source`);
	const open = src.indexOf("{", at);
	assert.ok(open >= 0, `${name} has a body`);
	let depth = 0;
	for (let i = open; i < src.length; i++) {
		const c = src[i];
		if (c === "{") depth++;
		else if (c === "}") {
			depth--;
			if (depth === 0) return src.slice(open, i + 1);
		}
	}
	throw new Error(`${name} body never closed`);
}

/** Extract a `server.tool("NAME", ...)` call region by brace-counting from its open paren. */
function toolRegion(name: string): string {
	const sig = `server.tool(\n\t"${name}"`;
	const at = src.indexOf(sig);
	assert.ok(at >= 0, `server.tool("${name}") present`);
	const open = src.indexOf("(", at);
	let depth = 0;
	for (let i = open; i < src.length; i++) {
		const c = src[i];
		if (c === "(") depth++;
		else if (c === ")") {
			depth--;
			if (depth === 0) return src.slice(open, i + 1);
		}
	}
	throw new Error(`server.tool("${name}") region never closed`);
}

ok(
	"MCP imports computeSelfAddressability from the shared lib",
	/computeSelfAddressability/.test(src) && /entwurf-self-address\.ts/.test(src),
);

const piBody = functionBody("buildStrictPiSenderEnvelope");
ok("buildStrictPiSenderEnvelope calls computeSelfAddressability", /computeSelfAddressability\s*\(/.test(piBody));
// Scoped to THIS function body (not a broad grep): the pi-session envelope must NOT
// hardcode `replyable: true`; it must derive from the predicate result.
ok("buildStrictPiSenderEnvelope no longer hardcodes `replyable: true`", !/replyable:\s*true/.test(piBody));
// existsSync alone is too loose — pin that it probes the CANONICAL socket path
// (ENTWURF_DIR + sessionId + SOCKET_SUFFIX), not some other file, so the honesty
// signal cannot drift to a path that does not represent this session's socket.
ok(
	"buildStrictPiSenderEnvelope existsSync-probes the canonical socket (ENTWURF_DIR + sessionId + SOCKET_SUFFIX)",
	/existsSync\s*\(/.test(piBody) && /ENTWURF_DIR/.test(piBody) && /SOCKET_SUFFIX/.test(piBody),
);

const selfRegion = toolRegion("entwurf_self");
ok(
	"entwurf_self existsSync-probes the pi socket (alive vs expected, no synthesized path lie)",
	/existsSync\s*\(/.test(selfRegion),
);

console.log(`\ncheck-entwurf-self-address: ${passed} checks passed`);
