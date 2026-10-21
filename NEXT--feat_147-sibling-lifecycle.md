# NEXT — feat/147-sibling-lifecycle

Branch lane for [#147](https://github.com/junghan0611/entwurf/issues/147): the coordinator-driven clock-out and same-id return rail for Pi and Claude Code. Base `5e1b9f8` (main, #76 landed). Delete this file before merging. Main's own `NEXT.md` still points at the #107 scope decision; that lead is stale and is handled outside this lane.

# RAIL — 현재 좌표

- [x] **1. 관측 1.** GLG의 손으로 닫고 같은 native id로 TUI resume했다. CC 형제가 같은 tuple로 attach했다(n=1). 기록은 [#147 6309403352](https://github.com/junghan0611/entwurf/issues/147#issuecomment-6309403352).
- [x] **2. 설계 초안 + 이슈 초점 갱신.** r1(Opus2 review B1, D1–D8 반영), #147 본문 r5. G1–G4는 아직 열린 결정이다.
- [ ] **3. 구현.** ← CURRENT: **L1 검증 완료, checkpoint commit 승인 대기** — pi-durable 코디 contact에 기존 `entwurf_resume_call` 노출(GLG grant 2026-10-21, 조율자 경유; Opus1 writer, Opus2 독립 review, Pi Sol a30dda 추가 review B0/D0). 다음 구체 leaf는 **L2 CC visible resume**(별도 grant), 그 뒤 L3 retire + #106 B. 대상 네 칸은 Pi·CC의 퇴근과 resume이고 tmux·Linux가 먼저다. CC만, bridge만으로는 완료가 아니다.
- [ ] **4. test-owned LIVE 한 번 + 착륙.** 별도 승인으로 한다.

현재 좌표: 1, 2 완료 → 3의 L1 진행(checkpoint → Opus2 review 대기) → L2 이후와 4는 각자 별도 grant.

# NOW

- Current: L1 candidate (uncommitted). `meta-bridge-pi-durable.ts`가 7번째 tool `entwurf_resume_call`을 bridge 정본 schema 그대로 노출하고 인자를 그대로 넘긴다. QK 두 개(`PI-DURABLE-RESUME-CALL-EXPOSED`, `-REACHES-BRIDGE`), pi-durable lane mutant 84 → 86, CHANGELOG·`docs/durable-native-support.md`·`docs/adding-a-harness.md` 최소 갱신. receipt는 `.tmp-verify/147-l1-receipts/`(ignored, host-local).
- 측정(r1): checkout focused 63/73(RED 10 = 이미 알려진 stale checkout dist 9 + 새 REACHES 1, 모두 #76 이전 dist의 fresh_call drift); 격리 fixture build 1회 후 beside 4 file 101/101.
- Opus2 review B0/D3/O4 → amendment r2 한 묶음: carrier gate 세 곳의 독립 목록을 7로(`check-pi-durable-contact` PDC-TOOLS는 정확 목록이라 숨은 RED였다), `docs/durable-native-support.md` 문장 정리, test 머리말 개수 수사 제거, CHANGELOG에 예약 tool 이름 구절, REACHES lock 단언을 absent-or-empty로. r2 candidate.diff e278e7a2…. lint·typecheck·manifests(1039/79) ok. PARTIAL `["bash","run.sh","check-pi-durable-beside"]` 1회: 41/41 KILLED(새 2개 포함), control pre/post green, seal stable, 502s. 운영 dist·source·node_modules·bridge process 전후 동일.
- G-send 1회(GLG GO; default cell, S loopback + H carrier native path, V 미실행): 20 passed 0 failed, OWNED-REAPED·OPERATOR-UNTOUCHED ok. raw wire 첫 요청 tools에 `entwurf_resume_call`이 있고 parameters가 bridge tools/list와 같다(독립 대조; default QK는 3개만 판정, 7개 `native-module` cell은 미실행). receipt `.tmp-verify/147-l1-receipts/gsend/`. 각 receipt(r2 PARTIAL, G-send)는 e278e7a2… candidate의 것이고 이후 doc-only 변경 후보에서 다시 돈 것이 아니다.
- 미측정: 지금 코디 host toolset(재시작 전 6), 운영 반영(G4), durable caller를 통한 성공 resume.
- Next: GLG의 L1 checkpoint commit 승인 대기(조율자 경유). 그 뒤 #147 checkpoint 댓글 1회(SHA 포함). L2는 별도 grant. G3 retire 안전 선택과 G4 운영 restart는 미결로 유지.
- 대기(L1과 독립, 이번 grant 밖): L0 측정(Pi `ctx.shutdown()`, CC 신호 — retire 설계에 필요하지만 이미 있는 Pi resume 노출에는 선행하지 않는다), L2 CC resume, L3 retire + #106 B. G1 범위 확대, G2 파괴적 권한, G3 CC TOCTOU 수용, G4 운영 반영·코디 재시작은 채택되지 않았다. 노출이 늘었다고 현재 코디 host의 실제 toolset이 늘었다고 주장하지 않는다(재시작 전엔 6개).
- 경계 세 가지:
  - G3의 사람 닫기와 CC retire 거절은 임시 workaround이거나 blocked이며 네 칸 완료가 아니다. GLG의 명시 선택이나 안전한 방법 없이는 CC 코디 retire 완료를 주장하지 않는다.
  - G2: actor 기록이 종료 권한을 보장하지는 않는다. 최소 권한 경계는 열린 선택이며, core role DB는 만들지 않는다.
  - G4: 지금 rollout에는 #76으로 바뀐 기존 `fresh_call` 노출 schema가 포함된다. 그래서 "bridge 먼저"만으로는 안전하지 않고, 사전 schema 비교와 GLG가 고른 일관된 재시작이 필요하다.
- L1 원래 계획(참고): `meta-bridge-pi-durable.ts:151-160`의 NAMES/SCHEMAS/DESCRIPTIONS에 `entwurf_resume_call`을 넣고, beside test, mutant, test-owned compiled callable proof를 갖춘다. 배포 순서는 bridge 먼저, host mirror 다음이다(`toolSchemaDrift` `:281-292`). 그다음 L2 CC resume에서 `mux-resume-call.ts:67`의 runtime 표를 만들고 `classifyMarkerOwner === "dead"`일 때만 진행한다. 이때 기존 MUST `run.sh:227` 셀이 뒤집힌다.
- L2 영향 목록에 추가: L1의 `[QK:PI-DURABLE-RESUME-CALL-REACHES-BRIDGE]`는 claude-code record의 `target-not-pi`를 oracle로 쓴다. L2가 resume domain을 넓히면 이 fixture를 여전히 이름으로 거절되는 대상(예: native-push backend)으로 옮기고, `run.sh:227` MUST 셀과 같은 변경에서 함께 개정한다. L1 단계에서는 바꾸지 않는다.
- L2 영향 목록 추가(Pi Sol r3 review O1): 실제 CC backend 거절 fixture `scripts/check-resume-launch-identity.ts:125-147`, 주입된 CC typed refusal·render·lock 사례 `pi-extensions/lib/entwurf-v2-visible-resume.test.ts:399-483`, `scripts/smoke-mux-lifecycle-live.ts:1040-1051`. CC를 domain에 넣을 때 아직 unsupported인 backend로 out-of-domain 커버리지를 유지하고 production domain과 같은 변경에서 고친다.
- Blocker: L1은 commit 승인. L2 이후는 각자 grant, retire는 GLG 결정 G3와 L0 측정 grant.
- Read:
  - #147 본문 상단과 thread
  - #106 본문과 [보류 결정](https://github.com/junghan0611/entwurf/issues/106#issuecomment-6061252802)
  - `ROADMAP.md:22-28`
  - `pi-extensions/lib/{resume-launch-identity,entwurf-v2-visible-resume,mux-resume-call}.ts`
  - `pi-extensions/meta-bridge-hook.ts:150-175`
  - `pi-extensions/lib/meta-session.ts:1594, 2013-2080`
- Do not touch:
  - production source, AGENTS, owner 문서는 결정 전에 고치지 않는다. 변경 필요 목록은 설계 §5에 있다.
  - 운영 세션과 기존 record/transcript로 실험하지 않는다.
  - identity record 확장과 generation cut을 하지 않는다.
  - 숨은 프롬프트, watcher, retry, 자동 fresh를 두지 않는다.
  - commit/push는 GLG 승인 없이 하지 않는다.

# GUARDRAILS

- 모든 pnpm·hook 실행 앞에 `pnpm_config_verify_deps_before_run=error`를 붙인다. deps가 맞지 않으면 install하지 않고 멈춘다.
- local FULL/BODY, Herdr build·sandbox, 운영 dist build, SSH A, 새 모델 호출은 하지 않는다.
- GLG의 명단 파일은 지금 `.agent-reports/.envrc`에 있다(ignored, 원래 루트에서 이동했고 이동 경위는 unknown). 이 파일을 다시 옮기거나 stage하거나 수정하지 않는다. 루트에 `.envrc`가 다시 생겨도 같다.
- 기억 축(semantic-memory 색인)은 이 lane과 별개다. 갱신하지 않는다.
- 자원: 자기 scratch만 정확한 경로로 회수한다. receipt·record·transcript는 보존한다.
