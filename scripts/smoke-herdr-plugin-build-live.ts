/**
 * smoke-herdr-plugin-build-live — the #116 M3-b3 journey a real Herdr user performs, with a REAL
 * `herdr plugin install` driving our REAL `[[build]]` and a REAL `npm pack` of the product git spec.
 *
 * OUT of `pnpm check`. Needs `LIVE=1`, a `herdr` binary, `git`, `npm` — and the NETWORK, because a
 * git-spec pack builds the bridge through `prepare`, which installs devDependencies from the
 * registry. That is the axis `check-herdr-plugin-build` cannot have and why it does not claim it.
 *
 * WHAT MAKES IT HERMETIC ANYWAY. Two substitutions, and only two. HOME/XDG are a mkdtemp sandbox,
 * so Herdr's registry, its managed checkout, our runtime, our ledger and both harnesses' wiring all
 * land inside it. And the FIXED product remote — `https://github.com/junghan0611/entwurf.git`, which
 * neither this smoke nor any caller can change — is redirected through git's own `insteadOf`, in the
 * sandbox `.gitconfig`, to a bare clone of a CANDIDATE SNAPSHOT built inside the sandbox (see the
 * block below: a bare clone of the worktree would carry only the last commit, which is how this
 * fixture first passed while testing the wrong bytes). So the argv under test is byte-for-byte the
 * product argv; what differs is where git looks, which is the one substitution that keeps an
 * unpushed candidate testable. This repo's HEAD, its porcelain status and the operator's own herdr
 * registry are all read before and after and must be identical.
 *
 * WHAT IS REAL VENDOR EVIDENCE HERE. If `claude` is on PATH, the Claude activation runs the vendor
 * CLI for real against the sandbox HOME — which is the named LIVE boundary the deterministic gates
 * refuse to claim: whether Claude Code accepts an ABSOLUTE executable as an MCP command. A host
 * without `claude` reports that cell as a named skip inside an otherwise green run, never a pass.
 *
 * THE FOUR CELLS, AND THEY ARE NOT ALL THE SAME KIND OF EVIDENCE:
 *
 * | cell | what drives it | what it is evidence of |
 * |---|---|---|
 * | 1. remote-commit AVAILABLE | real `herdr plugin install` | the Herdr journey: one install, runtime at the stable root keyed by the commit Herdr resolved, Pi wired at the absolute bridge, ledger `active` |
 * | 2. REINSTALL widening | real `herdr plugin install` | the Herdr journey: Pi reconciled JSON-identical, Claude added as exactly ONE counted owner entry (real vendor CLI), OpenCode given zero Entwurf state |
 * | 3. remote-commit UNAVAILABLE | the shipped runtime leaf, called directly with the FIXED product argv | acquisition-leaf evidence only — a remote that cannot serve a commit. Routing it through Herdr would add a second explanation for one red, so it does not, and it does not call itself a journey |
 * | 4. POST-BUILD GAP | real `herdr plugin install` | the Herdr journey: a build that mutates the manifest makes HERDR's own commit fail after our runner already succeeded, so Herdr keeps the previous registration while the runtime and the rebound activation REMAIN, and the next normal install re-binds to HEAD. Nothing here calls that atomic |
 */

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { skipLive } from "./lib/live-skip.ts";
import { treeDigest } from "./lib/tree-digest.ts";

const LABEL = "smoke-herdr-plugin-build-live";
const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const PACKAGE = "@junghanacs/entwurf";
const PRODUCT_REMOTE = "https://github.com/junghan0611/entwurf.git";
const PLUGIN_SPEC = "junghan0611/entwurf/plugins/herdr";
const PLUGIN_ID = "junghan0611.entwurf";

let passed = 0;
let skipped = 0;
function ok(label: string, cond: boolean): void {
	assert.ok(cond, label);
	console.log(`  ok    ${label}`);
	passed++;
}
function skip(label: string, why: string): void {
	console.log(`  skip  ${label} — ${why}`);
	skipped++;
}

function run(bin: string, argv: string[], env: NodeJS.ProcessEnv, cwd = REPO) {
	return spawnSync(bin, argv, { encoding: "utf8", env, cwd, timeout: 900_000 });
}

if (process.env.LIVE !== "1") {
	skipLive(
		LABEL,
		"LIVE=1 not set — this smoke runs a real `herdr plugin install` and a real npm pack over the network",
	);
}
for (const bin of ["herdr", "git", "npm"]) {
	const probe = spawnSync(bin, ["--version"], { encoding: "utf8" });
	if (probe.error || probe.status !== 0) skipLive(LABEL, `\`${bin}\` is not usable on this host`);
}

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "entwurf-hpbl-"));
const HOME = path.join(ROOT, "home");
const MIRROR = path.join(ROOT, "entwurf.git");
for (const d of ["config", "data", "state", "cache", ".pi", ".claude", ".config/opencode"]) {
	fs.mkdirSync(path.join(HOME, d), { recursive: true });
}
const env: NodeJS.ProcessEnv = {
	PATH: process.env.PATH,
	TERM: "dumb",
	HOME,
	XDG_CONFIG_HOME: path.join(HOME, "config"),
	XDG_DATA_HOME: path.join(HOME, "data"),
	XDG_STATE_HOME: path.join(HOME, "state"),
	XDG_CACHE_HOME: path.join(HOME, "cache"),
	PI_CODING_AGENT_DIR: path.join(HOME, ".pi", "agent"),
	CLAUDE_CONFIG_DIR: path.join(HOME, ".claude"),
	GIT_CONFIG_GLOBAL: path.join(HOME, ".gitconfig"),
};
fs.mkdirSync(env.PI_CODING_AGENT_DIR as string, { recursive: true });
fs.writeFileSync(path.join(env.PI_CODING_AGENT_DIR as string, "settings.json"), '{"theme":"dark"}\n');

// ── COMMITS RUN UNDER THE OPERATOR'S OWN GIT CONFIG, HOOKS INCLUDED ────────────────────────
//
// The sandbox `GIT_CONFIG_GLOBAL` above is what keeps herdr's clones and our `insteadOf` out of the
// operator's config — but handing it to a `git commit` HIDES their global
// `core.hooksPath`, which is the safety rail that scans staged diffs for identity terms and
// secrets. A fixture that commits without it has bypassed that rail by omission, which is worse
// than bypassing it on purpose: nothing says so. So the two commits below run under the process's
// NORMAL environment — no sandbox config, no `--no-verify`, no `AGENT_ALLOW_UNSAFE_COMMIT`, and no
// argv or env that sets, clears or redirects `core.hooksPath`. The only `-c` overrides are the
// repo-local author identity, because a temp clone has no reason to inherit one.
const COMMIT_ENV: NodeJS.ProcessEnv = { ...process.env };
const configuredHooksPath = (
	spawnSync("git", ["config", "--global", "--get", "core.hooksPath"], { encoding: "utf8", env: COMMIT_ENV }).stdout ??
	""
).trim();

/**
 * One ordinary commit, with its hook invocation OBSERVED rather than steered: `GIT_TRACE2_EVENT`
 * writes git's own child-process events to a sandbox file, and the assertion reads that file for a
 * `pre-commit` child under the configured hooks path. Trace is read-only — it cannot change which
 * hook git chooses — so this proves the rail ran instead of asserting that we did not disable it.
 */
function commitInClone(dir: string, message: string, tag: string): { hookTrace: string; traceFile: string } {
	const traceFile = path.join(ROOT, `git-trace-${tag}.json`);
	const committed = spawnSync(
		"git",
		[
			"-C",
			dir,
			"-c",
			"user.email=candidate@sandbox.local",
			"-c",
			"user.name=candidate snapshot",
			"commit",
			"--quiet",
			"-a",
			"-m",
			message,
		],
		{ encoding: "utf8", env: { ...COMMIT_ENV, GIT_TRACE2_EVENT: traceFile } },
	);
	assert.equal(committed.status, 0, `${tag} commit failed: ${committed.stderr || committed.stdout}`);
	const trace = fs.existsSync(traceFile) ? fs.readFileSync(traceFile, "utf8") : "";
	const hookLines = trace.split("\n").filter((line) => line.includes('"pre-commit"') && line.includes('"child_start"'));
	if (configuredHooksPath === "") {
		console.log(`  info  ${tag}: no global core.hooksPath on this host — portable behaviour, no hook receipt to read`);
		return { hookTrace: "no-configured-hook-path", traceFile };
	}
	// EXACTLY ONE. `> 0` would also pass a commit that ran the rail twice, and two invocations mean
	// one of them is reading a state the other already changed — the count is part of the claim, so
	// it is asserted rather than reported.
	const underConfigured = hookLines.filter((line) => line.includes(configuredHooksPath));
	assert.equal(
		underConfigured.length,
		1,
		`${tag}: expected EXACTLY ONE pre-commit child under the configured hook path ${configuredHooksPath}, observed ` +
			`${underConfigured.length} (pre-commit child_start lines in ${traceFile}: ${hookLines.length})`,
	);
	return {
		hookTrace: `exactly ${underConfigured.length} pre-commit child under ${configuredHooksPath}`,
		traceFile,
	};
}

/** A clone that a commit has just finished with: nothing staged, nothing modified, nothing untracked. */
function assertExactlyClean(dir: string, tag: string): void {
	const porcelain = (
		spawnSync("git", ["-C", dir, "status", "--porcelain"], { encoding: "utf8", env }).stdout ?? ""
	).trim();
	const diff = spawnSync("git", ["-C", dir, "diff", "--binary", "HEAD"], { encoding: "utf8", env }).stdout ?? "";
	assert.equal(
		porcelain,
		"",
		`${tag} is not clean after its commit — a hook or the commit itself left changes: ${porcelain}`,
	);
	assert.equal(
		diff.length,
		0,
		`${tag} still differs from its own HEAD after committing (${diff.length} bytes of diff)`,
	);
}

// ── THE CANDIDATE HAS TO BE IN THE MIRROR, AND A BARE CLONE DOES NOT PUT IT THERE ──────────
//
// Measured on this smoke's first run: `git clone --bare <repo>` copies COMMITS, so a frozen
// uncommitted candidate — 22 modified files and 5 new ones sitting in the operator's index and
// worktree — never reached Herdr at all. `herdr plugin install` reported status 0 while installing
// the PREVIOUS commit, whose manifest has no `[[build]]`, and every candidate assertion below was
// absent rather than wrong. A fixture that quietly tests the wrong bytes is worse than a red.
//
// So: clone the operator repo into the sandbox, replay its `git diff --binary HEAD` (the exact
// index+worktree bytes) into that clone, and commit it there with an ORDINARY commit under the
// sandbox `GIT_CONFIG_GLOBAL` — no `--no-verify`, no hook path games. The bare MIRROR is then a
// clone of THAT snapshot. Post-commit (an empty diff) the same code runs with no snapshot commit at
// all, which is the shape this will have once the candidate lands.
//
// UNTRACKED FILES ARE A HARD FAILURE, not a silent omission: `git diff HEAD` cannot see them, so a
// candidate byte living only in an untracked file would be dropped exactly the way the whole
// candidate just was.
const operatorStatusBefore = (run("git", ["status", "--porcelain"], env).stdout ?? "").trim();
const operatorHeadBefore = (run("git", ["rev-parse", "HEAD"], env).stdout ?? "").trim();
const untracked = operatorStatusBefore.split("\n").filter((line) => line.startsWith("??"));
assert.equal(
	untracked.length,
	0,
	`the candidate carries untracked files, which \`git diff HEAD\` cannot capture — stage them (git add -N) ` +
		`so this fixture tests the candidate and not the last commit: ${untracked.join(", ")}`,
);
const SNAPSHOT = path.join(ROOT, "snapshot");
assert.equal(run("git", ["clone", "--quiet", REPO, SNAPSHOT], env).status, 0, "candidate clone failed");
const candidatePatch = run("git", ["diff", "--binary", "HEAD"], env).stdout ?? "";
let snapshotKind = "operator HEAD (no uncommitted candidate)";
let snapshotHook = "no snapshot commit was needed";
if (candidatePatch.trim().length > 0) {
	const patchFile = path.join(ROOT, "candidate.patch");
	fs.writeFileSync(patchFile, candidatePatch);
	const applied = run("git", ["-C", SNAPSHOT, "apply", "--index", patchFile], env);
	assert.equal(applied.status, 0, `the candidate patch did not apply to the snapshot clone: ${applied.stderr}`);
	snapshotHook = commitInClone(SNAPSHOT, "candidate snapshot under test", "snapshot").hookTrace;
	// LOAD-BEARING, before the mirror is made from it: if a hook rewrote a file, or the patch left
	// anything behind, the mirror would carry bytes the candidate does not have.
	assertExactlyClean(SNAPSHOT, "the candidate snapshot clone");
	snapshotKind = "snapshot commit of the frozen candidate";
}

// The ONE substitution: the fixed product remote resolves to a bare clone of that snapshot.
const mirrorClone = run("git", ["clone", "--bare", "--quiet", SNAPSHOT, MIRROR], env);
assert.equal(mirrorClone.status, 0, `bare clone failed: ${mirrorClone.stderr}`);
fs.writeFileSync(
	path.join(HOME, ".gitconfig"),
	[`[url "file://${MIRROR}"]`, `\tinsteadOf = ${PRODUCT_REMOTE}`, "[safe]", "\tdirectory = *", ""].join("\n"),
);
// HEAD/BRANCH come from what the MIRROR actually serves, never from the operator repo: the whole
// failure above was the gap between those two.
const HEAD = (run("git", ["-C", SNAPSHOT, "rev-parse", "HEAD"], env).stdout ?? "").trim();
const BRANCH = (run("git", ["-C", SNAPSHOT, "rev-parse", "--abbrev-ref", "HEAD"], env).stdout ?? "").trim();
const mirrorCommit = (run("git", ["--git-dir", MIRROR, "rev-parse", BRANCH], env).stdout ?? "").trim();
assert.equal(mirrorCommit, HEAD, `the mirror serves ${mirrorCommit} for ${BRANCH}, not the candidate ${HEAD}`);
console.log(
	`  info  candidate under test: ${HEAD.slice(0, 12)} on ${BRANCH} — ${snapshotKind}; safety hooks: ${snapshotHook}`,
);

const operatorBefore = spawnSync("herdr", ["plugin", "list"], { encoding: "utf8" }).stdout ?? "";

const activeDir = path.join(env.XDG_DATA_HOME as string, "entwurf", "herdr-plugin", "runtime", "active");
const journalPath = path.join(env.XDG_DATA_HOME as string, "entwurf", "herdr-plugin", "journal.json");
const ledgerPath = path.join(env.XDG_STATE_HOME as string, "entwurf", "herdr-plugin", "activation.json");
const piSettings = path.join(env.PI_CODING_AGENT_DIR as string, "settings.json");
const opencodeDir = path.join(HOME, ".config", "opencode");
fs.writeFileSync(path.join(opencodeDir, "config.json"), '{"theme":"tokyonight"}\n');
const opencodeBefore = fs.readFileSync(path.join(opencodeDir, "config.json"), "utf8");

function readJson(file: string): Record<string, unknown> {
	return JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, unknown>;
}

function integrationInstall(atom: string) {
	return run("herdr", ["integration", "install", atom], env);
}
function pluginInstall(ref: string) {
	return run("herdr", ["plugin", "install", PLUGIN_SPEC, "--ref", ref, "--yes"], env);
}
function managedCheckout(): string | null {
	const base = path.join(env.XDG_CONFIG_HOME as string, "herdr", "plugins", "github");
	if (!fs.existsSync(base)) return null;
	const entry = fs.readdirSync(base).find((e) => e.startsWith(PLUGIN_ID));
	return entry ? path.join(base, entry) : null;
}

try {
	// ── 1. the remote HAS the commit: one install, {pi} activated ──────────────
	const piIntegration = integrationInstall("pi");
	if (piIntegration.status !== 0) {
		skipLive(
			LABEL,
			`herdr could not admit the pi integration in a sandbox HOME (${(piIntegration.stderr || piIntegration.stdout || "").trim().slice(0, 200)}) — without a selected atom there is no journey to run`,
		);
	}
	const first = pluginInstall(BRANCH);
	const journal = fs.existsSync(journalPath) ? readJson(journalPath) : null;
	const ledger = fs.existsSync(ledgerPath) ? readJson(ledgerPath) : null;
	const identity = (journal?.artifactIdentity ?? {}) as Record<string, string>;
	const checkout = managedCheckout();
	// The managed checkout's git root is asked for rather than guessed: the manifest root is a
	// SUBDIRECTORY of the clone, and a hardcoded `<dir>/checkout` would silently answer nothing.
	const checkoutRoot =
		checkout === null ? "" : (run("git", ["-C", checkout, "rev-parse", "--show-toplevel"], env).stdout ?? "").trim();
	const checkoutHead =
		checkoutRoot === "" ? "" : (run("git", ["-C", checkoutRoot, "rev-parse", "HEAD"], env).stdout ?? "").trim();
	const shallow =
		checkoutRoot === ""
			? "no-checkout"
			: (run("git", ["-C", checkoutRoot, "rev-parse", "--is-shallow-repository"], env).stdout ?? "").trim();
	const piAfterFirst = readJson(piSettings);
	const provider = (piAfterFirst.entwurfProvider ?? {}) as Record<string, unknown>;
	const providerText = JSON.stringify(provider);
	ok(
		`[${LABEL}] REMOTE-COMMIT AVAILABLE: a real \`herdr plugin install\` drove this plugin's own \`[[build]]\`, which ` +
			"packed the FIXED product git spec at the commit Herdr resolved, installed it at the stable runtime root, and " +
			"activated exactly the integrated set — the whole journey a Herdr user gets for one command, with no Entwurf " +
			"clone and no npm release anywhere in it. THREE commits have to be the same one here — what the mirror " +
			"served, what Herdr checked out, and what the runtime records — because this fixture's first failure was " +
			`exactly the gap between them (install=${first.status} mirror=${mirrorCommit.slice(0, 12)} checkout=${checkoutHead.slice(0, 12)} runtime=${identity.commit?.slice(0, 12)} kind=${identity.kind} package=${identity.packageName}@${identity.packageVersion} ledger=${JSON.stringify(ledger?.activatedBackends)} phase=${ledger?.phase} shallow=${shallow} provider-absolute=${providerText.includes(activeDir)})`,
		first.status === 0 &&
			identity.kind === "herdr-checkout" &&
			identity.commit === HEAD &&
			checkoutHead === HEAD &&
			mirrorCommit === HEAD &&
			identity.repository === "junghan0611/entwurf" &&
			identity.packageName === PACKAGE &&
			(ledger?.phase as string) === "active" &&
			JSON.stringify(ledger?.activatedBackends) === JSON.stringify(["pi"]) &&
			(ledger?.runtimeRoot as string) === activeDir &&
			providerText.includes(activeDir),
	);

	// ── 2. the reinstall widens {pi} → {pi, claude-code}, OpenCode untouched ────
	const claudeOnPath = spawnSync("claude", ["--version"], { encoding: "utf8" }).status === 0;
	const claudeIntegration = integrationInstall("claude");
	const opencodeIntegration = integrationInstall("opencode");
	const piBeforeSecond = JSON.stringify(readJson(piSettings));
	const second = pluginInstall(BRANCH);
	const ledger2 = fs.existsSync(ledgerPath) ? readJson(ledgerPath) : null;
	const piAfterSecond = JSON.stringify(readJson(piSettings));
	const opencodeUntouched = fs.readFileSync(path.join(opencodeDir, "config.json"), "utf8") === opencodeBefore;
	const opencodeEntwurfState = fs
		.readdirSync(opencodeDir)
		.filter((e) => e.toLowerCase().includes("entwurf"))
		.concat(JSON.stringify(readJson(path.join(opencodeDir, "config.json"))).includes("entwurf") ? ["config"] : []);
	if (!claudeOnPath) {
		skip(
			`[${LABEL}] REINSTALL WIDENING`,
			"no `claude` on PATH, so the vendor half of this cell cannot run; the Pi/OpenCode halves are proven by " +
				"check-herdr-activation and a partial pass here would read as vendor evidence",
		);
	} else {
		// EXACTLY ONE OWNER ENTRY, counted. A substring search would pass on a config that carried the
		// command twice, or carried it under a key nobody reads — neither is "wired exactly once".
		const claudeConfig = path.join(HOME, ".claude.json");
		const claudeCfg = fs.existsSync(claudeConfig) ? readJson(claudeConfig) : {};
		const servers = (claudeCfg.mcpServers ?? {}) as Record<string, { command?: string }>;
		const bridgeKeys = Object.keys(servers).filter((k) => k.includes("entwurf"));
		const bridgeCommand = bridgeKeys.length === 1 ? (servers[bridgeKeys[0] as string]?.command ?? "") : "";
		ok(
			`[${LABEL}] REINSTALL WIDENING: with Claude Code and OpenCode now integrated, the same install command ` +
				"reconciles Pi with JSON-IDENTICAL settings and adds Claude as EXACTLY ONE counted owner entry whose " +
				"command is the absolute bridge under the stable runtime — accepted by the REAL vendor CLI, which is the " +
				"LIVE boundary no deterministic gate may claim. The entry is counted, not searched for: a substring would " +
				"pass on a config carrying the command twice, or under a key nobody reads. OpenCode, present the whole " +
				`time, is given zero Entwurf state (claude-integration=${claudeIntegration.status} opencode-integration=${opencodeIntegration.status} install=${second.status} ledger=${JSON.stringify(ledger2?.activatedBackends)} pi-identical=${piBeforeSecond === piAfterSecond} entwurf-mcp-keys=${JSON.stringify(bridgeKeys)} command-under-runtime=${bridgeCommand.startsWith(activeDir)} opencode-untouched=${opencodeUntouched} opencode-entwurf=${JSON.stringify(opencodeEntwurfState)})`,
			second.status === 0 &&
				JSON.stringify(ledger2?.activatedBackends) === JSON.stringify(["pi", "claude-code"]) &&
				(ledger2?.phase as string) === "active" &&
				piBeforeSecond === piAfterSecond &&
				bridgeKeys.length === 1 &&
				path.isAbsolute(bridgeCommand) &&
				bridgeCommand.startsWith(activeDir) &&
				opencodeUntouched &&
				opencodeEntwurfState.length === 0,
		);
	}

	// ── 3. ACQUISITION LEAF: the remote does NOT have the commit ───────────────
	//
	// This cell is NOT the Herdr journey. It calls the shipped runtime leaf directly with the FIXED
	// product argv, because the failure it measures is the acquisition's — a remote that cannot serve
	// a commit — and routing it through `herdr plugin install` would add nothing but a second
	// explanation for the same red. Cells 1, 2 and 4 are the real-Herdr journey; this one is
	// acquisition-leaf LIVE evidence, and that distinction is the point of naming it here.
	{
		const runtimeBefore = treeDigest(activeDir);
		const ledgerBefore = fs.readFileSync(ledgerPath, "utf8");
		const piBefore = JSON.stringify(readJson(piSettings));
		const journalBefore = readJson(journalPath) as {
			artifactIdentity: Record<string, string>;
			previousRuntime: Record<string, string> | null;
		};
		const absentCommit = "9".repeat(40);
		const probe = run(
			"node",
			[
				"--input-type=module",
				"-e",
				[
					`const m = await import(${JSON.stringify(path.join(REPO, "scripts", "herdr-runtime.mjs"))});`,
					"try {",
					"  m.bootstrapRuntime({ env: process.env, lock: { source: 'herdr-checkout', repository: 'junghan0611/entwurf' },",
					`    checkoutRoot: ${JSON.stringify(REPO)}, resolveCommit: () => ${JSON.stringify(absentCommit)} });`,
					"  console.log('NO-REFUSAL');",
					"} catch (err) { console.log(err.code); }",
				].join("\n"),
			],
			env,
		);
		const verdict = (probe.stdout || "").trim().split("\n").pop();
		// The HONEST oracle. The journal is NOT byte-identical and must not be claimed as such: the
		// transaction deliberately writes a certified `installing` entry BEFORE acquiring, because that
		// entry is the retry authority and the only thing that makes the staging tree and the cache
		// ours to reclaim. What must be unchanged is everything the failure had no business touching —
		// the active runtime, the activation ledger, the harness wiring — while the journal is left in
		// the recoverable state its own contract describes, and the normal source still installs.
		//
		// MEASURE THE FAILURE BEFORE THE RETRY. The first run of this cell asserted the post-failure
		// facts AFTER running the retry install, so the retry's own (correct) work — a fresh runtime
		// tree and a re-created cache — read as "the failure changed things". Order is the oracle here.
		const afterFailure = {
			runtime: treeDigest(activeDir),
			ledger: fs.readFileSync(ledgerPath, "utf8"),
			pi: JSON.stringify(readJson(piSettings)),
			staging: fs.existsSync(path.join(path.dirname(activeDir), "staging")),
			cache: fs.existsSync(path.join(env.XDG_CACHE_HOME as string, "entwurf", "herdr-plugin", "npm")),
			journal: readJson(journalPath) as {
				phase: string;
				artifactIdentity: Record<string, string>;
				previousRuntime: Record<string, string> | null;
			},
		};
		const journalAfter = afterFailure.journal;
		const retry = pluginInstall(BRANCH);
		const journalRetried = readJson(journalPath) as { phase: string; artifactIdentity: Record<string, string> };
		ok(
			`[${LABEL}] REMOTE-COMMIT UNAVAILABLE (acquisition leaf, not the Herdr journey): the FIXED product argv at a ` +
				"commit the remote does not carry is refused by name and substitutes NOTHING. The active runtime, the " +
				"activation ledger and the Pi wiring are byte-identical; the journal is left as a CERTIFIED `installing` " +
				"entry naming the requested commit with the previous runtime's identity preserved — that is the retry " +
				"authority, not damage — the staging tree and cache are gone, and a normal install afterwards is green. " +
				"This is the branch where a fallback to a registry version would be most tempting and would silently serve " +
				`an artifact nobody asked for (verdict=${verdict} runtime-identical=${runtimeBefore === afterFailure.runtime} ledger-identical=${ledgerBefore === afterFailure.ledger} pi-identical=${piBefore === afterFailure.pi} journal=${journalAfter.phase}/${journalAfter.artifactIdentity.commit?.slice(0, 8)}/prev=${journalAfter.previousRuntime?.commit?.slice(0, 8)} staging=${afterFailure.staging} cache=${afterFailure.cache} retry=${retry.status}/${journalRetried.phase}/${journalRetried.artifactIdentity.commit?.slice(0, 8)})`,
			verdict === "runtime-checkout-source-unavailable" &&
				runtimeBefore === afterFailure.runtime &&
				ledgerBefore === afterFailure.ledger &&
				piBefore === afterFailure.pi &&
				journalAfter.phase === "installing" &&
				journalAfter.artifactIdentity.commit === absentCommit &&
				journalAfter.previousRuntime?.commit === journalBefore.artifactIdentity.commit &&
				!afterFailure.staging &&
				!afterFailure.cache &&
				retry.status === 0 &&
				journalRetried.phase === "runtime-ready" &&
				journalRetried.artifactIdentity.commit === HEAD,
		);
	}

	// ── 4. Herdr's own commit fails AFTER our runner succeeded ─────────────────
	{
		const scratch = path.join(ROOT, "scratch");
		assert.equal(run("git", ["clone", "--quiet", MIRROR, scratch], env).status, 0, "scratch clone");
		assert.equal(run("git", ["-C", scratch, "checkout", "--quiet", "-b", "gapprobe", HEAD], env).status, 0, "branch");
		// A build that MUTATES the manifest: herdr reloads it after the build and aborts the install
		// (measured: `ensure_manifest_unchanged_after_build`). Our runner still ran to completion.
		const runnerPath = path.join(scratch, "plugins", "herdr", "lib", "build.mjs");
		// The mutation has to run BEFORE the runner's process exits, so it is INSERTED INTO the entry
		// block rather than appended after it. Measured on the previous two runs: appended top-level
		// code never executed at all (`process.exit(runBuild(...))` ends the process first), and the
		// earlier `# comment` version of it would not have mattered anyway — herdr compares the PARSED
		// manifest by full struct equality (`ensure_manifest_unchanged_after_build`, read at
		// src/cli/plugin.rs), so only a semantic change makes its commit fail. Rewriting the declared
		// plugin version is exactly that.
		const runnerSource = fs.readFileSync(runnerPath, "utf8");
		const entry = "\t\tprocess.exit(runBuild(process.env));";
		assert.ok(runnerSource.includes(entry), "the runner's entry block is not the shape this probe patches");
		fs.writeFileSync(
			runnerPath,
			runnerSource.replace(
				entry,
				[
					"\t\tconst probeCode = runBuild(process.env);",
					"\t\t// gap probe: herdr re-reads the manifest after the build and aborts its own commit.",
					'\t\tconst probeManifest = path.join(PLUGIN_DIR, "herdr-plugin.toml");',
					"\t\tfs.writeFileSync(",
					"\t\t\tprobeManifest,",
					'\t\t\tfs.readFileSync(probeManifest, "utf8").replace(\'version = "0.1.0"\', \'version = "0.1.1"\'),',
					"\t\t);",
					"\t\tprocess.exit(probeCode);",
				].join("\n"),
			),
		);
		const gapHook = commitInClone(scratch, "gap probe", "gapprobe").hookTrace;
		assertExactlyClean(scratch, "the gap-probe scratch clone");
		assert.equal(run("git", ["-C", scratch, "push", "--quiet", MIRROR, "gapprobe"], env).status, 0, "push probe");
		const gapCommit = (run("git", ["-C", scratch, "rev-parse", "HEAD"], env).stdout ?? "").trim();
		const registryBefore = run("herdr", ["plugin", "list"], env).stdout ?? "";
		const ledgerBefore = readJson(ledgerPath) as {
			artifactIdentity: Record<string, string>;
			activatedBackends: string[];
			components: { backend: string; state: string }[];
		};
		const gapRun = pluginInstall("gapprobe");
		const registryAfter = run("herdr", ["plugin", "list"], env).stdout ?? "";
		// The gap commit is a DIFFERENT artifact, so the ledger cannot be byte-identical here and
		// claiming it would be false: our runner ran to completion, which means it legally rebound the
		// activation to that commit. What Herdr then failed to do is its own registration.
		const ledgerAfterGap = readJson(ledgerPath) as {
			phase: string;
			artifactIdentity: Record<string, string>;
			activatedBackends: string[];
			components: { backend: string; state: string }[];
		};
		const reconcile = pluginInstall(BRANCH);
		const ledgerAfterReconcile = readJson(ledgerPath) as {
			phase: string;
			artifactIdentity: Record<string, string>;
			activatedBackends: string[];
			components: { backend: string; state: string }[];
		};
		const noDuplicates = (l: { components: { backend: string }[] }) =>
			new Set(l.components.map((c) => c.backend)).size === l.components.length;
		ok(
			`[${LABEL}] POST-BUILD GAP: Herdr commits its checkout and registry only AFTER a build, so a build that makes ` +
				"that commit fail leaves Herdr's PREVIOUS registration standing while what our runner already did REMAINS " +
				"— the runtime is the gap commit and the ledger has legally rebound to it, active and retained, because " +
				"Herdr has no cleanup hook to call. The next normal install re-binds to HEAD's identity and reconciles the " +
				"same components rather than duplicating them. The gap is NAMED, not atomic, and this cell asserts the " +
				`actual transition rather than an unchanged-bytes claim that could never be true (gap-commit-hooks=${gapHook} gap-install=${gapRun.status} registry-unchanged=${registryBefore === registryAfter} before=${ledgerBefore.artifactIdentity.commit?.slice(0, 8)} after-gap=${ledgerAfterGap.phase}/${ledgerAfterGap.artifactIdentity.commit?.slice(0, 8)}=${gapCommit.slice(0, 8)} reconcile=${reconcile.status}/${ledgerAfterReconcile.phase}/${ledgerAfterReconcile.artifactIdentity.commit?.slice(0, 8)}=${HEAD.slice(0, 8)} backends=${JSON.stringify(ledgerAfterReconcile.activatedBackends)} no-dupes=${noDuplicates(ledgerAfterGap)}/${noDuplicates(ledgerAfterReconcile)})`,
			gapRun.status !== 0 &&
				registryBefore === registryAfter &&
				ledgerAfterGap.phase === "active" &&
				ledgerAfterGap.artifactIdentity.commit === gapCommit &&
				noDuplicates(ledgerAfterGap) &&
				reconcile.status === 0 &&
				ledgerAfterReconcile.phase === "active" &&
				ledgerAfterReconcile.artifactIdentity.commit === HEAD &&
				JSON.stringify(ledgerAfterReconcile.activatedBackends) === JSON.stringify(ledgerBefore.activatedBackends) &&
				noDuplicates(ledgerAfterReconcile),
		);
	}

	// ── the operator's own herdr surface is untouched ──────────────────────────
	const operatorAfter = spawnSync("herdr", ["plugin", "list"], { encoding: "utf8" }).stdout ?? "";
	const operatorStatusAfter = (run("git", ["status", "--porcelain"], env).stdout ?? "").trim();
	const operatorHeadAfter = (run("git", ["rev-parse", "HEAD"], env).stdout ?? "").trim();
	ok(
		`[${LABEL}] the OPERATOR is untouched: their herdr plugin registry is byte-identical, and so are this repo's HEAD ` +
			"and porcelain status — the candidate snapshot is built by READING this repo's diff and committing it inside " +
			"the sandbox, because a fixture that needed the candidate committed for real would be indistinguishable from " +
			`the product asking for it (registry=${operatorBefore === operatorAfter} head=${operatorHeadBefore === operatorHeadAfter} status=${operatorStatusBefore === operatorStatusAfter})`,
		operatorBefore === operatorAfter &&
			operatorHeadBefore === operatorHeadAfter &&
			operatorStatusBefore === operatorStatusAfter,
	);

	console.log(`\n${LABEL}: ${passed} assertions passed, ${skipped} skipped (sandbox kept at ${ROOT})`);
} catch (err) {
	console.error(`\n${LABEL}: FAILED — sandbox kept for inspection at ${ROOT}`);
	throw err;
}
