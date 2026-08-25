# Clean-host setup

Current operator recipe for a fresh Linux desktop/workstation. The neutral npm
package can install elsewhere, but Claude's garden-native meta-bridge is certified
only on Linux because its strict live-owner join uses `/proc`.

## Requirements

| Component | Requirement | Needed for |
|---|---|---|
| Node | **`>=24.0.0`** | package and bridge runtime |
| npm | bundled with Node | package installation |
| entwurf | `@junghanacs/entwurf` | all lanes |
| pi | optional, `@earendil-works/pi-coding-agent >=0.84.3 <0.85` | ACP provider, control sockets |
| Claude Code | optional, **`>=2.1.217`** — the exec-form hook floor | Claude ACP auth/runtime and mailbox-backed native citizen |
| Antigravity `agy` | optional, operator-installed and authenticated | native-push citizen |
| Cortex Code | optional, operator-installed and authenticated | Cortex ACP backend |

Claude Code >=2.1.217 is required for the managed exec-hook lifecycle. The package
never supplies or proxies backend credentials.

## 1. Install Node and entwurf

Use the host's normal Node 24 installation. With nvm:

```bash
nvm install 24
nvm use 24
node --version
npm --version
```

Global install is simplest when native harnesses should find stable bins from every
working directory:

```bash
npm install -g @junghanacs/entwurf
entwurf --help
entwurf check-bridge
```

A project-local installation is also supported:

```bash
mkdir -p ~/entwurf-smoke && cd ~/entwurf-smoke
npm init -y
npm install --save-dev @junghanacs/entwurf
npx entwurf check-bridge
```

`check-bridge` is auth-free. It proves the installed prebuilt MCP server boots and
lists the seven garden tools; it does not prove a backend model turn or native hook.

## 2. Optional pi adapter / ACP plugin

Install the exact release floor, then wire the project:

```bash
npm install -g @earendil-works/pi-coding-agent@0.84.3
pi --version

cd ~/entwurf-smoke
entwurf install .
pi -e "$(npm root -g)/@junghanacs/entwurf" --list-models entwurf
```

The supported range is `>=0.84.3 <0.85`. It is a hard minimum: installing this
release onto a 0.83.x pi host upgrades the runtime rather than keeping the older
minor. A host using only the external MCP bridge can skip pi until it needs a
control socket; no delivery rail launches a pi process.

For daily garden-native pi sessions:

```bash
cd ~/entwurf-smoke
pi -e "$(npm root -g)/@junghanacs/entwurf" --entwurf-control
```

The V3 record births the garden id; do not inject a pi session id manually.

## 3. Optional Claude Code native citizen

First register the MCP bridge if the stable bin is not already present:

```bash
claude mcp add --scope user entwurf-bridge entwurf-bridge
```

Then install and certify the mailbox/self-fetch lifecycle:

```bash
entwurf install-meta-bridge
# restart every already-open Claude Code process
# open a new Claude Code session
entwurf doctor-meta-bridge
```

The supported floor `>=2.1.217` is enforced by package metadata through installer
and doctor gates. Older Claude versions validate an exec-form hook but silently drop
its `args` at runtime, so there is no shell-form fallback.

A doctor PASS requires both ownership and runtime evidence, including a live
MCP↔sender↔receiver owner join. `NOT CERTIFIED` exits nonzero: a fixture, plugin
validation, or hand-inspected marker cannot replace a new real session. If the launch
form is unsupported, reinstall; if ownership is correct but the live join is absent,
restart the affected session.

New macOS wiring is refused because the live join is not instrumented there. Darwin
uninstall remains available for cleaning an older managed install; this is an evidence
boundary, not a permanent impossibility claim.

## 4. Optional Antigravity native citizen

Install the three independently owned surfaces:

```bash
entwurf install-agy-bridge
entwurf install-agy-statusline
entwurf install-agy-hooks

entwurf doctor-agy-bridge
entwurf doctor-agy-statusline
entwurf doctor-agy-hooks
```

The bridge owns one MCP server and narrow rules for the normal tools; the statusline
owns its subtree; the hook owns one `PreInvocation` entry. Unrelated settings are
preserved. A fresh conversation initially may show `🪛 ? agy`; the first invocation
births the record by native `conversationId`, after which the garden id appears.

Real native-push acceptance needs an already-running conversation:

```bash
LIVE=1 AGY_CONVERSATION_ID=<id> entwurf smoke-agy-native-push-live
```

## 5. Optional ACP backend turns

Claude uses the operator's existing local Claude authentication:

```bash
LIVE=1 entwurf smoke-acp-provider-live
```

Cortex requires an authenticated `cortex` CLI and an explicit connection. Keep
`CORTEX_HOME` unset; the adapter refuses its presence because it bypasses containment.

```bash
LIVE=1 ENTWURF_ACP_CORTEX_CONNECTION=<conn> \
  entwurf smoke-acp-cortex-live
```

The aggregate release gate is Claude-backed and does not run Cortex automatically.
Its silence is not a Cortex PASS.

## 6. Upgrade and repair

After upgrading the package, rerun the managed installers for every native harness
in use and restart their existing processes. Native plugin caches are not live-reload
safe across launch-contract changes.

If install or doctor reports an unreadable/old active citizen generation, do not edit
records by hand:

```bash
# close pi, Claude, and agy sessions first
entwurf meta-bridge-fresh-cut
entwurf setup ~/entwurf-smoke
```

Read the cut's exit status before chaining setup. The complete quiescence, archive,
and exit-code contract is [fresh-cut-policy.md](./fresh-cut-policy.md).

## 7. Release acceptance versus host acceptance

- `entwurf check-bridge`: installed MCP bytes boot; no backend auth.
- `pnpm check` / `pnpm run check:full`: tiered source deterministic floors (everyday
  core / full candidate floor); maintainer checkout only.
- `check-install-container`: checkout-invisible Linux package-consumer shape using
  fixtures; not a native lifecycle proof.
- `doctor-meta-bridge`: one installed real Claude host, only with a new live session.
- `LIVE=1 entwurf release-gate /path/to/scratch --cut`: aggregate runtime acceptance (`--cut` makes any MUST SKIP red; without it the run is a diagnostic pass).

Keep these verdicts separate. Current protocol is [VERIFY.md](../VERIFY.md); recorded
host verdicts are [BASELINE.md](../BASELINE.md).

## Uninstall

Run only the surfaces this host owns:

```bash
entwurf uninstall-meta-bridge
entwurf uninstall-agy-hooks
entwurf uninstall-agy-statusline
entwurf uninstall-agy-bridge
entwurf uninstall ~/entwurf-smoke
npm uninstall -g @junghanacs/entwurf
```

Each managed surface has an honest inverse and preserves unrelated native-harness
configuration.
