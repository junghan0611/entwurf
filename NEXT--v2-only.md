# NEXT — `v2-only` 브랜치 (subtract-to-v2)

> 부트섹터: **지금 어디 · 다음 한 걸음 · 넘으면 안 되는 선**만.
> 이 브랜치는 main 머지 전 삭제하고, 닫힌 결과는 ROADMAP/CHANGELOG로 승격.

## 목표 (한 줄)

**copy-subtract, then rename.** pi-shell-acp에서 ACP/v1을 빼서 **v2-only로 동작**시킨다.
이름 변경(`pi-shell-acp`→`entwurf`)은 **이 브랜치에서 안 한다** — rename은 Phase B(별도).

# NOW

- **Current**: subtraction 완료 + `pnpm check` green + LIVE 실증. v2 substrate(두 레일: 컨트롤소켓 / 메타메일박스)가
  thinkpad에서 라이브 왕복 확인됨(Claude↔GPT). entwurf_peers 두-레일 통일 + bounded output까지 push 완료(`6286755`).
  **Phase B를 막던 게이트("v2 green 확인")가 이제 충족됨 → 분기점.**
- **Next (GLG 결정 1건)**: 셋 중 택1 —
  (a) **릴리즈 컷**: v2-only 마일스톤을 CHANGELOG+CalVer 태그로 박음 (`tag-release` 스킬, CHANGELOG의 옛 "MUST PASS=17"→현재 floor MUST 6 갱신 동반).
  (b) **Phase B 시작**: rename(`pi-shell-acp`→`entwurf`) — 아래 "Phase B 잔여" 묶음을 새 브랜치에서 절삭.
  (c) **merge**: v2-only를 main으로.
- **Blocker**: none. (push/tag/merge = GLG)
- **Read**: `AGENTS.md`(v2-only baseline) + 이 파일 LEDGER.
- **Do not touch**: rename(이 브랜치 범위 밖) / `core.hooksPath` / `~/repos/gh/entwurf` 셸(Phase B destination).

# RECENT

- [2026-06-17] **v2-only subtraction 정리** (ACP/v1 제거). 닫힌 작업 전체는 `CHANGELOG.md` ## Unreleased 참조 (태그 미컷).
  baseline `v0.11.0`..HEAD. `pnpm check` green + `LIVE=1 release-gate` MUST 6/6 (thinkpad) + 두 레일 라이브 왕복.

# LEDGER

## 잠긴 결정
- **전략 = subtractive** (additive는 import-그래프 밖 자산 silent 누락; subtractive는 게이트가 loud로 잡음).
- **D1 = 새 `entwurf` 설정 네임스페이스** (`{"entwurf":{"targetsPath":"~/.pi/agent/entwurf-targets.json"}}`),
  `piShellAcpProvider` 폐기. 최상위 `mcpServers`는 충돌 위험이라 비채택. **적용=Phase B(rename).**
- **D3 = 공존 허용 + single-writer guard** (takeover 금지). 공유 자산은 schema-compatible + owner marker/doctor conflict check,
  충돌 시 **fail**(warn 아님). **적용=install/doctor 수술 시.**
- **fresh sibling minting = 명시적 연기 → 0.12.x lane (ROADMAP).** v2 3 transport는 전부 *기존* citizen 대상이라
  "무에서 새 형제 생성" verb 없음. 이 능력 구멍은 *문서화된 의도*(silent 아님). 그동안 "새 분신 생성" 데일리드라이버로 안 씀.

## Phase B 잔여 (rename 단계에서 묶어 절삭 — 여기서 안 건드림)
- **rename 본체**: `getRegistryRouting`(`entwurf-core.ts:991,1089`) 하드코딩 `provider:"pi-shell-acp"` /
  `scripts/resolve-acp-bridge.ts`(orphan 심화 확정) / `mcp/index.ts` description 문자열.
- **dead export**: `entwurf-core.ts`의 `runEntwurfSync`/`runEntwurfResumeSync`(호출처 0) — 라우팅 잔여와 얽혀 rename 직전 절삭 (GPT 확인).
- **model-lock vestigial** (GPT A): `model-lock.ts`의 본질=`native↔pi-shell-acp provider` 전환 revert인데 ACP 제거로 막을 provider 모델이 사라짐. 즉시 삭제 말고 **Phase B에서 제거 vs 새 entwurf 개념으로 재정의** 결정 (과거 saved session에 박힌 provider 잔재 가능성). 헤더는 doc-truth 배너로 낮춤(`beed720`+후속), `getRegistryRouting`와 함께 절삭.
- **README**: 아직 ACP 시대 — Phase B doc 패스에서 재작성.
- **stale 주석 잔여**: `sentinel-runner.sh`(225/457)만 남음 (sentinel 자체가 LEGACY라 sentinel 처분과 함께). check-model-lock·matrix-live는 `beed720`으로 DONE.
- **session-messaging / sentinel** (GPT B): release floor로 되살리지 말 것. 둘 다 drop/archive 우선. session-messaging만 재작성 가치 있으나 matrix-live가 상당 부분 커버 → 중복이면 drop. sentinel은 v1 model-in-loop 성격이라 Phase B 제거 또는 완전 신규 설계. 지금은 LEGACY fail-loud 보존.
- **B = 배포 위생(D1)**: 전역 `pi-shell-acp` 설치를 v2-only로 올릴지는 daily 운용 판단으로 분리(이 gate는 deployment-smoke 아님).

# 넘으면 안 되는 선
- **rename 금지(이 브랜치)**. D1/D3는 잠겼지만 적용은 해당 단계(D1=rename, D3=install/doctor).
- `core.hooksPath`/`.git-hooks-mode` 불변. push/tag/publish/merge = GLG. `--no-verify` 금지(green 복구됨).
- 삭제는 게이트 동반(결합 규칙) — 함수 + run.sh case + npm script + check 체인 동시.

# 참고
- **원형**: `~/repos/3rd/agent-stuff/extensions/control.ts`(badlogic) = `entwurf-control.ts` 원형.
  `updateSessionEnv`가 PI_SESSION_ID만 set → PI_AGENT_ID는 pi-shell-acp 고유 확장 확증.
- GPT(codex)와 동행(subtractive, 삭제 먼저 rename 나중). `~/repos/gh/entwurf`에 GPT가 깐 v2-only 셸 문서 = Phase B destination.
- 실측 기준선: v2 closure ~33파일/11,400줄, rename 대상 `pi-shell-acp`류 89파일/1508곳(Phase B에서 단계적·게이트검증, 한 방 sed 금지).
