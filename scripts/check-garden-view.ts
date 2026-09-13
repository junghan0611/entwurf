/** Deterministic contract gate for the read-only `entwurf garden` frontend (#114). */

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { serializeMetaIdentity } from "../pi-extensions/lib/meta-session.ts";
import {
	type GardenViewSnapshot,
	NO_ATTENTION_REASON,
	NO_JOIN_REASON,
	parseTmuxPaneRows,
	renderGardenView,
	TMUX_FIELD_SEPARATOR,
} from "./lib/garden-view.ts";
import { reclaimOnExit } from "./lib/reclaim-on-exit.ts";

let passed = 0;
function ok(label: string, condition: boolean): void {
	assert.ok(condition, label);
	console.log(`  ok    ${label}`);
	passed++;
}

const tmuxLine = ["$7", "agents", "2", "@9", "2", "review", "1", "%11", "0", "1", "0", "pi", "/repo/shared"].join(
	TMUX_FIELD_SEPARATOR,
);
const panes = parseTmuxPaneRows(`${tmuxLine}\n`);
ok(
	"[QK:GV-TMUX-PARSE] tmux's exact placement row is parsed without inventing a citizen field",
	panes.length === 1 &&
		panes[0]?.paneId === "%11" &&
		panes[0]?.sessionClients === 2 &&
		panes[0]?.cwd === "/repo/shared" &&
		!("gardenId" in (panes[0] ?? {})),
);
assert.throws(() => parseTmuxPaneRows("$7\u001fbroken\n"), /expected 13/, "malformed placement rows fail loud");
console.log("  ok    malformed placement rows fail loud");
passed++;

const snapshot: GardenViewSnapshot = {
	schemaVersion: 1,
	observedAt: "2026-09-13T12:34:56.000Z",
	host: "fixture",
	placement: {
		source: "tmux",
		authority: "placement-observation-only",
		scope: "whole-current-server-inventory",
		status: "ok",
		panes,
		error: null,
	},
	garden: {
		source: "entwurf-fact-provider",
		authority: "garden-id-record-and-rail-facts",
		scope: "retained-record-store",
		detailObservationLimit: 32,
		peers: [
			{
				gardenId: "20260913T213000-abcdef",
				backend: "pi",
				nativeSessionId: "native-fixture",
				cwd: "/repo/shared",
				model: "openai-codex/gpt-5.6-terra",
				createdAt: "2026-09-13T12:30:00.000Z",
				recordUpdatedAt: "2026-09-13T12:30:00.000Z",
				liveness: "alive",
				receiver: "n/a",
				transcript: "exists",
			},
		],
		diagnostics: [],
	},
	join: { state: "not-performed", reason: NO_JOIN_REASON },
	attention: { state: "not-observed", reason: NO_ATTENTION_REASON },
};
const rendered = renderGardenView(snapshot, { columns: 120, rows: 24 });
const narrow = renderGardenView(snapshot, { columns: 60, rows: 24 });
ok(
	"[QK:GV-AUTHORITY-SEPARATION] same-cwd pane and citizen occupy vertically ordered panels with named absent joins",
	[60, 120].every((columns) => {
		const frame = renderGardenView(snapshot, { columns, rows: 24 });
		const pane = columns < 100 ? "gd?" : "gd:?";
		const citizen = columns < 100 ? "pl?" : "pl:?";
		return (
			frame.includes(pane) &&
			frame.includes(citizen) &&
			!frame.includes("inferred") &&
			frame.indexOf(pane) < frame.indexOf(citizen)
		);
	}),
);
ok(
	"[QK:GV-ATTENTION-HONESTY] the viewer names attention as unobserved instead of deriving working/blocked/done",
	rendered.includes("ATTENTION ?") && rendered.includes("explicit backend report"),
);
ok(
	"the same projection has a bounded narrow-terminal rendering",
	narrow.split("\n").every((line) => line.length <= 60),
);
const peer = snapshot.garden.peers[0]!;
ok(
	"[QK:GV-ROW-FACTS-SURVIVE-WIDTH] human compact/full rows retain literal core facts at every width",
	[48, 60, 80, 100, 120].every((columns) => {
		const frame = renderGardenView(snapshot, { columns, rows: 24 });
		const backend = columns < 60 ? "pi" : peer.backend;
		return (
			frame.includes(peer.gardenId) &&
			frame.includes(backend) &&
			frame.includes(columns < 100 ? "recv-" : "recv:n/a") &&
			frame.includes(columns < 100 ? "tx+" : "tr:exists") &&
			frame.includes(columns < 100 ? "pl?" : "pl:?")
		);
	}),
);
const horizon = "20260913T213000-abcdef";
ok(
	"[QK:GV-OBSERVATION-HORIZON] payload-derived horizon remains in title and warning at every width",
	[48, 60, 80, 100, 120].every((columns) =>
		renderGardenView(snapshot, { columns, rows: 24 })
			.split("\n")
			.slice(0, 2)
			.some((line) => line.includes(horizon)),
	),
);
const absenceSnapshot: GardenViewSnapshot = {
	...snapshot,
	garden: {
		...snapshot.garden,
		peers: [
			...snapshot.garden.peers,
			{
				...peer,
				gardenId: "20260913T213001-aaaaaa",
				backend: "antigravity",
				liveness: "unsupported",
				receiver: "n/a",
				transcript: "unobserved",
			},
		],
	},
};
const absence = renderGardenView(absenceSnapshot, { columns: 120, rows: 24 });
const absenceCompact = renderGardenView(absenceSnapshot, { columns: 80, rows: 24 });
ok(
	"[QK:GV-UNREACHABLE-NAMED] transcript-unobserved and native-push listing absence stay distinct",
	absence.includes("tr:unobserved") &&
		absence.includes("np-listing:absent") &&
		absenceCompact.includes("tx?") &&
		absenceCompact.includes("np-listing?"),
);
const omitted = renderGardenView(absenceSnapshot, { columns: 120, rows: 12 });
ok(
	"[QK:GV-OMITTED-SUBJECTS] truncation names pane, session-heading, and record subjects",
	omitted.includes("hidden panes:1 sessions:1") && omitted.includes("hidden records:2"),
);

const root = reclaimOnExit(fs.mkdtempSync(path.join(os.tmpdir(), "entwurf-garden-view-")));
const store = path.join(root, "meta-sessions");
const control = path.join(root, "control");
const bin = path.join(root, "bin");
fs.mkdirSync(store);
fs.mkdirSync(control);
fs.mkdirSync(bin);
const gid = "20260913T220000-a1b2c3";
fs.writeFileSync(
	path.join(store, `${gid}.meta.json`),
	serializeMetaIdentity({
		schemaVersion: 3,
		gardenId: gid,
		backend: "pi",
		nativeSessionId: "native-cli-fixture",
		cwd: "/repo/shared",
		model: "openai-codex/gpt-5.6-terra",
		transcriptPath: null,
		createdAt: "2026-09-13T13:00:00.000Z",
		recordUpdatedAt: "2026-09-13T13:00:00.000Z",
	}),
);
fs.writeFileSync(path.join(bin, "tmux"), `#!/bin/sh\nprintf '%s\\n' '${tmuxLine}'\n`);
fs.chmodSync(path.join(bin, "tmux"), 0o755);
const cli = spawnSync(process.execPath, ["--experimental-strip-types", "scripts/garden-view.ts", "--json"], {
	encoding: "utf8",
	env: {
		...process.env,
		PATH: `${bin}:${process.env.PATH ?? ""}`,
		ENTWURF_META_SESSIONS_DIR: store,
		ENTWURF_DIR: control,
		HOME: root,
	},
});
assert.equal(cli.status, 0, `garden CLI failed: ${cli.stderr}`);
const live = JSON.parse(cli.stdout) as GardenViewSnapshot;
ok(
	"[QK:GV-OWNER-FACTS] the real CLI uses the owner fact provider for garden facts and tmux only for placement",
	live.placement.scope === "whole-current-server-inventory" &&
		live.placement.panes[0]?.paneId === "%11" &&
		live.garden.scope === "retained-record-store" &&
		live.garden.detailObservationLimit === 32 &&
		live.garden.peers[0]?.gardenId === gid &&
		live.garden.peers[0]?.liveness === "dead" &&
		live.join.state === "not-performed",
);
const placementKeys = JSON.stringify(live.placement);
const gardenKeys = JSON.stringify(live.garden);
ok(
	"[QK:GV-NO-CROSS-KEYS] machine output carries no garden id in placement and no tmux coordinate in garden facts",
	!placementKeys.includes("gardenId") &&
		!gardenKeys.includes("paneId") &&
		!gardenKeys.includes("windowId") &&
		live.placement.scope === "whole-current-server-inventory" &&
		live.garden.scope === "retained-record-store" &&
		live.garden.detailObservationLimit === 32,
);

const runSh = fs.readFileSync("run.sh", "utf8");
const build = fs.readFileSync("mcp/entwurf-bridge/tsconfig.build.json", "utf8");
ok(
	"the installed operator surface is reachable through run_ts and has a compiled twin",
	/^ {2}garden\)$/m.test(runSh) &&
		runSh.includes("run_ts scripts/garden-view.ts") &&
		build.includes('"../../scripts/garden-view.ts"'),
);

console.log(`check-garden-view: ${passed} checks passed`);
