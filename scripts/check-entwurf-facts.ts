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
import {
	type FactList,
	isNonPiGardenIdSocketConflict,
	type PeerFact,
	resolveFactList,
	resolvePeerFact,
	type SocketOnlyFact,
	type SocketProbe,
} from "../pi-extensions/lib/entwurf-facts.ts";
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
		cwd: "/home/junghan/repos/gh/entwurf",
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

// ════════════════════════════════════════════════════════════════════════════
// slice 2 — resolveFactList: meta-store ⨯ socket union (설계 동결 2026-06-11,
// GPT힣 + Fable). PeerFact for record citizens, SocketOnlyFact for record-less
// live sockets; gardenId is the correlation key.
// ════════════════════════════════════════════════════════════════════════════

function socketProbe(gardenId: string, liveness: SocketLiveness, over: Partial<SocketProbe> = {}): SocketProbe {
	return { gardenId, liveness, cwd: null, model: null, idle: null, infoError: null, ...over };
}

const GID_PI_LIVE = "20260611T115213-3aa371";
const GID_PI_DORMANT = "20260611T093858-14984d";
const GID_CLAUDE = "20260611T112732-0f42b6";
const GID_SOCKET_ONLY = "20260611T135517-5f0d25";

// ── basic union: pi-live citizen + claude citizen + record-less live socket ──
{
	const ids = [identity("pi", { gardenId: GID_PI_LIVE }), identity("claude-code", { gardenId: GID_CLAUDE })];
	const probes = [socketProbe(GID_PI_LIVE, "alive"), socketProbe(GID_SOCKET_ONLY, "alive", { cwd: "/tmp/x" })];
	const out = resolveFactList(ids, probes);
	ok("union: 2 citizens → 2 PeerFacts", out.peers.length === 2);
	ok("union: 1 record-less socket → 1 SocketOnlyFact", out.socketOnly.length === 1);
	ok(
		"union: pi-live citizen liveness = alive (from its probe)",
		out.peers.find((p) => p.gardenId === GID_PI_LIVE)?.liveness === "alive",
	);
	ok(
		"union: claude citizen liveness = unsupported (out-of-domain, socket ignored)",
		out.peers.find((p) => p.gardenId === GID_CLAUDE)?.liveness === "unsupported",
	);
	ok("union: socket-only gardenId surfaced", out.socketOnly[0]?.gardenId === GID_SOCKET_ONLY);
}

// ── dormant trap (Fable): pi citizen probed dead → dead (NOT indeterminate) ──
{
	const out = resolveFactList([identity("pi", { gardenId: GID_PI_DORMANT })], [socketProbe(GID_PI_DORMANT, "dead")]);
	ok(
		"dormant trap: pi citizen + probe=dead → liveness=dead (resumable, not stranded)",
		out.peers[0]?.liveness === "dead",
	);
	ok("dormant trap: dead pi citizen is a PeerFact, not socket-only", out.socketOnly.length === 0);
}

// ── F3 preserve: pi citizen probed indeterminate → not folded to dead ────────
{
	const out = resolveFactList([identity("pi", { gardenId: GID_PI_LIVE })], [socketProbe(GID_PI_LIVE, "indeterminate")]);
	ok(
		"F3 preserve: pi citizen + probe=indeterminate → indeterminate (never folded)",
		out.peers[0]?.liveness === "indeterminate",
	);
}

// ── wiring invariant: unprobed in-domain citizen → throw (null is unprobed-only) ─
{
	let threw = false;
	try {
		resolveFactList([identity("pi", { gardenId: GID_PI_LIVE })], []);
	} catch {
		threw = true;
	}
	ok("wiring invariant: in-domain citizen absent from probes → throw (never silent null/indeterminate)", threw);
}

// ── fail-loud (동결3): out-of-domain citizen owning a control socket = ambiguity ─
{
	let threw = false;
	try {
		resolveFactList([identity("claude-code", { gardenId: GID_CLAUDE })], [socketProbe(GID_CLAUDE, "alive")]);
	} catch {
		threw = true;
	}
	ok("dedup/authority: non-pi citizen + control socket at same gid → fail-loud", threw);
}

// ── dedup (동결3): pi citizen + its socket → PeerFact only, never both ────────
{
	const out = resolveFactList([identity("pi", { gardenId: GID_PI_LIVE })], [socketProbe(GID_PI_LIVE, "alive")]);
	ok("dedup: pi citizen consumes its socket (1 PeerFact)", out.peers.length === 1);
	ok("dedup: consumed gid not also emitted as SocketOnlyFact", out.socketOnly.length === 0);
	const allGids = [...out.peers.map((p) => p.gardenId), ...out.socketOnly.map((s) => s.gardenId)];
	ok("dedup: no gardenId appears in both sections", new Set(allGids).size === allGids.length);
}

// ── duplicate inputs → throw ─────────────────────────────────────────────────
{
	let dupProbe = false;
	try {
		resolveFactList([], [socketProbe(GID_PI_LIVE, "alive"), socketProbe(GID_PI_LIVE, "dead")]);
	} catch {
		dupProbe = true;
	}
	ok("duplicate socket probe for one gid → throw", dupProbe);

	let dupId = false;
	try {
		resolveFactList(
			[identity("pi", { gardenId: GID_PI_LIVE }), identity("pi", { gardenId: GID_PI_LIVE })],
			[socketProbe(GID_PI_LIVE, "alive")],
		);
	} catch {
		dupId = true;
	}
	ok("duplicate meta-record for one gid → throw", dupId);
}

// ── SocketOnlyFact: 3-value liveness + probe-derived enrich, no synthetic id ──
{
	const out = resolveFactList(
		[],
		[socketProbe(GID_SOCKET_ONLY, "alive", { cwd: "/tmp/w", model: "gpt-5.5", idle: true, infoError: null })],
	);
	const s = out.socketOnly[0] as SocketOnlyFact;
	ok("socket-only: kind discriminant", s.kind === "socket-only");
	ok("socket-only: liveness ∈ SocketLiveness 3-value (never unsupported)", s.liveness === "alive");
	ok("socket-only: probe-derived cwd passthrough", s.cwd === "/tmp/w");
	ok("socket-only: probe-derived model passthrough", s.model === "gpt-5.5");
	ok("socket-only: probe-derived idle passthrough", s.idle === true);
	const keys = Object.keys(s).sort();
	const expected = ["cwd", "gardenId", "idle", "infoError", "kind", "liveness", "model"].sort();
	assert.deepStrictEqual(keys, expected, `SocketOnlyFact keyset drift: ${keys.join(",")}`);
	ok("socket-only: keyset exact (gardenId + liveness + probe-derived enrich)", true);
	const FORBIDDEN = [
		"resumable",
		"sendable",
		"transport",
		"dispatch",
		"action",
		"backend",
		"nativeSessionId",
		"isEntwurf",
	];
	for (const k of FORBIDDEN) {
		ok(`socket-only: no '${k}' (no verb-routing, no synthetic identity)`, !(k in s));
	}
}

// ── determinism: output sorted by gardenId in each section ───────────────────
{
	const ids = [
		identity("pi", { gardenId: "20260611T222222-bbbbbb" }),
		identity("pi", { gardenId: "20260611T111111-aaaaaa" }),
	];
	const probes = [
		socketProbe("20260611T222222-bbbbbb", "alive"),
		socketProbe("20260611T111111-aaaaaa", "alive"),
		socketProbe("20260611T333333-cccccc", "alive"),
	];
	const out = resolveFactList(ids, probes);
	ok("determinism: peers sorted by gardenId", out.peers[0]?.gardenId === "20260611T111111-aaaaaa");
	ok("determinism: socketOnly sorted by gardenId", out.socketOnly[0]?.gardenId === "20260611T333333-cccccc");
}

// ── isNonPiGardenIdSocketConflict: the SHARED record-side conflict predicate ──
// (fact-provider listing + v2 decider dispatch consume this same fn — 4c 재유도
// 금지 동형). The union over socketGids ∪ symlinkedGardenIds is the fact-provider:125
// gap closure: a symlinked socket is never probed, so its gid is absent from
// socketGids; the predicate must STILL flag a non-pi citizen owning it.
{
	const G = "20260611T444444-dddddd";
	const realSockets = new Set([G]);
	const symlinked = new Set([G]);
	const empty = new Set<string>();
	for (const piBackend of IN_DOMAIN) {
		ok(
			`conflict-predicate: in-domain (${piBackend}) is NEVER a non-pi conflict (even with a colliding socket)`,
			!isNonPiGardenIdSocketConflict(piBackend, G, realSockets, symlinked),
		);
	}
	ok(
		"conflict-predicate: non-pi + real socket → conflict",
		isNonPiGardenIdSocketConflict("claude-code", G, realSockets, empty),
	);
	ok(
		"conflict-predicate: non-pi + SYMLINKED socket only → conflict (the :125 gap)",
		isNonPiGardenIdSocketConflict("claude-code", G, empty, symlinked),
	);
	ok(
		"conflict-predicate: non-pi + no socket of either kind → no conflict",
		!isNonPiGardenIdSocketConflict("claude-code", G, empty, empty),
	);
}

// Type-level guard: reference FactList so a shape rename breaks tsc.
const _factlist: (f: FactList) => number = (f) => f.peers.length + f.socketOnly.length;
void _factlist;

console.log(`\n[check-entwurf-facts] ${passed} assertions ok`);
