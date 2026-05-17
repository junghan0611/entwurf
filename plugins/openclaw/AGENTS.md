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
pi process). This plugin contains *only* the OpenClaw-side glue.

**Current shape (prerelease, this commit):**

- `openclaw.plugin.json` — manifest declaring `providers: ["pi-shell-acp"]`
  and the plugin's configSchema.
- `src/index.ts` — single-file TS stub (migrated from JS 2026-05-16;
  compiled to `dist/index.js` for OpenClaw's `runtimeExtensions` slot).
  Registers the provider, serializes `ctx.messages` into a single prompt
  for `pi -p`, spawns a child `pi` process per turn, and proxies its
  `--mode json` stream back to OpenClaw. Each (b3a) GREEN observation
  from 2026-05-14/15 flowed through this file. Wire artifact, not the
  final shape.
- `README.md`, `AGENTS.md` — user-facing and maintainer-facing docs.

**Target shape after Phase 1.4 ts refactor:**

- `src/provider.ts` — `ProviderPlugin` implementation. Plugin-only path
  (see §Plugin Path).
- `src/provider-catalog.ts` — `staticCatalog` row builder +
  `FALLBACK_MODELS` mirroring the curated pi-shell-acp model set.
- `src/stream/stdio-transport.ts` — child pi spawn + ACP framing.
- `src/stream/identity.ts` — env / control socket fd propagation.
- `src/stream/model-lock.ts` — entwurf identity preservation enforcement.

Until Phase 1.4 lands, the single `src/index.ts` carries all of the above
inline. Treat the target layout as plan, not as missing files.

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

## Entwurf scope

Entwurf (sibling-session orchestration) is a **native pi consumer
capability** — pi exposes it directly as an extension to pi users,
and ACP-backed sessions reach the same capability through
pi-shell-acp's MCP bridge. The OpenClaw plugin path is a third
surface, and it intentionally does **not** carry entwurf:

- The plugin spawns child `pi` processes with `--no-tools
  --no-session --offline`. That cuts off the tool registry, the
  long-lived session that entwurf needs, and outbound calls in one
  step. Entwurf tools are never registered on the OpenClaw side.
- OpenClaw users who need sibling-session topology use OpenClaw's
  own peer system (the same surface that gives them `openclaw`
  peers in normal use). The plugin does not bridge entwurf into
  that surface — that bridging would couple the plugin to a
  host-specific peer model, against root AGENTS.md hard rule #9
  (auth boundary is deployment-surface-agnostic; adapters do not
  bend the bridge around host surfaces).

A future direction question, captured for later (not now):

If a later phase relaxes the spawn flags above and the plugin path
gains a long-lived ACP session, the question becomes whether
entwurf inside that child pi runs as an isolated sibling topology
of its own (option I) or proxies onto OpenClaw's peer system
(option II). Option I keeps the deployment-surface-agnostic
invariant. Option II crosses it. The current policy is I by
default; option II would require explicit OpenClaw-side SDK
support and is not part of any current phase.

## Docker auth boundary (maintainer rule)

This plugin is deployment-surface-agnostic. It spawns a child `pi`
process and lets `pi` (and the official backend CLIs underneath it)
read whatever `~/.claude`, `~/.codex`, etc. are visible in that
process's filesystem. The plugin must never:

- copy backend credentials between filesystems;
- read or rewrite credential files;
- proxy OAuth, emulate Claude Code login, or fabricate auth state;
- treat `dangerouslyForceUnsafeInstall` as a credential-handling
  green light. It is only a security-scan bypass for the install
  step.

When OpenClaw runs in Docker, two operator policies are valid.
The same policy applies independently to each backend the user
wants reachable — Claude, Codex, Gemini:

- **In-container login** (public default): mount a named volume
  for `/home/node/.claude`, `/home/node/.codex`,
  `/home/node/.gemini`; user runs `claude login`, `codex login`,
  and the Gemini auth flow inside the container. Auth never
  crosses the container boundary.
- **Host passthrough** (advanced opt-in, trusted single-user):
  bind-mount the host paths read/write — `~/.claude`, `~/.codex`,
  `~/.gemini` — into the container. Mounting host auth means the
  container is part of the operator's trust boundary. Document,
  do not normalize.

The user-facing README explains both options. The maintainer rule
is that the plugin code does not branch on which option the
operator chose — it does the same thing in both cases, because the
auth state lives in the filesystem, not in plugin logic.

OpenClaw's own compose-default policy (whether `~/.claude:...`,
`~/.codex:...`, `~/.gemini:...` are defaults or advanced options)
is the OpenClaw side's call, not ours. Tracked under "OpenClaw
compose default" in the parent repo's NEXT.md.

## Install layers (Docker host responsibility)

In a Docker deployment, three layers must be present in the image
before this plugin is usable. None of them are this plugin's job
to install — they are the OpenClaw image's responsibility — but
the plugin assumes all three exist at runtime, so they are
documented here for the install agent.

1. **`pi` binary on `PATH`.** The plugin calls `spawn(piBinary,
   args, ...)` with `piBinary` defaulting to `"pi"`. Without `pi`
   in the container's `PATH`, the plugin returns an error event on
   every turn.

2. **`pi-shell-acp` installed against that `pi`.** `pi install
   git:github.com/junghan0611/pi-shell-acp` (or the eventual
   `pi install npm:pi-shell-acp` once Phase 2 publishes) makes the
   bridge runtime available to the child `pi` process. The
   `claude-agent-acp` and `codex-acp` dependencies that pi-shell-acp
   declares come along automatically.

3. **Backend ACP executables.** `claude-agent-acp` resolves from
   the pi-shell-acp package itself (Claude path) and works as long
   as the pi-shell-acp install above succeeded. `codex-acp` and
   `gemini` are currently expected on `PATH` (see Runtime
   Dependencies in the root AGENTS.md). For a Docker image,
   installing them globally (`pnpm add -g @zed-industries/codex-acp
   @google/gemini-cli`) is the simplest reproducible path. A
   pi-shell-acp-side improvement is tracked in NEXT (see
   Cross-repo follow-ups: "Codex resolve fallback") to make this
   more symmetric with Claude — that change moves Codex from
   PATH-only to `require.resolve` first, PATH fallback, the same
   shape Claude uses today.

4. **Pi agent overlay (`~/.pi`).** Two sub-policies, both optional:

   - **4a. Persist runtime state (recommended default).** Mount a
     named volume at `/home/node/.pi`. The child `pi` writes
     backend config overlays, session JSONLs, and cached resolver
     state under `~/.pi/agent/*`; the volume just keeps them
     across container restarts. Without it the overlay is
     regenerated on every cold start.
   - **4b. Host overlay passthrough (advanced opt-in).**
     Bind-mount the host `~/.pi/agent` read-only into the
     container. This gives the child `pi` the operator's skill
     catalog, entwurf registry, and journal index. Same trust
     boundary as host backend-auth passthrough — only for trusted
     single-user deployments where the operator also runs `pi` on
     the host. Public deployments do NOT use 4b.

   The plugin does not touch `~/.pi`. The overlay is generated and
   read entirely inside the child `pi` (by pi-shell-acp running in
   it). 4a is just about whether that overlay survives restarts;
   4b is about whether it starts from the operator's existing
   pi setup. Neither is required for a basic working install.

The plugin itself does not build a Docker image, does not ship a
Dockerfile, and does not assume any specific compose topology. It
only assumes the layers above are present in whatever process
spawns it.

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
