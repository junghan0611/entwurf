# NEXT — OPEN 4 manual sweeper → live defect train

> NEXT는 disposable boot sector다. 완료 이력은 CHANGELOG/closed issues/git이 지고,
> 방향은 ROADMAP, 운영 규율은 AGENTS가 진다.

# RAIL — 현재 좌표

- [x] **1. 0.14.0 release/publish + close audit** — tag `v0.14.0`=`95d1c72`; npm `latest=0.14.0`
- [x] **2. 완료 이슈 종결** — #69/#70 close, #57 supersession ledger 후 close; OPEN 18→15
- [x] **3. durable carrier 정비** — `830226b` push; ROADMAP/AGENTS/NEXT/mux rail 현재화
- [x] **4. manual issue sweep** — #72 생성 + 오래된 12건 redirect/close; OPEN 15→4
- [ ] **5. live defect train** ← CURRENT: #71 → #68 → #60, one contract at a time; #72 증거 회수 병행

현재 좌표: OPEN 4 / backlog bucket 0 / 여유 slot 1 → #71 안전축부터 시작

# NOW — #71 operator-owned warning

- **Stem:** OPEN은 backlog가 아니라 최대 5개의 현재 실행 계약이다. 알고만 있을 방향은 문서로 옮기고 닫는다.
- **Open 4:** #71 safety ownership · #68 no-transcript refusal · #60 native-push reply handle ·
  #72 ACP Claude retained-child/tool-loop `ACP connection closed`.
- **Next:** #71에서 `skipDangerousModePermissionPrompt` 소유권을 놓되, 앞으로 한 줄을 안 쓰는 것과 이미 우리가
  심은 `true`를 provenance가 증명할 때 원상복구하는 것을 분리해 설계한다. 먼저 install-state의 기존 inverse와
  upgrade 경로를 읽고 가장 작은 safe relinquishment를 정한다.
- **#72 parallel measurement:** 실전 retained multi-tool failure의 host/version/task shape/phase/exit/signal/stderr를
  회수한다. synthetic 733s PASS를 실제 workload coverage로 올려 읽지 않고, automatic replay를 만들지 않는다.
- **Blocker:** 없음.
- **Read:** issues #71/#68/#60/#72 · `scripts/meta-bridge-state.py` · `scripts/smoke-meta-install-state.sh`.
- **Do not touch:** 태그/CHANGELOG 재작성, 자동 replay, agy 자동답장 보장, zmx/driver 추상화,
  collection point/umbrella/fallout bucket, 증거 없는 다섯 번째 이슈.

# RECENT

- **2026-08-10:** manual sweeper 규약을 `830226b`로 main에 올리고 full floor 207s green을 확인했다.
- **2026-08-10:** #72를 field report로 열었다. `20260730T194358-0061d2`의 4회 reuse 뒤 tool-loop
  `ACP connection closed`와 GLG의 반복 관측을 synthetic long-turn PASS의 consumer gap으로 묶었다.
- **2026-08-10:** #30/#33/#34/#36/#38/#39/#47/#11/#35/#37/#44/#55의 살아 있는 좌표를 ROADMAP/closed
  history로 redirect하고 닫았다. 최종 OPEN은 #60/#68/#71/#72 네 개다.
