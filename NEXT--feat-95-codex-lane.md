# NEXT — feat/95-codex-lane

**Where the lane is.** `docs/adding-a-harness.md` **step 1 CLOSED**; steps 3–10 untouched.
Nothing installed, no hook, no record. **Step 2 turned out to be already spent and wrong:**
`codex` is in `META_BACKENDS`/`META_CITIZEN_BACKENDS` and graded `D6 direct-inject` in
`pi/entwurf-capabilities.json` with no channel behind it. Not corrected here (step 8 work).

**Landed.** `scripts/raw-codex-measure/{README.md,source-audit.md}` (six measurements + §3.5 +
tool dialect + the join, each with `[source] file:line` or a `[host]` receipt); raw probe re-run
green at 0.153.4; `DELIVERY.md` §Codex re-coordinated, 2026-08-01 decline marked reversed;
`AGENTS.md:31` likewise; `PIN_CODEX_MINOR` 0.144 → **0.153** re-verified
(`smoke-meta-async-drift` → `pass=13 fail=0 drift=0`).

**Judgment material for Step 2/3 — three answered.**

1. **Trusted birth event: `SessionStart`.** Fires on the FIRST TURN (~47s after window open),
   carries `session_id` + absolute `transcript_path` on stdin, nothing to guess. §3.5 is free —
   a subagent raises `SubagentStart`, a different event name.
2. **Receive rail: native-push, not self-fetch.** The only measured wake is app-server
   `turn/start` (full body injection + `thread/status/changed` completion), and it needs the
   auto-attach launch mode. No `watchPaths`/`FileChanged` analogue exists at 0.153.4.
3. **Join measured, and its owner moves with the mode.** Embedded: `hook.ppid == mcp.ppid ==
   the TUI`. App-server-attached (the delivery-capable mode): both are the **shared
   app-server**, so a parent-pid sender marker is one marker for N citizens — and the visible
   window's launch env never reaches the hook, so an env-planted provenance token is dead there.

**Two open blockers, before any Step 2 code** (plus one owed: an independent second-school
audit — every `[source]` row is currently one reader's).

- **Hook trust is interactive.** A new hook entry stops the TUI at "Hooks need review / Trust
  all and continue", then writes `trusted_hash` into `config.toml`. Next measurement: exercise
  `bypass_hook_trust` and managed requirements (`hooks/src/engine/discovery.rs:84-114`).
- **Clause 4 has no carrier.** Statusline is a closed enum; the one writable slot
  (`thread-title` via `thread/name/set`) is auto-titled by the vendor after the first turn.
  Next measurement: does an auto-title overwrite a name set through `thread/name/set`?
