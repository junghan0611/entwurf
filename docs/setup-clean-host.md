# Clean-host setup walk-through

End-to-end install of **entwurf** on a host with only `git` available — no
node, no pnpm, no pi binary, no dotfiles. The point is to validate the public
install surface as an outside user would experience it.

> **Scope.** This is the entwurf 0.12.0 install recipe. The earlier per-command
> cleanhost evidence dumps (recorded 2026-05-18, pi-shell-acp era) are not
> carried forward here — they live in git history. The command *shape* below is
> the current one; substitute your own host.

`entwurf` is a thin meta-bridge. It does not provide, copy, or mediate any
backend credential — it spawns the official backend CLI and lets it read
whatever auth the user already trusts on the host (AGENTS.md Hard Rule #9).

## Reference target

Written against a clean Ubuntu / Debian / macOS host reachable via SSH, here
called `cleanhost`. `nvm` + `corepack` keep the path identical across them.

```bash
ssh cleanhost 'uname -a; whoami; which git node pnpm pi 2>/dev/null'
# expect: git present, node/pnpm/pi absent
```

## Pin matrix

These pins are the verification axis — drift from them moves you off the
walk-through and onto your own integration.

| Component | Pin | Source of truth |
|---|---|---|
| Node | **24** (LTS line) | `engines.node` is `>=22.6.0` (minimum, for TypeScript strip-types); verification axis is **24** |
| pnpm | **10.33.0** (via corepack) | matches the version entwurf's `pnpm check` chain runs under |
| pi binary | **`@earendil-works/pi-coding-agent` 0.80.2 or newer** | npm registry; binary name `pi`; garden-native session identity needs `--session-id` / `--name` |
| entwurf install path | `npm:@junghanacs/entwurf` (published release path) | the `git:github.com/junghan0611/entwurf` source path remains the alternative for tracking `main` |

## Stage 0 — Node 24 + pnpm via nvm

```bash
ssh cleanhost

# nvm (user-scope, no global root)
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
source ~/.nvm/nvm.sh

# Node 24 explicit — not --lts (re-runnable across calendar drift)
nvm install 24
nvm alias default 24
node -v          # expect: v24.x.y

# pnpm via corepack (user-scope, no -g)
corepack enable
corepack prepare pnpm@10.33.0 --activate
pnpm -v          # expect: 10.33.0
```

Drift points:
- corporate proxy / sudo policy may block `curl | bash`. Fallback: clone `nvm` via git and source `~/.nvm/nvm.sh` directly.
- `corepack enable` needs Node 24's bundled corepack — confirm with `corepack -v` before activate.
- **Subshell trap**: `nvm install 24 | tail` runs the install inside a pipe-subshell, so PATH changes do not reach the parent shell and `node -v` fails right after. Drop the pipe, or follow with an explicit `nvm use 24` in the same shell (the recipe above already does).

## Stage 1 — pi binary

```bash
# global install with the user's nvm shim (no system-wide root)
npm i -g @earendil-works/pi-coding-agent
pi --version     # expect: 0.80.2 or newer

# pi's data dir is created lazily on first run
pi --help | head -5
```

Drift points:
- if `npm i -g` lands outside the nvm shim, `pi` may not be on `$PATH` after a shell reload. `which pi` should resolve under `~/.nvm/versions/node/v24.*/bin/pi`.
- backend ACP server packages (e.g. `claude-agent-acp`) ship as pinned `dependencies` of entwurf and get installed in the next stage — **do not install them globally yourself**.

## Stage 2 — entwurf install (npm path)

Install the bridge from the published npm package. `pi install` lands it under
`~/.pi/agent/npm/node_modules/@junghanacs/entwurf/`, then `run.sh install` wires
it into a target project's `.pi/` directory.

```bash
# package-side install — populates ~/.pi/agent/npm/node_modules/...
pi install npm:@junghanacs/entwurf

# verify the package landed where pi expects it
ls ~/.pi/agent/npm/node_modules/@junghanacs/entwurf/

# project-side wire-up — pick an empty cwd for the smoke
mkdir -p ~/entwurf-smoke
cd ~/entwurf-smoke
~/.pi/agent/npm/node_modules/@junghanacs/entwurf/run.sh install .
```

`run.sh install .` runs the one-shot wiring the consumer-project README
documents: writes `.pi/` config, registers the extensions (provider,
`entwurf-control`, `model-lock`), adds `entwurfProvider.mcpServers.entwurf-bridge`,
and links `~/.pi/agent/entwurf-targets.json` to the package's
`pi/entwurf-targets.json`. Expected log lines:

```
install: added entwurfProvider.mcpServers.entwurf-bridge
install: updated <cwd>/.pi/settings.json
install: package source -> ~/.pi/agent/npm/node_modules/@junghanacs/entwurf
install: linked ~/.pi/agent/entwurf-targets.json -> .../pi/entwurf-targets.json
```

Drift points:
- with no backend credentials yet, `run.sh install .` still completes — it does not validate backend auth, only registers the bridge.
- `~/.pi/agent/npm/...` is fixed by pi's install scanner. Use `pi install -l npm:...` to land it inside the project cwd instead.
- the `git:github.com/junghan0611/entwurf` source path is the alternative for tracking `main` or hacking on the bridge; it clones into `~/.pi/agent/git/...` with the same `run.sh install .` wire-up.
- `pi install` runs `npm install` inside the package; `husky` is dev-only and absent on a target host, so its `prepare` hook silently exits 0.

## Stage 3 — package-surface verification (auth-free)

Proves the bridge is registered and visible to pi, without touching any
backend.

```bash
cd ~/entwurf-smoke

# the entwurf provider should now appear in pi's catalog
pi --list-models entwurf
# expect: curated model ids under provider entwurf
#   (claude-opus-4-8, claude-sonnet-4-6, ...), exit code 0
```

Deterministic gates (no live backend) from the clone:

```bash
cd ~/.pi/agent/git/github.com/junghan0611/entwurf
pnpm install
pnpm typecheck
./run.sh check-bridge                  # MCP tool contract (tools/list + negatives)
./run.sh check-package-source-routing  # install-root resolver, fail-fast routing
# full deterministic floor (longer, ~60 gates): pnpm check
```

Drift points:
- `pi --list-models entwurf` failing here means the install scanner did not register the extension — most often a node engines mismatch or a permission issue under `~/.pi/`. Re-run Stage 2 after fixing.
- the `pnpm install` step may emit an `Ignored build scripts` warning for transitive deps (pnpm refuses postinstall hooks by default). Our surface does not need them; the warning is informational.

## Stage 4 — runtime smoke (backend auth required)

Backend authentication is **the operator's responsibility** and lives entirely
outside entwurf. The 0.12.0 runtime floor is **Claude-first** — the
`smoke-acp-*-live` floor inside `release-gate` exercises the Claude ACP backend
only (there is no standalone per-backend smoke command). Codex reaches the
garden as a native citizen (ACP only via the `ENTWURF_ACP_FOR_CODEX=1` opt-in,
off the live floor); the Gemini path is deprecated.

### Stage 4 prep — Claude CLI install + login

```bash
# Claude — official install script (writes into ~/.local/bin, no sudo).
curl -fsSL https://claude.ai/install.sh | bash
echo 'export PATH="$HOME/.local/bin:$PATH"' >> ~/.bashrc
source ~/.bashrc
which claude && claude --version

# interactive login (opens browser or prints a token-paste URL)
claude login
```

`claude login` writes into Claude's own state directory. entwurf does not
provide, copy, decrypt, or mediate these credentials. If a smoke fails, run the
backend CLI directly first (`claude -p "ping"`); if that also fails, the
missing piece is upstream of entwurf.

> **Codex / Gemini (optional).** `npm i -g @openai/codex` + `codex login` for
> the Codex lane; `npm i -g @google/gemini-cli` + `gemini auth` for the
> deprecated Gemini probe. Neither is on the 0.12.0 live floor — the
> `smoke-acp-*-live` gates run the Claude ACP backend only; Codex/agy delivery
> is captured as raw probes in [DELIVERY.md](../DELIVERY.md).

### Stage 4 prep — interactive setting (optional)

For live interactive use (vs. headless CI), pin tool-progress visibility:

```bash
node -e '
const fs = require("fs");
const path = process.env.HOME + "/entwurf-smoke/.pi/settings.json";
const cur = JSON.parse(fs.readFileSync(path, "utf8"));
cur.entwurfProvider = cur.entwurfProvider || {};
cur.entwurfProvider.showToolNotifications = true;
fs.writeFileSync(path, JSON.stringify(cur, null, 2) + "\n");
'
```

`showToolNotifications` defaults to `true` already; setting it explicitly pins
the value for reproducibility. **No operator config is needed to make tool
calls flow without prompts when a backend is invoked through entwurf** — the
bridge runs the backend YOLO inside its own isolated overlay
(`~/.pi/agent/*-config-overlay/`, AGENTS.md Hard Rule #10), so native backend
config is neither read nor required on the bridged path.

### Stage 4 — runtime smoke

```bash
ENTWURF=~/.pi/agent/git/github.com/junghan0611/entwurf
cd ~/entwurf-smoke

# lightweight: one Claude turn through entwurf (proves auth + bridge round-trip)
pi --provider entwurf --model claude-sonnet-4-6 -p "reply with ok only"

# full live floor (LIVE=1 required): pnpm check + the v2-native live gates
# + the ACP plugin acceptance floor (10 smoke-acp-*-live smokes). Two-tier
# MUST/BEHAVIOR summary; MUST owns the exit code. GLG authorizes the cut.
LIVE=1 $ENTWURF/run.sh release-gate .
```

A passing turn is a full round-trip: bootstrap → ACP session → bridge response
→ clean shutdown.

Drift points:
- a backend you have not authenticated fails loudly with `Authentication required` (Claude/Codex shape) or an early `EPIPE` (Gemini-CLI shape). **That is not an entwurf failure** — the bridge surfaces missing auth, it does not fix it. Add the credential and re-run.
- `release-gate` honest-skips its LIVE-gated MUST steps when `LIVE!=1`; a real cut needs `LIVE=1` with `SKIP=0`.

## Stage 5 — entwurf surface (optional)

> Do not run Stage 5 until at least one authenticated `smoke-*` is green — a
> live entwurf flow drives a real backend turn, so an unauthenticated host just
> re-surfaces the Stage 4 auth noise.

### Package-source ACP routing — auth-free, run this first

Covers the boundary where a package-installed bridge (a `git:` / `npm:`
settings source, not a local checkout) must still resolve so a
`provider=entwurf` child does not die with `Unknown provider`:

```bash
# from the installed bridge root (auth-free, also in pnpm check)
./run.sh check-package-source-routing
```

It pins the package-source → install-root resolver math across the full install
matrix (local / git / npm / missing × local + remote). The live ACP routing
itself is exercised by the `smoke-acp-*-live` floor under `release-gate`.

### Resident control session

To address a long-lived pi session from another session (or an external MCP
host like Claude Code), open it with `--entwurf-control`. A garden-native
`--session-id` is **required** — a raw `pi --entwurf-control` (pi-assigned
uuid) hard-exits at `session_start` before any model turn. Mint the id from the
SSOT:

```bash
pi --session-id "$(/path/to/entwurf/run.sh new-session-id)" \
  --entwurf-control --provider entwurf --model claude-sonnet-4-6
# control socket: ~/.pi/entwurf-control/<sessionId>.sock
```

Inside such a session, builtin `/new` / `/fork` / `/clone` are blocked (they
would mint a non-garden uuid); use `/gnew` (alias `/garden-new`) for a
same-terminal fresh garden session (a zero-token switch into a pre-created
garden file).

The bridge exposes four MCP tools — `entwurf_v2` (canonical dispatch /
delivery verb), `entwurf_peers` (discover live citizens), `entwurf_self`
(identity envelope), `entwurf_inbox_read` (drain meta-bridge inbox). From any
other pi session on the same host, call `entwurf_peers` to list live targets
and `entwurf_v2` to message/hand off by garden id. Dispatch is fire-and-forget
on a live target; set `wants_reply` if you need an answer. See AGENTS.md
`Send-is-throw` for the full rule.

### Native-harness wake (optional)

For an external Claude Code session to receive async messages, install the
meta-bridge plugin globally (Claude Code only):

```bash
./run.sh install-meta-bridge     # plugin + USER-scope entwurf-bridge MCP
./run.sh doctor-meta-bridge      # fail-loud health check
```

## Teardown

The bridge has no daemon. To remove everything installed:

```bash
# entwurf clone
rm -rf ~/.pi/agent/git/github.com/junghan0611/entwurf

# project wiring (per-project)
rm -rf ~/entwurf-smoke/.pi

# meta-bridge plugin (if installed)
~/.pi/agent/git/github.com/junghan0611/entwurf/run.sh uninstall-meta-bridge 2>/dev/null || true

# pi binary
npm uninstall -g @earendil-works/pi-coding-agent

# node + pnpm via nvm
nvm uninstall 24
rm -rf ~/.nvm
```

This walk-through is the **verification floor** underneath every downstream
publish step — install, package surface, and at least one authenticated
runtime smoke green — not the publish trigger itself. GLG owns the publish/tag
decision.
