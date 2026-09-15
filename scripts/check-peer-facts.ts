/**
 * check-peer-facts — deterministic gate for the #116 M2-a observed-peer projection
 * (`entwurf peer-facts` / scripts/peer-facts.ts).
 *
 * Drives the REAL CLI as a subprocess against sandboxed fixtures — every root it can
 * reach is an explicit mkdtemp dir (store, control-socket dir, HOME, XDG_DATA_HOME, pi
 * agent dir), so the operator's live store, sockets and markers are never read. What it
 * proves, and why each claim is its own contract rather than a restatement:
 *
 *   - `placement` crosses as the STRUCTURED tagged union, never the human `herdr <pane>`
 *     string. A machine consumer joins on `paneId`; a string forces it to re-parse a
 *     presentation decision;
 *   - the peer keyset is EXACTLY the provider's own facts — no herdr `agent_status` or any
 *     other display verdict may enter an entwurf payload, because that is the one door
 *     through which "observed activity" could drift into delivery liveness;
 *   - no socket coordinate is published: `ENTWURF_DIR` is an INPUT to the probe, never an
 *     output — #50 C4 retired the legacy listing together with the `controlDir` it exposed;
 *   - `diagnostics` survive the projection in-band (a readable store with hazards is a fact
 *     to report, not a reason to emit a clean-looking listing);
 *   - the control-socket world actually probed is the one `ENTWURF_DIR` names — proved
 *     BEHAVIOURALLY (a record-less socket in the fixture dir must surface as a diagnostic),
 *     not by echoing the field back;
 *   - no observation budget: a rationed row says `unobserved`, which in a machine payload
 *     is indistinguishable from "no herdr on this host";
 *   - an unreadable store is exit 3 with NO JSON, a missing store is a readable empty one,
 *     bad argv is exit 2;
 *   - the surface is reachable: run.sh dispatches it and the bridge build emits its
 *     compiled twin (the installed-host fence).
 *
 * The placement join itself, the one-read-per-listing rule and the peers payload keyset are
 * NOT re-proved here — they belong to check-herdr-placement, check-entwurf-fact-provider and
 * check-entwurf-peers-surface. This gate owns only what this verb adds.
 *
 * The gate spawns the CLI rather than importing its pieces because the exit code and stdout
 * bytes ARE the contract a consumer holds. Every [QK:PF-*] token appears exactly once, on
 * the assertion that fails for that claim. No herdr binary, no network, no model turn.
 */

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { type MetaIdentity, serializeMetaIdentity } from "../pi-extensions/lib/meta-session.ts";
import { reclaimOnExit } from "./lib/reclaim-on-exit.ts";

let passed = 0;
function ok(label: string, cond: boolean): void {
	assert.ok(cond, label);
	console.log(`  ok    ${label}`);
	passed++;
}

const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");

const GID_PI = "20260611T111111-aaaaaa";
const GID_CLAUDE = "20260611T222222-bbbbbb";
/** A garden id no record in any fixture claims — its socket must be DEMOTED to a diagnostic. */
const GID_ORPHAN_SOCKET = "20260611T333333-cccccc";

function tmp(prefix: string): string {
	return reclaimOnExit(fs.mkdtempSync(path.join(os.tmpdir(), `entwurf-peer-facts-${prefix}-`)));
}

function record(gardenId: string, over: Partial<MetaIdentity> = {}): string {
	return serializeMetaIdentity({
		schemaVersion: 3,
		gardenId,
		backend: "pi",
		nativeSessionId: `n-${gardenId}`,
		cwd: "/x",
		model: "provider/model",
		transcriptPath: null,
		createdAt: "2026-06-11T00:00:00.000Z",
		recordUpdatedAt: "2026-06-11T00:00:00.000Z",
		...over,
	});
}

function store(files: Record<string, string>): string {
	const dir = tmp("store");
	for (const [name, body] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), body);
	return dir;
}

interface CliRun {
	status: number | null;
	stdout: string;
	stderr: string;
}

/**
 * Every ambient root this verb or the provider beneath it could reach is replaced. HOME and
 * XDG_DATA_HOME move together: moving HOME alone still writes/reads real install-state below
 * the inherited XDG root, which is exactly how a verification sweep once polluted a live host.
 */
function cli(args: string[], env: Record<string, string> = {}): CliRun {
	const home = tmp("home");
	const res = spawnSync(process.execPath, ["--experimental-strip-types", "scripts/peer-facts.ts", ...args], {
		cwd: REPO,
		encoding: "utf8",
		env: {
			...process.env,
			HOME: home,
			XDG_DATA_HOME: path.join(home, ".local", "share"),
			PI_CODING_AGENT_DIR: path.join(home, ".pi", "agent"),
			ENTWURF_DIR: tmp("control"),
			// A herdr read here would be a child process and a live-host dependency. The
			// provider's own gate owns that axis; this one must stay hermetic.
			HERDR_ENV: "0",
			...env,
		},
	});
	return { status: res.status, stdout: res.stdout ?? "", stderr: res.stderr ?? "" };
}

interface Placement {
	kind: string;
	paneId?: string;
}
interface Peer {
	gardenId: string;
	backend: string;
	cwd: string;
	placement: Placement;
	transcript: string;
	[k: string]: unknown;
}
interface Projection {
	schemaVersion: number;
	storeDir: string;
	peers: Peer[];
	diagnostics: { kind: string; message: string }[];
}

function parseProjection(run: CliRun, label: string): Projection {
	assert.equal(run.status, 0, `${label}: exit 0 (stderr: ${run.stderr})`);
	return JSON.parse(run.stdout) as Projection;
}

// ── the projection carries the provider's facts, addressably ────────────────
{
	const transcriptDir = tmp("transcripts");
	const transcript = path.join(transcriptDir, "live.jsonl");
	fs.writeFileSync(transcript, "{}\n");

	const dir = store({
		[`${GID_PI}.meta.json`]: record(GID_PI),
		[`${GID_CLAUDE}.meta.json`]: record(GID_CLAUDE, {
			backend: "claude-code",
			nativeSessionId: "ce224ad7-9e29-41a5-81c3-08e09f017802",
			transcriptPath: transcript,
		}),
	});
	const facts = parseProjection(cli([dir]), "valid store");

	ok(
		"projection declares schemaVersion 1 and echoes the store it was told to read",
		facts.schemaVersion === 1 && facts.storeDir === dir,
	);
	// Deliberately does NOT inspect `placement`: the shape of that field is the next
	// assertion's own claim, and a generic check here would steal its kill.
	ok(
		"both citizens cross with the identity fields a renderer needs",
		facts.peers.length === 2 &&
			facts.peers.every(
				(p) => typeof p.gardenId === "string" && typeof p.backend === "string" && typeof p.cwd === "string",
			),
	);

	// PLACEMENT STAYS STRUCTURED. `unobserved` is the only value reachable without a herdr
	// host, and that is enough: the human rendering of THAT value is the bare string
	// "unobserved", so a projection that stringified it would be caught right here.
	const placements = facts.peers.map((p) => p.placement);
	assert.ok(
		placements.every(
			(pl) => typeof pl === "object" && pl !== null && !Array.isArray(pl) && typeof pl.kind === "string",
		),
		'[QK:PF-PLACEMENT-STRUCTURED] placement crosses as the tagged union object ({kind:…}), never the human "herdr <pane>" / bare-kind string a renderer would have to re-parse',
	);
	console.log("  ok    placement crosses as the tagged union object, never the human string");
	passed++;
	ok(
		"no herdr on this host reads as unobserved, not none",
		placements.every((pl) => pl.kind === "unobserved"),
	);

	// THE PROMOTION BARRIER. herdr owns idle/working/blocked/done and it is a screen verdict;
	// the moment one of those words enters an entwurf payload it is one rename away from
	// being read as delivery liveness. So the keyset is pinned EXACTLY, not by denylist.
	const PEER_KEYS = [
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
	];
	for (const peer of facts.peers) {
		assert.deepEqual(
			Object.keys(peer).sort(),
			PEER_KEYS,
			"[QK:PF-PEER-KEYSET-EXACT] a peer row carries exactly the provider's own facts — no herdr agent_status / interactive_ready / screen verdict may enter an entwurf payload, because that is the door observed activity would use to become delivery liveness",
		);
	}
	console.log("  ok    a peer row carries exactly the provider's own facts, with no herdr display verdict");
	passed++;
	// FOUR, not five: the control dir is an INPUT to the probe and never an output. #50 C4
	// retired the legacy projection "with the `controlDir` it exposed" — the record is the
	// sole address axis and a socket path is dispatch-internal transport. A new verb may not
	// quietly republish it.
	assert.deepEqual(
		Object.keys(facts as unknown as Record<string, unknown>).sort(),
		["diagnostics", "peers", "schemaVersion", "storeDir"],
		"[QK:PF-NO-SOCKET-COORDINATE] the projection publishes no socket coordinate — #50 C4 retired the legacy listing WITH the controlDir it exposed, because the record is the sole address axis and a socket path is dispatch-internal transport; a new verb that republishes it undoes that retirement while looking like a convenience",
	);
	console.log("  ok    the projection publishes no socket coordinate (four documented fields)");
	passed++;

	// NO OBSERVATION BUDGET. A rationed row says `unobserved`; in a machine payload that is
	// indistinguishable from "nobody could look". The live transcript below is the witness:
	// under a budget it would read `unobserved` instead of `exists`.
	const claude = facts.peers.find((p) => p.gardenId === GID_CLAUDE);
	assert.ok(
		claude !== undefined && claude.transcript === "exists",
		"[QK:PF-NO-OBSERVATION-BUDGET] every row is observed — a presentation budget would emit `unobserved` for rows nobody chose to skip, which a machine consumer cannot tell apart from `nobody could look`",
	);
	console.log("  ok    every row is observed — no presentation budget rations a machine projection");
	passed++;

	const again = parseProjection(cli([dir]), "re-run");
	ok("output is byte-deterministic across runs", JSON.stringify(again.peers) === JSON.stringify(facts.peers));
}

// ── diagnostics ride in-band, they are not a reason to look clean ───────────
{
	const dir = store({
		[`${GID_PI}.meta.json`]: record(GID_PI),
		[`${GID_CLAUDE}.meta.json`]: "{ not json",
	});
	const facts = parseProjection(cli([dir]), "store with a defect");
	ok("a readable store with an uncertifiable entry still reports its healthy citizen", facts.peers.length === 1);
	assert.ok(
		facts.diagnostics.some((d) => d.kind === "meta-record-read-error"),
		"[QK:PF-DIAGNOSTICS-PRESERVED] the provider's diagnostics cross the projection in-band — dropping them turns a store with hazards into a clean-looking listing at exit 0",
	);
	console.log("  ok    the provider's diagnostics cross the projection in-band");
	passed++;
}

// ── the socket world probed is the one ENTWURF_DIR names, proved behaviourally ──
{
	const dir = store({ [`${GID_PI}.meta.json`]: record(GID_PI) });
	const control = tmp("control-seeded");
	// Not a listening socket — a plain file with the socket grammar. The probe fails, the
	// liveness is `dead`, and the point stands: this path was READ. A verb that ignored
	// ENTWURF_DIR would probe the sandbox HOME's default dir and report nothing here.
	fs.writeFileSync(path.join(control, `${GID_ORPHAN_SOCKET}.sock`), "");

	const facts = parseProjection(cli([dir], { ENTWURF_DIR: control }), "seeded control dir");
	// The proof has to be behavioural precisely BECAUSE the dir is not emitted: there is no
	// field to read back, so the witness is what the probe found in it.
	ok(
		"the probed dir is not echoed into the payload",
		!Object.hasOwn(facts as unknown as Record<string, unknown>, "controlDir"),
	);
	assert.ok(
		facts.diagnostics.some((d) => d.kind === "record-less-socket" && d.message.length > 0),
		"[QK:PF-CONTROL-DIR-PROBED] the socket world actually probed is the one ENTWURF_DIR names — the same override the bridge honours, so this verb and entwurf_peers can never answer from two different socket worlds",
	);
	console.log("  ok    the socket world probed is the one ENTWURF_DIR names");
	passed++;
}

// ── the exit contract ───────────────────────────────────────────────────────
{
	const missing = path.join(tmp("absent"), "no-such-store");
	const run = cli([missing]);
	const facts = parseProjection(run, "missing store");
	ok("a store that does not exist is a readable EMPTY store, exit 0", facts.peers.length === 0);

	// An unreadable store must never be mistakable for an empty one, so the refusal is both
	// a distinct exit code AND an empty stdout — a consumer that only reads stdout still
	// cannot parse a false success out of it.
	const unreadable = tmp("unreadable");
	fs.writeFileSync(path.join(unreadable, "blocker"), "");
	fs.chmodSync(unreadable, 0o000);
	const denied = cli([unreadable]);
	fs.chmodSync(unreadable, 0o700);
	assert.ok(
		denied.status === 3 && denied.stdout === "",
		`[QK:PF-EXIT-UNREADABLE] an unreadable store is exit 3 with no JSON — answering it as exit 0 would make an unreadable host look like an empty one (got ${denied.status}, stdout ${JSON.stringify(denied.stdout.slice(0, 80))})`,
	);
	console.log("  ok    an unreadable store is exit 3 with no JSON");
	passed++;

	const flag = cli(["--help"]);
	assert.ok(
		flag.status === 2 && flag.stdout === "",
		"[QK:PF-USAGE] a dash argv is a flag this command does not have — reading it as a store directory would answer `--help` with `empty store, exit 0`, a silent wrong fact",
	);
	console.log("  ok    a dash argv is a usage error, not a store directory");
	passed++;
	ok("a second positional is a usage error", cli(["/a", "/b"]).status === 2);
}

// ── the surface is reachable from an installed host ─────────────────────────
{
	const runSh = fs.readFileSync(path.join(REPO, "run.sh"), "utf8");
	ok(
		"run.sh dispatches peer-facts through the single run_ts fence",
		/\n {2}peer-facts\)\n(?:.*\n)*?\s*run_ts scripts\/peer-facts\.ts "\$@"\n/.test(runSh),
	);
	ok("run.sh documents peer-facts in its usage block", runSh.includes("./run.sh peer-facts "));
	const build = fs.readFileSync(path.join(REPO, "mcp/entwurf-bridge/tsconfig.build.json"), "utf8");
	ok(
		"the bridge build emits the compiled twin (installed hosts cannot strip-types)",
		build.includes('"../../scripts/peer-facts.ts"'),
	);
	ok(
		"both pack artifact lists carry the compiled twin",
		(runSh.match(/"mcp\/entwurf-bridge\/dist\/scripts\/peer-facts\.js"/g) ?? []).length === 2,
	);
}

console.log(`\ncheck-peer-facts: ${passed} assertions passed`);
