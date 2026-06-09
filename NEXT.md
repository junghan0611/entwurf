# NEXT.md — pi-shell-acp

> 다음에 할 일만 남긴다. 로그가 아니다.
> 결정 trace 와 evidence 는 commit history / CHANGELOG / VERIFY / BASELINE / README / AGENTS / 코드로 보낸다.

## Active — 0.10.0: garden-native meta-bridge, entwurf-fronted (#30)

Design is **grounded + pinned**, ready for an implementation session. SSOT for the full trace —
do NOT re-derive here:
- **#30** — 4 time-axis comments (2026-06-05): grounding pass · three refinements · live-verified
  async delivery · dropped pi-entry handoff decision · bbot review (read-receipt observability + drift sentinel).
- **`DELIVERY.md`** — native async-delivery capability levels `D0–D8` per backend.
- **`scripts/raw-async-delivery/README.md` §Gotchas** — 10 hard-won traps; re-read before touching
  delivery code (idle-wake = `FileChanged` not `Stop`; plugin-not-bare-skill; stderr-only doorbell;
  infinite-loop guard; cost line; liveness SSOT = `pid.json` not WAL; …).

**Target policy — 0.10.0 ships Claude Code only; the 3-backend work is evidence + seam, not scope.**
Morning raw probes opened the async doors for all three and made them reproducible (see DELIVERY.md):
Claude `D6` (D7/D8 partial), agy `D6+` native push, Codex embedded-TUI `D0` partial /
app-server-backed `D6+D7`; pi-native Entwurf is the reference. That evidence is load-bearing because it
forces the thin per-backend adapter seam (uniform garden layer + thin adapter). **But the 0.10.0 MVP
implementation/installer/doctor is Claude Code only.** agy/Codex stay proven future adapters; do not
let their install surfaces expand this release.

**Entry model — just open the native backend (pi-entry handoff DROPPED 2026-06-05).** No pi launcher
step, no self-transform `exec`. For 0.10.0 the operator opens Claude Code directly; the session
becomes a garden citizen entirely through its own `SessionStart` hook. Thinner, and it honors the
North Star — the bridge does not compete with pi's session picker / resume UX (forcing handoff into
the pi picker is "build a second harness"). The pi-entry handoff scenario (pi pre-mints garden-id +
native UUID, then `exec`-replaces into `claude --resume`) is **removed from 0.10.0**; reopen only if
GLG asks. It left exactly one consequence — the load-bearing concern below — and that concern is now closed for Claude Code.

> **✅ CLOSED — reliable meta-record creation on native open.** Dropping pi-entry removed the
> pre-mint safety net, so meta-session *creation* became **100 % the backend `SessionStart` hook's
> job**. This is now live-proven for Claude Code through the global plugin: normal native open
> (`--plugin-dir` 없음) → `SessionStart` → `upsertMetaSession` →
> `<pi-agent-dir>/meta-sessions/<garden-id>.meta.json` + garden mailbox watch. Runtime hook remains
> best-effort + log (no terminal scream); doctor is the fail-loud surface; `UserPromptSubmit` is only
> degraded *record* backfill (cannot re-arm the watch).
>
> **✅ CLOSED — install/doctor, not tribal setup knowledge.** 0.10.0 now has the operator-grade Claude
> global installer + doctor surface: `./run.sh install-meta-bridge` assembles a repo-stable local
> marketplace, bakes the home/profile `node` path, installs `entwurf-meta-receive@meta-bridge-local`
> with `--scope user`, and installs/refreshes the canonical USER-scope `pi-tools-bridge` MCP entry;
> `./run.sh doctor-meta-bridge` fails loud on toolchain/plugin/node-path/user-MCP/store/SessionStart
> evidence gaps. Supported platforms stay **Linux + macOS only**; Windows fails fast.
> Global install is intentionally left live on GLG's machine for dogfooding; uninstall with
> `claude plugin uninstall entwurf-meta-receive@meta-bridge-local` if needed.

**Async delivery to a registered meta-session (the addressee path):** Registering an external session as a
   meta-session promotes it from external/non-addressable to **addressable + wakeable** (garden-id =
   address, mailbox = inbox). Full "replyable" semantics require an outbox; the read-receipt half is
   in the Claude MVP through inbox-read. Do not hide that last-1cm distinction. `entwurf_send` → mailbox enqueue (append-only, delivery
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
- meta-record = opaque `.meta.json` pointer at `<pi-agent-dir>/meta-sessions/<garden-id>.meta.json`
  (default `~/.pi/agent/meta-sessions`, honors `PI_CODING_AGENT_DIR`; override `PI_META_SESSIONS_DIR`
  — chosen over a bare `~/.pi/meta-sessions` so isolated installs/tests isolate like pi's own
  sessions); `backend` field discriminates. body = SSOT. **lookup authority = top-level record
  scan by `nativeSessionId`** (symmetric with 0.9.0 `findSessionFileById`; `.meta.json` is single
  JSON, so "scan record bodies by top-level field", not "header-scan"). Any native→garden index is a
  derived cache, NEVER authority — "needs a DB" = the denote-instinct tripwire.
- liveness = best-effort hint (per-backend mechanism differs; Claude `pid.json` SSOT, NOT db-wal —
  WAL drops on checkpoint = false dead/alive). Authority for alive/recent = `last_seen` + native
  presence. No backend reliability assumption imported.
- install/doctor = first-class 0.10.0 surface, not docs-only. Linux/macOS supported; Windows
  fail-fast. **Claude only for 0.10.0.** The installer owns the required Claude native wiring
  (plugin/global auto-load + settings changes) rather than delegating it to tribal knowledge; it may
  coordinate with `agent-config`, but core must be able to make/verify the exact required config. The
  doctor proves the actual working state and screams on silent-miss risks.
- entwurf-fronting = extend `entwurf_*` to a meta-session peer *kind* (addressable/wakeable, not yet
  fully replyable). ACP demoted to one transport. `entwurf_send` → mailbox is the delivery axis and
  is **in the 0.10.0 MVP for Claude**; it was only marked post-MVP when we still thought native async
  delivery might be impossible. Now that the async doors are open and reproducible, a meta-bridge
  without `entwurf_send` would be a registry demo, not a bridge. `entwurf_resume` launch-pointer /
  pi-picker handoff remains **out of 0.10.0 unless GLG reopens it** — do not let the dropped scenario
  re-enter through a resume abstraction. The Claude doorbell self-fetches, so
  a model that ignores the notice never reads the body, and `.delivered` marks "doorbell rang", not
  "model read". Fix: **the inbox-read MCP call IS the read-receipt** — it closes the doorbell
  observability gap and makes `D7` real. Sender contract: uniform on garden-id + queue; honest on
  `wakeMode` / `deliveryLevel` peer metadata (self-fetch vs direct-inject). Never abstract away the
  delivery "last 1cm" — covering it turns "sent but unread?" into a debugging hell (0.9.0 "uniform
  id + honest meta"). agy/codex direct-inject have no gap; ironically the weakest-looking Claude
  doorbell needs the most observability work.

**Evidence grade (stay honest at commit time):** capability is **LIVE-verified** (separate
Claude/agy/Codex probe sessions + binary cross-validation) and **repro scripts exist**
(`scripts/raw-async-delivery/repro-*.sh`, `DELIVERY.md` D-levels). Step 1 promoted the Claude drift
sentinel into a repo smoke (`./run.sh smoke-meta-async-drift`); it is still **not** in `release-gate`
because it depends on the host's installed Claude binary. Do not collapse "L-evidence quality" into
"D-delivery capability" (VERIFY.md namespace note).

**작업 모델 (2026-06-06 방향 전환 — 메타 쉘 브릿지 / Claude Code only):**

오늘 #30 bbot 릴리즈 리뷰 + GLG·GPT힣 자문으로 0.10.0 정체성이 정리됨:

- **정체성 = 메타 쉘 브릿지.** ACP/pi를 넘어선다. pi-native GPT 사용은 GLG 한정 usage라 다른
  사용자(GPT 구독 없음)에겐 의미 없음 → pi 의존을 0.10.0의 전제로 두지 않는다. pi 철학은 계승:
  **single 드라이버 하나만 건네준다** = 하네스별 도구세트 제한(`xt-tool-surface` 베이스라인 자산).
- **Claude Code only.** 멀티하네스 이관은 0.10.0에 없다. 백엔드 추가는 추후, 그때 설정값을 추상화
  (websearch on/off, codex/agy 내장 이미지툴 등 사용자별 선호). 지금 install 표면을 넓히지 말 것.
- **agent-config 분담 재확정.** 심볼릭 링크 폐기. pi-shell-acp = Claude Code를 single-driver로 만드는
  bridge-owned 설정(install/uninstall/doctor). agent-config = 스킬세트 익스텐션만. 서로 자기 관심사
  키만 세팅하고 상대 설정을 깨지 않는다 (키셋 owner 모델).

**Phase 0 — LANDED substrate (step 1–6 below). 재오픈 금지** (doctor 실패 / 구체 버그만 예외):
1. **DONE — drift sentinel + capability gate.** `./run.sh smoke-meta-async-drift`
   (`scripts/smoke-meta-async-drift.sh`). Deterministic default: **major.minor** version pins
   (**Claude 2.1.x / codex-cli 0.136.x / agy 1.0.x** — patch NOT pinned: Claude ships ~weekly
   (2.1.163→2.1.165 same day, markers unchanged), so a patch pin screams every bump; minor/major move
   is the real re-verify trigger; bbot's "agy 0.136" was a codex conflation) + 9 undocumented-behavior
   marker strings cross-validated against the actually-installed Claude binary (`asyncRewake`, `stop_hook_active`, `watchPaths`,
   `flushPendingAsyncRewakeHooks`, `CLAUDE_CODE_STOP_HOOK_BLOCK_CAP`, `FileChanged`, `rewakeMessage`,
   `hookSpecificOutput`, `CwdChanged`). `LIVE=1` adds the plugin `SessionStart` watch-arm probe.
   Negative-tested (moved pin / vanished marker → `DRIFT DETECTED` + exit 1). NOT in `release-gate`
   yet (asserts on host's installed Claude binary → not hermetic for `pnpm check`); promote at 0.10.0
   cut. Lineage: 0.8.x fail-fast tool-surface gates (bbot review #4).
2. **DONE — meta-record schema + pure functions.** `pi-extensions/lib/meta-session.ts` +
   `./run.sh check-meta-session` (`scripts/check-meta-session.ts`, 33 assertions, in `pnpm check`).
   `mintMetaRecord` / `serializeMetaRecord` (deterministic, stable key order) / `parseMetaRecord`
   (crash-not-warn on every malformed shape, incl. **backend↔wakeMode contradiction** — a Claude
   record claiming direct-inject is corrupt) / `scanByNativeId` (THE lookup authority, by record
   **body** — proven against a decoy filename in a real temp dir, never a filename/index; **scans to
   completion and throws on a duplicate `nativeSessionId`** — authority ambiguity is fail-fast, never
   silently pick one) / `decideUpsert` (existence-keyed, idempotent, refuses backend/identity drift).
   Read-receipt field
   **pre-drilled** (`delivery.lastEnqueuedAt/lastDeliveredAt/lastReadAt` + `markEnqueued/Delivered/Read`
   mutators) so the later mailbox/send step never touches the schema twice. Per-backend adapter seam cut at
   the data level (`META_BACKENDS` 3-way + `META_BACKEND_DESCRIPTORS` honest `wakeMode`/`deliveryLevel`)
   — no "hook = Claude Code" baked in; behavioral half (liveness, hook deploy) is step 4.
   **SSOT side-effect:** the garden-id grammar (`SESSION_ID_RE` / `formatSessionTimestamp` /
   `generateSessionId` / `isValidSessionId`) moved to a real `.js` leaf `pi-extensions/lib/session-id.js`
   (protocol.js pattern — resolvable from both tsc-emit and strip-types). entwurf-core re-exports them,
   so it is now a true single source instead of one-copy-per-importer. `check-entwurf-session-identity`
   158/158 unchanged (no regression).
3. **DONE (fs core) — idempotent fs upsert.** `upsertMetaSession` in
   `pi-extensions/lib/meta-session.ts` (+ 5 real-fs temp-dir assertions in `check-meta-session`, now
   38 total): `mkdir -p` → `readdir` → `scanByNativeId` → `decideUpsert` → **atomic** write
   (tmp+rename, mode 0600, crash-safe). Idempotent (2nd call attaches the same file/id, lastSeen
   refreshed, no shadow record); duplicate `nativeSessionId` on disk throws. `defaultMetaSessionsDir`
   = `<pi-agent-dir>/meta-sessions` (honors `PI_CODING_AGENT_DIR`, override `PI_META_SESSIONS_DIR`) so
   isolated installs/tests isolate, symmetric with pi's own sessions. It lives IN meta-session.ts (not
   a sibling `*-store.ts`): the typecheck fence makes a separate root-config lib that imports another
   `.ts` lib un-unit-testable under strip-types; only node builtins were added, so the gate stays
   strip-types clean. Step 4 consumed this contract through `pi-extensions/meta-bridge-hook.ts`; no
   `source` branching anywhere.
4. **DONE — Claude `SessionStart` create/attach hook (load-bearing path).**
   `pi-extensions/meta-bridge-hook.ts` is the thin entry shell: Claude hook stdin
   (`session_id` / `transcript_path` / `cwd`) → `upsertMetaSession(claude-code)` → garden-id mailbox
   watch at `<pi-agent-dir>/meta-mailbox/<garden-id>/inbox.signal`. Runtime failure policy is
   best-effort + log (`<pi-agent-dir>/meta-bridge-hook.log`), never terminal scream. `SessionStart`
   and `CwdChanged` arm the watch; `UserPromptSubmit` only backfills the record because it cannot emit
   `watchPaths`. Live-proven 2026-06-05: a normal interactive Claude Code session with no manual
   `--plugin-dir` created a real record (`20260605T164744-aef73e.meta.json`) from real hook stdin,
   including native session id + real `transcript_path`, and armed the mailbox.
5. **DONE — Claude global installer + fail-loud doctor.**
   `./run.sh install-meta-bridge` assembles `pi/meta-bridge/.assembled/` (entry + lib bundled,
   node path baked), validates the repo-stable marketplace, then installs
   `entwurf-meta-receive@meta-bridge-local --scope user` so every native Claude Code session auto-loads
   the wake/record plugin. It also installs/refreshes the canonical **USER-scope** `pi-tools-bridge`
   MCP entry (`claude mcp add -s user ... start.sh`) so every native cwd, including `/tmp`, has the
   receiver tool. The plugin deliberately does **not** ship `.mcp.json`; MCP is one user-scope entry,
   not a plugin duplicate or project-scoped `~/.mcp.json`. `./run.sh doctor-meta-bridge` checks
   Linux/macOS policy, Claude/node toolchain, global plugin enabled, baked-node path survival (NixOS
   churn guard), USER-scope MCP reach from `/tmp`, meta-record store writability, hook log, and at
   least one Claude meta-record. Live result: doctor PASS.
6. **DONE — Claude `entwurf_send` mailbox delivery + `entwurf_inbox_read` receipt.**
   `entwurf_send` is now one surface with two transports: live pi control socket first, then
   garden-id meta-mailbox fallback. The mailbox body serializes the sender envelope (`from` /
   `session` / replyable / `wants reply`) so the native receiver knows who sent it and how to reply.
   The addressed FileChanged hook emits a notice-only doorbell with the garden id; the woken model
   self-fetches through `entwurf_inbox_read`, which drains unread `.msg` / `.msg.delivered` files,
   archives them as `.read`, and stamps `delivery.lastReadAt` (the real D7 receipt). `lastDeliveredAt`
   is not invented at read time. Live-proven 2026-06-05: plugin `.mcp.json` removed, canonical
   user-scope MCP visible from `/tmp`, autonomous doorbell → `entwurf_inbox_read` call → `lastReadAt`
   stamped.
**Phase 1 — DONE (commit `9992043`): #30 릴리즈 블로커 + honesty gate.**
- 블로커 1 (doorbell 거짓 카운트): `doorbell.sh` — fresh `*.msg` 전부 deliver 후 전체
  `*.msg.delivered`(backlog 미독 포함 = read tool이 실제 drain하는 수) 기준 정직 카운트, 단/복수,
  "available".
- 블로커 2 (silent registration miss): `meta-bridge-hook.ts` — INFO/WARN/ERROR 레벨 로깅. citizen
  실패(upsert/arm/stdin/parse, degraded SessionStart/CwdChanged)=ERROR, UserPromptSubmit backfill
  =WARN. hook은 best-effort 유지(exit 0, no terminal scream); ERROR는 doctor가 소비(Phase 2).
- honesty gate: `scripts/smoke-meta-honesty.sh` (17 assertions, deps **bash+node+python3**), `pnpm
  check` 편입(`check-meta-session` 뒤). fresh/backlog/empty count + degraded 레벨 경계 커버.

**Phase 2 — DONE (2026-06-06): install / uninstall / doctor — state 파일 기반 키셋 in/out.**
원칙: **파일 덮어쓰기 금지. 우리 키셋만 넣고, uninstall은 state로 정직하게 원복.** Claude Code only.
Landed: `meta-bridge-state.py` state manager, stateful `install-meta-bridge`, new `uninstall-meta-bridge`,
`doctor-meta-bridge` hardening, `meta-bridge-store-doctor.ts`, and offline gate
`smoke-meta-install-state` in `pnpm check`. Live on GLG machine: install PASS + doctor PASS.
- **관리 키셋 (`~/.claude/settings.json`):**
  - A (메타브릿지 wiring, 필수): `enabledPlugins["entwurf-meta-receive@meta-bridge-local"]=true`;
    `extraKnownMarketplaces["meta-bridge-local"]`=host-resolved `.assembled` 절대경로; USER-scope
    `pi-tools-bridge` MCP.
  - B-lite (single-driver 정책): `permissions.allow/deny`; `env.DISABLE_AUTOCOMPACT`;
    `cleanupPeriodDays=365`; `promptSuggestionEnabled=false`; `awaySummaryEnabled=false`;
    `autoMemoryEnabled=false`; `skipDangerousModePermissionPrompt=true`; `verbose=false`;
    `autoCompactEnabled=false`; `showTurnDuration=false`; `terminalProgressBarEnabled=false`;
    `useAutoModeDuringPlan=false`; `statusLine`(Phase 3).
  - **흡수 금지:** agent-config의 peon-ping/hooks/keybindings/개인취향 — agent-config 영역.
- **state 파일 (핵심, GPT힣 지적):** `${CLAUDE_CONFIG_DIR:-~/.claude}/pi-shell-acp.install-state.json`.
  install이 touched key의 **기존 값**을 저장(없던 key는 absent 마킹; 배열은 "우리가 추가한 항목"만).
  uninstall: 원래 없던 key→제거, 있던 key→원값 복원, 배열→우리가 넣은 항목만 제거. **단순 jq merge로
  scalar false 토글을 빼면 사용자 원값을 망가뜨림 — state 없이는 정직한 uninstall 불가.**
  wrapper도 state preflight 통과 전에는 Claude plugin/MCP remove를 절대 호출하지 않음(무상태 side-effect 금지).
- **python3 toolchain gate (install + doctor 둘 다, GPT힣 최종):** doorbell FileChanged가 python3로
  JSON 파싱. install 성공해도 python3 없으면 wake runtime만 조용히 죽음 → install·doctor 모두
  fail-fast(공식 runtime dependency로 선언, "대부분 있으니까" 금지).
- **doctor 강화 (블로커 2 소비 + 블로커 3 감지):** `meta-bridge-hook.log`의 미회복 ` ERROR `를 fail로
  (회복 기준은 이후 `INFO armed watch`; UserPromptSubmit backfill INFO는 회복 아님);
  meta-session store 전수 스캔으로 corrupt record / duplicate `nativeSessionId` / body·filename drift
  / backend↔wakeMode contradiction을 fail-loud(**자동삭제 금지**). 기존 platform/toolchain/plugin/
  baked-node/USER-MCP/store/hook-log 체크 유지 + python3 추가.
- **출발점:** `scripts/meta-bridge-install.sh` / `meta-bridge-doctor.sh`. installer가 지금 `claude
  plugin install` / `claude mcp add` CLI에 위임하는 부분이 settings.json 두 키를 박는데, 그 정직성
  (state 기록·원복)을 우리가 통제하도록 전환. **uninstall 스크립트는 신규.** smoke 게이트 동반.

**Phase 3 — DONE (2026-06-06): statusline.** 현 Claude statusline 베이스(GLG 만족)에 pi 스타일
`🪛 <garden-id> cc`를 덧붙인 repo-owned 판. 구현 전 실측: Claude Code statusline input의
`session_id`가 hook `session_id`/meta-record `nativeSessionId`와 일치함을 확인
(`f232cc4a-29a9-42d9-8295-e4e3707c0c40` → `20260606T133915-418d94`).
`meta-bridge-statusline.sh`가 매 실행 meta-record **body scan**으로 garden-id를 찾는다(캐시/DB 없음).
Claude Code 문서상 statusLine은 multiple lines를 공식 지원하므로 기본 레이아웃은 2줄:
1행 `<device> <cwd> [branch]`, 2행 `🪛 <garden-id> cc | <model> | <context>`.
install이 `statusLine` 키를 state로 관리하고 doctor/smoke가 wiring + fallback + 2줄 출력을 검증한다.
**색/테마/개인취향은 agent-config 영역.** 지금은 통째로 pi-shell-acp가 소유하고, 나중에 풀기능에서
agent-config로 일부 이관한다.

**Phase 4 — DONE (listing-only, 2026-06-06): meta-store prune 표면.** abandoned meta-record 누적 문제
(doctor는 corrupt/duplicate/drift만 red, transcript-gone은 일부러 통과 → green store가 조용히 비대).
`./run.sh meta-bridge-prune`가 store를 scan해 **orphan**(transcript-gone) / **stale**(lastSeen>ttl,
default 30d, `--ttl-days`) / **ambiguous**(corrupt·drift·duplicate, manual-only) / **keep**로 분류하고
orphan·stale의 수동 `rm` 명령을 출력한다. **삭제는 아무것도 하지 않음 — `--apply` 없음**(자동삭제 금지,
authority ambiguity 정직성). repo CLI가 schema 이해·transcript existence·분류·safety wording을 소유;
스킬은 나중에 이 CLI를 부르는 얇은 wrapper로 충분. offline `smoke-meta-prune`(every-class 합성 store +
no-deletion 검증)가 `pnpm check`에 편입. Landed: `scripts/meta-bridge-prune.ts`,
`scripts/smoke-meta-prune.sh`.

- **Phase 4 후속 (post-0.10.0, GLG 재오픈 시):** 실제 GC 자동화 — `--apply`(또는 `--print-rm` 게이트),
  TTL/liveness 코드화, **글로벌 설치 스킬로 에이전트가 뒷정리**(동작 로직 방해 금지). corrupt/duplicate가
  그 nativeId registration을 영구 차단하는 문제도 이 트랙. 참고: `agent-config/.claude/skills/agent-config/`.

**Phase 5 — DONE (2026-06-06): native sender identity + addressee delivery.** 네이티브 세션이 받는
쪽(addressable)뿐 아니라 **보내는 쪽도 신뢰**됨 — `SessionStart` 훅이 공유 부모 pid 키로 sender marker를
쓰고, MCP(`PI_SESSION_ID` 없음)가 `process.ppid`로 그 marker를 읽어 send를 replyable
`meta-session`(garden-id)으로 승격. marker는 `ownerPid`+boot-unique `ownerStartKey`라 pid-reuse는
거절. `PI_TOOLS_BRIDGE_REQUIRE_META_SENDER=1`(Claude user-scope install이 설정)이 **anonymous-send 구멍**을
막음. `entwurf_resume` async 판별자는 `replyable`이 아니라 **`origin==="pi-session"`**으로 교정 —
meta-session은 mailbox-replyable이지만 control socket이 없어 async followUp 불가 → sync. preventive
keyset-overlap 가드(`check-keyset-overlap`)도 추가. Landed: `smoke-meta-sender-identity`,
`smoke-meta-mailbox`, `smoke-meta-keyset-guard`, `check-async-resume-gate`(19 assertions) — 전부 `pnpm check`.

**Hardening — DONE (2026-06-06):** (1) **doctor fail-loud 복원** — `[managed config state]`가 `set -e`
조기 종료로 drift detail 없이 죽던 버그를 `if` 조건으로 교정, `smoke-meta-install-state`에 hermetic
regression(negative-tested). (2) **#34 D8 level-triggered body-drain 가드** — 한 번의 `readMetaInbox`가
디렉토리 전체를 드레인(coalesced/lost signal에도 무손실)함을 `check-meta-session`이 3-message로
assert(negative-tested). DELIVERY.md D8 문구는 GPT가 정돈 중.

**다음 한 걸음 — 0.10.0 cut readiness.** 구현(Phase 0~5) + hardening 다 landed. **문서 일차 준비 완료**
(package.json `0.10.0`, CHANGELOG `## 0.10.0 — 2026-06-06` 헤더/라벨 정렬 + Phase 5/doctor/#34 D8 항목
추가; GPT 2차 리뷰 예정). 남은 cut 작업: (a) `smoke-meta-async-drift`를 `release-gate`로 승격(host
Claude binary 의존이라 `pnpm check` 밖) + (b) GLG 머신에서 `install-meta-bridge` → `doctor-meta-bridge`
live 재확인(현재 새 `desired_mcp`의 `REQUIRE_META_SENDER` 때문에 drift 상태) + (c) 커밋 + 0.10.0
태그/push/stamp(`tag-release` skill). scope creep 주의: 여기서 `--apply`/자동 GC로 새지 말 것 — 위 Phase 4
후속 트랙은 post-0.10.0.

**#34 잔여 (post-0.10.0 트랙, doc 제외):** empirical probe 4종(FileChanged coalescing bound /
active-turn arrival / watchPath 고갈 / compact-window) + unread-mailbox heartbeat backstop. deterministic
절반(catalog 1–4 + level-trigger)은 닫힘. DELIVERY.md D8 문구는 이번 컷(GPT).

**비-cut 트랙 (0.10.0 메타브릿지 active 동안 끌어오지 말 것):** step 7 `entwurf_peers(includeMeta)`
(메타세션 발견성 — 가치 있으나 릴리즈는 install/doctor 우선), 0.9 follow-ups, dep bump,
`incompatible_config`, #25 bridge-hygiene. GLG가 재오픈할 때만.

**Scope guard:** do NOT build a generic worker-pool orchestrator out of #31 — document the
parallel-team pattern, keep the bridge thin. Doorbell delivery is notice-only + self-fetch; never
inject imperatives through a hook channel.

## Next — 0.11.0: entwurf tmux-live lifecycle, pi = 4번째 메타 백엔드 (#35)

> **상태: 설계 동결 (2026-06-09, GLG + GPT힣 + Claude 3자 수렴). 각 요소 실측 완료 — 구현 세션
> 진입 시 설계 재탐색 불필요.** 아래 검증 원장의 항목은 다시 찌르지 말 것(doctor 실패/구체 버그만 예외).
> 구현 세션은 각 요소의 regression gate를 먼저 만들고, 그 다음 빌드 + 연결한다.

**개념 닻 = #35 (SSOT, workshop≠factory).**
bbot가 일부러 컨셉만 담았다. 아래는 그 frame 위에서 GLG와 동결한 *설계*다.

### 왜 0.11.0인가 — 전략 전환
- 현 entwurf spawn은 `pi -p` headless 전용 → **pi만 분신이 된다.** Claude를 분신으로 부르려면 Claude
  Code를 *live interactive* 로 띄워야 하고, native는 headless live 불가 → **tmux가 launch surface**
  (`claude -p`/`pi -p`는 fresh-context·disposable이라 live 분신 surface 아님).
- **ACP 중심에서 내림(유지·관리는 계속).** 6/15 이후 ACP 사실상 미사용(antigravity 미지원, claude/gemini
  미사용, pi codex 네이티브). 1.0.0 = pi-shell-acp는 `plugins/`로, 프로젝트 중심은 **meta-bridge entwurf**.
- **pi = 4번째 메타 백엔드.** `META_BACKENDS += "pi"`. THE 하네스에서 garden-id 동료 시민으로 (North
  Star "no backend is privileged" 현금화). **순서: pi headless/tmux-live 먼저 + 테스트 → 그 다음 Claude
  Code ↔ Claude Code live.**

### 넘으면 안 되는 선 (전부 #35)
- **Workshop, not factory.** 살아있는 소수 도제 = 재질문 가능, 상태는 세션 안 → 외부 DB(beads/dolt) 금지.
- **GC = tmux 프로세스 자원 회수만, 데이터 삭제 절대 아님.** meta-record/transcript(denote-id 기억층)는
  남김. Phase 4 data prune(listing-only)과 **별개 cleaner 표면** — collapse 금지.
- **garden-id = authority, tmux = ephemeral.** 세션명=path(grouping), window 번호 renumber.
- **Factory 작업 OUT.** worktree·merge-wall fan-out 없음 → 백엔드 자체 orchestrator로 위임.

### 핵심 아키텍처 — 데이터 4분리 + 한 동사
- **record(누구였나)** / **capabilities(무엇·어떻게 깨움)** / **mailbox(메시지·receipt)** /
  **probe(지금 살아있나, 저장 안 함 — 매번 계산)**. 상태를 저장하면 거짓말이 된다(denote-instinct 함정).
- **두 레인 둘 다 KEEP:** `pi -p` headless(오케스트레이션, 가벼움) + tmux-live(`--entwurf-control`
  소켓, 도제). resume/send는 세션 type이 아니라 **현재 liveness의 함수** — dormant→resume, live→send.
- **entwurf = 한 동사.** spawn/resume/send는 probe 결과의 내부 디스패치. low-level primitive는 숨기되 유지.
- **브레인 ↔ 핸드 분리.** 브레인=`entwurfcli`(Go, 하네스 중립 fact-provider) — `activeEntwurfs` Map은
  pi 프로세스 1개의 기억이라 형제가 못 봄(= 현 pi 분신 비가시성의 근본). 핸드=기계적 실행(Stage 0은
  기존 TS primitive 재사용). **최종 형제 선택은 에이전트, Go는 근거 제공.**

### 검증 원장 — 실측 완료 (2026-06-09, 설계 재탐색 불필요)
| 요소 | 실측 결과 |
|---|---|
| tmux 3.6a | `@garden_id` 유저옵션 `list-panes -a -F` 라운드트립 OK. **`pane_title`은 셸이 덮어써 휘발성 → correlation 금지.** 안전 필드만: `@garden_id`+`pane_id`+`pane_pid` |
| go 1.25.9 | 단일 바이너리 `entwurfcli` 구현 toolchain OK |
| pi 0.79 trust | `pi -p`는 **trust에서 안 멈춤**(비대화 미결정→`false` degraded). `--approve`(`trustOverride=true`)가 맨 앞 short-circuit. store=`~/.pi/agent/trust.json`(canonical cwd→bool) |
| trust input 정의 | cwd→root 상향 walk: `.pi/`\|`AGENTS.md`/`CLAUDE.md`\|`.agents/skills`. **`~/AGENTS.md` 때문에 ~ 아래 전부 trust-input → prefix+`--approve`가 유일 메커니즘** |
| meta v1 | schemaVersion=1, `lastSeen`+`delivery{}` 있음, `model`/`parentGardenId`/`isEntwurf` 없음. 디스크 claude-code v1 10+개 |
| **model@birth 없음** | Claude SessionStart stdin=`{session_id,transcript_path,cwd}`, `MetaMintInput`에 model 없음 → **v2 model/transcriptPath는 nullable** |
| pi liveness | `~/.pi/entwurf-control/<gid>.sock` 존재+pid alive(stale sweep) |
| pi tmux 부팅 | 강제 `--session-id <gid>` + `--entwurf-control` → 소켓 생성 OK, no prompt. **correlation=소켓파일명+@garden_id (environ PI_SESSION_ID는 상속/exec-snapshot이라 폐기)** |
| pi 확장 API | `SessionStartEvent` 존재 → pi가 session_start에 meta-record upsert 가능(4th backend 경로) |

### meta-record v2 (nullable-at-birth)
```jsonc
{ "schemaVersion": 2, "gardenId":"…", "backend":"pi|claude-code|codex|antigravity",
  "nativeSessionId":"…", "cwd":"…",
  "model": null, "transcriptPath": null, "parentGardenId": null, "isEntwurf": false,
  "createdAt":"…", "recordUpdatedAt":"…" }
// 제거: status·lifecycle·wakeMode·deliveryLevel·delivery.*·trusted·tmuxTarget
// recordUpdatedAt = record touch time(이름으로 못 박음), liveness 아님
```

### 동결 결정 7개
1. 능력 레지스트리 = 새 파일 `entwurf-capabilities.json` (targets=launch allowlist와 별 관심사)
2. v1→v2 = `parseMetaRecordV1/V2`→`normalizeMetaIdentity` dual-read + lazy normalize, 새 write는 v2.
   v1 receipt 필드는 읽되 v2에선 mailbox state로 이동
3. correlation = 소켓파일명 + tmux `@garden_id`. **env probe 폐기 + launcher가 identity env scrub/명시
   override**(상속 누수 차단; lineage는 `PARENT_SESSION_ID`를 launcher gid로 명시 set)
4. Go = Stage 0 **fact-provider**(`peers`/`who-can`/`preflight --json`), TS=hand/executor.
   `plan` JSON은 explicit target일 때만(최종 선택자로 만들지 말 것)
5. untrusted controlled launch = **fail-fast** (조용한 `--no-approve` degraded 금지)
6. `project_trust` handler `remember` = **false** (prefix policy = SSOT, trust.json 안 더럽힘)
7. prefix auto-approve roots = `~/repos/gh`, `~/repos/work`, `~/org` (**`~/repos/3rd` 제외**)

### Trust 2층 (구현 형태)
- **사람이 직접 여는 pi** = global `project_trust` 확장이 prefix policy로 `{trusted:"yes",remember:false}`
  / unknown은 `{trusted:"undecided"}`. (안전망)
- **entwurfcli/launcher가 여는 controlled session** = handler에 의존 금지(`--no-extensions`면 안 돎).
  `preflight(cwd)`가 trust.json+prefix로 판단 → trusted면 `--approve`, untrusted면 fail-fast.

### Go packaging (운영)
`cmd/entwurfcli` Go source + `run.sh build-entwurfcli` + `ENTWURFCLI_BIN`/PATH 탐색 + doctor fail-loud.
**npm package가 Go build를 암묵 요구하면 안 됨** — 기존 TS primitive는 fallback/compat 유지.
1.0.0서 Nix/binary release로 승격.

### Stage 0 순서 (pi only)
1. **trust preflight** — prefix policy + controlled launch 내부 `--approve` + untrusted fail-fast
2. **meta-record v2** — pi backend 포함, identity-only, golden fixture, v1 dual-read+normalize
3. **entwurfcli Go 3 fact-verb** — `preflight` / `who-can` / `peers`(record 스캔 + 소켓/tmux probe)
4. **상위 entwurf 단일 표면** — entwurfcli 근거 → pi bg(`pi -p --no-extensions --approve`) 또는 tmux-live,
   primitive 내부 유지
→ **각 요소는 테스트 코드로 먼저 검증, 연결은 그 다음.** Stage 1 = Claude Code ↔ Claude Code live.

### 0.10.0과의 관계
0.10.0 cut(meta-bridge delivery/install/doctor)은 #35 frame을 배신하지 않음(workshop-safe). cut을 막지
않으며 0.11.0은 그 substrate(SessionStart 훅·mailbox·doorbell·소켓) 위에서 launch surface를 tmux-live로
통일 + pi를 4th backend로 편입한다.

## Recently landed — evidence closure on the 0.9.0 substrate (under CHANGELOG `## Unreleased`)

Closes two 0.9.0 carried follow-ups by making indirect proofs direct, plus one stale-item trim.
**No release** — runtime behavior is unchanged and there is no user-facing value, so this stays on
`0.9.0` with the entry under `## Unreleased`; a tag waits for 0.10.0 or a real runtime/user-facing
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

## Standing focus — Mitsein over MCP: plain external vs garden-native meta-session

상시 초점: `pi-shell-acp` 를 OpenClaw plugin 으로 더 미는 것보다, **pi session ↔ Claude Code /
external MCP host ↔ pi-tools-bridge ↔ entwurf** 가 서로 다른 하네스 정체성을 유지하면서 함께
일하는 시나리오를 검증한다.

2026-06-06 전환: 예전 "외부 MCP host = non-replyable" 비대칭은 **plain external** 에만 맞다.
Claude Code native 가 meta-bridge `SessionStart` 로 garden citizen 이 되고 sender marker 까지 쓰면
그 세션은 pi control-socket 은 아니지만 `entwurf_send` 에서는 **replyable meta-session** 이다.
즉 send/inbox는 대칭 공존으로 닫혔고, 남은 비대칭은 `entwurf_resume` async followUp 같은
pi control-socket 전용 채널이다.

핵심 질문:
- agent 가 plain external(non-replyable) 과 garden-native meta-session(replyable by garden id)을
  구분하는가?
- `entwurf_send` 는 fire-and-forget, `entwurf` / `entwurf_resume` 는 outcome ownership 이라는
  역할 분담이 실제 워크플로에서 헷갈리지 않는가?
- Claude Code 가 설계/리뷰하고 pi-shell-acp 세션이 실행하거나 그 반대인 시나리오가
  문서/로그/UX 상 정직한가? (서로 forward 하지 않고 GLG 가 역할을 정하는 패턴 유지.)

성공 기준: 각 시나리오에서 "누가 outcome 을 소유하는가" 가 명확하고, replyable / non-replyable /
send-is-throw / MCP `entwurf_resume` 조건부 async default(0.7.6) 경계가 agent 발화에 정확히
반영된다. 특히 native Claude meta-session 이 `external-mcp/claude-code` 로 퇴행하거나
`wants_reply=true` 를 비대칭 논리로 거절하면 버그다 — install/doctor/sender-marker 경로를 본다.

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
