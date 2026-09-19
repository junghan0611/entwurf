/**
 * entwurf-facts — the fact-provider's pure core (0.11 Stage 0 step 4, slice 1 + slice 2),
 * proven beside the code it certifies (#119 V3).
 *
 * MIGRATED from scripts/check-entwurf-facts.ts, assertion for assertion. The contract did
 * not change and is restated so this file reads without the one it replaced:
 *
 *   - R1 (out-of-domain → unsupported, NEVER coerced): claude-code / codex / antigravity
 *     resolve to `unsupported` for EVERY socket input (alive, dead, indeterminate, null).
 *     The socket value is never folded into the fact for a backend whose liveness predicate
 *     is undefined.
 *   - R3b (in-domain 4-value): pi maps alive→alive, dead→dead, indeterminate→indeterminate,
 *     and null→indeterminate. No proof is `indeterminate`, never `dead`.
 *   - liveness is always a member of FACT_LIVENESSES.
 *   - identity / cwd-history fields pass through verbatim from the meta-record.
 *   - facts-only keyset: PeerFact carries EXACTLY the identity facts + liveness + the three
 *     observed axes — no verb-routing field and no transcriptPath (동결결정 10: the fact
 *     layer must not bake routing).
 *   - slice 2 (resolveFactList): the meta-store ⨯ socket union, with #50 C4 demotion —
 *     a socket no record claims is a RecordLessSocketFact, a DIAGNOSTIC subject, never a
 *     citizen, with gardenId as the correlation key.
 *
 * Pure; no IO, no backend, no API.
 *
 * The backend coverage is DERIVED from the SSOT registry rather than listed, so a new entry
 * in META_CITIZEN_BACKENDS extends this file by itself. A drift guard pins the in-domain set
 * to ["pi"], which is what forces new R3b value coverage instead of letting a widened domain
 * go quietly untested.
 */

import { describe, expect, it } from "vitest";

import {
	type FactList,
	isOutOfSocketDomainGardenIdConflict,
	type PeerFact,
	type RecordLessSocketFact,
	resolveFactList,
	resolvePeerFact,
	type SocketProbe,
} from "./entwurf-facts.ts";
import {
	FACT_LIVENESSES,
	type FactLiveness,
	isLivenessSupported,
	LIVENESS_DOMAIN_BACKENDS,
} from "./entwurf-v2-contract.ts";
import { UNOBSERVED_PLACEMENT } from "./herdr-placement.ts";
import { META_CITIZEN_BACKENDS, type MetaCitizenBackend, type MetaIdentity } from "./meta-session.ts";
import type { SocketLiveness } from "./socket-probe.ts";

const OUT_OF_DOMAIN = META_CITIZEN_BACKENDS.filter((b) => !isLivenessSupported(b));
const IN_DOMAIN = META_CITIZEN_BACKENDS.filter((b) => isLivenessSupported(b));

function identity(backend: MetaCitizenBackend, over: Partial<MetaIdentity> = {}): MetaIdentity {
	return {
		schemaVersion: 3,
		gardenId: "20260611T093858-14984d",
		backend,
		nativeSessionId: "native-abc",
		cwd: "/home/junghan/repos/gh/entwurf",
		model: "claude-opus-5",
		transcriptPath: "/home/junghan/.claude/projects/x/native-abc.jsonl",
		createdAt: "2026-06-11T00:38:58.000Z",
		recordUpdatedAt: "2026-06-11T02:40:00.000Z",
		...over,
	};
}

const SOCKET_INPUTS: (SocketLiveness | null)[] = ["alive", "dead", "indeterminate", null];

describe("R1 — an out-of-domain backend is never coerced", () => {
	it("the out-of-domain set is non-empty, so this block actually exercises R1", () => {
		expect(OUT_OF_DOMAIN.length).toBeGreaterThan(0);
	});

	for (const backend of OUT_OF_DOMAIN) {
		for (const socket of SOCKET_INPUTS) {
			it(`${backend} + socket=${socket ?? "null"} → unsupported`, () => {
				expect(resolvePeerFact(identity(backend), socket).liveness).toBe("unsupported");
			});
		}
	}

	// If the domain widens this fails, which is the point: it forces R3b value coverage for
	// the new backend instead of leaving it silently untested.
	it("drift guard: the in-domain set is exactly LIVENESS_DOMAIN_BACKENDS and is ['pi']", () => {
		expect(IN_DOMAIN).toEqual([...LIVENESS_DOMAIN_BACKENDS]);
		expect(IN_DOMAIN).toEqual(["pi"]);
	});
});

describe("R3b — the in-domain 4-value mapping", () => {
	const PI_CASES: [SocketLiveness | null, FactLiveness][] = [
		["alive", "alive"],
		["dead", "dead"],
		["indeterminate", "indeterminate"],
		[null, "indeterminate"],
	];
	for (const [socket, expected] of PI_CASES) {
		it(`pi + socket=${socket ?? "null"} → ${expected}`, () => {
			expect(resolvePeerFact(identity("pi"), socket).liveness).toBe(expected);
		});
	}

	it("null is indeterminate, NOT dead — no proof is not a death certificate", () => {
		expect(resolvePeerFact(identity("pi"), null).liveness).toBe("indeterminate");
	});

	for (const backend of META_CITIZEN_BACKENDS) {
		for (const socket of SOCKET_INPUTS) {
			it(`liveness ∈ FACT_LIVENESSES (${backend}/${socket ?? "null"})`, () => {
				expect(FACT_LIVENESSES as readonly string[]).toContain(resolvePeerFact(identity(backend), socket).liveness);
			});
		}
	}
});

describe("what a PeerFact carries", () => {
	const id = identity("pi", {
		gardenId: "20260611T112732-0f42b6",
		nativeSessionId: "uuid-xyz",
		cwd: "/tmp/work",
		model: null,
		createdAt: "2026-06-11T01:00:00.000Z",
		recordUpdatedAt: "2026-06-11T03:00:00.000Z",
	});

	it("the identity and cwd-history fields pass through verbatim", () => {
		const fact = resolvePeerFact(id, "alive");
		expect(fact.gardenId).toBe(id.gardenId);
		expect(fact.backend).toBe(id.backend);
		expect(fact.nativeSessionId).toBe(id.nativeSessionId);
		expect(fact.cwd).toBe(id.cwd);
		expect(fact.model).toBeNull();
		expect(fact.createdAt).toBe(id.createdAt);
		expect(fact.recordUpdatedAt).toBe(id.recordUpdatedAt);
	});

	it("the keyset is exactly identity facts + liveness + the three observed axes", () => {
		const keys = Object.keys(resolvePeerFact(identity("pi"), "alive")).sort();
		expect(keys).toEqual(
			[
				"backend",
				"createdAt",
				"cwd",
				"gardenId",
				"liveness",
				"model",
				"nativeSessionId",
				"placement",
				"receiver",
				"recordUpdatedAt",
				"transcript",
			].sort(),
		);
	});

	// #101: an unmeasured row says so. `unobserved` is the default for a caller that injected
	// no observer — never `none`/`absent`, which would be a fabricated fact.
	it("an observer-less composition reports all three axes as unobserved", () => {
		const fact = resolvePeerFact(identity("pi"), "alive");
		expect(fact.receiver).toBe("unobserved");
		expect(fact.transcript).toBe("unobserved");
		expect(fact.placement.kind).toBe("unobserved");
	});

	it("an injected observation rides onto the fact verbatim", () => {
		const observed = resolvePeerFact(identity("claude-code"), null, {
			receiver: "inactive",
			transcript: "absent",
			placement: UNOBSERVED_PLACEMENT,
		});
		expect(observed.receiver).toBe("inactive");
		expect(observed.transcript).toBe("absent");
		expect(observed.placement.kind).toBe("unobserved");
	});

	for (const k of [
		"resumable",
		"sendable",
		"transport",
		"dispatch",
		"action",
		"transcriptPath",
		"parentGardenId",
		"isEntwurf",
	]) {
		it(`carries no '${k}' — facts only, no verb-routing and no transcript path`, () => {
			expect(k in resolvePeerFact(identity("pi"), "alive")).toBe(false);
		});
	}

	// Type-level guard: referencing PeerFact means a field rename breaks tsc.
	it("PeerFact still types as a liveness carrier", () => {
		const typecheck: (f: PeerFact) => FactLiveness = (f) => f.liveness;
		expect(typecheck(resolvePeerFact(identity("pi"), "alive"))).toBe("alive");
	});
});

// slice 2 — resolveFactList: the meta-store ⨯ socket union (설계 동결 2026-06-11, GPT힣 +
// Fable; #50 C4 demotion). PeerFact for record citizens, RecordLessSocketFact for sockets no
// record claims — a DIAGNOSTIC subject the provider folds into `record-less-socket`.
function socketProbe(gardenId: string, liveness: SocketLiveness): SocketProbe {
	return { gardenId, liveness };
}

const GID_PI_LIVE = "20260611T115213-3aa371";
const GID_PI_DORMANT = "20260611T093858-14984d";
const GID_CLAUDE = "20260611T112732-0f42b6";
const GID_SOCKET_ONLY = "20260611T135517-5f0d25";

describe("resolveFactList — the store ⨯ socket union", () => {
	it("two citizens and one record-less socket land in their own sections", () => {
		const out = resolveFactList(
			[identity("pi", { gardenId: GID_PI_LIVE }), identity("claude-code", { gardenId: GID_CLAUDE })],
			[socketProbe(GID_PI_LIVE, "alive"), socketProbe(GID_SOCKET_ONLY, "alive")],
		);
		expect(out.peers.length).toBe(2);
		expect(out.recordLessSockets.length).toBe(1);
		expect(out.peers.find((p) => p.gardenId === GID_PI_LIVE)?.liveness).toBe("alive");
		// out-of-domain: the socket is ignored rather than folded in.
		expect(out.peers.find((p) => p.gardenId === GID_CLAUDE)?.liveness).toBe("unsupported");
		expect(out.recordLessSockets[0]?.gardenId).toBe(GID_SOCKET_ONLY);
	});

	// The dormant trap (Fable): a pi citizen probed dead is DEAD, which is resumable — calling
	// it indeterminate would strand it.
	it("dormant trap: pi + probe=dead → dead, and still a PeerFact", () => {
		const out = resolveFactList([identity("pi", { gardenId: GID_PI_DORMANT })], [socketProbe(GID_PI_DORMANT, "dead")]);
		expect(out.peers[0]?.liveness).toBe("dead");
		expect(out.recordLessSockets.length).toBe(0);
	});

	it("F3 preserve: pi + probe=indeterminate is never folded to dead", () => {
		const out = resolveFactList(
			[identity("pi", { gardenId: GID_PI_LIVE })],
			[socketProbe(GID_PI_LIVE, "indeterminate")],
		);
		expect(out.peers[0]?.liveness).toBe("indeterminate");
	});

	it("an in-domain citizen absent from the probes throws — null means unprobed, nothing else", () => {
		expect(() => resolveFactList([identity("pi", { gardenId: GID_PI_LIVE })], [])).toThrow();
	});

	// 동결3: an out-of-domain citizen owning a control socket is an ambiguity, not a fact.
	it("out-of-socket-domain citizen + same-gid socket → fail loud", () => {
		expect(() =>
			resolveFactList([identity("claude-code", { gardenId: GID_CLAUDE })], [socketProbe(GID_CLAUDE, "alive")]),
		).toThrow();
	});

	it("dedup: a pi citizen consumes its own socket and no gid appears twice", () => {
		const out = resolveFactList([identity("pi", { gardenId: GID_PI_LIVE })], [socketProbe(GID_PI_LIVE, "alive")]);
		expect(out.peers.length).toBe(1);
		expect(out.recordLessSockets.length).toBe(0);
		const allGids = [...out.peers.map((p) => p.gardenId), ...out.recordLessSockets.map((s) => s.gardenId)];
		expect(new Set(allGids).size).toBe(allGids.length);
	});

	it("a duplicate socket probe for one gid throws", () => {
		expect(() => resolveFactList([], [socketProbe(GID_PI_LIVE, "alive"), socketProbe(GID_PI_LIVE, "dead")])).toThrow();
	});

	it("a duplicate meta-record for one gid throws", () => {
		expect(() =>
			resolveFactList(
				[identity("pi", { gardenId: GID_PI_LIVE }), identity("pi", { gardenId: GID_PI_LIVE })],
				[socketProbe(GID_PI_LIVE, "alive")],
			),
		).toThrow();
	});

	it("determinism: each section is sorted by gardenId", () => {
		const out = resolveFactList(
			[identity("pi", { gardenId: "20260611T222222-bbbbbb" }), identity("pi", { gardenId: "20260611T111111-aaaaaa" })],
			[
				socketProbe("20260611T222222-bbbbbb", "alive"),
				socketProbe("20260611T111111-aaaaaa", "alive"),
				socketProbe("20260611T333333-cccccc", "alive"),
			],
		);
		expect(out.peers[0]?.gardenId).toBe("20260611T111111-aaaaaa");
		expect(out.recordLessSockets[0]?.gardenId).toBe("20260611T333333-cccccc");
	});

	// Type-level guard: referencing FactList means a shape rename breaks tsc.
	it("FactList still types as two countable sections", () => {
		const count: (f: FactList) => number = (f) => f.peers.length + f.recordLessSockets.length;
		expect(count(resolveFactList([], []))).toBe(0);
	});
});

// #50 C4. The demotion is STRUCTURAL: no enrich (cwd/model/idle came from get_info-ing the
// socket, which is treating it as a citizen), no kind tag, no synthetic identity.
describe("RecordLessSocketFact — a socket no record claims", () => {
	it("liveness is the 3-value socket domain, never unsupported", () => {
		const out = resolveFactList([], [socketProbe(GID_SOCKET_ONLY, "alive")]);
		expect((out.recordLessSockets[0] as RecordLessSocketFact).liveness).toBe("alive");
	});

	it("the keyset is gardenId + liveness ONLY — enrich went with the listing", () => {
		const out = resolveFactList([], [socketProbe(GID_SOCKET_ONLY, "alive")]);
		expect(Object.keys(out.recordLessSockets[0]).sort()).toEqual(["gardenId", "liveness"]);
	});

	for (const k of [
		"resumable",
		"sendable",
		"transport",
		"dispatch",
		"action",
		"backend",
		"nativeSessionId",
		"isEntwurf",
		"cwd",
		"model",
		"idle",
		"infoError",
		"kind",
	]) {
		it(`carries no '${k}' — no verb-routing, no synthetic identity, no enrich`, () => {
			const out = resolveFactList([], [socketProbe(GID_SOCKET_ONLY, "alive")]);
			expect(k in (out.recordLessSockets[0] as RecordLessSocketFact)).toBe(false);
		});
	}

	it("a dead socket stays surfaced — hiding one is GC's job, never the listing's", () => {
		const dead = resolveFactList([], [socketProbe(GID_SOCKET_ONLY, "dead")]);
		expect(dead.recordLessSockets.length).toBe(1);
	});
});

// The fact-provider listing and the v2 decider dispatch consume this same predicate (4c
// 재유도 금지 동형). The union over socketGids ∪ symlinkedGardenIds is the fact-provider:125
// gap closure: a symlinked socket is never probed, so its gid is absent from socketGids, and
// the predicate must STILL flag an out-of-domain citizen owning it.
describe("isOutOfSocketDomainGardenIdConflict", () => {
	const G = "20260611T444444-dddddd";
	const realSockets = new Set([G]);
	const symlinked = new Set([G]);
	const empty = new Set<string>();

	for (const piBackend of IN_DOMAIN) {
		it(`socket-domain (${piBackend}) is not a record-side conflict`, () => {
			expect(isOutOfSocketDomainGardenIdConflict(piBackend, G, realSockets, symlinked)).toBe(false);
		});
	}

	it("out-of-socket-domain + real socket → conflict", () => {
		expect(isOutOfSocketDomainGardenIdConflict("claude-code", G, realSockets, empty)).toBe(true);
	});

	it("out-of-socket-domain + symlinked socket → conflict", () => {
		expect(isOutOfSocketDomainGardenIdConflict("claude-code", G, empty, symlinked)).toBe(true);
	});

	it("out-of-socket-domain + no socket → no conflict", () => {
		expect(isOutOfSocketDomainGardenIdConflict("claude-code", G, empty, empty)).toBe(false);
	});
});
