# NEXT — 0.14.0 published → OPEN issue manual sweep

> NEXT는 disposable boot sector다. 완료 이력은 CHANGELOG/closed issues/git이 지고,
> 방향은 ROADMAP, 운영 규율은 AGENTS가 진다.

# RAIL — 현재 좌표

- [x] **1. 0.14.0 release/publish + close audit** — tag `v0.14.0`=`95d1c72`; npm `latest=0.14.0`
- [x] **2. 완료 이슈 종결** — #69/#70 close, #57 supersession ledger 후 close; OPEN 18→15
- [ ] **3. durable carrier 정비** ← CURRENT: ROADMAP/AGENTS/NEXT를 현재화하고 검증·커밋
- [ ] **4. issue sweep + ACP 증거 회수** — failure 이슈 생성, signature 측정 시작, 오래된 12건 close → OPEN 4
- [ ] **5. live bug train** — #71 → #68 → #60, one contract at a time; ACP 측정은 원인 단정 없이 병행

현재 좌표: 2 완료 → 3 문서 후보 작성 중 → 4는 durable carrier가 origin/main에 오른 뒤 실행

# NOW — durable carrier 정비

- **Stem:** OPEN은 backlog가 아니라 최대 5개의 현재 실행 계약이다. 알고만 있을 방향은 문서로 옮기고 닫는다.
- **Current facts:** HEAD/origin=`5ad6ea7`; tag=`95d1c72`; 둘의 유일한 델타는 이슈 감사용 옛 `NEXT.md`였다.
  GitHub OPEN은 현재 15건이다.
- **Candidate final OPEN 4:** #71 safety ownership · #68 no-transcript refusal · #60 native-push reply handle ·
  신규 ACP Claude retained-child/tool-loop `ACP connection closed`.
- **Next:** (1) ROADMAP의 0.14.0/7 verbs/shipped mux 및 deferred coordinates 정정 →
  (2) AGENTS에 manual sweeper 규율 고정 → (3) focused prose/source sweep → (4) docs commit.
- **After push authorization:** 새 ACP failure 이슈를 만든 뒤 #30/#33/#34/#36/#38/#39/#47/#11/#35/#37/#44/#55를
  durable 좌표로 redirect하고 한 호흡에 닫아 OPEN 4로 만든다.
- **Blocker:** push는 GLG의 명시적 현재-session 권한이 필요하다. redirect 전에 durable carrier가 origin/main에 있어야 한다.
- **Read:** `AGENTS.md` “Issue queue” · `ROADMAP.md` “현재”/“Deferred questions” · issues #60/#68/#71.
- **Do not touch:** 태그/CHANGELOG 재작성, automatic replay, ACP error 원인 단정, agy 자동답장 계약,
  zmx/driver 추상화, 증거 없는 여섯 번째 이슈.

# RECENT

- **2026-08-10:** #69/#70은 기존 close-ready 원장을 중복 게시하지 않고 닫았다. #57은 acceptance 한 항목이
  #70 tiering으로 supersede됐음을 명시한 closing ledger를 게시하고 닫았다.
- **2026-08-10:** fresh Claude Code Opus `20260810T083051-57277c`가 open 18건을 current HEAD와 재대조했다.
  최종 정책은 방향 bucket을 폐기하고 실제 결손 4개만 OPEN으로 두는 수동 sweeper다.
- **ACP evidence:** `20260730T194358-0061d2`가 4회 reuse 뒤 tool use 중 `ACP connection closed`로 error seal됐고
  다음 turn에서 새 child가 열렸다. synthetic 733s long-turn PASS와 실제 hard workload failure의 간극을 먼저 측정한다.
