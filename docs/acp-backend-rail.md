# ACP Backend Adapter Rail (표준궤) — as built in 0.12

> **Status: spec frozen + claude rail SHIPPED + cortex adapter SHIPPED** (claude rail: Opus implementation /
> GPT `…341a87` review GO, 2026-06-25; cortex: PR #40 ported onto the rail on `snowflake-cortex-code-acp-backend`).
> The confirmed spec is **§9** (the adapter seam) + **§10** (the `settings.backend` guard + the generic
> `adapterSettings` seam). The rail is in the tree and unchanged through the 0.12.x hotfix lane.
>
> **Cortex is now the first SHIPPED non-claude adapter on this rail** — it landed exactly as the rail predicted:
> `cortexAdapter` in `pi-extensions/lib/acp/backend-adapter.ts` (registered in `ADAPTERS = [claudeAdapter,
> cortexAdapter]`), a hand-curated cortex model surface (`cortex-auto`, `cortex-claude-opus-4-6`, `cortex-claude-haiku-4-5`, `cortex-claude-sonnet-4-6`, `cortex-openai-gpt-5.2`) in `models.ts`,
> `ensureCortexConfigOverlay` in `overlay.ts`, and a deterministic gate `scripts/check-acp-cortex.ts` wired into
> `pnpm check` (green) + `run.sh`. **The common turn loop was not touched** — cortex added zero to the common
> layer, which is the proof the rail holds.
>
> **Still pending (the one deliverable not yet in the tree):** the on-demand LIVE smoke *script*
> `scripts/smoke-acp-cortex-live.ts` does not exist yet. Its `run.sh` target (`smoke-acp-cortex-live`) is already
> wired and fails loud until the script lands; it is deliberately OUTSIDE the claude-only LIVE release floor
> (capability-dignity invariant #7).
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

Source of truth: `pi-extensions/lib/acp/backend-adapter.ts` (interface at `:136`, `claudeAdapter` reference
implementation at `:215`, `cortexAdapter` at `:316`, registry `ADAPTERS` at `:407`, `resolveAcpBackendAdapter`
at `:419`, `allCuratedModels` at `:439`). This is the **real** shape — it is the §3 draft updated per §9+§10
(two methods added, two signatures fixed):

```ts
export interface AcpBackendAdapter {
  /** Discriminator stored on BridgeSession/configSig so reuse never re-parses the model id. */
  readonly backend: string;                                   // "claude" | "cortex"

  /** Owns modelId? → backend-native id (prefix stripped), else undefined.
   *  cortex-claude-sonnet-4-6 → { nativeModelId: "claude-sonnet-4-6" }. */
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

## 4. The seam spec (claude + cortex both as built on the 0.12 rail)

| seam (adapter method) | claude (shipped, 0.12) | cortex (shipped, PR #40 → 0.12 rail) |
|---|---|---|
| **routeModel + curatedModels** | unprefixed `getModels("anthropic")` rows (`claude-sonnet-5`, `claude-opus-4-8`); native id == curated id | hand-curated `cortex-auto` / `cortex-claude-opus-4-6` / `cortex-claude-haiku-4-5` / `cortex-claude-sonnet-4-6` / `cortex-openai-gpt-5.2` (pi-ai has no cortex source); `cortex-` prefix routes via `routeModel`; launch strips the prefix to recover the native `-m` value |
| **resolveAdapterSettings + configSignatureFields** | both no-op (`undefined` / `{}`) — claude has no own settings | parse `cortexConnection` off the raw block → opaque `adapterSettings`; fold `{ cortexConnection: conn ?? null }` into the signature (a connection change invalidates a reused session) |
| **resolveLaunch** | `@agentclientprotocol/claude-agent-acp` npm bin resolve; `CLAUDE_AGENT_ACP_COMMAND` override | `cortex acp serve` resolved from PATH (+ `-c <conn>` `-m <native>`); `CORTEX_ACP_COMMAND` override via `bash -lc`, selection flags appended so the bridge's choice wins |
| **launchEnvDefaults** | `claudeLaunchEnvDefaults()` (`CLAUDE_CONFIG_DIR`) | `SNOWFLAKE_HOME` = overlay, `CORTEX_DISABLE_AUTO_APPLY_PROFILES=1` |
| **ensureOverlay** | `CLAUDE_CONFIG_DIR` whitelist overlay (auth/runtime kept, memory/hooks/projects hidden, `hooks:{}`) | `SNOWFLAKE_HOME` symlink-passthrough (`connections.toml` / `config.toml` / credential cache / skills) + conversations/profiles/memory/mcp.json/hooks hidden + swept each spawn |
| **loadCarrier + buildSessionMeta** | carrier = the shipped engraving (`loadCarrier` → string); `buildSessionMeta` → `_meta.systemPrompt` (short, pure, billing-safe) | **`loadCarrier` → null, `buildSessionMeta` → undefined** — Cortex ACP exposes no `_meta.systemPrompt` carrier, so the operator engraving must ride the first-user augment (the one open detail; see §6 + §9-4) |
| **enforceModel** | per-turn `setSessionConfigOption({ configId: "model" })` | **launch-time `-m` pin, no per-turn switch** — Cortex exposes its model surface via session config options, not the spec-baseline set-model the bridge calls; a per-turn call would trigger spurious reuse invalidation |
| **gates** | `check-acp-*` family + the LIVE `smoke-acp-*-live` floor | `scripts/check-acp-cortex.ts` (shipped, in `pnpm check`) owns the whole deterministic cortex axis; the on-demand `smoke-acp-cortex-live` target is wired in `run.sh` but its script is still PENDING (outside the claude-only LIVE release floor) |

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

## 6. Contributor guide — how cortex landed on the rail (as built)

PR #40 was ported to 0.12 exactly as this rail predicted: **one adapter object (`cortexAdapter`) + registration +
cortex gate**. Real namespace = `pi-extensions/lib/acp/`. What shipped:

- **`pi-extensions/lib/acp/backend-adapter.ts`** — `cortexAdapter: AcpBackendAdapter` landed inline next to
  `claudeAdapter` (`:316`), implementing every member of the cortex column of §4 + §9/§10.
- **Registered** in the `ADAPTERS` array (`const ADAPTERS = [claudeAdapter, cortexAdapter]`, `:407`). Because
  `routeModel` owns the `cortex-` prefix, `resolveAcpBackendAdapter` and `allCuratedModels` pick it up
  automatically and fail-fast on any prefix collision or unowned id.
- **Curated models** — the cortex rows (`cortex-auto`, `cortex-claude-opus-4-6`, `cortex-claude-haiku-4-5`, `cortex-claude-sonnet-4-6`, `cortex-openai-gpt-5.2`) live in `models.ts`
  (`curatedCortexModels`, `CORTEX_MODEL_PREFIX`, `SUPPORTED_CORTEX_MODEL_IDS`) and are returned from
  `cortexAdapter.curatedModels()`. Hand-curated, since pi-ai carries no cortex/snowflake source. The `cortex-`
  prefix keeps the ids from colliding with the Claude ids Cortex routes to. `resolveLaunch` strips the prefix to
  recover the native `-m` value (`cortex-auto` → no `-m`).
- **Overlay** — `ensureCortexConfigOverlay` (+ `CORTEX_CONFIG_OVERLAY_HOME`, `cortexLaunchEnvDefaults`) landed in
  `overlay.ts`: `SNOWFLAKE_HOME` symlink-passthrough of auth (connections/config/credential cache) + skills,
  hiding conversations/profiles/memory/mcp.json/hooks, swept every spawn. It is wired through
  `cortexAdapter.ensureOverlay` + `launchEnvDefaults` (`SNOWFLAKE_HOME` = overlay,
  `CORTEX_DISABLE_AUTO_APPLY_PROFILES=1`). Auth is **symlinked, never copied** (Hard Rule #8).
- **Backend-owned settings** — `cortexConnection` is parsed off the raw block in
  `cortexAdapter.resolveAdapterSettings` → opaque `adapterSettings`; `{ cortexConnection: conn ?? null }` folds
  into `configSignatureFields`. `config.ts` was **not** edited — backend-named keys never reach the common
  `ResolvedAcpConfig` (§10 B/D). The declared `entwurfProvider.backend: "cortex"` passes the syntactic guard.
- **Identity carrier asymmetry.** `cortexAdapter.buildSessionMeta()` returns `undefined` and `loadCarrier()`
  returns `null` (Cortex ACP has no `_meta.systemPrompt`), so the operator engraving rides the first-user
  augment via the carrier-less path in `augment.ts` (inline operator-engraving override reader for carrier-less
  backends). This was the one open detail in the original port; it is resolved in the tree.
- **Gate — `scripts/check-acp-cortex.ts`** (shipped, in the `pnpm check` aggregate + `run.sh` case dispatch as
  `check-acp-cortex`). It is the deterministic owner of the whole cortex axis: cortex curated rows register
  through the REAL registry path (`allCuratedModels`, no collision), the `cortex-` prefix routes to
  `cortexAdapter`, prefix-strip recovers the native `-m` (`cortex-auto` → no `-m`), the overlay symlinks auth
  through + redirects `SNOWFLAKE_HOME`, and the `CORTEX_ACP_COMMAND` override single-quotes shell-metachar
  tokens. (The 결합 규칙 — source + gate land together — was honored.) The existing `check-acp-config` /
  `-overlay` / `-provider-surface` / `-session-reuse` / `-carrier-augment` gates already carry the shared seam
  plumbing this exercises.
- **STILL PENDING — `scripts/smoke-acp-cortex-live.ts`.** The on-demand LIVE smoke *script* is not yet in the
  tree. Its `run.sh` target (`smoke-acp-cortex-live`, needs `cortex` on PATH + `cortex auth login`) is already
  wired and **fails loud** until the script lands (it is OUT of `pnpm check` and OUTSIDE the claude-only LIVE
  release floor — capability-dignity invariant #7). Authoring that script completes the target.
- **The common layer stayed untouched** — `backend.ts` turn loop, `acp-client.ts`, `event-mapper.ts`,
  `session-store.ts`, `config.ts`. That cortex landed in *an adapter object + one gate* (plus its curated
  surface and overlay) IS the proof the rail holds. `pnpm check` + `pnpm typecheck` (all three configs) are
  EXIT 0.

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
- **Contributor (hvkiefer):** the §6 cortex adapter — one adapter object + registration + cortex gate
  (PR #40 → 0.12). **Done** (adapter + curated surface + overlay + `check-acp-cortex` in the tree; the
  on-demand `smoke-acp-cortex-live` *script* is the one remaining deliverable — target wired, script pending).
- **GPT:** the §7 review → frozen spec. **Done.**

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
   ACP surface only exists once its adapter lands through *this* rail. Cortex (PR #40) is now the first real
   one to land — which is exactly why the rail matters.

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
