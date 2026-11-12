# NEXT — #142 ACP 0.106 + effort (branch `feat/142-acp-0106-effort`)

브랜치 레인 핸드오프. 병합 전에 삭제한다. 정본 계약은 `docs/acp-backend-rail.md`(§Capability posture 0.90.0 → 0.106.0, §Claude effort), `VERIFY.md`, ROADMAP Dep bump 원장 2026-11-13 항목.

# RAIL — 현재 좌표

- [x] **1. 구현 C1–C4 + focused gate** — 0.106/SDK 2.6, fable-5-2, idle compaction 차단, effort set+readback·notice
- [x] **2. 독립 검수 + amendment** — b3fc7c 검수 1–3·봉인 확인, Blocker 0, 남은 Defect 0
- [x] **3. 영향 PARTIAL r3/r4 + LIVE 3+1 turn** — r3 87/87(포맷 전 후보), r4 60/60(최종 후보), LIVE receipt 2건
- [x] **4. frozen FULL** — `f54844a2…` rc=0(check:full 979s / runner 980s), 동결 6항목 동일
- [x] **5. branch checkpoint** — `90b5168` push, exact-SHA CI 4 job success; #142 본문·진행·ESC 댓글
- [ ] **6. 다음 계약 후보 결정** ← CURRENT: GLG 판단 대기(코디 68bd94 경유)
- [ ] **7. main 병합 / release / 운영 설치** ← PAUSED: 각각 GLG 별도 승인

현재 좌표: 5 완료 → 6 대기 → 7 보류

# NOW

- Current: checkpoint `90b5168`이 브랜치에 있다. ESC n=1(재사용 turn, Bash 도중 RPC abort) 관측 완료. #142가 외부 자문용으로 정리돼 있다.
- Next 후보(미승인): 첫 턴 ESC(대화 버림)와 재사용 ESC(live 세션 보존)의 비대칭을 운영자에게 notice로 드러내기. 착수 전 GLG 승인.
- Blocker: 다음 계약·병합·release·설치는 모두 GLG 결정.
- Read: #142 본문, [진행](https://github.com/junghan0611/entwurf/issues/142#issuecomment-6838220924), [ESC](https://github.com/junghan0611/entwurf/issues/142#issuecomment-6838283088). host-local: FULL `~/.cache/entwurf-qual/acp106-full-20261113T073220/`, ESC `.tmp-verify/acp142-live/esc-20261113T075632/RECEIPT.md`.
- Do not touch: credential 값을 agent가 읽기·복사·로그하기, 새 로그인, env key 우회(auth A는 허용된 기존 동작); 운영 overlay/설정/hook 변경; worktree; `--no-verify`; 전역 pnpm 정책 완화; 승인 없는 실 모델 턴; whole BODY(코디 결정 0).
- 증거 범위: ESC n=1은 같은 공개 acpSessionId의 live 세션 재사용까지만 관측했다. private Claude 정본 계보와 wire cancel 프레임은 확인하지 않았다. 첫 턴 ESC, 텍스트 스트리밍 중 ESC, Edit/Write 효과는 측정하지 않았다.

## 릴리즈 후 — 실사용 목표 (GLG 2026-11-13)

이번 종착점은 gate 통과가 아니라 **릴리즈 뒤 Claude도 pi ACP에서 주력으로 일하고, 거기서 겪는 불편이 다시 이 접점의 수선으로 돌아오는 것**이다. 새 manager·feedback 수집 체계·테스트 매트릭스는 만들지 않는다.

- 전제: 설치·운영 교체·새 시민 launch는 GLG 별도 승인 뒤에만(코디 68bd94가 한 묶음으로 확인). 기존 normal auth·identity·운영 창 계약을 그대로 쓴다.
- 첫 실작업 한 동작: 승인된 설치 뒤 **새 pi ACP Claude 시민**을 열어(`entwurf/claude-opus-5-5`) 다음 실제 entwurf 작업 하나를 맡긴다. 그 자리에서 확인: 실제 로드된 패키지 bytes·버전, provider `entwurf`, effort 메뉴(low..max)와 `[acp: effort … read back]`, 도구 표면(Read/Bash/Edit/Write + entwurf-bridge), caller callback.
- 불편은 그 세션이 issue나 NEXT로 남기고 다음 수선의 입력으로 삼는다.
- 하지 않는 것: 새 pi ACP 시민을 기존 native Claude Code 대화와 같은 garden·정본 세션으로 조용히 옮긴 것처럼 포장하기, durable 통합·정본 resume을 몰래 동반하기. 맥락은 sources와 NEXT handoff로 잇는다.

## 목표 (GLG 잣대)

pi에서 ACP Claude를 주력으로 고를 수 있는 최소 동작: 얇은 Pi 접점, 실제 Read/Bash/Edit/Write·명시 MCP, effort 실설정+readback, 명명 오류·취소, 자율 턴/전량 재전송 없는 재사용. 재사용은 정상 경로에서 delta만 보내고, setup 실패로 세션을 버린 다음 턴의 cold 전체 전송은 이미 기록된 한계다. upstream 기능 전부 노출이나 Claude Code 복제는 목표 아님. readback만으로 속도 향상을 주장하지 않는다.

## 역할

- `20261113T043350-ff08d4` (Claude Code, Opus) — 실무 코디 + 유일한 구현 작성자
- `20261113T050059-b3fc7c` (Claude Code, Opus) — 독립 readonly 검수(종료)
- `20261014T212756-68bd94` — 운영 코디: GLG 대화·범위·최종 확인·DM
- GPT·다른 형제 소환/resume 금지. 유일한 예외: GLG가 직접 재초빙한 SOL `20261003T164401-a30dda` — 의미·사용 경험 논의 역할만, 코드 작성·검수·테스트·LIVE 권한 없음, 구현 질문은 ff08d4 통로로.

# RECENT

- [2026-11-13] FULL #3 GREEN → checkpoint `90b5168` push, CI 4/4 success. ESC LIVE n=1: abort 25ms 뒤 aborted, T3가 같은 acpSessionId를 reuse, count.log `start`만(30s 창, end 없음, 중복 없음).

- [2026-11-13] C1–C4: adapter 0.106.0 · wire SDK 2.6.0 · agent-sdk 0.3.322(`Usage` → `@agentclientprotocol/sdk/unstable`, 0.103 exports 축소 대응); `claude-fable-5-2` 큐레이션(5-1 유지); `settings.idleCompaction:false`; thinkingLevelMap low..max + effort set+readback(새 세션 set-model 직후, reuse는 변경 시만, signature 불포함), 레벨 없음/미지원 → `acp-thinking-level-unsupported`, notice `[acp: effort <v> read back]`.
- [2026-11-13] LIVE: opus high 새 세션(실 Read·MCP entwurf_self) → 같은 세션 low reuse(회상·실 Bash, input 6) → 같은 세션 medium(계획한 fable 전환은 model-lock이 되돌림); 별도 프로세스 fable-5-2 medium 새 세션.

# LEDGER

- PARTIAL 역사: 1차 `~/.cache/entwurf-qual/acp106-partial-20261113/` 86/86(launch-namespace r2 — 0.103 exports로 낡은 mutant replace 수선 후). notice 추가로 backend.ts가 바뀌어 최종 근거로 승격하지 않음. 그 전 시도는 receipt를 repo 안에 둬 인자 거절, mutant 미실행.
- 이전 봉인 `acp106-candidate-20261113T055508`, `…T065904` — superseded.
- 관측(작업 아님): pi cache-warmer는 `model.promptCache` 필요 → curated 행에 없어 ACP warming 턴 없음; `bypassPermissions`가 canUseTool을 가림; 한 프로세스 안 offered model 행 수가 세션마다 다름(5 → 14); pi 자체 compaction/export는 모든 `[acp: …]` notice를 요약 입력에 포함(기존 성질).
