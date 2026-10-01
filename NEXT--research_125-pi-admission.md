# NEXT — #125 / Pi0.99.2 수용 / 목표 Entwurf0.30.0

# RAIL — 현재 좌표

- [x] **1. 방향·접점 분석** — 같은 커버리지의 뺄셈, Pi에 도구 표면 소유 반환.
- [x] **2. 구현·독립 review·amendment** — native5 삭제, builtin MCP에 compiled bridge 등록.
- [x] **3. 격리 소비자·CLI·기본 실제 ACP** — Pi0.99.1의 범위 한정 PASS.
- [x] **4. 브랜치 보존·oracle0.99.1 전환** — 2f7c883 push, qualification831/831 + frozen full.
- [ ] **5. Pi0.99.2 → 남은 기본기 → 관련 MCP 기능 →0.30.0** ← CURRENT: A2 review·소비자 CLI/namespace/reload 관측 완료. 동결된0.99.2 격리 후보 qualification→full, 통과 후 oracle cutover/LIVE→commit/push.

# NOW

- **실무 책임:** CC Opus `20261001T033500-9ead9b`, reviewer Fable `20261001T063853-5fe11e`(WAIT). coordinator Pi `20260930T122614-5e4b39`는 cutover 시 재시작이 필요할 수 있다. 단절 자체를 새 승인 대기로 만들지 않는다.
- **기준 [coordinator 측정]:** origin HEAD `2f7c883edf5e611910c0026719c4ad1839119b94`, 운영/checkout deps0.99.1, tracked dirty는 coordinator NEXT뿐. apply/install/cutover0.
- **최종 검토 후보:** `/tmp/e992/src` exact0.99.2, full patch `/tmp/e992/ev/a2/pi-0992-a2.patch` sha256 `870b9b4cd7b1de03703d5a5a3ee43dd69eebd7183b60f0846d5bc7fc94591df1`, A2 report sha256 `37152f519ec8073a2cd69441f92bb4c9d941f371f13d08fcb12a3f150c2b2f88` [coordinator hash/read 확인]. 원본/A1 patch·expected-red 보존.
- **다음 한 걸음:** 정상 git provenance와 최종0.99.2 후보 tree를 확인하고 이 NEXT를 포함한 의도된 변경을 freeze 전에 확정한다. 격리 후보 qualification→full을 한 번씩 실행; 실패하면 진단/필요 수선/영향 리뷰 후 새 후보로 재측정. 통과 뒤 source/lock/deps/dist/operator/caller 세대의 일관된 cutover→실제 visible fresh/callback/v2→정상 hook commit/push/agenda. floor 중 NEXT/index/source 변경 금지; 결과는 issue receipt로 운반. 이전831/full carry0, release/tag 미승인.
- **3셀 receipt:** `.agent-reports/125-pi-0992-cells-20261001.md` sha256 `d90ff93860cbce0507b2604422b1022f3d7d55937deb4e432244339799fa2495` [coordinator 전문/hash·원시 CLI/reload/중복키 JSON read, SHA256SUMS15/15 확인]. Opus 측정: 설치본6underscore/2hidden/bare0·record/sessionManager/env/socket/child/cwd·EOF cleanup; hyphen/underscore 단독 override marker; 양키는 conflict 알림 후 첫 entry 유지(파일 전체 거절 아님). ctx.reload 같은 native/garden/socket·옛child 소멸/new1·6/2 유지. model0, 운영 설정/후보 source 변경0. defaultTools 추가/수동 비활성 의미론 및 모델 tools/call은 미측정.
- **완료 근거:** Fable A2 finalreview `.agent-reports/125-pi-0992-fable-review-a2-20261001.md` sha256 `15375981ff552e64763768c377dedd77ccab7ff686b23e2c811837c932db08bc` [coordinator 전문/hash 확인]. D1/D2·herdr no-arg callback·기존 소비자 gate 격리 defect 닫힘. Opus receipt: check-pack-install poisoned inherited agentDir 아래 PASS, samehome two-root ownership 유지. helper의 M1 runner-coordinate와 wiring의 M2 heavy hand-kill은 구별, qualification body는 아직 UNRUN.
- **남긴 Observation:** mb row는 local sentinel로 operator agentDir이 차단되어 empty store를 읽는다; seeded-store 인증은 pc cell만 소유. mb 선언적 -u 제안은 현재 false 결과 없는 Observation으로 남기고 추가 source 보완 루프를 열지 않는다. 보고서 'No install'은 operator0/sandbox actual install로 정정. 권한/전체 순서는 `.agent-reports/125-pi-0992-continuation-20261001.md`.
- **전환 경계 [source-derived]:** Pi0.99.2는 `mcp__entwurf_bridge__*`; CC는 hyphen 유지, 서버키 `entwurf-bridge` 불변. CC 등 caller의 running compiled bridge도 Pi-target framing을 캐시한다. mixed window fresh Pi 금지; source/deps/dist/globalPi와 실제 호출할 caller 세대를 함께 맞춘다. 문서화된 native 재연결로 identity/transcript 보존, coordinator 비가시적 재실행 금지.
- **승인 [GLG 직접, 2026-10-01]:** “우리 리포 작업에 집중… 새 버전 설치되면 배선 끊길테니까 그때 다시 시작… 오푸스가 밀고가야지뭐 커밋푸시까지.” oracle Pi0.99.2 install/cutover 및 research/125-pi-admission commit/push까지. Entwurf0.30.0 version/CHANGELOG/tag/release/publish/main merge/타 host takeover는 미승인.
- **독립 연구:** agent-config Opus `20261001T064420-a2a671`은 GLG 요청으로 checkpoint를 llmlog `20261001T070752`와 [#88 comment5920592842](https://github.com/junghan0611/entwurf/issues/88#issuecomment-5920592842)에 보존했다고 회신했다[상속, coordinator 원문 미검증]. 현재 WAIT, #125와 합치거나 새 연구 요청하지 않는다.
- **금지:** record/transcript 삭제·fresh-cut, credential 복사/로그인 probe, OpenRouter fallback, alias/version-router/새 하네스. failed gate를 bypass하거나 기존 floor receipt를 새 tree로 이월하지 않는다.

# READ — 이동 가능한 근거

- [#125 thread](https://github.com/junghan0611/entwurf/issues/125): 댓글 우선. [0.99.1 commit5919438846](https://github.com/junghan0611/entwurf/issues/125#issuecomment-5919438846), [0.99.2 방향5920127682](https://github.com/junghan0611/entwurf/issues/125#issuecomment-5920127682), [최신 grant5920503395](https://github.com/junghan0611/entwurf/issues/125#issuecomment-5920503395), [3셀·floor 먼저5920888282](https://github.com/junghan0611/entwurf/issues/125#issuecomment-5920888282).
- `AGENTS.md`, `VERIFY.md`: review 끝→검증 변화 확정→qualification1회→frozen full1회→commit. source-only snapshot은 그룹별 `build:{argv,output}`로 자기 바이트를 빌드. NEXT/의도된 index 변경은 freeze 전에 끝낸다. pre-commit은 full 아님.
- `.agent-reports/125-pi-0992-fable-review-20261001.md` Amendment1: source prediction≠mutant 실행, check-pack-install loader7≠builtin CLI6/2, Pi-target caller bridge 세대까지 cutover. ignored 파일은 host-local 보조; 결정적 로그는 issue로 운반한다.

# RECENT — Pi0.99.1 역사적 checkpoint, 현재 후보로 이월 금지

- **제품 [2f7c883 source]:** birth/socket→env→builtin MCP 등록→UI; 당시 hyphen6direct/2hidden. inbound socket→pi.sendMessage·renderer/status/compaction 잔류, builtin child lifecycle. bridge sender reconcile 뒤 V3 targeted reader/backend pi 확인; 다른 실존 record 선택을 인증까지 한다고 주장하지 않는다.
- **보존 [Opus receipt,5919438846]:** tree `dea4b415d6c5722dbdc8792526d6b236c530960a`; qualification831/831·5100s, full634s, freeze 전후 동일, 정상 hook/push. 이전 coordinator red와 혼합하지 않는다.
- **소비자/CLI/실턴 [범위 한정]:** hejdev6 `/tmp/e125-174426`0.99.1 tarball/loader·CLI6/2/env join/EOF cleanup. 운영 Herdr/plugin/globalPi 교체0. sonnet5 ACP explicit bridge self/peers1회; host builtin child tools/call은 별개. realHOME 정상쓰기·제거 actor 미관측 경계는 thread에 보존.
- **실제 fresh [Opus receipt]:** Pi `20261001T035618-63a467` fresh→callback→v2 왕복 후 정리. new-session만, 다른 lifecycle 이월0.

# REMAINING

- Pi0.99.2 수용≠#125/0.30.0 해결 선언. ACP2턴 reuse/cancel/exclusion, close→dormant→resume/recall, trust/TUI/Herdr wiring, 다른 lifecycle/wasm은 별도 증거 필요.
- codemode는 기본 뒤. structuredContent/self·peers readonly 합성/discovery/hidden/error/permission은 설계 후보, 이번 Pi bump 자동 구현 아님. only projection/ACP guard·R9 hook 지원/exemption은 별도 지원 결정.
- release LIVE·exact-SHA CI·0.30.0 cut/publish는 별도 권한/근거. #124 P1/P2 도구 출하≠P3 composite acceptance(HOLD). CARRIED0.
- push 후 agenda1회, 장기 완료 시 Opus 자기 명의 DM1회. branch NEXT는 durable 결과 승격 후 merge 전에 삭제.
