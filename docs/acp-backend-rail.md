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
| the child dies / stdio ends | the turn fails naming the exit status and the session-scoped stderr tail, on both the new and the reuse path |

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

## Shipped adapters

| Seam | Claude | Cortex Code |
|---|---|---|
| Model ids | unprefixed `claude-sonnet-5`, `claude-opus-5` | `cortex-auto`, `cortex-claude-opus-5`, `cortex-claude-sonnet-5`, `cortex-openai-gpt-5.4`; prefix stripped before set-model |
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
- **Carrier:** Cortex has no `_meta.systemPrompt` contract. The engraving is placed at
  the head of the first-user augment; claiming a system-prompt engraving is false.

Cortex's bundled install-directory plugins are outside any HOME overlay and remain a
host fact. Also unclaimed: project-hook behavior on every host, the semantics of its
caller-session `_meta`, and cross-machine certification.

## 11-7. Readiness boundary

A backend can return `newSession` before its declared MCP server is callable. This was
observed intermittently on the Claude rail and directly on Cortex's private `mcp.json`
path. Neither `claude-agent-acp` 0.64.0 nor the Cortex landing adds a client-side
readiness fence, and `mcpServerStatus()` is not called by the common loop.

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
absence. The deterministic mutants in `probe-ordering.json` are the detailed oracle.

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
pnpm check
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

## Open work

- causal MCP-readiness diagnosis and, only with proof, a backend-invariant fence;
- broader installed-host and cross-machine Cortex evidence;
- Grok admission through this ACP adapter rail, beginning with the same backend seam audit rather than a native-harness bridge;
- persisted ACP resume/load, which is not implemented by today's in-memory reuse.

Native-harness admission is a separate boundary documented in
[`native-harness-rail.md`](./native-harness-rail.md). Codex remains probe evidence there,
not an implementation queue.
