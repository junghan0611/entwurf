# NEXT — #142 ACP 0.106 + effort (branch `feat/142-acp-0106-effort`)

브랜치 레인 핸드오프. 병합 전에 삭제한다. 정본 계약은 `docs/acp-backend-rail.md`(§Capability posture 0.90.0 → 0.106.0, §Claude effort), `VERIFY.md`, ROADMAP Dep bump 원장 2026-11-13 항목.

# RAIL — 현재 좌표

- [x] **1. 구현 C1–C4 + focused gate** — 0.106/SDK 2.6, fable-5-2, idle compaction 차단, effort set+readback·notice
- [x] **2. 독립 검수 + amendment** — b3fc7c, Blocker 0
- [x] **3. PARTIAL + LIVE 3+1** — r3 87/87, r4 60/60
- [x] **4. frozen FULL + checkpoint `90b5168`** — CI 4/4
- [x] **5. ESC 경계: C/E/F + checkpoint `ac087af`** — r5 65/65, FULL rc=0, LIVE n=1 per source, CI 4/4; 검수 D-C1/D-F1/O-F1 닫힘
- [x] **6. 상류 0.106 계약 대응표** — `docs/acp-backend-rail.md` §Upstream 0.106.0 cancel and effort contracts (docs-only)
- [x] **6b. 열린 칸 (1) P3 수선 + checkpoint `6059fe6`** — reuse handler를 prompt 송신 직전으로; PARTIAL 15/15, FULL rc=0
- [ ] **7. 다음 범위 결정** ← CURRENT: 코디 68bd94가 대응표를 읽고 정리
- [ ] **8. main 병합 / release / 운영 설치** ← PAUSED: 각각 GLG 별도 승인

현재 좌표: 6b 완료 → 7 대기 → 8 보류

# NOW

- Current: checkpoint `ac087af`(코드)와 docs-only 대응표가 브랜치에 있다. #142 본문과 [C/D/E/F 기록](https://github.com/junghan0611/entwurf/issues/142#issuecomment-6840052021)이 외부 자문용으로 정리돼 있다.
- 대응표 늦은 update 칸(fake probe n=1/cell, `.tmp-verify/acp142-late/`): P1(A 봉인 뒤·B 시작 전) 버려짐 — 측정만, QK 없음; P3(B effort 설정 중, B prompt 송신 전) `6059fe6`에서 닫힘 `[QK:ACP-REUSE-LATE-UPDATE-PRE-PROMPT]`; P2(B prompt 창 안) session/update에 turn id가 없어 상류 adapter 계약 의존·열림 — local counter로는 귀속 복원 불가, counter/ledger 추가하지 않음. 남은 열린 칸: 취소와 동시에 끝난 도구.
- 관측 O-L1(작업 아님): new 경로는 handler를 payload hook 앞(:1912)에 둔다 — newSession 직후 agent 선발 update는 new에서 보이고 reuse에서는 버려지는 비대칭; 현재 사용자 가시 영향 없음(b3 판독). 노출하지 않음(backlog 아님): background subagent, SDK 큐, 영속 resume/load.
- 미측정: 텍스트 스트리밍 중 ESC, Edit/Write 효과, 실제 키 입력, wire cancel 프레임, n>1, 재시작 뒤 정본.
- Blocker: 다음 범위·병합·release·설치는 GLG 결정(코디 경유). #160(OpenClaw/AGY ACP)은 이 후보와 별도 경계 설계; AGY native-push pause(#152) 유지.
- Read: #142, 대응표, receipts(oracle host-local) `.tmp-verify/acp142-live/{esc-20261113T075632,esc1-20261113T083800,esc1-20261113T084854,esc1-20261113T092603}/RECEIPT.md`, `~/.cache/entwurf-qual/acp106-partial-20261113-r5/summary.txt`, `~/.cache/entwurf-qual/acp106-full-20261113T090903/`.
- Do not touch: credential 값을 agent가 읽기·복사·로그하기, 새 로그인, env key 우회(auth A는 허용된 기존 동작); 운영 overlay/설정/hook; worktree; `--no-verify`; 전역 pnpm 정책 완화; whole BODY(코디 결정 0); 영속 resume·정본 복구 manager.
- 역할: ff08d4 = ACP 담당(team.json, GLG 지정), 유일한 구현 작성자. b3fc7c = 독립 검수. 68bd94 = 운영 코디·DM 단독. SOL a30dda = 뜻·사용 경험 의견만.

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

- [2026-11-13] `6059fe6`: reuse 턴은 자기 prompt 송신 직전에야 update를 받는다(effort 대기 중 들어온 이전 취소 턴의 늦은 update가 B 답으로 보이거나 봉인되던 창을 닫음). b3 검수 Blocker 0, D-L1(P1 'covered' 과장) 문구 하향. receipts: PARTIAL `~/.cache/entwurf-qual/acp142-late-partial-20261113T095519/`, FULL `~/.cache/entwurf-qual/acp142-late-full-20261113T095847/` (974s, log sha 0ac0a219576f). docs `e0898d6` CI 43339592216 4/4 success.

- [2026-11-13] `ac087af`: reuse effort 대기 중 ESC 30001ms → 즉시 정착(prompt 미전송, 세션 drop); 취소 결과 notice(KEPT/CLOSED); 재구성 transcript에 원인 중립 aborted 상태 줄. 첫 턴 ESC 실측 n=1: F 전 '실행 안 됨' 오판 → 최종 문구에서 '일부 실행됐을 수 있다'. 재사용 ESC private 계보: 단일 JSONL parentUuid 연속(n=1).

- [2026-11-13] FULL #3 GREEN → checkpoint `90b5168` push, CI 4/4 success. ESC LIVE n=1: abort 25ms 뒤 aborted, T3가 같은 acpSessionId를 reuse, count.log `start`만(30s 창, end 없음, 중복 없음).

- [2026-11-13] C1–C4: adapter 0.106.0 · wire SDK 2.6.0 · agent-sdk 0.3.322(`Usage` → `@agentclientprotocol/sdk/unstable`, 0.103 exports 축소 대응); `claude-fable-5-2` 큐레이션(5-1 유지); `settings.idleCompaction:false`; thinkingLevelMap low..max + effort set+readback(새 세션 set-model 직후, reuse는 변경 시만, signature 불포함), 레벨 없음/미지원 → `acp-thinking-level-unsupported`, notice `[acp: effort <v> read back]`.
- [2026-11-13] LIVE: opus high 새 세션(실 Read·MCP entwurf_self) → 같은 세션 low reuse(회상·실 Bash, input 6) → 같은 세션 medium(계획한 fable 전환은 model-lock이 되돌림); 별도 프로세스 fable-5-2 medium 새 세션.

# LEDGER

- PARTIAL 역사: 1차 `~/.cache/entwurf-qual/acp106-partial-20261113/` 86/86(launch-namespace r2 — 0.103 exports로 낡은 mutant replace 수선 후). notice 추가로 backend.ts가 바뀌어 최종 근거로 승격하지 않음. 그 전 시도는 receipt를 repo 안에 둬 인자 거절, mutant 미실행.
- 이전 봉인 `acp106-candidate-20261113T055508`, `…T065904` — superseded.
- 관측(작업 아님): pi cache-warmer는 `model.promptCache` 필요 → curated 행에 없어 ACP warming 턴 없음; `bypassPermissions`가 canUseTool을 가림; 한 프로세스 안 offered model 행 수가 세션마다 다름(5 → 14); pi 자체 compaction/export는 모든 `[acp: …]` notice를 요약 입력에 포함(기존 성질).
