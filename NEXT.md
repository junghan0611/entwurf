# NEXT — OPEN 3 manual sweeper → live defect train

> NEXT는 disposable boot sector다. 완료 이력은 CHANGELOG/closed issues/git이 지고,
> 방향은 ROADMAP, 운영 규율은 AGENTS가 진다.

# RAIL — 현재 좌표

- [x] **1. 0.14.0 release/publish + close audit** — tag `v0.14.0`=`95d1c72`; npm `latest=0.14.0`
- [x] **2. 완료 이슈 종결** — #69/#70 close, #57 supersession ledger 후 close; OPEN 18→15
- [x] **3. durable carrier 정비** — `830226b` push; ROADMAP/AGENTS/NEXT/mux rail 현재화
- [x] **4. manual issue sweep** — #72 생성 + 오래된 12건 redirect/close; OPEN 15→4
- [ ] **5. live defect train** ← CURRENT on main: #60; **#73 detour** on `feat/73-cross-repo-fresh-cwd`

현재 좌표: OPEN 3 · main stem #60 · #73은 브랜치 레인 (NEXT--feat_73-cross-repo-fresh-cwd.md)

# NOW — #60 native-push reply handle (main stem)

- **Stem:** OPEN은 backlog가 아니라 최대 5개의 현재 실행 계약이다. 알고만 있을 방향은 문서로 옮기고 닫는다.
- **Open 3:** #60 native-push reply handle · #72 ACP Claude retained-child/tool-loop `ACP connection closed` ·
  #73 cross-repo fresh target cwd (**active branch lane** — not parallel hand-wave).
- **Next (main):** #60에서 native-push 수신 본문에 sender envelope와 `wants_reply:true`를 보존하는 최소 production 경로와
  독립 oracle을 정한다. 자동 답장·polling·watcher를 만들지 않는다.
- **#73 branch lane:** `feat/73-cross-repo-fresh-cwd` + `NEXT--feat_73-cross-repo-fresh-cwd.md`.
  한 패키지 = fresh optional absolute cwd + resume을 continuity-only로 되돌리는 선택 매트릭스.
  resume verb 재설계 아님. Fable이 이 레인 boot sector로 민다.
- **#72 parallel measurement:** 실전 retained multi-tool failure의 host/version/task shape/phase/exit/signal/stderr를
  회수한다. synthetic 733s PASS를 실제 workload coverage로 올려 읽지 않고, automatic replay를 만들지 않는다.
- **Blocker:** 없음.
- **Read (main):** issues #60/#72 · `scripts/meta-bridge-state.py`.
- **Read (#73 lane):** `NEXT--feat_73-cross-repo-fresh-cwd.md` first.
- **Do not touch:** 태그/CHANGELOG 재작성, 자동 replay, agy 자동답장 보장, zmx/driver 추상화,
  collection point/umbrella/fallout bucket, 증거 없는 다섯 번째 이슈,
  #73 레인에서 resume·fresh verb 합병 또는 project-name resolver.

# RECENT

- **2026-08-13:** #73을 한 작업 패키지(cross-repo fresh cwd + resume lifecycle choice)로 묶고
  브랜치 `feat/73-cross-repo-fresh-cwd` + branch NEXT를 열었다. main stem은 #60 유지.
- **2026-08-10:** #73을 열고 field incident를 붙였다. `agent-config` caller가 independent andenken review에 dormant record를 cwd용으로 resume했고, 90% context transcript가 드러나 GLG가 target cwd의 fresh Opus sibling으로 교대시켰다. resume은 정상, 선택은 오류였고 A→B fresh placement gap이 압력이다.
- **2026-08-10:** #71·#68은 GitHub에서 CLOSED 상태를 확인했다. 이제 #60/#72/#73만 OPEN이다.
- **2026-08-10:** manual sweeper 규약을 `830226b`로 main에 올리고 full floor 207s green을 확인했다.
- **2026-08-10:** #72를 field report로 열었다. `20260730T194358-0061d2`의 4회 reuse 뒤 tool-loop
  `ACP connection closed`와 GLG의 반복 관측을 synthetic long-turn PASS의 consumer gap으로 묶었다.
- **2026-08-10:** #30/#33/#34/#36/#38/#39/#47/#11/#35/#37/#44/#55의 살아 있는 좌표를 ROADMAP/closed
  history로 redirect하고 닫았다. 최종 OPEN은 #60/#68/#71/#72 네 개다.
