# NEXT — feat/95-codex-lane

**Where the lane is.** `docs/adding-a-harness.md` **step 1 CLOSED**, including Step 1b's three
follow-up measurements. Steps 3–10 untouched: nothing installed, no hook, no record.
**Step 2 turned out to be already spent and wrong:** `codex` is in
`META_BACKENDS`/`META_CITIZEN_BACKENDS` and graded `D6 direct-inject` in
`pi/entwurf-capabilities.json` with no channel behind it. Not corrected here (step 8 work).

**Independent audit:** terra, against `87ac7ad` — **20/20 quotations CONFIRMED, 0 corrected**.
Its three prose defects are folded into `raw-codex-measure/` and marked there. Sections
M-A/M-B/M-C were measured after that audit and have no second reader.

**Both Step-1b forks are GONE — measured, not decided.**

- **Hook trust (was fork 1).** `[host]` A hook in the managed `/etc/codex/config.toml` layer
  runs with **no trust prompt**, in the embedded AND the auto-attach mode, with a raw
  `turn/start` wake working alongside it (README §M-A1, §M-A3). `[host]`
  `--dangerously-bypass-hook-trust` also runs the hook but **kills auto-attach**
  (`thread/loaded/list` → `[]`), so it is unusable for entwurf (§M-A2).
  **The remaining constraint is ownership, not capability:** `/etc/codex/` is root-owned, so
  this is a root-level operator step, never something `entwurf setup` can write (Hard Rule 17).
- **Clause 4 visible identity (was fork 2).** `[host]` `thread/name/set` + `[tui] status_line =
  ["thread-title", …]` renders a garden id and **survives turns in both orderings** — including
  when the vendor auto-titles first (README §M-B). `[source]` the auto-titler is guarded on
  `thread_name().is_none()` (`tui/src/app/thread_routing.rs:1841`), so this is structural, not
  luck. Costs: the carrier is reached over the **app-server** (auto-attach only), and
  `[tui] status_line` needs a config writer that owns exactly that key.

**Judgment material for Step 2/3.**

1. **Trusted birth event: `SessionStart`**, fired on the FIRST TURN, carrying `session_id` +
   absolute `transcript_path`. §3.5 is free: a subagent raises `SubagentStart`.
2. **Receive rail: native-push, not self-fetch.** The only measured wake is app-server
   `turn/start`; there is no `watchPaths`/`FileChanged` analogue at 0.153.4.
3. **The join is measured broken for identity, not merely suspected** (README §M-C): two
   citizens on one app-server, two windows, **one `ppid` for every hook and MCP child of both**,
   neither TUI in the chain. A parent-pid sender marker cannot separate them — Hard Rule 7
   `nativeSessionId` uniqueness needs a different key. **This is the open design question the
   next step has to answer**, and it is the only one left.

**Nothing here claims support.** The pi GPT-provider path and the ACP-backend prohibition are
unchanged.
