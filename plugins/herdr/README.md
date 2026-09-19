# Entwurf — a Herdr plugin

Two surfaces, and only two: one **install-time build** that makes the harnesses Herdr has
integrated into Entwurf citizens, and one **overlay pane** that shows which Herdr pane each
garden citizen is visible in, read once, when you ask.

Herdr owns the workbench — workspaces, tabs, panes, layout, and the agent lifecycle it
detects inside them. Entwurf owns the screwdriver — garden identity, official delivery,
receipts, named refusals. This plugin is the smallest useful place those two meet.

## Install

**This is one of Entwurf's two installation routes.** It activates Entwurf for the pi and Claude
Code sessions Herdr has integrated, inside a Herdr workbench. If you are not in Herdr — or you want
the other native harnesses (Codex, Copilot, Antigravity, the ACP rail) — the direct route is the
root [README's Install section](../../README.md#install): `npm install -g @junghanacs/entwurf`
followed by `entwurf setup`. Neither route installs a harness, a subscription or a login.

### From a raw Linux box, in nine steps

Measured end to end in a clean `node:24` container on 2026-09-19 — no host config, cache or
socket mounted, no git `insteadOf`, the remote spelled exactly as written here. The receipt is
`LIVE=1 ./run.sh smoke-herdr-raw-install-live`, and there are **two of them**, kept apart because
they answer different questions.

- **(a) what a user gets today.** `ref=main` resolving to commit
  `37b81e725cde4d0a548f1c0faab4fcb5c62942b2`, runtime `kind=npm @junghanacs/entwurf@0.23.0`, and
  the activation ledger moving from `["pi"]` to `["pi","claude-code"]`. This is the baseline the
  nine steps below are written against.
- **(b) the branch state these nine steps were written on.**
  `herdr plugin install junghan0611/entwurf/plugins/herdr --ref set/119-verify-herdr --yes`,
  resolving to commit `1685d0786bb3d9ccd30514a3794bfdfd4f027193`, same npm runtime and same
  ledger transition, cells `[1]`–`[9]` PASS
  ([receipt](https://github.com/junghan0611/entwurf/issues/118#issuecomment-5740721948)).
  It carries four cells (a) did not: the install is followed by running what those bytes
  became, starting a citizen on the wiring with no model turn, driving the status pane against
  the real binaries, and tearing the whole activation back down and reinstalling.

The two are not interchangeable. (a) is the public commit, so it is the one a reader can
reproduce right now; (b) is a branch, so it is candidate evidence until that branch lands.

```bash
# 1. pi
npm install -g @earendil-works/pi-coding-agent

# 2. herdr — see the herdr project for its own install
herdr --version

# 3. start pi once. Not ceremony: herdr creates ~/.pi/agent/extensions only when
#    ~/.pi/agent already exists, so an agent that has never run cannot be integrated.
pi --help

# 4. integrate pi
herdr integration install pi

# 5. install this plugin. Every install is also the refresh trigger, so this is the
#    command that makes the integrated harnesses Entwurf citizens.
herdr plugin install junghan0611/entwurf/plugins/herdr --yes

# 6. pi is now active. Start it as a citizen:
pi --entwurf-control

# 7. Claude Code, and its own first run — herdr refuses to integrate it unless
#    ~/.claude is a directory, which `claude mcp list` is enough to create.
npm install -g @anthropic-ai/claude-code
claude mcp list

# 8. integrate Claude Code
herdr integration install claude

# 9. reinstall to refresh. The ledger widens to {pi, claude-code}; an ordinary
#    `claude` now picks up the entwurf tools through MCP.
herdr plugin install junghan0611/entwurf/plugins/herdr --yes
```

Steps 3 and 7 are the ones nobody guesses. Herdr integrates an agent by writing into the
directory that agent owns, and it will not invent one: pi fails with `pi extension directory
not found at …/.pi/agent/extensions. install pi first`, and Claude with `claude directory not
found`. Both commands above are ordinary invocations — no model turn, no login, no account.

`--yes` is required whenever stdin is not a terminal; herdr exits 2 without it, and that exit
is about the prompt, never about a missing herdr server. (An install with no server running is
fine: it was measured completing on 0.9.1 through herdr's offline-persist path.)

### What 0.3.0 does not give you

This release improves the install path and nothing else. With the runtime its lock names
(`@junghanacs/entwurf@0.23.1`) it does **not** ship:

- `entwurf pi`. The one-word launcher exists in the repository but is not in the npm artifact
  this lock names; it arrives with the next cut. Until then the command is `pi --entwurf-control`,
  exactly as step 6 spells it.
- Anything on your `PATH`. The status pane needs `entwurf` on `PATH` or an absolute
  `ENTWURF_BIN`; this plugin writes to neither.
- Any harness, subscription or login. Steps 1, 2 and 7 are yours.

### Developing from a checkout

```bash
herdr plugin link "$PWD/plugins/herdr"
herdr plugin list --json
```

### Open the pane

```bash
herdr plugin pane open --plugin junghan0611.entwurf --entrypoint status
```

**A citizen is drawn as a ROW only if a Herdr pane reported it.** The pane joins on
`placement.kind === "herdr-pane"`, which Herdr can only report for a session running inside
one of its panes — so start pi with `pi --entwurf-control` *in a Herdr pane*, then open the
overlay. A citizen started anywhere else is still counted, under `unobserved`, which means
nobody could observe a placement for it rather than that it is missing. The container
receipt above cannot measure this half: it is headless and has no panes, so the row is
evidence only a real Herdr workbench can produce.

### Remove it

```bash
herdr plugin unlink junghan0611.entwurf      # a linked checkout: unregister, keep the files
herdr plugin uninstall junghan0611.entwurf   # a GitHub-managed install: unregister and delete
```

## What it needs

- **Herdr 0.9.0 or newer** — the ADMISSION floor, declared as `min_herdr_version` in
  `herdr-plugin.toml`; Herdr refuses to link a plugin whose floor is newer than the running
  binary. You must open the pane from inside a Herdr session.
  - That floor is not the same claim as the version this was MEASURED on. Entwurf's reproducible
    and CI rail is pinned to exactly **0.9.1** by `scripts/fixtures/herdr-supply.json`, which is
    what `check-herdr-sandbox` requires and what every receipt in this repo was taken against. A
    different Herdr inside the admission window is permitted and carries no receipt of ours.
- **For the install-time build:** `git`, `node` >= 24, `npm`, and network access for the
  locked registry artifact (~45s and a few hundred MB in an Entwurf-owned XDG npm cache,
  reclaimed by `herdr-plugin-deactivate`). You do **not** clone Entwurf or run `npm install`;
  the build acquires and integrity-checks the exact npm artifact its committed lock names.
- **For the pane:** Entwurf on `PATH` as `entwurf`, or an absolute path in `ENTWURF_BIN`. If
  neither is present the pane prints exactly `entwurf-not-found` and exits 0 — a host
  without Entwurf is not a broken host, and the pane does not install one.
- **Node, for the pane entry itself.** It is a plain `.mjs` using only Node builtins — no
  `node_modules`, no `jq`; the manifest names `node` in its argv and nothing else.
- **On NixOS, `programs.nix-ld.enable = true`** if you intend to use the ACP rail
  (`pi --model entwurf/<claude model>`). `[관측: GLG, 날것 PC, 2026-09-17]` that rail runs a
  dynamically linked vendor binary shipped inside the Claude Agent SDK
  (`@anthropic-ai/claude-agent-sdk-linux-x64/claude`), and a stock NixOS cannot start one:
  `Could not start dynamically linked executable … NixOS cannot run dynamically linked
  executables intended for generic linux environments out of the box`. Nothing in Entwurf can
  fix that from inside the host, and it is not a plugin failure — the other rails are
  unaffected. The two things this plugin's build actually wires, `pi --entwurf-control` and
  an ordinary `claude`, need no such thing.
- **A model id when you open a sibling.** `entwurf_fresh_call` has no default, and the two
  harnesses spell them differently: pi wants a provider-qualified id like
  `openai-codex/gpt-5.6-terra`, Claude Code wants the vendor id like `claude-sonnet-5`. These
  are examples measured on one host, not a supported set; each runtime owns its own grammar
  and this plugin validates neither.

## What it does, exactly

On each pane open it runs two commands, **once each**:

```bash
entwurf peer-facts             # the garden citizens + their observed placement
"$HERDR_BIN_PATH" agent list   # Herdr's own agents and their activity
```

…lays them side by side, waits for one keypress, and exits. There is no refresh, no
retry, no watcher and no cache. Close it and open it again to re-read.

**The table is the citizens a placement owner reported; the rest are counted.** The read
is whole — every citizen is measured — but a store keeps its history, and drawing all of
it would bury the two citizens actually in this session. So rows appear for `herdr-pane`
and `ambiguous` placements, and the others are summarised beneath the table rather than
dropped. `unobserved` and `none` are counted apart on purpose: `unobserved` means nobody
could observe placement at all, `none` means the placement owner was read in full and
does not have that citizen. With nothing visible the table reads `(none)`.

The join between the two listings is **one opaque pane-id string equality**: `peer-facts`
reports `placement` as `{kind:"herdr-pane", paneId}`, and that `paneId` is compared to
Herdr's `pane_id`. The plugin never sees a native session id and never re-derives one
from a session filename — Entwurf owns that conversion, and a copy out here would fork it.
If two Herdr agents claim one pane, the activity column says `ambiguous` rather than
picking one.

## What the pane will not do

- **It writes nothing.** Not to `HERDR_PLUGIN_STATE_DIR`, not to
  `HERDR_PLUGIN_CONFIG_DIR`, not anywhere. It has no state and no config.
- **It installs and configures nothing**, and it touches no credential — that is the
  build's job, and the build runs only when Herdr installs or reinstalls this plugin.
- **It does not deliver.** No `entwurf_v2`, no fresh call, no resume. To reach a citizen,
  dispatch to its garden id; this pane only tells you the ids exist and where they show up.
- **`herdr-reported activity` is not liveness.** `idle` / `working` / `blocked` / `done` /
  `unknown` are Herdr's judgement about a screen. They live in their own column under
  their own heading, they are never merged with `placement`, and they must not be used to
  decide whether a citizen is reachable. A pane can outlive its process and a process can
  outlive its pane.
- **A failed read is never an empty table.** Each way this can go wrong prints its own
  name: `peer-facts-failed`, `peer-facts-unparsable`, `herdr-agent-list-failed`,
  `herdr-agent-list-unparsable`, `herdr-bin-path-missing`, `entwurf-bin-not-absolute`,
  `entwurf-bin-not-executable`. Only a missing Entwurf is a skip.
- **A diagnostic keeps its subject.** Which garden id the record-less socket is, which
  filename failed to read — a line that says only "a hazard exists" is one you cannot act
  on. Every field the provider attached is shown, in sorted key order.

## What the one `[[build]]` does

`herdr plugin install` runs `node lib/build.mjs` in the temporary checkout, and that is the only
command this manifest declares. It composes, in this order:

1. `herdr integration status` — Herdr's own answer to "what is integrated here", prose only, exit 0
   in every state it can describe. No binary, or a non-zero exit, is a **named refusal**: without a
   listing an empty stand-in would read as "nothing is integrated" and quietly activate nothing.
2. the pure profile leaf, which yields `A = E ∩ H ∩ P` with `P = {pi, claude-code}` frozen.
3. a selected atom Herdr calls `outdated` or `needs repair`, or a malformed/duplicated row for one,
   **fails here** — before any runtime work. `outdated (legacy < vN)` is also what an empty or
   unreadable integration file looks like, so treating it as absence would install a runtime for a
   harness whose integration cannot run it.
4. `A` empty is a clean exit 0 that writes **nothing** — no runtime, no wiring, and no removal. A
   host with neither harness integrated asked for nothing.
5. the runtime bootstrap below.
6. activation of `A` **through the installed package**, never through this checkout: Herdr deletes
   the checkout on uninstall and calls no cleanup hook, so a checkout-side activation would be
   undoable only by code that is about to vanish. The installed entry's absence is a named refusal,
   and its capability is probed with a zero-write call whose own named refusal is the evidence.

### What you will see while it runs

Answering `y` at the install prompt used to be followed by minutes of complete silence, which reads
as a hang. It is not: the third step acquires and verifies the locked runtime, and that network work
can be slow. You now get one line per step:

```text
[entwurf 1/5] reading herdr's integration status
[entwurf 2/5] planning activation for pi, claude-code
[entwurf 3/5] fetching and installing the Entwurf runtime from @junghanacs/entwurf@0.23.0 (npm) — this is the long step (expect minutes of silence)
[entwurf 4/5] checking what landed: @junghanacs/entwurf@<version> and its activation verb
[entwurf 5/5] wiring pi, claude-code through the installed package
[entwurf done] @junghanacs/entwurf@<version> active at ~/.local/share/entwurf/herdr-plugin/runtime/active; pi, claude-code wired
[entwurf] pi: start it as `pi --entwurf-control` to be a garden citizen — a plain `pi` loads this extension but has no garden id, no control socket and no entwurf tools.
[entwurf] claude-code: nothing to add — an ordinary `claude` picks up the entwurf tools through MCP.
```

The last two lines are the ones worth reading twice, because the two wirings are **opposite** and
neither is guessable from the outside. Claude Code gets an MCP server, so an ordinary `claude`
already has the tools. Pi gets a user-scope package registration, so this extension loads in every
pi session on the host — and that pi is still **not** a citizen until it is started with
`--entwurf-control`, because citizenship is argv-gated on purpose: a pi that minted a record and a
socket merely by starting would be deciding something the operator never asked for. A plain `pi`
after a green install says so once, on its own UI. If you want it shorter, that is your shell's
job — this plugin writes nothing to your PATH.

Those lines go to `/dev/tty`, not to stdout, and the reason is worth knowing if you ever wonder why
a build's output vanished. Herdr runs `[[build]]` with both streams piped into a buffer it prints
**only on failure** (`src/cli/plugin.rs:1328-1373` @ c77af189) — so anything a build writes normally
is invisible when it succeeds. Writing to the terminal directly is what reaches the person who typed
the command. Where there is no terminal — CI, a pipe, a daemon — the narration is silently absent
and the install is unchanged. Every line is also mirrored to stderr, so when a build *does* fail,
Herdr's error report arrives with the steps that completed in front of it.

`./run.sh check-herdr-plugin-build` owns that composition. The real journey — a real `herdr plugin install` acquiring the locked registry artifact — is
`LIVE=1 ./run.sh smoke-herdr-plugin-build-live`; it remains a network axis no deterministic gate
may claim. The `herdr-checkout` path is separately retained for candidate verification.

## The runtime, and the two sources it may come from

`scripts/herdr-runtime.mjs` (shipped; `lib/runtime-bootstrap.mjs` is a one-line re-export) acquires
Entwurf into an Entwurf-owned stable address, `$XDG_DATA_HOME/entwurf/herdr-plugin/runtime/active`.
That address is a **real directory**, because the scoped wiring records absolute commands under it
and Pi records the owner root it was wired with; a per-version path would make every upgrade look
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
that exactly as a full one does, which matters because Herdr's managed checkout *is* shallow) and
the repository is a literal on both sides of the wire. The **pack form is part of the contract**:
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
ledger, with every component active and every activated backend still requested — and it lands in
one atomic ledger write. A version is never an identity here: two commits can both call themselves
`<version>` — which is exactly why the ledger binds the COMMIT.

**It puts nothing on `PATH`.** An earlier cut exposed bare `entwurf` / `entwurf-bridge` through an
owned bin directory; that was load-bearing on a condition nothing here can establish — there is no
reason a fresh `$XDG_DATA_HOME/…/bin` is on a clean host's PATH, and this plugin may not edit a
shell profile or write into a bin directory it does not own. The scoped wiring will name absolute
commands under the stable root instead.

**Nothing at that address is moved without proof, and nothing is created before the judgement.** A
certified journal — exact keys, exact schema, a phase whose digest matches the writer state it
implies, an exact package identity, and *this host's* stable root — is the only thing that makes
those directories ours. A directory sitting there with no journal behind it is somebody else's, and
the transaction refuses rather than renaming it away, with its own root still absent. Disk facts come
from `lstat`, because `existsSync` calls a dangling symlink "absent" and a link into another tree "a
directory": only an absent path or a real directory may stand at these addresses.

**The last good runtime is never thrown away.** `active → previous` then `staging → active` is two
renames and a process can die between them, so all eight presence combinations are read as **states**
with names. A backup is not garbage merely because `active` also exists — which of the two is usable
is a question only inspection answers, so the backup is kept until `active` has been inspected, and
restored over it when `active` turns out to be corrupt. The provenance of the runtime being replaced
is carried in the journal for exactly as long as a backup can exist, so a host that dies mid-install
never holds recoverable bytes with unrecoverable provenance.

Two boundaries it will not cross. It installs the local tarball with `--ignore-scripts` into an
Entwurf-owned npm cache, because one plugin command is not consent to run a package's install hooks
in your HOME — so the artifact has to work with its own scripts never run, which is why completeness
is verified rather than assumed. (That flag belongs to the *install*; putting it on a pack would
skip `prepare` and produce a tarball with no compiled entry, which the verifier then refuses by
name.) And it records success as `runtime-ready`, never as "installed": `[[build]]` finishes *before*
Herdr re-reads the manifest, swaps its checkout and registers the plugin, so at that moment nobody
knows whether Herdr will commit.

**That gap is named, not closed.** If Herdr's own commit then fails, the runtime and the activation
this build performed simply remain — there is no cleanup hook for Herdr to call — and the next
successful install reconciles them rather than duplicating them. Nothing here calls the pair atomic.

Herdr has no cleanup hook, so `herdr plugin uninstall` leaves that runtime **retained, not
cleaned**. `entwurf herdr-plugin-deactivate`, shipped in the npm package rather than in the deleted
checkout, is the explicit surface that takes it back: it establishes every deletion authority before
the first deletion, and removes components → runtime → ledger so the record outlives what it
authorised.

**Where the real package is proven.** The focused gate drives a *fixture* package, which proves the
transaction and not this package. `./run.sh check-pack-install` packs this checkout, installs the
tarball into a fresh temp project, and runs the same `verifyInstalledRuntime` against it.

**Switching source is a re-proof, not a config change.** The active production lock is npm; moving
from `herdr-checkout` to npm — or to another future authority — re-decides where the bytes come
from, and candidate evidence does not transfer. Exact acquisition and integrity, the installed runtime
(name@version, compiled entry, three executable bins, real `check-bridge`), the swap and torn-swap
recovery, activation and deactivation, and the package-consumer proof must be re-run against that
source.

## Not part of the npm package

`plugins/` is not in the `@junghanacs/entwurf` tarball. This plugin is consumed through
Herdr's own `plugin link` / `plugin install`, which is the only lifecycle that owns it.
