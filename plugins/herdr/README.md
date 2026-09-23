# Herdr Entwurf

**This plugin does not rebuild the Herdr workbench. It turns on the Entwurf driver inside the one
you already have.**

[Entwurf](../../README.md) is a garden-citizen dispatch substrate: it gives an already-running agent
session a **garden id**, an address that outlives the pane it happens to be drawn in, and one
official delivery verb for reaching it. That substrate is independent of Herdr and normally arrives
through an ordinary npm install. The cost of that route is the entry: you have to know the package
exists, install it, and run `entwurf setup` before anything is visible.

Herdr already solves the parts Entwurf should not re-solve — workspaces, tabs, panes, harness
integration, a plugin installer, and a status surface people already look at. So this plugin is two
things and deliberately not a third:

| | what it is |
|---|---|
| **an easy door** | one `herdr plugin install` acquires the Entwurf runtime and activates it for the pi and Claude Code sessions Herdr has already integrated |
| **an observation window** | one overlay pane that lays Entwurf's garden citizens beside Herdr's own agent list, read once when you ask |
| **not** | a second workbench, a second address space, or a delivery surface — the pane sends nothing and the plugin competes with nothing |

Herdr owns the workbench. Entwurf owns the screwdriver — garden identity, official delivery,
receipts, named refusals. This manifest is the smallest useful place those two meet: one `[[build]]`
and one `[[panes]]`, and no `[[startup]]`, `[[events]]`, `[[actions]]` or `[[link_handlers]]`
(`herdr-plugin.toml`).

---

## Which route do you want?

Entwurf has two installation routes and they are not competitors either. Pick by where you work.

| | **this plugin** | **direct install** |
|---|---|---|
| command | `herdr plugin install junghan0611/entwurf/plugins/herdr` | `npm install -g @junghanacs/entwurf` then `entwurf setup <project>` |
| where | inside a Herdr session | any shell, tmux, CI, a bare box |
| harnesses wired | pi and Claude Code, **and only if Herdr has integrated them** | every harness found on the host: pi, Claude Code, Codex, Copilot, Antigravity, OMP, the ACP rail — each reported PASS / SKIP / FAIL |
| puts `entwurf` on `PATH` | **no** | yes (six bins) |
| platform | `linux` (`platforms` in the manifest) | the npm package has no `os` restriction |
| gives you the status overlay | yes | no — that pane is this plugin |

They install the same **Entwurf capability package**, so the garden itself does not change shape by
route: the same garden ids, the same bridge verbs, the same refusals. But they do not guarantee the
same bytes. This plugin **pins** its runtime — `runtime-lock.json` names an exact
`@junghanacs/entwurf@<version>` and the sha512 npm published, and the build compares the tarball
against it before installing — while a direct `npm install -g @junghanacs/entwurf` follows whatever
version you ask npm for, `latest` by default. So check the installed version before comparing a
surface across the two routes. What else differs is how much of the host gets wired and how you start
things.

Neither route installs a harness, a subscription, or a login (AGENTS.md Hard Rule 17).

**One thing worth knowing before you choose:** the ability to open a sibling *in a Herdr tab* is not
owned by this plugin. `entwurf_fresh_call` is an Entwurf lifecycle surface that picks its rail from
the **calling process's own context** — inside Herdr (`HERDR_ENV=1`) it opens a new tab in the
caller's workspace; outside, it opens a visible tmux window. A pi wired by the direct route, running
in a Herdr pane, selects the Herdr rail exactly the same way. This plugin makes that capability easy
to *reach*; it does not own it and does not gate it.

---

## Who does what

### Herdr built-ins this plugin depends on

| built-in | what it gives | this plugin's use |
|---|---|---|
| `herdr integration install <agent>` | writes Herdr's own hooks/extensions into a harness's config directory so panes report agent lifecycle state | it is the **precondition**. The build reads `herdr integration status`; a harness Herdr has not integrated is not activated |
| `herdr integration status` | one prose row per harness — 18 rows on herdr 0.9.1 `[measured 2026-09-21]` | the sole source of the set `H` |
| `herdr plugin install / link / uninstall` | GitHub-managed or linked plugin lifecycle, with a `[[build]]` hook | the **only** door this plugin gets. Every install is also the refresh trigger |
| `herdr agent list` | Herdr's agents and their `agent_status` (`idle` / `working` / `blocked` / `done` / `unknown`) | one of the pane's two reads |
| `[[panes]]` overlay | a temporary zoomed view over the active pane that restores focus when it closes | the status surface |
| workspaces / tabs / panes / layout | placement | borrowed, never reimplemented. Entwurf's herdr rail asks for `tab create` + `agent start` and adds no layout axis |

Herdr also ships `agent prompt`, `agent send-keys`, `pane send-text` and `pane input`. Entwurf uses
**none** of them, on purpose, and that abstention is a gate rather than a promise:
`./run.sh check-typing-call-fence` scans production sources for those names. Measured in Herdr's own
source, `agent prompt` writes bracketed-paste bytes to the child's PTY and an encoded Enter 300 ms
later, and Herdr's own help says it "does not track turns" — that is input being written, not a
delivery receipt (`docs/herdr-launch-rail.md` §14).

### What Entwurf adds that Herdr does not sell

Herdr's address is scoped to a running server: a pane id is opaque and not stable across a workspace
move, an agent name is released when the agent ends, and `unknown` does not prove completion. That
is the correct behaviour for a workbench — persistent identity is not its job.

- **An address that outlives the pane.** A garden id is minted from a harness lifecycle hook and kept
  in a V3 record, outside Herdr's server, panes and processes.
- **One delivery verb with receipts.** `entwurf_v2` resolves the record, probes the rail, and returns
  one outcome — control-socket send, self-fetch mailbox, native-push injection, or a **named
  refusal**. It never types into a pane and never starts a process.
- **Named lifecycle verbs.** `entwurf_fresh_call` opens a sibling that does not exist yet;
  `entwurf_resume_call` reopens a dormant **pi** citizen under the same id, taking transcript, model,
  provider and cwd from the record, running no turn.

---

## Quick start

### The short version, if Herdr already integrated your harnesses

```bash
herdr plugin install junghan0611/entwurf/plugins/herdr --yes
pi --entwurf-control          # this pi is now a garden citizen
```

`--yes` is required whenever stdin is not a terminal; Herdr exits 2 without it, and that exit is
about the prompt, never about a missing Herdr server. (An install with no server running is fine —
measured completing through Herdr's offline-persist path on 0.9.1.)

### From a raw Linux box, in nine steps

Two of these steps are the ones nobody guesses. Herdr integrates a harness by writing into the
directory that harness owns, and it will not invent one: `herdr integration install pi` fails with
`pi extension directory not found at …/.pi/agent/extensions. install pi first`, and Claude with
`claude directory not found`. Starting each harness once is what creates those directories. Both
commands are ordinary invocations — no model turn, no login, no account.

```bash
# 1. pi — the range Entwurf declares as its peer, quoted so the shell keeps it in one word
npm install -g "@earendil-works/pi-coding-agent@>=0.87.1 <0.88"

# 2. herdr — see the herdr project for its own install
herdr --version

# 3. start pi once, so ~/.pi/agent exists (`pi --version` does NOT create it)
pi --help

# 4. integrate pi
herdr integration install pi

# 5. install this plugin — every install is also the refresh trigger
herdr plugin install junghan0611/entwurf/plugins/herdr --yes

# 6. pi is now active. Start it as a citizen:
pi --entwurf-control

# 7. Claude Code, and its own first run — `claude mcp list` creates ~/.claude
npm install -g @anthropic-ai/claude-code
claude mcp list

# 8. integrate Claude Code
herdr integration install claude

# 9. reinstall to refresh. The ledger widens to {pi, claude-code}; an ordinary
#    `claude` now picks up the entwurf tools through MCP.
herdr plugin install junghan0611/entwurf/plugins/herdr --yes
```

The pi range in step 1 is not a number this file chooses. It is the `peerDependencies` range Entwurf
publishes for `@earendil-works/pi-coding-agent` (`package.json`), and `check-dep-versions` fails if
this file and that pin disagree. The activation door enforces it too: `run.sh install-user-scope`
refuses an out-of-range pi by name and writes nothing — the same verdict `entwurf setup` gives — so
an unpinned `npm install -g` here would only move the failure to step 5.

### What you see while it runs

Answering `y` at the install prompt used to be followed by minutes of silence, which reads as a hang.
It is not: step 3 acquires and verifies the locked runtime over the network. You now get one line per
step, plus usage notes that say how to actually start each wired harness:

```text
[entwurf 1/5] reading herdr's integration status
[entwurf 2/5] planning activation for pi, claude-code
[entwurf 3/5] fetching and installing the Entwurf runtime from @junghanacs/entwurf@<version> from npm — this is the long step (npm acquires the locked artifact; expect minutes of silence)
[entwurf 4/5] checking what landed: @junghanacs/entwurf@<version> and its activation verb
[entwurf 5/5] wiring pi, claude-code through the installed package
[entwurf done] @junghanacs/entwurf@<version> active at ~/.local/share/entwurf/herdr-plugin/runtime/active; pi, claude-code wired
[entwurf] pi: start it as `pi --entwurf-control` to be a garden citizen — a plain `pi` loads this extension but has no garden id, no control socket and no entwurf tools.
[entwurf] pi: a model id looks like `openai-codex/gpt-5.6-terra` — provider-qualified.
[entwurf] claude-code: nothing to add — an ordinary `claude` picks up the entwurf tools through MCP.
[entwurf] claude-code: a model id looks like `claude-sonnet-5` — the vendor id, not a provider path.
```

**The two wirings are opposite, and neither is guessable from outside.** Claude Code gets an MCP
server, so an ordinary `claude` already has the tools. Pi gets a user-scope package registration, so
the extension loads in every pi session on the host — and that pi is still **not** a citizen until it
is started with `--entwurf-control`, because citizenship is argv-gated on purpose: a pi that minted a
record and a socket merely by starting would be deciding something the operator never asked for.

Those lines go to `/dev/tty`, not stdout. Herdr runs `[[build]]` with both streams piped into a
buffer it prints **only on failure** (`src/cli/plugin.rs:1328-1373` @ `c77af189`), so anything a
build writes normally is invisible when it succeeds. Where there is no terminal — CI, a pipe, a
daemon — the narration is silently absent and the install is unchanged. Every line is also mirrored
to stderr, so a failing build's error report arrives with the completed steps in front of it.

### First success: the status pane

```bash
herdr plugin pane open --plugin junghan0611.entwurf --entrypoint status
```

**A citizen is drawn as a ROW only if a Herdr pane reported it.** The pane joins on
`placement.kind === "herdr-pane"`, which Herdr can only report for a session running inside one of
its panes — so start pi with `pi --entwurf-control` *in a Herdr pane*, then open the overlay. A
citizen started anywhere else is still counted, under `unobserved`, which means nobody could observe
a placement for it, not that it is missing.

What you get is five columns and a diagnostics block:

```text
garden id  backend  cwd  placement  herdr-reported activity
```

`placement` is Entwurf's fact about where a citizen was observed. `herdr-reported activity` is
Herdr's judgement about a screen. They are separate columns under separate headings on purpose and
they must never be merged: a pane can outlive its process and a process can outlive its pane.
Activity is never used to decide whether a citizen is reachable — only `entwurf_v2` decides that, at
call time.

### Then: reach a sibling, or open one

From a wired session — a `pi --entwurf-control`, or an ordinary `claude` — the garden verbs are
present as tools. The pane tells you which ids exist; these do the work:

- `entwurf_peers` — the citizens and their liveness facts.
- `entwurf_v2 {target, intent:"fire-and-forget", message}` — deliver to a garden id. One outcome, or
  a named refusal.
- `entwurf_fresh_call {backend, model, task}` — open a sibling that does not exist yet. Inside Herdr
  it opens a **new unfocused tab in your own workspace** and admits `pi` and `claude-code` only;
  a `placement` argument is refused by name rather than quietly ignored, and there is no fallback to
  tmux. The model is required and has no default: pi wants a provider-qualified id like
  `openai-codex/gpt-5.6-terra`, Claude Code wants a vendor id like `claude-sonnet-5`. Each runtime
  owns its own grammar and this plugin validates neither.
- `entwurf_resume_call {target}` — reopen a dormant **pi** citizen under its own id.

Coordinates, refusals and orphan reclaim for the Herdr rail are owned by
[`docs/herdr-launch-rail.md`](../../docs/herdr-launch-rail.md); the tmux rail by
[`docs/mux-launch-rail.md`](../../docs/mux-launch-rail.md).

### Remove it

```bash
herdr plugin unlink junghan0611.entwurf      # a linked checkout: unregister, keep the files
herdr plugin uninstall junghan0611.entwurf   # a GitHub-managed install: unregister and delete
```

Herdr has **no cleanup hook**, so either command leaves the runtime and the harness wiring
**retained, not cleaned**. The explicit surface that takes them back ships in the npm package rather
than in the deleted checkout:

```bash
entwurf herdr-plugin-deactivate              # or <runtime>/node_modules/.bin/entwurf, since nothing is on PATH
```

It establishes every deletion authority before the first deletion, and removes components → runtime →
ledger, so the record outlives what it authorised.

---

## What the direct route gives you that this one does not

The plugin's narrowness is a deliberate frozen set, not a staging area. `P = {pi, claude-code}`, and
a wider host wants the direct route (`npm install -g @junghanacs/entwurf`, then `entwurf setup`).

| capability | plugin | direct |
|---|---|---|
| pi (control socket citizen) | ✅ user-scope wiring | ✅ user- or project-scope |
| Claude Code (self-fetch mailbox) | ✅ MCP registration | ✅ |
| Codex, Copilot, OMP, Antigravity rails | ❌ | ✅ where the harness is present |
| ACP rail (`pi --model entwurf/<claude model>`) | ✅ — the pi user-scope wiring registers the provider too | ✅ |
| `entwurf_fresh_call` backends | `pi`, `claude-code` | `pi`, `claude-code`, `copilot`, `omp`, `codex` |
| launch seat | a new tab in the caller's Herdr workspace | a visible tmux window, with an optional `placement.tmuxSession` expert seat |
| `entwurf`, `entwurf-bridge`, statusline/hook bins on `PATH` | ❌ | ✅ six bins |
| `entwurf setup <project>`, `entwurf doctor-*` repair surfaces | reachable only by absolute path under the runtime root | ✅ |
| platform | `linux` | no `os` restriction in the package |

The direct route is the **wider bench**: its tmux rail carries five fresh-call backends and the
operator-seat override, and `entwurf setup` reaches every harness rail the package ships. If you work
mostly outside Herdr, install directly and treat this plugin as optional — and note that installing
directly does **not** cost you the Herdr rail, because the rail is selected from the caller's process
context, not from how Entwurf got onto the machine.

---

## Neighbouring plugins, by mechanism

Herdr hands every plugin the same doors, so several plugins in this space look adjacent to this one.
The useful distinction is the **mechanism**, not the name, and mechanisms are stable where project
lists are not. These are observed mechanism families, not a census or a compatibility matrix; an
implementation can combine them.

| mechanism | how it addresses | how it delivers | what it inherits |
|---|---|---|---|
| **pane messengers** | a pane id or a call-sign bound to a live pane | typed text into the pane | the address dies with the pane; a restart is a new name |
| **doorbell + queue** | Herdr rings a pane; the payload waits on disk | the body is read from a file, not from the screen | a durable payload. Whether the ADDRESS is durable too is an implementation choice — some keep a pane-bound handle, others keep an identity beside it |
| **official-receive peers** | a live agent name or a harness-native session reference | a harness extension / MCP tool — no keystrokes | identity lifetime and receipt policy are implementation-specific |
| **spawners / swarmers** | a pane they created | start a pane and read the screen for completion | screen text as completion authority |
| **this plugin** | a garden id in a V3 record, outside Herdr | it does not deliver at all — `entwurf_v2` does, on an official receive surface | the address survives pane churn, a server restart, and the process itself |

Two things set that last row apart, and neither is a claim that nobody else manages it.

**Delivery is never typed text or a scraped screen.** That is a boundary a gate holds
(`check-typing-call-fence`), not a promise in prose — and this plugin does not deliver at all: it
shows you which ids exist, and `entwurf_v2` is what reaches them.

**The address is record-backed, so returning to it costs no rebinding step.** Durable identity that
outlives a pane exists elsewhere in this ecosystem; the part that differs is what you do when the
runtime is gone. Where a durable logical identity is re-attached to a new runtime by an explicit
adopt or rebind, a dormant pi citizen is reopened by `entwurf_resume_call {target}` — the same id is
the whole input, the record supplies transcript, model, provider and cwd, and no turn is run.

Where this plugin is genuinely *narrower* than its neighbours: it has no `[[actions]]`, no
`[[events]]`, and no write surface at all. That is in the manifest with its reason — an action's
stdout goes to a 64 KiB command log rather than to your eyes, and `pane.agent_status_changed` is
exactly the hook that would grow a watcher.

---

## Boundaries, and how failures read

### The pane will not

- **Write anything.** Not to `HERDR_PLUGIN_STATE_DIR`, not to `HERDR_PLUGIN_CONFIG_DIR`, not
  anywhere. It has no state and no config.
- **Install or configure anything**, and it touches no credential. That is the build's job, and the
  build runs only when Herdr installs or reinstalls this plugin.
- **Deliver.** No `entwurf_v2`, no fresh call, no resume. To reach a citizen, dispatch to its garden
  id from a wired session; this pane only tells you the ids exist and where they showed up.
- **Refresh.** It runs `entwurf peer-facts` once and `"$HERDR_BIN_PATH" agent list` once per open,
  lays them side by side, waits for one keypress, and exits. No retry, no watcher, no cache. Close it
  and open it again to re-read. (Both halves of that are load-bearing: Herdr publishes no "this
  pane's session reference has landed" event, so a loop around that gap would be the discovery
  watcher `docs/mux-launch-rail.md` §7 refuses by name; and `peer-facts` observes every citizen
  unbounded — measured at 4.1 s on a 1,150-record store, which is fine once when asked and wrong on a
  timer.)
- **Guess a join.** The only join is one **opaque pane-id string equality**: `peer-facts` reports
  `placement` as `{kind:"herdr-pane", paneId}` and that `paneId` is compared to Herdr's `pane_id`.
  The plugin never sees a native session id and never re-derives one from a session filename —
  Entwurf owns that conversion and a copy out here would fork a vendor floor. If two Herdr agents
  claim one pane, the activity column says `ambiguous` rather than picking one.
- **Show an empty table for a failed read.** Every way this can go wrong prints its own name.
- **Merge its four blocks into one verdict.** Herdr's integration listing is true *now*; the activation
  ledger is an *install-time* receipt nobody re-checked; the rails table is *static*; the citizen table is
  true *now*. Each block renders its own owner, its own observation time and its own outcome, and there
  is no aggregate green — a host whose integration is current, whose ledger is a week old and whose
  runtime has since been deleted is exactly the case a summary word erases.

### Two kinds of sibling, two promises about delivery (#120)

`entwurf_v2` answers with the boundary the RECEIVER observed, and the two rails this plugin wires
do not make the same promise:

- A **pi** sibling answers on a control socket. Idle → `sent`: its turn was triggered. Busy →
  `queued-steer` / `queued-follow-up`: accepted into one of two in-process queues that have no
  order between them and no durability at all — an abort in that session drops what is waiting.
- A **Claude Code** sibling answers through a disk mailbox. The message is a `*.msg` file written
  before any doorbell rings; filenames are ISO stamps, so a drain is a global FIFO, and an inbox
  nobody drains is refused honestly as `mailbox-undeliverable` rather than accepted into nothing.

Neither `sent` nor a queue word means the model has read the text. `DELIVERY.md` carries the full
table.

### The failure vocabulary

| what you see | what happened |
|---|---|
| `entwurf-not-found` (exit 0, CITIZENS block only) | no `ENTWURF_BIN`, no `entwurf` on `PATH`, and no certified activation ledger to fall back to. A host without Entwurf is not a broken host, so this is a **skip** — and only of the citizen axis: blocks 1-3 still render |
| `activation-reader-unavailable` | an activation ledger or runtime exists, but the installed runtime's own reader could not be imported. We hold a receipt we cannot read |
| `activation-ledger-missing` | a runtime is installed here and no ledger describes it — a partial install, a finished teardown, or a file removed under us. The runtime's own binary is not spent on a receipt we do not have |
| `activation-env-root-unresolvable` | a user root one of the layouts needs could not be resolved — with `HOME` unset, each of `XDG_DATA_HOME`, `XDG_CACHE_HOME` and `XDG_STATE_HOME` has to stand on its own, and the message names which one did not. The other three blocks still render |
| `activation-phase-not-active` (exit 0) | the ledger is certified and true, but its phase is `activating` or `deactivating` — wiring in flight, not a runtime standing ready. It is **reported, not red**, and it supplies no fallback binary |
| `activation-ledger-uncertified` | the installed runtime's reader refused the ledger body. Its reason is printed with it |
| `activation-runtime-root-mismatch` | the certified ledger describes a runtime root that is not the one this host derives — the receipt is about somewhere else |
| `runtime-bin-missing` | certified and aligned, but `node_modules/.bin/entwurf` under that root is gone or not executable |
| `herdr-integration-status-failed` | `herdr integration status` could not be run or answered non-zero |
| `herdr-integration-not-current` | a selected atom is `outdated` or `needs repair`. This is block [1]'s own red and the pane leaves non-zero; `not installed` is a reported **skip** at exit 0, not this |
| `entwurf-bin-not-absolute` | `ENTWURF_BIN` is set to a bare name; a second, quieter PATH lookup is not allowed |
| `entwurf-bin-not-executable` | `ENTWURF_BIN` points at something that is not an executable file |
| `herdr-bin-path-missing` | `HERDR_BIN_PATH` was not in the pane's environment |
| `peer-facts-failed` / `peer-facts-unparsable` | Entwurf answered non-zero, versus answered unreadably — different problems, different names |
| `herdr-agent-list-failed` / `herdr-agent-list-unparsable` | the same distinction on Herdr's side. A missing Herdr server lands here, red, rather than as an empty table |

The table itself is rationed, and only along the axis the pane exists for. Rows appear for
`herdr-pane` and `ambiguous` placements; the rest are **counted**, not dropped, and `unobserved` and
`none` are counted apart because they mean different things — `unobserved` is nobody having been able
to look, `none` is a placement owner read in full that does not have that citizen. With nothing
visible the table reads `(none)`.

Diagnostics keep their subject: which garden id the record-less socket is, which filename failed to
read. Every field the provider attached is shown, in sorted key order.

### Troubleshooting

| symptom | cause | fix |
|---|---|---|
| the build fails naming a selected atom as `outdated` or `needs repair` | Herdr's integration for pi or Claude is stale or unreadable — `outdated (legacy < vN)` is also what an empty or hand-written integration file looks like | `herdr integration install pi` (or `claude`) again, then reinstall the plugin |
| `pi extension directory not found` from `herdr integration install pi` | the harness has never run, so its config directory does not exist | run `pi --help` (or `claude mcp list`) once, then integrate |
| the install exits 2 immediately | stdin is not a terminal and `--yes` was not passed. This is about the prompt, not a missing server | add `--yes` |
| a plain `pi` has no entwurf tools | citizenship is argv-gated | start it as `pi --entwurf-control` |
| the CITIZENS block says `entwurf-not-found` | the plugin puts nothing on `PATH`, **and** this host's activation evidence granted no fallback — the skip line names which code that was — so nothing was activated here, or the activation block beside it names why | read the ACTIVATION block first: it is the one that says whether this host ever activated. `ENTWURF_BIN` remains available as an explicit override and always wins, but on a healthy install it should not be needed |
| your citizen is counted under `unobserved` instead of drawn as a row | the session is not running inside a Herdr pane Herdr can report a placement for | start it inside a Herdr pane |
| the build activates nothing and exits 0 | `A` is empty: Herdr has integrated neither pi nor Claude. A host that asked for nothing gets nothing written, and nothing removed | integrate a harness first |
| `pi --model entwurf/<claude model>` cannot start on NixOS | the ACP rail runs a dynamically linked vendor binary shipped inside the Claude Agent SDK, and stock NixOS cannot start one `[observed: GLG, raw PC, 2026-09-17]` | `programs.nix-ld.enable = true`. This is not a plugin failure, and the two things this plugin wires — `pi --entwurf-control` and an ordinary `claude` — need no such thing |

---

## Requirements

- **Herdr 0.9.0 or newer** — the ADMISSION floor, declared as `min_herdr_version` in
  `herdr-plugin.toml`; Herdr refuses to link a plugin whose floor is newer than the running binary.
  You must open the pane from inside a Herdr session.
  - That floor is not the same claim as the version this was MEASURED on. Entwurf's reproducible and
    CI rail is pinned to exactly **0.9.1** by `scripts/fixtures/herdr-supply.json`, which is what
    `check-herdr-sandbox` requires and what every receipt in this repo was taken against. A different
    Herdr inside the admission window is permitted and carries no receipt of ours.
- **For the install-time build:** `git`, `node` >= 24, `npm`, and network access for the locked
  registry artifact, in an Entwurf-owned XDG npm cache reclaimed by `herdr-plugin-deactivate`. You do
  **not** clone Entwurf or run `npm install`; the build acquires and integrity-checks the exact npm
  artifact its committed lock names.
- **For the pane:** nothing, on a host this plugin activated — the pane falls back to the runtime the
  certified activation ledger names. `ENTWURF_BIN` (absolute) and then `entwurf` on `PATH` are still
  honoured first and always win; the ledger is consulted only when you have set neither.
- **Node, for the pane entry itself.** It is a plain `.mjs` using only Node builtins — no
  `node_modules`, no `jq`; the manifest names `node` in its argv and nothing else.
- **A model id when you open a sibling.** `entwurf_fresh_call` has no default (see Quick start).

---

## The build, in detail

`herdr plugin install` runs `node lib/build.mjs` in the temporary checkout, and that is the only
command this manifest declares. It composes, in this order:

1. `herdr integration status` — Herdr's own answer to "what is integrated here", prose only, exit 0
   in every state it can describe. No binary, or a non-zero exit, is a **named refusal**: without a
   listing an empty stand-in would read as "nothing is integrated" and quietly activate nothing.
2. the pure profile leaf, which yields `A = E ∩ H ∩ P` with `P = {pi, claude-code}` frozen.
3. a selected atom Herdr calls `outdated` or `needs repair`, or a malformed or duplicated row for
   one, **fails here** — before any runtime work.
4. `A` empty is a clean exit 0 that writes **nothing** — no runtime, no wiring, and no removal.
5. the runtime bootstrap below.
6. activation of `A` **through the installed package**, never through this checkout: Herdr deletes
   the checkout on uninstall and calls no cleanup hook, so a checkout-side activation would be
   undoable only by code that is about to vanish. The installed entry's absence is a named refusal,
   and its capability is probed with a zero-write call whose own named refusal is the evidence.

`herdr integration status` is prose because Herdr has no machine format for it: measured against
0.9.0 and re-measured against 0.9.1, `--json`, `--format=json` and `-o json` each exit 2. So the rows
are the protocol, and a row is accepted **whole or not at all** — a state phrase, then exactly
` (<absolute path>)`, then end of line. The path is framing, never an address: `/srv/current (v9)/…`
is a legal directory name, so the state is matched front-anchored and the path never becomes a field.

Herdr's atom set grows and that is ordinary — 0.9.1 prints 18 rows where 0.9.0 printed 17, the one
addition being `letta (experimental)`, every other row byte-identical. The two rows this leaf reads
are unchanged. Unselected atoms are **observed, never planned**: OpenCode may be installed and
current and still receives no entry in the plan.

`./run.sh check-herdr-plugin-build` owns that composition. The real journey — a real
`herdr plugin install` acquiring the locked registry artifact — is
`LIVE=1 ./run.sh smoke-herdr-plugin-build-live`; it remains a network axis no deterministic gate may
claim. The `herdr-checkout` path is separately retained for candidate verification.

### The first-user-path receipt

`LIVE=1 ./run.sh smoke-herdr-raw-install-live --ref main` measures the nine steps above end to end in
a clean `node:24` container — no host config, cache, socket or repo mounted, no git `insteadOf`, the
remote spelled exactly as written here (`junghan0611/entwurf/plugins/herdr`). pi, Herdr and Claude
Code are installed in the image build as scaffolding; the product face under test begins at
`herdr integration install pi`.

It does not stop at the install. It then runs what those bytes became — the compiled bridge entry,
three executable bins, a real `entwurf check-bridge` listing its exact eight-verb set — starts a
citizen twice with no model turn (once on the wiring as `pi --entwurf-control`, once through the
shipped `entwurf pi` launcher), drives the status pane against the real `entwurf` and `herdr`
binaries, and finally tears the whole activation down and reinstalls onto the host it left.

**Current receipt:** PASS at `--ref main` against the public remote, runtime
`kind=npm @junghanacs/entwurf@0.24.0`, observed tarball sha256 `fd750bcb…` `[measured 2026-09-20 —
CHANGELOG.md]`. The resolved commit is printed by the gate, so the receipt stays exact as `main`
moves.

What the container cannot measure: a citizen drawn as a **ROW**. That needs
`placement.kind === "herdr-pane"`, and a headless container has no panes — so the row is evidence
only a real Herdr workbench can produce.

---

## The runtime, and the two sources it may come from

`scripts/herdr-runtime.mjs` (shipped; `lib/runtime-bootstrap.mjs` is a one-line re-export) acquires
Entwurf into an Entwurf-owned stable address, `$XDG_DATA_HOME/entwurf/herdr-plugin/runtime/active`.
That address is a **real directory**, because the scoped wiring records absolute commands under it
and pi records the owner root it was wired with; a per-version path would make every upgrade look
like a takeover. A candidate is staged beside it, verified as an installed package (exact
`name@version`, the compiled entry, all three required bins present *and executable*, and a real
`entwurf check-bridge` run), and only then replaces the active directory.

`runtime-lock.json` carries a **closed `source` discriminant**, and it is committed on purpose: an
environment variable or a caller flag would let whoever is running choose the acquisition authority,
and a fallback would turn an unreachable source into "install something else instead".

| `source` | anchor | what it is for |
|---|---|---|
| `npm` | exact `name@version` (coherent with this checkout's `package.json`) **plus** the sha512 npm published, compared against the tarball's own bytes before install | active production authority |
| `herdr-checkout` | the **commit** Herdr itself checked out, packed from the fixed remote `git+https://github.com/junghan0611/entwurf.git#<full sha>` | verification-only candidate path; it remains a closed source, not a fallback |

Three things about the checkout source are deliberate. There is **no input** anywhere in it — the
commit comes from the checkout's own `git rev-parse --verify HEAD^{commit}` (a shallow clone answers
that exactly as a full one does, which matters because Herdr's managed checkout *is* shallow) and the
repository is a literal on both sides of the wire. The **pack form is part of the contract**:
measured on npm 11.16.0, `npm pack <git spec>` runs `prepare` and not `prepack`, so the bridge is
compiled and no global pnpm is needed, while `npm pack <directory>` runs `prepack`, calls `pnpm` and
exits 127 on a clean host — only the git spec exists here. And since a commit has no published
integrity, what replaces it is stated rather than implied: the commit pins the tree, the digest
records the bytes, and the installed-runtime verifier decides. A remote that cannot serve the commit
is `runtime-checkout-source-unavailable` and **substitutes nothing**.

**The authority check happens before anything is installed.** The build asks — through the same
shipped functions the installed activation verb runs — whether this artifact may take over this
host's activation: are the recorded harness roots still these, is the ledger in a phase that can be
built over, does the ledger still describe the runtime actually standing at the root, and does the
request still cover every activated backend. A refusal there leaves the runtime, its journal, our
cache, the ledger and both harnesses' bytes exactly as they were found. (An earlier cut bootstrapped
first and refused afterwards, which left the stable root holding an artifact no record accounted for
while the run reported failure — and the wiring names that root, not the version.) After the install,
what landed must be exactly what was admitted; a source that moved in between is a named refusal.

**Records written before this contract are refused, not migrated.** A v1 journal or ledger fails
certification by name: the older shape cannot say WHICH artifact it was, so nothing can be inferred
from it. On such a host, run `entwurf herdr-plugin-deactivate` (or clear the runtime and ledger state
by hand) before installing again.

A **switch between the two sources is refused**, not inferred: it is a different acquisition
authority inheriting an existing activation, so it needs an explicit `herdr-plugin-deactivate` first.
Within one source, a new commit under the same stable root is a legal **rebind** — from a settled
ledger, with every component active and every activated backend still requested — and it lands in one
atomic ledger write. A version is never an identity here: two commits can both call themselves
`<version>`, which is exactly why the ledger binds the COMMIT.

**It puts nothing on `PATH`.** An earlier cut exposed bare `entwurf` / `entwurf-bridge` through an
owned bin directory; that was load-bearing on a condition nothing here can establish — there is no
reason a fresh `$XDG_DATA_HOME/…/bin` is on a clean host's PATH, and this plugin may not edit a shell
profile or write into a bin directory it does not own. The npm artifact the receipt above measured **does**
carry the `entwurf pi` launcher — that is where
`<runtime>/node_modules/.bin/entwurf pi` becomes a garden citizen with no model turn — but that bin is
reachable only by its absolute path under the runtime root. The command this README tells you to type
is therefore still `pi --entwurf-control`.

**Nothing at that address is moved without proof, and nothing is created before the judgement.** A
certified journal — exact keys, exact schema, a phase whose digest matches the writer state it
implies, an exact package identity, and *this host's* stable root — is the only thing that makes those
directories ours. A directory sitting there with no journal behind it is somebody else's, and the
transaction refuses rather than renaming it away, with its own root still absent. Disk facts come from
`lstat`, because `existsSync` calls a dangling symlink "absent" and a link into another tree "a
directory": only an absent path or a real directory may stand at these addresses.

**The last good runtime is never thrown away.** `active → previous` then `staging → active` is two
renames and a process can die between them, so all eight presence combinations are read as **states**
with names. A backup is not garbage merely because `active` also exists — which of the two is usable
is a question only inspection answers, so the backup is kept until `active` has been inspected, and
restored over it when `active` turns out to be corrupt. The provenance of the runtime being replaced
is carried in the journal for exactly as long as a backup can exist, so a host that dies mid-install
never holds recoverable bytes with unrecoverable provenance.

Two boundaries it will not cross. It installs the local tarball with `--ignore-scripts` into an
Entwurf-owned npm cache, because one plugin command is not consent to run a package's install hooks in
your HOME — so the artifact has to work with its own scripts never run, which is why completeness is
verified rather than assumed. (That flag belongs to the *install*; putting it on a pack would skip
`prepare` and produce a tarball with no compiled entry, which the verifier then refuses by name.) And
it records success as `runtime-ready`, never as "installed": `[[build]]` finishes *before* Herdr
re-reads the manifest, swaps its checkout and registers the plugin, so at that moment nobody knows
whether Herdr will commit.

**That gap is named, not closed.** If Herdr's own commit then fails, the runtime and the activation
this build performed simply remain — there is no cleanup hook for Herdr to call — and the next
successful install reconciles them rather than duplicating them. Nothing here calls the pair atomic.

**Where the real package is proven.** The focused gate drives a *fixture* package, which proves the
transaction and not this package. `./run.sh check-pack-install` packs this checkout, installs the
tarball into a fresh temp project, and runs the same `verifyInstalledRuntime` against it.

**Switching source is a re-proof, not a config change.** The active production lock is npm; moving
from `herdr-checkout` to npm — or to another future authority — re-decides where the bytes come from,
and candidate evidence does not transfer. Exact acquisition and integrity, the installed runtime
(`name@version`, compiled entry, three executable bins, real `check-bridge`), the swap and torn-swap
recovery, activation and deactivation, and the package-consumer proof must be re-run against that
source. Full protocol: [VERIFY.md](../../VERIFY.md).

---

## Developing from a checkout

```bash
herdr plugin link "$PWD/plugins/herdr"
herdr plugin list --json
herdr plugin pane open --plugin junghan0611.entwurf --entrypoint status
```

Relevant gates, none of which need a Herdr binary unless it says so:

| gate | subject |
|---|---|
| `./run.sh check-herdr-plugin` | manifest shape + the real pane entry driven against stubs: exactly one `peer-facts` and one `agent list` per open, named refusals instead of an empty table, zero writes |
| `./run.sh check-herdr-plugin-profile` | the pure `A = E ∩ H ∩ P` leaf against verbatim listing strings |
| `./run.sh check-herdr-plugin-build` | the one build runner and its composition order; one cell drives the real binary and SKIPs by name without it |
| `./run.sh check-herdr-runtime-bootstrap` | the acquisition/swap transaction against a fixture package — network zero |
| `./run.sh check-herdr-activation` | the scoped activation and its inverse, driving the real pi writers |
| `./run.sh check-herdr-sandbox` | a real Herdr binary on a private server; absent Herdr is a named SKIP, `ENTWURF_REQUIRE_HERDR=1` makes it red |
| `LIVE=1 ./run.sh smoke-herdr-plugin-build-live` | the real `herdr plugin install` journey on the checkout carrier |
| `LIVE=1 ./run.sh smoke-herdr-raw-install-live` | the first user path, in a clean container, on the npm carrier |

**`plugins/` is not in the `@junghanacs/entwurf` tarball.** This plugin is consumed through Herdr's
own `plugin link` / `plugin install`, which is the only lifecycle that owns it.
