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
 * surface CLAIMS a false replyable", NOT "both surfaces reject". The now-removed v1
 * entwurf_send rejected wants_reply=true from a non-replyable sender (no reply
 * address); v2 entwurf_v2 passes wants_reply through as an etiquette payload and
 * surfaces the envelope's honest replyable:false. Both stopped lying about
 * replyability; only v1 also hard-rejected. They shared ONE builder, so the honesty
 * fix landed in both at once.
 *
 * Slice boundary: meta-self's watchArmed FACT is wired from the slice-2 meta-receiver
 * presence marker; the predicate already demands it here (fail-closed). Slices 1 and
 * 2 closed in the same release block. The pi-NATIVE surface (entwurf-control.ts
 * senderProvider/fallback) no longer hardcodes replyable:true — it derives replyable
 * from computeSelfAddressability + a canonical-socket existsSync probe, pinned by
 * check-entwurf-v2-surface and this gate's own pi-native source check.
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

// meta-session / SELF-FETCH rail (claude-code): 3-conjunct deliverability
// (recordBacked ∧ ownerAlive ∧ watchArmed).
{
	const meta = (f: Partial<SelfAddressabilityFacts>): SelfAddressabilityFacts => ({
		origin: "meta-session",
		metaDeliveryDomain: "self-fetch",
		...f,
	});
	const full = row(meta({ recordBacked: true, ownerAlive: true, watchArmed: true }));
	ok("meta/self-fetch + record + owner-alive + watch-armed → replyable", full.replyable === true);

	// (b) REGRESSION-PROOF row: record PRESENT but owner dead.
	const ownerDead = row(meta({ recordBacked: true, ownerAlive: false, watchArmed: true }));
	ok(
		"meta/self-fetch + record present + owner-dead (start-key mismatch) → NOT replyable",
		ownerDead.replyable === false,
	);

	// (c) REGRESSION-PROOF row: record + owner present but watch never armed.
	const watchUnarmed = row(meta({ recordBacked: true, ownerAlive: true, watchArmed: false }));
	ok("meta/self-fetch + record + owner-alive + watch-unarmed → NOT replyable", watchUnarmed.replyable === false);

	// not backed by a record at all → false (the all-absent baseline; weakest row).
	const unbacked = row(meta({ recordBacked: false, ownerAlive: false, watchArmed: false }));
	ok("meta/self-fetch + no backing record → NOT replyable", unbacked.replyable === false);

	// fail-closed on missing axes (undefined treated as false, never optimistic).
	const partial = row(meta({ recordBacked: true }));
	ok("meta/self-fetch + record but undefined owner/watch → fail-closed NOT replyable", partial.replyable === false);
}

// meta-session / NATIVE-PUSH rail (antigravity): a SEPARATE axis — recordBacked ∧ probeAlive.
// The two rails must not be able to borrow each other's facts (보정①): a mailbox signal
// deciding an agy reply, or a probe deciding a Claude reply, is a category error.
{
	const push = (f: Partial<SelfAddressabilityFacts>): SelfAddressabilityFacts => ({
		origin: "meta-session",
		metaDeliveryDomain: "native-push",
		...f,
	});
	const reachable = row(push({ recordBacked: true, probeAlive: true }));
	ok("meta/native-push + record + probe-alive → replyable", reachable.replyable === true);

	// THE ROW THIS RAIL EXISTS FOR: an agy citizen never arms a mailbox watch. Under the
	// self-fetch atom it would be un-replyable forever; on its own rail it is reachable.
	ok(
		"meta/native-push + record + probe-alive + watch NEVER armed → STILL replyable (no mailbox axis leak)",
		row(push({ recordBacked: true, probeAlive: true, watchArmed: false })).replyable === true,
	);

	// Dead conversation: the host is gone, so an injected reply has nowhere to land.
	ok(
		"meta/native-push + record + probe-dead → NOT replyable",
		row(push({ recordBacked: true, probeAlive: false })).replyable === false,
	);

	// No record → not an identity, whatever the probe says.
	ok(
		"meta/native-push + no record + probe-alive → NOT replyable",
		row(push({ recordBacked: false, probeAlive: true })).replyable === false,
	);

	// fail-closed: an unsupplied probe fact is false, never optimistic.
	ok(
		"meta/native-push + record but undefined probe → fail-closed NOT replyable",
		row(push({ recordBacked: true })).replyable === false,
	);

	// A native-push citizen must NOT be able to buy replyability with mailbox facts.
	ok(
		"meta/native-push + owner-alive + watch-armed but probe-dead → NOT replyable (mailbox facts cannot rescue it)",
		row(push({ recordBacked: true, ownerAlive: true, watchArmed: true, probeAlive: false })).replyable === false,
	);
}

// meta-session with NO rail declared: we cannot say how a reply would travel, so we do not
// claim it would arrive. The domain is derived from nativePushSupported(backend) — a caller
// that forgets it gets a refusal, not an optimistic guess.
{
	const noDomain = row({
		origin: "meta-session",
		recordBacked: true,
		ownerAlive: true,
		watchArmed: true,
		probeAlive: true,
	});
	ok("meta + NO delivery domain (all facts true) → fail-closed NOT replyable", noDomain.replyable === false);
}

// external-mcp: never replyable.
{
	const ext = row({ origin: "external-mcp" });
	ok("external-mcp → NOT replyable", ext.replyable === false);
	ok("external-mcp → socketState none", ext.socketState === "none");
}

// ── SOURCE GUARD: the MCP builders consume the predicate, no hardcoded lie ────
const indexPath = path.join(REPO_DIR, "mcp", "entwurf-bridge", "src", "index.ts");
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
// existsSync alone is too loose — pin that it probes the CANONICAL socket path,
// not some other file, so the honesty signal cannot drift to a path that does not
// represent this session's socket.
//
// This assertion used to match a MENTION of `ENTWURF_DIR` + `SOCKET_SUFFIX` in the
// body, which pinned a LOCAL re-implementation of the socket-path grammar instead
// of forbidding one — the bridge was one of three independent producers of
// `<dir>/<gid>.sock`. The grammar now has a single definition
// (`pi-extensions/lib/control-socket-path.js`), so the assertion pins the SHARED
// call: the dir is still this adapter's own policy (ENTWURF_DIR honours the env
// override the pi side does not), but the join is not re-authored here.
ok(
	"buildStrictPiSenderEnvelope existsSync-probes the canonical socket via the shared grammar (controlSocketPathIn(ENTWURF_DIR, …))",
	/existsSync\s*\(/.test(piBody) && /controlSocketPathIn\s*\(\s*ENTWURF_DIR\s*,/.test(piBody),
);

const selfRegion = toolRegion("entwurf_self");
ok(
	"entwurf_self existsSync-probes the pi socket (alive vs expected, no synthesized path lie)",
	/existsSync\s*\(/.test(selfRegion),
);

// ── SE-2 2e-b: meta-session sender replyability from the receiver presence marker ──
// Identity stays trusted (record-backed), but `replyable` is now derived from whether
// THIS session's own receiver inbox can actually wake (slice-2 presence marker), not a
// hardcoded true. An inactive receiver must still return the meta identity (replyable:false)
// — degrading to null would erase who-sent and fall through to external-mcp.
const metaBody = functionBody("buildTrustedMetaSenderEnvelope");
ok("buildTrustedMetaSenderEnvelope calls computeSelfAddressability", /computeSelfAddressability\s*\(/.test(metaBody));
ok("buildTrustedMetaSenderEnvelope no longer hardcodes `replyable: true`", !/replyable:\s*true/.test(metaBody));
ok(
	"buildTrustedMetaSenderEnvelope derives active-receiver from the receiver marker (identity-matched)",
	/readMetaReceiverMarker\s*\(/.test(metaBody) && /receiverMarkerMatchesIdentity\s*\(/.test(metaBody),
);
ok(
	"buildTrustedMetaSenderEnvelope keeps meta identity + derived replyable (inactive → not null)",
	/origin:\s*"meta-session"/.test(metaBody) && /replyable:\s*self\.replyable/.test(metaBody),
);

// ── SE-1 2e-a: pi-native surface derives pi-session replyability the SAME way ──
// entwurf-control.ts is a root-tsc emit surface, so it reaches the self-address fence via a
// non-literal dynamic import (never a static `.ts` import — TS5097), then decorates the
// sender with computeSelfAddressability + canonical socket existsSync (no hardcoded true).
const nativeSrc = readFileSync(path.join(REPO_DIR, "pi-extensions", "entwurf-control.ts"), "utf8");
ok(
	"pi-native: decoratePiSenderAddressability derives replyable from computeSelfAddressability + canonical existsSync",
	/function\s+decoratePiSenderAddressability/.test(nativeSrc) &&
		/computeSelfAddressability/.test(nativeSrc) &&
		/existsSync\s*\(\s*getSocketPath/.test(nativeSrc),
);
ok(
	"pi-native: reaches the self-address fence via non-literal dynamic import (no static import; TS5097)",
	/const ENTWURF_SELF_ADDRESS_MODULE\s*=/.test(nativeSrc) &&
		/await import\(ENTWURF_SELF_ADDRESS_MODULE\)/.test(nativeSrc) &&
		!/import[^;]*from\s*"\.\/lib\/entwurf-self-address\.(js|ts)"/.test(nativeSrc),
);

console.log(`\ncheck-entwurf-self-address: ${passed} checks passed`);
