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
import {
	applyOmpBridgeChildRootPolicy,
	listAllMetaIdentitiesDir,
	type MetaRootBundle,
	MetaRootPolicyError,
	OMP_BRIDGE_PROVENANCE_LABEL,
	ompMetaRoots,
	processStartKey,
	readMetaReceiverMarker,
} from "../pi-extensions/lib/meta-session.ts";

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
	env: {
		...process.env,
		HOME: path.join(root, "assembler-home"),
		XDG_DATA_HOME: path.join(root, "assembler-xdg"),
		ENTWURF_OMP_ASM: asm,
	},
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

/**
 * ONE SANDBOX HOME PER SCENARIO, AND THE DOUBLE-DUTY KNOB IS POISON IN ALL OF THEM.
 *
 * Hard Rule 12 wants HOME, `PI_CODING_AGENT_DIR` and every writable XDG root fenced, and
 * the first version of this gate fenced neither HOME nor XDG — it relocated the store with
 * `PI_CODING_AGENT_DIR` instead, which after #87 B1 is exactly the variable an OMP surface
 * must ignore. So the relocation moved to HOME, and PI became a POISON path every scenario
 * carries: a single artifact under it means some OMP surface still derives a garden root
 * from the vendor's own agent-dir variable. `<home>/omp-profile-agent` is not a decorative
 * name — that is the shape `omp --profile work` actually produces
 * (`oh-my-pi` v18.0.0 `utils/src/dirs.ts:452-473`).
 *
 * The four `ENTWURF_META_*` overrides are stripped by default (so the DEFAULT policy is
 * what every scenario exercises) and passed explicitly only by the override cell.
 */
function piPoison(home: string): string {
	return path.join(home, "omp-profile-agent");
}
function agentDir(home: string): string {
	return path.join(home, ".pi", "agent");
}
function isolatedEnv(home: string, overrides?: MetaRootBundle): NodeJS.ProcessEnv {
	const env: NodeJS.ProcessEnv = { ...process.env };
	env.HOME = home;
	env.PI_CODING_AGENT_DIR = piPoison(home);
	env.XDG_DATA_HOME = path.join(home, ".local", "share");
	env.XDG_CONFIG_HOME = path.join(home, ".config");
	env.XDG_STATE_HOME = path.join(home, ".local", "state");
	env.XDG_CACHE_HOME = path.join(home, ".cache");
	env.XDG_RUNTIME_DIR = path.join(home, ".run");
	delete env.ENTWURF_META_SESSIONS_DIR;
	delete env.ENTWURF_META_MAILBOX_DIR;
	delete env.ENTWURF_META_SENDERS_DIR;
	delete env.ENTWURF_META_RECEIVERS_DIR;
	if (overrides) {
		env.ENTWURF_META_SESSIONS_DIR = overrides.sessionsDir;
		env.ENTWURF_META_MAILBOX_DIR = overrides.mailboxDir;
		env.ENTWURF_META_SENDERS_DIR = overrides.sendersDir;
		env.ENTWURF_META_RECEIVERS_DIR = overrides.receiversDir;
	}
	return env;
}

function runHost(env: NodeJS.ProcessEnv, edges: Edge[]): HostResult {
	const res = spawnSync(
		process.execPath,
		["--experimental-strip-types", "--disable-warning=ExperimentalWarning", harness, JSON.stringify({ entry, edges })],
		{ env, encoding: "utf8" },
	);
	const parsed = res.stdout?.trim()
		? (JSON.parse(res.stdout.trim().split("\n").pop() as string) as Omit<HostResult, "status" | "stderr">)
		: { pid: 0, boundEvents: [], statuses: [] };
	return { ...parsed, status: res.status, stderr: res.stderr ?? "" };
}

function host(home: string, edges: Edge[], overrides?: MetaRootBundle): HostResult {
	mkdirSync(home, { recursive: true });
	return runHost(isolatedEnv(home, overrides), edges);
}
/**
 * Same mock host, but LEFT RUNNING so the production sender resolver can be exercised the
 * way it runs in production: against a live owner. `readMetaSenderMarker`'s second guard is
 * pid + start-key — the owner must still be the very process that wrote the marker — so a
 * resolver assertion taken after the child exited would be asserting that a dead session
 * names nobody, which is a different (and already covered) fact.
 */
function hostHeld(home: string, edges: Edge[]): { pid: number; kill: () => void } {
	mkdirSync(home, { recursive: true });
	const resultFile = path.join(home, "host-result.json");
	const child = spawn(
		process.execPath,
		[
			"--experimental-strip-types",
			"--disable-warning=ExperimentalWarning",
			harness,
			JSON.stringify({ entry, edges, resultFile, hold: true }),
		],
		{ env: isolatedEnv(home), stdio: "ignore" },
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

function records(home: string): ReturnType<typeof listAllMetaIdentitiesDir>["identities"] {
	const dir = path.join(agentDir(home), "meta-sessions");
	if (!existsSync(dir)) return [];
	return listAllMetaIdentitiesDir(dir).identities;
}
function hookLog(home: string): string {
	const file = path.join(agentDir(home), "meta-bridge-hook.log");
	return existsSync(file) ? readFileSync(file, "utf8") : "";
}
/** What the cell's garden root actually contains — "" when nothing ever wrote there. */
function agentEntries(home: string): string[] {
	const dir = agentDir(home);
	return existsSync(dir) ? readdirSync(dir) : [];
}

const CWD = "/home/junghan/repos/gh/entwurf";
const HOST_ID = "01a042da-537a-7770-a275-7b8162eecca4";
const HOST_FILE =
	"/home/junghan/.omp/agent/sessions/-tmp/2026-08-27T10-53-19-610Z_01a042da-537a-7770-a275-7b8162eecca4.jsonl";

// ── 2.5 the OMP four-root joint binding, part 1 — the policy itself ────────
//
// THE DEFECT THIS REPLANTS. `PI_CODING_AGENT_DIR` means "pi's persistence root" to entwurf
// and "my agent dir" to the OMP vendor, and `setProfile` exports it for every named profile
// (`oh-my-pi` v18.0.0 `utils/src/dirs.ts:452-473`). A birth path that resolved through the
// shared default therefore minted an `omp --profile work` session's record and marker into
// a DIFFERENT garden store — a pi sandbox, if that is where the value came from.
//
// ALL FOUR ROOTS, NOT THE TWO BIRTH WRITES TO. Splitting mailbox from receivers is the
// dangerous cell: dispatch can trust an armed receiver marker in one root and enqueue into
// the mailbox of the other while the real watcher drains the first — false deliverability.
// Bundle A creates no receive artifact, so mailbox and receivers are checked as RETURNED
// VALUES here; bundle B will consume the same two members.
//
// THE ORACLE IS NOT THE PRODUCTION RESOLVER, and that is the whole design of this cell.
// Comparing "what the extension computed" against "what the production resolver computes"
// is COMMON MODE: if both halves shared the same wrong fallback the equation would still
// balance and the mutant would survive semantically green. So the expected paths are
// literals built HERE, from the sandbox HOME this gate chose, and each subject is compared
// against those literals independently.
//
// WHY IT RUNS BEFORE THE BIRTH SECTIONS. A root-policy defect moves EVERY artifact this
// gate asserts on, so left at the end it would trip the plain tui-mint claim first and
// its own mutant would be killed for the wrong reason. The pure half — which no other
// mutant can touch — is asked first; the "did the extension really write there" half is
// asked at the end, after the claims it would otherwise pre-empt.

/** The REAL MCP writer's entry env, driven into a temp file. If the managed entry ever
 * carried a HOME or a meta-root key, the vendor's `{...parent, ...entry.env}` composition
 * could make the child resolve differently from the host no matter how correct the shared
 * leaf is — so this keyset is read from the writer's own bytes, not assumed. */
const managedEntryEnv: Record<string, string> = (() => {
	const cfgDir = mkdtempSync(path.join(root, "mcp-entry."));
	const cfg = path.join(cfgDir, "mcp.json");
	execFileSync(
		"python3",
		[
			path.join(REPO, "scripts", "omp-mcp-config.py"),
			"install",
			cfg,
			"entwurf-bridge",
			"[]",
			path.join(cfgDir, "state.json"),
		],
		{ stdio: "pipe" },
	);
	const written = JSON.parse(readFileSync(cfg, "utf8")) as {
		mcpServers: Record<string, { env?: Record<string, string> }>;
	};
	return written.mcpServers["entwurf-bridge"].env ?? {};
})();
ok(
	"the managed MCP entry's env is PROVENANCE-ONLY — it cannot hand the bridge child a HOME or a meta root",
	JSON.stringify(Object.keys(managedEntryEnv).sort()) === JSON.stringify(["ENTWURF_BRIDGE_EXTERNAL_AGENT_ID"]) &&
		managedEntryEnv.ENTWURF_BRIDGE_EXTERNAL_AGENT_ID === OMP_BRIDGE_PROVENANCE_LABEL,
);

/** The vendor's own child-env composition: parent env plus the managed entry's env
 * (`oh-my-pi` v18.0.0 `mcp/transports/stdio.ts:575-607`). Never a hand-picked subset. */
function composeChildEnv(hostEnv: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
	return { ...hostEnv, ...managedEntryEnv };
}
function bundleEquals(a: MetaRootBundle, b: MetaRootBundle): boolean {
	return (
		a.sessionsDir === b.sessionsDir &&
		a.mailboxDir === b.mailboxDir &&
		a.sendersDir === b.sendersDir &&
		a.receiversDir === b.receiversDir
	);
}

interface RootCell {
	label: string;
	home: string;
	want: MetaRootBundle;
	/** Set only by the override cell; the default cell must exercise the DEFAULT policy. */
	overrides?: MetaRootBundle;
}
// CELL 1 — the DEFAULT policy under a poisoned, profile-shaped PI value. This is the cell
// the exact-once mutant has to fail: restore the legacy PI fallback inside the shared leaf
// and the whole bundle moves under `<home>/omp-profile-agent`.
const defaultCellHome = path.join(root, "roots-default");
// CELL 2 — all four `ENTWURF_META_*` overrides, at four DISTINCT paths. Hard Rule 12
// sandboxing has to keep working, and each override has to be honoured on its own axis:
// one shared prefix would let a single wrong join satisfy all four assertions.
const overrideCellHome = path.join(root, "roots-override");
const overrideCellDirs: MetaRootBundle = {
	sessionsDir: path.join(overrideCellHome, "ov-a", "records"),
	mailboxDir: path.join(overrideCellHome, "ov-b", "post"),
	sendersDir: path.join(overrideCellHome, "ov-c", "who-sent"),
	receiversDir: path.join(overrideCellHome, "ov-d", "watchers"),
};
const ROOT_CELLS: RootCell[] = [
	{
		label: "default roots",
		home: defaultCellHome,
		want: {
			sessionsDir: path.join(defaultCellHome, ".pi", "agent", "meta-sessions"),
			mailboxDir: path.join(defaultCellHome, ".pi", "agent", "meta-mailbox"),
			sendersDir: path.join(defaultCellHome, ".pi", "agent", "meta-senders"),
			receiversDir: path.join(defaultCellHome, ".pi", "agent", "meta-receivers"),
		},
	},
	{
		label: "four distinct overrides",
		home: overrideCellHome,
		want: overrideCellDirs,
		overrides: overrideCellDirs,
	},
];

for (const cell of ROOT_CELLS) {
	const hostEnv = isolatedEnv(cell.home, cell.overrides);
	ok(
		`[QK:OMP-META-ROOT-JOINT-BINDING] ${cell.label}: the shared OMP leaf resolves all four roots to the expected paths`,
		bundleEquals(ompMetaRoots(hostEnv, cell.home), cell.want),
	);
	const childEnv = composeChildEnv(hostEnv);
	const applied = applyOmpBridgeChildRootPolicy(childEnv, cell.home);
	ok(
		`${cell.label}: the OMP-labeled bridge child resolves the SAME four roots`,
		applied.applied && applied.roots !== null && bundleEquals(applied.roots, cell.want),
	);
	ok(
		`${cell.label}: the child dropped the foreign PI_CODING_AGENT_DIR from its OWN env`,
		childEnv.PI_CODING_AGENT_DIR === undefined,
	);
	ok(
		`${cell.label}: every default-root consumer in that child now reads the expected bundle`,
		childEnv.ENTWURF_META_SESSIONS_DIR === cell.want.sessionsDir &&
			childEnv.ENTWURF_META_MAILBOX_DIR === cell.want.mailboxDir &&
			childEnv.ENTWURF_META_SENDERS_DIR === cell.want.sendersDir &&
			childEnv.ENTWURF_META_RECEIVERS_DIR === cell.want.receiversDir,
	);
	// ADDITIVE, not a global rewrite: a child that carries another harness's label keeps
	// its environment exactly as the vendor handed it over.
	const foreignChild = composeChildEnv(hostEnv);
	foreignChild.ENTWURF_BRIDGE_EXTERNAL_AGENT_ID = "external-mcp/claude-code";
	const foreignApplied = applyOmpBridgeChildRootPolicy(foreignChild, cell.home);
	ok(
		`${cell.label}: a child carrying another harness's label keeps PI and gets no OMP policy`,
		!foreignApplied.applied && foreignChild.PI_CODING_AGENT_DIR === piPoison(cell.home),
	);
}

// ── 2.6 the OMP meta-root override grammar ─────────────────────────────────
//
// A garden root has to mean the same directory in two processes that do NOT share a
// working directory: the extension's cwd is wherever the operator launched omp, and the
// doctor's is the repository (`run_ts` cd's there). `path.resolve` on a relative value
// therefore makes cwd an authority, and the two halves silently address different stores —
// measured with one `ENTWURF_META_SESSIONS_DIR=relative-records` landing in two places
// (#87 A2, Terra review). So the grammar is absolute or `~`/`~/…`, and everything else is a
// NAMED refusal both halves receive from the same leaf. `~user` is refused too: it is not
// HOME, and nothing here resolves another account's home.
{
	const relHome = path.join(root, "roots-relative");
	for (const rejected of ["relative-records", "./relative-records", "../sideways", "~other/records"]) {
		const hostEnv = isolatedEnv(relHome);
		hostEnv.ENTWURF_META_SESSIONS_DIR = rejected;
		let leafRefusal: unknown;
		try {
			ompMetaRoots(hostEnv, relHome);
		} catch (err) {
			leafRefusal = err;
		}
		ok(
			`[QK:OMP-META-ROOT-ABSOLUTE-ONLY] the shared leaf REFUSES ${JSON.stringify(rejected)} instead of resolving it against a cwd`,
			leafRefusal instanceof MetaRootPolicyError && leafRefusal.message.includes("ENTWURF_META_SESSIONS_DIR"),
		);
		const childEnv = composeChildEnv(hostEnv);
		let childRefusal: unknown;
		try {
			applyOmpBridgeChildRootPolicy(childEnv, relHome);
		} catch (err) {
			childRefusal = err;
		}
		ok(
			`the OMP-labeled bridge child gets the SAME refusal for ${JSON.stringify(rejected)}`,
			childRefusal instanceof MetaRootPolicyError,
		);
		// The refusal happens BEFORE any mutation — the policy resolves first and only then
		// touches the env — so a refused child is left exactly as the vendor handed it over.
		ok(
			`${JSON.stringify(rejected)}: the refused child mutated NOTHING (PI kept, no override pinned)`,
			childEnv.PI_CODING_AGENT_DIR === piPoison(relHome) &&
				childEnv.ENTWURF_META_SESSIONS_DIR === rejected &&
				childEnv.ENTWURF_META_MAILBOX_DIR === undefined &&
				childEnv.ENTWURF_META_SENDERS_DIR === undefined &&
				childEnv.ENTWURF_META_RECEIVERS_DIR === undefined,
		);
	}
	// The ACCEPTED half of the same grammar, so the refusal above is a boundary and not a ban.
	for (const [accepted, want] of [
		["~", path.join(relHome, "meta-sessions")],
		["~/garden/records", path.join(relHome, "garden", "records")],
	] as Array<[string, string]>) {
		const hostEnv = isolatedEnv(relHome);
		hostEnv.ENTWURF_META_SESSIONS_DIR = accepted;
		ok(
			`${JSON.stringify(accepted)} is accepted and expands from HOME, which both halves share`,
			// `~` alone names the root itself, so the leaf appends nothing — assert the exact
			// literal each form must produce rather than a prefix.
			ompMetaRoots(hostEnv, relHome).sessionsDir === (accepted === "~" ? relHome : want),
		);
	}
}

// ── 2.7 the child policy selects on the EXACT raw provenance label ──────────
// The writer emits the literal and `doctor-omp-mcp` compares the literal, so a
// whitespace-drifted entry is FOREIGN to both. Trimming here made it foreign to the doctor
// and ours to the child — an entry the doctor calls red would still mutate that child's
// garden roots (#87 A3, Terra review).
{
	const labelHome = path.join(root, "label-drift");
	for (const drifted of [
		" external-mcp/omp",
		"external-mcp/omp ",
		"\texternal-mcp/omp",
		"external-mcp/omp\t",
		"external-mcp/omp\n",
		"external-mcp/OMP",
	]) {
		const hostEnv = isolatedEnv(labelHome);
		const childEnv = composeChildEnv(hostEnv);
		childEnv.ENTWURF_BRIDGE_EXTERNAL_AGENT_ID = drifted;
		const applied = applyOmpBridgeChildRootPolicy(childEnv, labelHome);
		ok(
			`a drifted provenance label ${JSON.stringify(drifted)} does NOT select the OMP root policy`,
			!applied.applied && applied.roots === null,
		);
		ok(
			`${JSON.stringify(drifted)}: PI and all four overrides are untouched in that child`,
			childEnv.PI_CODING_AGENT_DIR === piPoison(labelHome) &&
				childEnv.ENTWURF_META_SESSIONS_DIR === undefined &&
				childEnv.ENTWURF_META_MAILBOX_DIR === undefined &&
				childEnv.ENTWURF_META_SENDERS_DIR === undefined &&
				childEnv.ENTWURF_META_RECEIVERS_DIR === undefined,
		);
	}
}

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
	ok(`${label}: writes no sender marker either`, !agentEntries(negStore).includes("meta-senders"));
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
const sendersDir = path.join(agentDir(store), "meta-senders");
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
		const liveSenders = path.join(agentDir(liveStore), "meta-senders");
		const trusted = withSessionsDir(path.join(agentDir(liveStore), "meta-sessions"), () =>
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
			withSessionsDir(path.join(agentDir(liveStore), "meta-sessions"), () =>
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
	withSessionsDir(path.join(agentDir(store), "meta-sessions"), () =>
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
		const orphanSenders = path.join(agentDir(orphanStore), "meta-senders");
		ok(
			"precondition: that store has its own marker too",
			existsSync(path.join(orphanSenders, "omp", `${orphan.pid}.json`)),
		);
		for (const f of readdirSync(path.join(agentDir(orphanStore), "meta-sessions")))
			rmSync(path.join(agentDir(orphanStore), "meta-sessions", f));
		// The owner is still ALIVE here, so this isolates the record-authority guard alone:
		// the marker is only a pid->garden hint, and the store is what must vouch for it.
		ok(
			"a marker whose record is gone resolves to NOBODY even while its owner lives — a hint is not an identity",
			withSessionsDir(path.join(agentDir(orphanStore), "meta-sessions"), () =>
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
//
// ASKED THROUGH THE CERTIFIED READER, NOT THROUGH `readdir` (#87 D3). "No `meta-receivers`
// directory" is a weaker claim than it looks: an empty directory arms nothing and changes
// no dispatch fact, so a mutant that merely created one was killed for the wrong reason
// while a real record-bound marker would have sailed past. The question dispatch actually
// asks is `readMetaReceiverMarker(gardenId)`, and that is the question asked here — for
// EVERY citizen this store minted, with the liveness guard off so a dead owner cannot
// hide a marker that exists.
{
	const receiversDir = path.join(agentDir(store), "meta-receivers");
	const armed = live.filter(
		(record) => readMetaReceiverMarker({ gardenId: record.gardenId, receiversDir, verifyOwner: false }) !== null,
	);
	ok(
		"[QK:OMP-BIRTH-DOES-NOT-ARM-RECEIVER] the certified receiver reader finds NO marker for ANY citizen birth minted",
		live.length >= 2 && armed.length === 0,
	);
	ok("and birth opens no mailbox root either", !agentEntries(store).includes("meta-mailbox"));
}
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

// ── 12. the four-root joint binding, part 2 — the extension really writes there ──
// Part 1 proved the two halves of the policy AGREE. This proves the birth extension is
// actually BOUND to it: the assembled unit, run for real, must leave its record, its sender
// marker and its hook log at the same literal paths — and nothing at all below the poisoned
// vendor knob. Deliberately last: a root defect moves every artifact in this file, so an
// earlier position here would pre-empt the claims above and kill their mutants for the
// wrong reason.
for (const cell of ROOT_CELLS) {
	const hostEnv = isolatedEnv(cell.home, cell.overrides);
	mkdirSync(cell.home, { recursive: true });
	const bornHere = runHost(hostEnv, [
		{
			event: "session_start",
			mode: "tui",
			cwd: CWD,
			managerCwd: CWD,
			sessionId: `omp-roots-${cell.label.replace(/[^a-z0-9]+/gi, "-")}`,
			sessionFile: HOST_FILE,
		},
	]);
	const minted = existsSync(cell.want.sessionsDir) ? listAllMetaIdentitiesDir(cell.want.sessionsDir).identities : [];
	ok(
		`${cell.label}: the extension minted its record under the expected sessions root`,
		bornHere.status === 0 && minted.length === 1 && minted[0]?.backend === "omp",
	);
	ok(
		`${cell.label}: its sender marker landed under the expected senders root`,
		existsSync(path.join(cell.want.sendersDir, "omp", `${bornHere.pid}.json`)),
	);
	ok(
		`${cell.label}: the hook log followed the same sessions-root policy`,
		existsSync(path.join(path.dirname(cell.want.sessionsDir), "meta-bridge-hook.log")),
	);
	ok(`${cell.label}: NOTHING was written below the poisoned PI_CODING_AGENT_DIR`, !existsSync(piPoison(cell.home)));
}

// ── 13. the meta-root refusal, end to end ──────────────────────────────────
// Part 2.6 proved the two halves refuse the same value. This proves what the refusal is
// WORTH: the real extension mints nothing anywhere, the refusal is still visible in the log
// (a policy that silenced its own diagnostic would be worse than the split), and the doctor
// goes RUNTIME RED instead of laundering an unrelated empty directory into NOT-YET.
// Deliberately last, for the same attribution reason as section 12.
{
	const relHome = path.join(root, "relative-live");
	mkdirSync(relHome, { recursive: true });
	const hostEnv = isolatedEnv(relHome);
	hostEnv.ENTWURF_META_SESSIONS_DIR = "relative-records";
	const refused = runHost(hostEnv, [
		{
			event: "session_start",
			mode: "tui",
			cwd: CWD,
			managerCwd: CWD,
			sessionId: "omp-relative-override",
			sessionFile: HOST_FILE,
		},
	]);
	ok(
		"a refused override mints NOTHING — not under HOME, and not against anyone's cwd",
		refused.status === 0 &&
			records(relHome).length === 0 &&
			!existsSync(path.join(relHome, "relative-records")) &&
			!existsSync(path.join(REPO, "relative-records")),
	);
	ok(
		"and the refusal is still LOGGED — the diagnostic falls back to the policy's own base, naming the variable",
		hookLog(relHome).includes("ENTWURF_META_SESSIONS_DIR"),
	);

	// The doctor half of the same claim. Its own preflight must refuse BEFORE it asks
	// `meta-facts`, whose `run_ts` would answer from the repository's cwd instead.
	const docHome = path.join(root, "relative-doctor");
	const docAgent = path.join(docHome, ".omp", "agent");
	mkdirSync(docAgent, { recursive: true });
	const doctorEnv: NodeJS.ProcessEnv = {
		...isolatedEnv(docHome),
		ENTWURF_OMP_AGENT_DIR: docAgent,
		ENTWURF_META_SESSIONS_DIR: "relative-records",
	};
	const doctored = spawnSync("bash", [path.join(REPO, "run.sh"), "doctor-omp-bridge"], {
		env: doctorEnv,
		encoding: "utf8",
	});
	const doctorOut = `${doctored.stdout ?? ""}${doctored.stderr ?? ""}`;
	ok(
		"the doctor is RUNTIME RED on a refused override, not NOT-YET about some other directory",
		doctored.status !== 0 && doctorOut.includes("REFUSES") && doctorOut.includes("runtime axis: FAIL"),
	);
	// Matched on the VERDICT lines, not on the word "NOT-YET" — the refusal message names
	// that verdict in order to say it is refusing to give it, and an assertion that matched
	// its own explanation would pass for the wrong reason.
	ok(
		"and it never claimed a store or a citizen count from the refused environment",
		!doctorOut.includes("garden citizen proven on this host") &&
			!doctorOut.includes("NOT-YET: zero certified") &&
			!doctorOut.includes("omp garden roots resolve to"),
	);
}

rmSync(root, { recursive: true, force: true });
console.log(`[check-omp-birth-hook] ${passed} assertions ok`);
