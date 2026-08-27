# entwurf-meta-omp — the shipped OMP birth unit (#87)

This directory is the vendor-facing skeleton the installer assembles from. It is
deliberately almost empty: an omp "hook" is an in-process **extension**, so there is no
manifest of hook events and no launcher to `exec` — the whole unit is one module the omp
extension runner imports and calls (`docs/hooks.md` "Current status in runtime",
oh-my-pi v18.0.0).

What `./run.sh install-omp-bridge` puts beside this `package.json`:

```
<agent-dir>/extensions/entwurf-meta-omp/
  package.json                 <- this file (verbatim; `type: module` is load-bearing)
  index.ts | index.js          <- pi-extensions/meta-bridge-omp.ts (or its dist twin)
  entwurf-capabilities.json    <- the registry metaCapabilitiesFilePath() resolves via ../
  lib/meta-session.ts | .js    <- the shared V3 writer
  lib/session-id.js            <- the garden-id grammar leaf
```

**Why `index.*` and not a `package.json` manifest.** omp discovers an extension
subdirectory three ways: a direct `extensions/*.ts`, a `<subdir>/index.{ts,js}`, or a
`<subdir>/package.json` whose `omp`/`pi` field declares paths
(`packages/coding-agent/src/discovery/helpers.ts:625-712`). The index rule needs nothing
baked and already prefers `index.ts` over `index.js`, which is exactly the dev-clone vs
installed-package split this repo already has. A declared-path manifest would have to be
rewritten per install shape — a bake, and one more way for a half-finished install to
point at a file that is not there. The `package.json` stays for `type: module` (an
`index.js` with no nearest-package type field would be read as CommonJS) and for the
version the install-state joins on.

**Why the extensions directory and not `config.yml`.** Both are vendor-owned surfaces
(ledger M2). This unit is a whole artifact we create and can therefore remove exactly;
`~/.omp/agent/config.yml` is the operator's own SSOT (model roles, statusLine, plan) and
editing it would put entwurf inside a file it does not own for no capability it does not
already have. The MCP hand is the opposite case and does write a vendor config file —
`~/.omp/agent/mcp.json` — because there is no other way to hand omp the tools, and it
carries the preimage/inverse discipline that comes with that.
