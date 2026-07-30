// Deterministic gate for the ACP stop-reason contract (backend.ts + event-mapper.ts).
//
// WHAT THIS EXISTS TO STOP. `mapPromptStopReason` used to be a bare
// `switch` returning a StopReason with `default: return "stop"`. The ACP terminal
// set is closed — `@agentclientprotocol/sdk` 1.3.0 `schema/types.gen` declares
// `end_turn | max_tokens | max_turn_requests | refusal | cancelled` — so that
// default silently collapsed THREE distinct non-success outcomes into a clean
// successful turn:
//
//   refusal            the model declined; the answer is absent
//   max_turn_requests  the backend's per-turn budget ran out; the answer is cut
//   <anything new>     a reason this build has never seen
//
// plus a fourth: a prompt result carrying NO stopReason at all. pi rendered all
// four as a finished assistant message. pi 0.83 closed the identical hole in its
// own providers (#7272 — unmapped terminal reasons surface as provider errors,
// never successful stops) and added `AssistantMessage.rawStopReason` so the wire
// value survives mapping; this gate pins our side of that same contract.
//
// A pure-function check of the mapper is NOT enough — the defect people actually
// feel is "pi showed a truncated answer as done". So every cell is driven
// BEHAVIORALLY through `streamAcpTurn` against a fake ACP connection, and each
// asserts all four observable facts together:
//
//   (a) the emitted event KIND      done vs error
//   (b) the emitted event REASON    stop / length / aborted / error
//   (c) the final message stopReason
//   (d) rawStopReason + errorMessage on that same final message
//
// SEED CLAIM (separate, and deliberately not folded into the cells above).
// `createAcpStreamState` seeds `stopReason: "pending"` — pi 0.83's sentinel for
// "no terminal reason observed yet". Seeding "stop" would pre-claim success for
// the entire in-flight turn. That claim is asserted on the value returned by
// `createAcpStreamState` DIRECTLY: `state.output` is a mutable object that every
// terminal path overwrites, so reading it after a turn would only ever show the
// terminal value and could never fail. Reading it late is how this assertion
// would quietly stop testing anything.
//
// backend.ts imports its siblings with `.js` suffixes (the root/jiti runtime
// convention), so — like check-acp-session-reuse — we tsc-emit the project and
// import the COMPILED backend.js whose `.js` imports resolve to real siblings.

import { strict as assert } from "node:assert";
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, rmdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { Api, AssistantMessageEvent, Context, Model } from "@earendil-works/pi-ai";

const sonnet = { id: "claude-sonnet-5" } as unknown as Model<Api>;

type Stream = AsyncIterable<AssistantMessageEvent> & {
	result: () => Promise<{ stopReason: string; errorMessage?: string }>;
};

async function collect(stream: Stream): Promise<AssistantMessageEvent[]> {
	const events: AssistantMessageEvent[] = [];
	for await (const ev of stream) events.push(ev);
	return events;
}

function makeFakeChild() {
	const pipe = () => ({ destroy() {}, unref() {} });
	return {
		pid: undefined as number | undefined,
		exitCode: null as number | null,
		signalCode: null as NodeJS.Signals | null,
		stdin: pipe(),
		stdout: pipe(),
		stderr: { on() {}, destroy() {}, unref() {} },
		kill() {
			return true;
		},
		unref() {},
		once() {},
	};
}

const EMPTY_MCP_HASH = "4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945";
const DEFAULT_RESOLVED_CONFIG: any = {
	settingSources: [],
	strictMcpConfig: true,
	showToolNotifications: true,
	mcpServers: [],
	mcpServersHash: EMPTY_MCP_HASH,
	tools: ["Read"],
	skillPlugins: [],
	permissionAllow: ["Read(*)"],
	disallowedTools: [],
};

/**
 * A harness whose fake ACP `prompt` resolves with EXACTLY the terminal shape the
 * cell is about. `wireReason === null` models a result object with no stopReason
 * key at all (the "absent" cell) rather than a literal `undefined` value.
 */
function makeHarness(recordDir: string, wireReason: string | null) {
	return {
		resolveLaunch: () => ({ command: "node", args: ["fake"] }),
		ensureOverlay: () => {},
		spawnChild: () => makeFakeChild(),
		createConnection: (_child: any, handlers: any) => ({
			initialize: async () => ({ agentCapabilities: {} }),
			newSession: async () => ({ sessionId: "ACP-1" }),
			setSessionConfigOption: async () => ({}),
			prompt: async ({ sessionId }: any) => {
				await handlers.sessionUpdate({
					update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "PARTIAL" } },
					sessionId,
				});
				return wireReason === null ? {} : { stopReason: wireReason };
			},
		}),
		lifecyclePolicy: () => "process-scoped",
		loadConfig: () => DEFAULT_RESOLVED_CONFIG,
		now: () => "2026-07-30T00:00:00Z",
		sessionDir: recordDir,
	};
}

const TMP_EMIT = ".tmp-verify/acp-stop-reason";
rmSync(TMP_EMIT, { recursive: true, force: true });
const recordDir = mkdtempSync(resolve(tmpdir(), "acp-stop-rec-"));

/**
 * One driven turn, described by everything an operator could observe.
 *
 * `claim` is the qualification token this cell's SEALING assertions carry. The
 * mutant harness does not accept "the gate went red" — it requires the gate to
 * go red *at the token of the claim under test*, so a cell that guards a claim
 * must print that claim's `[QK:…]` in the very assertion the mutant trips.
 * Cells whose sealing no mutant targets carry no token.
 */
type Cell = {
	wire: string | null;
	kind: "done" | "error";
	reason: string;
	stopReason: string;
	rawStopReason?: string;
	/** Substring the errorMessage must carry; absent = there must be no errorMessage. */
	errorContains?: string;
	claim?: string;
	why: string;
};

/** Qualification token for the claim that the raw ACP reason survives mapping. */
const RAW_CLAIM = "[QK:STOP-RAW-PRESERVED]";

/** Prefix an assertion message with a claim token when the cell guards one. */
function tag(cell: Cell, message: string): string {
	return cell.claim ? `${cell.claim} ${message}` : message;
}

const CELLS: Cell[] = [
	{
		wire: "end_turn",
		kind: "done",
		reason: "stop",
		stopReason: "stop",
		rawStopReason: "end_turn",
		why: "a normal completion is the only clean success",
	},
	{
		wire: "max_tokens",
		kind: "done",
		reason: "length",
		stopReason: "length",
		rawStopReason: "max_tokens",
		why: "output-cap truncation is honestly reported as length, not stop",
	},
	{
		wire: "cancelled",
		kind: "error",
		reason: "aborted",
		stopReason: "aborted",
		rawStopReason: "cancelled",
		why: "a cancelled turn is an abort, never a done",
	},
	{
		wire: "refusal",
		kind: "error",
		reason: "error",
		stopReason: "error",
		rawStopReason: "refusal",
		errorContains: "refusal",
		claim: "[QK:STOP-REFUSAL-NOT-SUCCESS]",
		why: "a model refusal has no answer to show — reporting it as done is the original defect",
	},
	{
		wire: "max_turn_requests",
		kind: "error",
		reason: "error",
		stopReason: "error",
		rawStopReason: "max_turn_requests",
		errorContains: "max_turn_requests",
		claim: "[QK:STOP-TURNBUDGET-NOT-SUCCESS]",
		why: "an exhausted per-turn request budget leaves the answer cut short",
	},
	{
		wire: "teapot",
		kind: "error",
		reason: "error",
		stopReason: "error",
		rawStopReason: "teapot",
		errorContains: "teapot",
		claim: "[QK:STOP-UNKNOWN-NOT-SUCCESS]",
		why: "a reason this build has never seen must fail loud, carrying the raw value",
	},
	{
		wire: null,
		kind: "error",
		reason: "error",
		stopReason: "error",
		errorContains: "without a stop reason",
		claim: "[QK:STOP-ABSENT-NOT-SUCCESS]",
		why: "a prompt result with no stopReason at all is not a successful turn",
	},
];

try {
	execFileSync("node_modules/.bin/tsc", ["--outDir", TMP_EMIT, "--rootDir", ".", "--noEmit", "false"], {
		stdio: "pipe",
	});
	const promptsOut = resolve(TMP_EMIT, "pi-extensions/lib/acp/prompts");
	mkdirSync(promptsOut, { recursive: true });
	copyFileSync("pi-extensions/lib/acp/prompts/engraving.md", resolve(promptsOut, "engraving.md"));

	const backendUrl = pathToFileURL(resolve(TMP_EMIT, "pi-extensions/lib/acp/backend.js")).href;
	const eventUrl = pathToFileURL(resolve(TMP_EMIT, "pi-extensions/lib/acp/event-mapper.js")).href;
	const backend = (await import(backendUrl)) as any;
	const eventMod = (await import(eventUrl)) as any;

	// ----------------------------------------------------------------------
	// (1) SEED — asserted on the freshly returned state, never after a turn.
	// ----------------------------------------------------------------------
	{
		const seeded = eventMod.createAcpStreamState(
			{ push() {}, end() {} },
			{
				api: "entwurf",
				provider: "entwurf",
				model: sonnet.id,
			},
		);
		assert.equal(
			seeded.output.stopReason,
			"pending",
			"[QK:STOP-PENDING-SEED] a freshly created ACP stream state must seed stopReason 'pending' (pi 0.83's " +
				"no-terminal-reason-yet sentinel) — seeding 'stop' pre-claims success for the whole in-flight turn",
		);
	}

	// ----------------------------------------------------------------------
	// (2) The seven terminal cells, driven end to end. Each cell's qualification
	//     token lives in its `claim` field above — exactly one occurrence per
	//     token in this file, which is what the mutant manifest requires.
	// ----------------------------------------------------------------------
	for (const cell of CELLS) {
		const label = cell.wire === null ? "<absent>" : cell.wire;
		const events = await collect(
			backend.streamAcpTurn(
				sonnet,
				{ messages: [{ role: "user", content: `drive ${label}`, timestamp: 0 }] } as Context,
				{ sessionId: `stop-${label}` },
				makeHarness(recordDir, cell.wire),
			) as Stream,
		);

		const done = events.find((e) => e.type === "done") as any;
		const errored = events.find((e) => e.type === "error") as any;

		if (cell.kind === "done") {
			assert.ok(done, tag(cell, `[${label}] must seal as a done event — ${cell.why}`));
			assert.ok(!errored, tag(cell, `[${label}] must not also emit an error event`));
		} else {
			assert.ok(errored, tag(cell, `[${label}] must seal as an ERROR event, not a done — ${cell.why}`));
			assert.ok(
				!done,
				tag(cell, `[${label}] must NOT emit a done event — that is exactly the collapse this gate forbids`),
			);
		}

		const sealed = cell.kind === "done" ? done : errored;
		assert.equal(sealed.reason, cell.reason, tag(cell, `[${label}] sealed event reason must be "${cell.reason}"`));

		const final = cell.kind === "done" ? sealed.message : sealed.error;
		assert.equal(
			final.stopReason,
			cell.stopReason,
			tag(cell, `[${label}] final message stopReason must be "${cell.stopReason}"`),
		);
		// Deliberately carries no claim token: the seed mutant is caught by the
		// direct assertion in (1), and this one is the standing guarantee that no
		// terminal path ever leaks the sentinel out to a consumer.
		assert.notEqual(
			final.stopReason,
			"pending",
			`[${label}] the seed must never survive a sealed turn — every terminal path overwrites it`,
		);
		assert.equal(
			final.rawStopReason,
			cell.rawStopReason,
			`${RAW_CLAIM} [${label}] rawStopReason must preserve the wire value (${cell.rawStopReason ?? "absent"}) so ` +
				"the raw ACP reason survives the mapping",
		);

		if (cell.errorContains) {
			assert.ok(
				typeof final.errorMessage === "string" && final.errorMessage.includes(cell.errorContains),
				tag(
					cell,
					`[${label}] errorMessage must name the reason (expected to contain "${cell.errorContains}", got ` +
						`${JSON.stringify(final.errorMessage)})`,
				),
			);
		} else {
			assert.equal(final.errorMessage, undefined, tag(cell, `[${label}] a clean end must not carry an errorMessage`));
		}
	}
} finally {
	rmSync(TMP_EMIT, { recursive: true, force: true });
	try {
		// The qualification harness's work-surface hash walks ignored paths too, so
		// a leftover EMPTY parent dir reads as IMPURE tree drift even though git
		// porcelain is clean. Remove it when empty; a concurrent sibling gate's
		// emit keeps it alive and this rmdir simply fails.
		rmdirSync(".tmp-verify");
	} catch {
		// non-empty or already gone — fine either way
	}
	rmSync(recordDir, { recursive: true, force: true });
}

console.log(
	"[check-acp-stop-reason] ok — the ACP terminal set is driven end to end through streamAcpTurn: end_turn→done/stop " +
		"and max_tokens→done/length are the only clean seals; cancelled→error/aborted; refusal, max_turn_requests, an " +
		"unrecognized reason, and an ABSENT reason each seal as an ERROR event with no done (the collapse-to-stop defect " +
		"pi 0.83 #7272 closed on its own providers); rawStopReason preserves the wire value on every cell that carried " +
		"one; and the stream state seeds 'pending' (asserted on the fresh state, not after a turn) so no in-flight turn " +
		"pre-claims success",
);
