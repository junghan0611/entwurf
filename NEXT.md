# NEXT.md — pi-shell-acp

> 다음에 할 일만 남긴다. 로그가 아니다.
> 결정 trace 와 evidence 는 commit history / CHANGELOG / VERIFY / BASELINE / README / AGENTS / 코드로 보낸다.

## Active — 1.0.0: garden-native meta-bridge, entwurf-fronted (#30)

Design is **grounded + pinned**, ready for an implementation session. SSOT for the full trace —
do NOT re-derive here:
- **#30** — 4 time-axis comments (2026-06-05): grounding pass · three refinements · live-verified
  async delivery · dropped pi-entry handoff decision · bbot review (read-receipt observability + drift sentinel).
- **`DELIVERY.md`** — native async-delivery capability levels `D0–D8` per backend.
- **`scripts/raw-async-delivery/README.md` §Gotchas** — 10 hard-won traps; re-read before touching
  delivery code (idle-wake = `FileChanged` not `Stop`; plugin-not-bare-skill; stderr-only doorbell;
  infinite-loop guard; cost line; liveness SSOT = `pid.json` not WAL; …).

**Targets — 3 native backends, prove in order.** Claude Code = #1 (MVP). Antigravity/agy = #2.
Codex = #3. Each has a *different* native layout — that difference is exactly what forces the thin
per-backend adapter seam (uniform garden layer + thin adapter). Capability today (see DELIVERY.md):
Claude `D6` (D7/D8 partial), agy `D6+` native push, Codex embedded-TUI `D0` partial /
app-server-backed `D6+D7`; pi-native Entwurf is the reference.

**Entry model — just open the native backend (pi-entry handoff DROPPED 2026-06-05).** No pi launcher
step, no self-transform `exec`. The operator opens Claude Code (or agy / Codex) directly; the session
becomes a garden citizen entirely through its own `SessionStart` hook. Thinner, and it honors the
North Star — the bridge does not compete with pi's session picker / resume UX (forcing handoff into
the pi picker is "build a second harness"). The pi-entry handoff scenario (pi pre-mints garden-id +
native UUID, then `exec`-replaces into `claude --resume`) is **removed from 1.0.0**; reopen only if
GLG asks. It leaves exactly one consequence — the load-bearing concern below.

> **⚠ LOAD-BEARING — reliable meta-record creation on native open.** Dropping pi-entry removes the
> pre-mint safety net, so meta-session *creation* is now **100 % the backend `SessionStart` hook's
> job**. "Open Claude Code → a meta-record reliably exists, every time" must be a *proven guarantee*,
> not a hope. A silent miss = a native session that never became a garden citizen = invisible to
> entwurf = the async-delivery address simply does not exist. This is the **success criterion of step
> 4**, not an afterthought. Open question to resolve there: what happens when the hook fails / the
> plugin isn't loaded — fail-loud, or best-effort + backfill on next turn?

**Async delivery to a registered meta-session (the addressee path):** Registering an external session as a
   meta-session promotes it from external/non-addressable to **addressable + wakeable** (garden-id =
   address, mailbox = inbox). Full "replyable" semantics require the later outbox/read-receipt path;
   do not hide that last-1cm distinction. `entwurf_send` → mailbox enqueue (append-only, delivery
   marker). Delivery is **turn-boundary only** (never
   mid-turn — structurally guaranteed: every event is edge-bound), via a per-backend **trusted data
   line**:
   - **Claude:** idle → `FileChanged`+`watchPaths` (armed at SessionStart, plugin bundle); active →
     `Stop` `asyncRewake` doorbell. Both deliver a **notice only** (stderr); the woken model
     **self-fetches** the body via its own MCP tool. Imperatives get refused as injection — notice
     framing only. (hook = untrusted *signal* line; MCP tool = *trusted data* line.)
   - **agy:** native event-loop — push to the message queue; the system daemon wakes it at the turn
     boundary and injects `<SYSTEM_MESSAGE>`. No watcher needed (1st-class native; trusts its own
     queue, so direct inject, no doorbell).
   - **Codex:** app-server `turn/start` (threadId + text). Direct TUI has **no** delivery surface.
   Cost: delivery/wake is **free** (continuation of a running subscription session); only `claude -p`
   spawn is metered — free async delivery is the meta-bridge's economic survival path.

**Fixed decisions:**
- create/attach trigger = backend `SessionStart` hook; **idempotent `upsert`, keyed on meta-record
  existence — NOT `source`** (record present → attach + refresh `last_seen`; absent → mint + write).
  Absorbs duplicate fires / re-entry; neutralizes per-backend source-field differences. Name the CLI
  `upsert` (not `create | attach`) so no one re-introduces `source` branching.
- garden-id = reuse `generateSessionId` (`YYYYMMDDTHHMMSS-[0-9a-f]{6}`), minted at true birth.
- meta-record = opaque `.meta.json` pointer at `~/.pi/meta-sessions/<garden-id>.meta.json`
  (proposed); `backend` field discriminates. body = SSOT. **lookup authority = top-level record
  scan by `native_session_id`** (symmetric with 0.9.0 `findSessionFileById`; `.meta.json` is single
  JSON, so "scan record bodies by top-level field", not "header-scan"). Any native→garden index is a
  derived cache, NEVER authority — "needs a DB" = the denote-instinct tripwire.
- liveness = best-effort hint (per-backend mechanism differs; Claude `pid.json` SSOT, NOT db-wal —
  WAL drops on checkpoint = false dead/alive). Authority for alive/recent = `last_seen` + native
  presence. No backend reliability assumption imported.
- entwurf-fronting = extend `entwurf_*` to a meta-session peer *kind* (addressable/wakeable, not yet
  fully replyable). ACP demoted to one transport. `entwurf_send` → mailbox is the delivery axis;
  `entwurf_resume` launch-pointer / pi-picker handoff is **out of 1.0.0 unless GLG reopens it** — do
  not let the dropped scenario re-enter through a resume abstraction. Mailbox delivery itself is
  **post-MVP** — **BUT the read-receipt aspect is pulled into MVP** (bbot review #4). The Claude doorbell self-fetches, so
  a model that ignores the notice never reads the body, and `.delivered` marks "doorbell rang", not
  "model read". Fix: **the inbox-read MCP call IS the read-receipt** — it closes the doorbell
  observability gap and makes `D7` real. Sender contract: uniform on garden-id + queue; honest on
  `wakeMode` / `deliveryLevel` peer metadata (self-fetch vs direct-inject). Never abstract away the
  delivery "last 1cm" — covering it turns "sent but unread?" into a debugging hell (0.9.0 "uniform
  id + honest meta"). agy/codex direct-inject have no gap; ironically the weakest-looking Claude
  doorbell needs the most observability work.

**Evidence grade (stay honest at commit time):** capability is **LIVE-verified** (separate
Claude/agy/Codex probe sessions + binary cross-validation) and **repro scripts exist**
(`scripts/raw-async-delivery/repro-*.sh`, `DELIVERY.md` D-levels). It is **NOT** yet promoted to a
repo `run.sh smoke-*` regression gate — that promotion is implementation step 1. Do not collapse
"L-evidence quality" into "D-delivery capability" (VERIFY.md namespace note).

**MVP implementation order (Claude Code only; record authority FIRST, hook LAST):**
1. **DONE — drift sentinel + capability gate.** `./run.sh smoke-meta-async-drift`
   (`scripts/smoke-meta-async-drift.sh`). Deterministic default: version pins (measured
   **Claude 2.1.163 / codex-cli 0.136.0 / agy 1.0.5** — note: bbot's "agy 0.136" was a conflation
   with codex; gate pins measured truth) + 9 undocumented-behavior marker strings cross-validated
   against the installed Claude binary (`asyncRewake`, `stop_hook_active`, `watchPaths`,
   `flushPendingAsyncRewakeHooks`, `CLAUDE_CODE_STOP_HOOK_BLOCK_CAP`, `FileChanged`, `rewakeMessage`,
   `hookSpecificOutput`, `CwdChanged`). `LIVE=1` adds the plugin `SessionStart` watch-arm probe.
   Negative-tested (moved pin / vanished marker → `DRIFT DETECTED` + exit 1). NOT in `release-gate`
   yet (asserts on host's installed Claude binary → not hermetic for `pnpm check`); promote at 1.0.0
   cut. Lineage: 0.8.x fail-fast tool-surface gates (bbot review #4).
2. meta-record schema + pure functions (mint / build / parse / scan-by-native-id) + temp-dir
   deterministic test. **Pre-drill a read-receipt field now** — adding it later (when inbox-read
   lands) touches the schema twice (bbot review #4). Cut the per-backend adapter seam — do not bake
   "hook = Claude Code" in.
3. idempotent `pi-shell-acp meta-session upsert` CLI (scan → attach | create). No `source` branching.
4. **Claude `SessionStart` create/attach hook — THE load-bearing step (see ⚠ above).** Fires the
   idempotent `upsert` at startup so "open Claude Code → meta-record exists" is guaranteed; arms the
   idle-wake `watchPath` in the same hook. Shipped as a **plugin bundle** (a bare skill cannot arm the
   watch at startup; verified). Success criterion (NOT optional): a live smoke proves that opening a
   native Claude Code session deterministically lands a `~/.pi/meta-sessions/<garden-id>.meta.json` —
   no silent miss — and decides the failure policy (plugin not loaded / hook errored → fail-loud vs
   best-effort + next-turn backfill). Plugin must auto-load on *every* session (global install /
   settings.json hooks), not depend on a manual `--plugin-dir`. agent-config owns the wiring; core
   owns the CLI + the creation-guarantee smoke.
5. `entwurf_peers(includeMeta)` surfaces the meta-session kind with an honest backend glyph (no
   conflation with socket-peers). Dogfood subject: this Claude Code session.

**Consumer track (agent-config, NOT this repo):** statusline `garden-id · backend · status`,
theme/config parity across pi / Claude / agy / Codex. Both Claude and agy already expose a custom
`statusLine` command. The honest knot core↔consumer is the shared garden-id; do NOT pull theming into
core (re-bloats the screwdriver).

**Scope guard:** do NOT build a generic worker-pool orchestrator out of #31 — document the
parallel-team pattern, keep the bridge thin. Doorbell delivery is notice-only + self-fetch; never
inject imperatives through a hook channel.

## Recently landed — evidence closure on the 0.9.0 substrate (under CHANGELOG `## Unreleased`)

Closes two 0.9.0 carried follow-ups by making indirect proofs direct, plus one stale-item trim.
**No release** — runtime behavior is unchanged and there is no user-facing value, so this stays on
`0.9.0` with the entry under `## Unreleased`; a tag waits for 1.0.0 or a real runtime/user-facing
patch (cutting 0.9.1 for gate hygiene would only add version noise). Code + live evidence landed.

- **DONE — cross-cwd resume append-not-recreate (T5).** `cross-cwd-resume-smoke.ts` now asserts at
  the file/id level (one file before/after, same file appended, header id/cwd stable, no shadow
  under the resumer cwd dir) on top of the existing recall. Live-verified via `verify-resume`.
- **DONE — resume-into-uuid friendly pre-cancel.** `smoke-resident-garden-guard.sh` new
  RESUME-INTO-UUID section drives RPC `switch_session` into a synthetic legacy-uuid file and proves
  the `session_before_switch` reason `"resume"` cancel directly (0 tokens, hard guard never fires).
  Live-verified: guard 0-token sweep 30/0.
- **DONE — stale `_entwurf-` follow-up removed** (agent-config SKILL.md was already migrated in 0.9.0).

## Carried-forward follow-ups from 0.9.0 (real next work, not cut blockers)

- **`/gnew` T3 backend axis — Claude-only measured.** Backend identity after `/gnew`
  (`PI_SESSION_ID` → backend MCP child) is live-proven on `claude-sonnet-4-6` only; the resident
  guard runs at the default `SMOKE_RGG_MODEL`. The switchSession rebind is backend-agnostic at the
  bridge level, so risk is low. The 0.9.0 BASELINE/CHANGELOG now carries the explicit
  skip-with-reason; follow-up is to extend `SMOKE_RGG_MODEL` to codex/gemini for a `/gnew` T3 run.
- **`/gnew` empty-session GC.** `/gnew` persists the header+metadata file immediately
  (switchSession needs it to exist), so repeated `/gnew` without a turn leaves header-only files —
  more than the launcher (which defers the file to the first turn). A cross-cutting empty-session
  GC (applies to the launcher too) is the follow-up, not a `/gnew` defect.
- **`entwurf.ts` source guard refinement.** The deterministic guard is fail-closed (every
  `pi.sendMessage` must sit inside a best-effort arrow wrapper). Correct while `entwurf.ts` is
  completion-send only. If a plain UI send is ever added there, refine the guard to
  close-handler scope / allowlist — do NOT loosen the equality check.

## Deferred — dep bump (claude-agent-acp 0.40.0 / @agentclientprotocol/sdk 0.24.0) — SEPARATE track

sdk 0.24 removed `unstable_setSessionModel` (the model-set RPC) entirely (type + runtime),
replacing it with `session/set_config_option` (configId="model"). Claude model selection survives
via `_meta.claudeCode.options.model` at newSession, but **codex/gemini model-forcing has no other
path** — `resolveCodex/GeminiAcpLaunch` pass no `--model`, so the RPC was their sole mechanism; an
`as any` cast over the removed method would silently regress them (the exact 0.4.5 anti-pattern
`check-sdk-surface` exists to block). Forward fix: migrate `enforceRequestedSessionModel` to
`setSessionConfigOption({configId:"model", value})` with config-value discovery + a per-backend
resolved-model release-gate assertion + live codex/gemini verification (codex-acp is a bundled
binary — set_config_option support is unverifiable statically). The critical Opus 4.8
thinking-blocks fix is already in the pinned 0.39.0, so the entwurf identity line needs nothing
from 0.40.0. Bump `~/sync/org/setup/update-claude.sh` pin in lockstep when this lands.

## Standing focus — Asymmetric Mitsein with Claude Code

상시 초점: `pi-shell-acp` 를 OpenClaw plugin 으로 더 미는 것보다, **pi session ↔ Claude Code /
external MCP host ↔ pi-tools-bridge ↔ entwurf** 가 서로 다른 하네스 정체성을 유지하면서 함께
일하는 시나리오를 검증한다.

핵심 질문:
- 외부 MCP host 는 replyable 하지 않다는 비대칭을 agent 가 정확히 이해하는가?
- `entwurf_send` 는 fire-and-forget, `entwurf` / `entwurf_resume` 는 outcome ownership 이라는
  역할 분담이 실제 워크플로에서 헷갈리지 않는가?
- Claude Code 가 설계/리뷰하고 pi-shell-acp 세션이 실행하거나 그 반대인 시나리오가
  문서/로그/UX 상 정직한가? (서로 forward 하지 않고 GLG 가 역할을 정하는 패턴 유지.)

성공 기준: 각 시나리오에서 "누가 outcome 을 소유하는가" 가 명확하고, replyable / non-replyable /
send-is-throw / MCP `entwurf_resume` 조건부 async default(0.7.6) 경계가 agent 발화에 정확히
반영된다. 필요하면 README / AGENTS / VERIFY 한 곳에 운영 패턴으로 정리한다.

## Active hygiene — session continuity (`incompatible_config`)

같은 pi 세션을 resume 할 때 실행 옵션이 달라지면 bridge config signature 가 달라져 ACP backend
session 이 `incompatible_config` 로 invalidate 된다. 대표 footgun: 평소
`pi --entwurf-control --emacs-agent-socket server` alias 와 달리 plain `pi` 로 실행하면
`--emacs-agent-socket` 누락 → `bridgeConfigSignature` 변동 → pi JSONL 은 남지만 backend 매핑이
새로 생겨 모델이 이전 맥락을 모르는 것처럼 반응.

다음 작업 후보:
1. `incompatible_config` 로그에 축별 diff 출력 (예: `emacsAgentSocket: null -> "server"`).
2. `PI_SHELL_ACP_STRICT_BOOTSTRAP=1` 운영 문서화 / silent-new 대신 fail-fast 검토.
3. `emacsAgentSocket` 을 session compatibility 축에 넣는 게 맞는지 재검토.

## Main backlog — #25 bridge hygiene (OpenClaw audit lessons)

OpenClaw audit lesson 을 plugin 확장이 아니라 **pi-shell-acp 본체 bridge hygiene** 로 흡수한다:
1. **Transcript pre-flight** — backend native jsonl 위치 verifier (Claude `CLAUDE_CONFIG_DIR`,
   Codex `CODEX_HOME`/`CODEX_SQLITE_HOME`, Gemini `GEMINI_CLI_HOME`).
2. **Invalidation reason taxonomy** — 지금 `incompatible_config` 가 너무 넓다. 후보:
   `auth-profile`, `auth-epoch`, `system-prompt`, `mcp`, `transcript-missing`, `emacs-socket`,
   `tool-surface`.
3. **Session cache hygiene** — `acp-bridge.ts` bridge session cache 에 idle timeout / LRU /
   max-N cap 검토.

나중 후보: fingerprint-keyed reuse (skills snapshot + extra system prompt hash 축); single-turn
lock per session (같은 sessionId 동시 prompt 진입 throw).

## Reference paths

- 본체: `~/repos/gh/pi-shell-acp/`
- Consumer: `~/repos/gh/agent-config/`
- NixOS consumer: `~/repos/gh/nixos-config/`
- OpenClaw source / plugin stub: `~/repos/3rd/openclaw/`, `plugins/openclaw/`

## Parked — do not pick unless GLG reopens

- **OpenClaw track**: native `claude-cli` / `openai-codex` 가 이미 충분히 좋다. Gemini lane 만 필요
  시 재개. plugin self-contained install / ClawHub trust / embedded runtime 등 전부 parked.
- **Long-term / separate issues**: #11 remote SSH resume cwd alignment (remote entwurf identity는
  0.9.0 에서 의도적으로 fail-fast), #10 broader ontology RFC, #8 ACP `entwurf_send` message
  visibility UX, #2 pi-first context meter, L5 long soak with repeated context-pressure events.
