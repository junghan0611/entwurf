# NEXT — feat/147-sibling-lifecycle

Branch lane for [#147](https://github.com/junghan0611/entwurf/issues/147): the coordinator-driven clock-out and same-id return rail for Pi and Claude Code. Base `5e1b9f8` (main, #76 landed). Delete this file before merging. Main's own `NEXT.md` still points at the #107 scope decision; that lead is stale and is handled outside this lane.

# RAIL — 현재 좌표

- [x] **1. 관측 1.** GLG의 손으로 닫고 같은 native id로 TUI resume했다. CC 형제가 같은 tuple로 attach했다(n=1). 기록은 [#147 6309403352](https://github.com/junghan0611/entwurf/issues/147#issuecomment-6309403352).
- [x] **2. 설계 초안 + 이슈 초점 갱신.** r1(Opus2 review B1, D1–D8 반영), #147 본문 r5. G1–G4는 아직 열린 결정이다.
- [ ] **3. 구현.** ← CURRENT: L1 커밋 `11869b8`. **L2(CC same-id visible resume + B1 arm binding) 코드·scoped review·영향 PARTIAL 마감. GLG가 체크포인트 커밋과 L3/G3 구현·격리 검증의 연속 진행을 승인했다(2026-10-21).** 대상 네 칸은 현재 갱신된 live Pi·CC의 퇴근과 resume이고 tmux·Linux가 먼저다. CC만, bridge만으로는 완료가 아니다.
- [ ] **4. test-owned LIVE 한 번 + 착륙.** 별도 승인으로 한다.

현재 좌표: 1, 2 완료 → 3의 L1 커밋·L2 코드/영향 검증 마감 및 체크포인트 커밋 → L3/G3 구현·test-owned 격리 검증 진행 → 4의 실제 작업 형제 종료는 별도 grant.

# NOW

- L1: commit `11869b8`(parent 5e1b9f8). receipt `.tmp-verify/147-l1-receipts/`.
- L2 code/proof checkpoint(uncommitted): 최종 검증 snapshot full `d7e5e081898ee03e5111229ef61e33e03d87ff270d2c5ed992a093e1c65732e9`, NEXT 제외 `470eed65aef17470e2fc50f8772905bee6e49fbef8ccc4f5d396052902bf95e7`. 이 NEXT 마감 갱신은 검증 뒤의 문서 변경이다. receipt/index `.tmp-verify/147-l2/r2/coor-partial-completion.md`, 상세 `.tmp-verify/147-l2/r2/coor-final-byte-check.md`(ignored, host-local).
  - resume domain은 `pi | claude-code`. CC 휴면 = hook이 마지막으로 검증해 arm한 owner가 dead **이고** 그 판정 뒤 다시 읽은 record의 `attachIncarnation`이 marker 사본과 같음(non-null). 아니면 `target-receiver-absent/-corrupt/-mismatch/-unbound`, `target-live`, `target-indeterminate`. launch는 다시 읽은 record로, 관측은 연 pane의 새 live owner + 새 binding + record 일치.
  - B1 arm binding: V3에 key 하나(`attachIncarnation`, 부재=null, 항상 emit). CC hook이 arm-capable 사건마다 mint → 같은 원자 upsert → marker 사본. 기존 record 쓰기는 모두 record-arm lock(`meta-record-arm-locks`, v2 lock dir 아님) 아래, gid는 read-only lookup, 없는 record는 create-only(`expectAction`). arm busy → 2s 대기 뒤 아무것도 안 씀(ERROR), UPS busy → skip.
  - floor `>=2.1.306`(GLG 결정, 선언, LIVE receipt 없음).
  - **GLG 수용(2026-10-21, 현재 갱신된 live Pi/CC cohort 범위):** committed hook attach만 보장한다. hook 꺼짐·lock timeout·store 실패로 attach 없이 세션을 쥔 프로세스는 증명 밖이다. 옛 잠든 CC(binding null)는 `-unbound`로 남고, 사람이 같은 id로 한 번 열어 새 hook이 arm해야 대상이 된다(이번 완료 조건 아님).
- **운영 사건(2026-10-21 oracle):** dev checkout으로 뜬 Pi가 새 key로 record를 썼다. 거절이 **관측된** 것은 CC hook(`upsert failed`), pdc(옛 compiled dist), coor의 옛 bridge뿐이다. Codex birth/helper, Copilot extension·assembled, OMP bridge·receive, 외부 `entwurf-peek` mirror는 옛 codec(grep)과 whole-store certify(source) 근거로 **거절이 예상**될 뿐 실행 관측은 없다 — Pi/CC 완료 뒤 별도 순서. GLG 18:55 직접 지시로 checkout dist build-bridge 1회 + `install-meta-bridge` 1회만 roll-forward했다. **수동 identity repair(record rewrite·삭제·fresh-cut·옛 shape rollback)는 0**이고, 정상 hook/Pi attach에 의한 record 갱신은 계속된다. **checkout source 변경 자체가 다음 Pi 시작에 운영 배포가 된다.** G4 전체 coherent cut은 끝나지 않았다.
- 미측정: CC dormant→resume LIVE 여정, `CwdChanged` 뒤 record cwd에서 `claude --resume`이 세션을 찾는지(2.1.306), resume 뒤 안 읽은 mail이 턴을 깨우는지, 코디 host의 실제 toolset.
- 영향 PARTIAL 마감(coor 2026-10-21 직접 11개 receipt 파싱): 167 KILLED, 모든 control green/seal stable. **한 후보의 167이 아니다:** 40@56d7a112, 25+20@711a78c1, 13+10+5@a4b5c5f3, 4@3fbce44c, 4+4+1+41@d7e5e081. 후보 간 수선은 test-only였고 이미 green인 group 입력은 불변이었다. 실패 진단도 보존했다. FULL/실제 native/최종 release SHA kill-power 증거가 아니다.
- Next: L2를 정상 hooks로 로컬 체크포인트 커밋한 뒤 `.tmp-verify/147-l2/astra-g3-pidfd-feasibility-20261021T1957.md`에 근거해 **운영과 분리된 test-owned child의 pidfd leaf 구현·검증**을 이어간다(2026-10-21 GLG 진행 승인). Python stdlib 함수 존재만 측정됐으며 syscall·SIGTERM·CC graceful/flush/children은 미검증이다. process incarnation 종료와 동일 PID의 session switch 잔여 경합/종료 권한은 따로 결정한다. L2 체크포인트 커밋은 승인됐고, push는 릴리즈 mode 확인 전에는 하지 않는다.
- 승인 범위: Pi/CC 우선 구현·격리 검증·체크포인트 커밋을 npm publish 전까지 계속한다. 대기: 실제 작업 형제를 종료하는 L0/caller LIVE, G4의 타하네스 전환, git push·태그·GitHub Release의 릴리즈 mode. npm publish는 명시적으로 하지 않는다.
- Read:
  - #147 본문 상단과 thread
  - `.tmp-verify/147-l2/proposal-b1-binding.md`, `r2/opus2-l2-r2-review.md`, `astra-advisory-20261021T1919.md`
  - `pi-extensions/lib/{resume-launch-identity,entwurf-v2-visible-resume,mux-resume-call,meta-session}.ts`, `pi-extensions/meta-bridge-hook.ts`
- Do not touch:
  - L3의 승인된 최소 부품 구현·격리 검증은 진행하되, process-incarnation 권한·session-switch 경합·vendor graceful 미검증을 해결됐다고 쓰지 않는다. 실제 작업 형제를 시험 대상으로 종료하지 않는다.
  - 운영 세션과 기존 record/transcript로 실험하지 않는다. record rewrite·삭제·fresh-cut·옛 shape rollback 금지(roll-forward만).
  - `attachIncarnation` 이름과 타입을 바꾸지 않는다(운영 데이터에 이미 있다).
  - 숨은 프롬프트, watcher, retry, 자동 fresh를 두지 않는다.
  - GLG는 체크포인트 커밋을 승인했다. push·태그·GitHub Release는 릴리즈 mode를 확인하고, npm publish는 하지 않는다.

# GUARDRAILS

- 모든 pnpm·hook 실행 앞에 `pnpm_config_verify_deps_before_run=error`를 붙인다. deps가 맞지 않으면 install하지 않고 멈춘다.
- local FULL/BODY, Herdr build·sandbox, 운영 dist build, SSH A, 새 모델 호출은 하지 않는다.
- GLG의 명단 파일은 지금 `.agent-reports/.envrc`에 있다(ignored, 원래 루트에서 이동했고 이동 경위는 unknown). 이 파일을 다시 옮기거나 stage하거나 수정하지 않는다. 루트에 `.envrc`가 다시 생겨도 같다.
- 기억 축(semantic-memory 색인)은 이 lane과 별개다. 갱신하지 않는다.
- 자원: 자기 scratch만 정확한 경로로 회수한다. receipt·record·transcript는 보존한다.
