# NEXT.md — pi-shell-acp

> 다음에 할 일만 남긴다. 로그가 아니다.
> 결정 trace 와 evidence 는 commit history / CHANGELOG / VERIFY / BASELINE / README / AGENTS / 코드로 보낸다.

## Active — 1.0.0 axis: external native sessions as garden citizens (#30)

0.9.0 closed the pi-native half of garden-native session identity: pi Entwurf sessions
and the resident `--entwurf-control` operator session are born on a **garden session id**
(`YYYYMMDDTHHMMSS-[0-9a-f]{6}`), spawned with `--session-id` + `--name`, resumed by
header-scanned id + saved header cwd, and the resident session hard-exits if its id is not
garden-native. Grammar + enforcement live in code + AGENTS.md §Entwurf — do **not** re-derive
them here.

1.0.0 (#30) extends the same top-level concept — **garden session id** — to *external native*
sessions (Claude Code / Codex / Gemini standalone), so they become garden citizens without
faking pi transcript ownership.

**Non-negotiable direction:**
- The garden session id is the top-level identity; pi sessions were the *first* backend to use
  it directly. External backends get it through **opaque meta-session records**, NOT
  reconstructed pi JSONL (Hard Rule #8: this bridge is not a second harness — no transcript
  hydration, no tool-result ledger).
- lookup / resume authority stays = header `id` + header `cwd`. Never filename parsing. The
  meta-session record is an opaque pointer, not a hydrated transcript.
- naming/docs must not regress to "sessionId is only a pi transcript id" — keep garden-native
  language where accurate.

**Open questions to settle before coding 1.0.0:**
- meta-session record shape + storage + discovery (the header-scan analog for a backend that has
  no pi JSONL).
- how an external native session registers a garden id without a pi session file.
- cross-backend continuity surface that stays honest (pointer/record, never fake ownership).

**Scope guard:** do NOT build a generic worker-pool orchestrator out of #31 — document the
parallel-team pattern, keep the bridge thin.

## Carried-forward follow-ups from 0.9.0 (real next work, not cut blockers)

- **cross-cwd resume authority (T5) — dedicated live gate STILL TODO.** Resume must append to the
  existing sessionId from the saved header cwd; wrong cwd must not silently create a new session.
  Footgun is proven in `smoke-session-id-name` T3 and the resume path forces child cwd to the
  saved header cwd, but there is no dedicated end-to-end resume-append live gate yet.
- **resume-into-uuid pre-cancel — not yet live/deterministically proven.** The
  `session_before_switch` reason `"resume"` non-garden pre-cancel is backstopped by the
  `session_start` hard guard but needs a synthetic legacy-uuid session file to prove the friendly
  pre-cancel path directly.
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
- **semantic-memory `_entwurf-` guidance refresh.** `agent-config` `skills/semantic-memory/SKILL.md`
  still mentions `--session-file-contains _entwurf-` (filename species). Migrate to garden-native
  discovery: session header id + the `entwurf` name tag, not filename species. (`entwurf-peek`
  already migrated in 0.9.0.)

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
