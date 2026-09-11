/**
 * check-codex-birth-hook — #95 gate: the Codex BIRTH path, proven without Codex.
 *
 * WHAT MOVED HERE, AND WHY THE ROOT SANDBOX IS GONE. This gate used to run inside
 * `unshare --map-root-user --mount` with an overlayfs over the real `/etc`, because the
 * birth unit published into `/etc/codex` and a production installer whose target can be
 * redirected is one whose refusals can be side-stepped. The unit now publishes into the
 * operator's own `$CODEX_HOME` and `$XDG_DATA_HOME`, so a plain mkdtemp fences it exactly:
 * no namespace, no overlay, no euid 0, and no honest-SKIP hole on a host without userns.
 *
 * The claims that died with the root unit were claims ABOUT root — `/etc` provenance, a
 * root-owned 0444 receipt, a 0755 traversal path for setup. The claims about the PAYLOAD
 * and the DECLARATION are the same ones, asserted the same way, and they are what this file
 * carries forward: one V3 record per thread and only for a top-level SessionStart, the
 * envelope's own cwd/model/transcript rather than a guess, no marker of any kind, a resume
 * that attaches instead of minting twice, and a declaration whose grammar IS the identity
 * the operator trusts once.
 *
 * The unit's install/inverse/doctor refusals — foreign bytes, drift, symlinks, unsafe
 * ownership, the vendor trust receipt — live in `scripts/smoke-codex-birth.sh`, which owns
 * the same sandbox shape at shell level. This file owns the payload.
 */

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { listAllMetaIdentitiesDir, type MetaIdentity } from "../pi-extensions/lib/meta-session.ts";
import { reclaimOnExit } from "./lib/reclaim-on-exit.ts";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const INSTALL = path.join(REPO, "scripts", "codex-birth-install.sh");

let passed = 0;
function ok(label: string, cond: boolean): void {
	assert.ok(cond, label);
	console.log(`  ok    ${label}`);
	passed++;
}

// The fence: HOME, XDG_DATA_HOME and CODEX_HOME all inside one temp dir, so the installer's
// fixed paths resolve entirely within it. Nothing is redirected by a flag the unit does not
// have; the unit reads the same env an operator's shell does.
const scratch = reclaimOnExit(mkdtempSync(path.join(tmpdir(), "entwurf-codex-birth.")));
const HOME = path.join(scratch, "home");
const XDG = path.join(scratch, "xdg");
const CODEX_HOME = path.join(HOME, ".codex");
mkdirSync(CODEX_HOME, { recursive: true });
mkdirSync(XDG, { recursive: true });

const HOOKS_FILE = path.join(CODEX_HOME, "hooks.json");
const HELPER_DIR = path.join(XDG, "entwurf", "codex-birth", "helper");
const LAUNCHER = path.join(HELPER_DIR, "codex-birth-launch.sh");
const STATE_FILE = path.join(XDG, "entwurf", "codex-birth", "install-state.json");
const UNIT_ENV: NodeJS.ProcessEnv = { ...process.env, HOME, XDG_DATA_HOME: XDG, CODEX_HOME };

const mode = (file: string): string => (statSync(file).mode & 0o7777).toString(8).padStart(4, "0");

interface Ran {
	status: number | null;
	stdout: string;
	stderr: string;
}
function sh(script: string, args: string[] = [], env: NodeJS.ProcessEnv = UNIT_ENV): Ran {
	const res = spawnSync("bash", [script, ...args], { encoding: "utf8", env });
	return { status: res.status, stdout: res.stdout ?? "", stderr: res.stderr ?? "" };
}

// ── 1. a clean install, and every byte it claims ─────────────────────────────
const first = sh(INSTALL);
ok(`the real installer succeeds on a clean host (exit ${first.status})`, first.status === 0);
ok("hooks.json was published as a regular file", existsSync(HOOKS_FILE) && statSync(HOOKS_FILE).isFile());
ok("hooks.json is owned by the operator running it", statSync(HOOKS_FILE).uid === process.getuid?.());
ok("the launcher is published executable", mode(LAUNCHER) === "0755");
for (const member of [
	"meta-bridge-hook-codex.ts",
	"lib/meta-session.ts",
	"lib/native-push/codex-ws-client.ts",
	"lib/session-id.js",
	"entwurf-capabilities.json",
]) {
	const file = path.join(HELPER_DIR, member);
	ok(`the closure member ${member} is published 0644`, existsSync(file) && mode(file) === "0644");
}
ok("the ownership state is a regular file the operator owns", statSync(STATE_FILE).uid === process.getuid?.());

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
	const env: NodeJS.ProcessEnv = { ...UNIT_ENV, PI_CODING_AGENT_DIR: storeDir };
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

console.log(`\n[check-codex-birth-hook] ${passed} checks passed — payload + declaration, fenced in ${scratch}`);
