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
import {
	appendSessionStartGroup,
	canonicalJson,
	certifySplice,
	declarationDigest,
	entwurfDeclarationGroup,
	removeEntwurfDescription,
	removeSessionStartGroup,
	selectEntwurfDeclaration,
	trustReceiptKey,
} from "../pi-extensions/lib/codex-declaration.js";
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

// ── 2. the declaration leaf: what entwurf owns inside a file it SHARES (#117) ─
// The installer, the inverse, the doctor and the fresh preflight all decide with this leaf, so
// its two mechanisms are proven here once rather than four times through their shells. The
// mechanisms are: a NORMALIZED digest (blind to whatever a neighbour's serializer does) and a
// SPAN SPLICE (so a neighbour's bytes are copied through rather than rewritten).
{
	const fakeLauncher = "/opt/entwurf/codex-birth-launch.sh";
	const ourGroup = entwurfDeclarationGroup(fakeLauncher);
	const herdrGroup = {
		hooks: [{ type: "command", command: "bash '/home/op/.codex/herdr-agent-state.sh' session", timeout: 10 }],
	};

	ok(
		"[QK:CODEX-DECL-CANONICAL-KEY-ORDER] the canonical form sorts keys recursively, so two documents that differ only in key order digest identically",
		canonicalJson({ b: 1, a: [{ y: 2, x: 3 }] }) === canonicalJson({ a: [{ x: 3, y: 2 }], b: 1 }),
	);
	ok(
		"[QK:CODEX-DECL-DIGEST-BINDS-LAUNCHER] the digest is sensitive to the launcher path — the one string the vendor keys its trust receipt to",
		declarationDigest(ourGroup) !== declarationDigest(entwurfDeclarationGroup(`${fakeLauncher}.bak`)),
	);
	ok(
		"[QK:CODEX-DECL-DIGEST-BINDS-EVENT] the digest covers the EVENT as well as the group, so the same group under another event is another identity",
		declarationDigest(ourGroup) !== declarationDigest(ourGroup, "SubagentStart"),
	);

	// SELECTION is by the launcher command, at whatever index that command happens to sit.
	for (const [label, groups, wantIndex] of [
		["alone", [ourGroup], 0],
		["after a neighbour", [herdrGroup, ourGroup], 1],
		["before a neighbour", [ourGroup, herdrGroup], 0],
		["between neighbours", [herdrGroup, ourGroup, herdrGroup], 1],
	] as const) {
		const picked = selectEntwurfDeclaration({ hooks: { SessionStart: groups } }, fakeLauncher);
		ok(
			`[QK:CODEX-DECL-SELECT-BY-COMMAND] entwurf's declaration is selected by its command, ${label} (index ${wantIndex})`,
			picked.ok && picked.groupIndex === wantIndex && picked.handlerIndex === 0,
		);
		ok(
			`the trust key names that measured position, ${label}`,
			picked.ok &&
				trustReceiptKey("/h/hooks.json", picked.groupIndex, picked.handlerIndex) ===
					`/h/hooks.json:session_start:${wantIndex}:0`,
		);
		ok(
			`every other group is reported FOREIGN and none of ours is, ${label}`,
			picked.ok && picked.foreign.length === groups.length - 1 && !picked.foreign.some((g) => g.index === wantIndex),
		);
	}

	for (const [code, document] of [
		["declaration-absent", { hooks: { SessionStart: [herdrGroup] } }],
		["declaration-duplicated", { hooks: { SessionStart: [ourGroup, herdrGroup, ourGroup] } }],
		["declaration-shape-drifted", { hooks: { SessionStart: [{ matcher: "startup", ...ourGroup }] } }],
		["declaration-shape-drifted", { hooks: { SessionStart: [{ hooks: [{ ...ourGroup.hooks[0], async: true }] }] } }],
		["declaration-shape-drifted", { hooks: { SessionStart: [{ hooks: [ourGroup.hooks[0], herdrGroup.hooks[0]] }] } }],
		["hooks-unreadable", { hooks: { SessionStart: "not an array" } }],
	] as const) {
		const picked = selectEntwurfDeclaration(document, fakeLauncher);
		ok(
			`[QK:CODEX-DECL-NAMED-REFUSALS] ${code} is returned by name rather than as a silent miss (${JSON.stringify(document).slice(0, 60)}…)`,
			!picked.ok && picked.code === code,
		);
	}

	// THE SPLICE. What is asserted is not "the result parses" but "every byte a neighbour owns is
	// literally still there", because a re-serialize would also parse. So the fixtures below are
	// deliberately formatted the way NOTHING in this repo serializes — tabs, inline groups, the
	// neighbour's keys in the order serde emits them — and the assertion is a literal substring.
	// A fixture written with `JSON.stringify(_, null, 2)` would let a whole-document rewrite pass
	// unnoticed, which is the one failure this mechanism exists to prevent.
	const herdrLine = `\t\t\t{"hooks": [{"command": ${JSON.stringify(herdrGroup.hooks[0].command)}, "timeout": 10, "type": "command"}]}`;
	const ourLine = `\t\t\t{"hooks": [{"type": "command", "command": "'${fakeLauncher}'", "timeout": 30}]}`;
	const shared = [
		"{",
		'\t"description": "entwurf codex-birth 9.9.9 — prose we authored",',
		'\t"hooks": {',
		'\t\t"SessionStart": [',
		`${ourLine},`,
		herdrLine,
		"\t\t]",
		"\t}",
		"}",
	].join("\n");
	ok(
		"the shared fixture really does hold the neighbour's bytes verbatim, in formatting nothing here would reproduce",
		shared.includes(herdrLine) && JSON.stringify(JSON.parse(shared), null, 2) !== shared,
	);
	const withoutOurs = removeEntwurfDescription(
		certifySplice(removeSessionStartGroup(shared, 0), { ...JSON.parse(shared), hooks: { SessionStart: [herdrGroup] } }),
	);
	ok(
		"[QK:CODEX-DECL-SPLICE-KEEPS-FOREIGN-BYTES] removing entwurf's group leaves the neighbour's bytes literally untouched",
		withoutOurs.includes(herdrLine),
	);
	ok(
		"removing entwurf's group also removes entwurf's own description and nothing else",
		canonicalJson(JSON.parse(withoutOurs)) === canonicalJson({ hooks: { SessionStart: [herdrGroup] } }),
	);
	const foreignOnly = ["{", '\t"hooks": {', '\t\t"SessionStart": [', herdrLine, "\t\t]", "\t}", "}"].join("\n");
	const rejoined = certifySplice(appendSessionStartGroup(foreignOnly, ourGroup), {
		hooks: { SessionStart: [herdrGroup, ourGroup] },
	});
	ok(
		"[QK:CODEX-DECL-SPLICE-APPENDS-LAST] appending entwurf's group leaves the neighbour at its own index — and therefore at its own trust receipt — with its bytes unchanged",
		selectEntwurfDeclaration(JSON.parse(rejoined), fakeLauncher).groupIndex === 1 && rejoined.includes(herdrLine),
	);

	// THE POST-CONDITION IS THE SAFETY. The span reader is the only new way this unit can damage
	// a file nobody asked it to touch, so no splice is ever trusted on the reader's word.
	let refused = "";
	try {
		certifySplice(rejoined, { hooks: { SessionStart: [herdrGroup] } });
	} catch (err) {
		refused = err instanceof Error ? err.message : String(err);
	}
	ok(
		"[QK:CODEX-DECL-SPLICE-CERTIFIED] a splice whose result is not the value the caller intended is REFUSED, never returned",
		refused.includes("not the value this edit intended"),
	);
	refused = "";
	try {
		certifySplice("{not json", { hooks: {} });
	} catch (err) {
		refused = err instanceof Error ? err.message : String(err);
	}
	ok("a splice that does not parse is refused with its own reason", refused.includes("does not parse"));

	// The span reader must find the SAME structure `JSON.parse` does, across the shapes a hooks
	// file is actually written in. A disagreement here is the reader silently editing the wrong
	// range, which is exactly what the post-condition above is guarding.
	for (const [label, text] of [
		["compact", JSON.stringify({ hooks: { SessionStart: [ourGroup, herdrGroup] } })],
		["2-space", JSON.stringify({ hooks: { SessionStart: [ourGroup, herdrGroup] } }, null, 2)],
		["tab", JSON.stringify({ hooks: { SessionStart: [ourGroup, herdrGroup] } }, null, "\t")],
		[
			"strings that contain braces and escaped quotes",
			JSON.stringify({
				description: 'a } b ] c \\" d',
				hooks: { SessionStart: [ourGroup, { hooks: [{ type: "command", command: '] } "x"', timeout: 1 }] }] },
			}),
		],
	] as const) {
		const trimmed = certifySplice(removeSessionStartGroup(text, 0), {
			...(JSON.parse(text) as Record<string, unknown>),
			hooks: { SessionStart: [(JSON.parse(text) as { hooks: { SessionStart: unknown[] } }).hooks.SessionStart[1]] },
		});
		ok(
			`[QK:CODEX-DECL-SPAN-READER-EXACT] the span reader agrees with JSON.parse on ${label} formatting`,
			JSON.parse(trimmed) !== null,
		);
	}
}

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
