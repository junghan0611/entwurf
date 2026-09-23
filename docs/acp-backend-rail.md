# ACP backend adapter rail

The ACP plugin is one provider with backend adapters behind a common turn loop.
It is not a second harness and does not create another citizen or socket layer. The
host pi session already owns the record-backed citizen identity; each backend owns
its own process, auth, transcript, and native tool surface.

Claude is the reference adapter. Snowflake Cortex Code is the second shipped adapter.
Implementation history and audit chronology live in CHANGELOG, issues, and git; this
document keeps the current contract and its open evidence boundary.

## Boundary

| Layer | Owns |
|---|---|
| entwurf core | identity, facts, dispatch, rail choice, delivery evidence |
| ACP common loop | spawn, initialize, new session, model enforcement, prompt, event mapping, teardown |
| backend adapter | model routing, launch, overlay, carrier, backend settings, model enforcement details |
| backend runtime | credentials, subscription, transcript, native tools, native configuration semantics |

The common sequence is invariant:

```text
resolve adapter once
→ load backend settings and carrier
→ materialize backend overlay
→ spawn → initialize → newSession → enforceModel
→ prompt → event map → retain-or-teardown
```

No layer reconstructs a backend transcript, proxies credentials, scans ambient MCP
configuration, or grants tools through prose. Explicit `entwurfProvider.mcpServers`
and the callable schema are the tool truth.

## Adapter contract

Source of truth: `pi-extensions/lib/acp/backend-adapter.ts`.

| Method | Responsibility |
|---|---|
| `routeModel` | Claim a curated id and return the backend-native id. Zero or multiple owners fail loud. |
| `curatedModels` | Contribute rows to the single `entwurf` provider. Non-Claude backends use a reserved prefix. |
| `resolveAdapterSettings` | Parse only this backend's settings into an opaque value. |
| `resolveLaunch` | Return command/argv; honor only the backend's explicit override. |
| `launchEnvDefaults` | Supply static launch environment defaults. |
| `ensureOverlay` | Materialize session isolation and return spawn environment overrides. |
| `loadCarrier` | Return a short operator carrier or `null` when the backend has no carrier. |
| `buildSessionMeta` | Build optional `newSession._meta` from the already-loaded carrier. |
| `enforceModel` | Make the requested native model authoritative before the prompt. |
| `configSignatureFields` | Return a stable primitive map whose changes invalidate reuse. |

`backend.ts` resolves the adapter once at turn entry. Common config never branches on
backend-specific keys; `adapterSettings` remains opaque until handed back to its owner.
A connection, model, carrier, MCP declaration, or overlay-relevant setting change must
change the reuse signature rather than mutate a live incompatible session.

A streaming message begins with `stopReason: "pending"`. ACP's terminal set is mapped
explicitly: `end_turn → stop`, `max_tokens → length`, `cancelled → aborted`; refusal,
exhausted turn budget, unknown, and absent reasons end as errors. The original ACP
reason is preserved in `rawStopReason`. Returning to a default-success branch is a
contract violation.

### Prompt lifecycle — who may end a turn

Bootstrap (`initialize`, `newSession`, set-model) carries 30s wall-clock bounds: those
steps make no model progress, so a stuck one is a dead session. **The prompt carries
none.** A turn ends only on a lifecycle event:

| Ending | Behavior |
|---|---|
| the agent answers | mapped through the terminal set above |
| the operator aborts | ACP `session/cancel` first — the agent closes its own turn (`cancelled → aborted`); process-group teardown only after a bounded grace, so an abort always returns |
| the child dies / stdio ends | the turn fails naming the exit status and the session-scoped stderr tail — or an honest bounded absence when transport EOF wins the race — on both the new and the reuse path |

Elapsed time is not evidence of failure, and a silent turn is not a failed turn: tool
use, reasoning, and provider queueing all legitimately outrun any number we could pick.
Suspected stalls are handled by exposing progress, never by a killing timer.

A prompt-phase failure message is also part of the contract. pi classifies a failed
assistant message by matching its text against `RETRYABLE_PROVIDER_ERROR_PATTERN`
(`@earendil-works/pi-ai` `utils/retry`), and a "transient" verdict makes it replay the
WHOLE prompt from a cold session up to `retry.maxRetries` times. Our own prompt-phase
text must never read as transient — that pairing (absolute cutoff × blind retry) is what
turned one long turn into four in 0.13.0. Gates: `check-acp-prompt-lifecycle` (behavior,
with pi's own classifier as the oracle), `check-probe-ordering` (no production prompt
cutoff in source).

## Support contract (#81)

What "supported" means here, per declaration class. The classes are kept apart on purpose: one
undifferentiated "supported" column is what let a Claude PASS read as if it also certified Cortex.

| Surface | Declaration | Class | What a green actually says |
|---|---|---|---|
| Entwurf package | `0.25.0` | shipped baseline | the package contract these rows belong to |
| pi runtime | devDep exact `0.87.1`, peer `>=0.87.1 <0.88` | **exact** oracle + **closed range** | built and certified against 0.87.1; hosts inside the range are accepted, and the ceiling moves only on measurement |
| ACP wire SDK | `@agentclientprotocol/sdk 1.4.0` | **exact** | the shared wire oracle both adapters speak |
| Claude ACP adapter | `@agentclientprotocol/claude-agent-acp 0.79.0` | **exact**, bundled | the adapter we ship and certify; resolved before any PATH fallback |
| Claude Agent SDK | `0.3.274` (transitive) | **exact** oracle | the runtime risk surface behind the adapter |
| Anthropic SDK | `0.100.1` | **exact**, peer-resolution only | satisfies the Agent SDK peer floor (0.93.0+); never an API client here (gate L4) |
| Claude Code runtime | `>=2.1.217` (`entwurf.claudeCodeFloor`) | **floor** | below it, hook args are silently dropped; entwurf enforces this itself |
| Node | `>=24` (`engines.node`) | **floor** | single axis, derived everywhere else |
| Cortex Code | operator-installed CLI | **on-demand**, external | NOT a pinned dependency. Each LIVE record must name the exact CLI version it measured |

Current Cortex host reading: **`Cortex Code v1.1.52`, observed on the reference host `oracle`
(2026-08-19)**. This is an OBSERVATION of what happens to be installed, not a pin, not a range, and
not a direct LIVE certification — no Cortex evidence record is created by writing it down. It is
recorded here only so the on-demand row names a concrete number instead of an abstraction.

Reading rules that do not bend:

- **Claude PASS never certifies Cortex, and a Cortex SKIP never becomes a PASS.** They are separate
  evidence axes with separate records; Cortex stays outside the Claude release floor.
- **Exact** means one measured build. **Range** means a closed accepted interval. **Floor** means a
  minimum entwurf enforces itself. **On-demand** means the operator supplies the runtime and the
  evidence names its version — presence of an adapter certifies no external release.
- A declared pin is not evidence. Package/deterministic gates bind the declarations
  (`check-dep-versions`, `check-acp-sdk-surface`, the pack/install consumer gates); LIVE gates carry
  the runtime claim.

### Minimum core value

One provider identity, `entwurf`, with model-id routing to backend adapters. The host pi session is
already the record-backed socket citizen; the ACP plugin mints no second citizen, socket, or peer
layer. Backend differences stay behind `adapterSettings` and adapter methods, and the turn sequence
stays backend-invariant.

Supported: one real model turn; curated routing with authoritative model enforcement; a narrow
callable tool surface; explicit MCP wiring including the entwurf bridge; session reuse with
delta-only user history; operator cancellation with bounded cleanup; honest terminal/error mapping.

Not supported, by design: workflow ownership, planner state, a memory DB, transcript hydration,
credential proxying, or a second harness inside pi.

### Capability posture

`clientCapabilities: {}` is the support posture, not an oversight. Optional upstream features do not
become reachable merely because an adapter ships them — but they stay out of reach for **two
different reasons, and collapsing them would hide a real risk**:

- **Capability-gated.** AIR typed session failures, the 0.69.0 AIR file-change report, terminal
  output widgets and nested subagent transcripts each test a client capability entwurf does not
  send, so the adapter itself keeps the legacy path.
- **Advertised but never called.** Some surfaces carry no capability prerequisite at all — the
  `providers/list` / `providers/set` / `providers/disable` trio added in 0.70.0 is advertised
  unconditionally, and 0.71.0–0.73.0 add native subagents, async tasks, message-specific session
  forks, AI-generated session titles and permission-mode kinds on the same footing. 0.74.0–0.75.1
  extend the same list: the `authStatus` extension (0.75.0, #1080), Markdown-rendered usage
  statistics (0.75.0, #1085) and restored session forks (0.75.1, #1089). The `--hide-claude-auth`
  subscription refusal (0.74.0, #1079) is unreachable for a second reason — `[측정 2026-09-06]`
  entwurf passes that flag nowhere (repo grep, 0 hits). They are
  unreachable only because the common loop never invokes them (nor `logout`). Nothing upstream
  enforces that; it is our own call-site discipline, and it stops holding the moment we use one.
- **Advertised but never called — 0.76.0 adds exactly one.** Upstream #1111 puts a
  `recommendedValue` on AIR config options, and it is **opt-in**: the adapter turns it on only
  when `initialize`'s `clientCapabilities._meta.jetbrains.air.capabilities` names
  `recommendedValue`. entwurf sends `clientCapabilities: {}` (`backend.ts:1758`), so
  `useRecommendedValue` is false on every branch. The label normalization, the `default` row and
  the effort selector that ride it are unreachable for a second, independent reason as well:
  `[측정 2026-09-10]` `git grep -c configOptions pi-extensions/lib/acp/` is **0**, and entwurf
  has never set `EFFORT_CONFIG_ID`, which is the other gate on the SDK-side `applyFlagSettings`.
  The rest of 0.76.0 is one refactor: `resolveModelPreference` moved into a new
  `dist/session-model.*` (diff is comments and formatting), `dist/session-effort.*` is new, and
  `setSessionConfigOption` — our only model-forcing wire call — is byte-identical across
  `v0.75.1..v0.76.0`.
- **One 0.76.0 change has a reachable SHAPE and is still inert for us.** When
  `configuredSettings` is a STRING PATH, its `readFile` + `JSON.parse` moved out of
  `resolvedProvider` and up onto the unconditional `session/new` path. entwurf passes `settings`
  as an OBJECT (`tool-surface.ts:153`), so the branch is never taken. That makes "entwurf never
  hands `settings` as a path" a contract rather than an accident; it is stated at that call site.
- **0.77.0's BREAKING change does not reach us, twice over.** `claudeCode.options.agent` is no
  longer forwarded — the adapter now shallow-copies the options object and `delete`s `agent` on
  the unconditional `session/new` path (`[측정 2026-09-18, 0.79.0 dist/acp-agent.js:5934-5941 직독]`).
  entwurf's `buildClaudeSessionMeta` never sets that key (`tool-surface.ts:145-199` 직독: the
  literal carries `model`/`tools`/`settingSources`/`settings` plus optional `plugins`/
  `disallowedTools`/`extraArgs`, and nothing else), and the removed agent-picker exports
  (`DEFAULT_AGENT_ID`, `AGENT_CONFIG_ID`, `BUILTIN_AGENT_NAMES`, `discoverCustomAgents`) are
  imported nowhere: `[측정 2026-09-18]` `git grep -c` over `pi-extensions/`, `test/`, `scripts/`,
  `mcp/` is **0**. We never imported the adapter as a library at all — we spawn its binary.
- **0.77.0's `allowDangerouslySkipPermissions` opt-out is a new lever we deliberately do not
  pull, and our effective permission mode is unchanged.** 0.76.0 sent
  `allowDangerouslySkipPermissions: ALLOW_BYPASS` unconditionally and computed
  `initialPermissionMode = creationOpts.permissionMode ?? resolvePermissionMode(settings…)`.
  0.79.0 computes `allowBypass = ALLOW_BYPASS && sessionMeta?.claudeCode?.options?.allowDangerouslySkipPermissions !== false`
  and routes the whole thing through `resolvePermissionMode(…, logger, allowBypass)`
  (`[측정 2026-09-18, 0.79.0 dist/acp-agent.js:5932-5933 직독]`). entwurf sets that option
  nowhere, so `undefined !== false` holds and `allowBypass === ALLOW_BYPASS`;
  `ALLOW_BYPASS = !IS_ROOT || !!process.env.IS_SANDBOX` is **byte-identical** between the two
  versions (`dist/permissions/modes.js` 직독). Our overlay pins
  `permissions.defaultMode: "bypassPermissions"` (`overlay.ts:122`), which resolves the same
  under both. The lever now EXISTS for a host that wants a non-bypass sibling; declaring it is a
  separate axis, not a one-line flip, and nothing in this bump takes it.
- **0.77.0's system-reminder strip never touches our first-user-message augment.**
  `INJECTED_CONTEXT_MARKERS = ["system-reminder"]` joins the local-command markers in
  `stripMarkerTags`, and `stripLocalCommandMetadata` has exactly two call sites
  (`[측정 2026-09-18, 0.79.0 dist/acp-agent.js grep -n]`): `:4129`, gated on the message content
  containing `<local-command-stdout>`, and `:5061`, in the `session/load` transcript replay. Both
  run agent→client on text coming BACK from the transcript; our augment rides client→agent on the
  first `session/prompt` and is never re-emitted, because entwurf calls `session/load` nowhere
  (`[측정 2026-09-18]` `git grep loadSession` in `pi-extensions/lib/acp/` hits only the
  `session-store.ts` capability TYPE, never a wire call). The augment also emits no
  `<system-reminder>` tag of its own (`augment.ts` 직독), so no prose of ours is strippable.
- **0.78.0's compaction update is a NEW `sessionUpdate` kind and is inert for us, twice over.**
  `compaction_update` and `compaction_summary_chunk` are new in `dist/context-compaction.js`
  (`[측정 2026-09-18]` `sessionUpdate: "…"` literal sweep across both dists: 0.76.0 has 15 distinct kinds,
  0.79.0 has 17, and the two new ones are exactly these). Gate one: the lifecycle's
  `presentation` is `clientSupportsCompactionUpdates(this.clientCapabilities) ? "compaction_update"
  : "tool_call"` (`dist/acp-agent.js:1875-1879`), and that predicate reads
  `capabilities?.session?.compaction` — entwurf sends `clientCapabilities: {}` (`backend.ts:1758`),
  so we keep the 0.75.0 `tool_call` presentation §11-8 already measured. The replay path
  (`:5082`) is guarded by the same predicate at `:4915`. Gate two, independent: our mapper's
  update switch has a `default: break` — "unknown update kinds are ignored (forward-compatible)"
  (`event-mapper.ts:311-313`, `:377-378`). The "map every terminal reason, unknown is an error" rule
  is about ACP **stopReason**, a different axis; `stopReason` literals are unchanged across the
  two dists (`[측정 2026-09-18]` sweep: `"cancelled"` only, both versions). No code needed.
- **0.78.0's checkpoint file-change report and AIR diff counts are both behind the AIR gate.**
  `supportsAgentFileChangeReport` is `clientSupportsAirCapability(capabilities, "agentFileChangeReport")`
  (`dist/file-change-audit.js:27-29` 직독), and `air-extension.js`'s only delta is one added
  constant `AIR_DIFF_STATS_KEY` (full-file `diff`, one line). Same `clientCapabilities: {}`
  argument as the 0.76.0 `recommendedValue` entry — re-measured, not inherited.
- **0.79.0's shell-command permission prompts reach our permission handler's INPUT and change no
  decision.** The change reorders options: when the CLI hints `defaultToNo` (new in 0.79.0 —
  `[측정 2026-09-18]` `grep -rn defaultToNo` over the 0.76.0 dist is **0 hits**), the option array
  now sorts reject-first (`dist/permissions/options.js:5-10`). entwurf's approve-all policy
  selects `options.find((o) => o.kind === "allow_once" || o.kind === "allow_always")` and only
  falls back to `options[0]` when that find fails (`backend.ts:824-831`) — a find by KIND, so
  order cannot flip it. The fallback is unreachable besides: every builder in
  `dist/permissions/options/` routes through `withOptionalUpdate`/`withGeneratedUpdate`, both of
  which lead with `allowOnce()`, and the hand-rolled `tools.js` sets each carry an `allow_once` or
  `allow_always` (직독 of `shared.js` + `tools.js`). The title change (Bash/PowerShell titles now
  bypass `humanText` compaction) lands on a field we never read.
- **0.77.0–0.79.0's remaining fixes are unreachable under our capability posture.** The
  AskUserQuestion multi-select/custom-text fixes (#1031, #1131) require form elicitation:
  the adapter computes `disallowedTools = elicitationSupport.form ? [] : ["AskUserQuestion"]`
  from `clientCapabilities.elicitation.form`, which our `{}` leaves false, so AskUserQuestion is
  disabled on every session we open. The TaskList regex fix (#1006) is internal parsing. #1128's
  tool names land on `presentation.toolCall._meta.claudeCode` on the permission-request path
  (`dist/acp-agent.js:5317-5325`), which our handler ignores; our `titleForTool` already read
  `_meta.claudeCode.toolName` as a fallback behind `update.title`, so it is additive at worst.
- **Our model-forcing and accounting wire calls are byte-identical across 0.76.0 → 0.79.0.**
  `[측정 2026-09-18, brace-matched extraction from both dists, md5]`: `setSessionConfigOption`
  (4,858 B, identical), `sessionUsage` (373 B, identical), `turnQuotaMeta` and `quotaTokenCount`
  (identical md5), and `resolveModelPreference` lives in `dist/session-model.js`, whose whole file
  is byte-identical (`md5 cfd031d0…` both versions). The `settings`-as-STRING-PATH branch our
  call-site contract names is still on the unconditional `session/new` path
  (`dist/acp-agent.js:6010-6012`).

- **The one 0.73.0 → 0.75.1 change that DOES reach us:** context compaction is now surfaced as a
  synthetic ACP tool lifecycle (0.75.0, #991) — a `tool_call` with `kind: "think"`, title
  `Compact conversation`, and `_meta.contextCompaction` schema v1 — where it used to arrive as
  assistant text. Our mapper routes every `tool_call`/`tool_call_update` through
  `renderToolUpdate` (`event-mapper.ts`), so this is not a type break; what changes is what an
  operator SEES in a compacting turn. See §11-8 for the measurement.

Adopting either class requires a separate observed need plus a complete rendering/lifecycle/evidence
contract. An optional upstream feature is not a core-value gap.

### Bump / defer rubric

`claude-agent-acp latest` is not a work queue. Certify when at least one holds:

- a turn/session/error path reachable under the default capability posture changes;
- the Claude Agent SDK, ACP SDK, peer resolution, pi floor, or backend process contract moves;
- a security, compatibility, or observed runtime defect requires the release;
- accumulated inactive minors are best folded into the next meaningful certification.

Otherwise record and defer. Every certification separates declared pins, deterministic/package
evidence, Claude LIVE aggregate evidence, and Cortex direct on-demand evidence (with its CLI
version). Per-bump measurements live in the ROADMAP **Dep bump(별도 트랙)** ledger.

### Bridge reachability is part of the contract

Explicit entwurf-bridge connectivity inside an ACP turn is core value, so it is measured rather than
assumed. `command -v` succeeding is not evidence: a launcher can resolve and still fail to exec (a
relocated package-manager shim deriving its target from `$0` exits 127), which leaves a turn with no
`mcp__entwurf-bridge__*` tool at all while every ownership check reads green. Both doctors therefore boot the exact configured stdio invocation — `command`, `args`, and
`env` — and require the full bridge verb set back over one shared leaf
(`./run.sh probe-bridge-command <cmd>` runs a simple command standalone; the agy doctor passes
its JSON invocation). The probe waits for a valid MCP `initialize` response before it sends
`notifications/initialized` and `tools/list`; a tools response alone is not boot evidence.

- **agy** probes every configured candidate invocation.
- **pi** probes every effective stdio invocation, including a legacy managed path or unowned
  override. Runtime truth says whether the command pi will launch works; ownership separately says
  whether entwurf may repair or normalize it.

entwurf never repairs a launcher it does not own — a foreign one is reported fail-loud with the
operator's repair named.

## Shipped adapters

| Seam | Claude | Cortex Code |
|---|---|---|
| Model ids | unprefixed `claude-sonnet-5`, `claude-opus-5`, `claude-fable-5-1` | `cortex-auto`, `cortex-claude-opus-5`, `cortex-claude-sonnet-5`, `cortex-openai-gpt-5.4`; prefix stripped before set-model |
| Launch | bundled `claude-agent-acp`; `CLAUDE_AGENT_ACP_COMMAND` override | `cortex acp serve`; optional connection; `CORTEX_ACP_COMMAND` override; never a launch-time `-m` |
| Model authority | per-turn ACP set-model | per-turn ACP set-model; an unavailable curated id fails before prompt |
| Carrier | engraving in `_meta.systemPrompt` | no system-prompt carrier; engraving rides the first-user augment |
| Overlay | `CLAUDE_CONFIG_DIR` whitelist, configured-empty hooks, native memory hidden | session-scoped isolated HOME + `SNOWFLAKE_HOME`, private `cortex/mcp.json`, measured-minimum auth passthrough |
| MCP | explicit wire `mcpServers` | explicit declarations projected to private `mcp.json` because Cortex ignores the wire field |
| Backend setting | none | `cortexConnection`; env override wins and participates in the signature |

### Claude

The bundled adapter resolves before any PATH fallback. Its overlay retains only the
auth/runtime state required by the Claude Agent SDK and hides operator memory, hooks,
agents, history, and local settings. Rich project/operator context rides the first-user
augment; the system carrier stays short to avoid changing billing semantics.

The carrier owns its own leading boundary. A string `_meta.systemPrompt` replaces the
`claude_code` preset, but the SDK still prefixes a fixed identity sentence and joins the
two with nothing, so the loader opens every rendered carrier with one blank line. The
template cannot supply it — the render is trimmed so operator whitespace never drifts the
reuse signature. That same rendered string is what `bridgeConfigSignature` folds and what
`buildSessionMeta` sends; normalizing it at either hop desynchronizes the wire from the
signature.

`clientCapabilities` intentionally remains empty. Terminal-output widgets and nested
subagent transcripts are therefore not requested. Enabling either is a separate
rendering contract, not a capability bit flip.

### Cortex Code audit (D1–D10)

The original audit labels remain useful coordinates for source comments and gates:

| Audit | Landed contract |
|---|---|
| D1–D2 | Isolated HOME hides operator-global Claude/Cortex skills and settings; install-directory plugins remain a host fact. |
| D3 | Refuse `CORTEX_HOME` whenever present, including empty. |
| D4 | Author `autoUpdate: false`; launch only `cortex acp serve`. |
| D5–D6 | Pass through measured-minimum local auth; entwurf never runs or supplies authentication. |
| D7 | Four curated rows; enforce the stripped native id before prompt. |
| D8 | Credential boundary is AGENTS Hard Rule 9 and the ACP Plugin Boundary. |
| D9 | Project explicit MCP declarations into private `cortex/mcp.json`; wire `mcpServers` is ignored upstream. |
| D10 | Restore real operator HOME only for `entwurf-bridge`, so the isolated child still sees the garden store. |

Cortex containment was measured against the live CLI rather than copied from Claude:

- **Dual HOME:** the child receives an isolated `HOME` and `SNOWFLAKE_HOME`. Global
  `~/.claude`/`~/.cortex` skills, hooks, settings, and operator `cortex/mcp.json` are
  outside the session; explicit cwd project scope remains visible.
- **`CORTEX_HOME` presence refusal:** Cortex gives it precedence over
  `SNOWFLAKE_HOME`; even an empty ambient value can make ownership ambiguous.
- **Auth passthrough:** only `connections.toml`, optional `config.toml`, and
  `cortex/cache/credential_cache` are symlinked through. This narrows reachable paths;
  it is not a read-only mount and entwurf never supplies the credential.
- **Launch integrity:** the overlay authors `autoUpdate: false`, preventing a CLI
  replacement in the middle of a turn. The launch is exactly `cortex acp serve` plus
  an optional connection; protocol initialization fails loud if a TUI was started.
- **MCP projection:** Cortex's ACP server ignores wire `mcpServers`, so the adapter
  exact-writes an overlay-private `cortex/mcp.json`. Non-stdio declarations fail before
  spawn. Only the `entwurf-bridge` entry receives the real operator HOME required to
  see the garden store.
- **`realHome` absoluteness:** the D10 guard judges the captured `realHome` in BOTH
  path flavors (POSIX and win32), so the refusal rule states the contract rather than
  the host it happens to run on. This claims no native-Windows support — native
  Windows is UNSUPPORTED. The certified ACP axis remains Linux
  desktop/workstation; macOS ACP turns are NOT CERTIFIED — pending physical
  host. The flavor-explicit form only stops a POSIX host from reading a
  drive/UNC path as relative, which is what made the defect unkillable on
  Linux (PR #77).
- **Carrier:** Cortex has no `_meta.systemPrompt` contract. The engraving is placed at
  the head of the first-user augment; claiming a system-prompt engraving is false.

Cortex's bundled install-directory plugins are outside any HOME overlay and remain a
host fact. Also unclaimed: project-hook behavior on every host, the semantics of its
caller-session `_meta`, and cross-machine certification.

## 11-7. Readiness boundary

A backend can return `newSession` before its declared MCP server is callable. This was
observed intermittently on the Claude rail and directly on Cortex's private `mcp.json`
path. Neither `claude-agent-acp` 0.79.0 nor the Cortex landing adds a client-side
readiness fence over a session's declared MCP servers, and entwurf's common loop
calls `mcpServerStatus()` nowhere.
(Re-measured at the 0.76.0 → 0.79.0 bump, not inherited — the previous bump's argument is
not reused, the way the 0.75.1 → 0.76.0 entry did not reuse 0.73.0 → 0.75.1's.
`mcpServerStatus` call sites in `src/acp-agent.ts` are **2 at v0.76.0 and 2 at v0.79.0**
`[측정 2026-09-18, upstream v0.79.0/src/acp-agent.ts read directly, grep -n]`; they first
appeared in 0.71.0 via `0cbbaf3` (MCP OAuth, LLM-25012), so the ADAPTER calls it where it
once did not. Both were re-read at `v0.79.0 src/acp-agent.ts:1773` and `:1866`
(v0.76.0: `:1762` / `:1855`; v0.75.1: `:1736` / `:1829`; v0.73.0: `:1618` / `:1711`): the
first sits inside `authenticateMcpServers` behind `supportsMcpOAuth(query)` and skips every
status that is not `needs-auth`; the second polls a SINGLE named server to `connected` under
an OAuth deadline. Neither waits on every declared server before `newSession` returns. That
is an auth handshake, not a readiness fence, so the boundary below is unchanged. The
surrounding 200-line window is byte-identical (`diff v0.76.0:1662-1862 v0.79.0:1673-1873`,
empty) and the region moved +11 while the file shrank 10,405 → 10,329 lines. The 0.77.0
agent-picker removal, the 0.78.0 compaction/checkpoint/AIR work and the 0.79.0 permission
presentation touch no part of this path, so the other reachable-surface findings stand as
re-measured in the capability-posture section above.
This bump changes no readiness behavior and closes no part of #72.)

### 11-7-a/b. Instrument and first measurement

The ordering probe is an **instrument**, not a fix. It separates:

1. client request/response ordering;
2. backend MCP receive/reply markers;
3. the first prompt/tool decision;
4. probe admissibility (the test itself did not create the race).

Its first paired measurement was inconclusive. Do not convert that into “no race” or
“the adapter fixed it.” A green intermittent run measures one sample; a red run proves
the symptom remains.

### 11-7-c. CLI snapshot producer

The B-name-snapshot producer is admissible only when the run pins the real target
executable and digest, refuses ambient overrides, preserves argv/stdin/stdout/stderr and
exit/signal behavior, bounds NDJSON framing, scrubs only the exact probe env allowlist,
and timestamps snapshot/prompt hand-offs inside the downstream write callback. One
post-wire init snapshot may support the controlled-absence row; malformed, duplicate,
pre-wire, unarmed, or target-mismatched snapshots invalidate the run rather than proving
absence. `check-probe-cli-shim` is the detailed producer oracle: its 20 direct
`[CHECK:*]` assertions remain, while their verification-infra replants were deliberately
removed by #70. `probe-ordering.json` retains only the product-subject no-production-prompt-cutoff
replant consumed by `check-probe-ordering`.

Current probe contract and gates:

- `check-probe-ordering` — interval/envelope and marker ordering;
- `check-probe-cli-shim` — CLI shim admissibility and environment boundary;
- `smoke-acp-ordering-probe-live` — opt-in paired observation.

Until a causal fix lands, release gates continue to exercise real MCP availability and
fail when the callable surface is absent. Do not add sleeps or infer readiness from
`newSession` latency.

## Verification

Deterministic floor:

```bash
pnpm run check:full
./run.sh check-acp-provider-surface
./run.sh check-acp-sdk-surface
./run.sh check-acp-session-reuse
./run.sh check-acp-stop-reason
./run.sh check-acp-cortex
./run.sh check-gate-qualification
```

Live axes:

```bash
LIVE=1 ./run.sh release-gate /path/to/scratch --cut
LIVE=1 ENTWURF_ACP_CORTEX_CONNECTION=<conn> \
  ./run.sh smoke-acp-cortex-live
```

The aggregate release gate is Claude-backed so a host without Cortex/Snowflake auth
can run the package floor. That means Cortex is **on demand**, not optional evidence:
a cut that changes or ships the Cortex rail must run and read its dedicated smoke.
Per-cut counts, digests, versions, and host observations belong in BASELINE/CHANGELOG,
not this standing contract.

## 11-8. Compaction is a tool lifecycle (0.75.0 onward)

The one change in the `0.73.0 → 0.75.1` bump that REACHES the common loop. Upstream #991
(`f74a517`) replaced compaction's assistant text with a synthetic ACP tool call: `kind:
"think"`, title `Compact conversation`, `_meta.contextCompaction` schema v1.

`[측정 2026-09-06, oracle, adapter 0.75.1, claude-sonnet-5]` one live `/compact` turn emitted
exactly two notifications (`tool_call` in-progress → `tool_call_update`), and those verbatim
objects replayed through the production `applyAcpSessionUpdate` produced a
`[tool:start] Compact conversation` / `[tool:…] Compact conversation` notice pair. No new
mapper branch is needed — `renderToolUpdate` routes every tool call regardless of `kind` —
and `_meta.contextCompaction` is dropped by the mapper, so no accounting path sees it.

What changed is therefore what an OPERATOR sees in a compacting turn, not what entwurf
computes. The post-compaction occupancy refresh is NOT new: `v0.73.0 src/acp-agent.ts:3460`
already emitted a `usage_update` at `compact_boundary` and 0.75.1 still does
(`dist/acp-agent.js:2740-2752`, now reading `compact_metadata.post_tokens` instead of a
`getContextUsage` control request), so the shrinking-`used_end` case that
`backend.ts:1286-1288` names as #96's weak floor gains no new trigger here.

Receipt, limits and the `completed`-branch gap: `scripts/raw-acp-compaction-measure/README.md`.

## 11-9. A steer reaches an ACP receiver one child turn late (#120 P5, measurement only)

`entwurf_v2 mode:"steer"` injects into the receiver's pi steering queue; it is not an ACP concept.
On a NATIVE pi receiver that queue is drained seconds later, and on an ACP receiver it is drained
one whole child turn later. The difference is not a different drain point — it is the same one.

`[측정 2026-09-22, pi-agent-core 0.87.0; 재측정 2026-09-23, 0.87.1 — 좌표 동일]` `dist/agent-loop.js:141` awaits `streamAssistantResponse`
once per turn, and the steering drain is `:186`, after the `turn_end` emit at `:185`. For this rail
that one await is `pi-extensions/lib/acp/backend.ts:815` —
`await Promise.race([session.connection.prompt(promptArgs), lifecycle])` — so it spans the entire
`session/prompt` round trip. The child's own tool calls and subagent turns are invisible to pi, so
pi cannot reach `:186` until the child turn ends. Same code path as native, one long await.

That is a property, not a silent failure: the sender's receipt already says `queued-steer` and
`DELIVERY.md` already states that both queues are volatile and unordered against each other, so
nothing here is promised and then quietly not delivered. `[QK:PI-QUEUE-NO-MIDFLIGHT-MERGE]`
(`test/pi-queue.oracle.test.ts`) proves the mechanism on the installed vendor: a message queued
while a turn is in flight never joins that turn and arrives as a later one. The delay's SIZE is
that turn's duration, which the same cell fixes by construction.

**Forwarding is not adopted here.** `[측정 2026-09-22]` standard ACP has no steer method at all —
enumerating the installed `@agentclientprotocol/sdk`'s `AGENT_METHODS` and `CLIENT_METHODS` yields
zero entries containing `steer`. What exists is a PRIVATE vendor extension,
`_session/steering` in `@agentclientprotocol/claude-agent-acp@0.79.0`
(`dist/acp-agent.js:163`, handler at `:7792`), client→agent, advertised through
`InitializeResponse._meta.steering.supported`. Our client sends `initialize`, `session/new`,
`session/prompt`, `session/set_config_option` and `session/cancel` (`acp-client.ts:138-149`) and
has no steering path at all.

Adopting it would mean owning five things this driver does not own today, each a new contract
rather than a wiring change:

1. reading the `_meta.steering.supported` capability, and deciding what a backend without it is;
2. a typed schema and version fence for a request that is outside the SDK's method set, so a
   private extension changing shape is a named refusal rather than a silent no-op;
3. a backend-specific concurrent-request seam from the control extension to a live ACP connection —
   today a turn is one in-flight `prompt`, and this adds a second request during it;
4. an exactly-once / ordering policy that picks the outer pi queue or the vendor injection but never
   both, since those are two independent orderings that currently do not meet;
5. a receipt mapping for the extension's outcomes — `injected`, `promptRequired`, `startedNewTurn` —
   plus the idle race, cancel and release meanings behind them. (`idleBehavior:"promptRequired"`
   lets a host refuse the detached `startedNewTurn` path, but that opt-in is itself a new contract.)

The adapter keeps its own turn-settlement bookkeeping internally, and our event mapper ignores
update kinds it does not handle (`event-mapper.ts:377-378`), so nothing above is a claim that
Entwurf must replicate vendor internals. The reason to stay put is the five contracts, not a ledger.

## Open work

- causal MCP-readiness diagnosis and, only with proof, a backend-invariant fence;
- broader installed-host and cross-machine Cortex evidence;
- persisted ACP resume/load, which is not implemented by today's in-memory reuse.
