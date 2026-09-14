/**
 * check-herdr-placement — deterministic gate for the #116 S1 placement evidence axis
 * (`pi-extensions/lib/herdr-placement.ts` + the one read the provider is allowed).
 *
 * SCOPE DISCIPLINE. This gate pins only what is decidable WITHOUT a herdr binary: the
 * payload parse, the two backend join rules, the ambiguity rule, the four-word
 * observation vocabulary, the render, and the structural absence of placement from the
 * dispatch path. There is no fake herdr here, for the same reason
 * `scripts/check-mux-placement.ts:6-9` refuses a fake tmux — a stand-in would author
 * the contract before the real thing was measured. The real-binary half is an isolated
 * private herdr server (measured possible on 2026-09-14: sandbox `HOME`/`XDG_CONFIG_HOME`,
 * no client attach, operator server untouched), and the callback/join round trip stays
 * LIVE. Every payload literal below is a VERBATIM shape recorded from herdr 0.9.0 on
 * 2026-09-14, not an invented one.
 *
 * Each claim carries its QK token on exactly ONE assertion.
 *
 *   HP-JOIN-CLAUDE-EXACT     a `kind:"id"` pane joins on byte equality, nothing looser
 *   HP-JOIN-PI-FILENAME      a `kind:"path"` pane joins only on a well-formed uuid tail
 *   HP-JOIN-NEVER-GUESSES    an unmeasured kind / malformed name yields NO key, never a
 *                            plausible substring
 *   HP-AMBIGUOUS-NOT-A-PANE  two panes claiming one key resolve to `ambiguous`, never to
 *                            one of them
 *   HP-UNREADABLE-IS-UNOBSERVED  a payload we cannot read means nobody looked, never
 *                            "herdr has none of your citizens"
 *   HP-NO-HERDR-IS-UNOBSERVED    a null index leaves every citizen `unobserved`, and the
 *                            listing does not refuse
 *   HP-PLACEMENT-NOT-DISPATCH    the dispatch path never imports the placement axis
 *   HP-ONE-READ-PER-LISTING      the provider reads the placement owner exactly once for
 *                            a whole listing — the anti-watcher rule in code
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { type EntwurfFactsDeps, listEntwurfFacts } from "../pi-extensions/lib/entwurf-fact-provider.ts";
import {
	buildPlacementIndex,
	type HerdrPaneRow,
	joinKeyOf,
	parseHerdrPaneList,
	piNativeSessionIdFromPath,
	renderPlacement,
	resolvePlacement,
} from "../pi-extensions/lib/herdr-placement.ts";
import { type MetaIdentity, serializeMetaIdentity } from "../pi-extensions/lib/meta-session.ts";

const REPO_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

let passed = 0;
function ok(label: string, cond: boolean): void {
	assert.ok(cond, label);
	console.log(`  ok    ${label}`);
	passed++;
}

/** Measured 2026-09-14, herdr 0.9.0: the claude pane carries the vendor uuid directly. */
const CLAUDE_NATIVE = "8f72ce79-b9dc-4607-83a8-fcc4aeceea69";
/** Measured the same day: the pi pane carries the session JSONL PATH, uuid inside. */
const PI_NATIVE = "01a09e58-f06a-70e8-b14a-1f0f0c7f7c7d";
const PI_PATH = `/home/junghan/.pi/agent/sessions/--home-junghan-repos-gh-entwurf--/2026-09-14T05-17-03-979Z_${PI_NATIVE}.jsonl`;

function identity(nativeSessionId: string, backend: MetaIdentity["backend"] = "claude-code"): MetaIdentity {
	return {
		schemaVersion: 3,
		gardenId: `20260914T000000-${nativeSessionId.slice(0, 6)}`,
		backend,
		nativeSessionId,
		cwd: "/x",
		model: null,
		transcriptPath: null,
		createdAt: "2026-09-14T00:00:00.000Z",
		recordUpdatedAt: "2026-09-14T00:00:00.000Z",
	};
}

function row(paneId: string, kind: HerdrPaneRow["sessionKind"], value: string | null): HerdrPaneRow {
	return { paneId, sessionKind: kind, sessionValue: value };
}

async function main(): Promise<void> {
	// ── 1. the payload parse ────────────────────────────────────────────────────
	{
		// VERBATIM `herdr pane list` output, herdr 0.9.0, 2026-09-14 (fields trimmed to the
		// ones this join reads — the parser ignores the rest by contract).
		const real =
			'{"id":"cli:pane:list","result":{"panes":[' +
			'{"pane_id":"w1:p1","agent_status":"unknown","cwd":"/x"},' +
			`{"agent":"claude","agent_session":{"agent":"claude","kind":"id","source":"herdr:claude","value":"${CLAUDE_NATIVE}"},"pane_id":"w2:p2"},` +
			`{"agent":"pi","agent_session":{"agent":"pi","kind":"path","source":"herdr:pi","value":"${PI_PATH}"},"pane_id":"w2:p4"}` +
			'],"type":"pane_list"}}';
		const rows = parseHerdrPaneList(real);
		assert.ok(rows, "the measured payload parses");
		ok("the measured herdr 0.9.0 payload yields one row per pane", rows.length === 3);
		ok("a pane with no agent_session parses to a keyless row (never dropped)", rows[0]?.sessionKind === null);

		ok(
			"[QK:HP-UNREADABLE-IS-UNOBSERVED] a payload this parser cannot read yields null — the caller then says " +
				"`unobserved`, because reporting `none` for every citizen off an unreadable answer would be a fabricated " +
				"measurement about a read that did not happen",
			parseHerdrPaneList("not json") === null &&
				parseHerdrPaneList("{}") === null &&
				parseHerdrPaneList('{"result":{}}') === null &&
				parseHerdrPaneList('{"result":{"panes":"nope"}}') === null,
		);
		ok(
			"a pane row missing pane_id makes the WHOLE payload unreadable (never partially trusted)",
			parseHerdrPaneList('{"result":{"panes":[{"agent":"pi"}]}}') === null,
		);
	}
	ok(
		'[QK:HP-JOIN-CLAUDE-EXACT] a kind:"id" pane joins on the value BYTE-FOR-BYTE — the claude axis is a ' +
			"string equality against a unique nativeSessionId, and a looser compare would attach a citizen to " +
			"someone else's pane",
		joinKeyOf(row("w2:p2", "id", CLAUDE_NATIVE)) === CLAUDE_NATIVE &&
			joinKeyOf(row("w2:p2", "id", `${CLAUDE_NATIVE}x`)) !== CLAUDE_NATIVE,
	);
	ok(
		'[QK:HP-JOIN-PI-FILENAME] a kind:"path" pane joins ONLY on a well-formed uuid tail of a .jsonl basename — ' +
			"the key lives inside a vendor filename, so both ends are strict and a name that fails either test " +
			"yields no key rather than a plausible-looking substring",
		piNativeSessionIdFromPath(PI_PATH) === PI_NATIVE &&
			piNativeSessionIdFromPath(`/s/2026_${PI_NATIVE}.txt`) === null &&
			piNativeSessionIdFromPath("/s/2026-09-14T05-17-03-979Z_not-a-uuid.jsonl") === null &&
			piNativeSessionIdFromPath(`/s/${PI_NATIVE}.jsonl`) === null,
	);
	ok(
		"[QK:HP-JOIN-NEVER-GUESSES] an unmeasured agent_session kind and an empty value both yield NO key — an " +
			"unknown herdr shape is skipped, never coerced into one of the two rules we actually measured",
		joinKeyOf(row("w2:p9", null, CLAUDE_NATIVE)) === null && joinKeyOf(row("w2:p9", "id", "")) === null,
	);

	// ── 3. index + resolution vocabulary ────────────────────────────────────────
	{
		const index = buildPlacementIndex([
			row("w1:p1", null, null),
			row("w2:p2", "id", CLAUDE_NATIVE),
			row("w2:p4", "path", PI_PATH),
		]);
		ok(
			"a joined citizen resolves to its pane",
			renderPlacement(resolvePlacement(index, identity(CLAUDE_NATIVE))) === "herdr w2:p2",
		);
		ok(
			"the pi axis resolves through the filename rule to its pane",
			renderPlacement(resolvePlacement(index, identity(PI_NATIVE, "pi"))) === "herdr w2:p4",
		);
		ok(
			"a citizen herdr was READ about and does not have reads `none` — a real measurement with a negative result",
			renderPlacement(resolvePlacement(index, identity("ffffffff-0000-0000-0000-000000000000"))) === "none",
		);
		ok(
			"[QK:HP-NO-HERDR-IS-UNOBSERVED] a null index (no herdr on this host, or the read failed) leaves every " +
				"citizen `unobserved` — the word for `nobody looked`, kept distinct from `none` so a host without a " +
				"placement owner never appears to have measured anything",
			renderPlacement(resolvePlacement(null, identity(CLAUDE_NATIVE))) === "unobserved",
		);

		const dup = buildPlacementIndex([row("w2:p2", "id", CLAUDE_NATIVE), row("w2:p5", "id", CLAUDE_NATIVE)]);
		ok(
			"[QK:HP-AMBIGUOUS-NOT-A-PANE] two panes claiming one native session id resolve to `ambiguous`, and the " +
				"key is removed from the index rather than settled by last-write-wins — naming one of them would be " +
				"the guess this axis exists to refuse",
			renderPlacement(resolvePlacement(dup, identity(CLAUDE_NATIVE))) === "ambiguous" &&
				!dup.byNativeSessionId.has(CLAUDE_NATIVE),
		);
		ok(
			"the same pane reported twice is NOT ambiguity (only a genuine second pane is)",
			renderPlacement(
				resolvePlacement(
					buildPlacementIndex([row("w2:p2", "id", CLAUDE_NATIVE), row("w2:p2", "id", CLAUDE_NATIVE)]),
					identity(CLAUDE_NATIVE),
				),
			) === "herdr w2:p2",
		);
	}

	// ── 4. the provider reads the placement owner exactly once ──────────────────
	{
		// TWO citizens on purpose: with one, a per-citizen read and a per-listing read are
		// indistinguishable, and the anti-watcher claim below would pass over a defect.
		const claude = identity(CLAUDE_NATIVE);
		const other = identity("ffffffff-0000-0000-0000-000000000000");
		const store: Record<string, string> = {
			[`${claude.gardenId}.meta.json`]: serializeMetaIdentity(claude),
			[`${other.gardenId}.meta.json`]: serializeMetaIdentity(other),
		};
		const base: EntwurfFactsDeps = {
			metaEntries: Object.keys(store).map((filename) => ({ filename, regularFile: true })),
			readRecord: (f: string) => {
				const v = store[f];
				if (v === undefined) throw new Error(`ENOENT: ${f}`);
				return v;
			},
			socket: { readdir: async () => [], probe: async () => "dead" },
		};

		let reads = 0;
		const withIndex: EntwurfFactsDeps = {
			...base,
			readPlacementIndex: () => {
				reads++;
				return buildPlacementIndex([row("w2:p2", "id", CLAUDE_NATIVE)]);
			},
		};
		const r = await listEntwurfFacts(withIndex);
		ok(
			"[QK:HP-ONE-READ-PER-LISTING] the provider reads the placement owner EXACTLY ONCE for a whole listing — " +
				"herdr publishes no event that says a pane's agent_session has settled, so a per-citizen read or a " +
				"retry loop around that gap would be the discovery watcher docs/mux-launch-rail.md §7 refuses by name",
			reads === 1,
		);
		const joined = r.facts.peers.find((p) => p.gardenId === claude.gardenId);
		const unjoined = r.facts.peers.find((p) => p.gardenId === other.gardenId);
		ok(
			"one listing carries both a joined citizen and a measured-absent one",
			r.facts.peers.length === 2 && joined?.placement.kind === "herdr-pane" && unjoined?.placement.kind === "none",
		);

		const withoutHerdr = await listEntwurfFacts({ ...base, readPlacementIndex: () => null });
		ok(
			"a host with no placement owner still lists its citizens, with placement `unobserved` (never a refusal)",
			withoutHerdr.facts.peers.length === 2 && withoutHerdr.facts.peers.every((p) => p.placement.kind === "unobserved"),
		);
	}

	// ── 5. placement is evidence, never a rail ──────────────────────────────────
	{
		// A source-level absence, not a behavioural one: the moment a dispatch module can
		// SEE the placement axis, a future edit can route on a pane that is one server
		// restart from being false. Hard Rule 16 / docs/mux-launch-rail.md §7.
		const dispatchSubjects = [
			"pi-extensions/lib/entwurf-v2-contract.ts",
			"pi-extensions/lib/entwurf-v2-production.ts",
			"pi-extensions/lib/entwurf-v2-decider.ts",
			"pi-extensions/lib/entwurf-v2-send.ts",
			"pi-extensions/lib/entwurf-v2-mailbox.ts",
			"pi-extensions/lib/entwurf-v2-native-push.ts",
		];
		const leaking = dispatchSubjects.filter((rel) => {
			const src = readFileSync(path.join(REPO_DIR, rel), "utf8");
			return src.includes("herdr-placement") || src.includes("HERDR_") || /\bplacement\b/.test(src);
		});
		ok(
			"[QK:HP-PLACEMENT-NOT-DISPATCH] no entwurf_v2 dispatch module imports, names, or reads the placement axis — " +
				`a pane is an ephemeral view and must never reach a routing decision (leaking: ${leaking.join(", ")})`,
			leaking.length === 0,
		);
	}

	console.log(`\n[check-herdr-placement] ${passed} assertions ok`);
}

main();
