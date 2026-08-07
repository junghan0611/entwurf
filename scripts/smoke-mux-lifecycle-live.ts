/**
 * smoke-mux-lifecycle-live — the PUBLIC-HARNESS lifecycle acceptance for mux.
 *
 * RELEASE MUST. Needs `LIVE=1`. Spends real model turns on the operator's configured runtimes:
 * two pi siblings (one native-provider, one recorded-ACP-provider), each resumed once, plus one
 * Claude Code sibling.
 *
 * ── What this proves that nothing else does ──
 *
 * Every other gate here enters from SOURCE: it calls `freshCall()` or `visibleResume()` directly.
 * That leaves the whole operator circuit unproven — the tool a caller actually reaches, the
 * identity that surface derives for itself, and everything that happens AFTER the sibling names
 * itself. So this gate enters where a caller enters, through a real MCP `tools/call`, and follows
 * one citizen all the way around:
 *
 *   tools/call entwurf_fresh_call   → LAUNCH receipt (tmux coordinates + nonce, nothing else)
 *   the sibling's own first action  → CALLBACK receipt (its garden id, as the sender envelope of
 *                                     the nonce message — never a lookup, never a self-report)
 *   tools/call entwurf_v2 f-a-f     → LIVE SEND receipt (control-socket, into a running session)
 *   tools/call entwurf_resume_call  → REFUSED while the citizen is live, with no window opened
 *   closeWindow(launch handle)      → dormant: pane gone, socket unconnectable, record preserved
 *   tools/call entwurf_v2 f-a-f     → refused honestly, because dormant is unreachable by delivery
 *   tools/call entwurf_resume_call  → RESUME LAUNCH + RESUME OBSERVATION receipts, kept apart
 *   tools/call entwurf_v2 f-a-f     → the resumed citizen recalls the fact from BEFORE the close
 *
 * The receipts are kept SEPARATE and asserted separate: a launch receipt that mentioned the
 * sibling's garden id, or an observation read off a launch, would be exactly the "one step
 * vouching for the next" this rail refuses (docs/mux-launch-rail.md §12).
 *
 * The last step is the one that makes the resume mean anything. A socket answering under the same
 * id proves a process stood up at that address; only a reply carrying a fact from before the
 * window closed proves it is the SAME CONVERSATION. Both provider shapes are driven to that point,
 * because they resolve their launch argv differently — the recorded-ACP shape is the only one that
 * re-injects a bridge extension (#29), and a resume that silently lost its history would look
 * identical from the socket axis.
 *
 * Claude Code runs the same first half and then STOPS where its capability stops: callback id,
 * mailbox delivery, mailbox read receipt — and a resume that is REFUSED as `target-not-pi`, with
 * no window opened and no lock residue after the per-gid coordination lock is released. Only pi
 * stands a control socket up, so only pi has a same-id
 * resume; the refusal is the proof, not an omission.
 *
 * ── Isolate the WRITES, keep the runtimes real ──
 *
 * The obvious fence — redirect HOME and everything under it — is wrong here, and wrongly GREEN is
 * worse than red: a pi with no `PI_CODING_AGENT_DIR` and a Claude with no config dir are
 * unauthenticated runtimes that fail for a reason this gate is not testing. So the split is:
 *
 *   REAL (runtime-owned)            the authenticated runtime config — the real pi agent dir for
 *                                   Pi, and canonical HOME/optional CLAUDE_CONFIG_DIR for Claude.
 *                                   Native session transcripts remain there as evidence.
 *   FIXTURE (entwurf-owned writes)  the four meta roots, the working directory and the tmux
 *                                   servers — for every cell. For the NATIVE pi cell also the XDG
 *                                   roots, the control-socket dir and the v2 lock dir, all of
 *                                   which follow its fixture HOME.
 *
 * The ACP cell is the exception, and it is stated rather than hidden. Its provider spawns `claude`
 * as a child that authenticates from the operator's real home — MEASURED 2026-08-06: under a
 * fenced HOME that turn never reached the model at all, dying with `errorMessage: "Authentication
 * required"`, and pointing CLAUDE_CONFIG_DIR at the real config dir did not change it. So that one
 * cell runs under the REAL home (the same trade `smoke-acp-bundled-mcp-live` already makes), which
 * means its citizen's control socket and per-gid lock appear briefly under the operator's own
 * `~/.pi/entwurf-control` and `~/.pi/entwurf-v2-locks` while the cell runs. The meta store stays
 * fixture, so no garden RECORD is ever minted outside it, and the safety oracle is the end state:
 * all six real roots must hold the entry sets they started with, with no fixture garden id
 * anywhere and no leftover lock for the target.
 *
 * Be honest about what that means, because VERIFY.md says it too: this gate READS the operator's
 * real runtime config, and the siblings it opens write their own session transcripts into the real
 * pi agent dir exactly as any session does — those are not cleaned up, and they are the evidence a
 * resume was real.
 *
 * The invariant is therefore NOT "nothing is written outside the fixture". It is this, per axis:
 *
 *   four meta roots (records, mailbox, receivers, senders)  ALWAYS fixture, every cell
 *   native pi cell — control socket, v2 lock                fixture (its HOME is)
 *   ACP pi cell    — control socket, v2 lock                REAL, transient (its HOME must be)
 *   Claude cell    — runtime HOME real; mailbox + meta      fixture
 *
 * So no garden RECORD is ever minted outside the fixture, and the closing oracle is the end state
 * of SIX real roots — the four meta roots plus `~/.pi/entwurf-control` and
 * `~/.pi/entwurf-v2-locks` — each holding the entry set it started with, with no fixture garden id
 * anywhere. That proof now runs on the failure path too.
 *
 * Every bounded wait here belongs to the HARNESS. The product gets no watcher, no retry and no
 * supervisor out of this file — `entwurf_resume_call`'s own bounded observation is the product's
 * single startup wait, and this gate only reads its receipt.
 */

import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
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

const LABEL = "smoke-mux-lifecycle-live";
const REPO = path.join(import.meta.dirname, "..");
const BRIDGE_LAUNCHER = path.join(REPO, "mcp", "entwurf-bridge", "start.sh");

/** The two pi shapes. They differ in exactly one thing that matters here — whether the record
 * carries `provider=entwurf`, which is what makes the resume argv re-inject the bridge (#29). */
const PI_NATIVE_MODEL = "openai-codex/gpt-5.6-terra";
const PI_ACP_MODEL = "entwurf/claude-sonnet-5";
const CLAUDE_MODEL = "claude-sonnet-5";

// Bounded waits — harness-side only. Each names what it is waiting FOR, so a red run says which
// real-world step never happened rather than "timeout".
const CALLBACK_WAIT_MS = 300_000; // sibling boot + its first turn (the nonce callback). A cold
// Claude Code start loads the operator's plugins before the first turn even begins, so this bound
// is generous on purpose: it must describe a sibling that never called back, not one still booting.
const TRANSCRIPT_WAIT_MS = 180_000; // pi turn_end completing record.transcriptPath
const LIVE_SEND_LANDED_MS = 180_000; // the sent message reaching the sibling's own transcript
const DORMANT_WAIT_MS = 30_000; // pane process exit + socket becoming unconnectable
const RECEIVER_ARM_MS = 120_000; // the Claude sibling's SessionStart arming its mailbox
const RECALL_MS = 240_000; // the resumed session's model actually replying
const CALL_TIMEOUT_MS = 60_000; // an ordinary tools/call round trip
const RESUME_CALL_TIMEOUT_MS = 90_000; // resume_call blocks on its own bounded observation (30s)
const POLL_MS = 500;

/** The scene fact, fixed here so `demo/` can replay the SAME messages without owning a second
 * copy of the logic. The oracles stay machine facts — sender envelopes, rail receipts, records,
 * sockets, transcripts — never pane text. */
const SCENE_FACT = "tempered indigo";

// Captured BEFORE any redirect: these name the operator's world and must stay untouched.
const REAL_HOME = os.homedir();
const REAL_PI_AGENT_DIR = process.env.PI_CODING_AGENT_DIR?.trim() || path.join(REAL_HOME, ".pi", "agent");
const ORIGINAL_CLAUDE_CONFIG_DIR = process.env.CLAUDE_CONFIG_DIR?.trim() || null;
const REAL_CLAUDE_CONFIG_DIR = ORIGINAL_CLAUDE_CONFIG_DIR || path.join(REAL_HOME, ".claude");
const REAL_XDG_DATA_HOME = process.env.XDG_DATA_HOME?.trim() || path.join(REAL_HOME, ".local", "share");
const REAL_XDG_CONFIG_HOME = process.env.XDG_CONFIG_HOME?.trim() || path.join(REAL_HOME, ".config");
const REAL_XDG_STATE_HOME = process.env.XDG_STATE_HOME?.trim() || path.join(REAL_HOME, ".local", "state");
const REAL_XDG_CACHE_HOME = process.env.XDG_CACHE_HOME?.trim() || path.join(REAL_HOME, ".cache");
// The four XDG roots as the OPERATOR has them — presence and value, captured before any redirect,
// so the real-HOME Claude Code cell can be given exact operator-env parity (issue #67). Distinct
// from the REAL_XDG_* constants above, which canonicalise an absent variable to its default path:
// parity restores absence AS absence.
const ORIGINAL_XDG = snapshotOriginalXdg(process.env);
const REAL_META_ROOTS: Record<string, string> = {
	"meta-sessions": process.env.ENTWURF_META_SESSIONS_DIR?.trim() || path.join(REAL_PI_AGENT_DIR, "meta-sessions"),
	"meta-mailbox": process.env.ENTWURF_META_MAILBOX_DIR?.trim() || path.join(REAL_PI_AGENT_DIR, "meta-mailbox"),
	"meta-receivers": process.env.ENTWURF_META_RECEIVERS_DIR?.trim() || path.join(REAL_PI_AGENT_DIR, "meta-receivers"),
	"meta-senders": process.env.ENTWURF_META_SENDERS_DIR?.trim() || path.join(REAL_PI_AGENT_DIR, "meta-senders"),
	"entwurf-control": path.join(REAL_HOME, ".pi", "entwurf-control"),
	// The per-gid lock dir is a HOMEDIR CONSTANT, not an env knob (entwurf-v2-lock.ts computes it
	// from `os.homedir()` at import). It is an entwurf-owned write root like the others, so the
	// operator's copy is proven untouched here too.
	"entwurf-v2-locks": path.join(REAL_HOME, ".pi", "entwurf-v2-locks"),
};
const CLAUDE_PLUGIN_HOOKS = path.join(
	REAL_XDG_DATA_HOME,
	"entwurf",
	"meta-bridge",
	".assembled",
	"entwurf-meta-receive",
	"hooks",
	"hooks.json",
);

let passed = 0;
/** Every receipt this run collected, kept apart by name — see the header. */
const receipts: Record<string, string> = {};

function ok(label: string, cond: boolean, detail?: string): void {
	if (!cond) throw new Error(`${LABEL}: FAILED — ${label}${detail ? `\n${detail}` : ""}`);
	console.log(`  ok    ${label}`);
	passed++;
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * The entry SET of a directory we must not write to. A missing directory is a valid answer
 * (ENOENT); anything else — EACCES above all — is a real failure and must not be laundered into
 * "absent", which would turn an unreadable store into a passing proof.
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

function onPath(cmd: string): boolean {
	return spawnSync("sh", ["-c", `command -v ${cmd}`], { encoding: "utf8" }).status === 0;
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

async function waitForPidsGone(pids: ReadonlySet<number>, timeoutMs = 10_000): Promise<boolean> {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		if ([...pids].every((pid) => !pidIsAlive(pid))) return true;
		await sleep(100);
	}
	return [...pids].every((pid) => !pidIsAlive(pid));
}

/** Poll a predicate until it holds or the bound expires. Harness-only (see the header). */
async function waitFor(what: string, timeoutMs: number, probe: () => boolean | Promise<boolean>): Promise<boolean> {
	const deadline = Date.now() + timeoutMs;
	for (;;) {
		if (await probe()) return true;
		if (Date.now() >= deadline) {
			console.log(`  ..    gave up waiting for ${what} after ${timeoutMs}ms`);
			return false;
		}
		await sleep(POLL_MS);
	}
}

function sha256(file: string): string {
	return createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

// ── the public ingress: a real MCP client over stdio ────────────────────────
//
// Deliberately the SHIPPED launcher rather than an in-process import: a caller reaches these
// tools on a separate process whose identity it must derive for itself, and that derivation is
// half of what this gate is about.
class BridgeClient {
	private readonly child: ChildProcess;
	private readonly replies = new Map<number, any>();
	private buf = "";
	private stderr = "";
	private nextId = 1;

	constructor(env: NodeJS.ProcessEnv) {
		this.child = spawn(BRIDGE_LAUNCHER, [], { stdio: ["pipe", "pipe", "pipe"], env });
		this.child.stdout?.on("data", (d) => {
			this.buf += d.toString();
			const lines = this.buf.split("\n");
			this.buf = lines.pop() ?? "";
			for (const line of lines) {
				const t = line.trim();
				if (!t) continue;
				try {
					const msg = JSON.parse(t);
					if (typeof msg?.id === "number") this.replies.set(msg.id, msg);
				} catch {
					/* not a JSON-RPC frame; the launcher keeps chatter on stderr */
				}
			}
		});
		this.child.stderr?.on("data", (d) => {
			this.stderr += d.toString();
		});
	}

	private async request(body: Record<string, unknown>, what: string, timeoutMs: number): Promise<any> {
		const id = this.nextId++;
		this.child.stdin?.write(`${JSON.stringify({ jsonrpc: "2.0", id, ...body })}\n`);
		const deadline = Date.now() + timeoutMs;
		for (;;) {
			const got = this.replies.get(id);
			if (got) return got;
			if (Date.now() > deadline) {
				throw new Error(`${LABEL}: timeout waiting for ${what}\n--- bridge stderr ---\n${this.stderr.slice(-2000)}`);
			}
			await sleep(50);
		}
	}

	async toolNames(): Promise<string[]> {
		const listed = await this.request({ method: "tools/list" }, "tools/list", CALL_TIMEOUT_MS);
		return ((listed?.result?.tools ?? []) as { name?: string }[]).map((t) => t?.name ?? "");
	}

	/** One `tools/call`, returned as the operator sees it: rendered text plus the error flag. */
	async call(
		name: string,
		args: Record<string, unknown>,
		timeoutMs = CALL_TIMEOUT_MS,
	): Promise<{ text: string; isError: boolean }> {
		const res = await this.request(
			{ method: "tools/call", params: { name, arguments: args } },
			`tools/call ${name}`,
			timeoutMs,
		);
		const text: string = res?.result?.content?.[0]?.text ?? JSON.stringify(res);
		return { text, isError: res?.result?.isError === true };
	}

	stderrTail(): string {
		return this.stderr.slice(-2000);
	}

	close(): void {
		try {
			this.child.kill("SIGTERM");
		} catch {
			/* already gone */
		}
	}
}

// ── parsing the rendered receipts ───────────────────────────────────────────
// Parsed, never assumed: these are the operator-visible texts, so reading them the way an
// operator would is part of what is being accepted.

interface Coordinates {
	windowId: string;
	windowIndex: string;
	sessionId: string;
	paneId: string;
	panePid: string;
}

function parseCoordinates(text: string, what: string): Coordinates {
	const win = /^\s*window:\s+(@\d+) \(index (\d+)\) in session (\$\d+)/m.exec(text);
	const pane = /^\s*pane:\s+(%\d+) pid (\d+)/m.exec(text);
	if (!win || !pane) throw new Error(`${LABEL}: could not read ${what} tmux coordinates\n--- receipt ---\n${text}`);
	return {
		windowId: win[1] as string,
		windowIndex: win[2] as string,
		sessionId: win[3] as string,
		paneId: pane[1] as string,
		panePid: pane[2] as string,
	};
}

function parseNonce(text: string): string {
	const nonce = /^\s*nonce:\s+(\S+)/m.exec(text);
	if (!nonce) throw new Error(`${LABEL}: could not read the launch nonce\n--- receipt ---\n${text}`);
	return nonce[1] as string;
}

const GARDEN_ID = /^\d{8}T\d{6}-[0-9a-f]{6}$/;

async function main(): Promise<void> {
	// ── prerequisites: every one is a SKIP (97), never a red for a host that was never
	// provisioned for this axis. `--cut` is what turns a skip into a blocked release.
	if (process.env.LIVE !== "1") skipLive(LABEL, "LIVE=1 not set — this gate opens real windows and spends model turns");
	if (spawnSync("tmux", ["-V"], { encoding: "utf8" }).status !== 0) skipLive(LABEL, "tmux is not installed on PATH");
	if (!onPath("pi")) skipLive(LABEL, "the pi runtime is not on PATH — the fixed pi backend cannot be opened");
	if (!onPath("claude"))
		skipLive(LABEL, "the claude runtime is not on PATH — the fixed claude-code backend cannot be opened");
	if (!fs.existsSync(REAL_PI_AGENT_DIR))
		skipLive(LABEL, `no pi agent dir at ${REAL_PI_AGENT_DIR} — an unauthenticated pi would fail for the wrong reason`);
	if (!fs.existsSync(REAL_CLAUDE_CONFIG_DIR))
		skipLive(
			LABEL,
			`no Claude config dir at ${REAL_CLAUDE_CONFIG_DIR} — an unauthenticated claude would fail likewise`,
		);
	{
		// The pi siblings are launched with the fixed argv `pi <prompt> --entwurf-control --model …`,
		// so the extension must come from the operator's own pi install. Without it the window
		// opens, no record is born, and the callback never arrives — a timeout that says nothing
		// about the rail under test.
		const settingsPath = path.join(REAL_PI_AGENT_DIR, "settings.json");
		let registered = false;
		try {
			const parsed = JSON.parse(fs.readFileSync(settingsPath, "utf8")) as { packages?: unknown };
			registered =
				Array.isArray(parsed.packages) && parsed.packages.some((p) => typeof p === "string" && p.includes("entwurf"));
		} catch {
			registered = false;
		}
		if (!registered)
			skipLive(
				LABEL,
				`${settingsPath} does not register the entwurf pi package — a fresh 'pi --entwurf-control' would open ` +
					"without the extension and never become a citizen. Run './run.sh setup <project>' first.",
			);
	}
	if (!fs.existsSync(CLAUDE_PLUGIN_HOOKS))
		skipLive(
			LABEL,
			`the Claude meta-bridge plugin is not installed (${CLAUDE_PLUGIN_HOOKS} missing) — a fresh Claude sibling ` +
				"would never arm its mailbox, so the mailbox axis would fail for an install reason. Run './run.sh setup <project>' first.",
		);
	if (!fs.existsSync(BRIDGE_LAUNCHER)) skipLive(LABEL, `the bridge launcher is missing at ${BRIDGE_LAUNCHER}`);

	const root = fs.mkdtempSync(path.join(os.tmpdir(), "mux-lifecycle-live-"));
	const scratch = path.join(root, "cwd");
	const beforeRealRoots: Record<string, string> = {};
	for (const [name, dir] of Object.entries(REAL_META_ROOTS)) beforeRealRoots[name] = entrySet(dir);
	const originalCwd = process.cwd();
	// FAIL-CLOSED launcher preflight (issue #67): pin the real claude launcher — path, kind, link,
	// resolved target and content — before ANY Claude-capable child starts. Both the Claude Code
	// cell and the ACP pi cell (whose provider spawns `claude`) are downstream of this pin.
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
	};
	// NOT an env axis: `ENTWURF_V2_LOCK_DIR` is a constant the lock module derives from
	// `os.homedir()` when it is imported. Setting an env var of that name would look like a fence
	// and fence nothing — the earlier version of this file did exactly that and then checked the
	// directory the product never writes to, so "no lock residue" was a claim about an empty
	// directory nobody used. The fixture HOME above is what actually moves it.

	const referenced: Record<string, string> = { PI_CODING_AGENT_DIR: REAL_PI_AGENT_DIR };
	for (const dir of Object.values(fenced)) fs.mkdirSync(dir, { recursive: true });
	fs.mkdirSync(scratch, { recursive: true });
	fs.chmodSync(fenced.XDG_RUNTIME_DIR as string, 0o700);
	for (const [k, v] of Object.entries(fenced)) process.env[k] = v;
	for (const [k, v] of Object.entries(referenced)) process.env[k] = v;
	delete process.env.CLAUDE_CONFIG_DIR;
	// A pi carrier inherited from whatever opened THIS process would outrank the sender marker
	// below and send the bridge children out under someone else's identity.
	delete process.env.PI_SESSION_ID;
	delete process.env.PI_AGENT_ID;
	delete process.env.ENTWURF_META_SENDER_MARKER;
	process.chdir(scratch);

	// Import the product layers only AFTER the redirects — a module that resolved its roots at
	// import time (meta roots, the control-socket dir) would have captured the operator's.
	const meta = await import("../pi-extensions/lib/meta-session.ts");
	const { closeWindow } = await import("../pi-extensions/lib/mux-placement.ts");
	const { inspectControlSocketPath, mapInspectionToLiveness, controlSocketPath } = await import(
		"../pi-extensions/lib/socket-discovery.ts"
	);
	const { probeSocketLiveness } = await import("../pi-extensions/lib/socket-probe.ts");
	const { ENTWURF_V2_LOCK_DIR: lockDirUnderTest } = await import("../pi-extensions/lib/entwurf-v2-lock.ts");

	/** Where a CELL's citizen keeps its control socket and its per-gid lock. These are HOME-derived
	 * constants with no env override, so they follow whichever HOME that cell's tmux server runs
	 * under — and the two cells deliberately run under different ones (see `CELL_ENV`). A single
	 * imported constant would describe only this harness process and would silently claim the ACP
	 * cell's roots as well. */
	interface CellRoots {
		home: string;
		controlDir: string;
		lockDir: string;
	}
	const cellRoots = (home: string): CellRoots => ({
		home,
		controlDir: path.join(home, ".pi", "entwurf-control"),
		lockDir: path.join(home, ".pi", "entwurf-v2-locks"),
	});
	/** The native pi cell is fully fenced: fixture HOME isolates its socket and its lock.
	 *
	 * The ACP cell cannot be. Its provider spawns `claude` as a child, and that child authenticates
	 * from the operator's real home — MEASURED 2026-08-06: under a fenced HOME the ACP turn never
	 * reached the model at all, dying with `errorMessage: "Authentication required"`, and pointing
	 * `CLAUDE_CONFIG_DIR` at the real config dir did not change it. So this cell runs under the
	 * REAL home, the same trade `smoke-acp-bundled-mcp-live` already makes, and its control socket
	 * and per-gid lock live briefly under the operator's own `~/.pi/` while it runs. The meta store,
	 * the working directory and the tmux server stay fixture. The safety oracle is the end state:
	 * all six real roots must have the entry sets they started with, with no fixture garden id and
	 * no leftover lock. */
	const NATIVE_ROOTS = cellRoots(fenced.HOME as string);
	const ACP_ROOTS = cellRoots(REAL_HOME);

	/** The decider's OWN liveness verdict for a garden id, asked the same way it asks — against the
	 * control directory THAT CELL's citizen actually uses. */
	async function socketState(gid: string, controlDir: string): Promise<string> {
		const p = controlSocketPath(gid, controlDir);
		const mapped = await mapInspectionToLiveness(await inspectControlSocketPath(p), probeSocketLiveness);
		return "addressConflict" in mapped ? "address-conflict" : mapped.liveness;
	}

	const siblingGids = new Set<string>();
	const panePids = new Set<number>();
	const privateSockets = new Set<string>();
	const bridges: BridgeClient[] = [];
	let runError: unknown = null;
	try {
		ok(
			"fence: every entwurf-owned WRITE root is inside the fixture and none is the operator's home",
			Object.values(fenced).every((d) => d.startsWith(root)) && !Object.values(fenced).includes(REAL_HOME),
		);
		ok(
			"fence: runtime auth roots are real — this gate accepts configured runtimes, not empty ones",
			referenced.PI_CODING_AGENT_DIR === REAL_PI_AGENT_DIR &&
				!(referenced.PI_CODING_AGENT_DIR as string).startsWith(root) &&
				!REAL_CLAUDE_CONFIG_DIR.startsWith(root),
		);
		ok(
			"fence: the product layers resolved their roots to the fixture, and cwd is the scratch dir",
			meta.defaultMetaSessionsDir().startsWith(root) &&
				meta.defaultMetaMailboxDir().startsWith(root) &&
				controlSocketPath("probe").startsWith(root) &&
				lockDirUnderTest.startsWith(root) &&
				process.cwd().startsWith(root),
			`--- lock dir the product resolved ---\n${lockDirUnderTest}`,
		);
		ok(
			"fence: for THIS process and the fixture-HOME cell, the lock directory the product resolved is the fixture one — asserted against the module's own constant, because an env var of that name is read by nothing. It says nothing about the ACP cell, whose child runs under the real home in its own process and is judged by the real-root entry sets at the end instead",
			lockDirUnderTest === NATIVE_ROOTS.lockDir,
		);
		ok("fence: XDG_RUNTIME_DIR is 0700", (fs.statSync(fenced.XDG_RUNTIME_DIR as string).mode & 0o777) === 0o700);

		// ── The caller: a self-fetch citizen the bridge can recognise as its own owner ──
		const nativeSessionId = `mux-lifecycle-live-${process.pid}`;
		const caller = meta.upsertMetaSession({ input: { backend: "claude-code", nativeSessionId, cwd: scratch } });
		const callerGid = caller.record.gardenId;
		meta.writeMetaReceiverMarker({
			gardenId: callerGid,
			backend: "claude-code",
			nativeSessionId,
			ownerPid: process.pid,
			armProvenance: "session-start",
		});
		const senderMarkerPath = meta.writeMetaSenderMarker({
			backend: "claude-code",
			gardenId: callerGid,
			nativeSessionId,
			cwd: scratch,
			ownerPid: process.pid,
		});
		ok(
			"fixture: the caller citizen was minted INSIDE the fixture store, with an armed mailbox and a sender marker",
			Boolean(callerGid) && caller.path.startsWith(root) && senderMarkerPath.startsWith(root),
		);

		/** Drain the caller's inbox until the nonce comes back, and return the SENDER ENVELOPE
		 * garden id that rode with it. That line is the entire correlation contract, so it is
		 * parsed rather than assumed. `readMetaInbox` drains, so every arrival must be recorded
		 * on the pass that saw it. */
		async function awaitCallbackSender(nonce: string, timeoutMs: number): Promise<string | null> {
			let sender: string | null = null;
			await waitFor(`the ${nonce} callback`, timeoutMs, () => {
				for (const msg of meta.readMetaInbox({ gardenId: callerGid }).messages) {
					const from = /^\s*session:\s+(\S+)/m.exec(msg.body)?.[1] ?? "";
					if (msg.body.includes(nonce) && from) sender = from;
				}
				return sender !== null;
			});
			return sender;
		}

		/** One private tmux server per CELL, plus the client env that anchors into it. */
		function startPrivateServer(
			cell: string,
			backend: "pi" | "claude-code",
			roots: CellRoots = NATIVE_ROOTS,
		): {
			socket: string;
			serverPid: string;
			env: NodeJS.ProcessEnv;
		} {
			const socket = path.join(root, `${cell}.sock`);
			privateSockets.add(socket);
			const serverEnv = { ...process.env } as NodeJS.ProcessEnv;
			delete serverEnv.TMUX;
			delete serverEnv.TMUX_PANE;
			// Pi keeps fixture HOME so its control socket is isolated. Claude needs canonical
			// operator HOME (and the operator's optional CLAUDE_CONFIG_DIR) or it enters first-run
			// onboarding instead of exercising the configured runtime. A tmux window inherits the
			// SERVER's environment, so separate servers preserve those backend-native environments
			// without adding an env carrier to the product.
			// A cell whose runtime authenticates from the operator's home gets it — Claude Code
			// directly, and the ACP-backed pi cell because its provider spawns `claude`. Everything
			// else about those cells stays fixture: meta store, cwd, tmux server.
			if (roots.home === REAL_HOME) {
				serverEnv.HOME = REAL_HOME;
				// EXACT parity with the shipped focused smoke, which is green on this axis: when the
				// operator has no CLAUDE_CONFIG_DIR, the variable is DELETED rather than set to the
				// canonical path. "Same directory either way" is a guess about how the runtime reads
				// its config; the working control does not set it, so neither does this.
				if (ORIGINAL_CLAUDE_CONFIG_DIR) serverEnv.CLAUDE_CONFIG_DIR = ORIGINAL_CLAUDE_CONFIG_DIR;
				else delete serverEnv.CLAUDE_CONFIG_DIR;
				// The ACP cell additionally needs the real XDG roots: its provider resolves the
				// bridged runtime through them — a MEASURED requirement, canonicalised paths and
				// all, preserved as-is. The Claude Code cell instead gets EXACT operator-env parity
				// on those four variables (issue #67): real HOME plus a fixture XDG_DATA_HOME was
				// the state in which Claude's self-update rewrote the operator's real launcher into
				// the fixture tree and teardown dangled it. Parity restores each original value and
				// DELETES an originally absent variable — not the canonical-path widening that once
				// turned this working cell into a failing one.
				if (backend === "pi") {
					serverEnv.XDG_CONFIG_HOME = REAL_XDG_CONFIG_HOME;
					serverEnv.XDG_DATA_HOME = REAL_XDG_DATA_HOME;
					serverEnv.XDG_STATE_HOME = REAL_XDG_STATE_HOME;
					serverEnv.XDG_CACHE_HOME = REAL_XDG_CACHE_HOME;
				} else {
					restoreOriginalXdg(serverEnv, ORIGINAL_XDG);
				}
			}
			if (tmux(socket, ["new-session", "-d", "-s", "fixture", "-c", scratch, "-n", "anchor"], serverEnv).status !== 0) {
				throw new Error(`${LABEL}: could not start the private ${cell} tmux server at ${socket}`);
			}
			const anchorPane = tmux(
				socket,
				["display-message", "-p", "-t", "fixture:anchor", "#{pane_id}"],
				serverEnv,
			).stdout;
			const serverPid = tmux(socket, ["display-message", "-p", "-t", "fixture:anchor", "#{pid}"], serverEnv).stdout;
			const clientEnv: NodeJS.ProcessEnv = {
				...process.env,
				// The BRIDGE CHILD only needs the real home when it must resolve a citizen's control
				// SOCKET there — that is the ACP pi cell, whose socket follows its real-home runtime.
				// Claude Code is reached through the meta-mailbox, which is env-addressed and fixture,
				// so that cell's bridge child stays fenced exactly as it was before this split.
				...(roots.home === REAL_HOME && backend === "pi" ? { HOME: REAL_HOME } : {}),
				TMUX: `${socket},0,0`,
				TMUX_PANE: anchorPane,
				ENTWURF_META_SENDER_MARKER: senderMarkerPath,
			};
			ok(
				`${cell}: the tmux anchor is a private socket, never the operator's`,
				String(clientEnv.TMUX).startsWith(root) && serverPid.length > 0,
			);
			return { socket, serverPid, env: clientEnv };
		}

		/** How many windows this server holds. Used to prove a REFUSED resume mutated nothing —
		 * "no window was opened" is a claim about the server, not about the response text. */
		function windowCount(socket: string, env: NodeJS.ProcessEnv): number {
			const listed = tmux(socket, ["list-windows", "-a", "-F", "#{window_id}"], env);
			return listed.stdout.split("\n").filter((l) => l.trim()).length;
		}

		/** The pane's ACTUAL start directory, asked by stable pane id in a SEPARATE query.
		 * `pane_start_path` rather than `pane_current_path`: measured 2026-08-06, the row a
		 * `new-window -P -F` prints is emitted BEFORE the child chdirs, so current-path there
		 * still reports the caller's cwd. Pane TEXT is never an oracle anywhere in this gate. */
		function paneStartPath(socket: string, paneId: string, env: NodeJS.ProcessEnv): string {
			return tmux(socket, ["display-message", "-p", "-t", paneId, "#{pane_start_path}"], env).stdout;
		}

		/** Locks left behind in the root THAT CELL uses. A lock is per-gid, so a shared operator
		 * root is checked for THIS target rather than emptiness — other citizens may legitimately
		 * hold their own. */
		function lockResidue(roots: CellRoots, targetGid?: string): string[] {
			const all = fs.existsSync(roots.lockDir) ? fs.readdirSync(roots.lockDir) : [];
			return roots.home === REAL_HOME && targetGid ? all.filter((f) => f.includes(targetGid)) : all;
		}

		// ════════════════════════════════════════════════════════════════════
		// The pi lifecycle, run once per PROVIDER SHAPE
		// ════════════════════════════════════════════════════════════════════
		async function runPiCell(cell: string, model: string, full: boolean, roots: CellRoots): Promise<void> {
			const srv = startPrivateServer(cell, "pi", roots);
			const bridge = new BridgeClient(srv.env);
			bridges.push(bridge);

			if (full) {
				const tools = await bridge.toolNames();
				ok(
					"public ingress: the real bridge boots and registers entwurf_fresh_call, entwurf_v2, entwurf_inbox_read and entwurf_resume_call",
					["entwurf_fresh_call", "entwurf_v2", "entwurf_inbox_read", "entwurf_resume_call"].every((t) =>
						tools.includes(t),
					),
					`--- tools ---\n${tools.join(",") || "(none)"}\n--- bridge stderr ---\n${bridge.stderrTail()}`,
				);
			}

			// ── receipt 1/4: LAUNCH ─────────────────────────────────────────
			const launch = await bridge.call("entwurf_fresh_call", {
				backend: "pi",
				model,
				task:
					`Remember this fact for the rest of this session: the color is ${SCENE_FACT}. ` +
					"Then reply with the single word ACK and stop. Do not read files.",
			});
			ok(
				`${cell}: tools/call entwurf_fresh_call returned a launch receipt through the public surface`,
				!launch.isError,
				`--- response ---\n${launch.text}\n--- bridge stderr ---\n${bridge.stderrTail()}`,
			);
			receipts[`${cell}/1-launch`] = launch.text;
			const coords = parseCoordinates(launch.text, "the launch receipt's");
			const nonce = parseNonce(launch.text);
			panePids.add(Number(coords.panePid));
			ok(
				`${cell}: the launch receipt carries tmux coordinates, the requested model and the nonce, and says out loud that it is not delivery`,
				launch.text.includes(model) && launch.text.includes("LAUNCH receipt") && launch.text.includes("does NOT mean"),
				`--- receipt ---\n${launch.text}`,
			);

			// ── receipt 2/4: CALLBACK IDENTITY ──────────────────────────────
			const gid = await awaitCallbackSender(nonce, CALLBACK_WAIT_MS);
			ok(
				`${cell}: the nonce came back and its SENDER ENVELOPE carries a garden id — correlation without asking the sibling`,
				gid !== null && GARDEN_ID.test(gid),
				`--- launch receipt ---\n${launch.text}`,
			);
			const citizen = gid as string;
			siblingGids.add(citizen);
			receipts[`${cell}/2-callback-identity`] = `${citizen} (sender envelope of ${nonce})`;
			ok(
				`${cell}: the launch receipt never named that garden id — the address came from the callback, not from the launch`,
				!launch.text.includes(citizen) && citizen !== callerGid,
			);
			ok(
				`${cell}: the sibling's record is in the FIXTURE store and its control socket is ALIVE`,
				meta.metaRecordExistsByGardenId(citizen) && (await socketState(citizen, roots.controlDir)) === "alive",
			);

			// The record's transcriptPath is completed at turn_end, and it is the resume target —
			// so this wait is also the proof the sibling's first turn really finished.
			let transcript = "";
			let recordCwd = "";
			const gotTranscript = await waitFor(`the ${cell} record to carry a transcriptPath`, TRANSCRIPT_WAIT_MS, () => {
				const record = meta.readMetaIdentityByGardenId(citizen);
				if (record.transcriptPath && fs.existsSync(record.transcriptPath)) {
					transcript = record.transcriptPath;
					recordCwd = record.cwd ?? "";
					return true;
				}
				return false;
			});
			ok(
				`${cell}: the sibling completed a turn and its record now names a transcript (the resume target)`,
				gotTranscript && transcript.length > 0,
			);

			// ── receipt 3/4: LIVE SEND ──────────────────────────────────────
			const liveNeedle = `MUX_LIVE_SEND_${nonce.slice(-10)}`;
			const send = await bridge.call("entwurf_v2", {
				target: citizen,
				intent: "fire-and-forget",
				mode: "follow_up",
				message: `Scene 2 (${liveNeedle}): you were told a color. Reply with that color only, then stop.`,
			});
			ok(
				`${cell}: tools/call entwurf_v2 fire-and-forget delivered on the CONTROL-SOCKET rail to the fresh citizen`,
				!send.isError && send.text.includes("control-socket") && send.text.includes("sent"),
				`--- response ---\n${send.text}\n--- bridge stderr ---\n${bridge.stderrTail()}`,
			);
			receipts[`${cell}/3-live-send`] = send.text;
			ok(
				`${cell}: the live send physically landed in the sibling's OWN transcript — not just an ack from the rail`,
				await waitFor("the sent message in the transcript", LIVE_SEND_LANDED_MS, () =>
					fs.readFileSync(transcript, "utf8").includes(liveNeedle),
				),
				`--- transcript ---\n${transcript}`,
			);

			// ── a resume aimed at a LIVE citizen is refused, and mutates nothing ──
			const windowsBefore = windowCount(srv.socket, srv.env);
			const refusedLive = await bridge.call("entwurf_resume_call", { target: citizen }, RESUME_CALL_TIMEOUT_MS);
			ok(
				`${cell}: entwurf_resume_call against a LIVE citizen is REFUSED as target-live and points at entwurf_v2`,
				refusedLive.isError && refusedLive.text.includes("target-live") && refusedLive.text.includes("entwurf_v2"),
				`--- response ---\n${refusedLive.text}`,
			);
			ok(
				`${cell}: that refusal opened NO window — the server holds the same window count, so "no window was opened" is a fact about tmux, not a sentence in the response`,
				windowCount(srv.socket, srv.env) === windowsBefore,
			);
			receipts[`${cell}/4-resume-refused-live`] = refusedLive.text;

			// ── close the STABLE LAUNCH HANDLE and prove dormancy ───────────
			const closed = closeWindow(
				{
					serverPid: srv.serverPid,
					sessionId: coords.sessionId,
					windowId: coords.windowId,
					windowIndex: coords.windowIndex,
					paneId: coords.paneId,
					panePid: coords.panePid,
				},
				srv.env,
			);
			ok(`${cell}: the stable launch handle closed its own window`, closed === "closed", `--- outcome ---\n${closed}`);
			ok(
				`${cell}: the pane process is gone`,
				await waitForPidsGone(new Set([Number(coords.panePid)]), DORMANT_WAIT_MS),
			);
			let dormantState = "";
			ok(
				`${cell}: the citizen is DORMANT — its control socket no longer answers, which is the fact the decider reads`,
				await waitFor("the control socket to stop answering", DORMANT_WAIT_MS, async () => {
					dormantState = await socketState(citizen, roots.controlDir);
					return dormantState === "dead";
				}),
				`--- socket ---\n${controlSocketPath(citizen, roots.controlDir)} → ${dormantState}`,
			);
			ok(
				`${cell}: the record survived the close — a dormant citizen keeps its address`,
				meta.metaRecordExistsByGardenId(citizen),
			);

			if (full) {
				const dormantSend = await bridge.call("entwurf_v2", {
					target: citizen,
					intent: "fire-and-forget",
					message: "this must be refused: a dormant socket citizen has no active receiver",
				});
				ok(
					`${cell}: delivery to the dormant citizen is refused HONESTLY as dormant-fire-forget-unsupported — nothing is queued for a session nobody is draining`,
					dormantSend.isError && dormantSend.text.includes("dormant-fire-forget-unsupported"),
					`--- response ---\n${dormantSend.text}`,
				);
				receipts[`${cell}/5-dormant-delivery-refused`] = dormantSend.text;
			}

			// ── receipt 4/4: RESUME LAUNCH + RESUME OBSERVATION ──────────────
			const beforeResumeSha = sha256(transcript);
			const beforeResumeGids = fs.readdirSync(meta.defaultMetaSessionsDir()).length;
			const resumed = await bridge.call("entwurf_resume_call", { target: citizen }, RESUME_CALL_TIMEOUT_MS);
			ok(
				`${cell}: tools/call entwurf_resume_call reopened the citizen through the public surface`,
				!resumed.isError,
				`--- response ---\n${resumed.text}\n--- bridge stderr ---\n${bridge.stderrTail()}`,
			);
			receipts[`${cell}/6-resume-launch+observation`] = resumed.text;
			const resumedCoords = parseCoordinates(resumed.text, "the resume receipt's");
			panePids.add(Number(resumedCoords.panePid));
			ok(
				`${cell}: the resume response carries BOTH receipts and keeps them apart by name — a LAUNCH that only claims tmux made a window, and an OBSERVATION that is the only fact saying the citizen is back`,
				resumed.text.includes("LAUNCH receipt") &&
					resumed.text.includes("OBSERVATION receipt") &&
					resumed.text.includes("the control socket for") &&
					resumed.text.includes(citizen),
				`--- response ---\n${resumed.text}`,
			);
			ok(
				`${cell}: the OBSERVATION says the socket answered — and the same garden id is alive again on the decider's own probe`,
				resumed.text.includes("answered after") && (await socketState(citizen, roots.controlDir)) === "alive",
			);
			ok(
				`${cell}: the resume minted NO new citizen — the store holds the same number of records, and the resumed window is a different pane than the closed one`,
				fs.readdirSync(meta.defaultMetaSessionsDir()).length === beforeResumeGids &&
					resumedCoords.paneId !== coords.paneId,
			);
			ok(
				`${cell}: the resume ran NO turn — the transcript is byte-identical across the call (a resume reopens a conversation, it does not continue it)`,
				sha256(transcript) === beforeResumeSha,
			);
			ok(
				`${cell}: the resumed pane actually started in the RECORD's cwd — asked by stable pane id in a separate tmux query, never read off the pane`,
				recordCwd.length > 0 && paneStartPath(srv.socket, resumedCoords.paneId, srv.env) === recordCwd,
				`--- record cwd ---\n${recordCwd}\n--- pane_start_path ---\n${paneStartPath(srv.socket, resumedCoords.paneId, srv.env)}`,
			);
			ok(
				`${cell}: the per-gid lock was released — no lock file survives the resume`,
				lockResidue(roots, citizen).length === 0,
				`--- lock dir ${roots.lockDir} ---\n${lockResidue(roots, citizen).join("\n") || "(empty)"}`,
			);

			// ── the fact that makes the resume mean something ────────────────
			const recallNeedle = `MUX_RECALL_${nonce.slice(-10)}`;
			const recallSend = await bridge.call("entwurf_v2", {
				target: citizen,
				intent: "fire-and-forget",
				mode: "follow_up",
				message: `Scene 3 (${recallNeedle}): reply with the color you were asked to remember at the start, and stop.`,
			});
			ok(
				`${cell}: the resumed citizen is addressable again — entwurf_v2 reached it on the control-socket rail`,
				!recallSend.isError && recallSend.text.includes("control-socket"),
				`--- response ---\n${recallSend.text}`,
			);
			receipts[`${cell}/7-recall-send`] = recallSend.text;
			ok(
				`${cell}: the resumed session RECALLED the fact it was told before the window closed — this, not the socket, is what proves the same CONVERSATION came back`,
				await waitFor("the recalled fact in the resumed transcript", RECALL_MS, () => {
					const text = fs.readFileSync(transcript, "utf8");
					const after = text.slice(text.lastIndexOf(recallNeedle));
					return after.includes(recallNeedle) && after.toLowerCase().includes(SCENE_FACT);
				}),
				`--- transcript ---\n${transcript}`,
			);

			// ── tear the resumed window down through the product's own verb ──
			const resumedClose = closeWindow(
				{
					serverPid: srv.serverPid,
					sessionId: resumedCoords.sessionId,
					windowId: resumedCoords.windowId,
					windowIndex: resumedCoords.windowIndex,
					paneId: resumedCoords.paneId,
					panePid: resumedCoords.panePid,
				},
				srv.env,
			);
			ok(
				`${cell}: the resumed window closed by its own stable handle`,
				resumedClose === "closed" || resumedClose === "already-gone",
			);
		}

		// ════════════════════════════════════════════════════════════════════
		// CLAUDE CODE — the same first half, then the honest stop
		//
		// Runs FIRST on purpose. Cell order is not a product contract, and this cell carries the
		// heaviest external prerequisite: a configured Claude Code whose own session hook arms its
		// mailbox. Putting it first means a host that cannot satisfy it fails before two pi turns
		// have been spent. No cell reads another's state — the cross-cell correlation is asserted
		// once, after all three, from the collected ids.
		// ════════════════════════════════════════════════════════════════════
		async function runClaudeCell(): Promise<void> {
			const cc = startPrivateServer("claude-code", "claude-code", cellRoots(REAL_HOME));
			const ccBridge = new BridgeClient(cc.env);
			bridges.push(ccBridge);

			const ccLaunch = await ccBridge.call("entwurf_fresh_call", {
				backend: "claude-code",
				model: CLAUDE_MODEL,
				task: `Reply with the single word ACK and then stop. Do not read files. (scene fact: ${SCENE_FACT})`,
			});
			ok(
				"claude-code: tools/call entwurf_fresh_call returned a launch receipt through the public surface",
				!ccLaunch.isError,
				`--- response ---\n${ccLaunch.text}\n--- bridge stderr ---\n${ccBridge.stderrTail()}`,
			);
			receipts["claude-code/1-launch"] = ccLaunch.text;
			const ccCoords = parseCoordinates(ccLaunch.text, "the launch receipt's");
			const ccNonce = parseNonce(ccLaunch.text);
			panePids.add(Number(ccCoords.panePid));

			const ccGid = await awaitCallbackSender(ccNonce, CALLBACK_WAIT_MS);
			ok(
				"claude-code: the nonce came back and its SENDER ENVELOPE carries a garden id",
				ccGid !== null && GARDEN_ID.test(ccGid),
				`--- launch receipt ---\n${ccLaunch.text}`,
			);
			const ccCitizen = ccGid as string;
			siblingGids.add(ccCitizen);
			receipts["claude-code/2-callback-identity"] = `${ccCitizen} (sender envelope of ${ccNonce})`;
			ok(
				"claude-code: the launch receipt never named that garden id — the address came from the callback, not from the launch",
				!ccLaunch.text.includes(ccCitizen) && ccCitizen !== callerGid,
			);

			ok(
				"claude-code: the sibling armed its OWN mailbox from its session hook (a self-fetch citizen is deliverable)",
				await waitFor("the claude sibling's receiver marker", RECEIVER_ARM_MS, () =>
					Boolean(meta.readMetaReceiverMarker({ gardenId: ccCitizen })),
				),
			);
			const ccSend = await ccBridge.call("entwurf_v2", {
				target: ccCitizen,
				intent: "fire-and-forget",
				message: `Scene 4: the color is ${SCENE_FACT}. No reply needed.`,
			});
			ok(
				"claude-code: tools/call entwurf_v2 fire-and-forget enqueued on the META-MAILBOX rail",
				!ccSend.isError && ccSend.text.includes("meta-mailbox"),
				`--- response ---\n${ccSend.text}\n--- bridge stderr ---\n${ccBridge.stderrTail()}`,
			);
			receipts["claude-code/3-mailbox-send"] = ccSend.text;
			const box = path.join(meta.defaultMetaMailboxDir(), ccCitizen);
			const boxFiles = await fsp.readdir(box).catch(() => [] as string[]);
			ok(
				"claude-code: exactly one .msg physically landed in the sibling's mailbox, and the doorbell was poked",
				boxFiles.filter((f) => f.endsWith(".msg")).length === 1 && boxFiles.includes("inbox.signal"),
				`--- mailbox ${box} ---\n${boxFiles.join("\n") || "(empty)"}`,
			);

			const ccRead = await ccBridge.call("entwurf_inbox_read", { gardenId: ccCitizen });
			ok(
				"claude-code: tools/call entwurf_inbox_read returned the body and stamped a read receipt",
				!ccRead.isError && ccRead.text.includes("lastReadAt=") && ccRead.text.includes(SCENE_FACT),
				`--- response ---\n${ccRead.text}`,
			);
			receipts["claude-code/4-mailbox-read"] = ccRead.text;
			ok(
				"claude-code: the delivered body names the CALLER's identity — sender and receiver joined",
				ccRead.text.includes(callerGid),
				`--- response ---\n${ccRead.text}`,
			);

			// No resume is invented for a backend that never stands a control socket up. The refusal is
			// the proof: it opens no window, and its per-gid coordination lock leaves no residue.
			const ccWindowsBefore = windowCount(cc.socket, cc.env);
			const ccResume = await ccBridge.call("entwurf_resume_call", { target: ccCitizen }, RESUME_CALL_TIMEOUT_MS);
			ok(
				"claude-code: entwurf_resume_call is REFUSED as target-not-pi — a capability boundary named as itself, not an error about a record that is perfectly fine",
				ccResume.isError && ccResume.text.includes("target-not-pi"),
				`--- response ---\n${ccResume.text}`,
			);
			ok(
				"claude-code: that refusal opened no window and left no lock behind",
				windowCount(cc.socket, cc.env) === ccWindowsBefore && lockResidue(cellRoots(REAL_HOME), ccCitizen).length === 0,
			);
			receipts["claude-code/5-resume-refused-not-pi"] = ccResume.text;
		}

		await runClaudeCell();
		await runPiCell("pi-native", PI_NATIVE_MODEL, true, NATIVE_ROOTS);
		await runPiCell("pi-acp", PI_ACP_MODEL, false, ACP_ROOTS);

		ok(
			"correlation: all three siblings reported DIFFERENT garden ids and none is the launcher's — asserted after every cell, so it never depends on which one ran first",
			siblingGids.size === 3 && !siblingGids.has(callerGid),
		);

		// ── the receipt axes stay apart ──────────────────────────────────────
		const launchText = receipts["pi-native/1-launch"] as string;
		const sendText = receipts["pi-native/3-live-send"] as string;
		const resumeText = receipts["pi-native/6-resume-launch+observation"] as string;
		ok(
			"receipts: fresh launch / callback identity / live send / resume launch+observation are four DISTINCT texts, each naming its own step",
			new Set([launchText, receipts["pi-native/2-callback-identity"] as string, sendText, resumeText]).size === 4,
		);
		ok(
			"receipts: no earlier step's text was reused to vouch for a later one — the fresh launch never mentions delivery, the send never mentions a window, and the resume observation is the only text claiming the citizen is back",
			!launchText.includes("control-socket") &&
				!sendText.includes("window:") &&
				!launchText.includes("OBSERVATION receipt") &&
				resumeText.includes("OBSERVATION receipt"),
		);
		ok(
			"receipts: the retired owned-outcome resume is nowhere in this lifecycle — not in a call, not in a receipt",
			!Object.values(receipts).some((t) => t.includes("owned-outcome") && !t.includes("withdrawn")) &&
				!Object.values(receipts).some((t) => t.includes("spawn-bg")),
		);
	} catch (err) {
		// CAPTURED, not rethrown here. Teardown and the self-fence proof below must run on the
		// FAILURE path too: a red cell is exactly when a fixture is most likely to have leaked a
		// record, a socket or a lock into the operator's own roots, and the earlier shape — where
		// those checks sat after a `finally` — skipped them precisely then. Only the success path
		// was ever self-fenced.
		runError = err;
	}

	// ── teardown, on both paths ──────────────────────────────────────────────
	const cleanupProblems: string[] = [];
	for (const bridge of bridges) bridge.close();
	for (const socket of privateSockets) tmux(socket, ["kill-server"], process.env);
	const panesGone = await waitForPidsGone(panePids);
	if (!panesGone)
		cleanupProblems.push(
			`tracked fixture pane processes were not proven gone after teardown: ${[...panePids].join(", ") || "(none)"}`,
		);
	process.chdir(originalCwd);
	// Launcher integrity BEFORE fixture removal, on success and failure alike (issue #67). Removal
	// happens only when it is PROVEN non-destructive: the launcher demonstrably does not reference
	// the fixture tree AND every TRACKED launched pane process is proven gone — a live pane could
	// still rewrite the launcher after the check. (Tracked-pane quiescence only; this claims
	// nothing about untracked detached descendants.) An unproven state blocks removal loudly
	// rather than guessing.
	const launcherProblems = verifyClaudeLauncher(launcherSnapshot);
	const launcherCleanup = assessLauncherCleanup(launcherSnapshot);
	for (const p of launcherProblems) cleanupProblems.push(`launcher integrity: ${p}`);
	for (const p of launcherCleanup.problems) cleanupProblems.push(`launcher cleanup: ${p}`);
	if (!launcherCleanup.safeToRemove || !panesGone) {
		cleanupProblems.push(
			`fixture removal of ${root} is BLOCKED — ${
				launcherCleanup.safeToRemove
					? "tracked pane processes are not proven gone"
					: "the real claude launcher references the fixture tree or could not be proven safe"
			}; resolve the named problems above, then remove the tree by hand`,
		);
	} else {
		try {
			fs.rmSync(root, { recursive: true, force: true });
		} catch (err) {
			cleanupProblems.push(
				`fixture root ${root} could not be removed: ${err instanceof Error ? err.message : String(err)}`,
			);
		}
		if (fs.existsSync(root)) cleanupProblems.push(`fixture root ${root} still exists after removal`);
	}

	// ── the self-fence proof, on both paths ──────────────────────────────────
	// Collected rather than thrown, so a failing run reports the run error AND whatever it left
	// behind. One must never hide the other.
	const fenceProblems: string[] = [];
	const rootUnchanged: Record<string, boolean> = {};
	const readableRealEntries: string[] = [];
	for (const [name, dir] of Object.entries(REAL_META_ROOTS)) {
		try {
			const current = entrySet(dir);
			readableRealEntries.push(current);
			rootUnchanged[name] = current === beforeRealRoots[name];
			if (!rootUnchanged[name]) fenceProblems.push(`the operator's ${name} entry set changed`);
		} catch (err) {
			rootUnchanged[name] = false;
			fenceProblems.push(
				`the operator's ${name} root could not be inspected after the run: ${
					err instanceof Error ? err.message : String(err)
				}`,
			);
		}
	}
	const realNow = readableRealEntries.join("\n");
	const noGidLeaked = [...siblingGids].every((gid) => !realNow.includes(gid));
	for (const gid of siblingGids) {
		if (realNow.includes(gid)) fenceProblems.push(`fixture garden id ${gid} appears in a real root`);
	}

	if (runError || cleanupProblems.length > 0 || fenceProblems.length > 0) {
		const parts: string[] = [];
		if (runError) parts.push(`RUN: ${runError instanceof Error ? runError.message : String(runError)}`);
		if (cleanupProblems.length > 0) parts.push(`CLEANUP:\n  ${cleanupProblems.join("\n  ")}`);
		if (fenceProblems.length > 0) parts.push(`SELF-FENCE:\n  ${fenceProblems.join("\n  ")}`);
		throw new Error(`${LABEL}: run did not complete cleanly —\n\n${parts.join("\n\n")}`);
	}

	// ── Prove the fence held, by name and by entry set, on every real root ───
	for (const name of Object.keys(REAL_META_ROOTS)) {
		ok(`self-fence: the operator's ${name} has the same entry set as before`, rootUnchanged[name] === true);
	}
	ok(
		"self-fence: not one fixture garden id appears in any of the operator's real record / mailbox / marker / socket / lock roots",
		noGidLeaked,
	);
	ok(
		"self-fence: the real claude launcher, its link and its resolved target are exactly as pinned before launch",
		verifyClaudeLauncher(launcherSnapshot).length === 0,
	);

	console.log("\n  receipts (kept apart, never folded):");
	for (const [name, text] of Object.entries(receipts)) {
		console.log(`    ${name.padEnd(38)} ${text.split("\n")[0]}`);
	}
	console.log(`\n${LABEL}: ${passed} checks passed`);
}

main().catch((err) => {
	console.error(`${LABEL}: ${err instanceof Error ? err.message : String(err)}`);
	process.exit(1);
});
