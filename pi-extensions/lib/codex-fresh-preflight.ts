import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { parse } from "smol-toml";

import {
	type CodexProtocolOpener,
	type CodexRpcProtocol,
	type CodexSocketFileCheck,
	checkCodexSocketFile,
	realCodexProtocolOpener,
	resolveCodexDefaultSocketPath,
} from "./native-push/codex-ws-client.ts";

export type CodexPreflightRejectReason =
	| "codex-birth-unit-missing"
	| "codex-mcp-hand-missing"
	| "codex-visible-identity-missing"
	| "codex-birth-trust-missing"
	| "codex-app-server-unavailable";

export const CODEX_PREFLIGHT_HINT: Record<CodexPreflightRejectReason, string> = {
	"codex-birth-unit-missing":
		"the Codex SessionStart birth unit is absent, drifted from its recorded digests, or unsafely owned; run `entwurf install-codex-birth`, then `entwurf doctor-codex-birth`",
	"codex-birth-trust-missing":
		"the vendor has recorded no trust receipt for this birth declaration, so the hook is declared and never runs; open a visible plain Codex, answer its prompt with `Trust all and continue`, send one first turn, then `entwurf doctor-codex-birth`",
	"codex-mcp-hand-missing":
		"the Codex user config does not expose the managed entwurf bridge; run `entwurf install-codex-mcp`, then `entwurf doctor-codex-mcp`",
	"codex-visible-identity-missing":
		"Codex tui.status_line does not include thread-title; run `entwurf install-codex-statusline`, then `entwurf doctor-codex-statusline`",
	"codex-app-server-unavailable":
		"the operator-owned Codex app-server default socket is absent or unsafe; start it with `entwurf codex-app-server` from a detached tmux session (one that is NOT where you work), then retry",
};

/**
 * THE CALLER AXIS, AND IT IS NOT THE ONE ABOVE. Everything above asks "can a Codex sibling be
 * OPENED on this host" — birth unit, vendor trust, MCP hand, visible identity, app-server. This
 * asks the opposite question: "can the Codex citizen DOING the opening be located", which is a
 * fact about the CALLER's own config and is required no matter which backend it opens (#95
 * lane B). Keeping them apart is the point: a Pi caller opening a Codex sibling needs the five
 * above and none of this, and a Codex caller opening a Pi sibling needs this and none of those.
 * Folding either into the other would refuse one operator for the other's missing repair.
 */
export type CodexCallerPreflightRejectReason = "codex-caller-title-missing";

/**
 * THE LAUNCH-DIRECTORY AXIS, AND IT IS A THIRD QUESTION AGAIN. The target axis asks "can a Codex
 * sibling be opened on this host", the caller axis asks "can the Codex citizen doing the opening
 * be located", and this asks "will the vendor START A TURN in the directory this launch names" —
 * a fact about ONE directory rather than about the host or the caller, so it is the only axis
 * that needs the resolved launch cwd and the only one that can pass for one call and refuse the
 * next on an unchanged host.
 */
export type CodexLaunchCwdPreflightRejectReason = "codex-launch-cwd-undecided" | "codex-launch-cwd-untrusted-ancestor";

export const CODEX_LAUNCH_CWD_PREFLIGHT_HINT: Record<CodexLaunchCwdPreflightRejectReason, string> = {
	"codex-launch-cwd-undecided":
		"Codex has recorded NO decision for the directory this sibling would start in, so the window would open on the vendor's folder-consent screen and WAIT for a human instead of running its first turn — no rollout, no callback, and nothing to address; either launch in a directory this Codex has already been answered for, or open a plain `codex -C <dir>` there once and answer it, then retry",
	"codex-launch-cwd-untrusted-ancestor":
		"this directory sits inside a project the operator marked `untrusted`, and on this rail the vendor does not offer a consent screen for that — it refuses the startup outright with `pass the repository root explicitly with --cd`, so answering a prompt at this directory would only reproduce that error; launch at that untrusted project's own root instead, or change that project's recorded decision",
};

export const CODEX_CALLER_PREFLIGHT_HINT: Record<CodexCallerPreflightRejectReason, string> = {
	"codex-caller-title-missing":
		"this Codex caller's tui.terminal_title does not include thread-id, so the multiplexer reports no pane title naming this thread and there is no caller seat to open the sibling beside; run `entwurf install-codex-terminal-title`, then `entwurf doctor-codex-terminal-title` (an explicit placement.tmuxSession skips this check entirely, because it never needs the seat)",
};

export interface CodexUnitPaths {
	hooksFile: string;
	helperDir: string;
	stateFile: string;
}

export interface CodexPreflightDeps {
	unitPathsOverride?: CodexUnitPaths;
	operatorUid?: number;
	checkSocket?: (socketPath: string) => CodexSocketFileCheck;
	openProtocol?: CodexProtocolOpener;
	appServerTimeoutMs?: number;
}

/**
 * The unit's paths are the operator's own, derived from the SAME environment the installer
 * reads — never a system location and never a flag. A preflight that resolved them any other
 * way could pass while the installed unit sat somewhere else.
 */
function unitPaths(env: NodeJS.ProcessEnv): CodexUnitPaths {
	const home = env.HOME?.trim() ?? "";
	const codexHome = env.CODEX_HOME?.trim() || path.join(home, ".codex");
	const dataHome = env.XDG_DATA_HOME?.trim() || path.join(home, ".local", "share");
	const unitRoot = path.join(dataHome, "entwurf", "codex-birth");
	return {
		hooksFile: path.join(codexHome, "hooks.json"),
		helperDir: path.join(unitRoot, "helper"),
		stateFile: path.join(unitRoot, "install-state.json"),
	};
}

const CODEX_MCP_ENV_VARS = [
	"CODEX_HOME",
	"ENTWURF_DIR",
	"PI_CODING_AGENT_DIR",
	"ENTWURF_META_SESSIONS_DIR",
	"ENTWURF_META_MAILBOX_DIR",
	"ENTWURF_META_SENDERS_DIR",
	"ENTWURF_META_RECEIVERS_DIR",
	"TMUX",
	"TMUX_PANE",
] as const;

function isSafeOwnedFile(file: string, expectedUid: number, executable = false): boolean {
	try {
		const stat = fs.lstatSync(file);
		return (
			stat.isFile() &&
			!stat.isSymbolicLink() &&
			stat.uid === expectedUid &&
			(stat.mode & 0o022) === 0 &&
			(!executable || (stat.mode & 0o111) !== 0)
		);
	} catch {
		return false;
	}
}

function isSafeOwnedDir(dir: string, expectedUid: number): boolean {
	try {
		const stat = fs.lstatSync(dir);
		return stat.isDirectory() && !stat.isSymbolicLink() && stat.uid === expectedUid && (stat.mode & 0o022) === 0;
	} catch {
		return false;
	}
}

/**
 * The unit's own ownership state, read as the digest inventory it is. Bytes that merely
 * EXIST prove nothing: the launcher codex is about to exec must be the one this unit
 * published, so every recorded member is compared to its recorded digest before a sibling
 * is opened. No digest is computed for the VENDOR here — that is a different axis below.
 */
function closureDriftedFromState(paths: CodexUnitPaths, expectedUid: number): boolean {
	// The directory holding the state carries the state's authority: anyone who can write it
	// can replace the inventory every digest below is compared against.
	if (!isSafeOwnedDir(path.dirname(paths.stateFile), expectedUid)) return true;
	if (!isSafeOwnedDir(path.dirname(path.dirname(paths.stateFile)), expectedUid)) return true;
	if (!isSafeOwnedFile(paths.stateFile, expectedUid)) return true;
	let state: Record<string, unknown>;
	try {
		state = JSON.parse(fs.readFileSync(paths.stateFile, "utf8")) as Record<string, unknown>;
	} catch {
		return true;
	}
	if (state.schema !== "codex-birth-install-state/v1" || state.status !== "installed") return true;
	if (state.hooksFile !== paths.hooksFile || state.helperDir !== paths.helperDir) return true;
	const digest = (file: string): string | null => {
		try {
			return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
		} catch {
			return null;
		}
	};
	if (typeof state.hooksSha256 !== "string" || digest(paths.hooksFile) !== state.hooksSha256) return true;
	const members = state.helperFiles;
	if (!Array.isArray(members)) return true;
	// Exactly the closure the installer publishes: a short inventory would leave a member
	// nothing compares, which is the same hole as not checking digests at all.
	const named = members.map((raw) => (raw as Record<string, unknown>)?.path);
	const expected = [
		"codex-birth-launch.sh",
		"meta-bridge-hook-codex.ts",
		"lib/meta-session.ts",
		"lib/native-push/codex-ws-client.ts",
		"lib/session-id.js",
		"entwurf-capabilities.json",
	];
	if (named.length !== expected.length) return true;
	if (expected.some((name) => !named.includes(name))) return true;
	if (named.some((name, index) => named.indexOf(name) !== index)) return true;
	for (const raw of members) {
		const member = raw as Record<string, unknown>;
		const rel = member.path;
		if (typeof rel !== "string" || rel.length === 0 || rel.startsWith("/") || rel.split("/").includes("..")) {
			return true;
		}
		if (typeof member.sha256 !== "string" || digest(path.join(paths.helperDir, rel)) !== member.sha256) return true;
	}
	return false;
}

function birthMissing(paths: CodexUnitPaths, expectedUid: number): boolean {
	const launcher = path.join(paths.helperDir, "codex-birth-launch.sh");
	const directories = [
		path.dirname(paths.hooksFile),
		paths.helperDir,
		path.join(paths.helperDir, "lib"),
		path.join(paths.helperDir, "lib", "native-push"),
	];
	if (directories.some((dir) => !isSafeOwnedDir(dir, expectedUid))) return true;
	if (!isSafeOwnedFile(paths.hooksFile, expectedUid)) return true;
	const closure = [
		[launcher, true],
		[path.join(paths.helperDir, "meta-bridge-hook-codex.ts"), false],
		[path.join(paths.helperDir, "lib", "meta-session.ts"), false],
		[path.join(paths.helperDir, "lib", "native-push", "codex-ws-client.ts"), false],
		[path.join(paths.helperDir, "lib", "session-id.js"), false],
		[path.join(paths.helperDir, "entwurf-capabilities.json"), false],
	] as const;
	if (closure.some(([file, executable]) => !isSafeOwnedFile(file, expectedUid, executable))) return true;
	try {
		const parsed = JSON.parse(fs.readFileSync(paths.hooksFile, "utf8")) as Record<string, unknown>;
		const events = (parsed.hooks as Record<string, unknown> | undefined)?.SessionStart;
		if (!Array.isArray(events) || events.length !== 1) return true;
		const group = events[0] as Record<string, unknown>;
		if ("matcher" in group || !Array.isArray(group.hooks) || group.hooks.length !== 1) return true;
		const hook = group.hooks[0] as Record<string, unknown>;
		if (Object.keys(hook).sort().join(",") !== "command,timeout,type") return true;
		if (hook.type !== "command" || hook.command !== `'${launcher}'` || hook.timeout !== 30) return true;
	} catch {
		return true;
	}
	return closureDriftedFromState(paths, expectedUid);
}

/**
 * The vendor's own receipt for THIS declaration, read and never written. The key the vendor
 * writes is `<declaration path>:<event>:<group>:<handler>`; the value must be a
 * `trusted_hash` of the shape `sha256:<64 hex>`. What this asserts is that a receipt EXISTS
 * for our declaration identity — never that the hash is correct, which only the vendor can
 * say, and never by launching Codex to find out.
 */
function trustReceiptMissing(config: Record<string, unknown>, hooksFile: string): boolean {
	const hooks = config.hooks;
	if (hooks == null || typeof hooks !== "object" || Array.isArray(hooks)) return true;
	const state = (hooks as Record<string, unknown>).state;
	if (state == null || typeof state !== "object" || Array.isArray(state)) return true;
	const entry = (state as Record<string, unknown>)[`${hooksFile}:session_start:0:0`];
	if (entry == null || typeof entry !== "object" || Array.isArray(entry)) return true;
	const digest = (entry as Record<string, unknown>).trusted_hash;
	return typeof digest !== "string" || !/^sha256:[0-9a-f]{64}$/.test(digest);
}

function readConfig(env: NodeJS.ProcessEnv): Record<string, unknown> | null {
	try {
		const text = fs.readFileSync(
			path.join(env.CODEX_HOME?.trim() || path.join(env.HOME ?? "", ".codex"), "config.toml"),
			"utf8",
		);
		const value = parse(text);
		return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
	} catch {
		return null;
	}
}

function mcpMissing(config: Record<string, unknown>): boolean {
	const servers = config.mcp_servers;
	if (servers == null || typeof servers !== "object" || Array.isArray(servers)) return true;
	const entry = (servers as Record<string, unknown>)["entwurf-bridge"];
	if (entry == null || typeof entry !== "object" || Array.isArray(entry)) return true;
	const server = entry as Record<string, unknown>;
	if (Object.keys(server).sort().join(",") !== "command,env,env_vars") return true;
	const envVars = server.env_vars;
	if (
		!Array.isArray(envVars) ||
		envVars.length !== CODEX_MCP_ENV_VARS.length ||
		envVars.some((name, index) => name !== CODEX_MCP_ENV_VARS[index])
	)
		return true;
	const env = server.env;
	if (env == null || typeof env !== "object" || Array.isArray(env)) return true;
	const serverEnv = env as Record<string, unknown>;
	return (
		server.command !== "entwurf-bridge" ||
		Object.keys(serverEnv).join(",") !== "ENTWURF_BRIDGE_NATIVE_HOST" ||
		serverEnv.ENTWURF_BRIDGE_NATIVE_HOST !== "codex"
	);
}

function visibleIdentityMissing(config: Record<string, unknown>): boolean {
	const tui = config.tui;
	if (tui == null || typeof tui !== "object" || Array.isArray(tui)) return true;
	const statusLine = (tui as Record<string, unknown>).status_line;
	return !Array.isArray(statusLine) || !statusLine.includes("thread-title");
}

/** `[tui].terminal_title` membership, the exact axis `entwurf doctor-codex-terminal-title`
 * judges. Same shape as `visibleIdentityMissing` and a DIFFERENT key: `status_line` is what a
 * human reads inside the TUI, `terminal_title` is what the multiplexer reports back as
 * `#{pane_title}`. Neither substitutes for the other. */
function callerTitleMissing(config: Record<string, unknown>): boolean {
	const tui = config.tui;
	if (tui == null || typeof tui !== "object" || Array.isArray(tui)) return true;
	const terminalTitle = (tui as Record<string, unknown>).terminal_title;
	return !Array.isArray(terminalTitle) || !terminalTitle.includes("thread-id");
}

/**
 * The CALLER-side capability, pre-mutation and synchronous.
 *
 * Synchronous because it reads one config file and nothing else: there is no app-server axis
 * here and there must not be one — whether the operator's app-server is up says nothing about
 * whether a caller's pane can be found, and asking would make a placement check fail for a
 * delivery reason.
 *
 * Call it only when the anchor will actually be USED — a codex caller that named an explicit
 * `placement` never consults the title, so refusing it for a missing `thread-id` would be a
 * refusal for an unused capability.
 */
export function codexCallerFreshPreflight(env: NodeJS.ProcessEnv): CodexCallerPreflightRejectReason | null {
	const config = readConfig(env);
	if (config === null || callerTitleMissing(config)) return "codex-caller-title-missing";
	return null;
}

/**
 * The launch directory's own capability, pre-mutation and synchronous — and DELIBERATELY NARROWER
 * than the vendor's own decision, because the leaf that decides here reads one TOML file while the
 * vendor asks its app-server. Read this whole comment as the scope statement it is: what follows
 * says what this answers, and then says what it refuses to claim.
 *
 * WHY THE AXIS EXISTS. `[source rust-v0.153.4]` a fresh call always passes `--remote`, so the TUI
 * resolves `AppServerTarget::Remote` and startup ALWAYS runs `check_directory_trust` on the `-C`
 * value (`tui/src/lib.rs:1699-1725`). Nothing on that path consults the approval or sandbox policy
 * (`tui/src/onboarding/directory_trust.rs:33-130`), which is why the
 * `--dangerously-bypass-approvals-and-sandbox` token this argv already carries does NOT cover it:
 * approvals and folder consent are two different gates. A directory with no recorded decision
 * renders the consent screen and blocks, and a blocked TUI has started no turn — no rollout, no
 * birth, no callback, and the caller waits out its whole timeout on a window that is merely
 * waiting to be answered. `[측정 2026-09-16]` the two release-gate runs that failed launched in
 * `…-2zznHl` and `…-kSsoAn`, neither of which had an entry; the two that passed launched in
 * `…-db65N2` and `…-pBXxOJ`, both of which did. Unattended, the failure is silent.
 *
 * THE THREE VENDOR OUTCOMES THIS LEAF MODELS, in the vendor's own order
 * (`tui/src/config_update.rs:290-371`, `ProjectTrustHost::Remote`):
 *
 *   1. A DIRECT decision on the exact cwd starts a turn, and BOTH recorded answers do. `trusted`
 *      returns before any screen (`:346-354`); a saved `untrusted` is explicitly skipped for a
 *      remote target — `if target.uses_remote_workspace() && trust_level == Some(Untrusted) {
 *      continue; }` (`onboarding/directory_trust.rs:94-96`), and `uses_remote_workspace()` is
 *      exactly `matches!(self, Self::Remote { .. })` (`tui/src/lib.rs:307-309`). Refusing a
 *      deliberate `untrusted` would be entwurf inventing a policy the vendor does not have.
 *      The key is the exact cwd — `cwd_keys = vec![cwd_key]` (`:290-296`), no root marker, no git
 *      root, no parent, all three of which exist only on the Local host. `[측정 2026-09-16]`
 *      `~/.codex/config.toml` carried a trusted `/tmp` and still recorded two separate
 *      `/tmp/entwurf-codex-fresh-live-*` entries, one per run a human answered.
 *   2. With NO direct decision, an enabled PROJECT LAYER consents on the directory's behalf
 *      (`trust_level.is_none() && disabled_project.is_none() && project_layers.any(no
 *      disabledReason)` → `Ok(None)`, `:346-354`). Those layers come from the app-server's
 *      `ConfigRead { include_layers: true }` answer, which this leaf does not have. A layer that
 *      is present but DISABLED is a fourth outcome — the vendor preserves an unknown or untrusted
 *      project layer as disabled rather than dropping it, and that path falls through to the
 *      screen — and this leaf cannot tell the two apart either. So wherever a layer could exist at
 *      all it answers `null`, which folds both outcomes into "proceed".
 *   3. With no direct decision and NO layers, a cwd inside an explicitly `untrusted` ancestor is
 *      not a consent screen at all: the remote branch returns an ERROR
 *      (`"remote project directory is inside an explicitly untrusted project; pass the repository
 *      root explicitly with --cd"`, `:357-371`). That is a different failure with a different
 *      repair, so it gets its own reason — answering `Trust` at the child would only reproduce the
 *      same vendor error. Note the vendor's own precondition there is `project_layers.is_empty()`,
 *      which is why this reason is only reachable after step 2 has found no layer anywhere.
 *
 * WHAT THIS LEAF IS FOR, AND WHAT IT IS NOT. It is NOT equivalent to the vendor's judgment and
 * must not be described as asking "the same question": it reads the operator's own `config.toml`,
 * while the vendor reads an EFFECTIVE config — system, managed and cloud layers merged around that
 * user layer (`config/src/loader/mod.rs:258-290`, `:430-460`) — through its app-server.
 *
 * That gap is affordable because NOTHING HERE REFUSES A LAUNCH. `freshCall` prints what this leaf
 * saw and opens the window anyway: the consent screen is self-repairing when a human is there, and
 * one answer teaches the vendor the directory for good. The one caller that treats the answer as a
 * precondition is `smoke-codex-fresh-live`, where nobody is at the keyboard and a named
 * precondition is worth more than a callback timeout — that gate owns one directory, answered
 * once.
 *
 * So read a non-null answer as "the vendor will probably stop here, and this is the repair", never
 * as a verdict. Absence is not evidence either way, and every case this leaf cannot see resolves
 * to `null`.
 */
export function codexLaunchCwdFreshPreflight(
	env: NodeJS.ProcessEnv,
	launchCwd: string,
): CodexLaunchCwdPreflightRejectReason | null {
	// THREE NON-ANSWERS, AND EVERY ONE OF THEM PROCEEDS. Each is a case where this leaf holds no
	// evidence about what the vendor will do, and a refusal without evidence is exactly the false
	// refusal this axis promises not to produce:
	//
	//   - A RELATIVE directory. It cannot match a stored key here, but the vendor does not give up
	//     on one — it asks its app-server for a cwd and joins (`config_update.rs:203-224`), so the
	//     joined path may well be answered. In production this branch is unreachable anyway: the
	//     shared cwd leaf already refuses a non-absolute request as `cwd-not-absolute`, which is a
	//     better reason than anything this axis could give.
	//   - NO READABLE USER CONFIG. A missing `config.toml` is not "no decisions": the vendor loads
	//     an empty user table and merges system, managed and cloud layers around it
	//     (`config/src/loader/mod.rs:258-290`, `:430-460`, `:520-610`), any of which can carry the
	//     decision or the layer that starts the turn.
	//   - NO `projects` TABLE. Same reason: it says the USER layer records nothing, not that the
	//     effective config does.
	if (!path.isAbsolute(launchCwd)) return null;
	const config = readConfig(env);
	if (config === null) return null;
	const projects = config.projects;
	if (projects == null || typeof projects !== "object" || Array.isArray(projects)) {
		return null;
	}
	const table = projects as Record<string, unknown>;
	const levelOf = (key: string): string | null => {
		const entry = table[key];
		if (entry == null || typeof entry !== "object" || Array.isArray(entry)) return null;
		const level = (entry as Record<string, unknown>).trust_level;
		// An unrecognised value leaves `trust_level` as `None` on the vendor side too, and `None`
		// with no project layer is precisely the case that renders the screen.
		return level === "trusted" || level === "untrusted" ? level : null;
	};
	// Outcome 1: a direct decision, either answer.
	if (levelOf(launchCwd) !== null) return null;
	// Outcome 2: a PROJECT LAYER may consent with no entry at all, and this leaf cannot enumerate
	// layers — they come from the app-server's `ConfigRead { include_layers: true }` answer. What
	// it CAN decide is the negative: a `.codex` anywhere from the directory upward is the only
	// place such a layer comes from, so when none exists the vendor's `project_layers` really is
	// empty and the two remaining outcomes below are computable. Where one could exist, answer
	// `null`.
	//
	// EXISTENCE, not ownership, and the weaker predicate is the load-bearing one. The vendor
	// admits a layer on its own terms — an unknown or untrusted one is preserved as a DISABLED
	// layer, not dropped — and none of that consults owner/mode/symlink safety. Asking for a
	// safely-owned directory here would let a layer the vendor sees go unseen by this leaf, which
	// would then synthesise an `untrusted-ancestor` refusal for a launch the vendor was going to
	// run. That is the false refusal this axis must never produce, so the check is the widest
	// thing that still means "a layer could live here".
	//
	// The operator's own CODEX HOME is excluded, and excluding it is what keeps this axis from
	// being a no-op: `~/.codex` is an ancestor of nearly every directory anyone launches a sibling
	// in, and it is the USER config root rather than a project layer — the vendor names those
	// apart (`layer.name.dotCodexFolder` for a project, the home for the user layer). Counting it
	// would answer `null` for every path under `$HOME` and the check would never fire in real use.
	const codexHome = path.resolve(env.CODEX_HOME?.trim() || path.join(env.HOME ?? "", ".codex"));
	for (let dir = launchCwd; ; ) {
		const candidate = path.join(dir, ".codex");
		if (candidate !== codexHome && fs.existsSync(candidate)) return null;
		const parent = path.dirname(dir);
		if (parent === dir) break;
		dir = parent;
	}
	// Outcome 3: no layer anywhere and an explicitly untrusted ancestor — the vendor's own
	// precondition for that branch is exactly `project_layers.is_empty()`, which the loop above
	// has now established. It is reported as its own failure because its repair is to launch at
	// that root, never to answer a prompt at the child.
	//
	// The MATCH IS NOT THE VENDOR'S and is not claimed to be. The vendor compares path URIs
	// (`LegacyAppPathString` → `PathUri::starts_with`, segment-aware, fail-closed on encoded
	// separators); this compares plain strings on a separator boundary. Where the two could
	// disagree — a key or a cwd that is not a plain POSIX path — this answers `undecided` rather
	// than `untrusted-ancestor`. Be exact about what that buys: BOTH are refusals, so this is NOT
	// the launch-permissive direction. What it weakens is the SPECIFIC-ERROR claim — the ancestor
	// reason names another directory as the repair, and naming the wrong one is worse than saying
	// "no decision here". Neither vendor outcome on this branch starts a turn, so the guarantee
	// above is untouched either way.
	const plainPosixPath = (value: string): boolean =>
		!value.includes("%") && !value.includes("\\") && !value.split("/").some((seg) => seg === "." || seg === "..");
	if (plainPosixPath(launchCwd)) {
		for (const key of Object.keys(table)) {
			if (levelOf(key) !== "untrusted" || !plainPosixPath(key)) continue;
			if (launchCwd === key || launchCwd.startsWith(key.endsWith("/") ? key : `${key}/`)) {
				return "codex-launch-cwd-untrusted-ancestor";
			}
		}
	}
	return "codex-launch-cwd-undecided";
}

const DEFAULT_APP_SERVER_TIMEOUT_MS = 5_000;

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
	return new Promise((resolve, reject) => {
		const timer = setTimeout(() => reject(new Error("codex app-server exchange timed out")), timeoutMs);
		promise.then(
			(value) => {
				clearTimeout(timer);
				resolve(value);
			},
			(error) => {
				clearTimeout(timer);
				reject(error);
			},
		);
	});
}

/**
 * A bounded real initialize/liveness exchange over the app-server's own JSON-RPC. The inode
 * check above only proves a socket FILE with the right owner and mode exists — a dead
 * app-server's stale socket a new process has not reclaimed yet passes that check identically
 * to a live one. Only a real connection plus a real `initialize` round trip distinguishes them.
 * Any failure — refused/hung connection, a response that never lands within the bound, or a
 * reply the transport itself rejects — answers identically: not live. This is deliberately not
 * `probeCodexThread`: preflight asks "is the app-server there to talk to", never "is a specific
 * thread loaded", so it carries no thread id and no retry/backoff policy.
 */
async function appServerIsLive(
	socketPath: string,
	openProtocol: CodexProtocolOpener,
	timeoutMs: number,
): Promise<boolean> {
	let protocol: CodexRpcProtocol;
	const opening = openProtocol.open(socketPath);
	try {
		protocol = await withTimeout(opening, timeoutMs);
	} catch {
		// The bound expired (or the connect failed), but a slow open can still LAND afterwards.
		// Nothing else holds that handle, so a late success would leave a live connection to the
		// operator's app-server open for the rest of this process. Close it when it arrives —
		// the answer stays "not live" either way; this only refuses to leak.
		void opening.then(
			(late) => {
				try {
					late.close();
				} catch {
					// best-effort: the socket may already be gone.
				}
			},
			() => {
				// The open failed; there is nothing to close.
			},
		);
		return false;
	}
	try {
		await withTimeout(
			protocol.request("initialize", {
				clientInfo: { name: "entwurf-fresh-preflight", title: "entwurf-fresh-preflight", version: "0" },
				capabilities: { experimentalApi: true, requestAttestation: false },
			}),
			timeoutMs,
		);
		return true;
	} catch {
		return false;
	} finally {
		try {
			protocol.close();
		} catch {
			// best-effort: the socket may already be gone.
		}
	}
}

/**
 * Async because the app-server axis now performs a real bounded protocol exchange, not just an
 * inode check (see `appServerIsLive`). Every other axis stays synchronous filesystem/config
 * work; only the last `await` point can suspend.
 */
export async function codexFreshPreflight(
	env: NodeJS.ProcessEnv,
	deps: CodexPreflightDeps = {},
): Promise<CodexPreflightRejectReason | null> {
	const paths = deps.unitPathsOverride ?? unitPaths(env);
	// A relative root would make the declaration's launcher path — the very string the vendor
	// keys its trust receipt to — depend on this process's cwd.
	if (!path.isAbsolute(paths.hooksFile) || !path.isAbsolute(paths.helperDir) || !path.isAbsolute(paths.stateFile)) {
		return "codex-birth-unit-missing";
	}
	if (birthMissing(paths, deps.operatorUid ?? process.getuid?.() ?? -1)) {
		return "codex-birth-unit-missing";
	}
	const config = readConfig(env);
	// The vendor receipt is a SEPARATE reject from our bytes: perfect bytes the vendor will
	// not run and absent bytes are two different repairs, and folding them would send the
	// operator to the installer for something only they can answer in their own Codex.
	if (config === null || trustReceiptMissing(config, paths.hooksFile)) return "codex-birth-trust-missing";
	if (mcpMissing(config)) return "codex-mcp-hand-missing";
	if (visibleIdentityMissing(config)) return "codex-visible-identity-missing";
	const socketPath = resolveCodexDefaultSocketPath(env);
	const socket = (deps.checkSocket ?? checkCodexSocketFile)(socketPath);
	if (!socket.ok) return "codex-app-server-unavailable";
	const live = await appServerIsLive(
		socketPath,
		deps.openProtocol ?? realCodexProtocolOpener,
		deps.appServerTimeoutMs ?? DEFAULT_APP_SERVER_TIMEOUT_MS,
	);
	return live ? null : "codex-app-server-unavailable";
}
