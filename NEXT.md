# NEXT — 형제를 부르고, 놓고, 기계를 건너 닿는 운영 루프

> NEXT는 disposable boot sector다. 이슈가 계약과 영수증을 지고,
> 여기서는 다음 한 수와 돌아올 선만 남긴다.

# RAIL — 현재 좌표

- [ ] **1. #114 garden frontend** ← CURRENT: Herdr와 같은 사용 패턴을 Entwurf 사실 권위 위의 독립 read-only 화면으로 출하한다.
- [ ] **2. #108 placement MCP-wire proof** — 이미 출하된 능력의 작은 증거 구멍을 한 셀로 닫는다.
- [ ] **3. #106 no-turn retirement** — **STEM:** 형제를 모델 턴 없이 안전하게 퇴근시키고 append-only receipt를 남긴다.
- [ ] **4. #107 remote-ready routing** — oracle↔thinkpad에서 같은 garden id의 형제에게 인증된 경로로 닿는다.
- [ ] **5. #113 agent-shell citizen** ← PAUSED: 중요하지만 안 급함. product NO-GO/P0 GO 판정과 설계 자산은 이슈에 보존됐다.

현재 좌표: **1의 live read-only 화면** → 2의 값싼 증거 수리 → 3 사용자 체감 능력 → 4 멀티호스트 확장. #113은 폐기하지 않고 주 레일 밖에 둔다.

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
