# Clean-host setup walk-through

End-to-end install of pi-shell-acp on a host with **only `git` available** —
no node, no pnpm, no pi binary, no dotfiles. The point is to validate the
public install surface as an outside user would experience it.

> **Status (2026-05-18 KST, cleanhost):**
> - **Stages 0–3 — install / package surface — verified**. Live command
>   output recorded inline.
> - **Stage 4a — missing-auth boundary — verified**. The shape the bridge
>   surfaces when no backend CLI / credential is present (recorded inline).
> - **Stage 4 prep — pi-shell-acp settings + standalone backend YOLO —
>   verified**. `showToolNotifications: true` for interactive use;
>   `~/.claude/settings.json` / `~/.codex/config.toml` /
>   `~/.gemini/settings.json` merged for standalone-CLI YOLO parity.
> - **Stage 4b — authenticated runtime smoke — verified**. `smoke-claude`
>   (claude-sonnet-4-6), `smoke-codex` (gpt-5.4), `smoke-gemini`
>   (gemini-3.1-pro-preview), and `smoke-all` all exited 0 — full
>   bootstrap → ACP session → bridge response → bridge prompt → clean
>   shutdown round-trip green on every backend.
> - **Stage 5 — entwurf two-session surface — still deferred**. Optional
>   next round; not on the publish-prep critical path.

## Reference target

The walk-through is written against a clean Ubuntu 6.8 x86_64 dev host
(user `operator`, home `/home/operator`) reachable via SSH and referred
to throughout this document as `cleanhost`. Specific FQDN, SSH port, and
operator account are intentionally omitted — the host is a placeholder
for any Ubuntu / Debian / macOS clean install; `nvm` and `corepack` keep
the path identical across them.

Probe before starting:

```bash
ssh cleanhost 'uname -a; whoami; pwd; which git node pnpm pi 2>/dev/null'
# expect: git present, node/pnpm/pi absent
```

## Pin matrix

These pins are the verification axis — drift from them moves you off the
walk-through and onto your own integration.

| Component | Pin | Source of truth |
|---|---|---|
| Node | **24** (LTS line) | `engines.node` in `pi-shell-acp/package.json` is `>=22.6.0` (minimum); `@earendil-works/pi-coding-agent` engines is `>=22.19.0`; verification axis is **24** |
| pnpm | **10.33.0** (via corepack) | matches the version pi-shell-acp's `pnpm check` chain runs under locally |
| pi binary | **`@earendil-works/pi-coding-agent`** (npm latest at the time of this draft: 0.75.1) | npm registry; binary name `pi` |
| pi-shell-acp install path | `git:github.com/junghan0611/pi-shell-acp` | repo URL; **independent of the future npm scope `@junghanacs/pi-shell-acp` decided 2026-05-18** — git path stays the same |

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

Expected drift points:
- corporate proxy / sudo policy may block `curl | bash`. Fallback: clone `nvm`
  via git, source from `~/.nvm/nvm.sh` directly.
- `corepack enable` needs Node 24's bundled corepack — confirm with
  `corepack -v` before activate.
- **Subshell trap**: `nvm install 24 | tail -10` runs the install inside a
  pipe-subshell, so the PATH changes do not reach the parent shell and
  `node -v` immediately after fails with `command not found`. Either drop
  the pipe on `nvm install`, or follow it with an explicit `nvm use 24`
  in the same shell. The recipe above already follows the latter pattern.

> **Verified 2026-05-18 @ cleanhost** (Ubuntu 6.8 x86_64, user `operator`):
>
> ```
> v24.15.0 is already installed.
> Now using node v24.15.0 (npm v11.12.1)
> default -> 24 (-> v24.15.0 *)
> === verify node 24 ===
> v24.15.0
> 11.12.1
> /home/operator/.nvm/versions/node/v24.15.0/bin/node
> === pnpm via corepack ===
> Preparing pnpm@10.33.0 for immediate activation...
> pnpm: 10.33.0
> /home/operator/.nvm/versions/node/v24.15.0/bin/pnpm
> ```

## Stage 1 — pi binary

```bash
# global install with the user's nvm shim (no system-wide root)
npm i -g @earendil-works/pi-coding-agent
pi --version     # expect: 0.75.x or newer

# pi's data dir is created lazily on first run
pi --help | head -5
```

Expected drift points:
- if `npm i -g` lands outside the nvm shim, `pi` may not be on `$PATH` after
  the shell reload. `which pi` should resolve under `~/.nvm/versions/node/v24.*/bin/pi`.
- backend ACP server packages (`@agentclientprotocol/claude-agent-acp`,
  `@zed-industries/codex-acp`) ship as pinned `dependencies` of
  `pi-shell-acp` and get installed in the next stage — **do not install them
  globally yourself**.

> **Verified 2026-05-18 @ cleanhost**:
>
> ```
> added 124 packages in 3s
> /home/operator/.nvm/versions/node/v24.15.0/bin/pi
> 0.75.1
> ```
>
> npm emits a single deprecation note (`node-domexception@1.0.0`, transitive
> dep — not in our hand) and a `New minor version of npm available!` notice;
> both are cosmetic.

## Stage 2 — pi-shell-acp install (git path)

Install the bridge from GitHub directly. `pi install` clones into
`~/.pi/agent/git/github.com/junghan0611/pi-shell-acp/`, then `run.sh install`
wires it into a target project's `.pi/` directory.

```bash
# clone-side install — populates ~/.pi/agent/git/...
pi install git:github.com/junghan0611/pi-shell-acp

# verify the clone landed where pi expects it
ls ~/.pi/agent/git/github.com/junghan0611/pi-shell-acp/

# project-side wire-up — pick an empty cwd for the smoke
mkdir -p ~/pi-shell-acp-smoke
cd ~/pi-shell-acp-smoke
~/.pi/agent/git/github.com/junghan0611/pi-shell-acp/run.sh install .
```

`run.sh install .` runs the same one-shot wiring that the consumer-project
README documents: writes `.pi/` config, registers the four extensions
(`provider`, `entwurf`, `entwurf-control`, `model-lock`), and surfaces the
provider id `pi-shell-acp`.

Expected drift points:
- if the target host has no Anthropic / OpenAI / Google credentials yet,
  `run.sh install .` itself should still complete — it does not validate
  backend auth, only registers the bridge.
- `~/.pi/agent/git/...` is fixed by pi's install scanner. Override with
  `pi install -l git:...` if you want it inside the project cwd
  (`./.pi/git/...`) instead.
- `pi install` runs `npm install` inside the clone, which fires our
  `prepare` script (`husky || true`). On the target host `husky` is not
  present, so the script reports `sh: 1: husky: not found` and exits 0
  via the `|| true` guard. This is intentional — `husky` is a dev-only
  hook installer and has no runtime role in the installed package.
- `npm audit` reports `3 moderate severity vulnerabilities` against
  transitive deps; nothing in the bridge surface itself.

> **Verified 2026-05-18 @ cleanhost**:
>
> ```
> === pi install git: ===
> Cloning into '/home/operator/.pi/agent/git/github.com/junghan0611/pi-shell-acp'...
> > pi-shell-acp@0.6.0 prepare
> > husky || true
> sh: 1: husky: not found
> added 103 packages, and audited 104 packages in 5s
> Installed git:github.com/junghan0611/pi-shell-acp
>
> === run.sh install . ===
> install: added piShellAcpProvider.mcpServers.pi-tools-bridge
> install: updated /home/operator/pi-shell-acp-smoke/.pi/settings.json
> install: package source -> /home/operator/.pi/agent/git/github.com/junghan0611/pi-shell-acp
> install: linked /home/operator/.pi/agent/entwurf-targets.json -> /home/operator/.pi/agent/git/github.com/junghan0611/pi-shell-acp/pi/entwurf-targets.json
> ```

## Stage 3 — package-surface verification (auth-free)

This stage proves the bridge is registered and visible to pi, without
touching any backend.

```bash
cd ~/pi-shell-acp-smoke

# the pi-shell-acp provider should now appear in pi's catalog
pi --list-models pi-shell-acp

# expect: a list of model ids under provider pi-shell-acp —
#   claude-opus-4-7, claude-sonnet-4-6, gpt-5.4, gpt-5.5, gemini-3-pro-preview, ...
# exit code 0
```

Three deterministic gates (no live backend needed) you can run from
the clone to confirm the bridge code itself is sane:

```bash
cd ~/.pi/agent/git/github.com/junghan0611/pi-shell-acp
pnpm install
pnpm typecheck
./run.sh check-mcp           # 15 assertions
./run.sh check-models        # curated surface + Claude defaults + Codex + Gemini
```

Expected drift points:
- `pi --list-models pi-shell-acp` failing here means the install scanner did
  not register the extension — most often a node engines mismatch or a
  permission issue under `~/.pi/`. Re-run `Stage 2` after fixing.
- the `pnpm install` step inside the clone emits a `Ignored build scripts:
  koffi@2.16.1, protobufjs@7.5.5` warning. These are postinstall hooks of
  transitive deps; pnpm refuses to run them by default for security. Our
  surface does not need them, so the warning is informational.

> **Verified 2026-05-18 @ cleanhost**:
>
> ```
> === pi --list-models pi-shell-acp ===
> provider      model                   context  max-out  thinking  images
> pi-shell-acp  claude-opus-4-7         1M       128K     yes       yes
> pi-shell-acp  claude-sonnet-4-6       200K     64K      yes       yes
> pi-shell-acp  gemini-3.1-pro-preview  1.0M     65.5K    yes       yes
> pi-shell-acp  gpt-5.4                 272K     128K     yes       yes
> pi-shell-acp  gpt-5.4-mini            272K     128K     yes       yes
> pi-shell-acp  gpt-5.5                 272K     128K     yes       yes
>
> === deterministic gates ===
> Done in 6.2s using pnpm v10.33.0
> tsc --noEmit && tsc -p mcp/tsconfig.json && tsc -p scripts/tsconfig.json   (silent — green)
> [check-mcp]      15 assertions ok
> [check-models]   3 passes ok (curated + ctx override + bogus fallback)
> [check-backends] 136 assertions ok
> ```
>
> 6 models exposed in the curated surface on this baseline; all four
> auth-free gates (typecheck + check-mcp + check-models + check-backends)
> green from a clean clone.

## Stage 4 — runtime smoke (backend auth required)

Backend authentication is **the operator's responsibility** and lives
entirely outside pi-shell-acp. The bridge spawns the official backend CLI
and lets it read whatever auth state the user already trusts on this host.
This stage has two halves: install the backend CLIs you intend to use
(Stage 4a / 4b prep — anyone can run), then log into each (operator-only).

### Stage 4 prep — backend CLI install

Each backend ships its own CLI. Install only the ones you intend to
authenticate; pi-shell-acp is happy with any single backend.

```bash
# Claude — official install script (writes into the user's home, no sudo).
# The script lands in ~/.local/bin but does NOT touch ~/.bashrc on Ubuntu,
# so add the dir to PATH once and re-source. (Skip if your shell already
# has ~/.local/bin on PATH from a previous tool.)
curl -fsSL https://claude.ai/install.sh | bash
echo 'export PATH="$HOME/.local/bin:$PATH"' >> ~/.bashrc
source ~/.bashrc

# Codex — npm (under the nvm shim from Stage 0)
npm i -g @openai/codex

# Gemini — npm
npm i -g @google/gemini-cli
```

Verify each one lands on PATH:

```bash
which claude codex gemini
claude --version
codex --version
gemini --version
```

> **Verified 2026-05-18 @ cleanhost**:
>
> ```
> /home/operator/.local/bin/claude
> /home/operator/.nvm/versions/node/v24.15.0/bin/codex
> /home/operator/.nvm/versions/node/v24.15.0/bin/gemini
> ```
>
> Claude install.sh writes only to `~/.local/bin` — the PATH export above
> is what makes `which claude` resolve on a vanilla Ubuntu account. Codex
> and Gemini land under the nvm shim because that is the active npm
> prefix; no global `sudo` is involved on any of the three.

### Stage 4 prep — backend login (operator-only)

Authentication state is per-host and per-user. Run each CLI's login flow
once on this host; pi-shell-acp inherits whatever credentials these CLIs
store on disk.

```bash
# Claude — interactive login (opens browser or prints a token-paste URL)
claude login

# Codex — official flow; check `codex login --help` if the prompt is unfamiliar
codex login

# Gemini — interactive auth flow
gemini auth
```

These flows write into each backend's own state directory (e.g.
`~/.local/share/claude/` or `~/.config/claude/`, `~/.codex/`, `~/.gemini/`).
**pi-shell-acp does not provide, copy, decrypt, or otherwise mediate these
credentials** — see AGENTS.md Hard Rule #9. If you ever wonder whether a
smoke failure is an auth issue or a bridge issue, run the backend CLI
directly first (e.g. `claude -p "ping"`); if that fails too, the missing
piece is upstream of us.

> **Verified 2026-05-18 @ cleanhost**: login commands above are the actual
> shapes the three CLIs use (`claude login` — no slash, `codex login`,
> `gemini auth`). Login outputs themselves are operator-private and not
> recorded here.

### Stage 4 prep — required pi-shell-acp settings

The bridge's defaults are tuned for headless / non-interactive
operation — fine for CI, awkward for live use. For a normal interactive
session on this host you want **one** explicit setting on top of
`run.sh install .`:

```bash
node -e '
const fs = require("fs");
const path = process.env.HOME + "/pi-shell-acp-smoke/.pi/settings.json";
const cur = JSON.parse(fs.readFileSync(path, "utf8"));
cur.piShellAcpProvider = cur.piShellAcpProvider || {};
cur.piShellAcpProvider.showToolNotifications = true;
fs.writeFileSync(path, JSON.stringify(cur, null, 2) + "\n");
console.log(fs.readFileSync(path, "utf8"));
'
```

Why: `showToolNotifications` defaults to `true` since 0.7.0
(`index.ts:621`). Setting it explicitly here pins the value for this
walk-through's reproducibility — `pi install` does not write the key,
so a project's `.pi/settings.json` does not carry it forward unless
the operator (or this snippet) writes it. Without progress visibility
a watching operator sees long idle stretches with no signal, the same
surface our top-bug investigation flagged earlier (NEXT.md
`Cross-repo follow-ups`). The PM-agreed posture is `true` for
interactive / debugging / real work; leave filtering to delivery-layer
surfaces (plugins / bots) instead of flipping this flag.

Other piShellAcpProvider keys you might see on a developer machine
(`appendSystemPrompt`, `skillPlugins`, custom `permissionAllow`,
`compaction.enabled`, etc.) are **not** required for clean-host use.
In particular:

- `permissionAllow` defaults to `["Read(*)", "Bash(*)", "Edit(*)",
  "Write(*)", "mcp__*"]` (acp-bridge.ts) — pi-shell-acp's Claude side
  is already YOLO without any operator config.
- `PI_SHELL_ACP_CODEX_MODE` defaults to `"full-access"`
  (`approval_policy=never` + `sandbox_mode=danger-full-access`) — the
  Codex side is YOLO without env tuning.
- The Gemini side is gated by a hardcoded `tools.core` allowlist + admin
  policy in the overlay, so it operates within a deliberately fixed
  YOLO surface.

So as long as a backend is invoked **through pi-shell-acp**, you do
**not** need to add anything to make tool calls flow without prompts.

> **Verified 2026-05-18 @ cleanhost**:
>
> ```json
> {
>   "packages": [
>     "/home/operator/.pi/agent/git/github.com/junghan0611/pi-shell-acp"
>   ],
>   "piShellAcpProvider": {
>     "mcpServers": {
>       "pi-tools-bridge": {
>         "command": "/home/operator/.pi/agent/git/github.com/junghan0611/pi-shell-acp/mcp/pi-tools-bridge/start.sh",
>         "args": []
>       }
>     },
>     "showToolNotifications": true
>   }
> }
> ```

### Stage 4 prep — standalone backend YOLO (optional)

The previous sub-section covers **pi-shell-acp through usage**. If you
also call the backend CLIs **directly** on this host (e.g. `claude -p
"..."`, `codex exec ...`, `gemini -p "..."` outside any pi session),
each backend has its own native config that decides whether tool calls
require interactive approval. Set them to YOLO once so the standalone
path matches the bridged path.

This is optional. Skip it if you only use the backends through
pi-shell-acp (the bridge already runs them YOLO inside its own overlay).

```bash
# Claude — merge into ~/.claude/settings.json
node -e '
const fs = require("fs");
const path = process.env.HOME + "/.claude/settings.json";
const cur = fs.existsSync(path) ? JSON.parse(fs.readFileSync(path, "utf8")) : {};
cur.permissions = cur.permissions || {};
cur.permissions.allow = [
  "Bash(*)","Read(*)","Write(*)","Edit(*)",
  "Grep(*)","Glob(*)","WebFetch(*)","WebSearch(*)",
  "Skill","mcp__*"
];
cur.permissions.deny = ["Agent"];
fs.writeFileSync(path, JSON.stringify(cur, null, 2) + "\n");
'

# Codex — create ~/.codex/config.toml
cat > ~/.codex/config.toml <<'EOF'
approval_policy = "never"
sandbox_mode = "danger-full-access"

[notice]
hide_full_access_warning = true
EOF

# Gemini — merge into ~/.gemini/settings.json
node -e '
const fs = require("fs");
const path = process.env.HOME + "/.gemini/settings.json";
const cur = fs.existsSync(path) ? JSON.parse(fs.readFileSync(path, "utf8")) : {};
cur.general = cur.general || {};
cur.general.defaultApprovalMode = "auto_edit";
fs.writeFileSync(path, JSON.stringify(cur, null, 2) + "\n");
'
```

These three files live **outside** pi's overlay tree (`~/.pi/agent/*-config-overlay/`
is pi-shell-acp managed and isolated from these — see AGENTS.md Hard
Rule #10). The overlay neutralizes the native YOLO so the bridge's own
posture wins inside a pi session; that isolation is why setting native
YOLO is safe.

> **Verified 2026-05-18 @ cleanhost**: all three files merged in place
> with the snippets above. `~/.claude/settings.json` retained its
> pre-existing `theme: "dark"`; `~/.codex/config.toml` did not exist
> before (created); `~/.gemini/settings.json` retained
> `security.auth.selectedType: "oauth-personal"`. No native YOLO key was
> overwritten with a less-permissive value.

### Stage 4 — smoke commands

```bash
# pick the backend you have credentials for; each is independent.

# Claude (Anthropic Agent SDK / claude CLI)
~/.pi/agent/git/github.com/junghan0611/pi-shell-acp/run.sh smoke-claude .

# Codex (codex-acp / OpenAI)
~/.pi/agent/git/github.com/junghan0611/pi-shell-acp/run.sh smoke-codex .

# Gemini (gemini-cli) — requires `gemini` on PATH
~/.pi/agent/git/github.com/junghan0611/pi-shell-acp/run.sh smoke-gemini .

# all three at once, only if all three are authenticated
~/.pi/agent/git/github.com/junghan0611/pi-shell-acp/run.sh smoke-all .
```

Expected drift points:
- a backend you have not authenticated will fail loudly. **That is not a
  pi-shell-acp failure** — the bridge's job is to surface the missing auth,
  not to fix it. Add the credential and re-run.
- `smoke-all` skips Gemini if `gemini` is not on PATH; the run summary
  records the skip as an explicit observation, not a silent green.

> **Verified 2026-05-18 @ cleanhost** — all four smoke commands exit 0
> after Claude / Codex / Gemini login on the target. Trimmed key lines
> per command (full output is ~25 lines each; the round-trip shape is
> the same):
>
> ```
> === smoke-claude (claude-sonnet-4-6) ===
> [smoke] provider models: ok
> [pi-shell-acp:bootstrap] path=new backend=claude
>   acpSessionId=fb8d1b70-56e1-4a5f-a37d-1616205dfe46
> [pi-shell-acp:shutdown] backend=claude closeRemote=ok childExit=exited
> [smoke] bridge response (claude/claude-sonnet-4-6): ok
> [smoke] bridge prompt: ok
> [smoke-claude exit=0]
>
> === smoke-codex (gpt-5.4) ===
> [smoke] provider models: ok
> [pi-shell-acp:bootstrap] path=new backend=codex
>   acpSessionId=019e3a47-0dda-7721-bf21-9aec9ed65fb2
> [pi-shell-acp:shutdown] backend=codex closeRemote=ok childExit=exited
> [smoke] bridge response (codex/gpt-5.4): ok
> [smoke] bridge prompt: ok
> [smoke-codex exit=0]
>
> === smoke-gemini (gemini-3.1-pro-preview) ===
> [smoke] provider models: ok
> [pi-shell-acp:bootstrap] path=new backend=gemini
>   acpSessionId=9b9e387b-d175-40fd-8843-922a2c06f9ad
> [pi-shell-acp:shutdown] backend=gemini closeRemote=skip childExit=exited
> [smoke] bridge response (gemini/gemini-3.1-pro-preview): ok
> [smoke] bridge prompt: ok
> [smoke-gemini exit=0]
>
> === smoke-all ===
> [smoke-all] Claude + Codex + Gemini runtime smokes: ok
> [smoke-all exit=0]
>
> SUMMARY: claude=0 codex=0 gemini=0 all=0
> ```
>
> Notes from the run:
> - Gemini's `closeRemote=skip` (vs `ok` for Claude/Codex) is the
>   bridge's documented behavior — gemini-cli does not expose the same
>   close-remote signal; the spawn-side `childExit=exited` is what
>   confirms a clean teardown.
> - Each smoke spins a fresh `acpSessionId` and tears it down at the end;
>   no `entwurf-control` socket was created (Stage 4 smoke is single-
>   session, by design).

> **Verified 2026-05-18 @ cleanhost** — auth-free baseline. None of the
> three backend CLIs (`claude`, `codex`, `gemini`) is installed on this
> host, and no `*_API_KEY` env is set. Each smoke command surfaces the
> missing-auth signal in the shape the bridge promises:
>
> ```
> === auth-state pre-check ===
> claude binary: (absent)        ANTHROPIC_API_KEY: unset
> codex binary:  (absent)        OPENAI_API_KEY:    unset
> gemini binary: (absent)        GEMINI_API_KEY:    unset
>
> === smoke-claude ===
> RequestError: Authentication required
>   code: -32000, data: undefined
>
> === smoke-codex ===
> RequestError: Authentication required
>   code: -32000, data: undefined
>
> === smoke-gemini ===
> EPIPE on Writable.write (gemini-cli spawn closed early)
>   errno: -32, code: 'EPIPE'
> ```
>
> **Reading the signal**: pi-shell-acp itself is healthy — install,
> registration, model catalog, deterministic gates all green. The smoke
> commands route through the ACP layer to the chosen backend; when that
> backend is absent or unauthenticated, the ACP server replies with
> `Authentication required` (Claude / Codex shape) or hangs up the spawn
> pipe (Gemini shape). To turn any of these green: install the backend
> CLI, complete its own auth flow, and re-run the matching smoke.

## Stage 5 — entwurf surface (optional, two-session)

> **Do not run Stage 5 until Stage 4b (authenticated runtime smoke) is
> green.** A two-session entwurf flow drives a real turn on the receiver
> backend, so an unauthenticated host would just re-surface the same
> `Authentication required` / `EPIPE` noise from Stage 4 dressed up in
> session-control clothing. Land at least one authenticated `smoke-*`
> first; then exercise this.

If the host runs a long-lived pi session you want to address from another
session (or from an external MCP host like Claude Code), open it with
`--entwurf-control`:

```bash
pi --entwurf-control --provider pi-shell-acp --model claude-sonnet-4-6
# the session prints its sessionId; the control socket is at
# ~/.pi/entwurf-control/<sessionId>.sock
```

From any other pi session on the same host:

```bash
# list live peers
# (in-pi: /entwurf-sessions, or call entwurf_peers via MCP)

# send a message — fire-and-forget, delivery-ack only
# (in-pi tool entwurf_send sessionId=<id> message="..." mode=follow_up)
```

`entwurf_send` is fire-and-forget. There is **no `wait_until=turn_end`** —
if the caller needs a result it owns, use `entwurf(mode=async)` +
`entwurf_resume`; if a peer should reply, say so in the message body and
let the receiver send a separate `entwurf_send` back. (The MCP bridge's
`entwurf_send` carries a `wants_reply` etiquette flag on the sender
envelope for that case; the in-pi tool does not have it — the message
body itself is the contract.) See AGENTS.md `Send-is-throw` for the full
rule.

`<unverified>` cross-session smoke captured here once executed.

## Teardown

The bridge has no daemon. To remove everything installed:

```bash
# pi-shell-acp clone
rm -rf ~/.pi/agent/git/github.com/junghan0611/pi-shell-acp

# project wiring (per-project)
rm -rf ~/pi-shell-acp-smoke/.pi

# pi binary
npm uninstall -g @earendil-works/pi-coding-agent

# node + pnpm via nvm
nvm uninstall 24
rm -rf ~/.nvm
```

## After the walk-through is validated

Stages 0–3, Stage 4a (missing-auth boundary), the Stage 4 prep settings
work (interactive + standalone YOLO), and Stage 4b (authenticated
runtime smoke for Claude / Codex / Gemini) are all verified end-to-end
on `cleanhost` (2026-05-18). Stage 5 (entwurf two-session) is the only
remaining optional gate. This walk-through is the **verification floor**
underneath every downstream publish step — not the trigger.

The publish-prep patch series below is the historical sequence that
walked the package from the verified git surface to the registry. Steps
1 and 2 have landed; only the optional gallery polish in step 3 remains.

1. **scope migration patch** ✅ landed (`0.7.0`, 2026-05-18). `package.json`
   `name` → `@junghanacs/pi-shell-acp`, `run.sh` `PACKAGE_NAME` updated,
   README install table swapped from `pi install npm:pi-shell-acp` to
   `pi install npm:@junghanacs/pi-shell-acp`, `check-pack` gate confirmed
   to handle the scope path (`node_modules/@junghanacs/pi-shell-acp/`).
   Version bumped **`0.6.x` → `0.7.0`** in the same patch; CHANGELOG
   `0.7.0` entry framed as "scope adoption + publish-ready".

2. **npm publish** ✅ landed. `pnpm publish` against the `@junghanacs`
   scope cut `0.7.1` as the first registry artifact (`0.7.0` stayed on
   GitHub only — the `prepublishOnly` dry-run race needed `0.7.1`'s
   `--dry-run=false` fix on the nested pack smoke). `0.7.2` followed
   immediately as a registry-artifact patch: `pnpm pack` normalizes
   shipped `.sh` files to `0644`, so `0.7.1` left `run.sh` and the
   `pi-tools-bridge` MCP start script non-executable on a fresh
   `pi install`; `0.7.2` restores the executable bit through a
   `scripts/postinstall-chmod.cjs` hook and locks the regression with a
   new `.sh` mode gate in `./run.sh check-pack`. Stage 2 re-run on a
   different clean host should target `0.7.2` (or whatever is current
   at `latest`); `0.7.1` is deprecated on npm.

3. **pi.dev gallery card** — `package.json#pi.image` is populated and
   indexed (the gif at `docs/assets/pi-shell-acp-demo.gif`). `pi.video`
   stays optional; an MP4 hover preview is the next polish but not a
   blocker. The pi.dev push itself is GLG's call.
