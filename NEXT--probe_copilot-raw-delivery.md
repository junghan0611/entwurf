# NEXT — probe/copilot-raw-delivery

> Branch-only disposable boot sector. Main `NEXT.md` remains on 0.14.1 publish +
> the OPEN-4 defect train. Delete this file before merge after durable facts have
> been promoted to `DELIVERY.md`, `ROADMAP.md`, and the raw-probe README.

# RAIL — 현재 좌표

- [x] **1. Identity/transport 판별** — shell `sessionStart` 경로 거절; CLI 1.0.80 hidden `--ui-server` + official SDK 1.0.11 protocol v3 발견
- [x] **2. Addressed continuation 증명** — D0–D7 pass; idle A-only wake; no-turn control B 무변화
- [ ] **3. Oracle 독립 검토** ← CURRENT: review-checkpoint commit/push 후 blocker/defect/observation 분류
- [ ] **4. Admission measurements** ← PAUSED: Oracle amendment bundle이 닫힌 뒤 active-turn · permission · missing-idle · auth/stale 측정
- [ ] **5. Go/no-go** — native-push 승격 / verified-probe 유지 / decline

현재 좌표: **native 전달·주소 격리 증명 완료 → Oracle 검토 대기 → admission은 보류**

# NOW — Oracle review checkpoint

- **Current:** Copilot은 GitHub issues/PR/CI와 model `auto`를 가진 별도 harness로서 product case가 있다. 그러나 hidden UI server의 fail-closed transport boundary가 없어 managed citizen lane으로 admissible하지 않다.
- **Next:** `(1)` `275da1f..probe/copilot-raw-delivery` 검토 → `(2)` probe의 marker-turn 판정·A/B 격리·cleanup·bounded `getEvents()` 사용을 점검 → `(3)` docs의 D0–D8 주장과 blocker를 대조 → `(4)` blocker/defect만 한 amendment bundle로 반영한다.
- **Oracle review rule:** static review first. GLG가 별도 승인하지 않으면 Copilot LIVE/model turn을 재실행하지 않는다. bg10의 D0–D7 receipt는 현재 측정 증거이지 Oracle 재현을 선결조건으로 만들지 않는다.
- **Verify before review checkpoint:** `pnpm lint` · `node --check scripts/raw-async-delivery/copilot-ui-server-probe.mjs` · `git diff --check`. 이 push는 review checkpoint이며 acceptance/full-floor claim이 아니다.
- **Verify after review:** amendment를 얼린 뒤 `pnpm run check:full` 한 번. gate/mutant는 바뀌지 않았으므로 `check-gate-qualification` 대상이 아니다.
- **Blocker:** Oracle 검토 자체는 blocker 없음. Managed lane은 permission ownership, multi-session missing `session.idle`, authenticated/equivalent same-user boundary, stale/crash behavior가 blocker다.
- **Read:** `DELIVERY.md` Copilot section · `scripts/raw-async-delivery/README.md` Copilot section · `ROADMAP.md` Copilot probe entry · `scripts/raw-async-delivery/copilot-ui-server-probe.mjs`.
- **Do not touch:** `META_BACKENDS` · `FRESH_CALL_BACKENDS` · v2 decider · OPEN issues · undocumented `~/.copilot/run/ws.*` · pty delivery · transcript/state writes · credential copying · generic role/orchestrator machinery · main `NEXT.md`.

# REMAINING BUDGET / STOP RULE

## A. Verified probe로 닫기

- Oracle review 1회 → amendment bundle 0–1회 → frozen candidate full floor 1회 → defer/decline 결정.
- 예상: **1–2 focused sessions**. Transport boundary가 supported/fail-closed가 아니면 여기서 멈춘다.

## B. Admission 판단까지 측정

1. active turn에서 `enqueue`와 `immediate`를 비교한다;
2. harmless permission tool 1개로 TUI-vs-SDK decision ownership을 판별한다;
3. 두 세션에서 ephemeral `session.idle` 누락을 설명하거나 bounded defect로 확정한다;
4. auth/equivalent same-user boundary와 stale endpoint rejection을 증명한다.

- 예상: **2–3 measurement sessions**, 대략 **3–5 Copilot model turns**. 측정 실패는 구현 과제가 아니라 no-go 근거다.

## C. Managed citizen 구현 — admission이 모두 양성일 때만

- record/backend contract, port/session registry, liveness probe, native-push adapter, doctor/install/docs/gates, LIVE acceptance와 독립 review가 별도 lane으로 필요하다.
- 예상: 최소 **3–5 focused implementation/review sessions**. `fresh_call`은 자동 포함하지 않고 별도 product decision으로 남긴다.

# MEASURED FACTS — 2026-08-19

- CLI `1.0.80`, SDK `1.0.11`, protocol v3.
- `getForegroundSessionId` + metadata가 exact native id와 cwd/git context를 결합했다.
- idle target A는 zero-typing wake; model `auto`는 `gpt-5.6-luna`를 선택했다.
- control B는 marker/user/turn/assistant event를 받지 않아 D3가 통과했다.
- single-session에서는 `session.idle`을 봤지만 two-session joining client에서는 누락됐다. TUI와 persisted `assistant.message` + `turn_end`는 완료였고 SDK `sendAndWait()`만 60초 timeout했다.
- probe는 official `send()` + bounded `getEvents()`로 marker turn의 완료를 읽는다. 이는 evidence probe이며 product polling/retry 설계가 아니다.
- loopback server는 no-token client를 받았고 token-bearing client는 `AUTHENTICATION_NOT_CONFIGURED`로 거절했다. TCP port는 runtime endpoint일 뿐 identity authority가 아니다.
