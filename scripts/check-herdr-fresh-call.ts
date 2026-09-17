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
 * Every JSON literal below is a payload recorded from herdr 0.9.0 — the pane/tab replies on
 * 2026-09-15, the agent_started reply on 2026-09-14. Field sets and shapes are verbatim. Where
 * two replies have to describe the SAME sibling, the coordinates of the start recording are
 * carried into the tab recording, and that splice is stated here rather than implied: a fixture
 * whose two halves named different panes could not test the binding between them at all.
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
 *   HFC-CALLER-WORKSPACE        the caller's workspace comes from herdr's own answer about the
 *                               caller's own pane, never from parsing a pane id, and an
 *                               unusable answer refuses instead of defaulting
 *   HFC-CALLER-PANE-BOUND       that answer must be ABOUT the pane we asked about — a readable
 *                               reply describing another pane is refused by its own name
 *   HFC-TAB-HALVES-AGREE        the tab-create reply's two halves name the same tab and the
 *                               same workspace, and absent is disagreement, not optionality
 *   HFC-CREATE-OUTCOME-HONEST   a failed tab create says whether anything EXISTS, and never
 *                               spells "nothing happened" as an unreclaimed orphan
 *   HFC-TAB-ARGV                the one placement policy — a new tab in the caller's workspace,
 *                               focus left alone, cwd literal, identity scrubbed explicitly
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
 *   HFC-TAB-OCCUPIED            a new tab whose initial pane holds an agent does not get started into
 *   HFC-START-PANE-BINDING      a start that reports a different pane/terminal is a named failure
 *   HFC-START-WITNESS-REQUIRED  a start with no agent session is a named failure
 *   HFC-START-ARGV-FIDELITY     the echoed argv must be exactly what we asked herdr to compose
 *   HERDR-RUNNER-NONBLOCKING    a herdr call in flight does NOT hold the caller's event loop —
 *                               proved against a REAL child process while a REAL socket round
 *                               trip and a timer are serviced in the same process
 *   HERDR-RUNNER-TIMEOUT-KILLS  the bound kills the child and settles once, and the child is
 *                               observed dead afterwards
 *   HERDR-RUNNER-OUTPUT-BOUNDED a runaway child is cut off at the cap instead of being buffered
 *                               without limit
 */

import assert from "node:assert/strict";
import { type ChildProcess, spawn } from "node:child_process";
import * as fs from "node:fs";
import * as net from "node:net";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { composeFreshCallFraming } from "../pi-extensions/lib/fresh-call-composition.ts";
import {
	argvMatchesRequest,
	buildHerdrAgentStartArgs,
	buildHerdrPaneCloseArgs,
	buildHerdrPaneGetArgs,
	buildHerdrTabCreateArgs,
	containsControlChar,
	createHerdrRunner,
	decideConditionalClose,
	encodeBirthPrompt,
	HERDR_CLI_TIMEOUT_MS,
	HERDR_FRESH_CALL_BACKENDS,
	HERDR_FRESH_CALL_OPENING_LINE,
	HERDR_MAX_OUTPUT_BYTES,
	HERDR_START_TIMEOUT_MS,
	HERDR_TASK_LITERAL_INSTRUCTION,
	type HerdrRun,
	herdrAgentNameFromNonce,
	herdrFreshCall,
	parseHerdrAgentStartResponse,
	parseHerdrPaneGetResponse,
	parseHerdrTabCreateResponse,
	readHerdrErrorCode,
	rejectTmuxPlacementInHerdrContext,
	renderHerdrFreshCall,
	type SpawnFn,
} from "../pi-extensions/lib/herdr-fresh-call.ts";

const REPO_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MODULE = "pi-extensions/lib/herdr-fresh-call.ts";
const MODULE_SRC = fs.readFileSync(path.join(REPO_DIR, MODULE), "utf8");

let passed = 0;
function ok(label: string, cond: boolean): void {
	assert.ok(cond, label);
	console.log(`  ok    ${label}`);
	passed++;
}

/** Verbatim `tab create` reply shape, herdr 0.9.0, 2026-09-15 — the new tab AND its initial pane
 * in one reply, which is why this rail never goes looking for "the new one". */
const TAB_OK = JSON.stringify({
	id: "cli:tab:create",
	result: {
		root_pane: {
			agent_status: "unknown",
			cwd: "/home/junghan/repos/gh/entwurf",
			focused: false,
			pane_id: "w7:p7",
			revision: 0,
			tab_id: "w7:t1",
			terminal_id: "term_65b6e1ce2b3db16",
			workspace_id: "w7",
		},
		tab: {
			agent_status: "unknown",
			focused: false,
			label: "1",
			number: 1,
			pane_count: 1,
			tab_id: "w7:t1",
			workspace_id: "w7",
		},
		type: "tab_created",
	},
});

/** Verbatim `pane get` reply shape, same day. Used for BOTH reads this rail makes: the caller's
 * own pane (where the workspace comes from) and the reclaim's within-generation proof. */
const PANE_OK = JSON.stringify({
	id: "cli:pane:get",
	result: {
		pane: {
			agent_status: "unknown",
			cwd: "/home/junghan/repos/gh/entwurf",
			focused: true,
			pane_id: "w7:p7",
			revision: 1,
			tab_id: "w7:t1",
			terminal_id: "term_65b6e1ce2b3db16",
			workspace_id: "w7",
		},
		type: "pane_info",
	},
});

/** The CALLER's own pane — a different pane in the same workspace, which is the whole point. */
const CALLER_PANE_OK = PANE_OK.replace('"w7:p7"', '"w7:p1"').replace("term_65b6e1ce2b3db16", "term_65b6e1ce2b3db00");

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
		// A PROMISE, like the production runner: the rail must await every herdr call, and a
		// fixture that answered synchronously would let a blocking regression stay green here.
		return Promise.resolve({ status: reply.status, stdout: reply.stdout ?? "", stderr: reply.stderr ?? "" });
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
		return Promise.resolve({ status: 1, stdout: "", stderr: "" });
	};
	return { run, calls };
}

async function main(): Promise<void> {
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
	// The reject-hint table is caller-facing prose whose JOB is to explain the tmux-seat refusal,
	// so it is excluded from the scan the same way comments are: what must not contain tmux is the
	// launch path, not the sentence telling an operator why their seat was refused.
	const hintTable = code.slice(code.indexOf("const HERDR_REJECT_HINT"), code.indexOf("function renderRecovery"));
	const tmuxLines = code
		.replace(hintTable, "")
		.split("\n")
		.filter((line) => /tmux/i.test(line));
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
	//
	// WHAT MOVED HERE (#116, 2026-09-17). The whole first turn used to be one JSON literal behind
	// "follow the decoded instructions", and `[GLG 직접, 날것 PC]` a Sonnet 5 sibling refused exactly
	// that shape. Now the FRAMING is folded to one line as prose and only the operator's TASK is a
	// literal, so the round-trip claim is about the task — which is the half that actually carries
	// bytes somebody wrote — while the framing gets its own claim about surviving the fold verbatim.
	const FRAMING = composeFreshCallFraming({
		backend: "claude-code",
		callerGardenId: "20260101T010101-aaaaaa",
		nonce: "mux-fresh-call-deadbeefdeadbeefdeadbeef",
		openingLine: HERDR_FRESH_CALL_OPENING_LINE,
	});
	const decodeOrNull = (task: string): string | null => {
		try {
			const result = encodeBirthPrompt(FRAMING, task);
			if (!result.ok) return null;
			const at = result.argv.indexOf(HERDR_TASK_LITERAL_INSTRUCTION);
			if (at === -1) return null;
			const decoded: unknown = JSON.parse(result.argv.slice(at + HERDR_TASK_LITERAL_INSTRUCTION.length));
			return typeof decoded === "string" ? decoded : null;
		} catch {
			return null;
		}
	};
	const argvOrNull = (task: string): string | null => {
		try {
			const result = encodeBirthPrompt(FRAMING, task);
			return result.ok ? result.argv : null;
		} catch {
			return null;
		}
	};

	const multiline = 'line one\nline two\ttabbed\n"quoted" and \\backslash\n한글 — em dash';
	ok(
		"[QK:HFC-ENCODE-ROUNDTRIP] the operator's TASK decodes back byte for byte — every newline, tab, quote, backslash and non-ASCII character, with no trim and no normalisation",
		decodeOrNull(multiline) === multiline,
	);
	const plainArgv = argvOrNull("do the thing");
	ok(
		"[QK:HFC-FRAMING-IS-PROSE] the framing rides as PLAIN PROSE folded onto one line — every composed sentence survives the fold verbatim and in order, and nothing asks the sibling to decode its instructions",
		plainArgv !== null &&
			FRAMING.filter((line) => line.length > 0).every((line) => plainArgv.includes(line)) &&
			FRAMING.filter((line) => line.length > 0).reduce<{ ok: boolean; at: number }>(
				(acc, line) => {
					const at = plainArgv.indexOf(line, acc.at);
					return { ok: acc.ok && at >= acc.at, at: at + line.length };
				},
				{ ok: true, at: 0 },
			).ok &&
			!/decoded instructions|as if they were this message/i.test(plainArgv) &&
			!/Do not inspect environment variables/i.test(plainArgv),
	);
	const c1Task = "head\u0085middle\u009fdel\u007ftail";
	const c1Argv = argvOrNull(c1Task);
	ok(
		"[QK:HFC-ENCODE-NO-CONTROL] the whole argv carries zero Unicode Cc — JSON.stringify leaves DEL and the C1 block LITERAL, and herdr refuses an argument containing any of them",
		containsControlChar(c1Task) && c1Argv !== null && !containsControlChar(c1Argv) && decodeOrNull(c1Task) === c1Task,
	);
	// A control character in the FRAMING is the rail's own input, not the caller's — it is refused
	// rather than escaped, because the framing is prose and an escape would be read as text.
	ok(
		"[QK:HFC-FRAMING-CONTROL-REFUSED] a control character in the rail's own framing is a named refusal, never silently escaped into the prose a sibling reads",
		(() => {
			const bad = encodeBirthPrompt([...FRAMING, "tail\u0007bell"], "task");
			return !bad.ok && bad.reason === "herdr-argv-control-character";
		})(),
	);
	// 16000 is the public task cap the delivery surface mirrors; the worst case is every
	// character needing a six-byte \uXXXX escape.
	const maxTask = "\n한\u009f".repeat(5333) + "a";
	const maxArgv = argvOrNull(maxTask);
	ok(
		"[QK:HFC-ENCODE-MAX-TASK] a maximum-length public task encodes, stays Cc-free and still round-trips — the escape pass has no length cliff",
		maxTask.length === 16000 && maxArgv !== null && !containsControlChar(maxArgv) && decodeOrNull(maxTask) === maxTask,
	);

	// ── argv grammar ─────────────────────────────────────────────────────────────────────
	// Pure builders are checked before full launch paths so a framing mutant is attributed to
	// its own contract rather than making an earlier integration success cell fail first.
	const tabArgs = buildHerdrTabCreateArgs({ workspaceId: "w7", cwd: "/repo/dir" });
	ok(
		"[QK:HFC-TAB-ARGV] one placement policy — a NEW TAB in the caller's own workspace, named explicitly so herdr cannot default it to the focused one, focus left alone, cwd carried literally, and BOTH identity carriers scrubbed by explicit repeated --env",
		tabArgs.join(" ") ===
			"tab create --workspace w7 --no-focus --cwd /repo/dir --env PI_SESSION_ID= --env PI_AGENT_ID=",
	);
	ok(
		"a cwd-free tab create omits --cwd entirely rather than sending an empty value, and the rail adds no layout axis of its own — no label, no ratio, no direction",
		!buildHerdrTabCreateArgs({ workspaceId: "w7" }).includes("--cwd") &&
			!tabArgs.includes("--label") &&
			!tabArgs.includes("--ratio") &&
			!tabArgs.includes("--direction"),
	);
	const startArgs = buildHerdrAgentStartArgs({
		agentName: "entwurf-abc",
		kind: "claude",
		paneId: "w7:pA",
		backendArgs: ["PROMPT", "--model=opus"],
	});
	ok(
		"[QK:HFC-START-ARGV] the backend's own argv rides after `--`, under the REQUESTED kind and the initial pane of the tab just created",
		startArgs.join(" ") === "agent start entwurf-abc --kind claude --pane w7:pA -- PROMPT --model=opus",
	);
	ok(
		"pane get and pane close take a POSITIONAL pane id — measured: `--pane` is a usage error on both",
		buildHerdrPaneGetArgs("w7:pA").join(" ") === "pane get w7:pA" &&
			buildHerdrPaneCloseArgs("w7:pA").join(" ") === "pane close w7:pA",
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
		["caller pane", { ...base }, { HERDR_ENV: "1", HERDR_BIN_PATH: "/x/herdr" }, "herdr-caller-pane-missing"],
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
		const result = await herdrFreshCall(params, run, env, NONCE);
		if (result.ok || result.reason !== expected || calls.length !== 0) everyRefusalPreMutation = false;
	}
	ok(
		"[QK:HFC-PREMUTATION-ONLY] the rail-shaped refusals — context, caller pane, backend, tmux seat, cwd — are decided with the herdr CLI never invoked, so a refused call leaves no tab behind",
		everyRefusalPreMutation,
	);

	// ── where the sibling is placed comes from herdr, not from a pane id's shape ─────────
	ok(
		"[QK:HFC-CALLER-PANE-BOUND] the caller pane-get answer must be ABOUT the pane we asked about — a readable reply describing a DIFFERENT pane is refused by its own name rather than folded into `unparsable`, because its workspace is not evidence about this caller and believing it is the same silent relocation, arriving through the read instead of through an omitted --workspace",
		await (async () => {
			const { run, calls } = scriptedRun([{ status: 0, stdout: PANE_OK }]);
			const drifted = await herdrFreshCall({ ...base, backend: "claude-code" }, run, HERDR_ENV, NONCE);
			return (
				!drifted.ok &&
				drifted.reason === "herdr-caller-pane-drift" &&
				calls.length === 1 &&
				calls[0].join(" ") === "pane get w7:p1"
			);
		})(),
	);

	ok(
		"[QK:HFC-CALLER-WORKSPACE] the new tab's workspace is read from herdr's OWN answer about the caller's own pane — and when that answer is unusable the call REFUSES, because omitting --workspace still succeeds and puts the sibling in whatever workspace happens to be focused",
		await (async () => {
			const cases: [ScriptedReply, string][] = [
				[
					{ status: 1, stderr: '{"error":{"code":"pane_not_found"},"id":"cli:pane:get"}' },
					"herdr-caller-pane-get-failed",
				],
				[{ status: 0, stdout: "usage: herdr pane get <pane_id>" }, "herdr-caller-pane-unparsable"],
				[
					{ status: 0, stdout: CALLER_PANE_OK.replace(',"workspace_id":"w7"', "").replace('"workspace_id":"w7",', "") },
					"herdr-caller-workspace-missing",
				],
			];
			for (const [reply, expected] of cases) {
				const { run, calls } = scriptedRun([reply]);
				const result = await herdrFreshCall({ ...base, backend: "claude-code" }, run, HERDR_ENV, NONCE);
				// Exactly ONE herdr call, and it is the read. Nothing was created to reclaim, which
				// is why these are refusals and not launch failures.
				if (result.ok || result.reason !== expected) return false;
				if (calls.length !== 1 || calls.join(" ") !== "pane,get,w7:p1") return false;
			}
			// And on the happy path the workspace herdr reported is the one --workspace carries.
			const { run, calls } = scriptedRun([
				{ status: 0, stdout: CALLER_PANE_OK },
				{ status: 0, stdout: TAB_OK },
				startReplyEchoingArgv(START_OK),
			]);
			const okResult = await herdrFreshCall({ ...base, backend: "claude-code" }, run, HERDR_ENV, NONCE);
			return (
				okResult.ok &&
				calls[0].join(" ") === "pane get w7:p1" &&
				calls[1].slice(0, 4).join(" ") === "tab create --workspace w7" &&
				okResult.receipt.herdrWorkspaceId === "w7"
			);
		})(),
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
	const tab = parseHerdrTabCreateResponse(TAB_OK);
	ok(
		"[QK:HFC-PARSE-STRICT] a payload missing any coordinate a launch needs is DECLINED whole — a half-read reply is how a launch starts believing a coordinate it never got",
		tab !== null &&
			tab.tabId === "w7:t1" &&
			tab.workspaceId === "w7" &&
			tab.rootPane.paneId === "w7:p7" &&
			tab.rootPane.terminalId === "term_65b6e1ce2b3db16" &&
			parseHerdrTabCreateResponse('{"id":"cli:tab:create","result":{"root_pane":{"pane_id":"w7:p7"}}}') === null &&
			// An EMPTY coordinate is not a coordinate. A present-but-blank field reads as
			// "herdr answered" to a `typeof` check alone, and would travel into the receipt as
			// a terminal id no conditional close could ever match.
			parseHerdrTabCreateResponse(TAB_OK.replace("term_65b6e1ce2b3db16", "")) === null &&
			parseHerdrTabCreateResponse(TAB_OK.replace('"w7:p7"', '""')) === null &&
			// The tab half, held to the same standard as the pane half.
			parseHerdrTabCreateResponse(TAB_OK.replace(/"tab_id":"w7:t1","workspace_id":"w7"\}/, '"tab_id":"w7:t1"}')) ===
				null &&
			parseHerdrTabCreateResponse(
				TAB_OK.replace('"tab_id":"w7:t1","workspace_id":"w7"}', '"tab_id":"","workspace_id":"w7"}'),
			) === null &&
			parseHerdrTabCreateResponse("usage: herdr tab create [OPTIONS]") === null &&
			parseHerdrTabCreateResponse("") === null &&
			parseHerdrPaneGetResponse(PANE_OK)?.paneId === "w7:p7" &&
			parseHerdrPaneGetResponse("") === null,
	);
	const started = parseHerdrAgentStartResponse(START_OK);
	ok(
		"the agent_started reply yields the same pane facts, and agent_session is read as PRESENCE only",
		started !== null && started.pane.paneId === "w7:p7" && started.pane.hasAgentSession === true,
	);
	ok(
		"[QK:HFC-TAB-HALVES-AGREE] the tab-create reply's two halves must name the SAME tab and the SAME workspace, and both must SAY so — absent is disagreement, not optionality, because a reply that names a tab only once cannot be checked against itself and assembling it is how a launch starts in one tab while the receipt names another",
		parseHerdrTabCreateResponse(TAB_OK) !== null &&
			// root_pane says one tab, tab says another.
			parseHerdrTabCreateResponse(
				TAB_OK.replace('"tab_id":"w7:t1","terminal_id"', '"tab_id":"w7:t9","terminal_id"'),
			) === null &&
			// …and the same for the workspace, in BOTH directions of disagreement.
			parseHerdrTabCreateResponse(
				TAB_OK.replace(
					'"terminal_id":"term_65b6e1ce2b3db16","workspace_id":"w7"',
					'"terminal_id":"term_65b6e1ce2b3db16","workspace_id":"w9"',
				),
			) === null &&
			// ABSENT on the root pane is not "optional", it is disagreement: a reply that names a
			// tab only once cannot be checked against itself, and believing it is how a launch
			// starts in one tab while the receipt names another.
			parseHerdrTabCreateResponse(TAB_OK.replace('"tab_id":"w7:t1","terminal_id"', '"terminal_id"')) === null &&
			parseHerdrTabCreateResponse(
				TAB_OK.replace(
					'"terminal_id":"term_65b6e1ce2b3db16","workspace_id":"w7"',
					'"terminal_id":"term_65b6e1ce2b3db16"',
				),
			) === null,
	);

	const opaque = parseHerdrTabCreateResponse(TAB_OK.replace('"w7:p7"', '"w7:pA"'));
	ok(
		"[QK:HFC-PANE-ID-OPAQUE] a `pA`-style pane id survives byte-identical — measured: the tenth pane is `w7:pA`, not `w7:p10`, so any decimal parser is already wrong, and this rail reads the workspace out of herdr's reply rather than off the front of an id",
		opaque !== null && opaque.rootPane.paneId === "w7:pA",
	);
	ok(
		"herdr's own error code is quoted out of its envelope rather than retyped into a vocabulary of ours that would go stale",
		readHerdrErrorCode(START_ERR) === "invalid_agent_argument" &&
			readHerdrErrorCode("usage: herdr agent start") === undefined,
	);

	// ── the launch, and what its receipt may say ─────────────────────────────────────────
	const { run, calls } = scriptedRun([
		{ status: 0, stdout: CALLER_PANE_OK },
		{ status: 0, stdout: TAB_OK },
		startReplyEchoingArgv(START_OK),
	]);
	const launched = await herdrFreshCall({ ...base, backend: "claude-code", model: "opus" }, run, HERDR_ENV, NONCE);
	const receipt = launched.ok ? launched.receipt : null;
	const receiptText = JSON.stringify(receipt ?? {});
	ok(
		"[QK:HFC-RECEIPT-NO-ADDRESS] the launch receipt carries the view and what was requested — and no garden id, no native session id, no screen text and none of herdr's own readiness judgements",
		receipt !== null &&
			receipt.herdrTabId === "w7:t1" &&
			receipt.herdrWorkspaceId === "w7" &&
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
		"the launch is one read and exactly two mutations — caller pane get, tab create, agent start — with the encoded one-line prompt as the first backend argument",
		calls.length === 3 &&
			calls[0].join(" ") === "pane get w7:p1" &&
			calls[1][1] === "create" &&
			calls[2][1] === "start" &&
			calls[2][calls[2].indexOf("--") + 1].startsWith(HERDR_FRESH_CALL_OPENING_LINE) &&
			calls[2][calls[2].indexOf("--") + 1].includes(HERDR_TASK_LITERAL_INSTRUCTION) &&
			!containsControlChar(calls[2][calls[2].indexOf("--") + 1]),
	);

	// ── conditional close ────────────────────────────────────────────────────────────────
	const created = { paneId: "w7:p7", terminalId: "term_65b6e1ce2b3db16" };
	const same = parseHerdrPaneGetResponse(PANE_OK);
	ok(
		"[QK:HFC-CLOSE-WITHIN-GENERATION] a close needs the SAME pane id AND the same terminal AND no agent session — measured: a server restart returns the same pane ids on different terminals, so a bare pane id is not authority to close anything",
		decideConditionalClose(created, same, false).close === true &&
			decideConditionalClose(
				created,
				parseHerdrPaneGetResponse(PANE_OK.replace("term_65b6e1ce2b3db16", "term_other")),
				false,
			).close === false &&
			decideConditionalClose(created, parseHerdrPaneGetResponse(PANE_OK.replace('"w7:p7"', '"w7:p9"')), false).close ===
				false,
	);
	const matrix: [ReturnType<typeof decideConditionalClose>, string][] = [
		[decideConditionalClose(created, null, true), "pane-get-failed"],
		[decideConditionalClose(created, null, false), "pane-get-unparsable"],
		[
			decideConditionalClose(created, parseHerdrPaneGetResponse(PANE_OK.replace('"w7:p7"', '"w7:p9"')), false),
			"pane-id-mismatch",
		],
		[
			decideConditionalClose(
				created,
				parseHerdrPaneGetResponse(PANE_OK.replace("term_65b6e1ce2b3db16", "term_other")),
				false,
			),
			"terminal-id-mismatch",
		],
		[
			decideConditionalClose(created, parseHerdrAgentStartResponse(START_OK)?.pane ?? null, false),
			"agent-session-present",
		],
	];
	ok(
		"[QK:HFC-ORPHAN-NAMED] every way the proof can fail has its OWN name — get failed, unreadable, wrong pane, wrong terminal, someone else's agent — because the operator's next move differs for each",
		matrix.every(([decision, reason]) => decision.close === false && decision.reason === reason) &&
			new Set(matrix.map(([, reason]) => reason)).size === 5,
	);

	const failing = scriptedRun([
		{ status: 0, stdout: CALLER_PANE_OK },
		{ status: 0, stdout: TAB_OK },
		{ status: 1, stderr: START_ERR },
		{ status: 0, stdout: PANE_OK },
		{ status: 0 },
	]);
	const failed = await herdrFreshCall(
		{ ...base, backend: "claude-code", model: "opus" },
		failing.run,
		HERDR_ENV,
		NONCE,
	);
	ok(
		"a start that fails after the tab was created reclaims the pane conditionally, quotes herdr's own error code, and reports the reclaim in the same breath — and the close is the PANE we own, never `tab close`, which takes a bare tab id and would take a stranger's pane with it",
		!failed.ok &&
			failed.reason === "herdr-agent-start-failed" &&
			"herdrErrorCode" in failed &&
			failed.herdrErrorCode === "invalid_agent_argument" &&
			"recovery" in failed &&
			failed.recovery.outcome === "closed" &&
			failing.calls.length === 5 &&
			failing.calls[4].join(" ") === "pane close w7:p7" &&
			!failing.calls.some((call) => call[0] === "tab" && call[1] === "close"),
	);
	ok(
		"[QK:HFC-CREATE-OUTCOME-HONEST] a failed tab create reports whether anything EXISTS, and the header never claims more than the recovery knows — herdr's OWN error envelope means it declined before making a tab (`none`), while a nonzero status with no envelope is OUR bound cutting the call off and a tab MAY be sitting there (`unknown`), as is a reply we could not read",
		await (async () => {
			// herdr declined by name: envelope present, quoted, nothing created.
			const declined = scriptedRun([
				{ status: 0, stdout: CALLER_PANE_OK },
				{
					status: 1,
					stderr: '{"error":{"code":"workspace_not_found","message":"workspace w7 not found"},"id":"cli:tab:create"}',
				},
			]);
			const none = await herdrFreshCall({ ...base, backend: "claude-code" }, declined.run, HERDR_ENV, NONCE);
			if (none.ok || none.reason !== "herdr-tab-create-failed") return false;
			if (!("recovery" in none) || none.recovery.outcome !== "none") return false;
			if (!("herdrErrorCode" in none) || none.herdrErrorCode !== "workspace_not_found") return false;
			// No close was attempted for something that does not exist.
			if (declined.calls.length !== 2) return false;
			const noneText = renderHerdrFreshCall(none).text;
			if (!noneText.includes("recovery: none") || noneText.includes("orphan-unreclaimed")) return false;
			// The header must not say the tab was created when the hint says it was not.
			if (noneText.includes("failed after the tab was created")) return false;

			// OUR bound, not herdr's answer: the production runner reports a timeout/kill as the
			// same nonzero status with a PLAIN-TEXT stderr. A tab may exist.
			const cutOff = scriptedRun([
				{ status: 0, stdout: CALLER_PANE_OK },
				{ status: 1, stderr: "herdr tab create --workspace w7: no exit status (timeout 30000ms or signal null)" },
			]);
			const unknown = await herdrFreshCall({ ...base, backend: "claude-code" }, cutOff.run, HERDR_ENV, NONCE);
			if (unknown.ok || unknown.reason !== "herdr-tab-create-failed") return false;
			if (!("recovery" in unknown) || unknown.recovery.outcome !== "unknown") return false;
			if ("herdrErrorCode" in unknown && unknown.herdrErrorCode !== undefined) return false;
			const unknownText = renderHerdrFreshCall(unknown).text;
			if (!unknownText.includes("UNKNOWN") || unknownText.includes("orphan-unreclaimed")) return false;

			// A readable status-0 reply we could not parse is the same honesty: may exist.
			const garbled = scriptedRun([
				{ status: 0, stdout: CALLER_PANE_OK },
				{ status: 0, stdout: '{"id":"cli:tab:create","result":{"tab":{"tab_id":"w7:t1"}}}' },
			]);
			const unread = await herdrFreshCall({ ...base, backend: "claude-code" }, garbled.run, HERDR_ENV, NONCE);
			return (
				!unread.ok &&
				unread.reason === "herdr-tab-create-unparsable" &&
				"recovery" in unread &&
				unread.recovery.outcome === "unknown" &&
				garbled.calls.length === 2
			);
		})(),
	);

	const stubborn = scriptedRun([
		{ status: 0, stdout: CALLER_PANE_OK },
		{ status: 0, stdout: TAB_OK },
		{ status: 1, stderr: START_ERR },
		{ status: 0, stdout: PANE_OK.replace("term_65b6e1ce2b3db16", "term_other") },
	]);
	const orphaned = await herdrFreshCall(
		{ ...base, backend: "claude-code", model: "opus" },
		stubborn.run,
		HERDR_ENV,
		NONCE,
	);
	ok(
		"when the proof does not hold the pane is LEFT ALONE and named — four calls, no close of any kind attempted",
		!orphaned.ok &&
			"recovery" in orphaned &&
			orphaned.recovery.outcome === "orphan-unreclaimed" &&
			orphaned.recovery.reason === "terminal-id-mismatch" &&
			stubborn.calls.length === 4 &&
			!stubborn.calls.some((call) => call[1] === "close"),
	);

	// ── the amendment cells: input parity and post-create binding ───────────────────────
	ok(
		"[QK:HFC-INPUT-PARITY] the input contract is the SHARED one — same five words, same order, same trimming as the tmux rail — so a caller does not learn a different vocabulary by being inside herdr",
		(await (async () => {
			const cases: [Parameters<typeof herdrFreshCall>[0], string][] = [
				[{ ...base, callerGardenId: null }, "caller-identity-unavailable"],
				[{ ...base, model: "   " }, "model-empty"],
				[{ ...base, model: "bad model" }, "model-invalid"],
				[{ ...base, task: "\t\n " }, "task-empty"],
				[{ ...base, task: "x".repeat(16001) }, "task-too-long"],
			];
			for (const [params, expected] of cases) {
				const { run, calls } = neverRun();
				const result = await herdrFreshCall(params, run, HERDR_ENV, NONCE);
				// The words AND the silence: an input refusal must also leave no pane behind.
				if (result.ok || result.reason !== expected || calls.length !== 0) return false;
			}
			return true;
		})()) &&
			(await (async () => {
				// The cap is the boundary, not a vibe: exactly at it the call proceeds to herdr.
				const { run, calls } = scriptedRun([
					{ status: 0, stdout: CALLER_PANE_OK },
					{ status: 0, stdout: TAB_OK },
					startReplyEchoingArgv(START_OK),
				]);
				const atCap = await herdrFreshCall(
					{ ...base, backend: "claude-code", task: "x".repeat(16000) },
					run,
					HERDR_ENV,
					NONCE,
				);
				return atCap.ok && calls.length === 3;
			})()),
	);
	ok(
		"[QK:HFC-CWD-EMPTY-IS-OMITTED] an empty cwd means OMITTED, exactly as the public verb has always meant it — reading it as a path made a documented no-op into an invalid-directory refusal",
		await (async () => {
			const { run, calls } = scriptedRun([
				{ status: 0, stdout: CALLER_PANE_OK },
				{ status: 0, stdout: TAB_OK },
				startReplyEchoingArgv(START_OK),
			]);
			const result = await herdrFreshCall({ ...base, backend: "claude-code", cwd: "" }, run, HERDR_ENV, NONCE);
			return result.ok && !calls[1].includes("--cwd") && !("cwd" in result.receipt);
		})(),
	);
	ok(
		"[QK:HFC-TAB-OCCUPIED] a brand-new tab whose initial pane came back holding an agent does NOT get started into — it is named, and the reclaim that follows correctly refuses to close somebody else's pane",
		await (async () => {
			const agent = JSON.parse(START_OK).result.agent;
			const occupiedTab = JSON.stringify({
				id: "cli:tab:create",
				result: { root_pane: agent, tab: { tab_id: "w7:t1", workspace_id: "w7" }, type: "tab_created" },
			});
			const occupiedPane = JSON.stringify({ id: "cli:pane:get", result: { pane: agent, type: "pane_info" } });
			const { run, calls } = scriptedRun([
				{ status: 0, stdout: CALLER_PANE_OK },
				{ status: 0, stdout: occupiedTab },
				{ status: 0, stdout: occupiedPane },
			]);
			const result = await herdrFreshCall({ ...base, backend: "claude-code" }, run, HERDR_ENV, NONCE);
			return (
				!result.ok &&
				result.reason === "herdr-tab-root-pane-occupied" &&
				"recovery" in result &&
				result.recovery.outcome === "orphan-unreclaimed" &&
				result.recovery.reason === "agent-session-present" &&
				!calls.some((call) => call[1] === "start")
			);
		})(),
	);
	ok(
		"[QK:HFC-START-PANE-BINDING] a start reporting a pane, terminal OR TAB that is not the one we created is a NAMED failure, not a success — the whole point of this placement policy is which tab the sibling is in — and the reclaim still runs from the tab-create receipt",
		await (async () => {
			const drifts = [
				START_OK.replace('"w7:p7"', '"w7:p9"'),
				START_OK.replace("term_65b6e1ce2b3db16", "term_other"),
				START_OK.replace('"w7:t1"', '"w7:t9"'),
			];
			for (const drifted of drifts) {
				const { run, calls } = scriptedRun([
					{ status: 0, stdout: CALLER_PANE_OK },
					{ status: 0, stdout: TAB_OK },
					startReplyEchoingArgv(drifted),
					{ status: 0, stdout: PANE_OK },
					{ status: 0 },
				]);
				const result = await herdrFreshCall({ ...base, backend: "claude-code" }, run, HERDR_ENV, NONCE);
				if (result.ok || result.reason !== "herdr-agent-start-pane-drift") return false;
				if (calls[3].join(" ") !== "pane get w7:p7" || calls[4].join(" ") !== "pane close w7:p7") return false;
			}
			return true;
		})(),
	);
	ok(
		"[QK:HFC-START-WITNESS-REQUIRED] a start that succeeded WITHOUT an agent session is a named failure — herdr waits for detection before returning, so a missing witness means a launch nobody can identify, and presence is the whole claim we read",
		await (async () => {
			const witnessless = JSON.parse(START_OK);
			witnessless.result.agent.agent_session = null;
			const { run } = scriptedRun([
				{ status: 0, stdout: CALLER_PANE_OK },
				{ status: 0, stdout: TAB_OK },
				startReplyEchoingArgv(JSON.stringify(witnessless)),
				{ status: 0, stdout: PANE_OK },
				{ status: 0 },
			]);
			const result = await herdrFreshCall({ ...base, backend: "claude-code" }, run, HERDR_ENV, NONCE);
			return !result.ok && result.reason === "herdr-agent-start-witness-missing";
		})(),
	);
	ok(
		"[QK:HFC-START-ARGV-FIDELITY] the echoed argv must be the canonical executable plus EXACTLY the argv we passed after `--` — a sibling started with a different framing is one we did not compose, and nothing downstream would ever reveal it",
		await (async () => {
			const composed = JSON.parse(START_OK);
			const { run, calls } = scriptedRun([
				{ status: 0, stdout: CALLER_PANE_OK },
				{ status: 0, stdout: TAB_OK },
				{
					status: 0,
					stdout: JSON.stringify({
						...composed,
						result: { ...composed.result, argv: ["claude", "SOMETHING-ELSE"] },
					}),
				},
				{ status: 0, stdout: PANE_OK },
				{ status: 0 },
			]);
			const drift = await herdrFreshCall({ ...base, backend: "claude-code" }, run, HERDR_ENV, NONCE);
			const passed = calls[2].slice(calls[2].indexOf("--") + 1);
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

	// ── the scheduling cells: the runner must not hold the caller's event loop ───────────
	// `[측정 2026-09-14, C4 첫 LIVE]` the child's FIRST act is a callback onto the caller's control
	// socket, and on this rail the caller is inside `agent start` when it arrives. A synchronous
	// child wait made that callback unreadable until the wait ended. These cells drive the REAL
	// production runner with a REAL child process (`node`, not a herdr stand-in) and watch what the
	// same process manages to do while it is in flight. "The function says async" proves nothing
	// and is not asserted anywhere below.
	{
		// A real unix socket, so the thing being serviced mid-call is actual IO, not a timer alone.
		const socketDir = fs.mkdtempSync(path.join(os.tmpdir(), "herdr-runner-"));
		const socketPath = path.join(socketDir, "s.sock");
		const server = net.createServer((socket) => socket.end("pong\n"));
		await new Promise<void>((resolve) => server.listen(socketPath, resolve));
		const spawned: ChildProcess[] = [];
		const recordingSpawn: SpawnFn = (bin, args, opts) => {
			const child = spawn(bin, args, opts);
			spawned.push(child);
			return child as unknown as ReturnType<SpawnFn>;
		};
		try {
			// ── NONBLOCKING ──────────────────────────────────────────────────────────────
			{
				const run = createHerdrRunner(process.execPath, process.env, recordingSpawn);
				const started = Date.now();
				let timerFiredAt: number | null = null;
				let socketAnsweredAt: number | null = null;
				setTimeout(() => {
					timerFiredAt = Date.now();
				}, 20);
				const socketDone = new Promise<void>((resolve) => {
					const client = net.createConnection(socketPath, () => {
						client.on("data", () => {
							socketAnsweredAt = Date.now();
							client.end();
							resolve();
						});
					});
				});
				// ~1.2s of real child, chosen so both observations must land WHILE it runs.
				const result = await run(["-e", "setTimeout(() => process.stdout.write('done'), 1200)"]);
				const resolvedAt = Date.now();
				await socketDone;
				ok(
					"[QK:HERDR-RUNNER-NONBLOCKING] while a real herdr child is in flight the caller's loop keeps serving: a 20ms timer and a real unix-socket round trip BOTH completed before the call resolved, and the timer's latency stayed bounded — a synchronous child wait is exactly what made the C4 sibling's first callback unreadable" +
						` — child=${resolvedAt - started}ms timer=${timerFiredAt === null ? "never" : timerFiredAt - started}ms socket=${socketAnsweredAt === null ? "never" : socketAnsweredAt - started}ms`,
					result.status === 0 &&
						result.stdout === "done" &&
						timerFiredAt !== null &&
						socketAnsweredAt !== null &&
						timerFiredAt < resolvedAt &&
						socketAnsweredAt < resolvedAt &&
						timerFiredAt - started < 600,
				);
			}

			// ── TIMEOUT KILLS ────────────────────────────────────────────────────────────
			{
				// The bounds are injected ONLY to reach the kill inside a gate's patience; the
				// numbers production runs under are the exported constants, asserted below.
				const run = createHerdrRunner(process.execPath, process.env, recordingSpawn, {
					startMs: 150,
					cliMs: 150,
					maxOutputBytes: HERDR_MAX_OUTPUT_BYTES,
				});
				const before = spawned.length;
				const result = await run(["-e", "setTimeout(() => {}, 60000)"]);
				const child = spawned[before];
				// The child must be GONE, not merely abandoned: a bound that stops waiting while
				// the child keeps a pane is a bound we only claimed to have.
				let alive = true;
				for (let i = 0; i < 100 && alive; i++) {
					await new Promise<void>((resolve) => setTimeout(resolve, 10));
					try {
						process.kill(child!.pid!, 0);
					} catch {
						alive = false;
					}
				}
				ok(
					"[QK:HERDR-RUNNER-TIMEOUT-KILLS] a child that outlives its bound is KILLED and the call settles once with the no-exit-status shape — a bound that only stops waiting leaves the child holding a pane we just reported gone" +
						` — status=${result.status} stderr=${JSON.stringify(result.stderr)} alive=${alive}`,
					result.status === 1 &&
						result.stderr.includes("no exit status (timeout 150ms") &&
						alive === false &&
						// The production bounds themselves are untouched by the seam.
						HERDR_START_TIMEOUT_MS === 300_000 &&
						HERDR_CLI_TIMEOUT_MS === 30_000,
				);
			}

			// ── OUTPUT BOUNDED ───────────────────────────────────────────────────────────
			{
				const run = createHerdrRunner(process.execPath, process.env, recordingSpawn, {
					startMs: 5_000,
					cliMs: 5_000,
					maxOutputBytes: 64 * 1024,
				});
				const result = await run([
					"-e",
					"const chunk='x'.repeat(64*1024); for (let i=0;i<64;i++) process.stdout.write(chunk); setTimeout(()=>{}, 30000);",
				]);
				ok(
					"[QK:HERDR-RUNNER-OUTPUT-BOUNDED] a runaway child is cut off AT the cap and reported as a failure, never buffered without limit or truncated into a parse we would believe" +
						` — status=${result.status} stdout=${result.stdout.length}B stderr=${JSON.stringify(result.stderr.slice(0, 120))}`,
					result.status === 1 &&
						result.stdout === "" &&
						result.stderr.includes(`output exceeded ${64 * 1024} bytes`) &&
						HERDR_MAX_OUTPUT_BYTES === 8 * 1024 * 1024,
				);
			}
		} finally {
			for (const child of spawned) child.kill("SIGKILL");
			await new Promise<void>((resolve) => server.close(() => resolve()));
			fs.rmSync(socketDir, { recursive: true, force: true });
		}
	}

	console.log(`\n[check-herdr-fresh-call] ${passed} assertions ok`);
}

await main();
