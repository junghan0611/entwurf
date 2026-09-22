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
import * as HERDR_RAILS from "../scripts/herdr-rails.mjs";
import * as ACTIVATION from "./herdr-activation.mjs";
import * as RUNTIME from "./herdr-runtime.mjs";
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
	// the reader where delivery actually lives. What must be absent is the ability to DO it.
	//
	// #116 A2/P1: the READS grew to three and the CALL SITE stayed at one. herdr's `integration
	// status` has no machine format at all (integration-profile.mjs: `--json`/`--format=json`/
	// `-o json` each exit 2), so its bytes go to a prose parser instead of `JSON.parse` — that
	// buys a second PARSER, which is a different thing from a second way to start a process. One
	// `spawnOnce` serves both, and the argv SET below is what proves the pane cannot install,
	// configure or deliver.
	ok("there is exactly one child-process call site", code.split("spawnSync(").length - 1 === 1);
	// The SET of argvs, not the sequence: how many times each read happens is counted for
	// real below, and duplicating that check here would steal that claim's kill.
	const argvs = [
		...new Set(
			[...code.matchAll(/(?:readJson|spawnOnce)\([^,]+,\s*(\[[^\]]*\])/g)]
				.map((m) => (m[1] ?? "").replace(/\s+/g, ""))
				.filter((a) => a !== ""),
		),
	].sort();
	ok(
		"the only argvs it can spawn are the three reads — nothing installs, configures, or delivers",
		JSON.stringify(argvs) === JSON.stringify(['["agent","list"]', '["integration","status"]', '["peer-facts"]']),
	);
}

// ── behavioural: the real entry, stubbed inputs, counted calls ──────────────
const agentList = (agents: unknown[]): string =>
	JSON.stringify({ id: "cli:agent:list", result: { agents, type: "agent_list" } });

/** Herdr's own listing shape, both selected atoms current. Measured grammar, not invented. */
const INTEGRATION_BOTH_CURRENT = [
	"pi: current (v8) (/h/pi)",
	"claude: current (v8) (/h/claude)",
	"opencode: not installed (/h/oc)",
	"",
].join("\n");

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

/**
 * A herdr stub that answers DIFFERENTLY per verb, which the pane now requires: `integration
 * status` returns a prose listing and `agent list` returns JSON, and a single-payload stub
 * would feed one of them the other's bytes. Both answers are still recorded in one call log,
 * so the read-count claim below is unchanged in kind.
 */
function stubHerdr(
	w: World,
	opts: { integration?: string; agents?: string; agentsExit?: number; integrationExit?: number },
): string {
	// The payloads are EMBEDDED and emitted with `printf`, a shell builtin, rather than read back
	// with `cat`. The skip cell runs with PATH set to this bin dir alone — that is the whole point
	// of it — and a stub that shells out to an external tool answers an empty body there while
	// still exiting 0, which reads as "herdr said nothing" instead of "the stub is broken".
	const p = path.join(w.binDir, "herdr");
	fs.writeFileSync(
		p,
		`#!/bin/sh\nprintf '%s %s\\n' "herdr" "$*" >> "${w.callLog}"\n` +
			`case "$1 $2" in\n` +
			`  "integration status") printf '%s' ${shq(opts.integration ?? INTEGRATION_BOTH_CURRENT)}; exit ${opts.integrationExit ?? 0} ;;\n` +
			`  *) printf '%s' ${shq(opts.agents ?? agentList([]))}; exit ${opts.agentsExit ?? 0} ;;\n` +
			`esac\n`,
	);
	fs.chmodSync(p, 0o755);
	return p;
}

/**
 * A `ready` npm artifact identity, in the EXACT key set `herdr-runtime.mjs` certifies
 * (`ARTIFACT_KEYS.npm.ready`), with `observedDigest` in the exact `sha256-<64 hex>` form the reader
 * enforces. Two earlier fixtures — a short key set, then a `sha512-` digest — each produced
 * `activation-ledger-uncertified`, which is the reader doing its job; a ledger the real reader
 * rejects proves nothing about a healthy host.
 */
const READY_NPM_IDENTITY = {
	kind: "npm",
	name: "@junghanacs/entwurf",
	version: "0.24.0",
	expectedIntegrity: "sha512-AAAA",
	observedDigest: `sha256-${"a".repeat(64)}`,
};

/**
 * Turn a world into a host that HAS activated: the installed reader, a certified ledger whose
 * `runtimeRoot` is the one this host derives, and an executable runtime bin. Returns the env
 * overrides that point the pane at it, so a cell can opt in without repeating the fixture.
 */
function activateHost(w: World, opts: { runtimeBinPayload?: string; logAs?: string } = {}): Record<string, string> {
	const home = path.join(w.dir, "activated-home");
	const dataHome = path.join(home, ".local", "share");
	const stateHome = path.join(home, ".local", "state");
	const activeDir = path.join(dataHome, "entwurf", "herdr-plugin", "runtime", "active");
	fs.mkdirSync(path.join(activeDir, "node_modules", ".bin"), { recursive: true });
	const readerDir = path.join(activeDir, "node_modules", "@junghanacs", "entwurf", "scripts");
	fs.mkdirSync(readerDir, { recursive: true });
	installReader(readerDir);
	const bin = path.join(activeDir, "node_modules", ".bin", "entwurf");
	fs.writeFileSync(
		bin,
		`#!/bin/sh\nprintf '%s %s\\n' "${opts.logAs ?? "entwurf"}" "$*" >> "${w.callLog}"\nprintf '%s' ${shq(opts.runtimeBinPayload ?? PEERS)}\n`,
	);
	fs.chmodSync(bin, 0o755);
	writeLedgerAt({ HOME: home, XDG_STATE_HOME: stateHome }, ledgerBody(activeDir));
	return { HOME: home, XDG_DATA_HOME: dataHome, XDG_STATE_HOME: stateHome };
}

/**
 * Put a ledger where the WRITER would put it, and never by spelling the path out here.
 *
 * `[측정]` `scripts/herdr-activation.mjs:85-96` resolves the ledger under XDG **state**, while
 * `scripts/herdr-runtime.mjs:221-242` installs the runtime under XDG **data**. A fixture that wrote
 * its own `<data>/entwurf/herdr-plugin/activation.json` therefore agreed with a READER that looked
 * in the wrong root and disagreed with every real host — a green cell certifying a pane that, on a
 * correctly activated host, died with `TypeError: Cannot read properties of null (reading
 * 'runtimeRoot')` before drawing a single block. So the fixture calls the writer's own resolver: a
 * locator that drifts again cannot be matched by a gate that drifted with it.
 */
function writeLedgerAt(env: { HOME: string; XDG_STATE_HOME: string }, body: Record<string, unknown>): string {
	const ledgerPath = ACTIVATION.resolveActivationLayout(env).ledgerPath as string;
	fs.mkdirSync(path.dirname(ledgerPath), { recursive: true });
	fs.writeFileSync(ledgerPath, `${JSON.stringify(body, null, 2)}\n`);
	return ledgerPath;
}

/** A certified ledger body for a given runtime root. */
function ledgerBody(activeDir: string): Record<string, unknown> {
	return {
		schemaVersion: 2,
		phase: "active",
		runtimeRoot: activeDir,
		artifactIdentity: READY_NPM_IDENTITY,
		piAgentDir: { path: "/p", source: "default" },
		claudeConfigDir: { path: "/c", source: "default" },
		claudeUserConfig: { path: "/c/u", source: "HOME" },
		activatedBackends: ["pi"],
		components: [{ backend: "pi", state: "active" }],
	};
}

/**
 * Lay down the INSTALLED runtime's own copy of the activation reader — the artifact that WROTE the
 * ledger (build.mjs:70,113 resolve the activation verb inside the installed package, never in this
 * checkout). It is a two-file module: `herdr-activation.mjs` value-imports `herdr-runtime.mjs`, and
 * copying only the first produced `activation-reader-unavailable` — correct behaviour against a
 * broken install, and the wrong fixture for a healthy one.
 */
function installReader(readerScripts: string): void {
	for (const f of ["herdr-activation.mjs", "herdr-runtime.mjs"]) {
		fs.copyFileSync(path.join(REPO, "scripts", f), path.join(readerScripts, f));
	}
}

/** Single-quote a payload for /bin/sh. The only escape a single-quoted word needs is its own quote. */
function shq(value: string): string {
	return `'${value.replace(/'/g, `'"'"'`)}'`;
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
			// The ledger's root, and it is NOT the runtime's. `herdr-activation.mjs` writes under XDG
			// **state**; `herdr-runtime.mjs` installs under XDG **data**. Both are spelled out here so a
			// cell that overrides one and forgets the other cannot silently read the operator's real host.
			XDG_STATE_HOME: path.join(home, ".local", "state"),
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

// ── #116 A-P1: two artifacts, two jobs — location here, certification there ──
{
	const src = fs.readFileSync(path.join(PLUGIN_DIR, "lib", "activation-evidence.mjs"), "utf8");
	const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
	// The checkout's activation module may answer WHERE, and only where. The BODY is certified by
	// the installed runtime's own copy, because the pane and the writer are two artifacts that can
	// ship two `ACTIVATION_SCHEMA_VERSION`s and a checkout-side parser would report a newer
	// runtime's ledger as uncertified on a perfectly healthy host. Location is not schema-versioned;
	// certification is. So: the checkout module is reached for `resolveActivationLayout` and for
	// nothing else.
	const checkoutCalls = [...code.matchAll(/activationModule\.([A-Za-z_$][\w$]*)/g)].map((m) => m[1]);
	ok(
		"the checkout activation module is asked only WHERE the ledger is, never to certify it",
		checkoutCalls.length > 0 && checkoutCalls.every((name) => name === "resolveActivationLayout"),
	);
	// EXACTLY ONE parse of the ledger body, and it is on the dynamically imported installed reader.
	// Two parses would be two chances to disagree about one file; a parse on the checkout module
	// would be the false red above wearing the installed reader's name.
	const reads = [...code.matchAll(/([A-Za-z_$][\w$]*)\.readCertifiedLedger\(/g)].map((m) => m[1]);
	ok(
		"the ledger body is parsed exactly once, by the installed runtime's own reader",
		reads.length === 1 && reads[0] === "reader" && !code.includes("activationModule.readCertifiedLedger"),
	);
}

// ── #120: the package name is the CHECKOUT MANIFEST's, on BOTH lock carriers ──
{
	// THE PREMISE IS MEASURED HERE, NOT QUOTED. `runtime-lock.json` is a discriminated union and
	// only its `npm` arm carries a `name`; the `herdr-checkout` arm is `{source, repository}` and
	// nothing more. So this cell writes that arm and asks the real reader what `.name` is, rather
	// than asserting a sentence about it — if a future lock schema grows a name on that arm, the
	// premise stops being true HERE instead of quietly somewhere else.
	const lockDir = tmp("lock-arm");
	fs.writeFileSync(
		path.join(lockDir, "runtime-lock.json"),
		`${JSON.stringify({ schemaVersion: 2, source: "herdr-checkout", repository: RUNTIME.CHECKOUT_REPOSITORY })}\n`,
	);
	const checkoutArm = RUNTIME.readRuntimeLock(lockDir) as { name?: unknown };
	// AND THE CONSEQUENCE IS STRUCTURAL, because the behavioural half is only true while the
	// committed lock happens to BE the checkout carrier. Every candidate window rides that carrier
	// and every published cut re-pins to npm afterwards, so a cell that merely spawned the pane
	// today would silently stop testing this the moment the npm pin returns. What must hold on both
	// carriers is that this module never asks the lock at all: the manifest is the one name both
	// arms already agree about (`certifyLockCoherence` binds the npm arm to it, and the checkout arm
	// packs that very manifest). Comments are stripped first, so prose about the lock cannot satisfy
	// the claim — and prose about it is exactly what the retired doctrine left behind.
	const code = fs
		.readFileSync(path.join(PLUGIN_DIR, "lib", "activation-evidence.mjs"), "utf8")
		.replace(/\/\*[\s\S]*?\*\//g, "")
		.replace(/^\s*\/\/.*$/gm, "");
	ok(
		"[QK:HPL-PACKAGE-NAME-FROM-MANIFEST] the installed reader's package directory name comes from the " +
			"CHECKOUT MANIFEST and the lock is never asked for it — measured, the `herdr-checkout` arm carries no " +
			"`name` at all, so reading one off it yields `undefined` and `path.join` answers that with a TypeError " +
			"rather than any refusal this state machine can name: the pane died before drawing a single block on " +
			"exactly the carrier both v0.23.1 and v0.24.0 were tagged on " +
			`(checkout-arm-name=${JSON.stringify(checkoutArm.name)} asks-manifest=${code.includes("runtimeModule.readCheckoutPackageSpec(")} asks-lock=${/readRuntimeLock\s*\(/.test(code)})`,
		checkoutArm.name === undefined &&
			code.includes("runtimeModule.readCheckoutPackageSpec(") &&
			!/readRuntimeLock\s*\(/.test(code),
	);
}

// ── #116 A-P1 [Blocker]: the ledger is read where the WRITER puts it ───────
{
	// THIS CELL IS FIRST BECAUSE EVERY OTHER ACTIVATION CLAIM STANDS ON IT. The writer puts the
	// ledger under XDG **state** (`herdr-activation.mjs:85-96`); the runtime tree lives under XDG
	// **data** (`herdr-runtime.mjs:221-242`). Reading it from the data root finds nothing on a
	// correctly activated host, and `readCertifiedLedger` answers a missing file with `null` —
	// measured before this cell existed, the pane died on that null with
	// `TypeError: Cannot read properties of null (reading 'runtimeRoot')` and drew ZERO blocks.
	const w = world("locator");
	const env = activateHost(w);
	stubHerdr(w, {});
	// A DECOY at the RUNTIME's data root: bytes the real reader refuses. Nothing writes a ledger
	// there, so its only reader is a locator that has drifted back — and then this pane says
	// `activation-ledger-uncertified` about a host whose ledger is certified and sitting elsewhere.
	fs.mkdirSync(path.join(env.XDG_DATA_HOME, "entwurf", "herdr-plugin"), { recursive: true });
	fs.writeFileSync(path.join(env.XDG_DATA_HOME, "entwurf", "herdr-plugin", "activation.json"), '{"schemaVersion":1}\n');

	const r = run(w, env);
	const activation = r.stdout.slice(r.stdout.indexOf("[2] ENTWURF ACTIVATION"), r.stdout.indexOf("[3] RAILS"));
	const writerLedger = ACTIVATION.resolveActivationLayout({
		HOME: env.HOME,
		XDG_STATE_HOME: env.XDG_STATE_HOME,
	}).ledgerPath as string;
	assert.ok(
		fs.existsSync(writerLedger) &&
			activation.includes("phase: active") &&
			!activation.includes("activation-ledger-uncertified") &&
			!activation.includes("activation-ledger-missing"),
		`[QK:HPL-LEDGER-AT-WRITER-PATH] the activation block reads the ledger from the path its WRITER owns (XDG state, \`resolveActivationLayout\`), not from the runtime's data root (\`resolveRuntimeLayout().pluginRoot\`) — the two roots differ on every host, so a pane that looks in the second one reports a correctly activated host as having no ledger, or reports whatever unrelated bytes are sitting there. A decoy the real reader refuses is planted at the data root precisely so a drifted locator cannot pass quietly (ledger at ${writerLedger}, block was ${JSON.stringify(activation.split("\n").slice(0, 3).join(" / "))})`,
	);
	console.log("  ok    the ledger is read from the writer's own XDG state path, not the runtime data root");
	passed++;
}

// ── the ordinary open ───────────────────────────────────────────────────────
{
	const w = world("ok");
	// A world that HAS activated. Without it every unrelated cell also depended on the
	// activation block's `absent` arm, and a mutant that turned absence into an error was killed
	// by "the pane renders and exits 0" instead of by the claim that owns that arm — a kill
	// nobody could attribute. Measured, then fixed here rather than by loosening the claim.
	const ledgerHome = activateHost(w);
	stub(w, "entwurf", PEERS);
	stubHerdr(w, { agents: agentList([{ pane_id: "w1:p3", agent_status: "working", terminal_id: "t1" }]) });
	const r = run(w, ledgerHome);

	ok("the pane renders and exits 0", r.status === 0);
	ok("the citizen a placement owner reported is listed", r.stdout.includes("20260915T111111-aaaaaa"));
	ok("the four identity columns are present", /garden id\s+backend\s+cwd\s+placement/.test(r.stdout));
	ok("a joined citizen shows its pane, attributed to herdr", r.stdout.includes("herdr w1:p3"));

	// THE READS PER OPEN. Counted from the stubs' own log, so it cannot be satisfied by a source
	// that merely looks like it reads once.
	//
	// #116 A2 AMENDMENT, visible on purpose: the SET grew from two reads to three when the
	// integration block landed. The CADENCE did not move — still at most one of each, still only
	// during this one open, still no refresh/retry/watcher. The claim asserts the exact sequence
	// so a fourth read, a repeat, or a reorder all land here.
	assert.deepEqual(
		r.calls,
		["herdr integration status", "entwurf peer-facts", "herdr agent list"],
		`[QK:HPL-ONE-OPEN-ONE-READ] one pane open issues exactly one \`herdr integration status\`, one \`entwurf peer-facts\` and one \`herdr agent list\`, in that order and never again — peer-facts observes every citizen unbounded (measured 4.1s on a 1,150-record store), and herdr publishes no "the session reference landed" event, so any refresh, retry or poll here is both the slow path and the discovery watcher docs/mux-launch-rail.md §7 refuses (got ${JSON.stringify(r.calls)})`,
	);
	console.log("  ok    one pane open issues exactly one of each of the three reads, and never again");
	passed++;

	// ACTIVITY IS HERDR'S, IN ITS OWN COLUMN, UNDER ITS OWN NAME.
	// The TABLE HEADER ROW, found by its first column rather than by a line index: the pane's
	// closing guidance also contains the phrase `herdr-reported activity` (it explains what the
	// column means), so a whole-stdout containment test passes even when the header itself has
	// been renamed — measured, by a mutant that renamed it to `liveness` and survived.
	const header = r.stdout.split("\n").find((l) => l.startsWith("garden id")) ?? "";
	assert.ok(
		header.includes("herdr-reported activity") &&
			header.indexOf("placement") < header.indexOf("herdr-reported activity") &&
			!/liveness/.test(header),
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
	const manyHome = activateHost(w);
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
	stubHerdr(w, { agents: agentList([{ pane_id: "w1:p9", agent_status: "idle" }]) });
	const r = run(w, manyHome);

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
	const emptyHome = activateHost(w2);
	stub(w2, "entwurf", JSON.stringify({ schemaVersion: 1, storeDir: "/s", peers: many, diagnostics: [] }));
	stubHerdr(w2, {});
	const r2 = run(w2, emptyHome);
	ok(
		"no visible citizen renders `(none)`, not a bare header",
		r2.status === 0 && r2.stdout.includes("(none)") && !r2.stdout.includes("garden id  backend"),
	);
}

// ── two agents on one pane: label it, never pick ────────────────────────────
{
	const w = world("ambiguous");
	const ambiguousHome = activateHost(w);
	stub(w, "entwurf", PEERS);
	stubHerdr(w, {
		agents: agentList([
			{ pane_id: "w1:p3", agent_status: "working", terminal_id: "t1" },
			{ pane_id: "w1:p3", agent_status: "idle", terminal_id: "t2" },
		]),
	});
	const r = run(w, ambiguousHome);
	assert.ok(
		r.status === 0 &&
			/20260915T111111-aaaaaa.*ambiguous/.test(r.stdout) &&
			!/20260915T111111-aaaaaa.*working/.test(r.stdout),
		"[QK:HPL-AMBIGUOUS-NOT-GUESSED] two agent rows claiming one pane read as `ambiguous`, not as whichever came first — the worth of this column is that it never guesses, and first-wins is a guess wearing a value's clothes",
	);
	console.log("  ok    two agents on one pane read as ambiguous, not first-wins");
	passed++;
}

// ── a host without Entwurf skips the CITIZEN axis, and only that axis ───────
{
	const w = world("skip");
	stubHerdr(w, {});
	// PATH holds the herdr stub but no `entwurf`, ENTWURF_BIN is unset, and the sandbox HOME has
	// no activation ledger and no runtime — so the D3=C fallback has nothing to offer either.
	const r = run(w, { PATH: w.binDir });
	assert.ok(
		r.status === 0 &&
			r.stdout.includes("entwurf-not-found") &&
			!r.calls.some((c) => c.startsWith("entwurf ")) &&
			/\[4\] CITIZENS/.test(r.stdout) &&
			/\[1\] HERDR INTEGRATION/.test(r.stdout) &&
			/\[2\] ENTWURF ACTIVATION/.test(r.stdout) &&
			/\[3\] RAILS/.test(r.stdout) &&
			// The same world says the other half of this fact: a host with no ledger AND no runtime
			// reports activation as ABSENT, not as a failure. It is one world, so it gets one claim —
			// two claims owning it would make every mutant on that arm unattributable.
			r.stdout.includes("this host has not activated Entwurf") &&
			!r.stdout.includes("activation-reader-unavailable"),
		`[QK:HPL-SKIP-NOT-FAILURE] a host with no Entwurf names \`entwurf-not-found\` on the CITIZEN block, exits 0, and spawns no entwurf at all — absence is a skip and only a BROKEN thing is red, because installing Entwurf is not a plugin's business and the ACTIVATION block reports ABSENT rather than an error — never activating is a state, not a defect, and calling it red would make "I have not installed this yet" indistinguishable from "your install is broken" (AGENTS.md Hard Rule 17). #116 A-D3=C AMENDMENT, narrowed visibly: this used to require the WHOLE pane to be that one token with zero reads. Blocks 1-3 do not need an entwurf binary and withholding them said less than we knew, so the skip is now scoped to the axis that actually cannot be answered (got status ${r.status}, calls ${JSON.stringify(r.calls)})`,
	);
	console.log("  ok    no Entwurf: the citizen block alone skips by name, blocks 1-3 still render, exit 0");
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
		const redHome = activateHost(w);
		stub(w, "entwurf", c.peerPayload, c.peerExit);
		stubHerdr(w, { agents: c.herdrPayload, agentsExit: c.herdrExit });
		const r = run(w, redHome);
		// #116 A1: the name now lives in the CITIZENS block rather than at the top of the pane —
		// each block reports its own outcome in its own voice, so the failure has to be found in
		// the block that owns it. Asserting the section, not merely the whole stdout, is what keeps
		// this from passing on a name that leaked into some other block's prose.
		const citizens = r.stdout.slice(r.stdout.indexOf("[4] CITIZENS"));
		const named = citizens.includes(c.name);
		const red = r.status !== 0;
		// The TABLE, not the word: the pane's closing guidance names "garden id" on every open
		// (it tells the reader where delivery lives), so the absence being asserted here is the
		// column HEADER — the thing that would make a failed read look like a read that found
		// nothing. Matching the bare word instead would have made this cell unfailable.
		const noTable = !r.stdout.includes("garden id  backend");
		return {
			c,
			named,
			red,
			noTable,
			shown: `${c.label}: status=${r.status} citizens=${JSON.stringify(citizens.split("\n").slice(0, 2).join(" / "))}`,
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

// ── #116 A: four blocks, four owners, four times, and NO aggregate ──────────
{
	const w = world("blocks");
	const blocksHome = activateHost(w);
	stub(w, "entwurf", PEERS);
	stubHerdr(w, { agents: agentList([{ pane_id: "w1:p3", agent_status: "working" }]) });
	const r = run(w, blocksHome);

	// POSITIVE and STRUCTURAL: every block must SAY who owns it and when its fact was true.
	// This is the primary oracle for the no-merged-green contract — a surface that states four
	// provenances cannot also be reduced to one word without contradicting itself on screen.
	const blockLine = (n: number): string => r.stdout.split("\n").find((l) => l.startsWith(`[${n}] `)) ?? "";
	assert.ok(
		/^\[1\] HERDR INTEGRATION — owner: herdr; read now, this open$/.test(blockLine(1)) &&
			/^\[2\] ENTWURF ACTIVATION — owner: entwurf; recorded at install time — not re-checked now$/.test(blockLine(2)) &&
			/^\[3\] RAILS — owner: entwurf \(this package\); declared by this package — not a fact about this host$/.test(
				blockLine(3),
			) &&
			/^\[4\] CITIZENS — owner: entwurf; read now, this open$/.test(blockLine(4)),
		`[QK:HPL-BLOCK-PROVENANCE] each of the four blocks renders its OWN owner and its OWN observation time, and the three times stay distinct — herdr's listing is true NOW, the activation ledger is an INSTALL-TIME receipt nobody re-checked, the rails table is STATIC and is a property of this package rather than of this host. Collapsing any of them into "wired" would have to pick one time and be wrong about the other two (got ${JSON.stringify([1, 2, 3, 4].map(blockLine))})`,
	);
	console.log("  ok    four blocks, each naming its own owner and observation time");
	passed++;

	// The SECONDARY tripwire, and it is deliberately narrow: a summary token. It backs the
	// structural claim above rather than standing in for it, and it does NOT ban the word `ok`,
	// which every block legitimately needs for its own outcome.
	assert.ok(
		!/\b(overall|all ready|all green|everything is ready|fully wired)\b/i.test(r.stdout),
		`[QK:HPL-NO-AGGREGATE-VERDICT] no aggregate verdict token is rendered anywhere — no "overall", no "all ready", no readiness word over the four blocks. The render leaf has no reducer to offer, and this tripwire is what keeps one from being added as prose later (stdout carried one)`,
	);
	console.log("  ok    no aggregate verdict token over the four blocks");
	passed++;

	// RAILS come from the shared declaration leaf, not from prose in this pane.
	assert.ok(
		HERDR_RAILS.HERDR_FRESH_CALL_BACKENDS.every(
			(b) => r.stdout.includes(`  ${b}: `) && r.stdout.includes(HERDR_RAILS.MODEL_SYNTAX_EXAMPLE[b]),
		) &&
			!/provider|quota|subscription|openrouter|billing/i.test(
				r.stdout.slice(r.stdout.indexOf("[3] RAILS"), r.stdout.indexOf("[4] CITIZENS")),
			),
		`[QK:HPL-RAILS-SHARED-SOURCE] the RAILS block renders exactly the backends and the one model SYNTAX example that scripts/herdr-rails.mjs declares, and names no provider, quota, subscription or billing — a model example that mentioned a provider would read as an answer to #76, which is a rail-policy question this pane does not decide`,
	);
	console.log("  ok    rails and model examples come from the shared leaf, with no provider policy");
	passed++;
}

// ── #116 A-D3=C: the ledger fallback, and the precedence it may never out-vote ──
{
	// A certified activation ledger, an aligned runtime root, and a real executable bin — the
	// only state in which a fallback exists at all.
	const w = world("fallback");
	const home = path.join(w.dir, "home");
	const dataHome = path.join(home, ".local", "share");
	const stateHome = path.join(home, ".local", "state");
	const activeDir = path.join(dataHome, "entwurf", "herdr-plugin", "runtime", "active");
	const binDir2 = path.join(activeDir, "node_modules", ".bin");
	fs.mkdirSync(binDir2, { recursive: true });
	const readerDir = path.join(activeDir, "node_modules", "@junghanacs", "entwurf", "scripts");
	fs.mkdirSync(readerDir, { recursive: true });
	installReader(readerDir);
	const ledgerPath = writeLedgerAt({ HOME: home, XDG_STATE_HOME: stateHome }, ledgerBody(activeDir));
	// The runtime's own `entwurf` bin, answering peer-facts exactly as the PATH stub would.
	const payloadFile = path.join(w.dir, "runtime-entwurf.payload");
	fs.writeFileSync(payloadFile, PEERS);
	const runtimeBin = path.join(binDir2, "entwurf");
	fs.writeFileSync(
		runtimeBin,
		`#!/bin/sh\nprintf '%s %s\\n' "runtime-entwurf" "$*" >> "${w.callLog}"\nprintf '%s' ${shq(PEERS)}\n`,
	);
	fs.chmodSync(runtimeBin, 0o755);
	stubHerdr(w, { agents: agentList([{ pane_id: "w1:p3", agent_status: "working" }]) });

	// PATH carries the herdr stub and NO entwurf: exactly the state a correct plugin install
	// leaves behind (README: the plugin puts nothing on PATH).
	const r = run(w, { PATH: w.binDir, HOME: home, XDG_DATA_HOME: dataHome, XDG_STATE_HOME: stateHome });
	assert.ok(
		r.status === 0 &&
			r.stdout.includes("20260915T111111-aaaaaa") &&
			r.stdout.includes("(via activation-ledger)") &&
			r.calls.some((c) => c.startsWith("runtime-entwurf peer-facts")),
		`[QK:HPL-LEDGER-FALLBACK-READS-CITIZENS] with nothing named entwurf on PATH and no ENTWURF_BIN, a CERTIFIED, root-aligned ledger whose runtime bin is executable lets the citizen axis be read from that bin — this is the state a correct plugin install actually leaves a clean host in, and before it the very first open closed itself with entwurf-not-found (status ${r.status}, calls ${JSON.stringify(r.calls)})`,
	);
	console.log("  ok    a certified, aligned ledger supplies the runtime bin when PATH has none");
	passed++;

	// The fallback WRITES NOTHING and rewrites nothing: still a read-only surface.
	assert.ok(
		fs.readdirSync(r.stateDir).length === 0 &&
			fs.readdirSync(r.configDir).length === 0 &&
			fs.readFileSync(ledgerPath, "utf8").includes('"phase": "active"'),
		"[QK:HPL-FALLBACK-READ-ONLY] taking the ledger fallback writes nothing — the plugin state and config dirs stay empty and the ledger is untouched; a pane that repaired what it read would be installing, which is not a plugin's business (AGENTS.md Hard Rule 17)",
	);
	console.log("  ok    the ledger fallback writes nothing and repairs nothing");
	passed++;

	// PRECEDENCE: an operator override wins outright, and the ledger never shadows it.
	const overrideBin = path.join(w.binDir, "my-entwurf");
	fs.writeFileSync(
		overrideBin,
		`#!/bin/sh\nprintf '%s %s\\n' "override-entwurf" "$*" >> "${w.callLog}"\nprintf '%s' ${shq(PEERS)}\n`,
	);
	fs.chmodSync(overrideBin, 0o755);
	fs.writeFileSync(w.callLog, "");
	const r2 = run(w, {
		PATH: w.binDir,
		HOME: home,
		XDG_DATA_HOME: dataHome,
		XDG_STATE_HOME: stateHome,
		ENTWURF_BIN: overrideBin,
	});
	assert.ok(
		r2.status === 0 &&
			r2.calls.some((c) => c.startsWith("override-entwurf peer-facts")) &&
			!r2.calls.some((c) => c.startsWith("runtime-entwurf")) &&
			r2.stdout.includes("(via ENTWURF_BIN)"),
		`[QK:HPL-OVERRIDE-BEATS-LEDGER] ENTWURF_BIN wins outright even when a certified ledger is sitting right there, and the ledger's bin is never spawned — an operator override is the operator speaking, and a receipt must not out-vote it (calls ${JSON.stringify(r2.calls)})`,
	);
	console.log("  ok    ENTWURF_BIN beats a certified ledger, which is never spawned");
	passed++;
}

// ── #116 A4: every activation-evidence state has its own name, and absence is not red ──
{
	const cases: {
		label: string;
		mutate: (dirs: { dataHome: string; activeDir: string; ledgerPath: string }) => void;
		code: string;
		red: boolean;
	}[] = [
		{
			label: "ledger present, installed reader absent",
			mutate: ({ activeDir }) =>
				fs.rmSync(path.join(activeDir, "node_modules", "@junghanacs"), { recursive: true, force: true }),
			code: "activation-reader-unavailable",
			red: true,
		},
		{
			label: "ledger body not certifiable",
			mutate: ({ ledgerPath }) => fs.writeFileSync(ledgerPath, '{"schemaVersion":1}\n'),
			code: "activation-ledger-uncertified",
			red: true,
		},
		{
			label: "certified ledger describing another root",
			mutate: ({ ledgerPath }) => {
				const l = JSON.parse(fs.readFileSync(ledgerPath, "utf8")) as { runtimeRoot: string };
				l.runtimeRoot = "/somewhere/else/active";
				fs.writeFileSync(ledgerPath, `${JSON.stringify(l, null, 2)}\n`);
			},
			code: "activation-runtime-root-mismatch",
			red: true,
		},
		{
			label: "certified and aligned, runtime bin gone",
			mutate: ({ activeDir }) => fs.rmSync(path.join(activeDir, "node_modules", ".bin", "entwurf"), { force: true }),
			code: "runtime-bin-missing",
			red: true,
		},
	];
	const verdicts = cases.map((c) => {
		const w = world("evidence");
		const home = path.join(w.dir, "home");
		const dataHome = path.join(home, ".local", "share");
		const stateHome = path.join(home, ".local", "state");
		const activeDir = path.join(dataHome, "entwurf", "herdr-plugin", "runtime", "active");
		const readerDir = path.join(activeDir, "node_modules", "@junghanacs", "entwurf", "scripts");
		fs.mkdirSync(readerDir, { recursive: true });
		fs.mkdirSync(path.join(activeDir, "node_modules", ".bin"), { recursive: true });
		installReader(readerDir);
		const bin = path.join(activeDir, "node_modules", ".bin", "entwurf");
		fs.writeFileSync(bin, `#!/bin/sh\nprintf '%s' ${shq(PEERS)}\n`);
		fs.chmodSync(bin, 0o755);
		const ledgerPath = writeLedgerAt({ HOME: home, XDG_STATE_HOME: stateHome }, ledgerBody(activeDir));
		c.mutate({ dataHome, activeDir, ledgerPath });
		stubHerdr(w, {});
		const r = run(w, { PATH: w.binDir, HOME: home, XDG_DATA_HOME: dataHome, XDG_STATE_HOME: stateHome });
		const activation = r.stdout.slice(r.stdout.indexOf("[2] ENTWURF ACTIVATION"), r.stdout.indexOf("[3] RAILS"));
		return {
			c,
			named: activation.includes(c.code),
			red: (r.status !== 0) === c.red,
			shown: `${c.label}: status=${r.status} block=${JSON.stringify(activation.split("\n")[1] ?? "")}`,
		};
	});
	assert.ok(
		verdicts.every((v) => v.named && v.red),
		`[QK:HPL-ACTIVATION-NAMED-REDS] every way the activation evidence can be broken has its OWN name on screen and its own red — a reader we cannot import, a body the writer's own reader refuses, a receipt describing a different runtime root, and a certified receipt whose bin has since gone. None of them crashes and none silently skips: a pane that went quiet on a receipt it could not read would be reporting the absence of a failure as health (${verdicts.map((v) => v.shown).join(" | ")})`,
	);
	console.log("  ok    the four broken-evidence states are named reds, each in its own voice");
	passed++;
}

// ── #116 A-P1: the remaining activation arms — named, and none of them a crash ──
{
	/** A host with a runtime and its bin — its installed reader and its ledger both optional. */
	function runtimeOnly(
		w: World,
		ledger: Record<string, unknown> | null,
		opts: { withReader?: boolean; readerSource?: string } = {},
	): Record<string, string> {
		const home = path.join(w.dir, "ro-home");
		const dataHome = path.join(home, ".local", "share");
		const stateHome = path.join(home, ".local", "state");
		const activeDir = path.join(dataHome, "entwurf", "herdr-plugin", "runtime", "active");
		const readerDir = path.join(activeDir, "node_modules", "@junghanacs", "entwurf", "scripts");
		fs.mkdirSync(readerDir, { recursive: true });
		fs.mkdirSync(path.join(activeDir, "node_modules", ".bin"), { recursive: true });
		// A CUSTOM installed reader stands for an install whose bytes are not the ones we shipped —
		// the two shapes below are measured API answers, not inventions: a module that loads without
		// the export this leaf calls, and the `null` the real reader returns for a ledger that is
		// gone (herdr-activation.mjs:159-162).
		if (opts.readerSource !== undefined) {
			fs.mkdirSync(readerDir, { recursive: true });
			fs.writeFileSync(path.join(readerDir, "herdr-activation.mjs"), opts.readerSource);
		} else if (opts.withReader !== false) installReader(readerDir);
		const bin = path.join(activeDir, "node_modules", ".bin", "entwurf");
		fs.writeFileSync(bin, `#!/bin/sh\nprintf '%s %s\\n' "entwurf" "$*" >> "${w.callLog}"\nprintf '%s' ${shq(PEERS)}\n`);
		fs.chmodSync(bin, 0o755);
		if (ledger !== null) writeLedgerAt({ HOME: home, XDG_STATE_HOME: stateHome }, ledger);
		return { HOME: home, XDG_DATA_HOME: dataHome, XDG_STATE_HOME: stateHome, ACTIVE_DIR: activeDir };
	}
	const blockOf = (stdout: string, open: string, close: string): string =>
		stdout.slice(stdout.indexOf(open), stdout.indexOf(close));

	// (1) A RUNTIME STANDS THERE AND NO LEDGER DESCRIBES IT. `readCertifiedLedger` answers a
	// missing file with `null` (herdr-activation.mjs:159-162), and the candidate dereferenced that
	// null — so a partial install, a finished teardown, or a ledger removed between the check and
	// the read all closed the pane with a stack trace and no blocks at all. The whole pane still
	// has to render; only this receipt is missing, and it says so by name.
	{
		const w = world("no-ledger");
		const { ACTIVE_DIR, ...env } = runtimeOnly(w, null);
		stubHerdr(w, {});
		const r = run(w, { PATH: w.binDir, ...env });
		const activation = blockOf(r.stdout, "[2] ENTWURF ACTIVATION", "[3] RAILS");
		const citizens = r.stdout.slice(r.stdout.indexOf("[4] CITIZENS"));
		// AND THE SAME HOST WITH NO READER EITHER. Knowing that no receipt exists takes no reader:
		// the ledger's address is a pure function of the environment. Deciding this one only AFTER
		// locating the installed reader would report a broken install on a host whose only real
		// fact is that nothing ever wrote a ledger here.
		const w2 = world("no-ledger-no-reader");
		const { ACTIVE_DIR: _unusedRoot, ...env2 } = runtimeOnly(w2, null, { withReader: false });
		stubHerdr(w2, {});
		const r2 = run(w2, { PATH: w2.binDir, ...env2 });
		const activation2 = blockOf(r2.stdout, "[2] ENTWURF ACTIVATION", "[3] RAILS");
		assert.ok(
			r2.status !== 0 &&
				activation2.includes("activation-ledger-missing") &&
				!activation2.includes("activation-reader-unavailable") &&
				r.status !== 0 &&
				activation.includes("activation-ledger-missing") &&
				/\[1\] HERDR INTEGRATION/.test(r.stdout) &&
				/\[3\] RAILS/.test(r.stdout) &&
				citizens.includes("entwurf-not-found") &&
				citizens.includes("activation-ledger-missing") &&
				!r.calls.some((c) => c.startsWith("entwurf ")),
			`[QK:HPL-LEDGER-MISSING-IS-NAMED] a runtime with no ledger behind it is a NAMED red (\`activation-ledger-missing\`) that still draws all four blocks — the reader answers a missing ledger with \`null\`, and dereferencing that null crashed the pane before any block was written, which is the one failure a status surface cannot report about itself. The citizen skip names the same code rather than claiming there was simply no runtime, and the runtime's own bin is never spawned on a receipt we do not have. The same answer holds with no installed reader present: no reader is needed to know that nothing wrote a receipt here, and filing that as a broken install would name the wrong repair (status ${r.status}/${r2.status}, blocks ${JSON.stringify([activation.split("\n")[1], activation2.split("\n")[1]])})`,
		);
		console.log("  ok    a runtime with no ledger is a named red, with four blocks and no crash");
		passed++;
	}

	// (1b) THE IMPORT SUCCEEDS AND THE READER IS NOT THERE. A module can load perfectly and carry
	// none of the export this leaf calls — a partial or mismatched install. Without an explicit
	// check that is a TypeError raised inside the CERTIFICATION try, and it lands as "the writer's
	// own reader refused this body" when no body was ever read: the operator is sent to inspect a
	// ledger that is fine, instead of to the install that is not.
	{
		const w = world("reader-export");
		const { ACTIVE_DIR, ...env } = runtimeOnly(w, ledgerBody(""), {
			readerSource: "export const NOT_THE_READER = 1;\n",
		});
		stubHerdr(w, {});
		const r = run(w, { PATH: w.binDir, ...env });
		const activation = blockOf(r.stdout, "[2] ENTWURF ACTIVATION", "[3] RAILS");
		assert.ok(
			r.status !== 0 &&
				activation.includes("activation-reader-unavailable") &&
				!activation.includes("activation-ledger-uncertified") &&
				/\[4\] CITIZENS/.test(r.stdout) &&
				!r.calls.some((c) => c.startsWith("entwurf ")),
			`[QK:HPL-READER-EXPORT-IS-REQUIRED] an installed reader that imports but exports no \`readCertifiedLedger\` is \`activation-reader-unavailable\`, never \`activation-ledger-uncertified\` — the second name says the writer's own reader looked at this body and refused it, and here no body was read at all. The two names carry two different repairs (reinstall the runtime vs inspect the ledger), and the TypeError this would otherwise raise lands inside the certification try where it would wear the wrong one (status ${r.status}, block ${JSON.stringify(activation.split("\n").slice(0, 2).join(" / "))})`,
		);
		console.log("  ok    a reader that imports without its export is reader-unavailable, not uncertified");
		passed++;
	}

	// (1c) THE LEDGER WAS THERE AND IS NOT ANY MORE. The presence check and the read are two
	// syscalls with a gap between them, and the writer's reader answers that gap with `null`
	// (herdr-activation.mjs:159-162). The EARLY branch above never sees this one — it already
	// decided while the file was there — so the late guard is the only thing standing between that
	// null and a dereference. The fixture reader returns exactly the answer the real one returns.
	{
		const w = world("ledger-vanished");
		const { ACTIVE_DIR, ...env } = runtimeOnly(w, ledgerBody(""), {
			readerSource: "export function readCertifiedLedger() {\n\treturn null;\n}\n",
		});
		stubHerdr(w, {});
		const r = run(w, { PATH: w.binDir, ...env });
		const activation = blockOf(r.stdout, "[2] ENTWURF ACTIVATION", "[3] RAILS");
		const citizens = r.stdout.slice(r.stdout.indexOf("[4] CITIZENS"));
		assert.ok(
			r.status !== 0 &&
				activation.includes("activation-ledger-missing") &&
				/\[1\] HERDR INTEGRATION/.test(r.stdout) &&
				/\[3\] RAILS/.test(r.stdout) &&
				citizens.includes("entwurf-not-found") &&
				!r.calls.some((c) => c.startsWith("entwurf ")),
			`[QK:HPL-LEDGER-VANISHED-IS-NAMED] a ledger that passed the presence check and is gone by the time the installed reader reads it comes back as \`null\`, and that null is NAMED \`activation-ledger-missing\` with all four blocks still drawn — not dereferenced. The early branch cannot cover this: it already answered while the file existed, so removing this guard puts a TypeError between a race nobody controls and the operator's only view of the host (status ${r.status}, block ${JSON.stringify(activation.split("\n").slice(0, 2).join(" / "))})`,
		);
		console.log("  ok    a ledger that vanishes after the presence check is named, not dereferenced");
		passed++;
	}

	// (2) NO XDG ROOTS AT ALL. Both resolvers throw a named error when there is no user root to
	// own; the candidate called them outside any guard, so the pane exited on an unhandled
	// rejection. An environment this surface cannot resolve is still something it must be able to
	// SAY, and blocks 1, 3 and 4 do not need a ledger root to answer.
	{
		const w = world("no-root");
		stubHerdr(w, {});
		const r = run(w, { PATH: w.binDir, HOME: undefined, XDG_DATA_HOME: undefined, XDG_STATE_HOME: undefined });
		const activation = blockOf(r.stdout, "[2] ENTWURF ACTIVATION", "[3] RAILS");
		assert.ok(
			r.status !== 0 &&
				activation.includes("activation-env-root-unresolvable") &&
				/\[1\] HERDR INTEGRATION/.test(r.stdout) &&
				/\[3\] RAILS/.test(r.stdout) &&
				/\[4\] CITIZENS/.test(r.stdout),
			`[QK:HPL-ENV-ROOT-IS-NAMED] with no HOME and none of the XDG roots the two layouts need, the activation block reports \`activation-env-root-unresolvable\` and the other three blocks still render — the layout resolvers throw by design — each root they need must be resolvable on its own once HOME is gone — and a gatherer that lets that throw past its caller turns "I cannot tell where your ledger would live" into a pane that prints nothing at all (status ${r.status}, stdout ${JSON.stringify(r.stdout.slice(0, 120))})`,
		);
		console.log("  ok    unresolvable XDG roots are a named red, not an unhandled rejection");
		passed++;
	}

	// (3) A CERTIFIED LEDGER MID-TEARDOWN IS A RECEIPT, NOT AN AUTHORITY. `deactivating` (and
	// `activating`, a transaction that never checkpointed) are legitimate certified states, so the
	// block reports them; what they are not is evidence that a runtime is standing there ready to
	// answer. Install-time wiring and runtime-live are two different questions and this is the
	// seam where merging them would start.
	{
		const drivePhase = (phase: string, state: string) => {
			const w = world(`phase-${phase}`);
			const { ACTIVE_DIR, ...env } = runtimeOnly(w, {
				schemaVersion: 2,
				phase,
				runtimeRoot: "",
				artifactIdentity: READY_NPM_IDENTITY,
				piAgentDir: { path: "/p", source: "default" },
				claudeConfigDir: { path: "/c", source: "default" },
				claudeUserConfig: { path: "/c/u", source: "HOME" },
				activatedBackends: ["pi"],
				components: [{ backend: "pi", state }],
			});
			// The root the ledger describes is this host's own, so nothing here is a mismatch —
			// the phase is the only thing standing between the receipt and the fallback.
			const ledgerFile = ACTIVATION.resolveActivationLayout(env).ledgerPath as string;
			const body = JSON.parse(fs.readFileSync(ledgerFile, "utf8")) as { runtimeRoot: string };
			body.runtimeRoot = ACTIVE_DIR;
			fs.writeFileSync(ledgerFile, `${JSON.stringify(body, null, 2)}\n`);
			stubHerdr(w, {});
			const r = run(w, { PATH: w.binDir, ...env });
			return {
				phase,
				status: r.status,
				activation: blockOf(r.stdout, "[2] ENTWURF ACTIVATION", "[3] RAILS"),
				citizens: r.stdout.slice(r.stdout.indexOf("[4] CITIZENS")),
				calls: r.calls,
			};
		};
		// BOTH non-active phases, because the claim names both: `activating` is a transaction that
		// never checkpointed, `deactivating` is a teardown in flight. `PHASE_ALLOWS` admits a
		// different component state under each, so each drive carries its own.
		const drives = [drivePhase("deactivating", "removed"), drivePhase("activating", "pending")];
		assert.ok(
			drives.every(
				(d) =>
					d.status === 0 &&
					d.activation.includes(`phase: ${d.phase}`) &&
					d.activation.includes("activation-phase-not-active") &&
					d.citizens.includes("activation-phase-not-active") &&
					!d.calls.some((c) => c.startsWith("entwurf ")),
			),
			`[QK:HPL-PHASE-GATES-FALLBACK] only a ledger in phase \`active\` grants the D3=C runtime fallback: an \`activating\` or \`deactivating\` ledger is still a certified install-time receipt and is reported as one (exit 0, not a red), but its runtime bin is never spawned and the citizen skip names \`activation-phase-not-active\` instead of implying this host simply never activated. A receipt written while a teardown was in progress is not evidence that anything is standing there now (${drives.map((d) => `${d.phase}: status=${d.status} calls=${JSON.stringify(d.calls)}`).join(" | ")})`,
		);
		console.log("  ok    only an `active` ledger grants the fallback; a teardown receipt is reported, not spent");
		passed++;
	}
}

// ── #116 A-P1: block [1] owns its own failure, and a failure is not prose ──
{
	// `buildActivationProfile` CLASSIFIES: `outdated` and `needs-repair` go to `profile.fail` and
	// the build runner refuses them, so "herdr's integration is not current here" is a verdict this
	// plugin already reached — not a row an operator has to notice. "No aggregate green" means the
	// four axes keep their OWN receipts; it does not mean an axis that failed leaves at zero.
	// `not-installed` is the other side of that line and stays a reported skip: nothing is wrong
	// with a host that has simply not integrated a harness.
	const drive = (integration: string) => {
		const w = world("integration-verdict");
		const env = activateHost(w);
		stubHerdr(w, { integration });
		const r = run(w, env);
		return {
			status: r.status,
			block: r.stdout.slice(r.stdout.indexOf("[1] HERDR INTEGRATION"), r.stdout.indexOf("[2] ENTWURF ACTIVATION")),
			stdout: r.stdout,
		};
	};
	const failing = drive(["pi: outdated (v7 < v8) (/h/pi)", "claude: needs repair (v8) (/h/c)", ""].join("\n"));
	const skipping = drive(["pi: current (v8) (/h/pi)", "claude: not installed (/h/c)", ""].join("\n"));
	assert.ok(
		failing.status !== 0 &&
			failing.block.includes("herdr-integration-not-current") &&
			failing.block.includes("outdated — herdr-integration-outdated") &&
			failing.block.includes("needs-repair — herdr-integration-needs-repair") &&
			/\[2\] ENTWURF ACTIVATION/.test(failing.stdout) &&
			/\[3\] RAILS/.test(failing.stdout) &&
			/\[4\] CITIZENS/.test(failing.stdout) &&
			skipping.status === 0 &&
			!skipping.block.includes("herdr-integration-not-current") &&
			skipping.block.includes("not-installed — herdr-integration-not-installed"),
		`[QK:HPL-INTEGRATION-NONCURRENT-IS-RED] a selected atom herdr reports as \`outdated\` or \`needs repair\` makes block [1] a NAMED error (\`herdr-integration-not-current\`) and the pane leave non-zero, while every row and every other block still renders — the profile leaf already files both into \`profile.fail\` and the build runner already refuses them, so rendering that as a \`reported\` block was this surface disagreeing with its own classifier. \`not-installed\` stays a reported skip at exit 0, because a harness nobody integrated is not a fault (failing: status=${failing.status} ${JSON.stringify(failing.block.split("\n").slice(0, 3).join(" / "))} | not-installed: status=${skipping.status})`,
	);
	console.log("  ok    an outdated/needs-repair atom makes block [1] a named red; not-installed stays a skip");
	passed++;
}

console.log(`\ncheck-herdr-plugin: ${passed} assertions passed`);
