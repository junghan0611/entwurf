# Clean-host setup walk-through

End-to-end install of **entwurf** on a host with only `git` available — no
node, no npm package, no pi binary, no dotfiles. The point is to validate the
public install surface as an outside user would experience it.

> **Scope.** This is the current entwurf 0.12.x install recipe, including the
> 0.12.7 Antigravity (`agy`) citizen surface. The base package install is
> **neutral npm**, not `pi install npm:...`. Pi is an optional adapter lane for
> the ACP provider / control-socket runtime. Installed packages under
> `node_modules` must not run raw `.ts` bridge, doctor, or native-hook helpers
> through Node strip-types.

`entwurf` is a garden-citizen dispatch substrate and meta-bridge. It does not
provide, copy, or mediate backend credentials — it lets the official backend CLI
or the pi adapter read whatever auth the user already trusts on the host
(AGENTS.md Hard Rule #9).

## Reference target

Written against a clean Ubuntu / Debian / macOS host reachable via SSH, here
called `cleanhost`. `nvm` keeps the path identical across them.

```bash
ssh cleanhost 'uname -a; whoami; which git node npm pi claude agy 2>/dev/null'
# expect on a fully clean host: git present, node/npm/pi/claude absent
```

## Pin matrix

| Component | Pin / floor | Source of truth |
|---|---|---|
| Node | **24** recommended; `>=22.6.0` minimum | `engines.node` (Node strip-types / ESM runtime) |
| npm | bundled with Node 24 | public package install path |
| entwurf | `@junghanacs/entwurf` | neutral npm package; exposes `entwurf`, `entwurf-bridge`, `entwurf-statusline`, `entwurf-agy-statusline`, and `entwurf-agy-imprint` bins |
| pi binary | **optional**, `@earendil-works/pi-coding-agent >=0.80.3 <0.81` | needed only for the pi adapter / ACP provider / spawn-bg resume lane |
| Antigravity `agy` | **optional**, operator-installed/authenticated native CLI | needed only for the shipped native-push citizen lane; entwurf never moves its auth |

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
which entwurf-statusline
which entwurf-agy-statusline
which entwurf-agy-imprint
entwurf --help | head -5
```

`@earendil-works/*` pi packages are optional peers. A neutral npm install should
not pull them in as package dependencies. That separation is intentional: the
MCP bridge can boot in Claude Code / Codex / Antigravity without pi present.

## Stage 2 — auth-free bridge boot

Prove the installed MCP server answers `tools/list` from inside `node_modules`.
This is the first `node_modules` strip-types regression fixed in 0.12.0: Node
refuses `--experimental-strip-types` for `.ts` under `node_modules`, so the
installed package must boot the prebuilt JS under `mcp/entwurf-bridge/dist/`.
The same installed-vs-dev split closes every shipped `.ts`-at-runtime surface on
that fence: the `doctor-meta-bridge` store-scan helper (0.12.4), the Claude plugin
hook (0.12.5, compiled `dist/pi-extensions/meta-bridge-hook.js`), and the agy
`PreInvocation` imprint (0.12.7, compiled `dist/scripts/agy-imprint.js`). Installed
packages run tsc-emitted JS on these paths; dev clones keep transparent `.ts`
source execution.

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
    for (const n of ['entwurf_v2','entwurf_peers','entwurf_self','entwurf_inbox_read','entwurf_register_native']) {
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

Expected: a comma-separated tool list containing all five current `entwurf_*`
tools, exit code 0, no backend auth required. `entwurf_register_native` binds an
already-running native conversation; it is not a fresh-spawn verb.

## Stage 3 — wire a project for the pi adapter / ACP plugin (optional)

If the host will run pi sessions or the Claude ACP provider through pi, install
a compatible pi binary separately and wire the target project.

```bash
npm install -g @earendil-works/pi-coding-agent@0.80.3
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
  pinned floor (`>=0.80.3 <0.81`) for release verification.
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

On an installed package (`.../node_modules/@junghanacs/entwurf`), the doctor must
not try to strip-types-run raw `.ts` helpers or hooks. In the output, check for
these 0.12.5 floor-regression signals:

```text
ok    cached SessionStart hook executes cleanly in an isolated temp agent dir
ok    full store scan: no corrupt records, duplicate nativeSessionId, body/filename drift, or backend↔wakeMode contradiction
ok    check-entwurf-v2-surface: shipped surface source present; exhaustive source-shape gate is a repo/release invariant (not run under node_modules)
```

If any of those sections reports `ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`,
the host is still running a pre-0.12.5 package or a broken tarball. Reinstall the
current package and re-run `entwurf install-meta-bridge && entwurf doctor-meta-bridge`.

Upgrade invariant: every global npm/pnpm package upgrade must be followed by
`entwurf install-meta-bridge` from that same installed binary and then
`entwurf doctor-meta-bridge`. Installed statusline/MCP entries use stable bin
shims and the marketplace source lives in a version-stable operator data dir, but
package managers still do not re-materialize Claude's plugin bundle/cache. If a
dev checkout's `./run.sh doctor-meta-bridge` expects repo-owned paths while the
global install intentionally owns the meta-bridge (or the reverse), that is an
ownership mismatch — run the doctor from the surface that intentionally owns the
install, or reinstall from the other surface. Restart already-open Claude Code
sessions after changing the meta-bridge install.

A plain external MCP host can call tools but is non-replyable. A garden-native
meta-session has a garden id, a mailbox, and a trusted sender marker; it can call
`entwurf_self`, receive mailbox wakeups, and be replied to by garden id.

## Stage 5 — Antigravity native citizen (optional)

If `agy` is already installed and authenticated by the operator, wire the three
separate ownership atoms. Entwurf does not install agy or copy its auth.

```bash
which agy

entwurf install-agy-bridge
entwurf install-agy-statusline
entwurf install-agy-hooks

entwurf doctor-agy-bridge
entwurf doctor-agy-statusline
entwurf doctor-agy-hooks
```

What these commands own:

- `install-agy-bridge`: one MCP server in `~/.gemini/config/mcp_config.json`
  and exactly `mcp(entwurf-bridge/entwurf_v2)` in
  `~/.gemini/antigravity-cli/settings.json`'s permission allow-list;
- `install-agy-statusline`: the `statusLine` subtree only, pointing at
  `entwurf-agy-statusline`;
- `install-agy-hooks`: one named plugin `PreInvocation` hook pointing at
  `entwurf-agy-imprint`.

They preserve unrelated user state, record independent install-state under
`$XDG_DATA_HOME/entwurf/`, and refuse symlink-owned config instead of writing
through someone else's SSOT. Broad YOLO rules such as `command(*)` and
`unsandboxed(*)` are operator policy and are never granted by this package.

Restart agy, open a **fresh conversation**, and make one model invocation. The
hook's first `PreInvocation` births/attaches the conversation by native
`conversationId`; after that, the statusline should show `🪛 <garden-id> agy`.
Verify:

1. `entwurf_self` reports that gid with `agentId=meta-session/antigravity` and
   `replyable:true` while the native route probes alive;
2. an `entwurf_v2` send from agy reaches a sibling with that sender gid;
3. a sibling's `entwurf_v2(..., intent=fire-and-forget)` reply to the same gid
   direct-injects into the same agy conversation.

This rail has no mailbox/receiver marker and no `owned-outcome` authority.
Same-pid concurrent conversation invocation is not supported; separate agy
processes have separate pid/start-key sender markers.

## Stage 6 — backend auth and live ACP runtime smoke

Backend authentication is the operator's responsibility and lives entirely
outside entwurf. For the Claude ACP lane:

```bash
curl -fsSL https://claude.ai/install.sh | bash
echo 'export PATH="$HOME/.local/bin:$PATH"' >> ~/.bashrc
source ~/.bashrc
claude login

cd ~/entwurf-smoke
pi --provider entwurf --model claude-sonnet-5 -p "reply with ok only"
```

If the backend CLI fails directly (`claude -p "ping"`), fix that upstream first.
`entwurf` surfaces missing auth; it does not repair it.

## Stage 7 — garden/control-socket surface (optional)

To address a long-lived pi session from another session or an external MCP host,
open it with `--entwurf-control`. A garden-native `--session-id` is required —
a raw pi-assigned uuid hard-exits before any model turn.

```bash
pi --session-id "$(entwurf new-session-id)" \
  --entwurf-control --provider entwurf --model claude-sonnet-5
# control socket: ~/.pi/entwurf-control/<garden-id>.sock
```

Use `entwurf_peers` to discover citizens and `entwurf_v2` to deliver by garden
id. Do not choose the transport by hand: the same-looking id may name a live pi
socket, a dormant pi record, a mailbox-backed Claude session, or a native-push
Antigravity conversation.

## Teardown

```bash
# project wiring
rm -rf ~/entwurf-smoke/.pi

# native-harness surfaces (if installed)
entwurf uninstall-meta-bridge 2>/dev/null || true
entwurf uninstall-agy-hooks 2>/dev/null || true
entwurf uninstall-agy-statusline 2>/dev/null || true
entwurf uninstall-agy-bridge 2>/dev/null || true

# package and optional pi binary
npm uninstall -g @junghanacs/entwurf
npm uninstall -g @earendil-works/pi-coding-agent 2>/dev/null || true

# node via nvm
nvm uninstall 24
rm -rf ~/.nvm
```

This walk-through is a verification floor underneath release cuts: neutral npm
install, installed bridge boot, optional pi adapter registration, Claude
meta-bridge verification where used, all three agy doctors plus a fresh native
round trip where used, and at least one authenticated ACP runtime smoke. GLG owns
the publish/tag decision.
