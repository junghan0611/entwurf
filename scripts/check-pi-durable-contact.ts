/**
 * G-contact (#129) — the real overlay durable app, the real compiled bridge, one host.
 * CHECKOUT-ONLY dev gate: an installed package refuses it in `run_ts` before it reads an input.
 *
 * LABEL: adapter-direct, harness-bypassed. The durable app is opened through the production
 * bootstrap composition from THIS checkout's carrier (pi/pi-durable/carrier/, under its resolver,
 * against the checkout's pinned pi SDK set — verified first), the contact is born, and its
 * registered tools are executed DIRECTLY in the host (scripts/pi-durable-contact-host.mjs). No
 * model turn, no ToolTask: this gate does NOT prove that the harness selects, validates or
 * replays these tools, that a model accepts their schema, or anything about send / delivery /
 * fresh / resume / visible identity. Of receive it observes only the ARM — the raw receiver marker,
 * the contact's own `receiver()` state and the bridge's replyability verdict — never a doorbell, an
 * admission or a drain; those are check-pi-durable-receive's.
 *
 * Input, required, not provisioned here (missing → SKIP, never a pass). The durable app itself is
 * no longer an input: it is this checkout's carrier, refused by name before anything spawns when it
 * or the SDK set it resolves is not the pin (#130).
 *   ENTWURF_PI_DURABLE_BRIDGE_ENTRY  <bundle>/mcp/entwurf-bridge/src/index.js emitted from THIS
 *                                    checkout into a private bundle (a shared/installed bridge
 *                                    carries the old backend list and is refused as stale) — the
 *                                    bundle must carry the `pi-durable-host` owner join
 *
 * Matrix: garden roots {default (PI_CODING_AGENT_DIR), explicit (contact options, distinct from
 * the default)} × open {fresh, --continue}. The explicit cells are the root-coupling proof: the
 * child inherits an environment that points at the DEFAULT roots, so it can only find the birth
 * if the contact bound it to the roots it wrote.
 *
 * Oracles are independent of the subject and of the bridge's sender resolver: records and
 * markers are read as raw JSON from roots this gate built, the durable session directory is
 * located by hashing the project path here, the bridge child is found by scanning /proc for a
 * process whose PPID is the host pid this gate spawned, and peers is asked through a SECOND bridge
 * whose parent is this gate — also the negative control that the host's identity does not leak
 * to a process it did not spawn. The host runs with poisoned identity carriers; the cell is green
 * only if the contact keeps them from its bridge child. That is proven at the SDK CONNECTOR BOUNDARY
 * — the spawn spec the adapter hands the production stdio connector, recorded by the host driver
 * (identity carrier names and the four root values only) — plus the bridge's own behaviour
 * (entwurf_self, the raw records/markers, peers). It is NOT a kernel child-environ observation:
 * this gate reads no /proc/<pid>/environ.
 *
 * After a host is spawned, every failure is THROWN, and the gate reaps only the processes it
 * owns — the host it spawned and the bridges observed as that host's children (pid + start key) —
 * before reporting the cause and any cleanup failure. `ENTWURF_PI_DURABLE_CONTACT_FAULT` is the
 * gate's own control for that path: `after-birth` throws right after the first birth;
 * `malformed-report` makes the gate's host driver send a non-JSON report line, which arrives while
 * the gate is already waiting for it (the pending-line path of `Host.next`).
 */
import { type ChildProcess, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { createInterface } from "node:readline";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { checkPiDurableRuntime, piDurableLayoutAt } from "../pi-extensions/lib/pi-durable-runtime.ts";
import { skipLive } from "./lib/live-skip.ts";
import {
	describeOperatorSnapshot,
	operatorPiDurableSnapshot,
	operatorSnapshotUnchanged,
} from "./lib/pi-durable-operator-guard.ts";

const LABEL = "check-pi-durable-contact";
const REPO = path.resolve(import.meta.dirname, "..");
const HOST_DRIVER = path.join(REPO, "scripts", "pi-durable-contact-host.mjs");
const REPORT_TIMEOUT_MS = 90_000;
const CLOSE_TIMEOUT_MS = 30_000;
const REAP_TIMEOUT_MS = 5_000;
const FAULT = process.env.ENTWURF_PI_DURABLE_CONTACT_FAULT?.trim() || undefined;
if (FAULT !== undefined && FAULT !== "after-birth" && FAULT !== "malformed-report") {
	console.error(
		`${LABEL}: unknown ENTWURF_PI_DURABLE_CONTACT_FAULT ${JSON.stringify(FAULT)} (only "after-birth", "malformed-report")`,
	);
	process.exit(2);
}

const bridgeInput = process.env.ENTWURF_PI_DURABLE_BRIDGE_ENTRY?.trim();
if (!bridgeInput) {
	skipLive(
		LABEL,
		"set ENTWURF_PI_DURABLE_BRIDGE_ENTRY=<bridge index.js emitted from this checkout into a private bundle>; " +
			"this gate does not provision it",
	);
}
const bridgeEntry = path.resolve(bridgeInput);

let passed = 0;
let failed = 0;
function ok(label: string, cond: boolean): void {
	if (cond) {
		console.log(`  ok    ${label}`);
		passed++;
	} else {
		console.log(`  FAIL  ${label}`);
		failed++;
	}
}
/** Pre-spawn only: nothing is owned yet, so exiting leaves nothing behind. */
function fatal(message: string): never {
	console.error(`${LABEL}: ${message}`);
	process.exit(1);
}

// ---------------------------------------------------------------------------
// 0. Inputs. A provisioned-but-wrong input is broken, not absent: these FAIL, they do not skip.
// ---------------------------------------------------------------------------
// The carrier and its SDK set are verified by the ONE verifier the managed launch, setup and the
// fresh preflight use (pi-extensions/lib/pi-durable-runtime.ts), from this checkout's layout.
const carrier = checkPiDurableRuntime(piDurableLayoutAt(REPO));
console.log("0. inputs: the checkout carrier and its pi SDK set, bridge bundle registry");
ok(
	`[QK:PDC-CARRIER-VERIFIED] this checkout's pi-durable carrier and the pi SDK set it resolves are the pin (${carrier.ok ? "verified" : `${carrier.reason}: ${carrier.detail}`})`,
	carrier.ok,
);
const resolver = carrier.ok ? carrier.resolver : "";
const bundleRoot = path.resolve(bridgeEntry, "..", "..", "..", "..");
const bundleRegistry = path.join(bundleRoot, "pi-extensions", "entwurf-capabilities.json");
const repoRegistry = path.join(REPO, "pi", "entwurf-capabilities.json");
ok(
	`[QK:PDC-BUNDLE-REGISTRY-MATCH] the bridge bundle carries a capability registry byte-identical to this checkout's (${bundleRegistry}) — a registry fact only; the bundle's code provenance is its build receipt, not this assertion`,
	fs.existsSync(bridgeEntry) &&
		fs.existsSync(bundleRegistry) &&
		fs.readFileSync(bundleRegistry).equals(fs.readFileSync(repoRegistry)),
);
// The compiled bundle's owner join is what decides the armed host's replyability below; a bundle
// emitted before the join would answer for the wrong source. Read from the emitted bytes, not inferred.
const bundleDeliverability = path.join(bundleRoot, "pi-extensions", "lib", "entwurf-deliverability.js");
const joinLine = fs.existsSync(bundleDeliverability)
	? (/SENDER_JOINED_RECEIVER_OWNER_KINDS\s*=\s*(\[[^\]]*\])/.exec(fs.readFileSync(bundleDeliverability, "utf8"))?.[1] ??
		"")
	: "";
ok(
	`[QK:PDC-BUNDLE-OWNER-JOIN] the bridge bundle's compiled owner join admits pi-durable-host (${joinLine || "not found"})`,
	joinLine.includes('"pi-durable-host"'),
);
if (failed > 0) fatal("inputs are not the verified carrier, this checkout's registry and owner join — refusing to run");

// ---------------------------------------------------------------------------
// Operator guard — COARSE and pi-durable-specific: the operator's own roots gain no pi-durable
// record, sender dir or durable session tree. Not a proof about any other operator byte.
// ---------------------------------------------------------------------------
const operatorAgent = path.join(os.homedir(), ".pi", "agent");
const operatorBefore = operatorPiDurableSnapshot(operatorAgent);

// ---------------------------------------------------------------------------
// Sandbox: private root, env built from nothing, children at umask 022.
// ---------------------------------------------------------------------------
const root = fs.mkdtempSync(path.join(os.tmpdir(), "pi-durable-contact-"));
const dirs = {
	home: path.join(root, "home"),
	agent: path.join(root, "agent"),
	tmp: path.join(root, "tmp"),
	projectDefault: path.join(root, "project-default"),
	projectExplicit: path.join(root, "project-explicit"),
	explicitSessions: path.join(root, "explicit-roots", "sessions"),
	explicitSenders: path.join(root, "explicit-roots", "senders"),
	explicitMailbox: path.join(root, "explicit-roots", "mailbox"),
	explicitReceivers: path.join(root, "explicit-roots", "receivers"),
	xdgConfig: path.join(root, "xdg", "config"),
	xdgCache: path.join(root, "xdg", "cache"),
	xdgData: path.join(root, "xdg", "data"),
	xdgState: path.join(root, "xdg", "state"),
};
for (const dir of Object.values(dirs)) fs.mkdirSync(dir, { recursive: true });
process.umask(0o022);
const sandboxEnv: Record<string, string> = {
	PATH: process.env.PATH ?? "/run/current-system/sw/bin",
	HOME: dirs.home,
	TMPDIR: dirs.tmp,
	XDG_CONFIG_HOME: dirs.xdgConfig,
	XDG_CACHE_HOME: dirs.xdgCache,
	XDG_DATA_HOME: dirs.xdgData,
	XDG_STATE_HOME: dirs.xdgState,
	PI_CODING_AGENT_DIR: dirs.agent,
	PI_OFFLINE: "1",
	NOSYSBASHRC: "1",
	TERM: "dumb",
};
const poisoned = {
	PI_SESSION_ID: "20260101T000000-000000",
	PI_AGENT_ID: "pi/poisoned",
	ENTWURF_META_SENDER_MARKER: path.join(root, "poisoned-marker.json"),
	ENTWURF_BRIDGE_NATIVE_HOST: "codex",
};
const hostEnv: Record<string, string> = {
	...sandboxEnv,
	...poisoned,
	...(FAULT === "malformed-report" ? { ENTWURF_PI_DURABLE_CONTACT_FAULT: FAULT } : {}),
};

interface RootsCase {
	name: "default" | "explicit";
	project: string;
	sessionsDir: string;
	sendersDir: string;
	mailboxDir: string;
	receiversDir: string;
	/** Extra host-driver argv: explicit roots go to the contact; default passes none. */
	hostArgs: string[];
}
const defaultRoots: RootsCase = {
	name: "default",
	project: dirs.projectDefault,
	sessionsDir: path.join(dirs.agent, "meta-sessions"),
	sendersDir: path.join(dirs.agent, "meta-senders"),
	mailboxDir: path.join(dirs.agent, "meta-mailbox"),
	receiversDir: path.join(dirs.agent, "meta-receivers"),
	hostArgs: [],
};
const explicitRoots: RootsCase = {
	name: "explicit",
	project: dirs.projectExplicit,
	sessionsDir: dirs.explicitSessions,
	sendersDir: dirs.explicitSenders,
	mailboxDir: dirs.explicitMailbox,
	receiversDir: dirs.explicitReceivers,
	hostArgs: [dirs.explicitSessions, dirs.explicitSenders, dirs.explicitMailbox, dirs.explicitReceivers],
};

// ---------------------------------------------------------------------------
// /proc helpers
// ---------------------------------------------------------------------------
function procStat(pid: number): { ppid: number; start: string } | null {
	try {
		const stat = fs.readFileSync(`/proc/${pid}/stat`, "utf8");
		const fields = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
		return { ppid: Number(fields[1]), start: fields[19] as string };
	} catch {
		return null;
	}
}

function procArgv(pid: number): string[] {
	try {
		return fs.readFileSync(`/proc/${pid}/cmdline`, "utf8").split("\0").filter(Boolean);
	} catch {
		return [];
	}
}

/** Every process whose PPID is `parent` and whose argv runs `entry`. */
function childrenRunning(parent: number, entry: string): number[] {
	return fs
		.readdirSync("/proc")
		.filter((n) => /^\d+$/.test(n))
		.map(Number)
		.filter((pid) => procStat(pid)?.ppid === parent && procArgv(pid).includes(entry));
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Wait (bounded) until `pid` with start key `start` no longer exists. */
async function goneWithin(pid: number, start: string, ms: number): Promise<boolean> {
	const deadline = Date.now() + ms;
	while (Date.now() < deadline) {
		if (procStat(pid)?.start !== start) return true;
		await sleep(50);
	}
	return procStat(pid)?.start !== start;
}

// ---------------------------------------------------------------------------
// Owned hosts: spawned here, reaped here — nothing else is touched.
// ---------------------------------------------------------------------------
interface OwnedProcess {
	pid: number;
	start: string;
}

interface Host {
	child: ChildProcess;
	pid: number;
	start: string;
	/** Bridges observed as this host's children, recorded while the host was alive. */
	bridges: OwnedProcess[];
	next(timeoutMs: number): Promise<Record<string, unknown>>;
	stderr(): string;
	exitCode: number | null | undefined;
	exited: Promise<number | null>;
}

const owned: Host[] = [];

function observeBridges(host: Host): void {
	for (const pid of childrenRunning(host.pid, bridgeEntry)) {
		const start = procStat(pid)?.start;
		if (start !== undefined && !host.bridges.some((b) => b.pid === pid)) host.bridges.push({ pid, start });
	}
}

function startHost(roots: RootsCase, mode: "new" | "continue"): Host {
	const child = spawn(process.execPath, ["--import", resolver, HOST_DRIVER, bridgeEntry, mode, ...roots.hostArgs], {
		cwd: roots.project,
		env: hostEnv,
		stdio: ["pipe", "pipe", "pipe"],
	});
	// Stream and process errors are recorded and surface through next()/exit — never as an
	// uncaught event that would skip the single cleanup (a write to an exited host's stdin is EPIPE).
	let streamError = "";
	child.on("error", (error) => {
		streamError += ` [host process error: ${error.message}]`;
	});
	child.stdin?.on("error", (error) => {
		streamError += ` [host stdin error: ${error.message}]`;
	});
	const pid = child.pid;
	if (pid === undefined) throw new Error(`the host did not spawn${streamError}`);
	let stderr = "";
	child.stderr?.on("data", (chunk: Buffer) => {
		stderr = (stderr + chunk.toString("utf8")).slice(-8192);
	});
	const queue: string[] = [];
	const waiters: ((line: string | null) => void)[] = [];
	let ended = false;
	createInterface({ input: child.stdout as NodeJS.ReadableStream })
		.on("line", (line) => {
			const waiter = waiters.shift();
			if (waiter) waiter(line);
			else queue.push(line);
		})
		.on("close", () => {
			ended = true;
			for (const waiter of waiters.splice(0)) waiter(null);
		});
	const host: Host = {
		child,
		pid,
		start: procStat(pid)?.start ?? "",
		bridges: [],
		stderr: () => stderr,
		exitCode: undefined,
		exited: new Promise<number | null>((resolve) =>
			child.on("exit", (code) => {
				host.exitCode = code;
				resolve(code);
			}),
		),
		next(timeoutMs) {
			const parse = (line: string, path: "queued" | "pending"): Record<string, unknown> => {
				try {
					return JSON.parse(line) as Record<string, unknown>;
				} catch (error) {
					throw new Error(
						`host sent a malformed line on the ${path}-line path (${(error as Error).message}): ${line.slice(0, 200)}`,
					);
				}
			};
			return new Promise((resolve, reject) => {
				const queued = queue.shift();
				if (queued !== undefined) return resolve(parse(queued, "queued"));
				if (ended) return reject(new Error(`host ended without a line${streamError}; stderr: ${stderr.trim()}`));
				const timer = setTimeout(
					() => reject(new Error(`host gave no line within ${timeoutMs}ms${streamError}; stderr: ${stderr.trim()}`)),
					timeoutMs,
				);
				// Runs in the readline callback, not the executor: a throw here would escape as an
				// uncaught exception, so every outcome is settled explicitly.
				waiters.push((line) => {
					clearTimeout(timer);
					if (line === null) {
						reject(new Error(`host ended without a line${streamError}; stderr: ${stderr.trim()}`));
						return;
					}
					try {
						resolve(parse(line, "pending"));
					} catch (error) {
						reject(error);
					}
				});
			});
		},
	};
	owned.push(host);
	return host;
}

/** Ask the host to close; it must answer and exit 0 within the bound. */
async function closeHost(host: Host): Promise<{ closed: boolean; code: number | null | undefined }> {
	host.child.stdin?.write("close\n");
	const line = await host.next(CLOSE_TIMEOUT_MS);
	await Promise.race([host.exited, sleep(CLOSE_TIMEOUT_MS)]);
	return { closed: line.closed === true, code: host.exitCode };
}

/**
 * Reap one owned host and the bridges observed under it: TERM, bounded wait, KILL, bounded wait.
 * A pid is signalled only while its start key still matches what was recorded.
 */
async function reap(host: Host): Promise<string[]> {
	const problems: string[] = [];
	if (host.exitCode === undefined && procStat(host.pid)?.start === host.start) observeBridges(host);
	const targets: (OwnedProcess & { what: string })[] = [
		{ pid: host.pid, start: host.start, what: "host" },
		...host.bridges.map((b) => ({ ...b, what: "bridge" })),
	];
	for (const target of targets) {
		if (procStat(target.pid)?.start !== target.start) continue;
		try {
			process.kill(target.pid, "SIGTERM");
		} catch (error) {
			problems.push(`${target.what} ${target.pid}: SIGTERM failed (${(error as Error).message})`);
		}
		if (await goneWithin(target.pid, target.start, REAP_TIMEOUT_MS)) continue;
		try {
			process.kill(target.pid, "SIGKILL");
		} catch (error) {
			problems.push(`${target.what} ${target.pid}: SIGKILL failed (${(error as Error).message})`);
		}
		if (!(await goneWithin(target.pid, target.start, REAP_TIMEOUT_MS))) {
			problems.push(`${target.what} ${target.pid} is still alive after SIGKILL`);
		}
	}
	return problems;
}

// ---------------------------------------------------------------------------
// Independent oracles
// ---------------------------------------------------------------------------
function recordsIn(dir: string): Record<string, unknown>[] {
	if (!fs.existsSync(dir)) return [];
	return fs
		.readdirSync(dir)
		.filter((n) => n.endsWith(".meta.json"))
		.map((n) => JSON.parse(fs.readFileSync(path.join(dir, n), "utf8")) as Record<string, unknown>);
}

/**
 * Durable session directories for a project, located by hashing its real path here. Only names in
 * the vendor's session grammar count: proper-lockfile keeps a `<session>.lock` DIRECTORY beside a
 * locked session (measured, first G-contact run), and that is not a session.
 */
const DURABLE_SESSION_NAME = /^\d{13}-[0-9a-f-]{36}$/;
function durableSessionDirs(project: string): string[] {
	const dir = path.join(
		dirs.agent,
		"experimental",
		"durable-sessions",
		createHash("sha256").update(fs.realpathSync(project)).digest("hex").slice(0, 24),
	);
	return fs.existsSync(dir)
		? fs.readdirSync(dir).filter((n) => DURABLE_SESSION_NAME.test(n) && fs.statSync(path.join(dir, n)).isDirectory())
		: [];
}

function lastJsonLine(text: string): Record<string, unknown> {
	const line = text.trim().split("\n").at(-1) ?? "";
	try {
		return JSON.parse(line) as Record<string, unknown>;
	} catch {
		return {};
	}
}

/** A bridge spawned by THIS gate on the case's roots — its parent is not the host. */
async function outsideBridge(roots: RootsCase): Promise<{ peers: string; self: { text: string; isError: boolean } }> {
	const transport = new StdioClientTransport({
		command: process.execPath,
		args: [bridgeEntry],
		env: {
			...sandboxEnv,
			ENTWURF_META_SESSIONS_DIR: roots.sessionsDir,
			ENTWURF_META_SENDERS_DIR: roots.sendersDir,
			ENTWURF_META_MAILBOX_DIR: roots.mailboxDir,
			ENTWURF_META_RECEIVERS_DIR: roots.receiversDir,
		},
		cwd: roots.project,
		stderr: "pipe",
	});
	transport.stderr?.on("data", () => {});
	const client = new Client({ name: "check-pi-durable-contact", version: "1" });
	try {
		await client.connect(transport);
	} catch (error) {
		// A failed connect may already have spawned the bridge: close the transport (which ends the
		// child it spawned) before rethrowing, so no unowned bridge outlives the gate; keep the cause.
		try {
			await transport.close();
		} catch (closeError) {
			throw new AggregateError([error, closeError], `outside bridge did not connect: ${(error as Error).message}`);
		}
		throw error;
	}
	try {
		const text = (r: Awaited<ReturnType<Client["callTool"]>>): string =>
			(Array.isArray(r.content) ? r.content : [])
				.flatMap((b) => (b.type === "text" && typeof b.text === "string" ? [b.text] : []))
				.join("\n");
		const peers = text(await client.callTool({ name: "entwurf_peers", arguments: {} }));
		const selfResult = await client.callTool({ name: "entwurf_self", arguments: {} });
		return { peers, self: { text: text(selfResult), isError: selfResult.isError === true } };
	} finally {
		await client.close();
	}
}

// ---------------------------------------------------------------------------
// The cell
// ---------------------------------------------------------------------------
interface HostReport {
	hostPid: number;
	session: { id: string; directory: string; cwd: string };
	attachment: {
		gardenId: string;
		action: string;
		recordPath: string;
		markerPath: string;
		roots: { sessionsDir: string; sendersDir: string; mailboxDir: string; receiversDir: string };
		bridgePid: number | null;
	};
	receiver: { status: string; gardenId?: string; markerPath?: string; admissions?: unknown[] };
	toolNames: string[];
	/** Spawn specs the adapter handed the production stdio connector, as the host driver recorded them. */
	bridgeSpecs?: {
		command: string;
		args: string[];
		cwd: string;
		identityCarrierPresent: Record<string, boolean>;
		rootCarriers: Record<string, string | null>;
	}[];
	self: string;
	peers: string;
	notices: string[];
	error?: string;
}

/**
 * The SDK connector-boundary QKs. They need only the case's roots and project, so they are judged on a
 * host's failure report too — before the gate throws that report's error, which stays the cause.
 */
function judgeBridgeSpec(
	report: { hostPid?: number; bridgeSpecs?: HostReport["bridgeSpecs"] },
	host: Host,
	roots: RootsCase,
	projectReal: string,
): void {
	// SDK connector boundary, not kernel environ: the ONE spawn spec the adapter handed the production
	// stdio connector, as the host driver recorded it. Absent, repeated, malformed or from another pid is red.
	const spec = report.hostPid === host.pid && report.bridgeSpecs?.length === 1 ? report.bridgeSpecs[0] : undefined;
	const identityNames = Object.keys(poisoned);
	ok(
		`[QK:PDC-BRIDGE-ENV-SCRUBBED] at the SDK connector boundary (the one spawn spec the adapter handed the production stdio connector — node on this gate's bridge entry in the project; not a kernel child-environ read), the bridge's environment carries none of the host's four poisoned identity carrier names (${report.bridgeSpecs?.length ?? "no"} spec(s), ${JSON.stringify(spec?.identityCarrierPresent ?? null)})`,
		spec !== undefined &&
			spec.command === process.execPath &&
			JSON.stringify(spec.args) === JSON.stringify([bridgeEntry]) &&
			spec.cwd === projectReal &&
			JSON.stringify(Object.keys(spec.identityCarrierPresent ?? {})) === JSON.stringify(identityNames) &&
			identityNames.every((name) => spec.identityCarrierPresent[name] === false),
	);
	ok(
		`[QK:PDC-BRIDGE-ROOTS-BOUND] at the same SDK connector boundary, the bridge's four root carriers are the case's literal roots, whatever the host inherited (${JSON.stringify(spec?.rootCarriers ?? null)})`,
		spec !== undefined &&
			Object.keys(spec.rootCarriers ?? {}).length === 4 &&
			spec.rootCarriers.ENTWURF_META_SESSIONS_DIR === roots.sessionsDir &&
			spec.rootCarriers.ENTWURF_META_SENDERS_DIR === roots.sendersDir &&
			spec.rootCarriers.ENTWURF_META_MAILBOX_DIR === roots.mailboxDir &&
			spec.rootCarriers.ENTWURF_META_RECEIVERS_DIR === roots.receiversDir,
	);
}

async function birthCell(
	step: string,
	roots: RootsCase,
	mode: "new" | "continue",
	expectGardenId: string | null,
): Promise<string> {
	console.log(`${step}. roots=${roots.name}, ${mode === "new" ? "fresh host" : "reopen with --continue"} (input 0)`);
	const projectReal = fs.realpathSync(roots.project);
	const defaultStoreBefore = recordsIn(defaultRoots.sessionsDir).length;
	const host = startHost(roots, mode);
	const report = (await host.next(REPORT_TIMEOUT_MS)) as unknown as HostReport;
	if (report.error !== undefined) {
		judgeBridgeSpec(report, host, roots, projectReal);
		throw new Error(`host failed: ${report.error}; stderr: ${host.stderr().trim()}`);
	}
	observeBridges(host);
	const gardenId = report.attachment.gardenId;
	if (FAULT === "after-birth") {
		console.log(
			`     owned: host=${host.pid} bridges=${host.bridges.map((b) => b.pid).join(",") || "none"} garden=${gardenId}`,
		);
		throw new Error("[controlled fault] after-birth: the gate fails on purpose with its host and bridge alive");
	}

	ok(
		`[QK:PDC-HOST-IS-SPAWNED] the reporting host is the process this gate spawned (${report.hostPid})`,
		report.hostPid === host.pid,
	);
	ok(
		`[QK:PDC-TOOLS] the registered extension exposes exactly entwurf_self, entwurf_peers, entwurf_v2, entwurf_inbox_read, entwurf_callback, entwurf_fresh_call, in that order (${report.toolNames.join(", ")})`,
		JSON.stringify(report.toolNames) ===
			JSON.stringify([
				"entwurf_self",
				"entwurf_peers",
				"entwurf_v2",
				"entwurf_inbox_read",
				"entwurf_callback",
				"entwurf_fresh_call",
			]),
	);

	const records = recordsIn(roots.sessionsDir);
	const record = records.find((r) => r.nativeSessionId === report.session.id) ?? {};
	ok(
		`[QK:PDC-ONE-RECORD] the case's store (${roots.sessionsDir}) holds exactly one record (got ${records.length})`,
		records.length === 1,
	);
	ok(
		`[QK:PDC-RECORD-BINDING] that record is pi-durable, keyed by the durable session id, at the project's real cwd (${String(record.backend)}, ${String(record.nativeSessionId)})`,
		record.backend === "pi-durable" && record.cwd === projectReal && record.gardenId === gardenId,
	);
	const sessionDirs = durableSessionDirs(roots.project);
	ok(
		`[QK:PDC-NATIVE-ID-IS-DIRECTORY] the native id is the one durable session directory under the project's hash (${sessionDirs.join(", ")})`,
		sessionDirs.length === 1 && sessionDirs[0] === report.session.id,
	);
	if (expectGardenId === null) {
		ok(
			`[QK:PDC-CREATE] a fresh host creates its record (action ${report.attachment.action})`,
			report.attachment.action === "create",
		);
	} else {
		ok(
			`[QK:PDC-REOPEN-SAME-GARDEN] --continue reattaches the same garden id (${gardenId} vs ${expectGardenId}, action ${report.attachment.action})`,
			gardenId === expectGardenId && report.attachment.action === "attach",
		);
	}
	ok(
		`[QK:PDC-ROOTS-REPORTED] the contact reports the case's four roots (${Object.values(report.attachment.roots).join(", ")})`,
		report.attachment.roots.sessionsDir === roots.sessionsDir &&
			report.attachment.roots.sendersDir === roots.sendersDir &&
			report.attachment.roots.mailboxDir === roots.mailboxDir &&
			report.attachment.roots.receiversDir === roots.receiversDir,
	);
	if (roots.name === "explicit") {
		const defaultRecords = recordsIn(defaultRoots.sessionsDir);
		ok(
			`[QK:PDC-EXPLICIT-NO-DEFAULT-WRITE] an explicit-root birth leaves the default roots alone (default store ${defaultStoreBefore} → ${defaultRecords.length} records, none for this session; no default sender marker, receiver marker or mailbox for it)`,
			defaultRecords.length === defaultStoreBefore &&
				!defaultRecords.some((r) => r.nativeSessionId === report.session.id) &&
				!fs.existsSync(path.join(defaultRoots.sendersDir, "pi-durable", `${host.pid}.json`)) &&
				!fs.existsSync(path.join(defaultRoots.receiversDir, `${gardenId}.json`)) &&
				!fs.existsSync(path.join(defaultRoots.mailboxDir, gardenId)),
		);
	}

	const markerFile = path.join(roots.sendersDir, "pi-durable", `${host.pid}.json`);
	const marker = fs.existsSync(markerFile)
		? (JSON.parse(fs.readFileSync(markerFile, "utf8")) as Record<string, unknown>)
		: {};
	ok(
		`[QK:PDC-SENDER-MARKER] the sender marker under the case's sender root is keyed to the spawned host pid with its /proc start-key and names the record`,
		marker.gardenId === gardenId &&
			marker.ownerPid === host.pid &&
			marker.ownerStartKey === `linux:${host.start}` &&
			marker.nativeSessionId === report.session.id,
	);

	const bridgePid = host.bridges[0]?.pid ?? -1;
	ok(
		`[QK:PDC-PPID-DIRECT] /proc shows exactly one bridge child whose PPID is the host and whose argv[0] is node — no shell between (pids ${host.bridges.map((b) => b.pid).join(", ") || "none"}, reported ${report.attachment.bridgePid})`,
		host.bridges.length === 1 &&
			bridgePid === report.attachment.bridgePid &&
			procArgv(bridgePid)[0] === process.execPath,
	);
	judgeBridgeSpec(report, host, roots, projectReal);

	const self = lastJsonLine(report.self);
	ok(
		`[QK:PDC-SELF] entwurf_self through the host's bridge names the record's garden id as a meta-session pi-durable sender (${String(self.sessionId)}, ${String(self.agentId)})`,
		self.sessionId === gardenId &&
			self.agentId === "meta-session/pi-durable" &&
			self.origin === "meta-session" &&
			self.cwd === projectReal,
	);
	// The arm, read raw: a path proves nothing, so the marker's owner is checked against the host this
	// gate spawned (pid + /proc start key), and its join partner is the sender marker read above.
	const receiverFile = path.join(roots.receiversDir, `${gardenId}.json`);
	const receiverMarker = fs.existsSync(receiverFile)
		? (JSON.parse(fs.readFileSync(receiverFile, "utf8")) as Record<string, unknown>)
		: {};
	ok(
		`[QK:PDC-RECEIVER-ARMED] the case's receiver root holds this garden's marker, owned by the spawned host (pid + /proc start key) as pi-durable-host on the durable session, with the mailbox signal beside it; the host's sender marker names the same garden, which is the #101 join (${receiverFile})`,
		receiverMarker.gardenId === gardenId &&
			receiverMarker.backend === "pi-durable" &&
			receiverMarker.nativeSessionId === report.session.id &&
			receiverMarker.ownerPid === host.pid &&
			receiverMarker.ownerStartKey === `linux:${host.start}` &&
			receiverMarker.ownerKind === "pi-durable-host" &&
			receiverMarker.armProvenance === "session-start" &&
			marker.gardenId === gardenId &&
			marker.ownerPid === host.pid &&
			fs.existsSync(path.join(roots.mailboxDir, gardenId, "inbox.signal")),
	);
	ok(
		`[QK:PDC-RECEIVER-STATE] the contact's own receiver() says armed for that garden at that marker (${report.receiver.status}, ${String(report.receiver.markerPath)})`,
		report.receiver.status === "armed" &&
			report.receiver.gardenId === gardenId &&
			report.receiver.markerPath === receiverFile,
	);
	ok(
		`[QK:PDC-REPLYABLE] with that receiver armed and joined, the bridge's own entwurf_self reports the citizen replyable (replyable ${String(self.replyable)})`,
		self.replyable === true,
	);
	ok(`[QK:PDC-PEERS-HOST] entwurf_peers through the host's bridge lists the citizen`, report.peers.includes(gardenId));

	const outside = await outsideBridge(roots);
	ok(
		`[QK:PDC-PEERS-OUTSIDE] a bridge this gate spawned on the case's roots (not the host's child) lists the citizen as pi-durable`,
		outside.peers.includes(gardenId) && outside.peers.includes("pi-durable"),
	);
	ok(
		`[QK:PDC-IDENTITY-HOST-SCOPED] that outside bridge is NOT the citizen — the marker joins only the host's own child (isError ${outside.self.isError})`,
		outside.self.isError && !outside.self.text.includes(gardenId),
	);

	const closed = await closeHost(host);
	ok(
		`[QK:PDC-CLOSE] the host closes and exits 0 (closed ${closed.closed}, exit ${closed.code})`,
		closed.closed && closed.code === 0,
	);
	ok(`[QK:PDC-BRIDGE-GONE] the bridge child is gone after close`, procStat(bridgePid) === null);
	ok(
		`[QK:PDC-RECEIVER-RETIRED-ON-CLOSE] the host's close removed the receiver marker it owned (${receiverFile})`,
		!fs.existsSync(receiverFile),
	);
	console.log(`     notices: ${report.notices.join(" | ") || "none"}`);
	return gardenId;
}

let primary: unknown;
try {
	const defaultGarden = await birthCell("1", defaultRoots, "new", null);
	await birthCell("2", defaultRoots, "continue", defaultGarden);
	const explicitGarden = await birthCell("3", explicitRoots, "new", null);
	await birthCell("4", explicitRoots, "continue", explicitGarden);
} catch (error) {
	primary = error;
}

// Cleanup runs on every path: reap what this gate owns, then the operator guard, then the roots.
const cleanupProblems: string[] = [];
for (const host of owned) cleanupProblems.push(...(await reap(host)));
const stillAlive = owned.flatMap((h) =>
	[{ pid: h.pid, start: h.start }, ...h.bridges].filter((p) => procStat(p.pid)?.start === p.start).map((p) => p.pid),
);
console.log("5. cleanup and operator guard");
const ownedSummary = owned
	.map((h) => `host ${h.pid}${h.bridges.length > 0 ? ` bridges ${h.bridges.map((b) => b.pid).join(",")}` : ""}`)
	.join("; ");
ok(
	`[QK:PDC-OWNED-REAPED] every host this gate spawned and every bridge observed under it is gone (${ownedSummary || "none spawned"}; alive ${stillAlive.join(",") || "none"})`,
	stillAlive.length === 0 && cleanupProblems.length === 0,
);
ok(
	`[QK:PDC-OPERATOR-UNTOUCHED] coarse pi-durable registration guard: this run left the operator's pi-durable registrations exactly as it found them (${describeOperatorSnapshot(operatorBefore)} — same names, same bytes; existing state is not a red; no auth or session content read)`,
	operatorSnapshotUnchanged(operatorBefore, operatorPiDurableSnapshot(operatorAgent)),
);
if (stillAlive.length > 0) console.log(`sandbox kept because owned processes are still alive: ${root}`);
else if (process.env.ENTWURF_PI_DURABLE_KEEP === "1") console.log(`sandbox kept: ${root}`);
else fs.rmSync(root, { recursive: true, force: true });

if (primary !== undefined) {
	console.error(`${LABEL}: FAILED — ${primary instanceof Error ? primary.message : String(primary)}`);
}
for (const problem of cleanupProblems) console.error(`${LABEL}: cleanup — ${problem}`);
console.log(`\n${LABEL}: ${passed} passed, ${failed} failed — adapter-direct, harness-bypassed, checkout-only`);
process.exit(primary === undefined && failed === 0 && cleanupProblems.length === 0 ? 0 : 1);
