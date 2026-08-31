/**
 * meta-bridge-omp — the OMP (oh-my-pi) native-session BIRTH entry (#87).
 *
 * WHAT THIS IS, AND WHAT IT DELIBERATELY IS NOT
 *
 * It mints the visible host session, then names the minted citizen as this host's SENDER:
 *
 *   session_start | session_switch   (omp in-process extension events)
 *     -> mode === "tui" ?            the §3.5 discriminator — the ONE new predicate in this lane
 *        -> roots()                  the shared OMP four-root policy, resolved in code
 *        -> upsertMetaSession(omp)   idempotent create/attach the record
 *           -> gardenId              the session's garden address
 *        -> writeMetaSenderMarker(process.pid)   who-sent join for this host's MCP children
 *        -> ctx.ui.setStatus(...)    visible identity (step 4)
 *     -> any other mode              REFUSE + log. A task subagent is not a citizen.
 *
 * No receiver marker, no mailbox arm — omp's receive rail is a separate admission (#87
 * bundle B). A receiver marker is a claim that a LIVE process holds a watch; nothing
 * installed by this unit holds one, and minting it here would make a citizen read
 * deliverable while wired to nothing.
 *
 * WHY THIS FILE IS AN EXTENSION FACTORY AND NOT AN EXEC'd PAYLOAD. `[source]` omp
 * "hooks" are an in-process EXTENSION event bus — `--hook` is an alias of `--extension`,
 * a module default-exporting `(pi: ExtensionAPI) => void`, and handlers receive
 * `(event, ctx)` (oh-my-pi v18.0.0 `docs/hooks.md` "Current status in runtime";
 * `packages/coding-agent/src/extensibility/extensions/types.ts:1186`, `:1592`). There is
 * no stdin envelope and no per-event child process, so the Claude/Copilot launcher pair
 * (`hook-launch.sh` + `exec`) has nothing to do here: this code already runs INSIDE the
 * omp process. That is also what makes the step-6 join a ONE-process join — see
 * resolveOmpOwnerPid below.
 *
 * THE SCOPE FENCE IS `mode === "tui"`, AND IT IS LOAD-BEARING. `[source]` Every task
 * subagent re-emits its own `session_start` (`task/executor.ts:3305`) against a fresh
 * per-session extension API (`sdk.ts:2000-2028`), and bundled agents do NOT set
 * `restrictToolNames`, so this very factory is re-executed inside subagents by default.
 * Same OS pid therefore does not prevent minting — only the mode does. Only the
 * interactive TUI controller passes `"tui"` (`modes/controllers/extension-ui-controller.ts:302`;
 * `:531` is test-only), the runner default is `"print"` (`runner.ts:438`, `:651`), and
 * rpc / rpc-ui / `omp acp` all pass `"rpc"`. `ctx.hasUI` is NOT a fence and must never be
 * used as one: rpc, rpc-ui and ACP all hand the runner a real uiContext, so `hasUI` is
 * true there (`runner.ts:879-881`) while the `types.ts:465` comment says otherwise —
 * a live instance of the docs-vs-code trap. `[LIVE 2026-08-27]` host
 * `{mode:"tui",hasUI:true}` vs a real task subagent `{mode:"print",hasUI:false}` on the
 * SAME pid 479624, record store 519 before == 519 after
 * (`scripts/raw-omp-measure/README.md` §3.5).
 *
 * `session_shutdown` IS NOT WIRED, AND THAT IS NOT AN OVERSIGHT. `[LIVE 2026-08-27]` on
 * `/exit` a `session_shutdown` arrived with a `"print"` context BEFORE the tui one, in the
 * same run — shutdown events are not host-scoped. It is not a birth edge, so nothing here
 * listens to it; a future unit must not read it as one either.
 *
 * BOTH BIRTH EDGES, BECAUSE THE NAME DOES NOT TELL YOU WHEN IT FIRES. `[source, audited
 * C1/C2]` The TUI host fires `session_start` once per process, after first paint and
 * before the first prompt (`interactive-mode.ts:1221`, `:1238`,
 * `extension-ui-controller.ts:309-311`) — no model turn required. `/new`, fork and in-TUI
 * resume then re-fire as `session_switch` (reasons `"new"`/`"fork"`/`"resume"`,
 * `agent-session.ts:6910-8074`), NOT as `session_start`. A birth unit wired only to
 * `session_start` would leave every post-`/new` session unminted, still showing the
 * previous citizen's id in the status line. The upsert is idempotent and keyed by the
 * native session id, so the switch edge attaches when the id is unchanged and mints the
 * replacement's own record when it changed — the same rule pi's in-process replacement
 * already follows.
 *
 * FAILURE POLICY, inherited from the Claude and Copilot units: BEST-EFFORT + LOG. Never
 * throw into the operator's TUI, never block a turn. On any error append a level-tagged
 * line to `<omp garden root>/meta-bridge-hook.log` (see `roots()` — the OMP root policy,
 * NOT `PI_CODING_AGENT_DIR`) — the same file the other native units
 * append to, tagged `[omp]` so one grep still covers the host and each doctor stays
 * rail-scoped (`scripts/meta-bridge-hook-log.sh`). The fail-loud surface is
 * `./run.sh doctor-omp-bridge`, which reads that log.
 *
 * LAUNCH: the installer places this file as `index.ts` inside
 * `<omp agent dir>/extensions/entwurf-meta-omp/`, which is one of omp's three native
 * discovery rules — a subdirectory whose entry is `index.{ts,js}` (`discovery/builtin.ts:483`
 * → `discovery/helpers.ts:625-712`, preference at `:700-710`). Nothing is baked into this
 * file and nothing declares a path to it: the rule needs only the name.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import {
	isPlausibleOwnerPid,
	type MetaRootBundle,
	ompMetaRootBase,
	ompMetaRoots,
	requireGardenId,
	upsertMetaSession,
	writeMetaSenderMarker,
} from "./lib/meta-session.ts";

/**
 * The §3.5 host discriminator. THE one new predicate this whole lane is allowed to
 * introduce, and it is the vendor's own top-level mode — not a heuristic over cwd,
 * process age, pid or session id. If a vendor upgrade flips it, STOP and remeasure
 * (issue #87 stop rule); do not add a second predicate beside it.
 */
const HOST_MODE = "tui";

/** Our own status key, owned exactly. Hook status text is stored per key and sorted by
 * key name (`docs/hooks.md` "Status line behavior"), so this string is the whole extent
 * of our claim on the operator's status line. */
const STATUS_KEY = "entwurf";

/** The backend id this unit mints under. Registered in `META_BACKENDS` (#87 A1). */
const BACKEND = "omp" as const;

// ---------------------------------------------------------------------------
// THE TWO-STAGE FRESH BOOTSTRAP (#87 Bundle C).
//
// WHY THE POSITIONAL PROMPT HAD TO GO, MEASURED RATHER THAN ARGUED. `[LIVE 2026-08-30]`
// the first public `entwurf_fresh_call` at omp handed the whole fresh prompt to the vendor
// as a bare positional argument. The window opened, the record minted
// (garden `20260830T181342-452167`, native `01a051f2-3107-7147-8806-fa2a6f527610`), the
// byte-identical prompt arrived as a user message at `09:13:42.413Z` — and the model
// answered the literal text `ACK` at `09:13:47.105Z` with ZERO tool calls, because the
// callback tool did not exist yet. The caller timed out at 240s and the pane took a SIGHUP.
//
// `[source]` The gap is structural, not a slow host. The interactive UI DEFERS MCP
// discovery (`sdk.ts:1847-1855`), starts `discoverAndConnect()` fire-and-forget and only
// calls `session.refreshMCPTools()` once it settles (`sdk.ts:1881-1905`), while
// `session_start` is awaited inside `mode.init()` (`extension-ui-controller.ts:302-312`)
// and the positional `initialMessage` prompts immediately after `await mode.init()`
// (`main.ts:540-565`, `595-610`). `[측정 2026-08-30]` a `/tmp` observer on the same bare
// runtime: `turn_start` at +654ms with the entwurf tools ABSENT, callback tool present only
// at +1484ms. The turn began ~830ms before the tool it was told to call existed.
//
// SO THE FIRST TURN IS NOT COMPOSED BY ARGV ANY MORE. The launcher carries a payload on a
// fixed registered flag, and THIS unit — already in-process, already the thing that knows
// when the session is real — waits for the callback tool, sends a callback-ONLY prompt, and
// releases the task only after it has seen that exact call succeed:
//
//   argv `--entwurf-bootstrap <payload>`   fixed, one purpose, registered before argv parse
//     -> session_start (mode === "tui")    the same fence birth already owns
//        -> record + sender marker         AUTHORITY FIRST, exactly as before
//        -> decode + validate payload      refuse narrowly; a bad payload never starts a turn
//        -> bounded readiness poll         getAllTools(source==="mcp") AND getActiveTools()
//        -> sendUserMessage(callback-only) NO task, no ACK, no competing goal
//        -> tool_call  exact name+target+nonce   remember toolCallId
//        -> tool_result same id, isError===false -> release, THEN sendUserMessage(task)
//
// `[측정 2026-08-30]` the callback-only half is the half that was proven: model
// `openai-codex/gpt-5.6-sol`, no positional task, tool present at +1105ms, prompt injected at
// +1107ms, and the sibling called `mcp__entwurf_bridge_entwurf_v` with the exact nonce
// (`omp-cb-btkvva4r87` -> `20260830T184054-1aa1f2`, result `meta-mailbox → enqueued`) with no
// ACK/DONE competition anywhere in the transcript. That is why the task is a SECOND message
// and not a clause in the first one.
//
// THE FLAG IS ONE PURPOSE AND NOT A CARRIER. `[측정 2026-08-30]` a normal discovered
// extension that calls `registerFlag` at factory time receives the operator's argv value
// byte-identical — quotes, `$VAR`, backticks and a semicolon all survived a 137-byte JSON
// payload — because extensions load BEFORE argv classification and `applyExtensionFlags`
// reparses with the registered map (`main.ts:1799-1810`, `cli/extension-flags.ts:36-43`,
// `extensions/loader.ts:221-228`). That is also why nothing here reads `process.env` or a
// temp file: argv owns its own quoting, and a general env/command carrier would hand callers
// the environment-shaping power the fresh rail exists to refuse.
// ---------------------------------------------------------------------------

/** The ONE argv flag this unit owns. Registered without the leading dashes — the vendor's
 * flag map is keyed by bare name (`extensions/loader.ts:221-228`). */
export const OMP_BOOTSTRAP_FLAG = "entwurf-bootstrap";

/** Payload grammar version. A payload that does not say exactly this is refused rather than
 * best-guessed: the launcher and this unit ship in the same package, so a mismatch means a
 * STALE installed unit — the one condition `doctor-omp-bridge` exists to name out loud. */
export const OMP_BOOTSTRAP_VERSION = 1;

/**
 * The model-facing callback tool, spelled for omp. `[측정]` the vendor's minter sanitises to
 * `[a-z_]` and EATS the digit in `entwurf_v2` (`mcp/tool-bridge.ts:384-396`;
 * `scripts/raw-omp-measure/README.md` "Tool-name dialect").
 *
 * It is duplicated from `FRESH_CALL_CALLBACK_TOOL.omp` ON PURPOSE and the duplication is
 * GATED. This file is copied into `<omp agent dir>/extensions/entwurf-meta-omp/` with only
 * `lib/meta-session` and `lib/session-id` beside it, so it cannot import the launcher's
 * module; the alternative — growing the installed unit's closure by a file — grows the
 * installer, the doctor's parity list and two artifact manifests for a constant. The two
 * spellings are held equal by `test/omp-fresh-bootstrap.contract.test.ts`, the same shape
 * `check-omp-fresh-preflight` already uses for the preflight's reproduced oracles.
 */
export const OMP_BOOTSTRAP_CALLBACK_TOOL = "mcp__entwurf_bridge_entwurf_v";

/** Task ceiling, held equal to the launcher's `TASK_MAX_CHARS` by the same contract test. */
export const OMP_BOOTSTRAP_TASK_MAX_CHARS = 16000;

/** How long readiness may take before this bootstrap FAILS and the task is never sent.
 * `[측정]` the tool appeared at +1484ms and +1105ms on the two observed runs; this is two
 * orders of margin over that, and still well inside the caller's own 240s callback wait, so
 * a timeout here surfaces as an honest fresh-call timeout rather than a silent hang. */
export const OMP_BOOTSTRAP_READY_TIMEOUT_MS = 60_000;

/** Readiness poll period. There is NO public MCP-ready event in v18.0.0 — the only
 * mechanisms are the private `MCPManager#setOnToolsChanged` (`mcp/manager.ts:296-306`) and
 * `ExtensionRunner#onToolRegistered`, which fires for extension-registered tools rather than
 * MCP ones (`runner.ts:907-978`). Polling the two public snapshots is the smallest honest
 * primitive; a FIXED DELAY is forbidden because the gap is a race, not a constant. */
export const OMP_BOOTSTRAP_POLL_MS = 100;

/** The nonce the launcher mints (`mintNonce`: `mux-fresh-call-` + 12 random bytes as hex). */
const BOOTSTRAP_NONCE_RE = /^mux-fresh-call-[0-9a-f]{24}$/;

/** What the launcher put on the flag. Exactly three fields — a target to call back to, the
 * correlation nonce, and the operator's task. Nothing here is a command, a path or an env
 * name, and the decoder refuses anything wider. */
export interface OmpBootstrapPayload {
	target: string;
	nonce: string;
	task: string;
}

/** Every way a payload can be refused. Each is logged verbatim, because each names a
 * different repair: a stale unit, a launcher bug, or an operator who typed the flag by hand. */
export type OmpBootstrapRejectReason =
	| "flag-absent"
	| "flag-not-string"
	| "payload-not-json"
	| "payload-not-object"
	| "version-unsupported"
	| "payload-unknown-key"
	| "target-invalid"
	| "nonce-invalid"
	| "task-empty"
	| "task-too-long";

export type OmpBootstrapDecode =
	| { ok: true; value: OmpBootstrapPayload }
	| { ok: false; reason: OmpBootstrapRejectReason };

/** The wire keys, closed. An unknown key is a REFUSAL rather than an ignored extra: this
 * flag is the one thing a caller can put arbitrary bytes into, so the decoder's job is to
 * make "what the launcher meant" and "what this unit will act on" the same set. */
const BOOTSTRAP_KEYS = new Set(["v", "target", "nonce", "task"]);

/**
 * Read the flag value into a payload, or name why not.
 *
 * `getFlag` returns `boolean | string | undefined` and only for flags THIS extension
 * registered (`extensions/loader.ts:253-255`), so a `string` check is a real discriminator
 * and not a formality. `target` is validated by the SHARED record validator rather than a
 * local regex — the callback has to reach a garden id the store would accept, and a second
 * spelling of that rule here is a second place for it to drift.
 */
export function decodeOmpBootstrapPayload(raw: unknown): OmpBootstrapDecode {
	if (raw === undefined) return { ok: false, reason: "flag-absent" };
	if (typeof raw !== "string" || raw.length === 0) return { ok: false, reason: "flag-not-string" };
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		return { ok: false, reason: "payload-not-json" };
	}
	if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
		return { ok: false, reason: "payload-not-object" };
	}
	const obj = parsed as Record<string, unknown>;
	if (obj.v !== OMP_BOOTSTRAP_VERSION) return { ok: false, reason: "version-unsupported" };
	for (const key of Object.keys(obj)) {
		if (!BOOTSTRAP_KEYS.has(key)) return { ok: false, reason: "payload-unknown-key" };
	}
	let target: string;
	try {
		target = requireGardenId(obj.target);
	} catch {
		return { ok: false, reason: "target-invalid" };
	}
	const nonce = obj.nonce;
	if (typeof nonce !== "string" || !BOOTSTRAP_NONCE_RE.test(nonce)) return { ok: false, reason: "nonce-invalid" };
	const task = obj.task;
	if (typeof task !== "string" || task.trim().length === 0) return { ok: false, reason: "task-empty" };
	if (task.length > OMP_BOOTSTRAP_TASK_MAX_CHARS) return { ok: false, reason: "task-too-long" };
	return { ok: true, value: { target, nonce, task } };
}

/**
 * Stage one's whole message: call back, and nothing else.
 *
 * THE ABSENCE OF THE TASK IS THE FEATURE. `[측정 2026-08-30]` the failed LIVE asked for the
 * callback AND carried the task in the same prompt, and the model answered `ACK` — one
 * observation, confounded by the missing tool, but the reference run that DID work carried
 * no competing goal at all. Stage two exists so this message never has to compete with the
 * work; adding "then do X" back into it would rebuild exactly the prompt that failed.
 */
export function buildOmpCallbackOnlyPrompt(params: { target: string; nonce: string }): string {
	return [
		"You are a fresh visible citizen that entwurf opened in the operator's tmux session.",
		"",
		`FIRST AND ONLY ACTION RIGHT NOW: call ${OMP_BOOTSTRAP_CALLBACK_TOOL} with ` +
			`target=${params.target}, intent=fire-and-forget, wants_reply=false, and ` +
			`message set to exactly ${params.nonce} — that string alone, nothing added.`,
		"That call is how the agent that opened you learns your address. Make the call before",
		"reading files, before planning, and before answering in prose. Do not reword the message.",
		"",
		"Do not inspect environment variables, do not call entwurf_self, and do not start an MCP",
		"server yourself. Your own report of your identity is not the address anyone needs.",
		"",
		"Your actual task arrives as the NEXT user message, immediately after that call succeeds.",
		"Do not ask for it and do not guess at it.",
	].join("\n");
}

/**
 * WHERE THIS UNIT WRITES — the shared OMP four-root policy, resolved in CODE (#87 B1).
 *
 * `PI_CODING_AGENT_DIR` means "pi's persistence root" to entwurf and "my agent dir" to
 * the OMP vendor, and `setProfile` exports it for every named profile
 * (`oh-my-pi` v18.0.0 `packages/utils/src/dirs.ts:452-473`). A unit that let the shared
 * default resolve its roots would send an `omp --profile work` session's record and marker
 * into a different garden store — into a pi sandbox, if that is where the value came from.
 *
 * IT HAS TO BE CODE HERE, and that is the structural half of the fix. This extension runs
 * IN-PROCESS inside the omp host, so there is no exec for a launcher to sanitise: nothing
 * outside this file can repair the environment before the first write. The bridge CHILD
 * half of the same policy lives in `applyOmpBridgeChildRootPolicy`, and both read the same
 * pure leaf so their agreement is by construction rather than by coincidence.
 *
 * Resolved per call rather than once at module load: the factory is re-executed per
 * session (including inside subagents), and a cached root would outlive the context that
 * justified it.
 */
function roots(): MetaRootBundle {
	return ompMetaRoots();
}

/**
 * Where the diagnostic log goes — and it must resolve even when the ROOT POLICY REFUSED
 * this environment (a relative `ENTWURF_META_*` override, #87 A2). That refusal is exactly
 * the moment an operator needs a line to read, so it must never be the moment logging
 * disappears. A hook log is a diagnostic, not a garden artifact, so falling back to the
 * policy's own unambiguous base is honest: it never consults the refused override, and it
 * never consults `PI_CODING_AGENT_DIR`.
 */
function hookLogFile(): string {
	try {
		return path.join(path.dirname(roots().sessionsDir), "meta-bridge-hook.log");
	} catch {
		return path.join(ompMetaRootBase(), "meta-bridge-hook.log");
	}
}

// ---------------------------------------------------------------------------
// Vendor surface, typed NARROWLY and locally.
//
// omp is not a dependency of this repo and its types are not published here, so the
// shapes below are hand-written from the measured v18.0.0 source rather than imported.
// They are deliberately the SMALLEST subset this unit touches: a wider mirror would rot
// silently at the next vendor release, and every field named here has a receipt.
// ---------------------------------------------------------------------------

/** `ReadonlySessionManager` — `session-manager.ts:359-376` (`getSessionId` `:1946-1948`,
 * `getSessionFile` `:1950-1952` returns `string | undefined` because persistence is lazy,
 * `getCwd`). */
interface OmpReadonlySessionManager {
	getSessionId(): unknown;
	getSessionFile(): unknown;
	getCwd(): unknown;
}

/** `ExtensionUIContext.setStatus` — `types.ts:285`, called as `ctx.ui.setStatus(key, text)`
 * (`docs/hooks.md` "Status line behavior"). It is the ONLY rendering surface at v18:
 * `setFooter`/`setHeader` are literal TUI no-ops (`extension-ui-controller.ts:139`) and the
 * built-in statusLine segment set is a closed enum with no custom/command segment
 * (`status-line/segments.ts:731-757`). */
interface OmpExtensionUiContext {
	setStatus(key: string, text: string | undefined): void;
}

/**
 * `ExtensionContext` — `types.ts:455-480`. `mode` is `"tui" | "rpc" | "json" | "print"`.
 *
 * `setTimeout` and `clearTimer` are the VENDOR-OWNED timer surface (`types.ts:501-509`): a
 * `ctx.setTimeout` is registered against the session and cleared automatically on
 * `session_shutdown`, and `clearTimer` is the only canceller this vendor exposes. They are
 * optional here on the same terms as every other vendor member — a build that drops one must
 * cost this unit a logged refusal, never a throw into the operator's TUI. The receive unit
 * reached that rule first, for the same reason (`meta-bridge-receive-omp.ts:423-436`).
 */
interface OmpExtensionContext {
	mode: unknown;
	cwd: unknown;
	ui?: Partial<OmpExtensionUiContext>;
	sessionManager?: OmpReadonlySessionManager;
	setTimeout?(fn: () => void, ms: number): unknown;
	clearTimer?(handle: unknown): void;
}

/** The two birth edges. `SessionSwitchEvent` carries `reason` (`shared-events.ts:42-49`);
 * `SessionStartEvent` carries nothing but its type (`:28-31`). */
interface OmpSessionEvent {
	type?: unknown;
	reason?: unknown;
}

/**
 * `tool_call` — fired BEFORE a tool executes (`extensions/types.ts:916-964`, emitted at
 * `session/agent-session.ts:3431-3467` and `extensions/wrapper.ts:171-220`). An MCP tool
 * arrives on the `CustomToolCallEvent` arm: `toolName` is a plain string and `input` a plain
 * record. `[source]` there is NO `serverName`, no original MCP tool name, no session id and
 * no mode on the event — which is precisely why the fence below is built from the handler's
 * `ctx`, and the match from the tool's own arguments.
 */
interface OmpToolCallEvent {
	toolCallId?: unknown;
	toolName?: unknown;
	input?: unknown;
}

/**
 * `tool_result` — fired AFTER execution (`extensions/types.ts:966-1017`,
 * `extensions/wrapper.ts:348-414`). Every runtime tool is wrapped when a runner exists
 * (`session/session-tools.ts:523-527`) and the MCP refresh path wraps its adapters too
 * (`:1649-1684`), so an MCP callback reaches BOTH events. `isError` is the vendor's own
 * success axis and MCP protocol errors set it (`mcp/tool-bridge.ts:230-275`).
 */
interface OmpToolResultEvent extends OmpToolCallEvent {
	isError?: unknown;
}

/** `ToolInfo` as `getAllTools()` returns it (`session/session-tools.ts:497-514`). The only
 * field this unit reads besides the name is the MCP provenance. */
interface OmpToolInfo {
	name?: unknown;
	sourceInfo?: { source?: unknown } | null;
}

/**
 * `ExtensionAPI`, still the SMALLEST subset this unit touches — now four more members than
 * the birth-only version, each with its receipt:
 *
 *   `registerFlag`   `extensions/types.ts:1367-1381`; stored at `loader.ts:221-228`.
 *   `getFlag`        `loader.ts:253-255` — returns only flags THIS extension registered.
 *   `getAllTools`    `types.ts:1429-1436` -> `ToolInfo[]` with `sourceInfo.source`.
 *   `getActiveTools` `extension-ui-controller.ts:185-187` -> enabled tool NAMES.
 *   `sendUserMessage` `types.ts:1417-1421`; delivery semantics at `agent-session.ts:6509-6556`.
 *
 * Every one is OPTIONAL here. `[source]` action methods throw
 * `ExtensionRuntimeNotInitializedError` until the runner initialises (`loader.ts:65-112`), and
 * a vendor that renames or drops one must cost this unit a logged WARN — never a throw into
 * the operator's TUI, which is this file's standing failure policy.
 */
interface OmpExtensionApi {
	on(
		event: "session_start" | "session_switch",
		handler: (event: OmpSessionEvent, ctx: OmpExtensionContext) => void,
	): void;
	on(event: "tool_call", handler: (event: OmpToolCallEvent, ctx: OmpExtensionContext) => void): void;
	on(event: "tool_result", handler: (event: OmpToolResultEvent, ctx: OmpExtensionContext) => void): void;
	/** `turn_end` — `{turnIndex, message, toolResults}` and nothing session-identifying
	 * (`extensibility/shared-events.ts:211-217`; emitted at `agent-session.ts:3607-3620`). */
	on(event: "turn_end", handler: (event: unknown, ctx: OmpExtensionContext) => void): void;
	registerFlag?(
		name: string,
		options: { description?: string; type: "boolean" | "string"; default?: boolean | string },
	): void;
	getFlag?(name: string): boolean | string | undefined;
	getAllTools?(): readonly OmpToolInfo[];
	getActiveTools?(): readonly string[];
	sendUserMessage?(content: string, options?: { deliverAs?: "steer" | "followUp" }): void;
}

type LogLevel = "INFO" | "WARN" | "ERROR";

/** Append a best-effort diagnostic line; swallow even its own failure. Same log file and
 * same LEVEL vocabulary as the Claude and Copilot units, tagged `[omp]`. */
function logLine(level: LogLevel, message: string): void {
	try {
		const file = hookLogFile();
		fs.mkdirSync(path.dirname(file), { recursive: true });
		fs.appendFileSync(file, `${new Date().toISOString()} ${level} [omp] ${message}\n`);
	} catch {
		/* logging is best-effort; a broken log must not break the session */
	}
}

/** The two fields birth needs plus the one nullable axis the vendor can supply. */
export interface OmpBirthEnvelope {
	nativeSessionId: string;
	cwd: string;
	/** `getSessionFile()` when the vendor already has a path for it, else null. */
	transcriptPath: string | null;
}

function asNonEmptyString(value: unknown): string {
	return typeof value === "string" && value.length > 0 ? value : "";
}

/**
 * Reduce the vendor context to the fields birth needs, or refuse.
 *
 * REFUSE A DEGRADED ENVELOPE; NEVER GUESS A FIELD (`adding-a-harness.md` step 3(c)). A
 * record minted from a guessed id is a citizen no live session can be joined back to.
 *
 * `cwd` HAS TWO VENDOR SOURCES AND THEY MUST AGREE. `ctx.cwd` (`types.ts:470`) and
 * `ctx.sessionManager.getCwd()` are both vendor-authoritative, so `a ?? b` would silently
 * pick a winner exactly when the disagreement is the interesting fact. Both present and
 * equal is fine, one present is fine, both present and different is a REFUSAL — the same
 * rule the Copilot unit applies to its two envelope shapes. There is deliberately no
 * `process.cwd()` fallback: this process is the omp host, whose cwd may be anything the
 * operator launched it from.
 *
 * `transcriptPath` is nullable at mint by design and is NOT refused when absent:
 * `getSessionFile()` is lazy and may legitimately name nothing yet (`session-manager.ts:1950-1952`).
 * `model` is omitted rather than guessed, exactly as the Copilot unit omits it.
 */
export function readBirthEnvelope(ctx: OmpExtensionContext): OmpBirthEnvelope | { refusal: string } {
	const manager = ctx.sessionManager;
	if (!manager || typeof manager.getSessionId !== "function") {
		return { refusal: "ctx.sessionManager is missing or has no getSessionId()" };
	}
	let rawId: unknown;
	let rawManagerCwd: unknown;
	let rawFile: unknown;
	try {
		rawId = manager.getSessionId();
		rawManagerCwd = typeof manager.getCwd === "function" ? manager.getCwd() : undefined;
		rawFile = typeof manager.getSessionFile === "function" ? manager.getSessionFile() : undefined;
	} catch (err) {
		return { refusal: `ctx.sessionManager threw: ${err instanceof Error ? err.message : String(err)}` };
	}
	const nativeSessionId = asNonEmptyString(rawId);
	if (!nativeSessionId) return { refusal: "sessionManager.getSessionId() is not a non-empty string" };

	const ctxCwd = asNonEmptyString(ctx.cwd);
	const managerCwd = asNonEmptyString(rawManagerCwd);
	if (ctxCwd && managerCwd && ctxCwd !== managerCwd) {
		return { refusal: `ctx.cwd and sessionManager.getCwd() disagree (${ctxCwd} vs ${managerCwd})` };
	}
	const cwd = ctxCwd || managerCwd;
	if (!cwd) return { refusal: "neither ctx.cwd nor sessionManager.getCwd() is a non-empty string" };

	return { nativeSessionId, cwd, transcriptPath: asNonEmptyString(rawFile) || null };
}

/**
 * Which pid does a sender marker written here belong to — or NONE.
 *
 * THE JOIN IS ONE PROCESS, NOT TWO. `[source]` omp spawns its stdio MCP servers from the
 * host process itself; on Linux `detached: true` means setsid only, so the child keeps omp
 * as its parent (`mcp/transports/stdio.ts:41-57`, `:334`). The extension runs in that same
 * host process (there is no launcher to `exec` through), so the pid the bridge child will
 * look its marker up under is OUR OWN `process.pid` — not `process.ppid`, which here is the
 * shell that started omp. `[LIVE 2026-08-27]` `479023 -bash` → `479624 omp` (probe pid ==
 * omp pid) → `479695 node …/entwurf-bridge/src/index.ts` with ppid 479624
 * (`scripts/raw-omp-measure/README.md` M5).
 *
 * THE THREE GUARDS ARE ALL STILL ASKED; ONE OF THEM IS ANSWERED BY A DIFFERENT VENDOR FACT.
 *   0. PLAUSIBLE OWNER — `isPlausibleOwnerPid`, the predicate shared with every marker
 *      writer, reader and the generation cut (#53 A). Asked here, and asked again inside
 *      `writeMetaSenderMarker`.
 *   1. PID + START-KEY LIVENESS — stamped by `writeMetaSenderMarker` itself
 *      (`ownerStartKey`), so a dead session's reused pid cannot inherit its garden id.
 *   2. THE BACKING RECORD — the marker is written INSIDE the successful-upsert branch
 *      below, never before it.
 * The Claude and Copilot units add a fourth, LAUNCH PROVENANCE check
 * (`ENTWURF_META_HOOK_LAUNCH`), because their payload is a separate process that has to
 * prove its parent really is the harness. That question cannot arise here — this code is
 * not a child of the host, it IS the host — and the matching question that CAN arise ("is
 * this omp process the operator-visible session, or a task subagent borrowing my factory?")
 * is answered by the vendor's own `mode === "tui"` before this function is ever reached.
 * That is a substitution of a measured vendor fact for another rail's measured vendor fact,
 * not a dropped guard: if the mode fence is ever removed, this marker writer becomes wrong
 * in the same breath as the mint.
 */
function resolveOmpOwnerPid(): number | null {
	const ownerPid = process.pid;
	if (!isPlausibleOwnerPid(ownerPid)) return null;
	return ownerPid;
}

/**
 * Arm who-sent for this host's MCP children, or say in the log why it could not be.
 *
 * BEST-EFFORT + LOG, like the mint above it. The three outcomes get three distinct tokens
 * because they need three different fixes, and `doctor-omp-bridge` greps them on an axis
 * of their own — a marker failure is NOT a birth failure, and a doctor that judged them on
 * one axis would print "the hook ran and did not mint" about a session whose record is
 * right there (`adding-a-harness.md` step 6, measured on Copilot):
 *
 *   `sender marker <pid> -> <gid>`   armed.
 *   `sender-marker-refused`          we declined to claim an owner. Fail-closed, WARN.
 *   `sender-marker-failed`           the write itself broke. ERROR.
 *
 * Either non-success costs only who-sent: the citizen still exists, still appears in
 * `entwurf_peers`, and can still be addressed BY others. Only its own outbound sends fall
 * back to the bridge's default refusal.
 */
function writeOmpSenderMarker(gardenId: string, envelope: OmpBirthEnvelope): void {
	const ownerPid = resolveOmpOwnerPid();
	if (ownerPid === null) {
		logLine(
			"WARN",
			`sender-marker-refused garden=${gardenId}: this process's own pid ${process.pid} is not a plausible owner; ` +
				"this citizen exists but cannot send",
		);
		return;
	}
	try {
		writeMetaSenderMarker({
			backend: BACKEND,
			gardenId,
			nativeSessionId: envelope.nativeSessionId,
			cwd: envelope.cwd,
			ownerPid,
			sendersDir: roots().sendersDir,
		});
		logLine("INFO", `sender marker ${ownerPid} -> ${gardenId}`);
	} catch (err) {
		logLine(
			"ERROR",
			`sender-marker-failed pid=${ownerPid} garden=${gardenId}: ${err instanceof Error ? err.message : String(err)}`,
		);
	}
}

/**
 * Show the garden id on the harness's own persistent visible surface (step 4).
 *
 * `ctx.ui.setStatus` is the ONLY surface that renders extension-owned text on a v18 TUI,
 * and it is gated by `statusLine.showHookStatus`, default true
 * (`settings-schema.ts:952-956`). Failure to render is NOT a birth failure, so this never
 * throws and never blocks the marker or the record; it logs at WARN and the doctor reads
 * that. The rendered string mirrors the agy statusline's shape (`🪛 <garden-id> <rail>`)
 * so an operator with two harnesses open reads one vocabulary.
 */
function showGardenId(ctx: OmpExtensionContext, gardenId: string): void {
	const setStatus = ctx.ui?.setStatus;
	if (typeof setStatus !== "function") {
		logLine("WARN", `status-refused garden=${gardenId}: ctx.ui.setStatus is not available on this context`);
		return;
	}
	try {
		setStatus.call(ctx.ui, STATUS_KEY, `🪛 ${gardenId} omp`);
	} catch (err) {
		logLine("WARN", `status-failed garden=${gardenId}: ${err instanceof Error ? err.message : String(err)}`);
	}
}

// ---------------------------------------------------------------------------
// Stage machine. One bootstrap per minted visible session, owned by the closure that
// created it — the same creator-owned discipline the Bundle B receiver established, and for
// the same reason: nothing here may assume a later event's `ctx` belongs to the session that
// started the work.
// ---------------------------------------------------------------------------

/**
 * Where one bootstrap is. The transitions are one-way and only `task-sent` has ever
 * delivered the caller's task.
 *
 * `released` IS NOT THE END, AND THAT SPLIT IS THE #87 STAGE-TWO CORRECTION. `[LIVE
 * 2026-08-30]` the first two-stage candidate sent the task from inside the `tool_result`
 * handler with an explicit `deliverAs: "followUp"`. Everything up to that point worked —
 * `bootstrap-armed`, `bootstrap-ready` at +440ms, `bootstrap-callback-observed`,
 * `bootstrap-released` — and the task still never appeared in the session at all. `[source]`
 * the vendor says why in one sentence: "Omitted `deliverAs` starts a turn when idle and
 * queues as a steer while streaming. Explicit `deliverAs` queues WITHOUT starting a turn in
 * either state." (`session/agent-session.ts:6511-6513`, implementation `:6515-6556`). Inside
 * a `tool_result` handler the callback turn is still streaming, so there is no good option
 * there: explicit queues into a turn nobody starts, and omitted steers the callback turn.
 * `[LIVE 2026-08-30]` the same transcript proved the working form three seconds later — the
 * Bundle B doorbell's OMITTED-option `sendUserMessage` landed as a real user message and
 * started a turn on the same idle session.
 *
 * So `released` records "the callback provably succeeded" and nothing more; the send waits
 * for the `turn_end` boundary, where the callback turn is over and the omitted-option call
 * means what it says.
 */
export type OmpBootstrapPhase = "waiting" | "callback-sent" | "released" | "task-sent" | "failed";

/** The clock/timer seam. It has NO default: production passes the creator context's own
 * vendor timers (`creatorOwnedTimers`) and the gate passes a fake clock, so there is no
 * syntax in this file for a bootstrap to reach a global timer. */
export interface OmpBootstrapTimers {
	set(fn: () => void, ms: number): unknown;
	clear(handle: unknown): void;
	now(): number;
}

export interface OmpBootstrapHandle {
	phase(): OmpBootstrapPhase;
	/** The tool call id this bootstrap is waiting on a result for, once it has seen one. */
	pendingCallId(): string | null;
	start(): void;
	onToolCall(event: OmpToolCallEvent): void;
	onToolResult(event: OmpToolResultEvent): void;
	/** The stage-two boundary. Sends the task exactly once, and only from `released`. */
	onTurnEnd(): void;
	/** Stop this bootstrap for a reason that is not its own timeout — a session switch, or a
	 * replacement bootstrap taking over. Never sends anything. */
	invalidate(why: string): void;
}

/**
 * The only timer surface a production bootstrap may have: the creator context's own.
 *
 * WHY THE RAW GLOBAL `setTimeout` HAD TO GO. `[source]` the vendor registers a
 * `ctx.setTimeout` against the session and clears it automatically on `session_shutdown`
 * (`extensions/types.ts:501-509`). A raw global timer is in no registry at all, so inside a
 * LIVING omp process it survives the disposal of the session that scheduled it and keeps
 * polling state that is gone. `unref` never answered that — it only stops a poll from holding
 * the process open, which is a different property from ownership.
 *
 * AND IT IS ONLY HALF THE REPAIR. The vendor's automatic clear fires on session SHUTDOWN,
 * while `/new`, a fork and a same-file resume are all `session_switch` INSIDE a living
 * process — no shutdown, so no automatic clear. This binding stops a poll from outliving a
 * DISPOSED session; the unconditional epoch invalidation in `startOmpBootstrap` stops a
 * bootstrap from outliving a REPLACED one. Neither covers the other's case, which is why the
 * amendment carries both.
 *
 * REFUSING TO START AN UNCANCELLABLE TIMER IS THE POINT, and it is the receive unit's
 * existing rule rather than a new one (`meta-bridge-receive-omp.ts:423-436`): `clearTimer` is
 * the only canceller this vendor exposes, so a build without it would leave a 100ms poll
 * running in the operator's TUI with no way to stop it. `null` here means this launch never
 * arms — the public caller then times out on a callback that did not happen, which is honest,
 * rather than this unit installing a defect to avoid a timeout.
 */
function creatorOwnedTimers(ctx: OmpExtensionContext): OmpBootstrapTimers | null {
	const set = ctx?.setTimeout;
	const clear = ctx?.clearTimer;
	if (typeof set !== "function" || typeof clear !== "function") return null;
	// CAPTURE THE CREATOR, NOT JUST THE HANDLE — the receiver's rule, for its reason: nothing
	// measured says a second event context can cancel a timer a first one created. After these
	// two lines there is no syntax here for a foreign context to schedule or cancel this poll.
	return {
		set: (fn, ms) => set.call(ctx, fn, ms),
		clear: (handle) => {
			clear.call(ctx, handle);
		},
		now: () => Date.now(),
	};
}

/**
 * Is the exact callback tool callable RIGHT NOW — asked of BOTH public snapshots.
 *
 * ONE SNAPSHOT IS NOT ENOUGH, AND THAT IS A MEASURED CLAIM ABOUT THE VENDOR, NOT CAUTION.
 * `getAllTools()` is the full registry with provenance (`session-tools.ts:497-514`) while
 * `getActiveTools()` is the ENABLED name list (`extension-ui-controller.ts:185-187`,
 * `session-tools.ts:364-372`) — a tool can be registered and not enabled, and a prompt can
 * only call an enabled one. Requiring `sourceInfo.source === "mcp"` on the registry side is
 * what stops an identically-named extension or built-in tool from being read as the bridge.
 */
export function ompCallbackToolReady(pi: OmpExtensionApi): boolean {
	let all: readonly OmpToolInfo[];
	let active: readonly string[];
	try {
		if (typeof pi.getAllTools !== "function" || typeof pi.getActiveTools !== "function") return false;
		all = pi.getAllTools() ?? [];
		active = pi.getActiveTools() ?? [];
	} catch {
		// Action methods throw until the runner is initialised (`loader.ts:65-112`). That is a
		// "not yet", not a fault, and the deadline is what turns a permanent one into a failure.
		return false;
	}
	const registered = all.some(
		(tool) => tool?.name === OMP_BOOTSTRAP_CALLBACK_TOOL && tool?.sourceInfo?.source === "mcp",
	);
	return registered && active.includes(OMP_BOOTSTRAP_CALLBACK_TOOL);
}

/**
 * Does this tool event name OUR callback, with OUR target and OUR nonce?
 *
 * The event carries no server name, no session id and no original MCP tool name
 * (`extensions/types.ts:916-1017`), so the match is built from what IS there: the canonical
 * minted tool name plus the two argument values this rail already owns as contract. Exact
 * string equality on both — a prefix or `includes` here would let a sibling's nonce release
 * this session's task.
 */
function matchesCallback(event: OmpToolCallEvent, payload: OmpBootstrapPayload): boolean {
	if (event?.toolName !== OMP_BOOTSTRAP_CALLBACK_TOOL) return false;
	const input = event?.input;
	if (typeof input !== "object" || input === null || Array.isArray(input)) return false;
	const args = input as Record<string, unknown>;
	return args.target === payload.target && args.message === payload.nonce;
}

/**
 * Create one bootstrap for one minted session.
 *
 * THE TASK IS RELEASED BY A RESULT, NEVER BY A CALL AND NEVER BY TEXT. `tool_call` fires
 * before scheduling and before approval (`agent-session.ts:3431-3467`), so a call alone
 * proves only that the model tried. The release predicate is the whole contract: the phase
 * is `callback-sent`, the result's `toolCallId` is the exact id remembered from the matching
 * call, the result still names our tool/target/nonce, and `isError === false`. Anything
 * else — a wrong tool, a wrong nonce, an errored result, a second result, a result for a
 * call we never matched — leaves the task unsent, which is the honest outcome: the public
 * caller times out on a callback that did not happen instead of a sibling silently working.
 */
export function createOmpBootstrap(opts: {
	payload: OmpBootstrapPayload;
	pi: OmpExtensionApi;
	/** REQUIRED, and the absence of a default is the D2 repair: a bootstrap that could fall
	 * back to a global timer would silently reacquire the ownership this seam exists to hold. */
	timers: OmpBootstrapTimers;
	log?: (level: LogLevel, message: string) => void;
}): OmpBootstrapHandle {
	const { payload, pi, timers } = opts;
	const log = opts.log ?? logLine;

	let phase: OmpBootstrapPhase = "waiting";
	let timer: unknown = null;
	let callId: string | null = null;
	const deadline = timers.now() + OMP_BOOTSTRAP_READY_TIMEOUT_MS;

	function stopTimer(): void {
		if (timer === null) return;
		try {
			timers.clear(timer);
		} catch {
			/* a timer that cannot be cleared must not break the session */
		}
		timer = null;
	}

	/** `task-sent` and `failed` are the only outcomes nothing may rewrite. `released` is
	 * deliberately NOT among them: a bootstrap whose session is replaced between the callback
	 * result and the next turn_end must lose its task, not deliver it into a session the
	 * caller never opened. */
	function isFinal(): boolean {
		return phase === "task-sent" || phase === "failed";
	}

	function fail(why: string): void {
		stopTimer();
		if (isFinal()) return;
		phase = "failed";
		log("WARN", `bootstrap-failed nonce=${payload.nonce}: ${why}; the task was NOT sent`);
	}

	/**
	 * Both stages send the SAME way: `pi.sendUserMessage(content)` with NO delivery option.
	 *
	 * `[source]` that is the only form whose semantics match what each stage needs — idle
	 * starts a turn, streaming queues as a steer, and an EXPLICIT option queues without
	 * starting a turn in either state (`session/agent-session.ts:6511-6513`). Stage one runs
	 * on an idle session right after `session_start`; stage two runs at a `turn_end`
	 * boundary. Neither wants a queue nobody drains, and `[LIVE 2026-08-30]` a queue nobody
	 * drains is exactly what the explicit form produced.
	 */
	function send(content: string): boolean {
		try {
			if (typeof pi.sendUserMessage !== "function") {
				fail("pi.sendUserMessage is not available on this vendor context");
				return false;
			}
			pi.sendUserMessage(content);
			return true;
		} catch (err) {
			fail(`pi.sendUserMessage threw: ${err instanceof Error ? err.message : String(err)}`);
			return false;
		}
	}

	function tick(): void {
		timer = null;
		if (phase !== "waiting") return;
		if (ompCallbackToolReady(pi)) {
			// ATOMIC BEFORE THE SEND. The phase moves first so a re-entrant tick, a second
			// readiness observation, or a handler that fires during the send can never produce
			// two callback prompts for one bootstrap.
			phase = "callback-sent";
			stopTimer();
			log("INFO", `bootstrap-ready nonce=${payload.nonce}: callback tool live, sending callback-only prompt`);
			send(buildOmpCallbackOnlyPrompt({ target: payload.target, nonce: payload.nonce }));
			return;
		}
		if (timers.now() >= deadline) {
			fail(
				`the callback tool ${OMP_BOOTSTRAP_CALLBACK_TOOL} was not callable within ${OMP_BOOTSTRAP_READY_TIMEOUT_MS}ms`,
			);
			return;
		}
		schedule();
	}

	function schedule(): void {
		try {
			timer = timers.set(tick, OMP_BOOTSTRAP_POLL_MS);
		} catch (err) {
			fail(`readiness timer could not be scheduled: ${err instanceof Error ? err.message : String(err)}`);
		}
	}

	return {
		phase: () => phase,
		pendingCallId: () => callId,
		start(): void {
			if (phase !== "waiting") return;
			// One immediate observation before the first sleep: on a warm host the tools may
			// already be there, and a mandatory first delay would be the fixed wait this design
			// refuses.
			tick();
		},
		onToolCall(event: OmpToolCallEvent): void {
			if (phase !== "callback-sent" || callId !== null) return;
			if (!matchesCallback(event, payload)) return;
			const id = event?.toolCallId;
			if (typeof id !== "string" || id.length === 0) return;
			callId = id;
			log("INFO", `bootstrap-callback-observed nonce=${payload.nonce} toolCallId=${id}`);
		},
		onToolResult(event: OmpToolResultEvent): void {
			if (phase !== "callback-sent" || callId === null) return;
			if (event?.toolCallId !== callId) return;
			if (!matchesCallback(event, payload)) return;
			if (event?.isError !== false) {
				log("WARN", `bootstrap-callback-errored nonce=${payload.nonce} toolCallId=${callId}; the task was NOT sent`);
				return;
			}
			// RELEASED, AND THE TASK IS NOT SENT HERE. This handler runs inside the callback
			// turn, which is still streaming — the one place where neither delivery form is
			// right (`[LIVE 2026-08-30]`, see OmpBootstrapPhase). All that happens is the
			// record that the callback provably succeeded; `onTurnEnd` owns the send.
			phase = "released";
			stopTimer();
			log("INFO", `bootstrap-released nonce=${payload.nonce} toolCallId=${callId}: task armed for the next turn_end`);
		},
		/**
		 * The stage-two boundary: the callback turn is over, so the session is at the edge
		 * where an omitted-option `sendUserMessage` is the working form.
		 *
		 * IT FIRES ON EVERY TURN OF EVERY BOOTSTRAPPED SESSION, so the phase test is the
		 * whole guard. A `turn_end` before the callback result finds `callback-sent` and does
		 * nothing; a second `turn_end` finds `task-sent`; an invalidated bootstrap finds
		 * `failed`. `[source]` the event carries `turnIndex`, `message` and `toolResults` and
		 * nothing that identifies a session (`shared-events.ts:211-217`, emitted at
		 * `session/agent-session.ts:3607-3620`) — which is why the session fence lives on the
		 * handler's `ctx`, in `bootstrapFor`, and never on the event.
		 *
		 * LATCH BEFORE SEND, exactly as the release does. `sendUserMessage` returns void and
		 * its ordering is owned by session state rather than by a promise, so the only way one
		 * task stays one task is for the phase to move first.
		 */
		onTurnEnd(): void {
			if (phase !== "released") return;
			phase = "task-sent";
			log("INFO", `bootstrap-task-sent nonce=${payload.nonce}: delivering the task at the turn_end boundary`);
			send(payload.task);
		},
		invalidate(why: string): void {
			stopTimer();
			// `released` is invalidatable ON PURPOSE: between the callback result and the next
			// turn_end the session can be replaced by `/new`, a fork or a resume, and the
			// caller's task must die with the session it was addressed to.
			if (isFinal()) return;
			phase = "failed";
			log("INFO", `bootstrap-invalidated nonce=${payload.nonce}: ${why}; the task was NOT sent`);
		},
	};
}

/**
 * The one live bootstrap, keyed by the native session that owns it.
 *
 * MODULE STATE IS SAFE HERE ONLY BECAUSE THE FENCES ARE. `[source]` the factory is
 * re-executed per session and inside every task subagent (`sdk.ts:1995-2038`,
 * `task/executor.ts:3250-3307`) against a fresh API, but ESM caches the MODULE — so this
 * binding is shared by all of them. Two fences make that harmless and both are load-bearing:
 * every entry point requires `ctx.mode === "tui"` (a subagent is `"print"`), and every tool
 * event requires the handler context's own `getSessionId()` to equal the id this bootstrap
 * was bound to. Identity is never inferred from a tool call id or from the mode alone.
 */
let activeBootstrap: { sessionId: string; handle: OmpBootstrapHandle } | null = null;

/**
 * ONE LAUNCH, ONE BOOTSTRAP — and this latch is what makes that true.
 *
 * `[source]` `getFlag` reads a per-PROCESS map that `applyExtensionFlags` filled once at
 * startup (`extensions/loader.ts:221-228`, `:253-255`, `cli/extension-flags.ts:36-43`); it is
 * not consumed by reading. So after `/new`, a fork or an in-TUI resume — all of which re-fire
 * as `session_switch` (`agent-session.ts:6910-8074`) and all of which this unit correctly
 * re-mints a record for — the flag would STILL be there, and a bootstrap without this latch
 * would send the caller's task a second time into a session the caller never opened. The
 * payload is a property of the LAUNCH, not of the process's flag map.
 */
let bootstrapConsumed = false;

/** Test seam: drop whatever is live, without sending anything. */
export function resetOmpBootstrapForTest(): void {
	activeBootstrap?.handle.invalidate("test reset");
	activeBootstrap = null;
	bootstrapConsumed = false;
}

/**
 * May an event carrying THIS context act on a bootstrap bound to `boundSessionId`?
 *
 * BOTH FENCES, IN ONE PURE PREDICATE, BECAUSE NEITHER IS OPTIONAL. `tool_call`,
 * `tool_result` and `turn_end` carry no mode and no session id of their own
 * (`extensions/types.ts:916-1017`, `shared-events.ts:211-217`), so the only honest source is
 * the handler's own context (`extensions/types.ts:452-471`, `session-manager.ts:1946-1952`):
 *
 *   mode === "tui"     a task subagent re-runs this very factory (`task/executor.ts:3250-3307`)
 *                      and would otherwise let a subagent's tool result release the host's task.
 *   session id equal   `/new`, fork and resume replace the session under a LIVING process, so
 *                      the pid is not a discriminator and the native id is.
 *
 * Identity is never inferred from a tool call id, from the mode alone, or from the fact that
 * some bootstrap happens to be live.
 */
export function ompBootstrapCtxAccepts(ctx: OmpExtensionContext, boundSessionId: string): boolean {
	if (ctx?.mode !== HOST_MODE) return false;
	let id: unknown;
	try {
		id = ctx?.sessionManager?.getSessionId?.();
	} catch {
		return false;
	}
	return typeof id === "string" && id === boundSessionId;
}

/** The bootstrap this event belongs to, or null. */
function bootstrapFor(ctx: OmpExtensionContext): OmpBootstrapHandle | null {
	if (activeBootstrap === null) return null;
	return ompBootstrapCtxAccepts(ctx, activeBootstrap.sessionId) ? activeBootstrap.handle : null;
}

/**
 * Start stage one for a session that has just been minted — or say in the log why not.
 *
 * IT RUNS AFTER THE RECORD AND THE MARKER, NEVER BEFORE. The callback the sibling is about
 * to make carries this session's garden id as its SENDER, and the sender join is the marker.
 * A bootstrap that raced ahead of it would produce a callback the caller cannot attribute.
 *
 * A MANUAL `omp` HAS NO FLAG AND MUST NOTICE NOTHING. `flag-absent` is the overwhelmingly
 * common case — every operator session on this host — so it is the one refusal that does not
 * even log: a line per manual session would drown the diagnostic the doctor actually reads.
 *
 * `edge` IS DIAGNOSTIC, NOT A DISCRIMINATOR, and that is the D1 repair's shape. Every later
 * birth edge ends the epoch below with no test on its name and no test on the session id, so
 * nothing here re-derives the vendor's event spelling; the string only tells the log which
 * edge did it.
 */
export function startOmpBootstrap(opts: {
	pi: OmpExtensionApi;
	/** The BIRTH context — the creator whose timers this bootstrap's poll will belong to. */
	ctx: OmpExtensionContext;
	envelope: OmpBirthEnvelope;
	edge: string;
	log?: (level: LogLevel, message: string) => void;
}): void {
	const { pi, ctx, envelope, edge } = opts;
	const log = opts.log ?? logLine;
	if (bootstrapConsumed) {
		// EVERY LATER BIRTH EDGE ENDS A NONFINAL BOOTSTRAP — NO ID COMPARISON, AND THAT IS THE
		// WHOLE OF DEFECT 1 (#87 Terra review). The frozen candidate invalidated only when the
		// native id CHANGED, and `[source]` the vendor emits `session_switch(reason:"resume")`
		// unconditionally on the reload/same-file path — `switchingToDifferentSession` is
		// computed at `session/agent-session.ts:7983` but never gates the emit at `:8071-8078`,
		// and `agent.replaceMessages(...)` swaps the transcript immediately after it. So a
		// same-id switch is a real epoch change wearing the old id, and a bootstrap that
		// survived it could release the caller's task into a conversation the caller never
		// opened. The id is not the epoch; the edge is.
		//
		// The previous different-id branch is absorbed here rather than kept beside this one:
		// two conditions for one rule is where the next drift would live.
		if (activeBootstrap !== null) {
			const sameId = activeBootstrap.sessionId === envelope.nativeSessionId;
			activeBootstrap.handle.invalidate(
				`birth edge ${edge} ended the bootstrap epoch (native=${envelope.nativeSessionId}, same-id=${sameId})`,
			);
			activeBootstrap = null;
		}
		// The latch is NEVER rearmed from here. `getFlag` reads a per-process map that is not
		// consumed by reading, so without this the very next edge would arm the same payload again.
		return;
	}
	let raw: unknown;
	try {
		raw = typeof pi.getFlag === "function" ? pi.getFlag(OMP_BOOTSTRAP_FLAG) : undefined;
	} catch (err) {
		log("WARN", `bootstrap-flag-unreadable: ${err instanceof Error ? err.message : String(err)}`);
		return;
	}
	const decoded = decodeOmpBootstrapPayload(raw);
	if (!decoded.ok) {
		if (decoded.reason !== "flag-absent") {
			log("WARN", `bootstrap-refused reason=${decoded.reason}: --${OMP_BOOTSTRAP_FLAG} was present but unusable`);
		}
		return;
	}
	// THE TIMER CHECK COMES AFTER THE DECODE ON PURPOSE: a manual `omp` returns on
	// `flag-absent` above, so no operator session can ever reach this line and no vendor build
	// gets a WARN it has no launch to explain.
	const timers = creatorOwnedTimers(ctx);
	if (timers === null) {
		// AND IT STILL SPENDS THE LATCH. The payload is a property of the LAUNCH, and this edge
		// was the launch's one chance; leaving the latch open would let the next `/new` arm the
		// caller's task into a session the caller never opened, which is the exact failure the
		// latch exists to refuse. An unarmed launch is an honest fresh-call timeout.
		bootstrapConsumed = true;
		log(
			"WARN",
			`bootstrap-timers-unavailable edge=${edge}: ctx.setTimeout=${typeof ctx?.setTimeout} ctx.clearTimer=${typeof ctx?.clearTimer} — refusing to arm a readiness poll this vendor build cannot own or cancel; the task was NOT sent`,
		);
		return;
	}
	// A replacement session takes the lane; the previous bootstrap dies without sending.
	activeBootstrap?.handle.invalidate(`replaced by native session ${envelope.nativeSessionId}`);
	const handle = createOmpBootstrap({ payload: decoded.value, pi, timers, log });
	activeBootstrap = { sessionId: envelope.nativeSessionId, handle };
	bootstrapConsumed = true;
	log("INFO", `bootstrap-armed nonce=${decoded.value.nonce} target=${decoded.value.target}`);
	handle.start();
}

/**
 * One birth edge. `edge` is diagnostic only — mint does not branch on it, because both
 * wired events mean the same thing here (this visible host now owns this session).
 */
export function onBirthEdge(edge: string, ctx: OmpExtensionContext, pi?: OmpExtensionApi): void {
	if (ctx.mode !== HOST_MODE) {
		// THE DESIGNED ANSWER, NOT A FAULT — INFO, and it must stay cheap. Every task
		// subagent reaches this line (they inherit the extension by default), so this is
		// also the only place the fence leaves a receipt: one line per refused session,
		// naming the mode that was refused.
		logLine("INFO", `scope-refused edge=${edge} mode=${String(ctx.mode)}: not the visible tui host, no record minted`);
		return;
	}

	const envelope = readBirthEnvelope(ctx);
	if ("refusal" in envelope) {
		// ERROR: this session did NOT become a garden citizen. The doctor reads this line.
		logLine("ERROR", `degraded envelope edge=${edge}: ${envelope.refusal}`);
		return;
	}

	try {
		const result = upsertMetaSession({
			input: {
				backend: BACKEND,
				nativeSessionId: envelope.nativeSessionId,
				cwd: envelope.cwd,
				transcriptPath: envelope.transcriptPath,
			},
			dir: roots().sessionsDir,
		});
		logLine(
			"INFO",
			`${result.action} record ${path.basename(result.path)} (edge=${edge}, native=${envelope.nativeSessionId})`,
		);
		// RECORD AUTHORITY FIRST: the marker is only a pid->garden hint the record must
		// vouch for, so both the marker and the visible id are written INSIDE the success
		// branch. A marker minted after a failed upsert would name a garden id with no
		// record behind it, and a status line would advertise the same ghost.
		writeOmpSenderMarker(result.record.gardenId, envelope);
		showGardenId(ctx, result.record.gardenId);
		// STAGE ONE, LAST. The bootstrap is the only thing here that starts a model turn, so
		// it runs after the record, the sender join and the visible id are all settled — the
		// callback it is about to ask for is attributed by exactly those three facts. A
		// manual `omp` carries no flag and this call is a no-op for it. `ctx` rides along as the
		// creator whose timers the readiness poll belongs to, and `edge` so the log can name
		// which birth edge ended a previous epoch.
		if (pi) startOmpBootstrap({ pi, ctx, envelope, edge });
	} catch (err) {
		logLine(
			"ERROR",
			`upsert failed (edge=${edge}, native=${envelope.nativeSessionId}): ${err instanceof Error ? err.message : String(err)}`,
		);
	}
}

/**
 * The extension factory omp calls with a per-session API (`types.ts:1592`; re-executed per
 * subagent against a fresh API, `sdk.ts:2000-2028`). Binding plus ONE registration is all it
 * does — every decision still waits for an event's `ctx`, because the factory itself cannot
 * see the mode.
 *
 * THE FLAG MUST BE REGISTERED HERE AND NOWHERE LATER. `[source]` the normal CLI path loads
 * discovered extensions and only THEN aggregates the registered flags and reparses raw argv
 * (`main.ts:1799-1810`); a flag registered after that reparse would never be filled. It is
 * also the only thing this factory may do: every action method throws
 * `ExtensionRuntimeNotInitializedError` until the runner initialises (`loader.ts:65-112`), so
 * reading the flag here would throw and minting here would mint before the session exists.
 *
 * THE TOOL EVENTS ARE BOUND UNCONDITIONALLY, AND THE COST IS PAID DELIBERATELY. The flag's
 * VALUE is not readable yet at factory time, so "bind only when bootstrapping" is not
 * available; and late binding after `session_start` is not a measured vendor behaviour, so it
 * is not gambled on. Both handlers therefore run on every tool call of every omp session on
 * this host — which is why their first act is a null check on a module binding that is null
 * for every manual session, and why nothing in them can throw: extension handlers are serial
 * and fail closed (`runner.ts:1455-1495`), so a throw here would cost the operator a tool.
 */
export default function entwurfMetaOmp(pi: OmpExtensionApi): void {
	try {
		pi.registerFlag?.(OMP_BOOTSTRAP_FLAG, {
			type: "string",
			description: "entwurf fresh-call bootstrap payload (set by entwurf_fresh_call; not for manual use)",
		});
	} catch (err) {
		logLine("WARN", `bootstrap-flag-unregistered: ${err instanceof Error ? err.message : String(err)}`);
	}
	pi.on("session_start", (_event, ctx) => onBirthEdge("session_start", ctx, pi));
	// `turn_end` joins them as the stage-two boundary — see `OmpBootstrapPhase`. It is bound
	// on the same unconditional terms and pays the same null check.
	pi.on("session_switch", (event, ctx) =>
		onBirthEdge(`session_switch(${asNonEmptyString(event?.reason) || "unlabeled"})`, ctx, pi),
	);
	pi.on("tool_call", (event, ctx) => {
		try {
			bootstrapFor(ctx)?.onToolCall(event);
		} catch (err) {
			logLine("WARN", `bootstrap-tool-call-handler-failed: ${err instanceof Error ? err.message : String(err)}`);
		}
	});
	pi.on("tool_result", (event, ctx) => {
		try {
			bootstrapFor(ctx)?.onToolResult(event);
		} catch (err) {
			logLine("WARN", `bootstrap-tool-result-handler-failed: ${err instanceof Error ? err.message : String(err)}`);
		}
	});
	pi.on("turn_end", (_event, ctx) => {
		try {
			bootstrapFor(ctx)?.onTurnEnd();
		} catch (err) {
			logLine("WARN", `bootstrap-turn-end-handler-failed: ${err instanceof Error ? err.message : String(err)}`);
		}
	});
}
