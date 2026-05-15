# plugins/openclaw — Maintainer Notes

This file applies to work under `plugins/openclaw/` in the
[`pi-shell-acp` repo](https://github.com/junghan0611/pi-shell-acp).

> History: this code was first cut as `extensions/pi-shell-acp/` in
> the OpenClaw lab (`~/repos/3rd/openclaw/`) for (b3a) end-to-end
> validation (2026-05-14 ~ 15). After 6-axis GREEN + 5.12 baseline
> GREEN, GLG decided to host the plugin canonically here in
> `pi-shell-acp` as a monorepo sibling. The OpenClaw lab scaffold
> is retired.

## Canonical Owner

- **Authoritative repo**: https://github.com/junghan0611/pi-shell-acp
- **Plugin npm name**: `@junghan0611/openclaw-pi-shell-acp` (publish path
  reserved; prerelease phase does NOT publish to npm).
- **Position**: host adapter — surfaces `pi-shell-acp` as a first-class
  OpenClaw provider. The bridge logic, identity envelope protocol, ACP
  carriers, model curation, and entwurf orchestration live in the root
  package of this same repo — not in this plugin.
- **Change pin**: stdio ACP transport / `PI_SESSION_ID` · `PI_AGENT_ID` env
  protocol / control socket fd lifecycle / entwurf identity envelope /
  model-lock contract / `~/.pi/agent/entwurf-targets.json` registry format
  all evolve in `pi-shell-acp`. This extension follows the upstream
  release pin and re-exports the wire-compatible shape.

## Purpose

OpenClaw treats `pi-shell-acp/<model-id>` as a regular pi provider. The
real bridge runtime is the `pi-shell-acp` package (consumed via the
`pi-coding-agent` `ExtensionAPI.registerProvider` slot inside the child
pi process). This extension contains *only* the OpenClaw-side glue:

- `openclaw.plugin.json` — manifest declaring `providers: ["pi-shell-acp"]`
  and the plugin's configSchema.
- `provider.ts` — `ProviderPlugin` implementation. Plugin-only path (see
  §Plugin Path).
- `provider-catalog.ts` — `staticCatalog` row builder + `FALLBACK_MODELS`
  mirroring the curated pi-shell-acp model set.
- `stream/stdio-transport.ts` — child pi spawn + ACP framing.
- `stream/identity.ts` — env / control socket fd propagation.
- `stream/model-lock.ts` — entwurf identity preservation enforcement.

## Plugin Path (not config path)

`pi-shell-acp` models are surfaced **only** via the plugin's dynamic
resolution path. Reasons (see also `model.inline-provider.ts:34-50` and
`config/types.models.ts:9-19`):

- `MODEL_APIS` (the OpenClaw config-schema enum) does **not** include
  `pi-shell-acp` and a static `cfg.models.providers["pi-shell-acp"]`
  declaration is rejected by Zod at config load.
- `normalizeResolvedTransportApi()` re-applies the same allowlist at
  runtime resolution; unknown values are stripped to `undefined` and
  fall back to `openai-responses`.
- The plugin **bypasses both gates** by going through
  `resolveDynamicModel(ctx)` and `createStreamFn(ctx)`. The model object
  retains `api: "pi-shell-acp"` through the chain and reaches
  `provider-stream.ts:39 ensureCustomApiRegistered(model.api, streamFn)`
  where pi-ai's dynamic registry accepts the literal string.

Users must therefore not declare `pi-shell-acp` in `models.providers`
configuration. Selecting `pi-shell-acp/<model-id>` in the picker is the
only supported entry point.

## Boundary with OpenClaw's `extensions/acpx/`

- `plugins/openclaw/` (this) = **pi provider native**. Plugin runs
  in-process inside OpenClaw, model dispatch goes through pi-ai's
  stream registry. Identity envelope flows through child env
  (`PI_SESSION_ID`, `PI_AGENT_ID`) and control socket fd.
- `extensions/acpx/` (OpenClaw side) = **external ACP runner**.
  Wraps the published `acpx` package and spawns arbitrary ACP
  servers (Claude / Codex / Gemini / OpenCode CLIs). Separate
  plugin, separate transport.
- The two are not migration paths for each other. Short-term they
  coexist.

## Configuration Knobs

Two policy axes live in this plugin's `configSchema`:

- `mcpInjection`: `"self"` (default) | `"openclaw-bridge"` | `"both"`.
  Controls whether the OpenClaw `pluginToolsMcpBridge` /
  `openClawToolsMcpBridge` MCP servers are injected into the child pi
  session. Default `"self"` because the child pi binary owns its own
  `pi-tools-bridge` catalog and double injection would cause envelope
  mismatch.
- `lockConflictPolicy`: `"strict"` (default) | `"new-session"`.
  Controls behavior when `entwurf_resume` receives a model that
  conflicts with the session's anchored model. `"strict"` enforces
  pi-shell-acp's identity preservation (fail-fast with a user-visible
  notice); `"new-session"` automatically forks a fresh entwurf session.

Neither knob requires OpenClaw core changes.

## Local Runtime Validation

When this plugin changes:

1. From the repo root: `pnpm install` (pnpm workspace will pick up
   `plugins/openclaw/` via `packages: ["plugins/*"]`).
2. Manual install for Oracle / lab — see `README.md` install section.
   Short version: `openclaw plugins install $(pwd) --dangerously-force-unsafe-install`
   (prerelease only; flag goes away after ClawHub trust path).
3. `node openclaw.mjs models list --provider pi-shell-acp --json` to
   verify staticCatalog rows surface.
4. For live ACP smoke, ensure `pi` binary is on `PATH`.

## Lockfile Notes

- The pi-shell-acp repo's `pnpm-lock.yaml` (root) covers this plugin
  via the workspace.
- The plugin's runtime ACP backends (`@agentclientprotocol/claude-agent-acp`,
  `@zed-industries/codex-acp`, `@google/gemini-cli`) are pinned to the
  same versions as the root `package.json` (currently `0.33.1`, `0.14.0`,
  PATH runtime). Bump together.

## Direct Binary Policy

- The plugin spawns a child `pi` binary for each ACP turn. Prefer the
  user-installed `pi` binary on `PATH`; do not bundle one in this
  plugin.
- If the `pi` binary is missing the plugin MUST surface a clear
  error rather than fall back to a different backend.
