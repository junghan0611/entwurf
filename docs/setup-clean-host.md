# Clean-host setup

Current operator recipe for a fresh Linux desktop/workstation. The neutral npm
package can install elsewhere, but Claude's garden-native meta-bridge is certified
only on Linux because its strict live-owner join uses `/proc`.

## Requirements

| Component | Requirement | Needed for |
|---|---|---|
| Node | **`>=24.0.0`** | package and bridge runtime |
| npm/pnpm | npm is bundled with Node; pnpm is required for source setup | package or source installation |
| Python 3 | required by `setup`/`install` (project-path normalization + settings writers); `--help`/`check-bridge` stay Python-free | pi/Claude/agy wiring writers |
| entwurf | global/project-local `@junghanacs/entwurf`, or a source checkout | operator command and garden capability |
| pi | optional-by-presence, `>=0.84.3 <0.85` — absent is an explicit setup SKIP, below-floor is a named FAIL | ACP provider, control sockets |
| Claude Code | optional, **`>=2.1.217`** — the exec-form hook floor | Claude ACP auth/runtime and mailbox-backed native citizen |
| GitHub Copilot CLI | optional, operator-installed and authenticated | self-fetch citizen and visible fresh |
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

Neither npm form installs a harness runtime. `pi`, Claude Code, Copilot CLI, agy, Cortex and their
authentication remain operator-owned optional prerequisites for the integrations that use them;
all may be absent on an Entwurf-only host. A source checkout's pinned Pi development packages are
for building and testing this repo, not a transitive product installation promise.

Maintainers using a source checkout do not install a second global entwurf package. Full source
setup currently requires Node 24, pnpm, and Python 3 on PATH; every harness — including pi — is
optional-by-presence (absent → explicit SKIP, detected but below the supported floor → named FAIL
with a nonzero setup result):

```bash
git clone https://github.com/junghan0611/entwurf ~/repos/gh/entwurf
cd ~/repos/gh/entwurf
./run.sh setup /path/to/consumer-project
```

This owns `~/.local/bin/entwurf` as a symlink to that checkout's `run.sh` and fails if the
link is foreign, outside PATH, or shadowed by another command. It detects and wires pi/Claude/agy
by presence and prints a computed per-component PASS/SKIP/FAIL summary — a detected harness that
cannot be completed makes setup exit nonzero. Copilot's four native units remain explicit
installs in §4.

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

## 4. Optional GitHub Copilot CLI native citizen

Copilot has four independently owned surfaces. Install and certify all four for supported visible
fresh; a manual citizen may omit the footer, but fresh refuses before opening a window when any
required surface is absent.

```bash
entwurf install-copilot-bridge
entwurf install-copilot-mcp
entwurf install-copilot-receive
entwurf install-copilot-statusline

entwurf doctor-copilot-bridge
entwurf doctor-copilot-mcp
entwurf doctor-copilot-receive
entwurf doctor-copilot-statusline
```

Launch the supported invocation with `entwurf copilot`, not bare `copilot`. It enables extension
scanning for that process, checks the receiver, removes inherited pi identity carriers, and owns
the model/permission defaults. Birth occurs on the first prompt. `entwurf_fresh_call` uses this
same managed invocation and requires the birth, MCP, receiver, and visible-identity preflight.

## 5. Optional Antigravity native citizen

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

## 6. Optional ACP backend turns

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

## 7. Upgrade and repair

After upgrading the package, rerun the managed installers for every native harness
in use and restart their existing processes. Native plugin caches are not live-reload
safe across launch-contract changes.

If install or doctor reports an unreadable/old active citizen generation, do not edit
records by hand. Close pi, Claude, Copilot, and agy sessions first, run
`entwurf meta-bridge-fresh-cut`, and read its exit status before any install. Then choose the
installation mode you actually own:

```bash
# npm package consumer
entwurf install ~/entwurf-smoke
entwurf install-meta-bridge
# rerun the four install-copilot-* commands when Copilot is in use

# source maintainer — from the checkout
./run.sh setup ~/entwurf-smoke
```

The package-installed `entwurf setup` is the same consumer command in installed mode: it names
that mode first, never runs npm/pnpm inside `node_modules` (the frozen pnpm bootstrap is
source-checkout-only), and composes the detected harnesses with the same per-component
PASS/SKIP/FAIL summary. The complete quiescence, archive, and exit-code contract is
[fresh-cut-policy.md](./fresh-cut-policy.md).

## 8. Release acceptance versus host acceptance

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
entwurf uninstall-copilot-statusline
entwurf uninstall-copilot-receive
entwurf uninstall-copilot-mcp
# Birth currently has no package wrapper inverse; remove only the qualified unit/marketplace:
copilot plugin uninstall entwurf-meta-receive-copilot@meta-bridge-copilot-local
copilot plugin marketplace remove meta-bridge-copilot-local
entwurf uninstall-agy-hooks
entwurf uninstall-agy-statusline
entwurf uninstall-agy-bridge
entwurf remove ~/entwurf-smoke
# only when no other project uses the shared user-scope pi registration:
entwurf remove-user-scope
npm uninstall -g @junghanacs/entwurf
```

The package `uninstall-*`/`remove` surfaces preserve unrelated native-harness configuration.
Copilot birth is the explicit exception above: its installer predates a package-owned inverse,
so cleanup uses the qualified vendor identities rather than a bare plugin name that could match
somebody else's unit. The assembled source under `$XDG_DATA_HOME/entwurf/meta-bridge-copilot`
remains inert after marketplace removal; deleting that preserved artifact is a separate operator
choice, not something this guide guesses at.
