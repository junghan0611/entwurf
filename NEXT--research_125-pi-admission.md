# NEXT — Pi 1.0 · ACP 기본기 → Entwurf 0.30.0

# RAIL — 현재 좌표

- [x] **1. Pi 0.99.2 기준선** — builtin MCP 수용·운영 전환·branch push·exact-SHA CI 완료.
- [x] **2. Pi 1.0 · ACP 기본기** — 후보 구현·focused 검증·retained foreground 취소/재사용·독립 검수 완료. 운영 설치 증거는 3에서 닫는다.
- [ ] **3. 브랜치 정리** ← CURRENT: 최종 NEXT 포함 후보 FREEZE → qualification/full → 안전한 세대 전환·post-F public LIVE → atomic commits·ordinary push·도장·exact-SHA CI.
- [ ] **4. main · 0.30.0 컷** ← PAUSED: 브랜치 정리 뒤 GLG의 merge/각 release-mode 승인.

현재 좌표: 1·2 완료 → 3 진행. Durable·MCP 고도화는 이 컷 밖이다.

# NOW

- **GLG 범위/권한 [현재 세션 직접 결정, 2026-10-02]:** 0.30.0은 Pi 1.0 수용과 ACP까지 포괄하는 기본기 릴리즈. "커밋푸시꺼지 쭉 가게 오푸스 가이드 해줘"로 `research/125-pi-admission` 구현·검증·commit/push 승인. main merge·branch NEXT 삭제·version/CHANGELOG prepare·tag/GitHub Release/npm publish는 아직 다음 경계다. agent-config 연구는 GLG가 직접 대화하며 이 레인은 조율하지 않는다.
- **역할:** 실무 Claude Code Opus `20261002T101619-6cbbbe`; 코디네이터 Pi `20261002T100622-43047f`. source/검증은 Opus, NEXT/독립 검수/범위 라우팅은 코디네이터. 새 형제 임의 호출 없음. 각 동일 승인 leaf마다 GLG 재승인을 요구하지 않는다.
- **현재 source 좌표 [coordinator git 측정]:** origin branch HEAD/remote `bc3d9b64fbd81bc03d68de8e6f95ef976a4f32f9`, tree `2b4e1b4357ae15950eb1aef5c5756eee68e58043`; dirty는 이 NEXT와 `scripts/smoke-acp-session-reuse-live.ts` 둘. origin deps/global Pi는 0.99.2, 패키지 label 0.25.1. Pi 1.0 후보는 `/home/junghan/tmp/e125-pi10-sb/src` sandbox에만 있다. 원본 반영/운영 전환/commit/push는 아직 실행되지 않았다.
- **다음 한 걸음 [coordinator 최종 검수·라우팅, 2026-10-02 12:07 KST]:** D1→A→B→C→E→F와 이 NEXT를 포함한 /home frozen clone을 만들고 tracked/untracked 후보 목록·index tree·content manifest·diff digest를 확정한다. qualification BODY 1회 → full 1회, 기본 TMPDIR=/tmp. FREEZE receipt 뒤 coordinator도 NEXT/source를 바꾸지 않는다. 실패는 원인 측정·수선·새 freeze가 필요하며 무효 receipt를 이월하지 않는다.
- **출하 HOLD:** background 고아 재현은 보존하며, leaf 적용 retained foreground 취소에서는 작업 종료≤100ms·동일 launcher/vendor·다음 턴 재사용·자기 고아0이 실측됐다. 독립 검수는 완료. 남은 acceptance는 frozen deterministic proof와 실제 설치 post-F lifecycle/MCP/reuse·source/env join이다. arbitrary shell daemon 차단은 이 switch의 보장이 아니다.

## 마지막 독립 검수

- [#125 이전 검수 5944829771](https://github.com/junghan0611/entwurf/issues/125#issuecomment-5944829771)을 갱신하는 최종 검수: F sha256 `a38b64c37e691c46112b861268da9944e802268277bd36e82723b9369ebf7cde`, E `ec6db6f08dae5c39284ea49b6de2ade3787616e53a50edc739e74516cafacc7a` coordinator 일치 측정/F 전문 읽음. 문구 범위 보완 수용. `check-acp-foreground-only` 2/2를 12:07 KST 직접 재실행 green, 후보 diff --check clean; prompt-lifecycle 직접 green은 직전 검수 기록.
- **F:** Claude adapter child env에 vendor `CLAUDE_CODE_DISABLE_BACKGROUND_TASKS=1`만 강제, Cortex에는 추가하지 않음. shared overlay/helper·process 전역·operator config 변경0. beside literal QK + rollback mutant1 + 기존 mutant coordinate; 새 manager/sweeper 없음. 현재 module Map/loader 경계상 새 signature 필드는 불필요하다고 검수했으며 미래 persisted lane까지 보장하지 않는다.
- **문구 수선 완료:** vendor-managed background 옵션과 판독된 timeout/turn-abort 경로의 비활성화로 좁혔다. arbitrary Bash daemonization은 명시적으로 제외했다. `backgroundedToDeliverMessage` 등록 차단 정적 설명은 Opus 판독에서 온 추론이며 UNKNOWN 유지; 출하 증명으로 승격하지 않는다.
- **retained run [Opus LIVE, coordinator JSON 읽음·hash 측정]:** `/home/junghan/tmp/e125-pi10-sb/live/rc-20261002T120155`. T1 정상 완료 → T2 실제 foreground 작업 확인/취소 → T3 same-session reuse. ambient0보다 child env1이 우선, abort99ms/작업 종료≤100ms, typed aborted, launcher2493096/264521258·vendor2493139/264521311 동일, preparing 없이 재사용. vendor 파일1개/delta-only, 종료 자기 생존자0·marker0/real6roots entry 집합 동일. t2 sha256 `f88612c49c404368fac8f5d867e088154d86fcff1569da5045bac11b358d9a37`, final `9a296585ede67c8fc28de6728a0eb203be9ba33e41e6ff3054ec4fb06a6ea7d3`. 이 run에 승인한 Sonnet3턴 소진.
- **첫 foreground 취소 [Opus LIVE + coordinator artifact 읽음]:** child env는 ambient0보다 leaf1이 우선. 실제 Python 작업을 확인한 뒤 abort100ms/작업 종료≤100ms/typed aborted, 자기 트리 잔존0. 다음 턴은 new bootstrap이었다: 첫 턴 abort는 `backend.ts:1861`상 retain하지 않는다. 재사용 턴 취소와 구분하며 E가 이 문구를 바로잡는다.
- **새 후보 증거 경계:** F가 pi-extensions를 바꿨으므로 이전 L4의 origin/candidate bytes 동등성 전제가 깨졌다. sandbox Pi PATH + old origin extension의 green을 새 F lifecycle로 가져오지 않는다. final source/실제 child env·runtime/bridge 출처를 join해야 한다.

# REMAINING — 브랜치 끝까지

1. frozen clone은 후보 bytes뿐 아니라 실행 명령·deps1.0.0·compiled dist 출처까지 기록한다. 신규 untracked beside test/manifest 누락0. qualification/full 동안 HEAD/index/worktree/NEXT 고정, 종료 manifests 동일. root free 시작≥1.5G, 30초 표본에서<600M이면 작업 중단·증거 보존. floor green 전 origin/operator 불변.
2. green 뒤 controlled cutover: origin 동일 patches/NEXT 적용 → tree join → frozen lock install → compiled dist digest → global Pi1.0 업데이트. 전환 창 setup/fresh 금지. 복구는 원래 tree/dirty D1/NEXT와 0.99.2 lock/runtime를 보존해 되돌리는 계획이지 dirty checkout 강제 삭제가 아니다. 코디네이터 가시 재시작이 필요하면 GLG 요청 후 대기, 숨겨 재시작0.
3. 실제 설치 post-F public LIVE: lifecycle(MUST), bundled-MCP(MUST), D1 reuse/delta 각1회. /proc runtime1.0.0·bridge path·gid·ACP vendor child env1 및 frozen/origin source join 필수. 명시 leaf 승인이지 전체 release-gate --cut 완료가 아니다. 실패 시 원인 수선과 필요한 새 frozen 증거, 통째 모델 턴 자동 replay0.
4. commit skill 준수: intended files만 atomic commits, hooks/unsafe override/force 우회0, batch ordinary branch push 성공 뒤 agenda1회. exact-SHA required4 CI jobs + qualification BODY가 필요. 실패는 새 commit/push·새 증거로 해결, main/tag로 우회0.

## 자원/범위 경계

- **디스크 [coordinator df 12:07 KST]:** `/` 2.7G free, `/home` 약11G. 큰 source/logs는 `/home/junghan/tmp`. `/home/junghan` TMPDIR는 Codex fixture의 ancestor config 판정을 바꿔9건 red를 낸다(기본 `/tmp`에서는301/301). 이 admission을 tmp-root 리팩터로 넓히지 않는다. 최종 floor는 기본 `/tmp`의 peak/reserve를 입증한 뒤에만; 불가하면 큰 floor BLOCK. 지원되는 명시 seam만 쓰고 path 속임수·기존 증거 삭제0.
- **버전 정책:** Pi dev pin1.0.0/peer `>=1.0.0 <1.1`, next-minor 유지. ACP/vendor·Herdr 동반 범프 없음. ROADMAP은 gate-read live 선언2줄만 정합, 방향/dated ledger 수정0. #124 P3/composite release-policy HOLD.
- **고도화 제외:** pi-durable, structuredContent/codemode, virtual model, autopilot, 새 orchestrator. MCP discovery·하네스 복구를 Entwurf가 떠맡지 않는다.
- **보존:** records/transcripts/기존 receipts/fresh-cut 삭제0, credential 복사·login probe0, OpenRouter sibling0. 판정은 current thread가 body보다 우선한다.

# RECENT / READ — 근거 진입점

- [checkpoint1/source+격리](https://github.com/junghan0611/entwurf/issues/125#issuecomment-5944056334) · [branch commit/push grant](https://github.com/junghan0611/entwurf/issues/125#issuecomment-5944114557) · [checkpoint2 검수](https://github.com/junghan0611/entwurf/issues/125#issuecomment-5944275740) · [background 고아 incident](https://github.com/junghan0611/entwurf/issues/125#issuecomment-5944455794).
- 이전 F 전 후보 L3 reuse PASS, L4 public native/ACP/CC lifecycle81/RC0, L5 chain24/v2send15/bundledMCP14 모두RC0는 Opus 실행/coordinator log·hash 읽음. 새 F 계약 증거로 자동 이월하지 않는다. logs는 `/home/junghan/tmp/e125-pi10-sb/live/l{3,4,5}-*`, patches는 같은 sandbox root의 D1→A→B→C→E→F 적용 순서다(겹치는 docs/package/run hunks 포함).
- Pi0.99.2 원래 기준선: [commit/cutover](https://github.com/junghan0611/entwurf/issues/125#issuecomment-5922109555), [qualification835/full](https://github.com/junghan0611/entwurf/issues/125#issuecomment-5922043242), [실제 ACP2턴](https://github.com/junghan0611/entwurf/issues/125#issuecomment-5923407014). CI run36795542287의 required4/body success는 coordinator 재측정, 새 후보 proof 아님.
- 계약 정본: `AGENTS.md`, `VERIFY.md`, `docs/acp-backend-rail.md`, `.claude/skills/entwurf-release/SKILL.md`, 공통 commit/next-handoff skill. main/prepare/make/publish는 이 branch 완료 후 별도 GLG 결정.
