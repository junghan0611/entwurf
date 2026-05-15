# openclaw-pi-shell-acp

OpenClaw plugin that adds a `pi-shell-acp` provider — an ACP bridge
to Claude Code, Codex, and Gemini CLI backends, using your own
locally authenticated credentials.

> **Status: prerelease.** Manual install only. Not published to npm
> or ClawHub yet. Treat this as a development artifact, not a
> released package.

## What it does

Adds a single new provider, `pi-shell-acp`, to your OpenClaw setup.
Models appear in the picker as:

- `pi-shell-acp/claude-sonnet-4-6`
- `pi-shell-acp/gpt-5.4`
- `pi-shell-acp/gemini-3.1-pro-preview`

Each model routes through the ACP backend of your choice (Claude,
Codex, or Gemini) using credentials you have already set up locally
for those tools.

## What it is not

- Not a credential reseller. Uses your own existing local auth.
- Not a Claude Code / Codex / Gemini emulator. Each backend keeps
  its own model, API, and tool semantics.
- Not an acpx fork. It is an alternative install path for users who
  want OpenClaw to talk to ACP backends through a different bridge.
- Not a subscription multiplexer. No shared auth, no proxy.

## Requirements

- OpenClaw `>=2026.5.12 <2026.6.0`.
- Locally authenticated Claude Code / Codex / Gemini CLI (one or
  more), each through their own normal auth flow.
- `pi` binary on `PATH` (this plugin spawns a child `pi` process per
  turn to handle ACP framing).

## Install (manual, prerelease)

This plugin is currently distributed only as source from this
repository. Public install (`openclaw plugins install <pkg>`) will
come later; for now:

```bash
# 1. Clone the parent repo somewhere local.
git clone https://github.com/junghan0611/pi-shell-acp.git
cd pi-shell-acp/plugins/openclaw

# 2. Manual install into OpenClaw's extensions directory.
node /path/to/openclaw.mjs plugins install "$(pwd)" \
  --dangerously-force-unsafe-install
```

The `--dangerously-force-unsafe-install` flag is required during
prerelease because OpenClaw's `install-security-scan.runtime.ts`
rejects extensions that use `child_process` unless they come from a
trusted source (ClawHub registration or marketplace). Once this
plugin lands on ClawHub, the flag goes away. **Do not use this
flag for arbitrary third-party plugins.**

After install:

```bash
node /path/to/openclaw.mjs plugins list --json
# Look for "pi-shell-acp" with status "loaded".

node /path/to/openclaw.mjs models list --provider pi-shell-acp --json
# Should show the three models above.
```

Recommended `openclaw.json` hygiene:

```json
{
  "plugins": {
    "allow": ["pi-shell-acp"]
  }
}
```

Without an explicit `plugins.allow`, OpenClaw will print a startup
warning about non-bundled plugins auto-loading.

## Configuration

The plugin exposes five configuration keys (see
`openclaw.plugin.json` for full schema):

| Key | Default | Effect |
|---|---|---|
| `mcpInjection` | `"self"` | Who owns MCP server registration in the child `pi` session. `self` lets the child attach its own `pi-tools-bridge`. Other values are rarely needed. |
| `lockConflictPolicy` | `"strict"` | What happens when `entwurf_resume` receives a model that differs from the anchored model. `strict` refuses; `new-session` forks. |
| `piBinaryPath` | first `pi` on `PATH` | Override path to the `pi` binary. |
| `entwurfTargetsPath` | `~/.pi/agent/entwurf-targets.json` | Override the entwurf-targets registry path. |
| `spawnTimeoutSeconds` | `60` | Max wait for ACP bootstrap. |

## Limitations (prerelease)

- Manual install only; no `openclaw plugins install <pkg>` yet.
- Requires `--dangerously-force-unsafe-install` until ClawHub
  registration.
- Tool dispatch ergonomics are still evolving — the child `pi`
  binary owns its own tool surface; OpenClaw-side tool routing
  for ACP backends is being tuned.
- Tested under Sonnet against the OpenClaw `2026.5.12` baseline.
  Other models work but are less exercised.

## Boundary statement

This plugin connects OpenClaw to locally authenticated ACP backends
through an explicit bridge. It does not patch OpenClaw core, does
not bypass authentication, does not restore hidden transcripts,
and does not resell access to any frontier model provider. If you
do not have your own working install of Claude Code / Codex /
Gemini CLI, this plugin will not give you one.

## Issues

File issues at <https://github.com/junghan0611/pi-shell-acp/issues>.
Mention `[openclaw plugin]` in the title.

## License

MIT.
