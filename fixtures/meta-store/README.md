# fixtures/meta-store — frozen host state for the upgrade proof

These files are **not** package content and **not** test scaffolding that may be
regenerated. They are the meta-record store a development machine already had
*before* the #50 V3 hard cut, frozen as bytes, so the three upgrade cells can
hand a real candidate artifact a real pre-cut host:

| cell | surface | how it consumes these |
|---|---|---|
| source | `run.sh check-upgrade-gate` | `../seed-store.sh` copies them into an mkdtemp world |
| installed package | `run.sh check-pack-install` | same seeder, into a sandbox `$HOME/.pi/agent/meta-sessions` |
| container | `run.sh check-install-container` | shipped in as a base64 tar, manifest re-verified on arrival |

## Why frozen, and not generated

The obvious alternative is to mint these records with `serializeMetaIdentity` at
test time. That would quietly void the central assertion. `migrate` claims the
pre-migration backup holds the **original bytes**; comparing that backup against
a record the code under test just produced proves only that the code agrees with
itself. Comparing it against a constant checked in here proves the claim.

The same reasoning gives the second rule: **nothing may reformat these files.**
`fixtures/` is excluded from biome in `biome.json` for exactly that reason — the
formatter's tab indentation would rewrite the canonical 2-space form the v3
record must keep, and `20260307T000000-ffff07.meta.json` is deliberately invalid
JSON (the shape a crashed writer leaves behind), which a formatter cannot parse
and must not try to fix.

## Contents

| file | schema | what it stands for |
|---|---|---|
| `records/20260302T000000-bbbb02.meta.json` | v2 | an ordinary pre-cut record — `parentGardenId: null`, `isEntwurf: false`; migrates silently |
| `records/20260305T000000-dddd05.meta.json` | v2 | carries a **non-null `parentGardenId`** — a value only a human may discard |
| `records/20260306T000000-eeee06.meta.json` | v2 | carries **`isEntwurf: true`** — the retired species axis, same disposition rule |
| `records/20260401T000000-cccc03.meta.json` | v3 | an already-migrated record; byte-identical to today's canonical serialization |
| `records/20260307T000000-ffff07.meta.json` | — | truncated/corrupt; must refuse with its OWN cause, never be sold as migratable |

`hosts.json` composes those records into the states a machine can actually be
in: `absent`, `empty`, `v3-only`, `v2-only`, `mixed`, `v2-parentage`,
`malformed`, and `mixed-problem` (v2 plus malformed). A host state is only a list — the record bytes are identical
whichever state uses them, so the cells cannot disagree about what the host had.

## Changing them

`MANIFEST.sha256` is the contract, and `check-upgrade-gate` carries the same
hashes a second time as its own constants. Both must be updated in one change,
which is deliberate: re-baselining an upgrade proof should take two edits and a
reviewer who sees both, never a `sha256sum > MANIFEST.sha256` reflex.

```bash
sha256sum hosts.json records/*.meta.json > MANIFEST.sha256   # then update the gate constants too
```
