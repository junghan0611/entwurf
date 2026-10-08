# entwurf

`entwurf` is a garden-citizen dispatch substrate: a thin bridge that lets independent
agent harnesses address one another by **garden id**, without owning each other's
transcript, authentication, tools, or runtime.

![entwurf — a forged screwdriver for garden-citizen dispatch](docs/assets/entwurf-hero.jpg)

[![npm](https://img.shields.io/npm/v/@junghanacs/entwurf?logo=npm)](https://www.npmjs.com/package/@junghanacs/entwurf) · maintained by [junghanacs.com](https://junghanacs.com/)

A sibling is a visible session with its own runtime boundary, not a disposable
worker or a subagent of a new central harness. Entwurf supplies identity, delivery,
receipts and named lifecycle verbs; the operator and native harnesses keep steering.
Git branches, worktrees, file isolation and internal delegation remain their concern.
[Short answers: FAQ](./FAQ.md).

```text
pi / pi-durable / Claude Code / Copilot / OMP / Antigravity / Codex
  → record-backed garden id
    → entwurf_v2
      → control-socket | self-fetch mailbox | native-push
```

The package holds the v2 core, native-harness bridges, a pi adapter and an ACP
plugin. ACP is one ingress, not the boundary; pi is one adapter, not the center.
Claude and Cortex Code are ACP backends. Codex and Antigravity stay native so they
retain their own tools and work context. Capabilities differ by rail: a shipped
citizen is not a promise of every lifecycle operation.

> **Current release: [0.33.0](https://github.com/junghan0611/entwurf/releases/tag/v0.33.0)**
> ([`fea9b3d`](https://github.com/junghan0611/entwurf/commit/fea9b3dc4779ac5deb34e239abc8e0b5e3e95382)).
> Includes the pinned Pi 1.1.0 native durable app/TUI and one explicit native-module ingress;
> `npm` `latest` is `0.33.0`. What that cut ran and did not run is in its CHANGELOG section.
> Release history and detailed evidence belong in [CHANGELOG](./CHANGELOG.md).

## Install

**Choose by where you work. Bring your own harnesses, subscriptions and login.**
The native durable route below additionally supplies the upstream app/TUI missing from its npm
release; it does not supply credentials or take ownership of the harness.

### Direct — ordinary shell or tmux

Prerequisites: **Node >=24.0.0**, Python 3 for `setup`, and any harnesses you choose
to use, already installed and authenticated. Pi is optional-by-presence, supported
range `>=1.1.0 <1.2`; Claude Code supported floor `>=2.1.217` is required for its
managed exec-hook lifecycle. pnpm is needed only for source-checkout setup.

```bash
npm install -g @junghanacs/entwurf
entwurf setup /path/to/your-project
entwurf check-bridge
```

`setup` composes each harness it finds and reports PASS / SKIP / FAIL. An absent
harness is an explicit SKIP; a detected incomplete/below-floor integration is a
named FAIL with nonzero exit, not a false green. `check-bridge` proves the installed
MCP bytes boot and list tools without backend auth; it does **not** certify a real
model turn or native receive rail.

[Clean-host setup](./docs/setup-clean-host.md) owns project-local/source installs,
config paths, optional backends, doctors, upgrade/repair and uninstall.
Codex also needs your own hook-trust decision, app-server and exact-directory
consent: [the operator steps](./docs/setup-clean-host.md#three-operator-decisions-before-fresh).
Plain MCP registration alone does not make a garden citizen.

**Platform bounds:** Linux is the certified harness-rail axis. macOS Entwurf-only
installation is **CERTIFIED (CI)**, weaker than a physical-host doctor; its native
harness rails, ACP and mux remain **NOT CERTIFIED — pending physical host**.
Detected harness wiring on Darwin can therefore be written while setup stays
non-green. Native Windows is **UNSUPPORTED**. The package has no npm `os`
restriction; that is not certification of every platform's harness rails.

### Native durable (pi-durable)

**The package supplies the pinned upstream app/TUI and nine exact Pi 1.1.0 SDK
members.** No separate runtime checkout, patch, build or ordinary Pi CLI is needed.
The launch verifies carrier integrity and every reachable SDK edge's name/version;
incomplete, drifted or mixed supply refuses by name.

```bash
entwurf pi-durable --provider <provider> --model <model-id> --width task-wide
entwurf pi-durable --continue
```

The contact adds garden identity and two-way mailbox communication. Runtime/TUI,
models/auth, queues, SQLite, transcripts and recovery remain upstream-owned:
[Hard Rule 17](./AGENTS.md#hard-rules), **supply the missing surface; do not become the harness**.

Optional `--native-module <absolute file>` initializes trusted ESM before runtime/TUI
imports, then installs its default native Extension after the contact. Unreleased (#134):
`--native-module-dir <absolute directory>` loads the top-level `*.extension.mjs` files of that
one named directory in byte-wise order instead, and the durable TUI keeps a live
background-task badge on screen at any terminal size. No automatic module discovery or
classic Pi API shim; guards are not a sandbox or rollback.
Ordinary Pi's known `peerDependencies` warning reflects the separate native SDK supply.
[Native setup](./docs/setup-clean-host.md#2b-optional-native-durable-pi-durable)
owns flags, refusals and the extension contract.

### Herdr workbench

```bash
herdr plugin install junghan0611/entwurf/plugins/herdr --yes
```

This separate path activates Herdr-integrated **pi and Claude Code** with an
independently locked runtime and an observation pane; it puts no Entwurf bins on PATH.
An Entwurf release does not automatically re-pin that runtime.
[Herdr guide](./plugins/herdr/README.md) owns install, use, evidence and removal;
the plugin does not own delivery or the Herdr launch rail.

### Garden launcher

After direct setup, start a pi citizen in your project:

```bash
cd /path/to/your-project
entwurf pi
# equivalent when the package is registered (also the Herdr plugin's spelling):
pi --entwurf-control
```

`entwurf pi` execs your own pi with the control flag. A plain pi may load the
package without becoming a citizen. The record mints the garden id; do not inject
a session id. Native harness launch and manual Herdr argv instructions live in
[setup §2–§5](./docs/setup-clean-host.md#2-optional-pi-adapter--acp-plugin).

In that **harness session**, ask the agent to:

1. Call `entwurf_self` to confirm its authoritative identity.
2. Call `entwurf_peers` to discover existing citizens and their liveness facts.
3. Pick a live garden id and call `entwurf_v2` with a message, for example:

```json
{
  "target": "<garden-id from entwurf_peers>",
  "intent": "fire-and-forget",
  "message": "Hello from a sibling.",
  "wants_reply": true
}
```

These are tools, not shell subcommands. Pi calls
`mcp__entwurf_bridge__<verb>` through Pi's built-in MCP. The server exposes **eight**
verbs; a pi citizen has **six active + two hidden** (`entwurf_inbox_read` and
`entwurf_register_native`), since it has no mailbox and its own extension births it.
The server key stays `entwurf-bridge`. An operator/trusted-project MCP entry with
that normalized namespace can replace the registration by Pi's own precedence;
`/mcp` shows it, and Entwurf does not scan or fight that choice.

## Entwurf orchestration

One narrow dispatch capability connects independent siblings, not an agent factory.
The record is the **sole address authority**. A pane, socket, native transcript id,
model or process marker is a carrier or observation, never a second address axis.
Liveness is read at dispatch time; an id's shape does not tell you its transport.

### `entwurf_v2` — canonical dispatch verb

| What you want | Tool | What its receipt means |
|---|---|---|
| Message, reply or hand off to an existing garden id | `entwurf_v2 {target, intent:"fire-and-forget", message}` | Receiver acceptance boundary, mailbox enqueue or native injection; not completion |
| Open a new visible sibling | `entwurf_fresh_call {backend, model, task, cwd?}` | Launch receipt only; the sibling's nonce callback envelope supplies its new garden id |
| Reopen a dormant pi citizen under its own id | `entwurf_resume_call {target}` | Separate LAUNCH and socket OBSERVATION receipts; no turn is run |

**Delivery starts no process.** A live pi receives over its record-addressed Unix
control socket; an armed self-fetch citizen (Claude Code, Copilot, OMP, pi-durable)
through its mailbox; a probe-alive native-push citizen (Antigravity, Codex) through
its native conversation/thread. Dormant pi, undeliverable mailboxes, dead/indeterminate native
push and record-less sockets reject honestly. Only control-socket dispatch takes
the per-target lock; the other rails use their own deliverability/probe evidence.

A control-socket `sent` means a turn was triggered, not that the model read the
text. `queued-steer` and `queued-follow-up` are volatile process queues, with no
FIFO between them; abort drops them. `accepted-unknown-boundary` is acceptance
we cannot classify, never a reason to retry. A mailbox enqueue is a durable file
receipt. `wants_reply` is etiquette, not waiting, polling or ownership; replyability
is a live rail fact, not merely a consequence of trusted identity.
[DELIVERY](./DELIVERY.md#control-socket-acceptance-boundaries-120) owns these distinctions.

**Mux launches; it never delivers.** Inside Herdr, fresh opens a new unfocused tab
in the caller's workspace, pi/Claude Code only, with no tmux fallback. Outside,
it opens pi/pi-durable/Claude Code/Copilot/OMP/Codex visibly on the caller's own tmux
server. pi-durable runs the installed carrier on its exact SDK set described above and
refuses by name before any window when that verdict is not green; Herdr does not fresh-open it. The model is required; optional `cwd` is a literal
absolute directory, omitted or empty means the caller's cwd. Optional `placement.tmuxSession` names an existing
tmux session (not permitted inside Herdr), never a new session or a cwd lookup.
Omitted tmux placement follows the caller: Codex beside its own TUI pane matched
by thread-id, everyone else in their own session. Missing/ambiguous context refuses.
A launch receipt is neither the callback address nor proof of task processing.
Resume is pi-only, tmux-only, same id, record-supplied transcript/model/provider/cwd;
a live or non-pi target refuses, and an unobserved window stays visible without retry.
Exact boundaries: [tmux launch](https://github.com/junghan0611/entwurf/blob/main/docs/mux-launch-rail.md)
and [Herdr launch](https://github.com/junghan0611/entwurf/blob/main/docs/herdr-launch-rail.md).

## Concepts

**Entwurf** (기투, projection-of-self) connects independent visible siblings;
**garden id** names a record-backed citizen, not its pane or native transcript.
[FAQ](./FAQ.md) explains ACP, MCP and context carriers.

## Pi integration

The pi adapter registers the compiled bridge with Pi's built-in MCP after record
birth; Pi supervises the MCP child. **MCP is ingress; pi receive remains the
record-addressed Unix control socket.** Garden identity and dispatch stay Entwurf's.
Codemode is harness-internal, not another garden citizen.

## Operation guides

- [Settings and backend keys](./docs/setup-clean-host.md#settings-reference-and-backend-specific-keys)
- [External MCP registration](./docs/setup-clean-host.md#stable-bins-and-external-mcp-hosts) · [manual wiring](./docs/external-mcp-host.md)
- [Custom skills](./docs/setup-clean-host.md#custom-skills)
- [Context carriers](./docs/setup-clean-host.md#context-carriers)
- [Reuse and compaction](./docs/setup-clean-host.md#session-reuse-and-compaction) — native harness-owned; no transcript hydration

## What this repo owns, and does not

Owns: garden identity, live-fact dispatch and receipts, native bridge integrations,
visible lifecycle launch seams, the pi adapter and isolated ACP plugin lifecycle.
Does not: a second harness, memory DB, prompt reconstruction, transcript hydration,
credential mediation, subscription bypass, pane-typing delivery or hidden orchestration.
[AGENTS](./AGENTS.md) owns these invariants and exact capability boundaries.

## Verification surfaces

- [VERIFY](./VERIFY.md): evidence strength, deterministic/package gates and LIVE release protocol.
- [BASELINE](./BASELINE.md): operator-driven observations and dated host receipts.
- [DELIVERY](./DELIVERY.md): per-harness async receive capabilities, boundaries and limits.

Installation, a doctor, a fixture and an exact release candidate prove different things;
none is interchangeable with the others or an all-host/long-haul guarantee.

## References

- [FAQ](./FAQ.md) · [Clean-host setup](./docs/setup-clean-host.md) · [Release record](./CHANGELOG.md)
- [Current ordering](https://github.com/junghan0611/entwurf/blob/main/NEXT.md)
- [Adding a harness](https://github.com/junghan0611/entwurf/blob/main/docs/adding-a-harness.md)
- [ACP backend contract](./docs/acp-backend-rail.md)
- [xenodium/agent-shell](https://github.com/xenodium/agent-shell) — Emacs ACP client, `resume > load > new` origin
- [claude-agent-acp](https://github.com/agentclientprotocol/claude-agent-acp) — canonical Claude ACP server
- [agent-config](https://github.com/junghan0611/agent-config) — real consumer

## License

MIT
