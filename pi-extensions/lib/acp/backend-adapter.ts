// ACP backend adapter rail — the PRODUCT seam by which a curated model id selects
// which ACP backend (claude / future backend / …) drives a turn. See the adapter contract in
// docs/acp-backend-rail.md.
//
// This seam is DISTINCT from `AcpTurnDeps` (backend.ts), which is the test/runtime
// seam (fake spawn/connection/clock for the gates). Merging them would make a
// fake-deps fixture look like
// a fake backend and force the adapter to carry clock/sessionDir/createConnection.
// The wiring is `defaultDeps(adapter)` — the turn loop in backend.ts stays
// backend-invariant; only these per-backend functions change with `adapter`.
//
// STATUS: Step A+B done — backend.ts is wired to this rail. The turn loop in
// backend.ts delegates every per-backend step through the resolved adapter
// (resolveLaunch/ensureOverlay/loadCarrier/buildSessionMeta/enforceModel/
// launchEnvDefaults); there is no private resolveLaunch copy in backend.ts.
// `resolveClaudeLaunch` below is the single source for the claude launch spec.
//
// Fence: imported by the root program with `.js` suffixes, same as the sibling
// lib/acp modules — no new strip-types fence.

import { rmSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { RequestError } from "@agentclientprotocol/sdk";

import type { AcpConnectionLike } from "./acp-client.js";
import { enrichMcpServersWithEnvelope, type ResolvedAcpConfig } from "./config.js";
import { loadEngraving } from "./engraving.js";
import {
	AGY_MODEL_PREFIX,
	AGY_THOUGHT_LEVELS,
	CLAUDE_ACP_EFFORT_VALUES,
	CORTEX_MODEL_PREFIX,
	curatedAgyModels,
	curatedClaudeModels,
	curatedCortexModels,
	LEGACY_CORTEX_MODEL_IDS,
	SUPPORTED_AGY_NATIVE_MODEL_IDS,
	SUPPORTED_ANTHROPIC_MODEL_IDS,
} from "./models.js";
import {
	AGY_GEMINI_OVERLAY_DIR,
	claudeLaunchEnvDefaults,
	cleanupAgySummaryRoot,
	createAgySummaryRoot,
	ensureAgyGeminiOverlay,
	ensureClaudeConfigOverlay,
	ensureCortexDualHomeOverlay,
} from "./overlay.js";
import { buildClaudeSessionMeta } from "./tool-surface.js";

// POSIX-safe single-quote wrapper for shell arg interpolation. Byte-for-byte
// identical to the reference in entwurf-core.ts; PARITY-PINNED by
// scripts/check-shell-quote.ts (SOURCE_SITES). Used only by the cortex override
// path below, where operator-configured connection/model tokens are appended to
// an operator `bash -lc` string — quoting keeps a connection name with shell
// metacharacters from being reinterpreted by the shell.
function shellQuote(value: string): string {
	return `'${value.replace(/'/g, `'\\''`)}'`;
}

// ---------------------------------------------------------------------------
// Shared shapes
// ---------------------------------------------------------------------------

/** Launch spec for the ACP server child process. */
export interface AcpLaunchSpec {
	command: string;
	args: string[];
}

/** A curated provider model row (the shape pi.registerProvider({ models }) takes). */
/** `thinkingLevelMap` is optional: Claude rows declare the effort levels its driver can set (#142);
 *  cortex rows declare none and keep pi's default thinking handling. */
type ClaudeModelRow = ReturnType<typeof curatedClaudeModels>[number];
export type AcpModelRow = Omit<ClaudeModelRow, "thinkingLevelMap"> & Partial<Pick<ClaudeModelRow, "thinkingLevelMap">>;

/** routeModel result — the backend-native model id with the curation prefix stripped. */
export interface AcpRoutedModel {
	nativeModelId: string;
}

/** resolveLaunch input — native (prefix-stripped) model id + resolved operator config. */
export interface AcpLaunchParams {
	cwd: string;
	modelId: string;
	nativeModelId: string;
	config: ResolvedAcpConfig;
	/** Set for Pi summary turns (#168): lets an adapter pass a per-turn isolated overlayDir. */
	summaryTurn?: boolean;
	overlayDir?: string;
}

/** loadCarrier input — the mcp server names plus the resolved config (so a backend
 *  whose carrier depends on its own `config.adapterSettings` can read it). backend.ts
 *  still never inspects config — it just passes it through. */
export interface AcpCarrierParams {
	mcpServerNames: string[];
	config: ResolvedAcpConfig;
}

/** ensureOverlay input — cwd + (native) model id + the resolved config. A backend
 *  whose overlay/env depends on its OWN settings reads them off `config.adapterSettings`
 *  here; backend.ts never inspects config. Same shape as AcpLaunchParams plus the
 *  session key (overlay and launch are distinct phases, so they keep distinct names). */
export interface AcpOverlayParams {
	cwd: string;
	modelId: string;
	nativeModelId: string;
	config: ResolvedAcpConfig;
	/** The AUTHORITATIVE per-session key backend.ts already computed
	 *  (resolveSessionKey: opts.sessionId → PI_SESSION_ID → cwd). A session-scoped
	 *  overlay MUST scope on this value, never on an ambient re-derivation — the
	 *  re-derived form drops `opts.sessionId`, so two sessions in one process/cwd
	 *  would alias one overlay (GPT review 2026-07-29, cortex P0-1). */
	sessionKey: string;
	/** Set for Pi summary turns (#168) so adapters can isolate per-turn state from the shared overlay. */
	summaryTurn?: boolean;
}

/** buildSessionMeta input — mirrors the newSession `_meta` inputs. */
export interface AcpSessionMetaParams {
	modelId: string;
	nativeModelId: string;
	config: ResolvedAcpConfig;
}

/** enforceModel input — the live connection + acp session + native id. */
export interface AcpEnforceModelParams {
	connection: AcpConnectionLike;
	acpSessionId: string;
	modelId: string;
	nativeModelId: string;
	/** True only when this bootstrap attached the session through a `session/resume` that succeeded
	 *  and passed the id guard (#174). A fact of this one bootstrap: never stored, never inferred. */
	resumedAttach: boolean;
}

/** resolveThinking input — pi's requested level and the registered row's level map. `reasoning`
 *  is `undefined` both when the pi thinking level is `off` and when none was given: pi-agent-core
 *  sends `thinkingLevel === "off" ? undefined : level`, so the provider cannot tell them apart. */
export interface AcpResolveThinkingParams {
	modelId: string;
	reasoning: string | undefined;
	thinkingLevelMap: Readonly<Record<string, string | null | undefined>> | undefined;
}

/** enforceThinking input — the live connection + acp session + the resolved backend value. */
export interface AcpEnforceThinkingParams {
	connection: AcpConnectionLike;
	acpSessionId: string;
	modelId: string;
	value: string;
}

/** ensureOverlay result — env overrides backend.ts merges into the spawn env. */
export interface AcpOverlayResult {
	envOverrides: Record<string, string>;
	/** Optional per-turn cwd override (e.g. an isolated empty cwd outside git for agy summary turns). */
	effectiveCwd?: string;
	/** Optional per-turn overlay directory passed to `resolveLaunch`. */
	overlayDir?: string;
	/** Optional per-turn cleanup run after child exit is settled (#168 S3). */
	cleanup?: (opts: { childExited: boolean; succeeded: boolean; spawned?: boolean }) => {
		cleaned: boolean;
		unlinkedPassthrough: string[];
	};
}

/** resolveAdapterSettings input — the RAW (untyped) `entwurfProvider` blocks plus
 *  their file paths. This is the ONE seam by which a backend reads its OWN settings
 *  (e.g. a connection id, a profile/tenant, a state-home path) WITHOUT those
 *  backend-specific keys ever touching the common ResolvedAcpConfig (fat-bridge
 *  regression). `mergedBlock` is
 *  the project-over-global merge (project keys win); the per-file blocks + paths are
 *  for error attribution. A backend with no own settings returns `undefined`. */
export interface AcpAdapterSettingsParams {
	globalBlock: Record<string, unknown>;
	projectBlock: Record<string, unknown>;
	mergedBlock: Record<string, unknown>;
	globalPath: string;
	projectPath: string;
}

/**
 * NO turn-usage evidence type lives here any more, and its absence is the #93
 * finding, not an omission.
 *
 * ACP reports a turn's tokens ONLY as the SUM OVER THAT TURN'S API ROUND TRIPS
 * (measured 2026-09-02: one 21-round-trip turn summed to cacheRead 4,185,084
 * while the context it occupied was 223,516 — the overlay ledger's 21 rows add
 * up to the four numbers `PromptResponse.usage` reported). pi's four `Usage`
 * fields are not that quantity: `isContextOverflow` reads `input + cacheRead`
 * as ONE REQUEST's prompt size (read at pi-ai `dist/utils/overflow.js:132-145`)
 * and `cache-stats.detectMiss` reads input, cache-read, and cache-write as
 * one request's prompt shape (read at pi-coding-agent
 * `dist/core/cache-stats.js:14-37`). Projecting the turn
 * aggregate into them fired a false overflow that compacted a live 223k session
 * on a 1M window, invented two phantom cache misses, and SILENCED the one real
 * 195,177-token miss the operator needed to see.
 *
 * During stream handling the vendor keeps a per-message snapshot in
 * `lastAssistantUsage`, but its `usage_update` publishes only the scalar `used`
 * value (read at claude-agent-acp 0.79.0 `dist/acp-agent.js:3920-3945`). Until
 * that partition is carried on the wire, NOTHING honest can go in pi's four
 * fields, so entwurf writes none of them.
 */

// ---------------------------------------------------------------------------
// The adapter interface
// ---------------------------------------------------------------------------

export interface AcpBackendAdapter {
	/** Discriminator. backend.ts stores this on BridgeSession/configSig so reuse
	 *  and diagnostics never re-parse the model-id string. */
	readonly backend: string;

	/** Does this adapter own `modelId`? If so, return the backend-native id (prefix
	 *  stripped); else undefined. Returning the native id here (vs a bare boolean)
	 *  keeps the registry from leaning on adapter order and gives resolveLaunch /
	 *  enforceModel the value they must actually send to the backend. */
	routeModel(modelId: string): AcpRoutedModel | undefined;

	/** Curated model rows this backend contributes to the single `entwurf` provider. */
	curatedModels(): AcpModelRow[];

	/** Parse this backend's OWN settings from the raw entwurfProvider blocks, returning
	 *  an opaque value config.ts stores on `ResolvedAcpConfig.adapterSettings`. backend.ts
	 *  NEVER inspects the result; only this adapter's other methods read it (casting their
	 *  own type back). A backend with no own settings returns `undefined`. This keeps the
	 *  common config free of backend-named fields (see AcpAdapterSettingsParams). */
	resolveAdapterSettings(params: AcpAdapterSettingsParams): unknown;

	/** Resolve the ACP server launch (command + args), honoring an env override. */
	resolveLaunch(params: AcpLaunchParams): AcpLaunchSpec;

	/** Static launch env defaults merged over process.env at spawn. */
	launchEnvDefaults(): Record<string, string>;

	/** Materialize the config overlay (auth passthrough + state hiding) and return
	 *  the env overrides to merge at spawn. A no-op backend returns { envOverrides: {} }.
	 *  Receives the resolved config so a settings-dependent overlay can read its own
	 *  `config.adapterSettings`; settings-derived spawn env rides the returned
	 *  `envOverrides` (launchEnvDefaults stays static). */
	ensureOverlay(params: AcpOverlayParams): AcpOverlayResult;

	/** Render the optional short operator carrier (engraving). Kept SEPARATE from
	 *  buildSessionMeta so backend.ts can load it ONCE and fold the same value into
	 *  both the config signature and the session meta (they must agree). A carrier-
	 *  less backend returns null WITHOUT calling loadEngraving, so it never trips the
	 *  shipped-engraving / appendSystemPrompt signature. */
	loadCarrier(params: AcpCarrierParams): string | null;

	/** Build the `_meta` handed to newSession. `undefined` → backend.ts omits the
	 *  `_meta` key entirely (carrier-less backend). Rich operator context rides the
	 *  first-user augment regardless, never this carrier. */
	buildSessionMeta(params: AcpSessionMetaParams, carrier: string | null): Record<string, unknown> | undefined;

	/** Enforce the requested model on the live ACP session. Single method absorbs
	 *  the per-backend difference (claude: per-turn session/set_config_option; a
	 *  launch-pinned backend: no-op here). backend.ts wraps the call in withTimeout. */
	enforceModel(params: AcpEnforceModelParams): Promise<void>;

	/** OPTIONAL capability (#142): carry pi's thinking level to the backend. Both or neither.
	 *  `resolveThinking` is PURE — it maps the requested level to the backend value through the
	 *  registered row's `thinkingLevelMap` and throws a named refusal when there is none, before
	 *  any process or session is touched. `enforceThinking` sets that value on the live session
	 *  and refuses unless the answer reads it back. ABSENT (cortex) keeps the old behaviour: the
	 *  level is not carried, and nothing claims it is. */
	resolveThinking?(params: AcpResolveThinkingParams): string;
	enforceThinking?(params: AcpEnforceThinkingParams): Promise<void>;

	/** Backend-specific fields folded into bridgeConfigSignature (reuse invalidation):
	 *  connection/profile/env-derived STABLE ids only — never raw env values / secrets.
	 *  Reads ONLY this backend's opaque `adapterSettings` (NOT the whole config), so the
	 *  signature contract can never accidentally fold a common field. MUST be a flat,
	 *  sorted-stable primitive map (JSON.stringify determinism — no nested objects /
	 *  non-deterministic order). `backend` + `nativeModelId` are added by backend.ts. */
	configSignatureFields(adapterSettings: unknown): Record<string, unknown>;

	/** Declares that THIS backend's `usage_update` cost semantics have been
	 *  MEASURED, so backend.ts may seal its context occupancy and its per-turn
	 *  cost from the session baseline.
	 *
	 *  ABSENT means no measured semantics — permanent and static, not an omission
	 *  to fill in by symmetry (cortex). backend.ts then seals NOTHING: no
	 *  occupancy, no cost baseline, no diff. That is what keeps this lane's
	 *  accounting out of a backend whose wire meaning nobody has measured.
	 *
	 *  This is deliberately NOT a method returning token evidence. It was one
	 *  until #93 measured that ACP's only token carrier is a turn aggregate that
	 *  pi's four `Usage` fields cannot honestly hold (see the note above
	 *  `AcpBackendAdapter`). With no token axis left to extract, presence alone
	 *  carries everything the seal needs, and a flag that gates only the two axes
	 *  entwurf actually reads from a NOTIFICATION cannot desync from a response
	 *  shape it never inspects. */
	sealsTurnAccounting?: true;

	/** Summary-turn capability (#163, #168).
	 *  - `"toolless"`: the child has no tool surface in fact (`tools: []`, no MCP, no plugin).
	 *  - `"execution-denied"`: the model still sees tool schemas, and a per-turn isolated
	 *    `PreToolUse` `v1:deny-all` hook blocks every tool execution before it runs.
	 *  ABSENT means no summary mode is declared, so backend.ts refuses the summary turn by name. */
	summaryTurnMode?: AcpSummaryTurnMode;

	/** OPTIONAL (#175): this backend compacts its own session when sent a prompt whose only block is
	 *  this command. After a Pi compaction, a resumed or reused session is sent it alone before the
	 *  turn's input (#171 U14: as the first of two blocks Claude ran no compaction). ABSENT: nothing is
	 *  asked of the vendor and its session keeps all it holds (#171 decision 16 as before). */
	compactCommand?: "/compact";

	/** OPTIONAL (#171 L18): what this backend needs between the text blocks of one prompt. agy hands
	 *  its model the blocks joined with nothing between them — measured in its own transcript, where
	 *  "…reply with only DONE." and "What does…" touch — so two user messages, or the augment and
	 *  the transcript, read as one sentence. backend.ts ends every block but the last with this
	 *  string, on the wire only.
	 *
	 *  ABSENT means the blocks go as built. Claude must stay absent: it reads a command such as
	 *  `/compact` from the first block alone, and a block is a boundary for it already. */
	textBlockSeparator?: string;

	/** OPTIONAL capability (#127): recognise a typed vendor rejection of `session/prompt`
	 *  whose raw text must not become pi's `errorMessage`. pi decides a whole-prompt replay
	 *  from `errorMessage` alone, and a vendor's "Internal error" reads as transient
	 *  (pi-ai's `internal.?error` term), so a turn whose tools already ran would be resent
	 *  from a cold session. Through pi-ai 1.3 a digit run inside the ids it carries (`…8503…`)
	 *  read as an HTTP status too; pi-ai 1.4 bounds the status terms (upstream #11057), so
	 *  the ids no longer trigger it — the "Internal error" text alone still does. A recognised rejection returns a fixed, authored verdict for
	 *  `errorMessage`; backend.ts keeps the raw rejection as a pi diagnostic instead.
	 *
	 *  ABSENT means every failure of this backend keeps the verbatim-first `errorMessage`.
	 *  The vocabulary is the vendor's, so only the adapter that speaks it may declare it. */
	readPromptRejection?(err: unknown): AcpPromptRejection | undefined;

	/** OPTIONAL capability (#168): admit the ACP server that answered `initialize`, before any
	 *  session exists. The answer's `agentInfo` (ACP `Implementation`, optional in protocol v1) is the
	 *  launched server's own name and version — an operator override included — so a floor needs no
	 *  PATH probe. Throws a named refusal. ABSENT admits every server. */
	admitAgent?(initializeAnswer: unknown): void;

	/**
	 * OPTIONAL capability (#171 step 8): this backend's stored sessions can be resumed under the same
	 * id. ABSENT: a stored session of this backend stops.
	 * - `agent`: the pin whose attach range `[floor, attachBelow)` holds both the reader that may attach
	 *   and the writers whose sessions it may resume (`attachAllowed`, `resumeAllowed`);
	 * - `unknownDispatch`: what to do with inputs of a prompt whose outcome is unknown. `skip`: never
	 *   send them again (the agent may hold them). `resend`: send every input after the last answer
	 *   again (the agent keeps nothing of an unanswered prompt).
	 */
	resume?: Readonly<{
		agent: AcpAgentPin;
		unknownDispatch: "skip" | "resend";
	}>;
}

/** Explicit summary-turn modes a backend adapter may declare (#168 S1). */
export type AcpSummaryTurnMode = "toolless" | "execution-denied";

/** The named refusal for a summary turn on a backend with no declared summary mode. Fixed text,
 *  non-transient to pi: replaying the request cannot give the backend a surface it lacks. */
export const ACP_SUMMARY_TURN_UNSUPPORTED = "acp-summary-turn-unsupported";

/** A vendor rejection an adapter recognised (`readPromptRejection`). */
export interface AcpPromptRejection {
	/** What failed: the vendor's own kind as it named it on the wire (claude), or an entwurf tag
	 *  for a failure the adapter does not type by kind (agy: `jsonrpc:<code>` / `error:<name>`). */
	errorKind: string;
	/** Entwurf-authored and fixed — no vendor text, ids or numbers: this is what pi classifies. */
	verdict: string;
	/** The JSON-RPC `data`, re-serialized as evidence (it arrived as parsed JSON). */
	dataJson: string;
}

/** The named refusals for an ACP server that does not name itself as the adapter's vendor at or
 *  above its floor (#168, GLG 2026-11-17: both ACP backends hold a floor). */
export const ACP_CLAUDE_VERSION_UNSUPPORTED = "acp-claude-version-unsupported";
export const ACP_AGY_VERSION_UNSUPPORTED = "acp-agy-version-unsupported";

/** `initialize.agentInfo` as each server answers it. Claude: the bundled pin, which a test binds to
 *  package.json (`[측정 2026-11-17]` 0.107.0 and 0.107.3 answered this name and their own version).
 *  agy: the one measured version (#167, 2026-11-16).
 *
 *  `floor` admits a server to run at all (#168). `measured` is the version whose session resume/load
 *  the receipts named in docs/acp-client-baseline.md measured; a gate binds it to the version the
 *  Receipts paragraph names (receipt-versions.ts). `[floor, attachBelow)` is the range whose readers
 *  may attach a stored session and whose writers' sessions they may resume (#171 V5). Claude's range is
 *  its bundled pin alone (decision 10, GLG 2026-11-21). agy updates itself often, so its range is the
 *  1.5 line from the floor, measured or not; 1.6.0 waits for a review (GLG 2026-11-22). */
export const CLAUDE_ACP_AGENT = Object.freeze({
	name: "@agentclientprotocol/claude-agent-acp",
	floor: "0.112.0",
	measured: "0.112.0",
	attachBelow: "0.112.1",
});
export const AGY_ACP_AGENT = Object.freeze({
	name: "Antigravity ACP Server",
	floor: "1.5.9",
	measured: "1.5.13",
	attachBelow: "1.6.0",
});

function parseReleaseVersion(value: unknown): [number, number, number] | undefined {
	if (typeof value !== "string") return undefined;
	const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(value);
	return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : undefined;
}

function versionAtLeast(have: [number, number, number], floor: [number, number, number]): boolean {
	for (let i = 0; i < 3; i++) if (have[i] !== floor[i]) return have[i] > floor[i];
	return true;
}

/** Refuse unless `initialize.agentInfo` names `expected.name` at `expected.floor` or newer. The
 *  version must be strict X.Y.Z: a pre-release, build metadata, a malformed or a missing version
 *  refuses, since nothing measured stands behind it. When the adapter's operator override
 *  (`overrideEnv`) is set, the refusal names that variable — never its value — as what launched the
 *  server. The text is non-transient to pi's retry and overflow classifiers
 *  ([QK:ACP-AGENT-ADMIT-NOT-TRANSIENT]). */
export function admitAcpAgent(
	answer: unknown,
	backend: string,
	refusal: string,
	expected: Readonly<{ name: string; floor: string }>,
	overrideEnv?: string,
): void {
	const info = (answer as { agentInfo?: { name?: unknown; version?: unknown } | null } | null | undefined)?.agentInfo;
	const have = parseReleaseVersion(info?.version);
	const floor = parseReleaseVersion(expected.floor);
	if (!floor) throw new Error(`entwurf: ${refusal} — the declared floor ${jsonText(expected.floor)} is not X.Y.Z`);
	if (info?.name === expected.name && have && versionAtLeast(have, floor)) return;
	const observed =
		info == null ? "no agentInfo" : `${jsonText(info.name ?? null)} version ${jsonText(info.version ?? null)}`;
	throw new Error(
		`entwurf: ${refusal} — the ${backend} ACP backend answered initialize with ${observed}; entwurf requires ` +
			`${expected.name} ${expected.floor} or newer. No session was created. Install a supported version; ` +
			`repeating this request cannot change that.` +
			(overrideEnv && process.env[overrideEnv]?.trim()
				? ` (The server was launched by ${overrideEnv}, which owns its whole command line.)`
				: ""),
	);
}

/** What one ACP child said about itself in its `initialize` answer (#171 L1). Read once per child and
 *  never inferred: a field that is absent, null or of the wrong type reads as absent. */
export interface AcpAgentFacts {
	/** `agentInfo` name and version as answered; null unless both are strings. */
	readonly agent: Readonly<{ name: string; version: string }> | null;
	/** `agentCapabilities.loadSession === true`. */
	readonly loadSession: boolean;
	/** The keys of `agentCapabilities.sessionCapabilities` whose value is an object, sorted. */
	readonly sessionCapabilities: readonly string[];
	/** The `id` of each `authMethods` entry, in answer order. */
	readonly authMethods: readonly string[];
}

function objectOrUndefined(value: unknown): Record<string, unknown> | undefined {
	return typeof value === "object" && value !== null && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: undefined;
}

/** Read an `initialize` answer into the child's facts. Pure and total: it never throws. */
export function readAgentFacts(initializeAnswer: unknown): AcpAgentFacts {
	const answer = objectOrUndefined(initializeAnswer);
	const info = objectOrUndefined(answer?.agentInfo);
	const capabilities = objectOrUndefined(answer?.agentCapabilities);
	const session = objectOrUndefined(capabilities?.sessionCapabilities) ?? {};
	const methods = Array.isArray(answer?.authMethods) ? answer.authMethods : [];
	return Object.freeze({
		agent:
			typeof info?.name === "string" && typeof info.version === "string"
				? Object.freeze({ name: info.name, version: info.version })
				: null,
		loadSession: capabilities?.loadSession === true,
		sessionCapabilities: Object.freeze(
			Object.keys(session)
				.filter((key) => objectOrUndefined(session[key]))
				.sort(),
		),
		authMethods: Object.freeze(
			methods.flatMap((method) => {
				const id = objectOrUndefined(method)?.id;
				return typeof id === "string" ? [id] : [];
			}),
		),
	});
}

/** An ACP agent as entwurf pins it: the name it answers, the admission floor, the measured version and
 *  the first version that may not attach a stored session. */
export type AcpAgentPin = Readonly<{ name: string; floor: string; measured: string; attachBelow: string }>;

/** Why a stored session may not be attached on a child. */
export type AcpAttachRefusal = "agent-unnamed" | "version-out-of-range" | "capability-absent";
export type AcpAttachJudgement = { allowed: true } | { allowed: false; reason: AcpAttachRefusal };

/** Is `version` an X.Y.Z inside the pin's attach range `[floor, attachBelow)`? A prerelease or build
 *  suffix is not X.Y.Z and is outside. Throws when the pin's own range is not two ascending X.Y.Z. */
function inAttachRange(version: string, agent: AcpAgentPin): boolean {
	const floor = parseReleaseVersion(agent.floor);
	const below = parseReleaseVersion(agent.attachBelow);
	if (!floor || !below || versionAtLeast(floor, below))
		throw new Error(
			`entwurf: the attach range [${jsonText(agent.floor)}, ${jsonText(agent.attachBelow)}) of ${agent.name} is not two ascending X.Y.Z versions`,
		);
	const have = parseReleaseVersion(version);
	return have !== undefined && versionAtLeast(have, floor) && !versionAtLeast(have, below);
}

/**
 * May a stored ACP session be attached (`session/resume` or `session/load`) on this child (#171 V5)?
 * Only the pinned agent, reporting a version inside its attach range `[floor, attachBelow)`,
 * advertising the capability the attach needs: resume needs `sessionCapabilities.resume`, load needs
 * `loadSession`. Admission (`admitAcpAgent`) has no upper bound; this has — a newer admitted server,
 * an operator override's included, is refused. Pure.
 */
export function attachAllowed(facts: AcpAgentFacts, agent: AcpAgentPin, need: "resume" | "load"): AcpAttachJudgement {
	const inRange = inAttachRange(facts.agent?.version ?? "", agent);
	if (facts.agent?.name !== agent.name) return { allowed: false, reason: "agent-unnamed" };
	if (!inRange) return { allowed: false, reason: "version-out-of-range" };
	const advertised = need === "resume" ? facts.sessionCapabilities.includes("resume") : facts.loadSession;
	return advertised ? { allowed: true } : { allowed: false, reason: "capability-absent" };
}

/** The pi diagnostic type under which backend.ts preserves a recognised rejection verbatim. */
export const ACP_PROMPT_REJECTION_DIAGNOSTIC = "entwurf_acp_prompt_rejection";

/**
 * May the session a record names be resumed on this child (#171 step 8)? The reader must be inside the
 * adapter's attach range advertising resume (`attachAllowed`), and the record's writer must be the
 * same agent inside the same range. Pure.
 */
export function resumeAllowed(
	facts: AcpAgentFacts,
	resume: NonNullable<AcpBackendAdapter["resume"]>,
	writer: Readonly<{ name: string; version: string }>,
): AcpAttachJudgement | { allowed: false; reason: "writer-out-of-range" } {
	const reader = attachAllowed(facts, resume.agent, "resume");
	if (!reader.allowed) return reader;
	if (writer.name !== resume.agent.name || !inAttachRange(writer.version, resume.agent)) {
		return { allowed: false, reason: "writer-out-of-range" };
	}
	return { allowed: true };
}

/** The verdict for claude-agent-acp's `incomplete_tool_call` (#127; upstream #1212, 0.85.0+). */
export const INCOMPLETE_TOOL_CALL_VERDICT =
	"ACP turn failed because foreground tool results are incomplete. Some tools may already have run; automatic replay is unsafe. Inspect the preserved vendor rejection before continuing.";

/** The verdict for EVERY prompt-phase failure of an agy turn (#167). Fixed, no vendor text: pi's
 *  retry and overflow classifiers read it as neither, so a turn whose tools may have run under
 *  bypassed permissions is never replayed by pi. */
export const AGY_PROMPT_FAILURE_VERDICT =
	"agy ACP turn failed after its prompt was sent. Tools may already have run with permission prompts bypassed; automatic replay is unsafe. Inspect the preserved backend failure before continuing.";

// ---------------------------------------------------------------------------
// claude adapter — the first implementation (the rail's reference backend)
// ---------------------------------------------------------------------------

const SUPPORTED_CLAUDE_IDS: ReadonlySet<string> = new Set(SUPPORTED_ANTHROPIC_MODEL_IDS);

/** JSON-RPC internal error — the code claude-agent-acp rejects an unfinished-tool turn with. */
const JSONRPC_INTERNAL_ERROR = -32603;
/** claude-agent-acp's own kind for a turn that hit `end_turn` with foreground tools unanswered
 *  (read at v0.85.1 `src/acp-agent.ts:4286-4340`, `errorKindData("incomplete_tool_call")`). */
const CLAUDE_INCOMPLETE_TOOL_CALL = "incomplete_tool_call";

/**
 * The claude reader for `readPromptRejection` (#127). Only the root wire SDK's own decode
 * counts: its client rejects a JSON-RPC error response with `new RequestError(code, message,
 * data)`, `data` being the parsed `error.data` (sdk 1.4.0 `dist/jsonrpc.js:842-844`). A
 * look-alike object, another code, or another `errorKind` is not this failure and keeps the
 * verbatim-first path.
 */
function readClaudePromptRejection(err: unknown): AcpPromptRejection | undefined {
	if (!(err instanceof RequestError) || err.code !== JSONRPC_INTERNAL_ERROR) return undefined;
	const data = err.data;
	if (typeof data !== "object" || data === null || !("errorKind" in data)) return undefined;
	if (data.errorKind !== CLAUDE_INCOMPLETE_TOOL_CALL) return undefined;
	return { errorKind: CLAUDE_INCOMPLETE_TOOL_CALL, verdict: INCOMPLETE_TOOL_CALL_VERDICT, dataJson: jsonText(data) };
}

/**
 * The agy reader for `readPromptRejection` (#167). Unlike claude's it names no single kind: which
 * typed rejections agy answers a prompt with is unmeasured, and a synthetic sweep (#167 thread,
 * 2026-11-16) showed the plain JSON-RPC `Internal error`, a `429`, a wrapped `UNAUTHENTICATED` and
 * a `rate limit` text all read as transient to pi after a tool had completed. finishError consults
 * this only for a failure after the prompt went on the wire (never bootstrap, never an abort), and
 * agy runs with its permission prompts bypassed — so every such failure gets the fixed verdict, and
 * the raw failure rides the diagnostic. A transient failure that a replay would have cured is the
 * cost, accepted over a tool running twice.
 */
function readAgyPromptRejection(err: unknown): AcpPromptRejection {
	if (err instanceof RequestError) {
		return {
			errorKind: `jsonrpc:${err.code}`,
			verdict: AGY_PROMPT_FAILURE_VERDICT,
			dataJson: jsonText(err.data ?? null),
		};
	}
	const errorKind = err instanceof Error ? `error:${err.name}` : `thrown:${typeof err}`;
	return { errorKind, verdict: AGY_PROMPT_FAILURE_VERDICT, dataJson: "null" };
}

/** Evidence text for a wire value. A value that came off the wire serializes; one that cannot
 *  (a hand-built fake) is named as such, so recording evidence never breaks the turn's seal. */
function jsonText(value: unknown): string {
	try {
		return JSON.stringify(value) ?? String(value);
	} catch (err) {
		return `[unserializable: ${err instanceof Error ? err.name : typeof err}]`;
	}
}

/**
 * Resolve the claude launch — an ENTWURF-OWNED launcher, or the env override for debug.
 * This is the single source for the claude launch spec; backend.ts holds no private copy.
 *
 * The default no longer names the vendor bin directly. `claude-acp-launch.js`
 * imports it in-process; that file's header carries the reason (#72: a janitor
 * for another harness selects `claude-agent-acp` by argv substring and SIGTERMs
 * it by age, and the vendor's own handler erases the signal into exit 0).
 *
 * `CLAUDE_AGENT_ACP_COMMAND` is an EXPLICIT operator override and is deliberately
 * NOT routed through the launcher: an operator who names their own command owns
 * the result, including the loss of the name split and the signal observation.
 */
function resolveClaudeLaunch(): AcpLaunchSpec {
	const override = process.env.CLAUDE_AGENT_ACP_COMMAND?.trim();
	if (override) return { command: "bash", args: ["-lc", override] };
	// Resolved here (not inside the launcher's own directory lookup) so a missing
	// vendor package still fails at launch resolution, where it always failed.
	const require = createRequire(import.meta.url);
	require.resolve("@agentclientprotocol/claude-agent-acp/package.json");
	const launcher = fileURLToPath(new URL("./claude-acp-launch.js", import.meta.url));
	return { command: process.execPath, args: [launcher] };
}

/**
 * The claude child runs with Claude Code's own background-task switch on (#125): the vendor drops
 * `run_in_background` from the Bash/Agent schemas it declares to the model and turns off timeout and
 * turn-abort backgrounding. Without it a vendor-backgrounded command runs in its own session (setsid),
 * outlives an ACP cancel, and is orphaned to init when the child exits — the process-group teardown
 * cannot reach it (`[측정 2026-10-02]` claude-agent-sdk 0.3.274 / claude-agent-acp 0.79.0). A process a
 * command detaches on its own is outside the switch. It rides
 * the claude adapter's launch env, which backend.ts spreads over `process.env` at spawn, so an
 * ambient value cannot turn it off. Cortex declares nothing of the kind.
 */
export const CLAUDE_FOREGROUND_ONLY_ENV = { CLAUDE_CODE_DISABLE_BACKGROUND_TASKS: "1" } as const;

/**
 * The set-model answer is read back before the prompt (#128). claude-agent-acp resolves the
 * requested id onto one of the rows it offers and answers with that row's `value` as the model
 * option's `currentValue` (0.85.1 `dist/acp-agent.js:5459-5499`). `[측정 2026-10-12]` 0.85.1, no
 * prompt: `claude-fable-5-1` answers its own row (and, at 0.106.0 #142, so does `claude-fable-5-2`; 2026-11-17: only on a session created with that model), while `claude-sonnet-5-5` and `claude-opus-5-5`
 * answer the alias rows `sonnet` and `opus`, named `Sonnet 5.5` and `Opus 5.5`. The id an alias row
 * resolves to (`ModelInfo.resolvedModel`) is not on the ACP wire, so an alias answer is accepted
 * only as the exact measured row, value AND name, declared here for the requested id. No other
 * spelling is matched. After `session/resume` the same driver answers differently (#174), which is
 * the separate table below.
 */
export const CLAUDE_SET_MODEL_ALIAS_ROWS: Readonly<Record<string, Readonly<{ value: string; name: string }>>> =
	Object.freeze({
		"claude-sonnet-5-5": Object.freeze({ value: "sonnet", name: "Sonnet 5.5" }),
		"claude-opus-5-5": Object.freeze({ value: "opus", name: "Opus 5.5" }),
	});

/**
 * What the driver answers for an id after `session/resume`, where it differs from a created session
 * (#174). `[측정 2026-11-24]` claude-agent-acp 0.109.0: a session created with `claude-fable-5-2`
 * answers that id as its own row, while the same session resumed answers the alias row `fable` named
 * `Fable 5.2` and offers no `claude-fable-5-2` row at all. The row is accepted only on a session this
 * bootstrap resumed, as the exact measured value AND name, and only while the offered rows hold no
 * row of the requested id: a driver that offers the id and still selects the alias is refused. The
 * name is the measured shape of the row, not evidence of which model it resolves to.
 */
export const CLAUDE_RESUMED_SET_MODEL_ALIAS_ROWS: Readonly<Record<string, Readonly<{ value: string; name: string }>>> =
	Object.freeze({
		"claude-fable-5-2": Object.freeze({ value: "fable", name: "Fable 5.2" }),
	});

/** Refuse unless the set-model answer names the requested model. A missing model option, another
 *  row, or a row that is not the measured alias row would let a different model answer under this id. */
export function confirmClaudeSetModelAnswer(response: unknown, nativeModelId: string, resumedAttach: boolean): void {
	const configOptions = (response as { configOptions?: unknown } | null | undefined)?.configOptions;
	const modelOption = Array.isArray(configOptions)
		? (configOptions as Array<Record<string, unknown> | null>).find((option) => option?.id === "model")
		: undefined;
	const currentValue = modelOption?.currentValue;
	if (typeof currentValue === "string" && currentValue === nativeModelId) return;
	const rows = Array.isArray(modelOption?.options)
		? (modelOption.options as Array<Record<string, unknown> | null>).flatMap((row) =>
				Array.isArray(row?.options) ? (row.options as Array<Record<string, unknown> | null>) : [row],
			)
		: [];
	const selected = typeof currentValue === "string" ? rows.find((row) => row?.value === currentValue) : undefined;
	const alias = CLAUDE_SET_MODEL_ALIAS_ROWS[nativeModelId];
	if (alias !== undefined && currentValue === alias.value && selected?.name === alias.name) return;
	const resumedAlias = resumedAttach === true ? CLAUDE_RESUMED_SET_MODEL_ALIAS_ROWS[nativeModelId] : undefined;
	if (
		resumedAlias !== undefined &&
		currentValue === resumedAlias.value &&
		selected?.name === resumedAlias.name &&
		!rows.some((row) => row?.value === nativeModelId)
	) {
		return;
	}
	const answered =
		modelOption === undefined
			? "no model option"
			: `model ${jsonText(currentValue)} named ${jsonText(selected?.name ?? null)}`;
	throw new Error(
		`entwurf: claude-agent-acp answered set-model ${JSON.stringify(nativeModelId)} with ${answered}, which does not ` +
			`name the requested model. Refusing before the prompt so a different model cannot answer under this id; ` +
			`the installed driver and the curated id disagree, and repeating the turn cannot change that.`,
	);
}

const CLAUDE_EFFORT_VALUE_SET: ReadonlySet<string> = new Set(CLAUDE_ACP_EFFORT_VALUES);

/** The named refusal for a thinking level ACP Claude cannot carry (#142). The text is fixed and
 *  must read as NON-transient to pi's retry and overflow classifiers: replaying the turn cannot
 *  change the level that was asked for. */
export const ACP_THINKING_LEVEL_UNSUPPORTED = "acp-thinking-level-unsupported";

/**
 * Map pi's requested level to the claude-agent-acp effort value, or refuse by name (#142).
 * The value is the registered row's `thinkingLevelMap` entry for that level — the documented pi
 * meaning of the map — and must be one of the measured effort values. `undefined` (pi off, or no
 * level) is refused rather than left at the vendor `default`: that would let the turn run at a
 * depth nobody chose while the operator believes a level was applied.
 */
export function resolveClaudeEffort(
	modelId: string,
	reasoning: string | undefined,
	thinkingLevelMap: Readonly<Record<string, string | null | undefined>> | undefined,
): string {
	const value = reasoning === undefined ? undefined : thinkingLevelMap?.[reasoning];
	if (typeof value === "string" && CLAUDE_EFFORT_VALUE_SET.has(value)) return value;
	const asked =
		reasoning === undefined
			? "no thinking level (pi sends none for `off`, and none when no level is set; the two are indistinguishable here)"
			: `thinking level ${JSON.stringify(reasoning)}`;
	throw new Error(
		`entwurf: ${ACP_THINKING_LEVEL_UNSUPPORTED} — ${modelId} over Claude ACP carries effort ` +
			`${CLAUDE_ACP_EFFORT_VALUES.join("/")} only, and was asked for ${asked}. Choose one of those levels; ` +
			`the turn was not sent, and repeating it at the same level cannot change that.`,
	);
}

function claudeEffortRefusal(modelId: string, value: string, what: string, cause?: unknown): Error {
	const error = new Error(
		`entwurf: claude-agent-acp ${what} for effort ${JSON.stringify(value)} on ${modelId}. Refusing before the prompt ` +
			`so the turn cannot run at an effort nobody chose; repeating the turn cannot change the driver's answer.`,
	);
	if (cause !== undefined) (error as Error & { cause?: unknown }).cause = cause;
	return error;
}

/** Refuse unless the set-effort answer reads back the requested value. */
export function confirmClaudeEffortAnswer(response: unknown, modelId: string, value: string): void {
	const configOptions = (response as { configOptions?: unknown } | null | undefined)?.configOptions;
	const effort = Array.isArray(configOptions)
		? (configOptions as Array<Record<string, unknown> | null>).find((option) => option?.id === "effort")
		: undefined;
	if (effort?.currentValue === value) return;
	throw claudeEffortRefusal(
		modelId,
		value,
		effort == null ? "answered with no effort option" : `answered effort ${jsonText(effort.currentValue)}`,
	);
}

export const claudeAdapter: AcpBackendAdapter = {
	backend: "claude",

	// Claude owns its UNPREFIXED curated ids only (rail “Adapter contract”). The native id
	// equals the curated id — claude carries no curation prefix to strip.
	routeModel(modelId) {
		return SUPPORTED_CLAUDE_IDS.has(modelId) ? { nativeModelId: modelId } : undefined;
	},

	curatedModels() {
		return curatedClaudeModels();
	},

	// Claude carries no backend-specific settings — its entire surface is common
	// config (tools/permissions/settingSources/…). undefined → config.adapterSettings
	// is undefined and no claude method reads it.
	resolveAdapterSettings() {
		return undefined;
	},

	resolveLaunch() {
		return resolveClaudeLaunch();
	},

	launchEnvDefaults() {
		return { ...claudeLaunchEnvDefaults(), ...CLAUDE_FOREGROUND_ONLY_ENV };
	},

	ensureOverlay() {
		// Claude's overlay is constant (no settings dependence), so it ignores params.
		ensureClaudeConfigOverlay();
		// CLAUDE_CONFIG_DIR rides launchEnvDefaults(); the overlay materialization
		// itself contributes no extra spawn env.
		return { envOverrides: {} };
	},

	loadCarrier({ mcpServerNames }) {
		// Claude's carrier is the shipped engraving — it does not read config.
		return loadEngraving({ backend: "claude", mcpServerNames });
	},

	buildSessionMeta({ nativeModelId, config }, carrier) {
		// buildClaudeSessionMeta always returns an object (it only omits the
		// systemPrompt KEY when carrier is absent), so claude never yields undefined.
		return buildClaudeSessionMeta(
			{
				modelId: nativeModelId,
				tools: config.tools,
				permissionAllow: config.permissionAllow,
				disallowedTools: config.disallowedTools,
				settingSources: config.settingSources,
				strictMcpConfig: config.strictMcpConfig,
				skillPlugins: config.skillPlugins,
			},
			carrier ?? undefined,
		);
	},

	async enforceModel({ connection, acpSessionId, nativeModelId, modelId, resumedAttach }) {
		const setConfig = connection.setSessionConfigOption;
		if (typeof setConfig !== "function") {
			throw new Error(`setSessionConfigOption unsupported — cannot enforce model ${modelId}`);
		}
		const answer = await setConfig.call(connection, {
			sessionId: acpSessionId,
			configId: "model",
			value: nativeModelId,
		});
		confirmClaudeSetModelAnswer(answer, nativeModelId, resumedAttach);
	},

	resolveThinking({ modelId, reasoning, thinkingLevelMap }) {
		return resolveClaudeEffort(modelId, reasoning, thinkingLevelMap);
	},

	async enforceThinking({ connection, acpSessionId, modelId, value }) {
		const setConfig = connection.setSessionConfigOption;
		if (typeof setConfig !== "function") {
			throw new Error(`setSessionConfigOption unsupported — cannot set effort for ${modelId}`);
		}
		let answer: unknown;
		try {
			answer = await setConfig.call(connection, { sessionId: acpSessionId, configId: "effort", value });
		} catch (err) {
			throw claudeEffortRefusal(modelId, value, "refused the set", err);
		}
		confirmClaudeEffortAnswer(answer, modelId, value);
	},

	configSignatureFields(_adapterSettings) {
		// Claude folds no extra backend-specific fields beyond backend + nativeModelId
		// (which backend.ts adds). A future backend reads its own stable id off
		// `_adapterSettings` here.
		return {};
	},

	// MEASURED (2026-09-02, #93): claude-agent-acp's `usage_update` carries a
	// session-cumulative ESTIMATED cost (`cost.amount = message.total_cost_usd`)
	// and a context-occupancy scalar (`used`; both read at 0.79.0
	// `dist/acp-agent.js:3504-3519`). Both are measured, so backend.ts seals them.
	// The token partition is NOT declared here: ACP's only token carrier is a
	// per-turn round-trip aggregate, which is not what pi's four fields mean.
	sealsTurnAccounting: true,

	// #163: the summary child gets `tools: []`, no MCP, no plugin and nothing pre-approved through
	// buildSessionMeta ([QK:ACP-SUMMARY-TURN-TOOLLESS]).
	summaryTurnMode: "toolless",

	// #175: measured 2026-11-25 (d3, n=1): a lone `/compact` on a resumed session answers `end_turn` with
	// compaction_update in_progress → completed inside the prompt, also on a session already compacted.
	compactCommand: "/compact",

	// #127: claude-agent-acp 0.85.0+ rejects an `end_turn` with unanswered foreground tools as
	// -32603 `incomplete_tool_call` (upstream #1212). Its raw text reads as transient to pi.
	readPromptRejection: readClaudePromptRejection,

	// #168: the server that answered initialize must be claude-agent-acp at the bundled pin or newer.
	admitAgent: (answer) =>
		admitAcpAgent(answer, "claude", ACP_CLAUDE_VERSION_UNSUPPORTED, CLAUDE_ACP_AGENT, "CLAUDE_AGENT_ACP_COMMAND"),
	// #171 step 7 receipts, re-measured on 0.112.0 for #176: the pin resumes its own sessions, and the attach range is that pin alone. A
	// record an earlier version wrote names no last answer and never reaches this judgement (GLG
	// 2026-11-22). An input of an unanswered prompt may be in the session's history (G2a), so it is
	// never sent twice.
	resume: Object.freeze({
		agent: CLAUDE_ACP_AGENT,
		unknownDispatch: "skip",
	}),
};

// ---------------------------------------------------------------------------
// agy adapter — Antigravity's own ACP server, `agy acp` (#167)
// ---------------------------------------------------------------------------
//
// Every wire fact below was measured against agy 1.5.9 on 2026-11-16 (receipts on #167). This is
// the ACP-backend lane only: a host pi citizen drives `agy acp` as a child. It registers no
// citizen, touches no meta-store backend, and does not lift the native-push pause (#152).

const SUPPORTED_AGY_NATIVE_IDS: ReadonlySet<string> = new Set(SUPPORTED_AGY_NATIVE_MODEL_IDS);

/** The named refusal for operator tool narrowing agy cannot apply. Fixed text, non-transient to pi. */
export const ACP_AGY_NARROWING_UNSUPPORTED = "acp-agy-narrowing-unsupported";

/** The `entwurfProvider` keys that narrow a Claude child's tools and have no agy seat. */
/** The agy adapter's own settings: the operator's GLOBAL `skillPlugins`, the one list the shared
 *  overlay can project. */
export interface AgyAdapterSettings {
	skillPlugins: string[];
}

export const AGY_UNSUPPORTED_NARROWING_KEYS = ["tools", "disallowedTools", "permissionAllow"] as const;

/** The one policy phase 1 ships (#168 ①): deny the three tools measured to call the model with no ACP
 *  frame (`invoke_subagent`, `schedule`, `run_workflow`), allow every other tool. Versioned — the hook
 *  denies every tool on a value it does not know. It is the hook's argument in the seat's command, not
 *  child env: the overlay is shared by every pi on the host, and a pi that predates the seat sets no
 *  env for its children, which re-read the seat on every call. */
export const AGY_HOOK_POLICY_HIDDEN_TURNS = "v1:hidden-turns";

/** Summary-turn hook policy (#168): denies every tool call in an isolated per-turn gemini-dir. */
export const AGY_HOOK_POLICY_DENY_ALL = "v1:deny-all";

/** Named refusal when AGY_ACP_COMMAND override is active on a summary turn (#168 C1). */
export const ACP_AGY_SUMMARY_OVERRIDE_UNSUPPORTED = "acp-agy-summary-override-unsupported";

function refuseAgySummaryOverride(): never {
	throw new Error(
		`entwurf: ${ACP_AGY_SUMMARY_OVERRIDE_UNSUPPORTED} — AGY_ACP_COMMAND owns the whole command line, ` +
			`so entwurf cannot isolate --gemini-dir or enforce ${AGY_HOOK_POLICY_DENY_ALL} on a summary turn. ` +
			`Nothing was started. Unset AGY_ACP_COMMAND or switch to a Claude row to summarize.`,
	);
}

/** Where the hook ships: beside this module, as source (`pi-extensions/` is in the package). Resolved
 *  when an overlay is written, never at import — the bridge's compiled tree carries this module but
 *  not the hook, and never writes an overlay. */
export function agyAcpHookPath(): string {
	return fileURLToPath(new URL("./agy-acp-hook.mjs", import.meta.url));
}

function shellSingleQuote(value: string): string {
	return `'${value.replaceAll("'", "'\\''")}'`;
}

/**
 * The command the seat names. agy runs it through `sh -c` (measured), so both paths and the policy are
 * single-quoted and nothing in them is expanded. It is this process's own Node binary and the hook
 * by absolute path — the precedent is `resolveClaudeLaunch`, which runs `claude-acp-launch.js` with
 * `process.execPath`. A bare command name, as the native-push imprint hook uses, would be resolved
 * through the child's PATH, where another install or a shadowing script could answer for the policy.
 */
export function agyAcpHookCommand(
	execPath: string = process.execPath,
	hookPath: string = agyAcpHookPath(),
	policy: string = AGY_HOOK_POLICY_HIDDEN_TURNS,
): string {
	return [execPath, hookPath, policy].map(shellSingleQuote).join(" ");
}

/** The named refusal for a thinking level agy ACP cannot carry. Fixed text, non-transient to pi. */
export const ACP_AGY_THINKING_LEVEL_UNSUPPORTED = "acp-agy-thinking-level-unsupported";

/**
 * The launch argv after `agy`. The state root, the customization switch and the permission switch
 * are ARGUMENTS on this vendor, so the overlay path rides argv rather than spawn env.
 *
 *  - `--gemini-dir <overlay>` — the whole state root (see `ensureAgyGeminiOverlay`).
 *  - `--include-default-customizations=false` — the vendor's own default customizations stay out.
 *  - `--dangerously-skip-permissions` — unattended operation, the same stance as the Claude
 *    overlay's `bypassPermissions`: a tool call must not suspend a turn on a prompt. Measured: with
 *    it a shell command ran with no `session/request_permission`; without it the server asked.
 */
export function agyLaunchArgs(overlayDir: string = AGY_GEMINI_OVERLAY_DIR): string[] {
	return [
		"acp",
		"--stdio",
		"--gemini-dir",
		overlayDir,
		"--include-default-customizations=false",
		"--dangerously-skip-permissions",
	];
}

function agyConfigOption(response: unknown, id: string): Record<string, unknown> | undefined {
	const configOptions = (response as { configOptions?: unknown } | null | undefined)?.configOptions;
	if (!Array.isArray(configOptions)) return undefined;
	const hit = (configOptions as Array<Record<string, unknown> | null>).find((option) => option?.id === id);
	return hit ?? undefined;
}

/**
 * Refuse unless the set-model answer reads back the requested native id. agy answers
 * `session/set_config_option` with the full option list and `model.currentValue` equal to the value
 * it was given (measured: no alias rows, unlike Claude), and rejects an id it does not offer with
 * `-32602 Unknown model ID` before any prompt.
 */
export function confirmAgySetModelAnswer(response: unknown, nativeModelId: string): void {
	const model = agyConfigOption(response, "model");
	if (model?.currentValue === nativeModelId) return;
	const answered = model === undefined ? "no model option" : `model ${jsonText(model.currentValue)}`;
	throw new Error(
		`entwurf: agy acp answered set-model ${JSON.stringify(nativeModelId)} with ${answered}, which does not name ` +
			`the requested model. Refusing before the prompt so a different model cannot answer under this id; ` +
			`repeating the turn cannot change that.`,
	);
}

/**
 * Map pi's requested level to agy's `thought_level`, or refuse by name. The value is the registered
 * row's `thinkingLevelMap` entry and must be one this native model was measured to offer.
 * `undefined` (pi off, or no level) is refused rather than left at the vendor's `medium`, for the
 * reason Claude's is: the turn would run at a depth nobody chose.
 */
export function resolveAgyThoughtLevel(
	modelId: string,
	reasoning: string | undefined,
	thinkingLevelMap: Readonly<Record<string, string | null | undefined>> | undefined,
): string {
	const native = modelId.startsWith(AGY_MODEL_PREFIX) ? modelId.slice(AGY_MODEL_PREFIX.length) : modelId;
	const offered: readonly string[] = (AGY_THOUGHT_LEVELS as Readonly<Record<string, readonly string[]>>)[native] ?? [];
	const value = reasoning === undefined ? undefined : thinkingLevelMap?.[reasoning];
	if (typeof value === "string" && offered.includes(value)) return value;
	const asked =
		reasoning === undefined
			? "no thinking level (pi sends none for `off`, and none when no level is set; the two are indistinguishable here)"
			: `thinking level ${JSON.stringify(reasoning)}`;
	throw new Error(
		`entwurf: ${ACP_AGY_THINKING_LEVEL_UNSUPPORTED} — ${modelId} over agy ACP carries thought level ` +
			`${offered.join("/") || "(none)"} only, and was asked for ${asked}. Choose one of those levels; ` +
			`the turn was not sent, and repeating it at the same level cannot change that.`,
	);
}

function agyThoughtLevelRefusal(modelId: string, value: string, what: string, cause?: unknown): Error {
	const error = new Error(
		`entwurf: agy acp ${what} for thought level ${JSON.stringify(value)} on ${modelId}. Refusing before the prompt ` +
			`so the turn cannot run at a level nobody chose; repeating the turn cannot change the server's answer.`,
	);
	if (cause !== undefined) (error as Error & { cause?: unknown }).cause = cause;
	return error;
}

/**
 * Refuse unless the set-thought-level answer reads back the requested value. The readback is not a
 * formality on this vendor: agy CLAMPS silently when the model changes under a level it does not
 * offer (measured: Hydrogen at `xhigh`, then set-model Flash, answered `thought_level: high`), so
 * the level is set after the model and only the answer says what the session holds.
 */
export function confirmAgyThoughtLevelAnswer(response: unknown, modelId: string, value: string): void {
	const level = agyConfigOption(response, "thought_level");
	if (level?.currentValue === value) return;
	throw agyThoughtLevelRefusal(
		modelId,
		value,
		level === undefined
			? "answered with no thought_level option"
			: `answered thought level ${jsonText(level.currentValue)}`,
	);
}

export const agyAdapter: AcpBackendAdapter = {
	backend: "agy",

	// agy owns the reserved `agy-` prefix; the native id is what its `model` option offers.
	routeModel(modelId) {
		if (!modelId.startsWith(AGY_MODEL_PREFIX)) return undefined;
		const nativeModelId = modelId.slice(AGY_MODEL_PREFIX.length);
		return SUPPORTED_AGY_NATIVE_IDS.has(nativeModelId) ? { nativeModelId } : undefined;
	},

	curatedModels() {
		return curatedAgyModels();
	},

	// No backend-specific settings: the account, tier and model set are whatever the operator's
	// `agy acp --login` holds. What this does read is the operator's Claude-shaped NARROWING: agy
	// has no seat for `tools`, `disallowedTools` or `permissionAllow`, and the child runs with its
	// permission prompts bypassed, so honouring a config that says "only these tools" by ignoring
	// it would hand the model a shell the operator had taken away. Any of the three, set in either
	// settings file, refuses the turn here — before the overlay, the spawn or the session.
	//
	// What it returns is the one setting agy can honour: `skillPlugins`, read from the GLOBAL block
	// only. Every agy child shares one overlay, so a per-project list would have two siblings
	// sweeping each other's skill links; a project-only `skillPlugins` therefore reaches no agy child.
	resolveAdapterSettings({ globalBlock, mergedBlock, projectBlock, globalPath, projectPath }): AgyAdapterSettings {
		for (const key of AGY_UNSUPPORTED_NARROWING_KEYS) {
			if (mergedBlock[key] === undefined) continue;
			const where = projectBlock[key] !== undefined ? projectPath : globalPath;
			throw new Error(
				`entwurf: ${ACP_AGY_NARROWING_UNSUPPORTED} — ${where} sets entwurfProvider.${key}, and the agy ACP backend ` +
					`cannot apply it: agy takes no tool list or allow list and runs with its permission prompts bypassed. ` +
					`Nothing was started. Use a Claude row for a narrowed session, or remove the setting; repeating this request cannot change that.`,
			);
		}
		const declared = globalBlock.skillPlugins;
		return { skillPlugins: Array.isArray(declared) ? declared.filter((p): p is string => typeof p === "string") : [] };
	},

	// `agy` from PATH — the CLI is the ACP server. `AGY_ACP_COMMAND` is the explicit operator
	// override and, like Claude's, owns its whole command line: the overlay and permission
	// arguments are not appended to it. Because an override owns the command line, a summary turn
	// cannot force `--gemini-dir` isolation or `v1:deny-all` and is refused by name (#168 C1).
	resolveLaunch({ summaryTurn, overlayDir } = {} as AcpLaunchParams) {
		const override = process.env.AGY_ACP_COMMAND?.trim();
		if (override) {
			if (summaryTurn) refuseAgySummaryOverride();
			return { command: "bash", args: ["-lc", override] };
		}
		return { command: "agy", args: agyLaunchArgs(overlayDir) };
	},

	// Nothing rides the environment: the overlay is an argument (agyLaunchArgs), and the hook policy is
	// an argument of the seat's command (agyAcpHookCommand).
	launchEnvDefaults() {
		return {};
	},

	// Ordinary turns use the shared overlay with `v1:hidden-turns`. Summary turns (#168) get an
	// isolated per-turn root (`~/.pi/agent/agy-summary/<turn>/{gemini,cwd}`) with `v1:deny-all`
	// so the shared overlay is never mutated. Under AGY_ACP_COMMAND, refuse BEFORE creating a root (D1).
	ensureOverlay({ config, summaryTurn }) {
		if (summaryTurn) {
			if (process.env.AGY_ACP_COMMAND?.trim()) refuseAgySummaryOverride();
			const summaryRoot = createAgySummaryRoot();
			try {
				ensureAgyGeminiOverlay(
					undefined,
					summaryRoot.geminiDir,
					[],
					agyAcpHookCommand(process.execPath, agyAcpHookPath(), AGY_HOOK_POLICY_DENY_ALL),
				);
			} catch (err) {
				// No child was spawned; remove the summary root (and any partial token symlink) before rethrowing (O5).
				rmSync(summaryRoot.rootDir, { recursive: true, force: true });
				throw err;
			}
			return {
				envOverrides: {},
				effectiveCwd: summaryRoot.cwd,
				overlayDir: summaryRoot.geminiDir,
				cleanup: (opts) => cleanupAgySummaryRoot(summaryRoot, opts),
			};
		}
		ensureAgyGeminiOverlay(
			undefined,
			undefined,
			(config.adapterSettings as AgyAdapterSettings).skillPlugins,
			agyAcpHookCommand(),
		);
		return { envOverrides: {} };
	},

	loadCarrier({ mcpServerNames }) {
		return loadEngraving({ backend: "agy", mcpServerNames });
	},

	// agy advertises `_meta.antigravity.systemPrompt.append` at initialize and honours a string
	// there on session/new (measured: an appended rule shaped the reply). No carrier → no `_meta`.
	buildSessionMeta(_params, carrier) {
		if (carrier === null) return undefined;
		return { antigravity: { systemPrompt: { append: carrier } } };
	},

	async enforceModel({ connection, acpSessionId, nativeModelId, modelId }) {
		const setConfig = connection.setSessionConfigOption;
		if (typeof setConfig !== "function") {
			throw new Error(`setSessionConfigOption unsupported — cannot enforce model ${modelId}`);
		}
		const answer = await setConfig.call(connection, {
			sessionId: acpSessionId,
			configId: "model",
			value: nativeModelId,
		});
		confirmAgySetModelAnswer(answer, nativeModelId);
	},

	resolveThinking({ modelId, reasoning, thinkingLevelMap }) {
		return resolveAgyThoughtLevel(modelId, reasoning, thinkingLevelMap);
	},

	async enforceThinking({ connection, acpSessionId, modelId, value }) {
		const setConfig = connection.setSessionConfigOption;
		if (typeof setConfig !== "function") {
			throw new Error(`setSessionConfigOption unsupported — cannot set thought level for ${modelId}`);
		}
		let answer: unknown;
		try {
			answer = await setConfig.call(connection, { sessionId: acpSessionId, configId: "thought_level", value });
		} catch (err) {
			throw agyThoughtLevelRefusal(modelId, value, "refused the set", err);
		}
		confirmAgyThoughtLevelAnswer(answer, modelId, value);
	},

	// A resident child spawned under another hook policy is not reused.
	configSignatureFields(_adapterSettings) {
		return { agyHookPolicy: AGY_HOOK_POLICY_HIDDEN_TURNS };
	},

	// NO sealsTurnAccounting — a deliberate absence. agy's `usage_update` carries `used` and `size`
	// and NO cost (measured), so there is no session total to diff; and the seal's cache-miss bound
	// rests on a recurrence observed for Claude Code alone. The common mapper still relays `used`
	// as the context occupancy pi reads.

	// Every prompt-phase failure is non-replayable (readAgyPromptRejection): agy's own rejection
	// vocabulary is unmeasured, and its tools run with permission prompts bypassed.
	readPromptRejection: readAgyPromptRejection,

	// #171 L18: agy joins the text blocks of one prompt with no separator; a blank line keeps them apart.
	textBlockSeparator: "\n\n",

	// #168: the server that answered initialize must be agy's own ACP server at the measured floor or newer.
	admitAgent: (answer) => admitAcpAgent(answer, "agy", ACP_AGY_VERSION_UNSUPPORTED, AGY_ACP_AGENT, "AGY_ACP_COMMAND"),
	// #171 step 7 receipts (U26, U17): 1.5.13 resumes its own sessions and 1.5.12's, and keeps nothing of
	// a prompt it did not answer, so the inputs after the last answer are sent again. The attach range is
	// the whole 1.5 line from the floor (GLG 2026-11-22), so a self-update inside it keeps resume.
	resume: Object.freeze({
		agent: AGY_ACP_AGENT,
		unknownDispatch: "resend",
	}),

	// #168: agy takes no tool list on session/new, so the model still sees tool schemas; summary
	// turns run in an isolated per-turn root with a `v1:deny-all` PreToolUse hook and neutral cwd.
	summaryTurnMode: "execution-denied",

	// #175: measured 2026-11-25 (d3, n=1): a lone `/compact` answers `end_turn` with no compaction_update
	// and no text; its effect shows only in the next turn's `used`.
	compactCommand: "/compact",
};

// ---------------------------------------------------------------------------
// Registry — modelId → adapter
// ---------------------------------------------------------------------------

// The former Cortex implementation is retained privately for historical source
// continuity only. The exported adapter below denies every side-effecting entry,
// and the production registry does not contain this implementation.

const SUPPORTED_CORTEX_IDS: ReadonlySet<string> = new Set(LEGACY_CORTEX_MODEL_IDS);

/** Cortex's OWN settings: a Snowflake connection name, or null. Opaque to
 *  config.ts / backend.ts — only cortexAdapter reads it (casting back). */
export interface CortexAdapterSettings {
	cortexConnection: string | null;
}

/** The env var an operator sets to pin a Snowflake connection per-shell without
 *  editing settings.json. Wins over `entwurfProvider.cortexConnection`. The
 *  ENTWURF_ACP_* convention (PR #40's legacy PI_SHELL_ACP* cortex-connection var renamed). */
export const CORTEX_CONNECTION_ENV = "ENTWURF_ACP_CORTEX_CONNECTION";

const retiredCortexAdapter: AcpBackendAdapter = {
	backend: "cortex",

	// Cortex owns the reserved `cortex-` prefix (rail “Adapter contract”). routeModel strips it to the
	// native id: `cortex-auto` → "auto", `cortex-claude-sonnet-5` → "claude-sonnet-5".
	routeModel(modelId) {
		if (!SUPPORTED_CORTEX_IDS.has(modelId)) return undefined;
		return { nativeModelId: modelId.slice(CORTEX_MODEL_PREFIX.length) };
	},

	curatedModels() {
		return curatedCortexModels();
	},

	// Cortex's ONLY own setting is the connection name. env override wins over
	// settings (per-shell pin); empty/whitespace → null (Cortex falls back to its
	// own default connection). A non-string settings value fails loud.
	resolveAdapterSettings({ mergedBlock, projectBlock, globalPath, projectPath }): CortexAdapterSettings {
		const raw = mergedBlock.cortexConnection;
		if (raw !== undefined && typeof raw !== "string") {
			const offending = projectBlock.cortexConnection !== undefined ? projectPath : globalPath;
			throw new Error(`${offending}: invalid entwurfProvider settings: cortexConnection must be a string`);
		}
		const envConn = process.env[CORTEX_CONNECTION_ENV]?.trim();
		const settingsConn = raw?.trim();
		const cortexConnection = envConn || settingsConn || null;
		return { cortexConnection };
	},

	// `cortex acp serve` resolved from PATH (the CLI itself IS the ACP server — no
	// `*-acp` npm package, unlike claude). `-c <conn>` appended when a connection
	// is pinned. NO `-m`: the model is enforced per-turn via
	// session/set_config_option (enforceModel below, CP0-M measured GO) and a
	// launch pin would be a SECOND model authority that drifts from it.
	// CORTEX_ACP_COMMAND override runs via `bash -lc` with the selection flags
	// appended so the bridge's choice wins (later yargs args override earlier ones).
	resolveLaunch({ config }) {
		const settings = config.adapterSettings as CortexAdapterSettings | undefined;
		const connection = settings?.cortexConnection?.trim() || undefined;
		const selectionArgs: string[] = [];
		if (connection) selectionArgs.push("-c", connection);
		const override = process.env.CORTEX_ACP_COMMAND?.trim();
		if (override) {
			const command = selectionArgs.length > 0 ? `${override} ${selectionArgs.map(shellQuote).join(" ")}` : override;
			return { command: "bash", args: ["-lc", command] };
		}
		return { command: "cortex", args: ["acp", "serve", ...selectionArgs] };
	},

	// The overlay location is SESSION-SCOPED (never static), so the spawn env
	// rides ensureOverlay(...).envOverrides; there is no static launch env. The
	// v1.1.8-era CORTEX_DISABLE_AUTO_APPLY_PROFILES knob was retired with the
	// dual-HOME redesign: profiles now live inside the overlay-owned isolated
	// home (empty by construction), and the knob is unmeasured on v1.1.52.
	launchEnvDefaults() {
		return {};
	},

	// Dual-HOME containment (CP0 D2/D3/D9/D10 — see the overlay module header):
	// refuse an ambient CORTEX_HOME outright, then materialize the session-scoped
	// isolated HOME with auth symlinks, `autoUpdate:false`, and the mcp.json
	// projection of the envelope-enriched explicit servers (cortex ignores the
	// wire mcpServers param, so this file IS how tools reach a cortex session).
	ensureOverlay({ modelId, config, sessionKey }) {
		// D3 — presence refusal, empty string included: upstream's resolver treats
		// a set-but-empty CORTEX_HOME differently from unset, and one ambient value
		// would silently bypass SNOWFLAKE_HOME (the probe's CLAUDE_CODE_EXECUTABLE
		// precondition is the same family). Refuse the ambiguity; never pick a side.
		if ("CORTEX_HOME" in process.env) {
			throw new Error(
				"entwurf: CORTEX_HOME is present in the environment (empty string included) — it overrides " +
					"SNOWFLAKE_HOME inside cortex and would bypass the dual-HOME overlay entirely (CP0 D3). " +
					"Unset it to run a cortex ACP turn.",
			);
		}
		// The scope authority is the AUTHORITATIVE params.sessionKey backend.ts
		// computed — never an ambient re-derivation, which would drop opts.sessionId
		// and alias two same-process/cwd sessions onto one overlay (P0-1). The
		// envelope below still reads PI_SESSION_ID: that is the identity CARRIER for
		// the bridge child (the same source the turn loop's wire enrichment uses),
		// a different axis from overlay-dir scoping.
		const piSessionId = process.env.PI_SESSION_ID?.trim() || undefined;
		const enriched = enrichMcpServersWithEnvelope(config.mcpServers, { modelId, piSessionId });
		const overlay = ensureCortexDualHomeOverlay({
			scopeKey: sessionKey,
			mcpServers: enriched,
			realHome: homedir(),
		});
		return { envOverrides: { HOME: overlay.home, SNOWFLAKE_HOME: overlay.snowflakeHome } };
	},

	// System-prompt-carrier-less (ACP rail “Cortex Code audit”): Cortex ACP exposes no
	// `_meta.systemPrompt` and has no developer_instructions / GEMINI_SYSTEM_MD
	// equivalent. (It does READ `_meta` — a caller-session-id seam, measured but
	// unexplored and deliberately not part of this contract.) loadCarrier returns
	// null WITHOUT calling loadEngraving, so the cortex turn never touches the
	// shipped-engraving / appendSystemPrompt signature; buildSessionMeta returns
	// undefined so backend.ts omits the `_meta` key entirely. The operator
	// engraving instead rides the first-user augment (augment.ts).
	loadCarrier() {
		return null;
	},

	buildSessionMeta() {
		return undefined;
	},

	// Per-turn enforcement via session/set_config_option — the SAME wire call the
	// claude adapter makes, measured live against cortex v1.1.52 (CP0-M): the
	// option id is "model", accepted values are the NATIVE ids (`auto`,
	// `claude-sonnet-5`, `openai-gpt-5.4`, …), and a value cortex no longer
	// serves fails loud BEFORE the prompt (`Unsupported model: …`). PR #40's
	// launch-time `-m` pin was retired for this: set-model is the single model
	// authority (resolveLaunch never passes `-m`), and "auto" is set explicitly
	// rather than treated as an unspoken default. NO answer readback, unlike claude: nobody has
	// measured what cortex's set_config_option response carries, so a check would be a guess.
	async enforceModel({ connection, acpSessionId, nativeModelId, modelId }) {
		const setConfig = connection.setSessionConfigOption;
		if (typeof setConfig !== "function") {
			throw new Error(`setSessionConfigOption unsupported — cannot enforce model ${modelId}`);
		}
		await setConfig.call(connection, { sessionId: acpSessionId, configId: "model", value: nativeModelId });
	},

	// A connection change must invalidate a reused session (rail: Adapter contract). Flat,
	// sorted-stable primitive map; reads ONLY the opaque adapterSettings. `backend`
	// + `nativeModelId` are added by backend.ts.
	configSignatureFields(adapterSettings) {
		const settings = adapterSettings as CortexAdapterSettings | undefined;
		return { cortexConnection: settings?.cortexConnection ?? null };
	},

	// NO sealsTurnAccounting — a DELIBERATE, permanent absence, not an omission to be
	// filled in later by symmetry with claude. Nobody has measured what cortex's
	// ACP `usage` (and its usage_update cost, if it sends one) MEAN: whether the
	// token counts are a turn delta or a session total, and against which price
	// table. Until that measurement exists, the honest report is no report:
	// backend.ts seals nothing for a backend without this flag, so cortex's
	// emitted usage is byte-identical to what it was before #93. Declaring this
	// with a guess would mint exactly the silent misaccounting #93 exists to end.

	// NO readPromptRejection — also deliberate. Nobody has read which failures cortex's ACP
	// server rejects a prompt with, so every cortex failure keeps the verbatim-first
	// errorMessage. Borrowing claude's `incomplete_tool_call` reader would be a guess.
};

const cortexDisabled = (): never => {
	throw new Error("entwurf: cortex-acp-disabled: Cortex ACP is not supported");
};

/** Retained exported shape refuses the retired adapter before a launch or overlay can be made. */
export const cortexAdapter: AcpBackendAdapter = {
	...retiredCortexAdapter,
	routeModel: () => undefined,
	curatedModels: () => [],
	resolveAdapterSettings: cortexDisabled,
	resolveLaunch: cortexDisabled,
	launchEnvDefaults: cortexDisabled,
	ensureOverlay: cortexDisabled,
	loadCarrier: cortexDisabled,
	buildSessionMeta: cortexDisabled,
	enforceModel: cortexDisabled,
	configSignatureFields: cortexDisabled,
};

const ADAPTERS: readonly AcpBackendAdapter[] = [claudeAdapter, agyAdapter];

/** A declared backend is only a guard, never a replacement routing authority. */
export function assertSupportedDeclaredBackend(backend: string | undefined): void {
	if (backend?.toLowerCase() === "cortex") cortexDisabled();
}

/**
 * Resolve the backend adapter that owns `modelId`.
 *
 * Routing fail-fast contract (rail “Adapter contract”):
 *  - 0 matches  → throw (unknown model — no silent default).
 *  - 2+ matches → throw (prefix collision — a startup-visible registry bug).
 *
 * The thrown native id is recovered from the single matching adapter's routeModel,
 * so callers get `{ adapter, nativeModelId }` and never re-parse the id string.
 */
export function resolveAcpBackendAdapter(modelId: string): { adapter: AcpBackendAdapter; nativeModelId: string } {
	if (modelId.toLowerCase().startsWith(CORTEX_MODEL_PREFIX)) {
		throw new Error(`entwurf: cortex-acp-disabled: ${JSON.stringify(modelId)} is not supported`);
	}
	const matches: Array<{ adapter: AcpBackendAdapter; nativeModelId: string }> = [];
	for (const adapter of ADAPTERS) {
		const routed = adapter.routeModel(modelId);
		if (routed) matches.push({ adapter, nativeModelId: routed.nativeModelId });
	}
	if (matches.length === 0) {
		throw new Error(`entwurf: no ACP backend adapter owns model id ${JSON.stringify(modelId)}`);
	}
	if (matches.length > 1) {
		const owners = matches.map((m) => m.adapter.backend).join(", ");
		throw new Error(`entwurf: model id ${JSON.stringify(modelId)} is claimed by multiple adapters (${owners})`);
	}
	return matches[0];
}

/** Every curated model row across all registered adapters — for provider registration.
 *  Registration-time fail-fast (rail “Adapter contract”): every curated id must route to EXACTLY
 *  one adapter and no id may be duplicated across adapters. Catching it here means a
 *  prefix-collision / duplicate surfaces at provider registration, not mid-turn. */
export function allCuratedModels(): AcpModelRow[] {
	const rows = ADAPTERS.flatMap((adapter) => adapter.curatedModels());
	const seen = new Set<string>();
	for (const row of rows) {
		if (seen.has(row.id)) {
			throw new Error(`entwurf: duplicate curated model id across ACP backend adapters: ${row.id}`);
		}
		seen.add(row.id);
		// Throws on 0 matches (unowned) or 2+ matches (prefix collision).
		resolveAcpBackendAdapter(row.id);
	}
	return rows;
}
