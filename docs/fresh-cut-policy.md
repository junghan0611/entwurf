# Fresh-cut policy

The bridge is a call relay, not a memory layer. Meta-records are routing state for
the **current generation**; native transcripts and external memory stores remain
owned by their harnesses.

## Generation contract

1. The active citizen store is **V3-only**. Garden addresses and resume authority
   never continue across generations.
2. Install and citizen birth certify the active store **before writing**. Any
   defect refuses the operation and names `entwurf meta-bridge-fresh-cut`.
3. A fresh cut requires proven quiescence, archives the whole active generation,
   and opens an empty one. It never closes a session for the operator.
4. Archives are forensic bytes only. No runtime reads them, no restore verb exists,
   and native transcripts and memory axes are untouched.

There is no legacy reader or migrator. A native conversation that survives a cut
receives a new garden id when its next trusted hook or registration births it in
the new generation.

## What certification checks

`certifyActiveStore` is shared by the doctor and all identity writers: pi birth,
Claude's `SessionStart`, agy's imprint, and `entwurf_register_native`. Every active
record must be:

- a regular, non-symlink `.meta.json` file;
- readable by the live V3 schema;
- named by the `gardenId` in its body;
- the unique owner of its `nativeSessionId`.

Previous-generation records, corruption, filename/body drift, duplicate native
identity, and symlinks all fail certification. Address-bearing reads additionally
refuse duplicate ownership before a record becomes a dispatch or resume target.
`entwurf_peers` keeps healthy citizens visible and reports bad entries as diagnostics;
it never turns an ambiguous record into authority.

Targeted mailbox and sender-marker reads enforce the per-entry half of the same
contract. They do not rescan the entire store on every relay operation. Record bytes
are opened without following symlinks; implementation and race proofs live beside
`readStoreRecordFile` and in the `check-meta-*` gates.

## Running a cut

First close every pi, Claude Code, and agy session that could own a citizen or
transport artifact. Then run:

```bash
entwurf meta-bridge-fresh-cut
```

Quiescence fails closed. A live control socket, a marker with a live owner, a
probe-alive native-push conversation, or a surface whose state cannot be proved
all refuse the cut before anything moves. Absence means `ENOENT`; unreadable,
indeterminate, or symlinked state is not treated as absent.

The one bounded exception is an impossible owner pid (`<=1` or non-integer) on the
certified Linux desktop/workstation axis. Current writers cannot mint such a marker,
so it is reported and swept as refuted legacy/corrupt residue. A harness running as
PID 1 is outside the certified axis and fails closed.

### Exit contract

| Exit | State | Next action |
|---|---|---|
| `0` | Cut complete | Run the appropriate installer/setup. |
| `1` | Nothing moved | Fix the named live, unreadable, or occupied condition and retry. |
| `2` | Usage error; nothing moved | Fix the command. |
| `3` | Transition incomplete after at least one archive move | Inspect or rerun to finish under a new stamp. |
| `4` | Cut complete; stale marker/socket cleanup failed | Setup may proceed, but repair the named residue first when possible. |

Only exit `0` is ordinary success. Exit `4` confirms a new generation is open but
still reports cleanup debt. Do not rerun an exit-4 cut after new citizens have been
born: that would archive the new generation too.

For the common path:

```bash
entwurf meta-bridge-fresh-cut && entwurf setup /path/to/project
```

## Upgrade order

A checkout-backed host can begin running new code immediately after `git pull`, so
make the boundary explicit:

```text
quiesce sessions → update package/checkout → fresh-cut if prescribed → reinstall/setup → reopen
```

The preflight is not a transaction or a global lock. Concurrent native births can
race after certification, which is why discovery and address-bearing reads still
check uniqueness. If a later doctor turns red, stop and preserve the store before
cutting again.

Source of truth: `pi-extensions/lib/meta-session.ts`, the fresh-cut implementation,
`check-meta-*`, and `check-fresh-cut-gate`. Historical incidents and defect chronology
belong in CHANGELOG/issues rather than this operator policy.
