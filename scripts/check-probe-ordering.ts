// Deterministic gate for the §11-7 ordering probe (docs/acp-backend-rail.md).
//
// §11-7 allows the probe a raw client ONLY "bound by a gate asserting it issues
// the same calls, arguments, and order as the backend's real sequence" — THIS is
// that gate. Five axes, no live API anywhere:
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
//   5) VERDICT TRUTH TABLE — synthetic paired logs replay through the PURE
//      classifier: P0/I0 outside the verdict space, phase-qualified D, the B
//      promotion ladder (exact measured id only), C, and A's two-delay rule.
//
// Kill-proof, stated at its honest strength: scripts/mutants/probe-ordering.json
// qualifies 19 claims — each carries a [QK:...] signature appearing EXACTLY once
// below, and check-gate-qualification proves its mutant dies at that signature.
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
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
	type ProbeAdapterSeam,
	type ProbeMcpEnricher,
	ProbePhaseError,
	type ProbeTurnPhase,
} from "./lib/probe-acp-turn.ts";
import {
	appendProbeEvent,
	PAYLOAD_CONTRACT_EVENTS,
	PROBE_ENV,
	PROBE_EVENTS,
	PROBE_EXPECTED_TOOL,
	type ProbeEvent,
	RESERVED_EVENT_KEYS,
	readProbeEvents,
} from "./lib/probe-event-log.ts";
import { classifyProbe, DELAY_WELL_BELOW_MS, type ProbeRunRecord } from "./lib/probe-verdict.ts";

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

	// §9-4 shape: an undefined session meta omits the `_meta` KEY entirely.
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
		"undefined session meta omits the _meta KEY entirely (§9-4)",
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
			promptMs: PROBE_PHASE_TIMEOUTS.promptMs,
		},
		{
			initializeMs: timeoutOf("INITIALIZE_TIMEOUT_MS"),
			newSessionMs: timeoutOf("NEW_SESSION_TIMEOUT_MS"),
			setModelMs: timeoutOf("SET_MODEL_TIMEOUT_MS"),
			promptMs: timeoutOf("PROMPT_TIMEOUT_MS"),
		},
		"probe phase timeouts EQUAL backend.ts's — D is only readable against production boundaries [QK:PROBE-TIMEOUTS-MATCH-PRODUCTION]",
	);

	const idx = (needle: string): number => {
		const i = BACKEND_SRC.indexOf(needle);
		assert.ok(i !== -1, `backend.ts contains ${JSON.stringify(needle)}`);
		return i;
	};
	const iInit = idx("connection.initialize({");
	const iNew = idx("connection.newSession(newSessionArgs)");
	const iEnforce = idx("adapter.enforceModel({");
	const iPrompt = BACKEND_SRC.indexOf("connection.prompt({", iEnforce);
	assert.ok(
		iInit < iNew && iNew < iEnforce && iEnforce < iPrompt && iPrompt !== -1,
		"backend.ts runNewTurn keeps initialize → newSession → enforceModel → prompt; the probe mirrors THIS sequence",
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

	// A malformed event line is run-invalidating: the missing line could be the
	// very wire marker whose absence the classifier would then read as evidence —
	// and the preserved classification.json must say INVALIDATED on its face,
	// never a judgeable-looking thin-log verdict.
	assert.ok(
		RUNNER_SRC.includes("if (malformed.length > 0)") &&
			RUNNER_SRC.includes("run INVALIDATED") &&
			RUNNER_SRC.includes('verdict: "INVALIDATED"'),
		"the runner refuses to judge a log carrying malformed lines and writes an INVALIDATED classification [QK:PROBE-MALFORMED-INVALIDATES]",
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
			timeouts: { initializeMs: 1000, newSessionMs: 1000, setModelMs: 50, promptMs: 1000 },
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
			PROBE_EVENTS.promptEnd,
			PROBE_EVENTS.promptReply,
			PROBE_EVENTS.setModelEnd,
			PROBE_EVENTS.toolsListResponseForwarded,
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
}

function syntheticRun(spec: SyntheticRunSpec): ProbeEvent[] {
	const { runId, probeRunId, base } = spec;
	const nsStart = base + 100;
	const nsLatency = spec.nsLatency ?? 300;
	const out: ProbeEvent[] = [ev(runId, PROBE_EVENTS.initializeStart, base)];
	if (spec.failPhase === "initialize") {
		out.push(ev(runId, PROBE_EVENTS.initializeEnd, base + 50, { ok: false, error: "init boom" }));
		return out;
	}
	out.push(ev(runId, PROBE_EVENTS.initializeEnd, base + 50, { ok: true }));
	out.push(ev(runId, PROBE_EVENTS.newSessionStart, nsStart));
	if (spec.wireAt !== null)
		out.push(ev(runId, PROBE_EVENTS.toolsListResponseForwarded, nsStart + (spec.wireAt ?? 100)));
	if (spec.failPhase === "newSession") {
		out.push(
			ev(runId, PROBE_EVENTS.newSessionEnd, nsStart + nsLatency, { ok: false, timedOut: true, error: "ns boom" }),
		);
		return out;
	}
	out.push(ev(runId, PROBE_EVENTS.newSessionEnd, nsStart + nsLatency, { ok: true }));
	const smStart = nsStart + nsLatency + 10;
	out.push(ev(runId, PROBE_EVENTS.setModelStart, smStart));
	if (spec.failPhase === "enforceModel") {
		out.push(ev(runId, PROBE_EVENTS.setModelEnd, smStart + 30, { ok: false, error: "sm boom" }));
		return out;
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
		return out;
	}
	out.push(ev(runId, PROBE_EVENTS.promptReply, pStart + 250, { carriesNonce: spec.nonceEchoed ?? true }));
	out.push(ev(runId, PROBE_EVENTS.promptEnd, pStart + 300, { ok: true }));
	return out;
}

const PROVIDER_ID_MEASURED = "mcp__probe__probe_nonce";

function passingControl(base = 0): { record: ProbeRunRecord; events: ProbeEvent[] } {
	return {
		record: { runId: "ctl", role: "control", delayMs: 0, probeRunId: "prb-ctl" },
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
		record: { runId, role: "intervention", delayMs, probeRunId },
		events: syntheticRun({ runId, probeRunId, base, ...spec }),
	};
}

// --- P0: control failures invalidate the whole experiment -------------------
{
	const ctl = {
		record: { runId: "ctl", role: "control", delayMs: 0, probeRunId: "prb-ctl" } as ProbeRunRecord,
		events: syntheticRun({ runId: "ctl", probeRunId: "prb-ctl", base: 0, failPhase: "initialize" }),
	};
	const d1 = intervention("d1", 2000, 10_000, { wireAt: 2100, nsLatency: 2400, fixtureCall: true });
	const res = classifyProbe([ctl.record, d1.record], [...ctl.events, ...d1.events]);
	assert.equal(res.verdict, "P0", "control initialize failure → P0");
	assert.equal(res.control.p0Reason, "initialize", "P0 carries reason=initialize");
	assert.equal(res.interventions.length, 0, "no intervention is judged under P0");

	const ctl2 = {
		record: { runId: "ctl", role: "control", delayMs: 0, probeRunId: "prb-ctl" } as ProbeRunRecord,
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
	// (a) no wire marker at all → NOT B: rail doc :631 files it as an MCP
	// handshake / fixture / config CANDIDATE and :638 keeps unlisted combinations
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
	assert.equal(resB.verdict, "B", "marker-complete absence reads B");
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
	// evidence (:634 — the real provider-bound id may have been in schema).
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

rmSync(tmp, { recursive: true, force: true });
console.log("[check-probe-ordering] PASS — §11-7 probe seam: sameness pinned to backend.ts, phase attribution");
console.log("  (set-model included), fixture wire markers + required probeRunId + legacy compat, the event-log");
console.log("  door contract (reserved keys refused; unknown marker / broken axis / unjudgeable payload →");
console.log("  MALFORMED, while a legitimately absent optional field stays an observation), and the");
console.log("  paired-verdict truth table (P0/I0 outside the space, phase-qualified D, B promotion ladder, C,");
console.log("  A's two-delay rule).");
