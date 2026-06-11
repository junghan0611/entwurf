/**
 * check-entwurf-facts — deterministic gate for the fact-provider's pure core
 * (0.11 Stage 0 step 4, slice 1). Locks the FACT shape and the R1/R3b liveness
 * invariant in code BEFORE any IO wiring (gate-first).
 *
 * Proves:
 *   - R1 (out-of-domain → unsupported, NEVER coerced): claude-code / codex /
 *     antigravity resolve to `unsupported` for EVERY socket input (alive, dead,
 *     indeterminate, null) — the socket value is never folded into the fact for a
 *     backend whose liveness predicate is undefined.
 *   - R3b (in-domain 4-value): pi maps alive→alive, dead→dead,
 *     indeterminate→indeterminate, and null→indeterminate (no proof is
 *     `indeterminate`, never `dead`).
 *   - liveness is always a member of FACT_LIVENESSES.
 *   - identity / cwd-history fields pass through verbatim from the meta-record.
 *   - facts-only keyset: PeerFact carries EXACTLY the identity facts + `liveness`
 *     — no verb-routing field (resumable/sendable/transport/dispatch/action) and
 *     no transcriptPath. (동결결정 10: the fact layer must not bake routing.)
 *
 * Pure; no IO, no backend, no API.
 */

import assert from "node:assert/strict";
import { type PeerFact, resolvePeerFact } from "../pi-extensions/lib/entwurf-facts.ts";
import {
	FACT_LIVENESSES,
	type FactLiveness,
	isLivenessSupported,
	LIVENESS_DOMAIN_BACKENDS,
} from "../pi-extensions/lib/entwurf-v2-contract.ts";
import { META_BACKENDS_V2, type MetaBackendV2, type MetaIdentity } from "../pi-extensions/lib/meta-session.ts";
import type { SocketLiveness } from "../pi-extensions/lib/socket-probe.ts";

// Derive the backend coverage from the SSOT registry so a NEW backend in
// META_BACKENDS_V2 auto-extends this gate (Fable/GPT non-blocking suggestion):
// out-of-domain backends must all resolve to `unsupported`, the in-domain set is
// the only one with a defined liveness predicate. A drift assertion below pins
// the in-domain set to ["pi"] so widening the domain forces new R3b coverage.
const OUT_OF_DOMAIN = META_BACKENDS_V2.filter((b) => !isLivenessSupported(b));
const IN_DOMAIN = META_BACKENDS_V2.filter((b) => isLivenessSupported(b));

let passed = 0;
function ok(label: string, cond: boolean): void {
	assert.ok(cond, label);
	console.log(`  ok    ${label}`);
	passed++;
}

function identity(backend: MetaBackendV2, over: Partial<MetaIdentity> = {}): MetaIdentity {
	return {
		schemaVersion: 2,
		gardenId: "20260611T093858-14984d",
		backend,
		nativeSessionId: "native-abc",
		cwd: "/home/junghan/repos/gh/pi-shell-acp",
		model: "claude-opus-4-8",
		transcriptPath: "/home/junghan/.claude/projects/x/native-abc.jsonl",
		parentGardenId: null,
		isEntwurf: false,
		createdAt: "2026-06-11T00:38:58.000Z",
		recordUpdatedAt: "2026-06-11T02:40:00.000Z",
		...over,
	};
}

const SOCKET_INPUTS: (SocketLiveness | null)[] = ["alive", "dead", "indeterminate", null];

// ── R1: out-of-domain backend → unsupported for EVERY socket input ──────────
ok("R1 out-of-domain set is non-empty (gate is actually exercising R1)", OUT_OF_DOMAIN.length > 0);
for (const backend of OUT_OF_DOMAIN) {
	for (const socket of SOCKET_INPUTS) {
		const fact = resolvePeerFact(identity(backend), socket);
		ok(`R1 ${backend} + socket=${socket ?? "null"} → unsupported (not coerced)`, fact.liveness === "unsupported");
	}
}

// Drift guard: the in-domain set is exactly the contract's domain and is ["pi"].
// If the domain widens, this fails → forces adding R3b value coverage for the
// new backend instead of silently leaving it untested.
assert.deepStrictEqual(IN_DOMAIN, [...LIVENESS_DOMAIN_BACKENDS], "IN_DOMAIN ≠ LIVENESS_DOMAIN_BACKENDS");
assert.deepStrictEqual(IN_DOMAIN, ["pi"], "liveness domain widened — add R3b coverage for the new backend");
ok("drift guard: in-domain set == LIVENESS_DOMAIN_BACKENDS == ['pi']", true);

// ── R3b: in-domain (pi) 4-value mapping, null = indeterminate (never dead) ──
const PI_CASES: [SocketLiveness | null, FactLiveness][] = [
	["alive", "alive"],
	["dead", "dead"],
	["indeterminate", "indeterminate"],
	[null, "indeterminate"],
];
for (const [socket, expected] of PI_CASES) {
	const fact = resolvePeerFact(identity("pi"), socket);
	ok(`R3b pi + socket=${socket ?? "null"} → ${expected}`, fact.liveness === expected);
}
ok(
	"R3b pi null is indeterminate, NOT dead (no proof ≠ dead)",
	resolvePeerFact(identity("pi"), null).liveness === "indeterminate",
);

// ── liveness always ∈ FACT_LIVENESSES ──────────────────────────────────────
for (const backend of META_BACKENDS_V2) {
	for (const socket of SOCKET_INPUTS) {
		const fact = resolvePeerFact(identity(backend), socket);
		ok(
			`liveness ∈ FACT_LIVENESSES (${backend}/${socket ?? "null"} → ${fact.liveness})`,
			(FACT_LIVENESSES as readonly string[]).includes(fact.liveness),
		);
	}
}

// ── identity / cwd-history pass through verbatim ────────────────────────────
{
	const id = identity("pi", {
		gardenId: "20260611T112732-0f42b6",
		nativeSessionId: "uuid-xyz",
		cwd: "/tmp/work",
		model: null,
		parentGardenId: "20260101T000000-aaaaaa",
		isEntwurf: true,
		createdAt: "2026-06-11T01:00:00.000Z",
		recordUpdatedAt: "2026-06-11T03:00:00.000Z",
	});
	const fact = resolvePeerFact(id, "alive");
	ok("passthrough gardenId", fact.gardenId === id.gardenId);
	ok("passthrough backend", fact.backend === id.backend);
	ok("passthrough nativeSessionId", fact.nativeSessionId === id.nativeSessionId);
	ok("passthrough cwd", fact.cwd === id.cwd);
	ok("passthrough model (null preserved)", fact.model === null);
	ok("passthrough parentGardenId", fact.parentGardenId === id.parentGardenId);
	ok("passthrough isEntwurf", fact.isEntwurf === true);
	ok("passthrough createdAt", fact.createdAt === id.createdAt);
	ok("passthrough recordUpdatedAt", fact.recordUpdatedAt === id.recordUpdatedAt);
}

// ── facts-only keyset: identity facts + liveness, NO verb-routing/transcript ─
{
	const fact = resolvePeerFact(identity("pi"), "alive");
	const keys = Object.keys(fact).sort();
	const expected = [
		"backend",
		"createdAt",
		"cwd",
		"gardenId",
		"isEntwurf",
		"liveness",
		"model",
		"nativeSessionId",
		"parentGardenId",
		"recordUpdatedAt",
	].sort();
	assert.deepStrictEqual(keys, expected, `PeerFact keyset drift: got ${keys.join(",")}`);
	ok("facts-only keyset exact (identity facts + liveness)", true);

	const FORBIDDEN = ["resumable", "sendable", "transport", "dispatch", "action", "transcriptPath"];
	for (const k of FORBIDDEN) {
		ok(`no '${k}' on PeerFact (facts-only, no verb-routing/transcript)`, !(k in fact));
	}
}

// Type-level guard: the test references PeerFact so a field rename breaks tsc.
const _typecheck: (f: PeerFact) => FactLiveness = (f) => f.liveness;
void _typecheck;

console.log(`\n[check-entwurf-facts] ${passed} assertions ok`);
