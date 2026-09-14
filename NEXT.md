# NEXT — 형제를 부르고, 놓고, 기계를 건너 닿는 운영 루프

> NEXT는 disposable boot sector다. 이슈가 계약과 영수증을 지고,
> 여기서는 다음 한 수와 돌아올 선만 남긴다.

# RAIL — 현재 좌표

- [ ] **1. #114 garden frontend** ← CURRENT: Herdr와 같은 사용 패턴을 Entwurf 사실 권위 위의 독립 read-only 화면으로 출하한다.
- [ ] **2. #116 herdr 위의 entwurf 플러그인** — **DECISION:** 배치는 herdr에게 빌리고 신원·부름·퇴근만 entwurf가 파는 형태. #114의 `placement` 축 방향을 선행 결정한다.
- [ ] **3. #108 placement MCP-wire proof** — 이미 출하된 능력의 작은 증거 구멍을 한 셀로 닫는다.
- [ ] **4. #106 no-turn retirement** — **STEM:** 형제를 모델 턴 없이 안전하게 퇴근시키고 append-only receipt를 남긴다.
- [ ] **5. #107 remote-ready routing** — oracle↔thinkpad에서 같은 garden id의 형제에게 인증된 경로로 닿는다.
- [ ] **6. #113 agent-shell citizen** ← PAUSED: 중요하지만 안 급함. product NO-GO/P0 GO 판정과 설계 자산은 이슈에 보존됐다.

현재 좌표: **1의 live read-only 화면** → 2의 방향 결정 → 3의 값싼 증거 수리 → 4 사용자 체감 능력 → 5 멀티호스트 확장. 2는 diff가 아니라 경계 판정이라 1과 병행할 수 있다. #113은 폐기하지 않고 주 레일 밖에 둔다.

# NOW — #114 garden frontend

- **Shape:** `entwurf garden`은 TTY에서 자동 refresh되는 한 화면이다. 위 vertical panel은 whole-current-server tmux inventory, 아래 vertical panel은 owner `listEntwurfFacts`가 낸 retained garden record-store address/liveness/receiver/transcript facts다. frame은 한 화면, `--json`은 동일 projection을 낸다.
- **Authority:** pane과 citizen은 같은 cwd/command여도 join하지 않는다. attention도 backend의 explicit report가 없으면 `not-observed`다. viewer는 send/launch/resume/install/pane-switch/state-write를 하지 않는다.
- **Branch:** `feat/114-garden-frontend`.
- **Review:** Herdr research/adversarial reports를 반영했고 Grok 독립 검수는 Blocker 0 / Product Defect 0, kill 1–8 및 adopted amendments PASS다.
- **Next:**
  1. coherent candidate를 freeze하고 qualification과 full floor를 각 1회 실행한다.
  2. green receipt 뒤 checkpoint commit을 만든다.
  3. GLG가 `./run.sh garden --once`를 직접 읽고, 바로 보인 것/여전히 재구성한 것/없는 join을 기록한다.
  4. 그 hands-on 뒤 #108 placement MCP-wire 한 셀로 돌아간다. 클릭/action은 기존 verb를 정확히 호출할 caller identity 계약이 생기기 전에는 붙이지 않는다.
- **Acceptance:** whole-current-server pane inventory와 retained citizen record store를 위/아래 panel에서 읽되, JSON에서도 `placement`와 `garden`이 분리되고 `join=not-performed`, `attention=not-observed`가 명시된다.
- **Blocker:** 없음.
- **Read:** #114 · `docs/garden-view.md` · `scripts/garden-view.ts` · `scripts/lib/garden-view.ts` · accepted Herdr/Grok review reports.
- **Do not touch:** backend admission, delivery/resume contracts, prompt/screen parser, new socket, scheduler/manager, release/tag/push.

# ONE-SCREEN PROBE — #114

- caller-side `entwurf-peek situation`과 owner projection `entwurf meta-facts`를 baseline으로 삼았고, 제품면은 둘의 parser를 복제하지 않고 `listEntwurfFacts`를 직접 조립한다.
- 현재 frame은 tmux pane inventory를 위 panel, garden record·liveness를 아래 panel에 놓는다. explicit receipt가 없으면 pane↔garden row를 조인하지 않으며, action은 read-only acceptance 뒤의 별도 계약이다.
- 첫 exit는 설치 action이나 manager가 아니라 GLG hands-on 한 번의 기록이다: 무엇을 바로 읽었고, 무엇을 여전히 재구성했고, 어떤 join이 없었는가.
- 살아남으면 citizen viewer와 install/setup surface를 별도 구현 계약으로 자른다. #114는 #106/#107의 기능을 소유하지 않고 사람이 그것을 읽는 얇은 면만 소유한다.

# DECISION OPEN — #116 herdr 위의 entwurf 플러그인

- **착상:** herdr가 주는 UX(배치·레이아웃 복구·원격 attach·하네스 감지)를 다 빌려 쓰고, entwurf는 herdr가 하지 않는 것만 플러그인으로 배포한다 — 지속하는 이름(garden id), 공식 수신면 배달과 거절, resume, #106 퇴근, #107 원격.
- **왜 herdr가 안 하나:** 범용 도구니까 하네스별 삽질 로직을 할 이유가 없다. 그게 그들의 현명함이고, 반대로 **하네스별 삽질 로직이 이 리포의 정체성**이다. GLG 한 줄: *"나 대신 입력하지 말라는 거니까."* herdr는 나 대신 친다, entwurf는 나에게 배달한다.
- **이음매는 이미 측정됐다** `[2026-09-14, 새 코드 0줄]`: herdr 패인 `w2:p1` → session.json `agent_session.value` `9706ccd4…` → entwurf 레코드 `20260914T084325-14d357`, 레코드 1117개 중 1건. `herdr pane report-agent-session --agent-session-id` 가 그 보고를 받는 공개 구멍이다.
- **#114와의 긴장을 숨기지 않는다:** #114는 herdr 사용 패턴을 *복제*하고, #116은 *소비*하자고 한다. 배타적이진 않다 — 아래 패널(garden facts)은 어느 쪽이든 필요하고 위 패널(pane inventory)만 갈아끼운다. **#114는 계속 간다.** 다만 #114 완료를 기다렸다 결정하면 복제한 위 패널에 비용을 다 치른 뒤가 된다.
- **확정된 마찰:** herdr claude 훅(`~/.claude/hooks/herdr-agent-state.sh`, settings.json `SessionStart` matcher `*`, 헤더가 "reinstalling overwrites this file" 선언)과 entwurf meta-bridge(`~/.claude/plugins/cache/meta-bridge-local`)가 **이미 공존 중**이다. 실제 간섭은 미측정.
- **다음 한 측정:** `./run.sh doctor-meta-bridge` — herdr 훅 깔린 호스트에서 entwurf claude 레일이 여전히 초록인가. 빨간불이면 플러그인 논의 이전에 공존 계약이 먼저다. 초록이면 두 번째 측정: `herdr pane split --no-focus` + `herdr agent start --kind claude` 로 열린 형제가 garden id를 받고 `entwurf_v2`로 닿는가.
- **하지 않을 것:** tmux 레일 제거 · herdr 패인 상태/화면 텍스트를 liveness나 배달 증거로 읽기(Hard Rule 16) · pane id를 제2 주소축으로 승격(Hard Rule 2) · 이 레인에서 #106/#107 구현.
- **Read:** #116 · `~/repos/gh/agent-config/HERDR.md` [2026-09-14] 절 · `DELIVERY.md:22-26` · `docs/mux-launch-rail.md` · `herdr --skill`.

# RETURN TO STEM — #106 no-turn retirement

- **첫 결정은 API 이름이 아니라 첫 backend의 소유 증명이다.** Pi의 self-owned control-socket 종료와 Claude Code의 verified marker/PID 종료를 둘 다 측정해, 추측 PID 없이 no-turn 종료 가능한 가장 좁은 하나를 고른다.
- target transcript는 삭제·절단·편집하지 않는다. 신호 전 길이 N의 기존 bytes hash가 동일하고 vendor append만 허용한다.
- receipt는 record body를 V4로 늘리지 않고 `meta-events/<gardenId>.jsonl` 같은 record-owned append-only sidecar 후보를 검증한다.
- `actorHost`/`targetHost`는 #106에서 **provenance**일 뿐 #107의 route/address authority가 아니다. 먼저 얼더라도 원격 설계를 막지 않게 분리한다.
- stale/wrong owner, unreachable target, unsupported backend는 프로세스·record 무변경으로 이름 붙여 거절한다.
- 완료 뒤 #107의 다섯 질문을 research hop으로 좁힌다. 원격은 기존 rail 위의 인증된 host route이며, garden id 외 제2 주소축이나 조용한 local fallback을 만들지 않는다.

# RECENT — Eigenflux 판정

- `phronesis-io/eigenflux`는 Console/Ed25519 계정과 중앙 Hub가 낯선 agent를 매칭하는 broadcast/discovery network다. SSH로 이미 아는 두 host의 이미 아는 citizen에게 닿는 #107의 route/ownership/receipt 문제를 풀지 않는다.
- `steipete/openclaw-eigenflux`는 공식 `phronesis-io/openclaw-eigenflux`의 zero-diff fork다. 별도 두 번째 구조 증거가 아니다.
- Entwurf dependency/adapter 후보로 쓰지 않는다. 조사 receipt: `.agent-reports/eigenflux-106-108-review-sonnet-20260913.md`.

# PARKED — #113 agent-shell

- #113 댓글에 현재 판정과 영수증이 있다: **product NO-GO / P0 M1–M4 GO**.
- shared-daemon `emacsclient -t`, pid-level host marker, task-bearing `--eval`, in-repo MELPA product는 폐기됐다.
- 재진입 조건: #108→#106→#107 흐름 뒤 GLG가 다시 우선순위를 올리거나, dedicated `emacs -nw` process-in-pane H3 kill-gate를 수행할 명확한 사용자 가치가 생길 때.
- 재개 시 첫 홉은 제품 leaf가 아니라 `scripts/raw-agent-shell-measure/` H1/M1이다.

# DURABLE LINKS

- #108 placement MCP proof: https://github.com/junghan0611/entwurf/issues/108
- #114 garden frontend: https://github.com/junghan0611/entwurf/issues/114
- #106 no-turn retirement: https://github.com/junghan0611/entwurf/issues/106
- #107 remote-ready routing: https://github.com/junghan0611/entwurf/issues/107
- #113 agent-shell citizen: https://github.com/junghan0611/entwurf/issues/113
- Admission path: `docs/adding-a-harness.md`
- Mux contract: `docs/mux-launch-rail.md`
