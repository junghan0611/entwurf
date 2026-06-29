# Clean-host setup walk-through

End-to-end install of **entwurf** on a host with only `git` available — no
node, no npm package, no pi binary, no dotfiles. The point is to validate the
public install surface as an outside user would experience it.

> **Scope.** This is the entwurf 0.12.1 install recipe. The base package install
> is **neutral npm**, not `pi install npm:...`. Pi is an optional adapter lane for
> the ACP provider / control-socket runtime.

`entwurf` is a garden-citizen dispatch substrate and meta-bridge. It does not
provide, copy, or mediate backend credentials — it lets the official backend CLI
or the pi adapter read whatever auth the user already trusts on the host
(AGENTS.md Hard Rule #9).

## Reference target

Written against a clean Ubuntu / Debian / macOS host reachable via SSH, here
called `cleanhost`. `nvm` keeps the path identical across them.

```bash
ssh cleanhost 'uname -a; whoami; which git node npm pi claude 2>/dev/null'
# expect on a fully clean host: git present, node/npm/pi/claude absent
```

## Pin matrix

| Component | Pin / floor | Source of truth |
|---|---|---|
| Node | **24** recommended; `>=22.6.0` minimum | `engines.node` (Node strip-types / ESM runtime) |
| npm | bundled with Node 24 | public package install path |
| entwurf | `@junghanacs/entwurf` | neutral npm package; exposes `entwurf` and `entwurf-bridge` bins |
| pi binary | **optional**, `@earendil-works/pi-coding-agent >=0.80.2 <0.81` | needed only for the pi adapter / ACP provider / spawn-bg resume lane |

## Stage 0 — Node 24 via nvm

```bash
ssh cleanhost

curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
source ~/.nvm/nvm.sh

nvm install 24
nvm alias default 24
node -v
npm -v
```

Drift points:
- Corporate proxy / sudo policy may block `curl | bash`. Fallback: clone `nvm`
  via git and source `~/.nvm/nvm.sh` directly.
- **Subshell trap**: `nvm install 24 | tail` runs in a pipe-subshell, so PATH
  changes do not reach the parent shell. Drop the pipe, or run `nvm use 24` in
  the same shell afterward.

## Stage 1 — neutral entwurf npm install

Install the public package with npm. This does **not** require pi.

```bash
npm install -g @junghanacs/entwurf

which entwurf
which entwurf-bridge
entwurf --help | head -5
```

`@earendil-works/*` pi packages are optional peers. A neutral npm install should
not pull them in as package dependencies. That separation is intentional: the
MCP bridge can boot in Claude Code / Codex / Antigravity without pi present.

## Stage 2 — auth-free bridge boot

Prove the installed MCP server answers `tools/list` from inside `node_modules`.
This is the regression that 0.12.0 missed: Node refuses `--experimental-strip-types`
for `.ts` under `node_modules`, so the installed package must boot the prebuilt
JS under `mcp/entwurf-bridge/dist/`.

```bash
node --input-type=module <<'JS'
import { spawn } from 'node:child_process';
const child = spawn('entwurf-bridge', { stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, NODE_PATH: '' } });
let out = '', err = '';
const timer = setTimeout(() => { child.kill('SIGKILL'); console.error(err || 'timeout'); process.exit(1); }, 5000);
child.stderr.on('data', d => err += d);
child.stdout.on('data', d => {
  out += d;
  try {
    const msg = JSON.parse(out.trim());
    const names = (msg.result?.tools ?? []).map(t => t.name).sort();
    for (const n of ['entwurf_v2','entwurf_peers','entwurf_self','entwurf_inbox_read']) {
      if (!names.includes(n)) throw new Error(`missing ${n}: ${names.join(',')}`);
    }
    clearTimeout(timer);
    child.kill('SIGTERM');
    console.log(names.join(','));
  } catch {}
});
child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) + '\n');
JS
```

Expected: a comma-separated tool list containing all four `entwurf_*` tools,
exit code 0, no backend auth required.

## Stage 3 — wire a project for the pi adapter / ACP plugin (optional)

If the host will run pi sessions or the Claude ACP provider through pi, install
a compatible pi binary separately and wire the target project.

```bash
npm install -g @earendil-works/pi-coding-agent@0.80.2
pi --version

mkdir -p ~/entwurf-smoke
cd ~/entwurf-smoke
entwurf install .
entwurf check-bridge

# pi adapter/provider registration smoke
pi -e "$(npm root -g)/@junghanacs/entwurf" --list-models entwurf
```

Drift points:
- `entwurf install .` writes `.pi/settings.json`, registers the bundled
  `entwurf-bridge`, and links `~/.pi/agent/entwurf-targets.json` to the package's
  `pi/entwurf-targets.json`.
- Older pi versions may silently miss the provider/extension surface. Use the
  pinned floor (`>=0.80.2 <0.81`) for release verification.
- A host that only uses the external MCP bridge can skip this stage until it
  needs `owned-outcome` spawn-bg resume or pi-native control sockets.

## Stage 4 — Claude Code meta-bridge (optional, garden-native native sessions)

For an external Claude Code session to be replyable by garden id, install the
meta-bridge plugin globally. This is still a neutral npm-package command; it
registers Claude Code USER-scope MCP + the SessionStart hook.

```bash
entwurf install-meta-bridge
entwurf doctor-meta-bridge
```

A plain external MCP host can call tools but is non-replyable. A garden-native
meta-session has a garden id, a mailbox, and a trusted sender marker; it can call
`entwurf_self`, receive mailbox wakeups, and be replied to by garden id.

## Stage 5 — backend auth and live runtime smoke

Backend authentication is the operator's responsibility and lives entirely
outside entwurf. For the Claude ACP lane:

```bash
curl -fsSL https://claude.ai/install.sh | bash
echo 'export PATH="$HOME/.local/bin:$PATH"' >> ~/.bashrc
source ~/.bashrc
claude login

cd ~/entwurf-smoke
pi --provider entwurf --model claude-sonnet-4-6 -p "reply with ok only"
```

If the backend CLI fails directly (`claude -p "ping"`), fix that upstream first.
`entwurf` surfaces missing auth; it does not repair it.

## Stage 6 — garden/control-socket surface (optional)

To address a long-lived pi session from another session or an external MCP host,
open it with `--entwurf-control`. A garden-native `--session-id` is required —
a raw pi-assigned uuid hard-exits before any model turn.

```bash
pi --session-id "$(entwurf new-session-id)" \
  --entwurf-control --provider entwurf --model claude-sonnet-4-6
# control socket: ~/.pi/entwurf-control/<garden-id>.sock
```

Use `entwurf_peers` to discover citizens and `entwurf_v2` to deliver by garden
id. Do not choose the transport by hand: the same-looking id may name a live pi
socket, a dormant pi record, or a mailbox-backed native session.

## Teardown

```bash
# project wiring
rm -rf ~/entwurf-smoke/.pi

# meta-bridge plugin (if installed)
entwurf uninstall-meta-bridge 2>/dev/null || true

# package and optional pi binary
npm uninstall -g @junghanacs/entwurf
npm uninstall -g @earendil-works/pi-coding-agent 2>/dev/null || true

# node via nvm
nvm uninstall 24
rm -rf ~/.nvm
```

This walk-through is a verification floor underneath release cuts: neutral npm
install, installed bridge boot, optional pi adapter registration, and at least
one authenticated runtime smoke when cutting a live release. GLG owns the
publish/tag decision.
