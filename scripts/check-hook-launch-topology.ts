/**
 * check-hook-launch-topology — #51 gate 1, built AFTER the B/B2 verdict and shaped
 * by it. It is the regression line under the exec-form launch contract.
 *
 * WHY IT COULD NOT BE WRITTEN EARLIER
 *
 * #51 fixed the order on purpose: writing this gate while the shell form was still
 * authorized would have carved the shell-topology assumptions into the test suite,
 * and the migration would then have had to rewrite the gate it was supposed to be
 * judged by. So the cells below encode the winning form, not the search for it.
 *
 * WHAT IT PROVES — the chain from the SHIPPED manifest to real child topology:
 *
 *   hooks.json (exec form, shipped launcher, baked argv)
 *     -> execve with that argv, NO shell anywhere
 *       -> hook-launch.sh `exec`s the payload, so the pid is preserved
 *         -> the hook's parent is the process that stood in for Claude
 *           -> sender + receiver markers are keyed to THAT pid
 *
 * The gate process itself plays Claude: `spawnSync(launcher, argv)` is an execve,
 * exactly what Claude does for an exec-form hook (measured at 2.1.217, #51 B2 —
 * `args` arrive verbatim, a literal `${HOME}` is never expanded, and the hook's
 * parent is Claude). So "markers keyed to process.pid" here means the owner join
 * held with no shell in the path.
 *
 * WHY THE HOST NO LONGER MATTERS. Under the old shell form the topology was a
 * function of (whichever shell the host picked) x (how Claude assembled the command)
 * — bash elides a single simple command, dash forks, and bash itself forks the
 * moment a redirection, pipe, or trailing command appears. Both factors were outside
 * this repo. The two cells that used to drive those shells lived in
 * check-meta-receiver-marker; they are retired rather than moved, because the form
 * they defended is no longer shipped. Marker SEMANTICS stay in that gate.
 *
 * The metacharacter cell is not paranoia: `${CLAUDE_PLUGIN_ROOT}` is substituted into
 * every argv element as a plain string, so a plugin path containing a space, `$`, a
 * backtick, or `;` must survive intact. Under the old shell form that same path was
 * pasted into a command string and would have been word-split or executed — which is
 * why upstream's own docs say to prefer exec form for any hook with a path
 * placeholder.
 */

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

let passed = 0;
function ok(label: string, cond: boolean): void {
	assert.ok(cond, label);
	console.log(`  ok    ${label}`);
	passed++;
}

const REPO_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PLUGIN_SRC = path.join(REPO_DIR, "pi", "meta-bridge", "entwurf-meta-receive");
const LAUNCHER = path.join(PLUGIN_SRC, "scripts", "hook-launch.sh");
const PLACEHOLDER = "${CLAUDE_PLUGIN_ROOT}";

type Leaf = { type?: string; command?: string; args?: string[]; asyncRewake?: boolean; timeout?: number };
const manifest = JSON.parse(readFileSync(path.join(PLUGIN_SRC, "hooks", "hooks.json"), "utf8")) as {
	hooks: Record<string, Array<{ matcher?: string; hooks: Leaf[] }>>;
};
const leafOf = (event: string): Leaf => manifest.hooks[event]?.[0]?.hooks[0] ?? {};
const OWNER_EVENTS = ["SessionStart", "CwdChanged", "UserPromptSubmit"] as const;

// ── 1. the SHIPPED manifest declares exec form through the shipped launcher ──
// Read from the committed template, not from a local install: this is the artifact
// that will be assembled onto every host.
for (const event of [...OWNER_EVENTS, "FileChanged"]) {
	const leaf = leafOf(event);
	ok(`${event}: type is command`, leaf.type === "command");
	ok(`${event}: command is the shipped hook-launch.sh`, leaf.command === `${PLACEHOLDER}/scripts/hook-launch.sh`);
	ok(`${event}: args is a non-empty string array (exec form)`, Array.isArray(leaf.args) && leaf.args.length > 0);
	// The exec form's whole safety property is that nothing is shell-parsed. A shell
	// metacharacter inside our OWN declared command would mean we had quietly gone
	// back to composing a command line.
	ok(
		`${event}: command carries no shell metacharacter`,
		typeof leaf.command === "string" && !/[;&|`$(){}<>*?~!]/.test(leaf.command.replace(PLACEHOLDER, "")),
	);
}
for (const event of OWNER_EVENTS) {
	const args = leafOf(event).args ?? [];
	ok(`${event}: argv is [<baked node>, <baked hook entry>]`, args.length === 2 && args[0] === "__NODE_BIN__");
	ok(`${event}: entry arg is plugin-root relative`, args[1] === `${PLACEHOLDER}/__HOOK_ENTRY__`);
}
{
	const bell = leafOf("FileChanged");
	const bellArgs = bell.args ?? [];
	ok(
		"FileChanged: argv is exactly [<doorbell.sh>]",
		bellArgs.length === 1 && bellArgs[0] === `${PLACEHOLDER}/scripts/doorbell.sh`,
	);
	// asyncRewake exit-2 -> wake was observed at 2.1.217 (#51 B2); keep the declaration
	// bound so a future edit cannot quietly drop the wake path.
	ok("FileChanged: asyncRewake stays declared", bell.asyncRewake === true);
	ok("FileChanged: timeout stays declared", typeof bell.timeout === "number" && bell.timeout > 0);
}

// ── 2. no shell-form regression anywhere in the shipped manifest ─────────────
// The retired form is recognizable by its carrier; assert the whole file is free of
// it rather than only the leaves we happen to read above.
{
	const raw = readFileSync(path.join(PLUGIN_SRC, "hooks", "hooks.json"), "utf8");
	ok("manifest carries no $PPID owner carrier (shell form retired)", !raw.includes("$PPID"));
	ok("manifest carries no bare `exec ` command prefix", !/"command":\s*"[^"]*\bexec\s/.test(raw));
	const everyLeaf = Object.values(manifest.hooks).flatMap((groups) => groups.flatMap((g) => g.hooks));
	ok(
		"every hook leaf in the manifest is exec form (no leaf left behind)",
		everyLeaf.length > 0 && everyLeaf.every((l) => Array.isArray(l.args) && l.args.length > 0),
	);
}

// ── 3. the launcher is the fail-loud for an older Claude's silent args drop ──
// This is the single cell that defends policy A. A Claude below the exec-form floor
// drops `args`, runs `command` alone, and reports exit 0 / success (measured on
// 2.1.138). The launcher receiving zero argv is that event, and it must be loud.
{
	const bare = spawnSync(LAUNCHER, [], { encoding: "utf8", input: "" });
	ok("launcher with EMPTY argv exits non-zero", bare.status !== null && bare.status !== 0);
	ok("launcher with empty argv names the args drop on stderr", /discarded the hook's `args`/.test(bare.stderr));
	ok("launcher with empty argv names the required floor", /2\.1\.217/.test(bare.stderr));
	ok("launcher with empty argv refuses a fallback", /no shell-form fallback/i.test(bare.stderr));
	ok("launcher writes nothing to stdout on refusal (never a hook response)", bare.stdout === "");
}
{
	// The passthrough half: given argv, the launcher must exec it and preserve the
	// pid, so the payload's parent is whoever launched the launcher. Without this the
	// owner join would silently gain a shell process again.
	const probe = spawnSync(LAUNCHER, [process.execPath, "-e", "process.stdout.write(String(process.ppid))"], {
		encoding: "utf8",
	});
	ok("launcher execs its argv (pid preserved: payload.ppid == this gate)", probe.stdout === String(process.pid));

	// …and the SOURCE must still say `exec`. The runtime cell above is the primary
	// evidence and it DOES catch a removed `exec` here — mutation-verified, after a
	// first attempt that only appeared to pass because the mutation had edited the word
	// `exec` inside this very comment instead of the statement. These static cells are
	// defence in depth for the case the runtime cell structurally cannot see: an
	// interpreter that implicitly execs a trailing simple command would satisfy the pid
	// check while the source no longer states the guarantee. bash does exactly that for
	// `bash -c 'cmd'` — the elision #51 measured — so the contract must not rest on
	// which of those shapes a given host's shell treats specially.
	const src = readFileSync(LAUNCHER, "utf8");
	ok('launcher ships an explicit `exec "$@"`', /^exec "\$@"$/m.test(src));
	const lastStatement = src
		.split("\n")
		.map((l) => l.trim())
		.filter((l) => l !== "" && !l.startsWith("#"))
		.at(-1);
	ok('launcher `exec "$@"` is its final statement (nothing runs after it)', lastStatement === 'exec "$@"');
	ok("launcher pins its own interpreter (shebang, not the host's /bin/sh)", /^#!\/usr\/bin\/env bash$/m.test(src));
}

// ── 4. real child topology from the SHIPPED command + argv ──────────────────
// The fixture is a full bundle, not just the hook file: entry + lib closure + a COPY of
// the launcher under scripts/. That matters because the cell must resolve the manifest's
// `command` against the plugin root and spawn THAT — spawning the repo's launcher by a
// constant path would leave the command half of the contract unexercised, which is
// exactly what the metacharacter cell below silently failed to prove in its first
// version (cross-review, 2026-07-22).
function makeBundle(root: string): void {
	mkdirSync(path.join(root, "lib"), { recursive: true });
	mkdirSync(path.join(root, "scripts"), { recursive: true });
	copyFileSync(path.join(REPO_DIR, "pi-extensions", "meta-bridge-hook.ts"), path.join(root, "meta-bridge-hook.ts"));
	copyFileSync(
		path.join(REPO_DIR, "pi-extensions", "lib", "meta-session.ts"),
		path.join(root, "lib", "meta-session.ts"),
	);
	copyFileSync(path.join(REPO_DIR, "pi-extensions", "lib", "session-id.js"), path.join(root, "lib", "session-id.js"));
	const launcher = path.join(root, "scripts", "hook-launch.sh");
	copyFileSync(LAUNCHER, launcher);
	// The exec form names the launcher as the executable, so the +x bit is load-bearing:
	// without it Claude gets ENOEXEC, not a degraded path. The installer chmods it too.
	chmodSync(launcher, 0o755);
}

/** Resolve one manifest element the way Claude does: plain-string substitution, no shell. */
function resolveEl(value: string, pluginRoot: string): string {
	return value
		.replace("__NODE_BIN__", process.execPath)
		.replaceAll(PLACEHOLDER, pluginRoot)
		.replace("__HOOK_ENTRY__", "meta-bridge-hook.ts");
}

/** Env for a hook drive. Every meta root is sandboxed; provenance is NEVER inherited. */
function hookEnv(agentRoot: string, pluginRoot: string): NodeJS.ProcessEnv {
	const env: NodeJS.ProcessEnv = {
		...process.env,
		CLAUDE_PLUGIN_ROOT: pluginRoot,
		PI_CODING_AGENT_DIR: agentRoot,
		ENTWURF_META_SESSIONS_DIR: path.join(agentRoot, "meta-sessions"),
		ENTWURF_META_SENDERS_DIR: path.join(agentRoot, "meta-senders"),
		ENTWURF_META_RECEIVERS_DIR: path.join(agentRoot, "meta-receivers"),
		ENTWURF_META_MAILBOX_DIR: path.join(agentRoot, "meta-mailbox"),
	};
	// Only the launcher may stamp this. If the gate itself were ever run from inside a
	// hook, an inherited token would make the fail-closed cell below pass vacuously.
	delete env.ENTWURF_META_HOOK_LAUNCH;
	return env;
}

function driveHook(label: string, pluginRoot: string, nativeSessionId: string): void {
	const agentRoot = mkdtempSync(path.join(tmpdir(), "psa-hook-topology-"));
	const leaf = leafOf("SessionStart");
	const exe = resolveEl(leaf.command ?? "", pluginRoot);
	const argv = (leaf.args ?? []).map((a) => resolveEl(a, pluginRoot));
	ok(
		`${label}: the executable IS the launcher inside this plugin root (command resolved, not assumed)`,
		exe === path.join(pluginRoot, "scripts", "hook-launch.sh") && existsSync(exe),
	);
	const result = spawnSync(exe, argv, {
		encoding: "utf8",
		input: JSON.stringify({
			hook_event_name: "SessionStart",
			session_id: nativeSessionId,
			transcript_path: path.join(agentRoot, "transcript.jsonl"),
			cwd: agentRoot,
		}),
		env: hookEnv(agentRoot, pluginRoot),
	});
	ok(`${label}: hook exits 0`, result.status === 0);
	ok(`${label}: hook emits watchPaths`, result.stdout.includes("hookSpecificOutput"));

	// THE topology assertion. The gate execve'd the launcher; the launcher exec'd the
	// hook; so the hook's parent is this process. A marker under any other pid would
	// mean a process survived in between.
	const senderPath = path.join(agentRoot, "meta-senders", "claude-code", `${process.pid}.json`);
	ok(`${label}: sender marker keyed to the exec-form owner pid`, existsSync(senderPath));
	const sender = JSON.parse(readFileSync(senderPath, "utf8")) as {
		gardenId: string;
		nativeSessionId: string;
		ownerPid: number;
	};
	ok(
		`${label}: sender marker identity + owner agree`,
		sender.nativeSessionId === nativeSessionId && sender.ownerPid === process.pid,
	);
	const receiverPath = path.join(agentRoot, "meta-receivers", `${sender.gardenId}.json`);
	ok(`${label}: receiver marker exists for the minted garden id`, existsSync(receiverPath));
	const receiver = JSON.parse(readFileSync(receiverPath, "utf8")) as { nativeSessionId: string; ownerPid: number };
	ok(
		`${label}: receiver liveness owner is the same owner pid`,
		receiver.nativeSessionId === nativeSessionId && receiver.ownerPid === process.pid,
	);
}

{
	const plain = mkdtempSync(path.join(tmpdir(), "psa-hook-bundle-"));
	makeBundle(plain);
	driveHook("exec direct topology", plain, "native-exec-direct");
}

// ── 5. a plugin path full of shell metacharacters survives ───────────────────
// The cell upstream's docs ask for ("prefer exec form for any hook that references a
// path placeholder"). It now covers BOTH halves of the manifest: the resolved `command`
// (the launcher's own path) and the resolved `args`. Under the retired shell form this
// path was pasted into a command string and would have been word-split or
// command-substituted; under exec form each element is one opaque argv slot.
{
	const holder = mkdtempSync(path.join(tmpdir(), "psa-hook-meta-"));
	const nasty = path.join(holder, "plug in $HOME `id` ;& dir");
	makeBundle(nasty);
	ok("metachar fixture root really contains space/$/backtick/;&", /[ $`;&]/.test(path.basename(nasty)));
	driveHook("metachar plugin path", nasty, "native-exec-metachar");
}

// ── 6. upgrade mismatch: the NEW hook reached through an OLD cached command ──
// The failure this repo actually shipped into: `install-meta-bridge` replaces the
// artifact, but a Claude session that is ALREADY OPEN keeps invoking the new hook
// through its OLD cached shell-form command. There is no launcher on that path, so the
// hook's parent is whatever the host shell left behind. Trusting `process.ppid`
// unconditionally would key a marker to a transient wrapper and a sender would act on
// it. The launcher's provenance token is what makes this fail CLOSED — the record still
// lands (best-effort, as always), but no presence is claimed that cannot be backed.
{
	const pluginRoot = mkdtempSync(path.join(tmpdir(), "psa-hook-oldcmd-"));
	makeBundle(pluginRoot);
	const agentRoot = mkdtempSync(path.join(tmpdir(), "psa-hook-oldcmd-agent-"));
	const result = spawnSync(process.execPath, [path.join(pluginRoot, "meta-bridge-hook.ts")], {
		encoding: "utf8",
		input: JSON.stringify({
			hook_event_name: "SessionStart",
			session_id: "native-old-cached-command",
			transcript_path: path.join(agentRoot, "transcript.jsonl"),
			cwd: agentRoot,
		}),
		env: hookEnv(agentRoot, pluginRoot),
	});
	ok("upgrade mismatch: hook stays best-effort (exit 0, never breaks session open)", result.status === 0);
	ok(
		"upgrade mismatch: the meta-record still lands",
		readdirSync(path.join(agentRoot, "meta-sessions")).filter((n) => n.endsWith(".meta.json")).length === 1,
	);
	ok("upgrade mismatch: NO sender marker is written", !existsSync(path.join(agentRoot, "meta-senders")));
	ok("upgrade mismatch: NO receiver marker is written", !existsSync(path.join(agentRoot, "meta-receivers")));
	const log = readFileSync(path.join(agentRoot, "meta-bridge-hook.log"), "utf8");
	ok(
		"upgrade mismatch: hook log names the missing exec-launch provenance",
		log.includes("exec-launch provenance missing"),
	);
	// The doctor's hook-log rule treats a LATER arm line as recovery, so the refusal has
	// to be the last word — otherwise "armed watch" would read as recovered.
	ok(
		"upgrade mismatch: the final post-arm line is still ERROR (doctor cannot read it as recovered)",
		log.trimEnd().split("\n").at(-1)?.includes(" ERROR receiver marker skipped") === true,
	);
}

console.log(`\ncheck-hook-launch-topology: ${passed} checks passed`);
