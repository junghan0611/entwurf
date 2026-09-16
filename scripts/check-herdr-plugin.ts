/**
 * check-herdr-plugin — deterministic gate for the #116 M2-b Herdr plugin
 * (`plugins/herdr/`: the manifest and the one read-only status pane).
 *
 * TWO HALVES, AND THEY PROVE DIFFERENT THINGS.
 *
 * Static — the manifest is read with the same TOML parser the package already depends on
 * and checked against the shape herdr 0.9.0 actually accepts (`min_herdr_version`
 * required and semver, pane ids dot-free, popup-only sizing, argv arrays). The sections
 * that are ABSENT are asserted as hard as the ones present: `[[events]]`/`[[startup]]`
 * would grow a watcher, `[[actions]]` would send a report nobody can read into a 64 KiB
 * log. `[[build]]` is no longer among them (#116 M3-b3) — the single runner it may call is
 * `check-herdr-plugin-build`'s subject.
 *
 * Behavioural — the REAL pane entry is spawned with a stub `entwurf` and a stub
 * `HERDR_BIN_PATH`, and every stub call is appended to a log, so "exactly one read each"
 * is counted rather than asserted about the source. Success, skip, four distinct failure
 * names, the ambiguous pane, diagnostics, and the no-write claim are each driven for real.
 * A 1,002-citizen fixture pins the render budget: the read stays whole, but a thousand
 * historical rows may not become a thousand table rows.
 *
 * WHAT A STUB CANNOT PROVE, AND WHAT CAUGHT IT. A stub answers any argv, so it cannot
 * tell you the argv is right. The first private-herdr cell for this plugin returned
 * `herdr-agent-list-failed / exit 2: usage: herdr agent list` — `agent list` takes no
 * `--json` (unlike `plugin list`, which does), and the symmetry had been assumed. The
 * gate now pins the exact argv, but the pin is only as true as the measurement behind
 * it: the reading that corrects it is a real herdr, not this file.
 *
 * WHY A STUB HERE IS NOT THE FIXTURE THE LANE FORBIDS. `check-herdr-sandbox` may not
 * invent a fake herdr binary, because there the subject IS herdr's launch protocol and a
 * fake one would fake the measurement. Here the subject is a CONSUMER: what is under test
 * is how this plugin parses, joins and refuses given a listing, and no real herdr can be
 * made to produce a chosen `agent_status`/pane pair without the LIVE axis. The stub stands
 * for the caller's input, never for herdr's behaviour — nothing in this file claims a fact
 * ABOUT herdr.
 *
 * Every [QK:HPL-*] token appears exactly once, on the assertion that fails for that claim.
 * No herdr binary, no Entwurf install, no network, no model turn, no writes outside mkdtemp.
 */

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parse as parseToml } from "smol-toml";
import { reclaimOnExit } from "./lib/reclaim-on-exit.ts";

let passed = 0;
function ok(label: string, cond: boolean): void {
	assert.ok(cond, label);
	console.log(`  ok    ${label}`);
	passed++;
}

const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const PLUGIN_DIR = path.join(REPO, "plugins", "herdr");
const ENTRY = path.join(PLUGIN_DIR, "lib", "status.mjs");

function tmp(prefix: string): string {
	return reclaimOnExit(fs.mkdtempSync(path.join(os.tmpdir(), `entwurf-herdr-plugin-${prefix}-`)));
}

// ── static: the manifest is the shape herdr 0.9.0 accepts, and nothing more ──
interface Manifest {
	id?: unknown;
	name?: unknown;
	version?: unknown;
	min_herdr_version?: unknown;
	platforms?: unknown;
	panes?: { id?: unknown; title?: unknown; placement?: unknown; command?: unknown }[];
	[k: string]: unknown;
}

const manifest = parseToml(fs.readFileSync(path.join(PLUGIN_DIR, "herdr-plugin.toml"), "utf8")) as Manifest;
{
	ok("plugin id is the live GitHub owner, not the retired org", manifest.id === "junghan0611.entwurf");
	ok(
		"the plugin carries its OWN version, independent of the package",
		typeof manifest.version === "string" && /^\d+\.\d+\.\d+$/.test(manifest.version),
	);
	// herdr refuses to link a plugin whose floor is newer than the running binary, and it
	// requires the key: `validate_min_herdr_version(None)` is an error, not a default.
	ok("min_herdr_version is the measured floor 0.9.0, as a semver", manifest.min_herdr_version === "0.9.0");
	ok("platforms declares only what was measured", JSON.stringify(manifest.platforms) === JSON.stringify(["linux"]));

	const panes = manifest.panes ?? [];
	ok("exactly one pane entrypoint", panes.length === 1);
	const pane = panes[0] ?? {};
	ok("the pane is the status overlay", pane.id === "status" && pane.placement === "overlay");
	// herdr's `normalize_action_id` refuses a dot in a pane/action id.
	ok("the pane id carries no dot", typeof pane.id === "string" && !pane.id.includes("."));
	ok(
		"the pane command is an argv array (herdr runs no shell) naming only node",
		Array.isArray(pane.command) && pane.command[0] === "node" && pane.command[1] === "lib/status.mjs",
	);
	// Sizing is popup-only in herdr; declaring it on an overlay is `invalid_plugin_pane_size`.
	ok("no popup-only sizing on an overlay pane", !("width" in pane) && !("height" in pane));

	// `[[build]]` LEFT this list in #116 M3-b3: a Herdr user's one install command is the only door
	// this plugin gets, so the activation has to happen there. It is owned by
	// `check-herdr-plugin-build`, which pins the single runner it may call; what stays forbidden here
	// is everything that would VOLUNTEER — a startup hook on every server start, an event hook where
	// a watcher would grow, an action whose output goes to a 64 KiB log nobody reads.
	assert.deepEqual(
		["startup", "events", "actions", "link_handlers"].filter((k) => k in manifest),
		[],
		"[QK:HPL-MANIFEST-NO-FORBIDDEN-SECTIONS] the manifest declares no startup, event, action or link-handler section — a startup or event hook is where the watcher this lane refuses would grow, and an action sends a report nobody can read into a 64 KiB log. The one `[[build]]` section is `check-herdr-plugin-build`'s subject, not an exception carved out here",
	);
	console.log("  ok    the manifest declares no startup / event / action / link-handler section");
	passed++;
}

// ── the join the plugin must never re-implement ─────────────────────────────
{
	const source = fs.readFileSync(ENTRY, "utf8");
	// Comments are allowed to NAME the thing they refuse; code may not do it. Strip the
	// prose first so a header that explains the refusal cannot fail its own assertion.
	const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
	assert.ok(
		!/nativeSessionId/.test(code) && !/\.jsonl/.test(code) && !/agent_session/.test(code) && !/uuid/i.test(code),
		"[QK:HPL-JOIN-PANE-ID-ONLY] the pane's code never touches a native session id, a session filename, an agent_session triple or a uuid — the pi half of that join is a vendor floor measured in pi-extensions/lib/herdr-placement.ts, and a second copy out here would be a fork no gate and no document covers; the whole join this plugin is allowed to make is one opaque pane-id string equality",
	);
	console.log("  ok    the pane's code re-implements none of the placement join");
	passed++;
	ok(
		"the join is the opaque pane id, compared as a string",
		code.includes('placement.kind === "herdr-pane"') && code.includes("placement.paneId"),
	);
	// Not a word scan — the closing line of the report NAMES entwurf_v2 on purpose, to tell
	// the reader where delivery actually lives. What must be absent is the ability to DO it:
	// one spawn helper, and only the two read argvs anywhere in the file.
	ok("there is exactly one child-process call site", code.split("spawnSync(").length - 1 === 1);
	// The SET of argvs, not the sequence: how many times each read happens is counted for
	// real below, and duplicating that check here would steal that claim's kill.
	const argvs = [
		...new Set([...code.matchAll(/readJson\([^,]+,\s*(\[[^\]]*\])/g)].map((m) => (m[1] ?? "").replace(/\s+/g, ""))),
	].sort();
	ok(
		"the only argvs it can spawn are the two reads — nothing installs, configures, or delivers",
		JSON.stringify(argvs) === JSON.stringify(['["agent","list"]', '["peer-facts"]']),
	);
}

// ── behavioural: the real entry, stubbed inputs, counted calls ──────────────
interface World {
	dir: string;
	callLog: string;
	binDir: string;
}

function world(prefix: string): World {
	const dir = tmp(prefix);
	const binDir = path.join(dir, "bin");
	fs.mkdirSync(binDir);
	return { dir, callLog: path.join(dir, "calls"), binDir };
}

/** A stub that records its argv and then answers with the given bytes / exit code. */
function stub(w: World, name: string, payload: string, exitCode = 0): string {
	const payloadFile = path.join(w.dir, `${name}.payload`);
	fs.writeFileSync(payloadFile, payload);
	const p = path.join(w.binDir, name);
	fs.writeFileSync(
		p,
		`#!/bin/sh\nprintf '%s %s\\n' "${name}" "$*" >> "${w.callLog}"\ncat "${payloadFile}"\nexit ${exitCode}\n`,
	);
	fs.chmodSync(p, 0o755);
	return p;
}

interface Run {
	status: number | null;
	stdout: string;
	calls: string[];
	stateDir: string;
	configDir: string;
}

/**
 * Runs the pane entry exactly as herdr would: argv, plugin root as cwd, the plugin env
 * herdr injects. stdin is an empty closed pipe, which is the non-TTY end of the
 * hold-open wait — a busy loop or a missing wait would both show up as a hang here.
 */
function run(w: World, env: Record<string, string | undefined> = {}): Run {
	const stateDir = path.join(w.dir, "state");
	const configDir = path.join(w.dir, "config");
	fs.mkdirSync(stateDir, { recursive: true });
	fs.mkdirSync(configDir, { recursive: true });
	const home = path.join(w.dir, "home");
	fs.mkdirSync(home, { recursive: true });
	const res = spawnSync(process.execPath, [ENTRY], {
		cwd: PLUGIN_DIR,
		encoding: "utf8",
		input: "",
		timeout: 60_000,
		env: {
			PATH: `${w.binDir}:${process.env.PATH ?? ""}`,
			HOME: home,
			XDG_DATA_HOME: path.join(home, ".local", "share"),
			HERDR_ENV: "1",
			HERDR_PLUGIN_ID: "junghan0611.entwurf",
			HERDR_PLUGIN_ROOT: PLUGIN_DIR,
			HERDR_PLUGIN_STATE_DIR: stateDir,
			HERDR_PLUGIN_CONFIG_DIR: configDir,
			HERDR_PLUGIN_ENTRYPOINT_ID: "status",
			HERDR_BIN_PATH: path.join(w.binDir, "herdr"),
			...env,
		} as NodeJS.ProcessEnv,
	});
	const calls = fs.existsSync(w.callLog)
		? fs
				.readFileSync(w.callLog, "utf8")
				.split("\n")
				.filter((l) => l !== "")
		: [];
	return { status: res.status, stdout: res.stdout ?? "", calls, stateDir, configDir };
}

const PEERS = JSON.stringify({
	schemaVersion: 1,
	storeDir: "/s",
	peers: [
		{
			gardenId: "20260915T111111-aaaaaa",
			backend: "claude-code",
			nativeSessionId: "n-1",
			cwd: "/w/one",
			model: null,
			createdAt: "",
			recordUpdatedAt: "",
			liveness: "unsupported",
			receiver: "none",
			transcript: "exists",
			placement: { kind: "herdr-pane", paneId: "w1:p3" },
		},
		{
			gardenId: "20260915T222222-bbbbbb",
			backend: "pi",
			nativeSessionId: "n-2",
			cwd: "/w/two",
			model: "p/m",
			createdAt: "",
			recordUpdatedAt: "",
			liveness: "alive",
			receiver: "n/a",
			transcript: "exists",
			placement: { kind: "unobserved" },
		},
	],
	diagnostics: [
		{
			kind: "record-less-socket",
			gardenId: "20260915T333333-cccccc",
			liveness: "dead",
			message: "a socket no meta-record claims",
		},
	],
});

const agentList = (agents: unknown[]): string =>
	JSON.stringify({ id: "cli:agent:list", result: { agents, type: "agent_list" } });

// ── the ordinary open ───────────────────────────────────────────────────────
{
	const w = world("ok");
	stub(w, "entwurf", PEERS);
	stub(w, "herdr", agentList([{ pane_id: "w1:p3", agent_status: "working", terminal_id: "t1" }]));
	const r = run(w);

	ok("the pane renders and exits 0", r.status === 0);
	ok("the citizen a placement owner reported is listed", r.stdout.includes("20260915T111111-aaaaaa"));
	ok("the four identity columns are present", /garden id\s+backend\s+cwd\s+placement/.test(r.stdout));
	ok("a joined citizen shows its pane, attributed to herdr", r.stdout.includes("herdr w1:p3"));

	// THE ONE READ PER OPEN. This is counted from the stubs' own log, so it cannot be
	// satisfied by a source that merely looks like it reads once.
	assert.deepEqual(
		r.calls,
		["entwurf peer-facts", "herdr agent list"],
		`[QK:HPL-ONE-OPEN-ONE-READ] one pane open issues exactly one \`entwurf peer-facts\` and one \`herdr agent list\`, in that order and never again — peer-facts observes every citizen unbounded (measured 4.1s on a 1,150-record store), and herdr publishes no "the session reference landed" event, so any refresh, retry or poll here is both the slow path and the discovery watcher docs/mux-launch-rail.md §7 refuses (got ${JSON.stringify(r.calls)})`,
	);
	console.log("  ok    one pane open issues exactly one peer-facts and one agent list, and never again");
	passed++;

	// ACTIVITY IS HERDR'S, IN ITS OWN COLUMN, UNDER ITS OWN NAME.
	assert.ok(
		r.stdout.includes("herdr-reported activity") &&
			r.stdout.indexOf("placement") < r.stdout.indexOf("herdr-reported activity") &&
			!/liveness/.test(r.stdout.split("\n")[2] ?? ""),
		"[QK:HPL-ACTIVITY-IS-SEPARATE] herdr's agent_status is rendered in its own column under the name `herdr-reported activity`, after placement and never merged with it — it is herdr's judgement about a screen, not delivery evidence (docs/herdr-launch-rail.md §9), and a column that blurs the two is how it would start being read as liveness",
	);
	console.log("  ok    herdr activity has its own named column, separate from placement");
	passed++;

	assert.ok(
		r.stdout.includes("record-less-socket") && r.stdout.includes("a socket no meta-record claims"),
		"[QK:HPL-DIAGNOSTICS-SHOWN] the provider's diagnostics reach the operator — dropping them shows a store carrying hazards as a clean listing, which is the one lie a status pane can tell while looking green",
	);
	console.log("  ok    the provider's diagnostics reach the operator");
	passed++;

	// SEPARATE CLAIM: a hazard without its subject is a report nobody can act on.
	assert.ok(
		r.stdout.includes("gardenId=20260915T333333-cccccc") && r.stdout.includes("liveness=dead"),
		"[QK:HPL-DIAGNOSTIC-SUBJECTS] a diagnostic carries its SUBJECT to the screen — which garden id the record-less socket is, which filename failed to read — because `a hazard exists somewhere` is a line an operator can do nothing with; the fields are rendered in sorted key order so two runs read the same",
	);
	console.log("  ok    a diagnostic carries its subject fields, deterministically ordered");
	passed++;

	// IT WRITES NOTHING. The dirs herdr hands a plugin for exactly this purpose stay empty.
	assert.ok(
		fs.readdirSync(r.stateDir).length === 0 && fs.readdirSync(r.configDir).length === 0,
		"[QK:HPL-NO-WRITE] the pane writes nothing — HERDR_PLUGIN_STATE_DIR and HERDR_PLUGIN_CONFIG_DIR are still empty afterwards; a status surface that keeps state is a surface that can be stale, and this one is only ever as old as the keypress that opened it",
	);
	console.log("  ok    the pane writes nothing to its state or config dir");
	passed++;
}

// ── the render budget: a whole read, a table that stays readable ────────────
{
	const w = world("many");
	// 1,000 historical citizens the placement owner does not have, one that it does, one
	// nobody could look at. This is the operator's own store in miniature: measured
	// 2026-09-15, 1,162 records, all unobserved, 17,437 lines of peer-facts output.
	const many = Array.from({ length: 1000 }, (_, i) => ({
		gardenId: `20260101T00000${i % 10}-${i.toString(16).padStart(6, "0")}`,
		backend: "pi",
		nativeSessionId: `n-${i}`,
		cwd: "/old",
		model: null,
		createdAt: "",
		recordUpdatedAt: "",
		liveness: "dead",
		receiver: "n/a",
		transcript: "absent",
		placement: { kind: "none" },
	}));
	const visible = {
		gardenId: "20260915T444444-dddddd",
		backend: "claude-code",
		nativeSessionId: "n-vis",
		cwd: "/here",
		model: null,
		createdAt: "",
		recordUpdatedAt: "",
		liveness: "unsupported",
		receiver: "none",
		transcript: "exists",
		placement: { kind: "herdr-pane", paneId: "w1:p9" },
	};
	const blind = { ...visible, gardenId: "20260915T555555-eeeeee", placement: { kind: "unobserved" } };
	stub(
		w,
		"entwurf",
		JSON.stringify({ schemaVersion: 1, storeDir: "/s", peers: [...many, visible, blind], diagnostics: [] }),
	);
	stub(w, "herdr", agentList([{ pane_id: "w1:p9", agent_status: "idle" }]));
	const r = run(w);

	const drawn = r.stdout.split("\n").filter((l) => /^20\d{6}T/.test(l)).length;
	assert.ok(
		r.status === 0 &&
			drawn === 1 &&
			r.stdout.includes("20260915T444444-dddddd") &&
			/1000 citizen\(s\) not shown/.test(r.stdout) &&
			/nobody could observe placement/.test(r.stdout),
		`[QK:HPL-RENDER-IS-THE-VISIBLE-ONES] the table holds the citizens a placement owner REPORTED and counts the rest instead of drawing them — the read stays whole (a rationed measurement would fabricate \`unobserved\`), but 1,000 historical rows in a status pane means searching for the two citizens that are actually here, and a status surface you must search has already failed (drew ${drawn} rows)`,
	);
	console.log(`  ok    1,002 citizens render as ${drawn} table row plus counted summaries`);
	passed++;
	ok(
		"the two hidden kinds are counted apart — a completed negative read is not the same as no read",
		/1000 citizen\(s\) not shown: the placement owner was read in full/.test(r.stdout) &&
			/1 citizen\(s\) not shown: nobody could observe placement/.test(r.stdout),
	);

	// Nothing visible at all is its own answer, not an empty frame.
	const w2 = world("empty-table");
	stub(w2, "entwurf", JSON.stringify({ schemaVersion: 1, storeDir: "/s", peers: many, diagnostics: [] }));
	stub(w2, "herdr", agentList([]));
	const r2 = run(w2);
	ok(
		"no visible citizen renders `(none)`, not a bare header",
		r2.status === 0 && r2.stdout.includes("(none)") && !r2.stdout.includes("garden id  backend"),
	);
}

// ── two agents on one pane: label it, never pick ────────────────────────────
{
	const w = world("ambiguous");
	stub(w, "entwurf", PEERS);
	stub(
		w,
		"herdr",
		agentList([
			{ pane_id: "w1:p3", agent_status: "working", terminal_id: "t1" },
			{ pane_id: "w1:p3", agent_status: "idle", terminal_id: "t2" },
		]),
	);
	const r = run(w);
	assert.ok(
		r.status === 0 &&
			/20260915T111111-aaaaaa.*ambiguous/.test(r.stdout) &&
			!/20260915T111111-aaaaaa.*working/.test(r.stdout),
		"[QK:HPL-AMBIGUOUS-NOT-GUESSED] two agent rows claiming one pane read as `ambiguous`, not as whichever came first — the worth of this column is that it never guesses, and first-wins is a guess wearing a value's clothes",
	);
	console.log("  ok    two agents on one pane read as ambiguous, not first-wins");
	passed++;
}

// ── a host without Entwurf is a SKIP, not a failure ─────────────────────────
{
	const w = world("skip");
	stub(w, "herdr", agentList([]));
	// PATH holds the herdr stub but no `entwurf`, and ENTWURF_BIN is unset.
	const r = run(w, { PATH: w.binDir });
	assert.ok(
		r.status === 0 && r.stdout.trim() === "entwurf-not-found" && r.calls.length === 0,
		`[QK:HPL-SKIP-NOT-FAILURE] a host with no Entwurf prints exactly \`entwurf-not-found\` and exits 0, reading nothing — absence is a skip and only a BROKEN thing is red, because installing Entwurf is not a plugin's business (AGENTS.md Hard Rule 17) (got status ${r.status}, stdout ${JSON.stringify(r.stdout)})`,
	);
	console.log("  ok    a host with no Entwurf skips by name at exit 0, reading nothing");
	passed++;
}

// ── a listing that could not be read is never an empty table ────────────────
{
	const cases: {
		label: string;
		peerPayload: string;
		peerExit: number;
		herdrPayload: string;
		herdrExit: number;
		name: string;
	}[] = [
		{
			label: "peer-facts nonzero",
			peerPayload: "",
			peerExit: 3,
			herdrPayload: agentList([]),
			herdrExit: 0,
			name: "peer-facts-failed",
		},
		{
			label: "peer-facts unparsable",
			peerPayload: "{ not json",
			peerExit: 0,
			herdrPayload: agentList([]),
			herdrExit: 0,
			name: "peer-facts-unparsable",
		},
		{
			label: "agent list nonzero",
			peerPayload: PEERS,
			peerExit: 0,
			herdrPayload: "",
			herdrExit: 1,
			name: "herdr-agent-list-failed",
		},
		{
			label: "agent list unparsable",
			peerPayload: PEERS,
			peerExit: 0,
			herdrPayload: "<html>",
			herdrExit: 0,
			name: "herdr-agent-list-unparsable",
		},
	];
	// ONE assertion for all four, so the claim owns its own kill: a per-case ok() above it
	// would fail first and certify nothing.
	const verdicts = cases.map((c) => {
		const w = world("red");
		stub(w, "entwurf", c.peerPayload, c.peerExit);
		stub(w, "herdr", c.herdrPayload, c.herdrExit);
		const r = run(w);
		const named = r.stdout.startsWith(c.name);
		const red = r.status !== 0;
		const noTable = !r.stdout.includes("garden id");
		return {
			c,
			named,
			red,
			noTable,
			shown: `${c.label}: status=${r.status} first=${JSON.stringify(r.stdout.split("\n")[0])}`,
		};
	});
	assert.ok(
		verdicts.every((v) => v.named && v.red && v.noTable),
		`[QK:HPL-FAILED-READ-IS-RED] every unreadable listing — nonzero exit or unparsable bytes, on either side — is a NAMED non-zero refusal and never a table; a listing that could not be read must not be indistinguishable from a listing with nothing in it (${verdicts.map((v) => v.shown).join(" | ")})`,
	);
	console.log(`  ok    all ${verdicts.length} unreadable listings are named reds, never an empty table`);
	passed++;

	const w = world("no-herdr-bin");
	stub(w, "entwurf", PEERS);
	const r = run(w, { HERDR_BIN_PATH: "" });
	ok(
		"an absent HERDR_BIN_PATH is named, not guessed at",
		r.stdout.trim() === "herdr-bin-path-missing" && r.status !== 0,
	);
}

// ── the plugin stays out of the npm artifact ────────────────────────────────
{
	const pkg = JSON.parse(fs.readFileSync(path.join(REPO, "package.json"), "utf8")) as { files?: string[] };
	ok(
		"plugins/ is not in the package files list (herdr owns this lifecycle, not npm)",
		!(pkg.files ?? []).some((f) => f.startsWith("plugins")),
	);
	ok(
		"the README documents the link and install lines",
		(() => {
			const readme = fs.readFileSync(path.join(PLUGIN_DIR, "README.md"), "utf8");
			return (
				readme.includes('herdr plugin link "$PWD/plugins/herdr"') &&
				readme.includes("herdr plugin install junghan0611/entwurf/plugins/herdr") &&
				readme.includes("herdr plugin unlink junghan0611.entwurf")
			);
		})(),
	);
}

console.log(`\ncheck-herdr-plugin: ${passed} assertions passed`);
