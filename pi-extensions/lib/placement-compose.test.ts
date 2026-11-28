/**
 * placement-compose and tmux-placement — the owner fold and the lister's-own-tmux view (#178),
 * proven beside the modules. Deterministic: no tmux is started (the run is injected), no file read.
 *
 *   PLC-FOLD                  one sighting wins; two different sightings or any ambiguous are ambiguous
 *   PLC-NONE-NEEDS-ALL        none only when EVERY owner answered none; one unread owner is unobserved
 *   PLC-SHARED-OWNER          two citizens in one pid-joined place both read ambiguous; herdr panes are left alone
 *   PLC-OWNER-PID-RULE        Claude Code only, active owner only, ambiguous pid, miss is none
 *   TMP-OWN-SERVER-ONLY       without TMUX nothing is run; the run names no server
 *   TMP-READ-OR-NOTHING       a failed, signalled or unreadable listing is nobody-looked, never a partial index
 *   TMP-PARSE                 four tab fields, the session name takes the rest of the line
 *   TMP-PID-INDEX             a pid in two panes is ambiguous
 *   TMP-RENDER                the column says tmux <session>:<window>
 */

import { describe, expect, test } from "vitest";
import { type PlacementObservation, renderPlacement } from "./herdr-placement.ts";
import {
	ambiguateSharedOwnerPlacements,
	composePlacement,
	OWNER_PID_PLACEMENT_BACKENDS,
	placementLocationKey,
	resolveOwnerPidPlacement,
} from "./placement-compose.ts";
import {
	buildTmuxPaneListArgs,
	buildTmuxPlacementIndex,
	parseTmuxPaneList,
	readTmuxPlacementIndex,
	type TmuxPaneRow,
} from "./tmux-placement.ts";

function ok(label: string, cond: boolean): void {
	expect(cond, label).toBe(true);
}

const U: PlacementObservation = { kind: "unobserved" };
const N: PlacementObservation = { kind: "none" };
const A: PlacementObservation = { kind: "ambiguous" };
const H: PlacementObservation = { kind: "herdr-pane", paneId: "p1" };
const T: PlacementObservation = { kind: "tmux-pane", session: "org", window: "9", paneId: "%97" };
const C: PlacementObservation = { kind: "hc-terminal", coreId: "c1", coreName: "oracle", terminal: "t1g" };
// Its own wording, so these claims do not ride on the renderer.
const say = (p: PlacementObservation): string => placementLocationKey(p)?.replaceAll("\0", " ") ?? p.kind;

describe("placement: the owner fold", () => {
	test("[QK:PLC-FOLD] one sighting wins; two different sightings or any ambiguous are ambiguous", () => {
		const cells: [PlacementObservation[], string][] = [
			[[H, U, U], "herdr p1"],
			[[U, T, N], "tmux %97"],
			[[N, N, C], "hc c1 t1g"],
			[[U, T, { ...T }], "tmux %97"],
			[[H, T, U], "ambiguous"],
			[[U, T, C], "ambiguous"],
			[[U, T, { ...T, paneId: "%98" }], "ambiguous"],
			[[A, T, N], "ambiguous"],
			[[U, U, A], "ambiguous"],
			[[H, U, A], "ambiguous"],
		];
		for (const [owners, expected] of cells) {
			ok(`${owners.map((o) => o.kind).join(" + ")} → ${expected}`, say(composePlacement(owners)) === expected);
		}
	});

	test("[QK:PLC-NONE-NEEDS-ALL] none only when every owner answered none", () => {
		ok("all three read, nowhere: none", composePlacement([N, N, N]).kind === "none");
		for (const owners of [
			[U, N, N],
			[N, U, N],
			[N, N, U],
			[U, U, N],
			[U, U, U],
		]) {
			ok(`${owners.map((o) => o.kind).join(" + ")} → unobserved`, composePlacement(owners).kind === "unobserved");
		}
		ok("no owner at all is not a measurement", composePlacement([]).kind === "unobserved");
	});

	test("[QK:PLC-SHARED-OWNER] two citizens in one pid-joined place both read ambiguous", () => {
		const rows = [
			{ id: "a", placement: C },
			{ id: "b", placement: { ...C } },
			{ id: "c", placement: { ...C, terminal: "t1j" } },
			{ id: "d", placement: T },
			{ id: "e", placement: { ...T } },
			{ id: "f", placement: H },
			{ id: "g", placement: { ...H } },
			{ id: "h", placement: N },
			{ id: "i", placement: { ...C, coreId: "c2" } },
		];
		const out = ambiguateSharedOwnerPlacements(rows);
		ok(
			"the pairs are ambiguous, everything else is untouched",
			out.map((r) => `${r.id}=${say(r.placement)}`).join() ===
				"a=ambiguous,b=ambiguous,c=hc c1 t1j,d=ambiguous,e=ambiguous,f=herdr p1,g=herdr p1,h=none,i=hc c2 t1g",
		);
		ok("the input rows are not rewritten", rows[0]?.placement.kind === "hc-terminal");
	});

	test("[QK:PLC-OWNER-PID-RULE] Claude Code and pi-durable only, active owner only, ambiguous pid, miss is none", () => {
		const index = { byPid: new Map([[500, "x"]]), ambiguous: new Set([600]) };
		const place = (hit: string): PlacementObservation => ({ kind: "herdr-pane", paneId: hit });
		ok("a hit is placed", say(resolveOwnerPidPlacement(index, "claude-code", 500, place)) === "herdr x");
		ok("an ambiguous pid", resolveOwnerPidPlacement(index, "claude-code", 600, place).kind === "ambiguous");
		ok("a miss on a read owner is none", resolveOwnerPidPlacement(index, "claude-code", 7, place).kind === "none");
		ok(
			"no active owner: unobserved",
			resolveOwnerPidPlacement(index, "claude-code", null, place).kind === "unobserved",
		);
		ok("an unread owner: unobserved", resolveOwnerPidPlacement(null, "claude-code", 500, place).kind === "unobserved");
		ok(
			"pi-durable joins by the same rule",
			say(resolveOwnerPidPlacement(index, "pi-durable", 500, place)) === "herdr x",
		);
		ok("pi-durable miss is none", resolveOwnerPidPlacement(index, "pi-durable", 7, place).kind === "none");
		ok(
			"pi-durable with no active owner: unobserved",
			resolveOwnerPidPlacement(index, "pi-durable", null, place).kind === "unobserved",
		);
		ok("the claimed set is exactly two backends", OWNER_PID_PLACEMENT_BACKENDS.join() === "claude-code,pi-durable");
		for (const backend of ["pi", "codex", "copilot", "agy", "omp"]) {
			ok(`${backend} is never claimed`, resolveOwnerPidPlacement(index, backend, 500, place).kind === "unobserved");
		}
	});
});

describe("placement: the lister's own tmux server", () => {
	const LIST = "481107\t%97\t9\torg\n482029\t%98\t10\tmy session\twith a tab\n";

	test("[QK:TMP-OWN-SERVER-ONLY] without TMUX nothing is run; the run names no server", () => {
		for (const env of [{}, { TMUX: "" }, { HC_TERMINAL_ID: "t7", TMUX_PANE: "%1" }] as NodeJS.ProcessEnv[]) {
			let runs = 0;
			const index = readTmuxPlacementIndex(env, () => {
				runs++;
				return { status: 0, stdout: LIST };
			});
			ok("no index and no run", index === null && runs === 0);
		}
		const seen: { args: readonly string[]; env: NodeJS.ProcessEnv }[] = [];
		const env = { TMUX: "/tmp/tmux-1000/default,1,0" };
		const index = readTmuxPlacementIndex(env, (args, e) => {
			seen.push({ args, env: e });
			return { status: 0, stdout: LIST };
		});
		ok("exactly one run, with the lister's environment", seen.length === 1 && seen[0]?.env === env);
		ok(
			"one pane listing and no server flag",
			seen[0]?.args.join(" ") === buildTmuxPaneListArgs().join(" ") &&
				seen[0].args[0] === "list-panes" &&
				!seen[0].args.some((a) => a === "-S" || a === "-L"),
		);
		ok("the index was built", index?.byPid.get(481107)?.paneId === "%97");
	});

	test("[QK:TMP-READ-OR-NOTHING] a failed, signalled or unreadable listing is nobody-looked", () => {
		const env = { TMUX: "/tmp/tmux-1000/default,1,0" };
		const cases: [string, { status: number | null; stdout: string }][] = [
			["non-zero exit", { status: 1, stdout: LIST }],
			["signal or timeout", { status: null, stdout: LIST }],
			["one unreadable line", { status: 0, stdout: `${LIST}garbage\n` }],
		];
		for (const [label, ran] of cases) {
			let runs = 0;
			const index = readTmuxPlacementIndex(env, () => {
				runs++;
				return ran;
			});
			ok(`${label}: null, one run, no retry`, index === null && runs === 1);
		}
		ok(
			"an empty server is a read with no panes",
			readTmuxPlacementIndex(env, () => ({ status: 0, stdout: "" }))?.byPid.size === 0,
		);
	});

	test("[QK:TMP-PARSE] four tab fields, the session name takes the rest of the line", () => {
		const rows = parseTmuxPaneList(LIST);
		ok(
			"two rows",
			JSON.stringify(rows) ===
				JSON.stringify([
					{ pid: 481107, paneId: "%97", window: "9", session: "org" },
					{ pid: 482029, paneId: "%98", window: "10", session: "my session\twith a tab" },
				]),
		);
		for (const bad of [
			"481107\t%97\t9\n",
			"x\t%97\t9\torg\n",
			"1\t%97\t9\torg\n",
			"5\t97\t9\torg\n",
			"5\t%97\tw\torg\n",
			"5\t%97\t9\t\n",
		]) {
			ok(`unreadable: ${JSON.stringify(bad)}`, parseTmuxPaneList(bad) === null);
		}
	});

	test("[QK:TMP-PID-INDEX] a pid in two panes is ambiguous", () => {
		const row = (pid: number, paneId: string): TmuxPaneRow => ({ pid, paneId, window: "1", session: "s" });
		const index = buildTmuxPlacementIndex([row(5, "%1"), row(6, "%2"), row(6, "%3"), row(6, "%4"), row(5, "%1")]);
		ok("one pane, one pid", index.byPid.get(5)?.paneId === "%1" && !index.ambiguous.has(5));
		ok("two panes, one pid: ambiguous and not indexed", index.ambiguous.has(6) && !index.byPid.has(6));
	});

	test("[QK:TMP-RENDER] the column says tmux <session>:<window>", () => {
		ok("render", renderPlacement(T) === "tmux org:9");
	});
});
