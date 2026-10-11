/**
 * take-herdr-pi-cc — the take-pi-cc scene recorded INSIDE herdr (#138): a pi citizen in a herdr pane opens a
 * native Claude Code sibling, which the herdr rail places in a new tab of the same workspace; the sibling does one
 * small task and the result comes back. The recording is the WHOLE herdr client UI (sidebar, tab bar, the focused
 * agent), no captions. The question, the sibling's reply and pi's closing answer are English by this take's own
 * prompts; no global instruction, setting, hook or credential is touched.
 *
 * Same scene and same oracles as take-pi-cc.ts. What differs is only where it runs:
 *   - a PRIVATE herdr server: XDG_* and entwurf's meta roots fenced under one take root (herdrFence), real HOME
 *     (auth, ~/.claude and ~/.pi stay the operator's), the vendor Claude data dir shared by symlink and the
 *     operator's claude launcher pinned before launch and verified after (docs/herdr-launch-rail.md §12.5);
 *   - the coordinator pi is started by `herdr agent start --kind pi` in the pane `workspace create` returned, with
 *     the same take-only flags plus herdr's own pi integration named explicitly (-ne drops it; absent = refusal);
 *   - the camera is `herdr tab focus` on the private server, to tab ids herdr returned — a view, never an address;
 *   - teardown stops only this private server (socket inside the fence, pid proven ours by its environ) and
 *     reports what is left. Records, transcripts and the fence root are kept.
 *
 * Named side effects in the operator's real HOME, because neither directory has an env override: the coordinator's
 * control socket in ~/.pi/entwurf-control (entwurf-control.ts:108) — while the take lives, the operator's
 * entwurf_peers lists it as a record-less socket — and the per-target v2 lock in ~/.pi/entwurf-v2-locks
 * (entwurf-v2-lock.ts:80) when Claude Code replies on pi's socket. Teardown reads whether the socket is still there;
 * it removes neither.
 *
 * NOT a gate and not release evidence: a maintainer demo take, FAILED when its raw evidence does not hold. The
 * take is an observer: a drift ends it and closes only its own resources; what a native agent already did stays.
 * Run: LIVE=1 node demo/take-herdr-pi-cc.ts — spends real turns on openai-codex (coordinator) and on the
 * operator's Claude subscription (native Claude Code).
 */
import { spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { lockPathFor } from "../pi-extensions/lib/entwurf-v2-lock.ts";
import * as meta from "../pi-extensions/lib/meta-session.ts";
import { controlSocketPath } from "../pi-extensions/lib/socket-discovery.ts";
import {
	assessLauncherCleanup,
	snapshotClaudeLauncher,
	verifyClaudeLauncher,
} from "../scripts/lib/claude-launcher-fence.ts";
import {
	parseJsonLines,
	piCallbackSenders,
	piSourceToolReceipts,
	type SourceToolReceipt,
} from "../scripts/lib/codex-fresh-source-receipts.ts";
import {
	claudeNativeView,
	isApprovedCcAlias,
	isNativeModelOfAlias,
	judgeClaudeCodeReceive,
	judgeClaudeNativeWork,
} from "./lib/claude-native-work.ts";
import {
	applyHerdrFence,
	fenceProblems,
	HERDR_TAKE_CONFIG,
	hasHangul,
	herdrFence,
	herdrLaunchTab,
	isTabFocused,
	lastCompletedText,
	parseWorkspaceCreated,
} from "./lib/herdr-take.ts";
import { judgePiReceipt, NOTES_TEXT, notesExpectation, workQuestion } from "./lib/pi-durable-work.ts";
import {
	CONTROL_SOCKET_BOUNDARY,
	GARDEN_ID,
	gardenIds,
	NONCE,
	newCitizensIn,
	openRouterOverride,
	piAssistantModels,
	piEntriesOf,
	piInbound,
	sleep,
	Take,
} from "./lib/take-recorder.ts";

const LABEL = "take-herdr-pi-cc";
const REPO = path.resolve(import.meta.dirname, "..");
const PI_MODEL = process.env.ENTWURF_DEMO_PI_MODEL?.trim() || "openai-codex/gpt-6.1-sol";
const CC_MODEL = process.env.ENTWURF_DEMO_CC_MODEL?.trim() || "sonnet";
const PI_THINKING = process.env.ENTWURF_DEMO_PI_THINKING?.trim() || "low";
const TURN_WAIT_MS = 300_000;

// The approved rails for THIS scene, as in take-pi-cc.ts: overrides may only restate them.
const APPROVED = { pi: "openai-codex/gpt-6.1-sol", cc: "sonnet", thinking: "low" } as const;
function refuse(why: string, code = 2): never {
	console.error(`[${LABEL}] ${why}`);
	process.exit(code);
}
if (
	PI_MODEL !== APPROVED.pi ||
	CC_MODEL !== APPROVED.cc ||
	PI_THINKING !== APPROVED.thinking ||
	!isApprovedCcAlias(CC_MODEL)
)
	refuse(
		`selector refused: pi=${PI_MODEL} cc=${CC_MODEL} thinking=${PI_THINKING} — this scene runs only on ` +
			`pi=${APPROVED.pi} cc=${APPROVED.cc} thinking=${APPROVED.thinking}.`,
	);
const routedVia = openRouterOverride(process.env);
if (routedVia) refuse(`refused before any inference: ${routedVia} routes a provider through OpenRouter.`);
const isRequestedNativeModel = (m: string) => isNativeModelOfAlias(APPROVED.cc, m);
if (process.env.LIVE !== "1")
	refuse(
		`set LIVE=1 to run — this starts a private herdr server, a visible pi and a native Claude Code sibling on ` +
			`${CC_MODEL}, and spends model turns on ${PI_MODEL} and the operator's Claude subscription.`,
		97,
	);

// ── preflight: every refusal before anything is created ─────────────────────────────────────────────────────
const supply = JSON.parse(fs.readFileSync(path.join(REPO, "scripts", "fixtures", "herdr-supply.json"), "utf8")) as {
	version: string;
};
const herdrVersion = spawnSync("herdr", ["--version"], { encoding: "utf8" }).stdout?.trim() ?? "";
if (herdrVersion !== `herdr ${supply.version}`)
	refuse(`herdr on PATH reports "${herdrVersion}", not the measured supply pin herdr ${supply.version}.`);
if (spawnSync("asciinema", ["--version"], { encoding: "utf8" }).status !== 0) refuse("asciinema is not on PATH.");
const piAgentDir = process.env.PI_CODING_AGENT_DIR?.trim() || path.join(os.homedir(), ".pi", "agent");
const HERDR_PI_EXT = path.join(piAgentDir, "extensions", "herdr-agent-state.ts");
if (!fs.existsSync(HERDR_PI_EXT) || !fs.statSync(HERDR_PI_EXT).isFile())
	refuse(`herdr's pi integration is not at ${HERDR_PI_EXT} — this take names it explicitly and never installs it.`);
const operatorClaudeData = path.join(
	process.env.XDG_DATA_HOME?.trim() || path.join(os.homedir(), ".local", "share"),
	"claude",
);
if (!fs.existsSync(operatorClaudeData))
	refuse(
		`no vendor Claude data dir at ${operatorClaudeData}: a fenced XDG_DATA_HOME beside the real HOME would ` +
			"retarget the operator's claude launcher (docs/herdr-launch-rail.md §12.5), so this take does not launch.",
	);

// ── the fence: one take root, created here, applied to this process and everything it starts ───────────────
const fenceRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "entwurf-herdr-demo-")));
const fence = herdrFence(fenceRoot);
for (const dir of Object.values(fence)) fs.mkdirSync(dir, { recursive: true });
fs.chmodSync(fence.XDG_RUNTIME_DIR as string, 0o700);
fs.mkdirSync(path.join(fence.XDG_CONFIG_HOME as string, "herdr"), { recursive: true });
fs.writeFileSync(path.join(fence.XDG_CONFIG_HOME as string, "herdr", "config.toml"), HERDR_TAKE_CONFIG);
fs.symlinkSync(operatorClaudeData, path.join(fence.XDG_DATA_HOME as string, "claude"));
let launcher: ReturnType<typeof snapshotClaudeLauncher>;
try {
	launcher = snapshotClaudeLauncher({ env: process.env, fixtureRoot: fenceRoot });
} catch (err) {
	refuse(err instanceof Error ? err.message : String(err));
}
applyHerdrFence(process.env, fence);
const herdrSocket = path.join(fence.XDG_CONFIG_HOME as string, "herdr", "herdr.sock");

const take = new Take({
	label: LABEL,
	repo: REPO,
	cols: Number(process.env.ENTWURF_DEMO_COLS ?? 132),
	rows: Number(process.env.ENTWURF_DEMO_ROWS ?? 38),
	files: { "notes.txt": NOTES_TEXT },
});
const { scratch } = take;
const token = `DEMO-${randomBytes(3).toString("hex").toUpperCase()}`;
const expectation = notesExpectation(token);

const siblingTask =
	"You were opened by a pi sibling for a short recorded demo. After your callback, wait. When an entwurf inbox " +
	"notice arrives, read it with entwurf_inbox_read using your own garden id, do the one small task in the " +
	"message with your own Bash tool, and send the answer back to the sender's garden id with entwurf_v2 " +
	"(intent fire-and-forget). Write in English. Then stop.";
const question = `${workQuestion(token)} Reply in English.`;
const firstTask =
	"Demo: open a Claude Code sibling and give it one task. " +
	`(1) entwurf_fresh_call once: backend "claude-code", model "${CC_MODEL}", cwd "${scratch}", task ${JSON.stringify(siblingTask)}. ` +
	"(2) Its garden id arrives by itself as a callback — do not poll or list peers. Then call entwurf_v2 once to " +
	`that id with intent "fire-and-forget", wants_reply true and message ${JSON.stringify(question)}. ` +
	`(3) When its reply arrives, answer me in English in one line starting with ${token}. Do not run commands yourself.`;

const ext = (f: string) => path.join(REPO, "pi-extensions", f);
// `entwurf pi` is `pi --entwurf-control` (run.sh `pi)`); herdr's --kind pi runs the bare `pi`, so the flag is spelled.
const piArgs = [
	"--entwurf-control",
	"-ne",
	"-np",
	"-e",
	"builtin:mcp",
	"-e",
	ext("acp-provider.ts"),
	"-e",
	ext("entwurf-control.ts"),
	"-e",
	ext("model-lock.ts"),
	"-e",
	HERDR_PI_EXT,
	"--model",
	PI_MODEL,
	"--thinking",
	PI_THINKING,
	firstTask,
];

// ── herdr, always under the take's fenced env; every answer kept raw ────────────────────────────────────────
const herdrLog: Array<{ argv: string[]; status: number | null; stdout: string; stderr: string; error?: string }> = [];
take.receipts.herdr = herdrLog;
function herdr(args: string[], timeoutMs = 30_000) {
	const r = spawnSync("herdr", args, { env: take.env, encoding: "utf8", timeout: timeoutMs });
	const row = {
		argv: args,
		status: r.status,
		stdout: (r.stdout ?? "").trim(),
		stderr: (r.stderr ?? "").trim(),
		...(r.error ? { error: r.error.message } : {}),
	};
	herdrLog.push(row);
	return row;
}
const sleepSync = (ms: number) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
/** Running, by the kernel: a signal-0 probe, and not a zombie (teardown waits synchronously, so our own exited child
 * is not reaped yet and would still answer the probe). */
function alive(pid: number): boolean {
	try {
		process.kill(pid, 0);
	} catch (err) {
		if ((err as NodeJS.ErrnoException).code !== "EPERM") return false;
	}
	try {
		return !/^\d+ \(.*\) Z /.test(fs.readFileSync(`/proc/${pid}/stat`, "utf8"));
	} catch {
		return false;
	}
}
function procArgv(pid: number): string[] {
	try {
		return fs.readFileSync(`/proc/${pid}/cmdline`, "utf8").split("\0").filter(Boolean);
	} catch {
		return [];
	}
}
function procEnvHas(pid: number, entry: string): boolean {
	try {
		return fs.readFileSync(`/proc/${pid}/environ`, "utf8").split("\0").includes(entry);
	} catch {
		return false;
	}
}
const allPids = () =>
	fs
		.readdirSync("/proc")
		.filter((d) => /^\d+$/.test(d))
		.map(Number);
/** Every `herdr server` process on the host (the operator's included), read from the kernel, never signalled. */
const herdrServers = () =>
	allPids().filter((pid) => {
		const argv = procArgv(pid);
		return argv.length === 2 && path.basename(argv[0] as string) === "herdr" && argv[1] === "server";
	});
const FENCE_MARK = `ENTWURF_META_SESSIONS_DIR=${fence.ENTWURF_META_SESSIONS_DIR}`;
const XDG_MARK = `XDG_CONFIG_HOME=${fence.XDG_CONFIG_HOME}`;

const foreignServers = herdrServers();
let ownedServer: number | null = null;
let serverSpawned = false;
const known: { piGid?: string; ccGid?: string } = {};

/**
 * Owned teardown. The CLI stop goes only to a server proven ours NOW (the owned pid alive, its environ carrying the
 * fence, its socket inside the fence); an unprovable server is recorded and left, never addressed through a socket.
 * A stop that answers nonzero stays RED even if the owned-pid SIGTERM fallback then clears it: that is cleanup, not
 * the operation passing.
 */
function stopPrivateHerdr(): void {
	const out: Record<string, unknown> = { foreignServersBefore: foreignServers, ownedServer };
	take.receipts.teardown = out;
	if (serverSpawned) {
		const held = fenceProblems(take.env, fence, fenceRoot);
		const proven =
			ownedServer !== null &&
			alive(ownedServer) &&
			procEnvHas(ownedServer, XDG_MARK) &&
			held.length === 0 &&
			fs.existsSync(herdrSocket);
		out.provenBeforeStop = { proven, held, socket: fs.existsSync(herdrSocket) };
		take.step(
			"the private herdr server is proven ours before stop (owned pid alive, fenced environ, fenced socket)",
			proven,
			JSON.stringify(out.provenBeforeStop),
		);
		if (proven) {
			const stop = herdr(["server", "stop"], 20_000);
			out.stop = stop;
			take.step("`herdr server stop` answered ok", stop.status === 0 && stop.error === undefined, JSON.stringify(stop));
			const deadline = Date.now() + 10_000;
			while (alive(ownedServer as number) && Date.now() < deadline) sleepSync(250);
			const exitedOnStop = !alive(ownedServer as number);
			take.step("the private herdr server exited on its own stop (no signal needed)", exitedOnStop);
			if (!exitedOnStop && procEnvHas(ownedServer as number, XDG_MARK)) {
				process.kill(ownedServer as number, "SIGTERM");
				out.sigterm = ownedServer;
				sleepSync(1000);
			}
			take.step("the private herdr server is gone", !alive(ownedServer as number));
		}
	}
	const foreignAlive = foreignServers.filter(alive);
	out.foreignServersAfter = foreignAlive;
	take.step(
		"every herdr server that existed before the take is still alive (never stopped or signalled)",
		foreignAlive.length === foreignServers.length,
		JSON.stringify({ before: foreignServers, after: foreignAlive }),
	);
	let residue: Array<{ pid: number; argv: string[] }> = [];
	const residueDeadline = Date.now() + 10_000;
	for (;;) {
		residue = allPids()
			.filter((pid) => pid !== process.pid && procEnvHas(pid, FENCE_MARK))
			.map((pid) => ({ pid, argv: procArgv(pid).slice(0, 4) }));
		if (residue.length === 0 || Date.now() > residueDeadline) break;
		sleepSync(500);
	}
	out.residue = residue;
	take.step(
		"no process still carries this take's fence after teardown (reported, not signalled)",
		residue.length === 0,
		JSON.stringify(residue),
	);
	if (known.piGid) {
		const socket = controlSocketPath(known.piGid);
		out.piControlSocket = { path: socket, presentAfterTeardown: fs.existsSync(socket) };
		const lock = lockPathFor(known.piGid);
		out.piV2Lock = { path: lock, presentAfterTeardown: fs.existsSync(lock) };
	}
	const launcherProblems = verifyClaudeLauncher(launcher);
	out.launcherCleanup = assessLauncherCleanup(launcher);
	take.step(
		"the operator's claude launcher is the one pinned before launch",
		launcherProblems.length === 0,
		launcherProblems.join("; "),
	);
}

function isStop(raw: unknown): boolean {
	const e = raw as { type?: unknown; message?: { role?: unknown; stopReason?: unknown } };
	return e.type === "message" && e.message?.role === "assistant" && e.message.stopReason === "stop";
}
/** The sibling's own Claude Code transcript rows, from the exact path its record names. */
function ccRows(gid: string): unknown[] {
	const t = meta.readMetaIdentityByGardenId(gid)?.transcriptPath ?? "";
	return t && fs.existsSync(t) ? parseJsonLines(fs.readFileSync(t, "utf8")) : [];
}
/** The camera: focus a tab on the PRIVATE server by the id herdr returned. An observer failure ends the take. */
function focus(tabId: string, why: string): boolean {
	const r = herdr(["tab", "focus", tabId]);
	take.views.push({ at: new Date().toISOString(), window: tabId, why });
	console.log(`  view  → ${tabId} (${why})`);
	return take.must(`camera: herdr focused tab ${tabId}`, r.status === 0 && isTabFocused(r.stdout, tabId), r.stdout);
}

async function run(): Promise<boolean> {
	const { receipts } = take;
	// 0. the fence holds, in this process and in the env every child gets — before anything exists
	const unheld = [...fenceProblems(process.env, fence, fenceRoot), ...fenceProblems(take.env, fence, fenceRoot)];
	if (!take.must("the take's fence holds before anything is created", unheld.length === 0, unheld.join("; ")))
		return false;
	const citizensBefore = gardenIds();
	if (!take.must("the fenced record store starts empty", citizensBefore.size === 0, [...citizensBefore].join(", ")))
		return false;

	// 1. the private server: socket inside the fence, pid ours by the kernel's environ
	const serverLog = fs.openSync(path.join(fenceRoot, "herdr-server.log"), "a");
	const server = spawn("herdr", ["server"], {
		env: take.env,
		cwd: scratch,
		detached: true,
		stdio: ["ignore", serverLog, serverLog],
	});
	server.unref();
	serverSpawned = true;
	fs.closeSync(serverLog);
	take.registerTeardown(stopPrivateHerdr);
	const up = await take.until("the private herdr server socket", 20_000, () => {
		if (!fs.existsSync(herdrSocket)) return null;
		const mine = herdrServers().filter((pid) => !foreignServers.includes(pid) && procEnvHas(pid, XDG_MARK));
		return mine.length === 1 ? mine[0] : null;
	});
	if (up === null) return false;
	ownedServer = up;
	receipts.herdrServer = { pid: up, spawnedPid: server.pid, socket: herdrSocket, version: herdrVersion };

	// 2. the workspace herdr creates is where everything happens; its coordinates come from herdr's answer
	const wsRun = herdr(["workspace", "create", "--label", "demo", "--cwd", scratch, "--focus"]);
	const ws = wsRun.status === 0 ? parseWorkspaceCreated(wsRun.stdout) : null;
	if (!take.must("herdr created the workspace and named its tab and pane", ws !== null, wsRun.stderr || wsRun.stdout))
		return false;
	const { workspaceId, tabId: piTab, paneId: piPane } = ws as NonNullable<typeof ws>;
	receipts.workspace = ws;

	// 3. the camera is the whole herdr client, attached to the private server
	take.startRecorder("herdr");
	await sleep(3000);
	take.views.push({ at: new Date().toISOString(), window: piTab, why: "herdr opens on the coordinator's tab" });

	// 4. the coordinator: pi in that pane, started by herdr with the take-only flags (one physical line each)
	const controlled = piArgs.filter((a) => /\p{Cc}/u.test(a));
	if (!take.must("no coordinator argument carries a control character", controlled.length === 0)) return false;
	const started = herdr(
		["agent", "start", "coordinator", "--kind", "pi", "--pane", piPane, "--timeout", "180000", "--", ...piArgs],
		200_000,
	);
	if (!take.must("herdr started the coordinator pi in the workspace's pane", started.status === 0, started.stderr))
		return false;

	// 5. birth under -ne -np, in the fenced store
	const piGid = await take.until("the coordinator pi record under -ne -np", 60_000, () => {
		const fresh = meta
			.listAllMetaIdentitiesDir(meta.defaultMetaSessionsDir())
			.identities.filter((r) => !citizensBefore.has(r.gardenId) && r.cwd === scratch && r.backend === "pi");
		return fresh.length === 1 ? fresh[0]?.gardenId : null;
	});
	if (!piGid) return false;
	known.piGid = piGid;
	if (!take.must("coordinator pi record minted under the take-only flags", GARDEN_ID.test(piGid), piGid)) return false;
	receipts.piGid = piGid;
	const piEntries = () => piEntriesOf(piGid);
	const piTools = (): SourceToolReceipt[] => piSourceToolReceipts(piEntries());

	// 6. the coordinator opens Claude Code on the herdr rail (or answered without calling fresh — STOP)
	const launched = await take.until("the coordinator's entwurf_fresh_call(claude-code) result", TURN_WAIT_MS, () => {
		const call = piTools().find(
			(t) => t.toolName === "entwurf_fresh_call" && t.arguments.backend === "claude-code" && t.status !== "pending",
		);
		if (call) return { call };
		return piEntries().some(isStop) ? { call: null } : null;
	});
	if (!launched) return false;
	if (!take.must("the coordinator's MCP surface carried entwurf_fresh_call", launched.call !== null)) return false;
	const launch = launched.call as SourceToolReceipt;
	receipts.launch = { arguments: launch.arguments, text: launch.text };
	if (
		!take.must(
			"coordinator called entwurf_fresh_call(backend claude-code, model sonnet) and got a launch receipt",
			launch.status === "completed" && launch.arguments.model === CC_MODEL,
			launch.text,
		)
	)
		return false;
	const nonce = NONCE.exec(launch.text)?.[1];
	const ccTab = herdrLaunchTab(launch.text);
	if (
		!take.must(
			"the herdr rail answered: a new tab in the coordinator's own workspace, and a nonce",
			!!nonce && ccTab !== null && ccTab.workspaceId === workspaceId,
			launch.text,
		)
	)
		return false;
	const ccTabId = (ccTab as NonNullable<typeof ccTab>).tabId;
	await sleep(2500);
	if (!focus(ccTabId, "Claude Code opens in its own tab; its first action is the callback")) return false;

	// 7. the callback is the address; the sibling is a claude-code record whose transcript its hook named
	const ccGid = await take.until("the Claude Code callback in the coordinator's transcript", TURN_WAIT_MS, () => {
		const s = piCallbackSenders(piEntries(), nonce as string);
		return s.length === 1 ? s[0] : null;
	});
	if (!ccGid) return false;
	if (!take.must("Claude Code called back with the exact nonce", GARDEN_ID.test(ccGid), ccGid)) return false;
	known.ccGid = ccGid;
	if (!take.must("the address came from the callback, not the launch receipt", !launch.text.includes(ccGid)))
		return false;
	const ccRecord = meta.readMetaIdentityByGardenId(ccGid);
	receipts.ccGid = ccGid;
	receipts.ccRecord = ccRecord;
	if (
		!take.must(
			"the sibling is a claude-code record in this take's cwd with a transcript path",
			ccRecord?.backend === "claude-code" && ccRecord.cwd === scratch && !!ccRecord.transcriptPath,
			JSON.stringify(ccRecord),
		)
	)
		return false;
	const firstModels = await take.until("Claude Code's first assistant row", 60_000, () => {
		const m = claudeNativeView(ccRows(ccGid)).models;
		return m.length > 0 ? m : null;
	});
	if (
		!take.must(
			"Claude Code's callback turn answered in the requested alias's family (drift ends the take here)",
			!!firstModels && firstModels.length === 1 && isRequestedNativeModel(firstModels[0] as string),
			JSON.stringify(firstModels),
		)
	)
		return false;
	await sleep(2500);
	if (!focus(piTab, "callback arrives; the coordinator dispatches with entwurf_v2 (mailbox)")) return false;

	// 8. coordinator → Claude Code: a durable mailbox ENQUEUE (not a read, not an answer)
	const toCc = await take.until("the coordinator's entwurf_v2 → Claude Code result", TURN_WAIT_MS, () =>
		piTools().find((t) => t.toolName === "entwurf_v2" && t.arguments.target === ccGid && t.status !== "pending"),
	);
	if (!toCc) return false;
	receipts.piToCc = { arguments: toCc.arguments, text: toCc.text };
	if (
		!take.must(
			"coordinator → Claude Code answered as a mailbox ENQUEUE",
			toCc.status === "completed" && /meta-mailbox → enqueued/.test(toCc.text),
			toCc.text,
		)
	)
		return false;
	await sleep(2500);
	if (!focus(ccTabId, "Claude Code wakes on its own hook, reads its inbox, runs Bash, replies")) return false;

	// 9. the read receipt, then the reply under Claude Code's envelope
	const state = await take.until("Claude Code's read receipt", TURN_WAIT_MS, () => {
		const file = path.join(meta.defaultMetaMailboxDir(), ccGid, "state.json");
		const s = JSON.parse(fs.readFileSync(file, "utf8")) as { lastReadAt?: string; lastEnqueuedAt?: string };
		return s.lastReadAt && s.lastEnqueuedAt && Date.parse(s.lastReadAt) >= Date.parse(s.lastEnqueuedAt) ? s : null;
	});
	if (!state) return false;
	receipts.ccMailboxState = state;
	take.step("Claude Code read its own inbox (lastReadAt ≥ lastEnqueuedAt)", true, JSON.stringify(state));
	const reply = await take.until("Claude Code's reply landing in the coordinator", TURN_WAIT_MS, () =>
		piInbound(piEntries()).find((m) => m.sender === ccGid && m.payload.includes(token)),
	);
	if (!reply) return false;
	receipts.replyInPi = reply;
	take.step("Claude Code's reply landed in the coordinator under its sender envelope", true, reply.payload);
	await sleep(4000);
	if (!focus(piTab, "the reply arrives in pi as its own message; pi answers the operator")) return false;
	await take.until("the coordinator's closing answer", 180_000, () =>
		piEntries()
			.slice(reply.index + 1)
			.some(isStop)
			? true
			: null,
	);
	await sleep(6000);
	for (const v of judgePiReceipt(reply, piEntries(), expectation)) take.step(v.name, v.ok, v.detail);
	const closing = lastCompletedText(piEntries(), reply.index);
	take.step(
		"the question, the sibling's reply and pi's closing answer carry no Hangul (English-only take prompts)",
		!hasHangul(question) && !hasHangul(reply.payload) && closing !== null && !hasHangul(closing),
		JSON.stringify({ reply: reply.payload, closing }),
	);

	// 10. native evidence: Claude Code's own transcript (receive, Bash, reply) and its model
	const rows = ccRows(ccGid);
	const view = claudeNativeView(rows);
	receipts.ccNative = { models: view.models, sessionIds: view.sessionIds, cwds: view.cwds, bash: view.bash };
	for (const v of judgeClaudeNativeWork(view, String(ccRecord?.nativeSessionId), scratch, expectation))
		take.step(v.name, v.ok, v.detail);
	for (const v of judgeClaudeCodeReceive(rows, ccGid, piGid, CONTROL_SOCKET_BOUNDARY))
		take.step(v.name, v.ok, v.detail);
	take.step(
		"Claude Code answered in the requested alias's family on every row (observed ids recorded)",
		view.models.length > 0 && view.models.every(isRequestedNativeModel),
		JSON.stringify(view.models),
	);

	// 11. the coordinator did no work itself; models measured; exactly two citizens minted in the fence
	const coordinatorBash = piTools().filter((t) => t.toolName === "bash");
	take.step(
		"the coordinator ran no bash itself (the work is the sibling's)",
		coordinatorBash.length === 0,
		JSON.stringify(coordinatorBash),
	);
	const piModels = piAssistantModels(piEntries());
	receipts.piModels = piModels;
	take.measuredModels = { pi: piModels, "Claude Code (native)": view.models };
	take.step(
		"coordinator actual model (transcript assistant rows)",
		piModels.length === 1 && piModels[0] === PI_MODEL,
		piModels.join(" "),
	);
	const minted = newCitizensIn(scratch, citizensBefore);
	take.step(
		"exactly two citizens minted in this take's cwd (coordinator pi, Claude Code)",
		minted.length === 2 && minted.includes(piGid) && minted.includes(ccGid),
		minted.join(", "),
	);
	return true;
}

/** Finish scope: copy raw for what the take established — on a pass and on every early stop alike. */
function collectRaw(): void {
	const errors: string[] = [];
	const copy = (from: string | null | undefined, name: string) => {
		try {
			if (from && fs.existsSync(from)) fs.copyFileSync(from, path.join(take.takeDir, name));
			else if (from) errors.push(`${name}: ${from} absent`);
		} catch (err) {
			errors.push(`${name}: ${err instanceof Error ? err.message : String(err)}`);
		}
	};
	if (known.piGid) copy(meta.readMetaIdentityByGardenId(known.piGid)?.transcriptPath, "pi-transcript.jsonl");
	if (known.ccGid) copy(meta.readMetaIdentityByGardenId(known.ccGid)?.transcriptPath, "claude-code-transcript.jsonl");
	if (errors.length > 0) take.receipts.collectErrors = errors;
}

const passed = await run().catch((err) => {
	take.step("take aborted", false, err instanceof Error ? (err.stack ?? err.message) : String(err));
	return false;
});
collectRaw();
const ok = await take.finish(passed, {
	selectors: { pi: PI_MODEL, piThinking: PI_THINKING, claudeCode: CC_MODEL },
	token,
	operatorInput: {
		kind: "argv of `herdr agent start --kind pi` (take-only extension flags + herdr's pi integration)",
		argv: piArgs.slice(0, -1),
		text: firstTask,
	},
	herdr: { version: herdrVersion, fenceRoot, serverLog: path.join(fenceRoot, "herdr-server.log") },
	measuredModels: take.measuredModels,
});
const serverLogPath = path.join(fenceRoot, "herdr-server.log");
if (fs.existsSync(serverLogPath)) fs.copyFileSync(serverLogPath, path.join(take.takeDir, "herdr-server.log"));
process.exit(ok ? 0 : 1);
