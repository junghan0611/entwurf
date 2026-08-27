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
- [ ] **3. Close docs + commit + review** ← CURRENT: Fable closes the branch docs and
  commits; GLG comments the plan on #87 and requests external review (B봇). No
  implementation until that review passes.
- [x] **4. LIVE measurement** — grok on a real omp/18.0.0 TUI (2026-08-27, commit
  `7493826`). **§3.5 discriminator HELD** (host tui vs subagent print, same pid, store
  519=519); dialect oracle satisfied (`mcp__entwurf_bridge_entwurf_v` + 6 live); O1 key
  = plain `entwurf-bridge`; PI_* absent under clean launch; borrowed claude-code label
  captured live. Shadowing receipt + O2 deferred to the implementation lane.
- [x] **5. Grant decision** — **GRANTED by GLG 2026-08-27 (this session).** Implementer:
  Opus (claude-code). Reviewer: terra (openai-codex, called per bundle). Coordinator:
  Fable (checkpoint routing only). Order/estimate: #89.
- [ ] **6. Implementation bundle A** ← CURRENT: step 2 registration (+ redeploy
  choreography + doctors) then steps 3–6 as one surface (omp extension: birth +
  tui-only fence + setStatus identity + sender marker; installer with preimage/inverse/
  doctor; omp-native mcp writer with pinned key `entwurf-bridge`, env
  `external-mcp/omp`; §6 strip in any managed launch). Focused gates + mutants per
  AGENTS verification scheduling. STOP before full floor: terra review, one amendment
  bundle, then full floor once on the frozen candidate.
- [ ] **7. Bundle B: receive (step 7)** — PAUSED until A lands reviewed.
- [ ] **8. Bundle C: visible fresh (step 9) + grade (step 8)** — PAUSED.

# NOW

- **Stem:** OMP 세션 하나 = 형제 하나. 그 안의 서브에이전트는 절대 citizen이 아니다.
  재는 것은 GLG 검수 홉 수. 이 브랜치는 측정 영수증만 만든다 — 구현 0바이트.
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
- **Do not touch:** implementation of steps 2–9 · minting any record/marker · a second
  Claude-MCP writer · omp config writes · idle-wake demos (step 7) · #78 · main.

# RECENT

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
