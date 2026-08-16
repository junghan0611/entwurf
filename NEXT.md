# NEXT — OPEN 4 live defect train

> NEXT는 disposable boot sector다. 완료 이력은 CHANGELOG/closed issues/git이 지고,
> 방향은 ROADMAP, 운영 규율은 AGENTS가 진다.

# RAIL — 현재 좌표

- [x] **1. 0.14.0 release/publish + close audit** — tag `v0.14.0`=`95d1c72`; npm `latest=0.14.0`
- [x] **2. 완료 이슈 종결** — #69/#70 close, #57 supersession ledger 후 close; OPEN 18→15
- [x] **3. durable carrier 정비** — `830226b` push; ROADMAP/AGENTS/NEXT/mux rail 현재화
- [x] **4. manual issue sweep** — #72 생성 + 오래된 12건 redirect/close
- [x] **5. #73 cross-repo fresh cwd** — main `ff46502` / feat `0059fe2`; LIVE scratch OK; issue CLOSED
- [x] **6. 0.14.1 prepare** — `6a1df33`; release-gate MUST 20/0 (`j2eAVu`); Sol SHIP-AFTER-FIX
- [x] **7. make 0.14.1** — tag `v0.14.1`=`6a1df33`; CI run 31677847479 all success; preserved candidate accepted; GH release live
- [x] **8. publish 0.14.1** — npm latest=0.14.1 (2026-08-13)
- [x] **9. #79 dep certify** — main `ccb1864`: acp 0.68.0 + pi 0.84.2; Sol APPROVE; issue CLOSED
- [ ] **10. live defect train** ← STEM: #60; #72 · #76

현재 좌표: **#79 landed · defect train** · OPEN 5 (was 6; #79 closed)

# NOW — #60 native-push reply handle

- **Stem:** OPEN은 backlog가 아니라 최대 5개의 현재 실행 계약이다. 알고만 있을 방향은 문서로 옮기고 닫는다.
- **Open 5:** #60 native-push reply handle · #72 ACP Claude retained-child/tool-loop · #75 workshop field report (non-impl) ·
  **#76** fresh_call subscription-first / refuse `openrouter/*` sibling models · **#78** 0.15 portability candidate (non-impl).
- **Next:** #60에서 native-push 수신 본문에 sender envelope와 `wants_reply:true`를 보존하는 최소 production 경로와
  독립 oracle을 정한다. 자동 답장·polling·watcher를 만들지 않는다.
- **#76 next slice (separate from #60):** product fail-closed on `openrouter/*` at `entwurf_fresh_call`; subscription canonical ids (`openai-codex/gpt-5.6-sol`, …). Do not mix Done-when with closed #73.
- **#72 parallel measurement:** 실전 retained multi-tool failure host/version/task shape/phase/exit/signal/stderr.
  synthetic 733s PASS를 workload coverage로 올려 읽지 않는다.
- **Blocker:** 없음.
- **Read:** issues #60/#72/#76 · native-push leaf · `mux-fresh-call` model reject site for #76.
- **Do not touch:** 태그/CHANGELOG 재작성, 자동 replay, agy 자동답장 보장, zmx/driver 추상화,
  collection point/umbrella, project-name resolver, reopening closed #73.

# RECENT

- **2026-08-16:** #79 CLOSED on main `ccb1864`. claude-agent-acp 0.68.0 + pi 0.84.2 certified;
  check/full/pack/container + LIVE raw/provider/overlay/reuse green; Sol BLOCK→fix→APPROVE; host pi 0.84.2.
- **2026-08-13:** 0.14.1 documentation prepare second pass in progress; install/upgrade/first-check, external MCP cwd,
  mux-rail landed tense, skill syntax까지 대조. no version bump.
- **2026-08-13:** #73 CLOSED on main `ff46502`. optional abs cwd on fresh-call; shared classify-tmux-cwd;
  Sol+Fable+Opus path; LIVE pane path matched scratch. Branch NEXT deleted. #76 opened (OpenRouter refuse).
- **2026-08-10:** #73 field incident (resume-as-cwd-proxy). #71/#68 closed. manual sweeper on main.
