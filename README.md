# entwurf

`entwurf` connects independent agent harnesses as visible siblings: open a new session,
reopen a supported dormant sibling in tmux, or reach an existing sibling by **garden id**. Fresh
sessions open in the caller's Herdr workspace or tmux session by default; explicit tmux
placement can name another existing session. Each harness keeps its own runtime,
authentication, tools and transcript.

![entwurf — a forged screwdriver for visible sibling sessions](docs/assets/entwurf-hero.jpg)

**Pi ↔ native Claude Code inside the [Herdr workbench](#herdr-workbench).**
A recorded source-checkout demo: callback → task → native Bash → reply.
[Source recipe and original provenance](demo/README.md#whole-herdr-pi--native-claude-code-138)
(the recipe creates a new take; the original private capture is not shipped).

![Pi and native Claude Code collaborating inside Herdr](docs/assets/entwurf-demo.gif)

[![npm](https://img.shields.io/npm/v/@junghanacs/entwurf?logo=npm)](https://www.npmjs.com/package/@junghanacs/entwurf) · maintained by [junghanacs.com](https://junghanacs.com/)

A sibling is a visible session with its own runtime boundary, not a disposable
worker or a subagent of a new central harness. Entwurf supplies identity, delivery,
receipts and named lifecycle verbs; the operator and native harnesses keep steering.
Git branches, worktrees, file isolation and internal delegation remain their concern.
[Short answers: FAQ](./FAQ.md).

| Verb | Tool | Where it lands | Harnesses |
|---|---|---|---|
| **Open** a new sibling | `entwurf_fresh_call` | Herdr: a new unfocused tab in the caller's workspace. tmux: a new window in the caller's session, or an existing session named by `placement.tmuxSession`; without an explicit tmux placement, a Codex caller opens beside its own TUI pane | Herdr: pi, Claude Code. tmux: pi, pi-durable, Claude Code, Copilot, OMP, Codex |
| **Reopen** a dormant sibling | `entwurf_resume_call` | A visible tmux window under the same garden id, with its record selecting the native session (Pi: identity-checked recorded transcript supplies launch metadata; Claude Code: `claude --resume <session id>` at the record cwd); the verb submits no prompt | pi, Claude Code |
| **Retire** one sibling the human operator explicitly requested (new in 0.41.0) | `entwurf_retire_call` | One guarded attempt on that target: a Pi shutdown request or Claude Code fd-pinned process termination. Refused/unknown outcomes remain possible; the record stays for guarded same-id return. Not a grant, a roster cleanup or an automatic retry | pi, Claude Code |
| **Message** an existing sibling | `entwurf_v2` | Its own rail: control socket, self-fetch mailbox or native push; delivery starts no process | pi, pi-durable, Claude Code, Copilot, OMP, Antigravity, Codex |

Antigravity is message-only: an existing conversation registers itself, and Entwurf never
launches one. A launch receipt is neither the new sibling's address nor proof that it
processed its task; the sibling's own callback envelope supplies its garden id.

The package holds the v2 core, native-harness bridges, a pi adapter and an ACP
plugin. ACP is one ingress, not the boundary; pi is one adapter, not the center.
Claude and Cortex Code are ACP backends. Codex and Antigravity stay native so they
retain their own tools and work context. Capabilities differ by rail: a shipped
citizen is not a promise of every lifecycle operation.

[Releases](https://github.com/junghan0611/entwurf/releases) contain each cut's notes and acceptance
receipts; [CHANGELOG](./CHANGELOG.md) records source history.

## Install

**Choose by where you work. Bring your own harnesses, subscriptions and login.**
The native durable route below additionally supplies an app/TUI, Entwurf's own thin composition of
the durable app upstream omits from its npm release; it does not supply credentials or take
ownership of the harness.

### Direct — ordinary shell or tmux

Prerequisites: **Node >=24.0.0**, Python 3 for `setup`, and any harnesses you choose
to use, already installed and authenticated. Pi is optional-by-presence, supported
range `>=1.3.0 <1.4`; Claude Code supported floor `>=2.1.306` is required for its
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
non-green. WSL2: a CI runner (experimental) measured the Entwurf-only install and a
zero-token Pi citizen; general, physical-machine or harness-parity WSL2 support is **not
declared**, and delivery, other harnesses and physical machines are unmeasured. Native
Windows has an **experimental first preview**, a CI-built x64 addon that ships in core
0.39.0 (published to npm); 0.38.1 and earlier carry no Windows addon. On a GitHub Actions
`windows-2025` x64 runner with Node 24.18.1 and Pi 1.3.0, a CI-built artifact was installed,
wired with `pi install`, birthed two Pi citizens and
delivered one garden-id `entwurf_v2` message between them, with an offline scripted model
and no vendor turn. Every other native-Windows surface (other harnesses, `setup` and the
`.sh` bins, fresh/resume, mux/Herdr/ACP, physical machines) is **not declared**; the
measured scope and its named gaps are in [BASELINE](./BASELINE.md#release-host-baseline).
The package has no npm `os` restriction; that is not certification of every platform's
harness rails.

### Native durable (pi-durable)

**The package supplies Entwurf's owned app/TUI carrier and nine exact Pi 1.3.0 SDK
members.** No separate runtime checkout, patch, build or ordinary Pi CLI is needed.
The launch verifies carrier integrity and every reachable SDK edge's name/version;
incomplete, drifted or mixed supply refuses by name.

```bash
entwurf pi-durable --provider <provider> --model <model-id> --width task-wide
entwurf pi-durable --continue
entwurf pi-durable --resume
```

`--continue` opens this directory's newest durable session. `--resume` lists its
sessions, most recently written first, by creation time, garden id and last write, and
reopens the one you choose as it was saved; a cancelled choice opens nothing.

The contact adds garden identity and two-way mailbox communication. Entwurf owns the
thin app/TUI composition (shipped as an emitted JS carrier); execution, models/auth, queues,
SQLite, transcripts and recovery remain the upstream SDK's:
[Hard Rule 17](./AGENTS.md#hard-rules), **supply the missing surface; do not become the harness**.

Optional `--native-module <absolute file>` initializes trusted ESM before runtime/TUI
imports, then installs its default native Extension after the contact.
`--native-module-dir <absolute directory>` (#134) loads the top-level `*.extension.mjs` files of that
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
`mcp__entwurf_bridge__<verb>` through Pi's built-in MCP. The 0.41.0 bridge exposes **nine**
verbs; a pi citizen has **seven active + two hidden** (`entwurf_inbox_read` and
`entwurf_register_native`), since it has no mailbox and its own extension births it.
Those counts describe the source; a running host offers what its already-loaded bridge
listed, so see [applying new source to a running host](./docs/setup-clean-host.md#applying-new-source-to-a-running-host).
The server key stays `entwurf-bridge`. An operator/trusted-project MCP entry with
that normalized namespace can replace the registration by Pi's own precedence;
`/mcp` shows it, and Entwurf does not scan or fight that choice.

## Entwurf orchestration

One narrow dispatch capability connects independent siblings, not an agent factory.
The record is the **sole address authority**. A pane, socket, native transcript id,
model or process marker is a carrier or observation, never a second address axis.
Liveness is read at dispatch time; an id's shape does not tell you its transport.

### `entwurf_v2` — canonical dispatch verb

```text
pi / pi-durable / Claude Code / Copilot / OMP / Antigravity / Codex
  → record-backed garden id
    → entwurf_v2
      → control-socket | self-fetch mailbox | native-push
```

| What you want | Tool | What its receipt means |
|---|---|---|
| Message, reply or hand off to an existing garden id | `entwurf_v2 {target, intent:"fire-and-forget", message}` | Receiver acceptance boundary, mailbox enqueue or native injection; not completion |
| Open a new visible sibling | `entwurf_fresh_call {backend, model, task, cwd?}` | Launch receipt only; the sibling's nonce callback envelope supplies its new garden id |
| Reopen a dormant pi or Claude Code citizen under its own id | `entwurf_resume_call {target}` | Separate LAUNCH and OBSERVATION receipts (pi: same-id socket; Claude Code: a new live receiver marker in the opened pane, bound to the record); the verb submits no prompt |
| Attempt retirement of one explicitly requested Pi or Claude Code target (new in 0.41.0) | `entwurf_retire_call {target}` | Separate action, append-only record and lock-release results. Pi ACK is request-only; CC exit is that fd-pinned process only |

**Retirement is never autonomous.** Invoke it only for a target/action the human operator explicitly requested; development, coordinator status and caller identity are not standing permission. Where a host provides or is configured with an approval step, that step applies as well; Pi and pi-durable 1.3.0 have no built-in approval prompt by default. The configured Claude ACP child is likewise [set to run without per-call permission prompts](./docs/acp-backend-rail.md#configured-claude-acp-permissions); ACP retirement remains unmeasured. Tool annotations and the caller's identity are hints and attribution, not permission. No roster expansion, timer or automatic retry of an unknown/cancelled/lost result. The retirement path records requested/outcome events under a target-gid sidecar; absence is unknown, not proof of no retirement. Source, compiled fixture, Native/LIVE, rollout and release acceptance remain separate: one dated test-owned [Native round trip per backend](./BASELINE.md#147-native-round-trip-2026-10-22-n1) is recorded, which is neither a release gate nor a rollout claim.

**Delivery starts no process.** A live pi receives over its record-addressed control
address (a Unix socket; on the experimental native-Windows Pi preview, a named pipe);
an armed self-fetch citizen (Claude Code, Copilot, OMP, pi-durable) through its mailbox; a probe-alive native-push citizen (Antigravity, Codex) through
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

**One declared remote pair (opt-in, #107).** The operator places an `entwurf-remote-pair.json` on each of two hosts. Then `entwurf_v2` to the declared remote garden id runs the other host's `entwurf remote-pair-receive` once over the operator's own SSH, and that host checks the pair and dispatches locally. The trust is the same operator's SSH account. It makes one attempt with no retry, and it uses no relay or listener. [DELIVERY](./DELIVERY.md#remote-pair-107-one-declared-pair-across-two-hosts) owns the contract; [setup](./docs/setup-clean-host.md#2c-optional-remote-pair-between-two-hosts-107) covers the operator steps.

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
Resume is pi or Claude Code, tmux-only, same id, with the record as the sole address authority.
For Pi, the record selects the absolute transcript and its native id must match; the transcript's
session-header cwd and first `model_change` provider/model feed the launch resolver, without a
record/host cwd fallback. Claude Code uses `claude --resume <record session id>` at the record cwd,
without restoring model or permission flags;
a live, unprovably dormant, unbound or other-backend target refuses, and an unobserved window
stays visible without retry. Claude Code's [V3 arm binding](./docs/adding-a-harness.md#arm-binding-within-v3)
is a record–receiver witness, not a new identity or an occupancy/permission token.
Claude Code dormancy is read only from attaches the Entwurf hook committed: a process that
holds the session without one (hooks disabled, a lock timeout or store failure at its start)
is invisible to that check.
Claude Code same-id resume is new in 0.41.0. One dated test-owned
[Native round trip](./BASELINE.md#147-native-round-trip-2026-10-22-n1) was measured; its
release acceptance remains separate from the shipped Pi resume history.
Exact boundaries: [tmux launch](https://github.com/junghan0611/entwurf/blob/main/docs/mux-launch-rail.md)
and [Herdr launch](https://github.com/junghan0611/entwurf/blob/main/docs/herdr-launch-rail.md).

## Concepts

**Entwurf** (기투, projection-of-self) connects independent visible siblings;
**garden id** names a record-backed citizen, not its pane or native transcript.
[FAQ](./FAQ.md) explains ACP, MCP and context carriers.

## Pi integration

The pi adapter registers the compiled bridge with Pi's built-in MCP after record
birth; Pi supervises the MCP child. **MCP is ingress; pi receive remains the
record-addressed control address (a Unix socket, or the native-Windows preview's named
pipe).** Garden identity and dispatch stay Entwurf's.
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
