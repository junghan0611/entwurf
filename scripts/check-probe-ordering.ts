// Deterministic gate for the §11-7 ordering probe (docs/acp-backend-rail.md).
//
// §11-7 allows the probe a raw client ONLY "bound by a gate asserting it issues
// the same calls, arguments, and order as the backend's real sequence" — THIS is
// that gate. Seven axes, no live API anywhere:
//
//   1) SAMENESS — driveProbeTurn over a recording fake connection must issue
//      initialize → newSession → enforceModel → prompt with production-shaped
//      arguments; the phase timeouts / call order / clientInfo / enforceModel
//      wire shape / permission policy are pinned against backend.ts and
//      backend-adapter.ts SOURCE, and the LIVE runner is pinned to inject the
//      REAL emitted claudeAdapter + enrichMcpServersWithEnvelope — so
//      production drift turns this gate red instead of silently unbinding the
//      probe.
//   2) PHASE ATTRIBUTION — a failure names its wire phase (set-model included:
//      §11-7 measured that dropping it misreads enforceModel stalls as C or D).
//   3) FIXTURE WIRE INSTRUMENTATION — the probe-mode fixture is spawned for
//      real (child process, no API) and must stamp the §11-7 marker set,
//      honor the injected startup delay, REQUIRE probeRunId, and stay
//      byte-compatible with smoke-acp-mcp-live when the probe env is absent.
//   4) EVENT LOG INTEGRITY — the contract at the log's door, both layers: the
//      writer may not have its own envelope rewritten by a payload key; a
//      JSON-valid line carrying an unknown marker name or a broken sort axis is
//      MALFORMED (→ the runner's INVALIDATED path), never a quiet event; and
//      every PAYLOAD field the classifier judges on is typed there too, since a
//      perfect envelope around `ok: "true"` reads as a phase failure and a wire
//      marker naming no expected tool is not wire-availability at all.
//   4b) EVENT LOG STREAM INTEGRITY — the second door, one layer out: per writing
//      pid, on the RAW APPEND ORDER, seq must strictly increase and the clock may
//      not run backwards. Checked BEFORE the sort, because a post-sort check is
//      circular — the comparator would have rewritten the order under examination.
//   5) VERDICT TRUTH TABLE — synthetic paired logs replay through the PURE
//      classifier: P0/I0 outside the verdict space, phase-qualified D, the B
//      promotion ladder (exact measured id only), C, and A's two-delay rule.
//   6) OBSERVATION WINDOW + RUNNER TOPOLOGY — what puts a run OUTSIDE the space:
//      a window closed by child-exit with the marker unseen is CENSORED, never an
//      MCP handshake/fixture/config attribution (the 2026-07-28 D2 misreading),
//      while the SAME absence under a window held to its deadline is a real
//      candidate. Runner-owned markers are exactly-once; repeatable ones are not
//      swept in with them.
//   7) TWO AXES — (a) the server-wait observation and (b) the callability reading
//      are reported separately, so a settled ordering fact is not buried by an
//      unsettled failure axis. A keeps the newSession axis; B/C's causal window is
//      promptStart, and the evidence carries both deltas plus the post-wire turn.
//   8) §11-7-c B-NAME-SNAPSHOT SEAM (consumer side) — the CLI-target
//      precondition gate (ambient override refused, native-branch absolute
//      target only, exact-allowlist scrub), the upstream launch-semantics
//      inspector (synthetic-validated, applied to the installed dists), the
//      shim event doors, and the snapshot verdict ladder (calibrated control,
//      exactly-one ordinal binding, interval-ordered absence, roster-armed
//      channel; B and B-name-snapshot never conflated). The PRODUCER (shim) is
//      gated separately by check-probe-cli-shim, and the LIVE runner now ARMS the
//      channel — 8d pins that wiring.
//
// Kill-proof, stated at its honest strength: scripts/mutants/probe-ordering.json
// qualifies 63 claims for THIS gate — each carries a [QK:...] signature appearing
// EXACTLY once below, and check-gate-qualification proves its mutant dies at that
// signature. (The lane also carries the §11-7-c PRODUCER claims, whose signatures
// live in check-probe-cli-shim.ts; one lane, two consuming gates.)
// [QK:*] tokens and qualified claims are 1:1 BY DESIGN: an assertion without a
// mutant carries a plain message, so "killed claim IDs, never assertion counts"
// stays readable. The remaining assertions are enforced-but-not-mutant-qualified.
// Properties that are review-pinned only (no deterministic mutant exists):
//   - the write-CALLBACK timing of tools_list_response_forwarded (cross-process
//     microsecond ordering; existence/attribution IS proven);
//   - the fixture's errored-write path (EPIPE cannot be forced deterministically
//     in this handshake; the callback rejects and never stamps — source-visible);
//   - the writer's SINGLE clock read (a two-read millisecond straddle is a rare
//     race, so it is pinned in source and made loud by the parser's ts↔tsMs
//     equality rule, which IS mutant-qualified).

import { strict as assert } from "node:assert";
import { type ChildProcessByStdio, spawn } from "node:child_process";
import {
	appendFileSync,
	chmodSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import type { Readable, Writable } from "node:stream";
import { fileURLToPath } from "node:url";
import { PROTOCOL_VERSION } from "@agentclientprotocol/sdk";
import type { AcpConnectionLike } from "../pi-extensions/lib/acp/acp-client.ts";
import { resolveProviderConfig } from "../pi-extensions/lib/acp/config.ts";
import { terminateChild } from "./lib/acp-child-cleanup.ts";
import {
	driveProbeTurn,
	PROBE_PHASE_TIMEOUTS,
	PROBE_PROMPT_OBSERVATION_MS,
	type ProbeAdapterSeam,
	type ProbeMcpEnricher,
	ProbePhaseError,
	type ProbeTurnPhase,
} from "./lib/probe-acp-turn.ts";
import {
	AMBIENT_OVERRIDE_ENV,
	hashFileSha256,
	PROBE_SHIM_ENV,
	ProbeCliPreconditionError,
	resolveProbeCliTarget,
	SDK_SCRIPT_SUFFIXES,
	SHIM_SCRUB_ENV_VARS,
} from "./lib/probe-cli-target.ts";
import {
	appendProbeEvent,
	PAYLOAD_CONTRACT_EVENTS,
	PROBE_ENV,
	PROBE_EVENTS,
	PROBE_EXPECTED_TOOL,
	type ProbeEvent,
	type ProbeWindowReason,
	RESERVED_EVENT_KEYS,
	readProbeEvents,
} from "./lib/probe-event-log.ts";
import { classifyProbe, DELAY_WELL_BELOW_MS, type ProbeRunRecord, RUNNER_EXACTLY_ONCE } from "./lib/probe-verdict.ts";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const BACKEND_SRC = readFileSync(join(REPO_ROOT, "pi-extensions", "lib", "acp", "backend.ts"), "utf8");
const ADAPTER_SRC = readFileSync(join(REPO_ROOT, "pi-extensions", "lib", "acp", "backend-adapter.ts"), "utf8");
const RUNNER_SRC = readFileSync(join(REPO_ROOT, "scripts", "smoke-acp-ordering-probe-live.ts"), "utf8");
const EVENT_LOG_SRC = readFileSync(join(REPO_ROOT, "scripts", "lib", "probe-event-log.ts"), "utf8");
const VERDICT_SRC = readFileSync(join(REPO_ROOT, "scripts", "lib", "probe-verdict.ts"), "utf8");
const FIXTURE_PATH = join(REPO_ROOT, "scripts", "fixtures", "probe-mcp-server.ts");
const FIXTURE_SRC = readFileSync(FIXTURE_PATH, "utf8");
const tmp = mkdtempSync(join(tmpdir(), "check-probe-ordering-"));

// The REAL config resolver (config.ts is strip-types-clean) over a scratch
// operator settings file — the fixture entry must survive config→wire intact.
function makeConfigFixture(): ReturnType<typeof resolveProviderConfig> {
	const cwd = join(tmp, "cfg");
	mkdirSync(join(cwd, ".pi"), { recursive: true });
	const projectSettingsPath = join(cwd, ".pi", "settings.json");
	writeFileSync(
		projectSettingsPath,
		`${JSON.stringify({
			entwurfProvider: {
				mcpServers: { probe: { command: "node", args: ["probe.ts"], env: { X: "1" } } },
			},
		})}\n`,
	);
	return resolveProviderConfig({
		cwd,
		modelId: "claude-sonnet-5",
		adapter: { resolveAdapterSettings: () => undefined } as never,
		globalSettingsPath: join(cwd, ".pi", "no-global.json"),
		projectSettingsPath,
	});
}

interface RecordedCall {
	method: string;
	params: unknown;
}

function makeRecordingConnection(calls: RecordedCall[]): AcpConnectionLike {
	return {
		initialize: async (params) => {
			calls.push({ method: "initialize", params });
			return { protocolVersion: PROTOCOL_VERSION };
		},
		newSession: async (params) => {
			calls.push({ method: "newSession", params });
			return { sessionId: "sess-gate" };
		},
		setSessionConfigOption: async (params) => {
			calls.push({ method: "setSessionConfigOption", params });
			return {};
		},
		prompt: async (params) => {
			calls.push({ method: "prompt", params });
			return { stopReason: "end_turn" };
		},
	};
}

// ===========================================================================
// 1) SAMENESS — recorded sequence + production source pins
// ===========================================================================
{
	const config = makeConfigFixture();
	const calls: RecordedCall[] = [];
	const logged: Array<{ event: string; payload: Record<string, unknown> }> = [];
	const metaMarker = { modelId: "claude-sonnet-5", gateMeta: true };
	const enrichedMarker = [{ name: "probe", command: "node", args: ["probe.ts"], env: [{ name: "X", value: "1" }] }];
	let enrichArgs: { servers: unknown; envelope: unknown } | undefined;
	let metaArgs: { params: unknown; carrier: unknown } | undefined;
	const recordingAdapter: ProbeAdapterSeam = {
		buildSessionMeta(params, carrier) {
			metaArgs = { params, carrier };
			return metaMarker;
		},
		async enforceModel(params) {
			calls.push({ method: "enforceModel", params: { ...params, connection: "<connection>" } });
		},
	};

	// PI_SESSION_ID would leak the host session into the envelope assertion —
	// pin it to a deterministic value for the recording turn.
	const prevPiSession = process.env.PI_SESSION_ID;
	process.env.PI_SESSION_ID = "gate-pi-session";
	try {
		await driveProbeTurn(makeRecordingConnection(calls), {
			cwd: "/scratch/gate",
			modelId: "claude-sonnet-5",
			nativeModelId: "claude-sonnet-5",
			config,
			carrier: "gate-carrier",
			promptText: "gate prompt",
			adapter: recordingAdapter,
			enrichMcpServers: (servers, envelope) => {
				enrichArgs = { servers, envelope };
				return enrichedMarker as never;
			},
			log: (event, payload = {}) => logged.push({ event, payload }),
		});
	} finally {
		if (prevPiSession === undefined) delete process.env.PI_SESSION_ID;
		else process.env.PI_SESSION_ID = prevPiSession;
	}

	assert.deepEqual(
		calls.map((c) => c.method),
		["initialize", "newSession", "enforceModel", "prompt"],
		"probe issues the production wire sequence in order",
	);
	assert.deepEqual(
		calls[0].params,
		{
			protocolVersion: PROTOCOL_VERSION,
			clientCapabilities: {},
			clientInfo: { name: "entwurf", version: "s2d" },
		},
		"initialize params match backend.ts byte-shape [QK:PROBE-SEQ-ORDER]",
	);
	const newSessionParams = calls[1].params as { cwd: string; mcpServers: unknown; _meta?: unknown };
	assert.equal(newSessionParams.cwd, "/scratch/gate", "newSession carries the run cwd");
	assert.equal(newSessionParams.mcpServers, enrichedMarker, "newSession sends EXACTLY the envelope-enriched servers");
	assert.deepEqual(
		enrichArgs,
		{
			servers: config.mcpServers,
			envelope: { modelId: "claude-sonnet-5", piSessionId: "gate-pi-session" },
		},
		"enrichment sees the resolved servers + the production envelope",
	);
	assert.equal(config.mcpServers[0]?.name, "probe", "the fixture entry survives config resolution");
	assert.equal(newSessionParams._meta, metaMarker, "newSession _meta is buildSessionMeta's result");
	assert.deepEqual(
		metaArgs,
		{
			params: { modelId: "claude-sonnet-5", nativeModelId: "claude-sonnet-5", config },
			carrier: "gate-carrier",
		},
		"buildSessionMeta receives the production inputs incl. the carrier",
	);
	assert.deepEqual(
		calls[2].params,
		{
			connection: "<connection>",
			acpSessionId: "sess-gate",
			modelId: "claude-sonnet-5",
			nativeModelId: "claude-sonnet-5",
		},
		"enforceModel receives the production inputs (adapter owns the wire shape)",
	);
	const promptParams = calls[3].params as { sessionId: string; prompt: Array<{ type: string; text: string }> };
	assert.equal(promptParams.sessionId, "sess-gate", "prompt binds the newSession sessionId");
	assert.deepEqual(
		promptParams.prompt,
		[{ type: "text", text: "gate prompt" }],
		"prompt block shape matches production",
	);

	// Set-model markers exist BETWEEN newSession end and prompt start — §11-7:
	// dropping them misreads an enforceModel stall as C or D.
	const eventOrder = logged.map((l) => l.event);
	const nsEnd = eventOrder.indexOf(PROBE_EVENTS.newSessionEnd);
	const smStart = eventOrder.indexOf(PROBE_EVENTS.setModelStart);
	const smEnd = eventOrder.indexOf(PROBE_EVENTS.setModelEnd);
	const pStart = eventOrder.indexOf(PROBE_EVENTS.promptStart);
	assert.ok(
		nsEnd !== -1 && smStart > nsEnd && smEnd > smStart && pStart > smEnd,
		`set-model start/end are marked between newSession end and prompt start (got ${eventOrder.join(",")})`,
	);

	// Carrier-less shape: an undefined session meta omits the `_meta` KEY entirely.
	const calls2: RecordedCall[] = [];
	await driveProbeTurn(makeRecordingConnection(calls2), {
		cwd: "/scratch/gate2",
		modelId: "claude-sonnet-5",
		nativeModelId: "claude-sonnet-5",
		config,
		carrier: null,
		promptText: "x",
		adapter: { buildSessionMeta: () => undefined, enforceModel: async () => {} },
		enrichMcpServers: (servers) => servers,
		log: () => {},
	});
	assert.ok(
		!Object.hasOwn(calls2.find((c) => c.method === "newSession")?.params as object, "_meta"),
		"undefined session meta omits the _meta KEY entirely (carrier-less shape)",
	);

	// --- production source pins ---------------------------------------------
	const timeoutOf = (name: string): number => {
		const m = new RegExp(`const ${name} = ([\\d_]+);`).exec(BACKEND_SRC);
		assert.ok(m, `backend.ts declares ${name}`);
		return Number(m[1].replaceAll("_", ""));
	};
	assert.deepEqual(
		{
			initializeMs: PROBE_PHASE_TIMEOUTS.initializeMs,
			newSessionMs: PROBE_PHASE_TIMEOUTS.newSessionMs,
			setModelMs: PROBE_PHASE_TIMEOUTS.setModelMs,
		},
		{
			initializeMs: timeoutOf("INITIALIZE_TIMEOUT_MS"),
			newSessionMs: timeoutOf("NEW_SESSION_TIMEOUT_MS"),
			setModelMs: timeoutOf("SET_MODEL_TIMEOUT_MS"),
		},
		"probe BOOTSTRAP timeouts EQUAL backend.ts's — a bootstrap-phase D is only readable against production " +
			"boundaries [QK:PROBE-BOOTSTRAP-TIMEOUTS-MATCH-PRODUCTION]",
	);

	// --- the prompt phase has NO production boundary to match --------------
	//
	// backend.ts ends a prompt on lifecycle events only. The probe still needs a
	// bounded observation horizon so a measurement RUN cannot hang forever, but
	// that horizon is the harness's own: pinning it to a production number (or
	// letting production grow one back) would make the probe report a
	// harness-invented cutoff as if it were the turn contract.
	const promptCutoffTraces = [/\bPROMPT_TIMEOUT_MS\b/, /withTimeout\(\s*\n?\s*"prompt"/].filter((re) =>
		re.test(BACKEND_SRC),
	);
	assert.equal(
		promptCutoffTraces.length,
		0,
		"[QK:NO-PRODUCTION-PROMPT-CUTOFF] backend.ts carries NO prompt wall-clock — neither a PROMPT_TIMEOUT_MS constant " +
			'nor a withTimeout("prompt", …) race. A running turn is not a failed turn for being long, and the old 600s ' +
			`cutoff also fed pi's transient-retry dictionary. Found: ${promptCutoffTraces.join(", ")}`,
	);
	assert.ok(
		PROBE_PROMPT_OBSERVATION_MS > 0 && !("promptMs" in PROBE_PHASE_TIMEOUTS),
		"[QK:PROMPT-HORIZON-NOT-PRODUCTION] the prompt horizon lives OUTSIDE the production-pinned bootstrap set — it is " +
			"the harness's own observation bound, and folding it back in would report a harness number as the turn contract",
	);

	const idx = (needle: string): number => {
		const i = BACKEND_SRC.indexOf(needle);
		assert.ok(i !== -1, `backend.ts contains ${JSON.stringify(needle)}`);
		return i;
	};
	const iInit = idx("connection.initialize({");
	const iNew = idx("connection.newSession(newSessionArgs)");
	const iEnforce = idx("adapter.enforceModel({");
	// The prompt no longer sits inline: runNewTurn hands the wire call to
	// awaitAcpPromptTurn (the lifecycle-bounded driver), so the ordering pin
	// follows the dispatch, and the driver's own `session.connection.prompt(...)`
	// is the single place the wire call lives.
	const iPrompt = BACKEND_SRC.indexOf("await awaitAcpPromptTurn(", iEnforce);
	assert.ok(
		iInit < iNew && iNew < iEnforce && iEnforce < iPrompt && iPrompt !== -1,
		"backend.ts runNewTurn keeps initialize → newSession → enforceModel → prompt; the probe mirrors THIS sequence",
	);
	assert.ok(
		BACKEND_SRC.includes("await Promise.race([session.connection.prompt(promptArgs), lifecycle])"),
		"the prompt driver races the wire call against LIFECYCLE endings only — the probe mirrors that same wire call",
	);
	assert.ok(
		BACKEND_SRC.includes('clientInfo: { name: "entwurf", version: "s2d" }'),
		"backend.ts still sends the clientInfo the probe mirrors",
	);
	// The claude adapter's enforceModel wire shape — the LIVE probe executes THIS
	// method (emitted twin), so its shape is pinned where it lives.
	assert.ok(
		ADAPTER_SRC.includes(
			'await setConfig.call(connection, { sessionId: acpSessionId, configId: "model", value: nativeModelId });',
		),
		'claudeAdapter.enforceModel still sends setSessionConfigOption({configId:"model"})',
	);

	// Permission policy: the runner's copy must mirror backend.ts's private
	// resolvePermissionResponse (approve-first-allow, empty → cancelled).
	for (const [label, src] of [
		["backend.ts", BACKEND_SRC],
		["smoke-acp-ordering-probe-live.ts", RUNNER_SRC],
	] as const) {
		assert.ok(
			src.includes('o.kind === "allow_once" || o.kind === "allow_always"') &&
				src.includes('if (options.length === 0) return { outcome: { outcome: "cancelled" } };'),
			`${label} carries the approve-first-allow permission policy`,
		);
	}

	// The runner must drive THE gated sequence with the REAL emitted production
	// modules — never a bare wire call or a re-implementation of its own.
	assert.ok(
		RUNNER_SRC.includes("driveProbeTurn(") &&
			RUNNER_SRC.includes("adapterMod.claudeAdapter") &&
			RUNNER_SRC.includes("configMod.enrichMcpServersWithEnvelope") &&
			RUNNER_SRC.includes("adapter: claudeAdapter") &&
			RUNNER_SRC.includes("enrichMcpServers: enrichMcpServersWithEnvelope") &&
			!RUNNER_SRC.includes("connection.initialize(") &&
			!RUNNER_SRC.includes("connection.newSession(") &&
			!RUNNER_SRC.includes("connection.prompt("),
		"the LIVE runner routes every wire call through driveProbeTurn with the emitted production adapter/config",
	);

	// The runtime No-such-tool marker may ride ONLY structured tool frames —
	// scanning agent prose would let the model MINT the marker by saying the
	// sentence, silently promoting prose to runtime evidence. Exactly one scan
	// call site (plus its definition), and never inside the agent-chunk branch.
	const scanSites = RUNNER_SRC.split("scanStructuredNoSuchTool").length - 1;
	assert.ok(
		scanSites === 2 && !/collectedText \+= t;[^}]*scanStructured/s.test(RUNNER_SRC),
		"No-such-tool is scanned ONLY off structured tool frames, never agent prose [QK:PROBE-NO-PROSE-ERROR-SCAN]",
	);

	// A broken event log is run-invalidating on BOTH doors: a malformed line could
	// be the very wire marker whose absence the classifier would then read as
	// evidence, and a stream whose per-writer order cannot be trusted cannot carry
	// an ordering verdict at all. The preserved classification.json must say
	// INVALIDATED on its face, never a judgeable-looking thin-log verdict.
	//
	// Pinned as the WHOLE guard, not the substring `if (malformed.length > 0)`:
	// that shorter form also matches the artifact-writing line right below it, so
	// a mutant could disable the guard and still satisfy the pin. It did — this
	// assertion SURVIVED its own mutant until the pin was tightened (2026-07-29).
	// The post-delay slack is what lets a missing wire marker be read as evidence:
	// an operator-shrinkable window could close early and then be called
	// "deadline-sufficient". It is a constant, and no env may reach it.
	assert.ok(
		RUNNER_SRC.includes("const POST_DELAY_SLACK_MS = 5_000;") && !RUNNER_SRC.includes("PROBE_POST_DELAY_SLACK_MS"),
		"the observation window's post-delay slack is a CONSTANT with no env override [QK:PROBE-WINDOW-SLACK-IS-CONSTANT]",
	);

	// The exit contract asks three separate questions. Failing the run on the
	// composite verdict alone reported a pair that MEASURED its ordering axis as a
	// failed run, purely because the callability axis had no marker.
	assert.ok(
		RUNNER_SRC.includes('classification.status.validity !== "valid" && classification.status.validity !== "partial"') &&
			RUNNER_SRC.includes("do not read it as a complete series") &&
			RUNNER_SRC.includes('classification.status.orderingMeasurement !== "measured"') &&
			RUNNER_SRC.includes("NOT a claim about server wait behavior"),
		"the runner's exit contract separates fatal validity from the two axes, and claims no server-wait conclusion [QK:RUNNER-EXIT-CONTRACT-SPLIT]",
	);

	assert.ok(
		RUNNER_SRC.includes("if (malformed.length > 0 || sequenceViolations.length > 0) {") &&
			RUNNER_SRC.includes("run INVALIDATED") &&
			RUNNER_SRC.includes('verdict: "INVALIDATED"'),
		"the runner refuses to judge a log with malformed lines OR per-writer order violations, and writes an INVALIDATED classification [QK:PROBE-MALFORMED-INVALIDATES]",
	);
}

// ===========================================================================
// 2) PHASE ATTRIBUTION — a failure names its wire phase; timeouts are flagged
// ===========================================================================
{
	const config = makeConfigFixture();
	const passthroughAdapter: ProbeAdapterSeam = {
		buildSessionMeta: () => undefined,
		enforceModel: async () => {},
	};
	const identityEnrich: ProbeMcpEnricher = (servers) => [...servers];
	const base = {
		cwd: "/scratch/phase",
		modelId: "claude-sonnet-5",
		nativeModelId: "claude-sonnet-5",
		config,
		carrier: null as string | null,
		promptText: "x",
		adapter: passthroughAdapter,
		enrichMcpServers: identityEnrich,
		log: () => {},
	};
	const failAt = async (broken: Partial<AcpConnectionLike>, adapter?: ProbeAdapterSeam): Promise<ProbePhaseError> => {
		const calls: RecordedCall[] = [];
		const conn = { ...makeRecordingConnection(calls), ...broken };
		try {
			await driveProbeTurn(conn, { ...base, adapter: adapter ?? passthroughAdapter });
		} catch (err) {
			assert.ok(err instanceof ProbePhaseError, "turn failures are ProbePhaseError");
			return err;
		}
		assert.fail("expected the broken connection to fail the turn");
	};

	const expectPhase = async (
		phase: ProbeTurnPhase,
		broken: Partial<AcpConnectionLike>,
		adapter?: ProbeAdapterSeam,
	): Promise<void> => {
		const err = await failAt(broken, adapter);
		assert.equal(err.phase, phase, `failure attributes to ${phase}`);
	};
	await expectPhase("initialize", { initialize: async () => Promise.reject(new Error("boom")) });
	await expectPhase("newSession", { newSession: async () => Promise.reject(new Error("boom")) });
	await expectPhase("newSession", { newSession: async () => ({}) }); // no sessionId
	await expectPhase(
		"enforceModel",
		{},
		{
			buildSessionMeta: () => undefined,
			enforceModel: async () => Promise.reject(new Error("boom")),
		},
	);
	await expectPhase("prompt", { prompt: async () => Promise.reject(new Error("boom")) });

	// Timeout path — a hung set-model must attribute to enforceModel AND flag timedOut.
	const calls: RecordedCall[] = [];
	try {
		await driveProbeTurn(makeRecordingConnection(calls), {
			...base,
			adapter: { buildSessionMeta: () => undefined, enforceModel: () => new Promise<never>(() => {}) },
			timeouts: { initializeMs: 1000, newSessionMs: 1000, setModelMs: 50 },
			promptObservationMs: 1000,
		});
		assert.fail("hung set-model must time the turn out");
	} catch (err) {
		assert.ok(err instanceof ProbePhaseError, "timeout is a ProbePhaseError");
		assert.equal(err.phase, "enforceModel", "timeout attributes to enforceModel");
		assert.equal(err.timedOut, true, "timeout is flagged timedOut");
	}
}

// ===========================================================================
// 3) FIXTURE WIRE INSTRUMENTATION — real child, raw JSON-RPC, no API
// ===========================================================================

interface FixtureChild {
	child: ChildProcessByStdio<Writable, Readable, Readable>;
	request(msg: Record<string, unknown>, timeoutMs?: number): Promise<Record<string, unknown>>;
	notify(msg: Record<string, unknown>): void;
}

function spawnFixture(env: Record<string, string>): FixtureChild {
	const child = spawn(process.execPath, ["--experimental-strip-types", FIXTURE_PATH], {
		cwd: tmp,
		env: { ...process.env, ...env },
		stdio: ["pipe", "pipe", "pipe"],
	}) as ChildProcessByStdio<Writable, Readable, Readable>;
	let buffer = "";
	const pending: Array<{ id: number; resolve: (msg: Record<string, unknown>) => void }> = [];
	child.stdout.on("data", (chunk) => {
		buffer += chunk.toString();
		let nl = buffer.indexOf("\n");
		while (nl !== -1) {
			const line = buffer.slice(0, nl).trim();
			buffer = buffer.slice(nl + 1);
			if (line.length > 0) {
				const msg = JSON.parse(line) as Record<string, unknown>;
				const i = pending.findIndex((p) => p.id === msg.id);
				if (i !== -1) pending.splice(i, 1)[0].resolve(msg);
			}
			nl = buffer.indexOf("\n");
		}
	});
	return {
		child,
		request(msg, timeoutMs = 10_000) {
			return new Promise((resolvePromise, reject) => {
				const timer = setTimeout(
					() => reject(new Error(`fixture did not answer ${msg.method} within ${timeoutMs}ms`)),
					timeoutMs,
				);
				pending.push({
					id: msg.id as number,
					resolve: (m) => {
						clearTimeout(timer);
						resolvePromise(m);
					},
				});
				child.stdin.write(`${JSON.stringify(msg)}\n`);
			});
		},
		notify(msg) {
			child.stdin.write(`${JSON.stringify(msg)}\n`);
		},
	};
}

const INIT_PARAMS = {
	protocolVersion: "2024-11-05",
	capabilities: {},
	clientInfo: { name: "check-probe-ordering", version: "0" },
};

// --- probe mode: delay honored, marker set stamped, probeRunId required -----
{
	const logPath = join(tmp, "probe-mode.ndjson");
	const delayMs = 400;
	const fx = spawnFixture({
		[PROBE_ENV.eventLog]: logPath,
		[PROBE_ENV.startupDelayMs]: String(delayMs),
		[PROBE_ENV.runId]: "gate-run",
		[PROBE_ENV.nonce]: "GATE_NONCE",
	});
	try {
		// The injected delay sits before serving: this first request only answers
		// after ≥ delayMs (generous wire timeout keeps slow machines green).
		await fx.request({ jsonrpc: "2.0", id: 1, method: "initialize", params: INIT_PARAMS });
		fx.notify({ jsonrpc: "2.0", method: "notifications/initialized" });
		const list = await fx.request({ jsonrpc: "2.0", id: 2, method: "tools/list" });
		const tools = (list.result as { tools: Array<{ name: string; inputSchema?: { required?: string[] } }> }).tools;
		assert.equal(tools.length, 1, "fixture serves exactly one tool");
		assert.equal(tools[0].name, "probe_nonce", "the tool is probe_nonce");
		assert.ok(
			tools[0].inputSchema?.required?.includes("probeRunId"),
			"probe mode REQUIRES probeRunId [QK:PROBE-FIXTURE-RUNID-REQUIRED] — the §11-7 cross-layer join key",
		);

		const good = await fx.request({
			jsonrpc: "2.0",
			id: 3,
			method: "tools/call",
			params: { name: "probe_nonce", arguments: { probeRunId: "prb-gate" } },
		});
		const goodText = JSON.stringify(good.result ?? {});
		assert.ok(goodText.includes("GATE_NONCE"), "a correlated call returns the nonce");

		const bad = await fx.request({
			jsonrpc: "2.0",
			id: 4,
			method: "tools/call",
			params: { name: "probe_nonce", arguments: {} },
		});
		const badIsError = bad.error !== undefined || (bad.result as { isError?: boolean } | undefined)?.isError === true;
		assert.ok(badIsError, "a call WITHOUT probeRunId is refused");

		// Marker set + ordering + honored delay, read off the one shared log.
		// (appendFileSync in the fixture is synchronous, but poll briefly anyway so
		// a slow fs never turns a green wire into a red gate.)
		let events: ProbeEvent[] = [];
		for (let i = 0; i < 20; i++) {
			({ events } = readProbeEvents(logPath));
			if (events.some((e) => e.event === PROBE_EVENTS.fixtureToolsCallReplied)) break;
			await new Promise((r) => setTimeout(r, 100));
		}
		const names = events.map((e) => e.event);
		for (const expected of [
			PROBE_EVENTS.fixtureProcessStart,
			PROBE_EVENTS.fixtureDelayStart,
			PROBE_EVENTS.fixtureDelayEnd,
			PROBE_EVENTS.fixtureTransportConnected,
			PROBE_EVENTS.fixtureInitializeReceived,
			PROBE_EVENTS.fixtureToolsListReceived,
			PROBE_EVENTS.toolsListResponseForwarded,
			PROBE_EVENTS.fixtureToolsCallReceived,
			PROBE_EVENTS.fixtureToolsCallReplied,
		]) {
			assert.ok(names.includes(expected), `fixture stamps ${expected} [QK:PROBE-FIXTURE-WIRE-MARKER]`);
		}
		const delayStart = events.find((e) => e.event === PROBE_EVENTS.fixtureDelayStart);
		const delayEnd = events.find((e) => e.event === PROBE_EVENTS.fixtureDelayEnd);
		assert.ok(
			delayStart && delayEnd && delayEnd.tsMs - delayStart.tsMs >= delayMs - 5,
			`the startup delay is actually honored (${delayEnd?.tsMs}-${delayStart?.tsMs} vs ${delayMs})`,
		);
		const forwarded = events.find((e) => e.event === PROBE_EVENTS.toolsListResponseForwarded);
		assert.ok(
			Array.isArray(forwarded?.tools) && (forwarded.tools as string[]).includes("probe_nonce"),
			"the forwarded marker names the expected tool",
		);
		const callReceived = events.find((e) => e.event === PROBE_EVENTS.fixtureToolsCallReceived);
		assert.equal(callReceived?.probeRunId, "prb-gate", "the callability marker carries the correlation argument");
		assert.ok(
			(forwarded?.tsMs ?? 0) >= (delayEnd?.tsMs ?? Number.MAX_SAFE_INTEGER),
			"nothing is forwarded before the injected delay elapses",
		);
		assert.ok(
			events.every((e) => e.runId === "gate-run"),
			"every fixture event carries the runId",
		);
	} finally {
		await terminateChild(fx.child);
	}
}

// --- legacy mode: byte-compatible surface for smoke-acp-mcp-live ------------
{
	const legacyLog = join(tmp, "legacy-should-not-exist.ndjson");
	const fx = spawnFixture({ [PROBE_ENV.nonce]: "LEGACY_NONCE" });
	try {
		await fx.request({ jsonrpc: "2.0", id: 1, method: "initialize", params: INIT_PARAMS });
		fx.notify({ jsonrpc: "2.0", method: "notifications/initialized" });
		const list = await fx.request({ jsonrpc: "2.0", id: 2, method: "tools/list" });
		const tools = (list.result as { tools: Array<{ name: string; inputSchema?: { required?: string[] } }> }).tools;
		assert.equal(tools[0]?.name, "probe_nonce", "legacy mode still serves probe_nonce");
		assert.ok(
			!tools[0].inputSchema?.required?.includes("probeRunId"),
			"legacy mode does NOT require probeRunId (smoke-acp-mcp-live compat)",
		);
		const call = await fx.request({
			jsonrpc: "2.0",
			id: 3,
			method: "tools/call",
			params: { name: "probe_nonce", arguments: {} },
		});
		assert.ok(
			JSON.stringify(call.result ?? {}).includes("LEGACY_NONCE"),
			"legacy argument-less call still returns the nonce",
		);
		assert.ok(!existsSync(legacyLog), "legacy mode writes no event log");
	} finally {
		await terminateChild(fx.child);
	}
}

// ===========================================================================
// 4) EVENT LOG INTEGRITY — the envelope contract at the door
// ===========================================================================
//
// The shared NDJSON log is the record the verdict is read off, so a line that
// merely parses as JSON is not yet an event. §11-7's two decisive reads are
// ABSENCE (a marker that never appears) and ORDERING (one tsMs axis across
// processes) — exactly what a typo'd marker name or a broken stamp corrupts
// while still looking healthy. Such a line must leave through the SAME door as
// a truncated one (malformed → the runner's INVALIDATED path above), and a
// caller's payload must never be able to rewrite the envelope it rides in.
{
	// Writer round-trip: its own line clears the door, payload rides alongside,
	// and the readable stamp agrees with the sort axis EXACTLY.
	const okPath = join(tmp, "envelope-ok.ndjson");
	appendProbeEvent(okPath, "env-run", PROBE_EVENTS.runStart, { note: "hello" });
	const roundTrip = readProbeEvents(okPath);
	assert.equal(roundTrip.malformed.length, 0, "the writer's own line clears the envelope contract");
	assert.equal(roundTrip.events.length, 1, "…and lands as exactly one event");
	const written = roundTrip.events[0];
	assert.equal(Date.parse(written.ts), written.tsMs, "ts is DERIVED from tsMs — no millisecond straddle");
	assert.equal(written.note, "hello", "payload rides alongside the envelope");
	assert.ok(
		EVENT_LOG_SRC.includes("const tsMs = Date.now();") && !EVENT_LOG_SRC.includes("ts: new Date().toISOString()"),
		"the writer reads the clock ONCE and derives ts from it (a second read could straddle a millisecond)",
	);

	// Envelope authority: a payload key may never rewrite the run id, the marker
	// name, or the sort axis of its own evidence line. The write REFUSES — a
	// silent merge (either key order) would leave a lying line on disk.
	const authPath = join(tmp, "envelope-authority.ndjson");
	const refusedEveryKey = RESERVED_EVENT_KEYS.every((key) => {
		try {
			appendProbeEvent(authPath, "env-run", PROBE_EVENTS.runStart, { [key]: "hijacked" });
			return false;
		} catch {
			return true;
		}
	});
	assert.ok(
		refusedEveryKey && !existsSync(authPath),
		"a payload carrying a reserved envelope key is REFUSED and nothing is written [QK:PROBE-LOG-ENVELOPE-AUTHORITY]",
	);

	const STAMP_MS = 1_700_000_000_000;
	const stamp = { seq: 0, pid: 1234, ts: new Date(STAMP_MS).toISOString(), tsMs: STAMP_MS, runId: "env-run" };

	// Vocabulary: a name neither writer nor classifier knows is not a new event —
	// it is a marker that went MISSING, and §11-7 reads absence as evidence.
	const vocabPath = join(tmp, "envelope-vocab.ndjson");
	appendFileSync(vocabPath, `${JSON.stringify({ ...stamp, event: "new_sesion_end" })}\n`, "utf8");
	const vocab = readProbeEvents(vocabPath);
	assert.ok(
		vocab.events.length === 0 && vocab.malformed.length === 1,
		"an unknown event name is a MISSING marker, never a quiet extra line [QK:PROBE-LOG-EVENT-VOCABULARY]",
	);

	// Structural envelope: the shared sort axis and its readable twin. A tsMs
	// that is absent or non-numeric makes the comparator NaN and un-orders the
	// whole log, so ran-ahead / ordering-kept would be read off file order.
	// These lines deliberately carry an event with NO payload rule (run_start is
	// forensic): the envelope checks must be what rejects them, or this claim
	// would be silently proven by the payload layer instead of its own code.
	const brokenPath = join(tmp, "envelope-broken.ndjson");
	const brokenLines = [
		{ ...stamp, event: PROBE_EVENTS.runStart, tsMs: undefined }, // no sort axis at all
		{ ...stamp, event: PROBE_EVENTS.runStart, tsMs: "1700000000000" }, // string axis → NaN comparator
		{ ...stamp, event: PROBE_EVENTS.runStart, ts: "not-a-timestamp" }, // readable twin unparseable
		{ ...stamp, event: PROBE_EVENTS.runStart, tsMs: STAMP_MS + 1 }, // twin disagrees by 1ms
		{ ...stamp, event: PROBE_EVENTS.runStart, seq: -1 }, // per-process counter
		{ ...stamp, event: PROBE_EVENTS.runStart, pid: 0 }, // writer identity
		{ ...stamp, event: PROBE_EVENTS.runStart, runId: "" }, // unattributable line
	];
	for (const line of brokenLines) appendFileSync(brokenPath, `${JSON.stringify(line)}\n`, "utf8");
	const broken = readProbeEvents(brokenPath);
	assert.ok(
		broken.events.length === 0 && broken.malformed.length === brokenLines.length,
		"a JSON-valid line with a broken envelope is MALFORMED, never an event [QK:PROBE-LOG-ENVELOPE-SCHEMA]",
	);

	// Payload contract: the envelope can be perfect and the line still a lie,
	// because the classifier judges on payload. `ok === true` is FALSE for the
	// string "true", so a corrupted phase end silently reads as a phase FAILURE
	// (D / P0) instead of invalidating the run; an uncorrelatable id does the
	// same toward absence. Every field the classifier reads is typed at the door.
	const payloadPath = join(tmp, "payload-broken.ndjson");
	const badPayloads = [
		{ ...stamp, event: PROBE_EVENTS.newSessionEnd }, // no ok at all → reads as "failed"
		{ ...stamp, event: PROBE_EVENTS.promptEnd, ok: "true" }, // string, not boolean
		{ ...stamp, event: PROBE_EVENTS.initializeEnd, ok: true, timedOut: "yes" },
		{ ...stamp, event: PROBE_EVENTS.setModelEnd, ok: false, error: 42 },
		{ ...stamp, event: PROBE_EVENTS.acpNoSuchTool, toolId: 7 }, // the absence id
		{ ...stamp, event: PROBE_EVENTS.acpToolCallObserved, providerToolId: "x" }, // no join key
		{ ...stamp, event: PROBE_EVENTS.acpToolCallObserved, probeRunId: 9 },
		{ ...stamp, event: PROBE_EVENTS.promptReply, carriesNonce: "yes" }, // the nonce echo
		{ ...stamp, event: PROBE_EVENTS.fixtureToolsCallReceived, tool: 1, probeRunId: "p" },
	];
	for (const line of badPayloads) appendFileSync(payloadPath, `${JSON.stringify(line)}\n`, "utf8");
	const payloadBroken = readProbeEvents(payloadPath);
	assert.ok(
		payloadBroken.events.length === 0 && payloadBroken.malformed.length === badPayloads.length,
		"a valid envelope with a payload the classifier cannot judge on is MALFORMED [QK:PROBE-LOG-PAYLOAD-SCHEMA]",
	);

	// …and the readings the writer legitimately omits are NOT malformed: the
	// fixture stamps an inbound tools/call before validating it, and an ACP frame
	// may carry no name/title. Refusing those would manufacture INVALIDATED runs
	// out of real model behavior (a call with no join key IS the absence reading).
	const observedPath = join(tmp, "payload-observed.ndjson");
	const observedLines = [
		{ ...stamp, event: PROBE_EVENTS.fixtureToolsCallReceived, tool: PROBE_EXPECTED_TOOL }, // model called with no join key
		{ ...stamp, event: PROBE_EVENTS.acpToolCallObserved, probeRunId: "prb-x" }, // no extractable provider id
		{ ...stamp, event: PROBE_EVENTS.newSessionEnd, ok: false, timedOut: true, error: "boom" },
	];
	for (const line of observedLines) appendFileSync(observedPath, `${JSON.stringify(line)}\n`, "utf8");
	const observed = readProbeEvents(observedPath);
	assert.ok(
		observed.malformed.length === 0 && observed.events.length === observedLines.length,
		"a legitimately absent optional field is an OBSERVATION, not a corrupt line",
	);

	// The wire-availability proxy must NAME the expected tool. §11-7 defines the
	// marker as the expected-tool tools/list frame reaching the pipe, so a marker
	// carrying another list is not that event — and it drives ran-ahead, C, and
	// the B branch. (The fixture only stamps it when the tool is present; this is
	// the same check at the READING door, where the verdict is actually taken.)
	const wirePath = join(tmp, "payload-wire.ndjson");
	const wireLines = [
		{ ...stamp, event: PROBE_EVENTS.toolsListResponseForwarded }, // no tools at all
		{ ...stamp, event: PROBE_EVENTS.toolsListResponseForwarded, tools: [] }, // served nothing
		{ ...stamp, event: PROBE_EVENTS.toolsListResponseForwarded, tools: ["other_tool"] },
		{ ...stamp, event: PROBE_EVENTS.toolsListResponseForwarded, tools: [7] },
	];
	for (const line of wireLines) appendFileSync(wirePath, `${JSON.stringify(line)}\n`, "utf8");
	const wire = readProbeEvents(wirePath);
	assert.ok(
		wire.events.length === 0 && wire.malformed.length === wireLines.length,
		"a wire marker that does not name the expected tool is not wire-availability [QK:PROBE-LOG-WIRE-MARKER-NAMES-TOOL]",
	);
	const goodWirePath = join(tmp, "payload-wire-ok.ndjson");
	appendFileSync(
		goodWirePath,
		`${JSON.stringify({ ...stamp, event: PROBE_EVENTS.toolsListResponseForwarded, tools: [PROBE_EXPECTED_TOOL, "x"] })}\n`,
		"utf8",
	);
	assert.equal(readProbeEvents(goodWirePath).events.length, 1, "a marker naming the expected tool still passes");

	// Coverage, stated as a hand-written literal (never read off the SUT): these
	// are exactly the events the classifier judges payload on. A new classifier
	// read without a door rule must turn this red rather than pass unnoticed.
	assert.deepEqual(
		[...PAYLOAD_CONTRACT_EVENTS].sort(),
		[
			PROBE_EVENTS.acpNoSuchTool,
			PROBE_EVENTS.acpToolCallObserved,
			PROBE_EVENTS.fixtureToolsCallReceived,
			PROBE_EVENTS.initializeEnd,
			PROBE_EVENTS.newSessionEnd,
			PROBE_EVENTS.observationWindowEnd,
			PROBE_EVENTS.promptEnd,
			PROBE_EVENTS.promptReply,
			PROBE_EVENTS.setModelEnd,
			PROBE_EVENTS.toolsListResponseForwarded,
			PROBE_EVENTS.shimBoot,
			PROBE_EVENTS.shimPromptForwarded,
			PROBE_EVENTS.shimInitSnapshot,
		].sort(),
		"the payload contract covers exactly the events the classifier judges on",
	);

	// One SSOT for the expected tool: fixture, parser, and classifier must not
	// each keep a private literal that can drift apart in silence.
	assert.ok(
		EVENT_LOG_SRC.split('"probe_nonce"').length - 1 === 1 &&
			!FIXTURE_SRC.includes('= "probe_nonce"') &&
			!VERDICT_SRC.includes('= "probe_nonce"'),
		"the expected tool name is defined ONCE (probe-event-log.ts) and imported by fixture and classifier",
	);

	// Truncation still behaves — the widened door did not lose the original one.
	const mixedPath = join(tmp, "envelope-mixed.ndjson");
	appendProbeEvent(mixedPath, "env-run", PROBE_EVENTS.runStart);
	appendFileSync(mixedPath, '{"event":"run_end","runId":"env-run"\n', "utf8");
	const mixed = readProbeEvents(mixedPath);
	assert.ok(
		mixed.events.length === 1 && mixed.malformed.length === 1,
		"an unparseable line is still malformed and the good line still parses",
	);

	// The window close is judged payload: `reason` decides whether a missing wire
	// marker is a reading or our own teardown, so an unknown reason must not fall
	// through to whatever branch consumes it.
	const winPath = join(tmp, "payload-window.ndjson");
	const winStamp = { seq: 0, pid: 7, ts: new Date(2_000).toISOString(), tsMs: 2_000, runId: "w" };
	appendFileSync(
		winPath,
		`${JSON.stringify({ ...winStamp, event: PROBE_EVENTS.observationWindowEnd, reason: "whenever", markerSeen: false })}\n`,
		"utf8",
	);
	appendFileSync(
		winPath,
		`${JSON.stringify({ ...winStamp, seq: 1, tsMs: 2_001, ts: new Date(2_001).toISOString(), event: PROBE_EVENTS.observationWindowEnd, reason: "deadline", markerSeen: "no" })}\n`,
		"utf8",
	);
	appendFileSync(
		winPath,
		`${JSON.stringify({ ...winStamp, seq: 2, tsMs: 2_002, ts: new Date(2_002).toISOString(), event: PROBE_EVENTS.observationWindowEnd, reason: "deadline", markerSeen: false })}\n`,
		"utf8",
	);
	const win = readProbeEvents(winPath);
	assert.ok(
		win.malformed.length === 2 && win.events.length === 1,
		"an unknown window reason and a non-boolean markerSeen are MALFORMED; the closed vocabulary passes [QK:PROBE-LOG-WINDOW-REASON-VOCAB]",
	);
}

// ===========================================================================
// 4b) EVENT LOG STREAM INTEGRITY — per-writer order, checked on RAW APPEND ORDER
// ===========================================================================
{
	const stream = (lines: Array<Record<string, unknown>>): ReturnType<typeof readProbeEvents> => {
		const p = join(tmp, `stream-${Math.random().toString(36).slice(2)}.ndjson`);
		for (const l of lines) appendFileSync(p, `${JSON.stringify(l)}\n`, "utf8");
		return readProbeEvents(p);
	};
	const line = (pid: number, seq: number, tsMs: number, event = PROBE_EVENTS.acpToolCallRaw) => ({
		seq,
		pid,
		ts: new Date(tsMs).toISOString(),
		tsMs,
		runId: "s",
		event,
	});

	// Clean stream: two writers interleaved, each strictly increasing.
	const clean = stream([line(1, 0, 100), line(2, 0, 101), line(1, 1, 102), line(2, 1, 103)]);
	assert.equal(clean.sequenceViolations.length, 0, "interleaved writers, each monotonic, is a clean stream");

	// GAPS are fine — the counter is process-wide, not file-wide, so a process
	// writing to more than one log skips numbers here by construction.
	const gapped = stream([line(1, 0, 100), line(1, 7, 101), line(1, 90, 102)]);
	assert.equal(
		gapped.sequenceViolations.length,
		0,
		"a per-pid seq GAP is not a violation — the counter is process-wide",
	);

	// A repeat is two lines claiming one slot: within a millisecond they cannot be
	// ordered against each other at all.
	const dupSeq = stream([line(1, 5, 100), line(1, 5, 100)]);
	assert.ok(
		dupSeq.sequenceViolations.length === 1 && /seq 5 does not exceed/.test(dupSeq.sequenceViolations[0]),
		"a repeated per-pid seq is a stream violation [QK:PROBE-LOG-SEQ-STRICTLY-INCREASING]",
	);
	const backSeq = stream([line(1, 5, 100), line(1, 4, 101)]);
	assert.equal(backSeq.sequenceViolations.length, 1, "a per-pid seq going backwards is a stream violation");

	// THE claim, asserted BEFORE the clock rule below on purpose: validation runs
	// on the RAW append order. This log sorts into perfect order — a post-sort
	// check would see nothing — yet the file itself has pid 1 writing seq 9 before
	// seq 2. (Ordering matters here: a check moved after the sort also perturbs the
	// clock-regression case, so this assertion must be the one that fires.)
	const outOfOrderInFile = stream([line(1, 9, 900), line(1, 2, 200)]);
	assert.ok(
		outOfOrderInFile.sequenceViolations.length > 0,
		"per-writer order is judged on the RAW file order, not after the sort has rewritten it [QK:PROBE-LOG-RAW-ORDER-BEFORE-SORT]",
	);
	assert.deepEqual(
		outOfOrderInFile.events.map((e) => e.seq),
		[2, 9],
		"the returned events are still sorted — the violation is reported, not repaired",
	);

	// One process reads one clock. A regression means the stamps were rewritten or
	// the clock stepped — and those stamps ARE the ordering evidence.
	const backTs = stream([line(1, 0, 500), line(1, 1, 499)]);
	assert.ok(
		backTs.sequenceViolations.length === 1 && /runs BACKWARDS/.test(backTs.sequenceViolations[0]),
		"a per-pid tsMs regression is a stream violation [QK:PROBE-LOG-TS-NO-REGRESSION]",
	);
	// Different pids are independent: cross-process stamps are not comparable this
	// way, and demanding it would flag every normal interleaving.
	assert.equal(
		stream([line(1, 0, 500), line(2, 0, 499)]).sequenceViolations.length,
		0,
		"a LOWER stamp from a DIFFERENT pid is not a regression",
	);

	// WRITER KEY is (runId, pid). The fixture is a fresh child per run and the OS
	// reuses pids, so a later run's fixture can legitimately hold the same pid and
	// restart its counter at 0. Keying on pid alone would call that healthy log
	// corrupt — and cross-run ordering is not something any verdict reads.
	const pidReuse = stream([
		{ ...line(1, 0, 100), runId: "r1" },
		{ ...line(1, 1, 101), runId: "r1" },
		{ ...line(1, 0, 200), runId: "r2" },
		{ ...line(1, 1, 201), runId: "r2" },
	]);
	assert.equal(
		pidReuse.sequenceViolations.length,
		0,
		"a reused pid restarting its counter in a LATER run is not a violation — the writer key is (runId, pid) [QK:PROBE-LOG-WRITER-KEY-PER-RUN]",
	);
	// …but within one run the same pid is still held to the rule.
	assert.equal(
		stream([
			{ ...line(1, 5, 100), runId: "r1" },
			{ ...line(1, 5, 101), runId: "r1" },
		]).sequenceViolations.length,
		1,
		"the same pid inside ONE run is still strictly increasing",
	);

	// Malformed lines never participate: they are not events, so they cannot
	// manufacture a sequence violation on top of their own refusal.
	const withMalformed = stream([line(1, 0, 100), { junk: true }, line(1, 1, 101)]);
	assert.ok(
		withMalformed.malformed.length === 1 && withMalformed.sequenceViolations.length === 0,
		"a malformed line is refused at the line door and does not also break the stream door",
	);
}

// ===========================================================================
// 5) VERDICT TRUTH TABLE — synthetic paired logs through the PURE classifier
// ===========================================================================

let syntheticSeq = 0;
function ev(runId: string, event: string, tsMs: number, payload: Record<string, unknown> = {}): ProbeEvent {
	return {
		seq: syntheticSeq++,
		pid: 1,
		ts: new Date(tsMs).toISOString(),
		tsMs,
		runId,
		event,
		...payload,
	} as ProbeEvent;
}

interface SyntheticRunSpec {
	runId: string;
	probeRunId: string;
	base: number;
	/** newSession latency; wire marker fires at newSessionStart + wireAt. */
	nsLatency?: number;
	wireAt?: number | null; // null → no wire marker at all
	failPhase?: "initialize" | "newSession" | "enforceModel" | "prompt";
	fixtureCall?: boolean;
	fixtureCallAt?: number; // offset from newSessionStart
	providerToolId?: string;
	noSuchToolId?: string;
	nonceEchoed?: boolean;
	/** How the observation window closed. Default: inferred — the marker was seen
	 *  iff a wire marker exists, and the reason follows from that. `"omit"` drops
	 *  the marker entirely, which is a TOPOLOGY violation, not a soft default:
	 *  without it a missing wire marker cannot be told from our own teardown. */
	window?: { reason?: ProbeWindowReason; markerSeen?: boolean } | "omit";
	/** Extra runner-owned lines appended verbatim — used to build duplicate /
	 *  end-without-start topology corruptions. */
	extra?: (runId: string, base: number) => ProbeEvent[];
}

/** Close a synthetic run the way the runner does: the observation window is
 *  stamped BEFORE run_end, on the success and the failure path alike. */
function closeRun(out: ProbeEvent[], spec: SyntheticRunSpec, at: number, failed: boolean): ProbeEvent[] {
	const { runId } = spec;
	if (spec.window !== "omit") {
		// Read markerSeen off what the run ACTUALLY emitted, never off the spec: the
		// classifier now checks the self-reported flag against the log, so a helper
		// that guesses would manufacture incoherent fixtures (a run that failed at
		// initialize never reaches the wire marker, whatever `wireAt` says).
		const emittedWire = out.some((e) => e.event === PROBE_EVENTS.toolsListResponseForwarded);
		const markerSeen = spec.window?.markerSeen ?? emittedWire;
		const reason: ProbeWindowReason =
			spec.window?.reason ?? (failed ? "run-failed" : markerSeen ? "wire-marker" : "deadline");
		out.push(ev(runId, PROBE_EVENTS.observationWindowEnd, at, { reason, markerSeen }));
	}
	out.push(ev(runId, PROBE_EVENTS.runEnd, at + 1, { ok: !failed }));
	if (spec.extra) out.push(...spec.extra(runId, spec.base));
	return out;
}

function syntheticRun(spec: SyntheticRunSpec): ProbeEvent[] {
	const { runId, probeRunId, base } = spec;
	const nsStart = base + 100;
	const nsLatency = spec.nsLatency ?? 300;
	const out: ProbeEvent[] = [ev(runId, PROBE_EVENTS.runStart, base), ev(runId, PROBE_EVENTS.initializeStart, base)];
	if (spec.failPhase === "initialize") {
		out.push(ev(runId, PROBE_EVENTS.initializeEnd, base + 50, { ok: false, error: "init boom" }));
		return closeRun(out, spec, base + 60, true);
	}
	out.push(ev(runId, PROBE_EVENTS.initializeEnd, base + 50, { ok: true }));
	out.push(ev(runId, PROBE_EVENTS.newSessionStart, nsStart));
	if (spec.wireAt !== null)
		out.push(ev(runId, PROBE_EVENTS.toolsListResponseForwarded, nsStart + (spec.wireAt ?? 100)));
	if (spec.failPhase === "newSession") {
		out.push(
			ev(runId, PROBE_EVENTS.newSessionEnd, nsStart + nsLatency, { ok: false, timedOut: true, error: "ns boom" }),
		);
		return closeRun(out, spec, nsStart + nsLatency + 10, true);
	}
	out.push(ev(runId, PROBE_EVENTS.newSessionEnd, nsStart + nsLatency, { ok: true }));
	const smStart = nsStart + nsLatency + 10;
	out.push(ev(runId, PROBE_EVENTS.setModelStart, smStart));
	if (spec.failPhase === "enforceModel") {
		out.push(ev(runId, PROBE_EVENTS.setModelEnd, smStart + 30, { ok: false, error: "sm boom" }));
		return closeRun(out, spec, smStart + 40, true);
	}
	out.push(ev(runId, PROBE_EVENTS.setModelEnd, smStart + 30, { ok: true }));
	const pStart = smStart + 50;
	out.push(ev(runId, PROBE_EVENTS.promptStart, pStart));
	if (spec.providerToolId !== undefined) {
		out.push(
			ev(runId, PROBE_EVENTS.acpToolCallObserved, pStart + 100, { providerToolId: spec.providerToolId, probeRunId }),
		);
	}
	if (spec.fixtureCall) {
		out.push(
			ev(runId, PROBE_EVENTS.fixtureToolsCallReceived, nsStart + (spec.fixtureCallAt ?? 500), {
				tool: "probe_nonce",
				probeRunId,
			}),
		);
	}
	if (spec.noSuchToolId !== undefined) {
		out.push(ev(runId, PROBE_EVENTS.acpNoSuchTool, pStart + 150, { toolId: spec.noSuchToolId }));
	}
	if (spec.failPhase === "prompt") {
		out.push(ev(runId, PROBE_EVENTS.promptEnd, pStart + 200, { ok: false, error: "p boom" }));
		return closeRun(out, spec, pStart + 210, true);
	}
	// REAL writer order: driveProbeTurn stamps prompt_end and returns, THEN the
	// runner stamps prompt_reply. The synthetic corpus had these reversed until
	// the topology rule caught it (GPT review round 2, 2026-07-29).
	out.push(ev(runId, PROBE_EVENTS.promptEnd, pStart + 300, { ok: true }));
	out.push(ev(runId, PROBE_EVENTS.promptReply, pStart + 310, { carriesNonce: spec.nonceEchoed ?? true }));
	return closeRun(out, spec, pStart + 310, false);
}

const PROVIDER_ID_MEASURED = "mcp__probe__probe_nonce";

function passingControl(base = 0): { record: ProbeRunRecord; events: ProbeEvent[] } {
	return {
		record: { runId: "ctl", role: "control", delayMs: 0, probeRunId: "prb-ctl", snapshotInstrumented: false },
		events: syntheticRun({
			runId: "ctl",
			probeRunId: "prb-ctl",
			base,
			wireAt: 50,
			nsLatency: 300,
			fixtureCall: true,
			providerToolId: PROVIDER_ID_MEASURED,
			nonceEchoed: true,
		}),
	};
}

function intervention(
	runId: string,
	delayMs: number,
	base: number,
	spec: Partial<SyntheticRunSpec>,
): { record: ProbeRunRecord; events: ProbeEvent[] } {
	const probeRunId = `prb-${runId}`;
	return {
		record: { runId, role: "intervention", delayMs, probeRunId, snapshotInstrumented: false },
		events: syntheticRun({ runId, probeRunId, base, ...spec }),
	};
}

// --- P0: control failures invalidate the whole experiment -------------------
{
	const ctl = {
		record: {
			runId: "ctl",
			role: "control",
			delayMs: 0,
			probeRunId: "prb-ctl",
			snapshotInstrumented: false,
		} as ProbeRunRecord,
		events: syntheticRun({ runId: "ctl", probeRunId: "prb-ctl", base: 0, failPhase: "initialize" }),
	};
	const d1 = intervention("d1", 2000, 10_000, { wireAt: 2100, nsLatency: 2400, fixtureCall: true });
	const res = classifyProbe([ctl.record, d1.record], [...ctl.events, ...d1.events]);
	assert.equal(res.verdict, "P0", "control initialize failure → P0");
	assert.equal(res.control.p0Reason, "initialize", "P0 carries reason=initialize");
	assert.equal(res.interventions.length, 0, "no intervention is judged under P0");

	const ctl2 = {
		record: {
			runId: "ctl",
			role: "control",
			delayMs: 0,
			probeRunId: "prb-ctl",
			snapshotInstrumented: false,
		} as ProbeRunRecord,
		events: syntheticRun({
			runId: "ctl",
			probeRunId: "prb-ctl",
			base: 0,
			wireAt: 50,
			fixtureCall: false, // visible? unproven — never callable
			providerToolId: undefined,
			nonceEchoed: false,
		}),
	};
	const res2 = classifyProbe([ctl2.record, d1.record], [...ctl2.events, ...d1.events]);
	assert.equal(res2.verdict, "P0", "control without the callability marker → P0 [QK:VERDICT-P0-CONTROL-FAIL]");
	assert.equal(res2.control.p0Reason, "tool-unavailable", "P0 names tool-unavailable");
}

// --- I0: intervention initialize failure is drift, never a D ----------------
{
	const ctl = passingControl();
	const d1 = intervention("d1", 2000, 10_000, { failPhase: "initialize" });
	const res = classifyProbe([ctl.record, d1.record], [...ctl.events, ...d1.events]);
	assert.equal(res.verdict, "I0", "intervention initialize failure → I0, never D [QK:VERDICT-I0-NEVER-D]");
}

// --- D: phase-qualified fail-loud readings ----------------------------------
{
	for (const [phase, expected] of [
		["newSession", "D-newSession"],
		["enforceModel", "D-enforceModel"],
		["prompt", "D-prompt"],
	] as const) {
		const ctl = passingControl();
		const d1 = intervention("d1", 2000, 10_000, { failPhase: phase, wireAt: null });
		const res = classifyProbe([ctl.record, d1.record], [...ctl.events, ...d1.events]);
		assert.equal(res.verdict, expected, `${phase} failure → ${expected}`);
	}
}

// --- B promotion ladder — B is ONLY the marker-grade combination ------------
{
	// (a) no wire marker at all → NOT B: the §11-7 promotion ladder files it as an
	// MCP handshake / fixture / config CANDIDATE and keeps unlisted combinations
	// inconclusive. Reading it as B would let a fixture that never served
	// manufacture a sufficiency verdict (GPT review 2026-07-28).
	const ctl = passingControl();
	const noWire = intervention("d1", 2000, 10_000, { wireAt: null, fixtureCall: false, nonceEchoed: false });
	const resA = classifyProbe([ctl.record, noWire.record], [...ctl.events, ...noWire.events]);
	assert.equal(
		resA.verdict,
		"inconclusive",
		"absence without the wire marker is a handshake/fixture/config candidate, never B [QK:VERDICT-NOWIRE-CANDIDATE]",
	);
	assert.equal(resA.promotable, false, "…and never promotes");

	// (b) wire forwarded + no fixture call + No-such-tool naming the MEASURED id → promotable B.
	const exact = intervention("d1", 2000, 10_000, {
		wireAt: 2600,
		nsLatency: 300,
		fixtureCall: false,
		noSuchToolId: PROVIDER_ID_MEASURED,
		nonceEchoed: false,
	});
	const resB = classifyProbe([ctl.record, exact.record], [...ctl.events, ...exact.events]);
	assert.equal(
		resB.verdict,
		"B",
		"marker-complete absence reads B — the runtime No-such-tool ladder OWNS runtime-error runs; no other channel may stand in for it [QK:VERDICT-RUNTIME-B-LADDER-OWNS]",
	);
	assert.equal(resB.promotable, true, "exact measured-id No-such-tool promotes");

	// (b2) same markers but the turn did NOT run ahead (wire forwarded BEFORE
	// newSession end) → NOT B: the delta-table B is "the delayed run puts the
	// turn ahead of wire-availability AND yields absence" — an exact-id absence
	// with ordering kept is a different, unlisted finding.
	const keptAbsence = intervention("k1", 2000, 250_000, {
		wireAt: 100,
		nsLatency: 2300,
		fixtureCall: false,
		noSuchToolId: PROVIDER_ID_MEASURED,
		nonceEchoed: false,
	});
	const resB2 = classifyProbe([ctl.record, keptAbsence.record], [...ctl.events, ...keptAbsence.events]);
	assert.equal(
		resB2.verdict,
		"inconclusive",
		"exact-id absence WITHOUT running ahead of wire-availability is not delta-B [QK:VERDICT-B-REQUIRES-RANAHEAD]",
	);
	assert.equal(resB2.promotable, false, "…and never promotes");

	// (c) alias/bare-name No-such-tool → model/alias mismatch, NOT absence
	// evidence (§11-7 ladder: the real provider-bound id may have been in schema).
	const alias = intervention("d1", 2000, 10_000, {
		wireAt: 2600,
		nsLatency: 300,
		fixtureCall: false,
		noSuchToolId: "probe_nonce",
		nonceEchoed: false,
	});
	const resC = classifyProbe([ctl.record, alias.record], [...ctl.events, ...alias.events]);
	assert.equal(resC.verdict, "inconclusive", "alias-mismatch absence is not B [QK:VERDICT-B-PROMOTION-RULES]");
	assert.equal(resC.promotable, false, "alias mismatch never promotes");
}

// --- model prose alone never reads as evidence ------------------------------
{
	const ctl = passingControl();
	const prose = intervention("d1", 2000, 10_000, {
		wireAt: 2600,
		nsLatency: 300,
		fixtureCall: false,
		nonceEchoed: false, // model SAID the tool is missing; no marker, no error
	});
	const res = classifyProbe([ctl.record, prose.record], [...ctl.events, ...prose.events]);
	assert.equal(res.verdict, "inconclusive", "prose-only absence stays inconclusive");
	assert.equal(res.promotable, false, "prose never promotes");
}

// --- C: ran ahead of wire-availability, later call succeeded ----------------
{
	const ctl = passingControl();
	const late = intervention("d1", 2000, 10_000, {
		wireAt: 2600, // after newSession end (nsLatency 300) → ran ahead
		nsLatency: 300,
		fixtureCall: true,
		fixtureCallAt: 3000,
		nonceEchoed: true,
	});
	const res = classifyProbe([ctl.record, late.record], [...ctl.events, ...late.events]);
	assert.equal(res.verdict, "C", "ahead-of-wire + late success → C");
}

// --- A: needs TWO distinct delays whose newSession excess tracks D ----------
{
	const ctl = passingControl();
	// ordering kept: wire fires before newSession end; latency ≈ control + D.
	const d1 = intervention("d1", 2000, 10_000, {
		wireAt: 2050,
		nsLatency: 2300,
		fixtureCall: true,
		nonceEchoed: true,
	});
	const d2 = intervention("d2", 8000, 40_000, {
		wireAt: 8050,
		nsLatency: 8300,
		fixtureCall: true,
		nonceEchoed: true,
	});
	const one = classifyProbe([ctl.record, d1.record], [...ctl.events, ...d1.events]);
	assert.equal(one.verdict, "A-withheld", "one nonzero delay → wait verdict WITHHELD [QK:VERDICT-A-NEEDS-TWO-DELAYS]");
	const two = classifyProbe([ctl.record, d1.record, d2.record], [...ctl.events, ...d1.events, ...d2.events]);
	assert.equal(two.verdict, "A", "two tracking delays → A");

	// ordering kept but latency does NOT track D → withheld (contradictory data).
	const flat1 = intervention("f1", 2000, 70_000, { wireAt: 100, nsLatency: 320, fixtureCall: true, nonceEchoed: true });
	const flat2 = intervention("f2", 8000, 90_000, { wireAt: 100, nsLatency: 340, fixtureCall: true, nonceEchoed: true });
	const flat = classifyProbe(
		[ctl.record, flat1.record, flat2.record],
		[...ctl.events, ...flat1.events, ...flat2.events],
	);
	assert.equal(flat.verdict, "A-withheld", "ordering without latency tracking stays withheld");

	// Overshoot: excess grows with D but far EXCEEDS it (10s/16s for 2s/8s). A
	// floor-only check would call this "tracking"; the band must refuse — an
	// overshoot is some other stall, not wait-for-delay evidence.
	const over1 = intervention("o1", 2000, 110_000, {
		wireAt: 9950,
		nsLatency: 10_300,
		fixtureCall: true,
		nonceEchoed: true,
	});
	const over2 = intervention("o2", 8000, 140_000, {
		wireAt: 15_950,
		nsLatency: 16_300,
		fixtureCall: true,
		nonceEchoed: true,
	});
	const over = classifyProbe(
		[ctl.record, over1.record, over2.record],
		[...ctl.events, ...over1.events, ...over2.events],
	);
	assert.equal(
		over.verdict,
		"A-withheld",
		"excess overshooting the [0.8·D, D+slack] band is not tracking — A withheld [QK:VERDICT-A-TRACKING-BAND]",
	);

	// In-band per point but NOT growing with D (4.0s → 6.4s excess for 2s → 8s
	// delays: ΔE=2.4s < 0.6·ΔD=3.6s) → withheld.
	const nog1 = intervention("g1", 2000, 170_000, {
		wireAt: 3950,
		nsLatency: 4_300,
		fixtureCall: true,
		nonceEchoed: true,
	});
	const nog2 = intervention("g2", 8000, 200_000, {
		wireAt: 6650,
		nsLatency: 6_700,
		fixtureCall: true,
		nonceEchoed: true,
	});
	const nog = classifyProbe([ctl.record, nog1.record, nog2.record], [...ctl.events, ...nog1.events, ...nog2.events]);
	assert.equal(nog.verdict, "A-withheld", "in-band but non-growing excess is not tracking — A withheld");
}

// --- same-ms cross-process tie is unordered, never ordering evidence --------
{
	// wire marker stamped in the SAME millisecond as newSession end (different
	// pids): the shared axis cannot order them — reading ordering-kept off the
	// tie would manufacture A-side evidence out of clock resolution.
	const ctl = passingControl();
	const tie = intervention("t1", 2000, 230_000, {
		wireAt: 2300,
		nsLatency: 2300,
		fixtureCall: true,
		nonceEchoed: true,
	});
	const res = classifyProbe([ctl.record, tie.record], [...ctl.events, ...tie.events]);
	assert.equal(
		res.verdict,
		"inconclusive",
		"a same-ms wire/newSession-end tie is unordered — neither kept nor ahead [QK:VERDICT-SAMEMS-AMBIGUOUS]",
	);

	// A tie combined with an exact-id No-such-tool must not read B either —
	// unordered means ranAhead is unestablished, and B requires it.
	const tieAbsence = intervention("t2", 2000, 260_000, {
		wireAt: 2300,
		nsLatency: 2300,
		fixtureCall: false,
		noSuchToolId: PROVIDER_ID_MEASURED,
		nonceEchoed: false,
	});
	const res2 = classifyProbe([ctl.record, tieAbsence.record], [...ctl.events, ...tieAbsence.events]);
	assert.equal(res2.verdict, "inconclusive", "a same-ms tie plus exact-id absence still is not B");
	assert.equal(res2.promotable, false, "…and never promotes");
}

// --- delay outside the §11-7 window can never read as D ---------------------
{
	const ctl = passingControl();
	const wide = intervention("d1", DELAY_WELL_BELOW_MS, 10_000, { failPhase: "newSession", wireAt: null });
	const res = classifyProbe([ctl.record, wide.record], [...ctl.events, ...wide.events]);
	assert.equal(
		res.verdict,
		"inconclusive",
		`delay ≥ ${DELAY_WELL_BELOW_MS}ms is outside the experiment window — not a D`,
	);
}

// ===========================================================================
// 6) OBSERVATION WINDOW + RUNNER TOPOLOGY — what puts a run OUTSIDE the space
// ===========================================================================
{
	const ctl = passingControl();

	// Without the window marker, a missing wire marker cannot be told apart from
	// our own teardown — so the run is not judged at all rather than judged
	// permissively. (Re-parsing any artifact written before the window protocol
	// lands here, which is exactly right: those logs cannot answer the question.)
	const noWindow = intervention("w0", 2000, 10_000, { wireAt: null, fixtureCall: false, window: "omit" });
	const resNoWindow = classifyProbe([ctl.record, noWindow.record], [...ctl.events, ...noWindow.events]);
	// Two independent nets cover this — the exactly-once inventory below AND the
	// explicit windowReason guard in the classifier — so no SINGLE mutation can
	// kill it and it carries no [QK:] token. The inventory itself is qualified.
	assert.ok(
		resNoWindow.verdict === "INVALIDATED" && resNoWindow.interventions[0].invalidReason === "topology",
		"a run with no observation-window marker is INVALIDATED for TOPOLOGY — absence cannot be told from our own teardown",
	);
	// The exactly-once inventory, as a HAND-WRITTEN literal (never read off the
	// module under test): dropping a member would retire a topology rule silently.
	assert.deepEqual(
		[...RUNNER_EXACTLY_ONCE].sort(),
		[PROBE_EVENTS.observationWindowEnd, PROBE_EVENTS.runEnd, PROBE_EVENTS.runStart].sort(),
		"the runner-owned exactly-once marker set is exactly run_start, the window close, and run_end [QK:VERDICT-RUNNER-EXACTLY-ONCE-INVENTORY]",
	);

	// THE regression the first LIVE pair produced: D2's child was torn down while
	// the fixture was still inside its injected delay, so the wire marker could
	// never land — and a wire-marker-less run was filed as an MCP handshake /
	// fixture / config candidate. That is an attribution about the SERVER derived
	// from a fact about OUR teardown.
	const censored = intervention("w1", 8000, 40_000, {
		wireAt: null,
		fixtureCall: false,
		nonceEchoed: false,
		window: { reason: "child-exit", markerSeen: false },
	});
	const resCensored = classifyProbe([ctl.record, censored.record], [...ctl.events, ...censored.events]);
	assert.equal(
		resCensored.interventions[0].invalidReason,
		"observation-window-closed",
		"a window closed by child-exit with the marker unseen is CENSORED, not a handshake/fixture/config candidate [QK:VERDICT-CENSORED-NOT-CANDIDATE]",
	);
	assert.equal(
		resCensored.interventions[0].ordering,
		"censored",
		"…its (a) axis reads censored — a fact about the probe, not an ordering comparison",
	);
	assert.notEqual(
		resCensored.interventions[0].failure,
		"candidate-handshake",
		"…and its (b) axis refuses the attribution the first LIVE pair made",
	);
	assert.equal(resCensored.verdict, "INVALIDATED", "the pair's only intervention being censored invalidates the pair");
	// A fatal status still has to NAME what it discarded — `invalidRuns` is a
	// common field of the status contract, so leaving it empty on the fatal paths
	// would quietly lose the only record of which runs were thrown out and why.
	assert.deepEqual(
		resCensored.status.invalidRuns,
		[{ runId: "w1", reason: "observation-window-closed" }],
		"a fatal status still names the discarded run and its reason [QK:VERDICT-STATUS-NAMES-INVALID-RUNS]",
	);

	// The SAME absence under a window we kept open to its deadline IS a reading:
	// the difference is entirely whether we looked long enough.
	const sufficient = intervention("w2", 8000, 70_000, {
		wireAt: null,
		fixtureCall: false,
		nonceEchoed: false,
		window: { reason: "deadline", markerSeen: false },
	});
	const resSufficient = classifyProbe([ctl.record, sufficient.record], [...ctl.events, ...sufficient.events]);
	assert.equal(
		resSufficient.interventions[0].failure,
		"candidate-handshake",
		"the same absence under a SUFFICIENT window is a handshake/fixture/config candidate (the mutant for this condition is VERDICT-CENSORED-NOT-CANDIDATE — one condition, one kill)",
	);
	assert.equal(resSufficient.verdict, "inconclusive", "…still not promotable, and still not B");

	// Runner-owned markers are ours and exactly-once by construction: a duplicate
	// means the log describing the run is not the run.
	const dupEnd = intervention("w3", 2000, 100_000, {
		fixtureCall: true,
		extra: (runId, base) => [ev(runId, PROBE_EVENTS.runEnd, base + 5_000, { ok: true })],
	});
	const resDup = classifyProbe([ctl.record, dupEnd.record], [...ctl.events, ...dupEnd.events]);
	assert.equal(
		resDup.verdict,
		"INVALIDATED",
		"a duplicated runner-owned marker INVALIDATES the run [QK:VERDICT-RUNNER-TOPOLOGY-EXACTLY-ONCE]",
	);
	assert.match(resDup.interventions[0].evidence, /run_end appears 2 times/, "…and the evidence names the duplicate");

	// An end with no start is the same defect seen from the other side.
	const orphanEnd = intervention("w4", 2000, 130_000, {
		failPhase: "initialize",
		extra: (runId, base) => [ev(runId, PROBE_EVENTS.promptEnd, base + 70, { ok: true })],
	});
	const resOrphan = classifyProbe([ctl.record, orphanEnd.record], [...ctl.events, ...orphanEnd.events]);
	assert.equal(
		resOrphan.verdict,
		"INVALIDATED",
		"a phase end with no start INVALIDATES the run — topology precedes I0",
	);
	assert.match(resOrphan.interventions[0].evidence, /prompt_end without prompt_start/, "…named exactly");

	// Repeatable markers are NOT swept into the exactly-once rule: the model may
	// produce several tool-call frames and the client may re-request tools/list.
	const repeats = intervention("w5", 2000, 160_000, {
		fixtureCall: true,
		nsLatency: 2400,
		wireAt: 2100,
		extra: (runId, base) => [
			ev(runId, PROBE_EVENTS.acpToolCallRaw, base + 900, { kind: "tool_call_update", raw: "{}" }),
			ev(runId, PROBE_EVENTS.acpToolCallRaw, base + 901, { kind: "tool_call_update", raw: "{}" }),
		],
	});
	const resRepeats = classifyProbe([ctl.record, repeats.record], [...ctl.events, ...repeats.events]);
	assert.notEqual(
		resRepeats.verdict,
		"INVALIDATED",
		"repeatable forensic markers repeating is not a topology violation (enforced, not mutant-qualified: widening the exactly-once set fails every run at once, so no isolated mutant exists)",
	);
}

// --- window marker coherence + phase production order -----------------------
{
	const ctl = passingControl();

	// The window marker is SELF-REPORTED. A close claiming the marker was seen,
	// in a run whose log has no wire marker, would walk a censored run straight
	// into the candidate branch — so the flag is checked against the log.
	const lying = intervention("c1", 2000, 10_000, {
		wireAt: null,
		fixtureCall: false,
		nonceEchoed: false,
		window: { reason: "wire-marker", markerSeen: true },
	});
	const resLying = classifyProbe([ctl.record, lying.record], [...ctl.events, ...lying.events]);
	assert.equal(
		resLying.verdict,
		"INVALIDATED",
		"a window close claiming markerSeen=true with no wire marker in the log is INVALIDATED, never a candidate [QK:VERDICT-WINDOW-MARKER-COHERENCE]",
	);
	assert.match(resLying.interventions[0].evidence, /contradicts its own evidence/, "…named as a self-contradiction");

	// The SAME bar applies to the CONTROL. Coherence lives in the run's shared
	// validity list precisely so the baseline cannot claim a wire marker it never
	// logged — a control free to lie about its own window is not a baseline, and
	// every intervention is read as a delta against it.
	const lyingControl = {
		record: {
			runId: "ctl-lie",
			role: "control",
			delayMs: 0,
			probeRunId: "prb-ctl-lie",
			snapshotInstrumented: false,
		} as ProbeRunRecord,
		events: syntheticRun({
			runId: "ctl-lie",
			probeRunId: "prb-ctl-lie",
			base: 500_000,
			wireAt: null, // no wire marker in the log …
			fixtureCall: true,
			providerToolId: PROVIDER_ID_MEASURED,
			nonceEchoed: true,
			window: { reason: "wire-marker", markerSeen: true }, // … but the close claims one
		}),
	};
	const d1ok = intervention("d1ok", 2000, 540_000, { wireAt: 2100, nsLatency: 2400, fixtureCall: true });
	const resLyingCtl = classifyProbe([lyingControl.record, d1ok.record], [...lyingControl.events, ...d1ok.events]);
	assert.ok(
		resLyingCtl.verdict === "INVALIDATED" && resLyingCtl.control.pass === false,
		"a CONTROL whose window close contradicts its own log is INVALIDATED before P0 is even considered — the baseline is held to the same bar [QK:VERDICT-CONTROL-HELD-TO-COHERENCE]",
	);
	assert.equal(resLyingCtl.interventions.length, 0, "…and no intervention is judged against a baseline that lied");

	// The reason must agree with the flag too: `deadline` and `child-exit` both
	// mean the marker did not arrive.
	const wrongReason = intervention("c2", 2000, 40_000, {
		wireAt: 2200,
		fixtureCall: true,
		window: { reason: "deadline", markerSeen: true },
	});
	const resWrong = classifyProbe([ctl.record, wrongReason.record], [...ctl.events, ...wrongReason.events]);
	assert.equal(resWrong.verdict, "INVALIDATED", "reason=deadline with markerSeen=true is an incoherent close");

	// PHASE-TO-PHASE order, not just start<end inside each phase: a log whose
	// phases are transposed has every pair intact and still does not describe the
	// driver's sequence. Both fixtures below are otherwise WELL FORMED — they
	// differ from a healthy run in exactly one way, so the violation they trip is
	// unambiguous and their mutants cannot die on someone else's assertion.
	const transposed: ProbeEvent[] = [
		ev("x1", PROBE_EVENTS.runStart, 300_000),
		ev("x1", PROBE_EVENTS.initializeStart, 300_000),
		ev("x1", PROBE_EVENTS.initializeEnd, 300_050, { ok: true }),
		// prompt BEFORE newSession — each pair is well formed on its own
		ev("x1", PROBE_EVENTS.promptStart, 300_100),
		ev("x1", PROBE_EVENTS.promptEnd, 300_200, { ok: true }),
		ev("x1", PROBE_EVENTS.promptReply, 300_210, { carriesNonce: false }),
		ev("x1", PROBE_EVENTS.newSessionStart, 300_300),
		ev("x1", PROBE_EVENTS.newSessionEnd, 300_400, { ok: true }),
		ev("x1", PROBE_EVENTS.setModelStart, 300_500),
		ev("x1", PROBE_EVENTS.setModelEnd, 300_530, { ok: true }),
		ev("x1", PROBE_EVENTS.observationWindowEnd, 300_600, { reason: "deadline", markerSeen: false }),
		ev("x1", PROBE_EVENTS.runEnd, 300_601, { ok: true }),
	];
	const transposedRec: ProbeRunRecord = {
		runId: "x1",
		role: "intervention",
		delayMs: 2000,
		probeRunId: "prb-x1",
		snapshotInstrumented: false,
	};
	const resTrans = classifyProbe([ctl.record, transposedRec], [...ctl.events, ...transposed]);
	assert.equal(
		resTrans.verdict,
		"INVALIDATED",
		"transposed phases are a topology violation even though every start/end pair is intact [QK:VERDICT-PHASE-SEQUENTIAL]",
	);
	assert.match(
		resTrans.interventions[0].evidence,
		/phases are sequential/,
		"…named as a phase-sequencing violation (all four phases are present, so it is the ORDER that is wrong)",
	);

	// The prefix rule catches the other shape: a phase that ran without the phases
	// before it. A failed run is a PREFIX of the production order, never a hole.
	const hole: ProbeEvent[] = [
		ev("x2", PROBE_EVENTS.runStart, 400_000),
		ev("x2", PROBE_EVENTS.initializeStart, 400_000),
		ev("x2", PROBE_EVENTS.initializeEnd, 400_050, { ok: true }),
		// newSession skipped entirely — enforceModel and prompt still ran
		ev("x2", PROBE_EVENTS.setModelStart, 400_100),
		ev("x2", PROBE_EVENTS.setModelEnd, 400_130, { ok: true }),
		ev("x2", PROBE_EVENTS.promptStart, 400_200),
		ev("x2", PROBE_EVENTS.promptEnd, 400_300, { ok: true }),
		ev("x2", PROBE_EVENTS.promptReply, 400_310, { carriesNonce: false }),
		ev("x2", PROBE_EVENTS.observationWindowEnd, 400_400, { reason: "deadline", markerSeen: false }),
		ev("x2", PROBE_EVENTS.runEnd, 400_401, { ok: true }),
	];
	const holeRec: ProbeRunRecord = {
		runId: "x2",
		role: "intervention",
		delayMs: 2000,
		probeRunId: "prb-x2",
		snapshotInstrumented: false,
	};
	const resHole = classifyProbe([ctl.record, holeRec], [...ctl.events, ...hole]);
	assert.equal(
		resHole.verdict,
		"INVALIDATED",
		"a skipped phase is a topology violation — a failed run is a PREFIX of the production order, never a hole [QK:VERDICT-PHASE-PRODUCTION-ORDER]",
	);
	assert.match(resHole.interventions[0].evidence, /prefix of the production order/, "…named as a prefix violation");
}

// ===========================================================================
// 7) TWO AXES — an ordering observation is not hidden by a missing (b) marker
// ===========================================================================
{
	const ctl = passingControl();

	// The D1 shape, exactly as measured 2026-07-28: the turn is opened BEFORE the
	// tools reach the wire, the wire marker lands mid-turn, and the model never
	// attempts the call. (b) has no marker — model silence is not evidence — but
	// (a) is settled: this server did NOT wait. Reporting one verdict let the
	// missing (b) marker bury the (a) fact.
	const d1 = intervention("a1", 2000, 10_000, {
		nsLatency: 2000,
		wireAt: 2200, // promptStart is nsStart+2060, promptEnd nsStart+2360
		fixtureCall: false,
		nonceEchoed: false,
	});
	const res = classifyProbe([ctl.record, d1.record], [...ctl.events, ...d1.events]);
	const r = res.interventions[0];
	assert.equal(r.deltas.promptRanAhead, true, "promptStart precedes the wire marker");
	assert.equal(
		r.ordering,
		"prompt-request-ahead-of-wire",
		"(a) is a settled COMPARISON: we issued the prompt request before the wire marker landed — named for the comparison, never for a server-wait conclusion",
	);
	assert.equal(r.failure, "inconclusive", "(b) has no marker — model silence never promotes");
	assert.equal(res.verdict, "inconclusive", "the composite verdict stays inconclusive because (b) is unsettled");
	assert.equal(
		res.ordering.summary,
		"prompt-request-ahead-of-wire",
		"…and the (a) axis is reported on its OWN terms rather than being folded into that verdict [QK:VERDICT-ORDERING-AXIS-REPORTED]",
	);
	// Diagnosability: §11-7-b's first artifact classified D1 correctly and still
	// left a reader unable to SEE the ran-ahead or the turn time left after it.
	assert.match(r.evidence, /promptStart \d+ms BEFORE wire/, "the evidence exposes the prompt↔wire delta");
	assert.match(
		r.evidence,
		/\d+ms of turn remained after wire/,
		"the evidence exposes how much turn was left after the wire marker [QK:VERDICT-EVIDENCE-EXPOSES-DELTAS]",
	);

	// The axis split is load-bearing for B/C, not cosmetic. Here the wire lands
	// AFTER newSession end but BEFORE the prompt is issued: the newSession axis
	// says "ran ahead", the causal window says the turn was opened against a wire
	// that was already available. Only the second one may decide B.
	const between = intervention("a2", 2000, 40_000, {
		nsLatency: 2000,
		wireAt: 2030, // newSessionEnd + 30, promptStart is +60
		fixtureCall: false,
		noSuchToolId: PROVIDER_ID_MEASURED,
		nonceEchoed: false,
	});
	const resBetween = classifyProbe([ctl.record, between.record], [...ctl.events, ...between.events]);
	const rb = resBetween.interventions[0];
	assert.equal(rb.deltas.newSessionRanAhead, true, "the newSession axis alone would call this ran-ahead");
	assert.equal(rb.deltas.promptRanAhead, false, "…but the turn was opened AFTER the wire was available");
	assert.equal(
		resBetween.verdict,
		"inconclusive",
		"exact-id absence with the wire available before the prompt is NOT delta-B — B's window is promptStart, not newSession end [QK:VERDICT-B-WINDOW-IS-PROMPT]",
	);
	assert.equal(
		rb.ordering,
		"wire-before-prompt-request",
		"…and (a) records the comparison: the wire marker landed before we issued the prompt request",
	);

	// A keeps its own axis: `wire < newSessionEnd` plus latency scaling. Replacing
	// the single ran-ahead flag with the prompt axis would have silently broken it.
	const k1 = intervention("k1", 2000, 70_000, { wireAt: 100, nsLatency: 2200, fixtureCall: true });
	const k2 = intervention("k2", 8000, 100_000, { wireAt: 100, nsLatency: 8200, fixtureCall: true });
	const resA = classifyProbe([ctl.record, k1.record, k2.record], [...ctl.events, ...k1.events, ...k2.events]);
	assert.equal(resA.verdict, "A", "A still reads off the newSession axis with latency tracking");
	assert.equal(
		resA.ordering.summary,
		"wire-before-newSession-end",
		"…and the (a) summary is named for the comparison, deliberately NOT 'wait' — the wait verdict needs the scaling A adds",
	);
}

// ===========================================================================
// 8) §11-7-c B-name-snapshot seam — CONSUMER side (preconditions, doors,
//    verdict ladder). The PRODUCER (the CLI shim) is gated by
//    check-probe-cli-shim; these prove the contract it must satisfy, and 8d
//    pins the runner's arming — the order of the ambient refusal against the
//    deliberate injection, what is injected, and the instrument's runtime graph.
// ===========================================================================

// --- 8a) CLI-target precondition seam: refusals are NAMED, never fallbacks --
{
	const fakeBin = join(tmp, "fake-claude");
	writeFileSync(fakeBin, "#!/bin/sh\nexit 0\n");
	chmodSync(fakeBin, 0o755);
	const fakeScript = join(tmp, "fake-claude.mjs");
	writeFileSync(fakeScript, "process.exit(0);\n");
	chmodSync(fakeScript, 0o755);
	const fakeDir = join(tmp, "fake-claude-dir");
	mkdirSync(fakeDir, { recursive: true });
	const fakeNonExec = join(tmp, "fake-claude-noexec");
	writeFileSync(fakeNonExec, "#!/bin/sh\nexit 0\n");
	chmodSync(fakeNonExec, 0o644);

	const reasonOf = async (env: Record<string, string | undefined>, target: string): Promise<string> => {
		try {
			await resolveProbeCliTarget({ env, resolveNative: async () => target });
			return "resolved";
		} catch (err) {
			return err instanceof ProbeCliPreconditionError ? err.reason : "unexpected-error";
		}
	};

	assert.equal(
		await reasonOf({ [AMBIENT_OVERRIDE_ENV]: "/somewhere/claude" }, fakeBin),
		"ambient-override-present",
		"an ambient CLAUDE_CODE_EXECUTABLE is REFUSED before resolution — claudeCliPath() would return it verbatim [QK:PROBE-TARGET-AMBIENT-REFUSED]",
	);
	// KEY PRESENCE is the predicate: upstream's `??` treats "" as set and passes
	// it on while a truthy check treats it as unset — the probe refuses the
	// ambiguity instead of picking a side (GPT review 2026-07-29).
	assert.equal(
		await reasonOf({ [AMBIENT_OVERRIDE_ENV]: "" }, fakeBin),
		"ambient-override-present",
		"an EMPTY-string override is still a present key — refused, not treated as unset",
	);
	assert.equal(
		await reasonOf({}, "relative/claude"),
		"target-not-absolute",
		"a non-absolute resolved target is refused — it would resolve against the session cwd at spawn time",
	);
	assert.equal(
		await reasonOf({}, fakeScript),
		"target-script-suffix",
		"a script-suffixed target is refused — the SDK would take the node|bun branch, which this seam asserts against instead of reproducing [QK:PROBE-TARGET-NATIVE-BRANCH-ONLY]",
	);
	assert.equal(
		await reasonOf({}, join(tmp, "no-such-claude")),
		"target-missing",
		"a missing target is refused before a LIVE turn spends money on a spawn error",
	);
	assert.equal(
		await reasonOf({}, fakeDir),
		"target-not-regular-file",
		"a directory target is refused — existsSync alone would have taken it happy (GPT review 2026-07-29)",
	);
	assert.equal(
		await reasonOf({}, fakeNonExec),
		"target-not-executable",
		"a non-executable regular file is refused (X_OK) — it would fail only after the pair started spending",
	);
	const resolved = await resolveProbeCliTarget({ env: {}, resolveNative: async () => fakeBin });
	assert.ok(
		resolved.path === fakeBin && resolved.sha256 === hashFileSha256(fakeBin) && /^[0-9a-f]{64}$/.test(resolved.sha256),
		"an absolute, extensionless, executable regular file resolves with its content hash",
	);
}

// --- 8b) upstream override semantics — inspector validated on synthetic
//     fixtures, THEN applied to the installed dists. node_modules can never be
//     a mutant subject (§11-7-c), so kill-power here is the synthetic
//     negatives, not a manifest entry.
{
	const inspect = (acpSrc: string, sdkSrc: string): string[] => {
		const violations: string[] = [];
		if (!acpSrc.includes("export async function claudeCliPath()")) {
			violations.push("claudeCliPath export missing from acp-agent.js");
		}
		if (!/if \(process\.env\.CLAUDE_CODE_EXECUTABLE\) \{\s*return process\.env\.CLAUDE_CODE_EXECUTABLE;/.test(acpSrc)) {
			violations.push(
				"claudeCliPath no longer returns the ambient override VERBATIM — the refusal precondition's premise moved",
			);
		}
		const overrideLine = "pathToClaudeCodeExecutable: process.env.CLAUDE_CODE_EXECUTABLE ?? (await claudeCliPath())";
		const iOverride = acpSrc.indexOf(overrideLine);
		if (iOverride === -1) {
			violations.push("the env-??-claudeCliPath resolution at the query options literal is gone");
		} else {
			const iSpread = acpSrc.indexOf("...userProvidedOptions,");
			if (iSpread === -1 || iSpread > iOverride) {
				violations.push(
					"the explicit pathToClaudeCodeExecutable key no longer follows ...userProvidedOptions — the key-order assumption (override wins) is broken",
				);
			}
		}
		if (!sdkSrc.includes(JSON.stringify(SDK_SCRIPT_SUFFIXES))) {
			violations.push(
				`the SDK's script-suffix discriminator no longer equals ${JSON.stringify(SDK_SCRIPT_SUFFIXES)} — the native-branch assert would drift from upstream`,
			);
		}
		if (!sdkSrc.includes('?"bun":"node"')) {
			violations.push("the SDK's node|bun default-executable choice moved — the script branch premise changed");
		}
		// The no-shell proof is LOCALIZED to the spawn leaf: asserting only that
		// one spelling of `shell:!0` is absent SOMEWHERE in a megabyte of minified
		// source proves nothing — `shell:true`, a variable shell, or the leaf
		// moving entirely would all pass (GPT review 2026-07-29). Pin the
		// spawnLocalProcess definition window and judge the spawn options THERE.
		const iLeaf = sdkSrc.indexOf("spawnLocalProcess(");
		if (iLeaf === -1) {
			violations.push("the SDK's spawnLocalProcess leaf is gone — the spawn-shape premise has no anchor");
		} else {
			const leaf = sdkSrc.slice(iLeaf, iLeaf + 800);
			if (!leaf.includes('stdio:["pipe","pipe","pipe"]') || !leaf.includes("windowsHide:!0")) {
				violations.push("the spawn leaf no longer shows piped stdio + windowsHide — spawn semantics premise changed");
			}
			if (/\bshell\s*:/.test(leaf)) {
				violations.push("the spawn leaf carries a `shell:` option — the no-shell premise is broken");
			}
		}
		return violations;
	};

	// Synthetic fixtures FIRST — an inspector that cannot see the defect it
	// exists for is no inspector.
	const goodAcp =
		"export async function claudeCliPath() {\n" +
		"    if (process.env.CLAUDE_CODE_EXECUTABLE) {\n        return process.env.CLAUDE_CODE_EXECUTABLE;\n    }\n}\n" +
		"const options = {\n            ...userProvidedOptions,\n" +
		"            pathToClaudeCodeExecutable: process.env.CLAUDE_CODE_EXECUTABLE ?? (await claudeCliPath()),\n};\n";
	const goodSdk = `x=![".js",".mjs",".tsx",".ts",".jsx"].some((r)=>e.endsWith(r));y=Cs()?"bun":"node";spawnLocalProcess(e){let{command:t,args:r,cwd:n,env:o,signal:i}=e,s=cxe(t,r,{cwd:n,stdio:["pipe","pipe","pipe"],signal:i,env:o,windowsHide:!0})}`;
	assert.deepEqual(inspect(goodAcp, goodSdk), [], "inspector passes the correct synthetic fixture");
	const invertedAcp = goodAcp.replace(
		"            ...userProvidedOptions,\n            pathToClaudeCodeExecutable: process.env.CLAUDE_CODE_EXECUTABLE ?? (await claudeCliPath()),\n",
		"            pathToClaudeCodeExecutable: process.env.CLAUDE_CODE_EXECUTABLE ?? (await claudeCliPath()),\n            ...userProvidedOptions,\n",
	);
	assert.ok(
		inspect(invertedAcp, goodSdk).some((v) => v.includes("key-order")),
		"inspector catches userProvidedOptions inverted to win over the explicit override key",
	);
	assert.ok(
		inspect(goodAcp.replace("export async function claudeCliPath()", "async function claudeCliPath()"), goodSdk).some(
			(v) => v.includes("export missing"),
		),
		"inspector catches the claudeCliPath export disappearing",
	);
	assert.ok(
		inspect(goodAcp, goodSdk.replace('".mjs",', "")).some((v) => v.includes("discriminator")),
		"inspector catches the SDK suffix list drifting from the pinned SDK_SCRIPT_SUFFIXES",
	);
	// The no-shell negatives must be caught IN THE LEAF WINDOW, in both the
	// minified and the plain spelling — the global one-spelling absence check
	// this replaced passed them all.
	assert.ok(
		inspect(goodAcp, goodSdk.replace("windowsHide:!0", "windowsHide:!0,shell:!0")).some((v) =>
			v.includes("no-shell"),
		) &&
			inspect(goodAcp, goodSdk.replace("windowsHide:!0", "windowsHide:!0,shell:true")).some((v) =>
				v.includes("no-shell"),
			) &&
			inspect(goodAcp, goodSdk.replace("spawnLocalProcess(", "spawnElsewhere(")).some((v) => v.includes("anchor")),
		"inspector catches shell:!0 AND shell:true inside the spawn leaf, and the leaf disappearing entirely",
	);

	// Installed dists — the actual §11-7-c load-bearing assumptions.
	const rootRequire = createRequire(resolve(REPO_ROOT, "package.json"));
	const acpPkgJson = rootRequire.resolve("@agentclientprotocol/claude-agent-acp/package.json");
	const acpDist = readFileSync(join(dirname(acpPkgJson), "dist", "acp-agent.js"), "utf8");
	const acpRequire = createRequire(acpPkgJson);
	const sdkEntry = acpRequire.resolve("@anthropic-ai/claude-agent-sdk");
	let sdkDist = readFileSync(sdkEntry, "utf8");
	if (!sdkDist.includes(JSON.stringify(SDK_SCRIPT_SUFFIXES))) {
		const sibling = join(dirname(sdkEntry), "sdk.mjs");
		if (existsSync(sibling)) sdkDist = readFileSync(sibling, "utf8");
	}
	assert.deepEqual(
		inspect(acpDist, sdkDist),
		[],
		"installed acp-agent.js + sdk.mjs still carry every §11-7-c launch-semantics assumption (claudeCliPath verbatim env, override key order, suffix discriminator, node|bun choice, piped no-shell spawn)",
	);
}

// --- 8c) the scrub list is an EXACT allowlist, never a prefix pattern -------
{
	assert.ok(
		SHIM_SCRUB_ENV_VARS.includes(AMBIENT_OVERRIDE_ENV) &&
			Object.values(PROBE_SHIM_ENV).every((v) => SHIM_SCRUB_ENV_VARS.includes(v)) &&
			SHIM_SCRUB_ENV_VARS.length === 1 + Object.values(PROBE_SHIM_ENV).length &&
			SHIM_SCRUB_ENV_VARS.every((v) => /^[A-Z][A-Z0-9_]*$/.test(v)),
		"the shim scrub list is the exact enumerated allowlist — the override plus every probe-private var by literal name, no wildcard/prefix semantics [QK:PROBE-SCRUB-EXACT-ALLOWLIST]",
	);
	// The shim env names must not collide with the fixture's — two processes,
	// two channels, one shared log.
	const fixtureVals = Object.values(PROBE_ENV) as string[];
	assert.ok(
		Object.values(PROBE_SHIM_ENV).every((v) => !fixtureVals.includes(v)),
		"shim env names are disjoint from the fixture's PROBE_ENV names",
	);
}

// --- 8d) runner pins — one assert per claim, so each [QK:] names exactly what
//     its mutant kills (bundling four claims under one token let one mutant
//     stand in for all of them; GPT review 2026-07-29) ----------------------
{
	assert.ok(
		RUNNER_SRC.includes("assertNoAmbientOverride(spawnEnv, `composed acp child env for ${runId}`);"),
		"the COMPOSED spawn env of every ACP child is asserted override-free — launch defaults / overlay overrides could inject what process.env did not carry [QK:RUNNER-TARGET-PRECONDITION-PINNED]",
	);
	assert.ok(
		RUNNER_SRC.includes("snapshotInstrumented: true") && !RUNNER_SRC.includes("snapshotInstrumented: false"),
		"the snapshot channel is ARMED and no run is left declaring otherwise — a roster mixing armed and unarmed runs " +
			"would let a run whose shim never reported in pass as an ordinary absence [QK:RUNNER-SNAPSHOT-CHANNEL-ARMED]",
	);
	// Pinned as the CONTIGUOUS roster-record shape: the same two stamps also ride
	// the run_start payload (forensics), so field-by-field includes() would stay
	// green with the roster copy deleted.
	assert.ok(
		RUNNER_SRC.includes(
			"snapshotInstrumented: true,\n\t\tcliTargetPath: CLI_TARGET.path,\n\t\tcliTargetSha256: CLI_TARGET.sha256,",
		),
		"the pair's expected CLI target identity rides EVERY roster record so the classifier can consume it (condition 5) [QK:RUNNER-TARGET-IDENTITY-IN-ROSTER]",
	);
	assert.ok(
		RUNNER_SRC.includes("rehash = hashFileSha256(CLI_TARGET.path);") &&
			RUNNER_SRC.includes('reason: "cli-target-drift"') &&
			RUNNER_SRC.includes('reason: "cli-target-unreadable"'),
		"the target is RE-HASHED after the pair, and both drift and unreadability write a named INVALIDATED classification [QK:RUNNER-DRIFT-REHASH-PINNED]",
	);
	assert.ok(
		RUNNER_SRC.includes("CLI_TARGET = await resolveProbeCliTarget({") &&
			RUNNER_SRC.includes('"@agentclientprotocol/claude-agent-acp/dist/acp-agent.js"') &&
			RUNNER_SRC.includes("`precondition-${err.reason}`"),
		"the runner resolves the target through upstream claudeCliPath BEFORE any run, and a precondition refusal writes a NAMED classification on the artifact (not stderr alone)",
	);
	// --- arming (§11-7-c CP3). The producer exists, so the channel is armed — and
	//     arming is the point where two things can go quietly wrong: the order of
	//     the checkpoint against the injection, and WHAT gets injected.
	assert.ok(
		RUNNER_SRC.includes(
			"assertNoAmbientOverride(spawnEnv, `composed acp child env for ${runId}`);\n" + "\t\t// ORDER IS THE CONTRACT",
		) &&
			RUNNER_SRC.indexOf("assertNoAmbientOverride(spawnEnv") <
				RUNNER_SRC.indexOf("spawnEnv[AMBIENT_OVERRIDE_ENV] = SHIM_TARGET.path;"),
		"the ambient-override refusal runs against the env as PRODUCTION composed it, and the probe installs its own " +
			"override only AFTER. Inverted, the checkpoint would inspect the override the probe itself just injected and " +
			"REFUSE every run — loudly, but for the wrong reason, and the operator's ambient environment would never be " +
			"examined at all [QK:RUNNER-ARMING-ORDER]",
	);
	assert.ok(
		RUNNER_SRC.includes(
			"spawnEnv[AMBIENT_OVERRIDE_ENV] = SHIM_TARGET.path;\n" +
				"\t\tspawnEnv[PROBE_SHIM_ENV.target] = CLI_TARGET.path;\n" +
				"\t\tspawnEnv[PROBE_SHIM_ENV.eventLog] = logPath;\n" +
				"\t\tspawnEnv[PROBE_SHIM_ENV.runId] = runId;",
		),
		"the injection is exactly four names: the override pointing at the SHIM, and the three probe-private vars the " +
			"shim reads — the target it must exec (resolved HERE, never by the shim), the shared log, and this run's id. " +
			"All four are on the shim's scrub list, so none of them reach the real CLI [QK:RUNNER-SHIM-OVERRIDE-EXACT]",
	);
	assert.ok(
		RUNNER_SRC.includes(
			"SHIM_TARGET = await resolveProbeCliTarget({ env: {}, resolveNative: async () => PROBE_SHIM });",
		) && RUNNER_SRC.includes("`precondition-shim-${err.reason}`"),
		"the instrument passes the SAME precondition asserts as the stimulus — absolute, native branch, present regular " +
			"file, executable — and a refusal is a NAMED classification on the artifact. A shim that fails any of those " +
			"either never runs or runs on the OTHER launch branch, and the pair would measure something else " +
			"[QK:RUNNER-SHIM-PRECONDITION-PINNED]",
	);
	// The path the runner points at is checked on DISK too, not just in source: a
	// pin proves the runner asks for the right file, not that the file can run.
	{
		// --- the instrument is a GRAPH. The launcher is a two-line delegate, so
		//     "control and interventions shared one shim" is a claim about every local
		//     module a fresh Node process reads — and the boot marker cannot see any of
		//     it, because it reports the CLI target rather than the instrument.
		assert.ok(
			RUNNER_SRC.includes("SHIM_RUNTIME = hashShimRuntime();") &&
				RUNNER_SRC.includes("shimRehash = hashShimRuntime();") &&
				RUNNER_SRC.includes('reason: "shim-runtime-drift"') &&
				RUNNER_SRC.includes('reason: "shim-runtime-unreadable"') &&
				RUNNER_SRC.includes("JSON.stringify(shimRehash) !== JSON.stringify(SHIM_RUNTIME)"),
			"the instrument's runtime graph is pinned before the first run and RE-HASHED after the last, on its own axis " +
				"with its own two names — an edit to the implementation landing between control and intervention is " +
				"invisible to every other check, including the shim's own boot marker [QK:RUNNER-SHIM-RUNTIME-PINNED]",
		);
		{
			// The runner's list must equal the STATIC LOCAL IMPORT CLOSURE of the
			// launcher — derived here, never restated, or the list becomes a second
			// unverified copy that drifts the moment the implementation grows a helper.
			// node: builtins and package specifiers are out of scope (they are not
			// tracked files of ours); a DYNAMIC import inside the closure is refused
			// outright, because a graph that assembles itself at runtime cannot be
			// pinned at all.
			const localImportsOf = (file: string): string[] => {
				const src = readFileSync(file, "utf8");
				assert.ok(
					!/\bimport\s*\(/.test(src),
					`${file} carries a DYNAMIC import — the shim runtime graph would no longer be statically knowable, so it ` +
						"could not be pinned across a pair",
				);
				return [...src.matchAll(/^\s*import\s[^;]*?from\s+"(\.[^"]+)"|^\s*import\s+"(\.[^"]+)"/gm)]
					.map((m) => m[1] ?? m[2])
					.map((spec) => resolve(dirname(file), spec));
			};
			const launcher = join(REPO_ROOT, "scripts", "fixtures", "probe-cli-shim");
			const closure: string[] = [];
			const walk = (file: string): void => {
				if (closure.includes(file)) return;
				closure.push(file);
				for (const next of localImportsOf(file)) walk(next);
			};
			walk(launcher);
			const declared = [
				...RUNNER_SRC.matchAll(/^\t(?:PROBE_SHIM,|join\(REPO_ROOT, "scripts", "lib", "([^"]+)"\),)$/gm),
			].map((m) => (m[1] === undefined ? launcher : join(REPO_ROOT, "scripts", "lib", m[1])));
			assert.deepEqual(
				[...declared].sort(),
				[...closure].sort(),
				"the runner's pinned instrument list is EXACTLY the launcher's static local-import closure — a helper added " +
					"to the shim without being pinned would otherwise be free to change mid-pair, and a stale entry would " +
					"pin a file the instrument no longer reads [QK:RUNNER-SHIM-RUNTIME-GRAPH-EXACT]",
			);
		}
		// The path is read OUT OF THE RUNNER rather than restated here, so this
		// checks the file the runner actually arms. Restating it would pass happily
		// while the runner pointed somewhere else.
		const declared = /const PROBE_SHIM = join\(REPO_ROOT, "scripts", "fixtures", "([^"]+)"\);/.exec(RUNNER_SRC);
		const shimPath = declared ? join(REPO_ROOT, "scripts", "fixtures", declared[1]) : "";
		assert.ok(
			declared !== null &&
				existsSync(shimPath) &&
				statSync(shimPath).isFile() &&
				(statSync(shimPath).mode & 0o111) !== 0 &&
				SDK_SCRIPT_SUFFIXES.every((suffix) => !shimPath.endsWith(suffix)),
			"the shim the runner arms is present, executable and extensionless ON DISK — the pair is asserted onto the " +
				"direct-spawn branch, and a script suffix (or a path pointing at nothing) would silently move the " +
				"instrument to `node|bun <path>` or break the spawn outright [QK:RUNNER-SHIM-ON-DISK-NATIVE]",
		);
	}
}

// --- 8e) shim events at the log door: judged payload is typed there ---------
{
	const stampAt = (seq: number, tsMs: number) => ({ seq, pid: 9, ts: new Date(tsMs).toISOString(), tsMs, runId: "sh" });
	const doorPath = join(tmp, "payload-shim.ndjson");
	const lines = [
		{ ...stampAt(0, 3_000), event: PROBE_EVENTS.shimBoot, targetPath: "/x/claude" }, // sha missing
		{ ...stampAt(1, 3_001), event: PROBE_EVENTS.shimPromptForwarded, ordinal: 0 }, // ordinal < 1
		{ ...stampAt(2, 3_002), event: PROBE_EVENTS.shimInitSnapshot, tools: "nope", receivedAtMs: 1 },
		// interval inverted — receivedAtMs AFTER the event's own envelope stamp
		// (the downstream-write-callback moment, the interval's single-SSOT end)
		// would silently un-order the §11-7-c "after the wire" read → refused.
		{ ...stampAt(3, 3_003), event: PROBE_EVENTS.shimInitSnapshot, tools: ["a"], receivedAtMs: 3_500 },
		{ ...stampAt(4, 3_004), event: PROBE_EVENTS.shimBoot, targetPath: "/x/claude", targetSha256: "ab12" },
		{ ...stampAt(5, 3_005), event: PROBE_EVENTS.shimPromptForwarded, ordinal: 1 },
		{ ...stampAt(6, 3_006), event: PROBE_EVENTS.shimInitSnapshot, tools: ["a", "b"], receivedAtMs: 3_002 },
	];
	for (const l of lines) appendFileSync(doorPath, `${JSON.stringify(l)}\n`, "utf8");
	const door = readProbeEvents(doorPath);
	assert.ok(
		door.malformed.length === 4 && door.events.length === 3,
		"shim payload rules hold at the door: missing target hash, ordinal<1, non-array tools, and receivedAtMs AFTER the envelope stamp are MALFORMED; the well-formed trio passes [QK:PROBE-LOG-SNAPSHOT-PAYLOAD]",
	);
}

// --- 8f) the B-name-snapshot verdict ladder over synthetic paired logs ------
{
	let shimSeq = 5_000;
	const shimEv = (runId: string, event: string, tsMs: number, payload: Record<string, unknown>): ProbeEvent =>
		({ seq: shimSeq++, pid: 9, ts: new Date(tsMs).toISOString(), tsMs, runId, event, ...payload }) as ProbeEvent;

	const EXPECTED_TARGET = { path: "/x/claude", sha256: "ab" } as const;

	/** Shim channel for one run: boot → prompt frame → snapshot(s). The interval
	 *  END is the snapshot event's own envelope tsMs (`at`), the moment the shim
	 *  appends inside the downstream write callback; payload carries only
	 *  `receivedAtMs`. */
	const shimChannel = (
		runId: string,
		base: number,
		snapshots: Array<{ receivedAtMs: number; at: number; tools: string[] }>,
		opts: { boot?: boolean; promptForwardedAt?: number; bootTargetSha256?: string } = {},
	): ProbeEvent[] => {
		const out: ProbeEvent[] = [];
		if (opts.boot !== false) {
			out.push(
				shimEv(runId, PROBE_EVENTS.shimBoot, base + 150, {
					targetPath: EXPECTED_TARGET.path,
					targetSha256: opts.bootTargetSha256 ?? EXPECTED_TARGET.sha256,
				}),
			);
		}
		out.push(shimEv(runId, PROBE_EVENTS.shimPromptForwarded, opts.promptForwardedAt ?? base + 1_700, { ordinal: 1 }));
		for (const s of snapshots) {
			out.push(shimEv(runId, PROBE_EVENTS.shimInitSnapshot, s.at, { tools: s.tools, receivedAtMs: s.receivedAtMs }));
		}
		return out;
	};

	// An armed roster record also CARRIES the expected target identity — the
	// classifier consumes it (condition 5), fail-closed when absent.
	const armed = (r: { record: ProbeRunRecord; events: ProbeEvent[] }, shim: ProbeEvent[]) => ({
		record: {
			...r.record,
			snapshotInstrumented: true,
			cliTargetPath: EXPECTED_TARGET.path,
			cliTargetSha256: EXPECTED_TARGET.sha256,
		},
		events: [...r.events, ...shim],
	});

	// A calibrated, armed control: channel clean and the snapshot CONTAINS the
	// measured id (fixture call + nonce echo already hold in passingControl).
	const armedControl = (base = 0) =>
		armed(
			passingControl(base),
			shimChannel("ctl", base, [{ receivedAtMs: base + 600, at: base + 605, tools: [PROVIDER_ID_MEASURED, "other"] }], {
				promptForwardedAt: base + 500,
			}),
		);

	// Intervention timing shape (base b): nsLatency 1500 → promptStart = b+1660;
	// wireAt 2000 → wire = b+2100 > promptStart (promptRanAhead).
	const ranAheadSpec = { wireAt: 2_000, nsLatency: 1_500, fixtureCall: false } as const;

	// (1) full floor → B-name-snapshot, promotable.
	{
		const ctl = armedControl();
		const i1 = armed(
			intervention("d1", 2_000, 10_000, { ...ranAheadSpec }),
			shimChannel("d1", 10_000, [{ receivedAtMs: 12_190, at: 12_195, tools: ["unrelated_tool"] }]),
		);
		const res = classifyProbe([ctl.record, i1.record], [...ctl.events, ...i1.events]);
		assert.equal(
			res.verdict,
			"B-name-snapshot",
			"snapshot absence of the measured id + promptRanAhead + wire strictly before the interval + calibrated control → B-name-snapshot [QK:VERDICT-SNAPSHOT-PROMOTES]",
		);
		assert.ok(res.promotable && res.status.failureVerdict === "B-name-snapshot", "…and it is promotable on axis (b)");
		assert.notEqual(
			res.interventions[0].failure,
			"B",
			"…and it NEVER upgrades into runtime B — the report is not the failure",
		);
	}

	// (2) armed control with NO shim events at all → named instrument absence.
	{
		const ctl = armed(passingControl(20_000), []);
		const i1 = armed(
			intervention("d1", 2_000, 30_000, { ...ranAheadSpec }),
			shimChannel("d1", 30_000, [{ receivedAtMs: 32_190, at: 32_195, tools: ["unrelated_tool"] }]),
		);
		const res = classifyProbe([ctl.record, i1.record], [...ctl.events, ...i1.events]);
		assert.equal(res.verdict, "P0", "an armed control whose shim never reported in cannot calibrate — P0");
		assert.equal(
			res.control.p0Reason,
			"snapshot-instrument-absent",
			"…and the reason NAMES the missing instrument (a hijacked/replaced override looks exactly like this) [QK:VERDICT-SNAPSHOT-INSTRUMENT-ABSENT]",
		);
	}

	// (3) armed control, channel clean, but the snapshot LACKS the measured id.
	{
		const ctl = armed(
			passingControl(40_000),
			shimChannel("ctl", 40_000, [{ receivedAtMs: 40_600, at: 40_605, tools: ["only_this"] }], {
				promptForwardedAt: 40_500,
			}),
		);
		const i1 = armed(
			intervention("d1", 2_000, 50_000, { ...ranAheadSpec }),
			shimChannel("d1", 50_000, [{ receivedAtMs: 52_190, at: 52_195, tools: ["unrelated_tool"] }]),
		);
		const res = classifyProbe([ctl.record, i1.record], [...ctl.events, ...i1.events]);
		assert.ok(
			res.verdict === "P0" && res.control.p0Reason === "snapshot-calibration",
			"a control snapshot that cannot SEE the measured id fails calibration — absence readings need a baseline that shows presence [QK:VERDICT-SNAPSHOT-CALIBRATION]",
		);
	}

	// (4) absence + wire before the interval, but the prompt did NOT run ahead.
	{
		const ctl = armedControl(60_000);
		// wireAt 200 → wire = 70_300, promptStart = 71_660 → NOT promptRanAhead;
		// snapshot received at 72_000 (after the wire) with the id absent.
		const i1 = armed(
			intervention("d1", 2_000, 70_000, { wireAt: 200, nsLatency: 1_500, fixtureCall: false }),
			shimChannel("d1", 70_000, [{ receivedAtMs: 72_000, at: 72_005, tools: ["unrelated_tool"] }]),
		);
		const res = classifyProbe([ctl.record, i1.record], [...ctl.events, ...i1.events]);
		assert.ok(
			res.verdict === "inconclusive" && !res.promotable,
			"snapshot absence WITHOUT promptRanAhead is not the delayed-window failure mode — never promoted [QK:VERDICT-SNAPSHOT-REQUIRES-RANAHEAD]",
		);
	}

	// (5) the wire marker lands INSIDE the snapshot interval → unordered.
	{
		const ctl = armedControl(80_000);
		// wire = 92_100; interval [92_050, 92_150] straddles it.
		const i1 = armed(
			intervention("d1", 2_000, 90_000, { ...ranAheadSpec }),
			shimChannel("d1", 90_000, [{ receivedAtMs: 92_050, at: 92_150, tools: ["unrelated_tool"] }]),
		);
		const res = classifyProbe([ctl.record, i1.record], [...ctl.events, ...i1.events]);
		assert.ok(
			res.verdict === "inconclusive" &&
				!res.promotable &&
				res.interventions[0].evidence.includes("INSIDE the snapshot interval"),
			"a wire marker inside the received↔forwarded interval is UNORDERED — only wire strictly before the interval reads as after [QK:VERDICT-SNAPSHOT-INTERVAL-UNORDERED]",
		);
	}

	// (6) snapshot received BEFORE the wire → a different claim, not promoted.
	{
		const ctl = armedControl(100_000);
		// wire = 112_100; interval [111_800, 111_805] fully before it.
		const i1 = armed(
			intervention("d1", 2_000, 110_000, { ...ranAheadSpec }),
			shimChannel("d1", 110_000, [{ receivedAtMs: 111_800, at: 111_805, tools: ["unrelated_tool"] }]),
		);
		const res = classifyProbe([ctl.record, i1.record], [...ctl.events, ...i1.events]);
		assert.ok(
			res.verdict === "inconclusive" && res.interventions[0].evidence.includes("snapshot-before-wire"),
			"a snapshot that predates wire-availability carries a different claim than the §11-7-c after-the-wire row",
		);
	}

	// (7) runtime No-such-tool for the measured id + snapshot absence → the
	// runtime ladder OWNS the run: B, never B-name-snapshot.
	{
		const ctl = armedControl(120_000);
		const i1 = armed(
			intervention("d1", 2_000, 130_000, { ...ranAheadSpec, noSuchToolId: PROVIDER_ID_MEASURED }),
			shimChannel("d1", 130_000, [{ receivedAtMs: 132_190, at: 132_195, tools: ["unrelated_tool"] }]),
		);
		const res = classifyProbe([ctl.record, i1.record], [...ctl.events, ...i1.events]);
		assert.ok(
			res.verdict === "B" && res.interventions[0].failure === "B",
			"the model's own dispatch failing is the stronger runtime-B evidence and owns the combined run — the snapshot never substitutes for it",
		);
	}

	// (8) TWO snapshots after the prompt frame → the exactly-one binding is a
	// named violation, never a pick-first.
	{
		const ctl = armedControl(140_000);
		const i1 = armed(
			intervention("d1", 2_000, 150_000, { ...ranAheadSpec }),
			shimChannel("d1", 150_000, [
				{ receivedAtMs: 152_190, at: 152_195, tools: ["unrelated_tool"] },
				{ receivedAtMs: 152_400, at: 152_405, tools: ["unrelated_tool", PROVIDER_ID_MEASURED] },
			]),
		);
		const res = classifyProbe([ctl.record, i1.record], [...ctl.events, ...i1.events]);
		assert.ok(
			res.verdict === "inconclusive" &&
				!res.promotable &&
				res.interventions[0].evidence.includes("snapshot-channel-violation"),
			"reinit/set-model re-emission making the binding ambiguous is a NAMED channel violation — the (b) reading is unavailable, never a pick-first promotion [QK:VERDICT-SNAPSHOT-ORDINAL-EXACTLY-ONE]",
		);
		assert.notEqual(res.status.orderingMeasurement, "unobserved", "…while axis (a) still carries its comparison");
	}

	// (9) full promotion-shaped shim evidence under an UNARMED roster → ignored.
	// The roster is the authority on what was instrumented; found evidence never
	// promotes past the declaration.
	{
		const ctl = passingControl(160_000); // unarmed
		const i1raw = intervention("d1", 2_000, 170_000, { ...ranAheadSpec });
		const i1 = {
			record: i1raw.record, // snapshotInstrumented: false
			events: [
				...i1raw.events,
				...shimChannel("d1", 170_000, [{ receivedAtMs: 172_190, at: 172_195, tools: ["unrelated_tool"] }]),
			],
		};
		const res = classifyProbe([ctl.record, i1.record], [...ctl.events, ...i1.events]);
		assert.ok(
			res.verdict === "inconclusive" && !res.promotable && res.status.failureVerdict !== "B-name-snapshot",
			"shim-shaped evidence in the log of an UNARMED run is ignored — the roster declares the instrument, evidence alone never promotes [QK:VERDICT-SNAPSHOT-NEEDS-INSTRUMENT-FLAG]",
		);
	}

	// (10) the binding is on the RECEIVE axis, not the append axis. Under stdout
	// backpressure a BOOT-time init (received before the prompt frame) can have
	// its downstream callback — and therefore its log append — land after the
	// prompt marker. A seq-only binding would promote that stale set as the turn
	// snapshot (GPT review 2026-07-29). Timeline: promptStart 191_660 < wire
	// 191_670 (ranAhead), shim prompt frame stamped 191_700; the ONLY snapshot
	// was received 191_680 (BEFORE the frame) but appended at 191_750.
	{
		const ctl = armedControl(180_000);
		const i1 = armed(
			intervention("d1", 2_000, 190_000, { wireAt: 1_570, nsLatency: 1_500, fixtureCall: false }),
			shimChannel("d1", 190_000, [{ receivedAtMs: 191_680, at: 191_750, tools: ["unrelated_tool"] }]),
		);
		const res = classifyProbe([ctl.record, i1.record], [...ctl.events, ...i1.events]);
		assert.ok(
			res.verdict === "inconclusive" &&
				!res.promotable &&
				res.interventions[0].evidence.includes("snapshot-channel-violation"),
			"an init RECEIVED before the prompt frame is not a candidate even when its append lands after — the receive axis, not the append/callback axis, binds; zero candidates is a named violation [QK:VERDICT-SNAPSHOT-BINDING-RECEIVE-AXIS]",
		);
	}

	// (11) a broken shim IDENTITY on an armed intervention invalidates the RUN —
	// the shim intermediates the CLI spawn, so a run without the calibrated shim
	// did not share the pair's launch path, and it may NOT keep voting on axis
	// (a) (GPT review 2026-07-29: a missing-shim run could otherwise build A/B
	// causal windows out of a different stimulus).
	{
		const ctl = armedControl(200_000);
		const i1 = armed(intervention("d1", 2_000, 210_000, { ...ranAheadSpec }), []); // armed, NO shim events
		const res = classifyProbe([ctl.record, i1.record], [...ctl.events, ...i1.events]);
		assert.ok(
			res.verdict === "INVALIDATED" &&
				res.status.invalidRuns.some((r) => r.reason === "snapshot-topology") &&
				res.ordering.summary === "unobserved" &&
				res.status.orderingMeasurement !== "measured",
			"an armed intervention whose shim never reported in is INVALIDATED (snapshot-topology) and votes on NEITHER axis — not a (b)-only degradation [QK:VERDICT-SNAPSHOT-STRUCTURAL-INVALIDATES]",
		);
	}

	// (12) the roster's expected target identity is CONSUMED: a shim boot
	// reporting a different content hash means this run did not execute the
	// pair's stimulus (env hijack, target swap) → INVALIDATED, never promoted.
	{
		const ctl = armedControl(220_000);
		const i1 = armed(
			intervention("d1", 2_000, 230_000, { ...ranAheadSpec }),
			shimChannel("d1", 230_000, [{ receivedAtMs: 232_190, at: 232_195, tools: ["unrelated_tool"] }], {
				bootTargetSha256: "zz-different",
			}),
		);
		const res = classifyProbe([ctl.record, i1.record], [...ctl.events, ...i1.events]);
		assert.ok(
			res.verdict === "INVALIDATED" && res.status.invalidRuns.some((r) => r.reason === "snapshot-topology"),
			"a shim boot whose target path+sha does not match the roster's expected identity INVALIDATES the run — identity is verified, not merely recorded [QK:VERDICT-SNAPSHOT-TARGET-IDENTITY]",
		);
	}

	// (13) a snapshot CONTAINING the measured id blocks the ladder BEFORE the
	// promotion rung — the absence check is positional, so this rung is what
	// keeps a present-id snapshot from promoting as absence.
	{
		const ctl = armedControl(240_000);
		const i1 = armed(
			intervention("d1", 2_000, 250_000, { ...ranAheadSpec }),
			shimChannel("d1", 250_000, [
				{ receivedAtMs: 252_190, at: 252_195, tools: [PROVIDER_ID_MEASURED, "unrelated_tool"] },
			]),
		);
		const res = classifyProbe([ctl.record, i1.record], [...ctl.events, ...i1.events]);
		assert.ok(
			res.verdict === "inconclusive" &&
				!res.promotable &&
				res.interventions[0].evidence.includes("CONTAINS the measured id"),
			"a snapshot that CONTAINS the measured id reads model-compliance, never absence — the contains-id rung blocks promotion [QK:VERDICT-SNAPSHOT-CONTAINS-ID-BLOCKS]",
		);
	}
}

rmSync(tmp, { recursive: true, force: true });
console.log("[check-probe-ordering] PASS — §11-7 probe seam: sameness pinned to backend.ts, phase attribution");
console.log("  (set-model included), fixture wire markers + required probeRunId + legacy compat, the event-log");
console.log("  door contract (reserved keys refused; unknown marker / broken axis / unjudgeable payload →");
console.log("  MALFORMED, while a legitimately absent optional field stays an observation) plus the stream");
console.log("  door (per-pid seq/clock judged on RAW append order), the observation-window protocol");
console.log("  (censored ≠ candidate), runner-owned marker topology, the two reported axes, the");
console.log("  paired-verdict truth table (P0/I0 outside the space, phase-qualified D, B promotion ladder, C,");
console.log("  A's two-delay rule), and the §11-7-c consumer seam (CLI-target preconditions, upstream");
console.log("  launch-semantics inspector, shim event doors, B-name-snapshot ladder with calibration and");
console.log("  the roster-armed channel).");
