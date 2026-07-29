# ACP Backend Adapter Rail (표준궤) — as built in 0.12, second backend landed in 0.13

> **Status: spec frozen + claude rail SHIPPED** (Opus implementation / GPT `…341a87` review GO, 2026-06-25)
> **+ cortex adapter LANDED** (hvkiefer's PR #40 transplanted with the CP0-audit revisions, 2026-07-29 —
> the audit record and landed contract are **§11-8**; the as-landed seam table is **§4**; the deltas against
> the PR are **§6**). The confirmed spec is **§9** (the adapter seam) + **§10** (the `settings.backend`
> guard + the generic `adapterSettings` seam).
>
> **The ACP Claude rail comes first; cortex is the lane after it (GLG, 2026-07-27) — read §11 before writing
> cortex code.** The first tightening ships as the **0.12.10** patch cut, whose scope is **four** items, not two:
> the `claude-agent-acp` 0.62.0 pin, this document, the removal of pi special-casing left in code and comments,
> and the AGENTS carrier-budget gate. The causal work on readiness continues after it, and cortex opens only
> once the rail is settled — a fourth backend cannot be added while "pi is different" survives in the prose a
> new adapter author would read. The adapter seam is ready; the *rail underneath it* is not yet proven. ACP Claude — this rail's own
> reference adapter — has been observed reaching the model with the bundled `entwurf-bridge` MCP tools **absent
> from the session tool schema**: an addressable citizen whose ACP model could not exercise outbound sibling
> dispatch (the resident keeps its record and socket throughout — §11-2). The verified gap is a
> **missing client-side readiness guarantee in the common turn loop**, not a fault in `claudeAdapter`, and a
> second backend inherits that gap (whether it inherits the *race* depends on its own server — see §11-3). Entry
> order is therefore fixed by implementation dependency — **record-backed pi host adapter → ACP Claude
> proven to exercise outbound sibling dispatch → cortex lands**. This is not citizen rank: every addressed
> session uses the same V3 record authority. §11 carries the
> evidence at its honest strength, the measured PR #40 landing surface, and the gate cortex must clear.
> **2026-07-29 update:** that entry sequence completed — ACP Claude's outbound dispatch is LIVE-proven
> (`smoke-acp-v2-send-live`), the CP0 audit measured the cortex surface directly, and the cortex adapter
> landed (§11-8). The §11-3/§11-7 readiness question is *rail-level* and remains open; the landing neither
> settles nor hides it.
>
> This document is the shipped rail baseline for BOTH backends. Historical sections predating the 0.13.0
> cortex landing read as past tense: PR #40 carried the `cortexAdapter` this landing transplanted (the
> contributor's commit and credit are preserved), and the issue tracking it (#48) still assumes a
> `pi/entwurf-targets.json` spawn allowlist that #50 deleted — do not treat any old spawn dependency as
> authority.
>
> **Real namespace.** Everything lives under **`pi-extensions/lib/acp/`**. There is no `acp-bridge.ts` and no
> `adapters/` subdirectory — both were 0.11.0 monolith shapes that the 0.12.0 cutover deleted. `claudeAdapter`
> lives inline in `backend-adapter.ts`; a second backend either lives inline next to it or in its own sibling
> module imported into the same `ADAPTERS` array.
>
> **Doc history.** §1–§2, §5, §8 are the *pre-implementation* rationale (kept as background, now past tense).
> §3's interface draft has been **superseded by §9+§10**: the shipped adapter has two methods the draft lacked —
> `resolveAdapterSettings` and `loadCarrier` — and a couple of signatures differ (noted inline). §4 and §6 are
> the as-built seam table and the contributor guide; trust those plus the source over the older sections.
> **§11 is the newest layer** (2026-07-27 entry conditions) and outranks §1–§10 wherever they disagree about
> what is proven.

## 1. Why (background)

- PR [#40](https://github.com/junghan0611/entwurf/pull/40) (Snowflake Cortex Code, hvkiefer) was written
  against `acp-bridge.ts` / `index.ts` — the **0.11.0 fat-bridge that 0.12.0 deleted**. This is not a rebase
  conflict; the architecture it patched no longer exists.
- **0.11.0 had a rail:** `type AcpBackend = "claude"|"codex"|"gemini"`, an `AcpBackendAdapter` type, an
  `ACP_BACKEND_ADAPTERS: Record<AcpBackend, AcpBackendAdapter>` registry, and `resolveAcpBackendAdapter(backend)`.
  PR #40 simply slotted cortex in as a 4th entry — the contributor's words: *"slots into the existing
  AcpBackendAdapter pattern the same way Gemini does."*
- **The 0.12.0 cutover removed that rail.** The fat-bridge was thrown away and the plugin was rebuilt
  claude-first on the v2 core (CHANGELOG: *"a fresh build on the v2 core, not a port of the old architecture"*).
  At the moment of the cut the result was: zero backend abstraction in `pi-extensions/lib/acp/`; a hard
  `backend !== "claude"` throw in `config.ts`; and the only trace of extension intent was a comment in
  `models.ts` ("a second governed backend would EXTEND this set — it does not change the pattern").
- **Verdict at the time:** single-claude code quality was *better* in 0.12.0 (decomposed into modules, a thin
  plugin on v2), but the *backend-extension rail had regressed* below 0.11.0 — cortex had no seam to land in.
  **This doc records the rail that closed that gap.** §9+§10 are now implemented; §5 happened.

## 2. Key insight — the seam was already half present

0.12.0 `backend.ts` already carried a dependency-injection struct, `AcpTurnDeps`, that the
session-reuse gate uses to inject fakes. The original idea was to promote the backend-specific parts of
those deps into an adapter. The **final design separated the two** (see §9-2): the test/runtime seam
(`AcpTurnDeps`: `spawnChild`/`createConnection`/`lifecyclePolicy`/`loadConfig`/`now`) stays a fake-injection
seam, and the **product seam** (`AcpBackendAdapter`: which backend drives a turn) is a separate object resolved
from the model id at turn entry.

→ **The rail = resolve `const { adapter, nativeModelId } = resolveAcpBackendAdapter(model.id)` once at the top
of the turn, then route every backend-specific step (`resolveLaunch` / `ensureOverlay` / `launchEnvDefaults` /
`loadCarrier` / `buildSessionMeta` / `enforceModel`) through that adapter.** The turn orchestration body in
`backend.ts` (`streamAcpTurn`: spawn → initialize → newSession → enforceModel → prompt → event-map) stays
**backend-invariant**. `defaultDeps()` takes no adapter argument; the adapter is threaded into config loading
via `loadConfig(cwd, modelId, adapter)` and otherwise used directly in the turn body.

## 3. The `AcpBackendAdapter` interface (as built)

Source of truth: `pi-extensions/lib/acp/backend-adapter.ts` (interface at `:115`, `claudeAdapter` reference
implementation at `:194`, registry at `:275`, `resolveAcpBackendAdapter` at `:287`, `allCuratedModels` at `:307`).
This is the **real** shape — it is the §3 draft updated per §9+§10 (two methods added, two signatures fixed):

```ts
export interface AcpBackendAdapter {
  /** Discriminator stored on BridgeSession/configSig so reuse never re-parses the model id. */
  readonly backend: string;                                   // "claude" | "cortex"

  /** Owns modelId? → backend-native id (prefix stripped), else undefined.
   *  cortex-claude-sonnet-5 → { nativeModelId: "claude-sonnet-5" }. */
  routeModel(modelId: string): { nativeModelId: string } | undefined;

  /** Curated model rows this backend contributes to the single `entwurf` provider. */
  curatedModels(): AcpModelRow[];

  /** ADDED (§10). Parse this backend's OWN settings off the raw entwurfProvider blocks
   *  → opaque value stored on ResolvedAcpConfig.adapterSettings. claude returns undefined. */
  resolveAdapterSettings(params: AcpAdapterSettingsParams): unknown;

  /** ACP server launch (command + args), honoring an env override. Uses native model id. */
  resolveLaunch(params: AcpLaunchParams): AcpLaunchSpec;

  /** STATIC launch env merged over process.env at spawn (settings-derived env rides ensureOverlay). */
  launchEnvDefaults(): Record<string, string>;

  /** Materialize the config overlay (auth passthrough + state hiding); return env overrides
   *  to merge at spawn. no-op backend → { envOverrides: {} }. */
  ensureOverlay(params: AcpOverlayParams): { envOverrides: Record<string, string> };

  /** ADDED (§10). Render the optional short operator carrier (engraving), SEPARATE from
   *  buildSessionMeta so backend.ts folds the same value into both the config signature and the
   *  session meta. A carrier-less backend returns null WITHOUT calling loadEngraving. */
  loadCarrier(params: AcpCarrierParams): string | null;

  /** Build the `_meta` for newSession. undefined → backend.ts omits the `_meta` key entirely.
   *  Receives the already-loaded carrier (the engraving is NOT loaded inside here — see loadCarrier). */
  buildSessionMeta(params: AcpSessionMetaParams, carrier: string | null): Record<string, unknown> | undefined;

  /** Enforce the requested model on the live session. claude = per-turn setSessionConfigOption;
   *  a launch-pinned backend = no-op here. */
  enforceModel(params: AcpEnforceModelParams): Promise<void>;

  /** Backend-specific fields folded into bridgeConfigSignature. Takes the OPAQUE adapterSettings
   *  (NOT the whole config). MUST be a flat, sorted-stable primitive map. backend + nativeModelId
   *  are added by backend.ts. */
  configSignatureFields(adapterSettings: unknown): Record<string, unknown>;
}

/** modelId → { adapter, nativeModelId }. 0 matches → throw (unknown model);
 *  2+ matches → throw (prefix collision, fail-fast at startup/check).
 *  claude owns its UNPREFIXED ids; a non-claude backend MUST carry a reserved prefix (cortex-*). */
export function resolveAcpBackendAdapter(modelId: string): { adapter: AcpBackendAdapter; nativeModelId: string };
```

## 4. The seam spec (claude as built in 0.12 / cortex as landed in 0.13)

| seam (adapter method) | claude (shipped, 0.12) | cortex (as landed, 0.13 — audit record §11-8) |
|---|---|---|
| **routeModel + curatedModels** | unprefixed `getModels("anthropic")` rows (`claude-sonnet-5`, `claude-opus-5`); native id == curated id | the GLG-decided 4-row set (`cortex-auto` / `cortex-claude-opus-5` / `cortex-claude-sonnet-5` / `cortex-openai-gpt-5.4`, hand-curated — pi-ai has no cortex source); the reserved `cortex-` prefix routes via `routeModel`, and the stripped native id is the **set-model value**, never a launch flag (§11-8 D7/E) |
| **resolveAdapterSettings + configSignatureFields** | both no-op (`undefined` / `{}`) — claude has no own settings | parse `cortexConnection` off the raw block (env `ENTWURF_ACP_CORTEX_CONNECTION` wins) → opaque `adapterSettings`; fold `{ cortexConnection: conn ?? null }` into the signature (a connection change invalidates a reused session) |
| **resolveLaunch** | `@agentclientprotocol/claude-agent-acp` npm bin resolve; `CLAUDE_AGENT_ACP_COMMAND` override | `cortex acp serve` resolved from PATH (+ `-c <conn>`); **no `-m` ever** — the model is enforceModel's job and a launch pin would be a second drifting authority (§11-8 E); `CORTEX_ACP_COMMAND` override via `bash -lc` with the selection flags shell-quoted and appended |
| **launchEnvDefaults** | `claudeLaunchEnvDefaults()` (`CLAUDE_CONFIG_DIR`) | `{}` — the overlay is **session-scoped**, so every spawn env override rides `ensureOverlay(...).envOverrides` (`HOME` + `SNOWFLAKE_HOME`); the v1.1.8-era `CORTEX_DISABLE_AUTO_APPLY_PROFILES` knob is retired (unmeasured on v1.1.52; profiles live inside the empty isolated home) |
| **ensureOverlay** | `CLAUDE_CONFIG_DIR` whitelist overlay (auth/runtime kept, memory/hooks/projects hidden, `hooks:{}`) | **dual-HOME containment** (§11-8 A): refuse an ambient `CORTEX_HOME` (presence incl. empty — D3); materialize a per-session isolated HOME with `.snowflake` inside it (D2); symlink the measured-minimum auth (`connections.toml` / optional `config.toml` / `cortex/cache/credential_cache` — D5/F); author `autoUpdate:false` (D4); **project** the envelope-enriched explicit `mcpServers` into overlay-private `cortex/mcp.json` with the real operator HOME restored on the `entwurf-bridge` entry alone (D9/D10), non-stdio entries failing loud before spawn; exact rewrite per spawn + dead-pid scope sweep |
| **loadCarrier + buildSessionMeta** | carrier = the shipped engraving (`loadCarrier` → string); `buildSessionMeta` → `_meta.systemPrompt` (short, pure, billing-safe) | **`loadCarrier` → null, `buildSessionMeta` → undefined** — cortex is *system-prompt-carrier-less* (it has no `_meta.systemPrompt`; it does read `_meta` for a caller-session-id seam that is measured-but-unexplored and not part of this contract — §11-8). The operator engraving rides the first-user augment (`ENTWURF_ACP_ENGRAVING_PATH`) |
| **enforceModel** | per-turn `setSessionConfigOption({ configId: "model" })` | **the same per-turn `setSessionConfigOption({ configId: "model" })`, with the native id** — measured GO against the live surface (§11-8 CP0-M); a curated id the running cortex no longer serves fails loud *before* the prompt, which is the curation-drift guard |
| **gates** | `check-acp-*` family + the LIVE `smoke-acp-*-live` floor | `check-acp-cortex` (in `pnpm check`; mutant lane `acp-cortex` under `check-gate-qualification`) + on-demand `LIVE=1 ENTWURF_ACP_CORTEX_CONNECTION=<conn> ./run.sh smoke-acp-cortex-live` — deliberately OUTSIDE the claude-only LIVE release floor |

**Two design touchstones (updated at the 0.13 landing):**
1. `loadCarrier` / `buildSessionMeta` must support the **carrier-less case** (cortex). `buildSessionMeta`
   returning `undefined` makes `backend.ts` omit the `_meta` key entirely; `loadCarrier` returning `null` keeps
   the cortex turn from ever touching the shipped-engraving / appendSystemPrompt signature. Rich operator
   context rides the first-user augment regardless of carrier.
2. `enforceModel` absorbs the per-backend **model-authority** difference behind one method. As landed, BOTH
   backends call per-turn set-model — the audit measured cortex's `session/set_config_option("model")` live and
   the PR-era launch-pin plan was retired for it (§11-8 E). The single-method, no-flag shape is unchanged: a
   future backend that genuinely can only pin at launch would be a no-op here, and the turn loop stays
   backend-invariant either way.

## 5. How the claude rail was laid (done)

The steps below were executed when the rail shipped; they are recorded so the cortex port can see the pattern:

1. Added the `AcpBackendAdapter` interface + `resolveAcpBackendAdapter(modelId)` in
   `pi-extensions/lib/acp/backend-adapter.ts`.
2. Collected the claude hardcoding into the `claudeAdapter` object: `resolveLaunch` (was `resolveClaudeLaunch`),
   `ensureClaudeConfigOverlay`, `claudeLaunchEnvDefaults`, `buildClaudeSessionMeta`, the claude enforce path,
   `loadEngraving` (via `loadCarrier`) → all became adapter methods.
3. `streamAcpTurn` resolves the adapter once at turn entry and routes every backend-specific step through it;
   the turn body is backend-invariant.
4. The old claude-only `throw` guard in `config.ts` became a *syntactic-only* `backend` check (§10 A); the
   semantic guard (declared backend must match the routed adapter) moved to the routing site in `backend.ts`.
5. `models.ts` exposes the curated claude rows; `allCuratedModels()` (in `backend-adapter.ts`) merges every
   registered adapter's `curatedModels()` for provider registration.
6. `pi-extensions/acp-provider.ts` keeps the single `entwurf` provider and registers
   `models: allCuratedModels()`.

→ That was "the rail". cortex adds **zero** to the common layer (claude alone proves the adapter pattern holds).
This is a claim about the **porting work**, not a claim that the rail is finished — see §11-3 for the one
common-layer contract (tool readiness) that is still open and that a second backend inherits.

## 6. The cortex port — as landed (PR #40 → 0.13.0)

> §6 used to be the *how-to-port* guide. The port has landed; this section now records **where the cortex
> backend lives, what changed against PR #40 and why** — each delta is a measured CP0 defect (§11-8), not a
> style choice. hvkiefer's adapter commit is preserved in history; the deltas were applied on top of it. For
> the next backend, the porting pattern is unchanged: **one adapter object + registration + its own gates;
> the common layer stays untouched.** §6's standing instruction also survives: EXTEND the same `check-acp-*`
> family — a new backend's deterministic axis gets its own gate file and mutant lane, never a smear across
> the claude gates.

Where it lives (real namespace `pi-extensions/lib/acp/`):

- **`backend-adapter.ts`** — `cortexAdapter` beside `claudeAdapter`, registered in
  `ADAPTERS = [claudeAdapter, cortexAdapter]`. Routing/prefix/anti-collision ride the shared resolver.
- **`models.ts`** — `SUPPORTED_CORTEX_MODEL_IDS` (the 4-row curation) + `curatedCortexModels()`; the two
  Claude rows ride their own pi-ai registry bases, `auto`/GPT ride the sonnet base as a metadata floor.
- **`overlay.ts`** — the dual-HOME overlay: `ensureCortexDualHomeOverlay` / `projectCortexMcpJson` /
  `sweepDeadCortexOverlays` / `cortexOverlayScopeId` (see the module header for the D-number rationale).
- **`augment.ts`** — the carrier-less engraving join (unchanged from PR #40: the operator override leads the
  cortex first-user augment; a carrier backend never folds it in).
- **`scripts/check-acp-cortex.ts`** + **`scripts/mutants/acp-cortex.json`** — the deterministic axis, nine
  kill-qualified claims. **`scripts/smoke-acp-cortex-live.ts`** — the CP2 LIVE axis (PR #40 declared this
  script a pending deliverable; it now exists, so the run.sh target no longer fails loud).

Deltas against PR #40's head `3dd6f5f`, each pinned to its measurement:

| PR #40 shape | landed shape | why (§11-8) |
|---|---|---|
| `SNOWFLAKE_HOME`-only overlay, static shared dir | dual-HOME (isolated HOME + `.snowflake` inside), session-scoped, exact-rewritten | D2 (homedir-anchored skill/hook leak — 42 operator skills measured), D10 (bridge needs the real garden store), static-dir races |
| overlay passthrough incl. whole `cache` + `skills` | `connections.toml` / optional `config.toml` / `credential_cache` only | D5/F (whole cache leaks operator work product; auth measured sufficient with the narrow set) |
| launch `-m <native>` pin, `enforceModel` no-op | no `-m`; per-turn `setSessionConfigOption("model")` | E / CP0-M (set-model measured GO; a launch pin is a second model authority) |
| 5-row curation (`opus-4-6`, `haiku-4-5`, …) | GLG-decided 4-row curation | D7 (`haiku-4-5` absent from the live surface — set-model fails loud naming the live set) |
| no `CORTEX_HOME` handling | presence refusal, empty string included | D3 (`CORTEX_HOME` beats `SNOWFLAKE_HOME`; empty-string ambiguity) |
| no auto-update handling | overlay-authored `autoUpdate: false` | D4 (launch-time self-replacement; the CLI flag positions are broken for `acp serve`) |
| wire `mcpServers` assumed to reach the session | overlay-private `mcp.json` projection (envelope-enriched, bridge-only real-HOME, non-stdio fail-loud) | D9 (cortex `newSession` ignores the wire param — the projection IS the tool transport), D10 |
| `CORTEX_DISABLE_AUTO_APPLY_PROFILES=1` | retired | unmeasured on v1.1.52; profiles live inside the empty isolated home |

**Do NOT touch the common layer** — `backend.ts` turn loop, `acp-client.ts`, `event-mapper.ts`,
`session-store.ts`, `config.ts`. Cortex landed in an adapter file + its own modules + gates, which IS the
proof the rail holds (§11-3's open readiness question is rail-level and stays open — §11-8 D9 measured that
cortex inherits it on the mcp.json door). `pnpm check` + `pnpm typecheck` (all three configs) stay EXIT 0.

## 7. Discussion points (resolved)

These were the open questions before the spec froze; §9+§10 resolved all of them. Kept as a record.

1. **Adapter selection key = modelId prefix routing — enough?** Resolved: yes. 0.11.0 used both
   `inferBackendFromModel` and `settings.backend`; 0.12 makes the **modelId prefix the single routing
   authority**. claude is "no prefix = default"; non-claude backends carry a reserved prefix.
2. **Single provider?** Resolved: one `entwurf` provider, all backends' models merged via `allCuratedModels()`.
3. **Promote `AcpTurnDeps` vs a separate `AcpBackendAdapter`?** Resolved: keep them separate (§9-2) — merging
   would make a fake-deps fixture look like a fake backend.
4. **Is the `buildSessionMeta` undefined fallback already present?** Resolved into the shipped design: the
   augment always rides via `prependNewPromptAugment` regardless of carrier; how a *carrier-less backend's
   operator engraving* joins the augment is the cortex PR's call (§6, §9-4).
5. **`enforceModel` abstraction shape.** Resolved: one method, no flag (claude = set-model, cortex = no-op).
6. **Overlay output shape.** Resolved: `ensureOverlay → { envOverrides }`; sweep lives inside the adapter.
7. **codex/gemini?** Resolved as a 0.12 non-goal (§9-8) — codex is a native garden citizen, not ACP.

## 8. Roles

- **Maintainer:** lay the §5 rail (interface + claude refactor) and get claude green on the gates. **Done.**
- **Contributor (hvkiefer):** the §6 cortex adapter — one adapter object + registration + cortex gates
  (PR #40 → 0.12). **Delivered.** PR #40 carries a `cortexAdapter` that lands inside the seam without touching
  the common layer (§11-5). The port arrived; what remains is maintainer-side landing, not contributor work.
- **GPT:** the §7 review → frozen spec. **Done.**

**2026-07-27 update.** The landing itself is now maintainer-side: rebase PR #40 onto current main,
clear §11's entry gate, resolve the pending `smoke-acp-cortex-live` deliverable, and ship. The contributor's
commits and authorship are preserved through the merge — the adapter is their work and the credit stays theirs.

**2026-07-29 update — done.** The transplant landed as hvkiefer's commit plus maintainer revision commits on
top (each revision pinned to a CP0-measured defect, §11-8); `smoke-acp-cortex-live` exists and the run.sh
target no longer fails loud.

## 9. Frozen spec (GPT-agreed 2026-06-25)

GPT (`…341a87`) closed every §7 point. These are the rail invariants:

1. **Single `entwurf` provider + modelId-prefix registry.** No provider-per-backend.
   - A non-claude backend MUST carry a **reserved prefix** (`cortex-*`). The claude adapter owns only
     **unprefixed** curated ids.
   - `resolveAcpBackendAdapter(modelId)`: 0 matches → `throw` (unknown); 2+ matches → `throw` (prefix
     collision). Collisions fail-fast at startup/check.
   - An explicit `claude-*` prefix is **not** introduced (avoids alias / dual identity; keeps existing ids).
2. **`AcpBackendAdapter` (product seam) is separate from `AcpTurnDeps` (test/runtime seam).** Resolve
   `const { adapter, nativeModelId } = resolveAcpBackendAdapter(model.id)` once at turn entry; `defaultDeps()`
   takes no adapter and the adapter is threaded into `loadConfig(cwd, modelId, adapter)`. `backend`,
   `nativeModelId` are stored explicitly on BridgeSession/configSig (no model-id re-parsing).
3. **`routeModel(modelId)` does owns + native-id strip in one method.** `enforceModel` / `resolveLaunch` use
   the **native** model id.
4. **`buildSessionMeta` undefined → `_meta` omitted.**
   `newSessionArgs = sessionMeta === undefined ? { cwd, mcpServers } : { cwd, mcpServers, _meta: sessionMeta }`.
   **Implementation update:** the engraving is loaded by a SEPARATE `loadCarrier(params)` method (not inside
   `buildSessionMeta` as the §3 draft sketched); `buildSessionMeta` receives the already-loaded carrier. A
   carrier-less backend (cortex) returns `null` from `loadCarrier` so it never touches the shipped-engraving /
   appendSystemPrompt signature, and `undefined` from `buildSessionMeta`. Rich context always rides
   `prependNewPromptAugment`; a carrier-less backend's operator engraving joins the augment (cortex PR defines
   the exact join — deferred here).
5. **`ensureOverlay → { envOverrides }`.** Spawn merges `env: { ...process.env, ...adapter.launchEnvDefaults(),
   ...overlay.envOverrides }`. Sweep is internal to the adapter.
6. **`enforceModel` — single method, no flag.** claude = `setSessionConfigOption`; the frozen draft assumed
   cortex = no-op + launch-pin. *(2026-07-29 implementation update: the landed cortexAdapter also calls
   per-turn `setSessionConfigOption` — measured GO against the live surface, §11-8 E — and `resolveLaunch`
   never pins `-m`. The single-method, no-flag shape is unchanged; a genuinely launch-pinned future backend
   would be the no-op case.)*
7. **`configSignatureFields(adapterSettings)`** takes the **opaque adapterSettings** (not the whole config) and
   returns `backend`/`nativeModelId`-adjacent **stable ids only** (connection/profile/env-derived). No raw env
   values / secrets. Must be a flat, deterministic primitive map (JSON.stringify stability).
8. **codex/gemini = 0.12 non-goal.** codex is a native garden citizen (not ACP). `ENTWURF_ACP_FOR_CODEX=1`
   opt-in is deliberately **not** in the default registry — a future opt-in only, debated in a separate issue.
   0.12.3 went further and **removed the placeholder `entwurf/gpt-5.x` targets** from the registry: a vendor
   ACP surface only exists once its adapter lands through *this* rail. Cortex (PR #40) would be the first real
   one — which is exactly why the rail matters.

**One-line spec:** single `entwurf` provider + modelId-prefix registry (prefix required for non-claude) +
separate adapter object resolved at turn entry + `buildSessionMeta` undefined ⇒ `_meta` omitted + rich context
always via first-user augment + codex ACP is a 0.12 non-goal.

### Step B review notes (GPT 2026-06-25) — apply when porting cortex

- **`configSignatureFields`' return must be a flat, sorted-stable primitive map.** Stable key order keeps the
  signature stable across turns (JSON.stringify determinism). No nested objects / non-deterministic order — pin
  this in `check-acp-session-reuse`.
- **The `config.ts` `settings.backend` guard is already syntactic-only** (§10 A) — `backend:"cortex"` is not
  blocked at the config layer. The modelId prefix is the single routing authority; the declared-vs-routed
  mismatch is the only throw, at the routing site in `backend.ts`.
- **When persisted resume/load lands**, re-check `adapter`/`backend`/`nativeModelId` agreement against the
  persisted record (persisted resume is currently off, so this is a future note).

## 10. `settings.backend` guard + the generic `adapterSettings` seam (confirmed 2026-06-25, GPT GO)

This closed the two future notes above and added a backend-owned-settings seam to the rail so backends beyond
cortex can attach cleanly. Opus implementation / GPT review converged over three rounds.

**(A) `settings.backend` = diagnostic guard, NOT routing authority.**
- `config.ts` validates `backend` **syntactically only** (string → pass). No value whitelist — the registry
  owns the valid-backend set, so a new backend needs no `config.ts` edit.
- The semantic guard lives at the `backend.ts` routing site: right after `resolveAcpBackendAdapter(modelId)`,
  `config.backend !== adapter.backend → fail-loud`. **modelId prefix = single routing authority**; only a
  declared-vs-routed mismatch throws (an unknown backend dies as a mismatch).

**(B) Backend-specific settings travel ONLY via the opaque `adapterSettings` (common config stays clean).**
- `AcpBackendAdapter.resolveAdapterSettings(params: AcpAdapterSettingsParams): unknown` — the adapter parses
  **only its own keys** off the raw `entwurfProvider` blocks (`{global,project,merged}Block` + paths) and
  returns an opaque value. claude returns `undefined`.
- `ResolvedAcpConfig.adapterSettings: unknown` is one slot. Putting backend-named fields (e.g.
  `cortexConnection`) on the common type is a **fat-bridge regression and is forbidden**. `backend.ts` NEVER
  inspects this slot — only the routed adapter's methods read it, casting their own type back.
- Threading: `loadConfig(cwd, modelId, adapter)` hands the already-resolved adapter to config parsing, so
  `config.ts` never re-routes (the model id stays the single authority). `readProviderSettingsFile` returns
  `{ settings, raw }` — the raw block carries the backend keys.

**(C) Every backend-owned behavior seam can reach `adapterSettings`.**
- `resolveLaunch` · `buildSessionMeta` · `ensureOverlay` · `loadCarrier` all receive `config` (⊇
  `adapterSettings`). `configSignatureFields(adapterSettings)` receives the opaque value directly.
- `launchEnvDefaults()` stays **static**; settings-derived spawn env rides `ensureOverlay(...).envOverrides`.
- `configSignatureFields` returns a **flat deterministic primitive map only** (e.g.
  `{ cortexConnection: conn ?? null }`) — stable id per backend, no secrets.

**(D) Contributor surface (rail track complete).** PR #40 cortex = **`cortexAdapter` (inline or its own module) +
registry registration + cortex gates only**. `backend.ts` / `acp-client.ts` / `event-mapper.ts` /
`session-store.ts` / `config.ts` (the common layer) are **untouched**. The real verification of cortex fields is
the cortex adapter PR + its gates.

**Gates that already exist for this seam:** `check-acp-config` carries the `settings.backend` syntactic checks +
fake-adapter seam plumbing (opaque lands / raw block reaches the hook / backend-specific keys NEVER appear on
the common config / no-settings → undefined). `check-acp-session-reuse` covers adapter wiring + settings
passthrough + signature sensitivity. `pnpm typecheck` (3 configs) + `pnpm check` are EXIT 0.

## 11. Entry conditions — the reference adapter must prove outbound dispatch before a second backend rides

Added 2026-07-27, after the 0.12.9 closure and before any cortex code is written. §1–§10 describe a seam that is
**built**. This section describes what must be **true** for a second backend to ride it. Where §1–§10 and §11
disagree about readiness, §11 is newer and wins.

**Release framing.** This is deliberately *not* pinned to one version number. The `claude-agent-acp` 0.62.0 pin
and this section ship as part of **0.12.10** — a patch cut whose full scope is the pin, this document, the
removal of pi special-casing from code/comments, and the AGENTS carrier-budget gate (`NEXT.md` §NOW is the
authority on that list). It tightens the rail and records what is known. The open causal question (§11-7)
outlives that cut, and cortex (#48) opens after it is settled — not on a date.

### 11-1. Implementation order: record-backed pi host → ACP Claude → cortex

The ACP plugin is not free-standing — every ACP turn currently runs inside a pi host process. The provider is
registered by `pi-extensions/acp-provider.ts`, pi's runner calls our `streamSimple`, and the host becomes
addressable through the same V3 record authority as every other citizen before it opens the control socket.
Therefore the **host adapter path** is verified first (pi pinned at **0.82.1** under `>=0.82.1 <0.83`), then the
rail's reference adapter, then a second ACP adapter. This is dependency order, not a privileged identity order:
backend `pi` differs only because it currently owns the **control-socket capability domain** plus today's
**host-adapter relaunch capability**. Those are two statements, not one domain: the dormant socket-liveness
branch selects `spawn-bg`, and `resolveResumeLaunchIdentity` is what checks backend authority at the launch
leaf. There is **no separate spawn-domain predicate** — do not write "spawn-resume domain" until one exists
(`AGENTS.md` §Capability domains, `VERIFY.md`).

Cortex is not waiting on its own quality. It is waiting on the rail having **one adapter that demonstrably
carries a model all the way to outbound sibling dispatch**. A
second adapter added to an unproven rail cannot distinguish an adapter bug from a rail bug — which is the whole
reason the adapter seam was built in the first place.

### 11-2. The open gap — ACP Claude was not reliably a garden citizen

**Symptom.** On the first turn of a `pi --entwurf-control` resident running an ACP model, the bundled
`entwurf-bridge` MCP tools are *sometimes* missing from the session's tool schema. The model then cannot reach
its siblings at all.

**Name the failing half precisely.** The session is *not* stripped of citizenship: the host
`pi --entwurf-control` resident holds its own record and record-keyed control socket, and S1
(`smoke-acp-socket-citizen-live`) proves that turn-free — it stays addressable, discoverable, and receivable
throughout. What breaks is narrower and further out: **the ACP model inside that citizen cannot exercise
outbound sibling dispatch through the bundled bridge.** So this is a *model-facing outbound* capability
failure, not a loss of address. Writing it as "not a citizen" contradicts the repo's own identity model and
overstates the blast radius.

Three samples, all 2026-07-24, two different model reactions with **one shared symptom**:

| sample | smoke | what the model did |
|---|---|---|
| 19:00 | `smoke-acp-v2-send-live` | called the tool; the runtime answered `No such tool available: mcp__entwurf-bridge__entwurf_v2` |
| 19:30 | `smoke-acp-bundled-mcp-live` (aggregate) | read its schema first, saw only Read/Bash/Edit/Write/Skill, and refused to invent a result |
| 22:38 | `smoke-acp-bundled-mcp-live` (quiet machine, sequential) | same absence; every pre-turn assertion green — only the tool schema was empty |

Isolated reruns are 4/4 PASS, so this is intermittent, not a dead wire. Full sample ledger + load analysis is in
**`ROADMAP.md` → "번들 MCP readiness race"** (the SSOT); #55 tracks it.

**Keep the claim at the strength the evidence carries.** Three samples plus 4/4 isolated PASS do not establish
causation. State it in three tiers and do not let them blur:

1. **Established — the symptom.** The bundled MCP tools were absent from the session schema in three runs.
2. **Established — a contract gap.** There is **no client-side readiness fence anywhere on this path**.
   `claude-agent-acp`'s `createSession()` awaits only `q.initializationResult()` and returns; our turn body then
   goes `newSession → enforceModel → prompt` back to back (`backend.ts`, the `streamAcpTurn` sequence). Nothing
   waits for the configured MCP servers to reach `connected`. Verified against current main on 2026-07-27:
   `mcpServerStatus` occurs exactly once in the whole repo, inside a comment.
3. **Candidate mechanism, NOT established cause.** That the missing fence *is* what produced the three
   observations. Plausible and unrefuted — but the controlled repro does not exist yet, and the load correlation
   is correlation only (see the ROADMAP ledger, where sample 3 came off a quiet machine). §11-7 designs an
   ordering probe that narrows this — it can show the window is *sufficient* to produce the symptom, which is
   still not the same as attributing the three historical incidents to it.

**The 0.62.0 bump adds no readiness wait — that is not the same as "does not fix it" (measured 2026-07-27).**
The pin moved 0.61.0 → 0.62.0 on this date. The adapter's own `dist/` is **byte-identical** across the two
releases and still never calls `mcpServerStatus()`, so **no explicit readiness fence was added and the bump must
not be counted as a fix**. But 0.62.0 does move its runtime dependency (`claude-agent-sdk` 0.3.217 → 0.3.219),
and MCP startup lives inside that SDK — so identical timing is *not* claimed, only an unchanged absence of any
fence. The ROADMAP's prescription ① ("wait for / patch upstream") therefore has no near-term payoff.

This asymmetry governs how the next measurement reads: a **green** run is not evidence of a fix (the race is
intermittent — it is evidence about frequency), while a **red** run *is* evidence that the bump did not
eliminate this symptom.

GLG's standing decision on this defect was **observe, do not fix, until causation stands**. That decision was
taken while cortex was *not* the next lane. 11-3 is why the lane change re-opens it.

### 11-3. What cortex inherits is the contract gap — not, provably, the race

Be precise about what transfers. MCP servers reach a session through the **backend-invariant** part of the turn:
`backend.ts` enriches the normalized servers with the session envelope and passes `mcpServers: wireMcpServers`
straight into `connection.newSession(...)`. A cortex session receives the bundled `entwurf-bridge` by exactly
that path, and meets exactly the same absence of a client-side wait. Nothing in `cortexAdapter` can change that.

**What that does NOT establish** is that cortex reproduces the race. The race requires a *server* that can
return `newSession` before its MCP servers are usable. Cortex's ACP server is a different implementation and may
well guarantee readiness before it returns — in which case the same missing client-side fence is harmless there.
So the honest statement is: **cortex inherits the missing client-side readiness guarantee (a contract gap); it
inherits the race only if its server has the same behavior, which is unmeasured.** Measure it; do not assume
symmetry in either direction.

But the two prescriptions recorded in ROADMAP were both scoped to Claude internals:

- **① patch `claude-agent-acp` so `createSession` bounded-waits** — does nothing for `cortex acp serve`, which
  is a different ACP server implementation entirely.
- **② expose MCP status as an ACP extension and poll before prompting** — requires the ACP *server* to expose
  readiness. `claude-agent-sdk` has `mcpServerStatus()`; whether Cortex's ACP server exposes any equivalent is
  **unmeasured**. Probe it during the audit rather than assuming symmetry.

So tool readiness is a **rail-level contract question**, not a Claude bug — and it is still an *open question*,
not a decided design. Do not pre-commit to a shape. An optional adapter member is one candidate, but before it
can be the answer there is a prior problem to solve: how a backend whose server already guarantees
newSession-readiness *proves* that, rather than merely declaring a no-op. A member that any backend can satisfy
by returning immediately buys nothing.

If the answer does turn out to be per-backend, it touches the adapter interface — which cuts against §5's line
that "cortex adds zero to the common layer". That line is about **adapter porting work**, and it stays true for
the port; it was never a claim that the rail is finished. Settle this before merge, not after.

### 11-4. The entry gate — what must be green on the current pin

The samples above were taken on pi **0.82.0** + claude-agent-acp **0.61.0**; the pins are now pi **0.82.1** +
claude-agent-acp **0.62.0** (with `claude-agent-sdk` 0.3.219 underneath), and pi has since tightened its own test
harness. A re-measure is therefore a genuine new datapoint, not a repeat run. Before cortex code:

```sh
LIVE=1 ./run.sh smoke-acp-socket-citizen-live   # S1 — citizenship without a turn
LIVE=1 ./run.sh smoke-acp-bundled-mcp-live      # receive half — the model reads entwurf_self
LIVE=1 ./run.sh smoke-acp-v2-send-live          # send half — the exact blind spot GLG hit
```

All three are MUST tier: a failure here is **our** defect, never model flakiness — demoting one to advisory
buries the defect. Record the outcome as a new sample in the ROADMAP ledger **either way**.

**Read the result asymmetrically.** The race is intermittent, so a green sweep proves the pins are drivable and
adds a frequency datapoint — it does **not** prove the readiness gap is closed, and it must never be written up
as "0.62.0 fixed it". A red run, by contrast, is direct evidence that the bump did not eliminate this symptom. One
round of measurement is therefore an input to the contract question, never its conclusion; the deliverable of
this lane's first round is a precisely-worded gap statement plus an ordering-probe design, not a
prescription.

**Result of the first round (2026-07-27 10:24–10:25 KST): 3/3 PASS** on pi 0.82.1 + claude-agent-acp 0.62.0 +
claude 2.1.220 — socket-citizen 10 checks, bundled-mcp 14 checks, v2-send 15 assertions, quiet machine
(loadavg 1.24), 24 seconds total. The pins are drivable and the citizen path works end to end.

**And that sweep did not test the thing it looks like it tested.** All three failure samples came from *heavy*
conditions — a concurrent `pnpm check`, a heavy aggregate ~10 live turns in, a 17-step release-gate late in the
run. A 24-second three-smoke sequence is structurally the *isolated re-run* condition that was already 4/4 PASS.
So this round moves the isolated tally to 5/5 and says **nothing** about the heavy-sequence correlation. Treating
it as reassurance would be exactly the misread §11-2 warns against. Hitting the correlated condition means the
full `LIVE=1 ./run.sh release-gate` — while §11-7's ordering probe attacks a different question (does this
server wait for a delayed MCP at all) that no amount of sampling answers.

### 11-5. PR #40 landing surface, as measured on 2026-07-27

- **State:** OPEN, `mergeStateStatus=DIRTY`, head `3dd6f5fa530c2f91e436abc3b4d79dbc2adc4d53`. #48 records
  `d8baf79` and a `pi/entwurf-targets.json` spawn allowlist that #50 deleted — both stale; do not resurrect the
  allowlist to make an old checklist true.
- **The conflicts are not in the adapter.** `git merge-tree --write-tree main pr40` conflicts in exactly four
  files: `CHANGELOG.md`, `docs/acp-backend-rail.md`, `package.json`, `run.sh`. The adapter core —
  `backend-adapter.ts`, `augment.ts`, `overlay.ts`, `models.ts`, `scripts/check-acp-cortex.ts` — does **not**
  conflict. That is the rail working exactly as §6 promised: the contributor's work landed where the seam said
  it would, and the dirty state is release-ledger / manifest / target-registry drift.
- **PR #40 ships one declared-incomplete deliverable.** Its own CHANGELOG entry says the live-turn script
  `scripts/smoke-acp-cortex-live.ts` "is a pending deliverable, and the target fails loud until it lands". That
  file is in **neither the PR nor main**, so merging as-is lands a `run.sh` target that fails loud by design.
  Decide explicitly: write the script, or land without the target. Do not merge a fail-loud target silently.
- **Re-verify cortex against the installed binary.** Local Cortex Code is **v1.1.47**; #48's overlay evidence
  was taken at v1.1.8. Re-check `cortex acp serve`, the `SNOWFLAKE_HOME` passthrough, and the model surface
  against what is actually installed.

### 11-6. Host finding — cortex bundled plugin hooks live outside `SNOWFLAKE_HOME`

Observed on this host (NixOS) with Cortex v1.1.47 in its interactive TUI: every user prompt fires

```
[Hook: UserPromptSubmit]: .../bundled_plugins/airflow/skills/airflow/hooks/airflow-skill-suggester.sh:
  /bin/bash: bad interpreter: No such file or directory
```

The hook is real (`#!/bin/bash`, one bundled hook shipped in 1.1.47) and `/bin/bash` does not exist on NixOS.
The point for this rail is **where it lives**: `~/.local/share/cortex/<version>/bundled_plugins/`, i.e. inside
the CLI's own install directory — **not** under `SNOWFLAKE_HOME`, so NO overlay reaches bundled plugins
(the CP0 audit later widened this: operator hooks also live at `~/.claude/settings.json`, outside
`SNOWFLAKE_HOME` too — §11-8 D1, which is what forced the dual-HOME redesign). The audit's LIVE turns saw
no bundled-hook firing under ACP (hook trace 0 in the isolated HOME), and a bundled hook failure is
non-fatal to the turn; the install-dir surface itself remains outside any overlay's reach by construction.

### 11-7. An ordering probe — what it can decide, and what it cannot

**First, a measured dead end.** There is no readiness signal to poll. claude-agent-acp 0.62.0 emits exactly ten
`sessionUpdate` kinds — `agent_message_chunk`, `agent_thought_chunk`, `available_commands_update`,
`config_option_update`, `current_mode_update`, `plan`, `session_info_update`, `tool_call`, `tool_call_update`,
`usage_update` — and **not one carries MCP server state**. Combined with `newSession` returning no tool list,
this means a client cannot read readiness off **the ACP surface this server currently exposes** (a statement
about claude-agent-acp today, not about the ACP protocol in general). So ROADMAP prescription ② is not "add a
poll"; it is "first cause a signal to exist". Any design that assumes the status is already observable is wrong
on a measured fact.

**So stop trying to observe the window and control its input instead.** Give
`scripts/fixtures/probe-mcp-server.ts` — already the isolated fixture `smoke-acp-mcp-live` uses — an
env-controlled startup delay (e.g. `PROBE_MCP_STARTUP_DELAY_MS`) applied before it serves, and register it as an
operator MCP server.

**The probe unit is a PAIRED run, never a single delayed one.** One delayed run cannot support any of the
readings below, and an earlier draft of this section that called for "one live turn" was wrong on all three
counts:

- an **A**-looking order (`tools/list` before `newSession` end) may just mean `newSession`'s other work happened
  to take longer — ordering alone never shows the server *waited because of* the delay;
- a **B**-looking failure may be one the same setup produces at `delay=0` too, in which case the injected delay
  established no sufficiency at all;
- a **D**-looking timeout may be the probe manufacturing its own. The turn has **three** 30 s boundaries
  (`INITIALIZE_TIMEOUT_MS`, `NEW_SESSION_TIMEOUT_MS`, `SET_MODEL_TIMEOUT_MS` at
  `pi-extensions/lib/acp/backend.ts:81-83`) plus `PROMPT_TIMEOUT_MS` at 600 s. All four are recorded for phase
  attribution, but the injected MCP delay only interacts **from `newSession` onward** — the servers are passed
  in at `newSession`, so `initialize` sits before the intervention can reach anything. A failure at `initialize`
  is therefore a **run-invalidating state** (`P0` in the control, `I0` in an intervention — see below), never a
  `D`, and `D` must stay well below the `newSession` and set-model boundaries or it measures our timeout instead
  of the server.

So each probe run is a matched pair on identical pins, config, and fixture:

1. **Control, `delay=0`** — the expected tool must be visible *and* callable; record the same ordering markers.
2. **Intervention, `0 < D` well below BOTH the `newSession` and set-model 30 s boundaries** — same markers, same
   log.
3. **At least two nonzero delays (`D1`, `D2`) are REQUIRED to reach an A verdict**, because "latency shifts with
   D" is the whole discriminator and one point cannot show scaling. With a single D you may record the ordering
   observation, but the wait-because-of-the-delay verdict is **withheld**. B, C, and D may be read off the first
   intervention.
4. Every event carries a **`runId`** so all ACP-side and MCP-side records join per run in the shared log.

**Instrument the real production sequence, which has a step between the two obvious ones.** The turn is
`newSession → enforceModel(setSessionConfigOption) → prompt` (`backend.ts`), so a delayed MCP can be resolved
*during* `enforceModel`, or fail loud there rather than at `newSession`. A probe that only marks newSession and
prompt misreads both cases as C or D. Minimum ACP-side markers:

```text
newSession start/end → setSessionConfigOption(model) start/end → prompt start/end
```

**Write the verdicts as deltas against the control, not as absolutes:**

| branch | control vs intervention | what it shows |
|---|---|---|
| **P0 — INVALID BASELINE** | the `delay=0` control itself fails: the expected tool is not visible/callable | **not a branch of the experiment.** Stop; do not judge the intervention at all — every delta becomes uninterpretable. Preserve and record the artifact **as a P0 / INVALID BASELINE fact**, then follow the promotion order below. Never fold a control failure into B or D; doing so manufactures delay attribution out of a broken baseline. |
| **A** | delayed runs keep `tools/list` → `newSession` ordering **and** `newSession` latency tracks D across `D1` and `D2` | wait evidence **on this server and path** — not a general guarantee |
| **B** | control is callable-PASS; delayed run puts `newSession`/`enforceModel`/prompt ahead of wire-availability and yields absence / `No such tool` | the delay window is **sufficient** to produce the failure mode |
| **C** | control PASS; delayed run runs ahead of wire-availability, yet a later direct tool-call marker succeeds | late/dynamic readiness exists without any client fence |
| **D** | an error/timeout with `D` well under the boundaries — **always phase-qualified** | fail-loud observation, named by the phase that failed (below) |

**A P0 is not automatically a readiness sample — promote it only on direct evidence.** A malformed fixture, a
wrong pin, a bad config or a non-compliant model produces the same "tool not callable" *surface* and is not
evidence about readiness; writing it straight into the ledger pollutes the very finding it resembles. And
"looks like the historical samples" is **not** a decidable test — narrative resemblance is exactly the inference
this whole probe exists to replace. Classify on markers:

**First, measure the id — never hardcode it.** The provider-bound tool id is *not* the source MCP name: this
repo's own samples show source `entwurf_v2` arriving as `mcp__entwurf-bridge__entwurf_v2`. So a delayed run
where the model guesses a bare `probe_nonce` and gets `No such tool` proves nothing — the real provider-bound id
may have been in the schema all along, and that is an alias/model error, not absence. Use the control to
establish the ground truth:

**The two layers do not share a request-id namespace, so correlate on an argument you control.** An ACP
`tool_call` event's `toolCallId` is a Claude tool-use id (`acp-agent.js` builds it from `toolUse.id` /
`tool_use_id` / `message.uuid`), while the fixture sees a JSON-RPC id the MCP client minted independently —
`acp-agent.js` contains no `jsonrpc` plumbing at all, so nothing promises those two are equal. Joining on
"request id" would be an assumption, not a measurement. Instead:

1. Give the probe fixture tool a **required correlation field**, e.g. `probeRunId`.
2. Have the prompt call the tool with this run's unique `probeRunId` as an exact argument.
3. Join the control's ACP `tool_call` event (provider-bound tool name + `rawInput.probeRunId`) to the fixture's
   `tools/call.params.arguments.probeRunId` on **`runId` + `probeRunId`**.
4. Record the provider-bound tool name observed in that ACP event as:

> **`expectedProviderToolId`** — measured, never hardcoded. Every absence claim below is compared against *that*
> value.

5. Keep the ACP `toolCallId` and the MCP JSON-RPC id in the artifact for forensics, but **never** use either as
   a cross-layer equality or join key.

(The fixture serves one tool, so `runId` + cardinality could *infer* the pairing — but explicit input
correlation is decisive, and this probe exists precisely to stop settling for inference.)

| observed markers | classification | promotable? |
|---|---|---|
| no `tools_list_response_forwarded` | MCP handshake / fixture / config candidate | **No** |
| a `tools/call` for the expected tool reached the fixture but failed | tool-execution / fixture fault — schema dispatch already worked | **No** |
| `tools_list_response_forwarded` **and** explicit call prompt sent **and** *no* fixture `tools/call` marker **and** runtime `No such tool available: <id>` where `<id> === expectedProviderToolId` | **direct schema-absence evidence** | **Yes**, if pre-turn assertions and config were valid |
| same as above but `<id>` is the bare name or any other alias | model / alias mismatch | **No** |
| no call marker, no direct runtime error, only model prose saying the tool is missing | model-compliance / insufficient evidence | **No** — model prose alone never promotes |
| a **Claude CLI-reported available tool-name snapshot** (SDK `system`/`init.tools`) for this same `runId` and prompt ordinal, taken *after* `tools_list_response_forwarded`, showing `expectedProviderToolId` absent | `B-name-snapshot` — a *controlled* absence reading, **weaker** than the row above | **Yes**, under the extra conditions in §11-7-c |

Any combination not listed stays **P0 / inconclusive** by default. Note the ②/③ boundary is decided by one
marker, not by reading the error text: a fixture `tools/call` marker means dispatch resolved and execution
failed; a direct no-such-tool claim requires that marker to be **absent**.

**The last two rows are NOT the same strength, and the earlier draft of this table said they were.** It called a
snapshot "equivalent to the direct runtime error". They are not equivalent, and conflating them would let a weaker
instrument inherit a stronger claim (GPT review 2026-07-29):

- the **runtime `No such tool`** row is the model's own dispatch failing against the id we measured — the failure
  mode itself, observed;
- a **name snapshot** is a *report* of what the CLI says it had available at turn init. It is a `string[]` of tool
  NAMES, not tool definitions, and it is the CLI's account of the turn rather than the request payload the model
  was actually served. It can carry an absence claim; it cannot carry the failure.

So the snapshot row is named `B-name-snapshot` and kept separate. What it may say is narrow: *in this paired run,
the injected delay was sufficient to produce a CLI-reported name-set absence.* What it may never say is that the
2026-07-24 incidents are explained — controlled sufficiency is not historical attribution. The seam, its
conditions, and its limits are §11-7-c. **The CONSUMER half is instrumented** (2026-07-29: the log doors, the
classifier ladder, and the runner preconditions exist and are gate-qualified offline); **the PRODUCER — the CLI
shim — is built and the LIVE runner ARMS the channel** (`snapshotInstrumented: true`), so a LIVE run can now
reach this row.

**A snapshot must be time-closed, or it is a different claim.** The ordering the row requires is

```text
tools_list_response_forwarded  <  CLI-reported tool-name snapshot for THIS prompt ordinal
```

and the snapshot has to be attributed to the same `runId` and the same serialized prompt ordinal. A capture taken
at an arbitrary moment after the prompt says nothing — dynamic updates mean the set can change underneath it.

Order of operations stays: record the run as a **P0 / INVALID BASELINE** fact with its artifact → classify
setup / pin / config / fixture / model-compliance → promote into the readiness ledger **only** on a row marked
promotable.

**Two run-invalidating states sit outside the verdict space entirely.** Neither is a `D`:

- **`P0 / INVALID BASELINE`** — the `delay=0` control fails (including an `initialize` failure there). P0 is a
  *state* name — "the control is not a judgeable baseline" — not a cause, so record the cause on the artifact as
  `reason=initialize|tool-unavailable|…` rather than minting a second label.
- **`I0 / INVALID RUN`** — the control passed but an *intervention* run fails at `initialize`. The injected delay
  cannot reach that phase, so this is environment drift: stop judging the intervention, preserve the artifact,
  and re-run the same pair **once**. If it recurs, stop retrying and switch to environment/initialize root-cause
  work — repeated retries past a bounded attempt are just resampling a broken host.

**D must name its phase, or it says nothing** — and only the phases the delay can actually reach are `D` at all.
Bind each verdict to the wire request id/method that timed out:

| phase | boundary | reading |
|---|---|---|
| `D-newSession` | `NEW_SESSION_TIMEOUT_MS` 30 s | the server stalled while opening the session |
| `D-enforceModel` | `SET_MODEL_TIMEOUT_MS` 30 s | the stall surfaced at set-model, not session open |
| `D-prompt` | `PROMPT_TIMEOUT_MS` 600 s | classified separately from tool absence — a prompt-phase failure is not a schema claim |

(`INITIALIZE_TIMEOUT_MS` is still recorded, but a failure there is `P0`/`I0` per above — never a `D`.)

Two consequences follow, and neither is optional:

- **B is not historical attribution.** Showing that a controlled delay can produce the symptom establishes the
  mechanism is *sufficient*, never that it is what actually caused the 2026-07-24 incidents. Causal sufficiency
  and incident attribution are different claims; do not let a green-looking repro collapse them.
- **A single "tool present" does not refute the mechanism.** Without ordering data, A and C are
  indistinguishable, and they mean opposite things about whether a fence is needed.

**So the probe must be instrumented, not just observed.** Record timestamps/markers for at minimum: fixture
process start → delay start/end → MCP transport connect / initialize / tool-list / tool-call; and on the client
side the **full** ACP sequence — `newSession` start/end → `setSessionConfigOption(model)` start/end → prompt
start/end. Dropping set-model here is what makes an `enforceModel` stall read as C or D. Separate the **probe's
own invocation marker** (did the server
receive a call?) from the **runtime `No such tool` error** — inferring schema ordering from model behavior alone
is exactly the mistake that made the original three samples hard to read.

**Define the marker precisely, or A and C stay indistinguishable — and do not call it "ready".** Neither
`server.connect()` nor *receiving* an initialize request is readiness, and a fixture handler's *return* is not
the moment the bytes left (it shifts the marker earlier by however long serialization and the write take). Fix
it to **one implementable point**:

> **`tools_list_response_forwarded`** — the MCP-side wire proxy has `write()`-n the *entire* expected-tool
> `tools/list` response frame to downstream stdio **and received the write callback**.

Two naming rules follow, and they matter:

- This is a **wire-availability proxy**, not readiness. It says the bytes were handed off — never that the client
  parsed or installed the tool. Keep calling it wire-availability in every write-up.
- **Actual callability is confirmed only** by a separate marker: a `tools/call` request for the expected tool
  arriving at the fixture. Nothing else may stand in for it.

Measuring the first marker needs fixture-side / MCP-side wire instrumentation, **separate** from the ACP-side
proxy in the next paragraph. The minimal discriminator is three points compared on one timeline:

```text
tools_list_response_forwarded   ↔   newSession end   ↔   prompt request start
```

Every participating process must append to **one shared NDJSON event log** — append-only, each line carrying the
`runId`, a shared wall-clock stamp, the writing `pid`, and a monotonic per-process counter — so ordering is read
off a common axis instead of being reconstructed from separate logs with drifting clocks.

**Name the client-side seam, because the instrumentation is impossible without one.** Client `newSession` /
`prompt` start-end stamps have to come from somewhere, and this section forbids editing the product turn loop.
Two options, and the probe must pick one explicitly:

- **ACP stdio wire proxy** — interpose on the child's stdio and timestamp the JSON-RPC request/response frames.
  Observes the real production path without touching it.
- **Probe-dedicated raw client** — a standalone client that speaks the same sequence (as
  `smoke-acp-raw-turn-live` already does). Cheaper, but it is *not* the production path, so it must be bound by
  a gate asserting it issues the same calls, arguments, and order as the backend's real sequence — otherwise the
  probe measures a lookalike.

Reading a `session ready` progress notice and inferring timing from it is **not** acceptable: that is
lifecycle-text inference, the same indirect reasoning this probe exists to replace.

**State the question the probe actually answers**, which is narrower than "what caused the race":

> Against a `delay=0` control, does injecting a startup delay shift this server's `newSession` — i.e. does it
> wait for the delayed MCP — or does the prompt open ahead of readiness, or does it fail loud?

That answer is worth having — it is the fact every prescription depends on — but it is an input to the causal
question, not its conclusion. GLG's standing rule ("do not fix until causation stands") still holds after the
probe runs.

**It is backend-agnostic on purpose.** The probe needs only an operator MCP server plus the paired
control/intervention runs, so the same
fixture can be aimed at `cortex acp serve` to answer §11-3's open question — does the cortex server guarantee
MCP-readiness before `newSession` returns? — by measurement rather than by assumed symmetry.

**Not in scope for this probe:** choosing a prescription, adding an adapter member, or editing the product turn
loop (the wire proxy / raw client seam above exists precisely so the turn loop stays untouched). Design follows
evidence, not the other way around.

#### 11-7-0. The observation window, the two log doors, and the two axes (2026-07-29)

Three contract additions came out of cross-review of the first LIVE pair. Each closes a way the probe could
report a fact about ITSELF as a fact about the server.

**⑴ The observation window.** Absence is only a reading when we kept looking long enough to have seen the
marker. After the turn settles the runner holds the ACP child open until the FIRST of:

| the window closes on | `reason` | what a missing wire marker then means |
|---|---|---|
| the wire marker landing | `wire-marker` | n/a — it landed |
| the ACP child exiting on its own | `child-exit` | **CENSORED** → `INVALIDATED`, never an attribution |
| the deadline passing | `deadline` | the window was **sufficient** → a real handshake / fixture / config candidate |
| the turn failing at a phase | `run-failed` | moot — the phase reading (`D-*`) owns the run |

and stamps `probe_observation_window_end {reason, markerSeen, deadlineBasis, waitedMs}` **before** teardown.
That stamp is SELF-REPORTED, so the classifier checks it rather than believing it: `markerSeen` must match
whether the run's log actually carries `tools_list_response_forwarded`, `wire-marker` implies seen, and
`deadline` / `child-exit` both imply unseen. Any disagreement INVALIDATES the run — otherwise a close claiming
the marker was seen, in a run that has none, would walk a censored run straight into the candidate branch. The
check lives in the run's shared validity list, so the **control is held to it too**: a baseline free to claim a
wire marker it never logged is not a baseline. The post-delay slack is a **constant, not an env knob**: a shrinkable window could close early and then
call its own absence "deadline-sufficient".
The deadline is anchored on the fixture's OWN `fixture_delay_start` / `fixture_delay_end` markers plus a bounded
post-delay slack — never on run start, because the injected delay begins when the fixture process boots, which
is itself some way into `newSession`; a run-start-relative deadline would drift with spawn latency and silently
shorten the window it claims to guarantee. The basis actually used is recorded, so a reader can tell a
well-anchored window from a fallback one. **A rejected alternative:** bounding `D` below the measured turn
duration. It reads like the same fix and is not — it is a noisy heuristic over a quantity that varies per run,
and it would put a stimulus parameter at the mercy of the model's verbosity. `D` keeps its timeout-boundary
condition only; the window, not the delay, is what has to be sufficient.

**⑵ Two doors on the log, not one.** `readProbeEvents` already refused broken LINES (`malformed`). It now also
refuses a broken STREAM (`sequenceViolations`): per writing pid, walking the RAW APPEND ORDER, `seq` must
strictly increase (a repeat is two lines claiming one slot; gaps are fine, the counter is process-wide) and
`tsMs` must not run backwards (one process reads one clock). **Before the sort, on purpose** — validating after
would be circular, since the comparator would have already rewritten the order under examination and a writer
whose clock stepped would come out looking perfectly ordered. The header had claimed a "monotonic per-process
counter" since the probe landed while the door checked only that `seq` was a non-negative safe integer: a
stated property the evidence never had to keep.

The writer key is **(runId, pid)**, not pid alone: the fixture is a fresh child per run and the OS reuses pids,
so a later run's fixture may legitimately restart its counter at 0 — and cross-run ordering is not something
any verdict reads.

Alongside it, **runner-owned marker topology** is now exactly-once: `run_start`, `probe_observation_window_end`
and `run_end` appear once each; every phase start/end pair appears at most once, never an end without a start,
never out of order, and always from ONE pid. Beyond the pairs, the **phase-to-phase production order** is
pinned — `initialize → newSession → enforceModel → prompt`, with a failed run being a **prefix** of that
sequence and never a hole. Checking only start<end inside each phase would pass a log whose phases were wholly
transposed while every pair looked intact. Three further shapes are closed: `run_start` must precede the first
phase; the **first FAILED phase must be the last one reached** (a tidy prefix whose second phase reports
`ok:false` still describes a driver that carried on, which ours never does); and `prompt_reply` follows
`prompt_end` — the real writer order, since the runner stamps the reply after `driveProbeTurn` returns — with
exactly one reply on a successful prompt and none on a failed one. Order is compared on `seq`, not timestamps — all runner markers
come from one process, so `seq` is exact where a same-millisecond pair is not. This is deliberately **narrow**:
`acp_tool_call_raw` repeats by design, a model may produce several tool calls, and a client may re-request
`tools/list`. Those are repeatable markers under an earliest-wins read, and sweeping them into an exactly-once
rule was proposed here and rejected as over-broad.

**⑶ Two axes, reported separately.** One verdict let an unsettled question hide a settled one (§11-7-b). Every
intervention now carries both:

- **(a) `ordering` — the ordering observation**, from marker timestamps alone:
  `wire-before-newSession-end` · `wire-before-prompt-request` (`newSession` end < wire < `promptStart`) ·
  `prompt-request-ahead-of-wire` · `censored` · `unknown` (no marker under a sufficient window, or a same-ms
  cross-process tie, which is unordered at this resolution).
- **(b) `failure` — the callability reading**: `callable` · `C` · `B` · `B-name-snapshot` (§11-7-c, only under a
  roster-armed snapshot channel) · `candidate-handshake` · `inconclusive`.

**Every (a) value is named for the comparison it IS, never for a conclusion.** The first cut named them
`wait-observed` / `no-wait`, and review rejected that (2026-07-29): `promptStart` is a **client-side proxy** —
the moment *we* issued the ACP prompt request — and a server may accept that request and then wait internally
for the MCP install before serving the model. `promptStart < wire` therefore establishes exactly one thing:
we issued the prompt request first. It is **not** proof the server did not wait. The mirror error is equally
easy: `wire < newSessionEnd` on its own is an ordering, not "the server waited"; only A's latency scaling
across two delays turns it into wait evidence. B/C use the prompt comparison as a stated **premise**, and no
layer may say "the turn was opened against tool set X" or "the schema was fixed at T" until the provider-side
snapshot of §11-7-c exists to show it.

The three ordering comparisons are kept as three named flags — `newSessionOrderingKept`, `newSessionRanAhead`,
`promptRanAhead` — rather than one `ranAhead`, because **A and B/C do not share an axis**. A's axis is
`wire < newSessionEnd` plus latency scaling across two delays. B/C's causal window is `promptStart < wire`: the
prompt request is where the turn is opened against whatever tool set exists at that moment. `newSessionRanAhead`
is a diagnostic and never a B/C verdict input. Collapsing the three — in either direction — silently breaks one
of the two readings, which is why each is separately mutant-qualified.

**The exit contract asks three questions, not one.** The runner reports `status.validity` (fatal: `P0` / `I0` /
`INVALIDATED` — nothing was measured), `status.orderingMeasurement` (did axis (a) produce a comparison), and
`status.failureVerdict` (axis (b)). It exits non-zero only when the run produced *nothing*. A pair that lost an intervention reports
`validity: partial` with the discarded runs listed in `status.invalidRuns` — calling that plain `valid` would
hide a missing delay point behind a healthy label, and `A` in particular is a claim about the whole series. Previously any
composite verdict outside the judgeable list failed the run, which reported a pair that had successfully
measured its ordering axis as a failure because the callability axis had no marker — the same conflation the
axes exist to undo. `orderingMeasurement: measured` says a comparison was recorded; it is **not** a claim that
the server waited or did not.

The pair-level `ordering.summary` is deliberately **not** called "wait" either: `wire-before-newSession-end`
means every judgeable intervention put the wire before `newSession` end, while the WAIT verdict (`A`)
additionally requires the latency scaling. And evidence strings now carry the deltas — prompt↔wire, `newSession`↔wire, and how much turn
remained after the wire — because §11-7-b classified D1 correctly and still left a reader unable to see the
1.9 s ran-ahead or the 2.3 s of turn that followed the marker. That was a diagnosability defect, distinct from
a verdict defect, and it is fixed as one.

### 11-7-a. As built (2026-07-28)

The client seam chosen is the **probe-dedicated raw client**, bound by its required gate:

- driver `scripts/lib/probe-acp-turn.ts` (sequence + phase markers + production timeouts), shared NDJSON log
  `scripts/lib/probe-event-log.ts`, PURE classifier `scripts/lib/probe-verdict.ts`;
- fixture `scripts/fixtures/probe-mcp-server.ts` in probe mode (env `PROBE_MCP_EVENT_LOG`): startup delay,
  REQUIRED `probeRunId`, and `tools_list_response_forwarded` stamped on the stdio **write callback** — the SDK
  transport's own `send()` resolves on buffered-write/drain, which is exactly the false-green this section
  forbids, so the fixture swaps in a callback-forwarding transport; legacy mode (env absent) stays
  byte-compatible with `smoke-acp-mcp-live`;
- gate `./run.sh check-probe-ordering` (IN `pnpm check`): sameness pinned to `backend.ts` source
  (order/args/clientInfo/timeouts/permission policy), phase attribution incl. set-model, fixture wire
  instrumentation against a real child, event-log door integrity (envelope + payload), and the
  paired-verdict truth table — 19 claims are
  mutant-qualified via `scripts/mutants/probe-ordering.json` under check-gate-qualification, and
  [QK:*] tokens ⇔ qualified claims 1:1 by design (the remaining assertions carry plain messages;
  the gate header lists the two review-pinned-only properties);
- the classifier reads B **only** off the full delta+marker combination (the turn RAN AHEAD of
  wire-availability ∧ wire-forwarded ∧ no fixture tools/call ∧ runtime No-such-tool naming the
  measured id): a wire-marker-less absence stays an MCP handshake / fixture / config **candidate**,
  an alias-id error stays a model/alias mismatch, an exact-id absence without running ahead is an
  unlisted finding, and a same-ms cross-process stamp tie is unordered (strict inequalities on the
  ordering reads). The runtime No-such-tool marker is extracted from structured tool frames only —
  never agent prose — and a malformed event line invalidates the run with an INVALIDATED
  classification on the artifact's face (GPT reviews 2026-07-28 tightened all of these);
- the shared log's ENVELOPE is a contract at the door, not a shape the writer happens to emit:
  `{seq,pid,ts,tsMs,runId,event}` belongs to the writer (a payload carrying one of those keys is
  REFUSED at write time, never merged), `ts` is derived from a single `tsMs` clock read, and a
  JSON-valid line whose marker name is outside the vocabulary or whose sort axis is broken counts as
  MALFORMED — i.e. it takes the INVALIDATED path instead of entering the events array. Both decisive
  §11-7 reads are absence and ordering, so an unknown marker name (absence that looks like a marker
  that never fired) and a non-numeric `tsMs` (a NaN comparator, ordering read off file order) are
  exactly the corruptions that would look healthy. The two-clock-read straddle was not hypothetical:
  re-parsing the two artifacts from the 2026-07-28 LIVE runs finds exactly one line each whose `ts`
  and `tsMs` disagree by 1 ms (`fixture_process_start`, where module init sat between the two reads).
  Those pre-contract artifacts therefore re-parse as INVALIDATED — they stay forensic records, and any
  promotion needs a fresh pair run under the contract, never a re-read of them;
- the same door types the PAYLOAD, because the classifier judges on payload and a perfect envelope can
  still carry a lie: `ok === true` is false for `"true"`, so a corrupted phase end would read as a phase
  FAILURE (D / P0) rather than invalidate the run, and a `tools_list_response_forwarded` whose `tools`
  does not name `probe_nonce` is not wire-availability at all yet would still drive ran-ahead, C and B.
  Every event the classifier reads payload off therefore carries a rule, and `PAYLOAD_CONTRACT_EVENTS`
  is pinned in the gate against a hand-written literal so a new classifier read cannot land without one.
  The rules are typed-if-present exactly where the WRITER legitimately has nothing to record — a
  tools/call stamped before validation (a model calling with no join key IS the absence reading) and an
  ACP frame carrying neither name nor title (the classifier reads that as P0/unmeasured) — so the
  contract never manufactures an INVALIDATED run out of real model behavior. `probe_nonce` itself is now
  defined once in `probe-event-log.ts` and imported by fixture and classifier: three private copies of
  the string the wire marker is checked against could drift apart in silence;
- instrument `LIVE=1 ./run.sh smoke-acp-ordering-probe-live`: control + D1 + D2 (defaults 2 s / 8 s, both well below
  the 30 s boundaries), REAL emitted claudeAdapter/config modules injected (the emit-then-import pattern), the
  I0 bounded one-retry, artifacts under `.probe-artifacts/` (gitignored, preserved).

The one property the gate does not mutant-prove is the write-callback **timing** itself (a cross-process
microsecond ordering); the marker's existence and attribution are proven, the callback placement is
review-pinned in the fixture source.

### 11-7-b. First measurement under the door contract (2026-07-28) — re-read 2026-07-29

Artifact `.probe-artifacts/acp-ordering/2026-07-28T09-13-06-523Z` (gitignored, local forensics). 57 events,
**0 malformed** — the first evidence that the tightened door is calibrated rather than merely strict: a real
paired run passes it without being turned into an INVALIDATED artifact.

- **Control (D=0) PASSED**, so the baseline is judgeable: the wire marker landed at +1416 ms and `newSession`
  returned at +2021 ms (ordering kept), the tool was called, the nonce came back. Measured provider-bound id:
  `mcp__probe__probe_nonce` — the pair's `expectedProviderToolId`, never hardcoded.
- **D1 (2 s):** `newSession` returned at +1541 ms and the prompt started at +1546 ms, but the wire marker did
  not arrive until +3416 ms. The turn RAN AHEAD of wire availability by ~1.9 s. No fixture tools/call, no
  runtime `No such tool`, `carriesNonce=false`, `stopReason=end_turn`.
- **D2 (8 s):** `newSession` returned at +1647 ms and the entire turn ended at +6673 ms while the fixture was
  still inside its startup delay (`fixture_delay_end` at +9384 ms). That run produced no
  `tools_list_response_forwarded` at all.

**Verdict as first reported: `inconclusive`, promotable=false.** Cross-review on 2026-07-29 found that reading
wrong in two places, and both are now closed in the classifier.

**Read the rest of this section as FORENSICS, not as a re-classification.** This artifact predates the
observation-window protocol, so it carries no `probe_observation_window_end` on any run — which means the
current classifier **INVALIDATES it on topology, control included**, and correctly so. It cannot be re-judged,
and no verdict below may be quoted as one. What survives re-reading is narrower and still worth keeping: the
raw timestamps, and a diagnosis of what the first reading did with them.

**D1's timestamps carry a fact the single verdict hid.** `promptStart` (+1546 ms) precedes the wire marker
(+3416 ms) by ~1.9 s. That comparison is made of two timestamps and nothing else — it does not depend on what
the model chose to do. Under the axis vocabulary it is **`prompt-request-ahead-of-wire`**, and that is the
whole of it: *we issued the prompt request before the tools reached the wire.* It is **not** a finding that the
server did not wait — the server may have accepted that request and waited internally, and these stamps cannot
see inside it. Server-wait remains **undetermined**. What the first reading got wrong was structural rather
than factual: by folding one verdict over both questions, a recorded comparison was reported as though nothing
had been observed. Hence the two axes.

**D2 was misattributed, and the cause was ours.** It was filed as an MCP handshake / fixture / config candidate
because it produced no wire marker. The artifact says otherwise. The runner tore the ACP child down the instant
the turn settled at +6673 ms — while the fixture was still inside its 8 s delay. The fixture then went on to
log `fixture_delay_end` at +9384 ms, `fixture_transport_connected` at +9385 ms and `fixture_initialize_received`
at +9388 ms — **2.7 s after `run_end`** — and stopped there. In the control, `fixture_initialize_received` →
`fixture_tools_list_received` took 14 ms. So the marker was ~14 ms away when the observation window closed.
The absence was **right-censored**: a fact about our teardown, reported as a finding about the server. Under the
current contract a run shaped like this reads **INVALIDATED (`observation-window-closed`)** — stated as the
diagnosis it is, since this artifact itself is invalidated on topology before any of that is reached. The
observation-window protocol exists so the shape cannot recur.

**Nothing here changes the product turn loop, the rail's prescription, or a release note.** The one thing the
pair leaves behind is a forensic timestamp fact on D1 — `prompt-request-ahead-of-wire`, from one pair, on this
server and this path — plus the D2 censoring diagnosis. Neither is a server-wait verdict, and neither is
admissible evidence under the current door. **A judgeable measurement still has to be taken.**

**What the next pair has to change — and what it must NOT try.** The obvious move, "re-run with a prompt that
forces the attempt", was proposed here and is now withdrawn. The prompt was already
`Call the probe_nonce tool now with probeRunId set to exactly "…"`, and D1 shows why strengthening it cannot
work: the wire marker landed at +3416 ms with the turn still running until +5737 ms — **2.3 s of open window
after the tools reached the wire** — and the model still did not call. It could not: the tool was not in the
schema its prompt request was served with, and a compliant model does not call what it cannot see. There is
also no forcing mechanism to reach for — `tool_choice` / `toolChoice` appears **zero times** across
`@agentclientprotocol/claude-agent-acp` 0.62.0 and `@agentclientprotocol/sdk`; ACP `session/prompt` has no
forced-tool parameter. So delta-B's runtime `No such tool` is not reachable by stimulus tuning on a compliant
model, and repeating the prompt is not a plan. The oracle has to change instead — §11-7-c.


### 11-7-c. The `B-name-snapshot` seam — consumer half instrumented, producer owed (2026-07-29)

Delta-B's runtime `No such tool` is unreachable by stimulus tuning (§11-7-b). The oracle has to change, and the
one that can carry an absence claim without depending on model compliance is a snapshot of what the CLI reports
as available. Where that lives was measured, not assumed:

- `@anthropic-ai/claude-agent-sdk` 0.3.219 `sdk.d.ts:4412` — `SDKSystemMessage` (`subtype: 'init'`) carries
  **`tools: string[]`** and **`mcp_servers: {name,status}[]`**, and `acp-agent.js:1573-1587` notes it
  **re-emits per turn**, which is the per-prompt attribution the ladder requires.
- **The current ACP stdio seam cannot see it.** That same handler consumes only `capabilities` and
  `fast_mode_state` and drops the rest; the message never crosses the ACP wire. Ruled out by measurement, not
  by preference.
- **`acp-agent.js:4083`** resolves `pathToClaudeCodeExecutable: process.env.CLAUDE_CODE_EXECUTABLE ?? (await
  claudeCliPath())`. That env var is a **supported executable override seam** — upstream's own `--cli` path
  delegates through `claudeCliPath()` the same way. It is *not* an upstream sanction of instrumentation
  wrappers, and this document does not claim it is.
- A local HTTP proxy via `ANTHROPIC_BASE_URL` would give the true request payload including full tool schemas.
  It is **NO-GO**: it intermediates the operator's auth request, which is the boundary AGENTS `## ACP Plugin Boundary` (with Hard Rule 9) draws.
  Therefore historical sufficiency stays open — the strongest reachable oracle is deliberately not the ground
  truth, and that asymmetry is recorded rather than papered over.

**The launch semantics the seam sits inside were measured, and they closed the first draft's biggest hole
(cross-review 2026-07-29).** The SDK does not launch every `pathToClaudeCodeExecutable` the same way: a pure
suffix test (`.js/.mjs/.tsx/.ts/.jsx` — note `.cjs` is absent, a live sharp edge) sends script paths to
`node|bun <path> <flags>` (bun iff the adapter itself runs under bun) while anything else is spawned
**directly** — `child_process.spawn`, no shell, `cwd` = the ACP session cwd, so a relative override resolves
against the *session* directory and a bare command walks `PATH`. And `claudeCliPath()` returns an ambient
`CLAUDE_CODE_EXECUTABLE` **verbatim** — no resolution, no validation. So the first draft's condition — "the
exact path the operator's setting resolved to is what gets executed" — was an unprovable promise: preserving
arbitrary override shapes means reproducing the suffix discriminator and the interpreter choice, i.e. a second
copy of upstream launch semantics that can drift in silence. The seam **narrows the precondition honestly
instead**: the pair's validity comes from control and interventions sharing ONE launch path, not from operator
override generality, so the probe refuses what it cannot pin. Two more measured facts feed the conditions
below: `claudeCliPath()` has a **second consumer** (`claude auth logout`, `acp-agent.js:841`), so the shim must
be argv-agnostic passthrough rather than assume stream-json; and the adapter's `index.js` applies
managed-policy env onto `process.env` **before** `runAcp()`, so a policy-tier `CLAUDE_CODE_EXECUTABLE` can
silently replace the shim inside the ACP child — which is why a missing instrument must be a NAMED finding.

**The seam:** a probe-only shim at `CLAUDE_CODE_EXECUTABLE` that spawns the real CLI and tees its stream-json
stdout, under these conditions (agreed in cross-review before any code; amended by the adversarial re-review of
2026-07-29):

1. **Ambient-override refusal, then resolution, then asserts — never a fallback.** The runner refuses to run
   if the `CLAUDE_CODE_EXECUTABLE` key is **present at all — an empty string included**: upstream consumers
   disagree about empty (the `??` at `acp-agent.js:4083` passes "" on as set; a truthy check treats it as
   unset), and the probe refuses the ambiguity instead of picking a side. A refusal writes a **named
   `INVALIDATED (precondition-<reason>)` classification onto the artifact**, not stderr alone. In the
   ambient-clean state the runner resolves the target once through upstream `claudeCliPath()` and **asserts**
   — absolute path, a regular file, executable (`X_OK`), no script suffix (the same pinned suffix list,
   applied as a gate, never as launch logic) — then records the target as **path + sha256** and passes it to
   the shim by a probe env var. The COMPOSED spawn env of every ACP child is asserted override-free too
   (launch defaults / overlay overrides could inject what `process.env` did not carry). The deep import is a
   **version-pinned internal resolver dependency** (an `exports`-wildcard subpath, not a root export), and its
   disappearance breaks `check-probe-ordering` offline, never a LIVE run first. Preserving operator override
   shapes is **out of probe scope by refusal** — recorded, not papered over.
2. **Attribution is by the narrow single-prompt binding, not by any native request id.** This probe serializes
   exactly ONE prompt per run, so the contract is operational and small: the shim stamps when the prompt input
   frame has fully passed to the CLI's stdin (`shim_prompt_forwarded`, ordinal 1), and the ONLY candidate
   snapshots are init lines **RECEIVED after that marker — `receivedAtMs` strictly greater than the frame
   stamp, a same-ms tie fail-closed — not merely appended after it**: under stdout backpressure a boot-time
   init can have its downstream callback (and log append) land after the prompt marker, and an append-order
   binding would promote that stale set as the turn snapshot (GPT review 2026-07-29). Same-writer `seq` still
   orders the append as a sanity floor; boot-time init lines are legal non-candidates. **Exactly one**
   candidate binds; zero (the CLI did not re-emit, or the only late-appended snapshot was received before the
   frame) or several (reinitialize / set-model re-emission) is a NAMED reading violation — never a pick-first.
   Multi-prompt generalization is explicitly out of §11-7-c scope.
3. The shim preserves argv / stdin / stdout / stderr / exit / signal, and logs **no** auth, env, argv or prompt
   body — only allowlisted init fields (`tools`, `mcp_servers` status, `model`) plus ordinal and timing. It
   keeps a bounded in-memory line buffer for NDJSON framing; every other byte is exact-passthrough and then
   discarded. It assumes **nothing about its argv**: invoked for anything other than a stream-json turn (e.g.
   the `auth logout` consumer), it is pure passthrough whose only log line is its boot marker. stderr passes
   through untouched — the SDK reads a stderr tail for its own diagnostics.
4. It **scrubs an exact allowlist from the child's env, never a prefix**: `CLAUDE_CODE_EXECUTABLE` plus each
   probe-private variable **by literal name** (the `SHIM_SCRUB_ENV_VARS` constant is the single source), or the
   override re-propagates to grandchildren and produces recursion or env drift. A wildcard scrub (`PROBE_*`)
   would also delete operator env this probe has no claim on. Under condition 1's refusal, deletion IS exact
   preservation — there is no prior operator value to restore.
5. Control and intervention use the **same** shim **and the same resolved target — verified, not merely
   recorded**: the runner pins the target's path + sha256 before the first run, stamps both on every
   `run_start` (forensics) **and on every roster record (the authoritative copy the classifier consumes)**,
   and re-hashes after the last run — a content drift INVALIDATES the pair (`cli-target-drift`), an unreadable
   target at re-hash time likewise (`cli-target-unreadable`), because runs that cannot be shown to share one
   stimulus are not a delta. On an armed run the shim's own boot report (`shim_boot.targetPath/targetSha256`)
   **must match the roster's expected identity**; a mismatch — or an armed roster with no expected identity to
   verify against — is a structural finding under condition 7, so a managed-policy env swap of the target can
   never promote. Byte-transparency, backpressure, and exit/signal propagation are proved by a fake-CLI
   deterministic gate.
6. The snapshot timestamp is an **interval**, not a point: full-init-line received ↔ downstream write
   callback. The interval's END has **one SSOT**: the snapshot event's own envelope `tsMs` — the shim appends
   the event *inside* the downstream write callback, so the single clock read that stamps the line IS the
   callback moment, and the payload carries only `receivedAtMs` (a separate payload end-field would be a
   second SSOT the log door could not hold coherent; GPT review 2026-07-29 — the door enforces
   `receivedAtMs ≤ tsMs`, and the callback *placement* is the review-pinned property). A wire marker inside
   that interval is unordered; only `wire < snapshotReceived` (strict, against the interval's START) reads as
   "after". **And the interval orders the REPORT, not the assembly**: the CLI assembled its name set at some
   unobservable earlier moment, so `wire < snapshotReceived` never upgrades into "the schema was fixed at T" —
   the promoted claim stays "the CLI's per-turn account, received after wire-availability, lacked the id"
   (§11-7-0's ban restated here on purpose).
7. **Promotion floor, and the instrument is part of the roster.** A run's roster entry declares whether the
   snapshot channel was armed (`snapshotInstrumented`); shim-shaped events under an unarmed roster are ignored
   — found evidence never promotes past the declared instrument. Under an armed roster the **control** must
   calibrate: shim boot marker present (a missing shim is the NAMED reason `snapshot-instrument-absent` — the
   managed-policy hijack above looks exactly like this), shim identity intact, channel coherent, and the
   control snapshot containing `expectedProviderToolId` with the fixture call and nonce echo succeeding
   (`snapshot-topology` / `snapshot-calibration` otherwise; all are P0 reasons, because an instrument that
   cannot show presence may not claim absence). Only then may an intervention with snapshot absence of the
   measured id + `promptRanAhead` + no fixture call + wire strictly before the interval + valid topology and
   window read `B-name-snapshot`. **Channel failures on an intervention split by severity, and the split is
   load-bearing (GPT review 2026-07-29):**
   - **structural — the shim's IDENTITY is broken** (no or duplicate boot marker, shim events from several
     pids, a boot target that does not match the roster's expected path+sha, an armed roster with no expected
     identity): the run is **INVALIDATED (`snapshot-topology`)** on BOTH axes. The shim intermediates the CLI
     spawn — it sits on the timing path — so a run that did not execute the calibrated shim did not share the
     pair's launch path, and letting it keep voting on axis (a) would build A/B causal windows out of a
     different stimulus.
   - **reading — the instrument ran but the exactly-one binding failed** (prompt-frame cardinality/ordinal,
     candidate count ≠ 1): the (b) snapshot reading is unavailable (named, `inconclusive`) and axis (a)
     stands — the runner/fixture markers never depended on the binding, and widening a reading failure over
     both axes would repeat the very conflation §11-7-0 undid.
   `mcp_servers.status` is a supporting fact and never a substitute for the name set. **`B` and
   `B-name-snapshot` never mix, in either direction**: a run carrying a runtime `No such tool` stays on the
   runtime ladder (only the exact measured id reads `B` there), and the snapshot ladder is structurally
   unreachable in that case; a snapshot absence alone can never be reported as `B`.
8. **Shim events pass the same log doors as everyone else.** The shim appends to the one shared NDJSON log
   under the same envelope, vocabulary, and stream rules ((runId, pid) sequencing), and every payload field the
   classifier judges on is typed at the door — including interval sanity (`received ≤ forwarded`), because an
   inverted interval would un-order the "after the wire" read while looking healthy. It receives its runId and
   log path via probe-private env vars that are themselves on the condition-4 scrub list.

Its upstream assumptions are load-bearing and order-dependent, so they live in `check-probe-ordering` / the
`probe-ordering` mutant lane as the consuming gate, with `check-acp-sdk-surface` keeping only its own version
facts. One oracle, one consumer binding. `node_modules` can never be a mutant subject, so the subject is a
**tracked inspector** validated against synthetic source fixtures (correct order · `userProvidedOptions`
inverted to win · export absent · suffix list drifted) and then applied to the installed dists. The pinned
set: the `claudeCliPath` export **and its verbatim-env return**, `CLAUDE_CODE_EXECUTABLE` winning over
`...userProvidedOptions` by key order at `acp-agent.js:4083`, the SDK's script-suffix discriminator equal to
the probe's own `SDK_SCRIPT_SUFFIXES`, the `node|bun` default-executable choice, and the piped no-shell spawn
shape.

**Phase 0 status (2026-07-29): the consumer half is BUILT and pushed (`982acad`).** Built offline
and mutant-qualified: the CLI-target precondition seam (`scripts/lib/probe-cli-target.ts` — presence refusal,
resolution asserts incl. regular-file/executable, hash pinning, the exact scrub allowlist), the runner
preconditions (ambient + composed-env refusal with artifact-written refusals, target identity on `run_start`
AND the roster, post-pair drift/unreadable re-hash, and — at that time — the channel pinned unarmed), the shim event vocabulary and
payload doors (envelope-`tsMs` interval end), and the full classifier ladder for `B-name-snapshot`
(calibration, receive-axis single-prompt binding, interval ordering, roster-armed authority, target-identity
verification, structural-vs-reading severity split, non-conflation). A second adversarial cross-review
(2026-07-29, GPT NO-GO round) found and closed four consumer-contract counter-examples — append-axis binding,
a dual-SSOT interval end, an unsplit severity model, and recorded-but-unconsumed target identity — all now
gate-pinned with independent kill-qualified claims.

**Phase 1 status (2026-07-29): the PRODUCER is BUILT and the channel is ARMED.** The shim
is `scripts/fixtures/probe-cli-shim` — extensionless and executable, because the suffix IS the launch-branch
discriminator above, so the instrument has to sit on the same native branch its target is asserted onto — and
it is two lines delegating to `scripts/lib/probe-cli-shim.ts`, the half `tsc`, biome and the mutant lane can
actually reach. Measured rather than assumed while building it: Node 24 with `"type": "module"` spawns an
extensionless shebang file directly (no shell, argv and cwd preserved) and strips types from the imported `.ts`
SSOT; and the SDK writes BOTH control frames and user frames to the CLI's stdin, so the ordinal anchor counts
`type:"user"` frames — counting stdin LINES would break the exactly-one binding on every run.
`scripts/check-probe-cli-shim.ts` drives it as a real process against fake CLIs (no API, no cost) and qualifies
20 claims.

**The channel is ARMED (2026-07-29).** The runner asserts the composed spawn env override-free as
PRODUCTION composed it, and only THEN installs `CLAUDE_CODE_EXECUTABLE=<shim>` plus the three probe-private
vars; inverting those two steps would have the checkpoint inspect the very override the probe just injected, so
the inversion itself is kill-qualified (`RUNNER-ARMING-ORDER`). The shim passes the SAME preconditions as the
target — absolute, native branch, present regular file, executable, hashed — and a refusal writes a named
`precondition-shim-*` classification. Every roster record now declares `snapshotInstrumented: true`, which also
arms the classifier's calibration floor: a run whose shim did not report in, or reported a different
path+sha256, is a structural INVALIDATION rather than an ordinary absence.

Condition 5's "same shim" is a claim about the whole INSTRUMENT, not one file, and the adversarial review of
2026-07-29 is why that is written here: the launcher is a two-line delegate, so what actually runs is a fresh
Node process reading a local module graph, and an edit to the implementation landing between control and an
intervention would be invisible to every other check — the shim's boot marker reports the CLI target, not
itself. The runner therefore pins path+sha256 for the whole static local-import closure before the first run,
records it in the artifact, and re-hashes it after the last: content drift is `shim-runtime-drift`, an
unreadable member is `shim-runtime-unreadable`, and both are their own axis, separate from the CLI target's, so
a stimulus that moved and an instrument that moved are never reported under one name. The closure is not a
second hand-written list either — `check-probe-ordering` derives it from the launcher's and implementation's
static local imports, refuses any mismatch, and refuses a dynamic import outright, since a graph that assembles
itself at runtime cannot be pinned at all. §8d carries eleven runner pins, the lane stands at 83 and the suite
at 99.

**Paired LIVE evidence (2026-07-29, artifact `2026-07-29T05-06-55-529Z`).** After independent process/stream
review and 99/99 mutant qualification, the GLG-approved control + D1=2 s + D2=8 s series completed with
`validity:valid`: the control passed, every run supplied one armed shim boot, and the pinned CLI target and
four-file instrument graph stayed identical. Axis (a) measured `prompt-request-ahead-of-wire` at both delays.
Axis (b) remained `inconclusive`, because both CLI init snapshots arrived **before** the delayed tool list reached
the wire (`snapshot-before-wire`): D1 prompt/newSession were 1681/1755 ms ahead with 2414 ms of turn remaining
after wire; D2 were 7826/7839 ms ahead and wire arrived 3644 ms after turn end. This is not tool-absence evidence
and does not promote to `B-name-snapshot`. It is the calibrated boundary the seam was built to expose: the
instrument is admissible and the reading remains honestly inconclusive. A stronger ground-truth oracle remains
out of reach without the credential proxy already rejected by the ACP Plugin Boundary (see §11-8 D8 for the citation repair).

Honesty carve-outs, carried over from §11-7-a and extended by what Phase 1 measured. Like the fixture's
write-callback timing, the shim's downstream write-callback **placement** is review-pinned, not mutant-proven —
the door's `receivedAtMs ≤ tsMs` rule bounds it, the placement itself lives in source review, and no timing test
can separate it from a placement just outside the callback because the shim pauses its source under
backpressure and thereby couples the read to the write. The **source of that pause** is pinned the same way for
a measured reason: peak RSS was tried as the discriminator and refused, reading 173–217 MiB for the pausing
form against 243–252 MiB for the queueing form on an 8x flood — overlapping ranges dominated by GC timing
rather than by held data, so a threshold there would have bought a flaky gate rather than a proof.

### 11-8. The cortex audit (CP0, 2026-07-29) — measured defects D1–D10 and the landed contract

Everything in this section was **measured** against Cortex Code `1.1.52+200734.789ffffc1c9e` (NixOS,
node 24.18.0) during the CP0 audit of 2026-07-29, cross-reviewed by GPT in the same lane. The version is
provenance, not a pin — GLG's standing decision is that the cortex version stays flexible; what is pinned
is *behavior at spawn time* (D4), never a build number. PR #40's adapter was written against v1.1.8,
eighteen months and a host generation earlier — **the D-numbers below are drift and new defense logic, not
contributor error** (§9-5 of the audit record; the contributor's commit and credit are preserved through
the landing).

| # | measured fact | consequence in the landed adapter |
|---|---|---|
| **D1** | The PR-era overlay claim "hooks are hidden" was false: hooks fire from ⑴ the CLI **install directory** (bundled plugins, §11-6) and ⑵ **`~/.claude/settings.json`** — both outside `SNOWFLAKE_HOME`. | Only HOME isolation reaches ⑵ (see D2); ⑴ is unreachable by any overlay and stays a host fact. |
| **D2** | Cortex reads `CONFIG_DIRS = [".claude", ".cortex"]` at `homedir()` and `~/.claude/skills`; a `SNOWFLAKE_HOME`-only overlay session still advertised the operator's **42 global skills**. `CLAUDE_CONFIG_DIR` occurs **zero times** in the binary — there is no redirect knob to port the claude strategy onto. | The child runs under an **isolated HOME** (dual-HOME overlay). Measured: global-scope skills 0, hook trace 0, bundled/plugin/project surface intact. Explicit cwd **project scope is retained by contract** (`<cwd>/.claude/*` — a sibling in a repo sees that repo's declared surface). |
| **D3** | `CORTEX_HOME` beats `SNOWFLAKE_HOME` in cortex's own resolver (source + E2); a set-but-**empty** value falls through (E2b) while other consumers treat presence as set. One ambient variable bypasses the entire overlay. | The adapter **refuses to spawn when `CORTEX_HOME` is present at all, empty string included** — the same presence-refusal family as the probe's `CLAUDE_CODE_EXECUTABLE` precondition (§11-7-c cond. 1). |
| **D4** | Auto-update runs **on launch** by default and swapped the implementation mid-audit (1.1.47 → 1.1.52). `cortex acp serve --no-auto-update` → exit 1; the global flag position boots an **interactive TUI with exit 0** — protocol corruption an ACP client reads as success. | The overlay authors `"autoUpdate": false` into its own `cortex/settings.json` — a mid-rail self-replacement OFF switch, not a version pin. Launch integrity is fail-loud by construction: a TUI boot cannot answer `initialize`, and the offline gate pins the exact argv. |
| **D5** | The PR passthrough set over- and under-shoots the measured host: `config.toml` / `cortex/skills` **do not exist** there; the whole `cortex/cache` leaks operator `tool_outputs`/`tip_history`; auth succeeds with **`credential_cache` alone** (E3c). | Measured-minimum passthrough (**F**): `connections.toml` + `config.toml` (optional) + `cortex/cache/credential_cache` — symlink-through only. Operator `cortex/mcp.json`, whole-cache, and skills are denied. |
| **D6** | `cortex auth` **does not exist** as a subcommand; auth is cortex's own web-login flow. | No entwurf surface references `cortex auth login`; the smoke skips honestly when the operator has no local auth. Credential boundary SSOT: AGENTS `## ACP Plugin Boundary` + Hard Rule 9. |
| **D7** | The old §4 curation example disagreed with **both** PR head (5 rows incl. `haiku-4-5`) and the live surface (11 authenticated rows, **no** `haiku-4-5`; set-model on it fails loud naming the live set). | Curation is the **GLG-decided 4-row set** (2026-07-29): `cortex-auto`, `cortex-claude-opus-5`, `cortex-claude-sonnet-5`, `cortex-openai-gpt-5.4` — a subset of the live 11; a curated id the running cortex no longer serves fails loud at set-model, **before** the prompt. |
| **D8** | This rail and #48 cited "Hard Rule #8" for the credential boundary — a dead number; the current SSOT is AGENTS **`## ACP Plugin Boundary`** ("entwurf never supplies, copies, proxies, decrypts, or bypasses vendor credentials/subscriptions") + **Hard Rule 9**. | Citations corrected in this cut (§11-7-c carried two). Record kept here so the stale number does not resurrect from older prose. |
| **D9** | Cortex ACP `newSession` reads **only `cwd` and `_meta`** — the wire `mcpServers` param the backend-invariant turn loop passes is **ignored** (source + paired measurement: fixtures never started through it). The real door is **`$SNOWFLAKE_HOME/cortex/mcp.json`** (what `cortex mcp add` writes). Through that door, paired runs (D=0/2 s/6 s) showed `newSession` returning flat (~1.1–1.4 s) while wire-availability trailed by up to ~5.9 s — cortex **launches MCP during newSession but does not await the handshake**. | The adapter **projects** the envelope-enriched explicit `entwurfProvider.mcpServers` into the overlay-private `mcp.json` — exact-authored every spawn, non-stdio entries fail loud BEFORE spawn (never silently dropped). The readiness observation is **hand-client strength** (not `check-probe-ordering`-qualified, one run per cell): cortex inherits the §11-3 race *on this door*; the client-side fence question stays the open §11-7 rail question and is **not** settled by this landing. |
| **D10** | An isolated HOME also cuts `~/.pi/agent` off the bundled bridge: `entwurf_peers` **succeeded** and reported `(none)` while the real store held 133+ citizens — tools reach the model but see an empty garden. | **Dual-HOME**: the `entwurf-bridge` mcp.json entry **alone** carries `HOME=<real operator home>` (captured absolute by the parent pre-spawn, never re-derived in the child). Re-measured 5/5: global skills 0, hooks 0, record-backed peers nonempty, tool call success, teardown reclaimed. |

**The audit's LIVE closure (GLG-approved turns, 2026-07-29).** With dual-HOME + the mcp.json projection:
the model called `mcp__probe-mcp__probe_nonce` (fixture-side receive/reply markers — server-side proof,
not transcript prose), reached `mcp__entwurf-bridge__entwurf_peers` with record-backed rows, saw the
`entwurf_v2` schema in its tool search, and the selected model was enforced live
(`set_config_option("model")` accepted; the value axis, not the model's self-description, was the oracle).
Provider-bound tool naming follows the same `mcp__<server>__<tool>` convention as claude — measured, not
assumed. The permission surface is `session/request_permission` with
`allow/allow_once · always/allow_always · deny/reject_once` options — the repo's existing
`resolvePermissionResponse` policy fits unmodified. **Outbound `entwurf_v2` was deliberately not exercised
in the audit** and is owed to `smoke-acp-cortex-live` (CP2), together with process-group reclaim — an
MCP-configured cortex child does **not** exit on stdin EOF (measured twice), so production's
`killChildGroup` teardown is load-bearing, not hygiene.

**Contract verdicts as landed (the audit's A–F, all GPT-agreed):**

- **A** — containment = **dual-HOME overlay + overlay-private `mcp.json` authorship**, session/child-scoped
  (never a static shared dir; scope id = host pid + session-key hash, exact-rewritten every spawn, dead-pid
  scopes swept). HOME isolation alone was measured insufficient (D10).
- **B** — `CORTEX_HOME` **presence refusal** (D3), empty string included.
- **C** — `autoUpdate: false` authored into the overlay's `cortex/settings.json` (D4).
- **D** — launch verification rides `initialize` fail-loud (a TUI boot answers no ACP request) + the offline
  gate pinning `cortex acp serve` argv exactly.
- **E** — model authority is **per-turn `setSessionConfigOption("model", <native id>)`** — the same wire
  call as claude, measured GO (CP0-M). The launch `-m` pin is retired; `resolveLaunch` never passes `-m`
  (two model authorities would drift silently). "auto" is set explicitly, not left as an unspoken default.
- **F** — the D5 measured-minimum auth passthrough.

**Scope notes carried at their honest strength.**
- "Carrier-less" is narrowed to **system-prompt-carrier-less**: cortex has no `_meta.systemPrompt`, but it
  *does* read `_meta` (`extractCallerSessionId`) — that caller-session-id seam is measured-but-unexplored
  and deliberately **not** part of this contract.
- Still owed, recorded and unclaimed: project-hook firing in a repo that has project hooks; the
  authenticated-vs-not `configOptions` `[mode]`↔`[model]` split's cause; the `_meta` seam's semantics; and
  the rail-level client-side readiness fence (§11-7 owns it — this landing neither fixes nor hides it).

**Verification surfaces of this landing:** `check-acp-cortex` (in `pnpm check`; nine kill-qualified claims
in `scripts/mutants/acp-cortex.json` under `check-gate-qualification`) and the on-demand
`LIVE=1 ENTWURF_ACP_CORTEX_CONNECTION=<conn> ./run.sh smoke-acp-cortex-live` (outbound `entwurf_v2` +
overlay disk facts + process-group reclaim), deliberately **outside** the claude-only LIVE release floor.
