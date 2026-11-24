/**
 * peer-presentation.test — what the two human listings show first and what they only count (#173 P2).
 *
 * Subjects: `peer-presentation.ts` (test-room rule, activity time, the selector, the entwurf_peers
 * plan, the bookmark label, the caller directory), the opt-in selector seam of
 * `entwurf-fact-provider.ts`, the planned branch of `entwurf-peers-render.ts`, the window and hidden
 * counts of `resume-picker-rows.ts` / `resume-picker.ts`, and the bounded bookmark reader of
 * `resume-picker-production.ts`.
 *
 * Oracle: literals written here — the ids a plan must print and in which order, the exact text of a
 * rendered listing, how many times each observation was made. Nothing is read back from a subject
 * and compared with itself. The filesystem cells use a private sandbox under the OS temp directory
 * and touch nothing else.
 */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { type EntwurfFactsDeps, listEntwurfFacts } from "./entwurf-fact-provider.ts";
import type { PeerFact } from "./entwurf-facts.ts";
import { renderEntwurfPeers } from "./entwurf-peers-render.ts";
import { UNOBSERVED_PLACEMENT } from "./herdr-placement.ts";
import { type MetaCitizenBackend, type MetaIdentity, serializeMetaIdentity } from "./meta-session.ts";
import {
	activityMsOf,
	bookmarkLabel,
	isTestRoomCwd,
	isWithinWindow,
	makePeerPresentationSelector,
	type PeerPresentation,
	type PresentationIo,
	planPeersDisplay,
	RECENT_WINDOW_MS,
	renderActivity,
	resolvePeersCallerDirectory,
	resolveTempRoots,
	type TranscriptStat,
} from "./peer-presentation.ts";
import { INITIAL_PICKER_STATE, renderPickerFrame } from "./resume-picker.ts";
import { RESUME_BOOKMARK_MAX_BYTES, ResumeBookmarkError, readResumePins } from "./resume-picker-production.ts";
import { buildResumeListing, hiddenResumeCounts, renderResumeRow, visibleResumeRows } from "./resume-picker-rows.ts";

const NOW = Date.parse("2026-11-25T00:00:00.000Z");
const DAY = 24 * 60 * 60 * 1000;

/** A realpath over a table: listed paths resolve to their target, `missing` ones throw, the rest are themselves. */
function realpathOf(links: Record<string, string> = {}, missing: readonly string[] = []) {
	const calls: string[] = [];
	const fn = (p: string): string => {
		calls.push(p);
		if (missing.includes(p)) throw Object.assign(new Error(`ENOENT: ${p}`), { code: "ENOENT" });
		return links[p] ?? p;
	};
	return { fn, calls };
}

const TMP = { lexical: "/tmp", real: "/tmp" };

function identity(over: Partial<MetaIdentity> & Pick<MetaIdentity, "gardenId">): MetaIdentity {
	return {
		schemaVersion: 3,
		backend: "pi",
		nativeSessionId: `n-${over.gardenId}`,
		cwd: "/work/project",
		model: null,
		transcriptPath: null,
		createdAt: "2026-11-01T00:00:00.000Z",
		recordUpdatedAt: "2026-11-01T00:00:00.000Z",
		attachIncarnation: null,
		...over,
	} as MetaIdentity;
}

function peer(over: Partial<PeerFact> & Pick<PeerFact, "gardenId">): PeerFact {
	return {
		backend: "pi",
		nativeSessionId: `n-${over.gardenId}`,
		cwd: "/work/project",
		model: null,
		createdAt: "2026-11-01T00:00:00.000Z",
		recordUpdatedAt: "2026-11-01T00:00:00.000Z",
		liveness: "dead",
		receiver: "n/a",
		transcript: "exists",
		placement: UNOBSERVED_PLACEMENT,
		...over,
	} as PeerFact;
}

interface IoScript {
	tmpdir?: string;
	links?: Record<string, string>;
	missing?: string[];
	stats?: Record<string, TranscriptStat>;
	now?: number;
}

function io(script: IoScript = {}) {
	const rp = realpathOf(script.links, script.missing);
	const stats: string[] = [];
	let nowReads = 0;
	const value: PresentationIo = {
		tmpdir: () => script.tmpdir ?? "/tmp",
		realpath: rp.fn,
		statFile: (file) => {
			stats.push(file);
			return script.stats?.[file] ?? null;
		},
		now: () => {
			nowReads += 1;
			return script.now ?? NOW;
		},
	};
	return { value, realpaths: rp.calls, stats, nowReads: () => nowReads };
}

function presentation(hints: Record<string, { testRoom?: boolean; activityMs?: number | null }>): PeerPresentation {
	return {
		now: NOW,
		tempRoot: "/tmp",
		hints: new Map(
			Object.entries(hints).map(([id, h]) => [id, { testRoom: h.testRoom ?? false, activityMs: h.activityMs ?? null }]),
		),
	};
}

const G = (n: number): string => `202611${String(n).padStart(2, "0")}T000000-${String(n).padStart(6, "a")}`;

describe("test rooms — a record cwd at or under the OS temp directory", () => {
	it("[QK:PEERPRES-TEMP-COMPONENT-BOUNDARY] the temp root and its descendants are test rooms; a sibling that only shares the prefix, and a relative cwd, are not", () => {
		const rp = realpathOf().fn;
		expect(isTestRoomCwd("/tmp", TMP, rp)).toBe(true);
		expect(isTestRoomCwd("/tmp/entwurf-codex-fresh-live/a", TMP, rp)).toBe(true);
		expect(isTestRoomCwd("/tmp-other", TMP, rp)).toBe(false);
		expect(isTestRoomCwd("/tmpx/a", TMP, rp)).toBe(false);
		expect(isTestRoomCwd("/home/u/tmp", TMP, rp)).toBe(false);
		expect(isTestRoomCwd("tmp/a", TMP, rp)).toBe(false);
		expect(isTestRoomCwd("", TMP, rp)).toBe(false);
	});

	it("[QK:PEERPRES-TEMP-REALPATH-BOTH-SIDES] both sides are resolved: a directory outside temp that leads into it is a test room, one inside temp that leads out is not, and an aliased temp root still matches", () => {
		const links = {
			"/home/u/scratch": "/tmp/room",
			"/tmp/escape": "/home/u/real",
			"/var/tmp-alias/x": "/private/var/t/x",
		};
		const rp = realpathOf(links).fn;
		expect(isTestRoomCwd("/home/u/scratch", TMP, rp)).toBe(true);
		expect(isTestRoomCwd("/tmp/escape", TMP, rp)).toBe(false);
		const aliased = resolveTempRoots("/var/t", realpathOf({ "/var/t": "/private/var/t" }).fn);
		expect(aliased).toEqual({ lexical: "/var/t", real: "/private/var/t" });
		expect(isTestRoomCwd("/var/tmp-alias/x", aliased, rp)).toBe(true);
	});

	it("[QK:PEERPRES-TEMP-DELETED-CWD-LEXICAL] a cwd that no longer resolves is compared as written, against the temp root as written and as resolved", () => {
		const roots = { lexical: "/var/t", real: "/private/var/t" };
		const gone = ["/var/t/gone", "/private/var/t/gone", "/var/t-other/gone", "/home/u/gone"];
		const rp = realpathOf({}, gone).fn;
		expect(isTestRoomCwd("/var/t/gone", roots, rp)).toBe(true);
		expect(isTestRoomCwd("/private/var/t/gone", roots, rp)).toBe(true);
		expect(isTestRoomCwd("/var/t-other/gone", roots, rp)).toBe(false);
		expect(isTestRoomCwd("/home/u/gone", roots, rp)).toBe(false);
	});

	it("[QK:PEERPRES-TEMP-ROOT-DISABLED] a temp root that is relative, is `/` or resolves to `/` switches the rule off, and then nothing is a test room", () => {
		expect(resolveTempRoots("tmp", realpathOf().fn)).toBeNull();
		expect(resolveTempRoots("/", realpathOf().fn)).toBeNull();
		expect(resolveTempRoots("/weird", realpathOf({ "/weird": "/" }).fn)).toBeNull();
		expect(resolveTempRoots("/tmp/", realpathOf().fn)).toEqual({ lexical: "/tmp", real: "/tmp" });
		expect(isTestRoomCwd("/tmp/a", null, realpathOf().fn)).toBe(false);
		expect(isTestRoomCwd("/anything", null, realpathOf().fn)).toBe(false);
	});
});

describe("activity — the time a row is ordered and windowed by", () => {
	it("[QK:PEERPRES-ACTIVITY-FALLBACK-CHAIN] the current transcript's mtime when it is a regular file; otherwise the record's update time; otherwise unknown — with at most one stat, and none for a relative or absent path", () => {
		const recorded = Date.parse("2026-11-01T00:00:00.000Z");
		const run = (transcriptPath: string | null, stat: TranscriptStat, recordUpdatedAt = "2026-11-01T00:00:00.000Z") => {
			const asked: string[] = [];
			const value = activityMsOf({ transcriptPath, recordUpdatedAt }, (file) => {
				asked.push(file);
				return stat;
			});
			return { value, asked };
		};
		expect(run("/s/a.jsonl", { isFile: true, mtimeMs: 1234 })).toEqual({ value: 1234, asked: ["/s/a.jsonl"] });
		expect(run("/s/a.jsonl", null)).toEqual({ value: recorded, asked: ["/s/a.jsonl"] });
		expect(run("/s/a.jsonl", { isFile: false, mtimeMs: 1234 })).toEqual({ value: recorded, asked: ["/s/a.jsonl"] });
		expect(run("/s/a.jsonl", { isFile: true, mtimeMs: Number.NaN }).value).toBe(recorded);
		expect(run(null, { isFile: true, mtimeMs: 1234 })).toEqual({ value: recorded, asked: [] });
		expect(run("relative/a.jsonl", { isFile: true, mtimeMs: 1234 })).toEqual({ value: recorded, asked: [] });
		expect(run(null, null, "not a date").value).toBeNull();
	});

	it("[QK:PEERPRES-WINDOW-INCLUSIVE] exactly seven days is inside, one millisecond more is outside, a time ahead of the clock is inside, and an unknown time is never outside", () => {
		expect(RECENT_WINDOW_MS).toBe(604800000);
		expect(isWithinWindow(NOW - 7 * DAY, NOW, RECENT_WINDOW_MS)).toBe(true);
		expect(isWithinWindow(NOW - 7 * DAY + 1, NOW, RECENT_WINDOW_MS)).toBe(true);
		expect(isWithinWindow(NOW - 7 * DAY - 1, NOW, RECENT_WINDOW_MS)).toBe(false);
		expect(isWithinWindow(NOW + DAY, NOW, RECENT_WINDOW_MS)).toBe(true);
		expect(isWithinWindow(null, NOW, RECENT_WINDOW_MS)).toBe(true);
	});

	it("[QK:PEERPRES-ACTIVITY-RENDER-UTC] an activity time is printed in UTC to the minute with one Z, and an unknown one as the word", () => {
		expect(renderActivity(Date.parse("2026-11-24T18:06:59.999Z"))).toBe("2026-11-24T18:06Z");
		expect(renderActivity(Date.parse("2026-11-25T03:06:00+09:00"))).toBe("2026-11-24T18:06Z");
		expect(renderActivity(null)).toBe("unknown");
		expect(renderActivity(Number.NaN)).toBe("unknown");
	});
});

describe("the selector — which citizens are observed", () => {
	const ROOM = identity({ gardenId: G(1), cwd: "/tmp/room", transcriptPath: "/s/room.jsonl" });
	const REAL = identity({ gardenId: G(2), cwd: "/work/project", transcriptPath: "/s/real.jsonl" });
	const OLD = identity({ gardenId: G(3), cwd: "/work/project", recordUpdatedAt: "2026-11-10T00:00:00.000Z" });

	it("[QK:PEERPRES-SELECTOR-TEST-ROOM-ZERO-COST] an unbookmarked test room costs one realpath and nothing else: no stat, no observation, no activity time", () => {
		const h = io({ stats: { "/s/real.jsonl": { isFile: true, mtimeMs: NOW - DAY } } });
		const selected = makePeerPresentationSelector({ pinnedIds: new Set(), io: h.value }).select([ROOM, REAL]);
		const out = selected.finish([]);
		expect([...selected.observe]).toEqual([G(2)]);
		expect(h.stats).toEqual(["/s/real.jsonl"]);
		expect(h.realpaths).toEqual(["/tmp", "/tmp/room", "/work/project"]);
		expect(out.hints.get(G(1))).toEqual({ testRoom: true, activityMs: null });
		expect(out.hints.get(G(2))).toEqual({ testRoom: false, activityMs: NOW - DAY });
		expect(out.tempRoot).toBe("/tmp");
	});

	it("[QK:PEERPRES-SELECTOR-PIN-BEATS-TEMP] a bookmarked test room is observed and its transcript stat'ed like any other citizen", () => {
		const h = io({ stats: { "/s/room.jsonl": { isFile: true, mtimeMs: NOW - 30 * DAY } } });
		const selected = makePeerPresentationSelector({
			pinnedIds: new Set([G(1)]),
			io: h.value,
			observeWithinMs: RECENT_WINDOW_MS,
		}).select([ROOM]);
		expect([...selected.observe]).toEqual([G(1)]);
		expect(h.stats).toEqual(["/s/room.jsonl"]);
		expect(selected.finish([]).hints.get(G(1))).toEqual({ testRoom: true, activityMs: NOW - 30 * DAY });
	});

	it("[QK:PEERPRES-SELECTOR-WINDOW-OBSERVE] with a window an unbookmarked citizen quiet for longer is not observed; without one it is; the clock is read once per listing", () => {
		const windowed = io();
		const a = makePeerPresentationSelector({
			pinnedIds: new Set(),
			io: windowed.value,
			observeWithinMs: RECENT_WINDOW_MS,
		}).select([REAL, OLD]);
		// REAL has no stat answer, so its activity is its record time (2026-11-01): outside too.
		expect([...a.observe]).toEqual([]);
		expect(windowed.nowReads()).toBe(1);

		const recent = io({ stats: { "/s/real.jsonl": { isFile: true, mtimeMs: NOW - 7 * DAY } } });
		const b = makePeerPresentationSelector({
			pinnedIds: new Set(),
			io: recent.value,
			observeWithinMs: RECENT_WINDOW_MS,
		}).select([REAL, OLD]);
		expect([...b.observe]).toEqual([G(2)]);

		const unwindowed = io();
		const c = makePeerPresentationSelector({ pinnedIds: new Set(), io: unwindowed.value }).select([REAL, OLD]);
		expect([...c.observe]).toEqual([G(2), G(3)]);
	});
});

describe("the entwurf_peers plan — which rows, in which order", () => {
	it("[QK:PEERPRES-PLAN-ORDER] bookmarks in file order, then observed live, then activity newest first with unknown last, then garden id newest first", () => {
		const peers = [
			peer({ gardenId: G(1), receiver: "active", backend: "pi-durable" }), // old id, live by receiver
			peer({ gardenId: G(2) }), // activity unknown
			peer({ gardenId: G(3) }), // most recent activity
			peer({ gardenId: G(4) }), // tie with G(5)
			peer({ gardenId: G(5) }),
			peer({ gardenId: G(6), liveness: "alive" }), // live by socket, quiet for a month
			peer({ gardenId: G(7) }), // bookmarked second
			peer({ gardenId: G(8) }), // bookmarked first, the oldest activity of all
			peer({ gardenId: G(9) }), // newest id, old activity
		];
		const plan = planPeersDisplay(
			peers,
			presentation({
				[G(1)]: { activityMs: NOW - 20 * DAY },
				[G(2)]: { activityMs: null },
				[G(3)]: { activityMs: NOW - 1 },
				[G(4)]: { activityMs: NOW - DAY },
				[G(5)]: { activityMs: NOW - DAY },
				[G(6)]: { activityMs: NOW - 30 * DAY },
				[G(7)]: { activityMs: NOW - 2 * DAY },
				[G(8)]: { activityMs: NOW - 90 * DAY },
				[G(9)]: { activityMs: NOW - 40 * DAY },
			}),
			[
				{ gardenId: G(8), name: "first" },
				{ gardenId: G(7), name: "second" },
				{ gardenId: G(8), name: "again" },
			],
			32,
		);
		expect(plan.rows.map((r) => r.peer.gardenId)).toEqual([G(8), G(7), G(1), G(6), G(3), G(5), G(4), G(9), G(2)]);
		expect(plan.rows.map((r) => r.bookmark)).toEqual(["first", "second", null, null, null, null, null, null, null]);
		expect(plan.outsideBudget).toBe(0);
	});

	it("[QK:PEERPRES-PLAN-BUDGET] the budget cuts after the order: 31 and 32 candidates all print, the 33rd is counted, and more bookmarks than rows leave no row for a live citizen", () => {
		const hints = (n: number) =>
			presentation(Object.fromEntries(Array.from({ length: n }, (_, i) => [G(i + 1), { activityMs: NOW - i * 1000 }])));
		const many = (n: number) => Array.from({ length: n }, (_, i) => peer({ gardenId: G(i + 1) }));
		for (const [n, shown, outside] of [
			[31, 31, 0],
			[32, 32, 0],
			[33, 32, 1],
		] as const) {
			const plan = planPeersDisplay(many(n), hints(n), [], 32);
			expect(plan.rows.length, String(n)).toBe(shown);
			expect(plan.outsideBudget, String(n)).toBe(outside);
		}
		// The 33rd by activity is the one left out, not the 33rd by garden id.
		expect(planPeersDisplay(many(33), hints(33), [], 32).rows.some((r) => r.peer.gardenId === G(33))).toBe(false);

		const crowded = [...many(3), peer({ gardenId: G(40), liveness: "alive" })];
		const plan = planPeersDisplay(
			crowded,
			hints(40),
			[1, 2, 3].map((n) => ({ gardenId: G(n), name: `b${n}` })),
			3,
		);
		expect(plan.rows.map((r) => r.peer.gardenId)).toEqual([G(1), G(2), G(3)]);
		expect(plan.outsideBudget).toBe(1);
	});

	it("[QK:PEERPRES-PLAN-TEST-ROOMS-COUNTED] unbookmarked test rooms are counted and never rows, however new their garden ids; a bookmarked one is a row; a bookmark with no record is only counted", () => {
		const peers = [
			peer({ gardenId: G(1) }),
			peer({ gardenId: G(20), cwd: "/tmp/a" }),
			peer({ gardenId: G(21), cwd: "/tmp/b" }),
			peer({ gardenId: G(22), cwd: "/tmp/c" }),
		];
		const plan = planPeersDisplay(
			peers,
			presentation({
				[G(1)]: { activityMs: NOW - 5 * DAY },
				[G(20)]: { testRoom: true },
				[G(21)]: { testRoom: true },
				[G(22)]: { testRoom: true, activityMs: NOW },
			}),
			[
				{ gardenId: G(22), name: "kept room" },
				{ gardenId: "20260101T000000-ffffff", name: "ghost" },
			],
			32,
		);
		expect(plan.rows.map((r) => r.peer.gardenId)).toEqual([G(22), G(1)]);
		expect(plan.testRooms).toBe(2);
		expect(plan.outsideBudget).toBe(0);
		expect(plan.bookmarksWithoutRecord).toBe(1);
	});
});

// ── the provider seam, over the real assembly ────────────────────────────────────────────────────

function record(gardenId: string, backend: MetaCitizenBackend, cwd: string): string {
	return serializeMetaIdentity({
		schemaVersion: 3,
		gardenId,
		backend,
		nativeSessionId: `n-${gardenId}`,
		cwd,
		model: null,
		transcriptPath: null,
		createdAt: "2026-11-01T00:00:00.000Z",
		recordUpdatedAt: "2026-11-20T00:00:00.000Z",
		attachIncarnation: null,
	});
}

const P_REAL = "20261110T000000-aaaaaa";
const P_ROOM = "20261120T000000-bbbbbb";
const P_PINNED_ROOM = "20261121T000000-cccccc";
const P_CONFLICT = "20261122T000000-dddddd";

function providerDeps(): { deps: EntwurfFactsDeps; observed: string[] } {
	const meta: Record<string, string> = {
		[`${P_REAL}.meta.json`]: record(P_REAL, "claude-code", "/work/project"),
		[`${P_ROOM}.meta.json`]: record(P_ROOM, "claude-code", "/tmp/room"),
		[`${P_PINNED_ROOM}.meta.json`]: record(P_PINNED_ROOM, "claude-code", "/tmp/kept"),
		[`${P_CONFLICT}.meta.json`]: record(P_CONFLICT, "claude-code", "/work/project"),
	};
	const observed: string[] = [];
	return {
		observed,
		deps: {
			metaEntries: Object.keys(meta).map((filename) => ({ filename, regularFile: true })),
			readRecord: (f) => meta[f] as string,
			observe: (id) => {
				observed.push(id.gardenId);
				return { receiver: "inactive", transcript: "exists", placement: UNOBSERVED_PLACEMENT };
			},
			socket: {
				dir: "/fake/control",
				// A control socket sharing a claude-code record's garden id: both sides are quarantined.
				readdir: async () => [{ name: `${P_CONFLICT}.sock`, isSymbolicLink: false }],
				probe: async () => "alive" as const,
			},
		},
	};
}

describe("the provider seam — opt-in, after certification", () => {
	it("[QK:PEERPRES-SEAM-DEFAULT-UNCHANGED] with no selector the provider result is what it was: every row observed, the same order and diagnostics, and no presentation member", async () => {
		const plain = providerDeps();
		const result = await listEntwurfFacts(plain.deps);
		expect(Object.keys(result).sort()).toEqual(["diagnostics", "facts"]);
		expect(result.facts.peers.map((p) => [p.gardenId, p.receiver])).toEqual([
			[P_REAL, "inactive"],
			[P_ROOM, "inactive"],
			[P_PINNED_ROOM, "inactive"],
		]);
		expect(plain.observed).toEqual([P_REAL, P_ROOM, P_PINNED_ROOM]);
		expect(result.diagnostics.map((d) => d.kind)).toEqual(["garden-id-socket-conflict"]);
	});

	it("[QK:PEERPRES-SEAM-RENDERED-SUBSET-OF-OBSERVED] with the selector every row the plan prints was observed, an unbookmarked test room is not observed and reads `unobserved` rather than a made-up state, and the rows, their order and the diagnostics are the same", async () => {
		const with_ = providerDeps();
		const h = io({ now: NOW });
		const pins = [{ gardenId: P_PINNED_ROOM, name: "kept" }];
		const result = await listEntwurfFacts({
			...with_.deps,
			presentation: makePeerPresentationSelector({ pinnedIds: new Set([P_PINNED_ROOM]), io: h.value }),
		});
		expect(with_.observed).toEqual([P_REAL, P_PINNED_ROOM]);
		expect(result.facts.peers.map((p) => [p.gardenId, p.receiver])).toEqual([
			[P_REAL, "inactive"],
			[P_ROOM, "unobserved"],
			[P_PINNED_ROOM, "inactive"],
		]);
		expect(result.diagnostics.map((d) => d.kind)).toEqual(["garden-id-socket-conflict"]);
		const plan = planPeersDisplay(result.facts.peers, result.presentation as PeerPresentation, pins, 32);
		expect(plan.rows.map((r) => r.peer.gardenId)).toEqual([P_PINNED_ROOM, P_REAL]);
		expect(plan.rows.every((r) => with_.observed.includes(r.peer.gardenId))).toBe(true);
		expect(plan.testRooms).toBe(1);
	});

	it("[QK:PEERPRES-SEAM-AFTER-QUARANTINE] the selector is handed only certified, unquarantined identities — a conflicted garden id never reaches it", async () => {
		const d = providerDeps();
		const seen: string[] = [];
		await listEntwurfFacts({
			...d.deps,
			presentation: {
				select: (identities) => {
					seen.push(...identities.map((i) => i.gardenId));
					return { observe: new Set<string>(), finish: () => null };
				},
			},
		});
		expect(seen).toEqual([P_REAL, P_ROOM, P_PINNED_ROOM]);
	});

	it("[QK:PEERPRES-SEAM-EXCLUSIVE] a selector together with an observation limit is refused: both ration the same observations", async () => {
		const d = providerDeps();
		await expect(
			listEntwurfFacts({
				...d.deps,
				observationLimit: 32,
				presentation: { select: () => ({ observe: new Set<string>(), finish: () => null }) },
			}),
		).rejects.toThrow("presentation and observationLimit both ration observation");
	});
});

// ── the text ─────────────────────────────────────────────────────────────────────────────────────

const ROW_A = peer({ gardenId: G(8), backend: "pi-durable", receiver: "active", cwd: "/work/project" });
const ROW_B = peer({ gardenId: G(3), liveness: "dead", cwd: "/work/other", model: "provider/model-a" });

describe("the entwurf_peers text", () => {
	it("[QK:PEERPRES-RENDER-NO-PLAN-UNCHANGED] without a plan the text is the listing it was: fact rows in provider order, no activity, no bookmark, no counted remainder", () => {
		const { text, payload } = renderEntwurfPeers({
			facts: { peers: [ROW_B, ROW_A], recordLessSockets: [] },
			diagnostics: [],
		});
		expect(text).toBe(
			[
				"Garden citizens (meta-record):",
				`- ${G(3)}  backend=pi  liveness=dead  receiver=n/a  transcript=exists  cwd=/work/other  model=provider/model-a  placement=unobserved`,
				`- ${G(8)}  backend=pi-durable  liveness=dead  receiver=active  transcript=exists  cwd=/work/project  model=(unknown)  placement=unobserved`,
				"",
				"Diagnostics:",
				"  (none)",
			].join("\n"),
		);
		expect(payload.peers.map((p) => p.gardenId)).toEqual([G(3), G(8)]);
	});

	it("[QK:PEERPRES-RENDER-PLAN-TEXT] with a plan the text is the plan's rows in the plan's order, each with its activity and bookmark, then what was left out, counted — and the payload is still every row", () => {
		const hidden = peer({ gardenId: G(20), cwd: "/tmp/a" });
		const plan = planPeersDisplay(
			[ROW_B, ROW_A, hidden, peer({ gardenId: G(2) })],
			presentation({
				[G(8)]: { activityMs: Date.parse("2026-10-01T09:30:00Z") },
				[G(3)]: { activityMs: Date.parse("2026-11-24T18:06:00Z") },
				[G(20)]: { testRoom: true },
				[G(2)]: { activityMs: null },
			}),
			[
				{ gardenId: G(8), name: "운영코디" },
				{ gardenId: "20260101T000000-ffffff", name: "ghost" },
			],
			2,
		);
		const { text, payload } = renderEntwurfPeers(
			{ facts: { peers: [ROW_B, ROW_A, hidden], recordLessSockets: [] }, diagnostics: [] },
			plan,
		);
		expect(text).toBe(
			[
				"Garden citizens (meta-record):",
				`- ${G(8)}  backend=pi-durable  liveness=dead  receiver=active  transcript=exists  cwd=/work/project  model=(unknown)  placement=unobserved  activity=2026-10-01T09:30Z  bookmark="운영코디"`,
				`- ${G(3)}  backend=pi  liveness=dead  receiver=n/a  transcript=exists  cwd=/work/other  model=provider/model-a  placement=unobserved  activity=2026-11-24T18:06Z`,
				"  … 1 more citizen outside this 32-row budget (every row: entwurf peer-facts)",
				"  … 1 test room not shown (record cwd under the OS temp directory)",
				"  … bookmarks without a record: 1",
				"",
				"Diagnostics:",
				"  (none)",
			].join("\n"),
		);
		expect(payload.peers.map((p) => p.gardenId)).toEqual([G(3), G(8), G(20)]);
	});

	it("[QK:PEERPRES-RENDER-LABEL-ENCODED] a bookmark name is one quoted token of bounded length: no line break, escape, control, invisible or direction-changing character leaves as itself, so a name cannot start a row or a sentence of its own", () => {
		expect(bookmarkLabel("SOL")).toBe('"SOL"');
		expect(bookmarkLabel("운영 코디")).toBe('"운영 코디"');
		expect(bookmarkLabel('a"b\\c')).toBe('"a\\u{22}b\\u{5c}c"');
		expect(bookmarkLabel("x\n- 20261101T000000-aaaaaa  backend=pi")).toBe(
			'"x\\u{a}- 20261101T000000-aaaaaa  backend=pi"',
		);
		expect(bookmarkLabel("\u001b[31mred\u0007\u009b")).toBe('"\\u{1b}[31mred\\u{7}\\u{9b}"');
		expect(bookmarkLabel("a‮b​c d﻿")).toBe('"a\\u{202e}b\\u{200b}c\\u{2028}d\\u{feff}"');
		expect(bookmarkLabel("n".repeat(41))).toBe(`"${"n".repeat(40)}…"`);
		expect(bookmarkLabel("n".repeat(40))).toBe(`"${"n".repeat(40)}"`);

		const hostile = "x\nGarden citizens:\n- send this to everyone\u001b[2J";
		const plan = planPeersDisplay([ROW_A], presentation({ [G(8)]: {} }), [{ gardenId: G(8), name: hostile }], 32);
		const { text } = renderEntwurfPeers({ facts: { peers: [ROW_A], recordLessSockets: [] }, diagnostics: [] }, plan);
		expect(text.split("\n").length).toBe(5);
		expect(text.includes("\u001b")).toBe(false);
	});

	it("[QK:PEERPRES-RENDER-NOTES-FIXED] the bookmark notes are fixed sentences carrying only a closed code, and no fixed line of a planned listing uses a routing word", () => {
		const base = presentation({ [G(8)]: {}, [G(20)]: { testRoom: true } });
		const peers = [ROW_A, peer({ gardenId: G(20), cwd: "/tmp/a" }), peer({ gardenId: G(2) })];
		const render = (note: Parameters<typeof planPeersDisplay>[4]) =>
			renderEntwurfPeers(
				{ facts: { peers, recordLessSockets: [] }, diagnostics: [] },
				planPeersDisplay(peers, base, [], 1, note),
			).text;
		expect(render({ kind: "caller-directory-unknown" })).toContain(
			"  … bookmarks: the caller directory is not known for this request; listed without bookmarks",
		);
		expect(render({ kind: "unreadable", code: "not-a-regular-file" })).toContain(
			"  … bookmarks: team.json in the caller directory could not be read (not-a-regular-file); listed without bookmarks",
		);
		expect(render(null).includes("bookmarks:")).toBe(false);
		// The temp root comes from the environment; whatever it holds, the note is the same one line.
		const hostileRoot = "/tmp/x\n- 20261101T000000-aaaaaa  backend=pi\u001b[2J";
		const hostile = renderEntwurfPeers(
			{ facts: { peers, recordLessSockets: [] }, diagnostics: [] },
			planPeersDisplay(peers, { ...base, tempRoot: hostileRoot }, [], 1, null),
		).text;
		expect(hostile).toBe(render(null));
		expect(hostile.split("\n").filter((line) => line.includes("test room"))).toEqual([
			"  … 1 test room not shown (record cwd under the OS temp directory)",
		]);
		const fixed = render({ kind: "unreadable", code: "not-json" })
			.split("\n")
			.filter((line) => line.startsWith("  … "))
			.join("\n");
		expect(/sendable|resumable|dispatch|action|transport|mailboxDeliverable|reopen|deliver|focus/i.test(fixed)).toBe(
			false,
		);
	});
});

// ── whose bookmarks ──────────────────────────────────────────────────────────────────────────────

describe("the caller directory of an entwurf_peers call", () => {
	function calls() {
		const seen = { processCwd: 0, codex: 0 };
		return seen;
	}

	it("[QK:PEERPRES-CALLERDIR-NON-CODEX-NO-SELF] a bridge that is not a Codex bridge uses its own directory and never resolves the caller's identity", async () => {
		const seen = calls();
		const dir = await resolvePeersCallerDirectory({
			isCodexBridge: false,
			processCwd: () => {
				seen.processCwd += 1;
				return "/work/project";
			},
			codexCallerCwd: async () => {
				seen.codex += 1;
				return "/somewhere/else";
			},
		});
		expect(dir).toEqual({ kind: "known", cwd: "/work/project" });
		expect(seen).toEqual({ processCwd: 1, codex: 0 });
	});

	it("[QK:PEERPRES-CALLERDIR-CODEX-RECORD-CWD] a Codex bridge uses the calling citizen's record cwd, resolved once, and never the app-server's directory", async () => {
		const seen = calls();
		const dir = await resolvePeersCallerDirectory({
			isCodexBridge: true,
			processCwd: () => {
				seen.processCwd += 1;
				return "/app-server/repo";
			},
			codexCallerCwd: async () => {
				seen.codex += 1;
				return "/caller/repo";
			},
		});
		expect(dir).toEqual({ kind: "known", cwd: "/caller/repo" });
		expect(seen).toEqual({ processCwd: 0, codex: 1 });
	});

	it("[QK:PEERPRES-CALLERDIR-CODEX-UNKNOWN] a Codex bridge whose caller cannot be resolved has no caller directory — never the app-server's as a stand-in", async () => {
		for (const codexCallerCwd of [
			async () => undefined,
			async () => {
				throw new Error("no record for this thread");
			},
		]) {
			let processCwd = 0;
			const dir = await resolvePeersCallerDirectory({
				isCodexBridge: true,
				processCwd: () => {
					processCwd += 1;
					return "/app-server/repo";
				},
				codexCallerCwd,
			});
			expect(dir).toEqual({ kind: "unknown" });
			expect(processCwd).toBe(0);
		}
	});
});

// ── the bookmark file as an I/O boundary ─────────────────────────────────────────────────────────

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), "peer-presentation-"));
afterAll(() => {
	fs.rmSync(SANDBOX, { recursive: true, force: true });
});

function sandboxDir(name: string): string {
	const dir = path.join(SANDBOX, name);
	fs.mkdirSync(dir, { mode: 0o700 });
	return dir;
}

function refusalCode(dir: string): string {
	try {
		readResumePins(dir);
	} catch (err) {
		if (err instanceof ResumeBookmarkError) return err.code;
		throw err;
	}
	return "(no refusal)";
}

describe("the bookmark file — a regular file of bounded size, or refused by name", () => {
	it("[QK:PEERPRES-BOOKMARK-NON-REGULAR-REFUSED] a FIFO, a directory and a symlink named team.json are refused without being read or followed, and the read returns", () => {
		const fifo = sandboxDir("fifo");
		execFileSync("mkfifo", [path.join(fifo, "team.json")]);
		const dir = sandboxDir("dir");
		fs.mkdirSync(path.join(dir, "team.json"));
		const link = sandboxDir("link");
		const target = path.join(SANDBOX, "real-team.json");
		fs.writeFileSync(target, JSON.stringify({ members: [{ garden_id: G(1), name: "followed" }] }));
		fs.symlinkSync(target, path.join(link, "team.json"));
		// A FIFO with no writer blocks a plain read forever; reaching the next line is the proof.
		expect(refusalCode(fifo)).toBe("not-a-regular-file");
		expect(refusalCode(dir)).toBe("not-a-regular-file");
		expect(refusalCode(link)).toBe("not-a-regular-file");
	});

	it("[QK:PEERPRES-BOOKMARK-BOUNDED] a regular team.json is read whole up to the limit and refused above it; an absent one is no bookmarks", () => {
		const good = sandboxDir("good");
		fs.writeFileSync(
			path.join(good, "team.json"),
			JSON.stringify({ members: [{ garden_id: G(1), name: "운영코디" }] }),
		);
		expect(readResumePins(good)).toEqual([{ gardenId: G(1), name: "운영코디" }]);
		expect(readResumePins(sandboxDir("absent"))).toEqual([]);
		expect(RESUME_BOOKMARK_MAX_BYTES).toBe(1048576);
		const big = sandboxDir("big");
		fs.writeFileSync(path.join(big, "team.json"), Buffer.alloc(RESUME_BOOKMARK_MAX_BYTES + 1, 0x20));
		expect(refusalCode(big)).toBe("too-large");
		const edge = sandboxDir("edge");
		const body = JSON.stringify({ members: [] });
		fs.writeFileSync(path.join(edge, "team.json"), body + " ".repeat(RESUME_BOOKMARK_MAX_BYTES - body.length));
		expect(readResumePins(edge)).toEqual([]);
	});
});

// ── the picker ───────────────────────────────────────────────────────────────────────────────────

const HERE = "/work/project";
const THERE = "/work/other";

describe("the entwurf resume list — seven days, test rooms, bookmarks", () => {
	const facts = [
		peer({ gardenId: G(1), cwd: HERE }), // exactly seven days
		peer({ gardenId: G(2), cwd: HERE }), // one millisecond older
		peer({ gardenId: G(3), cwd: HERE }), // unknown activity
		peer({ gardenId: G(4), cwd: HERE }), // bookmarked, a year old
		peer({ gardenId: G(5), cwd: "/tmp/room" }), // test room, elsewhere
		peer({ gardenId: G(6), cwd: "/tmp/kept" }), // bookmarked test room
		peer({ gardenId: G(7), cwd: THERE }), // old, elsewhere
		peer({ gardenId: G(8), cwd: HERE }), // an hour ago
		peer({ gardenId: G(9), cwd: HERE, backend: "codex" as PeerFact["backend"] }), // not a listed backend
	];
	const hints = presentation({
		[G(1)]: { activityMs: NOW - 7 * DAY },
		[G(2)]: { activityMs: NOW - 7 * DAY - 1 },
		[G(3)]: { activityMs: null },
		[G(4)]: { activityMs: NOW - 365 * DAY },
		[G(5)]: { testRoom: true },
		[G(6)]: { testRoom: true, activityMs: NOW - 30 * DAY },
		[G(7)]: { activityMs: NOW - 8 * DAY },
		[G(8)]: { activityMs: NOW - 60 * 60 * 1000 },
		[G(9)]: { activityMs: NOW - 400 * DAY },
	});
	const pins = [
		{ gardenId: G(4), name: "old friend" },
		{ gardenId: G(6), name: "kept room" },
	];
	const listing = buildResumeListing(facts, HERE, pins, hints);

	it("[QK:PEERPRES-PICKER-WINDOW] an unbookmarked row is listed when active within seven days inclusive or of unknown activity, most recent first; a bookmark is listed once whatever its age; the rest are hidden by reason and scope", () => {
		expect(listing.rows.map((r) => [r.gardenId, r.section])).toEqual([
			[G(4), "pin-here"],
			[G(6), "pin-elsewhere"],
			[G(8), "here"],
			[G(1), "here"],
			[G(3), "here"],
		]);
		expect(hiddenResumeCounts(listing, false)).toEqual({ older: 1, "test-room": 0 });
		expect(hiddenResumeCounts(listing, true)).toEqual({ older: 2, "test-room": 1 });
		expect(listing.unlisted).toEqual([{ backend: "codex", here: true }]);
		const all = visibleResumeRows(listing, { allDirectories: true, query: "" }).map((r) => r.gardenId);
		expect(all).toEqual([G(4), G(6), G(8), G(1), G(3)]);
	});

	it("[QK:PEERPRES-PICKER-NO-HINTS-HIDES-NOTHING] without presentation hints nothing is hidden and a row's activity is its record's update time", () => {
		const bare = buildResumeListing(facts, HERE, [], null);
		expect(bare.hidden).toEqual([]);
		expect(bare.rows.length).toBe(8);
		expect(bare.rows.every((r) => r.activityMs === Date.parse("2026-11-01T00:00:00.000Z"))).toBe(true);
	});

	it("[QK:PEERPRES-PICKER-ROW-ACTIVITY] a row prints the activity time it is ordered by, in UTC, and never the record's update time in its place", () => {
		const row = listing.rows.find((r) => r.gardenId === G(8));
		expect(renderResumeRow(row as never)).toBe(`${G(8)}  pi           socket dead           2026-11-24T23:00Z`);
		const unknown = listing.rows.find((r) => r.gardenId === G(3));
		expect(renderResumeRow(unknown as never)).toBe(`${G(3)}  pi           socket dead           unknown`);
	});

	it("[QK:PEERPRES-PICKER-FRAME-64] at 64 columns the note line states what the list left out, first, as a display rule and nothing else", () => {
		const frame = renderPickerFrame(listing, INITIAL_PICKER_STATE, { columns: 64, rows: 12 }, "tmux").lines;
		expect(frame[frame.length - 3]).toBe("not shown: 1 older than 7 days | 1 citizen of other backends is ");
		const wide = renderPickerFrame(
			listing,
			{ ...INITIAL_PICKER_STATE, allDirectories: true },
			{ columns: 64, rows: 12 },
			"tmux",
		).lines;
		expect(wide[wide.length - 3]).toBe("not shown: 2 older than 7 days, 1 test room | 1 citizen of other");
		const none = renderPickerFrame(
			buildResumeListing([facts[7] as PeerFact], HERE, [], hints),
			INITIAL_PICKER_STATE,
			{ columns: 64, rows: 12 },
			"tmux",
		).lines;
		expect(none[none.length - 3]).toBe("");
		expect(frame.every((line) => line.length <= 64)).toBe(true);
	});
});
