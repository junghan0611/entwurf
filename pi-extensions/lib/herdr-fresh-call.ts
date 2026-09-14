/**
 * herdr-fresh-call — open ONE visible sibling in a herdr pane, from inside herdr.
 *
 * THE TMUX RAIL IS NOT TOUCHED AND NOT REACHED FROM HERE. This module imports no `mux-*` and no
 * `entwurf-*`: the pieces both rails genuinely share live in `fresh-call-composition.ts`, and
 * everything below that line is different. herdr places with `pane split` + `agent start`, which
 * is TWO mutations where tmux had one; it resolves no runtime for us; and its coordinates are
 * workspace/tab/pane rather than server/session/window. Sharing a placement type between those
 * would have been a shape, not a contract.
 *
 * WHY THE PROMPT ARRIVES JSON-ENCODED (#116 option G, measured 2026-09-14).
 * `[file:line @ c77af189]` `src/app/agents.rs:157-162` refuses an `agent start` whose args contain
 * ANY Unicode control character, before it even looks the pane up:
 *
 *     if params.args.iter().any(|arg| arg.chars().any(char::is_control)) { InvalidArgument }
 *
 * `[측정, 변이 0]` proven against a NONEXISTENT pane, so nothing was created: a two-line argument
 * returned `invalid_agent_argument`, the same call with a one-line argument got as far as
 * `agent_pane_not_found`. The first-turn framing is multi-line by contract and a caller's task is
 * routinely multi-line, so neither can ride `-- <argv>` as written.
 *
 * Three other channels were measured and rejected before this one:
 *   - `[측정]` delivering the framing to a BLANK sibling through the entwurf mailbox — the claude
 *     sibling read it, stamped the receipt, and correctly refused to act on an imperative that
 *     arrived as untrusted data. Rewriting it truthfully, with no birth claim and no id in the
 *     body, changed nothing: it refused on AUTHORITY, not wording. A blank sibling has no reason
 *     to exist yet, so the only thing that can give it one is the channel it was born through.
 *   - keystrokes (`agent prompt`) are terminal input, which this product does not use to launch.
 *   - a vendor extension decoder exists for omp, but not for claude-code, and this pilot is
 *     `pi | claude-code`.
 *
 * So the WHOLE prompt is wrapped as one JSON string literal inside one truthful sentence telling
 * the sibling to decode it. `[측정 2026-09-14, both pilots]` the sibling decodes it, calls the
 * callback FIRST, and only then answers the task — the order the framing exists to fix survived
 * the encoding on both axes.
 *
 * WHAT THIS MODULE DOES NOT DO: it never reads the record store, never resolves a garden id,
 * never retries, never watches, and never puts a garden id or native session id in its receipt.
 * The direct `agent_started` witness is the CALLER's launch evidence; the sibling's nonce callback
 * is separate first-model-action evidence. Neither is a fallback for the other, and this file is
 * not allowed to turn one into the other.
 */

import { createHash } from "node:crypto";
import { statSync } from "node:fs";
import path from "node:path";
import {
	buildOmpBootstrapPayload,
	composeBackendArgs,
	composeFreshCallPrompt,
	type FreshCallComposition,
	type FreshCallInputRejectReason,
	normalizeFreshCallInputs,
} from "./fresh-call-composition.ts";

/** The pilot set, closed. `[#116 decision]` herdr's own `--kind` enum is much larger, and that is
 * NOT evidence of support: every other backend is a pre-mutation named reject here, and there is
 * no fallback to the tmux rail — a caller inside herdr who asks for codex gets a refusal, not a
 * window somewhere else. */
export const HERDR_FRESH_CALL_BACKENDS = ["pi", "claude-code"] as const;
export type HerdrFreshCallBackend = (typeof HERDR_FRESH_CALL_BACKENDS)[number];

/** Our backend name → the `--kind` token herdr accepts. `[측정 2026-09-14]` both round-tripped with
 * the vendor executable echoed back in `argv`. This is a REQUESTED kind: `[file:line @ c77af189]`
 * `src/app/agents.rs:197-199` turns it into a bare executable name and writes it into the pane's
 * shell, so nothing here has proven the binary exists, is on PATH, or will start. Runtime failure
 * is a post-mutation outcome on this rail, named as such, never a precondition we can claim. */
export const HERDR_AGENT_KIND: Record<HerdrFreshCallBackend, string> = {
	pi: "pi",
	"claude-code": "claude",
};

/** What the herdr rail tells a sibling about where it woke up — the rail-owned sentence the
 * composition leaf refuses to invent for itself. */
export const HERDR_FRESH_CALL_OPENING_LINE = "You are a fresh visible citizen that entwurf opened in a herdr pane.";

/** The sentence that carries the encoded prompt. It says exactly what it is: there is no hidden
 * protocol, and a human reading the pane's scrollback can decode the same string by hand. */
export const HERDR_DECODE_INSTRUCTION =
	"Decode the following JSON string literal and follow the decoded instructions exactly as if they were this message: ";

/** Why a herdr fresh call was refused BEFORE anything was created. Every value is a named refusal
 * and none of them has a fallback: a rejected call leaves no pane, no agent and no record. */
export type HerdrFreshCallRejectReason =
	// The caller-facing input contract, shared with the tmux rail so a mistyped model or an
	// oversized task is answered with the SAME word on either placement owner.
	| FreshCallInputRejectReason
	| "herdr-context-missing"
	| "herdr-parent-pane-missing"
	| "herdr-backend-unsupported"
	| "herdr-placement-tmux-rejected"
	| "herdr-argv-control-character"
	| "cwd-not-absolute"
	| "cwd-missing"
	| "cwd-not-directory";

/** Why a launch that had ALREADY split a pane failed. These are separate from the refusals above
 * because the operator's next question is different: something exists and may need reclaiming. */
export type HerdrLaunchFailureReason =
	| "herdr-split-failed"
	| "herdr-split-unparsable"
	/** The split succeeded onto a pane that ALREADY holds an agent. Starting there would either
	 * be refused by herdr or land on somebody else's sibling, so this declines instead. */
	| "herdr-split-pane-occupied"
	| "herdr-agent-start-failed"
	| "herdr-agent-start-unparsable"
	/** The start reported a pane or terminal that is not the one we split. Distinct from
	 * `unparsable` on purpose: the payload was readable and said something actionable. */
	| "herdr-agent-start-pane-drift"
	/** The start succeeded without an `agent_session`. herdr's own start path waits for
	 * detection, so a missing witness means we were told about a launch nobody can identify. */
	| "herdr-agent-start-witness-missing"
	/** The echoed argv is not the canonical executable plus exactly what we passed after `--`. */
	| "herdr-agent-start-argv-drift";

/** Why an orphan pane could NOT be reclaimed. `[측정 2026-09-14, isolated sandbox server]` a herdr
 * server restart brought the SAME pane ids back bound to entirely different terminals
 * (`w1:p1/p2/p3`, `term_65b6d90e…` → `term_65b6d916…`). So a bare pane id carries no authority to
 * close anything, and `terminal_id` proves ownership only WITHIN one server generation: a receipt
 * that survived a restart always mismatches, which is the safe direction and lands here. */
export type HerdrOrphanReason =
	| "pane-get-failed"
	| "pane-get-unparsable"
	| "pane-id-mismatch"
	| "terminal-id-mismatch"
	| "agent-session-present"
	| "close-failed";

/** What happened to the pane we opened when the launch failed after it existed. */
export type HerdrRecovery =
	| { readonly outcome: "closed"; readonly paneId: string; readonly terminalId: string }
	| { readonly outcome: "orphan-unreclaimed"; readonly paneId: string; readonly reason: HerdrOrphanReason };

/**
 * The launch receipt. Read it as "what herdr was asked to start, and where the view is".
 *
 * `herdr*` keys are named for their owner ON PURPOSE: they are herdr's coordinates, they are
 * VIEWS, and `[측정 2026-09-14]` a pane id is not even stable for the life of a sibling — moving a
 * pane across workspaces changed `w7:p3` into `w8:p2` while the session underneath was untouched.
 *
 * ABSENT BY CONTRACT: `gardenId` and `nativeSessionId` (an address is the record's to give, and
 * this module never reads the store), screen text, `agent_status` and `interactive_ready` (herdr's
 * own view judgements), and `agent_session` (the join key — putting it here would be the first
 * step in promoting a pane to an address).
 */
export interface HerdrFreshCallReceipt {
	readonly backend: HerdrFreshCallBackend;
	/** The kind herdr was ASKED for. Not proof that the runtime exists — see `HERDR_AGENT_KIND`. */
	readonly requestedKind: string;
	readonly model: string;
	readonly cwd?: string;
	readonly herdrAgentName: string;
	readonly herdrPaneId: string;
	readonly herdrTerminalId: string;
	readonly herdrWorkspaceId?: string;
	readonly herdrTabId?: string;
	readonly nonce: string;
}

export type HerdrFreshCallResult =
	| { readonly ok: true; readonly receipt: HerdrFreshCallReceipt }
	| { readonly ok: false; readonly reason: HerdrFreshCallRejectReason }
	| {
			readonly ok: false;
			readonly reason: HerdrLaunchFailureReason;
			/** herdr's own error code when it gave one (`{"error":{"code":…}}`) — quoted, never retyped. */
			readonly herdrErrorCode?: string;
			readonly recovery: HerdrRecovery;
	  };

/** One invocation of the herdr CLI, injected. Production supplies `execFileSync`; tests supply a
 * table. There is no fake herdr binary anywhere in this repo, for the same reason there is no fake
 * tmux: a fake would agree with whatever we believed on the day we wrote it. */
export type HerdrRun = (args: readonly string[]) => {
	readonly status: number;
	readonly stdout: string;
	readonly stderr: string;
};

/** The two env facts that say we are inside herdr, plus the pane we were opened in. All three are
 * herdr's OWN (`HERDR_ENV`, `HERDR_BIN_PATH`, `HERDR_PANE_ID`); none is discovered, no socket is
 * scanned and no path is guessed. Outside herdr this rail does not exist rather than improvising. */
export interface HerdrContext {
	readonly bin: string;
	readonly parentPaneId: string;
}

export function resolveHerdrContext(
	env: NodeJS.ProcessEnv,
): { ok: true; context: HerdrContext } | { ok: false; reason: HerdrFreshCallRejectReason } {
	if (env.HERDR_ENV !== "1") return { ok: false, reason: "herdr-context-missing" };
	const bin = env.HERDR_BIN_PATH;
	if (typeof bin !== "string" || bin.length === 0) return { ok: false, reason: "herdr-context-missing" };
	const parentPaneId = env.HERDR_PANE_ID;
	if (typeof parentPaneId !== "string" || parentPaneId.length === 0) {
		// A split needs a parent. Guessing one from `pane list` would be picking someone else's
		// view to cut in half, which is exactly the guess this rail refuses everywhere else.
		return { ok: false, reason: "herdr-parent-pane-missing" };
	}
	return { ok: true, context: { bin, parentPaneId } };
}

/**
 * The tmux seat input has no meaning here and is REFUSED rather than ignored.
 *
 * `placement: {tmuxSession}` names a session on the caller's tmux server. Inside herdr there is no
 * such server, and quietly dropping the field would open a sibling somewhere the caller did not
 * ask for while the call still looked successful. This is the narrowest layer that can see the
 * input; the public tool is not wired to it yet (#116 c2).
 */
export function rejectTmuxPlacementInHerdrContext(
	placement: { readonly tmuxSession?: string } | undefined,
): "herdr-placement-tmux-rejected" | null {
	// ANY defined placement object is a tmux-shaped request, including `{}` and
	// `{tmuxSession: ""}`. Reading the MEMBER instead of the object would have let a caller who
	// asked for a seat and mistyped it get a sibling in the default position with a green
	// receipt — the same silent-relocation failure this refusal exists to prevent.
	return placement === undefined ? null : "herdr-placement-tmux-rejected";
}

/**
 * The start directory, classified for herdr rather than borrowed from tmux.
 *
 * The tmux leaf also refuses `#`, because `[측정]` tmux FORMAT-EXPANDS a `-c` value and a `#(…)`
 * was observed executing. herdr has no such expansion: `[file:line @ c77af189]` `src/cli/pane.rs:689-694`
 * clones the `--cwd` value into the request and the server passes it on, so the character is
 * ordinary here. Importing the tmux rule would have been borrowed authority — a refusal whose
 * stated reason is false on this rail. The existence checks below are kept, and for the same
 * measured reason they exist there: a directory that is gone must not produce a cheerful launch
 * somewhere else.
 */
export function classifyHerdrCwd(cwd: string): "cwd-not-absolute" | "cwd-missing" | "cwd-not-directory" | null {
	if (!path.isAbsolute(cwd)) return "cwd-not-absolute";
	let st: ReturnType<typeof statSync>;
	try {
		st = statSync(cwd);
	} catch {
		return "cwd-missing";
	}
	return st.isDirectory() ? null : "cwd-not-directory";
}

/** Every Unicode control character, the same class herdr's server refuses. `JSON.stringify` escapes
 * C0 and the quote/backslash pair, but leaves DEL (U+007F) and the C1 block (U+0080–U+009F)
 * LITERAL — so the escape pass below is not decoration, it is the half `JSON.stringify` does not do. */
const CONTROL_CHARS = /\p{Cc}/gu;

/** Reversible: `\uXXXX` inside a JSON string decodes back to exactly this character. */
function escapeRemainingControlChars(json: string): string {
	return json.replace(CONTROL_CHARS, (ch) => `\\u${ch.codePointAt(0)?.toString(16).padStart(4, "0")}`);
}

/**
 * Fold the whole multi-line framing into ONE physical line.
 *
 * The result must satisfy two independent things, and both are checked rather than assumed:
 * herdr will accept it (zero `\p{Cc}`), and the sibling can get the original back (the JSON
 * literal parses to the exact input, byte for byte — no trimming, no normalisation, no reflow).
 * A round-trip failure is OUR bug, not the caller's input, so it throws instead of returning a
 * reject the caller could not act on.
 */
export function encodeBirthPrompt(
	prompt: string,
): { ok: true; argv: string } | { ok: false; reason: "herdr-argv-control-character" } {
	const literal = escapeRemainingControlChars(JSON.stringify(prompt));
	const argv = `${HERDR_DECODE_INSTRUCTION}${literal}`;
	// Fail closed. Reachable only if a future JS runtime leaves a control character both
	// unescaped by JSON.stringify AND unmatched by \p{Cc}; the refusal is cheaper than the
	// orphan pane a server-side rejection would cost us.
	if (containsControlChar(argv)) return { ok: false, reason: "herdr-argv-control-character" };
	const decoded: unknown = JSON.parse(literal);
	if (decoded !== prompt) {
		throw new Error(
			"herdr-fresh-call: the encoded birth prompt did not decode back to the original — refusing to launch a sibling with a framing we cannot reproduce",
		);
	}
	return { ok: true, argv };
}

export function containsControlChar(value: string): boolean {
	CONTROL_CHARS.lastIndex = 0;
	return CONTROL_CHARS.test(value);
}

/**
 * The agent name herdr will know this sibling by.
 *
 * `[file:line @ c77af189]` `src/app/agents.rs:15-20` requires `[a-z][a-z0-9_-]{0,31}`, which the
 * nonce itself does not satisfy (it is 39 characters). So the name is DERIVED from the per-call
 * nonce by hash: same call, same name; different calls, different names; and the name discloses
 * nothing. It is not a role, not a title and not an address — an operator reading `herdr agent
 * list` should learn only that entwurf opened it.
 */
export function herdrAgentNameFromNonce(nonce: string): string {
	return `entwurf-${createHash("sha256").update(nonce).digest("hex").slice(0, 20)}`;
}

/**
 * The ONE placement policy this rail has: split the caller's own pane downward and do not steal
 * focus. `[file:line @ c77af189]` `src/cli/pane.rs:722-727` makes `--direction` mandatory, so there
 * is no "herdr decides" option to defer to; `--no-focus` is stated because a sibling opening under
 * the operator's hands must not take the keyboard. This is deliberately NOT a layout manager: a
 * caller who wants a different arrangement moves the pane in herdr, which owns layout.
 *
 * The identity scrub is explicit for the reason the tmux rail learned the hard way: a child that
 * inherits a stale `PI_SESSION_ID` reports itself as a citizen it is not. `[측정 2026-09-14]`
 * `--env KEY=` injects the EMPTY value rather than dropping the key, and `[file:line @ c77af189]`
 * `src/cli/pane.rs:710-717` inserts each `--env` into a map, so repeating the flag is the grammar.
 */
export function buildHerdrSplitArgs(params: { parentPaneId: string; cwd?: string }): string[] {
	return [
		"pane",
		"split",
		"--pane",
		params.parentPaneId,
		"--direction",
		"down",
		"--no-focus",
		...(params.cwd === undefined ? [] : ["--cwd", params.cwd]),
		"--env",
		"PI_SESSION_ID=",
		"--env",
		"PI_AGENT_ID=",
	];
}

/** `agent start <name> --kind <kind> --pane <id> -- <backend argv>`. Everything after `--` is the
 * vendor's own argv, echoed back in the response. */
export function buildHerdrAgentStartArgs(params: {
	agentName: string;
	kind: string;
	paneId: string;
	backendArgs: readonly string[];
}): string[] {
	return [
		"agent",
		"start",
		params.agentName,
		"--kind",
		params.kind,
		"--pane",
		params.paneId,
		"--",
		...params.backendArgs,
	];
}

/** `[측정 2026-09-14]` both take a POSITIONAL pane id — `herdr pane get --pane <id>` is a usage
 * error, not a synonym. */
export function buildHerdrPaneGetArgs(paneId: string): string[] {
	return ["pane", "get", paneId];
}

export function buildHerdrPaneCloseArgs(paneId: string): string[] {
	return ["pane", "close", paneId];
}

/** A pane as herdr reported it, reduced to what a launch needs. `paneId` stays an OPAQUE string:
 * `[측정 2026-09-14]` the tenth pane came back as `w7:pA`, not `w7:p10`, so any parser that assumes
 * decimals is already wrong. */
export interface HerdrPaneFacts {
	readonly paneId: string;
	readonly terminalId: string;
	readonly workspaceId?: string;
	readonly tabId?: string;
	/** Presence ONLY. The value is the placement join key and has no business in a launch. */
	readonly hasAgentSession: boolean;
}

function readPaneFacts(pane: unknown): HerdrPaneFacts | null {
	if (typeof pane !== "object" || pane === null) return null;
	const row = pane as Record<string, unknown>;
	const paneId = row.pane_id;
	const terminalId = row.terminal_id;
	if (typeof paneId !== "string" || paneId.length === 0) return null;
	if (typeof terminalId !== "string" || terminalId.length === 0) return null;
	const workspaceId = typeof row.workspace_id === "string" ? row.workspace_id : undefined;
	const tabId = typeof row.tab_id === "string" ? row.tab_id : undefined;
	return {
		paneId,
		terminalId,
		...(workspaceId === undefined ? {} : { workspaceId }),
		...(tabId === undefined ? {} : { tabId }),
		hasAgentSession: row.agent_session !== undefined && row.agent_session !== null,
	};
}

/** `{"id":"cli:pane:split","result":{"pane":{…},"type":"pane_info"}}` — measured. A payload that is
 * not that shape is DECLINED (null); it is never partially believed. */
export function parseHerdrSplitResponse(stdout: string): HerdrPaneFacts | null {
	const root = parseJsonObject(stdout);
	if (root === null) return null;
	const result = root.result;
	if (typeof result !== "object" || result === null) return null;
	return readPaneFacts((result as Record<string, unknown>).pane);
}

/** What a successful `agent start` told us. `argv` is herdr's echo of what it actually composed:
 * `[file:line @ c77af189]` `src/app/agents.rs:197-199` builds it as the canonical executable for
 * the requested kind followed by our args, so it is checkable rather than decorative. It is
 * LAUNCH TRANSPORT evidence and never leaves this module in a receipt. */
export interface HerdrStartFacts {
	readonly pane: HerdrPaneFacts;
	readonly argv: readonly string[] | null;
}

/** `{"id":"cli:agent:start","result":{"agent":{…},"argv":[…],"type":"agent_started"}}` — measured. */
export function parseHerdrAgentStartResponse(stdout: string): HerdrStartFacts | null {
	const root = parseJsonObject(stdout);
	if (root === null) return null;
	const result = root.result;
	if (typeof result !== "object" || result === null) return null;
	const pane = readPaneFacts((result as Record<string, unknown>).agent);
	if (pane === null) return null;
	const rawArgv = (result as Record<string, unknown>).argv;
	const argv =
		Array.isArray(rawArgv) && rawArgv.every((token) => typeof token === "string") ? (rawArgv as string[]) : null;
	return { pane, argv };
}

/** The canonical executable herdr writes for a requested kind, measured twice today (`["claude"]`
 * and `["pi","--entwurf-control"]`) and pinned upstream at `src/detect/mod.rs:155-156 @ c77af189`.
 * We only assert it for the two pilot kinds we have actually seen. */
export const HERDR_CANONICAL_EXECUTABLE: Record<HerdrFreshCallBackend, string> = {
	pi: "pi",
	"claude-code": "claude",
};

/** Did herdr compose the argv we asked for, exactly? A launch whose echoed argv differs is a
 * sibling that was started with something other than our framing, which no later receipt would
 * reveal. */
export function argvMatchesRequest(
	echoed: readonly string[] | null,
	backend: HerdrFreshCallBackend,
	backendArgs: readonly string[],
): boolean {
	if (echoed === null) return false;
	const expected = [HERDR_CANONICAL_EXECUTABLE[backend], ...backendArgs];
	return echoed.length === expected.length && echoed.every((token, index) => token === expected[index]);
}

/** `herdr pane get <id>` → `{"result":{"pane":{…}}}` — the same shape as split. */
export const parseHerdrPaneGetResponse = parseHerdrSplitResponse;

/** herdr's own failure envelope: `{"id":…,"error":{"code":…,"message":…}}` on stderr with exit 1
 * (`[file:line @ c77af189]` `src/cli.rs:745-753`). The code is quoted into our reject, never
 * re-typed into a vocabulary of ours that would go stale the moment herdr adds a case. */
export function readHerdrErrorCode(stderr: string): string | undefined {
	const root = parseJsonObject(stderr);
	if (root === null) return undefined;
	const error = root.error;
	if (typeof error !== "object" || error === null) return undefined;
	const code = (error as Record<string, unknown>).code;
	return typeof code === "string" && code.length > 0 ? code : undefined;
}

function parseJsonObject(text: string): Record<string, unknown> | null {
	const trimmed = text.trim();
	if (trimmed.length === 0) return null;
	let parsed: unknown;
	try {
		parsed = JSON.parse(trimmed);
	} catch {
		// Not JSON at all is what a usage error looks like: `[측정 2026-09-14]` a bad flag prints
		// plain `usage: …` text and exits 2. Declining is the whole handling it needs.
		return null;
	}
	return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
		? (parsed as Record<string, unknown>)
		: null;
}

/**
 * May we close the pane we just opened?
 *
 * Only with WITHIN-GENERATION proof: the pane we are looking at right now must be the same id AND
 * the same terminal our split receipt named, and it must not have acquired an agent session. A
 * bare pane id is not authority (see `HerdrOrphanReason`), and the honest answer when the proof
 * does not hold is to leave the pane alone and say so by name.
 *
 * A TOCTOU window remains between this decision and the close, and it is not closable through the
 * public API: `[file:line @ c77af189]` `src/api/schema/common.rs:33-36` gives `close_pane` only a
 * `pane_id`, with no expected-terminal token to make the close conditional server-side. The window
 * is named here rather than papered over.
 */
export function decideConditionalClose(
	split: Pick<HerdrPaneFacts, "paneId" | "terminalId">,
	current: HerdrPaneFacts | null,
	getFailed: boolean,
): { close: true } | { close: false; reason: HerdrOrphanReason } {
	if (getFailed) return { close: false, reason: "pane-get-failed" };
	if (current === null) return { close: false, reason: "pane-get-unparsable" };
	if (current.paneId !== split.paneId) return { close: false, reason: "pane-id-mismatch" };
	if (current.terminalId !== split.terminalId) return { close: false, reason: "terminal-id-mismatch" };
	if (current.hasAgentSession) return { close: false, reason: "agent-session-present" };
	return { close: true };
}

/**
 * Open the sibling.
 *
 * ORDER IS THE ARGUMENT, and it is a different argument from the tmux rail's. There, validation
 * could promise that "nothing above can leave a window behind"; here the split IS a mutation and
 * the start can still fail after it. So everything decidable — context, backend, placement input,
 * caller id, task, model, cwd, and the encoded argv's control characters — is decided BEFORE the
 * split, and the only failures that can survive into the two-step region are herdr's own.
 *
 * `callerGardenId` comes from the SURFACE that registered the tool, out of its own record-backed
 * context. This module never derives it, looks it up, or guesses: an empty value is a refusal.
 */
export function herdrFreshCall(
	params: {
		readonly backend: string;
		readonly model: string;
		readonly task: string;
		readonly cwd?: string;
		readonly placement?: { readonly tmuxSession?: string };
		readonly callerGardenId: string | null;
	},
	run: HerdrRun,
	env: NodeJS.ProcessEnv,
	nonce: string,
): HerdrFreshCallResult {
	const context = resolveHerdrContext(env);
	if (!context.ok) return { ok: false, reason: context.reason };

	const tmuxPlacement = rejectTmuxPlacementInHerdrContext(params.placement);
	if (tmuxPlacement !== null) return { ok: false, reason: tmuxPlacement };

	if (!(HERDR_FRESH_CALL_BACKENDS as readonly string[]).includes(params.backend)) {
		// No tmux fallback, on purpose: a sibling opened on a rail the caller did not ask for is
		// worse than a refusal they can read.
		return { ok: false, reason: "herdr-backend-unsupported" };
	}
	const backend = params.backend as HerdrFreshCallBackend;

	// The caller's inputs are judged by the SHARED contract — same order, same trimming, same
	// five words — so a caller cannot learn a different vocabulary by being inside herdr. The
	// cwd omission rule comes with it: `undefined` and `""` both mean "no cwd", which this rail
	// previously mistook for an invalid path.
	const normalized = normalizeFreshCallInputs(params);
	if (!normalized.ok) return { ok: false, reason: normalized.reason };
	const { callerGardenId, model, task, cwd } = normalized.inputs;
	if (cwd !== undefined) {
		const badCwd = classifyHerdrCwd(cwd);
		if (badCwd !== null) return { ok: false, reason: badCwd };
	}

	const multiline = composeFreshCallPrompt({
		backend,
		task,
		callerGardenId,
		nonce,
		openingLine: HERDR_FRESH_CALL_OPENING_LINE,
	});
	const encoded = encodeBirthPrompt(multiline);
	if (!encoded.ok) return { ok: false, reason: encoded.reason };

	const composition: FreshCallComposition = {
		prompt: encoded.argv,
		bootstrapPayload: buildOmpBootstrapPayload({ callerGardenId, nonce, task }),
	};
	const backendArgs = composeBackendArgs(backend, composition, model, () => {
		// Unreachable: codex is not in the pilot set and was refused above. It throws rather than
		// returning a plausible path, so a future widening cannot silently inherit a guess.
		throw new Error("herdr-fresh-call: codex is not a pilot backend on this rail");
	});
	// The server checks EVERY argument, not just the prompt, so we check every argument too —
	// while it is still free to refuse.
	if (backendArgs.some(containsControlChar)) return { ok: false, reason: "herdr-argv-control-character" };

	// ── everything above this line leaves nothing behind ──────────────────────────────────
	const splitRun = run(
		buildHerdrSplitArgs({
			parentPaneId: context.context.parentPaneId,
			...(cwd === undefined ? {} : { cwd }),
		}),
	);
	if (splitRun.status !== 0) {
		// Nothing was created, so there is nothing to reclaim and no recovery to report.
		return { ok: false, reason: "herdr-split-failed", ...errorCode(splitRun.stderr), recovery: noPane() };
	}
	const pane = parseHerdrSplitResponse(splitRun.stdout);
	if (pane === null) {
		// A pane may exist and its id is precisely what we could not read. Diffing `pane list` to
		// find "the new one" is the guess this rail refuses, so the orphan is NAMED instead.
		return { ok: false, reason: "herdr-split-unparsable", recovery: unknownPane() };
	}
	if (pane.hasAgentSession) {
		// A freshly split pane holding an agent is not a pane we understand. Starting into it
		// would either be refused by herdr as busy or, worse, land beside somebody else's
		// sibling. Declining here also means the reclaim below correctly REFUSES to close it.
		return { ok: false, reason: "herdr-split-pane-occupied", recovery: reclaim(pane, run) };
	}

	const agentName = herdrAgentNameFromNonce(nonce);
	const startRun = run(
		buildHerdrAgentStartArgs({
			agentName,
			kind: HERDR_AGENT_KIND[backend],
			paneId: pane.paneId,
			backendArgs,
		}),
	);
	if (startRun.status !== 0) {
		return {
			ok: false,
			reason: "herdr-agent-start-failed",
			...errorCode(startRun.stderr),
			recovery: reclaim(pane, run),
		};
	}
	const started = parseHerdrAgentStartResponse(startRun.stdout);
	if (started === null) {
		return { ok: false, reason: "herdr-agent-start-unparsable", recovery: reclaim(pane, run) };
	}
	// EVERY reclaim below starts from the SPLIT receipt, never from what the start reported: if
	// those two disagree, the split receipt is the only coordinate we have authority over.
	if (started.pane.paneId !== pane.paneId || started.pane.terminalId !== pane.terminalId) {
		// Readable, and actionable — so it is not folded into `unparsable`. Something started
		// somewhere other than the pane we opened, and a green receipt would have pointed the
		// caller at a coordinate that never held their sibling.
		return { ok: false, reason: "herdr-agent-start-pane-drift", recovery: reclaim(pane, run) };
	}
	if (!started.pane.hasAgentSession) {
		// herdr's own start path waits for detection before returning, so a success with no
		// session reference means we were told about a launch that nobody can identify. The
		// VALUE stays unread here — presence is the whole claim.
		return { ok: false, reason: "herdr-agent-start-witness-missing", recovery: reclaim(pane, run) };
	}
	if (!argvMatchesRequest(started.argv, backend, backendArgs)) {
		// The framing is the argv. A sibling started with a different one is a sibling we did not
		// compose, and nothing downstream would ever reveal it.
		return { ok: false, reason: "herdr-agent-start-argv-drift", recovery: reclaim(pane, run) };
	}

	return {
		ok: true,
		receipt: {
			backend,
			requestedKind: HERDR_AGENT_KIND[backend],
			model,
			...(cwd === undefined ? {} : { cwd }),
			herdrAgentName: agentName,
			herdrPaneId: started.pane.paneId,
			herdrTerminalId: started.pane.terminalId,
			...(started.pane.workspaceId === undefined ? {} : { herdrWorkspaceId: started.pane.workspaceId }),
			...(started.pane.tabId === undefined ? {} : { herdrTabId: started.pane.tabId }),
			nonce,
		},
	};
}

function errorCode(stderr: string): { herdrErrorCode?: string } {
	const code = readHerdrErrorCode(stderr);
	return code === undefined ? {} : { herdrErrorCode: code };
}

/** A split that never happened. The pane id is empty because there is no pane — said out loud
 * rather than left to a reader to infer from a missing field. */
function noPane(): HerdrRecovery {
	return { outcome: "orphan-unreclaimed", paneId: "", reason: "pane-get-failed" };
}

/** A split that may have happened and whose id we could not read. */
function unknownPane(): HerdrRecovery {
	return { outcome: "orphan-unreclaimed", paneId: "", reason: "pane-get-unparsable" };
}

/** Reclaim the pane we opened — conditionally, or not at all. */
function reclaim(pane: HerdrPaneFacts, run: HerdrRun): HerdrRecovery {
	const getRun = run(buildHerdrPaneGetArgs(pane.paneId));
	const decision = decideConditionalClose(
		pane,
		getRun.status === 0 ? parseHerdrPaneGetResponse(getRun.stdout) : null,
		getRun.status !== 0,
	);
	if (!decision.close) return { outcome: "orphan-unreclaimed", paneId: pane.paneId, reason: decision.reason };
	const closeRun = run(buildHerdrPaneCloseArgs(pane.paneId));
	if (closeRun.status !== 0) return { outcome: "orphan-unreclaimed", paneId: pane.paneId, reason: "close-failed" };
	return { outcome: "closed", paneId: pane.paneId, terminalId: pane.terminalId };
}
