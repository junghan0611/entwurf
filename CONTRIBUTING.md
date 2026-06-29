# Contributing to entwurf

This is a daily-driver bridge. Correctness beats feature breadth. Read this before opening a PR.

## What this repo is

`entwurf` is a **garden-citizen dispatch bridge** — entwurf-core (v2 dispatch) + a meta-bridge + a pi adapter + a **Claude-first ACP plugin** — that lets already-running harnesses address one another by garden id; pi is one adapter, not the subject. The ACP plugin borrows the backend's identity (system prompt preset, model behavior, tool implementations) and shapes the *operating surface* — what tools, MCP, skills, and permissions are visible — to match pi's own policy. Claude is the shipped ACP backend, Codex is a native garden citizen, and the Gemini path is deprecated. That is the entire scope.

If a change moves the bridge toward "second harness" — prompt reconstruction, transcript hydration, ambient discovery, silent fallback — it does not belong here.

## Hard invariants

These are enforced by code, gates, and review. Do not weaken them in a PR; if you want to argue against one, open an issue first.

1. **Bootstrap order**: `resume > load > new`. Always.
2. **Session persistence**: only `pi:<sessionId>` is persisted. `cwd:<cwd>` is never persisted.
3. **MCP injection**: only via `entwurfProvider.mcpServers`. No ambient `~/.mcp.json` scanning, no `~/.claude/settings.json` MCP inheritance.
4. **Operating surface, not config inheritance**: the user's filesystem Claude Code config (`~/.claude/settings.json` hooks, env, plugins, `permissions.defaultMode`) is intentionally *not* inherited. Skills come from `skillPlugins`, permissions from `permissionAllow`, deferred-tool surface from `disallowedTools`. The `CLAUDE_CONFIG_DIR` overlay enforces this even where the SDK reads filesystem independently of `settingSources`.
5. **Backend-specific knobs stay explicit and namespaced**: Codex/Gemini-era ACP knobs are not part of the current Claude-first shipped path. If a future backend lane reintroduces a sandbox or mode knob, it must use the `ENTWURF_ACP_*` namespace and invalid values must throw, never fall back.
6. **Bridge does not implement compaction**: When a backend compacts natively, the pi session and mapping survive that. Pi-side JSONL compaction must not be presented as backend-transcript reduction, and backend-specific compaction controls belong to the backend's own native interface. Legacy `PI_SHELL_ACP_*` compaction knobs must not reappear.
7. **Backend coverage honesty**: changes to operating surface, session lifecycle, or persistence must state which shipped/probed backend surfaces they cover. A claim that silently drops a covered backend is a regression; if one backend is genuinely not covered, record that carve-out explicitly.
8. **This bridge is not a second harness**: no prompt reconstruction, no transcript hydration, no tool result ledger, no Claude Code emulation.

## Required gate before opening a PR

```bash
pnpm check
```

This wraps the entire static-quality surface (biome, tsc, all `check-*` gates including `check-dep-versions`). It is wired into the pre-commit hook (`.husky/pre-commit`), so a clean local commit is the first sign your change holds.

For changes that touch backend launch, session lifecycle, or `_meta` shape, also run:

```bash
./run.sh smoke-all /path/to/your-fixture-project
./run.sh verify-resume /path/to/your-fixture-project
```

These need a real ACP subprocess, so they stay manual — the hook does not run them.

## What gets PRs rejected

- adds ambient MCP discovery (project `.mcp.json`, `~/.mcp.json`, etc.) without an explicit `entwurfProvider.mcpServers` opt-in path
- inherits user / project / local backend config by default (i.e. flips `settingSources` away from `[]`, drops the `CLAUDE_CONFIG_DIR` overlay, removes the codex `-c` config flags)
- weakens `resume > load > new` (e.g. silently downgrading to `new` without a logged invalidation reason)
- introduces `console.warn` / silent fallback where the bridge should `throw` (see `AGENTS.md` "Never warn. Throw.")
- changes the Claude, Codex, or Gemini operating surface (tools, skills, MCP, permissions, sandbox) without accounting for all three backends or recording an explicit carve-out
- adds a second transcript ledger, a prompt reconstruction layer, or any state that competes with pi's session as the source of truth
- skews version pins across `package.json`, `run.sh`, and `README.md` (the `check-dep-versions` gate catches this; if it complains, fix all three)

## Style and code shape

- Read `AGENTS.md` for the full code-shape rules. Highlights:
  - fail-fast: throw on bad config, never warn-and-continue
  - no `try/catch` swallowing — `catch {}` is allowed only for environment probing
  - send-is-throw — messages aren't awaited
  - one surface name (`entwurf`)
- Comments explain *why*, not *what*. Reach for them at non-obvious decisions, especially around SDK / claude-agent-acp / codex-rs interaction edges that future maintainers won't know to look up.
- Keep changes single-responsibility per commit; bundling a refactor with a behavior change makes review and bisect painful.

## When in doubt

Open an issue describing the backend boundary you want to touch and the failure mode you observed. The repo is small; over-coordination is cheap, regression on a daily-driver tool is expensive.
