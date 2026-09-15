/**
 * herdr-fresh-call — open ONE visible sibling in a new herdr tab, from inside herdr.
 *
 * THE TMUX RAIL IS NOT TOUCHED AND NOT REACHED FROM HERE. This module imports no `mux-*` and no
 * `entwurf-*`: the pieces both rails genuinely share live in `fresh-call-composition.ts`, and
 * everything below that line is different. herdr places with `tab create` + `agent start`, which
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
	TASK_MAX_CHARS,
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
export const HERDR_FRESH_CALL_OPENING_LINE = "You are a fresh visible citizen that entwurf opened in a new herdr tab.";

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
	| "herdr-caller-pane-missing"
	/** herdr would not tell us where the CALLER is sitting. Three separate names because the
	 * operator's next move differs: their pane is gone, herdr answered something this version
	 * cannot read, or the reply held no workspace at all. None of the three creates anything —
	 * `pane get` is a read — so they all belong with the refusals rather than the failures. */
	| "herdr-caller-pane-get-failed"
	| "herdr-caller-pane-unparsable"
	/** herdr answered readably, about a DIFFERENT pane. Not folded into `unparsable`: the payload
	 * was fine and what it said was actionable — we asked about one pane and were told about
	 * another, so its workspace is not evidence about where the caller is. */
	| "herdr-caller-pane-drift"
	| "herdr-caller-workspace-missing"
	| "herdr-backend-unsupported"
	| "herdr-placement-tmux-rejected"
	| "herdr-argv-control-character"
	| "cwd-not-absolute"
	| "cwd-missing"
	| "cwd-not-directory";

/** Why a launch that had ALREADY created a tab failed. These are separate from the refusals above
 * because the operator's next question is different: something exists and may need reclaiming. */
export type HerdrLaunchFailureReason =
	| "herdr-tab-create-failed"
	| "herdr-tab-create-unparsable"
	/** The new tab came back with an initial pane that ALREADY holds an agent. Starting there
	 * would either be refused by herdr or land on somebody else's sibling, so this declines. */
	| "herdr-tab-root-pane-occupied"
	| "herdr-agent-start-failed"
	| "herdr-agent-start-unparsable"
	/** The start reported a pane, terminal or tab that is not the one we created. Distinct from
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

/**
 * What is out there after a launch failed — and the first question is whether anything IS.
 *
 * `none` and `unknown` are NOT reclaim results and must not be spelled as one. An earlier shape
 * forced them both into `orphan-unreclaimed` with an empty pane id and the reason
 * `pane-get-failed`, which told an operator that a `pane get` had failed when none was ever
 * attempted, under a header saying the tab had been created. Every `HerdrOrphanReason` below now
 * describes exactly what it says: a reclaim we tried and could not prove.
 */
export type HerdrRecovery =
	/** herdr declined with its OWN error envelope, so it answered before making anything.
	 * `[측정 2026-09-15]` the one decline measured on this verb (`workspace_not_found`) left the
	 * server's tab and pane lists unchanged. */
	| { readonly outcome: "none" }
	/** We never got an answer we can act on — our own timeout/kill (no herdr envelope at all), or
	 * a reply we could not read. A tab may exist and naming it would be a guess, so nothing is
	 * closed and the operator is told to go look. */
	| { readonly outcome: "unknown" }
	| { readonly outcome: "closed"; readonly paneId: string; readonly terminalId: string }
	| { readonly outcome: "orphan-unreclaimed"; readonly paneId: string; readonly reason: HerdrOrphanReason };

/**
 * The launch receipt. Read it as "what herdr was asked to start, and where the view is".
 *
 * `herdr*` keys are named for their owner ON PURPOSE: they are herdr's coordinates, they are
 * VIEWS, and `[측정 2026-09-14]` a pane id is not even stable for the life of a sibling — moving a
 * pane across workspaces changed `w7:p3` into `w8:p2` while the session underneath was untouched.
 *
 * TAB FIRST, because that is now what we create: the tab and its workspace are REQUIRED, and the
 * pane is the tab's initial pane — the one exact coordinate the agent was started into and the
 * only one this rail has authority to close. `[측정 2026-09-15]` every `tab_created` reply carried
 * all three, so a missing one is herdr disagreeing with us, not an optional field.
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
	readonly herdrWorkspaceId: string;
	readonly herdrTabId: string;
	/** The new tab's INITIAL pane — where the agent was started, and the only thing we may close. */
	readonly herdrPaneId: string;
	readonly herdrTerminalId: string;
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
export type HerdrRun = (args: readonly string[]) => Promise<{
	readonly status: number;
	readonly stdout: string;
	readonly stderr: string;
}>;

/** The two env facts that say we are inside herdr, plus the pane we were opened in. All three are
 * herdr's OWN (`HERDR_ENV`, `HERDR_BIN_PATH`, `HERDR_PANE_ID`); none is discovered, no socket is
 * scanned and no path is guessed. Outside herdr this rail does not exist rather than improvising.
 *
 * `callerPaneId` is not a placement target on this rail — nothing is split into it. It is the ONE
 * coordinate we are entitled to hand back to herdr to ask "which workspace is this caller in?". */
export interface HerdrContext {
	readonly bin: string;
	readonly callerPaneId: string;
}

export function resolveHerdrContext(
	env: NodeJS.ProcessEnv,
): { ok: true; context: HerdrContext } | { ok: false; reason: HerdrFreshCallRejectReason } {
	if (env.HERDR_ENV !== "1") return { ok: false, reason: "herdr-context-missing" };
	const bin = env.HERDR_BIN_PATH;
	if (typeof bin !== "string" || bin.length === 0) return { ok: false, reason: "herdr-context-missing" };
	const callerPaneId = env.HERDR_PANE_ID;
	if (typeof callerPaneId !== "string" || callerPaneId.length === 0) {
		// Without it we cannot ask herdr where the caller is, and picking a workspace out of
		// `workspace list` would put the sibling beside whoever happens to be focused.
		return { ok: false, reason: "herdr-caller-pane-missing" };
	}
	return { ok: true, context: { bin, callerPaneId } };
}

/**
 * The tmux seat input has no meaning here and is REFUSED rather than ignored.
 *
 * `placement: {tmuxSession}` names a session on the caller's tmux server. Inside herdr there is no
 * such server, and quietly dropping the field would open a sibling somewhere the caller did not
 * ask for while the call still looked successful. This is the narrowest layer that can see the
 * input, and the public tool reaches it through `fresh-call-dispatch`.
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
 * The ONE placement policy this rail has: a NEW TAB in the caller's own workspace, without taking
 * the keyboard. `[GLG direct decision 2026-09-15]` after using the rail for real, a tab beside the
 * caller reads better than a pane split under it; `--no-focus` stays, because a sibling opening
 * under the operator's hands must not steal focus either way.
 *
 * `--workspace` IS PASSED EXPLICITLY AND IS NOT OPTIONAL HERE. `[측정 2026-09-15, private server]`
 * omitting it still succeeds — herdr puts the tab in whatever workspace is currently focused. That
 * is a silent relocation exactly like the tmux seat this rail already refuses, so the workspace is
 * resolved from herdr's OWN answer about the caller's pane (see `herdrFreshCall`) and never from
 * parsing the `w<N>:p<M>` shape of a pane id, which `[측정 2026-09-14]` is opaque anyway (`w7:pA`).
 *
 * `[측정 2026-09-15]` a workspace herdr does not know is refused BEFORE anything is created
 * (`{"error":{"code":"workspace_not_found"}}`, exit 1) — the mutation is still one step, not two.
 *
 * This is deliberately NOT a layout manager: no `--label`, no ratio, no second placement axis. A
 * caller who wants a different arrangement moves the tab in herdr, which owns layout.
 *
 * The identity scrub is explicit for the reason the tmux rail learned the hard way: a child that
 * inherits a stale `PI_SESSION_ID` reports itself as a citizen it is not. `[측정 2026-09-15]` the
 * flag behaves the same on `tab create` as it did on `pane split` and it beats inheritance: with
 * `PI_SESSION_ID` deliberately poisoned in the SERVER's own environment, the process launched in
 * the new tab carried `PI_SESSION_ID=''` and `PI_AGENT_ID=''` — read from `/proc/<pid>/environ`,
 * not from a screen. Repeating the flag is the grammar; `--env KEY=` injects the EMPTY value
 * rather than dropping the key.
 */
export function buildHerdrTabCreateArgs(params: { workspaceId: string; cwd?: string }): string[] {
	return [
		"tab",
		"create",
		"--workspace",
		params.workspaceId,
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

/** `{"id":"cli:pane:get","result":{"pane":{…},"type":"pane_info"}}` — measured. A payload that is
 * not that shape is DECLINED (null); it is never partially believed. */
export function parseHerdrPaneResponse(stdout: string): HerdrPaneFacts | null {
	const root = parseJsonObject(stdout);
	if (root === null) return null;
	const result = root.result;
	if (typeof result !== "object" || result === null) return null;
	return readPaneFacts((result as Record<string, unknown>).pane);
}

/** The tab we created, and the pane inside it we are allowed to touch. */
export interface HerdrTabFacts {
	readonly tabId: string;
	readonly workspaceId: string;
	/** The tab's initial pane, straight out of the same reply — never discovered by listing. */
	readonly rootPane: HerdrPaneFacts;
}

/**
 * `{"id":"cli:tab:create","result":{"root_pane":{…},"tab":{…},"type":"tab_created"}}` — measured
 * verbatim on herdr 0.9.0, 2026-09-15.
 *
 * The reply names the new tab AND hands back its initial pane in one breath, which is why this
 * rail never has to go looking: diffing `pane list` for "the new one" is the guess it refuses
 * everywhere else.
 *
 * BOTH HALVES MUST NAME THE SAME TAB AND THE SAME WORKSPACE, and both must say so out loud.
 * `[측정 2026-09-15]` every `tab_created` reply carried `tab_id` and `workspace_id` on the tab AND
 * on its root pane, so an absent one is herdr disagreeing with this version rather than an
 * optional field — and treating it as optional is how a contradictory reply gets assembled into a
 * green launch whose receipt names one tab while the agent starts in another. Disagreement or
 * absence declines the WHOLE payload; we do not pick the half we prefer.
 */
export function parseHerdrTabCreateResponse(stdout: string): HerdrTabFacts | null {
	const root = parseJsonObject(stdout);
	if (root === null) return null;
	const result = root.result;
	if (typeof result !== "object" || result === null) return null;
	const rootPane = readPaneFacts((result as Record<string, unknown>).root_pane);
	if (rootPane === null) return null;
	const tab = (result as Record<string, unknown>).tab;
	if (typeof tab !== "object" || tab === null) return null;
	const tabId = (tab as Record<string, unknown>).tab_id;
	const workspaceId = (tab as Record<string, unknown>).workspace_id;
	if (typeof tabId !== "string" || tabId.length === 0) return null;
	if (typeof workspaceId !== "string" || workspaceId.length === 0) return null;
	// Required on the root pane too, and equal — not "checked when present".
	if (rootPane.tabId !== tabId) return null;
	if (rootPane.workspaceId !== workspaceId) return null;
	return { tabId, workspaceId, rootPane };
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

/** `herdr pane get <id>` → `{"result":{"pane":{…}}}`. */
export const parseHerdrPaneGetResponse = parseHerdrPaneResponse;

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
 * the same terminal our creation receipt named, and it must not have acquired an agent session. A
 * bare pane id is not authority (see `HerdrOrphanReason`), and the honest answer when the proof
 * does not hold is to leave the pane alone and say so by name.
 *
 * WHY THE RECLAIM IS STILL PANE-LEVEL ON A TAB-FIRST RAIL. `[측정 2026-09-15, private server]`
 * `tab close` takes a bare `tab_id` and nothing else: it closed a tab holding a RUNNING agent and
 * answered `{"result":{"type":"ok"}}`, so adopting it would be claiming authority over every pane
 * a stranger had put in our tab meanwhile. Closing the one pane we own is strictly narrower and it
 * is enough — `[측정]` closing the sole pane of a tab removed the tab with it (`tab get` →
 * `tab_not_found`, no empty tab left behind), and on a tab that had gained a second pane the same
 * close took only ours and left the tab and the stranger's pane alive. Fail-closed in both
 * directions, with the proof we already had.
 *
 * A TOCTOU window remains between this decision and the close, and it is not closable through the
 * public API: `[file:line @ c77af189]` `src/api/schema/common.rs:33-36` gives `close_pane` only a
 * `pane_id`, with no expected-terminal token to make the close conditional server-side. The window
 * is named here rather than papered over.
 */
export function decideConditionalClose(
	created: Pick<HerdrPaneFacts, "paneId" | "terminalId">,
	current: HerdrPaneFacts | null,
	getFailed: boolean,
): { close: true } | { close: false; reason: HerdrOrphanReason } {
	if (getFailed) return { close: false, reason: "pane-get-failed" };
	if (current === null) return { close: false, reason: "pane-get-unparsable" };
	if (current.paneId !== created.paneId) return { close: false, reason: "pane-id-mismatch" };
	if (current.terminalId !== created.terminalId) return { close: false, reason: "terminal-id-mismatch" };
	if (current.hasAgentSession) return { close: false, reason: "agent-session-present" };
	return { close: true };
}

/**
 * Open the sibling.
 *
 * ORDER IS THE ARGUMENT, and it is a different argument from the tmux rail's. There, validation
 * could promise that "nothing above can leave a window behind"; here the tab create IS a mutation
 * and the start can still fail after it. So everything decidable — context, backend, placement
 * input, caller id, task, model, cwd, and the encoded argv's control characters — is decided
 * BEFORE it, and the only failures that can survive into the two-step region are herdr's own.
 *
 * ONE READ SITS BETWEEN THEM, and it creates nothing: `pane get <HERDR_PANE_ID>` asks herdr which
 * workspace the caller is in. It comes LAST among the refusals so a call we would have rejected
 * anyway never reaches the herdr CLI, and its four failure modes are refusals rather than launch
 * failures because a read leaves no tab behind.
 *
 * `callerGardenId` comes from the SURFACE that registered the tool, out of its own record-backed
 * context. This module never derives it, looks it up, or guesses: an empty value is a refusal.
 */
export async function herdrFreshCall(
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
): Promise<HerdrFreshCallResult> {
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

	// Which workspace is the caller in? herdr's own answer about the caller's own pane — not the
	// focused workspace, not a listing, and not the `w<N>:` prefix of an id this rail treats as
	// opaque. A pane we cannot read is a refusal: falling back to an omitted `--workspace` would
	// open the sibling wherever the operator happens to be looking, under a green receipt.
	const callerPaneRun = await run(buildHerdrPaneGetArgs(context.context.callerPaneId));
	if (callerPaneRun.status !== 0) return { ok: false, reason: "herdr-caller-pane-get-failed" };
	const callerPane = parseHerdrPaneGetResponse(callerPaneRun.stdout);
	if (callerPane === null) return { ok: false, reason: "herdr-caller-pane-unparsable" };
	// The answer must be about the pane we ASKED about. A readable reply describing some other
	// pane carries some other pane's workspace, and using it would open the sibling in a
	// workspace the caller never named — the exact silent relocation this whole policy exists to
	// refuse, arriving through the read instead of through an omitted --workspace.
	if (callerPane.paneId !== context.context.callerPaneId) return { ok: false, reason: "herdr-caller-pane-drift" };
	if (callerPane.workspaceId === undefined) return { ok: false, reason: "herdr-caller-workspace-missing" };

	// ── everything above this line leaves nothing behind ──────────────────────────────────
	const tabRun = await run(
		buildHerdrTabCreateArgs({
			workspaceId: callerPane.workspaceId,
			...(cwd === undefined ? {} : { cwd }),
		}),
	);
	if (tabRun.status !== 0) {
		// WHETHER ANYTHING EXISTS depends on WHO failed, and the stderr says which. herdr's own
		// envelope means herdr answered — it declined before making a tab. NO envelope means we
		// never heard from it at all: `createHerdrRunner` reports its own timeout/kill/spawn
		// failure as the same nonzero status with a plain-text stderr, and a `tab create` we
		// killed mid-flight may well have created the tab. Claiming "nothing was created" there
		// would send an operator away from a tab that is sitting on their screen.
		const code = readHerdrErrorCode(tabRun.stderr);
		return {
			ok: false,
			reason: "herdr-tab-create-failed",
			...(code === undefined ? {} : { herdrErrorCode: code }),
			recovery: code === undefined ? indeterminate() : nothingCreated(),
		};
	}
	const tab = parseHerdrTabCreateResponse(tabRun.stdout);
	if (tab === null) {
		// A tab may exist and its coordinates are precisely what we could not read. Diffing
		// `tab list` to find "the new one" is the guess this rail refuses, so it is NAMED instead.
		return { ok: false, reason: "herdr-tab-create-unparsable", recovery: indeterminate() };
	}
	const pane = tab.rootPane;
	if (pane.hasAgentSession) {
		// A brand-new tab's initial pane holding an agent is not a pane we understand. Starting
		// into it would either be refused by herdr as busy or, worse, land beside somebody else's
		// sibling. Declining here also means the reclaim below correctly REFUSES to close it.
		return { ok: false, reason: "herdr-tab-root-pane-occupied", recovery: await reclaim(pane, run) };
	}

	const agentName = herdrAgentNameFromNonce(nonce);
	const startRun = await run(
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
			recovery: await reclaim(pane, run),
		};
	}
	const started = parseHerdrAgentStartResponse(startRun.stdout);
	if (started === null) {
		return { ok: false, reason: "herdr-agent-start-unparsable", recovery: await reclaim(pane, run) };
	}
	// EVERY reclaim below starts from the TAB-CREATE receipt, never from what the start reported:
	// if those two disagree, the create receipt is the only coordinate we have authority over.
	// The tab is checked too when herdr named one — the whole point of this policy is WHICH tab
	// the sibling is in, so a start that reports another one is the same defect as another pane.
	if (
		started.pane.paneId !== pane.paneId ||
		started.pane.terminalId !== pane.terminalId ||
		(started.pane.tabId !== undefined && started.pane.tabId !== tab.tabId)
	) {
		// Readable, and actionable — so it is not folded into `unparsable`. Something started
		// somewhere other than the pane we opened, and a green receipt would have pointed the
		// caller at a coordinate that never held their sibling.
		return { ok: false, reason: "herdr-agent-start-pane-drift", recovery: await reclaim(pane, run) };
	}
	if (!started.pane.hasAgentSession) {
		// herdr's own start path waits for detection before returning, so a success with no
		// session reference means we were told about a launch that nobody can identify. The
		// VALUE stays unread here — presence is the whole claim.
		return { ok: false, reason: "herdr-agent-start-witness-missing", recovery: await reclaim(pane, run) };
	}
	if (!argvMatchesRequest(started.argv, backend, backendArgs)) {
		// The framing is the argv. A sibling started with a different one is a sibling we did not
		// compose, and nothing downstream would ever reveal it.
		return { ok: false, reason: "herdr-agent-start-argv-drift", recovery: await reclaim(pane, run) };
	}

	return {
		ok: true,
		receipt: {
			backend,
			requestedKind: HERDR_AGENT_KIND[backend],
			model,
			...(cwd === undefined ? {} : { cwd }),
			herdrAgentName: agentName,
			// The tab coordinates come from the reply that CREATED them, not from the start's
			// echo: the create receipt is what the reclaim above is bound to, so the receipt an
			// operator reads and the coordinate we would close must be the same one.
			herdrWorkspaceId: tab.workspaceId,
			herdrTabId: tab.tabId,
			herdrPaneId: started.pane.paneId,
			herdrTerminalId: started.pane.terminalId,
			nonce,
		},
	};
}

function errorCode(stderr: string): { herdrErrorCode?: string } {
	const code = readHerdrErrorCode(stderr);
	return code === undefined ? {} : { herdrErrorCode: code };
}

/** herdr declined by name, so nothing exists to reclaim. Not an unreclaimed orphan: there is no
 * pane, and no `pane get` was attempted. */
function nothingCreated(): HerdrRecovery {
	return { outcome: "none" };
}

/** We cannot say whether a tab exists — our own bound cut the call off, or the reply was
 * unreadable. Nothing is closed, and the receipt says so instead of guessing either way. */
function indeterminate(): HerdrRecovery {
	return { outcome: "unknown" };
}

/** Reclaim the pane we opened — conditionally, or not at all. */
async function reclaim(pane: HerdrPaneFacts, run: HerdrRun): Promise<HerdrRecovery> {
	const getRun = await run(buildHerdrPaneGetArgs(pane.paneId));
	const decision = decideConditionalClose(
		pane,
		getRun.status === 0 ? parseHerdrPaneGetResponse(getRun.stdout) : null,
		getRun.status !== 0,
	);
	if (!decision.close) return { outcome: "orphan-unreclaimed", paneId: pane.paneId, reason: decision.reason };
	const closeRun = await run(buildHerdrPaneCloseArgs(pane.paneId));
	if (closeRun.status !== 0) return { outcome: "orphan-unreclaimed", paneId: pane.paneId, reason: "close-failed" };
	return { outcome: "closed", paneId: pane.paneId, terminalId: pane.terminalId };
}

/** Why each refusal happened, in the caller's terms. A reason a caller cannot act on is a reason
 * they will guess about. The five shared input reasons keep the wording the public verb has always
 * used; the rest are this rail's own. */
const HERDR_REJECT_HINT: Record<HerdrFreshCallRejectReason | HerdrLaunchFailureReason, string> = {
	"caller-identity-unavailable":
		"this surface has no record-backed identity, so a sibling would have nowhere to call home",
	"model-empty": "pass the model you want the sibling opened with — it is never inherited from this process",
	"model-invalid": "the model is not in the accepted grammar (no whitespace, no leading dash)",
	"task-empty": "a sibling opened with nothing to do is a window nobody asked for",
	"task-too-long": `the task is over the ${TASK_MAX_CHARS}-character interface bound this verb shares with entwurf_v2`,
	"herdr-context-missing":
		"HERDR_ENV/HERDR_BIN_PATH are absent, so this process is not inside herdr and this rail does not exist here",
	"herdr-caller-pane-missing":
		"herdr did not give this process a HERDR_PANE_ID, so there is no way to ask herdr which workspace this caller is in",
	"herdr-caller-pane-get-failed":
		"herdr would not report this process's own pane — run `herdr pane get $HERDR_PANE_ID` to see what it says",
	"herdr-caller-pane-unparsable": "herdr's reply about this process's own pane could not be read",
	"herdr-caller-pane-drift":
		"herdr answered about a different pane than HERDR_PANE_ID names, so its workspace says nothing about where this caller is",
	"herdr-caller-workspace-missing":
		"herdr reported this process's pane with no workspace, and guessing one would open the sibling wherever the operator is looking",
	"herdr-backend-unsupported": "this rail opens pi and claude-code only; nothing is opened elsewhere instead",
	"herdr-placement-tmux-rejected":
		"`placement` names a tmux session, which does not exist inside herdr — drop it rather than have the sibling silently placed somewhere else",
	"herdr-argv-control-character":
		"an argument still holds a control character after encoding; herdr refuses those and no pane was created",
	"cwd-not-absolute": "pass an absolute path, or omit cwd to use this agent's own directory",
	"cwd-missing": "the requested start directory does not exist",
	"cwd-not-directory": "the requested start path is not a directory",
	"herdr-tab-create-failed":
		"the tab create did not succeed — read the recovery line below for whether anything exists",
	"herdr-tab-create-unparsable": "herdr's tab reply could not be read, so a tab may exist that this call cannot name",
	"herdr-tab-root-pane-occupied": "the new tab's initial pane already holds an agent, so nothing was started into it",
	"herdr-agent-start-failed": "herdr refused to start the agent in the tab that was just created",
	"herdr-agent-start-unparsable": "herdr's start reply could not be read",
	"herdr-agent-start-pane-drift": "herdr reported a different pane, terminal or tab than the one it just created",
	"herdr-agent-start-witness-missing":
		"herdr reported a start with no agent session, so nothing identifies what was launched",
	"herdr-agent-start-argv-drift": "herdr echoed an argv that is not the one we composed",
};

/** How a recovery reads to an operator who has to decide whether to go look. `[측정 2026-09-15]`
 * closing the tab's only pane takes the tab with it, so the closed line says that — conditionally,
 * because a pane a stranger added meanwhile keeps the tab alive and this rail never closed it. */
function renderRecovery(recovery: HerdrRecovery): string {
	switch (recovery.outcome) {
		case "none":
			return "  recovery: none — herdr declined by name before making anything, so there is nothing to go look at\n";
		case "unknown":
			return "  recovery: UNKNOWN — we never got an answer we can act on, so a tab MAY exist that this call cannot name. Nothing was closed; check herdr\n";
		case "closed":
			return `  recovery: closed ${recovery.paneId} (its terminal still matched the create receipt; the new tab went with it unless something else had joined it)\n`;
		default:
			return `  recovery: orphan-unreclaimed:${recovery.reason} (${recovery.paneId}) — this pane was NOT closed, on purpose\n`;
	}
}

/** The failure header, which must not claim more than the recovery below it knows. An earlier
 * shape said "failed after the tab was created" on EVERY post-attempt failure, including the one
 * whose own hint said nothing was created. */
function renderFailureHeader(recovery: HerdrRecovery): string {
	switch (recovery.outcome) {
		case "none":
			return "entwurf_fresh_call failed at the tab create step";
		case "unknown":
			return "entwurf_fresh_call failed at the tab create step with an UNKNOWN outcome";
		default:
			return "entwurf_fresh_call failed after the tab was created";
	}
}

/**
 * Three outcomes, and an operator must be able to tell them apart at a glance: a refusal that
 * created nothing, a failure that may have left a tab behind, and a launch.
 */
export function renderHerdrFreshCall(result: HerdrFreshCallResult): { text: string; isError: boolean } {
	if (!result.ok) {
		const hint = HERDR_REJECT_HINT[result.reason];
		if (!("recovery" in result)) {
			return {
				text: `entwurf_fresh_call rejected: ${result.reason} — ${hint}. No tab and no pane were created.`,
				isError: true,
			};
		}
		const code = result.herdrErrorCode === undefined ? "" : ` [herdr: ${result.herdrErrorCode}]`;
		return {
			text:
				`${renderFailureHeader(result.recovery)}: ${result.reason}${code} — ${hint}.\n` +
				renderRecovery(result.recovery),
			isError: true,
		};
	}
	const r = result.receipt;
	return {
		text:
			`[entwurf fresh call → herdr]\n` +
			`  backend:  ${r.backend} (requested kind ${r.requestedKind} — herdr resolves the executable, we did not)\n` +
			`  model:    ${r.model} (requested on the runtime CLI)\n` +
			(r.cwd === undefined ? "" : `  cwd:      ${r.cwd} (requested start directory — not an observation)\n`) +
			`  agent:    ${r.herdrAgentName} (herdr's name for it, derived from the nonce)\n` +
			`  tab:      ${r.herdrTabId} in workspace ${r.herdrWorkspaceId} — a NEW tab beside the caller's, opened without taking focus\n` +
			`  pane:     ${r.herdrPaneId} terminal ${r.herdrTerminalId} — the tab's initial pane; herdr VIEW coordinates, not an address\n` +
			`  nonce:    ${r.nonce}\n` +
			`\n` +
			`This is a LAUNCH receipt: herdr created a tab and was asked to start the agent above in it. It does NOT ` +
			`mean the sibling is running, that its first turn ran, or that the task was delivered. The tab and pane ` +
			`coordinates are a view and can change under the sibling — they are not an address and nothing may be ` +
			`dispatched to them.\n` +
			`The sibling's garden id arrives separately — it calls entwurf_v2 back with the nonce above as its first ` +
			`action, and the sender envelope of THAT message is the address. Nothing is polling for it; if it never ` +
			`comes, the pane is visible and can be read directly.`,
		isError: false,
	};
}

/** How long a herdr command may take. `[측정, herdr 0.9.0 `agent start --help`]` the start verb waits
 * for interactive readiness with a default of 30s and a documented ceiling of 300s, so the start
 * bound is that ceiling: cutting it shorter would kill a launch herdr was still legitimately
 * waiting on. Every other verb is a socket round trip and gets the short bound. */
export const HERDR_START_TIMEOUT_MS = 300_000;
export const HERDR_CLI_TIMEOUT_MS = 30_000;

/** How much of one herdr reply we are willing to hold. Every verb on this rail answers with one
 * JSON object; a stream larger than this is not a reply we can parse, and an unbounded buffer would
 * let a runaway child take the caller's memory with it. Overflow is reported as the same
 * nonzero-status shape as any other failure rather than truncated into a parse we would believe. */
export const HERDR_MAX_OUTPUT_BYTES = 8 * 1024 * 1024;

/** The three bounds one herdr call runs under. Defaulted from the constants above; injectable only
 * so a gate can reach the kill and the cap on a REAL child process quickly. */
export interface HerdrRunnerBounds {
	readonly startMs: number;
	readonly cliMs: number;
	readonly maxOutputBytes: number;
}

/**
 * The production runner: argv array, no shell, explicit env, bounded — and ASYNCHRONOUS.
 *
 * WHY IT MUST NOT BLOCK `[측정 2026-09-14, C4 첫 LIVE]`. The first thing a sibling does is call its
 * caller back on the caller's own control socket. On this rail the caller is, at that exact moment,
 * inside `agent start` waiting for herdr to report readiness — up to 300s. A SYNCHRONOUS child wait
 * holds the caller's event loop for that whole window, so the callback cannot be read, the sender
 * times out and hangs up, and the caller's late reply then lands on a socket whose peer is gone.
 * The runner is therefore async: the child runs while the loop keeps serving sockets and timers.
 *
 * A spawn that never produced an exit status (binary missing, timeout, signal) is mapped to a
 * nonzero status with the failure on stderr — the SAME shape herdr's own error path produces, so
 * the rail above has one thing to read. Nothing here looks at a terminal.
 *
 * The timeout KILLS: a bound that only stops waiting would leave the child holding a pane while we
 * report it gone. SIGKILL, because a bound we cannot enforce is not a bound. Exactly one settle —
 * `close`, `error` and the timeout all race, and whichever arrives first is the only answer.
 */
export function createHerdrRunner(
	bin: string,
	env: NodeJS.ProcessEnv,
	spawn: SpawnFn,
	// The production bounds ARE the exported constants; this parameter exists so a gate can prove
	// the kill and the cap on a real child within a gate's patience instead of waiting 30 seconds
	// for them. The composition root passes nothing, and a structural cell keeps it that way — a
	// caller who could shorten the start bound could kill a launch herdr was still waiting on.
	bounds: HerdrRunnerBounds = {
		startMs: HERDR_START_TIMEOUT_MS,
		cliMs: HERDR_CLI_TIMEOUT_MS,
		maxOutputBytes: HERDR_MAX_OUTPUT_BYTES,
	},
): HerdrRun {
	return (args) => {
		const timeout = args[0] === "agent" && args[1] === "start" ? bounds.startMs : bounds.cliMs;
		return new Promise((resolve) => {
			let stdout = "";
			let stderr = "";
			let settled = false;
			const child = spawn(bin, [...args], { env, shell: false });

			const settle = (result: { status: number; stdout: string; stderr: string }) => {
				if (settled) return;
				settled = true;
				clearTimeout(timer);
				resolve(result);
			};
			const failed = (why: string, out = stdout) =>
				settle({ status: 1, stdout: out, stderr: `herdr ${args.join(" ")}: ${why}` });

			const timer = setTimeout(() => {
				child.kill("SIGKILL");
				failed(`no exit status (timeout ${timeout}ms or signal null)`);
			}, timeout);
			// The bound must not itself keep this process alive once the answer is in.
			timer.unref?.();

			const collect = (into: "stdout" | "stderr") => (chunk: Buffer | string) => {
				const text = typeof chunk === "string" ? chunk : chunk.toString("utf8");
				if (into === "stdout") stdout += text;
				else stderr += text;
				if (stdout.length + stderr.length <= bounds.maxOutputBytes) return;
				child.kill("SIGKILL");
				failed(`output exceeded ${bounds.maxOutputBytes} bytes`, "");
			};
			child.stdout?.on("data", collect("stdout"));
			child.stderr?.on("data", collect("stderr"));

			child.on("error", (error: Error) => failed(error.message, ""));
			child.on("close", (code: number | null, signal: NodeJS.Signals | null) => {
				if (code === null) {
					// Killed by a signal: herdr said nothing, so we say that rather than inventing
					// an exit code that would read as herdr's own refusal.
					failed(`no exit status (timeout ${timeout}ms or signal ${String(signal)})`);
					return;
				}
				settle({ status: code, stdout, stderr });
			});
		});
	};
}

/** The narrow shape of `node:child_process` `spawn` this runner needs, injected so the gate can
 * drive the REAL runner with a real child process and no herdr binary. Structural on purpose: the
 * production value is node's own `spawn`, and nothing here is a stand-in for one. */
export interface SpawnedHerdrProcess {
	readonly stdout: { on(event: "data", listener: (chunk: Buffer | string) => void): unknown } | null;
	readonly stderr: { on(event: "data", listener: (chunk: Buffer | string) => void): unknown } | null;
	on(event: "error", listener: (error: Error) => void): unknown;
	on(event: "close", listener: (code: number | null, signal: NodeJS.Signals | null) => void): unknown;
	kill(signal?: NodeJS.Signals): boolean;
}

export type SpawnFn = (
	bin: string,
	args: string[],
	opts: { env: NodeJS.ProcessEnv; shell: false },
) => SpawnedHerdrProcess;
