/**
 * placement wiring — the tmux and Herdr Core placement views inside one peers listing (#178).
 *
 * Deterministic. The production assembly (`listEntwurfFacts` over the production observer) is driven
 * with injected owner reads and REAL receiver and sender markers in temp dirs whose owner is this
 * test process, so the active-owner rule is the production one, taken from the receiver axis: a
 * marker whose owner serves this garden joins; a marker left behind by a process that now serves
 * another garden, or no marker, does not. No core, no tmux, no socket, no child process.
 *
 *   HCP-WIRED-ONE-READ          the hc and tmux owners are each read exactly once for a whole listing
 *   HCP-WIRED-ACTIVE-OWNER      only a Claude Code citizen whose ACTIVE receiver owner a terminal runs is placed
 *   HCP-WIRED-TMUX              the same owner in a pane of the lister's tmux reads tmux <session>:<window>
 *   HCP-WIRED-NONE-NEEDS-ALL    none needs herdr, tmux and hc all read; one unread owner is unobserved
 *   HCP-WIRED-SHARED-OWNER      two citizens shown in one pid-joined place both read ambiguous
 *   HCP-WIRED-CONFIG-ERROR      a placement-config error stops the listing by name
 *   HCP-VIEW-NOT-DISPATCH       the view modules are imported by the peers observation only
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { type EntwurfFactsDeps, listEntwurfFacts } from "./entwurf-fact-provider.ts";
import type { PeerObservations } from "./entwurf-facts.ts";
import { buildHcPlacementIndex, HcPlacementConfigError } from "./hc-placement.ts";
import { buildPlacementIndex, renderPlacement } from "./herdr-placement.ts";
import {
	type MetaIdentity,
	serializeMetaIdentity,
	writeMetaReceiverMarker,
	writeMetaSenderMarker,
} from "./meta-session.ts";
import { buildTmuxPlacementIndex } from "./tmux-placement.ts";

function ok(label: string, cond: boolean): void {
	expect(cond, label).toBe(true);
}

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "hc-placement-wiring-"));
const RECEIVERS = path.join(TMP, "meta-receivers");
const SENDERS = path.join(TMP, "meta-senders");
const saved: Record<string, string | undefined> = {};
beforeAll(() => {
	for (const [name, dir] of [
		["ENTWURF_META_RECEIVERS_DIR", RECEIVERS],
		["ENTWURF_META_SENDERS_DIR", SENDERS],
	] as const) {
		saved[name] = process.env[name];
		process.env[name] = dir;
	}
});
afterAll(() => {
	for (const [name, value] of Object.entries(saved)) {
		if (value === undefined) delete process.env[name];
		else process.env[name] = value;
	}
	fs.rmSync(TMP, { recursive: true, force: true });
});

const CORE = { id: "96a4987dcca010b410faac93b2d0607c", name: "oracle" };

function identity(tag: string, nativeSessionId: string, backend: MetaIdentity["backend"]): MetaIdentity {
	return {
		schemaVersion: 3,
		gardenId: `20261128T000000-${tag}`,
		backend,
		nativeSessionId,
		cwd: "/x",
		model: null,
		transcriptPath: null,
		createdAt: "2026-11-28T00:00:00.000Z",
		recordUpdatedAt: "2026-11-28T00:00:00.000Z",
		attachIncarnation: null,
	};
}

const PLACED = identity("aaaaaa", "aaaaaaaa-0000-4000-8000-000000000001", "claude-code");
const NO_MARKER = identity("bbbbbb", "bbbbbbbb-0000-4000-8000-000000000002", "claude-code");
// Its marker names this live process too, but the process serves PLACED now (one sender marker per pid).
const LEFT_BEHIND = identity("cccccc", "cccccccc-0000-4000-8000-000000000003", "claude-code");
const DURABLE = identity("dddddd", "1795838020416-dddddddd-0000-4000-8000-000000000004", "pi-durable");
const ALL = [PLACED, NO_MARKER, LEFT_BEHIND, DURABLE];

/** Every owner read, and none of them holding anything: the baseline each test moves one owner of. */
function deps(over: Partial<EntwurfFactsDeps>): EntwurfFactsDeps {
	const store: Record<string, string> = Object.fromEntries(
		ALL.map((i) => [`${i.gardenId}.meta.json`, serializeMetaIdentity(i)]),
	);
	return {
		metaEntries: Object.keys(store).map((filename) => ({ filename, regularFile: true })),
		readRecord: (f: string) => {
			const v = store[f];
			if (v === undefined) throw new Error(`ENOENT: ${f}`);
			return v;
		},
		socket: { readdir: async () => [], probe: async () => "dead" },
		readPlacementIndex: () => buildPlacementIndex([]),
		readTmuxPlacementIndex: () => buildTmuxPlacementIndex([]),
		readHcPlacementIndex: async () => buildHcPlacementIndex(CORE, []),
		...over,
	};
}

function arm(): void {
	for (const citizen of [PLACED, LEFT_BEHIND]) {
		writeMetaReceiverMarker({
			gardenId: citizen.gardenId,
			backend: "claude-code",
			nativeSessionId: citizen.nativeSessionId,
			ownerPid: process.pid,
			armProvenance: "session-start",
			receiversDir: RECEIVERS,
		});
	}
	writeMetaSenderMarker({
		backend: "claude-code",
		gardenId: PLACED.gardenId,
		nativeSessionId: PLACED.nativeSessionId,
		cwd: "/x",
		ownerPid: process.pid,
		sendersDir: SENDERS,
	});
}

const HC_HERE = async () => buildHcPlacementIndex(CORE, [{ terminal: "t1d", pid: process.pid }]);
const TMUX_HERE = () => buildTmuxPlacementIndex([{ pid: process.pid, paneId: "%97", window: "9", session: "org" }]);
type Row = { gardenId: string; receiver: string; placement: PeerObservations["placement"] };
const rowOf = (peers: readonly Row[], i: MetaIdentity) => peers.find((p) => p.gardenId === i.gardenId) as Row;
const kindOf = (peers: readonly Row[], i: MetaIdentity) => rowOf(peers, i).placement.kind;

describe("placement inside one listing", () => {
	test("[QK:HCP-WIRED-ONE-READ] the hc and tmux owners are each read exactly once for a whole listing", async () => {
		arm();
		let hcReads = 0;
		let tmuxReads = 0;
		const r = await listEntwurfFacts(
			deps({
				readHcPlacementIndex: async () => {
					hcReads++;
					return HC_HERE();
				},
				readTmuxPlacementIndex: () => {
					tmuxReads++;
					return buildTmuxPlacementIndex([]);
				},
			}),
		);
		ok("four citizens, one read of each owner", r.facts.peers.length === 4 && hcReads === 1 && tmuxReads === 1);
	});

	test("[QK:HCP-WIRED-ACTIVE-OWNER] only a Claude Code citizen whose active receiver owner a terminal runs is placed", async () => {
		arm();
		const r = await listEntwurfFacts(deps({ readHcPlacementIndex: HC_HERE }));
		ok(
			"the citizen the process serves is active and placed",
			rowOf(r.facts.peers, PLACED).receiver === "active" &&
				JSON.stringify(rowOf(r.facts.peers, PLACED).placement) ===
					JSON.stringify({ kind: "hc-terminal", coreId: CORE.id, coreName: "oracle", terminal: "t1d" }),
		);
		ok(
			"the citizen that process left behind is inactive and is NOT given its terminal",
			rowOf(r.facts.peers, LEFT_BEHIND).receiver === "inactive" && kindOf(r.facts.peers, LEFT_BEHIND) === "unobserved",
		);
		ok("no marker: not placed", kindOf(r.facts.peers, NO_MARKER) === "unobserved");
		ok("pi-durable is never claimed", kindOf(r.facts.peers, DURABLE) === "unobserved");
	});

	test("[QK:HCP-WIRED-TMUX] the same owner in a pane of the lister's tmux reads tmux <session>:<window>", async () => {
		arm();
		const r = await listEntwurfFacts(deps({ readTmuxPlacementIndex: TMUX_HERE }));
		ok(
			"placed in the pane",
			JSON.stringify(rowOf(r.facts.peers, PLACED).placement) ===
				JSON.stringify({ kind: "tmux-pane", session: "org", window: "9", paneId: "%97" }) &&
				renderPlacement(rowOf(r.facts.peers, PLACED).placement) === "tmux org:9",
		);
		ok("the left-behind citizen is not", kindOf(r.facts.peers, LEFT_BEHIND) === "unobserved");
		const both = await listEntwurfFacts(deps({ readTmuxPlacementIndex: TMUX_HERE, readHcPlacementIndex: HC_HERE }));
		ok("a pane AND a terminal claiming it: ambiguous", kindOf(both.facts.peers, PLACED) === "ambiguous");
	});

	test("[QK:HCP-WIRED-NONE-NEEDS-ALL] none needs herdr, tmux and hc all read", async () => {
		arm();
		const all = await listEntwurfFacts(deps({}));
		ok("all three read, nowhere: none", kindOf(all.facts.peers, PLACED) === "none");
		for (const [label, over] of [
			["herdr unread", { readPlacementIndex: () => null }],
			["tmux unread", { readTmuxPlacementIndex: () => null }],
			["hc unread", { readHcPlacementIndex: async () => null }],
		] as [string, Partial<EntwurfFactsDeps>][]) {
			const r = await listEntwurfFacts(deps(over));
			ok(`${label}: unobserved, not none`, kindOf(r.facts.peers, PLACED) === "unobserved");
		}
		const nobody = await listEntwurfFacts(
			deps({
				readPlacementIndex: () => null,
				readTmuxPlacementIndex: () => null,
				readHcPlacementIndex: async () => null,
			}),
		);
		ok(
			"nobody looked: every row unobserved",
			ALL.every((i) => kindOf(nobody.facts.peers, i) === "unobserved"),
		);
	});

	test("[QK:HCP-WIRED-SHARED-OWNER] two citizens shown in one pid-joined place both read ambiguous", async () => {
		const here = { kind: "hc-terminal", coreId: CORE.id, coreName: "oracle", terminal: "t1d" } as const;
		const r = await listEntwurfFacts(
			deps({
				observe: (i) => ({
					receiver: "active",
					transcript: "exists",
					placement:
						i.gardenId === DURABLE.gardenId
							? { ...here, terminal: "t9" }
							: i.gardenId === NO_MARKER.gardenId
								? { kind: "none" }
								: here,
				}),
			}),
		);
		ok(
			"the two that share a terminal are ambiguous; the others keep their word",
			kindOf(r.facts.peers, PLACED) === "ambiguous" &&
				kindOf(r.facts.peers, LEFT_BEHIND) === "ambiguous" &&
				kindOf(r.facts.peers, DURABLE) === "hc-terminal" &&
				kindOf(r.facts.peers, NO_MARKER) === "none",
		);
	});

	test("[QK:HCP-WIRED-CONFIG-ERROR] a placement-config error stops the listing by name", async () => {
		let caught: unknown = null;
		await listEntwurfFacts(
			deps({
				readHcPlacementIndex: async () => {
					throw new HcPlacementConfigError(
						"hc-placement-socket-not-a-socket",
						"names something that is not a unix socket",
					);
				},
			}),
		).catch((error: unknown) => {
			caught = error;
		});
		ok(
			"the listing rejects with the named error",
			caught instanceof HcPlacementConfigError && caught.reason === "hc-placement-socket-not-a-socket",
		);
	});

	test("[QK:HCP-VIEW-NOT-DISPATCH] the view modules are imported by the peers observation only", () => {
		const root = path.resolve(__dirname, "..", "..");
		const importers: string[] = [];
		const walk = (dir: string): void => {
			for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
				if (entry.name === "node_modules" || entry.name === "dist" || entry.name.startsWith(".")) continue;
				const full = path.join(dir, entry.name);
				if (entry.isDirectory()) walk(full);
				else if (/\.(ts|mts|mjs|js)$/.test(entry.name) && !/\.test\.ts$/.test(entry.name)) {
					const src = fs.readFileSync(full, "utf8");
					if (
						/from\s+"[^"]*(hc-placement|tmux-placement|placement-compose)(\.ts|\.js)?"/.test(src) ||
						src.includes("ENTWURF_HC_PLACEMENT_SOCKET")
					) {
						importers.push(path.relative(root, full));
					}
				}
			}
		};
		for (const top of ["pi-extensions", "mcp", "scripts", "pi", "plugins", "native"]) {
			const dir = path.join(root, top);
			if (fs.existsSync(dir)) walk(dir);
		}
		ok(
			`importers and readers of the variable are exactly the view (got ${importers.sort().join(", ")})`,
			importers.sort().join() ===
				[
					"pi-extensions/lib/entwurf-fact-provider.ts",
					"pi-extensions/lib/entwurf-peer-observe.ts",
					"pi-extensions/lib/hc-placement.ts",
				].join(),
		);
		// Inside the view: hc-placement reads the variable and takes the shared owner rule from the fold.
		ok(
			"the fold and the tmux view import no entwurf module but the placement types",
			["placement-compose.ts", "tmux-placement.ts"].every((name) => {
				const src = fs.readFileSync(path.join(root, "pi-extensions/lib", name), "utf8");
				const froms = [...src.matchAll(/from\s+"([^"]+)"/g)].map((m) => m[1]);
				return froms.every((f) => f === "./herdr-placement.ts" || f === "node:child_process");
			}),
		);
	});
});
