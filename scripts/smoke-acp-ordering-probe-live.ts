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
// Exit: 0 = the instrument produced a judgeable verdict (A / A-withheld / B / C
// / D-*). 1 = P0 / recurring I0 / inconclusive — the artifact is still written.

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
	appendProbeEvent,
	PROBE_ENV,
	PROBE_EVENTS,
	type ProbeEventName,
	readProbeEvents,
} from "./lib/probe-event-log.ts";
import { classifyProbe, DELAY_WELL_BELOW_MS, type ProbeRunRecord } from "./lib/probe-verdict.ts";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PROBE_SERVER = join(REPO_ROOT, "scripts", "fixtures", "probe-mcp-server.ts");
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
	const record: ProbeRunRecord = { runId, role, delayMs, probeRunId };
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
		const overlay = claudeAdapter.ensureOverlay({
			cwd: scratch,
			modelId: MODEL_ID,
			nativeModelId: NATIVE_MODEL_ID,
			config,
		});
		const launch = claudeAdapter.resolveLaunch({
			cwd: scratch,
			modelId: MODEL_ID,
			nativeModelId: NATIVE_MODEL_ID,
			config,
		});
		child = spawn(launch.command, launch.args, {
			cwd: scratch,
			env: { ...process.env, ...claudeAdapter.launchEnvDefaults(), ...overlay.envOverrides },
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

		log(PROBE_EVENTS.runStart, { role, delayMs, probeRunId, model: MODEL_ID, attempt });
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
			log(PROBE_EVENTS.runEnd, { ok: true });
			return { record, ok: true };
		} catch (err) {
			const phase = err instanceof ProbePhaseError ? err.phase : "unknown";
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
	console.error(`[smoke-acp-ordering-probe-live] model:    ${MODEL_ID} (native ${NATIVE_MODEL_ID})`);
	console.error(`[smoke-acp-ordering-probe-live] delays:   control=0, D1=${D1_MS}ms, D2=${D2_MS}ms`);
	console.error(`[smoke-acp-ordering-probe-live] artifact: ${artifactDir}`);

	// Attempt 2 exists ONLY for the I0 policy: control passed but an intervention
	// failed at initialize (environment drift) → re-run the same pair ONCE.
	let roster = await runRoster(logPath, 1);
	let { events, malformed } = readProbeEvents(logPath);
	let classification = classifyProbe(roster, events);
	if (classification.verdict === "I0") {
		console.error("[smoke-acp-ordering-probe-live] I0 — re-running the same pair once (§11-7 bounded retry)");
		roster = await runRoster(logPath, 2);
		({ events, malformed } = readProbeEvents(logPath));
		classification = classifyProbe(roster, events);
	}

	writeFileSync(join(artifactDir, "roster.json"), `${JSON.stringify(roster, null, 2)}\n`);
	// A corrupted line is a run-invalidating state, not a footnote: the missing
	// line could be the very wire marker whose absence the classifier would then
	// read as evidence. The artifact must say so ON ITS FACE — a reader of the
	// directory alone must find INVALIDATED as the verdict, never a
	// judgeable-looking thin-log classification (GPT review round 2). The
	// thin-log reading is preserved INSIDE the wrapper for forensics only.
	if (malformed.length > 0) {
		writeFileSync(join(artifactDir, "malformed-lines.txt"), `${malformed.join("\n")}\n`);
		writeFileSync(
			join(artifactDir, "classification.json"),
			`${JSON.stringify(
				{
					verdict: "INVALIDATED",
					reason: "malformed-event-log",
					malformedLines: malformed.length,
					thinLogClassificationForForensicsOnly: classification,
				},
				null,
				2,
			)}\n`,
		);
		fail(
			`${malformed.length} malformed event line(s) — the log is not a judgeable record; ` +
				`run INVALIDATED, artifact preserved at ${artifactDir}`,
		);
	}
	writeFileSync(join(artifactDir, "classification.json"), `${JSON.stringify(classification, null, 2)}\n`);

	console.log(`[smoke-acp-ordering-probe-live] verdict: ${classification.verdict}`);
	console.log(`  ${classification.detail}`);
	console.log(`  expectedProviderToolId: ${classification.expectedProviderToolId ?? "(unmeasured)"}`);
	for (const r of classification.interventions) {
		console.log(
			`  ${r.runId} D=${r.delayMs}ms → ${r.kind}${r.promotable ? " [PROMOTABLE]" : ""}` +
				`${r.newSessionExcessMs !== undefined ? ` (newSession excess ${r.newSessionExcessMs}ms)` : ""}: ${r.evidence}`,
		);
	}
	console.log(`  artifact preserved: ${artifactDir}`);

	const judgeable = ["A", "A-withheld", "B", "C", "D-newSession", "D-enforceModel", "D-prompt"];
	if (!judgeable.includes(classification.verdict)) {
		fail(`verdict ${classification.verdict} — not a judgeable measurement (artifact preserved for classification)`);
	}
}

await main();
