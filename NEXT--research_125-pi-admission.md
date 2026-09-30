# NEXT — #125 / Pi 0.99.1 수용 → 목표 0.30.0

# RAIL — 현재 좌표

- [x] **1. 방향·접점 분석** — compatibility-only가 아닌 같은 커버리지의 뺄셈.
- [x] **2. 구현·독립 review·단일 amendment** — native 5 verb 삭제, builtin MCP에 compiled bridge 등록.
- [x] **3. 격리 소비자·CLI·기본 실제 ACP** — 각각 범위를 제한한 PASS, 전체 수용 아님.
- [x] **4. 브랜치 보존** — qualification snapshot의 compiled bridge 입력을 그룹별 `build` 선언으로 수선, review→qualification→frozen full 뒤 commit/push. 수치·receipt는 #125 commit 댓글.
- [ ] **5. 기본 기능 나머지·운영 전환·0.30.0** ← CURRENT: oracle 운영 Pi는 0.99.1로 올라갔고 새 연결고리가 한 번 실측됐다. 나머지 기본 LIVE, 다른 host 전환, 릴리즈는 각각 별도 승인.

# NOW

- **운영 상태 [측정, 2026-10-01 oracle]:** 전역 Pi `pi update --self` 0.87.1→0.99.1(npm latest=0.99.1), 이 checkout의 node_modules도 lock대로 0.99.1(`pnpm install --frozen-lockfile`, prepare가 dist 재빌드). 새 pi 형제(openai-codex/gpt-6.1-sol, garden 20261001T035618-63a467)가 host builtin MCP의 `mcp__entwurf-bridge__` 6개로 self/peers/callback/v2를 실제 호출, bare·hidden 도구 0, 시작 오류 관측 0. 이것은 한 세션의 new-session 경로만이다 — resume/reload/switch/fork는 미측정.
- **다른 host:** thinkpad 등 다른 기기의 운영 Pi는 아직 0.87.1일 수 있다. 이 checkout을 package로 읽는 0.87 host는 `pi.registerMcpServer is not a function`으로 깨진다. 전환은 host마다 `pi update --self` + checkout `pnpm install --frozen-lockfile`. 0.87 shim/alias는 만들지 않는다.
- **qualification 입력 계약 [source]:** snapshot은 source-only. ignored build output을 소비하는 gate는 mutant마다 `build: {argv, output}` 선언(그룹당 하나). 러너가 그 그룹 안에서만 snapshot 자기 바이트로 빌드·mutation마다 재빌드·복원 후 baseline digest 재현을 요구하고, 그룹 종료 시 제거한다. 선언 그룹: check-pi-mcp-register, check-pi-mcp-bridge, check-tests-beside-behavior, check-meta-doctor-oracle. 계약 소유 `[QK:QUALIFY-BUILD-*]`(`scripts/check-gate-qualification.ts` Phase 1c-b), 문서 `VERIFY.md` Discriminating power 하위 항목.
- **다음 한 걸음:** 남은 기본 LIVE 중 하나를 고른다 — 실제 ACP 2턴 reuse/cancel, visible fresh→callback→v2 왕복→resume/recall, Herdr wiring. 운영 Pi가 이제 0.99.1이므로 격리 candidate(`/tmp/entwurf-b-20260930T160911`) 없이 origin에서 게이트를 돌릴 수 있다.
- **금지:** 기록·transcript 삭제, cleanup/fresh-cut, global Herdr takeover, credential 복사·로그인 probe, OpenRouter fallback, 버전/CHANGELOG/tag 변경. branch NEXT는 durable 결과 승격 후 merge 전에 삭제.

# READ — 이동 가능한 근거부터

- [#125 thread](https://github.com/junghan0611/entwurf/issues/125): 댓글이 역사적 본문보다 우선. 목표 기록5904181478, 구현 인계5906641374, 소비자/CLI5908018106, 기본-first5908485834, 실제 ACP5908652455. 이후 commit/push 댓글이 다음 복귀점.
- `AGENTS.md`, `VERIFY.md`: qualification body와 full floor는 별개. pre-commit은 fast static뿐. 릴리즈 exact-SHA CI/LIVE acceptance는 아직 완료하지 않았다.
- 로컬 `.agent-reports/`는 gitignored 보조 자료이며 다른 호스트에 전달 가능한 근거가 아니다. 결정적 로그/근거 경계는 issue 댓글로 운반한다.

# RECENT — 범위를 붙인 관측

- **제품 [source]:** record birth/socket → env → builtin MCP 등록 → UI. 서버 이름 `entwurf-bridge`, 모델 도구 이름 `mcp__entwurf-bridge__*`. caller 6개 direct, inbox_read/register_native hidden. inbound socket→pi.sendMessage, renderer/status/compaction은 adapter에 남는다. builtin이 child lifecycle을 소유한다. native 도구와 alias/dual route는 없다.
- **주소 [source]:** bridge pi claim은 reconcile 뒤 V3 targeted reader/backend pi로 검증한다. 기존 native sender는 residentGardenId를 사용했다. record 존재 검증은 trusted host가 다른 실존 record를 선택하는 행위를 인증하지 않으며, 이 한계를 보안 동등성으로 포장하지 않는다.
- **SDK [실무자 측정, checksum 검토]:** 실제 builtin stdio pipeline peers→self, bare 이름 실패, trusted 동명 mcp.json override marker. runtime.newSession은 부모 생존/P1 소멸/G1 보존/G2·P2·env·record·self join. reason new만 증명; 다른 lifecycle 이월 없음.
- **qualification [coordinator 실측]:** 74m02s, exit1, 766/826 kill·control-pre red 8그룹. full은 그 실패로 시작되지 않았다. 후보 index tree `dc4a251beb685a756e3e198eaaa54a33afafa5f1`; 해당 실패를 green/이월 근거로 쓰지 않는다. 짧은 owned TMPDIR + 테스트 env `NOSYSBASHRC=1` + Nix 도구 경로로 후보 자체의 8 control을 재실행해 모두 PASS(2m19s). 이는 별도 snapshot의 dist 누락을 해결하거나 60개 mutant를 재측정한 증거가 아니다. host bashrc/운영 Pi 변경0. 로그는 candidate evidence와 #125 댓글에 경계를 붙여 남긴다.
- **focused [실무자 receipt]:** review Blocker 0, D1/D2/D3 단일 amendment와 affected gates PASS. one-off mutant kill은 qualification body가 아니다. corrected amendment sha256 `13393324caa9aa376a79e4cdb4ea0a722be256d11d745b7d5a13ec5f1c911294`.
- **hejdev6 consumer [실무자 측정]:** ssh goqual, `/tmp/e125-174426`에 candidate tarball+Pi0.99.1 설치, compiled bridge/bin/check-bridge PASS. 운영 plugin0.25.0/Herdr0.9.1/globalPi0.87.1은 교체하지 않았다. tarball sha256 `b19f7d8aa10635b44dff1bb9f7fe9c96c2b34d04e07f26c84f2dcdc71ef86f65`; 표시 version0.25.1은 릴리즈/게시가 아니다.
- **설치본 CLI model-0 [실무자 측정]:** 실제 alias/startup/MCP connected8, registry6direct/2hidden/bare0, compiled child argv/cwd 및 nativeSessionId↔V3 gardenId↔env↔socket join, EOF cleanup PASS. 모델 턴·builtin child tools/call·TUI는 이 증거 밖. report sha256 `fe538718b8a272311bdbdb6d3eb544b56ff07ed962bcd2e1169b369db25d8435`.
- **기본 ACP 실제1턴 [실무자 측정, coordinator receipt 확인]:** sonnet5, ACP explicit candidate bridge self/peers 각1, prompt에 예상 gardenId 없음, tool notice/record/socket/proc join, stop/exit/잔존0. host builtin bridge는 별도 child이며 실제 tools/call 미증명. corrected report sha256 `fc1c5e27a1decbf0658ca20ad9f7c8d0cc9a423a4419b7cf99ab8a1469f73720`.
- **LIVE 정상 쓰기/불확실성:** real HOME overlay settings 재작성·links·transcript/session·homedir 고정 cache 쓰기가 있었다. 사라진 mcp-needs-auth-cache의 actor는 미관측; generic overlay sweep도 가능. 이전 본문이 없어 의미/손실 판정하지 않는다. candidate↔HEAD diff0을 설치된 운영0.25.0의 byte 동등성으로 주장하지 않는다.

# REMAINING

- 측정됨 [2026-10-01 oracle, 운영 Pi 0.99.1]: visible pi fresh→callback→v2 양방향(outbound mailbox, inbound control-socket `sent`→답신). 미측정: 2턴 ACP reuse/cancel/exclusion, close→dormant→resume/recall, interactive trust, Herdr wiring/activation, 다른 lifecycle, wasm 실행.
- codemode는 사용자 지시대로 기본 커버리지 뒤. only projection/ACP guard 접점은 source-derived 가설이며 지원 결정 전. R9 stream hook 지원/명시 exemption도 별도 결정.
- canonical release LIVE/CI/운영 전환/0.30.0 cut은 별도 권한과 exact-SHA 근거가 필요하다. #124 P1/P2 도구 출하와 P3 composite acceptance HOLD를 혼동하지 않는다. CARRIED 0.
