# entwurf-receive-omp — the shipped OMP receiver unit (#87 bundle B)

The vendor-facing skeleton `./run.sh install-omp-receive` assembles from. Same layout as
the birth unit (`pi/meta-bridge-omp/entwurf-meta-omp/`), because omp discovers both by
the same rule — a subdirectory whose entry is `index.{ts,js}`
(`discovery/helpers.ts:625-712`).

```
<agent-dir>/extensions/entwurf-receive-omp/
  package.json                 <- this file (verbatim; `type: module` is load-bearing)
  index.ts | index.js          <- pi-extensions/meta-bridge-receive-omp.ts (or its dist twin)
  entwurf-capabilities.json    <- the registry metaCapabilitiesFilePath() resolves via ../
  lib/meta-session.ts | .js    <- the shared V3 reader/marker writer
  lib/session-id.js            <- the garden-id grammar leaf
```

**Why a second unit rather than a branch in the birth unit.** There is no second
*process* — an omp extension runs inside the operator's TUI, so both units share one pid,
and the step-7 rule that a second process earns a second install surface does not apply
literally here. What applies is the capability split: birth says *who sends*, receive says
*a reply can land*, and neither grants the other. Keeping them separable is also what lets
`check-omp-receive-arm` keep proving `[QK:OMP-BIRTH-DOES-NOT-ARM-RECEIVER]` — that the
birth unit arms nothing — as a live assertion rather than a historical note.

**Why it does not assume it loads after birth.** `[LIVE 2026-08-30]` extension handlers
fire in directory-name collation order: a probe unit named `aa-order-probe` ran its
`session_start` handler 20ms *before* the birth unit wrote its sender marker, and saw
nothing to join. `entwurf-receive-omp` sorts after `entwurf-meta-omp`, so today it would
arm on the first attempt — by accident. The unit carries a bounded `ctx.setInterval`
retry instead, cancelled with `ctx.clearTimer` (the vendor exposes no `clearInterval`;
calling one through `?.` is a silent no-op that leaves an uncancellable timer running in
the operator's TUI — measured).

**Why the retry is a timer and not an event subscription.** Every omp event except
`session_start` / `session_switch` requires a model turn or a keystroke `[LIVE
2026-08-27]`. A Copilot-style retry on turn edges would leave a freshly opened, idle
session unaddressable until the operator typed something — and waking an idle citizen is
the entire point of this unit.
