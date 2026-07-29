// §11-7 ordering probe — LIVE paired-run driver. LIVE-gated, OUT of `pnpm check`.
//
//   LIVE=1 ./run.sh smoke-acp-ordering-probe-live
//
// The question this answers (§11-7, nothing more): against a delay=0 control,
// does injecting a startup delay into an operator MCP server shift this ACP
// server's newSession — i.e. does it wait for the delayed MCP — or does the
// prompt open ahead of wire-availability, or does it fail loud? The answer is an
// INPUT to the causal question about the 2026-07-24 samples, never its
// conclusion, and no prescription follows from a single probe run.
//
// The probe unit is a PAIRED set on identical pins/config/fixture:
//   run 1  control       delay=0   — must be visible AND callable, else P0
//   run 2  intervention  D1        — B/C/D readable here
//   run 3  intervention  D2        — A additionally needs latency tracking D
//                                    across BOTH nonzero delays
//
// Seam: probe-dedicated RAW CLIENT (scripts/lib/probe-acp-turn.ts) — bound by
// check-probe-ordering to issue the same calls/arguments/order as backend.ts.
// Fidelity beyond the sequence: launch, overlay, env defaults, session meta,
// carrier, permission policy, and mcpServers enrichment all come from the REAL
// production modules — backend-adapter.ts / config.ts carry `.js` value imports
// (not strip-types-loadable), so this runner tsc-emits pi-extensions and
// dynamic-imports the emitted twins, the house pattern check-acp-session-reuse
// established. Nothing production-shaped is re-implemented here.
//
// Artifacts: every run appends to ONE shared NDJSON log; the roster, the raw
// classification, and a human verdict land under .probe-artifacts/ (gitignored,
// preserved — promotion into any ledger is a separate, manual, §11-7-gated act).
//
// Exit: 0 = the instrument produced a judgeable verdict (A / A-withheld / B /
// B-name-snapshot / C / D-*). 1 = P0 / recurring I0 / inconclusive — the
// artifact is still written.
//
// §11-7-c preconditions (before any run): refuse an ambient
// CLAUDE_CODE_EXECUTABLE, resolve the native CLI through upstream
// claudeCliPath(), and pin the pair's target as path + sha256 (re-hashed after
// the runs — drift INVALIDATES the pair). The B-name-snapshot CHANNEL is not
// armed here yet: snapshotInstrumented is pinned false until the shim lands.

import { type ChildProcessByStdio, execFileSync, spawn } from "node:child_process";
import { copyFileSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { Readable, Writable } from "node:stream";
import { fileURLToPath, pathToFileURL } from "node:url";
import { ndJsonStream } from "@agentclientprotocol/sdk";
import { type AcpClientHandlers, connectAcpClient } from "../pi-extensions/lib/acp/acp-client.ts";
import type { AcpBackendAdapter } from "../pi-extensions/lib/acp/backend-adapter.ts";
import type { ResolvedAcpConfig } from "../pi-extensions/lib/acp/config.ts";
import { terminateChild } from "./lib/acp-child-cleanup.ts";
import { driveProbeTurn, type ProbeMcpEnricher, ProbePhaseError } from "./lib/probe-acp-turn.ts";
import {
	AMBIENT_OVERRIDE_ENV,
	assertNoAmbientOverride,
	hashFileSha256,
	PROBE_SHIM_ENV,
	ProbeCliPreconditionError,
	type ResolvedProbeCliTarget,
	resolveProbeCliTarget,
} from "./lib/probe-cli-target.ts";
import {
	appendProbeEvent,
	PROBE_ENV,
	PROBE_EVENTS,
	type ProbeEventName,
	readProbeEvents,
} from "./lib/probe-event-log.ts";
import { classifyProbe, DELAY_WELL_BELOW_MS, type ProbeRunRecord } from "./lib/probe-verdict.ts";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PROBE_SERVER = join(REPO_ROOT, "scripts", "fixtures", "probe-mcp-server.ts");
// §11-7-c producer. EXTENSIONLESS is a contract, not a filename: the SDK routes a
// script-suffixed executable through `node|bun <path>` and everything else through
// a direct spawn, and the pair's target is asserted onto that direct branch — so
// the instrument standing in front of it has to be on the same branch. The asserts
// below are the SAME ones the target goes through, deliberately.
const PROBE_SHIM = join(REPO_ROOT, "scripts", "fixtures", "probe-cli-shim");
// …and the INSTRUMENT is not that one file. The launcher is two lines of delegate;
// what actually runs is a fresh Node process reading a local module graph, so
// "control and interventions shared one shim" (§11-7-c condition 5) is a claim
// about the WHOLE graph. Pinning only the launcher would let an edit to the
// implementation land between two runs of the same pair, with the boot marker —
// which reports the CLI target, not the instrument — showing nothing at all
// (adversarial review 2026-07-29). check-probe-ordering derives this list from the
// launcher's and implementation's static local imports and refuses any drift, so
// it is a pinned list rather than a second unverified copy.
const SHIM_RUNTIME_FILES: readonly string[] = [
	PROBE_SHIM,
	join(REPO_ROOT, "scripts", "lib", "probe-cli-shim.ts"),
	join(REPO_ROOT, "scripts", "lib", "probe-cli-target.ts"),
	join(REPO_ROOT, "scripts", "lib", "probe-event-log.ts"),
];
const MODEL_ID = process.env.ENTWURF_ACP_PROBE_MODEL?.trim() || "claude-sonnet-5";
const D1_MS = Number(process.env.PROBE_D1_MS ?? "2000") || 2000;
const D2_MS = Number(process.env.PROBE_D2_MS ?? "8000") || 8000;
const TEXT_TAIL_CAP = 400;

function fail(msg: string): never {
	console.error(`[smoke-acp-ordering-probe-live] FAIL: ${msg}`);
	process.exit(1);
}

if (process.env.LIVE !== "1") {
	console.error("[smoke-acp-ordering-probe-live] skipped — set LIVE=1 to run the real paired probe.");
	process.exit(0);
}

for (const [label, d] of [
	["PROBE_D1_MS", D1_MS],
	["PROBE_D2_MS", D2_MS],
] as const) {
	if (!(d > 0 && d < DELAY_WELL_BELOW_MS)) {
		fail(`${label}=${d} must satisfy 0 < D < ${DELAY_WELL_BELOW_MS}ms — §11-7: well below the 30 s boundaries`);
	}
}
if (D1_MS === D2_MS) fail(`PROBE_D1_MS and PROBE_D2_MS are both ${D1_MS} — A needs two DISTINCT nonzero delays`);

// ---------------------------------------------------------------------------
// Production modules — tsc emit + dynamic import (house pattern, see header).
// ---------------------------------------------------------------------------
const TMP_EMIT = join(REPO_ROOT, ".tmp-verify", "probe-ordering-live");
rmSync(TMP_EMIT, { recursive: true, force: true });
console.error("[smoke-acp-ordering-probe-live] emitting pi-extensions (tsc) for the production adapter/config…");
execFileSync(
	join(REPO_ROOT, "node_modules", ".bin", "tsc"),
	["--outDir", TMP_EMIT, "--rootDir", ".", "--noEmit", "false"],
	{
		cwd: REPO_ROOT,
		stdio: "pipe",
	},
);
// tsc emits only .ts→.js; the engraving carrier is a .md asset shipped alongside
// engraving.js in the real package — copy it so loadCarrier finds its default.
const promptsOut = join(TMP_EMIT, "pi-extensions", "lib", "acp", "prompts");
mkdirSync(promptsOut, { recursive: true });
copyFileSync(
	join(REPO_ROOT, "pi-extensions", "lib", "acp", "prompts", "engraving.md"),
	join(promptsOut, "engraving.md"),
);

const adapterMod = (await import(
	pathToFileURL(join(TMP_EMIT, "pi-extensions", "lib", "acp", "backend-adapter.js")).href
)) as { claudeAdapter: AcpBackendAdapter };
const configMod = (await import(pathToFileURL(join(TMP_EMIT, "pi-extensions", "lib", "acp", "config.js")).href)) as {
	resolveProviderConfig: (params: Record<string, unknown>) => ResolvedAcpConfig;
	enrichMcpServersWithEnvelope: ProbeMcpEnricher;
	mcpServerNames: (config: ResolvedAcpConfig) => string[];
};
const claudeAdapter = adapterMod.claudeAdapter;
const enrichMcpServersWithEnvelope = configMod.enrichMcpServersWithEnvelope;

const routed = claudeAdapter.routeModel(MODEL_ID);
if (!routed) fail(`model ${MODEL_ID} does not route to the claude adapter`);
const NATIVE_MODEL_ID = routed.nativeModelId;

// §11-7-c precondition gate — resolved in main() BEFORE any run, AFTER the
// artifact directory exists, so a refusal leaves a named classification on the
// artifact instead of stderr alone. Assigned exactly once there.
let CLI_TARGET: ResolvedProbeCliTarget;
// The shim, resolved through the same precondition asserts as the target and
// pinned before any run. Assigned exactly once in main().
let SHIM_TARGET: ResolvedProbeCliTarget;
// path+sha256 for every file in the instrument's runtime graph, pinned before the
// first run and re-hashed after the last. Its own axis, separate from the CLI
// target's: a stimulus that moved and an INSTRUMENT that moved are different
// findings and must not be reported under one name.
let SHIM_RUNTIME: Array<{ path: string; sha256: string }> = [];

function hashShimRuntime(): Array<{ path: string; sha256: string }> {
	return SHIM_RUNTIME_FILES.map((path) => ({ path, sha256: hashFileSha256(path) }));
}

// Approve-all permission policy — mirrors backend.ts resolvePermissionResponse
// (module-private there; check-probe-ordering pins this copy against its source).
function approveAllPermission(params: { options?: Array<{ optionId: string; kind?: string }> }): {
	outcome: { outcome: "selected"; optionId: string } | { outcome: "cancelled" };
} {
	const options = Array.isArray(params?.options) ? params.options : [];
	if (options.length === 0) return { outcome: { outcome: "cancelled" } };
	const allow = options.find((o) => o.kind === "allow_once" || o.kind === "allow_always");
	return { outcome: { outcome: "selected", optionId: (allow ?? options[0]).optionId } };
}

const NO_SUCH_TOOL_RE = /No such tool(?: available)?:?\s*"?([\w:.-]+)"?/i;

// ---------------------------------------------------------------------------
// The OBSERVATION WINDOW (§11-7, GPT review 2026-07-29).
//
// The first LIVE pair tore the ACP child down the instant the turn settled. At
// D=8000ms that happened while the fixture was still inside its injected delay:
// the fixture went on to finish its delay and complete `initialize` 2.7 s AFTER
// run_end, and the tools/list it would have forwarded ~14 ms later never
// happened, because the client that would have asked was gone. The classifier
// then read that self-inflicted absence as an MCP handshake / fixture / config
// candidate — an attribution about the SERVER derived from a fact about OUR
// teardown.
//
// So absence is only a reading when we kept looking long enough to have seen the
// marker. After the turn settles the runner keeps the child alive until the
// FIRST of:
//   - the wire marker lands            → reason `wire-marker`   (marker seen)
//   - the ACP child exits on its own   → reason `child-exit`    (CENSORED)
//   - the deadline passes              → reason `deadline`      (window sufficient)
// and stamps `probe_observation_window_end` with which one it was, BEFORE
// teardown. Only `deadline` lets a missing marker be read as evidence.
//
// The deadline is anchored on the FIXTURE'S OWN delay markers, never on run
// start: the injected delay begins when the fixture process boots, which is
// itself some way into newSession, so a run-start-relative deadline would drift
// with spawn latency and silently shorten the window it claims to guarantee.
// ---------------------------------------------------------------------------

/** Grace kept after the fixture's delay ends before calling the window closed.
 *  A CONSTANT, deliberately not an env knob: this value is what lets a missing
 *  wire marker be read as evidence at all, so an operator (or a stray export)
 *  able to shrink it could make the probe close its own window early and then
 *  call that absence "deadline-sufficient" (GPT review 2026-07-29). The earlier
 *  `Number(env) || 5000` form accepted 0 and negatives outright. */
const POST_DELAY_SLACK_MS = 5_000;
/** Boot allowance used only when the fixture logged no delay marker at all. */
const FIXTURE_BOOT_ALLOWANCE_MS = 5_000;
const WINDOW_POLL_MS = 100;

function runEventsOf(logPath: string, runId: string) {
	return readProbeEvents(logPath).events.filter((e) => e.runId === runId);
}

/** Did the wire-availability marker for this run land? */
function wireMarkerSeen(logPath: string, runId: string): boolean {
	return runEventsOf(logPath, runId).some((e) => e.event === PROBE_EVENTS.toolsListResponseForwarded);
}

/** Deadline for THIS run, recomputed each poll because the fixture's delay
 *  markers may still be arriving while we wait. Returns the absolute ms plus the
 *  basis actually used, which is recorded so a reader can tell a well-anchored
 *  window from a fallback one. */
function windowDeadline(
	logPath: string,
	runId: string,
	delayMs: number,
	windowOpenedMs: number,
): { deadlineMs: number; basis: "fixture-delay-end" | "fixture-delay-start" | "no-fixture-delay-marker" } {
	const events = runEventsOf(logPath, runId);
	const delayEnd = events.find((e) => e.event === PROBE_EVENTS.fixtureDelayEnd);
	if (delayEnd) return { deadlineMs: delayEnd.tsMs + POST_DELAY_SLACK_MS, basis: "fixture-delay-end" };
	const delayStart = events.find((e) => e.event === PROBE_EVENTS.fixtureDelayStart);
	if (delayStart) return { deadlineMs: delayStart.tsMs + delayMs + POST_DELAY_SLACK_MS, basis: "fixture-delay-start" };
	return {
		deadlineMs: windowOpenedMs + delayMs + FIXTURE_BOOT_ALLOWANCE_MS + POST_DELAY_SLACK_MS,
		basis: "no-fixture-delay-marker",
	};
}

/** Hold the window open past the turn, then stamp how it closed. */
async function observeWindowClose(
	logPath: string,
	runId: string,
	delayMs: number,
	child: ChildProcessByStdio<Writable, Readable, Readable>,
	log: (event: ProbeEventName, payload?: Record<string, unknown>) => void,
): Promise<void> {
	const openedMs = Date.now();
	let reason: "wire-marker" | "child-exit" | "deadline";
	let basis = windowDeadline(logPath, runId, delayMs, openedMs).basis;
	for (;;) {
		if (wireMarkerSeen(logPath, runId)) {
			reason = "wire-marker";
			break;
		}
		// The child ending is NOT the deadline being met — we stop looking because
		// the thing being observed is gone, which is precisely a censored reading.
		if (child.exitCode !== null || child.signalCode !== null) {
			reason = "child-exit";
			break;
		}
		const d = windowDeadline(logPath, runId, delayMs, openedMs);
		basis = d.basis;
		if (Date.now() >= d.deadlineMs) {
			reason = "deadline";
			break;
		}
		await new Promise((r) => setTimeout(r, WINDOW_POLL_MS));
	}
	// Re-read rather than trusting the loop's exit branch: the marker can land in
	// the same tick the child exits, and a marker seen is a marker seen.
	const markerSeen = wireMarkerSeen(logPath, runId);
	log(PROBE_EVENTS.observationWindowEnd, {
		reason: markerSeen ? "wire-marker" : reason,
		markerSeen,
		deadlineBasis: basis,
		waitedMs: Date.now() - openedMs,
	});
}

interface RunOutcome {
	record: ProbeRunRecord;
	ok: boolean;
	phase?: string;
}

async function runOne(
	logPath: string,
	role: "control" | "intervention",
	delayMs: number,
	attempt: number,
	index: number,
): Promise<RunOutcome> {
	const runId = `run${attempt}-${index}-${Math.random().toString(36).slice(2, 8)}`;
	const probeRunId = `prb-${Math.random().toString(36).slice(2, 10)}`;
	const nonce = `MCP_${process.pid.toString(36)}${Date.now().toString(36)}`;
	// The B-name-snapshot channel is ARMED: the §11-7-c producer is built and this
	// run installs it in front of the CLI (below). Arming is a deliberate act —
	// under it the classifier holds the CONTROL to the calibration floor, so a run
	// whose shim never reported in, or reported a different target, is a NAMED
	// structural finding rather than a quiet absence. The pair's expected CLI
	// target identity rides the roster so the classifier can CONSUME it
	// (condition 5): a shim boot reporting any other path/sha is a
	// snapshot-topology INVALIDATION, never a substitution nobody notices.
	const record: ProbeRunRecord = {
		runId,
		role,
		delayMs,
		probeRunId,
		snapshotInstrumented: true,
		cliTargetPath: CLI_TARGET.path,
		cliTargetSha256: CLI_TARGET.sha256,
	};
	const log = (event: ProbeEventName, payload: Record<string, unknown> = {}) =>
		appendProbeEvent(logPath, runId, event, payload);

	const scratch = await mkdtemp(join(tmpdir(), "entwurf-probe-ordering-"));
	let child: ChildProcessByStdio<Writable, Readable, Readable> | undefined;
	let connection: ReturnType<typeof connectAcpClient> | undefined;
	try {
		// Register the fixture exactly as an operator would (S2g surface), then
		// resolve through the REAL config path — scratch global keeps the
		// operator's own settings out of the experiment.
		mkdirSync(join(scratch, ".pi"), { recursive: true });
		const projectSettingsPath = join(scratch, ".pi", "settings.json");
		writeFileSync(
			projectSettingsPath,
			`${JSON.stringify(
				{
					entwurfProvider: {
						mcpServers: {
							probe: {
								command: process.execPath,
								args: ["--experimental-strip-types", PROBE_SERVER],
								env: {
									[PROBE_ENV.nonce]: nonce,
									[PROBE_ENV.eventLog]: logPath,
									[PROBE_ENV.startupDelayMs]: String(delayMs),
									[PROBE_ENV.runId]: runId,
								},
							},
						},
					},
				},
				null,
				2,
			)}\n`,
		);
		const config = configMod.resolveProviderConfig({
			cwd: scratch,
			modelId: MODEL_ID,
			adapter: claudeAdapter,
			globalSettingsPath: join(scratch, ".pi", "global-settings-absent.json"),
			projectSettingsPath,
		});
		const carrier = claudeAdapter.loadCarrier({ mcpServerNames: configMod.mcpServerNames(config), config });

		// Production spawn: adapter launch + overlay + env defaults over process.env.
		// sessionKey mirrors resolveSessionKey's cwd fallback (this probe runs with
		// no opts.sessionId / PI_SESSION_ID); claude's overlay ignores it.
		const overlay = claudeAdapter.ensureOverlay({
			cwd: scratch,
			modelId: MODEL_ID,
			nativeModelId: NATIVE_MODEL_ID,
			config,
			sessionKey: `cwd:${scratch}`,
		});
		const launch = claudeAdapter.resolveLaunch({
			cwd: scratch,
			modelId: MODEL_ID,
			nativeModelId: NATIVE_MODEL_ID,
			config,
		});
		// The COMPOSED env is asserted, not just process.env: launch defaults or
		// overlay overrides injecting the executable override would hijack which
		// CLI the pair measures, silently (§11-7-c precondition).
		const spawnEnv = { ...process.env, ...claudeAdapter.launchEnvDefaults(), ...overlay.envOverrides };
		assertNoAmbientOverride(spawnEnv, `composed acp child env for ${runId}`);
		// ORDER IS THE CONTRACT (§11-7-c condition 1, GPT GO condition): the refusal
		// above runs against the env as PRODUCTION composed it, and only then does
		// the probe install its own override. Inverted, the checkpoint would inspect
		// the override the probe itself just injected and REFUSE every run — loudly,
		// but for the wrong reason, and the operator's ambient environment (the one
		// thing this precondition exists to observe) would never be examined at all.
		spawnEnv[AMBIENT_OVERRIDE_ENV] = SHIM_TARGET.path;
		spawnEnv[PROBE_SHIM_ENV.target] = CLI_TARGET.path;
		spawnEnv[PROBE_SHIM_ENV.eventLog] = logPath;
		spawnEnv[PROBE_SHIM_ENV.runId] = runId;
		child = spawn(launch.command, launch.args, {
			cwd: scratch,
			env: spawnEnv,
			stdio: ["pipe", "pipe", "pipe"],
		}) as ChildProcessByStdio<Writable, Readable, Readable>;
		const spawned = child;
		const stderrTail: string[] = [];
		spawned.stderr.on("data", (c) => {
			stderrTail.push(c.toString());
			if (stderrTail.length > 50) stderrTail.shift();
		});

		let collectedText = "";
		// The runtime No-such-tool error is read ONLY off structured tool_call
		// frames, and ONLY off their runtime-produced fields (rawOutput / content /
		// _meta / error — never rawInput, never agent prose). Scanning model text
		// would let the model MINT the marker by saying the sentence, silently
		// promoting prose to runtime evidence — the exact §11-7 bypass GPT review
		// 2026-07-28 flagged.
		const scanStructuredNoSuchTool = (u: Record<string, unknown>) => {
			const runtimeFields = JSON.stringify({
				rawOutput: u.rawOutput,
				content: u.content,
				_meta: u._meta,
				error: u.error,
			});
			const m = NO_SUCH_TOOL_RE.exec(runtimeFields);
			if (m) log(PROBE_EVENTS.acpNoSuchTool, { toolId: m[1], raw: runtimeFields.slice(0, TEXT_TAIL_CAP) });
		};
		// tool_call state per toolCallId: claude-agent-acp emits `tool_call`
		// (pending, name/title) and streams rawInput on LATER `tool_call_update`
		// frames — the first LIVE control proved that reading rawInput off the
		// initial frame alone records nothing. Accumulate per id, emit the observed
		// event ONCE when the probeRunId argument becomes visible, and keep every
		// raw frame as forensics so a failed extraction stays diagnosable.
		const toolCalls = new Map<string, { providerToolId?: string; observed: boolean }>();
		const handlers: AcpClientHandlers = {
			sessionUpdate: async (notification) => {
				const u = notification?.update as Record<string, unknown> | undefined;
				const kind = u?.sessionUpdate;
				if (kind === "agent_message_chunk") {
					const t = (u?.content as { text?: string } | undefined)?.text;
					if (typeof t === "string") collectedText += t;
				} else if (kind === "tool_call" || kind === "tool_call_update") {
					// §11-7: toolCallId and wire ids are forensics, never cross-layer
					// join keys. The join key is the probeRunId argument we control.
					log(PROBE_EVENTS.acpToolCallRaw, { kind, raw: JSON.stringify(u).slice(0, 600) });
					const toolCallId = typeof u?.toolCallId === "string" ? u.toolCallId : "<none>";
					const entry = toolCalls.get(toolCallId) ?? { observed: false };
					// The provider-bound id candidate: prefer an explicit tool name
					// field, fall back to title; keep the FIRST value seen for the id.
					const rawName = typeof u?.name === "string" ? u.name : undefined;
					const title = typeof u?.title === "string" ? u.title : undefined;
					entry.providerToolId = entry.providerToolId ?? rawName ?? title;
					const rawInput = u?.rawInput as Record<string, unknown> | undefined;
					const probeRunIdArg = typeof rawInput?.probeRunId === "string" ? rawInput.probeRunId : undefined;
					if (!entry.observed && probeRunIdArg !== undefined) {
						entry.observed = true;
						log(PROBE_EVENTS.acpToolCallObserved, {
							providerToolId: entry.providerToolId,
							probeRunId: probeRunIdArg,
							toolCallId,
						});
					}
					toolCalls.set(toolCallId, entry);
					if (u) scanStructuredNoSuchTool(u);
				}
			},
			requestPermission: async (req) => approveAllPermission(req),
			readTextFile: async () => {
				throw new Error("unexpected readTextFile in ordering probe turn");
			},
			writeTextFile: async () => {
				throw new Error("unexpected writeTextFile in ordering probe turn");
			},
		};
		const stdoutWeb = Readable.toWeb(spawned.stdout) as unknown as ReadableStream<Uint8Array>;
		const stdinWeb = Writable.toWeb(spawned.stdin) as unknown as WritableStream<Uint8Array>;
		connection = connectAcpClient(ndJsonStream(stdinWeb, stdoutWeb) as never, handlers);

		log(PROBE_EVENTS.runStart, {
			role,
			delayMs,
			probeRunId,
			model: MODEL_ID,
			attempt,
			// The pair's stimulus identity — which CLI binary the ACP child will
			// resolve — pinned on the artifact per run (§11-7-c condition 5).
			cliTargetPath: CLI_TARGET.path,
			cliTargetSha256: CLI_TARGET.sha256,
		});
		console.error(`[smoke-acp-ordering-probe-live] ${runId}: role=${role} delay=${delayMs}ms probeRunId=${probeRunId}`);

		const promptText =
			`Call the probe_nonce tool now with probeRunId set to exactly "${probeRunId}", then reply with ` +
			"exactly the PROBE_NONCE value it returns (the part after the '=' sign), and nothing else.";
		try {
			const result = await driveProbeTurn(connection, {
				cwd: scratch,
				modelId: MODEL_ID,
				nativeModelId: NATIVE_MODEL_ID,
				config,
				carrier,
				promptText,
				adapter: claudeAdapter,
				enrichMcpServers: enrichMcpServersWithEnvelope,
				log,
			});
			log(PROBE_EVENTS.promptReply, {
				carriesNonce: collectedText.includes(nonce),
				stopReason: result.stopReason,
				textTail: collectedText.slice(-TEXT_TAIL_CAP),
			});
			await observeWindowClose(logPath, runId, delayMs, spawned, log);
			log(PROBE_EVENTS.runEnd, { ok: true });
			return { record, ok: true };
		} catch (err) {
			const phase = err instanceof ProbePhaseError ? err.phase : "unknown";
			// The window question is moot once a phase failed — the phase reading
			// owns the run — but the marker is stamped anyway so the exactly-once
			// runner topology holds on this path too.
			log(PROBE_EVENTS.observationWindowEnd, {
				reason: "run-failed",
				markerSeen: wireMarkerSeen(logPath, runId),
				phase,
			});
			log(PROBE_EVENTS.runEnd, { ok: false, phase, error: err instanceof Error ? err.message : String(err) });
			console.error(`[smoke-acp-ordering-probe-live] ${runId}: turn failed at ${phase}`);
			console.error(`[smoke-acp-ordering-probe-live] ${runId}: stderr tail:\n${stderrTail.slice(-10).join("")}`);
			return { record, ok: false, phase };
		}
	} finally {
		connection?.close?.();
		if (child) await terminateChild(child);
		try {
			await rm(scratch, { recursive: true, force: true });
		} catch {
			// scratch cleanup is best-effort
		}
	}
}

async function runRoster(logPath: string, attempt: number): Promise<ProbeRunRecord[]> {
	const roster: ProbeRunRecord[] = [];
	const control = await runOne(logPath, "control", 0, attempt, 0);
	roster.push(control.record);
	// P0 short-circuit is decided by the CLASSIFIER (single authority) — but a
	// control that already failed can never classify PASS, so spare the two live
	// intervention turns and let the final classification state the P0.
	const { events } = readProbeEvents(logPath);
	const preview = classifyProbe(roster, events);
	if (preview.verdict === "P0") return roster;
	roster.push((await runOne(logPath, "intervention", D1_MS, attempt, 1)).record);
	roster.push((await runOne(logPath, "intervention", D2_MS, attempt, 2)).record);
	return roster;
}

async function main(): Promise<void> {
	const stamp = new Date().toISOString().replace(/[:.]/g, "-");
	const artifactDir = join(REPO_ROOT, ".probe-artifacts", "acp-ordering", stamp);
	mkdirSync(artifactDir, { recursive: true });
	const logPath = join(artifactDir, "events.ndjson");
	// §11-7-c precondition gate — BEFORE any run. Refuse an ambient
	// CLAUDE_CODE_EXECUTABLE (claudeCliPath() would return it VERBATIM and the
	// pair would measure an unpinned executable), resolve the native CLI once
	// through the upstream resolver, and pin the pair's stimulus identity as
	// path + sha256. A refusal is a NAMED classification on the artifact, not a
	// stderr-only exit. The deep import is a version-pinned internal resolver
	// dependency; its disappearance breaks check-probe-ordering offline, never a
	// LIVE run first.
	try {
		CLI_TARGET = await resolveProbeCliTarget({
			env: process.env,
			resolveNative: async () => {
				const mod = (await import("@agentclientprotocol/claude-agent-acp/dist/acp-agent.js")) as {
					claudeCliPath: () => Promise<string>;
				};
				return mod.claudeCliPath();
			},
		});
	} catch (err) {
		const reason = err instanceof ProbeCliPreconditionError ? `precondition-${err.reason}` : "precondition-unknown";
		writeFileSync(
			join(artifactDir, "classification.json"),
			`${JSON.stringify(
				{ verdict: "INVALIDATED", reason, message: err instanceof Error ? err.message : String(err) },
				null,
				2,
			)}\n`,
		);
		fail(`${reason}: ${err instanceof Error ? err.message : String(err)} (artifact preserved at ${artifactDir})`);
	}
	// The instrument goes through the SAME gate as the stimulus. `env: {}` because
	// the ambient refusal already ran against the real environment above; what is
	// asked here is only the shape question — absolute, native branch (no script
	// suffix), a present regular file, executable — because a shim that fails any
	// of those either does not run at all or runs on the OTHER launch branch, and
	// either way the pair would measure something else. Refusal is a NAMED
	// classification on the artifact, exactly like the target's.
	try {
		SHIM_TARGET = await resolveProbeCliTarget({ env: {}, resolveNative: async () => PROBE_SHIM });
	} catch (err) {
		const reason =
			err instanceof ProbeCliPreconditionError ? `precondition-shim-${err.reason}` : "precondition-shim-unknown";
		writeFileSync(
			join(artifactDir, "classification.json"),
			`${JSON.stringify(
				{ verdict: "INVALIDATED", reason, message: err instanceof Error ? err.message : String(err) },
				null,
				2,
			)}\n`,
		);
		fail(`${reason}: ${err instanceof Error ? err.message : String(err)} (artifact preserved at ${artifactDir})`);
	}
	console.error(
		`[smoke-acp-ordering-probe-live] cli target: ${CLI_TARGET.path} (sha256 ${CLI_TARGET.sha256.slice(0, 12)}…)`,
	);
	try {
		SHIM_RUNTIME = hashShimRuntime();
	} catch (err) {
		writeFileSync(
			join(artifactDir, "classification.json"),
			`${JSON.stringify(
				{
					verdict: "INVALIDATED",
					reason: "shim-runtime-unreadable",
					message: err instanceof Error ? err.message : String(err),
				},
				null,
				2,
			)}\n`,
		);
		fail(`shim-runtime-unreadable: ${err instanceof Error ? err.message : String(err)} (artifact at ${artifactDir})`);
	}
	writeFileSync(join(artifactDir, "shim-runtime.json"), `${JSON.stringify(SHIM_RUNTIME, null, 2)}\n`);
	console.error(
		`[smoke-acp-ordering-probe-live] shim:       ${SHIM_TARGET.path} (sha256 ${SHIM_TARGET.sha256.slice(0, 12)}…) — snapshot channel ARMED`,
	);
	console.error(
		`[smoke-acp-ordering-probe-live] instrument: ${SHIM_RUNTIME.length} runtime files pinned (${SHIM_RUNTIME.map((f) => f.sha256.slice(0, 8)).join(" ")})`,
	);
	console.error(`[smoke-acp-ordering-probe-live] model:    ${MODEL_ID} (native ${NATIVE_MODEL_ID})`);
	console.error(`[smoke-acp-ordering-probe-live] delays:   control=0, D1=${D1_MS}ms, D2=${D2_MS}ms`);
	console.error(`[smoke-acp-ordering-probe-live] artifact: ${artifactDir}`);

	// Attempt 2 exists ONLY for the I0 policy: control passed but an intervention
	// failed at initialize (environment drift) → re-run the same pair ONCE.
	let roster = await runRoster(logPath, 1);
	let { events, malformed, sequenceViolations } = readProbeEvents(logPath);
	let classification = classifyProbe(roster, events);
	if (classification.verdict === "I0") {
		console.error("[smoke-acp-ordering-probe-live] I0 — re-running the same pair once (§11-7 bounded retry)");
		roster = await runRoster(logPath, 2);
		({ events, malformed, sequenceViolations } = readProbeEvents(logPath));
		classification = classifyProbe(roster, events);
	}

	writeFileSync(join(artifactDir, "roster.json"), `${JSON.stringify(roster, null, 2)}\n`);
	// The INSTRUMENT's own drift axis. The CLI-target rehash below answers "did the
	// runs share one stimulus"; this answers "did they share one instrument", and
	// an edit to the implementation between control and intervention is invisible
	// to every other check — the shim's boot marker reports the CLI target, not
	// itself.
	let shimRehash: Array<{ path: string; sha256: string }>;
	try {
		shimRehash = hashShimRuntime();
	} catch (err) {
		writeFileSync(
			join(artifactDir, "classification.json"),
			`${JSON.stringify(
				{
					verdict: "INVALIDATED",
					reason: "shim-runtime-unreadable",
					pinned: SHIM_RUNTIME,
					message: err instanceof Error ? err.message : String(err),
				},
				null,
				2,
			)}\n`,
		);
		fail(
			`a file in the shim runtime graph became unreadable during the pair — the runs cannot be shown to share one ` +
				`INSTRUMENT; pair INVALIDATED, artifact preserved at ${artifactDir}`,
		);
	}
	if (JSON.stringify(shimRehash) !== JSON.stringify(SHIM_RUNTIME)) {
		writeFileSync(
			join(artifactDir, "classification.json"),
			`${JSON.stringify(
				{ verdict: "INVALIDATED", reason: "shim-runtime-drift", pinned: SHIM_RUNTIME, observed: shimRehash },
				null,
				2,
			)}\n`,
		);
		fail(
			`the shim runtime graph changed content during the pair — control and interventions did not run the SAME ` +
				`instrument; pair INVALIDATED, artifact preserved at ${artifactDir}`,
		);
	}
	// §11-7-c condition 5 — the pair is a delta only while every run resolved the
	// SAME executable. The path was pinned before the runs; if its content hash
	// moved underneath the pair (an install, a version switch), the runs did not
	// share a stimulus and nothing may be judged across them. An UNREADABLE
	// target at re-hash time (deleted, permissions) is the same finding with its
	// own name — an uncaught throw here would exit without the INVALIDATED
	// artifact this block exists to write.
	let rehash: string;
	try {
		rehash = hashFileSha256(CLI_TARGET.path);
	} catch (err) {
		writeFileSync(
			join(artifactDir, "classification.json"),
			`${JSON.stringify(
				{
					verdict: "INVALIDATED",
					reason: "cli-target-unreadable",
					cliTargetPath: CLI_TARGET.path,
					sha256Before: CLI_TARGET.sha256,
					message: err instanceof Error ? err.message : String(err),
				},
				null,
				2,
			)}\n`,
		);
		fail(
			`cli target ${CLI_TARGET.path} became unreadable during the pair — the runs cannot be shown to share one ` +
				`stimulus; pair INVALIDATED, artifact preserved at ${artifactDir}`,
		);
	}
	if (rehash !== CLI_TARGET.sha256) {
		writeFileSync(
			join(artifactDir, "classification.json"),
			`${JSON.stringify(
				{
					verdict: "INVALIDATED",
					reason: "cli-target-drift",
					cliTargetPath: CLI_TARGET.path,
					sha256Before: CLI_TARGET.sha256,
					sha256After: rehash,
				},
				null,
				2,
			)}\n`,
		);
		fail(
			`cli target ${CLI_TARGET.path} changed content during the pair (sha256 ${CLI_TARGET.sha256} → ${rehash}) — ` +
				`the runs did not share one stimulus; pair INVALIDATED, artifact preserved at ${artifactDir}`,
		);
	}
	// A corrupted line is a run-invalidating state, not a footnote: the missing
	// line could be the very wire marker whose absence the classifier would then
	// read as evidence. The artifact must say so ON ITS FACE — a reader of the
	// directory alone must find INVALIDATED as the verdict, never a
	// judgeable-looking thin-log classification (GPT review round 2). The
	// thin-log reading is preserved INSIDE the wrapper for forensics only.
	// The stream door is the same kind of refusal one layer out: individually valid
	// lines whose per-writer order cannot be trusted. `tsMs`/`seq` ARE the ordering
	// evidence, so a log that cannot vouch for them cannot answer §11-7 either.
	if (malformed.length > 0 || sequenceViolations.length > 0) {
		if (malformed.length > 0) writeFileSync(join(artifactDir, "malformed-lines.txt"), `${malformed.join("\n")}\n`);
		if (sequenceViolations.length > 0) {
			writeFileSync(join(artifactDir, "sequence-violations.txt"), `${sequenceViolations.join("\n")}\n`);
		}
		const reason = malformed.length > 0 ? "malformed-event-log" : "event-log-order-violation";
		writeFileSync(
			join(artifactDir, "classification.json"),
			`${JSON.stringify(
				{
					verdict: "INVALIDATED",
					reason,
					malformedLines: malformed.length,
					sequenceViolations,
					thinLogClassificationForForensicsOnly: classification,
				},
				null,
				2,
			)}\n`,
		);
		fail(
			`${malformed.length} malformed line(s) and ${sequenceViolations.length} per-writer order violation(s) — ` +
				`the log is not a judgeable record; run INVALIDATED, artifact preserved at ${artifactDir}`,
		);
	}
	writeFileSync(join(artifactDir, "classification.json"), `${JSON.stringify(classification, null, 2)}\n`);

	console.log(`[smoke-acp-ordering-probe-live] validity: ${classification.status.validity}`);
	console.log(
		`  (a) ordering measurement: ${classification.status.orderingMeasurement} — ${classification.ordering.summary}`,
	);
	console.log(`  (b) failure verdict:      ${classification.status.failureVerdict}`);
	console.log(`  composite verdict: ${classification.verdict}`);
	console.log(`  ${classification.detail}`);
	console.log(`  expectedProviderToolId: ${classification.expectedProviderToolId ?? "(unmeasured)"}`);
	for (const r of classification.interventions) {
		console.log(
			`  ${r.runId} D=${r.delayMs}ms → ${r.kind}${r.promotable ? " [PROMOTABLE]" : ""}` +
				`${r.newSessionExcessMs !== undefined ? ` (newSession excess ${r.newSessionExcessMs}ms)` : ""}: ${r.evidence}`,
		);
	}
	console.log(`  artifact preserved: ${artifactDir}`);

	// EXIT CONTRACT — three separate questions, not one (GPT review 2026-07-29).
	// The old contract failed the run whenever the composite verdict was not one of
	// the judgeable labels, which meant a pair that successfully MEASURED its
	// ordering axis was reported as a failed run because the callability axis had
	// no marker. That is the same conflation the two axes exist to undo.
	//
	//   1. fatal validity — under P0 / I0 / INVALIDATED nothing was measured;
	//   2. axis (a) — did an ordering comparison get made at all;
	//   3. axis (b) — the callability verdict, which may legitimately be
	//      inconclusive without the run having failed.
	//
	// A run exits non-zero only when it produced NOTHING: fatal validity, or both
	// axes empty. `measured` on axis (a) is NOT a claim that the server waited or
	// did not — it says the comparison exists and is recorded.
	if (classification.status.validity !== "valid" && classification.status.validity !== "partial") {
		fail(
			`validity ${classification.status.validity} — nothing was measured (artifact preserved for classification): ${classification.detail}`,
		);
	}
	if (classification.status.invalidRuns.length > 0) {
		// A pair that lost a delay point still reports what it measured, but it may
		// never be read as a complete series — A in particular needs every point.
		console.log(
			`  PARTIAL: ${classification.status.invalidRuns.map((r) => `${r.runId}=${r.reason}`).join(", ")} — ` +
				"this pair is missing delay point(s); do not read it as a complete series",
		);
	}
	const judgeableFailure = ["B", "B-name-snapshot", "C", "callable"];
	if (
		classification.status.orderingMeasurement !== "measured" &&
		!judgeableFailure.includes(classification.status.failureVerdict)
	) {
		fail(
			`neither axis produced a measurement (ordering=${classification.status.orderingMeasurement}, ` +
				`failure=${classification.status.failureVerdict}) — artifact preserved for classification`,
		);
	}
	console.log(
		"[smoke-acp-ordering-probe-live] run completed with a recorded measurement — this is NOT a claim about server wait behavior",
	);
}

await main();
