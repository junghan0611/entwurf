# Entwurf — a Herdr plugin

One overlay pane that shows which Herdr pane each Entwurf garden citizen is visible in,
read once, when you ask.

Herdr owns the workbench — workspaces, tabs, panes, layout, and the agent lifecycle it
detects inside them. Entwurf owns the screwdriver — garden identity, official delivery,
receipts, named refusals. This plugin is the smallest useful place those two meet.

## Install

Developing from a checkout of this repository:

```bash
herdr plugin link "$PWD/plugins/herdr"
herdr plugin list --json
```

Once this lane is published, from anywhere:

```bash
herdr plugin install junghan0611/entwurf/plugins/herdr
```

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
- **Entwurf on `PATH` as `entwurf`**, or an absolute path in `ENTWURF_BIN`. If neither is
  present the pane prints exactly `entwurf-not-found` and exits 0 — a host without
  Entwurf is not a broken host, and installing Entwurf is not a plugin's job.
- **Node.** The pane entry is a plain `.mjs` that uses only Node builtins — no
  `node_modules`, no build step, no `npm install`, no `jq`. Entwurf is itself a Node
  package, so a host that has Entwurf has Node; the manifest names `node` in its argv and
  nothing else.

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

## What it will not do

- **It writes nothing.** Not to `HERDR_PLUGIN_STATE_DIR`, not to
  `HERDR_PLUGIN_CONFIG_DIR`, not anywhere. It has no state and no config.
- **It installs and configures nothing**, and it touches no credential.
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

## The runtime leaf, not yet wired

`lib/runtime-bootstrap.mjs` is present but **nothing calls it**: no manifest section, no pane, no
harness activation. It exists so the next slice has a measured transaction to build on, and it is
covered by `./run.sh check-herdr-runtime-bootstrap`.

What it will own, when it is wired: acquiring the exact `@junghanacs/entwurf` version named by
`runtime-lock.json` — which must agree with this checkout's own `package.json` — into an
Entwurf-owned stable address, `$XDG_DATA_HOME/entwurf/herdr-plugin/runtime/active`. That address is
a **real directory**, because the scoped wiring one slice above will record absolute commands under
it and Pi records the owner root it was wired with; a per-version path would make every upgrade look
like a takeover. A candidate is staged beside it, verified as an installed package (exact
`name@version`, the compiled entry, all three required bins present *and executable*, and a real
`entwurf check-bridge` run), and only then replaces the active directory.

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

Two boundaries it will not cross. It installs with `--ignore-scripts` into an Entwurf-owned npm
cache, because one plugin command is not consent to run a package's install hooks in your HOME — so
the artifact has to work with its own scripts never run, which is why completeness is verified
rather than assumed. And it records success as `runtime-ready`, never as "installed": `[[build]]`
finishes *before* Herdr re-reads the manifest, swaps its checkout and registers the plugin, so at
that moment nobody knows whether Herdr will commit.

Herdr has no cleanup hook, so `herdr plugin uninstall` leaves that runtime **retained, not
cleaned**. A separate explicit Entwurf surface will own removing it; the inverse here establishes
every deletion authority before the first deletion, and removes cache → runtime → journal so the
ledger outlives what it authorised.

**Where the real package is proven.** The focused gate drives a *fixture* package, which proves the
transaction and not this package. `./run.sh check-pack-install` packs this checkout, installs the
tarball into a fresh temp project, and runs the same `verifyInstalledRuntime` against it.

## Not part of the npm package

`plugins/` is not in the `@junghanacs/entwurf` tarball. This plugin is consumed through
Herdr's own `plugin link` / `plugin install`, which is the only lifecycle that owns it.
