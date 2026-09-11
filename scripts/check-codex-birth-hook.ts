/**
 * check-codex-birth-hook — #95 gate: the Codex BIRTH path, proven without Codex.
 *
 * HOW A ROOT INSTALLER IS EXERCISED WITHOUT A ROOT SEAM. `codex-birth-install.sh` has
 * fixed target paths — no `--prefix`, no env override, nothing a gate could redirect —
 * because a production installer whose target can be moved is one whose refusals can be
 * side-stepped. So this gate does not point the installer somewhere safe; it moves
 * `/etc` instead. Everything below runs inside `unshare --map-root-user --mount` with an
 * overlayfs over the REAL `/etc` (lowerdir=/etc, upper in a temp dir) and a tmpfs over
 * `/var/lib`. Inside, euid is 0 and the literal path `/etc/codex/hooks.json` is writable;
 * outside, the host is untouched — asserted after the child exits.
 *
 * That is the same technique the measurement used (`scripts/raw-codex-measure/README.md`
 * S1b-A), for the same reason: `/etc/codex` must never appear on the real host.
 *
 * `/var/lib` gets a tmpfs rather than an overlay because an overlay of it is refused on
 * this host — a live docker overlay is mounted underneath, and overlayfs will not take a
 * lowerdir with one inside. The gate only needs an empty writable `/var/lib`, so tmpfs
 * is the honest choice, not a workaround for a mystery.
 *
 * NO userns -> honest SKIP. `ENTWURF_REQUIRE_USERNS=1` turns that SKIP into a failure,
 * which is how a required CI lane runs it: a lane nobody can prove is not a lane that
 * silently passes.
 */

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
	chmodSync,
	cpSync,
	existsSync,
	lstatSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	statSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { listAllMetaIdentitiesDir, type MetaIdentity } from "../pi-extensions/lib/meta-session.ts";
import { reclaimOnExit } from "./lib/reclaim-on-exit.ts";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SELF = fileURLToPath(import.meta.url);
const SANDBOX_ENV = "ENTWURF_CODEX_BIRTH_SANDBOX";

const HOOKS_FILE = "/etc/codex/hooks.json";
const HELPER_DIR = "/etc/codex/entwurf-birth";
const LAUNCHER = `${HELPER_DIR}/codex-birth-launch.sh`;
const STATE_FILE = "/var/lib/entwurf/codex-birth/install-state.json";
const INSTALL = path.join(REPO, "scripts", "codex-birth-install.sh");
const UNINSTALL = path.join(REPO, "scripts", "codex-birth-uninstall.sh");
const DOCTOR = path.join(REPO, "scripts", "codex-birth-doctor.sh");

// ── the outer half: build the namespace, then assert the host survived it ────
if (process.env[SANDBOX_ENV] !== "1") {
	const probe = spawnSync("unshare", ["--map-root-user", "--mount", "true"], { encoding: "utf8" });
	if (probe.status !== 0) {
		const why = `unprivileged user namespaces are unavailable here (${(probe.stderr || probe.error?.message || "").trim() || `exit ${probe.status}`})`;
		if (process.env.ENTWURF_REQUIRE_USERNS === "1") {
			console.error(`[check-codex-birth-hook] REQUIRED but unrunnable: ${why}`);
			process.exit(1);
		}
		console.log(`[check-codex-birth-hook] SKIP: ${why}. Set ENTWURF_REQUIRE_USERNS=1 to make this a failure.`);
		process.exit(0);
	}
	const scratch = reclaimOnExit(mkdtempSync(path.join(tmpdir(), "entwurf-codex-birth.")));
	for (const d of ["etc-upper", "etc-work"]) mkdirSync(path.join(scratch, d));
	// The host's own /etc/codex must not exist before OR after. Checking before is not
	// pedantry: if it did exist, the overlay's lowerdir would carry it into the sandbox
	// and every "clean host" assertion below would be a lie.
	assert.ok(
		!existsSync("/etc/codex"),
		"/etc/codex exists on this HOST — this gate's clean-host cells would inherit it through the overlay lowerdir. Refusing to run.",
	);
	const inner = [
		`set -e`,
		`mount -t overlay overlay -o lowerdir=/etc,upperdir=${scratch}/etc-upper,workdir=${scratch}/etc-work /etc`,
		`mount -t tmpfs tmpfs /var/lib`,
		`exec "$0" "$@"`,
	].join("\n");
	const run = spawnSync(
		"unshare",
		["--map-root-user", "--mount", "bash", "-c", inner, process.execPath, ...process.execArgv, SELF],
		{ stdio: "inherit", env: { ...process.env, [SANDBOX_ENV]: "1" } },
	);
	// The installer publishes 0555 directories, and the overlay's upperdir keeps those
	// modes as ordinary files owned by THIS uid outside the namespace — so the temp-root
	// teardown (`rmSync`) would hit EACCES on any refusal cell that left one behind.
	// Re-open them here rather than leaving residue under /tmp for the next run to find.
	spawnSync("chmod", ["-R", "u+rwX", scratch]);
	// The whole point of the namespace: the real host has no /etc/codex and no
	// /var/lib/entwurf, whatever the installer did inside.
	assert.ok(!existsSync("/etc/codex"), "the HOST grew /etc/codex — the mount namespace did not contain the installer");
	assert.ok(
		!existsSync("/var/lib/entwurf"),
		"the HOST grew /var/lib/entwurf — the mount namespace did not contain the installer",
	);
	console.log("  ok    the host has no /etc/codex and no /var/lib/entwurf after the run");
	process.exit(run.status ?? 1);
}

// ── the inner half: uid 0, a private /etc, and the REAL scripts ─────────────
let passed = 0;
function ok(label: string, cond: boolean): void {
	assert.ok(cond, label);
	console.log(`  ok    ${label}`);
	passed++;
}

ok(
	"[QK:CODEX-BIRTH-GATE-IS-ROOT] the sandbox gives euid 0, so the real root installer runs unmodified",
	process.getuid?.() === 0,
);

const scratch = reclaimOnExit(mkdtempSync(path.join(tmpdir(), "entwurf-codex-birth-inner.")));
const sha = (file: string): string => createHash("sha256").update(readFileSync(file)).digest("hex");
const mode = (file: string): string => (statSync(file).mode & 0o7777).toString(8).padStart(4, "0");

interface Ran {
	status: number | null;
	stdout: string;
	stderr: string;
}
function sh(script: string, args: string[] = [], env: NodeJS.ProcessEnv = process.env): Ran {
	const res = spawnSync("bash", [script, ...args], { encoding: "utf8", env });
	return { status: res.status, stdout: res.stdout ?? "", stderr: res.stderr ?? "" };
}

// ── 1. a clean install, and every byte it claims ─────────────────────────────
const first = sh(INSTALL);
ok(`the real installer succeeds on a clean root (exit ${first.status})`, first.status === 0);
ok("hooks.json was published", existsSync(HOOKS_FILE) && lstatSync(HOOKS_FILE).isFile());
ok("hooks.json is read-only (0444) and root-owned", mode(HOOKS_FILE) === "0444" && statSync(HOOKS_FILE).uid === 0);
ok("the launcher is published read-only-executable (0555)", mode(LAUNCHER) === "0555");
for (const [member, want] of [
	["meta-bridge-hook-codex.ts", "0444"],
	["lib/meta-session.ts", "0444"],
	["lib/native-push/codex-ws-client.ts", "0444"],
	["lib/session-id.js", "0444"],
	["entwurf-capabilities.json", "0444"],
] as const) {
	ok(`closure member ${member} is present and ${want}`, mode(path.join(HELPER_DIR, member)) === want);
}

// EXACT GRAMMAR. `[source]` hooks.json is `HooksFile { description?, hooks }`, the events
// map is keyed by the PascalCase event, each value a list of `MatcherGroup { matcher?,
// hooks }`, each handler a `#[serde(tag="type")]` variant. The three omissions are
// asserted as omissions, not as values: an empty `matcher` is not "no matcher", and an
// `async: true` birth hook would let the turn proceed before the record exists.
const hooks = JSON.parse(readFileSync(HOOKS_FILE, "utf8")) as {
	description?: unknown;
	hooks?: Record<string, Array<{ matcher?: unknown; hooks?: Array<Record<string, unknown>> }>>;
};
ok(
	"hooks.json top level carries exactly `description` + `hooks`",
	JSON.stringify(Object.keys(hooks).sort()) === JSON.stringify(["description", "hooks"]),
);
ok(
	"[QK:CODEX-BIRTH-DECLARES-ONLY-SESSIONSTART] the events map declares SessionStart and nothing else",
	JSON.stringify(Object.keys(hooks.hooks ?? {})) === JSON.stringify(["SessionStart"]),
);
const groups = hooks.hooks?.SessionStart ?? [];
ok("SessionStart holds exactly one matcher group", groups.length === 1);
ok(
	"[QK:CODEX-BIRTH-NO-MATCHER] the group carries NO matcher key, so all four sources (startup|resume|clear|compact) fire",
	!("matcher" in (groups[0] ?? {})),
);
const handlers = groups[0]?.hooks ?? [];
ok("the group holds exactly one handler", handlers.length === 1);
const handler = handlers[0] ?? {};
ok(
	"the handler is a `command` handler with exactly type+command+timeout",
	JSON.stringify(Object.keys(handler).sort()) === JSON.stringify(["command", "timeout", "type"]),
);
ok(
	"[QK:CODEX-BIRTH-SYNCHRONOUS] the handler carries no `async` — the record must exist before the turn proceeds",
	!("async" in handler),
);
ok(
	"[QK:CODEX-BIRTH-QUOTED-ABSOLUTE-LAUNCHER] the command is the single-quoted absolute launcher path (codex runs it as a SHELL STRING; there is no argv form)",
	handler.command === `'${LAUNCHER}'`,
);
ok("the handler timeout is 30", handler.timeout === 30);

// ── 2. the ownership state is the inverse's authority, and it is exact ───────
ok("the ownership state is root-owned 0444", mode(STATE_FILE) === "0444" && statSync(STATE_FILE).uid === 0);
ok(
	"[QK:CODEX-BIRTH-STATE-READABLE] ownership-state directories are root-owned 0755 so ordinary setup can traverse the 0444 receipt",
	mode(path.dirname(STATE_FILE)) === "0755" &&
		statSync(path.dirname(STATE_FILE)).uid === 0 &&
		mode(path.dirname(path.dirname(STATE_FILE))) === "0755" &&
		statSync(path.dirname(path.dirname(STATE_FILE))).uid === 0,
);
interface State {
	schema: string;
	status: string;
	hooksFile: string;
	hooksSha256: string;
	hooksPreimage: string;
	helperDir: string;
	etcDirCreated: boolean;
	helperFiles: Array<{ path: string; sha256: string; mode: string }>;
}
let state = JSON.parse(readFileSync(STATE_FILE, "utf8")) as State;
ok(
	"the state names its schema and a finished publish",
	state.schema === "codex-birth-install-state/v1" && state.status === "installed",
);
ok(
	"[QK:CODEX-BIRTH-PREIMAGE-RECORDED] the state records the PREIMAGE — on a clean host, `absent`",
	state.hooksPreimage === "absent",
);
ok("the state records that this run created /etc/codex", state.etcDirCreated === true);
ok("the recorded hooks.json digest matches the published bytes", state.hooksSha256 === sha(HOOKS_FILE));
ok(
	"every closure member is recorded by digest and mode, and every digest matches",
	state.helperFiles.length === 6 &&
		state.helperFiles.every(
			(f) =>
				sha(path.join(state.helperDir, f.path)) === f.sha256 && mode(path.join(state.helperDir, f.path)) === f.mode,
		),
);

// ── 3. FIRE the installed launcher, the way codex fires it ──────────────────
const MEASURED = {
	session_id: "01a08147-fbad-78d2-b266-e058f322125e",
	transcript_path:
		"/home/junghan/.codex/sessions/2026/09/08/rollout-2026-09-08T22-49-33-01a08147-fbad-78d2-b266-e058f322125e.jsonl",
	cwd: "/home/junghan/repos/gh/entwurf",
	hook_event_name: "SessionStart",
	model: "gpt-6-astra",
	permission_mode: "default",
	source: "startup",
};
function isolatedEnv(storeDir: string): NodeJS.ProcessEnv {
	const env: NodeJS.ProcessEnv = { ...process.env, PI_CODING_AGENT_DIR: storeDir };
	delete env.ENTWURF_META_SENDERS_DIR;
	delete env.ENTWURF_META_SESSIONS_DIR;
	return env;
}
function fire(envelope: unknown, storeDir: string): Ran {
	const res = spawnSync(LAUNCHER, [], {
		input: typeof envelope === "string" ? envelope : JSON.stringify(envelope),
		env: isolatedEnv(storeDir),
		encoding: "utf8",
	});
	return { status: res.status, stdout: res.stdout ?? "", stderr: res.stderr ?? "" };
}
function records(storeDir: string): readonly MetaIdentity[] {
	const dir = path.join(storeDir, "meta-sessions");
	return existsSync(dir) ? listAllMetaIdentitiesDir(dir).identities : [];
}
function hookLog(storeDir: string): string {
	const file = path.join(storeDir, "meta-bridge-hook.log");
	return existsSync(file) ? readFileSync(file, "utf8") : "";
}

const store = path.join(scratch, "store");
mkdirSync(store, { recursive: true });
const born = fire(MEASURED, store);
ok("a fire with the MEASURED 0.153.4 envelope exits 0", born.status === 0);
ok("the hook emits the neutral response and nothing else", born.stdout.trim() === "{}");
let live = records(store);
ok("exactly one record was minted", live.length === 1);
ok("[QK:CODEX-BIRTH-MINTS-CODEX] the record's backend is codex", live[0]?.backend === "codex");
ok(
	"[QK:CODEX-BIRTH-JOINS-ON-THREAD-ID] the record joins on session_id — the string that IS the app-server threadId and the MCP _meta.threadId",
	live[0]?.nativeSessionId === MEASURED.session_id,
);
ok(
	"the record carries the envelope's cwd, model and transcript path — none of them guessed",
	live[0]?.cwd === MEASURED.cwd &&
		live[0]?.model === MEASURED.model &&
		live[0]?.transcriptPath === MEASURED.transcript_path,
);
const bornGardenId = live[0]?.gardenId ?? "";
ok("the log names the mint with its own token", hookLog(store).includes(`birth-mint ${bornGardenId}`));

// A resume is the SAME thread: one citizen, attached, with refreshed axes.
const resumed = fire({ ...MEASURED, source: "resume", model: "gpt-6-astra-mini" }, store);
ok("a resume of the same thread exits 0", resumed.status === 0);
live = records(store);
ok("[QK:CODEX-BIRTH-RESUME-ATTACHES] the store still holds exactly ONE record after resume", live.length === 1);
ok("the resume attached to the same garden id", live[0]?.gardenId === bornGardenId);
ok("the attach refreshed the model rather than keeping a stale one", live[0]?.model === "gpt-6-astra-mini");
ok("the log distinguishes attach from mint", hookLog(store).includes(`birth-attach ${bornGardenId}`));

// ── 4. birth writes NO marker of any kind ───────────────────────────────────
// Not a pid marker (`[host]` one ppid is shared by every hook AND every MCP child of
// every window on this host, so it names no single citizen), and not a receiver marker
// (`[source]` codex has no filesystem-wake vocabulary at all; receive is native-push
// and ack-only). Either one would be a claim this backend cannot honour.
const entries = readdirSync(store);
ok(
	"[QK:CODEX-BIRTH-WRITES-NO-MARKER] the store holds records only — no senders, no receivers, no mailbox",
	!entries.includes("meta-senders") && !entries.includes("meta-receivers") && !entries.includes("meta-mailbox"),
);

// ── 5. refusals: every one is a REFUSAL, not a guessed record ───────────────
function refuses(label: string, envelope: unknown, expectInLog: string): void {
	const dir = mkdtempSync(path.join(scratch, "refuse."));
	const res = fire(envelope, dir);
	ok(
		`${label}: exits 0 and emits {} (a hook must never break the turn)`,
		res.status === 0 && res.stdout.trim() === "{}",
	);
	ok(`${label}: minted NOTHING`, records(dir).length === 0);
	ok(
		`${label}: the log says why (${expectInLog})`,
		hookLog(dir).includes("birth-refused") && hookLog(dir).includes(expectInLog),
	);
}
// The one a tolerant reader keyed on session_id would swallow: `[host]` SubagentStart
// carries the PARENT's session_id, so it would mint the parent's identity a second time.
refuses(
	"[QK:CODEX-BIRTH-REFUSES-SUBAGENT] a SubagentStart envelope",
	{
		...MEASURED,
		hook_event_name: "SubagentStart",
		agent_id: "01a08149-959a-7113-9d35-1845ab19a17f",
		agent_type: "default",
	},
	"hook_event_name is not exactly",
);
refuses(
	"a SessionStart NAME carrying subagent keys (hand-built envelope)",
	{ ...MEASURED, agent_id: "01a08149-959a-7113-9d35-1845ab19a17f" },
	"a subagent key (agent_id) is present",
);
refuses(
	"a UserPromptSubmit envelope",
	{ ...MEASURED, hook_event_name: "UserPromptSubmit", turn_id: "t-1", prompt: "hi" },
	"hook_event_name is not exactly",
);
refuses("a relative cwd", { ...MEASURED, cwd: "relative/dir" }, "cwd is not an absolute POSIX path");
refuses("a missing transcript_path", { ...MEASURED, transcript_path: undefined }, "transcript_path missing");
refuses(
	"a relative transcript_path",
	{ ...MEASURED, transcript_path: "sessions/x.jsonl" },
	"transcript_path is not an absolute POSIX path",
);
refuses("an unknown source", { ...MEASURED, source: "teleport" }, "source is not one of");
refuses("a non-string model", { ...MEASURED, model: 7 }, "model is present but not a non-empty string");
refuses("a session_id with whitespace", { ...MEASURED, session_id: "01a0 8147" }, "session_id carries whitespace");
refuses("no session_id", { ...MEASURED, session_id: undefined }, "session_id missing");
refuses(
	"[QK:CODEX-BIRTH-REQUIRES-MODEL] a missing model key",
	{ ...MEASURED, model: undefined },
	"model key is missing",
);
refuses("a malformed envelope", "{not json", "envelope parse failed");
// An explicit null model is a FACT, not a refusal — the record's own nullable axis.
{
	const dir = mkdtempSync(path.join(scratch, "nullmodel."));
	const res = fire({ ...MEASURED, model: null }, dir);
	ok(
		"an explicit null model mints with model=null (nullable axis, never guessed)",
		res.status === 0 && records(dir).length === 1 && records(dir)[0]?.model === null,
	);
}

// ── 6. the installer's refusals, and each one is ZERO-WRITE ─────────────────
const HOOKS_SHA_OURS = sha(HOOKS_FILE);
const OURS_BYTES = readFileSync(HOOKS_FILE);

// DRIFT: somebody edited the file we published. Re-installing would destroy the edit;
// the inverse deleting it would be worse.
chmodSync(HOOKS_FILE, 0o644);
writeFileSync(HOOKS_FILE, `${OURS_BYTES.toString("utf8")}\n// operator edit\n`);
const driftInstall = sh(INSTALL);
ok(
	"[QK:CODEX-INSTALL-REFUSES-DRIFT] install refuses a hooks.json that drifted from the recorded bytes",
	driftInstall.status !== 0 && driftInstall.stderr.includes("DRIFTED"),
);
const driftUninstall = sh(UNINSTALL);
ok(
	"[QK:CODEX-UNINSTALL-REFUSES-DRIFT] the inverse refuses to DELETE a drifted file and says so",
	driftUninstall.status !== 0 && driftUninstall.stderr.includes("DRIFT"),
);
ok(
	"the drifted file is still there, byte-for-byte as the operator left it",
	readFileSync(HOOKS_FILE, "utf8").includes("// operator edit"),
);
ok("the drifted refusal kept the ownership state as the provenance of what remains", existsSync(STATE_FILE));
// Restore the recorded bytes and the inverse proceeds.
writeFileSync(HOOKS_FILE, OURS_BYTES);
chmodSync(HOOKS_FILE, 0o444);
ok("the restored file matches the recorded digest again", sha(HOOKS_FILE) === HOOKS_SHA_OURS);

// ── 7. the exact inverse ────────────────────────────────────────────────────
const recordsBefore = records(store).length;
const removed = sh(UNINSTALL);
ok(`the inverse succeeds once nothing has drifted (exit ${removed.status})`, removed.status === 0);
ok(
	"[QK:CODEX-UNINSTALL-EXACT] hooks.json, the closure and the state are all gone",
	!existsSync(HOOKS_FILE) && !existsSync(HELPER_DIR) && !existsSync(STATE_FILE),
);
ok(
	"/etc/codex itself is gone, because the install recorded that it created it and nothing else was left in it",
	!existsSync("/etc/codex"),
);
ok(
	"[QK:CODEX-UNINSTALL-KEEPS-RECORDS] the inverse removed NO meta-record — a citizen's identity outlives the hook that minted it",
	records(store).length === recordsBefore && recordsBefore === 1,
);
const noState = sh(UNINSTALL);
ok(
	"[QK:CODEX-UNINSTALL-NO-STATE-REFUSES] the inverse with no state refuses instead of guessing an `rm` in /etc",
	noState.status !== 0 && noState.stderr.includes("no ownership state"),
);

// ── 8. never adopt what is not ours ─────────────────────────────────────────
mkdirSync("/etc/codex", { recursive: true });
const FOREIGN = '{"hooks":{"SessionStart":[{"hooks":[{"type":"command","command":"/opt/acme/audit.sh"}]}]}}\n';
writeFileSync(HOOKS_FILE, FOREIGN);
const foreign = sh(INSTALL);
ok(
	"[QK:CODEX-INSTALL-REFUSES-FOREIGN] install refuses an existing hooks.json when no ownership state vouches for it",
	foreign.status !== 0 && foreign.stderr.includes("NO entwurf ownership state"),
);
ok("the foreign declaration is byte-identical afterwards", readFileSync(HOOKS_FILE, "utf8") === FOREIGN);
ok("the refusal wrote nothing at all — no closure, no state", !existsSync(HELPER_DIR) && !existsSync(STATE_FILE));

// A SYMLINK at our path is the dangerous shape: publishing through it would write
// wherever it points, outside the only directory this unit may own.
rmSync(HOOKS_FILE);
const decoy = path.join(scratch, "decoy-target.json");
writeFileSync(decoy, "DECOY\n");
symlinkSync(decoy, HOOKS_FILE);
const linked = sh(INSTALL);
ok(
	"[QK:CODEX-INSTALL-REFUSES-SYMLINK] install refuses when /etc/codex/hooks.json is a symlink",
	linked.status !== 0 && linked.stderr.includes("SYMLINK"),
);
ok("the symlink's target was never written through", readFileSync(decoy, "utf8") === "DECOY\n");
ok("the symlink refusal wrote nothing", !existsSync(HELPER_DIR) && !existsSync(STATE_FILE));
rmSync(HOOKS_FILE);

// A foreign closure directory with no state behind it is the same refusal, one path over.
mkdirSync(path.join(HELPER_DIR, "lib"), { recursive: true });
writeFileSync(path.join(HELPER_DIR, "someone-elses.txt"), "x\n");
const foreignDir = sh(INSTALL);
ok(
	"install refuses a pre-existing closure directory with no ownership state",
	foreignDir.status !== 0 && foreignDir.stderr.includes("NO entwurf ownership state"),
);
ok(
	"that directory's contents are untouched",
	existsSync(path.join(HELPER_DIR, "someone-elses.txt")) && !existsSync(HOOKS_FILE),
);
rmSync(HELPER_DIR, { recursive: true });

// ── 9. a CORRUPT state is UNKNOWN ownership, never absent ownership ────────
const reinstall = sh(INSTALL);
ok(`a clean re-install succeeds after every refusal above (exit ${reinstall.status})`, reinstall.status === 0);
state = JSON.parse(readFileSync(STATE_FILE, "utf8")) as State;
const goodState = readFileSync(STATE_FILE);
const payloadFile = path.join(HELPER_DIR, "meta-bridge-hook-codex.ts");
const payloadBytes = readFileSync(payloadFile);
const foreignHelper = path.join(HELPER_DIR, "operator-note.txt");
writeFileSync(foreignHelper, "keep\n");
const inventoryDrift = sh(INSTALL);
ok(
	"[QK:CODEX-INSTALL-REFUSES-CLOSURE-DRIFT] reinstall refuses foreign helper inventory before replacing the directory",
	inventoryDrift.status !== 0 && inventoryDrift.stderr.includes("DRIFTED"),
);
ok("refused closure reinstall preserves the foreign file", readFileSync(foreignHelper, "utf8") === "keep\n");
rmSync(foreignHelper);
chmodSync(payloadFile, 0o644);
writeFileSync(payloadFile, `${payloadBytes.toString("utf8")}\n// operator edit\n`);
const payloadDrift = sh(INSTALL);
ok(
	"reinstall also refuses a helper whose digest or mode drifted",
	payloadDrift.status !== 0 && payloadDrift.stderr.includes("DRIFTED"),
);
ok(
	"refused helper reinstall preserves the edited payload",
	readFileSync(payloadFile, "utf8").includes("// operator edit"),
);
writeFileSync(payloadFile, payloadBytes);
chmodSync(payloadFile, 0o444);
writeFileSync(STATE_FILE, "{ not json");
const corruptInstall = sh(INSTALL);
ok(
	"[QK:CODEX-INSTALL-CORRUPT-STATE-REFUSES] install refuses when the ownership state is unparseable — UNKNOWN is not empty",
	corruptInstall.status !== 0 && corruptInstall.stderr.includes("UNKNOWN"),
);
ok("the published hooks.json was left exactly as it was", sha(HOOKS_FILE) === state.hooksSha256);
const corruptUninstall = sh(UNINSTALL);
ok(
	"the inverse also refuses an unparseable state rather than removing /etc files on a guess",
	corruptUninstall.status !== 0 && corruptUninstall.stderr.includes("UNKNOWN"),
);
ok("nothing was removed by that refusal", existsSync(HOOKS_FILE) && existsSync(LAUNCHER));

// A state whose digest disagrees with an untouched file is drift on the OTHER side —
// the state was swapped, not the file. Same refusal, because the pair is the authority.
writeFileSync(STATE_FILE, goodState);
writeFileSync(STATE_FILE, JSON.stringify({ ...state, hooksSha256: "0".repeat(64) }, null, 2));
const swapped = sh(INSTALL);
ok(
	"install refuses when the state's recorded digest disagrees with the live file",
	swapped.status !== 0 && swapped.stderr.includes("DRIFTED"),
);
writeFileSync(STATE_FILE, goodState);

// ── 10. re-install ADOPTS its own bytes and records the preimage as ours ────
const adopt = sh(INSTALL);
ok(
	"a re-install over its own published bytes succeeds and says it is adopting them",
	adopt.status === 0 && adopt.stdout.includes("adopting the hooks.json this unit published"),
);
const adopted = JSON.parse(readFileSync(STATE_FILE, "utf8")) as State;
ok(
	"[QK:CODEX-INSTALL-PREIMAGE-OURS] the re-install's recorded preimage is `ours:<sha>`, not `absent` — the state never claims a clean host it did not find",
	adopted.hooksPreimage === `ours:${state.hooksSha256}`,
);
ok(
	"the re-installed closure still matches every recorded digest",
	adopted.helperFiles.every((f) => sha(path.join(adopted.helperDir, f.path)) === f.sha256),
);
const finalRemoval = sh(UNINSTALL);
ok(
	"the inverse is still exact after a re-install",
	finalRemoval.status === 0 && !existsSync(HOOKS_FILE) && !existsSync(HELPER_DIR) && !existsSync(STATE_FILE),
);

// ── 11. THE CRASH WINDOW: a publish that never finished ─────────────────────
// The installer writes its state BEFORE the first /etc byte moves, so a run killed
// between the two renames of step 6 leaves live bytes whose digests are not the ones the
// top-level state records. Before `previous` existed, that host was BRICKED: the install
// refused ("DRIFTED"/"helper inventory drifted") and the inverse refused too, so the
// root-owned files in /etc had no authority that could ever replace or remove them.
//
// The window cannot be scheduled — it is one signal wide — so it is CONSTRUCTED here, in
// exactly the shape the installer writes: `status: "publishing"` naming the incoming
// generation at the top level and the one it is replacing under `previous`. The digests
// below are the REAL live ones; only the generation they are filed under is arranged.
interface Generation {
	hooksSha256: string;
	helperFiles: Array<{ path: string; sha256: string; mode: string }>;
}
const OTHER_SHA = "b".repeat(64);
function liveGeneration(st: State): Generation {
	return {
		hooksSha256: sha(HOOKS_FILE),
		helperFiles: st.helperFiles.map((f) => ({
			path: f.path,
			sha256: sha(path.join(HELPER_DIR, f.path)),
			mode: mode(path.join(HELPER_DIR, f.path)),
		})),
	};
}
function writeState(next: State | (State & { previous: Generation | null })): void {
	chmodSync(STATE_FILE, 0o644);
	writeFileSync(STATE_FILE, JSON.stringify(next, null, 2));
	chmodSync(STATE_FILE, 0o444);
}
/** The state an install killed mid-publish leaves behind: incoming at the top, live under `previous`. */
function stageInterruptedPublish(incoming: Partial<Generation> = {}): State {
	const installed = JSON.parse(readFileSync(STATE_FILE, "utf8")) as State;
	const live = liveGeneration(installed);
	writeState({
		...installed,
		status: "publishing",
		hooksSha256: incoming.hooksSha256 ?? OTHER_SHA,
		helperFiles: incoming.helperFiles ?? live.helperFiles.map((f) => ({ ...f, sha256: OTHER_SHA })),
		previous: live,
	});
	return installed;
}

const rebuilt = sh(INSTALL);
ok(`a fresh install for the crash-window cells succeeds (exit ${rebuilt.status})`, rebuilt.status === 0);
const liveBefore = liveGeneration(JSON.parse(readFileSync(STATE_FILE, "utf8")) as State);
stageInterruptedPublish();
const resumedPublish = sh(INSTALL);
ok(
	"[QK:CODEX-INSTALL-RESUMES-INTERRUPTED-PUBLISH] an install killed mid-publish is REPAIRABLE: the next run adopts the generation it was replacing instead of calling the live bytes foreign",
	resumedPublish.status === 0 && resumedPublish.stdout.includes("INTERRUPTED publish was replacing"),
);
const repaired = JSON.parse(readFileSync(STATE_FILE, "utf8")) as State;
ok(
	"[QK:CODEX-INSTALL-CLEARS-PREVIOUS] the finished publish clears the generation it replaced — a stale second authority may not outlive the run that needed it",
	repaired.status === "installed" && (repaired as unknown as { previous: unknown }).previous === null,
);
ok("the repaired state certifies the live bytes again", repaired.hooksSha256 === sha(HOOKS_FILE));

// MIXED: the closure already moved, hooks.json had not yet. Both halves are owned, by
// different generations — refusing the mixture would refuse the very window `previous`
// exists to survive.
writeState({
	...repaired,
	status: "publishing",
	hooksSha256: OTHER_SHA,
	helperFiles: liveBefore.helperFiles,
	previous: {
		hooksSha256: liveBefore.hooksSha256,
		helperFiles: liveBefore.helperFiles.map((f) => ({ ...f, sha256: OTHER_SHA })),
	},
});
const mixed = sh(INSTALL);
ok(
	"[QK:CODEX-INSTALL-MIXED-GENERATION] a half-published host (closure from one generation, hooks.json from the other) is repaired, not refused",
	mixed.status === 0,
);

// The inverse owes the same reading. A host stuck mid-publish must still be REMOVABLE,
// or the operator is left with root-owned files in /etc that nothing may touch.
stageInterruptedPublish();
const interruptedRemoval = sh(UNINSTALL);
ok(
	"[QK:CODEX-UNINSTALL-INTERRUPTED-PUBLISH] the inverse removes the live generation of an interrupted publish rather than reporting it as somebody else's edit",
	interruptedRemoval.status === 0 && !existsSync(HOOKS_FILE) && !existsSync(HELPER_DIR) && !existsSync(STATE_FILE),
);

// And the shape that is NOT a crash window: a FINISHED install still naming a previous
// generation. That is a second authority nothing is replacing, so every surface refuses it.
const reinstalled = sh(INSTALL);
ok(`the closure is back for the malformed-state cells (exit ${reinstalled.status})`, reinstalled.status === 0);
const installedState = JSON.parse(readFileSync(STATE_FILE, "utf8")) as State;
writeState({ ...installedState, previous: liveGeneration(installedState) });
const staleAuthority = sh(INSTALL);
ok(
	"[QK:CODEX-INSTALL-REFUSES-STALE-GENERATION] install refuses an `installed` state that still records a previous generation",
	staleAuthority.status !== 0 && staleAuthority.stderr.includes("UNKNOWN"),
);
const staleRemoval = sh(UNINSTALL);
ok(
	"the inverse refuses the same malformed state instead of removing /etc bytes under two authorities",
	staleRemoval.status !== 0 && staleRemoval.stderr.includes("UNKNOWN"),
);
ok("neither refusal touched the published bytes", existsSync(HOOKS_FILE) && existsSync(LAUNCHER));

// ── 12. the doctor may not call an unsafe or incomplete host green ───────────
// Digest equality is not ownership: a payload anyone can rewrite is a managed layer in
// name only, and the fresh-call preflight already refuses exactly these shapes. A doctor
// that reported green on them would be the one surface disagreeing with the product.
function doctor(): Ran {
	// The record axis reads a store, so it gets the gate's OWN store — the operator's real
	// one must not decide whether this gate is green, in either direction.
	return sh(DOCTOR, [], isolatedEnv(store));
}
writeState(installedState);
const healthy = doctor();
ok(
	`the doctor is green on a correctly installed host (exit ${healthy.status})`,
	healthy.status === 0 && healthy.stdout.includes("every evaluated axis is green"),
);
ok(
	"the doctor states the ownership state's own protection, not just the bytes it licenses",
	healthy.stdout.includes("root-owned and non-writable"),
);

const payload = path.join(HELPER_DIR, "meta-bridge-hook-codex.ts");
chmodSync(payload, 0o666);
const writablePayload = doctor();
ok(
	"[QK:CODEX-DOCTOR-REFUSES-WRITABLE-CLOSURE] the doctor is RED on a closure member whose digest still matches but which anyone can rewrite",
	writablePayload.status === 1 && writablePayload.stderr.includes("group/world-writable"),
);
ok(
	"[QK:CODEX-DOCTOR-OK-NEVER-CONTRADICTS] and it does NOT also print the inventory OK line — an operator may not be handed one line saying a member is world-writable and another saying the closure is root-owned throughout, then left to pick",
	!/holds exactly the recorded members/.test(writablePayload.stdout),
);
chmodSync(payload, 0o444);

// PARENTS. The installer refuses to publish into a managed directory another user can
// rewrite; a doctor that only compared digests called that same host green, so ownership
// truth and the installer disagreed about the one thing the operator asked.
for (const [dir, label] of [
	["/etc/codex", "the managed System-layer folder"],
	["/var/lib/entwurf", "the state root"],
] as const) {
	const before = mode(dir);
	chmodSync(dir, 0o777);
	const loose = doctor();
	ok(
		`[QK:CODEX-DOCTOR-REFUSES-UNSAFE-PARENT] the doctor is RED when ${label} (${dir}) is group/world-writable, exactly as the installer refuses it`,
		loose.status === 1 && loose.stderr.includes(dir),
	);
	chmodSync(dir, Number.parseInt(before, 8));
}
ok("the doctor is green again once both parents are restored", doctor().status === 0);

// THE BINDING. This unit owns two FIXED paths. A state that names other paths is authority
// for somewhere else — and a doctor that read its paths OUT of the state would certify a
// COPY of the closure and report green while the real /etc/codex bytes had no authority at
// all. The copy below is byte-identical and mode-identical on purpose: only the binding
// distinguishes it.
const decoyRoot = "/var/lib/entwurf/decoy";
mkdirSync(decoyRoot, { recursive: true });
cpSync(HOOKS_FILE, path.join(decoyRoot, "hooks.json"));
cpSync(HELPER_DIR, path.join(decoyRoot, "entwurf-birth"), { recursive: true });
writeState({
	...installedState,
	hooksFile: path.join(decoyRoot, "hooks.json"),
	helperDir: path.join(decoyRoot, "entwurf-birth"),
});
const retargeted = doctor();
ok(
	"[QK:CODEX-DOCTOR-BINDS-FIXED-PATHS] the doctor is RED on a state that certifies a copy somewhere else, however well those bytes match",
	retargeted.status === 1 && retargeted.stderr.includes("not the fixed path this unit owns"),
);
// The doctor's repair line says the inverse refuses it too. That sentence has to be TRUE:
// an inverse that followed a retargeted state would delete files at a path this unit was
// never allowed to own, and would leave the real /etc/codex bytes behind.
const retargetedRemoval = sh(UNINSTALL);
ok(
	"[QK:CODEX-UNINSTALL-BINDS-FIXED-PATHS] the inverse refuses a state naming paths outside the two this unit owns, rather than deleting whatever it was pointed at",
	retargetedRemoval.status !== 0 && retargetedRemoval.stderr.includes("not the fixed path this unit owns"),
);
ok(
	"that refusal deleted nothing — neither the real installation nor the copy",
	existsSync(HOOKS_FILE) && existsSync(LAUNCHER) && existsSync(path.join(decoyRoot, "hooks.json")),
);
writeState(installedState);
rmSync(decoyRoot, { recursive: true, force: true });
ok("the doctor is green again once the state names the fixed paths", doctor().status === 0);

const stray = path.join(HELPER_DIR, "operator-left-this.txt");
writeFileSync(stray, "x\n");
const strayDoctor = doctor();
ok(
	"[QK:CODEX-DOCTOR-REPORTS-INVENTORY] the doctor is RED on a closure holding a file no generation records — the inverse could never reclaim that directory",
	strayDoctor.status === 1 && strayDoctor.stderr.includes("no generation records"),
);
rmSync(stray);

chmodSync(STATE_FILE, 0o666);
const writableState = doctor();
ok(
	"[QK:CODEX-DOCTOR-REFUSES-WRITABLE-STATE] the doctor is RED when the removal authority itself is writable by somebody else",
	writableState.status === 1 && writableState.stderr.includes("group/world-writable"),
);
chmodSync(STATE_FILE, 0o444);

writeState({ ...installedState, previous: liveGeneration(installedState) });
const staleDoctor = doctor();
ok(
	"[QK:CODEX-DOCTOR-REFUSES-STALE-GENERATION] the doctor is RED on a finished install that still records the generation it replaced",
	staleDoctor.status === 1 && staleDoctor.stderr.includes("state.previous"),
);
writeState(installedState);
ok("the doctor is green again once the state is restored", doctor().status === 0);

const removal = sh(UNINSTALL);
ok(
	"the inverse is exact after the crash-window and doctor cells",
	removal.status === 0 && !existsSync(HOOKS_FILE) && !existsSync(HELPER_DIR) && !existsSync(STATE_FILE),
);

// ── 13. the inverse reclaims what the UNIT created, not what the last run saw ──
// Reinstall is the repair the doctor prints, so it is the ordinary path — and it used to
// erase the one fact the inverse needs: an install that finds /etc/codex already there
// recorded `etcDirCreated: false`, so after ONE idempotent reinstall the inverse left an
// empty root-owned /etc/codex behind forever. No crash needed to reach that.
rmSync("/etc/codex", { recursive: true, force: true });
const created = sh(INSTALL);
ok(`a clean-host install for the reclaim cells succeeds (exit ${created.status})`, created.status === 0);
ok(
	"the clean-host install records that IT created /etc/codex",
	(JSON.parse(readFileSync(STATE_FILE, "utf8")) as State).etcDirCreated === true,
);
const reinstalledOverOwn = sh(INSTALL);
ok(`an ordinary idempotent reinstall succeeds (exit ${reinstalledOverOwn.status})`, reinstalledOverOwn.status === 0);
ok(
	"[QK:CODEX-INSTALL-KEEPS-ETC-PROVENANCE] the reinstall CARRIES the creation history instead of overwriting it with what this run happened to see",
	(JSON.parse(readFileSync(STATE_FILE, "utf8")) as State).etcDirCreated === true,
);
const reclaimed = sh(UNINSTALL);
ok(
	"[QK:CODEX-UNINSTALL-RECLAIMS-CREATED-ETC] after that reinstall the inverse still removes /etc/codex itself — a directory this unit made does not become permanent because it was repaired once",
	reclaimed.status === 0 && !existsSync("/etc/codex"),
);

// The inverse is the last surface that reads the removal AUTHORITY, and it was the only one
// of the three that read it without checking it. The installer and the doctor both refuse a
// state another user can rewrite; deleting files in /etc on its word was the asymmetry.
const forAuthority = sh(INSTALL);
ok(`a fresh install for the authority cell succeeds (exit ${forAuthority.status})`, forAuthority.status === 0);
chmodSync(STATE_FILE, 0o666);
const looseAuthority = sh(UNINSTALL);
ok(
	"[QK:CODEX-UNINSTALL-REFUSES-WRITABLE-STATE] the inverse refuses to delete /etc bytes on the word of a state anyone can rewrite — the same refusal the installer and the doctor already make",
	looseAuthority.status !== 0 && looseAuthority.stderr.includes("group/world-writable"),
);
ok("that refusal removed nothing", existsSync(HOOKS_FILE) && existsSync(LAUNCHER) && existsSync(STATE_FILE));
chmodSync(STATE_FILE, 0o444);
const authorityRestored = sh(UNINSTALL);
ok(
	"and it proceeds once the authority is intact again",
	authorityRestored.status === 0 && !existsSync(HOOKS_FILE) && !existsSync("/etc/codex"),
);

console.log(`[check-codex-birth-hook] ${passed} assertions ok`);
