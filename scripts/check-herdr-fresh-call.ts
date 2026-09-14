/**
 * check-herdr-fresh-call — deterministic gate for the #116 herdr launch rail core
 * (`pi-extensions/lib/herdr-fresh-call.ts`).
 *
 * SCOPE DISCIPLINE, same as its S1 sibling: only what is decidable WITHOUT a herdr binary —
 * argv grammar, the option-G encoding, response parsing, the reject vocabulary, the
 * conditional-close matrix, the receipt shape, and the import fence that keeps the two rails
 * separately deletable. There is no fake herdr executable and no fake server here
 * (`scripts/check-mux-placement.ts:6-9` refuses a fake tmux for the reason that applies twice
 * as hard to a stand-in server: it would agree with whatever we believed the day we wrote it).
 * The real-binary half is an isolated private server, and that is c2.
 *
 * Every JSON literal below is a VERBATIM payload recorded from herdr 0.9.0 on 2026-09-14.
 *
 * Each claim carries its QK token on exactly ONE assertion.
 *
 *   HFC-RAIL-IMPORT-FENCE       the module imports no mux and no entwurf module
 *   HFC-PILOT-CLOSED            a non-pilot backend is a pre-mutation named reject, with no
 *                               tmux fallback anywhere in the module
 *   HFC-TMUX-PLACEMENT-REFUSED  a tmux seat input inside herdr is refused by name, never ignored
 *   HFC-ENCODE-ROUNDTRIP        the encoded argv decodes back to the exact prompt, bytes intact
 *   HFC-ENCODE-NO-CONTROL       the encoded argv carries zero Unicode Cc — including the C1
 *                               block and DEL, which JSON.stringify leaves literal
 *   HFC-ENCODE-MAX-TASK         a maximum public task encodes and stays Cc-free
 *   HFC-PREMUTATION-ONLY        every refusal happens before the first herdr call
 *   HFC-SPLIT-ARGV              the one placement policy, cwd carried literally, identity
 *                               scrubbed explicitly
 *   HFC-START-ARGV              backend argv rides after `--`, under the requested kind
 *   HFC-AGENT-NAME-OPAQUE       the herdr agent name is derived from the nonce and is valid
 *                               under herdr's own name rule
 *   HFC-PARSE-STRICT            a payload that is not the measured shape is declined, never
 *                               half-believed
 *   HFC-PANE-ID-OPAQUE          a `pA`-style pane id survives untouched — no decimal parser
 *   HFC-RECEIPT-NO-ADDRESS      the receipt carries no garden id, native session id, screen
 *                               text or herdr view judgement
 *   HFC-CLOSE-WITHIN-GENERATION a close needs id AND terminal match AND no agent session
 *   HFC-ORPHAN-NAMED            every failed reclaim names its reason instead of going quiet
 *   HFC-INPUT-PARITY            the caller-facing input contract is the SHARED one, word for word
 *   HFC-CWD-EMPTY-IS-OMITTED    `cwd: ""` means "no cwd", as it does on the other rail
 *   HFC-SPLIT-OCCUPIED          a split that landed on a pane holding an agent does not start
 *   HFC-START-PANE-BINDING      a start that reports a different pane/terminal is a named failure
 *   HFC-START-WITNESS-REQUIRED  a start with no agent session is a named failure
 *   HFC-START-ARGV-FIDELITY     the echoed argv must be exactly what we asked herdr to compose
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import {
	argvMatchesRequest,
	buildHerdrAgentStartArgs,
	buildHerdrPaneCloseArgs,
	buildHerdrPaneGetArgs,
	buildHerdrSplitArgs,
	containsControlChar,
	decideConditionalClose,
	encodeBirthPrompt,
	HERDR_DECODE_INSTRUCTION,
	HERDR_FRESH_CALL_BACKENDS,
	type HerdrRun,
	herdrAgentNameFromNonce,
	herdrFreshCall,
	parseHerdrAgentStartResponse,
	parseHerdrPaneGetResponse,
	parseHerdrSplitResponse,
	readHerdrErrorCode,
	rejectTmuxPlacementInHerdrContext,
} from "../pi-extensions/lib/herdr-fresh-call.ts";

const REPO_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MODULE = "pi-extensions/lib/herdr-fresh-call.ts";
const MODULE_SRC = readFileSync(path.join(REPO_DIR, MODULE), "utf8");

let passed = 0;
function ok(label: string, cond: boolean): void {
	assert.ok(cond, label);
	console.log(`  ok    ${label}`);
	passed++;
}

/** Verbatim `pane split` reply, herdr 0.9.0, 2026-09-14. */
const SPLIT_OK = JSON.stringify({
	id: "cli:pane:split",
	result: {
		pane: {
			agent_status: "unknown",
			cwd: "/home/junghan/repos/gh/entwurf",
			pane_id: "w7:p7",
			tab_id: "w7:t1",
			terminal_id: "term_65b6e1ce2b3db16",
			workspace_id: "w7",
		},
		type: "pane_info",
	},
});

/** Verbatim `agent start` reply for the claude axis, same day. */
const START_OK = JSON.stringify({
	id: "cli:agent:start",
	result: {
		agent: {
			agent: "claude",
			agent_session: {
				agent: "claude",
				kind: "id",
				source: "herdr:claude",
				value: "e3093930-9113-4c3e-b9d0-672803d38fd8",
			},
			agent_status: "idle",
			interactive_ready: true,
			pane_id: "w7:p7",
			tab_id: "w7:t1",
			terminal_id: "term_65b6e1ce2b3db16",
			terminal_title: "✳ Claude Code",
			workspace_id: "w7",
		},
		argv: ["claude"],
		type: "agent_started",
	},
});

/** Verbatim failure envelope — measured against a NONEXISTENT pane, so nothing was created. */
const START_ERR = JSON.stringify({
	error: { code: "invalid_agent_argument", message: "agent arguments cannot be encoded safely for the target shell" },
	id: "cli:agent:start",
});

const CALLER = "20260914T174741-2e9ba9";
const NONCE = "herdr-fresh-call-0123456789abcdef01234567";
const HERDR_ENV = { HERDR_ENV: "1", HERDR_BIN_PATH: "/home/operator/.local/bin/herdr", HERDR_PANE_ID: "w7:p1" };

type ScriptedReply =
	| { status: number; stdout?: string; stderr?: string }
	| ((args: readonly string[]) => { status: number; stdout?: string; stderr?: string });

/** A runner that records what it was asked and answers from a fixed script. A reply may be a
 * FUNCTION of the request, which is how the start fixture echoes an argv the way herdr does
 * (`src/app/agents.rs:197-199`: canonical executable + our args) instead of a frozen literal
 * that could never drift and therefore could never be checked. */
function scriptedRun(replies: readonly ScriptedReply[]): { run: HerdrRun; calls: string[][] } {
	const calls: string[][] = [];
	let index = 0;
	const run: HerdrRun = (args) => {
		calls.push([...args]);
		const entry = replies[index++] ?? { status: 1 };
		const reply = typeof entry === "function" ? entry(args) : entry;
		return { status: reply.status, stdout: reply.stdout ?? "", stderr: reply.stderr ?? "" };
	};
	return { run, calls };
}

/** herdr's own echo: the canonical executable for the requested kind, then everything after `--`. */
function startReplyEchoingArgv(base: string, executable = "claude"): ScriptedReply {
	return (args) => {
		const parsed = JSON.parse(base) as { result: { argv: string[] } };
		parsed.result.argv = [executable, ...args.slice(args.indexOf("--") + 1)];
		return { status: 0, stdout: JSON.stringify(parsed) };
	};
}

/** Records the calls a refusal should never make. It RETURNS rather than throws: a throw would
 * end the gate with a message carrying no QK token, and a kill that cannot be attributed to its
 * claim is not a kill. */
function neverRun(): { run: HerdrRun; calls: string[][] } {
	const calls: string[][] = [];
	const run: HerdrRun = (args) => {
		calls.push([...args]);
		return { status: 1, stdout: "", stderr: "" };
	};
	return { run, calls };
}

function main(): void {
	console.log("[check-herdr-fresh-call]");

	// ── the fence ────────────────────────────────────────────────────────────────────────
	const code = MODULE_SRC.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
	const specifiers = [...MODULE_SRC.matchAll(/^import\s[^;]*?from\s+"([^"]+)";$/gm)].map((m) => m[1]);
	ok(
		"[QK:HFC-RAIL-IMPORT-FENCE] the herdr rail imports only node builtins and the neutral composition leaf — one mux or entwurf import here would re-couple the two rails and make either one undeletable",
		specifiers.length > 0 &&
			specifiers.every((s) => s.startsWith("node:") || s === "./fresh-call-composition.ts") &&
			!/from\s+"\.\/(mux-|entwurf-)/.test(code),
	);
	// tmux is NAMED in this module, and only in one place: the refusal of a tmux seat input.
	// That is the opposite of a fallback, so the guard pins WHERE the word may appear rather
	// than banning it — a banned word would have pushed the refusal into silence.
	const tmuxLines = code.split("\n").filter((line) => /tmux/i.test(line));
	ok(
		"[QK:HFC-PILOT-CLOSED] the pilot set is exactly pi + claude-code, and tmux appears in this module ONLY as the refusal of a tmux seat — never as a fallback launch",
		HERDR_FRESH_CALL_BACKENDS.length === 2 &&
			HERDR_FRESH_CALL_BACKENDS.includes("pi") &&
			HERDR_FRESH_CALL_BACKENDS.includes("claude-code") &&
			tmuxLines.length > 0 &&
			tmuxLines.every((line) => /tmux-rejected|tmuxSession|rejectTmuxPlacementInHerdrContext|tmuxPlacement/.test(line)),
	);

	// ── option G encoding ────────────────────────────────────────────────────────────────
	// An encoder that refuses and an encoder that throws are the same thing to a caller: no
	// faithful argv. Both land on the claim's own assertion rather than ending the gate with
	// an unattributable stack.
	const decodeOrNull = (prompt: string): string | null => {
		try {
			const result = encodeBirthPrompt(prompt);
			if (!result.ok) return null;
			const decoded: unknown = JSON.parse(result.argv.slice(HERDR_DECODE_INSTRUCTION.length));
			return typeof decoded === "string" ? decoded : null;
		} catch {
			return null;
		}
	};
	const argvOrNull = (prompt: string): string | null => {
		try {
			const result = encodeBirthPrompt(prompt);
			return result.ok ? result.argv : null;
		} catch {
			return null;
		}
	};

	const multiline = 'line one\nline two\ttabbed\n"quoted" and \\backslash\n한글 — em dash';
	ok(
		"[QK:HFC-ENCODE-ROUNDTRIP] the encoded argv decodes back to the EXACT prompt — every newline, tab, quote, backslash and non-ASCII character, with no trim and no normalisation",
		decodeOrNull(multiline) === multiline,
	);
	const c1Prompt = "head\u0085middle\u009fdel\u007ftail";
	const c1Argv = argvOrNull(c1Prompt);
	ok(
		"[QK:HFC-ENCODE-NO-CONTROL] the encoded argv carries zero Unicode Cc — JSON.stringify leaves DEL and the C1 block LITERAL, and herdr refuses an argument containing any of them",
		containsControlChar(c1Prompt) &&
			c1Argv !== null &&
			!containsControlChar(c1Argv) &&
			decodeOrNull(c1Prompt) === c1Prompt,
	);
	// 16000 is the public task cap the delivery surface mirrors; the worst case is every
	// character needing a six-byte \uXXXX escape.
	const maxTask = "\n한\u009f".repeat(5333) + "a";
	const maxArgv = argvOrNull(maxTask);
	ok(
		"[QK:HFC-ENCODE-MAX-TASK] a maximum-length public task encodes, stays Cc-free and still round-trips — the escape pass has no length cliff",
		maxTask.length === 16000 && maxArgv !== null && !containsControlChar(maxArgv) && decodeOrNull(maxTask) === maxTask,
	);

	// ── refusals happen before anything exists ───────────────────────────────────────────
	ok(
		'[QK:HFC-TMUX-PLACEMENT-REFUSED] ANY defined placement object is refused by name — `{}` and `{tmuxSession:""}` too, because reading the member instead of the object would give a caller who asked for a seat and mistyped it a default-placed sibling under a green receipt',
		rejectTmuxPlacementInHerdrContext({ tmuxSession: "org" }) === "herdr-placement-tmux-rejected" &&
			rejectTmuxPlacementInHerdrContext({}) === "herdr-placement-tmux-rejected" &&
			rejectTmuxPlacementInHerdrContext({ tmuxSession: "" }) === "herdr-placement-tmux-rejected" &&
			rejectTmuxPlacementInHerdrContext(undefined) === null,
	);
	const base = { backend: "pi", model: "openai-codex/gpt-5.6-sol", task: "do it", callerGardenId: CALLER } as const;
	const refusals: [string, Parameters<typeof herdrFreshCall>[0], NodeJS.ProcessEnv, string][] = [
		["herdr-context-missing", { ...base }, {}, "herdr-context-missing"],
		["parent pane", { ...base }, { HERDR_ENV: "1", HERDR_BIN_PATH: "/x/herdr" }, "herdr-parent-pane-missing"],
		["backend", { ...base, backend: "codex" }, HERDR_ENV, "herdr-backend-unsupported"],
		["tmux seat", { ...base, placement: { tmuxSession: "org" } }, HERDR_ENV, "herdr-placement-tmux-rejected"],
		["cwd", { ...base, cwd: "relative/dir" }, HERDR_ENV, "cwd-not-absolute"],
	];
	// The five INPUT reasons are owned by HFC-INPUT-PARITY below, which asserts both their
	// words and that they too reach no CLI. Splitting them keeps each mutant attributable: a
	// defect in "nothing runs yet" and a defect in "which word" are different repairs.
	let everyRefusalPreMutation = true;
	for (const [, params, env, expected] of refusals) {
		const { run, calls } = neverRun();
		const result = herdrFreshCall(params, run, env, NONCE);
		if (result.ok || result.reason !== expected || calls.length !== 0) everyRefusalPreMutation = false;
	}
	ok(
		"[QK:HFC-PREMUTATION-ONLY] the rail-shaped refusals — context, parent pane, backend, tmux seat, cwd — are decided with the herdr CLI never invoked, so a refused call leaves no pane behind",
		everyRefusalPreMutation,
	);

	// ── argv grammar ─────────────────────────────────────────────────────────────────────
	const splitArgs = buildHerdrSplitArgs({ parentPaneId: "w7:p1", cwd: "/repo/dir" });
	ok(
		"[QK:HFC-SPLIT-ARGV] one placement policy — the caller's own pane, split down, focus left alone — with cwd carried literally and BOTH identity carriers scrubbed by explicit repeated --env",
		splitArgs.join(" ") ===
			"pane split --pane w7:p1 --direction down --no-focus --cwd /repo/dir --env PI_SESSION_ID= --env PI_AGENT_ID=",
	);
	ok(
		"a cwd-free split omits --cwd entirely rather than sending an empty value",
		!buildHerdrSplitArgs({ parentPaneId: "w7:p1" }).includes("--cwd"),
	);
	const startArgs = buildHerdrAgentStartArgs({
		agentName: "entwurf-abc",
		kind: "claude",
		paneId: "w7:pA",
		backendArgs: ["PROMPT", "--model=opus"],
	});
	ok(
		"[QK:HFC-START-ARGV] the backend's own argv rides after `--`, under the REQUESTED kind and the pane just split",
		startArgs.join(" ") === "agent start entwurf-abc --kind claude --pane w7:pA -- PROMPT --model=opus",
	);
	ok(
		"pane get and pane close take a POSITIONAL pane id — measured: `--pane` is a usage error on both",
		buildHerdrPaneGetArgs("w7:pA").join(" ") === "pane get w7:pA" &&
			buildHerdrPaneCloseArgs("w7:pA").join(" ") === "pane close w7:pA",
	);
	const name = herdrAgentNameFromNonce(NONCE);
	ok(
		"[QK:HFC-AGENT-NAME-OPAQUE] the herdr agent name is derived from the per-call nonce, valid under herdr's own [a-z][a-z0-9_-]{0,31} rule, and discloses no role, title or address",
		/^[a-z][a-z0-9_-]{0,31}$/.test(name) &&
			name === herdrAgentNameFromNonce(NONCE) &&
			name !== herdrAgentNameFromNonce(`${NONCE}x`) &&
			!name.includes(CALLER),
	);

	// ── parsing ──────────────────────────────────────────────────────────────────────────
	const pane = parseHerdrSplitResponse(SPLIT_OK);
	ok(
		"[QK:HFC-PARSE-STRICT] a payload missing the fields a launch needs is DECLINED whole — a half-read pane is how a launch starts believing a coordinate it never got",
		pane !== null &&
			pane.paneId === "w7:p7" &&
			pane.terminalId === "term_65b6e1ce2b3db16" &&
			parseHerdrSplitResponse('{"id":"cli:pane:split","result":{"pane":{"pane_id":"w7:p7"}}}') === null &&
			// An EMPTY coordinate is not a coordinate. A present-but-blank field reads as
			// "herdr answered" to a `typeof` check alone, and would travel into the receipt as
			// a terminal id no conditional close could ever match.
			parseHerdrSplitResponse(SPLIT_OK.replace("term_65b6e1ce2b3db16", "")) === null &&
			parseHerdrSplitResponse(SPLIT_OK.replace('"w7:p7"', '""')) === null &&
			parseHerdrSplitResponse("usage: herdr pane split [<pane_id>|--pane ID|--current]") === null &&
			parseHerdrSplitResponse("") === null,
	);
	const started = parseHerdrAgentStartResponse(START_OK);
	ok(
		"the agent_started reply yields the same pane facts, and agent_session is read as PRESENCE only",
		started !== null && started.pane.paneId === "w7:p7" && started.pane.hasAgentSession === true,
	);
	const opaque = parseHerdrSplitResponse(SPLIT_OK.replace('"w7:p7"', '"w7:pA"'));
	ok(
		"[QK:HFC-PANE-ID-OPAQUE] a `pA`-style pane id survives byte-identical — measured: the tenth pane is `w7:pA`, not `w7:p10`, so any decimal parser is already wrong",
		opaque !== null && opaque.paneId === "w7:pA",
	);
	ok(
		"herdr's own error code is quoted out of its envelope rather than retyped into a vocabulary of ours that would go stale",
		readHerdrErrorCode(START_ERR) === "invalid_agent_argument" &&
			readHerdrErrorCode("usage: herdr agent start") === undefined,
	);

	// ── the launch, and what its receipt may say ─────────────────────────────────────────
	const { run, calls } = scriptedRun([{ status: 0, stdout: SPLIT_OK }, startReplyEchoingArgv(START_OK)]);
	const launched = herdrFreshCall({ ...base, backend: "claude-code", model: "opus" }, run, HERDR_ENV, NONCE);
	const receipt = launched.ok ? launched.receipt : null;
	const receiptText = JSON.stringify(receipt ?? {});
	ok(
		"[QK:HFC-RECEIPT-NO-ADDRESS] the launch receipt carries the view and what was requested — and no garden id, no native session id, no screen text and none of herdr's own readiness judgements",
		receipt !== null &&
			receipt.herdrPaneId === "w7:p7" &&
			receipt.herdrTerminalId === "term_65b6e1ce2b3db16" &&
			receipt.requestedKind === "claude" &&
			receipt.nonce === NONCE &&
			!("gardenId" in receipt) &&
			!("nativeSessionId" in receipt) &&
			!receiptText.includes("e3093930-9113-4c3e-b9d0-672803d38fd8") &&
			!receiptText.includes("interactive_ready") &&
			!receiptText.includes("agent_status") &&
			!receiptText.includes("Claude Code"),
	);
	ok(
		"the launch is exactly two herdr calls — split then start — with the encoded one-line prompt as the first backend argument",
		calls.length === 2 &&
			calls[0][1] === "split" &&
			calls[1][1] === "start" &&
			calls[1][calls[1].indexOf("--") + 1].startsWith(HERDR_DECODE_INSTRUCTION) &&
			!containsControlChar(calls[1][calls[1].indexOf("--") + 1]),
	);

	// ── conditional close ────────────────────────────────────────────────────────────────
	const split = { paneId: "w7:p7", terminalId: "term_65b6e1ce2b3db16" };
	const same = parseHerdrPaneGetResponse(SPLIT_OK);
	ok(
		"[QK:HFC-CLOSE-WITHIN-GENERATION] a close needs the SAME pane id AND the same terminal AND no agent session — measured: a server restart returns the same pane ids on different terminals, so a bare pane id is not authority to close anything",
		decideConditionalClose(split, same, false).close === true &&
			decideConditionalClose(
				split,
				parseHerdrPaneGetResponse(SPLIT_OK.replace("term_65b6e1ce2b3db16", "term_other")),
				false,
			).close === false &&
			decideConditionalClose(split, parseHerdrPaneGetResponse(SPLIT_OK.replace('"w7:p7"', '"w7:p9"')), false).close ===
				false,
	);
	const matrix: [ReturnType<typeof decideConditionalClose>, string][] = [
		[decideConditionalClose(split, null, true), "pane-get-failed"],
		[decideConditionalClose(split, null, false), "pane-get-unparsable"],
		[
			decideConditionalClose(split, parseHerdrPaneGetResponse(SPLIT_OK.replace('"w7:p7"', '"w7:p9"')), false),
			"pane-id-mismatch",
		],
		[
			decideConditionalClose(
				split,
				parseHerdrPaneGetResponse(SPLIT_OK.replace("term_65b6e1ce2b3db16", "term_other")),
				false,
			),
			"terminal-id-mismatch",
		],
		[
			decideConditionalClose(split, parseHerdrAgentStartResponse(START_OK)?.pane ?? null, false),
			"agent-session-present",
		],
	];
	ok(
		"[QK:HFC-ORPHAN-NAMED] every way the proof can fail has its OWN name — get failed, unreadable, wrong pane, wrong terminal, someone else's agent — because the operator's next move differs for each",
		matrix.every(([decision, reason]) => decision.close === false && decision.reason === reason) &&
			new Set(matrix.map(([, reason]) => reason)).size === 5,
	);

	const failing = scriptedRun([
		{ status: 0, stdout: SPLIT_OK },
		{ status: 1, stderr: START_ERR },
		{ status: 0, stdout: SPLIT_OK },
		{ status: 0 },
	]);
	const failed = herdrFreshCall({ ...base, backend: "claude-code", model: "opus" }, failing.run, HERDR_ENV, NONCE);
	ok(
		"a start that fails after the split reclaims the pane conditionally, quotes herdr's own error code, and reports the reclaim in the same breath",
		!failed.ok &&
			failed.reason === "herdr-agent-start-failed" &&
			"herdrErrorCode" in failed &&
			failed.herdrErrorCode === "invalid_agent_argument" &&
			"recovery" in failed &&
			failed.recovery.outcome === "closed" &&
			failing.calls.length === 4 &&
			failing.calls[3].join(" ") === "pane close w7:p7",
	);
	const stubborn = scriptedRun([
		{ status: 0, stdout: SPLIT_OK },
		{ status: 1, stderr: START_ERR },
		{ status: 0, stdout: SPLIT_OK.replace("term_65b6e1ce2b3db16", "term_other") },
	]);
	const orphaned = herdrFreshCall({ ...base, backend: "claude-code", model: "opus" }, stubborn.run, HERDR_ENV, NONCE);
	ok(
		"when the proof does not hold the pane is LEFT ALONE and named — three calls, no close attempted",
		!orphaned.ok &&
			"recovery" in orphaned &&
			orphaned.recovery.outcome === "orphan-unreclaimed" &&
			orphaned.recovery.reason === "terminal-id-mismatch" &&
			stubborn.calls.length === 3,
	);

	// ── the amendment cells: input parity and post-split binding ─────────────────────────
	ok(
		"[QK:HFC-INPUT-PARITY] the input contract is the SHARED one — same five words, same order, same trimming as the tmux rail — so a caller does not learn a different vocabulary by being inside herdr",
		(() => {
			const cases: [Parameters<typeof herdrFreshCall>[0], string][] = [
				[{ ...base, callerGardenId: null }, "caller-identity-unavailable"],
				[{ ...base, model: "   " }, "model-empty"],
				[{ ...base, model: "bad model" }, "model-invalid"],
				[{ ...base, task: "\t\n " }, "task-empty"],
				[{ ...base, task: "x".repeat(16001) }, "task-too-long"],
			];
			return cases.every(([params, expected]) => {
				const { run, calls } = neverRun();
				const result = herdrFreshCall(params, run, HERDR_ENV, NONCE);
				// The words AND the silence: an input refusal must also leave no pane behind.
				return !result.ok && result.reason === expected && calls.length === 0;
			});
		})() &&
			(() => {
				// The cap is the boundary, not a vibe: exactly at it the call proceeds to herdr.
				const { run, calls } = scriptedRun([{ status: 0, stdout: SPLIT_OK }, startReplyEchoingArgv(START_OK)]);
				const atCap = herdrFreshCall(
					{ ...base, backend: "claude-code", task: "x".repeat(16000) },
					run,
					HERDR_ENV,
					NONCE,
				);
				return atCap.ok && calls.length === 2;
			})(),
	);
	ok(
		"[QK:HFC-CWD-EMPTY-IS-OMITTED] an empty cwd means OMITTED, exactly as the public verb has always meant it — reading it as a path made a documented no-op into an invalid-directory refusal",
		(() => {
			const { run, calls } = scriptedRun([{ status: 0, stdout: SPLIT_OK }, startReplyEchoingArgv(START_OK)]);
			const result = herdrFreshCall({ ...base, backend: "claude-code", cwd: "" }, run, HERDR_ENV, NONCE);
			return result.ok && !calls[0].includes("--cwd") && !("cwd" in result.receipt);
		})(),
	);
	ok(
		"[QK:HFC-SPLIT-OCCUPIED] a split that came back holding an agent does NOT get started into — it is named, and the reclaim that follows correctly refuses to close somebody else's pane",
		(() => {
			const occupied = JSON.stringify({
				id: "cli:pane:split",
				result: { pane: JSON.parse(START_OK).result.agent, type: "pane_info" },
			});
			const { run, calls } = scriptedRun([
				{ status: 0, stdout: occupied },
				{ status: 0, stdout: occupied },
			]);
			const result = herdrFreshCall({ ...base, backend: "claude-code" }, run, HERDR_ENV, NONCE);
			return (
				!result.ok &&
				result.reason === "herdr-split-pane-occupied" &&
				"recovery" in result &&
				result.recovery.outcome === "orphan-unreclaimed" &&
				result.recovery.reason === "agent-session-present" &&
				!calls.some((call) => call[1] === "start")
			);
		})(),
	);
	ok(
		"[QK:HFC-START-PANE-BINDING] a start reporting a pane or terminal that is not the one we split is a NAMED failure, not a success — a green receipt would have pointed the caller at a coordinate that never held their sibling — and the reclaim still runs from the split receipt",
		(() => {
			const drifted = START_OK.replace('"w7:p7"', '"w7:p9"');
			const { run, calls } = scriptedRun([
				{ status: 0, stdout: SPLIT_OK },
				startReplyEchoingArgv(drifted),
				{ status: 0, stdout: SPLIT_OK },
				{ status: 0 },
			]);
			const result = herdrFreshCall({ ...base, backend: "claude-code" }, run, HERDR_ENV, NONCE);
			return (
				!result.ok &&
				result.reason === "herdr-agent-start-pane-drift" &&
				calls[2].join(" ") === "pane get w7:p7" &&
				calls[3].join(" ") === "pane close w7:p7"
			);
		})(),
	);
	ok(
		"[QK:HFC-START-WITNESS-REQUIRED] a start that succeeded WITHOUT an agent session is a named failure — herdr waits for detection before returning, so a missing witness means a launch nobody can identify, and presence is the whole claim we read",
		(() => {
			const witnessless = JSON.parse(START_OK);
			witnessless.result.agent.agent_session = null;
			const { run } = scriptedRun([
				{ status: 0, stdout: SPLIT_OK },
				startReplyEchoingArgv(JSON.stringify(witnessless)),
				{ status: 0, stdout: SPLIT_OK },
				{ status: 0 },
			]);
			const result = herdrFreshCall({ ...base, backend: "claude-code" }, run, HERDR_ENV, NONCE);
			return !result.ok && result.reason === "herdr-agent-start-witness-missing";
		})(),
	);
	ok(
		"[QK:HFC-START-ARGV-FIDELITY] the echoed argv must be the canonical executable plus EXACTLY the argv we passed after `--` — a sibling started with a different framing is one we did not compose, and nothing downstream would ever reveal it",
		(() => {
			const composed = JSON.parse(START_OK);
			const { run, calls } = scriptedRun([
				{ status: 0, stdout: SPLIT_OK },
				{
					status: 0,
					stdout: JSON.stringify({
						...composed,
						result: { ...composed.result, argv: ["claude", "SOMETHING-ELSE"] },
					}),
				},
				{ status: 0, stdout: SPLIT_OK },
				{ status: 0 },
			]);
			const drift = herdrFreshCall({ ...base, backend: "claude-code" }, run, HERDR_ENV, NONCE);
			const passed = calls[1].slice(calls[1].indexOf("--") + 1);
			return (
				!drift.ok &&
				drift.reason === "herdr-agent-start-argv-drift" &&
				argvMatchesRequest(["claude", ...passed], "claude-code", passed) &&
				!argvMatchesRequest(["claude"], "claude-code", passed) &&
				!argvMatchesRequest(null, "claude-code", passed) &&
				!argvMatchesRequest(["pi", ...passed], "claude-code", passed)
			);
		})(),
	);

	console.log(`\n[check-herdr-fresh-call] ${passed} assertions ok`);
}

main();
