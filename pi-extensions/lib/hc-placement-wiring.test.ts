/**
 * hc-placement wiring — the Herdr Core placement view inside one peers listing (#178).
 *
 * Deterministic. The production assembly (`listEntwurfFacts` over the production observer) is driven
 * with an injected hc read and a REAL receiver marker in a temp receivers dir whose owner is this
 * test process, so the validated-owner lookup is the production one: a live owner joins, a marker
 * for another session or no marker does not. No core, no socket, no child process.
 *
 *   HCP-WIRED-ONE-READ          the hc owner is read exactly once for a whole listing
 *   HCP-WIRED-VALIDATED-OWNER   only a Claude Code citizen whose validated live owner a terminal runs is placed
 *   HCP-WIRED-CONFIG-ERROR      a placement-config error stops the listing by name
 *   HCP-VIEW-NOT-DISPATCH       the module is imported by the peers observation only
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { type EntwurfFactsDeps, listEntwurfFacts } from "./entwurf-fact-provider.ts";
import { buildHcPlacementIndex, HcPlacementConfigError } from "./hc-placement.ts";
import { type MetaIdentity, serializeMetaIdentity, writeMetaReceiverMarker } from "./meta-session.ts";

function ok(label: string, cond: boolean): void {
	expect(cond, label).toBe(true);
}

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "hc-placement-wiring-"));
const RECEIVERS = path.join(TMP, "meta-receivers");
let savedReceivers: string | undefined;
beforeAll(() => {
	savedReceivers = process.env.ENTWURF_META_RECEIVERS_DIR;
	process.env.ENTWURF_META_RECEIVERS_DIR = RECEIVERS;
});
afterAll(() => {
	if (savedReceivers === undefined) delete process.env.ENTWURF_META_RECEIVERS_DIR;
	else process.env.ENTWURF_META_RECEIVERS_DIR = savedReceivers;
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
const OTHER_SESSION = identity("cccccc", "cccccccc-0000-4000-8000-000000000003", "claude-code");
const DURABLE = identity("dddddd", "1795838020416-dddddddd-0000-4000-8000-000000000004", "pi-durable");
const ALL = [PLACED, NO_MARKER, OTHER_SESSION, DURABLE];

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
		readPlacementIndex: () => null,
		...over,
	};
}

function arm(): void {
	writeMetaReceiverMarker({
		gardenId: PLACED.gardenId,
		backend: "claude-code",
		nativeSessionId: PLACED.nativeSessionId,
		ownerPid: process.pid,
		armProvenance: "session-start",
		receiversDir: RECEIVERS,
	});
	// A live owner, but armed for ANOTHER session of that garden id: not this citizen's owner.
	writeMetaReceiverMarker({
		gardenId: OTHER_SESSION.gardenId,
		backend: "claude-code",
		nativeSessionId: "eeeeeeee-0000-4000-8000-00000000000e",
		ownerPid: process.pid,
		armProvenance: "session-start",
		receiversDir: RECEIVERS,
	});
}

const kindOf = (peers: readonly { gardenId: string; placement: { kind: string } }[], i: MetaIdentity) =>
	peers.find((p) => p.gardenId === i.gardenId)?.placement.kind;

describe("hc placement inside one listing", () => {
	test("[QK:HCP-WIRED-ONE-READ] the hc owner is read exactly once for a whole listing", async () => {
		arm();
		let reads = 0;
		const r = await listEntwurfFacts(
			deps({
				readHcPlacementIndex: async () => {
					reads++;
					return buildHcPlacementIndex(CORE, [{ terminal: "t1d", pid: process.pid }]);
				},
			}),
		);
		ok("four citizens, one read", r.facts.peers.length === 4 && reads === 1);
	});

	test("[QK:HCP-WIRED-VALIDATED-OWNER] only a Claude Code citizen whose validated live owner a terminal runs is placed", async () => {
		arm();
		const index = buildHcPlacementIndex(CORE, [{ terminal: "t1d", pid: process.pid }]);
		const r = await listEntwurfFacts(deps({ readHcPlacementIndex: async () => index }));
		const placed = r.facts.peers.find((p) => p.gardenId === PLACED.gardenId)?.placement;
		ok(
			"the citizen whose marker owner the terminal runs",
			JSON.stringify(placed) ===
				JSON.stringify({ kind: "hc-terminal", coreId: CORE.id, coreName: "oracle", terminal: "t1d" }),
		);
		// Which blank word a citizen with no owner reads is hc-placement.test.ts's claim; here: not placed.
		ok("no marker: not placed", kindOf(r.facts.peers, NO_MARKER) !== "hc-terminal");
		ok(
			"a marker for another session is not this citizen's owner",
			kindOf(r.facts.peers, OTHER_SESSION) !== "hc-terminal",
		);
		ok("pi-durable is never claimed", kindOf(r.facts.peers, DURABLE) === "unobserved");

		const elsewhere = await listEntwurfFacts(
			deps({ readHcPlacementIndex: async () => buildHcPlacementIndex(CORE, [{ terminal: "t9", pid: 2 ** 22 + 7 }]) }),
		);
		ok("a core that was read and does not run the owner: none", kindOf(elsewhere.facts.peers, PLACED) === "none");

		const unread = await listEntwurfFacts(deps({ readHcPlacementIndex: async () => null }));
		ok(
			"nobody looked: every row unobserved",
			ALL.every((i) => kindOf(unread.facts.peers, i) === "unobserved"),
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

	test("[QK:HCP-VIEW-NOT-DISPATCH] the module is imported by the peers observation only", () => {
		const root = path.resolve(__dirname, "..", "..");
		const importers: string[] = [];
		const walk = (dir: string): void => {
			for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
				if (entry.name === "node_modules" || entry.name === "dist" || entry.name.startsWith(".")) continue;
				const full = path.join(dir, entry.name);
				if (entry.isDirectory()) walk(full);
				else if (/\.(ts|mts|mjs|js)$/.test(entry.name) && !/\.test\.ts$/.test(entry.name)) {
					const src = fs.readFileSync(full, "utf8");
					if (/from\s+"[^"]*hc-placement(\.ts|\.js)?"/.test(src) || src.includes("ENTWURF_HC_PLACEMENT_SOCKET")) {
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
	});
});
