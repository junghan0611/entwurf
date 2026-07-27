# ACP Backend Adapter Rail (표준궤) — as built in 0.12

> **Status: spec frozen + claude rail SHIPPED** (Opus implementation / GPT `…341a87` review GO, 2026-06-25).
> The confirmed spec is **§9** (the adapter seam) + **§10** (the `settings.backend` guard + the generic
> `adapterSettings` seam). The rail is in the tree and unchanged through the 0.12.x hotfix lane.
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
>
> This document is the shipped Claude rail baseline, **not** a current cortex merge plan. Read the historical
> "the only remaining work is…" sentence below as past tense: PR #40 already contains a `cortexAdapter`, and the
> issue tracking it (#48) still assumes a `pi/entwurf-targets.json` spawn allowlist that #50 deleted. Preserve
> the contributor's commits and credit; do not treat any old spawn dependency as authority.
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

## 4. The seam spec (claude as built / cortex as PR #40 demonstrated on 0.11.0)

| seam (adapter method) | claude (shipped, 0.12) | cortex (PR #40) |
|---|---|---|
| **routeModel + curatedModels** | unprefixed `getModels("anthropic")` rows (`claude-sonnet-5`, `claude-opus-5`); native id == curated id | hand-curated `cortex-auto` / `cortex-claude-sonnet-5` (pi-ai has no cortex source); `cortex-` prefix routes via `routeModel`; launch strips the prefix to recover the native `-m` value |
| **resolveAdapterSettings + configSignatureFields** | both no-op (`undefined` / `{}`) — claude has no own settings | parse `cortexConnection` off the raw block → opaque `adapterSettings`; fold `{ cortexConnection: conn ?? null }` into the signature (a connection change invalidates a reused session) |
| **resolveLaunch** | `@agentclientprotocol/claude-agent-acp` npm bin resolve; `CLAUDE_AGENT_ACP_COMMAND` override | `cortex acp serve` resolved from PATH (+ `-c <conn>` `-m <native>`); `CORTEX_ACP_COMMAND` override via `bash -lc`, selection flags appended so the bridge's choice wins |
| **launchEnvDefaults** | `claudeLaunchEnvDefaults()` (`CLAUDE_CONFIG_DIR`) | `SNOWFLAKE_HOME` = overlay, `CORTEX_DISABLE_AUTO_APPLY_PROFILES=1` |
| **ensureOverlay** | `CLAUDE_CONFIG_DIR` whitelist overlay (auth/runtime kept, memory/hooks/projects hidden, `hooks:{}`) | `SNOWFLAKE_HOME` symlink-passthrough (`connections.toml` / `config.toml` / credential cache / skills) + conversations/profiles/memory/mcp.json/hooks hidden + swept each spawn |
| **loadCarrier + buildSessionMeta** | carrier = the shipped engraving (`loadCarrier` → string); `buildSessionMeta` → `_meta.systemPrompt` (short, pure, billing-safe) | **`loadCarrier` → null, `buildSessionMeta` → undefined** — Cortex ACP exposes no `_meta.systemPrompt` carrier, so the operator engraving must ride the first-user augment (the one open detail; see §6 + §9-4) |
| **enforceModel** | per-turn `setSessionConfigOption({ configId: "model" })` | **launch-time `-m` pin, no per-turn switch** — Cortex exposes its model surface via session config options, not the spec-baseline set-model the bridge calls; a per-turn call would trigger spurious reuse invalidation |
| **gates** | `check-acp-*` family + the LIVE `smoke-acp-*-live` floor | EXTEND the same `check-acp-*` family (see §6) + a new on-demand `smoke-acp-cortex-live` (outside the claude-only LIVE release floor) |

**Two asymmetries are the design touchstones:**
1. `loadCarrier` / `buildSessionMeta` must support the **carrier-less case** (cortex). `buildSessionMeta`
   returning `undefined` makes `backend.ts` omit the `_meta` key entirely; `loadCarrier` returning `null` keeps
   the cortex turn from ever touching the shipped-engraving / appendSystemPrompt signature. Rich operator
   context rides the first-user augment regardless of carrier.
2. `enforceModel` absorbs **per-turn vs launch-pin** behind one method. claude calls set-model every turn;
   cortex pins `-m` at launch and is a no-op here. The interface hides that difference so the turn loop stays
   backend-invariant.

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

## 6. Contributor guide — porting PR #40 to 0.12

> **Gate before this section (added 2026-07-27).** §6 is *how* to port, not *when*. The when is §11: the ACP
> Claude citizen smokes must be green on the current pin first, and PR #40's own pending
> `scripts/smoke-acp-cortex-live.ts` must be resolved rather than merged as a fail-loud target.

Porting PR #40 = **write one adapter object (`cortexAdapter`) and register it**. Real namespace =
`pi-extensions/lib/acp/`. Concretely:

- **`pi-extensions/lib/acp/backend-adapter.ts`** — add `cortexAdapter: AcpBackendAdapter` next to `claudeAdapter`
  (or in a sibling module, e.g. `cortex-adapter.ts`, and import it here). Implement all members for the cortex
  column of §4 + §9/§10.
- **Register** by appending to the `ADAPTERS` array (`const ADAPTERS = [claudeAdapter, cortexAdapter]`, `:275`).
  Because `routeModel` owns the `cortex-` prefix, `resolveAcpBackendAdapter` and `allCuratedModels` pick it up
  automatically and fail-fast on any prefix collision or unowned id.
- **Curated models** — add the cortex rows (`cortex-auto`, `cortex-claude-sonnet-5`) in `models.ts` (or a new
  `cortex-models.ts`) and return them from `cortexAdapter.curatedModels()`. Hand-curated, since pi-ai carries no
  cortex/snowflake source. The `cortex-` prefix keeps the ids from colliding with the Claude ids Cortex routes
  to. `resolveLaunch` strips the prefix to recover the native `-m` value (`cortex-auto` → no `-m`).
- **Overlay** — add `ensureCortexConfigOverlay` in `overlay.ts` (or a new `cortex-overlay.ts`): `SNOWFLAKE_HOME`
  symlink-passthrough of auth + skills, hiding conversations/profiles/memory/mcp.json/hooks, swept every spawn.
  Wire it through `cortexAdapter.ensureOverlay` + `launchEnvDefaults` (`SNOWFLAKE_HOME` = overlay,
  `CORTEX_DISABLE_AUTO_APPLY_PROFILES=1`).
- **Backend-owned settings** — parse `cortexConnection` off the raw block in `cortexAdapter.resolveAdapterSettings`
  → opaque `adapterSettings`; fold `{ cortexConnection: conn ?? null }` into `configSignatureFields`. **Do NOT
  edit `config.ts`** — backend-named keys must never reach the common `ResolvedAcpConfig` (§10 B/D). The
  declared `entwurfProvider.backend: "cortex"` already passes the syntactic guard. (PR #40's
  `PI_SHELL_ACP_CORTEX_CONNECTION` env should be renamed to the `ENTWURF_ACP_*` convention.)
- **Identity carrier asymmetry — the one open detail.** `cortexAdapter.buildSessionMeta()` returns `undefined`
  and `loadCarrier()` returns `null` (Cortex ACP has no `_meta.systemPrompt`). The operator engraving must
  therefore ride the first-user augment (`augment.ts`). **Today `augment.ts` carries the bridge identity / pi
  base / AGENTS.md but NOT an operator engraving**, so the cortex PR has to define exactly how the engraving
  joins the augment for a carrier-less backend (§9-4 deferred this). Resolve it explicitly in the PR rather than
  leaving it implicit.
- **Gates — extend the `check-acp-*` family** (the 0.11.0 monolith names `check-backends` / `check-models` do
  not exist in 0.12):
  - `scripts/check-acp-provider-surface.ts` — curated cortex rows + `cortex-` prefix routing + anti-collision.
  - `scripts/check-acp-config.ts` — `backend:"cortex"` passes the syntactic guard; `cortexConnection` lands in
    `adapterSettings` and **never** surfaces on the common config (the fake-adapter seam plumbing already lives
    here).
  - `scripts/check-acp-overlay.ts` — `SNOWFLAKE_HOME` overlay passthrough / state-hiding / per-spawn sweep.
  - `scripts/check-acp-tool-surface.ts` — `cortexAdapter.buildSessionMeta()` is `undefined` → `_meta` omitted.
  - `scripts/check-acp-session-reuse.ts` — adapter wiring through the turn loop + `configSignatureFields`
    (a `cortexConnection` change invalidates a reused session).
  - `scripts/check-acp-carrier-augment.ts` — carrier-less path (loadCarrier null) + engraving via augment.
  - **new:** `scripts/smoke-acp-cortex-live.ts` — on-demand LIVE smoke (needs `cortex` on PATH +
    `cortex auth login`), OUT of `pnpm check` and OUTSIDE the claude-only LIVE release floor. Wire it into
    `run.sh` as its own target (`LIVE=1 ./run.sh smoke-acp-cortex-live`).
- **Do NOT touch the common layer** — `backend.ts` turn loop, `acp-client.ts`, `event-mapper.ts`,
  `session-store.ts`, `config.ts`. That a backend lands in *an adapter file + gates only* IS the proof the rail
  holds. `pnpm check` + `pnpm typecheck` (all three configs) must be EXIT 0.

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
6. **`enforceModel` — single method, no flag.** claude = `setSessionConfigOption`, cortex = no-op + launch-pin.
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
the CLI's own install directory — **not** under `SNOWFLAKE_HOME`. The §4 cortex overlay hides `hooks` by
redirecting `SNOWFLAKE_HOME`, and `CORTEX_DISABLE_AUTO_APPLY_PROFILES=1` governs profiles; neither reaches
bundled plugins. Whether `cortex acp serve` runs the same hook set as the TUI is **unmeasured** — the
observation above is from the interactive surface. Measure it during the audit, and if ACP turns do fire
bundled hooks, the cortex overlay gate must cover them; a broken host hook firing on every turn is session
noise the claude rail deliberately eliminated with `hooks:{}`.

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
| a provider-bound schema snapshot **for this same `runId` and prompt request**, taken *after* `tools_list_response_forwarded`, showing `expectedProviderToolId` absent | equivalent to the direct runtime error | **Yes**, same condition |

Any combination not listed stays **P0 / inconclusive** by default. Note the ②/③ boundary is decided by one
marker, not by reading the error text: a fixture `tools/call` marker means dispatch resolved and execution
failed; a direct no-such-tool claim requires that marker to be **absent**.

**A schema snapshot must be time-closed, or it is a different claim.** The ordering the last row requires is

```text
tools_list_response_forwarded  <  provider-bound schema snapshot for THIS prompt/model request
```

and the snapshot has to be attributed to the same `runId` and prompt request id. A capture taken at an arbitrary
moment after the prompt says nothing — dynamic updates mean the set can change underneath it. Where possible the
snapshot should be the tool-definition set the provider actually handed to the model request, not a
reconstruction.

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
