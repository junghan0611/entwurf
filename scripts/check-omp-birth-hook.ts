/**
 * check-omp-birth-hook — #87 gate: the OMP BIRTH path, proven without omp.
 *
 * WHAT IT BINDS. The chain from the shipped unit to a real garden citizen:
 *
 *   omp-bridge-install.sh --assemble-only   (the REAL assembler, into a temp dir)
 *     -> the assembled unit's own index.ts, imported the way omp imports it
 *       -> the factory bound to a MOCK ExtensionAPI, fired with a MOCK ExtensionContext
 *         -> mode "tui"   : a v3 record with backend "omp" + a sender marker + a status line
 *         -> every other  : nothing at all, and a log line saying so
 *
 * WHY A MOCK HOST RATHER THAN A SPAWNED LAUNCHER. The Claude and Copilot gates fire a
 * shipped shell launcher because those vendors EXEC a hook process. omp does not: it
 * imports the module into its own process and calls the exported factory
 * (`extensibility/extensions/types.ts:1592`; `--hook` aliases `--extension`). The
 * faithful hermetic stand-in for that is therefore a process that imports the assembled
 * entry and calls it — which is also what makes the pid assertions below meaningful.
 *
 * THE PID ORACLE IS INDEPENDENT OF THE WRITER. The child process IS the "omp host": the
 * gate knows its pid from `spawnSync` before reading any marker, and the gate's own pid is
 * the child's PARENT. So "the marker is keyed to the host's own pid, not to its parent"
 * is checked against two numbers this gate holds for reasons that have nothing to do with
 * the payload. That distinction is the whole step-6 difference between this backend and
 * the exec'd ones, and getting it backwards would key every omp citizen's marker to the
 * shell that launched omp.
 *
 * WHAT IT DOES NOT PROVE, and must not be read as proving. It proves the MECHANISM, not
 * the ADMISSION. §3.5 acceptance is a real omp TUI session minting exactly one record
 * while one real task subagent mints none (`adding-a-harness.md` step 3(b), 3.5(b)); a
 * mock context is gate evidence, never a live citizen.
 *
 * Hermetic: temp dirs only, no network, no omp, no model turn.
 */

import assert from "node:assert/strict";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveFactList } from "../pi-extensions/lib/entwurf-facts.ts";
import { nativePushSupported } from "../pi-extensions/lib/entwurf-v2-contract.ts";
import { META_SENDER_BACKENDS, resolveTrustedMetaSenderIdentity } from "../pi-extensions/lib/meta-sender-identity.ts";
import { listAllMetaIdentitiesDir, processStartKey } from "../pi-extensions/lib/meta-session.ts";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const UNIT = "entwurf-meta-omp";

let passed = 0;
function ok(label: string, cond: boolean): void {
	assert.ok(cond, label);
	console.log(`  ok    ${label}`);
	passed++;
}

const root = mkdtempSync(path.join(tmpdir(), "entwurf-omp-birth."));
const asm = path.join(root, "asm");

// ── 1. the real assembler ────────────────────────────────────────────────────
// Through `run.sh`, not straight at the script: the verb dispatch is part of the install
// surface (check-pack-install once caught a strict parser refusing its own verb).
execFileSync("bash", [path.join(REPO, "run.sh"), "install-omp-bridge", "--assemble-only"], {
	env: { ...process.env, ENTWURF_OMP_ASM: asm },
	stdio: "pipe",
});
const unit = path.join(asm, UNIT);
const entry = path.join(unit, "index.ts");
ok(
	"assembler produced the unit, its entry, the shared writer and the capability registry",
	[
		entry,
		path.join(unit, "package.json"),
		path.join(unit, "lib", "meta-session.ts"),
		path.join(unit, "lib", "session-id.js"),
		path.join(unit, "entwurf-capabilities.json"),
	].every((p) => existsSync(p)),
);
// The name is not decoration: omp discovers a subdirectory extension by `index.{ts,js}`
// (`discovery/helpers.ts:700-710`). Any other filename here is a unit the vendor never
// loads, and nothing else in this gate would notice.
ok("the entry is named index.ts — the name omp's subdirectory discovery rule looks for", existsSync(entry));
const pkg = JSON.parse(readFileSync(path.join(unit, "package.json"), "utf8")) as Record<string, unknown>;
// An ESM index.js under a directory with no nearest package.json `type` is read as
// CommonJS, which is the installed-package shape's silent failure.
ok('the unit package.json declares "type": "module"', pkg.type === "module");
ok(
	"the unit carries no `omp.extensions` declaration — discovery is the index rule, so nothing needs baking",
	pkg.omp === undefined,
);

// ── 2. the mock omp host ─────────────────────────────────────────────────────
// One child process per scenario, each with its own store. The child imports the
// ASSEMBLED entry (not the repo source), binds it to a mock ExtensionAPI, and fires the
// requested edges with mock ExtensionContexts.
const harness = path.join(root, "omp-host.mjs");
writeFileSync(
	harness,
	`
import { pathToFileURL } from "node:url";
const spec = JSON.parse(process.argv[2]);
const mod = await import(pathToFileURL(spec.entry).href);
const handlers = new Map();
const pi = { on: (event, handler) => { const list = handlers.get(event) ?? []; list.push(handler); handlers.set(event, list); } };
(mod.default ?? mod)(pi);
const statuses = [];
for (const edge of spec.edges) {
	const ctx = {
		mode: edge.mode,
		cwd: edge.cwd,
		hasUI: edge.hasUI ?? true,
		ui: edge.noUi ? {} : { setStatus: (key, text) => statuses.push([key, text]) },
		sessionManager: edge.noManager ? undefined : {
			getSessionId: () => edge.sessionId,
			getCwd: () => edge.managerCwd,
			getSessionFile: () => edge.sessionFile,
		},
	};
	for (const handler of handlers.get(edge.event) ?? []) {
		await handler({ type: edge.event, reason: edge.reason }, ctx);
	}
}
const result = JSON.stringify({ pid: process.pid, boundEvents: [...handlers.keys()].sort(), statuses });
process.stdout.write(result + "\\n");
if (spec.resultFile) {
	const { writeFileSync, renameSync } = await import("node:fs");
	writeFileSync(spec.resultFile + ".tmp", result + "\\n");
	renameSync(spec.resultFile + ".tmp", spec.resultFile);
}
// HOLD: the sender-marker guards are about a LIVE owner (pid + start-key), so the one
// scenario that runs the production resolver has to be resolved while this process still
// exists — a marker whose owner has exited names nobody, by design.
if (spec.hold) setInterval(() => {}, 1 << 30);
`,
	"utf8",
);

interface HostResult {
	pid: number;
	boundEvents: string[];
	statuses: Array<[string, string]>;
	status: number | null;
	stderr: string;
}
interface Edge {
	event: "session_start" | "session_switch";
	mode: string;
	cwd?: string;
	managerCwd?: string;
	sessionId?: string;
	sessionFile?: string;
	reason?: string;
	noManager?: boolean;
	noUi?: boolean;
	hasUI?: boolean;
}

/** The child's env: this gate's own, with the store relocated and every DIRECT store
 * override removed, so an operator shell pinning `ENTWURF_META_*_DIR` cannot send the
 * artifacts asserted on below into the real store (AGENTS.md Hard Rule 12). */
function isolatedEnv(storeDir: string): NodeJS.ProcessEnv {
	const env: NodeJS.ProcessEnv = { ...process.env, PI_CODING_AGENT_DIR: storeDir };
	delete env.ENTWURF_META_SENDERS_DIR;
	delete env.ENTWURF_META_SESSIONS_DIR;
	return env;
}

function host(storeDir: string, edges: Edge[]): HostResult {
	mkdirSync(storeDir, { recursive: true });
	const res = spawnSync(
		process.execPath,
		["--experimental-strip-types", "--disable-warning=ExperimentalWarning", harness, JSON.stringify({ entry, edges })],
		{ env: isolatedEnv(storeDir), encoding: "utf8" },
	);
	const parsed = res.stdout?.trim()
		? (JSON.parse(res.stdout.trim().split("\n").pop() as string) as Omit<HostResult, "status" | "stderr">)
		: { pid: 0, boundEvents: [], statuses: [] };
	return { ...parsed, status: res.status, stderr: res.stderr ?? "" };
}
/**
 * Same mock host, but LEFT RUNNING so the production sender resolver can be exercised the
 * way it runs in production: against a live owner. `readMetaSenderMarker`'s second guard is
 * pid + start-key — the owner must still be the very process that wrote the marker — so a
 * resolver assertion taken after the child exited would be asserting that a dead session
 * names nobody, which is a different (and already covered) fact.
 */
function hostHeld(storeDir: string, edges: Edge[]): { pid: number; kill: () => void } {
	mkdirSync(storeDir, { recursive: true });
	const resultFile = path.join(storeDir, "host-result.json");
	const child = spawn(
		process.execPath,
		[
			"--experimental-strip-types",
			"--disable-warning=ExperimentalWarning",
			harness,
			JSON.stringify({ entry, edges, resultFile, hold: true }),
		],
		{ env: isolatedEnv(storeDir), stdio: "ignore" },
	);
	const waiter = new Int32Array(new SharedArrayBuffer(4));
	for (let i = 0; i < 200 && !existsSync(resultFile); i++) Atomics.wait(waiter, 0, 0, 50);
	if (!existsSync(resultFile)) {
		child.kill("SIGKILL");
		throw new Error("the held mock omp host never reported a result");
	}
	const parsed = JSON.parse(readFileSync(resultFile, "utf8")) as { pid: number };
	return { pid: parsed.pid, kill: () => child.kill("SIGKILL") };
}

function records(storeDir: string): ReturnType<typeof listAllMetaIdentitiesDir>["identities"] {
	const dir = path.join(storeDir, "meta-sessions");
	if (!existsSync(dir)) return [];
	return listAllMetaIdentitiesDir(dir).identities;
}
function hookLog(storeDir: string): string {
	const file = path.join(storeDir, "meta-bridge-hook.log");
	return existsSync(file) ? readFileSync(file, "utf8") : "";
}

const CWD = "/home/junghan/repos/gh/entwurf";
const HOST_ID = "01a042da-537a-7770-a275-7b8162eecca4";
const HOST_FILE =
	"/home/junghan/.omp/agent/sessions/-tmp/2026-08-27T10-53-19-610Z_01a042da-537a-7770-a275-7b8162eecca4.jsonl";

// ── 3. the visible tui host is born ──────────────────────────────────────────
const store = path.join(root, "store");
const born = host(store, [
	{ event: "session_start", mode: "tui", cwd: CWD, managerCwd: CWD, sessionId: HOST_ID, sessionFile: HOST_FILE },
]);
ok("the mock host exited 0 — best-effort, never breaks the operator's turn", born.status === 0);
// BOTH edges, because the name does not tell you when it fires: `/new`, fork and in-TUI
// resume re-fire as session_switch, NOT session_start (`agent-session.ts:6910-8074`, audit
// C2). A unit bound to session_start alone leaves every post-`/new` session unminted while
// its status line still shows the previous citizen's id.
ok(
	"[QK:OMP-BIRTH-BINDS-BOTH-EDGES] the factory binds exactly the two birth edges: session_start AND session_switch",
	JSON.stringify(born.boundEvents) === JSON.stringify(["session_start", "session_switch"]),
);
let live = records(store);
ok("[QK:OMP-BIRTH-TUI-MINTS] a tui session_start minted exactly one record", live.length === 1);
ok("the record's backend is omp", live[0]?.backend === "omp");
ok("the record joins on the vendor's own session id", live[0]?.nativeSessionId === HOST_ID);
ok("the record carries the session's cwd", live[0]?.cwd === CWD);
ok(
	"the record carries the vendor's transcript path and does not guess a model",
	live[0]?.transcriptPath === HOST_FILE && live[0]?.model === null,
);
const bornGardenId = live[0]?.gardenId ?? "";

// ── 4. visible identity (step 4) ─────────────────────────────────────────────
// `setStatus` is the ONLY surface that renders extension-owned text on a v18 TUI
// (`setFooter`/`setHeader` are literal no-ops, `extension-ui-controller.ts:139`; the
// built-in segment set is a closed enum). A citizen whose address is only visible by
// scraping records is not lifecycle parity (`adding-a-harness.md` step 4).
ok(
	"[QK:OMP-BIRTH-SHOWS-GARDEN-ID] the host's garden id was written to the status line",
	born.statuses.length === 1 && born.statuses[0][1].includes(bornGardenId),
);
ok("it is written under one owned key, not over the operator's line", born.statuses[0][0] === "entwurf");

// ── 5. the §3.5 scope fence ──────────────────────────────────────────────────
// EVERY task subagent re-emits session_start against a fresh copy of this factory and
// inherits the parent's MCP proxy tools by default (`task/executor.ts:3305`, `:3021-3024`),
// so this is the only thing standing between one visible sibling and a garden id per
// internal agent. `hasUI` is deliberately TRUE in the rpc rows below: it is true under
// rpc/rpc-ui/ACP in the real vendor too (`runner.ts:879-881`), so a fence that consulted
// it would admit exactly the sessions this refuses.
// THE DECISIVE ROW FIRST, with the claim's literal signature on it:
// a real task subagent runs `mode:"print"` with `hasUI:false` on the SAME OS pid as its
// host (`task/executor.ts:3115`, `:3252`, `:3305`), and it must leave the store exactly
// as it found it — the LIVE receipt for this is 519 records before and 519 after
// (`scripts/raw-omp-measure/README.md` §3.5).
{
	const hostStore = path.join(root, "host-then-subagent");
	host(hostStore, [
		{ event: "session_start", mode: "tui", cwd: CWD, managerCwd: CWD, sessionId: HOST_ID, sessionFile: HOST_FILE },
	]);
	const before = records(hostStore).length;
	host(hostStore, [
		{
			event: "session_start",
			mode: "print",
			hasUI: false,
			cwd: CWD,
			managerCwd: CWD,
			sessionId: "01a042dc-9540-7643-b3ef-99d223b459a9",
			sessionFile: `${HOST_FILE}/Greeting.jsonl`,
		},
	]);
	ok(
		"[QK:OMP-BIRTH-SCOPE-FENCE] a task subagent's own session_start mints NOTHING — one visible host, one garden id",
		before === 1 && records(hostStore).length === 1,
	);
}

for (const [label, mode, hasUI] of [
	["a task subagent (print)", "print", false],
	["rpc", "rpc", true],
	["rpc-ui / acp (mode is rpc, hasUI is TRUE)", "rpc", true],
	["--mode json", "json", false],
] as Array<[string, string, boolean]>) {
	const negStore = path.join(root, `neg-${mode}-${hasUI}`);
	const res = host(negStore, [
		{
			event: "session_start",
			mode,
			hasUI,
			cwd: CWD,
			managerCwd: CWD,
			sessionId: `sub-${mode}-${hasUI}`,
			sessionFile: HOST_FILE,
		},
	]);
	ok(`${label}: exits 0`, res.status === 0);
	ok(`${label}: mints NO record — it is not a citizen`, records(negStore).length === 0);
	ok(`${label}: writes no sender marker either`, !readdirSync(negStore).includes("meta-senders"));
	ok(`${label}: touches no status line`, res.statuses.length === 0);
	ok(
		`${label}: leaves the refusal in the log the doctor reads`,
		hookLog(negStore).includes(`scope-refused edge=session_start mode=${mode}`),
	);
}

// ── 6. the re-birth edge ─────────────────────────────────────────────────────
// `/new`, fork and in-TUI resume fire session_switch, NOT session_start
// (`agent-session.ts:6910-8074`, audit C2). A unit wired to session_start alone leaves
// every post-`/new` session unminted while its status line still shows the previous
// citizen's id.
const sw = host(store, [
	{
		event: "session_switch",
		mode: "tui",
		reason: "resume",
		cwd: CWD,
		managerCwd: CWD,
		sessionId: HOST_ID,
		sessionFile: HOST_FILE,
	},
]);
live = records(store);
ok(
	"a session_switch on the SAME native id attaches — still one record, same garden id",
	live.length === 1 && live[0]?.gardenId === bornGardenId && sw.status === 0,
);
ok(
	"and it re-renders the same garden id on the status line",
	sw.statuses.length === 1 && sw.statuses[0][1].includes(bornGardenId),
);

const NEW_ID = "01a042dc-9540-7643-b3ef-99d223b459a9";
const swNew = host(store, [
	{
		event: "session_switch",
		mode: "tui",
		reason: "new",
		cwd: CWD,
		managerCwd: CWD,
		sessionId: NEW_ID,
		sessionFile: HOST_FILE,
	},
]);
live = records(store);
ok(
	"a session_switch to a NEW native id mints the replacement's own record",
	live.length === 2 && live.some((r) => r.nativeSessionId === NEW_ID) && swNew.status === 0,
);
ok("the replacement is its own citizen, not a rewrite of the first", new Set(live.map((r) => r.gardenId)).size === 2);

// ── 7. WHO-SENT: the ONE-PROCESS join ────────────────────────────────────────
// This is the step-6 fact that differs from every exec'd backend. The bridge child's
// parent is the omp host itself (`mcp/transports/stdio.ts:41-57`: Linux `detached` is
// setsid only, so the child keeps omp as its parent), and the extension runs INSIDE that
// host — so the marker must be keyed to the host's OWN pid. Keyed to `process.ppid` it
// would name the shell that launched omp, and every marker would be looked up under a pid
// no bridge child is a child of.
const sendersDir = path.join(store, "meta-senders");
const ownMarker = path.join(sendersDir, "omp", `${swNew.pid}.json`);
ok("[QK:OMP-SENDER-MARKER-OWN-PID] the marker is keyed to the HOST process's own pid", existsSync(ownMarker));
ok(
	"and NOT to its parent — the gate is that parent, and a marker there would name the launching shell",
	!existsSync(path.join(sendersDir, "omp", `${process.pid}.json`)),
);
const marker = JSON.parse(readFileSync(ownMarker, "utf8")) as {
	backend?: string;
	gardenId?: string;
	nativeSessionId?: string;
	ownerPid?: number;
	ownerStartKey?: string;
};
ok(
	"the marker names the citizen minted on that edge",
	marker.gardenId === live.find((r) => r.nativeSessionId === NEW_ID)?.gardenId,
);
ok(
	"the marker agrees with the record on backend and native id",
	marker.backend === "omp" && marker.nativeSessionId === NEW_ID,
);
ok("the marker's ownerPid IS the host process's pid", marker.ownerPid === swNew.pid);
ok(
	"the marker carries the owner's start-key, so a reused pid cannot inherit this citizen",
	typeof marker.ownerStartKey === "string" && marker.ownerStartKey.length > 0,
);
ok(
	"the gate's own start-key is a different value — the two pids are genuinely different processes",
	marker.ownerStartKey !== processStartKey(process.pid) || swNew.pid === process.pid,
);

// The READ half. A marker nobody looks for is invisible — that asymmetry is exactly how
// #46 made an agy citizen send as an anonymous external host.
ok(
	"[QK:OMP-SENDER-READER-OPEN] omp is one of the backends the resolver scans — writer and reader open together or not at all",
	META_SENDER_BACKENDS.includes("omp"),
);
function withSessionsDir<T>(dir: string, fn: () => T): T {
	const prev = process.env.ENTWURF_META_SESSIONS_DIR;
	process.env.ENTWURF_META_SESSIONS_DIR = dir;
	try {
		return fn();
	} finally {
		if (prev === undefined) delete process.env.ENTWURF_META_SESSIONS_DIR;
		else process.env.ENTWURF_META_SESSIONS_DIR = prev;
	}
}
// Against a LIVE host, because that is the only state the resolver is allowed to trust.
{
	const liveStore = path.join(root, "live-owner");
	const held = hostHeld(liveStore, [
		{
			event: "session_start",
			mode: "tui",
			cwd: CWD,
			managerCwd: CWD,
			sessionId: "omp-live-0001",
			sessionFile: HOST_FILE,
		},
	]);
	try {
		const liveSenders = path.join(liveStore, "meta-senders");
		const trusted = withSessionsDir(path.join(liveStore, "meta-sessions"), () =>
			resolveTrustedMetaSenderIdentity({ ownerPids: [held.pid], sendersDir: liveSenders }),
		);
		ok(
			"the bridge resolver joins that marker to exactly ONE identity — the live citizen that wrote it",
			trusted?.identity.nativeSessionId === "omp-live-0001" && trusted?.identity.backend === "omp",
		);
		// The pid a real bridge child would present is its PARENT — the omp host — which is
		// exactly the pid this marker is keyed to. Reading it under the host's parent (this
		// gate) must find nothing: that is the difference between the one-process join and
		// the exec'd backends' parent join, checked from the reader's side too.
		ok(
			"and the host's PARENT resolves to nobody — the join key is the host itself",
			withSessionsDir(path.join(liveStore, "meta-sessions"), () =>
				resolveTrustedMetaSenderIdentity({ ownerPids: [process.pid], sendersDir: liveSenders }),
			) === null,
		);
	} finally {
		held.kill();
	}
}

// A marker whose owner has EXITED names nobody: the pid+start-key guard is what stops a
// dead session's reused pid from inheriting its garden id. `swNew.pid` is exactly that —
// the host that minted the replacement above and then exited.
ok(
	"a marker whose owner process is gone resolves to NOBODY — liveness is a guard, not a formality",
	withSessionsDir(path.join(store, "meta-sessions"), () =>
		resolveTrustedMetaSenderIdentity({ ownerPids: [swNew.pid], sendersDir }),
	) === null,
);

// The record store is the authority; the marker is only a hint it must agree with.
{
	const orphanStore = path.join(root, "orphan-marker");
	const orphan = hostHeld(orphanStore, [
		{
			event: "session_start",
			mode: "tui",
			cwd: CWD,
			managerCwd: CWD,
			sessionId: "omp-orphan-0001",
			sessionFile: HOST_FILE,
		},
	]);
	try {
		const orphanSenders = path.join(orphanStore, "meta-senders");
		ok(
			"precondition: that store has its own marker too",
			existsSync(path.join(orphanSenders, "omp", `${orphan.pid}.json`)),
		);
		for (const f of readdirSync(path.join(orphanStore, "meta-sessions")))
			rmSync(path.join(orphanStore, "meta-sessions", f));
		// The owner is still ALIVE here, so this isolates the record-authority guard alone:
		// the marker is only a pid->garden hint, and the store is what must vouch for it.
		ok(
			"a marker whose record is gone resolves to NOBODY even while its owner lives — a hint is not an identity",
			withSessionsDir(path.join(orphanStore, "meta-sessions"), () =>
				resolveTrustedMetaSenderIdentity({ ownerPids: [orphan.pid], sendersDir: orphanSenders }),
			) === null,
		);
	} finally {
		orphan.kill();
	}
}

// ── 8. birth does NOT arm a receiver ─────────────────────────────────────────
// omp HAS a documented wake surface (`pi.sendUserMessage`, "idle starts a turn"), and
// that is exactly why this assertion matters: a receiver marker claims that a LIVE
// process holds a watch. Nothing this unit installs holds one, so a marker written here
// would make the citizen read deliverable, wired to nothing, for as long as the TUI
// stayed open. Receive is bundle B's separate admission.
ok(
	"[QK:OMP-BIRTH-DOES-NOT-ARM-RECEIVER] birth creates no mailbox and no receiver marker",
	!readdirSync(store).includes("meta-mailbox") && !readdirSync(store).includes("meta-receivers"),
);
ok("omp is NOT native-push — a sender marker buys who-sent, never replyability", nativePushSupported("omp") === false);

// ── 9. the citizen is a PEER, and an honest one ─────────────────────────────
const facts = resolveFactList(live, []);
const peer = facts.peers.find((p) => p.gardenId === bornGardenId);
ok("the minted citizen appears in the peer fact list", peer !== undefined);
ok("its liveness is `unsupported` — no control-socket probe exists for this backend", peer?.liveness === "unsupported");

// ── 10. negatives: every refusal is a REFUSAL, not a guessed record ─────────
function refuses(label: string, edge: Edge, expectInLog: string): void {
	const negStore = path.join(root, `neg-${label.replace(/[^a-z0-9]+/gi, "-").slice(0, 40)}`);
	const res = host(negStore, [edge]);
	ok(`${label}: exits 0 (best-effort, never breaks the operator's turn)`, res.status === 0);
	ok(`${label}: writes NO record`, records(negStore).length === 0);
	ok(`${label}: logs an ERROR the doctor can read (${expectInLog})`, hookLog(negStore).includes(expectInLog));
}
// Two vendor-authoritative cwds that disagree is the case a `a ?? b` would swallow: the
// context we were handed is not trustworthy, so neither value may be minted.
refuses(
	"[QK:OMP-BIRTH-CWD-DISAGREEMENT] disagreeing ctx.cwd and sessionManager.getCwd()",
	{ event: "session_start", mode: "tui", cwd: CWD, managerCwd: "/tmp", sessionId: HOST_ID, sessionFile: HOST_FILE },
	"disagree",
);
refuses(
	"an empty session id",
	{ event: "session_start", mode: "tui", cwd: CWD, managerCwd: CWD, sessionId: "", sessionFile: HOST_FILE },
	"getSessionId() is not a non-empty string",
);
refuses(
	"no cwd from either source",
	{ event: "session_start", mode: "tui", sessionId: HOST_ID, sessionFile: HOST_FILE },
	"neither ctx.cwd nor sessionManager.getCwd()",
);
refuses(
	"no session manager at all",
	{ event: "session_start", mode: "tui", cwd: CWD, sessionId: HOST_ID, noManager: true },
	"ctx.sessionManager is missing",
);

// An absent transcript path is NOT a refusal: `getSessionFile()` is lazy and may
// legitimately name nothing yet (`session-manager.ts:1950-1952`).
{
	const lazyStore = path.join(root, "lazy-file");
	host(lazyStore, [{ event: "session_start", mode: "tui", cwd: CWD, managerCwd: CWD, sessionId: "omp-lazy-0001" }]);
	const lazy = records(lazyStore);
	ok(
		"a session whose transcript file does not exist YET is still born, with a null transcriptPath",
		lazy.length === 1 && lazy[0]?.transcriptPath === null,
	);
}

// A TUI with no usable status surface still becomes a citizen: rendering is not birth.
{
	const noUiStore = path.join(root, "no-ui");
	const res = host(noUiStore, [
		{
			event: "session_start",
			mode: "tui",
			cwd: CWD,
			managerCwd: CWD,
			sessionId: "omp-noui-0001",
			sessionFile: HOST_FILE,
			noUi: true,
		},
	]);
	ok(
		"a tui host with no setStatus is still minted — a missing render is not a missing citizen",
		records(noUiStore).length === 1 && res.status === 0,
	);
	ok("and the doctor is told the id did not render", hookLog(noUiStore).includes("status-refused"));
}

// ── 11. the shipped skeleton ────────────────────────────────────────────────
const shippedPkg = JSON.parse(
	readFileSync(path.join(REPO, "pi", "meta-bridge-omp", UNIT, "package.json"), "utf8"),
) as Record<string, unknown>;
ok(
	"the committed unit skeleton declares type:module and a non-empty version",
	shippedPkg.type === "module" && typeof shippedPkg.version === "string" && (shippedPkg.version as string).length > 0,
);
ok(
	"the committed skeleton ships no entry of its own — the entry is assembled from pi-extensions/",
	!existsSync(path.join(REPO, "pi", "meta-bridge-omp", UNIT, "index.ts")),
);

rmSync(root, { recursive: true, force: true });
console.log(`[check-omp-birth-hook] ${passed} assertions ok`);
