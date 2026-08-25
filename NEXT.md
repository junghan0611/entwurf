# NEXT — #82 Copilot garden citizen: branch landing → main close

> NEXT는 disposable boot sector다. 완료 이력은 CHANGELOG/closed issues/git이 지고,
> 방향은 ROADMAP, 운영 규율은 AGENTS가 진다. #82의 durable chronology는 이슈 스레드다.

# RAIL — 현재 좌표

- [x] **1. 0.14.2 발행** — tag `v0.14.2`=`f7ac2d7`, npm `latest=0.14.2`, `repair=0.12.8-repair.1` 보존
- [x] **2. #82 Copilot 시민화 구현 완료 (branch)** — birth/MCP hand/sender/receive D6/visible fresh/admission contract. 33 커밋 + 29-file 최종 번들, 독립 최종 리뷰 0 Blocker PASS + docs amendment
- [ ] **3. branch landing** ← CURRENT: Terra 리뷰 PASS(0 Blocker/1 doc Defect, amendment 닫힘) →
  qualification 1회 + frozen `check:full` 1회 + atomic commit + push + exact-SHA CI 3 job success
- [ ] **4. main landing + #82 close** ← PAUSED: coordinator가 GLG에게 publish 경계 확인 후. durable **main** SHA에서 증거 댓글 + close. 미리 닫지 않는다
- [ ] **5. 0.15.0 release/publish** ← PAUSED: GLG가 target을 **0.15.0**으로 고정. 실행은 mode별
  grant (`entwurf-release` 스킬). npm publish는 mode/version/candidate/dist-tag grant 없이 절대 금지

현재 좌표: 2 완료 → **3 floor 진행**(Terra PASS, candidate frozen) → 4·5 보류. OMP 제품 지원은 #82 close 뒤 **다음 이슈**.

# NOW

- **Current:** #82 landing operator 세션(Fable `20260825T090547-ee05f3`)이 RAIL 3을 실행.
  candidate = HEAD `b56a6d0` + 30-entry 번들(RAIL 9 구현+amendment, RAIL 10 admission contract,
  RAIL 11 subtraction+양 리뷰 amendment, NEXT 승격/삭제). 이전 379s `check:full`은 이 번들 전
  바닥이라 증거가 아니다. Terra 리뷰(gid `20260825T092341-a43c43`)는 **0 Blocker / 1 doc Defect**
  PASS — README bin 개수(five→six, `entwurf-copilot-statusline` 추가)를 amendment로 닫음.
- **Next:** (1) frozen candidate에서 standalone `check-gate-qualification`(29 lanes 251 mutants) →
  (2) frozen `pnpm run check:full` — 둘 다 green일 때만 → (3) commit skill로 atomic commit →
  (4) GLG가 이 창에 직접 push 승인 → ordinary push → agenda stamp → (5) pushed SHA의 ci.yml
  `check`/`install-surface`/`artifact-consumer` 3 job 전부 success 확인.
  red면 진단·수리 후 **새** frozen candidate에서 다시. false green 금지.
- **Blocker:** none (환경) — floor 도는 동안 worktree/index 편집 금지(NEXT 포함).
- **Read:** `DELIVERY.md` Copilot matrix row(수용 영수증 SSOT) · `docs/adding-a-harness.md` step 9
  worked example · issue #82 스레드.
- **Do not touch:** hidden `--ui-server`/`ws.*` · D3/D8 재개 · Copilot LIVE를 pi/claude release
  MUST에 넣기 · OMP 제품 구현/installer/gate · force/no-verify push · qualification 레인 필터 신설.

# GRADE FENCE — #82 close 뒤에도 유효

- receive **D6 PASS** / **D7 partial**(reply·read 관측, completion taxonomy·장기 운영 아님) /
  evidence **L4**(one host). visible fresh는 별도 LIVE(2026-08-25), operator-metered, release MUST 아님.
- **D3 pending** — 두 번째 무장 세션 격리는 관측됐으나 결정적 로그가 scratch cleanup 전에 미보존.
  재측정 절차는 DELIVERY.md가 가리키는 설치/독터 체인 + 형제 `entwurf_v2` 배달; **로그를 cleanup 전에
  옮겨라**(지난번 영수증이 그렇게 사라졌다). B 세션 birth ≈프리미엄 1턴 — GLG 승인 사안.
- 미측정 관측 축(판정 밖): active-turn 배달, `/clear`/foreground 교체 후 재무장, `EXTENSIONS` flag
  내구성(CLI 업그레이드마다), duplicate/ordering under load.
- **게이트 자식 누수(별도 레인):** `check-copilot-receive-arm`이 fork한 stub extension 자식이 `ppid=1`
  고아로 남는다(2026-08-23 측정 42개 + `/tmp/entwurf-copilot-receive.*` 60개; 격리는 지켜져 host 오염
  아님). #82 밖에서 닫는다.

# OMP 좌표 — 다음 이슈의 씨앗 (측정/보류만, 제품 없음)

- `[측정]` oracle `omp` v18.0.0 단일 aarch64 binary; checkout tag v18.0.0(`4142f881`) — 동일 build 미증명.
- `[읽음]` OMP subagent는 parent extension path를 자기 session API에 재bind하고 자기 `session_start`를
  emit(`task/executor.ts:3075-3133,3305`) → naive birth는 subagent마다 record를 민팅할 수 있다.
  birth는 extension context `mode === "tui"` allowlist에서만; subagent는 `"print"`+`hasUI:false`.
- `[읽음]` Claude MCP config를 priority 3으로 번역, subagent는 parent MCP manager를 borrow.
  sanitizer 계산상 callback tool은 `mcp__entwurf_bridge_entwurf_v` — live tool 목록 관측 pending.
- `[읽음]` `ctx.ui.setStatus` → FooterComponent extension status line — garden id 표시 가능, render receipt pending.
- `[읽음]` bridge는 `PI_SESSION_ID`/`PI_AGENT_ID` carrier를 marker보다 먼저 믿음 → managed launch의
  env 소독 선결(Copilot과 동일 계약; `docs/external-mcp-host.md` identity-carrier boundary).
- `[pending]` fresh prompt 위치·`--model` dialect·live callback tool 이름·TUI/subagent 판별 LIVE·
  birth→footer→sender→receive 사슬·receive rail·record-authoritative resume.

# CARRIED — 이 레인 밖에서 닫을 것

- **cortex 게이트 슬라이스 수리 — 아직 미착지.** `check-acp-carrier-augment.ts`가 cortex 선언부터 EOF까지
  잘라 정규식을 걸어 결함을 심어도 SURVIVED. 수리 패치
  `~/.local/share/entwurf-salvage/0005-fix-gate-close-the-cortex-carrier-pin-at-the-next-ad.patch`
  (측정 확인됨: 심음→KILLED, 복원→control 초록). **main에 별 커밋으로 닫는다.**
  `CORTEX-PROVIDER-SIX-ROW-SURFACE` 개명은 같이 가져오지 않는다.
- **카디널리티 감사 — record-only.** 백엔드 개수를 인코딩한 서술 12문장/6파일, 게이트가 지키는 것 0.
  이슈로 열지 않는다. 포획기(린터/뮤턴트 레인)를 만들지 않는다. 슬라이스는 다음 어댑터에서 닫고,
  claim id에 센서스를 넣지 않고, stale-prose sweep과 `CARRIER_LESS_BACKENDS` 멤버십이 SSOT.
- **`copilot --acp` 핸드셰이크는 측정으로만 남긴다.** `protocolVersion 1`, `agentInfo{Copilot,1.0.80}`,
  `loadSession:true`, `authMethods[copilot-login]`. 레인이 아니라 사실이다.
- **OPEN 8:** #72 ACP retained-child · #76 subscription-first kill-switch · #78 portability ·
  #80 vocabulary · #82(이 레인, close 대기) · #83 close 대기 · #84 model-lock ledger ·
  #85 mcp/tsconfig noEmit fence. AGENTS cap은 5 — #82/#83 close 뒤 sweep이 소관.

# RECENT

- **2026-08-25:** #82 RAIL 9 clause 7 visible-fresh LIVE 수용(window `@89`, nonce
  `mux-fresh-call-690529ae99f99faa2252aefb`, callback garden `20260825T085721-f68be0`) + RAIL 10
  admission contract(docs) + RAIL 11 subtraction. Fable 독립 최종 리뷰 **0 Blocker / 3 doc Defect**
  PASS(amendment는 coordinator 적용), Terra 품질 리뷰(gid `20260825T092341-a43c43`) **0 Blocker /
  1 doc Defect** PASS(README six-bins amendment). Luna review는 GLG가 취소.
- **2026-08-23:** receive **D6** LIVE 수용 + RAIL 7–8 landing `31ebea0` push, exact-SHA CI SUCCESS,
  GLG managed-launch LIVE. 영수증 SSOT는 DELIVERY.md matrix row와 #82 스레드.
- **2026-08-20:** #82 축 오조준(ACP 백엔드) → 폐기 후 garden-id 시민화로 재조준. 교훈은 AGENTS.md
  issue-queue 절(본문 아닌 스레드가 계약)에 영구 기록.

# DURABLE LINKS

- #82 LIVE sender checkpoint: https://github.com/junghan0611/entwurf/issues/82#issuecomment-5365420577
- #82 pushed CI-green checkpoint: https://github.com/junghan0611/entwurf/issues/82#issuecomment-5365828064
- #82 RAIL 7–8 landing: https://github.com/junghan0611/entwurf/issues/82#issuecomment-5386397337
- New-harness admission: `docs/adding-a-harness.md` step 9
