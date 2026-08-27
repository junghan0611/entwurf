# NEXT--issue-87-omp-vendor-measurement — OMP step-1 measurement rail

> Disposable branch boot sector. Delete before merge. Main rail: NEXT.md item 2.
> Issue: https://github.com/junghan0611/entwurf/issues/87 · 입학 문서:
> `docs/adding-a-harness.md` §1, §3.5, §5(dialect), §6(sanitization).

# RAIL — 현재 좌표

- [x] **1. Rail + source-layer measurement** — Fable, oracle, 2026-08-27. Ledger:
  `scripts/raw-omp-measure/README.md` (M1–M6 + §3.5 + dialect, all `[source]`/`[host]`
  slots filled with file:line receipts; `[LIVE — pending]` slots empty by design).
  Probe: `scripts/raw-omp-measure/probe-extension.ts`.
- [x] **2. Independent source audit** — xai/grok-4.6 fresh sibling (garden
  `20260827T175159-ad35c9`), 2026-08-27: `scripts/raw-omp-measure/source-audit.md`,
  **20 CONFIRMED / 6 CORRECTED / 0 UNRESOLVED**. Fence verdict: `mode==="tui"` sound and
  alone (`hasUI` rejected — true under rpc/rpc-ui/ACP). Corrections folded into the
  ledger, marked `audited`; probe fixed against the real v18 session-manager API.
- [x] **3. Close docs + commit + review** — plan of record on #87
  (comment 5436873780), B-bot review 7/7 with Defect-1 accepted-amended, cross-review
  closed in both directions.
- [x] **4. LIVE measurement** — grok on a real omp/18.0.0 TUI (2026-08-27, commit
  `7493826`). **§3.5 discriminator HELD** (host tui vs subagent print, same pid, store
  519=519); dialect oracle satisfied (`mcp__entwurf_bridge_entwurf_v` + 6 live); O1 key
  = plain `entwurf-bridge`; PI_* absent under clean launch; borrowed claude-code label
  captured live. Shadowing receipt + O2 deferred to the implementation lane.
- [x] **5. Grant decision** — **GRANTED by GLG 2026-08-27 (this session).** Implementer:
  Opus (claude-code). Reviewer: terra (openai-codex, called per bundle). Coordinator:
  Fable (checkpoint routing only). Order/estimate: #89.
- [x] **6. Implementation bundle A — CODE COMPLETE, awaiting terra review.** Opus
  (claude-code), oracle, 2026-08-27. Commits `bb26e07` (step 2 registration),
  `852c7b7` (steps 3+3.5+4+6: the omp extension, installer, doctor, sender marker),
  `ba89f63` (step 5: the omp-native MCP writer). Local only — never pushed.
  Focused gates green: `check-omp-birth-hook` (72), `smoke-omp-bridge-state` (26),
  `smoke-omp-mcp-state` (28), `check-meta-session`, `check-entwurf-capabilities`,
  `check-meta-doctor-oracle`, `check-agy-sender-identity`, `check-meta-facts`,
  `check-entwurf-facts`, `check-capability-bundle-reach`, `check-install-surface`,
  `check-entwurf-bridge-boot`, `pnpm typecheck`, `pnpm lint`. 8 exact-once mutants in
  `scripts/mutants/omp-birth.json` (+ the stale `HOOK-LOG-RAIL-SCOPED` mutant refreshed).
  LIVE on oracle: garden `20260827T211548-68ca9d` born at TUI open, `/mcp list` source
  flipped to `~/.omp/agent/mcp.json`, bridge child env `external-mcp/omp`, one real task
  subagent minted NOTHING (521=521), `/new` minted the replacement via `session_switch`,
  O2 denylist starved both entries. All folded into the ledger.
  **NOT run by design (AGENTS verification scheduling): `pnpm run check:full` and
  `check-gate-qualification` — they belong on the frozen candidate AFTER the review.**
- [ ] **7. terra review of bundle A** ← CURRENT. Then ONE amendment bundle, then
  `check-gate-qualification` + `pnpm run check:full` once on the frozen candidate.
- [ ] **8. Bundle B: receive (step 7)** — PAUSED until A lands reviewed.
- [ ] **9. Bundle C: visible fresh (step 9) + grade (step 8)** — PAUSED. The
  `DELIVERY.md` matrix row and the registry grade move together THERE, not in A: omp
  ships as `D0` / `direct-inject` until a receive rail earns more.

# NOW

- **Stem:** OMP 세션 하나 = 형제 하나. 그 안의 서브에이전트는 절대 citizen이 아니다.
  재는 것은 GLG 검수 홉 수. (측정 전용 시기는 끝났다 — bundle A가 GLG grant 아래에서
  구현·설치·LIVE를 끝냈고, 그 영수증은 ledger의 `[LIVE …, implementation lane]` 행이다.)
- **Design stance (GLG, 2026-08-27) — OMP is an independent harness.** The Claude-config
  import is never a support surface; model the operator who never used Claude Code. Tool
  hand = the native-harness MCP rail (step 5): an omp-native writer →
  `~/.omp/agent/mcp.json`, label `external-mcp/omp`, shadowing the import by vendor
  precedence. NOT a port of `entwurf-control.ts` into an omp extension ("pi-extensions
  방식" rejected — a third tool dialect on a forked API is new logic, the bug class this
  lane refuses). The in-process extension is used only where the rail already uses a
  vendor lifecycle unit: birth + §3.5 discriminator + visible identity + receive.
  Acceptance criterion for ALL later implementation: existing rail patterns with
  measured facts substituted; the only new predicate anywhere is the §3.5
  discriminator, which the doctrine itself mandates. Shadowing addendum (review
  Defect-1, accepted): the native writer pins the literal server key
  `entwurf-bridge` (same-key first-wins is the whole mechanism; env may differ;
  `disabledServers` on that name would kill both entries — never the hide-import tool).
- **Roles (GLG, 2026-08-27):** Fable = rail design only. Implementation AND LIVE
  legwork = sibling on sol/terra/glm/grok rails. Coordination stays with GLG.
- **pi-rail overlap (GLG worry, promoted to axis M6):** omp is a pi fork and reads
  `PI_CONFIG_DIR`/`PI_CODING_AGENT_DIR`/`PI_PROFILE` (`oh-my-pi
  packages/utils/src/dirs.ts:4-5`) — the same knobs entwurf's pi rail and Hard Rule 12
  sandboxing use. omp does NOT mint `PI_SESSION_ID` itself (absent from
  coding-agent src); the danger is inheritance passthrough (§6). LIVE environ greps
  are the receipt.
- **Blocker:** none. omp/18.0.0 lives at `~/.local/bin/omp` on oracle; source checkout
  `~/repos/3rd/oh-my-pi` at v18.0.0.
- **Do not touch (post-bundle-A):** bundle B (receive / step 7) and bundle C (visible
  fresh / grade) until terra's review of A closes · a second Claude-MCP writer ·
  idle-wake demos · `DELIVERY.md` / registry grade movement (that is step 8, bundle C) ·
  `~/.omp/agent/config.yml` (entwurf owns no operator SSOT there) · #78 · main · push.
- **Owed by bundle C, deliberately NOT done in A (they are admission claims, not
  ownership):** a README per-harness bullet, the `run.sh setup` composition row, the
  `DELIVERY.md` matrix row, and the registry grade. A README/setup entry now would read
  as "supported" while receive and visible fresh have no unit. `docs/setup-clean-host.md`
  and `docs/external-mcp-host.md` DID get omp sections in A — those two own installers
  and per-harness registration, and both say in their own words that omp is not yet
  supported.
- **Full floor is deliberately NOT run yet.** AGENTS verification scheduling:
  implement → focused gates → independent review → one amendment bundle →
  `check-gate-qualification` (a gate/mutant changed, so it is owed) →
  `pnpm run check:full` ONCE on the frozen candidate → commit. Running it before the
  review would pay for it twice.

# RECENT

- **2026-08-27 oracle (Opus, bundle A):** implementation landed in three commits
  (`bb26e07`, `852c7b7`, `ba89f63`), local only. What the LIVE run settled that source
  could not: the `/mcp list` source attribution FLIPS to `~/.omp/agent/mcp.json` once the
  native entry exists (shadowing closed), the bridge child's env label becomes
  `external-mcp/omp`, a real task subagent leaves the store at 521=521 with one
  `scope-refused mode=print` line, `/new` mints the replacement through `session_switch`,
  and a `disabledServers` denylist leaves `○ not connected` with NO Claude section at all
  (O2 closed — it starves both, exactly as cross-review (3d) said). Two brief notes for
  the reviewer: (a) the brief said visible identity rides `pi.setStatus`, and the
  measured call site is `ctx.ui.setStatus(key, text)` on the EVENT context
  (`types.ts:285` inside `ExtensionUIContext`, `docs/hooks.md` "Status line behavior") —
  same surface, corrected coordinate; (b) bundle A creates NO managed launch surface, so
  §6 sanitization has nothing to strip yet — the doctor takes the DETECT half (a live omp
  carrying `PI_SESSION_ID`/`PI_AGENT_ID` is red on its own axis) and the strip half is
  owed by the step-9 managed launch in bundle C.
- **2026-08-27 oracle (Opus, A1 side-finding):** adding a backend id invalidates every
  ALREADY-RUNNING `entwurf-bridge` child on the host until its owning session restarts —
  the process holds the old `META_CITIZEN_BACKENDS` in memory and re-reads the capability
  registry from disk, so the strict coverage guard fires (`capability registry must cover
  exactly … (got …, omp, pi)`). Measured on this session's own bridge (pid 506167) while
  a fresh bridge booted clean (`check-entwurf-bridge-boot` green). This is the designed
  stale-reader refusal, but `adding-a-harness.md` step 2(c) writes its remedy for on-disk
  artifacts only; a live MCP child cannot be redeployed in place. Worth a sentence in
  that step.

- **2026-08-27 oracle (B-bot review × grok cross-review):** external review (sonnet) on
  #87 (comment 5437071116): 7/7 facts held, Blocker 0, Defect 1 — **accepted amended**:
  shadowing works only via the byte-identical server key (pin literal `entwurf-bridge`;
  env may differ; `disabledServers` kills both). Cross-review corrected two reviewer
  claims with receipts (`source-audit.md` "Cross-review" section): `:531` test-only
  STANDS (a method definition was mistaken for a production caller; production TUI boot
  is `:302`), and ACP `enableMCP:false` is NOT a fence (client-supplied MCP still
  connects, `acp-agent.ts:2608-2669`). Ledger and stance updated.
- **2026-08-27 oracle (grok audit):** all Fable source claims re-verified against
  `~/repos/3rd/oh-my-pi` @ v18.0.0. Design-touching corrections: (1) `hasUI` is NOT a
  host predicate — rpc/rpc-ui/ACP see `hasUI:true` (`runner.ts:879-881`); `mode==="tui"`
  alone is the fence. (2) `setFooter`/`setHeader` are TUI no-ops
  (`extension-ui-controller.ts:139`) — visible identity must ride `setStatus` hook lines;
  built-in statusLine has no custom/command segment. (3) Bundled task agents do not set
  `restrictToolNames` — default subagents DO load extensions. Plus: ACP loads extensions
  but the tui guard stays silent; `/new`·fork·resume re-fire as `session_switch`, not
  `session_start`; MCP child env = `{...Bun.env, ...entry.env}` with no omp-injected id.
- **2026-08-27 oracle (Fable):** branch cut; source-layer measurement complete. Key
  finds: hooks are an in-process event bus (`--hook` == `--extension`); every task
  subagent re-emits `session_start` (`task/executor.ts:3305`) and inherits extensions +
  MCP proxy by default → discriminator (`mode==="tui"` vs `"print"`+`hasUI:false`) is
  the only fence, source-pinned at `runner.ts:438/651` + `extension-ui-controller.ts:302/531`
  + `executor.ts:3115/3252`. Dialect mint `mcp__${server}_${tool}` at
  `tool-bridge.ts:396` → computes `mcp__entwurf_bridge_entwurf_v` (live list = oracle).
  This host's only bridge source is imported `~/.claude.json` carrying
  `ENTWURF_BRIDGE_EXTERNAL_AGENT_ID=external-mcp/claude-code` — wrong provenance for an
  omp citizen; evidence for the borrowed-config fence.

# DURABLE LINKS

- Ledger: `scripts/raw-omp-measure/README.md`
- Audit: `scripts/raw-omp-measure/source-audit.md`
- Probe: `scripts/raw-omp-measure/probe-extension.ts`
- #87: https://github.com/junghan0611/entwurf/issues/87
