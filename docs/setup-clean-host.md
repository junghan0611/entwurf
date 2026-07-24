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

Written against a clean **Linux** host (Ubuntu / Debian / NixOS) reachable via
SSH, here called `cleanhost`. `nvm` keeps the Node path independent of the distro.
The neutral npm package may install elsewhere, but Linux is this repair cut's only
currently certified Claude meta-bridge axis. macOS has no `/proc` bridge discovery
and is not yet verified/certified for this cut, so its installer refuses new wiring
and its strict doctor stays `NOT CERTIFIED`/nonzero.
This is not permanent; future native validation may reopen the lane, while Darwin
uninstall remains available for older managed state.

```bash
ssh cleanhost 'uname -a; whoami; which git node npm pi claude agy 2>/dev/null'
# expect on a fully clean host: git present, node/npm/pi/claude absent
```

### What the automated Linux consumer already proves

The required CI job `artifact-consumer` runs `check-install-container` against one
candidate tarball in a Node 24 Linux image that has never seen the checkout. It
records the artifact sha256 plus image id/repository digest, mounts only that tarball
read-only, installs globally as non-root through an isolated npm prefix, resolves all
five bins through PATH, freezes the package root, checks the regular-file path+sha256
manifest across `install-meta-bridge`, boots MCP `tools/list`, and drives the strict
doctor. This closes the installed package shape; it does **not** replace this real-host
walk-through. Its fake Claude CLI, planted plugin cache, stand-in owner, and `/proc`
bridge are fixtures, so they cannot prove native plugin installation, real hook spawn,
or idle wake.

Default CI lets the gate pack once into a temporary directory. Release acceptance
instead preserves the `npm pack` output and passes its absolute path as
`ENTWURF_CANDIDATE_TGZ`; the gate verifies package name/version, prints canonical
path+sha256, and consumes that exact file without chmod/copy/re-pack. The accepted
file is the one later published with `--tag repair` (full commands in VERIFY.md).

The direct runtime complement is #51 B/B2: actual Claude sessions on one NixOS host
showed 2.1.138 dropping `args` while reporting success and 2.1.217 honoring exec argv
and waking on FileChanged exit 2. A target host is still accepted only after installing
the released artifact, opening a new Claude session, and obtaining installed-doctor
exit 0.

## Pin matrix

| Component | Pin / floor | Source of truth |
|---|---|---|
| Node | **`>=24.0.0`** — single supported axis, no Node 22 lane | `engines.node` (bound by `check-node-floor-coherence`) |
| Claude Code | **`>=2.1.217`** — the exec-form hook floor; an older Claude drops the hook's `args` silently and still reports success, so there is no fallback lane | `entwurf.claudeCodeFloor` (bound by `check-claude-floor-coherence`) |
| npm | bundled with Node 24 | public package install path |
| entwurf | `@junghanacs/entwurf` | neutral npm package; exposes `entwurf`, `entwurf-bridge`, `entwurf-statusline`, `entwurf-agy-statusline`, and `entwurf-agy-imprint` bins |
| pi binary | **optional**, `@earendil-works/pi-coding-agent >=0.80.7 <0.81` | needed only for the pi adapter / ACP provider / spawn-bg resume lane |
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
npm install -g @earendil-works/pi-coding-agent@0.80.7
pi --version

mkdir -p ~/entwurf-smoke
cd ~/entwurf-smoke
entwurf install .
entwurf check-bridge

# pi adapter/provider registration smoke
pi -e "$(npm root -g)/@junghanacs/entwurf" --list-models entwurf
```

Drift points:
- `entwurf install .` writes `.pi/settings.json` and registers the bundled
  `entwurf-bridge`. (The `entwurf-targets.json` link is gone — #50 C3 removed the
  target registry; a leftover operator link is inert.)
- Older pi versions may silently miss the provider/extension surface. Use the
  pinned floor (`>=0.80.7 <0.81`) for release verification.
- A host that only uses the external MCP bridge can skip this stage until it
  needs `owned-outcome` spawn-bg resume or pi-native control sockets.

## Stage 4 — Claude Code meta-bridge (optional, garden-native native sessions)

For an external Claude Code session to be replyable by garden id, install the
meta-bridge plugin globally. This is still a neutral npm-package command; it
registers Claude Code USER-scope MCP + the SessionStart hook. For this repair cut,
perform and certify this stage on Linux only. The installer rejects Darwin with a
“not yet verified/certified for this repair cut” diagnosis and the macOS doctor stays
nonzero until future native validation supplies a real live-owner measurement.

```bash
entwurf install-meta-bridge
entwurf doctor-meta-bridge
```

> **Upgrades are not live-reload safe across this hook-launch cut.** Re-run `install-meta-bridge`, then restart **all already-open Claude Code sessions** before trusting send/receive. A new hook reached through the old cached command does not get the owner join it depends on, even though a meta-record may still land; reinstall pairs the artifact and the manifest, and restart makes the native process load that pair. This release also refuses Claude Code below `>=2.1.217` at install and doctor time — an older Claude silently drops the hook's `args`, runs the command alone, and still reports the hook as successful, so there is no fallback lane to fall into.

On an installed package (`.../node_modules/@junghanacs/entwurf`), the doctor must
not try to strip-types-run raw `.ts` helpers or hooks. In the output, check for
these floor-regression signals:

```text
ok    claude 2.1.217 (>= 2.1.217, exec-form launch contract supported)
ok    launch form: exec form through the shipped hook-launch.sh (no shell on the path)
ok    installed owner argv execs directly (no shell) through hook-launch.sh and keys its sender marker to the live host pid
ok    <N> live Claude MCP process(es): sender + receiver owner join is live and record-backed
ok    full store scan: no corrupt records, duplicate nativeSessionId, body/filename drift, or backend↔wakeMode contradiction
ok    check-entwurf-v2-surface: shipped surface source present; exhaustive source-shape gate is a repo/release invariant (not run under node_modules)
```

The live-process line is **not** a warning any more. If no matching Claude MCP child
is open — or the host has no `/proc` — the doctor reports `NOT CERTIFIED` and exits
nonzero, because only the static + synthetic checks were possible and neither of them
can measure the live join. A host whose live tier was never measured is an
unmeasured host, not a passing one. An `UNSUPPORTED` launch form needs reinstall; a
failed live owner join after reinstall means the already-open Claude process still
holds the old hook definition in memory and must be restarted — the hook itself
refuses to write markers in that state rather than keying them to whatever the old
command's shell left behind.

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

A plain external MCP host can call the read surfaces (`entwurf_peers`,
`entwurf_inbox_read`), but an `entwurf_v2` send is **refused by default** (#50 C4:
"if we don't know who sent it, we don't send it") — it has no authoritative sender.
A deliberately-anonymous host may wire the explicit
`ENTWURF_BRIDGE_ALLOW_ANONYMOUS_SENDER=1` hatch and then delivers external and
non-replyable; see README §"Wiring `entwurf-bridge` into an external MCP host".
A garden-native meta-session has a garden id, a mailbox, and a trusted sender
marker; it can call `entwurf_self`, receive mailbox wakeups, and be replied to by
garden id.

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
open it with `--entwurf-control`. No id injection and no special launcher
(#50 C2): pi mints its own session id (a `uuidv7` is normal), `session_start`
attaches that session to its meta-record, and the **record** mints the garden id
everything addressable hangs off.

```bash
pi --entwurf-control --provider entwurf --model claude-sonnet-5
```

The control socket is `~/.pi/entwurf-control/<record gardenId>.sock` — keyed on
the id the record minted, which is *not* pi's session id. Read the address off
`entwurf_peers` (or `entwurf_self` from inside the session) instead of guessing
the filename. If the record cannot be written the control server is refused,
`PI_SESSION_ID` stays unset, and the reason is on stderr: an unaddressable
resident must never survive quietly.

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
round trip where used, and at least one authenticated ACP runtime smoke. For the
repair cut, preserve the exact package version, candidate tarball sha256, container
image identity, host OS, Claude version, and installed doctor output together. The
approved repaired candidate is `0.12.8-repair.1` under dist-tag `repair`;
`0.12.8-repair.0` was published but its installed bridge cannot deliver and must not
be reused. Registry `latest` must stay `0.12.7` during this repair cut. Promotion waits
for fresh maintainer + secondary-host installed-doctor evidence and a separately authorized
stable `0.12.8` cut. The repair.1 version bump still waits for the separate
post-landing prepare commit and its own three CI jobs. GLG owns every version, tag,
publish, push, and host-reinstall decision; the complete ordered checklist is in
VERIFY.md §Repair-cut order.
