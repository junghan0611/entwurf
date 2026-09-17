# Entwurf — a Herdr plugin

Two surfaces, and only two: one **install-time build** that makes the harnesses Herdr has
integrated into Entwurf citizens, and one **overlay pane** that shows which Herdr pane each
garden citizen is visible in, read once, when you ask.

Herdr owns the workbench — workspaces, tabs, panes, layout, and the agent lifecycle it
detects inside them. Entwurf owns the screwdriver — garden identity, official delivery,
receipts, named refusals. This plugin is the smallest useful place those two meet.

## Install

Developing from a checkout of this repository:

```bash
herdr plugin link "$PWD/plugins/herdr"
herdr plugin list --json
```

From anywhere, once the commit you want is pushed — an npm release is NOT a prerequisite,
because the committed lock names a commit of this repository rather than a registry version:

```bash
herdr plugin install junghan0611/entwurf/plugins/herdr
```

That install — and every reinstall, which is the refresh trigger — runs the one `[[build]]`
below, so this is also the command that makes Pi and Claude Code Entwurf citizens.

Open the pane:

```bash
herdr plugin pane open --plugin junghan0611.entwurf --entrypoint status
```

Remove it:

```bash
herdr plugin unlink junghan0611.entwurf      # a linked checkout: unregister, keep the files
herdr plugin uninstall junghan0611.entwurf   # a GitHub-managed install: unregister and delete
```

## What it needs

- **Herdr 0.9.0 or newer**, and you must open the pane from inside a Herdr session. That
  floor is the version this was measured against, not a guess; Herdr refuses to link a
  plugin whose `min_herdr_version` is newer than the running binary.
- **For the install-time build:** `git`, `node` >= 24, `npm`, and network access for the
  transient devDependencies the bridge build needs (~45s and a few hundred MB in an
  Entwurf-owned XDG npm cache, reclaimed by `herdr-plugin-deactivate`). You do **not**
  clone Entwurf, run `npm install`, or wait for an Entwurf npm release — the build acquires
  the exact artifact its committed lock names.
- **For the pane:** Entwurf on `PATH` as `entwurf`, or an absolute path in `ENTWURF_BIN`. If
  neither is present the pane prints exactly `entwurf-not-found` and exits 0 — a host
  without Entwurf is not a broken host, and the pane does not install one.
- **Node, for the pane entry itself.** It is a plain `.mjs` using only Node builtins — no
  `node_modules`, no `jq`; the manifest names `node` in its argv and nothing else.

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
as a hang. It is not: the third step packs the Entwurf source with `npm pack`, and that is simply
slow. You now get one line per step:

```text
[entwurf 1/5] reading herdr's integration status
[entwurf 2/5] planning activation for pi, claude-code
[entwurf 3/5] fetching and installing the Entwurf runtime from junghan0611/entwurf#cd303887 (git) — this is the long step (npm packs the source; expect minutes of silence)
[entwurf 4/5] checking what landed: @junghanacs/entwurf@0.21.0 and its activation verb
[entwurf 5/5] wiring pi, claude-code through the installed package
[entwurf done] @junghanacs/entwurf@0.21.0 active at ~/.local/share/entwurf/herdr-plugin/runtime/active; pi, claude-code wired
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

`./run.sh check-herdr-plugin-build` owns that composition. The real journey — a real
`herdr plugin install` driving a real `npm pack` of the product git spec — is
`LIVE=1 ./run.sh smoke-herdr-plugin-build-live`, because a git-spec pack builds the bridge through
`prepare`, which installs devDependencies from the registry: a network axis no deterministic gate
may claim.

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
| `npm` | exact `name@version` (coherent with this checkout's `package.json`) **plus** the sha512 npm published, compared against the tarball's own bytes before install | the production authority, unchanged |
| `herdr-checkout` | the **commit** Herdr itself checked out, packed from the fixed remote `git+https://github.com/junghan0611/entwurf.git#<full sha>` | verification-only: a candidate needs no npm release, which is what makes iterating on one cheap |

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
`0.21.0`.

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

**Switching the production source is a re-proof, not a config change.** Moving from the candidate
carrier to npm — or to a GitHub Release tarball plus its sha512 — re-decides where the bytes come
from, and the candidate's evidence does not transfer. Before such a release: exact acquisition and
integrity, the installed runtime (name@version, compiled entry, three executable bins, real
`check-bridge`), the swap and torn-swap recovery, activation and deactivation, and the
package-consumer proof all have to be re-run against that source.

## Not part of the npm package

`plugins/` is not in the `@junghanacs/entwurf` tarball. This plugin is consumed through
Herdr's own `plugin link` / `plugin install`, which is the only lifecycle that owns it.
