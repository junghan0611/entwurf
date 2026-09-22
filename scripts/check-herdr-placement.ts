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
 *   HP-JOIN-OFFICIAL-ONLY    only an OFFICIAL herdr integration report is read — the
 *                            agent/source pair is checked, not discarded
 *   HP-JOIN-BACKEND-BOUND    a report speaks only for the backend it belongs to
 *   HP-DECLINED-IS-UNOBSERVED  while any report was declined, a non-join says `unobserved`
 *                            rather than claiming a complete negative read
 *   HP-AMBIGUOUS-NOT-A-PANE  two panes claiming one key resolve to `ambiguous`, never to
 *                            one of them
 *   HP-UNREADABLE-IS-UNOBSERVED  a payload we cannot read means nobody looked, never
 *                            "herdr has none of your citizens"
 *   HP-NO-HERDR-IS-UNOBSERVED    a null index leaves every citizen `unobserved`, and the
 *                            listing does not refuse
 *   HP-PLACEMENT-NOT-DISPATCH    the dispatch path never imports the placement axis
 *   HP-ONE-READ-PER-LISTING      the provider reads the placement owner exactly once for
 *                            a whole listing — the anti-watcher rule in code
 *   HP-READ-ENV-GATED-NULL-NEVER-EMPTY  the production READ itself: gated on herdr's own two
 *                            env facts, spawning nothing when they are absent, asking the
 *                            fixed `pane list` argv, and turning every failure into `null`
 *   HP-READ-TIMEOUT-BOUNDED  that read is bounded, so a placement owner that never answers
 *                            costs a listing a bounded wait and not a hang
 *
 * THE ONE STUB IN THIS FILE, AND WHY IT IS NOT A FAKE HERDR (glm #1, 2026-09-18). Everything
 * above is decided from VERBATIM recordings because a stand-in would author herdr's answers
 * before the real thing was measured. The two claims below are not about herdr's answers at all:
 * they are about OUR spawn seam — which env facts gate it, what argv it asks, and that a process
 * which fails, garbles or hangs becomes `null` rather than an empty index. Proving those needs a
 * controllable PROCESS, and the stub is never asked what a pane list looks like: the one cell that
 * reads a payload feeds it the same recorded bytes section 1 parses. `[glm 감사 2026-09-18]` this
 * seam had zero assertions and zero mutants — a typo in `["pane","list"]` or a deleted timeout
 * would have left the deterministic floor green.
 */

import assert from "node:assert/strict";
import * as fs from "node:fs";
import { readFileSync } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { type EntwurfFactsDeps, listEntwurfFacts } from "../pi-extensions/lib/entwurf-fact-provider.ts";
import { readHerdrPlacementIndex } from "../pi-extensions/lib/entwurf-peer-observe.ts";
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
import { reclaimOnExit } from "./lib/reclaim-on-exit.ts";

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

/** An OFFICIAL report, the shape herdr 0.9.0 actually prints for each axis. */
function row(paneId: string, axis: "claude" | "pi", value: string | null): HerdrPaneRow {
	return axis === "claude"
		? { paneId, agent: "claude", sessionSource: "herdr:claude", sessionKind: "id", sessionValue: value }
		: { paneId, agent: "pi", sessionSource: "herdr:pi", sessionKind: "path", sessionValue: value };
}

/** A pane carrying no session report at all — a bare shell. Not a decline. */
function bareRow(paneId: string): HerdrPaneRow {
	return { paneId, agent: null, sessionSource: null, sessionKind: null, sessionValue: null };
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
			"the parser CARRIES agent + source, it does not discard them (they are what makes a report official)",
			rows[1]?.agent === "claude" &&
				rows[1]?.sessionSource === "herdr:claude" &&
				rows[2]?.agent === "pi" &&
				rows[2]?.sessionSource === "herdr:pi",
		);

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
		joinKeyOf(row("w2:p2", "claude", CLAUDE_NATIVE))?.nativeSessionId === CLAUDE_NATIVE &&
			joinKeyOf(row("w2:p2", "claude", `${CLAUDE_NATIVE}x`))?.nativeSessionId !== CLAUDE_NATIVE,
	);
	ok(
		'[QK:HP-JOIN-PI-FILENAME] a kind:"path" pane joins ONLY on a well-formed uuid tail of a .jsonl basename — ' +
			"the key lives inside a vendor filename, so both ends are strict and a name that fails either test " +
			"yields no key rather than a plausible-looking substring",
		joinKeyOf(row("w2:p4", "pi", PI_PATH))?.nativeSessionId === PI_NATIVE &&
			piNativeSessionIdFromPath(PI_PATH) === PI_NATIVE &&
			piNativeSessionIdFromPath(`/s/2026_${PI_NATIVE}.txt`) === null &&
			piNativeSessionIdFromPath("/s/2026-09-14T05-17-03-979Z_not-a-uuid.jsonl") === null &&
			piNativeSessionIdFromPath(`/s/${PI_NATIVE}.jsonl`) === null,
	);
	{
		// THE VENDOR HALF OF THAT CLAIM, FROM THE INSTALLED VENDOR — not a literal we typed.
		// The key this parser recovers lives inside a filename pi builds, so the rule is only as
		// true as pi's naming, and a source read cannot settle whether that naming is a contract
		// or a convention. `[측정 2026-09-22, @earendil-works/pi-coding-agent 0.87.0]` the installed
		// `SessionManager` writes a REAL session file here, in a temp dir, with zero model, zero
		// network and zero child process: `create()` then one `appendMessage` flushes
		// `<stamp>_<id>.jsonl` whose own `{"type":"session"}` header carries the same id.
		//
		// The 0.86.0 receipt this replaces needed a provider call and was therefore taken by hand
		// once; it stays in the bump ledger as a 0.86.0 fact. This one re-takes itself on every
		// run, so the vendor floor cannot drift under us silently again.
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), "entwurf-hp-vendor-"));
		try {
			const { SessionManager } = await import("@earendil-works/pi-coding-agent");
			const manager = await SessionManager.create(process.cwd(), dir);
			await manager.appendMessage({
				role: "assistant",
				content: [{ type: "text", text: "placement vendor-floor probe" }],
				api: "test",
				provider: "test",
				model: "test",
				// Zero everything: this message exists to make the manager flush a file, and a
				// fixture that invented usage numbers would be inventing vendor accounting too.
				usage: {
					input: 0,
					output: 0,
					cacheRead: 0,
					cacheWrite: 0,
					totalTokens: 0,
					cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
				},
				stopReason: "stop",
				timestamp: Date.now(),
			});
			const written = fs.readdirSync(dir).filter((f) => f.endsWith(".jsonl"));
			const header = JSON.parse(readFileSync(path.join(dir, written[0]), "utf8").split("\n")[0]);
			const recovered = piNativeSessionIdFromPath(path.join(dir, written[0]));
			ok(
				"the vendor floor is re-measured, not remembered: the installed pi writes a real session file whose " +
					"basename this parser reads back to the same id its own header declares",
				written.length === 1 &&
					header.type === "session" &&
					typeof header.id === "string" &&
					recovered === header.id &&
					recovered === manager.getSessionId(),
			);
		} finally {
			fs.rmSync(dir, { recursive: true, force: true });
		}
	}
	ok(
		"[QK:HP-JOIN-NEVER-GUESSES] an unmeasured agent_session kind and an empty value both yield NO key — an " +
			"unknown herdr shape is declined, never coerced into one of the two rules we actually measured",
		joinKeyOf({ ...row("w2:p9", "claude", CLAUDE_NATIVE), sessionKind: null }) === null &&
			joinKeyOf(row("w2:p9", "claude", "")) === null,
	);
	ok(
		"[QK:HP-JOIN-OFFICIAL-ONLY] a report from an UNOFFICIAL source, or one whose agent or shape does not match " +
			"the source herdr is measured to emit, carries NO key — herdr accepts session reports from third-party " +
			'integrations too, and "the placement owner reported it" is the whole reason mux-launch-rail.md section 7 ' +
			"admits this as exact evidence, so the agent/source pair is checked rather than discarded",
		joinKeyOf({ ...row("w2:p2", "claude", CLAUDE_NATIVE), sessionSource: "someone-else:claude" }) === null &&
			joinKeyOf({ ...row("w2:p2", "claude", CLAUDE_NATIVE), agent: "pi" }) === null &&
			joinKeyOf({ ...row("w2:p4", "pi", PI_PATH), sessionKind: "id" }) === null,
	);

	// ── 3. index + resolution vocabulary ────────────────────────────────────────
	{
		const index = buildPlacementIndex([
			bareRow("w1:p1"),
			row("w2:p2", "claude", CLAUDE_NATIVE),
			row("w2:p4", "pi", PI_PATH),
		]);
		ok("a bare shell pane is not a declined report — there was nothing there to read", index.declinedReports === 0);
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

		ok(
			"[QK:HP-JOIN-BACKEND-BOUND] a report speaks only for the backend its integration belongs to — a " +
				"pi-reported pane handed to a claude-code citizen whose native id collides is a contradiction, not a " +
				"placement, so it resolves to `unobserved` rather than naming that pane",
			renderPlacement(resolvePlacement(index, identity(PI_NATIVE, "claude-code"))) === "unobserved",
		);

		const declined = buildPlacementIndex([
			row("w2:p2", "claude", CLAUDE_NATIVE),
			{ ...row("w2:p7", "claude", "whoever"), sessionSource: "thirdparty:tool" },
		]);
		ok(
			"[QK:HP-DECLINED-IS-UNOBSERVED] while ANY report was declined, a citizen that did not join reads " +
				"`unobserved`, not `none` — the report we refused to read might have been that citizen's, so we " +
				"declined to look rather than looked and found nothing",
			declined.declinedReports === 1 &&
				renderPlacement(resolvePlacement(declined, identity("ffffffff-0000-0000-0000-000000000000"))) === "unobserved",
		);

		const dup = buildPlacementIndex([row("w2:p2", "claude", CLAUDE_NATIVE), row("w2:p5", "claude", CLAUDE_NATIVE)]);
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
					buildPlacementIndex([row("w2:p2", "claude", CLAUDE_NATIVE), row("w2:p2", "claude", CLAUDE_NATIVE)]),
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
				return buildPlacementIndex([row("w2:p2", "claude", CLAUDE_NATIVE)]);
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

	// ── 6. the production READ — the spawn seam, on a stub PROCESS ──────────────
	{
		const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "entwurf-herdr-read."));
		reclaimOnExit(sandbox);
		const witness = path.join(sandbox, "spawned");
		const stub = (body: string): string => {
			const file = path.join(sandbox, `stub-${Math.random().toString(36).slice(2)}.sh`);
			// EVERY stub records that it ran, so "returned null" and "was never spawned" are
			// different observations rather than the same one.
			fs.writeFileSync(file, `#!/usr/bin/env bash\nprintf '%s\\n' "$*" >> ${JSON.stringify(witness)}\n${body}\n`);
			fs.chmodSync(file, 0o755);
			return file;
		};
		const spawns = (): string[] =>
			fs.existsSync(witness) ? fs.readFileSync(witness, "utf8").split("\n").filter(Boolean) : [];
		const RECORDED = `{"id":"cli:pane:list","result":{"panes":[{"agent":"claude","agent_session":{"agent":"claude","kind":"id","source":"herdr:claude","value":"${CLAUDE_NATIVE}"},"pane_id":"w2:p2"},{"agent":"pi","agent_session":{"agent":"pi","kind":"path","source":"herdr:pi","value":"${PI_PATH}"},"pane_id":"w2:p4"}],"type":"pane_list"}}`;

		const good = stub(`cat <<'JSON'\n${RECORDED}\nJSON`);
		const before = spawns().length;
		const noEnv = readHerdrPlacementIndex({ HERDR_BIN_PATH: good });
		const noBin = readHerdrPlacementIndex({ HERDR_ENV: "1" });
		const wrongEnv = readHerdrPlacementIndex({ HERDR_ENV: "true", HERDR_BIN_PATH: good });
		const gatedSpawns = spawns().length - before;

		const failing = stub("exit 1");
		const failed = readHerdrPlacementIndex({ HERDR_ENV: "1", HERDR_BIN_PATH: failing });
		const garbling = stub("echo 'not json at all'");
		const garbled = readHerdrPlacementIndex({ HERDR_ENV: "1", HERDR_BIN_PATH: garbling });
		const read = readHerdrPlacementIndex({ HERDR_ENV: "1", HERDR_BIN_PATH: good });
		const argv = spawns();

		ok(
			"[QK:HP-READ-ENV-GATED-NULL-NEVER-EMPTY] the read is gated on herdr's OWN two env facts and spawns nothing without them, asks the fixed `pane list` argv, and turns a failed or unreadable answer into null — never into an empty index, which would claim herdr was read and has none of your citizens",
			noEnv === null &&
				noBin === null &&
				// `HERDR_ENV` is read for its EXACT value: anything else is not herdr saying so.
				wrongEnv === null &&
				gatedSpawns === 0 &&
				failed === null &&
				garbled === null &&
				read !== null &&
				read.byNativeSessionId.size === 2 &&
				argv.length === 3 &&
				argv.every((line) => line === "pane list"),
		);

		// A hang is the failure a bound exists for, and it is the one no other cell reaches: the
		// process is alive and silent, so nothing but the timeout ends the wait.
		const hanging = stub("sleep 30");
		const started = Date.now();
		const hung = readHerdrPlacementIndex({ HERDR_ENV: "1", HERDR_BIN_PATH: hanging });
		const waited = Date.now() - started;
		ok(
			`[QK:HP-READ-TIMEOUT-BOUNDED] a placement owner that never answers costs the listing a BOUNDED wait and then reads unobserved — measured ${waited}ms against the 2000ms bound`,
			hung === null && waited < 10_000,
		);
	}

	console.log(`\n[check-herdr-placement] ${passed} assertions ok`);
}

main();
