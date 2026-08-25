/**
 * smoke-mux-fresh-call-live — the ONE axis a deterministic gate cannot reach: a real window, a
 * real runtime, a real first turn, and a real callback arriving on a real inbound surface.
 *
 * OUT of `pnpm check`. Needs `LIVE=1`. Costs two model turns (one pi, one Claude Code).
 *
 * ── Isolate the WRITES, keep the runtimes real ──
 *
 * The obvious fence — redirect HOME and everything under it — is wrong here, and wrongly GREEN
 * is worse than red: a pi with no `PI_CODING_AGENT_DIR` and a Claude with no config dir are
 * unauthenticated runtimes that fail for a reason this smoke is not testing. So the split is:
 *
 *   REAL (runtime-owned)               the authenticated runtime config — the real pi agent dir
 *                                      for Pi, and canonical HOME/optional CLAUDE_CONFIG_DIR for
 *                                      Claude. Native session transcripts remain there as evidence.
 *   FIXTURE (entwurf-owned writes)     XDG roots, the four meta roots, the v2 lock dir, and the
 *                                      working directory. Pi also receives fixture HOME so its
 *                                      control socket cannot touch the operator's directory.
 *
 * Be honest about what that means: this smoke READS the operator's real runtime config, and the
 * two siblings it opens will write their own session transcripts into the real pi agent dir the
 * same way any pi session does. What it must never do is mint a garden record, a control socket,
 * a mailbox or a lock outside the fixture — that is what the proof at the end checks.
 *
 * The siblings inherit the fixture through the private tmux server we start inside it, so their
 * records land in the fixture store too: born, observed, discarded, and the garden never sees
 * them.
 */

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
	assessLauncherCleanup,
	restoreOriginalXdg,
	snapshotClaudeLauncher,
	snapshotOriginalXdg,
	verifyClaudeLauncher,
} from "./lib/claude-launcher-fence.ts";
import { skipLive } from "./lib/live-skip.ts";

const LABEL = "smoke-mux-fresh-call-live";
const CALLBACK_WAIT_MS = 180_000;
const LIVE_MODEL = {
	pi: "openai-codex/gpt-5.6-luna",
	"claude-code": "claude-sonnet-5",
} as const;

// Captured BEFORE any redirect: these name the operator's world and must stay untouched.
const REAL_HOME = os.homedir();
const REAL_PI_AGENT_DIR = process.env.PI_CODING_AGENT_DIR?.trim() || path.join(REAL_HOME, ".pi", "agent");
const ORIGINAL_CLAUDE_CONFIG_DIR = process.env.CLAUDE_CONFIG_DIR?.trim() || null;
const REAL_CLAUDE_CONFIG_DIR = ORIGINAL_CLAUDE_CONFIG_DIR || path.join(REAL_HOME, ".claude");
const REAL_META_SESSIONS =
	process.env.ENTWURF_META_SESSIONS_DIR?.trim() || path.join(REAL_PI_AGENT_DIR, "meta-sessions");
const REAL_CONTROL_DIR = path.join(REAL_HOME, ".pi", "entwurf-control");
// The four XDG roots as the OPERATOR has them — presence and value, captured before any redirect,
// so the real-HOME Claude cell can be given exact operator-env parity (issue #67).
const ORIGINAL_XDG = snapshotOriginalXdg(process.env);

let passed = 0;
function ok(label: string, cond: boolean): void {
	if (!cond) throw new Error(`${LABEL}: FAILED — ${label}`);
	console.log(`  ok    ${label}`);
	passed++;
}

/**
 * The entry SET of a directory we must not write to. A missing directory is a valid answer
 * (ENOENT); anything else — EACCES above all — is a real failure and must not be laundered into
 * "absent", which would turn an unreadable store into a passing proof.
 *
 * This is an ENTRY-SET comparison, not a byte comparison: it detects a record/socket/lock that
 * appeared or vanished, which is exactly the residue class this smoke can create. It does not
 * claim file contents are unchanged.
 */
function entrySet(dir: string): string {
	try {
		return fs.readdirSync(dir).sort().join("\n");
	} catch (err) {
		if ((err as NodeJS.ErrnoException).code === "ENOENT") return "<absent>";
		throw err;
	}
}

function tmux(socket: string, args: string[], env: NodeJS.ProcessEnv): { status: number | null; stdout: string } {
	const r = spawnSync("tmux", ["-S", socket, ...args], { env, encoding: "utf8" });
	return { status: r.status, stdout: (r.stdout ?? "").trim() };
}

function pidIsAlive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch (err) {
		if ((err as NodeJS.ErrnoException).code === "ESRCH") return false;
		throw err;
	}
}

function waitForPidsGone(pids: ReadonlySet<number>, timeoutMs = 10_000): boolean {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		if ([...pids].every((pid) => !pidIsAlive(pid))) return true;
		spawnSync("sleep", ["0.1"]);
	}
	return [...pids].every((pid) => !pidIsAlive(pid));
}

async function main(): Promise<void> {
	if (process.env.LIVE !== "1")
		skipLive(LABEL, "LIVE=1 not set — this smoke opens real windows and spends model turns");
	if (spawnSync("tmux", ["-V"], { encoding: "utf8" }).status !== 0) skipLive(LABEL, "tmux is not installed on PATH");
	if (spawnSync("sh", ["-c", "command -v claude"], { encoding: "utf8" }).status !== 0)
		skipLive(LABEL, "the claude runtime is not on PATH — the fixed claude-code backend cannot be opened");
	if (!fs.existsSync(REAL_PI_AGENT_DIR))
		skipLive(LABEL, `no pi agent dir at ${REAL_PI_AGENT_DIR} — an unauthenticated pi would fail for the wrong reason`);
	if (!fs.existsSync(REAL_CLAUDE_CONFIG_DIR))
		skipLive(
			LABEL,
			`no Claude config dir at ${REAL_CLAUDE_CONFIG_DIR} — an unauthenticated claude would fail likewise`,
		);

	const root = fs.mkdtempSync(path.join(os.tmpdir(), "mux-fresh-call-live-"));
	const scratch = path.join(root, "cwd");
	const beforeRealStore = entrySet(REAL_META_SESSIONS);
	const beforeRealSockets = entrySet(REAL_CONTROL_DIR);
	const originalCwd = process.cwd();
	// FAIL-CLOSED launcher preflight (issue #67): pin the real claude launcher — path, kind, link,
	// resolved target and content — before ANY Claude-capable child starts. Throws if it cannot.
	const launcherSnapshot = snapshotClaudeLauncher({ env: process.env, fixtureRoot: root });

	// ── Every WRITE axis into the fixture; the two auth roots stay real ──────
	const fenced: Record<string, string> = {
		HOME: path.join(root, "home"),
		XDG_CONFIG_HOME: path.join(root, "xdg-config"),
		XDG_DATA_HOME: path.join(root, "xdg-data"),
		XDG_STATE_HOME: path.join(root, "xdg-state"),
		XDG_CACHE_HOME: path.join(root, "xdg-cache"),
		XDG_RUNTIME_DIR: path.join(root, "xdg-runtime"),
		ENTWURF_META_SESSIONS_DIR: path.join(root, "meta-sessions"),
		ENTWURF_META_RECEIVERS_DIR: path.join(root, "meta-receivers"),
		ENTWURF_META_SENDERS_DIR: path.join(root, "meta-senders"),
		ENTWURF_META_MAILBOX_DIR: path.join(root, "meta-mailbox"),
		ENTWURF_V2_LOCK_DIR: path.join(root, "v2-locks"),
	};
	const referenced: Record<string, string> = {
		PI_CODING_AGENT_DIR: REAL_PI_AGENT_DIR,
	};
	for (const dir of Object.values(fenced)) fs.mkdirSync(dir, { recursive: true });
	fs.mkdirSync(scratch, { recursive: true });
	// A runtime dir is a private surface by convention and tmux checks it.
	fs.chmodSync(fenced.XDG_RUNTIME_DIR, 0o700);
	for (const [k, v] of Object.entries(fenced)) process.env[k] = v;
	for (const [k, v] of Object.entries(referenced)) process.env[k] = v;
	delete process.env.CLAUDE_CONFIG_DIR;
	process.chdir(scratch);

	// Import the meta layer only AFTER the redirects — a module that resolved its roots at import
	// time would have captured the operator's.
	const meta = await import("../pi-extensions/lib/meta-session.ts");
	const { freshCall } = await import("../pi-extensions/lib/mux-fresh-call.ts");

	const siblingGids = new Set<string>();
	const siblingPids = new Set<number>();
	const privateSockets = new Set<string>();
	let cleanupError: Error | null = null;
	let runError: unknown = null;
	try {
		ok(
			"fence: every entwurf-owned WRITE root is inside the fixture and none is the operator's home",
			Object.values(fenced).every((d) => d.startsWith(root)) && !Object.values(fenced).includes(REAL_HOME),
		);
		ok(
			"fence: runtime auth roots are real — this smoke tests configured runtimes, not empty ones",
			referenced.PI_CODING_AGENT_DIR === REAL_PI_AGENT_DIR &&
				!referenced.PI_CODING_AGENT_DIR.startsWith(root) &&
				!REAL_CLAUDE_CONFIG_DIR.startsWith(root),
		);
		ok(
			"fence: the meta layer resolved its roots to the fixture, and cwd is the scratch dir",
			meta.defaultMetaSessionsDir().startsWith(root) &&
				meta.defaultMetaMailboxDir().startsWith(root) &&
				process.cwd().startsWith(root),
		);
		ok("fence: XDG_RUNTIME_DIR is 0700", (fs.statSync(fenced.XDG_RUNTIME_DIR).mode & 0o777) === 0o700);

		// ── The caller: a self-fetch citizen whose mailbox we can drain ──────────
		const nativeSessionId = `mux-fresh-call-live-${process.pid}`;
		const caller = meta.upsertMetaSession({
			input: { backend: "claude-code", nativeSessionId, cwd: scratch },
		});
		const callerGid = caller.record.gardenId;
		// A record proves identity; only an ARMED receiver marker makes the mailbox deliverable —
		// without it the callbacks would be refused as mailbox-undeliverable and this smoke would
		// measure nothing.
		meta.writeMetaReceiverMarker({
			gardenId: callerGid,
			backend: "claude-code",
			nativeSessionId,
			ownerPid: process.pid,
			armProvenance: "session-start",
		});
		ok(
			"fixture: the caller citizen was minted INSIDE the fixture store and its mailbox is armed",
			Boolean(callerGid) && caller.path.startsWith(root),
		);

		// ── One private tmux server per backend ──────────────────────────────────
		// Pi needs fixture HOME so its control socket is isolated. Claude needs canonical
		// operator HOME (and the operator's optional CLAUDE_CONFIG_DIR) or it enters first-run
		// onboarding instead of exercising the configured runtime. Separate servers preserve
		// those backend-native environments without adding an env carrier to the product.
		const nonces = new Map<string, string>();
		// Intentional: pi + claude-code only. Copilot clause-7 LIVE is operator-metered
		// and is not a release MUST — do not add `copilot` to this loop (VERIFY.md).
		for (const backend of ["pi", "claude-code"] as const) {
			const socket = path.join(root, `${backend}.sock`);
			privateSockets.add(socket);
			const env = { ...process.env } as NodeJS.ProcessEnv;
			delete env.TMUX;
			delete env.TMUX_PANE;
			if (backend === "claude-code") {
				env.HOME = REAL_HOME;
				// EXACT operator-env parity on the four XDG roots (issue #67): real HOME plus a
				// fixture XDG_DATA_HOME is the measured state in which Claude's self-update rewrote
				// the operator's real launcher into the fixture tree and teardown dangled it. Each
				// variable is restored to its original value; an originally absent one is DELETED,
				// never filled with a canonical default.
				restoreOriginalXdg(env, ORIGINAL_XDG);
				if (ORIGINAL_CLAUDE_CONFIG_DIR) env.CLAUDE_CONFIG_DIR = ORIGINAL_CLAUDE_CONFIG_DIR;
				else delete env.CLAUDE_CONFIG_DIR;
			}
			if (tmux(socket, ["new-session", "-d", "-s", "fixture", "-c", scratch, "-n", "anchor"], env).status !== 0) {
				throw new Error(`${LABEL}: could not start the private ${backend} tmux server at ${socket}`);
			}
			const anchorPane = tmux(socket, ["display-message", "-p", "-t", "fixture:anchor", "#{pane_id}"], env).stdout;
			const inherited: NodeJS.ProcessEnv = { ...env, TMUX: `${socket},0,0`, TMUX_PANE: anchorPane };
			ok(`${backend}: tmux server is a private socket, never the operator's`, String(inherited.TMUX).startsWith(root));

			const result = freshCall(
				{
					backend,
					model: LIVE_MODEL[backend],
					task: "Reply with the single word ACK and then stop. Do not read files.",
					callerGardenId: callerGid,
				},
				inherited,
			);
			ok(`${backend}: launch receipt is ok`, result.ok);
			if (!result.ok) return;
			nonces.set(backend, result.receipt.nonce);
			siblingPids.add(Number(result.receipt.panePid));
			ok(
				`${backend}: the receipt carries tmux coordinates, requested model and nonce, and nothing about delivery`,
				Boolean(
					result.receipt.windowId &&
						result.receipt.paneId &&
						result.receipt.model === LIVE_MODEL[backend] &&
						result.receipt.nonce,
				) && !("gardenId" in result.receipt),
			);
		}

		// The sender envelope rides INSIDE the mailbox body (`  session:     <gid> (…)`) — that line
		// is the whole point of this smoke, so it is parsed rather than assumed. `readMetaInbox`
		// drains, so every arrival must be recorded on the pass that saw it.
		const deadline = Date.now() + CALLBACK_WAIT_MS;
		const arrived = new Map<string, string>();
		while (Date.now() < deadline && arrived.size < nonces.size) {
			for (const msg of meta.readMetaInbox({ gardenId: callerGid }).messages) {
				const sender = /^\s*session:\s+(\S+)/m.exec(msg.body)?.[1] ?? "";
				for (const [backend, nonce] of nonces) if (msg.body.includes(nonce) && sender) arrived.set(backend, sender);
			}
			if (arrived.size < nonces.size) spawnSync("sleep", ["3"]);
		}

		for (const backend of nonces.keys()) {
			const sender = arrived.get(backend);
			ok(
				`${backend}: the nonce came back and its SENDER ENVELOPE carries a garden id — correlation without asking the sibling`,
				Boolean(sender) && /^\d{8}T\d{6}-[0-9a-f]{6}$/.test(String(sender)),
			);
			if (sender) siblingGids.add(sender);
		}
		ok(
			"correlation: the two siblings reported DIFFERENT garden ids — the envelope identifies each one, not the launcher",
			siblingGids.size === arrived.size && !siblingGids.has(callerGid),
		);
		ok(
			"fence: those sibling records live in the FIXTURE store",
			[...siblingGids].every(
				(gid) => fs.existsSync(meta.defaultMetaSessionsDir()) && entrySet(meta.defaultMetaSessionsDir()).includes(gid),
			),
		);
	} catch (err) {
		// Captured, not rethrown here: the teardown below must run and its findings must AGGREGATE
		// with the run error — neither may hide the other.
		runError = err;
	} finally {
		for (const socket of privateSockets) tmux(socket, ["kill-server"], process.env);
		const panesGone = waitForPidsGone(siblingPids);
		process.chdir(originalCwd);
		const problems: string[] = [];
		// Launcher integrity BEFORE fixture removal, on success and failure alike (issue #67).
		// Removal happens only when it is PROVEN non-destructive: the launcher demonstrably does
		// not reference the fixture tree AND every TRACKED launched pane process is proven gone —
		// a live pane could still rewrite the launcher after the check. (Tracked-pane quiescence
		// only; this claims nothing about untracked detached descendants.) An unproven state
		// blocks removal loudly rather than guessing.
		const launcherProblems = verifyClaudeLauncher(launcherSnapshot);
		const cleanup = assessLauncherCleanup(launcherSnapshot);
		for (const p of cleanup.problems) problems.push(`launcher cleanup: ${p}`);
		if (!panesGone) {
			problems.push(
				`tracked sibling pane processes were not proven gone after private tmux teardown: ${[...siblingPids].join(", ")}`,
			);
		}
		if (!cleanup.safeToRemove || !panesGone) {
			problems.push(
				`fixture removal of ${root} is BLOCKED — ${
					cleanup.safeToRemove
						? "tracked pane processes are not proven gone"
						: "the real claude launcher references the fixture tree or could not be proven safe"
				}; resolve the named problems above, then remove the tree by hand`,
			);
		} else {
			fs.rmSync(root, { recursive: true, force: true });
		}
		for (const p of launcherProblems) problems.push(`launcher integrity: ${p}`);
		if (problems.length > 0) cleanupError = new Error(problems.join("\n  "));
	}
	if (runError || cleanupError) {
		const parts: string[] = [];
		if (runError) parts.push(`RUN: ${runError instanceof Error ? runError.message : String(runError)}`);
		if (cleanupError) parts.push(`CLEANUP:\n  ${cleanupError.message}`);
		throw new Error(`${LABEL}: run did not complete cleanly —\n\n${parts.join("\n\n")}`);
	}

	// ── Prove the fence held, by name and by entry set ───────────────────────
	ok(
		"self-fence: the operator's meta-session store has the same entry set as before",
		entrySet(REAL_META_SESSIONS) === beforeRealStore,
	);
	ok(
		"self-fence: the operator's control-socket dir has the same entry set as before",
		entrySet(REAL_CONTROL_DIR) === beforeRealSockets,
	);
	const realStoreNow = entrySet(REAL_META_SESSIONS);
	const realSocketsNow = entrySet(REAL_CONTROL_DIR);
	ok(
		"self-fence: not one fixture sibling garden id appears in the operator's store or leaves a control-socket residue",
		[...siblingGids].every((gid) => !realStoreNow.includes(gid) && !realSocketsNow.includes(gid)),
	);
	ok(
		"self-fence: the real claude launcher, its link and its resolved target are exactly as pinned before launch",
		verifyClaudeLauncher(launcherSnapshot).length === 0,
	);

	console.log(`\n${LABEL}: ${passed} checks passed`);
}

main().catch((err) => {
	console.error(`${LABEL}: ${err instanceof Error ? err.message : String(err)}`);
	process.exit(1);
});
